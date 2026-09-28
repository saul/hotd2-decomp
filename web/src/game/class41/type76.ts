/**
 * Class 0x41 type 76 — the stage-4 door a shot swings open, and a route.
 *
 * Two shipped spawns, both stage 4 (scene 3), both Original Mode only:
 *
 * | evt | `+0x194` | where | block | opens on |
 * |---|---|---|---|---|
 * | `0x4A94` | 1 | the routine's own literal points | 5 | the shot alone |
 * | `0x77B8` | 0 | its placement, `(92.3, -73.4, -855.5)` | 14 | a shot while item 0, 2 or 0xB is held |
 *
 * `obj+0x194` is the placer's `+0x1F4` byte (`PlaceGenericProp` case 0x4C,
 * `0x004628B2`) and it picks **both** the route arm and the draw: 0 is one
 * door at the prop's own pose with a plate on it, 1 is a pair of leaves at
 * two literal world points — which is why that spawn is placed at the origin.
 * The route itself is `g_script_branch_var = 2`, and both records it can open
 * have their live alternate in slot 2: `{7, -1, 21}` and `{15, -1, 20}`.
 *
 * Once opened, the doors swing through the sixty frames of hinge curve 0
 * (`*g_pHingeCurvesXYZ`), and the plate is no longer drawn.
 *
 * Read from the disassembly of `0x00471330`..`0x0047179E`: `PlaySoundId` is
 * marked no-return, so the pseudocode stops at the first sound and never
 * reaches the swing, either draw or the registration (`L35`).
 */
import type { Events } from "../../core/events";
import type { Rng } from "../../core/rng";
import type { BreakablePlacement } from "../../bundle";
import { SpawnPropHitEffectScaled } from "../effects/sprite";
import { G } from "../globals";
import { CameraBlockViewToWorld } from "../camera/view";
import { GameMode } from "../game_mode";
import {
  MatrixLoadIdentity, MatrixRotateX, MatrixRotateY, MatrixRotateZ,
  MatrixScale, MatrixTransformPoint, MatrixTranslate,
} from "../matrix";
import { PlayerHoldsOriginalItem } from "../original_mode";
import { T } from "../tables";
import { vec3 } from "../vec";
import { BranchBlock, PROP_BRANCH_ANSWERED } from "./branch";
import { ActorDespawnProp, BreakablePropAwardHit } from "./prop";
import {
  PropDrawBegin, PropDrawSlot, PropMatrixPush, PropMatrixTRzRyRx,
} from "./prop_draw";
import { BreakableFlag, type BreakableProp } from "./prop_state";
import { PropRegisterForShotTest } from "./shot_test";
import { PropWords } from "./words";

/** `obj+0x192` as `PropUpdateType76` reads it. */
export enum Type76Phase {
  /** Shut. A shot pays and sparks, and may open it. */
  Shut = 0,
  /** Opened: the swing runs, and shots do nothing. */
  Open = 1,
}

/** `obj+0x194`, the placer's byte: which door this is. */
export enum Type76Door {
  /** One door at the prop's own pose, `0xA6D`, with the plate `0x10D3`. */
  Single = 0,
  /** Two leaves at literal world points, `0xA67` and `0xA68`. */
  Pair = 1,
}

/** The items `PlayerHoldsOriginalItem` is asked for in block 0x0E. */
export const TYPE76_KEYS: readonly number[] = [0, 2, 0x0b];
/** `PUSH 0x3F400000` — the impact effect's scale, 0.75. */
export const TYPE76_HIT_EFFECT_SCALE = 0.75;
/** `PlaySoundId(0xF16A9)` — every shot while shut. */
export const SFX_TYPE76_HIT = 0xf16a9;
/** `PlaySoundId(0x2116A9)` — it opens. */
export const SFX_TYPE76_OPEN = 0x2116a9;
/** `CMP ECX, 0x3C; JGE` — the swing's length, frames of curve 0. */
export const TYPE76_SWING_FRAMES = 0x3c;
/** `MOV EDX, [0x005960B4]` — `*g_pHingeCurvesXYZ`, curve 0. */
export const TYPE76_HINGE_CURVE = 0;

/** The single door's plate: `T(-2.5, -30, -17.5) RotY(0x4000) Scale(1.2)`. */
export const TYPE76_PLATE_SLOT = 0x10d3;
export const TYPE76_SINGLE_SLOT = 0x0a6d;
export const TYPE76_PLATE_AT: readonly [number, number, number] =
  [-2.5, -30.0, -17.5];
export const TYPE76_PLATE_YAW = 0x4000;
export const TYPE76_PLATE_SCALE = 1.2000000476837158;

/**
 * The pair's two leaves. Each is `LoadIdentity`/`Push; T(literal);
 * RotY(-0x2168)` and then its own three angles:
 * the first `RotZ(+0x1D4) RotY(+0x1E8) RotX(+0x1E4)`, with the plate
 * `T(12.5, 23.5, 0.5)` on it and **no** scale (the `NoOpStub(1.2)` there is
 * all that is left of one); the second `RotZ(+0x1D4) RotY(+0x1D0)
 * RotX(+0x1CC)`. Raw words `0xC3C582D1, 0x410D6C8B, 0xC4022093` and
 * `0xC3BCC560, 0x410D6C8B, 0xC3FAD7CF`.
 */
export const TYPE76_PAIR_SLOT_A = 0x0a67;
export const TYPE76_PAIR_SLOT_B = 0x0a68;
export const TYPE76_PAIR_A_AT: readonly [number, number, number] =
  [-395.0220031738281, 8.83899974822998, -520.5089721679688];
export const TYPE76_PAIR_B_AT: readonly [number, number, number] =
  [-377.5419921875, 8.83899974822998, -501.6860046386719];
/** `PUSH 0xFFFFDE98` — both leaves' mounting yaw. */
export const TYPE76_PAIR_YAW = -0x2168;
export const TYPE76_PAIR_PLATE_AT: readonly [number, number, number] =
  [12.5, 23.5, 0.5];

/**
 * The single door's shot point: its own position less `(2.5, 30.0, 17.5)`
 * on **world** axes (`0x00569160`, `0x00569158`, `0x00569150`), where the
 * plate it is drawn at is the same three inside the door's rotation. That
 * is the exe's own inconsistency, not a reading.
 */
export const TYPE76_SINGLE_SHOT_OFFSET: readonly [number, number, number] =
  [-2.5, -30.0, -17.5];

/**
 * The one word of the 0x378 object this routine keeps that no shared field
 * carries. See `class41/words.ts`.
 */
interface Type76Words {
  /** `obj+0x194` (s8) — the placer's byte: which door this is. */
  o194: number;
}
const TYPE76_WORDS_ZERO: Type76Words = { o194: 0 };

/**
 * `PlaceGenericProp` case 0x4C, `0x004628A8`: `obj+0x194` from the placer's
 * byte, beside the 3.0 radius `generic.ts`'s table has.
 *
 * `[port-only]` as a *function*: an arm of the switch, reached through
 * `GENERIC_PLACE_ARMS` (`class41/generic_routines.ts`).
 */
export function PlaceGenericPropType76(p: BreakableProp,
                                       pl: BreakablePlacement,
                                       _rng: Rng): void {
  PropWords(p, TYPE76_WORDS_ZERO).o194 = ((pl.field_1f4 ?? 0) << 24) >> 24;
  // `+0x2A8`, the swing's frame, is zero from `ActorClearGameFields`.
  p.cueCursorB = 0;
}

const _p = vec3();
const _o = vec3();

/**
 * `PropUpdateType76` — `FUN_00471330`. One door, one 60 Hz frame.
 *
 * `+0x2A8` is {@link BreakableProp.cueCursorB} (the swing's frame), `+0x1E4`
 * {@link BreakableProp.restPitch} and `+0x1E8` {@link BreakableProp.hingeB}
 * (the first leaf's own pitch and yaw), `+0x194` its own word and `+0x192`
 * {@link BreakableProp.routinePhase}.
 */
export function PropUpdateType76(p: BreakableProp, rng: Rng,
                                 events?: Events): void {
  PropDrawBegin(p);
  if (G.g_GameMode !== GameMode.Original) {
    ActorDespawnProp(p);
    return;
  }
  // The inline lifetime, without the scene-1 sweep.
  if (G.g_evt_step_index !== p.lastStepIndex) {
    p.stepsElapsed += 1;
    if (p.stepsElapsed > p.lifetime) {
      ActorDespawnProp(p);
      return;
    }
    p.lastStepIndex = G.g_evt_step_index;
  }

  if ((p.flags & BreakableFlag.Hit) !== 0
      && p.routinePhase === Type76Phase.Shut) {
    p.flags &= ~BreakableFlag.Hit;
    BreakablePropAwardHit(p.flags, false, rng);
    if (p.hitAim) {
      SpawnPropHitEffectScaled(p.hitAim.x, p.hitAim.y, p.z,
                               TYPE76_HIT_EFFECT_SCALE);
    }
    events?.emit("sound.play", { id: SFX_TYPE76_HIT });
    // The key is asked only in block 0x0E, and only after the hit has paid:
    // a shot without it still scores and still sparks.
    if ((PropWords(p, TYPE76_WORDS_ZERO).o194 === Type76Door.Pair
         && G.g_evt_block_index === BranchBlock.Type76First)
        || (G.g_evt_block_index === BranchBlock.Type76Keyed
            && TYPE76_KEYS.some(PlayerHoldsOriginalItem))) {
      p.routinePhase = Type76Phase.Open;
      G.g_script_branch_var = 2;
      events?.emit("sound.play", { id: SFX_TYPE76_OPEN });
      p.flags |= PROP_BRANCH_ANSWERED;
    }
  }

  // `AND ECX, 0xFFFFFFF9` -- the two player bits, every frame.
  p.flags &= ~(BreakableFlag.HitByPlayer0 | BreakableFlag.HitByPlayer1);
  if (p.routinePhase === Type76Phase.Open
      && p.cueCursorB < TYPE76_SWING_FRAMES) {
    const k = T.breakables?.hinge_curves_xyz?.[String(TYPE76_HINGE_CURVE)]
      ?.[p.cueCursorB];
    const [rx, ry, rz] = k ?? [0, 0, 0];
    p.roll += rz;
    p.pitch -= rx;
    p.yaw = -ry;
    p.restPitch += rz;
    p.hingeB = ry;
    p.cueCursorB += 1;
  }

  // The draw, by `obj+0x194` (`MOVSX EAX, byte ptr [ESI+0x194]; SUB EAX, 0;
  // JZ; DEC EAX; JNZ`), and each arm registers its own point.
  switch (PropWords(p, TYPE76_WORDS_ZERO).o194 as Type76Door) {
    case Type76Door.Single: {
      // `0x0047168E`..`0x00471735`: one push, the plate inside it.
      const m = PropMatrixPush();
      PropMatrixTRzRyRx(m, p.x, p.y, p.z, p.pitch, p.yaw, p.roll);
      PropDrawSlot(p, m, TYPE76_SINGLE_SLOT);
      if (p.routinePhase === Type76Phase.Shut) {
        MatrixTranslate(m, ...TYPE76_PLATE_AT);
        MatrixRotateY(m, TYPE76_PLATE_YAW);
        MatrixScale(m, TYPE76_PLATE_SCALE, TYPE76_PLATE_SCALE,
                    TYPE76_PLATE_SCALE);
        // `NoOpStub(1.2f)` (`FUN_0041EBB0`), an empty function.
        PropDrawSlot(p, m, TYPE76_PLATE_SLOT);
      }
      // `FLD float; FSUB double; FSTP float` for each axis.
      PropRegisterForShotTest(
        p, Math.fround(p.x + TYPE76_SINGLE_SHOT_OFFSET[0]),
        Math.fround(p.y + TYPE76_SINGLE_SHOT_OFFSET[1]),
        Math.fround(p.z + TYPE76_SINGLE_SHOT_OFFSET[2]));
      return;
    }
    case Type76Door.Pair: {
      // `0x0047150D`..`0x0047163C`. The first leaf's matrix is built from
      // `MatrixLoadIdentity` (`FUN_004A9E10`) -- a world matrix -- kept with
      // `MatrixStore`, its plate's world point taken with
      // `MatrixGetTranslation`, and then drawn under a fresh push of the view
      // times it (`MatrixMultiply`), which in the port's world-space record
      // is the matrix itself.
      const a = PropMatrixPush();
      MatrixLoadIdentity(a);
      MatrixTranslate(a, ...TYPE76_PAIR_A_AT);
      MatrixRotateY(a, TYPE76_PAIR_YAW);
      MatrixRotateZ(a, p.roll);
      MatrixRotateY(a, p.hingeB);
      MatrixRotateX(a, p.restPitch);
      const plate = PropMatrixPush(a);
      MatrixTranslate(plate, ...TYPE76_PAIR_PLATE_AT);
      _p.x = Math.fround(plate[12]);
      _p.y = Math.fround(plate[13]);
      _p.z = Math.fround(plate[14]);
      PropDrawSlot(p, a, TYPE76_PAIR_SLOT_A);
      if (p.routinePhase === Type76Phase.Shut) {
        // The same `T(12.5, 23.5, 0.5)` on the leaf, and `NoOpStub(1.2f)`:
        // no scale.
        MatrixTranslate(a, ...TYPE76_PAIR_PLATE_AT);
        PropDrawSlot(p, a, TYPE76_PLATE_SLOT);
      }
      const b = PropMatrixPush();
      MatrixTranslate(b, ...TYPE76_PAIR_B_AT);
      MatrixRotateY(b, TYPE76_PAIR_YAW);
      MatrixRotateZ(b, p.roll);
      MatrixRotateY(b, p.yaw);
      MatrixRotateX(b, p.pitch);
      PropDrawSlot(p, b, TYPE76_PAIR_SLOT_B);
      PropRegisterForShotTest(p, _p.x, _p.y, _p.z);
      return;
    }
    default:
      // `JNZ 0x00471791`: straight to `RegisterForShotTest`, with
      // `obj+0x70..0x78` as nothing ever wrote them -- zero, from
      // `ActorClearGameFields`. That is the view-space origin, the camera
      // itself, and the port's point is in world space, so it is the camera's
      // world position -- the block `g_camera_index` names, whose view the
      // shot test reads it under. No shipped spawn has a third door.
      _p.x = 0; _p.y = 0; _p.z = 0;
      MatrixTransformPoint(CameraBlockViewToWorld(G.g_camera_index), _p, _o);
      PropRegisterForShotTest(p, _o.x, _o.y, _o.z);
  }
}
