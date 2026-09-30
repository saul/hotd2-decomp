/**
 * Original Mode against the exe: the `original_mode` block, the trunk, the
 * fresh profile's items and the stage-1 entry that reaches the trunk.
 *
 *     node tools/run_ts.mjs tools/checks/original_mode.ts --game-dir ~/"THE HOUSE OF THE DEAD 2"
 *
 * What this asserts, and what only this can see:
 *
 * * **The tables' extents are the exe's, not a guess.** Each is bounded by
 *   what follows it: the fifteen weapon records end where
 *   `g_original_weapon_gunshot_ids` begins (its entry 0 is 0 and entry 1 is
 *   `SHOT_GUN_22.wav`); fourteen fire-parameter rows end where
 *   `g_player_body_char_types` begins (0x39, 0x3A); and the fire modes the
 *   rows are indexed by are the immediates `OriginalItemsApply` stores, of
 *   which 0xD is the largest. The item categories run 0..12 and the pair
 *   table is 13 by 13.
 * * **The test fixture is the exe's** (`test/port/original_mode_fixture.ts`),
 *   field for field against `ExeTables.originalModeTables`, so a port test
 *   that leans on it leans on the install.
 * * **The trunk's immediates are at its instructions**: the class pair
 *   `{0x6E, 0x00488820}`, `ITEM_SELECT.wav`, the camera path, the lid's
 *   frames and sound, the two models and the trunk's matrix, each a byte
 *   pattern found inside `ItemSelectUpdate` (`0x00488820..0x004895BF`).
 * * **A failed profile load leaves items 3, 7 and 0x10**: the three `MOV
 *   [0x009C9F40/44/4D], DL` after the `REP STOSD` in `ProfileFactoryReset`.
 * * **Stage 1's block 0 is indexed as the exe indexes it**: the step table
 *   in `st1evtbl.bin` is `[com, 0x68, 0x6C, 0x394, -1, 0x954, -1]`, and the
 *   stream at 0x954 spawns class 0x6E.
 * * With a bundle, `stage1_original` carries the block, enters at step 5, has
 *   the trunk's spawn there, and ships every sprite the trunk draws; the
 *   arcade stage 1 enters at step 1.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Checker, f32Bits, gameDirOrSkip, hex, openGame } from "../lib/exe_check";
import { BUNDLE_ROOT } from "../lib/bundle_root";
import { ORIGINAL_MODE } from "../../test/port/original_mode_fixture";
import {
  ITEM_SELECT_BGM, ITEM_SELECT_CAM_LAST, ITEM_SELECT_CAM_PATH,
  ITEM_SELECT_LID_FRAME, ITEM_SELECT_LID_HINGE, ITEM_SELECT_LID_SLOT,
  ITEM_SELECT_SPRITES, ITEM_SELECT_TRUNK_AT, ITEM_SELECT_TRUNK_SLOT,
  ITEM_SELECT_TRUNK_YAW, ItemSelectSound,
} from "../../src/game/class6e/state";
import { OriginalItem } from "../../src/game/original_mode";

const ITEM_SELECT_UPDATE = 0x00488820;
const ITEM_SELECT_UPDATE_END = 0x004895c0;
const CLASS_PAIRS = 0x00593358;
const PROFILE_FACTORY_RESET = 0x00401060;
const PROFILE_ITEMS = 0x009c9f3d;

function le32(v: number): number[] {
  return [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
}
const pushF = (v: number): number[] => [0x68, ...le32(f32Bits(v))];
const pushI = (v: number): number[] => [0x68, ...le32(v)];

function findAll(hay: Uint8Array, needle: readonly number[]): number[] {
  const out: number[] = [];
  outer: for (let k = 0; k + needle.length <= hay.length; k++) {
    for (let j = 0; j < needle.length; j++) if (hay[k + j] !== needle[j]) continue outer;
    out.push(k);
  }
  return out;
}

async function main(): Promise<void> {
  const dir = gameDirOrSkip("original_mode");
  const { exe } = await openGame(dir);
  const c = new Checker("original_mode");
  const raw = exe.data;
  const at = (va: number): number => {
    const r = exe.v2r(va);
    if (r === null) throw new Error(`${hex(va)} is not in the image`);
    return r;
  };
  const mem = (va: number, n: number): Uint8Array => raw.subarray(at(va), at(va) + n);
  const t = exe.originalModeTables() as unknown as typeof ORIGINAL_MODE;

  // -- the tables' extents --------------------------------------------------
  c.ok(t.gunshot_ids[0] === 0
       && /SHOT_GUN_22/i.test(exe.soundName(t.gunshot_ids[1]) ?? ""),
       "g_original_weapon_gunshot_ids follows the fifteenth weapon record: "
       + `entry 0 is 0, entry 1 ${exe.soundName(t.gunshot_ids[1])}`);
  c.ok(exe.ri32(0x00579f50) === 0x39 && exe.ri32(0x00579f54) === 0x3a,
       "the fourteenth fire-parameter row ends at g_player_body_char_types "
       + "(0x00579F50: 0x39, 0x3A)");
  const fireModes = [
    ...[0, 1, 2].map((id) => id + 1),
    raw[at(0x00416080)] ?? -1, raw[at(0x0041609a)] ?? -1,
  ];
  c.ok(findAll(mem(0x0041607d, 4), [0xc6, 0x46, 0x07, 0x0c]).length === 1
       && findAll(mem(0x00416097, 4), [0xc6, 0x46, 0x07, 0x0d]).length === 1,
       "OriginalItemsApply stores fire modes 0xC and 0xD (MOV byte [ESI+7] at "
       + "0x0041607D and 0x00416097), the largest it writes");
  c.ok(Math.max(...fireModes) < t.fire_params.length
       && t.ammo_hud_rows.length === t.fire_params.length,
       `every fire mode written (${fireModes.map((m) => hex(m)).join(", ")}) `
       + `has a row in both ${t.fire_params.length}-row tables`);
  const cats = new Set(t.item_category);
  c.ok(t.item_category.length === 33 && cats.size === 13
       && Math.min(...cats) === 0 && Math.max(...cats) === 12
       && t.item_compat.length === 13 * 13,
       "33 items in 13 categories, 0..12, and a 13 x 13 pair table");
  c.ok(t.item_compat.every((v, i) => v === t.item_compat[(i % 13) * 13
                                                        + Math.trunc(i / 13)]),
       "the pair table is symmetric: whether two can go together does not "
       + "depend on the order they were taken");
  c.ok(JSON.stringify(t.cursor_colours) === "[[1,0,0],[0,0,1]]",
       "the two cursor colours are red and blue");
  const banks = new Set(t.list_sprites.map((id) => exe.screenSprite(id)?.[0]));
  c.ok(banks.size === 1 && banks.has("scr_item_all"),
       `every item label is a picture in scr_item_all (${[...banks].join(", ")})`);
  const trunkBanks = ITEM_SELECT_SPRITES.map((id) => [id, exe.screenSprite(id)?.[0]]);
  c.ok(trunkBanks.every(([, b]) => b === "scr_item" || b === "scr_org"),
       "every sprite the trunk draws by an immediate resolves, to scr_item or "
       + "scr_org");

  // -- the fixture -----------------------------------------------------------
  for (const k of Object.keys(ORIGINAL_MODE) as (keyof typeof ORIGINAL_MODE)[]) {
    const want = JSON.stringify(t[k]);
    const got = JSON.stringify(ORIGINAL_MODE[k]);
    c.ok(want === got, `the test fixture's ${k} is the exe's`
         + (want === got ? "" : `: fixture ${got.slice(0, 120)} exe ${want.slice(0, 120)}`));
  }

  // -- the trunk's immediates ------------------------------------------------
  const pair = CLASS_PAIRS + 55 * 8;
  c.ok(exe.ri32(pair) === 0x6e && exe.ru32(pair + 4) === ITEM_SELECT_UPDATE
       && exe.ri32(pair + 8) === -1,
       "g_class_handler_pairs' last row is {0x6E, 0x00488820}");
  const body = mem(ITEM_SELECT_UPDATE, ITEM_SELECT_UPDATE_END - ITEM_SELECT_UPDATE);
  const has = (what: string, bytes: number[]) =>
    c.ok(findAll(body, bytes).length > 0, `ItemSelectUpdate ${what}`);
  has(`plays ${hex(ITEM_SELECT_BGM)}, ITEM_SELECT.wav`, pushI(ITEM_SELECT_BGM));
  has(`evaluates camera path ${hex(ITEM_SELECT_CAM_PATH)}`,
      [0x6a, ITEM_SELECT_CAM_PATH]);
  has(`sounds the lid at frame ${hex(ITEM_SELECT_LID_FRAME)}`,
      [0x83, 0xf8, ITEM_SELECT_LID_FRAME]);
  has(`plays TRUNK_16.wav, ${hex(ItemSelectSound.Trunk)}`,
      pushI(ItemSelectSound.Trunk));
  has(`ends the lid at ${hex(ITEM_SELECT_CAM_LAST)}`,
      [0x3d, ...le32(ITEM_SELECT_CAM_LAST)]);
  has(`draws the trunk ${hex(ITEM_SELECT_TRUNK_SLOT)} and the lid `
      + `${hex(ITEM_SELECT_LID_SLOT)}`, pushI(ITEM_SELECT_TRUNK_SLOT));
  has(`...the lid ${hex(ITEM_SELECT_LID_SLOT)}`, pushI(ITEM_SELECT_LID_SLOT));
  has(`at x ${ITEM_SELECT_TRUNK_AT[0]}`, pushF(ITEM_SELECT_TRUNK_AT[0]));
  has(`and z ${ITEM_SELECT_TRUNK_AT[2]}`, pushF(ITEM_SELECT_TRUNK_AT[2]));
  has(`turned ${hex(ITEM_SELECT_TRUNK_YAW)}`, pushI(ITEM_SELECT_TRUNK_YAW));
  has(`hinged at y ${ITEM_SELECT_LID_HINGE[1]}`, pushF(ITEM_SELECT_LID_HINGE[1]));
  has(`and z ${ITEM_SELECT_LID_HINGE[2]}`, pushF(ITEM_SELECT_LID_HINGE[2]));

  // -- the fresh profile -----------------------------------------------------
  const reset = mem(PROFILE_FACTORY_RESET, 0x90);
  const seeded = [OriginalItem.PowerUp12, OriginalItem.Chamber2,
                  OriginalItem.CreditPlus2].map((id) =>
    findAll(reset, [0x88, 0x15, ...le32(PROFILE_ITEMS + id)]).length);
  c.ok(seeded.every((n) => n === 1)
       && findAll(reset, [0xbf, ...le32(PROFILE_ITEMS)]).length === 1,
       "ProfileFactoryReset zeroes the 33 items from 0x009C9F3D and sets "
       + "items 3, 7 and 0x10 to DL (1)");

  // -- the script -------------------------------------------------------------
  const evt = readFileSync(join(dir, "evt", "st1evtbl.bin"));
  const w = (off: number) => evt.readUInt32LE(off);
  const block0 = w(0) - 0x0ceb5a00;
  const table = Array.from({ length: 7 }, (_u, j) => w(block0 + j * 4));
  const rel = table.map((v) => v === 0xffffffff ? -1 : v - 0x0ceb5a00);
  c.ok(rel.join() === [-0x1ac, 0x68, 0x6c, 0x394, -1, 0x954, -1].join(),
       `st1evtbl.bin block 0's step table is [com, 0x68, 0x6C, 0x394, -1, `
       + `0x954, -1] (${rel.map((v) => (v < 0 ? "-" : "") + hex(Math.abs(v))).join(", ")})`);
  const spawnAt = findAll(evt.subarray(0x954, 0x9f4), le32(0x0a))
    .map((k) => 0x954 + k).find((k) => k % 4 === 0);
  const rec = spawnAt !== undefined ? w(spawnAt + 4) - 0x0ceb5a00 : -1;
  c.ok(rec >= 0 && w(rec) === 0x6e,
       `step 5's spawn_simple names {0x6E, hp ${rec >= 0 ? (w(rec + 4) << 16) >> 16 : "?"}} at `
       + `${hex(rec)}`);

  // -- the bundle -------------------------------------------------------------
  const sj = join(BUNDLE_ROOT, "stage1_original", "stage1_original.script.json");
  if (!existsSync(sj)) {
    console.log(`  skip  no bundle at ${BUNDLE_ROOT}: the export half is unchecked`);
  } else {
    const s = JSON.parse(readFileSync(sj, "utf8")) as {
      entry_step: number; original_mode: unknown;
      blocks: { steps?: { index: number; end?: boolean;
                          ops: { detail?: unknown; simple?: { class: number }[] }[] }[] }[];
      screen_sprites: Record<string, unknown>;
    };
    c.ok(JSON.stringify(s.original_mode) === JSON.stringify(t),
         "stage1_original's original_mode block is ExeTables.originalModeTables");
    const steps = s.blocks[0]?.steps ?? [];
    c.ok(s.entry_step === 5 && steps[4]?.end === true
         && steps[5]?.ops.some((o) => o.simple?.some((r) => r.class === 0x6e)),
         "it enters block 0 at step 5, behind an end marker, and step 5 spawns "
         + "class 0x6E");
    const want = [...ITEM_SELECT_SPRITES, ...t.list_sprites];
    const missing = want.filter((id) => !(String(id) in s.screen_sprites));
    c.ok(missing.length === 0, "it ships every sprite the trunk can draw"
         + (missing.length ? `; not ${missing.map((m) => hex(m)).join(", ")}` : ""));
    const aj = join(BUNDLE_ROOT, "stage1", "stage1.script.json");
    if (existsSync(aj)) {
      const a = JSON.parse(readFileSync(aj, "utf8")) as { entry_step: number;
        blocks: { steps?: unknown[] }[] };
      c.ok(a.entry_step === 1 && (a.blocks[0]?.steps?.length ?? 0) === 4,
           "the arcade stage 1 enters at step 1 of the four its walk reaches");
    }
  }

  c.finish();
}

await main();
