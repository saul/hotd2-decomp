/**
 * The class-0x41 and class-0x28 tables the port carries as literals match the
 * EXE, word for word.
 *
 *     node tools/run_ts.mjs tools/checks/prop_tables.ts --game-dir ~/"THE HOUSE OF THE DEAD 2"
 *
 * Types 38, 39, 40 and 44 build their objects out of tables compiled into
 * `Hod2.exe` -- positions, angles, hull corners, draw slots, counts, scales --
 * and `src/game/class41/type38.ts`, `type39.ts`, `type40.ts` and `type44.ts`
 * carry those tables as TypeScript literals, each citing the address it came
 * from. A literal is a copy, and a copy is only as good as the last time
 * somebody compared it (`L21`). This compares it: the tables are imported as
 * the port evaluates them, every row is read out of the image at the cited
 * address, and each word is matched **as the 32-bit value the EXE holds** -- a
 * float is equal when it packs to the same four bytes, not when it is close.
 *
 * What only this check can see: a table row mistyped, dropped or re-ordered in
 * the port -- which puts a church chair a few units from where the engine draws
 * it and nothing else notices.
 *
 * Constructors 50 and 66 (`type50.ts`, `type66.ts`) are the same shape: six
 * tables of scenery behind `g_prop_table50_ptrs` and its row counts, and the
 * two sign tables `PlaceTable66Props` picks between, whose counts and
 * addresses are `MOV` immediates in the constructor and are read out of the
 * code here.
 *
 * Class 0x28's three tables ride along (`src/game/class28/index.ts`): the
 * route table, the path lengths it is killed on and the `g_app_state` 10 poses
 * -- a freeze frame one off throws stage 1's burning cars a frame early.
 *
 * Class 0x29's three decal lists ride along too (`src/game/class29/`), with
 * each list's `-1` terminator where the port's length says it is, and every
 * shipped class-0x29 descriptor's selector inside 0..2: the default arm the
 * port declares it does not walk is reached by none.
 *
 * One line per table; a word that differs is its own failure. The last line
 * gives the number of words compared.
 */
import { Checker, f32Bits, gameDirOrSkip, hex, openGame } from "../lib/exe_check";
import { ExeTables } from "../../src/hod2lib/exetab";
import * as evt from "../../src/hod2lib/evt";
import { CLASS29_LIST_VA, CLASS29_LISTS } from "../../src/game/class29/index";
import { asF32, i16, i32, i8, u16, u32, u8 } from "../../src/hod2lib/bytes";
import { PROP38_HULL_POINTS, PROP_TABLE38 } from "../../src/game/class41/type38";
import { PROP_TABLE39 } from "../../src/game/class41/type39";
import {
  FRAGMENT_BURST_SCALES, FRAGMENT_COUNTS, FRAGMENT_POSES, FRAGMENT_SLOTS,
  FRAGMENT_SUBKIND0_OFFSETS, FRAGMENT_SUBKIND11_SCALES,
  FRAGMENT_SUBKIND11_YAWS, FRAGMENT_SUBKIND12_SCALES, FRAGMENT_SUBKIND12_YAWS,
  FRAGMENT_SUBKIND1_POSES,
} from "../../src/game/class41/type40";
import { PROP_TABLE44 } from "../../src/game/class41/type44";
import { PROP_TABLE50, PROP_TABLE50_SCALE_Z } from "../../src/game/class41/type50";
import { PROP_TABLE66_A, PROP_TABLE66_B } from "../../src/game/class41/type66";
import {
  CLASS28_FIXED_POSE_WORDS, CLASS28_ROUTE_LENGTH, CLASS28_ROUTES,
} from "../../src/game/class28/index";

const c = new Checker("prop_tables");
const { exe, source } = await openGame(gameDirOrSkip("prop_tables"));
const data = exe.data;

/** File offset of `n` bytes at `va`; an address outside the image is a crash. */
function at(va: number, n: number): number {
  const r = exe.v2r(va);
  if (r === null || r + n > data.length) {
    throw new Error(`${hex(va, 8)}: ${n} bytes are not in the image`);
  }
  return r;
}

/** Words compared, over the whole run. */
let checked = 0;
/** The table being compared, its words, and how many of them differed. */
let table = "";
let tableWords = 0;
let tableBad = 0;

function begin(name: string): void {
  table = name;
  tableWords = 0;
  tableBad = 0;
}

/** One line for the table: a table that compared no words asserted nothing. */
function end(): void {
  if (tableBad) return;
  c.ok(tableWords > 0, `${table}: ${tableWords} words match the EXE`);
}

/** The port's float `lit` against the four bytes at `va`, as bit patterns. */
function sameF32(what: string, lit: number, va: number): void {
  checked++;
  tableWords++;
  const got = u32(data, at(va, 4));
  if (f32Bits(lit) !== got) {
    tableBad++;
    c.fail(`${what}: port ${lit} (${hex(f32Bits(lit), 8)}), `
      + `EXE ${asF32(got)} (${hex(got, 8)})`);
  }
}

/** The port's integer `lit` against the EXE's `got`. */
function sameInt(what: string, lit: number | undefined, got: number): void {
  checked++;
  tableWords++;
  if (lit !== got) {
    tableBad++;
    c.fail(`${what}: port ${lit}, EXE ${got}`);
  }
}

// g_prop_table38 / g_prop_table39: {f32 x,y,z; f32 rx,ry,rz}.
for (const [name, rows, va] of [["PROP_TABLE38", PROP_TABLE38, 0x00593e70],
                                ["PROP_TABLE39", PROP_TABLE39, 0x00593f48]] as const) {
  begin(name);
  rows.forEach((row, i) => {
    for (let k = 0; k < 6; k++) {
      sameF32(`${name}[${i}][${k}]`, row[k]!, va + i * 24 + k * 4);
    }
  });
  end();
}

// g_prop38_hull_points: s16 x,y,z.
begin("PROP38_HULL_POINTS");
PROP38_HULL_POINTS.forEach((row, i) => {
  const o = at(0x00594008 + i * 6, 6);
  for (let k = 0; k < 3; k++) {
    sameInt(`PROP38_HULL_POINTS[${i}][${k}]`, row[k], i16(data, o + k * 2));
  }
});
end();

// g_prop_table44: {s16 x,y,z; pad; s32 rx,ry,rz}, stride 20.
begin("PROP_TABLE44");
PROP_TABLE44.forEach((row, i) => {
  const o = at(0x005946f8 + i * 20, 20);
  const got = [i16(data, o), i16(data, o + 2), i16(data, o + 4),
               i32(data, o + 8), i32(data, o + 12), i32(data, o + 16)];
  for (let k = 0; k < 6; k++) {
    sameInt(`PROP_TABLE44[${i}][${k}]`, row[k], got[k]!);
  }
});
end();

// Type 40, `PlaceFragmentProps`: g_fragment_counts (s8), g_fragment_slots
// (u16), g_fragment_burst_scales (u8), and the pose tables.
const countsVa = at(0x005945d8, 20);
const exeCounts = Array.from({ length: 20 }, (_, i) => i8(data, countsVa + i));
begin("FRAGMENT_COUNTS");
for (let i = 0; i < 20; i++) {
  sameInt(`FRAGMENT_COUNTS[${i}]`, FRAGMENT_COUNTS[i], exeCounts[i]!);
}
end();

begin("FRAGMENT_SLOTS");
{
  const o = at(0x0059463c, 40);
  for (let i = 0; i < 20; i++) {
    sameInt(`FRAGMENT_SLOTS[${i}]`, FRAGMENT_SLOTS[i], u16(data, o + i * 2));
  }
}
end();

begin("FRAGMENT_BURST_SCALES");
{
  const o = at(0x0059469c, 20);
  for (let i = 0; i < 20; i++) {
    sameInt(`FRAGMENT_BURST_SCALES[${i}]`, FRAGMENT_BURST_SCALES[i], u8(data, o + i));
  }
}
end();

begin("FRAGMENT_SUBKIND0_OFFSETS");
FRAGMENT_SUBKIND0_OFFSETS.forEach((row, i) => {
  for (let k = 0; k < 2; k++) {
    sameF32(`FRAGMENT_SUBKIND0_OFFSETS[${i}][${k}]`, row[k]!,
            0x00594158 + i * 8 + k * 4);
  }
});
end();

begin("FRAGMENT_SUBKIND1_POSES");
FRAGMENT_SUBKIND1_POSES.forEach((row, i) => {
  for (let k = 0; k < 6; k++) {
    sameF32(`FRAGMENT_SUBKIND1_POSES[${i}][${k}]`, row[k]!,
            0x00594038 + i * 24 + k * 4);
  }
});
end();

// g_fragment_pose_tables: one pointer per sub-kind, null for the two whose
// arms place their own; each non-null one points at g_fragment_counts[sk]
// rows of {f32 x, y, z}.
begin("FRAGMENT_POSES");
{
  const o = at(0x005945ec, 80);
  const hasRow = (sk: number) => Object.prototype.hasOwnProperty.call(FRAGMENT_POSES, sk);
  for (let sk = 0; sk < 20; sk++) {
    const ptr = u32(data, o + sk * 4);
    if (!ptr) {
      sameInt(`FRAGMENT_POSES has no row for sub-kind ${sk}`, hasRow(sk) ? 1 : 0, 0);
      continue;
    }
    const rows = hasRow(sk) ? FRAGMENT_POSES[sk]! : [];
    sameInt(`FRAGMENT_POSES[${sk}] row count`, rows.length, exeCounts[sk]!);
    rows.forEach((row, i) => {
      for (let k = 0; k < 3; k++) {
        sameF32(`FRAGMENT_POSES[${sk}][${i}][${k}]`, row[k], ptr + i * 12 + k * 4);
      }
    });
  }
}
end();

for (const [name, lit, va, n, kind] of [
  ["FRAGMENT_SUBKIND11_SCALES", FRAGMENT_SUBKIND11_SCALES, 0x00594664, 3, "f"],
  ["FRAGMENT_SUBKIND12_SCALES", FRAGMENT_SUBKIND12_SCALES, 0x00594670, 4, "f"],
  ["FRAGMENT_SUBKIND11_YAWS", FRAGMENT_SUBKIND11_YAWS, 0x00594680, 3, "i"],
  ["FRAGMENT_SUBKIND12_YAWS", FRAGMENT_SUBKIND12_YAWS, 0x0059468c, 4, "i"],
] as const) {
  begin(name);
  for (let i = 0; i < n; i++) {
    if (kind === "f") sameF32(`${name}[${i}]`, lit[i]!, va + i * 4);
    else sameInt(`${name}[${i}]`, lit[i], i32(data, at(va + i * 4, 4)));
  }
  end();
}

// Constructor 50 (`type50.ts`): g_prop_table50_ptrs picks the table,
// g_prop_table50_counts (s8) says how many 28-byte rows
// {u16 slot; pad; f32 x,y,z; s32 rx,ry,rz}, and g_prop_table50_scale_z is
// read for table 5 alone, one float per row.
begin("PROP_TABLE50");
const counts50Va = at(0x00594f20, 6);
const counts50 = Array.from({ length: 6 }, (_, i) => i8(data, counts50Va + i));
{
  const o = at(0x00594f08, 24);
  const ptrs50 = Array.from({ length: 6 }, (_, i) => u32(data, o + i * 4));
  sameInt("PROP_TABLE50 has one entry per g_prop_table50_ptrs row",
          PROP_TABLE50.length, ptrs50.length);
  ptrs50.forEach((ptr, ti) => {
    const rows = ti < PROP_TABLE50.length ? PROP_TABLE50[ti]! : [];
    sameInt(`PROP_TABLE50[${ti}] row count`, rows.length, counts50[ti]!);
    rows.forEach((row, i) => {
      const r = at(ptr + i * 28, 28);
      sameInt(`PROP_TABLE50[${ti}][${i}] slot`, row[0], u16(data, r));
      for (let k = 0; k < 3; k++) {
        sameF32(`PROP_TABLE50[${ti}][${i}][${1 + k}]`, row[1 + k]!,
                ptr + i * 28 + 4 + 4 * k);
      }
      for (let k = 0; k < 3; k++) {
        sameInt(`PROP_TABLE50[${ti}][${i}][${4 + k}]`, row[4 + k],
                i32(data, r + 16 + 4 * k));
      }
    });
  });
}
end();

begin("PROP_TABLE50_SCALE_Z");
sameInt("PROP_TABLE50_SCALE_Z has table 5's row count",
        PROP_TABLE50_SCALE_Z.length, counts50[5]!);
PROP_TABLE50_SCALE_Z.forEach((v, i) => {
  sameF32(`PROP_TABLE50_SCALE_Z[${i}]`, v, 0x00594ef0 + i * 4);
});
end();

// Constructor 66 (`type66.ts`): two tables of 32-byte rows
// {s16 slot; pad; f32 x,y,z; s32 yaw; f32 sx,sy,sz}, whose counts and
// addresses are the `MOV EAX, imm32` / `MOV ECX, imm32` pairs at 0x00464505
// and 0x00464519 -- read out of the code, not assumed.
for (const [name, rows, mov] of [["PROP_TABLE66_A", PROP_TABLE66_A, 0x00464505],
                                 ["PROP_TABLE66_B", PROP_TABLE66_B, 0x00464519]] as const) {
  begin(name);
  const code = at(mov, 10);
  if (data[code] !== 0xb8 || data[code + 5] !== 0xb9) {
    tableBad++;
    c.fail(`${name}: ${hex(mov, 8)} is not MOV EAX,imm; MOV ECX,imm`);
    continue;
  }
  const n = u32(data, code + 1);
  const va = u32(data, code + 6);
  sameInt(`${name} row count (the constructor's MOV EAX)`, rows.length, n);
  rows.forEach((row, i) => {
    const r = at(va + i * 32, 32);
    sameInt(`${name}[${i}] slot`, row[0], i16(data, r));
    for (let k = 0; k < 3; k++) {
      sameF32(`${name}[${i}][${1 + k}]`, row[1 + k]!, va + i * 32 + 4 + 4 * k);
    }
    sameInt(`${name}[${i}][4] yaw`, row[4], i32(data, r + 16));
    for (let k = 0; k < 3; k++) {
      sameF32(`${name}[${i}][${5 + k}]`, row[5 + k]!, va + i * 32 + 20 + 4 * k);
    }
  });
  end();
}

// Class 0x28 (`class28/index.ts`): g_class28_route_table {s16 slot,
// s16 freeze}, g_cam_path_length at each route's slot, and
// g_class28_fixed_poses as the raw words the image holds.
begin("CLASS28_ROUTES and CLASS28_ROUTE_LENGTH");
CLASS28_ROUTES.forEach(([slot, freeze], i) => {
  const r = at(0x00589ae0 + i * 4, 4);
  sameInt(`CLASS28_ROUTES[${i}].slot`, slot, i16(data, r));
  sameInt(`CLASS28_ROUTES[${i}].freeze`, freeze, i16(data, r + 2));
  sameInt(`CLASS28_ROUTE_LENGTH[0x${slot.toString(16)}]`,
          CLASS28_ROUTE_LENGTH[slot] ?? -1,
          i32(data, at(0x00576d38 + slot * 4, 4)));
});
sameInt("CLASS28_ROUTE_LENGTH has one row per route",
        Object.keys(CLASS28_ROUTE_LENGTH).length, CLASS28_ROUTES.length);
end();

begin("CLASS28_FIXED_POSE_WORDS");
CLASS28_FIXED_POSE_WORDS.forEach((row, i) => {
  const r = at(0x0055dd18 + i * 0x18, 0x18);
  for (let k = 0; k < 6; k++) {
    sameInt(`CLASS28_FIXED_POSE_WORDS[${i}][${k}]`, row[k], u32(data, r + k * 4));
  }
});
end();

// Class 0x29 (`class29/index.ts`): {i32 slot; f32 x,y,z; i32 yaw; f32 scale}
// at a stride of 0x18, each list ended by a -1 slot.
begin("CLASS29_LISTS");
CLASS29_LISTS.forEach((list, n) => {
  const base = CLASS29_LIST_VA[n]!;
  list.forEach((row, i) => {
    const va = base + i * 0x18;
    sameInt(`CLASS29_LISTS[${n}][${i}].slot`, row[0], i32(data, at(va, 4)));
    for (let k = 1; k <= 3; k++) {
      sameF32(`CLASS29_LISTS[${n}][${i}][${k}]`, row[k]!, va + 4 * k);
    }
    sameInt(`CLASS29_LISTS[${n}][${i}].yaw`, row[4], i32(data, at(va + 16, 4)));
    sameF32(`CLASS29_LISTS[${n}][${i}].scale`, row[5], va + 20);
  });
  sameInt(`CLASS29_LISTS[${n}] ends where the EXE's -1 is`, -1,
          i32(data, at(base + list.length * 0x18, 4)));
});
end();

{
  // Every class-0x29 spawn on the disc, and the list its `desc+0x22` picks.
  const com = evt.parse(await source.read("evt/comevtbl.bin"), "comevtbl.bin");
  const seen = new Set<string>();
  let spawns = 0;
  for (let scene = 0; scene < ExeTables.SCENE_COUNT; scene++) {
    const name = exe.sceneEvtFile(scene);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    if (!(await source.exists(`evt/${name}`))) continue;
    const f = evt.parse(await source.read(`evt/${name}`), name,
                        exe.sceneBlockCount(scene), com);
    for (const sp of evt.spawns(f)) {
      if (sp.cls !== 0x29) continue;
      spawns++;
      c.ok(sp.hp >= 0 && sp.hp < CLASS29_LISTS.length,
           `${name}:${hex(sp.offset)} class 0x29 selector ${sp.hp} picks a `
           + "list, not the default arm");
    }
  }
  c.ok(spawns === 3, `three class-0x29 spawns on the disc (found ${spawns})`);
}

c.note(`${checked} table words compared against the EXE`);
c.finish();
