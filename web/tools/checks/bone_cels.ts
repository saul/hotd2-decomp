/**
 * The cel runs a class-0x30 bone draws, against the exe and against the
 * bundle.
 *
 *     node tools/run_ts.mjs tools/checks/bone_cels.ts --game-dir ~/"THE HOUSE OF THE DEAD 2"
 *
 * `ZombieDrawBonePart` (`FUN_004534A0`) is class 0x30's per-bone draw
 * callback, installed at `obj+0x12EC` by `EnemyZombieInit` and called by
 * `SkeletonEmitNode` **instead of** `SkeletonDrawNodeSlot`. Nine arms of its
 * switch draw a *cel* out of a run of models chosen by a free-running counter,
 * and four of those draw the bone's own slot as well. `char_adv02`'s bone 1 is
 * the case that shows: the damaged torso is chest-only and the thirty-cel run
 * at `0x1B52` is what fills the band between it and the pelvis.
 *
 * **No table in the exe names any of it** -- the base and the count are
 * immediates in the routine's own code -- so the port carries the table as
 * `g_class30_bone_cels` in `src/game/class30/bonecels.ts`, and a hand-written
 * table is exactly the thing that rots. This imports that table, so what is
 * held to the game is what the renderer and the exporter run. Three
 * assertions, each one something only this check can see:
 *
 * 1. **Every row is in the binary.** Each `(base, count)` pair appears inside
 *    the routine as the fourteen bytes `MOV ECX,count; CDQ; IDIV ECX;
 *    ADD EDX,base` -- `b9 <count> 99 f7 f9 81 c2 <base>`. A base or a count
 *    edited in the TypeScript and not in the game fails here.
 * 2. **The models say what the reading says.** The two damaged torso stages
 *    the table gives a second draw to (`0x1B70`, `0x1B71`) stop above the
 *    pelvis, and the three it does not (`0x1B72`..`0x1B74`) reach below it;
 *    and every cel of the lower run bridges the band the chest-only stages
 *    leave. That split is the reason the table has the rows it has, and it is
 *    measured from `pol/` rather than asserted in prose.
 * 3. **The bundle carries the run.** A character whose bone or gore slots
 *    reach a trigger has every cel of that run in its hidden `gore_` rig, or
 *    the renderer looks the slot up, finds nothing and draws a hole. An
 *    exporter change that stops carrying them passes every other check in the
 *    tree: the counts are all still right.
 *
 * Exit 0 when it asserted things and they held, 1 when one did not, 3 when it
 * could not assert anything -- no game directory, or no exported bundle and
 * nothing else wrong.
 */
import { Checker, gameDirOrSkip, hex, openGame } from "../lib/exe_check";
import { BUNDLE_ROOT } from "../lib/bundle_root";
import { contains, range, readGlb, stageGlbs } from "./lib_d3d";
import { hitSteps } from "../../src/hod2lib/combat";
import * as C from "../../src/hod2lib/container";
import type { ExeTables } from "../../src/hod2lib/exetab";
import * as nl1 from "../../src/hod2lib/nl1";
import { g_class30_bone_cels } from "../../src/game/class30/bonecels";
import type { NodeAssetSource } from "../lib/node_io";
import { existsSync } from "node:fs";
import { basename, dirname } from "node:path";

/**
 * `ZombieDrawBonePart`'s extent, from the Ghidra database: the entry point and
 * the first byte past the jump tables its switch ends with.
 */
const ROUTINE_LO = 0x004534a0;
const ROUTINE_HI = 0x00453940;

/**
 * The band `char_adv02`'s damaged torso leaves empty, from the pelvis' top to
 * the chest-only model's bottom. Both measured, not authored.
 */
const PELVIS_TOP = -0.45;
const CHEST_ONLY_BOTTOM = 1.3;

/** The character whose torso the split is measured on, and its torso bone. */
const CHAR_ADV02 = 0;
const TORSO_BONE = 1;

/**
 * One bone's six-step row of `HIT_EFFECT` (`u16[bone][6]` per character):
 * the slot column of what `ResolveHit` walks.
 */
function effectRow(exe: ExeTables, charType: number, bone: number): number[] {
  return hitSteps(exe, charType, bone).map(([slot]) => slot);
}

/** `[ymin, ymax]` of every vertex of a slot's whole mesh chain, or null. */
async function slotExtent(source: NodeAssetSource, slots: Map<number, [string, number]>,
                          polCache: Map<string, nl1.Model[]>,
                          slot: number): Promise<[number, number] | null> {
  const rec = slots.get(slot);
  if (!rec) return null;
  let models = polCache.get(rec[0]);
  if (!models) {
    models = nl1.parseContainer(C.load(await source.read(`pol/${rec[0]}`)));
    polCache.set(rec[0], models);
  }
  if (rec[1] >= models.length) return null;
  let lo = Infinity, hi = -Infinity;
  for (const me of models[rec[1]].meshes) {
    for (const v of me.vertices) {
      lo = Math.min(lo, v.pos[1]);
      hi = Math.max(hi, v.pos[1]);
    }
  }
  return lo <= hi ? [lo, hi] : null;
}

/** The `(base, count)` pair's code: `MOV ECX,count; CDQ; IDIV ECX; ADD EDX,base`. */
function runBytes(base: number, count: number): Uint8Array {
  const b = new Uint8Array(14);
  const dv = new DataView(b.buffer);
  b[0] = 0xb9;
  dv.setUint32(1, count, true);
  b.set([0x99, 0xf7, 0xf9, 0x81, 0xc2], 5);
  dv.setUint32(10, base, true);
  return b;
}

async function main(): Promise<void> {
  const chk = new Checker("bone_cels");
  const table = new Map(Object.entries(g_class30_bone_cels)
    .map(([k, v]) => [Number(k), v] as const));
  if (!table.size) {
    chk.fail("g_class30_bone_cels has no rows");
    chk.finish();
  }
  chk.note(`${table.size} arms in g_class30_bone_cels`);

  const dir = gameDirOrSkip("bone_cels");
  const { source, exe } = await openGame(dir);
  const slots = exe.assetSlots();
  const code = range(exe, ROUTINE_LO, ROUTINE_HI);
  const polCache = new Map<string, nl1.Model[]>();

  // 1. every (base, count) is the routine's own arithmetic.
  for (const trigger of [...table.keys()].sort((a, b) => a - b)) {
    for (const { base, count } of table.get(trigger)!.runs) {
      chk.ok(contains(code, runBytes(base, count)),
             `${hex(trigger, 4)}: 'MOV ECX,${count}; CDQ; IDIV ECX; ADD EDX,${hex(base)}'`
             + " is inside ZombieDrawBonePart");
    }
  }

  // 2. the split the table turns on, measured from pol/.
  //    char_adv02's bone 1: five damage stages, the first two chest-only.
  const torsoStages = effectRow(exe, CHAR_ADV02, TORSO_BONE).filter((v) => v > 2);
  for (const [i, slot] of torsoStages.entries()) {
    const ext = await slotExtent(source, slots, polCache, slot);
    if (!ext) {
      chk.fail(`${hex(slot, 4)}: unresolved`);
      continue;
    }
    const hasCel = table.has(slot);
    const reachesPelvis = ext[0] <= PELVIS_TOP;
    const y = `y ${ext[0].toFixed(2)}..${ext[1].toFixed(2)}`;
    if (hasCel) {
      chk.ok(!reachesPelvis,
             `torso stage ${i} ${hex(slot, 4)} (${y}) takes a cel run and stops above`
             + ` the pelvis (${PELVIS_TOP})${reachesPelvis ? " -- the abdomen would be drawn twice" : ""}`);
    } else {
      chk.ok(reachesPelvis,
             `torso stage ${i} ${hex(slot, 4)} (${y}) draws alone and reaches the pelvis`
             + ` (${PELVIS_TOP})${reachesPelvis ? "" : " -- a hole"}`);
    }
  }

  // ...and the run itself covers the band the chest-only stages leave.
  const lowerRuns = table.get(0x1b3d)!.runs;
  const lower = lowerRuns[lowerRuns.length - 1];
  let bridged = 0;
  for (let i = 0; i < lower.count; i++) {
    const cel = lower.base + i;
    const ext = await slotExtent(source, slots, polCache, cel);
    if (!ext) {
      chk.fail(`${hex(cel, 4)}: unresolved`);
      continue;
    }
    const ok = ext[0] <= PELVIS_TOP && ext[1] >= CHEST_ONLY_BOTTOM;
    if (ok) bridged++;
    chk.ok(ok, `cel ${hex(cel, 4)} spans y ${ext[0].toFixed(2)}..${ext[1].toFixed(2)},`
           + ` ${ok ? "bridging" : "and does not bridge"} ${PELVIS_TOP}..${CHEST_ONLY_BOTTOM}`);
  }
  chk.note(`${bridged} of the ${lower.count} cels at ${hex(lower.base, 4)} bridge the band`);

  // 3. every bundle that carries a trigger character carries the whole run.
  const glbs = existsSync(BUNDLE_ROOT) ? stageGlbs(BUNDLE_ROOT) : [];
  if (!glbs.length) {
    if (chk.failed) chk.finish();                    // fail beats skip
    console.log(`\nSKIP  bone_cels: no stage .glb under ${BUNDLE_ROOT}`);
    process.exit(3);
  }
  for (const glb of glbs) {
    const { doc } = readGlb(glb);
    const names = (doc.nodes ?? []).map((n) => n.name ?? "").filter((n) => n);
    const stage = basename(dirname(glb));
    let runs = 0;
    for (let ct = 0; ct < 0x80; ct++) {
      const skel = exe.characterSkeleton(ct);
      if (!skel.length) continue;
      let stem = slots.get(skel[0].slot)?.[0];
      if (!stem) continue;
      if (stem.endsWith(".bin")) stem = stem.slice(0, -4);
      const prefix = `gore_${stem}_`;
      if (!names.some((n) => n.startsWith(prefix))) continue;
      const used = new Set(skel.map((n) => n.slot));
      // **Bounded by the character's own bone count** -- `HIT_EFFECT` is a
      // per-character `u16[bone][6]`, one pointer per character at `nb` rows,
      // and every skeleton numbers its bones below its own count. Reading past
      // the last bone walks into the *next* character's table and attributes
      // its gore to this one (L6): rows `nb` and `nb + 1` of `znjikken1`
      // (type 9) are `znjoe`'s rows 0 and 1, and row 1 is `0x1C97`.
      const nb = exe.characterBoneCount(ct) || 0;
      for (let b = 1; b < nb; b++) {
        for (const v of effectRow(exe, ct, b)) if (v > 2) used.add(v);
      }
      for (const [trigger, arm] of table) {
        if (!used.has(trigger)) continue;
        for (const { base, count } of arm.runs) {
          const missing: number[] = [];
          for (let i = 0; i < count; i++) {
            const tail = `gore_${(base + i).toString(16).padStart(4, "0")}`;
            if (!names.some((n) => n.endsWith(tail))) missing.push(base + i);
          }
          runs++;
          chk.ok(!missing.length,
                 `${stage}: ${stem} draws ${hex(trigger, 4)} and the bundle carries`
                 + (missing.length ? ` only ${count - missing.length} of` : " all")
                 + ` the ${count} cels at ${hex(base, 4)}`);
        }
      }
    }
    chk.note(`${stage}: ${runs} runs checked`);
  }

  chk.finish();
}

await main();
