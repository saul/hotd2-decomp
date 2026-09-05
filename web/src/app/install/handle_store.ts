/**
 * Remembering which install the user chose, across reloads.
 *
 * A `FileSystemDirectoryHandle` survives structured clone, so IndexedDB can
 * hold one. **Its permission does not.** A reload gets the handle back with
 * its permission state at `prompt`, and reading through it throws until
 * `requestPermission` is called -- which must happen inside a user gesture, so
 * this is offered as a button and not done on load.
 *
 * IndexedDB rather than `localStorage` for the obvious reason: a handle is a
 * structured-clone object and `localStorage` holds strings. It is also the
 * only browser storage this app uses that is not the bundle cache, which is
 * why it is thirty lines of its own rather than a shared wrapper.
 */

const DB = "hod2-install";
const STORE = "handles";
const KEY = "game-dir";

function open(): Promise<IDBDatabase> {
  return new Promise((ok, fail) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => ok(req.result);
    req.onerror = () => fail(req.error);
  });
}

function run<T>(mode: IDBTransactionMode,
                fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then((db) => new Promise<T>((ok, fail) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    req.onsuccess = () => ok(req.result);
    req.onerror = () => fail(req.error);
    tx.oncomplete = () => db.close();
  }));
}

export async function saveHandle(h: FileSystemDirectoryHandle): Promise<void> {
  try {
    await run("readwrite", (s) => s.put(h, KEY));
  } catch {
    // A private window may refuse IndexedDB outright. The picker still works;
    // it just has to be used again next time.
  }
}

export async function loadHandle():
    Promise<FileSystemDirectoryHandle | null> {
  try {
    return (await run<FileSystemDirectoryHandle | undefined>(
      "readonly", (s) => s.get(KEY))) ?? null;
  } catch {
    return null;
  }
}

export async function forgetHandle(): Promise<void> {
  try {
    await run("readwrite", (s) => s.delete(KEY));
  } catch {
    // As above: nothing stored is the same end state as nothing readable.
  }
}

type Perm = "granted" | "denied" | "prompt";

interface Permissioned {
  queryPermission(o: { mode: "read" | "readwrite" }): Promise<Perm>;
  requestPermission(o: { mode: "read" | "readwrite" }): Promise<Perm>;
}

/** Whether this handle can already be read, without prompting. */
export async function hasReadPermission(
    h: FileSystemDirectoryHandle): Promise<boolean> {
  const p = h as unknown as Permissioned;
  if (typeof p.queryPermission !== "function") return true;
  return (await p.queryPermission({ mode: "read" })) === "granted";
}

/**
 * Ask for read permission. **Must be called from a user gesture** -- a click,
 * not a load handler -- or the browser refuses without prompting.
 */
export async function requestReadPermission(
    h: FileSystemDirectoryHandle): Promise<boolean> {
  const p = h as unknown as Permissioned;
  if (typeof p.requestPermission !== "function") return true;
  return (await p.requestPermission({ mode: "read" })) === "granted";
}
