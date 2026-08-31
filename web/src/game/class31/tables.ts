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
import type { ArcStage, Class31Attack, Class31Set } from "../../bundle/characters";
import { ThrowerFlag, ThrowerStance, type Actor } from "../actor";
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
export function ThrowerPickAttack(a: Actor, roll: number): number {
  const picks = Class31SetOf(a)?.attack_picks ?? [];
  if (!picks.length) return 0;
  return picks[(roll % 10) + (a.zones & 7) * 10] ?? 0;
}

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
 */
export function ThrowerLoadAttackArcScript(obj: Actor): void {
  obj.stance = ThrowerStanceOf(obj);
  InstallArcMotionScript(obj,
    ThrowerAttackOf(obj, obj.stance, obj.attack)?.script ?? null);
}

/** One of the arc scripts a *state* names rather than an attack entry. */
export function ThrowerArcScript(name: string): ArcStage[] | null {
  return T.chars?.class31?.scripts?.[name] ?? null;
}
