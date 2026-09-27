/**
 * Which light set an actor is drawn under.
 *
 * `LightsUseSecondarySet` (`FUN_0041DC70`) installs light block 1's ambient,
 * direction and colour -- `SetRenderAmbient(block1+0x24C)`,
 * `BuildSceneLightDirection(block1 pitch, yaw)`, `SetRenderLightColour
 * (block1+0x240..0x248)` -- and `LightsRestoreScene` (`FUN_0041DCC0`) puts
 * block 0's back. `RenderEnqueueCommand` (`FUN_004A7E50`) re-installs the
 * device light whenever one of those marks it dirty, so every opaque draw
 * between the two is lit by block 1. `[proved]`
 *
 * Forty-four routines make the pair of calls, all unconditionally. The ones
 * that are a class's draw path, and so decide it here:
 *
 * | caller | class |
 * |---|---|
 * | `ZombieAdvanceMotion` (`FUN_00454860`), first instruction | 0x30, and 0x18 which runs it |
 * | `ThrowerAdvanceMotion` (`FUN_00449EF0`), first instruction | 0x31 |
 * | `CivilianUpdate` (`FUN_0048A920`) | 0x10 |
 * | `FrogDrawAndCycleBone2Slot` (`FUN_0043A440`) | 0x11 |
 * | `Class14AdvanceMotionAndPublishPoints` (`FUN_00476AD0`) | 0x14 |
 * | `OneHitTargetUpdate` and its three states (`FUN_00449020`..) | 0x20 |
 * | `Class22DrawAndPoseSubActor` (`FUN_0049D770`) | 0x22, and its sub-actor |
 * | `Class23Draw` (`FUN_004916D0`) | 0x23 |
 * | `SetPiecePropDrawAndTick` (`FUN_004834F0`) | 0x24 |
 * | `ScriptedHumanoidDraw` (`FUN_00484FF0`) | 0x25 |
 * | `HordeMemberUpdate` (`FUN_0043C440`), `HordeDeformedPropUpdate` (`FUN_0043F010`) | 0x40, members and the rug |
 * | `OwlCorpseFallAndSettle` (`FUN_00448210`) -- **the corpse only** | 0x43 |
 * | `BatDiveUpdate`, `BatScatterUpdate`, `BatSwarmUpdate` | 0x46 |
 * | `FishDraw` (`FUN_00439860`), `FishSwimAwayTick` (`FUN_00439C20`) | 0x51 |
 * | `CatBranchTriggerUpdate` (`FUN_00431430`) and `FUN_00431340`, the other cat | 0x53 |
 *
 * Also callers, and not actors this module can answer for:
 * `BodyCreatureUpdate` (`FUN_0043E880`, `znjoe`'s released creatures, a pool of
 * their own) and `ScorePickupUpdate` (`FUN_004724A0`, a class-0x41 pickup).
 * `[open]` The remaining callers are unnamed routines
 * (`FUN_004021D0`, `FUN_00415120`, `FUN_00420550`, `FUN_00420820`,
 * `FUN_00423050`, `FUN_004231C0`, `FUN_00435760`, `FUN_0043D800`,
 * `FUN_004729E0`, `FUN_0047FE40`, `FUN_00483A40`, `FUN_00483B40`,
 * `FUN_00483CE0`, `FUN_00492620`, `FUN_0049A210`,
 * `FUN_0049A470`, `FUN_0049A680`, `FUN_0049A7F0`, `FUN_0049AFB0`); which
 * classes they draw has not been read, so no class is listed for them.
 */
import type { Actor } from "./actor";
import { SpawnClass } from "./spawn_class";
import { OwlState } from "./class43/state";

/** The classes whose every draw is under block 1. */
const SECONDARY_LIGHT_CLASSES: ReadonlySet<SpawnClass> = new Set([
  SpawnClass.Civilian, SpawnClass.Frog, SpawnClass.Boss2,
  SpawnClass.CarriedZombie, SpawnClass.OneHitTarget, SpawnClass.Judgment,
  SpawnClass.JudgmentCompanion,
  SpawnClass.SetPieceProp, SpawnClass.ScriptedHumanoid, SpawnClass.Zombie,
  SpawnClass.Thrower, SpawnClass.HordeSpawner, SpawnClass.Bat,
  SpawnClass.WaterEnemy, SpawnClass.SkinnedNpc,
]);

/**
 * Is this actor drawn between `LightsUseSecondarySet` and
 * `LightsRestoreScene`? See the table above.
 *
 * [port-only] as a function: the engine makes the two calls inside each
 * routine; the port asks once, per actor, from the render side.
 */
export function ActorDrawsUnderSecondaryLights(obj: Actor): boolean {
  if (SECONDARY_LIGHT_CLASSES.has(obj.cls)) return true;
  // The owl's live update does not make the call; `OwlCorpseFallAndSettle`,
  // the update it is swapped for on death, does.
  return obj.cls === SpawnClass.FlyingEnemy && obj.owl.state === OwlState.Dead;
}
