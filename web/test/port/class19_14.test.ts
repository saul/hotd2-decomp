import type { CharactersJson, CharacterType } from "../../src/bundle";
import { Rng } from "../../src/core/rng";
import { Events } from "../../src/core/events";
import { ActorSpawn, GameUpdate } from "../../src/game/director";
import { UpdateCameraEnemySlots } from "../../src/game/camera/slots";
import { ActorAdvanceMotion } from "../../src/game/motion";
import { type Boss2Actor, type FishActor } from "../../src/game/actor";
import { ActorRegisterCameraPoint } from "../../src/game/camera/track";
import {
  ProcessPlayerShotsTestList, RegisterForShotTest,
} from "../../src/game/combat/shot_test";
import { G, HIT_SLOT_NONE, ResetGameGlobals } from "../../src/game/globals";
import { NULL_HOST, type GameHost } from "../../src/game/host";
import {
  MatCopy, MatIdentity, MatrixGetTranslation, MatrixTransformVector,
  MatrixTranslate,
} from "../../src/game/matrix";
import {
  FireShotRequest, MarkActorShot, QueueOffscreenPull, QueueShotRequest,
} from "../../src/game/combat/shot";
import {
  MotionPlayFrame, SetBoss4Tables, SetGameTables,
} from "../../src/game/tables";
import { ActorFlag, type Actor } from "../../src/game/actor";
import { g_class_handlers } from "../../src/game/registry";
import { SpawnClass } from "../../src/game/spawn_class";
import { GameMode } from "../../src/game/game_mode";
import { BossBannersTick } from "../../src/game/boss_banner";
import { vec3, type Vec3 } from "../../src/game/vec";
import type { ScriptJson } from "../../src/bundle";
import {
  HudDrawShutterState, SHUTTER_FRAMES,
} from "../../src/game/hud_shutter";
import { Boss2Handler, Class14Phase, Class14State } from "../../src/game/class14";
import { Class14AdvanceMotionAndPublishPoints }
  from "../../src/game/class14/advance";
import { Class14ResolveShotBone } from "../../src/game/class14/shot";
import { Class14AdvancePhase, Class14TrackAdaptiveRank }
  from "../../src/game/class14/steer";
import type { Class14Json } from "../../src/bundle/characters";
import { ScriptFlagsThisBundleCanRaise }
  from "../../src/script/waits/flag";
import { BOSS4_DROP_FLAG, BOSS4_FIGHT_READY_FLAG }
  from "../../src/game/class19/entrance";
import { BOSS4_DEAD_FLAG, BOSS4_DEATH_DWELL }
  from "../../src/game/class19/death";
import { Boss4ResolveShot } from "../../src/game/class19/shot";
import { Boss4State } from "../../src/game/class19/state";
import type { Boss4TablesJson } from "../../src/bundle/stage";
import {
  check, motion, TYPE, CHARS, EYE, HoldCameraAt, scene, slotHolds, slotsShown,
  EnterPlay, RunOutInvulnerability,
} from "./harness";

console.log("\nclass 0x19: the stage-4 boss, Strength, and both of its flags:");
{
  /**
   * The seven `.rdata` tables, as `hod2lib/exetab.ts`'s `boss4Tables()` reads
   * them out of `Hod2.exe` -- the bundle's `script.json` `boss4` block. Copied
   * here once so the suite runs with no game directory.
   */
  const BOSS4_TABLES: Boss4TablesJson = {
    phase_hp_fraction: [0.8888890147209167, 0.7777780294418335, 0.6666669845581055, 0.5555559992790222, 0.44444501399993896, 0.3333339989185333, 0.22222299873828888, 0.11111199855804443, 0.0, 0.8888890147209167, 0.7777780294418335, 0.6666669845581055, 0.5555559992790222, 0.44444501399993896, 0.3333339989185333, 0.22222299873828888, 0.11111199855804443, 0.0],
    head_damage: [0, 26, 22, 24, 20, 23, 19, 22, 18, 21, 17, 20, 16, 19, 15, 18, 14, 17, 13, 16, 12, 15, 11, 15, 11, 14, 10, 14, 10, 13, 9, 13, 9],
    held_props: [
      { offset: [4.468969821929932, -7.174769878387451, 1.9704699516296387], rot: [30229, 53341, 38188], bone: 13, clip: 103, take: 20, throw: 68 },
      { offset: [-4.053530216217041, 6.648230075836182, 3.688149929046631], rot: [40704, 62912, 32411], bone: 1, clip: 104, take: 20, throw: 68 },
    ],
    camera_cues: [
      { start: 0, end: 220, step: 0.699999988079071, path: 185 },
      { start: 231, end: 350, step: 0.550000011920929, path: 185 },
      { start: 361, end: 560, step: 0.7300000190734863, path: 185 },
      { start: 571, end: 680, step: 0.550000011920929, path: 185 },
      { start: 721, end: 750, step: 0.4000000059604645, path: 185 },
      { start: 751, end: 860, step: 0.4000000059604645, path: 185 },
      { start: 881, end: 1020, step: 0.5, path: 185 },
      { start: 1031, end: 1175, step: 0.6000000238418579, path: 185 },
      { start: 1211, end: 1310, step: 0.6000000238418579, path: 185 },
      { start: 0, end: 100, step: 0.5, path: 193 },
      { start: 111, end: 200, step: 0.5, path: 193 },
      { start: 211, end: 388, step: 0.6000000238418579, path: 193 },
      { start: 451, end: 590, step: 0.5, path: 193 },
      { start: 601, end: 670, step: 0.4000000059604645, path: 193 },
      { start: 681, end: 850, step: 0.75, path: 193 },
      { start: 861, end: 1030, step: 0.6000000238418579, path: 193 },
      { start: 1041, end: 1180, step: 0.6000000238418579, path: 193 },
      { start: 1221, end: 1310, step: 0.5, path: 193 },
      { start: 861, end: 880, step: 0.5, path: 185 },
      { start: 1176, end: 1210, step: 0.6000000238418579, path: 185 },
      { start: 389, end: 440, step: 0.44999998807907104, path: 193 },
      { start: 1181, end: 1220, step: 0.44999998807907104, path: 193 },
    ],
    phase_arenas: [
      [[-300.0,-1625.0],[190.0,-1625.0],[230.0,-1650.0],[-195.0,-1650.0],[-195.0,-1600.0],[230.0,-1600.0]],
      [[265.0,-1550.0],[265.0,-1750.0],[240.0,-1775.0],[240.0,-1600.0],[290.0,-1600.0],[290.0,-1775.0]],
      [[200.0,-1700.0],[410.0,-1700.0],[430.0,-1725.0],[310.0,-1725.0],[310.0,-1675.0],[430.0,-1675.0]],
      [[475.0,-1600.0],[475.0,-1740.0],[450.0,-1900.0],[450.0,-1675.0],[500.0,-1675.0],[500.0,-1900.0]],
      [[750.0,-1925.0],[490.0,-1925.0],[465.0,-1900.0],[680.0,-1900.0],[680.0,-1950.0],[465.0,-1950.0]],
      [[370.0,-1900.0],[370.0,-2040.0],[330.0,-2070.0],[330.0,-1955.0],[410.0,-1955.0],[410.0,-2070.0]],
      [[400.0,-2035.0],[250.0,-2035.0],[230.0,-2010.0],[310.0,-2010.0],[310.0,-2060.0],[230.0,-2060.0]],
      [[200.0,-1922.5],[80.0,-1922.5],[60.0,-1897.5],[155.0,-1897.5],[155.0,-1947.5],[60.0,-1947.5]],
      [[-100.0,-1820.0],[120.0,-1820.0],[145.0,-1845.0],[-25.0,-1845.0],[-25.0,-1795.0],[145.0,-1795.0]],
      [[-100.0,-1625.0],[-395.0,-1625.0],[-410.0,-1600.0],[-185.0,-1600.0],[-185.0,-1650.0],[-410.0,-1650.0]],
      [[-460.0,-1600.0],[-460.0,-1745.0],[-480.0,-1765.0],[-480.0,-1600.0],[-440.0,-1600.0],[-440.0,-1765.0]],
      [[-500.0,-1720.0],[-300.0,-1720.0],[-280.0,-1740.0],[-420.0,-1740.0],[-420.0,-1700.0],[-280.0,-1700.0]],
      [[-195.0,-1600.0],[-195.0,-1885.0],[-215.0,-1905.0],[-215.0,-1700.0],[-175.0,-1700.0],[-175.0,-1905.0]],
      [[-100.0,-1940.0],[-185.0,-1940.0],[-300.0,-1920.0],[-170.0,-1920.0],[-170.0,-1960.0],[-300.0,-1960.0]],
      [[-345.0,-1900.0],[-345.0,-2160.0],[-365.0,-2180.0],[-365.0,-1920.0],[-325.0,-1920.0],[-325.0,-2180.0]],
      [[-300.0,-2095.0],[-435.0,-2095.0],[-460.0,-2075.0],[-380.0,-2075.0],[-380.0,-2115.0],[-460.0,-2115.0]],
      [[-515.0,-2100.0],[-515.0,-1870.0],[-495.0,-1850.0],[-495.0,-2050.0],[-535.0,-2050.0],[-535.0,-1850.0]],
      [[-515.0,-2100.0],[-515.0,-1680.0],[-495.0,-1650.0],[-495.0,-2050.0],[-535.0,-2050.0],[-535.0,-1650.0]],
    ] as Boss4TablesJson["phase_arenas"],
    head_slot_by_bar: [982, 981, 980, 979, 978, 977, 976, 975, 974],
    approach_picks: [
      [0,0,0,0,0,0,0,1,1],
      [0,0,0,0,0,0,0,1,1],
      [0,0,0,0,0,0,1,1,1],
      [0,0,0,0,0,1,1,1,1],
      [0,0,0,0,0,1,1,1,1],
      [0,0,0,0,1,1,1,1,1],
      [0,0,0,0,1,1,1,1,1],
      [0,0,0,1,1,1,1,1,1],
      [0,0,1,1,1,1,1,1,1],
      [0,0,1,1,1,1,1,1,1],
      [0,1,1,1,1,1,1,1,1],
      [0,1,1,1,1,1,1,1,1],
      [1,1,1,1,1,1,1,1,1],
      [1,1,1,1,1,1,1,1,1],
      [1,1,1,1,1,1,1,1,1],
      [1,1,1,1,1,1,1,1,1],
    ],
  };

  /**
   * `boss4.bin`'s clips, as `charmotion.BOSS4_CLIPS` bakes them, with lengths
   * long enough for every cursor the states test: the death's 0x82, the
   * throw's 68, the strikes' 0x37, the charge's 0x47.
   */
  const BOSS4_TYPE = {
    ...TYPE,
    motions: {
      "101": motion(60),    // 0x65, strike 0xF
      "103": motion(60),    // 0x67, the first throw
      "104": motion(60),    // 0x68, the second
      "105": motion(120),   // 0x69, the death fall
      "107": motion(20),    // 0x6B, the fighting idle
      "108": motion(20),    // 0x6C, the choice
      "109": motion(20),    // 0x6D
      "110": motion(20),    // 0x6E
      "111": motion(20),    // 0x6F, the flinch out of state 7
      "112": motion(60),    // 0x70, the charge
      "113": motion(40),    // 0x71, the knock-down
      "114": motion(20),    // 0x72, the arrival
      "115": motion(20),    // 0x73, the ordinary flinch
      "116": motion(30),    // 0x74, the settle
      "117": motion(60),    // 0x75, the landing
      "118": motion(20),    // 0x76, the turn
      "120": motion(20),    // 0x78, the walk
      "122": motion(40),    // 0x7A, strike 0x10
      "123": motion(40),    // 0x7B, strike 0x11
      "124": motion(40),    // 0x7C, the entrance
      "125": motion(40),    // 0x7D
    },
  } as unknown as CharacterType;
  const BOSS_CHARS = {
    ...CHARS, types: { "1": TYPE, "74": BOSS4_TYPE },
  } as unknown as CharactersJson;
  /** The per-bone mesh words of every shipped descriptor: ten bones. */
  const BONE_COLI = ["4:23984", null, "4:7264", "4:40880", "4:21504",
                     "4:11328", "4:37680", null, null, "4:15392", "4:0",
                     null, "4:18448", "4:3632", null];

  /**
   * One boss, straight out of `Boss4Init`, with the entrance `entrance`, from
   * `ResetGameGlobals` (L49). `carrier` is an actor already spawned to be
   * `g_civilian_carrier`, as the transport is in stage 4's `spawn_obj_c`.
   */
  const spawnBoss = (entrance: number, reset = true): Actor => {
    if (reset) {
      ResetGameGlobals();
      EnterPlay();
      SetGameTables(BOSS_CHARS);
      SetBoss4Tables(BOSS4_TABLES, []);
    }
    return ActorSpawn(35976, SpawnClass.Boss4, 74, "boss4",
                      { hp: 300, maxHp: 300, initialState: entrance,
                        visible: true,
                        class19: { char_type: 0x4a, entrance,
                                   bone_coli: BONE_COLI,
                                   despawn_path: 182, despawn_frame: 0 } });
  };
  const bossFrame = (host: GameHost = NULL_HOST) =>
    ({ dt: 1 / 60, rng: new Rng(5), host });
  const tickBoss = (obj: Actor, n: number,
                    f: ReturnType<typeof bossFrame> = bossFrame()): void => {
    for (let i = 0; i < n; i++) {
      // The motion clock first, as the director runs it, then the update.
      ActorAdvanceMotion(obj, 1 / 60);
      g_class_handlers[SpawnClass.Boss4]?.update(obj, f);
      // The name banner the entrance spawns is a task of its own, stepped
      // after the boss the way the task walk reaches it.
      BossBannersTick(NULL_HOST);
    }
  };
  /** A shot by player 0 on `bone`, as `MarkActorShot` leaves it. */
  const shoot = (obj: Actor, bone: number, surface = 0,
                 host: GameHost = NULL_HOST): void => {
    obj.flags |= ActorFlag.Hit | 2;
    obj.shotBones[0] = bone;
    G.g_shot_hit_records[0].surface = surface;
    Boss4ResolveShot(obj, obj.boss4!, host, new Rng(1));
  };
  /** Through the banner to flag 31: the fight, standing, in state 7. */
  const bossFighting = (entrance = 2): Actor => {
    const obj = spawnBoss(entrance);
    G.g_script_flags[BOSS4_DROP_FLAG] = 1;
    tickBoss(obj, 420);
    return obj;
  };

  // **Init.**
  {
    const obj = spawnBoss(0);
    check("Boss4Init counts the boss in both enemy counters",
          G.g_enemies_alive === 1 && G.g_enemies_present === 1,
          `alive ${G.g_enemies_alive} present ${G.g_enemies_present}`);
    check("...takes the entrance state from the descriptor tail, and rides "
          + "the transport for entrances 0 and 1 only",
          obj.boss4?.state === 0 && (obj.boss4!.flags & 1) === 1
          && (spawnBoss(2).boss4!.flags & 1) === 0,
          `state ${obj.boss4?.state} flags ${obj.boss4?.flags}`);
    const b = spawnBoss(0).boss4!;
    check("...seats phase 0xFF, two props, no cue, the rise 6.0 and the rank "
          + "from GetDamageRank",
          b.phase === 0xff && b.propsLeft === 2 && b.cueQueued === -1
          && b.cueStep === 0 && b.cameraRise === 6
          && b.rank === G.g_damage_rank,
          JSON.stringify({ phase: b.phase, rank: b.rank }));
    const o2 = spawnBoss(0);
    check("...keeps him out of the shot test (0x8000) and puts bone 5 on "
          + "model 0x444",
          (o2.flags & ActorFlag.NoShotTest) !== 0
          && o2.boneSlot["5"] === 0x444);
    check("...and gives the ten tail words to their bones as collision meshes",
          Object.keys(o2.boneColi).length === 10
          && o2.boneColi["1"] === "4:23984" && o2.boneColi["2"] === undefined
          && o2.boneColi["14"] === "4:3632",
          JSON.stringify(o2.boneColi));
  }

  // The gate chain, one link at a time. Entrance 0 must wait for the script's
  // own `set_script_flag 30` before it will even leave the transport.
  {
    const obj = spawnBoss(0);
    tickBoss(obj, 400);
    check("without g_script_flags[30] the entrance never leaves sub 1, and "
          + "flag 31 stays down",
          obj.boss4?.sub === 1
          && (G.g_script_flags[BOSS4_FIGHT_READY_FLAG] ?? 0) === 0,
          `sub ${obj.boss4?.sub} flag `
          + `${G.g_script_flags[BOSS4_FIGHT_READY_FLAG]}`);
    check("...and a boss out of the shot test registers nothing",
          !G.g_shot_test_list.some((e) => e.at === obj.at));

    G.g_script_flags[BOSS4_DROP_FLAG] = 1;
    tickBoss(obj, 2);
    check("...the flag drops it off, the chainsaw starts, and it stands to "
          + "wait for the shutter",
          obj.boss4?.sub === 2 && (obj.boss4!.flags & 1) === 0
          && (obj.boss4!.flags & 0x400) !== 0,
          `sub ${obj.boss4?.sub} flags ${obj.boss4!.flags}`);

    tickBoss(obj, 200);
    check("...and 200 frames later the shutter is still shut, because the "
          + "banner has not finished",
          G.g_bHudShutterState !== 1
          && (G.g_script_flags[BOSS4_FIGHT_READY_FLAG] ?? 0) === 0,
          `shutter ${G.g_bHudShutterState}`);
    tickBoss(obj, 200);
    check("...the banner reaches frame 300, sets the shutter to 1, and the "
          + `entrance raises g_script_flags[${BOSS4_FIGHT_READY_FLAG}]`,
          G.g_bHudShutterState === 1
          && G.g_script_flags[BOSS4_FIGHT_READY_FLAG] === 1,
          `shutter ${G.g_bHudShutterState} flag `
          + `${G.g_script_flags[BOSS4_FIGHT_READY_FLAG]}`);
    check("...and hands over to state 7 with the phase-0 floor, 8/9 of 300",
          obj.boss4?.state === Boss4State.FaceCamera
          && obj.boss4.phase === 0
          && obj.boss4.phaseHpFloor
             === Math.fround(300 * BOSS4_TABLES.phase_hp_fraction[0]),
          `state ${obj.boss4?.state} floor ${obj.boss4?.phaseHpFloor}`);
    check("...with the health bar at (320, 35), g_boss_engaged up and his "
          + "0x8000 gone",
          G.g_boss_hp_bars.length === 1 && G.g_boss_hp_bars[0].x === 320
          && G.g_boss_hp_bars[0].y === 35 && G.g_boss_engaged === 1
          && (obj.flags & ActorFlag.NoShotTest) === 0,
          `bars ${G.g_boss_hp_bars.length} engaged ${G.g_boss_engaged}`);
    check("...and the phase's camera cue already running: cue 0 on path 185",
          obj.boss4!.cueStep !== 0 && obj.boss4!.cuePath === 185
          && G.g_camera_driver_held === 1,
          `step ${obj.boss4!.cueStep} path ${obj.boss4!.cuePath}`);
    tickBoss(obj, 1);
    check("...and from here Boss4Update registers him for the shot test "
          + "through ActorRegisterCameraPoint",
          G.g_shot_test_list.some((e) => e.at === obj.at)
          && g_class_handlers[SpawnClass.Boss4]?.registersForShotTest === true,
          `${G.g_shot_test_list.length}`);
  }

  // Entrances 2 and 3 are already standing: no transport, no flag-30 wait.
  {
    const obj = spawnBoss(2);
    tickBoss(obj, 1);
    check("entrance 2 goes straight to the shutter wait, with no flag 30",
          obj.boss4?.sub === 2
          && (G.g_script_flags[BOSS4_DROP_FLAG] ?? 0) === 0,
          `sub ${obj.boss4?.sub}`);
    tickBoss(obj, 400);
    check("...but its banner still waits on flag 30, so flag 31 stays down",
          (G.g_script_flags[BOSS4_FIGHT_READY_FLAG] ?? 0) === 0,
          `flag ${G.g_script_flags[BOSS4_FIGHT_READY_FLAG]}`);
  }

  // **The boss holds the camera**, while bit 0x10000 is clear:
  // `Boss4Update`'s `ActorRegisterCameraPoint(state+0x70)` at `0x00491A49`
  // ends in `RegisterForCameraTracking`, and the next fill deals him a slot.
  {
    const obj = bossFighting();
    obj.flags &= ~ActorFlag.NoCameraTrack;
    UpdateCameraEnemySlots();
    ActorRegisterCameraPoint(obj, NULL_HOST, obj.boss4!.cameraRise);
    UpdateCameraEnemySlots();
    check("the stage-4 boss is a camera candidate while bit 0x10000 is clear",
          slotHolds(obj.at), slotsShown());
    obj.flags |= ActorFlag.NoCameraTrack;
    ActorRegisterCameraPoint(obj, NULL_HOST, obj.boss4!.cameraRise);
    UpdateCameraEnemySlots();
    check("...and not once it is raised", !slotHolds(obj.at), slotsShown());
  }

  // **The damage model**: the head by table, flesh by one, the rest nothing.
  {
    const obj = bossFighting();
    const b = obj.boss4!;
    const before = obj.hp;
    const headDamage = BOSS4_TABLES.head_damage[
      G.g_players_in_play + b.rank * 2];
    shoot(obj, 4, 0x3c);
    check("a spark surface on a mesh bone costs the boss nothing",
          obj.hp === before, `${before} -> ${obj.hp}`);
    shoot(obj, 4, 0x35);
    check("...nor does the silent one",
          obj.hp === before, `${obj.hp}`);
    // A posed bone for the mark to be taken into: identity, a unit up.
    const posed: GameHost = {
      ...NULL_HOST,
      boneMatrix: (_at, _bone, out) => {
        for (let i = 0; i < 16; i++) out[i] = i % 5 === 0 ? 1 : 0;
        out[13] = 1;
        return true;
      },
    };
    shoot(obj, 4, 0x3d, posed);
    check("...while flesh (surface 0x3D) costs exactly one and leaves a mark "
          + "on the bone",
          obj.hp === before - 1 && G.g_boss4_hit_marks.length === 1
          && G.g_boss4_hit_marks[0].bone === 4,
          `${obj.hp} marks ${G.g_boss4_hit_marks.length}`);
    const score = G.g_player_score[0];
    shoot(obj, 2);
    check("a head shot costs g_boss4_head_damage[players + rank*2], scores "
          + "ten and counts a head hit",
          obj.hp === before - 1 - headDamage && b.headHits === 1
          && G.g_player_score[0] === score + 10,
          `${obj.hp} (table ${headDamage}) hits ${b.headHits}`);
    check("...writes the bar's fraction, hp / maxhp as a float",
          G.g_boss_hp_fraction === Math.fround(obj.hp / 300),
          `${G.g_boss_hp_fraction}`);
    check("...and puts him in the flinch, feet on the ground",
          b.state === Boss4State.Flinch && b.savedState === Boss4State.FaceCamera
          && (obj.flags & ActorFlag.Reacting) !== 0,
          `state ${b.state}`);
  }

  // **Knock-down against flinch**: the feet decide.
  {
    const obj = bossFighting();
    const air: GameHost = {
      ...NULL_HOST,
      boneWorld: (_at, _bone, out) => {
        out.x = 0; out.y = G.g_camera_fixed_eye_y + 12; out.z = 0;
        return true;
      },
    };
    shoot(obj, 2, 0, air);
    check("a head shot with both feet ten above the ground is the knock-down",
          obj.boss4?.state === Boss4State.KnockDown, `${obj.boss4?.state}`);
    tickBoss(obj, 1, bossFrame(air));
    check("...which throws him back and down: velocity away from the camera "
          + "and -2.0 of drop, the fall's gravity, the Yarare sound",
          obj.vel.y < -1.5 && obj.accY < 0 && obj.boss4?.sub === 1,
          `vel ${obj.vel.x},${obj.vel.y},${obj.vel.z} sub ${obj.boss4?.sub}`);
    let n = 0;
    while (obj.boss4?.sub === 1 && n < 200) { tickBoss(obj, 1); n++; }
    check("...until he is below the ground, set on it, and waits out the clip",
          obj.boss4?.sub === 2 && obj.pos.y === G.g_camera_fixed_eye_y
          && (obj.flags & ActorFlag.PoseFrozen) === 0,
          `sub ${obj.boss4?.sub} y ${obj.pos.y} after ${n}`);
    n = 0;
    while (obj.boss4?.state === Boss4State.KnockDown && n < 300) {
      tickBoss(obj, 1); n++;
    }
    check("...and then back to state 7 with the reaction over",
          obj.boss4?.state === Boss4State.FaceCamera
          && (obj.flags & ActorFlag.Reacting) === 0,
          `state ${obj.boss4?.state} after ${n}`);
  }

  // **The floor, and the camera cue that lifts it.**
  {
    const obj = bossFighting();
    const b = obj.boss4!;
    let shots = 0;
    while (shots < 40 && !(obj.flags & ActorFlag.ShotImmune)) {
      obj.flags &= ~ActorFlag.Reacting;
      b.state = Boss4State.FaceCamera;
      shoot(obj, 2);
      shots += 1;
    }
    check("the boss refuses damage the moment the phase floor is reached",
          (obj.flags & ActorFlag.ShotImmune) !== 0 && obj.hp > 0
          && obj.hp <= b.phaseHpFloor,
          `${shots} shots, hp ${obj.hp}, floor ${b.phaseHpFloor}`);
    const hp = obj.hp;
    shoot(obj, 2);
    check("...and a shot then costs nothing", obj.hp === hp, `${obj.hp}`);
    obj.flags &= ~ActorFlag.Reacting;
    b.state = Boss4State.FaceCamera;
    b.sub = 0;
    // Cue 0 runs out at frame 220 of path 185, 0.7 a frame.
    let n = 0;
    while (b.phase === 0 && n < 600) { tickBoss(obj, 1); n++; }
    check("once the entrance's cue has run out, the floor moves the phase on: "
          + "phase 1, cue 1 queued, the transition up, off the camera",
          b.phase === 1 && (b.flags & 8) !== 0
          && (obj.flags & ActorFlag.NoCameraTrack) !== 0,
          `phase ${b.phase} flags ${b.flags} after ${n}`);
    G.g_cam_path_frame = 0x104;
    tickBoss(obj, 1);
    check("...the camera passing frame 0x104 seats him for phase 1 and loads "
          + "its arena",
          (b.flags & 8) === 0 && b.state === Boss4State.FaceCamera
          && b.arena[2].x === BOSS4_TABLES.phase_arenas[1][2][0],
          `flags ${b.flags} state ${b.state} P2 ${b.arena[2].x}`);
    check("...still refusing damage while he is outside it",
          (obj.flags & ActorFlag.ShotImmune) !== 0);
    obj.pos.x = 265;
    obj.pos.z = -1700;
    tickBoss(obj, 1);
    check("...and five inside the new quad the floor lifts to 7/9 and he is "
          + "fenced",
          (obj.flags & ActorFlag.ShotImmune) === 0
          && b.phaseHpFloor
             === Math.fround(300 * BOSS4_TABLES.phase_hp_fraction[1])
          && (b.flags & 2) !== 0,
          `floor ${b.phaseHpFloor} flags ${b.flags}`);
  }

  // **A strike costs a life** -- unless an arena transition is pending.
  {
    const obj = bossFighting();
    const b = obj.boss4!;
    b.state = Boss4State.StrikeClip65;
    b.sub = 0;
    obj.attackPermit = 0;
    const lives = G.g_player_lives[0];
    let n = 0;
    while (b.state === Boss4State.StrikeClip65 && n < 300) {
      tickBoss(obj, 1); n++;
    }
    check("strike 0xF lands on cursor 0x37 and costs player 0 one life, then "
          + "state 5",
          G.g_player_lives[0] === lives - 1
          && b.state === Boss4State.ChooseAction,
          `lives ${lives} -> ${G.g_player_lives[0]} state ${b.state}`);
    const o2 = bossFighting();
    RunOutInvulnerability();
    const b2 = o2.boss4!;
    b2.state = Boss4State.StrikeClip65;
    b2.sub = 0;
    b2.flags |= 8;
    o2.attackPermit = 0;
    const l2 = G.g_player_lives[0];
    for (let i = 0; i < 200 && MotionPlayFrame(o2) !== 0x38; i++) {
      tickBoss(o2, 1);
    }
    check("...and with flag 8 up it lands on nobody and leaves 0x2000 raised",
          G.g_player_lives[0] === l2
          && (o2.flags & ActorFlag.NoHitReaction) !== 0,
          `lives ${G.g_player_lives[0]} flags ${o2.flags.toString(16)}`);
  }

  // **The throw**: phase 3, a prop into the hand, out on frame 68.
  {
    const obj = bossFighting();
    const b = obj.boss4!;
    b.phase = 3;
    b.state = Boss4State.ThrowHeldProp;
    b.sub = 0;
    tickBoss(obj, 1);
    const rec = BOSS4_TABLES.held_props[b.w74];
    check("the throw picks one of the two props and plays its clip",
          (b.w74 === 0 || b.w74 === 1) && obj.motion === rec.clip,
          `w74 ${b.w74} motion ${obj.motion}`);
    while (MotionPlayFrame(obj) <= rec.take) tickBoss(obj, 1);
    const prop = G.g_carried_props.find((q) => q.id === b.heldProp);
    check("...on its take frame a carried prop appears in the hand -- "
          + "behaviour 2, type 2, slot 0x396, refusing damage -- and bone 8 "
          + "changes to 0x442",
          prop !== undefined && prop.routine === 2 && prop.type === 2
          && prop.slot === 0x396 && (prop.flags & ActorFlag.ShotImmune) !== 0
          && obj.boneSlot["8"] === 0x442 && b.propsLeft === 1
          && b.propsUsed === 1 << b.w74,
          `prop ${JSON.stringify(prop && { r: prop.routine, s: prop.slot })}`);
    while (MotionPlayFrame(obj) <= rec.throw) tickBoss(obj, 1);
    check("...on frame 68 it is let go at a player, who is marked as "
          + "attacked, and the hand is empty again",
          prop!.mode === 4 && prop!.player === 0
          && G.g_attack_permits[0] === 1 && obj.boneSlot["8"] === 0x441,
          `mode ${prop!.mode} player ${prop!.player} `
          + `permit ${G.g_attack_permits[0]}`);
    let n = 0;
    while (b.state === Boss4State.ThrowHeldProp && n < 300) {
      tickBoss(obj, 1); n++;
    }
    check("...and at the clip's end he goes to state 5",
          b.state === Boss4State.ChooseAction, `${b.state}`);
  }

  // **The death, and the second gate.**
  {
    const obj = bossFighting(3);
    const b = obj.boss4!;
    let n = 0;
    b.phaseHpFloor = 0;
    b.phase = 17;
    let shots = 0;
    while (shots < 40 && obj.hp > 0) {
      obj.flags &= ~ActorFlag.Reacting;
      b.state = Boss4State.FaceCamera;
      shoot(obj, 2);
      shots += 1;
    }
    check("the hit points running out send the boss to state 0x16 and empty "
          + "the bar",
          b.state === Boss4State.Death && (obj.flags & ActorFlag.Dead) !== 0
          && G.g_enemies_alive === 0 && G.g_boss_hp_fraction === 0,
          `state ${b.state} alive ${G.g_enemies_alive}`);
    check("...and nothing has raised flag 32 yet: it is on a clip frame, not "
          + "on the frame the bar empties",
          (G.g_script_flags[BOSS4_DEAD_FLAG] ?? 0) === 0);
    tickBoss(obj, 40);
    check("...still down forty frames into the fall, g_boss_engaged down",
          (G.g_script_flags[BOSS4_DEAD_FLAG] ?? 0) === 0
          && G.g_boss_engaged === 0,
          `cursor ${MotionPlayFrame(obj)}`);
    n = 0;
    while (MotionPlayFrame(obj) < 0x46 && n < 200) { tickBoss(obj, 1); n++; }
    check("...and up once the death clip reaches frame 0x46, which is "
          + `g_script_flags[${BOSS4_DEAD_FLAG}]`,
          G.g_script_flags[BOSS4_DEAD_FLAG] === 1,
          `cursor ${MotionPlayFrame(obj)} flag `
          + `${G.g_script_flags[BOSS4_DEAD_FLAG]}`);
    check("...with the body laid at the second arena's spot, facing 0x8000",
          obj.pos.x === Math.fround(-515.1) && obj.pos.z === Math.fround(-1718.4)
          && obj.yaw === 0x8000,
          `${obj.pos.x},${obj.pos.z} yaw ${obj.yaw}`);
    tickBoss(obj, 70);
    check("...the landing on frame 0x82 stops the chainsaw and shakes the "
          + "screen",
          (b.flags & 0x400) === 0 && G.g_screen_shake_frames > 0,
          `flags ${b.flags} shake ${G.g_screen_shake_frames}`);
    check("...and g_enemies_present is not given back until the 240-frame "
          + "dwell runs out",
          G.g_enemies_present === 1, `${G.g_enemies_present}`);
    tickBoss(obj, BOSS4_DEATH_DWELL + 240);
    check("...and then it is, exactly once",
          G.g_enemies_present === 0, `${G.g_enemies_present}`);
    G.g_active_cam_path = 182;
    G.g_cam_path_frame = 0;
    tickBoss(obj, 1);
    check("the camera reaching the tail's pair (182, 0) despawns him",
          obj.despawned === true);
  }

  // The half that decides whether the gate is evaluated at all.
  {
    ResetGameGlobals();
    EnterPlay();
    SetGameTables(BOSS_CHARS);
    const bossScript = {
      scene: 0, stage: 4, game_mode: 0, evt_file: "test", entry_block: 0,
      entry_step: 0, routes: [{ kind: "end", next: [-1, -1, -1] }],
      regions: [], cam_slots_used: [], warnings: [],
      blocks: [{
        index: 0, at: 0, route: { kind: "end", next: [-1, -1, -1] },
        steps: [{ index: 0, at: 0, ops: [{
          i: 0, at: 0x100, op: 0x0c, name: "spawn_obj_c", cat: "spawn",
          spawns: [{ at: 35976, class: SpawnClass.Boss4, flags: 0,
                     pos: [0, 0, 0], yaw_deg: 0, orient: [0, 0, 0], hp: 300,
                     desc_flags: 0 }],
        }] }],
      }],
    } as unknown as ScriptJson;
    const can = ScriptFlagsThisBundleCanRaise(bossScript);
    check("a stage that spawns class 0x19 can raise flag 31 and flag 32",
          can.has(BOSS4_FIGHT_READY_FLAG) && can.has(BOSS4_DEAD_FLAG),
          `${[...can].sort((a, b) => a - b).join(",")}`);
  }

  // The shutter byte lives in `G` because `game/` writes it, and the machine
  // has to notice a write that did not come through evt 0x1F.
  {
    ResetGameGlobals();
    EnterPlay();
    HudDrawShutterState();             // the scene's first frame: 5, then 4
    G.g_bHudShutterState = 1;          // as `BossIntroBannerUpdate` writes it
    HudDrawShutterState();
    check("a shutter state written from game/ seeds the slide and raises the "
          + "firing gate",
          G.g_hud_shutter_counter === 1 && G.g_nFiringGate === 1,
          `counter ${G.g_hud_shutter_counter} gate ${G.g_nFiringGate}`);
    for (let i = 0; i < SHUTTER_FRAMES; i++) HudDrawShutterState();
    check("...and the slide still finishes into state 2",
          G.g_bHudShutterState === 2, `state ${G.g_bHudShutterState}`);
  }
  SetBoss4Tables(undefined, undefined);
}

/**
 * Class 0x14 — the stage-2 boss, and the twenty-one `wait_script_flag` gates
 * it is the only writer of.
 *
 * Every frame here is either a real `GameUpdate` or the class's own
 * `Class14Update`, and nothing the engine sets is set by hand: the stage-2
 * shutter comes from the boss-name banner the entrance spawns (L49), the
 * damage from a ray that has to find the weak point through both of the
 * engine's gates, and the deaths from the reactions' own cue frames. The
 * boss carries the model block (`game/skeleton.ts`), so its pose is the
 * game's own and needs no renderer.
 *
 * The fixture is `boss2.bin` as the bundle carries it -- the real skeleton,
 * the real clip lengths -- with every clip's angles and root at zero, and
 * class 0x14's `.rdata` read out of `Hod2.exe` by `web/src/hod2lib/class14.ts`.
 */
console.log("\nclass 0x14, the stage-2 boss:");
{
  const C14_TABLES = {"anim_slots":[{"motion":21,"cues":[[11,0],[45,2],[60,0]],"end_code":3},
    {"motion":22,"cues":[[30,0],[53,2],[82,0]],"end_code":3},{"motion":23,
    "cues":[[30,0],[53,2],[82,0]],"end_code":3},{"motion":24,"cues":[[25,0],
    [50,2],[75,0]],"end_code":3},{"motion":25,"cues":[[30,2]],"end_code":3},
    {"motion":26,"cues":[[40,2]],"end_code":3},{"motion":27,"cues":[],
    "end_code":6},{"motion":28,"cues":[],"end_code":0},{"motion":29,"cues":[],
    "end_code":0},{"motion":30,"cues":[[2,0],[13,6],[20,4],[50,2]],
    "end_code":0},{"motion":31,"cues":[[1,0],[10,6],[20,4],[40,2]],
    "end_code":0},{"motion":33,"cues":[],"end_code":0},{"motion":34,"cues":[],
    "end_code":0},{"motion":37,"cues":[[32,6],[55,3]],"end_code":0},
    {"motion":38,"cues":[],"end_code":0},{"motion":39,"cues":[],"end_code":0},
    {"motion":40,"cues":[],"end_code":6},{"motion":43,"cues":[[30,0],[50,2],
    [93,0],[110,3]],"end_code":6},{"motion":44,"cues":[],"end_code":6},
    {"motion":45,"cues":[[32,6],[45,1]],"end_code":0},{"motion":47,"cues":[],
    "end_code":6},{"motion":49,"cues":[[25,0],[47,2]],"end_code":0},
    {"motion":50,"cues":[[20,0],[105,3]],"end_code":0},{"motion":51,
    "cues":[[35,2],[45,1],[100,6],[130,1]],"end_code":0},{"motion":52,
    "cues":[[35,3]],"end_code":2},{"motion":53,"cues":[[12,3]],"end_code":2},
    {"motion":54,"cues":[[25,3]],"end_code":2},{"motion":55,"cues":[],
    "end_code":0},{"motion":58,"cues":[[7,2],[41,3]],"end_code":2},
    {"motion":46,"cues":[],"end_code":0}],"damage_cones":[[0,0,0,0],[0,0,0,0],
    [0,0,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,0],[0,
    0,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,
    0],[0,0,0,0],[0,0,0,0],[2560,-20480,6144,16384],[4096,-18432,4096,16384],
    [4096,-16384,2048,16384],[4352,-12288,-2048,16384],[4352,-8192,-6144,
    16384],[4352,-6144,-8192,16384],[5120,-4096,-10240,16384],[5376,-4096,
    -10240,16384],[5632,-4096,-10240,16384],[5888,-4096,-10240,16384],[6144,
    -4096,-10240,16384],[6400,-4096,-10240,16384],[6656,-4096,-10240,16384],
    [6912,-4096,-10240,16384],[7168,-4096,-10240,16384],[7424,-4096,-10240,
    16384],[7680,-4096,-10240,16384],[7936,-4096,-10240,16384],[8192,-4096,
    -10240,16384],[8192,-4096,-10240,16384],[8192,-4096,-10240,16384]],
    "window_timing":[{"open_hold":100,"shut_hold":30,"open_rate":2.0,
    "close_rate":-1.0},{"open_hold":50,"shut_hold":25,"open_rate":2.0,
    "close_rate":-1.0},{"open_hold":30,"shut_hold":20,"open_rate":2.5,
    "close_rate":-1.25},{"open_hold":15,"shut_hold":10,"open_rate":2.5,
    "close_rate":-1.25},{"open_hold":10,"shut_hold":5,"open_rate":3.0,
    "close_rate":-1.5},{"open_hold":2,"shut_hold":1,"open_rate":4.0,
    "close_rate":-2.0},{"open_hold":1,"shut_hold":0,"open_rate":5.0,
    "close_rate":-2.5},{"open_hold":0,"shut_hold":0,"open_rate":6.0,
    "close_rate":-3.0}],"summon_delays_a":[75,75,70,70,65,65,60,60,55,55,50,
    50,45,45,40,40],"summon_delays_b":[70,70,65,65,60,60,55,55,50,50,45,45,40,
    40,35,35],"summon_counts":[[5,4,3],[6,5,4],[6,5,4],[6,5,4],[6,5,4],[7,6,
    5],[7,6,5],[7,6,5],[7,6,5],[8,7,6],[8,7,6],[8,7,6],[8,7,6],[9,8,7],[9,8,
    7],[9,8,7]],"phase_hp_frac":[0.5333340167999268,0.3333339989185333,0.0,
    0.5333340167999268,0.3333339989185333,0.22222299873828888,
    0.11111199855804443,0.0,0.5,0.0],"bone_damage":[[30,28],[28,26],[27,24],
    [26,23],[25,22],[25,22],[24,21],[24,21],[23,20],[23,20],[22,19],[22,19],
    [21,18],[20,17],[18,15],[16,13]]} as unknown as Class14Json;
  const C14_BONES = [{"bone":1,"part":"bone01_031f","slot":799,"offset":[0,0,0],"parent":null,
    "hit_centre":[0,2.25,0],"hit_radius":5.550000190734863},{"bone":2,
    "part":"bone02_0319","slot":793,"offset":[-0.0020000000949949026,
    8.369799613952637,0.6215000152587891],"parent":0,"hit_centre":[0,
    0.20000000298023224,2.4000000953674316],"hit_radius":2.4000000953674316},
    {"bone":3,"part":"bone03_031b","slot":795,"offset":[-4.504000186920166,
    4.659999847412109,0.23800000548362732],"parent":0,
    "hit_centre":[0.20000000298023224,-2.0999999046325684,0],
    "hit_radius":3.299999952316284},{"bone":4,"part":"bone04_0323","slot":803,
    "offset":[0,-5.77400016784668,0],"parent":2,"hit_centre":[0,
    -2.450000047683716,0],"hit_radius":2.799999952316284},{"bone":5,
    "part":"bone05_0321","slot":801,"offset":[0,-5.776000022888184,0],
    "parent":3,"hit_centre":[0,-1.649999976158142,0],
    "hit_radius":2.1500000953674316},{"bone":6,"part":"bone06_031a",
    "slot":794,"offset":[4.504000186920166,4.659999847412109,
    0.23800000548362732],"parent":0,"hit_centre":[0.20000000298023224,
    -2.0999999046325684,0],"hit_radius":3.299999952316284},{"bone":7,
    "part":"bone07_0322","slot":802,"offset":[0,-5.77400016784668,0],
    "parent":5,"hit_centre":[0,-2.450000047683716,0],
    "hit_radius":2.799999952316284},{"bone":8,"part":"bone08_0320","slot":800,
    "offset":[0,-5.776000022888184,0],"parent":6,"hit_centre":[0,
    -1.649999976158142,0],"hit_radius":2.1500000953674316},{"bone":9,
    "part":"bone09_031c","slot":796,"offset":[0,-1.8480000495910645,0],
    "parent":null,"hit_centre":[0,-2.700000047683716,0],"hit_radius":3.5},
    {"bone":10,"part":"bone10_031e","slot":798,"offset":[-1.9019999504089355,
    -4.1539998054504395,-0.004000000189989805],"parent":8,"hit_centre":[0,
    -3.6500000953674316,0],"hit_radius":3.6500000953674316},{"bone":11,
    "part":"bone11_0318","slot":792,"offset":[0,-8.432000160217285,0],
    "parent":9,"hit_centre":[0,-3.4000000953674316,0],
    "hit_radius":4.550000190734863},{"bone":12,"part":"bone12_02ca",
    "slot":714,"offset":[0,-9.513999938964844,0],"parent":10,"hit_centre":[0,
    -0.30000001192092896,1.600000023841858],"hit_radius":2.3499999046325684},
    {"bone":13,"part":"bone13_031d","slot":797,"offset":[1.9019999504089355,
    -4.1539998054504395,-0.004000000189989805],"parent":8,"hit_centre":[0,
    -3.6500000953674316,0],"hit_radius":3.6500000953674316},{"bone":14,
    "part":"bone14_0317","slot":791,"offset":[0,-8.432000160217285,0],
    "parent":12,"hit_centre":[0,-3.4000000953674316,0],
    "hit_radius":4.550000190734863},{"bone":15,"part":"bone15_02c9",
    "slot":713,"offset":[0,-9.513999938964844,0],"parent":13,"hit_centre":[0,
    -0.30000001192092896,1.600000023841858],"hit_radius":2.3499999046325684}] as CharacterType["bones"];
  // Type 0x47's rows each name their node's own slot, which is what the
  // exporter's `hit_slot` says and what `SkeletonWalkNode` tests before it
  // takes one -- so every row with a radius is taken.
  for (const b of C14_BONES) if (b.hit_radius) b.hit_slot = b.slot;
  const C14_LENGTHS: Record<string, [number, number]> = {"21":[50,98],"22":[55,108],"23":[55,108],"24":[50,98],"25":[25,48],
    "26":[33,64],"27":[31,59],"28":[30,58],"29":[18,34],"30":[61,119],
    "31":[35,68],"32":[65,128],"33":[60,118],"34":[56,109],"35":[30,58],
    "36":[31,59],"37":[61,119],"38":[76,149],"39":[20,38],"40":[26,49],
    "41":[35,68],"42":[30,58],"43":[66,129],"44":[2,1],"45":[41,79],"46":[26,
    50],"47":[25,48],"48":[51,99],"49":[101,199],"50":[96,189],"51":[86,169],
    "52":[35,68],"53":[15,28],"54":[25,48],"55":[61,119],"56":[66,129],
    "57":[66,129],"58":[40,78]};
  const TYPE14: CharacterType = {
    ...TYPE, type: 0x47, name: "boss2", file: "boss2.bin", bone_count: 16,
    bones: C14_BONES,
    motions: Object.fromEntries(Object.entries(C14_LENGTHS)
      .map(([k, [n, p]]) => [k, motion(n, 0, p)])),
  };
  const CHARS14 = {
    ...CHARS, types: { ...CHARS.types, "71": TYPE14 }, class14: C14_TABLES,
  } as unknown as CharactersJson;

  /** Stage 5 block 3's descriptor tail, as the bundle carries it. */
  const desc14 = (state: number) => ({
    char_type: 0x47, state,
    dir: [0, 0, 1] as [number, number, number],
    route: [[60, 0, -40], [60, 0, -140],
            [-90, 0, -140], [-90, 0, -40]] as [number, number, number][],
    despawn_path: 209, despawn_frame: 0,
  });

  /**
   * A camera at `eye` looking at `at` (down -Z when `at` is not given), in
   * the engine's sign: `-z` is in front.
   */
  const camHost = (eye: Vec3, at?: Vec3): GameHost => {
    const f = at ? vec3(at.x - eye.x, at.y - eye.y, at.z - eye.z)
      : vec3(0, 0, -1);
    const fl = Math.hypot(f.x, f.y, f.z);
    f.x /= fl; f.y /= fl; f.z /= fl;
    // right = f x up, up' = right x f
    let r = vec3(-f.z, 0, f.x);
    const rl = Math.hypot(r.x, r.z);
    r = rl > 1e-6 ? vec3(r.x / rl, 0, r.z / rl) : vec3(1, 0, 0);
    const u = vec3(r.y * f.z - r.z * f.y, r.z * f.x - r.x * f.z,
                   r.x * f.y - r.y * f.x);
    return {
      ...NULL_HOST,
      viewSpaceOfPoint: (p, out) => {
        const dx = p.x - eye.x, dy = p.y - eye.y, dz = p.z - eye.z;
        out.x = dx * r.x + dy * r.y + dz * r.z;
        out.y = dx * u.x + dy * u.y + dz * u.z;
        out.z = -(dx * f.x + dy * f.y + dz * f.z);
        return true;
      },
      viewPoint: (x, y, z, out) => {
        out.x = eye.x + r.x * x + u.x * y - f.x * z;
        out.y = eye.y + r.y * x + u.y * y - f.y * z;
        out.z = eye.z + r.z * x + u.z * y - f.z * z;
      },
    };
  };

  const spawnBoss = (state: number, hp: number, rng: Rng): Boss2Actor => {
    const a = ActorSpawn(0x2400, SpawnClass.Boss2, 0x47, "boss2",
                         { class14: desc14(state), pos: vec3(0, 0, -90),
                           hp, maxHp: hp, visible: true }, rng);
    if (a.cls !== SpawnClass.Boss2) throw new Error("not class 0x14");
    return a;
  };
  const c14Scene = (rng: Rng): Events => {
    const events = scene(0, rng);
    SetGameTables(CHARS14);
    G.g_player_no_damage[0] = 1;
    return events;
  };

  // -- Init: the model block, the flipbooks, the rank --------------------
  {
    const rng = new Rng(3);
    c14Scene(rng);
    const a = spawnBoss(Class14State.Entrance0, 300, rng);
    const t = a.boss2;
    check("Init builds the model block: sixteen bones, rotation order 1",
          a.skel?.bones.length === 16 && a.skel.order === 1,
          `${a.skel?.bones.length} order ${a.skel?.order}`);
    check("...seats the camera rise at 6.0 and the shot sphere at 30",
          t.cameraRise === 6 && a.hitRadius === 30,
          `${t.cameraRise} ${a.hitRadius}`);
    check("...is out of the shot test (0x8000) with the per-bone bit up",
          (a.flags & ActorFlag.NoShotTest) !== 0
          && (a.flags & ActorFlag.ShootPerBone) !== 0,
          `0x${a.flags.toString(16)}`);
    check("...and seeds both flipbooks: A 0x2CB..0x2ED at 1.0, B 0x2EE..0x315 "
          + "at window 0's open rate 2.0",
          t.bookA.frame === 0x2cb && t.bookA.high === 0x2ed
          && t.bookA.rate === 1 && t.bookB.frame === 0x2ee
          && t.bookB.high === 0x315 && t.bookB.rate === 2,
          JSON.stringify([t.bookA, t.bookB]));
    check("...both enemy counters, and the hit slot the model build claims",
          G.g_enemies_present === 1 && G.g_enemies_alive === 1
          && a.hitSlot !== HIT_SLOT_NONE,
          `${G.g_enemies_present} ${G.g_enemies_alive} slot ${a.hitSlot}`);
  }

  // -- the stage-2 gate chain, driven by the banner ----------------------
  //
  // Entrance A raises flag 9; the banner record `0x005966B8` waits on it,
  // flies for 300 frames and opens the shutter; the entrance hands over on
  // the shutter and raises flag 10. No line of this test writes the shutter.
  {
    const rng = new Rng(5);
    const events = c14Scene(rng);
    G.g_bHudShutterState = 2;
    const a = spawnBoss(Class14State.Entrance0, 300, rng);
    const host = camHost(EYE);
    let flag9At = -1, shutterAt = -1, huntAt = -1;
    for (let i = 0; i < 3000 && huntAt < 0; i++) {
      GameUpdate(1 / 60, host, rng, events);
      if (flag9At < 0 && G.g_script_flags[9]) flag9At = i;
      if (shutterAt < 0 && G.g_bHudShutterState === 1) shutterAt = i;
      if (a.boss2.state === Class14State.Hunt) huntAt = i;
    }
    check("entrance A raises flag 9 from its own clip",
          flag9At > 0, `frame ${flag9At}`);
    check("...the banner it spawned opens the shutter 300 frames on",
          shutterAt > flag9At && shutterAt - flag9At >= 300,
          `flag 9 at ${flag9At}, shutter at ${shutterAt}`);
    check("...and the boss hands over to Hunt on that shutter",
          huntAt >= shutterAt && huntAt - shutterAt <= 1,
          `shutter ${shutterAt} hunt ${huntAt}`);
    check("...raising g_script_flags[10], the stage's first gate",
          G.g_script_flags[10] === 1);
    check("...spawning the health bar at (320, 35) and engaging the boss",
          G.g_boss_hp_bars.length === 1 && G.g_boss_hp_bars[0].x === 320
          && G.g_boss_hp_bars[0].y === 35 && G.g_boss_engaged === 1
          && G.g_boss_hp_fraction === 1,
          `${JSON.stringify(G.g_boss_hp_bars)} engaged ${G.g_boss_engaged}`);
    check("...and joining the shot test", (a.flags & ActorFlag.NoShotTest) === 0
          && G.g_shot_test_list.some((e) => e.at === a.at),
          `0x${a.flags.toString(16)}`);
  }

  // -- the weak point: bone 1, the 3.5 sphere, the window, the cone ------
  //
  // A direction search rather than a hand-built shot: the cone is the
  // engine's own table and the bone's frame is the pose's, so the test asks
  // which of 2048 directions around the boss would land, and asserts what
  // the gates allow and refuse among them.
  const gateRig = (seed: number) => {
    const rng = new Rng(seed);
    const events = c14Scene(rng);
    const a = spawnBoss(Class14State.Hunt, 300, rng);
    a.flags &= ~ActorFlag.NoShotTest;
    a.boss2.state = Class14State.Hunt;
    Class14AdvanceMotionAndPublishPoints(a);     // pose with hit centres
    return { rng, events, a };
  };
  /** A camera 40 out along `d` in bone 1's frame, aiming at `aim`. */
  const shootFrom = (a: Boss2Actor, d: Vec3, off: Vec3, rng: Rng,
                     events: Events, bone = 1): number => {
    const W1 = a.skel!.bones[1].mat;
    const P = vec3();
    const m = MatCopy(MatIdentity(), W1);
    MatrixTranslate(m, 0, 4, 1);
    MatrixGetTranslation(m, P);
    const dw = vec3();
    MatrixTransformVector(W1, d, dw);
    const eye = vec3(P.x + dw.x * 40, P.y + dw.y * 40, P.z + dw.z * 40);
    const aim = vec3(P.x + off.x, P.y + off.y, P.z + off.z);
    const l = Math.hypot(aim.x - eye.x, aim.y - eye.y, aim.z - eye.z);
    G.g_crosshair_ray[0] = {
      origin: eye,
      dir: vec3((aim.x - eye.x) / l, (aim.y - eye.y) / l, (aim.z - eye.z) / l),
    };
    const hp = a.hp;
    MarkActorShot(a, 0, bone);
    Class14ResolveShotBone(a, rng, camHost(eye, aim), events);
    return hp - a.hp;
  };
  const dirs: Vec3[] = [];
  for (let i = 0; i < 64; i++) {
    for (let j = 1; j < 32; j++) {
      const th = (j / 32) * Math.PI, ph = (i / 64) * Math.PI * 2;
      dirs.push(vec3(Math.sin(th) * Math.sin(ph), Math.cos(th),
                     Math.sin(th) * Math.cos(ph)));
    }
  }
  const ZERO = vec3();
  let goodDir: Vec3 | null = null;
  {
    const { rng, events, a } = gateRig(7);
    const t = a.boss2;
    t.bookB.frame = t.bookB.low + 18;
    t.bookB.hold = -1;
    let shutHits = 0;
    for (const d of dirs) {
      a.flags &= ~ActorFlag.Reacting;
      shutHits += shootFrom(a, d, ZERO, rng, events) > 0 ? 1 : 0;
    }
    check("with flipbook B less than 19 frames open no shot damages the boss",
          shutHits === 0 && a.hp === 300, `${shutHits} landed, hp ${a.hp}`);
    t.bookB.frame = t.bookB.low + 30;
    let open = 0;
    /** The bone the registered shot test would hand a shot along `d`. */
    const pickBone = (d: Vec3): number => {
      const W1 = a.skel!.bones[1].mat;
      const P = vec3();
      const m = MatCopy(MatIdentity(), W1);
      MatrixTranslate(m, 0, 4, 1);
      MatrixGetTranslation(m, P);
      const dw = vec3();
      MatrixTransformVector(W1, d, dw);
      const eye = vec3(P.x + dw.x * 60, P.y + dw.y * 60, P.z + dw.z * 60);
      const host = camHost(eye, P);
      MatrixGetTranslation(W1, a.shotCentre);
      G.g_shot_test_list = [];
      RegisterForShotTest(a, host);
      const l = Math.hypot(P.x - eye.x, P.y - eye.y, P.z - eye.z);
      const c = ProcessPlayerShotsTestList({ origin: eye, dir: vec3(
        (P.x - eye.x) / l, (P.y - eye.y) / l, (P.z - eye.z) / l) }, host);
      return c ? c.bone : 0;
    };
    for (const d of dirs) {
      a.hp = 300;
      a.flags &= ~(ActorFlag.Reacting | ActorFlag.ShotImmune);
      t.state = Class14State.Hunt;
      if (shootFrom(a, d, ZERO, rng, events) > 0) {
        open += 1;
        if (!goodDir && pickBone(d) === 1) goodDir = d;
      }
    }
    check("...among them a direction the shot test itself resolves to bone 1",
          goodDir !== null);
    check("...and with it 30 open, some directions land and most do not: "
          + "the cone", open > 0 && open < dirs.length / 2,
          `${open} of ${dirs.length}`);
    if (goodDir) {
      a.hp = 300;
      a.flags &= ~(ActorFlag.Reacting | ActorFlag.ShotImmune);
      t.state = Class14State.Hunt;
      check("a landing direction aimed 3.6 off the weak point misses: the "
            + "3.5 sphere", shootFrom(a, goodDir, vec3(3.6, 0, 0), rng,
                                     events) === 0 && a.hp === 300,
            `hp ${a.hp}`);
      check("...and the same direction on bone 2 is a ricochet",
            shootFrom(a, goodDir, ZERO, rng, events, 2) === 0);
      a.flags |= ActorFlag.ShotImmune;
      check("...and on bone 1 under the phase immunity (0x100) as well",
            shootFrom(a, goodDir, ZERO, rng, events) === 0);
    }
  }

  // -- two pulls in one frame -------------------------------------------
  // The engine polls the trigger once a frame, so the shot record the gates
  // read back is always the pull that marked the boss. The port's queue lets
  // a whole volley into one frame, and the gates read the marking pull's ray
  // (`Actor.shotRays`), not the frame's last.
  if (goodDir) {
    const { rng, events, a } = gateRig(11);
    a.boss2.bookB.frame = a.boss2.bookB.low + 30;
    const W1 = a.skel!.bones[1].mat;
    const P = vec3();
    const m = MatCopy(MatIdentity(), W1);
    MatrixTranslate(m, 0, 4, 1);
    MatrixGetTranslation(m, P);
    const dw = vec3();
    MatrixTransformVector(W1, goodDir, dw);
    const eye = vec3(P.x + dw.x * 60, P.y + dw.y * 60, P.z + dw.z * 60);
    const host = camHost(eye, P);
    MatrixGetTranslation(W1, a.shotCentre);
    G.g_shot_test_list = [];
    RegisterForShotTest(a, host);
    const pull = (q: Vec3): void => {
      const l = Math.hypot(q.x - eye.x, q.y - eye.y, q.z - eye.z);
      FireShotRequest({ player: 0, frame: 0, onScreen: 1, ray: {
        origin: vec3(eye.x, eye.y, eye.z),
        dir: vec3((q.x - eye.x) / l, (q.y - eye.y) / l, (q.z - eye.z) / l),
      } }, host, rng, events);
    };
    pull(P);                                          // lands: bone 1
    const marked = a.shotBones[0];
    pull(vec3(P.x + 200, P.y + 200, P.z));            // hits nothing
    Class14ResolveShotBone(a, rng, host, events);
    check("two pulls in one frame: the gates read the ray of the pull that "
          + "marked the boss, not the frame's last one",
          marked === 1 && a.hp < 300, `bone ${marked}, hp ${a.hp}`);
  }

  // -- the damage: Arcade takes the table, Original multiplies ------------
  if (goodDir) {
    const hit = (mode: GameMode, scale: number): number => {
      const { rng, events, a } = gateRig(9);
      G.g_GameMode = mode;
      G.g_original_weapon_damage_scale[0] = scale;
      a.boss2.bookB.frame = a.boss2.bookB.low + 30;
      a.boss2.rank = 4;
      return shootFrom(a, goodDir!, ZERO, rng, events);
    };
    const table = C14_TABLES.bone_damage[4][0];
    check("Arcade takes g_class14_bone_damage[rank][0] as it stands -- no "
          + "doubling", hit(GameMode.Arcade, 1) === table,
          `${hit(GameMode.Arcade, 1)} vs ${table}`);
    check("Original multiplies by the weapon factor, 1.0 for every weapon "
          + "the game hands out", hit(GameMode.Original, 1) === table);
    check("...doubles on the -1.0 factor",
          hit(GameMode.Original, -1) === Math.min(33, table * 2),
          `${hit(GameMode.Original, -1)}`);
    check("...and caps at g_boss_shot_damage_cap, 33",
          hit(GameMode.Original, 3) === 33, `${hit(GameMode.Original, 3)}`);
    G.g_GameMode = GameMode.Arcade;
    G.g_original_weapon_damage_scale[0] = 1;
  }

  // -- the bar, the rank bump, the immunity, the reaction ----------------
  if (goodDir) {
    const { rng, events, a } = gateRig(13);
    const t = a.boss2;
    t.phase = Class14Phase.Stage5Open;
    t.bookB.frame = t.bookB.low + 30;
    const d = shootFrom(a, goodDir, ZERO, rng, events);
    check("a damaging hit writes g_boss_hp_fraction = hp / maxhp as a float",
          d > 0 && G.g_boss_hp_fraction === Math.fround(a.hp / 300),
          `${G.g_boss_hp_fraction}`);
    check("...bumps the rank, starts the reaction and opens the window a row",
          t.rankBump === 1 && t.state === Class14State.CuedMotion
          && (a.flags & ActorFlag.Reacting) !== 0 && t.timing === 2,
          `bump ${t.rankBump} state ${Class14State[t.state]} timing ${t.timing}`);
    a.flags &= ~ActorFlag.Reacting;
    a.hp = 151;
    shootFrom(a, goodDir, ZERO, rng, events);
    check("a hit that crosses the phase's fraction raises the immunity",
          (a.flags & ActorFlag.ShotImmune) !== 0 && a.hp <= 150,
          `hp ${a.hp} 0x${a.flags.toString(16)}`);
    a.flags &= ~(ActorFlag.Reacting | ActorFlag.ShotImmune);
    a.hp = 5;
    shootFrom(a, goodDir, ZERO, rng, events);
    check("the killing hit writes 0.0, marks the boss dead and drops the "
          + "alive count", G.g_boss_hp_fraction === 0
          && (a.flags & ActorFlag.Dead) !== 0 && G.g_enemies_alive === 0,
          `${G.g_boss_hp_fraction} alive ${G.g_enemies_alive}`);
  }

  // -- the adaptive rank --------------------------------------------------
  {
    const rng = new Rng(17);
    c14Scene(rng);
    const a = spawnBoss(Class14State.Hunt, 300, rng);
    const t = a.boss2;
    t.state = Class14State.SummonRoundA;
    t.rank = 8;
    t.lives = [3, 3];
    G.g_players_in_play = 1;
    G.g_active_player = 0;
    G.g_player_lives[0] = 2;
    Class14TrackAdaptiveRank(a);
    check("one player: a lost life costs 3, even in a summoning round",
          t.rank === 5 && t.lives[0] === 2, `${t.rank}`);
    t.rankBump = 1;
    Class14TrackAdaptiveRank(a);
    check("...a pending bump is +1", t.rank === 6 && t.rankBump === 0);
    G.g_players_in_play = 2;
    G.g_player_lives[1] = 2;
    Class14TrackAdaptiveRank(a);
    check("two players: 2 in a summoning round", t.rank === 4, `${t.rank}`);
    t.state = Class14State.Hunt;
    G.g_player_lives[1] = 1;
    Class14TrackAdaptiveRank(a);
    check("...3 outside one", t.rank === 1, `${t.rank}`);
    G.g_player_lives[0] = 0;
    Class14TrackAdaptiveRank(a);
    check("...and the rank is clamped at 0", t.rank === 0, `${t.rank}`);
    G.g_players_in_play = 1;
  }

  // -- the summons: sub-types 1 and 2, paced -----------------------------
  {
    const rng = new Rng(19);
    const events = c14Scene(rng);
    G.g_water_wave_field = {
      count: 0, mask: 0, planeY: -25, sources: new Array(8).fill(null),
    };
    const a = spawnBoss(Class14State.Hunt, 300, rng);
    const t = a.boss2;
    const f = { dt: 1 / 60, rng, host: camHost(EYE), events };
    const fish = () => G.g_object_list.filter(
      (o) => o.cls === SpawnClass.WaterEnemy && !o.despawned) as FishActor[];
    t.state = Class14State.SummonRoundA;
    t.sub = 4;
    t.counter0 = 2;
    t.counter1 = 3;
    t.counter2 = 0;
    t.rank = 0;
    G.g_screen_shake_frames = 5;
    Boss2Handler.update(a, f);
    check("round A places nothing while the screen still shakes",
          fish().length === 0 && t.counter1 === 3, `${fish().length}`);
    G.g_screen_shake_frames = 0;
    Boss2Handler.update(a, f);
    const first = fish();
    check("...then one fish, sub-type 1, 100 frames, one under the surface",
          first.length === 1 && first[0].fish.subtype === 1
          && first[0].fish.lungeFrames === 100
          && first[0].pos.y === Math.fround(-25 - 1),
          first.map((o) => `${o.fish.subtype}/${o.fish.lungeFrames}`
                           + `@${o.pos.y}`).join());
    check("...and waits g_class14_summon_delays_a[rank] frames for the next",
          t.counter1 === 2 && t.counter2 === C14_TABLES.summon_delays_a[0],
          `${t.counter1} ${t.counter2}`);
    t.counter2 = 0;
    Boss2Handler.update(a, f);
    check("while the first fish holds a water slot the next is refused -- "
          + "and the round's count still goes down, as the engine's does",
          fish().length === 1 && t.counter1 === 1,
          `${fish().length} fish, ${t.counter1} left`);
    G.g_enemies_alive = 4;
    G.g_water_attack_slots = [0, 0, 0, 0];
    t.counter2 = 0;
    Boss2Handler.update(a, f);
    check("...and with four enemies alive nothing is placed",
          fish().length === 1 && t.counter1 === 1);
    // Round B: sub-type 2, 0x50 frames, ten under, three draws a fish.
    G.g_enemies_alive = 2;
    t.state = Class14State.SummonRoundB;
    t.sub = 6;
    t.counter1 = 1;
    t.counter2 = 0;
    const before = rng.state;
    Boss2Handler.update(a, f);
    const b = fish().find((o) => o.fish.subtype === 2);
    check("round B places sub-type 2, 0x50 frames, ten under the surface",
          b !== undefined && b.fish.lungeFrames === 0x50
          && b.pos.y === Math.fround(-25 - 10),
          `${b?.fish.lungeFrames} @${b?.pos.y}`);
    check("...drawing three rand()s for it", rng.state !== before);
  }

  // -- Class14AdvancePhase ------------------------------------------------
  {
    const rng = new Rng(23);
    c14Scene(rng);
    const a = spawnBoss(Class14State.Entrance2, 200, rng);
    a.boss2.state = Class14State.Hunt;
    a.boss2.phase = Class14Phase.Stage5Open;
    a.hp = 101;
    Class14AdvancePhase(a);
    const held: number = a.boss2.phase;
    check("the phase holds above g_class14_phase_hp_frac[8]",
          held === Class14Phase.Stage5Open, `${Class14Phase[held]}`);
    a.hp = 100;
    Class14AdvancePhase(a);
    const stepped: number = a.boss2.phase;
    const steppedState: number = a.boss2.state;
    check("...and steps to Stage5Final at exactly half",
          stepped === Class14Phase.Stage5Final
          && steppedState === Class14State.Close,
          `phase ${Class14Phase[stepped]} state ${Class14State[steppedState]}`);
    a.boss2.state = Class14State.LeapAttack;
    a.boss2.phase = Class14Phase.Stage5Open;
    a.hp = 1;
    Class14AdvancePhase(a);
    const mid: number = a.boss2.phase;
    check("...and no arm is taken while the boss is not in state 5, 6 or 7",
          mid === Class14Phase.Stage5Open, `${Class14Phase[mid]}`);
  }

  // -- the death fork, where all twenty-one gates are finally opened -----
  for (const [phase, flag, state] of [
    [Class14Phase.ShortFinal, 17, Class14State.DeathA],
    [Class14Phase.LongFinal, 17, Class14State.DeathB],
    [Class14Phase.Stage5Final, 31, Class14State.DeathC],
  ] as [Class14Phase, number, Class14State][]) {
    const rng = new Rng(29);
    const events = c14Scene(rng);
    // Above the body, so the fixture's still clips reach the water: the real
    // sink clip carries bone 1 down to it.
    G.g_water_wave_field = {
      count: 0, mask: 0, planeY: 5, sources: new Array(8).fill(null),
    };
    const a = spawnBoss(Class14State.Hunt, 200, rng);
    const f = { dt: 1 / 60, rng, host: camHost(EYE), events };
    a.boss2.phase = phase;
    a.boss2.state = Class14State.CuedMotion;
    a.boss2.sub = 0;
    a.boss2.savedState = Class14State.Hunt;
    a.hp = 0;
    a.flags |= ActorFlag.Dead;
    let cueFrame = -1;
    for (let i = 0; i < 400 && a.boss2.state === Class14State.CuedMotion; i++) {
      cueFrame = a.skel?.cursor ?? -1;
      Boss2Handler.update(a, f);
    }
    check(`a death in ${Class14Phase[phase]} raises g_script_flags[${flag}] `
          + `and enters ${Class14State[state]} on the reaction's cursor 0x14`,
          G.g_script_flags[flag] === 1 && a.boss2.state === state
          && cueFrame === 0x14,
          `flag ${G.g_script_flags[flag]} state ${Class14State[a.boss2.state]}`
          + ` cursor ${cueFrame}`);
    check("...and raises nothing else",
          [9, 10, 11, 12, 13, 14, 15, 16, 17, 31]
            .filter((n) => n !== flag)
            .every((n) => (G.g_script_flags[n] ?? 0) === 0));
    const present = G.g_enemies_present;
    for (let i = 0; i < 4000 && G.g_enemies_present === present; i++) {
      Boss2Handler.update(a, f);
    }
    check(`...and ${Class14State[state]} takes the body out of `
          + "g_enemies_present, off the camera's list",
          G.g_enemies_present === present - 1
          && (a.flags & ActorFlag.NoCameraTrack) !== 0,
          `present ${G.g_enemies_present} sub ${a.boss2.sub}`);
  }

  // -- stage 5's cameo, end to end ----------------------------------------
  //
  // Entrance C waits for flag 11, the script's shutter hands the fight over,
  // and a player who keeps a landing direction on bone 1 -- the camera
  // follows the boss round, as a rail camera would -- shoots it through the
  // window to death: flag 31, and the body gone from `g_enemies_present`.
  if (goodDir) {
    const rng = new Rng(31);
    const events = c14Scene(rng);
    G.g_bHudShutterState = 2;
    const a = spawnBoss(Class14State.Entrance2, 200, rng);
    G.g_script_flags[11] = 1;
    let eye = vec3(0, 0, 0);
    let look = vec3(0, 0, -90);
    let landed = 0, fired = 0, frames = 0;
    for (; frames < 40000 && G.g_enemies_present > 0; frames++) {
      if (frames === 200) G.g_bHudShutterState = 1;
      if (a.skel && frames > 250 && frames % 8 === 0) {
        const W1 = a.skel.bones[1].mat;
        const P = vec3();
        const m = MatCopy(MatIdentity(), W1);
        MatrixTranslate(m, 0, 4, 1);
        MatrixGetTranslation(m, P);
        const dw = vec3();
        MatrixTransformVector(W1, goodDir, dw);
        eye = vec3(P.x + dw.x * 60, P.y + dw.y * 60, P.z + dw.z * 60);
        look = P;
        const l = Math.hypot(P.x - eye.x, P.y - eye.y, P.z - eye.z);
        QueueOffscreenPull(0);
        QueueShotRequest(0, { origin: eye,
          dir: vec3((P.x - eye.x) / l, (P.y - eye.y) / l, (P.z - eye.z) / l) });
        fired += 1;
      }
      const hp = a.hp;
      HoldCameraAt(eye);
      GameUpdate(1 / 60, camHost(eye, look), rng, events);
      if (a.hp < hp) landed += 1;
    }
    check("stage 5: the cameo is shot to death through its window and "
          + "raises g_script_flags[31]", G.g_script_flags[31] === 1,
          `${frames} frames, ${landed} of ${fired} landed, hp ${a.hp}, `
          + `${Class14State[a.boss2.state]} sub ${a.boss2.sub}`);
    check("...having walked the ladder to Stage5Final, raising no 17",
          a.boss2.phase === Class14Phase.Stage5Final
          && (G.g_script_flags[17] ?? 0) === 0);
    check("...and DeathC takes it out of g_enemies_present",
          G.g_enemies_present === 0 && a.boss2.state === Class14State.DeathC,
          `present ${G.g_enemies_present}`);
    check("...never raising flag 10 or engaging the stage-2 boss flag",
          (G.g_script_flags[10] ?? 0) === 0 && G.g_boss_engaged === 0);
  }

  // ...and the coverage set, which decides whether `wait_script_flag` even
  // evaluates the gate. Both directions.
  {
    ResetGameGlobals();
    EnterPlay();
    SetGameTables(CHARS14);
    const spawnScript = (cls: number) => ({
      scene: 0, stage: 5, game_mode: 0, evt_file: "test", entry_block: 0,
      entry_step: 0, routes: [{ kind: "end", next: [-1, -1, -1] }],
      regions: [], cam_slots_used: [], warnings: [],
      blocks: [{
        index: 0, at: 0, route: { kind: "end", next: [-1, -1, -1] },
        steps: [{ index: 0, at: 0, ops: [
          { i: 0, at: 0x100, op: 0x0c, name: "spawn_obj_c", cat: "spawn",
            spawns: [{ at: 0x2400, class: cls, flags: 0, pos: [0, 0, 0],
                       yaw_deg: 0, orient: [0, 0, 0], hp: 200,
                       desc_flags: 0 }] },
        ] }],
      }],
    } as unknown as ScriptJson);
    const withBoss = ScriptFlagsThisBundleCanRaise(spawnScript(0x14));
    check("a stage that spawns class 0x14 can raise all nine of its gates",
          [10, 11, 12, 13, 14, 15, 16, 17, 31].every((n) => withBoss.has(n)),
          `${[...withBoss].sort((x, y) => x - y).join(",")}`);
    const without = ScriptFlagsThisBundleCanRaise(spawnScript(0x30));
    check("...and one that does not, cannot",
          ![10, 17, 31].some((n) => without.has(n)),
          `${[...without].sort((x, y) => x - y).join(",")}`);
  }
  ResetGameGlobals();
}
