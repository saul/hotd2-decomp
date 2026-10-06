/**
 * Class 0x13's carrier selectors 3, 4, 5, 7 and 8 are the routines the port
 * runs, with the routines' own numbers, and stage 4 ships everything they
 * draw; routines 1 and 6 leave state 6 through the screen test.
 *
 *     node tools/run_ts.mjs tools/checks/carrier_routines.ts --game-dir ~/"THE HOUSE OF THE DEAD 2"
 *     HOTD2_BUNDLE=/path/to/export node tools/run_ts.mjs tools/checks/carrier_routines.ts --game-dir ...
 *
 * `CarrierPropRoutine4` (`FUN_00440C20`, selectors 4 and 7) and
 * `CarrierPropRoutine5` (`FUN_00441000`, 5 and 8) pose stage 4's two set
 * models, `st4_09.bin[0]` and `[2]`, on `op_` paths `0x176` and `0x177` and
 * play effects `0x15` and `0x18` beside them. The stage used to draw the two
 * models itself because the script had loaded them (`L54`, `L96`); with that
 * gone, a misread here is a set that is simply missing. Held:
 *
 *  * **the installer's arms**: `CarrierPropSelectRoutine` stores `0x440AD0`
 *    for 3, `0x440C20` for 4 and 7 and `0x441000` for 5 and 8;
 *  * **`CarrierPropRoutine3`** (`FUN_00440AD0`, stage 4's monitor): its
 *    cursor's bounds, its sound, its alpha step and floor, its frame and its
 *    hold, its layer and its kill; and **routines 1 and 6's exit**: the call
 *    of `CarriedPropIsOnScreen` (`FUN_004459C0`), `0x4000000` and state 7;
 *  * **the instructions the port's constants come from**, byte for byte, and
 *    the `.data` the routines read -- the offsets, `g_cam_path_length[0x176]`
 *    and `[0x177]`, `g_motion_play_length[0x1CC]` and `[0x1CD]`;
 *  * **with a bundle**: stage 4 places all five spawns with those selectors,
 *    ships the four effect records keyed `"<effect>@<motion>"`, both object
 *    paths, and a template for every slot the two routines can draw.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gameDirOrSkip, openGame, Checker, hex, f32Bits } from "../lib/exe_check";
import { BUNDLE_ROOT, skipNoBundle } from "../lib/bundle_root";
import { effectTree } from "../../src/hod2lib/props";
import {
  CARRIER4_EFFECT, CARRIER4_SPRITE_FIRST, CARRIER4_SPRITE_LAST,
  CARRIER5_EFFECT, CARRIER_FX_MOTION_A, CARRIER_FX_MOTION_B,
  CARRIER_SELECTORS_PORTED, CarrierDrawSlots, CarrierEffects,
} from "../../src/game/class13/state";
import {
  CARRIER4_FX_A_AT, CARRIER4_FX_B_AT, CARRIER4_OFFSET_X, CARRIER4_OFFSET_Y,
  CARRIER4_OFFSET_Z, CARRIER4_PATH, CARRIER4_PATH_LENGTH, CARRIER4_SLOT,
  CARRIER4_SPRITE_AT, CARRIER4_WAIT_FRAME, CARRIER4_WAIT_PATH,
  CARRIER_FX_PLAY_LENGTH, SFX_CARRIER4_CUE, SFX_CARRIER4_LAND_A,
  SFX_CARRIER4_LAND_B, SFX_CARRIER4_START,
} from "../../src/game/class13/routine4";
import {
  CARRIER5_FX_A_AT, CARRIER5_FX_B_AT, CARRIER5_FX_YAW, CARRIER5_OFFSET_X,
  CARRIER5_OFFSET_Z, CARRIER5_PATH, CARRIER5_PATH_LENGTH, CARRIER5_SPRITE_AT,
  CARRIER5_WAIT_FRAME, CARRIER5_WAIT_PATH,
} from "../../src/game/class13/routine5";
import {
  CARRIER3_ALPHA_DIM, CARRIER3_ALPHA_STEP, CARRIER3_CURSOR_FIRST,
  CARRIER3_CURSOR_LAST, CARRIER3_DRAW_LAYER, CARRIER3_HOLD,
  CARRIER3_WAIT_FRAME, SFX_CARRIER3_START,
} from "../../src/game/class13/routine3";

/** `[address, bytes, what]`. */
const BYTES: [number, string, string][] = [
  [0x004401bf, "c700d00a4400", "selector 3 installs 0x440AD0"],
  [0x004401cd, "c700200c4400", "selectors 4 and 7 install 0x440C20"],
  [0x004401d4, "c70000104400", "selectors 5 and 8 install 0x441000"],
  // CarrierPropRoutine3
  [0x00440aee, "ff2495000c4400", "its own jump table, at 0x00440C00"],
  [0x00440af5, "6a08", "ActorAllocSub(8), the block"],
  [0x00440aff, "c70058090000", "ride+0 = 0x958"],
  [0x00440b09, "68a91b2f00", "PlaySoundId(0x2F1BA9), MONITOR3"],
  [0x00440b0e, "c746180000803f", "sub+0x18, the alpha, = 1.0"],
  [0x00440b21, "81fa5d090000", "the cursor climbs to 0x95D"],
  [0x00440b2e, "6a09", "SetDrawLayerNibble(9)"],
  [0x00440b3f, "d825f8445600", "alpha -= [0x005644F8]"],
  [0x00440b48, "d81df4445600", "...down to [0x005644F4]"],
  [0x00440b56, "c746183333333f", "...where it is set to 0.7"],
  [0x00440b6d, "813d10619a00df010000", "g_cam_path_frame against 0x1DF"],
  [0x00440b79, "c74004b9000000", "ride+4 = 0xB9"],
  [0x00440bb0, "d805f8445600", "alpha += [0x005644F8]"],
  [0x00440bb9, "d81d80434c00", "...up to 1.0"],
  [0x00440be0, "81fa58090000", "the cursor falls to 0x958"],
  [0x00440bf7, "e844640600", "state 7: CALL ActorKill (0x004A7040)"],
  // CarrierPropRoutine1 and 6: state 6's screen test
  [0x00440712, "e8a9520000", "routine 1: CALL 0x004459C0"],
  [0x00440725, "0d00000004", "...OR 0x4000000 into obj+0x34"],
  [0x0044072d, "66c7430c0700", "...and state 7"],
  [0x004416f2, "e8c9420000", "routine 6: CALL 0x004459C0"],
  [0x00441705, "0d00000004", "...OR 0x4000000 into obj+0x34"],
  [0x0044170d, "66c7430c0700", "...and state 7"],
  // CarrierPropRoutine4
  [0x00440c44, "6a58", "ActorAllocSub(0x58), the ride block"],
  [0x00440c53, "c70615000000", "ride+0 = effect 0x15"],
  [0x00440c59, "c74604cd010000", "ride+4 = motion 0x1CD"],
  [0x00440c60, "c74654f01a0000", "ride+0x54 = the strip's first cel 0x1AF0"],
  [0x00440c6a, "833807", "the parked selector, 7"],
  [0x00440c76, "6876010000", "PUSH 0x176, the object path"],
  [0x00440c6f, "8b0d10735700", "g_cam_path_length[0x176]"],
  [0x00440cb3, "68a91b1a00", "PlaySoundId(0x1A1BA9)"],
  [0x00440cc4, "833d8c8e9c001e", "shake below 0x1E..."],
  [0x00440ccd, "c7058c8e9c0028000000", "...set to 0x28"],
  [0x00440cfe, "68a91b1b00", "PlaySoundId(0x1B1BA9)"],
  [0x00440d08, "68a91b1c00", "PlaySoundId(0x1C1BA9)"],
  [0x00440daf, "680020cbc4", "the strip's z, -1625"],
  [0x00440db4, "6800002c42", "...its y, 43"],
  [0x00440db9, "680000c8c1", "...selector 4's x, -25"],
  [0x00440e05, "680000f041", "Scale(30, s, 1)"],
  [0x00440e2e, "3df91a0000", "the strip's last cel, 0x1AF9"],
  [0x00440e4b, "813d782d9a00b9000000", "wait for camera path 0xB9..."],
  [0x00440e5b, "813d10619a00e7000000", "...at frame 0xE7"],
  [0x00440e70, "813d10619a00cc010000", "the first cue, frame 0x1CC"],
  [0x00440e7c, "68a91b1e00", "PlaySoundId(0x1E1BA9)"],
  [0x00440e9c, "3d58020000", "the first clip draws below 0x258"],
  [0x00440eb8, "68f6b0d2c4", "...at z -1685.53"],
  [0x00440ebd, "68d8f02942", "...y 42.4852"],
  [0x00440ec2, "6857ac9743", "...x 303.346"],
  [0x00440ef5, "813d10619a00d6010000", "...and steps from 0x1D6"],
  [0x00440f0a, "3d20030000", "the second clip from 0x320"],
  [0x00440f15, "c74604cc010000", "...on motion 0x1CC"],
  [0x00440f33, "813d10619a00c0030000", "its cue, 0x3C0"],
  [0x00440f6f, "6846def7c4", "...drawn at z -1982.95"],
  [0x00440f79, "68f464a343", "...x 326.789"],
  [0x00440fa8, "813d10619a00ca030000", "...stepping from 0x3CA"],
  [0x00440fcb, "66c783f40100005409", "frame 0x38E writes 0x954 into obj+0x1F4"],
  // CarrierPropRoutine5
  [0x00441033, "c70618000000", "ride+0 = effect 0x18"],
  [0x00441039, "c74604cc010000", "ride+4 = motion 0x1CC"],
  [0x0044104a, "833808", "the parked selector, 8"],
  [0x00441056, "6877010000", "PUSH 0x177, the object path"],
  [0x0044104f, "8b0d14735700", "g_cam_path_length[0x177]"],
  [0x00441181, "680080b1c3", "selector 5's strip x, -355"],
  [0x00441210, "813d782d9a00c1000000", "wait for camera path 0xC1..."],
  [0x00441220, "813d10619a00c3010000", "...at frame 0x1C3"],
  [0x00441240, "813d10619a0008020000", "the first cue, 0x208"],
  [0x0044126c, "3d8a020000", "the first clip below 0x28A"],
  [0x00441288, "68c3ade4c4", "...at z -1829.43"],
  [0x0044128d, "68f1f42942", "...y 42.4892"],
  [0x00441292, "68df4f68c3", "...x -232.312"],
  [0x0044129c, "6800800000", "...turned 0x8000"],
  [0x004412cf, "813d10619a0012020000", "...stepping from 0x212"],
  [0x004412f4, "c74604cd010000", "the second clip on motion 0x1CD"],
  [0x00441309, "813d10619a00ca030000", "its cue, 0x3CA"],
  [0x00441345, "68004003c5", "...drawn at z -2100"],
  [0x0044134f, "68fadebac3", "...x -373.742"],
  [0x00441388, "813d10619a00d4030000", "...stepping from 0x3D4"],
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
  const dir = gameDirOrSkip("carrier_routines");
  const { exe } = await openGame(dir);
  const c = new Checker("carrier_routines");
  const bytesAt = (va: number, n: number): Uint8Array | null => {
    const r = exe.v2r(va);
    return r === null ? null : exe.data.subarray(r, r + n);
  };

  for (const [addr, want, what] of BYTES) {
    const got = bytesAt(addr, want.length / 2);
    c.ok(got !== null && hexBytes(got) === want,
         `${hex(addr, 8)} is ${got ? hexBytes(got) : "nothing"} (${want}): ${what}`);
  }

  // -- the port's constants against the image --------------------------------
  const f32 = (va: number) => exe.rf32(va);
  const same = (va: number, v: number) => {
    const got = f32(va);
    return got !== null && f32Bits(got) === f32Bits(v);
  };
  c.ok(same(0x00564508, CARRIER4_OFFSET_X) && same(0x00564504, CARRIER4_OFFSET_Y)
       && same(0x00564500, CARRIER4_OFFSET_Z),
       "CARRIER4_OFFSET_X/Y/Z are the floats at 0x00564508/04/00");
  c.ok(same(0x00564510, CARRIER5_OFFSET_X) && same(0x0056450c, CARRIER5_OFFSET_Z),
       "CARRIER5_OFFSET_X/Z are the floats at 0x00564510/0C");
  c.eq(exe.ru32(0x00577310), CARRIER4_PATH_LENGTH, "g_cam_path_length[0x176]");
  c.eq(exe.ru32(0x00577314), CARRIER5_PATH_LENGTH, "g_cam_path_length[0x177]");
  c.eq(exe.ru16(0x004e07d0 + CARRIER_FX_MOTION_A * 2), CARRIER_FX_PLAY_LENGTH,
       "g_motion_play_length[0x1CD]");
  c.eq(exe.ru16(0x004e07d0 + CARRIER_FX_MOTION_B * 2), CARRIER_FX_PLAY_LENGTH,
       "g_motion_play_length[0x1CC]");
  const imm = (va: number) => exe.ru32(va);
  c.ok(imm(0x00440c77) === CARRIER4_PATH && imm(0x00441057) === CARRIER5_PATH,
       "CARRIER4_PATH and CARRIER5_PATH are the PUSHes");
  c.ok([0x00440ebe, 0x00440eb9].map(imm).join() ===
       [f32Bits(CARRIER4_FX_A_AT[1]), f32Bits(CARRIER4_FX_A_AT[2])].join()
       && imm(0x00440ec3) === f32Bits(CARRIER4_FX_A_AT[0])
       && imm(0x00440f7a) === f32Bits(CARRIER4_FX_B_AT[0])
       && imm(0x00440f70) === f32Bits(CARRIER4_FX_B_AT[2]),
       "CARRIER4_FX_A_AT and _B_AT are the PUSHes");
  c.ok(imm(0x00441293) === f32Bits(CARRIER5_FX_A_AT[0])
       && imm(0x0044128e) === f32Bits(CARRIER5_FX_A_AT[1])
       && imm(0x00441289) === f32Bits(CARRIER5_FX_A_AT[2])
       && imm(0x00441350) === f32Bits(CARRIER5_FX_B_AT[0])
       && imm(0x00441346) === f32Bits(CARRIER5_FX_B_AT[2])
       && imm(0x0044129d) === CARRIER5_FX_YAW,
       "CARRIER5_FX_A_AT, _B_AT and the half turn are the PUSHes");
  c.ok(imm(0x00440dba) === f32Bits(CARRIER4_SPRITE_AT[0])
       && imm(0x00441182) === f32Bits(CARRIER5_SPRITE_AT[0])
       && imm(0x00440db5) === f32Bits(CARRIER4_SPRITE_AT[1])
       && imm(0x00440db0) === f32Bits(CARRIER4_SPRITE_AT[2]),
       "the strips' anchors are the PUSHes");
  c.ok(imm(0x00440e51) === CARRIER4_WAIT_PATH && imm(0x00440e61) === CARRIER4_WAIT_FRAME
       && imm(0x00441216) === CARRIER5_WAIT_PATH
       && imm(0x00441226) === CARRIER5_WAIT_FRAME,
       "the waits' path and frame are the compares'");
  c.ok(imm(0x00440cb4) === SFX_CARRIER4_START && imm(0x00440cff) === SFX_CARRIER4_LAND_A
       && imm(0x00440d09) === SFX_CARRIER4_LAND_B && imm(0x00440e7d) === SFX_CARRIER4_CUE,
       "the four sound ids are the PUSHes");
  c.eq(exe.ru16(0x00440fd2), CARRIER4_SLOT, "CARRIER4_SLOT is the MOV's word");
  c.ok(CarrierEffects(4).join() === [[CARRIER4_EFFECT, 0x1cd], [CARRIER4_EFFECT, 0x1cc]].join()
       && CarrierEffects(5).join() === [[CARRIER5_EFFECT, 0x1cc], [CARRIER5_EFFECT, 0x1cd]].join(),
       "each routine's effect plays its two motions in the routine's order");
  c.ok([3, 4, 5, 7, 8].every((s) => CARRIER_SELECTORS_PORTED.has(s)),
       "the exporter ships the five selectors' models");
  // CarrierPropRoutine3's constants against the instructions above.
  c.ok(same(0x005644f8, CARRIER3_ALPHA_STEP) && same(0x005644f4, CARRIER3_ALPHA_DIM),
       "CARRIER3_ALPHA_STEP and _DIM are the floats at 0x005644F8/F4");
  c.ok(imm(0x00440b01) === CARRIER3_CURSOR_FIRST && imm(0x00440be2) === CARRIER3_CURSOR_FIRST
       && imm(0x00440b23) === CARRIER3_CURSOR_LAST && imm(0x00440b0a) === SFX_CARRIER3_START
       && imm(0x00440b73) === CARRIER3_WAIT_FRAME && imm(0x00440b7c) === CARRIER3_HOLD
       && bytesAt(0x00440b2f, 1)?.[0] === CARRIER3_DRAW_LAYER,
       "CarrierPropRoutine3's cursor bounds, sound, frame, hold and layer are its immediates");

  // -- the bundle -------------------------------------------------------------
  const manifestPath = join(BUNDLE_ROOT, "manifest.json");
  if (!existsSync(manifestPath)) {
    if (c.failed) c.finish();
    skipNoBundle("carrier_routines (the image and the port were checked)");
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    stages: { name: string; script: string; geometry: string; cam?: string }[] };
  const SPAWNS: [number, number, number][] = [
    [0x8c4c, 3, 0x966], [0x8cf0, 4, 0x954], [0x9d40, 5, 0x956], [0xa7e4, 7, 0x954], [0xac7c, 8, 0x956]];
  for (const entry of manifest.stages) {
    if (!/^stage4(_original)?$/.test(entry.name)) continue;
    const script = JSON.parse(readFileSync(join(BUNDLE_ROOT, entry.name, entry.script),
                                           "utf8")) as {
      characters?: { placements?: { at: number; class13?: { selector?: number;
                                                             slot?: number } }[] };
      breakables?: { effects?: Record<string, { motion: number; play_length: number }> };
    };
    const pls = script.characters?.placements ?? [];
    for (const [at, sel, slot] of SPAWNS) {
      const p = pls.find((q) => q.at === at && q.class13);
      c.ok(p?.class13?.selector === sel && p.class13.slot === slot,
           `${entry.name}: evt ${hex(at)} is class 0x13 selector ${sel} drawing ${hex(slot, 4)}`);
    }
    const effects = script.breakables?.effects ?? {};
    for (const sel of [4, 5]) {
      for (const [e, m] of CarrierEffects(sel)) {
        const d = effects[`${e}@${m}`];
        c.ok(d?.motion === m && d.play_length === CARRIER_FX_PLAY_LENGTH,
             `${entry.name}: effect ${hex(e)} ships with motion ${hex(m)}`);
      }
    }
    const nodes = new Set<number>();
    for (const n of glbJson(join(BUNDLE_ROOT, entry.name, entry.geometry)).nodes ?? []) {
      const mm = /^slots_actor_.*_slot_([0-9a-f]{4})$/.exec(n.name ?? "");
      if (mm) nodes.add(parseInt(mm[1]!, 16));
    }
    const want = new Set<number>([0x954, 0x956, 0x966, ...CarrierDrawSlots(4),
                                  ...CarrierDrawSlots(5)]);
    for (const e of [CARRIER4_EFFECT, CARRIER5_EFFECT]) {
      for (const n of effectTree(exe, e)) if (n.slot) want.add(n.slot);
    }
    const missing = [...want].filter((s) => !nodes.has(s));
    c.ok(missing.length === 0,
         `${entry.name}: slots_actor carries all ${want.size} slots the two routines draw`
         + (missing.length ? `; not ${missing.map((s) => hex(s, 4)).join(", ")}` : ""));
    c.ok(CarrierDrawSlots(4)[0] === CARRIER4_SPRITE_FIRST
         && CarrierDrawSlots(4).at(-1) === CARRIER4_SPRITE_LAST,
         "the strip is 0x1AF0..0x1AF9");
  }
  c.finish();
}

await main();
