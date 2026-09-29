/**
 * The result card -- the end of a stage -- against the exe.
 *
 *     node tools/run_ts.mjs tools/checks/result_card.ts --game-dir ~/"THE HOUSE OF THE DEAD 2"
 *
 * `ResultCardInstall` (0x00434EF0), its figures (0x004356A0 / 0x00435760 /
 * 0x004357F0), `ResultCardTally` (0x00435930) and the two number draws are read
 * in `docs/re/stage-end.md` and ported in `src/game/class61/`, `class62/`,
 * `rescue.ts` and `combat/accuracy.ts`. The port holds two kinds of number
 * from them -- the routines' immediates, as constants, and their `.rdata`,
 * through the bundle -- and a wrong one of either is a card that stands the
 * wrong people, awards the wrong life or never ends.
 *
 * What this asserts, and what only this can see:
 *
 * * **Every constant the port transcribes from the routines is the immediate
 *   at the instruction that holds it** -- the dwell, the bonus's dwell, the
 *   count's, the camera frame figure 0 turns on, the cursor it freezes on and
 *   the window it holds the life up in, the slot it holds, the bgm, the idle
 *   clips and the first tile -- read out of the instruction bytes, not typed
 *   in twice. Exported constants are imported, so the values checked are the
 *   ones the port runs; the module-private ones are read out of their source.
 * * **The `.rdata` spans the card reads with no bound are what the exporter
 *   writes**: `ExeTables.resultCardTables` is the exe's bytes, each scene's
 *   list ends inside the record span, each per-type attachment list ends
 *   within its three words, and every glyph the strings name is a
 *   `result.bin` model.
 * * **Every type a shipped script can rescue has an attachment list** -- the
 *   `[likely]` in `stage-end.md` section 4: the card indexes
 *   `g_result_figure_attachments` by the rescued type with no bound, so a
 *   rescuable civilian outside 0x20..0x37 would read past it. Checked over
 *   every stage's civilians, through the scripts they run.
 * * With a bundle (`HOTD2_BUNDLE` or `extract/player`): its `result_card`
 *   block is the exe's, and each stage that places the card carries a figure
 *   template for every type its list names and every type it can rescue, with
 *   the clips the card can put that type on baked. Without one, the rescuable
 *   types, the exported block and the templates are skipped and it says so;
 *   the rest still asserts.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Checker, gameDirOrSkip, hex, openGame } from "../lib/exe_check";
import { repoRoot, stageFile } from "../lib/bundle_root";
import { RESULT_CARD_BGM, RESULT_CARD_BONUS_AT, RESULT_CARD_FRAMES } from "../../src/game/class61/index";
import {
  RESULT_FIGURE_LIFE_CAM_FRAME, RESULT_FIGURE_LIFE_FREEZE_CURSOR, RESULT_FIGURE_LIFE_SHOWN_FROM,
  RESULT_FIGURE_LIFE_SHOWN_TO,
} from "../../src/game/class61/figure";
import {
  RESCUE_TARGET_CHAR_TYPE, RESULT_CARD_TILE_FIRST, RESULT_FIGURE_IDLE_MOTION_BASE,
  RESULT_FIGURE_LIFE_MOTION, RESULT_FIGURE_LIFE_SLOT,
} from "../../src/game/class61/state";

const SPAN_BASE = 0x0055dd80;
const SPAN_END = 0x0055e074;
const LISTS = 0x0055df50;
const RECORD = 0x14;
const ATTACHMENTS = 0x0055df68;
const LIFE_BONUS = 0x0055e044;
const TEMPLATE_BITS = 0x04000000 | 0x02000000;

const CLASS61 = join(repoRoot(), "web", "src", "game", "class61");

/** `const NAME = <integer>;` in a port source, for a constant it does not export. */
function portConst(file: string, name: string): number | null {
  const m = new RegExp(`\\bconst ${name}\\s*=\\s*(0x[0-9a-fA-F]+|\\d+)\\s*;`)
    .exec(readFileSync(join(CLASS61, file), "utf8"));
  return m ? Number(m[1]) : null;
}

function hexBytes(b: ArrayLike<number>): string {
  return Array.from(b, (x) => (x & 0xff).toString(16).padStart(2, "0")).join("");
}

/** `v` with every object's keys in order, so two JSON trees compare as text. */
function canon(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.keys(v).sort()
      .map((k) => [k, canon((v as Record<string, unknown>)[k])]));
  }
  return v;
}

const sameJson = (a: unknown, b: unknown): boolean =>
  JSON.stringify(canon(a)) === JSON.stringify(canon(b));

const gameDir = gameDirOrSkip("result_card");
const { exe } = await openGame(gameDir);
const c = new Checker("result_card");
const raw = exe.data;

const at = (va: number): number => {
  const r = exe.v2r(va);
  if (r === null) throw new Error(`${hex(va)} is not in the image`);
  return r;
};
const mem = (va: number, n: number): Uint8Array => raw.subarray(at(va), at(va) + n);
const s16 = (va: number): number => (exe.ru16(va)! << 16) >> 16;
const u32 = (va: number): number => exe.ru32(va)!;

// -- the immediates -------------------------------------------------------------
// [file, constant, the port's value, instruction address, the instruction's
// bytes up to the immediate, immediate width]
const imms: [string, string, number | null, number, string, number][] = [
  ["index.ts", "RESULT_CARD_FRAMES", RESULT_CARD_FRAMES, 0x00434fdc, "66c7851c010000", 2],
  ["index.ts", "RESULT_CARD_BONUS_AT", RESULT_CARD_BONUS_AT, 0x00435107, "6683bd1c010000", 1],
  ["index.ts", "RESULT_CARD_BGM", RESULT_CARD_BGM, 0x00434fba, "68", 4],
  ["index.ts", "RESCUED_COUNT_FROM", portConst("index.ts", "RESCUED_COUNT_FROM"),
   0x0043521f, "b9", 4],
  ["index.ts", "BONUS_TEXT_FROM", portConst("index.ts", "BONUS_TEXT_FROM"),
   0x004352a5, "6681bd1c010000", 2],
  ["index.ts", "BONUS_DIGIT_FROM", portConst("index.ts", "BONUS_DIGIT_FROM"),
   0x0043533a, "6681bd1c010000", 2],
  ["index.ts", "ACCURACY_SHOWN_FROM", portConst("index.ts", "ACCURACY_SHOWN_FROM"),
   0x00435521, "66833d845c9a00", 1],
  ["figure.ts", "RESULT_FIGURE_LIFE_CAM_FRAME", RESULT_FIGURE_LIFE_CAM_FRAME,
   0x0043578a, "813d10619a00", 4],
  ["figure.ts", "RESULT_FIGURE_LIFE_FREEZE_CURSOR", RESULT_FIGURE_LIFE_FREEZE_CURSOR,
   0x004357b1, "817f08", 4],
  ["figure.ts", "RESULT_FIGURE_LIFE_SHOWN_FROM", RESULT_FIGURE_LIFE_SHOWN_FROM, 0x004358b5, "83f8", 1],
  ["figure.ts", "RESULT_FIGURE_LIFE_SHOWN_TO", RESULT_FIGURE_LIFE_SHOWN_TO, 0x004358ba, "83f8", 1],
  ["figure.ts", "LIFE_FADE", portConst("figure.ts", "LIFE_FADE"), 0x00435796, "6a", 1],
  ["state.ts", "RESULT_FIGURE_LIFE_SLOT", RESULT_FIGURE_LIFE_SLOT, 0x004358ef, "68", 4],
  ["state.ts", "RESULT_FIGURE_LIFE_MOTION", RESULT_FIGURE_LIFE_MOTION, 0x0043579a, "68", 4],
  ["state.ts", "RESULT_FIGURE_IDLE_MOTION_BASE", RESULT_FIGURE_IDLE_MOTION_BASE,
   0x00435055, "81c2", 4],
  ["state.ts", "RESULT_CARD_TILE_FIRST", RESULT_CARD_TILE_FIRST, 0x00435118, "bb", 4],
  ["state.ts", "RESCUE_TARGET_CHAR_TYPE", RESCUE_TARGET_CHAR_TYPE, 0x00451b21,
   "66c70455c08e9c00", 2],
];
for (const [file, name, want, va, prefix, width] of imms) {
  const head = prefix.length / 2;
  const code = mem(va, head + width);
  const okPrefix = hexBytes(code.subarray(0, head)) === prefix;
  let imm = 0;
  for (let i = width - 1; i >= 0; i--) imm = imm * 256 + code[head + i]!;
  c.ok(want !== null && okPrefix && imm === want,
       `${file} ${name} = ${want === null ? "missing" : hex(want)} against the immediate at `
       + `${hex(va, 8)} (${hexBytes(code)})`);
}

// -- the .rdata -------------------------------------------------------------------
const rc = exe.resultCardTables() as {
  base: number; bytes: string; lists: number[]; accuracy_bonus: number[];
};
c.ok(rc.base === SPAN_BASE && rc.bytes.length === 2 * (SPAN_END - SPAN_BASE)
     && rc.bytes === hexBytes(mem(SPAN_BASE, SPAN_END - SPAN_BASE)),
     "resultCardTables' span is the exe's bytes");
const lists = Array.from({ length: 6 }, (_u, i) => u32(LISTS + i * 4));
c.ok(JSON.stringify(rc.lists) === JSON.stringify(lists),
     `the six list pointers: ${lists.map((l) => hex(l, 8)).join(", ")}`);
lists.forEach((lp, sc) => {
  const inside = SPAN_BASE <= lp && lp < LISTS;
  let end: number | null = null;
  if (inside) {
    for (let va = lp; va + RECORD <= LISTS; va += RECORD) {
      if (s16(va) === -1) { end = va; break; }
    }
  }
  c.ok(inside && end !== null,
       `scene ${sc}'s list at ${hex(lp, 8)} is a record run that ends with type -1 `
       + `before ${hex(LISTS, 8)}`);
});
// Ten records from each list -- `g_rescued_char_types`' ten a scene -- are
// inside the span the bundle carries, so every read the card makes for a
// scene's first ten rescues is the exe's bytes in the port too.
c.ok(lists.every((lp) => lp + 10 * RECORD <= SPAN_END),
     "ten records from every list are inside the exported span");
for (let ct = 0x20; ct < 0x38; ct++) {
  const va = ATTACHMENTS + (ct - 0x20) * 6;
  const words = [0, 1, 2].map((i) => s16(va + 2 * i));
  c.ok(words.includes(-1),
       `type ${hex(ct, 2)}'s attachment list ends in its three words: ${JSON.stringify(words)}`);
}
c.ok(ATTACHMENTS + 0x18 * 6 === 0x0055dff8,
     "the attachment table ends where the first glyph string starts");
const slots = exe.assetSlots();
for (const [name, va, n] of [
  ["rescued", 0x0055dff8, 9], ["life bonus", 0x0055e00c, 12],
  ["score", 0x0055e024, 7], ["accuracy", 0x0055e034, 8],
] as const) {
  const glyphs = Array.from({ length: n }, (_u, i) => exe.ru16(va + 2 * i)!);
  const bad = glyphs.filter((g) => g && slots.get(g)?.[0] !== "result.bin");
  c.ok(bad.length === 0,
       `the ${name} string's glyphs are result.bin models`
       + (bad.length ? `: not ${bad.map((g) => hex(g)).join(", ")}` : ""));
}
c.ok(slots.get(0x10c3)?.[0] === "common.bin",
     "slot 0x10C3, the life figure 0 holds up, is common.bin's");
const bonus = [...mem(LIFE_BONUS, 48)];
c.ok(bonus.every((v) => v <= 2)
     && JSON.stringify(bonus.slice(0, 8)) === JSON.stringify([0, 0, 0, 0, 0, 1, 1, 1]),
     `g_result_life_bonus: ${JSON.stringify(bonus)}`);
c.ok(JSON.stringify(rc.accuracy_bonus.slice(0, 11))
     === JSON.stringify([0, 0, 0, 0, 500, 1000, 1500, 2000, 2500, 3000, 4000])
     && rc.accuracy_bonus.length === (0x005679fc - 0x00567990) / 2,
     `g_accuracy_bonus_table: ${JSON.stringify(rc.accuracy_bonus.slice(0, 11))}`);

// -- every rescuable type has a list ---------------------------------------------
const scripts = exe.civilianScripts().scripts;

/** Whether civilian script `i`, or one it runs, rescues: op 0x2C with bit 28. */
function rescues(i: number | null | undefined, seen: Set<number>): boolean {
  if (i === null || i === undefined || i < 0 || i >= scripts.length || seen.has(i)) return false;
  seen.add(i);
  for (const op of scripts[i]!) {
    const a0 = op.args[0];
    if (op.op === 0x2c && a0 !== undefined && a0 !== null && (a0 & 0x10000000)) return true;
  }
  for (const op of scripts[i]!) {
    for (const sub of op.scripts ?? []) if (rescues(sub, seen)) return true;
  }
  return false;
}

interface StageScript {
  scene: number;
  civilians?: { entries?: number[]; spawns?: Record<string, { script: number; charType: number }> };
  characters: {
    placements: { at: number; class?: number; char_type?: number }[];
    types: Record<string, { motions?: Record<string, unknown> }>;
  };
  blocks: { hole?: boolean; steps: { ops: { simple?: { class?: number }[] }[] }[] }[];
  result_card?: unknown;
}

const stageFiles = Array.from({ length: 10 }, (_u, d) => stageFile(d, "script"))
  .filter((f) => existsSync(f));
if (!stageFiles.length) {
  c.note("no bundle: the rescuable types, the exported block and the figure templates unchecked");
}
const rescuable = new Set<number>();
for (const sf of stageFiles) {
  const name = sf.slice(sf.lastIndexOf("/") + 1);
  const j = JSON.parse(readFileSync(sf, "utf8")) as StageScript;
  const civ = j.civilians ?? {};
  const entries = civ.entries ?? [];
  const here = new Set<number>();
  for (const sp of Object.values(civ.spawns ?? {})) {
    const e = sp.script < entries.length ? entries[sp.script] : null;
    if (e !== null && e !== undefined && rescues(e, new Set())) here.add(sp.charType);
  }
  if (j.characters.placements.some((p) => p.class === 0x21)) here.add(0x36);
  for (const t of here) rescuable.add(t);
  c.ok(sameJson(j.result_card, rc), `${name}'s result_card block is the exe's`);
  const places = j.blocks.some((b) => !b.hole && b.steps.some((s) => s.ops.some(
    (o) => (o.simple ?? []).some((r) => r.class === 0x61))));
  if (!places) continue;
  const want: number[] = [];
  for (let va = lists[j.scene]!; va + RECORD <= LISTS && s16(va) !== -1; va += RECORD) {
    want.push(s16(va));
  }
  // Rescue `i` stands on record `i`'s clip (`+0x02`), figure 0 may turn to
  // 0x180, and with no rescue the list's own types lie on 0x18B + rand() % 3:
  // every type this stage can rescue needs the first set, every list type both.
  const placed = new Set(want.map((_t, i) => s16(lists[j.scene]! + i * RECORD + 2)));
  placed.add(0x180);
  const idle = [0x18b, 0x18c, 0x18d];
  const rows = new Map(j.characters.placements.map((p) => [p.at, p]));
  for (const t of [...new Set([...want, ...here])].sort((a, b) => a - b)) {
    const row = rows.get(TEMPLATE_BITS | t);
    const need = [...new Set([...placed, ...(want.includes(t) ? idle : [])])].sort((a, b) => a - b);
    const clips = new Set(Object.keys(j.characters.types[String(t)]?.motions ?? {}).map(Number));
    const missing = need.filter((m) => !clips.has(m));
    c.ok(row !== undefined && row.char_type === t && missing.length === 0,
         `${name}: the template for type ${hex(t, 2)} with `
         + need.map((m) => hex(m)).join(",") + " baked"
         + (row === undefined ? "  (no template row)" : "")
         + (missing.length ? `  (missing ${missing.map((m) => hex(m)).join(",")})` : ""));
  }
}
if (stageFiles.length) {
  const types = [...rescuable].sort((a, b) => a - b);
  c.ok(types.length > 0 && types.every((t) => t >= 0x20 && t <= 0x37),
       "every rescuable type is inside g_result_figure_attachments: "
       + types.map((t) => hex(t, 2)).join(","));
}

c.finish();
