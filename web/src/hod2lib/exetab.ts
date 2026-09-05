/**
 * Tables compiled into Hod2.exe. The port of `tools/hod2lib/exetab.py`.
 *
 * The tex/ files carry no metadata at all. Each bank's texture layout lives in
 * a table compiled into the executable's .rdata, and the game looks it up by
 * bank index:
 *
 *     descriptor_table = *(u32 *)(0x0055B9B8 + bank_index * 4)
 *     descriptor       = descriptor_table + texture_id * 16
 *
 * Reverse-engineered from FUN_00418E40 (bank setup) and FUN_004AC980
 * (per-model texture binding); the decoder at FUN_004AC270 confirms the field
 * meanings.
 *
 * Descriptor, 16 bytes:
 *
 *     +0x00  u16  width
 *     +0x02  u16  height
 *     +0x04  u8   pixel format   (0 ARGB1555, 1 RGB565, 2 ARGB4444)
 *     +0x05  u8   data layout    (PVR code: 1 twiddled, 3 VQ,
 *                                 9 rectangle/linear, 13 twiddled rectangle)
 *     +0x06  u16  reserved
 *     +0x08  u32  byte offset into the texture bank
 *     +0x0C  u32  global texture slot id
 *
 * A row of all zeros terminates the table.
 *
 * **Everything here is memoised that the reference implementation recomputes.**
 * `asset_slots()` walks four hundred pointer tables and is called from inside
 * three loops; Python pays that cost once per call and this pays it once. The
 * tables are read-only data in a file that does not change while an export
 * runs, so the only observable difference is the time.
 */

import { f32, i16, i32, latin1, u16, u32, u32s } from "./bytes";
import { sha256Hex } from "./sha256";

export const BANK_PTR_TABLE = 0x0055b9b8;
export const TEX_NAME_TABLE = 0x004d1410;
export const IMAGE_BASE = 0x00400000;
export const MAX_BANKS = 512;

/** PVR data layout codes. */
export const LAYOUT_TWIDDLED = 1;
export const LAYOUT_VQ = 3;
export const LAYOUT_RECTANGLE = 9;
export const LAYOUT_TWIDDLED_RECT = 13;

export class TexEntry {
  constructor(
    readonly index: number,
    readonly width: number,
    readonly height: number,
    readonly pixfmt: number,
    readonly layout: number,
    readonly offset: number,
    readonly slot: number,
  ) {}

  get vq(): boolean { return this.layout === LAYOUT_VQ; }

  get twiddled(): boolean {
    return this.layout === LAYOUT_TWIDDLED || this.layout === LAYOUT_TWIDDLED_RECT;
  }
}

/**
 * SHA-256 of the `Hod2.exe` every address in this file was read from, and the
 * one `manifest.csv` records. See `docs/re/provenance.md`.
 *
 * It is the retail 2001-05-09 build with one byte changed -- `JZ` -> `JNZ` at
 * `0x004A6857`, a no-CD patch -- because that is the copy installed here and
 * therefore the copy `ghidra/annotations` was built against.
 *
 * **The gate exists because the failure mode is silence.** This module reads
 * some seventy hard virtual addresses; against a different build every one of
 * them still resolves to *something*, and what comes back is plausible garbage
 * rather than an error. Everything downstream then inherits it.
 */
export const HOD2_EXE_SHA256 =
  "1d5e056711509c700724ad2b35de1938d7069c68423e3b4dd16ec19d56125524";
export const HOD2_EXE_SIZE = 1699840;

export class ExeTablesError extends Error {
  override name = "ExeTablesError";
}

interface Section {
  name: string;
  va: number;
  vs: number;
  ra: number;
  rs: number;
}

export interface CivCommand {
  op: number;
  args: (number | null)[];
  scripts?: number[];
  point?: number[] | null;
  radius?: number;
  pose?: (number | null)[];
  item?: number;
  itemTable?: number[][];
  sounds?: number[][];
}

export interface CivItem {
  bone: number;
  slot: number;
  kind: number;
  /**
   * `null`, not absent, for a kind with no second asset. The reference
   * implementation writes `dict.get(kind)`, which is a key holding `None`, and
   * a dropped key is a different bundle.
   */
  extra: number | null;
  rot: number[];
  sets: number[][];
}

export interface SkeletonNode {
  slot: number;
  offset: [number, number, number];
  bone: number;
  index: number;
  depth: number;
  parent: number | null;
  children: number;
}

/** Reads the compiled-in tables out of Hod2.exe. */
export class ExeTables {
  private sections: Section[];
  private texCache = new Map<string, TexEntry[]>();
  private memo = new Map<string, unknown>();
  private civItems: CivItem[] = [];
  /** bank name (without .bin) -> descriptor table VA. */
  banks: Map<string, number>;

  private constructor(readonly data: Uint8Array) {
    this.sections = this.parseSections();
    this.banks = this.parseBanks();
  }

  /**
   * Read the tables out of *data*, refusing a build these addresses do not
   * describe.
   *
   * Async because the build gate is a SHA-256 and `crypto.subtle` is the only
   * digest both hosts have. The reference implementation's constructor is
   * synchronous for the same reason Python's is: it has `hashlib`.
   */
  static async create(data: Uint8Array, label: string,
                      allowAnyBuild = false): Promise<ExeTables> {
    if (!allowAnyBuild) {
      const got = await sha256Hex(data);
      if (got !== HOD2_EXE_SHA256) {
        throw new ExeTablesError(
          `${label} is not the build these tables were read from.\n`
          + `  expected sha256 ${HOD2_EXE_SHA256} (${HOD2_EXE_SIZE} bytes)\n`
          + `  got      sha256 ${got} (${data.length} bytes)\n`
          + "This module reads ~70 hard virtual addresses; against another "
          + "build they resolve to plausible garbage rather than failing, so "
          + "it refuses instead. See docs/re/provenance.md. Pass "
          + "allowAnyBuild only if you are deliberately probing a different "
          + "executable and expect the results to be wrong.");
      }
    }
    return new ExeTables(data);
  }

  private cached<T>(key: string, build: () => T): T {
    if (this.memo.has(key)) return this.memo.get(key) as T;
    const v = build();
    this.memo.set(key, v);
    return v;
  }

  // -- PE plumbing ----------------------------------------------------

  private parseSections(): Section[] {
    const d = this.data;
    const pe = u32(d, 0x3c);
    const nsec = u16(d, pe + 6);
    const osz = u16(d, pe + 20);
    const out: Section[] = [];
    let off = pe + 24 + osz;
    for (let i = 0; i < nsec; i++) {
      let name = latin1(d, off, 8);
      const z = name.indexOf("\0");
      if (z >= 0) name = name.slice(0, z);
      out.push({ name, vs: u32(d, off + 8), va: u32(d, off + 12),
                 rs: u32(d, off + 16), ra: u32(d, off + 20) });
      off += 40;
    }
    return out;
  }

  /**
   * Virtual address to file offset, or null.
   *
   * Public, like the reference implementation's `_v2r`, because five sibling
   * modules read tables this one does not name -- `arcscript`, `approach`,
   * `combat`, `class31`, `props`. They are the same package; the underscore
   * in Python says "not for callers outside it" and so does this comment.
   */
  v2r(va: number): number | null {
    for (const s of this.sections) {
      const lo = IMAGE_BASE + s.va;
      if (lo <= va && va < lo + Math.max(s.vs, s.rs)) return s.ra + (va - lo);
    }
    return null;
  }

  ru32(va: number): number | null {
    const r = this.v2r(va);
    if (r === null || r + 4 > this.data.length) return null;
    return u32(this.data, r);
  }

  ru16(va: number): number | null {
    const r = this.v2r(va);
    if (r === null || r + 2 > this.data.length) return null;
    return u16(this.data, r);
  }

  rf32(va: number): number | null {
    const r = this.v2r(va);
    if (r === null || r + 4 > this.data.length) return null;
    return f32(this.data, r);
  }

  ri32(va: number): number | null {
    const v = this.ru32(va);
    return v === null ? null : (v >= 0x80000000 ? v - 0x100000000 : v);
  }

  /** A NUL-terminated ASCII string at *va*, or null if it is not one. */
  cstr(va: number): string | null {
    const r = this.v2r(va);
    if (r === null) return null;
    let end = r;
    while (end < this.data.length && this.data[end] !== 0) end++;
    if (end >= this.data.length || end - r > 64) return null;
    for (let i = r; i < end; i++) {
      // not-a-loss: the decode is the test. "Are these bytes a string?" is
      // answered No, which is a reading, not a failure to read.
      if (this.data[i] > 0x7f) return null;
    }
    return latin1(this.data, r, end - r);
  }

  // -- tables ---------------------------------------------------------

  private parseBanks(): Map<string, number> {
    const banks = new Map<string, number>();
    for (let i = 0; i < MAX_BANKS; i++) {
      const namePtr = this.ru32(TEX_NAME_TABLE + i * 4);
      const descPtr = this.ru32(BANK_PTR_TABLE + i * 4);
      if (!namePtr || !descPtr) continue;
      const name = this.cstr(namePtr);
      if (!name || !name.endsWith(".bin")) continue;
      const stem = name.slice(0, -4);
      if (!banks.has(stem)) banks.set(stem, descPtr);
    }
    return banks;
  }

  /** Descriptor list for a bank, or `[]` if the bank is unknown. */
  entries(bank: string): TexEntry[] {
    const hit = this.texCache.get(bank);
    if (hit) return hit;

    const va = this.banks.get(bank);
    const out: TexEntry[] = [];
    if (va !== undefined) {
      const r = this.v2r(va);
      if (r !== null) {
        for (let i = 0; i < 4096; i++) {
          const o = r + i * 16;
          if (o + 16 > this.data.length) break;
          const w = u16(this.data, o);
          const h = u16(this.data, o + 2);
          const pf = this.data[o + 4];
          const lay = this.data[o + 5];
          const off = u32(this.data, o + 8);
          const slot = u32(this.data, o + 12);
          if (w === 0 && h === 0 && off === 0 && slot === 0) break;
          if (w === 0 || h === 0 || w > 4096 || h > 4096) break;
          out.push(new TexEntry(i, w, h, pf, lay, off, slot));
        }
      }
    }
    this.texCache.set(bank, out);
    return out;
  }

  // -- scene / event routing ------------------------------------------
  //
  // The event system indexes everything by "scene", a small id held in
  // DAT_009A1A08. Three parallel tables in .data key off it:
  //
  //   0x00579928   s32  scene -> index into the evt/ filename table
  //                     (-1 = the scene has no file of its own)
  //   0x004D1C7C   ptr  evt/ filename table
  //   0x00597890   ptr  scene -> route table (block flow graph)
  //
  // A route record is 8 bytes, read by FUN_0045F000 when a block's step list
  // runs out:
  //
  //   +0x00  s16  kind   0 = go to next[0]
  //                      1 = branch, go to next[branch_choice]
  //                      2 = end of scene
  //   +0x02  s16  next[0..2]
  //
  // The record count is not stored; consecutive scenes' table pointers are
  // adjacent in address order, so each table ends where the next begins.

  static readonly SCENE_FILE_INDEX = 0x00579928;
  static readonly EVT_NAME_TABLE = 0x004d1c7c;
  static readonly SCENE_ROUTE_TABLE = 0x00597890;
  static readonly SCENE_COUNT = 12;

  static readonly ROUTE_GOTO = 0;
  static readonly ROUTE_BRANCH = 1;
  static readonly ROUTE_END = 2;

  /** evt/ filename for a scene, or null if it has no file. */
  sceneEvtFile(scene: number): string | null {
    const idx = this.ru32(ExeTables.SCENE_FILE_INDEX + scene * 4);
    if (idx === null || idx === 0xffffffff) return null;
    const ptr = this.ru32(ExeTables.EVT_NAME_TABLE + idx * 4);
    return ptr ? this.cstr(ptr) : null;
  }

  /**
   * Route records for a scene: `[[kind, next0, next1, next2], ...]`.
   *
   * The list length is also the number of event blocks the scene's evt file
   * must supply, which is what makes it useful to the evt parser -- the root
   * pointer array uses -1 as a *hole* marker, not a terminator, so it cannot
   * be sized from the file alone.
   */
  sceneRoutes(scene: number): [number, number, number, number][] {
    return this.cached(`routes:${scene}`, () => {
      const starts: number[] = [];
      for (let s = 0; s < ExeTables.SCENE_COUNT; s++) {
        starts.push(this.ru32(ExeTables.SCENE_ROUTE_TABLE + s * 4) ?? 0);
      }
      const va = starts[scene];
      if (!va) return [];
      // The tables sit contiguously below the pointer table itself, so each
      // one ends where the next-highest starts.
      const after = starts.filter((v) => v > va);
      after.push(ExeTables.SCENE_ROUTE_TABLE);
      const end = Math.min(...after);
      const r = this.v2r(va);
      if (r === null) return [];
      const n = Math.floor((end - va) / 8);
      const out: [number, number, number, number][] = [];
      for (let i = 0; i < n; i++) {
        const o = r + i * 8;
        out.push([i16(this.data, o), i16(this.data, o + 2),
                  i16(this.data, o + 4), i16(this.data, o + 6)]);
      }
      return out;
    });
  }

  sceneBlockCount(scene: number): number {
    return this.sceneRoutes(scene).length;
  }

  // -- asset slots and streaming --------------------------------------

  static readonly POL_NAME_TABLE = 0x004d0ef4;
  static readonly POL_ENTRY_COUNT = 0x004e803c;
  static readonly POL_SLOT_LIST = 0x004e794c;
  static readonly SLOT_TO_POL = 0x004e83b4;
  static readonly MAX_POL_FILES = 400;

  /** pol file index -> `[filename, entry count]`. Live entries only. */
  polFiles(): Map<number, [string, number]> {
    return this.cached("polFiles", () => {
      const out = new Map<number, [string, number]>();
      for (let i = 0; i < ExeTables.MAX_POL_FILES; i++) {
        const ptr = this.ru32(ExeTables.POL_NAME_TABLE + i * 4);
        if (!ptr) continue;
        const name = this.cstr(ptr);
        if (!name || !name.endsWith(".bin")) continue;
        const cnt = this.ru16(ExeTables.POL_ENTRY_COUNT + i * 2) ?? 0;
        if (cnt) out.set(i, [name, cnt]);
      }
      return out;
    });
  }

  // -- class 0x10's civilian scripts -----------------------------------

  static readonly CIVILIAN_SCRIPT_TABLE = 0x005702a8;

  /**
   * Command length in dwords, from `CivilianRunScript`'s own switch. Every
   * opcode not listed here consumes two dwords, which is that switch's
   * fall-through `piVar8 = param_2 + 2`.
   */
  static readonly CIVILIAN_CMD_LEN: Record<number, number> = {
    0: 3, 1: 4, 5: 3, 0x0d: 3, 0x13: 3, 0x16: 3, 0x1a: 3,
    0x1f: 3, 0x21: 3, 0x24: 3, 0x25: 3, 0x26: 3, 0x2b: 6,
  };

  /** The opcodes whose operands are pointers to another command stream. */
  static readonly CIVILIAN_SCRIPT_OPS: Record<number, number[]> = {
    0x0e: [1], 0x0f: [1], 0x1e: [1], 0x1f: [1, 2],
  };

  static readonly CIVILIAN_ITEM_BYTES = 0x7c;

  /** `CivilianDrawHeldItems`' second-asset switch, by the record's kind. */
  static readonly CIVILIAN_ITEM_EXTRA: Record<number, number> = {
    3: 0x10a5, 4: 0x10a7, 5: 0x10a9, 6: 0x10a3,
    7: 0x107f, 8: 0x1081, 9: 0x1083, 10: 0x107d,
    0x0e: 0x1098, 0x0f: 0x1099, 0x10: 0x108c, 0x12: 0x108b,
  };

  /**
   * Op 0x10 installs a native per-frame hook and **the hook decides the
   * command's length**: `CivilianRunScript` calls it as
   * `next = hook(obj, cmd + 2)` and takes the pointer it returns.
   *
   * An unlisted hook is an error rather than a guess: its length is not
   * knowable without reading it, and guessing desynchronises the stream.
   */
  static readonly CIVILIAN_HOOK_LEN: Record<number, number> = {
    0: 2, 0x0048d9f0: 2, 0x0048da90: 2, 0x0048db90: 3, 0x0048dbd0: 5,
  };

  private civPoint(va: number | null): number[] | null {
    if (va === null || va < IMAGE_BASE) return null;
    const pt = [0, 1, 2].map((i) => this.rf32(va + i * 4));
    return pt.some((c) => c === null) ? null : (pt as number[]);
  }

  /**
   * Every class-0x10 command stream in the exe, decoded.
   *
   * The check that the length table is right is that **every** stream
   * reachable from the 67 table entries decodes with every opcode in
   * `0..0x2D`: one wrong length desynchronises the dword stream and the
   * opcodes go out of range within a command or two.
   */
  civilianScripts(): { entries: number[]; scripts: CivCommand[][];
                       items: CivItem[] } {
    return this.cached("civilianScripts", () => {
      const tab = ExeTables.CIVILIAN_SCRIPT_TABLE;
      const entryVa: number[] = [];
      for (;;) {
        const v = this.ru32(tab + entryVa.length * 4);
        if (v === null || !(IMAGE_BASE <= v && v < tab)) break;
        entryVa.push(v);
      }

      // Work list: decode a stream, queue every stream it points at.
      const raw = new Map<number, { op: number; args: (number | null)[] }[]>();
      const pending = [...entryVa];
      while (pending.length) {
        const va = pending.shift()!;
        if (raw.has(va)) continue;
        const cmds: { op: number; args: (number | null)[] }[] = [];
        raw.set(va, cmds);
        let p = va;
        for (let i = 0; i < 4096; i++) {
          const op = this.ri32(p);
          if (op === null || !(op >= 0 && op <= 0x2d)) {
            throw new Error(
              `civilian script ${hex(va)}: opcode ${op} at ${hex(p)}`
              + " -- the command length table is wrong");
          }
          let n = ExeTables.CIVILIAN_CMD_LEN[op] ?? 2;
          if (op === 0x10) {
            const hook = this.ru32(p + 4) ?? 0;
            if (!(hook in ExeTables.CIVILIAN_HOOK_LEN)) {
              throw new Error(
                `civilian script ${hex(va)}: op 0x10 at ${hex(p)} installs an `
                + `unread hook ${hex(hook)} -- its command length is not `
                + "knowable");
            }
            n = ExeTables.CIVILIAN_HOOK_LEN[hook];
          }
          if (op === 0x2d) {
            cmds.push({ op, args: [] });
            break;
          }
          const args: (number | null)[] = [];
          for (let k = 1; k < n; k++) args.push(this.ri32(p + 4 * k));
          cmds.push({ op, args });
          for (const j of ExeTables.CIVILIAN_SCRIPT_OPS[op] ?? []) {
            const t = args[j - 1];
            if (t) pending.push(t);
          }
          p += 4 * n;
        }
      }

      const order = [...raw.keys()].sort((a, b) => a - b);
      const index = new Map<number, number>();
      order.forEach((va, i) => index.set(va, i));
      const items = new Map<number, number>();   // record address -> index
      this.civItems = [];
      const scripts: CivCommand[][] = [];
      for (const va of order) {
        const out: CivCommand[] = [];
        for (const c of raw.get(va)!) {
          const op = c.op;
          const args = c.args;
          const d: CivCommand = { op, args };
          for (const j of ExeTables.CIVILIAN_SCRIPT_OPS[op] ?? []) {
            (d.scripts ??= []).push(index.get(args[j - 1] as number) ?? -1);
          }
          if ((op === 5 || op === 0x26) && (args[0] ?? 0) > 0) {
            d.point = this.civPoint(args[0]);
          } else if (op === 6) {
            d.point = this.civPoint(args[0]);
          }
          if (op === 5) d.radius = asFloatBits(args[1]);
          if (op === 0x16) d.radius = asFloatBits(args[0]);
          if (op === 0x18 && args[0]) {
            d.pose = [0, 1, 2, 3, 4, 5].map((i) => this.rf32(args[0]! + i * 4));
          }
          if ((op === 0x13 || op === 0x14) && (args[0] ?? 0) > 0) {
            d.item = this.civItem(args[0]!, items);
          }
          if (op === 0x15 && args[0]) {
            d.itemTable = this.civItemTable(args[0], items);
          }
          if (op === 0x22 && args[0]) {
            const snd: number[][] = [];
            let q = args[0];
            while (snd.length < 64) {
              const sid = this.ru32(q);
              if (sid === null || sid === 0xffffffff) break;
              snd.push([sid, this.ri32(q + 4) ?? 0]);
              q += 8;
            }
            d.sounds = snd;
          }
          out.push(d);
        }
        scripts.push(out);
      }
      return { entries: entryVa.map((v) => index.get(v)!), scripts,
               items: this.civItems };
    });
  }

  /** Decode one held-item record, memoised; returns its index. */
  private civItem(va: number, seen: Map<number, number>): number {
    const hit = seen.get(va);
    if (hit !== undefined) return hit;
    const w: (number | null)[] = [];
    for (let i = 0; i < 31; i++) w.push(this.ri32(va + 4 * i));
    if (w.some((v) => v === null)) return -1;
    const sets: number[][] = [];
    for (let k = 0; k < 6; k++) {
      sets.push([0, 1, 2, 3].map((j) => asFloatBits(w[7 + k * 4 + j])));
    }
    seen.set(va, this.civItems.length);
    this.civItems.push({
      bone: w[0]!, slot: w[1]! & 0xffff, kind: w[2]!,
      extra: ExeTables.CIVILIAN_ITEM_EXTRA[w[2]!] ?? null,
      rot: [w[3]!, w[4]!, w[5]!], sets,
    });
    return seen.get(va)!;
  }

  /** Op 0x15's `{weight, record}` list, terminated by weight -1. */
  private civItemTable(va: number, seen: Map<number, number>): number[][] {
    const out: number[][] = [];
    while (out.length < 32) {
      const w = this.ri32(va);
      if (w === null || w === -1) break;
      const rec = this.ri32(va + 4);
      out.push([w, rec ? this.civItem(rec, seen) : -1]);
      va += 8;
    }
    return out;
  }

  /**
   * asset slot id -> `[pol filename, entry index within that file]`.
   *
   * The entry index is the slot's position in the file's slot list, which is
   * also its index in the container's offset table -- so it selects a model
   * directly.
   */
  assetSlots(): Map<number, [string, number]> {
    return this.cached("assetSlots", () => {
      const out = new Map<number, [string, number]>();
      for (const [fi, [name, cnt]] of this.polFiles()) {
        const lst = this.ru32(ExeTables.POL_SLOT_LIST + fi * 4);
        if (!lst) continue;
        const r = this.v2r(lst);
        if (r === null) continue;
        for (let k = 0; k < cnt; k++) {
          const slot = i16(this.data, r + k * 2);
          if (!out.has(slot)) out.set(slot, [name, k]);
        }
      }
      return out;
    });
  }

  slotPolFile(slot: number): string | null {
    const fi = this.ru16(ExeTables.SLOT_TO_POL + slot * 2);
    if (fi === null) return null;
    const rec = this.polFiles().get(fi);
    return rec ? rec[0] : null;
  }

  // -- cam/ path slot binding -----------------------------------------
  //
  // NOTE THE STRIDES. They differ, and reading the count table with a u32
  // stride silently yields garbage rather than failing:
  //
  //   0x004C476C   u16   [file * 2]   path count        <- TWO bytes
  //   0x004C470C   u32   [file * 4]   -> s16[count], slot id of each entry
  //   0x004C479C   s8    [slot * 1]   owning cam file index
  //   0x004D1BC8   u32   [file * 4]   filename

  static readonly CAM_NAME_TABLE = 0x004d1bc8;
  static readonly CAM_PATH_COUNT = 0x004c476c;    // u16 stride
  static readonly CAM_SLOT_LIST = 0x004c470c;     // u32 stride -> s16[]
  static readonly SLOT_TO_CAM = 0x004c479c;       // s8 stride
  static readonly MAX_CAM_FILES = 32;

  /** cam file index -> `[filename, path count]`. */
  camFiles(): Map<number, [string, number]> {
    return this.cached("camFiles", () => {
      const out = new Map<number, [string, number]>();
      for (let i = 0; i < ExeTables.MAX_CAM_FILES; i++) {
        const ptr = this.ru32(ExeTables.CAM_NAME_TABLE + i * 4);
        if (!ptr) continue;
        const name = this.cstr(ptr);
        if (!name || !name.endsWith(".bin")) continue;
        const cnt = this.ru16(ExeTables.CAM_PATH_COUNT + i * 2) ?? 0;
        if (cnt) out.set(i, [name, cnt]);
      }
      return out;
    });
  }

  /** global path slot id -> `[cam filename, path index within that file]`. */
  camPathSlots(): Map<number, [string, number]> {
    return this.cached("camPathSlots", () => {
      const out = new Map<number, [string, number]>();
      for (const [fi, [name, cnt]] of this.camFiles()) {
        const lst = this.ru32(ExeTables.CAM_SLOT_LIST + fi * 4);
        if (!lst) continue;
        const r = this.v2r(lst);
        if (r === null) continue;
        for (let k = 0; k < cnt; k++) {
          const slot = i16(this.data, r + k * 2);
          if (slot >= 0 && !out.has(slot)) out.set(slot, [name, k]);
        }
      }
      return out;
    });
  }

  static readonly CHARACTER_BONE_COUNTS = 0x004e0724;
  static readonly MOTION_PLAY_LENGTH = 0x004e07d0;
  static readonly MOTION_BANK_OF = 0x004e2c40;
  static readonly MOTION_BANK_NAME = 0x004d1b00;
  static readonly MOTION_BANK_IDS = 0x004e2b14;
  static readonly MOTION_BANK_COUNT = 0x004e2bdc;
  static readonly CHARACTER_SKELETONS = 0x004e0430;

  static readonly SOUND_RECORDS = 0x005845f8;
  static readonly SOUND_RECORD_STRIDE = 0x34;

  static readonly BREAKABLE_COUNTS = 0x00593d14;
  static readonly BREAKABLE_GROUPS = 0x00593cf0;
  static readonly BREAKABLE_HULL = 0x005937f8;
  static readonly BREAKABLE_HULL_POINTS = 96;
  static readonly PROP_KIND_PARAMS = 0x00593db8;
  static readonly PROP_KIND_COUNT = 11;
  static readonly FALLING_HULL = 0x00594788;
  static readonly FALLING_HULL_POINTS = 48;
  static readonly CLASS41_CTORS = 0x00593580;
  static readonly CLASS41_UPDATES = 0x005936bc;
  static readonly CLASS41_TYPES = 79;
  static readonly GENERIC_PROP_CTOR = 0x00461cf0;
  /** Height of one stack level, from the constructor's own multiply. */
  static readonly BREAKABLE_LEVEL_HEIGHT = 7.540296;

  static readonly CAM_PATH_LENGTH = 0x00576d38;

  /**
   * The node tree for a character type, flattened, parents first.
   *
   * The node layout, from `FUN_004107E0`, which does
   * `MatrixTranslate(node[1], node[2], node[3]); RotZ; RotY; RotX` with the
   * rotations coming from the motion frame at `bone * 6`:
   *
   *     +0x00  u32 asset slot
   *     +0x04  f32 bone offset x      <- the bind pose, and it is HERE,
   *     +0x08  f32 bone offset y         in the EXE, not in the motion data
   *     +0x0C  f32 bone offset z
   *     +0x10  u32 (always zero in this build)
   *     +0x14  u16 bone index, 1-based; bone 0 is the object root
   *     +0x16  u16 child count
   *     +0x18  u32 children[]
   *
   * Returns an empty list for a type with no skeleton.
   */
  characterSkeleton(charType: number): SkeletonNode[] {
    return this.cached(`skeleton:${charType}`, () => {
      const base = this.v2r(ExeTables.CHARACTER_SKELETONS);
      if (base === null || !(charType >= 0 && charType < 0x100)) return [];
      const ptr = u32(this.data, base + charType * 4);
      const off = this.v2r(ptr);
      if (off === null || off + 0x18 > this.data.length) return [];
      const roots = i16(this.data, off + 0x16);
      if (!(roots > 0 && roots < 64)) return [];
      const out: SkeletonNode[] = [];
      const seen = new Set<number>();

      const walk = (nodePtr: number, depth: number,
                    parent: number | null): void => {
        const o = this.v2r(nodePtr);
        if (o === null || seen.has(nodePtr) || depth > 12) return;
        if (o + 0x18 > this.data.length) return;
        seen.add(nodePtr);
        const slot = u32(this.data, o);
        const offset: [number, number, number] =
          [f32(this.data, o + 4), f32(this.data, o + 8), f32(this.data, o + 12)];
        const idx = u16(this.data, o + 0x14);
        const n = u16(this.data, o + 0x16);
        const me = out.length;
        out.push({ slot, offset, bone: idx, index: idx, depth, parent,
                   children: n });
        if (n > 64 || o + 0x18 + n * 4 > this.data.length) return;
        for (let i = 0; i < n; i++) {
          const cp = u32(this.data, o + 0x18 + i * 4);
          if (cp) walk(cp, depth + 1, me);
        }
      };

      for (let i = 0; i < roots; i++) {
        walk(u32(this.data, off + 0x18 + i * 4), 0, null);
      }
      return out;
    });
  }

  /** Bones in a character's motion frame, from `DAT_004E0724`. */
  characterBoneCount(charType: number): number {
    const r = this.v2r(ExeTables.CHARACTER_BONE_COUNTS);
    if (r === null || !(charType >= 0 && charType < 0x200)) return 0;
    return u16(this.data, r + charType * 2);
  }

  /** `{bank id: [filename, [motion ids]]}` for the real motion banks. */
  motionBanks(): Map<number, [string, number[]]> {
    return this.cached("motionBanks", () => {
      const out = new Map<number, [string, number[]]>();
      const fn = this.v2r(ExeTables.MOTION_BANK_NAME);
      const ip = this.v2r(ExeTables.MOTION_BANK_IDS);
      const cp = this.v2r(ExeTables.MOTION_BANK_COUNT);
      if (fn === null || ip === null || cp === null) return out;
      for (let b = 0; b < 64; b++) {
        const p = u32(this.data, fn + b * 4);
        const name = p ? this.cstr(p) : null;
        const n = u16(this.data, cp + b * 2);
        if (!name || !(n > 0 && n <= 4096)) continue;
        const io = this.v2r(u32(this.data, ip + b * 4));
        if (io === null) continue;          // a camera-path entry, not a bank
        const ids: number[] = [];
        for (let k = 0; k < n; k++) ids.push(i16(this.data, io + k * 2));
        out.set(b, [name, ids]);
      }
      return out;
    });
  }

  /** Which bank holds a motion, from `DAT_004E2C40`. */
  motionBankOf(motionId: number): number | null {
    const r = this.v2r(ExeTables.MOTION_BANK_OF);
    if (r === null || r + motionId >= this.data.length) return null;
    return this.data[r + motionId];
  }

  /**
   * `g_motion_play_length[motionId]` -- the clock the scripts compare to.
   *
   * **Not the frame count.** The animation clock ticks once per 60 Hz frame
   * over data authored at 30 Hz, so this runs at about twice the frames:
   * across the 220 motions the shipped bundles bake it is `2n - 2` for 91 of
   * them and `2n - 3` for the other 129, and never anything else.
   *
   * Everything the scripts express in clip frames is in *these* units.
   * Comparing them against the authored frame count silently loses every cue
   * past halfway, which is what left the civilians alive.
   */
  motionPlayLength(motionId: number): number | null {
    const r = this.v2r(ExeTables.MOTION_PLAY_LENGTH);
    if (r === null || motionId < 0
        || r + motionId * 2 + 2 > this.data.length) return null;
    return i16(this.data, r + motionId * 2);
  }

  /**
   * The pol file a character type's parts live in, if they agree.
   *
   * The filenames are the closest thing this binary has to an asset name
   * table, and they are how a spawn class gets identified: `cat.bin`,
   * `hito_manbest.bin`, `car_pl.bin`.
   */
  characterAssetFile(charType: number): string | null {
    const slots = this.assetSlots();
    const files = new Set<string>();
    for (const n of this.characterSkeleton(charType)) {
      const rec = slots.get(n.slot);
      if (rec) files.add(rec[0]);
    }
    return files.size === 1 ? [...files][0] : null;
  }

  /** `{sound id: filename}` for every category-0 sound in the game. */
  soundRecords(): Map<number, string> {
    return this.cached("soundRecords", () => {
      const out = new Map<number, string>();
      const base = this.v2r(ExeTables.SOUND_RECORDS);
      if (base === null) return out;
      for (let i = 0; i < 4096; i++) {
        const off = base + i * ExeTables.SOUND_RECORD_STRIDE;
        if (off + ExeTables.SOUND_RECORD_STRIDE > this.data.length) break;
        const sid = u32(this.data, off);
        if (sid === 0xffff) break;
        const name = asciiField(this.data, off + 4,
                                ExeTables.SOUND_RECORD_STRIDE - 4);
        // not-a-loss: the decode is the test for whether this slot holds a
        // string, and No is an answer.
        if (name !== null) out.set(sid, name);
      }
      return out;
    });
  }

  /** The filename a `PlaySoundId` id names, if it is a category-0 id. */
  soundName(soundId: number): string | null {
    return this.soundRecords().get(soundId) ?? null;
  }

  /**
   * The breakable-prop groups, decoded from `FUN_00462A80`'s tables.
   *
   * Each record is 10 bytes:
   *
   *     +0x00 s16  x * 0.1
   *     +0x02 s16  z * 0.1
   *     +0x04 u8   item-set id
   *     +0x05 s8   g_GameMode == 1 item kind, -1 for none
   *     +0x06 s8   stack level; y = level * 7.540296 above the floor
   *     +0x07 u8   number of supporting members
   *     +0x08 u8   supporting member index a
   *     +0x09 u8   supporting member index b
   *
   * The support list is what makes a stack topple when a prop under it is
   * destroyed. **[proved]** by self-consistency: across all 42 members of all
   * nine groups, every member at level *n* names supports that are all at
   * level *n-1*, and every ground-level member names none.
   */
  breakableGroups(): Record<string, unknown>[][] {
    return this.cached("breakableGroups", () => {
      const out: Record<string, unknown>[][] = [];
      const cbase = this.v2r(ExeTables.BREAKABLE_COUNTS);
      const base = this.v2r(ExeTables.BREAKABLE_GROUPS);
      if (cbase === null || base === null) return out;
      const counts = this.data.subarray(cbase, cbase + 9);
      const ptrs = u32s(this.data, base, 9);
      for (let g = 0; g < 9; g++) {
        const off = this.v2r(ptrs[g]);
        const members: Record<string, unknown>[] = [];
        const n = counts[g];
        for (let i = 0; off !== null && i < n; i++) {
          const r = off + i * 10;
          if (r + 10 > this.data.length) break;
          const nsup = this.data[r + 7];
          members.push({
            index: i,
            x: i16(this.data, r) * 0.1,
            z: i16(this.data, r + 2) * 0.1,
            item_set: this.data[r + 4],
            story_item: (this.data[r + 5] << 24) >> 24,
            level: (this.data[r + 6] << 24) >> 24,
            y_offset: ((this.data[r + 6] << 24) >> 24)
              * ExeTables.BREAKABLE_LEVEL_HEIGHT,
            supports: [this.data[r + 8], this.data[r + 9]].slice(0, nsup),
          });
        }
        out.push(members);
      }
      return out;
    });
  }

  /**
   * Per class-0x41 type: which constructor builds it, and which routine the
   * object it builds then runs.
   */
  class41Dispatch(): { type: number; ctor: number; update: number }[] {
    return this.cached("class41Dispatch", () => {
      const cb = this.v2r(ExeTables.CLASS41_CTORS);
      const ub = this.v2r(ExeTables.CLASS41_UPDATES);
      if (cb === null || ub === null) return [];
      const n = ExeTables.CLASS41_TYPES;
      const ctors = u32s(this.data, cb, n);
      const upds = u32s(this.data, ub, n);
      return Array.from({ length: n },
                        (_, i) => ({ type: i, ctor: ctors[i], update: upds[i] }));
    });
  }

  /** `g_prop_kind_params` -- per class-0x41 type-4 object kind. */
  propKindParams(): Record<string, number>[] {
    return this.cached("propKindParams", () => {
      const base = this.v2r(ExeTables.PROP_KIND_PARAMS);
      if (base === null) return [];
      const out: Record<string, number>[] = [];
      for (let i = 0; i < ExeTables.PROP_KIND_COUNT; i++) {
        const o = base + i * 0xc;
        if (o + 0xc > this.data.length) break;
        out.push({
          kind: i,
          effect: i16(this.data, o),
          effect_variant: i16(this.data, o + 2),
          sound: u32(this.data, o + 4),
          radius: i16(this.data, o + 8),
          y_offset: i16(this.data, o + 10),
        });
      }
      return out;
    });
  }

  private hullPoints(va: number, count: number): [number, number, number][] {
    const base = this.v2r(va);
    if (base === null) return [];
    const out: [number, number, number][] = [];
    for (let i = 0; i < count; i++) {
      const o = base + i * 6;
      if (o + 6 > this.data.length) break;
      out.push([i16(this.data, o) * 0.001, i16(this.data, o + 2) * 0.001,
                i16(this.data, o + 4) * 0.001]);
    }
    return out;
  }

  /** The 48-point hull `FallingContainerUpdate` comes to rest on. */
  fallingHullPoints(): [number, number, number][] {
    return this.hullPoints(ExeTables.FALLING_HULL,
                           ExeTables.FALLING_HULL_POINTS);
  }

  /** `g_breakable_hull_points` -- the breakable prop's collision hull. */
  breakableHullPoints(): [number, number, number][] {
    return this.hullPoints(ExeTables.BREAKABLE_HULL,
                           ExeTables.BREAKABLE_HULL_POINTS);
  }

  /**
   * Authored play length of a global cam path slot, in 60 Hz frames.
   *
   * This is *not* the same as the curve's key extent, and the difference is
   * the point: the curves say where the path goes, this says how much of it
   * the game runs.
   */
  camPathLength(slot: number): number {
    const off = this.v2r(ExeTables.CAM_PATH_LENGTH);
    if (off === null) return 0;
    return i32(this.data, off + slot * 4);
  }

  /** The global slot ids a cam file owns, in path order. */
  camSlotsFor(camName: string): number[] {
    const stem = camName.endsWith(".bin") ? camName.slice(0, -4) : camName;
    for (const [fi, [name, cnt]] of this.camFiles()) {
      if (name.slice(0, -4) === stem) {
        const lst = this.ru32(ExeTables.CAM_SLOT_LIST + fi * 4);
        const r = lst ? this.v2r(lst) : null;
        if (r === null) return [];
        const out: number[] = [];
        for (let k = 0; k < cnt; k++) out.push(i16(this.data, r + k * 2));
        return out;
      }
    }
    return [];
  }

  /** Owning cam file for a path slot, via the s8 reverse table. */
  slotCamFile(slot: number): string | null {
    const r = this.v2r(ExeTables.SLOT_TO_CAM + slot);
    if (r === null || r >= this.data.length) return null;
    const fi = (this.data[r] << 24) >> 24;
    const rec = this.camFiles().get(fi);
    return rec ? rec[0] : null;
  }

  // -- stage regions --------------------------------------------------

  static readonly SCENE_REGION_TABLE = 0x00576a2c;
  static readonly SCENE_REGION_IDS = 0x00576a5c;
  static readonly SCENE_REGION_TABLE_MODE1 = 0x00576a8c;
  static readonly SCENE_REGION_IDS_MODE1 = 0x00576abc;
  static readonly REGION_STRIDE = 0x18;
  static readonly REGION_MAX_ENTRIES = 12;

  /**
   * Where the region table starting at *va* ends.
   *
   * The region and id tables for every scene and both game modes are packed
   * contiguously, so a table ends where the next-highest one begins. The count
   * is not stored anywhere -- reading a fixed maximum instead walks off into
   * the neighbouring table and invents regions.
   */
  private regionTableBounds(va: number): number {
    const starts = new Set<number>();
    for (const base of [ExeTables.SCENE_REGION_TABLE,
                        ExeTables.SCENE_REGION_IDS,
                        ExeTables.SCENE_REGION_TABLE_MODE1,
                        ExeTables.SCENE_REGION_IDS_MODE1]) {
      for (let s = 0; s < ExeTables.SCENE_COUNT; s++) {
        const v = this.ru32(base + s * 4);
        if (v) starts.add(v);
      }
    }
    starts.add(ExeTables.SCENE_REGION_TABLE);   // the pointer tables follow
    const after = [...starts].filter((v) => v > va);
    return after.length ? Math.min(...after)
                        : va + ExeTables.REGION_STRIDE * 64;
  }

  /**
   * Region list for a scene: `[[[assetSlot, drawMode], ...], ...]`.
   *
   * Index into the result is the region id written by evt opcode 0x29.
   */
  sceneRegions(scene: number, mode1 = false): [number, number][][] {
    return this.cached(`regions:${scene}:${mode1}`, () => {
      const rt = this.ru32((mode1 ? ExeTables.SCENE_REGION_TABLE_MODE1
                                  : ExeTables.SCENE_REGION_TABLE) + scene * 4);
      const it = this.ru32((mode1 ? ExeTables.SCENE_REGION_IDS_MODE1
                                  : ExeTables.SCENE_REGION_IDS) + scene * 4);
      if (!rt || !it) return [];
      const r0 = this.v2r(rt);
      const i0 = this.v2r(it);
      if (r0 === null || i0 === null) return [];
      const maxRegions = Math.max(0, Math.floor(
        (this.regionTableBounds(rt) - rt) / ExeTables.REGION_STRIDE));
      const out: [number, number][][] = [];
      for (let r = 0; r < maxRegions; r++) {
        const base = r0 + r * ExeTables.REGION_STRIDE;
        if (base + ExeTables.REGION_STRIDE > this.data.length) break;
        const ids: number[] = [];
        for (let k = 0; k < ExeTables.REGION_MAX_ENTRIES; k++) {
          const e = i16(this.data, base + k * 2);
          if (e === -1) break;
          ids.push(e);
        }
        const entries: [number, number][] = [];
        for (const e of ids) {
          const off = i0 + e * 4;
          if (off + 4 > this.data.length) continue;
          entries.push([i16(this.data, off), i16(this.data, off + 2)]);
        }
        out.push(entries);
      }
      while (out.length && !out[out.length - 1].length) out.pop();
      return out;
    });
  }

  static readonly DRAW_DEFAULT = 0;
  static readonly DRAW_SCENE_LIT = 1;
  static readonly DRAW_EARLY_LAYER = 2;

  /** asset slot -> drawMode, for every slot any region of a scene draws. */
  sceneDrawModes(scene: number, mode1 = false): Map<number, number> {
    const out = new Map<number, number>();
    for (const region of this.sceneRegions(scene, mode1)) {
      for (const [slot, mode] of region) {
        out.set(slot, Math.max(out.get(slot) ?? 0, mode));
      }
    }
    return out;
  }

  /** Every asset slot any region of a scene draws, in first-use order. */
  sceneGeometrySlots(scene: number, mode1 = false): number[] {
    const seen = new Set<number>();
    for (const region of this.sceneRegions(scene, mode1)) {
      for (const [slot] of region) seen.add(slot);
    }
    return [...seen];
  }

  /**
   * pol filename -> sorted entry indices the scene actually draws.
   *
   * This is the authoritative stage geometry set. It supersedes globbing
   * `st<N>_*`, which both misses files (st3.bin, st_org01) and includes
   * entries no region ever draws.
   */
  sceneGeometryFiles(scene: number, mode1 = false): Map<string, number[]> {
    const slots = this.assetSlots();
    const acc = new Map<string, Set<number>>();
    for (const slot of this.sceneGeometrySlots(scene, mode1)) {
      const rec = slots.get(slot);
      if (rec) {
        let s = acc.get(rec[0]);
        if (!s) { s = new Set(); acc.set(rec[0], s); }
        s.add(rec[1]);
      }
    }
    const out = new Map<string, number[]>();
    for (const k of [...acc.keys()].sort()) {
      out.set(k, [...acc.get(k)!].sort((a, b) => a - b));
    }
    return out;
  }

  // -- sound ----------------------------------------------------------

  static readonly MESSAGE_VARIANTS = 0x0058b6b8;
  static readonly MESSAGE_RECORDS = 0x00589da8;
  static readonly MESSAGE_RECORD_STRIDE = 0x10;

  static readonly DIALOGUE_LINES = 0x005919a8;
  static readonly DIALOGUE_LINES_PER_VARIANT = 4;
  static readonly DIALOGUE_TEXT = 0x0058bc68;
  static readonly DIALOGUE_TEXT_STRIDE = 0x40;
  static readonly DIALOGUE_TEXT_END = 0x3e;

  static readonly BACKDROP_PRESETS = 0x00579968;
  static readonly BACKDROP_STRIDE = 0x10;
  static readonly BACKDROP_COUNT = 12;

  static readonly VOICE_RECORDS = 0x0058044a;
  static readonly VOICE_STRIDE = 0x24;

  static readonly SE_NAME_LIST = 0x005845f8;
  static readonly SE_RECORD_STRIDE = 0x34;
  static readonly SE_TERMINATOR = 0xffff;

  static readonly BGM_NAMES_AR = 0x00580354;
  static readonly BGM_NAMES_PLAIN = 0x005803f8;
  static readonly BGM_AR_COUNT = 41;
  static readonly BGM_PLAIN_COUNT = 20;

  static readonly SOUND_NS_SE = 0;
  static readonly SOUND_NS_BGM = 1;
  static readonly SOUND_NS_VOICE = 2;
  static readonly SOUND_NS_CONTROL = 8;
  static readonly SOUND_STOP = 0x80000000;

  private ptrNames(base: number, count: number): (string | null)[] {
    const out: (string | null)[] = [];
    for (let i = 0; i < count; i++) {
      const p = this.ru32(base + i * 4);
      out.push(p ? this.cstr(p) : null);
    }
    return out;
  }

  /**
   * The two BGM filename tables, indexed by `id & 0xFFF`.
   *
   * Holes are real: indices 2, 4 and 7 have a null pointer in both tables and
   * no shipped script names them.
   */
  bgmNames(): { ar: (string | null)[]; plain: (string | null)[] } {
    return this.cached("bgmNames", () => ({
      ar: this.ptrNames(ExeTables.BGM_NAMES_AR, ExeTables.BGM_AR_COUNT),
      plain: this.ptrNames(ExeTables.BGM_NAMES_PLAIN,
                           ExeTables.BGM_PLAIN_COUNT),
    }));
  }

  /**
   * SE sound id -> path under `sound/SE/`.
   *
   * A flat array of `{u32 id; char name[0x30]}` records walked linearly by
   * `PlaySoundId` comparing the id, terminated by `id == 0xFFFF`. Names carry
   * their subdirectory (`COMMON\BLOOD01_16.WAV`).
   */
  seNames(): Map<number, string> {
    return this.cached("seNames", () => {
      const r = this.v2r(ExeTables.SE_NAME_LIST);
      const out = new Map<number, string>();
      if (r === null) return out;
      for (let i = 0; i < 4096; i++) {
        const o = r + i * ExeTables.SE_RECORD_STRIDE;
        if (o + ExeTables.SE_RECORD_STRIDE > this.data.length) break;
        const sid = u32(this.data, o);
        if (sid === ExeTables.SE_TERMINATOR) break;
        const name = asciiField(this.data, o + 4,
                                ExeTables.SE_RECORD_STRIDE - 4);
        if (name !== null) out.set(sid, name);
      }
      return out;
    });
  }

  /**
   * evt opcode 0x2D's message groups.
   *
   * Neither table stores a count. The **record** table is bounded by the
   * variant table that follows it -- the same contiguous-tables pattern as the
   * BGM and voice tables -- giving 401 records; a group whose variants all
   * fall outside that range ends the group list.
   */
  screenMessages(maxGroups = 512): Record<string, unknown>[] {
    return this.cached(`screenMessages:${maxGroups}`, () => {
      const vr = this.v2r(ExeTables.MESSAGE_VARIANTS);
      const rr = this.v2r(ExeTables.MESSAGE_RECORDS);
      if (vr === null || rr === null) return [];
      const nRecords = Math.floor(
        (ExeTables.MESSAGE_VARIANTS - ExeTables.MESSAGE_RECORDS)
        / ExeTables.MESSAGE_RECORD_STRIDE);
      const out: Record<string, unknown>[] = [];
      for (let g = 0; g < maxGroups; g++) {
        const o = vr + g * 6;
        if (o + 6 > this.data.length) break;
        const variants = [i16(this.data, o), i16(this.data, o + 2),
                          i16(this.data, o + 4)];
        if (variants.some((v) => v < 0 || v >= nRecords)) break;
        const entry: Record<string, unknown> = { group: g, variants: [] };
        const list = entry.variants as (Record<string, unknown> | null)[];
        variants.forEach((v, cfg) => {
          if (v === 0) { list.push(null); return; }
          const ro = rr + v * ExeTables.MESSAGE_RECORD_STRIDE;
          if (v >= nRecords
              || ro + ExeTables.MESSAGE_RECORD_STRIDE > this.data.length) {
            list.push(null);
            return;
          }
          const voice = u32(this.data, ro + 12);
          list.push({
            variant: v, player_cfg: cfg,
            sprite: u16(this.data, ro), frames: u16(this.data, ro + 2),
            x: f32(this.data, ro + 4), y: f32(this.data, ro + 8),
            voice,
            lines: this.dialogueLines(v),
            voice_file: (voice >>> 28) === ExeTables.SOUND_NS_VOICE
              ? (this.voiceNames().get(voice & 0xfff) ?? null) : null,
          });
        });
        out.push(entry);
      }
      return out;
    });
  }

  /**
   * The subtitle lines a message variant displays, in order.
   *
   * Line record, 0x40 bytes at `DIALOGUE_TEXT`:
   *
   *     +0x00  f32   x_offset    added to the centred position
   *     +0x04  char  text[0x3A]  NUL-terminated ASCII
   *     +0x3E  u16   end_frame
   *
   * Lines advance on a countdown rather than a timer, so `end_frame` is
   * "frames still remaining when this line gives way".
   */
  dialogueLines(variant: number): Record<string, unknown>[] {
    const lr = this.v2r(ExeTables.DIALOGUE_LINES);
    const tr = this.v2r(ExeTables.DIALOGUE_TEXT);
    if (lr === null || tr === null || variant < 0) return [];
    const out: Record<string, unknown>[] = [];
    for (let i = 0; i < ExeTables.DIALOGUE_LINES_PER_VARIANT; i++) {
      const o = lr + (variant * ExeTables.DIALOGUE_LINES_PER_VARIANT + i) * 2;
      if (o + 2 > this.data.length) break;
      const lineId = u16(this.data, o);
      if (lineId === 0xffff) break;
      const ro = tr + lineId * ExeTables.DIALOGUE_TEXT_STRIDE;
      if (ro + ExeTables.DIALOGUE_TEXT_STRIDE > this.data.length) break;
      const xOff = f32(this.data, ro);
      // `decode("ascii", "replace")`: a byte outside ASCII becomes U+FFFD
      // rather than ending the string.
      const text = replaceField(this.data, ro + 4,
                                ExeTables.DIALOGUE_TEXT_END - 4);
      const endFrame = u16(this.data, ro + ExeTables.DIALOGUE_TEXT_END);
      if (!text) continue;
      out.push({ line: lineId, text, x_offset: xOff, end_frame: endFrame });
    }
    return out;
  }

  /** The 12 camera-following backdrop domes, indexed by evt opcode 0x1B. */
  backdropPresets(): Record<string, unknown>[] {
    return this.cached("backdropPresets", () => {
      const r = this.v2r(ExeTables.BACKDROP_PRESETS);
      const out: Record<string, unknown>[] = [];
      if (r === null) return out;
      const slots = this.assetSlots();
      for (let i = 0; i < ExeTables.BACKDROP_COUNT; i++) {
        const o = r + i * ExeTables.BACKDROP_STRIDE;
        if (o + ExeTables.BACKDROP_STRIDE > this.data.length) break;
        const a = i16(this.data, o);
        const b = i16(this.data, o + 2);
        const entry: Record<string, unknown> = {
          preset: i, slot_a: a, slot_b: b,
          dy: f32(this.data, o + 4),
          spin_bams: i32(this.data, o + 8),
          angle0_bams: i32(this.data, o + 12),
        };
        for (const [key, sl] of [["a", a], ["b", b]] as [string, number][]) {
          const rec = slots.get(sl);
          if (rec) {
            entry[`file_${key}`] = rec[0];
            entry[`entry_${key}`] = rec[1];
          }
        }
        out.push(entry);
      }
      return out;
    });
  }

  /**
   * Voice id (`id & 0xFFF`) -> path under `sound/voice/`.
   *
   * `0x24`-byte records: a `s16` that is -1 for an empty slot, then the name.
   * The count is not stored -- the table simply runs up to the SE list, which
   * is the same "contiguous tables bound each other" pattern the two BGM name
   * tables use. That gives **467** entries.
   */
  voiceNames(): Map<number, string> {
    return this.cached("voiceNames", () => {
      const r = this.v2r(ExeTables.VOICE_RECORDS);
      const out = new Map<number, string>();
      if (r === null) return out;
      const count = Math.floor(
        (ExeTables.SE_NAME_LIST - ExeTables.VOICE_RECORDS)
        / ExeTables.VOICE_STRIDE);
      for (let i = 0; i < count; i++) {
        const o = r + i * ExeTables.VOICE_STRIDE;
        if (o + ExeTables.VOICE_STRIDE > this.data.length) break;
        if (i16(this.data, o) === -1) continue;
        const name = asciiField(this.data, o + 2, ExeTables.VOICE_STRIDE - 2);
        if (name !== null) out.set(i, name);
      }
      return out;
    });
  }

  /**
   * `[kind, path]` for any sound id, dispatched the way the game does.
   *
   * `PlaySoundId` switches on the top nibble, so a single `se_play` operand
   * can name an SE, a BGM track or a voice line -- and in the shipped scripts
   * it does all three. Returns null for the stop control, for id 0 (the
   * early-out), and for ids with no table entry.
   */
  soundFile(soundId: number): [string, string] | null {
    const ns = soundId >>> 28;
    if (soundId === 0) return null;
    if (ns === ExeTables.SOUND_NS_SE) {
      const n = this.seNames().get(soundId);
      return n ? ["se", n] : null;
    }
    if (ns === ExeTables.SOUND_NS_BGM) {
      const n = this.bgmFile(soundId);
      return n ? ["bgm", n] : null;
    }
    if (ns === ExeTables.SOUND_NS_VOICE) {
      const n = this.voiceNames().get(soundId & 0xfff);
      return n ? ["voice", n] : null;
    }
    return null;
  }

  /**
   * Filename for an SE id, or null.
   *
   * SE is namespace 0, and `id == 0` is `PlaySoundId`'s early-out -- the
   * script's way of saying "no sound", not a real entry.
   */
  seFile(soundId: number): string | null {
    if (soundId === 0 || soundId >>> 28 !== ExeTables.SOUND_NS_SE) return null;
    return this.seNames().get(soundId) ?? null;
  }

  /** Filename for a `bgm_entry_play` operand, or null. */
  bgmFile(trackId: number, plain = false): string | null {
    if (trackId >>> 28 !== ExeTables.SOUND_NS_BGM) return null;
    const idx = trackId & 0xfff;
    const names = this.bgmNames();
    const table = plain ? names.plain : names.ar;
    return idx < table.length ? table[idx] : null;
  }
}

function hex(v: number): string {
  return `0x${(v >>> 0).toString(16).padStart(8, "0")}`;
}

/** `struct.unpack("<f", struct.pack("<i", n))[0]`. */
function asFloatBits(n: number | null | undefined): number {
  const dv = new DataView(new ArrayBuffer(4));
  dv.setInt32(0, n ?? 0, true);
  return dv.getFloat32(0, true);
}

/** `raw.split(b"\0")[0].decode("ascii")`, or null if it is not ASCII. */
function asciiField(b: Uint8Array, off: number, len: number): string | null {
  let end = off;
  const stop = off + len;
  while (end < stop && b[end] !== 0) end++;
  let s = "";
  for (let i = off; i < end; i++) {
    if (b[i] > 0x7f) return null;
    s += String.fromCharCode(b[i]);
  }
  return s;
}

/** The same, with `errors="replace"`: a non-ASCII byte becomes U+FFFD. */
function replaceField(b: Uint8Array, off: number, len: number): string {
  let end = off;
  const stop = off + len;
  while (end < stop && b[end] !== 0) end++;
  let s = "";
  for (let i = off; i < end; i++) {
    s += b[i] > 0x7f ? "�" : String.fromCharCode(b[i]);
  }
  return s;
}
