/**
 * The export screen: point the page at a HOTD2 install and build a bundle
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
 */
import { createElement, useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";

import { canPickDirectory, clearCache, downloadCache, forgetInstall,
         hasCachedBundle, pickInstall, regrantInstall, rememberedInstall,
         requestPersist, runExport, storageEstimate } from "./index";
import type { ExportHandle } from "./index";
import type { InstallRef, WorkerOut } from "./protocol";

const ALL_STAGES = [1, 2, 3, 4, 5, 6];

/** Roughly what a full export costs, so the size warning is not a surprise. */
const MB_PER_BUNDLE = 35;

interface Props {
  /** Called when a bundle exists and the player should start on it. */
  onReady: () => void;
  /** Called when the user dismisses the screen without exporting. */
  onDismiss: (() => void) | null;
  /** Why the screen opened, when it opened because loading failed. */
  reason: string | null;
}

function ExportScreen({ onReady, onDismiss, reason }: Props) {
  const [install, setInstall] = useState<InstallRef | null>(null);
  const [stages, setStages] = useState<number[]>([1]);
  const [arcade, setArcade] = useState(true);
  const [original, setOriginal] = useState(true);
  const [lines, setLines] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [cached, setCached] = useState(false);
  const [quota, setQuota] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [finished, setFinished] = useState<string | null>(null);
  const handle = useRef<ExportHandle | null>(null);
  const feed = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    void (async () => {
      setCached(await hasCachedBundle());
      const known = await rememberedInstall();
      if (known) setInstall(known);
      const e = await storageEstimate();
      if (e && e.quota) {
        setQuota(`${(e.usage / 1e6).toFixed(0)} MB used of `
                 + `${(e.quota / 1e9).toFixed(1)} GB available`);
      }
    })();
  }, []);

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

  const start = useCallback(async () => {
    if (!install || !stages.length) return;
    const modes: boolean[] = [];
    if (arcade) modes.push(false);
    if (original) modes.push(true);
    if (!modes.length) return;

    setLines([]);
    setWarnings([]);
    setError(null);
    setFinished(null);
    setRunning(true);
    // A full export is a few hundred megabytes; ask before filling the disk
    // rather than after.
    if (stages.length * modes.length >= 4) await requestPersist();

    handle.current = runExport(
      { kind: "export", install, stages, modes, fresh: false },
      (msg: WorkerOut) => {
        if (msg.kind === "progress") setLines((l) => [...l, msg.line]);
        else if (msg.kind === "warning") setWarnings((w) => [...w, msg.line]);
        else if (msg.kind === "stage") {
          setLines((l) => [...l,
            `  -> ${msg.counts.models} models, ${msg.counts.triangles} tris, `
            + `${msg.counts.textures} textures, ${msg.counts.spawns} spawns`]);
        } else if (msg.kind === "error") {
          setError(msg.message);
          setRunning(false);
        } else {
          setRunning(false);
          setCached(true);
          setFinished(
            `${msg.stages} stage bundle(s), ${(msg.bytes / 1e6).toFixed(0)} MB`
            + (msg.degraded
               ? ` -- ${msg.degraded} thing(s) could not be read; see below`
               : ""));
          void storageEstimate().then((e) => {
            if (e && e.quota) {
              setQuota(`${(e.usage / 1e6).toFixed(0)} MB used of `
                       + `${(e.quota / 1e9).toFixed(1)} GB available`);
            }
          });
        }
      });
  }, [install, stages, arcade, original]);

  const stop = useCallback(() => {
    handle.current?.cancel();
    handle.current = null;
    setRunning(false);
    setLines((l) => [...l, "stopped; the stages that finished are kept"]);
  }, []);

  const toggleStage = (n: number) =>
    setStages((s) => s.includes(n) ? s.filter((x) => x !== n)
                                   : [...s, n].sort((a, b) => a - b));

  const modeCount = (arcade ? 1 : 0) + (original ? 1 : 0);
  const estimate = stages.length * modeCount * MB_PER_BUNDLE;

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
          <h2>2. What to build</h2>
          <div className="export-stages">
            {ALL_STAGES.map((n) => (
              <label key={n}>
                <input type="checkbox" checked={stages.includes(n)}
                       onChange={() => toggleStage(n)} disabled={running} />
                Stage {n}
              </label>
            ))}
            <button onClick={() => setStages(ALL_STAGES)} disabled={running}>
              all
            </button>
          </div>
          <div className="export-modes">
            <label>
              <input type="checkbox" checked={arcade} disabled={running}
                     onChange={(e) => setArcade(e.target.checked)} />
              Arcade Mode
            </label>
            <label>
              <input type="checkbox" checked={original} disabled={running}
                     onChange={(e) => setOriginal(e.target.checked)} />
              Original Mode
            </label>
          </div>
          <p className="export-note">
            Roughly {estimate} MB, and a minute or so per bundle.
            {quota ? ` ${quota}.` : ""}
          </p>
        </section>

        <section>
          <h2>3. Go</h2>
          <p>
            {running
              ? <button onClick={stop}>Stop</button>
              : <button className="export-primary" onClick={() => void start()}
                        disabled={!install || !stages.length || !modeCount}>
                  Export
                </button>}
            {cached && !running
              ? <>
                  <button onClick={onReady}>Play the cached bundle</button>
                  <button onClick={() => void downloadCache()}>
                    Download as .zip
                  </button>
                  <button onClick={() => { void clearCache(); setCached(false); }}>
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
 * Put the export screen on the page.
 *
 * Its own React root, in its own element, which **`index.html` declares**. A
 * layer that appends an element to the document is a second owner of the page
 * and paints in whatever order the two roots happened to mount in -- which is
 * what `no-dom-insertion` is at zero for. The page declares the host; React
 * owns what is inside it. Same contract as `#app`, one element along.
 */
export function showExportScreen(opts: {
  onReady: () => void;
  onDismiss: (() => void) | null;
  reason: string | null;
}): void {
  const host = document.querySelector("#export-root");
  if (!host) throw new Error("install: no #export-root in index.html");
  root ??= createRoot(host);
  root.render(createElement(ExportScreen, opts));
}

export function hideExportScreen(): void {
  root?.render(createElement("div"));
}
