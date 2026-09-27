/**
 * Class 0x23 — **JUDGMENT's walker**, the companion class 0x22 spawns from
 * the nested descriptor at its own `tail+0x10`.
 *
 * Three subtypes: 0 beside stage 1's flier, 1 beside stage 5's, 2 alone in
 * Training (`trnevtbl.bin` block 9). The first two are the half of the boss
 * the player cannot kill: it has 90 hit points that never move, strikes the
 * player with its axe, and hands every hit it takes to the flier (see
 * `fight.ts`). It counts itself into both enemy counters on spawn -- which is
 * what holds stage 1 block 14's `wait_enemies_alive 0` before the flier
 * joins -- leaves the alive count as it starts to fall and the present count
 * when it lands.
 *
 * `obj+0x1310` is absolute here, into one of three four-entry tables that
 * differ only in their entrance (`g_class23_states_subtype0` `0x00597268`,
 * `_subtype1` `0x00597278`, `_training` `0x00597288`).
 */
import type { Rng } from "../../core/rng";
import type { Events } from "../../core/events";
import type { Actor, JudgmentCompanionActor } from "../actor";
import { G } from "../globals";
import {
  registerClass, type ActorDebug, type ClassFrame, type ClassHandler,
} from "../registry";
import { SpawnClass } from "../spawn_class";
import { Class22DropUnlistedShot, JudgmentRegisterEnemySlot }
  from "../class22/shot";
import {
  CLASS23_CAMERA_RISE, Class23Collapse, Class23FightBesideCompanion,
  Class23LieUntilCameraCue,
} from "./fight";
import { Class23Subtype0Entrance, Class23Subtype1Entrance } from "./entrance";
import { CLASS23_CHAR_TYPE, CLASS23_FIRST_CLIP } from "./records";
import { Class23State, Class23Subtype } from "./state";

/** `g_actor_radius_by_char[0x44]` — `0x004C4E38`, `0000f841`, 31.0. */
const CLASS23_RADIUS = 31.0;
/** `model+0x64 |= 4`. `[open]` meaning; kept on the word. */
const MOTION_FLAG_4 = 4;
/** The ring's life, `CMP EAX, 0x50`, and its turn, `ADD EDX, 8`. */
const RING_FRAMES = 0x50;
const RING_TURN = 8;
/** `PUSH 0x147` -- `op_st1`'s last path, the ring's spread and fade. */
const RING_CURVE = 0x147;

/**
 * `Class23Init` — `FUN_0048FD90`.
 *
 * ```
 * obj+0x1310 = obj+0x1312 = 0; obj+0x3C = -1; obj+0x120 = 0xFF
 * obj+0x130C = (s8)tail[1]; char type 0x44; clip 0x38D; ActorBuildSkinnedModel
 * model+0x68 = 1; model+0x64 |= 4; obj+0x124 = radius[0x44]
 * obj+0x32C = 0 (node 2's slot); obj+0x3A4 = 0 (node 2's extent)
 * g_enemies_present++; g_enemies_alive++
 * obj+0x121 = 0xFF; obj+0x131D = 0xFF; RegisterEnemySlot(obj); obj+0x1320 = 0
 * install and run the subtype's update
 * ```
 *
 * Node 2's slot 0 is `AssetDrawSlot(0)`, which draws nothing
 * (`if (param_1 == 0) return` at `0x00418560`): the walker has no node-2
 * model, and `game/parts.ts` vetoes a bone whose slot is 0. As for class
 * 0x22, the subtype's first update is the director's, on the same frame.
 */
export function Class23Init(obj: Actor, rng?: Rng, events?: Events): void {
  void rng; void events;
  if (obj.cls !== SpawnClass.JudgmentCompanion) return;
  const t = obj.companion;
  const d = obj.class23;
  obj.state = 0;
  obj.sub = 0;
  t.subtype = d ? (d.subtype << 24) >> 24 : 0;
  obj.charType = CLASS23_CHAR_TYPE;
  obj.motion = CLASS23_FIRST_CLIP;
  obj.playTicks = 0;
  obj.fadeFrom = null;
  obj.fade = 0;
  obj.fadeLen = 0;
  obj.rootFrame = -1;
  obj.motionFlags |= MOTION_FLAG_4;
  obj.hitRadius = CLASS23_RADIUS;
  obj.radius = CLASS23_RADIUS;
  obj.boneSlot["2"] = 0;
  G.g_enemies_present += 1;                            // 0x0048FE16
  G.g_enemies_alive += 1;                              // 0x0048FE1D
  obj.attackPermit = -1;
  obj.rank = -1;
  JudgmentRegisterEnemySlot(t);
  t.hpStage = 0;
}

/**
 * `Class23UpdateSubtype0` / `1` / `2` — `CALL [obj+0x1310 * 4 + table]`.
 * `[port-only]` as one function over the three tables, with the frame's two
 * port-only openings (the shot list and the drawn alpha, as class 0x22's).
 */
export function Class23Update(obj: Actor, f: ClassFrame): void {
  if (obj.cls !== SpawnClass.JudgmentCompanion) return;
  const t = obj.companion;
  t.cameraListed = false;
  t.enemySlot = false;
  Class22DropUnlistedShot(obj, t);
  obj.alpha = 0;
  switch (obj.state) {
    case Class23State.Entrance:
      if (t.subtype === Class23Subtype.Stage1) Class23Subtype0Entrance(obj, f);
      else if (t.subtype === Class23Subtype.Stage5) {
        Class23Subtype1Entrance(obj, f);
      }
      break;
    case Class23State.Fight:
      if (t.subtype !== Class23Subtype.Training) {
        Class23FightBesideCompanion(obj, f);
      }
      break;
    case Class23State.Collapse:
      Class23Collapse(obj, f);
      break;
    case Class23State.Lie:
      Class23LieUntilCameraCue(obj, f);
      break;
    default:
      break;
  }
  // The ring task runs after its walker: `ActorAlloc` appended it.
  if (t.ring) Class23LandingRingUpdate(obj, f);
}

/**
 * `Class23LandingRingUpdate` — `FUN_00491700`.
 *
 * ```
 * push; MatrixTranslate(obj+0x40..0x48)
 * obj+0x68 += 8; MatrixRotateY(obj+0x68)
 * CamEvalPath7(0x147, (float)obj+0x1320, &e, &t, &r, &b)
 * MatrixScale(e.x, e.y, e.z); NoOpStub(max(e.x, e.y))
 * AssetDrawSlotWithAlpha(0x17C8, 1.0 - t.x); pop
 * if (++obj+0x1320 > 0x50) ActorKill()
 * ```
 *
 * The curve is read here, where the engine reads it, and what the draw was
 * handed is left on the record for the renderer: the frame it was drawn at
 * is the one before the increment. The kill comes after the draw, so the
 * last frame is drawn and the record goes on the next update.
 * `CamEvalPath7` reads the same slot table `CamEvalObjectPath6` does, and slot
 * `0x147` is `op_st1`'s -- the host's object path is that curve, channels
 * as floats.
 */
export function Class23LandingRingUpdate(obj: JudgmentCompanionActor,
                                         f: ClassFrame): void {
  const r = obj.companion.ring;
  if (!r) return;
  if (r.killed) { obj.companion.ring = null; return; }
  r.yaw = (r.yaw + RING_TURN) | 0;
  const e = f.host.objectPath?.(RING_CURVE, r.frame) ?? null;
  r.drawn = e !== null;
  if (e) {
    r.scale.x = Math.fround(e.x);
    r.scale.y = Math.fround(e.y);
    r.scale.z = Math.fround(e.z);
    r.fade = Math.fround(e.pitch ?? 0);
  }
  r.frame += 1;
  if (r.frame > RING_FRAMES) r.killed = true;
}

/** The sidebar's line. */
function Class23Debug(obj: Actor): ActorDebug {
  if (obj.cls !== SpawnClass.JudgmentCompanion) return { summary: "walker" };
  const t = obj.companion;
  return {
    summary: `judgment walker s${t.subtype} · ${Class23State[obj.state]
      ?? obj.state} sub ${obj.sub}`,
    detail: [
      `hp ${obj.hp}/${obj.maxHp}, stage ${t.hpStage}, strike ${t.strike}`,
      `flier ${t.companionAt}, clip ${obj.motion.toString(16)} cursor ${t.cursor}`,
    ],
  };
}

export const Class23Handler: ClassHandler = {
  init: Class23Init,
  update: Class23Update,
  advancesOwnMotion: true,
  // `Class23TakeShots` reads the part bytes itself and never charges its own
  // hit points outside Training.
  ownsShotResult: true,
  // `ActorRegisterCameraPoint(6.0)` in state 1's tail, and the one-frame
  // `RegisterEnemySlot` in the `Init`.
  tracksCamera: (obj) => obj.cls === SpawnClass.JudgmentCompanion
    && (obj.companion.cameraListed || obj.companion.enemySlot),
  cameraRise: () => CLASS23_CAMERA_RISE,
  debug: Class23Debug,
};

registerClass(SpawnClass.JudgmentCompanion, Class23Handler);
