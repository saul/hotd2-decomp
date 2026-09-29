/**
 * What `draw_order.ts` and `texture_alpha.ts` both read: instruction bytes at
 * fixed addresses in `Hod2.exe`, the `pol/` corpus, and the stage glTFs of an
 * exported bundle written by this tree's `gltf.ts`.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { BUNDLE_ROOT } from "../lib/bundle_root";
import { hex, type Checker } from "../lib/exe_check";
import type { NodeAssetSource } from "../lib/node_io";
import { BUILDER_FILES } from "../../src/bundle/builder_hash";
import type { ExeTables } from "../../src/hod2lib/exetab";

/** The file offset of `va`, which must be inside a section. */
export function at(exe: ExeTables, va: number): number {
  const r = exe.v2r(va);
  if (r === null) throw new Error(`${hex(va, 8)} is in no section of Hod2.exe`);
  return r;
}

/** `n` bytes of the image at `va`. */
export function bytesAt(exe: ExeTables, va: number, n: number): Uint8Array {
  const r = at(exe, va);
  return exe.data.subarray(r, r + n);
}

/** The image from `lo` up to, not including, `hi`. */
export function range(exe: ExeTables, lo: number, hi: number): Uint8Array {
  return exe.data.subarray(at(exe, lo), at(exe, hi));
}

export function toHex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

/** Whether `needle` occurs anywhere in `hay`. */
export function contains(hay: Uint8Array, needle: Uint8Array): boolean {
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
}

/** `[address, bytes as hex, what they are]`, each read off the disassembly. */
export type Sequence = readonly [number, string, string];

/** Assert that each sequence's bytes are at its address. */
export function checkSequences(chk: Checker, exe: ExeTables,
                               seqs: readonly Sequence[]): void {
  for (const [va, want, what] of seqs) {
    const got = toHex(bytesAt(exe, va, want.length / 2));
    chk.ok(got === want, `${hex(va, 8)} ${what}${got === want ? "" : `: ${got}`}`);
  }
}

/** `pol/*.bin`, sorted by name. */
export async function polFiles(source: NodeAssetSource): Promise<string[]> {
  return (await source.list("pol")).filter((n) => n.endsWith(".bin")).sort();
}

/** A `.glb`'s JSON chunk, parsed, and its BIN chunk. */
export function readGlb(path: string): { doc: GltfDoc; bin: Uint8Array } {
  const b = new Uint8Array(readFileSync(path));
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const jsonLen = dv.getUint32(12, true);
  const doc = JSON.parse(new TextDecoder().decode(b.subarray(20, 20 + jsonLen))) as GltfDoc;
  const binAt = 20 + jsonLen;
  const binLen = binAt + 8 <= b.length ? dv.getUint32(binAt, true) : 0;
  return { doc, bin: b.subarray(binAt + 8, binAt + 8 + binLen) };
}

/** The parts of a glTF document these checks read. */
export interface GltfDoc {
  nodes?: { name?: string; mesh?: number }[];
  meshes?: { primitives: GltfPrimitive[] }[];
  materials?: GltfMaterial[];
  textures?: { source: number }[];
  images?: { name?: string; uri?: string; bufferView?: number }[];
  bufferViews?: { byteOffset?: number; byteLength: number }[];
}

export interface GltfPrimitive {
  material?: number;
  extras?: { hod2_model?: unknown; hod2_sphere?: unknown };
}

export interface GltfMaterial {
  pbrMetallicRoughness?: {
    baseColorFactor?: number[];
    baseColorTexture?: { index: number };
  };
  doubleSided?: boolean;
  alphaMode?: string;
  extras?: { pvr2?: { ignore_texture_alpha?: boolean; pixel_format?: string } };
}

/** The exported bundle, when there is one: {@link BUNDLE_ROOT} with a manifest. */
export function bundleDir(): string | null {
  return existsSync(join(BUNDLE_ROOT, "manifest.json")) ? BUNDLE_ROOT : null;
}

/**
 * Whether the bundle at `bd` was written by this tree's `gltf.ts`: the digest
 * its manifest carries against `BUILDER_FILES`. A bundle from another writer
 * is reported and not held to this tree (L24: stale warns, it does not fail).
 */
export function bundleIsCurrent(bd: string): boolean {
  const m = JSON.parse(readFileSync(join(bd, "manifest.json"), "utf8")) as {
    builder?: { files?: Record<string, string> };
  };
  return m.builder?.files?.["gltf.ts"] === BUILDER_FILES["gltf.ts"];
}

/** `<bd>/stage*\/stage*.glb`, sorted by path. */
export function stageGlbs(bd: string): string[] {
  const out: string[] = [];
  for (const d of readdirSync(bd).filter((n) => n.startsWith("stage")).sort()) {
    const dir = join(bd, d);
    if (!statSync(dir).isDirectory()) continue;
    for (const n of readdirSync(dir).filter((x) => x.startsWith("stage") && x.endsWith(".glb")).sort()) {
      out.push(join(dir, n));
    }
  }
  return out.sort();
}
