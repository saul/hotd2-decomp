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
}

/** One row of the port's data segment. */
export interface GlobalRow {
  name: string;
  value: string;
  /** `0x009A2BA0`, or empty when `globals.ts` cites none. */
  address: string;
}

export interface WaitProjection {
  /** `wait_enemies_alive`, `wait_scripted_actors`, … or null when running. */
  kind: string | null;
  detail: string;
  /** Who the wait is on. */
  blockers: ActorRow[];
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
  wait: WaitProjection;
  actors: ActorRow[];
  globals: GlobalRow[];
  scopes: ScopeRow | null;
  scopeContext: { frame: number; stageLoadedAt: number };
  /** Whether a snapshot is held, so Load can be enabled. */
  hasSaved: boolean;
}
