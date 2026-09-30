import type { BreakablePlacement } from "../../src/bundle";
import { Rng } from "../../src/core/rng";
import { Events } from "../../src/core/events";
import { ActorSpawn, GameUpdate } from "../../src/game/director";
import { CheckpointResetCamera } from "../../src/game/camera/actions";
import { G, ResetGameGlobals } from "../../src/game/globals";
import { NULL_HOST } from "../../src/game/host";
import {
  MatIdentity, MatrixRotateX, MatrixRotateY, MatrixRotateZ, MatrixTranslate,
} from "../../src/game/matrix";
import { SetGameTables, T } from "../../src/game/tables";
import { SpawnClass } from "../../src/game/spawn_class";
import { GameMode } from "../../src/game/game_mode";
import {
  BreakableState, BreakableFlag, BreakablePropTakeShot, BreakablePropUpdate,
  BreakableSlot, GrantExtraLife, ItemSet, MEMBERS_PER_GROUP,
  PlaceBreakableGroup, PropContainerPlacerUpdate, PlaceKindedProp,
  KindedPropUpdate, PropFamily, KIND_SLOT, SLOT_NONE, PlaceGenericProp,
  LiftFlag, LIFT_PANEL_CLOSED, LIFT_RIDE_DROP, LIFT_HINGE_STEP, SFX_LIFT_PANEL,
  makeBreakableProp, type BreakableProp, WaterSurfaceFlag, WaterSurfacesTick,
  WATER_ARENA_ALT_PAIR_SLOT, WATER_ARENA_ALT_SLOT, WATER_ARENA_PAIR_SLOT,
  WATER_ARENA_SLOT, WATER_CANAL_SLOT, WATER_DEATH_ALT_SLOT,
  WATER_DEATH_CAM_PATH, WATER_DEATH_SLOT, WATER_PHASE_PER_TICK,
  WATER_SURFACE_ALSO_DRAWS, WATER_PAUSE_CAM_FRAME, WATER_PAUSE_CAM_PATH,
  PickOriginalModeItem, SFX_ORIGINAL_ITEM_PICKUP,
} from "../../src/game/class41";
import { BreakablePropPoolUpdate } from "../../src/game/class41/pool";
import {
  BreakablePropSpawnShatter, PropShattersTick,
  SHATTER_GRAVITY, SHATTER_PIECES,
} from "../../src/game/class41/shatter";
import { MsvcRand } from "../../src/game/class41/group";
import {
  EXTRA_LIFE_HEART_SLOT, EXTRA_LIFE_ROUTINE_TYPE, EXTRA_LIFE_STRIP_SLOT,
  EXTRA_LIFE_TAG_SLOT, ExtraLifePickupUpdate,
} from "../../src/game/class41/items";
import {
  FallingContainerGroundContact, FALLING_REMOVE_CAM_FRAME,
  FALLING_REMOVE_CAM_PATH, FALLING_SLOT_FRAGMENT,
} from "../../src/game/class44/container";
import {
  SCRIPT_FLAG_TYPE13_DROP, TYPE13_PANEL_SLOT, Type13Phase,
} from "../../src/game/class41/type13";
import {
  SCRIPT_FLAG_TYPE35_RATTLE, Type35Phase,
} from "../../src/game/class41/type35";
import { TYPE43_PICKUP_SLOT } from "../../src/game/class41/type43";
import {
  PropDrawOnlyType33,
  SCRIPT_FLAG_TYPE54_DRIFT, TYPE31_DESPAWN_CAM_FRAME,
  TYPE31_DESPAWN_CAM_PATH, TYPE54_DRIFT_FRAMES,
  TYPE31_EXTRA_SLOT, TYPE53_STRIP_A_SLOT, TYPE53_STRIP_B_SLOT,
} from "../../src/game/class41/draw_only";
import { SCRIPT_FLAG_TYPE5_REMOVE } from "../../src/game/class41/type05";
import { TYPE10_FIRST_SLOT, TYPE6_FIRST_SLOT } from "../../src/game/class41/type06";
import {
  TYPE12_DESPAWN_CAM_FRAME, TYPE12_DESPAWN_CAM_PATH,
} from "../../src/game/class41/type12";
import { TYPE21_DRAW_LAYER, TYPE21_FIRST_SLOT } from "../../src/game/class41/type21";
import { TYPE63_ITEM_Y } from "../../src/game/class41/type63";
import {
  PropType78LoadSlot, TYPE78_ARCADE_SLOT,
} from "../../src/game/class41/type78";
import { MatrixScale } from "../../src/game/matrix";
import {
  LIFT_CAR_SLOT, LIFT_HINGE_NEAR, LIFT_LEAF_SLOT, LIFT_PANEL_AT,
  LIFT_PANEL_SLOT, PROP_HIT_SCORE,
} from "../../src/game/class41";
import { PropWords } from "../../src/game/class41/words";
import { TYPE13_DROP_SLOT, TYPE13_JUDDER } from "../../src/game/class41/type13";
import {
  TYPE35_LEAF_A, TYPE35_LEAF_A_SLOT, TYPE35_LEAF_B, TYPE35_LEAF_B_SLOT,
} from "../../src/game/class41/type35";
import {
  TYPE43_EFFECT7_SLOT, TYPE43_PICKUP_TAG, TYPE43_WORDS_ZERO, type Type43Words,
} from "../../src/game/class41/type43";
import { SFX_FALLING_KNOCKED } from "../../src/game/class44/container";
import {
  OriginalItemDropPhase, SFX_TYPE07_HIT, TYPE07_SLOT,
} from "../../src/game/class41/type07";
import { SFX_TYPE20_HIT, TYPE20_SLOT } from "../../src/game/class41/type20";
import {
  SFX_TYPE58_HIT, TYPE58_SLOT, Type58Phase,
} from "../../src/game/class41/type58";
import {
  SFX_TYPE60_HIT, TYPE60_SLOT, Type60Phase,
} from "../../src/game/class41/type60";
import {
  FallingContainerUpdate, PlaceFallingContainer, FALLING_SLOT_LOOSE,
  FALLING_SLOT_WHOLE,
} from "../../src/game/class44";
import { SpawnPropContainers } from "../../src/game/director";
import { ProfileBoot } from "../../src/game/profile";
import { clonePlain } from "../../src/core/snapshot";
import {
  check, CHARS, BREAKABLES, ORIGINAL_ITEMS_SCENE2, propScene, shoot,
} from "./harness";

/**
 * Row 0 of scenes 0 and 2, and the records they name, as the EXE has them:
 * what type 7's drop (stage 1) and type 43's break (stage 3) pick from.
 */
const ORIGINAL_ITEMS_SCENE0 = {
  scene: 0,
  rows: { "0": { ids: [3, 4, 16, 17], weights: [6, 7, 13, 14] } },
  records: {
    "3": { slot: 0x10a5, slot2: 0x10a6, scale: 1, sprite: 0x5c0 },
    "4": { slot: 0x10a7, slot2: 0x10a8, scale: 1, sprite: 0x5c1 },
    "16": { slot: 0x108e, slot2: 0x108c, scale: 1, sprite: 0x5ca },
    "17": { slot: 0x108e, slot2: 0x108d, scale: 1, sprite: 0x5cb },
  },
};

console.log("\nclass 0x41, the placer:");
{
  const rng = new Rng(11);
  propScene(rng);
  const placer = ActorSpawn(0x9000, SpawnClass.PropContainerPlacer, 4, "placer");
  placer.visible = true;
  placer.hp = 1;          // +0x11C: the group id
  placer.charType = 4;    // +0x1F4: the lifetime in evt blocks
  placer.condition = 0;   // +0x130C: constructor 0, PlaceBreakableGroup

  PropContainerPlacerUpdate(placer, {
    dt: 1 / 60, rng, host: NULL_HOST,
  });

  check("the placer builds its group", G.g_breakable_props.length === 3,
        `${G.g_breakable_props.length} props`);
  check("the placer kills itself on its first frame", placer.dead);
  check("every prop is registered in g_breakable_members",
        G.g_breakable_props.every(
          (p) => G.g_breakable_members[p.group * MEMBERS_PER_GROUP + p.member]
                 === p.id));
  check("the item countdown is seeded inside [1, n]",
        G.g_item_set_countdown[ItemSet.Score2] >= 1
        && G.g_item_set_countdown[ItemSet.Score2] <= 3,
        String(G.g_item_set_countdown[ItemSet.Score2]));
  check("a prop takes two shots and carries the group's lifetime",
        G.g_breakable_props.every((p) => p.hp === 2 && p.lifetime === 4));
}

console.log("\nclass 0x41 type 1, the canal water task:");
{
  // Stage 2's three tiles and one of stage 3's, as the exporter resolves
  // them: `slot` is `g_water_surface_slots[field_1f4]`.
  const water = (at: number, index: number, slot: number, life: number) =>
    ({ at, container: "water_surface" as const, field_1f4: index, slot,
       lifetime_evt_steps: life });
  const rng = new Rng(7);
  propScene(rng, GameMode.Arcade);
  SetGameTables(CHARS, { ...BREAKABLES, placements: [
    ...(BREAKABLES.placements ?? []),
    water(0x8ae4, 2, WATER_CANAL_SLOT, 15),
    water(0x14940, 0, WATER_ARENA_SLOT, 20),
    water(0x15684, 1, WATER_DEATH_SLOT, 1),
    water(0x237c, 4, 0x13ad, 11),
  ] });
  const f = { dt: 1 / 60, rng, host: NULL_HOST };
  const place = (at: number, index: number, life: number) => {
    const placer = ActorSpawn(at, SpawnClass.PropContainerPlacer, index,
                              "placer");
    placer.visible = true;
    placer.hp = life;           // +0x11C: the lifetime in step changes
    placer.condition = 1;       // +0x130C: PlaceWaterSurface
    PropContainerPlacerUpdate(placer, f);
    return { placer, task: G.g_water_surfaces.find(
      (w) => w.slot === T.breakables!.placements!.find(
        (q) => q.at === at)!.slot) };
  };
  const uvOf = (slot: number) =>
    G.g_water_surface_uv.find((u) => u.slot === slot);
  G.g_scene_index = 1;
  G.g_evt_block_index = 16;
  G.g_evt_step_index = 0;
  G.g_scene_tick_counter = 100;

  const canal = place(0x8ae4, 2, 15);
  check("constructor 1 builds a water task and the placer dies",
        canal.placer.dead && G.g_water_surfaces.length === 1
        && canal.task?.slot === WATER_CANAL_SLOT && canal.task.index === 2
        && canal.task.lifetime === 15 && canal.task.killFlag === 0,
        JSON.stringify(G.g_water_surfaces));
  WaterSurfacesTick();
  const a = (100 * WATER_PHASE_PER_TICK & 0xffff) * (Math.PI * 2 / 65536);
  const u = uvOf(WATER_CANAL_SLOT);
  check("...which draws its tile and ripples it by the tick's phase",
        canal.task!.drawn.join() === String(WATER_CANAL_SLOT)
        && u?.frames === 1 && u.sin === Math.sin(a) && u.cos === Math.cos(a)
        && !u.zLimited, JSON.stringify(u));
  for (let step = 1; step < 0xf; step++) {
    G.g_evt_step_index = step;
    WaterSurfacesTick();
  }
  check("...lives through fourteen step changes",
        G.g_water_surfaces.length === 1 && canal.task!.stepChanges === 14);
  G.g_evt_step_index = 0xf;
  WaterSurfacesTick();
  check("...and 0x13B5 is killed at step 0xF, a change inside its lifetime",
        G.g_water_surfaces.length === 0);
  check("the tile keeps what the walk did to it after the task goes",
        uvOf(WATER_CANAL_SLOT)?.frames === 15);

  G.g_evt_step_index = 10;
  const arena = place(0x14940, 0, 20).task!;
  WaterSurfacesTick();
  check("index 0 draws the arena water and 0x13A5 beside it",
        arena.drawn.join() === [WATER_ARENA_SLOT, WATER_ARENA_PAIR_SLOT].join());
  check("...and does not ripple it until flag 8", !uvOf(WATER_ARENA_SLOT));
  G.g_script_flags[WaterSurfaceFlag.ArenaRipple] = 1;
  WaterSurfacesTick();
  check("...then ripples only the vertices at z <= -1870",
        uvOf(WATER_ARENA_SLOT)?.frames === 1
        && uvOf(WATER_ARENA_SLOT)?.zLimited === true);
  G.g_script_flags[WaterSurfaceFlag.RippleOff] = 1;
  WaterSurfacesTick();
  check("flag 0x6A stops every ripple and not the draw",
        uvOf(WATER_ARENA_SLOT)?.frames === 1 && arena.drawn.length === 2);
  G.g_script_flags[WaterSurfaceFlag.RippleOff] = 0;
  G.g_script_flags[WaterSurfaceFlag.SwapTiles] = 1;
  WaterSurfacesTick();
  check("flag 9 swaps the arena water after this frame's draw",
        arena.slot === WATER_ARENA_ALT_SLOT
        && arena.drawn[0] === WATER_ARENA_SLOT);
  WaterSurfacesTick();
  check("...and the alternate is drawn with its own pair",
        arena.drawn.join()
          === [WATER_ARENA_ALT_SLOT, WATER_ARENA_ALT_PAIR_SLOT].join());
  check("...which the exporter's list of what it can draw covers",
        [WATER_ARENA_PAIR_SLOT, WATER_ARENA_ALT_SLOT, WATER_ARENA_ALT_PAIR_SLOT]
          .every((s) => WATER_SURFACE_ALSO_DRAWS[WATER_ARENA_SLOT]!.includes(s)));

  const death = place(0x15684, 1, 1).task!;
  G.g_active_cam_path = 0x40;
  WaterSurfacesTick();
  check("the death water swaps on flag 9 off camera path 0x6E",
        death.slot === WATER_DEATH_ALT_SLOT && !uvOf(WATER_DEATH_SLOT));
  G.g_active_cam_path = WATER_DEATH_CAM_PATH;
  WaterSurfacesTick();
  check("...and on 0x6E turns back after the draw, in the same frame",
        death.drawn[0] === WATER_DEATH_ALT_SLOT
        && death.slot === WATER_DEATH_SLOT);
  WaterSurfacesTick();
  check("...where flag 9 swaps it and the last line swaps it back again",
        death.slot === WATER_DEATH_SLOT && uvOf(WATER_DEATH_SLOT)?.frames === 1);
  check("a snapshot carries the tasks and the tiles as they are",
        JSON.stringify(clonePlain(G.g_water_surfaces))
          === JSON.stringify(G.g_water_surfaces)
        && JSON.stringify(clonePlain(G.g_water_surface_uv))
          === JSON.stringify(G.g_water_surface_uv));
  G.g_evt_block_index = 0x23;
  G.g_evt_step_index = 2;
  G.g_GameMode = GameMode.Boss;
  WaterSurfacesTick();
  check("in Boss mode none of the kill tests runs",
        G.g_water_surfaces.length === 2);
  G.g_GameMode = GameMode.Arcade;
  WaterSurfacesTick();
  check("on stage 2, block 0x23 step 2 kills every task",
        G.g_water_surfaces.length === 0);

  G.g_scene_index = 2;
  G.g_evt_block_index = 1;
  const st3 = place(0x237c, 4, 11).task!;
  check("on stage 3 the kill flag is the index plus 0x0B", st3.killFlag === 15);
  G.g_script_flags[15] = 1;
  WaterSurfacesTick();
  check("...and raising it kills the task", G.g_water_surfaces.length === 0);
  G.g_script_flags[15] = 0;
  place(0x237c, 4, 11);
  G.g_script_flags[WaterSurfaceFlag.KillAllStage3] = 1;
  WaterSurfacesTick();
  check("...as flag 4 kills every one", G.g_water_surfaces.length === 0);
  G.g_script_flags[WaterSurfaceFlag.KillAllStage3] = 0;
  // `CMP [ECX*4 + 0x9a6110], 0x163` at `0x0046E50B`, `ECX` from `MOV EDX,
  // [0x009c6f00]`: path 0x7E's pause is on the frame of the block
  // `g_camera_index` names. Under the checkpoint's (1, 3) that is block 2's,
  // always 0, so block 0 sitting on 0x163 does not hold the ripple.
  {
    const still = place(0x237c, 4, 11).task!;
    const rippled = () => uvOf(still.slot)?.frames ?? 0;
    G.g_active_cam_path = WATER_PAUSE_CAM_PATH;
    G.g_cam_path_frame = WATER_PAUSE_CAM_FRAME;
    let n0 = rippled();
    WaterSurfacesTick();
    check("path 0x7E at frame 0x163 holds the ripple for the frame",
          G.g_camera_index === 0 && rippled() === n0, `${n0} -> ${rippled()}`);
    CheckpointResetCamera();
    G.g_cam_path_frame = WATER_PAUSE_CAM_FRAME;
    n0 = rippled();
    WaterSurfacesTick();
    check("...but not under the checkpoint's (1, 3): the frame it reads is "
          + "block 2's, which is 0 (`0x0046E50B`)",
          G.g_camera_index === 2 && rippled() === n0 + 1,
          `index ${G.g_camera_index} ${n0} -> ${rippled()}`);
  }
  G.g_script_flags[WaterSurfaceFlag.KillAllStage3] = 0;
  G.g_script_flags[WaterSurfaceFlag.ArenaRipple] = 0;
  G.g_script_flags[WaterSurfaceFlag.SwapTiles] = 0;
  G.g_scene_index = 0;
  G.g_active_cam_path = -1;
  SetGameTables(CHARS, BREAKABLES);
  ResetGameGlobals();
  check("the scene takes its tasks and its tiles with it",
        G.g_water_surfaces.length === 0 && G.g_water_surface_uv.length === 0);
}

console.log("\nclass 0x41, breaking a prop:");
{
  const rng = new Rng(11);
  const events = propScene(rng);
  const props = PlaceBreakableGroup(1, 4, rng);
  let cracked = 0, broken = 0;
  events.on("prop.cracked", () => cracked++);
  events.on("prop.broken", () => broken++);

  const before = G.g_player_score[0];
  shoot(props[0], 1, rng, events);
  check("the first shot cracks rather than breaks",
        cracked === 1 && broken === 0);
  check("the cracked prop swaps to the broken model",
        G.g_breakable_props[0].slot === BreakableSlot.Broken);
  check("cracking a prop is worth no score at all",
        G.g_player_score[0] === before, `${G.g_player_score[0]} vs ${before}`);
  check("but it still counts as a hit", G.g_player_hit_count[0] === 1);

  shoot(props[0], 1, rng, events);
  check("the second shot breaks it", broken === 1);
  check("breaking it is worth ten", G.g_player_score[0] === before + 10,
        String(G.g_player_score[0]));
  check("a broken prop leaves its member slot",
        G.g_breakable_members[1 * MEMBERS_PER_GROUP + 0] === 0);
}

console.log("\nclass 0x41, the item comes out on a random break:");
{
  // The countdown decides *which* break pays out, and it is drawn from the
  // rng -- so over many seeds the release must land on every one of the three
  // props, and never on a fourth break that does not exist.
  const landed = new Set<number>();
  for (let seed = 1; seed <= 40; seed++) {
    const rng = new Rng(seed);
    const events = propScene(rng);
    let releases = 0;
    let onBreak = -1;
    events.on("item.released", () => { releases++; onBreak = breaks; });
    const props = PlaceBreakableGroup(1, 4, rng);
    let breaks = 0;
    for (const p of props) {
      shoot(p, 2, rng, events);
      breaks++;
    }
    check(`seed ${seed}: exactly one item comes out of the set`,
          releases === 1, `${releases} releases`);
    landed.add(onBreak);
  }
  check("over 40 seeds the release lands on more than one break",
        landed.size > 1, `landed on breaks {${[...landed].sort().join(",")}}`);
}

console.log("\nclass 0x41, the stack collapses:");
{
  const rng = new Rng(5);
  const events = propScene(rng);
  const props = PlaceBreakableGroup(0, 4, rng);
  const bottom = props[0], top = props[1];
  check("the top of the stack starts a level up",
        Math.abs(top.y - (bottom.y + 7.540296)) < 1e-6,
        `${top.y} vs ${bottom.y}`);
  check("the top starts standing", top.state === BreakableState.Standing);

  shoot(bottom, 2, rng, events);
  // The bottom is gone; the top should notice on its next update and fall.
  BreakablePropUpdate(top, rng, events);
  check("the top falls once its support is destroyed",
        top.state === BreakableState.Falling, BreakableState[top.state]);

  for (let i = 0; i < 600 && top.state === BreakableState.Falling; i++) {
    BreakablePropUpdate(top, rng, events);
  }
  check("and it comes to rest rather than falling for ever",
        top.state === BreakableState.Settled, BreakableState[top.state]);
  check("it rests at or above the floor",
        top.y >= G.g_camera_fixed_eye_y - 0.1 - 1e-3, String(top.y));
}

console.log("\nclass 0x41, a prop's lifetime is in evt blocks:");
{
  const rng = new Rng(9);
  const events = propScene(rng);
  const props = PlaceBreakableGroup(1, 2, rng);
  const p = props[0];
  // Frames alone must never expire it: the engine counts block advances.
  for (let i = 0; i < 1000; i++) BreakablePropUpdate(p, rng, events);
  check("a thousand frames do not expire a prop", !p.dead);
  for (let b = 1; b <= 3; b++) {
    G.g_evt_step_index = b;
    BreakablePropUpdate(p, rng, events);
  }
  check("but three block advances past a lifetime of two do", p.dead);
}

console.log("\nclass 0x41, the extra life:");
{
  const rng = new Rng(13);
  const events = propScene(rng);
  let released = -1;
  events.on("item.released", (e) => { released = e.set; });
  const props = PlaceBreakableGroup(2, 4, rng);
  shoot(props[0], 2, rng, events);
  check("the lone item-set-1 prop releases the extra life",
        released === ItemSet.ExtraLife, String(released));

  // The cap is `g_max_lives`, which the boot's `ProfileApplyToRun` writes.
  ProfileBoot(null);
  G.g_player_lives[0] = 2;
  check("GrantExtraLife adds a life", GrantExtraLife(0) && G.g_player_lives[0] === 3);
  G.g_player_lives[0] = 5;
  const score = G.g_player_score[0];
  check("and pays 300 instead when the player is at the cap",
        !GrantExtraLife(0) && G.g_player_lives[0] === 5
        && G.g_player_score[0] === score + 300);
  // In Original Mode the cap is the player's own byte, not `g_max_lives`.
  G.g_GameMode = GameMode.Original;
  G.g_max_lives = 9;
  G.g_original_life_cap[0] = 4;
  G.g_player_lives[0] = 4;
  check("in Original Mode the cap is g_original_life_cap, not g_max_lives",
        !GrantExtraLife(0) && G.g_player_lives[0] === 4);
  G.g_GameMode = GameMode.Arcade;
  G.g_original_life_cap[0] = 5;
  ProfileBoot(null);
}

console.log("\nclass 0x41, the extra life is an object you shoot (ExtraLifePickupUpdate):");
{
  const rng = new Rng(13);
  const events = propScene(rng, GameMode.Arcade);
  ProfileBoot(null);
  const sounds: number[] = [];
  events.on("sound.play", (e) => sounds.push(e.id));
  const props = PlaceBreakableGroup(2, 4, rng);
  const from = props[0];
  shoot(from, 2, rng, events);
  const life = G.g_breakable_props.find(
    (q) => q.kind === EXTRA_LIFE_ROUTINE_TYPE && !q.dead);
  check("the item-set-1 prop's break leaves a pickup in the pool: one unit "
        + "above it, a sphere of 4.0, on the prop's own step clock",
        !!life && life.y === Math.fround(from.y + 1.0) && life.hitRadius === 4
        && life.lifetime === from.hp && life.storyItem === 0,
        life ? `${life.y} ${life.hitRadius} ${life.lifetime}` : "none");
  if (life) {
    ExtraLifePickupUpdate(life, rng, events);
    check("...drawing the heart three times its size, 1.5 up, and "
          + "registering its sphere, unshot",
          life.draws?.length === 1 && life.draws[0].slot === EXTRA_LIFE_HEART_SLOT
          && life.draws[0].m[0] !== 0 && !life.dead);
    G.g_player_lives[0] = 2;
    sounds.length = 0;
    BreakablePropTakeShot(life, 0);
    ExtraLifePickupUpdate(life, rng, events);
    check("shot by player 1: a life, 0x3616A9, player 1's strip and tag",
          G.g_player_lives[0] === 3 && sounds.includes(0x3616a9)
          && life.slot === EXTRA_LIFE_STRIP_SLOT
          && life.removeFlag === EXTRA_LIFE_TAG_SLOT && life.storyItem === 2,
          `${G.g_player_lives[0]} ${life.slot.toString(16)} ${life.storyItem}`);
    ExtraLifePickupUpdate(life, rng, events);
    check("...and only one: the taken bit stops a second",
          G.g_player_lives[0] === 3);
    check("...the tag rising over the heart and the strip beside it",
          life.draws?.length === 3
          && life.draws[1].slot === EXTRA_LIFE_TAG_SLOT
          && life.draws[2].slot === EXTRA_LIFE_STRIP_SLOT - 1 + life.storyItem);
    while (!life.dead && life.storyItem < 0x40) {
      ExtraLifePickupUpdate(life, rng, events);
    }
    check("it fades from frame 0x19 and is gone after 0x31",
          life.dead, `frame ${life.storyItem}`);
  }
}

console.log("\nclass 0x41, FIRST AID KIT (g_original_first_aid):");
{
  const lifeAfterBreak = (firstAid: number): boolean => {
    const rng = new Rng(29);
    const events = propScene(rng);
    G.g_original_first_aid = firstAid;
    // Group 1's members all hide set 2, a score pickup, behind a countdown.
    const props = PlaceBreakableGroup(1, 2, rng);
    if (props[0]?.itemSet !== ItemSet.Score2) return false;
    shoot(props[0], 2, rng, events);
    return G.g_breakable_props.some((q) => q.kind === EXTRA_LIFE_ROUTINE_TYPE);
  };
  check("a prop hiding a score pickup gives no life without it",
        !lifeAfterBreak(0));
  check("...and an extra life with it, in place of its set and its countdown",
        lifeAfterBreak(1));
}

console.log("\nclass 0x41, the script spawns reach the pool:");
{
  const rng = new Rng(31);
  const events = propScene(rng);
  // What the walker's live spawn list looks like: a placer the bundle has a
  // placement for, one it does not, and an unrelated class.
  const spawns = [
    { at: 0xa100, class: SpawnClass.PropContainerPlacer },
    { at: 0xbeef, class: SpawnClass.PropContainerPlacer },   // no placement
    { at: 0xc000, class: SpawnClass.Zombie },
  ];
  SpawnPropContainers(spawns);
  const placers = G.g_object_list.filter(
    (o) => o.cls === SpawnClass.PropContainerPlacer);
  check("only the placer with a placement is spawned",
        placers.length === 1 && placers[0].at === 0xa100,
        `${placers.length} placers`);
  check("it carries the group in +0x11C and the lifetime in +0x1F4",
        placers[0].hp === 1 && placers[0].charType === 4);

  // The placer builds its group on its first update and then kills itself.
  GameUpdate(1 / 60, NULL_HOST, rng, events);
  check("one frame places the group", G.g_breakable_props.length === 3,
        `${G.g_breakable_props.length} props`);
  check("and the placer is gone", placers[0].dead);

  // Running again must not place it twice -- the bridge is called every frame.
  SpawnPropContainers(spawns);
  GameUpdate(1 / 60, NULL_HOST, rng, events);
  check("a second pass does not place the group again",
        G.g_breakable_props.length === 3,
        `${G.g_breakable_props.length} props`);
}

console.log("\nclass 0x41 type 4, the kinded props:");
{
  const rng = new Rng(41);
  const events = propScene(rng);
  let broken = 0, cracked = 0, released = -1;
  events.on("prop.broken", () => broken++);
  events.on("prop.cracked", () => cracked++);
  events.on("item.released", (e) => { released = e.set; });

  // Kind 2 wears 0x17A9 and dies to one shot; kind 3 wears the group props'
  // crate and takes two. Both are in item set 2, size 2.
  const a = PlaceKindedProp(0xd000, 2, ItemSet.Score2, 2, 5,
                            10, 0, 0, 0x4000, rng);
  const b = PlaceKindedProp(0xd001, 3, ItemSet.Score2, 2, 5,
                            20, 0, 0, 0, rng);
  G.g_breakable_props.push(a, b);
  check("a kinded prop takes the slot its kind names",
        a.slot === KIND_SLOT[2] && b.slot === KIND_SLOT[3],
        `${a.slot.toString(16)} / ${b.slot.toString(16)}`);
  check("and is its own family", a.family === PropFamily.Kinded);
  check("the countdown is seeded inside [1, set size]",
        G.g_item_set_countdown[ItemSet.Score2] >= 1
        && G.g_item_set_countdown[ItemSet.Score2] <= 2);

  // The crate kind survives its first shot; every other kind does not. It
  // also turns to the camera block's yaw as it cracks (`0x004660A2`), which
  // the port had left out.
  G.g_camera_block_yaw_bams = 0x2468;
  G.g_camera_yaw_bams = 0x1234;
  BreakablePropTakeShot(b, 0);
  KindedPropUpdate(b, rng, events);
  check("the crate kind survives one shot and hides its model",
        cracked === 1 && broken === 0 && b.slot === SLOT_NONE,
        `slot ${b.slot.toString(16)}`);
  check("...turning to the camera block's yaw as it cracks",
        b.yaw === 0x2468, b.yaw.toString(16));

  const before = G.g_player_score[0];
  BreakablePropTakeShot(a, 0);
  KindedPropUpdate(a, rng, events);
  check("a non-crate kind dies to one shot", broken === 1);
  check("and that shot is worth ten", G.g_player_score[0] === before + 10,
        `${G.g_player_score[0]} vs ${before}`);

  // The break effect holds the prop for its animation, then it goes.
  for (let i = 0; i < 200 && !a.dead; i++) KindedPropUpdate(a, rng, events);
  check("the destroyed prop leaves once its effect has run", a.dead);
  void released;
}

console.log("\nclass 0x41 type 4, the whole set pays out exactly once:");
{
  for (let seed = 1; seed <= 20; seed++) {
    const rng = new Rng(seed);
    const events = propScene(rng);
    let releases = 0;
    events.on("item.released", () => releases++);
    // Four props sharing set 5, declared size 4 -- the shape stage 2 uses.
    const props = [0, 1, 2, 3].map((i) =>
      PlaceKindedProp(0xe000 + i, 2, ItemSet.Score5, 4, 5,
                      i * 10, 0, 0, 0, rng));
    G.g_breakable_props.push(...props);
    for (const p of props) {
      BreakablePropTakeShot(p, 0);
      KindedPropUpdate(p, rng, events);
    }
    check(`seed ${seed}: exactly one item from the set of four`,
          releases === 1, `${releases} releases`);
  }
}

console.log("\nclass 0x44 selector 16, the falling container:");
{
  const rng = new Rng(77);
  const events = propScene(rng);
  let cracked = 0, broken = 0, settled = 0, released = -1;
  events.on("prop.cracked", () => cracked++);
  events.on("prop.broken", () => broken++);
  events.on("prop.settled", () => settled++);
  events.on("item.released", (e) => { released = e.set; });

  const c = PlaceFallingContainer(0xf000, 1, ItemSet.ExtraLife, -1, 1, 6,
                                  0, 20, 0, 0, rng);
  G.g_breakable_props.push(c);
  check("it starts whole, two shots, on its own floor",
        c.slot === FALLING_SLOT_WHOLE && c.hp === 2
        && Math.abs(c.floorY - (20 - 7.35)) < 1e-6,
        `floor ${c.floorY}`);

  const before = G.g_player_score[0];
  BreakablePropTakeShot(c, 0);
  FallingContainerUpdate(c, rng, events);
  check("the first shot knocks it loose rather than breaking it",
        cracked === 1 && broken === 0 && c.hp === 1
        && c.slot === FALLING_SLOT_LOOSE);
  check("it pays nothing for that", G.g_player_score[0] === before);
  check("and it is thrown upward", c.vy > 0, String(c.vy));
  check("it is falling", c.state === BreakableState.Falling);

  for (let i = 0; i < 600 && c.state === BreakableState.Falling; i++) {
    FallingContainerUpdate(c, rng, events);
  }
  check("it comes to rest rather than falling for ever",
        c.state === BreakableState.Settled, BreakableState[c.state]);
  // Settling is what re-seats the origin: the contact frame only records the
  // corner, and the frames after it put the container back on that corner.
  for (let i = 0; i < 120; i++) FallingContainerUpdate(c, rng, events);
  // It comes to rest *on a corner*, so the origin sits above the floor by
  // however far that corner is from it -- what must not happen is the origin
  // sinking through, or the container settling onto the camera's ground plane
  // instead of its own.
  check("it settles on its own floor rather than through it or the camera's",
        c.y >= c.floorY - 1e-3 && c.y - c.floorY < 3
        && c.floorY > G.g_camera_fixed_eye_y,
        `y ${c.y.toFixed(3)} floor ${c.floorY.toFixed(3)} ` +
        `camera ${G.g_camera_fixed_eye_y}`);
  check("landing was announced", settled === 1);

  BreakablePropTakeShot(c, 0);
  FallingContainerUpdate(c, rng, events);
  check("the second shot destroys it", broken === 1 && c.dead);
  check("it pays ten", G.g_player_score[0] === before + 10);
  check("and the extra life comes out", released === ItemSet.ExtraLife,
        String(released));
}

/** A copy of `rng` advanced by `n` of the engine's `rand()`s. */
function RandAhead(rng: Rng, n: number): number {
  const probe = new Rng(0);
  probe.state = rng.state;
  for (let i = 0; i < n; i++) MsvcRand(probe);
  return probe.state;
}

console.log("\nclass 0x41, a stacked prop shatters into fifteen pieces:");
{
  const rng = new Rng(21);
  const events = propScene(rng);
  let shattered = 0;
  events.on("prop.shattered", () => shattered++);
  const [, top] = PlaceBreakableGroup(0, 4, rng);
  // A quarter turn, so the matrix the pieces come off is not the identity
  // (L48): the crack turns a standing prop to the camera block's yaw.
  G.g_camera_block_yaw_bams = 0x4000;
  shoot(top, 1, rng, events);
  check("the crack turns a standing prop to the camera block's yaw",
        top.yaw === 0x4000 && top.hp === 1, `${top.yaw} hp ${top.hp}`);
  check("...and its draw stored a matrix, rattle and all",
        top.drawMatrix.length === 16
        && Math.abs(top.drawMatrix[12] - (top.x + top.shakeX)) < 1e-9
        && Math.abs(top.drawMatrix[14] - (top.z + top.shakeZ)) < 1e-9
        && top.shakeX !== 0,
        `${top.drawMatrix[12]} vs ${top.x}+${top.shakeX}`);
  const origin = { x: top.drawMatrix[12], y: top.drawMatrix[13],
                   z: top.drawMatrix[14] };

  // The destroy: the award draws nothing with one player in, and the arm
  // `ActorKill`s the prop before the rattle, so every draw is the shatter's.
  const expect = RandAhead(rng, 15 * 5);
  shoot(top, 1, rng, events);
  check("the second shot on a stacked prop draws exactly 75 rand()s",
        rng.state === expect, `${rng.state} vs ${expect}`);
  check("...kills the prop and leaves ONE object carrying fifteen pieces",
        top.dead && G.g_prop_shatters.length === 1
        && G.g_prop_shatters[0].pieces.length === SHATTER_PIECES
        && shattered === 1,
        `${top.dead} ${G.g_prop_shatters.length}`);
  const s = G.g_prop_shatters[0];
  // Piece 0's offset is (0.327, 7.54, 1.391); a quarter turn under the
  // engine's `MatrixRotateY` carries (x, y, z) to (z, y, -x).
  const p0 = s.pieces[0];
  check("each piece starts at its offset through the prop's stored matrix",
        Math.abs(p0.x - (origin.x + 1.391)) < 1e-4
        && Math.abs(p0.y - (origin.y + 7.54)) < 1e-4
        && Math.abs(p0.z - (origin.z - 0.327)) < 1e-4,
        `${p0.x - origin.x}, ${p0.y - origin.y}, ${p0.z - origin.z}`);
  const p2 = s.pieces[2];
  // Piece 2's angles are a pure Y turn of 22892; the prop's quarter turn
  // after it makes 39276. `MatrixToEulerZYX` reads that back as whichever
  // triple its aim routine lands on -- here (-0x7FFF, -6508, -0x8000), the
  // half-turn-flipped spelling -- so compare the rotations, not the words.
  const want = MatIdentity();
  MatrixRotateY(want, 0x4000);
  MatrixRotateY(want, 22892);
  const got = MatIdentity();
  MatrixRotateZ(got, p2.rz);
  MatrixRotateY(got, p2.ry);
  MatrixRotateX(got, p2.rx);
  check("...and at its own angles composed with the prop's",
        want.every((v, i) => Math.abs(v - got[i]) < 1e-3),
        `${p2.rx} ${p2.ry} ${p2.rz}`);
  check("every piece is thrown up at 1.0 and out at 0.1..0.3",
        s.pieces.every((q) => q.vy === 1.0
          && Math.hypot(q.vx, q.vz) >= 0.1 - 1e-6
          && Math.hypot(q.vx, q.vz) <= 0.3 + 1e-6));
  // Bearing i * 0x1000: piece 0 goes along +z, piece 4 along +x.
  check("...along bearing i * 0x1000",
        Math.abs(s.pieces[0].vx) < 1e-9 && s.pieces[0].vz > 0
        && Math.abs(s.pieces[4].vz) < 1e-6 && s.pieces[4].vx > 0);
  check("...each spinning by at most 0x400 on each axis",
        s.pieces.every((q) => [q.sx, q.sy, q.sz].every(
          (v) => v >= -0x400 && v <= 0x400)));
  check("piece i draws g_shatter_fragment_slots_a[i] for an ordinary prop",
        s.pieces[0].slot === 0x19ea && s.pieces[14].slot === 0x19f3
        && s.effect === 0);
  check("the object is plain data a snapshot can copy",
        JSON.stringify(structuredClone(G.g_prop_shatters))
        === JSON.stringify(G.g_prop_shatters));

  // Its frames: gravity 0.06805, a floor one unit above the ground plane,
  // and 73 of them before the 74th kills it.
  const y0 = p0.y, x0 = p0.x, vx0 = p0.vx, rx0 = p0.rx, sx0 = p0.sx;
  PropShattersTick();
  check("a frame takes 0.06805 off every piece's rise and then moves it",
        s.pieces.every((q) => Math.abs(q.vy - (1.0 - SHATTER_GRAVITY)) < 1e-12)
        && Math.abs(p0.y - (y0 + p0.vy)) < 1e-12
        && Math.abs(p0.x - (x0 + vx0)) < 1e-12
        && p0.rx === (((rx0 + sx0) << 16) >> 16),
        `${p0.vy} ${p0.y - y0}`);
  let lowest = Infinity;
  let bounced = false;
  // Literals, not the constants: a count read back from the code under test
  // cannot catch that code being wrong. `CMP EAX, 0x48`, pre-increment.
  for (let f = 1; f <= 0x48; f++) {
    const falling = s.pieces.map((q) => q.vy < 0);
    PropShattersTick();
    s.pieces.forEach((q, i) => {
      lowest = Math.min(lowest, q.y);
      if (falling[i] && q.vy > 0) bounced = true;
    });
  }
  check("no piece goes below g_camera_fixed_eye_y + 1, and they bounce",
        lowest >= G.g_camera_fixed_eye_y + 1 - 1e-9 && bounced,
        `lowest ${lowest}`);
  check("...it is still up after 73 frames",
        G.g_prop_shatters.length === 1 && s.frames === 73,
        `${G.g_prop_shatters.length} f${s.frames}`);
  PropShattersTick();
  check("...and gone on the 74th", G.g_prop_shatters.length === 0);
  G.g_camera_block_yaw_bams = 0;
}

{
  // A one-shot target carries +0x324 = 6, which is the other table.
  const rng = new Rng(22);
  propScene(rng, GameMode.Training);
  G.g_training_lesson = 0;
  const p = makeBreakableProp(9001, 0, 1);
  p.effect = 6;
  p.drawMatrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 6, 7, 1];
  const s = BreakablePropSpawnShatter(p, rng, null);
  check("a one-shot target's pieces are g_shatter_fragment_slots_b",
        s.pieces[0].slot === 0x1a11 && s.pieces[12].slot === 0x1a1f);

  // The spawn takes the *current* view off a matrix stored under the view it
  // was drawn with: `MatrixInvert(0) * obj+0x2E4`. A camera that moved a unit
  // along x and two along z between the two carries every piece with it.
  const a = new Rng(5), b = new Rng(5);
  p.drawView = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const still = BreakablePropSpawnShatter(p, a, null);
  const moved = BreakablePropSpawnShatter(p, b, {
    w2v: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -1, 0, -2, 1],
    v2w: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 2, 1],
  });
  check("the view the prop was drawn under and the one on the stack now both "
        + "count",
        still.pieces.every((q, i) =>
          Math.abs(moved.pieces[i].x - (q.x + 1)) < 1e-9
          && Math.abs(moved.pieces[i].y - q.y) < 1e-9
          && Math.abs(moved.pieces[i].z - (q.z + 2)) < 1e-9));
  G.g_GameMode = GameMode.Arcade;
}

console.log("\nclass 0x41, what else BreakablePropUpdate does around the break:");
{
  // The rattle's two draws per frame are the game's.
  const rng = new Rng(31);
  const events = propScene(rng);
  const [p] = PlaceBreakableGroup(1, 4, rng);
  let expect = RandAhead(rng, 2);
  shoot(p, 1, rng, events);
  check("a crack's rattle draws two rand()s on the frame it starts",
        rng.state === expect && p.shake > 0.8 && p.shake < 0.9,
        `${p.shake}`);
  for (let i = 0; i < 40; i++) BreakablePropUpdate(p, rng, events);
  expect = rng.state;
  BreakablePropUpdate(p, rng, events);
  check("...and none once the shake has died under 0.01",
        rng.state === expect && p.shakeX === 0 && p.shakeZ === 0);

  // A falling prop is drawn under `Translate(0, -3.770148, 0)`.
  const [bottom, top] = PlaceBreakableGroup(0, 4, rng);
  shoot(bottom, 2, rng, events);
  BreakablePropUpdate(top, rng, events);
  const at = (q: BreakableProp) => Math.hypot(
    q.drawMatrix[12] - (q.x + q.shakeX), q.drawMatrix[13] - q.y,
    q.drawMatrix[14] - (q.z + q.shakeZ));
  check("the frame a prop starts to fall it is still drawn by the standing "
        + "block", top.state === BreakableState.Falling && at(top) < 1e-9,
        `${BreakableState[top.state]} ${at(top)}`);
  BreakablePropUpdate(top, rng, events);
  check("...and after that 3.770148 below its origin, however it is turned",
        Math.abs(at(top) - 3.770148) < 1e-6, `${at(top)}`);
}

{
  // The hit gate's exception, and the stage-2 sweep.
  const rng = new Rng(32);
  const events = propScene(rng);
  const [p, q] = PlaceBreakableGroup(1, 4, rng);
  G.g_scene_index = 1;
  G.g_evt_block_index = 0x11;
  G.g_script_flags[0x28] = 0;
  shoot(p, 1, rng, events);
  check("scene 1 block 0x11: a shot does nothing until flag 0x28 is up",
        p.hp === 2 && p.slot === BreakableSlot.Default, `hp ${p.hp}`);
  G.g_script_flags[0x28] = 1;
  shoot(p, 1, rng, events);
  check("...and cracks the prop once it is", p.hp === 1);
  G.g_script_flags[0x77] = 1;
  BreakablePropPoolUpdate(rng, events);
  check("scene 1 with flag 0x77 up despawns every group prop",
        p.dead && q.dead && G.g_breakable_props.length === 0);
}

{
  // Group 4: the player cannot break it and the script can.
  const rng = new Rng(33);
  const events = propScene(rng);
  const [bottom, top] = PlaceBreakableGroup(4, 4, rng);
  BreakablePropPoolUpdate(rng, events);
  shoot(bottom, 2, rng, events);
  check("a shot never breaks group 4", bottom.hp === 2 && !bottom.dead);
  const score = G.g_player_score[0];
  G.g_script_flags[0x65] = 1;
  BreakablePropPoolUpdate(rng, events);
  check("flag 0x65 turns its ground member into the puff, effect 0x1D9",
        bottom.family === PropFamily.Effect
        && bottom.state === BreakableState.Removed
        && bottom.effectVariant === 0x1d9 && bottom.effect === 0);
  check("...and shatters its stacked one, for no score",
        top.dead && G.g_prop_shatters.length === 1
        && G.g_player_score[0] === score);
}

console.log("\nclass 0x44 selector 16's two pieces:");
{
  const rng = new Rng(78);
  const events = propScene(rng);
  let settled = 0;
  events.on("prop.settled", () => settled++);
  const c = PlaceFallingContainer(0xf300, 1, ItemSet.None, -1, 1, 6,
                                  0, 20, 0, 0x1000, rng);
  G.g_breakable_props.push(c);
  // The knock: the camera block's yaw, and the one-and-a-half-size impact.
  G.g_camera_block_yaw_bams = 0x2345;
  c.hitAim = { x: 1, y: 2 };
  const fx = G.g_sprite_effects.length;
  BreakablePropTakeShot(c, 0);
  FallingContainerUpdate(c, rng, events);
  check("the knock turns the container to the camera block's yaw",
        c.yaw === 0x2345, `${c.yaw}`);
  check("...and throws SpawnPropHitEffectScaled's impact at the aim point",
        G.g_sprite_effects.length === fx + 1
        && G.g_sprite_effects[fx].pos.x === 1
        && G.g_sprite_effects[fx].pos.z === c.z);
  for (let i = 0; i < 600 && c.state !== BreakableState.Settled; i++) {
    FallingContainerUpdate(c, rng, events);
  }
  settled = 0;

  // The break: one draw for the sound, then five for each of two pieces.
  const expect = RandAhead(rng, 1 + 2 * 5);
  BreakablePropTakeShot(c, 0);
  FallingContainerUpdate(c, rng, events);
  check("the break draws 11 rand()s: the sound and two pieces of five",
        rng.state === expect, `${rng.state} vs ${expect}`);
  const frags = G.g_breakable_props.filter(
    (p) => p.family === PropFamily.ContainerFragment);
  check("it throws TWO pieces, not three and not none",
        c.dead && frags.length === 2, `${frags.length}`);
  const [f0, f1] = frags;
  check("each draws 0xA55 and cannot be shot",
        frags.every((f) => f.slot === FALLING_SLOT_FRAGMENT
                    && f.hitRadius === 0));
  check("they start on the container's floor, the second two units up",
        f0.y === c.floorY && f1.y === c.floorY + 2 && f0.x === c.x
        && f0.floorY === c.floorY);
  // The float32s the engine stores: 10 * 0.01f + 0.1f is 0.20000000298.
  check("one each way along x and z",
        f0.vx > 0 && f0.vz > 0 && f1.vx < 0 && f1.vz < 0
        && Math.abs(f0.vx) >= 0.1
        && Math.abs(f0.vx) <= Math.fround(0.2) + 1e-9);
  check("thrown up at 1.5..1.7 and 2.0..2.2, a half turn apart in pitch",
        f0.vy >= 1.5 && f0.vy <= Math.fround(1.7) + 1e-6 && f1.vy >= 2.0
        && f1.vy <= Math.fround(2.2) + 1e-6 && f0.pitch === 0x4000
        && f1.pitch === -0x4000, `${f0.vy} ${f1.vy}`);
  check("...with the container's yaw and a cleared frame count",
        f0.yaw === c.yaw && f0.storyItem === 0 && f0.roll === 0);

  // Its frames: it lands (with a sound), lies there, blinks, and goes on the
  // 182nd update.
  let skippedOdd = 0, skippedWrong = 0;
  // `CMP EAX, 0xB4` before the increment: 181 updates live, as literals.
  for (let n = 1; n <= 181; n++) {
    BreakablePropPoolUpdate(rng, events);
    const blinkFrame = f0.state === BreakableState.Settled
      && f0.storyItem > 0x96 && (f0.storyItem & 1) === 1;
    if (f0.drawSkipped && blinkFrame) skippedOdd++;
    else if (f0.drawSkipped || blinkFrame) skippedWrong++;
  }
  check("both pieces land, and are announced",
        f0.state === BreakableState.Settled
        && f1.state === BreakableState.Settled && settled === 2,
        `${BreakableState[f0.state]} ${settled}`);
  check("a settled piece skips its draw on odd counts past 0x96, and only then",
        skippedOdd > 0 && skippedWrong === 0, `${skippedOdd} ${skippedWrong}`);
  check("...on its own floor",
        f0.y >= c.floorY - 1e-3 && f0.y - c.floorY < 3, `${f0.y}`);
  check("...and is still there after 181 updates",
        G.g_breakable_props.includes(f0) && !f0.dead);
  BreakablePropPoolUpdate(rng, events);
  check("...and gone on the 182nd", f0.dead && f1.dead
        && G.g_breakable_props.length === 0);
  G.g_camera_block_yaw_bams = 0;
}

{
  // `FallingContainerGroundContact`'s wall, scene 1 block 0x12.
  const rng = new Rng(79);
  propScene(rng);
  const f = makeBreakableProp(9002, 0, 0);
  f.state = BreakableState.Falling;
  f.x = -845; f.y = 100; f.floorY = 0; f.vx = -0.2;
  FallingContainerGroundContact(f, [[-1, 0, 0]]);
  check("outside scene 1 block 0x12 there is no wall", f.x === -845);
  G.g_scene_index = 1;
  G.g_evt_block_index = 0x12;
  FallingContainerGroundContact(f, [[-1, 0, 0]]);
  check("...inside it a point past x = -840 pushes the piece back and turns "
        + "it round", f.x === -839 && f.vx === 0.2, `${f.x} ${f.vx}`);

  // And the container's camera cue: path 0x2F, frame 0x96 exactly.
  G.g_scene_index = 0;
  const c = PlaceFallingContainer(0xf400, 1, ItemSet.None, -1, 1, 6,
                                  0, 20, 0, 0, rng);
  G.g_breakable_props.push(c);
  G.g_active_cam_path = FALLING_REMOVE_CAM_PATH;
  G.g_cam_path_frame = FALLING_REMOVE_CAM_FRAME - 1;
  FallingContainerUpdate(c, rng);
  check("the container's camera cue is an equality: one frame early, nothing",
        !c.dead);
  G.g_cam_path_frame = FALLING_REMOVE_CAM_FRAME;
  FallingContainerUpdate(c, rng);
  check("...and on the frame itself it goes", c.dead);
}

console.log("\nall three families share one item-set countdown:");
{
  const rng = new Rng(5);
  const events = propScene(rng);
  let releases = 0;
  events.on("item.released", () => releases++);
  // One group prop and two kinded props, all in set 2. The group placer
  // seeds the countdown, then each kinded placement re-seeds it -- which is
  // the engine's own behaviour and why the classes cannot be ported apart.
  PlaceBreakableGroup(1, 4, rng);
  const k = [0, 1].map((i) =>
    PlaceKindedProp(0xf100 + i, 2, ItemSet.Score2, 2, 5, 50 + i * 10, 0, 0,
                    0, rng));
  G.g_breakable_props.push(...k);
  check("the countdown is one global, not one per class",
        G.g_item_set_countdown[ItemSet.Score2] >= 1
        && G.g_item_set_countdown[ItemSet.Score2] <= 2,
        String(G.g_item_set_countdown[ItemSet.Score2]));

  // Break everything in set 2 across both classes; exactly one item drops.
  for (const p of [...G.g_breakable_props]) {
    if (p.itemSet !== ItemSet.Score2) continue;
    for (let n = 0; n < 3 && !p.dead; n++) {
      BreakablePropTakeShot(p, 0);
      if (p.family === PropFamily.Kinded) KindedPropUpdate(p, rng, events);
      else BreakablePropUpdate(p, rng, events);
    }
  }
  check("breaking the set across two classes pays out once",
        releases === 1, `${releases} releases`);
}

console.log("\nclass 0x41, the generic props:");
{
  const rng = new Rng(3);
  propScene(rng);
  // What the exporter emits for one: the type, the asset slot from `+0x11C`,
  // and three real angles.
  const p = PlaceGenericProp({
    at: 0xa900, container: "generic", type: 12, slot: 0x173d,
    lifetime_evt_steps: 0, pos: [5, 6, 7], pitch: 0x100, yaw: 0x2000,
    roll: 0x300,
  }, rng);
  check("a generic prop draws the slot from +0x11C, not hit points",
        p.slot === 0x173d, p.slot.toString(16));
  check("it is placed where the script put it",
        p.x === 5 && p.y === 6 && p.z === 7);
  check("all three orientation words are angles for this family",
        p.pitch === 0x100 && p.yaw === 0x2000 && p.roll === 0x300);
  check("and it is the drawn-only family",
        p.family === PropFamily.Generic);

  // The arms of the switch that override what the prologue took.
  const door = PlaceGenericProp({
    at: 0xa901, container: "generic", type: 6, slot: 0x1234,
    lifetime_evt_steps: 0, pos: [0, 0, 0],
  }, rng);
  // Case 6's other literal is `obj+0x11C = 1`, and `PropUpdateType6` reads
  // that word only through `PropExpireByStepLifetime`: a step lifetime, not
  // the shot count this used to assert.
  check("a type whose arm overrides the slot uses the arm's",
        door.slot === 0x1032 && door.lifetime === 1 && door.hp === 0,
        `${door.slot.toString(16)} ${door.lifetime} ${door.hp}`);
}

console.log("\nclass 0x41's three draw-only types:");
{
  // ---- type 54: the drift is authored, and it is the only exit ----------
  const rng = new Rng(54);
  propScene(rng);
  const p = PlaceGenericProp({
    at: 0xb000, container: "generic", type: 54, slot: 0x18a1,
    lifetime_evt_steps: 0x18a1, field_1f4: 5, pos: [583, -67, -7773.4],
  }, rng);
  G.g_breakable_props.push(p);
  check("a type-54 prop is its own family, not the inert Generic arm",
        p.family === PropFamily.DrawOnlyType54, `${PropFamily[p.family]}`);
  check("...and PlaceGenericProp case 0x36 seeds all five drift rates",
        p.vx === 5 && p.vy === 1.5 && p.vz === -4
        && p.spin === 0x300 && p.yawSpin === -0x400,
        `${p.vx}/${p.vy}/${p.vz} ${p.spin}/${p.yawSpin}`);
  // Flag 12 down: it stands exactly where the script put it, for ever. There
  // is no lifetime prologue on this routine at all.
  G.g_script_flags[SCRIPT_FLAG_TYPE54_DRIFT] = 0;
  for (let i = 0; i < 400; i += 1) BreakablePropPoolUpdate(rng);
  check("with g_script_flags[12] down it does not move and does not retire",
        G.g_breakable_props.length === 1 && p.x === 583 && p.storyItem === 0,
        `${G.g_breakable_props.length} @ ${p.x} f${p.storyItem}`);
  // Raised: five units of X a frame, and dead on the frame after 300.
  G.g_script_flags[SCRIPT_FLAG_TYPE54_DRIFT] = 1;
  BreakablePropPoolUpdate(rng);
  check("...raised, it drifts five units of X and one frame",
        p.x === 588 && p.storyItem === 1 && p.spin === 0x300
        && p.pitch === 0x300, `${p.x} f${p.storyItem} p${p.pitch}`);
  // `CMP EAX,0x12C` is on the count BEFORE the increment, so the frames that
  // read 0..300 all draw -- 301 of them -- and the 302nd is the one that dies.
  for (let i = 0; i < TYPE54_DRIFT_FRAMES; i += 1) {
    BreakablePropPoolUpdate(rng);
  }
  check("...and it is still alive after 301 frames of drift",
        G.g_breakable_props.length === 1 && p.storyItem === 301,
        `${G.g_breakable_props.length} f${p.storyItem}`);
  BreakablePropPoolUpdate(rng);
  check("...and dies on the 302nd, because the compare is pre-increment",
        G.g_breakable_props.length === 0, `${G.g_breakable_props.length}`);
}

{
  // ---- type 31: an effect strip that wraps, and a camera cue ------------
  const rng = new Rng(31);
  propScene(rng);
  // Stage 3's three, whose roll word 9 is a ten-frame strip of eff_taki.bin.
  const p = PlaceGenericProp({
    at: 0xb100, container: "generic", type: 31, slot: 0x0d01,
    lifetime_evt_steps: 0x0d01, field_1f4: 4,
    pos: [-1139, -12.9, -3962.5], pitch: 0, yaw: -0x2edc, roll: 9,
  }, rng);
  G.g_breakable_props.push(p);
  check("a type-31 prop takes its strip length from the roll word",
        p.removeFlag === 9 && p.slot === 0x0d01 && p.storyItem === 0,
        `len ${p.removeFlag} slot ${p.slot.toString(16)}`);
  check("...and the same word is still its roll, because both are the engine's",
        p.roll === 9);
  check("...with its lifetime from desc+0x24 and not from its own slot",
        p.lifetime === 4, `${p.lifetime}`);
  BreakablePropPoolUpdate(rng);
  check("...it steps one frame of the strip a tick", p.storyItem === 1,
        `${p.storyItem}`);
  for (let i = 0; i < 8; i += 1) BreakablePropPoolUpdate(rng);
  check("...and shows the last frame of a ten-frame loop, which is 9",
        p.storyItem === 9, `${p.storyItem}`);
  BreakablePropPoolUpdate(rng);
  // The reset is in the same frame as the increment, so 10 is never held: a
  // roll word of 9 is ten frames, 0..9, and `slot + 10` is never asked for.
  check("...then back to 0 -- the cursor never reaches the strip length",
        p.storyItem === 0, `${p.storyItem}`);
  // The camera cue: exact path AND exact frame, or nothing happens.
  G.g_active_cam_path = TYPE31_DESPAWN_CAM_PATH;
  G.g_cam_path_frame = TYPE31_DESPAWN_CAM_FRAME - 1;
  BreakablePropPoolUpdate(rng);
  check("its camera cue is an equality: one frame early removes nothing",
        G.g_breakable_props.length === 1, `${G.g_breakable_props.length}`);
  G.g_cam_path_frame = TYPE31_DESPAWN_CAM_FRAME;
  BreakablePropPoolUpdate(rng);
  check("...and on the frame itself it goes",
        G.g_breakable_props.length === 0, `${G.g_breakable_props.length}`);
}

{
  // ---- type 33: a strip played once, then ActorKill ---------------------
  // Stage 2 block 11 step 1's one spawn, as the exporter carries it: slot
  // 0x174A (eff_shop.bin[0]), a roll word of 0x3B, and a `+0x11C` that is
  // the slot and would be a 5962-step "lifetime" to a prologue the routine
  // does not have. Driven through the real frame -- placer in the actor
  // walk, the prop in the pool walk after it -- because the order is the fix.
  const rng = new Rng(33);
  const events = propScene(rng, GameMode.Arcade);
  const at = 0x6a14;
  SetGameTables(CHARS, { ...BREAKABLES, placements: [
    ...(BREAKABLES.placements ?? []),
    { at, container: "generic", type: 33, slot: 0x174a,
      lifetime_evt_steps: 0x174a, field_1f4: 0,
      pos: [-908, 7, -564], pitch: 0, yaw: 0xe000, roll: 0x3b },
  ] });
  // Scene 1 (stage 2) with the sweep flag up: the shared prologue would take
  // a Generic prop on its first frame, and this routine has no prologue.
  G.g_scene_index = 1;
  G.g_script_flags[0x77] = 1;
  const placer = ActorSpawn(at, SpawnClass.PropContainerPlacer, 0, "placer");
  placer.visible = true;
  placer.hp = 0x174a;       // +0x11C: the slot, for this type
  placer.condition = 33;    // +0x130C: PlaceGenericProp, g_class41_updates[33]
  const drawn: number[] = [];
  for (let frame = 0; frame < 70; frame += 1) {
    // A step change every frame: nothing may count them against `+0x11C`.
    G.g_evt_step_index = frame & 0xff;
    // The object as it was before the frame, so the frame that kills it --
    // and takes it out of the pool -- can still be asked what it drew.
    const before = G.g_breakable_props.find((q) => q.at === at);
    GameUpdate(1 / 60, NULL_HOST, rng, events);
    const p = G.g_breakable_props.find((q) => q.at === at) ?? before;
    if (p?.draws?.length) drawn.push(p.draws[0].slot);
  }
  check("a type-33 prop draws a strip and its placer is gone",
        drawn.length > 0 && placer.dead, `${drawn.length} drawn`);
  check("...the sweep and 70 step changes do not retire it: no prologue",
        drawn.length === 60, `${drawn.length}`);
  check("...it draws cursor 0 on the frame it is placed, as the engine's "
        + "walk reaches it then (TaskRunTree)",
        drawn[0] === 0x174a, drawn[0]?.toString(16));
  check("...then one slot a frame, every one of 0x174A..0x1785 once",
        drawn.every((s, i) => s === 0x174a + i)
        && drawn[drawn.length - 1] === 0x1785,
        drawn.map((s) => s.toString(16)).join());
  check("...and it is gone from the pool after its sixtieth frame",
        !G.g_breakable_props.some((q) => q.at === at),
        `${G.g_breakable_props.length}`);

  // The routine on its own: post-increment compare, `ActorKill`, and the
  // draw of the last cursor is made by the call that kills.
  const q = PlaceGenericProp({
    at: 0xb133, container: "generic", type: 33, slot: 0x174a,
    lifetime_evt_steps: 0x174a, pos: [0, 0, 0], roll: 2,
  }, rng);
  check("PlaceGenericProp gives type 33 its own family",
        q.family === PropFamily.DrawOnlyType33 && q.removeFlag === 2
        && q.storyItem === 0, `${PropFamily[q.family]} ${q.removeFlag}`);
  PropDrawOnlyType33(q);
  PropDrawOnlyType33(q);
  check("...a roll word of 2 survives the steps to cursors 1 and 2",
        !q.dead && q.storyItem === 2 && q.draws?.[0]?.slot === 0x174b,
        `${q.storyItem}`);
  PropDrawOnlyType33(q);
  check("...and the call that drew cursor 2 kills it: 3 > 2",
        q.dead && q.storyItem === 3 && q.draws?.[0]?.slot === 0x174c,
        `${q.storyItem}`);
  // And the pool's own walk steps it, once.
  const r = PlaceGenericProp({
    at: 0xb134, container: "generic", type: 33, slot: 0x174a,
    lifetime_evt_steps: 0x174a, pos: [0, 0, 0], roll: 5,
  }, rng);
  G.g_breakable_props.push(r);
  BreakablePropPoolUpdate(rng);
  check("the pool walk runs it: cursor 0 drawn, then stepped to 1",
        r.storyItem === 1 && r.draws?.[0]?.slot === 0x174a
        && G.g_breakable_props.includes(r), `${r.storyItem}`);

  // A strip of one: the call that draws cursor 0 kills it. The engine
  // submitted that draw before the object went, so the frame still shows it:
  // the pool keeps it in `g_prop_final_draws` for the renderer, one frame.
  G.g_breakable_props = [];
  const last = PlaceGenericProp({
    at: 0xb135, container: "generic", type: 33, slot: 0x174a,
    lifetime_evt_steps: 0x174a, pos: [0, 0, 0], roll: 0,
  }, rng);
  G.g_breakable_props.push(last);
  BreakablePropPoolUpdate(rng);
  check("a prop that draws and then dies leaves its last draw for the "
        + "renderer",
        G.g_breakable_props.length === 0
        && G.g_prop_final_draws.length === 1
        && G.g_prop_final_draws[0].id === last.id
        && G.g_prop_final_draws[0].draws[0]?.slot === 0x174a,
        JSON.stringify(G.g_prop_final_draws.map((f) => f.id)));
  BreakablePropPoolUpdate(rng);
  check("...for that one frame only", G.g_prop_final_draws.length === 0);
}

{
  // ---- type 53: its own inline lifetime, with no scene-1 sweep ----------
  const rng = new Rng(53);
  propScene(rng);
  const p = PlaceGenericProp({
    at: 0xb200, container: "generic", type: 53, slot: 0x002b,
    lifetime_evt_steps: 0x002b, field_1f4: 6,
    pos: [626.9, -71.1, -6422.6], yaw: -0x5555,
  }, rng);
  G.g_breakable_props.push(p);
  check("a type-53 prop is its own family and its lifetime is desc+0x24",
        p.family === PropFamily.DrawOnlyType53 && p.lifetime === 6,
        `${PropFamily[p.family]} ${p.lifetime}`);
  // Six step changes are survivable; the seventh is not.
  for (let i = 1; i <= 6; i += 1) {
    G.g_evt_step_index = i;
    BreakablePropPoolUpdate(rng);
  }
  check("...it survives exactly as many step changes as its lifetime",
        G.g_breakable_props.length === 1 && p.stepsElapsed === 6,
        `${G.g_breakable_props.length} after ${p.stepsElapsed}`);
  G.g_evt_step_index = 7;
  BreakablePropPoolUpdate(rng);
  check("...and dies on the one after", G.g_breakable_props.length === 0,
        `${G.g_breakable_props.length}`);
}

{
  // The sweep the shared prologue has and this routine does not. Scene 1 with
  // flag 0x77 raised clears every prop that runs `PropExpireByStepLifetime`;
  // a type-53 prop is not one of them, and folding it into the shared arm
  // because its two shipped spawns are in scene 4 is the mistake `L27` names.
  const rng = new Rng(153);
  propScene(rng);
  G.g_scene_index = 1;
  const p = PlaceGenericProp({
    at: 0xb300, container: "generic", type: 53, slot: 0x002b,
    lifetime_evt_steps: 0x002b, field_1f4: 6, pos: [0, 0, 0],
  }, rng);
  // Type 51, which opens with the shared prologue. (This was type 5, which
  // has no prologue at all -- `PropDrawOnlyType5` is a flag test and a draw.)
  const q = PlaceGenericProp({
    at: 0xb301, container: "generic", type: 51, slot: 0x1793,
    lifetime_evt_steps: 0x1793, field_1f4: 6, pos: [0, 0, 0],
  }, rng);
  G.g_breakable_props.push(p, q);
  G.g_script_flags[0x77] = 1;
  BreakablePropPoolUpdate(rng);
  check("the scene-1 sweep clears a prologue prop and leaves a type-53 alone",
        G.g_breakable_props.length === 1
        && G.g_breakable_props[0].family === PropFamily.DrawOnlyType53,
        `${G.g_breakable_props.map((r) => PropFamily[r.family]).join()}`);
}

console.log("\nclass 0x41 types 5, 6, 10, 12, 21, 51, 63, 78, transcribed whole:");
{
  const rng = new Rng(5);
  const events = propScene(rng);
  const tick = (k = 1) => {
    for (let i = 0; i < k; i++) BreakablePropPoolUpdate(rng, events);
  };
  const place = (type: number, extra: Partial<BreakablePlacement> = {}) => {
    const p = PlaceGenericProp({
      at: 0xc500 + type, container: "generic", type, slot: 0,
      lifetime_evt_steps: 0, pos: [0, 0, 0], pitch: 0, yaw: 0, roll: 0,
      ...extra,
    }, rng);
    G.g_breakable_props.push(p);
    return p;
  };
  const at = (m: number[]) => [m[12], m[13], m[14]].map((v) => +v.toFixed(3));

  // ---- type 5: a flag test and a draw, and nothing else ----------------
  // Stage 2 block 14 step 10's first one, exactly -- and stage 2 is scene 1,
  // where the shared prologue's sweep would have cleared it.
  G.g_scene_index = 1;
  G.g_script_flags[0x77] = 1;
  const five = place(5, { slot: 0xfd2, lifetime_evt_steps: 0xfd2,
                          pos: [-965, -8.1, -1270], pitch: 0xf000,
                          yaw: 0x8000 });
  G.g_evt_step_index = 3;
  tick();
  check("type 5 has no prologue: the scene-1 sweep and a step change leave "
        + "it standing", !five.dead && five.stepsElapsed === 0);
  check("...and it draws its descriptor's slot at its own position",
        five.draws?.length === 1 && five.draws[0].slot === 0xfd2
        && at(five.draws[0].m).join() === "-965,-8.1,-1270",
        JSON.stringify(five.draws?.map((c) => [c.slot, at(c.m)])));
  // `Rz . Ry . Rx` with a half turn of yaw and a sixteenth of pitch: +X goes
  // to -X, and the pitch leaves it there.
  check("...under Rz.Ry.Rx of its own angles",
        Math.abs((five.draws?.[0].m[0] ?? 0) + 1) < 1e-6,
        String(five.draws?.[0].m.slice(0, 3)));
  check("...and registers no shot sphere", !five.shotRegistered);
  G.g_script_flags[0x77] = 0;
  G.g_scene_index = 0;
  G.g_script_flags[SCRIPT_FLAG_TYPE5_REMOVE] = 1;
  const flagsBefore = five.flags;
  tick();
  check("flag 0x13 takes it with ActorKill, not ActorDespawn",
        five.dead && five.flags === flagsBefore
        && !G.g_breakable_props.includes(five));
  G.g_script_flags[SCRIPT_FLAG_TYPE5_REMOVE] = 0;

  // ---- types 6 and 10: the model is the cursor -------------------------
  G.g_evt_step_index = 1;
  const six = place(6, { slot: 1, lifetime_evt_steps: 1 });
  const ten = place(10, { slot: 1, lifetime_evt_steps: 1,
                          pos: [-1044.27, 2.4173, -1299.73] });
  const drawn6: number[] = [];
  const drawn10: number[] = [];
  for (let i = 0; i < 52; i++) {
    tick();
    drawn6.push(six.draws?.[0]?.slot ?? -1);
    drawn10.push(ten.draws?.[0]?.slot ?? -1);
  }
  check("type 6 plays 0x1032..0x1062, forty-nine frames, and wraps",
        drawn6[0] === TYPE6_FIRST_SLOT && drawn6[48] === 0x1062
        && drawn6[49] === TYPE6_FIRST_SLOT && drawn6[51] === 0x1034,
        drawn6.slice(46, 52).map((x) => x.toString(16)).join());
  check("type 10 plays 0x10C4..0x10CC, nine frames, and wraps",
        drawn10.slice(0, 11).map((x) => x - TYPE10_FIRST_SLOT).join()
        === "0,1,2,3,4,5,6,7,8,0,1",
        drawn10.slice(0, 11).map((x) => x.toString(16)).join());
  check("...the draw is the slot from before the step, and the step is kept",
        six.slot === 0x1035 && ten.slot === TYPE10_FIRST_SLOT + 7,
        `${six.slot.toString(16)} ${ten.slot.toString(16)}`);
  // The arms' `obj+0x11C` literals are step lifetimes: 1 and 2.
  G.g_evt_step_index = 2; tick();
  check("one step change: both still up", !six.dead && !ten.dead);
  G.g_evt_step_index = 3; tick();
  check("the second retires type 6 (life 1) and not type 10 (life 2)",
        six.dead && !ten.dead);
  G.g_evt_step_index = 4; tick();
  check("...and the third retires type 10", ten.dead);

  // ---- type 12: a descriptor model at unit scale, and a camera cue -----
  G.g_evt_step_index = 1;
  const twelve = place(12, { slot: 0x17a5, lifetime_evt_steps: 0x17a5,
                             field_1f4: 1, pos: [-585.1, -13.7, -1237],
                             yaw: 0x4000, roll: 2 });
  tick();
  check("type 12 takes its lifetime from +0x1F4 and draws +0x11C's model",
        twelve.lifetime === 1 && twelve.draws?.[0].slot === 0x17a5
        && at(twelve.draws[0].m).join() === "-585.1,-13.7,-1237",
        `${twelve.lifetime} ${JSON.stringify(twelve.draws)}`);
  check("...scaled by the arm's 1.0 on all three axes",
        twelve.restX === 1 && twelve.restY === 1 && twelve.restZ === 1);
  G.g_active_cam_path = TYPE12_DESPAWN_CAM_PATH;
  G.g_cam_path_frame = TYPE12_DESPAWN_CAM_FRAME - 1;
  tick();
  check("camera path 0x2F one frame short of 0x96 leaves it", !twelve.dead);
  G.g_cam_path_frame = TYPE12_DESPAWN_CAM_FRAME;
  tick();
  check("...and frame 0x96 takes it, as ActorDespawn",
        twelve.dead && ((twelve.flags & 0x80018000) >>> 0) === 0x80018000);
  G.g_active_cam_path = -1;
  G.g_cam_path_frame = 0;

  // ---- type 21: g_frame_counter's strip, in draw layer 9 ---------------
  const t21 = place(21, { slot: 2, lifetime_evt_steps: 2,
                          pos: [-403, 0, -1347.8], yaw: 0xc000 });
  G.g_frame_counter = 1237;
  tick();
  check("type 21 draws 0x132F + g_frame_counter % 10, in layer 9",
        t21.draws?.[0].slot === TYPE21_FIRST_SLOT + 7
        && t21.draws[0].layer === TYPE21_DRAW_LAYER,
        JSON.stringify(t21.draws?.map((c) => [c.slot, c.layer])));

  // ---- type 51: Ry . Rz . Rx, the one that is not Rz . Ry . Rx ---------
  const van = place(51, { slot: 0x1793, lifetime_evt_steps: 0x1793,
                          field_1f4: 4, yaw: 0x4000, roll: 0x2000 });
  tick();
  const yzx = MatIdentity();
  MatrixRotateY(yzx, 0x4000); MatrixRotateZ(yzx, 0x2000);
  MatrixRotateX(yzx, 0);
  const zyx = MatIdentity();
  MatrixRotateZ(zyx, 0x2000); MatrixRotateY(zyx, 0x4000);
  const m51 = van.draws?.[0].m ?? [];
  const same = (a: number[], b: number[]) =>
    a.slice(0, 12).every((v, i) => Math.abs(v - b[i]) < 1e-6);
  check("type 51 composes yaw before roll, and the other order differs",
        van.draws?.[0].slot === 0x1793 && same(m51, yzx) && !same(m51, zyx));

  // ---- type 63: twelve items off a table, then gone --------------------
  const released: Array<[number, number, number, number]> = [];
  events.on("item.released", (e) => released.push([e.set, e.x, e.y, e.z]));
  const box = place(63, { pos: [1, 2, 3] });
  tick();
  check("type 63 releases the table's twelve items in order and dies",
        released.length === 12 && box.dead
        && released.map((r) => r[0]).join() === "6,5,7,2,3,1,1,1,2,3,6,5",
        released.map((r) => r[0]).join());
  check("...each at the record's x, z - 3.0, and y 2498.7",
        released[0][1] === 419 && released[0][3] === -9385
        && Math.abs(released[5][2] - (TYPE63_ITEM_Y + 1.0)) < 1e-9
        && released[11][1] === 456 && released[11][3] === -9375,
        JSON.stringify([released[0], released[5], released[11]]));

  // ---- type 78: a load request and an ActorKill ------------------------
  const loader = place(78, { slot: 1, lifetime_evt_steps: 1 });
  tick();
  check("type 78 kills itself on its first frame and draws nothing",
        loader.dead && (loader.draws?.length ?? 0) === 0);
  G.g_GameMode = GameMode.Arcade;
  const arcade = PropType78LoadSlot();
  G.g_GameMode = GameMode.Original;
  check("...having asked for 0x1A60 in Arcade and 0xA6C otherwise",
        arcade === TYPE78_ARCADE_SLOT && PropType78LoadSlot() === 0xa6c);
}

console.log("\nclass 0x41 type 13, its draws:");
{
  const rng = new Rng(1313);
  const events = propScene(rng);
  G.g_scene_index = 1;
  G.g_evt_step_index = 4;
  const p = PlaceGenericProp({ at: 0xec94, container: "generic", type: 13,
    slot: 4, lifetime_evt_steps: 4, field_1f4: 0, pos: [-925, 180, -1297],
    pitch: 0, yaw: 0, roll: 0 }, rng);
  G.g_breakable_props.push(p);
  const at = (x: number, y: number, z: number) => {
    const m = MatIdentity(); MatrixTranslate(m, x, y, z); return m;
  };
  const same = (a: ArrayLike<number>, b: ArrayLike<number>) =>
    Array.from({ length: 16 }, (_, i) => a[i] === b[i]).every(Boolean);
  G.g_scene_tick_counter = 1;
  BreakablePropPoolUpdate(rng, events);
  check("type 13 draws its panel on the entry stack top, then the part under "
        + "its own Translate",
        p.draws?.length === 2 && p.draws[0].slot === TYPE13_PANEL_SLOT
        && same(p.draws[0].m, MatIdentity())
        && p.draws[1].slot === TYPE13_DROP_SLOT
        && same(p.draws[1].m, at(-925, 180, -1297)),
        JSON.stringify(p.draws?.map((d) => d.slot)));
  G.g_scene_tick_counter = 40;
  BreakablePropPoolUpdate(rng, events);
  check("...the blink frame is drawn on the frame it is chosen",
        p.slot === 0x1a4a && p.removeFlag === 1
        && p.draws?.[0]?.slot === 0x1a4a);
  G.g_script_flags[SCRIPT_FLAG_TYPE13_DROP] = 1;
  BreakablePropPoolUpdate(rng, events);
  let n = 0;
  let drawnWhereItIs = true;
  while (p.routinePhase === Type13Phase.Fall && n < 1000) {
    BreakablePropPoolUpdate(rng, events);
    n++;
    if (p.draws?.[1]?.m[13] !== p.y) drawnWhereItIs = false;
  }
  check("...every falling frame draws the part at the y it just stepped to "
        + "(the draw follows the step)",
        drawnWhereItIs && n === 136, `${n}`);
  check("...the landing frame draws the judder already added to Z",
        p.vz === TYPE13_JUDDER
        && p.draws?.[1]?.m[14] === Math.fround(-1297 + TYPE13_JUDDER),
        `${p.draws?.[1]?.m[14]}`);
  // The fifth step change kills it before the sweep is looked at, and a
  // killed prop has drawn nothing that frame.
  for (let b = 5; b <= 8; b++) {
    G.g_evt_step_index = b;
    BreakablePropPoolUpdate(rng, events);
  }
  G.g_script_flags[0x77] = 1;
  const flags = p.flags;
  G.g_evt_step_index = 9;
  BreakablePropPoolUpdate(rng, events);
  check("...its lifetime is counted before the scene-1 sweep, and it is "
        + "ActorKill (no 0x80018000), with nothing drawn",
        p.dead && p.flags === flags && p.draws?.length === 0,
        p.flags.toString(16));
}

console.log("\nclass 0x41 type 31, its draws:");
{
  const rng = new Rng(3131);
  propScene(rng);
  G.g_evt_step_index = 1;
  const pl: BreakablePlacement = { at: 0x5380, container: "generic", type: 31,
    slot: 0x0d01, lifetime_evt_steps: 0x0d01, field_1f4: 4,
    pos: [-1139, -12.899999618530273, -3962.5], pitch: 0x123, yaw: -11996,
    roll: 9 };
  const p = PlaceGenericProp(pl, rng);
  G.g_breakable_props.push(p);
  check("type 31's arm writes the scale 1.0 and the strip end, and it is a "
        + "whole routine (no GENERIC_UPDATE row)",
        p.restX === 1 && p.restY === 1 && p.restZ === 1 && p.removeFlag === 9
        && p.lifetime === 4);
  const want = MatIdentity();
  MatrixTranslate(want, -1139, -12.899999618530273, -3962.5);
  MatrixRotateZ(want, 9); MatrixRotateY(want, -11996);
  MatrixRotateX(want, 0x123); MatrixScale(want, 1, 1, 1);
  const close = (a: ArrayLike<number>, b: ArrayLike<number>) =>
    Array.from({ length: 16 }, (_, i) => Math.abs(a[i] - b[i]) < 1e-9)
      .every(Boolean);
  const slots: number[] = [];
  for (let i = 0; i < 12; i++) {
    BreakablePropPoolUpdate(rng);
    slots.push(p.draws?.[0]?.slot ?? -1);
  }
  check("...it draws cursor 0 on its first frame under T.Rz.Ry.Rx.S, and the "
        + "loop is 0..9 with no lead",
        slots.join() === [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0, 1]
          .map((c) => 0x0d01 + c).join()
        && close(p.draws?.[0]?.m ?? [], want),
        slots.map((s) => s.toString(16)).join());
  p.flags |= 0x8;
  BreakablePropPoolUpdate(rng);
  check("...registers no sphere and never masks obj+0x34",
        !p.shotRegistered && (p.flags & 0x8) !== 0);
  G.g_scene_index = 2;
  G.g_evt_block_index = 0xb;
  G.g_scene_tick_counter = 10;
  BreakablePropPoolUpdate(rng);
  const w1 = want.slice(); MatrixTranslate(w1, 0, -55.125, 0);
  const w2 = w1.slice(); MatrixRotateY(w2, 0x8000);
  MatrixTranslate(w2, 0, 0, -3);
  const extra = 10 % 7 + TYPE31_EXTRA_SLOT;
  check("...in scene 2 block 11 it draws tick%7+0x1797 twice more: 55.125 "
        + "down, then half a turn round and 3.0 along",
        p.draws?.length === 3 && p.draws[1].slot === extra
        && p.draws[2].slot === extra
        && close(p.draws[1].m, w1) && close(p.draws[2].m, w2),
        JSON.stringify(p.draws?.map((d) => d.slot)));
  G.g_scene_index = 0;
  G.g_evt_block_index = 0;
  for (let s = 2; s <= 5; s++) {
    G.g_evt_step_index = s;
    BreakablePropPoolUpdate(rng);
  }
  const cursor = p.storyItem;
  G.g_evt_step_index = 6;
  BreakablePropPoolUpdate(rng);
  check("...retired by its prologue it runs nothing more: no draw, no step "
        + "(ActorDespawn does not return)",
        p.dead && p.draws?.length === 0 && p.storyItem === cursor);
}

console.log("\nclass 0x41 type 35, its draws:");
{
  const rng = new Rng(3535);
  const events = propScene(rng);
  G.g_evt_step_index = 1;
  const door = PlaceGenericProp({ at: 0x2504, container: "generic", type: 35,
    slot: 4, lifetime_evt_steps: 4, pos: [0, 0, 0], pitch: 0, yaw: 0,
    roll: 0 }, rng);
  G.g_breakable_props.push(door);
  const leaves = (yaw: number): boolean => {
    const a = MatIdentity(); MatrixTranslate(a, ...TYPE35_LEAF_A);
    MatrixRotateY(a, yaw);
    const b = MatIdentity(); MatrixTranslate(b, ...TYPE35_LEAF_B);
    MatrixRotateY(b, -yaw | 0);
    const d = door.draws ?? [];
    return d.length === 2 && d[0].slot === TYPE35_LEAF_A_SLOT
      && d[1].slot === TYPE35_LEAF_B_SLOT
      && d[0].m.every((v, i) => Math.abs(v - a[i]) < 1e-9)
      && d[1].m.every((v, i) => Math.abs(v - b[i]) < 1e-9);
  };
  BreakablePropPoolUpdate(rng, events);
  check("type 35 draws two leaves at the literal hinge words, not at its "
        + "own position",
        leaves(0) && door.draws?.[0]?.m[12] === -620.552001953125
        && door.draws?.[1]?.m[14] === -980.8179931640625);
  G.g_script_flags[SCRIPT_FLAG_TYPE35_RATTLE] = 1;
  for (let i = 0; i < 20; i++) BreakablePropPoolUpdate(rng, events);
  let each = true;
  for (let i = 0; i < 7; i++) {
    BreakablePropPoolUpdate(rng, events);
    if (!leaves(door.yaw)) each = false;
  }
  check("...each swing frame draws leaf A at +yaw and leaf B at -yaw of "
        + "that frame", each);
  G.g_script_flags[SCRIPT_FLAG_TYPE35_RATTLE] = 0;
  for (let s = 2; s <= 5; s++) {
    G.g_evt_step_index = s;
    BreakablePropPoolUpdate(rng, events);
  }
  G.g_script_flags[SCRIPT_FLAG_TYPE35_RATTLE] = 1;
  door.routinePhase = Type35Phase.Count;
  const count = door.storyItem;
  G.g_evt_step_index = 6;
  BreakablePropPoolUpdate(rng, events);
  check("...retired by its prologue it does not count once more (ActorDespawn "
        + "does not return) and draws nothing",
        door.dead && door.storyItem === count && door.draws?.length === 0,
        `${door.storyItem} vs ${count}`);
}

console.log("\nclass 0x41 type 53, its draws and the camera-facing strips:");
{
  const rng = new Rng(5353);
  propScene(rng);
  G.g_evt_step_index = 1;
  G.g_evt_block_index = 2;
  const pos: [number, number, number] =
    [626.8999633789062, -71.0999984741211, -6422.599609375];
  const p = PlaceGenericProp({ at: 0x2fc0, container: "generic", type: 53,
    slot: 43, lifetime_evt_steps: 43, field_1f4: 6, pos, pitch: 0,
    yaw: -21845, roll: 0 }, rng);
  G.g_breakable_props.push(p);
  BreakablePropPoolUpdate(rng);
  check("type 53 draws its body alone outside blocks 4 and 5",
        p.draws?.length === 1 && p.draws[0].slot === 43);
  G.g_evt_block_index = 4;
  G.g_scene_tick_counter = 37;
  G.g_camera_block_eye.x = pos[0] + 100;
  G.g_camera_block_eye.y = 0;
  G.g_camera_block_eye.z = pos[2] - 50;
  BreakablePropPoolUpdate(rng);
  const d = p.draws ?? [];
  check("...in block 4: body, then tick%15+0x135F, then (tick&7)+0xB67",
        d.length === 3 && d[1].slot === 37 % 15 + TYPE53_STRIP_A_SLOT
        && d[2].slot === (37 & 7) + TYPE53_STRIP_B_SLOT,
        JSON.stringify(d.map((x) => x.slot)));
  const len = Math.hypot(100, -50);
  check("...both strips turn their +Z to the camera's eye about Y alone",
        Math.abs(d[1].m[8] - 100 / len) < 1e-3 && Math.abs(d[1].m[9]) < 1e-9
        && Math.abs(d[1].m[10] + 50 / len) < 1e-3
        && Math.abs(d[2].m[8] / 7 - 100 / len) < 1e-3);
  check("...strip A 5.0 up, strip B 8.0 up and 12.0 toward the eye, x7",
        d[1].m[13] === Math.fround(pos[1] + 5)
        && d[2].m[13] === Math.fround(pos[1] + 8)
        && Math.abs(d[2].m[12] - (pos[0] + 1200 / len)) < 1e-2
        && Math.abs(d[2].m[14] - (pos[2] - 600 / len)) < 1e-2);
  G.g_evt_block_index = 5;
  BreakablePropPoolUpdate(rng);
  check("...and in block 5", p.draws?.length === 3);
}

console.log("\nclass 0x41 type 54, its draw:");
{
  const rng = new Rng(5454);
  propScene(rng);
  const p = PlaceGenericProp({ at: 0x3010, container: "generic", type: 54,
    slot: 0x18a1, lifetime_evt_steps: 0x18a1, field_1f4: 5,
    pos: [583, -67, -7773.39990234375], pitch: 0, yaw: 0, roll: 0 }, rng);
  G.g_breakable_props.push(p);
  G.g_script_flags[SCRIPT_FLAG_TYPE54_DRIFT] = 1;
  BreakablePropPoolUpdate(rng);
  check("type 54 drifts first and draws where it drifted to",
        p.draws?.length === 1 && p.draws[0].slot === 0x18a1
        && p.draws[0].m[12] === 588 && p.draws[0].m[13] === p.y
        && p.y === Math.fround(-67 + 1.5));
  for (let i = 0; i < TYPE54_DRIFT_FRAMES; i++) BreakablePropPoolUpdate(rng);
  BreakablePropPoolUpdate(rng);
  check("...and the frame that kills it draws nothing",
        p.dead && p.draws?.length === 0);
}

console.log("\nclass 0x41 type 32, the lift's draw:");
{
  const rng = new Rng(32);
  const events = propScene(rng, GameMode.Arcade);
  const sounds: number[] = [];
  events.on("sound.play", (e) => sounds.push(e.id));
  const gate = PlaceGenericProp(
    { at: 0xbdc0, container: "generic", type: 32, slot: 2,
      lifetime_evt_steps: 2, pos: [-825.1, 40, -1871.7],
      pitch: 0, yaw: 0, roll: 0 }, rng);
  G.g_breakable_props.push(gate);
  BreakablePropPoolUpdate(rng, events);
  const s = (gate.draws ?? []).map((d) => d.slot);
  check("LiftUpdate draws the car, four leaves and the panel, in order",
        s.join() === [LIFT_CAR_SLOT, LIFT_LEAF_SLOT, LIFT_LEAF_SLOT,
                      LIFT_LEAF_SLOT, LIFT_LEAF_SLOT, LIFT_PANEL_SLOT].join(),
        s.map((x) => x.toString(16)).join());
  const [, l1, l2, , , panel] = (gate.draws ?? []).map((d) => d.m);
  check("...the near leaf at car + (9.619, 0.0451, -8.4127)",
        Math.abs(l1[12] - (gate.x + LIFT_HINGE_NEAR[0])) < 1e-4
        && Math.abs(l1[13] - (gate.y + LIFT_HINGE_NEAR[1])) < 1e-4
        && Math.abs(l1[14] - (gate.z + LIFT_HINGE_NEAR[2])) < 1e-4);
  // At rest the near pair's yaw is 0x4000, so the first leaf's x axis is -z
  // and its partner hangs 6.5 along it: +6.5 in z.
  check("...its partner 6.5 along the first leaf's turned x axis",
        Math.abs(l2[12] - l1[12]) < 1e-4 && Math.abs(l2[14] - (l1[14] + 6.5)) < 1e-4);
  check("...the panel on the car, not on a leaf: car + (-3.2134, 13 + 1, -2)",
        Math.abs(panel[12] - (gate.x + LIFT_PANEL_AT[0])) < 1e-4
        && Math.abs(panel[13] - (gate.y + 14)) < 1e-4
        && Math.abs(panel[14] - (gate.z - 2)) < 1e-4);
  check("...and no shot sphere", !gate.shotRegistered);

  G.g_camera_block_eye.y = 100.3;
  G.g_script_flags[LiftFlag.RideCamera] = 1;
  BreakablePropPoolUpdate(rng, events);
  check("flag 0x37: the floor is the float32 of eye - 15 (FSTP float)",
        gate.y === Math.fround(100.3 - LIFT_RIDE_DROP), `${gate.y}`);
  // `CMP [ESI+0x2A0],0x28 ; JL`: the panel swings on the frame the count of
  // flag 0x6B reaches 0x28, the 40th.
  G.g_script_flags[LiftFlag.OpenNear] = 1;
  for (let i = 0; i < 39; i++) BreakablePropPoolUpdate(rng, events);
  check("after 39 frames of flag 0x6B the panel has not moved",
        gate.pitch === LIFT_PANEL_CLOSED && !sounds.includes(SFX_LIFT_PANEL));
  BreakablePropPoolUpdate(rng, events);
  check("...on the 40th it swings, with its sound",
        gate.pitch === LIFT_PANEL_CLOSED + LIFT_HINGE_STEP
        && sounds.filter((x) => x === SFX_LIFT_PANEL).length === 1);
  for (let b = 1; b <= 3; b++) {
    G.g_evt_step_index = b;
    BreakablePropPoolUpdate(rng, events);
  }
  check("...and the frame it retires it draws nothing",
        gate.dead && gate.draws?.length === 0);
}

console.log("\nclass 0x41 type 43, PlaceGenericProp case 0x2B and its routine:");
{
  const W = (p: BreakableProp): Type43Words => PropWords(p, TYPE43_WORDS_ZERO);
  const ahead = (r: Rng, n: number): number => {
    const t = new Rng(0); t.state = r.state;
    for (let i = 0; i < n; i++) t.next();
    return t.state;
  };
  {
    const rng = new Rng(4343);
    propScene(rng, GameMode.Arcade);
    const expect = ahead(rng, 4);
    const twin = new Rng(0); twin.state = rng.state;
    const s1 = 0x60 - twin.int(2) * 0xa0 - twin.int(0x21);
    const s2 = 0x60 - twin.int(2) * 0xa0 - twin.int(0x21);
    const p = PlaceGenericProp({
      at: 0xc300, container: "generic", type: 43, slot: 2,
      lifetime_evt_steps: 2, field_1f4: 1, pos: [-376.4, -28, -2609],
      pitch: 7, yaw: 0x4000, roll: 3,
    }, rng);
    check("the arm draws four rand()s, not the re-seed's five",
          rng.state === expect);
    check("...each spin 0x60 - 0xA0*(rand()&1) - rand()%0x21",
          p.spin === s1 && p.rollSpin === s2, `${p.spin} ${p.rollSpin}`);
    check("...a literal 1.5 amplitude and a 0x200 step",
          p.shake === 1.5 && p.yawSpin === 0x200);
    check("...the kind and the set in the object's own words, the type in kind",
          W(p).o290 === 3 && W(p).o194 === 1 && p.kind === 43);
    check("...and the shot rise from row (s8)placer+0x131B = 0, not the kind",
          p.restHeight === (BREAKABLES.kinds[0]?.y_offset ?? -1));
  }
  {
    const rng = new Rng(43);
    const events = propScene(rng, GameMode.Arcade);
    const sounds: number[] = [];
    events.on("sound.play", (e) => sounds.push(e.id));
    const p = PlaceGenericProp({
      at: 0xc400, container: "generic", type: 43, slot: 3,
      lifetime_evt_steps: 3, field_1f4: 1, pos: [10, 20, 30],
      pitch: 0, yaw: 0x4000, roll: 3,
    }, rng);
    G.g_breakable_props.push(p);
    BreakablePropPoolUpdate(rng, events);
    const body = MatIdentity();
    MatrixTranslate(body, p.x, p.y, p.z);
    MatrixRotateZ(body, p.roll);
    MatrixRotateY(body, p.yaw);
    MatrixRotateX(body, p.pitch);
    check("PropUpdateType43 draws the crate at this frame's tumble",
          p.draws?.length === 1 && p.draws[0].slot === BreakableSlot.Default
          && p.draws[0].m.every((v, i) => Math.abs(v - body[i]) < 1e-5));
    check("...and registers at y + row 0's rise", p.shotRegistered
          && p.shotY === Math.fround(p.y + p.restHeight));
    check("...the bob in float32: frame 1 on its centre", p.y === 20);
    BreakablePropPoolUpdate(rng, events);
    check("...frame 2 at f32(sin(0x200 BAMS) * 1.5 + 20)",
          p.y === Math.fround(Math.sin(0x200 * 2 * Math.PI / 65536) * 1.5 + 20));

    G.g_camera_block_yaw_bams = 0x2000;
    p.hitAim = { x: 1, y: 2 };
    const fx = G.g_sprite_effects.length;
    sounds.length = 0;
    BreakablePropTakeShot(p, 0);
    BreakablePropPoolUpdate(rng, events);
    check("the crack sounds the kind's 0x1A16A9 and throws impact and spark",
          sounds[0] === 0x1a16a9 && G.g_sprite_effects.length === fx + 2
          && p.slot === BreakableSlot.Broken && p.yaw === 0x2000);
    check("...and a cracked crate is not drawn as 0x19E6 (it draws effect 0)",
          (p.draws ?? []).every((d) => d.slot !== BreakableSlot.Broken));
    const fx1 = G.g_sprite_effects.length;
    BreakablePropTakeShot(p, 0);
    BreakablePropPoolUpdate(rng, events);
    check("the break: radius 5, rise 1.5, an impact and no spark",
          p.hitRadius === 5 && p.restHeight === 1.5 && p.effectFrames === 2
          && G.g_sprite_effects.length === fx1 + 1
          && p.shotY === Math.fround(1.5 + p.y));
    check("...a set-1 wreck floats the heart 0x10C3 three above it",
          (p.draws ?? []).some((d) => d.slot === 0x10c3
                        && Math.abs(d.m[13] - Math.fround(p.y + 3)) < 1e-5));
    G.g_camera_view_to_world = MatIdentity();
    MatrixTranslate(G.g_camera_view_to_world, 5, 6, 7);
    MatrixRotateY(G.g_camera_view_to_world, 0x3000);
    const lives = G.g_player_lives[0];
    BreakablePropTakeShot(p, 0);
    BreakablePropPoolUpdate(rng, events);
    const tag = p.draws?.find((d) => d.slot === TYPE43_PICKUP_TAG);
    check("the wreck shot: a life, the heart, the tag and strip frame 0",
          G.g_player_lives[0] === lives + 1
          && (p.draws ?? []).map((d) => d.slot).join()
             === [0x10c3, TYPE43_PICKUP_TAG, TYPE43_PICKUP_SLOT].join());
    check("...the tag billboarded: the camera's axes, scaled 1.5",
          !!tag && [0, 1, 2, 4, 5, 6, 8, 9, 10].every((i) =>
            Math.abs(tag.m[i] - G.g_camera_view_to_world[i] * 1.5) < 1e-5)
          && Math.abs(tag.m[13] - Math.fround(p.y + 4)) < 1e-5);
    for (let i = 0; i < 47; i++) BreakablePropPoolUpdate(rng, events);
    check("...the strip runs to frame 47 alive",
          !p.dead && p.draws?.[2]?.slot === TYPE43_PICKUP_SLOT + 47);
    BreakablePropPoolUpdate(rng, events);
    check("...and the prop goes after drawing frame 48",
          p.dead && p.draws?.[2]?.slot === TYPE43_PICKUP_SLOT + 48);
    G.g_camera_view_to_world = MatIdentity();
  }
  {
    // A kind 2 hiding nothing goes when g_motion_play_length[469] - 2 passes.
    const rng = new Rng(143);
    const events = propScene(rng, GameMode.Arcade);
    const p = PlaceGenericProp({
      at: 0xc500, container: "generic", type: 43, slot: 2,
      lifetime_evt_steps: 2, field_1f4: 0, pos: [0, 0, 0], roll: 2,
    }, rng);
    G.g_breakable_props.push(p);
    BreakablePropPoolUpdate(rng, events);
    check("a kind 2 draws 0x17A9 lifted 0.8 in its own frame",
          p.draws?.length === 1 && p.draws[0].slot === TYPE43_EFFECT7_SLOT);
    BreakablePropTakeShot(p, 0);
    BreakablePropPoolUpdate(rng, events);
    for (let i = 0; i < 70; i++) BreakablePropPoolUpdate(rng, events);
    check("...and is still up at cursor 72 (0x4A - 2)", !p.dead && p.effectFrames === 72);
    BreakablePropPoolUpdate(rng, events);
    check("...and gone at 73", p.dead);
  }
  {
    // The re-seed, once a whole turn: 127 frames draw nothing, the 128th five.
    const rng = new Rng(11);
    const events = propScene(rng, GameMode.Arcade);
    const p = PlaceGenericProp({
      at: 0xc600, container: "generic", type: 43, slot: 9,
      lifetime_evt_steps: 9, field_1f4: 0, pos: [0, 0, 0], roll: 3,
    }, rng);
    G.g_breakable_props.push(p);
    for (let i = 0; i < 127; i++) BreakablePropPoolUpdate(rng, events);
    const expect = ahead(rng, 5);
    BreakablePropPoolUpdate(rng, events);
    check("the bob re-seeds on the 128th frame with five rand()s",
          rng.state === expect && p.shake !== 1.5);
  }
  {
    // Set 2 in Original Mode: PickOriginalModeItem at the break, one rand().
    const rng = new Rng(9);
    const events = propScene(rng, GameMode.Original);
    SetGameTables(CHARS, { ...BREAKABLES, original_items: ORIGINAL_ITEMS_SCENE2 });
    G.g_scene_index = 2;
    const p = PlaceGenericProp({
      at: 0xc700, container: "generic", type: 43, slot: 9,
      lifetime_evt_steps: 9, field_1f4: 2, pos: [0, 0, 0], roll: 2,
    }, rng);
    G.g_breakable_props.push(p);
    BreakablePropPoolUpdate(rng, events);
    BreakablePropTakeShot(p, 0);
    const t = new Rng(0); t.state = rng.state;
    const id = [17, 17, 20, 28, -1][t.int(5)];
    BreakablePropPoolUpdate(rng, events);
    check("an Original Mode set-2 break picks from scene 2's row 0",
          W(p).o290 === id, `${W(p).o290} vs ${id}`);
  }
}

console.log("\nclass 0x41 type 34, PlaceGenericProp case 0x22:");
{
  const rng = new Rng(34);
  const events = propScene(rng, GameMode.Arcade);
  let cracked = -1;
  events.on("prop.cracked", (e) => { cracked = e.sound; });
  const t = new Rng(0); t.state = rng.state;
  const count = t.int(2) + 1;
  // Stage 1 evt 0x3A7C, as the descriptor holds it.
  const c = PlaceGenericProp({
    at: 0x3a7c, container: "generic", type: 34, slot: 5,
    lifetime_evt_steps: 5, field_1f4: 3, pos: [-665, -8.1, -490],
    pitch: 2, yaw: 0x4000, roll: 0,
  }, rng);
  G.g_breakable_props.push(c);
  check("type 34 runs FallingContainerUpdate: two shots, 0xA50, radius 8",
        c.family === PropFamily.Falling && c.hp === 2
        && c.slot === FALLING_SLOT_WHOLE && c.hitRadius === 8);
  check("...lifetime (u8)placer+0x11C in +0x199, set desc+0x24, story -1",
        c.lifetime === 5 && c.itemSet === 3 && c.storyItem === -1);
  check("...the set-size word stays on as its pitch, which selector 16 zeroes",
        c.pitch === 2 && c.yaw === 0x4000 && c.roll === 0);
  check("...and seeds the countdown rand() % 2 + 1",
        G.g_item_set_countdown[3] === count);
  BreakablePropPoolUpdate(rng, events);
  check("standing, it draws 0xA50 and registers at its origin",
        c.draws?.length === 1 && c.draws[0].slot === FALLING_SLOT_WHOLE
        && c.shotRegistered && c.shotY === c.y);
  BreakablePropTakeShot(c, 0);
  BreakablePropPoolUpdate(rng, events);
  check("the knock clears the hit bit itself and leaves one shot",
        cracked === SFX_FALLING_KNOCKED && (c.flags & BreakableFlag.Hit) === 0
        && c.hp === 1 && c.slot === FALLING_SLOT_LOOSE);
  BreakablePropPoolUpdate(rng, events);
  check("...and the next frame does not break it", !c.dead && c.hp === 1);
}
{
  const rng = new Rng(35);
  const events = propScene(rng, GameMode.Arcade);
  const c = PlaceGenericProp({
    at: 0x5448, container: "generic", type: 34, slot: 1,
    lifetime_evt_steps: 1, field_1f4: 0, pos: [0, 10, 0],
    pitch: 0, yaw: 0, roll: 0,
  }, rng);
  G.g_breakable_props.push(c);
  G.g_evt_step_index = 1;
  BreakablePropPoolUpdate(rng, events);
  check("a type-34 container's lifetime is +0x199, not the shots in +0x11C",
        !c.dead);
  G.g_evt_step_index = 2;
  BreakablePropPoolUpdate(rng, events);
  check("...and it goes on the second step change with two shots left",
        c.dead && c.hp === 2);
}

console.log("\nclass 0x41 types 7, 20, 58 and 60, transcribed whole:");
{
  const world = (ops: (m: number[]) => void): number[] => {
    const m = MatIdentity(); ops(m); return m;
  };
  const same = (a: number[] | undefined, b: number[]): boolean =>
    !!a && a.length === 16 && a.every((v, i) => Math.abs(v - b[i]) < 1e-6);
  const put = (pl: Partial<BreakablePlacement>, rng: Rng): BreakableProp => {
    const p = PlaceGenericProp({ at: 0x1000, container: "generic",
                                 lifetime_evt_steps: 0, ...pl } as
                               BreakablePlacement, rng);
    G.g_breakable_props.push(p);
    return p;
  };
  const listen = (events: Events) => {
    const sounds: number[] = [];
    const released: { kind?: number; y: number }[] = [];
    const pickups: unknown[] = [];
    events.on("sound.play", (d) => sounds.push(d.id));
    events.on("item.released", (d) => released.push(d));
    events.on("prop.pickup", (d) => pickups.push(d));
    return { sounds, released, pickups };
  };

  // -- type 7 ---------------------------------------------------------------
  {
    const rng = new Rng(7);
    const events = propScene(rng, GameMode.Arcade);
    const { sounds } = listen(events);
    G.g_scene_index = 0;
    // Stage 1's one spawn: (0, 102, -54), descriptor +0x11C = 2.
    const p = put({ type: 7, pos: [0, 102, -54], slot: 2,
                    lifetime_evt_steps: 2 }, rng);
    check("type 7: the arm sets the radius, 12.0", p.hitRadius === 12);
    BreakablePropPoolUpdate(rng, events);
    check("type 7: it draws 0x1736 at its origin",
          p.draws?.length === 1 && p.draws[0].slot === TYPE07_SLOT
          && same(p.draws[0].m, world((m) => MatrixTranslate(m, 0, 102, -54))));
    check("type 7: the sphere is 57.0 below the origin",
          p.shotRegistered && p.shotY === 45);
    for (let i = 0; i < 4; i++) {
      G.g_evt_step_index += 1; BreakablePropPoolUpdate(rng, events);
    }
    check("type 7: a literal lifetime of 4 step changes, not +0x11C's 2",
          !p.dead);
    G.g_evt_step_index += 1; BreakablePropPoolUpdate(rng, events);
    check("type 7: the fifth change retires it and it draws nothing",
          p.dead && p.draws?.length === 0 && sounds.length === 0);
  }
  {
    const rng = new Rng(99);
    const events = propScene(rng, GameMode.Arcade);
    const { sounds } = listen(events);
    G.g_scene_index = 1;
    G.g_script_flags[0x77] = 1;
    const p = put({ type: 7, pos: [0, 102, -54], lifetime_evt_steps: 2 }, rng);
    BreakablePropPoolUpdate(rng, events);
    check("type 7: no scene-1 sweep", !p.dead);
    const twin = new Rng(rng.state);
    BreakablePropTakeShot(p, 0);
    BreakablePropPoolUpdate(rng, events);
    const r1 = twin.int(0x201);
    const r2 = twin.int(0x401) - 0x200;
    const pr = r1 - Math.trunc(r1 / 48);
    const rr = r2 - Math.trunc(r2 / 48);
    check("type 7: a hit plays BULLET_MET1 and pays nothing",
          sounds[0] === SFX_TYPE07_HIT && G.g_player_score[0] === 0);
    check("type 7: rates rand() % 0x201 and rand() % 0x401 - 0x200, one spring step",
          p.spin === pr && p.rollSpin === rr
          && p.pitch === Math.trunc(pr / 4) && p.roll === Math.trunc(rr / 4),
          `${p.spin}/${pr} ${p.rollSpin}/${rr}`);
    check("type 7: the draw is T; RotZ(roll); RotX(pitch)",
          same(p.draws?.[0]?.m, world((m) => {
            MatrixTranslate(m, 0, 102, -54); MatrixRotateZ(m, p.roll);
            MatrixRotateX(m, p.pitch);
          })));
    check("type 7: all three hit bits are clear, and no item in Arcade",
          (p.flags & 0xe) === 0 && G.g_breakable_props.length === 1);
    p.spin = -7; p.pitch = 0; p.rollSpin = 0; p.roll = 0;
    BreakablePropPoolUpdate(rng, events);
    check("type 7: the /4 truncates toward zero", p.pitch === -1);
  }

  // -- type 7's Original Mode item ------------------------------------------
  {
    const rng = new Rng(5);
    const events = propScene(rng, GameMode.Original);
    SetGameTables(CHARS, { ...BREAKABLES, original_items: ORIGINAL_ITEMS_SCENE0 });
    const { sounds } = listen(events);
    G.g_scene_index = 0;
    G.g_camera_fixed_eye_y = 6.5;
    const p = put({ type: 7, pos: [0, 102, -54], lifetime_evt_steps: 2 }, rng);
    BreakablePropTakeShot(p, 0);
    BreakablePropPoolUpdate(rng, events);
    const item = G.g_breakable_props.find((q) => q !== p);
    check("type 7: Original Mode's first hit drops an item",
          item?.family === PropFamily.OriginalItemDrop && p.storyItem === 1);
    if (item) {
      check("type 7 item: made at (x, 38.0, z + 1.0), radius 3, lifetime +0x11C + 2",
            item.x === 0 && item.z === -53 && item.hitRadius === 3
            && item.lifetime === 4);
      check("type 7 item: scene 0 set 0 picks 3, 4, 16 or 17",
            [3, 4, 16, 17].includes(item.words.o290));
      BreakablePropTakeShot(p, 0);
      BreakablePropPoolUpdate(rng, events);
      check("type 7: a second hit drops nothing",
            G.g_breakable_props.length === 2);
      let n = 0, y = 38, v = 0;
      const g = Math.fround(0.04083);
      for (;;) { n++; y = Math.fround(y + v); v = Math.fround(v - g); if (7.5 > y) break; }
      // The item already ran twice (the frame it was made and the one above).
      let frames = 2, guard = 0;
      while (item.routinePhase === OriginalItemDropPhase.Fall && guard++ < 999) {
        BreakablePropPoolUpdate(rng, events); frames++;
      }
      check(`type 7 item: it bounces at floor + 1.0 on frame ${n}`,
            frames === n && item.y === 7.5 && item.shake === Math.fround(0.7),
            `${frames}`);
      guard = 0;
      while (item.routinePhase === OriginalItemDropPhase.Bounce && guard++ < 999) {
        BreakablePropPoolUpdate(rng, events);
      }
      check("type 7 item: it lands on the floor, level",
            item.y === 6.5 && item.pitch === 0 && item.roll === 0);
      const d = item.draws ?? [];
      const s = item.words.o2c4;
      check("type 7 item: model, billboard, shadow",
            d.length === 3 && d[0].slot === item.slot
            && same(d[0].m, world((m) => {
              MatrixTranslate(m, item.x, item.y, item.z);
              MatrixRotateY(m, item.yaw); MatrixRotateZ(m, item.roll);
              MatrixScale(m, s, s, s);
            }))
            && d[2].slot === 0x10d0 && same(d[2].m, world((m) => {
              MatrixTranslate(m, item.x, Math.fround(6.5 + Math.fround(0.2)),
                              item.z);
              MatrixScale(m, 3, 1, 3);
            })));
      check("type 7 item: its sphere is 1.5 above it",
            item.shotRegistered && item.shotY === 8);
      sounds.length = 0;
      const id = item.words.o290;
      const taken = G.g_original_items_taken[id] ?? 0;
      BreakablePropTakeShot(item, 0);
      BreakablePropPoolUpdate(rng, events);
      check("type 7 item: a shot takes it once, player 0's strip",
            sounds[0] === SFX_ORIGINAL_ITEM_PICKUP
            && item.removeFlag === 0x116a && item.storyItem === 1
            && (item.draws ?? []).some((c) => c.slot === 0x116a)
            && (item.flags & 0xa) === 0xa);
      check("type 7 item: ...counted into g_original_items_taken, with the "
            + "record's banner",
            G.g_original_items_taken[id] === taken + 1
            && G.g_original_item_banners.length === 1
            && G.g_original_item_banners[0].sprite
              === ORIGINAL_ITEMS_SCENE0.records[
                String(id) as keyof typeof ORIGINAL_ITEMS_SCENE0.records]
                .sprite);
      let alive = 1, faded: number | undefined;
      while (!item.dead && alive < 200) {
        BreakablePropPoolUpdate(rng, events);
        if (!item.dead) alive++;
        if (item.storyItem === 25) {
          faded = (item.draws?.[0] as unknown as { alpha?: number }).alpha;
        }
      }
      check("type 7 item: 49 pickup frames, faded from 25, then gone",
            alive === 49 && item.dead && G.g_original_items_taken[id] === taken + 1
            && faded === Math.fround(1 - 25 * Math.fround(0.02)),
            `${alive} ${faded}`);
    }
    const probe = (r: number): number => {
      const q = { words: {}, slot: 0 } as unknown as BreakableProp;
      PickOriginalModeItem(q, 0, { int: () => r } as unknown as Rng);
      return q.words.o290;
    };
    check("PickOriginalModeItem: weights 6/7/13/14 over ids 3/4/16/17",
          [0, 5, 6, 7, 12, 13].map(probe).join() === "3,3,4,16,16,17");
  }

  // -- type 20 ---------------------------------------------------------------
  {
    const rng = new Rng(20);
    const events = propScene(rng, GameMode.Arcade);
    const { sounds } = listen(events);
    const p = put({ type: 20, pos: [-648.5, 67, -1325], slot: 4,
                    lifetime_evt_steps: 4, yaw: 0x4000 }, rng);
    check("type 20: the arm, radius 7.0 and rate 0x100",
          p.hitRadius === 7 && p.yawSpin === 0x100);
    BreakablePropPoolUpdate(rng, events);
    check("type 20: turns by obj+0x68 alone; the descriptor's yaw is ignored",
          p.draws?.length === 1 && p.draws[0].slot === TYPE20_SLOT
          && same(p.draws[0].m, world((m) => {
            MatrixTranslate(m, -648.5, 67, -1325); MatrixRotateY(m, 0x100);
          })));
    check("type 20: the sphere is 1.0 below", p.shotY === 66);
    BreakablePropTakeShot(p, 0);
    BreakablePropPoolUpdate(rng, events);
    check("type 20: a hit adds 0x400, the frame takes 0x20",
          p.yawSpin === 0x4e0 && sounds[0] === SFX_TYPE20_HIT);
    let f = 1;
    while (p.yawSpin > 0x180 && f < 99) { BreakablePropPoolUpdate(rng, events); f++; }
    for (let i = 0; i < 10; i++) BreakablePropPoolUpdate(rng, events);
    check("type 20: it settles at 0x180 in 28 frames and stays there",
          f === 28 && p.yawSpin === 0x180);
  }

  // -- type 58 ---------------------------------------------------------------
  {
    const rng = new Rng(58);
    const events = propScene(rng, GameMode.Arcade);
    const { sounds, released } = listen(events);
    const p = put({ type: 58, pos: [-600.8, 46, -1288.7], slot: 5,
                    lifetime_evt_steps: 5, field_1f4: 4 }, rng);
    check("type 58: the arm sets the radius, 3.0", p.hitRadius === 3);
    BreakablePropPoolUpdate(rng, events);
    check("type 58: 0x1D1 at its origin, and the sphere there",
          p.draws?.[0]?.slot === TYPE58_SLOT && p.shotY === 46);
    const x0 = p.x;
    BreakablePropTakeShot(p, 0);
    BreakablePropPoolUpdate(rng, events);
    check("type 58: the shot pays 10, plays BULLET_WOD1 and knocks it away",
          G.g_player_score[0] === PROP_HIT_SCORE && sounds[0] === SFX_TYPE58_HIT
          && p.routinePhase === Type58Phase.Fly
          && p.x === Math.fround(x0 + 0.5) && p.pitch === 0x200);
    check("type 58: bit 3 cleared, the player's bit never",
          (p.flags & 8) === 0 && (p.flags & 2) !== 0);
    let fall = -1;
    for (let i = 2; i <= 12; i++) {
      const y = p.y; BreakablePropPoolUpdate(rng, events);
      if (p.y !== y && fall < 0) fall = i;
    }
    check("type 58: Arcade drifts nine frames and falls from the tenth",
          fall === 10 && released.length === 0, `${fall}`);
    BreakablePropTakeShot(p, 1);
    BreakablePropPoolUpdate(rng, events);
    check("type 58: one shot only", sounds.length === 1
          && G.g_player_score[1] === 0);
  }
  {
    const rng = new Rng(58);
    const events = propScene(rng, GameMode.Original);
    const { released } = listen(events);
    const p = put({ type: 58, pos: [-600.8, 46, -1288.7],
                    lifetime_evt_steps: 5 }, rng);
    BreakablePropTakeShot(p, 0);
    BreakablePropPoolUpdate(rng, events);
    check("type 58: Original releases story item 9 at y 44.2 and falls at once",
          released.length === 1 && released[0].kind === 9
          && released[0].y === Math.fround(44.2)
          && p.y === Math.fround(46 - Math.fround(0.02722)));
  }

  // -- type 60 ---------------------------------------------------------------
  {
    const rng = new Rng(60);
    const events = propScene(rng, GameMode.Arcade);
    const { sounds } = listen(events);
    const p = put({ type: 60, pos: [-642.53, 41.51, -1268.14], slot: 4,
                    lifetime_evt_steps: 4, yaw: 4096 }, rng);
    check("type 60: the arm sets the radius, 2.0", p.hitRadius === 2);
    BreakablePropPoolUpdate(rng, events);
    check("type 60: T; Rz; Ry(yaw); Rx; Scale(0.25, 0.5, 0.25); 0x1D8",
          p.draws?.[0]?.slot === TYPE60_SLOT
          && same(p.draws[0].m, world((m) => {
            MatrixTranslate(m, -642.53, 41.51, -1268.14); MatrixRotateY(m, 4096);
            MatrixScale(m, 0.25, 0.5, 0.25);
          })));
    const twin = new Rng(rng.state);
    const x0 = p.x, y0 = p.y;
    BreakablePropTakeShot(p, 0);
    BreakablePropPoolUpdate(rng, events);
    const r = twin.int(11);
    check("type 60: the shot sets its speeds and does not move it yet",
          sounds[0] === SFX_TYPE60_HIT && p.routinePhase === Type60Phase.Fly
          && p.vx === Math.fround(r * Math.fround(0.1) - 0.5)
          && p.vy === Math.fround(0.3) && p.vz === 0.5
          && p.x === x0 && p.y === y0);
    check("type 60: no award, and no hit bit is ever cleared",
          G.g_player_score[0] === 0 && G.g_player_hit_count[0] === 0
          && (p.flags & 0xa) === 0xa);
    BreakablePropPoolUpdate(rng, events);
    check("type 60: then it flies, falls and tumbles 0x400",
          p.x === Math.fround(p.vx + x0) && p.pitch === 0x400
          && p.y === Math.fround(Math.fround(0.3) - Math.fround(0.02722) + y0));
  }
}
