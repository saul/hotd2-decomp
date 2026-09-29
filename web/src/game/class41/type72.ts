/**
 * Class 0x41 type 72 — the collectible that pops up on a camera cue.
 *
 * One shipped spawn: stage 2 block 16 (evt `0x8C24`), row 6 of scene 1's
 * item table, so one of items 3, 5, 31 and 21 by weights 2, 1, 1, 2. It is
 * an Original Mode collectible like types 70 and 71 — the same
 * `PickOriginalModeItem` in its arm, the same pick-up arm, the same pickup
 * strip — but its own routine: it waits unseen for camera path 0x4E to reach
 * frame 0x276, and then either leaves (`g_script_flags[0x12]` down) or is
 * thrown up at 1.2 a frame and falls under 0.0381 a frame, spinning, until it
 * is shot or drops back below where it started.
 *
 * ## What it draws, which the port used to have as an open question
 *
 * The note this replaces said its draw takes the descriptor's `+0x11C` —
 * a 1 — as its model, and asked what was resident at slot 1. It does not.
 * `PlaceGenericProp` case 0x48 (`0x00462845`) calls `PickOriginalModeItem`,
 * which **overwrites `obj+0x28C`** with the chosen item's model; the
 * descriptor word is never a slot for this type. It is not a lifetime
 * either: nothing in the routine reads `obj+0x11C`.
 *
 * ## The draw, and one quirk in it
 *
 * While `obj+0x192` is above 0 the routine draws the item's model under
 * `Rz Ry Rx` and `obj+0x2C4` — with no test on the model, where
 * `OriginalItemPropUpdate` has one — then, **gated on `obj+0x28C` rather than
 * on `obj+0x28E`** (`CMP word ptr [ESI + 0x28C], -1` at `0x00470A60`), its
 * second model camera-facing, then the pickup strip. So an item with no
 * second model hands `AssetDrawSlot` a -1, which reads the flags word at
 * `0x009A669C`, just past the four camera blocks and before the slot table;
 * `[likely]` that draws nothing, because no instruction in the image names
 * that word and it is therefore the BSS zero it starts as. The port records
 * the -1 as the routine makes it, and no model is carried at that slot.
 *
 * Read from the disassembly of `0x00470750`..`0x00470B6D`: `PlaySoundId` is
 * marked no-return, so the pseudocode stops at the pickup sound and returns
 * out of each draw block (`L35`, `L37`).
 */
import type { Events } from "../../core/events";
import type { Rng } from "../../core/rng";
import type { BreakablePlacement } from "../../bundle";
import { G } from "../globals";
import { CameraBlockPathFrame } from "../camera/view";
import { GameMode } from "../game_mode";
import { MatrixRotateY, MatrixScale, MatrixTranslate } from "../matrix";
import { ActorDespawnProp, BreakablePropAwardHit } from "./prop";
import { T } from "../tables";
import { SpawnOriginalItemBanner } from "./item_banner";
import {
  COLLECTIBLE_WORDS_ZERO, ORIGINAL_ITEM_NONE, ORIGINAL_ITEM_PICKUP_FRAMES,
  ORIGINAL_ITEM_PICKUP_SLOT, ORIGINAL_ITEM_PICKUP_SLOT_P1,
  ORIGINAL_ITEM_PICKUP_SLOT_STRIDE, ORIGINAL_ITEM_SECOND_TOWARD_VIEWER,
  ORIGINAL_ITEM_SHOT_RISE, ORIGINAL_ITEM_TAKEN, ORIGINAL_ITEM_TURN,
  ORIGINAL_ITEMS_TAKEN_CAP, OriginalItemDrawMaybeFaded, PickOriginalModeItem,
  SFX_ORIGINAL_ITEM_PICKUP,
} from "./original_item";
import {
  PropDrawBegin, PropDrawSlot, PropMatrixClearRotation, PropMatrixPush,
  PropMatrixTRzRyRx,
} from "./prop_draw";
import { BreakableFlag, type BreakableProp } from "./prop_state";
import { PropRegisterForShotTest } from "./shot_test";
import { PropWords } from "./words";

/** `obj+0x192` as `PropUpdateType72` switches on it. */
export enum Type72Phase {
  /** Placed, undrawn and unshootable, waiting for its camera cue. */
  Wait = 0,
  /** Thrown up and falling; drawn and shootable. */
  Fall = 1,
  /** Taken: frozen where it was shot, playing the pickup strip. */
  Taken = 2,
}

/** `CMP [0x009A2D78], 0x4E` / `CMP [0x009A6110 + ...], 0x276` — the cue. */
export const TYPE72_CUE_CAM_PATH = 0x4e;
export const TYPE72_CUE_CAM_FRAME = 0x276;
/** `MOV AL, [0x009C7212]` — `g_script_flags[0x12]`: without it, it leaves. */
export const TYPE72_SCRIPT_FLAG = 0x12;
/** `MOV dword ptr [ESI + 0x1C4], 0x3F99999A` — the throw, 1.2 a frame. */
export const TYPE72_THROW = 1.2000000476837158;
/** `FSUB float ptr [0x00569148]` — gravity, `0x3D1C1722`. */
export const TYPE72_GRAVITY = 0.03810799866914749;

/**
 * `PlaceGenericProp` case 0x48, `0x00462845`: `obj+0x194` from the placer's
 * `+0x1F4` byte, `PickOriginalModeItem` on it, and
 * `g_original_item_pickup_blocked = 0` — the 3.0 radius is in `generic.ts`'s
 * table.
 *
 * `[port-only]` as a *function*: an arm of the switch, reached through
 * `GENERIC_PLACE_ARMS` (`class41/generic_routines.ts`).
 */
export function PlaceGenericPropType72(p: BreakableProp,
                                       pl: BreakablePlacement,
                                       rng: Rng): void {
  const w = PropWords(p, COLLECTIBLE_WORDS_ZERO);
  w.o194 = ((pl.field_1f4 ?? 0) << 24) >> 24;
  PickOriginalModeItem(p, w.o194, rng);
  G.g_original_item_pickup_blocked = 0;
}

/**
 * `PropUpdateType72` — `FUN_00470750`. One prop, one 60 Hz frame.
 *
 * `+0x1C4` is {@link BreakableProp.vy}, `+0x1AC` {@link BreakableProp.restY}
 * (the height it was thrown from), `+0x2A0` {@link BreakableProp.storyItem}
 * (the pickup strip's frame), `+0x2A4` {@link BreakableProp.removeFlag} (the
 * strip's base) and `+0x192` {@link BreakableProp.routinePhase}.
 */
export function PropUpdateType72(p: BreakableProp, rng: Rng,
                                 events?: Events): void {
  PropDrawBegin(p);
  if (G.g_GameMode !== GameMode.Original) {
    ActorDespawnProp(p);
    return;
  }
  if (p.storyItem > 0) {
    p.storyItem += 1;
    if (p.storyItem > ORIGINAL_ITEM_PICKUP_FRAMES) {
      ActorDespawnProp(p);
      return;
    }
  }
  const w = PropWords(p, COLLECTIBLE_WORDS_ZERO);
  if (w.o290 === ORIGINAL_ITEM_NONE) {
    ActorDespawnProp(p);
    return;
  }

  switch (p.routinePhase as Type72Phase) {
    case Type72Phase.Wait:
      // `CMP [EAX*4 + 0x9a6110], 0x276` at `0x0047095A`, `EAX` from `MOV ECX,
      // [0x009c6f00]` times 0x69: the frame of the block `g_camera_index`
      // names. Under scene state (1, 3) that is block 2's, always 0, so the
      // cue cannot fire there; the one shipped spawn's path reaches 0x276
      // under (2, 6), index 0.
      if (G.g_active_cam_path === TYPE72_CUE_CAM_PATH
          && CameraBlockPathFrame(G.g_camera_index) === TYPE72_CUE_CAM_FRAME) {
        if ((G.g_script_flags[TYPE72_SCRIPT_FLAG] ?? 0) === 0) {
          ActorDespawnProp(p);
          return;
        }
        p.routinePhase = Type72Phase.Fall;
        p.vy = TYPE72_THROW;
        p.restY = p.y;
      }
      break;
    case Type72Phase.Fall: {
      // The pick-up arm, `0x004707DD`..`0x00470891`: the collectible's own
      // instructions, written out a second time, with the state change first.
      if ((p.flags & ORIGINAL_ITEM_TAKEN) === 0
          && (p.flags & BreakableFlag.Hit) !== 0) {
        p.routinePhase = Type72Phase.Taken;
        BreakablePropAwardHit(p.flags, false, rng);
        p.flags |= ORIGINAL_ITEM_TAKEN;
        const id = w.o290;
        const n = G.g_original_items_taken[id] ?? 0;
        if (n < ORIGINAL_ITEMS_TAKEN_CAP) G.g_original_items_taken[id] = n + 1;
        SpawnOriginalItemBanner(
          T.breakables?.original_items?.records[String(id)]?.sprite ?? 0);
        events?.emit("sound.play", { id: SFX_ORIGINAL_ITEM_PICKUP });
        p.storyItem = 1;
        const p0 = (p.flags & BreakableFlag.HitByPlayer0) !== 0;
        const p1 = (p.flags & BreakableFlag.HitByPlayer1) !== 0;
        if (p0 && p1) {
          p.removeFlag = ORIGINAL_ITEM_PICKUP_SLOT
            + rng.int(2) * ORIGINAL_ITEM_PICKUP_SLOT_STRIDE;
        } else {
          p.removeFlag = p0 ? ORIGINAL_ITEM_PICKUP_SLOT
            : ORIGINAL_ITEM_PICKUP_SLOT_P1;
        }
      }
      // `JMP 0x00470891` -- the fall runs on the frame it is taken too.
      //
      // ```
      // FLD [vy]; FSUB [g]; FST [vy]; FLD ST0; FADD [y]; FST [local]; FSTP [y]
      // FCOMP 0.0                      ; the new vy -- still on the stack
      // FLD [local]; FCOMP [ESI+0x1AC] ; the new y
      // ```
      //
      // So the test is "falling, and below where it was thrown from": the
      // first compare is on the velocity, not the height.
      const v = p.vy - TYPE72_GRAVITY;
      p.yaw += ORIGINAL_ITEM_TURN;
      p.vy = Math.fround(v);
      const y = Math.fround(v + p.y);
      p.y = y;
      if (v < 0 && y < p.restY) {
        ActorDespawnProp(p);
        return;
      }
      PropRegisterForShotTest(p, p.x, Math.fround(y + ORIGINAL_ITEM_SHOT_RISE),
                              p.z);
      break;
    }
    case Type72Phase.Taken:
      break;
  }
  // No mask of `obj+0x34` anywhere: the taken bit is what refuses a second
  // pickup, and the routine reads nothing else of the word.

  // `MOV AL, [ESI+0x192]; TEST AL, AL; JLE` at `0x0047099B`: nothing is
  // drawn while it waits.
  if (((p.routinePhase << 24) >> 24) <= 0) return;
  const s = w.o2c4;
  let m = PropMatrixPush();
  PropMatrixTRzRyRx(m, p.x, p.y, p.z, p.pitch, p.yaw, p.roll);
  MatrixScale(m, s, s, s);
  OriginalItemDrawMaybeFaded(p, m, p.slot);
  // `CMP word ptr [ESI+0x28C], -1` at `0x00470A60` -- the first model's word,
  // not the second's.
  if (((p.slot << 16) >> 16) !== -1) {
    m = PropMatrixPush();
    MatrixTranslate(m, p.x, p.y, p.z);
    PropMatrixClearRotation(m);
    MatrixTranslate(m, 0, 0, ORIGINAL_ITEM_SECOND_TOWARD_VIEWER);
    MatrixScale(m, s, s, s);
    OriginalItemDrawMaybeFaded(p, m, w.o28e);
  }
  if (p.storyItem > 0) {
    m = PropMatrixPush();
    MatrixTranslate(m, p.x, p.y, p.z);
    MatrixRotateY(m, p.yaw);
    PropDrawSlot(p, m, p.removeFlag + p.storyItem - 1);
  }
}
