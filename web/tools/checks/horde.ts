/**
 * The class-0x40 horde against the EXE it is read from.
 *
 *     node tools/run_ts.mjs tools/checks/horde.ts --game-dir ~/"THE HOUSE OF THE DEAD 2"
 *
 * `PlaceHorde` (`FUN_0043BD30`) builds its members from tables, not from the
 * descriptor: where each one walks in (`g_horde_formation`, 0x0055E200), how
 * fast (`g_horde_spline_rates`), when it may be shot (`g_horde_shot_delay`),
 * where it wanders (`g_horde_wander_origin` / `_cell`), and which skin it wears
 * (`g_submodel_bone_slots`, 0x004E1F88). The port carries all of them as
 * literals in `src/game/class40/tables.ts`, and the exporter carries the second
 * skin in `src/hod2lib/characters.ts`. What only this can see:
 *
 *  * **every number in those tables is the EXE's**, imported from the module
 *    the player runs and held against the image byte for byte, so a
 *    transcription slip -- a sign, a swapped pair -- is caught rather than
 *    showing up as one member walking a slightly wrong line. The exporter's
 *    `CLASS40_SKIN_SLOTS` is module-private, so it is read out of the source;
 *  * **the seven class-0x40 descriptors split five and two** on `desc+0x25`,
 *    the byte `PlaceHorde` switches on: five hordes, two props;
 *  * **character type 0x1D is `mol.bin`** with nine nodes, and the two skin
 *    rows are its even and odd parts -- row 0 the skeleton's own slots;
 *  * **the sounds are what the port says they are**: the port's
 *    `SND_HORDE_KILLED_S1/_S2` are `PDMG_MORR1/2_44.wav` in `STAGE1_SE` and
 *    `STAGE2_SE`, `SND_HORDE_SPLASH_S1/_S2` are `BOBBLE1_22.wav`, and
 *    `SND_EMERGE_PROP_HIT` is `BULLET_MET3_22.WAV`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gameDirOrSkip, openGame, Checker, hex } from "../lib/exe_check";
import { repoRoot } from "../lib/bundle_root";
import { ExeTables } from "../../src/hod2lib/exetab";
import { i8, u16, f32 } from "../../src/hod2lib/bytes";
import * as evt from "../../src/hod2lib/evt";
import {
  EMERGE_PROP_RIM_POINTS, HORDE_FORMATION, HORDE_SHOT_DELAY,
  HORDE_SPLINE_RATES, HORDE_WANDER_CELL, HORDE_WANDER_ORIGIN,
  SUBMODEL_BONE_SLOTS,
} from "../../src/game/class40/tables";
import { SND_HORDE_KILLED_S1, SND_HORDE_KILLED_S2 }
  from "../../src/game/class40/index";
import { SND_HORDE_SPLASH_S1, SND_HORDE_SPLASH_S2 }
  from "../../src/game/class40/splash";
import { SND_EMERGE_PROP_HIT } from "../../src/game/class40/emerge_prop";

const FORMATION = 0x0055e200;
const RATES = 0x0055e520;
const SHOT_DELAY = 0x0055e534;
const ORIGIN = 0x0055e568;
const CELL = 0x0055e574;
const BONE_SLOTS = 0x004e1f88;
const RIM = 0x00592688;

/** The character type `HordeMemberInit` writes: `mol.bin`. */
const MEMBER_CHAR_TYPE = 0x1d;

const CHARACTERS_TS = join(repoRoot(), "web", "src", "hod2lib", "characters.ts");

/** The first index at which two arrays differ, or -1. */
function firstDiff(a: readonly number[], b: readonly number[]): number {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return -1;
}

function near(a: readonly number[], b: readonly number[], tol: number): boolean {
  return a.length === b.length && a.every((x, i) => Math.abs(x - b[i]!) < tol);
}

async function main(): Promise<void> {
  const dir = gameDirOrSkip("horde");
  const { source, exe } = await openGame(dir);
  const raw = exe.data;
  const c = new Checker("horde");

  const at = (va: number): number => {
    const r = exe.v2r(va);
    if (r === null) throw new Error(`${hex(va, 8)} is not in a section`);
    return r;
  };
  const s8s = (va: number, n: number): number[] =>
    Array.from({ length: n }, (_, i) => i8(raw, at(va) + i));
  const f32s = (va: number, n: number): number[] =>
    Array.from({ length: n }, (_, i) => f32(raw, at(va) + 4 * i));

  // -- the tables ----------------------------------------------------------
  const formation = s8s(FORMATION, 800);
  const fd = firstDiff(HORDE_FORMATION, formation);
  c.ok(fd < 0, `HORDE_FORMATION is g_horde_formation's 400 points `
       + `(${HORDE_FORMATION.length} numbers`
       + (fd < 0 ? ")" : `, first difference at ${fd})`));
  const rates = f32s(RATES, 5);
  c.ok(near(HORDE_SPLINE_RATES, rates, 1e-6),
       `HORDE_SPLINE_RATES is g_horde_spline_rates: `
       + `${HORDE_SPLINE_RATES.join(", ")} vs ${rates.join(", ")}`);
  for (const [name, port, va, n] of [
    ["HORDE_SHOT_DELAY", HORDE_SHOT_DELAY, SHOT_DELAY, 50],
    ["HORDE_WANDER_ORIGIN", HORDE_WANDER_ORIGIN, ORIGIN, 10],
    ["HORDE_WANDER_CELL", HORDE_WANDER_CELL, CELL, 10],
  ] as const) {
    const want = s8s(va, n);
    const d = firstDiff(port, want);
    c.ok(d < 0, `${name} is ${name.toLowerCase().replace("horde_", "g_horde_")}`
         + (d < 0 ? "" : `: first difference at ${d}, `
            + `${port[d]} vs ${want[d]}`));
  }
  const rows = Array.from({ length: 20 },
                          (_, i) => u16(raw, at(BONE_SLOTS) + 2 * i));
  const portRows = SUBMODEL_BONE_SLOTS.flat();
  c.ok(firstDiff(portRows, rows) < 0,
       `SUBMODEL_BONE_SLOTS is g_submodel_bone_slots, two rows of ten: `
       + `${portRows.join(",")} vs ${rows.join(",")}`);
  const rim = f32s(RIM, 8);
  const portRim = EMERGE_PROP_RIM_POINTS.flat();
  c.ok(near(portRim, rim, 1e-5),
       `EMERGE_PROP_RIM_POINTS is g_emerge_prop_rim_points: ${portRim.join(", ")}`);
  // Module-private in the exporter, so read out of its source.
  const m = /CLASS40_SKIN_SLOTS = \[([^\]]*)\]/.exec(
    readFileSync(CHARACTERS_TS, "utf8"));
  const skin = m ? (m[1]!.match(/\d+/g) ?? []).map(Number) : [];
  c.ok(firstDiff(skin, rows.slice(11)) < 0,
       `the exporter's CLASS40_SKIN_SLOTS is row 1, bones 1..9: `
       + `${skin.join(",")} vs ${rows.slice(11).join(",")}`);

  // -- the character ---------------------------------------------------------
  const asset = exe.characterAssetFile(MEMBER_CHAR_TYPE);
  c.eq(asset, "mol.bin", `character type ${hex(MEMBER_CHAR_TYPE)} is mol.bin`);
  const skel = exe.characterSkeleton(MEMBER_CHAR_TYPE);
  const skelSlots = [...skel].sort((a, b) => a.bone - b.bone).map((n) => n.slot);
  c.ok(skel.length === 9 && firstDiff(skelSlots, rows.slice(1, 10)) < 0,
       `...with nine nodes whose slots are row 0: ${skelSlots.join(",")}`);
  const slots = exe.assetSlots();
  c.ok(rows.slice(11, 20).every((s) => slots.get(s)?.[0] === "mol.bin"),
       "...and row 1 is mol.bin's too");

  // -- the sounds ------------------------------------------------------------
  const sounds: [number, string, string][] = [
    [SND_HORDE_KILLED_S1[0], "STAGE1_SE\\PDMG_MORR2_44.wav", "SND_HORDE_KILLED_S1[0]"],
    [SND_HORDE_KILLED_S1[1], "STAGE1_SE\\PDMG_MORR1_44.wav", "SND_HORDE_KILLED_S1[1]"],
    [SND_HORDE_KILLED_S2[0], "STAGE2_SE\\PDMG_MORR2_44.wav", "SND_HORDE_KILLED_S2[0]"],
    [SND_HORDE_KILLED_S2[1], "STAGE2_SE\\PDMG_MORR1_44.wav", "SND_HORDE_KILLED_S2[1]"],
    [SND_HORDE_SPLASH_S1, "STAGE1_SE\\BOBBLE1_22.wav", "SND_HORDE_SPLASH_S1"],
    [SND_HORDE_SPLASH_S2, "STAGE2_SE\\BOBBLE1_22.wav", "SND_HORDE_SPLASH_S2"],
    [SND_EMERGE_PROP_HIT, "COMMON\\BULLET_MET3_22.WAV", "SND_EMERGE_PROP_HIT"],
  ];
  for (const [sid, name, port] of sounds) {
    c.eq(exe.soundName(sid), name, `${port}, sound ${hex(sid)}, is ${name}`);
  }
  // The four the kill plays, by id, so a port constant that moved to another
  // sound with the same name would still be caught.
  c.ok(firstDiff([...SND_HORDE_KILLED_S1, ...SND_HORDE_KILLED_S2],
                 [0x1e18a9, 0x1d18a9, 0x2119a9, 0x2019a9]) < 0,
       "...and the kill's four are 0x1E18A9, 0x1D18A9, 0x2119A9, 0x2019A9");

  // -- the descriptors -------------------------------------------------------
  const counts = new Map<number, number>();
  for (let sc = 0; sc <= ExeTables.LAST_STAGE_SCENE; sc++) {
    const name = exe.sceneEvtFile(sc);
    if (!name || !(await source.exists(`evt/${name}`))) continue;
    const f = evt.parse(await source.read(`evt/${name}`), name);
    for (const s of evt.spawns(f)) {
      if (s.cls !== 0x40) continue;
      const sel = f.raw[s.offset + 0x25]!;
      counts.set(sel, (counts.get(sel) ?? 0) + 1);
    }
  }
  c.ok(counts.get(1) === 5 && counts.get(2) === 2,
       `seven descriptors: five hordes and two props `
       + `(${[...counts].map(([k, v]) => `${k}: ${v}`).join(", ")})`);

  c.finish();
}

await main();
