/**
 * The script-panel splitter.
 *
 * Drag, double-click to reset, arrow keys when focused, and the width kept in
 * localStorage. Self-contained DOM plumbing with no game state in it at all,
 * which is why it is here rather than in the player.
 */

/** Script-panel width: narrow by default, dragged by the splitter. */
const LEFT_MIN = 130;
const LEFT_MAX = 620;
const LEFT_DEFAULT = 190;
const LEFT_KEY = "hod2.leftWidth";

const $ = <T extends HTMLElement>(sel: string): T =>
  document.querySelector(sel) as T;

/**
 * Wire it up. The viewport's own `ResizeObserver` catches the layout change
 * this causes, so nothing needs to be told about it.
 */
export function wireSplitter(): void {
  const bar = $("#left-resize");
  const area = $("#stagearea");
  const set = (px: number) => {
    const w = Math.round(Math.max(LEFT_MIN, Math.min(LEFT_MAX, px)));
    document.documentElement.style.setProperty("--left-w", `${w}px`);
    bar.setAttribute("aria-valuenow", String(w));
    return w;
  };

  let w = LEFT_DEFAULT;
  try {
    const saved = Number(localStorage.getItem(LEFT_KEY));
    if (Number.isFinite(saved) && saved > 0) w = saved;
  } catch {
    // Private windows and blocked site data both throw here. A default
    // width is a perfectly good outcome, so there is nothing to report.
  }
  set(w);

  const save = (px: number) => {
    try {
      localStorage.setItem(LEFT_KEY, String(px));
    } catch {
      /* see above */
    }
  };

  let dragging = false;
  bar.addEventListener("pointerdown", (e) => {
    dragging = true;
    bar.setPointerCapture(e.pointerId);
    bar.classList.add("dragging");
    document.body.classList.add("resizing");
    e.preventDefault();
  });
  bar.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    set(e.clientX - area.getBoundingClientRect().left);
  });
  const end = (e: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    bar.releasePointerCapture(e.pointerId);
    bar.classList.remove("dragging");
    document.body.classList.remove("resizing");
    save(set(e.clientX - area.getBoundingClientRect().left));
  };
  bar.addEventListener("pointerup", end);
  bar.addEventListener("pointercancel", end);
  bar.addEventListener("dblclick", () => save(set(LEFT_DEFAULT)));
  bar.addEventListener("keydown", (e) => {
    const step = e.shiftKey ? 40 : 10;
    const cur = $("#left").getBoundingClientRect().width;
    if (e.key === "ArrowLeft") save(set(cur - step));
    else if (e.key === "ArrowRight") save(set(cur + step));
    else if (e.key === "Home") save(set(LEFT_DEFAULT));
    else return;
    e.preventDefault();
  });
}
