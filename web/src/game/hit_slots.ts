/**
 * The fourteen-slot table every skinned actor claims a place in.
 *
 * `globals.ts` recorded this as *"❌ the port has no `obj+0x3C` slot index and
 * never claims one"*, and for a long time nothing needed it. Something does
 * now: `ZombieDrawBonePart` (`FUN_004534A0`) uses `obj+0x3C` as the **phase**
 * of every cel animation a class-0x30 bone plays — `g_blink_frame_counter +
 * obj+0x3C * 10` — so a crowd of `char_adv02` runs the same thirty-frame
 * lower-torso flipbook ten frames apart instead of pulsing in lockstep. With
 * no slot index there is no phase, and the alternative to porting fourteen
 * lines was a divergence.
 *
 * What is ported here is the **claim and the release**, which is all the
 * engine does with the table outside the shot path: nothing in this port reads
 * `g_hit_slots` as a list of anything, and the fourteen entries are not
 * otherwise consulted. Naming it `g_hit_slots` is the annotation's reading and
 * not this file's; what `[proved]` here is only which actor holds which index.
 */
import type { Actor } from "./actor";
import { G, HIT_SLOT_COUNT, HIT_SLOT_NONE } from "./globals";
import { SpawnClass } from "./spawn_class";

/**
 * `obj+0x38` bit the claim raises, and the one `ActorDespawn` reads back.
 *
 * `HIT_SLOT_COUNT` and `HIT_SLOT_NONE` are in `globals.ts` beside the table
 * itself, because the scene reset needs them and this module imports `G`.
 */
export const HIT_SLOT_CLAIMED = 0x40;

/**
 * The classes whose `Init` is a **proved caller** of `ActorBuildSkinnedModel`
 * (`FUN_00410440`), which is where the claim happens.
 *
 * That routine has 35 callers and the shape of the list is unmistakable —
 * every `Init` that builds a skinned character is one of them. These eleven
 * are the ones this port implements *and* has an address for:
 *
 * | class | `Init` |
 * |---|---|
 * | `0x10` | `CivilianInit` (`FUN_0048A3E0`) |
 * | `0x11` | `FrogInit` (`FUN_0043A080`) |
 * | `0x14` | `Class14Init` (`FUN_00475E90`) |
 * | `0x19` | `Boss4Init` (`FUN_004917E0`) |
 * | `0x20` | `OneHitTargetInit` (`FUN_00448ED0`) |
 * | `0x21` | `RescueTargetInit` (`FUN_00451720`) |
 * | `0x24` | `SetPiecePropInit` (`FUN_00482CE0`) |
 * | `0x25` | `ScriptedHumanoidInit` (`FUN_004840D0`) |
 * | `0x30` | `EnemyZombieInit` (`FUN_00452DA0`) |
 * | `0x31` | `EnemyThrowerInit` (`FUN_00449620`) |
 * | `0x53` | `CatInit` (`FUN_00431250`) |
 *
 * `[open]` Three more of the port's classes hold a slot by a route not read
 * here and therefore do not claim one: class 0x33 reaches
 * `ActorClaimHitSlot` directly from `FUN_00432FF0`, and class 0x51's
 * `FishStateFallBack` and class 0x43's routines clear an entry, so something
 * must have given them one. Until those call sites are read the port leaves
 * them at `-1`, which is what the engine leaves an actor that finds the table
 * full — so the *shape* is one the engine reaches, and the consequence is
 * only that a cel phase differs. Guessing a claim site to make the numbers
 * line up is the thing this list exists to avoid.
 */
export const HIT_SLOT_CLAIMING_CLASSES: ReadonlySet<SpawnClass> = new Set([
  SpawnClass.Civilian, SpawnClass.Frog, SpawnClass.Boss2, SpawnClass.Boss4,
  SpawnClass.OneHitTarget, SpawnClass.RankScaledEnemy,
  SpawnClass.SetPieceProp, SpawnClass.ScriptedHumanoid, SpawnClass.Zombie,
  SpawnClass.Thrower, SpawnClass.SkinnedNpc,
]);

/**
 * `ActorClaimHitSlot` — `FUN_00409270`. Take the first free slot, or none.
 *
 * ```c
 * obj+0x3C = -1;
 * for (i = 0; i < 14; i++) {
 *     if (g_hit_slots[i] == 0) {
 *         obj+0x38 |= 0x40;
 *         g_hit_slots[i] = obj;
 *         obj+0x3C = i;
 *         return;
 *     }
 * }
 * ```
 *
 * **It can fail**, and the engine does nothing about it: with all fourteen
 * taken the actor keeps `-1` and neither the flag nor a slot. That matters
 * downstream — `BoneCelSeed` multiplies `-1` by ten and the cel index goes
 * negative — so the port keeps the `-1` rather than substituting a zero.
 *
 * Called from seven places directly, and from `ActorBuildSkinnedModel`
 * (`FUN_00410440`) — which is the one that reaches every skinned actor, and
 * which 35 class `Init`s call. The port has no model build, so `ActorSpawn`
 * runs this immediately before the class's `Init`, for the classes in
 * {@link HIT_SLOT_CLAIMING_CLASSES} and no others.
 */
export function ActorClaimHitSlot(obj: Actor): void {
  obj.hitSlot = HIT_SLOT_NONE;
  for (let i = 0; i < HIT_SLOT_COUNT; i++) {
    if (G.g_hit_slots[i] !== HIT_SLOT_NONE) continue;
    obj.flags38 |= HIT_SLOT_CLAIMED;
    G.g_hit_slots[i] = obj.at;
    obj.hitSlot = i;
    return;
  }
}

/**
 * The release, which is three lines inside `ActorDespawn` (`FUN_00409CC0`)
 * rather than a routine of its own:
 *
 * ```c
 * if ((obj+0x38 & 0x40) && obj+0x3C != -1) { g_hit_slots[obj+0x3C] = 0;
 *                                            obj+0x3C = -1; }
 * ```
 *
 * The flag **and** the index are both tested, and the port tests both: an
 * actor that never claimed has neither, and one whose slot was already given
 * back must not clear a slot another actor now holds.
 *
 * [port-only] The engine stores the actor pointer; the port stores its `at`,
 * for the same reason `g_carrier_object` does — a snapshot carries an index
 * and cannot carry a pointer. Two actors never share an `at` within one life
 * of the pool, which is what makes the substitution exact.
 */
export function ActorReleaseHitSlot(obj: Actor): void {
  if ((obj.flags38 & HIT_SLOT_CLAIMED) === 0) return;
  if (obj.hitSlot === HIT_SLOT_NONE) return;
  G.g_hit_slots[obj.hitSlot] = HIT_SLOT_NONE;
  obj.hitSlot = HIT_SLOT_NONE;
}
