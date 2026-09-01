/**
 * The object rigs, as the sidebar lists them.
 *
 * A rig is one of the things that rides an `op_` path — a vehicle, a shutter,
 * a prop assembled from a transcribed draw routine. `render/rigs.ts` owns
 * them; this turns what it knows into the plain rows `ui/` is allowed to see,
 * which is the same boundary every other panel is on the far side of.
 *
 * The list used to be one row of the HUD strip, produced by
 * `RigLayer.describe` as a comma-joined string of every visible name. In
 * stage 2 that is a hundred-odd names in a strip with no scroller, so it grew
 * to seven hundred pixels and squeezed the panels below it — the event feed
 * has `flex: 1` and was reaching zero height, summary and all. A list is a
 * list, and belongs in a panel that can fold and scroll.
 */
import type { RigRow, RigsProjection } from "../../ui/projection";

/** What `app/` reads out of the rig layer. `RigLayer.list` satisfies it. */
export interface RigSource {
  name: string;
  slot: number | null;
  visible: boolean;
  frozen: boolean;
  note: string;
}

export function rigsProjection(list: readonly RigSource[],
                               boxed: ReadonlySet<string>): RigsProjection {
  // **One row per rig, not per instance.** `render/rigs.ts` emits one root per
  // route and its own comment is explicit that "a rig is treated as one actor
  // here rather than one instance per route" -- exactly one of them is drawn at
  // a time, and which one is a function of the camera path. A row per instance
  // therefore lists the same object three times, only one of which is ever
  // showing, and names it three times identically: the first version of this
  // keyed React on the name and React said so.
  //
  // Grouping is also what makes `boxRig` mean something. The command carries a
  // name, so it outlines every instance of that rig -- which is the whole
  // object, which is what was asked for.
  const by = new Map<string, RigRow>();
  for (const r of list) {
    let row = by.get(r.name);
    if (!row) {
      by.set(r.name, (row = {
        name: r.name, slot: r.slot, visible: r.visible, frozen: r.frozen,
        note: r.note, routes: 0, boxed: boxed.has(r.name),
      }));
    }
    row.routes++;
    // The showing instance is the one worth describing; the others are routes
    // this shot did not select.
    if (r.visible) {
      row.visible = true;
      row.slot = r.slot;
      row.frozen = r.frozen;
      row.note = r.note;
    }
  }
  const rows = [...by.values()];
  // **By name, and by nothing else.** Sorting the showing ones to the top reads
  // better in a screenshot and is unusable in motion: rigs appear and vanish as
  // the camera moves between paths, so a row moves out from under the pointer
  // between deciding to click it and clicking it. Which ones are showing is
  // said by the row being dim, which costs nothing and does not move.
  rows.sort((a, b) => a.name.localeCompare(b.name));
  const shown = rows.filter((r) => r.visible).length;
  return { sub: `${shown}/${rows.length} showing`, rows };
}
