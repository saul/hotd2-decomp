/**
 * Class 0x41 type 56 — stage 4's block-9 branch prop, which a **script flag**
 * swings open and a shot knocks a part off.
 *
 * One shipped descriptor: stage 4 block 9 step 2 (evt `0x58C8`), placed at
 * `(-196.5, -76.5, -282.3)` with no angles and a two-step lifetime. Block 9's
 * route record is `{11, -1, 17}`, so the 2 this routine writes sends block 9
 * to block 17.
 *
 * Two parts, two independent triggers `[proved]`:
 *
 * * a body, slot `0x1866`, posed on the actor-rotation words
 *   `obj+0x64/68/6C` under a fixed `RotY(0x6B00)`. `g_script_flags[5]` starts
 *   60 frames of hinge curve 0 on those words — and, in Original Mode in
 *   block 9, opens the route. **The shot is not what opens it.**
 * * a part, slot `0x10D3`, scaled 1.1, drawn `(4.8, -0.55, -10.5)` off the base
 *   point. The first shot raises `g_script_flags[0x0E]`, pays nothing, and the
 *   part starts to fall — for ever: there is no floor and no despawn on it.
 *   The shot sphere stays where the part started.
 *
 * The routine, `0x0046F090`..`0x0046F346`, read from the disassembly because
 * `PlaySoundId` and `MatrixStackPop` end Ghidra's pseudocode early twice over
 * (the hit arm's flag/effect/cursor writes, and the whole second draw and the
 * shot-test tail, are past them):
 *
 * ```c
 * if ((s16)g_evt_step_index != (s8)obj->+0x196) {       // inline lifetime,
 *     if (obj->+0x11C < (s8)++obj->+0x197) { ActorDespawn(obj); return; }
 *     obj->+0x196 = g_evt_step_index;                    // no scene-1 sweep
 * }
 * if ((obj->+0x34 & 8) && !(obj->+0x34 & 0x40000000)) {
 *     g_script_flags[0x0E] = 1;                          // 0x0046F0F2
 *     BreakablePropAwardHit(obj->+0x34, 0);
 *     PlaySoundId(0xF16A9);
 *     obj->+0x34 |= 0x40000000;                          // 0x0046F113
 *     SpawnPropHitEffectScaled(obj, !(obj->+0x34 & 2), 0.75f);
 *     obj->+0x2A8 = 0;                                   // 0x0046F135
 * }
 * if (obj->+0x34 & 0x40000000) { obj->+0x1C4 -= 0.02722f; obj->+0x1AC += obj->+0x1C4; }
 * if (g_script_flags[5] == 1 && obj->+0x192 == 0) {
 *     obj->+0x192 = 1; PlaySoundId(0x2116A9); PoseHookNone(4, 0x14);
 *     if (g_GameMode == 1 && g_evt_block_index == 9) g_script_branch_var = 2;
 * }
 * if (obj->+0x192 == 1 && obj->+0x2A8 < 0x3C) {
 *     f = g_pHingeCurvesXYZ[0][obj->+0x2A8++];
 *     obj->+0x6C = f.z + obj->+0x1D4; obj->+0x64 = f.x + obj->+0x1CC; obj->+0x68 = f.y;
 * }
 * Push; T(+0x40, +0x44, +0x48); RotY(0x6B00); RotZ(+0x6C); RotY(+0x68); RotX(+0x64);
 * AssetDrawSlot(0x1866); Pop;
 * Push; T(+0x40, +0x44, +0x48); T(4.8, +0x1AC - 0.55, -10.5); RotY(0x12B00);   // 0x0046F259
 * MatrixScale(1.1, 1.1, 1.1); NoOpStub(1.1f); AssetDrawSlot(0x10D3); Pop;
 * obj->+0x19C = +0x40 + 4.8; obj->+0x1A0 = +0x44 - 0.55; obj->+0x1A4 = +0x48 - 10.5;  // 0x0046F2CB
 * MatrixTransformPoint(&obj->+0x19C, &obj->+0x70); RegisterForShotTest(obj);
 * ```
 *
 * **It never masks `obj+0x34`** — no `AND` on it anywhere in the routine — so
 * the hit bit stays up after the first shot; bit 30 is what stops the arm
 * running twice. And the shot re-zeroes `obj+0x2A8`, the hinge cursor, so a
 * shot landing during or after the swing **replays the swing from frame 0**
 * (the second arm's own latch, `obj+0x192`, is untouched by it).
 *
 * `obj+0x19C..0x1A4` are **overwritten every frame** with the shot point, so
 * the prop's `x/y/z` are the placed position only until the first frame's
 * tail. The model's base point is `obj+0x40..0x48`, which the arm writes and
 * nothing after it does.
 *
 * `PoseHookNone` (`FUN_00420810`) and `NoOpStub` (`FUN_0041EBB0`) are both a
 * bare `RET`, and are not called here. Floats read from the image (`L1`):
 * `0.02722f` at `0x0055CB10` (`0x3CDEFC7A`), `0.55f` at `0x005643D0`
 * (`0x3F0CCCCD`), `4.8f` at `0x00569118` and as a `PUSH` (`0x4099999A`),
 * `10.5f` at `0x0056901C` and `-10.5f` as a `PUSH` (`0xC1280000`), `1.1f`
 * (`0x3F8CCCCD`), `0.75f` (`0x3F400000`), `1.5f` (`0x3FC00000`).
 */
import type { Events } from "../../core/events";
import type { Rng } from "../../core/rng";
import type { BreakablePlacement, BreakablesJson } from "../../bundle";
import { SpawnPropHitEffectScaled } from "../effects/sprite";
import { G } from "../globals";
import { GameMode } from "../game_mode";
import {
  MatrixRotateX, MatrixRotateY, MatrixRotateZ, MatrixScale, MatrixTranslate,
} from "../matrix";
import { T } from "../tables";
import { PropStepLifetimeInline } from "./lifetime";
import { BreakablePropAwardHit } from "./prop";
import { PropDrawBegin, PropDrawSlot, PropMatrixPush } from "./prop_draw";
import { BreakableFlag, type BreakableProp } from "./prop_state";
import { PropRegisterForShotTest } from "./shot_test";
import { PropWords } from "./words";

/**
 * The words of the object `PropUpdateType56` keeps that no shared field
 * carries. All three are the **actor-rotation words**, which
 * `PlaceGenericProp`'s prologue does not write and this type poses its body
 * from instead of `obj+0x1CC..0x1D4`.
 */
interface Type56Words {
  /** `obj+0x64` — the body's pitch: 0, then hinge `x` + `obj+0x1CC`. */
  o64: number;
  /** `obj+0x68` — the body's yaw: the descriptor's, then hinge `y` alone. */
  o68: number;
  /** `obj+0x6C` — the body's roll: 0, then hinge `z` + `obj+0x1D4`. */
  o6C: number;
}
const TYPE56_WORDS_ZERO: Type56Words = { o64: 0, o68: 0, o6C: 0 };

/** `obj+0x192` as `PropUpdateType56` reads it. */
export enum Type56Phase {
  /** `g_script_flags[5]` has not been seen up. */
  Waiting = 0,
  /** It has: the hinge runs its 60 frames and the latch is spent. */
  Swinging = 1,
}

/** `g_script_flags[5]` (`0x009C7205`) — swing the body, and open the route. */
export const SCRIPT_FLAG_TYPE56_SWING = 0x05;
/** `g_script_flags[0x0E]` (`0x009C720E`) — raised by the first shot. */
export const SCRIPT_FLAG_TYPE56_STRUCK = 0x0e;
/** `CMP word [g_evt_block_index], 9` at `0x0046F19D`. */
export const TYPE56_ROUTE_BLOCK = 9;
/** `MOV word [g_script_branch_var], 2` at `0x0046F1A7`. */
export const TYPE56_ROUTE = 2;

/**
 * `obj+0x34` bit 30 — this routine's "the shot has been taken, the part is
 * falling". The same bit several branch props use for "answered"; here it
 * gates the fall as well as the hit arm, so it is named for what it does to
 * this object (`L3`).
 */
export const TYPE56_STRUCK = 0x40000000;

/** The body: `AssetDrawSlot(0x1866)` at `0x0046F249`. */
export const TYPE56_BODY_SLOT = 0x1866;
/** The part: `AssetDrawSlot(0x10D3)` at `0x0046F2BB`; the arm's `obj+0x28C`. */
export const TYPE56_PART_SLOT = 0x10d3;

/** `MatrixRotateY(0x6B00)` — the body's fixed mounting turn, 150.5°. */
export const TYPE56_BODY_YAW = 0x6b00;
/** `MatrixRotateY(0x12B00)` — the part's; one whole turn plus `0x2B00`. */
export const TYPE56_PART_YAW = 0x12b00;
/** `PUSH 0x3F8CCCCD` three times — the part's `MatrixScale`. */
export const TYPE56_PART_SCALE = Math.fround(1.1);
/** `0x4099999A` — the part's X off the base, in the draw and the shot. */
export const TYPE56_PART_X = Math.fround(4.8);
/** `0x005643D0`, `0x3F0CCCCD` — the part sits this far below the base. */
export const TYPE56_PART_DROP = Math.fround(0.55);
/** `0x0056901C`, `10.5` — and this far back in Z. */
export const TYPE56_PART_BACK = 10.5;

/** `0x0055CB10`, `0x3CDEFC7A` — taken off `obj+0x1C4` each falling frame. */
export const TYPE56_GRAVITY = Math.fround(0.02722);
/** `PUSH 0x3F400000` — `SpawnPropHitEffectScaled`'s scale on the shot. */
export const TYPE56_HIT_EFFECT_SCALE = 0.75;
/** `CMP ECX, 0x3C` — the frames of the hinge curve the swing plays. */
export const TYPE56_HINGE_FRAMES = 0x3c;
/**
 * `MOV EDX, [0x005960B4]` — the first pointer of `g_pHingeCurvesXYZ`, so
 * selector 0.
 */
export const TYPE56_HINGE_CURVE = 0;

/** `obj+0x124 = 0x3FC00000` in the arm. */
export const TYPE56_RADIUS = 1.5;

/** `PlaySoundId(0xF16A9)` — the shot. */
export const SFX_TYPE56_STRUCK = 0xf16a9;
/** `PlaySoundId(0x2116A9)` — the flag's swing. */
export const SFX_TYPE56_SWING = 0x2116a9;

/**
 * `g_pHingeCurvesXYZ[curve][frame]` — `0x005960B4`, five pointers to 6-byte
 * `{s16 rx, ry, rz}` frames (`hod2lib/props.ts` `hingeCurve` reads them for
 * the exporter), as the bundle carries them: selectors 0, 2 and 3.
 *
 * `null` for a frame or a curve the bundle does not carry. A bundle written
 * before the table travelled has none of them.
 *
 * `[port-only]` as a *function*: the engine indexes the table inline in every
 * routine that swings on it (`PropUpdateType56` here; `HingeUpdate` and the
 * other branch props elsewhere), and this is the one place the port reaches
 * it from `game/`.
 */
export function HingeCurveXYZFrame(curve: number, frame: number):
    readonly [number, number, number] | null {
  const tables = T.breakables as (BreakablesJson & {
    hinge_curves_xyz?: Record<string, number[][]>;
  }) | null;
  const f = tables?.hinge_curves_xyz?.[String(curve)]?.[frame];
  return f ? [f[0], f[1], f[2]] : null;
}

/**
 * `PropUpdateType56` — `FUN_0046F090`. `g_class41_updates[56]`. One prop,
 * one 60 Hz frame.
 *
 * `obj+0x40..0x48` is {@link BreakableProp.hitPos} (the base point),
 * `obj+0x1AC` {@link BreakableProp.restY} (the part's fall),
 * `obj+0x1C4` {@link BreakableProp.vy}, `obj+0x2A8`
 * {@link BreakableProp.cueCursorB} (the hinge cursor) and `obj+0x192`
 * {@link BreakableProp.routinePhase}.
 */
export function PropUpdateType56(p: BreakableProp, rng: Rng,
                                 events?: Events): void {
  PropDrawBegin(p);
  // The inline lifetime: `PropExpireByStepLifetime`'s arithmetic with the
  // scene-1 sweep left out. Stage 4 is scene 3, where that sweep could not
  // fire -- which is `L27`'s argument, so the difference is kept.
  if (PropStepLifetimeInline(p)) return;
  const w = PropWords(p, TYPE56_WORDS_ZERO);

  if ((p.flags & BreakableFlag.Hit) !== 0 && (p.flags & TYPE56_STRUCK) === 0) {
    G.g_script_flags[SCRIPT_FLAG_TYPE56_STRUCK] = 1;
    // `PUSH 0` — pays no points, still counts the hit.
    BreakablePropAwardHit(p.flags, false, rng);
    events?.emit("sound.play", { id: SFX_TYPE56_STRUCK });
    p.flags |= TYPE56_STRUCK;
    // `SpawnPropHitEffectScaled(obj, player, 0.75f)` (`FUN_004666B0`) at the
    // aim `combat/shot.ts` left on the prop, `z` from `obj+0x1A4` -- which by
    // now is last frame's shot point, not the placement.
    if (p.hitAim) {
      SpawnPropHitEffectScaled(p.hitAim.x, p.hitAim.y, p.z,
                               TYPE56_HIT_EFFECT_SCALE);
    }
    p.cueCursorB = 0;
  }

  if ((p.flags & TYPE56_STRUCK) !== 0) {
    // `FST [+0x1C4]` then `FADD [+0x1AC]` on the same stack top.
    p.vy = Math.fround(p.vy - TYPE56_GRAVITY);
    p.restY = Math.fround(p.vy + p.restY);
  }

  if ((G.g_script_flags[SCRIPT_FLAG_TYPE56_SWING] ?? 0) === 1
      && p.routinePhase === Type56Phase.Waiting) {
    p.routinePhase = Type56Phase.Swinging;
    events?.emit("sound.play", { id: SFX_TYPE56_SWING });
    // `PoseHookNone(4, 0x14)` (`FUN_00420810`) -- a bare `RET`.
    //
    // The latch is taken before the mode and block test, so in Arcade, or in
    // any other block, the flag swings the body and the route is never
    // written.
    if (G.g_GameMode === GameMode.Original
        && G.g_evt_block_index === TYPE56_ROUTE_BLOCK) {
      G.g_script_branch_var = TYPE56_ROUTE;
    }
  }

  if (p.routinePhase === Type56Phase.Swinging
      && p.cueCursorB < TYPE56_HINGE_FRAMES) {
    const i = p.cueCursorB;
    const f = HingeCurveXYZFrame(TYPE56_HINGE_CURVE, i);
    // A bundle that does not carry the curve leaves the pose where it was;
    // the cursor still runs its sixty frames, so the latch and the replay a
    // shot causes are unchanged.
    if (f) {
      w.o6C = f[2] + p.roll;
      w.o64 = f[0] + p.pitch;
      w.o68 = f[1];
    }
    p.cueCursorB = i + 1;
  }

  // The body.
  const body = PropMatrixPush();
  MatrixTranslate(body, p.hitPos.x, p.hitPos.y, p.hitPos.z);
  MatrixRotateY(body, TYPE56_BODY_YAW);
  MatrixRotateZ(body, w.o6C);
  MatrixRotateY(body, w.o68);
  MatrixRotateX(body, w.o64);
  PropDrawSlot(p, body, TYPE56_BODY_SLOT);

  // The part: two translations, which compose by addition (`L5`), and the
  // fall only in the second. `NoOpStub(1.1f)` (`FUN_0041EBB0`) between the
  // scale and the draw is a bare `RET`.
  const part = PropMatrixPush();
  MatrixTranslate(part, p.hitPos.x, p.hitPos.y, p.hitPos.z);
  MatrixTranslate(part, TYPE56_PART_X,
                  Math.fround(p.restY - TYPE56_PART_DROP), -TYPE56_PART_BACK);
  MatrixRotateY(part, TYPE56_PART_YAW);
  MatrixScale(part, TYPE56_PART_SCALE, TYPE56_PART_SCALE, TYPE56_PART_SCALE);
  PropDrawSlot(p, part, TYPE56_PART_SLOT);

  // The shot point, written over the prop's own position, and **without**
  // the fall: the sphere stays where the part started.
  p.x = Math.fround(p.hitPos.x + TYPE56_PART_X);
  p.y = Math.fround(p.hitPos.y - TYPE56_PART_DROP);
  p.z = Math.fround(p.hitPos.z - TYPE56_PART_BACK);
  PropRegisterForShotTest(p, p.x, p.y, p.z);
}

/**
 * `PlaceGenericProp` case 0x38's arm:
 *
 * ```
 * 00462474  obj->+0x40/+0x44/+0x48 = placer->+0x40/+0x44/+0x48   ; the position
 * 0046248a  obj->+0x124 = 0x3FC00000                            ; 1.5
 * 00462494  obj->+0x68 = placer->+0x68                          ; the yaw word
 * 00462497  obj->+0x28C = 0x10D3
 * ```
 *
 * `[port-only]` as a *function*: in the engine it is the arm at `0x00462474`
 * of `PlaceGenericProp`'s switch. The placer's `+0x40..0x48` and `+0x68` are
 * the words the prologue copies to `obj+0x19C..0x1A4` and `obj+0x1D0`, so the
 * placement's `pos` and `yaw` carry them.
 */
export function PlaceGenericPropType56(p: BreakableProp,
                                       pl: BreakablePlacement,
                                       rng: Rng): void {
  void rng;
  p.hitPos = { x: pl.pos?.[0] ?? 0, y: pl.pos?.[1] ?? 0, z: pl.pos?.[2] ?? 0 };
  p.hitRadius = TYPE56_RADIUS;
  PropWords(p, TYPE56_WORDS_ZERO).o68 = pl.yaw ?? 0;
  p.slot = TYPE56_PART_SLOT;
}
