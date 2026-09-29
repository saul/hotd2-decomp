/**
 * Class 0x41 types 70 and 71 — Original Mode's collectible, and the table
 * that decides what each one is.
 *
 * Twenty shipped spawns — 70 in stages 2 to 6, the one 71 in stage 2 — and
 * both types run one routine, `OriginalItemPropUpdate`. What
 * separates them is their arm of `PlaceGenericProp`: 71's seeds a bob and a
 * tumble and sets `obj+0x34` bit `0x200000`, and the routine switches on that
 * bit, so a 71 floats and rocks where a 70 turns on the spot. The story item
 * `SpawnStoryModeItem` (`class41/items.ts`) makes is the same object again.
 *
 * ## The descriptor's `+0x11C` is a lifetime here, and the model is the table's
 *
 * Both arms call `PickOriginalModeItem` with the placer's
 * `desc+0x24` byte, and **that call overwrites `obj+0x28C`**: it draws an
 * item id out of the scene's row by weight and copies the id's record in —
 * the model, a second camera-facing model, and a scale. So the collectible's
 * model is the item record's and the descriptor word is only its lifetime,
 * which the routine charges through `PropExpireByStepLifetime`. Every caller
 * of `PickOriginalModeItem` goes through the one function here: types 70, 71
 * and 72's arms, `SpawnStoryModeItem`, `SpawnOriginalItemDrop` (type 7's) and
 * `PropUpdateType43`'s break.
 *
 * ## Taking one
 *
 * A shot that lands while the byte `g_original_item_pickup_blocked` is clear
 * pays the hit, counts the item into `g_original_items_taken`, raises the
 * banner (`SpawnOriginalItemBanner`), plays `0x3616A9` and turns the prop into
 * the 49-frame pickup strip from `0x116A` (player 0) or `0x119C` (player 1),
 * fading the item out over the strip's last 24 frames. Nothing here puts the
 * item into the inventory `PlayerHoldsOriginalItem` reads — see
 * `g_original_item_slots` in `globals.ts`.
 *
 * Every `PlaySoundId` in this family is marked no-return in the database, so
 * the pseudocode of the routine stops at the pickup sound, and it returns out
 * of each of its three draw blocks where the listing runs on through all three
 * into the shot-test registration (`L35`, `L37`). The routine is read from the
 * disassembly of `0x004675A0`..`0x00467B85`.
 */
import type { Events } from "../../core/events";
import type { Rng } from "../../core/rng";
import type { BreakablePlacement } from "../../bundle";
import { BAMS_TO_RAD_F64 } from "../../core/bams";
import { G } from "../globals";
import { CameraBlockEye } from "../camera/view";
import { GameMode } from "../game_mode";
import { T } from "../tables";
import {
  MatrixRotateY, MatrixScale, MatrixTranslate, RADIANS_TO_BAMS, type Mat,
} from "../matrix";
import { SpawnOriginalItemBanner } from "./item_banner";
import { PropExpireByStepLifetime } from "./lifetime";
import { ActorDespawnProp, BreakablePropAwardHit } from "./prop";
import {
  PropDrawBegin, PropDrawSlot, PropDrawSlotWithAlpha,
  PropMatrixClearRotation, PropMatrixPush, PropMatrixTRzRyRx,
} from "./prop_draw";
import { BreakableFlag, type BreakableProp } from "./prop_state";
import { PropRegisterForShotTest } from "./shot_test";
import { PropWords } from "./words";

/** `-1` as `PickOriginalModeItem` writes it to `obj+0x290`: no item. */
export const ORIGINAL_ITEM_NONE = -1;

/**
 * The three words `PickOriginalModeItem` writes, by offset (`class41/words.ts`),
 * so that every routine that reads them reads the same keys.
 */
export interface PickedItemWords {
  /**
   * `obj+0x28E` (s16) — the item's second model, drawn camera-facing; `-1`
   * (the record's `0xFFFF`) for none.
   */
  o28e: number;
  /** `obj+0x290` (s16) — the item id; `-1` when the row chose nothing. */
  o290: number;
  /** `obj+0x2C4` (f32) — the record's draw scale. */
  o2c4: number;
}

/** `ActorClearGameFields` (`FUN_004A73D0`) left every one of them at zero. */
export const PICKED_ITEM_WORDS_ZERO: PickedItemWords = {
  o28e: 0, o290: 0, o2c4: 0,
};

/** A collectible's words: the item's three, and the row its arm picked from. */
export interface CollectibleWords extends PickedItemWords {
  /**
   * `obj+0x194` (s8) — the placer's `+0x1F4` byte (a story item's `+0x2A0`),
   * which is the row `PickOriginalModeItem` was handed. Type 76 keeps its
   * door in the same byte.
   */
  o194: number;
}

/** `ActorClearGameFields` left every one of them at zero. */
export const COLLECTIBLE_WORDS_ZERO: CollectibleWords = {
  o194: 0, o28e: 0, o290: 0, o2c4: 0,
};

/**
 * `obj+0x34` bit 21 — the bob. Type 71's arm sets it (`OR EAX, 0x200000` at
 * `0x00462831`) and `OriginalItemPropUpdate` takes its bob-and-tumble arm on
 * it; a type 70 turns in place instead.
 */
export const ORIGINAL_ITEM_BOBS = 0x200000;

/**
 * `obj+0x34` bit 30 — taken. `OR EBP, 0x40000000` at `0x004676E4`, and the
 * pick-up test refuses a prop that carries it.
 */
export const ORIGINAL_ITEM_TAKEN = 0x40000000;

/** `PlaySoundId(0x3616A9)` — `COMMON\ITEM_22.WAV`, the pickup. */
export const SFX_ORIGINAL_ITEM_PICKUP = 0x3616a9;

/**
 * `obj+0x2A4 = 0x116A` for player 0 and `0x119C` for player 1 — `LEA ECX,
 * [EAX + EAX + 0x116A]` on `(rand() % 2) * 25` when both players hit it on
 * the same frame. The strip is drawn as `obj+0x2A4 - 1 + obj+0x2A0`:
 * `common.bin[203]` and `common.bin[253]` onwards.
 */
export const ORIGINAL_ITEM_PICKUP_SLOT = 0x116a;
export const ORIGINAL_ITEM_PICKUP_SLOT_P1 = 0x119c;
/** `LEA EAX, [EAX + EAX*4]` twice and `LEA ECX, [EAX + EAX]` — 50. */
export const ORIGINAL_ITEM_PICKUP_SLOT_STRIDE = 50;
/** `CMP EAX, 0x31; JLE` — the pickup strip's last frame; the next despawns. */
export const ORIGINAL_ITEM_PICKUP_FRAMES = 0x31;
/**
 * `CMP EAX, 0x19; JGE` — from this frame of the strip the item's own models
 * are drawn through `AssetDrawSlotWithAlpha` at `1.0 - n * 0.02`
 * (`0x004E3100`, the float `0x3CA3D70A`).
 */
export const ORIGINAL_ITEM_FADE_FROM = 0x19;
export const ORIGINAL_ITEM_FADE_STEP = 0.019999999552965164;
/** `CMP AL, 0x63; JGE` — `g_original_items_taken` saturates here. */
export const ORIGINAL_ITEMS_TAKEN_CAP = 0x63;

/** `FADD double ptr [0x0055D7D0]` — 1.5: the shot point, above the origin. */
export const ORIGINAL_ITEM_SHOT_RISE = 1.5;
/**
 * `MatrixTranslate(0, 0, 0x3FC00000)` after `MatrixClearRotation` — the
 * second model sits 1.5 toward the viewer, in the camera's axes.
 */
export const ORIGINAL_ITEM_SECOND_TOWARD_VIEWER = 1.5;

/** `ADD dword ptr [ESI + 0x1D0], 0x400` — a type 70's turn a frame. */
export const ORIGINAL_ITEM_TURN = 0x400;
/**
 * `CMP word ptr [ESI + 0x28C], 0x109F` — the one model a type 70 turns to
 * face the camera instead of spinning: item 29's, `g_original_item_records`
 * row 0x1D.
 */
export const ORIGINAL_ITEM_FACING_SLOT = 0x109f;

/** The scene/block/flag rules the routine despawns and routes on. */
export const ORIGINAL_ITEM_SCENE_2_DROP_SET = 5;
export const ORIGINAL_ITEM_SCENE_2_DROP_BLOCK = 9;
export const ORIGINAL_ITEM_SCENE_4_DROP_BLOCK = 3;
/** `MOV AL, [0x009C720B]` — `g_script_flags[0x0B]`, scene 4 block 3. */
export const ORIGINAL_ITEM_SCENE_4_DROP_FLAG = 0x0b;
/** `MOV AL, [0x009C7213]` — `g_script_flags[0x13]`, scene 2 block 4. */
export const ORIGINAL_ITEM_ROUTE_FLAG = 0x13;
export const ORIGINAL_ITEM_ROUTE_BLOCK = 4;
/** `CMP DX, 0xA` / `CMP [0x009A6110], 0x3C; JLE` — scene 2's unblock. */
export const ORIGINAL_ITEM_UNBLOCK_BLOCK = 0x0a;
export const ORIGINAL_ITEM_UNBLOCK_FRAME = 0x3c;

/**
 * `PlaceGenericProp` case 0x47's bob seed: `0x60 - (rand() % 2) * 0xA0 -
 * rand() % 0x21` for each rate, and `obj+0x2C0 = 1.5` (`0x3FC00000`). **Not**
 * the routine's own re-seed, which is `0x90 - (rand() % 2 << 8) - rand() %
 * 0x21` and a random amplitude: the arm and the routine each have their own.
 */
export const ORIGINAL_ITEM_SEED_BASE = 0x60;
export const ORIGINAL_ITEM_SEED_SIGN_STEP = 0xa0;
export const ORIGINAL_ITEM_SEED_AMPLITUDE = 1.5;
/** `MOV dword ptr [ESI + 0x1DC], 0x200` — the bob phase's step. */
export const ORIGINAL_ITEM_BOB_STEP = 0x200;
/** The routine's re-seed, `0x00467862`..`0x004678E3`. */
export const ORIGINAL_ITEM_RESEED_BASE = 0x90;
export const ORIGINAL_ITEM_RESEED_SIGN_STEP = 0x100;
export const ORIGINAL_ITEM_SPIN_JITTER = 0x21;
/** `rand() % 0x33 * 0.01 (0x004D5464, a float) + 0.25 (0x004C4C58)`. */
export const ORIGINAL_ITEM_BOB_JITTER = 0x33;
export const ORIGINAL_ITEM_BOB_SCALE = 0.009999999776482582;
export const ORIGINAL_ITEM_BOB_BASE = 0.25;
/** `IMUL 0x2AAAAAAB; SAR 3` and its sign fixup — a signed divide by 48. */
export const ORIGINAL_ITEM_SPRING_DIVISOR = 48;

/** `g_script_flags[n]`, with an unraised flag read as 0. */
function ScriptFlag(n: number): number {
  return G.g_script_flags[n] ?? 0;
}

/**
 * `PickOriginalModeItem` — `FUN_004629C0`.
 *
 * ```
 * row = g_original_item_tables[g_scene_index] + n * 8
 * r = rand() % (s8)row[7];  i = 0;
 * while ((s8)row[4 + i] <= r && i < 3) i++;
 * obj+0x290 = (s8)row[i];
 * if (obj+0x290 == -1) { obj+0x28C = 0; obj+0x28E = 0; obj+0x2C4 = 1.0; }
 * else { obj+0x28C/0x28E/0x2C4 = g_original_item_records[obj+0x290] +0/+2/+4; }
 * ```
 *
 * One `rand()`, taken before the table is walked; the modulus is recomputed
 * on each test in the engine and is the same number every time.
 *
 * Both tables are `.rdata` and travel in the bundle: `breakables
 * .original_items` carries the rows this scene's spawns can name, keyed by
 * row, and the records those rows name (`OriginalItemsJson`). A row the
 * bundle does not have is an exporter gap, which `web/tools/checks/prop_slots.ts`
 * reports; here it reads as an id of -1, which every caller despawns.
 */
export function PickOriginalModeItem(p: BreakableProp, row: number,
                                     rng: Rng): void {
  const w = PropWords(p, PICKED_ITEM_WORDS_ZERO);
  const tbl = T.breakables?.original_items;
  const r = tbl?.rows[String(row)];
  const draw = rng.int(r ? r.weights[3] : 0);
  let i = 0;
  if (r) {
    while (r.weights[i] <= draw && i < 3) i++;
  }
  const id = r ? r.ids[i] : ORIGINAL_ITEM_NONE;
  w.o290 = id;
  const rec = id === ORIGINAL_ITEM_NONE ? undefined
    : tbl?.records[String(id)];
  if (!rec) {
    p.slot = 0;
    w.o28e = 0;
    w.o2c4 = 1.0;
    return;
  }
  p.slot = rec.slot;
  // A u16 copy; every reader compares it as the s16 `-1`.
  w.o28e = (rec.slot2 << 16) >> 16;
  w.o2c4 = rec.scale;
}

/**
 * `PlaceGenericProp` case 0x46, `0x00462724`: `obj+0x194` from the placer's
 * `+0x1F4` byte, `PickOriginalModeItem` on it, and
 * `g_original_item_pickup_blocked = 0`; in scene 4 a row-1 prop's radius is
 * doubled. The 3.0 it doubles is `generic.ts`'s table.
 *
 * `[port-only]` as a *function*: an arm of the switch, reached through
 * `GENERIC_PLACE_ARMS` (`class41/generic_routines.ts`).
 */
export function PlaceGenericPropType70(p: BreakableProp,
                                       pl: BreakablePlacement,
                                       rng: Rng): void {
  const w = PropWords(p, COLLECTIBLE_WORDS_ZERO);
  // `MOV AL, [EBP + 0x1F4]; MOV [ESI + 0x194], AL` -- a signed byte.
  w.o194 = ((pl.field_1f4 ?? 0) << 24) >> 24;
  PickOriginalModeItem(p, w.o194, rng);
  // `MOV byte ptr [0x007DCD14], 0` sits before the scene test's jump, so it
  // is written on both of the arm's exits.
  G.g_original_item_pickup_blocked = 0;
  if (G.g_scene_index === 4 && w.o194 === 1) {
    // `FLD [ESI+0x124]; FADD ST0, ST0; FSTP [ESI+0x124]`.
    p.hitRadius = p.hitRadius + p.hitRadius;
  }
}

/**
 * `PlaceGenericProp` case 0x47, `0x0046277C`: the same row and pick as case
 * 0x46, then the bob's seed and bit `0x200000`.
 *
 * `[port-only]` as a *function*, as {@link PlaceGenericPropType70} is.
 */
export function PlaceGenericPropType71(p: BreakableProp,
                                       pl: BreakablePlacement,
                                       rng: Rng): void {
  const w = PropWords(p, COLLECTIBLE_WORDS_ZERO);
  w.o194 = ((pl.field_1f4 ?? 0) << 24) >> 24;
  PickOriginalModeItem(p, w.o194, rng);
  // `MOV ECX, [EBP + 0x44]; MOV [ESI + 0x1AC], ECX` -- the bob's centre.
  p.restY = pl.pos?.[1] ?? p.y;
  p.spin = ORIGINAL_ITEM_SEED_BASE
    - rng.int(2) * ORIGINAL_ITEM_SEED_SIGN_STEP
    - rng.int(ORIGINAL_ITEM_SPIN_JITTER);
  p.yawSpin = ORIGINAL_ITEM_BOB_STEP;
  p.rollSpin = ORIGINAL_ITEM_SEED_BASE
    - rng.int(2) * ORIGINAL_ITEM_SEED_SIGN_STEP
    - rng.int(ORIGINAL_ITEM_SPIN_JITTER);
  p.shake = ORIGINAL_ITEM_SEED_AMPLITUDE;
  // `MOV [ESI + 0x1CC], EBX; MOV [ESI + 0x1D4], EBX` -- EBX is the
  // prologue's zero, so the descriptor's pitch and roll are dropped.
  p.pitch = 0;
  p.roll = 0;
  p.flags |= ORIGINAL_ITEM_BOBS;
  G.g_original_item_pickup_blocked = 0;
}

/**
 * `OriginalItemPropUpdate` — `FUN_004675A0`. `g_class41_updates[70]` and
 * `[71]`: one collectible, one 60 Hz frame.
 *
 * `+0x2A0` is {@link BreakableProp.storyItem} (the pickup strip's frame),
 * `+0x2A4` {@link BreakableProp.removeFlag} (the strip's base), `+0x1E8`
 * {@link BreakableProp.hingeB} (the bob's phase), `+0x1DC`
 * {@link BreakableProp.yawSpin} (its step), `+0x2C0`
 * {@link BreakableProp.shake} (its amplitude), `+0x1AC`
 * {@link BreakableProp.restY} (its centre), and `+0x1D8`/`+0x1E0`
 * {@link BreakableProp.spin}/{@link BreakableProp.rollSpin} the tumble's
 * rates.
 */
export function OriginalItemPropUpdate(p: BreakableProp, rng: Rng,
                                       events?: Events): void {
  PropDrawBegin(p);
  if (G.g_GameMode !== GameMode.Original) {
    ActorDespawnProp(p);
    return;
  }
  // `ActorDespawn` longjmps out of the task, so a prop the prologue retires
  // runs nothing below.
  if (PropExpireByStepLifetime(p)) return;
  const w = PropWords(p, COLLECTIBLE_WORDS_ZERO);
  if (w.o290 === ORIGINAL_ITEM_NONE) {
    ActorDespawnProp(p);
    return;
  }
  if (G.g_scene_index === 2) {
    if (w.o194 === ORIGINAL_ITEM_SCENE_2_DROP_SET
        && G.g_evt_block_index === ORIGINAL_ITEM_SCENE_2_DROP_BLOCK) {
      ActorDespawnProp(p);
      return;
    }
  } else if (G.g_scene_index === 4
             && G.g_evt_block_index === ORIGINAL_ITEM_SCENE_4_DROP_BLOCK
             && ScriptFlag(ORIGINAL_ITEM_SCENE_4_DROP_FLAG) !== 0) {
    ActorDespawnProp(p);
    return;
  }
  // The pickup strip: `obj+0x2A0` counts from the frame it was taken.
  if (p.storyItem > 0) {
    p.storyItem += 1;
    if (p.storyItem > ORIGINAL_ITEM_PICKUP_FRAMES) {
      ActorDespawnProp(p);
      return;
    }
  }

  // Scene 2 is stage 3, whose block 4 record is `{5, -1, 10}`: the value
  // written is the scene index, which there is 2 -- slot 2, exactly. It is
  // written every frame the flag is up, taken or not.
  let unblocked = false;
  if (G.g_scene_index === 2) {
    if (G.g_evt_block_index === ORIGINAL_ITEM_ROUTE_BLOCK) {
      if (ScriptFlag(ORIGINAL_ITEM_ROUTE_FLAG) !== 0) {
        G.g_script_branch_var = G.g_scene_index;
      }
    } else if (G.g_evt_block_index === ORIGINAL_ITEM_UNBLOCK_BLOCK
               && G.g_cam_path_frame > ORIGINAL_ITEM_UNBLOCK_FRAME) {
      // `JMP 0x004676AB` -- past the blocked test, which it has just cleared.
      G.g_original_item_pickup_blocked = 0;
      unblocked = true;
    }
  }
  // The pick-up arm, `0x004676CF`..`0x0046779B`. `PropUpdateType72` has the
  // same instructions at `0x004707DD`, written out a second time.
  if ((unblocked || G.g_original_item_pickup_blocked === 0)
      && (p.flags & ORIGINAL_ITEM_TAKEN) === 0
      && (p.flags & BreakableFlag.Hit) !== 0
      && !(G.g_scene_index === 1 && G.g_evt_block_index === 1)) {
    BreakablePropAwardHit(p.flags, false, rng);
    p.flags |= ORIGINAL_ITEM_TAKEN;
    const id = w.o290;
    const n = G.g_original_items_taken[id] ?? 0;
    if (n < ORIGINAL_ITEMS_TAKEN_CAP) G.g_original_items_taken[id] = n + 1;
    // `MOVSX EDX, word ptr [ECX*4 + 0x5957e0]` -- the record's `+0x08`.
    SpawnOriginalItemBanner(
      T.breakables?.original_items?.records[String(id)]?.sprite ?? 0);
    events?.emit("sound.play", { id: SFX_ORIGINAL_ITEM_PICKUP });
    p.storyItem = 1;
    // The flags are read back after the award; the two player bits are the
    // shot's, and this routine never clears them.
    const p0 = (p.flags & BreakableFlag.HitByPlayer0) !== 0;
    const p1 = (p.flags & BreakableFlag.HitByPlayer1) !== 0;
    if (p0 && p1) {
      // `AND EAX, 0x80000001` and the fixup: MSVC's `rand() % 2`.
      p.removeFlag = ORIGINAL_ITEM_PICKUP_SLOT
        + rng.int(2) * ORIGINAL_ITEM_PICKUP_SLOT_STRIDE;
    } else {
      p.removeFlag = p0 ? ORIGINAL_ITEM_PICKUP_SLOT
        : ORIGINAL_ITEM_PICKUP_SLOT_P1;
    }
  }

  // `AND ECX, 0xFFFFFFF7` -- bit 3 alone. The player bits stay.
  p.flags &= ~BreakableFlag.Hit;
  if ((p.flags & ORIGINAL_ITEM_BOBS) === 0) {
    if ((p.slot & 0xffff) === ORIGINAL_ITEM_FACING_SLOT) {
      p.yaw = OriginalItemFacingYaw(p);
    } else {
      p.yaw += ORIGINAL_ITEM_TURN;
    }
  } else {
    OriginalItemBob(p, rng);
  }

  // The three draw blocks, `0x0046795F`..`0x00467B2B`, each behind its own
  // test and each run in turn: `CMP word ptr [ESI+0x28C], DI` with `DI` the
  // `-1` of `OR EDI, 0xFFFFFFFF`, then the same on `+0x28E`, then the strip.
  const s = w.o2c4;
  if (((p.slot << 16) >> 16) !== -1) {
    const m = PropMatrixPush();
    PropMatrixTRzRyRx(m, p.x, p.y, p.z, p.pitch, p.yaw, p.roll);
    MatrixScale(m, s, s, s);
    // `NoOpStub(s)` (`FUN_0041EBB0`), here and below: an empty function.
    OriginalItemDrawMaybeFaded(p, m, p.slot);
  }
  if (w.o28e !== -1) {
    const m = PropMatrixPush();
    MatrixTranslate(m, p.x, p.y, p.z);
    PropMatrixClearRotation(m);
    MatrixTranslate(m, 0, 0, ORIGINAL_ITEM_SECOND_TOWARD_VIEWER);
    MatrixScale(m, s, s, s);
    OriginalItemDrawMaybeFaded(p, m, w.o28e);
  }
  if (p.storyItem > 0) {
    const m = PropMatrixPush();
    MatrixTranslate(m, p.x, p.y, p.z);
    MatrixRotateY(m, p.yaw);
    PropDrawSlot(p, m, p.removeFlag + p.storyItem - 1);
  }

  // Unconditional: a taken prop still stops shots until its strip ends.
  // `FLD [y]; FADD double 1.5; FSTP float`, through the view.
  PropRegisterForShotTest(p, p.x, Math.fround(p.y + ORIGINAL_ITEM_SHOT_RISE),
                          p.z);
}

/**
 * `AssetDrawSlot` (`FUN_00418560`) while `obj+0x2A0 < 0x19`, and from there
 * `AssetDrawSlotWithAlpha` (`FUN_004185A0`) at `1.0 - obj+0x2A0 * 0.02f`:
 * `FILD [n]; FMUL float [0x004E3100]; FSUBR float [0x004C4380]; FSTP float`.
 *
 * `[port-only]` as a function: `OriginalItemPropUpdate`, `PropUpdateType72`
 * and `OriginalItemDropUpdate` write the branch out at each of their two item
 * draws.
 */
export function OriginalItemDrawMaybeFaded(p: BreakableProp, m: Mat,
                                           slot: number): void {
  if (p.storyItem < ORIGINAL_ITEM_FADE_FROM) {
    PropDrawSlot(p, m, slot);
    return;
  }
  PropDrawSlotWithAlpha(p, m, slot,
                        Math.fround(1.0 - p.storyItem * ORIGINAL_ITEM_FADE_STEP));
}

/**
 * `0x004677B8`..`0x004677FE`: the heading from the camera block's eye,
 * `atan2(x - eye.x, z - eye.z)` in BAMS, `__ftol`ed, sign-extended from 16
 * bits (`MOVSX EDX, AX`) and turned half round.
 *
 * `g_camera_block_eye` of the block `g_camera_index` names (`0x004677D7`,
 * `0x004677E3`) -- block 2's under scene state (1, 3), block 0's otherwise.
 */
function OriginalItemFacingYaw(p: BreakableProp): number {
  const eye = CameraBlockEye(G.g_camera_index);
  const dx = p.x - eye.x;
  const dz = p.z - eye.z;
  const b = Math.trunc(Math.atan2(dx, dz) * RADIANS_TO_BAMS);
  return ((b << 16) >> 16) + 0x8000;
}

/**
 * Type 71's arm, `0x00467818`..`0x00467956`: a bob on a sine and a tumble on
 * a damped spring, re-seeded each time the bob's phase crosses a whole turn.
 * The same shape as `PropUpdateType43`'s, with this routine's constants.
 */
function OriginalItemBob(p: BreakableProp, rng: Rng): void {
  const phase = p.hingeB;
  p.hingeB = (phase + p.yawSpin) | 0;
  // `FILD` the phase from before the step, `FMUL g_bams_to_rad` (the double
  // at `0x004C4370`, taken straight), `FSIN`, `FMUL +0x2C0`, `FADD +0x1AC`,
  // one rounding at the store.
  p.y = Math.fround(Math.sin(phase * BAMS_TO_RAD_F64) * p.shake + p.restY);
  // `AND EAX, 0x8000FFFF` and the sign fixup: MSVC's `% 0x10000`, which is
  // zero exactly when the low sixteen bits are.
  if ((p.hingeB & 0xffff) === 0) {
    p.spin = ORIGINAL_ITEM_RESEED_BASE
      - rng.int(2) * ORIGINAL_ITEM_RESEED_SIGN_STEP
      - rng.int(ORIGINAL_ITEM_SPIN_JITTER);
    p.rollSpin = ORIGINAL_ITEM_RESEED_BASE
      - rng.int(2) * ORIGINAL_ITEM_RESEED_SIGN_STEP
      - rng.int(ORIGINAL_ITEM_SPIN_JITTER);
    p.shake = Math.fround(rng.int(ORIGINAL_ITEM_BOB_JITTER)
                          * ORIGINAL_ITEM_BOB_SCALE + ORIGINAL_ITEM_BOB_BASE);
  }
  const spin = p.spin
    - Math.trunc((p.pitch + p.spin) / ORIGINAL_ITEM_SPRING_DIVISOR);
  p.spin = spin;
  const rollSpin = p.rollSpin
    - Math.trunc((p.rollSpin + p.roll) / ORIGINAL_ITEM_SPRING_DIVISOR);
  p.rollSpin = rollSpin;
  p.roll = rollSpin + p.roll;
  p.pitch = spin + p.pitch;
  p.yaw += ORIGINAL_ITEM_TURN;
}
