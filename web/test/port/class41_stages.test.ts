import type { BreakablePlacement } from "../../src/bundle";
import { Rng } from "../../src/core/rng";
import { Events } from "../../src/core/events";
import { ActorSpawn, GameUpdate } from "../../src/game/director";
import { CheckpointResetCamera } from "../../src/game/camera/actions";
import { CameraResetForPathShot } from "../../src/game/camera/mode";
import { G } from "../../src/game/globals";
import { NULL_HOST } from "../../src/game/host";
import {
  MatIdentity, MatrixRotateX, MatrixRotateY, MatrixRotateZ, MatrixTranslate,
} from "../../src/game/matrix";
import { SetGameTables } from "../../src/game/tables";
import { SpawnClass } from "../../src/game/spawn_class";
import { GameMode } from "../../src/game/game_mode";
import {
  BreakableState, BreakableFlag, BreakablePropTakeShot, BreakableSlot, ItemSet,
  PlaceBreakableGroup, PropContainerPlacerUpdate, PlaceKindedProp, PropFamily,
  KIND_SLOT, SLOT_NONE, PlaceGenericProp, LiftUpdate, LiftFlag,
  LIFT_NEAR_CLOSED, LIFT_NEAR_OPEN, LIFT_FAR_CLOSED, LIFT_PANEL_CLOSED,
  LIFT_PANEL_OPEN, LIFT_PANEL_DELAY, LIFT_RIDE_DROP, LIFT_HINGE_STEP,
  SFX_LIFT_GATE, SFX_LIFT_PANEL, PropExpireByStepLifetime, GENERIC_DRAW_SLOT,
  GENERIC_DESCRIPTOR_SLOT, GENERIC_LIFETIME_FROM_1F4, makeBreakableProp,
  type BreakableProp, PROP75_RIDE_LENGTH, PROP75_PATH, PROP75_SLOT,
  SFX_PROP75_HIT, SFX_PROP75_RIDE, SFX_PROP75_RIDE_END, PickOriginalModeItem,
  ORIGINAL_ITEM_BOBS, ORIGINAL_ITEM_PICKUP_SLOT, ORIGINAL_ITEM_PICKUP_SLOT_P1,
  ORIGINAL_ITEM_TAKEN, SFX_ORIGINAL_ITEM_PICKUP, ORIGINAL_ITEM_FACING_SLOT,
  OriginalItemBannersTick, ITEM_BANNER_FRAMES, ITEM_BANNER_FRAME_SPRITE,
  Type72Phase, TYPE72_CUE_CAM_FRAME, TYPE72_CUE_CAM_PATH, TYPE72_GRAVITY,
  TYPE72_SCRIPT_FLAG, TYPE72_THROW, Type74Phase, TYPE74_DROP_AT,
  TYPE74_GATE_FLAG, TYPE74_SCRIPT_FLAG, TYPE74_SLOT, SFX_TYPE74_HIT,
  Type76Phase, TYPE76_PAIR_A_AT, TYPE76_PAIR_B_AT, TYPE76_PAIR_PLATE_AT,
  TYPE76_PAIR_YAW, SFX_TYPE76_HIT, SFX_TYPE76_OPEN, Type77Phase, TYPE77_PATH,
  TYPE77_SCORE, TYPE77_SLOT, SFX_TYPE77_APPEAR, SFX_TYPE77_LEAVE,
  SFX_TYPE77_SHOT,
} from "../../src/game/class41";
import { BreakablePropPoolUpdate } from "../../src/game/class41/pool";
import { GENERIC_ROUTINES } from "../../src/game/class41/generic_routines";
import { COLLECTIBLE_WORDS_ZERO } from "../../src/game/class41/original_item";
import { HiddenItemCopy, ReleaseHiddenItem } from "../../src/game/class41/items";
import {
  SCRIPT_FLAG_TYPE13_DROP, SFX_TYPE13_BEEP, SFX_TYPE13_LAND,
  SFX_TYPE13_RELEASE, TYPE13_FLOOR_Y, TYPE13_PANEL_LIT_SLOT,
  TYPE13_PANEL_SLOT, Type13Phase,
} from "../../src/game/class41/type13";
import {
  SCRIPT_FLAG_TYPE35_RATTLE, SCRIPT_FLAG_TYPE35_STILL, SFX_TYPE35_KNOCK,
  Type35Phase,
} from "../../src/game/class41/type35";
import { ClearPropShotTestList } from "../../src/game/class41/shot_test";
import { MatrixScale } from "../../src/game/matrix";
import { PropWords } from "../../src/game/class41/words";
import { TYPE13_JUDDER } from "../../src/game/class41/type13";
import { PlaceChainSegments } from "../../src/game/class41/triggers";
import {
  MatrixFromZYX, MatrixInterpolateSwingTwist, MatrixToZYX,
} from "../../src/game/class44/swing_twist";
import { EffectSampleNode } from "../../src/game/class44/script_flag_effect";
import {
  PlaceFragmentProps, FRAGMENT_BURST_FRAMES, FRAGMENT_BURST_PIECES,
  FRAGMENT_SUBKIND0_SLOT, FRAGMENT_SUBKIND0_SLOT_HIT,
} from "../../src/game/class41/type40";
import {
  PROP_TABLE38, TYPE38_SLOT, TYPE38_SLOT_HIT, Type38State,
} from "../../src/game/class41/type38";
import { Type39StackHeight } from "../../src/game/class41/type39";
import { PROP_TABLE50, PROP_TABLE50_SCALE_Z } from "../../src/game/class41/type50";
import {
  PROP_TABLE66_A, PROP_TABLE66_B, SFX_TYPE66_HIT,
} from "../../src/game/class41/type66";
import {
  TYPE44_WHOLE_SLOT, TYPE44_EFFECT,
} from "../../src/game/class41/type44";
import {
  BamsHalfway, PropBuildScriptFlagEffect, ScriptFlagEffectFlag,
  ScriptFlagEffectUpdate, SFX_SCRIPT_FLAG_EFFECT, PropBuildRisingDoor,
  RisingDoorUpdate, RisingDoorRise, RisingDoorRattles, RISING_DOOR_CEILING,
  RISING_DOOR_CEILING_OTHER, RISING_DOOR_RATTLE_SLOT, RISING_DOOR_STEP_OTHER,
  Class44Selector, PropBuildRiseToHeight, RiseToHeightUpdate,
  PropDrawOnlySelector14,
  RISE_TO_HEIGHT_KILL_FRAME, RISE_TO_HEIGHT_KILL_PATH,
  PropBuildSlideOnFlag, SlideOnFlagUpdate, SLIDE_CAR_X, SLIDE_CAR_Y_BLOCK0,
  SLIDE_CAR_Z, PropBuildFlagLiftedProp, FlagLiftedPropUpdate,
} from "../../src/game/class44";
import {
  PlaceType47Prop, PropUpdateType47, TYPE47_KILL_FLAG,
} from "../../src/game/class41/type47";
import { TYPE47_SLOT } from "../../src/game/class41/type47_slots";
import { SpawnPropContainers } from "../../src/game/director";
import { CamPaths } from "../../src/game/camera/curve";
import { SetCameraPaths } from "../../src/game/tables";
import {
  check, CHARS, BREAKABLES, ORIGINAL_ITEMS_SCENE2, propScene, shoot,
} from "./harness";

/**
 * `*g_pHingeCurvesXYZ`: curve 0's first five frames as the EXE has them, then
 * a synthetic tail that holds the last -- what `PropUpdateType76` swings on.
 */
const HINGE_CURVE_0_HEAD = Array.from({ length: 60 }, (_, i) => (
  [[0, 0, 0], [55, 2989, 55], [195, 5700, 195], [383, 8155, 383],
   [585, 10377, 585]][Math.min(i, 4)]));

console.log("\nclass 0x44 selector 0, the effect the script flag plays:");
{
  const rng = new Rng(0x44);
  const PL = BREAKABLES.placements.find(
    (q) => q.container === "script_flag_effect")!;
  const build = () => PropBuildScriptFlagEffect(
    PL.at, PL.effect!, PL.capture_bone!, PL.motion!);
  /**
   * The one prop the effect places, or a dead stand-in.
   *
   * A stand-in rather than a throw because the failure this guards is
   * "the exporter emitted nothing", and a `TypeError` out of the harness ends
   * the run at the first of a dozen checks instead of reporting them.
   */
  const only = (): BreakableProp =>
    G.g_breakable_props[0] ?? makeBreakableProp(-1, 0, 0);

  // The whole of the bug: the exporter emitted nothing for a class-0x44
  // selector-0 spawn, so nothing was placed and nothing was drawn. This fails
  // without the `effects` block, without the placement and without the
  // builder -- `PropBuildScriptFlagEffect` returns an empty array for all
  // three.
  {
    propScene(rng);
    const made = build();
    check("the placer builds one prop per drawable node", made.length === 1,
          `${made.length} props`);
    check("...and it draws the tree's own slot, not the descriptor's",
          made[0]?.slot === 0x13f5, `0x${(made[0]?.slot ?? 0).toString(16)}`);
    check("...seated at motion 471 key 0 rather than at the spawn position",
          made[0]?.x === -13 && made[0]?.z === -362,
          `${made[0]?.x}, ${made[0]?.y}, ${made[0]?.z}`);
  }

  // `if (g_script_flags[0x12] && cursor < play_length - 2) cursor++`.
  {
    propScene(rng);
    const events = new Events();
    G.g_breakable_props.push(...build());
    const p = only();
    for (let i = 0; i < 3; i++) ScriptFlagEffectUpdate(p, events);
    check("the clip does not run with the flag down", p.effectFrames === 0,
          String(p.effectFrames));

    G.g_script_flags[ScriptFlagEffectFlag.Advance] = 1;
    ScriptFlagEffectUpdate(p, events);
    check("the flag starts it", p.effectFrames === 1, String(p.effectFrames));
    // An odd cursor is half way between key 0 and key 1: x from -13 to -3,
    // and the yaw from 0 to 0x4000.
    check("...an odd cursor blends half way to the next key",
          p.x === -8 && p.yaw === 0x2000, `${p.x} yaw ${p.yaw}`);
    ScriptFlagEffectUpdate(p, events);
    check("...and an even one sits on the key",
          p.effectFrames === 2 && p.x === -3 && p.yaw === 0x4000,
          `${p.effectFrames}: ${p.x} yaw ${p.yaw}`);

    // `play_length - 2` is 4 for this fixture, so the cursor stops there and
    // the clip holds its last pose rather than looping.
    for (let i = 0; i < 20; i++) ScriptFlagEffectUpdate(p, events);
    check("...the cursor stops two short of the play length",
          p.effectFrames === 4, String(p.effectFrames));
  }

  // The cue list: `cues[cursor] == obj+0x32C`, equality, and the cursor
  // wraps at the table's -1.
  {
    propScene(rng);
    const events = new Events();
    let sounds = 0;
    events.on("sound.play", (d) => {
      if (d.id === SFX_SCRIPT_FLAG_EFFECT) sounds++;
    });
    G.g_breakable_props.push(...build());
    const p = only();
    G.g_script_flags[ScriptFlagEffectFlag.Advance] = 1;
    for (let i = 0; i < 10; i++) ScriptFlagEffectUpdate(p, events);
    check("both cue frames play the effect's sound", sounds === 2,
          `${sounds} plays`);
    check("...and a parked cursor does not play it again",
          p.effectFrames === 4 && sounds === 2, `${sounds} plays`);
  }

  // `g_script_flags[0x13]` is the whole lifetime, and it is tested first.
  {
    propScene(rng);
    G.g_breakable_props.push(...build());
    const p = only();
    G.g_script_flags[ScriptFlagEffectFlag.Remove] = 1;
    ScriptFlagEffectUpdate(p);
    check("the removal flag despawns it", p.dead);
  }

  // The shortest way round, which is the engine's own u16 fold.
  check("a BAMS blend takes the short way round",
        BamsHalfway(0xf000, 0x1000) === 0x10000 && BamsHalfway(0, 0x8000) === 0x4000,
        `${BamsHalfway(0xf000, 0x1000)}, ${BamsHalfway(0, 0x8000)}`);
}

console.log("\nprops are shot by a sphere, not by the model they draw:");
{
  const rng = new Rng(77);

  // A generic prop that draws NOTHING. Type 25's routine has no static model
  // at all -- `GENERIC_DRAW_SLOT[25]` is null -- and the engine still gives it
  // a radius of 12 and registers it every frame. It was the only branch in
  // arcade mode the port could not reach, for exactly that reason.
  {
    propScene(rng, GameMode.Arcade);
    const p = PlaceGenericProp({ at: 0x9000, container: "generic", type: 0x19,
                                 slot: 0, lifetime_evt_steps: 0,
                                 pos: [10, 0, -5] }, rng);
    G.g_breakable_props.push(p);
    check("a prop with no model still gets its radius", p.hitRadius === 12,
          String(p.hitRadius));
    BreakablePropPoolUpdate(rng);
    check("...and publishes a sphere", p.shotRegistered);
    check("...12 units above its own origin, which is where the routine puts it",
          p.shotX === 10 && p.shotY === 12 && p.shotZ === -5,
          `${p.shotX}/${p.shotY}/${p.shotZ}`);

    // `obj+0x34 |= 0x44000000` -- bit 26 takes it out of the shot test for
    // good, which is why its route can only ever be opened once.
    p.flags |= 0x04000000;
    BreakablePropPoolUpdate(rng);
    check("...until one scoring hit sets bit 26, and then never again",
          !p.shotRegistered);
  }

  // The offsets are per type and they are not all up. Type 7 registers 57
  // units BELOW its origin; type 20 one unit below; type 57 ignores its
  // position and registers a fixed world point.
  {
    const at = (type: number) => {
      propScene(rng, GameMode.Arcade);
      const p = PlaceGenericProp({ at: 0x9100 + type, container: "generic",
                                   type, slot: 0, lifetime_evt_steps: 0,
                                   pos: [0, 100, 0] }, rng);
      G.g_breakable_props.push(p);
      BreakablePropPoolUpdate(rng);
      return p;
    };
    check("type 7 registers 57 units below its origin", at(7).shotY === 43,
          String(at(7).shotY));
    check("type 20 registers one unit below", at(20).shotY === 99,
          String(at(20).shotY));
    const t57 = at(57);
    check("type 57 ignores its position for a fixed world point",
          Math.abs(t57.shotX - -697.042) < 1e-3 && t57.shotY !== 100,
          `${t57.shotX}/${t57.shotY}/${t57.shotZ}`);
    // Type 74's rise is a function of its own radius: `r * 0.5 - 2`. It is
    // read in Original Mode, because in Arcade its first frame is its exit.
    propScene(rng, GameMode.Original);
    const t74 = PlaceGenericProp({ at: 0x9100 + 74, container: "generic",
                                   type: 74, slot: 0, lifetime_evt_steps: 0,
                                   pos: [0, 100, 0] }, rng);
    G.g_breakable_props.push(t74);
    BreakablePropPoolUpdate(rng);
    check("type 74's rise comes from its own radius", t74.shotY === 100 + 2.5,
          String(t74.shotY));
  }

  // The group props: half a stack level up while standing, the raw origin once
  // they are falling, and out of the test entirely once removed.
  {
    propScene(rng);
    PlaceBreakableGroup(1, 4, rng);
    const p = G.g_breakable_props[0];
    p.x = 0; p.y = 0; p.z = 0;
    BreakablePropPoolUpdate(rng);
    check("a standing group prop registers half a stack level up",
          Math.abs(p.shotY - 3.770148) < 1e-5, String(p.shotY));
    check("...with the radius PlaceBreakableGroup gives every member",
          p.hitRadius === 5, String(p.hitRadius));
    p.state = BreakableState.Falling;
    BreakablePropPoolUpdate(rng);
    // Its own y, whatever the fall has done to it this frame -- the rise is
    // assigned only inside the standing arm, so a falling prop loses it.
    check("...its raw origin once it is falling", p.shotY === p.y,
          `${p.shotY} vs ${p.y}`);
    p.state = BreakableState.Removed;
    BreakablePropPoolUpdate(rng);
    check("...and nothing at all once it is removed", !p.shotRegistered);
  }

  // The list is rebuilt every frame, which is what makes a prop that returned
  // early unshootable for exactly as long as the engine makes it.
  {
    propScene(rng);
    PlaceBreakableGroup(1, 4, rng);
    const p = G.g_breakable_props[0];
    BreakablePropPoolUpdate(rng);
    check("a prop is in the list after its own frame", p.shotRegistered);
    ClearPropShotTestList();
    check("...and out of it the moment the list is cleared", !p.shotRegistered);
  }

  // The chain's twenty links are twenty spheres, dropping 1.5 apiece. Placing
  // them all at the anchor would make one link out of twenty.
  {
    propScene(rng);
    const links = PlaceChainSegments({ at: 0x9200, container: "chain",
                                       chain_group: 0, lifetime_evt_steps: 9,
                                       pos: [0, 0, 0] });
    check("each link hangs 1.5 below the one above it",
          Math.abs(links[0].y - -1.5) < 1e-6
          && Math.abs(links[19].y - -30.0) < 1e-6,
          `${links[0].y} .. ${links[19].y}`);
    check("...and each carries its own 2.0 sphere", links[7].hitRadius === 2,
          String(links[7].hitRadius));
  }

  // The fragment pair is two objects 41.683 apart, not two in one place.
  {
    propScene(rng);
    const pair = PlaceFragmentProps({ at: 0x9300, container: "fragment",
                                      sub_kind: 9, lifetime_evt_steps: 9,
                                      pos: [0, 0, 0] });
    G.g_breakable_props.push(...pair);
    check("sub-kind 9's pair is placed apart, from the engine's own table",
          Math.abs(pair[1].x - pair[0].x - 41.683) < 1e-2,
          `${pair[0].x} and ${pair[1].x}`);
    BreakablePropPoolUpdate(rng);
    check("...and each registers 8 units up, which its draw slot decides",
          Math.abs(pair[0].shotY - (pair[0].y + 8.0)) < 1e-5,
          String(pair[0].shotY));
    check("...at 5.5 apiece", pair[0].hitRadius === 5.5,
          String(pair[0].hitRadius));
    // `obj+0x1B9` -- one shot ends it for ever.
    pair[0].branchLatched = true;
    BreakablePropPoolUpdate(rng);
    check("...until one is broken, and then that one is out of the test",
          !pair[0].shotRegistered && pair[1].shotRegistered);
  }
}

console.log("\nclass 0x41 types 38, 39, 40 and 44 -- stage 1's church (new bugs 8, 9):");
{
  // The four constructors stage 1 block 1 step 2 runs through its placers at
  // evt 0x1994, 0x19BC, 0x19E4 and 0x1B48. Before these were ported, types 38,
  // 39 and 44 had no entry in `g_class41_constructors` and type 40 put every
  // object at the placer's own point with slot 0: the church had bare pews and
  // no chairs.
  const rng = new Rng(38);
  const events = propScene(rng);
  const sounds: number[] = [];
  events.on("sound.play", (e) => sounds.push(e.id));
  const place = (at: number, type: number, lifetime: number) => {
    const placer = ActorSpawn(at, SpawnClass.PropContainerPlacer, lifetime,
                              "placer");
    placer.visible = true;
    placer.hp = lifetime;       // +0x11C: the step lifetime, for these three
    placer.condition = type;    // +0x130C
    PropContainerPlacerUpdate(placer, {
      dt: 1 / 60, rng, host: NULL_HOST,
    });
    return G.g_breakable_props.filter((q) => q.at === at);
  };

  const t38 = place(0x1994, 38, 4);
  check("constructor 38 builds nine objects from g_prop_table38",
        t38.length === 9 && t38.every((q) => q.family === PropFamily.Type38),
        `${t38.length}`);
  check("...at the table's points, not the placer's origin",
        t38[5].x === PROP_TABLE38[5][0] && t38[5].z === PROP_TABLE38[5][2]);
  check("...with the angles in degrees turned into truncated BAMS",
        t38[0].pitch === Math.trunc(-104.851 * Math.fround(182.0444))
        && t38[0].roll === Math.trunc(90 * Math.fround(182.0444)),
        `${t38[0].pitch} ${t38[0].roll}`);
  check("...drawing komono_st1 slot 0x1237 with a 3.0 sphere",
        t38.every((q) => q.slot === TYPE38_SLOT && q.hitRadius === 3));

  const t39 = place(0x19bc, 39, 4);
  check("constructor 39 builds eight stacks",
        t39.length === 8 && t39.every((q) => q.family === PropFamily.Type39));
  check("...8, 7, 7, 6, 6, 6, 5 and 5 high: __ftol(8 - i * 0.4f) after a "
        + "float store", [0, 1, 2, 3, 4, 5, 6, 7].map(Type39StackHeight)
          .join() === "8,7,7,6,6,6,5,5",
        [0, 1, 2, 3, 4, 5, 6, 7].map(Type39StackHeight).join());
  check("...each item 0.926 above the last",
        Math.abs(t39[0].stack[7].y - t39[0].stack[0].y - 7 * 0.926) < 1e-4);

  const t40 = place(0x19e4, 40, 4);
  check("constructor 40 is no longer a placeholder", t40.length === 0,
        "PropContainerPlacerUpdate needs a fragment placement to find");
  const frag = PlaceFragmentProps({ at: 0x19e4, container: "fragment",
                                    sub_kind: 0, lifetime_evt_steps: 4,
                                    pos: [0, 0, 0] });
  G.g_breakable_props.push(...frag);
  check("sub-kind 0 is eight objects, off the placer's origin and on the pews",
        frag.length === 8
        && frag.every((q) => Math.abs(q.y - 16.821) < 1e-3 && q.x !== 0),
        frag.map((q) => `${q.x.toFixed(2)},${q.z.toFixed(2)}`).join(" "));
  check("...through T(16.473, 16.821, 4.749) . RotY(0x278D) . T(x, 0, z)",
        // 0x278D is 55.62 degrees: (18.942, 2.629) turns to (12.866, -14.148)
        // and the frame's origin adds (16.473, 4.749).
        Math.abs(frag[0].x - 29.339) < 0.01 && Math.abs(frag[0].z + 9.399) < 0.01,
        `${frag[0].x} ${frag[0].z}`);
  check("...drawing 0x123E, not slot 0",
        frag.every((q) => q.slot === FRAGMENT_SUBKIND0_SLOT));

  const t44 = place(0x1b48, 44, 4);
  check("constructor 44 builds seven chairs",
        t44.length === 7 && t44.every((q) => q.family === PropFamily.Type44));
  check("rows 2..6 draw komono_7 slot 0x1064, rows 0 and 1 the effect",
        t44.slice(2).every((q) => q.slot === TYPE44_WHOLE_SLOT)
        && t44.slice(0, 2).every((q) => q.slot === SLOT_NONE
                                       && q.effect === TYPE44_EFFECT));
  check("row 6 is the chair lying on its side beside the humanoid (bug 9)",
        Math.abs(t44[6].x + 22.3) < 1e-4 && Math.abs(t44[6].y - 9.06) < 1e-4
        && Math.abs(t44[6].z + 97.86) < 1e-4 && t44[6].pitch === -0x26bd
        && t44[6].roll === -0x4000);

  BreakablePropPoolUpdate(rng, events);
  check("all four families register for the shot test on their own tails",
        [t38[0], t39[0], frag[0], t44[0]].every((q) => q.shotRegistered));
  check("...type 38 one unit below its origin, type 44 five above",
        Math.abs(t38[0].shotY - (t38[0].y - 1)) < 1e-6
        && Math.abs(t44[0].shotY - (t44[0].y + 5)) < 1e-6);

  // Type 38: a hop, a landing on a hull corner, a pivot, and rest.
  const b = t38[2];
  const score0 = G.g_player_score[0];
  BreakablePropTakeShot(b, 0);
  // `combat/shot.ts` leaves the aimed point on the prop; the routine's own
  // `SpawnPropHitEffectScaled(obj, player, 0.7)` then puts effect 0xE25 there.
  b.hitAim = { x: 1.5, y: 7.25 };
  const fx0 = G.g_sprite_effects.length;
  BreakablePropPoolUpdate(rng, events);
  const fx = G.g_sprite_effects[fx0];
  check("the hit spawns SpawnPropHitEffectScaled's strip at the aimed point",
        !!fx && fx.slot === 0xe26 && fx.lastSlot === 0xe33
        && fx.pos.x === 1.5 && fx.pos.y === 7.25 && fx.pos.z === b.z
        && Math.abs(fx.scale.x - 0.7 * 1.5) < 1e-9,
        JSON.stringify(fx));
  check("a shot type-38 swaps to 0x1236 and hops, and pays nothing",
        b.slot === TYPE38_SLOT_HIT
        && (b.state as number) === Type38State.Hopping
        && G.g_player_score[0] === score0,
        `slot ${b.slot} state ${b.state} score ${G.g_player_score[0]}`);
  let landed = -1;
  let rested = -1;
  for (let f = 0; f < 600 && rested < 0; f++) {
    BreakablePropPoolUpdate(rng, events);
    if (landed < 0 && (b.state as number) === Type38State.Pivoting) landed = f;
    if (landed >= 0 && (b.state as number) === Type38State.Resting) rested = f;
  }
  check("...lands on a corner and pivots, then comes to rest",
        landed > 0 && rested > landed, `landed ${landed} rested ${rested}`);
  check("...with yaw back at 0, roll at a quarter turn and y at its rest",
        b.yaw === 0 && b.roll === 0x4000
        && b.y === PROP_TABLE38[2][1], `${b.yaw} ${b.roll} ${b.y}`);

  // Type 39: the stack falls over item by item, blinks, and is gone.
  const st = t39[0];
  BreakablePropTakeShot(st, 0);
  BreakablePropPoolUpdate(rng, events);
  check("a shot stack pays ten and stops registering",
        G.g_player_score[0] === score0 + 10 && !st.shotRegistered,
        `${G.g_player_score[0]}`);
  let blinked = false;
  for (let f = 0; f < 400 && !st.dead; f++) {
    BreakablePropPoolUpdate(rng, events);
    if (!st.dead && st.stackDrawn === 0) blinked = true;
  }
  check("...lays every item on the floor 1.2 apart, blinks and is killed",
        st.dead && blinked
        && Math.abs(st.stack[1].y - Math.fround(1.6205)) < 1e-6
        && Math.abs((st.stack[0].z - st.stack[3].z) - 3 * Math.fround(1.2))
           < 1e-4, `dead ${st.dead} blink ${blinked}`);

  // Type 40 sub-kind 0: forty pieces for a hundred frames, and a new model.
  const g = frag[3];
  BreakablePropTakeShot(g, 0);
  BreakablePropPoolUpdate(rng, events);
  check("a shot sub-kind-0 object bursts into forty pieces and swaps to 0x123F",
        g.burst.length === FRAGMENT_BURST_PIECES
        && g.slot === FRAGMENT_SUBKIND0_SLOT_HIT && !g.shotRegistered,
        `${g.burst.length} ${g.slot.toString(16)}`);
  check("...with one of the routine's two break sounds",
        sounds.includes(0x2d16a9) || sounds.includes(0x2c16a9));
  for (let f = 0; f < 150; f++) BreakablePropPoolUpdate(rng, events);
  check("...and the burst runs for exactly a hundred frames",
        g.burstFrames === FRAGMENT_BURST_FRAMES, String(g.burstFrames));
  check("...its pieces coming to rest on the floor, not through it",
        g.burst.every((q) => q.y >= G.g_camera_fixed_eye_y + 1 - 1e-4));

  // Type 44: a whole chair takes the shot and stays a whole chair.
  const c6 = t44[6];
  BreakablePropTakeShot(c6, 0);
  BreakablePropPoolUpdate(rng, events);
  // Row 0: the effect tree. Its ten pieces are posed from the clip on the
  // object, and the break moves them.
  const c0 = t44[0];
  const before = c0.effectPoses.map((q) => q.y);
  BreakablePropTakeShot(c0, 0);
  for (let f = 0; f < 30; f++) BreakablePropPoolUpdate(rng, events);
  check("a shot breakable chair plays motion 468 on effect 0x13's ten pieces",
        c0.effectFrames > 1 && c0.effectPoses.length === 10
        && c0.effectPoses.some((q, i) => q.y !== before[i]),
        `${c0.effectFrames} ${c0.effectPoses.length}`);
  check("a shot whole chair pays and leaves the shot test, but stays drawn",
        c6.effectFrames >= 1 && !c6.shotRegistered
        && c6.slot === TYPE44_WHOLE_SLOT && !c6.dead);

  // The step lifetime: four step changes and they are all gone.
  for (let step = 1; step <= 5; step++) {
    G.g_evt_step_index = step;
    BreakablePropPoolUpdate(rng, events);
  }
  check("every one of them expires after its four evt steps",
        G.g_breakable_props.filter((q) => q.at === 0x1994 || q.at === 0x19bc
          || q.at === 0x1b48 || q.at === 0x19e4).length === 0,
        String(G.g_breakable_props.length));
}

console.log("\nclass 0x41 constructors 50 and 66 -- the table scenery (stage 1's bin crate, stage 2 block 17, the signs):");
{
  // Driven the way the level drives them: a placement in the bundle, the
  // walker's spawn list, `SpawnPropContainers`, and a frame of `GameUpdate`.
  // Before these were ported, `g_class41_constructors[50]` and `[66]` had no
  // entry and both placers died having built nothing.
  const rng = new Rng(50);
  const events = propScene(rng, GameMode.Arcade);
  const sounds: number[] = [];
  events.on("sound.play", (e) => sounds.push(e.id));
  // The descriptors stand at the origin: neither constructor reads it.
  const ORIGIN: [number, number, number] = [0, 0, 0];
  const placements = [
    ...(BREAKABLES.placements ?? []),
    // Stage 1 block 4 step 3: `+0x1F4` 3, `+0x11C` 4 (evt 0x3B14).
    { at: 0x3b14, container: "table50" as const, field_1f4: 3,
      lifetime_evt_steps: 4, pos: ORIGIN },
    // Stage 1 blocks 3 and 8: table 5, lifetime 11 (evt 0x2D9C).
    { at: 0x2d9c, container: "table50" as const, field_1f4: 5,
      lifetime_evt_steps: 11, pos: ORIGIN },
    // Stage 2 block 17 step 1: table 2, lifetime 5 (evt 0xBE60).
    { at: 0xbe60, container: "table50" as const, field_1f4: 2,
      lifetime_evt_steps: 5, pos: ORIGIN },
    // Stage 1 blocks 6, 14, 16: table a, lifetime 4 (evt 0x6884).
    { at: 0x6884, container: "table66" as const, field_1f4: 0,
      lifetime_evt_steps: 4, pos: ORIGIN },
    // Stage 2 block 3: table b, lifetime 8 (evt 0x2554).
    { at: 0x2554, container: "table66" as const, field_1f4: 1,
      lifetime_evt_steps: 8, pos: ORIGIN },
  ];
  SetGameTables(CHARS, { ...BREAKABLES, placements });
  SpawnPropContainers([0x3b14, 0x2d9c, 0xbe60, 0x6884, 0x2554].map(
    (at) => ({ at, class: SpawnClass.PropContainerPlacer })));
  const placers = G.g_object_list.filter(
    (o) => o.cls === SpawnClass.PropContainerPlacer);
  check("each placer carries its table in +0x1F4 and its lifetime in +0x11C",
        placers.length === 5
        && placers.map((o) => `${o.condition}/${o.charType}/${o.hp}`).join()
          === "50/3/4,50/5/11,50/2/5,66/0/4,66/1/8",
        placers.map((o) => `${o.condition}/${o.charType}/${o.hp}`).join());
  GameUpdate(1 / 60, NULL_HOST, rng, events);
  const at = (a: number) => G.g_breakable_props.filter((q) => q.at === a);
  const crate = at(0x3b14);
  check("constructor 50 table 3 builds five komono_st1b models on the crate: "
        + "slots 0xD40, 0xD45, 0xD46, 0xD41, 0xD42",
        crate.map((q) => q.slot.toString(16)).join() === "d40,d45,d46,d41,d42",
        crate.map((q) => q.slot.toString(16)).join());
  check("...each running PropDrawOnlyType12, at the row's point and BAMS",
        crate.length === 5
        && crate.every((q) => q.family === PropFamily.DrawOnlyType12)
        && crate[0].x === Math.fround(-693.816)
        && crate[0].y === Math.fround(-3.525)
        && crate[0].z === Math.fround(-536.116)
        && crate[0].pitch === -0xca1 && crate[0].yaw === 0x4885
        && crate[0].roll === 0x684,
        `${crate[0]?.x} ${crate[0]?.y} ${crate[0]?.z} ${crate[0]?.pitch}`);
  check("...+0x290 the table, +0x2A0 the row, the step lifetime copied",
        crate.length === 5 && crate.every((q, i) => q.kind === 3
                                          && q.storyItem === i
                                          && q.lifetime === 4));
  check("...unit scale, no sphere and no +0x34",
        crate.length === 5
        && crate.every((q) => q.restX === 1 && q.restY === 1 && q.restZ === 1
                       && q.hitRadius === 0 && q.flags === 0
                       && !q.shotRegistered));
  check("...and each draws its slot, placed where its row says",
        crate.length === 5
        && crate.every((q) => q.draws?.length === 1
                       && q.draws[0].slot === q.slot
                       && Math.abs(q.draws[0].m[12] - q.x) < 1e-4
                       && Math.abs(q.draws[0].m[13] - q.y) < 1e-4
                       && Math.abs(q.draws[0].m[14] - q.z) < 1e-4),
        JSON.stringify(crate[0]?.draws?.[0]?.m));
  const rails = at(0x2d9c);
  check("table 5 is five komono_st1b.bin[15], each z-scaled by "
        + "g_prop_table50_scale_z: 0.6, 1, 0.5, 0.715, 0.715",
        rails.length === 5 && rails.every((q) => q.slot === 0x17d6)
        && rails.map((q) => q.restZ).join()
          === [0.6, 1, 0.5, 0.715, 0.715].map(Math.fround).join()
        && rails.every((q) => q.restX === 1 && q.restY === 1),
        rails.map((q) => q.restZ).join());
  const room = at(0xbe60);
  check("table 2, stage 2 block 17: komono_suimonie [5], [6] and [7] twice",
        room.map((q) => q.slot.toString(16)).join() === "1980,1982,1983,1983"
        && room[2].x === -602.5 && room[2].y === 38.5
        && room[2].z === -1532.5 && room[3].z === -1548.5
        && room[2].yaw === 0x8000 && room[3].yaw === 0x8000,
        room.map((q) => `${q.slot.toString(16)}@${q.x},${q.y},${q.z}`)
          .join(" "));
  check("PROP_TABLE50 has g_prop_table50_counts' 7, 11, 4, 5, 6, 5 rows",
        PROP_TABLE50.map((t) => t.length).join() === "7,11,4,5,6,5"
        && PROP_TABLE50_SCALE_Z.length === 5);

  const signs = at(0x6884);
  const signsB = at(0x2554);
  check("constructor 66 builds 20 of table a and 29 of table b",
        signs.length === 20 && signsB.length === 29
        && signs.every((q) => q.family === PropFamily.Type66)
        && signs.map((q) => q.slot).join()
          === PROP_TABLE66_A.map((r) => r[0]).join()
        && signsB.map((q) => q.slot).join()
          === PROP_TABLE66_B.map((r) => r[0]).join(),
        `${signs.length} ${signsB.length}`);
  const sign = (i: number) => signs[i] ?? makeBreakableProp(-1, 0, 0);
  const signB = (i: number) => signsB[i] ?? makeBreakableProp(-1, 0, 0);
  check("...+0x124 4.0 and +0x2C0 -3.5, but 6.5 and -5.0 for slot 0x10DC",
        sign(3).slot === 0x10dd && sign(3).hitRadius === 4
        && sign(3).shake === -3.5
        && sign(1).slot === 0x10dc && sign(1).hitRadius === 6.5
        && sign(1).shake === -5,
        `${sign(1).hitRadius} ${sign(1).shake}`);
  check("...slot 0x10B1 laid back -0x4000, the rest only turned in yaw",
        signB(27).slot === 0x10b1 && signB(27).pitch === -0x4000
        && signB(27).yaw === -0x4d22
        && signs.every((q) => q.pitch === 0 && q.roll === 0),
        `${signB(27).pitch}`);
  check("...the row's scale and a live +0x34",
        sign(4).restX === Math.fround(0.7606) && sign(4).restY === 1
        && sign(4).restZ === Math.fround(0.5404)
        && signs.every((q) => q.flags === (0x80000001 | 0)
                       || q.flags === 0x80000001));
  check("only 0x10DC, 0x10DD and 0x10DE register, at y + the +0x2C0 drop",
        signs.filter((q) => q.shotRegistered).map((q) => q.slot.toString(16))
          .join() === "10dc,10dd,10dd,10dc,10dc,10dd"
        && sign(1).shotY === Math.fround(sign(1).y - 5)
        && sign(3).shotY === Math.fround(sign(3).y - 3.5),
        signs.filter((q) => q.shotRegistered).map((q) => q.slot.toString(16))
          .join());

  // The hit: bit 3 cleared, the ricochet, no points, and a swing rate of
  // rand() % 0x201 + 0x600, sprung once on the same frame.
  const s = sign(3);
  const score0 = G.g_player_score[0];
  const hits0 = G.g_player_hit_count[0] ?? 0;
  BreakablePropTakeShot(s, 0);
  sounds.length = 0;
  GameUpdate(1 / 60, NULL_HOST, rng, events);
  const s0 = [...Array(0x201).keys()].map((r) => r + 0x600)
    .find((v) => v - Math.trunc(v / 24) === s.spin);
  check("a shot 0x10DD swings: rate rand()%0x201 + 0x600, less a 24th",
        s0 !== undefined && s.pitch === s.spin
        && (s.flags & BreakableFlag.Hit) === 0,
        `spin ${s.spin} pitch ${s.pitch}`);
  check("...plays 0x1116A9, counts the hit and pays nothing",
        sounds.includes(SFX_TYPE66_HIT) && G.g_player_score[0] === score0
        && G.g_player_hit_count[0] === hits0 + 1,
        `${sounds} ${G.g_player_score[0]}`);
  let neg = false;
  for (let f = 0; f < 240; f++) {
    GameUpdate(1 / 60, NULL_HOST, rng, events);
    if (s.pitch < 0) neg = true;
  }
  check("...and swings back through zero: rate -= (pitch + rate) / 24",
        neg, `${s.pitch}`);

  // The pivot: 0x10DE swings about a point 1.5 above its origin, so a pitch
  // moves the drawn origin on a circle of radius 1.5.
  const piv = signB(19);
  piv.spin = 0x800;
  GameUpdate(1 / 60, NULL_HOST, rng, events);
  const m = piv.draws?.[0]?.m ?? [];
  const moved = Math.hypot(m[12] - piv.x, m[13] - piv.y, m[14] - piv.z);
  const chord = 2 * 1.5 * Math.abs(Math.sin(piv.pitch / 65536 * Math.PI));
  check("slot 0x10DE is drawn about (0, 1.5, 0): its origin moves 2 * 1.5 * "
        + "sin(pitch / 2)",
        piv.slot === 0x10de && piv.pitch !== 0
        && Math.abs(moved - chord) < 1e-3,
        `moved ${moved} chord ${chord}`);
  const mp = s.draws?.[0]?.m ?? [];
  check("...where 0x10DD is drawn at its own origin however it swings",
        s.pitch !== 0 && Math.abs(mp[12] - s.x) < 1e-4
        && Math.abs(mp[13] - s.y) < 1e-4 && Math.abs(mp[14] - s.z) < 1e-4);

  // The shake: scene 0, and the pool reading g_screen_shake_frames at 0x2F or
  // 0x17. A latched player hit is what restarts the countdown at 0x30, and
  // `UpdateScreenShake` takes a frame off before the pool runs.
  const still = sign(12);
  const board = sign(0);
  check("an unshot 0x10DC hangs still", still.slot === 0x10dc
        && still.pitch === 0 && still.spin === 0);
  G.g_scene_index = 0;
  G.g_player_was_hit[0] = 1;
  GameUpdate(1 / 60, NULL_HOST, rng, events);
  const kick = (frames: number, rate: number) =>
    [...Array(0x201).keys()].some((r) => {
      const v = r + frames * 32;
      return Math.abs(rate) === v - Math.trunc(v / 24);
    });
  check("a hit's shake swings it the frame the countdown reads 0x2F: "
        + "±(rand()%0x201 + 0x2F * 32), less a 24th",
        G.g_screen_shake_frames === 0x2f && kick(0x2f, still.spin)
        && still.pitch === still.spin && board.pitch === 0,
        `${G.g_screen_shake_frames} ${still.spin} ${board.pitch}`);
  // From 0x2E down the rate only springs, until the countdown reads 0x17.
  const kicked: number[] = [];
  while (G.g_screen_shake_frames > 1) {
    const rate = still.spin;
    const sprung = (rate - Math.trunc((still.pitch + rate) / 24)) | 0;
    GameUpdate(1 / 60, NULL_HOST, rng, events);
    if (still.spin !== sprung) kicked.push(G.g_screen_shake_frames);
  }
  check("...and kicks it again at 0x17 and at no other frame",
        kicked.join() === "23" && board.pitch === 0, kicked.join());
  G.g_scene_index = 1;
  G.g_player_was_hit[0] = 1;
  const quiet = sign(19);
  const quietRate = quiet.spin;
  const quietSprung =
    (quietRate - Math.trunc((quiet.pitch + quietRate) / 24)) | 0;
  GameUpdate(1 / 60, NULL_HOST, rng, events);
  check("...in scene 0 only: scene 1's 0x2F only springs it",
        quiet.slot === 0x10dd && G.g_screen_shake_frames === 0x2f
        && quiet.spin === quietSprung,
        `${quiet.spin} ${quietSprung}`);
  G.g_screen_shake_frames = 0;
  G.g_scene_index = 0;

  // The lifetimes: table 3 and the signs both live four step changes; the
  // crate's objects despawn, the signs are killed (`ActorKill` writes no
  // flag word, `ActorDespawn` clears the live bit).
  const crate0 = crate[0] ?? makeBreakableProp(-1, 0, 0);
  const sign0 = sign(0);
  for (let step = 2; step <= 6; step++) {
    G.g_evt_step_index = step;
    GameUpdate(1 / 60, NULL_HOST, rng, events);
  }
  check("after five step changes table 3's objects and table a's are gone",
        crate.length === 5 && signs.length === 20
        && at(0x3b14).length === 0 && at(0x6884).length === 0
        && at(0x2d9c).length === 5 && at(0x2554).length === 29,
        `${at(0x3b14).length} ${at(0x6884).length} ${at(0x2554).length}`);
  check("...the crate's by ActorDespawn, the signs' by ActorKill",
        crate0.dead && sign0.dead
        && (crate0.flags & BreakableFlag.Live) === 0
        && (crate0.flags & 0x18000) === 0x18000
        && (sign0.flags & BreakableFlag.Live) !== 0);

  // Scene 1's sweep, `g_script_flags[0x77]`: PropDrawOnlyType12 runs the
  // shared prologue and goes; PropUpdateType66 inlines its lifetime without it.
  G.g_scene_index = 1;
  G.g_script_flags[0x77] = 1;
  GameUpdate(1 / 60, NULL_HOST, rng, events);
  check("scene 1's sweep takes the table-50 objects and leaves the signs",
        rails.length === 5 && signsB.length === 29
        && at(0x2d9c).length === 0 && at(0xbe60).length === 0
        && at(0x2554).length === 29,
        `${at(0x2d9c).length} ${at(0xbe60).length} ${at(0x2554).length}`);
  G.g_script_flags[0x77] = 0;
}

console.log("\nMatrixInterpolateSwingTwist, effect interpolation mode 2:");
{
  const near = (a: number, b: number, eps = 1) => Math.abs(a - b) <= eps;
  const I = MatrixFromZYX(0, 0, 0);
  // A pure twist: RotY(0x4000) swings nothing, so the Y arm alone runs and
  // halves the twist to 0x2000.
  const yHalf = MatrixToZYX(MatrixInterpolateSwingTwist(
    I, MatrixFromZYX(0, 0x4000, 0), 0.5));
  check("a pure turn about Y is halved about Y",
        near(yHalf.yaw, 0x2000) && near(yHalf.pitch, 0) && near(yHalf.roll, 0),
        JSON.stringify(yHalf));
  // A pure swing: RotX(0x4000) carries Y onto +Z, so the axis is
  // Y x (0,0,1) = (1,0,0), the swing is 0x4000 and no twist is left.
  const xHalf = MatrixToZYX(MatrixInterpolateSwingTwist(
    I, MatrixFromZYX(0x4000, 0, 0), 0.5));
  check("a pure turn about X is halved about X",
        near(xHalf.pitch, 0x2000) && near(xHalf.yaw, 0) && near(xHalf.roll, 0),
        JSON.stringify(xHalf));
  // Hand-computed: B = RotZ(0x4000) . RotY(0x4000). Y goes to Rz(Y) = (-1,0,0),
  // a swing of 0x4000 about Y x (-1,0,0) = (0,0,1), i.e. Rz; the twist left
  // over is RotY(0x4000). Halved: Rz(0x2000) . Ry(0x2000).
  const zy = MatrixToZYX(MatrixInterpolateSwingTwist(
    I, MatrixFromZYX(0, 0x4000, 0x4000), 0.5));
  check("a swing and a twist are each halved, swing first",
        near(zy.roll, 0x2000) && near(zy.yaw, 0x2000) && near(zy.pitch, 0),
        JSON.stringify(zy));
  // ...and it is not the per-angle halfway for a case where the two differ:
  // from A = Rx(0x5000) to B = Rz(0x5000) . Ry(0x5000), every angle moves by
  // more than 0x3000, which is exactly when EffectPoseNode takes this arm.
  const a = MatrixFromZYX(0x5000, 0, 0);
  const b = MatrixFromZYX(0, 0x5000, 0x5000);
  const full = MatrixInterpolateSwingTwist(a, b, 1);
  check("t = 1 lands on B", full.every((v, i) => Math.abs(v - b[i]) < 1e-3),
        full.map((v) => v.toFixed(3)).join(","));
  const mid = MatrixToZYX(MatrixInterpolateSwingTwist(a, b, 0.5));
  // EffectPoseNode takes the arm in mode 2 only, on an odd cursor past 1,
  // and only when all three angles jump by more than 0x3000.
  const def = {
    nodes: [{ slot: 0, bone: 0, children: [1] }, { slot: 1, bone: 1, children: [] }],
    interp: 2, motion: 1, play_length: 8, frames: 3, bones: 1,
    t: [0, 0, 0, 0, 0, 0, 0, 0, 0],
    r: [0x5000, 0, 0, 0, 0x5000, 0x5000, 0, 0x5000, 0x5000],
    cues: [],
  };
  const pose = { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0 };
  EffectSampleNode(def as never, 1, 1, 0, pose);
  check("cursor 1 is below the arm, and blends per angle",
        pose.pitch === 0x2800 && pose.yaw === 0x2800, JSON.stringify(pose));
  EffectSampleNode(def as never, 1, 3, 2, pose);
  check("cursor 3 between two keys that stand still is per angle too",
        pose.yaw === 0x5000 && pose.roll === 0x5000, JSON.stringify(pose));
  const d2 = { ...def, frames: 4,
               r: [...def.r, 0x5000, 0, 0], t: [...def.t, 0, 0, 0] };
  EffectSampleNode(d2 as never, 1, 5, 4, pose);
  const want = MatrixToZYX(MatrixInterpolateSwingTwist(
    MatrixFromZYX(0, 0x5000, 0x5000), MatrixFromZYX(0x5000, 0, 0), 0.5));
  check("cursor 5, all three angles far apart, takes the matrix arm",
        Math.abs(pose.pitch - want.pitch) < 1e-6
        && Math.abs(pose.yaw - want.yaw) < 1e-6, JSON.stringify(pose));
  check("...and halfway is not the per-angle blend",
        !(near(mid.pitch, 0x2800, 64) && near(mid.yaw, 0x2800, 64)
          && near(mid.roll, 0x2800, 64)), JSON.stringify(mid));
}

console.log("\nclass 0x41 type 32, the lift:");
{
  const rng = new Rng(41);
  const events = propScene(rng);
  const sounds: number[] = [];
  events.on("sound.play", (e) => sounds.push(e.id));
  const gate = PlaceGenericProp(
    { at: 0xbdc0, container: "generic", type: 32, slot: 2,
      lifetime_evt_steps: 2, pos: [-825.1, 40, -1871.7],
      pitch: 0, yaw: 0, roll: 0 }, rng);
  G.g_breakable_props.push(gate);

  check("it is its own family, not a drawn-only generic prop",
        gate.family === PropFamily.Lift);
  check("and the constructor seeds the three hinges at rest",
        gate.yaw === LIFT_NEAR_CLOSED && gate.hingeB === LIFT_FAR_CLOSED
        && gate.pitch === LIFT_PANEL_CLOSED);
  check("the car it draws is komono_suimon slot 0x197A, not the `slot` 2 "
        + "the descriptor carries", GENERIC_DRAW_SLOT[32] === 0x197a);

  // No flag up: nothing moves. This is the whole point of the routine --
  // every motion waits on the script.
  for (let i = 0; i < 120; i++) LiftUpdate(gate, events);
  check("with no script flag raised nothing moves at all",
        gate.yaw === LIFT_NEAR_CLOSED && gate.hingeB === LIFT_FAR_CLOSED
        && gate.pitch === LIFT_PANEL_CLOSED && gate.y === 40
        && sounds.length === 0);

  // Flag 0x37: the gate rides fifteen under the camera's eye.
  G.g_camera_block_eye.y = 100;
  G.g_script_flags[LiftFlag.RideCamera] = 1;
  LiftUpdate(gate, events);
  check("flag 0x37 hangs the car floor fifteen under the camera eye",
        gate.y === 100 - LIFT_RIDE_DROP, String(gate.y));

  // Flag 0x6B: the near pair swings 0x4000 -> 0x8000 at 0x200 a frame, so 32
  // frames exactly, and the door sound fires on the first of them only.
  G.g_script_flags[LiftFlag.OpenNear] = 1;
  sounds.length = 0;
  LiftUpdate(gate, events);
  check("the leaves' door sound fires on the first frame of the swing",
        sounds.length === 1 && sounds[0] === SFX_LIFT_GATE);
  for (let i = 1; i < 32; i++) LiftUpdate(gate, events);
  check("32 frames take the near pair exactly to its open angle",
        gate.yaw === LIFT_NEAR_OPEN, gate.yaw.toString(16));
  for (let i = 0; i < 60; i++) LiftUpdate(gate, events);
  // The engine's test is `< limit + 1`, so the frame that finds the hinge
  // exactly *at* its limit still adds a step: every one of these angles comes
  // to rest one 0x200 past the round number, and then stops.
  check("and it comes to rest one step past that and stays there",
        gate.yaw === LIFT_NEAR_OPEN + LIFT_HINGE_STEP,
        gate.yaw.toString(16));
  check("the door sound does not repeat",
        sounds.filter((x) => x === SFX_LIFT_GATE).length === 1);

  // The panel is not on a flag of its own: it waits on the frames flag 0x6B
  // has been up, which is `obj+0x2A0`.
  check("the overhead panel swung once the near pair had been folding for "
        + "0x27 frames", gate.pitch === LIFT_PANEL_OPEN + LIFT_HINGE_STEP,
        gate.pitch.toString(16));
  check("its own sound fired once", sounds.filter(
    (x) => x === SFX_LIFT_PANEL).length === 1);
  check("and 0x2A0 counted every frame the flag was up, not just the moving "
        + "ones", gate.storyItem === 1 + 31 + 60);

  // Flag 0x6C is independent: the far pair has not moved yet.
  check("the far pair has not moved -- its flag is still down",
        gate.hingeB === LIFT_FAR_CLOSED);
  G.g_script_flags[LiftFlag.OpenFar] = 1;
  LiftUpdate(gate, events);
  check("and it starts from 0x8000 the moment flag 0x6C goes up",
        gate.hingeB === LIFT_FAR_CLOSED + LIFT_HINGE_STEP);

  // The lifetime prologue still runs: three step changes, and it is gone.
  for (let b = 1; b <= 3; b++) {
    G.g_evt_step_index = b;
    LiftUpdate(gate, events);
  }
  check("and it expires on its two-step lifetime like any other prop",
        gate.dead);
  void LIFT_PANEL_DELAY;
}

console.log("\nclass 0x41 type 13, what drops out of stage 2's clock tower:");
{
  // Stage 2 block 21 step 4 op 6, evt 0xEC94, exactly as the bundle places
  // it: type 13, a four-step lifetime, (-925, 180, -1297).
  const rng = new Rng(13);
  const events = propScene(rng);
  G.g_scene_index = 1;
  G.g_evt_step_index = 4;
  const sounds: number[] = [];
  events.on("sound.play", (e) => sounds.push(e.id));
  const drop = PlaceGenericProp(
    { at: 0xec94, container: "generic", type: 13, slot: 4,
      lifetime_evt_steps: 4, pos: [-925, 180, -1297],
      pitch: 0, yaw: 0, roll: 0 }, rng);
  G.g_breakable_props.push(drop);
  const tick = (n: number) => {
    for (let i = 0; i < n; i++) {
      G.g_scene_tick_counter += 1;
      BreakablePropPoolUpdate(rng, events);
    }
  };

  check("it is its own family, because it inlines its own lifetime",
        drop.family === PropFamily.Type13);
  check("the arm gives it the 0x1A4A panel, not the descriptor's 4",
        drop.slot === TYPE13_PANEL_SLOT, drop.slot.toString(16));

  // Hanging: the panel blinks on the scene clock, 40 ticks a frame of it, and
  // nothing else moves.
  G.g_scene_tick_counter = 0;
  tick(40);
  check("hanging, the panel blinks every 40 scene ticks",
        drop.slot === TYPE13_PANEL_SLOT && drop.removeFlag === 1,
        `${drop.slot.toString(16)} ${drop.removeFlag}`);
  tick(40);
  check("...back to 0x1A49 on the next",
        drop.slot === TYPE13_PANEL_LIT_SLOT, drop.slot.toString(16));
  check("and it has not moved and made no sound",
        drop.y === 180 && sounds.length === 0 && !drop.dead);
  check("it never registers a shot sphere", !drop.shotRegistered);

  // A step change stops the blink for good and resets the panel.
  G.g_evt_step_index = 5;
  tick(1);
  check("a step change sets +0x2A0 and puts the panel back to 0x1A4A",
        drop.storyItem === 1 && drop.slot === TYPE13_PANEL_SLOT
        && drop.stepsElapsed === 1, `${drop.storyItem} ${drop.slot}`);
  tick(200);
  check("...and the blink never runs again",
        drop.slot === TYPE13_PANEL_SLOT);

  // Flag 0x6D, which block 21 step 7 op 4 raises: the release frame plays
  // both sounds and lights the panel, and nothing falls yet.
  G.g_script_flags[SCRIPT_FLAG_TYPE13_DROP] = 1;
  tick(1);
  check("flag 0x6D releases it with a beep and the shutter sound",
        drop.routinePhase === Type13Phase.Fall
        && sounds.join() === [SFX_TYPE13_BEEP, SFX_TYPE13_RELEASE].join()
        && drop.slot === TYPE13_PANEL_LIT_SLOT && drop.y === 180,
        `${drop.routinePhase} ${sounds.map((x) => x.toString(16))}`);

  // 0.02 of gravity a frame from rest: y = 180 - 0.01 n (n + 1), below the
  // -6.0 floor on the 136th frame. 186 units, which is why the cut scene
  // looking up the tower sees it go past.
  let n = 0;
  while (drop.routinePhase === Type13Phase.Fall && n < 1000) { tick(1); n++; }
  check("it falls 186 units and lands on the 136th frame",
        n === 136 && drop.y === TYPE13_FLOOR_Y, `${n} ${drop.y}`);
  check("...with the landing sound, and a 0.4 judder across Z",
        sounds[sounds.length - 1] === SFX_TYPE13_LAND
        && drop.vz === TYPE13_JUDDER, `${drop.vz}`);
  n = 0;
  while (drop.routinePhase === Type13Phase.Judder && n < 1000) {
    tick(1); n++;
  }
  check("the judder rings down at -0.925 a frame and stops after 27",
        n === 27 && drop.vz === 0 && drop.routinePhase === Type13Phase.Rest,
        `${n} ${drop.vz}`);

  // The inlined lifetime: the step count first, `ActorKill`, no sweep test in
  // between. Four steps; the fifth change retires it.
  for (let b = 6; b <= 9; b++) { G.g_evt_step_index = b; tick(1); }
  check("and it retires on the fifth step change of a four-step life",
        drop.dead);
}

console.log("\nclass 0x41 type 35, the door stage 2's block-5 civilian is behind:");
{
  // Stage 2 block 3 step 4 op 5, evt 0x2504: placed at the ORIGIN, because
  // `PropUpdateType35` draws both leaves at literal world coordinates.
  const rng = new Rng(35);
  const events = propScene(rng);
  const sounds: number[] = [];
  events.on("sound.play", (e) => sounds.push(e.id));
  const door = PlaceGenericProp(
    { at: 0x2504, container: "generic", type: 35, slot: 4,
      lifetime_evt_steps: 4, pos: [0, 0, 0], pitch: 0, yaw: 0, roll: 0 },
    rng);
  G.g_breakable_props.push(door);
  const tick = (k: number) => {
    for (let i = 0; i < k; i++) BreakablePropPoolUpdate(rng, events);
  };

  tick(100);
  check("with flag 0x68 down the door stands shut",
        door.yaw === 0 && door.storyItem === 0 && sounds.length === 0);

  G.g_script_flags[SCRIPT_FLAG_TYPE35_RATTLE] = 1;
  tick(19);
  check("flag 0x68 up: nothing for nineteen frames",
        door.routinePhase === Type35Phase.Count && sounds.length === 0,
        `${door.storyItem}`);
  tick(1);
  check("...and the knock on the twentieth",
        door.routinePhase === Type35Phase.Swing
        && sounds.join() === String(SFX_TYPE35_KNOCK));
  const swing: number[] = [];
  for (let i = 0; i < 7; i++) { tick(1); swing.push(door.yaw); }
  // `ftol(sin(phase) * 1536)`, phase 0x2000, 0x4000, then 0x1000 steps: out
  // in two frames, back in five, zeroed as it passes 0x8000.
  check("the leaves kick out 1536 BAMS in two frames and shut over five",
        swing.join() === [1086, 1536, 1419, 1086, 587, 0, 0].join(),
        swing.join());
  check("...and it is counting again",
        door.routinePhase === Type35Phase.Count && door.hingeB === 0);
  tick(29);
  check("the second knock is thirty counted frames after the first",
        sounds.length === 1, `${sounds.length}`);
  tick(1);
  check("...on the fiftieth, which resets the count",
        sounds.length === 2 && door.storyItem === 0);

  G.g_script_flags[SCRIPT_FLAG_TYPE35_STILL] = 1;
  tick(3);
  check("flag 0x69 stops it dead, whatever the swing was doing",
        door.yaw === 0);
  check("it draws the same two leaves whatever its position: the model is "
        + "0x1812 and the placement is the origin",
        GENERIC_DRAW_SLOT[35] === 0x1812 && door.x === 0 && door.z === 0);
}

console.log("\nclass 0x44 selector 11, the door that slides up:");
{
  const rng = new Rng(61);
  propScene(rng);
  // Stage 3's descriptor, exactly: evt 0x23F4, slot 0xA58 = etc_door.bin[2],
  // open flag 6, remove flag 11, at the mouth block 8's zombies come out of.
  const door = PropBuildRisingDoor(
    { at: 0x23f4, container: "rising_door", slot: RISING_DOOR_RATTLE_SLOT,
      open_flag: 6, remove_flag: 11, lifetime_evt_steps: 0,
      pos: [-356.6, -16.1, -3047.8], yaw: 0 });
  G.g_breakable_props.push(door);

  check("it is its own family, not a hinge and not a generic prop",
        door.family === PropFamily.RisingDoor);
  check("the descriptor's tail names the model, the open flag and the "
        + "remove flag",
        door.slot === 0xa58 && door.storyItem === 6 && door.removeFlag === 11);

  // No flag: it holds its placed Y for ever. `wait_enemies_alive` at stage 3
  // block 8 step 2 op 23 is 600-odd frames after the block starts, so a door
  // that crept would be visibly wrong by then.
  for (let i = 0; i < 600; i++) RisingDoorUpdate(door);
  check("with neither flag raised it never moves",
        door.y === -16.1 && door.vy === 0 && !door.dead);
  check("but it rattles while it waits, and reseeds its own amplitude",
        door.shake > 0);

  // Flag 6, which is what op 16 of that step sets. Speed starts at 0.5 and
  // gains 0.1 a frame, so the first frame moves it 0.6.
  G.g_script_flags[6] = 1;
  RisingDoorUpdate(door);
  check("the first frame of the rise seeds the speed at 0.5 and then steps it",
        Math.abs(door.vy - 0.6) < 1e-6 && Math.abs(door.y - -15.5) < 1e-6,
        `${door.vy} ${door.y}`);
  check("and the latch means the speed is seeded once, not every frame",
        door.cueCursorB === 1);

  let frames = 1;
  while (door.y < RISING_DOOR_CEILING && frames < 1000) {
    RisingDoorUpdate(door);
    frames++;
  }
  // v = 0.5 + 0.1k, y = -16.1 + 0.05k^2 + 0.55k: k = 22 is the first that
  // reaches 20.0 (36.3 of the 36.1 it has to climb), k = 21 falls short.
  check("slot 0xA58's arm clears its 20.0 ceiling from y = -16.1 in 22 "
        + "frames", frames === 22, String(frames));
  const held = door.y;
  for (let i = 0; i < 300; i++) RisingDoorUpdate(door);
  check("past the ceiling it stops writing Y rather than clamping to it -- "
        + "so it holds one frame's worth ABOVE 20, not 20",
        door.y === held && held > RISING_DOOR_CEILING, String(held));

  // Flag 11 is the last op of that step, and it is `ActorKill` and not a hide.
  const flagsBefore = door.flags;
  G.g_script_flags[11] = 1;
  RisingDoorUpdate(door);
  check("the remove flag kills it outright", door.dead);
  // `CALL 0x004A7040` at 0x00475417 -- `ActorKill`, which writes nothing to
  // the object. `ActorDespawn` would have raised `0x80018000` and dropped the
  // live bit, which is the exit the port took.
  check("...through ActorKill, which leaves the flag word as it was",
        door.flags === flagsBefore && door.flags === 0x51,
        `0x${(door.flags >>> 0).toString(16)}`);
}

console.log("\nclass 0x44 selector 13, stage 5's gate behind JUDGMENT:");
{
  // Driven the way the level drives it: a placement in the bundle, the
  // walker's spawn list, `SpawnPropContainers`, and `GameUpdate`. Before
  // selector 13 was ported the placement did not exist, the spawn built
  // nothing, and the model was drawn only by the stage's own "loaded, so
  // drawn" rule -- at the world's origin, fourteen hundred units from here.
  const rng = new Rng(65);
  const events = propScene(rng, GameMode.Arcade);
  // Stage 5's descriptor exactly: evt 0x16F4, slot 0x1892 = st5.bin[1], tail
  // +0x14 = 48, rise flag 4, remove flag 23, no blob (block 1 step 1 op 26).
  const GATE: BreakablePlacement = {
    at: 0x16f4, container: "rise_to_height", slot: 0x1892, coli: -1,
    rise: 48, open_flag: 4, remove_flag: 23, lifetime_evt_steps: 0,
    pos: [583, -70.9, -1340.2], yaw: 0,
  };
  SetGameTables(CHARS, { ...BREAKABLES,
                         placements: [...(BREAKABLES.placements ?? []), GATE] });
  SpawnPropContainers([{ at: 0x16f4, class: SpawnClass.PropPlacer }]);
  const placer = G.g_object_list.find((o) => o.at === 0x16f4);
  check("the placer is class 0x44 and dispatches on +0x11C = 13",
        placer?.cls === SpawnClass.PropPlacer
        && placer.hp === Class44Selector.RiseToHeight && placer.hp === 13,
        `${placer?.cls} ${placer?.hp}`);
  GameUpdate(1 / 60, NULL_HOST, rng, events);
  const gate = G.g_breakable_props.find((q) => q.at === 0x16f4);
  check("one frame builds the object and the placer dies",
        !!gate && gate.family === PropFamily.RiseToHeight && !!placer?.dead);
  if (!gate) throw new Error("no gate");
  // `FILD [tail+0x14]; FADD [desc+0x44]; FSTP [obj+0x2C0]`: 48 + (f32)-70.9.
  const y0 = Math.fround(-70.9);
  check("the ceiling is the descriptor's y plus the tail's whole-number "
        + "height, in f32",
        gate.y === y0 && gate.shake === Math.fround(48 + y0)
        && gate.slot === 0x1892 && gate.storyItem === 4
        && gate.removeFlag === 23 && gate.flags === 0x51,
        `${gate.y} ${gate.shake}`);

  for (let i = 0; i < 120; i++) RiseToHeightUpdate(gate);
  check("with no flag it holds its place and is drawn there, once: "
        + "Translate(583, -70.9, -1340.2) RotY(0) AssetDrawSlot(0x1892)",
        gate.y === y0 && !gate.dead && gate.draws?.length === 1
        && gate.draws[0].slot === 0x1892
        && gate.draws[0].m[12] === Math.fround(583)
        && gate.draws[0].m[13] === y0
        && gate.draws[0].m[14] === Math.fround(-1340.2),
        JSON.stringify(gate.draws?.[0]?.m.slice(12, 15)));
  check("...and, with no blob, it files nothing for the shot test",
        !gate.shotRegistered && gate.hitRadius === 0);

  // Flag 4: a unit a frame, tested before the step and strictly below.
  G.g_script_flags[4] = 1;
  const ys: number[] = [];
  for (let i = 0; i < 60; i++) { RiseToHeightUpdate(gate); ys.push(gate.y); }
  const moved = ys.filter((y, i) => y !== (i ? ys[i - 1] : y0)).length;
  check("the flag raises it 1.0 a frame, and it stops on the 48th frame, "
        + "at the ceiling and not a unit past it",
        ys[0] === Math.fround(y0 + 1) && moved === 48
        && ys[47] === gate.shake && ys[59] === gate.shake,
        `${moved} frames, ${ys[47]} / ${gate.shake}`);
  check("...drawn where it stands", gate.draws?.[0]?.m[13] === gate.shake);

  // The camera cue: path 0xDD, frame 0x35C, and nothing else.
  G.g_active_cam_path = RISE_TO_HEIGHT_KILL_PATH;
  G.g_cam_path_frame = RISE_TO_HEIGHT_KILL_FRAME - 1;
  RiseToHeightUpdate(gate);
  check("path 0xDD a frame short of 0x35C leaves it", !gate.dead);
  G.g_cam_path_frame = RISE_TO_HEIGHT_KILL_FRAME;
  const flagsBefore = gate.flags;
  RiseToHeightUpdate(gate);
  check("path 0xDD frame 0x35C kills it, through ActorKill",
        gate.dead && gate.flags === flagsBefore);
}

console.log("\nclass 0x44 selector 13, the remove flag and the blob word:");
{
  const rng = new Rng(66);
  propScene(rng, GameMode.Arcade);
  const make = (coli: number) => PropBuildRiseToHeight({
    at: 0x18c8, container: "rise_to_height", slot: 0x18c1, coli, rise: 32,
    open_flag: 6, remove_flag: 25, lifetime_evt_steps: 0,
    pos: [256.6, 2498.7, -9760.5], yaw: 0x4000 });
  const bare = make(-1);
  const blob = make(0x0cebf000);
  G.g_breakable_props.push(bare, blob);
  RiseToHeightUpdate(bare);
  RiseToHeightUpdate(blob);
  // A quarter turn, where the rotation shows (L48): RotY(0x4000) after the
  // translate leaves the translate where it is and turns the model's X.
  const m = bare.draws?.[0]?.m ?? [];
  check("the yaw is obj+0x1D0, turned after the translate",
        Math.abs(m[0]) < 1e-6 && Math.abs(Math.abs(m[2]) - 1) < 1e-6
        && m[12] === Math.fround(256.6), JSON.stringify(m));
  check("with a blob it registers for the shot test every frame; without, "
        + "never", blob.shotRegistered && !bare.shotRegistered);
  G.g_script_flags[25] = 1;
  RiseToHeightUpdate(bare);
  RiseToHeightUpdate(blob);
  check("the remove flag takes the one without a blob by ActorKill -- the "
        + "flag word untouched --",
        bare.dead && bare.flags === 0x51,
        `0x${(bare.flags >>> 0).toString(16)}`);
  check("...and the one with a blob by ActorDespawn, which marks it",
        blob.dead && ((blob.flags & 0x80018000) >>> 0) === 0x80018000
        && (blob.flags & 1) === 0,
        `0x${(blob.flags >>> 0).toString(16)}`);
}

console.log("\nclass 0x44 selector 14, a model at its descriptor's pose and scale:");
{
  // Stage 4's descriptor at 0x6588 exactly (block 10 step 2 op 2): slot
  // 0x10AE = st1_1.bin[2], lifetime 4 steps, scale (3.4566, 1, 1), all three
  // angles set. Before selector 14 was ported nothing was built, and 0x10AE
  // -- which no instruction names -- was drawn only by the stage's own
  // "loaded, so drawn" rule, at the world's origin.
  const rng = new Rng(66);
  const events = propScene(rng, GameMode.Arcade);
  const BAR: BreakablePlacement = {
    at: 0x6588, container: "draw_only_14", slot: 0x10ae,
    lifetime_evt_steps: 4, scale: [3.4566, 1, 1],
    pos: [-3.4, -53.6, -744.0], pitch: 16400, yaw: 8192, roll: 32768,
  };
  SetGameTables(CHARS, { ...BREAKABLES,
                         placements: [...(BREAKABLES.placements ?? []), BAR] });
  G.g_evt_step_index = 2;
  SpawnPropContainers([{ at: 0x6588, class: SpawnClass.PropPlacer }]);
  const placer = G.g_object_list.find((o) => o.at === 0x6588);
  check("the placer is class 0x44 and dispatches on +0x11C = 14",
        placer?.cls === SpawnClass.PropPlacer
        && placer.hp === Class44Selector.DrawOnly && placer.hp === 14,
        `${placer?.cls} ${placer?.hp}`);
  GameUpdate(1 / 60, NULL_HOST, rng, events);
  const bar = G.g_breakable_props.find((q) => q.at === 0x6588);
  check("one frame builds the object and the placer dies",
        !!bar && bar.family === PropFamily.DrawOnlySelector14 && !!placer?.dead);
  if (!bar) throw new Error("no object");
  PropDrawOnlySelector14(bar);
  // T(x, y, z + 0) Rz(0x8000) Ry(0x2000) Rx(0x4010) S(3.4566, 1, 1). Row 0 --
  // the image of +X -- is Rz's (-1, 0, 0), then `MatrixRotateY`'s `row0 =
  // row0 * c - s * row2` with row 2 still (0, 0, 1): (-cos 45, 0, -sin 45),
  // and the scale's 3.4566 on it alone. Worked by hand from the routine.
  const m = bar.draws?.[0]?.m ?? [];
  const r0 = Math.hypot(m[0], m[1], m[2]);
  check("it draws its slot once, at its point, under Rz Ry Rx and its scale",
        bar.draws?.length === 1 && bar.draws[0].slot === 0x10ae
        && m[12] === Math.fround(-3.4) && m[13] === Math.fround(-53.6)
        && m[14] === Math.fround(-744.0)
        && Math.abs(r0 - Math.fround(3.4566)) < 1e-4
        && Math.abs(Math.hypot(m[4], m[5], m[6]) - 1) < 1e-6
        && Math.abs(m[0] - -Math.fround(3.4566) * Math.SQRT1_2) < 1e-3
        && Math.abs(m[2] - -Math.fround(3.4566) * Math.SQRT1_2) < 1e-3,
        JSON.stringify(m.map((v) => +v.toFixed(3))));
  check("...and files nothing for the shot test",
        !bar.shotRegistered && bar.hitRadius === 0);
  // The lifetime: four step changes are allowed, the fifth retires it.
  for (let k = 0; k < 4; k++) {
    G.g_evt_step_index += 1;
    PropDrawOnlySelector14(bar);
  }
  check("four step changes and it is still drawn",
        !bar.dead && bar.draws?.length === 1);
  G.g_evt_step_index += 1;
  PropDrawOnlySelector14(bar);
  check("the fifth retires it before it draws",
        !!bar.dead && !bar.draws?.length);
}

console.log("\nclass 0x44 selector 12, stage 6's sliding doors:");
{
  // Driven the way the level drives it: a placement, the spawn list,
  // `SpawnPropContainers` and a frame of `GameUpdate`. Stage 6 block 0 step 2
  // op 13's pair, exactly: evt 0x0B00 and 0x0B48, slots 0x189B/0x189D, speeds
  // -1 and +1, 21 units, flag 5 -- and the only two with a blob.
  const rng = new Rng(67);
  const events = propScene(rng, GameMode.Arcade);
  const L: BreakablePlacement = {
    at: 0x0b00, container: "slide_on_flag", slot: 0x189b, slot_word: 0x189b,
    coli: 0x0cecf000, speed: -1, travel: 21, open_flag: 5, remove_flag: 24,
    lifetime_evt_steps: 0, pos: [560, -51.3, -9158.6], yaw: 0 };
  const R: BreakablePlacement = { ...L, at: 0x0b48, slot: 0x189d,
    slot_word: 0x189d, coli: 0x0cecf068, speed: 1, pos: [600, -51.3, -9158.6] };
  SetGameTables(CHARS, { ...BREAKABLES,
                         placements: [...(BREAKABLES.placements ?? []), L, R] });
  SpawnPropContainers([0x0b00, 0x0b48].map(
    (at) => ({ at, class: SpawnClass.PropPlacer })));
  GameUpdate(1 / 60, NULL_HOST, rng, events);
  const left = G.g_breakable_props.find((q) => q.at === 0x0b00);
  const right = G.g_breakable_props.find((q) => q.at === 0x0b48);
  check("selector 12 builds both leaves from their placements",
        left?.family === PropFamily.SlideOnFlag
        && right?.family === PropFamily.SlideOnFlag);
  if (!left || !right) throw new Error("no doors");
  // `FSIN(PI/2) * -1` and `FCOS(PI/2) * -1`, each stored as an f32.
  check("the slide is sin/cos of PI/2 times the tail's integer speed",
        left.vx === -1 && right.vx === 1
        && left.vz === Math.fround(Math.cos(Math.PI / 2) * -1),
        `${left.vx} ${left.vz}`);
  for (let i = 0; i < 60; i++) { SlideOnFlagUpdate(left); SlideOnFlagUpdate(right); }
  check("shut until the flag: each draws its slot where it was placed, in "
        + "draw layer 9",
        left.x === 560 && right.x === 600 && left.draws?.length === 1
        && left.draws[0].slot === 0x189b && left.draws[0].layer === 9
        && left.draws[0].m[12] === 560);
  G.g_script_flags[5] = 1;
  const xs: number[] = [];
  for (let i = 0; i < 40; i++) { SlideOnFlagUpdate(left); SlideOnFlagUpdate(right); xs.push(left.x); }
  // The sum is taken before the test: steps 1..20 are short of 21, the 21st
  // is not, so the leaf moves twenty times and stops a unit short.
  check("the flag parts them a unit a frame: the running total is added "
        + "before it is tested, so a 21-unit door moves 20 times",
        left.x === 540 && right.x === 620 && xs[19] === 540 && xs[18] === 541,
        `${left.x} ${right.x} ${xs.slice(17, 22).join()}`);
  check("...and both carry blobs, so both file for the shot test",
        left.shotRegistered && right.shotRegistered);
  G.g_script_flags[24] = 1;
  SlideOnFlagUpdate(left);
  check("the remove flag takes a leaf with a blob by ActorDespawn",
        left.dead && ((left.flags & 0x80018000) >>> 0) === 0x80018000);
}

console.log("\nclass 0x44 selector 12, the elevator car's doors are in its frame:");
{
  // Stage 6 block 0 step 2 op 15: evt 0x0C20, slot 0xAFC, placed at (0, 6.5,
  // -11.3) -- the car's own frame -- and moved by the constructor to where the
  // car parks in block 0, (557.5, -57.8, -9880.2) turned 0x7555.
  const rng = new Rng(68);
  propScene(rng, GameMode.Arcade);
  G.g_evt_block_index = 0;
  const door = PropBuildSlideOnFlag({
    at: 0x0c20, container: "slide_on_flag", slot: 0xafc, slot_word: 0xafc,
    coli: -1, speed: 1, travel: 6, open_flag: 3, remove_flag: 22,
    lifetime_evt_steps: 0, pos: [0, 6.5, -11.3], yaw: 0 });
  // RotY(0x7555) takes +X to (c, 0, -s) and +Z to (s, 0, c), so the local
  // (0, 6.5, -11.3) lands at (557.5 - 11.3 s, -51.3, -9880.2 - 11.3 c).
  const a = 0x7555 * 2 * Math.PI / 65536;
  const c = Math.cos(a), sn = Math.sin(a);
  check("the constructor carries the descriptor into the parked car's frame",
        Math.abs(door.x - (SLIDE_CAR_X - 11.3 * sn)) < 1e-3
        && Math.abs(door.y - (SLIDE_CAR_Y_BLOCK0 + 6.5)) < 1e-3
        && Math.abs(door.z - (SLIDE_CAR_Z - 11.3 * c)) < 1e-3
        && door.yaw === 0x7555,
        `${door.x} ${door.y} ${door.z}`);
  check("...where block 0 parks it: 554.6, -51.3, -9869.3",
        Math.abs(door.x - 554.575) < 1e-2 && Math.abs(door.z - -9869.285) < 1e-2);
  check("...and slides along the car's own x, not the world's",
        Math.abs(door.vx - c) < 1e-6 && Math.abs(door.vz - -sn) < 1e-6,
        `${door.vx} ${door.vz}`);
  G.g_evt_block_index = 3;
  const high = PropBuildSlideOnFlag({
    at: 0x1838, container: "slide_on_flag", slot: 0xafc, slot_word: 0xafc,
    coli: -1, speed: 1, travel: 6, open_flag: 4, remove_flag: 23,
    lifetime_evt_steps: 0, pos: [0, 6.5, 15.5], yaw: 0 });
  check("in any other block the car is parked at the top, y 2492.2",
        Math.abs(high.y - (Math.fround(2492.2) + 6.5)) < 1e-3, String(high.y));
  G.g_script_flags[3] = 1;
  const x0 = door.x;
  for (let i = 0; i < 20; i++) SlideOnFlagUpdate(door);
  // The step is measured from the two f32 components, whose length is
  // 0.99999998 and not 1: six steps sum to 5.9999999, still short of 6, so
  // the car's door moves six times where the straight doors above move a
  // whole unit fewer than their length.
  check("a 6-unit car door moves six times: its f32 step is a hair under 1",
        Math.abs((door.x - x0) - 6 * door.vx) < 1e-3,
        `${door.x - x0}`);
  check("...and never files for the shot test without a blob",
        !door.shotRegistered);
}

console.log("\nclass 0x44 selector 9, stage 3's lift to y 10:");
{
  const rng = new Rng(69);
  propScene(rng, GameMode.Arcade);
  // Stage 3 block 0 step 4 op 7: evt 0x0D24, slot 0x1986, flags 5 and 10.
  const p = PropBuildFlagLiftedProp({
    at: 0x0d24, container: "flag_lifted", slot: 0x1986, open_flag: 5,
    remove_flag: 10, lifetime_evt_steps: 0,
    pos: [-1079.9, -25.4, -3018.5] });
  check("it is built with no flag word and no yaw",
        p.family === PropFamily.FlagLifted && p.flags === 0 && p.yaw === 0);
  FlagLiftedPropUpdate(p);
  check("shut, it draws its slot at its descriptor, unturned",
        p.draws?.length === 1 && p.draws[0].slot === 0x1986
        && p.draws[0].m[12] === Math.fround(-1079.9)
        && p.draws[0].m[13] === Math.fround(-25.4)
        && p.draws[0].m[0] === 1 && p.draws[0].m[2] === 0);
  G.g_script_flags[5] = 1;
  let n = 0;
  while (p.y < 10 && n < 1000) { FlagLiftedPropUpdate(p); n++; }
  // 0.8f a frame from (f32)-25.4 against the double 10.0: 45 steps, and it
  // stops on the first y past 10 -- 10.6, not 10.
  check("the flag lifts it 0.8 a frame to the first y at or past 10",
        n === 45 && p.y === Math.fround(10.599995613098145),
        `${n} ${p.y}`);
  for (let i = 0; i < 10; i++) FlagLiftedPropUpdate(p);
  check("...and it holds there", p.y === Math.fround(10.599995613098145));
  G.g_script_flags[10] = 1;
  FlagLiftedPropUpdate(p);
  check("the remove flag kills it, by ActorKill", p.dead && p.flags === 0);
}

console.log("\nclass 0x41 constructor 47, stage 2's faded disc:");
{
  const rng = new Rng(70);
  const events = propScene(rng, GameMode.Arcade);
  // Stage 2 block 35 step 1 op 52: evt 0x14990, constructor 47.
  const pl: BreakablePlacement = {
    at: 0x14990, container: "type47", lifetime_evt_steps: 0,
    pos: [-1355, -28, -2020] };
  SetGameTables(CHARS, { ...BREAKABLES,
                         placements: [...(BREAKABLES.placements ?? []), pl] });
  SpawnPropContainers([{ at: 0x14990, class: SpawnClass.PropContainerPlacer }]);
  const placer = G.g_object_list.find((o) => o.at === 0x14990);
  check("the placer carries constructor 47 in +0x130C",
        placer?.condition === 47, String(placer?.condition));
  G.g_evt_step_index = 1;
  GameUpdate(1 / 60, NULL_HOST, rng, events);
  const disc = G.g_breakable_props.find((q) => q.at === 0x14990);
  check("one frame builds it", disc?.family === PropFamily.Type47);
  if (!disc) throw new Error("no disc");
  PropUpdateType47(disc);
  const d = disc.draws?.[0];
  // RotX(0xC000) then Scale(0.4): row 1 is (0, 0, -1) * 0.4 and row 2 is
  // (0, 1, 0) * 0.4 -- lying flat, 54 units across.
  check("it draws 0x1384 flat at 0.4 scale at its descriptor, faded to 0.8",
        d?.slot === TYPE47_SLOT && d.alpha === Math.fround(0.8)
        && d.m[12] === -1355 && d.m[13] === -28 && d.m[14] === -2020
        && Math.abs(d.m[6] - -0.4) < 1e-6 && Math.abs(d.m[9] - 0.4) < 1e-6,
        JSON.stringify(d));
  G.g_evt_step_index = 2;
  PropUpdateType47(disc);
  check("step index 2 kills it", disc.dead);
  const again = PlaceType47Prop(pl);
  G.g_evt_step_index = 1;
  G.g_script_flags[TYPE47_KILL_FLAG] = 1;
  PropUpdateType47(again);
  check("...and so does script flag 0x11", again.dead);
}

console.log("\nclass 0x44 selector 11, stage 5's door takes the other arm:");
{
  const rng = new Rng(62);
  propScene(rng);
  // Stage 5's descriptor: evt 0x0C2C, slot 0x189A = st5.bin[9], flags 2 and 7.
  const door = PropBuildRisingDoor(
    { at: 0x0c2c, container: "rising_door", slot: 0x189a,
      open_flag: 2, remove_flag: 7, lifetime_evt_steps: 0,
      pos: [275.4, 12.0, -89.6], yaw: 0 });
  G.g_breakable_props.push(door);

  // `CMP word ptr [ESI+0x28C], 0xA58` decides both the rattle and the pair.
  check("a slot that is not 0xA58 does not rattle at all",
        !RisingDoorRattles(door.slot));
  for (let i = 0; i < 200; i++) RisingDoorUpdate(door);
  check("...and its amplitude is never seeded", door.shake === 0);
  check("it takes the 35.0 / 0.01 arm",
        RisingDoorRise(door.slot)[0] === RISING_DOOR_CEILING_OTHER
        && RisingDoorRise(door.slot)[1] === RISING_DOOR_STEP_OTHER);

  G.g_script_flags[2] = 1;
  let frames = 0;
  while (door.y < RISING_DOOR_CEILING_OTHER && frames < 1000) {
    RisingDoorUpdate(door);
    frames++;
  }
  // A hundredth a frame rather than a tenth. It has less to climb -- 23
  // against 36.1 -- and still takes half again as long, because the engine
  // names one slot and not a speed.
  check("the slower arm takes 35 frames to clear 35.0 from y = 12",
        frames === 35, String(frames));
  check("and there is no lifetime on this family -- step changes do not "
        + "retire it", (() => {
          for (let b = 1; b <= 20; b++) {
            G.g_evt_step_index = b;
            RisingDoorUpdate(door);
          }
          return !door.dead;
        })());
}

console.log("\nclass 0x41, four types take their lifetime from +0x1F4:");
{
  const rng = new Rng(63);
  propScene(rng);
  // The stage 5 van body, exactly: type 51, `+0x11C` = 0x1793 (the model) and
  // `desc+0x24` = 4 (the lifetime). Reading the first as both is what gave it
  // 6035 event steps in a nine-block stage.
  const van = PlaceGenericProp(
    { at: 0x0d3c, container: "generic", type: 51, slot: 0x1793,
      lifetime_evt_steps: 0x1793, field_1f4: 4,
      pos: [280.0, 2.0, -222.3], pitch: 0, yaw: 4915, roll: 0 }, rng);
  G.g_breakable_props.push(van);

  check("type 51 is a descriptor-slot type, so +0x11C really is the model",
        GENERIC_DESCRIPTOR_SLOT.has(51) && van.slot === 0x1793);
  check("and its lifetime is the OTHER field, not that slot",
        GENERIC_LIFETIME_FROM_1F4.has(51) && van.lifetime === 4,
        String(van.lifetime));
  check("the model it draws is the slot and not a literal -- 51 is absent "
        + "from GENERIC_DRAW_SLOT on purpose",
        GENERIC_DRAW_SLOT[51] === undefined);

  for (let b = 1; b <= 4; b++) {
    G.g_evt_step_index = b;
    PropExpireByStepLifetime(van);
  }
  check("four step changes leave it standing", !van.dead);
  G.g_evt_step_index = 5;
  PropExpireByStepLifetime(van);
  check("the fifth retires it -- with the slot as the lifetime it would have "
        + "stood there for the rest of the stage", van.dead);

  // A type NOT in the set still reads the word it always did.
  const other = PlaceGenericProp(
    { at: 0x0e00, container: "generic", type: 20, slot: 1,
      lifetime_evt_steps: 1, field_1f4: 7, pos: [0, 0, 0],
      pitch: 0, yaw: 0, roll: 0 }, rng);
  check("a type outside the set is untouched by this and still reads +0x11C",
        !GENERIC_LIFETIME_FROM_1F4.has(20) && other.lifetime === 1);
}

console.log("\nclass 0x41, a generic prop's +0x11C is a lifetime:");
{
  const rng = new Rng(43);
  const events = propScene(rng);
  // The stage-2 shape: `hp` 1, which is a lifetime of one event *step* and
  // NOT asset slot 1 (`bg_adv10.bin`).
  const p = PlaceGenericProp(
    { at: 0xbe00, container: "generic", type: 20, slot: 1,
      lifetime_evt_steps: 1, pos: [0, 0, 0], pitch: 0, yaw: 0, roll: 0 },
    rng);
  G.g_breakable_props.push(p);
  check("the lifetime is the descriptor's +0x11C", p.lifetime === 1);
  check("and the model is the literal its routine draws, not that number",
        GENERIC_DRAW_SLOT[20] === 0x1e2);
  for (let i = 0; i < 600; i++) PropExpireByStepLifetime(p);
  check("frames alone do not expire it", !p.dead);
  for (let b = 1; b <= 2; b++) {
    G.g_evt_step_index = b;
    PropExpireByStepLifetime(p);
  }
  check("two step advances past a lifetime of one do", p.dead);

  // The bug this replaced, stated so it cannot come back: the counter is the
  // step index, so a prop ages *inside* a block as well as across one. When
  // it was a monotonic per-block counter every prop lived about four times
  // too long -- blocks average 3.99 steps.
  G.g_evt_step_index = 1;                  // placed in block N's first step
  const r = PlaceGenericProp(
    { at: 0xbe80, container: "generic", type: 20, slot: 1,
      lifetime_evt_steps: 1, pos: [0, 0, 0], pitch: 0, yaw: 0, roll: 0 },
    rng);
  PropExpireByStepLifetime(r);
  check("a prop placed in step 1 survives its own step", !r.dead);
  G.g_evt_step_index = 2;                  // still block N, second step
  PropExpireByStepLifetime(r);
  check("...and its lifetime of one carries it one step further", !r.dead);
  G.g_evt_step_index = 3;                  // still block N, third step
  PropExpireByStepLifetime(r);
  check("...but it is gone by step 3, without the block ever changing",
        r.dead);

  // The scene-1 sweep.
  const q = PlaceGenericProp(
    { at: 0xbe40, container: "generic", type: 20, slot: 9,
      lifetime_evt_steps: 9, pos: [0, 0, 0], pitch: 0, yaw: 0, roll: 0 },
    rng);
  G.g_scene_index = 1;
  G.g_script_flags[0x77] = 1;
  PropExpireByStepLifetime(q);
  check("g_script_flags[0x77] clears every prop on scene 1", q.dead);
  G.g_scene_index = 0;
  G.g_script_flags[0x77] = 0;
  void events;
}

console.log("\nclass 0x41, Original Mode's collectibles in Arcade:");
{
  const rng = new Rng(47);
  const events = propScene(rng);
  // `FUN_004675A0`'s first line is `if (g_GameMode != 1) ActorDespawn(obj)`.
  const p = PlaceGenericProp(
    { at: 0xbf00, container: "generic", type: 70, slot: 3,
      lifetime_evt_steps: 3, pos: [0, 0, 0], pitch: 0, yaw: 0, roll: 0 },
    rng);
  G.g_breakable_props.push(p);
  G.g_GameMode = GameMode.Arcade;
  BreakablePropPoolUpdate(rng, events);
  check("an Original-Mode-only type is gone on its first Arcade frame",
        G.g_breakable_props.length === 0);

  const q = PlaceGenericProp(
    { at: 0xbf40, container: "generic", type: 70, slot: 3,
      lifetime_evt_steps: 3, pos: [0, 0, 0], pitch: 0, yaw: 0, roll: 0 },
    rng);
  G.g_breakable_props.push(q);
  G.g_GameMode = GameMode.Original;
  BreakablePropPoolUpdate(rng, events);
  check("and survives in Original Mode", !q.dead);
  check("70 to 77 each run their own g_class41_updates row, as generic props",
        [70, 71, 72, 73, 74, 75, 76, 77].every((ty) => PlaceGenericProp(
          { at: 0xbf80, container: "generic", type: ty, slot: 1,
            lifetime_evt_steps: 1, pos: [0, 0, 0], pitch: 0, yaw: 0,
            roll: 0 }, rng).family === PropFamily.Generic
          && GENERIC_ROUTINES[ty] !== undefined)
        && GENERIC_ROUTINES[70] === GENERIC_ROUTINES[71]);
  G.g_GameMode = GameMode.Arcade;
}

console.log("\nclass 0x41 types 70-77, Original Mode's collectibles and neighbours:");
{
  type Placement = Parameters<typeof PlaceGenericProp>[0];
  const place = (type: number, rng: Rng, over: Partial<Placement> = {}) => {
    const p = PlaceGenericProp(
      { at: 0xc000 + type, container: "generic", type, slot: 1,
        lifetime_evt_steps: 9, field_1f4: 6, pos: [10, 20, 30], pitch: 0,
        yaw: 0, roll: 0, ...over }, rng);
    G.g_breakable_props.push(p);
    return p;
  };
  const heard = (events: Events): number[] => {
    const out: number[] = [];
    events.on("sound.play", (e) => out.push(e.id));
    return out;
  };
  const alive = (p: { id: number }) =>
    G.g_breakable_props.some((q) => q.id === p.id && !q.dead);
  const W = (p: BreakableProp) => PropWords(p, COLLECTIBLE_WORDS_ZERO);
  const world = (ops: (m: number[]) => void): number[] => {
    const m = MatIdentity(); ops(m); return m;
  };
  const same = (a: number[] | undefined, b: number[]): boolean =>
    !!a && a.length === 16 && a.every((v, i) => Math.abs(v - b[i]) < 1e-4);
  const slots = (p: BreakableProp) => (p.draws ?? []).map((c) => c.slot);
  /** Install one `op_` path; `k(a, b)` is a key at frame 0 and one at 1. */
  const onPath = (slot: number, ch: Record<string, number[][]>) =>
    SetCameraPaths(new CamPaths({ fps: 60, paths: {}, object_paths: {
      [String(slot)]: { file: "op_test", index: 0, start: 0, duration: 1,
                        channels: ch },
    } } as never));
  const k = (a: number, b = a) => [[0, a, 0, 0], [1, b, 0, 0]];
  /** Row 6's walk, written out: weights 2, 3, 4, 6 over ids 3, 5, 31, 21. */
  const row6 = (m: number) => (m < 2 ? 3 : m < 3 ? 5 : m < 4 ? 31 : 21);
  const holdItem = (id: number) => {
    G.g_players_in_play = 1;
    G.g_active_player = 0;
    G.g_original_item_slots[0] = [id, -1];
  };

  // --- PickOriginalModeItem: the model is the table's, not the descriptor's
  {
    propScene(new Rng(1));
    let same6 = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const q = makeBreakableProp(1, 0, 0);
      PickOriginalModeItem(q, 6, new Rng(seed));
      const want = row6(new Rng(seed).int(6));
      const rec = BREAKABLES.original_items!.records[String(want)];
      const w = W(q);
      if (w.o290 === want && q.slot === rec.slot
          && w.o28e === ((rec.slot2 << 16) >> 16) && w.o2c4 === rec.scale) {
        same6++;
      }
    }
    check("PickOriginalModeItem walks the row's cumulative weights",
          same6 === 60, `${same6} of 60`);
    const probe = (r: number): number => {
      const q = makeBreakableProp(1, 0, 0);
      PickOriginalModeItem(q, 6, { int: () => r } as unknown as Rng);
      return W(q).o290;
    };
    check("...at the boundaries: 0,1 -> 3; 2 -> 5; 3 -> 31; 4,5 -> 21",
          [0, 1, 2, 3, 4, 5].map(probe).join() === "3,3,5,31,21,21");
    const rng = new Rng(4);
    G.g_original_item_pickup_blocked = 1;
    const p = place(70, rng);
    check("...and a type 70's arm overwrites the descriptor's slot with it",
          p.slot !== 1 && p.slot === BREAKABLES.original_items!
            .records[String(W(p).o290)].slot,
          `slot 0x${p.slot.toString(16)} item ${W(p).o290}`);
    check("...keeps the descriptor word as its lifetime",
          p.lifetime === 9, String(p.lifetime));
    check("...writes the placer's byte to +0x194", W(p).o194 === 6,
          String(W(p).o194));
    check("...and clears g_original_item_pickup_blocked",
          G.g_original_item_pickup_blocked === 0);
  }
  // A row whose draw is -1 is nothing, and leaves on its first frame.
  {
    propScene(new Rng(1));
    let seed = 1;
    while (new Rng(seed).int(6) >= 4) seed++;
    const p = place(70, new Rng(seed), { field_1f4: 9 });
    check("an item id of -1 zeroes both models and the scale is 1.0",
          W(p).o290 === -1 && p.slot === 0 && W(p).o28e === 0
          && W(p).o2c4 === 1, `${W(p).o290} ${p.slot}`);
    BreakablePropPoolUpdate(new Rng(1));
    check("...and OriginalItemPropUpdate despawns it", !alive(p));
  }
  // Case 0x46's scene-4 rule and case 0x47's seed.
  {
    propScene(new Rng(1));
    G.g_scene_index = 4;
    const a = place(70, new Rng(2), { field_1f4: 1 });
    const b = place(70, new Rng(2), { field_1f4: 2 });
    check("a scene-4 row-1 type 70 takes twice the radius",
          a.hitRadius === 6 && b.hitRadius === 3,
          `${a.hitRadius} / ${b.hitRadius}`);
    G.g_scene_index = 1;
    const rng = new Rng(71), mirror = new Rng(71);
    const c = place(71, rng, { pitch: 0x100, roll: 0x200 });
    mirror.int(6);                          // PickOriginalModeItem's draw
    const rate = () => 0x60 - mirror.int(2) * 0xa0 - mirror.int(0x21);
    const spin = rate(), roll = rate();
    check("case 0x47 seeds 0x60 - (rand() % 2) * 0xA0 - rand() % 0x21",
          c.spin === spin && c.rollSpin === roll,
          `${c.spin}/${spin} ${c.rollSpin}/${roll}`);
    check("...with the bob bit, an amplitude of 1.5, a 0x200 step and its "
          + "centre at the placement",
          (c.flags & ORIGINAL_ITEM_BOBS) !== 0 && c.shake === 1.5
          && c.yawSpin === 0x200 && c.restY === 20);
    check("...and drops the descriptor's pitch and roll",
          c.pitch === 0 && c.roll === 0);
  }

  // --- OriginalItemPropUpdate: the draws and the pickup --------------------
  {
    const events = propScene(new Rng(1));
    const sfx = heard(events);
    G.g_scene_index = 1;
    G.g_evt_block_index = 2;
    // Item 3 of row 6: a model and a second model, scale 1.
    let seed = 1;
    while (row6(new Rng(seed).int(6)) !== 3) seed++;
    const rng = new Rng(seed);
    const p = place(70, rng, { pitch: 0x300, roll: 0x500 });
    const id = W(p).o290;
    const before = G.g_original_items_taken[id] ?? 0;
    G.g_camera_view_to_world = world((m) => MatrixRotateY(m, 0x2000));
    BreakablePropPoolUpdate(rng, events);
    check("an untaken collectible registers 1.5 above its origin",
          p.shotRegistered && p.shotY === 21.5, String(p.shotY));
    check("...and a type 70 turns 0x400 a frame", p.yaw === 0x400,
          String(p.yaw));
    const d0 = p.draws ?? [];
    check("it draws its model under T Rz Ry Rx and the record's scale",
          id === 3 && d0.length === 2 && d0[0].slot === 0x10a5
          && d0[0].alpha === undefined
          && same(d0[0].m, world((m) => {
            MatrixTranslate(m, 10, 20, 30); MatrixRotateZ(m, 0x500);
            MatrixRotateY(m, 0x400); MatrixRotateX(m, 0x300);
          })), JSON.stringify(slots(p)));
    check("...and its second model square to the camera, 1.5 toward it",
          d0[1]?.slot === 0x10a6 && same(d0[1].m, world((m) => {
            MatrixTranslate(m, 10, 20, 30); MatrixRotateY(m, 0x2000);
            MatrixTranslate(m, 0, 0, 1.5);
          })));
    G.g_camera_view_to_world = MatIdentity();
    BreakablePropTakeShot(p, 1);
    BreakablePropPoolUpdate(rng, events);
    check("a shot takes it: +0x2A0 = 1 and the flag's taken bit",
          p.storyItem === 1 && (p.flags & ORIGINAL_ITEM_TAKEN) !== 0,
          String(p.storyItem));
    check("...the strip is player 1's, 0x119C, drawn at +0x2A4 - 1 + +0x2A0",
          p.removeFlag === ORIGINAL_ITEM_PICKUP_SLOT_P1
          && slots(p)[2] === 0x119c, p.removeFlag.toString(16));
    check("...the item is counted into g_original_items_taken",
          G.g_original_items_taken[id] === before + 1);
    check("...the pickup sound plays", sfx.includes(SFX_ORIGINAL_ITEM_PICKUP));
    check("...and a banner goes up with the record's sprite",
          G.g_original_item_banners.length === 1
          && G.g_original_item_banners[0].sprite === BREAKABLES
            .original_items!.records[String(id)].sprite
          && G.g_original_item_banner_count === 1);
    check("the routine clears bit 3 and leaves the player bits",
          (p.flags & BreakableFlag.Hit) === 0
          && (p.flags & BreakableFlag.HitByPlayer1) !== 0);
    const drawn = G.g_screen_sprite_draws.filter(
      (s) => s.id === ITEM_BANNER_FRAME_SPRITE);
    check("the banner draws its frame sprite on the frame it is made",
          drawn.length === 1 && drawn[0].alpha === 1);
    // The strip: 0x31 frames counted from 1, and the frame after leaves.
    for (let i = 0; i < 0x18 - 1; i++) BreakablePropPoolUpdate(rng, events);
    check("frame 0x18 of the strip still draws the item plainly",
          p.storyItem === 0x18 && p.draws?.[0]?.alpha === undefined);
    for (let i = 0x18; i < 0x31; i++) BreakablePropPoolUpdate(rng, events);
    check("...it plays the pickup strip to frame 0x31", alive(p)
          && p.storyItem === 0x31, String(p.storyItem));
    const fade = Math.fround(1 - 0x31 * 0.019999999552965164);
    check("...drawing the strip frame 0x119C + 0x30 and both models faded "
          + "at 1 - n * 0.02",
          slots(p)[2] === 0x119c + 0x30 && p.draws?.[0]?.alpha === fade
          && p.draws?.[1]?.alpha === fade,
          (p.draws ?? []).map((q) => `${q.slot.toString(16)}:${q.alpha}`)
            .join());
    check("...still registered while it plays", p.shotRegistered);
    BreakablePropPoolUpdate(rng, events);
    check("...and is gone the frame after", !alive(p));
  }
  // An item with no second model draws one model.
  {
    propScene(new Rng(1));
    G.g_scene_index = 1;
    let seed = 1;
    while (row6(new Rng(seed).int(6)) !== 21) seed++;
    const rng = new Rng(seed);
    const p = place(70, rng);
    BreakablePropPoolUpdate(rng);
    check("item 21 (no second model) draws one, at scale 1.5",
          W(p).o28e === -1 && slots(p).join() === String(0x1096)
          && Math.abs(Math.hypot(p.draws![0].m[0], p.draws![0].m[1],
                                 p.draws![0].m[2]) - 1.5) < 1e-6);
  }
  // Two players on the same frame: rand() % 2 picks the strip.
  {
    propScene(new Rng(1));
    G.g_scene_index = 1;
    G.g_evt_block_index = 2;
    const rng = new Rng(12);
    const p = place(70, rng);
    BreakablePropTakeShot(p, 0);
    BreakablePropTakeShot(p, 1);
    BreakablePropPoolUpdate(rng);
    check("both players at once: a strip from 0x116A or 0x119C",
          p.removeFlag === ORIGINAL_ITEM_PICKUP_SLOT
          || p.removeFlag === ORIGINAL_ITEM_PICKUP_SLOT_P1,
          p.removeFlag.toString(16));
  }
  // The blocked byte, the scene-1 block-1 refusal and scene 2's unblock.
  {
    const rng = new Rng(13);
    propScene(rng);
    G.g_scene_index = 1;
    G.g_evt_block_index = 2;
    const p = place(70, rng);
    G.g_original_item_pickup_blocked = 1;
    BreakablePropTakeShot(p, 0);
    BreakablePropPoolUpdate(rng);
    check("g_original_item_pickup_blocked refuses the pickup",
          p.storyItem === 0 && (p.flags & BreakableFlag.Hit) === 0);
    G.g_original_item_pickup_blocked = 0;
    G.g_evt_block_index = 1;
    BreakablePropTakeShot(p, 0);
    BreakablePropPoolUpdate(rng);
    check("...and so does scene 1 block 1", p.storyItem === 0);
    G.g_scene_index = 2;
    G.g_evt_block_index = 10;
    G.g_cam_path_frame = 0x3d;
    G.g_original_item_pickup_blocked = 1;
    BreakablePropTakeShot(p, 0);
    BreakablePropPoolUpdate(rng);
    check("scene 2 block 10 past camera frame 0x3C clears the byte and takes it",
          p.storyItem === 1 && G.g_original_item_pickup_blocked === 0);
  }
  // The route and the removals.
  {
    const rng = new Rng(14);
    propScene(rng);
    G.g_scene_index = 2;
    G.g_evt_block_index = 4;
    G.g_script_flags[0x13] = 1;
    const p = place(70, rng);
    G.g_script_branch_var = 0;
    BreakablePropPoolUpdate(rng);
    check("scene 2 block 4 with flag 0x13 writes the scene index, 2",
          G.g_script_branch_var === 2 && alive(p));
    const q = place(70, rng, { field_1f4: 5 });
    G.g_evt_block_index = 9;
    BreakablePropPoolUpdate(rng);
    check("scene 2 block 9 takes the row-5 collectibles away",
          !alive(q) && alive(p));
    propScene(rng);
    G.g_scene_index = 4;
    G.g_evt_block_index = 3;
    const r = place(70, rng, { field_1f4: 0 });
    BreakablePropPoolUpdate(rng);
    check("scene 4 block 3 keeps them while flag 0x0B is down", alive(r));
    G.g_script_flags[0x0b] = 1;
    BreakablePropPoolUpdate(rng);
    check("...and takes them when it is raised", !alive(r));
  }
  // Type 70's facing model, and type 71's bob.
  {
    const rng = new Rng(15);
    propScene(rng);
    G.g_scene_index = 1;
    const p = place(70, rng);
    p.slot = ORIGINAL_ITEM_FACING_SLOT;
    G.g_camera_block_eye.x = 10;
    G.g_camera_block_eye.z = 40;          // straight down +z from the prop
    BreakablePropPoolUpdate(rng);
    // atan2(0, -10) is a half turn, 0x8000 as an s16 is -0x8000, and the
    // routine turns it half round again.
    check("model 0x109F faces the camera block's eye instead of turning",
          p.yaw === 0, String(p.yaw));
    const b = place(71, rng);
    const y0 = b.y;
    BreakablePropPoolUpdate(rng);
    BreakablePropPoolUpdate(rng);
    check("a type 71 bobs off its centre and tumbles",
          b.y !== y0 && b.pitch !== 0 && b.yaw === 0x800,
          `${b.y} ${b.pitch} ${b.yaw}`);
  }
  // The banner on its own: 0x96 frames, the fade, and scene 5's one-at-a-time.
  {
    const rng = new Rng(16);
    propScene(rng);
    G.g_scene_index = 1;
    const p = place(70, rng);
    BreakablePropTakeShot(p, 0);
    BreakablePropPoolUpdate(rng);
    const b = G.g_original_item_banners[0];
    for (let i = 1; i < 0x8f; i++) {
      G.g_screen_sprite_draws = [];
      OriginalItemBannersTick();
    }
    G.g_screen_sprite_draws = [];
    OriginalItemBannersTick();
    const a = G.g_screen_sprite_draws[0]?.alpha ?? -1;
    check("the banner fades after frame 0x87 at (0x96 - n) / 15",
          b.frame === 0x90
          && a === Math.fround((0x96 - 0x90) * 0.06666667014360428),
          `${b.frame} ${a}`);
    for (let i = 0x90; i < ITEM_BANNER_FRAMES; i++) OriginalItemBannersTick();
    check("...is up for 0x96 frames",
          G.g_original_item_banners.length === 1, String(b.frame));
    OriginalItemBannersTick();
    check("...and then gone, with the count back to 0",
          G.g_original_item_banners.length === 0
          && G.g_original_item_banner_count === 0);
    propScene(rng);
    G.g_scene_index = 5;
    const c = place(70, rng, { field_1f4: 0 });
    const d = place(70, rng, { field_1f4: 0 });
    BreakablePropTakeShot(c, 0);
    BreakablePropTakeShot(d, 0);
    BreakablePropPoolUpdate(rng);
    OriginalItemBannersTick();
    check("in scene 5 only one banner survives two",
          G.g_original_item_banners.length === 1
          && G.g_original_item_banner_count === 1,
          String(G.g_original_item_banners.length));
  }

  // --- type 72: the cue, the throw, the fall -------------------------------
  {
    const events = propScene(new Rng(1));
    const rng = new Rng(72);
    G.g_scene_index = 1;
    const p = place(72, rng);
    BreakablePropPoolUpdate(rng, events);
    check("waiting, type 72 is neither drawn nor shootable",
          alive(p) && !p.shotRegistered && p.draws?.length === 0);
    G.g_active_cam_path = TYPE72_CUE_CAM_PATH;
    G.g_cam_path_frame = TYPE72_CUE_CAM_FRAME;
    BreakablePropPoolUpdate(rng, events);
    check("its camera cue without flag 0x12 takes it away", !alive(p));

    const q = place(72, rng);
    G.g_script_flags[TYPE72_SCRIPT_FLAG] = 1;
    BreakablePropPoolUpdate(rng, events);
    check("with the flag it is thrown up at 1.2",
          q.routinePhase === Type72Phase.Fall && q.vy === TYPE72_THROW
          && q.restY === 20);
    check("...and drawn from that frame, the item's model first",
          q.draws?.[0]?.slot === q.slot);
    G.g_cam_path_frame = TYPE72_CUE_CAM_FRAME + 1;
    BreakablePropPoolUpdate(rng, events);
    const v1 = Math.fround(TYPE72_THROW - TYPE72_GRAVITY);
    check("...falls under 0.0381 a frame, and registers 1.5 above itself",
          q.vy === v1 && q.shotRegistered
          && q.shotY === Math.fround(Math.fround(v1 + 20) + 1.5),
          `${q.vy} ${q.shotY}`);
    let n = 1;
    while (alive(q) && n < 200) { BreakablePropPoolUpdate(rng, events); n++; }
    check("...and leaves once it is falling below where it was thrown from",
          !alive(q) && n > 60 && n < 70, String(n));

    const r = place(72, rng);
    G.g_cam_path_frame = TYPE72_CUE_CAM_FRAME;
    BreakablePropPoolUpdate(rng, events);
    G.g_cam_path_frame = 0;
    BreakablePropPoolUpdate(rng, events);
    BreakablePropTakeShot(r, 0);
    BreakablePropPoolUpdate(rng, events);
    const y = r.y;
    check("shot, it is taken", r.routinePhase === Type72Phase.Taken
          && r.storyItem === 1 && r.removeFlag === ORIGINAL_ITEM_PICKUP_SLOT);
    BreakablePropPoolUpdate(rng, events);
    check("...stops falling and leaves the shot test",
          r.y === y && !r.shotRegistered);
    // `CMP word ptr [ESI + 0x28C], -1`: the second block is gated on the
    // first model, so an item with no second model still asks for one.
    W(r).o28e = -1;
    BreakablePropPoolUpdate(rng, events);
    check("...and its second block is gated on the first model, not the second",
          slots(r).join() === [r.slot, -1, 0x116a + r.storyItem - 1].join(),
          slots(r).join());
  }

  // `CMP [EAX*4 + 0x9a6110], 0x276` at `0x0047095A`, `EAX` from `MOV ECX,
  // [0x009c6f00]`: the cue is the frame of the block `g_camera_index` names.
  // Under the checkpoint's (1, 3) that is block 2's, always 0, so block 0's
  // path reaching 0x276 does not throw it -- until a starter hands the index
  // back to block 0.
  {
    const events = propScene(new Rng(1));
    const rng = new Rng(73);
    G.g_scene_index = 1;
    G.g_script_flags[TYPE72_SCRIPT_FLAG] = 1;
    const p = place(72, rng);
    CheckpointResetCamera();
    G.g_active_cam_path = TYPE72_CUE_CAM_PATH;
    G.g_cam_path_frame = TYPE72_CUE_CAM_FRAME;
    BreakablePropPoolUpdate(rng, events);
    check("under (1, 3) type 72 keeps waiting though block 0's path is on its "
          + "cue: the cue reads block 2's frame (`0x0047095A`)",
          G.g_camera_index === 2 && alive(p)
          && p.routinePhase === Type72Phase.Wait,
          `index ${G.g_camera_index} phase ${p.routinePhase}`);
    CameraResetForPathShot();
    BreakablePropPoolUpdate(rng, events);
    check("...and is thrown the frame a starter hands the index back to "
          + "block 0", p.routinePhase === Type72Phase.Fall,
          String(p.routinePhase));
  }

  // --- type 74: three shots, the drop, the fall, flag 0x13 -----------------
  {
    const events = propScene(new Rng(1), GameMode.Arcade);
    const rng = new Rng(74);
    const p = place(74, rng, { lifetime_evt_steps: 3 });
    BreakablePropPoolUpdate(rng, events);
    check("in Arcade type 74 raises g_script_flags[0x13] and leaves",
          !alive(p) && G.g_script_flags[TYPE74_SCRIPT_FLAG] === 1);

    propScene(new Rng(1), GameMode.Arcade);
    G.g_evt_step_index = 1;
    const q = place(74, rng, { lifetime_evt_steps: 0 });
    G.g_evt_step_index = 2;
    BreakablePropPoolUpdate(rng, events);
    check("...but its lifetime is charged first, and expiring raises nothing",
          !alive(q) && (G.g_script_flags[TYPE74_SCRIPT_FLAG] ?? 0) === 0);
  }
  {
    const events = propScene(new Rng(1));
    const sfx = heard(events);
    let drop: number[] = [];
    events.on("item.released", (e) => { drop = [e.x, e.y, e.z]; });
    const rng = new Rng(74);
    const p = place(74, rng, { pitch: 0x10, yaw: 0x20, roll: 0x30 });
    check("type 74 takes three shots",
          p.words.o199 === 3 && p.hitRadius === 9);
    BreakablePropPoolUpdate(rng, events);
    check("...draws 0xA64 under T Rz Ry Rx",
          p.draws?.length === 1 && p.draws[0].slot === TYPE74_SLOT
          && same(p.draws[0].m, world((m) => {
            MatrixTranslate(m, 10, 20, 30); MatrixRotateZ(m, 0x30);
            MatrixRotateY(m, 0x20); MatrixRotateX(m, 0x10);
          })));
    check("...registering half its radius less 2 above itself",
          p.shotY === Math.fround(9 * 0.5 + 20 - 2), String(p.shotY));
    p.hitAim = { x: 1, y: 2 };
    const fx = G.g_sprite_effects.length;
    for (let i = 0; i < 2; i++) {
      BreakablePropTakeShot(p, 0);
      BreakablePropPoolUpdate(rng, events);
    }
    check("two shots spark and knock, and drop nothing",
          p.routinePhase === Type74Phase.Standing && drop.length === 0
          && sfx.filter((s) => s === SFX_TYPE74_HIT).length === 2
          && G.g_sprite_effects.length === fx + 2);
    check("...and the player bits are cleared every frame",
          (p.flags & (BreakableFlag.HitByPlayer0
                      | BreakableFlag.HitByPlayer1)) === 0);
    G.g_original_item_pickup_blocked = 1;
    BreakablePropTakeShot(p, 0);
    BreakablePropPoolUpdate(rng, events);
    check("the third drops its story item at the routine's literal point",
          p.routinePhase === Type74Phase.Dropped && p.storyItem === 2
          && Math.abs(drop[0] - TYPE74_DROP_AT[0]) < 1e-3
          && Math.abs(drop[2] - TYPE74_DROP_AT[2]) < 1e-3,
          drop.join());
    check("...with its own position put back and the blocked byte cleared",
          p.x === 10 && p.z === 30 && G.g_original_item_pickup_blocked === 0);
    // `SpawnStoryModeItem` makes a collectible: row 2, at the drop point, on
    // the dropping prop's own clock and lifetime, running type 70's routine.
    const item = G.g_breakable_props.find(
      (q) => q !== p && q.family === PropFamily.Generic && q.kind === 70
        && !q.dead);
    check("...and the story item is a collectible out of row 2",
          !!item && W(item).o194 === 2 && item.hitRadius === 3
          && [22, 23, 14, 15].includes(W(item).o290)
          && Math.abs(item.x - TYPE74_DROP_AT[0]) < 1e-3
          && Math.abs(item.z - TYPE74_DROP_AT[2]) < 1e-3,
          `${item && W(item).o194} ${item && W(item).o290} ${item?.x}`);
    check("...inheriting the prop's step clock and +0x11C, and running",
          !!item && item.lifetime === p.lifetime
          && item.stepsElapsed === p.stepsElapsed
          && item.lastStepIndex === p.lastStepIndex && item.shotRegistered
          && (item.draws?.length ?? 0) > 0
          && G.g_original_item_banner_count === 0);
    const y0 = p.y;
    for (let i = 0; i < 40; i++) BreakablePropPoolUpdate(rng, events);
    // From its placed 0x10, 0x200 a frame while below 0x4000: 0x4010.
    check("...then it falls and tips forward a quarter turn and no more",
          p.y < y0 - 40 && p.pitch === 0x4010, `${p.y} ${p.pitch}`);
    BreakablePropTakeShot(p, 0);
    const n = sfx.length;
    BreakablePropPoolUpdate(rng, events);
    check("...and a shot then does nothing", sfx.length === n);
  }
  {
    const rng = new Rng(75);
    propScene(rng);
    G.g_evt_block_index = 5;
    G.g_script_flags[TYPE74_GATE_FLAG] = 1;
    const p = place(74, rng);
    BreakablePropPoolUpdate(rng);
    check("standing in block 5 with flag 0x15 up, it raises flag 0x13 at once",
          G.g_script_flags[TYPE74_SCRIPT_FLAG] === 1);
    G.g_script_flags[TYPE74_SCRIPT_FLAG] = 0;
    p.routinePhase = Type74Phase.Dropped;
    for (let i = 0; i < 0x32; i++) BreakablePropPoolUpdate(rng);
    check("...and once it has dropped, only after fifty frames",
          (G.g_script_flags[TYPE74_SCRIPT_FLAG] ?? 0) === 0);
    BreakablePropPoolUpdate(rng);
    check("...on the fifty-first", G.g_script_flags[TYPE74_SCRIPT_FLAG] === 1);
  }

  // --- type 75: what it draws -----------------------------------------------
  {
    const events = propScene(new Rng(1));
    const sfx = heard(events);
    const rng = new Rng(75);
    onPath(PROP75_PATH, {
      pos_x: k(0, 10), pos_y: k(1), pos_z: k(2),
      rot_x: k(0x100 + 0.7), rot_y: k(-0x200 - 0.7), rot_z: k(3),
    });
    const p = place(75, rng, { lifetime_evt_steps: 9 });
    BreakablePropPoolUpdate(rng, events);
    check("type 75 draws 0xA6B at op_ path 0x178's pose alone, frame 0 until "
          + "shot, the angles __ftol'ed",
          p.draws?.length === 1 && p.draws[0].slot === PROP75_SLOT
          && same(p.draws[0].m, world((m) => {
            MatrixTranslate(m, 0, 1, 2); MatrixRotateZ(m, 3);
            MatrixRotateY(m, -0x200); MatrixRotateX(m, 0x100);
          })));
    check("...and its shot sphere at its own placement",
          p.shotX === 10 && p.shotY === 20 && p.shotZ === 30);
    G.g_original_item_pickup_blocked = 1;
    BreakablePropTakeShot(p, 0);
    BreakablePropPoolUpdate(rng, events);
    check("shot, it plays both its sounds and clears the blocked byte",
          sfx.includes(SFX_PROP75_HIT) && sfx.includes(SFX_PROP75_RIDE)
          && G.g_original_item_pickup_blocked === 0);
    check("...and rides the path on its own cursor",
          p.shake === 1 && p.draws?.[0]?.m[12] === 10, String(p.shake));
    for (let i = 0; i < PROP75_RIDE_LENGTH; i++) {
      BreakablePropPoolUpdate(rng, events);
    }
    check("at the ride's end it sets the blocked byte and plays 0x3A1BA9",
          G.g_original_item_pickup_blocked === 1
          && sfx.includes(SFX_PROP75_RIDE_END));
    SetCameraPaths(null);
  }

  // --- type 76: the door, its route and its swing --------------------------
  {
    const rng = new Rng(76);
    propScene(rng, GameMode.Arcade);
    const p = place(76, rng, { field_1f4: 1 });
    BreakablePropPoolUpdate(rng);
    check("in Arcade type 76 leaves", !alive(p));
  }
  {
    const events = propScene(new Rng(1));
    SetGameTables(CHARS, { ...BREAKABLES,
                           hinge_curves_xyz: { "0": HINGE_CURVE_0_HEAD } });
    const sfx = heard(events);
    const rng = new Rng(76);
    G.g_evt_block_index = 5;
    const pair = place(76, rng, { field_1f4: 1, pos: [0, 0, 0] });
    const one = place(76, rng, { field_1f4: 0, yaw: 0x1000 });
    BreakablePropPoolUpdate(rng, events);
    const d = Math.hypot(pair.shotX - TYPE76_PAIR_A_AT[0],
                         pair.shotZ - TYPE76_PAIR_A_AT[2]);
    check("the pair's sphere is the plate on its first leaf",
          Math.abs(pair.shotY - (TYPE76_PAIR_A_AT[1]
                                 + TYPE76_PAIR_PLATE_AT[1])) < 1e-3
          && Math.abs(d - Math.hypot(12.5, 0.5)) < 1e-3,
          `${pair.shotX} ${pair.shotY} ${pair.shotZ}`);
    check("...and the single door's is its position less (2.5, 30, 17.5), "
          + "on world axes",
          one.shotX === 7.5 && one.shotY === -10 && one.shotZ === 12.5);
    const leafA = world((m) => {
      MatrixTranslate(m, ...TYPE76_PAIR_A_AT);
      MatrixRotateY(m, TYPE76_PAIR_YAW);
    });
    check("shut, the pair draws both leaves and the plate on the first",
          slots(pair).join() === [0xa67, 0x10d3, 0xa68].join()
          && same(pair.draws![0].m, leafA)
          && same(pair.draws![1].m, world((m) => {
            MatrixTranslate(m, ...TYPE76_PAIR_A_AT);
            MatrixRotateY(m, TYPE76_PAIR_YAW);
            MatrixTranslate(m, ...TYPE76_PAIR_PLATE_AT);
          })), slots(pair).join());
    check("...and the single door, and its plate turned and scaled 1.2 in its "
          + "frame",
          slots(one).join() === [0xa6d, 0x10d3].join()
          && same(one.draws![1].m, world((m) => {
            MatrixTranslate(m, 10, 20, 30); MatrixRotateY(m, 0x1000);
            MatrixTranslate(m, -2.5, -30, -17.5); MatrixRotateY(m, 0x4000);
            MatrixScale(m, 1.2000000476837158, 1.2000000476837158,
                        1.2000000476837158);
          })));
    BreakablePropTakeShot(one, 0);
    BreakablePropPoolUpdate(rng, events);
    check("in block 5 the single door pays and knocks and does not open",
          one.routinePhase === Type76Phase.Shut && sfx.includes(SFX_TYPE76_HIT)
          && !sfx.includes(SFX_TYPE76_OPEN));
    G.g_script_branch_var = 0;
    BreakablePropTakeShot(pair, 0);
    BreakablePropPoolUpdate(rng, events);
    check("...and the pair opens: route 2, the open sound, the answered bit",
          pair.routinePhase === Type76Phase.Open
          && G.g_script_branch_var === 2 && sfx.includes(SFX_TYPE76_OPEN)
          && (pair.flags & 0x40000000) !== 0);
    check("...and swings on hinge curve 0",
          pair.cueCursorB === 1 && pair.yaw === 0 && pair.hingeB === 0);
    BreakablePropPoolUpdate(rng, events);
    check("...frame by frame: yaw is -ry, the far leaf's yaw ry, roll sums rz",
          pair.yaw === -2989 && pair.hingeB === 2989 && pair.roll === 55
          && pair.pitch === -55 && pair.restPitch === 55,
          `${pair.yaw} ${pair.hingeB} ${pair.roll}`);
    check("...each leaf turned on its own three angles",
          same(pair.draws![0].m, world((m) => {
            MatrixTranslate(m, ...TYPE76_PAIR_A_AT);
            MatrixRotateY(m, TYPE76_PAIR_YAW); MatrixRotateZ(m, 55);
            MatrixRotateY(m, 2989); MatrixRotateX(m, 55);
          }))
          && same(pair.draws![1].m, world((m) => {
            MatrixTranslate(m, ...TYPE76_PAIR_B_AT);
            MatrixRotateY(m, TYPE76_PAIR_YAW); MatrixRotateZ(m, 55);
            MatrixRotateY(m, -2989); MatrixRotateX(m, -55);
          })));
    for (let i = 0; i < 70; i++) BreakablePropPoolUpdate(rng, events);
    check("...for sixty frames, and the plate is gone",
          pair.cueCursorB === 60
          && slots(pair).join() === [0xa67, 0xa68].join());
  }
  {
    const rng = new Rng(77);
    propScene(rng);
    G.g_evt_block_index = 0x0e;
    const one = place(76, rng, { field_1f4: 0 });
    BreakablePropTakeShot(one, 0);
    BreakablePropPoolUpdate(rng);
    check("in block 0x0E the door wants a key", one.routinePhase === 0);
    holdItem(2);
    BreakablePropTakeShot(one, 0);
    BreakablePropPoolUpdate(rng);
    check("...and opens for a player holding item 2",
          one.routinePhase === Type76Phase.Open
          && G.g_script_branch_var === 2);
    const third = place(76, rng, { field_1f4: 2 });
    G.g_camera_view_to_world[12] = 5;
    G.g_camera_view_to_world[13] = 6;
    G.g_camera_view_to_world[14] = 7;
    BreakablePropPoolUpdate(rng);
    check("a third kind of door draws nothing and registers the view origin",
          third.draws?.length === 0 && third.shotX === 5
          && third.shotY === 6 && third.shotZ === 7);
    G.g_camera_view_to_world = MatIdentity();
  }

  // --- type 77: item 0x1F, the ride, the payout ---------------------------
  {
    const events = propScene(new Rng(1));
    const sfx = heard(events);
    const rng = new Rng(77);
    const p = place(77, rng);
    BreakablePropPoolUpdate(rng, events);
    check("type 77 leaves with 0x800A9 unless item 0x1F is held",
          !alive(p) && sfx.includes(SFX_TYPE77_LEAVE));
  }
  {
    let leave = 1, stay = 1;
    while (new Rng(leave).int(3) !== 0) leave++;
    while (new Rng(stay).int(3) === 0) stay++;
    const events = propScene(new Rng(1));
    const sfx = heard(events);
    holdItem(0x1f);
    const gone = place(77, new Rng(1));
    BreakablePropPoolUpdate(new Rng(leave), events);
    check("held, a first-frame rand() % 3 of 0 takes it away in silence",
          !alive(gone) && sfx.length === 0);
    onPath(TYPE77_PATH, { pos_x: k(5), pos_y: k(1), pos_z: k(0) });
    const rng = new Rng(stay);
    const p = place(77, rng, { yaw: 0x4000 });
    const score = G.g_player_score[0];
    BreakablePropPoolUpdate(rng, events);
    check("...anything else plays 0x700A9 and it flies",
          alive(p) && sfx.includes(SFX_TYPE77_APPEAR)
          && p.shake === 1 && p.yawSpin === 0x400);
    check("...at pos + RotY(yaw) * the path's point",
          Math.abs(Math.hypot(p.shotX - 10, p.shotZ - 30) - 5) < 1e-3
          && p.shotY === 21 && Math.abs(p.shotX - 10) < 1e-3,
          `${p.shotX} ${p.shotY} ${p.shotZ}`);
    check("...drawn twice size, 0x10AB, spinning on +0x1DC",
          p.draws?.length === 1 && p.draws[0].slot === TYPE77_SLOT
          && same(p.draws[0].m, world((m) => {
            MatrixTranslate(m, 10, 20, 30); MatrixRotateY(m, 0x4000);
            MatrixTranslate(m, 5, 1, 0); MatrixRotateY(m, 0x400);
            MatrixScale(m, 2, 2, 2);
          })));
    p.hitAim = { x: 1, y: 2 };
    const fx = G.g_sprite_effects.length;
    BreakablePropTakeShot(p, 0);
    BreakablePropPoolUpdate(rng, events);
    check("shot, it pays 2000 and a spark four times the size",
          G.g_player_score[0] === score + TYPE77_SCORE
          && G.g_sprite_effects.length === fx + 1
          && G.g_sprite_effects[fx].scale.x === 4
          && sfx.includes(SFX_TYPE77_SHOT)
          && p.routinePhase === Type77Phase.Shot);
    const cursor = p.shake;
    const last = [p.shotX, p.shotY, p.shotZ].join();
    BreakablePropPoolUpdate(rng, events);
    check("...stops on its path and blinks: nothing drawn on an odd frame",
          p.shake === cursor && p.storyItem === 1 && p.draws?.length === 0);
    // The declared divergence, pinned: the engine registers stack garbage on
    // an odd frame, and the port the point its last draw computed.
    check("...still registered there, at the point the last draw computed",
          p.shotRegistered && [p.shotX, p.shotY, p.shotZ].join() === last);
    BreakablePropPoolUpdate(rng, events);
    check("...and drawn on an even one", p.draws?.length === 1);
    let n = 2;
    while (alive(p) && n < 100) {
      BreakablePropPoolUpdate(rng, events); n++;
    }
    check("...for 0x3D frames and then gone", !alive(p) && n === 0x3e,
          String(n));
    SetCameraPaths(null);
  }
  {
    let stay = 1;
    while (new Rng(stay).int(3) === 0) stay++;
    const events = propScene(new Rng(1));
    const sfx = heard(events);
    holdItem(0x1f);
    const rng = new Rng(stay);
    const p = place(77, rng);
    for (let i = 0; i < 400; i++) BreakablePropPoolUpdate(rng, events);
    check("unshot, it rides 400 frames", alive(p) && p.shake === 400);
    BreakablePropPoolUpdate(rng, events);
    check("...and leaves with 0x800A9 on the next",
          !alive(p) && sfx.filter((s) => s === SFX_TYPE77_LEAVE).length === 1);
  }

  // --- the other writers of the blocked byte, and type 43's tally --------
  {
    const rng = new Rng(58);
    propScene(rng);
    G.g_original_item_pickup_blocked = 1;
    const p = place(58, rng);
    BreakablePropTakeShot(p, 0);
    BreakablePropPoolUpdate(rng);
    check("type 58's Original Mode hit clears g_original_item_pickup_blocked",
          G.g_original_item_pickup_blocked === 0 && p.routinePhase === 1);
  }
  {
    const rng = new Rng(43);
    const events = propScene(rng);
    SetGameTables(CHARS, { ...BREAKABLES, original_items: ORIGINAL_ITEMS_SCENE2 });
    G.g_scene_index = 2;
    const p = PlaceGenericProp({
      at: 0xc780, container: "generic", type: 43, slot: 9,
      lifetime_evt_steps: 9, field_1f4: 2, pos: [0, 0, 0], roll: 2,
    }, rng);
    G.g_breakable_props.push(p);
    BreakablePropPoolUpdate(rng, events);
    BreakablePropTakeShot(p, 0);
    BreakablePropPoolUpdate(rng, events);
    // Whatever the break picked, the wreck's pickup is this item's.
    p.words.o290 = 20;
    const before = G.g_original_items_taken[20] ?? 0;
    BreakablePropTakeShot(p, 0);
    BreakablePropPoolUpdate(rng, events);
    check("type 43's Original item counts into g_original_items_taken and "
          + "raises its banner",
          G.g_original_items_taken[20] === before + 1
          && G.g_original_item_banners.length === 1
          && G.g_original_item_banners[0].sprite === 0x5d1,
          `${G.g_original_items_taken[20]} ${G.g_original_item_banners.length}`);
  }
}

console.log("\nclass 0x41, the three story arms of the item release:");
{
  // `BreakablePropUpdate`, `KindedPropUpdate` and `FallingContainerUpdate`
  // each spell the release out, and their story arms differ in the blocked
  // byte, the height and the falling container's `+0x11C`.
  const release = (copy: HiddenItemCopy, over: Partial<BreakableProp>,
                   storyRise = 0) => {
    const events = propScene(new Rng(1));
    G.g_scene_index = 1;
    const p = makeBreakableProp(900, 0, 0);
    Object.assign(p, { itemSet: 2, storyItem: 0, x: 1, y: 10, z: 3 }, over);
    G.g_item_set_countdown[2] = 1;
    G.g_original_item_pickup_blocked = 1;
    const y0 = p.y;
    ReleaseHiddenItem(p, new Rng(3), events, copy, 0.25, storyRise);
    const item = G.g_breakable_props.find((q) => q.kind === 70);
    return { p, y0, item };
  };
  {
    const { p, y0, item } = release(HiddenItemCopy.Group, {});
    check("a group member's story item clears the blocked byte after it",
          !!item && item.y === y0 && p.y === y0
          && G.g_original_item_pickup_blocked === 0);
  }
  {
    const { p, y0, item } = release(HiddenItemCopy.Kinded, { kind: 2 }, 1.0);
    check("a kind-2 kinded prop's story item comes out 1.0 up, the prop put "
          + "back, the byte cleared",
          !!item && item.y === Math.fround(y0 + 1) && p.y === y0
          && G.g_original_item_pickup_blocked === 0,
          `${item?.y} ${p.y}`);
  }
  {
    const events = propScene(new Rng(1));
    G.g_scene_index = 2;
    G.g_evt_block_index = 4;
    const p = makeBreakableProp(901, 0, 0);
    Object.assign(p, { itemSet: 2, storyItem: 0, kind: 3, y: 10 });
    G.g_item_set_countdown[2] = 1;
    ReleaseHiddenItem(p, new Rng(3), events, HiddenItemCopy.Kinded);
    check("...and in scene 2 block 4 the kinded copy blocks the pickup instead",
          G.g_original_item_pickup_blocked === 1);
  }
  {
    // Through `KindedPropUpdate`: the kind-2 lift is the routine's, whatever
    // the set.
    const rng = new Rng(4);
    const events = propScene(rng);
    G.g_scene_index = 1;
    const k = PlaceKindedProp(0xd900, 2, ItemSet.Score2, 1, 5, 0, 10, 0, 0,
                              rng);
    k.storyItem = 0;
    G.g_item_set_countdown[ItemSet.Score2] = 1;
    G.g_breakable_props.push(k);
    BreakablePropTakeShot(k, 0);
    BreakablePropPoolUpdate(rng, events);
    const item = G.g_breakable_props.find((q) => q.kind === 70);
    check("a kind-2 prop broken in Original Mode lifts its story item 1.0",
          !!item && item.y === 11 && k.y === 10, `${item?.y} ${k.y}`);
  }
  {
    const { item } = release(HiddenItemCopy.Falling,
                             { family: PropFamily.Falling, hp: 1, lifetime: 5,
                               floorY: 4, y: 4 }, 0.5);
    check("a falling container's story item inherits its +0x199 lifetime, "
          + "0.5 over the floor, and clears the byte",
          !!item && item.lifetime === 5 && item.y === 4.5
          && G.g_original_item_pickup_blocked === 0,
          `${item?.lifetime} ${item?.y}`);
  }
}

console.log("\nclass 0x41 type 4, seven of the eleven kinds are effects:");
{
  // `PlaceKindedProp` (`FUN_00462E10`) writes `obj+0x28C = 0xFFFF` and then
  // overrides it for exactly four kinds. The other seven draw
  // `FUN_0040DD90(obj+0x324)` instead — an animated effect, not a model —
  // which is why their spawn markers have nothing under them and why that is
  // the engine's behaviour rather than a missing export.
  check("only kinds 2, 3, 8 and 9 name an asset slot",
        Object.keys(KIND_SLOT).map(Number).sort((a, b) => a - b)
          .join(",") === "2,3,8,9");
  check("and every other kind is left at the engine's 0xFFFF",
        [0, 1, 4, 5, 6, 7, 10].every((k) => (KIND_SLOT[k] ?? SLOT_NONE)
                                            === SLOT_NONE));
}

console.log("\nclass 0x41, Training's one-shot targets:");
{
  const rng = new Rng(53);
  // `g_GameMode == 2`, and 2 is Training. This block is the reason the enum
  // had to be corrected everywhere at once: with `ARCADE = 0` and this case
  // still asking for Arcade, `PlaceBreakableGroup` would take the ordinary
  // path and every assertion below would fail.
  const events = propScene(rng, GameMode.Training);
  G.g_training_lesson = 0;      // members 2, 3, 4 and 6
  const props = PlaceBreakableGroup(1, 4, rng);
  const target = props.find((p) => p.member === 2);
  const plain = props.find((p) => p.member === 0);
  check("the member the target set names takes one shot, not two",
        !!target && target.hp === 1, `hp ${target?.hp}`);
  check("and wears the one-shot model",
        target?.slot === BreakableSlot.OneShotTarget,
        `0x${target?.slot.toString(16)}`);
  check("the members it does not name are ordinary",
        !!plain && plain.hp === 2 && plain.slot === BreakableSlot.Default);

  const before = G.g_player_score[0];
  shoot(target!, 1, rng, events);
  // Note what it does *not* do: decrement `hp`. A one-shot target is removed
  // outright rather than damaged -- and the destroy arm then hands `+0x11C`
  // the lifetime byte (`MOVSX DX, byte [ESI+0x199]` at `0x004648A3`, stored
  // at `0x004648C3`), which is 4 here.
  check("one shot removes it; +0x11C takes the lifetime byte, not a decrement",
        target!.state === BreakableState.Removed
        && target!.hp === target!.lifetime && target!.lifetime === 4,
        `hp ${target!.hp} state ${target!.state}`);
  check("and it pays no score", G.g_player_score[0] === before,
        `${G.g_player_score[0]} vs ${before}`);
  // The mode survives the reset, as the title's choice does; put Arcade back so
  // the next game started here has Arcade's credits and not Training's one.
  G.g_GameMode = GameMode.Arcade;
}
