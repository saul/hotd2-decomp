/**
 * The scene's two light blocks, `g_scene_light_block0` (`0x009A3540`) and
 * `g_scene_light_block1` (`0x009A59E0`), and their tween blocks
 * `g_light_tween_block0` (`0x009C89E0`) and `g_light_tween_block1`
 * (`0x009C8920`) -- the record and the routines that need no `G`.
 *
 * Block 0 is the scene's: `UpdateSceneViewAndLight` (`FUN_00401F40`) builds
 * its direction every frame and `LightsRestoreScene` (`FUN_0041DCC0`) puts it
 * back after a draw that changed the light. Block 1 is the characters':
 * `LightsUseSecondarySet` (`FUN_0041DC70`) installs it around forty-four
 * draw routines. The script writes both (evt `0x17`..`0x19`, `0x20`..`0x27`)
 * and class 0x32's `Class32DrawNodeSlot` (`FUN_0047FC50`) aims both. They
 * lived on the script's walker until that write had to be made from `game/`;
 * they are `G`'s now, where the engine keeps them.
 *
 * Its own module for the reason `entity_light.ts` is: `globals.ts` builds the
 * initial blocks, and the routines that read `G` are `light_sets.ts`'s.
 */
import {
  MatIdentity, MatrixLoadIdentity, MatrixRotateX, MatrixRotateY,
  MatrixTransformVector,
} from "./matrix";
import { vec3, type Vec3 } from "./vec";

/**
 * Channel numbers, as `ApplyLightChannelOperand` (`FUN_0040B3F0`) switches
 * on them -- and where in the block each one is stored:
 *
 * | channel | block offset | what |
 * |---|---|---|
 * | 0 | `+0x30` | fog near (`g_scene_fog_near` in block 0) |
 * | 1 | `+0x34` | fog far |
 * | 2, 3, 4 | `+0x24`, `+0x28`, `+0x2C` | fog colour, ints 0..255 |
 * | 5 | -- | 2, 3 and 4 at once (falls through into 4) |
 * | 6, 7, 8 | `+0x240`, `+0x244`, `+0x248` | light colour (`g_scene_light_colour_r..b`) |
 * | 9 | -- | 6, 7 and 8 at once |
 * | 10 | `+0x24C` | ambient (`g_scene_light_ambient`) |
 *
 * The port keeps the stored words in {@link LightBlock.channels} under their
 * channel number, so the op and the tween stepper index one array; 5 and 9
 * store nothing and stay 0.
 */
export const CH_FOG_NEAR = 0;
export const CH_FOG_FAR = 1;
export const CH_FOG_R = 2;
export const CH_LIGHT_R = 6;
export const CH_AMBIENT = 10;
export const CHANNEL_COUNT = 11;

/**
 * One light block. `[port-only]` in shape (see the channel table above); the
 * words are the engine's.
 */
export interface LightBlock {
  /**
   * `+0x00` -- the direction `BuildSceneLightDirection` (`FUN_0040E0B0`) last
   * built from `pitch` and `yaw`, in the world: the direction the light comes
   * **from**. The engine builds the view-space copy at `+0x0C`
   * (`g_scene_light_dir_view` in block 0) in the same call; the view
   * transform is the renderer's, so the port keeps the world one.
   */
  dir: Vec3;
  /** `+0x18` -- pitch, BAMS (`g_scene_light_pitch_bams` in block 0). */
  pitch: number;
  /** `+0x1C` -- yaw, BAMS (`g_scene_light_yaw_bams` in block 0). */
  yaw: number;
  /** The channel words, by channel number -- see {@link CH_FOG_NEAR}. */
  channels: number[];
}

/**
 * One channel mid-tween: a target and a per-frame step magnitude -- the
 * `{enabled, cur, target, rate}` slot of `g_light_tween_block0/1`, stride
 * `0x10`. `null` is a slot whose `enabled` word is clear, and `cur` is the
 * channel's own word, which the stepper stores it into every frame it runs.
 * `[port-only]` in indexing: the engine's nine slots are compacted (channels
 * 0..4, 6..8, 10 -> slots 0..8); the port's array is by channel number.
 */
export interface ChannelTween {
  to: number;
  /** Per-frame step magnitude, always positive. */
  rate: number;
}

/**
 * `[port-only]` The whole light one draw was made under -- the three device
 * words `LightsUseCustomSet` (`FUN_0041DC10`) sets, as they stood when the
 * draw was queued: the ambient scalar, the world direction the light comes
 * from, and the colour in the engine's 0..1. The renderer lights the draw
 * with it (`render/lighting.ts`).
 */
export interface LightSetRecord {
  ambient: number;
  dir: [number, number, number];
  rgb: [number, number, number];
}

/** `[port-only]` A block as the image holds it before `LightBlockInit`. */
export function makeLightBlock(): LightBlock {
  const b: LightBlock = {
    dir: vec3(), pitch: 0, yaw: 0,
    channels: new Array<number>(CHANNEL_COUNT).fill(0),
  };
  LightBlockInit(b);
  return b;
}

/**
 * `[port-only]` A tween block with every slot's `enabled` word clear -- what
 * `SceneLightTaskCreate` (`FUN_0040AE60`) seeds when it allocates
 * `PushSceneLightStateToDevice`.
 */
export function makeLightTweens(): (ChannelTween | null)[] {
  return new Array<ChannelTween | null>(CHANNEL_COUNT).fill(null);
}

/** `0x477FFF00` -- 65535.0, the fog near `LightBlockInit` seeds. */
const INIT_FOG_NEAR = 65535;
/** `0x47800000` -- 65536.0, the fog far. */
const INIT_FOG_FAR = 65536;
/** `0x3F333333` at `+0x24C`. */
const INIT_AMBIENT = Math.fround(0.7);

/**
 * `LightBlockInit` — `FUN_0041DBA0`. Called for both blocks by
 * `CameraBlocksReset` (`FUN_004021D0`) and the boot routine.
 *
 * ```
 * +0x18 = +0x1C = 0                     ; pitch, yaw
 * +0x00 = (0, 0, 1); +0x0C = (0, 0, 1)  ; the built directions
 * +0x24..+0x2C = 0                      ; fog colour
 * +0x30 = 65535.0; +0x34 = 65536.0      ; fog near, far
 * +0x240..+0x248 = 1.0; +0x24C = 0.7    ; colour, ambient
 * ```
 *
 * The word at `+0x38` (1), the one at `+0x3A` (`0xFF09`) and the 0x81 dwords
 * zeroed from `+0x3C` are read by nothing the port has.
 */
export function LightBlockInit(b: LightBlock): void {
  b.pitch = 0;
  b.yaw = 0;
  b.dir = vec3(0, 0, 1);
  const c = b.channels;
  c.fill(0);
  c[CH_FOG_NEAR] = INIT_FOG_NEAR;
  c[CH_FOG_FAR] = INIT_FOG_FAR;
  c[CH_LIGHT_R] = c[CH_LIGHT_R + 1] = c[CH_LIGHT_R + 2] = 1.0;
  c[CH_AMBIENT] = INIT_AMBIENT;
}

/**
 * `LightBlockSetDirection` — `FUN_0040E140`. `block+0x18 = pitch;
 * block+0x1C = yaw`, and nothing else: the vector is built from them by the
 * next `BuildSceneLightDirection`. evt `0x18` and `0x19` are this on block 0
 * and block 1.
 */
export function LightBlockSetDirection(b: LightBlock, pitch: number,
                                       yaw: number): void {
  b.pitch = pitch;
  b.yaw = yaw;
}

const _m = MatIdentity();
const _z: Vec3 = vec3(0, 0, 1);

/**
 * `BuildSceneLightDirection` — `FUN_0040E0B0`, `(pitch, yaw, world_out,
 * view_out)`.
 *
 * ```
 * push; MatrixLoadIdentity(); MatrixRotateY(yaw); MatrixRotateX(pitch)
 * MatrixTransformVector((0, 0, 1), world_out)
 * MatrixPremultiplyTop(g_camera_world_to_view[g_camera_index])
 * MatrixTransformVector((0, 0, 1), view_out)
 * pop
 * ```
 *
 * The world half. `view_out` is the same vector through the view matrix,
 * which is the renderer's to apply.
 */
export function BuildSceneLightDirection(pitch: number, yaw: number,
                                         worldOut: Vec3): void {
  const m = _m;
  MatrixLoadIdentity(m);
  MatrixRotateY(m, yaw);
  MatrixRotateX(m, pitch);
  MatrixTransformVector(m, _z, worldOut);
}

/**
 * `LightTweenStep` — `FUN_0040B0F0`, with the store its nine callers make
 * when it answers 1 -- one a stored channel, `LightTweenStepFogNear`
 * (`FUN_0040B0A0`) to `LightTweenStepAmbient` (`FUN_0040B390`).
 *
 * ```
 * if (!t.enabled) return 0
 * if (t.target - t.cur >= 0) { t.cur += t.rate; if (t.cur >= t.target) { t.enabled = 0; t.cur = t.target } }
 * else                      { t.cur -= t.rate; if (t.cur <= t.target) { t.enabled = 0; t.cur = t.target } }
 * return 1                                     ; and the caller: block word = t.cur
 * ```
 *
 * `frames` is the walker's clock, one a frame at 60 Hz.
 */
export function LightTweenStep(b: LightBlock, tweens: (ChannelTween | null)[],
                               c: number, frames: number): void {
  const t = tweens[c];
  if (!t) return;
  const cur = b.channels[c];
  const step = t.rate * frames;
  if (t.to - cur >= 0) {
    const v = cur + step;
    if (v >= t.to) {
      b.channels[c] = t.to;
      tweens[c] = null;
    } else {
      b.channels[c] = v;
    }
  } else {
    const v = cur - step;
    if (v <= t.to) {
      b.channels[c] = t.to;
      tweens[c] = null;
    } else {
      b.channels[c] = v;
    }
  }
}
