/**
 * The two panels that answer "why is nothing happening".
 *
 * Every stall this player has had was one of two questions: what is the script
 * waiting on and who is keeping it waiting, and what is each actor actually
 * doing. Both were answerable only by attaching a debugger or writing a
 * throwaway harness, and a throwaway harness is how four wrong diagnoses got
 * made in one session — it built its actors differently from the player.
 *
 * **The actor panel does not know what an actor is.** It walks
 * `G.g_object_list`, groups by class, and asks each class's own handler to
 * describe its actors. A class that has been ported explains itself in its own
 * vocabulary; one that has not says nothing rather than being guessed at from
 * outside. The previous version knew how a zombie and a civilian each store
 * their state, which meant it described exactly the two classes someone had
 * taught it and drifted the moment either changed.
 *
 * Everything read here comes from `G` and nothing else: if a row is wrong, the
 * port is wrong.
 */
import { G } from "../game/globals";
import type { Actor } from "../game/actor";
import { SpawnClass } from "../game/spawn_class";
import { g_class_handlers, ActorIsEnemy, type ActorDebug }
  from "../game/registry";
import type { Walker } from "../script/walker";

const $ = <T extends HTMLElement>(sel: string): T =>
  document.querySelector(sel) as T;

const hex4 = (n: number): string =>
  `0x${n.toString(16).toUpperCase().padStart(4, "0")}`;

/**
 * `0x30 Zombie`. The id is always shown, and always first.
 *
 * `SpawnClass` names every class whose handler has been read, ported or not,
 * so a class with no module still gets a name — and one that has not been read
 * at all still gets its id rather than a blank. Naming without the id would be
 * worse than useless: the id is what `spawns.md`, the annotations and the
 * bundle all speak in.
 */
export function className(cls: number): string {
  const name = SpawnClass[cls];
  // Not "unread". Ten classes the shipped scripts spawn have no member here,
  // and `spawns.md` has read most of them without any of them earning a
  // specific name: four are known only to be enemies, two are animated props
  // sharing one behaviour table, and three are never reached. Pointing at the
  // doc is honest; inventing a name from what a class sits next to is how
  // "front wheel" and "health pack" get into a decomp.
  return `0x${cls.toString(16).toUpperCase().padStart(2, "0")}`
    + (name ? ` ${name}` : " unnamed · see spawns.md");
}

function el(cls: string, text: string, title?: string): HTMLElement {
  const d = document.createElement("div");
  d.className = cls;
  d.textContent = text;
  if (title) d.title = title;
  return d;
}

const dist = (a: Actor, eye: { x: number; z: number }): number =>
  Math.hypot(a.pos.x - eye.x, a.pos.z - eye.z);

/** Live enough to be worth a row: still in the pool and not swept away. */
const inPlay = (a: Actor): boolean => !a.despawned;

/** Who is actually holding the wait the walker is parked on. */
function waitBlockers(w: Walker): Actor[] {
  const kind = w.wait?.policy.kind;
  if (kind === "enemies") {
    return G.g_object_list.filter(
      (a) => ActorIsEnemy(a.cls) && a.visible && !a.dead && inPlay(a));
  }
  if (kind === "civilians") {
    return G.g_object_list.filter(
      (a) => a.cls === SpawnClass.Civilian && a.visible && inPlay(a));
  }
  return [];
}

export class DebugPanels {
  private readonly waitPanel = $<HTMLDetailsElement>("#panel-wait");
  private readonly waitBody = $("#wait-body");
  private readonly waitSub = $("#wait-sub");
  private readonly hlWait = $<HTMLInputElement>("#hl-wait");

  private readonly actorPanel = $<HTMLDetailsElement>("#panel-actors");
  private readonly actorBody = $("#actor-body");
  private readonly actorSub = $("#actor-sub");

  /** Classes whose actors are boxed, and which groups are folded shut. */
  private readonly boxed = new Set<number>();
  private readonly shut = new Set<number>();

  /** The actors the panels want boxed. Read by `DebugBoxLayer`. */
  readonly highlight = new Set<number>();

  constructor() {
    // Delegated, because the group rows are rebuilt every frame: a listener
    // bound to a row would be on an element that no longer exists by the time
    // it is clicked. The state lives here, not in the DOM.
    this.actorBody.addEventListener("click", (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>("[data-cls]");
      if (!t) return;
      const cls = Number(t.dataset.cls);
      const set = t.dataset.act === "box" ? this.boxed : this.shut;
      if (set.has(cls)) set.delete(cls);
      else set.add(cls);
    });
  }

  update(w: Walker, eye: { x: number; z: number }): void {
    this.highlight.clear();
    // A folded panel is not rendered, but its selection still counts: making
    // room should not silently drop the boxes you turned on to find something.
    if (this.waitPanel.open) this.renderWait(w, eye);
    else if (this.hlWait.checked) {
      for (const a of waitBlockers(w)) this.highlight.add(a.at);
    }
    if (this.actorPanel.open) this.renderActors(eye);
    else this.boxWholeClasses();
  }

  private boxWholeClasses(): void {
    if (!this.boxed.size) return;
    for (const a of G.g_object_list) {
      if (inPlay(a) && this.boxed.has(a.cls)) this.highlight.add(a.at);
    }
  }

  // -- what the script is waiting on ---------------------------------------

  private renderWait(w: Walker, eye: { x: number; z: number }): void {
    const wait = w.wait;
    this.waitSub.textContent = wait
      ? `0x${wait.op.op.toString(16).toUpperCase()} ${wait.op.name}`
      : "running";
    const out: HTMLElement[] = [];
    if (!wait) {
      this.waitBody.replaceChildren(el("dbg-note", "The script is not blocked."));
      return;
    }

    out.push(el("dbg-row hot", wait.blocksOn || wait.op.name));
    out.push(el("dbg-note", `policy: ${wait.policy.kind}`
      + (wait.policy.kind === "passed" ? ` — ${wait.policy.why}` : "")
      + (wait.policy.kind === "frames"
         ? ` — ${Math.ceil(wait.policy.framesLeft)} left` : "")));

    const kind = wait.policy.kind;
    if (kind === "enemies" || kind === "civilians") {
      out.push(el("dbg-note", kind === "enemies"
        ? `g_enemies_alive ${G.g_enemies_alive} · g_enemies_present `
          + `${G.g_enemies_present} · need <= ${wait.op.arg ?? 0}`
        : `g_civilians_alive ${G.g_civilians_alive} · need <= `
          + `${wait.op.arg ?? 0}`));
      const blockers = waitBlockers(w);
      for (const a of blockers) {
        if (this.hlWait.checked) this.highlight.add(a.at);
        const d = g_class_handlers[a.cls as SpawnClass]?.debug?.(a);
        out.push(el("dbg-row", `${hex4(a.at)} ${a.name}`
          + `${d ? ` · ${d.summary}` : ""} · d=${dist(a, eye).toFixed(0)}`));
      }
      if (!blockers.length) {
        out.push(el("dbg-note", "Nothing alive is holding it — the camera "
          + `gate (g_camera_free ${G.g_camera_free}) is.`));
      }
    } else if (kind === "camera" || kind === "queued") {
      out.push(el("dbg-note", `cam path ${G.g_active_cam_path} frame `
        + `${G.g_cam_path_frame} · queued events pending `
        + `${w.queuedEventsPending}`));
    }
    this.waitBody.replaceChildren(...out);
  }

  // -- every actor, grouped by class ---------------------------------------

  private renderActors(eye: { x: number; z: number }): void {
    const byClass = new Map<number, Actor[]>();
    for (const a of G.g_object_list) {
      if (!inPlay(a)) continue;
      let list = byClass.get(a.cls);
      if (!list) byClass.set(a.cls, (list = []));
      list.push(a);
    }
    const total = [...byClass.values()].reduce((n, l) => n + l.length, 0);
    this.actorSub.textContent = `${total} in ${byClass.size} classes`;

    const out: HTMLElement[] = [];
    if (!total) out.push(el("dbg-note", "The object pool is empty."));

    for (const cls of [...byClass.keys()].sort((a, b) => a - b)) {
      const list = byClass.get(cls)!;
      const handler = g_class_handlers[cls as SpawnClass];
      const open = !this.shut.has(cls);
      const boxed = this.boxed.has(cls);

      const head = document.createElement("div");
      head.className = "dbg-group";
      head.dataset.cls = String(cls);
      const caret = el("dbg-caret", open ? "▾" : "▸");
      caret.dataset.cls = String(cls);
      const name = el("dbg-gname",
        `${className(cls)} · ${list.length}`
        + (handler ? "" : " · no module"));
      name.dataset.cls = String(cls);
      const box = el("dbg-box", boxed ? "▣ box" : "▢ box");
      box.dataset.cls = String(cls);
      box.dataset.act = "box";
      box.title = "Draw a box round every actor of this class.";
      head.append(caret, name, box);
      out.push(head);

      if (boxed) for (const a of list) this.highlight.add(a.at);
      if (!open) continue;

      for (const a of list) {
        const d: ActorDebug | undefined = handler?.debug?.(a);
        out.push(el(`dbg-row${d?.hot ? " hot" : ""}${a.dead ? " dead" : ""}`,
          `${hex4(a.at)} ${a.name} · d=${dist(a, eye).toFixed(0)}`
          + (d ? ` · ${d.summary}` : a.dead ? " · dead" : "")));
        if (d) {
          for (const line of d.detail ?? []) {
            out.push(el("dbg-note", `  ${line}`));
          }
        } else if (handler) {
          out.push(el("dbg-note", "  ported, but the class says nothing"));
        }
      }
    }
    this.actorBody.replaceChildren(...out);
  }
}
