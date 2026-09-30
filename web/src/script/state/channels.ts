/**
 * The light-block opcodes, `0x20`..`0x27`: a channel of light block 0 or 1
 * set, or tweened by rate or by time.
 *
 * ```
 *   0 fog near   1 fog far   2,3,4 fog RGB (0-255)   5 = 2,3,4 together
 *   6,7,8 light RGB (0..1)   9 = 6,7,8 together      10 ambient
 * ```
 *
 * The blocks and their tweens are `G`'s -- `g_scene_light_block0/1` and
 * `g_light_tween_block0/1`, `game/light_block.ts` -- and are stepped by
 * `PushSceneLightStateToDevice` (`game/light_sets.ts`). This is the operand
 * decoding the three handlers share: `ApplyLightChannelOperand`
 * (`FUN_0040B3F0`, set), `ApplyLightChannelTweenRate` (`FUN_0040B650`) and
 * `ApplyLightChannelTweenFrames` (`FUN_0040BA90`).
 *
 * The tween is a **rate**, not an interpolation between endpoints: the handler
 * stores a per-frame step and the block runs until the value lands on the
 * target, which is what clearing the slot's `enabled` word amounts to. That
 * distinction is why a fog ramp interrupted half way carries on from where it
 * was rather than restarting.
 */
import type { OpJson } from "../../bundle";
import {
  CH_FOG_R, CH_LIGHT_R, type ChannelTween, type LightBlock,
} from "../../game/light_block";

/** What one light-block opcode did. */
export interface ChannelApply {
  /** A channel was written, or a tween armed. */
  touched: boolean;
  /** A feed note, or nothing. */
  note?: string;
}

/** One of the light-block opcodes, on `block` and its `tweens`. */
export function ApplyLightChannelOp(block: LightBlock,
                                    tweens: (ChannelTween | null)[],
                                    op: OpJson): ChannelApply {
  const ch = op.channel;
  if (ch === undefined || ch < 0 || ch > 10) return { touched: false };

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
      tweens[c] = { to, rate: Math.abs(op.rate) };
    } else if (op.tween === "time" && op.frames) {
      const rate = Math.abs(to - block.channels[c]) / op.frames;
      // The handler falls through to an immediate set when frames is 0.
      tweens[c] = rate > 0 ? { to, rate } : null;
      if (rate <= 0) block.channels[c] = to;
    } else {
      // `ApplyLightChannelOperand` stores the word and the slot's `cur` and
      // leaves its `enabled` word alone: a tween running on the channel
      // carries on from the value set. The port's `cur` is the word.
      block.channels[c] = to;
    }
  }
  if (!touched) return { touched };

  if (op.tween === "time" && op.frames) {
    return { touched,
             note: `${op.channel_name} -> ${op.value} over ${op.frames} frames` };
  }
  if (op.tween === "rate") {
    return { touched, note: `${op.channel_name} -> ${op.value}` };
  }
  return { touched };
}
