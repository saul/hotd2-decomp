/**
 * The objects a stage places and the routes they follow, against the exe's
 * tables and the stage's own geometry.
 *
 *     node tools/run_ts.mjs tools/checks/objects.ts --game-dir ~/"THE HOUSE OF THE DEAD 2"
 *
 * Two datasets meet here. **Spawns** are the descriptors an event script
 * reaches, each with a class id, a world position and orientation words;
 * **routes** are `op_` paths, which `CamEvalObjectPath6` (`0x004042D0`)
 * evaluates by a global path slot in the same 418-slot space the cameras use.
 * Each assertion is chosen to collapse if the reading is wrong:
 *
 * 1. **Every class a stage 1-6 spawn names is defined** by the
 *    `{class_id, handler}` pair list at `0x00593358` that `FUN_0040AC90`
 *    builds the handler table from -- an undefined id would dispatch to the
 *    empty stub, so this is a real check rather than a tautology
 *    (`formats/evt.md`, Spawn descriptor). The spawns are the ones
 *    `hod2lib/script.ts` decodes, which is what the bundle carries.
 * 2. **Every spawn lies inside the bounding box of its own stage's geometry**
 *    -- the `Stage.geometry` set the exporter draws (`formats/evt.md`). The
 *    box includes each stage's backdrop, 7,200 units square on stage 1 and
 *    30,000 on stage 6, so it is loose in x and z; what it catches is y, where
 *    the stage is a few hundred units deep and a position read four bytes off
 *    puts most spawns below the floor.
 * 3. **The route slots the draw routines pass as literals are object paths.**
 *    At each of the six call sites `formats/cam.md` tabulates, the bytes are
 *    `PUSH imm32 <slot>; CALL CamEvalObjectPath6`, and the slot resolves
 *    through the exe's cam tables to the `op_` file and local index the table
 *    names -- never to a `cp_` file.
 * 4. **A rig's gates are camera paths, its routes object paths, and a gate
 *    sits in the same stage file as the route it selects**, for every rig in
 *    `hod2lib/rigs_data.ts` (`formats/cam.md`, Which route an object takes).
 *    That is what makes "a stage owns a rig iff it owns the camera path that
 *    selects it" true, and `rigs.resolveForStage` rests on it.
 * 5. **No route a rig sweeps is evaluated before its own keys begin.** The
 *    routines start at camera frame 0 and clamp only at the top, and
 *    `CamEvalHermiteCurve` extrapolates rather than clamping, so a swept route
 *    whose channels start late is run backwards along its opening segment:
 *    swept from frame 0, `op_st1` slot `0xFF`'s `rot_y` reaches 762,158 BAMS
 *    and turns the stage-1 car eleven and a half times, which is why that
 *    slot is not a route the car rides (`re/rig-survey.md`, A route is not
 *    always ridden). A route parked at a literal frame (`rigs.holdFrameOf`)
 *    is never swept and is exempt.
 *
 * Exit 0 when everything held, 1 when anything did not, 3 with no game
 * directory.
 */
import { Checker, gameDirOrSkip, hex, openGame } from "../lib/exe_check";
import { i32 } from "../../src/hod2lib/bytes";
import * as camlib from "../../src/hod2lib/cam";
import * as rigs from "../../src/hod2lib/rigs";
import * as script from "../../src/hod2lib/script";
import { Stage } from "../../src/hod2lib/stage";

/** `FUN_0040AC90`'s `{i32 class_id, u32 handler}` list, ended by a negative id. */
const CLASS_TABLE = 0x00593358;

const CAM_EVAL_OBJECT_PATH6 = 0x004042d0;

/**
 * `formats/cam.md`'s call sites that pass a literal slot: the `CALL`, the
 * slot, and the `op_` file and local path index it names.
 */
const LITERAL_SLOTS: [number, number, string, number][] = [
  [0x0048e64d, 0xfe, "op_st1.bin", 1],
  [0x00415c48, 0xfe, "op_st1.bin", 1],
  [0x0048f5af, 0x182, "op_st6.bin", 0],
  [0x0048f091, 0x173, "op_st4.bin", 0],
  [0x00426ba3, 0x185, "op_st6.bin", 3],
  [0x0047f715, 0x180, "op_st5.bin", 6],
];

interface SpawnDetail { at: number; class: number; pos: [number, number, number] }

async function main(): Promise<void> {
  const dir = gameDirOrSkip("objects");
  const { source, exe } = await openGame(dir);
  const c = new Checker("objects");

  // -- 1 and 2: spawns -------------------------------------------------------------
  const defined = new Set<number>();
  const ct = exe.v2r(CLASS_TABLE);
  if (ct !== null) {
    for (let o = ct; o + 8 <= exe.data.length && defined.size <= 512; o += 8) {
      const id = i32(exe.data, o);
      if (id < 0) break;
      defined.add(id);
    }
  }
  c.ok(defined.size > 0 && defined.size <= 512,
       `the class table at ${hex(CLASS_TABLE, 8)} defines ${defined.size} classes, `
       + `${Math.min(...defined)}..${Math.max(...defined)}, and ends`);

  const used = new Map<number, number>();
  let spawns = 0;
  for (let stage = 1; stage <= 6; stage++) {
    console.log(`\nstage ${stage}`);
    const st = await Stage.create(source, { stage });
    const prog = await script.load(st);
    const { parts } = await st.geometry();
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (const [, models] of parts) {
      for (const m of models) {
        for (const me of m.meshes) {
          for (const v of me.vertices) {
            for (let k = 0; k < 3; k++) {
              lo[k] = Math.min(lo[k]!, v.pos[k]!);
              hi[k] = Math.max(hi[k]!, v.pos[k]!);
            }
          }
        }
      }
    }
    let n = 0;
    const undefinedClass: string[] = [];
    const outside: string[] = [];
    for (const b of prog.blocks) {
      for (const step of b.steps) {
        for (const op of step.ops) {
          for (const sp of (op.detail.spawns as SpawnDetail[] | undefined) ?? []) {
            n++;
            used.set(sp.class, (used.get(sp.class) ?? 0) + 1);
            if (!defined.has(sp.class)) undefinedClass.push(`${hex(sp.at)} class ${sp.class}`);
            if (![0, 1, 2].every((k) => lo[k]! <= sp.pos[k] && sp.pos[k] <= hi[k]!)) {
              outside.push(`${hex(sp.at)} at (${sp.pos.map((x) => x.toFixed(1)).join(", ")})`);
            }
          }
        }
      }
    }
    spawns += n;
    c.ok(n > 0 && undefinedClass.length === 0,
         `${n} spawns, every class defined in the handler table`
         + (undefinedClass.length ? `; not ${undefinedClass.slice(0, 5).join(", ")}` : ""));
    c.ok(n > 0 && outside.length === 0,
         `every spawn inside the stage's geometry box`
         + ` (${lo.map((x) => x.toFixed(0)).join(",")})..(${hi.map((x) => x.toFixed(0)).join(",")})`
         + (outside.length ? `; ${outside.length} outside: ${outside.slice(0, 5).join(", ")}` : ""));
  }
  c.note(`${spawns} spawns over stages 1-6 name ${used.size} distinct classes`);

  // -- 3: the literal slots ----------------------------------------------------
  console.log("\nliteral route slots");
  const cps = exe.camPathSlots();
  for (const [site, slot, file, local] of LITERAL_SLOTS) {
    const r = exe.v2r(site);
    const push = r !== null && r >= 5 && exe.data[r - 5] === 0x68
      ? i32(exe.data, r - 4) : null;
    const target = r !== null && exe.data[r] === 0xe8
      ? (site + 5 + i32(exe.data, r + 1)) >>> 0 : null;
    const rec = cps.get(slot);
    const ok = push === slot && target === CAM_EVAL_OBJECT_PATH6
      && rec !== undefined && rec[0] === file && rec[1] === local;
    c.ok(ok, `${hex(site, 8)}: PUSH ${push === null ? "?" : hex(push)}; CALL `
         + `${target === null ? "?" : hex(target, 8)} -> slot ${hex(slot)} is `
         + `${rec ? `${rec[0]} local ${rec[1]}` : "no path"}`
         + (ok ? "" : `; formats/cam.md states ${file} local ${local}`));
  }

  // -- 4: rig gates and routes -------------------------------------------------
  console.log("\nrigs");
  const fileOf = (slot: number): string => exe.slotCamFile(slot) ?? "?";
  const stageOf = (f: string): string => f.replace(/^(cp|op)_/, "");
  const wrongKind: string[] = [];
  const crossStage: string[] = [];
  let routes = 0, gates = 0;
  for (const rig of rigs.RIGS) {
    for (const s of rigs.allPathSlots(rig)) {
      routes++;
      if (!fileOf(s).startsWith("op_")) wrongKind.push(`${rig.name} route ${hex(s)} is ${fileOf(s)}`);
    }
    for (const g of rigs.rigCamPaths(rig)) {
      gates++;
      if (!fileOf(g).startsWith("cp_")) wrongKind.push(`${rig.name} gate ${hex(g)} is ${fileOf(g)}`);
    }
    for (const route of rig.routes ?? []) {
      for (const g of route.camPaths ?? []) {
        if (stageOf(fileOf(route.slot)) !== stageOf(fileOf(g))) {
          crossStage.push(`${rig.name}: route ${hex(route.slot)} in ${fileOf(route.slot)}, `
                          + `gate ${hex(g)} in ${fileOf(g)}`);
        }
      }
    }
  }
  c.ok(routes > 0 && wrongKind.length === 0,
       `${rigs.RIGS.length} rigs: ${routes} route slots all op_, ${gates} gates all cp_`
       + (wrongKind.length ? `; not ${wrongKind.slice(0, 5).join("; ")}` : ""));
  c.ok(crossStage.length === 0,
       crossStage.length ? `gates in another stage's file: ${crossStage.slice(0, 5).join("; ")}`
         : "every gate sits in the same stage file as the route it selects");

  // -- 5: swept routes start on their keys ---------------------------------------
  console.log("\nswept routes");
  const files = new Map<string, camlib.CamFile>();
  const early: string[] = [];
  let swept = 0;
  for (const rig of rigs.RIGS) {
    for (const route of rig.routes ?? []) {
      if (rigs.holdFrameOf(route) !== null) continue;
      const rec = cps.get(route.slot);
      if (!rec) continue;
      let f = files.get(rec[0]);
      if (!f) {
        f = camlib.parse(await source.read(`cam/${rec[0]}`), rec[0]);
        files.set(rec[0], f);
      }
      const path = f.paths[rec[1]];
      if (!path) continue;
      swept++;
      const firsts = [...path.channels].filter(([, cv]) => cv.keys.length)
        .map(([name, cv]) => [name, cv.keys[0]!.time] as [string, number]);
      if (!firsts.length) continue;
      // Swept from frame 0, or from the earliest key when that is later.
      const floor = Math.max(0, Math.min(...firsts.map(([, t]) => t)));
      const late = firsts.filter(([, t]) => t > floor + 1);
      if (late.length) {
        early.push(`${rig.name} route ${hex(route.slot)} swept from ${floor} but `
                   + late.map(([name, t]) => `${name}@${t}`).join(", "));
      }
    }
  }
  c.ok(swept > 0 && early.length === 0,
       `${swept} swept routes, none evaluated before its own keys begin`
       + (early.length ? `; ${early.slice(0, 4).join("; ")}` : ""));

  c.finish();
}

await main();
