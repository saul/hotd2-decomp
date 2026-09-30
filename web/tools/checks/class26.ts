/**
 * Class 0x26 subtypes 6 and 7 are read the way the EXE reads them, and each
 * of their models travels.
 *
 *     node tools/run_ts.mjs tools/checks/class26.ts --game-dir ~/"THE HOUSE OF THE DEAD 2"
 *     HOTD2_BUNDLE=/path/to/export node tools/run_ts.mjs tools/checks/class26.ts --game-dir ...
 *
 * `Class26Subtype67Update` (`FUN_0048F930`), `Class26Subtype67Draw`
 * (`FUN_0048FB40`) and `Class26Subtype67DrawOrKill` (`FUN_0048FD00`) are in
 * `src/game/class26/subtype67.ts`, and every number the port holds for them is
 * an immediate, a table word or a constant the image carries. Until they were
 * ported the two spawns built nothing and their seven models were on screen
 * only through the stage's "loaded, so drawn" rule, at the world's origin
 * (`L54`). What can each put that back:
 *
 *  * **The installer no longer routes 6 and 7 to the update, or stores it
 *    after the call.** The switch's arms are read out of the jump table.
 *  * **The switch's tables, the frames, the heights and the offsets drift
 *    from the port's.** Each is compared with the bytes of the instruction
 *    that carries it; the floats as 32-bit patterns.
 *  * **The slots drift.** Each `PUSH` of a slot is compared with the port's
 *    constant, and the exporter's list (`Class26DrawSlots`) with those.
 *  * **The bundle carries something else.** With an export, both of stage
 *    6's spawns have a placement and every slot they draw a `_slot_`
 *    template in `slots_actor`.
 *
 * The listing Ghidra shows across `0x0048FBA8`..`0x0048FBB8` is misaligned;
 * the bytes checked there are the ones the CPU decodes.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gameDirOrSkip, openGame, Checker, hex, f32Bits } from "../lib/exe_check";
import { BUNDLE_ROOT, skipNoBundle } from "../lib/bundle_root";
import * as evt from "../../src/hod2lib/evt";
import { Stage } from "../../src/hod2lib/stage";
import {
  SUBTYPE67_HOLD_FRAME, SUBTYPE67_HOLD_LIFT, SUBTYPE67_ONE_MODEL_FROM,
  SUBTYPE67_PATH_E9_Y, SUBTYPE67_PATH_LENGTH, SUBTYPE67_RIDE_FROM,
  SUBTYPE67_RIDE_UNTIL, SUBTYPE67_SECOND_COPY_AHEAD,
  SUBTYPE67_SECOND_COPY_FROM, SUBTYPE67_SECOND_COPY_STEP, SUBTYPE67_TOP_Y,
  SUB7_SWAP_FLAG, g_class26_path_by_selector,
} from "../../src/game/class26/subtype67";
import {
  CLASS26_SUB6_LIGHT, CLASS26_SUB6_SLOT, CLASS26_SUB6_SLOT_BESIDE,
  CLASS26_SUB6_SLOT_LATCHED, CLASS26_SUB6_SLOT_LIT, CLASS26_SUB7_FIXED_SLOT,
  CLASS26_SUB7_FIXED_SLOT_FLAGGED, CLASS26_SUB7_SLOT, Class26DrawSlots,
} from "../../src/game/class26/state";

const INSTALL = 0x0048e290;

/** `[address, bytes, what]` -- instructions the port's reading rests on. */
const BYTES: [number, string, string][] = [
  [0x0048e319, "e81216000083c404c70630f94800",
   "the installer calls 0x0048F930 and THEN stores it at obj+0x00"],
  [0x0048f945, "662d0600", "SUB AX, 0x6: the selector is the subtype less six"],
  [0x0048f955, "0fbf0455b4035700", "MOVSX EAX, word ptr [EDX*2 + 0x5703B4]: the path table"],
  [0x0048f982, "81c123ffffff83f90e0f871a010000",
   "ADD ECX, -0xDD; CMP ECX, 0xE; JA: the switch covers 0xDD..0xEB"],
  [0x0048f9d5, "dc05984c4c00", "FADD double ptr [0x004C4C98]: the held pose's lift"],
  [0x0048fa4a, "8b0d10619a00", "the ride reloads g_cam_path_frame after the 0x1320 store"],
  [0x0048fa40, "c7862013000001000000", "MOV dword ptr [ESI+0x1320], 1"],
  [0x0048fa58, "8b1485386d5700", "MOV EDX, [EAX*4 + 0x576D38]: g_cam_path_length"],
  [0x0048fa1a, "c70640fb4800", "the ride's end installs 0x0048FB40"],
  [0x0048fb07, "c70600fd4800", "the Boss / 0xE9 arms install 0x0048FD00, after the call"],
  [0x0048fb9f, "a031729c00", "MOV AL, [0x009C7231]: g_script_flags[0x31]"],
  [0x0048fba7, "84c07507", "TEST AL, AL; JNZ: 0x7E9 only while the flag is down"],
  [0x0048fbb2, "66833d485c9a0000750d",
   "CMP word ptr [g_accuracy_stats_suppressed], 0; JNZ past 0x7EB"],
  [0x0048fbed, "8b862013000083c41083f801750f",
   "subtype 6 tests obj+0x1320 == 1"],
  [0x0048fc59, "e852eff8ff", "CALL NoOpStub(43.415): dead"],
  [0x0048fc7c, "e83fe0f8ff", "CALL LightsRestoreScene straight after the lit draw"],
  [0x0048fcc1, "d80dac434c00d84648d805acd25500",
   "FMUL [0x004C43AC]; FADD [ESI+0x48]; FADD [0x0055D2AC]: the second copy's z"],
  [0x0048fd0a, "3dec0000007507e82a730100",
   "the draw-or-kill: CMP path, 0xEC; JNZ; CALL ActorKill"],
];

/** `[address of the imm32, value, what]` -- slots and literals in `PUSH`es. */
const IMM32: [number, number, string][] = [
  [0x0048fb75, CLASS26_SUB7_SLOT, "subtype 7's slot, in the draw"],
  [0x0048fd40, CLASS26_SUB7_SLOT, "...and in the draw-or-kill"],
  [0x0048fbac, CLASS26_SUB7_FIXED_SLOT, "subtype 7's fixed-point slot"],
  [0x0048fbbd, CLASS26_SUB7_FIXED_SLOT_FLAGGED, "...once flag 0x31 is up"],
  [0x0048fbfc, CLASS26_SUB6_SLOT_LATCHED, "subtype 6's one model"],
  [0x0048fcdf, CLASS26_SUB6_SLOT_LATCHED, "...its second copy"],
  [0x0048fd6e, CLASS26_SUB6_SLOT_LATCHED, "...and in the draw-or-kill"],
  [0x0048fc0b, CLASS26_SUB6_SLOT, "subtype 6's first model"],
  [0x0048fc23, CLASS26_SUB6_SLOT_BESIDE, "the one 153 along x"],
  [0x0048fc70, CLASS26_SUB6_SLOT_LIT, "the one under the light colour"],
  [0x0048fc98 + 1, 0x009a6110, "the second copy's test reads g_cam_path_frame"],
  [0x0048fc9d, SUBTYPE67_SECOND_COPY_FROM, "...against 0x56E"],
  [0x0048fcb5, (-SUBTYPE67_SECOND_COPY_FROM) >>> 0, "...and counts from it"],
  [0x0048f9a8, SUBTYPE67_RIDE_FROM, "CMP ECX, 0x51E: the ride's start"],
  [0x0048fa0c, SUBTYPE67_RIDE_UNTIL, "CMP ECX, 0x629: the ride's end"],
  [0x0048fa32, SUBTYPE67_ONE_MODEL_FROM, "CMP ECX, 0x578: obj+0x1320 from here"],
];

/** `[address of the f32 bits, value, what]`. */
const F32: [number, number, string][] = [
  [0x0048f95f, SUBTYPE67_HOLD_FRAME, "PUSH 1310.0 (Boss arm)"],
  [0x0048f9bf, SUBTYPE67_HOLD_FRAME, "PUSH 1310.0 (0xDD arm)"],
  [0x0048faca, SUBTYPE67_HOLD_FRAME, "PUSH 1310.0 (0xE9 arm)"],
  [0x0048f970, SUBTYPE67_TOP_Y, "Boss Mode's y, 2781.1"],
  [0x0048fa15, SUBTYPE67_TOP_Y, "the ride's end y"],
  [0x0048fcd4, SUBTYPE67_TOP_Y, "the second copy's y"],
  [0x0048fadb, SUBTYPE67_PATH_E9_Y, "paths 0xE9..0xEB's y, 2790.1"],
  [0x0048fc66, CLASS26_SUB6_LIGHT[0], "SetRenderLightColour's red"],
  [0x0048fc61, CLASS26_SUB6_LIGHT[1], "...green"],
  [0x004c43ac, SUBTYPE67_SECOND_COPY_STEP, "the second copy's step"],
  [0x0055d2ac, SUBTYPE67_SECOND_COPY_AHEAD, "...and its lead"],
];

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

async function main(): Promise<void> {
  const dir = gameDirOrSkip("class26");
  const { source, exe } = await openGame(dir);
  const c = new Checker("class26");
  const bytesAt = (va: number, n: number): Uint8Array | null => {
    const r = exe.v2r(va);
    return r === null ? null : exe.data.subarray(r, r + n);
  };

  // -- the installer's switch -------------------------------------------------
  // `MOVSX EAX, word [ESI+0x11C]; CMP EAX, 7; JA; JMP [EAX*4 + table]`: read
  // the table the installer jumps through and check arms 6 and 7 land on the
  // call of the update. The table's address is the JMP's operand.
  const code = bytesAt(INSTALL, 0x40);
  const jmp = code ? hexBytes(code).indexOf("ff2485") : -1;
  const table = code && jmp >= 0 ? exe.ru32(INSTALL + jmp / 2 + 3) : null;
  c.ok(table !== null, `the installer jumps through a table (${table === null ? "none" : hex(table, 8)})`);
  if (table !== null) {
    const arm = (k: number) => exe.ru32(table + k * 4);
    c.eq(arm(6), 0x0048e318, "arm 6 is the call of 0x0048F930");
    c.eq(arm(7), 0x0048e318, "...and so is arm 7");
    c.ok(arm(2) !== arm(6) && arm(5) !== arm(6),
         "and no other subtype's arm lands there (2 and 5 checked)");
  }
  for (const [addr, want, what] of BYTES) {
    const got = bytesAt(addr, want.length / 2);
    c.ok(got !== null && hexBytes(got) === want,
         `${hex(addr, 8)} is ${got ? hexBytes(got) : "nothing"}: ${what}`);
  }
  for (const [addr, want, what] of IMM32) {
    c.eq(exe.ru32(addr), want >>> 0, `imm32 at ${hex(addr, 8)}: ${what}`);
  }
  for (const [addr, want, what] of F32) {
    const got = exe.rf32(addr);
    c.ok(got !== null && f32Bits(got) === f32Bits(want),
         `f32 at ${hex(addr, 8)} is ${String(got)}: ${what}`);
  }
  const lift = bytesAt(0x004c4c98, 8);
  c.ok(lift !== null
       && new DataView(lift.buffer, lift.byteOffset, 8).getFloat64(0, true)
         === SUBTYPE67_HOLD_LIFT,
       "the double at 0x004C4C98 is the held pose's 0.5");
  // The update's switch: the byte map at 0x0048FB24 into the four targets.
  const map = bytesAt(0x0048fb24, 15);
  c.eq(map ? hexBytes(map) : "", "000301030303030303030303020202",
       "the byte map sends 0xDD to 0, 0xDF to 1, 0xE9..0xEB to 2, the rest to 3");
  c.eq(exe.ru32(0x0048fb14), 0x0048f9ae, "target 0 is the held arm");
  c.eq(exe.ru32(0x0048fb18), 0x0048f9a0, "target 1 is 0xDF's arm");
  c.eq(exe.ru32(0x0048fb1c), 0x0048fab9, "target 2 is 0xE9..0xEB's arm");
  c.eq(exe.ru32(0x0048fb20), 0x0048faab, "target 3 is the bare draw");
  // The path table and the lengths at its two paths.
  for (let k = 0; k < g_class26_path_by_selector.length; k++) {
    const p = g_class26_path_by_selector[k];
    c.eq(exe.ru16(0x005703b4 + k * 2), p,
         `g_class26_path_by_selector[${k}] is ${hex(p)}`);
    c.eq(exe.ru32(0x00576d38 + p * 4), SUBTYPE67_PATH_LENGTH[p],
         `g_cam_path_length[${hex(p)}] is the port's ${SUBTYPE67_PATH_LENGTH[p]}`);
  }
  c.eq(exe.ru32(0x0048fb9f + 1), 0x009c7200 + SUB7_SWAP_FLAG,
       `subtype 7's flag is g_script_flags[${hex(SUB7_SWAP_FLAG)}]`);
  c.eq([...Class26DrawSlots(6), ...Class26DrawSlots(7)].sort().join(),
       [CLASS26_SUB6_SLOT, CLASS26_SUB6_SLOT_LATCHED, CLASS26_SUB6_SLOT_BESIDE,
        CLASS26_SUB6_SLOT_LIT, CLASS26_SUB7_SLOT, CLASS26_SUB7_FIXED_SLOT,
        CLASS26_SUB7_FIXED_SLOT_FLAGGED].sort().join(),
       "the exporter's list is the seven slots the two draws push");

  // -- stage 6: the spawns, the placements, the models -----------------------
  const st = await Stage.create(source, { stage: 6, original: false });
  const ev = await st.evt();
  const recs = ev ? evt.spawns(ev).filter((r) => r.cls === 0x26
                                          && (r.hp === 6 || r.hp === 7)) : [];
  c.eq(recs.map((r) => `${hex(r.offset)}:${r.hp}`).join(" "),
       "0x46A8:6 0x46CC:7",
       "stage 6's evt carries the pair, subtype 6 at 0x46A8 and 7 at 0x46CC");
  const manifestPath = join(BUNDLE_ROOT, "manifest.json");
  if (!existsSync(manifestPath)) {
    if (c.failed) c.finish();
    skipNoBundle("class26 (the routines and the evt above were checked)");
  }
  const entries = (JSON.parse(readFileSync(manifestPath, "utf8")) as {
    stages: { name: string; script: string; geometry: string }[] }).stages;
  for (const name of ["stage6", "stage6_original"]) {
    const e = entries.find((x) => x.name === name);
    if (!c.ok(e !== undefined, `${name} is in the bundle`)) continue;
    const script = JSON.parse(readFileSync(join(BUNDLE_ROOT, name, e!.script),
                                           "utf8")) as {
      characters?: { placements?: { at: number; hp?: number;
                                    class26?: unknown }[] } };
    const pls = script.characters?.placements ?? [];
    for (const r of recs) {
      const pl = pls.find((p) => p.at === r.offset);
      c.ok(!!pl && pl.hp === r.hp && !!pl.class26,
           `${name}: ${hex(r.offset)} is placed with subtype ${r.hp} and a class26 block`);
    }
    const nodes = new Set<number>();
    for (const n of glbJson(join(BUNDLE_ROOT, name, e!.geometry)).nodes ?? []) {
      const m = /^slots_actor_.*_slot_([0-9a-f]{4})$/.exec(n.name ?? "");
      if (m) nodes.add(Number.parseInt(m[1]!, 16));
    }
    const missing = [6, 7].flatMap((s) => Class26DrawSlots(s))
      .filter((s) => !nodes.has(s));
    c.ok(missing.length === 0,
         `${name}: every slot the pair draws has a slots_actor template`
         + (missing.length ? `; not ${missing.map((s) => hex(s, 4)).join(", ")}` : ""));
  }
  c.finish();
}

await main();
