/**
 * Class 0x41 type 1 -- the canal water task -- against the EXE.
 *
 *     node tools/run_ts.mjs tools/checks/water.ts --game-dir ~/"THE HOUSE OF THE DEAD 2"
 *
 * `PlaceWaterSurface` (`FUN_00462F70`) builds a task that draws one water tile
 * a script has loaded and ripples its UVs; `WaterSurfaceUpdate`
 * (`FUN_0046E3A0`) is that task. The port has it in
 * `src/game/class41/water.ts`. Every one of its fifteen spawns sits at the
 * world origin, and what it draws is an EXE table entry picked by a descriptor
 * byte, so a wrong reading of it looks like nothing at all: an undrawn canal
 * and no error anywhere.
 *
 * What this asserts, and what only this can see:
 *
 *  * **The chain.** `g_class41_constructors[1]`, as `ExeTables.class41Dispatch`
 *    reads it, is `PlaceWaterSurface`; it pushes `WaterSurfaceUpdate` and the
 *    port's `WATER_SURFACE_TASK_SIZE` to `ActorAlloc`, and reads its slot with
 *    `MOVSX ECX, word [EAX*2 + ExeTables.WATER_SURFACE_SLOTS]`. Bytes, not a
 *    decompile. The table ends where `ExeTables.PROP_KIND_PARAMS` begins.
 *  * **The table is ten water tiles.** Every slot of
 *    `ExeTables.waterSurfaceSlots()` -- the read the exporter resolves each
 *    placement through -- and every slot the task pairs or swaps them with,
 *    resolves through the slot tables to a model whose vertices all lie in one
 *    horizontal plane at the canal's height. A table read at the wrong address
 *    or stride fails here: nothing else in the image is ten flat planes in a
 *    row.
 *  * **The spawns.** Fifteen type-1 descriptors (5 stage 2, 7 stage 3, 3
 *    training), each at the origin with no angle, each index inside the table.
 *  * **The port's constants are the EXE's immediates**, imported from the
 *    modules the player runs and held against the instruction that holds each
 *    one: the six tile slots, the canal's kill step, the two camera paths and
 *    the pause frame, block 0x23 step 2, the kill-flag base, the eight script
 *    flags, the phase multipliers (a `LEA`/`SHL` chain, so the product is
 *    computed here), the three floats, and `core/bams.ts`'s
 *    `BAMS_TO_RAD_F64`, which the ripple multiplies by.
 */
import { gameDirOrSkip, openGame, Checker, hex } from "../lib/exe_check";
import { ExeTables } from "../../src/hod2lib/exetab";
import { i8, u32, f32 } from "../../src/hod2lib/bytes";
import * as evt from "../../src/hod2lib/evt";
import * as container from "../../src/hod2lib/container";
import * as nl1 from "../../src/hod2lib/nl1";
import { BAMS_TO_RAD_F64 } from "../../src/core/bams";
import * as water from "../../src/game/class41/water";
import * as slots from "../../src/game/class41/water_slots";
import { SCRIPT_FLAG_CLEAR_PROPS } from "../../src/game/class41/lifetime";

const CLASS41 = 0x41;
/** `PlaceWaterSurface`, `g_class41_constructors[1]`. */
const PLACE = 0x00462f70;
/** `WaterSurfaceUpdate`, the task it allocates. */
const UPDATE = 0x0046e3a0;
/** The `MOVSX` in `PlaceWaterSurface` that indexes the slot table. */
const SLOT_READ = 0x00462fa5;
/** `g_script_flags`. */
const SCRIPT_FLAGS = 0x009c7200;

/** What the shipped scripts hold. A change here is a change in the reading. */
const EXPECT_SPAWNS: Record<string, number> =
  { "st2evtbl.bin": 5, "st3evtbl.bin": 7, "trnevtbl.bin": 3 };

const PORT = {
  WATER_CANAL_SLOT: slots.WATER_CANAL_SLOT,
  WATER_ARENA_SLOT: slots.WATER_ARENA_SLOT,
  WATER_DEATH_SLOT: slots.WATER_DEATH_SLOT,
  WATER_ARENA_PAIR_SLOT: slots.WATER_ARENA_PAIR_SLOT,
  WATER_ARENA_ALT_SLOT: slots.WATER_ARENA_ALT_SLOT,
  WATER_ARENA_ALT_PAIR_SLOT: slots.WATER_ARENA_ALT_PAIR_SLOT,
  WATER_DEATH_ALT_SLOT: slots.WATER_DEATH_ALT_SLOT,
  WATER_CANAL_KILL_STEP: water.WATER_CANAL_KILL_STEP,
  WATER_DEATH_CAM_PATH: water.WATER_DEATH_CAM_PATH,
  WATER_PAUSE_CAM_PATH: water.WATER_PAUSE_CAM_PATH,
  WATER_PAUSE_CAM_FRAME: water.WATER_PAUSE_CAM_FRAME,
  WATER_SURFACE_KILL_BLOCK: water.WATER_SURFACE_KILL_BLOCK,
  WATER_SURFACE_KILL_BLOCK_STEP: water.WATER_SURFACE_KILL_BLOCK_STEP,
  WATER_SURFACE_KILL_FLAG_BASE: water.WATER_SURFACE_KILL_FLAG_BASE,
} as const;

/**
 * `[address of the immediate, width, port constant]`. Each address is inside
 * the instruction the disassembly of `WaterSurfaceUpdate` or
 * `PlaceWaterSurface` shows; the width is the immediate's.
 */
const IMMEDIATES: [number, 1 | 4, keyof typeof PORT][] = [
  [0x0046e46d, 4, "WATER_CANAL_SLOT"],
  [0x0046e476, 1, "WATER_CANAL_KILL_STEP"],
  [0x0046e4b8, 4, "WATER_ARENA_SLOT"],
  [0x0046e666, 4, "WATER_ARENA_SLOT"],
  [0x0046e4ce, 4, "WATER_DEATH_SLOT"],
  [0x0046e6cb, 4, "WATER_DEATH_SLOT"],
  [0x0046e66e, 4, "WATER_ARENA_PAIR_SLOT"],
  [0x0046e67e, 4, "WATER_ARENA_ALT_SLOT"],
  [0x0046e687, 4, "WATER_ARENA_ALT_PAIR_SLOT"],
  [0x0046e699, 4, "WATER_DEATH_ALT_SLOT"],
  [0x0046e4dc, 1, "WATER_DEATH_CAM_PATH"],
  [0x0046e4f3, 1, "WATER_PAUSE_CAM_PATH"],
  [0x0046e512, 4, "WATER_PAUSE_CAM_FRAME"],
  [0x0046e455, 1, "WATER_SURFACE_KILL_BLOCK"],
  [0x0046e45b, 1, "WATER_SURFACE_KILL_BLOCK_STEP"],
  [0x00462fcb, 1, "WATER_SURFACE_KILL_FLAG_BASE"],
];

/**
 * `[address of the flag's absolute operand, enum member]`: each reads
 * `g_script_flags + n`, so the member is the operand less the array's base.
 */
const FLAGS: [number, keyof typeof water.WaterSurfaceFlag][] = [
  [0x0046e48c, "KillAllStage3"],       // MOV AL, [0x009C7204]
  [0x0046e4c0, "ArenaRipple"],         // MOV DL, [0x009C7208]
  [0x0046e694, "SwapTiles"],           // MOV AL, [0x009C7209]
  [0x0046e4e5, "RippleOff"],           // MOV DL, [0x009C726A]
  [0x0046e523, "TrainingRippleOn"],    // MOV CL, [0x009C72F1]
  [0x0046e531, "TrainingRippleOff"],   // MOV CL, [0x009C72F2]
];
/** And the stage-2 sweep, which `lifetime.ts` names. */
const SWEEP_FLAG_AT = 0x0046e3b6;      // MOV CL, [0x009C7277]

/** The pairs and swaps `WaterSurfaceUpdate` draws beside the table's slots. */
const PAIR_SWAP_AT = [0x0046e66e, 0x0046e67e, 0x0046e687, 0x0046e699];

function hexBytes(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

function le32(v: number): number[] {
  return [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
}

function sameBytes(a: Uint8Array, b: readonly number[]): boolean {
  return a.length === b.length && b.every((x, i) => a[i] === x);
}

async function main(): Promise<void> {
  const dir = gameDirOrSkip("water");
  const { source, exe } = await openGame(dir);
  const raw = exe.data;
  const c = new Checker("water");

  const at = (va: number): number => {
    const r = exe.v2r(va);
    if (r === null) throw new Error(`${hex(va, 8)} is not in a section`);
    return r;
  };
  const bytesAt = (va: number, n: number): Uint8Array =>
    raw.subarray(at(va), at(va) + n);
  const imm = (va: number, width: 1 | 4): number =>
    width === 1 ? raw[at(va)]! : u32(raw, at(va));
  const f64At = (va: number): number =>
    new DataView(raw.buffer, raw.byteOffset).getFloat64(at(va), true);

  // -- the chain -----------------------------------------------------------
  const TABLE = ExeTables.WATER_SURFACE_SLOTS;
  const TABLE_LEN = ExeTables.WATER_SURFACE_SLOT_COUNT;
  const ctor = exe.class41Dispatch()[1]?.ctor ?? -1;
  c.ok(ctor === PLACE,
       `g_class41_constructors[1] is ${hex(ctor)}, PlaceWaterSurface `
       + `${hex(PLACE, 8)}`);
  const push = bytesAt(PLACE + 1, 7);
  c.ok(sameBytes(push, [0x6a, water.WATER_SURFACE_TASK_SIZE, 0x68,
                        ...le32(UPDATE)]),
       `PlaceWaterSurface pushes (WaterSurfaceUpdate, `
       + `WATER_SURFACE_TASK_SIZE ${hex(water.WATER_SURFACE_TASK_SIZE)}): `
       + hexBytes(push));
  const movsx = bytesAt(SLOT_READ, 8);
  c.ok(sameBytes(movsx, [0x0f, 0xbf, 0x0c, 0x45, ...le32(TABLE)]),
       `the slot read at ${hex(SLOT_READ, 8)} is MOVSX from `
       + `ExeTables.WATER_SURFACE_SLOTS ${hex(TABLE, 8)}: ${hexBytes(movsx)}`);
  c.ok(ExeTables.PROP_KIND_PARAMS - TABLE === TABLE_LEN * 2,
       `the ${TABLE_LEN}-slot table ends where g_prop_kind_params `
       + `${hex(ExeTables.PROP_KIND_PARAMS, 8)} begins`);

  // -- the table is ten water tiles -----------------------------------------
  const table = exe.waterSurfaceSlots();
  const extra = PAIR_SWAP_AT.map((a) => imm(a, 4));
  const bySlot = exe.assetSlots();
  const models = new Map<string, nl1.Model[]>();
  for (const s of [...table, ...extra]) {
    const rec = bySlot.get(s);
    if (!rec) {
      c.fail(`slot ${hex(s)} names no pol file`);
      continue;
    }
    const [pol, entry] = rec;
    let ms = models.get(pol);
    if (!ms) {
      ms = nl1.parseContainer(container.load(await source.read(`pol/${pol}`)));
      models.set(pol, ms);
    }
    const m = ms[entry];
    const ys = m ? m.meshes.flatMap((me) => me.vertices.map((v) => v.pos[1])) : [];
    if (!ys.length) {
      c.fail(`slot ${hex(s)} (${pol}[${entry}]) has no model`);
      continue;
    }
    const lo = Math.min(...ys);
    const hi = Math.max(...ys);
    c.ok(hi - lo < 1.0 && -26.0 < lo && hi < -14.0,
         `slot ${hex(s)} (${pol}[${entry}]) spans y ${lo.toFixed(1)}..`
         + `${hi.toFixed(1)}: one plane at the canal`);
  }

  // -- the spawns ------------------------------------------------------------
  const com = evt.parse(await source.read("evt/comevtbl.bin"), "comevtbl.bin");
  const counts: Record<string, number> = {};
  const seen = new Set<string>();
  for (let scene = 0; scene < ExeTables.SCENE_COUNT; scene++) {
    const name = exe.sceneEvtFile(scene);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    if (!(await source.exists(`evt/${name}`))) continue;
    const f = evt.parse(await source.read(`evt/${name}`), name,
                        exe.sceneBlockCount(scene), com);
    for (const sp of evt.spawns(f)) {
      if (sp.cls !== CLASS41 || f.raw[sp.offset + 0x25] !== 1) continue;
      counts[name] = (counts[name] ?? 0) + 1;
      const index = i8(f.raw, sp.offset + 0x24);
      const where = `${name}:${hex(sp.offset)}`;
      c.ok(index >= 0 && index < TABLE_LEN,
           `${where} index ${index} is inside the table`);
      c.ok(sp.pos.every((v) => v === 0) && sp.orient.every((v) => v === 0),
           `${where} is placed at (${sp.pos.join(", ")}) `
           + `(${sp.orient.join(", ")}); the task reads neither`);
    }
  }
  const got = JSON.stringify(Object.entries(counts).sort());
  const want = JSON.stringify(Object.entries(EXPECT_SPAWNS).sort());
  c.ok(got === want, `type-1 spawns by file are ${got}, expected ${want}`);

  // -- the port's constants are the EXE's -----------------------------------
  for (const [va, width, name] of IMMEDIATES) {
    c.eq(PORT[name], imm(va, width),
         `the port's ${name} is the EXE's immediate at ${hex(va, 8)}`);
  }
  for (const [va, member] of FLAGS) {
    c.eq(water.WaterSurfaceFlag[member] as number, imm(va, 4) - SCRIPT_FLAGS,
         `WaterSurfaceFlag.${member} is the g_script_flags index the EXE `
         + `reads at ${hex(va, 8)}`);
  }
  c.eq(SCRIPT_FLAG_CLEAR_PROPS, imm(SWEEP_FLAG_AT, 4) - SCRIPT_FLAGS,
       `SCRIPT_FLAG_CLEAR_PROPS is the stage-2 sweep flag the EXE reads at `
       + hex(SWEEP_FLAG_AT, 8));
  // tick * 0x180: `LEA EDI, [EAX + EAX*2]; SHL EDI, 7` at 0x0046E5A3.
  const perTick = bytesAt(0x0046e5a3, 6);
  c.ok(sameBytes(perTick, [0x8d, 0x3c, 0x40, 0xc1, 0xe7, 0x07]),
       `the tick multiply at 0x0046E5A3 is LEA *3; SHL 7: ${hexBytes(perTick)}`);
  c.eq(water.WATER_PHASE_PER_TICK, 3 << 7, "WATER_PHASE_PER_TICK is 3 << 7");
  // x * 600: `LEA EAX, [EAX + EAX*2]; LEA EAX, [EAX + EAX*4]` twice, then
  // `LEA ECX, [EDI + EAX*8]` at 0x0046E5AE.
  const perUnit = bytesAt(0x0046e5ae, 12);
  c.ok(sameBytes(perUnit, [0x8d, 0x04, 0x40, 0x8d, 0x04, 0x80,
                           0x8d, 0x04, 0x80, 0x8d, 0x0c, 0xc7]),
       `the vertex multiply at 0x0046E5AE is LEA *3, *5, *5, *8: `
       + hexBytes(perUnit));
  c.eq(water.WATER_PHASE_PER_UNIT, 3 * 5 * 5 * 8,
       "WATER_PHASE_PER_UNIT is 3 * 5 * 5 * 8");
  const step = f64At(0x00569108);
  const zlim = f32(raw, at(0x00569110));
  const bams = f64At(0x004c4370);
  c.eq(water.WATER_UV_STEP, step,
       "WATER_UV_STEP is g_water_surface_uv_step, f64 at 0x00569108");
  c.eq(water.WATER_Z_LIMIT, zlim,
       "WATER_Z_LIMIT is g_water_surface_z_limit, f32 at 0x00569110");
  c.eq(bams, 2 * Math.PI / 65536, "g_bams_to_rad at 0x004C4370 is 2pi/65536");
  c.eq(BAMS_TO_RAD_F64, bams, "core/bams's BAMS_TO_RAD_F64 is g_bams_to_rad");
  c.note(`table ${table.map((s) => hex(s)).join(", ")}; pairs and swaps `
         + `${extra.map((s) => hex(s)).join(", ")}; uv step ${step}, `
         + `z limit ${zlim}`);

  c.finish();
}

await main();
