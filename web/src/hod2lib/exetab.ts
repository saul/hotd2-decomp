/**
 * Tables compiled into Hod2.exe.
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
 * **The expensive walks here are memoised.** `assetSlots()` walks four
 * hundred pointer tables and is called from inside three loops, and this
 * pays that cost once. The
 * tables are read-only data in a file that does not change while an export
 * runs, so the only observable difference is the time.
 */

import { f32, i16, i32, latin1, u16, u32, u32s } from "./bytes";
import type { Vec3 } from "./rigs";
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
/**
 * 4-bit palettised, twiddled. Only the screen banks use it -- the HUD, the
 * menus -- so no model texture ever did. `DecodeTextureToSurface`
 * (0x004AC270) is the decoder; see `texbank.decodePal4`.
 */
export const LAYOUT_PAL4 = 5;

/** `g_screen_sprite_bank`: `DrawScreenSprite` id -> tex/ bank index. */
export const SCREEN_SPRITE_BANK = 0x0057a5bc;
/** `g_screen_sprite_tex_slot`: sprite id -> global texture slot (+0x0C). */
export const SCREEN_SPRITE_TEX_SLOT = 0x0057d448;
/** Both tables end where the second one ends, at 0x005802D4. */
export const SCREEN_SPRITE_COUNT = (0x005802d4 - SCREEN_SPRITE_TEX_SLOT) / 4;
/** `g_texture_palette_table`: an s16, then `{s16 16; u32 ptr; u32 16}`. */
export const PALETTE_TABLE = 0x0057a010;
/**
 * `TexBankPaletteIndex` (0x0041C9E0), the arms that read a table: bank index
 * -> s16 palette per texture. Only scr_common's is transcribed; any other
 * bank's PAL4 texture has no palette here and is refused.
 */
export const BANK_PALETTE_INDEX: ReadonlyMap<number, number> =
  new Map([[0x147, 0x0057a524]]);
/**
 * `TexBankPaletteIndex`'s arms that return a constant, for the banks whose
 * sprites the port draws: `scr_bosmater` (0x177) and the six
 * `scr_bosmater_st1`..`st6` (0x186..0x18B), which the byte table at
 * `0x0041CB90` all sends to jump-table entry 10, `MOV EAX, 0xA` at
 * `0x0041CA1A`. The boss health bar and the boss-name banner draw from them.
 *
 * And palette 0x14 for `0x156` and the 34 one-picture banks `0x193..0x1B4`,
 * jump-table entry 2, `MOV EAX, 0x14` at `0x0041CA88`: the Original Mode
 * item pictures `OriginalItemBannerUpdate` (`FUN_00475D00`) draws, one bank
 * per `g_original_item_records[id].sprite` (`0x5BD..0x5DE`).
 *
 * And palette 0x1B for `0x1B5`, `scr_item_all`, jump-table entry 18 (byte
 * `0x0041CBFE`), `MOV EAX, 0x1B` at `0x0041CA8E`: the trunk's list of item
 * names, `g_original_item_list_sprites` (`0x5F9..0x61A`).
 */
export const BANK_PALETTE_CONST: ReadonlyMap<number, number> = new Map([
  [0x177, 10], [0x186, 10], [0x187, 10], [0x188, 10], [0x189, 10],
  [0x18a, 10], [0x18b, 10], [0x156, 0x14], [0x1b5, 0x1b],
  ...Array.from({ length: 0x1b5 - 0x193 },
                (_, i): [number, number] => [0x193 + i, 0x14]),
]);

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
  /** `rec+0x18`, the routine `CivilianDrawHeldItems` calls after the draw. */
  callback: number;
  /**
   * The kind's row of `g_original_item_bank_sprite`, its `+2` half -- the
   * sprite `CivilianHeldItemGrantOriginalItem` hands `SpawnOriginalItemBanner`.
   * `null` for a kind outside the table's 33 rows, as record 0's -1 is.
   */
  banner: number | null;
}

/** One vertex group of a {@link CharacterPart}: a bone and its vertices. */
export interface CharacterPartGroup {
  /** The bone every vertex in this group is rigid to. */
  bone: number;
  /**
   * The group's source vertices, in **that bone's local space** — which is
   * what makes the whole thing skinning with one joint and weight 1:
   * `DeformCharacterPartGroup` composes `inverse(drawBone) * bone`, and the
   * draw re-applies `drawBone`, so a vertex lands at `bone * source`.
   */
  verts: { pos: Vec3; normal: Vec3 }[];
  /**
   * One signed byte per row of {@link CharacterPart.rows}: an index into
   * {@link CharacterPartGroup.verts}, or negative for "this row is not mine".
   */
  assign: number[];
}

/** One entry of `g_pCharacterExtraParts` — see {@link ExeTables.characterParts}. */
export interface CharacterPart {
  /** The asset slot the whole part is drawn as. */
  slot: number;
  /** `g_character_part_bones[part][4]` — the bone the draw happens in. */
  drawBone: number;
  /** Four slots, `null` where the descriptor's count is zero. */
  groups: (CharacterPartGroup | null)[];
  /** Per logical vertex, the model-relative offsets of every copy of it. */
  rows: number[][];
  /** Which group indices this part's drawer actually deforms. */
  deformed: number[];
  /** The drawer's own address, so an unmapped one is visible rather than silent. */
  drawer: number;
  /**
   * Whether that drawer is one the port has read. False means the part is
   * not emitted: what it draws is not this table's slot.
   */
  supported: boolean;
}

/** One row of `g_actor_attachment_records` -- `0x004EC4C0`. */
export interface AttachmentRecord {
  /** The skeleton bone the model hangs off, or replaces. */
  bone: number;
  /** The asset slot drawn there. */
  slot: number;
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
   * digest both hosts have.
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
   * Public because five sibling modules read tables this one does not name --
   * `arcscript`, `approach`, `combat`, `class31`, `props`. They are the same
   * package, and this comment says "not for callers outside it".
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

  /**
   * The last scene of the chain a stage run walks: scenes 0..5 are stages
   * 1..6, and `RunPhaseStepToNextScene` (`FUN_004603B0`) leaves the chain when
   * the increment reaches 6.
   */
  static readonly LAST_STAGE_SCENE = 5;

  /**
   * Where this scene can end, and the block each ending hands the next scene.
   *
   * **A terminal route record's `next[0]` is the next scene's starting block.**
   * `EvtAdvanceStepOrRoute` (`FUN_0045F000`) ends a scene by walking onto a
   * hole -- a `kind == 2` record does `block += 1` and the record after it is
   * a hole -- and then reads
   *
   * ```c
   * g_evt_block_index = *(s16 *)(g_scene_routes[scene] + g_evt_block_index * 8 - 6);
   * ```
   *
   * at `0x0045F0DA`. `block * 8 - 6` is record `block - 1` at `+0x02`, which
   * is `next[0]` of the record the walk just left. Nothing between there and
   * `FUN_0045EBC0` writes the block index again -- not `AdvanceToNextScene`,
   * not `LoadSceneAndReset`, not `ResetSceneOnEnter` -- so that value is what
   * the next scene opens on. **[proved]**
   *
   * Only the records this scene can actually reach are returned, from every
   * block {@link sceneEntryBlocks} says it can be entered at. The shipped
   * tables carry unreachable `kind == 2` records too -- four in stage 2 where
   * two are live -- and they name entry blocks nothing can arrive at.
   *
   * Returned in block order as `[terminal block, next scene's entry block]`.
   */
  sceneExits(scene: number): [number, number][] {
    return this.cached(`exits:${scene}`, () => {
      const routes = this.sceneRoutes(scene);
      const seen = new Set<number>();
      const stack = [...this.sceneEntryBlocks(scene)];
      const out = new Map<number, number>();
      while (stack.length) {
        const b = stack.pop() as number;
        if (seen.has(b) || b < 0 || b >= routes.length) continue;
        seen.add(b);
        const [kind, ...next] = routes[b];
        if (kind === ExeTables.ROUTE_GOTO) stack.push(next[0]);
        // Every live slot, not only the two Arcade's writers can name: slot 2
        // is Original Mode's road. On the shipped tables the two modes reach
        // the same endings anyway, so the union costs nothing and states less.
        else if (kind === ExeTables.ROUTE_BRANCH) {
          for (const n of next) if (n >= 0) stack.push(n);
        } else if (kind === ExeTables.ROUTE_END) out.set(b, next[0]);
      }
      return [...out.entries()].sort((a, b) => a[0] - b[0]);
    });
  }

  /**
   * Every block this scene can be entered at, ascending.
   *
   * Scene 0 is `ResetGameOnStart`'s block 0 and every later scene is the set
   * of `next[0]`s the scene before it can reach -- see {@link sceneExits}. So
   * this is a forward walk down the chain and not a property of the scene's
   * own file.
   *
   * The shipped answer: **stage 3 starts at block 0 or block 7, stage 4 at
   * block 0 or block 4**, and every other stage has one entry. Which one a
   * run gets is decided by the branches it took in the stage before.
   *
   * A scene off the stage chain -- training, the attract screens, the ending
   * -- has no predecessor here and reports block 0. That is not a claim about
   * how those scenes are entered: `RunAttractDemo` names its own block and
   * `ResetGameOnStart` takes Training's from `0x009A2BBC`, which the select
   * screen sets by `g_training_course`.
   */
  sceneEntryBlocks(scene: number): number[] {
    return this.cached(`entries:${scene}`, () => {
      if (scene <= 0 || scene > ExeTables.LAST_STAGE_SCENE) return [0];
      const from = this.sceneExits(scene - 1).map(([, entry]) => entry);
      const uniq = [...new Set(from)].sort((a, b) => a - b);
      return uniq.length ? uniq : [0];
    });
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

  /**
   * `g_original_item_bank_sprite` -- `{s16 texbank, s16 banner sprite}` per
   * Original Mode item id, which a held-item record's kind is:
   * `MOVSX EAX, word ptr [EDX*4 + 0x56b0f6]` into `SpawnOriginalItemBanner`
   * at `0x0048DE6A`. No bound in the exe; the 33 rows end at `0x0056B178`,
   * where `SpawnLifeGrantedMarker`'s `-32.0` begins (L6).
   */
  static readonly ORIGINAL_ITEM_BANK_SPRITE = 0x0056b0f4;
  static readonly ORIGINAL_ITEM_BANK_SPRITE_ROWS = 33;

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
          // Op 0x18 copies six **dwords** -- `MOV EDX,[EAX]; MOV [ECX],EDX`
          // three times into `obj+0x40..0x48`, then three more into
          // `obj+0x64..0x6C` (`0x0048BE71`..`0x0048BEA9`) -- so the first
          // three are the position's floats and the last three are the
          // rotation's BAMS **integers**. Read as floats, stage 1's bin
          // civilian's `0xC000` yaw came out 6.9e-41.
          if (op === 0x18 && args[0]) {
            d.pose = [0, 1, 2].map((i) => this.rf32(args[0]! + i * 4))
              .concat([3, 4, 5].map((i) => this.ri32(args[0]! + i * 4)));
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
    const kind = w[2]!;
    const sprite = kind >= 0 && kind < ExeTables.ORIGINAL_ITEM_BANK_SPRITE_ROWS
      ? this.ru16(ExeTables.ORIGINAL_ITEM_BANK_SPRITE + kind * 4 + 2) : null;
    seen.set(va, this.civItems.length);
    this.civItems.push({
      bone: w[0]!, slot: w[1]! & 0xffff, kind,
      extra: ExeTables.CIVILIAN_ITEM_EXTRA[kind] ?? null,
      rot: [w[3]!, w[4]!, w[5]!], sets,
      callback: w[6]! >>> 0,
      banner: sprite === null ? null : (sprite << 16) >> 16,
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

  /**
   * One pol file's slot list, `POL_SLOT_LIST[file]` (`0x004E794C`): entry k
   * of the file loads into slot `list[k]`. It is the list the whole-file
   * load walks -- `FUN_00418E40` points `0x007C2134` at it (`0x00418E84`)
   * and `FUN_00418EC0` takes one slot off it per model, installing the model
   * only into a slot that is not already resident. Null for a file the table
   * does not know.
   */
  polFileSlots(file: string): number[] | null {
    for (const [fi, [name, cnt]] of this.polFiles()) {
      if (name !== file) continue;
      const lst = this.ru32(ExeTables.POL_SLOT_LIST + fi * 4);
      if (!lst) return null;
      const r = this.v2r(lst);
      if (r === null) return null;
      const out: number[] = [];
      for (let k = 0; k < cnt; k++) out.push(i16(this.data, r + k * 2));
      return out;
    }
    return null;
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

  /**
   * `PTR_DAT_004c4990` — one pointer per scene, to an `s16` list of cam file
   * indices ending in -1. `FUN_004040A0` walks the entry for
   * `g_scene_index` and queues each file (`AssetQueueLoadCamFile`), and in
   * Original Mode (`g_GameMode == 1`) queues file `0x16`, `op_org.bin`, after
   * every one of them. Read from the image: scene 4 (stage 5) is
   * `{10, 20, 16}` -- `cp_st5`, `op_st5` **and `op_st1`**, whose paths stage
   * 5's JUDGMENT flies -- and scene 6 (Training) takes `cp_st2` as well.
   */
  static readonly SCENE_CAM_FILES = 0x004c4990;
  static readonly ORIGINAL_CAM_FILE = 0x16;

  /**
   * The cam files `FUN_004040A0` loads for a scene, as stems, in its order and
   * without repeats -- the Original Mode file appears once, after the first.
   */
  sceneCamFiles(scene: number, original: boolean): string[] {
    const out: string[] = [];
    if (scene < 0 || scene >= ExeTables.SCENE_COUNT) return out;
    const ptr = this.ru32(ExeTables.SCENE_CAM_FILES + scene * 4);
    const r = ptr ? this.v2r(ptr) : null;
    if (r === null) return out;
    const files = this.camFiles();
    const add = (fi: number): void => {
      const rec = files.get(fi);
      if (!rec) return;
      const stem = rec[0].endsWith(".bin") ? rec[0].slice(0, -4) : rec[0];
      if (!out.includes(stem)) out.push(stem);
    };
    for (let k = 0; k < ExeTables.MAX_CAM_FILES; k++) {
      const fi = i16(this.data, r + k * 2);
      if (fi === -1) break;
      add(fi);
      if (original) add(ExeTables.ORIGINAL_CAM_FILE);
    }
    return out;
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
  /**
   * `g_original_item_tables` -- one pointer per `g_scene_index` to that
   * scene's rows, 8 bytes each; `PickOriginalModeItem` (`FUN_004629C0`)
   * `MOVSX EAX, word ptr [0x009a1a08]; MOV ECX, [EAX*4 + 0x595aa0]` and then
   * `LEA EDI, [ECX + row*8]`. No row count: the placer's byte is the index.
   */
  static readonly ORIGINAL_ITEM_TABLES = 0x00595aa0;
  /**
   * `g_original_item_records` -- 0xC a record, indexed by the item id a row
   * names: `MOV CX, word ptr [EDX*4 + 0x5957d8]` with `EDX = id * 3`.
   */
  static readonly ORIGINAL_ITEM_RECORDS = 0x005957d8;
  /**
   * `g_water_surface_slots`, s16[10]. `PlaceWaterSurface` indexes it with no
   * bound; the ten end where `PROP_KIND_PARAMS` begins, which four routines
   * address directly -- the table beside it, not a guess at its length (L6).
   */
  static readonly WATER_SURFACE_SLOTS = 0x00593da4;
  static readonly WATER_SURFACE_SLOT_COUNT = 10;
  static readonly FALLING_HULL = 0x00594788;
  static readonly FALLING_HULL_POINTS = 48;
  /**
   * `g_container_fragment_hull_points` -- the 55-point hull
   * `FallingContainerFragmentUpdate` (`FUN_0046AD20`) passes
   * `FallingContainerGroundContact` as `(0x005948A8, 0x37)`. It begins where
   * the 48-point container hull ends; both bounds are the callers' own
   * `PUSH` immediates, not a scan for the end of either table (L6).
   */
  static readonly FRAGMENT_HULL = 0x005948a8;
  static readonly FRAGMENT_HULL_POINTS = 55;
  /**
   * `BreakablePropShatterUpdate` (`FUN_004653B0`) draws piece `i` from
   * `g_shatter_fragment_slots_a[i]` or `_b[i]`, and `BreakablePropSpawnShatter`
   * (`FUN_00465170`) places it from `g_shatter_fragment_offsets[i]` and
   * `g_shatter_fragment_angles[i]`. The loop bound, `CMP ESI, 0x5A` in steps
   * of six, is what says fifteen.
   */
  static readonly SHATTER_SLOTS_A = 0x00593a38;
  static readonly SHATTER_SLOTS_B = 0x00593a58;
  static readonly SHATTER_OFFSETS = 0x00593a78;
  static readonly SHATTER_ANGLES = 0x00593ad4;
  static readonly SHATTER_PIECES = 15;
  static readonly CLASS41_CTORS = 0x00593580;
  static readonly CLASS41_UPDATES = 0x005936bc;
  static readonly CLASS41_TYPES = 79;
  static readonly GENERIC_PROP_CTOR = 0x00461cf0;
  /** Height of one stack level, from the constructor's own multiply. */
  static readonly BREAKABLE_LEVEL_HEIGHT = 7.540296;

  static readonly CAM_PATH_LENGTH = 0x00576d38;

  // -- the vertex-blended parts ----------------------------------------

  /**
   * `g_pCharacterExtraParts` -- `0x0052ED08`, per character type
   * `{u32 count; u32 *descriptors[]}`.
   *
   * A descriptor is 14 dwords: `{u32 slot; u32 mesh_info; (u32 count,
   * u32 src_verts, u32 assign)[4]}`. The four triples are the **vertex
   * groups**, and a group's `count` doubles as its present flag --
   * `DeformCharacterPartGroup` (`FUN_00419980`) returns early on zero.
   */
  static readonly CHARACTER_PARTS = 0x0052ed08;

  /** `g_character_part_bones` -- `0x004ED1E0`, five `s32` per part. */
  static readonly CHARACTER_PART_BONES = 0x004ed1e0;

  /**
   * Character types whose part rows come from somewhere other than the
   * default table, from `BuildCharacterPart`'s own switch.
   */
  static readonly CHARACTER_PART_BONES_BY_TYPE: Record<number, number> = {
    0x0e: 0x004ed348,
    0x1f: 0x004ed4b0, 0x46: 0x004ed4b0, 0x4e: 0x004ed4b0,
    0x41: 0x004ed780,
    0x4c: 0x004ed618,
    0x53: 0x004ed8e8,
  };

  /** `g_character_part_drawers` -- `0x004EDAEC`, one routine per part. */
  static readonly CHARACTER_PART_DRAWERS = 0x004edaec;

  /**
   * Which of the four groups a drawer actually deforms.
   *
   * `DeformAndDrawCharacterPart` (`FUN_00419E50`) takes a *which*: 1 is the
   * group pair at record offsets 0x00 and 0x10, 0 the pair at 0x20 and 0x30.
   * The four shipped drawers between them cover three sets, and a group the
   * drawer does not touch keeps what the model stores -- which is right,
   * because such a group's bone is the draw bone and its transform is the
   * identity.
   */
  static readonly CHARACTER_PART_DEFORMED: Record<number, number[]> = {
    /** `DrawCharacterPartGroup0` (`FUN_00419E90`). */
    0x00419e90: [0],
    /** `DrawCharacterPartGroup0Thunk` (`FUN_00419EA0`) -- the same code. */
    0x00419ea0: [0],
    /** `DrawCharacterPartGroup2` (`FUN_00419E40`). */
    0x00419e40: [2],
    /** `DrawCharacterPartAllGroups` (`FUN_004198B0`). */
    0x004198b0: [0, 1, 2, 3],
  };

  /**
   * Drawers the port has read. A part whose drawer is not here is **not
   * emitted at all**, because the port would have to invent what it draws.
   *
   * The one that is missing is `DrawCharacterPartSubparts` (`FUN_0041A020`),
   * character type 0x17's part 1: a different mechanism entirely, eight
   * sub-parts from `g_class17_subpart_records` (`0x0052EA38`) with their own
   * bones and slots. Its descriptor's slot word is `0x0009`, which is a real
   * model in `komono_4.bin` and is **not** what the engine draws for it -- so
   * emitting the part as a rigid mesh of that slot, which the port did before
   * the parts were read, put a wrong model on a `zskamere`.
   */
  static readonly CHARACTER_PART_DRAWERS_READ: readonly number[] = [
    0x00419e90, 0x00419ea0, 0x00419e40, 0x004198b0,
  ];

  /**
   * The parts a character type draws that its skeleton does not name.
   *
   * Every field of {@link CharacterPart} is read straight out of the exe;
   * nothing here is inferred. A part whose descriptor pointer is null -- 21
   * of the types have one -- comes back as `null` so a part keeps its index,
   * because the index is what `g_character_part_drawers` and
   * `g_character_part_bones` are keyed on.
   */
  characterParts(charType: number): (CharacterPart | null)[] {
    return this.cached(`parts:${charType}`, () => {
      const out: (CharacterPart | null)[] = [];
      const base = this.v2r(ExeTables.CHARACTER_PARTS);
      if (base === null || !(charType >= 0 && charType < 0x100)) return out;
      const blk = this.v2r(u32(this.data, base + charType * 4));
      if (blk === null || blk + 8 > this.data.length) return out;
      const count = u32(this.data, blk);
      const ao = this.v2r(u32(this.data, blk + 4));
      if (ao === null || !(count > 0 && count < 32)) return out;
      const bonesVa = ExeTables.CHARACTER_PART_BONES_BY_TYPE[charType]
        ?? ExeTables.CHARACTER_PART_BONES;
      const bo = this.v2r(bonesVa);
      const dp = this.v2r(ExeTables.CHARACTER_PART_DRAWERS);
      const dt = dp === null
        ? null : this.v2r(u32(this.data, dp + charType * 4));
      for (let i = 0; i < count; i++) {
        const d = this.v2r(u32(this.data, ao + i * 4));
        if (d === null || bo === null || d + 0x38 > this.data.length) {
          out.push(null);
          continue;
        }
        const bones = [0, 1, 2, 3, 4].map((k) =>
          i32(this.data, bo + i * 0x14 + k * 4));
        const drawer = dt === null ? 0 : u32(this.data, dt + i * 4);
        const groups: (CharacterPartGroup | null)[] = [];
        const rows = this.partRows(u32(this.data, d + 4));
        for (let g = 0; g < 4; g++) {
          const n = u32(this.data, d + 8 + g * 12);
          const sv = this.v2r(u32(this.data, d + 12 + g * 12));
          const av = this.v2r(u32(this.data, d + 16 + g * 12));
          if (!n || sv === null || av === null) { groups.push(null); continue; }
          const verts: { pos: Vec3; normal: Vec3 }[] = [];
          for (let k = 0; k < n; k++) {
            const o = sv + k * 0x18;
            const pos: Vec3 = [f32(this.data, o), f32(this.data, o + 4),
                               f32(this.data, o + 8)];
            const normal: Vec3 = [f32(this.data, o + 12),
                                  f32(this.data, o + 16),
                                  f32(this.data, o + 20)];
            verts.push({ pos, normal });
          }
          const assign: number[] = [];
          for (let r = 0; r < rows.length; r++) {
            assign.push((this.data[av + r] << 24) >> 24);
          }
          groups.push({ bone: bones[g], verts, assign });
        }
        out.push({
          slot: u32(this.data, d),
          drawBone: bones[4],
          groups,
          rows,
          deformed: ExeTables.CHARACTER_PART_DEFORMED[drawer] ?? [],
          drawer,
          supported: ExeTables.CHARACTER_PART_DRAWERS_READ.includes(drawer),
        });
      }
      return out;
    });
  }

  /**
   * `BuildCharacterPartVertexMap` (`FUN_0041A320`)'s second blob: per logical
   * vertex, the model-relative offset of every copy of it in the display
   * list.
   *
   * A row is `{s16 head[headU16]; s32 vertex[ptrCount]}` with the pointer
   * list terminated by `-1`. The head is skipped by every reader in the
   * engine -- the record's `+0x08` is exactly its size, and the deform and
   * both writers start past it -- so it is skipped here too.
   */
  private partRows(meshInfoVa: number): number[][] {
    const m = this.v2r(meshInfoVa);
    if (m === null || m + 0x18 > this.data.length) return [];
    const off2 = u32(this.data, m + 0x0c);
    const size2 = u32(this.data, m + 0x10);
    const head = i16(this.data, m + 0x14) * 2;
    const nptr = i16(this.data, m + 0x16);
    const stride = head + nptr * 4;
    if (stride <= 0 || nptr <= 0 || size2 % stride !== 0) return [];
    const b2 = this.v2r(meshInfoVa + off2);
    if (b2 === null || b2 + size2 > this.data.length) return [];
    const out: number[][] = [];
    for (let r = 0; r * stride < size2; r++) {
      const row: number[] = [];
      for (let k = 0; k < nptr; k++) {
        const v = i32(this.data, b2 + r * stride + head + k * 4);
        if (v === -1) break;
        row.push(v);
      }
      out.push(row);
    }
    return out;
  }

  // -- the attachment table --------------------------------------------

  /**
   * `g_actor_attachment_table` -- `0x004EC748`, 81 pointers into
   * `g_actor_attachment_records` (`0x004EC4C0`).
   *
   * The count is not stored anywhere: the record array runs
   * `0x004EC4C0..0x004EC748` at eight bytes each and the pointer table begins
   * where it ends, so 81 is arithmetic rather than a scan for plausible rows
   * -- which is the adjacent-array trap, L6. Every id the shipped evts use
   * falls inside it, the largest being `0x50`.
   */
  static readonly ATTACHMENT_TABLE = 0x004ec748;
  static readonly ATTACHMENT_RECORDS = 0x004ec4c0;
  static readonly ATTACHMENT_COUNT =
    (0x004ec748 - 0x004ec4c0) / 8;

  /**
   * The id below which `ActorBindPartList` (`FUN_00412440`) **replaces** the
   * bone's own model, instead of `ActorDrawAttachedParts` (`FUN_004124F0`)
   * drawing an extra one. Both routines carry the constant as a literal; it
   * is not derivable from the data.
   */
  static readonly ATTACHMENT_REPLACES_BELOW = 0x24;

  /**
   * `g_actor_attachment_records` -- what an actor's attachment list names.
   *
   * Ids `0x00..0x23` are all bone 2 and name one of the interchangeable
   * `hito_kao_*` / `etc_*_kao` heads (*kao*, face); `ActorBindPartList` writes
   * the slot over the bone's own, so the head the skeleton names is only a
   * default. Ids `0x24` and above name an `etc_komono_*` accessory (*komono*,
   * small item) on bone 2 -- hair and hats -- on bone 1, or on bones 12 and
   * 15, and `ActorDrawAttachedParts` draws them **in addition** to the
   * skeleton.
   *
   * A row whose pointer does not resolve is kept as `bone: -1` rather than
   * dropped, so an id is still its own index.
   */
  attachmentRecords(): AttachmentRecord[] {
    return this.cached("attachmentRecords", () => {
      const out: AttachmentRecord[] = [];
      const base = this.v2r(ExeTables.ATTACHMENT_TABLE);
      if (base === null) return out;
      for (let i = 0; i < ExeTables.ATTACHMENT_COUNT; i++) {
        const o = this.v2r(u32(this.data, base + i * 4));
        if (o === null || o + 8 > this.data.length) {
          out.push({ bone: -1, slot: 0 });
          continue;
        }
        out.push({ bone: i32(this.data, o), slot: i32(this.data, o + 4) });
      }
      return out;
    });
  }

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
        // No depth cap: `seen` visits each node once, which bounds the walk
        // by its input (L22). It stopped at depth 12 until the stage-3 boss's
        // heads -- `boss3.bin` nests 17 deep and `boss3l.bin`/`b6boss3.bin`
        // 24 -- came out with 13 of their nodes, and neither weak bone.
        if (o === null || seen.has(nodePtr)) return;
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

  /**
   * Every pol file a character type's parts live in, in skeleton order --
   * the root node's first. One file for every type but `0x4B`: the stage-5
   * boss's fifteen nodes are eleven `boss5.bin` models and four
   * `boss5b.bin` ones (bones 3, 4, 10 and 11), and stage 5's script loads
   * both files (`asset_load_polfile` 208 and 25) before it spawns class
   * 0x32. A character whose parts disagree is still one character: each
   * node draws its own slot, which the slot table resolves to its own file.
   */
  characterAssetFiles(charType: number): string[] {
    const slots = this.assetSlots();
    const files: string[] = [];
    for (const n of this.characterSkeleton(charType)) {
      const rec = slots.get(n.slot);
      if (rec && !files.includes(rec[0])) files.push(rec[0]);
    }
    return files;
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
  /** A tex/ bank's name without `.bin`, by bank index. */
  bankName(index: number): string | null {
    const ptr = this.ru32(TEX_NAME_TABLE + index * 4);
    const name = ptr ? this.cstr(ptr) : null;
    return name && name.endsWith(".bin") ? name.slice(0, -4) : null;
  }

  /** Palette `index` of `g_texture_palette_table`: sixteen ARGB1555. */
  palette(index: number): number[] | null {
    const r = this.v2r(PALETTE_TABLE + 2 + index * 12);
    if (r === null) return null;
    if (i16(this.data, r) !== 16) return null;
    const pr = this.v2r(u32(this.data, r + 2));
    if (pr === null) return null;
    const out: number[] = [];
    for (let i = 0; i < 16; i++) out.push(u16(this.data, pr + i * 2));
    return out;
  }

  /**
   * `[bank, entry, palette]` for a `DrawScreenSprite` id.
   *
   * The bank and the global slot are the two tables at 0x0057A5BC and
   * 0x0057D448; the entry is the bank's descriptor carrying that slot. A PAL4
   * entry's palette is `TexBankPaletteIndex`'s, and null when that bank's arm
   * is not transcribed.
   */
  screenSprite(spriteId: number):
      [string, TexEntry, number[] | null] | null {
    if (spriteId < 0 || spriteId >= SCREEN_SPRITE_COUNT) return null;
    const bank = this.ru32(SCREEN_SPRITE_BANK + spriteId * 4);
    const slot = this.ru32(SCREEN_SPRITE_TEX_SLOT + spriteId * 4);
    const name = bank !== null ? this.bankName(bank) : null;
    if (name === null) return null;
    const entry = this.entries(name).find((e) => e.slot === slot);
    if (!entry) return null;
    let pal: number[] | null = null;
    if (entry.layout === LAYOUT_PAL4) {
      const fixed = BANK_PALETTE_CONST.get(bank!);
      const table = BANK_PALETTE_INDEX.get(bank!);
      if (fixed !== undefined) {
        pal = this.palette(fixed);
      } else if (table !== undefined) {
        const r = this.v2r(table + entry.index * 2);
        if (r !== null) pal = this.palette(i16(this.data, r));
      }
    }
    return [name, entry, pal];
  }

  /**
   * The game-over screen's `.rdata`, for `script.json`'s `game_over` block.
   *
   * * `body_char_types` -- `0x00579F50`, s32[2]: each player's body type,
   *   `PlayerBodiesCreate`'s (`FUN_00416450`).
   * * `body_start_motions` -- `0x004EC8A4`, s32[2]: the motion a body is made
   *   on. `fall_motions` -- `0x004EC8B4`, s32[2]: the one
   *   `PlayerStateArmGameOver` puts it on in app state 7.
   * * `fall_frames` -- `0x004EC8C4`, s32[2]: with two players, the fly-over
   *   path frame each body starts falling at.
   * * `body_offsets` -- `0x00579EA8`, four `{f32 x, _, f32 z}`, indexed
   *   `p - 2 + players * 2`: where `GameOverPlaceBody` stands each body.
   * * `route_tiles` -- `0x005679FC`, s16[4]: the first sprite id of each of
   *   the route map's four 640x480 screens, 5x15 tiles of 128x32.
   * * `route_waypoints` -- `0x00567A04`, `[stage][block 0..0x26][6]` of
   *   `{s16 x, s16 y}`, the map point each block's walk visits; x -1 ends a
   *   block's list. `RouteMapDrawTask` (`FUN_00461180`) indexes it
   *   `((wp + (stage * 0x27 + block) * 6) * 4)`.
   * * `default_route` -- `0x0059351C`, s8[6][16]: the route
   *   `GameOverRouteMapArm` (`FUN_00460F00`) copies over an empty history.
   *
   * All `[proved]` from the routines named.
   */
  gameOverTables(): Record<string, unknown> {
    const s32 = (va: number, n: number) =>
      Array.from({ length: n }, (_u, i) => this.ri32(va + i * 4) ?? 0);
    const s16 = (va: number) => {
      const v = this.ru16(va) ?? 0;
      return v >= 0x8000 ? v - 0x10000 : v;
    };
    const s8 = (va: number) => {
      const r = this.v2r(va);
      if (r === null) return -1;
      const v = this.data[r];
      return v >= 0x80 ? v - 0x100 : v;
    };
    const offsets = Array.from({ length: 4 }, (_u, i) =>
      [this.rf32(0x00579ea8 + i * 12) ?? 0,
       this.rf32(0x00579ea8 + i * 12 + 8) ?? 0]);
    const waypoints = Array.from({ length: 6 }, (_s, st) =>
      Array.from({ length: 0x27 }, (_b, blk) =>
        Array.from({ length: 6 }, (_w, wp) => {
          const va = 0x00567a04 + ((wp + (st * 0x27 + blk) * 6) * 4);
          return [s16(va), s16(va + 2)];
        })));
    const route = Array.from({ length: 6 }, (_s, st) =>
      Array.from({ length: 16 }, (_i, i) => s8(0x0059351c + st * 16 + i)));
    return {
      body_char_types: s32(0x00579f50, 2),
      body_start_motions: s32(0x004ec8a4, 2),
      fall_motions: s32(0x004ec8b4, 2),
      fall_frames: s32(0x004ec8c4, 2),
      body_offsets: offsets,
      route_tiles: Array.from({ length: 4 }, (_u, i) => s16(0x005679fc + i * 2)),
      route_waypoints: waypoints,
      default_route: route,
    };
  }

  /**
   * Class 0x19's `.rdata` -- the stage-4 boss's tables, for `script.json`'s
   * `boss4` block. Every one is `[proved]` from the routine named beside it;
   * see `docs/re/boss-strength.md` for the readings.
   *
   * * `phase_hp_fraction` -- `g_boss4_phase_hp_fraction`, `0x00570490`,
   *   f32[18]: the floor of each phase as a fraction of `obj+0x11E`
   *   (`Boss4StateEntranceCarried`, `Boss4ArmPhaseWhenInsideArena`,
   *   `Boss4AdvancePhaseAtFloor`).
   * * `head_damage` -- `g_boss4_head_damage`, `0x005704D7`, s8[33], indexed
   *   `g_players_in_play + rank * 2` (`Boss4ResolveShot`).
   * * `held_props` -- `g_boss4_held_props`, `0x005704F8`, two 0x20-byte
   *   records `{f32 offset[3]; s32 rx, ry, rz; s16 bone, clip, take, throw}`
   *   (`Boss4AdvanceMotionAndDrawHeldProps`, `Boss4StateThrowHeldProp`).
   * * `camera_cues` -- `g_boss4_camera_cues`, `0x00570538`, 22 x 12 bytes
   *   `{s16 start, s16 end, f32 step, s16 path, s16 pad}`
   *   (`Boss4PlayCameraCue`).
   * * `phase_arenas` -- `g_boss4_phase_arenas`, `0x00570640`, 18 x 6 x
   *   `{f32 x, f32 z}` (`Boss4LoadPhaseArena`).
   * * `head_slot_by_bar` -- `g_boss4_head_slot_by_bar`, `0x005709A0`, s16[9]
   *   (`Boss4ResolveShot`'s head swap).
   * * `approach_picks` -- `g_boss4_approach_picks`, `0x005709B4`, s8[16][9]
   *   (`Boss4PickApproachAttack`).
   */
  boss4Tables(): Record<string, unknown> {
    const s8 = (va: number): number => {
      const r = this.v2r(va);
      if (r === null) return 0;
      const v = this.data[r];
      return v >= 0x80 ? v - 0x100 : v;
    };
    const s16 = (va: number): number => {
      const v = this.ru16(va) ?? 0;
      return v >= 0x8000 ? v - 0x10000 : v;
    };
    const f = (va: number): number => this.rf32(va) ?? 0;
    const heldProp = (i: number): Record<string, unknown> => {
      const b = 0x005704f8 + i * 0x20;
      return {
        offset: [f(b), f(b + 4), f(b + 8)],
        rot: [this.ri32(b + 0x0c) ?? 0, this.ri32(b + 0x10) ?? 0,
              this.ri32(b + 0x14) ?? 0],
        bone: s16(b + 0x18), clip: s16(b + 0x1a),
        take: s16(b + 0x1c), throw: s16(b + 0x1e),
      };
    };
    return {
      phase_hp_fraction: Array.from({ length: 18 },
                                    (_u, i) => f(0x00570490 + i * 4)),
      head_damage: Array.from({ length: 33 }, (_u, i) => s8(0x005704d7 + i)),
      held_props: [heldProp(0), heldProp(1)],
      camera_cues: Array.from({ length: 22 }, (_u, i) => {
        const b = 0x00570538 + i * 12;
        return { start: s16(b), end: s16(b + 2), step: f(b + 4),
                 path: s16(b + 8) };
      }),
      phase_arenas: Array.from({ length: 18 }, (_p, ph) =>
        Array.from({ length: 6 }, (_q, k) => {
          const b = 0x00570640 + (ph * 6 + k) * 8;
          return [f(b), f(b + 4)];
        })),
      head_slot_by_bar: Array.from({ length: 9 },
                                   (_u, i) => s16(0x005709a0 + i * 2)),
      approach_picks: Array.from({ length: 16 }, (_r, rank) =>
        Array.from({ length: 9 }, (_u, i) => s8(0x005709b4 + rank * 9 + i))),
    };
  }

  /**
   * Class 0x2D's `.rdata` -- the stage-6 boss's tables, for `script.json`'s
   * `class2d` block. Each is `[proved]` from the routine named in its
   * `ghidra/annotations/globals.tsv` row, and every length is the reader's
   * own bound (an index's range, or the next table's start), not a search
   * for the table's end (L6). See `docs/re/boss-emperor.md`.
   */
  class2dTables(): Record<string, unknown> {
    const s16 = (va: number): number => {
      const v = this.ru16(va) ?? 0;
      return v >= 0x8000 ? v - 0x10000 : v;
    };
    const u8 = (va: number): number => {
      const r = this.v2r(va);
      return r === null ? 0 : this.data[r];
    };
    const f = (va: number): number => this.rf32(va) ?? 0;
    const i32 = (va: number): number => this.ri32(va) ?? 0;
    const vec = (va: number): number[] => [f(va), f(va + 4), f(va + 8)];
    const run = <T>(n: number, g: (i: number) => T): T[] =>
      Array.from({ length: n }, (_u, i) => g(i));
    return {
      charge_arrive_dist: f(0x0055ccd4),
      hit_damage: run(3, (i) => s16(0x0055ccd6 + i * 2)),
      waypoints: run(5, (i) => vec(0x0055cce0 + i * 12)),
      attack_picks: run(16, (r) => run(10, (i) => i32(0x0055cd1c + (r * 10 + i) * 4))),
      stagger_hits: run(3, (i) => s16(0x0055cf9a + i * 2)),
      charge_steps: run(16, (i) => s16(0x0055cfa0 + i * 2)),
      child_kind_picks: run(4, (r) => run(10, (i) => i32(0x0055cfc0 + (r * 10 + i) * 4))),
      path_segments: run(8, (i) => {
        const b = 0x0055d060 + i * 0x18;
        return { step: f(b), advance: f(b + 4), strike: f(b + 8), end: f(b + 0xc),
                 words: run(4, (k) => s16(b + 0x10 + k * 2)) };
      }),
      child_offsets: run(5, (i) => vec(0x0055d120 + i * 12)),
      launch_gap: run(16, (i) => s16(0x0055d1b8 + i * 2)),
      flight_frames: run(16, (i) => s16(0x0055d1d8 + i * 2)),
      pair_flight_frames: run(16, (i) => s16(0x0055d1f8 + i * 2)),
      child0_path_start: run(2, (i) => s16(0x0055d234 + i * 2)),
      child_bone_satellite: run(16, (i) => u8(0x0055d238 + i)),
      child2_approach: run(16, (i) => s16(0x0055d248 + i * 2)),
      child2_bone_satellite: run(28, (i) => u8(0x0055d268 + i)),
      child3_approach: run(16, (i) => s16(0x0055d284 + i * 2)),
    };
  }

  /**
   * `g_carrier2_door_yaw` -- `0x005926D0`, s16[59]: the angle
   * `CarrierPropRoutine2` (`FUN_004408A0`) swings its two doors through, one
   * entry a frame, `door0 = 0xC000 + t[i]`, `door1 = 0xC000 - t[i]`. Entry 58
   * (`0x00592744`) is also what selector 9 seats them at, already open.
   */
  carrierDoorYaw(): number[] {
    return Array.from({ length: 59 }, (_u, i) => {
      const v = this.ru16(0x005926d0 + i * 2) ?? 0;
      return v >= 0x8000 ? v - 0x10000 : v;
    });
  }

  /**
   * The result card's `.rdata`, for `script.json`'s `result_card` block
   * (`docs/re/stage-end.md`).
   *
   * * `base`, `bytes` -- `0x0055DD80..0x0055E074` as one hex span:
   *   `g_result_figure_records` (0x14-byte `{s16 type, s16 motion, f32 x, y,
   *   z, s32 yaw}`, four lists), the six `g_result_figure_lists` pointers,
   *   `g_result_figure_attachments` (s16[3] per type from 0x20), the four
   *   glyph strings and `g_result_life_bonus` (u8[6][8]). One span because
   *   `ResultCardInstall` (`FUN_00434EF0`) reads a scene's records with no
   *   bound and `ResultCardFigureInit` (`FUN_004356A0`) the attachment lists
   *   with none: a read past a table reads the next, and the port reads the
   *   same bytes.
   * * `lists` -- `g_result_figure_lists`, `0x0055DF50`, u32[6], decoded.
   * * `accuracy_bonus` -- `g_accuracy_bonus_table`, `0x00567990`, s16, and
   *   the words after it up to `0x005679FC`: `EvtOpAwardAccuracyBonus2B`
   *   (`FUN_0045FE40`) indexes it by `(hits*100/shots)/10` unbounded, which
   *   passes the table's eleven entries whenever hits outrun counted shots.
   */
  resultCardTables(): Record<string, unknown> {
    const base = 0x0055dd80;
    const end = 0x0055e074;
    let hex = "";
    for (let va = base; va < end; va++) {
      const r = this.v2r(va);
      const b = r === null ? 0 : this.data[r];
      hex += b.toString(16).padStart(2, "0");
    }
    return {
      base,
      bytes: hex,
      lists: Array.from({ length: 6 }, (_u, i) =>
        this.ru32(0x0055df50 + i * 4) ?? 0),
      accuracy_bonus: Array.from({ length: (0x005679fc - 0x00567990) / 2 },
        (_u, i) => {
          const v = this.ru16(0x00567990 + i * 2) ?? 0;
          return v >= 0x8000 ? v - 0x10000 : v;
        }),
    };
  }

  /**
   * The options screen's `.rdata` (app state `0x0C`, `OptionsRunPhase`,
   * `0x004869E0`), for `script.json`'s `options` block. Every field is read
   * by the routine named beside it; `docs/re/options-screen.md` has the
   * readings.
   *
   * * `rows` -- `g_options_rows`, `0x005696E0`: eleven `{row*, handler}`
   *   pairs, each row `{s8 col, s8 row, pad[2], char *label}`
   *   (`OptionsDrawListTask`). Read through the pointers, as the draw does;
   *   the record at `0x00569680` ("OPTIONS") is named by nothing and is left
   *   out (L6).
   * * `difficulty_labels` -- `0x00569758 + v*10`, five (`OptionsRowDifficulty`).
   * * `digits` -- `0x00569738 + d*2`, "0".."9" (`OptionsRowLife` reads it
   *   from `+2`, so its "1".."5"; `OptionsRowContinue` from `+0`).
   * * `blood_labels` -- `0x0056974C + v*6`, two (`OptionsRowBloodColor`).
   * * `free_play` -- `0x005971F8`, and `number` -- `0x00597204`, "No."
   *   (`OptionsRowContinue`, the two sound-test rows).
   * * `glyphs` -- `g_options_glyphs`, `0x0056AF10`, s16[96]: the sprite of
   *   each character `0x20`..`0x7F` (`OptionsDrawText`'s
   *   `[char*2 + 0x56AED0]`; below `0x20` that address is the sound-test
   *   table's tail, which no character reaches).
   * * `crosshair_sprites` -- `g_crosshair_sprites`, `0x00579F58`, s16[2][4]:
   *   by player, by the Sight Graphic setting (`OptionsRowSightGraphic`,
   *   `HudDrawCrosshair`).
   * * `se_test` / `se_test_packs` -- `g_options_se_test`, `0x00569798`,
   *   751 `{u32 id, s32 pack}` (`OptionsRowSoundTestSe`: 0..`0x2EE`).
   * * `music_test` -- `g_options_music_test`, `0x005970C4`, u32[19]
   *   (`OptionsRowSoundTestMusic`: 0..`0x12`).
   * * `sight_speed_sprites` -- `0x0056AFE0`, s16[4]: each player's knob,
   *   then each player's slider (`OptionsSightSpeedAdjust`).
   */
  optionsTables(): Record<string, unknown> {
    const s8 = (va: number) => {
      const r = this.v2r(va);
      if (r === null) return 0;
      const v = this.data[r];
      return v >= 0x80 ? v - 0x100 : v;
    };
    const s16 = (va: number) => {
      const v = this.ru16(va) ?? 0;
      return v >= 0x8000 ? v - 0x10000 : v;
    };
    const rows = Array.from({ length: 11 }, (_u, i) => {
      const p = this.ru32(0x005696e0 + i * 8) ?? 0;
      return { col: s8(p), row: s8(p + 1),
               label: this.cstr(this.ru32(p + 4) ?? 0) ?? "" };
    });
    return {
      rows,
      difficulty_labels: Array.from({ length: 5 },
        (_u, i) => this.cstr(0x00569758 + i * 10) ?? ""),
      digits: Array.from({ length: 10 },
        (_u, i) => this.cstr(0x00569738 + i * 2) ?? ""),
      blood_labels: Array.from({ length: 2 },
        (_u, i) => this.cstr(0x0056974c + i * 6) ?? ""),
      free_play: this.cstr(0x005971f8) ?? "",
      number: this.cstr(0x00597204) ?? "",
      glyphs: Array.from({ length: 96 }, (_u, i) => s16(0x0056af10 + i * 2)),
      crosshair_sprites: Array.from({ length: 8 },
        (_u, i) => s16(0x00579f58 + i * 2)),
      se_test: Array.from({ length: 0x2ef },
        (_u, i) => this.ru32(0x00569798 + i * 8) ?? 0),
      se_test_packs: Array.from({ length: 0x2ef },
        (_u, i) => this.ri32(0x0056979c + i * 8) ?? -1),
      music_test: Array.from({ length: 0x13 },
        (_u, i) => this.ru32(0x005970c4 + i * 4) ?? 0),
      sight_speed_sprites: Array.from({ length: 4 },
        (_u, i) => s16(0x0056afe0 + i * 2)),
    };
  }

  /**
   * Original Mode's `.rdata`: the weapon records the carried items load, the
   * fire and ammo-readout rows their fire mode picks, and the trunk's four
   * tables. One block for the whole game, as `optionsTables` is. `[proved]`
   * readers, and the rows each one can reach:
   *
   * * `g_original_weapon_records` `0x004EC928`, 8 bytes a row, row
   *   `item + 1` (row 0 the bare gun): `OriginalItemsApply` (`FUN_00415FE0`)
   *   for items 0..0xD, so fifteen rows. The block's `+0x08` dword and
   *   `+0x0C` float come out of it; `ResetOriginalModeLoadout` writes row 0's
   *   values as immediates. Bounded by `g_original_weapon_gunshot_ids` at
   *   `0x004EC9A0`.
   * * `g_original_fire_params` `0x00579ED8` and `g_original_ammo_hud_rows`
   *   `0x004ECA20`, by `g_original_fire_mode`, whose writers store 0..3, 0xC
   *   and 0xD (`OriginalItemsApply`'s three `MOV byte ptr [ESI + 0x7]`), so
   *   fourteen rows each.
   * * `g_original_item_category` `0x0056AFF0` (33 s8) and
   *   `g_original_item_compat` `0x0056B014` (13 x 13), read together by
   *   `ItemSelectUpdate` (`FUN_00488820`) as `compat[cat[new] * 13 +
   *   cat[held]]`; the categories run 0..12.
   * * `g_item_select_cursor_colours` `0x0056B0C0`, one light colour a player
   *   (`ItemSelectDrawPanels`, `FUN_00489830`, `[EAX + 0x56b0c0]` with
   *   `EAX = player * 12`).
   * * `g_original_item_list_sprites` `0x0059721C`, 33 s16 by item id, the
   *   trunk list's label and a carried item's.
   */
  originalModeTables(): Record<string, unknown> {
    const s8 = (va: number) => {
      const r = this.v2r(va);
      if (r === null) return 0;
      const v = this.data[r];
      return v >= 0x80 ? v - 0x100 : v;
    };
    const u8 = (va: number) => {
      const r = this.v2r(va);
      return r === null ? 0 : this.data[r];
    };
    const s16 = (va: number) => {
      const v = this.ru16(va) ?? 0;
      return v >= 0x8000 ? v - 0x10000 : v;
    };
    return {
      weapon_records: Array.from({ length: 15 }, (_u, i) => {
        const a = 0x004ec928 + i * 8;
        return { magazine: s8(a), kind: s8(a + 1), sound: s8(a + 2),
                 flags: s8(a + 3), damage: this.rf32(a + 4) ?? 0 };
      }),
      fire_params: Array.from({ length: 14 }, (_u, i) =>
        Array.from({ length: 8 }, (_v, k) => u8(0x00579ed8 + i * 8 + k))),
      ammo_hud_rows: Array.from({ length: 14 }, (_u, i) => {
        const a = 0x004eca20 + i * 12;
        return { sprite: s16(a), spacing: this.rf32(a + 4) ?? 0,
                 dy: this.rf32(a + 8) ?? 0 };
      }),
      item_category: Array.from({ length: 33 }, (_u, i) => s8(0x0056aff0 + i)),
      item_compat: Array.from({ length: 13 * 13 },
        (_u, i) => u8(0x0056b014 + i)),
      cursor_colours: Array.from({ length: 2 }, (_u, p) =>
        [0, 1, 2].map((k) => this.rf32(0x0056b0c0 + p * 12 + k * 4) ?? 0)),
      list_sprites: Array.from({ length: 33 },
        (_u, i) => s16(0x0059721c + i * 2)),
      // `g_original_weapon_gunshot_ids` / `_reload_ids`, eight u32 each,
      // by `g_original_weapon_sound_kind` (0..7): contiguous, so each is
      // bounded by the next.
      gunshot_ids: Array.from({ length: 8 },
        (_u, i) => this.ru32(0x004ec9a0 + i * 4) ?? 0),
      reload_ids: Array.from({ length: 8 },
        (_u, i) => this.ru32(0x004ec9c0 + i * 4) ?? 0),
    };
  }

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

  /**
   * `g_water_surface_slots` -- `0x00593DA4`, the ten canal water tiles class
   * 0x41's type-1 constructor `PlaceWaterSurface` (`FUN_00462F70`) indexes by
   * the placer's `obj+0x1F4` (`MOVSX ECX, word ptr [EAX*2 + 0x593DA4]`).
   * Ten, because `g_prop_kind_params` begins at `0x00593DB8`.
   */
  waterSurfaceSlots(): number[] {
    return this.cached("waterSurfaceSlots", () => {
      const base = this.v2r(ExeTables.WATER_SURFACE_SLOTS);
      if (base === null) return [];
      const out: number[] = [];
      for (let i = 0; i < ExeTables.WATER_SURFACE_SLOT_COUNT; i++) {
        out.push(i16(this.data, base + i * 2));
      }
      return out;
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

  /**
   * One row of `g_original_item_tables[scene]`: four s8 item ids and four s8
   * cumulative weights, as `PickOriginalModeItem` (`FUN_004629C0`) reads
   * them (`MOVSX ECX, byte ptr [EDI + 0x7]` is the modulus). `null` when the
   * scene has no table or the row is off the end of the image.
   */
  originalItemRow(scene: number, row: number):
      { ids: number[]; weights: number[] } | null {
    const at = this.v2r(ExeTables.ORIGINAL_ITEM_TABLES + scene * 4);
    if (at === null || at + 4 > this.data.length) return null;
    const base = this.v2r(u32(this.data, at));
    if (base === null) return null;
    const o = base + row * 8;
    if (o + 8 > this.data.length) return null;
    const s8 = (k: number) => (this.data[o + k] << 24) >> 24;
    return { ids: [0, 1, 2, 3].map(s8), weights: [4, 5, 6, 7].map(s8) };
  }

  /**
   * `g_original_item_records[id]`: `{u16 slot, u16 slot2, f32 scale, u16
   * sprite}`, which `PickOriginalModeItem` copies to `obj+0x28C`, `+0x28E`
   * and `+0x2C4` and `OriginalItemPropUpdate` hands `SpawnOriginalItemBanner`
   * (`+0x08`, `MOVSX EDX, word ptr [ECX*4 + 0x5957e0]`).
   */
  originalItemRecord(id: number):
      { slot: number; slot2: number; scale: number; sprite: number } | null {
    const base = this.v2r(ExeTables.ORIGINAL_ITEM_RECORDS);
    if (base === null || id < 0) return null;
    const o = base + id * 0xc;
    if (o + 0xc > this.data.length) return null;
    return {
      slot: u16(this.data, o),
      slot2: u16(this.data, o + 2),
      scale: f32(this.data, o + 4),
      sprite: i16(this.data, o + 8),
    };
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

  /** The 55-point hull a falling container's two pieces come to rest on. */
  fragmentHullPoints(): [number, number, number][] {
    return this.hullPoints(ExeTables.FRAGMENT_HULL,
                           ExeTables.FRAGMENT_HULL_POINTS);
  }

  /**
   * What `BreakablePropSpawnShatter` and `BreakablePropShatterUpdate` read per
   * piece: the two slot tables, and the offset (thousandths, left raw) and
   * `Rz Ry Rx` angles (BAMS) each piece starts at relative to the prop.
   */
  shatterPieces(): { slots_a: number[]; slots_b: number[];
                     offsets: [number, number, number][];
                     angles: [number, number, number][] } {
    const n = ExeTables.SHATTER_PIECES;
    const s16s = (va: number, count: number): number[] => {
      const base = this.v2r(va);
      if (base === null) return [];
      const out: number[] = [];
      for (let i = 0; i < count && base + i * 2 + 2 <= this.data.length; i++) {
        out.push(i16(this.data, base + i * 2));
      }
      return out;
    };
    const triples = (va: number): [number, number, number][] => {
      const flat = s16s(va, n * 3);
      const out: [number, number, number][] = [];
      for (let i = 0; i + 2 < flat.length; i += 3) {
        out.push([flat[i], flat[i + 1], flat[i + 2]]);
      }
      return out;
    };
    return {
      slots_a: s16s(ExeTables.SHATTER_SLOTS_A, n),
      slots_b: s16s(ExeTables.SHATTER_SLOTS_B, n),
      offsets: triples(ExeTables.SHATTER_OFFSETS),
      angles: triples(ExeTables.SHATTER_ANGLES),
    };
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

  static readonly LOOPING_SE_IDS = 0x005887fc;
  static readonly LOOPING_SE_STOP_IDS = 0x005888b0;
  static readonly LOOPING_SE_TERMINATOR = 0xffffffff;

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
   * The looping SE, and what stops each one.
   *
   * `PlaySoundId` (`0x0041CFD0`) has a branch nothing in this player had read:
   * before it hands the file to `SoundPlayOnFreeChannel` it walks these two
   * tables in step, and an id found in the first is played **looped** while an
   * id found in the second makes it call `SoundStopAllLoopingSe()` first. That
   * is the whole of the game's looping ambience — there is no handle, no
   * channel id and no per-actor state; one call starts a chainsaw and another
   * stops every loop in the mix.
   *
   * Neither table stores a count and neither is bounded by the other: both are
   * walked to a `0xFFFFFFFF` terminator, 44 entries, paired index for index.
   * Seven ids appear twice in the play table, which is harmless because the
   * engine's walk stops at the first match — and so does the player's.
   *
   * Every one of the 44 pairs is `X.wav` against `X_OFF.wav`, which is what
   * proves the pairing rather than the two tables merely being adjacent.
   */
  loopingSe(): { play: number; stop: number }[] {
    return this.cached("loopingSe", () => {
      const a = this.v2r(ExeTables.LOOPING_SE_IDS);
      const b = this.v2r(ExeTables.LOOPING_SE_STOP_IDS);
      const out: { play: number; stop: number }[] = [];
      if (a === null || b === null) return out;
      for (let i = 0; i < 256; i++) {
        if (a + i * 4 + 4 > this.data.length) break;
        if (b + i * 4 + 4 > this.data.length) break;
        const play = u32(this.data, a + i * 4);
        if (play === ExeTables.LOOPING_SE_TERMINATOR) break;
        out.push({ play, stop: u32(this.data, b + i * 4) });
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
