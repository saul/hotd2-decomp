/**
 * The adapters.
 *
 * Two systems that are thin on purpose: they hold the seam between the port,
 * which knows nothing about three.js, and the player, which is all three.js.
 * Everything of substance is on the other side of them.
 */
import type { Context, System, Tick } from "../core/system";
import type { RenderContext } from "../render/context";
import type { CameraRig } from "../render/camera";
import { CamSeatPathFrame } from "../game/camera/path";
import { GameUpdate } from "../game/director";
import { ProcessShotRequests } from "../game/combat/shot";
import { ActorIsEnemy } from "../game/registry";
import { ActorByAt, G, ResetGameGlobals, RestoreGameGlobals, type Globals }
  from "../game/globals";
import type { GameHost, ShotPick, ShotRay } from "../game/host";
import type { Vec3 } from "../game/vec";
import type { CameraFrame } from "../core/camera";
import type { Walker } from "../script/walker";
import {
  RetireUnlistedActor, SpawnPropContainers, SpawnScriptedCharacters,
  type CharacterSpawnRequest,
} from "../game/director";
import type { Actor } from "../game/actor";
import type { Rng } from "../core/rng";

/** What the renderer answers for the port. See `game/host.ts`. */
export interface HostBackend {
  boneWorld(at: number, bone: number, out: Vec3): boolean;
  setBoneSlot(at: number, bone: number, slot: number): void;
  /**
   * `CamEvalObjectPath6` — a point *and its orientation* on an `op_` path.
   *
   * Six values because the engine's routine returns six: this interface said
   * three, so `GameHost.objectPath`'s optional `yaw` could never arrive and a
   * path rider kept its spawn facing. See `CharacterLayer.objectPath`.
   */
  objectPath?(slot: number, frame: number):
    { x: number; y: number; z: number;
      pitch?: number; yaw?: number; roll?: number } | null;
  /** `ShotTestSphere` — the nearest thing along one shot segment. */
  pickShot?(ray: ShotRay): ShotPick | null;
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
    // The hit spheres ride bones the renderer poses, so the intersection is
    // the renderer's; what a hit *means* is `game/combat/shot.ts`.
    pickShot: (ray) => this.backend?.pickShot?.(ray) ?? null,
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
    this.view = ctx.view;
    // `g_camera_yaw_bams` — class 0x31 wants the yaw on its own, not the whole
    // matrix: the leap aside builds its landing point with a bare
    // `MatrixRotateY` and the wall search refuses unless the actor faces
    // within 0x2000 of it. `ResolveHit`'s directional death reads it too.
    //
    // **Above the frozen return, because where the camera points is not a
    // function of elapsed time.** It was below, so the paused path drained the
    // shot queue against whatever yaw the last unpaused tick had left: pause,
    // turn to look at something, shoot it, and the kill picked its direction
    // from where you had been facing. Free roam turns the camera every frame
    // with the transport stopped, which is exactly the case that made it
    // visible.
    G.g_camera_yaw_bams = ctx.view.yawBams;
    if (t.frozen || t.dt <= 0) {
      // **A trigger pull is input, not elapsed time.** The player deliberately
      // lets you shoot with the transport stopped — `Player.wantsFrame` keeps
      // asking for frames while a shot's feedback is still in flight, and the
      // feed row for a shot fired while paused is half of what the step mode
      // is for. `GameUpdate` drains the queue at its head, but it is not going
      // to run on this tick, so the queue is drained here instead. Nothing
      // else about the frame happens: the shot lands, and the world does not
      // move under it.
      ProcessShotRequests(this.host, ctx.rng, ctx.events);
      return;
    }
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

/** What {@link CharacterBindSystem} and {@link syncCharacterSpawns} need. */
export interface CharacterPool {
  bindToPool(pool: readonly Actor[]): void;
  readySpawns(spawns: readonly { at: number }[]): CharacterSpawnRequest[];
  syncSpawns(spawns: readonly { at: number }[],
             made: readonly Actor[]): Actor[];
  rng: Rng;
}

/**
 * The character layer, rebound to the object pool.
 *
 * A snapshot load replaces every actor with a restored copy and a seek wipes
 * the pool outright, so after either the renderer's references are stale.
 * Binding rather than re-spawning is the whole point: a restored actor carries
 * its hit points, its severed bones and its state, and calling `ActorSpawn`
 * would throw all of it away.
 *
 * It is a system in the `game` phase rather than a line inside
 * `CharacterLayer.resync` because the pool is engine state and the lookup used
 * to be `ActorByAt` — an engine function called from `render/`. The `game`
 * phase resyncs before the `render` one, so the character layer still finds
 * itself bound by the time it redraws.
 */
export class CharacterBindSystem implements System {
  readonly id = "game.characters";
  constructor(private readonly chars: CharacterPool) {}
  resync(): void {
    this.chars.bindToPool(G.g_object_list);
  }
}

/**
 * The script's character spawns, made real.
 *
 * Three steps in three layers, and the split is the point of step 21. The
 * renderer says which adopted hierarchies the script is currently asking for
 * and where the exporter put them (`readySpawns`); the port builds the
 * objects, reading the descriptor tail and running each class's `Init`
 * (`SpawnScriptedCharacters`); the renderer binds its nodes to what came back
 * and hands over the ones the script has stopped listing, which the port
 * retires. `render/characters.ts` used to do all three, which put
 * `SpawnFromDescriptor`'s decisions in a layer no headless test can reach.
 */
export function syncCharacterSpawns(chars: CharacterPool,
                                    spawns: readonly { at: number }[]): void {
  const made = SpawnScriptedCharacters(chars.readySpawns(spawns), chars.rng);
  for (const a of chars.syncSpawns(spawns, made)) RetireUnlistedActor(a);
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
  G.g_cam_path_frame = w.cam ? Math.trunc(w.cam.frame) : 0;
  G.g_script_flags = [];
  for (const flag of w.flags) G.g_script_flags[flag] = 1;
  // The spawn opcode places a group the moment it runs, so this is only the
  // safety net for a spawn list restored by a snapshot load rather than by
  // an instruction. It is idempotent — `ActorByAt` refuses a second one.
  SpawnPropContainers(w.spawns);
}

/**
 * Seat the camera block on this frame of the shot the script is playing.
 *
 * **Why this lives in `app/` and not in `render/camera.ts`, where it used to.**
 * Seating the block is an engine decision: it evaluates a `cam/` curve and
 * writes `g_camera_block_eye` and `g_cam_path_target`, two globals a snapshot
 * carries. A renderer that calls `CamAdvancePathFrame` is the port being
 * driven from `render/`, which is exactly what `render-drives-the-port`
 * counts. The evaluation itself moved to `game/camera/curve.ts` — it is
 * Hermite maths over bundle keys and never needed three.js — and what is left
 * is composition: taking the walker's shot, the walker's roll flag and the
 * rig's two chrome toggles and handing them to `CamSeatPathFrame`. That is
 * this layer's whole job, and it is the same job `syncPortGlobals` above does.
 *
 * `force` seats the block even though the shot's action has retired. The
 * engine never needs it — it has no seek — but arriving at a deep link with an
 * eased look-at of (0,0,0) points the camera at the world origin.
 */
export function seatCamera(rig: CameraRig, ctx: RenderContext,
                           force = false): void {
  const w = ctx.walker;
  if (!w || !rig.scripted) return;
  const cam = w.cam;
  if (!cam) return;
  const p = ctx.paths?.paths.get(cam.slot);
  if (!p) return;
  const pose = CamSeatPathFrame(p, cam.frame, w.rollEnabled,
                                force || !cam.done || !rig.trackEnabled);
  // Roll is the one channel the camera block has no word for, so the draw
  // takes it off the pose the seat evaluated. See `CamSeatPathFrame`.
  rig.pose.roll = pose.roll;
}

/** Seat and draw in one go, for the paths that have no game tick between. */
export function syncCamera(rig: CameraRig, ctx: RenderContext,
                           force = false): void {
  seatCamera(rig, ctx, force);
  rig.draw(ctx);
}

/**
 * The first half of a camera frame, in the `script` phase: the shot writes the
 * camera block before the port's frame reads it.
 *
 * ## Why this refuses a frame that advances no game time
 *
 * Seating the block is the **first half** of a camera frame;
 * `CameraTrackEnemiesTick`, inside `GameSystem`, is the second, and it is the
 * half that eases the aim off the rail and onto whatever the fight wants. So
 * the two have to run together or not at all, and `GameSystem` already
 * refuses a tick with no time in it — this makes the same test, deliberately
 * spelled the same way.
 *
 * Without it the camera **flickered between two aims at the display's refresh
 * rate**, and only on a display faster than 60 Hz. `Player.frame` draws every
 * rAF but ticks at a fixed 60, so on a 120 Hz panel every other frame owes no
 * tick and takes the `tickStopped` path — which runs the whole tick order
 * with `Loop.idle`. This system seated the block back on the rail, `GameSystem`
 * returned early, and the draw put the *un-eased* aim on screen. One frame
 * eased, the next on the rail, sixty times a second: a stage-1 measurement put
 * it at 3.5 degrees each way with one enemy registered.
 *
 * Nothing else needed it. The seek, the stage load and the frame slider all
 * seat the block through `Player.syncCameraToWalker`, which calls
 * {@link syncCamera} directly and never went through this system; and the draw
 * still runs every rendered frame, because placing the three.js camera from a
 * block that has not changed is idempotent and a resize needs it.
 */
export class CameraSeatSystem implements System<RenderContext> {
  readonly id = "camera.seat";
  constructor(private readonly rig: CameraRig) {}

  update(ctx: RenderContext, t: Tick): void {
    if (!this.rig.driving) return;
    if (t.frozen || t.dt <= 0) return;
    seatCamera(this.rig, ctx);
  }

  /**
   * A load or a seek replaced the walker's camera command wholesale.
   *
   * `force`, because the restored shot's action may already have retired and
   * the eased look-at that came back with it has nothing to ease *from* until
   * the block is on the rail. This is the half `CameraDrawSystem.resync` used
   * to do for it, back when the rig could seat the block itself; the `script`
   * phase resyncs before the `render` one, so the draw still finds a seated
   * block.
   */
  resync(ctx: RenderContext): void {
    seatCamera(this.rig, ctx, true);
  }
}
