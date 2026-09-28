/**
 * `EnemyZombieUpdate` — `FUN_004533F0`. Class 0x30's per-frame dispatch.
 *
 * The engine's own order, which matters: the state runs, *then* the position
 * integrates, then the motion advances. Anything not ported goes through
 * `ActorAbortAttackAndLeave` rather than a fallthrough, so no unmodelled state
 * can sit on a permit.
 */
import { ZombieStateCarryProp } from "./carry_prop";
import type { Events } from "../../core/events";
import type { Rng } from "../../core/rng";
import type { ZombieActor } from "../actor";
import {
  DeadSweep, registerClass, type ActorDebug, type ClassFrame,
  type ClassHandler,
} from "../registry";
import { SpawnClass } from "../spawn_class";
import { ReleaseAttackSlot } from "../combat/permits";
import {
  ReleaseEnemyAliveCount, ReleaseEnemyPresentCount,
} from "../combat/counts";
import type { GameHost } from "../host";
import type { Vec3 } from "../vec";
import { ZombieStateApproach } from "./approach";
import { ZombieStateAttackRun } from "./attack_run";
import { ZombieStateBackOff } from "./backoff";
import { ZombieAttackRefusal, ZombieStateHoldAtRange } from "./hold";
import { ZombieGiveUpAttack } from "./leave";
import { ZombieStateStrike } from "./strike";
import { ZombieStateWaitTurn } from "./wait_turn";
import { ZombieReleaseAndDespawn, ZombieStateWalkDistance }
  from "./walk_distance";
import { ZombieStateStandAndThrow } from "./stand_throw";
import { EnemyZombieInitByCharType } from "./init_char";
import {
  ZombieStateArcScriptedEntrance, ZombieStateHoldClipThenBranch,
  ZombieStateRideCarrier, ZombieStateRunInPlaceTimed,
  ZombieStateSurfaceOnCameraCue, ZombieStateWaitCameraFrameThenBranch,
  ZombieStateWaitScriptFlagThenBranch, ZombieStateWaitScriptFlagThenEnter,
} from "./entrance";
import {
  ZombieStateDelayedStrikeInPlace, ZombieStateLeapToPoint,
  ZombieStateScriptedGrabAndDespawn, ZombieStateWaitForCameraFrame,
} from "./scripted";
import { ZombieStateReleaseBodyCreature } from "./release_creature";
import { ZombieState } from "./states";
import { ZombieOnShot } from "./on_shot";
import {
  ZombieStateCorpseBlink, ZombieStateCorpseSink, ZombieStateDeath6,
  ZombieStateDeathFallAndBounce,
} from "./death";
import { ZombieStateDeathKnockbackArc } from "./knockback";
import { CountEnemyZombieIn } from "../combat/counts";
import { MotionFlag, ZombieFlag2 } from "../actor";
import { ZombiePushOutOfWorldAndActors } from "./ground";
import { ActorRunNodeDrawHooks } from "../model_draw";
import { ZombieDrawBonePart } from "./draw";
import {
  ZOMBIE_TWIN_CHAR_TYPE, ZombieTwinFollowHost,
} from "./twin";
import { HeadAimBeginDraw, HeadAimEndDraw, HeadAimSeed } from "./head_aim";
import { ZombieAttachToCarrier } from "./carrier";
import { ActorRegisterCameraPoint } from "../camera/track";
import { ZombieStateDelayedLeap, ZombieStateEmerge } from "./emerge";
import { ZombieStateFallToGround } from "./fall";
import { ZombieStateMotionCue21 } from "./play_cue";
import {
  ZombieStateHoldOnCarrier, ZombieStateLeapOffCarrierForward,
  ZombieStateLeapOffCarrierAtMark,
} from "./carrier_rider";
import { CharacterTypeOf, MotionPlayFrame, MotionPlayLength, MotionRowOf }
  from "../tables";
import {
  TARGET_STATES,
  ZombieStateAwaitCivilianOrder, ZombieStateDragTarget,
  ZombieStatePounceOnTarget, ZombieStateRetireOffScreen,
  ZombieStateHoldForCameraCue,
  ZombieStateTargetLostPause, ZombieStateTargetMotionScript,
  ZombieStateTargetScriptWithFlag, ZombieStateWalkPastPoint,
  ZombieStateWalkToPoint, ZombieStateWalkToTarget,
} from "./target";

/** `EnemyZombieInit`'s literal for `obj+0x128` — `0x40600000`. */
const ZOMBIE_BODY_RADIUS = 3.5;

export function EnemyZombieUpdate(obj: ZombieActor, f: ClassFrame): void {
  const { eye, dt, rng, host, events } = f;
  // `EnemyZombieUpdate` (`FUN_004533F0`) runs the shot response **before** the
  // state, at 0x0045340E: the shot that killed this actor puts it in a death
  // state on the same frame that state first runs. Without this call class
  // 0x30 had no edge into `ZombieState.Death` at all.
  ZombieOnShot(obj);
  // `0045341C  TEST EAX, 0x10000000` / `00453424  CALL ZombieAttachToCarrier`,
  // and it is **before** the state dispatch at `0x00453434`. A passenger's
  // position and yaw are recomputed from `g_carrier_object` every frame, so
  // the state below never has to move it — and the three states that carry
  // these four spawns never do. That is the whole of why stage 5 block 2's
  // `znnick` ride the car while sitting in `DelayedStrikeInPlace`.
  if (obj.flags2 & ZombieFlag2.AttachedToCarrier) ZombieAttachToCarrier(obj);
  ZombieRunState(obj, eye, dt, rng, host, events);
  // The engine's own order, and the two halves the port did not have.
  // `EnemyZombieUpdate` integrates the velocity straight after the state —
  // which is what carries a leap through its arc — and then draws, and the
  // draw runs the hook at `obj+0x12F0` (`SkeletonApplyRootMotion`'s
  // `CALL [model+0x115C]` at `0x00410E93`), which is what puts the actor on
  // the floor and out of the crowd. Once per update: the hook counts its
  // shove timer in calls, not in time.
  obj.pos.x += obj.vel.x;
  obj.pos.y += obj.vel.y;
  obj.pos.z += obj.vel.z;
  ZombiePushOutOfWorldAndActors(obj);
  // `ZombieAdvanceMotion` (`FUN_00454860`) at `0x0045343F`: the draw, and
  // with it the node hook -- which is where the head is aimed. The push above
  // is the pose hook at `obj+0x12F0`, which `SkeletonApplyRootMotion` runs
  // inside the same draw before any node is emitted. The clock half of the
  // routine is the director's `ActorAdvanceMotion`.
  //
  // [diverges] The hook is always `ZombieDrawBonePart`. In Training
  // `EnemyZombieInit` installs `ZombieDrawBoneSlotOnly` (`FUN_00453B30`),
  // which aims nothing, and `ZombieAdvanceMotion` swaps between the two for
  // the next frame on `obj+0x34` bit `0x4000` and bytes `0x009C72F1`/
  // `0x009C72F3`; no stage bundle is exported in Training, and the port keeps
  // no hook pointer. Original Mode's big-head hook, `ZombieDrawWithEnlargedHead`
  // (`FUN_00453B50`), calls this one inside a scale, so it aims the same; the
  // same arm of `EnemyZombieInit` doubles bone 2's hit radius (`obj+0x3A4`,
  // `FADD ST0,ST0` -- `FMUL [0x0055DD48]` for type 0xE -- at `0x00452F71`),
  // which goes with the item.
  HeadAimBeginDraw(obj, obj.zom, host);
  ActorRunNodeDrawHooks(obj, ZombieDrawBonePart, f);
  HeadAimEndDraw(obj, obj.zom, host);
  // `PUSH 0x40800000; CALL 0x00409b70` at `0x00453475`, on every path through
  // the routine and after the draw (`ZombieAdvanceMotion`, `0x00453457`): the
  // camera point lifted by 4 and the actor filed as a candidate. A death
  // chain's `0x10000` is what keeps a corpse off the list, not a test here.
  ActorRegisterCameraPoint(obj, host, ZOMBIE_CAMERA_RISE);
}

/** `PUSH 0x40800000` at `0x00453475`: `ActorRegisterCameraPoint`'s 4.0. */
export const ZOMBIE_CAMERA_RISE = 4.0;

function ZombieRunState(obj: ZombieActor, eye: Vec3, dt: number, rng: Rng,
                        host: GameHost, events?: Events): void {
  switch (obj.state) {
    case ZombieState.Approach:    return ZombieStateApproach(obj, eye, rng, host);
    case ZombieState.AttackRun:   return ZombieStateAttackRun(obj, eye, dt, rng);
    case ZombieState.MotionCue:   return ZombieStateMotionCue21(obj, eye, dt);
    case ZombieState.HoldAtRange:
      return ZombieStateHoldAtRange(obj, eye, rng, host, events);
    case ZombieState.Strike:
      return ZombieStateStrike(obj, eye, rng, events, host);
    case ZombieState.BackOff:     return ZombieStateBackOff(obj, eye, dt, rng);
    case ZombieState.WaitTurn:    return ZombieStateWaitTurn(obj, eye, rng);
    // **State 10 is terminal, and the table says so.** `g_class30_states`
    // (`0x00592AE8`) holds `0x00455490` at index 10 -- the dwords at
    // `+0x28` are `90 54 45 00` -- and that is `ZombieReleaseAndDespawn`
    // (`FUN_00455490`), which is `ReleaseEnemyAliveCount`,
    // `ReleaseEnemyPresentCount`, `ReleaseAttackSlot`, the permit-array clear
    // and `ActorDespawn`. `[proved]` by reading the table, which is the only
    // thing that can settle it.
    //
    // It used to fall through to the `default` arm and `ZombieGiveUpAttack`,
    // on a citation of `ActorAbortAttackAndLeave` (`FUN_0045D9F0`) that is
    // not this address at all -- see `class30/leave.ts` and
    // `ZombieState.Leave`. Everything the port sends to state 10 therefore
    // went to `WaitTurn` and stayed alive: stage 5 block 2's four `znnick`,
    // whose `ZombieStateDelayedStrikeInPlace` exit is `obj+0x1310 = 10`
    // (`0x0045EB20`), and the one spawn per bundle whose descriptor names 10
    // as its attack state (stage 5's `0x1DD4`, through state 18).
    case ZombieState.Leave:       return ZombieReleaseAndDespawn(obj);

    // The death chain. `updatesWhenDead` on the handler below is what lets
    // these run at all -- see `class30/death.ts` for the whole graph.
    case ZombieState.Death:
      return ZombieStateDeath6(obj, rng, host, events);
    // The other death, and the reason `ZombieRunState` is handed the host at
    // all on a dead actor: state 9's landing point is a point in the camera's
    // own space. See `class30/knockback.ts`.
    case ZombieState.DeathKnockbackArc:
      return ZombieStateDeathKnockbackArc(obj, dt, rng, host, events);
    case ZombieState.DeathFallAndBounce:
      return ZombieStateDeathFallAndBounce(obj, dt, rng, host, events);
    case ZombieState.CorpseSink:  return ZombieStateCorpseSink(obj, dt);
    case ZombieState.CorpseBlink: return ZombieStateCorpseBlink(obj, dt);

    // The stationary thrower. It is the only class-0x30 state that never
    // moves the actor at all, which is exactly why folding it into
    // `AttackRun` was so visible: the tutorial's axe man charged the camera.
    case ZombieState.StandAndThrow:
      return ZombieStateStandAndThrow(obj, eye, rng, host, events);

    // The scripted walk-in. Fifty spawns across the game start here, and
    // folding it into `AttackRun` is what had them turn to the camera on
    // frame one and cross geometry the level never meant them to.
    case ZombieState.WalkDistance:
      return ZombieStateWalkDistance(obj, rng);

    // The twelve entrances this port adds — 133 spawns between them. Seven
    // wait and hand over (`entrance.ts`), four attack outright
    // (`scripted.ts`), and `ZombieStateRideCarrier` does neither.
    case ZombieState.SurfaceOnCameraCue:
      return ZombieStateSurfaceOnCameraCue(obj, rng, host, events);
    case ZombieState.RunInPlaceTimed:
      return ZombieStateRunInPlaceTimed(obj, dt, rng);
    case ZombieState.HoldClipThenBranch:
      return ZombieStateHoldClipThenBranch(obj, dt);
    case ZombieState.WaitCameraFrameThenBranch:
      return ZombieStateWaitCameraFrameThenBranch(obj);
    case ZombieState.WaitForCameraFrame:
      return ZombieStateWaitForCameraFrame(obj, dt, rng);
    case ZombieState.WaitScriptFlagThenBranch:
      return ZombieStateWaitScriptFlagThenBranch(obj);
    case ZombieState.ScriptedGrabAndDespawn:
      return ZombieStateScriptedGrabAndDespawn(obj, eye, rng, host, events);
    case ZombieState.ReleaseBodyCreature:
      return ZombieStateReleaseBodyCreature(obj, eye, rng, host);
    case ZombieState.LeapToPoint:
      return ZombieStateLeapToPoint(obj, eye, dt, rng, events);
    case ZombieState.RideCarrier:
      return ZombieStateRideCarrier(obj, eye, rng, dt);
    case ZombieState.ArcScriptedEntrance:
      return ZombieStateArcScriptedEntrance(obj, dt, rng, host, events);
    case ZombieState.WaitScriptFlagThenEnter:
      return ZombieStateWaitScriptFlagThenEnter(obj, dt, rng);
    case ZombieState.DelayedStrikeInPlace:
      return ZombieStateDelayedStrikeInPlace(obj, eye, dt, rng, events);

    // The two entrances that place the actor. Without them a spawn stands at
    // the y its record names — under the water at stage 2 block 16, and in
    // the ground where the floor drops away.
    case ZombieState.Emerge:
      return ZombieStateEmerge(obj, dt, events);
    case ZombieState.DelayedLeap:
      return ZombieStateDelayedLeap(obj, dt, rng, host, events);
    case ZombieState.FallToGround:
      return ZombieStateFallToGround(obj, dt, rng);

    // The captor family. None of these looks at the camera: they work on the
    // object at `obj+0x1394`, which for 47 of the 59 spawns that reach one is
    // the class-0x10 civilian that built them. See `class30/target.ts`.
    case ZombieState.WalkToTarget:
      return ZombieStateWalkToTarget(obj);
    case ZombieState.TargetMotionScript:
      return ZombieStateTargetMotionScript(obj, rng, events, host);
    case ZombieState.TargetScriptWithFlag:
      return ZombieStateTargetScriptWithFlag(obj);
    case ZombieState.RetireOffScreen:
      return ZombieStateRetireOffScreen(obj, host, rng);
    // The order arm tail-calls the state it hands over to, so this one takes
    // the dispatcher for the same reason state 42 does.
    case ZombieState.AwaitCivilianOrder:
      return ZombieStateAwaitCivilianOrder(obj, rng, (o, st) => {
        o.state = st;
        ZombieRunState(o, eye, dt, rng, host, events);
      });
    case ZombieState.WalkPastPoint:
      return ZombieStateWalkPastPoint(obj);
    case ZombieState.WalkToPoint:
      return ZombieStateWalkToPoint(obj);
    case ZombieState.DragTarget:
      return ZombieStateDragTarget(obj, dt);
    case ZombieState.PounceOnTarget:
      return ZombieStatePounceOnTarget(obj, dt);
    case ZombieState.TargetLostPause:
      return ZombieStateTargetLostPause(obj, rng, MotionRowOf(obj)[0] ?? 0);
    // The camera-cue hold runs the state it is holding, so it is handed the
    // dispatcher rather than importing it back.
    case ZombieState.HoldForCameraCue:
      return ZombieStateHoldForCameraCue(obj, (o, st) => {
        const was = o.state;
        o.state = st;
        ZombieRunState(o, eye, dt, rng, host, events);
        // The delegate may have changed the state; state 42 reads that back.
        if (o.state === st) o.state = was;
      });
    // The barrel-carrier: it allocates the prop it holds (`game/carried_prop.ts`)
    // and throws it on its script's cue. See `class30/carry_prop.ts`.
    case ZombieState.CarryProp:
      return ZombieStateCarryProp(obj, eye, host);
    // A class-0x18 rider's three ways off its script. See
    // `class30/carrier_rider.ts`.
    case ZombieState.HoldOnCarrier:
      return ZombieStateHoldOnCarrier(obj, eye, dt);
    case ZombieState.LeapOffCarrierForward:
      return ZombieStateLeapOffCarrierForward(obj, eye, dt, host, events);
    case ZombieState.LeapOffCarrierAtMark:
      return ZombieStateLeapOffCarrierAtMark(obj, eye, dt, host, events);

    default:                      return ZombieGiveUpAttack(obj);
  }
}

/**
 * `EnemyZombieInit` — `FUN_00452DA0`.
 *
 * The start state is the descriptor's own byte +2, not a constant: in stage 2
 * the commonest is 1 (`AttackRun`), then 15 (`WalkDistance`), 27, 18 — and
 * **none** of the 90 class-0x30 spawns starts in `Approach`. The old port
 * started everything there, which is why nothing ever reached the hub.
 */
export function EnemyZombieInit(obj: ZombieActor, _rng?: Rng,
                                events?: Events): void {
  obj.attackPermit = -1;
  // `OR EDX, 0x4` into `obj+0x1F8` at `0x00452E21`, straight after
  // `ActorBuildSkinnedModel`: this class's corpse ring and shadow sit on the
  // traced floor, not at the body's own y.
  obj.motionFlags |= MotionFlag.TraceGround;
  // `EnemyZombieInit`: `obj+0x124 = g_actor_radius_by_char[type]`, the shot
  // sphere, and `obj+0x128 = 3.5`, the body one. The port had neither, so
  // every zombie collided as a point and walked through walls.
  obj.radius = CharacterTypeOf(obj)?.actor_radius ?? 0;
  // The same word as the shot test reads it: `ShotTestSphere`'s broad phase,
  // now that the class is picked through the list.
  obj.hitRadius = obj.radius;
  obj.bodyRadius = ZOMBIE_BODY_RADIUS;
  // `obj+0x131D = 0xFF`, and every test reads it as `(s8)` -- so this is -1,
  // and an actor that has not been ranked yet passes rather than failing. As
  // 255 it failed every one, and the zombie dropped out of the attack run on
  // its first frame before `RankEnemiesByDistance` had ever seen it.
  obj.rank = -1;
  obj.sub = 0;
  obj.zom.backoffFrames = 0;
  obj.cooldown = 0;
  // `EnemyZombieInit` *assigns* `obj+0x136C` (`00452e78`, then
  // `00452eaf` with `(s16)obj+0x1316 | 0x60000000`), so a pooled actor
  // starts a life with no strike anchor however its last one ended.
  obj.flags2 &= ~ZombieFlag2.StrikeAnchor;
  // ...and its **low half is the descriptor's `+0x20` word**, which is where
  // `ZombieFlag2.DrawVariantSource` comes from. The shipped class-0x30 spawns
  // carry 0x1, 0x2, 0x4, 0x20 and 0x40 there and nothing with bit 15, so the
  // s16 sign extension never reaches the high half; of those bits the port
  // reads only 0x20, and that one is what puts 55 zombies under the gun
  // lights. [diverges] The high half is still or-ed rather than assigned,
  // as it was: the carrier classes raise bits there before this runs.
  obj.flags2 = (obj.flags2 & ~0xffff) | (obj.descFlags & 0xffff);
  obj.struck = false;
  // `EnemyZombieInit`: `obj+0x136C |= 0x60000000` — take part in both pushes.
  obj.flags2 |= ZombieFlag2.CollideWorld | ZombieFlag2.CollideActors;
  obj.zom.shoveTimer = 0;
  // `00452EAB  TEST EAX, 0x40000` and the `VecToAngles` after it: the head
  // aim's seed, toward the camera eye raised 15 -- see `HeadAimSeed`.
  HeadAimSeed(obj, obj.zom);
  // `00452F0F  CALL EnemyZombieInitByCharType` — the engine's own position for
  // it, after the hit points and the aim angles and before `obj+0x121 = 0xFF`.
  // Three of the spawn record's flag bits move into `obj+0x38` in there, and
  // one of them is the whole of what makes stage 3's two axe men stand still
  // instead of walking away.
  EnemyZombieInitByCharType(obj, events);
  obj.state = ZombieEntryState(obj.initialState);
  // ...and the actor counts itself in, which is the engine's own last act
  // here. The two exclusions are the interesting part -- see `CountEnemyZombieIn`.
  CountEnemyZombieIn(obj);
}

/**
 * Which state to actually start in.
 *
 * **Every entrance state the game ships is now ported**, so this passes the
 * descriptor's own byte straight through and the fallback below is reached
 * only by a state no spawn record names.
 *
 * It used to be a list of exceptions, and the list was the bug. Seventeen of
 * the 54 states were read; the other 37 fell through to `AttackRun`, on the
 * reasoning that every entrance ends by setting state 1 anyway. That is true
 * of *some* of them and it is not the point — the entrance is what puts the
 * actor where the level wants it before the attack run starts. Sending state
 * 15 to `AttackRun` skipped a scripted walk-in and sent zombies through a
 * wall; sending state 27 there left them standing under water; sending state
 * 23 there turned a set-piece drowning into a jog across the room. The twelve
 * added here are 133 spawns, and states 17 and 18 alone are 75 of them.
 *
 * The check is kept, rather than deleted, because it is the thing that says
 * what happens to a state that is genuinely unmodelled: `ZombieGiveUpAttack`
 * through the dispatch's default, which releases the permit rather than
 * silently holding one.
 */
export function ZombieEntryState(initial: number): ZombieState {
  return ZOMBIE_ENTRY_STATES.has(initial) ? initial : ZombieState.AttackRun;
}

/**
 * The states an actor may legitimately *start* in — every state the dispatch
 * above handles, minus the ones only another state can route to.
 *
 * A spawn record naming anything else is a record the port has not read, and
 * `AttackRun` is the honest fallback: it is what an entrance hands over to.
 */
const ZOMBIE_ENTRY_STATES: ReadonlySet<number> = new Set<number>([
  ZombieState.AttackRun, ZombieState.HoldAtRange, ZombieState.Approach,
  // The twelve added here.
  ZombieState.SurfaceOnCameraCue, ZombieState.RunInPlaceTimed,
  ZombieState.HoldClipThenBranch, ZombieState.WaitCameraFrameThenBranch,
  ZombieState.WaitForCameraFrame, ZombieState.WaitScriptFlagThenBranch,
  ZombieState.ScriptedGrabAndDespawn, ZombieState.LeapToPoint,
  ZombieState.RideCarrier, ZombieState.ArcScriptedEntrance,
  ZombieState.WaitScriptFlagThenEnter, ZombieState.DelayedStrikeInPlace,
  // ...and the ones that were already read.
  ZombieState.WalkDistance, ZombieState.MotionCue, ZombieState.DelayedLeap,
  ZombieState.Emerge, ZombieState.StandAndThrow, ZombieState.FallToGround,
  ...TARGET_STATES,
]);

/**
 * The zombie, for the debug sidebar.
 *
 * Everything a zombie's next decision turns on: the state, the two ranks and
 * the allowance the approach gate compares them against, and whether it holds
 * an attack permit or is queued for one. A crowd parked in `HoldAtRange` is
 * either out of rank or waiting on the single permit, and those two look
 * identical on screen.
 */
export function EnemyZombieDebug(obj: ZombieActor): ActorDebug {
  const wants = obj.state === ZombieState.HoldAtRange
             || obj.state === ZombieState.AttackRun;
  const permit = obj.attackPermit >= 0;
  // **Why it is not swinging**, which is the question every crowd parked at
  // the ring asks and the one the row could not answer. Only in the hub: the
  // attack run has not asked for a permit yet, it is still closing.
  const refusal = obj.state === ZombieState.HoldAtRange && !permit
    ? ZombieAttackRefusal(obj) : null;
  const detail = [
    `rank ${obj.rank}/${obj.allowance} · queue ${obj.queueRank}`
      + ` · cooldown ${obj.cooldown}`,
    `hp ${obj.hp}/${obj.maxHp} · motion ${obj.motion}`
      + ` · flags 0x${(obj.flags >>> 0).toString(16)}`,
  ];
  if (obj.targetAt >= 0) {
    detail.push(`target 0x${obj.targetAt.toString(16).toUpperCase()}`
      + ` · initial ${ZombieState[obj.initialState] ?? obj.initialState}`
      + ` · attack ${ZombieState[obj.attackState] ?? obj.attackState}`);
    // The captor family's own cursor. A zombie parked on a civilian looks the
    // same whether its entry list has run out, its loop counter is stuck or
    // the play cursor never reaches the frame the loop is counted on — and
    // that last one is invisible without the numbers side by side. Which blob
    // it is walking matters most: the walk leaves the cursor in the attack
    // script and hands over to a state that is not the attack state.
    if (TARGET_STATES.has(obj.state)) {
      detail.push(`${obj.zom.scriptBlob ? "attack" : "target"} script`
        + ` · entry ${obj.zom.scriptPc} · loops ${obj.zom.targetLoops}`
        + ` · cue ${obj.zom.targetCue} · wants ${obj.zom.scriptMotion}`
        + ` · frame ${MotionPlayFrame(obj)}/${MotionPlayLength(obj)}`);
    }
  }
  return {
    summary: `${ZombieState[obj.state] ?? obj.state}/${obj.sub}`
      + (obj.dead ? " · dead" : permit ? " · permit"
         : wants ? " · wants a permit" : ""),
    detail: refusal ? [`blocked: ${refusal}`, ...detail] : detail,
    hot: permit,
  };
}

/**
 * What a class-0x30 zombie gives back when `GameUpdate`'s sweep reaches it.
 *
 * The permit first, on every reason: `ReleaseAttackSlot` (`FUN_00456520`) is
 * also the only thing that lifts `g_attack_committed`, so an actor that leaves
 * holding an off-screen permit refuses **every** later claim in the scene.
 * `ZombieFlag2.OffScreenPermit` is `obj+0x136C` bit 0x20000000 — class 0x31
 * latches the same fact in a different word, which is the whole reason this is
 * the class's answer and not the sweep's.
 *
 * **The counts, only when it is dead or gone.** Not on `!visible`: the engine
 * never ties either count to whether the actor is drawn, and because the
 * releases are latched, doing so is permanent — an actor invisible for one
 * frame before the renderer turns it on would leave both counts and never
 * return, which cost two civilian rescues in `tools/civilians.mjs` before the
 * old sweep's test said `dead`.
 *
 * The counts **only on a despawn**, which is the same shape
 * `EnemyThrowerDeadSweep` has and for the same reason. Class 0x30 now runs its
 * own death states and calls the two retires where the exe does —
 * `ZombieReleasePermitAndUntrack` (`FUN_004565A0`) drops the alive count as
 * state 6 opens, `ZombieEnterCorpseState` (`FUN_00456740`) the present count
 * when the death clip ends — so a zombie that has merely died is *present but
 * not alive*, exactly as the engine leaves it. This used to retire both here
 * on `DeadSweep.Dead`, which collapsed that window on the frame of the kill
 * and is the whole reason the script has both `wait_enemies_present` and
 * `wait_enemies_alive`.
 */
function EnemyZombieDeadSweep(obj: ZombieActor, why: DeadSweep): void {
  ReleaseAttackSlot(obj, ZombieFlag2.OffScreenPermit);
  if (why !== DeadSweep.Despawned) return;
  ReleaseEnemyAliveCount(obj);
  ReleaseEnemyPresentCount(obj);
}

/**
 * The task `EnemyZombieInit` (`FUN_00452DA0`) leaves at `obj+0`, run: its last
 * lines are `if (type != 9) { ...; *obj = EnemyZombieUpdate; return; }` and
 * `*obj = ZombieTwinFollowHost`, so a class-0x30 actor of character type 9 --
 * the twin, which only `znele` makes -- never runs the state machine at all.
 * `[proved]`. [port-only] as a function: the engine keeps the pointer, and the
 * port's handler row has one `update`, so the choice is made here on the same
 * test.
 */
export function ZombieTaskUpdate(obj: ZombieActor, f: ClassFrame): void {
  if (obj.charType === ZOMBIE_TWIN_CHAR_TYPE) ZombieTwinFollowHost(obj, f);
  else EnemyZombieUpdate(obj, f);
}

/** Class 0x30's row of `g_class_handlers`, filled by the class itself. */
export const EnemyZombieHandler: ClassHandler = {
  init: EnemyZombieInit,
  update: ZombieTaskUpdate,
  leave: ZombieReleaseAndDespawn,
  onDeadSweep: EnemyZombieDeadSweep,
  // **Class 0x30's death is four states**, the same as class 0x31's, and the
  // director stops updating a dead actor without this. It also takes the
  // shared directional death clip away from the class in `ResolveHit` and
  // `ActorKillAll`, which is right: `ChooseDeathMotion` (`FUN_004560B0`) is
  // the engine's own picker and `ZombieStateDeath6` calls it.
  updatesWhenDead: true,
  // **Picked the engine's way.** Class 0x30 registers every frame --
  // `ActorRegisterCameraPoint(obj, 4.0)` at `0x0045347A` on every path
  // through `ZombieAdvanceMotion`, and the twin's `RegisterForShotTest` at
  // `0x004533CB` -- so the shot is `ShotTestSphere`'s broad phase at
  // `obj+0x124` round the tracked point, then `ShotTestBoneTree` over the
  // bones, sphere or mesh by the record. The mesh arm is why it moved across:
  // `EnemyZombieInitByCharType`'s weapon hands are collision meshes, and only
  // the tree walk tests one. Class 0x18 spreads this row, and its update is
  // `EnemyZombieUpdate` too.
  registersForShotTest: true,
  debug: EnemyZombieDebug,
};

registerClass(SpawnClass.Zombie, EnemyZombieHandler);
