import type { CharactersJson } from "../../src/bundle";
import { Rng } from "../../src/core/rng";
import { ActorSpawn, GameUpdate } from "../../src/game/director";
import { ProcessPlayerShotsTestList } from "../../src/game/combat/shot_test";
import { G, ResetGameGlobals } from "../../src/game/globals";
import { NULL_HOST, type GameHost } from "../../src/game/host";
import { QueueShotRequest } from "../../src/game/combat/shot";
import { SetGameTables, T } from "../../src/game/tables";
import { ActorFlag } from "../../src/game/actor";
import { type ClassFrame } from "../../src/game/registry";
import { SpawnClass } from "../../src/game/spawn_class";
import { vec3, type Vec3 } from "../../src/game/vec";
import {
  RunPendingInits, SpawnSlotActor, SpawnSlotActors,
} from "../../src/game/director";
import type { ScriptedProp12Tail } from "../../src/game/class12/state";
import { ScriptedProp12DrawSlots } from "../../src/game/class12/state";
import { check, CHARS, spawnZombie, scene, EnterPlay } from "./harness";

// -- class 0x28: stage 1's two burning cars, thrown once ---------------------

console.log("\nclass 0x28 -- held on its route until cp 0x2F, thrown once, "
            + "killed:");
{
  // Stage 1 blocks 5, 11 and 14 `spawn_placed` two class-0x28 objects,
  // `obj+0x11C` 0 and 1, that `PathRidingPropUpdate` (`FUN_00432610`) seats
  // on `op_` slots 0x145 and 0x146 at the frames `g_class28_route_table`
  // (`0x00589AE0`) freezes them on, 671 and 667, and throws along the rest
  // of the path the frame camera path 0x2F reaches that frame; it kills them
  // once `g_cam_path_frame` reaches `g_cam_path_length[slot]`, 725 and 765.
  //
  // The port had no class 0x28: `render/rigs.ts` drew the path at
  // `min(len, camera frame)` of whatever camera was playing, so the car slid
  // along the extrapolated path before the throw and was thrown again by
  // every later camera move past frame 671 -- the user's "start in the wrong
  // place" and "repeat their arc". Driven here from the director's entry for
  // a walker spawn, `SpawnSlotActor`, and `GameUpdate`; the path stub
  // answers with the frame it was asked for in `x` and the slot in `y`, so
  // the pose says which evaluation made it.
  const rng = new Rng(28);
  ResetGameGlobals();
  EnterPlay();
  SetGameTables(CHARS);
  const asked: [number, number][] = [];
  const host: GameHost = {
    ...NULL_HOST,
    objectPath: (slot, frame) => {
      asked.push([slot, frame]);
      return { x: frame, y: slot, z: -frame, pitch: 0, yaw: frame * 16,
               roll: 0 };
    },
  };
  const spawn = (at: number, hp: number) => ({
    at, class: 0x28, hp, pos: [0, 0, 0] as [number, number, number],
    orient: [0, 0, 0] as [number, number, number], flags: 0,
  });
  const listed = [spawn(24472, 0), spawn(24512, 1)];
  const cars = () => G.g_object_list.filter(
    (o) => o.cls === (0x28 as SpawnClass) && !o.despawned);
  const car = (at: number) => cars().find((o) => o.at === at);
  const frame = (cam: number, f: number) => {
    G.g_active_cam_path = cam;
    G.g_cam_path_frame = f;
    for (const sp of listed) SpawnSlotActor(sp);
    GameUpdate(1 / 60, host, rng);
  };

  // The boss block's arrival camera, well before the throw.
  frame(0x2f, 121);
  check("a class-0x28 spawn record builds a class-0x28 actor, one per spawn",
        cars().length === 2 && car(24472)?.hp === 0 && car(24512)?.hp === 1,
        cars().map((o) => `${o.at}:${o.hp}`).join(","));
  check("its first frame seats it on its route at the table's freeze frame, "
        + "not the camera's",
        car(24472)?.pos.x === 671 && car(24472)?.pos.y === 0x145
        && car(24512)?.pos.x === 667 && car(24512)?.pos.y === 0x146,
        JSON.stringify(cars().map((o) => o.pos)));
  // Any camera, any frame: nothing moves it until cp 0x2F reaches the freeze.
  asked.length = 0;
  for (const [cam, f] of [[0x2f, 400], [0x2f, 590], [0x32, 700], [0x32, 720],
                          [0x31, 690], [0x2f, 666]] as const) {
    frame(cam, f);
  }
  check("...and holds it there on every camera until cp 0x2F reaches it -- "
        + "another camera's frame 700 throws nothing",
        car(24472)?.pos.x === 671 && car(24512)?.pos.x === 667
        && asked.length === 0,
        `${car(24472)?.pos.x} ${car(24512)?.pos.x} asked ${asked.length}`);
  frame(0x2f, 667);
  check("cp 0x2F frame 667 throws route 1 (freeze 667) and not route 0 (671)",
        car(24512)?.sub === 2 && car(24512)?.pos.x === 667
        && car(24472)?.sub === 1,
        `${car(24512)?.sub} ${car(24472)?.sub}`);
  frame(0x2f, 671);
  frame(0x2f, 700);
  check("once thrown, the pose is the path at g_cam_path_frame",
        car(24472)?.pos.x === 700 && car(24472)?.pos.z === -700
        && car(24472)?.yaw === 700 * 16 && car(24512)?.pos.x === 700,
        `${car(24472)?.pos.x} ${car(24512)?.pos.x}`);
  // Thrown, the pose follows whichever camera is playing -- no camera test.
  frame(0x32, 710);
  check("...whichever camera is playing (the kill and the ride have no "
        + "camera test)", car(24472)?.pos.x === 710,
        `${car(24472)?.pos.x}`);
  frame(0x2f, 725);
  check("route 0 is killed on g_cam_path_length[0x145], 725",
        car(24472) === undefined && car(24512) !== undefined,
        cars().map((o) => o.at).join(","));
  frame(0x2f, 765);
  check("...and route 1 on g_cam_path_length[0x146], 765",
        cars().length === 0, cars().map((o) => o.at).join(","));
  // The post-fight cutscene: cp 50 runs 0..680 and 681..950 while the
  // script still lists both spawns. Nothing is rebuilt and nothing is thrown.
  asked.length = 0;
  for (let f = 660; f <= 730; f += 5) frame(0x32, f);
  check("a later camera through frames 660..730 plays no throw: the pool "
        + "holds no class 0x28 and nothing evaluated a path",
        cars().length === 0 && asked.length === 0,
        `${cars().length} cars, ${asked.length} evaluations`);

  // `g_app_state` 10's arm: the literal pose, and its own handler.
  const mod = await import("../../src/game/class28").catch(() => null);
  check("class 0x28's module exists", mod !== null);
  if (mod) {
    ResetGameGlobals();
    const a = ActorSpawn(24512, 0x28 as SpawnClass, -1, "fixed",
                         { hp: 1 }, rng);
    G.g_app_state = 10;
    G.g_active_cam_path = 7;
    G.g_cam_path_frame = 0;
    mod.PathRidingPropUpdate(a as never, { dt: 1 / 60, rng,
                                           host });
    check("in g_app_state 10 the pose is g_class28_fixed_poses[1], as words",
          Math.abs(a.pos.x - -1021.8939819335938) < 1e-9
          && Math.abs(a.pos.y - 1.1816699504852295) < 1e-9
          && a.pitch === -2607 && a.yaw === 0x8000 && a.roll === -0x4000,
          `${a.pos.x},${a.pos.y},${a.pos.z} ${a.pitch},${a.yaw},${a.roll}`);
    G.g_active_cam_path = 8;
    mod.PathRidingPropFixedPoseUpdate(a as never);
    check("...and PathRidingPropFixedPoseUpdate kills it on cp 8",
          a.despawned === true);
    ResetGameGlobals();
  }
}

// -- class 0x12: the wood the bin captor bursts out of ------------------------
//
// Stage 1 block 6 step 1 places evt `0x3D88`, class 0x12, at camera frame 640
// -- the descriptor as `st1evtbl.bin` carries it, read field by field the way
// `ScriptedPropInit12` (`FUN_0043F9D0`) reads it: `door_1.bin[41]` (`0x11FD`),
// delay 1, the shot mesh `coli1.bin:5144`, behaviour 0, gone on camera path
// 47 frame 130, the strip `0x11FE..0x1233`, flag 34, a slot a frame, scale 1,
// flags word `0x10`. `ScriptedPropUpdate12` (`FUN_0043FA60`) holds `0x11FD`
// until flag 34 -- which `ZombieStateTargetScriptWithFlag` raises on the burst
// clip's cursor 63 -- then jumps to `0x11FE`, leaves the shot test (`0x8000`)
// and steps a slot a frame, despawning, undrawn, the frame the cursor is
// strictly past `0x1233`. The port had no class 0x12 at all: the spawn built
// nothing, and the captor walked out of an empty doorway.
console.log("\nclass 0x12, the door the bin captor bursts out of:");
{
  const rng = new Rng(12);
  const events = scene(0, rng);
  const DOOR = 0x3d88;
  const door12 = {
    slot: 0x11fd, delay: 1, coli: "coli1.bin:5144", behaviour: 0,
    cam_path: 47, cam_frame: 130, first: 0x11fe, last: 0x1233, flag: 34,
    step: 1, scale: 1,
  };
  // Stage 2's end (`0x15644`): the other shape, half a slot a frame, and its
  // first slot is the one it starts on.
  const JETTY = 0x15644;
  const jetty12 = {
    slot: 0x16e1, delay: 1, coli: null, behaviour: 0, cam_path: 106,
    cam_frame: 0, first: 0x16e1, last: 0x172f, flag: 95, step: 0.5, scale: 1,
  };
  // Not shipped: a negative delay, which `TEST AX, AX; JL` never starts.
  const NEVER = 0x7112;
  SetGameTables({
    ...CHARS,
    placements: [
      { at: DOOR, class: 0x12, char_type: -1, motion: null, hp: 0, yaw: 0,
        init_flags: 0x10, class12: door12 },
      { at: JETTY, class: 0x12, char_type: -1, motion: null, hp: 0, yaw: 0,
        init_flags: 0x8000, class12: jetty12 },
      { at: NEVER, class: 0x12, char_type: -1, motion: null, hp: 0, yaw: 0,
        init_flags: 0x10, class12: { ...door12, delay: -1 } },
    ],
  } as unknown as CharactersJson);
  G.g_active_cam_path = 42;
  G.g_cam_path_frame = 640;
  SpawnSlotActors([
    { at: DOOR, class: SpawnClass.FlagStripProp, pos: [0, 0, 0] },
    { at: NEVER, class: SpawnClass.FlagStripProp, pos: [0, 0, 0] },
  ]);
  // The `Init`s are the frame walk's (`SpawnFromDescriptor`); run them here.
  RunPendingInits(rng);
  const door = G.g_object_list.find((o) => o.at === DOOR);
  const t = () => (door as { prop12: ScriptedProp12Tail }).prop12;
  check("stage 1's class-0x12 spawn builds an object",
        door?.cls === SpawnClass.FlagStripProp,
        door ? `0x${door.cls.toString(16)}` : "nothing built");
  if (door) {
    check("ScriptedPropInit12 seeds the cursor on door_1.bin[41] and the rest "
          + "of its block off the tail",
          t().cursor === 0x11fd && t().first === 0x11fe && t().last === 0x1233
          && t().flag === 34 && t().delay === 1 && t().step === 1
          && t().camPath === 47 && t().camFrame === 130,
          JSON.stringify(t()));
    // `ActorInitFlags` (`FUN_00408970`) is `obj+0x34 = flags | 1`.
    check("...obj+0x14C is the shot mesh, obj+0x3C is -1, and the record's "
          + "flags word 0x10 stands (with ActorInitFlags' 1)",
          door.coliBlob === "coli1.bin:5144" && door.motion === -1
          && door.flags === (ActorFlag.ShotTestMesh | 1),
          `${door.coliBlob} ${door.motion} 0x${door.flags.toString(16)}`);
    const frame = () => GameUpdate(1 / 60, NULL_HOST, rng, events);
    for (let i = 0; i < 30; i++) frame();
    check("with flag 34 down the door holds 0x11FD and files itself for the "
          + "shot test every frame, as a mesh",
          !door.despawned && t().cursor === 0x11fd && t().delay === 1
          && G.g_shot_test_list.some((e) => e.at === DOOR && e.flags === 0x11),
          `${t().cursor.toString(16)} ${t().delay} `
          + JSON.stringify(G.g_shot_test_list.filter((e) => e.at === DOOR)));
    // `wait_frames`-free: the flag is the input, set the way `set_script_flag`
    // and the captor's cue both set it.
    G.g_script_flags[34] = 1;
    frame();
    check("the frame flag 34 is up the delay runs out: the cursor jumps to "
          + "0x11FE, obj+0x1F4 takes it, and 0x8000 takes the door out of the "
          + "shot test",
          t().cursor === 0x11fe && t().delay === 0 && t().slot1F4 === 0x11fe
          && (door.flags & ActorFlag.NoShotTest) !== 0
          && !G.g_shot_test_list.some((e) => e.at === DOOR),
          `${t().cursor.toString(16)} ${t().delay} 0x${door.flags.toString(16)}`);
    const shown = [t().cursor];
    while (!door.despawned && shown.length < 200) {
      frame();
      if (!door.despawned) shown.push(t().cursor);
    }
    check("...then a slot a frame through 0x1233, all 54 of door_1.bin[42..95]",
          shown.length === 0x1233 - 0x11fe + 1
          && shown.every((c, i) => c === 0x11fe + i),
          `${shown.length} frames, last 0x${shown.at(-1)?.toString(16)}`);
    check("...and the frame the cursor is past 0x1233 it despawns", 
          door.despawned === true && t().cursor === 0x1234,
          `${door.despawned} 0x${t().cursor.toString(16)}`);
    const never = G.g_object_list.find((o) => o.at === NEVER) as
      { prop12: ScriptedProp12Tail; despawned: boolean } | undefined;
    check("a negative delay never starts, flag or no flag",
          !!never && !never.despawned && never.prop12.cursor === 0x11fd
          && never.prop12.delay === -1,
          JSON.stringify(never?.prop12 ?? null));
  }
  // The camera cue, and it is an equality: path 47 frame 130 exactly.
  {
    ResetGameGlobals();
    const a = ActorSpawn(DOOR, SpawnClass.FlagStripProp, -1, "door",
                         { class12: door12, flags: 0x10 }, rng);
    const fr: ClassFrame = { dt: 1 / 60, rng, host: NULL_HOST };
    const mod = await import("../../src/game/class12");
    G.g_active_cam_path = 47;
    G.g_cam_path_frame = 129;
    mod.ScriptedPropUpdate12(a, fr);
    const heldAt129 = !a.despawned;
    G.g_cam_path_frame = 130;
    mod.ScriptedPropUpdate12(a, fr);
    check("camera path 47 frame 130 despawns it, 129 does not",
          heldAt129 && a.despawned, `${heldAt129} ${a.despawned}`);
  }
  // Stage 2's jetty strip: half a slot a frame, the draw truncating it, and
  // the equality arm -- a cursor that lands exactly on the last slot draws it.
  {
    ResetGameGlobals();
    const a = ActorSpawn(JETTY, SpawnClass.FlagStripProp, -1, "jetty",
                         { class12: jetty12, flags: 0x8000 }, rng);
    const tj = (a as { prop12: ScriptedProp12Tail }).prop12;
    const fr: ClassFrame = { dt: 1 / 60, rng, host: NULL_HOST };
    const mod = await import("../../src/game/class12");
    G.g_script_flags[95] = 1;
    mod.ScriptedPropUpdate12(a, fr);
    mod.ScriptedPropUpdate12(a, fr);
    mod.ScriptedPropUpdate12(a, fr);
    check("stage 2's strip steps half a slot a frame from 0x16E1",
          tj.cursor === 0x16e1 + 1.0 && Math.trunc(tj.cursor) === 0x16e2,
          String(tj.cursor - 0x16e1));
    tj.cursor = 0x172f - 0.5;
    mod.ScriptedPropUpdate12(a, fr);
    const onLast = !a.despawned && tj.cursor === 0x172f;
    mod.ScriptedPropUpdate12(a, fr);
    check("...a cursor exactly on the last slot is drawn, half past it is gone",
          onLast && a.despawned, `${onLast} ${a.despawned}`);
  }
  check("the exporter's slot list for the door is 0x11FD and 0x11FE..0x1233",
        JSON.stringify(ScriptedProp12DrawSlots(door12))
          === JSON.stringify([0x11fd, ...Array.from(
            { length: 0x1233 - 0x11fe + 1 }, (_, i) => 0x11fe + i)]),
        String(ScriptedProp12DrawSlots(door12).length));
  SetGameTables(CHARS);
  ResetGameGlobals();
}

// -- ShotTestMesh: the boards stop the shot -----------------------------------
//
// `ProcessPlayerShots` (`FUN_00404570`) sends a registered object whose live
// `obj+0x34` has bit `0x10` to `ShotTestMesh` (`FUN_00404A00`): the shot
// segment through the inverse of `obj+0x150` against `obj+0x14C`, and on a
// hit a candidate keyed on the hit point's depth, sorted with every sphere.
// Stage 1's boarded doorway (`0x3D88`, class 0x12) is the one object the port
// runs through it; the boards are `coli1.bin:5144`, one quad, surface 56,
// modelled in world space, and here they are the bundle's own numbers. The
// captor stands behind them (`0x3D24`, at about (-660, -15.5, -565)): here a
// zombie whose head sphere, radius 3, is 2 units off the shot. The port passed a mesh
// entry by, so the shot went through the boards into whoever stood behind.
console.log("\nShotTestMesh: the boards stop the shot:");
{
  const DOOR = 0x3d88;
  const MESH = "coli1.bin:5144";
  const BOARDS = {
    min: [-675.2266845703125, -15.876447677612305, -549.6888427734375],
    max: [-661.37451171875, 15.41226577758789, -544.15625], n: 1,
    plane: [-0.37091198563575745, 0, 0.9286680221557617, 260.02850341796875],
    verts: [-675.2266845703125, 15.41226577758789, -549.6888427734375,
            -675.2266845703125, -15.876447677612305, -549.6888427734375,
            -661.37451171875, -15.876447677612305, -544.15625,
            -661.37451171875, 15.41226577758789, -544.15625],
    axis: [2], surface: [56],
  };
  const door12 = {
    slot: 0x11fd, delay: 1, coli: MESH, behaviour: 0, cam_path: 47,
    cam_frame: 130, first: 0x11fe, last: 0x1233, flag: 34, step: 1, scale: 1,
  };
  const rng = new Rng(34);
  const events = scene(0, rng);
  SetGameTables({
    ...CHARS,
    placements: [{ at: DOOR, class: 0x12, char_type: -1, motion: null, hp: 0,
                   yaw: 0, init_flags: 0x10, class12: door12 }],
  } as unknown as CharactersJson);
  T.coli = { files: ["coli0.bin", "coli1.bin"],
             blobs: { [MESH]: BOARDS } } as never;
  SpawnSlotActors([{ at: DOOR, class: SpawnClass.FlagStripProp,
                     pos: [0, 0, 0] }]);
  // The `Init`s are the frame walk's (`SpawnFromDescriptor`); run them here.
  RunPendingInits(rng);
  const door = G.g_object_list.find((o) => o.at === DOOR)!;
  // The captor: head (bone 2) a sphere of 3 at `HEAD`, the broad phase round
  // the same point, nothing else with a sphere.
  const HEAD = vec3(-674, 0, -565);
  const z = spawnZombie(0x3d24, 1, "captor");
  z.visible = true;
  z.hp = 50;
  z.pos = vec3(HEAD.x, HEAD.y, HEAD.z);
  // The eye in front of the boards, looking down -z: `-z` is in front.
  const EYE = vec3(-672, 0, -500);
  const host: GameHost = {
    ...NULL_HOST,
    pickShot: () => null,
    boneWorld: (_at, _bone, out) => {
      out.x = HEAD.x; out.y = HEAD.y; out.z = HEAD.z;
      return true;
    },
    boneSphere: (at, bone, out) => {
      if (at !== z.at || bone !== 2) return null;
      out.x = HEAD.x; out.y = HEAD.y; out.z = HEAD.z;
      return 3;
    },
    viewSpaceOfPoint: (p, out) => {
      out.x = p.x - EYE.x; out.y = p.y - EYE.y; out.z = p.z - EYE.z;
      return true;
    },
  };
  // One frame: both file themselves, the door as a mesh.
  GameUpdate(1 / 60, host, rng, events);
  const THROUGH = { origin: EYE, dir: vec3(0, 0, -1) };
  const PAST = { origin: vec3(-676, 0, -500), dir: vec3(0, 0, -1) };
  // Where the line x = -672, y = 0 meets the boards' plane.
  const [pnx, , pnz, pd] = BOARDS.plane;
  const ON_BOARDS = -(pnx * EYE.x + pd) / pnz;
  const through = ProcessPlayerShotsTestList(THROUGH, host);
  check("both are in the list: the door as a mesh (its word 0x11), the "
        + "captor as a sphere",
        G.g_shot_test_list.some((e) => e.at === DOOR && e.flags === 0x11)
        && G.g_shot_test_list.some((e) => e.at === z.at),
        JSON.stringify(G.g_shot_test_list.map((e) => [e.at, e.flags])));
  check("a shot through the boarded doorway stops on the boards: the door, "
        + "whole, surface 56, on the plane -- not the captor behind",
        through?.at === DOOR && through.whole && through.bone === 0
        && through.mesh?.surface === 56
        && Math.abs(through.point.z - ON_BOARDS) < 1e-3
        && Math.abs(through.point.x - EYE.x) < 1e-3,
        JSON.stringify(through));
  check("...keyed on its depth, __ftol(-z * 10), nearer than the head",
        through?.key === Math.trunc(-(ON_BOARDS - EYE.z) * 10)
        && through.key < Math.trunc(-(HEAD.z - EYE.z) * 10),
        String(through?.key));
  check("...and the normal is the quad's, the door being unturned",
        !!through?.mesh
        && Math.abs(through.mesh.normal.x - pnx) < 1e-6
        && Math.abs(through.mesh.normal.z - pnz) < 1e-6,
        JSON.stringify(through?.mesh?.normal));
  const past = ProcessPlayerShotsTestList(PAST, host);
  check("a shot past the boards' edge still takes the captor's head",
        past?.at === z.at && past.bone === 2 && !past.mesh,
        JSON.stringify(past));

  // The whole pull, from the queue: `MarkActorShot` (`FUN_00404DB0`) marks
  // the door whole and throws the impact of surface 56 at the quad; the
  // captor is untouched.
  const resolved: { kind: string; at?: number }[] = [];
  events.on("shot.resolved", (r) => resolved.push(r));
  QueueShotRequest(0, THROUGH);
  GameUpdate(1 / 60, host, rng, events);
  const rec = G.g_shot_hit_records[0];
  check("the pull marks the door (shooter bit, bit 3, byte 1) and nothing "
        + "else, and the impact is surface 56 on the boards",
        resolved.length === 1 && resolved[0].kind === "marked"
        && resolved[0].at === DOOR
        && (door.flags & (ActorFlag.Hit | ActorFlag.HitByPlayer0))
          === (ActorFlag.Hit | ActorFlag.HitByPlayer0)
        && door.shotBones[0] === 1 && z.hp === 50
        && rec?.surface === 56 && Math.abs(rec.z - ON_BOARDS) < 1e-3,
        `${JSON.stringify(resolved)} 0x${door.flags.toString(16)} `
        + `${z.hp} ${JSON.stringify(rec)}`);

  // Flag 34: the strip starts, `0x8000` takes the door out, and the next
  // frame's list has only the captor.
  G.g_script_flags[34] = 1;
  GameUpdate(1 / 60, host, rng, events);
  const after = ProcessPlayerShotsTestList(THROUGH, host);
  check("once the boards burst the same shot goes through to the captor",
        (door.flags & ActorFlag.NoShotTest) !== 0
        && after?.at === z.at && after.bone === 2,
        JSON.stringify(after));

  // A quarter turn, where a matrix built in the wrong order or read in the
  // wrong layout cannot pass (L48): the same boards, yawed 0x4000 and moved
  // so their middle lands near the origin. `ScriptedPropUpdate12` stores
  // `T · Rx · Rz · Ry` as `obj+0x150`; `ShotTestMesh` turns the normal by
  // `Rz · Ry · Rx` of the same angles -- for a yaw alone, the same turn.
  ResetGameGlobals();
  SetGameTables(CHARS);
  T.coli = { files: ["coli0.bin", "coli1.bin"],
             blobs: { [MESH]: BOARDS } } as never;
  const T0 = vec3(546.9, 0, -668.3);
  const a = ActorSpawn(0x7d88, SpawnClass.FlagStripProp, -1, "turned",
                       { class12: door12, flags: 0x10 }, rng);
  a.pos = vec3(T0.x, T0.y, T0.z);
  a.yaw = 0x4000;
  const mod = await import("../../src/game/class12");
  mod.ScriptedPropUpdate12(a, { dt: 1 / 60, rng, host: NULL_HOST });
  // `MatrixRotateY` of a quarter turn takes local +x to -z and +z to +x.
  const turn = (v: Vec3) => vec3(v.z, v.y, -v.x);
  const nW = turn(vec3(pnx, 0, pnz));
  const dW = pd - (nW.x * T0.x + nW.y * T0.y + nW.z * T0.z);
  // An eye 60 out along +x, looking down -x.
  const EYE2 = vec3(60, 0, 0);
  const host2: GameHost = {
    ...NULL_HOST,
    viewSpaceOfPoint: (p, out) => {
      out.x = p.z - EYE2.z; out.y = p.y - EYE2.y; out.z = p.x - EYE2.x;
      return true;
    },
  };
  const turned = ProcessPlayerShotsTestList(
    { origin: EYE2, dir: vec3(-1, 0, 0) }, host2);
  const onPlane = turned
    ? nW.x * turned.point.x + nW.y * turned.point.y + nW.z * turned.point.z
      + dW : NaN;
  check("a door turned a quarter is hit on its turned plane, with the normal "
        + "turned with it",
        turned?.at === a.at && Math.abs(onPlane) < 1e-3
        && !!turned.mesh && Math.abs(turned.mesh.normal.x - nW.x) < 1e-4
        && Math.abs(turned.mesh.normal.z - nW.z) < 1e-4,
        `${JSON.stringify(turned)} plane ${onPlane}`);
  T.coli = null;
  SetGameTables(CHARS);
  ResetGameGlobals();
}
