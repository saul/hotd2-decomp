/**
 * The wall search, run through the **port's own** collision.
 *
 * `tools/verify_thrower_walls.py` asks the same question of the same data with
 * an independent Python implementation, straight off the `coli/` files. This
 * asks it through `game/coli.ts` and the exported bundle. If the two disagree,
 * one of them is wrong and the disagreement says which spawn to look at --
 * which is how the per-axis sign parity in `quadVsSegment` was found, back when
 * this said 1 wall and the Python said 24.
 *
 * They do not agree exactly, and the two places they differ are both the
 * Python being **deliberately looser**, as its own docstring says. Each was
 * chased to the individual spawn rather than waved through:
 *
 *  * **Ceilings, 11 here against 14 there.** Three spawns stand on a floor
 *    whose plane they are 0.05 units *below* -- `coli2.bin:23720` quad 11 at
 *    stage 2's (-1033.1, 129.2, -1914.2), and two like it. A trace from a
 *    thousand units up meets that floor from the **front**, and the engine's
 *    plane rule takes a quad only from behind, so it is not a ceiling. The
 *    Python test is two-sided and counts the floor underfoot as a roof.
 *  * **Walls, 22 here against 24 there.** `ColiSegmentVsMesh` judges nearest
 *    from the segment's **second** endpoint -- `ThrowerFindWallBeside` passes
 *    the actor there -- and the Python measures from the first. On two stage-4
 *    spawns that picks a different floor out of a stack, which moves the
 *    nine-to-twenty-nine probe band off a wall quad only 10.8 units tall.
 *
 * Flipping either rule in `coli.ts` reproduces the Python's number exactly, so
 * the gap is those two decisions and nothing else. Grounded is 38 of 38 on the
 * nose, which is the part that shares no convention.
 *
 *     node --experimental-strip-types tools/run_test.mjs tools/coli_walls.mjs
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { G, ResetGameGlobals } from "../src/game/globals.ts";
import { SetGameTables } from "../src/game/tables.ts";
import { ColiTraceSegmentAllSets, QueryGroundHeightAt } from "../src/game/coli.ts";

/** `ThrowerFindWallBeside`'s own constants — `FUN_0044BEF0`. */
const WALL_REACH = 60;
const WALL_RISE = 9;
const WALL_SPREAD = 20;
const STANDOFF = 4.5;
const CEILING_REACH = 1000;

/** `MatrixTranslate(p); MatrixRotateY(yaw); MatrixTransformPoint(x, y, z)`. */
function local(p, yaw, x, y, z) {
  const a = (yaw * Math.PI * 2) / 65536;
  const c = Math.cos(a), s = Math.sin(a);
  return { x: p.x + x * c + z * s, y: p.y + y, z: p.z - x * s + z * c };
}

const root = join(process.env.HOME, "hotd2-decomp/extract/player");
let total = 0, grounded = 0, walls = 0, ceilings = 0;

console.log("class 0x31 spawns, through the port's own collision:");
for (let stage = 1; stage <= 6; stage++) {
  let script;
  try {
    script = JSON.parse(readFileSync(
      join(root, `stage${stage}`, `stage${stage}.script.json`), "utf8"));
  } catch { continue; }
  const chars = script.characters;
  if (!chars || !script.coli) continue;

  ResetGameGlobals();
  SetGameTables(chars, undefined, undefined, undefined, script.coli);
  // Every blob the file holds, the way the Python reference does it: the
  // question is what the level has, not what one step has selected.
  G.g_coli_full_set = Object.keys(script.coli.blobs);
  G.g_camera_fixed_eye_y = -1e9;         // so a fallback cannot pass as a hit

  // The positions live on the script's own spawn instructions, not on the
  // character placements — those carry the descriptor tail and the yaw, and
  // the position reaches the player through the glTF node.
  const spawns = [];
  const seen = new Set();
  for (const b of script.blocks ?? []) {
    for (const st of b.steps ?? []) {
      for (const op of st.ops ?? []) {
        for (const sp of op.spawns ?? []) {
          if (sp.class !== 0x31 || seen.has(sp.at)) continue;
          seen.add(sp.at);
          spawns.push(sp);
        }
      }
    }
  }
  let nGround = 0, nWall = 0, nCeil = 0;
  for (const p of spawns) {
    total++;
    const pos = { x: p.pos[0], y: p.pos[1], z: p.pos[2] };
    const yaw = p.orient?.[1] ?? 0;
    const ground = QueryGroundHeightAt(pos.x, pos.y + STANDOFF, pos.z);
    if (ground <= -1e8) continue;
    nGround++; grounded++;

    let found = false;
    for (let lift = 0; lift < WALL_SPREAD && !found; lift++) {
      const y = ground + lift + WALL_RISE;
      for (const side of [-1, 1]) {
        const far = local(pos, yaw, side * WALL_REACH, 0, 0);
        if (ColiTraceSegmentAllSets(far.x, y, far.z, pos.x, y, pos.z)) {
          found = true;
          break;
        }
      }
    }
    if (found) { nWall++; walls++; }

    const up = local(pos, yaw, 0, CEILING_REACH, 0);
    if (ColiTraceSegmentAllSets(up.x, up.y, up.z, pos.x, pos.y, pos.z)) {
      nCeil++; ceilings++;
    }
  }
  if (spawns.length) {
    console.log(`  stage ${stage}: ${spawns.length} spawns, ${nGround} on solid `
      + `ground, ${nWall} with a wall in reach, ${nCeil} with something overhead`);
  }
}

console.log(`\n${total} class-0x31 spawns: ${grounded} stand on the collision `
  + `mesh, ${walls} can reach a wall, ${ceilings} have a ceiling`);

/** What `verify_thrower_walls.py` reports, and what this must report. */
const EXPECT = { total: 49, grounded: 38, walls: 22, ceilings: 11 };
const got = { total, grounded, walls, ceilings };
const bad = Object.keys(EXPECT).filter((k) => EXPECT[k] !== got[k]);
if (bad.length) {
  console.log("\nFAIL");
  for (const k of bad) console.log(`  ${k}: expected ${EXPECT[k]}, got ${got[k]}`);
  console.log("  the Python reference reports 49 / 38 / 24 / 14; the two gaps "
    + "are explained at the top of this file, and any other move is a bug");
  process.exit(1);
}
console.log("\nclean -- and `verify_thrower_walls.py` agrees, modulo the two "
  + "places it is looser on purpose");
