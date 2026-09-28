/**
 * Class 0x41 types 70 and 71 — Original Mode's collectible, and the table
 * that decides what each one is.
 *
 * Twenty shipped spawns — 70 in stages 2 to 6, the one 71 in stage 2 — and
 * both types run one routine, `OriginalItemPropUpdate`. What
 * separates them is their arm of `PlaceGenericProp`: 71's seeds a bob and a
 * tumble and sets `obj+0x34` bit `0x200000`, and the routine switches on that
 * bit, so a 71 floats and rocks where a 70 turns on the spot.
 *
 * ## The descriptor's `+0x11C` is a lifetime here, and the model is the table's
 *
 * Both arms call `PickOriginalModeItem` with the placer's
 * `desc+0x24` byte, and **that call overwrites `obj+0x28C`**: it draws an
 * item id out of the scene's row by weight and copies the id's record in —
 * the model, a second camera-facing model, and a scale. So the collectible's
 * model is the item record's and the descriptor word is only its lifetime,
 * which the routine charges through `PropExpireByStepLifetime`.
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
import { G } from "../globals";
import { GameMode } from "../game_mode";
import { T } from "../tables";
import { RADIANS_TO_BAMS } from "../matrix";
import { MsvcRand } from "./group";
import { SpawnOriginalItemBanner } from "./item_banner";
import { PropExpireByStepLifetime } from "./lifetime";
import { ActorDespawnProp, BreakablePropAwardHit } from "./prop";
import {
  BreakableFlag, type BreakableProp,
} from "./prop_state";
import { PropRegisterForShotTest } from "./shot_test";

/** `-1` as `PickOriginalModeItem` writes it to `obj+0x290`: no item. */
export const ORIGINAL_ITEM_NONE = -1;
/** A u16 slot of `0xFFFF`, the engine's `-1`: `CMP word ptr [...], DI`. */
export const ORIGINAL_ITEM_NO_SLOT = 0xffff;

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

/** `PlaySoundId(0x3616A9)` — the pickup. */
export const SFX_ORIGINAL_ITEM_PICKUP = 0x3616a9;

/**
 * `obj+0x2A4 = 0x116A` for player 0 and `0x119C` for player 1 — `LEA ECX,
 * [EAX + EAX + 0x116A]` on `(rand() % 2) * 25` when both players hit it on
 * the same frame. The strip is drawn as `obj+0x2A4 - 1 + obj+0x2A0`.
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

/**
 * `g_bams_to_rad` — `0x004C4370`, the **double** `2pi/65536`. The bob's
 * `FMUL` takes it straight, with no store to a float in between.
 */
const G_BAMS_TO_RAD = (Math.PI * 2) / 65536;

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
 * The bundle carries the rows this scene's collectibles name, keyed by row,
 * and the records those rows name (`OriginalItemsJson`); a row the bundle
 * does not have is an id of -1, which the routine despawns.
 */
export function PickOriginalModeItem(p: BreakableProp, row: number,
                                     rng: Rng): void {
  const tbl = T.breakables?.original_items;
  const r = tbl?.rows[String(row)];
  // `CALL rand` comes before anything of the row is read.
  const draw = MsvcRand(rng);
  let i = 0;
  if (r) {
    const m = draw % r.weights[3];
    while (r.weights[i] <= m && i < 3) i++;
  }
  const id = r ? r.ids[i] : ORIGINAL_ITEM_NONE;
  p.originalItem = id;
  const rec = id === ORIGINAL_ITEM_NONE ? undefined
    : tbl?.records[String(id)];
  if (!rec) {
    p.slot = 0;
    p.slotB = 0;
    p.itemScale = 1.0;
    return;
  }
  p.slot = rec.slot;
  p.slotB = rec.slot2;
  p.itemScale = rec.scale;
}

/** Class 0x41 type 71: `PlaceGenericProp` case 0x47. */
export const ORIGINAL_ITEM_TYPE_BOBBING = 71;

/**
 * `PlaceGenericProp` cases 0x46 and 0x47, `0x00462724` and `0x0046277C`.
 *
 * `[port-only]` as a *function*, like `PlaceGenericPropType43`: in the engine
 * these are two arms of the switch. Both write the placer's `+0x1F4` byte
 * into `obj+0x194`, set a radius of 3.0 (the table in `generic.ts` already
 * has it), call `PickOriginalModeItem` with that byte and clear
 * `g_original_item_pickup_blocked`. Case 0x46 doubles the radius in scene 4
 * for a row-1 prop; case 0x47 seeds the bob.
 */
export function PlaceGenericPropOriginalItem(
    p: BreakableProp, pl: { field_1f4?: number; pos?: number[] },
    type: number, rng: Rng): void {
  // `MOV AL, [EBP + 0x1F4]; MOV [ESI + 0x194], AL` -- a signed byte.
  p.group = ((pl.field_1f4 ?? 0) << 24) >> 24;
  // The prologue's `+0x2A0` and `+0x2A4` are zero (`ActorClearGameFields`):
  // the pickup strip's frame and base.
  p.removeFlag = 0;
  PickOriginalModeItem(p, p.group, rng);
  if (type === ORIGINAL_ITEM_TYPE_BOBBING) {
    // `MOV ECX, [EBP + 0x44]; MOV [ESI + 0x1AC], ECX` -- the bob's centre.
    p.restY = pl.pos?.[1] ?? p.y;
    p.spin = OriginalItemSeedRate(rng);
    p.yawSpin = ORIGINAL_ITEM_BOB_STEP;
    p.rollSpin = OriginalItemSeedRate(rng);
    p.shake = ORIGINAL_ITEM_SEED_AMPLITUDE;
    // `MOV [ESI + 0x1CC], EBX; MOV [ESI + 0x1D4], EBX` -- EBX is the
    // prologue's zero, so the descriptor's pitch and roll are dropped.
    p.pitch = 0;
    p.roll = 0;
    p.flags |= ORIGINAL_ITEM_BOBS;
    G.g_original_item_pickup_blocked = 0;
    return;
  }
  // `MOV byte ptr [0x007DCD14], 0` sits before the scene test, so it is
  // written on both of case 0x46's exits.
  G.g_original_item_pickup_blocked = 0;
  if (G.g_scene_index === 4 && p.group === 1) {
    // `FLD [ESI+0x124]; FADD ST0, ST0; FSTP [ESI+0x124]`.
    p.hitRadius = p.hitRadius + p.hitRadius;
  }
}

/** Case 0x47's rate: `0x60 - (rand() % 2) * 0xA0 - rand() % 0x21`. */
function OriginalItemSeedRate(rng: Rng): number {
  const sign = MsvcRand(rng) & 1;
  return ORIGINAL_ITEM_SEED_BASE - sign * ORIGINAL_ITEM_SEED_SIGN_STEP
    - (MsvcRand(rng) % ORIGINAL_ITEM_SPIN_JITTER);
}

/** The routine's re-seed rate: `0x90 - (rand() % 2 << 8) - rand() % 0x21`. */
function OriginalItemReseedRate(rng: Rng): number {
  const sign = MsvcRand(rng) & 1;
  return ORIGINAL_ITEM_RESEED_BASE - sign * ORIGINAL_ITEM_RESEED_SIGN_STEP
    - (MsvcRand(rng) % ORIGINAL_ITEM_SPIN_JITTER);
}

/**
 * `OriginalItemPropUpdate` — `FUN_004675A0`. `g_class41_updates[70]` and
 * `[71]`: one collectible, one 60 Hz frame.
 *
 * The draw is `render/prop_parts.ts`'s: the item's model under `Rz Ry Rx` and
 * `obj+0x2C4`, its second model camera-facing, and the pickup strip.
 */
export function OriginalItemPropUpdate(p: BreakableProp, rng: Rng,
                                       events?: Events): void {
  if (G.g_GameMode !== GameMode.Original) {
    ActorDespawnProp(p);
    return;
  }
  // `ActorDespawn` longjmps out of the task, so a prop the prologue retires
  // runs nothing below.
  if (PropExpireByStepLifetime(p)) return;
  if (p.originalItem === ORIGINAL_ITEM_NONE) {
    ActorDespawnProp(p);
    return;
  }
  if (G.g_scene_index === 2) {
    if (p.group === ORIGINAL_ITEM_SCENE_2_DROP_SET
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
    const id = p.originalItem;
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
      p.removeFlag = ORIGINAL_ITEM_PICKUP_SLOT
        + (MsvcRand(rng) & 1) * ORIGINAL_ITEM_PICKUP_SLOT_STRIDE;
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

  // The three draw blocks are the renderer's. The registration after them is
  // unconditional: a taken prop still stops shots until its strip ends.
  PropRegisterForShotTest(p, p.x, p.y + ORIGINAL_ITEM_SHOT_RISE, p.z);
}

/**
 * `0x004677B8`..`0x004677FE`: the heading from the camera block's eye,
 * `atan2(x - eye.x, z - eye.z)` in BAMS, `__ftol`ed, sign-extended from 16
 * bits (`MOVSX EDX, AX`) and turned half round.
 *
 * `g_camera_block_eye` of block `g_camera_index`, which is 0 in every
 * shipped write and the port's one block.
 */
function OriginalItemFacingYaw(p: BreakableProp): number {
  const dx = p.x - G.g_camera_block_eye.x;
  const dz = p.z - G.g_camera_block_eye.z;
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
  p.hingeB = phase + p.yawSpin;
  // `FILD` the phase from before the step, `FMUL g_bams_to_rad`, `FSIN`,
  // `FMUL +0x2C0`, `FADD +0x1AC`, one rounding at the store.
  p.y = Math.fround(Math.sin(phase * G_BAMS_TO_RAD) * p.shake + p.restY);
  // `AND EAX, 0x8000FFFF` and the sign fixup: MSVC's `% 0x10000`, which is
  // zero exactly when the low sixteen bits are.
  if ((p.hingeB & 0xffff) === 0) {
    p.spin = OriginalItemReseedRate(rng);
    p.rollSpin = OriginalItemReseedRate(rng);
    p.shake = Math.fround((MsvcRand(rng) % ORIGINAL_ITEM_BOB_JITTER)
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
