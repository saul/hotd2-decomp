/**
 * The splitter between the script panel and the viewport.
 *
 * The panel starts narrow because the viewport is the point of the tool; the
 * tree is a navigator, not the content. The width is a per-viewer convenience
 * and changes nothing outside `ui/`, so it is component state remembered in
 * `localStorage` — not a command, and not in the projection.
 *
 * The width reaches the layout as a CSS custom property rather than as a
 * style on `#left`, because `#left` and this bar are siblings in a grid and
 * the grid is what has to know. That is one imperative write, to a property
 * this component is the only writer of.
 */
import { useEffect, useRef } from "react";
import { usePersisted } from "../persist";

const MIN = 130;
const MAX = 620;
const DEFAULT = 190;

const clamp = (px: number): number =>
  Math.round(Math.max(MIN, Math.min(MAX, px)));

export function Resizer() {
  const [width, setWidth] = usePersisted("leftWidth", DEFAULT);
  const bar = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  useEffect(() => {
    document.documentElement.style.setProperty("--left-w", `${width}px`);
  }, [width]);

  /** Pointer x to a panel width, measured against the grid this sits in. */
  const widthAt = (clientX: number): number => {
    const area = bar.current?.parentElement;
    return clamp(clientX - (area?.getBoundingClientRect().left ?? 0));
  };

  const end = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
    e.currentTarget.classList.remove("dragging");
    document.body.classList.remove("resizing");
    setWidth(widthAt(e.clientX));
  };

  return (
    <div id="left-resize" className="resizer" role="separator" ref={bar}
         aria-orientation="vertical" aria-label="Resize the script panel"
         aria-valuemin={MIN} aria-valuemax={MAX} aria-valuenow={width}
         tabIndex={0} title="Drag to resize · double-click to reset"
         onPointerDown={(e) => {
           dragging.current = true;
           e.currentTarget.setPointerCapture(e.pointerId);
           e.currentTarget.classList.add("dragging");
           document.body.classList.add("resizing");
           e.preventDefault();
         }}
         onPointerMove={(e) => {
           // Not through `setWidth`: a drag would write `localStorage` on
           // every pointer move. The property is set here and the value is
           // committed on release.
           if (!dragging.current) return;
           document.documentElement.style.setProperty(
             "--left-w", `${widthAt(e.clientX)}px`);
         }}
         onPointerUp={end}
         onPointerCancel={end}
         onDoubleClick={() => setWidth(DEFAULT)}
         onKeyDown={(e) => {
           const step = e.shiftKey ? 40 : 10;
           if (e.key === "ArrowLeft") setWidth(clamp(width - step));
           else if (e.key === "ArrowRight") setWidth(clamp(width + step));
           else if (e.key === "Home") setWidth(DEFAULT);
           else return;
           e.preventDefault();
         }} />
  );
}
