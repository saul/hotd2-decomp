/**
 * Class 0x44 selector 13 is read the way the EXE reads it, every spawn on the
 * disc is placed with exactly those fields, and each one's model travels.
 *
 *     node tools/run_ts.mjs tools/checks/rise_to_height.ts --game-dir ~/"THE HOUSE OF THE DEAD 2"
 *     HOTD2_BUNDLE=/path/to/export node tools/run_ts.mjs tools/checks/rise_to_height.ts --game-dir ...
 *
 * `PropBuildRiseToHeight` (`FUN_00473640`) and `RiseToHeightUpdate`
 * (`FUN_004757F0`), `src/game/class44/rise_to_height.ts`, are stage 5's gate
 * behind JUDGMENT and twelve objects in stage 6. For as long as the selector
 * had no port the spawn built nothing and the gate was drawn only by the
 * stage's "loaded, so drawn" rule, at the world's origin -- nothing anywhere
 * said a builder was missing (`L83`). Four things can each put it back:
 *
 *  * **The table no longer points at the builder, or the builder at the
 *    update.** `g_class44_subtypes[13]` is read out of `.data` and the
 *    `PUSH` of the update's address out of the constructor.
 *  * **The exporter reads the tail at the wrong place or width.** Every
 *    instruction in the constructor that loads a tail field is compared
 *    byte for byte, which fixes both the displacement and the width; a
 *    height read as a float, or a flag read unsigned, fails here.
 *  * **The port's constants drift from the update's.** The camera path and
 *    frame it dies on and the `1.0f` it climbs by are read out of the image
 *    and compared with the three the port exports.
 *  * **The bundle carries something else, or lacks the model.** With an
 *    export, every selector-13 spawn in every stage's `evt/` table has a
 *    `rise_to_height` placement whose fields are that same tail, and its
 *    slot has a `_slot_` template in the stage's glTF.
 *
 * And one thing the port rests on: **every shipped spawn carries `-1` at
 * tail `+0x08`**, so none takes the update's shot-test registration or its
 * `ActorDespawn` exit, and the `obj+0x150` matrix and `obj+0x68` yaw the port
 * does not keep are read by nothing (`L57`: the input that would make them
 * matter, checked to be absent from the data).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gameDirOrSkip, openGame, Checker, hex, f32Bits } from "../lib/exe_check";
import { BUNDLE_ROOT, skipNoBundle } from "../lib/bundle_root";
import * as evt from "../../src/hod2lib/evt";
import { Stage } from "../../src/hod2lib/stage";
import {
  RISE_TO_HEIGHT_KILL_FRAME, RISE_TO_HEIGHT_KILL_PATH, RISE_TO_HEIGHT_STEP,
} from "../../src/game/class44/rise_to_height";

const BUILD = 0x00473640;
const UPDATE = 0x004757f0;
/** `g_class44_subtypes`, 18 entries indexed by `obj+0x11C`. */
const CLASS44_SUBTYPES = 0x00595ab8;
const SELECTOR = 13;

type Kind = "u16" | "i32" | "i8";

/**
 * The constructor's reads of the tail, `ECX` = `desc+0x1390`, as
 * `[address, bytes, field, tail offset, kind]`. The last byte of each is the
 * `disp8` and the opcode is the width: `66 8B` a word move (stored to the
 * word at `obj+0x28C`), `8B` a dword, `0F BE` a sign-extending byte load, and
 * `DB 41` an integer `FILD` -- the height is a whole number.
 */
const READS: [number, string, string, number, Kind][] = [
  [0x00473698, "668b5104", "slot", 0x04, "u16"],
  [0x004736a3, "8b5108", "coli", 0x08, "i32"],
  [0x004736ac, "0fbe5120", "open_flag", 0x20, "i8"],
  [0x004736b6, "0fbe5121", "remove_flag", 0x21, "i8"],
  [0x004736c0, "db4114", "rise", 0x14, "i32"],
];

/** ...and the instructions that say where each goes and what the rest is. */
const OTHERS: [number, string, string][] = [
  [0x00473646, "68f0574700", `PUSH ${hex(UPDATE, 8)}: ActorAlloc is handed RiseToHeightUpdate`],
  [0x0047368c, "8b8890130000", "ECX = desc+0x1390, the tail"],
  [0x004736c3, "d84044", "FADD float ptr [desc+0x44]: the height is added to the spawn's y"],
  [0x004736c6, "d99ec0020000", "FSTP float ptr [obj+0x2C0]: the ceiling"],
  [0x0047367a, "8b5068", "desc+0x68, the yaw, to obj+0x1D0"],
  [0x00475818, "813d782d9a00dd000000", "CMP [g_active_cam_path], 0xDD"],
  [0x00475824, "813d10619a005c030000", "CMP [g_cam_path_frame], 0x35C"],
  [0x0047585f, "d80580434c00", "FADD float ptr [0x004C4380]: the climb"],
  [0x004758c1, "83f8ff", "CMP EAX, -1 on obj+0x14C before RegisterForShotTest"],
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

interface Placement {
  at: number;
  container: string;
  slot?: number;
  coli?: number;
  rise?: number;
  open_flag?: number;
  remove_flag?: number;
  pos?: [number, number, number];
  yaw?: number;
}

async function main(): Promise<void> {
  const dir = gameDirOrSkip("rise_to_height");
  const { source, exe } = await openGame(dir);
  const c = new Checker("rise_to_height");

  const bytesAt = (va: number, n: number): Uint8Array | null => {
    const r = exe.v2r(va);
    return r === null ? null : exe.data.subarray(r, r + n);
  };

  // -- the table, the constructor, the update --------------------------------
  c.eq(exe.ru32(CLASS44_SUBTYPES + SELECTOR * 4), BUILD,
       `g_class44_subtypes[${SELECTOR}] (${hex(CLASS44_SUBTYPES, 8)}) is PropBuildRiseToHeight`);
  for (const [addr, want, field, off, kind] of READS) {
    const got = bytesAt(addr, want.length / 2);
    c.ok(got !== null && hexBytes(got) === want
         && got[got.length - 1] === off,
         `PropBuildRiseToHeight at ${hex(addr, 8)} is ${got ? hexBytes(got) : "nothing"}: `
         + `${field} is tail+${hex(off, 2)}, read as ${kind}`);
  }
  for (const [addr, want, what] of OTHERS) {
    const got = bytesAt(addr, want.length / 2);
    c.ok(got !== null && hexBytes(got) === want,
         `${hex(addr, 8)} is ${got ? hexBytes(got) : "nothing"} (${want}): ${what}`);
  }
  c.eq(RISE_TO_HEIGHT_KILL_PATH, exe.ru32(0x0047581e),
       "RISE_TO_HEIGHT_KILL_PATH is the immediate RiseToHeightUpdate compares the path with");
  c.eq(RISE_TO_HEIGHT_KILL_FRAME, exe.ru32(0x0047582a),
       "RISE_TO_HEIGHT_KILL_FRAME is the immediate it compares the frame with");
  const step = exe.rf32(0x004c4380);
  c.ok(step !== null && f32Bits(step) === f32Bits(RISE_TO_HEIGHT_STEP),
       `RISE_TO_HEIGHT_STEP is the float at 0x004C4380 (${String(step)})`);

  // -- every stage: the spawns, the placements, the models -------------------
  const manifestPath = join(BUNDLE_ROOT, "manifest.json");
  const bundle = existsSync(manifestPath);
  const entries = bundle
    ? (JSON.parse(readFileSync(manifestPath, "utf8")) as {
        stages: { name: string; script: string; geometry: string }[] }).stages
    : [1, 2, 3, 4, 5, 6].flatMap((n) => [
        { name: `stage${n}`, script: "", geometry: "" },
        { name: `stage${n}_original`, script: "", geometry: "" }]);
  let spawns = 0;
  let placed = 0;
  const unique = new Set<string>();
  for (const entry of entries) {
    const name = entry.name;
    const m = /^stage(\d+)(_original)?$/.exec(name);
    if (!m) continue;
    let st: Stage;
    try {
      st = await Stage.create(source, { stage: Number(m[1]),
                                        original: m[2] !== undefined });
    } catch {
      continue;
    }
    const ev = await st.evt();
    if (!ev) continue;
    const recs = evt.spawns(ev).filter((r) => r.cls === 0x44 && r.hp === SELECTOR);
    let pls = new Map<number, Placement>();
    let nodes = new Set<number>();
    if (bundle) {
      const script = JSON.parse(readFileSync(join(BUNDLE_ROOT, name, entry.script),
                                             "utf8")) as {
        breakables?: { placements?: Placement[] } };
      pls = new Map((script.breakables?.placements ?? [])
        .filter((p) => p.container === "rise_to_height")
        .map((p) => [p.at, p] as const));
      for (const n of glbJson(join(BUNDLE_ROOT, name, entry.geometry)).nodes ?? []) {
        const mm = /_slot_([0-9a-f]{4})$/.exec(n.name ?? "");
        if (mm) nodes.add(parseInt(mm[1]!, 16));
      }
    }
    for (const r of recs) {
      spawns++;
      unique.add(`${m[1]}:${r.offset}`);
      const where = `${name}: ${hex(r.offset)}`;
      const tail = Object.fromEntries(READS.map(([, , field, off, kind]) =>
        [field, r.param(off, kind)]));
      c.eq(tail.coli, -1,
           `${where}'s tail+0x08 is -1: no blob, so no shot-test registration `
           + "and the remove flag's exit is ActorKill");
      if (!bundle) continue;
      const pl = pls.get(r.offset);
      if (!c.ok(pl !== undefined,
                `${where} has a rise_to_height placement, so something builds it`)) {
        continue;
      }
      placed++;
      const bad = Object.entries(tail)
        .filter(([k, v]) => (pl as unknown as Record<string, unknown>)[k] !== v)
        .map(([k, v]) => `${k} is ${String((pl as unknown as Record<string, unknown>)[k])}, the evt says ${String(v)}`);
      c.ok(bad.length === 0,
           `${where}'s placement is the constructor's reading of the tail, `
           + `${READS.length} fields${bad.length ? `: ${bad.join("; ")}` : ""}`);
      c.ok(pl!.pos !== undefined
           && pl!.pos.every((v, k) => f32Bits(v) === f32Bits(r.pos[k]!))
           && pl!.yaw === r.orient[1],
           `${where}'s position and yaw are the descriptor's`);
      c.ok(nodes.has(tail.slot as number),
           `${where} draws slot ${hex(tail.slot as number, 4)} and the glTF has `
           + "a `_slot_` template for it");
    }
    if (bundle) {
      const orphans = [...pls.keys()].filter((at) => !recs.some((r) => r.offset === at));
      c.ok(orphans.length === 0,
           `${name}: every rise_to_height placement has a spawn record behind it`
           + (orphans.length ? `; not ${orphans.map((a) => hex(a)).join(", ")}` : ""));
    }
  }
  c.ok(unique.size === 13,
       `${unique.size} unique selector-13 spawns on the disc (13: stage 5's `
       + "0x16F4 and twelve in stage 6; Original Mode's tables repeat them)");
  c.note(`${entries.length} stages read: ${spawns} selector-13 spawn records, `
         + `${placed} placed and held to the evt`);
  if (!bundle) {
    if (c.failed) c.finish();
    skipNoBundle("rise_to_height (the layout and the tails above were checked)");
  }
  c.finish();
}

await main();
