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
 * | `Boss4AdvanceMotionAndDrawHeldProps` (`FUN_00492620`) | 0x19 |
 * | `OneHitTargetUpdate` and its three states (`FUN_00449020`..) | 0x20 |
 * | `Class22DrawAndPoseSubActor` (`FUN_0049D770`) | 0x22, and its sub-actor |
 * | `Class23Draw` (`FUN_004916D0`) | 0x23 |
 * | `SetPiecePropDrawAndTick` (`FUN_004834F0`) | 0x24 |
 * | `ScriptedHumanoidDraw` (`FUN_00484FF0`) | 0x25 |
 * | `HordeMemberUpdate` (`FUN_0043C440`), `HordeDeformedPropUpdate` (`FUN_0043F010`) | 0x40, members and the rug |
 * | `WormUpdate` (`FUN_0042FCA0`), `0x00430135`..`0x00430A66` -- **the live member's draw only** | 0x42 |
 * | `OwlCorpseFallAndSettle` (`FUN_00448210`) -- **the corpse only** | 0x43 |
 * | `BatDiveUpdate`, `BatScatterUpdate`, `BatSwarmUpdate` | 0x46 |
 * | `FishDraw` (`FUN_00439860`), `FishSwimAwayTick` (`FUN_00439C20`) | 0x51 |
 * | `CatBranchTriggerUpdate` (`FUN_00431430`) and `CatMotionListUpdate` (`FUN_00431340`) | 0x53 |
 * | `ResultCardFigureUpdate` (`FUN_00435760`) | 0x61's figures, not the card |
 * | `Class32DrawAndAdvance` (`FUN_0047FE40`) | 0x32, the boss; not its projectiles or tasks |
 *
 * Also callers, and not actors this module can answer for:
 * `BodyCreatureUpdate` (`FUN_0043E880`, `znjoe`'s released creatures, a pool of
 * their own), `ScorePickupUpdate` (`FUN_004724A0`, a class-0x41 pickup) and
 * `LoneHordeMemberUpdate47` (`FUN_0043D800`, class 0x47, which no shipped
 * descriptor places and the port does not have).
 * `[open]` The remaining callers are unnamed routines
 * (`FUN_004021D0`, `FUN_00415120`, `FUN_00420550`, `FUN_00420820`,
 * `FUN_00423050`, `FUN_004231C0`,
 * `FUN_004729E0`, `FUN_00483A40`, `FUN_00483B40`,
 * `FUN_00483CE0`, `FUN_0049A210`,
 * `FUN_0049A470`, `FUN_0049A680`, `FUN_0049A7F0`, `FUN_0049AFB0`); which
 * classes they draw has not been read, so no class is listed for them.
 */
import type { Actor } from "./actor";
import { G } from "./globals";
import {
  BuildSceneLightDirection, CH_AMBIENT, CH_LIGHT_R, CHANNEL_COUNT,
  LightTweenStep, type LightBlock, type LightSetRecord,
} from "./light_block";
import { SetRenderLightColour } from "./screen_sprite";
import { SpawnClass } from "./spawn_class";
import { vec3, type Vec3 } from "./vec";
import { OwlState } from "./class43/state";
import { ResultCardRoutine } from "./class61/state";
import { Class32Routine } from "./class32/state";
import { WormBodyDraw } from "./class42/state";

/** The classes whose every draw is under block 1. */
const SECONDARY_LIGHT_CLASSES: ReadonlySet<SpawnClass> = new Set([
  SpawnClass.Civilian, SpawnClass.Frog, SpawnClass.Boss2, SpawnClass.Boss4,
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
  // The stage-5 boss makes the call in its draw; its projectiles set their
  // own light colour and make neither call.
  if (obj.cls === SpawnClass.Boss5) {
    return obj.boss5.routine === Class32Routine.Boss;
  }
  // The result card's figures make the call; the card draws no model.
  if (obj.cls === SpawnClass.ResultCard) {
    return obj.card.routine !== ResultCardRoutine.Card;
  }
  // The owl's live update does not make the call; `OwlCorpseFallAndSettle`,
  // the update it is swapped for on death, does.
  // The worm's member routine brackets its body and shadow with the pair;
  // its death routine and the lone drop make neither call. Which of them drew
  // this frame is on the tail, and on the kill frame it is the member's.
  if (obj.cls === SpawnClass.Worm) {
    return obj.worm.drawnBody === WormBodyDraw.Member;
  }
  return obj.cls === SpawnClass.FlyingEnemy && obj.owl.state === OwlState.Dead;
}

/**
 * `SetRenderAmbient` — `FUN_004AA070`. `g_render_ambient = a`, and the light
 * generation up one so the next queued draw re-installs the light.
 */
export function SetRenderAmbient(a: number): void {
  G.g_render_ambient = a;
}

/**
 * `SetRenderLightDirection` — `FUN_004AA0E0`. `g_render_light_dir = -v`,
 * and the generation up one. The engine's `v` is the view-space vector
 * `BuildSceneLightDirection` built; the port hands in the world one it built
 * beside it and keeps it un-negated (see `G.g_render_light_dir`).
 */
export function SetRenderLightDirection(v: Vec3): void {
  G.g_render_light_dir = vec3(v.x, v.y, v.z);
}

/** The colour words of a block, `+0x240`..`+0x248`. */
function BlockColour(b: LightBlock): [number, number, number] {
  const c = b.channels;
  return [c[CH_LIGHT_R], c[CH_LIGHT_R + 1], c[CH_LIGHT_R + 2]];
}

/**
 * `LightsUseSecondarySet` — `FUN_0041DC70`.
 *
 * ```
 * SetRenderAmbient(block1+0x24C)
 * BuildSceneLightDirection(block1+0x18, block1+0x1C, &block1, &block1+0x0C)
 * SetRenderLightDirection(&block1+0x0C)
 * SetRenderLightColour(block1+0x240, +0x244, +0x248)
 * ```
 *
 * The direction is built from block 1's angles **as they stand at the
 * call**: class 0x32 re-aims the block during its own draw, after this has
 * installed it (`Class32DrawNodeSlot`).
 */
export function LightsUseSecondarySet(): void {
  const b = G.g_scene_light_block1;
  SetRenderAmbient(b.channels[CH_AMBIENT]);
  BuildSceneLightDirection(b.pitch, b.yaw, b.dir);
  SetRenderLightDirection(b.dir);
  const [r, g, bl] = BlockColour(b);
  SetRenderLightColour(r, g, bl);
}

/**
 * `LightsRestoreScene` — `FUN_0041DCC0`.
 *
 * ```
 * SetRenderAmbient(g_scene_light_ambient)
 * SetRenderLightDirection(&g_scene_light_dir_view)
 * SetRenderLightColour(g_scene_light_colour_r, g, b)
 * ```
 *
 * No build: `g_scene_light_dir_view` is the vector the last
 * `BuildSceneLightDirection` of block 0 left, beside the world one at
 * `+0x00` that the port keeps.
 */
export function LightsRestoreScene(): void {
  const b = G.g_scene_light_block0;
  SetRenderAmbient(b.channels[CH_AMBIENT]);
  SetRenderLightDirection(b.dir);
  const [r, g, bl] = BlockColour(b);
  SetRenderLightColour(r, g, bl);
}

const _dir = vec3();

/**
 * `LightsUseCustomSet` — `FUN_0041DC10`, `(ambient, pitch, yaw, r, g, b)`.
 *
 * ```
 * SetRenderAmbient(ambient)
 * BuildSceneLightDirection(pitch, yaw, &local_world, &local_view)
 * SetRenderLightDirection(&local_view)
 * SetRenderLightColour(r, g, b)
 * ```
 *
 * `[proved]`. The routine returns nothing; the port also hands back the set
 * it installed, which every draw the caller makes before its
 * `LightsRestoreScene` carries to the renderer.
 */
export function LightsUseCustomSet(ambient: number, pitch: number,
                                   yaw: number, r: number, g: number,
                                   b: number): LightSetRecord {
  SetRenderAmbient(ambient);
  BuildSceneLightDirection(pitch, yaw, _dir);
  SetRenderLightDirection(_dir);
  SetRenderLightColour(r, g, b);
  return RenderLightSet();
}

/**
 * `[port-only]` The light the next draw is made under: the three device
 * words as they stand. A draw that sets no light of its own is made under
 * this, whatever set it.
 */
export function RenderLightSet(): LightSetRecord {
  const d = G.g_render_light_dir;
  const c = G.g_render_light_colour;
  return { ambient: G.g_render_ambient, dir: [d.x, d.y, d.z],
           rgb: [c[0], c[1], c[2]] };
}

/**
 * `PushSceneLightStateToDevice` — `FUN_0040AD90`. The second task of every
 * scene's list: `SceneLightTaskCreate` (`FUN_0040AE60`) allocates it, called
 * at `0x00460715`, just after the interpreter's, so it runs after the script
 * each frame and a tween the script arms steps on the frame it is armed.
 *
 * ```
 * LightTweenStepFogNear(0) .. LightTweenStepAmbient(0)   ; block 0's nine
 * LightTweenStepFogNear(1) .. LightTweenStepAmbient(1)   ; block 1's
 * PushSceneFogFromLightBlock(...)
 * SetRenderLightColour(g_scene_light_colour_r, g, b)
 * SetRenderAmbient(g_scene_light_ambient)
 * ```
 *
 * Each of the eighteen setters is `LightTweenStep` on one slot. The fog push
 * is the renderer's (`render/fog.ts` reads block 0). `SceneTaskWalk` calls
 * it with the game phase's `frames`.
 */
export function PushSceneLightStateToDevice(frames: number): void {
  const pairs = [[G.g_scene_light_block0, G.g_light_tween_block0],
                 [G.g_scene_light_block1, G.g_light_tween_block1]] as const;
  for (const [b, t] of pairs) {
    for (let c = 0; c < CHANNEL_COUNT; c++) LightTweenStep(b, t, c, frames);
  }
  const [r, g, b] = BlockColour(G.g_scene_light_block0);
  SetRenderLightColour(r, g, b);
  SetRenderAmbient(G.g_scene_light_block0.channels[CH_AMBIENT]);
}
