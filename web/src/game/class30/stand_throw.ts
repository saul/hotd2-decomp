/**
 * `ZombieStateStandAndThrow` — `FUN_00459080`, class 0x30 state 33.
 *
 * **The one class-0x30 state that never moves the actor at all.** It stands
 * where the script put it, plays `row[0]`, waits, takes an attack permit,
 * throws the weapon out of one hand, waits again, and throws the other — and
 * only when both hands are empty does it walk away or leap out.
 *
 * Seven spawns in the game start here, every one of them body condition 7, and
 * three character types have the hands for it: 1 (`znassb.bin`), 0x13 —
 * whose asset file is literally **`tutorial.bin`** — and 0x14
 * (`znonoopa.bin`). What 0x13 and 0x14 throw is `znonoo.bin` part 0, the axe.
 *
 * The port had no state 33 at all, so `ZombieEntryState` folded it into
 * `AttackRun` and the tutorial's axe man charged the camera like everything
 * else. He is supposed to stand across the room and throw at you.
 *
 * A second path reaches the same state: `ZombieShouldStandAndThrow`
 * (`FUN_00458E10`) lets an ordinary **condition 8** walker stop and throw when
 * the camera is already facing it. Fourteen spawns are condition 8, and it is
 * wired into `ZombieStateAttackRun` where the engine has it.
 */
import type { Events } from "../../core/events";
import type { Rng } from "../../core/rng";
import { ActorFlag, type Actor } from "../actor";
import { ReleaseAttackSlot, TryClaimAttackSlot } from "../combat/permits";
import { G } from "../globals";
import { AttackListOf, CharacterTypeOf, MotionPlayFrame, MotionPlayLength,
         MotionRowOf } from "../tables";
import type { GameHost } from "../host";
import { bamsDelta, type Vec3 } from "../vec";
import { ZombieReleaseAndDespawn } from "./walk_distance";
import { ActorSetMotionBlended, ZombieSetMotionIfIdle } from "./motion_cue";
import { SpawnZombieThrownWeapon } from "./throw";
import { MotionFade, ZombieState } from "./states";

/**
 * The body condition that means "this one stands and throws".
 *
 * It is **sticky**: `ActorBodyConditionFromHands` (`FUN_00455920`) recomputes
 * the condition from which hands are still armed for every char type in
 * 0x13..0x14 *except* when it is already 7 or 5, so the descriptor's 7 survives
 * until this state itself sets 5 on the way out.
 */
export const STAND_THROW_CONDITION = 7;

/** `ZombieStateStandAndThrow`'s sub-states, which the engine increments. */
enum Sub {
  /** Latch the idle delay from how many hands are still armed. */
  Arm = 0,
  /** Play the idle and count that delay down. */
  Wait = 1,
  /** Wait for a permit, then start the throw clip. */
  Claim = 2,
  /** Wait for the clip's hit frame and let go of the weapon. */
  Release = 3,
  /** Play the clip out. */
  Recover = 4,
  /** Idle, then leave. */
  Leave = 5,
  /** The despawn arm. */
  Gone = 6,
}

/** Which hands still hold their weapon: 0, 1 or 2. */
export function ZombieArmedHands(obj: Actor): number {
  const hands = CharacterTypeOf(obj)?.zombie_throw?.hands;
  if (!hands) return 0;
  let n = 0;
  for (const h of hands) if (ZombieHandIsArmed(obj, h.bone)) n += 1;
  return n;
}

/**
 * Is this hand still holding its weapon?
 *
 * The engine compares the bone's **draw slot** — `obj+0x4DC` for bone 5 and
 * `obj+0x68C` for bone 8, which are `0x20C + bone * 0x90` — against the slot
 * the skeleton started it with. Shooting the weapon out of the hand, or
 * severing the arm, changes that slot and disarms the hand.
 */
function ZombieHandIsArmed(obj: Actor, bone: number): boolean {
  const h = CharacterTypeOf(obj)?.zombie_throw?.hands
    .find((x) => x.bone === bone);
  if (!h) return false;
  const cur = obj.boneSlot[String(bone)];
  return cur === undefined ? true : cur === h.held;
}

/**
 * `ZombiePickThrowingHand` — `FUN_00458F00`.
 *
 * Tosses a coin for which hand to prefer and falls back to whichever is still
 * armed. Writes the attack index at `obj+0x131A` — 0 for bone 5, 1 for bone 8
 * — and returns the bone, or 0 when both hands are empty.
 */
export function ZombiePickThrowingHand(obj: Actor, rng: Rng): number {
  const hands = CharacterTypeOf(obj)?.zombie_throw?.hands ?? [];
  const right = hands.find((h) => h.bone === 5);
  const left = hands.find((h) => h.bone === 8);
  const preferRight = rng.int(2) === 0;
  const order = preferRight ? [right, left] : [left, right];
  for (const h of order) {
    if (!h || !ZombieHandIsArmed(obj, h.bone)) continue;
    obj.attack = h.bone === 5 ? 0 : 1;
    return h.bone;
  }
  obj.attack = 1;
  return 0;
}

/**
 * `ZombieShouldStandAndThrow` — `FUN_00458E10`. May this walker stop and throw?
 *
 * Four conditions, and all of them: the actor is **body condition 8**, the
 * camera is within `0x400` BAMS of the way it is already facing, a permit is
 * free, and at least one hand still holds its weapon. So an ordinary walker
 * throws only when it happens to be looking at you — it never turns to line
 * the shot up.
 *
 * `TryClaimAttackSlot` is called here as a *test*, and it takes the permit on
 * success; the state it routes into does not claim again for a condition-8
 * actor, which is why the claim arm skips it.
 */
export function ZombieShouldStandAndThrow(obj: Actor): boolean {
  if (obj.condition !== ATTACK_RUN_THROW_CONDITION) return false;
  // `FUN_0040A040(g_camera_yaw_bams - 0x8000, obj+0x68, 0x400)` — the camera's
  // *backward* yaw against the actor's facing, because an actor faces away
  // from what it is walking at. See `TurnActorTowardCamera`.
  const want = (G.g_camera_yaw_bams - 0x8000) & 0xffff;
  if (Math.abs(bamsDelta(want, obj.yaw & 0xffff)) > FACING_WINDOW) return false;
  if (ZombieArmedHands(obj) === 0) return false;
  return TryClaimAttackSlot(obj);
}

/** The condition an ordinary walker must be in to stop and throw. */
export const ATTACK_RUN_THROW_CONDITION = 8;
/** `FUN_0040A040`'s window here: 0x400 BAMS, a little over five degrees. */
const FACING_WINDOW = 0x400;

export function ZombieStateStandAndThrow(obj: Actor, eye: Vec3, rng: Rng,
                                         host: GameHost,
                                         events?: Events): void {
  const tail = obj.standThrow;
  const idle = MotionRowOf(obj)[0];
  const standing = obj.condition === STAND_THROW_CONDITION;

  // Subs 0, 1 and 2 are a **fallthrough** in the engine — `case 0` has no
  // `break`, so arming, waiting and claiming can all happen on one frame when
  // the delays are zero, and three of the seven shipped spawns have exactly
  // that. Written as a chain of tests on the sub the arms themselves advance,
  // which is the same thing without a switch TypeScript refuses to compile.
  if (obj.sub === Sub.Arm) {
    // Only the stationary one arms itself here; a condition-8 walker that
    // routed in from `AttackRun` falls straight through to the claim.
    if (standing) {
      const armed = ZombieArmedHands(obj);
      if (armed === 0) { ZombieReleaseAndDespawn(obj); return; }
      obj.flags |= ActorFlag.HoldingWeapon;
      obj.throwDelay = armed === 2
        ? (tail?.delay_two_hands ?? 0) : (tail?.delay_one_hand ?? 0);
    }
    obj.sub = Sub.Wait;
  }

  if (obj.sub === Sub.Wait) {
    if (standing) {
      ZombieSetMotionIfIdle(obj, idle, rng, "clip", MotionFade.Quick);
      obj.throwDelay -= 1;
      if (obj.throwDelay > 0) return;
    }
    obj.sub = Sub.Claim;
  }

  if (obj.sub === Sub.Claim) {
    // **The pause between throws.** `TryClaimAttackSlot` is the same permit
    // every other enemy queues for, so a thrower standing behind a crowd waits
    // its turn rather than throwing over their heads.
    if (standing && !TryClaimAttackSlot(obj)) {
      ZombieSetMotionIfIdle(obj, idle, rng, "clip", MotionFade.Quick);
      return;
    }
    obj.flags |= ActorFlag.Committed;
    obj.throwHand = ZombiePickThrowingHand(obj, rng);
    const a = AttackListOf(obj)[String(obj.attack)];
    if (a) ActorSetMotionBlended(obj, a.strike, 0, 4);
    obj.sub = Sub.Release;
    return;
  }

  if (obj.sub === Sub.Release) {
    const a = AttackListOf(obj)[String(obj.attack)];
    // `obj+0x19C == entry+0x08`, the hit frame, in the play clock.
    if (!a || MotionPlayFrame(obj) !== a.hit_frame) return;
    if (obj.throwHand) {
      SpawnZombieThrownWeapon(obj, obj.throwHand, eye, host, rng, events);
    }
    obj.sub = Sub.Recover;
    return;
  }

  if (obj.sub === Sub.Recover) {
    const len = MotionPlayLength(obj);
    if (len > 0 && MotionPlayFrame(obj) !== len - 1) return;
    obj.flags &= ~ActorFlag.Committed;
    ReleaseAttackSlot(obj);
    // A condition-8 walker throws once and goes back to closing on you.
    if (!standing) { obj.state = ZombieState.AttackRun; obj.sub = 0; return; }
    // The stationary one throws again while it still has a hand.
    if (ZombieArmedHands(obj) > 0) { obj.sub = Sub.Arm; return; }
    obj.throwDelay = tail?.delay_after_throw ?? 0;
    obj.sub = Sub.Leave;
    return;
  }

  if (obj.sub === Sub.Leave) {
    ZombieSetMotionIfIdle(obj, idle, rng, "clip", MotionFade.Quick);
    obj.throwDelay -= 1;
    if (obj.throwDelay >= 1) return;
    ZombieStandAndThrowLeave(obj, tail);
  }
  // Sub 6 is the despawn arm, reached only when `obj+0x38` bit 0x10 is set.
  // [open] Nothing read so far sets that bit and `ActorInitFlags` zeroes the
  // word, so no shipped spawn takes it.
}

/**
 * The way out: state 15 with a distance, or state 26 with a point.
 *
 * Both are entered at **sub 1**, which is why those two states have a sub-1
 * arm that skips their own descriptor read — the fields are already on the
 * actor. And the walk arm raises `obj+0x34` bit `0x20000000`, which is the
 * arm of `ZombieStateWalkDistance` that retires the actor instead of sending
 * it at the camera: this is the one place in the game that reaches it.
 */
function ZombieStandAndThrowLeave(obj: Actor,
                                  tail: Actor["standThrow"]): void {
  obj.flags &= ~ActorFlag.HoldingWeapon;
  if (tail?.leap) {
    obj.state = ZombieState.DelayedLeap;
    obj.sub = 1;
    obj.backoffFrames = 0;
    obj.delayedLeap = { delay: 0, dest: tail.leap.dest,
                        gravity: tail.leap.gravity };
    // `if (condition == 7) condition = 5` — and 5 is the other value
    // `ActorBodyConditionFromHands` refuses to recompute, so it sticks.
    if (obj.condition === STAND_THROW_CONDITION) obj.condition = 5;
    return;
  }
  obj.flags |= ActorFlag.BackingOff;
  obj.targetArrive = tail?.walk_distance ?? 0;
  obj.walkDistance = obj.targetArrive;
  obj.state = ZombieState.WalkDistance;
  obj.sub = 1;
}
