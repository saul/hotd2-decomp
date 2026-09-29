/**
 * Class 0x31's wall and ceiling leaps have something to leap onto.
 *
 *     node tools/run_ts.mjs tools/checks/thrower_walls.ts --game-dir ~/"THE HOUSE OF THE DEAD 2"
 *
 * `ThrowerFindWallBeside` (`FUN_0044BEF0`) gates states 14 and 15 and
 * `ThrowerFindCeilingAbove` (`FUN_0044C0B0`) gates 16, and both are
 * questions about the level: sixty units to the actor's own left or right at
 * the ground under it plus nine to twenty-nine, or a thousand straight up,
 * traced by `ColiTraceSegmentAllSets`. States 14, 15 and 16 are nine of the
 * ten slots in `zstin`'s band-1 pick table, so if no spawn in the game could
 * find a wall the climb would be unreachable data and the reading of
 * `g_class31_action_picks` wrong.
 *
 * This asks the **port's own** probes -- `game/class31/surface.ts`, over
 * `game/coli.ts` -- at every class-0x31 spawn in the six stages, against
 * every blob of the stage's two `coli/` files as `hod2lib/script.ts`'s
 * `coliJson` exports them. The facing gate is opened (the camera is put on
 * the spawn's own yaw) and the random rise is swept over all twenty values:
 * the question is whether the level has a wall there at all. A spawn whose
 * ground trace hits nothing is counted apart, as having no ground to rise
 * from.
 *
 * What this asserts, and the statement it guards -- `docs/formats/combat.md`,
 * "Finding a wall", and `docs/formats/coli.md`'s query table ("the climb is
 * level design, not unreachable data"):
 *
 *  * **Spawns in the game can reach a wall, and some have a ceiling**, and
 *    stage 2 has both.
 *  * **How many**, per stage, as the port's probes answer over the evts with
 *    every spawn opcode `evt.SPAWN_OPCODES` reads: 51 spawns, 39 on the
 *    collision mesh, 23 with a wall in reach and 11 with a ceiling. Measured
 *    here, so a change in `game/coli.ts`'s trace, in the probes, or in the
 *    spawn reader moves it.
 */
import { gameDirOrSkip, openGame, Checker } from "../lib/exe_check";
import * as evt from "../../src/hod2lib/evt";
import { Stage } from "../../src/hod2lib/stage";
import { Program } from "../../src/hod2lib/script";
import type { ColiJson } from "../../src/bundle";
import type { Actor } from "../../src/game/actor";
import type { Rng } from "../../src/core/rng";
import { G } from "../../src/game/globals";
import { T } from "../../src/game/tables";
import { ColiTraceSegmentAllSets } from "../../src/game/coli";
import { ThrowerFindCeilingAbove, ThrowerFindWallBeside } from "../../src/game/class31/surface";
import { WALL_PROBE_SPREAD, WALL_STANDOFF } from "../../src/game/class31/states";
import { vec3 } from "../../src/game/vec";

/** `QueryGroundHeightAt` (`FUN_00409D40`) traces from this far below. */
const GROUND_PROBE = 1000;

/**
 * Per stage: `[spawns, on the collision mesh, a wall in reach, a ceiling]`,
 * measured with the port's probes.
 */
const EXPECT: Record<number, [number, number, number, number]> = {
  1: [2, 2, 2, 0],
  2: [22, 14, 10, 2],
  3: [0, 0, 0, 0],
  4: [15, 14, 2, 0],
  5: [4, 4, 4, 4],
  6: [8, 5, 5, 5],
};

async function main(): Promise<void> {
  const dir = gameDirOrSkip("thrower_walls");
  const { source } = await openGame(dir);
  const c = new Checker("thrower_walls");

  const total = [0, 0, 0, 0];
  for (let n = 1; n <= 6; n++) {
    const prog = await Program.create(await Stage.create(source, { stage: n }));
    const coli = prog.coliJson() as unknown as ColiJson;
    const ev = prog.evt;
    if (!c.ok(ev !== null && !!coli.blobs, `stage ${n}: an evt and a collision set`) || !ev) continue;
    // Every blob of both files in the full set, nothing dynamic in the pool.
    T.coli = coli;
    G.g_coli_full_set = Object.keys(coli.blobs);
    G.g_coli_ray_set = [];
    G.g_object_list = [];
    const got = [0, 0, 0, 0];
    for (const sp of evt.spawns(ev)) {
      if (sp.cls !== 0x31) continue;
      got[0]++;
      const [x, y, z] = sp.pos;
      if (!ColiTraceSegmentAllSets(x, y + WALL_STANDOFF - GROUND_PROBE, z,
                                   x, y + WALL_STANDOFF, z)) continue;
      got[1]++;
      const pos = vec3();
      pos.x = x; pos.y = y; pos.z = z;
      const obj = { pos, yaw: sp.orient[1] & 0xffff, flags2: 0,
                    strikeStart: vec3() } as unknown as Actor;
      G.g_camera_yaw_bams = obj.yaw;
      let wall = false;
      for (let lift = 0; lift < WALL_PROBE_SPREAD && !wall; lift++) {
        const rise = { int: () => lift } as unknown as Rng;
        wall = ThrowerFindWallBeside(obj, -1, rise) || ThrowerFindWallBeside(obj, 1, rise);
      }
      if (wall) got[2]++;
      if (ThrowerFindCeilingAbove(obj)) got[3]++;
    }
    got.forEach((v, i) => { total[i]! += v; });
    const want = EXPECT[n]!;
    c.ok(got.every((v, i) => v === want[i]),
         `stage ${n}: ${got[0]} spawns, ${got[1]} on the mesh, ${got[2]} with a wall, `
         + `${got[3]} with a ceiling; expected ${want.join("/")}`);
    if (n === 2) {
      c.ok(got[2] > 0 && got[3] > 0, "stage 2 has class-0x31 spawns with a wall and with a ceiling");
    }
  }
  c.ok(total[2]! > 0, `${total[2]} of the game's ${total[0]} class-0x31 spawns can reach a wall`);
  c.ok(total[3]! > 0, `${total[3]} of them have a ceiling`);
  c.note(`${total[0]} class-0x31 spawns: ${total[1]} stand on the collision mesh, `
         + `${total[2]} can reach a wall, ${total[3]} have a ceiling`);

  c.finish();
}

await main();
