/**
 * `EnemyZombieUpdate` — `FUN_004533F0`. Class 0x30's per-frame dispatch.
 *
 * The engine's own order, which matters: the state runs, *then* the position
 * integrates, then the motion advances. Anything not ported goes through
 * `ActorAbortAttackAndLeave` rather than a fallthrough, so no unmodelled state
 * can sit on a permit.
 */
import type { Events } from "../../core/events";
import type { Rng } from "../../core/rng";
import type { Actor } from "../actor";
import type { GameHost } from "../host";
import type { Vec3 } from "../vec";
import { ZombieStateApproach } from "./approach";
import { ZombieStateAttackRun } from "./attack_run";
import { ZombieStateBackOff } from "./backoff";
import { ZombieStateHoldAtRange } from "./hold";
import { ZombieGiveUpAttack } from "./leave";
import { ZombieStateStrike } from "./strike";
import { ZombieStateWaitTurn } from "./wait_turn";
import { ZombieStateWalkDistance } from "./walk_distance";
import { ZombieStateStandAndThrow } from "./stand_throw";
import { ZombieState } from "./states";
import { ZombieFlag2 } from "../actor";
import { ZombiePushOutOfWorldAndActors } from "./ground";
import { ZombieStateDelayedLeap, ZombieStateEmerge } from "./emerge";
import { ZombieStateFallToGround } from "./fall";
import { CharacterTypeOf, MotionRowOf } from "../tables";
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

export function EnemyZombieUpdate(obj: Actor, eye: Vec3, dt: number, rng: Rng,
                                  host: GameHost, events?: Events): void {
  ZombieRunState(obj, eye, dt, rng, host, events);
  // The engine's own order, and the two halves the port did not have.
  // `EnemyZombieUpdate` integrates the velocity straight after the state —
  // which is what carries a leap through its arc — and then runs the hook at
  // `obj+0x12F0`, which is what puts the actor on the floor.
  obj.pos.x += obj.vel.x;
  obj.pos.y += obj.vel.y;
  obj.pos.z += obj.vel.z;
  ZombiePushOutOfWorldAndActors(obj, dt * 60);
}

function ZombieRunState(obj: Actor, eye: Vec3, dt: number, rng: Rng,
                        host: GameHost, events?: Events): void {
  switch (obj.state) {
    case ZombieState.Approach:    return ZombieStateApproach(obj, eye, rng, host);
    case ZombieState.AttackRun:   return ZombieStateAttackRun(obj, eye, dt, rng);
    case ZombieState.HoldAtRange: return ZombieStateHoldAtRange(obj, eye, rng, host);
    case ZombieState.Strike:      return ZombieStateStrike(obj, eye, rng, events);
    case ZombieState.BackOff:     return ZombieStateBackOff(obj, eye, dt, rng);
    case ZombieState.WaitTurn:    return ZombieStateWaitTurn(obj, eye, rng);

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

    // The two entrances that place the actor. Without them a spawn stands at
    // the y its record names — under the water at stage 2 block 16, and in
    // the ground where the floor drops away.
    case ZombieState.Emerge:
      return ZombieStateEmerge(obj, dt, events);
    case ZombieState.DelayedLeap:
      return ZombieStateDelayedLeap(obj, dt, rng);
    case ZombieState.FallToGround:
      return ZombieStateFallToGround(obj, dt, rng);

    // The captor family. None of these looks at the camera: they work on the
    // object at `obj+0x1394`, which for 47 of the 59 spawns that reach one is
    // the class-0x10 civilian that built them. See `class30/target.ts`.
    case ZombieState.WalkToTarget:
      return ZombieStateWalkToTarget(obj);
    case ZombieState.TargetMotionScript:
      return ZombieStateTargetMotionScript(obj, rng, events);
    case ZombieState.TargetScriptWithFlag:
      return ZombieStateTargetScriptWithFlag(obj);
    case ZombieState.RetireOffScreen:
      return ZombieStateRetireOffScreen(obj, host, rng);
    case ZombieState.AwaitCivilianOrder:
      return ZombieStateAwaitCivilianOrder(obj, rng);
    case ZombieState.WalkPastPoint:
      return ZombieStateWalkPastPoint(obj);
    case ZombieState.WalkToPoint:
      return ZombieStateWalkToPoint(obj);
    case ZombieState.DragTarget:
      return ZombieStateDragTarget(obj);
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
    // [open] `ZombieStateCarryProp` (`FUN_0045B380`) allocates a companion
    // object running `FUN_00442740` and waits for the player to destroy it.
    // That class is unread, so its exit cannot be modelled — but the state's
    // own body plays its script, which is what the engine does for as long as
    // the prop lives. Nine spawns, and running them as the maul is very much
    // closer than sending them at the player.
    case ZombieState.CarryProp:
      return ZombieStateTargetMotionScript(obj, rng, events);

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
export function EnemyZombieInit(obj: Actor): void {
  obj.attackPermit = -1;
  // `EnemyZombieInit`: `obj+0x124 = g_actor_radius_by_char[type]`, the shot
  // sphere, and `obj+0x128 = 3.5`, the body one. The port had neither, so
  // every zombie collided as a point and walked through walls.
  obj.radius = CharacterTypeOf(obj)?.actor_radius ?? 0;
  obj.bodyRadius = ZOMBIE_BODY_RADIUS;
  // `obj+0x131D = 0xFF`, and every test reads it as `(s8)` -- so this is -1,
  // and an actor that has not been ranked yet passes rather than failing. As
  // 255 it failed every one, and the zombie dropped out of the attack run on
  // its first frame before `RankEnemiesByDistance` had ever seen it.
  obj.rank = -1;
  obj.sub = 0;
  obj.backoffFrames = 0;
  obj.cooldown = 0;
  obj.hasStrikeAnchor = false;
  obj.struck = false;
  // `EnemyZombieInit`: `obj+0x136C |= 0x60000000` — take part in both pushes.
  obj.flags2 |= ZombieFlag2.CollideWorld | ZombieFlag2.CollideActors;
  obj.shoveTimer = 0;
  obj.state = ZombieEntryState(obj.initialState);
}

/**
 * Which state to actually start in.
 *
 * [diverges] Seventeen of the 54 are ported. Every entrance state that *is*
 * read ends by setting state 1 — `ZombieStateWalkDistance` walks its distance
 * and sets 1, the burst-out entrance plays its clip and sets 1 — so an
 * unported entrance resolves to `AttackRun` rather than being left to abort.
 * Between them states 15 and 27 alone are 37 of stage 2's 90 zombies.
 */
export function ZombieEntryState(initial: number): ZombieState {
  // **The captor states are the exception, and folding them into the default
  // was a real bug.** They do not end by setting state 1; they end by handing
  // over to the *attack* script, and only when that is spent does
  // `ZombieScriptEnded` send the actor at the player. Sending them to
  // `AttackRun` here meant all 47 of the civilians' captors abandoned their
  // hostage on frame one and charged the camera — the opposite of what a set
  // piece is for.
  if (TARGET_STATES.has(initial)) return initial;
  // The two placing entrances pass through for the same reason as the captor
  // states: they do not end by setting 1, they end by *moving the actor*, and
  // sending them to `AttackRun` leaves the spawn wherever its record put it.
  if (initial === ZombieState.Emerge || initial === ZombieState.DelayedLeap) {
    return initial;
  }
  // `ZombieStateWalkDistance` *does* end by setting 1, so the fallback below
  // reached the right final state — but only after skipping the walk-in that
  // is the whole point of it. See `class30/walk_distance.ts`.
  if (initial === ZombieState.WalkDistance) return initial;
  // ...and neither does the stationary thrower: it ends by *leaving*, through
  // state 15 or state 26, and `AttackRun` would have it walk at you instead.
  if (initial === ZombieState.StandAndThrow) return initial;
  switch (initial) {
    case ZombieState.Approach:
    case ZombieState.AttackRun:
    case ZombieState.HoldAtRange:
      return initial;
    default:
      return ZombieState.AttackRun;
  }
}
