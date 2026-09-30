/**
 * Class 0x51's draws -- the fish, `fish.bin` through `AssetDrawSlot` and
 * `AssetDrawSlotWithAlpha`.
 *
 * Two routines draw one: `FishDraw` (`FUN_00439860`), from `FishUpdate`
 * after the state has run, and `FishSwimAwayTick` (`FUN_00439C20`), the
 * update `FishBeginSwimAway` installs, which draws for itself. Each returns
 * world-space matrices, one per `AssetDrawSlot` the routine made this frame,
 * as the product the engine's matrix stack holds at that call -- the
 * flattening `render/worm.ts` does, read by the same chain arm of
 * `render/slotmodels.ts`. Nothing is decided here: the angles, the strip
 * frame, the alpha and the flags are the sub-block's, stepped by
 * `game/class51/`, and the swim-away tick writes down what it drew because it
 * steps the strip after drawing it.
 *
 * **The turn is the sub-block's, never `obj+0x68`.** No class-0x51 routine
 * writes the actor's own yaw, and the layer drew the fish by it for as long
 * as it drew fish: every one of them side-on at its descriptor's yaw.
 */
import { Matrix4 } from "three";
import type { Actor } from "../game/actor";
import { FishFlag, FishState, type FishTail } from "../game/class51/state";
import { G } from "../game/globals";
import {
  MatIdentity, MatrixLoadIdentity, MatrixRotateX, MatrixRotateY,
  MatrixRotateZ, MatrixScale, MatrixTranslate, type Mat,
} from "../game/matrix";
import { SpawnClass } from "../game/spawn_class";

/** One draw: a slot, the matrix it is drawn under, its alpha and light. */
export interface FishPart {
  slot: number;
  m: Matrix4;
  /** `AssetDrawSlotWithAlpha`'s second argument; absent for `AssetDrawSlot`. */
  alpha?: number;
  /** `SetRenderLightColour`'s colour for this draw, when it set one. */
  light?: number[];
}

/**
 * `PUSH 0x3e99999a` three times, then `CALL MatrixScale` at `0x00439AC9`
 * (`FishDraw`) and `0x00439CF8` (`FishSwimAwayTick`): the model is drawn at
 * 0.3. A fish drawn at one is three and a third times the size of the game's.
 */
export const FISH_DRAW_SCALE = Math.fround(0.3);
/**
 * `FSUB float ptr [0x0055D1A0]` at `0x00439A8C` -- `cdcccc3e`, 0.4: the
 * default arm (rising and bobbing) draws the model this far below
 * `obj+0x44`.
 */
export const FISH_DRAW_DROP = Math.fround(0.4);
/**
 * The silhouette, `FishDraw`'s: `FADD float ptr [0x0055CC44]` (`295c8f3d`,
 * 0.07) onto `g_water_level`, `MatrixScale(0.4, 0.01, 0.4)` -- `0x3ecccccd`,
 * `0x3c23d70a` -- at `0x0043994F` and `0x00439A4A`.
 */
export const FISH_SILHOUETTE_LIFT = Math.fround(0.07);
export const FISH_SILHOUETTE_SCALE = Math.fround(0.4);
export const FISH_SILHOUETTE_FLAT = Math.fround(0.01);
/** `FishSwimAwayTick`'s: `FADD float ptr [0x004C4C88]` (`cdcc4c3d`), 0.05. */
export const FISH_SWIM_SILHOUETTE_LIFT = Math.fround(0.05);
/**
 * `SetRenderLightColour(0x3dcccccd, ...)` before each silhouette's
 * `AssetDrawSlot`, inside the `LightsUseSecondarySet` bracket: 0.1 grey
 * under light block 1's ambient and direction.
 */
export const FISH_SILHOUETTE_LIGHT = [Math.fround(0.1), Math.fround(0.1),
                                      Math.fround(0.1)];
/**
 * The lunge's pitch: `MOVSX EAX, [ESI+0x74]; MOVSX ECX, [ESI+0x7E];
 * SHL EAX, 0xE; CDQ; IDIV ECX; SUB EAX, 0x3D00` at `0x004399C7`, and for
 * sub-type 2 `MOV EAX, 0xFFFFF000; SUB EAX, [ESI+0x58]` at `0x004399B2`.
 */
export const FISH_LUNGE_PITCH_BASE = 0x3d00;
export const FISH_LUNGE_PITCH_SHIFT = 14;
export const FISH_SUBTYPE2_PITCH = -0x1000;
/** `PUSH 0x4000; CALL MatrixRotateZ` at `0x004398CD`: on its side. */
export const FISH_SINK_ROLL = 0x4000;

const _m: Mat = MatIdentity();

function tailOf(a: Actor): FishTail | null {
  return a.cls === SpawnClass.WaterEnemy ? a.fish : null;
}

/**
 * Every draw class 0x51's routine made for `a` this frame, in call order.
 *
 * `resident` is `AssetDrawSlot`'s own test: a slot the script has unloaded
 * draws nothing, as in the engine. Parts are reused from `out`.
 */
export function FishDrawParts(a: Actor, out: FishPart[],
                              resident: (slot: number) => boolean = () => true)
    : FishPart[] {
  const sub = tailOf(a);
  let n = 0;
  const push = (slot: number, alpha: number | undefined,
                light: number[] | undefined): void => {
    if (!resident(slot)) return;
    const p = out[n] ?? (out[n] = { slot: 0, m: new Matrix4() });
    p.slot = slot;
    p.m.fromArray(_m);
    p.alpha = alpha;
    p.light = light;
    n++;
  };
  if (sub) {
    if (sub.swimAway) FishSwimAwayDraw(a, sub, push);
    else FishDraw(a, sub, push);
  }
  out.length = n;
  return out;
}

type Push = (slot: number, alpha: number | undefined,
             light: number[] | undefined) => void;

/**
 * The silhouette both arms of `FishDraw` that draw one share,
 * `0x004398ED`..`0x00439986` and `0x004399E8`..`0x00439A81`: only for a fish
 * drawn solid (`sub+0x6A` bit 2) and below `g_water_level`, flattened onto
 * the surface under its own yaw.
 */
function FishSilhouette(a: Actor, sub: FishTail, push: Push): void {
  if (!(sub.flags & FishFlag.Surfaced)) return;
  if (!(a.pos.y < G.g_water_level)) return;
  MatrixLoadIdentity(_m);
  MatrixTranslate(_m, a.pos.x,
                  Math.fround(G.g_water_level + FISH_SILHOUETTE_LIFT),
                  a.pos.z);
  MatrixRotateY(_m, sub.yaw);
  MatrixScale(_m, FISH_SILHOUETTE_SCALE, FISH_SILHOUETTE_FLAT,
              FISH_SILHOUETTE_SCALE);
  push(sub.frame, undefined, FISH_SILHOUETTE_LIGHT);
}

/**
 * `FishDraw` — `FUN_00439860`'s draws. The switch on `sub+0x62` is the jump
 * table at `0x00439B38`, `state - 2` into `{0x4398ED, 0x4398ED, 0x439890,
 * 0x4398B3}`; any other state takes the default at `0x004399E8`.
 *
 * * **2, 3** (the lunge and the fall back): the silhouette; then
 *   `T(pos) RotY(sub+0x50)` and `RotX` of the lunge's progress,
 *   `(sub+0x74 << 14) / sub+0x7E - 0x3D00`, or for sub-type 2 of
 *   `-0x1000 - sub+0x58`.
 * * **4** (flung): `T(pos) RotY(sub+0x50) RotX(sub+0x58)`.
 * * **5** (sinking): `T(pos) RotY(sub+0x50) RotZ(0x4000)`, then `RotX` of
 *   **`sub+0x50 & 0xFFFF`** -- the yaw word a second time, `MOV EAX, [ESI +
 *   0x50]` at `0x004398D7`, not the pitch.
 * * **default** (rising, bobbing): the silhouette; then
 *   `T(x, y - 0.4, z) RotY(sub+0x50) RotX(sub+0x58)`.
 *
 * Then `MatrixScale(0.3)` and `AssetDrawSlot(sub+0x6E)` when bit 2 is set,
 * `AssetDrawSlotWithAlpha(sub+0x6E, sub+0x48)` when it is not. `[proved]`
 */
function FishDraw(a: Actor, sub: FishTail, push: Push): void {
  const lunge = sub.state === FishState.Lunge
    || sub.state === FishState.FallBack;
  if (lunge || (sub.state !== FishState.Flung
                && sub.state !== FishState.Sink)) {
    FishSilhouette(a, sub, push);
  }
  MatrixLoadIdentity(_m);
  if (lunge) {
    MatrixTranslate(_m, a.pos.x, a.pos.y, a.pos.z);
    MatrixRotateY(_m, sub.yaw);
    MatrixRotateX(_m, sub.subtype === 2
      ? FISH_SUBTYPE2_PITCH - sub.pitch
      // `IDIV`: truncated toward zero, on the two s16s.
      : Math.trunc(((sub.lungeStep << 16 >> 16) << FISH_LUNGE_PITCH_SHIFT)
                   / (sub.lungeFrames << 16 >> 16))
        - FISH_LUNGE_PITCH_BASE);
  } else if (sub.state === FishState.Flung) {
    MatrixTranslate(_m, a.pos.x, a.pos.y, a.pos.z);
    MatrixRotateY(_m, sub.yaw);
    MatrixRotateX(_m, sub.pitch);
  } else if (sub.state === FishState.Sink) {
    MatrixTranslate(_m, a.pos.x, a.pos.y, a.pos.z);
    MatrixRotateY(_m, sub.yaw);
    MatrixRotateZ(_m, FISH_SINK_ROLL);
    MatrixRotateX(_m, sub.yaw & 0xffff);
  } else {
    MatrixTranslate(_m, a.pos.x, Math.fround(a.pos.y - FISH_DRAW_DROP),
                    a.pos.z);
    MatrixRotateY(_m, sub.yaw);
    MatrixRotateX(_m, sub.pitch);
  }
  MatrixScale(_m, FISH_DRAW_SCALE, FISH_DRAW_SCALE, FISH_DRAW_SCALE);
  push(sub.frame,
       (sub.flags & FishFlag.Surfaced) ? undefined : sub.alpha, undefined);
}

/**
 * `FishSwimAwayTick` — `FUN_00439C20`'s draw, `0x00439C4B`..`0x00439D14`,
 * of the frame and scale the tick recorded before stepping them:
 *
 * * bit 2 **clear**: `T(pos) RotY(sub+0x50) RotX(sub+0x58) Scale(0.3)` and
 *   `AssetDrawSlot` -- solid, whatever its alpha was;
 * * bit 2 **set**: the silhouette alone, at `g_water_level + 0.05`, turned
 *   by the yaw and flattened to `(s, 0.01, s)`, `s` being `sub+0x28` --
 *   0.4 as `FishBeginSwimAway` left it, shrinking to nothing at the end.
 */
function FishSwimAwayDraw(a: Actor, sub: FishTail, push: Push): void {
  MatrixLoadIdentity(_m);
  if (!(sub.flags & FishFlag.Surfaced)) {
    MatrixTranslate(_m, a.pos.x, a.pos.y, a.pos.z);
    MatrixRotateY(_m, sub.yaw);
    MatrixRotateX(_m, sub.pitch);
    MatrixScale(_m, FISH_DRAW_SCALE, FISH_DRAW_SCALE, FISH_DRAW_SCALE);
    push(sub.swimDrawFrame, undefined, undefined);
    return;
  }
  MatrixTranslate(_m, a.pos.x,
                  Math.fround(G.g_water_level + FISH_SWIM_SILHOUETTE_LIFT),
                  a.pos.z);
  MatrixRotateY(_m, sub.yaw);
  MatrixScale(_m, sub.swimDrawScale, FISH_SILHOUETTE_FLAT, sub.swimDrawScale);
  push(sub.swimDrawFrame, undefined, FISH_SILHOUETTE_LIGHT);
}
