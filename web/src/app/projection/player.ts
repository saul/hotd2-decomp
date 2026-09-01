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
import type {
  BranchProjection, FeedRow, MinimapGraph, SkipProjection, SoundProjection,
  TransportProjection, TreeProjection, UiProjection,
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

const $ = <T extends HTMLElement>(sel: string): T =>
  document.querySelector(sel) as T;

/** Is a `<details>` panel open? A folded panel is not worth building. */
const open = (sel: string): boolean => !!$<HTMLDetailsElement>(sel)?.open;

export function buildProjection(v: PlayerView, ctx: RenderContext): UiProjection {
  const w = v.walker;
  const eye = v.camEye;
  return {
    revision: 0,
    stage: v.stage,
    stages: [...v.stages],
    original: v.original,
    loading: null,
    status: "",
    toggles: v.toggles,
    transport: v.transport,
    sound: v.sound,
    lightMode: v.lightMode,
    fogMode: v.fogMode,
    pillarbox: v.pillarbox,
    // A folded panel is not built. Its *selection* still counts, though —
    // the highlight set is computed whatever the panels are showing.
    wait: w && open("#panel-wait") ? waitProjection(w, eye) : null,
    actorPanel: open("#panel-actors")
      ? actorsProjection(eye, v.boxedClasses, v.shutClasses) : null,
    // Built only while the panel is open: it walks every global and every
    // actor and formats them all.
    globals: open("#globals-panel") ? globalsProjection() : null,
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
