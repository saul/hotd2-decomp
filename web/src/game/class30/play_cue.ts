/**
 * `ZombieStateMotionCue21` — `FUN_004577F0`, class 0x30 state 21.
 *
 * The scripted entrance that arrives **on a clip**: the two stage-2 zombies
 * that come out through the van's windscreen, and the four in stage 5. Their
 * spawn record freezes the pose (`obj+0x34` bit 0x4000) so the body holds
 * still inside the vehicle, and this state is the only thing in the game that
 * turns that bit back off.
 *
 * ```
 * sub 0   play the descriptor's cue clip, arm its delay      -- falls through
 * sub 1   count the delay down, then clear 0x4000            -- falls through
 * sub 2   play it out; at the end clear 0x2000 and hand over
 * ```
 *
 * Three of the spawn record's flag bits are undone here and nowhere else —
 * 0x4000 when the delay expires, 0x100 (the shot-immunity window) on the
 * landing frame of the jump clip, and 0x2000 as it hands over. **A port that
 * skips this state keeps all three for ever**, which is what it did: the
 * frozen pose stops `ZombieAdvanceMotion` (`FUN_00454860`) advancing
 * `obj+0x194`/`obj+0x198`, so the clip never moves, and because the actor is
 * carried by its clip's own root translation and nothing else, it never
 * closes either. Two zombies stood at 45 units in `AttackRun` for ever.
 */
import type { ZombieActor } from "../actor";
import { ActorFlag } from "../actor";
import { MotionPlayFrame, MotionPlayLength, SecondsToTicks } from "../tables";
import type { Vec3 } from "../vec";
import { ActorSetMotion } from "./motion_cue";
import { TestApproachRing } from "./ring";
import { ZombieState } from "./states";

/**
 * The van jump-out, `zom.bin` 923 — every one of the six shipped state-21
 * spawns plays it, in stage 2 and stage 5 alike.
 */
const VAN_JUMP_MOTION = 0x39b;
/**
 * The play cursor the actor stops ricocheting on: `obj+0x19C == 0x26`, which
 * is authored frame 19 of 41 — the moment it is through the glass and can be
 * shot. The test names the clip as well as the frame, so it is this clip's
 * cue and not a general rule.
 */
const VAN_JUMP_VULNERABLE_FRAME = 0x26;

export function ZombieStateMotionCue21(obj: ZombieActor, eye: Vec3,
                                       dt: number): void {
  const p = obj.intro;
  // [diverges] The engine has no such test: `obj+0x1390` is the descriptor and
  // is always there. A bundle that did not export the cue, or one whose clip
  // is not baked for this skeleton, would otherwise hold the actor frozen for
  // ever — the exact failure this state exists to end — so it hands over
  // instead, with the three bits cleared as the last frame would have.
  if (!p || !MotionPlayLength(obj, p.motion)) {
    ZombieCueHandOver(obj, eye);
    return;
  }

  if (obj.sub === 0) {
    ActorSetMotion(obj, p.motion);
    obj.sub = 1;
    obj.zom.holdFrames = p.delay;          // +0x1330
    // and falls into the countdown, which therefore spends its first frame
    // here: a delay of 0 clears the freeze on the same frame the clip starts.
  }

  if (obj.sub === 1) {
    obj.zom.holdFrames -= SecondsToTicks(dt);
    if (obj.zom.holdFrames > 0) return;
    obj.sub = 2;
    // The pose is released. Until this line `ZombieAdvanceMotion` has not
    // been advancing the clip at all.
    obj.flags &= ~ActorFlag.PoseFrozen;
  }

  // [diverges] The engine tests `obj+0x19C == 0x26` against a counter it steps
  // by exactly one per game frame, so it cannot miss the value. This port's
  // cursor is derived from a clock the player may advance by more than one
  // frame at a time (`Tick.dt` is `frames * TICK`), and a dropped frame here
  // would leave the actor shot-immune for the rest of its life. Reaching the
  // cue is therefore enough. At the engine's own rate the two are the same
  // frame, and the bit is only ever cleared, never set, so passing it twice
  // means nothing.
  if (obj.motion === VAN_JUMP_MOTION
      && MotionPlayFrame(obj) >= VAN_JUMP_VULNERABLE_FRAME) {
    obj.flags &= ~ActorFlag.ShotImmune;
  }

  // `g_motion_play_length[motion] - 1 <= obj+0x19C`. The play cursor, not the
  // authored frame count — see `MotionPlayLength`.
  if (MotionPlayFrame(obj) >= MotionPlayLength(obj) - 1) {
    obj.sub = 0;
    ZombieCueHandOver(obj, eye);
  }
}

/** The tail of state 21: clear the last bit and take the descriptor's exit. */
function ZombieCueHandOver(obj: ZombieActor, eye: Vec3): void {
  obj.flags &= ~ActorFlag.ArcSpent;
  // Descriptor byte 3. A record that names state 21 again would never leave,
  // so the engine substitutes the attack run — all six shipped records name
  // it outright anyway.
  const next = obj.attackState === ZombieState.MotionCue
    ? ZombieState.AttackRun : obj.attackState;
  obj.state = next;
  // The one arm with a body: an actor handed to `ZombieStateBackOff` has
  // never been ranked, so the allowance is seeded here rather than left at
  // whatever `EnemyZombieInit` zeroed. `FUN_004577F0` inlines
  // `TestApproachRing`'s three comparisons; this calls it, which is the same
  // writes to `obj+0x1358` and one fewer copy of the ring table.
  // No shipped record takes this arm — every one of the six exits to state 1.
  if (next === ZombieState.BackOff) TestApproachRing(obj, eye);
}
