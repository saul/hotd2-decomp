import type { CharactersJson, CharacterType } from "../../src/bundle";
import { Rng } from "../../src/core/rng";
import { Events } from "../../src/core/events";
import { ActorSpawn, GameUpdate } from "../../src/game/director";
import { RemoveBoneSubtree } from "../../src/game/combat/resolve_hit";
import { ActorRegisterCameraPoint } from "../../src/game/camera/track";
import { ActorBuildSkinnedModel } from "../../src/game/spawn";
import {
  ColiSortHitCandidatesByDistance, ProcessPlayerShotsTestList, RayTestSphere,
  RegisterForShotTest, ShotCandidateKey, ShotRayAnglesFromView,
} from "../../src/game/combat/shot_test";
import { ActorByAt, G, ResetGameGlobals } from "../../src/game/globals";
import { NULL_HOST, type GameHost, type ShotPick } from "../../src/game/host";
import {
  MarkActorShot, MergeShotPicks, QueueOffscreenPull, QueueShotRequest,
} from "../../src/game/combat/shot";
import { MotionPlayFrame, SetGameTables, T } from "../../src/game/tables";
import { ActorFlag, type Actor } from "../../src/game/actor";
import { DescriptorFromPlacement } from "../../src/game/descriptor";
import { g_class_handlers } from "../../src/game/registry";
import { SpawnClass } from "../../src/game/spawn_class";
import { GameMode } from "../../src/game/game_mode";
import { BossHpBarsTick } from "../../src/game/boss_hp_bar";
import { BossBannersTick } from "../../src/game/boss_banner";
import { vec3, type Vec3 } from "../../src/game/vec";
import { Class22SubActorAt } from "../../src/game/class22/records";
import { Class22Relative } from "../../src/game/class22/state";
import { Class23State } from "../../src/game/class23/state";
import { CLASS23_BLEND_WALK, Class23BlendStart }
  from "../../src/game/class23/records";
import {
  Boss3BodyState, Boss3HeadState, Boss3Phase, Boss3Routine, Boss3Subtype,
  Boss3Variant,
} from "../../src/game/class45/state";
import type { Boss3Actor } from "../../src/game/actor";
import { clonePlain } from "../../src/core/snapshot";
import {
  check, motion, TYPE, CHARS, SCENE_MAJOR_PLAYING, spawnZombie, scene,
  EnterPlay,
} from "./harness";

// JUDGMENT -- classes 0x22 and 0x23, `game/class22/` and `game/class23/`. The
// gates the fight holds, the split of the damage between the flier and the
// walker, the phase change at 90, the walker's fall, the bar, and the flags
// the death raises -- driven from a reset, through the classes' own updates.
console.log("\nclasses 0x22/0x23: JUDGMENT, the flier and the walker:");
{
  const clips = (ids: number[], frames: number) =>
    Object.fromEntries(ids.map((id) => [String(id), motion(frames)]));
  const range = (lo: number, hi: number) =>
    Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
  const JT = (type: number, name: string,
              motions: Record<string, unknown>): CharacterType =>
    ({ ...TYPE, type, name, bones: [], motions }) as unknown as CharacterType;
  // The death clip must outlast counter 0x92, which the landing reaches.
  const FLIER = JT(0x45, "boss1z", { ...clips(range(0x408, 0x416), 30),
                                     "1034": motion(120) });
  const WALKER = JT(0x44, "boss1q", clips(range(0x383, 0x394), 40));
  const WINGS = JT(0x46, "boss1z_wing", clips([0x0f, 0x10, 0x12, 0x13, 0x14], 10));
  const FLIER_AT = 24948;
  const WALKER_AT = 25004;
  const flierRow = (variant: number, walkerSub: number) => [
    { at: FLIER_AT, class: 0x22, char_type: 0x45, motion: 0x40b, hp: 300,
      class22: { variant, clip: 0x40b, frame: 0,
                 despawn_path: variant === 1 ? 0x31 : 0xcf,
                 despawn_frame: variant === 1 ? 400 : 0x8c, hp: 300,
                 hp_stage: 210, phase1_floor: 90, companion_at: WALKER_AT,
                 sub_actor_at: Class22SubActorAt(FLIER_AT) } },
    { at: WALKER_AT, class: 0x23, char_type: 0x44, motion: 0x38d, hp: 90,
      parent_at: FLIER_AT, synthetic: true,
      class23: { subtype: walkerSub, despawn_path: 0x31, despawn_frame: 400,
                 pos: [0, 0, 0], angles: [0, 0, 0] } },
    { at: Class22SubActorAt(FLIER_AT), class: 0x22, char_type: 0x46,
      motion: 0x10, hp: 0, parent_at: FLIER_AT, synthetic: true },
  ];
  const host = {
    ...NULL_HOST,
    objectPath: (_slot: number, frame: number) =>
      ({ x: 0, y: 20, z: frame * 0.1, pitch: 0, yaw: 0, roll: 0 }),
  };
  const jf = { dt: 1 / 60, rng: new Rng(3), host };
  const tick = (n: number): void => {
    for (let i = 0; i < n; i++) {
      for (const o of [...G.g_object_list]) {
        if (!o.visible || o.despawned) continue;
        g_class_handlers[o.cls]?.update(o, jf);
      }
      BossBannersTick(host);
      BossHpBarsTick();
    }
  };
  const spawnFlier = (variant: number, walkerSub: number): Actor => {
    ResetGameGlobals();
    EnterPlay();
    SetGameTables({ ...CHARS,
                    types: { "1": TYPE, "68": WALKER, "69": FLIER,
                             "70": WINGS },
                    placements: flierRow(variant, walkerSub),
                  } as unknown as CharactersJson);
    const p = T.chars!.placements.find((x) => x.at === FLIER_AT);
    return ActorSpawn(FLIER_AT, SpawnClass.Judgment, 0x45, "judgment",
                      { ...DescriptorFromPlacement(p), hp: 300, maxHp: 300,
                        visible: true });
  };
  const flier = spawnFlier(1, 0);
  const sub = ActorByAt(Class22SubActorAt(FLIER_AT));
  check("Class22Init builds the sub-actor -- type 0x46, clip 0x10, out of the "
        + "shot test -- and the banner, and counts nothing",
        sub?.cls === SpawnClass.Judgment && sub.judgment.isSubActor
        && sub.charType === 0x46 && sub.motion === 0x10
        && (sub.flags & 0x8000) !== 0 && G.g_boss_banners.length === 1
        && G.g_enemies_alive === 0 && G.g_enemies_present === 0,
        `${sub?.charType} ${G.g_boss_banners.length} ${G.g_enemies_alive}`);
  check("...and is in the pool before the walker it will make: the flier is "
        + "updated first", G.g_object_list[0]?.at === FLIER_AT);
  G.g_active_cam_path = 0x2f;
  G.g_cam_path_frame = 0x100;
  tick(1);
  const walker = ActorByAt(WALKER_AT);
  check("the ride-in's first frame spawns the walker from the nested "
        + "descriptor, and the walker counts itself into both counters",
        walker?.cls === SpawnClass.JudgmentCompanion
        && walker.companion.companionAt === FLIER_AT
        && flier.cls === SpawnClass.Judgment
        && flier.judgment.companionAt === WALKER_AT
        && G.g_enemies_alive === 1 && G.g_enemies_present === 1
        && walker.hp === 90,
        `${walker?.cls} alive ${G.g_enemies_alive}`);
  check("...which is what holds `wait_enemies_alive 0` before the flier "
        + "joins", G.g_enemies_alive > 0);
  G.g_cam_path_frame = 829;
  tick(1);
  check("no banner flag before the camera's frame 830",
        !G.g_script_flags[2]);
  G.g_cam_path_frame = 830;
  tick(1);
  check("on the integer camera frame 830 the ride-in raises g_script_flags[2]",
        G.g_script_flags[2] === 1 && flier.sub === 2, `sub ${flier.sub}`);
  tick(299);
  check("...and waits: not in the fight until 300 frames later",
        flier.state === Class22Relative.Entrance && G.g_boss_hp_bars.length === 0,
        `state ${flier.state}`);
  tick(1);
  check("frame 300 joins the fight: both counters, the health bar at "
        + "(320, 35), g_boss_engaged, 300 hit points",
        flier.state === Class22Relative.Phase1 && G.g_enemies_alive === 2
        && G.g_enemies_present === 2 && G.g_boss_hp_bars.length === 1
        && G.g_boss_hp_bars[0].x === 320 && G.g_boss_hp_bars[0].y === 35
        && G.g_boss_engaged === 1 && flier.hp === 300,
        `state ${flier.state} alive ${G.g_enemies_alive} bars `
        + `${G.g_boss_hp_bars.length}`);
  check("the banner, waiting on flag 2, opens the shutter on its own frame 300",
        G.g_boss_banners.length === 0 && G.g_bHudShutterState === 1,
        `${G.g_boss_banners.length} shutter ${G.g_bHudShutterState}`);
  check("the walker waited for the flier's phase 1, and fights",
        walker?.state === Class23State.Fight
        || walker?.state === Class23State.Entrance,
        `${walker?.state}`);
  tick(2);
  check("phase 1's tail writes g_boss_hp_fraction every frame: 300/300",
        G.g_boss_hp_fraction === 1, `${G.g_boss_hp_fraction}`);
  // The shot test the engine's way: each class puts itself on the list at
  // its own sites (docs/formats/combat.md, "The shot test").
  G.g_shot_test_list = [];
  tick(1);
  const listed = (at: number): boolean =>
    G.g_shot_test_list.some((e) => e.at === at);
  check("phase 1 registers the flier for the shot test, and not as a camera "
        + "candidate (RegisterForShotTest at 0x0049C145)",
        listed(FLIER_AT) && flier.cls === SpawnClass.Judgment
        && !flier.judgment.cameraListed);
  check("...the walker in state 1 through ActorRegisterCameraPoint(6.0) "
        + "(0x00490917), a camera candidate as well",
        walker?.state === Class23State.Fight
        && listed(WALKER_AT) && walker.cls === SpawnClass.JudgmentCompanion
        && walker.companion.cameraListed,
        `walker state ${walker?.state}`);
  check("...and never the sub-actor, which is not updated and has 0x8000",
        !listed(Class22SubActorAt(FLIER_AT)));

  // The damage split. A flier hit is 30 and ten points; a walker hit is ten
  // points and one hit point off the flier, the frame after.
  if (flier.cls === SpawnClass.Judgment) {
    flier.sub = 1;
    flier.flags &= ~0x40000100;
    const score = G.g_player_score[0];
    MarkActorShot(flier, 0, 1, true);
    tick(1);
    check("a hit on the flier in a damage-taking sub is 30 hit points and 10 "
          + "points, and a flinch",
          flier.hp === 270 && G.g_player_score[0] === score + 10
          && (flier.flags & 0x40000000) !== 0,
          `hp ${flier.hp} score ${G.g_player_score[0] - score}`);
    check("...and the bar reads it", Math.abs(G.g_boss_hp_fraction - 0.9) < 1e-6,
          `${G.g_boss_hp_fraction}`);
  }
  if (walker?.cls === SpawnClass.JudgmentCompanion
      && flier.cls === SpawnClass.Judgment) {
    walker.state = Class23State.Fight;
    walker.sub = 3;
    flier.sub = 1;
    flier.flags &= ~0x40000100;
    const hp = flier.hp;
    const score = G.g_player_score[0];
    MarkActorShot(walker, 0, 1, true);
    tick(1);
    check("a hit on the walker costs it nothing and hands one hit point to "
          + "the flier", walker.hp === 90 && flier.judgment.transfer === 1
          && G.g_player_score[0] === score + 10,
          `walker ${walker.hp} transfer ${flier.judgment.transfer}`);
    flier.sub = 1;
    flier.flags &= ~0x40000100;
    tick(1);
    check("...which the flier's next damage-taking frame subtracts",
          flier.hp === hp - 1 && flier.judgment.transfer === 0,
          `${hp} -> ${flier.hp}`);

    // Phase 1 to phase 2 at 90.
    flier.hp = 100;
    flier.sub = 1;
    flier.flags &= ~0x40000100;
    MarkActorShot(flier, 0, 1, true);
    tick(1);
    check("a hit that takes the flier to or below 90 starts phase 2 with "
          + "exactly 90 hit points", flier.state === Class22Relative.Phase2
          && flier.hp === 90
          && Math.abs(G.g_boss_hp_fraction - 0.3) < 1e-6,
          `state ${flier.state} hp ${flier.hp} bar ${G.g_boss_hp_fraction}`);
    check("...and the walker falls on the same frame: the alive count drops",
          walker.state === Class23State.Collapse && G.g_enemies_alive === 1,
          `walker ${walker.state} alive ${G.g_enemies_alive}`);
    check("...still on the shot list: the falling arm registers too "
          + "(0x004901E9)", listed(WALKER_AT));
    G.g_shot_test_list = [];
    flier.flags &= ~0x40000100;
    tick(1);
    check("phase 2 registers the flier through ActorRegisterCameraPoint(2.0) "
          + "while bit 0x100 is down: the list and the camera",
          listed(FLIER_AT) && flier.judgment.cameraListed
          && listed(WALKER_AT),
          `listed ${listed(FLIER_AT)} camera ${flier.judgment.cameraListed}`);
    let n = 0;
    while (walker.state === Class23State.Collapse && n++ < 400) tick(1);
    check("the collapse ends on its clip's play length: out of the present "
          + "count and the shot test, lying",
          walker.state === Class23State.Lie && G.g_enemies_present === 1
          && (walker.flags & 0x8000) !== 0,
          `state ${walker.state} present ${G.g_enemies_present} after ${n}`);
    G.g_shot_test_list = [];
    tick(1);
    check("...and a lying walker is never on the list again",
          !listed(WALKER_AT));

    // The kill, and the death's gate.
    flier.sub = 3;
    flier.flags &= ~0x40000100;
    flier.hp = 20;
    tick(1);
    const score2 = G.g_player_score[0];
    MarkActorShot(flier, 0, 1, true);
    flier.sub = 3;
    flier.flags &= ~0x40000100;
    tick(1);
    check("the killing hit: relative state 3, g_boss_engaged 0, 1500 and 10",
          flier.state === Class22Relative.Death && G.g_boss_engaged === 0
          && G.g_player_score[0] === score2 + 1510,
          `state ${flier.state} score ${G.g_player_score[0] - score2}`);
    tick(1);
    check("death sub 0: the bar to 0 and both counters down -- the room is "
          + "clear", G.g_boss_hp_fraction === 0 && G.g_enemies_alive === 0
          && G.g_enemies_present === 0,
          `${G.g_boss_hp_fraction} ${G.g_enemies_alive} ${G.g_enemies_present}`);
    G.g_camera_free = 1;
    tick(2);
    check("once the camera is free the flier holds the camera driver",
          G.g_camera_driver_held === 1 && G.g_bHudShutterState === 5,
          `${G.g_camera_driver_held}`);
    // What sub 2 saved -- the block as it stood on the frame it took it.
    const eye = { ...flier.judgment.point };
    n = 0;
    while (!G.g_script_flags[3] && n++ < 1200) tick(1);
    check("300 orbit frames later: g_script_flags[3], the driver let go, the "
          + "block put back (Arcade)",
          G.g_script_flags[3] === 1 && G.g_camera_driver_held === 0
          && G.g_camera_block_eye.x === eye.x
          && G.g_camera_block_eye.z === eye.z,
          `flag ${G.g_script_flags[3]} after ${n}`);
    check("...and never g_script_flags[0], which is stage 5's",
          !G.g_script_flags[0]);
  }

  // Stage 5's variant raises flag 0 instead, and no banner.
  const f5 = spawnFlier(2, 1);
  check("variant 2 spawns no banner", G.g_boss_banners.length === 0);
  f5.state = Class22Relative.Death;
  f5.sub = 0;
  G.g_camera_free = 1;
  let n5 = 0;
  while (!G.g_script_flags[0] && n5++ < 1200) tick(1);
  check("variant 2's death raises g_script_flags[0], and not 3",
        G.g_script_flags[0] === 1 && !G.g_script_flags[3], `after ${n5}`);

  // **The walker's walk starts on the cursor its table names.**
  // `Class23FightBesideCompanion` sub 5: `MOVSX ECX, word ptr [EAX +
  // 0x570410]` / `PUSH ECX` into `ActorSetMotionBlended` at `0x00490681` --
  // `g_class23_blend_start_frames`, 175 for hit-point stage 0, and a play
  // cursor like every start that routine takes (`MOV [ECX+0x8], EAX` at
  // `0x004119AD`). The port doubled it to 350, past the walk's own play length
  // of 304, and the walk opened 45 ticks in. Clip 915 (0x393) with its real
  // shape: 153 frames, play length 304.
  WALKER.motions["915"] = motion(153, 0, 304);
  spawnFlier(1, 0);
  G.g_active_cam_path = 0x2f;
  G.g_cam_path_frame = 0x100;
  tick(1);
  const w23 = ActorByAt(WALKER_AT);
  if (w23?.cls !== SpawnClass.JudgmentCompanion) {
    check("the walker is spawned for the walk-start test", false, `${w23?.cls}`);
  } else {
    w23.state = Class23State.Fight;
    w23.sub = 5;
    G.g_active_player = 0;
    tick(1);
    const want = Class23BlendStart(CLASS23_BLEND_WALK, w23.companion.hpStage);
    check("class 0x23's walk back in starts at play cursor 175, "
          + "g_class23_blend_start_frames' word as it stands",
          want === 175 && w23.motion === 915 && w23.playTicks === want
          && MotionPlayFrame(w23) === want,
          `stage ${w23.companion.hpStage} want ${want} motion ${w23.motion} `
          + `counter ${w23.playTicks} cursor ${MotionPlayFrame(w23)}`);
  }
}

// -- the shot test the engine's way: registration, the sphere, the fork -----

/**
 * **`RegisterForShotTest`, `ShotTestSphere` and the fork into the bones, for a
 * class that registers the way the engine does.**
 *
 * The class under test is a stand-in shaped like the bosses: its `Init`
 * writes `obj+0x124` and runs the skeleton build, and its update ends in
 * `ActorRegisterCameraPoint` the way `Class14Update` (`0x0047621E`) and
 * `Boss4Update` (`0x00491A49`) do. Class 0x2D has no module, so its row is
 * free to borrow; the real bosses' modules are other workstreams'.
 *
 * Every assertion reads what only a shot can write -- `obj+0x190 + player`,
 * the bone byte `MarkActorShot` leaves (L47) -- and every frame is a real
 * `GameUpdate` from `ResetGameGlobals`, so the list is emptied and refilled
 * where the director does it and not where the test would like it (L49).
 * The host is the only stub: a camera at the origin looking down -Z, so view
 * space is world space, and three bone spheres.
 */
console.log("\nthe shot test, for a class that registers the engine's way:");
{
  const rng = new Rng(29);
  const events = scene(0, rng);
  const CLS = SpawnClass.LargeCreature;
  if (g_class_handlers[CLS]) throw new Error("class 0x2D is ported now");
  // A root at the actor and two children beside it: bone 2 four units to the
  // side, inside a twelve-unit `obj+0x124`, and bone 3 twenty units out,
  // beyond it. Parents are indices into this list, as the exporter writes
  // them.
  const BOSS: CharacterType = {
    ...TYPE, type: 0x60, name: "test boss", bone_count: 4,
    bones: [
      { bone: 1, part: "b1", slot: 0x100, offset: [0, 0, 0], parent: null,
        hit_radius: 3, hit_centre: [0, 0, 0] },
      { bone: 2, part: "b2", slot: 0x101, offset: [0, 0, 0], parent: 0,
        hit_radius: 1, hit_centre: [0, 0, 0] },
      { bone: 3, part: "b3", slot: 0x102, offset: [0, 0, 0], parent: 0,
        hit_radius: 1, hit_centre: [0, 0, 0] },
    ],
  };
  SetGameTables({ ...CHARS, types: { ...CHARS.types, "96": BOSS } } as
                unknown as CharactersJson);
  const Z = -40;
  const bonesAt: Record<number, Vec3> = {
    1: vec3(0, 0, Z), 2: vec3(4, 0, Z), 3: vec3(20, 0, Z),
  };
  const radii: Record<number, number> = { 1: 3, 2: 1, 3: 1 };
  const host: GameHost = {
    ...NULL_HOST,
    viewSpaceOfPoint: (p, out) => { out.x = p.x; out.y = p.y; out.z = p.z;
                                    return true; },
    boneWorld: (_at, bone, out) => {
      const b = bonesAt[bone]; if (!b) return false;
      out.x = b.x; out.y = b.y; out.z = b.z; return true;
    },
    boneSphere: (_at, bone, out) => {
      const b = bonesAt[bone]; if (!b) return null;
      out.x = b.x; out.y = b.y; out.z = b.z; return radii[bone] ?? null;
    },
  };
  let register = true;
  const RISE = 5;
  g_class_handlers[CLS] = {
    init(obj) {
      obj.hitRadius = 12;                  // what Class14Init/Boss4Init do
      ActorBuildSkinnedModel(obj);         // ...and the build that raises 0x80
    },
    update(obj, f) {
      if (register) ActorRegisterCameraPoint(obj, f.host, RISE);
    },
    registersForShotTest: true,
    ownsShotResult: true,
  };
  const boss = ActorSpawn(0x2000, CLS, 0x60, "boss", { visible: true });
  const frame = () => GameUpdate(1 / 60, host, rng, events);
  // A gun reloads by pulling off the screen, and pulls on one frame land in
  // order: reload, then fire, both on the frame under test, so the
  // registration that frame's pull sees is exactly last frame's.
  const fired = () => G.g_player_shot_count[0];
  const fireAt = (t: Vec3) => {
    boss.shotBones[0] = 0;
    const l = Math.hypot(t.x, t.y, t.z);
    const before = fired();
    QueueOffscreenPull(0);
    QueueShotRequest(0, { origin: vec3(0, 0, 0),
                          dir: vec3(t.x / l, t.y / l, t.z / l) });
    frame();
    if (fired() !== before + 1) throw new Error("the gun did not fire");
    return boss.shotBones[0];
  };

  check("the skeleton build raised the per-bone bit on a type with bones",
        (boss.flags & ActorFlag.ShootPerBone) !== 0, `0x${boss.flags.toString(16)}`);

  frame();
  check("its update registers it: one entry in `g_shot_test_list`",
        G.g_shot_test_list.length === 1 && G.g_shot_test_list[0].at === 0x2000,
        JSON.stringify(G.g_shot_test_list));
  check("...at the tracked bone, before the lift: `obj+0x70` on the bone and "
        + "`obj+0x100` five above it",
        boss.shotCentre.y === 0 && boss.lookAt.y === RISE,
        `shot ${boss.shotCentre.y} look ${boss.lookAt.y}`);

  check("a shot at bone 2 lands on bone 2 -- the byte is the bone's own index",
        fireAt(bonesAt[2]) === 2, `${boss.shotBones[0]}`);

  // L47: the byte, not a count. And the one-frame order: the pull is tested
  // against what the actors registered on the frame before.
  register = false;
  check("a class that stopped registering is still hit on the frame after "
        + "its last registration -- the list is last frame's",
        fireAt(bonesAt[2]) === 2, `${boss.shotBones[0]}`);
  check("...and not on the frame after that: unregistered is unshootable",
        fireAt(bonesAt[2]) === 0 && G.g_shot_test_list.length === 0,
        `${boss.shotBones[0]} list ${G.g_shot_test_list.length}`);
  register = true;
  frame();

  // The broad phase. Bone 3's own sphere is on this ray, and the actor's
  // twelve-unit sphere at bone 1 is 17.9 units off it.
  check("a ray that clips a bone outside `obj+0x124` finds nothing",
        fireAt(bonesAt[3]) === 0, `${boss.shotBones[0]}`);
  boss.hitRadius = 30;
  frame();
  check("...and finds that bone once the broad sphere reaches it",
        fireAt(bonesAt[3]) === 3, `${boss.shotBones[0]}`);
  boss.hitRadius = 12;
  frame();

  // The fork.
  boss.flags &= ~ActorFlag.ShootPerBone;
  frame();
  check("without bit 0x80 the actor is hit whole, and `MarkActorShot` "
        + "records bone byte 1", fireAt(bonesAt[2]) === 1,
        `${boss.shotBones[0]}`);
  check("...even where no bone sphere is, inside `obj+0x124`",
        fireAt(vec3(8, 6, Z)) === 1, `${boss.shotBones[0]}`);
  boss.flags |= ActorFlag.ShootPerBone;
  frame();
  check("with bit 0x80 the same off-bone shot misses: the bones decide",
        fireAt(vec3(8, 6, Z)) === 0, `${boss.shotBones[0]}`);
  // `ShotTestBoneTree`'s `rec[0] != 0` and `ShotTestBoneSphere`'s radius
  // test. Bone 2 is four units from bone 1, whose own sphere is three, so a
  // shot at bone 2 that bone 2 does not answer finds nothing.
  RemoveBoneSubtree(boss, 2);
  frame();
  check("a severed bone draws slot 0 and is not tested",
        fireAt(bonesAt[2]) === 0, `${boss.shotBones[0]}`);
  boss.removed.length = 0;
  frame();
  check("...and with the bone put back it answers again",
        fireAt(bonesAt[2]) === 2, `${boss.shotBones[0]}`);
  // `ShotTestBoneSphere`'s `r == 0` skip has no check here, deliberately: a
  // line whose direction is quantised to BAMS angles never passes exactly
  // through a centre, so a zero radius finds nothing with or without the skip
  // and a check of it would pass either way (measured: removing the skip left
  // such a check green).
  // Bit 0x8000 raised after the actor registered: the fork's third test.
  frame();
  boss.flags |= ActorFlag.NoShotTest;
  check("bit 0x8000 raised after registering sends the fork to the whole "
        + "arm", fireAt(bonesAt[2]) === 1, `${boss.shotBones[0]}`);
  check("...and keeps the actor out of the list from then on",
        G.g_shot_test_list.length === 0, `${G.g_shot_test_list.length}`);
  boss.flags &= ~ActorFlag.NoShotTest;
  frame();

  // The depth test in `RegisterForShotTest`.
  bonesAt[1] = vec3(0, 0, 40);
  frame();
  check("a point behind the camera (view z > 0) is not registered",
        G.g_shot_test_list.length === 0, JSON.stringify(G.g_shot_test_list));
  boss.flags |= ActorFlag.ShotTestMesh;
  frame();
  check("...unless the object is a mesh, which is taken at any depth",
        G.g_shot_test_list.length === 1, `${G.g_shot_test_list.length}`);
  boss.flags &= ~ActorFlag.ShotTestMesh;
  bonesAt[1] = vec3(0, 0, 0);
  boss.shotCentre = vec3(0, 0, 0);
  G.g_shot_test_list = [];
  RegisterForShotTest(boss, host);
  check("...and a point exactly on the camera plane (z == 0) is taken: "
        + "`TEST AH,0x41` passes on equal", G.g_shot_test_list.length === 1);
  bonesAt[1] = vec3(0, 0, Z);

  // The render-side pick for the classes that have not opted in knows
  // nothing of this one; the merge weighs the two by distance along the ray.
  frame();
  const legacyNear: ShotPick = { kind: "prop", propId: 1, point: vec3(), t: 10 };
  const reg = ProcessPlayerShotsTestList(
    { origin: vec3(0, 0, 0), dir: vec3(0, 0, -1) }, host);
  check("the registered test answers on its own",
        reg?.at === 0x2000 && reg.bone === 1 && reg.t === 40,
        JSON.stringify(reg));
  check("...a nearer pick from `render/` wins the merge",
        MergeShotPicks(legacyNear, reg) === legacyNear);
  check("...and a farther one loses it",
        MergeShotPicks({ ...legacyNear, t: 50 }, reg)?.kind === "actor");

  delete g_class_handlers[CLS];
  ResetGameGlobals();
}

/**
 * `ColiSortHitCandidatesByDistance` (`FUN_00405080`) and the arithmetic under
 * it, checked against what the bytes say rather than against the port's own
 * idea of "nearest".
 */
console.log("\nthe candidate sort and `RayTestSphere`:");
{
  const c = (key: number, id: number) => ({ key, id });
  const sorted = ColiSortHitCandidatesByDistance(
    [c(50, 0), c(30, 1), c(30, 2), c(0x10000 + 30, 3), c(-1, 4), c(0, 5)]);
  check("nearest first, and two equal keys keep the order they were pushed "
        + "in", sorted.map((x) => x.id).join() === "5,1,2,3,0,4",
        sorted.map((x) => x.id).join());
  check("only sixteen bits are sorted: 0x1001E ties with 30, and a point "
        + "behind the eye (-1 -> 0xFFFF) sorts last",
        sorted[3].id === 3 && sorted[5].id === 4);
  check("the key is `__ftol(-z * 10)`: -12.37 -> 123, and it truncates",
        ShotCandidateKey(-12.37) === 123 && ShotCandidateKey(-0.09) === 0,
        `${ShotCandidateKey(-12.37)} ${ShotCandidateKey(-0.09)}`);

  // `RayTestSphere`'s rotation is the perpendicular distance from the shot's
  // line, and the order of `VecToAngles`' outputs is what makes it so: a shot
  // along +x must measure from the x axis (L48: not only the identity).
  const along = (d: Vec3, p: Vec3) => {
    const l = Math.hypot(d.x, d.y, d.z);
    const u = { x: d.x / l, y: d.y / l, z: d.z / l };
    const t = p.x * u.x + p.y * u.y + p.z * u.z;
    return Math.hypot(p.x - u.x * t, p.y - u.y * t, p.z - u.z * t);
  };
  let worst = 0;
  const dirs = [vec3(0, 0, -1), vec3(1, 0, 0), vec3(0.3, -0.4, -0.8),
                vec3(-0.6, 0.2, -0.5), vec3(0.1, 0.9, -0.2)];
  const pts = [vec3(3, 1, -20), vec3(20, 2, 0.5), vec3(-4, 7, -15)];
  for (const d of dirs) {
    const a = ShotRayAnglesFromView(d);
    for (const p of pts) {
      const want = along(d, p);
      // Just inside and just outside the exact distance: the BAMS angles
      // quantise the direction to 1/65536 of a turn, so allow for that.
      const slack = 0.02 * (1 + Math.hypot(p.x, p.y, p.z) / 20);
      if (RayTestSphere(a, p.x, p.y, p.z, want + slack) !== 1
          || RayTestSphere(a, p.x, p.y, p.z, Math.max(0, want - slack)) !== -1) {
        worst = Math.max(worst, want);
      }
    }
  }
  check("`RayTestSphere` is the distance from the shot's line, in every "
        + "direction including +x", worst === 0, `failed near ${worst}`);
  check("...and it is a line, not a ray: a point behind the eye is measured "
        + "the same way", RayTestSphere(ShotRayAnglesFromView(vec3(0, 0, -1)),
                                        1, 0, 30, 1.5) === 1);
  check("...and `TEST AH,0x41` makes a NaN distance a hit",
        RayTestSphere(ShotRayAnglesFromView(vec3(0, 0, -1)), NaN, 0, -5, 1)
          === 1);
}

/**
 * `ActorBuildSkinnedModel` (`FUN_00410440`) raises bit 0x80 through
 * `SkeletonBuildAndPose` for every skinned class it serves, and `CatInit`
 * takes it back -- from the real spawn path, not a flag set by hand (L49).
 */
console.log("\nthe per-bone bit, from the skeleton build:");
{
  const rng = new Rng(3);
  scene(0, rng);
  const z = spawnZombie(0x3000, 1, "zombie");
  check("a zombie, built on a type with bones, carries bit 0x80",
        (z.flags & ActorFlag.ShootPerBone) !== 0, `0x${z.flags.toString(16)}`);
  const cat = ActorSpawn(0x3001, SpawnClass.SkinnedNpc, 1, "cat",
                         { class53: { set: 0, subtype: 0 } } as never);
  check("...a cat does not: `CatInit` clears it after its build",
        (cat.flags & ActorFlag.ShootPerBone) === 0,
        `0x${cat.flags.toString(16)}`);
  const none = ActorSpawn(0x3002, SpawnClass.Zombie, 0x77, "no type");
  check("...and a type the tables do not know has no nodes to raise it for",
        (none.flags & ActorFlag.ShootPerBone) === 0);
  ResetGameGlobals();
}

/**
 * Class 0x45, the stage-3 boss, driven through `GameUpdate` from a reset
 * (L49): the handler, init and update on three frames, the heads' fight and
 * its two gates, and the body. The skeletons are the shipped ones' shape --
 * `boss3.bin` a chain of nineteen nodes whose seventeenth carries the two
 * jaws, `boss3l.bin` twenty-six with the jaws on the twenty-fourth -- and
 * every clip is sixty frames of one pose, with the jaws open by `0x2000` or
 * shut, so the jaw gate is the fixture's to set.
 */
console.log("\nclass 0x45: the stage-3 boss -- heads, gates and the body:");
{
  const JAW = 0x1000;
  const boss3Bones = (n: number, weak: number, step: number) => {
    const out: CharacterType["bones"] = [];
    for (let b = 1; b <= weak; b++) {
      out.push({ bone: b, part: `n${b}`, slot: 900 + b,
                 offset: [b === 1 ? 0 : step, 0, 0],
                 parent: b === 1 ? null : b - 2, damage_rank: [],
                 hit_radius: b === weak ? 3 : 2.75, hit_centre: [0, 0, 0],
                 steps: [] } as never);
    }
    for (let b = weak + 1; b < n; b++) {
      out.push({ bone: b, part: `jaw${b}`, slot: 900 + b,
                 offset: [step, 0, 0], parent: weak - 1, damage_rank: [],
                 steps: [] } as never);
    }
    return out;
  };
  const boss3Clip = (bones: number, jawA: number, jawB: number,
                     open: boolean) => {
    const frames = 60;
    const rot = new Array<number>(frames * bones * 3).fill(0);
    for (let f = 0; f < frames; f++) {
      rot[(f * bones + jawA) * 3 + 2] = open ? JAW : 0;
      rot[(f * bones + jawB) * 3 + 2] = open ? -JAW : 0;
    }
    return { bank: "t", frames, fps: 30,
             root: new Array<number>(frames * 3).fill(0), rot };
  };
  const clips = (ids: number[], bones: number, jawA: number, jawB: number,
                 open: boolean) =>
    Object.fromEntries(ids.map((id) => [String(id),
                                        boss3Clip(bones, jawA, jawB, open)]));
  const range = (a: number, b: number) =>
    Array.from({ length: b - a + 1 }, (_, i) => a + i);
  const chars = (open: boolean) => ({
    ...CHARS,
    types: {
      "1": TYPE,
      "73": { ...TYPE, type: 73, name: "boss3", bone_count: 20,
              actor_radius: 45, bones: boss3Bones(20, 17, 3),
              motions: clips(range(74, 100), 20, 18, 19, open) },
      "72": { ...TYPE, type: 72, name: "boss3l", bone_count: 27,
              actor_radius: 95, bones: boss3Bones(27, 24, 4),
              motions: clips(range(59, 73), 27, 25, 26, open) },
    },
  } as unknown as CharactersJson);
  const OPEN = chars(true);
  const SHUT = chars(false);
  const HEAD_AT = [0xb000, 0xb028, 0xb050, 0xb078, 0xb0a0];
  const BODY_AT = 0xb0c8;
  const rng = new Rng(45);
  const events = new Events();
  /**
   * `op_` paths for the body: segment `k` walks along x from its own
   * `from`, so every point is distinct and the chain has somewhere to face.
   */
  const host: GameHost = {
    ...NULL_HOST,
    objectPath: (slot: number, frame: number) =>
      ({ x: frame * 0.5, y: -5, z: slot }),
  };
  const tick = (n: number): void => {
    for (let i = 0; i < n; i++) GameUpdate(1 / 60, host, rng, events);
  };
  const head = (i: number) => ActorByAt(HEAD_AT[i]) as Boss3Actor | null;

  /** Five heads out of the spawn list, in Boss Mode's block 15 (variant 0). */
  const fight = (tables: CharactersJson): Boss3Actor[] => {
    ResetGameGlobals();
    SetGameTables(tables);
    G.g_GameMode = GameMode.Boss;
    G.g_evt_block_index = 0xf;
    G.g_scene_state_major_entered = SCENE_MAJOR_PLAYING;
    G.g_scene_state_major = SCENE_MAJOR_PLAYING;
    EnterPlay();
    return HEAD_AT.map((at, i) => ActorSpawn(
      at, SpawnClass.Boss3, i === 2 ? 72 : 73, `head ${i}`,
      { class45: { subtype: Boss3Subtype.FightHead }, hp: i, visible: true,
        pos: vec3(i * 30 - 60, 0, 120) } as never) as Boss3Actor);
  };

  {
    const heads = fight(SHUT);
    check("a spawned head is on the class handler, not yet its init",
          heads[0].boss3.routine === Boss3Routine.ClassHandler);
    tick(1);
    check("frame 1 is `Boss3ClassHandler`: variant 0 from block 15 in Boss "
          + "Mode, the pool 180, and every head on its init",
          G.g_boss3_variant === Boss3Variant.Stage3A
            && G.g_boss3_head_hp_pool === 180
            && heads.every((h) => h.boss3.routine
                           === Boss3Routine.FightHeadInit),
          `variant ${G.g_boss3_variant} pool ${G.g_boss3_head_hp_pool}`);
    check("...and nothing is counted yet", G.g_enemies_present === 0);
    tick(1);
    check("frame 2 is the init: 45 hit points, head 2 alone in both counters",
          heads.every((h) => h.hp === 45) && G.g_enemies_present === 1
            && G.g_enemies_alive === 1
            && heads.every((h) => h.boss3.routine
                           === Boss3Routine.FightHeadUpdate),
          `present ${G.g_enemies_present} alive ${G.g_enemies_alive}`);
    check("...every head out of the shot test (bit 0x8000) and built per bone",
          heads.every((h) => (h.flags & ActorFlag.NoShotTest) !== 0
                      && (h.flags & ActorFlag.ShootPerBone) !== 0));
    tick(1);
    check("frame 3 is the update, and it registers nothing while 0x8000 holds",
          G.g_shot_test_list.length === 0,
          `${G.g_shot_test_list.length} registered`);
    G.g_script_flags[2] = 1;
    tick(1);
    check("`g_script_flags[2]` starts the fight: phase 1, every head idle, "
          + "shootable, and the bar full",
          G.g_boss3_phase === Boss3Phase.Fight
            && heads.every((h) => h.state === Boss3HeadState.Idle
                           && (h.flags & ActorFlag.NoShotTest) === 0)
            && G.g_boss_hp_bars.length === 1 && G.g_boss_hp_fraction === 1,
          `phase ${G.g_boss3_phase} bars ${G.g_boss_hp_bars.length}`);
    tick(1);
    check("...and all five register for the shot test once they are in it",
          HEAD_AT.every((at) => G.g_shot_test_list.some((e) => e.at === at)),
          `${G.g_shot_test_list.map((e) => e.at.toString(16)).join(",")}`);

    const bar = G.g_boss_hp_bars[0];
    const early = bar?.shown ?? -1;
    tick(120);
    check("the bar fills from empty to the heads' pool, a little a frame",
          early > 0 && early < 0.2 && bar?.shown === 1,
          `after 2 frames ${early}, after 122 ${bar?.shown}`);

    const headSnap = JSON.stringify(clonePlain(heads[2])).length;
    console.log(`  (a head mid-fight snapshots to ${headSnap} bytes)`);

    // A shot on the weak bone with the mouth shut is a miss.
    MarkActorShot(heads[0], 0, 17);
    tick(1);
    check("the weak bone with the jaws shut is a miss: no damage, a spark",
          heads[0].hp === 45 && G.g_boss3_sparks.length === 1,
          `hp ${heads[0].hp} sparks ${G.g_boss3_sparks.length}`);
  }

  {
    const heads = fight(OPEN);
    tick(3);
    G.g_script_flags[2] = 1;
    tick(2);
    MarkActorShot(heads[0], 0, 3);
    tick(1);
    check("with the jaws open, a bone that is not the weak one is still a miss",
          heads[0].hp === 45, `hp ${heads[0].hp}`);
    MarkActorShot(heads[0], 0, 17);
    tick(1);
    check("...and the weak bone takes 45/3 = 15 off the head and the pool",
          heads[0].hp === 30 && G.g_boss3_head_hp_pool === 165,
          `hp ${heads[0].hp} pool ${G.g_boss3_head_hp_pool}`);
    check("...the bar reads the pool over 180",
          G.g_boss_hp_fraction === Math.fround(165 * Math.fround(1 / 180)),
          `${G.g_boss_hp_fraction}`);
    check("...and the head flinches", heads[0].state === Boss3HeadState.Flinch);

    // Head 2 cannot be hurt on stage 3.
    for (let i = 0; i < 40 && heads[2].state !== Boss3HeadState.Idle; i++) {
      tick(1);
    }
    MarkActorShot(heads[2], 0, 24);
    tick(1);
    check("the big head refuses even an open-jawed weak-bone hit in variant 0",
          heads[2].hp === 45, `hp ${heads[2].hp}`);

    // Four small heads, three hits each.
    const shootDown = (h: Boss3Actor): void => {
      for (let n = 0; n < 400 && h.state !== Boss3HeadState.Dead; n++) {
        if (h.state === Boss3HeadState.Idle
            && !(h.flags & ActorFlag.Hit)) {
          MarkActorShot(h, 0, 17);
        }
        tick(1);
      }
    };
    for (const i of [0, 1, 3]) shootDown(heads[i]);
    check("three small heads down, the fight is still on and head 2 alive",
          G.g_boss3_heads_left === 2 && G.g_boss3_phase === Boss3Phase.Fight
            && heads[2].state !== Boss3HeadState.Dead,
          `left ${G.g_boss3_heads_left}`);
    shootDown(heads[4]);
    check("the fourth leaves one: head 2, whose own tail has not run yet",
          G.g_boss3_heads_left === 1 && heads[2].state === Boss3HeadState.Idle,
          `left ${G.g_boss3_heads_left} state ${heads[2].state}`);
    // Head 2 is ahead of head 4 in the walk, so its tail (`0x00421879`) sees
    // the count on the next frame.
    tick(1);
    check("...the next frame takes head 2 with it: nobody left, phase 2, the "
          + "big head dead on its own",
          G.g_boss3_heads_left === 0 && G.g_boss3_phase === Boss3Phase.AllDown
            && heads[2].state === Boss3HeadState.Dead,
          `left ${G.g_boss3_heads_left} phase ${G.g_boss3_phase} `
          + `state ${heads[2].state}`);
    check("...the bar reads empty", G.g_boss_hp_fraction === 0,
          `${G.g_boss_hp_fraction}`);
    check("...and still counts in `g_enemies_present`: the gate is closed",
          G.g_enemies_present === 1);
    let opened = -1;
    for (let n = 1; n <= 200 && opened < 0; n++) {
      tick(1);
      if (G.g_enemies_present === 0) opened = n;
    }
    check("180 frames later head 2 drops both counters -- the first gate",
          opened === 180 && G.g_enemies_alive === 0,
          `opened after ${opened} frames`);
    const gone = (i: number): boolean => head(i)?.despawned ?? true;
    check("...moves the class to phase 3, and leaves",
          G.g_boss3_phase === Boss3Phase.Despawn && gone(2),
          `phase ${G.g_boss3_phase}`);
    tick(1);
    check("...and on stage 3 every other head goes on the next frame",
          HEAD_AT.every((_, i) => gone(i)));
  }

  {
    // The scheduler: never more than two heads armed, and never head 2.
    const heads = fight(SHUT);
    G.g_player_no_damage[0] = 1;
    tick(3);
    G.g_script_flags[2] = 1;
    let most = 0;
    let bites = 0;
    let bigArmed = false;
    for (let n = 0; n < 3000; n++) {
      tick(1);
      const armed = heads.filter((h) => (h.boss3.block?.armed ?? -1) > -1);
      most = Math.max(most, G.g_boss3_heads_attacking, armed.length);
      if (heads[2].boss3.block!.armed > -1) bigArmed = true;
      bites += heads.filter((h) => h.state === Boss3HeadState.Attack
                            && h.boss3.cursor === 0).length;
    }
    check("in fifty seconds of fight the heads attack",
          bites > 0, `${bites} attacks started`);
    check("...never more than two armed at once", most <= 2 && most > 0,
          `most ${most}`);
    check("...and head 2 is never armed on stage 3", !bigArmed);
  }

  {
    // The body, on block 11 in the Arcade: variant 0. `g_GameMode` is the
    // run's and outlives a reset, so it is said again here.
    ResetGameGlobals();
    SetGameTables(OPEN);
    G.g_GameMode = GameMode.Arcade;
    G.g_evt_block_index = 0xb;
    G.g_scene_state_major_entered = SCENE_MAJOR_PLAYING;
    G.g_scene_state_major = SCENE_MAJOR_PLAYING;
    EnterPlay();
    const body = ActorSpawn(BODY_AT, SpawnClass.Boss3, 72, "body",
      { class45: { subtype: Boss3Subtype.Body }, hp: 1, visible: true,
        pos: vec3(0, 0, 100) } as never) as Boss3Actor;
    tick(2);
    check("the body's init: 120 hit points, the 95-unit broad sphere, state 8, "
          + "both counters",
          body.hp === 120 && body.hitRadius === 95
            && body.state === Boss3BodyState.BuildPath
            && G.g_enemies_present === 1 && G.g_enemies_alive === 1,
          `hp ${body.hp} r ${body.hitRadius} state ${body.state} `
          + `present ${G.g_enemies_present}`);
    tick(1);
    check("building its path it is drawn by nothing and not in the shot test",
          !body.boss3.drawn
            && !G.g_shot_test_list.some((e) => e.at === BODY_AT));
    for (let n = 0; n < 20 && body.state === Boss3BodyState.BuildPath; n++) {
      tick(1);
    }
    check("eight segments (variant 0) and it takes the camera",
          body.state === Boss3BodyState.TakeCamera
            && body.boss3.block!.pathCount > 2000,
          `state ${body.state} points ${body.boss3.block!.pathCount}`);
    tick(1);
    check("state 9 hands on to the swim and holds the camera (mode 6)",
          body.state === Boss3BodyState.Swim && G.g_camera_driver_held === 1,
          `state ${body.state} held ${G.g_camera_driver_held}`);
    tick(1);
    check("...swimming, it registers for the shot test and is drawn",
          G.g_shot_test_list.some((e) => e.at === BODY_AT) && body.boss3.drawn);
    MarkActorShot(body, 0, 0x18);
    tick(1);
    check("an open-jawed weak-bone hit in the swim does nothing",
          body.hp === 120, `hp ${body.hp}`);
    let surfaced = -1;
    for (let n = 0; n < 400 && surfaced < 0; n++) {
      tick(1);
      if (body.state === Boss3BodyState.Surfaced) surfaced = n;
    }
    check("the path cursor reaches the first surfacing (210) and it surfaces",
          surfaced >= 0 && body.boss3.block!.pathCursor === 210,
          `cursor ${body.boss3.block!.pathCursor} state ${body.state}`);
    MarkActorShot(body, 0, 0x18);
    tick(1);
    check("...where the same hit takes ten off, one player in play: 110",
          body.hp === 110, `hp ${body.hp}`);
    check("...and the bar reads it over 120",
          G.g_boss_hp_fraction === Math.fround(110 * Math.fround(1 / 120)),
          `${G.g_boss_hp_fraction}`);
    check("...the camera is still the body's",
          G.g_camera_driver_held === 1);
    let n = 0;
    while (body.state !== Boss3BodyState.Dead && n++ < 4000) {
      if ((body.state === Boss3BodyState.Surfaced
           || body.state === Boss3BodyState.Lunge)
          && !(body.flags & ActorFlag.Hit)) {
        MarkActorShot(body, 0, 0x18);
      }
      tick(1);
    }
    check("shot down: state 14, both counters dropped -- the second gate",
          body.state === Boss3BodyState.Dead && G.g_enemies_present === 0
            && G.g_enemies_alive === 0,
          `state ${body.state} present ${G.g_enemies_present} after ${n}`);
    check("...and it gives the camera back: driver free, `g_camera_free`",
          G.g_camera_driver_held === 0 && G.g_camera_free === 1);
    check("...the bar reads empty", G.g_boss_hp_fraction === 0);
    tick(1);
    check("dead, it registers nothing",
          !G.g_shot_test_list.some((e) => e.at === BODY_AT));
    const snap = JSON.stringify(clonePlain(body));
    check("the whole actor, path and all, is plain data a snapshot can copy",
          snap.length > 0, `${snap.length} bytes`);
    console.log(`  (a body mid-fight snapshots to ${snap.length} bytes)`);
  }
  G.g_GameMode = GameMode.Arcade;
  ResetGameGlobals();
}
