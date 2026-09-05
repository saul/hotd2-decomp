/**
 * The event script as a *resolved* program, not a byte stream.
 * The port of `tools/hod2lib/script.py`.
 *
 * `hod2lib/evt` decodes the bytecode: opcodes, operand lengths, block and step
 * structure. It deliberately stops there, because the numbers an instruction
 * carries are meaningless without the tables in `Hod2.exe` -- an asset slot
 * id, a pol file index and a texture id are three different id spaces that all
 * look like small integers.
 *
 * This module does that join, once. It produces a {@link Program}: blocks,
 * steps and instructions with every operand resolved to a filename, a region,
 * a camera path slot or a spawn descriptor, plus the route table that orders
 * the blocks.
 *
 * References: docs/formats/evt.md, docs/formats/pipeline.md.
 */

import { asF32, f32 } from "./bytes";
import type { CamPaths } from "./campaths";
import * as colilib from "./coli";
import type { ColiFile } from "./coli";
import * as evt from "./evt";
import { ExeTables, TEX_NAME_TABLE } from "./exetab";
import { GameMode } from "./stage";
import type { Stage } from "./stage";

/**
 * Reinterpret an operand dword as the float the handler reads it as.
 *
 * Several opcodes take float operands the bytecode stores as raw dwords --
 * `set_approach_rings`'s ROM defaults decode as `{25, 38, 51}`, which as
 * integers would read `0x41C80000`. Non-finite results are reported as null
 * rather than smuggled into JSON as NaN.
 */
function asFloat(word: number): number | null {
  const v = asF32(word);
  return Number.isFinite(v) ? v : null;
}

/**
 * evt 0x1F's nine shutter states, from HudDrawShutterState (0x00413970). The
 * bar is a 1.03 x 0.10 quad drawn at view-space y = +/-0.35 closed and
 * +/-0.45 open, so "closed" is a 10 % letterbox top and bottom.
 */
export const SHUTTER_STATES: Record<number, string> = {
  0: "close, and enable firing",
  1: "open over 40 frames",
  2: "open (nothing drawn)",
  3: "close over 40 frames, then disable firing",
  4: "hold closed",
  5: "close, and disable firing",
  6: "open at once, and enable firing",
  7: "restore the previous state",
  8: "full blackout (the bar scaled 8x)",
};

/**
 * Which states drive DAT_009C8E00, the gate on firing and ammo decrement --
 * and, through it, on whether Start is polled for a cutscene skip.
 */
export const SHUTTER_GATE: Record<number, boolean> =
  { 0: true, 1: true, 6: true, 3: false, 5: false };

/**
 * evt 0x1C. The dome draw at 0x004132D0 tests for 0 and 2 by name and animates
 * for anything else.
 */
export const BACKDROP_MODES: Record<number, string> =
  { 0: "dome off", 2: "dome frozen (no spin)" };

/**
 * A BAMS angle as degrees. 0x4000 is 90 degrees, and the game reads every
 * angle this way (through `__ftol`).
 */
function bamsDeg(word: number): number {
  const v = word >= 0x80000000 ? word - 0x100000000 : word;
  return v * 360.0 / 65536.0;
}

export const ROUTE_KIND: Record<number, string> =
  { 0: "goto", 1: "branch", 2: "end" };

/**
 * `queue_event` selector names come from `hod2lib/evt`, which is where the
 * handler table was transcribed. Aliased rather than copied so the two cannot
 * drift.
 */
export const QUEUE_ACTIONS = evt.QUEUE_ACTIONS;

/**
 * Row 2 of the scene state table at 0x00576C14 -- the camera row, reached by
 * `queue_event` selector 0x21. Only 4, 6 and 7 occur in shipped data.
 */
export const CAMERA_STATES: Record<number, string> = {
  4: "snap_to_path_eye",
  5: "path_with_impulse_shake",
  6: "play_stashed_path",             // publishes the current frame
  7: "play_stashed_path_exclusive",   // as 6, but `<` on the end frame
};

/**
 * What each blocking opcode waits on, from the recovered handlers. These are
 * what make the script a timeline rather than a batch: they set the
 * interpreter's yield flag and do not advance `pc` until the condition holds.
 */
export const WAIT_CONDITIONS: Record<number, string> = {
  0x40: "queued events pending == 0",
  0x41: "camera path frame past arg (arg 0 = end of path)",
  0x42: "arg frames elapsed",
  0x43: "enemies present <= arg, and the camera has settled",
  0x44: "enemies alive <= arg",
  0x45: "script flag arg set",
  0x46: "scripted actor count <= arg",
  0x47: "camera settled and no live targetable entity",
};

/**
 * The two collision-set opcodes. Their operands are relocated absolute
 * pointers into the coli/ load buffers, not indices -- 0x10 selects the set
 * consulted by both the ray and the sphere queries, 0x11 the ray-only set.
 */
export const COLLISION_SET_OPCODES = [0x10, 0x11];

const range = (a: number, b: number) =>
  Array.from({ length: b - a }, (_, i) => a + i);

/**
 * Coarse categories, for the player's event feed. Two of these groupings are
 * corrections that cost real time to establish: the 0x20-0x27 family is **fog
 * and light**, not the per-player view structs an earlier reading called them;
 * and 0x1A is filed under *camera* because that is what the player does with
 * it.
 */
const CATEGORIES: Record<string, number[]> = {
  spawn: [...range(0x01, 0x0e), 0x0e, 0x0f, 0x12, 0x4b],
  collision: [0x10, 0x11],
  light: [0x13, 0x14, 0x15, 0x16, 0x17, 0x18, 0x19, ...range(0x20, 0x28)],
  scenery: [0x1b, 0x1c, 0x1d],
  hud: [0x1f, 0x2d],
  camera: [0x1a, 0x30, 0x35, 0x36, 0x37],
  region: [0x28, 0x29],
  audio: [0x38, 0x39, 0x3a, 0x3b, 0x2e, 0x5d, 0x5e, 0x5f],
  wait: range(0x40, 0x48),
  flow: [0x2b, 0x2c, 0x2f, 0x31, 0x32, 0x33, 0x48, 0x49, 0x4a,
         0x4d, 0x4e, 0x4f],
  assets: range(0x50, 0x5b),
  // Proved no-ops, and the one opcode whose global has no readers anywhere in
  // the binary. Grouped so the feed can render them quietly rather than
  // implying something happened.
  nop: [0x1e, 0x3d, 0x3e, 0x3f, 0x5b, 0x5c],
  // Dispatch slots that map to the empty stub. No shipped file encodes one;
  // seeing one in a feed means the decoder went wrong.
  unused: [0x00, 0x2a, 0x34, 0x3c, 0x4c],
};

export const CATEGORY: Record<number, string> = (() => {
  const out: Record<number, string> = {};
  for (const [name, ops] of Object.entries(CATEGORIES)) {
    for (const op of ops) out[op] = name;
  }
  return out;
})();

/**
 * Every opcode the interpreter can dispatch must be categorised, or the player
 * silently files a real instruction under "misc". Checked at module load
 * because the opcode table is edited far more often than this map.
 */
{
  const missing = Object.keys(evt.OPCODES).map(Number)
    .filter((o) => CATEGORY[o] === undefined).sort((a, b) => a - b);
  if (missing.length) {
    throw new Error(
      "hod2lib/script CATEGORY is missing opcodes: "
      + missing.map((o) =>
        `0x${o.toString(16).toUpperCase().padStart(2, "0")} `
        + `(${evt.OPCODES[o][0]})`).join(", "));
  }
}

// ---------------------------------------------------------------------------
// operand resolution
// ---------------------------------------------------------------------------

/**
 * Turns event operands into names, using `Hod2.exe`'s tables.
 *
 * Three id spaces reach the same handful of opcodes and all look like small
 * integers. Confusing them is the single easiest way to produce a
 * plausible-looking wrong answer, so each opcode's operand is resolved through
 * exactly the table its handler uses:
 *
 *     0x50/51   asset **slot** id -> (pol file, entry index)
 *     0x52/53   pol **file** index -> filename
 *     0x54-57   tex **file** index -> filename
 *     0x28/29   **region** id -> the scene's region table
 */
export class Resolver {
  readonly slots: Map<number, [string, number]>;
  readonly pol: Map<number, [string, number]>;
  readonly tex: Map<number, string>;

  constructor(readonly tables: ExeTables) {
    this.slots = tables.assetSlots();
    this.pol = tables.polFiles();
    this.tex = Resolver.texNames(tables);
  }

  private static texNames(t: ExeTables): Map<number, string> {
    const out = new Map<number, string>();
    for (let i = 0; i < 512; i++) {
      const p = t.ru32(TEX_NAME_TABLE + i * 4);
      if (p) {
        const n = t.cstr(p);
        if (n) out.set(i, n);
      }
    }
    return out;
  }

  /** One line of operand text, as `dump_stage_script.py` prints it. */
  operandText(ins: evt.Instr): string {
    const v = ins.raw.length ? ins.raw[0] : 0;
    if (evt.SLOT_OPCODES.includes(ins.opcode)) {
      const r = this.slots.get(v);
      return r ? `slot ${v} = ${r[0]}[${r[1]}]` : `slot ${v} = ?`;
    }
    if (ins.opcode === 0x52 || ins.opcode === 0x53) {
      const r = this.pol.get(v);
      return r ? `pol ${v} = ${r[0]}` : `pol ${v} = ?`;
    }
    if (ins.opcode >= 0x54 && ins.opcode <= 0x57) {
      return `tex ${v} = ${this.tex.get(v) ?? "?"}`;
    }
    return ins.words
      .map((w) => (w >>> 0).toString(16).toUpperCase().padStart(8, "0"))
      .join(" ");
  }

  /** The file an asset opcode touches, or null if it touches none. */
  assetName(ins: evt.Instr): string | null {
    const v = ins.raw.length ? ins.raw[0] : 0;
    if (evt.SLOT_OPCODES.includes(ins.opcode)) {
      const r = this.slots.get(v);
      return r ? r[0] : null;
    }
    if (ins.opcode === 0x52 || ins.opcode === 0x53) {
      const r = this.pol.get(v);
      return r ? r[0] : null;
    }
    if (ins.opcode >= 0x54 && ins.opcode <= 0x57) {
      return this.tex.get(v) ?? null;
    }
    return null;
  }
}

/**
 * A line rendered from an already-decoded {@link Op}, or null.
 *
 * `operandText` only sees the raw instruction, so it cannot resolve anything
 * that needed more than the EXE tables. Collision-set pointers need the
 * `coli/` files, and those are decoded into `op.detail` when the Program is
 * built.
 */
export function detailText(op: Op): string | null {
  if (!COLLISION_SET_OPCODES.includes(op.opcode)) return null;
  const meshes = (op.detail.meshes as Record<string, unknown>[]) ?? [];
  const set = (op.detail.set as string) ?? "?";
  if (!meshes.length) return `${set}: clear`;
  const parts = meshes.map((m) => {
    if ("file" in m) {
      const surfaces = (m.surfaces as number[]) ?? [];
      return `${m.file}+0x${(m.offset as number).toString(16)}`
        + `(${m.quads ?? "?"}q surf ${surfaces.join(",")})`;
    }
    return `0x${(m.address as number).toString(16).padStart(8, "0")}=UNRESOLVED`;
  });
  return `${set}: ${parts.join(" ")}`;
}

// ---------------------------------------------------------------------------
// the program
// ---------------------------------------------------------------------------

/** One instruction, decoded and resolved. */
export class Op {
  detail: Record<string, unknown> = {};

  constructor(
    readonly index: number,
    readonly offset: number,
    readonly opcode: number,
    readonly name: string,
    readonly category: string,
    readonly words: number[],
    readonly raw: number[],
  ) {}

  toJson(): Record<string, unknown> {
    return { i: this.index, at: this.offset, op: this.opcode,
             name: this.name, cat: this.category, ...this.detail };
  }
}

export class Step {
  ops: Op[] = [];

  constructor(readonly index: number, readonly offset: number) {}

  toJson(): Record<string, unknown> {
    return { index: this.index, at: this.offset,
             ops: this.ops.map((o) => o.toJson()) };
  }
}

export class ScriptBlock {
  steps: Step[] = [];

  constructor(
    readonly index: number,
    readonly offset: number,
    readonly externalSteps: [number, number][] = [],
    readonly route: [number, number, number, number] = [0, -1, -1, -1],
  ) {}

  /**
   * A block the scene's route graph never visits.
   *
   * The root pointer array stores -1 for these. It is a *hole*, not a
   * terminator -- sizing the array by stopping at the first -1 loses blocks.
   */
  get isHole(): boolean {
    return this.offset < 0;
  }

  get routeKind(): string {
    return ROUTE_KIND[this.route[0]] ?? `?${this.route[0]}`;
  }

  get routeTargets(): number[] {
    return this.route.slice(1).filter((x) => x >= 0);
  }

  toJson(): Record<string, unknown> {
    const out: Record<string, unknown> = {
      index: this.index, at: this.offset,
      route: { kind: this.routeKind, next: this.route.slice(1) },
    };
    if (this.isHole) {
      out.hole = true;
      return out;
    }
    out.steps = this.steps.map((s) => s.toJson());
    if (this.externalSteps.length) {
      out.external_steps = this.externalSteps.map(([i, p]) =>
        ({ index: i, ptr: p }));
    }
    return out;
  }
}

/** A whole scene's script: blocks, steps, resolved instructions, routes. */
export class Program {
  blocks: ScriptBlock[] = [];
  warnings: string[] = [];

  private constructor(
    readonly stage: Stage,
    readonly resolver: Resolver,
    readonly evt: evt.EvtFile | null,
    private readonly campathsRef: CamPaths,
    private readonly sets: [ColiFile, ColiFile] | null,
  ) {}

  /** Resolve a {@link Stage}'s event script. */
  static async create(stage: Stage,
                      resolver: Resolver | null = null): Promise<Program> {
    const ev = await stage.evt();
    const p = new Program(stage, resolver ?? new Resolver(stage.tables), ev,
                          await stage.campaths(), await stage.colisets());
    p.warnings = ev ? [...ev.warnings] : [];
    if (ev !== null) p.build();
    return p;
  }

  get scene(): number { return this.stage.scene; }
  get evtName(): string | null { return this.stage.evtFile; }
  get routes(): [number, number, number, number][] { return this.stage.routes; }

  // -- construction ------------------------------------------------------

  private build(): void {
    const campaths = this.campathsRef;
    for (const b of this.evt!.blocks) {
      const route: [number, number, number, number] =
        b.index < this.routes.length ? this.routes[b.index] : [0, -1, -1, -1];
      const blk = new ScriptBlock(b.index, b.offset, [...b.externalSteps],
                                  route);
      if (!blk.isHole) {
        b.programs.forEach((prog, si) => {
          const step = new Step(si, si < b.steps.length ? b.steps[si] : -1);
          prog.forEach((ins, oi) => step.ops.push(
            this.decode(oi, ins, campaths)));
          blk.steps.push(step);
        });
      }
      this.blocks.push(blk);
    }
  }

  private decode(index: number, ins: evt.Instr, campaths: CamPaths): Op {
    const r = this.resolver;
    const op = new Op(index, ins.offset, ins.opcode, ins.name,
                      CATEGORY[ins.opcode] ?? "misc",
                      [...ins.words], [...ins.raw]);
    const d = op.detail;
    const arg0 = ins.raw.length ? ins.raw[0] : 0;
    const o = ins.opcode;

    if (evt.SLOT_OPCODES.includes(o)) {
      const rec = r.slots.get(arg0);
      d.slot = arg0;
      if (rec) { d.file = rec[0]; d.entry = rec[1]; }
    } else if (o === 0x52 || o === 0x53) {
      const rec = r.pol.get(arg0);
      d.pol = arg0;
      if (rec) d.file = rec[0];
    } else if (o >= 0x54 && o <= 0x57) {
      d.tex = arg0;
      const name = r.tex.get(arg0);
      if (name) d.file = name;
    } else if (evt.REGION_OPCODES.includes(o)) {
      d.region = arg0;
    } else if (COLLISION_SET_OPCODES.includes(o)) {
      d.set = o === 0x10 ? "full" : "ray_only";
      d.meshes = this.decodeCollisionSet(ins);
    } else if (o === 0x30) {
      Object.assign(d, this.decodeQueue(ins, campaths));
    } else if (evt.SPAWN_OPCODES.includes(o)) {
      d.spawns = this.decodeSpawns(ins);
    } else if (WAIT_CONDITIONS[o] !== undefined) {
      if (ins.raw.length >= 1) d.arg = ins.raw[0];
      d.blocks_on = WAIT_CONDITIONS[o];
    } else if (o === 0x48) {                      // set_script_flag
      d.flag = arg0;
    } else if (o === 0x38 || o === 0x3a) {        // se_play
      d.sound = arg0;
    } else if (o === 0x39 || o === 0x3b) {        // se_play_3d
      d.sound = arg0;
      d.pos_words = ins.raw.slice(1);
    } else if (o === 0x5f) {                      // bgm_entry_play
      // Consumes four operands and uses only the third: stop the current BGM,
      // then play that track id.
      d.track = ins.raw.length >= 3 ? ins.raw[2] : null;
      d.unused_args = ins.raw.length >= 4
        ? [ins.raw[0], ins.raw[1], ins.raw[3]] : [...ins.raw];
    } else if (o === 0x31 || o === 0x32) {        // goto_scene_state
      d.scene_state_minor = arg0;
    } else if (o === 0x14) {                      // set_scene_lighting
      d.enabled = Boolean(arg0);
    } else if (o === 0x35) {
      // CamEvalPath7 evaluates a cp_ path's 7th channel (roll/bank) only while
      // this is set, and forces roll to 0 otherwise. So the client must gate
      // roll on it rather than always applying the curve.
      d.roll_enabled = Boolean(arg0);
    } else if (o === 0x36) {                      // pin_view_to_ground_plane
      // Selects g_camera_fixed_eye_y over the default. Three camera hooks
      // share one line.
      d.use_fixed_eye_y = arg0 === 1;
      d.enabled = arg0 === 1;
    } else if (o === 0x1a) {                      // set_ground_plane_y
      // One global, two jobs: the height QueryGroundHeightAt falls back to and
      // blob shadows project onto, *and* the fixed camera eye height opcode
      // 0x36 selects.
      const v = this.derefF32(arg0);
      d.ground_y = v;
      d.camera_fixed_eye_y = v;
    } else if (o === 0x37) {                      // force_camera_path_advance
      d.force_path_advance = Boolean(arg0);
    } else if (o === 0x33) {                      // set_action_drain_mode
      d.drain_mode = arg0;
      d.pending_delta = ins.raw.length > 1 ? ins.raw[1] : null;
    } else if (o === 0x2d) {                      // play_dialogue
      d.message_group = arg0;
    } else if (o === 0x18 || o === 0x19) {        // set_lightN_direction
      d.pitch_deg = bamsDeg(ins.raw[0]);
      d.yaw_deg = ins.raw.length > 1 ? bamsDeg(ins.raw[1]) : null;
    } else if (o === 0x17) {                      // slerp_light0_direction
      d.pitch_deg = bamsDeg(ins.raw[0]);
      d.yaw_deg = ins.raw.length > 1 ? bamsDeg(ins.raw[1]) : null;
      d.frames = ins.raw.length > 2 ? ins.raw[2] : null;
    } else if (o === 0x0e) {                      // set_approach_rings
      d.class = arg0;
      d.rings = ins.raw.slice(1, 4).map(asFloat);
    } else if (o === 0x1b || o === 0x1c || o === 0x1d || o === 0x1f) {
      d.value = arg0;
      // A bare number tells a reader nothing. These three operand spaces are
      // small, closed and fully read out of the handlers, so the meaning
      // travels with the instruction.
      if (o === 0x1f) {
        d.means = SHUTTER_STATES[arg0] ?? null;
        d.firing_gate = SHUTTER_GATE[arg0] ?? null;
      } else if (o === 0x1c) {
        d.means = BACKDROP_MODES[arg0] ?? "animating";
      } else if (o === 0x1d) {
        d.means = arg0 ? "rain on" : "rain off";
      }
    } else if (o === 0x2c) {                      // set_skippable_region
      d.open = Boolean(arg0);
      d.means = arg0 ? "opens a region the player may skip out of"
                     : "closes it, and clears the skip flag";
    } else if (o >= 0x20 && o < 0x28) {
      Object.assign(d, this.decodeLightTween(ins));
    }

    // Opcodes still identified only by the global they write show their raw
    // operands rather than a guessed label. The player surfaces these
    // verbatim; inventing a name for them would be worse than silence.
    if (!Object.keys(d).length && ins.raw.length) {
      d.raw = ins.words.map((w) =>
        `0x${(w >>> 0).toString(16).toUpperCase().padStart(8, "0")}`);
    }
    return op;
  }

  /**
   * Resolve an opcode-0x10/0x11 operand list to `coli/` blobs.
   *
   * The operands are *relocated absolute pointers* into the two collision
   * buffers, not indices. Each should land exactly on a blob header -- across
   * the shipped scripts all 86 do -- so a missing `file` here means the
   * reading is wrong, not that the data is unusual.
   */
  private decodeCollisionSet(ins: evt.Instr): Record<string, unknown>[] {
    const out: Record<string, unknown>[] = [];
    const sets = this.sets;
    for (const word of ins.raw) {
      if (word === 0xffffffff) continue;
      const entry: Record<string, unknown> = {
        operand: word, address: colilib.resolvePointer(word),
      };
      const hit = sets ? colilib.pointerToOffset(word, sets[0], sets[1]) : null;
      if (hit) {
        const [fname, off] = hit;
        entry.file = fname;
        entry.offset = off;
        const f = sets!.find((x) => x.name === fname)!;
        const blob = f.blobs.find((b) => b.offset === off);
        if (blob !== undefined) {
          const quads = colilib.blobQuads(blob);
          entry.quads = quads.length;
          entry.surfaces = [...new Set(quads.map((q) => q.surface))]
            .sort((a, b) => a - b);
        }
      }
      out.push(entry);
    }
    return out;
  }

  /**
   * `queue_event` -- the scripted-action ring.
   *
   * `handler = table[sel >> 4][sel & 0xF]`; the high nibble is both the group
   * index and the operand count.
   */
  private decodeQueue(ins: evt.Instr,
                      campaths: CamPaths): Record<string, unknown> {
    if (!ins.raw.length) return {};
    const sel = ins.raw[0];
    const args = ins.raw.slice(1);
    const out: Record<string, unknown> = {
      sel,
      action: QUEUE_ACTIONS[sel]
        ?? `sel_${sel.toString(16).toUpperCase().padStart(2, "0")}`,
      args,
    };
    if (sel === 0x40 && args.length >= 4) {
      // queue_event 0x40, start_frame, end_frame, path_slot, flags
      //
      // args[1] is the END FRAME: CamStartPathPlayback loads the frame counter
      // from args[0] and the terminator from args[1], and CamAdvancePathFrame
      // increments until it reaches it. Shipped data confirms it -- consecutive
      // commands tile a path exactly.
      const start = args[0] < 0x80000000 ? args[0] : args[0] - 0x100000000;
      const end = args[1] < 0x80000000 ? args[1] : args[1] - 0x100000000;
      out.start = start;
      out.end = end;
      out.slot = args[2];
      out.flags = args[3];
      // start == end holds a fixed pose (CamEvalStaticPose); start == -1
      // resumes from the current frame rather than seeking.
      out.static = start === end;
      out.resume = start === -1;
      const ref = campaths.get(args[2]);
      out.cam = ref !== undefined
        ? { file: ref.file, path: ref.index, duration: ref.duration } : null;
    } else if (sel === 0x21 && args.length) {
      // EvtEnterSceneState(2, op0). Row 2 of the state table at 0x00576C14 is
      // the camera row, and its live cells are exactly the operands that
      // occur. This is NOT "hand control back from a path", which an earlier
      // reading of the same selector claimed.
      out.scene_state = { major: 2, minor: args[0] };
      out.camera_state = CAMERA_STATES[args[0]] ?? null;
    } else if (sel === 0x11 && args.length) {
      out.scene_state = { major: "current", minor: args[0] };
    } else if (sel === 0x20 && args.length >= 2) {
      out.frames = args[0];
      out.preset = args[1];
    } else if (sel === 0x60 && args.length >= 6) {
      // The arcade branch-preview shots -- one camera pose per route the
      // branch can take. **Proved**, by reading both halves:
      // EvtActionStoreSixOperands60 scatters the operands and FUN_00403DB0
      // reads them back as three (frame, slot) pairs indexed by the branch
      // choice -- note the order, which is frame first. An earlier note
      // guessed "(slot, frame)" and had it backwards.
      const preview: Record<string, unknown>[] = [];
      for (let i = 0; i < 6; i += 2) {
        const ref = campaths.get(args[i + 1]);
        preview.push({
          choice: Math.floor(i / 2),
          frame: args[i],
          slot: args[i + 1],
          cam: ref !== undefined ? { file: ref.file, path: ref.index } : null,
        });
      }
      out.branch_preview = preview;
    }
    return out;
  }

  /** Resolve a spawn opcode's pointer list to descriptor headers. */
  private decodeSpawns(ins: evt.Instr): Record<string, unknown>[] {
    const out: Record<string, unknown>[] = [];
    const seen = new Set<number>();
    for (const w of ins.raw) {
      const off = this.evt!.toOffset(w);
      if (off === null || seen.has(off)) continue;
      if (!(off >= 0 && off <= this.evt!.raw.length - evt.SPAWN_HEADER)) {
        continue;
      }
      seen.add(off);
      const s = evt.readSpawn(this.evt!, off, ins.opcode);
      out.push({
        at: s.offset,
        class: s.cls,
        flags: s.initFlags,
        pos: [s.pos[0], s.pos[1], s.pos[2]],
        // +0x18 is a BAMS yaw (0x4000 == 90 deg). +0x14 and +0x1C reach object
        // +0x64/+0x6C and are plausibly the other two Euler angles, but their
        // value distributions do not look like angles -- so they are carried
        // raw, not as rotations.
        yaw_deg: s.yawDeg,
        orient: [...s.orient],
        hp: s.hp,
        // +0x20 -> obj+0x1316 -> the class flag word obj+0x136C. 23 of 51
        // class-0x31 and 76 of 345 class-0x30 descriptors set it, so dropping
        // it lost five stage-6 throwers their starting surface.
        desc_flags: s.descFlags,
      });
    }
    return out;
  }

  /**
   * The 0x20-0x27 family: `[op][channel][...]`.
   *
   * These drive the two **scene light / fog blocks**, not per-player view
   * structs -- a reading overturned at the renderer end. Block 0 is pushed to
   * the device every frame; block 1 only at scene init.
   */
  private decodeLightTween(ins: evt.Instr): Record<string, unknown> {
    if (!ins.raw.length) return {};
    const sub = ins.raw[0];
    const out: Record<string, unknown> = {
      light_block: ins.opcode < 0x24 ? 0 : 1,
      channel: sub,
      channel_name: evt.CHANNELS[sub] ?? `sub_${sub}`,
    };
    const vals = ins.raw.slice(1);
    if (!vals.length) return out;

    // The tween block is `{enabled, from, to, rate}` per channel, and the two
    // handlers fill it differently:
    //
    //   0x21 tween_rate  [op][ch][to][rate]    rate is a per-frame step
    //   0x23 tween_time  [op][ch][to][frames]  rate = |to - from| / frames
    //   0x20 set         [op][ch][value]       immediate
    //
    // Which operands are pointers to float constants and which are inline
    // integers depends on the channel: the fog *colour* channels (2, 3, 4 and
    // the 5 that sets all three) read their target inline and convert int ->
    // float, everything else dereferences. `frames` is always inline.
    const inlineTarget = sub === 2 || sub === 3 || sub === 4 || sub === 5;
    const target = (word: number): number | null =>
      inlineTarget ? word : this.derefF32(word);

    if (sub === 5 || sub === 9) {
      if (ins.opcode === 0x20) {
        out.components = [...vals];
        return out;
      }
      // One target applied to all three components.
      const t = target(vals[0]);
      out.components = t !== null ? [t, t, t] : null;
      out.value = t;
    } else {
      out.value = target(vals[0]);
      if (out.value === null) {
        out.raw_value =
          `0x${(vals[0] >>> 0).toString(16).toUpperCase().padStart(8, "0")}`;
      }
    }

    if (ins.opcode === 0x21 && vals.length >= 2) {
      out.tween = "rate";
      out.rate = this.derefF32(vals[1]);
    } else if (ins.opcode === 0x23 && vals.length >= 2) {
      out.tween = "time";
      out.frames = vals[1];
    }
    return out;
  }

  /**
   * Read the float an operand points at, or null if it is not a pointer.
   *
   * Operands are stored un-relocated, so `EvtFile.toOffset` -- which subtracts
   * the Dreamcast load base -- takes the raw word.
   */
  private derefF32(word: number): number | null {
    const off = this.evt!.toOffset(word);
    if (off === null || !(off >= 0 && off <= this.evt!.raw.length - 4)) {
      return null;
    }
    const v = f32(this.evt!.raw, off);
    return Number.isFinite(v) ? v : null;
  }

  // -- views -------------------------------------------------------------

  liveBlocks(): ScriptBlock[] {
    return this.blocks.filter((b) => !b.isHole);
  }

  branchBlocks(): ScriptBlock[] {
    return this.blocks.filter((b) => b.route[0] === ExeTables.ROUTE_BRANCH);
  }

  /**
   * Where the scene starts.
   *
   * Block 0 in every shipped scene: the route table is a forward graph with no
   * separate entry record.
   */
  entryBlock(): number {
    for (const b of this.blocks) if (!b.isHole) return b.index;
    return 0;
  }

  /**
   * Which step of the entry block runs first.
   *
   * Not 0. `FUN_0045EBC0` picks it by game mode and scene state: game mode 1
   * (Original) **and scene 0** gives 5, everything else -- normal Arcade play
   * -- gives 1. This is the same rule `EvtAdvanceStepOrRoute` follows on every
   * later block change. Step 0 is reached only through the checkpoint path.
   */
  entryStep(): number {
    if (this.stageGameMode === GameMode.ORIGINAL && this.scene === 0) return 5;
    return 1;
  }

  /** `g_GameMode` as the EXE numbers it -- see `stage.GameMode`. */
  get stageGameMode(): number {
    return this.stage.gameMode;
  }

  camSlotsUsed(): number[] {
    const out = new Set<number>();
    for (const b of this.liveBlocks()) {
      for (const s of b.steps) {
        for (const o of s.ops) {
          if (o.detail.action === "cam_play") out.add(o.detail.slot as number);
        }
      }
    }
    return [...out].sort((a, b) => a - b);
  }

  /**
   * Every `coli/` blob this scene loads, keyed the way the script names it.
   *
   * `ColiLoadForScene` loads two files -- `coli0.bin` for every scene plus
   * `coli<scene+1>.bin` -- and opcodes `0x10` and `0x11` select blobs out of
   * them by **relocated absolute pointer**. Those resolve to a `{file,
   * offset}` pair, so that pair is the key here and a selection in the script
   * is a lookup rather than an index.
   *
   * Every blob in both files is emitted, not only the ones the shipped script
   * selects: the whole of stage 2's collision is 785 quads, so deciding which
   * are reachable would cost more than it saves.
   *
   * Flat arrays per blob, the way the baked motions are, because the client
   * walks them per quad and an array of objects would be four times the size
   * for the same numbers.
   */
  coliJson(): Record<string, unknown> {
    const sets = this.sets;
    if (!sets) return {};
    const blobs: Record<string, unknown> = {};
    for (const f of sets) {
      for (const b of f.blobs) {
        const quads = colilib.blobQuads(b);
        if (!quads.length) continue;
        // One AABB for the blob: the groups' boxes, merged. The engine rejects
        // per group, and the shipped data has one group each.
        const lo = [0, 1, 2].map((k) =>
          Math.min(...b.groups.map((g) => g.aabbMin[k])));
        const hi = [0, 1, 2].map((k) =>
          Math.max(...b.groups.map((g) => g.aabbMax[k])));
        const plane: number[] = [];
        const verts: number[] = [];
        for (const q of quads) {
          plane.push(q.normal[0], q.normal[1], q.normal[2], q.planeD);
          for (const v of q.verts) verts.push(v[0], v[1], v[2]);
        }
        blobs[`${f.name}:${b.offset}`] = {
          min: lo, max: hi, n: quads.length,
          plane, verts,
          axis: quads.map((q) => q.axis),
          surface: quads.map((q) => q.surface),
        };
      }
    }
    return {
      files: sets.map((f) => f.name),
      blobs,
      note: "Segment and sphere queries run against these. Opcode 0x10 names "
        + "the full set, which both the ray and the sphere test consult; 0x11 "
        + "names a ray-only set, [likely] scenery that stops a bullet but not "
        + "movement. See docs/formats/coli.md.",
    };
  }

  toJson(): Record<string, unknown> {
    return {
      coli: this.coliJson(),
      scene: this.scene,
      stage: this.stage.stage,
      game_mode: this.stage.gameMode,
      evt_file: this.evtName,
      entry_block: this.entryBlock(),
      entry_step: this.entryStep(),
      routes: this.routes.map(([k, a, b, c]) =>
        ({ kind: ROUTE_KIND[k] ?? `?${k}`, next: [a, b, c] })),
      blocks: this.blocks.map((b) => b.toJson()),
      warnings: this.warnings,
    };
  }
}

/** Resolve a {@link Stage}'s event script. */
export function load(stage: Stage): Promise<Program> {
  return Program.create(stage);
}
