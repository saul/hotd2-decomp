/**
 * The marker a civilian's extra life raises: a model drawn in camera space,
 * low on the screen and on the paid player's side, for two seconds.
 *
 * ```
 * SpawnLifeGrantedMarker(p) (FUN_0048DF10):
 *   obj = ActorAlloc(LifeGrantedMarkerUpdate, 0x1314); ActorClearGameFields(obj);
 *   obj+0x48 = -1.0;                                  z, in front of the eye
 *   obj+0x44 = -120.0 / g_projection_distance_px;     y, 120 px below centre
 *   sub = ActorAllocRaw(8); obj+0x1310 = sub;
 *   sub[0] = obj+0x48 * -32.0 / g_projection_distance_px;   scale, 32 px a unit
 *   sub[1] = 0x78;                                    frames
 *   if (g_max_attackers == 1) obj+0x40 = 0;
 *   else obj+0x40 = obj+0x48 * (p == 0 ? 160.0 : -160.0) / g_projection_distance_px;
 *   obj+0x1F4 = p == 0 ? 0x1256 : 0x1257;
 *
 * LifeGrantedMarkerUpdate (FUN_0048DFE0):
 *   push; MatrixLoadIdentity; T(obj+0x40, +0x44, +0x48); Scale(sub[0]);
 *   if ((float)sub[1] >= 6.0) AssetDrawSlot(obj+0x1F4);
 *   else AssetDrawSlotWithAlpha(obj+0x1F4, (float)sub[1] * (1/6));
 *   pop; if (--sub[1] == 0) ActorKill();
 * ```
 *
 * `[proved]` from both listings. The constants are `.rdata` floats:
 * `-120.0` at `0x0056B17C`, `-32.0` at `0x0056B178`, `160.0` and `-160.0` at
 * `0x00565E00` / `0x00565E04`, `6.0` at `0x0055E1C8`, `1/6` at `0x00564544`.
 * `g_max_attackers` (`0x009C8E84`) is 1 with one player in play, so a lone
 * player's marker is centred.
 *
 * Slots `0x1256` and `0x1257` are `common.bin` entries 303 and 304; class
 * 0x41 type 43 hangs the same `0x1256 + player` over the heart its wreck
 * releases, which is the other place `GrantExtraLife` is called from.
 */
import { PROJECTION_DISTANCE_PX } from "../combat/permits";
import { G } from "../globals";

/** One marker task: the fields its update reads. */
export interface LifeGrantedMarker {
  /** `obj+0x40..0x48` — the camera-space point. */
  x: number;
  y: number;
  z: number;
  /** `sub[0]` — the uniform scale. */
  scale: number;
  /** `sub[1]` — frames left, drawn before the decrement. */
  frames: number;
  /** `obj+0x1F4` — the slot, `0x1256 + player`. */
  slot: number;
  /**
   * `[port-only]` What this frame's draw used: `null` for `AssetDrawSlot`,
   * the alpha for `AssetDrawSlotWithAlpha`. The renderer reads it.
   */
  drawnAlpha: number | null;
}

/** `MOV dword ptr [ESI + 0x48], 0xbf800000` — the camera-space depth. */
export const LIFE_MARKER_Z = -1.0;
/** `FLD float ptr [0x0056B17C]` — the height, in pixels at depth 1. */
export const LIFE_MARKER_Y_PX = -120.0;
/** `FMUL float ptr [0x0056B178]` — the scale, in pixels a unit at depth 1. */
export const LIFE_MARKER_SCALE_PX = -32.0;
/** `FMUL float ptr [0x00565E00]` / `[0x00565E04]` — player 0's, player 1's x. */
export const LIFE_MARKER_X_PX = [160.0, -160.0] as const;
/** `MOV dword ptr [EDI + 0x4], 0x78` — frames the marker is drawn. */
export const LIFE_MARKER_FRAMES = 0x78;
/** `FCOM float ptr [0x0055E1C8]` — below this count it fades. */
export const LIFE_MARKER_FADE_BELOW = 6.0;
/** `FMUL float ptr [0x00564544]` — `1/6`, the fade's step. */
export const LIFE_MARKER_FADE_STEP = Math.fround(1 / 6);
/** `MOV word ptr [ESI + 0x1f4], 0x1256` — player 0's slot; player 1's is next. */
export const LIFE_MARKER_SLOT = 0x1256;

/**
 * `SpawnLifeGrantedMarker` — `FUN_0048DF10`. Its one caller is
 * `CivilianHeldItemGrantLife`, when `GrantExtraLife` paid a life.
 *
 * `g_projection_distance_px` is an f32 and every quotient is stored to one;
 * `Math.fround` is each `FSTP float`.
 */
export function SpawnLifeGrantedMarker(player: number): void {
  const d = Math.fround(PROJECTION_DISTANCE_PX);
  const z = LIFE_MARKER_Z;
  const m: LifeGrantedMarker = {
    x: 0,
    y: Math.fround(LIFE_MARKER_Y_PX / d),
    z,
    scale: Math.fround((z * LIFE_MARKER_SCALE_PX) / d),
    frames: LIFE_MARKER_FRAMES,
    slot: player === 0 ? LIFE_MARKER_SLOT : LIFE_MARKER_SLOT + 1,
    drawnAlpha: null,
  };
  if (G.g_max_attackers !== 1) {
    m.x = Math.fround((z * LIFE_MARKER_X_PX[player === 0 ? 0 : 1]) / d);
  }
  G.g_life_granted_markers.push(m);
}

/**
 * `LifeGrantedMarkerUpdate` — `FUN_0048DFE0`. The draw, then the count; at
 * zero the engine's `ActorKill` has taken the task, *after* its last draw.
 */
export function LifeGrantedMarkerUpdate(m: LifeGrantedMarker): void {
  m.drawnAlpha = m.frames >= LIFE_MARKER_FADE_BELOW
    ? null : Math.fround(m.frames * LIFE_MARKER_FADE_STEP);
  m.frames -= 1;
}

/**
 * `[port-only]` — the marker tasks, stepped after the actors that allocate
 * them: `ActorAlloc` appends to the task list, so the walk reaches one on the
 * frame it is made and it draws its first frame then.
 *
 * The list is every marker that **drew this frame**, which is why one the
 * last update killed (`frames` at 0) leaves at the head of the next tick
 * rather than the end of this one: its last draw is still this frame's.
 */
export function LifeGrantedMarkersTick(): void {
  if (G.g_life_granted_markers.length === 0) return;
  G.g_life_granted_markers = G.g_life_granted_markers.filter(
    (m) => m.frames !== 0);
  for (const m of G.g_life_granted_markers) LifeGrantedMarkerUpdate(m);
}
