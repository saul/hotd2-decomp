/**
 * A sidebar panel, which owns whether it is open.
 *
 * Two things used to be tangled in the `<details>` this replaces. The browser
 * kept the fold, `hud/ui.ts` persisted it, and `app/projection/player.ts`
 * **read it back** — `open("#globals-panel")` — to decide whether building the
 * globals slice was worth it. So the composition root asked the DOM a question
 * every frame, and the answer came from a layer three levels above it.
 *
 * They are separate concerns and they separate cleanly:
 *
 * * **The fold is `ui/` state.** It changes nothing outside this layer, so it
 *   is not a command and it is not in the projection. It lives in `useState`
 *   and is remembered by `usePersisted`.
 * * **The cost is demand, and demand is expressed by mounting.** An open panel
 *   registers a claim on its slice; `app/` asks `wants(slice)` instead of
 *   asking the document. Nothing reads the DOM, and a panel that is not
 *   rendered cannot be paid for.
 *
 * The `open`/`onToggle` pair is how a `<details>` is controlled: the browser
 * flips the attribute before React hears about it, so the state is taken from
 * `e.currentTarget.open` rather than from a value React chose.
 */
import { useEffect, type ReactNode } from "react";
import { usePersisted } from "../persist";
import type { UiSlice, UiStore } from "../store";

// Deliberately **not** `memo`. Its children are elements built fresh by the
// caller on every render, so the shallow compare could never bail -- the
// memoisation that matters is on the panel bodies below it, which take a
// projection slice and nothing else.
export function Panel({
  id, store, title, sub, subTitle, slice, defaultOpen = false, head, grow,
  children,
}: {
  /** Also the CSS hook and the persistence key. */
  id: string;
  store: UiStore;
  title: string;
  sub?: string;
  subTitle?: string;
  /** The projection slice this panel is the only consumer of, if any. */
  slice?: UiSlice;
  defaultOpen?: boolean;
  /** Controls that belong in the header rather than the body. */
  head?: ReactNode;
  grow?: boolean;
  children?: ReactNode;
}) {
  const [open, setOpen] = usePersisted(id, defaultOpen);

  // In an effect, never during render: strict mode double-invokes a render,
  // and a claim registered there would be taken twice and released once.
  useEffect(() => {
    if (!open || !slice) return;
    return store.demand(slice);
  }, [open, slice, store]);

  return (
    <details id={id} className={`panel fold${grow ? " grow-panel" : ""}`}
             open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="panel-head">
        <strong>{title}</strong>
        {sub !== undefined && <span className="dim" title={subTitle}>{sub}</span>}
        {/* A control in the header is a control, not a fold handle: a
            `summary` toggles its `details` on any click inside it, so the
            checkboxes would collapse the panel they belong to. */}
        {head !== undefined
          && <span onClick={(e) => e.stopPropagation()}>{head}</span>}
      </summary>
      {open && children}
    </details>
  );
}
