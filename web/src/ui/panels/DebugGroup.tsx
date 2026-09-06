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
 *
 * **And the switches come in two kinds, drawn apart.** Hiding the sky and
 * drawing a box round every actor were the same-looking checkbox in the same
 * column, and one of them changes what the game looks like while the other
 * adds something the game never had. `ToggleSpec.kind` says which, and each
 * half is labelled.
 */
import type { DebugGroupName } from "../projection";
import { useDispatch } from "../store_context";
import { useSlice } from "../useSlice";
import { TOGGLES } from "./Toggles";

/** The switches this group draws, resolved once: the table never moves. */
const byGroup = (g: DebugGroupName, kind: "game" | "debug") =>
  TOGGLES.filter((t) => t.group === g && t.kind === kind);

/**
 * What each half of a group is, said once where it is read.
 *
 * A column of identical checkboxes cannot say whether a switch hides part of
 * the game or adds wireframe over it, and that is the difference that decides
 * whether you are looking at a bug. So the two are drawn apart and each is
 * named. The classification is `ToggleSpec.kind`; this is only the wording.
 */
const KIND_TITLE: Record<"game" | "debug", [string, string]> = {
  game: ["the game", "What the game itself draws. Turning one of these off "
    + "hides part of the real scene, so what is left is not what the game "
    + "looks like."],
  debug: ["overlays", "Drawing this player invented, over the top of the "
    + "game: markers, boxes, rails and labels the game never had. None of it "
    + "changes what the game does, and none of it is in a snapshot."],
};

function Switches({ group, kind }:
                  { group: DebugGroupName; kind: "game" | "debug" }) {
  const dispatch = useDispatch();
  const state = useSlice((s) => s?.toggles ?? null);
  const specs = byGroup(group, kind);
  if (!specs.length || !state) return null;
  const [label, title] = KIND_TITLE[kind];
  return (
    <div className={`grp-switches grp-${kind}`}>
      <span className="grp-kind" title={title}>{label}</span>
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
      <Switches group={group} kind="game" />
      <Switches group={group} kind="debug" />
      <Rows group={group} />
    </div>
  );
}
