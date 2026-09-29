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
/** How a netplay figure reads: fine, worth a look, or wrong. */
export type NetLevel = "ok" | "warn" | "bad" | "";

/** One labelled figure in the netplay overlay. */
export interface NetRow {
  label: string;
  value: string;
  level: NetLevel;
  /** What the figure means, for the tooltip. */
  title?: string;
}

/** Two-player netplay, as the badge, the overlay and the lobby show it. */
export interface NetProjection {
  role: "solo" | "host" | "replica";
  /** Which player this page's gun is. */
  player: 1 | 2;
  lobby: {
    phase: string;
    code: string | null;
    link: string | null;
    error: string | null;
    /** WebRTC's search for a path, in a line, while it is searching. */
    path: string | null;
    /** Once the search has run long enough to be stuck: the likeliest reason. */
    hint: string | null;
  };
  /** The one line over the game, while a session is up. */
  badge: { text: string; level: NetLevel } | null;
  /** Why the host's clock is stopped, as player 2 sees it; null while it runs. */
  held: string | null;
  /** The whole of it, only while the overlay is open. */
  stats: {
    sections: { title: string; rows: NetRow[] }[];
    log: { age: string; tick: number; kind: string; text: string }[];
    /** Everything above as JSON, for "Copy report". */
    report: string;
  } | null;
}

export type DebugGroupName =
  "camera" | "scene" | "actors" | "props" | "collision" | "shooting"
  | "route" | "net";

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
 * The prompt follows the **region**, not the offer: `canSkip` adds the firing
 * gate, and gating visibility on that made the whole feature invisible
 * whenever the gate happened to be up. So the prompt shows for the region and
 * the button carries the gate. Null when no region is open.
 */
export interface SkipProjection {
  canSkip: boolean;
  sub: string;
  /** True on the rare frame a branch point is live too: sit above it. */
  stacked: boolean;
}

/**
 * The perf meter's readout: what a frame costs, measured where it runs.
 *
 * Null unless the Perf meter overlay is on. Rebuilt twice a second rather
 * than every frame, so showing it does not cost a render a frame of its own.
 * `app/perf.ts` measures; this is only the numbers.
 */
export interface PerfProjection {
  /** Frames drawn per second, while the loop is awake. */
  fps: number;
  /** Frame-to-frame interval in ms: median, 95th percentile, worst. */
  frame: readonly [number, number, number];
  /** Frames in the window that came more than 25 ms after the last. */
  long: number;
  /** The page's own work per frame, ms: mean and worst. */
  busy: readonly [number, number];
  /** Game ticks per drawn frame, mean. */
  ticks: number;
  /** Where the work goes: [section, mean ms, worst ms], in loop order. */
  sections: readonly (readonly [string, number, number])[];
  /** The costliest systems: [id, mean ms per frame], worst first. */
  systems: readonly (readonly [string, number])[];
  /** Sampled wait for the GPU to finish a frame, ms; null before a sample. */
  gpu: number | null;
  /**
   * Textures and shader programs created on the GPU in the window -- each a
   * synchronous upload or compile inside `draw`, and on WebKit a trip to its
   * GPU process.
   */
  uploads: readonly [number, number];
  /** The window's costliest frame, in one line: "38 ms, draw 31 · +12 tex". */
  worst: string;
  /** Draw calls, triangles, shader programs, textures, geometries. */
  gl: readonly [number, number, number, number, number];
  /** The canvas: "520×390 @1× · dpr 3". */
  view: string;
  /** The URL's A/B switches that are on, "" if none. See `app/perf.ts`. */
  experiments: string;
}

/**
 * The continue offer: player 1 is on the CONTINUE? countdown and START would
 * be heard. The corner button becomes **Continue** for it, because it is the
 * one START a phone has -- the skip's button and the continue's are the same
 * press, as they are on the pad. Null whenever player 1 is not counting down.
 */
export interface ContinueProjection {
  /** START would take: the screen furniture is up and a credit is there. */
  canContinue: boolean;
  /** The digit the game draws, 9 down to 0. */
  digit: number;
  sub: string;
}

/**
 * The FPS badge: the last second of drawn frames, from `app/framestats.ts`.
 * Null while the badge is off.
 */
export interface FpsProjection {
  fps: number;
  /** Time between frames, ms: lowest, mean, highest. */
  frame: readonly [number, number, number];
  /** The page's own work per frame, ms: mean and worst. */
  work: readonly [number, number];
  /** A netplay tick's cost, ms, mean over the last second; null alone. */
  net: number | null;
  level: "ok" | "warn" | "bad";
}

/**
 * The join offer: this page's player is out -- player 2 through a one-player
 * game, or player 1 once a continue has run out -- and the game is drawing
 * PRESS START BUTTON for them. The corner button becomes **Join** or
 * **Start** for it: on a phone it is the only START there is.
 */
export interface JoinProjection {
  label: string;
  /** START would take: a credit is there. */
  canJoin: boolean;
  sub: string;
}

/**
 * The game-over screen, from `game/game_over.ts`'s state. Null while a stage
 * is being played.
 */
export interface GameOverProjection {
  /** `GameOverRunPhase`'s phase, 0..5, or -1 once it has handed on. */
  phase: number;
  /** What the phase is, in words. */
  label: string;
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

/**
 * The debug sidebar's transport: whether the clock runs, and which mode.
 *
 * What is left of the old bottom bar. The speed control, the instruction
 * steppers, the frame scrubber and the rewind button went with it; what
 * stayed is the part a viewer uses — play, pause, free roam — and the one
 * readout the harnesses count game frames by.
 */
export interface TransportProjection {
  playing: boolean;
  mode: "play" | "free";
  /**
   * `cp_st1[0] slot 32  frame 79 / 230` — the camera path and its frame.
   *
   * The one number on the page that moves once per *game* frame, which is
   * what `tools/pacing.mjs` needs to tell a tick from a frame that was merely
   * drawn.
   */
  camLabel: string;
}

/** The sound button, and the volume slider in the sidebar. */
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
 * The stage's line, in the debug sidebar's header.
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
   * A boolean because that is all the menu can usefully say in the space it
   * has; which stages, and what moved, is the bundle screen's job. It is not a
   * refusal — the bundle reads, it is merely out of date — and the whole
   * reason it is on screen at all is that the previous silent version of this
   * had a cached stage with holes in it winning over the rebuilt one.
   */
  bundleStale: boolean;
  stages: readonly number[];
  /**
   * The blocks the current stage can open at, ascending, and which one it did.
   *
   * A stage does not choose where it starts -- the stage before it does. Its
   * last route record names the block it hands over, and stage 2 has two
   * endings that name different ones. So **stage 3 opens at block 0 or block
   * 7, and stage 4 at block 0 or block 4**; every other stage has one entry
   * and the menu has nothing to offer.
   *
   * Empty before there is a stage. See `ScriptJson.entries`.
   */
  entries: readonly number[];
  /** Which of {@link UiProjection.entries} this run opened at. */
  entry: number;
  original: boolean;
  /** Null once the stage is up. */
  loading: LoadingProjection | null;
  /** The stage's line in the debug sidebar. */
  status: StatusProjection;
  /**
   * The clock is stopped and the viewer is meant to notice.
   *
   * Free roam stops the same clock but does **not** raise this — it is a mode
   * you chose, with its own lit button, and covering the view you are flying
   * through with `PAUSED` would be worse than saying nothing.
   */
  paused: boolean;
  /**
   * The game has been started by a press in this page, so `paused` means
   * PAUSED rather than the title card.
   *
   * A fact about the *page*, not the game: the press is the gesture a browser
   * wants before it will play sound, go fullscreen or hand over the motion
   * sensors, and it is taken once. A stage chosen from the menu after it plays
   * straight away.
   */
  started: boolean;
  /**
   * The game drew player 1's crosshair this frame.
   *
   * `HudDrawCrosshair` (0x004169C0) decides it, in `game/`, and it is called
   * only from `PlayerUpdateInPlay` (0x00413E90): app state 6, a life, and the
   * firing gate up -- so a cutscene takes the reticle away, and so does the
   * continue screen, where the player has no life and no in-play task. A
   * reticle over "CONTINUE?" would be the port telling the viewer something
   * the game does not.
   */
  crosshair: boolean;
  /**
   * The crosshair's own image, when the game drew one: the sprite
   * `HudDrawCrosshair` picks by the options' Sight Graphic
   * (`g_crosshair_sprites`, `0x00579F58`), as a data URL. Null for the page's
   * plain ring -- no sprite drawn, or a bundle without it.
   */
  crosshairImage: string | null;
  toggles: Readonly<Record<ToggleName, boolean>>;
  transport: TransportProjection;
  sound: SoundProjection;
  lightMode: string;
  fogMode: string;
  /** Texture filtering, and the anisotropy the hardware actually allows. */
  filterMode: string;
  anisotropyLimit: number;
  /**
   * Whether the frame is boxed to the game's 4:3, or fills the window.
   *
   * On is the cabinet's own shape -- the projection is a compile-time 4:3, so
   * filling a wider window shows more of every shot than the game ever did --
   * and the HUD's letterbox measures itself against whichever frame is
   * drawn. On by default on a touch screen, where a phone held sideways shows
   * nearly 80 degrees across for the game's 53; off on a desktop. See
   * `Player.pillarbox`.
   */
  pillarbox: boolean;
  /**
   * Canvas pixels per CSS pixel, and the steps the Resolution select offers.
   * The screen's own by default. See `Player.pixelRatio`.
   */
  pixelRatio: number;
  pixelRatioOptions: readonly number[];
  wait: WaitProjection | null;
  /** The wait panel's `box` checkbox. See the `boxWait` command. */
  waitBoxed: boolean;
  actorPanel: ActorsProjection | null;
  /** Rebuilt on a stage load only, and held by reference until then. */
  tree: TreeProjection | null;
  /** Where the script is now, for the tree's highlight. */
  current: { block: number; step: number; op: number } | null;
  /**
   * The event feed, capped.
   *
   * Replaced rather than mutated on every push, so this is reference-stable
   * between pushes and `stabilise` never walks its four hundred rows.
   */
  feed: readonly FeedRow[];
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
  continueOffer: ContinueProjection | null;
  joinOffer: JoinProjection | null;
  /** See {@link PerfProjection}. */
  perf: PerfProjection | null;
  fps: FpsProjection | null;
  branch: BranchProjection | null;
  gameOver: GameOverProjection | null;
  /** Netplay, whenever a session is up or being made; null alone. */
  net: NetProjection | null;
  /**
   * The other player's crosshair, where the game drew it this frame, in the
   * viewport's pixels -- the game's decision (`g_crosshair_drawn`) and aim
   * (`g_crosshair_x`) for the player this page is not. Null when there is no
   * other player, or the game drew none.
   */
  netPeer: { x: number; y: number; player: 1 | 2 } | null;
}
