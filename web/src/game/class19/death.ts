/**
 * Class 0x19's reaction and death states — `0x14`, `0x15`, `0x16` — and the
 * only writer of `g_script_flags[32]` in the game.
 *
 * `Boss4StateDeath` (`FUN_00495770`) is the second half of every one of the
 * eight gates this class holds: `wait_script_flag 32` is the instruction
 * immediately after the fight in blocks 23, 25, 27 and 29, and
 * `MOV byte ptr [0x009c7220], 0x1` at `0x004958C7` is what releases it. It
 * lands on **clip frame 0x46**, not on the frame the hit points ran out and
 * not on the end of the clip — the body is still falling when the script is
 * let go.
 */
import type { Actor } from "../actor";
import { ActorFlag } from "../actor";
import { G } from "../globals";
import { MotionPlayFrame, MotionPlayLength } from "../tables";
import { Boss4SetMotionBlended } from "./entrance";
import { Boss4Clip, Boss4State } from "./state";
import type { Boss4Block as Blk } from "./state";

/**
 * `g_script_flags` — `0x009C7200`, index 32.
 *
 * Four `wait_script_flag 32` gates, all in stage 4: blocks 23, 25, 27 and 29,
 * one each. One writer in the whole image, `0x004958C7`.
 */
export const BOSS4_DEAD_FLAG = 32;

/** The dwell the death state latches — `MOV [EAX + 0x74], 0xF0`. Four seconds. */
export const BOSS4_DEATH_DWELL = 0xf0;

/** The clip frame the flag lands on — `CMP EAX, 0x46` at `0x004958A0`. */
const DEATH_FLAG_FRAME = 0x46;

/** The clip frame the second sound plays on — `CMP EAX, 0x82`. */
const DEATH_SOUND_FRAME = 0x82;

/**
 * The clip `Boss4StateFlinch` puts back when it interrupted
 * {@link Boss4State.RiseThenIdle} — `PUSH 0x78` at `0x004954E8`, the same clip
 * that state itself ends in.
 */
const BOSS4_RISE_IDLE_CLIP = 0x78;

/** `Boss4StateDeath`'s sub-states. */
enum DeathSub {
  /** Start the fall clip, drop the placed bit, latch the dwell. */
  Start = 0,
  /** The fall, and the two clip frames that matter inside it. */
  Fall = 1,
  /** Landed: the dwell counts down and nothing else happens. */
  Settle = 2,
}

/**
 * `Boss4StateDeath` — `FUN_00495770`. State `0x16`.
 *
 * Subs 0 and 1 share a body: sub 0 falls through into sub 1's clip tests on
 * the same frame (`JZ` chain at `0x00495770`..`0x004957C7` reaches
 * `0x004957CA` from both), and only sub 2 skips them for the countdown.
 */
export function Boss4StateDeath(obj: Actor, b: Blk): void {
  if (b.sub === DeathSub.Start) {
    // `FUN_004119A0(char, 0x69, 0, 10)`.
    Boss4SetMotionBlended(obj, Boss4Clip.Die);
    // `AND dword ptr [EAX], 0xFFFFFFFD` — the placed bit.
    b.flags &= ~0x02;
    // `MOV dword ptr [EAX + 0x74], 0xF0`.
    b.timer = BOSS4_DEATH_DWELL;
    // `PlaySoundId(0x241BA9)`, and `MOV byte ptr [0x009CA0EA], 0` — the byte
    // the entrance raised. `[open]`, and not ported.
    b.sub += 1;
  } else if (b.sub !== DeathSub.Fall) {
    if (b.sub === DeathSub.Settle) {
      // `DEC dword ptr [EAX + 0x74]` — and nothing else.
      b.timer -= 1;
    }
    Boss4DeathRetire(b);
    return;
  }

  const frame = MotionPlayFrame(obj);
  if (frame === MotionPlayLength(obj) - 1) {
    // `OR dword ptr [ESI + 0x34], 0x4000` — the pose freezes on the last
    // frame, which is what leaves a body on the floor rather than a loop.
    obj.flags |= ActorFlag.PoseFrozen;
    b.sub += 1;
  } else if (frame === DEATH_FLAG_FRAME) {
    // `[diverges]` The engine snaps the body to one of two fixed spots here —
    // `(270.0, 42.65, -1789.4)` facing 0 when the phase is 8, and
    // `(-515.1, 42.65, -1718.4)` facing 0x8000 otherwise — so the corpse
    // always lies where the outgoing camera shot expects it. The port does not
    // move it: those coordinates belong to the arena progression the phases
    // drive, and with the phases unported the phase byte here is not the one
    // the engine would be holding, so snapping to either spot would put the
    // body somewhere the fight never reached. Visual, and it does not touch
    // the gate.
    //
    // `OR dword ptr [ESI + 0x34], 0x10000` — off the camera's tracking list.
    obj.flags |= ActorFlag.NoCameraTrack;
    // `AND dword ptr [EAX], 0xFFFFFFEF`.
    b.flags &= ~0x10;
    // `MOV byte ptr [0x009c7220], 0x1` at `0x004958C7`. **This is the gate.**
    G.g_script_flags[BOSS4_DEAD_FLAG] = 1;
  } else if (frame === DEATH_SOUND_FRAME) {
    // `PlaySoundId(0xB16A9)`, `FUN_00493890()` and `DAT_009C8E8C = 0x32`.
    // All three `[open]`, and none of them is state.
  }
  Boss4DeathRetire(b);
}

/**
 * The tail every path of `Boss4StateDeath` falls into, at `0x004958CE`.
 *
 * `if (state+0x74 == 0) g_enemies_present--` — and it is an equality, not a
 * `<=`, so the counter is dropped on exactly one frame of the dwell. That is
 * why the dwell is decremented only in sub 2: a countdown that could be
 * stepped over would drop the count twice or never.
 */
function Boss4DeathRetire(b: Blk): void {
  if (b.timer === 0) G.g_enemies_present -= 1;
}

/**
 * `Boss4StateFlinch` — `FUN_00495340`. State `0x14`.
 *
 * The reaction a head hit puts the boss into, and the state that puts it back:
 * `state+0x06` holds what it interrupted and the switch at `0x00495463` maps
 * that to where the boss goes next. Everything that reaches this port's
 * ported spine came from state 7, which is case 7 — the arm that restores the
 * clip the flinch replaced and returns to it.
 *
 * `[diverges]` The turn-toward at `0x004954C0` and the phase cue behind
 * `FUN_004952A0` are not ported; see `index.ts`.
 */
export function Boss4StateFlinch(obj: Actor, b: Blk): void {
  if (b.sub === 0) {
    if (b.savedState === Boss4State.WaitForCameraInRange) {
      // `MOV [EAX + 0x74], obj+0x1B4` — the clip to put back afterwards, in
      // the slot four other states use for four other things.
      b.timer = obj.motion;
      Boss4SetMotionBlended(obj, b.phase === 3
        ? Boss4Clip.Flinch : Boss4Clip.FlinchIdle);
    } else {
      // `MOV dword ptr [EAX + 0x70], 0x40C00000` — the walk speed back to 6.
      b.walkSpeed = 6;
      Boss4SetMotionBlended(obj, Boss4Clip.Flinch);
    }
    // `PlaySoundId(0x281BA9)`. `[open]`.
    b.sub += 1;
  } else if (b.sub !== 1) {
    return;
  }

  if (MotionPlayFrame(obj) !== MotionPlayLength(obj) - 1) return;

  // The switch at `0x00495463`, arm for arm. Three of its arms set the sub
  // themselves and three fall into a shared `MOV byte ptr [EAX + 0x5], 0`; the
  // ninth — case 9 with the wrong phase — sets **neither** the state nor the
  // sub and only clears the reaction bit, which leaves the boss in the flinch
  // with its clip already finished. That is the engine's, and it is not an
  // oversight to tidy: the very next frame runs this same tail again.
  switch (b.savedState) {
    case Boss4State.HoldThenApproach:      // case 6
    case Boss4State.LookAtCamera:          // case 10
      b.state = Boss4State.ApproachCamera;
      b.sub = 0;
      break;
    case Boss4State.WaitForCameraInRange:  // case 7
      // `FUN_004119A0(char, state+0x74, 0, 10)` — the clip it interrupted.
      Boss4SetMotionBlended(obj, b.timer);
      b.state = Boss4State.WaitForCameraInRange;
      b.sub = 0;
      break;
    case Boss4State.RiseThenIdle:          // case 8
      Boss4SetMotionBlended(obj, BOSS4_RISE_IDLE_CLIP);
      b.state = Boss4State.WaitForCameraInRange;
      b.sub = 0;
      break;
    case Boss4State.TurnToStoredPoint:     // case 9
      if (b.phase === 0x0d) {
        b.state = Boss4State.ApproachCamera;
        b.sub = 0;
      }
      break;
    case Boss4State.StrikeClip65:
    case Boss4State.StrikeClip7A:
    case Boss4State.StrikeClip7B:
    case Boss4State.PinPlayer:             // cases 0xF..0x12
      b.state = Boss4State.ChooseAction;
      b.sub = 0;
      break;
    case Boss4State.ChargePastCamera:      // case 0x13
      Boss4ResumeAfterHit(obj, b);
      break;
    default:
      b.state = b.savedState;
      b.sub = 0;
      break;
  }
  // `AND dword ptr [ESI + 0x34], 0xBFFFFFFF` at `0x0049552A` — the reaction is
  // over, and every arm of the switch reaches it.
  obj.flags &= ~ActorFlag.Reacting;
}

/**
 * `Boss4ResumeAfterHit` — `FUN_004952A0`. Leave a reaction.
 *
 * With no player in play the boss parks in state `0x0D`; otherwise it fires
 * the phase's own cue — `FUN_004932A0` with `0x12`, `0x13`, `0x14` or `0x15`
 * for phases 5, 7, 0x0B and 0x10, `[open]` and not ported — plays the idle and
 * goes back to state 7.
 */
export function Boss4ResumeAfterHit(obj: Actor, b: Blk): void {
  if (G.g_players_in_play < 1) {
    b.state = Boss4State.WaitForPlayer;
    b.sub = 0;
    return;
  }
  Boss4SetMotionBlended(obj, Boss4Clip.Idle);
  b.state = Boss4State.WaitForCameraInRange;
  b.sub = 0;
}
