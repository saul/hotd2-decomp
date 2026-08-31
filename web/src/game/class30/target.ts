/**
 * The captor family: the class-0x30 states that work on **`obj+0x1394`**.
 *
 * Eleven of the 54 states in `g_class30_states` never look at the camera. They
 * walk at, maul, drag, pounce on or wait beside *the object the actor was
 * built for* — and for 47 of the 59 spawns that use one, that object is the
 * class-0x10 civilian whose `CivilianInit` built them. This is the answer to
 * "why do the zombies in a set piece go for the hostage": they were never
 * going for the player. They have their own script.
 *
 * The port had all eleven falling through `ZombieEntryState`'s default to
 * `AttackRun`, so every captor in the game abandoned its civilian on frame one
 * and charged the camera.
 *
 * ## The script
 *
 * `ZombieScriptForState` (`FUN_0045CA10`) picks one of **two** blobs off the
 * descriptor tail: `+0x08` while the actor is in the tail's attack state
 * (`tail+0x03`), `+0x04` otherwise. Each opens with a header whose shape
 * belongs to the state that entered it and continues as a list of
 * `{motion, frame, loops, mode}` entries that
 * `ZombieStateTargetMotionScript` steps. The cursor at `obj+0x1398` is shared,
 * which is how the walk hands the maul a half-walked list.
 *
 * A list ends on the first entry whose motion is below 1, and then
 * `ZombieScriptEnded` (`FUN_0045C8D0`) **flips the roles**: initial state →
 * attack state, attack state → `AttackRun`. That last transition is the first
 * moment one of these zombies turns on the player, and it is the whole shape
 * of the set piece — deal with the civilian, then come for the camera.
 *
 * ## The two signals it exchanges with class 0x10
 *
 * Neither is a callback; both are one actor writing a field the other polls,
 * which is why they survive a snapshot without any wiring at all.
 *
 * * **Arrival unblocks the civilian.** `ZombieStateWalkToTarget` raises
 *   `0x800` in the civilian's own wait word — {@link CivilianWait.Free} — the
 *   frame it gets close enough. The civilian's script has been parked on that
 *   bit waiting to be grabbed.
 * * **The civilian orders its captors.** Class 0x10's op 0x1A writes a state
 *   id to `sub+0x2C` and a countdown to `sub+0x2E`, and
 *   `ZombieStateAwaitCivilianOrder` is the captor sitting on it. `0x31` means
 *   die; anything else is a state to enter at once.
 *
 * And the kill goes the other way: the maul raises `0x4000000` on the
 * *civilian's* `obj+0x34`, which is the same bit a killing shot raises — so
 * `CivilianUpdate`'s killed branch runs, charges both players 100, and plays
 * the death voice. Failing to rescue costs exactly what a bad shot does.
 */
import type { Events } from "../../core/events";
import type { Rng } from "../../core/rng";
import type { TargetScriptEntry, TargetScriptJson }
  from "../../bundle/characters";
import { ActorFlag, type Actor } from "../actor";
import type { GameHost } from "../host";
import { TurnActorAwayFromPoint } from "../actor_turn";
import { CivilianWait } from "../class10";
import { ActorIsOnScreen, ReleaseAttackSlot } from "../combat/permits";
import { ActorDespawn } from "../despawn";
import { ActorByAt, G } from "../globals";
import { ActorSetMotionBlended } from "./motion_cue";
import { MotionOf, MotionPlayFrame, MotionPlayLength } from "../tables";
import { ZombieState } from "./states";
import { vec3, type Vec3 } from "../vec";

/** `ZombieStateWalkToTarget`'s turn rate, and every other walk's — `0x1A0`. */
const TARGET_TURN_RATE = 0x1a0;
/** `ZombieStateWalkToPoint`'s arrival radius, a literal 5.0. */
const POINT_ARRIVE = 5;
/** `ZombieStateTargetLostPause`: `rand() % 11 + 10` frames of standing. */
const LOST_PAUSE_MIN = 10;
const LOST_PAUSE_SPREAD = 11;
/** `ZombieStateDragTarget`'s three clips — the drag, the kill, the aftermath. */
const DRAG_MOTION = 0x1a4;
const DRAG_KILL_MOTION = 0x1a8;
const DRAG_LATE_MOTION = 0x1aa;
/** `ZombieStatePounceOnTarget`'s clips and its gravity. */
const POUNCE_WAIT_MOTION = 0x41f;
const POUNCE_LAUNCH_MOTION = 0x41c;
const POUNCE_HIT_MOTION = 0x41d;
const POUNCE_RISE_MOTION = 0x41a;
const POUNCE_LAND_MOTION = 0x1b0;
const POUNCE_GRAVITY = -0.0408;
/** The three clips that are already the "target is dead" reaction. */
const DEAD_REACTION_MOTIONS = [0x1ab, 0x1a3, 0x1a7];

/** Which states in `g_class30_states` belong to this family. */
export const TARGET_STATES: ReadonlySet<number> = new Set<number>([
  ZombieState.WalkToTarget, ZombieState.TargetMotionScript,
  ZombieState.TargetScriptWithFlag, ZombieState.CarryProp,
  ZombieState.RetireOffScreen, ZombieState.AwaitCivilianOrder,
  ZombieState.WalkPastPoint, ZombieState.WalkToPoint,
  ZombieState.DragTarget, ZombieState.PounceOnTarget,
  ZombieState.TargetLostPause,
]);

/**
 * `ZombieScriptForState` — `FUN_0045CA10`.
 *
 * The tail's `+0x08` blob while the actor is in the tail's attack state, the
 * `+0x04` blob otherwise. Note what that means for a state *entered from
 * another state*: it keeps reading the blob the entering state was reading,
 * which is exactly what makes the shared cursor work.
 */
export function ZombieScriptForState(obj: Actor): TargetScriptJson | null {
  const p = obj.script;
  if (!p) return null;
  return (obj.state === obj.attackState ? p.attack : p.target) ?? null;
}

/** The entry the cursor is on, or null past the end of the list. */
function entryAt(s: TargetScriptJson | null, pc: number):
    TargetScriptEntry | null {
  const e = s?.entries[pc];
  return e && e.motion >= 1 ? e : null;
}

/**
 * `ZombieApplyScriptMode` — `FUN_0045CA30`. An entry's mode word, onto
 * `obj+0x34`.
 *
 * `-3` raises `0x100` — {@link ActorFlag.ShotImmune}, so the maul cannot be
 * interrupted; `-2` raises `0x400` and clears `0x2000`; anything else raises
 * `0x2400`. [open] `0x400` and `0x2000` have no reader that has been read.
 */
export function ZombieApplyScriptMode(obj: Actor, mode: number): void {
  if (mode === -3) { obj.flags |= 0x100; return; }
  if (mode === -2) { obj.flags = (obj.flags & ~0x2000) | 0x400; return; }
  obj.flags |= 0x2400;
}

/** The civilian's own script block, when this actor has a civilian. */
function targetOf(obj: Actor): Actor | null {
  return obj.targetAt >= 0 ? ActorByAt(obj.targetAt) ?? null : null;
}

/**
 * `ZombieTargetIsDead` — `FUN_0045C8A0`.
 *
 * A null target reports 0, which is what lets the same states run on a spawn
 * that has no civilian at all — and twelve of the 59 are exactly that.
 */
export function ZombieTargetIsDead(obj: Actor): boolean {
  const t = targetOf(obj);
  if (!t || !(t.flags & ActorFlag.Dead)) return false;
  ZombieScriptEnded(obj);
  return true;
}

/**
 * `ZombieScriptEnded` — `FUN_0045C8D0`. The family's terminator.
 *
 * **This is where a captor turns on the player**: an actor that has finished
 * its *attack* script goes to `AttackRun`, and everything before that has been
 * spent on the civilian.
 */
export function ZombieScriptEnded(obj: Actor): void {
  if (obj.state === obj.attackState) obj.state = ZombieState.AttackRun;
  else obj.state = obj.attackState;

  switch (obj.state) {
    case ZombieState.WalkToTarget:
      if (!ZombieTargetIsDead(obj)) obj.sub = 1;
      break;
    case ZombieState.TargetMotionScript:
    case ZombieState.TargetScriptWithFlag:
      obj.scriptPc = 0;
      obj.sub = 1;
      break;
    case ZombieState.WalkPastPoint: {
      // The engine does not always take the walk. If the script's point is
      // already in front of the actor it goes **straight to `AttackRun`**:
      //
      //     if (ActorPointIsAhead(obj+0x64, obj+0x40, ZombieScriptForState(...)))
      //         { obj+0x1310 = 1; obj+0x1312 = 0; }
      //     else  obj+0x1312 = 1;
      //
      // The port only ever set sub 1, so a captor whose point was already
      // ahead walked the whole leg before turning on the player instead of
      // turning at once.
      const s = ZombieScriptForState(obj);
      const pt = s?.head.point;
      if (pt && ActorPointIsAhead(obj, vec3(pt[0], pt[1], pt[2]))) {
        obj.state = ZombieState.AttackRun;
        obj.sub = 0;
      } else {
        obj.sub = 1;
      }
      break;
    }
    case ZombieState.WalkToPoint:
      obj.sub = 1;
      // `if (tail+0x0C != -1) obj+0x34 |= 0x10000` — an actor with a camera
      // cue drops out of the camera's candidate list for the leg it is about
      // to walk, so the shot it is being staged for is not pulled onto it.
      if (obj.cameraCue) obj.flags |= ActorFlag.NoCameraTrack;
      break;
    case ZombieState.AwaitCivilianOrder:
      obj.sub = 1;
      break;
    default:
      obj.sub = 0;
      break;
  }
  // A captor with a camera cue does not turn on the player when its script
  // ends -- it is being staged for a shot, and state 42 holds it until the
  // camera arrives:
  //
  //     if (obj+0x1310 == 1 && tail+0x0C != -1) {
  //         obj+0x132C = 1; obj+0x1310 = 0x2A; obj+0x34 |= 0x10000;
  //     }
  //
  // Three spawns in the game reach it, all in stage 2.
  if (obj.state === ZombieState.AttackRun && obj.cameraCue) {
    obj.delegate = ZombieState.AttackRun;
    obj.state = ZombieState.HoldForCameraCue;
    obj.flags |= ActorFlag.NoCameraTrack;
  }
  // `obj+0x34 &= 0xFFFFDAFF` for every state but the walk: the maul's
  // interrupt immunity and its two unread bits come off with the script.
  if (obj.state !== ZombieState.WalkToTarget) obj.flags &= 0xffffdaff;
}

/** Send the actor to `TargetLostPause`, remembering where it was. */
function loseTarget(obj: Actor): void {
  if (obj.state === ZombieState.WalkPastPoint) return;
  obj.targetCue = obj.state;
  obj.resumeSub = obj.sub;
  obj.state = ZombieState.TargetLostPause;
  obj.sub = 0;
}

/** The clip frame this actor is on — the engine's `obj+0x19C`. */
function frameOf(obj: Actor): number {
  return MotionPlayFrame(obj);
}

/**
 * `obj+0x19C == g_motion_play_length[obj+0x1B4] - 1`.
 *
 * Both halves count in the **play** clock, not in authored frames. Measuring
 * this in frames ends every entry at halfway and takes the kill cue with it.
 */
function atLastFrame(obj: Actor): boolean {
  const len = MotionPlayLength(obj);
  // **Equality, because the cursor wraps.** `>=` is true for both `len - 1`
  // and `len`, so every entry would spend two of its loops per play-through.
  return len > 0 && frameOf(obj) === len - 1;
}

/**
 * The tail every scripted state shares: if the clip has drifted off the one
 * the script asked for, blend back to it — hard when the loop count is nearly
 * spent, soft otherwise.
 */
function reblend(obj: Actor): void {
  if (obj.flags & ActorFlag.Reacting) return;
  if (obj.motion === obj.scriptMotion || !obj.scriptMotion) return;
  const m = MotionOf(obj, obj.motion);
  if (obj.targetLoops < 2) {
    ActorSetMotionBlended(obj, obj.scriptMotion, Math.max(0, (m?.frames ?? 1) - 1), 1);
    return;
  }
  ActorSetMotionBlended(obj, obj.scriptMotion, 0, 10);
  obj.targetLoops -= 1;
}

/** Take one entry off the list into the actor's fields. */
function loadEntry(obj: Actor, e: TargetScriptEntry, blend: number): void {
  ZombieApplyScriptMode(obj, e.mode);
  if (obj.motion !== e.motion || blend === 0) {
    ActorSetMotionBlended(obj, e.motion, e.frame, blend);
  }
  obj.scriptMotion = e.motion;
  obj.targetLoops = e.loops;
  obj.targetCue = e.mode;
  obj.scriptPc += 1;
}

/**
 * `ZombieStateWalkToTarget` — `FUN_0045A890`. Class 0x30 state 34.
 *
 * Every one of the 23 spawns in the game that starts here is a civilian's
 * captor. Sub 2 turns toward the civilian each frame and closes on its own
 * clip's root motion; the moment it is inside the header's radius it hands
 * over to the maul **and raises the civilian's `Free` wait bit**, which is
 * the civilian's cue to stop standing there and start reacting.
 */
export function ZombieStateWalkToTarget(obj: Actor): void {
  const s = ZombieScriptForState(obj);
  const t = targetOf(obj);
  if (obj.sub === 0 || obj.sub === 1) {
    obj.flags |= 0x400;
    obj.targetArrive = s?.head.arrive ?? 0;
    obj.targetLoops = s?.head.loops ?? 0;
    const m = s?.head.motion ?? 0;
    if (obj.sub === 0 || obj.motion !== m) {
      ActorSetMotionBlended(obj, m, s?.head.frame ?? 0, obj.sub === 0 ? 0 : 10);
    }
    obj.scriptMotion = obj.motion;
    obj.scriptPc = 0;
    obj.sub = 2;
  } else if (obj.sub === 2 && t) {
    const d = Math.hypot(obj.pos.x - t.pos.x, obj.pos.z - t.pos.z);
    if (d <= obj.targetArrive) {
      if (!entryAt(s, obj.scriptPc)) {
        ZombieScriptEnded(obj);
      } else {
        obj.state = ZombieState.TargetMotionScript;
        obj.sub = 1;
        // **The grab.** `**(uint **)(target+0x1310) |= 0x800` -- the civilian's
        // own wait word, and `Free` is the bit that makes its next block run.
        if (obj.targetLoops !== 0 && t.civ) t.civ.wait |= CivilianWait.Free;
      }
    } else {
      TurnActorAwayFromPoint(obj, t.pos, TARGET_TURN_RATE, 1 / 60);
    }
  }
  reblend(obj);
  if (ZombieTargetIsDead(obj)) loseTarget(obj);
}

/**
 * `ZombieStateTargetMotionScript` — `FUN_0045AAA0`. Class 0x30 state 35.
 *
 * The maul. Steps the entry list, and on the frame each entry names as its cue
 * raises `0x4000000` on the **civilian's** `obj+0x34` — the same bit a killing
 * shot raises, so `CivilianUpdate` runs its killed branch and charges both
 * players a hundred points for the rescue they did not make.
 */
export function ZombieStateTargetMotionScript(obj: Actor, rng: Rng,
                                              events?: Events): void {
  const s = ZombieScriptForState(obj);
  const t = targetOf(obj);
  if (obj.sub === 0) {
    const e = s?.entries[0];
    if (e) { obj.scriptPc = 0; loadEntry(obj, e, 0); }
    obj.sub = 2;
  } else if (obj.sub === 1) {
    const e = entryAt(s, obj.scriptPc);
    if (e) loadEntry(obj, e, 10);
    obj.sub += 1;
  } else if (obj.sub === 2) {
    if (t && frameOf(obj) === obj.targetCue && !(t.flags & ActorFlag.Dead)) {
      t.flags |= ActorFlag.Dead;
      ZombiePlayTargetKillSound(obj, events);
    }
    // The three "already dead" reactions do not test the target again: the
    // actor is playing them *because* it is dead.
    const reacting = DEAD_REACTION_MOTIONS.includes(obj.motion);
    if (!reacting || !ZombieTargetIsDead(obj)) {
      if (atLastFrame(obj)) {
        if (!ZombieTargetIsDead(obj)) {
          obj.targetLoops -= 1;
          if (obj.targetLoops === 0) {
            if (!entryAt(s, obj.scriptPc)) ZombieScriptEnded(obj);
            else obj.sub = 1;
          }
        } else if (s?.entries[obj.scriptPc]?.motion === -1) {
          loseTarget(obj);
        }
      }
    }
  }
  void rng;
  reblend(obj);
}

/**
 * `ZombieStateTargetScriptWithFlag` — `FUN_0045B190`. Class 0x30 state 36.
 *
 * The maul, with a fifth short per entry: a `g_script_flags` index raised on
 * the cue frame. That is how a set piece's zombie tells the evt script it has
 * finished, so the stage can move on.
 */
export function ZombieStateTargetScriptWithFlag(obj: Actor): void {
  const s = ZombieScriptForState(obj);
  if (obj.sub === 0 || obj.sub === 1) {
    const e = obj.sub === 0 ? s?.entries[0] : entryAt(s, obj.scriptPc);
    if (obj.sub === 0) obj.scriptPc = 0;
    if (e) {
      loadEntry(obj, e, obj.sub === 0 ? 0 : 10);
      obj.resumeSub = e.flag ?? 0;
    }
    obj.sub = obj.sub === 0 ? 2 : obj.sub + 1;
  } else if (obj.sub === 2) {
    if (frameOf(obj) === obj.targetCue) G.g_script_flags[obj.resumeSub] = 1;
    if (atLastFrame(obj)) {
      obj.targetLoops -= 1;
      if (obj.targetLoops === 0) {
        if (obj.targetCue >= 0) {
          if (!entryAt(s, obj.scriptPc)) { ZombieScriptEnded(obj); return; }
          obj.state = ZombieState.TargetMotionScript;
        }
        obj.sub = 1;
      }
    }
  }
  reblend(obj);
}

/**
 * `ZombieStateRetireOffScreen` — `FUN_0045B7B0`. Class 0x30 state 38, and the
 * commonest *attack* state in the family.
 *
 * The header's mode decides what the per-frame arm does: 0 and 1 retire the
 * actor the moment it is off camera, 1 and 2 turn it toward the header's
 * point, 3 retires it when the loop count runs out. It is how a captor leaves
 * the stage once its business with the civilian is done — walking out of frame
 * rather than charging the player.
 */
export function ZombieStateRetireOffScreen(obj: Actor, host: GameHost,
                                           rng: Rng): void {
  const s = ZombieScriptForState(obj);
  if (obj.sub === 0) {
    obj.flags |= ActorFlag.NoCameraTrack;
    const h = s?.head ?? {};
    obj.target = vec3(h.point?.[0] ?? 0, h.point?.[1] ?? 0, h.point?.[2] ?? 0);
    const m = h.motion ?? 0;
    ActorSetMotionBlended(obj, m, h.frame ?? 0, obj.motion === m ? 0 : 10);
    obj.scriptMotion = m;
    obj.targetLoops = h.loops ?? 0;
    obj.targetCue = h.mode ?? 0;
    obj.scriptPc = 0;
    obj.sub = 2;
  } else if (obj.sub === 1) {
    const e = entryAt(s, obj.scriptPc);
    if (e) {
      if (obj.motion !== e.motion) {
        ActorSetMotionBlended(obj, e.motion, e.frame, 10);
      }
      obj.scriptMotion = e.motion;
      obj.targetLoops = e.loops;
      obj.targetCue = e.mode;
      obj.scriptPc += 1;
    }
    obj.sub += 1;
  } else if (obj.sub === 2) {
    if (atLastFrame(obj)) {
      obj.targetLoops -= 1;
      if (obj.targetLoops === 0) {
        obj.sub = entryAt(s, obj.scriptPc) ? 1 : obj.sub + 1;
      }
    }
  } else if (obj.sub === 4) {
    ActorDespawn(obj);
    return;
  }

  const retire = (): void => {
    // [diverges] The engine asks `ActorBoundsOnScreen` (`FUN_0045CA60`), which
    // pads the actor's view-space interval at `obj+0x10C`/`0x110` by its
    // radius. The port has not read those two fields, so this asks
    // `ActorIsOnScreen` (`FUN_00409C10`) about the tracked point instead — the
    // same question about a point rather than a box.
    if (!ActorIsOnScreen(obj, host) && !(obj.flags & ActorFlag.Dead)) {
      ZombieRetireAndCredit(obj, rng);
    }
  };
  switch (obj.targetCue) {
    case 1: TurnActorAwayFromPoint(obj, obj.target, TARGET_TURN_RATE, 1 / 60);
            retire(); break;
    case 0: retire(); break;
    case 2: TurnActorAwayFromPoint(obj, obj.target, TARGET_TURN_RATE, 1 / 60);
            break;
    case 3: if (obj.targetLoops === 0) ZombieRetireAndCredit(obj, rng); break;
    default: break;
  }
  reblend(obj);
}

/**
 * `ZombieRetireAndCredit` — `FUN_0045BA40`.
 *
 * `obj+0x34 |= 0x4008001`, then `obj+0x131C` takes the player the *civilian's*
 * `sub+0x6C` names — or a random one when that is `-1`. That byte is exactly
 * what `CivilianPruneDeadChildren` reads back to decide who is paid the 400,
 * so a captor that walks off screen still counts as dealt with.
 */
export function ZombieRetireAndCredit(obj: Actor, rng: Rng): void {
  obj.flags |= 0x4008001;
  const t = targetOf(obj);
  if (t) {
    const named = t.civ?.rescuePlayer ?? -1;
    obj.killedBy = named === -1 ? (rng.next() < 0.5 ? 0 : 1) : named;
  }
  obj.dead = true;
  obj.sub = 4;
}

/**
 * `ZombieStateAwaitCivilianOrder` — `FUN_0045BAD0`. Class 0x30 state 39.
 *
 * The captor sitting on the civilian's own script. Class 0x10's op 0x1A writes
 * a state id to `sub+0x2C` and a countdown to `sub+0x2E`; this decrements the
 * countdown and takes the order. `0x31` means die — and the zombie takes its
 * killer from the civilian's `sub+0x6C`, so the player who earned the rescue
 * is credited with the captors that simply gave up.
 */
export function ZombieStateAwaitCivilianOrder(obj: Actor, rng: Rng): void {
  const t = targetOf(obj);
  if (obj.sub === 0) {
    obj.targetLoops = obj.flags;          // `obj+0x1350` holds the saved flags
    obj.flags |= 0x18000;
    obj.sub += 1;
    return;
  }
  if (obj.sub === 2) { ActorDespawn(obj); return; }
  if (obj.sub !== 1 || !t?.civ) return;
  if (t.civ.childOrderFrames === 0) return;
  t.civ.childOrderFrames -= 1;
  if (t.civ.childOrder === ZombieState.OrderDie) {
    obj.flags |= ActorFlag.Dead;
    const named = t.civ.rescuePlayer;
    obj.killedBy = named === -1 ? (rng.next() < 0.5 ? 0 : 1) : named;
    obj.dead = true;
    obj.sub += 1;
    return;
  }
  obj.state = t.civ.childOrder;
  obj.sub = 0;
  obj.flags = obj.targetLoops;
}

/**
 * `ZombieStateWalkPastPoint` — `FUN_0045BCB0`. Class 0x30 state 40.
 *
 * Walks until the header's point is **behind** it —
 * `ActorPointIsAhead` (`FUN_0045BC10`) is the test — and then hands over to
 * the maul, or ends the script if the list is spent.
 */
export function ZombieStateWalkPastPoint(obj: Actor): void {
  const s = ZombieScriptForState(obj);
  if (obj.sub === 0 || obj.sub === 1) {
    obj.flags |= 0x2400;
    const h = s?.head ?? {};
    obj.target = vec3(h.point?.[0] ?? 0, h.point?.[1] ?? 0, h.point?.[2] ?? 0);
    const m = h.motion ?? 0;
    if (obj.motion !== m) {
      ActorSetMotionBlended(obj, m, h.frame ?? 0, obj.sub === 0 ? 0 : 10);
    }
    obj.scriptMotion = m;
    obj.scriptPc = 0;
    obj.sub = 2;
  }
  if (ActorPointIsAhead(obj, obj.target)) {
    if (!entryAt(s, obj.scriptPc)) ZombieScriptEnded(obj);
    else if (!ZombieTargetIsDead(obj)) {
      obj.state = ZombieState.TargetMotionScript;
      obj.sub = 1;
    }
  }
  reblend(obj);
}

/**
 * `ZombieStateWalkToPoint` — `FUN_0045BE30`. Class 0x30 state 41. The same
 * header, but it walks *to* the point — within 5.0 — turning as it goes.
 */
export function ZombieStateWalkToPoint(obj: Actor): void {
  const s = ZombieScriptForState(obj);
  if (obj.sub === 0 || obj.sub === 1) {
    const h = s?.head ?? {};
    obj.target = vec3(h.point?.[0] ?? 0, h.point?.[1] ?? 0, h.point?.[2] ?? 0);
    const m = h.motion ?? 0;
    if (obj.motion !== m) {
      ActorSetMotionBlended(obj, m, h.frame ?? 0, obj.sub === 0 ? 0 : 10);
    }
    obj.scriptMotion = m;
    obj.scriptPc = 0;
    obj.sub = 2;
  } else if (obj.sub === 2) {
    const d = Math.hypot(obj.pos.x - obj.target.x, obj.pos.z - obj.target.z);
    if (d <= POINT_ARRIVE) {
      if (!entryAt(s, obj.scriptPc)) ZombieScriptEnded(obj);
      else { obj.state = ZombieState.TargetMotionScript; obj.sub = 1; }
    } else {
      TurnActorAwayFromPoint(obj, obj.target, TARGET_TURN_RATE, 1 / 60);
    }
  }
  reblend(obj);
}

/**
 * `ActorPointIsAhead` — `FUN_0045BC10`. Is the point in front of the actor?
 *
 * The engine rotates the delta by the inverse of all three angles and tests
 * the local `z`. Yaw alone is exact for anything upright, which every actor in
 * this family is.
 */
export function ActorPointIsAhead(obj: Actor, p: Vec3): boolean {
  const a = obj.yaw * ((Math.PI * 2) / 65536);
  const dx = p.x - obj.pos.x;
  const dz = p.z - obj.pos.z;
  return dz * Math.cos(a) - dx * Math.sin(a) > 0;
}

/**
 * `ZombieStateDragTarget` — `FUN_0045C080`. Class 0x30 state 43.
 *
 * The zombie and the civilian are **one animation**: this copies the
 * civilian's position *and* rotation onto the zombie every frame. On the
 * header's cue frame it kills the civilian and switches to the kill clip; if
 * the civilian is already dead it plays the aftermath instead.
 */
export function ZombieStateDragTarget(obj: Actor): void {
  const s = ZombieScriptForState(obj);
  const t = targetOf(obj);
  if (obj.sub === 4) { ActorDespawn(obj); return; }
  if (obj.sub === 0) {
    obj.flags |= 0x2400;
    ActorSetMotionBlended(obj, DRAG_MOTION, 0, 0);
    obj.targetLoops = s?.head.loops ?? 0;
    obj.targetCue = s?.head.cue ?? 0;
    obj.sub += 1;
    obj.flags |= 0x10000000;
  } else if (obj.sub === 2) {
    if (t) { obj.pos = { ...t.pos }; obj.yaw = t.yaw; }
    if (frameOf(obj) === 0x2d) {
      ActorSetMotionBlended(obj, POUNCE_LAND_MOTION, 0, 10);
      obj.sub += 1;
      return;
    }
  }
  if (obj.sub === 1 || obj.sub === 2) {
    if (t) { obj.pos = { ...t.pos }; obj.yaw = t.yaw; }
    if (atLastFrame(obj)) obj.targetLoops -= 1;
    if (obj.targetLoops === 0 && frameOf(obj) === obj.targetCue) {
      if (t && !(t.flags & ActorFlag.Dead)) {
        ActorSetMotionBlended(obj, DRAG_KILL_MOTION, 0, 2);
        obj.flags |= 0x10100;
        t.flags |= ActorFlag.Dead;
        obj.sub += 1;
      }
    } else if (t && (t.flags & ActorFlag.Dead)) {
      ActorSetMotionBlended(obj, DRAG_LATE_MOTION, 0, 2);
      obj.flags |= 0x10100;
      obj.sub += 1;
    }
  }
}

/**
 * `ZombieStatePounceOnTarget` — `FUN_0045C2E0`. Class 0x30 state 44.
 *
 * Claims the civilian's `sub+0x64` so only one zombie is in the air at a time,
 * leaps at it under gravity and kills it on contact. A zombie that finds the
 * slot taken idles instead — which is why a civilian held by three is mauled
 * by one at a time.
 *
 * [diverges] The engine aims at a point one unit up and 2.5 forward of the
 * civilian's own **bone matrix**; `game/` has no skeleton, so this aims at the
 * actor's position lifted by the same offsets in its own facing.
 */
export function ZombieStatePounceOnTarget(obj: Actor, dt: number): void {
  const t = targetOf(obj);
  if (!t) return;
  const frames = dt * 60;
  const a = t.yaw * ((Math.PI * 2) / 65536);
  const aim = { x: t.pos.x - Math.sin(a) * 2.5, y: t.pos.y + 1,
                z: t.pos.z - Math.cos(a) * 2.5 };

  if (obj.sub === 0) {
    if (t.civ && t.civ.pouncer === 0) {
      if (t.flags & ActorFlag.Dead) { ZombieScriptEnded(obj); return; }
      t.civ.pouncer = obj.at;
      obj.sub += 1;
    } else {
      if (obj.motion !== POUNCE_WAIT_MOTION) {
        ActorSetMotionBlended(obj, POUNCE_WAIT_MOTION, 0, 10);
      }
      obj.scriptMotion = POUNCE_WAIT_MOTION;
      if (ZombieTargetIsDead(obj)) loseTarget(obj);
      return;
    }
  }
  if (obj.sub === 1) {
    obj.flags |= 0x10000000;
    ActorSetMotionBlended(obj, POUNCE_LAUNCH_MOTION, 0, 10);
    obj.accY = 0;
    obj.sub += 1;
    return;
  }
  if (obj.sub === 2) {
    obj.vel.y += obj.accY * frames;
    TurnActorAwayFromPoint(obj, aim, TARGET_TURN_RATE, dt);
    if (frameOf(obj) === 10) {
      obj.flags |= 0x20000;
      obj.accY = POUNCE_GRAVITY;
      obj.vel.x = (aim.x - obj.pos.x) * (1 / 30);
      obj.vel.z = (aim.z - obj.pos.z) * (1 / 30);
      obj.vel.y = (aim.y - obj.pos.y) * (1 / 30) + 0.61249995;
      return;
    }
    if (atLastFrame(obj)) { obj.sub += 1; obj.flags |= ActorFlag.PoseFrozen; }
    return;
  }
  if (obj.sub === 3) {
    obj.vel.y += obj.accY * frames;
    if (ActorPointIsAhead(obj, aim)) {
      ActorSetMotionBlended(obj, POUNCE_HIT_MOTION, 0, 1);
      obj.flags &= ~ActorFlag.PoseFrozen;
      obj.vel = vec3();
      obj.accY = 0;
      t.flags |= ActorFlag.Dead;
      obj.sub += 1;
    }
    return;
  }
  if (obj.sub === 4 && frameOf(obj) === 2) {
    ActorSetMotionBlended(obj, POUNCE_RISE_MOTION, 0, 1);
    obj.sub += 1;
    return;
  }
  if (obj.sub === 5 && frameOf(obj) === 10) {
    obj.accY = POUNCE_GRAVITY;
    obj.vel.y = 0.5;
    obj.vel.x = Math.sin(obj.yaw * ((Math.PI * 2) / 65536)) * 0.5;
    obj.vel.z = Math.cos(obj.yaw * ((Math.PI * 2) / 65536)) * 0.5;
    obj.sub += 1;
    obj.flags |= ActorFlag.PoseFrozen;
    return;
  }
  if (obj.sub === 6) {
    obj.vel.y += obj.accY * frames;
    if (obj.vel.y < 0 && obj.vel.y >= -0.4) {
      obj.flags &= ~(ActorFlag.PoseFrozen | 0x20000 | 0x10000000);
      obj.vel = vec3();
      obj.accY = 0;
      if (t.civ) t.civ.pouncer = 0;
      ZombieScriptEnded(obj);
    }
  }
}

/**
 * `ZombieStateTargetLostPause` — `FUN_0045C7D0`. Class 0x30 state 45.
 *
 * Where a captor goes when the thing it was working on dies under it: stand in
 * the character's own walk clip for `rand() % 11 + 10` frames, then return to
 * the state and sub it remembered.
 */
/**
 * `ZombieStateHoldForCameraCue` — `FUN_0045BFD0`. Class 0x30 state 42.
 *
 * A captor that has finished its script and would otherwise turn on the player
 * is being **staged for a shot**: it holds here until the camera reaches the
 * path and frame in its descriptor tail (`+0x0C`/`+0x0E`). Three spawns in the
 * game do this, all in stage 2.
 *
 * It is not an idle. It runs whatever state it is holding — `obj+0x132C`, the
 * delegate — every frame, then takes the state back:
 *
 *     g_class30_states[obj+0x132C](obj);
 *     if (g_active_cam_path == tail+0x0C && g_cam_path_frame == tail+0x0E) {
 *         obj+0x34 &= ~0x10000;  obj+0x1310 = obj+0x132C;  return;
 *     }
 *     if (obj+0x1310 != 0x2A) {
 *         if (obj+0x1310 == 3) {                    // it wants to strike
 *             obj+0x132C = 2;                       // back to HoldAtRange
 *             g_attack_permits[obj+0x121] = 0;      // and give the permit up
 *             obj+0x1310 = 0x2A;  return;
 *         }
 *         obj+0x132C = obj+0x1310;  obj+0x1310 = 0x2A;
 *     }
 *
 * So the zombie really does run at the player and hold at range — it is only
 * forbidden to **land the blow** until the camera is looking. Reaching `Strike`
 * is bounced back to `HoldAtRange` and the permit is handed back, which is why
 * this is the only code in the captor family that touches `g_attack_permits`.
 */
export function ZombieStateHoldForCameraCue(
    obj: Actor, runState: (obj: Actor, state: ZombieState) => void): void {
  // The engine calls `g_class30_states[obj+0x132C]` directly. The dispatcher
  // lives in `class30/index.ts` and importing it here would close a cycle, so
  // it is handed in — the one shape difference from the engine's table lookup.
  runState(obj, obj.delegate);

  const cue = obj.cameraCue;
  if (cue && G.g_active_cam_path === cue.path
      && G.g_cam_path_frame === cue.frame) {
    obj.flags &= ~ActorFlag.NoCameraTrack;
    obj.state = obj.delegate;
    return;
  }
  if (obj.state === ZombieState.HoldForCameraCue) return;
  if (obj.state === ZombieState.Strike) {
    obj.delegate = ZombieState.HoldAtRange;
    ReleaseAttackSlot(obj);
    obj.state = ZombieState.HoldForCameraCue;
    return;
  }
  obj.delegate = obj.state;
  obj.state = ZombieState.HoldForCameraCue;
}

export function ZombieStateTargetLostPause(obj: Actor, rng: Rng,
                                           walkMotion: number): void {
  if (obj.sub === 0) {
    obj.targetLoops = rng.int(LOST_PAUSE_SPREAD) + LOST_PAUSE_MIN;
    if (walkMotion && obj.motion !== walkMotion) {
      ActorSetMotionBlended(obj, walkMotion, 0, 10);
    }
    obj.scriptMotion = obj.motion;
    obj.sub += 1;
    return;
  }
  if (obj.sub === 1) {
    obj.targetLoops -= 1;
    if (obj.targetLoops === 0) {
      obj.state = obj.targetCue;
      obj.sub = obj.resumeSub;
    }
  }
  reblend(obj);
}

/**
 * `ZombiePlayTargetKillSound` — `FUN_0045CBD0`. The noise a zombie makes as it
 * kills a civilian: by clip first, then by character type.
 */
export function ZombiePlayTargetKillSound(obj: Actor, events?: Events): void {
  const m = obj.motion;
  let id: number;
  if (m === 0xfe || m === 0xff || m === 0x3cb) id = 0x1d16a9;
  else if (obj.charType === 2) id = 0x0516a9;
  else if (obj.charType === 0x0d) id = 0x1b16a9;
  else if (obj.charType === 0x0e || obj.charType === 0x13
           || obj.charType === 0x14) id = 0x0316a9;
  else id = 0x1a16a9;
  events?.emit("sound.play", { id });
}
