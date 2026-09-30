/**
 * Class 0x32, the stage-5 boss: its `Init`, its shot, its node hook, its
 * projectiles' burst and the state that raises `g_script_flags[30]`.
 *
 * The fixture is type `0x4B` as the bundle carries it -- the real skeleton,
 * the real clip lengths -- with every clip's angles and root at zero, the
 * one shipped descriptor tail (evt `0x3D84`) and class 0x32's `.rdata` read
 * out of `Hod2.exe` by `web/src/hod2lib/class32.ts`. Every number asserted
 * is the exe's: a table, an immediate, or arithmetic on them.
 */
import type { CharactersJson, CharacterType } from "../../src/bundle";
import type { Class32Json } from "../../src/bundle/characters";
import { Rng } from "../../src/core/rng";
import { ActorSpawn } from "../../src/game/director";
import { ActorFlag, MotionFlag, type Boss5Actor } from "../../src/game/actor";
import { G } from "../../src/game/globals";
import { NULL_HOST } from "../../src/game/host";
import { SetGameTables } from "../../src/game/tables";
import { SpawnClass } from "../../src/game/spawn_class";
import { vec3 } from "../../src/game/vec";
import { CLASS32_INTRO_BANNER } from "../../src/game/class32";
import { Class32OnShot } from "../../src/game/class32/shot";
import {
  CLASS32_NODE_HOOK, Class32DrawAndAdvance, Class32DrawBonePart,
} from "../../src/game/class32/draw";
import {
  Class32SpawnBodyLoopEffect, Class32SpawnDeathBurst, Class32SpawnExitEffect,
  Class32TasksTick,
} from "../../src/game/class32/tasks";
import { FtolS16 } from "../../src/game/matrix";
import { VecToAngles } from "../../src/game/vec";
import {
  Class32ProjectileDispatchAndDraw, Class32SpawnProjectile,
} from "../../src/game/class32/projectile";
import { Class32StateRaiseFlagAndLeave } from "../../src/game/class32/death";
import {
  Class32Flag2, Class32ProjectileKind, Class32ProjectileState, Class32State,
  Class32TaskRoutine,
} from "../../src/game/class32/state";
import { check, motion, TYPE, CHARS, scene } from "./harness";

console.log("\nclass 0x32, the stage-5 boss:");
{
  /** `characters.class32`, as the exporter writes it from `Hod2.exe`. */
  const C32: Class32Json = {
    phases: [[6, 8.5], [8, 7.5], [6, 6], [8, 5], [10, 0], [-1, -1]],
    hop_offsets: [[-50, 25, 50], [50, 25, 50], [50, 25, -50], [-50, 25, -50]],
    hop_frames: [25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25,
                 25, 20],
    circle_offsets: [[0, 20, 120], [120, 20, 0], [0, 20, -120],
                     [-120, 20, 0]],
    rank_rows: [[25, 10, 3, 63], [25, 10, 3, 63], [25, 10, 3, 62],
                [24, 10, 3, 62], [24, 9, 3, 61], [24, 9, 3, 61],
                [23, 9, 3, 60], [23, 8, 3, 60], [23, 8, 3, 59],
                [22, 8, 3, 58], [22, 8, 3, 57], [22, 7, 3, 56],
                [21, 7, 3, 55], [21, 7, 3, 54], [20, 6, 3, 53],
                [20, 6, 3, 53], [20, 6, 3, 53]],
    projectile_frames: [90, 88, 86, 84, 82, 80, 78, 76, 74, 72, 70, 68, 66,
                        64, 62, 60, 50],
    barrage_rows: [[143, 30, 10, 5], [141, 30, 10, 5], [139, 30, 10, 5],
                   [137, 30, 10, 5], [135, 30, 10, 5], [133, 30, 10, 5],
                   [131, 30, 10, 5], [130, 30, 10, 5], [129, 30, 10, 5],
                   [128, 30, 10, 5], [127, 30, 10, 5], [126, 30, 10, 5],
                   [125, 30, 10, 5], [123, 30, 10, 5], [121, 30, 10, 5],
                   [119, 30, 10, 5], [60, 30, 10, 5]],
  } as Class32Json;
  /** Type `0x4B`'s fifteen nodes, as the bundle carries them. */
  const B = (bone: number, slot: number, offset: number[], parent: number | null,
             centre: number[], radius: number) => ({
    bone, part: `bone${String(bone).padStart(2, "0")}_${slot.toString(16)}`,
    slot, offset, parent, hit_centre: centre, hit_radius: radius,
    hit_slot: slot,
  });
  const BONES75 = [
    B(1, 0x65f, [0, 0, 0], null, [1.45, -0.25, 0], 2.15),
    B(2, 0x53f, [4.4555, -0.0031, 0.0012], 0, [0.25, 0, 0.35], 1.4),
    B(3, 0x5b8, [2.4302, -0.1188, 2.4521], 0, [1.45, -0.15, 0], 1.8),
    B(4, 0x6db, [3.4797, 0, 0], 2, [1.65, 0, 0], 1.7),
    B(5, 0x689, [3.4797, 0, 0], 3, [2, 0, 0], 1.4),
    B(6, 0x568, [2.7502, -0.1187, -2.7122], 0, [1.45, -0.15, 0], 1.8),
    B(7, 0x6b2, [3.7233, 0, 0], 5, [1.65, 0, 0], 1.7),
    B(8, 0x688, [3.9839, 0, 0], 6, [2, 0, 0], 1.4),
    B(9, 0x5e1, [0, -0.924, 0], null, [0.55, 0, 0], 1.75),
    B(10, 0x636, [1.8563, 0.0417, 1], 8, [2.05, 0, 0], 2.55),
    B(11, 0x4ef, [5.4389, 0, 0], 9, [3.25, 0, 0], 2.8),
    B(12, 0x49b, [6.6885, 0, 0], 10, [1.5, 2.35, 0], 2.15),
    B(13, 0x5e6, [1.8562, 0.0417, -1], 8, [2.05, 0, 0], 2.55),
    B(14, 0x4c6, [5.4389, 0, 0], 12, [3.25, 0, 0], 2.8),
    B(15, 0x44a, [6.6885, 0, 0], 13, [1.5, 2.35, 0], 2.15),
  ] as CharacterType["bones"];
  const LENGTHS75: Record<string, [number, number]> = {
    "130": [56, 109], "132": [41, 79], "136": [41, 79], "137": [41, 79],
    "138": [81, 159], "139": [66, 130], "140": [66, 130], "141": [30, 58],
    "142": [2, 1], "143": [31, 59], "148": [116, 229],
  };
  const TYPE75: CharacterType = {
    ...TYPE, type: 0x4b, name: "boss5", file: "boss5.bin", bone_count: 16,
    actor_radius: 31, bones: BONES75,
    motions: Object.fromEntries(Object.entries(LENGTHS75)
      .map(([k, [n, p]]) => [k, motion(n, 0, p)])),
  };
  const AT = 15748;
  /** The one shipped descriptor tail, evt `0x3D84`. */
  const PLACE = {
    at: AT, class: 0x32, char_type: 0x4b, motion: 142, hp: 450,
    class32: {
      char_type: 0x4b, state: 0, damage: 10, projectile_hp: 1,
      trail_interval: 8, projectile_radius: 1.7, afterimage_interval: 1,
      held_trail_interval: 2, burst_frames: 60, burst_bright: 70,
      retire_speed: 2, death_frames: 145, death_burst_interval: 8,
    },
  };
  const CHARS32 = {
    ...CHARS, types: { ...CHARS.types, "75": TYPE75 }, placements: [PLACE],
    class32: C32,
  } as unknown as CharactersJson;

  const setup = (seed: number): { rng: Rng; boss: Boss5Actor } => {
    const rng = new Rng(seed);
    scene(0, rng);
    SetGameTables(CHARS32);
    const a = ActorSpawn(AT, SpawnClass.Boss5, 0x4b, "boss5",
                         { pos: vec3(0, 0, -90), hp: 450, maxHp: 450,
                           visible: true }, rng);
    if (a.cls !== SpawnClass.Boss5) throw new Error("not class 0x32");
    return { rng, boss: a };
  };

  // -- Init -------------------------------------------------------------
  {
    const { boss } = setup(1);
    const skel = boss.skel;
    check("Init builds the model block on clip 0x8E, rotation order 1, with "
          + "the node hook 0x0047F780 at model+0x1158",
          skel?.bones.length === 16 && skel.motion === 0x8e
          && skel.order === 1 && skel.hook === CLASS32_NODE_HOOK
          && CLASS32_NODE_HOOK === 0x0047f780,
          `${skel?.bones.length} 0x${skel?.motion.toString(16)} `
          + `${skel?.order} 0x${skel?.hook.toString(16)}`);
    check("...ORs 0xC into obj+0x1F8, and takes the type's radius 31 and a "
          + "body radius of 5.0",
          (boss.motionFlags & 0xc) === 0xc && boss.hitRadius === 31
          && boss.bodyRadius === 5,
          `0x${boss.motionFlags.toString(16)} ${boss.hitRadius} ${boss.bodyRadius}`);
    check("...starts in the tail's state 0 and counts itself in both enemy "
          + "counters", boss.state === Class32State.WaitCamAndFlags
          && G.g_enemies_present === 1 && G.g_enemies_alive === 1,
          `state ${boss.state} ${G.g_enemies_present}/${G.g_enemies_alive}`);
    check("...and spawns the banner record 0x00596AC0, which waits on flag 22",
          G.g_boss_banners.length === 1
          && G.g_boss_banners[0].rec === CLASS32_INTRO_BANNER
          && CLASS32_INTRO_BANNER === 0x00596ac0 && !G.g_script_flags[22],
          JSON.stringify(G.g_boss_banners.map((b) => b.rec)));
  }

  // -- the shot: four bones charge, the rest spark ------------------------
  {
    const shoot = (bone: number, hp: number, players = 1) => {
      const { rng, boss } = setup(2);
      G.g_players_in_play = players;
      boss.hp = hp;
      boss.state = Class32State.HopNearCamera;
      const score = G.g_player_score[0];
      boss.flags |= ActorFlag.Hit | ActorFlag.HitByPlayer0;
      boss.shotBones[0] = bone;
      Class32OnShot(boss, rng, NULL_HOST);
      return { boss, points: G.g_player_score[0] - score };
    };
    const damaging = [4, 6, 11, 13].map((b) => shoot(b, 450));
    check("bones 4, 6, 11 and 13 take tail+4's 10 points and score 10, and "
          + "light the flash at 8",
          damaging.every((r) => r.boss.hp === 440 && r.points === 10
                         && r.boss.boss5.flash === 8),
          damaging.map((r) => `${r.boss.hp}/${r.points}/${r.boss.boss5.flash}`)
            .join(" "));
    const others = [0, 1, 2, 3, 5, 7, 8, 9, 10, 12, 14, 15]
      .map((b) => shoot(b, 450));
    check("...and every other bone, and past 13, takes nothing",
          others.every((r) => r.boss.hp === 450 && r.points === 0
                       && r.boss.boss5.flash === 0),
          others.map((r) => r.boss.hp).join(","));
    const two = shoot(4, 450, 2);
    check("with two players in play a hit is 10 * 0.7f, truncated once: 443",
          two.boss.hp === 443, `${two.boss.hp}`);
    // `(maxHp / 10) * floor`: 45 * 8.5 = 382.5 is phase 0's floor.
    const above = shoot(6, 393);
    const below = shoot(6, 392);
    check("phase 0 reacts once the hit points fall under 45 * 8.5: 383 holds, "
          + "382 goes to state 5 with the interrupted state kept",
          above.boss.state === Class32State.HopNearCamera
          && below.boss.state === Class32State.HitReaction
          && below.boss.boss5.interrupted === Class32State.HopNearCamera
          && (below.boss.flags & ActorFlag.ShotImmune) !== 0,
          `${above.boss.hp}:${above.boss.state} ${below.boss.hp}:`
          + `${below.boss.state}`);
    const kill = shoot(13, 5);
    check("the killing hit scores 10 + 0x5DC, sets obj+0x34 bit 26 and goes "
          + "straight to state 2, disengaging the boss",
          kill.boss.hp === -5 && kill.points === 10 + 1500
          && (kill.boss.flags & ActorFlag.Dead) !== 0
          && kill.boss.state === Class32State.DeathSequence
          && kill.boss.killedBy === 0 && G.g_boss_engaged === 0
          && (kill.boss.flags2 & 2) !== 0,
          `hp ${kill.boss.hp} points ${kill.points} state ${kill.boss.state}`);
  }

  // -- the node hook ----------------------------------------------------
  {
    const { boss } = setup(3);
    G.g_frame_counter = 45;               // % 40 = 5
    const t = boss.boss5;
    t.nodeDraws = {};
    Class32DrawBonePart(boss, 11, 0x4ef);
    Class32DrawBonePart(boss, 15, 0x44a);
    Class32DrawBonePart(boss, 9, 0x5e1);
    const slots = (b: number) => (t.nodeDraws[String(b)] ?? []).map((d) => d.slot);
    check("a damaging bone's arm draws two cels in place of its model: "
          + "0x4EF + 5 and 0x517 + 5",
          slots(11).join() === [0x4f4, 0x51c].join(), slots(11).join());
    check("...another arm draws its model and a cel of its run: 0x44A, 0x44B + 5",
          slots(15).join() === [0x44a, 0x450].join(), slots(15).join());
    check("...and a slot with no arm draws itself", slots(9).join() === "1505");
    t.nodeDraws = {};
    t.flash = 3;
    t.drawLight = null;
    Class32DrawBonePart(boss, 2, 0x53f);
    const d2 = t.nodeDraws["2"] ?? [];
    check("0x53F's arm counts the flash down first, and an even count draws "
          + "under SetRenderLightColour(0, 0, 0)",
          t.flash === 2 && d2.length === 2
          && d2.every((d) => d.light?.join() === "0,0,0"),
          `${t.flash} ${JSON.stringify(d2)}`);
    t.nodeDraws = {};
    t.flash = 0;
    t.drawLight = null;
    boss.state = Class32State.LungeAtCamera;
    Class32DrawBonePart(boss, 9, 0x5e1);
    check("state 9 draws under the warm light (1.0, 0.781f, 0.565f)",
          t.nodeDraws["9"]?.[0]?.light?.join()
          === [1, Math.fround(0.781), Math.fround(0.565)].join(),
          JSON.stringify(t.nodeDraws["9"]));
  }

  // -- the whole draw: every node through the hook, the part after ------
  {
    const { boss } = setup(4);
    const t = boss.boss5;
    boss.state = Class32State.HopNearCamera;
    t.flash = 3;
    const before = boss.skel?.counter ?? -1;
    Class32DrawAndAdvance(boss);
    const drawn = Object.keys(t.nodeDraws).map(Number).sort((a, b) => a - b);
    check("Class32DrawAndAdvance draws all fifteen nodes through the hook and "
          + "steps the block's counter",
          drawn.join() === "1,2,3,4,5,6,7,8,9,10,11,12,13,14,15"
          && boss.skel?.counter === before + 1,
          `${drawn.join()} counter ${before} -> ${boss.skel?.counter}`);
    check("...bone 1, walked before bone 2's arm steps the flash, draws red; "
          + "the part loop after the walk takes what the last node left, black",
          t.nodeDraws["1"]?.[0]?.light?.join() === "1,0,0"
          && t.partLight?.join() === "0,0,0" && t.flash === 2,
          `${JSON.stringify(t.nodeDraws["1"])} part ${JSON.stringify(t.partLight)}`);
    boss.motionFlags &= ~MotionFlag.Drawn;
    Class32DrawAndAdvance(boss);
    check("...and with model+0x64 bit 0 clear the hook draws nothing",
          Object.keys(t.nodeDraws).length === 0);
  }

  // -- the light: the aim into both blocks, and the register --------------
  //
  // `Class32DrawNodeSlot` (`FUN_0047FC50`) writes `g_scene_light_pitch_bams`
  // / `_yaw_bams` and block 1's pair and builds both vectors, but makes no
  // `SetRenderLightDirection`: the draw in progress keeps what its
  // `LightsUseSecondarySet` installed, and its `LightsRestoreScene` puts the
  // new block-0 vector on the device. `BuildSceneLightDirection`
  // (`FUN_0040E0B0`) is `RotY(yaw) RotX(pitch) * (0, 0, 1)` =
  // `(cos p sin y, -sin p, cos p cos y)`.
  {
    const built = (p: number, y: number): number[] => {
      const r = (b: number) => b * Math.PI * 2 / 65536;
      return [Math.cos(r(p)) * Math.sin(r(y)), -Math.sin(r(p)),
              Math.cos(r(p)) * Math.cos(r(y))];
    };
    const same = (a: ArrayLike<number>, b: ArrayLike<number>) =>
      [0, 1, 2].every((i) => Math.abs(a[i] - b[i]) < 1e-6);
    const xyz = (v: { x: number; y: number; z: number }) => [v.x, v.y, v.z];
    const { boss } = setup(8);
    const t = boss.boss5;
    const B0 = G.g_scene_light_block0;
    const B1 = G.g_scene_light_block1;
    boss.state = Class32State.HopNearCamera;
    Class32DrawAndAdvance(boss);             // poses the bones; no aim
    check("outside states 9 and 10 the draw leaves both blocks' angles alone",
          B0.pitch === 0 && B0.yaw === 0 && B1.pitch === 0 && B1.yaw === 0);
    boss.state = Class32State.LungeAtCamera;
    t.nodeDraws = {};
    Class32DrawBonePart(boss, 9, 0x5e1);
    const a9 = boss.skel!.bones[9]!.hit;
    const a8 = boss.skel!.bones[8]!.hit;
    const ang = VecToAngles(a8[0] - a9[0], a8[1] - a9[1], a8[2] - a9[2]);
    const p = FtolS16(ang.pitch);
    const y = FtolS16(ang.yaw);
    check("state 9 aims block 0 and block 1 from the node toward bone 8's point",
          (p !== 0 || y !== 0) && B0.pitch === p && B0.yaw === y
          && B1.pitch === p && B1.yaw === y,
          `want ${p},${y} b0 ${B0.pitch},${B0.yaw} b1 ${B1.pitch},${B1.yaw}`);
    check("...and builds both blocks' vectors from the angles",
          same(xyz(B0.dir), built(p, y)) && same(xyz(B1.dir), built(p, y)),
          `${xyz(B0.dir)} want ${built(p, y)}`);
    // A whole draw: block 1 holds a non-identity aim at its head.
    B1.pitch = 0x1000;
    B1.yaw = 0x2000;
    Class32DrawAndAdvance(boss);
    check("...a draw is lit from block 1's direction as its head installed it",
          same(t.drawDir, built(0x1000, 0x2000)),
          `${t.drawDir} want ${built(0x1000, 0x2000)}`);
    check("...its nodes re-aim block 1 for the next draw, not this one",
          B1.pitch !== 0x1000 || B1.yaw !== 0x2000);
    check("...and its LightsRestoreScene puts block 0's new vector on the device",
          same(xyz(G.g_render_light_dir), xyz(B0.dir))
          && same(xyz(B0.dir), built(B0.pitch, B0.yaw)),
          `${xyz(G.g_render_light_dir)} vs ${xyz(B0.dir)}`);
  }

  // The death burst and the exit effect set no light colour (`[proved]`):
  // they draw under the register as the walk left it.
  {
    const { rng, boss } = setup(9);
    const c0 = G.g_scene_light_block0.channels;
    c0[6] = 0.5; c0[7] = 0.25; c0[8] = 0.125;
    Class32SpawnDeathBurst(boss, rng);
    Class32DrawAndAdvance(boss);             // ends in LightsRestoreScene
    Class32TasksTick();
    const burst = G.g_class32_tasks.find((x) =>
      x.routine === Class32TaskRoutine.DeathBurst);
    check("a death burst with nothing before it draws under block 0's colour, "
          + "which the boss's LightsRestoreScene left",
          burst?.draw?.light.join() === "0.5,0.25,0.125",
          JSON.stringify(burst?.draw?.light));
  }
  {
    const { rng, boss } = setup(10);
    boss.flags2 |= Class32Flag2.BodyLoop;
    Class32SpawnBodyLoopEffect(boss);
    Class32SpawnDeathBurst(boss, rng);
    Class32SpawnExitEffect(boss);
    Class32DrawAndAdvance(boss);
    Class32TasksTick();
    const of = (r: Class32TaskRoutine) => G.g_class32_tasks.find((x) =>
      x.routine === r)?.draw?.light.join();
    // The body loop's first frame: `a = 0 + 0.05f`, `(a, a * 0.25, 0)`.
    const a = Math.fround(0.05);
    const orange = [a, Math.fround(a * 0.25), 0].join();
    check("...and behind the body loop, under its orange -- the burst and "
          + "the exit effect both",
          of(Class32TaskRoutine.BodyLoop) === orange
          && of(Class32TaskRoutine.DeathBurst) === orange
          && of(Class32TaskRoutine.ExitEffect) === orange,
          `${of(Class32TaskRoutine.BodyLoop)} ${of(Class32TaskRoutine.DeathBurst)} `
          + `${of(Class32TaskRoutine.ExitEffect)}`);
  }

  // -- a projectile's burst ---------------------------------------------
  {
    const burst = (struckNobody: boolean): { calls: number; live: number[] } => {
      const { rng, boss } = setup(5);
      Class32SpawnProjectile(boss, Class32ProjectileKind.Held);
      const p = G.g_object_list.find((o) => o.cls === SpawnClass.Boss5
        && o !== boss) as Boss5Actor;
      if (struckNobody) p.flags2 |= Class32Flag2.StruckNobody;
      boss.flags |= ActorFlag.Reacting;
      const live = [boss.boss5.liveProjectiles];
      let calls = 0;
      while (!p.despawned && calls < 200) {
        Class32ProjectileDispatchAndDraw(p, rng, NULL_HOST);
        calls += 1;
        live.push(boss.boss5.liveProjectiles);
        if (calls === 1 && p.state !== Class32ProjectileState.Burst) break;
      }
      return { calls, live };
    };
    // tail+0x20 = 70, tail+0x1C = 60: (0xFF - 70) / 60 = 3 a frame, and
    // 255 - 3n <= 70 first at n = 62. Struck nobody: 60 / 8 = 7 frames,
    // 185 / 7 = 26 a frame, first at n = 8.
    const a = burst(false);
    const b = burst(true);
    check("a projectile bursts while its boss reacts and fades out in 62 "
          + "frames, (0xFF - 70) / 60 a frame",
          a.calls === 62, `${a.calls}`);
    check("...giving its boss's count back on the first (not a barrage one)",
          a.live[0] === 1 && a.live[1] === 0, a.live.slice(0, 3).join());
    check("...and in 8 when it struck nobody, a burst an eighth as long",
          b.calls === 8, `${b.calls}`);
  }

  // -- state 4: flag 24, the exit effect at cam frame 170, flag 30 ------
  {
    const { boss } = setup(6);
    boss.state = Class32State.RaiseFlagAndLeave;
    boss.sub = 0;
    boss.flags2 |= Class32Flag2.BodyLoop;
    G.g_cam_path_frame = 0;
    Class32StateRaiseFlagAndLeave(boss);
    check("state 4 raises g_script_flags[24] on its first frame",
          G.g_script_flags[24] === 1 && !G.g_script_flags[30]);
    for (let i = 0; i < 5; i++) Class32StateRaiseFlagAndLeave(boss);
    const early = G.g_class32_tasks.length;
    G.g_cam_path_frame = 0xaa;
    let calls = 0;
    let exit = -1;
    while (!boss.despawned && calls < 1000) {
      Class32StateRaiseFlagAndLeave(boss);
      calls += 1;
      if (exit < 0 && G.g_class32_tasks.some((x) =>
        x.routine === Class32TaskRoutine.ExitEffect)) exit = calls;
    }
    check("...rides until the camera's frame 0xAA, which makes the exit "
          + "effect and ends the body loop",
          early === 0 && exit === 1
          && (boss.flags2 & Class32Flag2.BodyLoop) === 0, `${early} ${exit}`);
    // Sub 2 falls into 3 and 3 into 4 (`0x0048054F`, `0x00480573`), so the
    // frame that reads 0xAA takes the first of 0x78 and the one that ends it
    // the first of 0xB4: 1 + 119 + 179.
    check("...and raises flag 30 and despawns on the 299th frame, counting "
          + "the one that read 0xAA",
          calls === 299 && G.g_script_flags[30] === 1 && boss.despawned,
          `${calls}`);
  }

  // -- the exit effect hides the boss ----------------------------------
  {
    const { boss } = setup(7);
    boss.flags2 |= Class32Flag2.BodyLoop;
    boss.state = Class32State.RaiseFlagAndLeave;
    boss.sub = 1;
    G.g_cam_path_frame = 0xaa;
    Class32StateRaiseFlagAndLeave(boss);
    const task = G.g_class32_tasks.find((x) =>
      x.routine === Class32TaskRoutine.ExitEffect);
    let ticks = 0;
    while (task && (boss.motionFlags & MotionFlag.Drawn) !== 0 && ticks < 200) {
      Class32TasksTick();
      ticks += 1;
    }
    // 1.0 - 0.03n > 0 through n = 33; the 34th starts the wait of 15, and
    // its 14th decrement after that one hides the boss.
    check("the exit effect shrinks for 33 frames, waits 15 and hides the "
          + "boss -- skeleton and parts -- on the 48th",
          ticks === 48 && boss.partVisible.every((v) => v === 0)
          && task?.slot === 0x7ef,
          `${ticks} parts ${boss.partVisible.join()} slot 0x${task?.slot.toString(16)}`);
  }
}
