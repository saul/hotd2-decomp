/**
 * One subject's switches and its numbers, in one panel.
 *
 * The player used to say everything twice and on opposite sides of the page:
 * a checkbox per layer along the top bar, and a line per layer's `describe`
 * down the right. Nothing but a shared word connected them, both lists grew
 * one entry at a time, and by the end the top bar was sixteen checkboxes and
 * the strip was thirty rows with no scroller — tall enough to squeeze the
 * event feed below it to nothing.
 *
 * So: **a control and the readout it affects belong together.** A group draws
 * the toggles whose `TOGGLES` entry names it, then that group's rows from the
 * projection. Neither list is written here — the switches come from the one
 * table that owns what a toggle is, and the rows from `app/projection/hud.ts`
 * — so adding either is one entry in one place.
 */
import type { DebugGroupName } from "../projection";
import { useDispatch } from "../store_context";
import { useSlice } from "../useSlice";
import { TOGGLES } from "./Toggles";

/** The switches this group draws, resolved once: the table never moves. */
const byGroup = (g: DebugGroupName) => TOGGLES.filter((t) => t.group === g);

function Switches({ group }: { group: DebugGroupName }) {
  const dispatch = useDispatch();
  const state = useSlice((s) => s?.toggles ?? null);
  const specs = byGroup(group);
  if (!specs.length || !state) return null;
  return (
    <div className="grp-switches">
      {specs.map((t) => (
        <label key={t.name} title={t.title}>
          <input type="checkbox" checked={state[t.name]}
                 onChange={(e) => dispatch({ kind: "toggle", name: t.name,
                                             on: e.target.checked })} />
          {" "}{t.label}
        </label>
      ))}
    </div>
  );
}

function Rows({ group }: { group: DebugGroupName }) {
  const rows = useSlice((s) => s?.groups[group] ?? null);
  if (!rows?.length) return null;
  return (
    <div className="grp-rows">
      {rows.map(([k, v, hot], i) => (
        <span key={i} style={{ display: "contents" }}>
          <span className="k">{k}</span>
          <span className={hot ? "v hot" : "v"}>{v}</span>
        </span>
      ))}
    </div>
  );
}

export function DebugGroup({ group }: { group: DebugGroupName }) {
  return (
    <div className="grp">
      <Switches group={group} />
      <Rows group={group} />
    </div>
  );
}
