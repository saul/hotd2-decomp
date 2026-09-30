/**
 * Class 0x26's per-actor state, at the offsets the engine keeps it, and the
 * asset slots its ported routines draw.
 *
 * Three of the eight subtypes are ported: 2 -- `Class26Subtype2Update`
 * (`FUN_0048EAD0`), stage 3's boat -- and 6 and 7, which share
 * `Class26Subtype67Update` (`FUN_0048F930`) and its two draws, stage 6 block
 * 12's pair. See `game/class26/`.
 *
 * Data only, with no module-scope side effect, so that `hod2lib/bundle.ts`
 * can import the slots without acquiring a class handler (the arrangement
 * `class13/state.ts` and `class25/state.ts` have).
 */

/**
 * `obj+0x11C` — the subtype `Class26InstallSubtypeUpdate` (`FUN_0048E290`)
 * switches on. Eight arms; three are read.
 */
export enum Class26Subtype {
  /** `Class26Subtype2Update` (`FUN_0048EAD0`) — the boat the player rides. */
  Boat = 2,
  /**
   * `Class26Subtype67Update` (`FUN_0048F930`) with selector 0: rides object
   * path `0x183` (`g_class26_path_by_selector[0]`).
   */
  OnPath183 = 6,
  /** ...and selector 1: rides object path `0x184`. */
  OnPath184 = 7,
}

/**
 * What `obj+0x00` holds: the routine the object runs every frame. The spawn
 * allocates the object with `Class26InstallSubtypeUpdate` there; the installer
 * runs the subtype's routine once and stores it over itself, and two of
 * those routines store a third later on.
 *
 * `[port-only]` as an enum: the engine stores the routine's address, and a
 * snapshot cannot hold one.
 */
export enum Class26Routine {
  /** `Class26InstallSubtypeUpdate` (`FUN_0048E290`): nothing installed yet. */
  Install = 0,
  /** `Class26Subtype2Update` (`FUN_0048EAD0`). */
  Subtype2Update = 1,
  /** `Class26Subtype67Update` (`FUN_0048F930`). */
  Subtype67Update = 2,
  /** `Class26Subtype67Draw` (`FUN_0048FB40`). */
  Subtype67Draw = 3,
  /** `Class26Subtype67DrawOrKill` (`FUN_0048FD00`). */
  Subtype67DrawOrKill = 4,
}

/**
 * One `AssetDrawSlot` (`FUN_00418560`) a transcribed class-0x26 routine made
 * this frame, and the matrix it made it under -- `class41/prop_draw.ts`'s
 * arrangement, for an actor.
 *
 * `[port-only]` as a record: the engine draws and forgets. The renderer may
 * not call into the port, so the routine writes down what it drew and
 * `render/slotmodels.ts` clones the slot and sets the matrix, deciding
 * nothing.
 */
export interface Class26DrawCall {
  /** The slot handed to `AssetDrawSlot`, as the routine pushed it. */
  slot: number;
  /**
   * `g_MatrixStackTop` at the call, in `game/matrix.ts`'s layout, built from
   * the identity where the engine's stack starts from the camera's view: the
   * model's **world** matrix.
   */
  m: number[];
  /**
   * The colour `SetRenderLightColour` (`FUN_004AA0A0`) set immediately
   * before the call, when the routine brackets the draw with it and
   * `LightsRestoreScene` (`FUN_0041DCC0`) -- the only lit term that call
   * changes. Absent for a draw under the scene's own light.
   */
  light?: [number, number, number];
}

export interface VehicleTail {
  /** `obj+0x00` — see {@link Class26Routine}. */
  routine: Class26Routine;
  /**
   * `obj+0x1350` — **face the camera** (subtype 2). While it is 1 the boat's
   * yaw is the camera block's plus `0x8000` instead of the path's.
   * `Class26Subtype2Update` raises and drops it at literal frames of each
   * camera path it names.
   */
  faceCamera: number;
  /**
   * `obj+0x1320` (subtypes 6 and 7) — `Class26Subtype67Update` writes 1 here
   * on camera path `0xDF` from frame `0x578` (`MOV dword ptr [ESI + 0x1320],
   * 0x1` at `0x0048FA40`), and while it is 1 `Class26Subtype67Draw` draws
   * subtype 6 as the one model {@link CLASS26_SUB6_SLOT_LATCHED} instead of
   * its three. Nothing clears it. Subtype 7's draw never reads it.
   */
  drawsOneModel: number;
  /** `[port-only]` What this frame's routine drew; see {@link Class26DrawCall}. */
  draws: Class26DrawCall[];
}

/** `[port-only]` — a fresh tail; the engine's is zeroed by the allocator. */
export function makeVehicleTail(): VehicleTail {
  return {
    routine: Class26Routine.Install, faceCamera: 0, drawsOneModel: 0,
    draws: [],
  };
}

// -- the slots subtypes 6 and 7 draw ------------------------------------------
//
// Every one is a `PUSH imm32` in `Class26Subtype67Draw` (`FUN_0048FB40`) or
// `Class26Subtype67DrawOrKill` (`FUN_0048FD00`), and a join key: the exporter
// has to carry the model for `render/` to have anything to draw.

/**
 * `st6_01.bin[10]` — `PUSH 0x1914` at `0x0048FBFB`, `0x0048FCDE` and
 * `0x0048FD6D`: subtype 6 once {@link VehicleTail.drawsOneModel} is up, the
 * second copy on camera path `0xDF`, and subtype 6's model in the kill-or-draw
 * routine.
 */
export const CLASS26_SUB6_SLOT_LATCHED = 0x1914;
/** `st6_01.bin[11]` — `PUSH 0x1915` at `0x0048FC0A`: subtype 6, first. */
export const CLASS26_SUB6_SLOT = 0x1915;
/** `st5_02.bin[3]` — `PUSH 0xD36` at `0x0048FC22`, 153 along x from it. */
export const CLASS26_SUB6_SLOT_BESIDE = 0xd36;
/**
 * `common.bin[135]` — `PUSH 0x9A8` at `0x0048FC6F`, the one drawn under
 * {@link CLASS26_SUB6_LIGHT}.
 */
export const CLASS26_SUB6_SLOT_LIT = 0x9a8;
/** `st6_01.bin[2]` — `PUSH 0x190C` at `0x0048FB74` and `0x0048FD3F`. */
export const CLASS26_SUB7_SLOT = 0x190c;
/**
 * `st5_01.bin[2]` — `PUSH 0x7E9` at `0x0048FBAB`: subtype 7's fixed-point
 * model while `g_script_flags[0x31]` is down.
 */
export const CLASS26_SUB7_FIXED_SLOT = 0x7e9;
/** `st5_01.bin[4]` — `PUSH 0x7EB` at `0x0048FBBC`: ...and once it is up. */
export const CLASS26_SUB7_FIXED_SLOT_FLAGGED = 0x7eb;

/**
 * `SetRenderLightColour(0.05, 0.01, 0)` at `0x0048FC6A` — `PUSH 0x0; PUSH
 * 0x3C23D70A; PUSH 0x3D4CCCCD` — the light {@link CLASS26_SUB6_SLOT_LIT} is
 * drawn under, as the f32s the pushes carry.
 */
export const CLASS26_SUB6_LIGHT: readonly [number, number, number] =
  [Math.fround(0.05), Math.fround(0.01), 0];

/**
 * `[port-only]` Every slot a class-0x26 spawn of `subtype` can draw through a
 * routine this port runs, for the exporter to carry: the two draws' pushes,
 * gathered. Subtype 2's `0x1A37` rides the rig table and is not listed here.
 */
export function Class26DrawSlots(subtype: number): number[] {
  switch (subtype) {
    case Class26Subtype.OnPath183:
      return [CLASS26_SUB6_SLOT, CLASS26_SUB6_SLOT_LATCHED,
              CLASS26_SUB6_SLOT_BESIDE, CLASS26_SUB6_SLOT_LIT];
    case Class26Subtype.OnPath184:
      return [CLASS26_SUB7_SLOT, CLASS26_SUB7_FIXED_SLOT,
              CLASS26_SUB7_FIXED_SLOT_FLAGGED];
    default:
      return [];
  }
}
