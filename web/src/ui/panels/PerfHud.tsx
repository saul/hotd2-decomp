/**
 * The perf meter's readout, over the game.
 *
 * Small, monospace and not pressable, in the top-left corner under the menu
 * -- on a phone that is the black bar beside the 4:3 frame, so it covers
 * nothing. The numbers are `app/perf.ts`'s; this lays them out and says
 * nothing it was not given. A section under a tenth of a millisecond is left
 * out, so the list is what is worth reading.
 */
import { useSlice } from "../useSlice";

export function PerfHud() {
  const p = useSlice((s) => s?.perf ?? null);
  if (!p) return null;
  const [calls, tris, programs, textures] = p.gl;
  const big = p.sections.filter(([, mean, max]) => mean >= 0.1 || max >= 1);
  return (
    <div id="perf-hud" aria-hidden="true">
      <div className="perf-line perf-head">
        <b>{p.fps}</b> fps · {p.frame[0]}/{p.frame[1]}/{p.frame[2]} ms
        {p.long > 0 && <span className="perf-bad"> · {p.long} long</span>}
      </div>
      <div className="perf-line">
        busy {p.busy[0]} (max {p.busy[1]}) · gpu≈ {p.gpu ?? "–"}
        {" "}· ×{p.ticks} ticks
      </div>
      {big.map(([name, mean, max]) => (
        <div className="perf-line perf-sec" key={name}>
          <span>{name}</span> {mean} <span className="perf-dim">({max})</span>
        </div>
      ))}
      {p.systems.length > 0 && (
        <div className="perf-line perf-dim">
          {p.systems.map(([id, ms]) => `${id.replace(/^(render|game|hud)\./, "")} ${ms}`)
            .join(" · ")}
        </div>
      )}
      <div className="perf-line perf-dim">
        {calls} calls · {(tris / 1000).toFixed(1)}k tri · {programs} prog
        {" "}· {textures} tex
      </div>
      <div className="perf-line perf-dim">
        {p.view}{p.experiments ? ` · ${p.experiments}` : ""}
      </div>
    </div>
  );
}
