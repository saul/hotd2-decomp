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

/** One row of a key/value readout: label, value, and whether it is hot. */
export type StripRow = readonly [string, string, boolean?];

/**
 * The debug sidebar's groups.
 *
 * One panel per subject, each holding that subject's switches *and* its
 * numbers — because a control and the readout it affects belong together, and
 * they used to sit on opposite sides of the page with only a shared word
 * connecting them.
 */
export type DebugGroupName =
  "camera" | "scene" | "actors" | "props" | "collision" | "shooting";

/** One route out of a branch point, as a button. */
export interface BranchOption {
  target: number;
  label: string;
  title: string;
  /**
   * True on the route the **game** is taking — `next[g_script_branch_var]` as
   * the engine would read it. Exactly one option carries it when the latched
   * choice names a live target, and none does when it names a hole.
   *
   * The bar used to show three equal buttons and a countdown, which said the
   * choice was the viewer's to make. It is the game's; the buttons are an
   * override.
   */
  chosen: boolean;
  /**
   * The arcade shows a preview of each route before you commit — the
   * `store_six` operands, indexed by `branch_choice`. Null when a choice is
   * stored as slot 0 / frame 0, which resolves to no path: no preview beats a
   * shot of somewhere else.
   */
  preview: { slot: number; frame: number } | null;
}

/**
 * A branch point, which playback **is** waiting on — unlike the skip bar.
 *
 * Null when there is none.
 */
export interface BranchProjection {
  sub: string;
  options: BranchOption[];
  countdown: string;
  /** True while hovering has stopped the override window. */
  paused: boolean;
}

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
 * change. `app/` keeps the same object across frames, so `stabilise` settles
 * it with one `Object.is` and React never walks it.
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
  /**
   * A number that only ever goes up, so React can key on the row.
   *
   * `Feed.tsx` keyed on the array index, over a window `Player.onFeed` caps
   * with `slice(-400)`. Past the cap every push shifts every index by one, so
   * React saw four hundred rows whose content had all changed and rewrote the
   * text of every one of them to add a single line at the bottom. With this
   * the key follows the row and a push is one insertion.
   *
   * It is minted in `onFeed` and it is deliberately **not** `FeedEntry.seq`:
   * that one is the walker's own instruction counter, it is in the snapshot
   * and a load or a seek resets it to zero, and roughly a dozen of the
   * `Player` event handlers raise an entry with `seq: -1` because they are not
   * an instruction at all. Neither property is what a React key needs, which
   * is only that it never repeats.
   */
  seq: number;
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
 * One object rig, as the rigs panel lists it.
 *
 * A rig is a thing that rides an `op_` path — a vehicle, a shutter, a prop
 * assembled from a transcribed draw routine. `boxed` is this panel's own
 * selection, drawn as an outline in the scene by `render/rigs.ts`.
 */
export interface RigRow {
  name: string;
  /** The `op_` slot the current route rides, or null when no route is live. */
  slot: number | null;
  visible: boolean;
  /** The path ran out and the pose is held. */
  frozen: boolean;
  note: string;
  /** How many routes this rig has. Exactly one is ever drawn. */
  routes: number;
  boxed: boolean;
}

/** The rigs panel. Null while it is folded. */
export interface RigsProjection {
  /** `12/335 showing`. */
  sub: string;
  rows: RigRow[];
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
  /** Is there a snapshot behind the present to go back to? */
  canRewind: boolean;
  /** What the rewind button says it will do, and how much history is held. */
  rewindLabel: string;
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

/**
 * The overlay over the viewport while a bundle or a stage is coming in.
 *
 * `failed` is the terminal kind: the spinner goes and the text is an error.
 * There is no way back from one, which is why it is a flag on the same value
 * rather than a second field that could disagree with it.
 */
export interface LoadingProjection {
  text: string;
  failed: boolean;
}

/**
 * The stage's line in the top bar.
 *
 * The bundle note is separate because it carries its own tooltip -- the build
 * stamp and the tool that made it. A re-export changes the data under a page
 * that looks identical, and a stale bundle is indistinguishable from a bug.
 */
export interface StatusProjection {
  /** Model, triangle, region, block and branch-point counts. */
  text: string;
  /** ` · bundle 3 min old`, or empty. */
  note: string;
  noteTitle: string;
}

export interface UiProjection {
  stage: number;
  /**
   * Some stage the page can open was built by an older exporter.
   *
   * A boolean because that is all the top bar can usefully say in the space it
   * has; which stages, and what moved, is the bundle screen's job. It is not a
   * refusal — the bundle reads, it is merely out of date — and the whole
   * reason it is on screen at all is that the previous silent version of this
   * had a cached stage with holes in it winning over the rebuilt one.
   */
  bundleStale: boolean;
  stages: readonly number[];
  original: boolean;
  /** Null once the stage is up. */
  loading: LoadingProjection | null;
  /** The stage's line in the top bar. */
  status: StatusProjection;
  /**
   * The clock is stopped and the viewer is meant to notice.
   *
   * Free roam stops the same clock but does **not** raise this — it is a mode
   * you chose, with its own lit button, and covering the view you are flying
   * through with `PAUSED` would be worse than saying nothing.
   */
  paused: boolean;
  toggles: Readonly<Record<ToggleName, boolean>>;
  transport: TransportProjection;
  sound: SoundProjection;
  lightMode: string;
  fogMode: string;
  /** Texture filtering, and the anisotropy the hardware actually allows. */
  filterMode: string;
  anisotropyLimit: number;
  pillarbox: boolean;
  wait: WaitProjection | null;
  /** The wait panel's `box` checkbox. See the `boxWait` command. */
  waitBoxed: boolean;
  actorPanel: ActorsProjection | null;
  /** Null while the panel is folded — it is the expensive one to build. */
  globals: GlobalsProjection | null;
  /** The object rigs. Null while the panel is folded. */
  rigs: RigsProjection | null;
  /** Rebuilt on a stage load only, and held by reference until then. */
  tree: TreeProjection | null;
  /** Also per stage; the minimap paints it to a canvas itself. */
  minimap: MinimapGraph | null;
  /** Where the script is now, for the tree's highlight. */
  current: { block: number; step: number; op: number } | null;
  /**
   * The event feed, capped.
   *
   * Replaced rather than mutated on every push, so this is reference-stable
   * between pushes and `stabilise` never walks its four hundred rows.
   */
  feed: readonly FeedRow[];
  /** The inspector's body, already serialised. */
  inspector: string;
  /** The Player strip: label, value, and whether it is worth the eye. */
  hudRows: readonly StripRow[];
  /**
   * Each debug group's readouts.
   *
   * The switches are not here: they come from the `TOGGLES` table, which is
   * the one owner of what a toggle is and which carries the `group` that says
   * where it is drawn. This is only the numbers beside them.
   */
  groups: Readonly<Record<DebugGroupName, readonly StripRow[]>>;
  skip: SkipProjection | null;
  branch: BranchProjection | null;
  scopes: ScopeRow | null;
  scopeContext: { frame: number; stageLoadedAt: number };
  /** Whether a snapshot is held, so Load can be enabled. */
  hasSaved: boolean;
}
