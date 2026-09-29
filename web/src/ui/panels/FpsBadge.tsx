/**
 * The FPS badge: one line beside the menu -- frames per second, the time
 * between frames over the last second (lowest / mean / highest), the page's
 * own work per frame, and in a two-player session what a netplay tick costs.
 *
 * The numbers are `app/framestats.ts`'s, remade twice a second; the perf
 * meter (`PerfHud`) is where a frame's time is broken down.
 */
import { useSlice } from "../useSlice";

export function FpsBadge() {
  const f = useSlice((s) => s?.fps ?? null);
  if (!f) return null;
  const [low, avg, high] = f.frame;
  return (
    <div id="fps-badge" className={`fps-${f.level}`} aria-hidden="true"
         title="Frames per second; the time between frames over the last second, lowest / mean / highest; the page's own work per frame, mean and worst; and a netplay tick's cost">
      <b>{f.fps}</b> fps
      <span className="fps-dim"> · </span>{low}/{avg}/{high} ms
      <span className="fps-dim"> · work </span>{f.work[0]}<span className="fps-dim">/{f.work[1]}</span>
      {f.net !== null && <><span className="fps-dim"> · net </span>{f.net.toFixed(2)}</>}
    </div>
  );
}
