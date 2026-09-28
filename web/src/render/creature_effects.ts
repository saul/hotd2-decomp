/**
 * The owl's and the fish's effect tasks, drawn -- and the ring task the fish's
 * corpse leaves on the water.
 *
 * Every one of them is an `AssetDrawSlot` its own task's routine makes under a
 * matrix it builds on the spot; the port's routines (`game/effects/owl.ts`,
 * `game/effects/fish.ts`, `game/effects/ring_effect.ts`) step the task and
 * leave on the record what that frame's draw read, and this builds the same
 * matrix and hangs a clone of the slot's model under it. Nothing here is
 * state: `update` and `resync` are the same call.
 *
 * The matrices, as the routines build them (call order = product order):
 *
 * * **feather** (`OwlFeatherDriftAndDraw`, `FUN_00448A80`): world,
 *   `T(x, y, z) RotZ(roll) RotY(yaw) RotX(0x4000) Scale(0.15)`, slot `0xBF0`.
 * * **ground impact ring** (`OwlGroundImpactRingPulse`, `FUN_00448CE0`, and
 *   `OwlGroundImpactRingFadeOut`, `FUN_00448DF0`): world,
 *   `T(x, y, z) RotY(yaw) RotX(pitch)`, then the ring `0x1A38` at
 *   `Scale(c, 1, c)` -- faded in the second routine -- and in the first the
 *   strip `0x15E4 + n` at `Scale(s)`.
 * * **owl water splash** (`OwlWaterSplashFlipbookStep`, `FUN_00448800`):
 *   world, `T(x, -25, z)` and nothing else.
 * * **blood cloud** (`BloodCloudTickInScreenSpace`, `FUN_00439E00`): camera
 *   space, `MatrixLoadIdentity; T(p) Scale(0.1)`.
 * * **fish water splash** (`WaterSplashUpdate`, `FUN_00439F10`): world,
 *   `T(x, y, z) Scale(s) RotY(camera yaw)`.
 * * **surface ring** (`SurfaceRingDrawAndFade`, `FUN_0043A000`): world,
 *   `T(x, y, z) Scale(s, 0.2, s)`, slot `0xB71` at its alpha.
 * * **ring task** (`RingEffectSpread`, `RingEffectHold`, `RingEffectFadeOut`,
 *   `FUN_00407E30` / `FUN_00408100` / `FUN_00408220`): world,
 *   `T(x, y, z) RotY(yaw)`, the ring `0x1A38` at `Scale(r, s, r)` and each
 *   strip at `T(dx, 0, dz) Scale(k)`, all at the routine's alpha.
 */
import { type Group, Matrix4, type Object3D, Quaternion, Vector3 } from "three";
import { BAMS_TO_RAD } from "../core/bams";
import {
  FISH_BLOOD_SCALE, FISH_RING_HEIGHT, FISH_RING_SLOT,
} from "../game/effects/fish";
import {
  OWL_FEATHER_PITCH, OWL_FEATHER_SCALE, OWL_FEATHER_SLOT, OWL_RING_SLOT,
  OWL_SPLASH_FIRST_SLOT, OwlGroundRingPhase,
} from "../game/effects/owl";
import { RING_EFFECT_RING_SLOT } from "../game/effects/ring_effect";
import { G } from "../game/globals";
import { setSlotAlpha } from "./boss3_effects";

/** What this needs of the effect layer. */
export interface CreatureEffectHost {
  /** A node for `key` at `slot` under `parent`, re-cloned when the slot moves. */
  node(key: string, slot: number, parent: Group): Object3D | null;
  /** World-space effects. */
  world: Group;
  /** Camera-space effects. */
  view: Group;
}

const AX = new Vector3(1, 0, 0);
const AY = new Vector3(0, 1, 0);
const AZ = new Vector3(0, 0, 1);
const _m = new Matrix4();
const _o = new Matrix4();
const _b = new Matrix4();
const _q = new Quaternion();

/** `MatrixTranslate` onto `m` (post-multiplied: the call order). */
function T(m: Matrix4, x: number, y: number, z: number): Matrix4 {
  return m.multiply(_b.makeTranslation(x, y, z));
}
/** `MatrixRotateX/Y/Z` onto `m`, in BAMS. */
function R(m: Matrix4, axis: Vector3, bams: number): Matrix4 {
  return m.multiply(_b.makeRotationFromQuaternion(
    _q.setFromAxisAngle(axis, bams * BAMS_TO_RAD)));
}
/** `MatrixScale` onto `m`. */
function S(m: Matrix4, x: number, y: number, z: number): Matrix4 {
  return m.multiply(_b.makeScale(x, y, z));
}

/**
 * One draw under `m`: `AssetDrawSlot` with no `alpha`,
 * `AssetDrawSlotWithAlpha` with one -- at 1 as at any other value.
 */
function draw(h: CreatureEffectHost, seen: Set<string>, key: string,
              slot: number, parent: Group, m: Matrix4,
              alpha: number | null = null): void {
  const node = h.node(key, slot, parent);
  if (!node) return;
  seen.add(key);
  node.matrixAutoUpdate = false;
  node.matrix.copy(m);
  node.matrixWorldNeedsUpdate = true;
  setSlotAlpha(node, alpha);
}

/** Every owl and fish effect task's draw this frame, as keys into `seen`. */
export function drawCreatureEffects(h: CreatureEffectHost,
                                    seen: Set<string>): void {
  for (const f of G.g_owl_feathers) {
    _m.identity();
    T(_m, f.x, f.y, f.z);
    R(_m, AZ, f.roll);
    R(_m, AY, f.yaw);
    R(_m, AX, OWL_FEATHER_PITCH);
    S(_m, OWL_FEATHER_SCALE, OWL_FEATHER_SCALE, OWL_FEATHER_SCALE);
    draw(h, seen, `of${f.id}`, OWL_FEATHER_SLOT, h.world, _m);
  }

  for (const r of G.g_owl_ground_rings) {
    _o.identity();
    T(_o, r.x, r.y, r.z);
    R(_o, AY, r.yaw);
    R(_o, AX, r.pitch);
    _m.copy(_o);
    S(_m, r.ring, 1, r.ring);
    // `OwlGroundImpactRingPulse` draws the ring with `AssetDrawSlot`;
    // `OwlGroundImpactRingFadeOut` with `AssetDrawSlotWithAlpha`, the first
    // twenty-nine frames at 1.
    draw(h, seen, `or${r.id}`, OWL_RING_SLOT, h.world, _m,
         r.drew === OwlGroundRingPhase.FadeOut ? r.alpha : null);
    if (r.drew === OwlGroundRingPhase.Pulse) {
      _m.copy(_o);
      S(_m, r.strip, r.strip, r.strip);
      draw(h, seen, `ors${r.id}`, r.stripSlot, h.world, _m);
    }
  }

  for (const s of G.g_owl_water_splashes) {
    _m.identity();
    T(_m, s.x, s.y, s.z);
    draw(h, seen, `ow${s.id}`, OWL_SPLASH_FIRST_SLOT + s.shown, h.world, _m);
  }

  for (const c of G.g_fish_blood_clouds) {
    // `MatrixLoadIdentity`: camera space, so the view group.
    _m.identity();
    T(_m, c.pos.x, c.pos.y, c.pos.z);
    S(_m, FISH_BLOOD_SCALE, FISH_BLOOD_SCALE, FISH_BLOOD_SCALE);
    draw(h, seen, `fb${c.id}`, c.shown, h.view, _m);
  }

  for (const s of G.g_fish_water_splashes) {
    _m.identity();
    T(_m, s.x, s.y, s.z);
    S(_m, s.scale, s.scale, s.scale);
    R(_m, AY, s.shownYaw);
    draw(h, seen, `fw${s.id}`, s.shown, h.world, _m);
  }

  for (const r of G.g_fish_surface_rings) {
    _m.identity();
    T(_m, r.x, r.y, r.z);
    S(_m, r.shownScale, FISH_RING_HEIGHT, r.shownScale);
    draw(h, seen, `fr${r.id}`, FISH_RING_SLOT, h.world, _m, r.shownAlpha);
  }

  for (const r of G.g_ring_effects) {
    _o.identity();
    T(_o, r.x, r.y, r.z);
    R(_o, AY, r.yaw);
    _m.copy(_o);
    S(_m, r.drawnRing, r.scale, r.drawnRing);
    // `RingEffectSpread` and `RingEffectHold` draw with `AssetDrawSlot` and
    // record 1; `RingEffectFadeOut` takes 0.025 off before it draws with
    // `AssetDrawSlotWithAlpha`, so its alpha is never 1.
    const alpha = r.drawnAlpha < 1 ? r.drawnAlpha : null;
    draw(h, seen, `re${r.id}`, RING_EFFECT_RING_SLOT, h.world, _m, alpha);
    r.drawnStrips.forEach((st, i) => {
      _m.copy(_o);
      T(_m, st.x, 0, st.z);
      S(_m, r.drawnStrip, r.drawnStrip, r.drawnStrip);
      draw(h, seen, `re${r.id}s${i}`, st.slot, h.world, _m, alpha);
    });
  }
}
