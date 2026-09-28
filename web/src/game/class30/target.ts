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
import { ActorFlag, MotionFlag, type Actor, type ZombieActor } from "../actor";
import type { GameHost } from "../host";
import { ActorPointIsAhead, TurnActorAwayFromPoint, TurnAngleTowardFrames }
  from "../actor_turn";
import { CivilianWait } from "../class10/ops";
import { ActorBoundsOnScreen } from "../combat/permits";
import { ReleaseEnemyAliveCount, ReleaseEnemyPresentCount }
  from "../combat/counts";
import { CARRIER_RIDERS_DONE_BIT } from "../carrier";
import { ActorDespawn } from "../despawn";
import { ActorByAt, G, HIT_SLOT_NONE } from "../globals";
import { ActorSetMotionBlended } from "./motion_cue";
import { MotionOf, MotionPlayFrame, MotionPlayLength, SecondsToTicks } from "../tables";
import { ZombieState } from "./states";
import { SpawnClass } from "../spawn_class";
import { vec3 } from "../vec";
import { PropStripKind, SpawnPropStripEffect } from "../effects/prop_strip";
import { WADE_MOTION, ZombieWadeSplash } from "./splash";

/**
 * `ZombieStateTargetMotionScript`'s other splash: clip `0xB2` at play frame
 * 0x16 (`SUB EAX, 0xB2` at `0x0045AC08`, `CMP ECX, 0x16` at `0x0045AD16`).
 */
const SCRIPT_SPLASH_MOTION = 0xb2;
const SCRIPT_SPLASH_FRAME = 0x16;

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
/**
 * `ZombieStateDragTarget` sub 2's cue and clip: at cursor `0x2D` it blends to
 * `0x1B0` over ten frames (`0x0045C242`, `0x0045C24C`, `0x0045C262`).
 *
 * The cue is read off **whichever kill clip sub 1 started**, not off `0x1B0`:
 * the compare at `0x0045C23F` is against the track's live cursor and the clip
 * is only written after it fires.
 */
const DRAG_SETTLE_CUE = 0x2d;
const DRAG_SETTLE_MOTION = 0x1b0;
/** Sub 3 turns `obj+0x68` toward this and never leaves — `0x0045C281`. */
const DRAG_SETTLE_YAW = 0x2000;
/**
 * `g_script_flags[0x1D]` — the byte the tail at `0x0045C1AD` reads, and the
 * state's only exit. `0x0045C1AE` is the one instruction in the image that
 * names `0x009C721D`, so every writer of flag 29 is an indexed one; in stage 4
 * that is the dragged civilian's own `CivilianRunScript` op `0x1C`.
 */
export const DRAG_RELEASE_FLAG = 0x1d;
/** `ZombieStatePounceOnTarget`'s clips and its gravity. */
const POUNCE_WAIT_MOTION = 0x41f;
const POUNCE_LAUNCH_MOTION = 0x41c;
const POUNCE_HIT_MOTION = 0x41d;
const POUNCE_RISE_MOTION = 0x41a;
const POUNCE_GRAVITY = -0.0408;
// There was a `POUNCE_LAND_MOTION = 0x1b0` here, and `0x1B0` is not one of the
// pounce's clips. State 44's routine at `0x0045C2E0` plays `0x41F`, `0x41C`,
// `0x41D` and `0x41A` and nothing else — four `PUSH`/`MOV` immediates into the
// four `CALL 0x004119A0` between `0x0045C3E2` and `0x0045C671`, and no `0x1b0`
// anywhere in the routine's 0x4F0 bytes. The only reader of the clip is the
// drag's sub 2, which is where it comes from; it is `DRAG_SETTLE_MOTION`
// above. `L20` — the constant was named for the state next to it rather than
// for the code that plays it. `[proved]`
//
// The address is written bare rather than as a `FUN_` citation on purpose:
// this file *ports* state 44, and a reference-form citation of a function the
// same file defines takes it out of `verify_port`'s ported set. See `L42`.
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
export function ZombieScriptForState(obj: ZombieActor): TargetScriptJson | null {
  const p = obj.script;
  if (!p) return null;
  return (obj.state === obj.attackState ? p.attack : p.target) ?? null;
}

/** The tail's two blobs, as `obj+0x1398` distinguishes them by address. */
const SCRIPT_TARGET = 0;                       // tail +0x04
const SCRIPT_ATTACK = 1;                       // tail +0x08

/** Which blob `ZombieScriptForState` picks for the state the actor is in now.
 * `[port-only]` as an export -- `class30/carry_prop.ts` reads the same cursor.
 */
export function blobForState(obj: ZombieActor): number {
  return obj.state === obj.attackState ? SCRIPT_ATTACK : SCRIPT_TARGET;
}

/**
 * Write `obj+0x1398`: point the cursor into a blob, `pc` entries in.
 *
 * Every place the engine assigns that pointer goes through here, and nowhere
 * else re-derives it. `ZombieStateWalkToTarget` sets it to `blob + 10` — past
 * the head — and `ZombieStateTargetMotionScript` to `blob + 4` per entry
 * consumed; both are this, in entries rather than shorts.
 * `[port-only]` as an export -- `class30/carry_prop.ts` reads the same cursor.
 */
export function aimCursor(obj: ZombieActor, blob: number, pc: number): void {
  obj.zom.scriptBlob = blob;
  obj.zom.scriptPc = pc;
}

/**
 * Read `obj+0x1398`: the blob the cursor is walking, whatever the state is now.
 *
 * **This is the one that was missing.** A captor's walk leaves the cursor in
 * the *attack* blob and then enters state 35, which is not its attack state —
 * so a reader that asked `ZombieScriptForState` got the target blob back,
 * replayed the approach clip it had already finished, and bounced to the walk
 * again. Two zombies circled a hostage in stage 3 for ever and her script,
 * parked on `children-alive`, never moved.
 * `[port-only]` as an export -- `class30/carry_prop.ts` reads the same cursor.
 */
export function cursorScript(obj: ZombieActor): TargetScriptJson | null {
  const p = obj.script;
  if (!p) return null;
  return (obj.zom.scriptBlob === SCRIPT_ATTACK ? p.attack : p.target) ?? null;
}

/** The entry the cursor is on, or null past the end of the list.
 * `[port-only]` as an export -- `class30/carry_prop.ts` reads the same cursor.
 */
export function entryAt(s: TargetScriptJson | null, pc: number):
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
export function ZombieApplyScriptMode(obj: ZombieActor, mode: number): void {
  if (mode === -3) { obj.flags |= 0x100; return; }
  if (mode === -2) { obj.flags = (obj.flags & ~0x2000) | 0x400; return; }
  obj.flags |= 0x2400;
}

/** The civilian's own script block, when this actor has a civilian. */
function targetOf(obj: ZombieActor): Actor | null {
  return obj.targetAt >= 0 ? ActorByAt(obj.targetAt) ?? null : null;
}

/**
 * `ZombieTargetIsDead` — `FUN_0045C8A0`.
 *
 * A null target reports 0, which is what lets the same states run on a spawn
 * that has no civilian at all — and twelve of the 59 are exactly that.
 */
export function ZombieTargetIsDead(obj: ZombieActor): boolean {
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
export function ZombieScriptEnded(obj: ZombieActor): void {
  if (obj.state === obj.attackState) obj.state = ZombieState.AttackRun;
  else obj.state = obj.attackState;

  switch (obj.state) {
    case ZombieState.WalkToTarget:
      if (!ZombieTargetIsDead(obj)) obj.sub = 1;
      break;
    case ZombieState.TargetMotionScript:
    case ZombieState.TargetScriptWithFlag:
      // `obj+0x1398 = ZombieScriptForState(...)` — the blob's *start*, chosen
      // with the state this function has just written.
      aimCursor(obj, blobForState(obj), 0);
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
    obj.zom.delegate = ZombieState.AttackRun;
    obj.state = ZombieState.HoldForCameraCue;
    obj.flags |= ActorFlag.NoCameraTrack;
  }
  // `obj+0x34 &= 0xFFFFDAFF` for every state but the walk: the maul's
  // interrupt immunity and its two unread bits come off with the script.
  if (obj.state !== ZombieState.WalkToTarget) obj.flags &= 0xffffdaff;
}

/** Send the actor to `TargetLostPause`, remembering where it was. */
function loseTarget(obj: ZombieActor): void {
  if (obj.state === ZombieState.WalkPastPoint) return;
  obj.zom.targetCue = obj.state;
  obj.zom.resumeSub = obj.sub;
  obj.state = ZombieState.TargetLostPause;
  obj.sub = 0;
}

/** The clip frame this actor is on — the engine's `obj+0x19C`.
 * `[port-only]` as an export -- `class30/carry_prop.ts` reads the same cursor.
 */
export function frameOf(obj: ZombieActor): number {
  return MotionPlayFrame(obj);
}

/**
 * `obj+0x19C == g_motion_play_length[obj+0x1B4] - 1`.
 *
 * Both halves count in the **play** clock, not in authored frames. Measuring
 * this in frames ends every entry at halfway and takes the kill cue with it.
 * `[port-only]` as an export -- `class30/carry_prop.ts` reads the same cursor.
 */
export function atLastFrame(obj: ZombieActor): boolean {
  const len = MotionPlayLength(obj);
  // **Equality, because the cursor wraps.** `>=` is true for both `len - 1`
  // and `len`, so every entry would spend two of its loops per play-through.
  return len > 0 && frameOf(obj) === len - 1;
}

/**
 * The tail every scripted state shares: if the clip has drifted off the one
 * the script asked for, blend back to it — hard when the loop count is nearly
 * spent, soft otherwise.
 * `[port-only]` as an export -- `class30/carry_prop.ts` reads the same cursor.
 */
export function reblend(obj: ZombieActor): void {
  if (obj.flags & ActorFlag.Reacting) return;
  if (obj.motion === obj.zom.scriptMotion || !obj.zom.scriptMotion) return;
  const m = MotionOf(obj, obj.motion);
  if (obj.zom.targetLoops < 2) {
    ActorSetMotionBlended(obj, obj.zom.scriptMotion, Math.max(0, (m?.frames ?? 1) - 1), 1);
    return;
  }
  ActorSetMotionBlended(obj, obj.zom.scriptMotion, 0, 10);
  obj.zom.targetLoops -= 1;
}

/** Take one entry off the list into the actor's fields. */
function loadEntry(obj: ZombieActor, e: TargetScriptEntry, blend: number): void {
  ZombieApplyScriptMode(obj, e.mode);
  if (obj.motion !== e.motion || blend === 0) {
    ActorSetMotionBlended(obj, e.motion, e.frame, blend);
  }
  obj.zom.scriptMotion = e.motion;
  obj.zom.targetLoops = e.loops;
  obj.zom.targetCue = e.mode;
  obj.zom.scriptPc += 1;                           // `0x1398 = psVar6 + 4`
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
export function ZombieStateWalkToTarget(obj: ZombieActor): void {
  const s = ZombieScriptForState(obj);
  const t = targetOf(obj);
  if (obj.sub === 0 || obj.sub === 1) {
    obj.flags |= 0x400;
    obj.zom.targetArrive = s?.head.arrive ?? 0;
    obj.zom.targetLoops = s?.head.loops ?? 0;
    const m = s?.head.motion ?? 0;
    if (obj.sub === 0 || obj.motion !== m) {
      ActorSetMotionBlended(obj, m, s?.head.frame ?? 0, obj.sub === 0 ? 0 : 10);
    }
    obj.zom.scriptMotion = obj.motion;
    aimCursor(obj, blobForState(obj), 0);       // `0x1398 = puVar6 + 10`
    obj.sub = 2;
  } else if (obj.sub === 2 && t) {
    const d = Math.hypot(obj.pos.x - t.pos.x, obj.pos.z - t.pos.z);
    if (d <= obj.zom.targetArrive) {
      if (!entryAt(cursorScript(obj), obj.zom.scriptPc)) {
        ZombieScriptEnded(obj);
      } else {
        obj.state = ZombieState.TargetMotionScript;
        obj.sub = 1;
        // **The grab.** `**(uint **)(target+0x1310) |= 0x800` -- the civilian's
        // own wait word, and `Free` is the bit that makes its next block run.
        if (obj.zom.targetLoops !== 0 && t.civ) t.civ.wait |= CivilianWait.Free;
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
export function ZombieStateTargetMotionScript(obj: ZombieActor, rng: Rng,
                                              events?: Events,
                                              host?: GameHost): void {
  const t = targetOf(obj);
  if (obj.sub === 0) {
    // `psVar6 = ZombieScriptForState(...)` — the only sub that picks a blob.
    const s = ZombieScriptForState(obj);
    const e = s?.entries[0];
    if (e) { aimCursor(obj, blobForState(obj), 0); loadEntry(obj, e, 0); }
    obj.sub = 2;
  } else if (obj.sub === 1) {
    // `psVar6 = *(short **)(obj+0x1398)` — the cursor, not the state.
    const e = entryAt(cursorScript(obj), obj.zom.scriptPc);
    if (e) loadEntry(obj, e, 10);
    obj.sub += 1;
  } else if (obj.sub === 2) {
    const s = cursorScript(obj);
    if (t && frameOf(obj) === obj.zom.targetCue && !(t.flags & ActorFlag.Dead)) {
      t.flags |= ActorFlag.Dead;
      ZombiePlayTargetKillSound(obj, events);
    }
    // The three "already dead" reactions do not test the target again: the
    // actor is playing them *because* it is dead.
    const reacting = DEAD_REACTION_MOTIONS.includes(obj.motion);
    if (!reacting || !ZombieTargetIsDead(obj)) {
      if (atLastFrame(obj)) {
        if (!ZombieTargetIsDead(obj)) {
          obj.zom.targetLoops -= 1;
          if (obj.zom.targetLoops === 0) {
            if (!entryAt(s, obj.zom.scriptPc)) ZombieScriptEnded(obj);
            else obj.sub = 1;
          }
        } else if (s?.entries[obj.zom.scriptPc]?.motion === -1) {
          loseTarget(obj);
        }
      } else if (obj.motion === SCRIPT_SPLASH_MOTION) {
        // The not-at-the-end arm is a switch on the clip, `0x0045AC08`:
        // clip `0xB2` at play frame 0x16 throws `SpawnPropStripEffect`
        // (`FUN_0043FCA0`) kind 0 at the actor, faced by the camera block's
        // yaw -- `{x, y, z, 0, g_camera_block_yaw_bams, 0}` and scale 1.0 at
        // `0x0045AD1F`..`0x0045AD67`.
        if (frameOf(obj) === SCRIPT_SPLASH_FRAME) {
          SpawnPropStripEffect({
            pos: vec3(obj.pos.x, obj.pos.y, obj.pos.z),
            pitch: 0, yaw: G.g_camera_block_yaw_bams, roll: 0,
          }, PropStripKind.Kind0, 1.0, events);
        }
      } else if (obj.motion === WADE_MOTION) {
        // ...and clip `0xB8`, the wading one, throws its splash and water
        // rings at play frames 0x15 and 0x1B -- `0x0045AC1C`..`0x0045AD0E`,
        // the same block `ZombieStateSurfaceOnCameraCue` has, with its two
        // `SpawnWaterRing` (`FUN_004567C0`) calls at `0x0045AC79` and
        // `0x0045AC88`. See `ZombieWadeSplash`.
        ZombieWadeSplash(obj, frameOf(obj), rng, host, events);
      }
    }
  }
  reblend(obj);
}

/**
 * `ZombieStateTargetScriptWithFlag` — `FUN_0045B190`. Class 0x30 state 36.
 *
 * The maul, with a fifth short per entry: a `g_script_flags` index raised on
 * the cue frame. That is how a set piece's zombie tells the evt script it has
 * finished, so the stage can move on.
 */
export function ZombieStateTargetScriptWithFlag(obj: ZombieActor): void {
  const s = obj.sub === 0 ? ZombieScriptForState(obj) : cursorScript(obj);
  if (obj.sub === 0 || obj.sub === 1) {
    const e = obj.sub === 0 ? s?.entries[0] : entryAt(s, obj.zom.scriptPc);
    if (obj.sub === 0) aimCursor(obj, blobForState(obj), 0);
    if (e) {
      loadEntry(obj, e, obj.sub === 0 ? 0 : 10);
      obj.zom.resumeSub = e.flag ?? 0;
    }
    obj.sub = obj.sub === 0 ? 2 : obj.sub + 1;
  } else if (obj.sub === 2) {
    if (frameOf(obj) === obj.zom.targetCue) G.g_script_flags[obj.zom.resumeSub] = 1;
    if (atLastFrame(obj)) {
      obj.zom.targetLoops -= 1;
      if (obj.zom.targetLoops === 0) {
        if (obj.zom.targetCue >= 0) {
          if (!entryAt(cursorScript(obj), obj.zom.scriptPc)) {
            ZombieScriptEnded(obj); return;
          }
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
 *
 * **And a rider leaves with its boat.** After the mode arm, whatever the mode
 * (`0x0045B997`..`0x0045B9B7`):
 *
 * ```
 * 0045b997  CMP dword ptr [ESI], 0x45cd90      ; the task is CarriedZombieUpdate18
 * 0045b99f  MOV ECX, [ESI+0x13b0]              ; the carrier
 * 0045b9a5  TEST dword ptr [ECX+0x34], 0x400000
 * 0045b9ae  ZombieRetireAndCredit(obj)
 * 0045b9b7  MOV dword ptr [ESI], 0x4533f0      ; *obj = EnemyZombieUpdate
 * ```
 *
 * The bit is {@link CARRIER_RIDERS_DONE_BIT}, which stage 3's two boats raise
 * as they run past their mooring and strike. So a captor still aboard when its
 * boat hits the wall -- stage 3 block 0's `0xC00`, block 7's `0x71D0`, both
 * class 0x18 with 38 as their attack state -- retires, credited, and is gone
 * on its next frame. The port had no such arm, and both stood on the wreck
 * holding their rooms open.
 */
export function ZombieStateRetireOffScreen(obj: ZombieActor, host: GameHost,
                                           rng: Rng): void {
  const s = ZombieScriptForState(obj);
  if (obj.sub === 0) {
    obj.flags |= ActorFlag.NoCameraTrack;
    const h = s?.head ?? {};
    obj.target = vec3(h.point?.[0] ?? 0, h.point?.[1] ?? 0, h.point?.[2] ?? 0);
    const m = h.motion ?? 0;
    ActorSetMotionBlended(obj, m, h.frame ?? 0, obj.motion === m ? 0 : 10);
    obj.zom.scriptMotion = m;
    obj.zom.targetLoops = h.loops ?? 0;
    obj.zom.targetCue = h.mode ?? 0;
    obj.zom.scriptPc = 0;
    obj.sub = 2;
  } else if (obj.sub === 1) {
    const e = entryAt(s, obj.zom.scriptPc);
    if (e) {
      if (obj.motion !== e.motion) {
        ActorSetMotionBlended(obj, e.motion, e.frame, 10);
      }
      obj.zom.scriptMotion = e.motion;
      obj.zom.targetLoops = e.loops;
      obj.zom.targetCue = e.mode;
      obj.zom.scriptPc += 1;
    }
    obj.sub += 1;
  } else if (obj.sub === 2) {
    if (atLastFrame(obj)) {
      obj.zom.targetLoops -= 1;
      if (obj.zom.targetLoops === 0) {
        obj.sub = entryAt(s, obj.zom.scriptPc) ? 1 : obj.sub + 1;
      }
    }
  } else if (obj.sub === 4) {
    ActorDespawn(obj);
    return;
  }

  // Modes 0 and 1 (`0x0045B978`): `ActorBoundsOnScreen` (`FUN_0045CA60`),
  // then the dead bit, then the retire.
  const retire = (): void => {
    if (!ActorBoundsOnScreen(obj, host) && !(obj.flags & ActorFlag.Dead)) {
      ZombieRetireAndCredit(obj, rng);
    }
  };
  switch (obj.zom.targetCue) {
    case 1: TurnActorAwayFromPoint(obj, obj.target, TARGET_TURN_RATE, 1 / 60);
            retire(); break;
    case 0: retire(); break;
    case 2: TurnActorAwayFromPoint(obj, obj.target, TARGET_TURN_RATE, 1 / 60);
            break;
    case 3: if (obj.zom.targetLoops === 0) ZombieRetireAndCredit(obj, rng); break;
    default: break;
  }
  // `0x0045B997`: the rider's exit. `*obj == CarriedZombieUpdate18` is, in
  // the port, a class-0x18 actor whose `carrierAt` still names its carrier --
  // the step off and the two leaps clear it where the engine rewrites `*obj`.
  // (`ZombieActor` types the class as 0x30; a rider is one by its update.)
  if ((obj as Actor).cls === SpawnClass.CarriedZombie && obj.carrierAt >= 0) {
    const carrier = ActorByAt(obj.carrierAt);
    if (carrier && (carrier.flags & CARRIER_RIDERS_DONE_BIT)) {
      ZombieRetireAndCredit(obj, rng);
      // `*obj = EnemyZombieUpdate`, with no bake: the actor is gone on its
      // next update (sub 4). See `Actor.carrierAt` for the one frame between.
      obj.carrierAt = -1;
    }
  }
  reblend(obj);
}

/**
 * `ZombieRetireAndCredit` — `FUN_0045BA40`.
 *
 * ```
 * 0045ba4e  obj+0x34 |= 0x4008001
 * 0045ba54  if (obj+0x1394) {                        ; the target
 * 0045ba61      if (target sub+0x6C != -1) obj+0x131C = sub+0x6C
 * 0045ba6d      else if (g_players_in_play == 1) obj+0x131C = g_active_player
 * 0045ba85      else obj+0x131C = rand() % 2
 *           }
 * 0045ba9d  ReleaseEnemyAliveCount(obj); ReleaseEnemyPresentCount(obj)
 * 0045baae  if (obj+0x3C != -1) g_hit_slots[obj+0x3C] = 0
 * 0045babe  sub = 4
 * ```
 *
 * `obj+0x131C` is exactly what `CivilianPruneDeadChildren` reads back to
 * decide who is paid the 400, so a captor that walks off screen still counts
 * as dealt with. The port's copy drew the player with `rng.next() < 0.5`,
 * skipped the one-player arm, and gave neither count nor the slot back --
 * the counts fell a frame late, when `ActorDespawn` swept them.
 */
export function ZombieRetireAndCredit(obj: ZombieActor, rng: Rng): void {
  obj.flags |= 0x4008001;
  const t = targetOf(obj);
  if (t) {
    const named = t.civ?.rescuePlayer ?? -1;
    if (named !== -1) obj.killedBy = named;
    else if (G.g_players_in_play === 1) obj.killedBy = G.g_active_player;
    else obj.killedBy = rng.int(2);
  }
  obj.dead = true;
  ReleaseEnemyAliveCount(obj);
  ReleaseEnemyPresentCount(obj);
  // The index against -1 and not `obj+0x38` bit `0x40`, and the index is
  // left where it was -- `ZombieStateDragTarget`'s own copy of these lines
  // says the same, and `ActorDespawn`'s release clears it.
  if (obj.hitSlot !== HIT_SLOT_NONE) G.g_hit_slots[obj.hitSlot] = HIT_SLOT_NONE;
  obj.sub = 4;
}

/**
 * `ZombieStateAwaitCivilianOrder` — `FUN_0045BAD0`. Class 0x30 state 39.
 *
 * The captor sitting on the civilian's own script. Class 0x10's op 0x1A writes
 * a state id to `sub+0x2C` and a **count** to `sub+0x2E`; this decrements that
 * count and takes the order. It is not a countdown in frames: every captor
 * parked here consumes one, so `op 0x1A(35, 1)` orders exactly one of them and
 * the script issues it twice to raise two. `0x31` means die — and the zombie
 * takes its killer from the civilian's `sub+0x6C`, so the player who earned
 * the rescue is credited with the captors that simply gave up.
 *
 * **A captor waiting here is not drawn**, and that is the whole of the
 * "they were in the water the entire time" report. Sub 0 does four things
 * and then **falls into sub 1 on the same frame** — the `INC` at `0x0045BB3A`
 * is followed by sub 1's first instruction, not a `RET`:
 *
 * ```
 * 0045bb12  obj+0x1350 = obj+0x34        ; save the flags whole
 * 0045bb1b  OR   EAX, 0x18000            ; out of the shot test and the camera
 * 0045bb29  AND  AL, 0xfe                ; obj+0x1F8 &= ~1: the skeleton
 * 0045bb31  MOV  EAX, [ESI + 0x1d4]      ; model+0x40, the parts' records
 * 0045bb37  MOV  byte ptr [EAX + 1], DL  ; DL = 0: part 0, not drawn
 * ```
 *
 * `obj+0x1F8` bit 0 is {@link MotionFlag.Drawn}: with it clear
 * `SkeletonEmitNode` (`FUN_004114C0`) draws no node of the skeleton, and
 * `ActorDrawShadow` (`FUN_0040A590`) no shadow. The byte is part 0's in
 * {@link Actor.partVisible}, the waist, which the skeleton does not draw —
 * `SkeletonDrawWalk` (`FUN_004110D0`) tests it before the part. **Only part
 * 0**: this does not call `ActorSetPartVisibility` (`FUN_00409D10`), so a
 * character with a skirt as part 1 keeps drawing it. `[proved]`
 *
 * The order arm puts both back — `obj+0x34 = obj+0x1350`, `obj+0x1F8 |= 1`,
 * `MOV byte ptr [ECX + 0x1], AL` with `AL = 1` at `0x0045BBF3` — and then
 * **runs the new state on the same frame**: its last line is
 * `CALL dword ptr [EDX*0x4 + 0x592ae8]`, a tail call through
 * `g_class30_states`, so `runState` is handed in the way {@link
 * ZombieStateHoldForCameraCue} takes it, rather than losing the frame.
 *
 * The die arm credits the civilian's `sub+0x6C` player, or — when that is
 * `-1` — `g_active_player` while `g_players_in_play` is 1 and `rand() % 2`
 * otherwise (`0x0045BB69..0x0045BBA4`), and gives both enemy counts back on
 * the spot: `ReleaseEnemyAliveCount` (`FUN_00456560`) and
 * `ReleaseEnemyPresentCount` (`FUN_00456580`) at `0x0045BBAB`/`0x0045BBB1`.
 */
export function ZombieStateAwaitCivilianOrder(
    obj: ZombieActor, rng: Rng,
    runState?: (obj: ZombieActor, state: ZombieState) => void): void {
  const t = targetOf(obj);
  if (obj.sub === 0) {
    obj.zom.targetLoops = obj.flags;          // `obj+0x1350` holds the saved flags
    obj.flags |= 0x18000;
    obj.motionFlags &= ~MotionFlag.Drawn;
    // The engine writes the byte whatever the count; a model with no parts
    // record has no byte here to write, and nothing reads one.
    if (obj.partVisible.length > 0) obj.partVisible[0] = 0;
    obj.sub += 1;
    // No return: sub 0 runs on into sub 1.
  }
  if (obj.sub === 2) { ActorDespawn(obj); return; }
  if (obj.sub !== 1 || !t?.civ) return;
  if (t.civ.childOrderFrames === 0) return;
  t.civ.childOrderFrames -= 1;
  if (t.civ.childOrder === ZombieState.OrderDie) {
    obj.flags |= ActorFlag.Dead;
    const named = t.civ.rescuePlayer;
    if (named !== -1) obj.killedBy = named;
    else if (G.g_players_in_play === 1) obj.killedBy = G.g_active_player;
    else obj.killedBy = rng.int(2);
    obj.dead = true;
    ReleaseEnemyAliveCount(obj);
    ReleaseEnemyPresentCount(obj);
    obj.sub += 1;
    return;
  }
  obj.state = t.civ.childOrder;
  obj.sub = 0;
  obj.flags = obj.zom.targetLoops;
  obj.motionFlags |= MotionFlag.Drawn;
  if (obj.partVisible.length > 0) obj.partVisible[0] = 1;
  runState?.(obj, obj.state);
}

/**
 * `ZombieStateWalkPastPoint` — `FUN_0045BCB0`. Class 0x30 state 40.
 *
 * Walks until the header's point is **behind** it —
 * `ActorPointIsAhead` (`FUN_0045BC10`) is the test — and then hands over to
 * the maul, or ends the script if the list is spent.
 *
 * **Subs 0 and 1 write the cursor**, and the hand-over is only right because
 * they do: `ADD EDI, 0x10; MOV dword ptr [ESI + 0x1398], EDI` at `0x0045BD89`
 * (sub 0) and `0x0045BD24` (sub 1), with `EDI` the blob
 * `ZombieScriptForState` just returned -- the attack blob, this being the
 * attack state -- so `obj+0x1398` is its first entry, past the 0x10-byte
 * header. State 35 sub 1 then loads the entry **the cursor** names. The port
 * set the index and left the blob where the previous state had put it, which
 * for stage 1's bin captor (`0x3D34`, ordered into state 36 by its civilian)
 * was the *target* blob: state 35 replayed the burst out of the wood, ended
 * that one-entry list, came back here, and did it again for as long as the
 * stage lasted. `[proved]`
 *
 * The arrival test reads the cursor too, as a **dword**:
 * `MOV ECX, [ESI + 0x1398]; CMP dword ptr [ECX], 0x0; JLE` at `0x0045BDBC`.
 * `entryAt` tests the motion short alone. They agree on every list this state
 * reads in the six stages -- all nine state-40 blobs and both state-41 ones
 * end on `{-1, -1}`, a dword of -1 -- which the bundle cannot show, because
 * the exporter stops at the terminator; a scan of the evt blobs found it.
 */
export function ZombieStateWalkPastPoint(obj: ZombieActor): void {
  if (obj.sub === 0 || obj.sub === 1) {
    obj.flags |= 0x2400;
    const s = ZombieScriptForState(obj);
    const h = s?.head ?? {};
    obj.target = vec3(h.point?.[0] ?? 0, h.point?.[1] ?? 0, h.point?.[2] ?? 0);
    const m = h.motion ?? 0;
    if (obj.motion !== m) {
      ActorSetMotionBlended(obj, m, h.frame ?? 0, obj.sub === 0 ? 0 : 10);
    }
    obj.zom.scriptMotion = m;
    aimCursor(obj, blobForState(obj), 0);        // `0x1398 = puVar4 + 4`
    obj.sub = 2;
  }
  if (ActorPointIsAhead(obj, obj.target)) {
    if (!entryAt(cursorScript(obj), obj.zom.scriptPc)) ZombieScriptEnded(obj);
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
 *
 * Subs 0 and 1 share one tail that writes the cursor, `puVar6 + 4` into
 * `obj+0x1398` beside `obj+0x1312 = 2`, and sub 2 reads it back:
 * `**(short **)(obj+0x1398) < 1`. Same fault, same fix, as state 40 above.
 */
export function ZombieStateWalkToPoint(obj: ZombieActor): void {
  if (obj.sub === 0 || obj.sub === 1) {
    const s = ZombieScriptForState(obj);
    const h = s?.head ?? {};
    obj.target = vec3(h.point?.[0] ?? 0, h.point?.[1] ?? 0, h.point?.[2] ?? 0);
    const m = h.motion ?? 0;
    if (obj.motion !== m) {
      ActorSetMotionBlended(obj, m, h.frame ?? 0, obj.sub === 0 ? 0 : 10);
    }
    obj.zom.scriptMotion = m;
    aimCursor(obj, blobForState(obj), 0);        // `0x1398 = puVar6 + 4`
    obj.sub = 2;
  } else if (obj.sub === 2) {
    const d = Math.hypot(obj.pos.x - obj.target.x, obj.pos.z - obj.target.z);
    if (d <= POINT_ARRIVE) {
      if (!entryAt(cursorScript(obj), obj.zom.scriptPc)) ZombieScriptEnded(obj);
      else { obj.state = ZombieState.TargetMotionScript; obj.sub = 1; }
    } else {
      TurnActorAwayFromPoint(obj, obj.target, TARGET_TURN_RATE, 1 / 60);
    }
  }
  reblend(obj);
}

// `ActorPointIsAhead` (`FUN_0045BC10`) is in `game/actor_turn.ts`, whole --
// all three angles -- because the stage-4 boss calls it too. Re-exported so
// this file's callers and tests keep their import.
export { ActorPointIsAhead };

/**
 * The zombie and the civilian are **one animation**, and this is the copy:
 * `obj+0x40/44/48` and **all three** of `obj+0x64/68/6C` off the target, in
 * both of the arms that do it (`0x0045C123`..`0x0045C13D` in sub 1 and
 * `0x0045C22B`..`0x0045C23C` in sub 2). The rotation used to be `yaw` alone,
 * which is two thirds of it. `[proved]`
 */
function DragTargetCopyPose(obj: ZombieActor, t: Actor | null): void {
  if (!t) return;
  obj.pos = { ...t.pos };
  obj.pitch = t.pitch;
  obj.yaw = t.yaw;
  obj.roll = t.roll;
}

/**
 * `ZombieStateDragTarget` — `FUN_0045C080`. Class 0x30 state 43.
 *
 * `g_class30_states[43]` is `0x0045C080`, with `[42]` `0x0045BFD0` and `[44]`
 * `0x0045C2E0` either side and both agreeing with {@link ZombieState} (`L38`).
 * Five sub-states off the jump table at `0x0045C2C0`, and the `JA` at
 * `0x0045C0A4` sends anything above 4 straight to the tail.
 *
 * The captor drags the civilian, kills her on the header's cue frame, settles,
 * and then turns on the spot — and **the only way out of the state is the
 * tail**, which every sub but 4 falls into:
 *
 * ```c
 * 0045c1ad  if (g_script_flags[0x1D] && g_players_in_play) {
 *               obj+0x34 |= 0x4000000;     // Dead
 *               ReleaseEnemyAliveCount(obj);
 *               ReleaseEnemyPresentCount(obj);
 *               obj+0x1312 = 4;            // -> the despawn arm
 *           }
 * ```
 *
 * That is the whole exit. Sub 3 never increments the sub-state, so a captor
 * whose flag never comes up stands in `g_enemies_alive` for the rest of the
 * stage — and because sub 1 raised `0x10100` on itself it is
 * {@link ActorFlag.ShotImmune} while it does, so `DispatchHit`
 * (`FUN_004092F0`) never reaches `ResolveHit` and nothing can shoot it out of
 * the count either. **This port had no tail at all**: it had the sub-4 arm and
 * nothing that could ever assign sub 4. That is `PLAYER_HANGS` item 23 —
 * stage 4's entry-4 route, block 9's `wait_enemies_alive 0` held for ever by
 * one `znkage` at `0x35B4`.
 *
 * `0x0045C1AE` is the **only** instruction in the image that names
 * `0x009C721D`: a byte-pattern sweep of `.text` for `1d729c00` finds exactly
 * one hit (`L32`), so nothing raises flag 29 by literal address and every
 * writer of it is an indexed one. In stage 4 the writer is the civilian this
 * captor is dragging — `CivilianRunScript` op `0x1C` in stream 85 and in both
 * of its branches, 83 and 84, all three reachable from the class-0x10 spawn
 * `0x3578` whose only child **is** `0x35B4`. Rescued, shot or resumed, she
 * raises 29; the script's own `wait_script_flag 29` in block 4 step 7 comes
 * down off the same write.
 *
 * Two things the engine does here that this still does not, both recorded
 * rather than half-done:
 *
 * * sub 2 calls `ActorShiftToHoldBone1Position` (`FUN_0045CE70`) before it
 *   blends, which differences bone 1's drawn world position against the pose
 *   the new clip would put it in. `game/` has no skeleton — that is the
 *   `GameHost` seam — so the actor lands a bone-offset away from where the
 *   engine puts it. `[diverges]`
 * * sub 0's `obj+0x1368 |= 0x10` (`0x0045C0ED`) is a kill-move death-clip
 *   selector, and the port models only bit 0 of that word. See
 *   `ZombieSubState.hasCooldown`.
 */
export function ZombieStateDragTarget(obj: ZombieActor, dt: number): void {
  const t = targetOf(obj);

  // `0x0045C29C`. The only arm that does **not** fall into the tail: it ends
  // in `RET` at `0x0045C2BC`. Note what it does and does not test — the slot
  // index against -1, and *not* `obj+0x38` bit `0x40`, which is the guard
  // `ActorReleaseHitSlot` carries for `ActorDespawn`'s own copy of this. It
  // also leaves `obj+0x3C` pointing at the slot it just gave back, so the
  // release inside `ActorDespawn` is what clears the index.
  if (obj.sub === 4) {
    if (obj.hitSlot !== HIT_SLOT_NONE) {
      G.g_hit_slots[obj.hitSlot] = HIT_SLOT_NONE;
    }
    ActorDespawn(obj);
    return;
  }

  if (obj.sub === 0) {                                      // 0x0045C0B1
    const s = ZombieScriptForState(obj);
    obj.flags |= 0x2400;
    ActorSetMotionBlended(obj, DRAG_MOTION, 0, 0);
    // `0045c0d2 8b4764 / 0045c0d8 24fd` — `obj+0x1F8 &= ~2`. The position is
    // being written from the civilian every frame, so the clip's root must
    // not also carry the actor. Sub 2 puts it back.
    obj.motionFlags &= ~MotionFlag.RootMotion;
    obj.zom.targetLoops = s?.head.loops ?? 0;
    obj.zom.targetCue = s?.head.cue ?? 0;
    obj.flags |= 0x10000000;
    obj.sub += 1;
    // ...and falls into sub 1 on the same frame: `case 0` is a `break` out of
    // the switch straight into `switchD_0045c0aa_caseD_1`.
  }

  if (obj.sub === 1) {                                      // 0x0045C113
    DragTargetCopyPose(obj, t);
    if (atLastFrame(obj)) obj.zom.targetLoops -= 1;
    if (obj.zom.targetLoops === 0 && frameOf(obj) === obj.zom.targetCue) {
      // `0045c17e`: a target already dead on the cue frame goes to the tail
      // and does **not** advance — the `JNE 0x45c1ad` is past the bump.
      if (t && !(t.flags & ActorFlag.Dead)) {
        ActorSetMotionBlended(obj, DRAG_KILL_MOTION, 0, 2);
        obj.flags |= 0x10100;
        t.flags |= ActorFlag.Dead;
        obj.sub += 1;
      }
    } else if (t && (t.flags & ActorFlag.Dead)) {            // 0x0045C1E9
      ActorSetMotionBlended(obj, DRAG_LATE_MOTION, 0, 2);
      obj.flags |= 0x10100;
      obj.sub += 1;
    }
  } else if (obj.sub === 2) {                               // 0x0045C212
    // **A separate arm, not a second pass over sub 1's.** This used to fall
    // through into the loop-and-cue block above, which the engine's `case 2`
    // never reaches: with the civilian dead and the loop count spent, that
    // block's second arm fired on the first frame of sub 2 and bumped
    // straight to sub 3, so the settle never ran at all.
    DragTargetCopyPose(obj, t);
    if (frameOf(obj) === DRAG_SETTLE_CUE) {
      ActorSetMotionBlended(obj, DRAG_SETTLE_MOTION, 0, 10);
      // `0045c273 83c902` — `obj+0x1F8 |= 2`, root motion back on.
      obj.motionFlags |= MotionFlag.RootMotion;
      obj.sub += 1;
    }
  } else if (obj.sub === 3) {                               // 0x0045C27E
    // The whole arm: turn and fall to the tail. It never advances the sub.
    // `0045c27e`: `obj+0x68 = TurnAngleToward(obj+0x68, 0x2000, 0x1A0)`, one
    // step a frame.
    obj.yaw = TurnAngleTowardFrames(obj.yaw, DRAG_SETTLE_YAW, TARGET_TURN_RATE,
                                    SecondsToTicks(dt));
  }

  // The tail — `0x0045C1AD`, reached from sub 0, 1, 2 and 3 alike, and on the
  // same frame as a bump. See the header: this is the state's only exit.
  if (G.g_script_flags[DRAG_RELEASE_FLAG] && G.g_players_in_play !== 0) {
    obj.flags |= ActorFlag.Dead;
    ReleaseEnemyAliveCount(obj);
    ReleaseEnemyPresentCount(obj);
    obj.sub = 4;
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
export function ZombieStatePounceOnTarget(obj: ZombieActor, dt: number): void {
  const t = targetOf(obj);
  if (!t) return;
  const frames = SecondsToTicks(dt);
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
      obj.zom.scriptMotion = POUNCE_WAIT_MOTION;
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
 *
 * **And the cue frame leaves the permit held.** A zombie that reached the hub
 * before the camera claims on every frame of the wait and is bounced on every
 * frame — so on the cue frame too: the delegate claims and writes 3, the cue
 * test matches, and `obj+0x1310 = obj+0x132C` puts it back in `HoldAtRange`
 * **still owning** `g_attack_permits[obj+0x121]`. From there the hub's next
 * claim fails on its own permit, every frame. Nothing in class 0x30 lets go of
 * it; the script does. All three held spawns have their cue on the **last**
 * frame of a shot that the script waits out and then follows with a
 * `queue_event` `finish_sequence`: `0xA030`'s is `75:660`, and block 16 step 6
 * queues one after `wait_camera_path_frame 0` on `cam_play 581..660`;
 * `0x51F4` and `0x5250` share `66:430`, and block 9 step 3 queues one after
 * `wait_queued_events_done` on `cam_play 386..430`. And
 * `EvtActionFinishSequence21` (`FUN_00403710`) opens with
 * `g_attack_permits[0] = g_attack_permits[1] = 0` (`0x00403714`,
 * `0x0040371E`). The port had neither half of that, which is the report "the
 * zombie that mauls the civilian never attacks": it stood in `HoldAtRange`
 * holding the only permit for the rest of the stage. `[proved]` for both
 * routines; `[likely]` that the release lands after the cue frame's update in
 * the engine too, because the script's wait on the path's end cannot finish
 * before the path has published that frame.
 */
export function ZombieStateHoldForCameraCue(
    obj: ZombieActor, runState: (obj: ZombieActor, state: ZombieState) => void): void {
  // The engine calls `g_class30_states[obj+0x132C]` directly. The dispatcher
  // lives in `class30/index.ts` and importing it here would close a cycle, so
  // it is handed in — the one shape difference from the engine's table lookup.
  runState(obj, obj.zom.delegate);

  const cue = obj.cameraCue;
  if (cue && G.g_active_cam_path === cue.path
      && G.g_cam_path_frame === cue.frame) {
    obj.flags &= ~ActorFlag.NoCameraTrack;
    obj.state = obj.zom.delegate;
    return;
  }
  if (obj.state === ZombieState.HoldForCameraCue) return;
  if (obj.state === ZombieState.Strike) {
    obj.zom.delegate = ZombieState.HoldAtRange;
    // **The table entry, and nothing else** — not `ReleaseAttackSlot`
    // (`FUN_00456520`), which this used to call:
    //
    // ```
    // 0045c037  0fbe8e21010000        MOVSX ECX, byte ptr [ESI + 0x121]
    // 0045c03e  c7862c13000002000000  MOV   dword ptr [ESI + 0x132c], 0x2
    // 0045c049  c7048da02b9a0000000000 MOV  dword ptr [ECX*0x4 + 0x9a2ba0], 0x0
    // 0045c054  66c786101300002a00    MOV   word ptr [ESI + 0x1310], 0x2a
    // ```
    //
    // `obj+0x121` keeps the index and the off-screen latch stays up. The next
    // frame of the hold runs the delegate again: `TryClaimAttackSlot` voids
    // `obj+0x121` before it tests anything, and the hub drops the latch if
    // the actor is still off screen (`ZombieStateHoldAtRange`, `0x00455748`)
    // -- on screen it stays up until a queued `finish_sequence` clears it.
    // There is no `-1` test on the index. `[likely]` it never needs one: of
    // the states a hold delegates to, only the hub writes 3, and only after a
    // claim that succeeded this frame. The port's guard is for an array,
    // which unlike the engine's has nothing at index `-1` to scribble.
    if (obj.attackPermit >= 0) G.g_attack_permits[obj.attackPermit] = -1;
    obj.state = ZombieState.HoldForCameraCue;
    return;
  }
  obj.zom.delegate = obj.state;
  obj.state = ZombieState.HoldForCameraCue;
}

export function ZombieStateTargetLostPause(obj: ZombieActor, rng: Rng,
                                           walkMotion: number): void {
  if (obj.sub === 0) {
    obj.zom.targetLoops = rng.int(LOST_PAUSE_SPREAD) + LOST_PAUSE_MIN;
    if (walkMotion && obj.motion !== walkMotion) {
      ActorSetMotionBlended(obj, walkMotion, 0, 10);
    }
    obj.zom.scriptMotion = obj.motion;
    obj.sub += 1;
    return;
  }
  if (obj.sub === 1) {
    obj.zom.targetLoops -= 1;
    if (obj.zom.targetLoops === 0) {
      obj.state = obj.zom.targetCue;
      obj.sub = obj.zom.resumeSub;
    }
  }
  reblend(obj);
}

/**
 * `ZombiePlayTargetKillSound` — `FUN_0045CBD0`. The noise a zombie makes as it
 * kills a civilian: by clip first, then by character type.
 */
export function ZombiePlayTargetKillSound(obj: ZombieActor, events?: Events): void {
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
