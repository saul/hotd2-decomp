/**
 * Class 0x41 type 69 — stage 1's Original Mode prop that **promotes** a route
 * rather than choosing one.
 *
 * One shipped descriptor, evt `0x1B70`, placed at `(-138.645, 11.891,
 * -324.065)` by **two** spawn ops: block 1 step 9 and block 9 step 0. Its
 * `+0x11C` is 1, and it means nothing: this routine has **no lifetime at
 * all** — no `PropExpireByStepLifetime`, no inline copy of it. Its only exits
 * are Arcade Mode and blocks 8 and 3.
 *
 * The routine, `0x00470500`..`0x00470747` `[proved]`, read from the
 * disassembly because `PlaySoundId` and `MatrixStackPop` end Ghidra's
 * pseudocode at the hit arm's sound and at the first draw's pop — the spark,
 * the state change, the second draw and the shot-test tail are past them:
 *
 * ```c
 * if (g_GameMode != 1) { ActorDespawn(obj); return; }
 * if (g_evt_block_index == 8 || g_evt_block_index == 3) { ActorDespawn(obj); return; }  // 0x00470737
 * if (g_script_flags[0x23] == 1 && g_script_branch_var == 1 && (s8)obj->+0x192 > 0) {
 *     g_script_branch_var = 2;
 *     save = obj->+0x19C..0x1A4;
 *     obj->+0x2A0 = 1; obj->+0x11C = 2;
 *     obj->+0x19C..0x1A4 = (-140.7, 3.0, -328.7);
 *     SpawnStoryModeItem(obj);
 *     g_original_item_pickup_blocked = 0;                 // 0x004705B0
 *     obj->+0x19C..0x1A4 = save;
 * }
 * switch ((s8)obj->+0x192) {
 * case 0: if (obj->+0x34 & 8) {
 *             BreakablePropAwardHit(obj->+0x34, 0); PlaySoundId(0x1D16A9);
 *             SpawnPropHitSpark(obj, !(obj->+0x34 & 2));   // 0x00470643
 *             obj->+0x192 = 1; obj->+0x1C4 = -0.2f;
 *         } break;
 * case 1: obj->+0x1C4 -= 0.02722; obj->+0x1CC -= 0x100; obj->+0x1D4 -= 0x100;
 *         obj->+0x1A0 += obj->+0x1C4; break;
 * }
 * Push; T(+0x19C, +0x1A0, +0x1A4); RotZ(+0x1D4); RotY(+0x1D0); RotX(+0x1CC);
 * AssetDrawSlot(0x13F8); Pop;
 * Push; T(-138.338, 25.5026, -322.999); AssetDrawSlot(0x13F7); Pop;       // 0x004706B2
 * MatrixTransformPoint((+0x19C, +0x1A0 + 1.5, +0x1A4), &obj->+0x70);
 * RegisterForShotTest(obj);
 * ```
 *
 * So a shot knocks the prop off with a hop of -0.2 and it tumbles on pitch
 * and roll and falls **for ever** — nothing stops it, and the shot sphere goes
 * down with it. The promotion needs that shot first (`obj+0x192 > 0`), then
 * `g_script_flags[0x23]` — which stage 1's block 9 step 2 waits on — and a
 * route already at 1; it fires once, because it moves the variable off the 1
 * it tests. The second model `0x13F7` hangs at a fixed world point and never
 * moves.
 *
 * **It never masks `obj+0x34`** — no `AND` on it anywhere — so the hit bit
 * stays up once set; `obj+0x192` is what keeps the hit arm from running twice.
 *
 * Float constants (`L1`): `-140.7`, `3.0`, `-328.7` are `MOV` immediates
 * `0xC30CB333`, `0x40400000`, `0xC3A4599A`; the second model's point is
 * `PUSH 0xC30A5687`, `0x41CC0553`, `0xC3A17FDF`; the hop is `0xBE4CCCCD`;
 * the gravity is the **double** `0.02722` at `0x00569140`
 * (`0x3F9BDF8F4730403A`), not type 56's float; the shot rise is `1.5f` at
 * `0x004C4CB8`; the radius `4.0` (`0x40800000`) is the arm's.
 */
import type { Events } from "../../core/events";
import type { Rng } from "../../core/rng";
import type { BreakablePlacement } from "../../bundle";
import { SpawnPropHitSpark } from "../effects/sprite";
import { G } from "../globals";
import { GameMode } from "../game_mode";
import {
  MatrixRotateX, MatrixRotateY, MatrixRotateZ, MatrixTranslate,
} from "../matrix";
import { SpawnStoryModeItem } from "./items";
import { ActorDespawnProp, BreakablePropAwardHit, SFX_PROP_CRACK } from "./prop";
import { PropDrawBegin, PropDrawSlot, PropMatrixPush } from "./prop_draw";
import { BreakableFlag, type BreakableProp } from "./prop_state";
import { PropRegisterForShotTest } from "./shot_test";

/** `(s8)obj+0x192` as `PropUpdateType69` switches on it. */
export enum Type69Phase {
  /** Standing; the next shot knocks it off. */
  Standing = 0,
  /** Shot: falling and tumbling, with no floor. */
  Falling = 1,
}

/** The two event blocks the routine despawns in, `0x00470528`/`0x00470532`. */
export const TYPE69_GONE_BLOCKS: readonly number[] = [8, 3];

/** `g_script_flags[0x23]` (`0x009C7223`) — the promotion's flag. */
export const SCRIPT_FLAG_TYPE69_PROMOTE = 0x23;
/** The route the promotion takes over, and the one it writes. */
export const TYPE69_ROUTE_FROM = 1;
export const TYPE69_ROUTE_TO = 2;

/** `obj+0x2A0 = 1` — the item set `SpawnStoryModeItem` hands out. */
export const TYPE69_STORY_ITEM = 1;
/** `obj+0x11C = 2` — copied into the item's own `+0x11C` by the spawn. */
export const TYPE69_ITEM_LIFETIME = 2;
/**
 * Where the item is made: `obj+0x19C..0x1A4` are overwritten with these,
 * `SpawnStoryModeItem` reads them, and they are put back.
 */
export const TYPE69_DROP_AT: readonly [number, number, number] = [
  Math.fround(-140.7), 3.0, Math.fround(-328.7),
];

/** The body, at the prop's own pose: `AssetDrawSlot(0x13F8)`. */
export const TYPE69_BODY_SLOT = 0x13f8;
/** The fixed second model: `AssetDrawSlot(0x13F7)`. */
export const TYPE69_FIXED_SLOT = 0x13f7;
/** Where {@link TYPE69_FIXED_SLOT} is drawn, a literal world point. */
export const TYPE69_FIXED_AT: readonly [number, number, number] = [
  Math.fround(-138.338), Math.fround(25.5026), Math.fround(-322.999),
];

/** `MOV [ESI+0x1C4], 0xBE4CCCCD` — the knock's first velocity. */
export const TYPE69_HOP = Math.fround(-0.2);
/** `FSUB double [0x00569140]` — the gravity, a double. */
export const TYPE69_GRAVITY = 0.02722;
/** `ADD reg, 0xFFFFFF00` on pitch and roll — the tumble, BAMS a frame. */
export const TYPE69_TUMBLE = -0x100;
/** `FADD float [0x004C4CB8]` — the shot point's rise. */
export const TYPE69_SHOT_RISE = 1.5;
/** `obj+0x124 = 0x40800000` in the arm. */
export const TYPE69_RADIUS = 4.0;

/**
 * `PropUpdateType69` — `FUN_00470500`. `g_class41_updates[69]`. One prop,
 * one 60 Hz frame.
 *
 * `obj+0x192` is {@link BreakableProp.routinePhase}, `obj+0x2A0`
 * {@link BreakableProp.storyItem} (the item set it hands out), `obj+0x11C`
 * {@link BreakableProp.lifetime} (which this routine writes and never reads),
 * `obj+0x1C4` {@link BreakableProp.vy}.
 */
export function PropUpdateType69(p: BreakableProp, rng: Rng,
                                 events?: Events): void {
  PropDrawBegin(p);
  if (G.g_GameMode !== GameMode.Original) {
    ActorDespawnProp(p);
    return;
  }
  if (TYPE69_GONE_BLOCKS.includes(G.g_evt_block_index)) {
    ActorDespawnProp(p);
    return;
  }

  if ((G.g_script_flags[SCRIPT_FLAG_TYPE69_PROMOTE] ?? 0) === 1
      && G.g_script_branch_var === TYPE69_ROUTE_FROM
      && p.routinePhase > Type69Phase.Standing) {
    G.g_script_branch_var = TYPE69_ROUTE_TO;
    const [x, y, z] = [p.x, p.y, p.z];
    p.storyItem = TYPE69_STORY_ITEM;
    p.lifetime = TYPE69_ITEM_LIFETIME;
    [p.x, p.y, p.z] = TYPE69_DROP_AT;
    SpawnStoryModeItem(p, rng, events);
    // `g_original_item_pickup_blocked` (`0x007DCD14`) = 0 at `0x004705B0`:
    // the gate on `OriginalItemPropUpdate`'s pick-up arm, opened.
    G.g_original_item_pickup_blocked = 0;
    [p.x, p.y, p.z] = [x, y, z];
  }

  switch (p.routinePhase as Type69Phase) {
    case Type69Phase.Standing:
      if ((p.flags & BreakableFlag.Hit) !== 0) {
        BreakablePropAwardHit(p.flags, false, rng);
        events?.emit("sound.play", { id: SFX_PROP_CRACK });
        // `SpawnPropHitSpark(obj, player)` (`FUN_00465860`) at the aim
        // `combat/shot.ts` left on the prop, `z` from `obj+0x1A4`.
        if (p.hitAim) SpawnPropHitSpark(p.hitAim.x, p.hitAim.y, p.z);
        p.routinePhase = Type69Phase.Falling;
        p.vy = TYPE69_HOP;
      }
      break;
    case Type69Phase.Falling:
      p.vy = Math.fround(p.vy - TYPE69_GRAVITY);
      p.pitch += TYPE69_TUMBLE;
      p.roll += TYPE69_TUMBLE;
      p.y = Math.fround(p.vy + p.y);
      break;
  }

  const body = PropMatrixPush();
  MatrixTranslate(body, p.x, p.y, p.z);
  MatrixRotateZ(body, p.roll);
  MatrixRotateY(body, p.yaw);
  MatrixRotateX(body, p.pitch);
  PropDrawSlot(p, body, TYPE69_BODY_SLOT);

  const fixed = PropMatrixPush();
  MatrixTranslate(fixed, TYPE69_FIXED_AT[0], TYPE69_FIXED_AT[1],
                  TYPE69_FIXED_AT[2]);
  PropDrawSlot(p, fixed, TYPE69_FIXED_SLOT);

  PropRegisterForShotTest(p, p.x, Math.fround(p.y + TYPE69_SHOT_RISE), p.z);
}

/**
 * `PlaceGenericProp` case 0x45's arm: `obj+0x124 = 0x40800000` and nothing
 * else, `0x00462715`..`0x00462723`.
 *
 * `[port-only]` as a *function*: in the engine it is the arm at `0x00462715`
 * of `PlaceGenericProp`'s switch.
 */
export function PlaceGenericPropType69(p: BreakableProp,
                                       pl: BreakablePlacement,
                                       rng: Rng): void {
  void pl; void rng;
  p.hitRadius = TYPE69_RADIUS;
}
