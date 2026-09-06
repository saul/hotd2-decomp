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
import type { RenderContext } from "../../render/context";
import type { Scope } from "../../core/scope";
import type { Walker } from "../../script/walker";
import type { CamPaths } from "../../game/camera/curve";
import type { ToggleName } from "../../ui/commands";
import type { UiSlice } from "../../ui/store";
import type { HistoryView } from "../ring";
import type {
  BranchProjection, FeedRow, LoadingProjection, MinimapGraph, SkipProjection,
  SoundProjection, StatusProjection, StripRow, TransportProjection,
  TreeProjection, UiProjection,
} from "../../ui/projection";
import type { DebugGroupName } from "../../ui/projection";
import { stabilise } from "./stable";
import { actorsProjection, waitProjection } from "./sidebar";
import { globalsProjection } from "./globals";
import { rigsProjection, type RigSource } from "./rigs";
import { inspectorText, opSummary } from "./script";

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
  readonly original: boolean;
  readonly loading: LoadingProjection | null;
  readonly status: StatusProjection;
  /** See {@link UiProjection.bundleStale}. */
  readonly bundleStale: boolean;
  /** The clock is stopped and the viewer is meant to notice. */
  readonly paused: boolean;
  readonly mode: "play" | "step" | "free";
  readonly playing: boolean;
  readonly speed: number;
  readonly frozen: boolean;
  readonly pillarbox: boolean;
  readonly lightMode: string;
  readonly fogMode: string;
  readonly filterMode: string;
  readonly anisotropyLimit: number;
  readonly toggles: Readonly<Record<ToggleName, boolean>>;
  readonly paths: CamPaths | null;
  readonly camEye: { x: number; y: number; z: number };
  readonly boxedClasses: ReadonlySet<number>;
  readonly boxedRigs: ReadonlySet<string>;
  readonly rigList: readonly RigSource[];
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
  readonly minimap: MinimapGraph | null;
  readonly feed: readonly FeedRow[];
  readonly hudRows: readonly StripRow[];
  readonly groups: Readonly<Record<DebugGroupName, readonly StripRow[]>>;
  readonly appScope: Scope;
  readonly stageLoadedAt: number;
  readonly hasSaved: boolean;
  /** How much rewindable history the snapshot ring is holding. */
  readonly history: HistoryView;
  readonly sound: SoundProjection;
  readonly skip: SkipProjection | null;
  readonly branch: BranchProjection | null;
  readonly transport: TransportProjection;
}

/**
 * This frame's projection, sharing everything it can with the last.
 *
 * `prev` is what the store is already holding. Every slice that has not
 * changed comes back as the same object, so `memo` in `ui/` is the diff —
 * see `app/projection/stable.ts`. The builder below is therefore free to
 * allocate: what it hands back is filtered through `stabilise`.
 */
export function buildProjection(v: PlayerView, ctx: RenderContext,
                                prev: UiProjection | null): UiProjection {
  const w = v.walker;
  const eye = v.camEye;
  return stabilise(prev, {
    stage: v.stage,
    // Held by reference and replaced rather than mutated, all three of them,
    // so `Object.is` settles them without a walk.
    stages: v.stages,
    original: v.original,
    loading: v.loading,
    status: v.status,
    bundleStale: v.bundleStale,
    paused: v.paused,
    // The walker's accessor, which reads `G.g_nFiringGate`. Off before there
    // is a walker at all, which is also what the engine's BSS says: the word
    // is zero until a stage script raises it.
    firingGate: w?.firingGate ?? false,
    toggles: v.toggles,
    transport: v.transport,
    sound: v.sound,
    lightMode: v.lightMode,
    fogMode: v.fogMode,
    filterMode: v.filterMode,
    anisotropyLimit: v.anisotropyLimit,
    pillarbox: v.pillarbox,
    // A slice nothing is showing is not built. Its *selection* still counts,
    // though — the highlight set is computed whatever the panels are showing.
    wait: w && v.wants("wait") ? waitProjection(w, eye) : null,
    waitBoxed: v.boxWait,
    actorPanel: v.wants("actors")
      ? actorsProjection(eye, v.boxedClasses, v.shutClasses) : null,
    // Built only while something is showing it: it walks every global and
    // every actor and formats them all.
    globals: v.wants("globals") ? globalsProjection() : null,
    // Also demand-gated: stage 2 has 335 rig instances and every one of
    // them is a row. The *selection* is not gated — the outlines follow
    // the ticks whether or not the panel that made them is open.
    rigs: v.wants("rigs") ? rigsProjection(v.rigList, v.boxedRigs) : null,
    tree: v.tree,
    minimap: v.minimap,
    current: w ? { block: w.block, step: w.step, op: w.opIndex } : null,
    feed: v.feed,
    inspector: w?.currentOp
      ? inspectorText(w.currentOp, { summary: opSummary(w.currentOp) }) : "",
    hudRows: v.hudRows,
    groups: v.groups,
    skip: v.skip,
    branch: v.branch,
    // The last ungated expensive slice. `snapshot()` walks the whole disposal
    // tree and allocates a plain object per scope, once a frame, whether or
    // not anything is showing it -- and the tree it walks grows with every
    // layer that starts owning its resources properly, so the cost was going
    // up as the rest of this review's work went in.
    scopes: v.wants("scopes") ? v.appScope.snapshot() : null,
    scopeContext: { frame: ctx.frame, stageLoadedAt: v.stageLoadedAt },
    hasSaved: v.hasSaved,
  });
}
