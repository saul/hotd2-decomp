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
import type { CamPaths } from "../../render/campath";
import type { ToggleName } from "../../ui/commands";
import type { UiSlice } from "../../ui/store";
import type {
  BranchProjection, FeedRow, LoadingProjection, MinimapGraph, SkipProjection,
  SoundProjection, StatusProjection, TransportProjection, TreeProjection,
  UiProjection,
} from "../../ui/projection";
import { actorsProjection, waitProjection } from "./sidebar";
import { globalsProjection } from "./globals";
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
  /** The clock is stopped and the viewer is meant to notice. */
  readonly paused: boolean;
  readonly mode: "play" | "step" | "free";
  readonly playing: boolean;
  readonly speed: number;
  readonly frozen: boolean;
  readonly pillarbox: boolean;
  readonly lightMode: string;
  readonly fogMode: string;
  readonly toggles: Readonly<Record<ToggleName, boolean>>;
  readonly paths: CamPaths | null;
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
  readonly treeVersion: number;
  readonly minimap: MinimapGraph | null;
  readonly feed: readonly FeedRow[];
  readonly feedVersion: number;
  readonly hudRows: readonly [string, string, boolean?][];
  readonly appScope: Scope;
  readonly stageLoadedAt: number;
  readonly hasSaved: boolean;
  readonly sound: SoundProjection;
  readonly skip: SkipProjection | null;
  readonly branch: BranchProjection | null;
  readonly transport: TransportProjection;
}

export function buildProjection(v: PlayerView, ctx: RenderContext): UiProjection {
  const w = v.walker;
  const eye = v.camEye;
  return {
    revision: 0,
    stage: v.stage,
    stages: [...v.stages],
    original: v.original,
    loading: v.loading,
    status: v.status,
    paused: v.paused,
    toggles: v.toggles,
    transport: v.transport,
    sound: v.sound,
    lightMode: v.lightMode,
    fogMode: v.fogMode,
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
    tree: v.tree,
    minimap: v.minimap,
    treeVersion: v.treeVersion,
    current: w ? { block: w.block, step: w.step, op: w.opIndex } : null,
    feed: [...v.feed],
    feedVersion: v.feedVersion,
    inspector: w?.currentOp
      ? inspectorText(w.currentOp, { summary: opSummary(w.currentOp) }) : "",
    hudRows: [...v.hudRows],
    skip: v.skip,
    branch: v.branch,
    scopes: v.appScope.snapshot(),
    scopeContext: { frame: ctx.frame, stageLoadedAt: v.stageLoadedAt },
    hasSaved: v.hasSaved,
  };
}

/**
 * What decides whether the projection is published at all.
 *
 * The whole value, minus the three things that are too big to walk sixty
 * times a second: the tree is thousands of rows that change only on a stage
 * load, the feed is up to four hundred that only grow, and the minimap graph
 * is per stage. All three carry a version instead.
 *
 * Same cost as the string compare each panel used to do for itself, done
 * once — and unlike a hand-listed set of fields it cannot go stale the first
 * time one is added.
 */
export function projectionKey(p: UiProjection): string {
  return JSON.stringify({ ...p, tree: null, feed: null, minimap: null });
}
