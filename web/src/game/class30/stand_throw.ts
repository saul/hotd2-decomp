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
import { ActorFlag, ZombieAux, type Actor, type ZombieActor } from "../actor";
import { ReleaseAttackSlot, TryClaimAttackSlot } from "../combat/permits";
import {
  ReleaseEnemyAliveCount, ReleaseEnemyPresentCount,
} from "../combat/counts";
import { ActorDespawn } from "../despawn";
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
export function ZombieArmedHands(obj: ZombieActor): number {
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
function ZombieHandIsArmed(obj: ZombieActor, bone: number): boolean {
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
export function ZombiePickThrowingHand(obj: ZombieActor, rng: Rng): number {
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
export function ZombieShouldStandAndThrow(obj: ZombieActor): boolean {
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

export function ZombieStateStandAndThrow(obj: ZombieActor, eye: Vec3, rng: Rng,
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
      obj.zom.throwDelay = armed === 2
        ? (tail?.delay_two_hands ?? 0) : (tail?.delay_one_hand ?? 0);
    }
    obj.sub = Sub.Wait;
  }

  if (obj.sub === Sub.Wait) {
    if (standing) {
      ZombieSetMotionIfIdle(obj, idle, rng, "clip", MotionFade.Quick);
      obj.zom.throwDelay -= 1;
      if (obj.zom.throwDelay > 0) return;
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
    obj.zom.throwHand = ZombiePickThrowingHand(obj, rng);
    const a = AttackListOf(obj)[String(obj.attack)];
    if (a) ActorSetMotionBlended(obj, a.strike, 0, 4);
    obj.sub = Sub.Release;
    return;
  }

  if (obj.sub === Sub.Release) {
    const a = AttackListOf(obj)[String(obj.attack)];
    // `obj+0x19C == entry+0x08`, the hit frame, in the play clock.
    if (!a || MotionPlayFrame(obj) !== a.hit_frame) return;
    if (obj.zom.throwHand) {
      SpawnZombieThrownWeapon(obj, obj.zom.throwHand, eye, host, rng, events);
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
    obj.zom.throwDelay = tail?.delay_after_throw ?? 0;
    obj.sub = Sub.Leave;
    return;
  }

  if (obj.sub === Sub.Leave) {
    ZombieSetMotionIfIdle(obj, idle, rng, "clip", MotionFade.Quick);
    obj.zom.throwDelay -= 1;
    if (obj.zom.throwDelay >= 1) return;
    ZombieStandAndThrowLeave(obj, tail);
    // `case 5` falls **into** the sub-6 tail on the same frame — the retire
    // arm ends at `LAB_00459562` rather than returning — so an actor that has
    // just entered sub 6 runs its first idle-and-count frame now. The other
    // two arms have left state 33 entirely and the test below is false.
  }

  // `case 6:` — the arm every later frame takes.
  if ((obj.sub as number) === Sub.Gone) {
    ZombieStandAndThrowWaitToVanish(obj, idle, rng);
  }
}

/**
 * Sub 6 — `LAB_00459562`, the tail the retire arm falls into and the one
 * `case 6` jumps to on every later frame.
 *
 * It plays the idle and does one thing: counts the descriptor's `+0x1C` delay
 * down **only while the room is otherwise clear**, and despawns at the end of
 * it. The actor has already given both enemy counters back, so the block it is
 * in has already advanced; this is the body standing there afterwards.
 */
function ZombieStandAndThrowWaitToVanish(obj: ZombieActor, idle: number,
                                         rng: Rng): void {
  ZombieSetMotionIfIdle(obj, idle, rng, "clip", MotionFade.Quick);
  // `if (g_enemies_present < 1 && g_players_in_play != 0 &&
  //     --obj+0x1330 < 1 && (obj+0x38 & 0x10)) ActorDespawn(obj)`
  // — a short-circuit chain, so the delay does not tick at all until the
  // present count has reached zero.
  if (G.g_enemies_present >= 1 || G.g_players_in_play === 0) return;
  obj.zom.throwDelay -= 1;
  if (obj.zom.throwDelay >= 1) return;
  if (!(obj.flags38 & ZombieAux.StandThrowRetire)) return;
  ActorDespawn(obj);
}

/**
 * The way out: **stand still and be retired**, or state 15 with a distance, or
 * state 26 with a point.
 *
 * `obj+0x38` bit 0x10 chooses, and it is the whole of the first branch —
 * `0045945C  TEST byte ptr [ESI + 0x38], 0x10` (`f6463810`). It is not a test
 * of the level: {@link ZombieAux.StandThrowRetire} is a **spawn-record bit**,
 * moved out of `obj+0x34` by `EnemyZombieInitByCharType` (`FUN_00452FD0`), and
 * exactly two records in the shipped game set it — stage 3 block 2 step 4's
 * two axe men, who stand against a building with nowhere behind them.
 *
 * `ZombieStateWalkDistance` itself has no such test — `FUN_00457220` measures
 * a distance travelled and nothing else, and the world push at that point in
 * stage 3 is `coli3.bin+0x2EA0`, thirty-one quads of flat water at `y = -25`
 * — so with the bit unmodelled the port walked both of them twenty-five units
 * backwards through the wall and held `wait_enemies_alive` for the hundred
 * frames it took.
 *
 * The other two arms are entered at **sub 1**, which is why those two states
 * have a sub-1 arm that skips their own descriptor read — the fields are
 * already on the actor. And the walk arm raises `obj+0x34` bit `0x20000000`,
 * which is the arm of `ZombieStateWalkDistance` that retires the actor instead
 * of sending it at the camera: this is the one place in the game that reaches
 * it.
 */
function ZombieStandAndThrowLeave(obj: ZombieActor,
                                  tail: Actor["standThrow"]): void {
  if (obj.flags38 & ZombieAux.StandThrowRetire) {
    ZombieStandAndThrowRetire(obj, tail);
    return;
  }
  // `uVar6 = obj+0x34 & 0xfeffffff` — inside this branch only, so the retire
  // arm above leaves the bit up.
  obj.flags &= ~ActorFlag.HoldingWeapon;
  if (tail?.leap) {
    obj.state = ZombieState.DelayedLeap;
    obj.sub = 1;
    obj.zom.backoffFrames = 0;
    obj.delayedLeap = { delay: 0, dest: tail.leap.dest,
                        gravity: tail.leap.gravity };
    // `if (condition == 7) condition = 5` — and 5 is the other value
    // `ActorBodyConditionFromHands` refuses to recompute, so it sticks.
    if (obj.condition === STAND_THROW_CONDITION) obj.condition = 5;
    return;
  }
  obj.flags |= ActorFlag.BackingOff;
  obj.zom.targetArrive = tail?.walk_distance ?? 0;
  obj.walkDistance = obj.zom.targetArrive;
  obj.state = ZombieState.WalkDistance;
  obj.sub = 1;
}

/**
 * The retire arm — `0045946A`..`00459560`, the `else` of that same test.
 *
 * It gives everything back **on the spot**: both enemy counters, the attack
 * permit, the camera slot, then raises `NoCameraTrack` and `ShotImmune` so the
 * body is neither looked at nor shootable, latches the descriptor's `+0x1C`
 * delay and drops into sub 6. The actor never moves and never changes state
 * again.
 *
 * The two counters going at once is what "the game just carries on" is: the
 * `wait_enemies_alive` this actor was holding opens on this frame, a hundred
 * frames before the walk-away arm would have reached its twenty-five units.
 */
function ZombieStandAndThrowRetire(obj: ZombieActor,
                                   tail: Actor["standThrow"]): void {
  ReleaseEnemyAliveCount(obj);
  ReleaseEnemyPresentCount(obj);
  ReleaseAttackSlot(obj);
  // `if (obj+0x120 != -1) g_enemy_slots[obj+0x120 * 8] = 0` — inlined here
  // rather than reached through `ZombieReleasePermitAndUntrack`. The port
  // keeps `g_enemy_slots` as the list of spawn addresses the fill rebuilds
  // each frame, so dropping this actor from it is the same statement.
  G.g_enemy_slots = G.g_enemy_slots.filter((at) => at !== obj.at);
  // `if ((obj+0x38 & 0x40) && obj+0x3C != -1) g_hit_slots[obj+0x3C] = 0` — the
  // hit-slot system is not ported at all; see `Actor.flags38`.
  obj.zom.throwDelay = tail?.leave_delay ?? 0;
  obj.sub = Sub.Gone;
  obj.flags |= ActorFlag.NoCameraTrack | ActorFlag.ShotImmune;
}
