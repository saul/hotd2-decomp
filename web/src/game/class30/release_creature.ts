/**
 * `ZombieStateReleaseBodyCreature` — `FUN_00457FB0`, class 0x30 state **25**.
 *
 * The state no spawn record reaches. `g_class30_states[0x19]` is
 * `0x00457FB0`, with `0x18` {@link ZombieState.LeapToPoint} (`0x00457CE0`)
 * and `0x1A` {@link ZombieState.DelayedLeap} (`0x004581A0`) either side of it,
 * so the indexing is not adrift — `L38`, read out of the table and not off a
 * name. The only way in is `ActorReactToHit`'s `znjoe` arm: one shot to the
 * torso of a character-type-0x0A actor, and it comes here instead of
 * staggering.
 *
 * What it is: **the zombie is already dead** — sub 0 zeroes its hit points
 * and latches the death bit — and what is left is a walk, a wait, and the
 * chest opening. It backs out to its own inner approach ring first, which is
 * the part that reads oddly until you notice the actor has been shot at close
 * range and needs room; then it plays one clip for 95 to 104 frames, applies
 * the torso's first damage step **by hand**, releases the creature, gives up
 * its attack permit and hands over to {@link ZombieState.Death}.
 *
 * See `game/body_creature.ts` for what comes out.
 */
import type { Rng } from "../../core/rng";
import { ActorFlag, ZombieFlag2, type ZombieActor } from "../actor";
import { SpawnBodyCreature } from "../body_creature";
import { SpawnBoneHitSprite } from "../effects/blood";
import { ReleaseAttackSlot } from "../combat/permits";
import { CharacterTypeOf, MotionPlayFrame, MotionPlayLength } from "../tables";
import type { GameHost } from "../host";
import type { Vec3 } from "../vec";
import { ApproachInnerRadius } from "./ring";
import { ActorSetMotionBlended } from "./motion_cue";
import { ZombieState } from "./states";

/**
 * `OR AH, 0x35` at `0x00457FE2` — `0x3500` on `obj+0x34`, all four bits at
 * once and none of them taken back.
 *
 * `0x100` {@link ActorFlag.ShotImmune} makes `ZombieOnShot` return before it
 * can pick a death state, so nothing can interrupt the release by shooting
 * again; `0x400` {@link ActorFlag.NoDismember} sends the effect table's sever
 * code to its damage-only arm, so the torso cannot then be blown open twice;
 * `0x2000` {@link ActorFlag.NoHitReaction} is the stagger veto
 * `ActorPlayHitReaction` tests at `0x004544D8`. `0x1000` is `[open]` — this
 * routine is one of several writers and no reader has been found for it.
 */
export const RELEASE_FLAGS = 0x3500;

/** The clip it walks out to, at a random phase with a five-frame fade. */
export const WALK_MOTION = 0x1e3;
export const WALK_FADE = 5;
/** ...and the one it opens on, at a random phase with a ten-frame fade. */
export const RELEASE_MOTION = 0x1df;
export const RELEASE_FADE = 10;
/** `ADD EDX, 0x5F` on `rand() % 10` — 95 to 104 frames of it. */
export const RELEASE_DELAY_MIN = 0x5f;
export const RELEASE_DELAY_SPREAD = 10;
/** The bone that opens, and the bone the arm required the shot to hit. */
export const RELEASE_BONE = 1;
/**
 * `g_pBoneEffectSlots[type][bone*6 + n]` with `bone` 1 and `n` **1** — the
 * `+0x0E` the routine reads is the second u16 of bone 1's six, which is the
 * step a *first* hit on the torso would have taken.
 */
export const RELEASE_STEP = 1;

/** The sub-states of `obj+0x1312`, which is class 0x30's second state word. */
enum Sub {
  /** Kill the actor, raise the four bits, and fall into the range test. */
  Arm = 0,
  /** Walk until the inner ring is reached. */
  BackOut = 1,
  /** Start the release clip and arm the countdown. */
  Open = 2,
  /** Count it down, and let the creature out on the frame it lands. */
  Wait = 3,
  /** Hand over to the death state. */
  Done = 4,
}

export function ZombieStateReleaseBodyCreature(obj: ZombieActor, eye: Vec3,
                                               rng: Rng,
                                               host: GameHost): void {
  if (obj.sub === Sub.Arm) {
    // `MOV word ptr [ESI + 0x11C], 0x0` — the actor is dead from here, and
    // the death latch goes up with it. Everything after this is a corpse
    // finishing a job.
    obj.hp = 0;
    obj.flags |= RELEASE_FLAGS;
    obj.flags2 |= ZombieFlag2.DiedInFlight;
    obj.sub = Sub.BackOut;
  }

  if (obj.sub === Sub.Arm || obj.sub === Sub.BackOut) {
    // **The inner radius, not the outer.** `0045802D FCOMP [EAX*4 +
    // 0x9A2BE0]` with `EAX = obj+0x131F * 3`, and `g_enemy_approach_rings`
    // is the inner of the three floats of each ring set — 25 units for most
    // characters, 37 for set 2, against the outer's 51. The distance is to
    // the **camera**, in xz, like every other range test in this class.
    const dx = obj.pos.x - eye.x;
    const dz = obj.pos.z - eye.z;
    if (Math.sqrt(dx * dx + dz * dz) < ApproachInnerRadius(obj)) {
      // `CMP dword ptr [ESI + 0x1B4], 0x1E3 / JZ` — restarted only when the
      // clip is not already the one it wants, so the phase is drawn once.
      if (obj.motion !== WALK_MOTION) {
        ActorSetMotionBlended(obj, WALK_MOTION, rng.int(RELEASE_DELAY_SPREAD),
                              WALK_FADE);
      }
      return;
    }
    obj.sub = Sub.Open;
  }

  if (obj.sub === Sub.Open) {
    ActorSetMotionBlended(obj, RELEASE_MOTION, rng.int(RELEASE_DELAY_SPREAD),
                          RELEASE_FADE);
    // `obj+0x1330` and `obj+0x1334` — the **shared arc record's** first two
    // words, which class 0x30 reuses per state and which no arc is using
    // here: a znjoe reaches this state from `ActorReactToHit` mid-fight and
    // leaves it for {@link ZombieState.Death}. Same aliasing as the engine's,
    // and `actor.ts` says why the port keeps it rather than inventing a
    // field.
    obj.arcFrames = 0;
    obj.arcTotal = rng.int(RELEASE_DELAY_SPREAD) + RELEASE_DELAY_MIN;
    obj.sub = Sub.Wait;
  }

  if (obj.sub === Sub.Wait) {
    // `TEST AH, 0x80` on `obj+0x136C` — the once-only latch, and it is tested
    // before the counter is stepped, so the counter stops the frame it fires.
    if (!(obj.flags2 & ZombieFlag2.DeathMotionVariant)
        && ++obj.arcFrames === obj.arcTotal) {
      ReleaseBodyCreatureFromTorso(obj, host);
      // **The latch is not only a latch.** `obj+0x136C` bit `0x8000` is
      // {@link ZombieFlag2.DeathMotionVariant}, which `ChooseDeathMotion`
      // reads at `0x00456191` to pick death motion `0x3DB` for character type
      // 10 — this character type. So the same write that stops the creature
      // being released twice is what makes a `znjoe` die its own death, and
      // that bit was already read and named before this state was.
      obj.flags2 |= ZombieFlag2.DeathMotionVariant;
      // `ReleaseAttackSlot` (`FUN_00456520`) — the permit, and the
      // `g_attack_committed` latch with it. A corpse must not hold either.
      ReleaseAttackSlot(obj);
      // `MOV dword ptr [ESI + 0x1328], 0xFFFFFFFF` is the last write of the
      // arm, and it is **not ported**: `obj+0x1328` is another per-state
      // dword — 40-odd accesses across nine routines, class 0x30's own being
      // in `FUN_004534A0` — and nothing between here and
      // {@link ZombieState.Death} reads it. `[open]`, and it has no field
      // here rather than one named for where it sits (`L20`).
    }
    // `obj+0x19C >= g_motion_play_length[obj+0x1B4] - 1`, both in the play
    // clock, and `JL` — so it is *at or past*, not equal.
    const len = MotionPlayLength(obj);
    if (len > 0 && MotionPlayFrame(obj) >= len - 1) {
      obj.sub = Sub.Done;
    }
  }

  if (obj.sub === Sub.Done) {
    obj.state = ZombieState.Death;
    obj.sub = 0;
    obj.flags2 |= ZombieFlag2.DiedInFlight;
  }
}

/**
 * `[port-only]` as a function, and sub 3's own frame as behaviour: the chest
 * opening, and the creature leaving it. Split out of
 * {@link ZombieStateReleaseBodyCreature} above because it is the whole of
 * what this state is *for* and a test wants to be able to call it.
 *
 * `[proved]` It is the **torso's first damage step, applied by hand**. The
 * two writes are `obj+0x328 = 1` and `obj+0x29C = the u16 at
 * g_pBoneEffectSlots[type] + 0x0E`, and the bone records are
 * `obj + 0x20C + bone*0x90` with the hit count at `obj + 0x298 + bone*0x90`:
 * for bone 1 those are exactly `0x29C` and `0x328`. So it writes bone 1's
 * draw slot and bone 1's hit count, with the slot the same table entry a
 * first shot on the torso would have chosen.
 *
 * It does **not** go through `ActorSwapDamagedPart` (`FUN_004098E0`), which
 * means no zone bit on `obj+0x1318` and nothing severed: the body condition
 * `ActorUpdateBodyCondition` derives is untouched, so the zombie still dies
 * its ordinary death.
 */
export function ReleaseBodyCreatureFromTorso(obj: ZombieActor,
                                             host: GameHost): void {
  const step = CharacterTypeOf(obj)?.bones
    .find((b) => b.bone === RELEASE_BONE)?.steps?.[RELEASE_STEP];
  if (step) {
    obj.boneSlot[String(RELEASE_BONE)] = step[0];
    host.setBoneSlot(obj.at, RELEASE_BONE, step[0]);
  }
  obj.hits[RELEASE_BONE] = RELEASE_STEP;
  // `FUN_00407200(obj, 1)` — the bone-hit sprite, on the bone that opened.
  SpawnBoneHitSprite(obj.at, RELEASE_BONE);
  // Between it and the spawn the engine calls `0x0041EBB0`, which is a single
  // `RET`: an empty function, so there is nothing here to port.
  SpawnBodyCreature(obj);
}
