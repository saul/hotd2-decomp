/**
 * Class 0x44's hinges and the selectors round them -- 1 to 8, 10 and 15 --
 * are the builders and routines the port runs, and every spawn on the disc is
 * placed with its own tail.
 *
 *     node tools/run_ts.mjs tools/checks/class44_builders.ts --game-dir ~/"THE HOUSE OF THE DEAD 2"
 *     HOTD2_BUNDLE=/path/to/export node tools/run_ts.mjs tools/checks/class44_builders.ts --game-dir ...
 *
 * `src/game/class44/` (`hinge.ts`, `slot_effect.ts`, `effect_handoff.ts`,
 * `swing_then_break.ts`, `effect_collapse.ts`, `draw_only.ts`,
 * `kinded_prop.ts`). What can put a gap back:
 *
 *  * **The table no longer points at the builder, or the builder at its
 *    update** -- `g_class44_subtypes` read out of `.data`, and the `PUSH` of
 *    the update's address and of the allocation's size out of each builder.
 *  * **A literal the port holds is not the routine's** -- the van doors'
 *    offsets, the hinge's wide-slot scale and wobble gains, selector 6's
 *    decay, selector 8's gravity, bounce, floor and alpha, the curve tables'
 *    pointers, effect 0x10's node count, all read as the image has them.
 *  * **The exporter reads a tail at the wrong place or width, or misses a
 *    spawn** -- with an export, every spawn of these ten selectors in every
 *    stage's `evt/` table has its placement, with the fields its builder
 *    reads, and every model it can draw is a `slots_breakable` template.
 *  * **The curves or the effects do not travel** -- the bundle's yaw curves
 *    are `g_pHingeCurvesYaw`'s own, and each effect tree these routines draw
 *    is carried on the motion its routine names.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gameDirOrSkip, openGame, Checker, hex, f32Bits } from "../lib/exe_check";
import { BUNDLE_ROOT, skipNoBundle } from "../lib/bundle_root";
import * as evt from "../../src/hod2lib/evt";
import { Stage } from "../../src/hod2lib/stage";
import { u16 } from "../../src/hod2lib/bytes";

const CLASS44_SUBTYPES = 0x00595ab8;

/** `[selector, builder, its end, update, allocation size]`. */
const BUILDERS: [number, number, number, number, number][] = [
  [1, 0x00472bd0, 0x00472c90, 0x00473cf0, 0x378],
  [2, 0x00472c90, 0x00472e00, 0x00473cf0, 0x378],
  [3, 0x00472e00, 0x00472eb0, 0x00474120, 0x378],
  [4, 0x00472eb0, 0x00472f80, 0x00473cf0, 0x378],
  [5, 0x00472f80, 0x00473060, 0x00474240, 0x378],
  [6, 0x00473060, 0x00473170, 0x00474470, 0x378],
  [7, 0x00473170, 0x00473260, 0x00474770, 0x378],
  [8, 0x00473260, 0x00473300, 0x004748c0, 0xd14],
  [10, 0x00473370, 0x00473410, 0x0046a1c0, 0x378],
  [15, 0x00473770, 0x00473940, 0x00465fb0, 0x378],
];

/** `[address, f32 bits, what]` -- literals read out of `.rdata` by address. */
const FLOATS: [number, number, string][] = [
  [0x00569018, f32Bits(9.29), "PropBuildVanDoors' x offset, 9.29f"],
  [0x00564534, f32Bits(0.85), "SwingThenBreakUpdate's spin decay, 0.85f"],
  [0x0055cb10, f32Bits(0.02722), "EffectCollapseUpdate's gravity, 0.02722f"],
  [0x00569180, f32Bits(-0.9), "EffectCollapseUpdate's bounce, -0.9f"],
  [0x0055d2b4, f32Bits(5.0), "EffectCollapseUpdate's floor scale, 5.0f"],
];

/** `[address, bytes, what]` -- immediates inside the routines. */
const BYTES: [number, string, string][] = [
  [0x00473fa0, "dc0d70434c00", "HingeUpdate's BAMS-to-radians, double 0x004C4370"],
  [0x00473faa, "dc0d78915600", "HingeUpdate's +1024.0 for slot 0x1A46 ..."],
  [0x00473fc5, "dc0d70915600", "... and -1024.0 for every other"],
  [0x00474090, "680000803f680000803f686666863f",
   "HingeUpdate scales slots 0x1817/0x1816 by (1.05f, 1, 1)"],
  [0x0047466f, "68a6072ec1", "SwingThenBreakUpdate's -10.876867f"],
  [0x00474982, "6800804ac4680000404168cd4c59c4",
   "EffectCollapseUpdate's block-0xB point, (-869.2f, 12.0f, -810.0f)"],
  [0x00474dc1, "683333733f", "EffectCollapseUpdate draws its parts at 0.95f"],
];

/**
 * `PropBuildVanDoors`' other two offsets, 11.5f and 22.68f, as immediates
 * somewhere in its body.
 */
const VAN_DOOR_IMMEDIATES = ["00003841", "a470b541"];

/** Every shipped spawn of each selector, counted once per stage and address. */
const SPAWNS: Record<number, number> = {
  1: 37, 2: 3, 3: 2, 4: 13, 5: 1, 6: 1, 7: 1, 8: 2, 10: 5, 15: 9,
};

const CONTAINER: Record<number, string> = {
  1: "hinge", 2: "van_doors", 3: "flag_slot_effect", 4: "hinge_scaled",
  5: "effect_handoff", 6: "swing_then_break", 7: "scaled_slot_effect",
  8: "effect_collapse", 10: "slot_strip_loop", 15: "kinded_44",
};

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

type Placement = Record<string, unknown> & { at: number; container: string };

/** The slots a placement's object can draw, as the exporter decides them. */
function drawSlots(pl: Placement, scene: number): number[] {
  const slot = (pl.slot as number) ?? 0;
  switch (pl.container) {
    case "hinge": case "hinge_scaled": case "scaled_slot_effect": return [slot];
    case "van_doors": return [0x1794, 0x1795];
    case "effect_handoff": return [slot, 0x17d7];
    case "swing_then_break": return [slot, 0x170, 0x171, 0x172, 0x173, 0x174];
    case "flag_slot_effect": return [scene === 0 ? 0x17ee : 0x197c];
    case "slot_strip_loop":
      return Array.from({ length: ((pl.roll as number) ?? 0) + 1 },
                        (_, i) => slot + i);
    default: return [];
  }
}

/** The effect records a placement's routine draws: `[id, motion]`. */
const EFFECTS: Record<string, [number, number][]> = {
  flag_slot_effect: [[0xb, 0x1d6]],
  effect_handoff: [[0xc, 0x1ce]],
  swing_then_break: [[0xd, 0x1c7], [0xe, 0x1c8], [0xf, 0x1ca]],
  scaled_slot_effect: [[0xf, 0x1ca]],
  effect_collapse: [[0x10, 0x1d3]],
};

async function main(): Promise<void> {
  const dir = gameDirOrSkip("class44_builders");
  const { source, exe } = await openGame(dir);
  const c = new Checker("class44_builders");
  const bytesAt = (va: number, n: number): Uint8Array | null => {
    const r = exe.v2r(va);
    return r === null ? null : exe.data.subarray(r, r + n);
  };
  const le = (v: number) => hexBytes(new Uint8Array(
    new Uint32Array([v >>> 0]).buffer));

  for (const [sel, build, end, update, size] of BUILDERS) {
    c.eq(exe.ru32(CLASS44_SUBTYPES + sel * 4), build,
         `g_class44_subtypes[${sel}] is ${hex(build, 8)}`);
    const body = bytesAt(build, end - build);
    const hx = body ? hexBytes(body) : "";
    c.ok(hx.includes(`68${le(size)}68${le(update)}`),
         `${hex(build, 8)} allocates ${hex(size)} bytes running ${hex(update, 8)}`);
  }
  const van = bytesAt(0x00472c90, 0x00472e00 - 0x00472c90);
  c.ok(!!van && VAN_DOOR_IMMEDIATES.every((b) => hexBytes(van).includes(b)),
       "PropBuildVanDoors carries 11.5f and 22.68f as immediates");
  for (const [addr, bits, what] of FLOATS) {
    c.eq(exe.ru32(addr), bits, `${hex(addr, 8)}: ${what}`);
  }
  for (const [addr, want, what] of BYTES) {
    const got = bytesAt(addr, want.length / 2);
    c.ok(got !== null && hexBytes(got) === want,
         `${hex(addr, 8)} is ${got ? hexBytes(got) : "nothing"}: ${what}`);
  }
  // The two pointer tables `HingeUpdate` switches between, and effect 0x10's
  // node count -- 73, one more than its motion's bones, which is why the
  // collapse reads one entry past them.
  c.eq(exe.ru32(0x005960c8 + 4), 0x00595c68, "g_pHingeCurvesYaw[1]");
  c.eq(exe.ru32(0x005960c8 + 16), 0x00595fb0, "g_pHingeCurvesYaw[4]");
  c.eq(exe.ru32(0x005960b4 + 4), 0, "g_pHingeCurvesXYZ[1] is null");
  c.eq(exe.ru16(0x004d5404 + 0x10 * 2), 73, "g_effect_bone_counts[0x10]");

  const manifestPath = join(BUNDLE_ROOT, "manifest.json");
  const bundle = existsSync(manifestPath);
  const entries = bundle
    ? (JSON.parse(readFileSync(manifestPath, "utf8")) as {
        stages: { name: string; script: string; geometry: string }[] }).stages
    : [1, 2, 3, 4, 5, 6].flatMap((n) => [
        { name: `stage${n}`, script: "", geometry: "" },
        { name: `stage${n}_original`, script: "", geometry: "" }]);
  const unique: Record<number, Set<string>> = {};
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
    const scene = Number(m[1]) - 1;
    const recs = evt.spawns(ev).filter((r) => r.cls === 0x44
                                          && CONTAINER[r.hp] !== undefined);
    let pls = new Map<string, Placement>();
    const nodes = new Set<number>();
    let script: { breakables?: {
      placements?: Placement[];
      effects?: Record<string, { motion: number }>;
      hinge_curves_yaw?: Record<string, number[]>;
    } } = {};
    if (bundle) {
      script = JSON.parse(readFileSync(join(BUNDLE_ROOT, entry.name,
                                            entry.script), "utf8"));
      pls = new Map((script.breakables?.placements ?? [])
        .map((p) => [`${p.container}:${p.at}`, p] as const));
      for (const n of glbJson(join(BUNDLE_ROOT, entry.name, entry.geometry)).nodes ?? []) {
        const mm = /^slots_breakable_.*_slot_([0-9a-f]{4})$/.exec(n.name ?? "");
        if (mm) nodes.add(Number.parseInt(mm[1]!, 16));
      }
      const yaw = script.breakables?.hinge_curves_yaw ?? {};
      const y1 = exe.v2r(0x00595c68);
      c.ok(y1 !== null && (yaw["1"] ?? []).length === 0x3c
           && (yaw["1"] ?? []).every((v, f) => v === u16(exe.data, y1! + f * 2)),
           `${entry.name}: hinge_curves_yaw[1] is g_pHingeCurvesYaw[1]'s 60 frames`);
    }
    const seen = new Set<number>();
    for (const r of recs) {
      if (seen.has(r.offset)) continue;
      seen.add(r.offset);
      (unique[r.hp] ??= new Set()).add(`${m[1]}:${r.offset}`);
      if (!bundle) continue;
      const container = CONTAINER[r.hp]!;
      const where = `${entry.name}: selector ${r.hp} at ${hex(r.offset)}`;
      const pl = pls.get(`${container}:${r.offset}`);
      if (!c.ok(pl !== undefined, `${where} has a ${container} placement`)) continue;
      const u16 = (o: number) => r.param(o, "u16");
      const i8 = (o: number) => r.param(o, "i8");
      const i32 = (o: number) => r.param(o, "i32");
      const f3 = (o: number) => [o, o + 4, o + 8].map((k) => f32Bits(r.param(k, "f32") ?? NaN));
      const scaleIs = (o: number) => Array.isArray(pl!.scale)
        && (pl!.scale as number[]).every((v, k) => f32Bits(v) === f3(o)[k]);
      let ok = true;
      switch (r.hp) {
        case 1: case 5:
          ok = pl!.curve === u16(0) && pl!.slot === u16(4) && pl!.coli === i32(8)
            && pl!.side === i32(0x10) && pl!.wobble_phase === i32(0x14)
            && pl!.open_flag === i8(0x20) && pl!.remove_flag === i8(0x21);
          break;
        case 2:
          ok = pl!.coli === i32(8) && pl!.wobble_phase === i32(0x14)
            && pl!.open_flag === i8(0x20) && pl!.remove_flag === i8(0x21);
          break;
        case 4: case 6: case 7:
          ok = pl!.curve === u16(0) && pl!.slot === u16(4) && pl!.coli === i32(8)
            && pl!.side === i32(0x0c) && pl!.open_flag === i8(0x10)
            && pl!.remove_flag === i8(0x11) && scaleIs(0x14)
            && (r.hp === 4 || pl!.field_2ac === i8(0x12));
          break;
        case 3:
          ok = pl!.coli === i32(8) && pl!.open_flag === i8(0x20)
            && pl!.remove_flag === i8(0x21);
          break;
        case 8:
          ok = pl!.open_flag === i8(0x10) && pl!.lifetime_evt_steps === i8(0x11)
            && scaleIs(0x14) && Array.isArray(pl!.collapse_keys)
            && (pl!.collapse_keys as unknown[]).length === 2;
          break;
        case 10:
          ok = pl!.slot === u16(4) && pl!.lifetime_evt_steps === u16(0)
            && scaleIs(0x14) && pl!.roll === r.orient[2];
          break;
        case 15:
          ok = pl!.kind === ((r.orient[2] << 16) >> 16)
            && pl!.set_size === r.orient[0] && pl!.item_set === i8(4)
            && pl!.story_item === i32(8) && pl!.lifetime_evt_steps === u16(0);
          break;
      }
      c.ok(ok && (r.hp === 3 || pl!.yaw === r.orient[1] || r.hp === 15)
           && Array.isArray(pl!.pos)
           && (pl!.pos as number[]).every((v, k) => f32Bits(v) === f32Bits(r.pos[k]!)),
           `${where}'s placement is its builder's reading of the tail`);
      const slots = drawSlots(pl!, scene).filter((s) => s !== 0);
      const missing = slots.filter((s) => !nodes.has(s));
      c.ok(missing.length === 0,
           `${where}'s models travel`
           + (missing.length ? ` -- missing ${missing.map((s) => hex(s, 4)).join(", ")}` : ""));
      for (const [id, motion] of EFFECTS[container] ?? []) {
        c.ok(script.breakables?.effects?.[String(id)]?.motion === motion,
             `${where}: effect ${hex(id)} travels on motion ${hex(motion)}`);
      }
    }
  }
  for (const [sel, n] of Object.entries(SPAWNS)) {
    c.eq(unique[Number(sel)]?.size ?? 0, n,
         `unique selector-${sel} spawns on the disc`);
  }
  if (!bundle) {
    if (c.failed) c.finish();
    skipNoBundle("class44_builders (the routines and the evt above were checked)");
  }
  c.finish();
}

await main();
