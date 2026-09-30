/**
 * The marker a shot civilian leaves: a model drawn facing the camera at the
 * point she was hit, for one second.
 *
 * ```
 * SpawnCivilianHitMarker(player, point) (FUN_0048E080):
 *   obj = ActorAlloc(CivilianHitMarkerUpdate, 0x1314); ActorClearGameFields(obj);
 *   obj+0x40..0x48 = point;
 *   sub = ActorAllocRaw(8); obj+0x1310 = sub; sub[1] = 0x3C;     frames
 *   z = (g_camera_world_to_view[g_camera_index] * point).z;
 *   sub[0] = z < -50.0 ? z * -0.02 : z <= -20.0 ? 1.0 : z * -0.05;
 *   obj+0x1F4 = player == 0 ? 0x132D : 0x132E;
 *
 * CivilianHitMarkerUpdate (FUN_0048E190):
 *   push; SetTop(g_camera_world_to_view[g_camera_index]);
 *   MatrixTranslate(obj+0x40..0x48); v = MatrixGetTranslation;
 *   MatrixLoadIdentity; MatrixTranslate(v.x, v.y + 2.0, v.z + 5.0);
 *   MatrixScale(sub[0]); NoOpStub(sub[0]);
 *   if ((float)sub[1] < 6.0) AssetDrawSlotWithAlpha(obj+0x1F4, sub[1] * (1/6));
 *   else AssetDrawSlot(obj+0x1F4);
 *   pop; if (--sub[1] == 0) ActorKill();
 * ```
 *
 * `[proved]` from both listings. The scale is decided once, at the spawn, from
 * how far in front of the eye the point was: 1 from 20 to 50 units, growing
 * past 50 and shrinking inside 20, so the marker keeps its size on screen
 * over the middle distances. The draw re-places it each frame in that frame's
 * view -- lifted 2 and brought 5 toward the eye -- so it stays on her while
 * the camera moves.
 *
 * Slots `0x132D` and `0x132E` are `common.bin` entries 305 and 306, beside the
 * life marker's 303 and 304. This was `SpawnCivilianBloodPool`, "a ground
 * decal", named from what it was guessed to be before its update was read:
 * nothing in it touches the ground.
 */
import { CameraBlockWorldToView } from "../camera/view";
import { G } from "../globals";
import { MatrixTransformPoint } from "../matrix";
import { vec3, type Vec3 } from "../vec";

/** One marker task: the fields its update reads, and what its draw used. */
export interface CivilianHitMarker {
  /** `obj+0x40..0x48` — the world point she was hit at. */
  pos: Vec3;
  /** `sub[0]` — the uniform scale, fixed at the spawn. */
  scale: number;
  /** `sub[1]` — frames left, drawn before the decrement. */
  frames: number;
  /** `obj+0x1F4` — `0x132D` for player 0, `0x132E` for player 1. */
  slot: number;
  /**
   * `[port-only]` Where this frame's draw put it, in the camera's own space:
   * the view point lifted and pulled in. The renderer reads it.
   */
  drawnAt: Vec3;
  /**
   * `[port-only]` What this frame's draw used: `null` for `AssetDrawSlot`,
   * the alpha for `AssetDrawSlotWithAlpha`.
   */
  drawnAlpha: number | null;
}

/** `MOV dword ptr [EBX + 0x4], 0x3c` — frames the marker is drawn. */
export const CIVILIAN_HIT_MARKER_FRAMES = 0x3c;
/** `FCOMP float ptr [0x0056B188]` — beyond this depth the marker grows. */
const HIT_MARKER_FAR_Z = -50.0;
/** `FMUL float ptr [0x0056B184]` — the growing scale's factor. */
const HIT_MARKER_FAR_SCALE = Math.fround(-0.02);
/** `FCOMP float ptr [0x004C4C60]` — nearer than this it shrinks. */
const HIT_MARKER_NEAR_Z = -20.0;
/** `FMUL float ptr [0x0056B180]` — the shrinking scale's factor. */
const HIT_MARKER_NEAR_SCALE = Math.fround(-0.05);
/** `MOV word ptr [ESI + 0x1f4], 0x132d` — player 0's slot; player 1's is next. */
export const CIVILIAN_HIT_MARKER_SLOT = 0x132d;
/** `FADD float ptr [0x004E30F0]` — the lift, in view space. */
const HIT_MARKER_LIFT = 2.0;
/** `FADD float ptr [0x0055D2B4]` — toward the eye, in view space. */
const HIT_MARKER_PULL = 5.0;
/** `FCOM float ptr [0x0055E1C8]` — below this count it fades. */
const HIT_MARKER_FADE_BELOW = 6.0;
/** `FMUL float ptr [0x00564544]` — `1/6`, the fade's step. */
const HIT_MARKER_FADE_STEP = Math.fround(1 / 6);

const _v = vec3();

/**
 * `SpawnCivilianHitMarker` — `FUN_0048E080`. Its one caller is the shot arm
 * of `CivilianUpdate` (`0x0048AC6F`), with the point of the bone op 0x28 names.
 *
 * The depth is read off `g_camera_world_to_view` as this frame's camera actor
 * built it, which is what the engine's `SetTop` reads. `FCOMP`/`TEST AH, 1`:
 * strictly beyond -50, then `TEST AH, 0x41`: at or inside -20 is 1.
 */
export function SpawnCivilianHitMarker(player: number, point: Vec3): void {
  MatrixTransformPoint(CameraBlockWorldToView(G.g_camera_index), point, _v);
  const z = Math.fround(_v.z);
  let scale: number;
  if (z < HIT_MARKER_FAR_Z) {
    scale = Math.fround(z * HIT_MARKER_FAR_SCALE);
  } else if (z <= HIT_MARKER_NEAR_Z) {
    scale = 1.0;
  } else {
    scale = Math.fround(z * HIT_MARKER_NEAR_SCALE);
  }
  G.g_civilian_hit_markers.push({
    pos: { x: point.x, y: point.y, z: point.z },
    scale,
    frames: CIVILIAN_HIT_MARKER_FRAMES,
    slot: player === 0 ? CIVILIAN_HIT_MARKER_SLOT
      : CIVILIAN_HIT_MARKER_SLOT + 1,
    drawnAt: vec3(),
    drawnAlpha: null,
  });
}

/**
 * `CivilianHitMarkerUpdate` — `FUN_0048E190`. The draw, then the count; at
 * zero the engine's `ActorKill` has taken the task, *after* its last draw.
 */
export function CivilianHitMarkerUpdate(m: CivilianHitMarker): void {
  MatrixTransformPoint(CameraBlockWorldToView(G.g_camera_index), m.pos, _v);
  m.drawnAt.x = Math.fround(_v.x);
  m.drawnAt.y = Math.fround(Math.fround(_v.y) + HIT_MARKER_LIFT);
  m.drawnAt.z = Math.fround(Math.fround(_v.z) + HIT_MARKER_PULL);
  m.drawnAlpha = m.frames < HIT_MARKER_FADE_BELOW
    ? Math.fround(m.frames * HIT_MARKER_FADE_STEP) : null;
  m.frames -= 1;
}

/**
 * `[port-only]` — the marker tasks, stepped after the actors that allocate
 * them, as `LifeGrantedMarkersTick` steps its own: `ActorAlloc` appends to the
 * task list, so the walk reaches one on the frame it is made and it draws its
 * first frame then. The list is every marker that drew this frame; one the
 * last update killed leaves at the head of the next tick.
 */
export function CivilianHitMarkersTick(): void {
  if (G.g_civilian_hit_markers.length === 0) return;
  G.g_civilian_hit_markers = G.g_civilian_hit_markers.filter(
    (m) => m.frames !== 0);
  for (const m of G.g_civilian_hit_markers) CivilianHitMarkerUpdate(m);
}
