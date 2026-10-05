import type { CharactersJson, CharacterType } from "../../src/bundle";
import { Rng } from "../../src/core/rng";
import { Events } from "../../src/core/events";
import { ActorSpawn, GameUpdate } from "../../src/game/director";
import { ActorAdvanceMotion } from "../../src/game/motion";
import { MOTION_FLAGS_INIT, MotionFlag } from "../../src/game/actor";
import { G, HIT_SLOT_NONE, ResetGameGlobals } from "../../src/game/globals";
import { NULL_HOST, type GameHost } from "../../src/game/host";
import { MarkActorShot } from "../../src/game/combat/shot";
import { SetGameTables, T } from "../../src/game/tables";
import { ActorFlag, type Actor } from "../../src/game/actor";
import { ENEMY_CLASSES, g_class_handlers } from "../../src/game/registry";
import { SpawnClass } from "../../src/game/spawn_class";
import { GameMode } from "../../src/game/game_mode";
import { vec3 } from "../../src/game/vec";
import type { ScriptJson } from "../../src/bundle";
import { Walker } from "../../src/script/walker";
import { ZombieAux } from "../../src/game/actor";
import { seekTo } from "../../src/script/seek";
import { ScriptFlagsThisBundleCanRaise }
  from "../../src/script/waits/flag";
import {
  BreakablePropTakeShot, PropFamily, PlaceGenericProp, PropCuePhase,
  PropContainerRaisesScriptFlag, PROP75_DROP_AT, PROP75_RIDE_LENGTH,
  PROP75_SCRIPT_FLAG, PROP75_TYPE, PROP75_SLOT,
} from "../../src/game/class41";
import { BreakablePropPoolUpdate } from "../../src/game/class41/pool";
import { GENERIC_ROUTINES } from "../../src/game/class41/generic_routines";
import { PropUpdateType75 } from "../../src/game/class41/flag_prop";
import {
  CLASS21_HP_BY_RANK, CLASS21_MOTION_FREED, g_st2car_path_table,
  RescueTargetState, RescueTargetUpdate,
} from "../../src/game/class21";
import {
  ST2CAR_ASSET_VARIANTS, ST2CAR_PART_YAW_BASE, ST2CAR_PART_YAW_FRAMES,
  ST2CAR_SPIN_STEP, St2CarAssetRow, St2CarDraw, St2CarRoutine, St2CarSpawn,
  St2CarsTick,
} from "../../src/game/class21/car";
import {
  MOUSE_FIRST_SLOT, MOUSE_HIT_RADIUS, MOUSE_LAST_SLOT, MOUSE_PAUSE_FRAMES,
  MOUSE_SPEED, MOUSE_TURN_SPREAD,
  MouseBranchTriggerUpdate, MouseState, MouseWanderUpdate,
} from "../../src/game/class52";
import {
  CAT_BRANCH_BLOCK, CAT_LIFE_FRAMES, CAT_TRIGGER_CUE_MOTION,
  CAT_TRIGGER_FLEE_MOTION,
  CAT_TRIGGER_HIT_RADIUS, CAT_TRIGGER_IDLE_MOTION, CAT_TRIGGER_REMOVE_FLAG,
  CAT_TRIGGER_STOP_X, CatTriggerState, type CatTail,
} from "../../src/game/class53";
import { CAT_CLIPS, CAT_MOTIONS } from "../../src/game/class53/records";
import { PlaceStoryModeSwitch } from "../../src/game/class41/triggers";
import { PlaceChainSegments } from "../../src/game/class41/chain";
import { PlaceFragmentProps } from "../../src/game/class41/type40";
import {
  STORY_SWITCH_FLAG_AT, STORY_SWITCH_SCRIPT_FLAG,
} from "../../src/game/class41/branch";
import { SetCameraPaths } from "../../src/game/tables";
import { Class22SubActorAt } from "../../src/game/class22/records";
import {
  check, motion, TYPE, CHARS, WalkerCameraFrame, StillPath, EnterPlay,
  propScene,
} from "./harness";

console.log("\nclass 0x21, the rescue target and stage 2's first fork:");
{
  /**
   * A host that answers `CamEvalObjectPath6` for the two rows of
   * `g_st2car_path_table` class 0x21 reaches, and for nothing else. The pose
   * is a made-up point per slot, which is all the assertions need: what is
   * being checked is *which* curve the actor is on, not the curve.
   */
  const CAR_PATH_POSE: Record<number, { x: number; y: number; z: number;
                                        yaw: number }> = {
    0x148: { x: -100, y: -8, z: -200, yaw: 0x4000 },
    0x14e: { x: -300, y: -8, z: -400, yaw: 0x4000 },
  };
  const carHost: GameHost = {
    ...NULL_HOST,
    objectPath: (slot, _frame) => CAR_PATH_POSE[slot] ?? null,
  };

  // Character type 7 with the class's two clips baked: 0x3E6 (998) the ride,
  // 0x3CC (972) the freed clip, with a play length of 57. `ActorSetMotion
  // Blended` declines a clip the bundle does not carry, as the port's every
  // setter does, so a type with no clips could not be freed at all.
  const RESCUE_CHARS = {
    ...CHARS,
    types: { ...CHARS.types,
             "7": { ...TYPE, type: 7,
                    motions: { "998": motion(16), "972": motion(30, 0, 57) } } },
  } as unknown as CharactersJson;
  const rescueScene = (rng = new Rng(21)) => {
    ResetGameGlobals();
    EnterPlay();
    SetGameTables(RESCUE_CHARS, undefined, undefined, undefined);
    G.g_active_cam_path = 0x39;
    G.g_cam_path_frame = 0;
    // Rank 4 is the first row of `g_class21_hp_by_rank` that gives two, and
    // two is what the "one shot is not a rescue" pair below needs. The table
    // is sixteen rows indexed by `g_damage_rank`; rank 2 gives **one**, which
    // is what this used to assert as two.
    G.g_damage_rank = 4;
    // `ActorSpawn` runs the class's own Init, exactly as
    // `SpawnFromDescriptor` does; calling it again here would count the actor
    // in twice.
    const a = ActorSpawn(0x7d0, SpawnClass.RankScaledEnemy, 7, "rescue",
                         undefined, rng);
    if (a.cls !== SpawnClass.RankScaledEnemy) throw new Error("not class 0x21");
    a.visible = true;
    a.pos = vec3(0, 0, 0);
    return { a, events: new Events(), rng };
  };
  const rFrame = (a: Actor, events: Events, rng: Rng,
                  host: GameHost = carHost) =>
    RescueTargetUpdate(a, { dt: 1 / 60, rng, host, events });

  {
    // `if (g_cutscene_skipping) { obj+0x1350 = 1; *obj = Held; }` at the
    // ride's tail: a skip hands over wherever the ride has got to, here on
    // frame 0x20, long before 0xBD.
    const { a, events, rng } = rescueScene();
    G.g_cam_path_frame = 0x20;
    G.g_cutscene_skipping = 1;
    rFrame(a, events, rng);
    G.g_cutscene_skipping = 0;
    check("a skipped cut scene hands the ride over at once, onto row 1",
          a.rescue.state === RescueTargetState.Held && a.rescue.route === 1,
          `state ${a.rescue.state} route ${a.rescue.route}`);
  }

  {
    const { a, events, rng } = rescueScene();
    check("the Init counts it as an enemy, twice over",
          G.g_enemies_alive === 1 && G.g_enemies_present === 1,
          `${G.g_enemies_alive}/${G.g_enemies_present}`);
    check("...with hit points from g_class21_hp_by_rank", a.hp === 2,
          String(a.hp));
    check("...and the table is sixteen rows, not five",
          CLASS21_HP_BY_RANK.length === 16
          && CLASS21_HP_BY_RANK[2] === 1 && CLASS21_HP_BY_RANK[15] === 4,
          `${CLASS21_HP_BY_RANK.length} rows, [2]=${CLASS21_HP_BY_RANK[2]}`);
    check("...and it starts on row 0 of g_st2car_path_table",
          a.rescue.route === 0 && g_st2car_path_table[0] === 0x148,
          `route ${a.rescue.route}`);

    // **And it turns root motion off**, one instruction after
    // `ActorBuildSkinnedModel` turned it on: `MOV EDX,[EDI+0x64];
    // AND EDX,0xFFFFFFFD; MOV [EDI+0x64],EDX` at `0x00451753`-`0x00451760`.
    // Class 0x21 is one of exactly two things in the game that clear the bit.
    //
    // It is not bookkeeping. With the bit clear `SkeletonApplyRootMotion`
    // (`FUN_00410C50`) poses the clip root's **whole** translation instead of
    // only its y, and motion 0x3E6's root is the constant
    // `(0, 15.692, 11.943)` on all sixteen frames -- so the missing line put
    // the rider 11.943 units along its own +Z, out over the car's bonnet.
    // `render/characters/pose.ts` reads this bit and `test/pose.test.ts`
    // asserts the two arms; this is the half that says the bit is right.
    check("...and it clears model+0x64 bit 1 -- root motion OFF",
          (a.motionFlags & MotionFlag.RootMotion) === 0,
          `motionFlags ${a.motionFlags}`);
    check("...which is a departure from what the build leaves",
          (MOTION_FLAGS_INIT & MotionFlag.RootMotion) !== 0
          && a.motionFlags === (MOTION_FLAGS_INIT & ~MotionFlag.RootMotion),
          `${MOTION_FLAGS_INIT} -> ${a.motionFlags}`);

    // **It is on the car.** `RescueTargetPoseFromRoute` (`FUN_00451E50`) puts
    // it at `g_st2car_path_table[obj+0x1350]`'s pose, and sub 0 then adds a
    // drop-in of `(0, 50 - frame, 50 - frame)` rotated by that pose's own yaw.
    // At yaw 0x4000 -- a quarter turn -- the engine's Ry sends the point's z
    // into x, so the whole offset is in x and y and none of it in z.
    G.g_cam_path_frame = 0x20;
    rFrame(a, events, rng);
    const d = 50 - 0x20;
    check("it rides the car's own object path, not a place of its own",
          Math.abs(a.pos.x - (-100 + d)) < 1e-3
          && Math.abs(a.pos.y - (-8 + d)) < 1e-3
          && Math.abs(a.pos.z - -200) < 1e-3,
          `${a.pos.x.toFixed(2)},${a.pos.y.toFixed(2)},${a.pos.z.toFixed(2)}`);
    check("...taking the path's yaw with it", a.yaw === 0x4000,
          String(a.yaw));

    // The `INC word ptr [ESI + 0x1312]` is at `0x00451943`, **after** the
    // transform — so the frame that steps the sub-state still applies the
    // offset, and by then `50 - frame` has gone negative. Transcribed in that
    // order, and this is the assertion that holds it there.
    G.g_cam_path_frame = 0x40;
    rFrame(a, events, rng);
    check("...the frame that steps sub 0 -> 1 still applies the offset",
          a.rescue.sub === 1 && Math.abs(a.pos.x - (-100 + (50 - 0x40))) < 1e-3,
          `sub ${a.rescue.sub} x ${a.pos.x.toFixed(2)}`);
    rFrame(a, events, rng);
    check("...and from then on it is on the pose, with no offset at all",
          Math.abs(a.pos.x - -100) < 1e-3
          && Math.abs(a.pos.y - -8) < 1e-3
          && Math.abs(a.pos.z - -200) < 1e-3,
          `${a.pos.x.toFixed(2)},${a.pos.y.toFixed(2)},${a.pos.z.toFixed(2)}`);

    G.g_cam_path_frame = 0xc0;
    rFrame(a, events, rng);
    check("...and hands over to the held state past frame 0xBD",
          a.rescue.state === RescueTargetState.Held,
          String(a.rescue.state));
    check("...stepping to row 1, the car's route for camera path 0x39",
          a.rescue.route === 1 && g_st2car_path_table[1] === 0x14e,
          `route ${a.rescue.route}`);

    // The held state poses through `RescueTargetPoseFromRouteWithVelocity`,
    // so the actor moves onto the second route and records the jump.
    rFrame(a, events, rng);
    check("...and the held state rides that second route",
          Math.abs(a.pos.x - -300) < 1e-3 && Math.abs(a.pos.z - -400) < 1e-3,
          `${a.pos.x.toFixed(2)},${a.pos.z.toFixed(2)}`);
    check("...writing the frame's pose delta at obj+0x13CC",
          Math.abs(a.rescue.delta.x - -200) < 1e-3
          && Math.abs(a.rescue.delta.z - -200) < 1e-3,
          `${a.rescue.delta.x.toFixed(2)},${a.rescue.delta.z.toFixed(2)}`);

    // A host with no object paths is a valid host, and the actor then stays
    // where it was rather than being flung to the origin.
    const before = { ...a.pos };
    rFrame(a, events, rng, NULL_HOST);
    check("...and a host with no paths leaves it where it stands",
          a.pos.x === before.x && a.pos.z === before.z,
          `${a.pos.x.toFixed(2)},${a.pos.z.toFixed(2)}`);

    // Two hit points, so the first shot does not free it. Scene 1 -- stage
    // 2, where the car is -- with two rescues already in it.
    G.g_player_score = [0, 0];
    G.g_scene_index = 1;
    G.g_civilians_rescued_by_scene = [0, 2, 0, 0, 0, 0];
    G.g_rescued_char_types = new Array<number>(60).fill(0);
    MarkActorShot(a, 0, 4);
    rFrame(a, events, rng);
    check("one shot is not a rescue",
          G.g_script_branch_var === 0 && a.hp === 1,
          `var ${G.g_script_branch_var} hp ${a.hp}`);
    MarkActorShot(a, 0, 4);
    rFrame(a, events, rng);
    check("**the last shot writes the route**", G.g_script_branch_var === 1,
          String(G.g_script_branch_var));
    check("...and pays 10 + 10 + 80 + 400", G.g_player_score[0] === 500,
          String(G.g_player_score[0]));
    check("...and gives both enemy counters back, once",
          G.g_enemies_alive === 0 && G.g_enemies_present === 0,
          `${G.g_enemies_alive}/${G.g_enemies_present}`);
    check("...and plays the freed clip",
          a.motion === CLASS21_MOTION_FREED
          && a.rescue.state === RescueTargetState.Freed,
          `${a.motion} state ${a.rescue.state}`);
    // `0x00451AFF`..`0x00451B21`: the same three stores as a civilian's
    // rescue, with the literal type 0x36 -- not the actor's own, which is 7.
    check("...and records the rescue as type 0x36, the third in scene 1",
          G.g_civilians_rescued_by_scene[1] === 3
          && G.g_rescued_char_types[12] === 0x36 && a.charType !== 0x36,
          `count ${G.g_civilians_rescued_by_scene[1]} type `
          + `0x${(G.g_rescued_char_types[12] ?? 0).toString(16)}`);
    G.g_scene_index = 0;
  }

  // Left alone, the camera abandons it -- and that path gives the counters
  // back too, which is what stops a `wait_enemies_alive` holding on an actor
  // that has left the shot.
  {
    const { a, events, rng } = rescueScene();
    a.rescue.state = RescueTargetState.Held;
    G.g_cam_path_frame = 0x200;
    rFrame(a, events, rng);
    check("an abandoned target writes no route",
          G.g_script_branch_var === 0, String(G.g_script_branch_var));
    check("...and still gives its counters back",
          G.g_enemies_alive === 0 && G.g_enemies_present === 0,
          `${G.g_enemies_alive}/${G.g_enemies_present}`);
  }

  // ...and **both slots**, which the port's arm left held. `0x00451C5B`..
  // `0x00451C7F`: `if ((s8)obj+0x120 != -1) ReleaseCameraEnemySlot(obj)` and
  // `if (obj+0x3C != -1) ActorFreeHitSlot(obj)` (`FUN_004092D0`), before the
  // state is set to `RescueTargetAbandonedState`. The hit slot is the one the
  // build claimed; the camera slot is written here by hand, because nothing
  // this fixture runs deals one -- what is asserted is the release.
  {
    const { a, events, rng } = rescueScene();
    a.rescue.state = RescueTargetState.Held;
    const hit = a.hitSlot;
    a.cameraSlot = 2;
    G.g_enemy_slots[2].occupied = 1;
    G.g_enemy_slots[2].at = a.at;
    G.g_cam_path_frame = 0x122;
    rFrame(a, events, rng);
    check("abandoned at 0x122, it frees the hit slot the build claimed",
          hit !== HIT_SLOT_NONE && a.hitSlot === HIT_SLOT_NONE
          && G.g_hit_slots[hit] === HIT_SLOT_NONE,
          `slot ${hit} -> ${a.hitSlot}, table ${G.g_hit_slots[hit]}`);
    check("...and the camera slot it held",
          a.cameraSlot === -1 && G.g_enemy_slots[2].occupied === 0,
          `slot ${a.cameraSlot}, occupied ${G.g_enemy_slots[2].occupied}`);
    check("...and is abandoned, not freed",
          (a.rescue.state as RescueTargetState) === RescueTargetState.Abandoned,
          String(a.rescue.state));
  }
}

/**
 * A replay does not rebuild a rescue target it has played past.
 *
 * The user's report: stage 2's first civilian after the burnt-out car,
 * `0x6830` at block 11 step 2, "sits there sobbing still even after both
 * enemies are killed". Played from the stage's entry she does not; from the
 * address the page writes into its URL -- which is where every reload lands
 * -- she does, every time. The seek replayed block 0, where class 0x21's
 * rescue target `0x7D0` is spawned, and left its marker listed, so the
 * landing **rebuilt** it: `RescueTargetInit` counted it into both enemy
 * counters, and it sat in `RescueTargetRideInState` for good, because that
 * state hands over only at camera frame `>= 0xBE` and block 11 step 2's shot
 * never gets past 30 until the room is clear. Her rescue block waits on
 * camera cue `(70, 100)`, which the script plays only after
 * `wait_enemies_alive 0` -- so she sobbed in front of two dead captors with
 * `g_enemies_alive` at 1 and no enemy on screen.
 *
 * The engine is never in that state: by block 11 step 2 the target has been
 * abandoned at path `0x39` frame `0x122` and despawned at `0x181`, or
 * rescued, or despawned on `g_script_flags[0]`. Each of those is a way out a
 * replay can see, and `RescueTargetOutlivedByReplay` names them.
 */
console.log("\na replay does not rebuild a rescue target it has played past:");
{
  const RESCUE_AT = 0x7d0;
  const rescueSpawn = (i: number) => ({
    i, at: 0x100 + i * 8, op: 0x09, name: "spawn_placed", cat: "spawn",
    spawns: [{ at: RESCUE_AT, class: SpawnClass.RankScaledEnemy, flags: 0,
               pos: [0, 0, 0], yaw_deg: 0, orient: [0, 0, 0], hp: 0,
               desc_flags: 0 }],
  });
  const crashShot = (i: number, start: number, end: number) => ({
    i, at: 0x100 + i * 8, op: 0x30, name: "queue_event", cat: "camera",
    sel: 0x40, action: "cam_play", args: [start, end, 0x39, 0],
    start, end, slot: 0x39, flags: 0, static: false, resume: false,
    cam: { file: "cp_test", path: 0, duration: end + 1 },
  });
  const shotDone = (i: number) => ({
    i, at: 0x100 + i * 8, op: 0x40, name: "wait_queued_events_done",
    cat: "wait", blocks_on: "queued events pending == 0",
  });
  const raiseFlag0 = (i: number) => ({
    i, at: 0x100 + i * 8, op: 0x48, name: "set_script_flag", cat: "flow",
    arg: 0, flag: 0,
  });
  const frames = (i: number) => ({
    i, at: 0x100 + i * 8, op: 0x42, name: "wait_frames", cat: "wait", arg: 1,
    blocks_on: "arg frames elapsed",
  });
  const block = (index: number, ops: unknown[], route: unknown) => ({
    index, at: index * 0x1000, route, steps: [{ index: 0, at: 0, ops }],
  });
  const END = { kind: "end", next: [-1, -1, -1] };
  const STOP = { kind: "goto", next: [-1, -1, -1] };
  const mk = (blocks: unknown[]) => ({
    scene: 1, stage: 2, game_mode: 0, evt_file: "test", entry_block: 0,
    entry_step: 0, routes: blocks.map((b) => (b as { route: unknown }).route),
    regions: [], cam_slots_used: [0x39], warnings: [], blocks,
  }) as unknown as ScriptJson;
  const walkerHost = {
    enterRegion: () => undefined, loadSlot: () => undefined,
    unloadSlot: () => undefined, startCamera: () => undefined,
    onFeed: () => undefined, onBranch: () => undefined,
    playSound: () => undefined, aliveEnemies: () => null,
    presentEnemies: () => null, aliveCivilians: () => null,
    cameraFree: () => null, scriptFlagRaised: () => null,
    showMessage: () => null,
  };
  const fresh = () => {
    ResetGameGlobals();
    EnterPlay();
    SetCameraPaths(StillPath(0x39, vec3(0, 10, 0), vec3(0, 10, -100)));
  };
  const listed = (w: Walker) => w.spawns.some((s) => s.at === RESCUE_AT);
  const at = (w: Walker) => `at ${w.block}/${w.step}/${w.opIndex}, `
    + `spawns ${w.spawns.map((s) => s.at.toString(16)).join(",")}`;

  // The shipped road, in miniature: block 0 spawns it and plays the crash
  // shot's last stretch on path 0x39 -- stage 2 plays `290..405` in block 11
  // step 1 -- and the route out is block 0's own `{11, 1}`.
  {
    fresh();
    const w = new Walker(mk([
      block(0, [rescueSpawn(0), crashShot(1, 290, 405), shotDone(2),
                frames(3)], END),
    ]), walkerHost);
    seekTo(w, 0, 0, 2);
    check("a seek that lands before the crash shot has run keeps it listed",
          listed(w), at(w));
    seekTo(w, 0, 0, 3);
    check("**one past the shot's end retires it**: abandoned at 0x122, "
          + "despawned at 0x181",
          !listed(w) && G.g_active_cam_path === 0x39
          && G.g_cam_path_frame >= 0x181,
          `${at(w)}, path ${G.g_active_cam_path} frame ${G.g_cam_path_frame}`);
  }
  // A shot that stops short of 0x181 is not the despawn: an abandoned
  // target rides on, and one rebuilt there finds 0x122 for itself.
  {
    fresh();
    const w = new Walker(mk([
      block(0, [rescueSpawn(0), crashShot(1, 290, 0x180), shotDone(2),
                frames(3)], END),
    ]), walkerHost);
    seekTo(w, 0, 0, 3);
    check("...and a crash shot that ends at 0x180 does not",
          listed(w), `${at(w)}, frame ${G.g_cam_path_frame}`);
  }
  // `g_script_flags[0]`: stage 2 raises it at 3/3/10 and 11/2/27, and every
  // state past the ride-in despawns on it.
  {
    fresh();
    const w = new Walker(mk([
      block(0, [rescueSpawn(0), raiseFlag0(1), frames(2)], END),
    ]), walkerHost);
    seekTo(w, 0, 0, 1);
    check("a seek that stops before flag 0 keeps it", listed(w), at(w));
    seekTo(w, 0, 0, 2);
    check("...and one past `set_script_flag 0` retires it",
          !listed(w) && (G.g_script_flags[0] ?? 0) === 1, at(w));
  }
  // The route: arm 1 out of its own block is its own rescue, the only writer
  // of `g_script_branch_var = 1` there (L45). Arm 0 is the road on which it
  // is still held, and still counted, until the crash shot.
  {
    fresh();
    const blocks = [
      block(0, [rescueSpawn(0), frames(1)],
            { kind: "branch", next: [1, 2, -1] }),
      // A `goto` to nothing rather than `END`: a route of any other kind
      // falls through to the next block, and block 1 would reach block 2.
      block(1, [frames(0), frames(1)], STOP),
      block(2, [frames(0), frames(1)], STOP),
    ];
    // A route transition enters a block at step 1 (`goToBlock`), so each
    // block here carries two steps and the seek lands on the second.
    for (const b of blocks.slice(1)) {
      (b as { steps: unknown[] }).steps.push({ index: 1, at: 0,
                                               ops: [frames(0), frames(1)] });
    }
    const w = new Walker(mk(blocks), walkerHost);
    seekTo(w, 1, 1, 1);
    check("a seek down arm 0 (not rescued) keeps it listed",
          w.block === 1 && listed(w), at(w));
    seekTo(w, 2, 1, 1);
    check("...and a seek down arm 1, its own rescue, retires it",
          w.block === 2 && !listed(w), at(w));
  }
  // The gate half, for both classes: every class whose `Init` counts is gone
  // on the far side of a room gate the replay steps over. Class 0x18's rider
  // is class 0x30 on a carrier (`CarriedZombieInit18`, `FUN_0045CD60`), and
  // the replay's list lacked it: stage 3's `0xADC`, placed at 0/6/6, came
  // back past `1/1/40` and held every gate after, the boat hostage's rescue
  // among them.
  {
    const RIDER_AT = 0xadc;
    const riderSpawn = (i: number) => ({
      i, at: 0x100 + i * 8, op: 0x09, name: "spawn_placed", cat: "spawn",
      spawns: [{ at: RIDER_AT, class: SpawnClass.CarriedZombie, flags: 0,
                 pos: [5, -6, -14], yaw_deg: 90, orient: [0, 0x4000, 0],
                 hp: 130, desc_flags: 0 }],
    });
    const roomGate = (i: number) => ({
      i, at: 0x100 + i * 8, op: 0x44, name: "wait_enemies_alive", cat: "wait",
      arg: 0, blocks_on: "enemies alive <= arg",
    });
    for (const [what, spawn, spawnAt] of [
      ["class 0x18's rider", riderSpawn, RIDER_AT],
      ["class 0x21's target", rescueSpawn, RESCUE_AT],
    ] as const) {
      fresh();
      const w = new Walker(mk([
        block(0, [spawn(0), roomGate(1), frames(2)], END),
      ]), walkerHost);
      seekTo(w, 0, 0, 1);
      const before = w.spawns.some((s) => s.at === spawnAt);
      seekTo(w, 0, 0, 2);
      check(`a room gate a replay steps over retires ${what}`,
            before && !w.spawns.some((s) => s.at === spawnAt), at(w));
    }
  }
  // ...and not two classes but **every class the game counts**
  // (`ENEMY_CLASSES`): the replay's list is the script's, written from
  // `spawns.md`, and it had fallen behind the game's twice. Class 0x46
  // answers per record -- its scatter flight counts nothing -- so its record
  // here is a swarm, sub-type 2, which `PlaceBats` counts member by member
  // (`INC` `0x0042DB5D`/`0x0042DB64`; the dive's pair is `0x0042DF87`/`8E`).
  {
    const recAt = (cls: number) => 0x5000 + cls * 0x10;
    SetGameTables({ ...CHARS, placements: [{
      at: recAt(SpawnClass.Bat), class: SpawnClass.Bat, char_type: 0x1e,
      motion: 0, hp: 0, body_condition: 0, initial_state: 0,
      attack_state: 0, ring_set: 0, yaw: 0,
      class46: { subtype: 2, group: 0, member: 0 },
    }, {
      // Class 0x42 answers per record too: the lone drop counts nothing, so
      // the record here is the cog's batch, sub-type 0, whose members
      // `PlaceWormBatch` counts one by one (`INC` `0x0042FBBF`/`0x0042FBC6`).
      at: recAt(SpawnClass.Worm), class: SpawnClass.Worm, char_type: -1,
      motion: 0, hp: 1, body_condition: 0, initial_state: 0,
      attack_state: 0, ring_set: 0, yaw: 0, class42: { subtype: 0 },
    }] } as unknown as CharactersJson, undefined, undefined, undefined);
    const left: string[] = [];
    for (const cls of ENEMY_CLASSES) {
      fresh();
      const w = new Walker(mk([
        block(0, [{
          i: 0, at: 0x100, op: 0x09, name: "spawn_placed", cat: "spawn",
          spawns: [{ at: recAt(cls), class: cls, flags: 0, pos: [0, 0, 0],
                     yaw_deg: 0, orient: [0, 0, 0], hp: 1, desc_flags: 0 }],
        }, {
          i: 1, at: 0x108, op: 0x44, name: "wait_enemies_alive", cat: "wait",
          arg: 0, blocks_on: "enemies alive <= arg",
        }, frames(2)], END),
      ]), walkerHost);
      seekTo(w, 0, 0, 2);
      if (w.spawns.some((s) => s.at === recAt(cls))) {
        left.push(`0x${cls.toString(16)}`);
      }
    }
    SetGameTables(CHARS, undefined, undefined, undefined);
    check("every class the game counts is gone past a gate a replay steps "
          + "over", left.length === 0, `still listed: ${left.join(", ")}`);
  }
  // Replay only: in play the target leaves through its own states.
  {
    fresh();
    const w = new Walker(mk([
      block(0, [rescueSpawn(0), raiseFlag0(1), frames(2)], END),
    ]), walkerHost);
    for (let i = 0; i < 8; i++) WalkerCameraFrame(w);
    check("played rather than replayed, the marker stands -- the actor goes "
          + "by itself", listed(w) && (G.g_script_flags[0] ?? 0) === 1,
          at(w));
  }
}

/**
 * The same shape, class 0x22. Stage 5's `?stage=5&original=1&block=4&step=1`
 * landed with `g_enemies_alive` 1 and nothing on screen to shoot: the replay
 * had listed JUDGMENT's flier since block 1 (`1/1/44`) and rebuilt it at the
 * landing, where its entrance's first frame made the walker
 * (`Class22DescendAndJoinFight` sub 0, `0x0049CE10`) and the walker counted
 * itself into both counters in its `Init` (`INC`s at `0x0048FE16` and
 * `0x0048FE1D`). Block 4 step 2's `wait_enemies_alive 0` then outlived every
 * zombie in the room.
 *
 * The engine is never in that state: by block 2 the flier has died and
 * raised `g_script_flags[0]` (`0x0049CC85`), which the script waits on at
 * `1/1/72`, and both bodies have despawned on their descriptor's cue, path
 * `0xCF` frame 140, which block 2 step 2 plays. `Class22OutlivedByReplay`
 * names those ways out.
 */
console.log("\na replay does not rebuild JUDGMENT past its own way out:");
{
  const FLIER_AT = 0x14ac;
  const WALKER_AT = 0x14e4;
  const op = (i: number, rest: Record<string, unknown>) =>
    ({ i, at: 0x100 + i * 8, ...rest });
  const flierSpawn = (i: number) => op(i, {
    op: 0x0b, name: "spawn_obj", cat: "spawn",
    spawns: [{ at: FLIER_AT, class: SpawnClass.Judgment, flags: 0,
               pos: [0, 0, 0], yaw_deg: 0, orient: [0, 0, 0], hp: 300,
               desc_flags: 0 }],
  });
  const roomGate = (i: number) => op(i, {
    op: 0x44, name: "wait_enemies_alive", cat: "wait", arg: 0,
    blocks_on: "enemies alive <= arg",
  });
  const waitFlag = (i: number, flag: number) => op(i, {
    op: 0x45, name: "wait_script_flag", cat: "wait", arg: flag,
    blocks_on: "script flag arg set",
  });
  const shot = (i: number, slot: number, start: number, end: number) => op(i, {
    op: 0x30, name: "queue_event", cat: "camera", sel: 0x40,
    action: "cam_play", args: [start, end, slot, 0], start, end, slot,
    flags: 0, static: false, resume: false,
    cam: { file: "cp_test", path: 0, duration: end + 1 },
  });
  const shotDone = (i: number) => op(i, {
    op: 0x40, name: "wait_queued_events_done", cat: "wait",
    blocks_on: "queued events pending == 0",
  });
  const frames = (i: number) => op(i, {
    op: 0x42, name: "wait_frames", cat: "wait", arg: 1,
    blocks_on: "arg frames elapsed",
  });
  const script = (ops: unknown[], slot: number) => ({
    scene: 5, stage: 5, game_mode: 1, evt_file: "test", entry_block: 0,
    entry_step: 0, routes: [{ kind: "end", next: [-1, -1, -1] }],
    regions: [], cam_slots_used: [slot], warnings: [],
    blocks: [{ index: 0, at: 0, route: { kind: "end", next: [-1, -1, -1] },
               steps: [{ index: 0, at: 0, ops }] }],
  }) as unknown as ScriptJson;
  const walkerHost = {
    enterRegion: () => undefined, loadSlot: () => undefined,
    unloadSlot: () => undefined, startCamera: () => undefined,
    onFeed: () => undefined, onBranch: () => undefined,
    playSound: () => undefined, aliveEnemies: () => null,
    presentEnemies: () => null, aliveCivilians: () => null,
    cameraFree: () => null, scriptFlagRaised: () => null,
    showMessage: () => null,
  };
  // The shipped rows' cues: stage 5 `0xCF`/140, stage 1's fight `0x31`/400
  // (never reached -- block 14 plays `0x31` to 230), the cameo `0x22`/400.
  const CUE: Readonly<Record<number, [number, number]>> = {
    0: [0x22, 400], 1: [0x31, 400], 2: [0xcf, 0x8c],
  };
  const walkerFor = (variant: number, ops: unknown[]): Walker => {
    ResetGameGlobals();
    EnterPlay();
    const [path, frame] = CUE[variant];
    SetCameraPaths(StillPath(path, vec3(0, 10, 0), vec3(0, 10, -100)));
    SetGameTables({ ...CHARS, placements: [
      { at: FLIER_AT, class: 0x22, char_type: 0x45, motion: 0x40b, hp: 300,
        class22: { variant, clip: 0x40b, frame: 0, despawn_path: path,
                   despawn_frame: frame, hp: 300, hp_stage: 210,
                   phase1_floor: 90,
                   companion_at: variant === 0 ? null : WALKER_AT,
                   sub_actor_at: Class22SubActorAt(FLIER_AT) } },
    ] } as unknown as CharactersJson, undefined, undefined, undefined);
    return new Walker(script(ops, path), walkerHost);
  };
  const listed = (w: Walker) => w.spawns.some((s) => s.at === FLIER_AT);
  const at = (w: Walker) => `at ${w.block}/${w.step}/${w.opIndex}, flags `
    + `0:${G.g_script_flags[0] ?? 0} 3:${G.g_script_flags[3] ?? 0}, path `
    + `${G.g_active_cam_path} frame ${G.g_cam_path_frame}`;

  // Stage 5 block 1 in miniature: the spawn, the room gate, the flag.
  {
    const w = walkerFor(2, [flierSpawn(0), roomGate(1), waitFlag(2, 0),
                            frames(3)]);
    seekTo(w, 0, 0, 1);
    check("a seek into the fight keeps the flier listed", listed(w), at(w));
    seekTo(w, 0, 0, 2);
    check("...and so does one parked on `wait_script_flag 0` past the room "
          + "gate: only the flier's death orbit raises that flag, so a "
          + "landing there has to rebuild the fight to be let past it",
          listed(w), at(w));
    seekTo(w, 0, 0, 3);
    check("**one past `wait_script_flag 0` retires the stage-5 flier** "
          + "(`Class22Death` sub 5, `0x0049CC85`) -- and with it the walker "
          + "its entrance would have made, counted",
          !listed(w) && (G.g_script_flags[0] ?? 0) === 1, at(w));
  }
  // Each fighting variant is retired by its own stage's flag and no other.
  {
    const w = walkerFor(1, [flierSpawn(0), waitFlag(1, 0), frames(2),
                            waitFlag(3, 3), frames(4)]);
    seekTo(w, 0, 0, 2);
    check("stage 1's flier is not retired by flag 0...", listed(w), at(w));
    seekTo(w, 0, 0, 4);
    check("...but by flag 3 (`0x0049CC95`)", !listed(w), at(w));
  }
  // The cue, `g_active_cam_path == tail+6 && g_cam_path_frame >= tail+8`:
  // the cameo's only way out, tested by `Class22CutsceneRideAndLeave`
  // (`0x0049B3F0`). Stage 1 block 0 plays `0x22` to 470.
  {
    const w = walkerFor(0, [flierSpawn(0), shot(1, 0x22, 360, 399),
                            shotDone(2), frames(3), shot(4, 0x22, 400, 470),
                            shotDone(5), frames(6)]);
    seekTo(w, 0, 0, 3);
    check("the cameo stays listed while its shot is short of frame 400",
          listed(w), at(w));
    seekTo(w, 0, 0, 6);
    check("...and is retired once the replay's camera has passed it",
          !listed(w), at(w));
  }
  {
    const w = walkerFor(0, [flierSpawn(0), waitFlag(1, 3), waitFlag(2, 0),
                            frames(3)]);
    seekTo(w, 0, 0, 3);
    check("the cameo raises no flag, and neither fight's flag retires it",
          listed(w), at(w));
  }
  // Replay only: in play the flier leaves through its own states.
  {
    const w = walkerFor(2, [flierSpawn(0), frames(1), frames(2)]);
    for (let i = 0; i < 4; i++) WalkerCameraFrame(w);
    G.g_script_flags[0] = 1;
    for (let i = 0; i < 4; i++) WalkerCameraFrame(w);
    check("played rather than replayed, the marker stands", listed(w), at(w));
  }
  SetGameTables(CHARS, undefined, undefined, undefined);
}

console.log("\nthe stage-2 car: class 0x21 makes it, and nothing does before:");
{
  /**
   * A host that answers every `op_` path with a pose that names **which**
   * path (in x) and **when** (in z), and a yaw on path 0x153 that is the time
   * times sixteen. That is all the car's routines are being asked: which
   * curve, at which frame.
   */
  const carHost: GameHost = {
    ...NULL_HOST,
    objectPath: (slot, frame) => ({
      x: slot, y: -8, z: frame, pitch: 0, roll: 0,
      yaw: slot === 0x153 ? frame * 16 : 0x100,
    }),
  };
  const carScene = (cam: number, frame: number) => {
    ResetGameGlobals();
    EnterPlay();
    SetGameTables(CHARS, undefined, undefined, undefined);
    G.g_active_cam_path = cam;
    G.g_cam_path_frame = frame;
  };
  const spawnRescue = () =>
    ActorSpawn(0x7d0, SpawnClass.RankScaledEnemy, 7, "rescue", undefined,
               new Rng(21));
  const tick = () => St2CarsTick(carHost);

  // **The bug.** The rig was drawn from stage load, at its exported root --
  // the origin, which is Goldman's desk -- through the whole of block 0
  // step 1. The car is `St2CarSpawn`'s, and `RescueTargetInit` is its only
  // caller (`0x00451800`).
  carScene(0x37, 35);
  tick();
  check("no class 0x21, no car -- not even on the Goldman shot",
        G.g_st2_cars.length === 0, String(G.g_st2_cars.length));
  spawnRescue();
  check("RescueTargetInit allocates exactly one, instance 0",
        G.g_st2_cars.length === 1 && G.g_st2_cars[0].index === 0
        && G.g_st2_cars[0].routine === St2CarRoutine.Init,
        JSON.stringify(G.g_st2_cars.map((c) => [c.index, c.routine])));
  const car = G.g_st2_cars[0];
  check("...which is neither posed nor drawn before its first update",
        !car.posed && !car.drawn);

  G.g_active_cam_path = 0x38;
  G.g_cam_path_frame = 10;
  tick();
  check("the Init runs the route update at once and installs it",
        car.routine === St2CarRoutine.Route && car.posed && car.drawn
        && car.spinOn === 1 && car.variant === 0,
        `routine ${car.routine} posed ${car.posed} drawn ${car.drawn}`);
  check("...shot 0x38 poses it on op_st2 0x148 at the camera's frame",
        car.pos.x === 0x148 && car.pos.z === 10,
        `${car.pos.x} @ ${car.pos.z}`);
  check("...and the spin gains 0x1000 BAMS a frame",
        car.spin === ST2CAR_SPIN_STEP, String(car.spin));
  G.g_cam_path_frame = 250;
  tick();
  check("0x38 has no hand-over: past its 200 frames the car still rides",
        car.routine === St2CarRoutine.Route && car.pos.z === 250,
        `routine ${car.routine} @ ${car.pos.z}`);

  G.g_active_cam_path = 0x39;
  G.g_cam_path_frame = 369;
  tick();
  check("shot 0x39 rides op_st2 0x14E, up to frame 369",
        car.routine === St2CarRoutine.Route && car.pos.x === 0x14e
        && car.variant === 0, `routine ${car.routine} x ${car.pos.x}`);
  G.g_cam_path_frame = 372;
  tick();
  check("...and at g_cam_path_length[0x14E] it parks, on the post-crash set",
        car.routine === St2CarRoutine.Held && car.variant === 1,
        `routine ${car.routine} variant ${car.variant}`);
  check("...posed on the hand-over frame itself, with no clamp to 370",
        car.pos.z === 372, String(car.pos.z));
  G.g_cam_path_frame = 380;
  tick();
  check("parked, it never re-poses", car.pos.z === 372, String(car.pos.z));
  check("...and its part yaw is 0x4000 - op_ 0x153's ry at n + 100",
        car.heldFrames === 1
        && car.partYaw === ST2CAR_PART_YAW_BASE - 101 * 16,
        `n ${car.heldFrames} yaw ${car.partYaw}`);
  for (let i = 1; i < ST2CAR_PART_YAW_FRAMES + 4; i++) tick();
  check("...for 39 frames, then it holds",
        car.partYaw === ST2CAR_PART_YAW_BASE - (100 + 39) * 16 && car.drawn,
        String(car.partYaw));
  G.g_script_flags[0] = 1;
  tick();
  check("g_script_flags[0] kills it: the task leaves the pool",
        G.g_st2_cars.length === 0, String(G.g_st2_cars.length));

  // The other arm: block 1's shot 0x3A.
  carScene(0x3a, 0x4f);
  spawnRescue();
  const stop = G.g_st2_cars[0];
  tick();
  check("shot 0x3A rides op_st2 0x14D, still spinning at frame 0x4F",
        stop.pos.x === 0x14d && stop.spinOn === 1
        && stop.routine === St2CarRoutine.Route,
        `x ${stop.pos.x} spin ${stop.spinOn}`);
  G.g_cam_path_frame = 0x50;
  tick();
  check("...the spin flag drops at 0x50", stop.spinOn === 0);
  G.g_cam_path_frame = 0x20;
  tick();
  check("...for good", stop.spinOn === 0);
  G.g_cam_path_frame = 130;
  tick();
  check("...and at 130 it parks on the ordinary set",
        stop.routine === St2CarRoutine.Held && stop.variant === 0,
        `routine ${stop.routine} variant ${stop.variant}`);
  G.g_script_flags[0] = 0;
  tick();
  check("...until g_script_flags[0], which a 0 does not satisfy",
        G.g_st2_cars.length === 1);

  // `St2CarInit` writes its pointer **after** calling the route update, so a
  // car whose first frame is already past the path's end runs the route once
  // more before it parks.
  carScene(0x39, 400);
  spawnRescue();
  const late = G.g_st2_cars[0];
  tick();
  check("the Init overrules a park on the first frame",
        late.routine === St2CarRoutine.Route && late.variant === 1,
        `routine ${late.routine} variant ${late.variant}`);
  tick();
  check("...and the next frame's route update parks it",
        late.routine === St2CarRoutine.Held);

  // A camera path the routine does not name: the engine reads its own
  // pointer as a path index; the port writes nothing and draws nothing.
  carScene(0x3b, 4);
  spawnRescue();
  const lost = G.g_st2_cars[0];
  tick();
  check("on an unnamed camera path it writes no pose",
        lost.routine === St2CarRoutine.Route && !lost.posed,
        `routine ${lost.routine} posed ${lost.posed}`);

  // The director runs it, and it is plain data a save state can carry.
  carScene(0x38, 20);
  spawnRescue();
  GameUpdate(1 / 60, carHost, new Rng(1), new Events());
  check("GameUpdate steps the car pool",
        G.g_st2_cars[0]?.drawn === true && G.g_st2_cars[0]?.pos.x === 0x148,
        JSON.stringify(G.g_st2_cars[0]?.pos));
  check("...and the pool survives JSON",
        JSON.stringify(JSON.parse(JSON.stringify(G.g_st2_cars)))
          === JSON.stringify(G.g_st2_cars));
}

console.log("\nSt2CarDraw: the row, the two gated rotations, the roll-limited frame:");
{
  // Left open by the car's port: the crashed set, the
  // spin and the parked part's turn were never drawn -- the task only said
  // "drew". `St2CarDraw` (`FUN_00452320`) decides all three, and the port
  // leaves what it decided on `car.draw`.
  const carHost: GameHost = {
    ...NULL_HOST,
    objectPath: (slot, frame) => ({
      x: slot, y: -8, z: frame, pitch: 0, roll: 0,
      yaw: slot === 0x153 ? frame * 16 : 0x100,
    }),
  };
  const scene = (cam: number, frame: number) => {
    ResetGameGlobals();
    EnterPlay();
    G.g_active_cam_path = cam;
    G.g_cam_path_frame = frame;
  };
  const slots = (c: { draw: { parts: { slot: number }[] } }) =>
    c.draw.parts.map((p) => p.slot);
  check("g_st2car_asset_variants is the image's two rows",
        JSON.stringify(ST2CAR_ASSET_VARIANTS)
          === JSON.stringify([[0x2d, 0x2f, 0x34, 0x31], [0x2e, 0x30, 0x35, 0x32]]));

  // The unshot branch: shot 0x39 runs out and the row changes.
  scene(0x39, 368);
  const car = St2CarSpawn(0);
  St2CarsTick(carHost);
  check("riding shot 0x39, the draw names row 0",
        car.drawn && JSON.stringify(slots(car))
          === JSON.stringify([0x2d, 0x2f, 0x34, 0x31]),
        JSON.stringify(slots(car)));
  check("...the spun columns turn RotX by obj+0x1330 while +0x1320 is set",
        car.spinOn === 1 && car.draw.parts[2].rotX === car.spin
        && car.draw.parts[3].rotX === car.spin && car.spin !== 0
        && car.draw.parts[0].rotX === 0 && car.draw.parts[1].rotX === 0,
        JSON.stringify(car.draw.parts.map((p) => p.rotX)));
  check("...on the roll-limited frame, and only they",
        JSON.stringify(car.draw.parts.map((p) => p.limited))
          === JSON.stringify([false, false, true, true]));
  const spinAtCrash = car.spin;
  G.g_cam_path_frame = 370;
  St2CarsTick(carHost);
  check("at frame 370 it parks, and the same frame's draw is row 1",
        car.routine === St2CarRoutine.Held
        && car.variant === St2CarAssetRow.Crashed
        && JSON.stringify(slots(car))
          === JSON.stringify([0x2e, 0x30, 0x35, 0x32]),
        JSON.stringify(slots(car)));
  check("...with no turn yet on the parked part: obj+0x1324 is still 0",
        car.draw.parts[1].rotY === 0);
  St2CarsTick(carHost);
  St2CarsTick(carHost);
  check("parked, the second column turns RotY by obj+0x1334",
        car.heldFrames === 2 && car.partYaw !== 0
        && car.draw.parts[1].rotY === car.partYaw
        && car.partYaw === ST2CAR_PART_YAW_BASE - 102 * 16,
        `${car.heldFrames} ${car.partYaw} ${car.draw.parts[1].rotY}`);
  check("...and the spin holds where it was: +0x1320 is still set on 0x39",
        car.spin === spinAtCrash + ST2CAR_SPIN_STEP
        && car.draw.parts[2].rotX === car.spin,
        `${car.spin} ${car.draw.parts[2].rotX}`);

  // The rescue branch: shot 0x3A clears the spin flag at 0x50, and a skipped
  // `RotX` is not a held one -- the columns draw at no rotation at all.
  scene(0x3a, 0x4f);
  const stop = St2CarSpawn(0);
  St2CarsTick(carHost);
  St2CarsTick(carHost);
  check("on 0x3A before frame 0x50 the columns still spin",
        stop.draw.parts[2].rotX === stop.spin && stop.spin === 2 * 0x1000);
  G.g_cam_path_frame = 0x50;
  St2CarsTick(carHost);
  check("...and from 0x50 they draw at RotX 0, whatever +0x1330 holds",
        stop.spinOn === 0 && stop.spin === 3 * 0x1000
        && stop.draw.parts[2].rotX === 0 && stop.draw.parts[3].rotX === 0,
        `${stop.spin} ${stop.draw.parts[2].rotX}`);
  G.g_cam_path_frame = 130;
  St2CarsTick(carHost);
  St2CarsTick(carHost);
  check("...and parked on 0x3A it keeps row 0 and turns the part",
        stop.routine === St2CarRoutine.Held
        && JSON.stringify(slots(stop))
          === JSON.stringify([0x2d, 0x2f, 0x34, 0x31])
        && stop.draw.parts[1].rotY === stop.partYaw && stop.partYaw !== 0);

  // The roll limiter, on a pose with only a roll: `MatrixGetAngles` hands the
  // roll back, and `0x00452414`..`0x0045245A` remaps it.
  const lim = (roll: number) => {
    const c = St2CarSpawn(0);
    c.pitch = 0; c.yaw = 0; c.roll = roll;
    St2CarDraw(c);
    return c.draw.limited.roll;
  };
  // Within one BAMS: `MatrixGetAngles` truncates an `atan2` of a matrix built
  // from `sin`/`cos`, which can land a hair under the angle it was given.
  const near = (a: number, b: number) => Math.abs(a - b) <= 1;
  check("a roll inside +0x800 is dropped", lim(0x400) === 0, String(lim(0x400)));
  check("...up to 0x4000 it loses the 0x800",
        near(lim(0x1000), 0x800) && near(lim(0x4000), 0x3800),
        `${lim(0x1000)} ${lim(0x4000)}`);
  check("...from there to 0xC000 it passes",
        near(lim(0x6000), 0x6000), String(lim(0x6000)));
  check("...a small negative roll, down to -0x1800, is dropped",
        lim(-0x1000) === 0 && lim(-0x1800) === 0,
        `${lim(-0x1000)} ${lim(-0x1800)}`);
  check("...and a larger one loses 0xE800 off its sixteen bits",
        near(lim(-0x2000), 0xe000 - 0xe800), String(lim(-0x2000)));
  const turned = St2CarSpawn(0);
  turned.pitch = 0x400; turned.yaw = 0x3000; turned.roll = 0;
  St2CarDraw(turned);
  check("with no roll the frame is the body's pitch and yaw",
        Math.abs(turned.draw.limited.pitch - 0x400) <= 1
        && Math.abs(turned.draw.limited.yaw - 0x3000) <= 1
        && turned.draw.limited.roll === 0,
        JSON.stringify(turned.draw.limited));
  check("...and the draw is plain data a snapshot carries",
        JSON.stringify(JSON.parse(JSON.stringify(turned.draw)))
          === JSON.stringify(turned.draw));
  ResetGameGlobals();
}

console.log("\nclasses 0x52 and 0x53, the two shootable triggers:");
{
  const triggerScene = (cls: SpawnClass, tail: object,
                        mode = GameMode.Original) => {
    ResetGameGlobals();
    EnterPlay();
    SetGameTables(CHARS, undefined, undefined, undefined);
    G.g_GameMode = mode;
    const a = ActorSpawn(0x1234, cls, 0x1a, "trigger", tail, new Rng(5));
    a.visible = true;
    return a;
  };
  const tick = (a: Actor) => g_class_handlers[a.cls]?.update(
    a, { dt: 1 / 60, rng: new Rng(1), host: NULL_HOST });

  // Class 0x52's per-sub-type table is the reading stage 4 block 10 proves:
  // `next = {12, 18, 19}` with one sub-type 3 and one sub-type 4 in it.
  for (const [sub, want] of [[2, 2], [3, 1], [4, 2]] as [number, number][]) {
    const a = triggerScene(SpawnClass.Mouse, { class52: { subtype: sub } });
    MarkActorShot(a, 0, 0);
    tick(a);
    check(`class 0x52 sub-type ${sub} writes route ${want}`,
          G.g_script_branch_var === want, String(G.g_script_branch_var));
  }
  {
    const a = triggerScene(SpawnClass.Mouse, { class52: { subtype: 0 } });
    MarkActorShot(a, 0, 0);
    tick(a);
    check("...and a wanderer writes nothing", G.g_script_branch_var === 0,
          String(G.g_script_branch_var));
    // `ActorDespawn` sets `despawned`, not `dead`: the actor has removed
    // itself and `GameUpdate`'s sweep takes it off `g_object_list`. `dead` is
    // hit points, and this class has none.
    const arcade = triggerScene(SpawnClass.Mouse,
                                { class52: { subtype: 2 } }, GameMode.Arcade);
    check("...and arcade never builds a trigger at all", arcade.despawned);
  }

  // The mouse's own machine: the strip, the wander and the flight. It is
  // ported in full because until now it was ported in half and unreachable.
  {
    const a = triggerScene(SpawnClass.Mouse, { class52: { subtype: 0 } });
    if (a.cls !== SpawnClass.Mouse) throw new Error("not class 0x52");
    check("the Init opens on a frame of the ten-slot strip",
          a.mouse.frame >= MOUSE_FIRST_SLOT
          && a.mouse.frame <= MOUSE_LAST_SLOT,
          a.mouse.frame.toString(16));
    check("...and the shot-test radius `ShotTestSphere` measures against",
          a.hitRadius === MOUSE_HIT_RADIUS, String(a.hitRadius));

    // The strip wraps rather than running off the end of `mouse.bin`.
    a.mouse.frame = MOUSE_LAST_SLOT;
    a.mouse.state = MouseState.Run;
    MouseWanderUpdate(a, { dt: 1 / 60, rng: new Rng(3),
                           host: NULL_HOST });
    check("the strip wraps from the last slot back to the first",
          a.mouse.frame === MOUSE_FIRST_SLOT, a.mouse.frame.toString(16));

    // 600 frames and it leaves on its own, which is why four of these in
    // stage 1 block 1 answer no branch: they are gone before the route is
    // taken, and they are subtype 0 besides.
    const b = triggerScene(SpawnClass.Mouse, { class52: { subtype: 0 } });
    if (b.cls !== SpawnClass.Mouse) throw new Error("not class 0x52");
    for (let i = 0; i < 601; i++) {
      MouseWanderUpdate(b, { dt: 1 / 60, rng: new Rng(9),
                             host: NULL_HOST });
    }
    check("a wanderer leaves at 600 frames", b.despawned,
          `life ${b.mouse.life}`);

    // **The turn is the whole of the wander.** `MouseWanderUpdate` ends its
    // sixty-frame pause with `obj+0x68 += (rand() & 0xFFF) - (rand() & 0xFFF)`
    // and then rebuilds the velocity from the new yaw. The port had that as a
    // mask over `Rng.next()`, which returns a float in `[0, 1)`, so both terms
    // were zero: the mouse paused on cue, turned by nothing, and ran in a
    // straight line until its six hundred frames were up. One generator across
    // the samples, because two draws from a fresh one are the same two draws.
    const c = triggerScene(SpawnClass.Mouse, { class52: { subtype: 0 } });
    if (c.cls !== SpawnClass.Mouse) throw new Error("not class 0x52");
    const wanderRng = new Rng(4);
    const turns: number[] = [];
    for (let i = 0; i < 40; i++) {
      c.mouse.state = MouseState.Pause;
      c.mouse.paused = MOUSE_PAUSE_FRAMES;
      const before = c.yaw;
      MouseWanderUpdate(c, { dt: 1 / 60, rng: wanderRng,
                             host: NULL_HOST });
      turns.push(c.yaw - before);
    }
    check("the mouse turns when its pause ends",
          turns.some((t) => t !== 0),
          `${turns.filter((t) => t === 0).length} of 40 were zero`);
    // One draw would be uniform over 0..0xFFF and so always a turn the same
    // way round. The subtraction is what centres it on zero.
    check("...both ways, because it is the difference of two draws",
          turns.some((t) => t > 0) && turns.some((t) => t < 0),
          `${turns.filter((t) => t > 0).length} up, `
          + `${turns.filter((t) => t < 0).length} down`);
    check("...and never by a whole twelve bits either way",
          turns.every((t) => Math.abs(t) < MOUSE_TURN_SPREAD),
          String(Math.max(...turns.map(Math.abs))));
    // The velocity is rebuilt from the yaw on the same frame, or the mouse
    // would face one way and keep running the other.
    c.mouse.state = MouseState.Pause;
    c.mouse.paused = MOUSE_PAUSE_FRAMES;
    const vx0 = c.mouse.vx;
    const vz0 = c.mouse.vz;
    MouseWanderUpdate(c, { dt: 1 / 60, rng: wanderRng,
                           host: NULL_HOST });
    check("...and the velocity follows it on the same frame",
          (c.mouse.vx !== vx0 || c.mouse.vz !== vz0)
          && Math.abs(Math.hypot(c.mouse.vx, c.mouse.vz) - MOUSE_SPEED) < 1e-6,
          `${vx0},${vz0} -> ${c.mouse.vx},${c.mouse.vz}`);
  }

  // The trigger's flight: shot, then the per-subtype bound, then stopped.
  {
    const a = triggerScene(SpawnClass.Mouse, { class52: { subtype: 3 } });
    if (a.cls !== SpawnClass.Mouse) throw new Error("not class 0x52");
    a.pos = vec3(-500, 0, 0);
    a.yaw = 0x4000;                    // -x in the port's world convention
    MarkActorShot(a, 0, 0);
    MouseBranchTriggerUpdate(a);
    check("the shot writes the route and starts the flight",
          G.g_script_branch_var === 1 && a.mouse.state === MouseState.Pause,
          `var ${G.g_script_branch_var} state ${a.mouse.state}`);
    MouseBranchTriggerUpdate(a);
    check("...which resolves to subtype 3's own arm",
          a.mouse.state === MouseState.FleeSubtype3, String(a.mouse.state));
    const x0 = a.pos.x;
    MouseBranchTriggerUpdate(a);
    check("...and it moves", a.pos.x !== x0, `${x0} -> ${a.pos.x}`);
    a.pos.x = -80;                     // past subtype 3's bound of -87
    MouseBranchTriggerUpdate(a);
    check("...until it passes its bound, and then stops",
          a.mouse.state === MouseState.Stopped, String(a.mouse.state));
  }

  // Each trigger subtype has its own removal flag, tested before the switch.
  {
    const a = triggerScene(SpawnClass.Mouse, { class52: { subtype: 4 } });
    G.g_script_flags[0x22] = 1;
    MouseBranchTriggerUpdate(a);
    check("subtype 4's own script flag takes it away", a.despawned);
    const b = triggerScene(SpawnClass.Mouse, { class52: { subtype: 4 } });
    G.g_script_flags[0x21] = 1;        // subtype 3's, not this one's
    MouseBranchTriggerUpdate(b);
    check("...and another subtype's does not", !b.despawned);
  }

  // The cat answers in block 8 and nowhere else, and it is the only writer in
  // the game that refuses to overwrite an answer already given.
  {
    const a = triggerScene(SpawnClass.SkinnedNpc,
                           { class53: { anim_set: 0, subtype: 2 } });
    G.g_evt_block_index = 3;
    MarkActorShot(a, 0, 0);
    tick(a);
    check("the cat in block 3 writes nothing", G.g_script_branch_var === 0,
          String(G.g_script_branch_var));
    G.g_evt_block_index = 8;
    MarkActorShot(a, 0, 0);
    tick(a);
    check("...and in block 8 it writes 2", G.g_script_branch_var === 2,
          String(G.g_script_branch_var));

    const b = triggerScene(SpawnClass.SkinnedNpc,
                           { class53: { anim_set: 0, subtype: 2 } });
    G.g_evt_block_index = 8;
    G.g_script_branch_var = 1;
    MarkActorShot(b, 0, 0);
    tick(b);
    check("...but it will not overwrite a route already chosen",
          G.g_script_branch_var === 1, String(G.g_script_branch_var));
  }
}

console.log("\nclass 0x53, the cat: the playlist, the run and the flight:");
{
  // `cat.bin`'s clips as `nya.bin` bakes them: the frame counts and the real
  // `g_motion_play_length` (0x004E07D0) -- 0x305 58, 0x2FC 79, 0x2FD 44,
  // 0x2FA 48 -- because every step of the playlist is measured against the
  // play length, and a fixture that derived it would pass a bundle that got
  // it wrong. The travel is the shape of the real clips': 0x305 stands,
  // 0x2FC creeps 2.6 units, 0x2FD runs 12.7 a pass.
  const CAT_TYPE = {
    ...TYPE, type: 0x1a, name: "cat", file: "cat.bin", bone_count: 19,
    motions: {
      [String(CAT_TRIGGER_IDLE_MOTION)]: motion(30, 0, 58),
      "764": motion(41, 0.066, 79),
      [String(CAT_TRIGGER_FLEE_MOTION)]: motion(23, 0.58, 44),
      [String(CAT_TRIGGER_CUE_MOTION)]: motion(25, 0.16, 48),
    },
  } as unknown as CharacterType;
  const CAT_CHARS = { ...CHARS,
    types: { ...CHARS.types, "26": CAT_TYPE } } as CharactersJson;
  const catScene = (tail: { anim_set: number; subtype: number },
                    at: Partial<Actor>, mode = GameMode.Original) => {
    ResetGameGlobals();
    EnterPlay();
    SetGameTables(CAT_CHARS, undefined, undefined, undefined);
    G.g_GameMode = mode;
    const a = ActorSpawn(0x6e98, SpawnClass.SkinnedNpc, 0x1a, "cat",
                         { class53: tail, ...at }, new Rng(5));
    a.visible = true;
    return a;
  };
  const tailOf = (a: Actor) => (a as Actor & { cat: CatTail }).cat;
  // One frame the way `SceneTaskWalk` runs it: the clip clock first -- the
  // engine's draw and `model[0] += 1` -- then the class's routine, which
  // reads the counter after the increment as the engine's does.
  const frame = (a: Actor) => {
    G.g_shot_test_list = [];
    ActorAdvanceMotion(a, 1 / 60);
    g_class_handlers[a.cls]?.update(
      a, { dt: 1 / 60, rng: new Rng(1), host: NULL_HOST });
  };

  check("CAT_CLIPS carries every clip the playlist and the trigger name",
        CAT_MOTIONS.every((m) => m < 0 || CAT_CLIPS.includes(m))
        && [CAT_TRIGGER_IDLE_MOTION, CAT_TRIGGER_CUE_MOTION,
            CAT_TRIGGER_FLEE_MOTION].every((m) => CAT_CLIPS.includes(m)),
        CAT_CLIPS.map((m) => m.toString(16)).join(","));

  // Stage 2 block 11's cat, as it ships: set 5, sub-type 1, at evt 0x6E98.
  // The report was that it never moves; the exe has it stand, creep, and then
  // run until it is taken away at frame 1001.
  {
    const a = catScene({ anim_set: 5, subtype: 1 },
                       { pos: vec3(-890, -6, -1015), yaw: 36864 });
    const sub = tailOf(a);
    check("CatInit seats entry 0 of set 5, 0x305",
          a.motion === CAT_TRIGGER_IDLE_MOTION, a.motion.toString(16));
    check("...raises obj+0x38 bit 3 for sub-type 1",
          (a.flags38 & ZombieAux.SceneLit) !== 0, String(a.flags38));
    check("...and takes the per-bone shot bit back",
          (a.flags & ActorFlag.ShootPerBone) === 0, a.flags.toString(16));
    const start = { ...a.pos };
    const clip: number[] = [];
    let registered = 0;
    let at192 = { ...a.pos };
    let aliveAt1000 = false;
    for (let f = 1; f <= CAT_LIFE_FRAMES + 1; f++) {
      frame(a);
      clip[f] = a.motion;
      if (G.g_shot_test_list.some((e) => e.at === a.at)) registered++;
      if (f === 192) at192 = { ...a.pos };
      if (f === CAT_LIFE_FRAMES) aliveAt1000 = !a.despawned;
    }
    check("0x305 plays twice, 57 frames a pass, then 0x2FC",
          clip[113] === CAT_TRIGGER_IDLE_MOTION && clip[114] === 764,
          `${clip[113]?.toString(16)} ${clip[114]?.toString(16)}`);
    check("0x2FC plays once, 78 frames, then 0x2FD",
          clip[191] === 764 && clip[192] === CAT_TRIGGER_FLEE_MOTION,
          `${clip[191]?.toString(16)} ${clip[192]?.toString(16)}`);
    check("...and 0x2FD is the last: -2 plays it for ever",
          clip[CAT_LIFE_FRAMES] === CAT_TRIGGER_FLEE_MOTION,
          clip[CAT_LIFE_FRAMES]?.toString(16));
    const crept = Math.hypot(at192.x - start.x, at192.z - start.z);
    const ran = Math.hypot(a.pos.x - at192.x, a.pos.z - at192.z);
    check("it only creeps before the run", crept > 0.5 && crept < 5,
          crept.toFixed(2));
    // 808 frames of a clip worth 12.7 units every 43: about 230 units, which
    // is off the screen from anywhere the camera stands in that room.
    check("and runs a long way after it", ran > 150, ran.toFixed(1));
    check("it is still there on frame 1000", aliveAt1000);
    check("...and gone on frame 1001", a.despawned);
    check("a cat that plays its list is never in the shot test",
          registered === 0, String(registered));
    check("...and its life counter is what took it", sub.frames === 1001,
          String(sub.frames));
  }

  // Block 8's trigger: set 0, sub-type 2, facing -x at x = -411.3.
  {
    const a = catScene({ anim_set: 0, subtype: 2 },
                       { pos: vec3(-411.3, -5, -1271.5), yaw: 0x4000 });
    const sub = tailOf(a);
    check("the trigger is seated on 0x305 with the 4.0 sphere",
          a.motion === CAT_TRIGGER_IDLE_MOTION
          && a.hitRadius === CAT_TRIGGER_HIT_RADIUS
          && sub.set === CatTriggerState.Waiting,
          `${a.motion.toString(16)} ${a.hitRadius} ${sub.set}`);
    G.g_evt_block_index = 3;
    const clip: number[] = [];
    let registered = 0;
    for (let f = 1; f <= 200; f++) {
      frame(a);
      clip[f] = a.motion;
      if (G.g_shot_test_list.some((e) => e.at === a.at)) registered++;
    }
    check("it cues 0x2FA once 200 frames have passed, not before",
          clip[199] === CAT_TRIGGER_IDLE_MOTION
          && clip[200] === CAT_TRIGGER_CUE_MOTION,
          `${clip[199]?.toString(16)} ${clip[200]?.toString(16)}`);
    check("...registering its feet for the shot test every frame",
          registered === 200
          && a.shotCentre.x === a.pos.x && a.shotCentre.y === a.pos.y,
          String(registered));
    check("...and it stands while it waits", a.pos.x === -411.3,
          String(a.pos.x));
    G.g_evt_block_index = CAT_BRANCH_BLOCK;
    MarkActorShot(a, 0, 0);
    frame(a);
    check("shot in block 8, it writes route 2 and runs on 0x2FD",
          G.g_script_branch_var === 2 && a.motion === CAT_TRIGGER_FLEE_MOTION
          && sub.set === CatTriggerState.Fleeing,
          `${G.g_script_branch_var} ${a.motion.toString(16)} ${sub.set}`);
    let frames = 0;
    let lastX = a.pos.x;
    let backwards = false;
    while (sub.set === CatTriggerState.Fleeing && frames < 3000) {
      frame(a);
      if (a.pos.x > lastX + 1e-6) backwards = true;
      lastX = a.pos.x;
      frames++;
    }
    check("its clip carries it along -x until it is past -478",
          sub.set === CatTriggerState.Stopped
          && a.pos.x < CAT_TRIGGER_STOP_X && !backwards,
          `${sub.set} x ${a.pos.x.toFixed(2)} after ${frames}`);
    check("...where it settles on 0x305 again",
          a.motion === CAT_TRIGGER_IDLE_MOTION, a.motion.toString(16));
    G.g_script_flags[CAT_TRIGGER_REMOVE_FLAG] = 1;
    frame(a);
    check("g_script_flags[0x83] takes it away", a.despawned);
  }

  // The mode gate is in the Init: in arcade there is no trigger at all.
  {
    const a = catScene({ anim_set: 0, subtype: 2 }, { pos: vec3(0, 0, 0) },
                       GameMode.Arcade);
    check("an arcade trigger despawns in its Init", a.despawned);
  }
}

console.log("\nclass 0x41 type 75: the writer of stage 4's flag 20:");
{
  const rng = new Rng(75);
  /** The fixture's type-75 placement, which is stage 4's shape. */
  const PLACEMENT_75 = 0xa400;

  const place75 = () => {
    const pl = T.breakables?.placements?.find((q) => q.at === PLACEMENT_75);
    if (!pl) throw new Error("the type-75 placement is missing");
    const p = PlaceGenericProp(pl, rng);
    G.g_breakable_props.push(p);
    return p;
  };
  const flag20 = () => G.g_script_flags[PROP75_SCRIPT_FLAG] ?? 0;

  // --- the Arcade head, `0x004710D7` -------------------------------------
  //
  // This is the arm the player actually runs, and it is the one a reading
  // that lumped type 75 in with the other Original-Mode-only types would get
  // wrong: those despawn silently, and this one raises the flag first.
  {
    propScene(rng, GameMode.Arcade);
    const p = place75();
    check("type 75 runs its own g_class41_updates row, as a generic prop",
          p.family === PropFamily.Generic
          && GENERIC_ROUTINES[75] === PropUpdateType75, PropFamily[p.family]);
    check("...and `PlaceGenericProp` seeds its `+0x2A4` at 0 and not -1",
          p.removeFlag === 0, String(p.removeFlag));
    check("...with flag 20 down before its first frame", flag20() === 0);
    BreakablePropPoolUpdate(rng);
    check("in Arcade it raises g_script_flags[20] on its first frame",
          flag20() === 1, String(flag20()));
    check("...and leaves the pool on that same frame",
          !G.g_breakable_props.some((q) => q.id === p.id),
          `${G.g_breakable_props.length} props left`);
  }

  // --- the unshot step tick, `0x00471120` --------------------------------
  {
    propScene(rng, GameMode.Original);
    G.g_evt_step_index = 1;
    const p = place75();
    BreakablePropPoolUpdate(rng);
    check("in Original Mode its first frame raises nothing",
          flag20() === 0 && G.g_breakable_props.length === 1,
          `${flag20()} / ${G.g_breakable_props.length}`);

    G.g_evt_step_index = 2;
    BreakablePropPoolUpdate(rng);
    check("...nor does the FIRST change of g_evt_step_index",
          flag20() === 0 && G.g_breakable_props.some((q) => q.id === p.id),
          `${flag20()}`);

    // `INC` then `CMP EAX, 0x2` -- an equality on the counter, so it is this
    // one change and no other. A prop that lived longer would not raise it
    // again, which is why the test walks the index rather than the frames.
    G.g_evt_step_index = 3;
    BreakablePropPoolUpdate(rng);
    check("...the SECOND change is the one that raises flag 20",
          flag20() === 1, String(flag20()));
    check("...on the last step its `lifetime_evt_steps` of 2 buys it",
          G.g_breakable_props.some((q) => q.id === p.id),
          "already gone");

    G.g_evt_step_index = 4;
    BreakablePropPoolUpdate(rng);
    check("...and the third change expires it",
          !G.g_breakable_props.some((q) => q.id === p.id),
          `${G.g_breakable_props.length} props left`);
  }

  // --- the shot ride, `0x00471263` ---------------------------------------
  {
    const events = propScene(rng, GameMode.Original);
    let dropX = NaN, dropY = NaN, dropZ = NaN;
    events.on("item.released", (e) => {
      dropX = e.x; dropY = e.y; dropZ = e.z;
    });
    G.g_evt_step_index = 1;
    const p = place75();
    const live = () => G.g_breakable_props.find((q) => q.id === p.id);

    const l = live();
    if (l) BreakablePropTakeShot(l, 0);
    BreakablePropPoolUpdate(rng, events);
    check("a shot puts it on the ride",
          live()?.cuePhase === PropCuePhase.Riding,
          String(live()?.cuePhase));
    check("...and drops its story item at the routine's own literal point",
          Math.abs(dropX - PROP75_DROP_AT[0]) < 1e-3
          && Math.abs(dropY - PROP75_DROP_AT[1]) < 1e-3
          && Math.abs(dropZ - PROP75_DROP_AT[2]) < 1e-3,
          `${dropX},${dropY},${dropZ}`);
    check("...having put its own position straight back afterwards",
          Math.abs((live()?.x ?? 0) - 121.8) < 1e-3,
          `${live()?.x}`);
    check("...with the flag still down on the frame of the shot",
          flag20() === 0, String(flag20()));

    // The cursor was stepped once on the frame of the shot, so 289 more
    // reach 290.0 and the arm fires on the last of them.
    for (let i = 0; i < PROP75_RIDE_LENGTH - 2; i++) {
      BreakablePropPoolUpdate(rng, events);
    }
    check(`...still down ${PROP75_RIDE_LENGTH - 1} frames into the ride`,
          flag20() === 0, `${flag20()} at ${live()?.shake}`);
    BreakablePropPoolUpdate(rng, events);
    check("...and raised on the frame the cursor reaches "
          + `${PROP75_RIDE_LENGTH}`,
          flag20() === 1 && live()?.cuePhase === PropCuePhase.Done,
          `${flag20()} phase ${live()?.cuePhase}`);
  }

  // --- the declaration, and why it is per record --------------------------
  //
  // The gate is only honoured because the class says it can open it. A
  // class-wide number would say that of every one of the six stages' 441
  // class-0x41 spawns; this asks the record.
  {
    propScene(rng, GameMode.Original);
    check("the placer declares flag 20 for the record that places a type 75",
          PropContainerRaisesScriptFlag(
            { class: 0x41, hp: 0, at: PLACEMENT_75 }) === PROP75_SCRIPT_FLAG,
          String(PropContainerRaisesScriptFlag(
            { class: 0x41, hp: 0, at: PLACEMENT_75 })));
    check("...and nothing for a record that places a group",
          PropContainerRaisesScriptFlag(
            { class: 0x41, hp: 0, at: 0xa100 }) === undefined);
    check("...and nothing for a `spawn_simple` record, which has no address",
          PropContainerRaisesScriptFlag({ class: 0x41, hp: 0 }) === undefined);
    check("...and the type it keys on is the engine's own 75",
          PROP75_TYPE === 75 && PROP75_SLOT === 0xa6b,
          String(PROP75_SLOT));
  }

  // --- and therefore: the gate is one the bundle can open ------------------
  {
    propScene(rng, GameMode.Original);
    const spawnOp = (at: number) => ({
      i: 0, at: 0, op: 0x09, name: "spawn_placed", cat: "spawn",
      spawns: [{ at, class: 0x41, flags: 0, pos: [0, 0, 0],
                 yaw_deg: 0, orient: [0, 0, 0], hp: 2, desc_flags: 0 }],
    });
    const gateScript = (at: number) => ({
      scene: 0, stage: 4, game_mode: 0, evt_file: "test", entry_block: 0,
      entry_step: 0, routes: [{ kind: "end", next: [-1, -1, -1] }],
      regions: [], cam_slots_used: [], warnings: [],
      blocks: [{
        index: 0, at: 0, route: { kind: "end", next: [-1, -1, -1] },
        steps: [{ index: 0, at: 0, ops: [
          spawnOp(at),
          { i: 1, at: 8, op: 0x45, arg: PROP75_SCRIPT_FLAG,
            flag: PROP75_SCRIPT_FLAG, name: "wait_script_flag", cat: "wait",
            blocks_on: "script flag 20 set" },
        ] }],
      }],
    } as unknown as ScriptJson);

    check("a bundle that places the type-75 prop CAN raise flag 20",
          ScriptFlagsThisBundleCanRaise(gateScript(PLACEMENT_75))
            .has(PROP75_SCRIPT_FLAG),
          [...ScriptFlagsThisBundleCanRaise(gateScript(PLACEMENT_75))]
            .join(","));
    check("...and one whose class-0x41 spawn is a group cannot",
          !ScriptFlagsThisBundleCanRaise(gateScript(0xa100))
            .has(PROP75_SCRIPT_FLAG),
          [...ScriptFlagsThisBundleCanRaise(gateScript(0xa100))].join(","));
  }
}

console.log("\nthe branch writers: every route the game can choose:");
{
  const rng = new Rng(88);

  /** One generic prop of `type`, carrying `word` as its `+0x11C`. */
  const genericProp = (type: number, word: number) => {
    const p = PlaceGenericProp({ at: 0x1000 + type, container: "generic",
                                 type, slot: word,
                                 lifetime_evt_steps: word, pos: [0, 0, 0] },
                               rng);
    G.g_breakable_props.push(p);
    return p;
  };
  const hitAndTick = (p: { id: number }) => {
    const live = G.g_breakable_props.find((q) => q.id === p.id);
    if (!live) return;
    BreakablePropTakeShot(live, 0);
    BreakablePropPoolUpdate(rng);
  };

  // Types 14 and 19: the constructor seeds the DEFAULT route from the
  // descriptor and the first hit writes the other one. That pairing is the
  // whole mechanism, and reading either half alone makes it look like two
  // unrelated writes to the same global.
  for (const type of [0x0e, 0x13]) {
    propScene(rng, GameMode.Arcade);
    const p = genericProp(type, 0);
    check(`type ${type.toString(16)} seeds the branch from the descriptor`,
          G.g_script_branch_var === 0, String(G.g_script_branch_var));
    hitAndTick(p);
    check(`...and the first shot writes 1 - the descriptor`,
          G.g_script_branch_var === 1, String(G.g_script_branch_var));

    propScene(rng, GameMode.Arcade);
    const q = genericProp(type, 1);
    check(`...so a descriptor of 1 defaults the other way`,
          G.g_script_branch_var === 1, String(G.g_script_branch_var));
    hitAndTick(q);
    check(`...and its shot writes 0`,
          G.g_script_branch_var === 0, String(G.g_script_branch_var));
  }

  // Type 25 has a block gate, and it is the difference between it and the two
  // above. Its one shipped spawn stands in block 0x17 and nowhere else.
  {
    propScene(rng, GameMode.Arcade);
    const p = genericProp(0x19, 0);
    G.g_evt_block_index = 0x16;
    hitAndTick(p);
    check("type 25 in the wrong block writes nothing",
          G.g_script_branch_var === 0, String(G.g_script_branch_var));
    G.g_evt_block_index = 0x17;
    hitAndTick(p);
    check("...and in block 0x17 it writes 1",
          G.g_script_branch_var === 1, String(G.g_script_branch_var));
  }

  // Type 40 takes BOTH of its sub-kind-9 pair, and the counter that agrees
  // them is a global rather than a field.
  {
    propScene(rng);
    const pair = PlaceFragmentProps({ at: 0x2000, container: "fragment",
                                      sub_kind: 9, lifetime_evt_steps: 9,
                                      pos: [0, 0, 0] });
    G.g_breakable_props.push(...pair);
    check("the sub-kind 9 placement builds two, from g_class41_fragment_counts",
          pair.length === 2, String(pair.length));
    check("...and zeroes the shared counter",
          G.g_branch_prop_shot_count === 0,
          String(G.g_branch_prop_shot_count));
    G.g_script_flags[0x11] = 1;
    hitAndTick(pair[0]);
    check("one of the pair is not enough", G.g_script_branch_var === 0,
          `var ${G.g_script_branch_var} count ${G.g_branch_prop_shot_count}`);
    hitAndTick(pair[1]);
    // The count is tested at the top of the routine and the hit at the bottom,
    // so the route opens on the frame AFTER the second break.
    BreakablePropPoolUpdate(rng);
    check("...and both of them are", G.g_script_branch_var === 2,
          `var ${G.g_script_branch_var} count ${G.g_branch_prop_shot_count}`);
    check("...and the counter latches at -1 so it opens once",
          G.g_branch_prop_shot_count === -1,
          String(G.g_branch_prop_shot_count));
  }

  // The chain: twenty links, one latch, and it lives on segment 0.
  {
    propScene(rng);
    G.g_evt_block_index = 0x16;
    const links = PlaceChainSegments({ at: 0x3000, container: "chain",
                                       chain_group: 1, lifetime_evt_steps: 9,
                                       pos: [0, 0, 0] });
    G.g_breakable_props.push(...links);
    check("a chain is twenty segments", links.length === 0x14,
          String(links.length));
    hitAndTick(links[7]);
    check("shooting any link opens the route", G.g_script_branch_var === 2,
          String(G.g_script_branch_var));
    G.g_script_branch_var = 0;
    hitAndTick(links[3]);
    check("...and a second link does not, because the latch is segment 0's",
          G.g_script_branch_var === 0, String(G.g_script_branch_var));
  }

  // ...and the chain's trigger group is not built at all in arcade.
  {
    propScene(rng, GameMode.Arcade);
    const links = PlaceChainSegments({ at: 0x3000, container: "chain",
                                       chain_group: 1, lifetime_evt_steps: 9,
                                       pos: [0, 0, 0] });
    check("arcade never builds chain group 1", links.length === 0,
          String(links.length));
    const other = PlaceChainSegments({ at: 0x3001, container: "chain",
                                       chain_group: 0, lifetime_evt_steps: 9,
                                       pos: [0, 0, 0] });
    check("...but it builds the others", other.length === 0x14,
          String(other.length));
  }

  // The story-mode switch: a scene-and-block table, a script flag, and a key.
  {
    propScene(rng);
    G.g_scene_index = 1;
    G.g_evt_block_index = 3;
    const sw = PlaceStoryModeSwitch({ at: 0x4000, container: "story_switch",
                                      lifetime_evt_steps: 1, branch_flag: 114,
                                      remove_flag: 62, keys: [-1, -1, -1, -1],
                                      pos: [0, 0, 0] });
    G.g_breakable_props.push(sw);
    hitAndTick(sw);
    check("the switch opens scene 1 block 3", G.g_script_branch_var === 2,
          String(G.g_script_branch_var));
    G.g_script_branch_var = 0;
    BreakablePropPoolUpdate(rng);
    check("...once: `+0x2A0` goes to -1 with the route",
          G.g_script_branch_var === 0 && sw.storyItem === -1,
          `var ${G.g_script_branch_var} flag ${sw.storyItem}`);

    propScene(rng);
    G.g_scene_index = 1;
    G.g_evt_block_index = 2;                       // not in the table
    const sw2 = PlaceStoryModeSwitch({ at: 0x4001, container: "story_switch",
                                       lifetime_evt_steps: 1, branch_flag: 114,
                                       remove_flag: 62, keys: [-1, -1, -1, -1],
                                       pos: [0, 0, 0] });
    G.g_breakable_props.push(sw2);
    hitAndTick(sw2);
    check("...and a block the table does not name writes nothing",
          G.g_script_branch_var === 0, String(G.g_script_branch_var));

    // A switch that names a key is not thrown by a shot alone.
    propScene(rng);
    G.g_scene_index = 1;
    G.g_evt_block_index = 3;
    const keyed = PlaceStoryModeSwitch({ at: 0x4002, container: "story_switch",
                                        lifetime_evt_steps: 1,
                                        branch_flag: 115, remove_flag: 116,
                                        keys: [0, 2, 5, 6], pos: [0, 0, 0] });
    G.g_breakable_props.push(keyed);
    hitAndTick(keyed);
    check("a keyed switch refuses a player carrying nothing",
          G.g_script_branch_var === 0, String(G.g_script_branch_var));
    G.g_original_item_slots[0] = [5, -1];
    hitAndTick(keyed);
    check("...and opens for one carrying item 5", G.g_script_branch_var === 2,
          String(G.g_script_branch_var));
  }

  // The switch's own removal flag, which is its lifetime -- `+0x11C` is a
  // literal 1 for this object and counting against it would retire every
  // switch in the game one step boundary after it was placed.
  {
    propScene(rng);
    G.g_scene_index = 1;
    const sw = PlaceStoryModeSwitch({ at: 0x4003, container: "story_switch",
                                      lifetime_evt_steps: 1, branch_flag: 114,
                                      remove_flag: 62, keys: [-1, -1, -1, -1],
                                      pos: [0, 0, 0] });
    G.g_breakable_props.push(sw);
    G.g_evt_step_index += 1;
    BreakablePropPoolUpdate(rng);
    BreakablePropPoolUpdate(rng);
    check("a step boundary does not retire a story switch", !sw.dead);
    G.g_script_flags[62] = 1;
    BreakablePropPoolUpdate(rng);
    check("...its own removal flag does", sw.dead);
  }

  // `g_script_flags[0x15]`, which the switch's HEAD raises -- `0x00474FA6`,
  // before the `CMP g_GameMode, 1` at `0x00474FB4`. Stage 3's block 2 step 3
  // is `wait_script_flag 0x15` and on the block-7 -> block-8 route nothing
  // else in the stage sets it, so with this write missing the stage parked on
  // that instruction for ever. Every arm of the engine's `if`/`else if` is
  // here, because the one that made the bug invisible is the `else`.
  {
    const [SCENE, BLOCK] = STORY_SWITCH_FLAG_AT;
    const flag = () => G.g_script_flags[STORY_SWITCH_SCRIPT_FLAG] ?? 0;
    /** Stage 3's own switch: evt `0x3630`, removal flag 22, keyed on 0 and 6. */
    const place = () => {
      const p = PlaceStoryModeSwitch({
        at: 0x4004, container: "story_switch", lifetime_evt_steps: 1,
        branch_flag: -1, remove_flag: 22, keys: [0, 0, 6, 6],
        pos: [0, 0, 0] });
      G.g_breakable_props.push(p);
      return p;
    };

    propScene(rng, GameMode.Arcade);
    G.g_scene_index = SCENE;
    G.g_evt_block_index = BLOCK;
    const sw = place();
    check("the switch's flag is down before its first frame", flag() === 0);
    BreakablePropPoolUpdate(rng);
    check("in scene 2 block 2 the switch raises g_script_flags[0x15] "
          + "IN ARCADE -- the write is before the mode gate",
          flag() === 1, String(flag()));
    check("...and it is still standing: this is the head, not a despawn",
          !sw.dead);

    // The mode gate is below the write, so Original Mode raises it too.
    propScene(rng, GameMode.Original);
    G.g_scene_index = SCENE;
    G.g_evt_block_index = BLOCK;
    place();
    BreakablePropPoolUpdate(rng);
    check("...and in Original Mode as well", flag() === 1, String(flag()));

    // `g_evt_block_index == 2` is the whole of the block test; the switch
    // stands in stage 3's blocks 7 and 8 first and must write nothing there.
    propScene(rng, GameMode.Arcade);
    G.g_scene_index = SCENE;
    G.g_evt_block_index = 8;
    place();
    BreakablePropPoolUpdate(rng);
    check("a block the head does not name raises nothing", flag() === 0,
          String(flag()));

    // The `else`: scene 1 takes the despawn arm and never reaches the write,
    // which is why five of the twelve switches in the game are in blocks that
    // would otherwise match.
    propScene(rng, GameMode.Arcade);
    G.g_scene_index = 1;
    G.g_evt_block_index = BLOCK;
    place();
    BreakablePropPoolUpdate(rng);
    check("scene 1 is the OTHER arm of the same `if` and raises nothing",
          flag() === 0, String(flag()));

    // `obj+0x192 == 0` -- unthrown. A thrown switch hands the flag to the
    // second write, behind the mode gate and the item spawn, which is not
    // ported: see `StoryModeSwitchUpdate`.
    propScene(rng, GameMode.Arcade);
    G.g_scene_index = SCENE;
    G.g_evt_block_index = BLOCK;
    const thrown = place();
    thrown.branchLatched = true;
    BreakablePropPoolUpdate(rng);
    check("a thrown switch stops raising it", flag() === 0, String(flag()));

    // ...and the removal flag still wins, because it is tested first.
    propScene(rng, GameMode.Arcade);
    G.g_scene_index = SCENE;
    G.g_evt_block_index = BLOCK;
    const gone = place();
    G.g_script_flags[22] = 1;
    BreakablePropPoolUpdate(rng);
    check("its removal flag is tested BEFORE the write, and takes it away",
          gone.dead && flag() === 0, `${gone.dead} / ${flag()}`);
  }

  // Original Mode only, every one of them. Arcade reaches types 14, 19 and 25
  // and nothing else in this file.
  {
    propScene(rng, GameMode.Arcade);
    G.g_evt_block_index = 9;
    const p = genericProp(0x38, 0);
    G.g_script_flags[0x05] = 1;
    hitAndTick(p);
    check("type 56 writes nothing in arcade", G.g_script_branch_var === 0,
          String(G.g_script_branch_var));

    propScene(rng);
    G.g_evt_block_index = 9;
    const q = genericProp(0x38, 0);
    G.g_script_flags[0x05] = 1;
    hitAndTick(q);
    check("...and 2 in original mode, on the flag rather than the shot",
          G.g_script_branch_var === 2, String(G.g_script_branch_var));
  }
}
