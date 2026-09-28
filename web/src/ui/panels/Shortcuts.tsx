/**
 * The `?` dialog: every key the page answers to.
 *
 * Drawn from `ui/shortcuts.ts` and from nothing else, so it cannot list a key
 * that does nothing or miss one that does -- `test:ui` holds that table to the
 * handlers. The overlay rows say whether each overlay is on, because the
 * question a viewer has when they open this mid-stage is usually "which key
 * turned that on".
 *
 * Whether it is open is `App`'s state and not a command: like the sidebar, it
 * changes nothing outside `ui/`. `App` also holds the game while it is open --
 * a list you read with the zombies still walking is a list you read once.
 */
import { useEffect, useRef } from "react";
import { useSlice } from "../useSlice";
import { SHORTCUT_GROUPS, type Shortcut } from "../shortcuts";

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const toggles = useSlice((p) => p?.toggles ?? null);
  const card = useRef<HTMLDivElement>(null);

  // Focus moves into the dialog, as it should for a modal, but onto the card
  // and not the close button: a focused button takes Space and Enter, and
  // `app/`'s handler rightly defers to it, so Space would close the list
  // rather than do what the list says it does.
  useEffect(() => { card.current?.focus(); }, []);

  return (
    <div id="shortcuts"
         onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="shortcuts-card" ref={card} tabIndex={-1} role="dialog"
           aria-modal="true" aria-labelledby="shortcuts-title">
        <header>
          <h2 id="shortcuts-title">Keyboard shortcuts</h2>
          <button className="shortcuts-close" aria-label="Close"
                  title="Close (Esc)" onClick={onClose}>×</button>
        </header>
        <div className="shortcuts-groups">
          {SHORTCUT_GROUPS.map((g) => (
            <section key={g.title}>
              <h3>{g.title}</h3>
              <dl>
                {g.rows.map((r) => (
                  <Row key={r.cap + r.what} row={r}
                       on={r.toggle && toggles ? toggles[r.toggle] : undefined} />
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

function Row({ row, on }: { row: Shortcut; on: boolean | undefined }) {
  return (
    <>
      <dt>
        {row.by === "pointer"
          ? <span className="press">{row.cap}</span>
          : row.cap.split(" ").map((c) => <kbd key={c}>{c}</kbd>)}
      </dt>
      <dd>
        {row.what}
        {row.note && <span className="note"> · {row.note}</span>}
        {on !== undefined && (
          <span className={on ? "state on" : "state"}>{on ? "on" : "off"}</span>
        )}
      </dd>
    </>
  );
}
