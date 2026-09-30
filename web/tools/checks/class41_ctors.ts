/**
 * Class 0x41 constructors 42, 52, 55, 61 and 65 are read the way the EXE
 * reads them, and every spawn of them on the disc is placed with it.
 *
 *     node tools/run_ts.mjs tools/checks/class41_ctors.ts --game-dir ~/"THE HOUSE OF THE DEAD 2"
 *     HOTD2_BUNDLE=/path/to/export node tools/run_ts.mjs tools/checks/class41_ctors.ts --game-dir ...
 *
 * `src/game/class41/type42.ts`, `type52.ts`, `type55.ts`, `type61.ts` and
 * `type65.ts`. What can put one of them wrong, and what this reads to say it
 * has not:
 *
 *  * **The table no longer names the routine** -- `g_class41_constructors`
 *    and `g_class41_updates` read out of `.data`, and each constructor's
 *    `PUSH` of the routine it hands `ActorAlloc`.
 *  * **A literal the port carries is not the instruction's** -- every
 *    immediate and every float the constructors and routines load is read
 *    here at its instruction, the floats compared as 32-bit patterns with the
 *    values the port evaluates.
 *  * **The routine grows or loses a call** -- the calls each short routine
 *    makes, in order, and the one `AND` constructor 61 makes on the placer.
 *  * **The exporter carries something else** -- with a bundle, each spawn has
 *    its placement, with the descriptor's own position, yaw and lifetime and
 *    the table its constructor reads (read here from the image by byte, not
 *    through the exporter's reader); each model its task draws is a
 *    `slots_breakable` template; and constructor 61's nine figures each have
 *    their synthetic row, type and baked clip.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Checker, f32Bits, gameDirOrSkip, hex, openGame } from "../lib/exe_check";
import { BUNDLE_ROOT, skipNoBundle } from "../lib/bundle_root";
import * as evt from "../../src/hod2lib/evt";
import { Stage } from "../../src/hod2lib/stage";
import {
  TYPE42_SLOT, TYPE52_SLOT, TYPE55_SLOT, TYPE55_SLOT_SPAN, TYPE55_ROWS,
  TYPE61_CLIP, TYPE61_CLIP_A, TYPE61_CLIP_B, TYPE61_FIGURES, TYPE61_TYPE_A,
  TYPE61_TYPE_B, TYPE65_SLOT, TYPE65_SLOT_SPAN, Type61FigureAt,
  Type61FigureClip,
} from "../../src/game/class41/ctor_literals";
import { TYPE42_KILL_STEP } from "../../src/game/class41/type42";
import {
  TYPE52_DOOR_TURN, TYPE52_DOOR_X, TYPE52_DOOR_Y, TYPE52_DOOR_Z, TYPE52_SCALE,
} from "../../src/game/class41/type52";
import {
  TYPE55_ALPHA, TYPE55_BOUNCE_BASE, TYPE55_BOUNCE_SPREAD, TYPE55_BOUNCE_STEP,
  TYPE55_DRAWN_FRAMES, TYPE55_FLOOR_Y, TYPE55_GRAVITY, TYPE55_LAST_FRAME,
  TYPE55_LIFT_BASE, TYPE55_LIFT_SPREAD, TYPE55_LIFT_STEP, TYPE55_PARTICLES,
  TYPE55_RISE, TYPE55_SCALE_BASE, TYPE55_SCALE_SPREAD, TYPE55_SCALE_STEP,
  TYPE55_SPEED_SPREAD, TYPE55_SPIN_HALF, TYPE55_SPIN_SPREAD,
  TYPE55_START_FLAG, TYPE55_TABLE_UNIT,
} from "../../src/game/class41/type55";
import {
  TYPE61_FAR_ROW, TYPE61_FAR_X, TYPE61_FAR_YAW, TYPE61_FAR_Z,
  TYPE61_LEAVE_FLAG, TYPE61_NEAR_X, TYPE61_NEAR_Z, TYPE61_SPACING,
  TYPE61_TYPE_LOW, TYPE61_Y, TYPE61_Y_LOW, TYPE61_Z_A, TYPE61_Z_B,
} from "../../src/game/class41/type61";
import {
  TYPE65_GRAVITY, TYPE65_HALF, TYPE65_LAST_FRAME, TYPE65_ORIGIN_X,
  TYPE65_ORIGIN_Y, TYPE65_ORIGIN_Z, TYPE65_PARTICLES, TYPE65_SCALE,
  TYPE65_SPREAD, TYPE65_STEP, TYPE65_VX_BASE, TYPE65_VX_SPREAD,
  TYPE65_VY_BASE, TYPE65_VY_SPREAD, TYPE65_VZ_BASE, TYPE65_VZ_SPREAD,
  TYPE65_Z_SCALE,
} from "../../src/game/class41/type65";
import { TYPE61_FIGURE_LIGHT } from "../../src/game/light_sets";

const CONSTRUCTORS = 0x00593580;
const UPDATES = 0x005936bc;
const NOOP = 0x0041ebb0;
const CTOR: Record<number, number> = {
  42: 0x004639d0, 52: 0x00463d20, 55: 0x00463fe0, 61: 0x004641f0,
  65: 0x00464360,
};
/** `g_type55_particle_offsets` and `g_type61_figure_types`. */
const OFFSETS = 0x00594f2a;
const TYPES = 0x0059504c;

function hexBytes(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}
/** A little-endian dword as eight hex digits, the way `hexBytes` prints it. */
function le32(v: number): string {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, v >>> 0, true);
  return hexBytes(b);
}
const le8 = (v: number): string => le32(v).slice(0, 2);

async function main(): Promise<void> {
  const dir = gameDirOrSkip("class41_ctors");
  const { source, exe } = await openGame(dir);
  const c = new Checker("class41_ctors");
  const bytesAt = (va: number, n: number): string => {
    const r = exe.v2r(va);
    return r === null ? "" : hexBytes(exe.data.subarray(r, r + n));
  };
  /** The bytes at `va` are `want`. */
  const code = (va: number, want: string, what: string): void => {
    const got = bytesAt(va, want.length / 2);
    c.ok(got === want, `${hex(va, 8)} ${got === want ? "is" : `is ${got}, not`} ${want}: ${what}`);
  };
  /** The float at `va` packs to the same bits as the port's `v`. */
  const flt = (va: number, v: number, what: string): void => {
    const got = exe.ru32(va);
    c.ok(got === f32Bits(v), `${hex(va, 8)} holds ${what} (${v})`);
  };

  // -- the tables ---------------------------------------------------------
  for (const [k, fn] of Object.entries(CTOR)) {
    c.eq(exe.ru32(CONSTRUCTORS + Number(k) * 4), fn,
         `g_class41_constructors[${k}] is ${hex(fn, 8)}`);
  }
  c.eq(exe.ru32(UPDATES + 42 * 4), 0x0046ce80,
       "g_class41_updates[42] is PropDrawOnlyType42 -- the routine its constructor hands ActorAlloc");
  for (const k of [52, 55, 61, 65]) {
    c.eq(exe.ru32(UPDATES + k * 4), NOOP,
         `g_class41_updates[${k}] is NoOpStub: the constructor hands ActorAlloc its own`);
  }

  // -- 42 -------------------------------------------------------------------
  code(0x004639d1, "6a48" + "68" + le32(0x0046ce80),
       "PlaceType42Prop: ActorAlloc(PropDrawOnlyType42, 0x48)");
  code(0x0046ce80, "66833db02b9a00" + le8(TYPE42_KILL_STEP) + "7505" + "e9",
       "PropDrawOnlyType42: (s16)g_evt_step_index == 2 is a JMP to ActorKill");
  code(0x0046ce8f, "68" + le32(TYPE42_SLOT) + "e8c7b6faff" + "59c3",
       "...and otherwise AssetDrawSlot(0x1823) with no push before it, and RET");

  // -- 52 -------------------------------------------------------------------
  code(0x00463d65, "68" + le32(0x00467e50),
       "PlaceType52VanDoors hands ActorAlloc PropDrawOnlyType12");
  code(0x00463d85, "d80d18905600", "FMUL [0x00569018] -- the doors' x");
  flt(0x00569018, TYPE52_DOOR_X, "the doors' x, 9.29");
  code(0x00463d8b, "c744242c" + le32(f32Bits(TYPE52_DOOR_Y)), "y 11.5");
  code(0x00463d93, "c7442430" + le32(f32Bits(TYPE52_DOOR_Z)), "z 22.68");
  code(0x00463dcb, "8d95" + le32(TYPE52_SLOT), "slot 0x1794 + k");
  code(0x00463df8, "b9" + le32(f32Bits(TYPE52_SCALE)), "scale 1.0");
  code(0x00463dfe, "05" + le32(TYPE52_DOOR_TURN), "each door half a turn on");
  code(0x00463e03, "83fb03", "CMP EBX, 3: two doors, i = -1 and +1");

  // -- 55 -------------------------------------------------------------------
  code(0x00463fe7, "68" + le32(0x8500) + "68" + le32(0x0046eeb0),
       "PlaceType55Particles: ActorAlloc(PropUpdateType55Particles, 0x8500)");
  code(0x00464042, "83fe" + le8(TYPE55_ROWS) + "7c36",
       "rows by index below 0x30; the JL steps over the scale's store");
  code(0x0046404d, "b9" + le32(TYPE55_ROWS), "...then rand() % 0x30");
  code(0x0046405c, "b9" + le32(TYPE55_SCALE_SPREAD), "scale rand() % 0x29");
  code(0x0046406f, "d80d64544d00d805c84c4c00", "scale * [0x004D5464] + [0x004C4CC8]");
  flt(0x004d5464, TYPE55_SCALE_STEP, "0.01");
  flt(0x004c4cc8, TYPE55_SCALE_BASE, "0.1");
  code(0x00464082, "0fbf86" + le32(OFFSETS), "MOVSX from g_type55_particle_offsets");
  code(0x00464091, "d80db0d25500", "the table's unit");
  flt(0x0055d2b0, TYPE55_TABLE_UNIT, "0.001");
  code(0x004640bb, "d8051c905600", "FADD [0x0056901C] on y");
  flt(0x0056901c, TYPE55_RISE, "the rise, 10.5");
  code(0x004640e7, "b9" + le32(TYPE55_SPEED_SPREAD), "speed rand() % 0x65");
  code(0x00464153, "b9" + le32(TYPE55_LIFT_SPREAD), "lift rand() % 0x12D");
  flt(0x004c4380, TYPE55_LIFT_BASE, "1.0");
  c.ok(TYPE55_LIFT_STEP === TYPE55_SCALE_STEP, "the lift's step is the same 0.01");
  code(0x0046417a, "b9" + le32(TYPE55_SPIN_SPREAD) + "f7f981ea"
       + le32(TYPE55_SPIN_HALF), "a spin rate, rand() % 0x601 - 0x300");
  code(0x004641d3, "3d" + le32(TYPE55_PARTICLES), "800 pieces");
  code(0x0046eeb0, "a0" + le32(0x009c7200 + TYPE55_START_FLAG) + "83ec0884c0",
       "PropUpdateType55Particles waits on g_script_flags[0x31]");
  code(0x0046eeca, "3d" + le32(TYPE55_LAST_FRAME), "its last frame, 0x8C");
  code(0x0046eefd, "d82598905600", "FSUB [0x00569098]");
  flt(0x00569098, TYPE55_GRAVITY, "gravity, 0.05444");
  code(0x0046ef57, "d81d14915600", "FCOMP [0x00569114]");
  flt(0x00569114, TYPE55_FLOOR_Y, "the floor, 2782.09");
  code(0x0046ef6a, "b9" + le32(TYPE55_BOUNCE_SPREAD), "bounce rand() % 0x15");
  code(0x0046ef79, "d80d64544d00d805104d4c00", "bounce * 0.01 + [0x004C4D10]");
  flt(0x004c4d10, TYPE55_BOUNCE_BASE, "0.3");
  c.ok(TYPE55_BOUNCE_STEP === TYPE55_SCALE_STEP, "the bounce's step is 0.01");
  code(0x0046efd3, "83b9a0010000" + le8(TYPE55_DRAWN_FRAMES) + "7e0d"
       + "a1ac2b9a00", "drawn while +0x1A0 <= 0x6E or g_scene_tick_counter == 0");
  code(0x0046f04b, "b9" + le32(TYPE55_SLOT_SPAN) + "99f7f9" + "68"
       + le32(f32Bits(TYPE55_ALPHA)) + "81c2" + le32(TYPE55_SLOT) + "52e8",
       "AssetDrawSlotWithAlpha(i % 0x30 + 0x19D, 0.5)");

  // -- 61 -------------------------------------------------------------------
  code(0x004641fb, "68f4130000" + "68" + le32(0x004729e0),
       "PlaceType61Figures: ActorAlloc(Type61FigureUpdate, 0x13F4)");
  code(0x0046421b, "83fd" + le8(TYPE61_FAR_ROW), "the first four");
  code(0x00464234, "c74648" + le32(f32Bits(TYPE61_FAR_Z)), "far row z");
  code(0x0046423b, "c74668" + le32(TYPE61_FAR_YAW), "far row yaw");
  code(0x00464242, "d80d84cb4e00d80524905600", "x = i * [0x004ECB84] + [0x00569024]");
  flt(0x004ecb84, TYPE61_SPACING, "24.0");
  flt(0x00569024, TYPE61_FAR_X, "79.0");
  code(0x00464255, "c74648" + le32(f32Bits(TYPE61_NEAR_Z)), "near row z");
  code(0x00464271, "d80520905600", "near row x base");
  flt(0x00569020, TYPE61_NEAR_X, "41.0");
  code(0x00464279, "c74644" + le32(f32Bits(TYPE61_Y)), "y");
  code(0x00464280, "8a85" + le32(TYPES) + "3c" + le8(TYPE61_TYPE_LOW) + "7404"
       + "3c" + le8(TYPE61_TYPE_B), "types 0x19 and 0x16 stand lower...");
  code(0x0046428e, "c74644" + le32(f32Bits(TYPE61_Y_LOW)), "...at 2507");
  code(0x004642af, "c74720" + le32(TYPE61_CLIP), "clip 0x2F6");
  code(0x004642b6, "80bd" + le32(TYPES) + le8(TYPE61_TYPE_A) + "750e" + "c74720"
       + le32(TYPE61_CLIP_A) + "c74648" + le32(f32Bits(TYPE61_Z_A)),
       "type 0x13: clip 0x3EA, z -9608");
  code(0x004642cd, "80bd" + le32(TYPES) + le8(TYPE61_TYPE_B) + "750e" + "c74720"
       + le32(TYPE61_CLIP_B) + "c74648" + le32(f32Bits(TYPE61_Z_B)),
       "type 0x16: clip 0x3DA, z -9566.1");
  c.ok(Type61FigureClip(TYPE61_TYPE_A) === TYPE61_CLIP_A
       && Type61FigureClip(TYPE61_TYPE_B) === TYPE61_CLIP_B
       && Type61FigureClip(0x12) === TYPE61_CLIP,
       "Type61FigureClip is those two tests over 0x2F6");
  code(0x004642f0, "e84bc1faff", "ActorBuildSkinnedModel");
  code(0x004642fd, "8b442418", "EAX = [ESP+0x18]: the placer, the argument");
  code(0x00464310, "8b503480e27f81ca00000880", "...whose +0x34 the AND 0x7F is made on");
  code(0x0046432e, "83fd" + le8(TYPE61_FIGURES), "nine figures");
  code(0x004729e0, "a0" + le32(0x009c7200 + TYPE61_LEAVE_FLAG) + "83ec183c01",
       "Type61FigureUpdate: g_script_flags[0] == 1 despawns");
  code(0x00472a1c, "68" + le32(TYPE61_FIGURE_LIGHT.yaw) + "6a"
       + le8(TYPE61_FIGURE_LIGHT.pitch) + "e8",
       "BuildSceneLightDirection(0, 0x4000, ...)");
  code(0x00472a28, "8d54241852e8", "SetRenderLightDirection(the first output, the world vector)");
  // Every call the routine makes, in order: none steps the counter.
  const body = bytesAt(0x004729e0, 0x00472a4e - 0x004729e0);
  const calls: number[] = [];
  for (let i = 0; i + 5 <= body.length / 2; i++) {
    if (body.slice(i * 2, i * 2 + 2) !== "e8") continue;
    const rel = new DataView(new Uint8Array(body.slice(i * 2 + 2, i * 2 + 10)
      .match(/../g)!.map((h) => Number.parseInt(h, 16))).buffer).getInt32(0, true);
    calls.push((0x004729e0 + i + 5 + rel) >>> 0);
  }
  c.ok(calls.map((v) => hex(v, 8)).join(",") === [0x00409cc0, 0x0041dc70,
    0x0040e0b0, 0x004aa0e0, 0x00411090, 0x0041dcc0].map((v) => hex(v, 8)).join(","),
       `Type61FigureUpdate calls ActorDespawn, the light pair, the draw and nothing else: ${calls.map((v) => hex(v, 8)).join(" ")}`);
  c.ok(!body.includes("ff8694010000") && !body.includes("ff07")
       && !body.includes("ff4778"),
       "...and has no INC of the counter at +0x194");

  // -- 65 -------------------------------------------------------------------
  code(0x00464364, "68" + le32(0x8500) + "68" + le32(0x0046fcc0),
       "PlaceType65Particles: ActorAlloc(PropUpdateType65Particles, 0x8500)");
  code(0x00464391, "bd" + le32(TYPE65_PARTICLES), "300 pieces");
  code(0x004643ba, "b9" + le32(TYPE65_SPREAD), "x rand() % 11");
  code(0x004643c9, "d80530905600d825b4d25500", "x + [580.0] - [5.0]");
  flt(0x00569030, TYPE65_ORIGIN_X, "580.0");
  flt(0x0055d2b4, TYPE65_HALF, "5.0");
  code(0x004643ed, "d8052c905600", "y + [2200.0]");
  flt(0x0056902c, TYPE65_ORIGIN_Y, "2200.0");
  code(0x00464410, "d82528905600", "z - [9149.0]");
  flt(0x00569028, -TYPE65_ORIGIN_Z, "9149.0");
  code(0x00464425, "b9" + le32(TYPE65_VX_SPREAD), "vx rand() % 0x51");
  code(0x00464434, "d80d64544d00d825a0d15500", "vx * 0.01 - [0x0055D1A0]");
  flt(0x004d5464, TYPE65_STEP, "0.01");
  flt(0x0055d1a0, TYPE65_VX_BASE, "0.4");
  code(0x0046444c, "b9" + le32(TYPE65_VY_SPREAD), "vy rand() % 0x65");
  code(0x00464461, "dc25d0d75500", "vy - double [0x0055D7D0]");
  const vyBase = (() => {
    const r = exe.v2r(0x0055d7d0);
    return r === null ? NaN : new DataView(exe.data.buffer, exe.data.byteOffset + r, 8)
      .getFloat64(0, true);
  })();
  c.ok(vyBase === TYPE65_VY_BASE, `0x0055D7D0 holds the double 1.5 (${vyBase})`);
  code(0x00464473, "b9" + le32(TYPE65_VZ_SPREAD), "vz rand() % 0x65");
  code(0x00464488, "d805ac434c00", "vz + [0x004C43AC]");
  flt(0x004c43ac, TYPE65_VZ_BASE, "0.5");
  code(0x004644e2, "c743fc" + le32(f32Bits(TYPE65_SCALE)), "scale 1.5");
  code(0x0046fccb, "3d" + le32(TYPE65_LAST_FRAME), "its last frame, 300");
  code(0x0046fcfb, "d82534915600", "FSUB [0x00569134]");
  flt(0x00569134, TYPE65_GRAVITY, "gravity, 0.10888");
  code(0x0046fd9d, "d80da8434c00", "the z scale * [0x004C43A8]");
  flt(0x004c43a8, TYPE65_Z_SCALE, "0.8");
  code(0x0046fdb8, "b9" + le32(TYPE65_SLOT_SPAN) + "99f7f981c2" + le32(TYPE65_SLOT)
       + "52e89487faff", "AssetDrawSlot(i % 0x48 + 0xCA5), no alpha");

  // -- the spawns, and with a bundle what the exporter made of them ---------
  const manifestPath = join(BUNDLE_ROOT, "manifest.json");
  const bundle = existsSync(manifestPath);
  const entries = bundle
    ? (JSON.parse(readFileSync(manifestPath, "utf8")) as {
        stages: { name: string; script: string; geometry: string }[] }).stages
    : [1, 2, 3, 4, 5, 6].flatMap((n) => [
        { name: `stage${n}`, script: "", geometry: "" },
        { name: `stage${n}_original`, script: "", geometry: "" }]);
  const unique = new Map<number, Set<string>>();
  // The two tables, byte by byte.
  const rows: number[][] = [];
  for (let j = 0; j < TYPE55_ROWS; j++) {
    const b = bytesAt(OFFSETS + j * 6, 6);
    const w = (k: number) => {
      const v = Number.parseInt(b.slice(k * 4 + 2, k * 4 + 4) + b.slice(k * 4, k * 4 + 2), 16);
      return (v << 16) >> 16;
    };
    rows.push([w(0), w(1), w(2)]);
  }
  const types = bytesAt(TYPES, TYPE61_FIGURES).match(/../g)!
    .map((h) => (Number.parseInt(h, 16) << 24) >> 24);
  c.ok(types.join() === "19,11,25,10,7,13,16,22,18",
       `g_type61_figure_types is ${types.map((t) => hex(t, 2)).join(" ")}`);
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
    const recs = evt.spawns(ev).filter((r) => r.cls === 0x41
      && CTOR[(ev.raw[r.offset + 0x25] << 24) >> 24] !== undefined);
    type Pl = { at: number; container: string; lifetime_evt_steps: number;
                pos?: number[]; yaw?: number; offsets?: number[][];
                char_types?: number[] };
    type Row = { at: number; class: number; char_type: number; motion: number;
                 parent_at?: number; synthetic?: boolean };
    let pls = new Map<number, Pl>();
    let chars: { placements: Row[]; types: Record<string, { motions: Record<string, unknown> }> }
      = { placements: [], types: {} };
    const nodes = new Set<number>();
    if (bundle) {
      const script = JSON.parse(readFileSync(join(BUNDLE_ROOT, entry.name,
                                                  entry.script), "utf8")) as {
        breakables?: { placements?: Pl[] }; characters: typeof chars };
      pls = new Map((script.breakables?.placements ?? [])
        .filter((p) => /^type(42|52|55|61|65)$/.test(p.container))
        .map((p) => [p.at, p] as const));
      chars = script.characters;
      const b = readFileSync(join(BUNDLE_ROOT, entry.name, entry.geometry));
      const len = b.readUInt32LE(12);
      const js = JSON.parse(b.subarray(20, 20 + len).toString("utf8")) as {
        nodes?: { name?: string }[] };
      for (const n of js.nodes ?? []) {
        const mm = /^slots_breakable_.*_slot_([0-9a-f]{4})$/.exec(n.name ?? "");
        if (mm) nodes.add(Number.parseInt(mm[1]!, 16));
      }
    }
    for (const r of recs) {
      const ctor = (ev.raw[r.offset + 0x25] << 24) >> 24;
      let u = unique.get(ctor);
      if (!u) { u = new Set(); unique.set(ctor, u); }
      u.add(`${m[1]}:${r.offset}`);
      if (!bundle) continue;
      const where = `${entry.name}: ${hex(r.offset)}, constructor ${ctor}`;
      const pl = pls.get(r.offset);
      if (!c.ok(pl?.container === `type${ctor}`, `${where} has its placement`)) continue;
      c.ok(pl!.lifetime_evt_steps === r.hp && pl!.yaw === r.orient[1]
           && !!pl!.pos && pl!.pos.every((v, k) => f32Bits(v) === f32Bits(r.pos[k]!)),
           `${where}: the descriptor's position, yaw and +0x11C`);
      const slots = ctor === 42 ? [TYPE42_SLOT]
        : ctor === 52 ? [TYPE52_SLOT, TYPE52_SLOT + 1]
        : ctor === 55 ? Array.from({ length: TYPE55_SLOT_SPAN }, (_, k) => TYPE55_SLOT + k)
        : ctor === 65 ? Array.from({ length: TYPE65_SLOT_SPAN }, (_, k) => TYPE65_SLOT + k)
        : [];
      const missing = slots.filter((s) => !nodes.has(s));
      c.ok(missing.length === 0, `${where}: every slot its task draws travels`
           + (missing.length ? ` (missing ${missing.map((s) => hex(s, 4)).join(" ")})` : ""));
      if (ctor === 55) {
        c.ok(JSON.stringify(pl!.offsets) === JSON.stringify(rows),
             `${where}: the placement carries the 48 rows of g_type55_particle_offsets`);
      }
      if (ctor === 61) {
        c.ok(JSON.stringify(pl!.char_types) === JSON.stringify(types),
             `${where}: the placement carries g_type61_figure_types`);
        for (let i = 0; i < TYPE61_FIGURES; i++) {
          const row = chars.placements.find((p) => p.at === Type61FigureAt(r.offset, i));
          const clip = Type61FigureClip(types[i]!);
          c.ok(!!row && row.class === 0x41 && row.char_type === types[i]
               && row.motion === clip && row.parent_at === r.offset
               && row.synthetic === true
               && chars.types[String(types[i])]?.motions[String(clip)] !== undefined,
               `${where}: figure ${i}'s synthetic row, type ${hex(types[i]!, 2)} on `
               + `${hex(clip, 3)}, baked`);
        }
      }
    }
  }
  const count = (k: number) => unique.get(k)?.size ?? 0;
  c.ok(count(42) === 1 && count(52) === 2 && count(55) === 1 && count(61) === 1
       && count(65) === 1,
       `unique spawns on the disc: 42 x${count(42)}, 52 x${count(52)}, 55 x${count(55)}, `
       + `61 x${count(61)}, 65 x${count(65)} (1, 2, 1, 1, 1)`);
  if (!bundle) {
    if (c.failed) c.finish();
    skipNoBundle("class41_ctors (the routines and the evt above were checked)");
  }
  c.finish();
}

await main();
