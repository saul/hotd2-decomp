/**
 * The adapters.
 *
 * Two systems that are thin on purpose: they hold the seam between the port,
 * which knows nothing about three.js, and the player, which is all three.js.
 * Everything of substance is on the other side of them.
 */
import type { Context, System, Tick } from "../core/system";
import { GameUpdate } from "../game/director";
import { ActorIsEnemy } from "../game/registry";
import { ActorByAt, G, ResetGameGlobals, RestoreGameGlobals, type Globals }
  from "../game/globals";
import type { GameHost } from "../game/host";
import type { Vec3 } from "../game/vec";
import type { CameraFrame } from "../core/camera";
import type { Walker } from "../script/walker";
import { SpawnPropContainers } from "../game/director";

/** What the renderer answers for the port. See `game/host.ts`. */
export interface HostBackend {
  boneWorld(at: number, bone: number, out: Vec3): boolean;
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
   * The camera, as the port sees it: `ctx.view`, held for the closures below.
   *
   * `update` is the only writer and it writes it every tick before it runs
   * the frame, so the host never reads one from a previous stage.
   */
  private view: CameraFrame | null = null;
  private readonly host: GameHost = {
    boneWorld: (at, bone, out) =>
      this.backend?.boneWorld(at, bone, out) ?? false,
    // `CamEvalObjectPath6`. The curves are in the camera bundle and their
    // evaluation is the renderer's, so the port asks across the seam rather
    // than carrying a Hermite evaluator of its own.
    objectPath: (slot, frame) => this.backend?.objectPath?.(slot, frame) ?? null,
    // The camera looks down its own local -Z, which is where the player is.
    aimPoint: (ahead, out) => this.view?.toWorld(0, 0, -ahead, out),
    // A point in the camera's own space, in world coordinates. The engine
    // unprojects a screen offset at a depth to get one -- see
    // `ThrowerPickLandingPoint`.
    viewPoint: (x, y, z, out) => this.view?.toWorld(x, y, z, out),
    // `obj+0x70/74/78`: the actor's tracked point in the camera's own space,
    // handed over exactly as the engine holds it. Camera-local -Z is forward
    // in three.js and in the engine both, so `toView` is already the right
    // sign and there is nothing to flip.
    //
    // It used to negate z and refuse an actor behind the camera. Neither
    // reader wanted that: `ActorIsOnScreen` divides by z with no sign test —
    // the bounds are symmetric, so an actor directly behind the camera reads
    // as on screen, and that is the engine's own behaviour — and the
    // knockback arc subtracts from the depth, where a flipped sign threw
    // bodies at the viewer instead of away.
    viewSpaceOf: (at, out) => {
      const a = ActorByAt(at);
      if (!a || !this.view) return false;              // no camera at all
      this.view.toView(a.lookAt.x, a.lookAt.y, a.lookAt.z, out);
      return true;
    },
    setBoneSlot: (at, bone, slot) => this.backend?.setBoneSlot(at, bone, slot),
  };

  /**
   * **Entering a scene.** `loadStageInto` calls `world.attach` and this is the
   * game's share of it, standing in for the engine's `FUN_00460030` — the
   * scene load, whose last act is `ResetSceneOnEnter` (`FUN_0045EDD0`).
   *
   * `ResetGameGlobals` is the port's own wrapper: it empties the object pools
   * the engine never has to, and calls `ResetSceneOnEnter` for the half that
   * is a real routine. Order matters and `stage_load.ts` says so — the tables
   * go in **after** this, because the reset zeroes the data segment.
   */
  attach(): void {
    ResetGameGlobals();
  }

  update(ctx: Context, t: Tick): void {
    if (t.frozen || t.dt <= 0) return;
    this.view = ctx.view;
    // `g_camera_yaw_bams` — class 0x31 wants the yaw on its own, not the whole
    // matrix: the leap aside builds its landing point with a bare
    // `MatrixRotateY` and the wall search refuses unless the actor faces
    // within 0x2000 of it.
    G.g_camera_yaw_bams = ctx.view.yawBams;
    // A copy, not the live one: the frame object `GameUpdate` builds holds
    // the reference for the whole pass, and `ctx.view.eye` is written again
    // next tick.
    const { x, y, z } = ctx.view.eye;
    GameUpdate({ x, y, z }, t.dt, this.host, ctx.rng, ctx.events);
    ctx.frame = Math.round(G.g_frame);
  }

  save(): unknown {
    return G;
  }

  load(slice: unknown): void {
    RestoreGameGlobals(slice as Globals);
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
    // `g_attack_committed` is the global latch: while one enemy is attacking
    // from **off screen**, `TryClaimAttackSlot` refuses everyone, including
    // the ones you can see. That reads on screen as a crowd parked in
    // `HoldAtRange` with a *free* permit, which is the one symptom this row
    // could not previously tell apart from a permit that leaked.
    const latched = G.g_attack_committed !== 0;
    return `${held} attacking${latched ? " · committed off screen" : ""}`
         + `${G.g_camera_is_tracking ? " · camera locked" : ""}`
         + ` · ${live} live`
         + (actors.length > live ? ` · ${actors.length - live} scripted` : "");
  }
}

/**
 * A layer whose `update` **is** its rebuild.
 *
 * `resync` is the same call, which is exactly the case `IDLE_TICK` in
 * `core/system.ts` describes: the state has been restored underneath the layer
 * and it should place itself against that state without a clock of its own.
 * `hud/hud.ts` is the one that qualifies outright — it holds no state at all,
 * so a load, a seek and an ordinary frame are one path.
 */
export function drawSystem<C extends Context>(id: string,
                                              draw: (ctx: C) => void)
    : System<C> {
  return { id, update: (ctx) => draw(ctx), resync: (ctx) => draw(ctx) };
}

/**
 * The two script-owned globals the port reads, and the spawns it needs.
 *
 * `g_camera_fixed_eye_y` is where class 0x41 puts a group's floor and what
 * `BreakablePropGroundContact` settles against. The camera opcode writes it
 * too, so a group placed during a seek replay gets the right floor; this
 * keeps it true for every other frame.
 */
export function syncPortGlobals(w: Walker, freeRoam: boolean,
                                eye: { x: number; y: number; z: number }): void {
  G.g_camera_fixed_eye_y = w.fixedEyeY;
  // `g_camera_block_eye` is the camera block's own eye, and `cam_play`
  // owns it — `CamAdvancePathFrame` writes it from the curve. Free roam has
  // no path and therefore no block, so there it is taken from the viewer's
  // camera instead, which is the only thing standing in for one.
  if (freeRoam) {
    G.g_camera_block_eye.x = eye.x;
    G.g_camera_block_eye.y = eye.y;
    G.g_camera_block_eye.z = eye.z;
  }
  // `ColiLoadForScene` indexes its file list with this, so it is zero-based
  // and scene 1 is stage 2.
  G.g_scene_index = w.script.scene ?? 0;
  // Class 0x24's set-pieces are choreographed against the camera: every one
  // of their removal and freeze triggers is a `cp_` slot plus a frame.
  G.g_active_cam_path = w.cam ? w.cam.slot : -1;
  // `g_scene_state_major_entered` — 0x009C6F08, and the first thing
  // `IsPlayerAttackable` (`FUN_00409DC0`) tests. The walker already tracks the
  // pair `EvtEnterSceneState` records; this is the half the combat code reads,
  // and without it here nothing in the game would ever be allowed to attack.
  G.g_scene_state_major_entered = w.sceneState.major;
  // `__ftol` -- both camera drivers end on `g_cam_path_frame = __ftol(...)`,
  // so this global is an **integer** that steps by exactly one a frame. The
  // walker's clock is a float (`dt * 60`), and handing that straight over
  // made every `===` test against it a coin toss: at a fixed 1/60 the value
  // stays integral and matches, but under a browser's variable frame time it
  // goes fractional and a cue frame is simply never equal to it. Class 0x10's
  // removal cue never fired, so a civilian never left `g_civilians_alive` and
  // `wait_scripted_actors` waited for ever.
  G.g_cam_path_frame_prev = G.g_cam_path_frame;
  G.g_cam_path_frame = w.cam ? Math.trunc(w.cam.frame) : 0;
  G.g_script_flags = [];
  for (const flag of w.flags) G.g_script_flags[flag] = 1;
  // The spawn opcode places a group the moment it runs, so this is only the
  // safety net for a spawn list restored by a snapshot load rather than by
  // an instruction. It is idempotent — `ActorByAt` refuses a second one.
  SpawnPropContainers(w.spawns);
}
