/**
 * Class 0x51's draws -- the fish, every one an asset slot out of `fish.bin`
 * under a matrix the class's own routine builds.
 *
 * `FishDraw` (`FUN_00439860`) runs after the state in `FishUpdate`, so it
 * draws what the frame left and the fish's block is read here as it stands.
 * `FishSwimAwayTick` (`FUN_00439C20`) draws in the middle of its routine and
 * steps the strip and the size after; it writes down what it drew
 * (`FishTail.drawnFrame`, `drawnScale`) and that is what is read for it.
 *
 * Each part is a world matrix, the product the engine's stack holds at that
 * `AssetDrawSlot` -- every call post-multiplies -- read by the chain arm of
 * `render/slotmodels.ts`, as `render/worm.ts`'s are.
 */
import { Matrix4 } from "three";
import { BAMS_TO_RAD } from "../core/bams";
import type { Actor } from "../game/actor";
import { FishFlag, FishState, type FishTail } from "../game/class51/state";
import { G } from "../game/globals";
import { SpawnClass } from "../game/spawn_class";

/** One draw: a slot, its matrix, its alpha and its light colour. */
export interface FishPart {
  slot: number;
  m: Matrix4;
  /** `AssetDrawSlotWithAlpha`'s second argument; absent for `AssetDrawSlot`. */
  alpha?: number;
  /** `SetRenderLightColour`'s colour for this draw, when it set one. */
  light?: [number, number, number];
}

/**
 * `PUSH 0x3E99999A` three times into `MatrixScale` at `0x00439AC9` (and
 * `0x00439CF8` in the swim-away): every body draw is at 0.3.
 */
export const FISH_BODY_SCALE = Math.fround(0.3);
/**
 * `FSUB float ptr [0x0055D1A0]` (`cdcccc3e`, 0.4) at `0x00439A8C`: states 0
 * and 1 draw the body 0.4 below the fish's own point.
 */
export const FISH_BOB_DRAW_DROP = Math.fround(0.4);
/**
 * The surface silhouette: `FADD float ptr [0x0055CC44]` (`295c8f3d`, 0.07)
 * over `g_water_level` in `FishDraw`, `MatrixScale(0.4, 0.01, 0.4)`
 * (`3ecccccd`, `3c23d70a`) and `SetRenderLightColour(0.1, 0.1, 0.1)`
 * (`3dcccccd`) around an `AssetDrawSlot` of the strip frame.
 */
export const FISH_SHADOW_LIFT = Math.fround(0.07);
export const FISH_SHADOW_SIZE = Math.fround(0.4);
export const FISH_SHADOW_FLATTEN = Math.fround(0.01);
export const FISH_SHADOW_LIGHT = Math.fround(0.1);
/**
 * `FishSwimAwayTick`'s own lift, `FADD float ptr [0x004C4C88]` (`cdcc4c3d`,
 * 0.05) at `0x00439C66`, and its silhouette is `sub+0x28` wide, not 0.4.
 */
export const FISH_SWIM_SHADOW_LIFT = Math.fround(0.05);
/** `SUB EAX, 0x3D00` at `0x004399D5`: the lunge's pitch, less this. */
export const FISH_LUNGE_PITCH_BIAS = 0x3d00;
/** `MOV EAX, 0xFFFFF000; SUB EAX, EDX` at `0x004399B2`: sub-type 2's pitch. */
export const FISH_SWING_PITCH_BASE = -0x1000;
/** `PUSH 0x4000` into `MatrixRotateZ` at `0x004398CD`: the corpse's roll. */
export const FISH_SINK_ROLL = 0x4000;

function T(x: number, y: number, z: number): Matrix4 {
  return new Matrix4().makeTranslation(x, y, z);
}
function RY(b: number): Matrix4 { return new Matrix4().makeRotationY(b * BAMS_TO_RAD); }
function RX(b: number): Matrix4 { return new Matrix4().makeRotationX(b * BAMS_TO_RAD); }
function RZ(b: number): Matrix4 { return new Matrix4().makeRotationZ(b * BAMS_TO_RAD); }
function S(x: number, y: number, z: number): Matrix4 {
  return new Matrix4().makeScale(x, y, z);
}

function tailOf(a: Actor): FishTail | null {
  return a.cls === SpawnClass.WaterEnemy ? a.fish : null;
}

/**
 * The flattened copy on the water: `Push; Translate(x, level + lift, z);
 * RotY(sub+0x50); Scale(w, 0.01, w); SetRenderLightColour(0.1); AssetDrawSlot;
 * Pop`, the same five calls in `FishDraw`'s two arms (`0x0043990B`,
 * `0x00439A06`) and in `FishSwimAwayTick` (`0x00439C55`).
 */
function shadow(a: Actor, t: FishTail, slot: number, lift: number,
                width: number): FishPart {
  const l = FISH_SHADOW_LIGHT;
  return {
    slot,
    m: T(a.pos.x, Math.fround(G.g_water_level + lift), a.pos.z)
      .multiply(RY(t.yaw)).multiply(S(width, FISH_SHADOW_FLATTEN, width)),
    light: [l, l, l],
  };
}

/**
 * Every draw one class-0x51 fish makes this frame, in the order it makes
 * them.
 *
 * `FishDraw` (`FUN_00439860`): a jump table on `sub+0x62 - 2` at
 * `0x00439B38` -- states 2 and 3 to `0x004398ED`, 4 to `0x00439890`, 5 to
 * `0x004398B3` -- and everything else, 0 and 1, to `0x004399E8`:
 *
 * * **0, 1**: the silhouette, when `sub+0x6A` bit 2 is up and
 *   `obj+0x44 < g_water_level`; then `T(x, y - 0.4, z) RotY(yaw)
 *   RotX(sub+0x58)`.
 * * **2, 3**: the same silhouette; then `T(x, y, z) RotY(yaw)` and
 *   `RotX(0xFFFFF000 - sub+0x58)` for sub-type 2 or
 *   `RotX((sub+0x74 << 14) / sub+0x7E - 0x3D00)` for the rest.
 * * **4**: `T(x, y, z) RotY(yaw) RotX(sub+0x58)`.
 * * **5**: `T(x, y, z) RotY(yaw) RotZ(0x4000) RotX(yaw & 0xFFFF)`.
 *
 * and every arm then `Scale(0.3)` and `AssetDrawSlot(sub+0x6E)` while bit 2
 * is up, `AssetDrawSlotWithAlpha(sub+0x6E, sub+0x48)` while it is not.
 *
 * `FishSwimAwayTick` (`FUN_00439C20`) draws instead of all of that once it is
 * installed: the silhouette at `sub+0x28`'s width and 0.05 above the water,
 * unconditionally, while bit 2 is up -- and nothing else -- or `T(x, y, z)
 * RotY(yaw) RotX(sub+0x58) Scale(0.3)` and a plain `AssetDrawSlot` while it
 * is not.
 */
export function FishDrawParts(a: Actor, out: FishPart[]): FishPart[] {
  out.length = 0;
  const t = tailOf(a);
  if (!t) return out;
  const solid = (t.flags & FishFlag.Surfaced) !== 0;
  const k = FISH_BODY_SCALE;
  if (t.swimAway) {
    if (!t.drawnFrame) return out;
    if (solid) {
      out.push(shadow(a, t, t.drawnFrame, FISH_SWIM_SHADOW_LIFT, t.drawnScale));
    } else {
      out.push({
        slot: t.drawnFrame,
        m: T(a.pos.x, a.pos.y, a.pos.z).multiply(RY(t.yaw))
          .multiply(RX(t.pitch)).multiply(S(k, k, k)),
      });
    }
    return out;
  }
  if (!t.frame) return out;
  let m: Matrix4;
  switch (t.state) {
    case FishState.Lunge:
    case FishState.FallBack: {
      if (solid && a.pos.y < G.g_water_level) {
        out.push(shadow(a, t, t.frame, FISH_SHADOW_LIFT, FISH_SHADOW_SIZE));
      }
      // `MOVSX EAX, [ESI+0x74]; MOVSX ECX, [ESI+0x7E]; SHL EAX, 0xE; CDQ;
      // IDIV ECX` -- a signed division that truncates.
      const pitch = t.subtype === 2
        ? FISH_SWING_PITCH_BASE - t.pitch
        : Math.trunc((t.lungeStep * 0x4000) / (t.lungeFrames || 1))
          - FISH_LUNGE_PITCH_BIAS;
      m = T(a.pos.x, a.pos.y, a.pos.z).multiply(RY(t.yaw)).multiply(RX(pitch));
      break;
    }
    case FishState.Flung:
      m = T(a.pos.x, a.pos.y, a.pos.z).multiply(RY(t.yaw))
        .multiply(RX(t.pitch));
      break;
    case FishState.Sink:
      m = T(a.pos.x, a.pos.y, a.pos.z).multiply(RY(t.yaw))
        .multiply(RZ(FISH_SINK_ROLL)).multiply(RX(t.yaw & 0xffff));
      break;
    default:
      if (solid && a.pos.y < G.g_water_level) {
        out.push(shadow(a, t, t.frame, FISH_SHADOW_LIFT, FISH_SHADOW_SIZE));
      }
      m = T(a.pos.x, Math.fround(a.pos.y - FISH_BOB_DRAW_DROP), a.pos.z)
        .multiply(RY(t.yaw)).multiply(RX(t.pitch));
      break;
  }
  const body: FishPart = { slot: t.frame, m: m.multiply(S(k, k, k)) };
  if (!solid) body.alpha = t.alpha;
  out.push(body);
  return out;
}
