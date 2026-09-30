/**
 * Every model a placed prop will ask for is in the bundle it was placed from.
 *
 *     cd web && node tools/run_ts.mjs tools/checks/prop_slots.ts
 *     HOTD2_BUNDLE=/path/to/export node tools/run_ts.mjs tools/checks/prop_slots.ts
 *
 * A prop the script places and the port builds draws through `AssetDrawSlot`,
 * and `render/breakables.ts` answers that by cloning a hidden
 * `slots_breakable_*` node out of the stage's glTF. **A prop whose slot has no
 * such node is placed, updated, shot-tested and invisible** -- and from the
 * level that is indistinguishable from a placement the exporter never emitted.
 * Stage 3's roller shutter (class 0x44 selector 11) and stage 5's van body (a
 * class-0x41 type-51 placement at the same position and yaw as its two hinged
 * rear doors) are both that shape: a table in the exe names an asset slot, the
 * hidden rig does not carry it, and the client's clone answers null.
 *
 * **What is asserted, and what is not.** Only the slots the port will *really*
 * ask for:
 *
 * * every `rising_door` and `rise_to_height` placement's `slot` (class 0x44
 *   selectors 11 and 13, each of which draws its descriptor's slot and nothing
 *   else), and every model a `flicker_light`
 *   (class 0x41 type 48) carries;
 * * every `generic` placement whose type is in `GENERIC_DESCRIPTOR_SLOT`, for
 *   which the descriptor's `+0x11C` is the asset slot rather than a lifetime;
 * * every literal in `GENERIC_STATIC_SLOTS`, which is what those routines draw
 *   regardless of the descriptor;
 * * for the Original Mode collectibles, types 70, 71 and 72, both models of
 *   every item the placement's row can draw and both pickup strips -- the
 *   descriptor's word is a lifetime for those, and `PickOriginalModeItem`
 *   writes the model -- and the same for row 0 of a type 7 or 43, whose drop
 *   picks from it, and for every story item's row;
 * * every slot a type-40 fragment, a table-38/39/44 prop, or a table-50/66
 *   object draws, out of the port's own tables in `game/class41/`.
 *
 * A generic type outside that set is *not* checked: its `+0x11C` is a
 * lifetime, the port knows it, and demanding a model for `slot 4` would be
 * demanding the exporter carry `eff_3.bin` for every crate in the game.
 *
 * **That exclusion is this check's blind spot.** It reads the same table the
 * exporter does, so a type that *should* be in the set and is not is invisible
 * to it -- mutate `GENERIC_DESCRIPTOR_SLOT` to `[5, 12, 33]` and the rising
 * doors are caught at once while the van is not. The set is **seven** types by
 * the routines -- 5, 12, 31, 33, 51, 53 and 54 -- and all seven are in it.
 * `tools/checks/prop_pose.ts` is the check that reads the routines out of the
 * EXE.
 *
 * **Two of the seven draw a strip, not a slot.** `PropDrawOnlyType31`
 * (`FUN_0046A1C0`) and `PropDrawOnlyType33` (`FUN_00472950`) pass
 * `obj+0x28C + obj+0x2A0` and step that cursor a frame at a time, with the
 * strip length in the descriptor's third orientation word, so every frame of
 * the strip is a slot a placed prop will really ask for and every one of them
 * is checked here.
 *
 * One assertion per bundle when every slot it needs is there, and one failure
 * per missing slot. Exit 3 without a bundle.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { BUNDLE_ROOT, EXIT_SKIPPED, repoRoot } from "../lib/bundle_root";
import { Checker, argValue } from "../lib/exe_check";
import { SLIDE_SECOND_DRAW_SLOT, SLIDE_SECOND_SLOT }
  from "../../src/game/class44/slide_slots";
import { TYPE47_SLOT } from "../../src/game/class41/type47_slots";

type Json = any;

/**
 * The placements that carry the one slot their update draws, and the update
 * that draws it. The stage draws none of these on its own (`L54`), so a slot
 * missing here is an object that is simply not there.
 */
const SLOT_DOORS: Readonly<Record<string, string>> = {
  rising_door: "RisingDoorUpdate",
  rise_to_height: "RiseToHeightUpdate",
  slide_on_flag: "SlideOnFlagUpdate",
  flag_lifted: "FlagLiftedPropUpdate",
  story_switch: "StoryModeSwitchUpdate",
};

const ROOT = repoRoot();

/**
 * `web/src/hod2lib/bundle.ts` is the only writer of a bundle, so the tables
 * are read out of it rather than copied here. A copy would be a second source
 * for a fact the exporter already states, and it would rot -- which is exactly
 * the failure this file is about, one level up.
 */
const BUNDLE_TS = join(ROOT, "web", "src", "hod2lib", "bundle.ts");
const CLASS41 = join(ROOT, "web", "src", "game", "class41");
const TYPE40_TS = join(CLASS41, "type40.ts");
const TABLE_TS: Readonly<Record<string, string>> = {
  table38: join(CLASS41, "type38.ts"),
  table39: join(CLASS41, "type38.ts"),
  table44: join(CLASS41, "type44.ts"),
};

/** A table this check cannot read is a failure of the check, never a pass. */
function die(msg: string): never {
  console.error(msg);
  process.exit(1);
}

const texts = new Map<string, string>();
function text(path: string): string {
  let t = texts.get(path);
  if (t === undefined) {
    t = readFileSync(path, "utf8").replace(/\r\n?/g, "\n");
    texts.set(path, t);
  }
  return t;
}

/** An integer literal -- decimal, `0x`, `0o` or `0b`, `_` separators allowed -- or a failure. */
function intLiteral(s: string, where: string): number {
  const t = s.trim();
  const m = /^([+-]?)(?:0[xX]_?([0-9a-fA-F]+(?:_[0-9a-fA-F]+)*)|0[oO]_?([0-7]+(?:_[0-7]+)*)|0[bB]_?([01]+(?:_[01]+)*)|([1-9][0-9]*(?:_[0-9]+)*|0+(?:_0+)*))$/.exec(t);
  if (!m) die(`${where}: ${JSON.stringify(t)} is not an integer literal`);
  const [, sign, hx, oc, bi, de] = m;
  const v = hx !== undefined ? Number.parseInt(hx.replace(/_/g, ""), 16)
    : oc !== undefined ? Number.parseInt(oc.replace(/_/g, ""), 8)
    : bi !== undefined ? Number.parseInt(bi.replace(/_/g, ""), 2)
    : Number.parseInt(de!.replace(/_/g, ""), 10);
  return sign === "-" ? -v : v;
}

/** One `<name> = [...]` in the exporter, read and not copied. */
function intList(name: string): number[] {
  const m = new RegExp(`${name}\\s*=\\s*\\[([^\\]]*)\\]`).exec(text(BUNDLE_TS));
  if (!m) die(`${BUNDLE_TS}: ${name} not found`);
  return m[1]!.replace(/\n/g, " ").split(",").filter((x) => x.trim())
    .map((x) => intLiteral(x, `${BUNDLE_TS}: ${name}`));
}

/** One `export const <name> = <int>;` out of `path`. */
function intConst(path: string, name: string): number {
  const m = new RegExp(`export const ${name}\\s*=\\s*(0x[0-9a-fA-F]+|\\d+);`).exec(text(path));
  if (!m) die(`${path}: ${name} not found`);
  return intLiteral(m[1]!, `${path}: ${name}`);
}

/** Memoised, so a table is read -- and required -- only once something asks. */
function once<T>(f: () => T): () => T {
  let v: { value: T } | null = null;
  return () => (v ??= { value: f() }).value;
}

const descriptorSlotTypes = once(() => new Set(intList("GENERIC_DESCRIPTOR_SLOT")));
const stripTypes = once(() => new Set(intList("GENERIC_SLOT_STRIP")));
const collectibleTypes = once(() => new Set(intList("ORIGINAL_ITEM_TYPES")));
const rowZeroTypes = once(() => new Set(intList("ORIGINAL_ITEM_ROW_ZERO_TYPES")));
const pickupFrames = once(() => intConst(BUNDLE_TS, "ORIGINAL_ITEM_PICKUP_FRAMES"));
const pickupStrips = once(() => [...new Set(intList("ORIGINAL_ITEM_PICKUP_STRIPS"))]
  .sort((a, b) => a - b));

/**
 * `STORY_ITEM_ROW_BY_TYPE`, read out of the exporter: the rows types 74 and 75
 * hand `SpawnStoryModeItem` from an immediate of their own.
 */
const storyItemRows = once((): Map<number, number> => {
  const m = /STORY_ITEM_ROW_BY_TYPE[^{]*\{([^}]*)\}/.exec(text(BUNDLE_TS));
  if (!m) die(`${BUNDLE_TS}: STORY_ITEM_ROW_BY_TYPE not found`);
  const out = new Map<number, number>();
  for (const [, k, v] of m[1]!.matchAll(/(\d+)\s*:\s*(0x[0-9a-fA-F]+|\d+)/g)) {
    out.set(Number.parseInt(k!, 10), intLiteral(v!, `${BUNDLE_TS}: STORY_ITEM_ROW_BY_TYPE`));
  }
  return out;
});

/** One generated run, `Array.from({ length: N }, (_, i) => 0xBASE + i)`. */
const RUN = /^(?:Array\.from\(\{\s*length:\s*(\d+)\s*\}[^)]*\)\s*=>\s*(0x[0-9a-fA-F]+|\d+)\s*\+\s*i\s*\))$/;

function run(s: string): number[] | null {
  const m = RUN.exec(s.trim());
  if (!m) return null;
  const base = intLiteral(m[2]!, `${BUNDLE_TS}: GENERIC_STATIC_SLOTS`);
  return Array.from({ length: Number.parseInt(m[1]!, 10) }, (_, i) => base + i);
}

/** `text` split into lines, with no empty last line for a final line break. */
const LINE_BREAK = new RegExp("\\r\\n|[\\n\\r\\v\\f\\x1c-\\x1e\\x85\\u2028\\u2029]");
function splitLines(s: string): string[] {
  const out = s.split(LINE_BREAK);
  if (out[out.length - 1] === "") out.pop();
  return out;
}

/**
 * `GENERIC_STATIC_SLOTS`, read out of the exporter.
 *
 * A row is a list of literals, a generated run (`Array.from`), or a list that
 * spreads runs among its literals; every run is expanded rather than skipped,
 * because a routine that steps through ten slots needs all ten. An element
 * this cannot read fails the check rather than being dropped: a row read short
 * is a slot nobody checks.
 */
const staticSlots = once((): Map<number, number[]> => {
  const m = /GENERIC_STATIC_SLOTS[^{]*\{([\s\S]*?)\n\};/.exec(text(BUNDLE_TS));
  if (!m) die(`${BUNDLE_TS}: GENERIC_STATIC_SLOTS not found`);
  const body = splitLines(m[1]!).map((line) => line.split("//")[0]).join("\n");
  const out = new Map<number, number[]>();
  const entry = /(\d+):\s*(\[[^\]]*\]|Array\.from\([^\n]*?=>[^,\n]*\+\s*i\s*\))/g;
  for (const e of body.matchAll(entry)) {
    const key = Number.parseInt(e[1]!, 10);
    const row = e[2]!.trim();
    const whole = run(row);
    if (whole !== null) {
      out.set(key, whole);
      continue;
    }
    const slots: number[] = [];
    const parts: string[] = [];
    let depth = 0;
    let cur = "";
    for (const ch of row.slice(1, -1)) {
      if (ch === "(" || ch === "{") depth++;
      if (ch === ")" || ch === "}") depth--;
      if (ch === "," && depth === 0) {
        parts.push(cur);
        cur = "";
      } else {
        cur += ch;
      }
    }
    parts.push(cur);
    for (const part of parts.map((x) => x.trim())) {
      if (!part) continue;
      if (part.startsWith("...")) {
        const spread = run(part.slice(3));
        if (spread === null) {
          die(`${BUNDLE_TS}: GENERIC_STATIC_SLOTS[${key}] spreads something unreadable: ${part}`);
        }
        slots.push(...spread);
      } else {
        slots.push(intLiteral(part, `${BUNDLE_TS}: GENERIC_STATIC_SLOTS[${key}]`));
      }
    }
    out.set(key, slots);
  }
  return out;
});

/**
 * `export const NAME ... = <literal>;` as a value.
 *
 * Only numbers, `-`, hex, `Math.fround(x)` (whose value is `x`), brackets,
 * braces with numeric keys, and commas are expected; anything else fails.
 */
function tsLiteral(path: string, name: string): Json {
  const t = text(path);
  const m = new RegExp(`export const ${name}\\b[^=]*=\\s*`).exec(t);
  if (!m) die(`${path}: ${name} not found`);
  const i = m.index + m[0].length;
  let depth = 0;
  let j = i;
  for (; j < t.length; j++) {
    const c = t[j]!;
    if (c === "[" || c === "{" || c === "(") depth++;
    else if (c === "]" || c === "}" || c === ")") depth--;
    else if (c === ";" && depth === 0) break;
  }
  const body = t.slice(i, j).replace(/\/\/[^\n]*/g, "")
    .replace(/Math\.fround\(([^()]*)\)/g, "$1");
  if (!/^[\s\d.\-+xXa-fA-F,[\]{}:e]*$/.test(body)) {
    die(`${path}: ${name} is not a plain numeric literal`);
  }
  // Safe to evaluate: the test above admits numbers, brackets and punctuation only.
  return new Function(`"use strict"; return (${body});`)();
}

type Want = [slot: number, why: string];

/** A JSON scalar as the messages spell it: `None` for a missing value. */
function py(v: unknown): string {
  if (v === undefined || v === null) return "None";
  if (v === true) return "True";
  if (v === false) return "False";
  return String(v);
}

/** `obj[key]` for a JSON object, never reaching its prototype. */
function own(obj: Json, key: string): Json {
  return obj && typeof obj === "object" && Object.hasOwn(obj, key) ? obj[key] : undefined;
}

const hex4 = (v: number): string => v.toString(16).padStart(4, "0");

/**
 * Every model a type-70, 71 or 72 placement can draw.
 *
 * `PickOriginalModeItem` (`FUN_004629C0`) writes the chosen item's model over
 * `obj+0x28C`, so what the prop asks for is not the descriptor's word but both
 * models of every id its row can draw -- read out of the bundle's own
 * `original_items`, which is what the port picks from -- and the two pickup
 * strips `obj+0x2A4 - 1 + obj+0x2A0` walks when it is taken. A row or a record
 * the bundle does not carry is reported as slot -1: an item the port cannot
 * pick is a gap in its own right.
 */
function originalItemSlots(breakables: Json, pl: Json, who: string | null = null): Want[] {
  const orig = breakables.original_items || {};
  const row = own(orig.rows || {}, String(pl.field_1f4 || 0));
  const out: Want[] = [];
  if (row === undefined || row === null) {
    out.push([-1, `${who || `type ${py(pl.type)}`}'s item row ${py(pl.field_1f4)}`]);
    return out;
  }
  const recs = orig.records || {};
  for (const item of row.ids) {
    if (item < 0) continue;
    const rec = own(recs, String(item));
    if (rec === undefined || rec === null) {
      out.push([-1, `item ${item}'s record`]);
      continue;
    }
    for (const key of ["slot", "slot2"]) {
      if (rec[key] !== 0 && rec[key] !== 0xffff) out.push([rec[key], `item ${item}'s ${key}`]);
    }
  }
  const frames = pickupFrames();
  for (const base of pickupStrips()) {
    for (let i = 0; i < frames; i++) {
      out.push([base + i, `frame ${i} of the pickup strip at 0x${hex4(base)}`]);
    }
  }
  return out;
}

/**
 * What a group member's or a falling container's story item can draw.
 *
 * In Original Mode its destroy path hands `SpawnStoryModeItem`
 * (`FUN_00467B90`) its `+0x2A0`, and that makes a collectible out of the row
 * it names. Only a row the bundle carries is asked about here; a member naming
 * a row the bundle does not carry is reported like a collectible's.
 */
function storyItemSlots(breakables: Json, pl: Json): Want[] {
  const rows: Json[] = [];
  const storyItem = (o: Json): Json => (Object.hasOwn(o, "story_item") ? o.story_item : -1);
  if (pl.container === "falling") {
    rows.push(storyItem(pl));
  } else {
    const groups = breakables.groups || [];
    let g = pl.group;
    if (typeof g === "boolean") g = Number(g);
    if (Number.isInteger(g) && g >= 0 && g < groups.length) {
      for (const m of groups[g]) rows.push(storyItem(m));
    }
  }
  const out: Want[] = [];
  for (const row of rows) {
    if (row === null || row < 0) continue;
    out.push(...originalItemSlots(breakables, { field_1f4: row }, "a story item"));
  }
  return out;
}

/**
 * Every slot `PropUpdateType40` can draw for one sub-kind, out of the port's
 * own tables in `game/class41/type40.ts`: the starting slot, the one a hit
 * swaps to, sub-kind 9's second model, and the forty burst pieces.
 */
function fragmentSlots(subKind: number): Want[] {
  const m = /export const FRAGMENT_SLOTS = \[([^\]]*)\]/.exec(text(TYPE40_TS));
  if (!m) die(`${TYPE40_TS}: FRAGMENT_SLOTS not found`);
  const table = m[1]!.replace(/\n/g, " ").split(",").filter((x) => x.trim())
    .map((x) => intLiteral(x, `${TYPE40_TS}: FRAGMENT_SLOTS`));
  let base: number[];
  if (subKind === 0) {
    base = [intConst(TYPE40_TS, "FRAGMENT_SUBKIND0_SLOT"),
            intConst(TYPE40_TS, "FRAGMENT_SUBKIND0_SLOT_HIT")];
  } else if (subKind === 1) {
    base = [intConst(TYPE40_TS, "FRAGMENT_SUBKIND1_SLOT"),
            intConst(TYPE40_TS, "FRAGMENT_SUBKIND1_SLOT_TAKEN")];
  } else {
    const b = subKind < table.length ? table.at(subKind) ?? 0 : 0;
    base = b ? [b, b + 1] : [];
    if (b && subKind === 9) {
      const extra = intConst(TYPE40_TS, "FRAGMENT_SUBKIND9_EXTRA_SLOT");
      base.push(b + extra, b + 1 + extra);
    }
  }
  const out: Want[] = base.map((x) => [x, `type 40 sub-kind ${subKind}'s own model`]);
  const first = intConst(TYPE40_TS, "FRAGMENT_BURST_SLOT");
  const n = intConst(TYPE40_TS, "FRAGMENT_BURST_PIECES");
  for (let i = 0; i < n; i++) out.push([first + i, "a type 40 burst piece"]);
  return out;
}

/**
 * The slots constructor 50's or 66's objects draw, out of the port's own
 * literal rows in `game/class41/type50.ts` / `type66.ts` -- the first word of
 * every row of the table the placement's `+0x1F4` picks, the way
 * `PlaceTable50Props` and `PlaceTable66Props` pick it.
 */
function rowTableSlots(kind: string, index: number): Want[] {
  let rows: Json[];
  if (kind === "table50") {
    const tables = tsLiteral(join(CLASS41, "type50.ts"), "PROP_TABLE50");
    rows = index >= 0 && index < tables.length ? tables[index] : [];
  } else {
    rows = tsLiteral(join(CLASS41, "type66.ts"), index > 0 ? "PROP_TABLE66_B" : "PROP_TABLE66_A");
  }
  return rows.map((row: number[], i: number): Want =>
    [row[0]! & 0xffff, `${kind} table ${index} row ${i}'s model`]);
}

/** The literals the three table constructors' routines draw. */
function tableSlots(kind: string): Want[] {
  const names: Readonly<Record<string, string[]>> = {
    table38: ["TYPE38_SLOT", "TYPE38_SLOT_HIT"],
    table39: ["TYPE38_SLOT"],
    table44: ["TYPE44_WHOLE_SLOT", "TYPE44_SHADOW_SLOT"],
  };
  return names[kind]!.map((n): Want => [intConst(TABLE_TS[kind]!, n), `${kind}'s ${n}`]);
}

/** The JSON chunk of a `.glb`. */
function glbJson(path: string): Json {
  const b = readFileSync(path);
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  for (let off = 12; off < b.length;) {
    const len = v.getUint32(off, true);
    if (v.getUint32(off + 4, true) === 0x4e4f534a) {           // 'JSON'
      return JSON.parse(new TextDecoder().decode(b.subarray(off + 8, off + 8 + len)));
    }
    off += 8 + len;
  }
  die(`${path}: no JSON chunk`);
}

/**
 * The asset slots `render/breakables.ts` can clone a model from.
 *
 * `BreakableLayer` harvests the `slots_breakable_*_slot_<hex>` nodes out of
 * the hidden template rig and clones by slot; a slot with no such node draws
 * nothing at all.
 */
function breakableSlots(gltf: Json): Set<number> {
  const out = new Set<number>();
  for (const n of gltf.nodes ?? []) {
    const m = /_slot_([0-9a-f]{4})$/.exec(n.name || "");
    if (m) out.add(Number.parseInt(m[1]!, 16));
  }
  return out;
}

const bundle = argValue("bundle") ?? BUNDLE_ROOT;
const manifest = join(bundle, "manifest.json");
if (!existsSync(manifest)) {
  console.log(`SKIP  prop_slots: no bundle at ${bundle}`);
  console.log("      build one with `cd web && npm run export -- --game-dir ...`,"
              + " or point HOTD2_BUNDLE at one");
  process.exit(EXIT_SKIPPED);
}

const c = new Checker("prop_slots");
const wantTypes = descriptorSlotTypes();
const strips = stripTypes();
const literals = staticSlots();
const list = (s: Iterable<number>): string => `[${[...s].sort((a, b) => a - b).join(", ")}]`;
c.note(`descriptor-slot types: ${list(wantTypes)}  (strips: ${list(strips)})`);
c.note(`literal draw lists: ${literals.size} types, `
       + `${[...literals.values()].reduce((n, v) => n + v.length, 0)} slots`);

let checked = 0;
let items = 0;
let doors = 0;
let bodies = 0;
let frames = 0;
let stages = 0;
for (const entry of JSON.parse(readFileSync(manifest, "utf8")).stages) {
  const name: string = entry.name;
  const script = join(bundle, name, entry.script);
  const glb = join(bundle, name, entry.geometry);
  if (!existsSync(script) || !existsSync(glb)) {
    c.fail(`${name}: the manifest names files that are not there`);
    continue;
  }
  stages++;
  const have = breakableSlots(glbJson(glb));
  const breakables = JSON.parse(readFileSync(script, "utf8")).breakables ?? {};
  const placements: Json[] = breakables.placements ?? [];
  const collectibles = collectibleTypes();
  const rowZero = rowZeroTypes();
  const storyRows = storyItemRows();

  const bad: string[] = [];
  let here = 0;
  for (const pl of placements) {
    const kind = pl.container;
    const want: Want[] = [];
    if (kind === "flicker_light") {
      // Class 0x41 type 48: the whole, broken and debris models
      // PropUpdateType48FlickerLight draws, carried on the placement.
      for (const slot of pl.slots || []) want.push([slot, "a model PropUpdateType48FlickerLight draws"]);
    }
    if (Object.hasOwn(SLOT_DOORS, kind)) {
      const slot = pl.slot || 0;
      if (slot) {
        want.push([slot, `the model ${SLOT_DOORS[kind]} draws`]);
        doors++;
      }
      if (kind === "slide_on_flag" && slot === SLIDE_SECOND_DRAW_SLOT) {
        want.push([SLIDE_SECOND_SLOT, "the second model SlideOnFlagUpdate draws for 0x189C"]);
      }
    } else if (kind === "type47") {
      want.push([TYPE47_SLOT, "the model PropUpdateType47 draws"]);
    } else if (kind === "generic") {
      const ty = pl.type;
      if (wantTypes.has(ty)) {
        const slot = pl.slot || 0;
        // A strip type draws `slot .. slot + roll` inclusive, one frame a
        // tick; every frame is a slot it will really ask for. See
        // `GENERIC_SLOT_STRIP`.
        const span = strips.has(ty) ? Math.max(0, pl.roll || 0) : 0;
        if (slot) {
          for (let i = 0; i <= span; i++) {
            let why = `type ${ty}'s descriptor slot`;
            if (span) why += ` + ${i} of its ${span + 1}-frame strip`;
            want.push([slot + i, why]);
          }
          bodies++;
          frames += span;
        }
      }
      for (const lit of literals.get(ty) ?? []) want.push([lit, `a literal type ${ty} draws`]);
      if (collectibles.has(ty)) {
        want.push(...originalItemSlots(breakables, pl));
        items++;
      }
      if (rowZero.has(ty)) {
        // Type 7's drop and type 43's break pick from row 0.
        want.push(...originalItemSlots(breakables, { field_1f4: 0 }, `type ${ty}'s drop`));
      }
      if (storyRows.has(ty)) {
        want.push(...originalItemSlots(breakables, { field_1f4: storyRows.get(ty) },
                                       `type ${ty}'s story item`));
      }
    } else if (kind === "fragment") {
      want.push(...fragmentSlots(pl.sub_kind || 0));
    } else if (typeof kind === "string" && Object.hasOwn(TABLE_TS, kind)) {
      want.push(...tableSlots(kind));
    } else if (kind === "table50" || kind === "table66") {
      want.push(...rowTableSlots(kind, pl.field_1f4 || 0));
    }
    if (kind === "group" || kind === "falling") want.push(...storyItemSlots(breakables, pl));
    for (const [slot, why] of want) {
      here++;
      if (slot < 0) {
        bad.push(`${name}: prop at ${py(pl.at)} (${py(kind)}) needs ${why}, and the bundle `
                 + "does not carry it");
      } else if (!have.has(slot)) {
        bad.push(`${name}: prop at ${py(pl.at)} (${py(kind)}) names slot 0x${hex4(slot)} -- `
                 + `${why} -- and the glTF has no \`_slot_${hex4(slot)}\` node, so it draws nothing`);
      }
    }
  }
  checked += here;
  if (!bad.length) {
    c.ok(true, `${name}: all ${here} prop draw slots have a model in the bundle`);
  }
  for (const line of bad) c.fail(line);
}

if (!stages) {
  console.log("SKIP  prop_slots: the manifest names no stages");
  c.finish();
}
c.note(`${stages} bundles: ${checked} prop draw slots checked (${doors} class-0x44 doors, `
       + `${bodies} descriptor-slot props, ${frames} extra strip frames, `
       + `${items} Original Mode collectibles)`);
c.finish();
