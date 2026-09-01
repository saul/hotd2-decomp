/**
 * The three panels that answer "why is nothing happening".
 *
 * Every stall this player has had was one of three questions: what is the
 * script waiting on and who is keeping it waiting, where has a civilian's own
 * VM parked, and what are the zombies actually doing. Each was answerable only
 * by attaching a debugger or writing a throwaway harness, and a throwaway
 * harness is how four wrong diagnoses got made in one session -- it built its
 * actors differently from the player.
 *
 * So the panels read the same `G` the port runs on, and nothing else. No
 * derived state is cached here: if a row is wrong, the port is wrong.
 *
 * Each panel can box its own rows in the world. That is the other half of
 * being useful -- "zombie 0x1E00 is in HoldAtRange" only helps once you can
 * see which one it is.
 */
import { G } from "../game/globals";
import type { Actor } from "../game/actor";
import { SpawnClass } from "../game/spawn_class";
import { ZombieState } from "../game/class30/states";
import { CivilianWait } from "../game/class10";
import { ActorIsEnemy } from "../game/registry";
import type { Walker } from "../script/walker";

const $ = <T extends HTMLElement>(sel: string): T =>
  document.querySelector(sel) as T;

const hex = (n: number): string =>
  `0x${n.toString(16).toUpperCase().padStart(4, "0")}`;

/**
 * The civilian wait word, spelled out.
 *
 * `CivilianStepScript` only enters its loop at all when the word has a bit in
 * `Any` (0x40003FFF) or the timer is running, so a word made only of the high
 * bits parks the script for good — which is exactly what stage 1's hostage
 * does while it waits to be killed. Naming the bits is what makes that legible
 * rather than a hex value that means nothing.
 */
const WAIT_BITS: [number, string][] = [
  [CivilianWait.EnemiesPresent, "enemies-present"],
  [CivilianWait.EnemiesAlive, "enemies-alive"],
  [CivilianWait.ChildrenAlive, "children-alive"],
  [CivilianWait.CiviliansAlive, "civilians-alive"],
  [CivilianWait.Reach, "reach"],
  [0x20, "face"],
  [0x40, "in-front"],
  [0x80, "camera-cue"],
  [CivilianWait.MotionLoops, "motion-loops"],
  [CivilianWait.MotionFrame, "motion-frame"],
  [0x400, "hook"],
  [CivilianWait.Free, "free"],
  [CivilianWait.CameraSettled, "camera-settled"],
  [CivilianWait.ScriptFlag, "script-flag"],
  [CivilianWait.LeaveCountNow, "leave-count"],
  [CivilianWait.PushOutOfWorld, "push-out"],
  [CivilianWait.RemoveOffCamera, "remove-off-camera"],
  [CivilianWait.Uncounted, "uncounted"],
  [CivilianWait.Rescued, "rescued"],
  [CivilianWait.TwoPlayers, "two-players"],
];

function waitWordText(word: number): string {
  const on = WAIT_BITS.filter(([b]) => word & b).map(([, n]) => n);
  const parked = (word & CivilianWait.Any) === 0;
  return `0x${(word >>> 0).toString(16)}`
    + (on.length ? ` · ${on.join(" ")}` : "")
    + (parked ? " · no loop bit — parked until something external moves it" : "");
}

/** One row, as the panels all draw them. */
function row(cls: string, text: string, title?: string): HTMLElement {
  const d = document.createElement("div");
  d.className = `dbg-row ${cls}`;
  d.textContent = text;
  if (title) d.title = title;
  return d;
}

function note(text: string): HTMLElement {
  const d = document.createElement("div");
  d.className = "dbg-note";
  d.textContent = text;
  return d;
}

const dist = (a: Actor, eye: { x: number; z: number }): number =>
  Math.hypot(a.pos.x - eye.x, a.pos.z - eye.z);

/**
 * Renders the wait, civilian and enemy panels, and reports which actors each
 * has been asked to highlight.
 */
export class DebugPanels {
  private readonly waitBody = $("#wait-body");
  private readonly waitSub = $("#wait-sub");
  private readonly civBody = $("#civ-body");
  private readonly civSub = $("#civ-sub");
  private readonly enemyBody = $("#enemy-body");
  private readonly enemySub = $("#enemy-sub");

  private readonly waitPanel = $<HTMLDetailsElement>("#panel-wait");
  private readonly civPanel = $<HTMLDetailsElement>("#panel-civ");
  private readonly enemyPanel = $<HTMLDetailsElement>("#panel-enemy");

  private readonly hlWait = $<HTMLInputElement>("#hl-wait");
  private readonly hlCiv = $<HTMLInputElement>("#hl-civ");
  private readonly hlEnemy = $<HTMLInputElement>("#hl-enemy");

  /** The actors the checked panels want boxed. Read by `DebugBoxLayer`. */
  readonly highlight = new Set<number>();

  update(w: Walker, eye: { x: number; z: number }): void {
    this.highlight.clear();
    // A closed panel is not rendered, but its `box` checkbox still counts:
    // folding a group away to make room should not silently drop the boxes
    // you turned on to find something.
    if (this.waitPanel.open) this.renderWait(w, eye);
    else this.wantAll(this.hlWait, waitBlockers(w));
    if (this.civPanel.open) this.renderCivilians(eye);
    else this.wantAll(this.hlCiv, civilians());
    if (this.enemyPanel.open) this.renderEnemies(eye);
    else this.wantAll(this.hlEnemy, enemies());
  }

  private wantAll(box: HTMLInputElement, list: Actor[]): void {
    if (box.checked) for (const a of list) this.highlight.add(a.at);
  }

  // -- what the script is waiting on ---------------------------------------

  private renderWait(w: Walker, eye: { x: number; z: number }): void {
    const wait = w.wait;
    this.waitSub.textContent = wait
      ? `0x${wait.op.op.toString(16).toUpperCase()} ${wait.op.name}`
      : "running";
    const out: HTMLElement[] = [];
    if (!wait) {
      out.push(note("The script is not blocked."));
      this.waitBody.replaceChildren(...out);
      return;
    }

    out.push(row("hot", wait.blocksOn || wait.op.name));
    out.push(note(`policy: ${wait.policy.kind}`
      + (wait.policy.kind === "passed" ? ` — ${wait.policy.why}` : "")
      + (wait.policy.kind === "frames"
         ? ` — ${Math.ceil(wait.policy.framesLeft)} left` : "")));

    // Who is actually holding it. The counters are the port's own, so a row
    // here and the gate always agree.
    const kind = wait.policy.kind;
    if (kind === "enemies" || kind === "civilians") {
      const blockers = waitBlockers(w);
      const want = kind === "enemies";
      out.push(note(want
        ? `g_enemies_alive ${G.g_enemies_alive} · g_enemies_present `
          + `${G.g_enemies_present} · need <= ${wait.op.arg ?? 0}`
        : `g_civilians_alive ${G.g_civilians_alive} · need <= `
          + `${wait.op.arg ?? 0}`));
      for (const a of blockers) {
        this.want(this.hlWait, a.at);
        out.push(row("", `${hex(a.at)} ${a.name} · ${stateText(a)}`
          + ` · d=${dist(a, eye).toFixed(0)}`));
      }
      if (!blockers.length) {
        out.push(note("Nothing alive is holding it — the camera gate "
          + `(g_camera_free ${G.g_camera_free}) is.`));
      }
    } else if (kind === "camera" || kind === "queued") {
      out.push(note(`cam path ${G.g_active_cam_path} frame `
        + `${G.g_cam_path_frame} · queued events pending `
        + `${w.queuedEventsPending}`));
    }
    this.waitBody.replaceChildren(...out);
  }

  // -- class 0x10, the civilian VM -----------------------------------------

  private renderCivilians(eye: { x: number; z: number }): void {
    const civs = civilians();
    this.civSub.textContent = `${civs.length} · counted `
      + `${G.g_civilians_alive}`;
    const out: HTMLElement[] = [];
    if (!civs.length) out.push(note("No class-0x10 civilians in play."));

    for (const a of civs) {
      const s = a.civ;
      this.want(this.hlCiv, a.at);
      out.push(row(a.dead ? "dead" : "", `${hex(a.at)} ${a.name}`
        + (a.dead ? " · dead" : "")
        + ` · d=${dist(a, eye).toFixed(0)}`));
      if (!s) { out.push(note("  no VM state")); continue; }
      out.push(note(`  script ${s.script} · pc ${s.pc} · cursor ${s.cursor}`
        + ` · motion ${a.motion}`));
      out.push(note(`  wait ${waitWordText(s.wait)}`));
      // The counters and cues the wait word actually reads, so a held script
      // can be told from one waiting on something that already happened.
      const held: string[] = [];
      if (s.wait & CivilianWait.EnemiesAlive) {
        held.push(`enemies>${s.enemiesGoal} (${G.g_enemies_alive})`);
      }
      if (s.wait & CivilianWait.CiviliansAlive) {
        held.push(`civilians>${s.civiliansGoal} (${G.g_civilians_alive})`);
      }
      if (s.wait & CivilianWait.ChildrenAlive) {
        held.push(`children>${s.childrenGoal} (${s.childCount})`);
      }
      if (s.wait & CivilianWait.MotionLoops) held.push(`loops ${s.loops}`);
      if (s.wait & CivilianWait.MotionFrame) {
        held.push(`frame ==${s.motionCompare}`);
      }
      if (s.wait & 0x80) {
        held.push(`cue (${s.cuePath},${s.cueFrame}) · now `
          + `(${G.g_active_cam_path},${G.g_cam_path_frame})`);
      }
      if (s.timer >= 0) held.push(`timer ${s.timer}`);
      if (held.length) out.push(note(`  on ${held.join(" · ")}`));
      out.push(note(`  removal (${s.removePath},${s.removeFrame})`
        + ` delay ${s.removeDelay} · children ${s.childCount}`));
    }
    this.civBody.replaceChildren(...out);
  }

  // -- the enemies ---------------------------------------------------------

  private renderEnemies(eye: { x: number; z: number }): void {
    const live = enemies();
    const permits = G.g_attack_permits.filter((p) => p !== -1).length;
    this.enemySub.textContent = `${live.length} · ${permits} attacking`
      + (G.g_attack_committed ? " · committed" : "");
    const out: HTMLElement[] = [];
    if (!live.length) out.push(note("No enemies in play."));

    for (const a of live) {
      this.want(this.hlEnemy, a.at);
      const d = dist(a, eye);
      // `rank` is the raw distance rank and `queueRank` the compacted one the
      // approach gate tests; `allowance` is what the ring table lets through.
      // A zombie parked with a free permit is almost always one of these.
      const wants = a.state === ZombieState.HoldAtRange
                 || a.state === ZombieState.AttackRun;
      out.push(row(a.dead ? "dead" : a.attackPermit >= 0 ? "hot" : "",
        `${hex(a.at)} ${a.name} · ${stateText(a)}`
        + ` · d=${d.toFixed(0)} r${a.rank}/${a.allowance} q${a.queueRank}`
        + (a.attackPermit >= 0 ? ` · permit ${a.attackPermit}`
           : wants ? " · wants a permit" : "")
        + (a.dead ? " · dead" : ""),
        `hp ${a.hp}/${a.maxHp} · cooldown ${a.cooldown} · `
        + `flags 0x${(a.flags >>> 0).toString(16)}`));
    }
    this.enemyBody.replaceChildren(...out);
  }

  private want(box: HTMLInputElement, at: number): void {
    if (box.checked) this.highlight.add(at);
  }
}

/** `state/sub`, with the state's name when class 0x30 gives it one. */
function stateText(a: Actor): string {
  if (a.cls !== SpawnClass.Zombie && a.cls !== SpawnClass.Thrower) {
    return `state ${a.state}/${a.sub}`;
  }
  return `${ZombieState[a.state] ?? a.state}/${a.sub}`;
}

// The three selections, in one place: an open panel lists exactly what a
// closed one boxes.
function enemies(): Actor[] {
  return G.g_object_list.filter(
    (a) => ActorIsEnemy(a.cls) && a.visible && !a.despawned);
}

function civilians(): Actor[] {
  return G.g_object_list.filter(
    (a) => a.cls === SpawnClass.Civilian && !a.despawned);
}

/** Who is actually holding the wait the walker is parked on. */
function waitBlockers(w: Walker): Actor[] {
  const kind = w.wait?.policy.kind;
  if (kind === "enemies") return enemies().filter((a) => !a.dead);
  if (kind === "civilians") return civilians().filter((a) => a.visible);
  return [];
}
