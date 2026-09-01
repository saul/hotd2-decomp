/**
 * What the UI is allowed to know.
 *
 * One plain, read-only value, rebuilt each frame by `app/` and handed to
 * React. Nothing in `ui/` imports `game/`, `script/` or `bundle/`; if a panel
 * needs a fact, the fact gets a field here and `app/` fills it in.
 *
 * That rule is what `ui-reads-projection-only` counts, and it is not tidiness.
 * A panel that reads `G.g_object_list` directly is a second reader of engine
 * state with its own idea of when to look, which is how a sidebar comes to
 * disagree with the boxes drawn around the actors it is listing.
 *
 * Everything here is plain data: numbers, strings, booleans and arrays of
 * them. No class instances, no three.js, no live references. The test is
 * whether `structuredClone` would round-trip it — the same test a snapshot
 * slice has to pass, for the same reason.
 */
import type { ScopeRow } from "./panels/scope_types";
import type { ToggleName } from "./commands";

/**
 * One subtitle line, as the HUD draws it.
 *
 * Declared here rather than imported from `bundle/` on purpose. A type-only
 * import carries no code, but it makes `ui/` track the exporter's schema —
 * and the whole point of a projection is that the UI owns the shape of its
 * own input. `app/` maps the bundle's `DialogueLine` onto this and would not
 * compile if the two drifted.
 */
export interface SubtitleLine {
  text: string;
  /** Added to the centred position, in the game's 640-wide screen. */
  xOffset: number;
  /** The frame count this line gives way at. */
  endFrame: number;
}

/** One weapon in flight, as the globals panel lists it. */
export interface ThrownRow {
  id: number;
  slot: number;
  ttl: string;
  state: string;
}

/** One actor, as the sidebar and the boxes both read it. */
export interface ActorRow {
  at: number;
  cls: number;
  /** The class's name, resolved by `app/` — `ui/` has no registry. */
  className: string;
  state: number;
  stateName: string;
  hp: number;
  dead: boolean;
  visible: boolean;
  despawned: boolean;
  /** Distance from the camera, already computed. */
  range: number;
  /** True while this actor is what the script is waiting on. */
  blocking: boolean;
  /** False when the class has no module, so nothing drives it. */
  ported: boolean;
  /** `obj+0x120`, the sub-state. */
  sub: number;
  /** "dead · permit 0 · no module" — already assembled. */
  flags: string;
}

/** One row of the port's data segment. */
export interface GlobalRow {
  name: string;
  value: string;
  /** `0x009A2BA0`, or empty when `globals.ts` cites none. */
  address: string;
}

/** The data segment as the panel draws it. Absent while the panel is shut. */
export interface GlobalsProjection {
  rows: GlobalRow[];
  actors: ActorRow[];
  liveActors: number;
  thrown: ThrownRow[];
}

/** One line of a debug panel. `note` is the indented, dimmer kind. */
export interface DebugLine {
  text: string;
  note?: boolean;
  /** Worth the eye: the thing actually holding the wait. */
  hot?: boolean;
  dead?: boolean;
}

/** What the script is waiting on. Null while the panel is folded. */
export interface WaitProjection {
  /** `0x3B wait_enemies_alive`, or "running". */
  sub: string;
  lines: DebugLine[];
}

/** One class's actors, as the sidebar groups them. */
export interface ActorGroup {
  cls: number;
  /** `0x30 Zombie`. The id is always shown, and always first. */
  name: string;
  count: number;
  ported: boolean;
  open: boolean;
  boxed: boolean;
  /** Empty when the group is folded shut. */
  lines: DebugLine[];
}

/** The actor sidebar. Null while the panel is folded. */
export interface ActorsProjection {
  sub: string;
  groups: ActorGroup[];
}

export interface TransportProjection {
  playing: boolean;
  mode: "play" | "step" | "free";
  speed: number;
  frozen: boolean;
  /** Null when the shot has no path — free roam, or a stage with no cam. */
  camSlot: number | null;
  camFrame: number;
  camFrameLo: number;
  camFrameHi: number;
  camLabel: string;
}

export interface UiProjection {
  /** Bumped whenever anything below changed. React re-renders on this alone. */
  revision: number;
  stage: number;
  stages: number[];
  original: boolean;
  loading: string | null;
  status: string;
  toggles: Readonly<Record<ToggleName, boolean>>;
  transport: TransportProjection;
  wait: WaitProjection | null;
  actorPanel: ActorsProjection | null;
  /** Null while the panel is folded — it is the expensive one to build. */
  globals: GlobalsProjection | null;
  scopes: ScopeRow | null;
  scopeContext: { frame: number; stageLoadedAt: number };
  /** Whether a snapshot is held, so Load can be enabled. */
  hasSaved: boolean;
}
