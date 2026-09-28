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
import { SpawnPropHitEffectScaled } from "../effects/sprite";
import { G } from "../globals";
import { GameMode } from "../game_mode";
import {
  MatIdentity, MatrixRotateX, MatrixRotateY, MatrixRotateZ,
  MatrixTransformPoint, MatrixTranslate,
} from "../matrix";
import { PlayerHoldsOriginalItem } from "../original_mode";
import { T } from "../tables";
import { vec3 } from "../vec";
import { BranchBlock, PROP_BRANCH_ANSWERED } from "./branch";
import { ActorDespawnProp, BreakablePropAwardHit } from "./prop";
import { BreakableFlag, type BreakableProp } from "./prop_state";
import { PropRegisterForShotTest } from "./shot_test";

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
 * `PlaceGenericProp` case 0x4C, `0x004628A8`: `obj+0x194` from the placer's
 * byte, beside the 3.0 radius `generic.ts`'s table has. `[port-only]` as a
 * *function*, as `PlaceGenericPropType43` is.
 */
export function PlaceGenericPropType76(p: BreakableProp,
                                       pl: { field_1f4?: number }): void {
  p.group = ((pl.field_1f4 ?? 0) << 24) >> 24;
  // `+0x2A8`, the swing's frame, is zero from `ActorClearGameFields`.
  p.cueCursorB = 0;
}

const _m = MatIdentity();
const _p = vec3();
const _o = vec3();

/**
 * `PropUpdateType76` — `FUN_00471330`. One door, one 60 Hz frame.
 *
 * `+0x2A8` is {@link BreakableProp.cueCursorB} (the swing's frame), `+0x1E4`
 * {@link BreakableProp.restPitch} and `+0x1E8` {@link BreakableProp.hingeB}
 * (the first leaf's own pitch and yaw), `+0x194` {@link BreakableProp.group}
 * and `+0x192` {@link BreakableProp.routinePhase}.
 */
export function PropUpdateType76(p: BreakableProp, rng: Rng,
                                 events?: Events): void {
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
    if ((p.group === Type76Door.Pair
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
    const k = T.breakables?.hinge_curves?.["0"]?.[p.cueCursorB];
    const [rx, ry, rz] = k ?? [0, 0, 0];
    p.roll += rz;
    p.pitch -= rx;
    p.yaw = -ry;
    p.restPitch += rz;
    p.hingeB = ry;
    p.cueCursorB += 1;
  }

  // The draws are `render/prop_parts.ts`'s. The registration is not.
  switch (p.group as Type76Door) {
    case Type76Door.Single:
      PropRegisterForShotTest(p, p.x + TYPE76_SINGLE_SHOT_OFFSET[0],
                              p.y + TYPE76_SINGLE_SHOT_OFFSET[1],
                              p.z + TYPE76_SINGLE_SHOT_OFFSET[2]);
      return;
    case Type76Door.Pair: {
      // `LoadIdentity; T(a); RotY(-0x2168); RotZ; RotY(+0x1E8); RotX(+0x1E4);
      // MatrixStore; T(12.5, 23.5, 0.5); MatrixGetTranslation` -- the plate's
      // world point, which is the sphere's.
      for (let i = 0; i < 16; i++) _m[i] = i % 5 === 0 ? 1 : 0;
      MatrixTranslate(_m, ...TYPE76_PAIR_A_AT);
      MatrixRotateY(_m, TYPE76_PAIR_YAW);
      MatrixRotateZ(_m, p.roll);
      MatrixRotateY(_m, p.hingeB);
      MatrixRotateX(_m, p.restPitch);
      MatrixTranslate(_m, ...TYPE76_PAIR_PLATE_AT);
      PropRegisterForShotTest(p, Math.fround(_m[12]), Math.fround(_m[13]),
                              Math.fround(_m[14]));
      return;
    }
    default:
      // `JNZ 0x00471791`: straight to `RegisterForShotTest`, with
      // `obj+0x70..0x78` as nothing ever wrote them -- zero, from
      // `ActorClearGameFields`. That is the view-space origin, the camera
      // itself, and the port's point is in world space, so it is the camera's
      // world position. No shipped spawn has a third door.
      _p.x = 0; _p.y = 0; _p.z = 0;
      MatrixTransformPoint(G.g_camera_view_to_world, _p, _o);
      PropRegisterForShotTest(p, _o.x, _o.y, _o.z);
  }
}
