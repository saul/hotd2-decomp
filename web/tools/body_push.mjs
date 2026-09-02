/**
 * How far into the world does a thrower's body sit, before and after the push?
 *
 * The report was "their bbox goes quite far into the wall — it looks like only
 * their origin is measured against the coli", at stage 2 block 3. This asks
 * the port's own collision the same question for every class-0x31 spawn:
 * place the body sphere the way `ThrowerPlaceCollisionSphere` does, test it,
 * and report the penetration `ColiTestSphereAgainstFullSet` finds.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { G, ResetGameGlobals } from "../src/game/globals.ts";
import { SetGameTables } from "../src/game/tables.ts";
import { ColiTestSphereAgainstFullSet, QueryGroundHeightAt }
  from "../src/game/coli.ts";

const root = join(process.env.HOME, "hotd2-decomp/extract/player");
const only = Number(process.argv[3] ?? 0);
const SPHERE_LIFT = 1.4;

for (let stage = 1; stage <= 6; stage++) {
  if (only && stage !== only) continue;
  let script;
  try {
    script = JSON.parse(readFileSync(
      join(root, `stage${stage}`, `stage${stage}.script.json`), "utf8"));
  } catch { continue; }
  if (!script.characters || !script.coli) continue;

  ResetGameGlobals();
  SetGameTables(script.characters, undefined, undefined, undefined, script.coli);
  G.g_coli_full_set = Object.keys(script.coli.blobs);
  G.g_camera_fixed_eye_y = -1e9;

  const seen = new Set();
  const rows = [];
  for (const b of script.blocks ?? []) {
    for (const st of b.steps ?? []) {
      for (const op of st.ops ?? []) {
        for (const sp of op.spawns ?? []) {
          if (sp.class !== 0x31 || seen.has(sp.at)) continue;
          seen.add(sp.at);
          // The two radii `EnemyThrowerInit` writes into `obj+0x128`.
          const r = (sp.char_type ?? 0x19) === 0x16 ? 5 : 4;
          const pos = { x: sp.pos[0], y: sp.pos[1], z: sp.pos[2] };
          const ground = QueryGroundHeightAt(pos.x, pos.y + 4.5, pos.z);
          const y = ground > -1e8 ? ground : pos.y;
          // The sphere, as `FUN_00449E80` places it for a grounded actor.
          const cy = y + r * SPHERE_LIFT;
          const hit = ColiTestSphereAgainstFullSet(pos.x, cy, pos.z, r);
          const depth = hit ? G.g_coli_hit_depth : 0;
          const n = hit ? [...G.g_coli_hit_normal] : null;
          // One frame of `ThrowerPushOutOfWorld`: `pos += normal * depth`,
          // then the same test again. Clear means the push resolves it in one
          // frame, which is what the engine's does.
          let after = 0;
          if (hit) {
            const px = pos.x + n[0] * depth;
            const py = cy + n[1] * depth;
            const pz = pos.z + n[2] * depth;
            after = ColiTestSphereAgainstFullSet(px, py, pz, r)
              ? G.g_coli_hit_depth : 0;
          }
          rows.push({ at: sp.at, block: b.index, step: st.index,
                      hit, depth, n, after, pos, r });
        }
      }
    }
  }
  const bad = rows.filter((x) => x.hit);
  console.log(`stage ${stage}: ${rows.length} class-0x31 spawns, `
            + `${bad.length} with the body sphere in the world`);
  for (const x of bad) {
    const n = x.n.map((v) => v.toFixed(2)).join(",");
    // Past the radius means the centre was **behind** the surface -- the case
    // the port used to reject, which is a body well inside a wall.
    const through = x.depth > x.r ? "  <-- centre BEHIND the surface" : "";
    console.log(`  0x${x.at.toString(16)} block ${x.block} step ${x.step}`
      + ` r=${x.r} depth ${x.depth.toFixed(2)} along (${n})`
      + ` -> ${x.after < 1e-4 ? "clear" : x.after.toFixed(2) + " left"}${through}`);
  }
}
