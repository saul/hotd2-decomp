/**
 * Class 0x44 selectors 9 and 12 and class 0x41 constructor 47 are read the
 * way the EXE reads them, every spawn on the disc is placed with exactly
 * those fields, and each one's model travels.
 *
 *     node tools/run_ts.mjs tools/checks/flag_props.ts --game-dir ~/"THE HOUSE OF THE DEAD 2"
 *     HOTD2_BUNDLE=/path/to/export node tools/run_ts.mjs tools/checks/flag_props.ts --game-dir ...
 *
 * The three objects the stage's old "loaded, so drawn" rule was drawing at
 * the world's origin in their place (`L54`, `L93`): stage 6's sliding doors
 * (`PropBuildSlideOnFlag` / `SlideOnFlagUpdate`), stage 3's lift
 * (`PropBuildFlagLiftedProp` / `FlagLiftedPropUpdate`) and stage 2's faded
 * disc (`PlaceType47Prop` / `PropUpdateType47`). With the rule gone a wrong
 * reading here is an object that is simply not there, and nothing else says
 * so. Four things are held:
 *
 *  * **The tables still point at the routines**: `g_class44_subtypes[9]` and
 *    `[12]`, `g_class41_constructors[47]` and `g_class41_updates[47]`.
 *  * **The exporter reads the tails at the right place and width**: every
 *    instruction in the two constructors that loads a tail field, byte for
 *    byte, which fixes the displacement and the width together.
 *  * **The port's constants are the routines' own**: the headings, the parked
 *    car's pose, the kill cues, the lift's ceiling and step, the disc's slot,
 *    pitch, scale and kill flag -- read out of the image and compared with
 *    what the port exports.
 *  * **Every shipped spawn is placed with exactly its tail, and its model is
 *    in the glTF**, with a bundle. And the premise the port rests on: no
 *    selector-12 spawn names slot `0x189C`, the one slot whose second draw
 *    changes the scene light -- which the port's recorded draw cannot carry.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gameDirOrSkip, openGame, Checker, hex, f32Bits } from "../lib/exe_check";
import { BUNDLE_ROOT, skipNoBundle } from "../lib/bundle_root";
import * as evt from "../../src/hod2lib/evt";
import { Stage } from "../../src/hod2lib/stage";
import {
  SLIDE_CAR_SLOTS, SLIDE_CAR_X, SLIDE_CAR_Y_BLOCK0, SLIDE_CAR_Y_OTHER,
  SLIDE_CAR_Z, SLIDE_CAR_YAW, SLIDE_DRAW_LAYER, SLIDE_HEADING,
  SLIDE_HEADING_CAR, SLIDE_KILL_FRAME, SLIDE_KILL_PATH,
} from "../../src/game/class44/slide_on_flag";
import { SLIDE_SECOND_DRAW_SLOT, SLIDE_SECOND_SLOT }
  from "../../src/game/class44/slide_slots";
import { FLAG_LIFTED_CEILING, FLAG_LIFTED_STEP }
  from "../../src/game/class44/flag_lifted";
import {
  TYPE47_ALPHA_MID, TYPE47_ALPHA_SWING, TYPE47_KILL_FLAG, TYPE47_KILL_STEP,
  TYPE47_PITCH, TYPE47_SCALE,
} from "../../src/game/class41/type47";
import { TYPE47_CONSTRUCTOR, TYPE47_SLOT }
  from "../../src/game/class41/type47_slots";

const CLASS44_SUBTYPES = 0x00595ab8;
const CLASS41_CONSTRUCTORS = 0x00593580;
const CLASS41_UPDATES = 0x005936bc;

/** `[address, bytes, what]` — each instruction the reading rests on. */
const BYTES: [number, string, string][] = [
  // PropBuildSlideOnFlag: the tail loads (EDI = desc+0x1390).
  [0x004734ab, "68b0554700", "PUSH SlideOnFlagUpdate into ActorAlloc"],
  [0x004734ff, "668b5704", "u16 tail+0x04 -> obj+0x28C, the slot"],
  [0x0047350a, "8b4708", "i32 tail+0x08 -> obj+0x14C, the blob"],
  [0x00473515, "da4f10", "FIMUL int tail+0x10, the speed"],
  [0x0047352f, "db4714", "FILD int tail+0x14, the length"],
  [0x00473538, "0fbe4f20", "s8 tail+0x20, the slide flag"],
  [0x00473542, "0fbe5721", "s8 tail+0x21, the remove flag"],
  [0x00473552, "8b4704", "the DWORD at tail+0x04 the car test compares"],
  [0x00473555, "3dfc0a0000", "CMP EAX, 0xAFC"],
  [0x0047355c, "3dfd0a0000", "CMP EAX, 0xAFD"],
  [0x00473563, "3dfe0a0000", "CMP EAX, 0xAFE"],
  [0x0047356a, "3dff0a0000", "CMP EAX, 0xAFF"],
  [0x0047358a, "68cd601ac6", "PUSH -9880.2, the car's z"],
  [0x00473591, "68333367c2", "PUSH -57.8, its y in block 0"],
  [0x00473598, "6833c31b45", "PUSH 2492.2, its y otherwise"],
  [0x0047359d, "6800600b44", "PUSH 557.5, its x"],
  [0x004735aa, "bb55750000", "MOV EBX, 0x7555, its yaw"],
  [0x004734c3, "dd0510445600", "FLD double [0x00564410], the heading"],
  [0x004735fe, "dd0568915600", "FLD double [0x00569168], the car's heading"],
  // SlideOnFlagUpdate.
  [0x004755d8, "813d782d9a00dd000000", "CMP g_active_cam_path, 0xDD"],
  [0x004755e4, "813d10619a005c030000", "CMP g_cam_path_frame, 0x35C"],
  [0x004756d2, "6a09", "PUSH 9 into SetDrawLayerNibble"],
  [0x00475722, "6681be8c0200009c18", "CMP slot, 0x189C: the second draw"],
  [0x004757b1, "6830170000", "PUSH 0x1730, the second draw's model"],
  // PropBuildFlagLiftedProp / FlagLiftedPropUpdate.
  [0x00473306, "68a04e4700", "PUSH FlagLiftedPropUpdate into ActorAlloc"],
  [0x00473340, "0fbe5020", "s8 tail+0x20, the lift flag"],
  [0x0047334a, "0fbe4821", "s8 tail+0x21, the remove flag"],
  [0x00473354, "668b5004", "u16 tail+0x04 -> obj+0x28C, the slot"],
  [0x00474ed0, "dc1d88915600", "FCOMP double [0x00569188], the ceiling"],
  [0x00474ee3, "d805a8434c00", "FADD float [0x004C43A8], the step"],
  // PlaceType47Prop / PropUpdateType47.
  [0x00463ae3, "6840dd4600", "PUSH PropUpdateType47 into ActorAlloc"],
  [0x0046dd40, "803d11729c0001", "CMP g_script_flags[0x11], 1"],
  [0x0046dd4d, "66833db02b9a0002", "CMP g_evt_step_index, 2"],
  [0x0046dd74, "6800c00000", "PUSH 0xC000 into MatrixRotateX"],
  [0x0046dd7e, "68cdcccc3e", "PUSH 0.4 into MatrixScale"],
  [0x0046dda2, "dc0d70434c00", "FMUL double [0x004C4370], BAMS to radians"],
  [0x0046ddaa, "d80d241d4d00", "FMUL float [0x004D1D24], the swing"],
  [0x0046ddb0, "d805a8434c00", "FADD float [0x004C43A8], the middle"],
  [0x0046ddb9, "6884130000", "PUSH 0x1384 into AssetDrawSlotWithAlpha"],
];

type Kind = "u16" | "u32" | "i32" | "i8";
const SLIDE_FIELDS: [string, number, Kind][] = [
  ["slot", 0x04, "u16"], ["slot_word", 0x04, "u32"], ["coli", 0x08, "i32"],
  ["speed", 0x10, "i32"], ["travel", 0x14, "i32"],
  ["open_flag", 0x20, "i8"], ["remove_flag", 0x21, "i8"],
];
const LIFT_FIELDS: [string, number, Kind][] = [
  ["slot", 0x04, "u16"], ["open_flag", 0x20, "i8"], ["remove_flag", 0x21, "i8"],
];

function hexBytes(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

/** The JSON chunk of a `.glb`. */
function glbJson(path: string): { nodes?: { name?: string }[] } {
  const b = readFileSync(path);
  let off = 12;
  while (off + 8 <= b.length) {
    const len = b.readUInt32LE(off);
    if (b.readUInt32LE(off + 4) === 0x4e4f534a) {
      return JSON.parse(b.subarray(off + 8, off + 8 + len).toString("utf8"));
    }
    off += 8 + len;
  }
  throw new Error(`${path}: no JSON chunk`);
}

interface Placement { at: number; container: string; [k: string]: unknown }

async function main(): Promise<void> {
  const dir = gameDirOrSkip("flag_props");
  const { source, exe } = await openGame(dir);
  const c = new Checker("flag_props");
  const bytesAt = (va: number, n: number): Uint8Array | null => {
    const r = exe.v2r(va);
    return r === null ? null : exe.data.subarray(r, r + n);
  };
  const f64 = (va: number): number | null => {
    const b = bytesAt(va, 8);
    return b ? new DataView(b.buffer, b.byteOffset, 8).getFloat64(0, true) : null;
  };

  // -- the tables --------------------------------------------------------------
  c.eq(exe.ru32(CLASS44_SUBTYPES + 9 * 4), 0x00473300,
       "g_class44_subtypes[9] is PropBuildFlagLiftedProp");
  c.eq(exe.ru32(CLASS44_SUBTYPES + 12 * 4), 0x004734a0,
       "g_class44_subtypes[12] is PropBuildSlideOnFlag");
  c.eq(exe.ru32(CLASS41_CONSTRUCTORS + TYPE47_CONSTRUCTOR * 4), 0x00463ae0,
       "g_class41_constructors[47] is PlaceType47Prop");
  c.eq(exe.ru32(CLASS41_UPDATES + 47 * 4), 0x0046dd40,
       "g_class41_updates[47] is PropUpdateType47");

  // -- the instructions ----------------------------------------------------------
  for (const [addr, want, what] of BYTES) {
    const got = bytesAt(addr, want.length / 2);
    c.ok(got !== null && hexBytes(got) === want,
         `${hex(addr, 8)} is ${got ? hexBytes(got) : "nothing"} (${want}): ${what}`);
  }

  // -- the port's constants against the image ------------------------------------
  const f32At = (va: number) => exe.rf32(va);
  c.eq(f64(0x00564410), SLIDE_HEADING, "SLIDE_HEADING is the double at 0x00564410");
  c.eq(f64(0x00569168), SLIDE_HEADING_CAR, "SLIDE_HEADING_CAR is the double at 0x00569168");
  c.eq(exe.ru32(0x0047358b), f32Bits(SLIDE_CAR_Z), "SLIDE_CAR_Z is the pushed float");
  c.eq(exe.ru32(0x00473592), f32Bits(SLIDE_CAR_Y_BLOCK0), "SLIDE_CAR_Y_BLOCK0 is the pushed float");
  c.eq(exe.ru32(0x00473599), f32Bits(SLIDE_CAR_Y_OTHER), "SLIDE_CAR_Y_OTHER is the pushed float");
  c.eq(exe.ru32(0x0047359e), f32Bits(SLIDE_CAR_X), "SLIDE_CAR_X is the pushed float");
  c.eq(exe.ru32(0x004735ab), SLIDE_CAR_YAW, "SLIDE_CAR_YAW is the MOV's immediate");
  c.ok(SLIDE_CAR_SLOTS.join() === [0xafc, 0xafd, 0xafe, 0xaff].join(),
       "SLIDE_CAR_SLOTS are the four compares");
  c.eq(exe.ru32(0x004755de), SLIDE_KILL_PATH, "SLIDE_KILL_PATH is the compare's immediate");
  c.eq(exe.ru32(0x004755ea), SLIDE_KILL_FRAME, "SLIDE_KILL_FRAME is the compare's immediate");
  c.eq(SLIDE_DRAW_LAYER, 9, "SLIDE_DRAW_LAYER is the PUSH 9");
  c.eq(exe.ru16(0x00475729), SLIDE_SECOND_DRAW_SLOT, "SLIDE_SECOND_DRAW_SLOT is the compare's word");
  c.eq(exe.ru32(0x004757b2), SLIDE_SECOND_SLOT, "SLIDE_SECOND_SLOT is the PUSH");
  c.eq(f64(0x00569188), FLAG_LIFTED_CEILING, "FLAG_LIFTED_CEILING is the double at 0x00569188");
  const step = f32At(0x004c43a8);
  c.ok(step !== null && f32Bits(step) === f32Bits(FLAG_LIFTED_STEP)
       && f32Bits(step) === f32Bits(TYPE47_ALPHA_MID),
       `FLAG_LIFTED_STEP and TYPE47_ALPHA_MID are the float at 0x004C43A8 (${String(step)})`);
  const swing = f32At(0x004d1d24);
  c.ok(swing !== null && f32Bits(swing) === f32Bits(TYPE47_ALPHA_SWING),
       `TYPE47_ALPHA_SWING is the float at 0x004D1D24 (${String(swing)})`);
  c.eq(exe.ru32(0x0046ddba), TYPE47_SLOT, "TYPE47_SLOT is the PUSH");
  c.eq(exe.ru32(0x0046dd75), TYPE47_PITCH, "TYPE47_PITCH is the PUSH");
  c.eq(exe.ru32(0x0046dd7f), f32Bits(TYPE47_SCALE), "TYPE47_SCALE is the PUSH");
  c.eq(0x9c7200 + TYPE47_KILL_FLAG, 0x009c7211, "TYPE47_KILL_FLAG is g_script_flags[0x11]");
  c.eq(TYPE47_KILL_STEP, 2, "TYPE47_KILL_STEP is the compare's 2");

  // -- every shipped spawn -------------------------------------------------------
  const manifestPath = join(BUNDLE_ROOT, "manifest.json");
  const bundle = existsSync(manifestPath);
  const entries = bundle
    ? (JSON.parse(readFileSync(manifestPath, "utf8")) as {
        stages: { name: string; script: string; geometry: string }[] }).stages
    : [1, 2, 3, 4, 5, 6].flatMap((n) => [
        { name: `stage${n}`, script: "", geometry: "" },
        { name: `stage${n}_original`, script: "", geometry: "" }]);
  const unique = { sel9: new Set<string>(), sel12: new Set<string>(), ctor47: new Set<string>() };
  let placed = 0;
  for (const entry of entries) {
    const m = /^stage(\d+)(_original)?$/.exec(entry.name);
    if (!m) continue;
    let st: Stage;
    try {
      st = await Stage.create(source, { stage: Number(m[1]), original: m[2] !== undefined });
    } catch {
      continue;
    }
    const ev = await st.evt();
    if (!ev) continue;
    let pls = new Map<number, Placement>();
    const nodes = new Set<number>();
    if (bundle) {
      const script = JSON.parse(readFileSync(join(BUNDLE_ROOT, entry.name, entry.script),
                                             "utf8")) as { breakables?: { placements?: Placement[] } };
      pls = new Map((script.breakables?.placements ?? []).map((p) => [p.at, p] as const));
      for (const n of glbJson(join(BUNDLE_ROOT, entry.name, entry.geometry)).nodes ?? []) {
        const mm = /_slot_([0-9a-f]{4})$/.exec(n.name ?? "");
        if (mm) nodes.add(parseInt(mm[1]!, 16));
      }
    }
    for (const r of evt.spawns(ev)) {
      const where = `${entry.name}: ${hex(r.offset)}`;
      let want: { container: string; fields: [string, number, Kind][] } | null = null;
      let slots: number[] = [];
      if (r.cls === 0x44 && r.hp === 12) {
        unique.sel12.add(`${m[1]}:${r.offset}`);
        want = { container: "slide_on_flag", fields: SLIDE_FIELDS };
        // The update's `CMP word [ESI+0x28C], 0x189C` reads the u16 the
        // constructor stored from tail+0x04.
        const slot = r.param(0x04, "u16") ?? 0;
        c.ok(slot !== SLIDE_SECOND_DRAW_SLOT,
             `${where} names slot ${hex(slot, 4)}, not 0x189C, so no selector-12 draw `
             + "changes the scene light");
        slots = [slot];
      } else if (r.cls === 0x44 && r.hp === 9) {
        unique.sel9.add(`${m[1]}:${r.offset}`);
        want = { container: "flag_lifted", fields: LIFT_FIELDS };
        slots = [r.param(0x04, "u16") ?? 0];
      } else if (r.cls === 0x41 && ev.raw[r.offset + 0x25] === TYPE47_CONSTRUCTOR) {
        unique.ctor47.add(`${m[1]}:${r.offset}`);
        want = { container: "type47", fields: [] };
        slots = [TYPE47_SLOT];
      }
      if (!want || !bundle) continue;
      const pl = pls.get(r.offset);
      if (!c.ok(pl !== undefined && pl.container === want.container,
                `${where} has a ${want.container} placement, so something builds it`)) {
        continue;
      }
      placed++;
      const bad = want.fields
        .filter(([k, off, kind]) => pl![k] !== r.param(off, kind))
        .map(([k, off, kind]) => `${k} is ${String(pl![k])}, the evt says ${String(r.param(off, kind))}`);
      c.ok(bad.length === 0,
           `${where}'s placement is the constructor's reading of the tail`
           + (bad.length ? `: ${bad.join("; ")}` : ""));
      const pos = pl!.pos as number[] | undefined;
      c.ok(!!pos && pos.every((v, k) => f32Bits(v) === f32Bits(r.pos[k]!)),
           `${where}'s position is the descriptor's`);
      const missing = slots.filter((s) => !nodes.has(s));
      c.ok(missing.length === 0,
           `${where} draws ${slots.map((s) => hex(s, 4)).join(", ")} and the glTF has a template`
           + (missing.length ? `; not ${missing.map((s) => hex(s, 4)).join(", ")}` : ""));
    }
  }
  c.eq(unique.sel12.size, 8, "eight unique selector-12 spawns on the disc, all stage 6");
  c.eq(unique.sel9.size, 1, "one selector-9 spawn, stage 3's");
  c.eq(unique.ctor47.size, 1, "one constructor-47 spawn, stage 2's");
  c.note(`${placed} placements held to the evt`);
  if (!bundle) {
    if (c.failed) c.finish();
    skipNoBundle("flag_props (the layout and the tails above were checked)");
  }
  c.finish();
}

await main();
