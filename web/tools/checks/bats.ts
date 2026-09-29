/**
 * The class-0x46 bat against the tables the EXE steers it with.
 *
 *     node tools/run_ts.mjs tools/checks/bats.ts --game-dir ~/"THE HOUSE OF THE DEAD 2"
 *
 * `PlaceBats` (`FUN_0042D9C0`) is a placer with three flights, and the shape of
 * each one is held in the EXE rather than in the descriptor: the twenty-four
 * sub-type-0 spawns all sit at the world origin and take their whole path from
 * `g_bat_spline_points` (`0x00589944`), indexed by a pair of *descriptor* bytes
 * the parser has to read correctly to land on the right row. So the reading is
 * a chain -- descriptor byte to flight group, group and member to spline slot,
 * character type to `zabat.bin` -- and every link of it is checkable.
 *
 * What this asserts, and what only this can see:
 *
 *  * **The twenty-seven descriptors split 24 / 1 / 2 across sub-types 0, 1 and
 *    2**, by `desc+0x25`, which is the byte the opcode-0x09 allocator copies to
 *    `obj+0x130C`. A parser that read `desc+0x24` instead would still produce
 *    three groups and a plausible story; the counts are what tell them apart.
 *  * **The four sub-type-0 flights are complete**: each is six descriptors with
 *    `+0x11C` exactly 1..6, placed by one block and step, and the four groups
 *    are 0, 1, 2 and 3 with no repeats. `PlaceBats` derives the member index as
 *    `+0x11C - 1` and the spline slot as `group * 3 + member % 3`, so a missing
 *    or duplicated member is a bat flying another bat's path.
 *  * **Every slot those flights reach exists in the twelve-row table**, and all
 *    twelve rows are reached. A thirteenth group would index past the end.
 *  * **Each path's control points are distinct and monotone in z or y** -- the
 *    bats fly *somewhere*, rather than the table being twelve rows of a
 *    coincidence.
 *  * **The motion pair resolves.** `BatWingUpdate` (`FUN_0042F660`) finds its
 *    clip by searching `g_bat_body_motions` for the body's own clip and taking
 *    `g_bat_wing_motions` at the same index. That search only terminates
 *    usefully because every body row is 0x407, the clip `PlaceBats` writes. If
 *    either table stops being uniform, the wing silently keeps whatever clip it
 *    had. The port's copies of both tables, and its `BatWingClip` search, are
 *    held to the same bytes.
 *  * **The swarm's member count is six and eight, not eight and ten.** The
 *    expression is `((1 < g_players_in_play) - 1 & ~1) + 8`, which is `8` when
 *    the test holds and `6` when it does not -- and it reads like the other way
 *    round. The instruction bytes at `0x0042D9E9` are asserted and evaluated
 *    here, so the port's constants cannot drift.
 *  * **The two character types are the bat.** `0x1E` is `zabat.bin` with one
 *    node and `0x1F` is `zabat_wing.bin` with six, and both names come from
 *    `g_character_skeletons`, which is one of the binary's two name tables.
 *  * **The port agrees with all of it**: `src/game/class46/index.ts`'s
 *    constants and its `BAT_SPLINE_POINTS`, imported, number for number.
 */
import { gameDirOrSkip, openGame, Checker, hex } from "../lib/exe_check";
import { ExeTables } from "../../src/hod2lib/exetab";
import { i16 } from "../../src/hod2lib/bytes";
import * as evt from "../../src/hod2lib/evt";
import {
  BAT_BODY_MOTIONS, BAT_CHAR_TYPE, BAT_CLIP, BAT_MEMBERS_PER_SUBTYPE,
  BAT_SPLINE_POINTS, BAT_SWARM_MEMBERS_1P, BAT_SWARM_MEMBERS_2P,
  BAT_WING_CHAR_TYPE, BAT_WING_CLIP, BAT_WING_MOTIONS, BatWingClip,
} from "../../src/game/class46/index";

const BAT_CLASS = 0x46;

/** `g_bat_spline_points` -- s16 pts[12][4][3]. */
const SPLINE_POINTS = 0x00589944;
const SPLINE_SLOTS = 12;
const SPLINE_CTRL = 4;

/** `g_bat_body_motions` and `g_bat_wing_motions`, five s16 each. */
const BODY_MOTIONS = 0x0058992c;
const WING_MOTIONS = 0x00589938;
const MOTION_ROWS = 5;

/** The clip `PlaceBats` writes to `obj+0x1B4`, and the one the wing gets. */
const BODY_CLIP = 0x407;
const WING_CLIP = 0x406;

/** Character types, and the `g_character_skeletons` names that identify them. */
const BODY_CHAR_TYPE = 0x1e;
const WING_CHAR_TYPE = 0x1f;
const BODY_ASSET = "zabat.bin";
const WING_ASSET = "zabat_wing.bin";
const BODY_NODES = 1;
const WING_NODES = 6;

/** `g_bat_members` is 25 slots per sub-type. */
const MEMBERS_PER_SUBTYPE = 25;

/** What the shipped scripts hold. A change here is a change in the reading. */
const EXPECT_BY_SUBTYPE: Record<number, number> = { 0: 24, 1: 1, 2: 2 };
/** group -> `[scene, block, step]`. */
const EXPECT_FLIGHTS: Record<number, [number, number, number]> = {
  0: [3, 0, 6],
  1: [2, 4, 5],
  2: [3, 2, 6],
  3: [3, 10, 1],
};

/**
 * `PlaceBats`' swarm count, `0x0042D9E9`:
 *
 *     33 C0                     XOR  EAX, EAX
 *     66 83 3D 80 8E 9C 00 01   CMP  word [g_players_in_play], 1
 *     0F 9F C0                  SETG AL
 *     48                        DEC  EAX
 *     24 FE                     AND  AL, 0xFE
 *     83 C0 08                  ADD  EAX, 8
 */
const SWARM_AT = 0x0042d9e9;
const G_PLAYERS_IN_PLAY = 0x009c8e80;
const SWARM_BYTES = [0x33, 0xc0, 0x66, 0x83, 0x3d,
                     G_PLAYERS_IN_PLAY & 0xff, (G_PLAYERS_IN_PLAY >>> 8) & 0xff,
                     (G_PLAYERS_IN_PLAY >>> 16) & 0xff, G_PLAYERS_IN_PLAY >>> 24,
                     0x01, 0x0f, 0x9f, 0xc0, 0x48, 0x24, 0xfe, 0x83, 0xc0, 0x08];

/** Those six instructions, run for a player count. */
function swarmMembers(players: number): number {
  let eax = 0;                                       // XOR EAX, EAX
  const g = players > 1;                             // CMP ..., 1 / SETG
  eax = (eax & ~0xff) | (g ? 1 : 0);
  eax = (eax - 1) | 0;                               // DEC EAX
  eax = (eax & ~0xff) | (eax & 0xfe);                // AND AL, 0xFE
  return (eax + 8) | 0;                              // ADD EAX, 8
}

interface BatSpawn {
  scene: number;
  block: number;
  step: number;
  offset: number;
  memberHp: number;
  group: number;
  subtype: number;
}

type Pt = [number, number, number];

async function main(): Promise<void> {
  const dir = gameDirOrSkip("bats");
  const { source, exe } = await openGame(dir);
  const raw = exe.data;
  const c = new Checker("bats");

  // -- the descriptors -----------------------------------------------------
  const com = evt.parse(await source.read("evt/comevtbl.bin"), "comevtbl.bin");
  const spawns: BatSpawn[] = [];
  for (let scene = 0; scene < ExeTables.SCENE_COUNT; scene++) {
    const name = exe.sceneEvtFile(scene);
    if (!name || !(await source.exists(`evt/${name}`))) continue;
    const f = evt.parse(await source.read(`evt/${name}`), name,
                        exe.sceneBlockCount(scene), com);
    const where = new Map<number, [number, number]>();
    for (const blk of f.blocks) {
      blk.programs.forEach((prog, step) => {
        for (const ins of prog) {
          if (!evt.SPAWN_OPCODES.includes(ins.opcode)) continue;
          for (const w of ins.raw) {
            const off = f.toOffset(w);
            if (off !== null && !where.has(off)) where.set(off, [blk.index, step]);
          }
        }
      });
    }
    for (const sp of evt.spawns(f)) {
      if (sp.cls !== BAT_CLASS) continue;
      const [block, step] = where.get(sp.offset) ?? [-1, -1];
      spawns.push({ scene, block, step, offset: sp.offset, memberHp: sp.hp,
                    group: f.raw[sp.offset + 0x24]!,
                    subtype: f.raw[sp.offset + 0x25]! });
    }
  }
  const bySubtype = new Map<number, BatSpawn[]>();
  for (const sp of spawns) {
    const l = bySubtype.get(sp.subtype) ?? [];
    l.push(sp);
    bySubtype.set(sp.subtype, l);
  }
  const split = JSON.stringify(Object.fromEntries(
    [...bySubtype].sort((a, b) => a[0] - b[0]).map(([k, v]) => [k, v.length])));
  c.eq(split, JSON.stringify(EXPECT_BY_SUBTYPE),
       `${spawns.length} class-0x46 descriptors split by sub-type`);

  // -- the four sub-type-0 flights -----------------------------------------
  const flights = new Map<number, BatSpawn[]>();
  for (const sp of bySubtype.get(0) ?? []) {
    const l = flights.get(sp.group) ?? [];
    l.push(sp);
    flights.set(sp.group, l);
  }
  const groups = [...flights.keys()].sort((a, b) => a - b);
  const wantGroups = Object.keys(EXPECT_FLIGHTS).map(Number).sort((a, b) => a - b);
  c.eq(groups.join(","), wantGroups.join(","), "the flight groups");

  const reached = new Set<number>();
  for (const group of groups) {
    const members = flights.get(group)!;
    const hps = members.map((m) => m.memberHp).sort((a, b) => a - b);
    c.eq(hps.join(","), "1,2,3,4,5,6", `flight ${group}'s +0x11C`);
    const sites = [...new Set(members.map((m) => `${m.scene}/${m.block}/${m.step}`))];
    c.ok(sites.length === 1,
         `flight ${group} is placed by one scene/block/step: ${sites.join(" ")}`);
    const want = EXPECT_FLIGHTS[group];
    c.ok(want === undefined || (sites.length === 1 && sites[0] === want.join("/")),
         `flight ${group} is at ${sites.join(" ")}, expected ${want?.join("/")}`);
    for (const m of members) {
      const slot = group * 3 + (m.memberHp - 1) % 3;
      c.ok(slot >= 0 && slot < SPLINE_SLOTS,
           `flight ${group} member ${m.memberHp} indexes spline slot ${slot}`);
      reached.add(slot);
    }
  }
  const reachedList = [...reached].sort((a, b) => a - b);
  c.eq(reachedList.join(","),
       Array.from({ length: SPLINE_SLOTS }, (_, i) => i).join(","),
       `the flights reach all ${SPLINE_SLOTS} spline slots`);

  // -- the spline table ----------------------------------------------------
  const base = exe.v2r(SPLINE_POINTS);
  if (!c.ok(base !== null, `${hex(SPLINE_POINTS, 8)} is in a section`)) c.finish();
  const rows: Pt[][] = [];
  for (let slot = 0; slot < SPLINE_SLOTS; slot++) {
    const pts: Pt[] = [];
    for (let k = 0; k < SPLINE_CTRL; k++) {
      const o = base! + slot * 0x18 + k * 6;
      pts.push([i16(raw, o), i16(raw, o + 2), i16(raw, o + 4)]);
    }
    rows.push(pts);
    c.ok(new Set(pts.map((p) => p.join(","))).size > 1,
         `spline slot ${slot}'s four control points are not all one point`);
    const dz = [1, 2, 3].map((k) => pts[k]![2] - pts[k - 1]![2]);
    const dy = [1, 2, 3].map((k) => pts[k]![1] - pts[k - 1]![1]);
    const any = (d: number[]): boolean => d.some((x) => x !== 0);
    const moves = (dz.every((d) => d >= 0) && any(dz))
      || (dz.every((d) => d <= 0) && any(dz))
      || (dy.every((d) => d <= 0) && any(dy));
    c.ok(moves, `spline slot ${slot} advances in z or descends in y: `
         + pts.map((p) => `(${p.join(",")})`).join(" "));
  }

  // -- the motion pair -----------------------------------------------------
  const s16s = (va: number): number[] => {
    const r = exe.v2r(va)!;
    return Array.from({ length: MOTION_ROWS }, (_, i) => i16(raw, r + i * 2));
  };
  const body = s16s(BODY_MOTIONS);
  const wing = s16s(WING_MOTIONS);
  const uniform = (v: number): string => Array(MOTION_ROWS).fill(v).join(",");
  c.eq(body.join(","), uniform(BODY_CLIP), "g_bat_body_motions is 0x407 x5");
  c.eq(wing.join(","), uniform(WING_CLIP), "g_bat_wing_motions is 0x406 x5");
  c.ok(body.includes(BODY_CLIP),
       `BatWingUpdate's search for ${hex(BODY_CLIP)} finds a row, so the wing `
       + "does not keep whatever clip it had");
  for (const clip of [BODY_CLIP, WING_CLIP]) {
    const len = exe.motionPlayLength(clip);
    c.ok(len !== null && len > 0, `clip ${hex(clip)} has play length ${len}`);
  }
  c.eq(BAT_BODY_MOTIONS.join(","), body.join(","),
       "the port's BAT_BODY_MOTIONS is g_bat_body_motions");
  c.eq(BAT_WING_MOTIONS.join(","), wing.join(","),
       "the port's BAT_WING_MOTIONS is g_bat_wing_motions");
  c.eq(BatWingClip(BODY_CLIP, -1), WING_CLIP,
       `the port's BatWingClip(${hex(BODY_CLIP)}) is ${hex(WING_CLIP)}`);

  // -- the two character types ---------------------------------------------
  const slots = exe.assetSlots();
  for (const [ct, asset, nodes] of [
    [BODY_CHAR_TYPE, BODY_ASSET, BODY_NODES],
    [WING_CHAR_TYPE, WING_ASSET, WING_NODES],
  ] as const) {
    const skel = exe.characterSkeleton(ct);
    c.eq(exe.characterAssetFile(ct), asset, `character type ${hex(ct)} is ${asset}`);
    c.eq(skel.length, nodes, `character type ${hex(ct)} has ${nodes} nodes`);
    for (const node of skel) {
      const named = slots.get(node.slot);
      c.ok(named?.[0] === asset,
           `character type ${hex(ct)} node slot ${node.slot} resolves to `
           + `${named?.join("[") ?? "nothing"}${named ? "]" : ""}, ${asset}`);
    }
  }

  // -- the swarm's member count --------------------------------------------
  const swarm = raw.subarray(exe.v2r(SWARM_AT)!, exe.v2r(SWARM_AT)! + SWARM_BYTES.length);
  c.ok(SWARM_BYTES.every((b, i) => swarm[i] === b),
       `PlaceBats at ${hex(SWARM_AT, 8)} computes ((1 < g_players_in_play) - 1 `
       + `& ~1) + 8: ${Array.from(swarm, (b) => b.toString(16).padStart(2, "0"))
         .join(" ")}`);
  c.eq(swarmMembers(1), 6, "one player faces six swarm bats");
  c.eq(swarmMembers(2), 8, "two players face eight swarm bats");

  // -- and the port agrees with all of it ----------------------------------
  const port: [string, number, number][] = [
    ["BAT_SWARM_MEMBERS_1P", BAT_SWARM_MEMBERS_1P, swarmMembers(1)],
    ["BAT_SWARM_MEMBERS_2P", BAT_SWARM_MEMBERS_2P, swarmMembers(2)],
    ["BAT_CHAR_TYPE", BAT_CHAR_TYPE, BODY_CHAR_TYPE],
    ["BAT_WING_CHAR_TYPE", BAT_WING_CHAR_TYPE, WING_CHAR_TYPE],
    ["BAT_CLIP", BAT_CLIP, BODY_CLIP],
    ["BAT_WING_CLIP", BAT_WING_CLIP, WING_CLIP],
    ["BAT_MEMBERS_PER_SUBTYPE", BAT_MEMBERS_PER_SUBTYPE, MEMBERS_PER_SUBTYPE],
  ];
  for (const [name, got, want] of port) {
    c.eq(got, want, `the port's ${name} is the EXE's`);
  }
  const flat = rows.flat(2);
  const portFlat = BAT_SPLINE_POINTS.flat(2) as number[];
  const d = Array.from({ length: Math.max(flat.length, portFlat.length) },
                       (_, i) => i).find((i) => portFlat[i] !== flat[i]);
  c.ok(d === undefined,
       `the port's BAT_SPLINE_POINTS is g_bat_spline_points, `
       + `${portFlat.length} numbers vs ${flat.length}`
       + (d === undefined ? "" : `; slot ${Math.floor(d / 12)} point `
          + `${Math.floor(d / 3) % 4} axis ${"xyz"[d % 3]} is ${portFlat[d]}, `
          + `the EXE's ${flat[d]}`));

  c.finish();
}

await main();
