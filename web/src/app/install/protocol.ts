/**
 * What the page and the export worker say to each other.
 *
 * One file, imported by both sides, so a message cannot grow a field on one
 * end only. Everything here is structured-cloneable: a directory handle is,
 * and so is a `File`, which is what makes running the export off the main
 * thread cost nothing but this protocol.
 */

/** Which install to read. Exactly one of these is set. */
export interface InstallRef {
  handle?: FileSystemDirectoryHandle;
  files?: File[];
  label: string;
}

export interface ExportRequest {
  kind: "export";
  install: InstallRef;
  /** Stage numbers, 1-6. */
  stages: number[];
  /** `false` is Arcade and `true` is Original Mode; usually both. */
  modes: boolean[];
  /** Clear the cache first. A format bump makes every stage in it stale. */
  fresh: boolean;
}

export type WorkerIn = ExportRequest;

export type WorkerOut =
  | { kind: "progress"; line: string }
  | { kind: "warning"; line: string }
  | { kind: "stage"; name: string; stage: number; original: boolean;
      counts: Record<string, number> }
  | { kind: "done"; stages: number; bytes: number; degraded: number }
  | { kind: "error"; message: string };
