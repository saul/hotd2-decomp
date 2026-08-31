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
import { ActorIsEnemy } from "../game/registry";
import { ActorByAt, G, ResetGameGlobals, RestoreGameGlobals, type Globals }
  from "../game/globals";
import type { GameHost } from "../game/host";
import type { Vec3 } from "../game/vec";
import type { Walker } from "../script/walker";

/** What the renderer answers for the port. See `game/host.ts`. */
export interface HostBackend {
  boneWorld(at: number, bone: number, out: Vector3): boolean;
  setBoneSlot(at: number, bone: number, slot: number): void;
  /** `CamEvalObjectPath6` — a point on an `op_` path, for class 0x25. */
  objectPath?(slot: number, frame: number):
    { x: number; y: number; z: number } | null;
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

  /**
   * `g_camera_block_target` for the renderer: where the camera is looking
   * after this frame's ease. There is no "is it tracking" question any more —
   * `SelectCameraLookAtTarget` falls back to the path's own target and the
   * ease runs either way, which is what stops the aim snapping when the last
   * enemy dies.
   */
  readonly lookAt = new Vector3();

  private readonly _eye = new Vector3();
  private readonly _bone = new Vector3();
  private readonly _fwd = new Vector3();
  private readonly _camMat = new Matrix4();
  private readonly _camInv = new Matrix4();
  private readonly host: GameHost = {
    boneWorld: (at, bone, out) => {
      if (!this.backend?.boneWorld(at, bone, this._bone)) return false;
      out.x = this._bone.x; out.y = this._bone.y; out.z = this._bone.z;
      return true;
    },
    // `CamEvalObjectPath6`. The curves are in the camera bundle and their
    // evaluation is the renderer's, so the port asks across the seam rather
    // than carrying a Hermite evaluator of its own.
    objectPath: (slot, frame) => this.backend?.objectPath?.(slot, frame) ?? null,
    // The camera looks down its own local -Z, which is where the player is.
    aimPoint: (ahead, out) => {
      const p = new Vector3(0, 0, -ahead).applyMatrix4(this._camMat);
      out.x = p.x; out.y = p.y; out.z = p.z;
    },
    // A point in the camera's own space, in world coordinates. The engine
    // unprojects a screen offset at a depth to get one -- see
    // `ThrowerPickLandingPoint`.
    viewPoint: (x, y, z, out) => {
      const p = new Vector3(x, y, z).applyMatrix4(this._camMat);
      out.x = p.x; out.y = p.y; out.z = p.z;
    },
    // `obj+0x70/74/78`: the actor's tracked point in the camera's own space.
    // Camera-local -Z is forward, and `ActorIsOnScreen` divides by z, so the
    // depth is handed over positive.
    viewSpaceOf: (at, out) => {
      const a = ActorByAt(at);
      if (!a) return false;
      const p = new Vector3(a.lookAt.x, a.lookAt.y, a.lookAt.z)
        .applyMatrix4(this._camInv);
      if (p.z >= 0) return false;                      // behind the camera
      out.x = p.x; out.y = p.y; out.z = -p.z;
      return true;
    },
    setBoneSlot: (at, bone, slot) => this.backend?.setBoneSlot(at, bone, slot),
  };

  attach(): void {
    ResetGameGlobals();
  }

  update(ctx: Context, t: Tick): void {
    if (t.frozen || t.dt <= 0) return;
    this._camMat.copy(ctx.camera.matrixWorld);
    this._camInv.copy(ctx.camera.matrixWorldInverse);
    ctx.camera.getWorldPosition(this._eye);
    const eye: Vec3 = { x: this._eye.x, y: this._eye.y, z: this._eye.z };
    // `g_camera_yaw_bams` — class 0x31 wants the yaw on its own, not the whole
    // matrix: the leap aside builds its landing point with a bare
    // `MatrixRotateY` and the wall search refuses unless the actor faces
    // within 0x2000 of it.
    ctx.camera.getWorldDirection(this._fwd);
    G.g_camera_yaw_bams =
      (Math.round(Math.atan2(this._fwd.x, this._fwd.z) * 65536 / (Math.PI * 2))
       % 65536 + 65536) % 65536;
    const r = GameUpdate(eye, t.dt, this.host, ctx.rng, ctx.events);
    this.lookAt.set(r.lookAt.x, r.lookAt.y, r.lookAt.z);
    ctx.frame = Math.round(G.g_frame);
  }

  save(): unknown {
    return G;
  }

  load(slice: unknown): void {
    RestoreGameGlobals(slice as Globals);
    this.lookAt.set(G.g_camera_block_target.x, G.g_camera_block_target.y,
                    G.g_camera_block_target.z);
  }

  /** What the inspector shows. Derived, so it is not in the snapshot. */
  get describe(): string {
    // "live" means enemies, the way `g_enemies_alive` does. Counting every
    // actor was fine while the pool held only enemies; it now holds
    // set-pieces and scripted humanoids too, and a row that says 22 live when
    // the gate sees 8 is a row that sends you looking in the wrong place.
    const actors = G.g_object_list.filter((o) => !o.dead && o.visible);
    const live = actors.filter((o) => ActorIsEnemy(o.cls)).length;
    if (!actors.length) return "idle";
    const held = G.g_attack_permits.filter((p) => p !== -1).length;
    return `${held} attacking${G.g_camera_is_tracking ? " · camera locked" : ""}`
         + ` · ${live} live`
         + (actors.length > live ? ` · ${actors.length - live} scripted` : "");
  }
}
