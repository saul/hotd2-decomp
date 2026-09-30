/**
 * Class 0x26 subtypes 6 and 7 -- stage 6 block 12's pair, and what they draw.
 *
 * `Class26Subtype67Update` (`FUN_0048F930`), `Class26Subtype67Draw`
 * (`FUN_0048FB40`) and `Class26Subtype67DrawOrKill` (`FUN_0048FD00`),
 * `game/class26/subtype67.ts`. Every number here is the exe's: the path
 * frames, the literal heights, the offsets under the draw's matrix and the
 * slots, worked from the routines' pushes rather than read back off the port.
 */
import { Rng } from "../../src/core/rng";
import { ActorSpawn, GameUpdate } from "../../src/game/director";
import { G, ResetGameGlobals } from "../../src/game/globals";
import { NULL_HOST, type GameHost } from "../../src/game/host";
import { GameMode } from "../../src/game/game_mode";
import { SpawnClass } from "../../src/game/spawn_class";
import type { Actor } from "../../src/game/actor";
import {
  Class26Routine, type Class26DrawCall, type VehicleTail,
} from "../../src/game/class26/state";
import { check, EnterPlay } from "./harness";

console.log("class 0x26 subtypes 6 and 7 -- stage 6 block 12's pair:");

/** The tail of a class-0x26 actor. */
function tail(a: Actor): VehicleTail {
  return (a as unknown as { vehicle: VehicleTail }).vehicle;
}

/** The recorded draws as `slot@x,y,z`, translation rounded to 1e-3. */
function drawn(a: Actor): string[] {
  return tail(a).draws.map((d: Class26DrawCall) =>
    `0x${d.slot.toString(16)}@${[12, 13, 14]
      .map((i) => (Math.round(d.m[i] * 1000) / 1000).toString()).join(",")}`);
}

const near = (a: number, b: number) => Math.abs(a - b) < 1e-3;

/**
 * Object paths `0x183` and `0x184` as a host evaluates them: held at their
 * frame-1310 point, and a distinct point at every other frame so that which
 * frame the routine asked for shows in the pose. The angles are non-zero so
 * that a routine that dropped them is caught.
 */
const asked: { slot: number; frame: number }[] = [];
const host: GameHost = {
  ...NULL_HOST,
  objectPath: (slot, frame) => {
    asked.push({ slot, frame });
    if (slot !== 0x183 && slot !== 0x184) return null;
    const z = slot === 0x183 ? -9679.61 : -9872.737;
    return frame === 1310
      ? { x: 667.449, y: 2554.217, z, pitch: 0x100, yaw: 0x4000, roll: 0x200 }
      : { x: 667.449, y: 2554.217 + (frame - 1310), z: z + 1, pitch: 0x100,
          yaw: 0x4000, roll: 0x200 };
  },
};

{
  const rng = new Rng(26);
  ResetGameGlobals();
  EnterPlay();
  // Block 12 step 1 op 40: `cam_play` slot 221 (0xDD), frames 501..930.
  G.g_active_cam_path = 0xdd;
  G.g_cam_path_frame = 600;
  const six = ActorSpawn(0x46a8, SpawnClass.Vehicle, -1, "six",
                         { hp: 6, class26: { coli: null } }, rng);
  const seven = ActorSpawn(0x46cc, SpawnClass.Vehicle, -1, "seven",
                           { hp: 7, class26: { coli: null } }, rng);
  six.visible = true;
  seven.visible = true;
  check("before the first tick nothing is installed and nothing is drawn",
        tail(six).routine === Class26Routine.Install && !tail(six).draws.length);
  asked.length = 0;
  GameUpdate(1 / 60, host, rng);
  check("the installer runs the update and installs it (0x0048E321)",
        tail(six).routine === Class26Routine.Subtype67Update
        && tail(seven).routine === Class26Routine.Subtype67Update);
  check("subtype 6 asks for path 0x183 and 7 for 0x184, both at frame 1310",
        asked.some((q) => q.slot === 0x183 && q.frame === 1310)
        && asked.some((q) => q.slot === 0x184 && q.frame === 1310),
        JSON.stringify(asked));
  check("on path 0xDD the held pose is lifted half a unit, x and z as held",
        near(six.pos.y, 2554.717) && near(six.pos.x, 667.449)
        && near(six.pos.z, -9679.61),
        `${six.pos.x},${six.pos.y},${six.pos.z}`);
  check("...and all three angles land on +0x64/+0x68/+0x6C",
        six.pitch === 0x100 && six.yaw === 0x4000 && six.roll === 0x200);
  // Subtype 6: 0x1915 at the point, 0xD36 153 along x, and 0x9A8 at the sum
  // of all three translates -- (153 - 8.715, 8.3296, -0.8076) -- scaled.
  const d6 = drawn(six);
  check("subtype 6 draws 0x1915, 0xD36 and 0x9A8, translates accumulated",
        d6.length === 3 && d6[0] === "0x1915@667.449,2554.717,-9679.61"
        && d6[1] === "0xd36@820.449,2554.717,-9679.61"
        && d6[2] === "0x9a8@811.734,2563.047,-9680.418",
        d6.join(" "));
  const lit = tail(six).draws[2];
  check("...0x9A8 under MatrixScale(0.1, 0.427, 43.415), the rows scaled",
        near(lit.m[0], 0.1) && near(lit.m[5], 0.427) && near(lit.m[10], 43.415),
        `${lit.m[0]} ${lit.m[5]} ${lit.m[10]}`);
  check("...and under SetRenderLightColour(0.05, 0.01, 0), that draw alone",
        !!lit.light && near(lit.light[0], 0.05) && near(lit.light[1], 0.01)
        && lit.light[2] === 0 && !tail(six).draws[0].light
        && !tail(six).draws[1].light);
  check("...and G.g_render_light_colour is not left at that colour",
        G.g_render_light_colour.join() === "1,1,1",
        G.g_render_light_colour.join());
  // Subtype 7: 0x190C at its point, 0x7E9 at (752.8753, its y, -9872.09).
  check("subtype 7 draws 0x190C at its point and 0x7E9 at the fixed point",
        drawn(seven).join(" ")
          === "0x190c@667.449,2554.717,-9872.737 0x7e9@752.875,2554.717,-9872.09",
        drawn(seven).join(" "));

  // Path 0xDF below 0x51E is still 0xDD's arm.
  G.g_active_cam_path = 0xdf;
  G.g_cam_path_frame = 0x51d;
  GameUpdate(1 / 60, host, rng);
  check("path 0xDF below frame 0x51E holds, as 0xDD does",
        near(six.pos.y, 2554.717) && drawn(six).length === 3);

  // The ride: 0x51E..0x628 poses at min(frame, 1630) with no lift.
  G.g_cam_path_frame = 0x560;
  asked.length = 0;
  GameUpdate(1 / 60, host, rng);
  check("from 0x51E path 0xDF rides the object path at the camera's frame",
        asked.some((q) => q.slot === 0x183 && q.frame === 0x560)
        && near(six.pos.y, 2554.217 + (0x560 - 1310))
        && near(six.pos.z, -9678.61),
        `${JSON.stringify(asked)} ${six.pos.y}`);
  check("...drawing three models until 0x578, and no second copy before 0x56E",
        tail(six).drawsOneModel === 0 && drawn(six).length === 3);
  G.g_cam_path_frame = 0x56e;
  GameUpdate(1 / 60, host, rng);
  const z0 = 0.5 * 0 + six.pos.z + 50;
  check("at 0x56E the second 0x1914 appears at (x, 2781.1, z + 50)",
        drawn(six)[3] === `0x1914@667.449,2781.1,${Math.round(z0 * 1000) / 1000}`,
        drawn(six).join(" "));
  G.g_cam_path_frame = 0x578;
  GameUpdate(1 / 60, host, rng);
  const z1 = (0x578 - 0x56e) * 0.5 + six.pos.z + 50;
  check("at 0x578 obj+0x1320 goes up and subtype 6 is one 0x1914 at its point",
        tail(six).drawsOneModel === 1 && drawn(six).length === 2
        && drawn(six)[0].startsWith("0x1914@667.449,")
        && drawn(six)[1] === `0x1914@667.449,2781.1,${Math.round(z1 * 1000) / 1000}`,
        drawn(six).join(" "));
  check("...and subtype 7 ignores it",
        tail(seven).drawsOneModel === 1 && drawn(seven).length === 2
        && drawn(seven)[0].startsWith("0x190c@"));

  // 0x629: y goes to 2781.1, x and z stay, the draw is installed.
  const x = six.pos.x;
  const z = six.pos.z;
  G.g_cam_path_frame = 0x629;
  GameUpdate(1 / 60, host, rng);
  check("at 0x629 y is 2781.1, x and z are the last ridden frame's",
        six.pos.y === Math.fround(2781.1) && six.pos.x === x && six.pos.z === z,
        `${six.pos.x},${six.pos.y},${six.pos.z}`);
  check("...and the draw is what obj+0x00 holds now",
        tail(six).routine === Class26Routine.Subtype67Draw);
  G.g_active_cam_path = 0xe0;
  asked.length = 0;
  GameUpdate(1 / 60, host, rng);
  check("the installed draw asks for no path and moves nothing",
        asked.length === 0 && six.pos.y === Math.fround(2781.1)
        && drawn(six).length === 1);

  // Subtype 7's fixed point: flag 0x31, then the accuracy-stats word.
  G.g_script_flags[0x31] = 1;
  GameUpdate(1 / 60, host, rng);
  check("g_script_flags[0x31] up: subtype 7's fixed point is 0x7EB",
        drawn(seven)[1]?.startsWith("0x7eb@752.875,") === true,
        drawn(seven).join(" "));
  G.g_accuracy_stats_suppressed = 1;
  GameUpdate(1 / 60, host, rng);
  check("...and nothing at all there while g_accuracy_stats_suppressed is up",
        drawn(seven).length === 1, drawn(seven).join(" "));
}

{
  // Boss Mode, and the draw-or-kill.
  const rng = new Rng(27);
  ResetGameGlobals();
  EnterPlay();
  G.g_GameMode = GameMode.Boss;
  G.g_active_cam_path = 0xdd;
  G.g_cam_path_frame = 600;
  const six = ActorSpawn(0x46a8, SpawnClass.Vehicle, -1, "six",
                         { hp: 6, class26: { coli: null } }, rng);
  six.visible = true;
  GameUpdate(1 / 60, host, rng);
  check("Boss Mode: y is 2781.1 and the one model is drawn at the held x, z",
        six.pos.y === Math.fround(2781.1)
        && drawn(six).join(" ") === "0x1914@667.449,2781.1,-9679.61",
        drawn(six).join(" "));
  check("...and the installer's store wins on the first frame (0x0048E321)",
        tail(six).routine === Class26Routine.Subtype67Update);
  GameUpdate(1 / 60, host, rng);
  check("...so the second frame installs the draw-or-kill",
        tail(six).routine === Class26Routine.Subtype67DrawOrKill);
  G.g_active_cam_path = 0xec;
  GameUpdate(1 / 60, host, rng);
  check("camera path 0xEC kills it before it draws",
        six.despawned && !tail(six).draws.length);
  // `ResetGameGlobals` leaves the mode alone: it is the title menu's.
  G.g_GameMode = GameMode.Arcade;
}

{
  // Paths 0xE9..0xEB: 2790.1, and the draw-or-kill.
  const rng = new Rng(28);
  ResetGameGlobals();
  EnterPlay();
  G.g_active_cam_path = 0xea;
  G.g_cam_path_frame = 5;
  const seven = ActorSpawn(0x46cc, SpawnClass.Vehicle, -1, "seven",
                           { hp: 7, class26: { coli: null } }, rng);
  seven.visible = true;
  GameUpdate(1 / 60, host, rng);
  GameUpdate(1 / 60, host, rng);
  check("path 0xEA: y is 2790.1, one 0x190C, the draw-or-kill installed",
        seven.pos.y === Math.fround(2790.1)
        && drawn(seven).join(" ") === "0x190c@667.449,2790.1,-9872.737"
        && tail(seven).routine === Class26Routine.Subtype67DrawOrKill,
        `${drawn(seven).join(" ")} ${tail(seven).routine}`);
}
