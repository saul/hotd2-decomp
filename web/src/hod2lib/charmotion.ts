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

/**
 * The clip the rescue swaps to — `RescueTargetHeldState` (`FUN_00451980`)
 * writes `obj+0x1B4 = 0x3CC` on its way into `RescueTargetFreedState`
 * (`FUN_00451D80`), which plays it out.
 *
 * Baked beside the idle because the freed state measures nothing but the
 * clip's own play clock, and a clip with no frames is a pose that never ends.
 */
export const CLASS21_FREED_MOTION = 0x3cc;

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
/**
 * Every clip class 0x19's twenty-four states name as a literal, read out of
 * `g_class19_states`' routines: 0x65 and 0x7A/0x7B are the three strikes, 0x69
 * the death, 0x6B the fighting idle, 0x6C..0x6E the walks, 0x6F and 0x73 the
 * two flinches, 0x70 the charge, 0x71 the knock-down, 0x72 the rise, 0x74 and
 * 0x75 the landing pair, 0x76 the look, 0x78 the stand, and 0x7C/0x7D the
 * entrance and the roar.
 *
 * They are baked because **an unbaked clip is an actor that waits for ever**:
 * half of this class's states leave on
 * `obj+0x19C == g_motion_play_length[obj+0x1B4] - 1`, and with no clip that
 * length is 0 and the cursor never reaches it. `Boss4StateDeath` writes
 * `g_script_flags[32]` on frame 0x46 of clip 0x69, so without 0x69 in the
 * bundle the gate behind the stage-4 boss cannot open at all.
 */
export const BOSS4_CLIPS: readonly number[] = [
  0x65, 0x69, 0x6b, 0x6c, 0x6d, 0x6e, 0x6f, 0x70, 0x71, 0x72,
  0x73, 0x74, 0x75, 0x76, 0x78, 0x7a, 0x7b, 0x7c, 0x7d,
];

/**
 * Class 0x11's whole motion bank -- bank 14, which `ExeTables.motionBanks()`
 * names `frog.bin`, ids `0x13D`..`0x145`.
 *
 * The class names seven of the nine as literals across its states: `0x13E` the
 * leap, `0x13F` the death, `0x140` the travelling hop, `0x141` the idle,
 * `0x142`/`0x143` the two 45-degree turns and `0x144` the stationary hop.
 * `0x13D` and `0x145` are in the bank and referenced by nothing in the class.
 *
 * All nine are baked for the same reason `BOSS4_CLIPS` is: **an unbaked clip
 * is an actor that waits for ever.** Every one of the frog's hop substates
 * leaves on an exact play-cursor frame or on `MotionPlayLength`, and with no
 * clip that length is 0, the cursor never reaches 18, and the frog turns to
 * face its heading and then never jumps.
 */
export const FROG_CLIPS: readonly number[] = [
  0x13d, 0x13e, 0x13f, 0x140, 0x141, 0x142, 0x143, 0x144, 0x145,
];

/**
 * The two clips `ZombieStateReleaseBodyCreature` (`FUN_00457FB0`) names, per
 * character type.
 *
 * `0x1E3` is the walk it backs out to its inner approach ring on and `0x1DF`
 * the clip it opens the torso during, and both are literals in that state.
 * They are baked for the reason {@link BOSS4_CLIPS} and {@link FROG_CLIPS}
 * are: **an unbaked clip is an actor that waits for ever.** Sub 1 holds on
 * `0x1E3`'s root motion to leave the ring, and sub 3 leaves on
 * `obj+0x19C >= g_motion_play_length[0x1DF] - 1` -- which is 0 for a clip the
 * bundle does not carry, so the cursor never reaches it.
 *
 * Measured, and this is why it is a rule and not a guess: `znjoe.bin`'s bank
 * reaches the bundle with 477, 478, 480, 481, 482 and 484 in it and **not**
 * 479 or 483, because nothing that named a clip named those two. A first
 * torso shot then put the actor in state 25, where it stood in sub 1 for the
 * rest of the stage and released nothing.
 *
 * Keyed by character type because the state is: `ActorReactToHit`
 * (`FUN_004543F0`) is the only way in and it tests `obj+0x1F4` against
 * `0x0A`.
 */
export const BODY_CREATURE_HOST_CLIPS: Record<number, readonly number[]> = {
  0x0a: [0x1df, 0x1e3],
};

/**
 * The clips `ChooseDeathMotion` (`FUN_004560B0`) can put on a class-0x30 actor
 * that the **directional** set does not carry.
 *
 * The directional pick — `ChooseDeathMotionDirectional` (`FUN_00456220`), the
 * four ±45° arcs — travels already: two of its arms are tables in the EXE and
 * the other two are the literals 991 and 992. These six are the arms *above*
 * it, and they were baked for nobody:
 *
 * * `0x3F9` — `obj+0x34` bit `0x1000000`, tested at `0x004560DD`
 *   (`f7463400000001`) with **no character-type guard**. The bit is seeded
 *   from the spawn record's `+0x04` init flags, which `ActorInitFlags`
 *   (`FUN_00408970`) ORs with 1 into `obj+0x34`, and **every shipped record
 *   that sets it is class 0x30**: stage 1's state-26 leapers, stage 3's two
 *   state-33 axe men, and twelve `ZombieStateCarryProp` spawns — which is the
 *   corroboration that the bit means *this actor has hold of something*.
 *   `tools/verify_death_clips.py` counts them, so this does not (`L16`).
 * * `0x3F8` — the landing clip `ZombieStateDeathFallAndBounce`
 *   (`FUN_00456DF0`) cuts to when the body hits the ground. It travels with
 *   `0x3F9` because `ZombieStateDeath6` (`FUN_00454D20`) reads that same bit
 *   to send the actor to state 12 rather than to the corpse, so the two are
 *   one path and not two.
 * * `0x404` / `0x41A` — body condition 4's coin toss, the `NEG`/`SBB` idiom at
 *   `0x004561EA`: `rand()`, normalised, `AND EAX, 0x16`, `ADD EAX, 0x404`.
 *   Stage 2's `znkager` crawlers are condition 4, and neither clip was in any
 *   bundle, so every one of them snapped to a corpse with no death animation
 *   at all.
 * * `0x3DA` / `0x3DB` — condition 4's special arm and the conditions-5/6 arm.
 *   Already in most bundles through the directional tables; offered here so
 *   the set is what the routine can reach rather than what happens to be
 *   there for another reason.
 *
 * **Baked for every class-0x30 character type, not for the spawns that carry
 * the bit.** The exporter bakes per character *type*, and the two zombies that
 * hung stage 3's block 2 were character type 19 (`tutorial`), whose spawn
 * records do **not** set bit `0x1000000` — so a set gated on the records would
 * have missed the reproduced hang. Body condition is recomputed at runtime by
 * `ActorBodyConditionFromHands` (`FUN_00455920`) as parts come off, so a
 * condition gate would be wrong in the same way. `bake` refuses a clip whose
 * own block size implies another skeleton, so the list is offered whole and
 * filtered by the data: all six decode at 16 bones, and all nineteen
 * class-0x30 character types in the twelve bundles are 16-bone.
 *
 * **What is deliberately out**, so the gap is written down rather than
 * implicit: the four destroyed-part arms, `obj+0x1368` bits `0x8`, `0x10`,
 * `0x40` and `0x80` giving `0x1AC`, `0x1A5`, `0x279` and `0x229`. All four
 * decode at 16 bones, and nothing in the ported call graph raises any of those
 * bits — `ZombieStateTargetMotionScript` and `ZombieStateDragTarget` set them
 * from a kill-move clip id the port does not model. When one of those bits
 * gets a writer, its clip belongs in this list on the same day.
 *
 * Baked for the reason {@link BOSS4_CLIPS} and {@link BODY_CREATURE_HOST_CLIPS}
 * are, and this one cost a hang rather than a pose: state 12 sub 1 is
 * `if (obj+0x19C < 0x3C) return;` against `g_motion_play_length[0x3F9]`, which
 * is **85**. With no clip the play cursor stays at 0, the actor never leaves
 * state 12, `ZombieEnterCorpseState` never runs, and `g_enemies_present` never
 * falls — so a `wait_scripted_actors` behind a dead civilian who is herself
 * waiting on `g_enemies_present` can never come down.
 */
export const CLASS30_DEATH_CLIPS: readonly number[] = [
  0x3da, 0x3db, 0x3f8, 0x3f9, 0x404, 0x41a,
];

export const MOTION_RULES: Record<number, MotionRule> = {
  // `Boss4Init` (`FUN_004917E0`) seats the clip as a literal:
  // `MOV dword ptr [ECX + 0x20], 0x7C` at `0x0049183E`, where `ECX` is
  // `obj+0x194` and `+0x20` is `obj+0x1B4`. Clip 124 is in motion bank 7,
  // which is `boss4.bin`'s. Without this rule the four class-0x19 spawns
  // resolve to a character with no motion and the exporter emits them as
  // markers, so the boss is placed and never built.
  0x19: ["literal", 0x7c],
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
  // `Class14Init` (`FUN_00475E90`) writes `state->animSlot = 0xB` and then
  // `char->motion = *(s16 *)g_class14_anim_slots[0xB]`, which is 33. Without a
  // rule here the stage-2 boss resolves to a character with no motion and the
  // exporter builds no skeleton for it at all -- stage 5, whose only class-0x14
  // spawn is its own, had no character type 71 in its bundle.
  // `PlaceBats` (`FUN_0042D9C0`) seats the clip as a literal on every member:
  // `obj+0x1B4 = 0x407`, the 22-frame `zabat.bin` clip in motion bank 3.
  // Without it the 27 class-0x46 spawns resolve to a character with no motion
  // and the exporter emits them as markers, so every bat is placed and never
  // built. The wing's `0x406` travels with character type 0x1F, which no
  // placement names -- see `game/class46/`.
  0x46: ["literal", 0x407],
  0x14: ["literal", 33],
  // `RescueTargetInit` (`FUN_00451720`) seats the clip as a literal, the same
  // shape as class 0x19's: `MOV dword ptr [EDI + 0x20], 0x3E6`
  // (`c74720e6030000`) at `0x00451747` with `EDI = obj+0x194`, so
  // `obj+0x1B4 = 0x3E6`. Clip **998** is one character type 7
  // (`char_adv00.bin`) carries, which is the corroboration.
  //
  // There is one class-0x21 spawn in the whole game -- stage 2 block 0 step 2
  // -- and it is the actor that answers that block's branch. Without this row
  // `motionFor` answers null, `resolveForStage` records the placement as a
  // marker and `continue`s, no skeleton is built, no `chr_` instance reaches
  // the glTF, and `render/characters.ts` has nothing to adopt: the object is
  // never made, `RescueTargetHeldState` never runs and `g_script_branch_var`
  // can never become 1. Block 0 then always takes block 11 and block 1 --
  // half of stage 2 -- is unreachable. See `game/class21/`.
  0x21: ["literal", 0x3e6],
  // `FrogInit` (`FUN_0043A080`) writes `obj+0x1B4 = (s16)tail+0x02`, which is
  // `0x141` in all four shipped spawns. Without a rule the frog resolves to a
  // character with no motion, the exporter emits it as a marker, and none of
  // its nine clips reaches the bundle -- see {@link FROG_CLIPS}.
  0x11: ["param", 0x02, "i16"],
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
