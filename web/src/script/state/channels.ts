/**
 * The light block: eleven channels the script sets and tweens.
 *
 * ```
 *   0 fog near   1 fog far   2,3,4 fog RGB (0-255)   5 = 2,3,4 together
 *   6,7,8 light RGB (0..1)   9 = 6,7,8 together      10 ambient
 * ```
 *
 * All of it is arithmetic over eleven numbers — no host, no camera, no
 * cursor — which is why it comes out of the interpreter whole. The walker
 * keeps one of these and forwards two calls to it.
 *
 * The tween is a **rate**, not an interpolation between endpoints: the handler
 * stores a per-frame step and the block runs until the value lands on the
 * target, which is what clearing the block's `enabled` word amounts to. That
 * distinction is why a fog ramp interrupted half way carries on from where it
 * was rather than restarting.
 */
import type { OpJson } from "../../bundle";

/** One channel mid-tween: a target and a per-frame step magnitude. */
export interface ChannelTween {
  to: number;
  /** Per-frame step magnitude, always positive. */
  rate: number;
}

/** Light-block channel indices, as the tween handlers number them. */
export const CH_FOG_NEAR = 0;
export const CH_FOG_FAR = 1;
export const CH_FOG_R = 2;
export const CH_LIGHT_R = 6;
export const CH_AMBIENT = 10;
export const CHANNEL_COUNT = 11;

export interface FogState {
  near: number;
  far: number;
  /** 0-255 per component, as stored. */
  rgb: [number, number, number];
}

export interface LightState {
  rgb: [number, number, number];
  ambient: number;
  pitchDeg: number;
  yawDeg: number;
}

/** Fog off (a range past the 8000 far plane) and a neutral white light. */
export function defaultChannels(): number[] {
  const c = new Array(CHANNEL_COUNT).fill(0);
  c[CH_FOG_NEAR] = 65000;
  c[CH_FOG_FAR] = 65001;
  c[CH_LIGHT_R] = c[CH_LIGHT_R + 1] = c[CH_LIGHT_R + 2] = 1;
  c[CH_AMBIENT] = 0.5;
  return c;
}

export class ChannelBlock {
  channels: number[] = defaultChannels();
  tweens: (ChannelTween | null)[] = new Array(CHANNEL_COUNT).fill(null);
  /** True once the script has actually set a fog channel. */
  fogSet = false;
  /**
   * The scene light's direction, from opcodes `0x18`/`0x19` (and `0x17`'s
   * slerp target, taken immediately).
   */
  lightDir = { pitchDeg: 0, yawDeg: 0 };
  lightSet = false;

  reset(): void {
    this.channels = defaultChannels();
    this.tweens = new Array(CHANNEL_COUNT).fill(null);
    this.fogSet = false;
    this.lightSet = false;
    this.lightDir = { pitchDeg: 0, yawDeg: 0 };
  }

  /** Fog, derived from channels 0-4. */
  get fog(): FogState {
    const c = this.channels;
    return {
      near: c[CH_FOG_NEAR],
      far: c[CH_FOG_FAR],
      rgb: [c[CH_FOG_R], c[CH_FOG_R + 1], c[CH_FOG_R + 2]],
    };
  }

  /** The directional light, derived from channels 6-8 and 10 plus `0x18`. */
  get light(): LightState {
    const c = this.channels;
    return {
      rgb: [c[CH_LIGHT_R], c[CH_LIGHT_R + 1], c[CH_LIGHT_R + 2]],
      ambient: c[CH_AMBIENT],
      pitchDeg: this.lightDir.pitchDeg,
      yawDeg: this.lightDir.yawDeg,
    };
  }

  /** One of the light-block opcodes. Returns a feed note, or nothing. */
  apply(op: OpJson): string | undefined {
    const ch = op.channel;
    if (ch === undefined || ch < 0 || ch > 10) return undefined;

    const targets: number[] =
      ch === 5 ? [CH_FOG_R, CH_FOG_R + 1, CH_FOG_R + 2]
      : ch === 9 ? [CH_LIGHT_R, CH_LIGHT_R + 1, CH_LIGHT_R + 2]
      : [ch];

    // Channel 5/9 with an explicit per-component triple (the `set` form)
    // carries `components`; otherwise one value covers every target.
    const values: (number | null)[] =
      op.components && op.components.length === 3 && ch === 5
        ? op.components
        : targets.map(() => (op.value ?? null));

    let touched = false;
    for (let i = 0; i < targets.length; i++) {
      const c = targets[i];
      const to = values[i];
      if (to === null || to === undefined || !Number.isFinite(to)) continue;
      touched = true;

      if (op.tween === "rate" && op.rate) {
        this.tweens[c] = { to, rate: Math.abs(op.rate) };
      } else if (op.tween === "time" && op.frames) {
        const rate = Math.abs(to - this.channels[c]) / op.frames;
        // The handler falls through to an immediate set when frames is 0.
        this.tweens[c] = rate > 0 ? { to, rate } : null;
        if (rate <= 0) this.channels[c] = to;
      } else {
        this.tweens[c] = null;
        this.channels[c] = to;
      }
    }
    if (!touched) return undefined;

    if (ch <= 5) this.fogSet = true;
    else this.lightSet = true;

    if (op.tween === "time" && op.frames) {
      return `${op.channel_name} -> ${op.value} over ${op.frames} frames`;
    }
    if (op.tween === "rate") return `${op.channel_name} -> ${op.value}`;
    return undefined;
  }

  /**
   * Advance every running tween by `frames`.
   *
   * Steps toward the target and stops exactly on it, which is what clearing
   * the block's `enabled` word amounts to.
   */
  step(frames: number): void {
    if (frames <= 0) return;
    for (let c = 0; c < CHANNEL_COUNT; c++) {
      const t = this.tweens[c];
      if (!t) continue;
      const cur = this.channels[c];
      const delta = t.to - cur;
      const step = t.rate * frames;
      if (Math.abs(delta) <= step) {
        this.channels[c] = t.to;
        this.tweens[c] = null;
      } else {
        this.channels[c] = cur + Math.sign(delta) * step;
      }
    }
  }
}
