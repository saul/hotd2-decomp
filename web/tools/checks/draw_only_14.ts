/**
 * Class 0x44 selector 14 is read the way the EXE reads it, every spawn on the
 * disc is placed with exactly those fields, and each one's model travels.
 *
 *     node tools/run_ts.mjs tools/checks/draw_only_14.ts --game-dir ~/"THE HOUSE OF THE DEAD 2"
 *     HOTD2_BUNDLE=/path/to/export node tools/run_ts.mjs tools/checks/draw_only_14.ts --game-dir ...
 *
 * `PropBuildDrawOnlySelector14` (`FUN_004736D0`) and `PropDrawOnlySelector14`
 * (`FUN_004758E0`), `src/game/class44/draw_only.ts`. The selector draws the
 * slot its descriptor tail names, which is why `0x10AE` looked drawn by
 * nothing: no instruction in the image names it (`L39`). What can put the
 * gap back:
 *
 *  * **The table no longer points at the builder, or the builder at the
 *    update** -- `g_class44_subtypes[14]` read out of `.data`, the `PUSH` of
 *    the update's address out of the constructor.
 *  * **The exporter reads the tail at the wrong place or width** -- every
 *    load of a tail field is compared byte for byte, and so is each store it
 *    feeds, which fixes the field it lands in.
 *  * **The update grows or loses a step** -- its calls are read in order:
 *    the prologue, the three turns in Z, Y, X order, the scale, the dead
 *    call, the two draws, and nothing that tests a camera path.
 *  * **The bundle carries something else, or lacks the model** -- with an
 *    export, every selector-14 spawn in every stage's `evt/` table has a
 *    `draw_only_14` placement whose fields are that same tail, and its slot a
 *    `slots_breakable` template.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gameDirOrSkip, openGame, Checker, hex, f32Bits } from "../lib/exe_check";
import { BUNDLE_ROOT, skipNoBundle } from "../lib/bundle_root";
import * as evt from "../../src/hod2lib/evt";
import { Stage } from "../../src/hod2lib/stage";

const BUILD = 0x004736d0;
const UPDATE = 0x004758e0;
const CLASS44_SUBTYPES = 0x00595ab8;
const SELECTOR = 14;

/** `[address, bytes, what]`: the constructor's tail reads and their stores. */
const BUILD_BYTES: [number, string, string][] = [
  [0x004736d6, "68e0584700", "PUSH 0x004758E0: ActorAlloc is handed the update"],
  [0x00473738, "8b8090130000", "EAX = placer+0x1390, the tail"],
  [0x0047373e, "668b106689961c010000",
   "MOV DX, [tail+0x00]; MOV [obj+0x11C], DX: the lifetime, a u16"],
  [0x00473748, "668b480466898e8c020000",
   "MOV CX, [tail+0x04]; MOV [obj+0x28C], CX: the slot, a u16"],
  [0x00473753, "8b50088996a8010000", "tail+0x08 -> obj+0x1A8, the x scale"],
  [0x0047375c, "8b480c898eac010000", "tail+0x0C -> obj+0x1AC, the y scale"],
  [0x00473765, "8b50108996b0010000", "tail+0x10 -> obj+0x1B0, the z scale"],
  [0x0047370a, "8b50648996cc010000", "placer+0x64 -> obj+0x1CC, pitch"],
  [0x00473713, "8b4868898ed0010000", "placer+0x68 -> obj+0x1D0, yaw"],
  [0x0047371c, "8b506c8996d4010000", "placer+0x6C -> obj+0x1D4, roll"],
];

/** The update's calls, in order, and the operand each turn and draw reads. */
const UPDATE_BYTES: [number, string, string][] = [
  [0x004758e6, "e8550dffff", "CALL PropExpireByStepLifetime first"],
  [0x004758f2, "d986c8010000d886a4010000", "z + obj+0x1C8 for the translate"],
  [0x00475917, "8b96d401000052e8ad420300", "MatrixRotateZ(obj+0x1D4) ..."],
  [0x00475923, "8b86d001000050e8b1410300", "... MatrixRotateY(obj+0x1D0) ..."],
  [0x0047592f, "8b8ecc01000051e8b5400300", "... MatrixRotateX(obj+0x1CC)"],
  [0x00475950, "e86b430300", "MatrixScale(obj+0x1A8..0x1B0)"],
  [0x0047596a, "e8b1c2feff", "MaxOfThreeToNoOpStub, dead"],
  [0x0047598d, "e84e2cfaff", "SubmitSlotWithSceneLightArray(obj+0x28C) ..."],
  [0x004759a9, "e8b22bfaff", "... or AssetDrawSlot(obj+0x28C)"],
  [0x004759bc, "c3", "RET: nothing after the draw"],
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
  lifetime_evt_steps?: number;
  scale?: [number, number, number];
  pos?: [number, number, number];
  pitch?: number;
  yaw?: number;
  roll?: number;
}

async function main(): Promise<void> {
  const dir = gameDirOrSkip("draw_only_14");
  const { source, exe } = await openGame(dir);
  const c = new Checker("draw_only_14");
  const bytesAt = (va: number, n: number): Uint8Array | null => {
    const r = exe.v2r(va);
    return r === null ? null : exe.data.subarray(r, r + n);
  };

  c.eq(exe.ru32(CLASS44_SUBTYPES + SELECTOR * 4), BUILD,
       `g_class44_subtypes[${SELECTOR}] (${hex(CLASS44_SUBTYPES, 8)}) is PropBuildDrawOnlySelector14`);
  for (const [addr, want, what] of [...BUILD_BYTES, ...UPDATE_BYTES]) {
    const got = bytesAt(addr, want.length / 2);
    c.ok(got !== null && hexBytes(got) === want,
         `${hex(addr, 8)} is ${got ? hexBytes(got) : "nothing"}: ${what}`);
  }
  // No camera-path test anywhere in the update: `CMP dword ptr [0x009A2D78]`
  // is `81 3D 78 2D 9A 00`, and `A1 78 2D 9A 00` the MOV EAX form.
  const body = bytesAt(UPDATE, 0x004759bd - UPDATE);
  const hx = body ? hexBytes(body) : "";
  c.ok(!!body && !hx.includes("782d9a00"),
       "the update never reads g_active_cam_path: type 12's cue is not in it");

  const manifestPath = join(BUNDLE_ROOT, "manifest.json");
  const bundle = existsSync(manifestPath);
  const entries = bundle
    ? (JSON.parse(readFileSync(manifestPath, "utf8")) as {
        stages: { name: string; script: string; geometry: string }[] }).stages
    : [1, 2, 3, 4, 5, 6].flatMap((n) => [
        { name: `stage${n}`, script: "", geometry: "" },
        { name: `stage${n}_original`, script: "", geometry: "" }]);
  let spawns = 0;
  const unique = new Set<string>();
  for (const entry of entries) {
    const m = /^stage(\d+)(_original)?$/.exec(entry.name);
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
    const nodes = new Set<number>();
    if (bundle) {
      const script = JSON.parse(readFileSync(join(BUNDLE_ROOT, entry.name,
                                                  entry.script), "utf8")) as {
        breakables?: { placements?: Placement[] } };
      pls = new Map((script.breakables?.placements ?? [])
        .filter((p) => p.container === "draw_only_14")
        .map((p) => [p.at, p] as const));
      for (const n of glbJson(join(BUNDLE_ROOT, entry.name, entry.geometry)).nodes ?? []) {
        const mm = /^slots_breakable_.*_slot_([0-9a-f]{4})$/.exec(n.name ?? "");
        if (mm) nodes.add(Number.parseInt(mm[1]!, 16));
      }
    }
    for (const r of recs) {
      spawns++;
      unique.add(`${m[1]}:${r.offset}`);
      if (!bundle) continue;
      const where = `${entry.name}: ${hex(r.offset)}`;
      const pl = pls.get(r.offset);
      if (!c.ok(pl !== undefined, `${where} has a draw_only_14 placement`)) continue;
      const scale = [0x08, 0x0c, 0x10].map((o) => r.param(o, "f32") ?? NaN);
      c.ok(pl!.slot === r.param(0x04, "u16")
           && pl!.lifetime_evt_steps === r.param(0x00, "u16")
           && !!pl!.scale && pl!.scale.every((v, k) => f32Bits(v) === f32Bits(scale[k]!))
           && pl!.pitch === r.orient[0] && pl!.yaw === r.orient[1]
           && pl!.roll === r.orient[2]
           && !!pl!.pos && pl!.pos.every((v, k) => f32Bits(v) === f32Bits(r.pos[k]!)),
           `${where}'s placement is the constructor's reading: slot, lifetime, `
           + "scale, pose");
      c.ok(nodes.has(pl!.slot ?? 0),
           `${where} draws slot ${hex(pl!.slot ?? 0, 4)} and slots_breakable has it`);
    }
  }
  c.ok(unique.size === 12,
       `${unique.size} unique selector-14 spawns on the disc (12: stage 2's two, `
       + "stage 3's three, stage 4's seven)");
  c.note(`${spawns} selector-14 spawn records read`);
  if (!bundle) {
    if (c.failed) c.finish();
    skipNoBundle("draw_only_14 (the routines and the evt above were checked)");
  }
  c.finish();
}

await main();
