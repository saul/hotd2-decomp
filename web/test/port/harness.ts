/**
 * What the area files of `test/port/` share: `check` and the failure count it
 * keeps, and every fixture or helper that more than one area uses. `index.ts`
 * describes the layout and runs the areas in order.
 */
import type {
  ApproachJson, CharactersJson, CharacterType, PlayerDamageJson, TrackingJson,
} from "../../src/bundle";
import { Rng } from "../../src/core/rng";
import { Events } from "../../src/core/events";
import { ActorSpawn, GameUpdate } from "../../src/game/director";
import {
  CamBlockSetAnglesFromLookAt, CameraPoseBlock,
} from "../../src/game/camera/path";
import { EvtActionHandler } from "../../src/game/camera/driver";
import { CameraActorTick, CameraUpdateTick } from "../../src/game/camera/actor";
import { UpdateSceneViewAndLight } from "../../src/game/camera/view";
import { EvtEnterSceneState } from "../../src/game/camera/hooks";
import {
  RegisterForShotTest, ShotTestListReset,
} from "../../src/game/combat/shot_test";
import { PadBit, PlayerTasksRun } from "../../src/game/player_shell";
import { RunSceneTasksAndTimers } from "../../src/game/run_phase";
import { ActorByAt, G, ResetGameGlobals } from "../../src/game/globals";
import { NULL_HOST } from "../../src/game/host";
import { SetGameTables } from "../../src/game/tables";
import { ColiPublishDynamicList } from "../../src/game/coli";
import {
  ActorUpdateBoundingSphere, type Actor, type ZombieActor,
} from "../../src/game/actor";
import { type ClassFrame } from "../../src/game/registry";
import { SpawnClass } from "../../src/game/spawn_class";
import { GameMode } from "../../src/game/game_mode";
import { vec3, type Vec3 } from "../../src/game/vec";
import { EffectCode } from "../../src/game/combat/resolve_hit";
import type { BreakablesJson } from "../../src/bundle";
import { Walker } from "../../src/script/walker";
import { ShutterState } from "../../src/game/hud_shutter";
import {
  BreakablePropTakeShot, BreakablePropUpdate,
} from "../../src/game/class41";
import { type HumanoidProgram } from "../../src/game/class25";
import { CamPaths } from "../../src/game/camera/curve";
import { SetCameraPaths } from "../../src/game/tables";

export let failures = 0;
export function check(name: string, ok: boolean, detail = ""): void {
  if (ok) {
    console.log(`  ok    ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`);
  }
}

// -- a stage's worth of tables, small enough to reason about ----------------

/**
 * A clip. `perFrame` is root translation along the clip's own -Z, which is
 * what actually walks a zombie: the run carries 1.289 units a frame on the
 * real data, the walk carries nothing.
 */
export const motion = (frames: number, perFrame = 0, play?: number) => ({
  bank: "t", frames, fps: 30,
  root: Array.from({ length: frames * 3 },
                   (_, i) => (i % 3 === 2 ? -perFrame * Math.floor(i / 3) : 0)),
  rot: [],
  // `g_motion_play_length`, when the fixture wants to pin it. The real table
  // is `2n - 2` for some motions and `2n - 3` for others, so a clip that
  // carries the odd one is the only thing that can tell "read the bundle"
  // apart from "derive it from the frame count".
  ...(play === undefined ? {} : { play }),
});

export const TYPE: CharacterType = {
  type: 1, name: "test zombie", file: "t.bin", bone_count: 16,
  actor_radius: 10,
  // Two bones, upper arm and forearm, with the forearm parented to it: enough
  // for the sever cascade, which is the part that used to leave a limb
  // animating below a destroyed one.
  bones: [
    { bone: 4, part: "r_upperarm", slot: 4, offset: [0, 0, 0], parent: null,
      damage_rank: [], hit_radius: 2, hit_slot: 4,
      steps: [[0x11, EffectCode.Escalate, 3], [0x12, EffectCode.Escalate + 1, 3],
              [0x13, EffectCode.Escalate + 2, 3], [0x14, EffectCode.Sever, 3]] },
    { bone: 5, part: "r_forearm", slot: 5, offset: [0, 0, 0], parent: 0,
      damage_rank: [], hit_radius: 2, hit_slot: 5, steps: [] },
    { bone: 1, part: "torso", slot: 1, offset: [0, 0, 0], parent: null,
      damage_rank: [], hit_radius: 3, hit_slot: 1,
      steps: [[0x21, EffectCode.Last, 3]] },
    // Bone 2 is the head -- `ResolveHit` compares the shot bone with an
    // immediate 2 -- and this table used not to have it, so anything that
    // reads the head's *own* record -- the model the severed head flies with,
    // for one -- had nothing to find. No steps: a head hit here is a plain
    // hit, which is what the headshot-burst assertions want.
    // No `steps`, so a head hit here is a plain hit that swaps nothing --
    // which is the case the severed head has to work in, since `boneSlot` only
    // has an entry once something has been swapped. The damage comes from
    // `damage_rank`, which `DamageRankModifier` indexes with `g_damage_rank`.
    { bone: 2, part: "head", slot: 0x30, offset: [0, 0, 0], parent: null,
      damage_rank: new Array(16).fill(5), hit_radius: 2, hit_slot: 0x30,
      steps: [] },
  ],
  // Two vertex-blended parts -- a waist and a skirt, as the humanoids with a
  // skirt carry -- so that `model+0x3C` is 2 and "part 0 alone" and "every
  // part" are different answers. `ActorBuildSkinnedModel` sizes
  // `Actor.partVisible` from this list's length.
  parts: [
    { slot: 0x40, draw_bone: 1, bones: [1, null, null, null], deformed: [0],
      rows: 1, supported: true },
    { slot: 0x41, draw_bone: 1, bones: [1, null, null, null], deformed: [0],
      rows: 1, supported: true },
  ],
  // Two rows, because the engine picks one with `obj+0x130C` — the shipped
  // characters carry a second set at body condition 3 (motions 257-263) and
  // the port used to read row 0 for every actor.
  reactions: { "0": [960, 961, 974, 979, 981, 982, 977],
               "3": [257, 258, 259, 260, 261, 262, 263] },
  attacks: {
    "0": {
      // `distance` is deliberately just *outside* the inner ring, as the real
      // tables have it -- `char_adv00`'s two attacks name 26.0 and 25.0
      // against a ring of 25. That is what makes an actor arriving from the
      // hold already inside it, so the swing starts on the ring and the
      // retreat ends exactly back at the spot it started from. A fixture with
      // the distance *inside* the ring instead makes the retreat overshoot its
      // own anchor and turn round, which is a property of the fixture and not
      // of the port.
      "1": {
        strike: 100, lunge: 101, distance: 26, hit_frame: 10,
        overlay_kind: 7, cancel_mask: 8,
      },
    },
    // The throw entries: index 0 is bone 5's and index 1 is bone 8's, and the
    // range is a throw's rather than a reach's.
    "7": {
      "0": { strike: 102, lunge: 101, distance: 99, hit_frame: 8,
             overlay_kind: 4, cancel_mask: 2 },
      "1": { strike: 103, lunge: 101, distance: 99, hit_frame: 8,
             overlay_kind: 4, cancel_mask: 4 },
    },
    "8": {
      "0": { strike: 102, lunge: 101, distance: 99, hit_frame: 8,
             overlay_kind: 4, cancel_mask: 2 },
      "1": { strike: 103, lunge: 101, distance: 99, hit_frame: 8,
             overlay_kind: 4, cancel_mask: 4 },
    },
  },
  attack_picks: { "0": new Array(80).fill(1) },
  throw: null,
  // The stationary thrower's kit. Body conditions 7 and 8 index the same two
  // attack entries, one per hand, exactly as `tutorial.bin`'s do; the hand
  // slots are what `ZombieArmedHands` compares the live draw slots against.
  zombie_throw: {
    hands: [
      { bone: 5, held: 7886, bare: 7883, weapon_bone: 6, projectile: 585 },
      { bone: 8, held: 7882, bare: 7879, weapon_bone: 9, projectile: 585 },
    ],
    straight: true, speed: 1, speed_standing: 1.5, aim_ahead: 4,
    aim_side: 0.6, aim_drop: 1.5, arc_gravity: 0.009, hit_kind: 4,
    stick_frames: 30, blink_frames: 60,
  },
  motion_row: { "0": [10, 10, 12, 12, 14], "7": [10, 10, 12, 12, 14],
                "8": [10, 10, 12, 12, 14] },
  backoff_index: 4,
  gore: {}, torso_stages: 3,
  motions: {
    // 10 the in-place walk and idle, 12 the run that closes, 14 the retreat.
    "10": motion(20, 0, 37), "12": motion(16, 1.289), "14": motion(36, -0.429),
    // 101 the lunge, which carries the actor the last few units into range.
    // The bite, scaled like the real one: `char_adv00`'s runs to -15.55 net
    // against a 25-unit inner ring, so the recover is most of the ring and the
    // retreat that walks it back is the pause between bites.
    "100": motion(20, 0.8), "101": motion(20, 0.6),
    // The two throw clips, which carry no root motion at all --
    // `tutorial.bin`'s net exactly zero.
    "102": motion(24), "103": motion(20),
    // 185 (0xB9) is the pose `ZombieStateEmerge` holds while it waits.
    "185": motion(4),
    // 300 (0x12C) is `ThrowerStateLeapToPoint`'s clip, cut into a windup, a
    // flight and a landing by the `drop` arc script. It has to be baked for
    // the type or the state has no clip frame to measure its stages against,
    // and an unbaked stage is an actor that hangs in the window for ever.
    "300": motion(50),
    // 439 (0x1B7) is the same, for `zskamere`.
    "439": motion(22),
    // 988 (0x3DC) is class 0x20's death clip -- `OneHitTargetUpdate` names it
    // by id. Deliberately shorter than the 120-frame sink that follows, which
    // is the shape the "plays its death animation twice" report is about:
    // char_adv00's real one is 82 frames against the same 120.
    "988": motion(30),
    // 923 (0x39B), the van jump-out `ZombieStateMotionCue21` plays: 41 frames
    // against a play length of 79, carrying 13.6 units of root translation.
    // The odd play length is the point of pinning it -- the cue this state
    // exits on is expressed in the play clock, not in authored frames.
    "923": motion(41, 0.332, 79),
    "900": motion(30), "901": motion(30), "902": motion(30), "903": motion(30),
    // 991 (0x3DF) and 992 (0x3E0), the two side deaths
    // `ChooseDeathMotionDirectional` names by literal for the 0xC000 and
    // 0x4000 arcs. The shipped banks carry them beside the two tables, and a
    // fixture without them had half the circle falling to no clip at all.
    "991": motion(30), "992": motion(30),
    "960": motion(39), "961": motion(39), "974": motion(29), "977": motion(29),
    "979": motion(29), "981": motion(29), "982": motion(29),
    // ...and the second stumble row, the one body condition 3 selects: 43
    // frames rather than 29, which is how the two are told apart on screen.
    "257": motion(43), "258": motion(43), "259": motion(43), "260": motion(43),
    "261": motion(43), "262": motion(43), "263": motion(43),
    // The twelve entrance states' clips. 184 (0xB8) is the surfacing clip
    // whose two splash cursors are 0x15 and 0x1B, so its play length has to
    // reach past both; 186/187 (0xBA/0xBB) the scripted grab's pair; 700 a
    // plain held clip; 1009/1010 the scripted attacker's strike and idle.
    "184": motion(20, 0, 45), "186": motion(24), "187": motion(24),
    "700": motion(18), "1009": motion(20, 0, 41), "1010": motion(16),
    // 984 (0x3D8) is the surfacing clip for every character type outside
    // 0xF..0x11, which is the one this file's type 1 takes.
    "984": motion(24, 0, 47),
    // State 26's clips: 955 (0x3BB) the jump, and 1015 (0x3F7) the limp of a
    // corpse shot out of the air -- which is not a landing animation.
    "955": motion(30), "1015": motion(20),
    // The death of an actor still holding something: 1017 (0x3F9) is what
    // `ChooseDeathMotion` gives it and 1016 (0x3F8) the clip
    // `ZombieStateDeathFallAndBounce` cuts to when the body lands.
    //
    // Both carry their **real** shape from `zom.bin` and their real
    // `g_motion_play_length`, and 1017's 85 is the load-bearing half: state 12
    // sub 1 is `if (obj+0x19C < 0x3C) return;`, a literal 60 measured against
    // that play clock. A fixture that left `play` to be derived from the frame
    // count would pass on a bundle that got it wrong, and the whole of
    // stage 3 block 2's hang is an actor that never reached 60.
    "1017": motion(44, 0, 85), "1016": motion(36, 0, 69),
    // 987 (0x3DB) is the clip `ChooseDeathMotion` gives body conditions 5 and
    // 6 — the two that die through state 9 rather than state 6.
    "987": motion(24),
    // `ZombieStateDragTarget`'s four: 420 (0x1A4) the drag, 424 (0x1A8) the
    // kill, 426 (0x1AA) the aftermath when the civilian is already dead, and
    // 432 (0x1B0) the settle. Sub 2 waits for play cursor 0x2D on **whichever
    // of the two kill clips sub 1 started**, not on 432 — so it is 424 and 426
    // whose play lengths have to reach past 45.
    "420": motion(20, 0, 30), "424": motion(32, 0, 60),
    "426": motion(32, 0, 60), "432": motion(30, 0, 60),
  },
};

export const APPROACH: ApproachJson = {
  rings: [{ inner: 25, mid: 38, outer: 51 }],
};

// Four curves, because `TURN_CURVE_DEFAULT` selects the second one — the
// fixture used to carry one and say `curve: 0`, which it could do only while
// the number it was indexing with travelled beside it.
export const TRACKING: TrackingJson = {
  curves: [0, 1, 2, 3].map(() => new Array(64).fill(16)),
};

export const PLAYER: PlayerDamageJson = { start_lives: 2 };

/** One stage's `characters` block, with only what the port reads filled in. */
export const CHARS = {
  types: { "1": TYPE },
  approach: APPROACH,
  tracking: TRACKING,
  player: PLAYER,
  placements: [],
  // Bone -> damage zone: 4 and 5 are the right arm, bit 1.
  bone_zones: [0xff, 0xff, 0, 0xff, 1, 1],
  // Bone -> reaction group, which picks the stumble within the row.
  reaction_groups: [0, 1, 0, 1, 2, 2],
  deaths: { front: [900], back: [901] },
  difficulty: {
    hp_delta: [0, 0, 0, 0, 0], hp_min: 1, hp_max: 300,
    initial_rank: [0, 0, 2, 0, 0],
  },
  combat: undefined,
  note: "",
} as unknown as CharactersJson;

/**
 * The scene state's major while a stage is being played — the `cam/` path
 * camera row. `IsPlayerAttackable` (`FUN_00409DC0`) demands it before anything
 * may claim an attack permit, and in the player it arrives every frame from
 * the walker through `syncPortGlobals`. A fixture has no walker, so it has to
 * say so itself; leaving it at 0 is a scripted cutscene, in which nothing
 * attacks.
 */
export { ORIGINAL_MODE } from "./original_mode_fixture";

export const SCENE_MAJOR_PLAYING = 2;

export const EYE = vec3(0, 0, 0);

/**
 * A still camera, driven by the camera's own routines: camera block 0's eye
 * -- the lens -- at `lens`, and scene state (2, 4) entered through
 * `EvtEnterSceneState`, whose hook (`CameraSnapToPathEye`, then
 * `CameraHoldEyeTick` every frame) writes the gameplay eye `g_camera_eye`
 * fifteen under it from each frame's `CameraUpdateTick`. So a test driven by
 * `GameUpdate` sees the two eyes the engine has, fifteen apart, and a routine
 * that reads the wrong one shows it. Nothing here writes `g_camera_eye`.
 */
export function HoldCameraAt(lens: Vec3): void {
  G.g_camera_block_eye = vec3(lens.x, lens.y, lens.z);
  G.g_camera_use_fixed_y = 0;
  EvtEnterSceneState(2, 4);
}

/**
 * One frame with no camera, for the node draw hooks: `ActorRunNodeDrawHooks`
 * hands each hook the frame, because the head aim both combat hooks run reads
 * the camera. With `NULL_HOST` there is none, so the aim holds and every
 * other arm of the hook runs as it did.
 */
export const DRAW_FRAME: ClassFrame = {
  dt: 1 / 60, rng: new Rng(1), host: NULL_HOST,
};

/**
 * `ActorSpawn` narrowed to class 0x30.
 *
 * Narrowing, not a cast, and the same proof the director makes: `makeActor`
 * picks the arm from `cls`, so a fixture that wants to drive class 0x30's
 * states has to establish the class rather than assert it. The `throw` is
 * unreachable, and that is the point — a cast here would be the one place the
 * union could be lied to.
 */
export function spawnZombie(at: number, charType: number, name: string,
                     desc?: Partial<Actor>, rng?: Rng): ZombieActor {
  const a = ActorSpawn(at, SpawnClass.Zombie, charType, name, desc, rng);
  if (a.cls !== SpawnClass.Zombie) throw new Error("not class 0x30");
  return a;
}

/**
 * What the crowd push can see, set up the way two frames of the engine leave
 * it: each actor files its sphere with `RegisterForShotTest` (`FUN_00405160`),
 * as its update's `ActorRegisterCameraPoint` does, and `ColiPublishDynamicList`
 * (`FUN_00405360`) copies the list at the head of the next frame.
 * `ColiTestSphereAgainstActors` reads nothing else -- an actor not passed here
 * is not there. A class-0x30 sphere is rebuilt first, as that class's own push
 * leaves it; any other class's is taken as it stands.
 */
export function PublishCrowd(...actors: Actor[]): void {
  ShotTestListReset();
  for (const a of actors) {
    if (a.cls === SpawnClass.Zombie) ActorUpdateBoundingSphere(a);
    RegisterForShotTest(a, NULL_HOST);
  }
  ColiPublishDynamicList();
  ShotTestListReset();
}

/**
 * A scene whose script has opened the shutter: the firing gate up and the
 * letterbox settled open.
 *
 * `g_nFiringGate` — `0x009C8E00`. `ResetSceneOnEnter` leaves it **down**, with
 * the shutter shut in state 5, and the stage script opens it with
 * `hud_shutter_state` 1 or 6; there is no script in this file, so this stands
 * in for one. Without it every shot here would be dropped by
 * `ProcessShotRequests`, which is the behaviour the firing-gate section below
 * exists to prove. **Both words**, because `HudDrawShutterState` runs in every
 * `GameUpdate`: a gate raised by hand over a state-5 shutter is put back down
 * on the first frame, as the engine's would be.
 */
export function openShutter(): void {
  G.g_nFiringGate = 1;
  G.g_bHudShutterState = G.g_bHudShutterPrev = ShutterState.Open;
}

export function scene(n: number, rng: Rng): Events {
  ResetGameGlobals();
  SetGameTables(CHARS);
  G.g_scene_state_major_entered = SCENE_MAJOR_PLAYING;
  G.g_scene_state_major = SCENE_MAJOR_PLAYING;
  EnterPlay();
  openShutter();
  // The camera driver a shot installs. There is no script in this file, so
  // these two lines stand in for the `finish_sequence` that would have run:
  // its driver in the action slot, and the ring told the slot is still busy
  // (`g_evt_action_advance = 0`), which is what keeps `EvtRunQueuedActions`
  // from parking it. With no driver installed the camera actor does nothing
  // at all, which is the engine's bare `RET` and not a camera. Minor 4 is the
  // commonest of the three starters.
  G.g_evt_action_handler = EvtActionHandler.SelectMode;
  G.g_evt_action_advance = 0;
  for (let i = 0; i < n; i++) {
    const a = spawnZombie(0x1000 + i, 1, `zombie ${i}`);
    a.visible = true;
    a.attackState = 1;
    a.hp = 10;
    a.pos = vec3(-20 + i * 20, 0, 45 + i * 10);
    a.motion = 10;
  }
  void rng;
  return new Events();
}

/**
 * One frame for a walker with no object pool: the interpreter, then the
 * camera's two tasks, as `SceneTaskWalk` runs them at the head of
 * `GameUpdate`. `queue_event` only pushes; the actions run in the camera
 * actor.
 */
export function WalkerCameraFrame(w: Walker): void {
  w.tick(1 / 60);
  CameraActorTick();
  CameraUpdateTick();
}

/** A `cp_` path standing still: the same eye and target at every frame. */
export function StillPath(slot: number, eye: Vec3, target: Vec3): CamPaths {
  const k = (v: number) => [[0, v, 0, 0], [10000, v, 0, 0]];
  return new CamPaths({ fps: 60, object_paths: {}, paths: { [slot]: {
    file: "cp_test", index: 0, start: 0, duration: 10000,
    channels: { eye_x: k(eye.x), eye_y: k(eye.y), eye_z: k(eye.z),
                target_x: k(target.x), target_y: k(target.y),
                target_z: k(target.z) } } } } as never);
}

/**
 * Put the camera on a still shot: the path the hand-back evaluates, the
 * camera block, and the deferred pose the tracking tick eases the eye onto
 * and falls back to -- what a stashed rail standing on that frame leaves --
 * then the view built from the block. There is no script in these fixtures,
 * so this stands in for the `cam_play` and the rail.
 */
export function SeatCamera(eye: Vec3, target: Vec3, slot = 900): void {
  SetCameraPaths(StillPath(slot, eye, target));
  G.g_active_cam_path = slot;
  G.g_camera_block_eye = vec3(eye.x, eye.y, eye.z);
  G.g_camera_block_target = vec3(target.x, target.y, target.z);
  G.g_cam_path_eye = vec3(eye.x, eye.y, eye.z);
  G.g_cam_path_target = vec3(target.x, target.y, target.z);
  CamBlockSetAnglesFromLookAt(CameraPoseBlock.Camera, G.g_camera_block_target,
                              0);
  CamBlockSetAnglesFromLookAt(CameraPoseBlock.Path, G.g_cam_path_target, 0);
  UpdateSceneViewAndLight();
}

/** Whether camera slot table holds actor `at` (its occupied byte up). */
export const slotHolds = (at: number): boolean => G.g_enemy_slots.some(
  (x) => x.occupied === 1 && x.prop === null && x.at === at);
/** The occupied slots, for a failure message. */
export const slotsShown = (): string => G.g_enemy_slots
  .map((x, i) => x.occupied ? `${i}:${x.prop ?? x.at.toString(16)}` : "")
  .filter(Boolean).join(",");

/**
 * The scene's first task turn for the players, which is where the start press
 * the reset made becomes a player in play: state 0's handler is
 * `PlayerEnterPlay(0)`. Then the 90 frames of invulnerability it opens, run
 * out through the routine that counts them (`RunSceneTasksAndTimers`), so a
 * test can be hit on its first frame. Nothing here is set by hand (L49).
 */
export function EnterPlay(): void {
  PlayerTasksRun({ host: NULL_HOST, rng: new Rng(1) });
  RunOutInvulnerability();
}

/**
 * Player 2 presses START in the middle of the game: state 9's poll sees it,
 * a credit goes, and state 3's handler is `PlayerEnterPlay(3)` -- which counts
 * the second player and the second attacker. The ported routines, in order.
 */
export function JoinPlayerTwo(): void {
  G.g_pad_state = PadBit.Start1;
  PlayerTasksRun({ host: NULL_HOST, rng: new Rng(1) });
  G.g_pad_state = 0;
  PlayerTasksRun({ host: NULL_HOST, rng: new Rng(1) });
  RunOutInvulnerability();
}

/** Both players' invulnerability, counted down by the engine's own timer. */
export function RunOutInvulnerability(): void {
  while (G.g_player_invuln_frames[0] > 0 || G.g_player_invuln_frames[1] > 0) {
    RunSceneTasksAndTimers(() => {});
  }
}

export function run(frames: number, rng: Rng, events: Events): void {
  for (let i = 0; i < frames; i++) GameUpdate(1 / 60, NULL_HOST, rng, events);
}


// -- 8. class 0x41, the breakable-prop / item-container placer --------------
//
// Two groups' worth of members, shaped like the real ones: a two-high stack
// whose top member is held up by the bottom one, and a three-member item set.
// The hull is a single point under the origin, which is enough to make
// `BreakablePropGroundContact` fire the moment a faller drops below the floor.

export const BREAKABLES: BreakablesJson = {
  groups: [
    // group 0: a stack. Member 1 stands on member 0.
    [
      { index: 0, x: 0, z: 0, item_set: 0, story_item: -1, level: 0,
        y_offset: 0, supports: [] },
      { index: 1, x: 0, z: 0, item_set: 0, story_item: -1, level: 1,
        y_offset: 7.540296, supports: [0] },
    ],
    // group 1: three props sharing item set 2, all on the ground.
    [
      { index: 0, x: 10, z: 0, item_set: 2, story_item: -1, level: 0,
        y_offset: 0, supports: [] },
      { index: 1, x: 20, z: 0, item_set: 2, story_item: -1, level: 0,
        y_offset: 0, supports: [] },
      { index: 2, x: 30, z: 0, item_set: 2, story_item: -1, level: 0,
        y_offset: 0, supports: [] },
    ],
    // group 2: one prop hiding the extra life.
    [
      { index: 0, x: 40, z: 0, item_set: 1, story_item: -1, level: 0,
        y_offset: 0, supports: [] },
    ],
    // group 3: none here.
    [],
    // group 4: the group the player cannot break and the script can -- a
    // two-high stack, like group 0's.
    [
      { index: 0, x: 60, z: 0, item_set: 0, story_item: -1, level: 0,
        y_offset: 0, supports: [] },
      { index: 1, x: 60, z: 0, item_set: 0, story_item: -1, level: 1,
        y_offset: 7.540296, supports: [0] },
    ],
  ],
  // Four corners of a box. A single point is not enough: the settle picks the
  // *lowest corner that is not the current one*, so a one-point hull can never
  // re-seat and the object sinks to wherever the fall left it.
  hull: [[-1, 0, -1], [1, 0, -1], [1, 0, 1], [-1, 0, 1]],
  falling_hull: [[-1, 0, -1], [1, 0, -1], [1, 0, 1], [-1, 0, 1]],
  fragment_hull: [[-1, 0, -1], [1, 0, -1], [1, 0, 1], [-1, 0, 1]],
  // The exe's own four tables, as `ExeTables.shatterPieces` reads them: the
  // fifteen slots of each, and each piece's prop-local offset and angles.
  shatter: {
    slots_a: [0x19ea, 0x19f1, 0x19f2, 0x19f5, 0x19f6, 0x19f7, 0x19eb, 0x19ec,
              0x19ed, 0x19ee, 0x19ef, 0x19f0, 0x19f8, 0x19f4, 0x19f3],
    slots_b: [0x1a11, 0x1a18, 0x1a19, 0x1a1c, 0x1a1d, 0x1a1e, 0x1a12, 0x1a13,
              0x1a14, 0x1a15, 0x1a16, 0x1a17, 0x1a1f, 0x1a1b, 0x1a1a],
    offsets: [[327, 7540, 1391], [759, 7540, -322], [-327, 7540, -1391],
              [1530, 6538, 2111], [2207, 3446, 1756], [-1493, 6538, 2138],
              [2283, 5025, -335], [1377, 5025, -1852], [295, 5025, -2289],
              [-1852, 5025, -1377], [-2283, 5025, 335], [322, -4, 759],
              [-2060, 1934, 1508], [-290, 2862, 2878], [469, 6283, 2598]],
    angles: [[0, 1681, -32768], [-32768, 4185, 0], [0, 22892, 0],
             [-7818, -1499, 21723], [-10504, -8102, 23474],
             [12520, 25008, -9453], [104, -4854, 16337], [8865, -3339, 12797],
             [-16301, -42, 21237], [24079, 3398, 12853],
             [104, 27914, -16338], [0, -830, -32768], [8224, 641, 18803],
             [-17527, -1775, 22662], [-14423, 1669, 25123]],
  },
  // Synthetic, except for kinds 2 and 3: those two carry `g_prop_kind_params`'
  // own rows, because `PropUpdateType43` branches on the effect id and stage
  // 3's seven spawns are all one or the other. Kind 3's effect is **0**, which
  // is what sends it down the crack arm, and kind 2's is 7, which sends it
  // straight to the destroy arm -- a fixture that made every effect non-zero
  // could not tell those two paths apart.
  kinds: Array.from({ length: 11 }, (_, k) => (
    k === 2 ? { kind: 2, effect: 7, effect_variant: 469, sound: 0x1d16a9,
                radius: 6, y_offset: 6 }
      : k === 3 ? { kind: 3, effect: 0, effect_variant: 473, sound: 0x1a16a9,
                    radius: 5, y_offset: 5 }
        : { kind: k, effect: k, effect_variant: 400 + k, sound: 0x1a16a9,
            radius: 6, y_offset: 6 })),
  placements: [
    { at: 0xa100, container: "group", group: 1, lifetime_evt_steps: 4 },
    { at: 0xa200, container: "group", group: 2, lifetime_evt_steps: 6 },
    // Class 0x44 selector 0. Shaped like stage 1's `0x1580`: effect 2,
    // captured at bone 2, on motion 471.
    { at: 0xa300, container: "script_flag_effect", effect: 2,
      capture_bone: 2, motion: 471, slot: 0x13f5, lifetime_evt_steps: 0,
      pos: [-13.7748, 0, -362.302], yaw: 0 },
    // Class 0x41 type 75, shaped like the game's only one: stage 4 block 2's
    // spawn at script address 9580, whose `+0x11C` is 2 and therefore both a
    // two-step lifetime and asset slot 2.
    { at: 0xa400, container: "generic", type: 75, slot: 2,
      lifetime_evt_steps: 2, pos: [121.8, -57, -818.6],
      pitch: 0, yaw: 0, roll: 0 },
  ],
  // One effect, shaped like the real thing but four keys long: a root that
  // draws nothing, a bone-1 node that draws nothing, and the bone-2 node that
  // carries the model. `play_length` is `2n - 2`, the rule `mot.md` states.
  effects: {
    "2": {
      nodes: [
        { slot: 0, bone: 0, children: [1, 2] },
        { slot: 0, bone: 1, children: [] },
        { slot: 0x13f5, bone: 2, children: [] },
      ],
      interp: 1,
      motion: 471,
      play_length: 6,
      frames: 4,
      bones: 2,
      // Bone 1 stands still; bone 2 walks 10 units along x per key and turns
      // a quarter turn per key, so a blend is visible in both channels.
      t: [
        13, 0, -361, -13, 0, -362,
        13, 0, -361, -3, 0, -362,
        13, 0, -361, 7, 0, -362,
        13, 0, -361, 17, 0, -362,
      ],
      r: [
        0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0x4000, 0,
        0, 0, 0, 0, 0x8000, 0,
        0, 0, 0, 0, 0xc000, 0,
      ],
      cues: [1, 3],
    },
    // Effect 0x13, the breakable chair's: a root and ten pieces, each piece
    // rising one unit per key so a played clip is visible. Half rate, like
    // the shipped one's interpolation family, and four keys long.
    "19": {
      nodes: [
        { slot: 0, bone: 0, children: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
        ...Array.from({ length: 10 }, (_, i) => (
          { slot: 0x1070 + i, bone: i + 1, children: [] })),
      ],
      interp: 1,
      motion: 468,
      play_length: 6,
      frames: 4,
      bones: 10,
      t: Array.from({ length: 4 * 10 * 3 },
                    (_, j) => (j % 3 === 1 ? Math.floor(j / 30) : 0)),
      r: Array.from({ length: 4 * 10 * 3 }, () => 0),
      cues: [],
    },
  },
  level_height: 7.540296,
  // Scene 1's rows 6 and 0, and the records they name, as the EXE has them
  // (`g_original_item_tables` / `g_original_item_records`). Row 6 is the one
  // stage 2's type-72 spawn names; row 9 is synthetic -- a row whose first id
  // is -1, which is how a collectible comes to be nothing at all -- and so is
  // record 29's scale, kept at the EXE's 1.0.
  original_items: {
    scene: 1,
    rows: {
      "0": { ids: [1, 28, 14, 3], weights: [1, 2, 4, 7] },
      "6": { ids: [3, 5, 31, 21], weights: [2, 3, 4, 6] },
      "9": { ids: [-1, 29, -1, -1], weights: [4, 5, 6, 6] },
      // Rows 1 and 2: the ones types 75 and 74 hand `SpawnStoryModeItem`.
      "1": { ids: [30, 0, 17, 18], weights: [1, 4, 6, 9] },
      "2": { ids: [22, 23, 14, 15], weights: [1, 2, 4, 6] },
    },
    records: {
      "1": { slot: 0x109b, slot2: 0xffff, scale: 1, sprite: 0x5be },
      "3": { slot: 0x10a5, slot2: 0x10a6, scale: 1, sprite: 0x5c0 },
      "5": { slot: 0x10a9, slot2: 0x10aa, scale: 1, sprite: 0x5c2 },
      "14": { slot: 0x109a, slot2: 0x1098, scale: 1, sprite: 0x5c8 },
      "21": { slot: 0x1096, slot2: 0xffff, scale: 1.5, sprite: 0x5d2 },
      "28": { slot: 0x1094, slot2: 0xffff, scale: 1, sprite: 0x5d7 },
      "29": { slot: 0x109f, slot2: 0xffff, scale: 1, sprite: 0x5de },
      "31": { slot: 0x10ab, slot2: 0xffff, scale: 1, sprite: 0x5dc },
      "0": { slot: 0x109e, slot2: 0xffff, scale: 1, sprite: 0x5bd },
      "15": { slot: 0x109a, slot2: 0x1099, scale: 1, sprite: 0x5c9 },
      "17": { slot: 0x108e, slot2: 0x108d, scale: 1, sprite: 0x5cb },
      "18": { slot: 0x108e, slot2: 0x108b, scale: 1, sprite: 0x5cc },
      "22": { slot: 0x108f, slot2: 0xffff, scale: 1, sprite: 0x5d3 },
      "23": { slot: 0x1090, slot2: 0xffff, scale: 1, sprite: 0x5d4 },
      "30": { slot: 0x1097, slot2: 0xffff, scale: 1, sprite: 0x5db },
    },
  },
};
export const ORIGINAL_ITEMS_SCENE2 = {
  scene: 2,
  rows: { "0": { ids: [17, 20, 28, -1], weights: [2, 3, 4, 5] } },
  records: {
    "17": { slot: 0x108e, slot2: 0x108d, scale: 1, sprite: 0x5cb },
    "20": { slot: 0x1086, slot2: 0xffff, scale: 1.5, sprite: 0x5d1 },
    "28": { slot: 0x1094, slot2: 0xffff, scale: 1, sprite: 0x5d7 },
  },
};

/**
 * A scene for the container tests.
 *
 * The mode defaults to **Original** because that is the one in which an
 * ordinary breakable is an ordinary breakable. In **Training**,
 * `PlaceBreakableGroup` turns the members named by `g_training_lesson` into
 * one-shot targets that pay no score, and every group has at least one of
 * them — so "a prop takes two shots" is a statement about Original Mode and
 * always was. Training's rule gets its own case below.
 *
 * It said *Arcade* here while `GameMode.ARCADE` was 2, which is Training's
 * number; the case below passed for the right reason under the wrong name.
 */
export function propScene(rng: Rng, mode: GameMode = GameMode.Original): Events {
  // The mode first: the reset starts the game from the title with it.
  G.g_GameMode = mode;
  ResetGameGlobals();
  SetGameTables(CHARS, BREAKABLES);
  EnterPlay();
  G.g_camera_fixed_eye_y = 0;
  void rng;
  return new Events();
}

/** Shoot a prop `n` times, running its update after each. */
export function shoot(p: { id: number }, n: number, rng: Rng, events: Events): void {
  for (let i = 0; i < n; i++) {
    const live = G.g_breakable_props.find((q) => q.id === p.id);
    if (!live) return;
    BreakablePropTakeShot(live, 0);
    BreakablePropUpdate(live, rng, events);
  }
}

/**
 * Stage 2's jetty, run the way the page runs it: `GameUpdate` steps the clip
 * and then the class, one 60 Hz frame at a time, from `ResetGameGlobals`.
 *
 * `JETTY_TYPE` is the fixture's type 1 with the three clips the zombies play,
 * at their real shape from `zom.bin`: 977 (16 frames, play length 29), 1024
 * (91, 180) and 972 (31, 59) -- the fall back.
 */
export const JETTY_CHARS = {
  ...CHARS,
  types: { "1": { ...TYPE, motions: {
    ...TYPE.motions,
    "977": motion(16, 0, 29), "1024": motion(91, 0, 180),
    "972": motion(31, 0, 59), "805": motion(35, 0, 68), "900": motion(10, 0, 18),
  } } },
} as unknown as CharactersJson;

export function jettyScene(cmds: HumanoidProgram["cmds"], pos = vec3(-1325, -23, -1834),
                    motion0 = 1024):
    { a: Actor; rng: Rng; events: Events; frame: () => void } {
  ResetGameGlobals();
  EnterPlay();
  SetGameTables(JETTY_CHARS, undefined, undefined, { "12288": {
    charType: 1, removePath: 100, removeFrame: 65, flags2: 1,
    motion: motion0, phase: 0, cmds,
  } });
  G.g_active_cam_path = 79;
  G.g_cam_path_frame = 0;
  const rng = new Rng(4);
  const events = new Events();
  const a = ActorSpawn(0x3000, SpawnClass.ScriptedHumanoid, 1, "jetty",
                       { pos, visible: true }, rng);
  return { a, rng, events,
           frame: () => GameUpdate(1 / 60, NULL_HOST, rng, events) };
}


// -- 12. class 0x31, the wall-crawler ---------------------------------------

/**
 * `zstin`'s own tables, cut down to the rows the states read. The numbers are
 * the game's: the arc scripts and hit frames are `g_class31_melee_attacks`
 * row A verbatim, the picks are `g_class31_action_picks` set 0, and 313 is the
 * walk clip whose root motion is the only thing that closes the distance.
 */
export const ARC = (motionId: number) => [
  { motion: motionId, start: 0, fade: 5, until: 22 },
  { motion: motionId, start: 23, fade: 5, until: 46 },
  { motion: motionId, start: 47, fade: 0, until: 47 },
];

/**
 * `CLASS31_ARC_SCRIPTS.drop` and its byte-identical twin, verbatim from
 * `0x00564918`: motion 300 cut at 50..55, 56..63 and 64..98.
 */
export const DROP_SCRIPT = (motionId: number) => [
  { motion: motionId, start: 50, fade: 0, until: 55 },
  { motion: motionId, start: 56, fade: 0, until: 63 },
  { motion: motionId, start: 64, fade: 5, until: 98 },
];

/**
 * `CLASS31_ARC_SCRIPTS.wall_left` and `wall_right`, verbatim from `0x00564A68`
 * and `0x00564A38`: 0..15, 16..33 and 34..43, inside the 44 of play length a
 * 23-frame clip has. {@link ARC}'s 46 and 47 are past it, and `ActorArcStep`
 * waits on the cursor reaching them whether or not the arc has landed -- the
 * engine's cursor wraps back to 0 after 44, so the actor would wait for ever.
 */
export const WALL_SCRIPT = (motionId: number) => [
  { motion: motionId, start: 0, fade: 5, until: 15 },
  { motion: motionId, start: 16, fade: 5, until: 33 },
  { motion: motionId, start: 34, fade: 5, until: 43 },
];

/**
 * `g_class31_arc_path_style0` (`0x00565EB8`) -- motion 301 cut at 0..8, 9..17
 * and 18..23, no fades -- and `g_class31_arc_path_style1` (`0x00565E58`):
 * 301 held on frame 12 three times over, fade 1 each.
 */
export const PATH_STYLE0 = [
  { motion: 301, start: 0, fade: 0, until: 8 },
  { motion: 301, start: 9, fade: 0, until: 17 },
  { motion: 301, start: 18, fade: 0, until: 23 },
];
export const PATH_STYLE1 = [
  { motion: 301, start: 12, fade: 1, until: 12 },
  { motion: 301, start: 12, fade: 1, until: 12 },
  { motion: 301, start: 12, fade: 1, until: 12 },
];

export const TYPE31: CharacterType = {
  ...TYPE,
  type: 0x19, name: "zstin", file: "zstin.bin",
  motions: {
    ...TYPE.motions,
    // The walk that closes, the idle that does not, the landing clip, and one
    // clip per attack and per surface leap.
    "313": motion(13, 2.08), "295": motion(31), "283": motion(16),
    "303": motion(34), "302": motion(36), "284": motion(25),
    "298": motion(30), "299": motion(30),
    "290": motion(23), "291": motion(23), "309": motion(46), "282": motion(41),
    // The reaction row, the airborne clip, the get-up and the death clip.
    "929": motion(20), "930": motion(20), "931": motion(20), "934": motion(50),
    "935": motion(20), "938": motion(20), "939": motion(20),
    "283b": motion(1), "285": motion(50), "287": motion(29),
    // The path follow's hop, 13 authored frames as `szom.bin` has it.
    "301": motion(13),
  },
};

export const CLASS31 = {
  sets: [{
    set: 0,
    motions: [295, 295, 313, 313, 283, 934],
    attacks: {
      // Stance 0, the ground: two hands and a head-butt.
      "0": {
        "0": { script: ARC(303), hit_frame: 62, overlay_kind: 2, cancel_mask: 2 },
        "1": { script: ARC(302), hit_frame: 64, overlay_kind: 3, cancel_mask: 4 },
        "3": { script: ARC(284), hit_frame: 41, overlay_kind: 7, cancel_mask: 8 },
      },
      // Stance 1 and 2, the two walls -- a different swing on each.
      "1": {
        "0": { script: ARC(299), hit_frame: 52, overlay_kind: 2, cancel_mask: 2 },
      },
      "2": {
        "0": { script: ARC(298), hit_frame: 52, overlay_kind: 2, cancel_mask: 2 },
      },
    },
    // Intact: a coin flip between the two hands.
    attack_picks: [0, 0, 0, 0, 0, 1, 1, 1, 1, 1, ...new Array(70).fill(0)],
    state_picks: {
      // Band 1 is the climb, band 2 stands and occasionally pounces.
      "1": [14, 14, 14, 15, 15, 15, 16, 16, 16, 12, ...new Array(70).fill(14)],
      "2": [7, 7, 7, 7, 7, 7, 7, 7, 7, 13, ...new Array(70).fill(7)],
    },
    // `g_class31_hit_reactions` row A, the `szom.bin` one sets 0, 1 and 3 share.
    reactions: [0x3a7, 0x3a3, 0x3a7, 0x3aa, 0x3ab, 0x3a7, 0x3a2, 0x3a1],
  }],
  // The pose a corpse freezes on, by the clip it died in.
  corpse_frames: { "286": [74, 70], "285": [48, 40], "934": [44, 35] },
  scripts: {
    wall_left: WALL_SCRIPT(290), wall_right: WALL_SCRIPT(291),
    ceiling: ARC(309),
    aside: ARC(282), aside_attack3: ARC(282), aside_zsass: ARC(282),
    // `ThrowerStateLeapToPoint`'s three. `drop` and `drop_alt` are byte for
    // byte the same in the exe and are the same here, which is what lets the
    // coin flip be asserted as invisible.
    // The exe's own twelve dwords, not `ARC`'s generic shape: the stage
    // thresholds are what the state measures its windup, flight and landing
    // against, and a stand-in with different ones tests a different clip.
    drop: DROP_SCRIPT(300), drop_alt: DROP_SCRIPT(300),
    drop_zskamere: [
      { motion: 439, start: 0, fade: 0, until: 19 },
      { motion: 439, start: 20, fade: 0, until: 31 },
      { motion: 439, start: 32, fade: 0, until: 42 },
    ],
    // `ThrowerStatePathFollow`'s three, verbatim from `0x00565EB8`,
    // `0x00565E58` and `0x00565E88`.
    path_style0: PATH_STYLE0,
    path_style1: PATH_STYLE1,
    path_style2: [
      { motion: 301, start: 7, fade: 0, until: 11 },
      { motion: 300, start: 48, fade: 1, until: 65 },
      { motion: 301, start: 17, fade: 1, until: 22 },
    ],
  },
};

/**
 * `g_class31_throws`' own entry, exactly as the exporter writes it — motion 9
 * for bone 5, motion 8 for bone 8, `release_frame` **48**.
 *
 * Shared by the two throwing character types below, and that sharing is the
 * point: 0x16 reads it and 0x18 does not, off the same bytes. An assertion
 * that 0x18 plays 0x1F7 and lets go on 25 is only worth something if the
 * entry it is supposed to be ignoring says something else.
 */
export const THROW31_ENTRY = {
  hands: {
    "0": [
      { bone: 5, motion: 9, release_frame: 48, range: 20, overlay_kind: 6,
        cancel_mask: 2, held: null, bare: 8177, projectile: 8162 },
      { bone: 8, motion: 8, release_frame: 48, range: 20, overlay_kind: 6,
        cancel_mask: 4, held: null, bare: 8173, projectile: 8161 },
    ],
  },
  spin: 0, speed: 1.2, aim_ahead: 4, aim_side: 0.6,
  stick_frames: 30, blink_frames: 60,
};

/** The entry's own two clips, and the eight the `.text` switch names. */
export const THROW31_MOTIONS = {
  "9": motion(40), "8": motion(40),
  // Right hand then left, per stance: ground, WallA, WallB, ceiling.
  "503": motion(40), "502": motion(40),        // 0x1F7, 0x1F6
  "508": motion(40), "507": motion(40),        // 0x1FC, 0x1FB
  "498": motion(40), "497": motion(40),        // 0x1F2, 0x1F1
  "516": motion(40), "515": motion(40),        // 0x204, 0x203
};

/** Character type 0x16, `zsass` — the thrower that *does* read its entry. */
export const TYPE31_ZSASS: CharacterType = {
  ...TYPE31,
  type: 0x16, name: "zsass", file: "zsass.bin",
  throw: THROW31_ENTRY,
  motions: { ...TYPE31.motions, ...THROW31_MOTIONS },
};

/** Character type 0x18, `zslman` — the one whose throw ignores its entry. */
export const TYPE31_ZSLMAN: CharacterType = {
  ...TYPE31_ZSASS,
  type: 0x18, name: "zslman", file: "zslman.bin",
};

export const CHARS31 = {
  ...CHARS,
  types: { "1": TYPE, "22": TYPE31_ZSASS, "24": TYPE31_ZSLMAN, "25": TYPE31 },
  class31: CLASS31,
} as unknown as CharactersJson;

/**
 * A camera at `EYE` looking toward **+Z**, which is where this file's actors
 * stand. `viewPoint` takes a point in camera space, where -Z is forward, so
 * the z term is negated on the way out.
 */
/**
 * A camera at `EYE` looking down **+z in world**, which is where this file
 * stands its actors.
 *
 * `viewSpaceOf` is the exact inverse of `viewPoint`, and it has to be: the
 * knockback arc reads one and writes through the other, so a stub answering
 * only half of the seam tested the formula against nothing. Both are in the
 * engine's own sign, `-z` in front, and neither has an opinion about an actor
 * behind the camera. See `game/host.ts`.
 */
export const CAM_HOST = {
  ...NULL_HOST,
  viewPoint: (x: number, y: number, z: number, out: Vec3) => {
    out.x = EYE.x + x; out.y = EYE.y + y; out.z = EYE.z - z;
  },
  viewSpaceOf: (at: number, out: Vec3) => {
    const a = ActorByAt(at);
    if (!a) return false;
    // The tracked point when the renderer has filled one, the origin
    // otherwise — `lookAtOf`'s own fallback.
    const p = (a.lookAt.x || a.lookAt.y || a.lookAt.z) ? a.lookAt : a.pos;
    out.x = p.x - EYE.x;
    out.y = p.y - EYE.y;
    out.z = EYE.z - p.z;                  // `-z` in front, as the engine has it
    return true;
  },
};

/**
 * One `coli/` quad, as a blob the port's own collision can be pointed at.
 *
 * The wall search used to be answered by a stub host that said "yes, there,"
 * which tested the state machine and nothing else. This is a real quad in the
 * real format, so the assertions below go through `ColiSegmentVsMesh`'s plane
 * test, its dominant-axis projection and its winding test — the same code the
 * shipped collision runs.
 */
export function coliQuad(plane: [number, number, number, number], axis: number,
                  verts: number[], surface = 52) {
  const xs = [verts[0], verts[3], verts[6], verts[9]];
  const ys = [verts[1], verts[4], verts[7], verts[10]];
  const zs = [verts[2], verts[5], verts[8], verts[11]];
  return {
    min: [Math.min(...xs), Math.min(...ys), Math.min(...zs)],
    max: [Math.max(...xs), Math.max(...ys), Math.max(...zs)],
    n: 1, plane, verts, axis: [axis], surface: [surface],
  };
}

/** A wall in the plane `x = 30`, forty units tall and eighty deep. */
export const WALL_BLOB = coliQuad([-1, 0, 0, 30], 0,
                           [30, -10, 5, 30, -10, 85, 30, 40, 85, 30, 40, 5]);
/**
 * ...and a floor at `y = 0`, which is where this file's actors stand.
 *
 * **Wound the way the game's own floors are**, which is clockwise seen from
 * above: `coli2.bin:13864` quad 0, under stage 2's spawn at
 * (-742, 40.1, -1725), runs `+x, -z, -x, +z`. It matters because the winding
 * test's sign factor is the dominant normal component *negated on Y*, so a
 * floor authored the other way round is rejected. These fixtures were wound
 * counter-clockwise while `coli.ts` had one global polarity and both were
 * wrong together -- the game's data is the arbiter, not the fixture.
 */
export const FLOOR_BLOB = coliQuad([0, 1, 0, 0], 1,
                            [-200, 0, 200, 200, 0, 200, 200, 0, -200,
                             -200, 0, -200]);

export function thrower(state: number, extra: Record<string, unknown> = {}) {
  ResetGameGlobals();
  SetGameTables(CHARS31);
  G.g_scene_state_major_entered = SCENE_MAJOR_PLAYING;
  G.g_scene_state_major = SCENE_MAJOR_PLAYING;
  EnterPlay();
  // `g_camera_yaw_bams` is the heading *from* the camera *toward* what it
  // looks at -- `ThrowerStateLeapDown` sets the pouncing actor's own yaw from
  // it, and an actor facing the camera carries `VecToAngles(obj - eye)`. This
  // file's actors stand at +Z of an eye at the origin, so that heading is 0.
  G.g_camera_yaw_bams = 0;
  const a = ActorSpawn(0x9000, SpawnClass.Thrower, 0x19, "zstin", {
    initialState: state, condition: 0, ...extra,
  });
  // Narrowing, not a cast. `ActorSpawn` returns the union and class 0x31's
  // routines take the arm, so the fixture has to prove the actor is a thrower
  // the same way the director does -- see `humanoidScene` for class 0x25.
  if (a.cls !== SpawnClass.Thrower) throw new Error("not class 0x31");
  a.visible = true;
  a.hp = 100;
  a.motion = 936;
  a.pos = vec3(0, 0, 80);
  a.yaw = 0;
  return a;
}
