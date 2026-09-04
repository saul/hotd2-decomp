/**
 * Body condition, recomputed from what is still in the hands.
 *
 * `obj+0x130C` is the **row selector** for three tables at once —
 * `g_class30_attacks[char_type][condition]`, its pick table, and the motion
 * row — so it decides both what a zombie swings and how far away it swings
 * from. A spawn descriptor names the starting value; from then on it is a
 * function of the hands, and `ActorBodyConditionFromHands` is the only routine
 * in the binary that writes it that way.
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
import { DamageZone, type Actor } from "../actor";
import { CharacterTypeOf } from "../tables";
import { STAND_THROW_CONDITION } from "./stand_throw";

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
 * `obj+0x136C` bit `0x40`. `[open]` — the only writer of it in the whole
 * binary is `ThrowerStateLeapToSurface` at `0x0044C29B`, which is class 0x31,
 * and no class-0x31 character type reaches this routine. Transcribed rather
 * than dropped: a bit nothing sets today is still the engine's shape.
 */
const SPENT_ON_EMPTY_LATCH = 0x40;

/**
 * What is drawn on a bone right now: `obj+0x20C + bone * 0x90`.
 *
 * The port's `boneSlot` is sparse — a bone nothing has swapped is absent —
 * where the engine's field is initialised from the skeleton. An absent entry
 * therefore reads as the slot the character type says the hand started with,
 * which is the same number the engine would find there.
 */
function BoneDrawSlot(obj: Actor, bone: number): number {
  const cur = obj.boneSlot[String(bone)];
  if (cur !== undefined) return cur;
  return CharacterTypeOf(obj)?.zombie_throw?.hands
    .find((h) => h.bone === bone)?.held ?? 0;
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
    if (BoneDrawSlot(obj, 5) === ZNASSB_RIGHT_HELD) armed += 1;
    if (BoneDrawSlot(obj, 8) === ZNASSB_LEFT_HELD) armed += 1;
    if (armed === 0) obj.condition = 0;
    return;
  }
  if (ct < CHAR_TUTORIAL || ct > CHAR_ZNONOOPA) return;
  if (obj.condition === STAND_THROW_CONDITION
      || obj.condition === SPENT_CONDITION) return;

  const right = BoneDrawSlot(obj, 5);
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
  if (BoneDrawSlot(obj, 8) === TUTORIAL_LEFT_HELD
      || right === ZNONOOPA_LEFT_HELD) armed += 1;
  else obj.zones |= DamageZone.LeftArm;

  obj.condition = armed;

  if ((obj.flags2 & SPENT_ON_EMPTY_LATCH) !== 0 && obj.condition === 0) {
    obj.condition = SPENT_CONDITION;
    obj.flags2 &= ~SPENT_ON_EMPTY_LATCH;
  }
}
