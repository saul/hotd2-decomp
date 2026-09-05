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
      post({ kind: "stage", name: entry.name as string, counts });
    }
  }

  // The entries this run did not rebuild, carried forward if their files are
  // still in the cache -- the same rule the CLI follows, and for the same
  // reason: a one-stage export must not leave a manifest naming one stage and
  // a cache holding twelve.
  const built = new Set(entries.map((e) => e.name as string));
  const previous = await sink.readJson<{ stages?: Record<string, unknown>[] }>(
    "manifest.json");
  for (const e of previous?.stages ?? []) {
    if (built.has(e.name as string)) continue;
    const files = ["geometry", "cam", "script"].map((k) => e[k]);
    let ok = true;
    for (const f of files) {
      if (!f || !await sink.exists(`${e.name}/${f}`)) { ok = false; break; }
    }
    if (ok) entries.push(e);
  }
  entries.sort((a, b) => ((a.stage as number) ?? 0) - ((b.stage as number) ?? 0)
    || String(a.name).localeCompare(String(b.name)));

  // `Date` is banned inside `src/hod2lib/` -- a value the engine cannot get
  // twice belongs to the host -- so the timestamp is stamped here.
  const built_at = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  await writeManifest(sink, entries, req.install.label, built_at, {
    unlit: true,
    geometry: "glb",
    source: "exported in the browser",
    cameras: "raw Hermite curves in <stage>.cam.json; the client evaluates "
      + "and draws the rails itself",
  });

  let bytes = 0;
  for (const f of (await listCached()).values()) bytes += f.size;
  post({ kind: "done", stages: entries.length, bytes, degraded: lost });
}

self.onmessage = (ev: MessageEvent<WorkerIn>) => {
  void run(ev.data).catch((err: unknown) => {
    post({ kind: "error",
           message: err instanceof Error ? err.message : String(err) });
  });
};
