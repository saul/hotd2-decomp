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
 * The skip offer, shown under the game's own condition.
 *
 * The bar follows the **region**, not the offer: `canSkip` adds the firing
 * gate, and gating visibility on that made the whole feature invisible
 * whenever the gate happened to be up. So the bar shows for the region and
 * the button carries the gate. Null when no region is open.
 */
export interface SkipProjection {
  canSkip: boolean;
  sub: string;
  /** True on the rare frame a branch point is live too: sit above it. */
  stacked: boolean;
}

/** One instruction, as the tree and the feed draw it. */
export interface TreeOp {
  i: number;
  name: string;
  summary: string;
  cat: string;
  /** `ported` / `partial` / `ignored` — the row's colour and its tooltip. */
  status: string;
  title: string;
  /** Lower-cased haystack for the filter box. */
  query: string;
}

export interface TreeStep {
  index: number;
  label: string;
  ops: TreeOp[];
}

export interface TreeBlock {
  index: number;
  kind: string;
  targets: number[];
  stepCount: number;
  title: string;
  steps: TreeStep[];
}

/**
 * The whole script.
 *
 * Rebuilt only on a stage load — it is thousands of rows and none of them
 * change. `app/` keeps the same object across frames, so React skips it and
 * the change key is computed without it. `treeVersion` is what says it moved.
 */
export interface TreeProjection {
  blocks: TreeBlock[];
}

/**
 * The route table, as a graph.
 *
 * All the minimap needs: which blocks exist, how each leaves, and where it
 * goes. Handing it the whole `ScriptJson` was the last thing in `hud/`
 * reading the exporter's shape.
 */
export interface MinimapGraph {
  entry: number;
  nodes: { index: number; kind: string; next: number[] }[];
}

/** One line of the event feed. */
export interface FeedRow {
  block: number;
  step: number;
  opIndex: number;
  /** `12.3.7` */
  at: string;
  name: string;
  summary: string;
  note: string;
  cat: string;
  status: string;
  title: string;
}

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
  /** False when the shot has no path — free roam, or a stage with no cam. */
  hasPath: boolean;
  camFrame: number;
  camFrameLo: number;
  camFrameHi: number;
  camLabel: string;
}

/** The audio strip: what it is doing, and what the button should say. */
export interface SoundProjection {
  muted: boolean;
  /** 0..100, as the slider reads it. */
  volume: number;
  label: string;
  /** The browser is holding audio until the page is clicked. */
  blocked: boolean;
  text: string;
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
  sound: SoundProjection;
  lightMode: string;
  fogMode: string;
  pillarbox: boolean;
  wait: WaitProjection | null;
  actorPanel: ActorsProjection | null;
  /** Null while the panel is folded — it is the expensive one to build. */
  globals: GlobalsProjection | null;
  /** Rebuilt on a stage load only. See `treeVersion`. */
  tree: TreeProjection | null;
  /** Also per stage; the minimap paints it to a canvas itself. */
  minimap: MinimapGraph | null;
  /** Bumped when `tree` is replaced, so the change key need not walk it. */
  treeVersion: number;
  /** Where the script is now, for the tree's highlight. */
  current: { block: number; step: number; op: number } | null;
  feed: FeedRow[];
  /** Bumped on every push and on a clear, for the same reason as `treeVersion`. */
  feedVersion: number;
  /** The inspector's body, already serialised. */
  inspector: string;
  /** The HUD strip: label, value, and whether it is worth the eye. */
  hudRows: [string, string, boolean?][];
  skip: SkipProjection | null;
  scopes: ScopeRow | null;
  scopeContext: { frame: number; stageLoadedAt: number };
  /** Whether a snapshot is held, so Load can be enabled. */
  hasSaved: boolean;
}
