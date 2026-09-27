/**
 * Class 0x22's `.rdata` — every table `Class22Init` (`FUN_0049B0D0`) and its
 * states index, as cited constants.
 *
 * **Data only, and imported by the exporter**: `hod2lib/characters.ts` reads
 * the clip lists below to bake them, so this file imports nothing from
 * `game/`. The records are one class's own constants, which is the
 * `boss_banner_records.ts` / class 0x19 precedent rather than the bundle's
 * "`.rdata` travels" rule: nothing but this class reads them, and nothing
 * the exporter writes is joined to them except the clips, which it bakes.
 *
 * ## One block of bytes, not twelve arrays
 *
 * The tables from `0x00570BE0` to `0x00570EC3` are contiguous, and one of
 * the class's readers does not respect their boundaries:
 * `Class22Death` (`FUN_0049C910`) sub 4 lands the body with
 * `FADD float ptr [EAX*0x4 + 0x570c78]` at `0x0049CB65`, indexed by the clip
 * counter. The nine-float `g_class22_landing_bounce` at `0x00570E88` is what
 * a counter of `0x84`..`0x8C` reads, but a landing with the counter anywhere
 * from `0x1D` up reads `g_class22_path_keys`, the pick tables and the speed
 * table **as floats**. So the port carries the block as the image holds it
 * and reads every table out of it — the landing arithmetic then works over
 * the same bytes the engine's does, whatever the counter. Read from the image
 * with Ghidra's `read_memory`, 0x2E4 bytes from `0x00570BE0`.
 */

/** The bytes at `0x00570BE0`..`0x00570EC3`, little-endian, as the image holds them. */
const CLASS22_RDATA_HEX =
  "0b04110410040c040a0413040e040d04160400001304400014042e0008040904"
  + "120010000f0013001400000000000243000082420000b4420000b4420000f042"
  + "000070420000dc420000dc420000dc420000dc420000f042000070420000f042"
  + "0000704200000243000082420000f042000070420000e6420000e6420000a042"
  + "0000a0420000a0420000a0420000e642000070420000e642000070420000be42"
  + "0000be420000b4420000b44200000243000082420000b4420000b4420000dc42"
  + "0000dc420000dc420000dc420000f042000070420000f0420000704200000243"
  + "000082420000e6420000e6420000a0420000a0420000a0420000a0420000be42"
  + "000082420000ba420000ba420000ba420000ba420000ba420000ba420000c642"
  + "0000c6420000c6420000c6420000c6420000c642000002000500060007000800"
  + "0c000d000e000f0010001400150016001a0010001400150016001a0001000300"
  + "040009000a000b00010003000400090011001200130017001800190011001200"
  + "1300170064005a00500046003c0032003200280028001e001e00140014000a00"
  + "0a000000cdcc4c3fcdcc4c3f6666663f6666663f0000803f0000803f0000803f"
  + "0000803f0000803fcdcc8c3f9a99993f9a99993f6666a63f6666a63f3333b33f"
  + "3333b33f0000803fcdcc8c3f9a99993f6666a63f3333b33f0000c03f0000c03f"
  + "0000c03fcdcccc3fcdcccc3f9a99d93f9a99d93f6666e63f3333f33f00000040"
  + "0000004000000000000000000100010001000200020002000300030003000400"
  + "0400040000000100020002000200020003000300030003000000000001000100"
  + "0200020002000300030003000000000000000100010001000200020003000300"
  + "0000000000000000010001000100010002000300000000000000000000000100"
  + "0100010001000100cdccec403333d3409a999140000080406666464033333340"
  + "9a9919406666e63f6666a63fcdcc8c3fcdcc8c3fcdcc8c3fcdcc8c3f00007041"
  + "0000803f";

/** Where {@link CLASS22_RDATA_HEX} starts in the image. */
const CLASS22_RDATA_BASE = 0x00570be0;

const RDATA: DataView = (() => {
  const n = CLASS22_RDATA_HEX.length / 2;
  const b = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    b[i] = parseInt(CLASS22_RDATA_HEX.slice(i * 2, i * 2 + 2), 16);
  }
  return new DataView(b.buffer);
})();

/**
 * One `float` of the block, by its image address — `float ptr [va]`. `NaN`
 * outside the block, which no shipped landing reaches (see the module note).
 * `[port-only]` as a function.
 */
export function Class22RdataF32(va: number): number {
  const off = va - CLASS22_RDATA_BASE;
  if (off < 0 || off + 4 > RDATA.byteLength) return NaN;
  return RDATA.getFloat32(off, true);
}

/** One `short` of the block, by its image address — `MOVSX word ptr [va]`. `[port-only]` as a function. */
export function Class22RdataS16(va: number): number {
  const off = va - CLASS22_RDATA_BASE;
  if (off < 0 || off + 2 > RDATA.byteLength) return 0;
  return RDATA.getInt16(off, true);
}

function s16s(va: number, n: number): number[] {
  return Array.from({ length: n }, (_u, i) => Class22RdataS16(va + i * 2));
}
function f32s(va: number, n: number): number[] {
  return Array.from({ length: n }, (_u, i) => Class22RdataF32(va + i * 4));
}

/**
 * `g_class22_motion_ids` — `0x00570BE0`, s16: `+0` 0x40B the fighting idle
 * `Class22CutsceneHoldUntilChapterCard` returns to, `+2` 0x411, `+4` 0x410,
 * `+6` 0x40C, `+8` 0x40A the death, `+0xA` 0x413, `+0xC` 0x40E the taunt,
 * `+0xE` 0x40D, `+0x10` 0x416. The states load most of these by address
 * (`MOVSX EAX, word ptr [0x00570be8]` at `0x0049CA0D`) and push the rest as
 * immediates; the enum is named for the ids, which both spellings agree on.
 */
export enum Class22Clip {
  /** `ActorSetMotion(0x40A)` in `Class22Death` sub 1: the fall. */
  Death = 0x40a,
  /** `g_class22_motion_ids[0]`, the cutscene's idle. */
  Idle = 0x40b,
  /** Phase 2's attack pass. */
  Attack = 0x40c,
  /** Phase 2's hover. */
  Hover = 0x40d,
  /** Phase 1's taunt, `Class22FightPhase1` sub 10. */
  Taunt = 0x40e,
  /** The cutscene's take-off, `Class22CutsceneHoldUntilChapterCard` sub 1. */
  TakeOff = 0x40f,
  /** Phase 1's flight, and every flinch returns to it. */
  Fly = 0x410,
  /** The ride-in's glide. */
  Glide = 0x411,
  /** The cutscene's and the descent's turn. */
  Turn = 0x412,
  /** The cue clip at hit-point stage 0 — `g_class22_cue_motions[0]`. */
  Cue0 = 0x413,
  /** The cue clip at hit-point stage 1. */
  Cue1 = 0x414,
  /** The variant-0 cutscene's first clip, `tail+0x02` of `st1` `0x794`. */
  Cutscene = 0x415,
  /** The swoop -- `g_class22_motion_ids[+0x10]`. */
  Swoop = 0x416,
}

/**
 * `g_class22_cue_motions` — `0x00570BF4`, stride 4: `{0x413, 64}`,
 * `{0x414, 46}`, indexed by the hit-point stage. The second short is the
 * clip's play length; the class reads only the first.
 */
export const CLASS22_CUE_MOTIONS: readonly number[] =
  [Class22RdataS16(0x00570bf4), Class22RdataS16(0x00570bf8)];

/** `g_class22_flinch_motions` — `0x00570BFC`: 0x408, 0x409, by `rand() & 1`. */
export const CLASS22_FLINCH_MOTIONS: readonly number[] = s16s(0x00570bfc, 2);

/**
 * `g_class22_subactor_motions` — `0x00570C00`: 0x12, 0x10, 0x0F, 0x13, 0x14,
 * indexed by the sub-actor's `+0x1350`. `Class22DrawAndPoseSubActor` picks the
 * index from the flight speed.
 */
export const CLASS22_SUBACTOR_MOTIONS: readonly number[] = s16s(0x00570c00, 5);

/**
 * `g_class22_path_keys` — `0x00570C0C`, 33 `{f32 end, f32 key}` rows.
 * `end` is where a phase-1 path is done with; `key` is the point
 * `Class22EaseToNearestPathKey` (`FUN_0049DD90`) glides to. Paths `P` and
 * `P + 33` share row `P % 33`.
 */
export const CLASS22_PATH_KEYS: readonly { end: number; key: number }[] =
  Array.from({ length: 33 }, (_u, i) => ({
    end: Class22RdataF32(0x00570c0c + i * 8),
    key: Class22RdataF32(0x00570c10 + i * 8),
  }));

/**
 * `g_class22_phase1_path_picks` — `0x00570D14`, four rows of ten s16s:
 * `row = near + 2 * hot`, where `near` is the companion within 60.0 of the
 * camera and `hot` the aggression roll.
 */
export const CLASS22_PHASE1_PATH_PICKS: readonly number[] = s16s(0x00570d14, 40);

/**
 * `g_class22_aggression_roll` — `0x00570D64`, s16 by aggression 0..15:
 * 100 90 80 70 60 50 50 40 40 30 30 20 20 10 10 0.
 */
export const CLASS22_AGGRESSION_ROLL: readonly number[] = s16s(0x00570d64, 16);

/**
 * `g_class22_path_speed` — `0x00570D84`, f32 by `GetDamageRank() + 16 *
 * hit-point stage`: 0.8..1.4 at stage 0 and 1.0..2.0 at stage 1.
 */
export const CLASS22_PATH_SPEED: readonly number[] = f32s(0x00570d84, 32);

/** `g_class22_phase2_pick_rows` — `0x00570E04`, s16 by aggression. */
export const CLASS22_PHASE2_PICK_ROWS: readonly number[] = s16s(0x00570e04, 16);

/** `g_class22_phase2_picks` — `0x00570E24`, five rows of ten s16 path picks. */
export const CLASS22_PHASE2_PICKS: readonly number[] = s16s(0x00570e24, 50);

/**
 * `g_class22_cue_frames` — `0x00570EBC`: 15.0 and 1.0, by hit-point stage —
 * the `+0x1348` count `Class22FightPhase1` sub 7 cues its clip on.
 */
export const CLASS22_CUE_FRAMES: readonly number[] = f32s(0x00570ebc, 2);

/**
 * The base `Class22Death` sub 4 indexes: `float[0x00570C78 + counter * 4]`.
 * `g_class22_landing_bounce` (`0x00570E88`) is its entries `0x84`..`0x8C`.
 */
export const CLASS22_LANDING_BASE = 0x00570c78;

/**
 * `g_class22_node2_cycle_a` / `_b` — `0x00570F08` (10 bytes) and
 * `0x00570F14` (6 bytes), the offsets from slot `0x2A5` that
 * `Class22DrawBonePart` (`FUN_0049D980`) cycles node 2 through while
 * `+0x1338` is 1 or 2. Read as `04 05 06 07 06 05 04 03 02 03` and
 * `09 0a 0b 0c 0d 0e`.
 */
export const CLASS22_NODE2_CYCLE_A: readonly number[] =
  [4, 5, 6, 7, 6, 5, 4, 3, 2, 3];
export const CLASS22_NODE2_CYCLE_B: readonly number[] = [9, 10, 11, 12, 13, 14];
/** `0x2A5` — the slot the node-2 cycles count from, `ADD EAX, 0x2A5`. */
export const CLASS22_NODE2_SLOT_BASE = 0x2a5;

/**
 * The scalars after the tables, `0x00570F1C`..`0x00570F57`, read as
 * `00002a43 00007a43 00c01344 0000cd43 00009b43 cdcc8c3f 00000000
 * 7e1fac8a21d7213f cdccec40 008093c4 00c09ac4 00000000 000000000000 4e40`.
 */
/** `[0x00570F1C]` 170.0 — the cutscene's second wing-beat frame. */
export const CUTSCENE_FLAP_FRAME = 170;
/** `[0x00570F20]` 250.0 — `Class22CutsceneRideAndLeave`'s glide cue on 0x21. */
export const RIDE_LEAVE_GLIDE_FRAME = 250;
/** `[0x00570F24]` 591.0, `[0x00570F28]` 410.0, `[0x00570F2C]` 310.0 — the ride-in's cues. */
export const RIDE_IN_NODE2_OFF_FRAME = 591;
export const RIDE_IN_NODE2_ON_FRAME = 410;
export const RIDE_IN_GLIDE_FRAME = 310;
/** `[0x00570F30]` 1.1 — the lowest the dead flier sits above the ground. */
export const DEATH_REST_HEIGHT = Math.fround(1.1);
/** `[0x00570F38]` 1.3611111e-4, a **double** — the fall's jerk. */
export const DEATH_FALL_JERK = 1.3611111111111112e-4;
/** `[0x00570F40]` 7.4 — the height at which the fall becomes the bounce. */
export const DEATH_LAND_HEIGHT = Math.fround(7.4);
/** `[0x00570F44]` -1180.0 and `[0x00570F48]` -1238.0 — stage 5's z clamp. */
export const DEATH_STAGE5_Z_MAX = -1180;
export const DEATH_STAGE5_Z_MIN = -1238;
/** `[0x00570F50]` 60.0, a double — the companion's "near" distance. */
export const PICK_NEAR_DISTANCE = 60;

/** `0x45` — the flier's character type, a literal in `Class22Init` (`MOV word [EDI+0x60], 0x45` at `0x0049B113`). */
export const CLASS22_CHAR_TYPE = 0x45;
/** `0x46` — the sub-actor's, `MOV word [EBP+0x60], 0x46` at `0x0049B1A0`. */
export const CLASS22_SUBACTOR_CHAR_TYPE = 0x46;
/** `0x10` — the sub-actor's first clip, `MOV dword [EBP+0x20], 0x10` at `0x0049B1A9`. */
export const CLASS22_SUBACTOR_CLIP = 0x10;

/**
 * `[port-only]` — the spawn address the sub-actor is drawn from: the
 * flier's own with this bit set. The engine's is an `ActorAllocSub` with no
 * descriptor; the bundle carries a synthetic row at this address so the
 * client can bind geometry to it, as it does for the bat's wing (`0x40000000`
 * there, so the two can never meet).
 */
export const CLASS22_SUBACTOR_AT_BIT = 0x20000000;

/** The sub-actor's address, from the flier's. `[port-only]` as a function. */
export function Class22SubActorAt(flierAt: number): number {
  return (flierAt | CLASS22_SUBACTOR_AT_BIT) >>> 0;
}

/**
 * Every clip the flier's states name — 0x408..0x416, all in `mot/boss1.bin`
 * (bank 4) — for the exporter to bake. The states measure their exits on
 * these clips' play clocks, so a clip missing from the bundle is a state
 * that never ends.
 */
export const CLASS22_MOTIONS: readonly number[] =
  Array.from({ length: 0x416 - 0x408 + 1 }, (_u, i) => 0x408 + i);

/**
 * `g_cam_path_length` (`0x00576D38`) for the slots this class compares its
 * frame counters against, read out of the image with
 * `ExeTables.camPathLength`. The compiler folded each index into the
 * address, so the instructions name the entries: `[0x00576DF4]` is slot
 * 0x2F, `[0x00576DF8]` 0x30, `[0x00577070]` 0xCE and `[0x00577238 + P*4]`
 * 0x140 + P.
 */
export const CAM_PATH_LENGTH: Readonly<Record<number, number>> = {
  0x2f: 830, 0x30: 300, 0xce: 445,
  0x140: 130, 0x141: 120, 0x142: 90, 0x143: 90, 0x144: 70,
};
