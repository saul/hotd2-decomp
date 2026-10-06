import { Rng } from "../../src/core/rng";
import { ActorSpawn, GameUpdate, SpawnSlotActor } from "../../src/game/director";
import { G, ResetGameGlobals } from "../../src/game/globals";
import { NULL_HOST, type GameHost } from "../../src/game/host";
import { SetGameTables } from "../../src/game/tables";
import { SpawnClass } from "../../src/game/spawn_class";
import type { WorldSlotDraw } from "../../src/game/view_slot";
import { check, CHARS, EnterPlay } from "./harness";

// -- class 0x27: stage 2 block 0's two path riders ---------------------------

console.log("\nclass 0x27 -- rides op_st2 0x149/0x14A at the camera's frame, "
            + "swaps to 0x33 at frame 0xBE, holds and burns until flag 0:");
{
  // Stage 2 block 0 step 2 op 19 is one `spawn_placed` (evt 1060) naming
  // descriptors 1920 (`obj+0x11C` 0) and 1960 (1), both at the origin.
  // `PathRidingVehicleUpdate` (`FUN_004329D0`) poses each on the dword of
  // `g_class28_route_table` (`0x00589AE0`) at entry 2 + `obj+0x11C` -- op_st2
  // 0x149 and 0x14A -- at `g_cam_path_frame`, whatever the camera path;
  // from frame 0xBE it swaps slot 0x2B for 0x33 and installs
  // `PathRidingVehicleHeldUpdate` (`FUN_00432AF0`), which never poses again
  // and kills on `g_script_flags[0] == 1`. `PathRidingVehicleDraw`
  // (`FUN_00432B10`) steps `obj+0x1320` and draws two cels while
  // `obj+0x1324` is up and `obj+0x11C < 2`.
  //
  // Before this the class had no module: the spawn built nothing and nothing
  // drew either object. Driven from the director's entry for a walker spawn,
  // `SpawnSlotActor`, and `GameUpdate` from `ResetGameGlobals` (L49); the
  // path stub answers with the frame in `x`, the slot in `y` and a yaw that
  // is not the identity (L48), so a pose says which evaluation made it.
  const rng = new Rng(27);
  ResetGameGlobals();
  EnterPlay();
  SetGameTables(CHARS);
  const asked: [number, number][] = [];
  const host: GameHost = {
    ...NULL_HOST,
    objectPath: (slot, frame) => {
      asked.push([slot, frame]);
      return { x: frame, y: slot, z: -2 * frame, pitch: 0x400,
               yaw: 0x2000 + frame, roll: 0x100 };
    },
  };
  const spawn = (at: number, hp: number) => ({
    at, class: 0x27, hp, pos: [0, 0, 0] as [number, number, number],
    orient: [0, 0, 0] as [number, number, number], flags: 0,
    block: 0, step: 2, opIndex: 19,
  });
  const listed = [spawn(1920, 0), spawn(1960, 1)];
  const riders = () => G.g_object_list.filter(
    (o) => o.cls === SpawnClass.PathRidingVehicle && !o.despawned);
  const rider = (at: number) => riders().find((o) => o.at === at);
  // The draws are recorded with their world matrices, row 3 the
  // translation (`game/matrix.ts`).
  const draws = (): WorldSlotDraw[] => G.g_world_slot_draws;
  const slots = () => draws().map((d) => d.slot);
  const at = (d: WorldSlotDraw | undefined) =>
    d ? [d.m[12], d.m[13], d.m[14]] : [NaN, NaN, NaN];
  const frame = (cam: number, f: number) => {
    G.g_active_cam_path = cam;
    G.g_cam_path_frame = f;
    for (const sp of listed) SpawnSlotActor(sp);
    GameUpdate(1 / 60, host, rng);
  };

  frame(0x38, 10);
  check("each class-0x27 spawn record builds one class-0x27 actor",
        riders().length === 2 && rider(1920)?.hp === 0
        && rider(1960)?.hp === 1,
        riders().map((o) => `${o.at}:${o.hp}`).join(","));
  check("its first frame poses it on op_st2 0x149 / 0x14A at the camera's "
        + "frame (the table's entries 2 and 3)",
        rider(1920)?.pos.x === 10 && rider(1920)?.pos.y === 0x149
        && rider(1960)?.pos.y === 0x14a && rider(1920)?.yaw === 0x2000 + 10,
        JSON.stringify(riders().map((o) => o.pos)));
  check("...and draws slot 0x2B at that pose, and no cel",
        slots().join(",") === "43,43"
        && at(draws()[0]).join(",") === "10,329,-20",
        `${slots().join(",")} ${at(draws()[0])}`);

  // No camera-path test: another camera's frame moves it just the same.
  frame(0x50, 120);
  check("the ride has no camera-path test: cp 0x50 frame 120 poses it too",
        rider(1920)?.pos.x === 120 && slots().join(",") === "43,43",
        `${rider(1920)?.pos.x} ${slots().join(",")}`);
  frame(0x38, 0xbd);
  check("frame 0xBD is still the ride: 0x2B, no cel",
        rider(1920)?.pos.x === 0xbd && slots().join(",") === "43,43",
        slots().join(","));

  // The swap frame. Make the eye a real direction from the object.
  const eyeAt = (x: number, z: number) => {
    G.g_camera_index = 0;
    G.g_camera_block_eye.x = x;
    G.g_camera_block_eye.z = z;
  };
  eyeAt(190 + 30, -380 + 40);
  frame(0x38, 0xbe);
  const swapPose = { ...rider(1920)!.pos };
  check("frame 0xBE swaps: the pose is the path at 0xBE, the body 0x33",
        swapPose.x === 0xbe && slots().filter((s) => s === 0x33).length === 2
        && !slots().includes(0x2b),
        `${swapPose.x} ${slots().join(",")}`);
  // n = 1 on the swap frame: `0x1433 + 1`, `0xB67 + 1`.
  const mine = draws().slice(0, 3);
  check("...and the same frame draws the first two cels, 0x1434 and 0xB68",
        mine.map((d) => d.slot).join(",") === `${0x33},${0x1434},${0xb68}`,
        mine.map((d) => d.slot.toString(16)).join(","));
  const near = (u: number, v: number) => Math.abs(u - v) < 1e-3;
  const yaw = Math.trunc(Math.atan2(30, 40) * 32768 / Math.PI)
    * Math.PI / 32768;
  const fire = at(mine[1]);
  const smoke = at(mine[2]);
  check("the first cel stands 5.0 above the object, without its turns",
        near(fire[0], 190) && near(fire[1], 0x149 + 5) && near(fire[2], -380)
        && near(mine[1].m[5], 1),
        `${fire} up ${mine[1].m[5]}`);
  check("...the second 5.0 further along the yaw toward the camera block's "
        + "eye, at five times its size",
        near(smoke[0], 190 + 5 * Math.sin(yaw)) && near(smoke[1], 0x149 + 5)
        && near(smoke[2], -380 + 5 * Math.cos(yaw))
        && near(Math.hypot(mine[2].m[0], mine[2].m[1], mine[2].m[2]), 5),
        `${smoke}`);

  // Held: no pose, the cels step a frame at a time on every camera.
  asked.length = 0;
  const seen: string[] = [];
  for (let n = 2; n <= 41; n++) {
    frame(n % 2 ? 0x39 : 0x38, n * 3);
    const d = draws().slice(0, 3).map((x) => x.slot);
    if (n === 2 || n === 39 || n === 40 || n === 41) {
      seen.push(d.map((s) => s.toString(16)).join("/"));
    }
  }
  check("held, it never evaluates a path again and stays at the swap pose",
        asked.length === 0 && rider(1920)?.pos.x === swapPose.x,
        `${asked.length} evaluations, x ${rider(1920)?.pos.x}`);
  check("...and the cels step one a frame: 0x1435, 0x145A at 39, then the "
        + "loop 0x1AAB at 40 and 0x1AAC at 41; 0xB67 + n % 8 beside them",
        seen.join(" ") === "33/1435/b69 33/145a/b6e 33/1aab/b67 33/1aac/b68",
        seen.join(" "));

  // `g_script_flags[0]`: stage 2 raises it at block 3 step 3.
  G.g_script_flags[0] = 1;
  frame(0x39, 10);
  check("g_script_flags[0] == 1 kills both, and nothing is drawn",
        riders().length === 0 && draws().length === 0,
        `${riders().length} ${slots().join(",")}`);
  G.g_script_flags[0] = 0;
  ResetGameGlobals();
}

console.log("\nclass 0x27 -- a skip lands it on frame 190, after the draw:");
{
  const rng = new Rng(28);
  ResetGameGlobals();
  EnterPlay();
  SetGameTables(CHARS);
  const asked: number[] = [];
  const host: GameHost = {
    ...NULL_HOST,
    objectPath: (slot, frame) => {
      asked.push(frame);
      return { x: frame, y: slot, z: 0, pitch: 0, yaw: 0, roll: 0 };
    },
  };
  const sp = { at: 1920, class: 0x27, hp: 0, pos: [0, 0, 0] as [number, number, number],
               orient: [0, 0, 0] as [number, number, number], flags: 0,
               block: 0, step: 2, opIndex: 19 };
  const frame = (f: number) => {
    G.g_active_cam_path = 0x38;
    G.g_cam_path_frame = f;
    SpawnSlotActor(sp);
    GameUpdate(1 / 60, host, rng);
  };
  frame(40);
  G.g_cutscene_skipping = 1;
  frame(50);
  const a = G.g_object_list.find((o) => o.at === 1920)!;
  const drawn = G.g_world_slot_draws.map((d) => d.slot);
  check("the skipped frame draws the ride's 0x2B at the live frame 50, "
        + "then poses at 190.0",
        drawn.join(",") === "43" && G.g_world_slot_draws[0]?.m[12] === 50
        && a.pos.x === 190 && asked.join(",") === "40,50,190",
        `${drawn} ${G.g_world_slot_draws[0]?.m[12]} ${a.pos.x} ${asked}`);
  G.g_cutscene_skipping = 0;
  frame(60);
  check("...and from the next frame it is held there, 0x33 and its cels",
        a.pos.x === 190 && G.g_world_slot_draws.map((d) => d.slot).join(",")
          === `${0x33},${0x1434},${0xb68}`
        && asked.join(",") === "40,50,190",
        G.g_world_slot_draws.map((d) => d.slot.toString(16)).join(","));
  ResetGameGlobals();
}

console.log("\nclass 0x27 -- the cels are drawn only for obj+0x11C below 2:");
{
  // No shipped spawn carries 2 or more (their route would be the next
  // table's words, L6), so the gate is driven on a held object directly:
  // `CMP word ptr [ESI + 0x11c], 0x2; JGE` at `0x00432B6D`.
  const rng = new Rng(29);
  ResetGameGlobals();
  const mod = await import("../../src/game/class27");
  for (const hp of [1, 2, -1]) {
    G.g_world_slot_draws = [];
    const a = ActorSpawn(0x7000 + hp, SpawnClass.PathRidingVehicle, -1,
                         "rider", { hp }, rng);
    const t = (a as { vehicle27: { routine: number; burning: number;
                                   drawSlot: number } }).vehicle27;
    t.routine = mod.PathRidingVehicleRoutine.Held;
    t.burning = 1;
    t.drawSlot = 0x33;
    mod.PathRidingVehicleHeldUpdate(a as never);
    const got = G.g_world_slot_draws.map((d) => d.slot).length;
    check(`obj+0x11C ${hp}: ${hp < 2 ? "body and two cels" : "the body alone"}`,
          got === (hp < 2 ? 3 : 1), `${got} draws`);
  }
  ResetGameGlobals();
}
