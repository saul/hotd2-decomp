import type { CharactersJson, CharacterType } from "../../src/bundle";
import { Rng } from "../../src/core/rng";
import { Events } from "../../src/core/events";
import { ActorSpawn, GameUpdate } from "../../src/game/director";
import { CameraActorTick } from "../../src/game/camera/actor";
import { CameraBlockViewToWorld } from "../../src/game/camera/view";
import { CameraBlocksReset, CheckpointResetCamera }
  from "../../src/game/camera/actions";
import { DeathArcMotion } from "../../src/game/combat/resolve_hit";
import { FishSpawnWaterSplash, WaterSplashUpdate }
  from "../../src/game/effects/fish";
import { OwlResolveShot } from "../../src/game/class43";
import { makeActor } from "../../src/game/actor";
import { CameraResetForPathShot } from "../../src/game/camera/mode";
import { ScriptedPropUpdate13 } from "../../src/game/class13";
import {
  CarrierState, type ScriptedPropTail,
} from "../../src/game/class13/state";
import { ActorBuildSkinnedModel } from "../../src/game/spawn";
import {
  AppState, G, ResetGameGlobals, ResetSceneOnEnter,
} from "../../src/game/globals";
import { NULL_HOST, type GameHost, type ShotPick } from "../../src/game/host";
import { type OwlTail } from "../../src/game/class43/state";
import { ActorShotFeedback } from "../../src/game/combat/feedback";
import { BLOOD_FIRST_SLOT, BLOOD_LAST_CEL, SpawnBloodSpray }
  from "../../src/game/effects/blood";
import { OriginalWeaponKind, SHOT_EFFECT_RING, TRACER_LAST_FRAME,
         FLASH_LAST_FRAME } from "../../src/game/effects/shot_effects";
import { ShotEffectsTick } from "../../src/game/effects/tick";
import { SpawnSpriteEffect, SpriteEffectKind }
  from "../../src/game/effects/sprite";
import { QueueShotRequest } from "../../src/game/combat/shot";
import { SetGameTables } from "../../src/game/tables";
import { ActorPlayHitVoice, ActorVoice }
  from "../../src/game/combat/voice";
import { ActorFlag, ZombieFlag2 } from "../../src/game/actor";
import { type ClassFrame } from "../../src/game/registry";
import { ActorPointIsAhead } from "../../src/game/class30/target";
import { ActorModelScale } from "../../src/game/root_motion";
import { ZOMBIE_SPRINTS, ZombieRunMotion } from "../../src/game/class30/states";
import {
  SeveredHeadPhase, SeveredHeadUpdate, SpawnSeveredHead,
} from "../../src/game/effects/severed_head";
import { SpawnClass } from "../../src/game/spawn_class";
import { vec3 } from "../../src/game/vec";
import { HitResultCode, ResolveHit } from "../../src/game/combat/resolve_hit";
import { Shutter } from "../../src/script/state/shutter";
import {
  HudDrawShutterState, SHUTTER_FRAMES, ShutterState,
} from "../../src/game/hud_shutter";
import {
  check, TYPE, CHARS, spawnZombie, scene, SeatCamera, EnterPlay,
} from "./harness";

// The character's size, and the two things it decides.
//
// `ActorBuildSkinnedModel` (`FUN_00410440`) writes `model+0x116C` from the
// character type alone, and `SkeletonApplyRootMotion` scales the clip's root
// delta by it -- so a smaller character takes smaller steps. This port applied
// 1.0 to everything and called the field "drawing only".
{
  // The three arms store float immediates -- `0x3f19999a`, `0x3f333333`,
  // `0x3f666666` -- so the port's values are those floats, not the doubles
  // they round from.
  check("the scale table is the engine's jump table, not a guess",
        ActorModelScale(30) === Math.fround(0.6)
        && ActorModelScale(31) === Math.fround(0.7)
        && ActorModelScale(32) === Math.fround(0.9)
        && ActorModelScale(56) === Math.fround(0.9)
        && ActorModelScale(29) === 1 && ActorModelScale(57) === 1
        && ActorModelScale(8) === 1,
        `${[29, 30, 31, 32, 56, 57].map(ActorModelScale).join(", ")}`);
  check("...and they are the engine's float bits",
        [30, 31, 32].map((t) => {
          const f = new Float32Array([ActorModelScale(t)]);
          return new Uint32Array(f.buffer)[0].toString(16);
        }).join(",") === "3f19999a,3f333333,3f666666");

  // Stage 1's rescue, in one line: the civilian is type 38 and her captor
  // type 8, so she flees at 0.9 of her clip and he walks at all of his.
  // Unscaled the gap closes at 0.800 - 0.688 = 0.112 an authored frame;
  // scaled, at 0.800 - 0.619 = 0.180. Both are small, and the ratio between
  // two small numbers is not small: 1.6x, which is a grab 158 ticks after the
  // spawn instead of 244 -- inside its camera shot instead of long after it.
  const civRun = 0.6885 * ActorModelScale(38);
  const captorWalk = 0.800 * ActorModelScale(8);
  const ratio = (captorWalk - civRun) / (0.800 - 0.6885);
  check("...so the captor closes on the civilian 1.6x faster than unscaled",
        Math.abs(ratio - 1.61) < 0.02, `${ratio.toFixed(2)}x`);
}

// **The build writes the size for every skinned actor, and the hit radii from
// it.** `ActorBuildSkinnedModel` (`FUN_00410440`) stores `model+0x116C` first,
// whatever the actor, and `SkeletonWalkNode` (`FUN_004107E0`) then writes each
// bone record's radius as the table's times that size:
//
//     00410837  FLD  float ptr [ECX + 0x1300]   ; g_cur_actor's model+0x116C
//     0041083D  FMUL float ptr [EAX + -0x4]     ; the row's radius
//     00410840  FSTP float ptr [ESI + 0x78]     ; the record's
//
// The port wrote the size only for an actor that carries the model block, and
// no radius at all -- every reader took the table's, so a civilian drawn at
// 0.9 would have been shot through spheres drawn for 1.0.
{
  ResetGameGlobals();
  const PEOPLE: CharacterType = { ...TYPE, type: 38, name: "test civilian" };
  SetGameTables({ ...CHARS, types: { ...CHARS.types, "38": PEOPLE } } as
                unknown as CharactersJson);
  const civ = makeActor(0x3000, SpawnClass.Civilian, 38, "civ");
  // What op 0x27 might have left on a pooled object: the build overwrites it.
  civ.scale = 50;
  ActorBuildSkinnedModel(civ);
  const s = Math.fround(0.9);
  check("the build writes the size for an actor with no model block",
        civ.scale === s && !civ.skel, `${civ.scale}`);
  check("...and every bone's hit radius, as the table's times the size",
        civ.boneRadius["1"] === Math.fround(s * 3)
        && civ.boneRadius["2"] === Math.fround(s * 2)
        && civ.boneRadius["4"] === Math.fround(s * 2)
        && civ.boneRadius["5"] === Math.fround(s * 2),
        JSON.stringify(civ.boneRadius));
  const z = makeActor(0x3001, SpawnClass.Zombie, 1, "z");
  ActorBuildSkinnedModel(z);
  check("...and a type at 1.0 keeps the table's own",
        z.scale === 1 && z.boneRadius["1"] === 3 && z.boneRadius["2"] === 2,
        JSON.stringify(z.boneRadius));
  // The one later writer of the size is op 0x27, and it writes the size only:
  // the radii are the build's for the rest of the actor's life. That is held
  // where it could go wrong -- a reader deriving the radius from the live
  // size -- in `test/render.test.ts`.
  ResetGameGlobals();
  SetGameTables(CHARS);
}

// `ActorPointIsAhead` (`FUN_0045BC10`): the world delta rotated into the
// actor's own frame by `MatrixRotateY(-yaw)`, and whether that local z is
// positive. `MatrixRotateY(t)` builds `row0 = (cos, 0, -sin)`,
// `row2 = (sin, 0, cos)`, and the transform is D3D's row-vector form, so
// `z' = dz*cos(t) - dx*sin(t)`; at `t = -yaw` that is `dx*sin + dz*cos`. The
// port had `dz*cos - dx*sin` -- the *forward* rotation -- so the dx term
// carried the wrong sign and the predicate answered the mirror question.
//
// The clips face -Z, so a positive local z is a point **behind** the actor,
// which is the question a state named "walk past point" is asking.
{
  const past = (yaw: number, px: number, pz: number) =>
    ActorPointIsAhead({ pos: vec3(0, 0, 0), yaw } as never, vec3(px, 0, pz));
  // Facing +X (yaw 0xC000): a point at +55 is in front of the actor.
  check("a point in front of the actor does not read as walked past",
        past(0xc000, 55, 0) === false);
  check("...and one behind it does", past(0xc000, -55, 0) === true);
  check("...and both answers flip with the facing",
        past(0x4000, 55, 0) === true && past(0x4000, -55, 0) === false);
  // The sideways pair is what the sign error could not tell apart: only the
  // dx term separates them, so with the wrong sign these two agreed.
  check("...and the two sideways points are separated by the yaw term",
        past(0xc000, 0, 55) !== past(0xc000, 0, -55));
}

// The head that comes off, and where it lands.
//
// `SpawnSeveredHead` (`FUN_0040A130`) is an `ActorAlloc` of an object with its
// own per-frame routine -- not the blood spray `docs/formats/combat.md` called
// it, which is why the port removed the head and drew nothing. The physics is
// `SeveredHeadUpdate` (`FUN_0040A230`): thrown up and away from the camera,
// spun on two axes, bounced off the floor at a quarter of its speed, then
// settled, sunk and freed.
{
  ResetGameGlobals();
  EnterPlay();
  const rng = new Rng(7);
  SpawnSeveredHead(vec3(0, 40, 0), 0x1234, 0, 0);
  check("a burst puts one head in the pool", G.g_severed_heads.length === 1);
  const h = G.g_severed_heads[0]!;
  check("...carrying the model the head was drawn with", h.slot === 0x1234);

  SeveredHeadUpdate(h, rng);
  check("...thrown upward between 0.31 and 0.50",
        h.vel.y > 0.28 && h.vel.y < 0.51, `${h.vel.y}`);
  check("...and spun on both axes",
        Math.abs(h.spinYaw) >= 0x800 && h.spinPitch >= 0x800,
        `yaw ${h.spinYaw} pitch ${h.spinPitch}`);
  check("...and it is falling, not still launching",
        h.phase === SeveredHeadPhase.Falling, `phase ${h.phase}`);

  // No collision in this fixture, so the ground answers a constant; what the
  // assertion is about is that gravity is applied and the head comes down.
  const apex = () => {
    let top = h.pos.y, last = h.pos.y;
    for (let i = 0; i < 120 && SeveredHeadUpdate(h, rng); i++) {
      top = Math.max(top, h.pos.y);
      last = h.pos.y;
    }
    return { top, last };
  };
  const { top, last } = apex();
  check("...it rises and then falls", top > 40 && last < top,
        `apex ${top.toFixed(1)}, ended ${last.toFixed(1)}`);

  // The settle path, driven directly: a head at rest counts out and is dropped.
  const g = G.g_severed_heads[0]!;
  g.phase = SeveredHeadPhase.Settled;
  g.timer = 2;
  check("a settled head sinks", (() => {
    const before = g.pos.y;
    SeveredHeadUpdate(g, rng);
    return g.pos.y < before;
  })());
  check("...and is dropped when its two seconds are out",
        SeveredHeadUpdate(g, rng) === false, `timer ${g.timer}`);
}

// **The camera block's yaw, and the routines that read it.**
//
// `g_camera_block_yaw_bams` (`0x009A60D0`) is the heading of the camera block
// `UpdateSceneViewAndLight` builds the view from: `VecToAngles(eye - target)`,
// the camera's own +z, which points back at the viewer. `g_camera_yaw_bams`
// (`0x009C71F0`) is a different word, which the scene state's hooks write as a
// camera heading turned half round. The routines below read the first and
// the port had them reading the second, so every one of them was half a turn
// out. Each check sets the two apart -- the block at a quarter turn, the other
// word at what the hook would write from it -- so a reader of the wrong one
// cannot pass.
console.log("\nthe camera block's yaw (0x009A60D0) and its readers:");
{
  const camera = (block: number) => {
    G.g_camera_block_yaw_bams = block;
    G.g_camera_yaw_bams = (block - 0x8000) & 0xffff;
  };

  // `ChooseDeathMotionDirectional` (`0x00456248`): the block's yaw less the
  // actor's, and four inclusive arcs tested in a row.
  {
    ResetGameGlobals();
    SetGameTables(CHARS);
    const z = spawnZombie(0x7d00, 1, "dying");
    const pick = (block: number, yaw: number, seed = 5) => {
      camera(block);
      z.yaw = yaw;
      const r = new Rng(seed);
      return { m: DeathArcMotion(z, r), state: r.state };
    };
    const drawn = (seed: number, n: number) => {
      const r = new Rng(seed);
      for (let i = 0; i < n; i++) r.next();
      return r.state;
    };
    check("an actor facing the camera (0x8000 between them) falls back, "
          + "from the 0x8000 table",
          pick(0x8000, 0).m === 901, String(pick(0x8000, 0).m));
    check("...one with its back to it falls forward, from the 0x0000 table",
          pick(0, 0).m === 900, String(pick(0, 0).m));
    check("...0x4000 is the literal 0x3E0 and 0xC000 the literal 0x3DF",
          pick(0x4000, 0).m === 992 && pick(0xc000, 0).m === 991);
    check("...and the literal arcs draw nothing",
          pick(0x4000, 0).state === drawn(5, 0));
    // 0x2000 is the edge of the 0x4000 arc and of the 0x0000 arc both; the
    // 0x0000 test runs later, so it wins and draws its `rand()`.
    const edge = pick(0x2000, 0);
    check("a heading on a boundary takes the later arc, and its draw",
          edge.m === 900 && edge.state === drawn(5, 1),
          `${edge.m} ${edge.state === drawn(5, 1)}`);
  }

  // `SeveredHeadUpdate` (`0x0040A2A6`): `MatrixRotateY(block yaw)` on
  // `(0, 0, -0.2)`. At 0x4000 the camera looks down -x, so the head goes -x.
  {
    ResetGameGlobals();
    EnterPlay();
    camera(0x4000);
    SpawnSeveredHead(vec3(0, 40, 0), 0x1234, 0, 0);
    const h = G.g_severed_heads[0]!;
    SeveredHeadUpdate(h, new Rng(7));
    check("a severed head is thrown away from the viewer, down the block's -z",
          Math.abs(h.vel.x - -0.2) < 1e-6 && Math.abs(h.vel.z) < 1e-6,
          `${h.vel.x.toFixed(3)},${h.vel.z.toFixed(3)}`);
  }

  // `WaterSplashUpdate` (`0x00439F5A`): `RotY(block yaw)` under the cel.
  {
    ResetGameGlobals();
    camera(0x4000);
    const f = spawnZombie(0x7d01, 1, "fish stand-in");
    FishSpawnWaterSplash(f, 1, 0);
    const s = G.g_fish_water_splashes[0]!;
    WaterSplashUpdate(s);
    check("a fish's splash faces the camera block's yaw",
          s.shownYaw === 0x4000, String(s.shownYaw));
  }

  // `OwlUpdateAndResolveShot` (`0x0044627B`): the corpse is thrown at unit
  // speed along `block yaw + 0x8000`, the camera's forward.
  {
    const rng = new Rng(37);
    scene(0, rng);
    const o = ActorSpawn(0x9601, SpawnClass.FlyingEnemy, -1, "owl", {
      pos: vec3(0, 0, 40), class43: { subtype: 1, member: 0 },
    }, rng);
    const t = (o as { owl: OwlTail }).owl;
    t.vx = 0;
    t.vz = 0;
    camera(0x4000);
    o.flags |= ActorFlag.Hit | ActorFlag.HitByPlayer0;
    const shot = OwlResolveShot(o, { dt: 1 / 60, rng,
                                     host: NULL_HOST });
    check("a shot owl is thrown away from the viewer, down the camera's -x",
          shot && Math.abs(t.vx - -1) < 1e-6 && Math.abs(t.vz) < 1e-6,
          `${shot} ${t.vx.toFixed(3)},${t.vz.toFixed(3)}`);
  }

  // `FILD [EAX*4 + 0x9a6110]` at `0x004460EA`, `EAX` from `MOV ECX,
  // [0x009c6f00]`: a sub-type-0 owl's guard reads the frame of the block
  // `g_camera_index` names. Under the checkpoint's (1, 3) that is block 2's,
  // always 0, so it cannot be shot however far block 0's path has run --
  // stage 2's is in the pool through such a stretch.
  {
    const shoot = (checkpoint: boolean) => {
      const rng = new Rng(38);
      scene(0, rng);
      if (checkpoint) CheckpointResetCamera();
      G.g_cam_path_frame = 700;
      const o = ActorSpawn(0x9602, SpawnClass.FlyingEnemy, -1, "owl", {
        pos: vec3(0, 0, 40), class43: { subtype: 0, member: 0 },
      }, rng);
      o.flags |= ActorFlag.Hit | ActorFlag.HitByPlayer0;
      return { shot: OwlResolveShot(o, { dt: 1 / 60, rng, host: NULL_HOST }),
               index: G.g_camera_index };
    };
    const open = shoot(false);
    check("a sub-type-0 owl can be shot once block 0's path passes 682",
          open.shot && open.index === 0, JSON.stringify(open));
    const held = shoot(true);
    check("...but not under the checkpoint's (1, 3), where the guard reads "
          + "block 2's frame, always 0 (`0x004460EA`)",
          !held.shot && held.index === 2, JSON.stringify(held));
  }

  // `CarrierPropRoutine6` (`0x004415D3`): the bow strip faces the block.
  {
    const rng = new Rng(66);
    scene(0, rng);
    G.g_civilians_alive = 1;
    const host: GameHost = {
      ...NULL_HOST,
      objectPath: (slot, frame) =>
        ({ x: frame, y: slot, z: 0, pitch: 0, yaw: 0, roll: 0 }),
    };
    const fr = (): ClassFrame => ({ dt: 1 / 60, rng, host });
    G.g_cam_path_frame = 0x600;
    const boat = ActorSpawn(29241, SpawnClass.ScriptedProp, -1, "boat", {
      class13: { slot: 6711, cam_path: 134, cam_frame: 340, scale: 1,
                 behaviour: 8, selector: 6 },
    }, rng);
    const t = (boat as { prop13: ScriptedPropTail }).prop13;
    ScriptedPropUpdate13(boat, fr());
    t.state = CarrierState.RunPast;
    t.pathFrame = 0x6a4;
    G.g_prop_strip_effects = [];
    camera(0x4000);
    ScriptedPropUpdate13(boat, fr());
    const bow = G.g_prop_strip_effects[0];
    check("a carrier's bow strip faces the camera block's yaw",
          !!bow && bow.yaw === 0x4000, String(bow?.yaw));
  }

  // Camera block 2, which the frog's wedge reads (`0x0043AB62`):
  // `EvtRunQueuedActionsSyncViewBlock` (`0x004023D0`) copies block 0's pose
  // into it while the scene state is (1, 3) and derives its angles, and
  // nothing else moves it -- so on a rail it keeps the last turn's heading.
  {
    ResetGameGlobals();
    const scene = (major: number, minor: number) => {
      G.g_scene_state_major = G.g_scene_state_major_entered = major;
      G.g_scene_state_minor = G.g_scene_state_minor_entered = minor;
    };
    check("camera block 2 starts at zero", G.g_camera_block2_yaw_bams === 0);
    scene(1, 3);
    SeatCamera(vec3(0, 0, 0), vec3(-10, 0, 0));   // looking down -x
    CameraActorTick();
    check("under a view-angle turn, (1, 3), block 2 takes block 0's heading",
          Math.abs(G.g_camera_block2_yaw_bams - 0x4000) <= 1
          && Math.abs(G.g_camera_block2_yaw_bams
                      - G.g_camera_block_yaw_bams) <= 1,
          `block2 ${G.g_camera_block2_yaw_bams} block0 `
          + `${G.g_camera_block_yaw_bams}`);
    const held = G.g_camera_block2_yaw_bams;
    scene(2, 4);
    SeatCamera(vec3(0, 0, 0), vec3(10, 0, 0));    // now looking down +x
    CameraActorTick();
    check("...and keeps it once the turn is over, whatever block 0 does",
          G.g_camera_block2_yaw_bams === held
          && Math.abs(G.g_camera_block_yaw_bams + 0x4000) <= 1,
          `block2 ${G.g_camera_block2_yaw_bams} block0 `
          + `${G.g_camera_block_yaw_bams}`);
    scene(1, 1);
    CameraActorTick();
    check("...and another minor of major 1 does not copy either",
          G.g_camera_block2_yaw_bams === held);
    CameraBlocksReset();
    check("`CameraBlocksReset` zeroes it with the other three",
          G.g_camera_block2_yaw_bams === 0
          && G.g_camera_block2_eye.x === 0 && G.g_camera_block2_target.x === 0);
    G.g_cam_path_frame_2 = 5;
    CameraBlocksReset();
    check("...and block 2's path frame, `+0x110` (`0x004021EC`)",
          G.g_cam_path_frame_2 === 0, String(G.g_cam_path_frame_2));
  }

  // Scene state (1, 3) **draws** camera block 2. Its installer,
  // `CameraInstallViewAngles` (`FUN_004039D0`), writes `g_camera_index` 2
  // (`MOV dword ptr [0x009c6f00], 0x2` at `0x004039D5`) -- and the checkpoint
  // every block opens with enters (1, 3) -- until a starter's
  // `CameraResetForPathShot` (`MOV [0x009c6f00], EAX` at `0x00403209`, EAX 0)
  // puts it back. `UpdateSceneViewAndLight` nods only the block the index
  // names (`CMP EBP, [0x009c6f00]` at `0x00401F4E`) and the frame is drawn
  // from that block's matrices, so a cutscene is block 0's eye looking at
  // block 0's look-at whatever block 0's angles say.
  {
    ResetGameGlobals();
    check("a scene opens on camera block 0", G.g_camera_index === 0);
    CheckpointResetCamera();
    check("the checkpoint's (1, 3) makes camera block 2 the drawn block",
          G.g_camera_index === 2, String(G.g_camera_index));
    // Block 0 looking down -z; its look-at then moved to +x with no angle
    // written, as the boss-name banner moves it.
    SeatCamera(vec3(0, 0, 0), vec3(0, 0, -10));
    const yaw0 = G.g_camera_block_yaw_bams;
    const pitch0 = G.g_camera_block_pitch_bams;
    G.g_camera_block_target = vec3(10, 0, 0);
    CameraActorTick();                     // stamps (1, 3): the copy runs next
    G.g_screen_shake_pitch = 47;
    CameraActorTick();
    check("under (1, 3) the shake's nod lands on block 2, never on block 0",
          Math.abs(G.g_camera_block_pitch_bams - pitch0) <= 1
          && Math.abs(G.g_camera_block_yaw_bams - yaw0) <= 1
          && G.g_camera_block2_pitch_bams !== G.g_camera_block_pitch_bams,
          `block0 ${G.g_camera_block_pitch_bams} (was ${pitch0}) block2 `
          + `${G.g_camera_block2_pitch_bams}`);
    G.g_screen_shake_pitch = 0;
    CameraActorTick();
    const v2w = CameraBlockViewToWorld(G.g_camera_index);
    // The camera looks down its own -z: row 2 of the view-to-world, negated.
    check("...and the frame is drawn looking at block 0's look-at, though "
          + "block 0's own heading is a quarter turn away",
          -v2w[8] > 0.9999 && Math.abs(v2w[9]) < 1e-4
          && Math.abs(v2w[10]) < 1e-2
          && Math.abs(G.g_camera_block_yaw_bams - yaw0) <= 1,
          Array.from(v2w.slice(8, 11)).join());
    CameraResetForPathShot();
    check("a starter's `CameraResetForPathShot` hands the frame back to block 0",
          G.g_camera_index === 0
          && CameraBlockViewToWorld(G.g_camera_index)
             === G.g_camera_view_to_world);
  }
}

// Which of the run pair a zombie takes, and who decides.
//
// `ZombieStateAttackRun` (`FUN_004554D0`) indexes its motion row with
// `2 + ((obj+0x34 >> 0x1B) & 1)`. The bit comes off the spawn record through
// `ActorInitFlags`, so it is placement data first; two run-time `OR`s raise
// it as well (`ZombieOnShot`, below, and `ZombieRetireThrowConditionIfUnarmed`).
// The port took "the first of the pair this bundle carries" instead, which is
// always row 2, so 192 of the 402 shipped class-0x30 spawns jogged where the
// data says they sprint.
{
  const row = [900, 901, 902, 903, 904];
  const zombie = (flags: number) => {
    ResetGameGlobals();
    EnterPlay();
    const z = spawnZombie(0x4000, 1, "runner");
    z.flags = flags;
    return z;
  };
  check("an unflagged spawn takes the jog, row 2",
        ZombieRunMotion(zombie(0), row) === 902);
  check("...and a flagged one takes the sprint, row 3",
        ZombieRunMotion(zombie(ZOMBIE_SPRINTS), row) === 903);
  // The bit is 0x08000000 and nothing else in the word may reach the index.
  check("...and no other flag moves the index",
        ZombieRunMotion(zombie(0xf7ffffff), row) === 902,
        `${ZombieRunMotion(zombie(0xf7ffffff), row)}`);
  check("...while the whole word does",
        ZombieRunMotion(zombie(0xffffffff), row) === 903);
}

// The headshot burst, end to end.
//
// The physics assertions above drive `SeveredHeadUpdate` directly, which is
// exactly why the first cut of this shipped doing nothing: `ResolveHit` read
// the head's model out of `obj.boneSlot`, which is **empty until something
// swaps a part**, so a clean headshot kill -- the common case -- found slot 0
// and spawned no head at all. Testing the physics is not testing the trigger.
{
  const rng = new Rng(11);
  scene(1, rng);
  G.g_app_state = AppState.InPlay;
  const z = G.g_object_list[0];

  // One in four, so drive it until it fires rather than guessing a seed.
  let fired = 0, tries = 0;
  for (; tries < 60 && fired === 0; tries++) {
    G.g_severed_heads.length = 0;
    z.hp = 1;
    z.dead = false;
    z.flags = 0;
    z.removed.length = 0;
    z.boneSlot = {};
    ResolveHit(z, 2, NULL_HOST, rng);
    fired = G.g_severed_heads.length;
  }
  check("a headshot kill throws a head", fired === 1, `after ${tries} kills`);
  check("...carrying the skeleton's own head model, with nothing swapped",
        G.g_severed_heads[0]?.slot === 0x30,
        `slot ${G.g_severed_heads[0]?.slot}`);

  // ...and the three types the engine spares keep theirs, whatever the roll.
  const spared = (t: number) => {
    const r = new Rng(11);
    scene(1, r);
    G.g_app_state = AppState.InPlay;
    const a = G.g_object_list[0];
    a.charType = t;
    for (let i = 0; i < 40; i++) {
      a.hp = 1; a.dead = false; a.flags = 0; a.removed.length = 0;
      ResolveHit(a, 2, NULL_HOST, r);
    }
    return G.g_severed_heads.length;
  };
  check("...and character types 3, 0x12 and 0x18 never lose one",
        spared(3) === 0 && spared(0x12) === 0 && spared(0x18) === 0);
  G.g_app_state = AppState.Attract;

  if (process.env.HEAD_TRACE) {
    ResetGameGlobals();
    EnterPlay();
    const r = new Rng(3);
    SpawnSeveredHead(vec3(0, 11, 0), 0x30, 0, 0);
    const h = G.g_severed_heads[0]!;
    let f = 0, apex = 0, dist = 0;
    while (SeveredHeadUpdate(h, r) && f < 400) {
      apex = Math.max(apex, h.pos.y);
      dist = Math.hypot(h.pos.x, h.pos.z);
      if (f < 6 || f % 10 === 0) {
        console.log(`    f${String(f).padStart(3)} y=${h.pos.y.toFixed(2)}`
          + ` vy=${h.vel.y.toFixed(3)} d=${dist.toFixed(2)} phase=${h.phase}`);
      }
      f++;
    }
    console.log(`    apex ${apex.toFixed(2)} (from 11), travelled `
      + `${dist.toFixed(2)}, alive ${f} frames`);
  }
}


// -- 26. the shot effects: what leaves the gun, and what sticks to the bone --

/**
 * **Every sprite a bullet makes, with no renderer anywhere near it.**
 *
 * All of this used to be a canvas gradient in `render/shooting.ts`, so none of
 * it could be asserted and two thirds of it did not exist: there was no muzzle
 * flash, no tracer, and the blood was a fading circle at the bone rather than
 * a twenty-five-model flipbook stuck to it.
 *
 * The host here is a camera at the origin looking down **+Z**, which is the
 * direction `RAY` points in every other section of this file, so `viewPoint`
 * and `viewSpaceOfPoint` are one sign flip each.
 */
/**
 * **All five of `ActorPlayHitVoice`'s kinds**, from the one copy of it.
 *
 * `FUN_0040A6F0` has five kinds and the port used to have it twice: kinds 0, 1
 * and 2 in `render/shooting.ts` because the shot path needed them, kind 3
 * nowhere at all -- so a zombie made a noise when you shot it and none when it
 * swung at you, which is how it was reported. Kind 3 is also the only kind
 * whose table entry is a *pair per voice set* rather than one id per set, and
 * the exporter had been reading all fifteen dwords of `g_hit_voice_table` and
 * emitting eleven.
 *
 * There is one copy now, in `game/combat/voice.ts`, so every kind is reachable
 * from here: the set split, the pair, the impact-plus-voice shape of 0, 1 and
 * 2, and kind 4's proved silence. Which kind a *shot* passes is the next
 * section; `ZombieStateStrike` raising kind 3 is checked by the sound reaching
 * the event bus during a real strike.
 */
console.log("\nthe five voice kinds:");
{
  const heard: number[] = [];
  const rng = new Rng(7);
  SetGameTables({
    ...CHARS,
    combat: {
      impact: [{ id: 1, file: "" }],
      head_impact: [{ id: 2, file: "" }],
      voice: {
        hurt: [{ id: 10, file: "" }, { id: 11, file: "" }],
        kill: [{ id: 20, file: "" }, { id: 21, file: "" }],
        head: [{ id: 30, file: "" }, { id: 31, file: "" }],
        attack: [[{ id: 40, file: "" }, { id: 41, file: "" }],
                 [{ id: 50, file: "" }, { id: 51, file: "" }]],
      },
      // The engine's own list, at `0x0040A6F5`.
      voice_set_a_types: [0, 2, 5, 6, 9, 0x0e, 0x0f, 0x10, 0x11],
      ricochet: {},
    },
  } as unknown as CharactersJson);
  const say = (id: number) => heard.push(id);

  heard.length = 0;
  ActorPlayHitVoice({ charType: 2 }, ActorVoice.Attack, rng, say);
  check("a set-A character cries out of set A's pair",
        heard.length === 1 && (heard[0] === 40 || heard[0] === 41),
        JSON.stringify(heard));

  heard.length = 0;
  ActorPlayHitVoice({ charType: 1 }, ActorVoice.Attack, rng, say);
  check("...and a set-B character out of set B's",
        heard.length === 1 && (heard[0] === 50 || heard[0] === 51),
        JSON.stringify(heard));

  // Kind 3 is the only one that plays a *single* sound: the other three open
  // with an impact and the routine's tail plays no second id for this one.
  heard.length = 0;
  ActorPlayHitVoice({ charType: 1 }, ActorVoice.Hurt, rng, say);
  check("a hurt voice is an impact and a voice, which the cry is not",
        heard.length === 2 && heard[0] === 1 && heard[1] === 11,
        JSON.stringify(heard));

  // Kinds 1 and 2 are the other two halves of the shot voice, and they differ
  // in their *impact* rather than in their line: kind 1 draws one of five body
  // impacts, kind 2 coin-flips two head ones. In the shipped table their two
  // voice ids are the same pair, which is why the correction this port made to
  // which kind plays is nearly inaudible -- the fixture gives them distinct
  // ids so that the wiring is still assertable.
  heard.length = 0;
  ActorPlayHitVoice({ charType: 1 }, ActorVoice.Killed, rng, say);
  check("a kill voice is a body impact and set B's kill line",
        heard.length === 2 && heard[0] === 1 && heard[1] === 21,
        JSON.stringify(heard));

  heard.length = 0;
  ActorPlayHitVoice({ charType: 2 }, ActorVoice.HeadKilled, rng, say);
  check("a head voice takes the *head* impact table, and set A's line",
        heard.length === 2 && heard[0] === 2 && heard[1] === 30,
        JSON.stringify(heard));

  // `[proved]` in `functions.tsv`: no site in the image passes 4 and both of
  // its ids are zero, so the engine's own arm reaches `PlaySoundId(0)`.
  heard.length = 0;
  ActorPlayHitVoice({ charType: 2 }, ActorVoice.Kind4, rng, say);
  check("kind 4 is silence, because the engine's ids for it are zero",
        heard.length === 0, JSON.stringify(heard));

  // A bundle written before the four ids were read carries no `attack`, and
  // then the swing has to stay silent rather than throw.
  heard.length = 0;
  SetGameTables({
    ...CHARS,
    combat: { impact: [], head_impact: [], voice: { hurt: [], kill: [], head: [] },
              voice_set_a_types: [], ricochet: {} },
  } as unknown as CharactersJson);
  ActorPlayHitVoice({ charType: 1 }, ActorVoice.Attack, rng, say);
  check("an older bundle with no `attack` is silent, not broken",
        heard.length === 0, JSON.stringify(heard));
}

console.log("\nthe shot effects:");
{
  const rng = new Rng(26);
  const events = scene(1, rng);
  SetGameTables({
    ...CHARS,
    combat: {
      blood_scale: { "1": 0.75, "2": 0.5, "3": 1.0 },
      impact_sprite: { "3": [0x0e25, 0x0e33, 1.0] },
      impact_sprite_default: [0x0904, 0x0904, 0.1],
      ricochet: {},
      // The shot voice is raised from `ActorShotFeedback` now, so this fixture
      // needs the table it reads. One id per row, so which row fired is the
      // number that comes out.
      impact: [{ id: 1, file: "" }],
      head_impact: [{ id: 2, file: "" }],
      voice: {
        hurt: [{ id: 10, file: "" }, { id: 11, file: "" }],
        kill: [{ id: 20, file: "" }, { id: 21, file: "" }],
        head: [{ id: 30, file: "" }, { id: 31, file: "" }],
        attack: [[{ id: 40, file: "" }], [{ id: 50, file: "" }]],
      },
      voice_set_a_types: [0],
    },
  } as unknown as CharactersJson);
  const z0 = G.g_object_list[0]!;
  z0.hp = 100;

  let pick: ShotPick | null = null;
  const host = {
    ...NULL_HOST,
    pickShot: () => pick,
    viewPoint: (x: number, y: number, z: number,
                out: { x: number; y: number; z: number }) => {
      out.x = x; out.y = y; out.z = -z;
    },
    viewSpaceOfPoint: (p: { x: number; y: number; z: number },
                       out: { x: number; y: number; z: number }) => {
      out.x = p.x; out.y = p.y; out.z = -p.z;
      return true;
    },
  };
  const RAY = { origin: vec3(0, 0, 0), dir: vec3(0, 0, 1) };

  // -- the muzzle, on a miss ------------------------------------------------
  pick = null;
  QueueShotRequest(0, RAY);
  GameUpdate(1 / 60, host, rng, events);
  const flash = G.g_shot_flash_ring[0]!;
  const tracer = G.g_shot_tracer_ring[0]!;
  check("a shot that hits nothing still lights the muzzle", flash.live);
  check("...and still throws a tracer", tracer.live);
  check("the muzzle point is the crosshair at camera-space z = -1",
        Math.abs(flash.pos.z + 1) < 1e-6, `${flash.pos.z}`);
  check("the tracer flies twenty units a frame",
        Math.abs(Math.hypot(tracer.vel.x, tracer.vel.y, tracer.vel.z) - 20)
          < 1e-4, `${tracer.vel.z}`);
  // The full-screen flash on every shot. The muzzle is one
  // unit in front of the eye, and the tracer's quad drawn there at scale 1
  // fills the frame. `PlayerShotEffectsThink` (`FUN_00416B00`) moves a
  // tracer **before** it draws it, so the engine never draws one there: the
  // first position anything can see is one move out, and the roll has made
  // its first step. The spawn lands after this frame's tick, so the spawn
  // has to make that first move itself.
  check("the tracer is first seen one move out from the muzzle, never at it",
        Math.abs(tracer.pos.z - (1 + 20)) < 1e-4 && tracer.spin === 0x1000
        && tracer.frame === 0,
        `z ${tracer.pos.z} spin ${tracer.spin} frame ${tracer.frame}`);
  check("nothing was hit, so the tracer is not cut short",
        G.g_shot_hit_something[0] === 0);
  check("the ring cursor moved on", G.g_shot_effect_cursor[0] === 1);

  // The flash is nine frames and the tracer sixty, counted the way the engine
  // counts them: the frame steps whether or not the record is live.
  for (let i = 0; i < FLASH_LAST_FRAME + 1; i++) ShotEffectsTick();
  check("the muzzle flash is nine frames", !flash.live && tracer.live,
        `flash ${flash.frame}, tracer ${tracer.frame}`);
  for (let i = 0; i < TRACER_LAST_FRAME; i++) ShotEffectsTick();
  check("...and the tracer sixty", !tracer.live, `${tracer.frame}`);

  // -- a hit cuts the tracer on its second frame ---------------------------
  pick = { kind: "actor", at: z0.at, bone: 1, point: vec3(0, 0, 10) };
  QueueShotRequest(0, RAY);
  GameUpdate(1 / 60, host, rng, events);
  check("a hit raises `g_shot_hit_something`", G.g_shot_hit_something[0] === 1);
  const hitTracer = G.g_shot_tracer_ring[1]!;
  check("the round is in the air on the frame it was fired", hitTracer.live);
  ShotEffectsTick();
  check("...and gone on the next, because it hit something",
        !hitTracer.live, `frame ${hitTracer.frame}`);

  // -- the ring wraps at six -----------------------------------------------
  G.g_shot_effect_cursor[0] = SHOT_EFFECT_RING - 1;
  pick = null;
  QueueShotRequest(0, RAY);
  GameUpdate(1 / 60, host, rng, events);
  check("the six-deep ring wraps rather than growing",
        G.g_shot_effect_cursor[0] === 0, `${G.g_shot_effect_cursor[0]}`);
  check("no weapon record without an Original Mode weapon",
        G.g_shot_weapon_ring.every((w) => !w.live)
        && G.g_original_weapon_kind[0] === OriginalWeaponKind.Standard);

  // -- the blood is at the bone, and it is a flipbook -----------------------
  G.g_blood_sprays = [];
  G.g_sprite_effects = [];
  G.g_hit_result = HitResultCode.Plain;
  ActorShotFeedback(z0, 4, vec3(1, 2, 3), host, rng, events);
  const spray = G.g_blood_sprays[0]!;
  check("a plain hit bleeds", G.g_blood_sprays.length === 1);
  check("...and the spray holds an actor and a bone, not a position",
        spray.at === z0.at && spray.bone === 4);
  check("...at the plain-damage severity", spray.severity === 0.5,
        `${spray.severity}`);
  check("...and it makes no sprite of its own",
        G.g_sprite_effects.length === 0);

  let cels = 0;
  while (G.g_blood_sprays.length) { ShotEffectsTick(); cels++; }
  check("the spray runs twenty-five models, one a frame",
        cels === BLOOD_LAST_CEL + 1, `${cels}`);
  check("...starting at the first of them", BLOOD_FIRST_SLOT === 0x3a);

  G.g_hit_result = HitResultCode.Damaged;
  ActorShotFeedback(z0, 4, vec3(), host, rng, events);
  check("a hit that swapped the part bleeds harder, not less",
        G.g_blood_sprays[0]!.severity === 0.75);
  G.g_blood_sprays = [];

  // -- the voice: the result while alive, the head bone once dead ------------
  //
  // `[proved]` from two routines that agree. `ZombieOnShot` (`FUN_00453EB0`)
  // holds two pointers across its per-player loop:
  //
  //   00453eee  LEA  EBP, [EDI*4 + 0x9a2d88]   ; &g_shot_bone[p]
  //   00453f0d  LEA  EBX, [EDI*4 + 0x9a58f8]   ; &g_hit_result[p]
  //   00453f3b  TEST EAX, 0x80000000           ; latched: neither arm
  //   00453f46  TEST dword ptr [ESI + 0x34], 0x4000000   ; Dead?
  //   00453f68  MOV  EAX, [EBP]                ; the BONE
  //   00453f6e  CMP  EAX, 0x2                  ; the head -> 2, else 1
  //   00454020  MOV  EAX, [EBX]                ; the RESULT
  //   00454025  CMP  EAX, 0x5                  ; alive and not 5 -> kind 0
  //
  // and `ThrowerOnShot` (`FUN_004499A0`) reads the same `[EBP]` at 0x00449A70.
  // These checks used to say the reverse -- result 2 was kind 2 off a shot to
  // the leg, and a head kill was kind 1 -- on a reading of `[EBP]` as the
  // result pointer. The three dead-arm checks below fail on that reading.
  const voiced: number[] = [];
  const ear = new Events();
  ear.on("sound.play", (d) => voiced.push(d.id));
  // Named explicitly rather than by a range: the ricochet this routine also
  // emits is `0x1116A9`, and a `>= 10` filter swallowed it and turned the
  // result-5 check green on a sound that is not a voice at all.
  const VOICE_IDS = [10, 11, 20, 21, 30, 31, 40, 50];
  const impactOf = (xs: number[]) => xs.filter((id) => id === 1 || id === 2);
  const lineOf = (xs: number[]) => xs.filter((id) => VOICE_IDS.includes(id));
  z0.charType = 0;                      // set A, per `voice_set_a_types`
  z0.flags &= ~(ActorFlag.Dead | ActorFlag.ShotImmune);
  z0.flags2 &= ~ZombieFlag2.DiedInFlight;
  check("the voice checks' actor is class 0x30, whose latch is bit 0x80000000",
        z0.cls === SpawnClass.Zombie, `class ${z0.cls}`);

  // Alive: kind 0, whatever the bone was. Bone 2 is the head.
  voiced.length = 0;
  G.g_hit_result = HitResultCode.Damaged;
  ActorShotFeedback(z0, 2, vec3(), host, rng, ear);
  check("a live actor shot in the head still says hurt",
        lineOf(voiced).length === 1 && lineOf(voiced)[0] === 10,
        JSON.stringify(voiced));
  check("...with a body impact, not a head one",
        impactOf(voiced).length === 1 && impactOf(voiced)[0] === 1,
        JSON.stringify(voiced));

  // Dead and shot in the head: kind 2 -- and it is the *bone*, not the result.
  voiced.length = 0;
  z0.flags |= ActorFlag.Dead;
  G.g_hit_result = HitResultCode.Damaged;
  ActorShotFeedback(z0, 2, vec3(), host, rng, ear);
  check("a dead actor shot in the head is kind 2, on a result of 1",
        lineOf(voiced).length === 1 && lineOf(voiced)[0] === 30,
        JSON.stringify(voiced));
  check("...and kind 2's tell is the head impact table",
        impactOf(voiced).length === 1 && impactOf(voiced)[0] === 2,
        JSON.stringify(voiced));

  // Dead and anywhere else: kind 1 -- result 2 included.
  voiced.length = 0;
  G.g_hit_result = HitResultCode.Plain;
  ActorShotFeedback(z0, 4, vec3(), host, rng, ear);
  check("result 2 on a dead actor shot in the leg is kind 1, not kind 2",
        lineOf(voiced).length === 1 && lineOf(voiced)[0] === 20
        && impactOf(voiced)[0] === 1, JSON.stringify(voiced));

  // The latch comes before the live/dead split (`00453f3b`): once
  // `ZombieOnShot` has dispatched the death, every later shot is silent.
  voiced.length = 0;
  z0.flags2 |= ZombieFlag2.DiedInFlight;
  G.g_hit_result = HitResultCode.Damaged;
  ActorShotFeedback(z0, 2, vec3(), host, rng, ear);
  check("a corpse whose death is latched says nothing, even to the head",
        lineOf(voiced).length === 0, JSON.stringify(voiced));
  check("...though it still bleeds",
        impactOf(voiced).length === 0 && G.g_blood_sprays.length > 0,
        JSON.stringify(voiced));
  z0.flags2 &= ~ZombieFlag2.DiedInFlight;
  G.g_blood_sprays = [];

  // The two gates that silence it: `obj+0x34` bit 0x100 jumps the whole
  // routine (0x00453ec7), and the live arm refuses result 5 (0x00454025).
  voiced.length = 0;
  z0.flags &= ~ActorFlag.Dead;
  G.g_hit_result = HitResultCode.NoEffect;
  ActorShotFeedback(z0, 2, vec3(), host, rng, ear);
  check("a result-5 hit on a live actor has no voice, only the ricochet",
        lineOf(voiced).length === 0, JSON.stringify(voiced));

  voiced.length = 0;
  z0.flags |= ActorFlag.Dead | ActorFlag.ShotImmune;
  G.g_hit_result = HitResultCode.Plain;
  ActorShotFeedback(z0, 2, vec3(), host, rng, ear);
  check("a shot-immune body is silent even on the dead arm",
        lineOf(voiced).length === 0, JSON.stringify(voiced));

  // The bursting head shouts, which it did not while the voice tables were in
  // `render/`: `00454133 PUSH 0x3` / `00454136 CALL 0x0040a6f0`, inside
  // `ActorShotFeedback` itself rather than in its caller.
  voiced.length = 0;
  z0.flags &= ~(ActorFlag.Dead | ActorFlag.ShotImmune);
  z0.boneSlot["2"] = 0x1dc2;
  G.g_hit_result = HitResultCode.Damaged;
  ActorShotFeedback(z0, 2, vec3(), host, rng, ear);
  check("the head that bursts cries out, out of set A's attack pair",
        voiced.includes(40), JSON.stringify(voiced));
  delete z0.boneSlot["2"];
  z0.flags &= ~(ActorFlag.Dead | ActorFlag.ShotImmune);
  G.g_blood_sprays = [];
  G.g_sprite_effects = [];

  // -- result 5 is a ricochet, and it is not blood --------------------------
  G.g_hit_result = HitResultCode.NoEffect;
  ActorShotFeedback(z0, 4, vec3(0, 0, -30), host, rng, events);
  check("a result-5 hit draws no blood at all",
        G.g_blood_sprays.length === 0);
  const ric = G.g_sprite_effects[0]!;
  check("...it ricochets instead", G.g_sprite_effects.length === 1
        && ric.kind === SpriteEffectKind.Other);
  check("...through the kind's own slot range, from the bundle",
        ric.slot === 0x0e25 && ric.lastSlot === 0x0e33,
        `${ric.slot.toString(16)}..${ric.lastSlot.toString(16)}`);

  let frames = 0;
  while (G.g_sprite_effects.length) { ShotEffectsTick(); frames++; }
  check("a sprite effect is one model a frame and no more",
        frames === 0x0e33 - 0x0e25 + 1, `${frames}`);

  // ...unless the bone is one tested as a collision mesh: both of the arm's
  // branches test the bone record's `+0x74` bit 0x10 (`obj + 0x280 +
  // bone*0x90`) and `break` before the sprite, and the ricochet sound after
  // the switch still plays. The port keeps that bit as `Actor.boneColi`.
  {
    const heard: number[] = [];
    const ricochetEar = new Events();
    ricochetEar.on("sound.play", (d) => heard.push(d.id));
    z0.boneColi["4"] = "fixture";
    G.g_hit_result = HitResultCode.NoEffect;
    ActorShotFeedback(z0, 4, vec3(0, 0, -30), host, rng, ricochetEar);
    check("a result-5 hit on a mesh-tested bone makes no sprite",
          G.g_sprite_effects.length === 0,
          `${G.g_sprite_effects.length} sprites`);
    check("...and still ricochets",
          heard.some((id) => id === 0x1116a9 || id === 0xf16a9),
          JSON.stringify(heard));
    delete z0.boneColi["4"];
    G.g_sprite_effects = [];
  }

  // -- the distance law replaces the base scale, it does not multiply -------
  SpawnSpriteEffect(vec3(0, 0, 5), 0, 0, SpriteEffectKind.Other, 0, 0, host);
  check("an impact five units away is scaled by its depth, not by 1.0",
        Math.abs(G.g_sprite_effects[0]!.scale.x - 5 * 0.0667) < 1e-6,
        `${G.g_sprite_effects[0]!.scale.x}`);
  G.g_sprite_effects = [];
  SpawnSpriteEffect(vec3(0, 0, 100), 0, 0, SpriteEffectKind.Other, 0, 0, host);
  check("...and one a hundred units away keeps the kind's own",
        G.g_sprite_effects[0]!.scale.x === 1.0,
        `${G.g_sprite_effects[0]!.scale.x}`);
  G.g_sprite_effects = [];

  // The pools are plain data, which is the whole reason they are in `G`.
  SpawnBloodSpray(z0.at, 2, 1);
  const copy = JSON.parse(JSON.stringify(G.g_blood_sprays));
  check("every effect pool survives a round trip through JSON",
        copy[0].at === z0.at && copy[0].bone === 2);
  G.g_blood_sprays = [];
}



// -- 40. the firing gate: a shutter that is shut is a trigger that is dead ---

/**
 * **`g_nFiringGate` (`0x009C8E00`), and what a blocked trigger does not do.**
 *
 * Reported as "shouldn't be able to shoot while the shutter is closed", and
 * the port had every piece of it but the one that mattered: the shutter
 * machine drove the gate, the walker exposed it, the save state carried it and
 * `canSkip` read it — and the shot path did not look at it at all.
 *
 * The engine's rule is `PlayerFireAndReloadUpdate`'s (`FUN_00414940`), whose
 * fire block sits under `else if (g_nFiringGate != 0)` at 0x004149BE. That is
 * one test above **everything**: the ammo decrement, the shot counter,
 * `BuildShotRay`, `PlayerShotEffectSpawn` and the gunshot. So a blocked
 * trigger is not "a shot that hits nothing" — it is not a shot. The muzzle
 * flash and the tracer are the visible half of that and they are what these
 * assertions watch, because a gate applied one line too late would still light
 * them.
 *
 * The polarity is the other half, and the reason it is asserted rather than
 * assumed: state 0 is *"close, and enable firing"*, which reads backwards. It
 * is not backwards — `HudDrawShutterState` (`FUN_00413970`) draws the closed
 * bars in state 0 and writes the word 1, so a letterboxed boss intro still
 * lets you shoot, and state 5 draws exactly the same bars and writes 0.
 *
 * The port has no ammo, so the counter the engine keeps *inside* the gate and
 * this file can watch is `g_player_shot_count`. When a magazine arrives it belongs
 * under the same test, above `PlayerShotEffectSpawn`.
 */
console.log("\nthe firing gate:");
{
  const rng = new Rng(40);
  const events = scene(1, rng);
  const z0 = G.g_object_list[0]!;
  z0.hp = 100;
  let pick: ShotPick | null = { kind: "actor", at: z0.at, bone: 1,
                                point: vec3() };
  // The camera stubs are `PlayerShotEffectSpawn`'s: the muzzle point and the
  // tracer's aim are camera-space, so without them nothing leaves the gun and
  // the assertion that a *blocked* trigger lights nothing would pass for the
  // wrong reason. Same two lines as the shot-effects section above.
  const host = {
    ...NULL_HOST,
    pickShot: () => pick,
    viewPoint: (x: number, y: number, z: number,
                out: { x: number; y: number; z: number }) => {
      out.x = x; out.y = y; out.z = -z;
    },
    viewSpaceOfPoint: (p: { x: number; y: number; z: number },
                       out: { x: number; y: number; z: number }) => {
      out.x = p.x; out.y = p.y; out.z = -p.z;
      return true;
    },
  };
  const RAY = { origin: vec3(0, 0, 0), dir: vec3(0, 0, 1) };
  const resolved: string[] = [];
  events.on("shot.resolved", (r) => resolved.push(r.kind));

  const shutter = new Shutter();

  // -- the gate is down out of `ResetSceneOnEnter` --------------------------
  ResetSceneOnEnter();
  check("a scene starts with the gate down, as `ResetSceneOnEnter` leaves it",
        G.g_nFiringGate === 0, `${G.g_nFiringGate}`);
  check("...and the shutter shut, 5 in both bytes (`0x0045EE5F`, "
        + "`0x0045EE64`)",
        G.g_bHudShutterState === ShutterState.CloseHoldFire
        && G.g_bHudShutterPrev === ShutterState.CloseHoldFire,
        `${G.g_bHudShutterState} ${G.g_bHudShutterPrev}`);

  // -- a trigger pull under a closed shutter --------------------------------
  const scoreBefore = G.g_player_score[0];
  QueueShotRequest(0, RAY);
  check("the click is still recorded as input", G.g_shot_requests.length === 1);
  GameUpdate(1 / 60, host, rng, events);
  check("...and the frame takes it off the queue rather than holding it",
        G.g_shot_requests.length === 0);
  check("a trigger pulled with the gate down resolves nothing",
        resolved.length === 0, resolved.join(","));
  check("...it is not counted as a shot fired", G.g_player_shot_count[0] === 0,
        `${G.g_player_shot_count[0]}`);
  check("...it scores nothing", G.g_player_score[0] === scoreBefore);
  check("...the actor it was aimed at is untouched", z0.hp === 100,
        `${z0.hp}`);
  // The distinguishing assertion. `PlayerShotEffectSpawn` (`FUN_00416F70`) is
  // called from *inside* the gated block, so a blocked trigger makes no muzzle
  // flash and no tracer -- which is what separates "the gate is on the trigger"
  // from "the gate is on the hit test".
  check("...and nothing left the gun: no muzzle flash, no tracer",
        !G.g_shot_flash_ring.some((f) => f.live)
        && !G.g_shot_tracer_ring.some((t) => t.live));

  // -- the frame the script opens it -----------------------------------------
  // `EvtOpSetHudShutterState1F` stores the byte and nothing else. The gate is
  // `HudDrawShutterState`'s, and that task runs **after** both player tasks
  // (`0x00460733`, after `PlayerTasksCreate`) -- so a pull on the frame the
  // script says 6 still meets a dead trigger, and the gate is up from the
  // next one. The port's opcode used to raise it itself, a frame early.
  shutter.set(6);        // `hud_shutter_state 6` -- open at once, gate on
  check("evt 0x1F stores the state and leaves the gate alone",
        G.g_bHudShutterState === ShutterState.OpenFiring
        && G.g_nFiringGate === 0,
        `state ${G.g_bHudShutterState} gate ${G.g_nFiringGate}`);
  QueueShotRequest(0, RAY);
  GameUpdate(1 / 60, host, rng, events);
  check("a pull on the frame of the 6 is dead: the players run before the "
        + "shutter task", resolved.length === 0 && G.g_player_shot_count[0] === 0,
        `${resolved.join(",")} fired ${G.g_player_shot_count[0]}`);
  check("...and that frame's shutter task raised the gate and left 2",
        G.g_nFiringGate === 1 && G.g_bHudShutterState === ShutterState.Open,
        `gate ${G.g_nFiringGate} state ${G.g_bHudShutterState}`);
  GameUpdate(1 / 60, host, rng, events);
  check("the blocked pull does not fire late", resolved.length === 0,
        resolved.join(","));

  // -- the same pull with the gate up ---------------------------------------
  QueueShotRequest(0, RAY);
  GameUpdate(1 / 60, host, rng, events);
  check("with the gate up the same shot lands", resolved.at(-1) === "actor",
        resolved.join(","));
  check("...and now it is a shot fired", G.g_player_shot_count[0] === 1,
        `${G.g_player_shot_count[0]}`);
  check("...and the muzzle is lit",
        G.g_shot_flash_ring.some((f) => f.live)
        && G.g_shot_tracer_ring.some((t) => t.live));
  check("...and the actor took the hit", z0.hp < 100, `${z0.hp}`);

  // -- the polarity, state by state, from `HudDrawShutterState` -------------
  // The five states that write the word, and only those five. 2, 4, 7 and 8
  // leave it alone, which is why they are not in `SHUTTER_GATE`. Each is the
  // opcode's store and then one frame of the task, which is where the write
  // is.
  const frame = (state: number) => { shutter.set(state); HudDrawShutterState(); };
  frame(5);
  check("state 5 drops the gate on its frame -- a closed shutter, firing off",
        G.g_nFiringGate === 0);
  frame(0);
  check("state 0 draws the same closed bars and RAISES it",
        G.g_nFiringGate === 1);
  frame(2);
  check("state 2 leaves it alone", G.g_nFiringGate === 1);
  frame(5);
  frame(1);
  check("state 1 raises it on the way open", G.g_nFiringGate === 1);
  // `suppress_accuracy_stats 1`: the pull still fires -- the round goes --
  // but `CMP word ptr [0x009a5c48], 0` at `0x00414A15` keeps it out of the
  // count, and `ProcessPlayerShots` has put the fired flag back to 0.
  G.g_accuracy_stats_suppressed = 1;
  const ammo = G.g_player_ammo[0];
  const counted = G.g_player_shot_count[0];
  QueueShotRequest(0, RAY);
  GameUpdate(1 / 60, host, rng, events);
  check("...and with the accuracy stats suppressed it fires, uncounted",
        G.g_player_ammo[0] === ammo - 1
        && G.g_player_shot_count[0] === counted && G.g_nPlayerFired[0] === 0,
        `ammo ${ammo} -> ${G.g_player_ammo[0]} count ${counted} -> `
        + `${G.g_player_shot_count[0]} flag ${G.g_nPlayerFired[0]}`);
  G.g_accuracy_stats_suppressed = 0;

  // -- state 3 drops it only when the close finishes ------------------------
  // Seeded to 0x28 on the frame the state changes, stepped before it is
  // drawn: frames 1..40 draw the counter 39..0, and the 41st -- the one that
  // finds it already at 0 -- draws them shut, drops the gate and leaves 4.
  for (let i = 0; i < 41; i++) HudDrawShutterState();   // the 1 opens fully
  frame(3);
  check("a state-3 close keeps the gate up while it is still sliding",
        G.g_nFiringGate === 1 && G.g_hud_shutter_counter === SHUTTER_FRAMES - 1,
        `gate ${G.g_nFiringGate} counter ${G.g_hud_shutter_counter}`);
  const before = G.g_player_shot_count[0];
  QueueShotRequest(0, RAY);
  GameUpdate(1 / 60, host, rng, events);
  check("...so a shot in the middle of a close still fires",
        G.g_player_shot_count[0] === before + 1,
        `${before} -> ${G.g_player_shot_count[0]}`);
  for (let i = 2; i < SHUTTER_FRAMES; i++) HudDrawShutterState();
  check("...the bars meet on the 40th frame with the gate still up",
        G.g_nFiringGate === 1 && shutter.state === ShutterState.Closing
        && G.g_hud_shutter_counter === 0,
        `gate ${G.g_nFiringGate}, state ${shutter.state}, `
        + `counter ${G.g_hud_shutter_counter}`);
  HudDrawShutterState();
  check("...and the 41st drops it and leaves 4",
        G.g_nFiringGate === 0 && shutter.state === ShutterState.Closed,
        `gate ${G.g_nFiringGate}, state ${shutter.state}`);
  const after = G.g_player_shot_count[0];
  QueueShotRequest(0, RAY);
  GameUpdate(1 / 60, host, rng, events);
  check("...and the next pull is dead", G.g_player_shot_count[0] === after,
        `${G.g_player_shot_count[0]}`);

  // -- one word, not two ----------------------------------------------------
  // The gate is in `G` and `Shutter.firingGate` -- which is what `Walker`
  // exposes under that name -- is a view onto it, so the script's idea of the
  // gate and the port's cannot disagree. Two owners of one word is how the
  // shutter's slide counter went wrong once already.
  shutter.firingGate = true;
  check("the script's accessor and `G.g_nFiringGate` are the same word",
        G.g_nFiringGate === 1 && shutter.firingGate);
  G.g_nFiringGate = 0;
  check("...in both directions", !shutter.firingGate);
}
