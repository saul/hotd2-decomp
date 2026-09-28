/**
 * Class 0x41 type 32 — the lift, and the one class-0x41 prop that *moves*.
 *
 * ## What it is, and how the name was got wrong first
 *
 * `LiftUpdate` draws three asset slots, and all three live in
 * **`komono_suimon.bin`** — *komono*, small items; *suimon* (水門), a sluice
 * gate. Read off the filename alone this is a water gate, and it was called
 * one for an hour. It is not: **the asset file is named for the area, not for
 * the object in it.**
 *
 * What it actually is, from the code and from looking at the render:
 *
 * * The routine's first act after its lifetime is
 *   `obj->y = g_camera_block_eye.y - 15.0`, held for as long as script flag
 *   0x37 is up. Stage 2 raises that flag in block 18 step 1 op 5 and then
 *   plays camera path 28 (`cp_st2` slot 83) for 1175 frames, over which the
 *   **eye climbs from 55.0 to 144.2**. So the object rides from 40.0 to 129.2
 *   — and 40.0 is exactly where the spawn puts it. An 89-unit vertical ride
 *   with the camera standing on it. `[likely]`, from the script and the path.
 * * Drawn, it is a **folding lattice cage gate** in two pairs of leaves, seen
 *   from inside, with a person's legs visible through it.
 * * The leaves' sound is `COMMON\DOORKICK3_22K_1.WAV`.
 *
 * Stage 2 places exactly one, at (-825.1, 40.0, -1871.7), from block 17 step
 * 8 (evt `0xBDC0`), with the descriptor's `+0x11C` = 2 — a two-step lifetime,
 * which is what `PropExpireByStepLifetime` charges it against.
 *
 * ## The routine, `0x0046A360`..`0x0046A577` `[proved]`
 *
 * ```
 * 0046a366  CALL PropExpireByStepLifetime(obj)    ; result not tested -- a
 *                                                 ; retirement never returns
 * 0046a36b  CMP byte g_script_flags[0x37],1 ; JNZ
 * 0046a38c    FLD [0x009A60C4 + g_camera_index*0x1A4]  ; the block's eye y
 * 0046a393    FSUB float [0x004C4398]                  ; 15.0 = 0x41700000
 * 0046a399    FSTP [ESI+0x1a0]
 * 0046a39f  CMP byte g_script_flags[0x6b],1 ; JNZ 0046a3d9
 * 0046a3ae    CMP [ESI+0x1d0],0x8000 ; JG 0046a3d3
 * 0046a3b5      CMP [ESI+0x1d0],0x4000 ; JNZ ; PlaySoundId(0x2216A9)
 * 0046a3c9      ADD [ESI+0x1d0],0x200
 * 0046a3d3    INC [ESI+0x2a0]                      ; outside the angle test
 * 0046a3d9  CMP byte g_script_flags[0x6c],1 ; JNZ 0046a40d
 * 0046a3e8    CMP [ESI+0x1e8],0xc000 ; JG
 * 0046a3ef      CMP [ESI+0x1e8],0x8000 ; JNZ ; PlaySoundId(0x2216A9)
 * 0046a403      ADD [ESI+0x1e8],0x200
 * 0046a40d  CMP [ESI+0x2a0],0x28 ; JL 0046a43e
 * 0046a416    CMP [ESI+0x1cc],0x1000 ; JG
 * 0046a423      TEST [ESI+0x1cc] ; JNZ ; PlaySoundId(0x2516A9)
 * 0046a434      ADD [ESI+0x1cc],0x200
 * 0046a43e  Push(0); Translate(+0x19C, +0x1A0, +0x1A4); AssetDrawSlot(0x197A)
 * 0046a469    Push(0); Translate(9.619, 0.0451, -8.4127)
 *               RotY(+0x1D0);                      AssetDrawSlot(0x197B)
 *               Translate(-6.5, 0, 0)
 *               RotY((-0x4000 - +0x1D0) << 1);     AssetDrawSlot(0x197B)
 * 0046a4ca    Pop(1)
 * 0046a4d1    Push(0); Translate(-3.988, 0.0451, -9.6331)
 *               RotY(+0x1E8);                      AssetDrawSlot(0x197B)
 *               Translate(-6.5, 0, 0)
 *               RotY(-+0x1E8 << 1);                AssetDrawSlot(0x197B)
 * 0046a52a    Pop(1)
 * 0046a531    Translate(-3.2134, 13.0, -2.0); RotX(+0x1CC)
 *             Translate(0, 1.0, 0);                AssetDrawSlot(0x1981)
 * 0046a56e  Pop(1) ; RET
 * ```
 *
 * The two inner pushes are **siblings** under the car's translate — each is
 * popped before the next — and the panel composes on the car too (`L4`). The
 * root takes **no** rotation: `obj+0x1CC` and `+0x1D0` are hinge angles for
 * this type, not the prop's orientation. No `RegisterForShotTest`, no radius,
 * no `AND` on `obj+0x34`: nothing about it can be shot. Every float operand
 * is a `PUSH imm32` read off the disassembly (`L1`).
 *
 * ## Three script flags and a counter
 *
 * Nothing here is on a timer; every motion is a script flag the event script
 * raises, which is why the lift stands inert in a replay that has not reached
 * the instruction that raises it. Stage 2's order is: block 17 step 8 op 26
 * spawns it, op 28 raises 0x6B and the near pair starts to fold; block 18 step
 * 1 op 5 raises 0x37 and the ride begins; op 15 waits for path frame 220 and
 * op 16 raises 0x6C, folding the far pair.
 *
 * Each angle test is `JG limit`, so the frame that finds a hinge exactly at
 * its limit still adds a step: every one of them comes to rest **one 0x200
 * past** the round number. The sound tests are equalities against the
 * *starting* angle, so each fires on the first frame of its swing and never
 * again — `PlaceGenericProp` case 0x20 (`0x0046209F`) seeds exactly those
 * three values.
 *
 * The panel is the only part with no flag of its own: it waits on `obj+0x2A0`,
 * which counts frames flag 0x6B has been up, so it moves on the frame that
 * count reaches 0x28 and never at all if that flag is never raised.
 * `[open]` what the panel is — it hinges about X, thirteen units above the car
 * floor.
 */
import type { Events } from "../../core/events";
import { G } from "../globals";
import {
  MatrixRotateX, MatrixRotateY, MatrixTranslate,
} from "../matrix";
import { PropExpireByStepLifetime } from "./lifetime";
import { PropDrawBegin, PropDrawSlot, PropMatrixPush } from "./prop_draw";
import type { BreakableProp } from "./prop_state";

/**
 * The `g_script_flags` (0x009C7200) entries this routine reads. Their meaning
 * is the lift's, not the script's: the script only raises them.
 */
export enum LiftFlag {
  /** 0x009C7237 — ride the camera. */
  RideCamera = 0x37,
  /** 0x009C726B — fold the near pair of cage leaves. */
  OpenNear = 0x6b,
  /** 0x009C726C — fold the far pair. */
  OpenFar = 0x6c,
}

/**
 * `FSUB float [0x004C4398]` (`0x41700000`) — how far under the camera block's
 * eye the car floor sits while riding.
 */
export const LIFT_RIDE_DROP = 15.0;

/** BAMS added to whichever hinge is moving, once per 60 Hz frame. */
export const LIFT_HINGE_STEP = 0x200;

/** `+0x1D0` — the near pair's rest angle and the angle it opens to. */
export const LIFT_NEAR_CLOSED = 0x4000;
export const LIFT_NEAR_OPEN = 0x8000;
/** `+0x1E8` — the far pair's. */
export const LIFT_FAR_CLOSED = 0x8000;
export const LIFT_FAR_OPEN = 0xc000;
/** `+0x1CC` — the overhead panel's. */
export const LIFT_PANEL_CLOSED = 0;
export const LIFT_PANEL_OPEN = 0x1000;
/**
 * `CMP dword [ESI+0x2a0],0x28 ; JL` at `0x0046A40D` — the frame count of flag
 * 0x6B that releases the panel: it swings once the count is 0x28 or more.
 */
export const LIFT_PANEL_DELAY = 0x28;

/** `COMMON\DOORKICK3_22K_1.WAV`, as each pair of cage leaves starts to fold. */
export const SFX_LIFT_GATE = 0x2216a9;
/** `COMMON\ENE_WALK2_11.WAV`, as the panel starts to swing. */
export const SFX_LIFT_PANEL = 0x2516a9;

/** `PUSH 0x197A` at `0x0046A45F` — the car. */
export const LIFT_CAR_SLOT = 0x197a;
/** `PUSH 0x197B`, four times — every cage leaf is the same model. */
export const LIFT_LEAF_SLOT = 0x197b;
/** `PUSH 0x1981` at `0x0046A562` — the overhead panel. */
export const LIFT_PANEL_SLOT = 0x1981;
/**
 * `PUSH 0xC1069A6B ; PUSH 0x3D38BAC7 ; PUSH 0x4119E76D` at `0x0046A470` —
 * the near pair's hinge on the car, `(9.619, 0.0451, -8.4127)`.
 */
export const LIFT_HINGE_NEAR: readonly [number, number, number] =
  [Math.fround(9.619), Math.fround(0.0451), Math.fround(-8.4127)];
/**
 * `PUSH 0xC11A212D ; PUSH 0x3D38BAC7 ; PUSH 0xC07F3B64` at `0x0046A4D8` —
 * the far pair's, `(-3.988, 0.0451, -9.6331)`.
 */
export const LIFT_HINGE_FAR: readonly [number, number, number] =
  [Math.fround(-3.988), Math.fround(0.0451), Math.fround(-9.6331)];
/** `PUSH 0 ; PUSH 0 ; PUSH 0xC0D00000` — leaf two hangs `-6.5` along leaf one. */
export const LIFT_LEAF_SPAN = -6.5;
/**
 * `MOV EDX,0xFFFFC000 ; SUB EDX,ECX ; SHL EDX,1` at `0x0046A4AE` — the near
 * pair's second leaf turns `(-0x4000 - obj+0x1D0) * 2`; the far pair's is
 * `NEG ; SHL` (`0x0046A516`), the same with no bias.
 */
export const LIFT_NEAR_FOLD_BIAS = -0x4000;
/**
 * `PUSH 0xC0000000 ; PUSH 0x41500000 ; PUSH 0xC04DA858` at `0x0046A531` —
 * the panel's hinge, `(-3.2134, 13.0, -2.0)`.
 */
export const LIFT_PANEL_AT: readonly [number, number, number] =
  [Math.fround(-3.2134), 13.0, -2.0];
/** `PUSH 0 ; PUSH 0x3F800000 ; PUSH 0` — the panel model sits 1.0 up its hinge. */
export const LIFT_PANEL_RISE = 1.0;

/** True while the script is holding this flag at exactly 1 (`CMP byte,1`). */
function ScriptFlagUp(f: LiftFlag): boolean {
  return (G.g_script_flags[f] ?? 0) === 1;
}

/**
 * `LiftUpdate` — `FUN_0046A360`. `g_class41_updates[32]` (`0x0059373C`).
 *
 * One call per 60 Hz frame, from the container pool. No `rand()` anywhere in
 * it, so it takes no generator.
 */
export function LiftUpdate(p: BreakableProp, events?: Events): void {
  PropDrawBegin(p);
  if (PropExpireByStepLifetime(p)) return;

  if (ScriptFlagUp(LiftFlag.RideCamera)) {
    // `FLD float; FSUB float; FSTP float [ESI+0x1a0]`.
    p.y = Math.fround(G.g_camera_block_eye.y - LIFT_RIDE_DROP);
  }

  if (ScriptFlagUp(LiftFlag.OpenNear)) {
    if (p.yaw <= LIFT_NEAR_OPEN) {
      if (p.yaw === LIFT_NEAR_CLOSED) {
        events?.emit("sound.play", { id: SFX_LIFT_GATE });
      }
      p.yaw += LIFT_HINGE_STEP;
    }
    // `0x0046A3D3` is the target of the `JG` too: the counter runs for as
    // long as the flag is up, whether or not the leaves still have anywhere
    // to go.
    p.storyItem += 1;
  }

  if (ScriptFlagUp(LiftFlag.OpenFar) && p.hingeB <= LIFT_FAR_OPEN) {
    if (p.hingeB === LIFT_FAR_CLOSED) {
      events?.emit("sound.play", { id: SFX_LIFT_GATE });
    }
    p.hingeB += LIFT_HINGE_STEP;
  }

  if (p.storyItem >= LIFT_PANEL_DELAY && p.pitch <= LIFT_PANEL_OPEN) {
    if (p.pitch === LIFT_PANEL_CLOSED) {
      events?.emit("sound.play", { id: SFX_LIFT_PANEL });
    }
    p.pitch += LIFT_HINGE_STEP;
  }

  // The draw, after the state: every angle is this frame's.
  const car = PropMatrixPush();
  MatrixTranslate(car, p.x, p.y, p.z);
  PropDrawSlot(p, car, LIFT_CAR_SLOT);

  const near = PropMatrixPush(car);
  MatrixTranslate(near, ...LIFT_HINGE_NEAR);
  MatrixRotateY(near, p.yaw);
  PropDrawSlot(p, near, LIFT_LEAF_SLOT);
  MatrixTranslate(near, LIFT_LEAF_SPAN, 0, 0);
  MatrixRotateY(near, ((LIFT_NEAR_FOLD_BIAS - p.yaw) * 2) | 0);
  PropDrawSlot(p, near, LIFT_LEAF_SLOT);

  const far = PropMatrixPush(car);
  MatrixTranslate(far, ...LIFT_HINGE_FAR);
  MatrixRotateY(far, p.hingeB);
  PropDrawSlot(p, far, LIFT_LEAF_SLOT);
  MatrixTranslate(far, LIFT_LEAF_SPAN, 0, 0);
  MatrixRotateY(far, (-p.hingeB * 2) | 0);
  PropDrawSlot(p, far, LIFT_LEAF_SLOT);

  MatrixTranslate(car, ...LIFT_PANEL_AT);
  MatrixRotateX(car, p.pitch);
  MatrixTranslate(car, 0, LIFT_PANEL_RISE, 0);
  PropDrawSlot(p, car, LIFT_PANEL_SLOT);
}
