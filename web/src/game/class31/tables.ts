/**
 * Class 0x31's data, and the one thing about it worth knowing up front.
 *
 * Every table here is indexed by `obj+0x130C` — the **behaviour set**, which
 * `EnemyThrowerInit` (`FUN_00449620`) takes straight from the spawn
 * descriptor's byte +1. It is *not* the body condition: the routine that
 * derives one from the hands, `ActorBodyConditionFromHands` (`FUN_00455920`),
 * has exactly one caller and it is class 0x30's state 2. Set 0 is the only one
 * whose picks contain the wall and ceiling leaps, and across the six stages it
 * is taken by fourteen `zstin` spawns **and four `zslman` ones** — the same
 * character type that stands and throws under set 3. So the wall-crawler is a
 * property of the descriptor, not of the model.
 *
 * The port stores that byte in `Actor.condition`, which is the same offset.
 */
import type {
  ArcStage, AttackJson, Class31Attack, Class31Set,
} from "../../bundle/characters";
import { ThrowerFlag, ThrowerStance, type Actor, type ThrowerActor }
  from "../actor";
import { T } from "../tables";
import { InstallArcMotionScript } from "./arc";
import { ThrowerMotion } from "./states";

/** The set this actor fights with. */
export function Class31SetOf(a: Actor): Class31Set | null {
  const sets = T.chars?.class31?.sets;
  if (!sets?.length) return null;
  return sets[a.condition] ?? sets[0] ?? null;
}

/** `g_class31_motion_sets[set][which]`. */
export function ThrowerMotionOf(a: Actor, which: ThrowerMotion):
    number | undefined {
  const m = Class31SetOf(a)?.motions?.[which];
  return m !== undefined && m > 0 ? m : undefined;
}

/**
 * The stance row: which surface the actor is on, plus four while it is
 * mid-pounce. `ThrowerLoadAttackArcScript` (`FUN_0044B610`) computes it as
 * `bit6 + 2*(bit7 + 2*bit17) + 3*bit8`, which is the four surfaces and then
 * the four surfaces again.
 */
export function ThrowerStanceOf(a: Actor): number {
  const f = a.flags2;
  return (f & ThrowerFlag.WallA ? ThrowerStance.WallA : 0)
       + (f & ThrowerFlag.WallB ? ThrowerStance.WallB : 0)
       + (f & ThrowerFlag.Ceiling ? ThrowerStance.Ceiling : 0)
       + (f & ThrowerFlag.Pouncing ? ThrowerStance.Pounce : 0);
}

/** `g_class31_melee_attacks[set][stance][index]`. */
export function ThrowerAttackOf(a: Actor, stance: number, index: number):
    Class31Attack | null {
  return Class31SetOf(a)?.attacks?.[String(stance)]?.[String(index)] ?? null;
}

/**
 * `g_class31_attack_picks` — which attack index to swing, by destroyed zones.
 *
 * `picks[(rand()/16 % 10) + (obj+0x1318 & 7) * 10]`: intact is a coin flip
 * between the two hands, one arm gone forces the other, both gone gives the
 * head-butt slot.
 */
export function ThrowerPickAttack(a: Actor, roll: number,
                                  set: Class31Set | null = Class31SetOf(a)):
    number {
  const picks = set?.attack_picks ?? [];
  if (!picks.length) return 0;
  return picks[(roll % 10) + (a.zones & 7) * 10] ?? 0;
}

/**
 * `g_class31_throws[obj+0x130C] + (s8)obj+0x131A * 0x10` (`0x00592A00`) --
 * the row `ThrowerStateCloseAndStrike`, `ThrowerStateStrikeOnTheSpot` and
 * `ThrowerStrikeConnect`'s throw-table arm read, `{s16 strike; s16 lunge;
 * f32 distance; s16 hit frame; s16 overlay; u16 cancel mask}`.
 *
 * `[port-only]` The engine reads the row whatever it holds; the bundle omits
 * an entry whose strike clip is not positive (`hod2lib/class31.ts`), and this
 * hands back the zero row in its place. That is the row the engine reads for
 * every index a state can draw: the picks give sets 0, 1 and 3 the indices 0,
 * 1 and 3 and set 2 the indices 4, 5 and 6 (state 24's `zskamere` draws set
 * 0's, 0, 1 and 3), and the only one of those the bundle omits is row A's
 * entry 3, which is sixteen zero bytes at `0x00564848`. `[proved]` from the
 * image. The one omitted row that is **not** zero -- row A's entry 5, a zero
 * strike clip over `{0x11F, 15.0, 48, 6, 4}` at `0x00564868` -- is not drawn
 * by any set's picks.
 */
export function ThrowerThrowEntryOf(a: Actor, index: number): AttackJson {
  return Class31SetOf(a)?.strikes?.[String(index)] ?? ZERO_THROW_ENTRY;
}

/** Sixteen zero bytes, read as a `g_class31_throws` row. */
const ZERO_THROW_ENTRY: AttackJson = Object.freeze({
  strike: 0, lunge: 0, distance: 0, hit_frame: 0, overlay_kind: 0,
  cancel_mask: 0,
});

/**
 * `g_class31_action_picks[set][band]` — the actor's whole repertoire, as
 * candidate state ids. `ThrowerPickNextState` draws one and offers it to
 * `ThrowerTryEnterState`, which refuses the ones it cannot do right now.
 */
export function ThrowerPickState(a: Actor, band: number,
                                 roll: number): number | undefined {
  const row = Class31SetOf(a)?.state_picks?.[String(band)] ?? [];
  if (!row.length) return undefined;
  return row[(roll % 10) + (a.zones & 7) * 10];
}

/**
 * `ThrowerLoadAttackArcScript` — `FUN_0044B610`. Install the arc motion script
 * of the attack the actor has drawn, against the stance it is in.
 *
 * **It latches nothing.** The stance is computed and used for the one lookup;
 * `obj+0x1364`, which `ThrowerStrikeConnect` (`FUN_0044CE60`) reads its hit
 * frame through, is not written here. `[proved]`: the only store to
 * `[reg + 0x1364]` on a thrower anywhere in the image is
 * `ThrowerStateLeapDown`'s at `0x0044B6FB`. The others in class 0x31's range
 * write other objects -- `SpawnThrownWeapon`'s three (`0x0045055F`,
 * `0x00450591`, `0x004505F9`) go through `ESI`, the projectile whose `+0x13F0`
 * takes the weapon model while `EDI`'s hand slots are cleared, and
 * `FUN_00450930`'s through the object it has just allocated. This used to
 * write it, which made states 22 and 23 connect on the pounce row's hit frame
 * where the engine connects on whatever row the last leap down latched.
 */
export function ThrowerLoadAttackArcScript(obj: ThrowerActor): void {
  InstallArcMotionScript(obj,
    ThrowerAttackOf(obj, ThrowerStanceOf(obj), obj.attack)?.script ?? null);
}

/** One of the arc scripts a *state* names rather than an attack entry. */
export function ThrowerArcScript(name: string): ArcStage[] | null {
  return T.chars?.class31?.scripts?.[name] ?? null;
}
