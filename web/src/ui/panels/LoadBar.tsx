/**
 * How far a stage load has got: one bar over its steps, and the step's own
 * figures under it. The "turn your phone" screen shows the same, because a
 * load starts with the page, whichever way up the phone is.
 */
export function LoadBar({ progress, detail }: { progress: number; detail?: string }) {
  const pct = Math.round(progress * 100);
  return (
    <div className="load-bar-wrap">
      <div className="load-bar" role="progressbar" aria-valuemin={0}
           aria-valuemax={100} aria-valuenow={pct}>
        <div className="load-fill" style={{ transform: `scaleX(${progress})` }} />
      </div>
      <p className="load-detail">{detail ? `${detail} · ${pct}%` : `${pct}%`}</p>
    </div>
  );
}
