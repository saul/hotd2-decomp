/**
 * Which motion a spawn starts in, and the baked frames of it.
 * The port of `tools/hod2lib/charmotion.py`.
 *
 * `obj+0x1B4` is the motion id and a class handler is the only thing that
 * writes it, so a class earns a rule here the same way it earns a
 * character-type rule in `spawnres`: by having its handler read. There is
 * deliberately no fallback.
 */

import { i16, u16, u32 } from "./bytes";
import type { EvtFile, ParamKind, Spawn } from "./evt";
import type { ExeTables } from "./exetab";
import type { AssetSource } from "./io";
import { loadBank } from "./mot";

/**
 * `g_class20_idle_motions` -- 0x005647A4. The four clips `OneHitTargetInit`
 * picks between with `rand() & 3` when the spawn's tail names none. All four
 * are ids character type 7 (`char_adv00.bin`) carries, which is the
 * corroboration that they are motion ids at all.
 */
export const CLASS20_IDLE_MOTIONS = [1021, 1023, 1024, 1025];

/**
 * The clip `OneHitTargetUpdate` cues the frame the actor is shot, and
 * `OneHitTargetPlayDeathClip` then holds on its last frame.
 */
export const CLASS20_DEATH_MOTION = 988;

export type MotionRule =
  | ["literal", number]
  | ["param", number, ParamKind]
  | ["param_or", number, ParamKind, number]
  | ["block", number, number]
  | ["by_char", Record<number, number>, number]
  | ["table", number, number, number, ParamKind];

/**
 * How each class chooses the motion it starts in, from its handler.
 *
 * `["table", base, stride, at, kind]` reads the spawn's parameter tail at *at*
 * as *kind* to get a variant, then takes the `u16` at `base + variant *
 * stride`. `["literal", id]` is a constant, `["param", at, kind]` is read
 * straight from the tail, `["param_or", at, kind, default]` is the same for a
 * field whose **zero is a value and not an absence** -- class 0x20's, where it
 * means "pick one of four at random" -- and `["block", ptrAt, field]` follows
 * a pointer in the tail to a command block and reads a `s16` from it.
 *
 * Class 0x30 -- the zombie, and the single largest population in the game --
 * is `FUN_00452DA0`, which opens with `obj[0x1B4] = 0x3BC` unless
 * `obj[0x130C] == 4`. The `0x41E` branch tests a field the allocator fills
 * differently per spawn opcode and is **not** taken here: 956 is the common
 * path, and guessing the rarer one wrong would be worse.
 */
export const MOTION_RULES: Record<number, MotionRule> = {
  // `SetPiecePropInit` reads the motion straight out of the parameter tail
  // with no variant table in between. Without this rule the 48 set-piece
  // props resolve to a character with no motion, and the client skips
  // anything it cannot pose.
  0x24: ["param", 0x0a, "i16"],
  // `OneHitTargetInit` reads `obj+0x1B4 = (s16)tail+0x06`, and **zero there
  // means it draws one of four at random**. The exporter cannot make that
  // draw -- it is the port's, from `ctx.rng`, or the save state would not
  // restore -- so the rule names the first of the four as the clip the
  // placement is posed in.
  0x20: ["param_or", 0x06, "i16", CLASS20_IDLE_MOTIONS[0]],
  // `ScriptedHumanoidInit` follows a pointer: the tail at `+0x0C` names a
  // command block, and the block's `+0x04` is the motion the actor opens in.
  0x25: ["block", 0x0c, 0x04],
  // `CivilianInit` writes `model+0x20 = 0x294` -- motion 660, from
  // `people.bin` -- before it runs a line of script.
  0x10: ["literal", 0x294],
  0x30: ["literal", 0x3bc],
  0x31: ["by_char", { 0x17: 0x1ba }, 0x3a8],
  0x53: ["table", 0x00589a64, 10, 0x00, "i16"],
};

/**
 * `mot/` is authored at 30 Hz against the engine's 60 Hz clock. The exact
 * relation is open, so this is stated as the playback rate rather than baked
 * into the frame data.
 */
export const MOTION_FPS = 30.0;

/**
 * Class 0x30's parameter tail also carries a **scripted entrance**: state 21
 * is a one-shot motion cue with a start delay, then a follow-on state.
 *
 * The two zombies inside the stage-2 van are exactly this: state 21, motion
 * 923 from `zom.bin`, delays of 0 and 10 frames so they come out one after the
 * other, then state 1.
 */
export const MOTION_STATE_CUE = 21;

/** More than this and a bake is not worth its bytes. */
export const MAX_BAKED_FRAMES = 600;

/**
 * A class-0x25 command is eight bytes, or sixteen when it carries a point.
 * `ScriptedHumanoidUpdate` advances the cursor by `+2` dwords for every opcode
 * but 7, 8 and `4` in mode 4, which take `+4`.
 */
export function humanoidCmdLen(op: number, mode: number): number {
  if (op === 8 || op === 7) return 16;
  if (op === 4 && mode === 4) return 16;
  return 8;
}

/**
 * The file offset of a class-0x25 spawn's command block, or null.
 *
 * `ScriptedHumanoidInit` reads a pointer out of the parameter tail at `+0x0C`;
 * the block's header is four `s16` and the commands start at `+0x08`.
 */
export function humanoidBlockOffset(evt: EvtFile | null,
                                    spawnRec: Spawn): number | null {
  if (evt === null) return null;
  const raw = evt.raw;
  const tail = spawnRec.offset + 0x24;
  if (tail + 0x10 > raw.length) return null;
  const blk = evt.toOffset(u32(raw, tail + 0x0c));
  if (blk === null || blk + 8 > raw.length) return null;
  return blk;
}

/**
 * The `op 10` modes that are a **test**, rather than the marker that ends one.
 *
 * `ScriptedHumanoidUpdate` (`FUN_004842A0`) at `0x0048478C` compares the mode
 * against 0, 1 and 2 and falls straight through for anything else --
 * `SUB EAX,EBX; JZ; DEC EAX; JZ; DEC EAX; JNZ <next command>` (`2bc3`, `746a`,
 * `48`, `7437`, `48`, `0f85b4fbffff`). Mode `-2` is therefore not a fourth
 * comparison: it is the `endif` marker the skip below scans for, and running
 * one costs a cursor step and nothing else.
 */
const HUMANOID_IF_MODES = new Set([0, 1, 2]);

/**
 * Where `op 10` resumes when `g_active_player` does not match its mode.
 *
 * `ScriptedHumanoidUpdate` (`FUN_004842A0`) walks **eight bytes at a time**
 * from the command after the `op 10` until it reads `-2` where a mode goes,
 * and carries on after that one: `MOV CX, word ptr [ESI + 0x2]; ADD ESI, 0x8;
 * CMP CX, -0x2` (`668b4e02`, `83c608`, `6683f9fe`) at `0x004847B6`, then the
 * same three instructions in a loop at `0x004847C7`.
 *
 * The stride is a literal 8 and **not** {@link humanoidCmdLen}: a 16-byte
 * command inside a skipped arm would be read by the engine as two 8-byte ones,
 * and the second half of its point would have to miss `-2` for the scan to
 * survive. That is the engine's own arithmetic and it is transcribed rather
 * than corrected -- `tools/verify_scripted_clips.py` checks that every target
 * it lands on is a real command boundary in the shipped scripts.
 *
 * Returns null only if the scan runs off the end of the file, which no shipped
 * program does.
 */
export function humanoidSkipTarget(raw: Uint8Array, off: number): number | null {
  let p = off + 8;
  while (p + 8 <= raw.length) {
    const mode = i16(raw, p + 2);
    p += 8;
    if (mode === -2) return p;
  }
  return null;
}

/**
 * Every command offset the block reaches, sorted, jumps followed.
 *
 * One walk, shared by the two things that need it: `bundle` emits the commands
 * and `characters` bakes the clips they name. It was two, and the second one
 * did not exist -- `op 2` and `op 3` name a motion the actor plays for the
 * rest of its program, and nothing added those to the bake list, so 118 of the
 * 263 (program, clip) pairs the six stages carry had no frames at all.
 *
 * **`op 10` has two successors and only one of them is the next command.**
 * It is the engine's `if (g_active_player == mode)`, and the arm it skips to
 * is reached by no other edge -- so a walk that only fell through stopped at
 * the `op 18` inside the *first* arm and emitted a four-command program whose
 * every path ended in `ActorKill`. Stage 3's block 2 placed the two player
 * characters that way and the port killed both of them on the frame they
 * spawned.
 */
export function humanoidCommandOffsets(evt: EvtFile | null,
                                       spawnRec: Spawn): number[] {
  const blk = humanoidBlockOffset(evt, spawnRec);
  if (blk === null) return [];
  const raw = evt!.raw;
  const order: number[] = [];
  const seen = new Set<number>();
  const pending = [blk + 8];
  while (pending.length) {
    let p = pending.shift()!;
    while (!seen.has(p) && p + 8 <= raw.length) {
      seen.add(p);
      order.push(p);
      const op = i16(raw, p);
      const mode = i16(raw, p + 2);
      if (op === 18 || op === -1) break;
      if (op === 15) {
        const t = evt!.toOffset(u32(raw, p + 4));
        if (t !== null) pending.push(t);
        break;
      }
      if (op === 10 && HUMANOID_IF_MODES.has(mode)) {
        const t = humanoidSkipTarget(raw, p);
        if (t !== null) pending.push(t);
      }
      p += humanoidCmdLen(op, mode);
    }
  }
  order.sort((a, b) => a - b);
  return order;
}

/**
 * Every clip a class-0x25 program can put on the actor.
 *
 * The block header's `+0x04` -- which {@link motionFor} already returns --
 * plus every `op 2` and `op 3` operand. Both opcodes write `obj+0x1B4`, and
 * the actor plays that clip until the next one; there is no third way for the
 * VM to change it.
 */
export function humanoidMotionIds(evt: EvtFile | null,
                                  spawnRec: Spawn): number[] {
  const out: number[] = [];
  const blk = humanoidBlockOffset(evt, spawnRec);
  if (blk === null) return out;
  const raw = evt!.raw;
  const hdr2 = i16(raw, blk + 4);
  if (hdr2 > 0) out.push(hdr2);
  for (const off of humanoidCommandOffsets(evt, spawnRec)) {
    const op = i16(raw, off);
    const a = i16(raw, off + 4);
    if ((op === 2 || op === 3) && a > 0) out.push(a);
  }
  return out;
}

/** The motion id a class handler starts this spawn in, or null. */
export function motionFor(tables: ExeTables, spawnRec: Spawn,
                          cls: number): number | null {
  const rule = MOTION_RULES[cls];
  if (rule === undefined) return null;
  if (rule[0] === "literal") return rule[1];
  if (rule[0] === "block") {
    const [, ptrAt, field] = rule;
    const evt = spawnRec.evt;
    if (evt === null) return null;
    const raw = evt.raw;
    const base = spawnRec.offset + 0x24 + ptrAt;
    if (base + 4 > raw.length) return null;
    const off = evt.toOffset(u32(raw, base));
    if (off === null || off + field + 2 > raw.length) return null;
    const mid = i16(raw, off + field);
    return mid <= 0 ? null : mid;
  }
  if (rule[0] === "param") {
    const mid = spawnRec.param(rule[1], rule[2]);
    return mid === null || mid <= 0 ? null : mid;
  }
  if (rule[0] === "param_or") {
    // A tail field whose **zero is a real value** rather than an absence --
    // class 0x20's, where it means "draw one of four at random". The default
    // keeps the placement posable; the port makes the draw.
    const [, at, kind, dflt] = rule;
    const mid = spawnRec.param(at, kind);
    return mid === null || mid <= 0 ? dflt : mid;
  }
  if (rule[0] === "by_char") {
    const [, perChar, dflt] = rule;
    const ct = spawnRec.param(0x00, "i8");
    return ct !== null && ct in perChar ? perChar[ct] : dflt;
  }
  const [, base, stride, at, kind] = rule;
  const variant = spawnRec.param(at, kind);
  if (variant === null || variant < 0) return null;
  const r = tables.v2r(base + variant * stride);
  if (r === null || r + 2 > tables.data.length) return null;
  const mid = u16(tables.data, r);
  return mid === 0xffff ? null : mid;
}

/** A scripted entrance motion and its delay, or null. */
export function introFor(tables: ExeTables, spawnRec: Spawn,
                         cls: number): [number, number] | null {
  if (cls !== 0x30) return null;
  if (spawnRec.param(2, "i8") !== MOTION_STATE_CUE) return null;
  const motion = spawnRec.param(0x04, "i32");
  const delay = spawnRec.param(0x08, "i32") || 0;
  const bank = motion && motion > 0 ? tables.motionBankOf(motion) : null;
  if (bank === null || !tables.motionBanks().has(bank)) return null;
  return [motion!, Math.max(0, delay)];
}

export interface BakedMotion {
  bank: string;
  frames: number;
  fps: number;
  root: number[];
  rot: number[];
  play?: number;
}

/**
 * Parsed `mot/` banks, per source.
 *
 * The reference implementation re-reads the file on every {@link bake}, which
 * on a local disk is a few hundred redundant reads and costs seconds. Here a
 * read is a `FileSystemFileHandle` away and a bank is up to a megabyte, so the
 * same shape would be minutes. A bank is immutable once parsed and the file
 * cannot change under a running export, so the cache is invisible.
 */
const BANK_CACHE = new WeakMap<AssetSource,
                               Map<string, Awaited<ReturnType<typeof loadBank>>>>();

async function cachedBank(source: AssetSource, fname: string,
                          ids: number[]): ReturnType<typeof loadBank> {
  let per = BANK_CACHE.get(source);
  if (!per) { per = new Map(); BANK_CACHE.set(source, per); }
  if (per.has(fname)) return per.get(fname)!;
  const bank = await loadBank(source, fname, ids);
  per.set(fname, bank);
  return bank;
}

/** Decode a motion into flat arrays the client can index cheaply. */
export async function bake(source: AssetSource, tables: ExeTables,
                           motionId: number,
                           boneCount: number): Promise<BakedMotion | null> {
  const bankId = tables.motionBankOf(motionId);
  const banks = tables.motionBanks();
  if (bankId === null || !banks.has(bankId)) return null;
  const [fname, ids] = banks.get(bankId)!;
  const bank = await cachedBank(source, fname, ids);
  if (bank === null) return null;
  // A motion belongs to the skeleton its own block size implies. Reading it at
  // any other stride walks into the next motion's data and returns
  // plausible-looking garbage rather than failing -- which is how `kame.bin`
  // motion 441, a 24-bone clip, reached a 16-bone character's bundle as
  // denormals and a NaN.
  const implied = bank.impliedBoneCount(motionId);
  if (implied !== null && implied !== boneCount) return null;
  let frames = bank.frames(motionId, boneCount);
  if (!frames.length) return null;
  frames = frames.slice(0, MAX_BAKED_FRAMES);
  const root: number[] = [];
  const rot: number[] = [];
  for (const f of frames) {
    root.push(f.root[0], f.root[1], f.root[2]);
    for (const b of f.bones) rot.push(b[0], b[1], b[2]);
  }
  // A motion read with the wrong bone count decodes into whatever follows it
  // in the bank, which shows up as denormals and NaN rather than as an error.
  // Refuse it here: a motion whose root is not finite was not read correctly,
  // whatever the stride said.
  if (!root.every((v) => Number.isFinite(v))) return null;
  // `g_motion_play_length[motion]`, and the reason it is carried rather than
  // derived: every cue the scripts express in clip frames is in these units,
  // they run at about twice the authored frames, and the exact value is
  // `2n - 2` or `2n - 3` with no rule that says which.
  const play = tables.motionPlayLength(motionId);
  const out: BakedMotion = { bank: fname, frames: frames.length,
                             fps: MOTION_FPS, root, rot };
  if (play !== null && play > 0) out.play = play;
  return out;
}
