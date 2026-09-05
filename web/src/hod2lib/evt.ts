/**
 * `evt/` event tables. The port of `tools/hod2lib/evt.py`.
 *
 * The files are raw memory images captured from the NAOMI/Dreamcast build.
 * They still contain absolute SH-4 RAM pointers, which the PC port patches at
 * load time with a single relocation pass (`FUN_00413120`):
 *
 *     for each dword w in file:
 *         if (w & 0xFFF80000) == 0x0CE80000:
 *             w += 0xF3AC1A00          // i.e. w -= 0x0C53E600
 *
 * That is the whole fixup scheme: any dword landing in the 512 KB window
 * `0x0CE80000..0x0CEFFFFF` is a pointer, everything else is payload. No
 * relocation table, no tagging -- the loader relies on the original data never
 * containing a non-pointer in that window.
 *
 * Two buffers receive event data, at fixed PC addresses:
 *
 *     comevtbl.bin  -> 0x00977200   (DC 0x0CEB5800)
 *     <stage>evtbl  -> 0x00977400   (DC 0x0CEB5A00)
 *
 * The bytecode itself is executed by `FUN_0045ecc0`; every handler advances
 * `pc` itself, so operand length is per-opcode and the {@link OPCODES} table
 * below is transcribed from those 96 handlers.
 *
 * Reference: docs/formats/evt.md
 */

import { f32, i16, i32, u16, u32 } from "./bytes";

// ---------------------------------------------------------------------------
// relocation
// ---------------------------------------------------------------------------

export const RELOC_MASK = 0xfff80000;
export const RELOC_TAG = 0x0ce80000;
/** Add, mod 2**32; equivalently subtract 0x0C53E600. */
export const RELOC_ADD = 0xf3ac1a00;
export const RELOC_SUB = 0x0c53e600;

/** PC-side load addresses, from FUN_00413070 / FUN_00413160. */
export const PC_BASE_COM = 0x00977200;
export const PC_BASE_STAGE = 0x00977400;

/** Dreamcast-side load addresses (PC address + RELOC_SUB). */
export const DC_BASE_COM = PC_BASE_COM + RELOC_SUB;      // 0x0CEB5800
export const DC_BASE_STAGE = PC_BASE_STAGE + RELOC_SUB;  // 0x0CEB5A00

/** comevtbl occupies the 0x200 bytes below the stage table. */
export const COM_RESERVED = PC_BASE_STAGE - PC_BASE_COM;

/** True if *word* is a Dreamcast pointer the loader would relocate. */
export function isPointer(word: number): boolean {
  return ((word & RELOC_MASK) >>> 0) === RELOC_TAG;
}

/** Apply the loader's fixup to a single dword. */
export function relocate(word: number): number {
  return isPointer(word) ? (word + RELOC_ADD) % 0x100000000 : word;
}

// ---------------------------------------------------------------------------
// opcode table
// ---------------------------------------------------------------------------

/**
 * Operand-length classes:
 *
 * * `fix`   -- fixed size, n = total dwords consumed including the opcode
 * * `list`  -- `[op][arg ...][-1]`
 * * `var`   -- `[op][list ...][-1]` repeated, selected by a global, ended by -2
 * * `queue` -- `[op][id][...]`; total = `2 + (id >> 4)` (FUN_0045F7F0)
 * * `tween` -- `[op][sub][...]`; size depends on sub-opcode
 * * `set`   -- `[op][sub][...]`; ApplyLightChannelOperand sub-opcode sizes
 * * `halt`  -- does not advance pc
 * * `next`  -- replaces pc entirely (end of block)
 * * `bad`   -- maps to the empty stub, never legitimately encoded
 */
export type OpKind = "fix" | "list" | "var" | "queue" | "tween" | "set"
  | "halt" | "next" | "bad";

export type Op = [name: string, kind: OpKind, n: number];

/**
 * Names and semantics are recovered from each handler and, where the handler
 * only writes a global, from that global's *consumers*. The authoritative
 * write-up with per-row evidence and confidence marks is docs/formats/evt.md.
 *
 * Operand sizes below were validated independently of the names: 17,150
 * instructions across every shipped file decode with zero errors and no stub
 * opcode is ever reached.
 */
export const OPCODES: Record<number, Op> = {
  0x00: ["nop_stub", "bad", 0],
  // 0x01-0x08 are 0x09/0x0A/0x0B/0x0C behind a player-count gate, and nothing
  // else: EvtOpSpawnIfOnePlayer and EvtOpSpawnIfTwoPlayers test
  // g_max_attackers against 1 or 2 and either tail-jump into
  // g_evt_spawn_gated_handlers[opcode] or walk the operand list to its -1 and
  // skip it.
  0x01: ["spawn_placed_if_1p", "list", 0],
  0x02: ["spawn_simple_if_1p", "list", 0],
  0x03: ["spawn_obj_if_1p", "list", 0],
  0x04: ["spawn_obj_c_if_1p", "list", 0],
  0x05: ["spawn_placed_if_2p", "list", 0],
  0x06: ["spawn_simple_if_2p", "list", 0],
  0x07: ["spawn_obj_if_2p", "list", 0],
  0x08: ["spawn_obj_c_if_2p", "list", 0],
  0x09: ["spawn_placed", "list", 0],      // FUN_004088A0 -- the spawn opcode
  0x0a: ["spawn_simple", "list", 0],      // FUN_00408990
  0x0b: ["spawn_obj", "list", 0],         // FUN_00408AA0
  0x0c: ["spawn_obj_c", "list", 0],       // FUN_00408C40
  0x0d: ["spawn_obj_unless_skip", "list", 0],  // FUN_00408B70
  // 0x0E/0x0F/0x12 are the enemy approach-distance pacing table, not spawn
  // ids. 0x0E's operands are FLOATS -- the ROM defaults decode as {25,38,51},
  // which as integers would be 0x41C80000.
  0x0e: ["set_approach_rings", "fix", 6],
  0x0f: ["set_approach_steps", "list", 0],
  // 0x10/0x11 carry *relocated absolute pointers* to collision-mesh blobs.
  // Set A is consulted by both the ray and the sphere queries; set B by rays
  // only.
  0x10: ["set_collision_set_full", "list", 0],
  0x11: ["set_collision_set_ray_only", "list", 0],
  0x12: ["set_approach_steps_2p_bias", "list", 0],
  0x13: ["set_scene_lighting_override", "list", 0],
  // 0x14 enables the scene light array for draw_mode 1 region entries, and
  // also gates 0x15 and 0x16.
  0x14: ["set_scene_lighting", "fix", 2],
  0x15: ["enable_entity_spotlights", "fix", 2],
  // Three float refs -> the D3D ambient colour. NOT fog.
  0x16: ["set_ambient_light_rgb", "fix", 4],
  0x17: ["slerp_light0_direction", "fix", 4],   // (pitch, yaw, frames), async
  0x18: ["set_light0_direction", "fix", 3],     // (pitch, yaw) BAMS
  0x19: ["set_light1_direction", "fix", 3],
  0x1a: ["set_ground_plane_y", "fix", 2],
  0x1b: ["set_backdrop_preset", "fix", 2],
  0x1c: ["set_backdrop_mode", "fix", 2],   // 0 off, 2 frozen, else animating
  0x1d: ["enable_rain", "fix", 2],
  // DEAD: DAT_009C8A78 has no readers anywhere in the binary.
  0x1e: ["set_unread_global", "fix", 2],
  0x1f: ["set_hud_shutter_state", "fix", 2],
  // 0x20-0x27 tween the two light/fog blocks, NOT view structs.
  0x20: ["light0_set", "set", 0],
  0x21: ["light0_tween_rate", "tween", 0],
  0x22: ["light0_stop", "fix", 2],
  0x23: ["light0_tween_time", "tween", 0],
  0x24: ["light1_set", "set", 0],
  0x25: ["light1_tween_rate", "tween", 0],
  0x26: ["light1_stop", "fix", 2],
  0x27: ["light1_tween_time", "tween", 0],
  // Region streaming, NOT sound.
  0x28: ["region_load", "fix", 2],
  0x29: ["region_enter", "fix", 2],
  0x2a: ["unused_2a", "bad", 0],
  0x2b: ["award_accuracy_bonus", "fix", 1],
  0x2c: ["set_skippable_region", "fix", 2],
  0x2d: ["play_dialogue", "fix", 2],
  0x2e: ["resume_bgm_if_skipped", "fix", 1],
  0x2f: ["suppress_accuracy_stats", "fix", 2],
  0x30: ["queue_event", "queue", 0],      // FUN_0045F7F0
  0x31: ["goto_scene_state", "fix", 2],
  0x32: ["goto_scene_state_when_alive", "fix", 2],
  0x33: ["set_action_drain_mode", "fix", 3],
  0x34: ["unused_34", "bad", 0],
  0x35: ["enable_camera_path_roll", "fix", 2],
  0x36: ["pin_view_to_ground_plane", "fix", 2],
  0x37: ["force_camera_path_advance", "fix", 2],
  0x38: ["se_play", "fix", 2],
  0x39: ["se_play_3d", "fix", 4],
  0x3a: ["se_play_unless_skip", "fix", 2],
  0x3b: ["se_play_3d_unless_skip", "fix", 4],
  0x3c: ["unused_3c", "bad", 0],
  // Pure no-ops that only advance pc. 0x3F, 0x5B and 0x5C share ONE handler
  // which never reads the opcode, so all three are identical.
  0x3d: ["nop3", "fix", 4],
  0x3e: ["nop1", "fix", 2],
  0x3f: ["nop0", "fix", 1],
  0x40: ["wait_queued_events_done", "fix", 1],
  0x41: ["wait_camera_path_frame", "fix", 2],
  0x42: ["wait_frames", "fix", 2],
  // Two distinct enemy counters: "alive" drops at kill time, "present" at
  // death-animation end, so present >= alive.
  0x43: ["wait_enemies_present", "fix", 2],
  0x44: ["wait_enemies_alive", "fix", 2],
  0x45: ["wait_script_flag", "fix", 2],
  0x46: ["wait_scripted_actors", "fix", 2],
  0x47: ["wait_targets_clear", "fix", 1],
  0x48: ["set_script_flag", "fix", 2],
  0x49: ["variant_call_a", "var", 0],
  0x4a: ["variant_call_b", "var", 0],
  0x4b: ["variant_spawn", "var", 0],
  0x4c: ["unused_4c", "bad", 0],
  0x4d: ["checkpoint", "fix", 1],
  0x4e: ["halt", "halt", 0],
  // 0x4F advances the *step*, and only reaches the route table when the step
  // list is exhausted.
  0x4f: ["advance_step", "next", 0],
  // 0x50-0x57 are the asset streaming vocabulary.
  0x50: ["asset_load_slot", "fix", 2],
  0x51: ["asset_unload_slot", "fix", 2],
  0x52: ["asset_load_polfile", "fix", 2],
  0x53: ["asset_free_polfile", "fix", 2],
  0x54: ["asset_load_texbank", "fix", 2],
  0x55: ["asset_free_texbank", "fix", 2],
  0x56: ["asset_job_8", "fix", 2],
  0x57: ["asset_job_9", "fix", 2],
  0x58: ["asset_wait_all_jobs", "fix", 1],
  0x59: ["asset_wait_tex_pol_jobs", "fix", 1],
  0x5a: ["asset_wait_motion_jobs", "fix", 1],
  0x5b: ["nop0_b", "fix", 1],             // same handler as 0x3F
  0x5c: ["nop0_c", "fix", 1],             // same handler as 0x3F
  // NAOMI sound-driver calls stubbed out for the PC port.
  0x5d: ["snd_load_pack_stub", "fix", 3],
  0x5e: ["snd_free_pack_stub", "fix", 2],
  0x5f: ["bgm_entry_play", "fix", 5],
};

/**
 * `queue_event` (0x30) selectors. `EvtRunQueuedActions` dispatches through a
 * two-level table at 0x005776EC: `handler = table[sel >> 4][sel & 0xF]`. The
 * high nibble is BOTH the group index and the operand count, so the
 * instruction is `2 + (sel >> 4)` dwords and the groups are organised by
 * arity.
 */
export const QUEUE_ACTIONS: Record<number, string> = {
  0x10: "set_player_flag",
  0x11: "scene_state",            // EvtEnterSceneState(current_major, op0)
  0x12: "set_update_routine",
  0x13: "set_continuation",       // never used
  0x14: "set_global",
  0x15: "set_flag",
  0x20: "hold_camera_preset",     // op0 frames, op1 indexes 0x00576CF0
  0x21: "finish_sequence",        // EvtEnterSceneState(2, op0)
  // (start_frame, end_frame, global_cam_path_index, flags)
  //   start_frame == -1  resume rather than seek
  //   flags & 2          stash for a later camera state 6/7 to play
  0x40: "cam_play",
  0x60: "store_six",
};

/**
 * Sub-opcode sizes for the "set" class (ApplyLightChannelOperand), in dwords,
 * including the opcode and the sub-opcode. Sub 5 and 9 take three operands.
 */
export const SET_SIZES: Record<number, number> = {
  0: 3, 1: 3, 2: 3, 3: 3, 4: 3, 5: 5, 6: 3, 7: 3, 8: 3, 9: 5, 10: 3,
};
export const SET_DEFAULT = 2;

/** FUN_0040B650 / FUN_0040BA90: every defined sub-opcode takes two operands. */
export const TWEEN_SIZES: Record<number, number> =
  Object.fromEntries([...Array(11).keys()].map((s) => [s, 4]));
export const TWEEN_DEFAULT = 2;

/** Which field of a scene light/fog block each 0x20-0x27 channel targets. */
export const CHANNELS: Record<number, string> = {
  0: "fog_near",          // +0x30
  1: "fog_far",           // +0x34
  2: "fog_r",             // +0x24
  3: "fog_g",             // +0x28
  4: "fog_b",             // +0x2c
  5: "fog_rgb",           // +0x24/+0x28/+0x2c together
  6: "light_r",           // +0x240
  7: "light_g",           // +0x244
  8: "light_b",           // +0x248
  9: "light_rgb",         // +0x240/+0x244/+0x248 together
  10: "ambient",          // +0x24c
};

/** evt opcode -> job kind pushed onto the asset queue at DAT_007DA220. */
export const ASSET_JOB_KIND: Record<number, number[]> = {
  0x50: [0, 1], 0x51: [2], 0x52: [3], 0x53: [4],
  0x54: [6], 0x55: [7], 0x56: [8], 0x57: [9],
};

/** Opcodes whose single operand is an asset slot id. */
export const SLOT_OPCODES = [0x50, 0x51];

/** Opcodes whose single operand is a pol/tex file index. */
export const FILE_OPCODES = [0x52, 0x53, 0x54, 0x55];

/** Opcodes whose single operand is a *region* id. */
export const REGION_OPCODES = [0x28, 0x29];

export const TERM = 0xffffffff;
export const TERM2 = 0xfffffffe;

export class EvtError extends Error {
  override name = "EvtError";
}

// ---------------------------------------------------------------------------
// file
// ---------------------------------------------------------------------------

export interface Instr {
  offset: number;
  opcode: number;
  name: string;
  /** Operand dwords, relocated. */
  words: number[];
  /** Operand dwords, as stored. */
  raw: number[];
}

export function instrSize(ins: Instr): number {
  return (ins.words.length + 1) * 4;
}

/** One event block: an array of step pointers, each a bytecode stream. */
export interface Block {
  index: number;
  offset: number;
  /** File offsets. */
  steps: number[];
  programs: Instr[][];
  /**
   * `[slot, dreamcast pointer]` for step entries that resolve outside this
   * file -- in practice into the shared comevtbl buffer, which sits
   * immediately below the scene table.
   */
  externalSteps: [number, number][];
}

/**
 * A relocated `evt/` table.
 *
 * `words` is the file as dwords; every pointer is rewritten to a *file offset*
 * on demand, so the structure can be walked without reference to any load
 * address.
 */
export class EvtFile {
  readonly isCom: boolean;
  readonly dcBase: number;
  readonly words: Uint32Array;
  blocks: Block[] = [];
  warnings: string[] = [];

  constructor(readonly raw: Uint8Array, readonly name = "") {
    this.isCom = name.startsWith("com");
    this.dcBase = this.isCom ? DC_BASE_COM : DC_BASE_STAGE;
    const n = Math.floor(raw.length / 4);
    this.words = new Uint32Array(n);
    for (let i = 0; i < n; i++) this.words[i] = u32(raw, i * 4);
  }

  /** Dreamcast pointer -> offset in this file, or null if not a pointer. */
  toOffset(word: number): number | null {
    if (!isPointer(word)) return null;
    return word - this.dcBase;
  }

  readable(off: number | null): boolean {
    return off !== null && off >= 0 && off < this.raw.length - 3;
  }

  w(off: number): number {
    if (off < 0 || off + 4 > this.raw.length) {
      throw new EvtError(
        `read past end of ${this.name} at 0x${off.toString(16)}`);
    }
    return this.words[off >> 2];
  }

  /**
   * Walk root table -> block tables -> bytecode.
   *
   * The root array uses `-1` as a *hole* -- a scene whose route graph never
   * visits block *i* stores -1 there -- so it is not a terminator. Pass
   * *nBlocks* from `ExeTables.sceneBlockCount` when known; otherwise the walk
   * continues while entries remain pointer-or-hole, which recovers the same
   * count on every shipped file.
   */
  parse(nBlocks: number | null = null, maxBlocks = 4096): EvtFile {
    const limit = nBlocks ?? maxBlocks;
    for (let i = 0; i < limit; i++) {
      const word = this.w(i * 4);
      if (word === TERM) {
        this.blocks.push(emptyBlock(i, -1));           // hole
        continue;
      }
      const off = this.toOffset(word);
      if (!this.readable(off)) {
        if (nBlocks === null) break;
        this.warnings.push(
          `block ${i}: bad root entry ${hex8(word)}`);
        this.blocks.push(emptyBlock(i, -1));
        continue;
      }
      const blk = emptyBlock(i, off!);
      this.parseBlock(blk);
      this.blocks.push(blk);
    }
    while (this.blocks.length && this.blocks[this.blocks.length - 1].offset < 0) {
      this.blocks.pop();
    }
    return this;
  }

  /**
   * Read a block's step table.
   *
   * A step entry that resolves outside this file is an **external**
   * reference, not a terminator: the shared `comevtbl` buffer sits immediately
   * below the scene table, so a scene can hand control to a stream living
   * there. `st1evtbl.bin` block 0 does exactly that, and treating it as the
   * end of the list silently drops the four steps that follow it.
   *
   * Only TERM, or a word that is not a pointer at all, ends the table.
   */
  private parseBlock(blk: Block): void {
    if (blk.offset < 0) return;
    let j = 0;
    while (j < 4096) {
      const word = this.w(blk.offset + j * 4);
      if (word === TERM) break;
      const off = this.toOffset(word);
      if (off === null) break;                // not a pointer: end of table
      if (!this.readable(off)) {
        blk.externalSteps.push([j, word]);
        j += 1;
        continue;
      }
      blk.steps.push(off);
      try {
        blk.programs.push(this.disasm(off));
      } catch (exc) {
        if (!(exc instanceof EvtError)) throw exc;
        this.warnings.push(exc.message);
        blk.programs.push([]);
      }
      j += 1;
    }
  }

  /** Decode one bytecode stream, stopping at halt/advance_step. */
  disasm(off: number, limit = 20000): Instr[] {
    const start = off;
    const out: Instr[] = [];
    for (let i = 0; i < limit; i++) {
      const op = this.w(off);
      const entry = OPCODES[op];
      if (entry === undefined) {
        throw new EvtError(
          `${this.name}: bad opcode 0x${op.toString(16)} at `
          + `0x${off.toString(16)} (stream from 0x${start.toString(16)})`);
      }
      const [name, kind, n] = entry;
      const size = this.size(off, kind, n);
      const raw: number[] = [];
      for (let k = 1; k < size; k++) raw.push(this.w(off + 4 * k));
      out.push({ offset: off, opcode: op, name, words: raw.map(relocate), raw });
      if (kind === "halt" || kind === "next" || kind === "bad") return out;
      off += size * 4;
    }
    throw new EvtError(
      `${this.name}: runaway stream from 0x${start.toString(16)}`);
  }

  /** Total instruction size in dwords, including the opcode. */
  private size(off: number, kind: OpKind, n: number): number {
    if (kind === "fix") return n;
    if (kind === "halt" || kind === "bad" || kind === "next") return 1;
    if (kind === "list") {
      let k = 1;
      while (this.w(off + k * 4) !== TERM) {
        k += 1;
        if (k > 8192) {
          throw new EvtError(
            `${this.name}: unterminated list at 0x${off.toString(16)}`);
        }
      }
      return k + 1;
    }
    if (kind === "var") {
      // one or more TERM-separated lists, the whole run closed by TERM2
      let k = 1;
      for (;;) {
        if (this.w(off + k * 4) === TERM2) return k + 1;
        k += 1;
        if (k > 16384) {
          throw new EvtError(
            `${this.name}: unterminated variant at 0x${off.toString(16)}`);
        }
      }
    }
    if (kind === "queue") return 2 + (this.w(off + 4) >>> 4);
    if (kind === "set") return SET_SIZES[this.w(off + 4)] ?? SET_DEFAULT;
    if (kind === "tween") return TWEEN_SIZES[this.w(off + 4)] ?? TWEEN_DEFAULT;
    throw new EvtError(`unknown kind ${kind}`);
  }
}

function emptyBlock(index: number, offset: number): Block {
  return { index, offset, steps: [], programs: [], externalSteps: [] };
}

function hex8(v: number): string {
  return (v >>> 0).toString(16).toUpperCase().padStart(8, "0");
}

/** `"%06X  %02X %-24s %s"`, the reference implementation's `repr`. */
export function formatInstr(ins: Instr): string {
  const args = ins.words.map(hex8).join(" ");
  return `${ins.offset.toString(16).toUpperCase().padStart(6, "0")}  `
    + `${ins.opcode.toString(16).toUpperCase().padStart(2, "0")} `
    + `${ins.name.padEnd(24)} ${args}`;
}

// ---------------------------------------------------------------------------
// spawn descriptors (opcode 0x09)
// ---------------------------------------------------------------------------

/**
 * Spawn descriptor header, 0x24 bytes, identical for opcodes 0x09, 0x0B and
 * 0x0C:
 *
 *     +0x00  u32  class index -- selects the object size from DAT_009A2280
 *     +0x04  u32  init flags  -- OR'd with 1 into object +0x34
 *     +0x08  f32  position x/y/z    -> object +0x40/+0x44/+0x48
 *     +0x14  s32  orientation a/b/c -> object +0x64/+0x68/+0x6C
 *     +0x20  u16  second flag word  -> object +0x1316, then +0x136C
 *     +0x22  u16  hit points  -- written to BOTH object +0x11C and +0x11E
 *     +0x24  ...  variable behaviour tail
 */
export const SPAWN_HEADER = 0x24;
export const SPAWN_STRIDE_09 = 0x28;

/**
 * What the descriptor's `+0x20` word means.
 *
 * **[proved]** `SpawnFromDescriptor` copies it to `obj+0x1316` and
 * `EnemyThrowerInit` makes it the low half of the class flag word
 * `obj+0x136C`. It is **sign-extended**, so a descriptor setting 0x8000 would
 * raise the whole high half; no shipped descriptor does.
 *
 * For class 0x31 the bits are the **starting surface**: 0x40 wall A, 0x80
 * wall B, 0x100 ceiling, and bit 0 the alternate part-draw entry point.
 * Class 0x30 seeds its own flag word from it the same way; the names of its
 * bits are [open] here and belong with that class.
 */
export const SPAWN_DESC_FLAGS = 0x20;

/**
 * What each player-count-gated opcode forwards to, from the table at
 * `g_evt_spawn_gated_handlers` (0x00577650). Entries 1-4 and 5-8 are the same
 * four handlers, so 0x01-0x08 are exactly 0x09/0x0A/0x0B/0x0C with a gate in
 * front and nothing else changed.
 */
export const GATED_SPAWN_FORWARD: Record<number, number> = {
  0x01: 0x09, 0x02: 0x0a, 0x03: 0x0b, 0x04: 0x0c,
  0x05: 0x09, 0x06: 0x0a, 0x07: 0x0b, 0x08: 0x0c,
};

/**
 * How many players must be in play for a gated opcode to run at all --
 * `g_max_attackers`, which is the count of players currently in a live state,
 * not a difficulty setting.
 */
export const GATED_SPAWN_PLAYERS: Record<number, number> =
  Object.fromEntries(Object.keys(GATED_SPAWN_FORWARD)
    .map((k) => [Number(k), Number(k) <= 0x04 ? 1 : 2]));

/** The handler *opcode* actually runs -- itself, unless it is gated. */
export function effectiveSpawnOpcode(opcode: number): number {
  return GATED_SPAWN_FORWARD[opcode] ?? opcode;
}

/**
 * Opcodes whose operands are pointers to spawn descriptors.
 *
 * 0x0A and its two gated forms are absent on purpose: `EvtOpSpawnSimple0A`
 * takes a two-word `{class, hp}` record, not a 0x24-byte placement descriptor,
 * so reading one as a descriptor yields a garbage position.
 */
export const SPAWN_OPCODES = [0x01, 0x03, 0x04, 0x05, 0x07, 0x08,
                              0x09, 0x0b, 0x0c, 0x0d];

/**
 * Opcodes that attach the descriptor's tail to the object as a per-class
 * parameter block. There are **three** allocators, not two, and all three end
 * with `= descriptor + 9` on an `int *`, so the tail is at `descriptor + 0x24`
 * regardless; only the object field and the allocation size differ.
 *
 * This is the set of *allocators*. The player-count-gated opcodes 0x03/0x04
 * and 0x07/0x08 reach them through {@link effectiveSpawnOpcode}, so they are
 * not listed here and must not be tested against this list directly.
 */
export const PARAM_OPCODES = [0x0b, 0x0c, 0x0d];

export type ParamKind = "i32" | "u32" | "i16" | "u16" | "i8" | "u8" | "f32";

export class Spawn {
  constructor(
    readonly offset: number,
    readonly opcode: number,
    readonly cls: number,
    readonly initFlags: number,
    readonly pos: [number, number, number],
    readonly orient: [number, number, number],
    readonly hp: number,
    /**
     * The `+0x20` word, which reaches `obj+0x1316` and from there the class
     * flag word `obj+0x136C`. Carried whole rather than bit by bit, because
     * that is what the engine does with it.
     */
    readonly descFlags: number = 0,
    /** The file this descriptor was read from, so the tail can be read lazily. */
    readonly evt: EvtFile | null = null,
  ) {}

  /**
   * Orientation b as degrees.
   *
   * **[proved] of the spawn path, NOT of every class.** All three spawn
   * allocators copy the orientation words straight to `obj+0x64/+0x68/+0x6C`,
   * the triple every object root feeds to `MatrixRotateX/Y/Z`. But a class may
   * then read those object fields as something else entirely: class 0x41 type
   * 4 takes `obj+0x6C` as an object *kind* and `obj+0x64` as a *group size*.
   */
  get yawDeg(): number {
    return this.orient[1] * 360.0 / 65536.0;
  }

  /**
   * Whether this descriptor's tail reaches the object as a parameter block --
   * true only for the opcodes that write `obj+0x1390`.
   */
  get hasParams(): boolean {
    return PARAM_OPCODES.includes(effectiveSpawnOpcode(this.opcode));
  }

  /** File offset of `obj+0x1390`: the start of the parameter tail. */
  get paramsOffset(): number {
    return this.offset + SPAWN_HEADER;
  }

  /**
   * One field of the parameter tail, at byte offset *at* within it.
   *
   * *at* is the offset a class handler writes as `obj+0x1390 + at`, so the two
   * can be compared without arithmetic. Returns null when this descriptor
   * carries no parameter block or the field runs off the end.
   */
  param(at: number, kind: ParamKind = "i32"): number | null {
    if (this.evt === null || !this.hasParams) return null;
    const size = kind === "i8" || kind === "u8" ? 1
      : kind === "i16" || kind === "u16" ? 2 : 4;
    const off = this.paramsOffset + at;
    if (off < 0 || off + size > this.evt.raw.length) return null;
    const b = this.evt.raw;
    switch (kind) {
      case "i8": return (b[off] << 24) >> 24;
      case "u8": return b[off];
      case "i16": return i16(b, off);
      case "u16": return u16(b, off);
      case "i32": return i32(b, off);
      case "u32": return u32(b, off);
      case "f32": return f32(b, off);
    }
  }
}

/** Decode the descriptor header at *off*. */
export function readSpawn(evt: EvtFile, off: number, opcode = 0x09): Spawn {
  const b = evt.raw;
  const cls = u32(b, off);
  const flags = u32(b, off + 4);
  const pos: [number, number, number] =
    [f32(b, off + 0x08), f32(b, off + 0x0c), f32(b, off + 0x10)];
  const orient: [number, number, number] =
    [i32(b, off + 0x14), i32(b, off + 0x18), i32(b, off + 0x1c)];
  // +0x22 reaches BOTH obj+0x11C and obj+0x11E. Several classes use
  // obj+0x11C as a sub-type selector rather than a hit-point count, so the
  // name `hp` is the historical one, not a claim.
  const hp = u16(b, off + 0x22);
  const desc = u16(b, off + SPAWN_DESC_FLAGS);
  return new Spawn(off, opcode, cls, flags, pos, orient, hp, desc, evt);
}

/** Every spawn descriptor reachable from a spawn opcode in *evt*. */
export function spawns(evt: EvtFile,
                       opcodes: readonly number[] = SPAWN_OPCODES): Spawn[] {
  const out: Spawn[] = [];
  const seen = new Set<number>();
  for (const blk of evt.blocks) {
    for (const prog of blk.programs) {
      for (const ins of prog) {
        if (!opcodes.includes(ins.opcode)) continue;
        for (const w of ins.raw) {
          const off = evt.toOffset(w);
          if (off === null || seen.has(off)) continue;
          if (!(off >= 0 && off <= evt.raw.length - SPAWN_HEADER)) continue;
          seen.add(off);
          out.push(readSpawn(evt, off, ins.opcode));
        }
      }
    }
  }
  out.sort((a, b) => a.offset - b.offset);
  return out;
}

/** Parse *data* as the `evt/` file called *name*. */
export function parse(data: Uint8Array, name: string,
                      nBlocks: number | null = null): EvtFile {
  return new EvtFile(data, name).parse(nBlocks);
}
