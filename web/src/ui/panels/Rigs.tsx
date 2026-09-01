/**
 * The object rigs, and where they are.
 *
 * A rig is one of the things that rides an `op_` path — a vehicle, a shutter,
 * a prop assembled out of a transcribed draw routine. There are 335 of them in
 * stage 2 and a dozen showing at any moment, so the two questions worth
 * answering are "what is on screen" and "where is the one I expected".
 *
 * The first is the ordering: showing first, then by name. The second is the
 * `box` control, which outlines the rig in the scene — the same shape as the
 * actor sidebar's per-class box, and for the same reason. It is a command
 * rather than component state because it changes something outside `ui/`.
 */
import type { RigRow } from "../projection";
import { useDispatch } from "../store_context";
import { useSlice } from "../useSlice";

function Row({ r }: { r: RigRow }) {
  const dispatch = useDispatch();
  return (
    <div className={`rig-row${r.visible ? "" : " dead"}`}>
      <span className="rig-box"
            title={"Outline this rig in the scene. Drawn whether or not the "
                   + "rig is showing, so an absent one can still be located."}
            onClick={() => dispatch({ kind: "boxRig", name: r.name,
                                      on: !r.boxed })}>
        {r.boxed ? "▣" : "▢"}
      </span>
      <span className="rig-name">{r.name}</span>
      <span className="rig-slot">{r.slot === null ? "—" : `op ${r.slot}`}</span>
      {r.routes > 1 && <span className="rig-slot"
                             title={"Routes this rig has. Exactly one is "
                               + "drawn, chosen by the camera path."}>
                         ×{r.routes}
                       </span>}
      {r.frozen && <span className="rig-held"
                         title="The path ran out and the pose is held.">
                     held
                   </span>}
      {r.note && <span className="dbg-note rig-note">{r.note}</span>}
    </div>
  );
}

export function Rigs() {
  const p = useSlice((s) => s?.rigs ?? null);
  if (!p) return null;
  if (!p.rows.length) return <div className="dbg-note">This stage has no rigs.</div>;
  return (
    <>
      {p.rows.map((r) => <Row key={r.name} r={r} />)}
    </>
  );
}

/** The count, for the panel header. Its own subscription: it is one string. */
export function RigsSub() {
  return <>{useSlice((s) => s?.rigs?.sub ?? "")}</>;
}
