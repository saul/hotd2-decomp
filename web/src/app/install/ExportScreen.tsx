/**
 * The bundle screen: point the page at a HOTD2 install and build a stage
 * without leaving the browser.
 *
 * **Why this is in `app/` and not in `ui/`.** Every panel under `ui/` is part
 * of the player's one projection: it reads a slice published once a frame and
 * emits a `UiCommand`. This is not that. It runs before there is a player at
 * all, it talks to a worker and the file system, and none of its state is game
 * state. Putting it in `ui/` would mean widening the command union and the
 * projection with a dozen fields that exist only until a bundle does. `app/`
 * is the composition root and may see everything, which is exactly what this
 * needs.
 *
 * It mounts into its own root over the page, so it never becomes a second
 * writer of anything `ui/App.tsx` renders.
 *
 * It opens two ways: by itself when there is nothing to play, and from the top
 * bar's `Bundle...` button at any time. It used to open only the first way,
 * which meant that on any machine with `extract/player/` populated -- every
 * developer's -- none of it could be reached at all.
 *
 * **One stage at a time.** Every stage in both modes is 431 MB and the better
 * part of an hour of somebody's laptop, which is a strange thing to ask for
 * before they have seen anything at all. A stage is a minute. The rest are
 * built when they are asked for, from the top bar, into the same cache -- see
 * `Player.buildStage` -- so choosing here is choosing where to start and not
 * what you are limited to.
 */
import { createElement, useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";

import { ALL_STAGES, BundleIndex, slotKey } from "../bundles";
import type { Origin } from "../bundles";
import { canPickDirectory, clearCache, downloadCache, forgetInstall,
         onThumbWritten, pickInstall, regrantInstall, rememberedInstall,
         requestPersist, readThumb, runExport,
         storageEstimate } from "./index";
import type { ExportHandle } from "./index";
import type { InstallRef, WorkerOut } from "./protocol";

interface Props {
  /** Called when the stage the user chose is in the cache and playable. */
  onReady: (stage: number, original: boolean) => void;
  /**
   * Called the moment an export finishes, with what it built.
   *
   * Separate from {@link Props.onReady}, which is a button. **A stage can be
   * rebuilt underneath the player**, and if it is the one on screen then
   * everything the page is drawing came out of the copy that was just
   * replaced. Without this the only way to see the new one was to reload the
   * page by hand, which is not a step anybody should have to know about.
   *
   * It may return a promise, and if it does this screen waits for it before
   * re-reading the tiles: the player answers by *photographing* the stage,
   * which takes a second or two, and a rescan that does not wait shows the
   * tile it just filled in with no picture in it.
   */
  onBuilt: (stage: number, original: boolean) => void | Promise<void>;
  /** Called when the user dismisses the screen. Null when there is no player. */
  onDismiss: (() => void) | null;
  /**
   * The stage and mode to open on -- what the player is showing.
   *
   * It opened on stage 1 Arcade whatever was on screen, so the commonest
   * reason to be here at all, "rebuild the thing I am looking at", started
   * with picking it out of a grid again, and the primary button said
   * "Build it" for a stage that was already built. Absent when there is no
   * player to ask.
   */
  openOn?: { stage: number; original: boolean };
  /** Why the screen opened, when it opened because nothing would load. */
  reason: string | null;
}

/** Where a stage already exists, in the words the screen uses for it. */
const ORIGIN_TEXT: Record<Origin, string> = {
  cache: "built here",
  server: "served",
};

function ExportScreen({ onReady, onBuilt, onDismiss, reason,
                        openOn }: Props) {
  const [install, setInstall] = useState<InstallRef | null>(null);
  const [stage, setStage] = useState(openOn?.stage ?? 1);
  const [original, setOriginal] = useState(openOn?.original ?? false);
  const [lines, setLines] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [quota, setQuota] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [finished, setFinished] = useState<string | null>(null);
  // What exists right now, in both bundles. Re-read after every export, so the
  // labels under the stage buttons are what is on disk and not what this
  // screen remembers doing.
  const [have, setHave] = useState<Map<string, Origin>>(new Map());
  // Which of those were written by an older exporter than this page, and what
  // moved. The button in the top bar can only say *that* something is out of
  // date; this is the screen with room to say which and why.
  const [stale, setStale] = useState<Set<string>>(new Set());
  const [drift, setDrift] = useState<string[]>([]);
  const [thumbs, setThumbs] = useState<Map<number, string>>(new Map());
  const handle = useRef<ExportHandle | null>(null);
  const feed = useRef<HTMLDivElement | null>(null);
  /**
   * The `blob:` URLs this screen has made, so they can be given back.
   *
   * A ref rather than state: nothing renders from it, and revoking has to
   * happen on the *previous* set at the moment the next one replaces it --
   * which is a thing that happens outside React's render, when a picture is
   * re-read after an export.
   */
  const blobs = useRef<string[]>([]);
  /**
   * Which rescan is the current one.
   *
   * **This is not decoration.** A *Build all* finishes six stages within a
   * few seconds of each other and each one starts a rescan, so several are
   * always in flight together -- and each one revokes the `blob:` URLs the
   * one before it had just put on screen. The last stage's tile came out
   * empty every time, with its picture sitting in the store. Only the newest
   * scan installs anything; the others give their own URLs back and say
   * nothing.
   */
  const scan = useRef(0);
  /**
   * The same guard for the pictures, and separately.
   *
   * A thumbnail write can arrive in the middle of a rescan -- that is the
   * whole point of {@link onThumbWritten} -- and if it shared `scan` it would
   * cancel that rescan's *labels* on its way past. Two concerns, two
   * counters.
   */
  const thumbScan = useRef(0);

  /**
   * Read every stage's picture out of the store and put them on screen.
   *
   * Called on mount, after every export, **and whenever a picture is
   * written**. That last one is the fix for a tile that stayed empty for as
   * long as the screen was up: the player takes its fallback picture nine
   * frames after a stage loads, and a screen opened straight after the page
   * finished loading reads the store a few milliseconds before the PNG gets
   * there. Nothing read it again, so the picture existed and was never shown.
   * `bundle_flow.mjs` failed on that about one run in three and the wait it
   * gave up on could not have helped: it was waiting for something that had
   * already happened. See `onThumbWritten` in `browser_io.ts`.
   */
  const refreshThumbs = useCallback(async () => {
    const mine = ++thumbScan.current;
    const t = new Map<number, string>();
    const made: string[] = [];
    for (const n of ALL_STAGES) {
      const url = await readThumb(n);
      if (url) { made.push(url); t.set(n, url); }
    }
    if (mine !== thumbScan.current) {
      for (const url of made) URL.revokeObjectURL(url);
      return;
    }
    for (const url of blobs.current) URL.revokeObjectURL(url);
    blobs.current = made;
    setThumbs(t);
  }, []);

  const rescan = useCallback(async () => {
    const mine = ++scan.current;
    const index = new BundleIndex();
    await index.refresh();
    const m = new Map<string, Origin>();
    const old = new Set<string>();
    for (const s of index.built()) {
      m.set(slotKey(s.stage, s.original), s.from);
      if (s.stale) old.add(slotKey(s.stage, s.original));
    }
    const e = await storageEstimate();
    if (mine !== scan.current) return;
    // The labels first and on their own, because they are what the screen is
    // unreadable without: six tiles saying "not built" over a cache holding
    // four is worse than a tile with no picture in it. Reading six images
    // takes long enough to be visible.
    setHave(m);
    setStale(old);
    setDrift(index.drift);
    setQuota(e && e.quota
      ? `${(e.usage / 1e6).toFixed(0)} MB used of `
        + `${(e.quota / 1e9).toFixed(1)} GB available`
      : "");
    // The pictures too, and **not only on mount**. They are taken as each
    // stage finishes building, so a screen that read them once showed empty
    // tiles for everything it had just built and only caught up the next time
    // it was opened.
    await refreshThumbs();
  }, [refreshThumbs]);

  useEffect(() => {
    void (async () => {
      // Thumbnails come with it: they are the player's own frames, kept beside
      // the bundle that produced them, and a stage nobody has built or opened
      // has none -- which is the honest picture of such a stage.
      await rescan();
      const known = await rememberedInstall();
      if (known) setInstall(known);
    })();
    // And again on every later write, for the race above.
    const stop = onThumbWritten(() => { void refreshThumbs(); });
    // A `blob:` URL nothing revokes holds its blob until the tab closes, and
    // this screen makes six of them every time it rescans.
    return () => {
      stop();
      for (const url of blobs.current) URL.revokeObjectURL(url);
      blobs.current = [];
    };
  }, [rescan, refreshThumbs]);

  // Escape closes it, but only when there is something to go back to and
  // nothing is running: a half-written cache is worth a deliberate Stop.
  useEffect(() => {
    if (!onDismiss || running) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onDismiss(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDismiss, running]);

  // The feed scrolls itself, because the interesting line is always the last.
  useEffect(() => {
    const el = feed.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines, warnings]);

  const choose = useCallback(async () => {
    setError(null);
    const ref = await pickInstall();
    if (ref) setInstall(ref);
  }, []);

  const regrant = useCallback(async () => {
    setError(null);
    const ref = await regrantInstall();
    if (ref) setInstall(ref);
    else setError("permission was not granted; pick the folder again");
  }, []);

  /**
   * Run an export. One stage, or every stage, in the mode that is selected.
   *
   * One function for both buttons: they differ by the list they pass and by
   * nothing else, and two copies of the message handling is two places for the
   * per-stage `onBuilt` to be forgotten.
   */
  const start = useCallback(async (stages: number[]) => {
    if (!install) return;
    setLines([]);
    setWarnings([]);
    setError(null);
    setFinished(null);
    setRunning(true);
    // A stage is ~35 MB and the cache is meant to survive a reload, so ask for
    // persistence before filling it rather than after being evicted.
    await requestPersist();

    handle.current = runExport(
      { kind: "export", install, stages, modes: [original], fresh: false },
      (msg: WorkerOut) => {
        if (msg.kind === "progress") setLines((l) => [...l, msg.line]);
        else if (msg.kind === "warning") setWarnings((w) => [...w, msg.line]);
        else if (msg.kind === "stage") {
          setLines((l) => [...l,
            `  -> ${msg.counts.models} models, ${msg.counts.triangles} tris, `
            + `${msg.counts.textures} textures, ${msg.counts.spawns} spawns`]);
          // Per stage rather than once at the end: a run may build six, and
          // each of them wants its picture taken and its stage reloaded if it
          // is the one on screen.
          // And re-read once the picture is in, so the tile that stage sits
          // in stops saying "not built" and gets its frame while the rest of
          // the run carries on.
          void Promise.resolve(onBuilt(msg.stage, msg.original))
            .then(rescan, () => rescan());
        } else if (msg.kind === "error") {
          setError(msg.message);
          setRunning(false);
        } else {
          setRunning(false);
          setFinished(
            `${(msg.bytes / 1e6).toFixed(0)} MB cached`
            + (msg.degraded
               ? ` -- ${msg.degraded} thing(s) could not be read; see below`
               : ""));
          void rescan();
        }
      });
  }, [install, original, rescan, onBuilt]);

  const stop = useCallback(() => {
    handle.current?.cancel();
    handle.current = null;
    setRunning(false);
    setLines((l) => [...l, "stopped; whatever finished is kept"]);
  }, []);

  const where = have.get(slotKey(stage, original));
  const anything = have.size > 0;

  return (
    <div className="export-screen">
      <div className="export-card">
        <h1>Build a bundle</h1>
        <p className="export-lede">
          The player needs the game's own data. Point it at your copy of
          <b> THE HOUSE OF THE DEAD 2</b> -- the folder holding{" "}
          <code>Hod2.exe</code> -- and it reads the formats here, in this tab.
          Nothing is uploaded anywhere.
        </p>
        {reason ? <p className="export-why">{reason}</p> : null}

        <section>
          <h2>1. The install</h2>
          {install
            ? <p className="export-ok">
                Using <code>{install.label}</code>{" "}
                <button onClick={() => { void forgetInstall(); setInstall(null); }}>
                  change
                </button>
              </p>
            : <p>
                <button className="export-primary" onClick={() => void choose()}>
                  Choose folder...
                </button>
                {canPickDirectory()
                  ? <button onClick={() => void regrant()}>
                      use the last one
                    </button>
                  : <span className="export-note">
                      {" "}This browser cannot remember the folder between
                      visits, so it has to be chosen each time.
                    </span>}
              </p>}
        </section>

        <section>
          <h2>2. The stage</h2>
          <div className="export-tiles">
            {ALL_STAGES.map((n) => {
              const k = slotKey(n, original);
              const src = have.get(k);
              const old = stale.has(k);
              const thumb = thumbs.get(n);
              return (
                <button key={n} disabled={running}
                        className={`export-tile${n === stage ? " on" : ""}`
                                   + (old ? " stale" : "")}
                        onClick={() => setStage(n)}>
                  <span className="export-thumb">
                    {thumb
                      ? <img src={thumb} alt="" />
                      : <span className="export-nothumb">{n}</span>}
                  </span>
                  <span className="export-tile-name">Stage {n}</span>
                  <span className="export-tile-note">
                    {src ? ORIGIN_TEXT[src] : "not built"}
                    {old ? " \u00b7 needs rebuilding" : ""}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        {stale.size
          ? <p className="export-why">
              {stale.size === 1
                ? "One stage bundle was"
                : `${stale.size} stage bundles were`}
              {" "}built by an older exporter than this page. They still play,
              and they may be wrong in ways nothing here can see -- rebuild
              them when you can.
              {drift.length
                ? ` Changed since: ${drift.join(", ")}.`
                : " This bundle predates the check, so what changed is not"
                  + " recorded."}
            </p>
          : null}

        <section>
          <h2>3. The mode</h2>
          <div className="export-modes">
            <label>
              <input type="radio" name="mode" checked={!original}
                     disabled={running}
                     onChange={() => setOriginal(false)} />
              Arcade Mode
            </label>
            <label>
              <input type="radio" name="mode" checked={original}
                     disabled={running}
                     onChange={() => setOriginal(true)} />
              Original Mode
            </label>
          </div>
          <p className="export-note">
            About 35 MB and a minute each. The other stages are also built when
            you pick them in the top bar, so <b>Build all</b> is for when you
            would rather wait once.{quota ? ` ${quota}.` : ""}
          </p>
        </section>

        <section>
          <h2>4. Go</h2>
          <p>
            {running
              ? <button onClick={stop}>Stop</button>
              : <>
                  <button className="export-primary"
                          onClick={() => void start([stage])}
                          disabled={!install}>
                    {where === "cache" ? "Build it again" : "Build it"}
                  </button>
                  <button onClick={() => void start([...ALL_STAGES])}
                          disabled={!install}
                          title={`Build all six stages in `
                            + `${original ? "Original" : "Arcade"} Mode. `
                            + `About 200 MB and six minutes.`}>
                    Build all
                  </button>
                  {where
                    ? <button onClick={() => onReady(stage, original)}>
                        Play stage {stage}{original ? " (Original)" : ""}
                      </button>
                    : null}
                </>}
            {anything && !running
              ? <>
                  <button onClick={() => void downloadCache()}>
                    Download as .zip
                  </button>
                  <button onClick={() => {
                    void clearCache().then(rescan);
                  }}>
                    Clear cache
                  </button>
                </>
              : null}
            {onDismiss && !running
              ? <button onClick={onDismiss}>Back</button> : null}
          </p>
        </section>

        {error ? <p className="export-error">{error}</p> : null}
        {finished ? <p className="export-ok">Done: {finished}</p> : null}

        {lines.length || warnings.length
          ? <div className="export-feed" ref={feed}>
              {lines.map((l, i) => <div key={`l${i}`}>{l}</div>)}
              {warnings.map((w, i) =>
                <div key={`w${i}`} className="export-warn">{w}</div>)}
            </div>
          : null}
      </div>
    </div>
  );
}

let root: Root | null = null;

/**
 * Put the bundle screen on the page.
 *
 * Its own React root, in its own element, which **`index.html` declares**. A
 * layer that appends an element to the document is a second owner of the page
 * and paints in whatever order the two roots happened to mount in -- which is
 * what `no-dom-insertion` is at zero for. The page declares the host; React
 * owns what is inside it. Same contract as `#app`, one element along.
 */
export function showExportScreen(opts: Props): void {
  const host = document.querySelector("#export-root");
  if (!host) throw new Error("install: no #export-root in index.html");
  root ??= createRoot(host);
  root.render(createElement(ExportScreen, opts));
}

export function hideExportScreen(): void {
  root?.render(createElement("div"));
}
