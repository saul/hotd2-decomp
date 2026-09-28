/**
 * Class 0x41 type 59 — an invisible target in stage 3 that rings like metal
 * when it is shot.
 *
 * One shipped spawn: stage 3 block 4 step 4 op 15 (evt `0x5498`) at
 * `(-1101.5, 16.2, -3888)`, with a three-step lifetime and `desc+0x24` = 30,
 * which the arm makes a shot radius of 3.0.
 *
 * **It draws nothing.** There is no `AssetDrawSlot`, no lit twin and no
 * effect draw anywhere in the routine — its only matrix call is the
 * `MatrixTransformPoint` (`FUN_004A8A80`) that puts its own position in view
 * space for the shot test. So it is a sphere the player can hit, a sound, and
 * a hit effect, and nothing to see until then. `[open]` what in the scene it
 * stands in front of.
 *
 * ## The whole routine, `0x0046F750`..`0x0046F834`
 *
 * ```c
 * if ((s16)g_evt_step_index != (s8)obj->+0x196) {             // inlined
 *     if ((s16)(s8)++obj->+0x197 > (s16)obj->+0x11C) { ActorDespawn(obj); return; }
 *     obj->+0x196 = g_evt_step_index;
 * }
 * if ((obj->+0x34 & 8) && (char)obj->+0x192 == 0) {
 *     obj->+0x34 &= ~8;
 *     PlaySoundId(0x0E16A9);                                    // Ghidra stops here
 *     SpawnPropHitEffectScaled(obj, (obj->+0x34 & 2) ? 0 : 1, 1.0f);
 * }
 * obj->+0x34 &= ~6;
 * obj->+0x70..0x78 = MatrixTransformPoint(obj->+0x19C..0x1A4);
 * RegisterForShotTest(obj);
 * ```
 *
 * `PlaySoundId` is marked no-return, so the decompilation ends the hit arm at
 * the sound and drops the hit effect after it (`L35`): `0x0046F7BE`..
 * `0x0046F7D9` read `obj+0x34` again, push `1.0f` and the player index, and
 * call `SpawnPropHitEffectScaled` (`FUN_004666B0`). The mask and the shot
 * registration are outside the arm and run every frame.
 *
 * * The lifetime is the shared prologue's arithmetic **without the scene-1
 *   sweep**, with `ActorDespawn` (`FUN_00409CC0`) — the variant
 *   `PropStepLifetimeInline` transcribes, which this is the fourth writer of.
 * * `obj+0x192` is never written — not by the prologue, not by the arm, not
 *   by the routine — so the byte test always passes and **every** shot rings
 *   and sparks. `[proved]` for those three; the latch it would be has no
 *   writer here.
 * * No award: nothing calls `BreakablePropAwardHit` (`FUN_004650F0`), so a
 *   shot here scores nothing.
 * * The `AND 0xFFFFFFF9` clears only the two player bits; the hit bit `8` is
 *   cleared inside the arm, which is every frame it is set.
 * * `BULLET_MET1_16.WAV` is `0x0E16A9` (`hod2lib/combat.ts`).
 */
import type { Events } from "../../core/events";
import type { Rng } from "../../core/rng";
import type { BreakablePlacement } from "../../bundle";
import { SpawnPropHitEffectScaled } from "../effects/sprite";
import { PropStepLifetimeInline } from "./lifetime";
import { PropDrawBegin } from "./prop_draw";
import { BreakableFlag, type BreakableProp } from "./prop_state";
import { PropRegisterForShotTest } from "./shot_test";

/** `PlaySoundId(0x0E16A9)` — `COMMON\BULLET_MET1_16.WAV`, on every hit. */
export const SFX_TYPE59_HIT = 0x0e16a9;
/** `PUSH 0x3F800000` — the scale handed `SpawnPropHitEffectScaled`. */
export const TYPE59_HIT_EFFECT_SCALE = 1.0;
/** `AND EDX,0xFFFFFFF9` at `0x0046F7EB` — the two player bits, every frame. */
const TYPE59_PLAYER_BITS =
  BreakableFlag.HitByPlayer0 | BreakableFlag.HitByPlayer1;

/** `FMUL float [0x0055D230]` = `0x3DCCCCCD` — `desc+0x24` to a radius. */
export const TYPE59_RADIUS_SCALE = Math.fround(0.1);

/**
 * `PlaceGenericProp` case 0x3B's own arm.
 *
 * `[port-only]` as a *function*: in the engine it is the arm at `0x004624A4`
 * of `PlaceGenericProp`'s switch (entry 29 of `g_place_generic_prop_arms`):
 *
 * ```
 * 004624A4  MOVSX ECX,word ptr [EBP+0x1f4]   ; the placer's +0x1F4
 * 004624B0  FILD dword ptr [ESP+0x10]
 * 004624B4  FMUL float ptr [0x0055d230]      ; 0.1f
 * 004624BA  FSTP float ptr [ESI+0x124]
 * ```
 *
 * The placer's `+0x1F4` is `(s16)(s8)desc+0x24` (`EvtOpSpawnPlaced09`
 * (`FUN_004088A0`), `0x004088E8`), which the bundle carries as `field_1f4`.
 * The radius is set nowhere else: `GENERIC_RADIUS` has no row for 59.
 */
export function PlaceGenericPropType59(p: BreakableProp,
                                       pl: BreakablePlacement,
                                       rng: Rng): void {
  void rng;
  p.hitRadius = Math.fround((pl.field_1f4 ?? 0) * TYPE59_RADIUS_SCALE);
}

/**
 * `PropUpdateType59` — `FUN_0046F750`. One target, one 60 Hz frame.
 *
 * `+0x192` is {@link BreakableProp.routinePhase}, `+0x34`
 * {@link BreakableProp.flags}, and the point it registers is its own
 * position, `+0x19C..+0x1A4` — world space here, as `class41/shot_test.ts`
 * keeps every prop's.
 *
 * `SpawnPropHitEffectScaled` places its effect at the crosshair of the player
 * the routine names, unprojected to the prop's depth; the port resolved that
 * point when the shot landed and left it on the prop as `hitAim`, which is
 * the same player's shot.
 */
export function PropUpdateType59(p: BreakableProp, rng: Rng,
                                 events?: Events): void {
  void rng;
  PropDrawBegin(p);
  if (PropStepLifetimeInline(p)) return;
  if ((p.flags & BreakableFlag.Hit) !== 0 && (p.routinePhase & 0xff) === 0) {
    p.flags &= ~BreakableFlag.Hit;
    events?.emit("sound.play", { id: SFX_TYPE59_HIT });
    if (p.hitAim) {
      SpawnPropHitEffectScaled(p.hitAim.x, p.hitAim.y, p.z,
                               TYPE59_HIT_EFFECT_SCALE);
    }
  }
  p.flags &= ~TYPE59_PLAYER_BITS;
  PropRegisterForShotTest(p, p.x, p.y, p.z);
}
