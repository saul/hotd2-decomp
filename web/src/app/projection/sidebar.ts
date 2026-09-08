/**
 * The two panels that answer "why is nothing happening", as plain lines.
 *
 * Every stall this player has had was one of two questions: what is the script
 * waiting on and who is keeping it waiting, and what is each actor actually
 * doing. Both were answerable only by attaching a debugger or writing a
 * throwaway harness — and a throwaway harness is how four wrong diagnoses got
 * made in one session, because it built its actors differently from the
 * player.
 *
 * **The actor panel does not know what an actor is.** It walks
 * `G.g_object_list`, groups by class, and asks each class's own handler to
 * describe its actors. A class that has been ported explains itself in its own
 * vocabulary; one that has not says nothing rather than being guessed at from
 * outside. An earlier version knew how a zombie and a civilian each store
 * their state, which meant it described exactly the two classes someone had
 * taught it and drifted the moment either changed.
 *
 * It lives in `app/` and not in `ui/` for the reason the whole layer exists:
 * everything here reads `G` and the walker, and a panel that does that is a
 * second reader of engine state with its own idea of when to look. What comes
 * out is strings.
 */
import { G } from "../../game/globals";
import type { Actor } from "../../game/actor";
import { SpawnClass } from "../../game/spawn_class";
import { g_class_handlers, ActorIsEnemy, type ActorDebug }
  from "../../game/registry";
import type { Walker } from "../../script/walker";
import type { ActorGroup, ActorsProjection, DebugLine, WaitProjection }
  from "../../ui/projection";

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
  // specific name. Pointing at the doc is honest; inventing a name from what a
  // class sits next to is how "front wheel" and "health pack" get into a
  // decomp.
  return `0x${cls.toString(16).toUpperCase().padStart(2, "0")}`
    + (name ? ` ${name}` : " unnamed · see spawns.md");
}

const dist = (a: Actor, eye: { x: number; z: number }): number =>
  Math.hypot(a.pos.x - eye.x, a.pos.z - eye.z);

/** Live enough to be worth a row: still in the pool and not swept away. */
export const inPlay = (a: Actor): boolean => !a.despawned;

/** Who is actually holding the wait the walker is parked on. */
export function waitBlockers(w: Walker): Actor[] {
  const kind = w.wait?.policy.kind;
  if (kind === "enemies") {
    return G.g_object_list.filter(
      (a) => ActorIsEnemy(a.cls) && a.visible && !a.dead && inPlay(a));
  }
  if (kind === "civilians") {
    // `CivilianApplyWaitWord`'s `LeaveCountNow` takes a civilian out of
    // `g_civilians_alive` while it is still standing there, so a list that did
    // not test `sub+0x04` bit 0 named actors the count had already released —
    // and a gate held open by the **camera** looked as though an actor held it.
    return G.g_object_list.filter(
      (a) => a.cls === SpawnClass.Civilian && a.visible && inPlay(a)
          && !((a.civ?.subFlags ?? 0) & 1));
  }
  return [];
}

export function waitProjection(w: Walker,
                               eye: { x: number; z: number }): WaitProjection {
  const wait = w.wait;
  const sub = wait
    ? `0x${wait.op.op.toString(16).toUpperCase()} ${wait.op.name}`
    : "running";
  if (!wait) {
    return { sub, lines: [{ text: "The script is not blocked.", note: true }] };
  }

  const lines: DebugLine[] = [
    { text: wait.blocksOn || wait.op.name, hot: true },
    { text: `policy: ${wait.policy.kind}`
        + (wait.policy.kind === "passed" ? ` — ${wait.policy.why}` : "")
        + (wait.policy.kind === "frames"
           ? ` — ${Math.ceil(wait.policy.framesLeft)} left` : ""),
      note: true },
  ];

  const kind = wait.policy.kind;
  if (kind === "enemies" || kind === "civilians") {
    lines.push({ note: true, text: kind === "enemies"
      ? `g_enemies_alive ${G.g_enemies_alive} · g_enemies_present `
        + `${G.g_enemies_present} · need <= ${wait.op.arg ?? 0}`
      : `g_civilians_alive ${G.g_civilians_alive} · need <= `
        + `${wait.op.arg ?? 0}` });
    const blockers = waitBlockers(w);
    for (const a of blockers) {
      const d = g_class_handlers[a.cls as SpawnClass]?.debug?.(a);
      lines.push({ text: `${hex4(a.at)} ${a.name}`
        + `${d ? ` · ${d.summary}` : ""} · d=${dist(a, eye).toFixed(0)}` });
    }
    if (!blockers.length) {
      // **A gate with no named blocker has two quite different causes, and
      // this line used to give the first one every time.** It said "the camera
      // gate is" while printing `g_camera_free 1`, which is the *free* value —
      // so on stage 6 it pointed at the camera when the camera was the one
      // thing that had already handed back, and the actual holder was a
      // thrower that was dead, still inside `g_enemies_alive`, and therefore
      // filtered out of `waitBlockers` by its own `!a.dead`.
      //
      // The counter and the flag are both right here; say which of them is
      // above the line rather than guessing.
      const need = wait.op.arg ?? 0;
      const count = kind === "enemies" ? G.g_enemies_alive
                                       : G.g_civilians_alive;
      lines.push({ note: true, text: G.g_camera_free === 0
        ? "Nothing this panel can name is alive — the camera gate "
          + "(g_camera_free 0) is holding it."
        : count > need
        ? `The camera has handed back (g_camera_free 1) and the counter is `
          + `${count}: something is counted that is not in the list above — a `
          + `dead actor that never retired, or a class this panel does not `
          + `walk.`
        : "Nothing is holding it — it should pass on the next frame." });
    }
  } else if (kind === "queued") {
    lines.push({ note: true, text: `cam path ${G.g_active_cam_path} frame `
      + `${G.g_cam_path_frame} · queued events pending `
      + `${w.queuedEventsPending}` });
  }
  return { sub, lines };
}

export function actorsProjection(eye: { x: number; z: number },
                                 boxed: ReadonlySet<number>,
                                 shut: ReadonlySet<number>): ActorsProjection {
  const byClass = new Map<number, Actor[]>();
  for (const a of G.g_object_list) {
    if (!inPlay(a)) continue;
    let list = byClass.get(a.cls);
    if (!list) byClass.set(a.cls, (list = []));
    list.push(a);
  }
  const total = [...byClass.values()].reduce((n, l) => n + l.length, 0);
  const groups: ActorGroup[] = [];

  for (const cls of [...byClass.keys()].sort((a, b) => a - b)) {
    const list = byClass.get(cls)!;
    const handler = g_class_handlers[cls as SpawnClass];
    const open = !shut.has(cls);
    const lines: DebugLine[] = [];
    if (open) {
      for (const a of list) {
        const d: ActorDebug | undefined = handler?.debug?.(a);
        lines.push({
          text: `${hex4(a.at)} ${a.name} · d=${dist(a, eye).toFixed(0)}`
            + (d ? ` · ${d.summary}` : a.dead ? " · dead" : ""),
          hot: !!d?.hot, dead: a.dead,
        });
        if (d) {
          for (const line of d.detail ?? []) {
            lines.push({ text: `  ${line}`, note: true });
          }
        } else if (handler) {
          lines.push({ text: "  ported, but the class says nothing",
                       note: true });
        }
      }
    }
    groups.push({
      cls, name: className(cls), count: list.length, ported: !!handler,
      open, boxed: boxed.has(cls), lines,
    });
  }
  return { sub: `${total} in ${byClass.size} classes`, groups };
}

/**
 * Which actors get a box drawn round them.
 *
 * Independent of whether the panels are showing: a folded panel is not
 * rendered, but its selection still counts. Making room should not silently
 * drop the boxes you turned on to find something.
 */
export function highlightSet(w: Walker | null, boxed: ReadonlySet<number>,
                             hlWait: boolean): Set<number> {
  const out = new Set<number>();
  if (w && hlWait) for (const a of waitBlockers(w)) out.add(a.at);
  if (boxed.size) {
    for (const a of G.g_object_list) {
      if (inPlay(a) && boxed.has(a.cls)) out.add(a.at);
    }
  }
  return out;
}
