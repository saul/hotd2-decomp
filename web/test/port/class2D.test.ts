/**
 * Class 0x2D, the stage-6 final boss (`game/class2D/`), driven from a reset
 * (L49) through `GameUpdate`: the handler, the join and the first round's
 * start in Boss Mode, the satellites' ring, the weak point, a child of each
 * shape the fight builds, the kill and the death, and stage 5's cameo. The
 * skeletons are the shipped ones' trees (`boss6.bin` sixteen bones, the kinds
 * their own) with every clip one still pose at the exe's play lengths, and
 * the tables are the exe's `.rdata` (`ExeTables.class2dTables`), so every
 * number asserted below is the exe's.
 */
import type { CharactersJson, CharacterType } from "../../src/bundle";
import type { Class2DTablesJson } from "../../src/bundle/stage";
import { Rng } from "../../src/core/rng";
import { Events } from "../../src/core/events";
import { ActorSpawn, GameUpdate } from "../../src/game/director";
import { ActorByAt, G, ResetGameGlobals } from "../../src/game/globals";
import { NULL_HOST, type GameHost } from "../../src/game/host";
import { SetClass2DTables, SetGameTables } from "../../src/game/tables";
import { ActorFlag, type EmperorActor } from "../../src/game/actor";
import { SpawnClass } from "../../src/game/spawn_class";
import { g_class_handlers } from "../../src/game/registry";
import { GameMode } from "../../src/game/game_mode";
import { vec3, type Vec3 } from "../../src/game/vec";
import {
  MatCopy, MatIdentity, MatrixGetTranslation, MatrixTranslate,
} from "../../src/game/matrix";
import { PlayerTakeDamageIfOnScreen } from "../../src/game/combat/player";
import { ProfileFactoryReset } from "../../src/game/profile";
import { Class2DResolveShot } from "../../src/game/class2D/boss";
import {
  CLASS2D_AT_KIND0, CLASS2D_AT_WING, Class2DChildAt, Class2DCue,
  Class2DRoutine, Class2DSatelliteState, Class2DState,
} from "../../src/game/class2D/state";
import {
  check, motion, TYPE, CHARS, SCENE_MAJOR_PLAYING, EnterPlay,
} from "./harness";

console.log("\nclass 0x2D: the stage-6 boss -- handler, satellites, children, death:");
{
  /** `ExeTables.class2dTables()` on the shipped `Hod2.exe`. */
  const TABLES = {
    charge_arrive_dist: 30, hit_damage: [16880, 12, 7],
    waypoints: [[1141.760009765625, 2807.10009765625, -9774.9296875],
                [964.8599853515625, 2786.10009765625, -9719.23046875],
                [1076.0699462890625, 2837.10009765625, -9861.6904296875],
                [1076.010009765625, 2791.10009765625, -9680.9599609375],
                [970.9000244140625, 2812.10009765625, -9833.759765625]],
    attack_picks: Array.from({ length: 16 }, (_, r) => r < 3
      ? [0, 0, 0, 0, 1, 1, 2, 2, 2, 2] : r < 7 ? [0, 0, 0, 1, 1, 1, 2, 2, 2, 2]
        : r < 9 ? [0, 0, 1, 1, 1, 1, 2, 2, 2, 2]
          : [0, 0, 1, 1, 1, 1, 1, 2, 2, 2]),
    stagger_hits: [0, 1, 2],
    charge_steps: [40, 38, 34, 32, 30, 29, 28, 27, 26, 25, 24, 23, 22, 20, 18,
                   16],
    child_kind_picks: [[0, 1, 1, 1, 2, 2, 2, 3, 3, 3], [0, 0, 0, 1, 2, 2, 2, 3, 3, 3],
                       [0, 0, 0, 1, 1, 1, 2, 3, 3, 3], [0, 0, 0, 1, 1, 1, 2, 2, 2, 3]],
    path_segments: [[0.4, 240, 224, 205], [0.4, 240, 228, 215],
                    [0.4, 240, 225, 216], [0.4, 300, 289, 280],
                    [0.25, 260, 254, 240], [0.4, 300, 291, 284],
                    [0.4, 240, 232, 220], [0.4, 280, 253, 238]]
      .map(([step, advance, strike, end]) => ({
        step: Math.fround(step), advance, strike, end, words: [20, 4, 6, 0],
      })),
    child_offsets: [[0, 19, -85], [0, 5, -85], [0, 8, -175], [0, -7, -85],
                    [0, 5, -85]],
    launch_gap: [44, 42, 40, 38, 37, 36, 36, 35, 35, 34, 34, 33, 33, 32, 31, 30],
    flight_frames: [92, 88, 84, 81, 78, 76, 74, 72, 70, 68, 66, 64, 61, 58, 55,
                    52],
    pair_flight_frames: [180, 172, 166, 160, 155, 150, 145, 140, 135, 130, 125,
                         120, 116, 113, 110, 105],
    child0_path_start: [70, 56],
    child_bone_satellite: [255, 0, 1, 255, 2, 3, 255, 4, 255, 5, 255, 6, 255,
                           255, 7, 255],
    child2_approach: [108, 104, 100, 98, 97, 96, 95, 94, 93, 92, 91, 90, 88,
                      86, 82, 78],
    child2_bone_satellite: [...new Array(19).fill(255), 7, 6, 5, 4, 3, 2, 1, 0,
                            0],
    child3_approach: [56, 52, 48, 46, 44, 42, 40, 39, 38, 37, 36, 34, 32, 30,
                      26, 22],
  } as unknown as Class2DTablesJson;

  /** `g_motion_play_length` for every clip the class names. */
  const PLAY: Record<number, number> = {
    0x95: 100, 0x96: 59, 0x97: 39, 0x98: 189, 0x99: 39, 0x9a: 58, 0x9b: 99,
    0x9c: 100, 0x9d: 99, 0x9e: 39, 0x9f: 49, 0xa0: 99, 0xa1: 79, 0xa2: 49,
    0xa3: 44, 0xa4: 20, 0xa5: 79, 0xa6: 39, 0xa7: 119, 0xa8: 39, 0xa9: 39,
    0xaa: 119, 0xab: 64, 0xac: 29, 0xad: 39, 0xae: 59, 0xaf: 29, 0xb0: 59,
  };
  const clip = (play: number) => motion(Math.ceil(play / 2) + 1, 0, play);
  /** A tree as `ExeTables.characterSkeleton` lists it: `[bone, slot, parent bone]`. */
  const tree = (rows: [number, number, number | null][], step: number) => {
    const out: CharacterType["bones"] = [];
    for (const [bone, slot, parent] of rows) {
      out.push({ bone, part: `n${bone}`, slot,
                 offset: [parent === null ? 0 : step, bone * 0.25, 0],
                 parent: parent === null ? null
                   : rows.findIndex((r) => r[0] === parent),
                 damage_rank: [], hit_radius: bone === 4 ? 2.25
                   : bone === 5 ? 1.4 : 2, hit_centre: [0, 0, 0],
                 steps: [] } as never);
    }
    return out;
  };
  const HUMANOID = (slots: number[]): [number, number, number | null][] => [
    [1, slots[0], null], [2, slots[1], 1], [3, slots[2], 1], [4, slots[3], 3],
    [5, slots[4], 4], [6, slots[5], 1], [7, slots[6], 6], [8, slots[7], 7],
    [9, slots[8], null], [10, slots[9], 9], [11, slots[10], 10],
    [12, slots[11], 11], [13, slots[12], 9], [14, slots[13], 13],
    [15, slots[14], 14],
  ];
  const BOSS: CharacterType = {
    ...TYPE, type: 0x4c, name: "boss6", bone_count: 16, actor_radius: 31,
    parts: [],
    bones: tree(HUMANOID([0x7c3, 0x7bb, 0x7bd, 0x7ca, 0x7c8, 0x7bc, 0x7c9,
                          0x7c7, 0x7c0, 0x7c2, 0x7ba, 0x7b3, 0x7c1, 0x7b9,
                          0x7b2]), 3),
    motions: Object.fromEntries(Object.entries(PLAY)
      .map(([id, play]) => [id, clip(play)])),
  } as unknown as CharacterType;
  const kind = (type: number, name: string, radius: number,
                bones: CharacterType["bones"], clips: Record<number, number>) =>
    ({ ...TYPE, type, name, bone_count: bones.length + 1, actor_radius: radius,
       parts: [], bones,
       motions: Object.fromEntries(Object.entries(clips)
         .map(([id, play]) => [id, clip(play)])) }) as unknown as CharacterType;
  const KIND2_TREE: [number, number, number | null][] = [[1, 0x104, null]];
  for (let b = 2; b <= 26; b++) KIND2_TREE.push([b, 0xfa, b === 26 ? 24 : b - 1]);
  const CHARS2D = {
    ...CHARS,
    types: {
      "1": TYPE,
      "76": BOSS,
      "77": kind(0x4d, "b6boss1z", 10, tree(HUMANOID(new Array(15).fill(0xdb)), 2),
                 { 0x40c: 134 }),
      "78": kind(0x4e, "b6boss1z_wing", 10,
                 tree([[1, 0xe1, null], [2, 0xe5, 1], [3, 0xe7, 2], [4, 0xe0, null],
                       [5, 0xe4, 4], [6, 0xe6, 5]], 1), { 0xf: 16 }),
      "79": kind(0x4f, "b6boss2", 30, tree(HUMANOID(new Array(15).fill(0xf3)), 2),
                 { 0x33: 169 }),
      "80": kind(0x50, "b6boss3", 95, tree(KIND2_TREE, 2), { 0x3b: 99 }),
      "81": kind(0x51, "b6boss4", 31, tree(HUMANOID(new Array(15).fill(0x110)), 2),
                 { 0x79: 79 }),
    },
  } as unknown as CharactersJson;

  const AT = 0x4db8;
  const FIGHT_TAIL = { subtype: 1, clip: 0xa1, counter: 0, kill_path: 0xe3,
                       kill_frame: 0, fight_hp: 400, round2_hp: 260,
                       round3_hp: 140 };
  const rng = new Rng(0x2d);
  const events = new Events();
  const sounds: number[] = [];
  events.on("sound.play", (e: { id: number }) => sounds.push(e.id));
  /** The camera's space is the world's: the weak point's ray test reads it. */
  const host: GameHost = {
    ...NULL_HOST,
    objectPath: (_slot: number, frame: number) =>
      ({ x: 1000, y: 2800, z: -9800 + frame * 0.01, pitch: 0, yaw: 0x8000,
         roll: 0 }),
    viewSpaceOfPoint: (p: Vec3, out: Vec3) => {
      out.x = p.x; out.y = p.y; out.z = p.z;
      return true;
    },
  };
  const tick = (n: number): void => {
    for (let i = 0; i < n; i++) GameUpdate(1 / 60, host, rng, events);
  };
  const boss = () => ActorByAt(AT) as EmperorActor | undefined;
  const sat = (i: number) =>
    ActorByAt(Class2DChildAt(AT, i)) as EmperorActor | undefined;
  /**
   * Player 0's pull marked bone 1 on a ray through the weak point, as the
   * shot test leaves it: `obj+0x190`, bit 3 and the ray.
   */
  const aimAtWeakPoint = (b: EmperorActor): void => {
    const m = MatCopy(MatIdentity(), b.skel!.bones[1]!.mat);
    MatrixTranslate(m, Math.fround(2.3121), Math.fround(0.1097), 0);
    const P = vec3();
    MatrixGetTranslation(m, P);
    const eye = vec3(P.x, P.y, P.z + 60);
    b.shotRays[0] = { origin: eye, dir: vec3(0, 0, -1) } as never;
    b.shotBones[0] = 1;
    b.flags |= ActorFlag.Hit;
  };
  const begin = (mode: GameMode, tail = FIGHT_TAIL): EmperorActor => {
    ResetGameGlobals();
    SetGameTables(CHARS2D);
    SetClass2DTables(TABLES);
    G.g_GameMode = mode;
    G.g_scene_state_major_entered = SCENE_MAJOR_PLAYING;
    G.g_scene_state_major = SCENE_MAJOR_PLAYING;
    EnterPlay();
    sounds.length = 0;
    return ActorSpawn(AT, SpawnClass.Emperor, 0x4c, "emperor",
                      { class2dSpawn: tail, hp: 0, visible: true }) as EmperorActor;
  };

  // -- the handler and the join, in Boss Mode --------------------------------
  {
    const b = begin(GameMode.Boss);
    check("a spawned boss is on Class2DClassHandler, the descriptor's words on its block",
          b.class2d.routine === Class2DRoutine.ClassHandler
            && b.class2d.boss?.subtype === 1 && b.class2d.boss?.fightHp === 400);
    tick(1);
    check("frame 1: sub-type 1 installs Class2DUpdate", b.class2d.routine
            === Class2DRoutine.Update);
    check("...and in Boss Mode seats itself on path 0x185 at 1810, clip 0xA3, "
          + "flag 50, cue 1, state 2",
          b.state === Class2DState.Join && b.skel?.motion === 0xa3
            && G.g_script_flags[0x32] === 1
            && b.class2d.boss?.cue === Class2DCue.Resume
            && Math.abs(b.pos.z - (-9800 + 18.1)) < 1e-3);
    check("...with the name banner up (record 0x005898C8)",
          G.g_boss_banners.length === 1);
    const sats = Array.from({ length: 8 }, (_, i) => sat(i));
    check("...and eight satellites, each past its init on the same frame",
          sats.every((s, i) => s !== undefined && s.class2d.sat?.index === i
                     && s.class2d.routine === Class2DRoutine.SatelliteUpdate
                     && s.targetAt === AT));
    check("...which saw cue 1 and are appearing",
          sats.every((s) => s?.state === Class2DSatelliteState.Appear));
    tick(298);
    check("the join counts 300 frames, the handler's own call the first: "
          + "still state 2 after 299",
          b.state === Class2DState.Join && G.g_enemies_alive === 0);
    tick(1);
    check("...and then the fight: 400 hit points, both enemy counts, the bar, "
          + "g_boss_engaged, state 3",
          b.state === Class2DState.Round1 && b.hp === 400
            && G.g_enemies_alive === 1 && G.g_enemies_present === 1
            && G.g_boss_engaged === 1 && G.g_boss_hp_bars.length === 1
            && b.cameraSlot !== -1);
    check("...at waypoint 0, gliding to waypoint 1",
          Math.abs(b.class2d.boss!.target.x - 964.8599853515625) < 1e-3);
    check("the satellites appeared in 240 frames and orbit: state 2",
          sats.every((s) => s?.state === Class2DSatelliteState.OrbitAndPick));
    check("...grown to scale 1.0 at 0.05 a frame",
          sats.every((s) => (s?.class2d.sat?.scale ?? 0) >= 1.0));
    // The ring: 15 out from the weak point on bone 1, whatever the turn.
    tick(3);
    const W1 = b.skel!.bones[1]!.mat;
    const m = MatCopy(MatIdentity(), W1);
    MatrixTranslate(m, Math.fround(2.3121), Math.fround(0.1097), 0);
    const P = vec3();
    MatrixGetTranslation(m, P);
    const d = sats.map((s) => Math.hypot(s!.pos.x - P.x, s!.pos.y - P.y,
                                         s!.pos.z - P.z));
    check("each satellite is 15 from the weak point (Class2DSatelliteOrbitPoint)",
          d.every((x) => Math.abs(x - 15) < 0.05), d.map((x) => x.toFixed(3)).join(" "));
    check("...and in the shot test at radius 1.8",
          sats.every((s) => Math.abs((s?.hitRadius ?? 0) - Math.fround(1.8)) < 1e-6));

    // -- the weak point ------------------------------------------------------
    b.sub = 1;
    aimAtWeakPoint(b);
    b.flags |= ActorFlag.ShotImmune;
    sounds.length = 0;
    const f = { dt: 1 / 60, rng, host, events };
    check("a shot on bone 1 while 0x100 is up ricochets (0x1216A9) and costs nothing",
          Class2DResolveShot(b, f) === 0 && b.hp === 400
            && sounds.includes(0x1216a9));
    b.flags &= ~ActorFlag.ShotImmune;
    b.flags |= ActorFlag.Hit;
    b.shotBones[0] = 1;
    const rank = b.class2d.boss!.rank;
    sounds.length = 0;
    check("a shot through the weak point costs g_class2d_hit_damage[1], 12",
          Class2DResolveShot(b, f) === 1 && b.hp === 388);
    check("...raises the rank by one, flashes (1, 0.25, 0.5), sparks, sounds 0x1625A9",
          b.class2d.boss!.rank === rank + 1
            && b.class2d.boss!.colour[1] === 0.25
            && G.g_class2d_tasks.length === 1 && sounds.includes(0x1625a9));
    check("...and names the shooter in +0x133C", b.class2d.boss!.shooter === 0);
  }

  // -- PlayerTakeDamageIfOnScreen -------------------------------------------
  {
    ResetGameGlobals();
    EnterPlay();
    G.g_scene_state_major_entered = SCENE_MAJOR_PLAYING;
    G.g_scene_state_major = SCENE_MAJOR_PLAYING;
    const lives = G.g_player_lives[0];
    const score = G.g_player_score[0];
    check("a point off the screen box costs nothing",
          PlayerTakeDamageIfOnScreen(vec3(100, 0, -10), 1, 7) === 0
            && G.g_player_lives[0] === lives);
    check("a point inside it charges the active player a life and 100 twice",
          PlayerTakeDamageIfOnScreen(vec3(1, 1, -10), 1, 7) === 1
            && G.g_player_lives[0] === lives - 1
            && G.g_player_score[0] === Math.max(0, score - 200));
  }

  // -- the children ----------------------------------------------------------
  /** The boss at round 2's waypoint, its glide done: sub 0 makes kind `k`. */
  const round2 = (k: number): EmperorActor => {
    const b = begin(GameMode.Boss);
    tick(301);
    b.state = Class2DState.Round2;
    b.sub = 0;
    const w = b.class2d.boss!;
    w.count = 0x29;
    w.next = k;
    w.index = 1;
    w.rank = 5;
    return b;
  };
  {
    const b = round2(1);
    tick(1);
    const at = Class2DChildAt(AT, CLASS2D_AT_KIND0 + 1);
    const c = ActorByAt(at) as EmperorActor | undefined;
    check("round 2's sub 0 makes kind 1 (b6boss2) and marks the child busy",
          c !== undefined && c.charType === 0x4f && G.g_class2d_child_busy === 1
            && c.class2d.routine === Class2DRoutine.ChildKind1Update);
    check("...at g_class2d_child_offsets[1] (0, 5, -85) from the eye",
          c !== undefined && Math.abs(Math.hypot(c.pos.x - G.g_camera_eye.x,
                                                 c.pos.y - G.g_camera_eye.y,
                                                 c.pos.z - G.g_camera_eye.z)
                                      - Math.hypot(5, 85)) < 0.01);
    // Cue 3 comes when every satellite is back idle.
    let n = 0;
    while (n < 1200 && (c?.sub ?? 0) < 3) { tick(1); n++; }
    check("kind 1 waits for cue 3, then thirty frames, then its clip to cursor 0x23: the throw",
          c?.sub === 3 && G.g_attack_permits[0] === c.at
            && c.vel.y === 4.0 && c.accY === Math.fround(-0.0680556)
            && sounds.includes(0x2a16a9));
    const lives = G.g_player_lives[0];
    const rank = b.class2d.boss!.rank;
    n = 0;
    while (n < 600 && !c?.despawned) { tick(1); n++; }
    check("it falls below the eye + 22 and strikes: a life, the rank -3",
          c?.despawned === true && G.g_player_lives[0] === lives - 1
            && b.class2d.boss!.rank === Math.max(0, rank - 3));
    check("...and leaves: the permit back, g_class2d_child_busy 0, 0x10000 off the boss",
          G.g_attack_permits[0] === -1 && G.g_class2d_child_busy === 0
            && !(b.flags & ActorFlag.NoCameraTrack));
  }
  {
    const b = round2(3);
    tick(1);
    const c = ActorByAt(Class2DChildAt(AT, CLASS2D_AT_KIND0 + 3)) as EmperorActor;
    let n = 0;
    while (n < 1200 && c.sub < 2) { tick(1); n++; }
    check("kind 3 (b6boss4) glides at the eye in sub 2", c.sub === 2
            && c.charType === 0x51);
    const hp = b.hp;
    c.flags |= ActorFlag.Hit;
    c.shotBones[0] = 2;
    sounds.length = 0;
    tick(1);
    check("a shot on its bone 2 costs the boss 12 and sounds 0x316A9",
          b.hp === hp - 12 && sounds.includes(0x316a9) && c.sub === 4);
    tick(1);
    check("...and it leaves with 0x4E17A9", c.despawned && sounds.includes(0x4e17a9));
  }
  {
    round2(0);
    tick(1);
    const c = ActorByAt(Class2DChildAt(AT, CLASS2D_AT_KIND0)) as EmperorActor;
    const wing = ActorByAt(Class2DChildAt(AT, CLASS2D_AT_WING)) as EmperorActor;
    check("kind 0 (b6boss1z) carries its wing (0x4E, clip 0xF, 0x88000)",
          c?.charType === 0x4d && wing?.charType === 0x4e
            && wing.skel?.motion === 0xf
            && (wing.flags & 0x88000) === 0x88000
            && c.class2d.child?.wingAt === wing.at);
    let n = 0;
    while (n < 2000 && !c.despawned) { tick(1); n++; }
    check("...which goes with it", c.despawned && wing.despawned);
  }

  // -- the kill and the death --------------------------------------------------
  {
    const b = begin(GameMode.Boss);
    tick(300);
    // Round 3's path, the last twelve hit points, and the shot that takes them.
    b.state = Class2DState.Round3;
    b.sub = 1;
    b.flags &= ~ActorFlag.ShotImmune;
    b.class2d.boss!.phase = 1;
    b.hp = 12;
    // The kill arm's unlock and tally are Original Mode's.
    G.g_GameMode = GameMode.Original;
    const score = G.g_player_score[0];
    sounds.length = 0;
    aimAtWeakPoint(b);
    tick(1);
    check("round 3's last hit: the kill -- 2500 to the shooter, state 6, clip 0x9F",
          b.state === Class2DState.Death && b.skel?.motion === 0x9f
            && G.g_player_score[0] === score + 0x9c4 && G.g_boss_engaged === 0
            && sounds.includes(0x325a9),
          `state ${b.state} score +${G.g_player_score[0] - score}`);
    check("...in Original Mode: the unlock bit, entry 24 of the item tally and its save, "
          + "and 0x009C9F5F",
          (G.g_option_unlocks & 1) === 1 && G.g_original_items_taken[24] === 1
            && G.g_profile_original_items[24] === 1
            && G.g_profile_original_boss6_beaten === 1);
    tick(1);
    check("state 6 sub 0 takes it out of both counts", G.g_enemies_alive === 0
            && G.g_enemies_present === 0 && b.sub === 1);
    G.g_active_cam_path = 0xe2;
    for (let fr = 0; fr <= 200; fr++) {
      G.g_cam_path_frame = fr;
      tick(1);
    }
    check("on camera path 0xE2 it rides path 0x186, and frame 200 makes the burst",
          b.sub === 3 && G.g_class2d_tasks.some((t) => t.kind === 2));
    tick(30);
    check("thirty frames on, cue 4 and ActorDespawn", b.despawned === true
            || ActorByAt(AT) === undefined);
    tick(2);
    check("...and the satellites follow it out",
          Array.from({ length: 8 }, (_, i) => sat(i)).every((s) => s === undefined));
  }

  // -- stage 5's cameo ------------------------------------------------------
  {
    const b = begin(GameMode.Original,
                    { subtype: 0, clip: 0xa0, counter: 0, kill_path: 0xcc,
                      kill_frame: 0, fight_hp: -1, round2_hp: 0, round3_hp: 0 });
    tick(1);
    check("sub-type 0 installs Class2DSubtype0Update and stands at "
          + "(752.875, 2595, -9872.09), yaw 0xFAA8",
          b.class2d.routine === Class2DRoutine.Subtype0Update
            && b.pos.x === Math.fround(752.875) && b.pos.y === 2595
            && b.yaw === 0xfaa8 && boss() === b);
    const c = b.skel?.counter;
    tick(5);
    check("...never stepping its counter", b.skel?.counter === c);
    G.g_active_cam_path = 0xcc;
    G.g_cam_path_frame = 0;
    tick(1);
    check("...and is gone the frame camera path 0xCC plays", b.despawned === true);
  }

  // -- a replay's answers ------------------------------------------------------
  {
    ResetGameGlobals();
    SetGameTables({ ...CHARS2D, placements: [
      { at: 0xf0c, class: 0x2d, char_type: 0x4c, motion: 0xa0, hp: 0,
        class2d: { subtype: 0, clip: 0xa0, counter: 0, kill_path: 0xcc,
                   kill_frame: 0, fight_hp: -1, round2_hp: 0, round3_hp: 0 } },
      { at: AT, class: 0x2d, char_type: 0x4c, motion: 0xa1, hp: 400,
        class2d: FIGHT_TAIL },
    ] } as unknown as CharactersJson);
    const h = g_class_handlers[SpawnClass.Emperor]!;
    const cameo = { class: 0x2d, hp: 0, at: 0xf0c, block: 0 };
    const fight = { class: 0x2d, hp: 400, at: AT, block: 12 };
    G.g_active_cam_path = 0xcb;
    G.g_cam_path_frame = 200;
    check("a replay keeps the cameo while its camera path has not played",
          h.outlivedByReplay?.(cameo) === false);
    G.g_active_cam_path = 0xcc;
    G.g_cam_path_frame = 0;
    check("...and retires it from camera path 0xCC frame 0, its own test",
          h.outlivedByReplay?.(cameo) === true
            && h.outlivedByReplay?.(fight) === false);
    check("the fight counts for the enemy gate it holds; the cameo does not",
          h.countsForEnemyGate?.(fight) === true
            && h.countsForEnemyGate?.(cameo) === false);
  }

  // -- the profile ------------------------------------------------------------
  {
    ResetGameGlobals();
    G.g_profile_original_boss6_beaten = 1;
    ProfileFactoryReset();
    check("ProfileFactoryReset zeroes 0x009C9F5F and the saved items, then sets "
          + "items 3, 7 and 16 to 1",
          G.g_profile_original_boss6_beaten === 0
            && G.g_profile_original_items.every((v, i) =>
              v === ([3, 7, 16].includes(i) ? 1 : 0)));
  }
}
