/**
 * The class-0x42 worm against the EXE it is read from.
 *
 *     node tools/run_ts.mjs tools/checks/worm.ts --game-dir ~/"THE HOUSE OF THE DEAD 2"
 *
 * `game/class42/` transcribes `PlaceWormBatch` (`FUN_0042F9B0`), `WormUpdate`
 * (`FUN_0042FCA0`), `WormDeathUpdate` (`FUN_00430C80`) and
 * `WormLoneDropUpdate` (`FUN_00431000`) with every scalar they load spelled
 * as a named constant, and the exporter carries their tables. What only this
 * can see:
 *
 *  * **every float the port names is the `.rdata` word its instruction
 *    loads**, and every immediate is the operand in the instruction's own
 *    bytes -- the counts, the pitch, the radii, the steps, the frame limits
 *    and the damage kind -- so a slip in one digit fails here rather than as
 *    a worm that lands a little high;
 *  * **the member routine's jump table has seven arms**, each the address the
 *    port's `switch` transcribes;
 *  * **the sounds are the port's names for them**: `WORM_TUBU1/2_44.wav` on
 *    the kill, `PDMG_MORR1/2_44.wav` in both stage banks on the landing;
 *  * **`0x85A..0x88F` are `buyo.bin` 0..53**, the run the class draws;
 *  * **the three descriptors are sub-types 1, 0 and 2**, one each, in both
 *    of stage 2's scenes, and no other stage places the class;
 *  * and, with a bundle, **the shadow is black**: `buyo.bin` 1 is untextured
 *    with base colour `(0, 0, 0)`, which is why the port draws it with the
 *    ordinary faded draw where block `0x1A` hands it to the scene light
 *    array -- every light set multiplies that colour.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gameDirOrSkip, openGame, Checker, hex } from "../lib/exe_check";
import { BUNDLE_ROOT } from "../lib/bundle_root";
import { ExeTables } from "../../src/hod2lib/exetab";
import * as evt from "../../src/hod2lib/evt";
import * as W from "../../src/game/class42/index";

/** `[addr, expected bytes, what]` -- an instruction, operands and all. */
const INSTRUCTIONS: [number, string, string][] = [
  [0x0042f9d0, "83e3fe83c308", "sub-type 0: AND EBX, -2; ADD EBX, 8 -- six, or eight"],
  [0x0042f9ef, "24fb83c00f", "sub-type 2: AND AL, 0xFB; ADD EAX, 0xF -- ten, or fifteen"],
  [0x0042fa55, "c78624010000" + "00004040", "the lone drop's radius, 3.0"],
  [0x0042fb21, "c7466400400000", "a member's pitch, 0x4000"],
  [0x0042fb5d, "c78624010000" + "cdcc0c40", "a member's radius, 2.2"],
  [0x0042fb74, "b93c000000", "rand() % 0x3C"],
  [0x0042fba0, "0500780000", "the orbit bias, 0x7800"],
  [0x0042ff17, "83c080", "the orbit step, -0x80"],
  [0x004301ca, "83f818", "the splat's last frame, 0x18"],
  [0x004301d3, "66c786e80100000800", "the crawl's first row, 8"],
  [0x00430216, "83f83b", "the crawl's rows, 0x3B"],
  [0x004303c2, "81c700080000", "the wobble's step, 0x800"],
  [0x00430514, "83f80a", "the swell, ten frames"],
  [0x00430652, "83f91f", "the leap's path from row 0x20"],
  [0x0043072e, "6683bee80100003a", "the leap's pitch to row 0x3A"],
  [0x00430816, "663d3c00", "the leap's sixty frames"],
  [0x0043084d, "6a09", "PlayerTakeDamage's kind, 9"],
  [0x00430922, "814664" + "00060000", "the bounce's tumble, 0x600"],
  [0x00430d44, "663d1500", "the death strip's last frame, 0x15"],
  [0x00430e6c, "663d3b00", "a half's last frame, 0x3B"],
  [0x00430e9e, "c7861c020000a1f8a9bf", "half 0's pull, -1.3279"],
  [0x00430fd9, "83f83c", "the death routine's life, 0x3C"],
];

async function main(): Promise<void> {
  const dir = gameDirOrSkip("worm");
  const { source, exe } = await openGame(dir);
  const raw = exe.data;
  const c = new Checker("worm");
  const at = (va: number): number => {
    const r = exe.v2r(va);
    if (r === null) throw new Error(`${hex(va, 8)} is not in a section`);
    return r;
  };
  const bytesAt = (va: number, n: number): string =>
    Array.from(raw.subarray(at(va), at(va) + n),
               (b) => b.toString(16).padStart(2, "0")).join("");
  const f32At = (va: number): number =>
    new DataView(raw.buffer, raw.byteOffset + at(va), 4).getFloat32(0, true);
  const f64At = (va: number): number =>
    new DataView(raw.buffer, raw.byteOffset + at(va), 8).getFloat64(0, true);

  // -- the `.rdata` scalars ------------------------------------------------
  const floats: [string, number, number][] = [
    ["WORM_OFFSET_UNIT", W.WORM_OFFSET_UNIT, 0x0055d230],
    ["WORM_COG_X", W.WORM_COG_X, 0x0055d7c8],
    ["WORM_COG_Z", W.WORM_COG_Z, 0x0055d7c4],
    ["WORM_ORBIT_RADIUS", W.WORM_ORBIT_RADIUS, 0x0055d2b4],
    ["WORM_FALL_GRAVITY", W.WORM_FALL_GRAVITY, 0x0055d7c0],
    ["WORM_LAND_Y", W.WORM_LAND_Y, 0x004c43a8],
    ["WORM_HUNDREDTH", W.WORM_HUNDREDTH, 0x004d5464],
    ["WORM_TEN_THOUSANDTH", W.WORM_TEN_THOUSANDTH, 0x0055d7b4],
    ["WORM_WOBBLE_AMP", W.WORM_WOBBLE_AMP, 0x004c43ac],
    ["WORM_WOBBLE_XZ", W.WORM_WOBBLE_XZ, 0x0055d7b0],
    ["WORM_WOBBLE_Y", W.WORM_WOBBLE_Y, 0x004c4380],
    ["WORM_WOBBLE_EASE", W.WORM_WOBBLE_EASE, 0x004c4c58],
    ["WORM_SWELL_RATE", W.WORM_SWELL_RATE, 0x0055d230],
    ["WORM_LEAP_EYE_LIFT", W.WORM_LEAP_EYE_LIFT, 0x004c4ca0],
    ["WORM_LEAP_RISE_SCALE", W.WORM_LEAP_RISE_SCALE, 0x0055d7a0],
    ["WORM_BOUNCE_XZ", W.WORM_BOUNCE_XZ, 0x0055d79c],
    ["WORM_BOUNCE_Y", W.WORM_BOUNCE_Y, 0x004c43a4],
    ["WORM_GRAVITY", W.WORM_GRAVITY, 0x0055cb10],
    ["WORM_SHOT_LIFT", W.WORM_SHOT_LIFT, 0x0055d7b0],
    ["WORM_SPLASH_STAGGER", W.WORM_SPLASH_STAGGER, 0x004c4cc0],
    ["WORM_SPLASH_LIFT", W.WORM_SPLASH_LIFT, 0x004c4380],
    ["WORM_SINK", W.WORM_SINK, 0x004c4cb0],
    ["WORM_HALF_SPLASH_STAGGER", W.WORM_HALF_SPLASH_STAGGER, 0x004e30e0],
    ["WORM_SINK_GRAVITY", W.WORM_SINK_GRAVITY, 0x0055d7d8],
    ["WORM_LONE_FLOOR", W.WORM_LONE_FLOOR, 0x0055ccd4],
  ];
  for (const [name, port, va] of floats) {
    c.ok(Math.fround(port) === f32At(va),
         `${name} is the float at ${hex(va, 8)}: ${port} vs ${f32At(va)}`);
  }
  const doubles: [string, number, number][] = [
    ["WORM_LAND_TEST", W.WORM_LAND_TEST, 0x0055d7b8],
    ["WORM_SIX_TENTHS", W.WORM_SIX_TENTHS, 0x004e3108],
    ["WORM_LEAP_REACH_SCALE", W.WORM_LEAP_REACH_SCALE, 0x0055d7a8],
    ["WORM_HALF_LAND", W.WORM_HALF_LAND, 0x0055d7d0],
  ];
  for (const [name, port, va] of doubles) {
    c.ok(port === f64At(va),
         `${name} is the double at ${hex(va, 8)}: ${port} vs ${f64At(va)}`);
  }
  // The crawl's two rates are immediates, `MOV dword ptr [ESP + 0x70], k`.
  c.eq(bytesAt(0x00430201, 8), "c7442470cdcc4c3f",
       "WORM_CRAWL_K_COG on the cog is the immediate 0x3F4CCCCD");
  c.eq(bytesAt(0x0043020e, 8), "c74424709a99993e",
       "WORM_CRAWL_K off the cog is the immediate 0x3E99999A");
  c.ok(Math.fround(W.WORM_CRAWL_K_COG) === Math.fround(0.8)
       && Math.fround(W.WORM_CRAWL_K) === Math.fround(0.3),
       `...which are ${W.WORM_CRAWL_K_COG} and ${W.WORM_CRAWL_K}`);
  c.ok(Math.fround(W.WORM_SINK_START) === f32At(0x00430e9e + 6),
       `WORM_SINK_START is the immediate 0xBFA9F8A1: ${W.WORM_SINK_START}`);

  // -- the immediates --------------------------------------------------------
  for (const [va, want, what] of INSTRUCTIONS) {
    c.eq(bytesAt(va, want.length / 2), want, `${hex(va, 8)}: ${what}`);
  }
  c.ok(W.WORM_COUNT_ON_COG_1P === 6 && W.WORM_COUNT_ON_COG_2P === 8
       && W.WORM_COUNT_LARGE_1P === 10 && W.WORM_COUNT_LARGE_2P === 15,
       "...and the port's four counts are those");
  c.ok(W.WORM_START_PITCH === 0x4000 && W.WORM_FRAME_SEED_RANGE === 0x3c
       && W.WORM_ORBIT_BIAS === 0x7800 && W.WORM_ORBIT_STEP === 0x80
       && W.WORM_SPLAT_LAST === 0x18 && W.WORM_CRAWL_FIRST_ROW === 8
       && W.WORM_CRAWL_ROWS === 0x3b && W.WORM_WOBBLE_STEP === 0x800
       && W.WORM_SWELL_FRAMES === 0xa && W.WORM_LEAP_PATH_FIRST === 0x20
       && W.WORM_LEAP_PITCH_LAST === 0x3a && W.WORM_LEAP_FRAMES === 0x3c
       && W.WORM_DAMAGE_KIND === 9 && W.WORM_BOUNCE_TUMBLE === 0x600
       && W.WORM_DEATH_LAST === 0x15 && W.WORM_HALF_LAST === 0x3b
       && W.WORM_DEATH_LIFE === 0x3c,
       "...and so are the port's other immediates");
  c.ok(Math.fround(W.WORM_HIT_RADIUS) === Math.fround(2.2)
       && W.WORM_LONE_HIT_RADIUS === 3.0, "...and the two radii");

  // -- the jump table ----------------------------------------------------------
  const arms = Array.from({ length: 7 }, (_, i) => exe.ru32(0x00430b68 + 4 * i));
  c.eq(arms.map((a) => hex(a ?? 0, 8)).join(","),
       "0x0042FF03,0x0042FFA5,0x004301BB,0x004301EE,0x004303BC,0x0043064B,0x00430916",
       "WormUpdate's jump table: seven arms, perch to bounce");
  c.eq(bytesAt(0x0042fef3, 3), "83f806", "...bounded by CMP EAX, 6");

  // -- the sounds --------------------------------------------------------------
  const sounds: [number, string, string][] = [
    [W.SND_WORM_KILLED_A, "STAGE2_SE\\WORM_TUBU1_44.wav", "SND_WORM_KILLED_A"],
    [W.SND_WORM_KILLED_B, "STAGE2_SE\\WORM_TUBU2_44.wav", "SND_WORM_KILLED_B"],
    [W.SND_WORM_LAND_S1_A, "STAGE1_SE\\PDMG_MORR1_44.wav", "SND_WORM_LAND_S1_A"],
    [W.SND_WORM_LAND_S1_B, "STAGE1_SE\\PDMG_MORR2_44.wav", "SND_WORM_LAND_S1_B"],
    [W.SND_WORM_LAND_A, "STAGE2_SE\\PDMG_MORR1_44.wav", "SND_WORM_LAND_A"],
    [W.SND_WORM_LAND_B, "STAGE2_SE\\PDMG_MORR2_44.wav", "SND_WORM_LAND_B"],
  ];
  for (const [sid, name, port] of sounds) {
    c.eq(exe.soundName(sid), name, `${port}, sound ${hex(sid)}, is ${name}`);
  }
  c.eq(bytesAt(0x0042fd0e, 5) + bytesAt(0x0042fd15, 5), "68a919360068a9193700",
       "...and the kill pushes 0x3619A9 on an odd draw, 0x3719A9 on an even");

  // -- the models --------------------------------------------------------------
  const slots = exe.assetSlots();
  const bad: string[] = [];
  for (let s = 0x85a; s <= 0x88f; s++) {
    const r = slots.get(s);
    if (r?.[0] !== "buyo.bin" || r[1] !== s - 0x85a) bad.push(hex(s));
  }
  c.ok(bad.length === 0, `0x85A..0x88F are buyo.bin 0..53`
       + (bad.length ? `: not ${bad.join(", ")}` : ""));

  // -- the descriptors ---------------------------------------------------------
  const found: string[] = [];
  for (let sc = 0; sc <= ExeTables.LAST_STAGE_SCENE; sc++) {
    const name = exe.sceneEvtFile(sc);
    if (!name || !(await source.exists(`evt/${name}`))) continue;
    const f = evt.parse(await source.read(`evt/${name}`), name);
    for (const s of evt.spawns(f)) {
      if (s.cls !== 0x42) continue;
      found.push(`${name}:${hex(s.offset)}=${(f.raw[s.offset + 0x25]! << 24) >> 24}`);
    }
  }
  const byFile = new Map<string, number[]>();
  for (const x of found) {
    const [file, rest] = x.split(":");
    const sub = Number(rest!.split("=")[1]);
    byFile.set(file!, [...(byFile.get(file!) ?? []), sub]);
  }
  c.ok(byFile.size >= 1
       && [...byFile].every(([f, subs]) => f.startsWith("st2")
                            && subs.slice().sort().join(",") === "0,1,2"),
       `every class-0x42 descriptor is stage 2's, sub-types 1, 0 and 2 once `
       + `each: ${found.join("; ")}`);

  // -- the shadow, with a bundle ----------------------------------------------
  const glb = join(BUNDLE_ROOT, "stage2", "stage2.glb");
  if (!existsSync(glb)) {
    c.note(`no ${glb}: the shadow's material unchecked`);
  } else {
    const d = readFileSync(glb);
    const n = d.readUInt32LE(12);
    const g = JSON.parse(d.subarray(20, 20 + n).toString("utf8")) as {
      nodes: { name?: string; mesh?: number; children?: number[] }[];
      meshes: { primitives: { material?: number }[] }[];
      materials: { pbrMetallicRoughness?: { baseColorFactor?: number[];
                                            baseColorTexture?: unknown } }[];
    };
    const node = g.nodes.findIndex((x) => x.name?.endsWith("_slot_085b"));
    const mats: number[] = [];
    const walk = (i: number): void => {
      const nd = g.nodes[i]!;
      if (nd.mesh !== undefined) {
        for (const p of g.meshes[nd.mesh]!.primitives) mats.push(p.material ?? -1);
      }
      for (const ch of nd.children ?? []) walk(ch);
    };
    if (node >= 0) walk(node);
    const black = mats.length > 0 && mats.every((m) => {
      const pbr = g.materials[m]?.pbrMetallicRoughness;
      const col = pbr?.baseColorFactor ?? [1, 1, 1, 1];
      return !pbr?.baseColorTexture && col[0] === 0 && col[1] === 0
        && col[2] === 0;
    });
    c.ok(black, `the shadow, buyo.bin 1, is ${mats.length} untextured `
         + "primitive(s) of base colour black, so no light set changes it");
  }

  c.finish();
}

await main();
