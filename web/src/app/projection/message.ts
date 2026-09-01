/**
 * The bundle's dialogue record, narrowed to what a subtitle needs.
 *
 * `MessageVariant` has nine fields; four of them reach the screen. Mapping
 * here rather than handing the record over is what keeps `hud/` off the
 * exporter's schema — a type-only import carries no code, but it still makes
 * the UI track a shape it does not own, and `ui-reads-projection-only` counts
 * it for that reason.
 */
import type { MessageVariant } from "../../bundle";
import type { ScreenMessage } from "../../hud/hud";

export function screenMessage(v: MessageVariant | null): ScreenMessage | null {
  if (!v) return null;
  return {
    frames: v.frames,
    x: v.x,
    y: v.y,
    voiceFile: v.voice_file,
    lines: (v.lines ?? []).map((l) => ({
      text: l.text, xOffset: l.x_offset, endFrame: l.end_frame,
    })),
  };
}
