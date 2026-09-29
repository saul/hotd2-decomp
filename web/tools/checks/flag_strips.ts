/**
 * Class 0x12's descriptor tail is read the way the EXE reads it, and every slot
 * its strip draws is in the bundle.
 *
 *     node tools/run_ts.mjs tools/checks/flag_strips.ts --game-dir ~/"THE HOUSE OF THE DEAD 2"
 *     HOTD2_BUNDLE=/path/to/export node tools/run_ts.mjs tools/checks/flag_strips.ts --game-dir ...
 *
 * Class 0x12 -- `ScriptedPropInit12` (`FUN_0043F9D0`) and
 * `ScriptedPropUpdate12` (`FUN_0043FA60`), `src/game/class12/` -- is stage 1's
 * wooden door, the one the bin captor bursts out of: `door_1.bin[41]` until
 * script flag 34, then `door_1.bin[42..95]` a slot a frame, then gone. A spawn
 * with no module builds nothing, the captor walks out of an empty doorway, and
 * nothing anywhere says a class is missing. Three things can each put it back
 * there, and this is the check for all three:
 *
 *  * **The exporter reads the tail at the wrong place or width.** Every
 *    instruction in `ScriptedPropInit12` that loads a tail field is re-read out
 *    of `Hod2.exe` and decoded -- the displacement off `ESI` (`obj+0x130C`) is
 *    the field's offset, the opcode its width -- and `class12Tail` in
 *    `src/hod2lib/characters.ts`, the function the exporter runs, is called on
 *    a probe descriptor whose tail bytes are all different, so each field it
 *    returns can only have come from one offset at one width. A cam frame read
 *    two bytes off would despawn the door on a frame the camera never reaches;
 *    a flag read as unsigned would wait on a flag nothing raises.
 *  * **The bundle carries something else.** Every class-0x12 spawn in every
 *    stage's `evt/` table whose behaviour the port runs (`g_prop_behaviours`
 *    entry 0) has a placement, and the placement's `class12` and `init_flags`
 *    are what `class12Tail` and the spawn record decode out of the same bytes
 *    -- the bundle agreeing with the disc, not with a cached export. Floats
 *    compare as 32-bit patterns.
 *  * **A frame of the strip has no model.** `AssetDrawSlot(__ftol(sub+0x14))`
 *    draws the cursor truncated, and the cursor runs from `first` by `step`
 *    until it is past `last`: every slot that walk truncates to, and the one
 *    the prop waits on, is a `_slot_<hex>` node in the stage's glTF, or that
 *    frame draws nothing. The walk is simulated here in f32, as the FPU stores
 *    it, rather than taken from the exporter's own list.
 *
 * The layout needs only `--game-dir`; the bundle half needs an export too, and
 * without one the run exits 3 (L14) unless the layout already failed.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gameDirOrSkip, openGame, Checker, hex, f32Bits } from "../lib/exe_check";
import { BUNDLE_ROOT, skipNoBundle } from "../lib/bundle_root";
import * as evt from "../../src/hod2lib/evt";
import * as coli from "../../src/hod2lib/coli";
import { Stage } from "../../src/hod2lib/stage";
import { class12Tail } from "../../src/hod2lib/characters";

const INIT12 = 0x0043f9d0;

type Kind = "i16" | "u32" | "f32";

/**
 * `ScriptedPropInit12`'s reads of the tail, `ESI` = `obj+0x130C`, as
 * `[address, bytes, field, tail offset, kind]`. Every one is a load from
 * `[ESI + disp]`: `0F BF` is a sign-extending word load, `66 8B` a word move
 * into a word of the block (which the update then loads with `MOVSX`), `8B` a
 * dword. The dword at `+0x04` is stored to `obj+0x14C` (`0x0043F9FD`), a
 * pointer; `+0x14` and `+0x18` go to `sub+0x18` and `sub+0x10`, which the
 * update loads with `FLD` (`0x0043FB81`, `0x0043FB25`) -- floats.
 */
const READS: [number, string, string, number, Kind][] = [
  [0x0043f9ec, "0fbf0e", "slot", 0x00, "i16"],
  [0x0043fa10, "668b4e02", "delay", 0x02, "i16"],
  [0x0043f9fa, "8b5604", "coli", 0x04, "u32"],
  [0x0043fa03, "0fbf4e08", "behaviour", 0x08, "i16"],
  [0x0043fa18, "668b560a", "cam_path", 0x0a, "i16"],
  [0x0043fa20, "668b4e0c", "cam_frame", 0x0c, "i16"],
  [0x0043fa28, "668b560e", "first", 0x0e, "i16"],
  [0x0043fa30, "668b4e10", "last", 0x10, "i16"],
  [0x0043fa38, "668b5612", "flag", 0x12, "i16"],
  [0x0043fa40, "8b4e14", "step", 0x14, "f32"],
  [0x0043fa46, "8b5618", "scale", 0x18, "f32"],
];
/**
 * ...and the three instructions that say which is which: the slot is `FILD`'d
 * into `sub+0x14` (the cursor), `+0x14` lands in `sub+0x18` (the step the
 * update adds), `+0x18` in `sub+0x10` (the scale it compares with 1.0).
 */
const STORES: [number, string, string][] = [
  [0x0043f9f7, "d95814", "slot -> sub+0x14, the cursor"],
  [0x0043fa43, "894818", "tail+0x14 -> sub+0x18, the step"],
  [0x0043fa49, "895010", "tail+0x18 -> sub+0x10, the scale"],
];

const FLOAT_FIELDS = new Set(READS.filter((r) => r[4] === "f32").map((r) => r[2]));
const WIDTH: Record<Kind, number> = { i16: 2, u32: 4, f32: 4 };

function hexBytes(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

/**
 * The width and `ESI` displacement of a load, from its bytes: `66 8B /r`,
 * `0F BF /r` or `8B /r` with a ModRM of `[ESI]` or `[ESI + disp8]`.
 */
function decodeLoad(b: Uint8Array): { width: number; disp: number } | null {
  let i = 0;
  let width = 4;
  if (b[i] === 0x66) { width = 2; i++; }
  if (b[i] === 0x0f && b[i + 1] === 0xbf) { width = 2; i += 2; }
  else if (b[i] === 0x8b) i++;
  else return null;
  const modrm = b[i]!;
  if ((modrm & 7) !== 6) return null;                 // r/m is ESI
  const mod = modrm >> 6;
  if (mod === 0) return { width, disp: 0 };
  if (mod === 1) return { width, disp: (b[i + 1]! << 24) >> 24 };
  return null;
}

/** Field `kind` at `off` of `tail`, read as the EXE's instruction does. */
function readField(tail: DataView, off: number, kind: Kind): number {
  switch (kind) {
    case "i16": return tail.getInt16(off, true);
    case "u32": return tail.getUint32(off, true);
    case "f32": return tail.getFloat32(off, true);
  }
}

/** Field equality: a float field by its f32 bits, anything else exactly. */
function same(a: unknown, b: unknown, float: boolean): boolean {
  if (float) {
    return typeof a === "number" && typeof b === "number"
      && f32Bits(a) === f32Bits(b);
  }
  return a === b;
}

interface Tail12 {
  slot: number; step: number; first: number; last: number;
}

/**
 * What `ScriptedPropUpdate12` can hand `AssetDrawSlot`: the slot it waits on,
 * then `__ftol` of every cursor from `first` by `step` while it is not past
 * `last` -- the walk the update makes, in f32.
 */
function stripSlots(t: Tail12): number[] {
  const out = [t.slot];
  const step = Math.fround(t.step);
  if (step <= 0) return out;
  let cur = Math.fround(t.first);
  while (cur <= t.last && out.length < 10000) {
    const s = Math.trunc(cur);
    if (!out.includes(s)) out.push(s);
    cur = Math.fround(cur + step);
  }
  return out;
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
  class: number;
  init_flags?: number;
  class12?: Record<string, unknown> | null;
}

async function main(): Promise<void> {
  const dir = gameDirOrSkip("flag_strips");
  const { source, exe } = await openGame(dir);
  const c = new Checker("flag_strips");

  const bytesAt = (va: number, n: number): Uint8Array | null => {
    const r = exe.v2r(va);
    return r === null ? null : exe.data.subarray(r, r + n);
  };

  // -- the tail's layout, against the routine that reads it ------------------
  for (const [addr, want, field, off, kind] of READS) {
    const got = bytesAt(addr, want.length / 2);
    const d = got ? decodeLoad(got) : null;
    c.ok(got !== null && hexBytes(got) === want && d !== null
         && d.disp === off && d.width === WIDTH[kind],
         `ScriptedPropInit12 at ${hex(addr, 8)} is ${got ? hexBytes(got) : "nothing"}`
         + `, a ${d?.width ?? "?"}-byte load of tail+${hex(d?.disp ?? -1, 2)}: `
         + `${field} at tail+${hex(off, 2)} as ${kind}`);
  }
  for (const [addr, want, what] of STORES) {
    const got = bytesAt(addr, want.length / 2);
    c.ok(got !== null && hexBytes(got) === want,
         `ScriptedPropInit12 at ${hex(addr, 8)} is ${got ? hexBytes(got) : "nothing"}`
         + ` (${want}): ${what}`);
  }

  // -- class12Tail, probed ----------------------------------------------------
  // A descriptor whose tail bytes are 0x80, 0x81, ... -- every byte different
  // and every word negative as an i16 -- except the coli field, which holds a
  // relocated pointer into the scene's collision buffer, so a read there
  // resolves and a read anywhere else does not.
  const TAIL_LEN = 0x1c;
  const COLI_BLOB = 0x120;
  const buf = new Uint8Array(evt.SPAWN_HEADER + TAIL_LEN);
  const view = new DataView(buf.buffer);
  view.setUint32(0, 0x12, true);
  for (let k = 0; k < TAIL_LEN; k++) buf[evt.SPAWN_HEADER + k] = 0x80 + k;
  const coliOff = READS.find((r) => r[2] === "coli")![3];
  view.setUint32(evt.SPAWN_HEADER + coliOff,
                 (coli.BUF_SCENE + COLI_BLOB + evt.RELOC_SUB) >>> 0, true);
  const probe = new evt.EvtFile(buf, "probe");
  const rec = evt.readSpawn(probe, 0, 0x0b);      // an opcode that attaches the tail
  const common = new coli.ColiFile("probe0.bin", new Uint8Array());
  const scene = new coli.ColiFile("probe1.bin", new Uint8Array());
  scene.blobs.push({ offset: COLI_BLOB, groups: [] });
  const out = class12Tail(rec, [common, scene]);
  const tail = new DataView(buf.buffer, evt.SPAWN_HEADER, TAIL_LEN);
  for (const [addr, , field, off, kind] of READS) {
    let want: unknown = readField(tail, off, kind);
    if (field === "coli") {
      const hit = coli.pointerToOffset(want as number, common, scene);
      want = hit ? `${hit[0]}:${hit[1]}` : null;
      if (want === null) c.fail("the probe's coli word does not resolve, so it tests nothing");
    }
    c.ok(same(out[field], want, FLOAT_FIELDS.has(field)),
         `class12Tail's ${field} is tail+${hex(off, 2)} as ${kind}, `
         + `ScriptedPropInit12's read at ${hex(addr, 8)}: got ${String(out[field])}, `
         + `want ${String(want)}`);
  }
  const fields = new Set(READS.map((r) => r[2]));
  const extra = Object.keys(out).filter((k) => !fields.has(k));
  c.ok(extra.length === 0,
       `class12Tail returns only the fields ScriptedPropInit12 (${hex(INIT12, 8)}) `
       + `reads${extra.length ? `; also ${extra.join(", ")}` : ""}`);

  // -- every stage: the spawns, the placements, the strips ------------------
  const manifestPath = join(BUNDLE_ROOT, "manifest.json");
  if (!existsSync(manifestPath)) {
    if (c.failed) c.finish();
    skipNoBundle("flag_strips (the layout above was checked)");
  }
  const entries = (JSON.parse(readFileSync(manifestPath, "utf8")) as {
    stages: { name: string; script: string; geometry: string }[] }).stages;
  let spawns = 0;
  let placed = 0;
  let slots = 0;
  for (const entry of entries) {
    const name = entry.name;
    const m = /^stage(\d+)(_original)?$/.exec(name);
    if (!m) continue;
    const st = await Stage.create(source, { stage: Number(m[1]),
                                            original: m[2] !== undefined });
    const ev = await st.evt();
    if (!ev) continue;
    const sets = await st.colisets();
    const recs = new Map(evt.spawns(ev).filter((r) => r.cls === 0x12)
      .map((r) => [r.offset, r] as const));
    const script = JSON.parse(readFileSync(join(BUNDLE_ROOT, name, entry.script),
                                           "utf8")) as {
      characters: { placements: Placement[] } };
    const pls = new Map(script.characters.placements
      .filter((p) => p.class === 0x12).map((p) => [p.at, p] as const));
    const nodes = new Set<number>();
    for (const n of glbJson(join(BUNDLE_ROOT, name, entry.geometry)).nodes ?? []) {
      const mm = /_slot_([0-9a-f]{4})$/.exec(n.name ?? "");
      if (mm) nodes.add(parseInt(mm[1]!, 16));
    }
    for (const [at, r] of [...recs].sort((a, b) => a[0] - b[0])) {
      spawns++;
      const want = class12Tail(r, sets);
      const pl = pls.get(at);
      const where = `${name}: ${hex(at)}`;
      if (want.behaviour !== 0) {
        c.ok(pl === undefined,
             `${where} runs behaviour ${String(want.behaviour)}, which the port `
             + "does not, and the bundle does not place it");
        continue;
      }
      if (!c.ok(pl !== undefined && !!pl.class12,
                `${where} has a class-0x12 placement, so something builds it`)) {
        continue;
      }
      placed++;
      const got = pl!.class12!;
      const bad = Object.entries(want)
        .filter(([k, v]) => !same(got[k] ?? null, v, FLOAT_FIELDS.has(k)))
        .map(([k, v]) => `class12.${k} is ${String(got[k])}, the evt says ${String(v)}`);
      c.ok(bad.length === 0,
           `${where}'s class12 is class12Tail's reading of the evt, `
           + `${Object.keys(want).length} fields${bad.length ? `: ${bad.join("; ")}` : ""}`);
      c.eq(pl!.init_flags, r.initFlags, `${where}'s init_flags are the record's`);
      const strip = stripSlots(want as unknown as Tail12);
      slots += strip.length;
      const missing = strip.filter((s) => !nodes.has(s));
      c.ok(missing.length === 0,
           `${where} can draw ${strip.length} slots and the glTF has a `
           + "`_slot_` node for each"
           + (missing.length ? `; not ${missing.map((s) => hex(s, 4)).join(", ")}` : ""));
    }
    const orphans = [...pls.keys()].filter((at) => !recs.has(at));
    c.ok(orphans.length === 0,
         `${name}: every class-0x12 placement has a spawn record behind it`
         + (orphans.length ? `; not ${orphans.map((a) => hex(a)).join(", ")}` : ""));
  }
  c.ok(spawns > 0,
       `${spawns} class-0x12 spawns across the bundles (the three shipped ones are `
       + "stage 1 0x3D88, stage 2 0x15644, stage 5 0x2398)");
  c.note(`${entries.length} bundles: ${spawns} class-0x12 spawns, ${placed} placed `
         + `and held to the evt, ${slots} strip slots looked for`);

  c.finish();
}

await main();
