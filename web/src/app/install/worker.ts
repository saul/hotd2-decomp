/**
 * The export, off the main thread.
 *
 * A stage is a minute of solid CPU -- LZ over 80 MB of `pol/`, PowerVR2
 * decode over 69 MB of `tex/` -- and doing it on the main thread would freeze
 * the page for the whole of it, including the progress feed that is supposed
 * to say what is happening. So it runs here.
 *
 * This is the whole reason `src/hod2lib/` takes its bytes through an
 * interface: a `FileSystemDirectoryHandle` and a `File` are both
 * structured-cloneable, the package is pure, and the worker is a message loop
 * with no knowledge of any format in it.
 */

import { buildStage, writeManifest } from "../../hod2lib/bundle";
import * as degraded from "../../hod2lib/degraded";
import { Stage } from "../../hod2lib/stage";
import { FileListAssetSource, HandleAssetSource, OpfsBundleSink,
         browserDeflate, clearCache, listCached } from "./browser_io";
import type { ExportRequest, WorkerIn, WorkerOut } from "./protocol";

function post(msg: WorkerOut): void {
  (self as unknown as Worker).postMessage(msg);
}

async function run(req: ExportRequest): Promise<void> {
  const source = req.install.handle
    ? new HandleAssetSource(req.install.handle, req.install.label)
    : new FileListAssetSource(req.install.files ?? [], req.install.label);

  if (!await source.exists("Hod2.exe")) {
    throw new Error(
      "that folder has no Hod2.exe in it -- pick the directory the game is "
      + "installed in, the one holding Hod2.exe, pol/ and tex/");
  }

  if (req.fresh) await clearCache();
  const sink = new OpfsBundleSink();
  degraded.setWarningSink((line) => post({ kind: "warning", line }));

  const entries: Record<string, unknown>[] = [];
  let lost = 0;

  /**
   * Write the manifest for what has been built **so far**.
   *
   * Called after every stage rather than once at the end, and the difference
   * is what the page can do with a stage that is finished while the run is
   * still going. Two things need it:
   *
   * * The page photographs each stage as it lands, and it can only load a
   *   stage the manifest indexes. Deferring the write to the end deferred
   *   every picture to the end with it.
   * * **Stop** used to throw away every completed stage in the run. The files
   *   were in the cache and no manifest named them, so nothing could find
   *   them and the next run rebuilt them all.
   *
   * The carry-forward is part of it: entries this run has not rebuilt are kept
   * if their files are still there, the same rule the CLI follows and for the
   * same reason -- a one-stage export must not leave a manifest naming one
   * stage and a cache holding twelve.
   */
  const publish = async (): Promise<number> => {
    const all = [...entries];
    const built = new Set(all.map((e) => e.name as string));
    const previous = await sink.readJson<{ stages?: Record<string, unknown>[] }>(
      "manifest.json");
    for (const e of previous?.stages ?? []) {
      if (built.has(e.name as string)) continue;
      const files = ["geometry", "cam", "script"].map((k) => e[k]);
      let ok = true;
      for (const f of files) {
        if (!f || !await sink.exists(`${e.name}/${f}`)) { ok = false; break; }
      }
      if (ok) all.push(e);
    }
    all.sort((a, b) => ((a.stage as number) ?? 0) - ((b.stage as number) ?? 0)
      || String(a.name).localeCompare(String(b.name)));
    // `Date` is banned inside `src/hod2lib/` -- a value the engine cannot get
    // twice belongs to the host -- so the timestamp is stamped here.
    const built_at = new Date().toISOString().replace(/\.\d+Z$/, "Z");
    await writeManifest(sink, all, req.install.label, built_at, {
      unlit: true,
      geometry: "glb",
      source: "exported in the browser",
      cameras: "raw Hermite curves in <stage>.cam.json; the client evaluates "
        + "and draws the rails itself",
    });
    return all.length;
  };

  let indexed = 0;
  for (const n of req.stages) {
    for (const original of req.modes) {
      const stage = await Stage.create(source, { stage: n, original });
      post({ kind: "progress",
             line: `stage ${n}${original ? " (Original Mode)" : ""}` });
      const entry = await buildStage(stage, sink, browserDeflate, {
        glb: true,
        progress: (line) => post({ kind: "progress", line }),
      });
      entries.push(entry);
      const counts = entry.counts as Record<string, number>;
      lost += counts.degraded ?? 0;
      // **Indexed before it is announced.** The page acts on this message by
      // loading the stage to photograph it, and a stage the manifest does not
      // name cannot be loaded.
      indexed = await publish();
      // Named as well as numbered: the screen reports the name and the
      // player photographs the number, and one run may build twelve.
      post({ kind: "stage", name: entry.name as string,
             stage: n, original, counts });
    }
  }

  let bytes = 0;
  for (const f of (await listCached()).values()) bytes += f.size;
  post({ kind: "done", stages: indexed, bytes, degraded: lost });
}

self.onmessage = (ev: MessageEvent<WorkerIn>) => {
  void run(ev.data).catch((err: unknown) => {
    post({ kind: "error",
           message: err instanceof Error ? err.message : String(err) });
  });
};
