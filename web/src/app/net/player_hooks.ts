/**
 * The player, as netplay sees it: what the host reads off the running game,
 * and what the replica does with the host's.
 *
 * A module of functions over `Player`, the way `stage_load.ts` is, rather
 * than more of `main.ts`: this is the one place the session meets the
 * player's internals, and it is worth being able to read in one sitting.
 *
 * **What the replica must never do is write the state itself.** Its `G` is the
 * host's, applied a tick at a time, and every tick is checked against the
 * host's hash. So its world holds dormant everything that writes state (the
 * game update, the rain, the gun lights' build -- `World.setDormant`), the
 * player skips the script-phase work (`pushPortGlobals`), and the gun sends
 * its input to the host instead of into `G`. Anything left that still writes
 * shows up as a hash mismatch on the next tick, with its section named.
 */
import { SNAPSHOT_VERSION, type Snapshot } from "../../core/snapshot";
import type { EventMap } from "../../core/events";
import type { HoldReason } from "../../core/net/protocol";
import { SCHEMA_HASH } from "../../bundle/schema_hash";
import { BUILDER_HASH } from "../../bundle/builder_hash";
import { G } from "../../game/globals";
import { PROJECTION_DISTANCE_PX } from "../../game/scene_lights";
import type { Player } from "../main";
import type { HostSim } from "./host";
import type { ReplicaSim } from "./replica";
import type { NetPlayerHooks, NetRole } from "./session";
import { buildId } from "./build";

type Obj = Record<string, unknown>;

/** The live state as `world.save()` lays it out, uncloned. */
export function liveRoot(p: Player): Obj {
  const parts: Obj = {};
  for (const s of p.world.systems()) {
    if (s.save) parts[s.id] = s.save();
  }
  return { frame: p.ctx.frame, rng: p.rng.state, parts };
}

/** Why the host's clock is not running. */
function hold(p: Player): HoldReason {
  if (p.loading) return "loading";
  if (typeof document !== "undefined" && document.hidden) return "hidden";
  if (p.state.mode === "free") return "free-roam";
  if (!p.playing) return "paused";
  if (p.walker?.branch) return "branch";
  return null;
}

export function makeNetHooks(p: Player): NetPlayerHooks {
  const hostSim: HostSim = {
    stage: () => ({
      stage: p.state.stage,
      original: !!p.state.original,
      builder: p.bundles.find(p.state.stage, !!p.state.original)?.entry.builder,
    }),
    liveRoot: () => liveRoot(p),
    hold: () => hold(p),
    branch: () => {
      const b = p.walker?.branch;
      return b ? `route ${b.targets.join(" or ")}` : null;
    },
    view: () => G.g_camera_view_to_world,
    projectionDistance: PROJECTION_DISTANCE_PX,
  };

  const replicaSim: ReplicaSim = {
    load: async (stage, original, builder) => {
      await p.refreshStages();
      const slot = p.bundles.find(stage, original);
      if (!slot && !p.canBuild) {
        return `this page has no stage ${stage}${original ? " (Original Mode)" : ""}`;
      }
      if (builder && slot?.entry.builder && slot.entry.builder !== builder) {
        return `this page's stage ${stage} was built by exporter `
          + `${slot.entry.builder.slice(0, 8)}, the host's by ${builder.slice(0, 8)}`;
      }
      p.state.stage = stage;
      p.state.original = original;
      p.state.block = p.state.step = p.state.op = undefined;
      p.state.slot = p.state.frame = undefined;
      await p.loadStage();
      if (p.state.stage !== stage || !p.walker) return `stage ${stage} did not load`;
      return null;
    },
    install: (root) => installKeyframe(p, root),
    root: () => p.netRoot!,
    afterApply: (touched) => afterApply(p, touched),
    dispatch: (name, payload) => {
      p.events.emit(name as keyof EventMap, payload as never);
    },
    wake: () => p.wake(),
  };

  return {
    identity: () => ({
      snapshot: SNAPSHOT_VERSION, build: buildId(),
      bundle: BUILDER_HASH, schema: SCHEMA_HASH,
    }),
    hostSim,
    replicaSim,
    roleChanged: (role: NetRole) => p.netRoleChanged(role),
    // Player 2's gun, pointed off the screen: the cabinet's gun put down.
    // Their player plays on as the game plays any player nobody is aiming.
    peerGone: () => { G.g_aim_on_screen[1] = 0; },
    wake: () => p.wake(),
  };
}

/**
 * A keyframe, installed: the same `World.load` a snapshot takes, adopting the
 * decoded objects as `G`'s rather than cloning them, so the deltas after it
 * land on the very objects the render layers are bound to.
 */
function installKeyframe(p: Player, root: Obj): string | null {
  const parts = root.parts as Obj | undefined;
  if (!parts || typeof root.frame !== "number" || typeof root.rng !== "number") {
    return "a keyframe without a frame, an rng and parts";
  }
  // The walker takes its own copy: its `loadState` keeps the arrays it is
  // handed, and the replica's copy of the slice must stay the replica's.
  const handed: Obj = {};
  for (const [id, slice] of Object.entries(parts)) {
    handed[id] = id === "game" ? slice : structuredClone(slice);
  }
  const snap: Snapshot = {
    version: SNAPSHOT_VERSION, stage: p.ctx.stage, frame: root.frame,
    rng: root.rng, parts: handed,
  };
  const err = p.loadSnapshot(snap, { adopt: true });
  if (err) return err;
  // `G` now holds the decoded objects; the tree the deltas go into is the
  // same tree with `G` itself at `parts.game`, so a delta that replaces a
  // global replaces it on `G`.
  parts.game = G;
  p.netRoot = root;
  p.replicaStreaming(true);
  p.syncBgmToWalker();
  p.netBgmKey = bgmKey(p);
  return null;
}

function bgmKey(p: Player): string {
  const w = p.walker;
  return w ? `${w.bgmTrack}|${w.loopingSe.join(",")}` : "";
}

/** A delta applied: the envelope, the script's slice, and what follows from them. */
function afterApply(p: Player, touched: Set<string>): void {
  const root = p.netRoot;
  if (!root) return;
  p.ctx.frame = root.frame as number;
  p.rng.state = (root.rng as number) >>> 0;
  const parts = root.parts as Obj;
  // Every slice but the game's is a copy the system is handed; the game's is
  // `G`, written in place.
  for (const s of p.world.systems()) {
    if (!s.load || s.id === "game") continue;
    if (!touched.has(`parts.${s.id}`)) continue;
    s.load(structuredClone(parts[s.id]), p.ctx);
  }
  if (touched.has("parts.script")) {
    p.replicaStreaming(false);
    const key = bgmKey(p);
    if (key !== p.netBgmKey) {
      p.netBgmKey = key;
      p.syncBgmToWalker();
    }
  }
  // The actors the render layers draw, rebound: a delta adds, removes and
  // reorders the pool, and the character layer holds references into it.
  p.chars.bindToPool(G.g_object_list);
}
