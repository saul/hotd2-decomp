/**
 * `ZombieStateBackOff` — `FUN_00455C30`.
 *
 * After a strike the actor **keeps the permit** and retreats, playing `row[4]`
 * — which carries 0.429 units per frame of root motion the other way — until
 * it is back outside the inner ring or 240 frames have passed. Only then does
 * it release, and it returns to `ZombieStateHoldAtRange`, not to the approach.
 *
 * That retreat is the pause between attacks, and returning to the hub rather
 * than to the approach is what makes the next zombie's turn come round
 * promptly instead of after a fresh walk-in.
 */
import type { Rng } from "../../core/rng";
import { ActorFlag, type Actor } from "../actor";
import { TurnActorAwayFromPoint } from "../actor_turn";
import { ReleaseAttackSlot } from "../combat/permits";
import { FirstBakedOf, MotionOf, MotionRowOf } from "../tables";
import { dist2d, type Vec3 } from "../vec";
import { ZombieSetMotionIfIdle } from "./motion_cue";
import { ApproachInnerRadius } from "./ring";
import { BACKOFF_MAX_FRAMES, GAME_HZ, MotionFade, MotionRow, ZombieState } from "./states";

/** `FUN_00409F90`'s rate here, positive when `obj+0x136C & 0x400000` is set. */
const BACKOFF_TURN_RATE = -0x40;
/**
 * The clip the engine names by id in its exit test, and the frame it must
 * reach. `g_motion_play_length` runs at about twice the authored frame count,
 * so 0x43 is very nearly the end of one play-through of a 36-frame clip.
 */
const BACKOFF_HELD_MOTION = 0x100;
const BACKOFF_HELD_MIN_FRAME = 0x43;

/** The engine's `obj+0x19C`, the clip's own frame at 60 Hz. */
function MotionFrameOf(obj: Actor): number {
  const m = MotionOf(obj, obj.motion);
  return m ? Math.floor(obj.clock * m.fps * 2) : 0;
}

export function ZombieStateBackOff(obj: Actor, eye: Vec3, dt: number,
                                   rng: Rng): void {
  if (obj.sub === 0) {
    // `obj+0x1338`, **not** the attack cooldown at `obj+0x133C`. This is the
    // shove timer `ZombiePushOutOfWorldAndActors` (`FUN_00454900`) counts
    // down; 60 frames after a push it flips `obj+0x136C` bit 0x400000, which
    // is the direction this state retreats in. An earlier revision wrote it
    // into `cooldown` — two different fields, one of them the thing that
    // paces attacks.
    obj.shoveTimer = 0x3c;            // +0x1338
    obj.backoffFrames = 0;            // +0x1334
    // `obj+0x34 |= 0x20000000`: out of the compacted queue while retreating,
    // so whoever is behind moves up and can take its turn.
    obj.flags |= ActorFlag.BackingOff;
    obj.sub = 1;
  }

  ZombieSetMotionIfIdle(obj,
    FirstBakedOf(obj, MotionRowOf(obj), MotionRow.BackAway), rng, 5, MotionFade.Normal);
  // Back toward where *this* actor's strike began — `obj+0x13D8/E0`, captured
  // when it started the swing — and not simply away from the player.
  //
  // Retreating along a shared radial away from the player instead, as this
  // did, funnels every one of them onto the same line.
  //
  // [open] An earlier revision of this comment asserted there is **no**
  // separation pass anywhere in the engine. That is wrong:
  // `ZombiePushOutOfWorldAndActors` (`FUN_00454900`), the per-frame hook
  // `EnemyZombieInit` installs at `obj+0x12F0`, runs
  // `ColiTestSphereAgainstActors` against `obj+0x12C` with radius `obj+0x128`
  // and pushes the actor out by a tenth of the penetration each frame — 1.8x
  // that while airborne. It is not ported, and porting it would change how a
  // crowd packs and therefore how often the one with the permit is in range.
  //
  // The negative rate turns to the *opposite* of `VecToAngles(obj - p)`: the
  // anchor is further out than the actor now is, so the unflipped angle points
  // inward and the back-away clip's +Z root would carry it into the camera.
  TurnActorAwayFromPoint(obj, obj.strikeStart, BACKOFF_TURN_RATE, dt);
  obj.backoffFrames += dt * GAME_HZ;

  // Distance is measured against the remembered player point, the same one the
  // lunge used.
  const d = dist2d(obj.pos, obj.hasStrikeAnchor ? obj.target : eye);
  // **The retreat has a floor, and it is the clip's.** The engine's exit is
  // `(far enough || 240 frames) && (motion != 0x100 || frame > 0x43)` — so a
  // character whose back-away is motion 256 may not return to the hub until
  // that clip has played out, whatever the distance says. Three of the game's
  // motion rows use it. Leaving the clause out let those actors turn round
  // the instant they crossed the ring, which is a swing they should not have
  // had yet.
  const clipHeld = obj.motion === BACKOFF_HELD_MOTION
    && MotionFrameOf(obj) <= BACKOFF_HELD_MIN_FRAME;
  if ((d > ApproachInnerRadius(obj) || obj.backoffFrames > BACKOFF_MAX_FRAMES)
      && !clipHeld) {
    obj.cooldown = 0;
    obj.flags &= ~ActorFlag.BackingOff;
    ReleaseAttackSlot(obj);          // only now is the next enemy free
    obj.hasStrikeAnchor = false;
    obj.state = ZombieState.HoldAtRange;
    obj.sub = 0;
  }
}
