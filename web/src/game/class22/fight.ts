/**
 * Class 0x22's two fights — `Class22FightPhase1` (`FUN_0049B850`) while the
 * walker stands, `Class22FightPhase2` (`FUN_0049C190`) after it falls — and
 * the path pickers they share.
 *
 * Phase 1 flies `op_st1` paths `0x104 + P` **in the walker's own frame**: the
 * path point is an offset that the tail carries through
 * `T(companion) RotY(companion.yaw + 0x8000)`, so the flier circles the
 * walker wherever it goes. Phase 2 flies paths `0x140..0x144` in the
 * camera's frame and strikes the player itself.
 *
 * Both tails were read past the `MatrixStackPop` Ghidra ends them at (L35).
 */
import type { JudgmentActor } from "../actor";
import { BossHpFractionOf } from "../boss_hp_bar";
import { ActorSetMotionBlended } from "../class30/motion_cue";
import { ActorByAt, G } from "../globals";
import {
  MatIdentity, MatrixRotateY, MatrixTransformPoint, MatrixTranslate,
} from "../matrix";
import { ActorAdvanceMotion } from "../motion";
import type { ClassFrame } from "../registry";
import { MotionPlayLength } from "../tables";
import { LerpWeighted } from "../vec";
import { Class22DrawAndPoseSubActor } from "./draw";
import {
  Class22EvalCameraRelativePath, Class22EvalObjectPathOffset,
  Class22FaceCamera,
} from "./paths";
import {
  CAM_PATH_LENGTH, CLASS22_AGGRESSION_ROLL, CLASS22_CUE_FRAMES,
  CLASS22_CUE_MOTIONS, CLASS22_PATH_KEYS, CLASS22_PATH_SPEED,
  CLASS22_PHASE1_PATH_PICKS, CLASS22_PHASE2_PICK_ROWS, CLASS22_PHASE2_PICKS,
  Class22Clip, PICK_NEAR_DISTANCE,
} from "./records";
import {
  Class22ChargeShots, Class22Phase1TakeShots, Class22Phase2TakeShots,
  Class22PlaySound, Class22RegisterForShotTest, Class22StepAggression,
  Class22StrikePlayers, JudgmentRegisterEnemySlot,
} from "./shot";
import {
  Class22Flag, Class22Relative, Class22Variant, type Class22Descriptor,
  type JudgmentTail,
} from "./state";

void Class22ChargeShots;

/** The first phase-1 path slot, `ADD ECX, 0x104`. */
const PHASE1_PATH_BASE = 0x104;
/** The first phase-2 path slot, `ADD ECX, 0x140`; the hover's is `0x144`. */
const PHASE2_PATH_BASE = 0x140;
const PHASE2_HOVER_PATH = 0x144;
/** `33` — phase-1 paths `P` and `P + 33` share a `g_class22_path_keys` row. */
const PATH_KEY_ROWS = 0x21;
/** `PickCompanionStrikePath`: `27 + rand() % 3`; `PickTauntPath`: `30 + rand() % 3`. */
const STRIKE_PATH_BASE = 0x1b;
const TAUNT_PATH_BASE = 0x1e;
/** `MOV dword [+0x1334], 0x14` — the glide's length. */
const EASE_FRAMES = 0x14;
/** `0.5` (`0x004C43AC`), `-0.05` (`0x0056B180`), `0.05` (`0x0055CBB8`), all floats. */
const HALF = 0.5;
const EASE_BACK = Math.fround(-0.05);
const EASE_ON = Math.fround(0.05);
/** `+0x1320 ? 1.3 (0x00565EEC) : 1.0 (0x004C4380)` — sub 7's path step. */
const CUE_STEP = [1.0, Math.fround(1.3)];
/** `FADD [0x004E30F0]` 2.0 — subs 9 and 13's catch-up step. */
const CATCH_UP_STEP = 2.0;
/** `CMP [+0x19C], 99` — the taunt clip's last cursor value, sub 11. */
const TAUNT_LAST_CURSOR = 99;
/** `MOV [+0x1328], 0x78` — the hint pause. */
const HINT_FRAMES = 0x78;
/** The two hint lines, dialogue groups `0x1B` and `0x1C`. */
const HINT_LINE_FIRST = 0x1b;
const HINT_LINE_SECOND = 0x1c;
/** The cue voices, `ST1\30_ZE.WAV` / `ST5\337_ZE.WAV`. */
const SND_CUE: Readonly<Record<number, number>> = {
  [Class22Variant.Stage1]: 0x20000085, [Class22Variant.Stage5]: 0x20000192,
};
/** The taunt's laugh, `STAGE1_SE\WARAI_22` / `STAGE5_SE\WARAI_22`. */
const SND_TAUNT: Readonly<Record<number, number>> = {
  [Class22Variant.Stage1]: 0x3018a9, [Class22Variant.Stage5]: 0x3323a9,
};
/** `PlaySoundId(0x004317A9)` — `COMMON2\HABATAK1_16`, the wing-beat. */
export const SND_FLAP = 0x4317a9;

/** `0x3E19999A` — phase 2's rise, and its acceleration seed. */
const RISE_ACCEL = Math.fround(0.15);
/** `FCOMP [0x00564420]` 60.0 — the height phase 2 climbs to. */
const RISE_TOP = 60.0;
/** `0x3C` — every glide's length; `10` sub 12's. */
const GLIDE_FRAMES = 0x3c;
const GLIDE_SHORT = 10;
/** `99 < n` — sub 7's hold before an attack pass. */
const PHASE2_HOLD = 99;
/** `PlayerTakeDamage(p, 1, 7)` — the flier's strike, overlay kind 7. */
const STRIKE_OVERLAY = 7;
/** `ADD [+0x1354], 4` — aggression a pass adds. */
const PASS_AGGRESSION = 4;

const _m = MatIdentity();

/**
 * `Class22PickPhase1Path` — `FUN_0049DC90`. Three draws, in this order:
 *
 * ```
 * r1 = rand(); near = +0x1370 <= 60.0; hot = g_class22_aggression_roll[aggr] <= r1 % 100
 * r2 = rand() % 10; P = g_class22_phase1_path_picks[(near + 2*hot)*10 + r2]
 * r3 = rand() & 1; +0x1340 = 0; +0x1350 = P + 33*r3
 * ```
 */
export function Class22PickPhase1Path(t: JudgmentTail, f: ClassFrame): void {
  const r1 = f.rng.int(100);
  const near = t.companionDist <= PICK_NEAR_DISTANCE ? 1 : 0;
  const hot = (CLASS22_AGGRESSION_ROLL[t.aggression] ?? 0) <= r1 ? 1 : 0;
  const r2 = f.rng.int(10);
  const pick = CLASS22_PHASE1_PATH_PICKS[(near + hot * 2) * 10 + r2] ?? 0;
  const r3 = f.rng.int(2);
  t.pathFrame = 0;
  t.path = pick + r3 * PATH_KEY_ROWS;
}

/** `Class22PickCompanionStrikePath` — `FUN_0049DD30`. `P = 27 + rand() % 3`. */
export function Class22PickCompanionStrikePath(t: JudgmentTail,
                                               f: ClassFrame): void {
  const r = f.rng.int(3);
  t.pathFrame = 0;
  t.path = r + STRIKE_PATH_BASE;
}

/** `Class22PickTauntPath` — `FUN_0049DD60`. `P = 30 + rand() % 3`. */
export function Class22PickTauntPath(t: JudgmentTail, f: ClassFrame): void {
  const r = f.rng.int(3);
  t.pathFrame = 0;
  t.path = r + TAUNT_PATH_BASE;
}

/**
 * `Class22EaseToNearestPathKey` — `FUN_0049DD90`. A twenty-frame glide of
 * the path frame toward whichever of 0, the row's key or its end is nearer:
 *
 * ```
 * f < key:  key*0.5 > f  ? step = f * -0.05          : step = (key - f) * 0.05
 * f >= key: (key+end)*0.5 > f ? step = (f - key) * -0.05 : step = (end - f) * 0.05
 * ```
 */
export function Class22EaseToNearestPathKey(t: JudgmentTail): void {
  const row = CLASS22_PATH_KEYS[t.path % PATH_KEY_ROWS];
  const f = t.pathFrame;
  let target: number;
  if (row.key <= f) {
    if (f < (row.key + row.end) * HALF) {
      t.easeLeft = EASE_FRAMES;
      t.easeStep = Math.fround((f - row.key) * EASE_BACK);
      return;
    }
    target = row.end;
  } else {
    if (f < row.key * HALF) {
      t.easeLeft = EASE_FRAMES;
      t.easeStep = Math.fround(f * EASE_BACK);
      return;
    }
    target = row.key;
  }
  t.easeLeft = EASE_FRAMES;
  t.easeStep = Math.fround((target - f) * EASE_ON);
}

/** `Class22EvalObjectPathOffset(obj, 0x104 + P, f)` — phase 1's ride. */
function Ride(obj: JudgmentActor, f: ClassFrame, frame: number): void {
  Class22EvalObjectPathOffset(obj.judgment, f.host,
                              obj.judgment.path + PHASE1_PATH_BASE, frame);
}

/** The row's `end` — `g_class22_path_keys[P % 33].end`. */
function PathEnd(t: JudgmentTail): number {
  return CLASS22_PATH_KEYS[t.path % PATH_KEY_ROWS].end;
}

/** `cursor == g_motion_play_length[clip] - 1`, against the last draw's cursor. */
function AtLastFrame(obj: JudgmentActor): boolean {
  return obj.judgment.cursor === MotionPlayLength(obj) - 1;
}

/**
 * `Class22FightPhase1` — `FUN_0049B850`. `g_class22_states[3]` and `[7]`.
 *
 * Fourteen subs through the jump table at `0x0049C158`. What they are, by
 * the code: 0 the reset; 1 the flight, which hands to 5 or 7 when the walker
 * begins a strike; 2, 6, 8 and 12 the flinches' recoveries; 3 and 5 the
 * glides; 4 the wait for the walker's react to end; 7 the strike path with
 * its cue clip; 9 and 13 the catch-ups; 10 the wait for the walker's strike
 * to end, and the taunt; 11 the taunt path.
 */
export function Class22FightPhase1(obj: JudgmentActor, f: ClassFrame,
                                   d: Class22Descriptor): void {
  const t = obj.judgment;
  const comp = ActorByAt(t.companionAt);
  // The hint pause: `CMP [+0x130C], 1; ... DEC [+0x1328]` and on the frame it
  // runs out `g_bHudShutterState = 1` at `0x0049B899`.
  if (t.variant === Class22Variant.Stage1 && t.hint !== 0) {
    const old = t.hintFrames;
    t.hintFrames = old - 1;
    if (old < 1) {
      t.hint = 0;
      G.g_bHudShutterState = 1;
    }
  }
  Class22StepAggression(t);
  Class22Phase1TakeShots(obj, f, d);
  // `CMP word ptr [+0x1310], 2; JZ return` -- phase 2 began inside the shot
  // routine, which drew and stepped the counter itself.
  if (obj.state === Class22Relative.Phase2) return;
  t.transfer = 0;
  const reacting = (obj.flags & Class22Flag.Reacting) !== 0;

  // Sub 0 falls into sub 1: the reset, the first path, and on.
  if (obj.sub === 0) {
    t.transfer = 0; t.hintFrames = 0; t.hint = 0; t.path = 0;
    t.aggression = 8; t.charged = 0; t.companionHits = 0;
    t.companionStruck = 0; t.hitsTaken = 0; t.strikesLanded = 0;
    t.taunt = 0; t.pathFrame = 0;
    Class22PickPhase1Path(t, f);
    Ride(obj, f, t.pathFrame);
    obj.sub += 1;
  }
  switch (obj.sub) {
    case 1: {
      if ((obj.flags & Class22Flag.Reacting) !== 0) break;
      Ride(obj, f, t.pathFrame);
      const speed = CLASS22_PATH_SPEED[G.g_damage_rank + t.hpStage * 16] ?? 0;
      t.pathFrame = Math.fround(speed + t.pathFrame);
      if (comp && comp.sub === 2) {
        // The walker is mid-strike.
        if (t.pathFrame < PathEnd(t)) {
          Class22EaseToNearestPathKey(t);
          obj.sub = 5;
          t.taunt = 0;
        } else {
          obj.flags &= ~(Class22Flag.Reacting | Class22Flag.Flinched);
          Class22PickCompanionStrikePath(t, f);
          obj.sub = 7;
          t.taunt = 0;
        }
      } else if (PathEnd(t) <= t.pathFrame) {
        Class22PickPhase1Path(t, f);
      }
      break;
    }
    case 2:
      Ride(obj, f, t.pathFrame);
      if (AtLastFrame(obj)) {
        obj.flags &= ~Class22Flag.Reacting;
        ActorSetMotionBlended(obj, Class22Clip.Fly, 0, 3);
        Class22EaseToNearestPathKey(t);
        obj.sub = 3;
      }
      break;
    case 3:
      if (t.easeLeft < 1) { Phase1RepickAndWait(obj, f); break; }
      Glide(obj, f);
      break;
    case 4:
      Ride(obj, f, t.pathFrame);
      if (comp && (comp.flags & Class22Flag.Reacting) === 0) {
        obj.sub = 1;
        obj.flags &= ~Class22Flag.Flinched;
      }
      break;
    case 5:
      if (reacting) break;
      if (t.easeLeft === 0) {
        obj.flags &= ~(Class22Flag.Reacting | Class22Flag.Flinched);
        Class22PickCompanionStrikePath(t, f);
        t.cueCount = 0;
        obj.sub = 7;
        break;
      }
      Glide(obj, f);
      break;
    case 6:
      Ride(obj, f, t.pathFrame);
      if (t.done !== 0 && (obj.flags & Class22Flag.Reacting) !== 0) {
        obj.flags &= ~Class22Flag.Reacting;
        ActorSetMotionBlended(obj, Class22Clip.Fly, 0, 3);
        obj.sub = 3;
      }
      break;
    case 7: {
      if (reacting) break;
      if (t.cueCount === CLASS22_CUE_FRAMES[t.hpStage]) {
        ActorSetMotionBlended(obj, CLASS22_CUE_MOTIONS[t.hpStage], 0, 3);
        const snd = SND_CUE[t.variant];
        if (snd !== undefined) Class22PlaySound(f, snd);
      }
      if (obj.motion === CLASS22_CUE_MOTIONS[t.hpStage] && AtLastFrame(obj)) {
        ActorSetMotionBlended(obj, Class22Clip.Fly, 0, 3);
      }
      Ride(obj, f, t.pathFrame);
      t.pathFrame = Math.fround(t.pathFrame + CUE_STEP[t.hpStage === 0 ? 0 : 1]);
      if (PathEnd(t) <= t.pathFrame) {
        Class22PickPhase1Path(t, f);
        obj.sub = 10;
      }
      t.cueCount = Math.fround(t.cueCount + 1.0);
      break;
    }
    case 8:
      Ride(obj, f, t.pathFrame);
      if (t.done === 0 || (obj.flags & Class22Flag.Reacting) === 0) break;
      obj.flags &= ~Class22Flag.Reacting;
      ActorSetMotionBlended(obj, Class22Clip.Fly, 0, 3);
      obj.sub += 1;
      break;
    case 9:
    case 13:
      if (t.pathFrame < PathEnd(t)) {
        Ride(obj, f, t.pathFrame);
        t.pathFrame = Math.fround(t.pathFrame + CATCH_UP_STEP);
        break;
      }
      Phase1RepickAndWait(obj, f);
      break;
    case 10:
      Ride(obj, f, t.pathFrame);
      // Wait out the walker's strike.
      if (comp && (comp.flags & Class22Flag.Striking) !== 0) break;
      obj.flags &= ~Class22Flag.Flinched;
      if (t.taunt === 0) { obj.sub = 1; break; }
      ActorSetMotionBlended(obj, Class22Clip.Taunt, 0, 3);
      if (SND_TAUNT[t.variant] !== undefined) {
        Class22PlaySound(f, SND_TAUNT[t.variant]);
      }
      t.taunt = 0;
      Class22PickTauntPath(t, f);
      obj.sub = 11;
      // The hint lines: only in stage 1, and only if the flier has never been
      // hit -- `+0x1364 == 0` -- on the walker's first and second strike.
      if (t.variant === Class22Variant.Stage1 && t.hitsTaken === 0) {
        if (t.strikesLanded === 1) {
          Phase1Hint(obj, f, HINT_LINE_FIRST);       // 0x0049BE49
        } else if (t.strikesLanded === 2) {
          Phase1Hint(obj, f, HINT_LINE_SECOND);      // 0x0049BE7B
        }
      }
      break;
    case 11:
      if (reacting) break;
      if (obj.motion === Class22Clip.Taunt
          && t.cursor === TAUNT_LAST_CURSOR) {
        ActorSetMotionBlended(obj, Class22Clip.Fly, 0, 3);
      }
      Ride(obj, f, t.pathFrame);
      t.pathFrame = Math.fround(t.pathFrame + 1.0);
      if (t.pathFrame < PathEnd(t)) break;
      ActorSetMotionBlended(obj, Class22Clip.Fly, 0, 3);
      Class22PickPhase1Path(t, f);
      obj.sub = 1;
      break;
    case 12:
      Ride(obj, f, t.pathFrame);
      if (t.done === 0 || (obj.flags & Class22Flag.Reacting) === 0) break;
      obj.flags &= ~Class22Flag.Reacting;
      ActorSetMotionBlended(obj, Class22Clip.Fly, 0, 3);
      obj.sub += 1;
      break;
    default:
      break;
  }

  // The tail, `0x0049C003` -- past the `MatrixStackPop` at `0x0049C093`.
  // The facing is taken from the OLD position, before the carry below.
  obj.yaw = Class22FaceCamera(obj.pos.x, obj.pos.z, f.eye.x, f.eye.z);
  if (comp) {
    for (let i = 0; i < 16; i++) _m[i] = i % 5 === 0 ? 1 : 0;
    MatrixTranslate(_m, comp.pos.x, comp.pos.y, comp.pos.z);
    MatrixRotateY(_m, comp.yaw + 0x8000);
    MatrixTransformPoint(_m, t.point, obj.pos);
    obj.pos.x = Math.fround(obj.pos.x);
    obj.pos.y = Math.fround(obj.pos.y);
    obj.pos.z = Math.fround(obj.pos.z);
  }
  // `FSTP [0x009C8E10]` at `0x0049C0B7`.
  G.g_boss_hp_fraction = BossHpFractionOf(obj.hp, obj.maxHp);
  Class22DrawAndPoseSubActor(obj, f);
  ActorAdvanceMotion(obj, f.dt);
  // `obj+0x70 = g_camera_world_to_view * obj+0x100; obj+0x34 &= ~0xE;
  // RegisterForShotTest(obj)` at `0x0049C145`. Never a camera candidate in
  // this phase: the call is `RegisterForShotTest`, not
  // `ActorRegisterCameraPoint`.
  obj.flags &= ~0xe;
  Class22RegisterForShotTest(obj, f.host, t);
}

/** `LAB_0049BFF1` — `Class22PickPhase1Path; sub = 4`, reached from subs 3, 9 and 13. */
function Phase1RepickAndWait(obj: JudgmentActor, f: ClassFrame): void {
  Class22PickPhase1Path(obj.judgment, f);
  obj.sub = 4;
}

/** `LAB_0049BAB7` — the glide: ride at `f`, `+0x1334--`, `f += +0x1344`. */
function Glide(obj: JudgmentActor, f: ClassFrame): void {
  const t = obj.judgment;
  Ride(obj, f, t.pathFrame);
  t.easeLeft -= 1;
  t.pathFrame = Math.fround(t.easeStep + t.pathFrame);
}

/**
 * One hint line: `+0x1324 = 1; +0x1328 = 0x78; g_bHudShutterState = 5;
 * EvtOpPlayDialogue2D(line)`. The line plays as evt op 0x2D would --
 * `EvtOpPlayDialogue2D` (`FUN_00435B80`) is that opcode's own handler, and
 * the port's is the host's (`civilian.dialogue` is the event every caller of
 * it raises).
 */
function Phase1Hint(obj: JudgmentActor, f: ClassFrame, line: number): void {
  const t = obj.judgment;
  t.hint = 1;
  t.hintFrames = HINT_FRAMES;
  G.g_bHudShutterState = 5;
  f.events?.emit("civilian.dialogue", { at: obj.at, group: line });
}

/** `pick` — `g_class22_phase2_picks[g_class22_phase2_pick_rows[aggr] * 10 + rand() % 10]`. */
function Phase2Pick(t: JudgmentTail, f: ClassFrame): void {
  const r = f.rng.int(10);
  const row = CLASS22_PHASE2_PICK_ROWS[t.aggression] ?? 0;
  t.path = CLASS22_PHASE2_PICKS[r + row * 10] ?? 0;
}

/** `lerp(k)` — `pos = LerpWeighted(pos, +0x13C0, 1, k)` per axis, stored as floats. */
function Phase2Lerp(obj: JudgmentActor, den: number): void {
  const p = obj.judgment.point;
  obj.pos.x = Math.fround(LerpWeighted(obj.pos.x, p.x, 1, den));
  obj.pos.y = Math.fround(LerpWeighted(obj.pos.y, p.y, 1, den));
  obj.pos.z = Math.fround(LerpWeighted(obj.pos.z, p.z, 1, den));
}

/** The snap every glide ends in: `pos = +0x13C0`. */
function Snap(obj: JudgmentActor): void {
  const p = obj.judgment.point;
  obj.pos.x = p.x; obj.pos.y = p.y; obj.pos.z = p.z;
}

/** `Class22EvalCameraRelativePath(obj, slot, frame)`. */
function Cam(obj: JudgmentActor, f: ClassFrame, slot: number,
             frame: number): void {
  Class22EvalCameraRelativePath(obj.judgment, f.host, f.eye, slot, frame);
}

/**
 * `Class22FightPhase2` — `FUN_0049C190`. `g_class22_states[4]` and `[8]`.
 *
 * Thirteen subs through the jump table at `0x0049C8DC`: 0/1 the rise to
 * y 60, 2 the glide onto the first path, 3 an attack pass that strikes the
 * player five frames before its end, 5 the glide to the next, 7 the hold
 * before a pass, and 4/6/8..12 the recoveries a flinch in 3, 5, 7, 9 or 10
 * leads through.
 */
export function Class22FightPhase2(obj: JudgmentActor, f: ClassFrame): void {
  const t = obj.judgment;
  if (t.aggression < 0) t.aggression = 0;
  if (t.aggression > 15) t.aggression = 15;
  Class22Phase2TakeShots(obj, f);
  if (obj.state === Class22Relative.Death) return;

  // Sub 0 falls into sub 1.
  if (obj.sub === 0) {
    t.counter = 0;
    obj.accY = RISE_ACCEL;
    obj.vel.y = 0;
    obj.sub += 1;
  }
  switch (obj.sub) {
    case 1: {
      // `+0x50 += +0x5C; y += +0x50`, both stored as floats.
      obj.vel.y = Math.fround(obj.accY + obj.vel.y);
      obj.pos.y = Math.fround(obj.vel.y + obj.pos.y);
      if (RISE_TOP <= obj.pos.y) {
        obj.accY = RISE_ACCEL;
        obj.vel.y = 0;
        t.counter = 0;
        Phase2Pick(t, f);
        Cam(obj, f, t.path + PHASE2_PATH_BASE, t.counter);
        obj.sub += 1;
      }
      break;
    }
    case 2: {
      Phase2Lerp(obj, GLIDE_FRAMES - t.counter);
      const n = t.counter;
      t.counter = n + 1;
      if (n > GLIDE_FRAMES) {
        Snap(obj);
        ActorSetMotionBlended(obj, Class22Clip.Hover, 0, 3);
        obj.flags &= ~Class22Flag.Reacting;
        // `RegisterEnemySlot(obj)` at `0x0049C347`.
        JudgmentRegisterEnemySlot(t);
        t.counter = 0;
        obj.sub = 7;
      }
      break;
    }
    case 3: {
      Cam(obj, f, t.path + PHASE2_PATH_BASE, t.counter);
      Snap(obj);
      t.counter += 1;
      const len = CAM_PATH_LENGTH[t.path + PHASE2_PATH_BASE] ?? 0;
      if (t.counter !== len - 5) {
        if (len < t.counter) {
          t.counter = 0;
          Phase2Pick(t, f);
          Cam(obj, f, t.path + PHASE2_PATH_BASE, t.counter);
          obj.sub = 5;
        }
        break;
      }
      // The strike: `PlayerTakeDamage(p, 1, 7)` by `g_active_player`, and
      // four points of aggression whether or not anyone could be hit.
      Class22StrikePlayers(obj, f, STRIKE_OVERLAY);
      t.aggression += PASS_AGGRESSION;
      break;
    }
    case 4:
      // `n = 0`, then sub 6's code.
      t.counter = 0;
      Cam(obj, f, PHASE2_HOVER_PATH, 0);
      obj.sub = 9;
      break;
    case 6:
      Cam(obj, f, PHASE2_HOVER_PATH, 0);
      obj.sub = 9;
      break;
    case 5: {
      Phase2Lerp(obj, GLIDE_FRAMES - t.counter);
      const n = t.counter;
      t.counter = n + 1;
      if (n > GLIDE_FRAMES) {
        Snap(obj);
        ActorSetMotionBlended(obj, Class22Clip.Swoop, 0, 3);
        t.counter = 0;
        obj.sub = 7;
      }
      break;
    }
    case 7:
      // `(-1 < g_active_player) && (n++ > 99)` -- the hold only counts while
      // somebody can be attacked.
      if (G.g_active_player > -1) {
        const n = t.counter;
        t.counter = n + 1;
        if (n > PHASE2_HOLD) {
          ActorSetMotionBlended(obj, Class22Clip.Attack, 0, 3);
          if (obj.flags & Class22Flag.Flinched) {
            obj.flags &= ~Class22Flag.Flinched;
          }
          t.counter = 0;
          obj.sub = 3;
          Class22PlaySound(f, SND_FLAP);
        }
      }
      break;
    case 8:
      ActorSetMotionBlended(obj, Class22Clip.Hover, 0, 3);
      obj.flags &= ~(Class22Flag.Reacting | Class22Flag.Flinched);
      t.counter = 0;
      Cam(obj, f, PHASE2_HOVER_PATH, 0);
      obj.sub = 10;
      break;
    case 9: {
      Phase2Lerp(obj, GLIDE_FRAMES - t.counter);
      const n = t.counter;
      t.counter = n + 1;
      if (n > GLIDE_FRAMES) {
        Snap(obj);
        ActorSetMotionBlended(obj, Class22Clip.Hover, 0, 3);
        obj.sub += 1;
        obj.flags &= ~(Class22Flag.Reacting | Class22Flag.Flinched);
        t.counter = 0;
      }
      break;
    }
    case 10: {
      Cam(obj, f, PHASE2_HOVER_PATH, t.counter);
      Snap(obj);
      const n = t.counter;
      t.counter = n + 1;
      if (n < GLIDE_FRAMES + 1) break;
      ActorSetMotionBlended(obj, Class22Clip.Attack, 0, 3);
      obj.flags |= Class22Flag.Reacting | Class22Flag.Flinched;
      Phase2NextPass(obj, f);
      break;
    }
    case 11:
      ActorSetMotionBlended(obj, Class22Clip.Attack, 0, 3);
      Phase2NextPass(obj, f);
      break;
    case 12: {
      Phase2Lerp(obj, GLIDE_SHORT - t.counter);
      const n = t.counter;
      t.counter = n + 1;
      if (n > GLIDE_SHORT) {
        Snap(obj);
        t.counter = 0;
        obj.flags &= ~(Class22Flag.Reacting | Class22Flag.Flinched);
        obj.sub = 3;
      }
      break;
    }
    default:
      break;
  }

  // The tail, `0x0049C869`.
  obj.yaw = Class22FaceCamera(obj.pos.x, obj.pos.z, f.eye.x, f.eye.z);
  // `FSTP [0x009C8E10]` at `0x0049C8A6`.
  G.g_boss_hp_fraction = BossHpFractionOf(obj.hp, obj.maxHp);
  Class22DrawAndPoseSubActor(obj, f);
  ActorAdvanceMotion(obj, f.dt);
  const was = obj.flags;
  obj.flags = was & ~0xe;
  // `if (!(obj+0x34 & 0x100)) ActorRegisterCameraPoint(2.0)` at `0x0049C8CE`
  // -- the shot list **and** the camera candidacy, on the flags as they were
  // before the clear.
  if ((was & Class22Flag.Flinched) === 0) {
    Class22ActorRegisterCameraPoint(obj, f, t);
  }
}

/** `LAB_0049C756` — `n = 0; pick; cam(P, 0); sub = 12`, from subs 10 and 11. */
function Phase2NextPass(obj: JudgmentActor, f: ClassFrame): void {
  const t = obj.judgment;
  t.counter = 0;
  Phase2Pick(t, f);
  Cam(obj, f, t.path + PHASE2_PATH_BASE, t.counter);
  obj.sub = 12;
}

/**
 * The call `ActorRegisterCameraPoint(2.0)` (`FUN_00409B70`) at `0x0049C8CE`.
 * The routine transforms `obj+0x100` for the shot test, runs
 * `RegisterForShotTest`, registers the camera candidate and lifts
 * `obj+0x104` by its argument. `[port-only]` as a function: the director's
 * `ActorRegisterCameraPoint` computes the lifted point for every actor from
 * `cameraRise`, and the candidacy is `tracksCamera`, which reads the latch
 * this raises.
 */
export function Class22ActorRegisterCameraPoint(obj: JudgmentActor,
                                                f: ClassFrame,
                                                t: JudgmentTail): void {
  Class22RegisterForShotTest(obj, f.host, t);
  t.cameraListed = true;
}
