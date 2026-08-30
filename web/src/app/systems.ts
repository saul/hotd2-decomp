/**
 * The adapters.
 *
 * Two systems that are thin on purpose: they hold the seam between the port,
 * which knows nothing about three.js, and the player, which is all three.js.
 * Everything of substance is on the other side of them.
 */
import { Matrix4, Vector3 } from "three";
import type { Context, System, Tick } from "../core/system";
import { GameUpdate } from "../game/director";
import { G, ResetGameGlobals, RestoreGameGlobals, type Globals }
  from "../game/globals";
import type { GameHost } from "../game/host";
import type { Vec3 } from "../game/vec";
import type { Walker } from "../script/walker";

/** What the renderer answers for the port. See `game/host.ts`. */
export interface HostBackend {
  boneWorld(at: number, bone: number, out: Vector3): boolean;
  setBoneSlot(at: number, bone: number, slot: number): void;
}

/**
 * The script's slice: the walker's program counter, flags and channels.
 *
 * The walker is stepped by `app/loop.ts` rather than here, because it is the
 * thing that decides when a tick stops — but its state is still a slice, and
 * this is what puts it in the snapshot.
 */
export class ScriptSystem implements System {
  readonly id = "script";
  walker: Walker | null = null;

  save(): unknown {
    return this.walker?.saveState() ?? null;
  }

  load(slice: unknown): void {
    if (slice) this.walker?.loadState(slice);
  }
}

/**
 * The port, as a system.
 *
 * `save` hands back the whole data segment and `load` writes it back over the
 * live one. That is the entire implementation, and it is short because the
 * port keeps its state where the engine keeps its state.
 */
export class GameSystem implements System {
  readonly id = "game";
  /** Filled in by the host once the character layer exists. */
  backend: HostBackend | null = null;

  /** Whether the camera should use the tracked look-at this frame. */
  tracking = false;
  readonly lookAt = new Vector3();

  private readonly _eye = new Vector3();
  private readonly _bone = new Vector3();
  private readonly _camMat = new Matrix4();
  private readonly host: GameHost = {
    boneWorld: (at, bone, out) => {
      if (!this.backend?.boneWorld(at, bone, this._bone)) return false;
      out.x = this._bone.x; out.y = this._bone.y; out.z = this._bone.z;
      return true;
    },
    // The camera looks down its own local -Z, which is where the player is.
    aimPoint: (ahead, out) => {
      const p = new Vector3(0, 0, -ahead).applyMatrix4(this._camMat);
      out.x = p.x; out.y = p.y; out.z = p.z;
    },
    setBoneSlot: (at, bone, slot) => this.backend?.setBoneSlot(at, bone, slot),
  };

  attach(): void {
    ResetGameGlobals();
    this.tracking = false;
  }

  update(ctx: Context, t: Tick): void {
    if (t.frozen || t.dt <= 0) return;
    this._camMat.copy(ctx.camera.matrixWorld);
    ctx.camera.getWorldPosition(this._eye);
    const eye: Vec3 = { x: this._eye.x, y: this._eye.y, z: this._eye.z };
    const r = GameUpdate(eye, t.dt, this.host, ctx.rng, ctx.events);
    this.tracking = r.tracking;
    this.lookAt.set(r.lookAt.x, r.lookAt.y, r.lookAt.z);
    ctx.frame = Math.round(G.g_frame);
  }

  save(): unknown {
    return G;
  }

  load(slice: unknown): void {
    RestoreGameGlobals(slice as Globals);
    this.tracking = G.g_camera_lookat_valid;
    this.lookAt.set(G.g_camera_lookat_target.x, G.g_camera_lookat_target.y,
                    G.g_camera_lookat_target.z);
  }

  /** What the inspector shows. Derived, so it is not in the snapshot. */
  get describe(): string {
    const live = G.g_object_list.filter((o) => !o.dead && o.visible).length;
    if (!live) return "idle";
    const held = G.g_attack_permits.filter((p) => p !== -1).length;
    return `${held} attacking${G.g_camera_is_tracking ? " · camera locked" : ""}`
         + ` · ${live} live`;
  }
}
