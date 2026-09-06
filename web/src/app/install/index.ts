/**
 * Exporting a bundle from inside the page, and reading one back.
 *
 * The front door for `app/install/`: pick the game directory, run the export
 * in a worker, and point `bundle/load.ts` at the cache the worker filled. The
 * page then loads a stage exactly as it does from the dev server, because the
 * cache has the same tree and the same file names.
 */

import type { BundleSource } from "../../bundle/load";
import { FileListAssetSource, HandleAssetSource, canPickDirectory, clearCache,
         hasThumb, listCached, openCached, readThumb, requestPersist,
         storageEstimate, writeThumb } from "./browser_io";
import { forgetHandle, hasReadPermission, loadHandle, requestReadPermission,
         saveHandle } from "./handle_store";
import type { ExportRequest, InstallRef, WorkerOut } from "./protocol";
import { zipBlob, zipStream } from "./zip";
import type { ZipFile } from "./zip";

export { canPickDirectory, clearCache, hasThumb, readThumb, requestPersist,
         storageEstimate, writeThumb };
export type { InstallRef, WorkerOut };

/**
 * The cache as a {@link BundleSource}.
 *
 * `blob:` URLs are handed out for the GLB and tracked, because three.js takes
 * a URL and a 58 MB blob that nothing revokes is 58 MB the tab keeps until it
 * closes. `release` is called by the stage loader when it drops a scene.
 */
export const cacheSource: BundleSource = {
  async json<T>(path: string): Promise<T> {
    const f = await openCached(path);
    if (!f) throw new Error(`${path} is not in the exported bundle`);
    return JSON.parse(await f.text()) as T;
  },
  async geometry(path: string): Promise<string> {
    const f = await openCached(path);
    if (!f) throw new Error(`${path} is not in the exported bundle`);
    return URL.createObjectURL(f);
  },
  release(url: string): void {
    if (url.startsWith("blob:")) URL.revokeObjectURL(url);
  },
};

/** Whether the cache holds a manifest, i.e. whether there is anything to play. */
export async function hasCachedBundle(): Promise<boolean> {
  return (await openCached("manifest.json")) !== null;
}

/**
 * The install this page is using, until it is reloaded.
 *
 * A `FileSystemDirectoryHandle` can be stored and a `FileList` cannot, so on
 * Firefox and Safari the only thing that survives the pick is this variable.
 * That is the difference between "you may build stages on demand for the rest
 * of this visit" and "you may build the one stage you asked for", and the
 * second is not worth having.
 */
let picked: InstallRef | null = null;

/**
 * Ask the user for their install.
 *
 * Must be called from a click. Returns null if they cancelled, which is not an
 * error and gets no message.
 */
export async function pickInstall(): Promise<InstallRef | null> {
  if (canPickDirectory()) {
    let handle: FileSystemDirectoryHandle;
    try {
      handle = await (globalThis as unknown as {
        showDirectoryPicker(o: { mode: "read"; id: string }):
          Promise<FileSystemDirectoryHandle>;
      }).showDirectoryPicker({ mode: "read", id: "hod2-install" });
    } catch {
      return null;                                    // cancelled
    }
    await saveHandle(handle);
    picked = { handle, label: handle.name };
    return picked;
  }
  // No directory-handle API: a hidden input, and no way to remember it.
  return new Promise((ok) => {
    const input = document.createElement("input");
    input.type = "file";
    (input as HTMLInputElement & { webkitdirectory: boolean })
      .webkitdirectory = true;
    input.onchange = () => {
      const files = [...(input.files ?? [])];
      picked = files.length ? { files, label: folderName(files) } : null;
      ok(picked);
    };
    // Safari fires nothing on cancel, so a cancelled pick simply never
    // resolves. That is the browser's behaviour and inventing a timeout for it
    // would only produce a wrong answer later.
    input.click();
  });
}

function folderName(files: File[]): string {
  const rel = (files[0] as File & { webkitRelativePath?: string })
    .webkitRelativePath;
  return rel ? rel.split("/")[0] : "install";
}

/**
 * The install this browser already knows about, if it still has permission.
 *
 * The one picked in this page's lifetime wins, because it needs no permission
 * check and because on a browser with no directory-handle API it is the only
 * one there is. Otherwise the stored handle, if its grant is still live.
 *
 * Returns null when there is none, when the API is missing, or when the grant
 * has lapsed -- in the last case {@link regrantInstall} can ask for it back,
 * but only from a click.
 */
export async function rememberedInstall(): Promise<InstallRef | null> {
  if (picked) return picked;
  const h = await loadHandle();
  if (!h) return null;
  if (!await hasReadPermission(h)) return null;
  return { handle: h, label: h.name };
}

/** The remembered install, asking for permission again. Needs a click. */
export async function regrantInstall(): Promise<InstallRef | null> {
  const h = await loadHandle();
  if (!h) return null;
  if (!await requestReadPermission(h)) return null;
  picked = { handle: h, label: h.name };
  return picked;
}

/** Forget the remembered install. */
export async function forgetInstall(): Promise<void> {
  picked = null;
  await forgetHandle();
}

/** Whether an install ref points at something that looks like the game. */
export async function looksLikeInstall(ref: InstallRef): Promise<boolean> {
  const src = ref.handle
    ? new HandleAssetSource(ref.handle, ref.label)
    : new FileListAssetSource(ref.files ?? [], ref.label);
  return src.exists("Hod2.exe");
}

export interface ExportHandle {
  /** Stop the worker. The cache keeps whatever stages finished. */
  cancel(): void;
  /** Resolves when the run ends, either way. */
  done: Promise<void>;
}

/**
 * Run an export in a worker, reporting through *on*.
 *
 * The worker is created with `new URL(..., import.meta.url)` so that vite
 * bundles it as its own chunk; that is the documented spelling and the only
 * one that survives a production build.
 */
export function runExport(req: ExportRequest,
                          on: (msg: WorkerOut) => void): ExportHandle {
  const worker = new Worker(new URL("./worker.ts", import.meta.url),
                            { type: "module" });
  let settle: () => void = () => {};
  const done = new Promise<void>((ok) => { settle = ok; });
  worker.onmessage = (ev: MessageEvent<WorkerOut>) => {
    on(ev.data);
    if (ev.data.kind === "done" || ev.data.kind === "error") {
      worker.terminate();
      settle();
    }
  };
  worker.onerror = (ev) => {
    on({ kind: "error", message: ev.message || "the export worker failed" });
    worker.terminate();
    settle();
  };
  worker.postMessage(req);
  return {
    cancel(): void {
      worker.terminate();
      settle();
    },
    done,
  };
}

/**
 * The cached bundle as a zip, streamed to a file the user picks.
 *
 * `showSaveFilePicker` where it exists, because the whole export is 411 MB and
 * a `Blob` that size is a real risk of an out-of-memory tab. Everything else
 * falls back to a blob and an anchor, which is fine for one stage.
 */
export async function downloadCache(prefix = "",
                                    suggested = "hod2-bundle.zip"):
    Promise<boolean> {
  const files: ZipFile[] = [];
  for (const [path, blob] of await listCached()) {
    if (prefix && !path.startsWith(prefix)) continue;
    files.push({ path, blob });
  }
  if (!files.length) return false;
  files.sort((a, b) => a.path.localeCompare(b.path));

  const picker = (globalThis as unknown as {
    showSaveFilePicker?(o: unknown): Promise<FileSystemFileHandle>;
  }).showSaveFilePicker;
  if (typeof picker === "function") {
    let handle: FileSystemFileHandle;
    try {
      handle = await picker({
        suggestedName: suggested,
        types: [{ description: "Zip archive",
                  accept: { "application/zip": [".zip"] } }],
      });
    } catch {
      return false;                                   // cancelled
    }
    const w = await handle.createWritable();
    await zipStream(files).pipeTo(w);
    return true;
  }

  const url = URL.createObjectURL(await zipBlob(files));
  const a = document.createElement("a");
  a.href = url;
  a.download = suggested;
  a.click();
  // The click is synchronous but the fetch it starts is not, so the URL is
  // given back on the next turn rather than immediately.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return true;
}
