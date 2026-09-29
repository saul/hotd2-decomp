/**
 * The whole projection, assembled once a frame.
 *
 * This is the only place that reads the player's parts and writes the UI's
 * value, and the direction is one-way by construction: `PlayerView` is
 * **read-only**, so nothing here can change anything. That is worth a file of
 * its own — the seam between "what the player is" and "what the UI may know"
 * is exactly where a debug panel starts quietly driving the game.
 *
 * The interface below is therefore the answer to "what does the UI depend
 * on?", written down. Adding a field to `UiProjection` that needs something
 * new means adding it here first, in the open.
 */
import type { Walker } from "../../script/walker";
import type { ToggleName } from "../../ui/commands";
import type { UiSlice } from "../../ui/store";
import type {
  BranchProjection, ContinueProjection, CrosshairSprite, JoinProjection, FeedRow,
  LoadingProjection, NetPeerProjection, NetProjection, PerfProjection, FpsProjection,
  SkipProjection, SoundProjection, StatusProjection, StripRow, TransportProjection,
  TreeProjection, UiProjection,
} from "../../ui/projection";
import type { DebugGroupName } from "../../ui/projection";
import { stabilise } from "./stable";
import { crosshairProjection, gameOverProjection } from "./chrome";
import { actorsProjection, waitProjection } from "./sidebar";

/**
 * Everything the projection reads, and nothing it may write.
 *
 * `readonly` throughout on purpose. A builder that could set `playing` would
 * be a second transport, and the reason the UI layer exists is that there is
 * exactly one.
 */
export interface PlayerView {
  readonly walker: Walker | null;
  readonly stage: number;
  readonly stages: readonly number[];
  /** See {@link UiProjection.entries}. */
  readonly entries: readonly number[];
  /** See {@link UiProjection.entry}. */
  readonly entry: number;
  readonly original: boolean;
  readonly loading: LoadingProjection | null;
  readonly status: StatusProjection;
  /** See {@link UiProjection.bundleStale}. */
  readonly bundleStale: boolean;
  /** The clock is stopped and the viewer is meant to notice. */
  readonly paused: boolean;
  /** See {@link UiProjection.started}. */
  readonly started: boolean;
  /** See {@link UiProjection.homeScreenHint}. */
  readonly homeScreenHint: boolean;
  readonly lightMode: string;
  readonly fogMode: string;
  readonly filterMode: string;
  readonly anisotropyLimit: number;
  /** See {@link UiProjection.pillarbox}. */
  readonly pillarbox: boolean;
  /** See {@link UiProjection.boxed}. */
  readonly boxed: boolean;
  /** See {@link UiProjection.pixelRatio}. */
  readonly pixelRatio: number;
  readonly pixelRatioOptions: readonly number[];
  readonly toggles: Readonly<Record<ToggleName, boolean>>;
  readonly camEye: { x: number; y: number; z: number };
  readonly boxedClasses: ReadonlySet<number>;
  readonly shutClasses: ReadonlySet<number>;
  readonly boxWait: boolean;
  /**
   * Is anything showing this slice?
   *
   * The panels answer, by being mounted. This used to be
   * `document.querySelector("#globals-panel").open` — the composition root
   * asking the DOM a question once a frame, with the answer owned by a layer
   * three above it. See `ui/store.ts`.
   */
  readonly wants: (slice: UiSlice) => boolean;
  readonly tree: TreeProjection | null;
  readonly feed: readonly FeedRow[];
  readonly hudRows: readonly StripRow[];
  readonly groups: Readonly<Record<DebugGroupName, readonly StripRow[]>>;
  readonly sound: SoundProjection;
  readonly skip: SkipProjection | null;
  readonly continueOffer: ContinueProjection | null;
  readonly joinOffer: JoinProjection | null;
  readonly perf: PerfProjection | null;
  readonly fps: FpsProjection | null;
  readonly branch: BranchProjection | null;
  readonly transport: TransportProjection;
  /** Which player this page's gun is: 0 alone or hosting, 1 as player 2. */
  readonly localPlayer: number;
  /** See {@link UiProjection.crosshairSprite}. */
  readonly crosshairSprite: CrosshairSprite | null;
  /** See {@link UiProjection.net}. */
  readonly netView: NetProjection | null;
  /** See {@link UiProjection.netPeer}. */
  readonly netPeer: NetPeerProjection | null;
}

/**
 * This frame's projection, sharing everything it can with the last.
 *
 * `prev` is what the store is already holding. Every slice that has not
 * changed comes back as the same object, so `memo` in `ui/` is the diff —
 * see `app/projection/stable.ts`. The builder below is therefore free to
 * allocate: what it hands back is filtered through `stabilise`.
 */
export function buildProjection(v: PlayerView,
                                prev: UiProjection | null): UiProjection {
  const w = v.walker;
  const eye = v.camEye;
  return stabilise(prev, {
    stage: v.stage,
    // Held by reference and replaced rather than mutated, all three of them,
    // so `Object.is` settles them without a walk.
    stages: v.stages,
    entries: v.entries,
    entry: v.entry,
    original: v.original,
    loading: v.loading,
    status: v.status,
    bundleStale: v.bundleStale,
    paused: v.paused,
    started: v.started,
    homeScreenHint: v.homeScreenHint,
    // `HudDrawCrosshair`'s decision, off `G`. Off before the first player
    // turn, which is also what the engine's BSS says.
    crosshair: crosshairProjection(v.localPlayer),
    crosshairSprite: v.crosshairSprite,
    toggles: v.toggles,
    transport: v.transport,
    sound: v.sound,
    lightMode: v.lightMode,
    fogMode: v.fogMode,
    filterMode: v.filterMode,
    anisotropyLimit: v.anisotropyLimit,
    pillarbox: v.pillarbox,
    boxed: v.boxed,
    pixelRatio: v.pixelRatio,
    pixelRatioOptions: v.pixelRatioOptions,
    // A slice nothing is showing is not built. Its *selection* still counts,
    // though — the highlight set is computed whatever the panels are showing.
    wait: w && v.wants("wait") ? waitProjection(w, eye) : null,
    waitBoxed: v.boxWait,
    actorPanel: v.wants("actors")
      ? actorsProjection(eye, v.boxedClasses, v.shutClasses) : null,
    tree: v.tree,
    current: w ? { block: w.block, step: w.step, op: w.opIndex } : null,
    feed: v.feed,
    hudRows: v.hudRows,
    groups: v.groups,
    skip: v.skip,
    continueOffer: v.continueOffer,
    joinOffer: v.joinOffer,
    perf: v.perf,
    fps: v.fps,
    branch: v.branch,
    gameOver: gameOverProjection(),
    net: v.netView,
    netPeer: v.netPeer,
  });
}
