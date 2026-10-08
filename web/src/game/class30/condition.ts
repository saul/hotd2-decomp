/**
 * Body condition, recomputed from what is still in the hands.
 *
 * `obj+0x130C` is the **row selector** for three tables at once —
 * `g_class30_attacks[char_type][condition]`, its pick table, and the motion
 * row — so it decides both what a zombie swings and how far away it swings
 * from. A spawn descriptor names the starting value; from then on it is a
 * function of the hands, and two routines write it that way:
 * `ActorBodyConditionFromHands`, every frame an actor spends at the ring, and
 * `ActorUpdateBodyCondition`, on every shot that lands. They are siblings and
 * not copies -- different character types, different literals, and only the
 * first writes zone bits -- so each is transcribed on its own.
 *
 * It matters far more than its size suggests. Character types 0x13
 * (`tutorial.bin`) and 0x14 (`znonoopa.bin`) carry **two kinds of row**:
 * conditions 7 and 8 hold the *throw* — clip 1005/1004, `distance` 99,
 * `hit_frame` 35 — and conditions 0..2 hold the ordinary melee at 19 to 25
 * units. Only `ZombieStateStandAndThrow` (`FUN_00459080`) reads the throw row.
 * `ZombieStateStrike` (`FUN_00455A40`) reading it would be a swing with a
 * ninety-nine-unit reach, and the engine never lets that happen because
 * `ZombieStateHoldAtRange` (`FUN_00455720`) runs this first.
 */
import type { Events } from "../../core/events";
import { DamageZone, type Actor, type ZombieActor } from "../actor";
import { DrawRecordSlot } from "../model_draw";
import { T } from "../tables";
import { STAND_THROW_CONDITION } from "./stand_throw";
import { ZombieReleaseWeaponLoopSe } from "./weapon_loop";

/** Character type 1, `znassb.bin`: the one that lobs parts of itself. */
const CHAR_ZNASSB = 1;
/** `tutorial.bin` and `znonoopa.bin`, the two axe throwers. */
const CHAR_TUTORIAL = 0x13;
const CHAR_ZNONOOPA = 0x14;

/**
 * The draw slots the routine compares against, as literals, because that is
 * how the engine holds them: `FUN_00455920` has all six compiled in and tests
 * a bone against **both** character types' values rather than looking the
 * character up. They agree with the bundle's `zombie_throw.hands[].held` for
 * every shipped type.
 */
const ZNASSB_RIGHT_HELD = 0x1ba9;   // 7081
const ZNASSB_LEFT_HELD = 0x1ba5;    // 7077
const TUTORIAL_RIGHT_HELD = 0x1ece; // 7886
const TUTORIAL_LEFT_HELD = 0x1eca;  // 7882
const ZNONOOPA_RIGHT_HELD = 0x1ef9; // 7929
const ZNONOOPA_LEFT_HELD = 0x1ef5;  // 7925

/**
 * Body condition 5, which this routine refuses to recompute.
 *
 * `ZombieStandAndThrowLeave` sets it on the way out of state 33 — the value
 * that says "this one has already thrown everything it had" — and the guard
 * below is what makes it stick.
 */
export const SPENT_CONDITION = 5;

/**
 * `obj+0x136C` bit `0x40`: when the last weapon goes, fall to condition 5
 * rather than 0 -- once. Its one instruction-level writer in the image is
 * `ThrowerStateLeapToSurface` at `0x0044C29B`, which is class 0x31; on a
 * class-0x30 actor it comes from the **descriptor**, whose `+0x20` word is
 * the low half of `obj+0x136C` (`EnemyZombieInit`, `0x00452EAF`), and one
 * shipped class-0x30 descriptor carries it. This note used to say nothing set
 * it for this class, having searched the image and not the data (`L98`).
 */
const SPENT_ON_EMPTY_LATCH = 0x40;

/** `znchain.bin`, character type 2: the chainsaw, whose loop the hands own. */
const CHAR_ZNCHAIN = 2;
/** `znken.bin`, character type 0xE: one hand that counts. */
const CHAR_ZNKEN = 0xe;
/** `ActorUpdateBodyCondition`'s own two literals for type 2, and type 0xE's one. */
const ZNCHAIN_RIGHT_HELD = 0x1bd2;  // 7122
const ZNCHAIN_LEFT_HELD = 0x1bcc;   // 7116
const ZNKEN_RIGHT_HELD = 0x1e55;    // 7765
/** The two hand bones every one of these literals is compared against. */
const HAND_RIGHT = 5;
const HAND_LEFT = 8;

/**
 * `ActorUpdateBodyCondition` — `FUN_00454270`. The body condition a landed
 * shot leaves.
 *
 * Its one caller is `ActorShotFeedback` (`FUN_00454050`), on results 1, 3 and
 * 4 (`0x004541F4`, the jump table at `0x0045425C`), and that one's is
 * `ZombieOnShot` (`FUN_00453EB0`) -- so it runs for class 0x30 alone, once
 * for each shot that lands and is not refused as shot-immune, whether or not
 * the shot killed. A switch on the character type (`0x004543D8` bytes into
 * `0x004543C4`):
 *
 * ```
 * type 1:         n = (hand5 == 0x1BA9) + (hand8 == 0x1BA5); n == 0 -> cond 0
 * type 2:         n = (hand5 == 0x1BD2) + (hand8 == 0x1BCC)
 *                 n == 0 -> ZombieReleaseWeaponLoopSe(obj), cond 0
 *                 n == 1 -> cond 1;  n == 2 -> cond 2
 * type 0xE:       hand5 != 0x1E55 -> cond 0
 * types 0x13/14:  cond 7 or 5 -> nothing
 *                 n = (hand5 == 0x1ECE) + (hand8 == 0x1ECA)
 *                   + (hand5 == 0x1EF9) + (hand8 == 0x1EF5); n == 0 -> cond 0
 * then, every type: obj+0x136C bit 0x40 up, cond 0, and obj+0x1318 carrying
 *   the zone bits of bones 5 and 8 (g_bone_damage_zone[5], [8]) ->
 *   bit 0x40 down, cond 5
 * ```
 *
 * `[proved]` from the disassembly. Unlike the hub's sibling below, the fourth
 * compare of types 0x13/0x14 is the left hand's own word, and nothing here
 * writes a zone bit. `hand5`/`hand8` are the draw records' slots -- zero for a
 * bone `RemoveBoneSubtree` has taken off -- through `DrawRecordSlot`.
 *
 * Shooting the saw out of a `znchain`'s hands is the second way its loop
 * stops, beside dying (`ZombieStateDeath6`): the release is refused unless
 * this actor is a holder and sounds the stopper only for the last one.
 */
export function ActorUpdateBodyCondition(obj: ZombieActor, events?: Events):
    void {
  const right = DrawRecordSlot(obj, HAND_RIGHT);
  const left = DrawRecordSlot(obj, HAND_LEFT);
  let armed = 0;
  switch (obj.charType) {
    case CHAR_ZNASSB:
      if (right === ZNASSB_RIGHT_HELD) armed = 1;
      if (left === ZNASSB_LEFT_HELD) armed += 1;
      if (armed === 0) obj.condition = 0;
      break;
    case CHAR_ZNCHAIN:
      if (right === ZNCHAIN_RIGHT_HELD) armed = 1;
      if (left === ZNCHAIN_LEFT_HELD) armed += 1;
      if (armed === 0) {
        ZombieReleaseWeaponLoopSe(obj, events);
        obj.condition = 0;
      } else {
        obj.condition = armed;
      }
      break;
    case CHAR_ZNKEN:
      if (right !== ZNKEN_RIGHT_HELD) obj.condition = 0;
      break;
    case CHAR_TUTORIAL:
    case CHAR_ZNONOOPA:
      if (obj.condition === STAND_THROW_CONDITION
          || obj.condition === SPENT_CONDITION) break;
      if (right === TUTORIAL_RIGHT_HELD) armed = 1;
      if (left === TUTORIAL_LEFT_HELD) armed += 1;
      if (right === ZNONOOPA_RIGHT_HELD) armed += 1;
      if (left === ZNONOOPA_LEFT_HELD) armed += 1;
      if (armed === 0) obj.condition = 0;
      break;
    default:
      break;
  }
  // `0x00454371`: `TEST AL, 0x40` on `obj+0x136C`, `CMP [ESI+0x130C], EDI`
  // with `EDI` still 0, then `MOVSX EDX, byte ptr [ESI+0x1318]` tested
  // against `1 << [0x004C4D1D]` and `1 << [0x004C4D20]` -- entries 5 and 8
  // of `g_bone_damage_zone`, each shift masked to five bits as `SHL` masks.
  if ((obj.flags2 & SPENT_ON_EMPTY_LATCH) === 0 || obj.condition !== 0) return;
  const zr = T.chars?.bone_zones?.[HAND_RIGHT];
  const zl = T.chars?.bone_zones?.[HAND_LEFT];
  if (zr === undefined || zl === undefined) return;   // no table, no bits
  const zones = (obj.zones << 24) >> 24;
  if ((zones & (1 << (zr & 0x1f))) === 0
      || (zones & (1 << (zl & 0x1f))) === 0) return;
  obj.flags2 &= ~SPENT_ON_EMPTY_LATCH;
  obj.condition = SPENT_CONDITION;
}

/**
 * `ActorBodyConditionFromHands` — `FUN_00455920`.
 *
 * Counts the hands that still hold their original draw slot, writes that count
 * straight into `obj+0x130C`, and sets the destroyed-zone bit for each hand
 * that does not. `ZombieStateHoldAtRange` is its only caller, so the condition
 * is refreshed exactly once per frame an actor spends at the ring — and never
 * while it is walking in. That is why a body-condition-8 walker can still
 * throw on the way and cannot once it has arrived: `ZombieShouldStandAndThrow`
 * (`FUN_00458E10`) wants condition 8 and this is what takes it away.
 *
 * Two guards, and both are load-bearing:
 *
 * * **conditions 7 and 5 are sticky.** 7 is the stationary thrower's own row
 *   and 5 is what it leaves behind; neither is derived from the hands, so
 *   neither may be overwritten by them.
 * * **character type 1 only ever falls to 0.** `znassb` has no 1-or-2 row, so
 *   the routine writes nothing until both hands are empty.
 */
export function ActorBodyConditionFromHands(obj: Actor): void {
  const ct = obj.charType;

  if (ct === CHAR_ZNASSB) {
    let armed = 0;
    if (DrawRecordSlot(obj, 5) === ZNASSB_RIGHT_HELD) armed += 1;
    if (DrawRecordSlot(obj, 8) === ZNASSB_LEFT_HELD) armed += 1;
    if (armed === 0) obj.condition = 0;
    return;
  }
  if (ct < CHAR_TUTORIAL || ct > CHAR_ZNONOOPA) return;
  if (obj.condition === STAND_THROW_CONDITION
      || obj.condition === SPENT_CONDITION) return;

  const right = DrawRecordSlot(obj, 5);
  let armed = 0;
  if (right === TUTORIAL_RIGHT_HELD || right === ZNONOOPA_RIGHT_HELD) armed += 1;
  else obj.zones |= DamageZone.RightArm;

  // **The engine reads the wrong operand here, and it shows.** At `0x0045599C`
  // the second test is `CMP EDI,0x1EF5`, and `EDI` still holds `[EAX+0x4DC]` —
  // the *right* hand's slot. `[EAX+0x68C]` is compared only against
  // `tutorial.bin`'s `0x1ECA`. A `znonoopa`'s left hand can therefore never
  // count as armed: its right hand reads `0x1EF9` or `0x1EF6` and neither is
  // `0x1EF5`. So every `znonoopa` that reaches the ring lands on condition 1
  // with `DamageZone.LeftArm` already set, which puts its attack pick in row
  // 40..49 — ten copies of attack 0, the right-arm swing. That is the shipped
  // behaviour and the port keeps it. `[proved]`
  if (DrawRecordSlot(obj, 8) === TUTORIAL_LEFT_HELD
      || right === ZNONOOPA_LEFT_HELD) armed += 1;
  else obj.zones |= DamageZone.LeftArm;

  obj.condition = armed;

  if ((obj.flags2 & SPENT_ON_EMPTY_LATCH) !== 0 && obj.condition === 0) {
    obj.condition = SPENT_CONDITION;
    obj.flags2 &= ~SPENT_ON_EMPTY_LATCH;
  }
}
