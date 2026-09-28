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
import type { CamPaths } from "../game/camera/curve";
import { GameUpdate } from "../game/director";
import { SceneLightArrayUpdate } from "../game/scene_lights";
import { ActorIsEnemy } from "../game/registry";
import type { PlayerBlock } from "../game/player_shell";
import { ActorByAt, G, ResetGameGlobals, RestoreGameGlobals, type Globals }
  from "../game/globals";
import type { GameHost, ShotPick, ShotRay } from "../game/host";
import type { Vec3 } from "../game/vec";
import { CameraFrame } from "../core/camera";
import type { Walker } from "../script/walker";
import {
  RetireUnlistedActor, SpawnPropContainers, SpawnScriptedCharacters,
  SlotActorsForgetUnlisted, SpawnSlotActor,
  type CharacterSpawnRequest, type ScriptSpawn,
} from "../game/director";
import type { Actor } from "../game/actor";
import { SpawnHordePlacers } from "../game/class40";
import { T } from "../game/tables";
import type { Rng } from "../core/rng";
import type { Events } from "../core/events";

/** What the renderer answers for the port. See `game/host.ts`. */
export interface HostBackend {
  boneWorld(at: number, bone: number, out: Vec3): boolean;
  /** One bone's world matrix, `Matrix4.elements`. See `GameHost.boneMatrix`. */
  boneMatrix?(at: number, bone: number, out: number[]): boolean;
  /** One bone's hit sphere in world space. See `GameHost.boneSphere`. */
  boneSphereWorld?(at: number, bone: number, out: Vec3): number | null;
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
  /** The stage's camera paths, held for `camPath` the same way. */
  private paths: CamPaths | null = null;
  private readonly host: GameHost = {
    boneWorld: (at, bone, out) =>
      this.backend?.boneWorld(at, bone, out) ?? false,
    boneMatrix: (at, bone, out) =>
      this.backend?.boneMatrix?.(at, bone, out) ?? false,
    boneSphere: (at, bone, out) =>
      this.backend?.boneSphereWorld?.(at, bone, out) ?? null,
    // The two matrices of the engine's camera block. `ctx.view` already holds
    // both; the carried props cross between the spaces with them.
    cameraMatrices: (w2v, v2w) => {
      if (!this.view) return false;
      this.view.copyMatrices(w2v, v2w);
      return true;
    },
    // `CamEvalObjectPath6`. The curves are in the camera bundle and their
    // evaluation is the renderer's, so the port asks across the seam rather
    // than carrying a Hermite evaluator of its own.
    objectPath: (slot, frame) => this.backend?.objectPath?.(slot, frame) ?? null,
    // A `cp_` path by global slot, for the port's own `CamEvalPath7` calls --
    // the game-over fly-over's. The curves are the camera bundle's.
    camPath: (slot) => this.paths?.paths.get(slot) ?? null,
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
    // The same transform as `viewSpaceOf`, for a point nothing owns: an
    // impact sprite's size and the muzzle effects' aim both come from it.
    viewSpaceOfPoint: (p, out) => {
      if (!this.view) return false;
      this.view.toView(p.x, p.y, p.z, out);
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
    ResetGameGlobals(this.carry ?? undefined);
    this.carry = null;
  }

  /**
   * The player block a stage step carries into the next stage's reset, taken
   * by `Player.advanceScene` just before the load. `null` for every other
   * load, which is a new game started from the title.
   */
  carry: PlayerBlock | null = null;

  /**
   * `SceneLightArrayUpdate` (`FUN_00480970`) against *view* -- the camera this
   * frame is drawn with, which is not the one the port's own frame read (see
   * `GunLightBuildSystem`). Every other closure of the host is the port's.
   */
  buildGunLights(view: CameraFrame): void {
    SceneLightArrayUpdate({
      ...this.host,
      viewPoint: (x, y, z, out) => view.toWorld(x, y, z, out),
    });
  }

  update(ctx: Context, t: Tick): void {
    this.view = ctx.view;
    this.paths = (ctx as Partial<RenderContext>).paths ?? null;
    // `g_camera_yaw_bams` — class 0x31 wants the yaw on its own, not the whole
    // matrix: the leap aside builds its landing point with a bare
    // `MatrixRotateY` and the wall search refuses unless the actor faces
    // within 0x2000 of it. `ResolveHit`'s directional death reads it too.
    //
    // **Above the frozen return, because where the camera points is not a
    // function of elapsed time.** It was below, and the paused path then
    // drained the shot queue against whatever yaw the last unpaused tick had
    // left: pause, turn to look at something, shoot it, and the kill picked
    // its direction from where you had been facing. That drain is gone — see
    // below — so what still wants this line is everything else that reads the
    // yaw while the transport is stopped: the globals panel, and a snapshot
    // taken in free roam, which turns the camera every frame with no tick
    // under it.
    G.g_camera_yaw_bams = ctx.view.yawBams;
    // ...and the pitch beside it: the horde's dive lifts its arc by it.
    G.g_camera_block_pitch_bams = ctx.view.pitchBams;
    // ...and the eye, `g_camera_eye_x/y/z`, for the one kind of routine that
    // runs with no `ClassFrame`: the two combat `Init`s seed the head aim
    // toward it. Here and not in the script phase where the spawns run,
    // because `ctx.view` is the camera this tick is played against and is not
    // in a snapshot -- written earlier, from the camera the last draw left, a
    // load's first frame read the pre-load camera and replayed differently.
    // So a spawn reads what the previous tick wrote, which `G` carries.
    G.g_camera_eye.x = ctx.view.eye.x;
    G.g_camera_eye.y = ctx.view.eye.y;
    G.g_camera_eye.z = ctx.view.eye.z;
    // The gun lights are **not** built here -- see `GunLightBuildSystem`.
    // **And nothing else.** A frame that owes no tick must not do part of one,
    // and resolving a shot is the whole of a game-time job: `ResolveHit` takes
    // hit points off, `ScoreAddForPlayer` pays, and `PlayerShotEffectSpawn`
    // fills three rings that only `ShotEffectsTick` — which runs on this same
    // tick, one line down — can ever empty again.
    //
    // This branch used to drain `g_shot_requests` anyway, on the argument that
    // a trigger pull is input rather than elapsed time. The argument does not
    // survive the case it was made for: **step mode never reaches this
    // branch.** Stepping stops the *script* and runs the port at full rate, so
    // its ticks carry time and take the path below — the debug capability is
    // the live path, not this one. What this branch actually served was
    // paused, free roam and `?freeze=1`, where the shot landed a hit, killed
    // the actor, scored it, and hung its muzzle flash and its blood on screen
    // for as long as the transport stayed stopped, because nothing was
    // stepping them. That is the "shots still register when paused" report.
    //
    // The pull is left on the queue rather than dropped here: whether a click
    // is input at all is the transport's question, and `app/main.ts` answers
    // it at the one place intent enters `G`. What is left over is a pull made
    // in the instant between a playing frame and a pause, which is input the
    // clock genuinely owed, and it resolves on the frame the clock restarts.
    if (t.frozen || t.dt <= 0) return;
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
                                    spawns: readonly ScriptSpawn[],
                                    events?: Events): void {
  // **In the script's order**, the character spawns and the ones the
  // character pool can never make (their model is an asset slot and they have
  // no character type — see `SpawnSlotActors`) interleaved. The engine's
  // `SpawnFromDescriptor` (`FUN_00408A20`) makes one object per descriptor as
  // the instruction runs, so an `Init` that reads what the spawn before it
  // left behind reads exactly that. Stage 3's boat is the case that showed:
  // one `spawn_obj_c` places the class-0x13 boat and then its civilian, whose
  // `CivilianInit` copies `g_civilian_carrier` — and with every character
  // built before every slot actor, the civilian and the class-0x18 riders
  // copied the carrier of *no* boat and were drawn at their boat-relative
  // offsets from the world origin. Same `chars.rng` throughout, because the
  // engine draws from one `rand()` and every spawn on this frame is on the
  // same stream.
  //
  // A civilian's captors are not in the script's list at all: `CivilianInit`
  // (`FUN_0048A3E0`) makes them itself, so they come straight after the
  // civilian that holds them — and, being made in its `Init`, they see the
  // same `g_civilian_carrier` it did. Any left over (a captor whose civilian
  // was made on an earlier frame) are made last.
  const reqs = chars.readySpawns(spawns);
  const ready = new Map(reqs.map((r) => [r.at, r]));
  const listed = new Set(spawns.map((s) => s.at));
  const made: Actor[] = [];
  const done = new Set<number>();
  const make = (r: CharacterSpawnRequest): void => {
    if (done.has(r.at)) return;
    done.add(r.at);
    made.push(...SpawnScriptedCharacters([r], chars.rng, events));
    for (const c of reqs) {
      if (c.parentAt === r.at && !listed.has(c.at)) make(c);
    }
  };
  SlotActorsForgetUnlisted(spawns);
  // Class 0x40's placers are built per instruction rather than per address,
  // ahead of the rest -- see `SpawnHordePlacers`. They read nothing another
  // spawn leaves behind, so building them first changes nothing they do.
  SpawnHordePlacers(spawns, T.chars?.placements ?? [], chars.rng);
  for (const s of spawns) {
    const r = ready.get(s.at);
    if (r) make(r);
    else SpawnSlotActor(s, chars.rng);
  }
  for (const r of reqs) make(r);
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
  // ...and the live one beside it, which the walker does not keep apart --
  // see `g_scene_state_major` in `game/globals.ts`.
  G.g_scene_state_major = w.sceneState.major;
  // `__ftol` -- both camera drivers end on `g_cam_path_frame = __ftol(...)`,
  // so this global is an **integer** that steps by exactly one a frame. The
  // walker's clock is a float (`dt * 60`), and handing that straight over
  // made every `===` test against it a coin toss: at a fixed 1/60 the value
  // stays integral and matches, but under a browser's variable frame time it
  // goes fractional and a cue frame is simply never equal to it. Class 0x10's
  // removal cue never fired, so a civilian never left `g_civilians_alive` and
  // `wait_scripted_actors` waited for ever.
  G.g_cam_path_frame = w.cam ? Math.trunc(w.cam.frame) : 0;
  // `g_script_flags` is **not** copied here any more, and that is the point.
  // The walker used to keep its own `Set` of the flags `set_script_flag` had
  // raised and this line rebuilt `G.g_script_flags` from it once a frame — so
  // every flag an actor raised (`CivilianRunScript` op 0x1C,
  // `ZombieStateTargetScriptWithFlag`) lasted until the next tick and no
  // longer, and `wait_script_flag` could only ever see the script's own.
  // There is one array, in `game/globals.ts`, and both halves write it.
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
  // **The game-over screen's camera is the port's.** Phase 0 of
  // `GameOverRunPhase` replaces the scene's task list, so the queued camera
  // action the walker's shot stands for is gone, and `GameOverCameraFlyTick`
  // writes the block itself -- level, roll 0.
  if (G.g_stage_unloaded !== 0) {
    rig.pose.roll = 0;
    return;
  }
  // **A shot that has run out moves to where the next one picks up.**
  //
  // `FUN_00402890` and `FUN_00402740`, the two row-5 camera hooks, both open
  // with `if (g_cam_path_frames_left < 0 && g_evt_cam_override_valid)
  // FUN_00403DB0(...)`, and that routine re-seats `g_active_cam_path` and the
  // path frame from the `(path, frame)` pair `g_script_branch_var` selects out
  // of the last `store_six`. So the camera does not hold its own last frame
  // through a fight; it sits at the frame the script has already said the next
  // shot continues from, and the join is seamless.
  //
  // It lives here rather than in `game/` because the port's shot is the
  // walker's `CamCommand`, not `g_active_cam_path` — the composition root is
  // the layer that can see both. [diverges] the engine tests
  // `g_cam_path_frames_left < 0`, strictly past the end; `cam.done` is true at
  // the end, so the re-seat happens one frame earlier here. Both spend the
  // whole wait at the same frame, which is what is on screen.
  //
  // **`CamCommand.retired` is now exactly that test**, and closing this
  // divergence is one token — `cam.retired` here. It is deliberately not
  // taken: `CamAdvancePathFrame` writes `g_cam_path_frames_left = end - cur`
  // *before* `cur++`, so on the end frame it is 0 and only the tick after is
  // it negative, which is `retired` and not `done`. What that would change is
  // which frame a branch's preview shot arms on, at every `store_six` in the
  // game — a second behaviour change, and one nothing has reported. The cost
  // of leaving it is that a shot whose end lands while `camOverrideValid` is
  // up still loses its last frame to the override, which is the same one-tick
  // error `retired` was added to fix, in the one place it is not fixed.
  const over = cam.done && w.camOverrideValid
    ? w.branchPreview?.[w.branchChoice] ?? null : null;
  const slot = over?.slot ?? cam.slot;
  const at = over ? over.frame : cam.frame;
  const p = ctx.paths?.paths.get(slot);
  if (!p) return;
  // **The override writes the path pose and nothing else.** `FUN_00403DB0`
  // calls `CamEvalPath7` into `g_cam_path_eye` / `g_cam_path_target` -- the
  // path's own pose -- and never touches the camera block. The block reaches
  // it the only way it ever reaches anything: `CameraEaseBlockEyeToPathPose`
  // eases the eye and `TurnLookAtToward` eases the aim, both inside the same
  // hook, one frame at a time. So `advance` stays false here; forcing it
  // hard-wrote the block and simply moved the 27-degree cut one frame earlier.
  //
  // **`retired`, not `done`.** `CamAdvancePathFrame` (`FUN_004035E0`)
  // evaluates the curve into the camera block *before* it tests the end and
  // retires, so the frame a shot ends on is written like any other and only
  // the frame after it is not -- the two flags differ by exactly that tick.
  // Seating on `!done` dropped it: the block held frame `end - 1`'s pose while
  // everything else read `end`, and the next shot then moved the eye by two or
  // three frames' travel in one. See `CamCommand.retired`.
  const pose = CamSeatPathFrame(p, at, w.rollEnabled,
                                force || (!over && !cam.retired)
                                      || !rig.trackEnabled);
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

/**
 * `SceneLightArrayUpdate` (`FUN_00480970`), run against the camera **this
 * frame is drawn with**.
 *
 * The port's frame reads the camera through `ctx.view`, which
 * `CameraTakeSystem` fills from the three.js camera as the *last* draw left
 * it -- a frame behind the block, deliberately, because the gameplay has
 * always run against that. The gun lights cannot: they are placed one unit in
 * front of the eye and aimed out of it, and against a matrix one frame old
 * their origin trailed a moving camera by a frame's travel. On a display
 * faster than 60 Hz only every other rAF owes a game tick, so the trail came
 * and went at the refresh rate -- the torch flickered between two positions
 * whenever the camera moved, and held still while it only turned.
 *
 * So the lights are built here, after `CameraDrawSystem` has placed the
 * camera for this frame and before `GunLights` places them, from a copy of
 * that camera's matrices. It writes `g_entity_lights` and nothing else, and
 * nothing in gameplay reads those: moving the call changes what is lit, and
 * cannot change what happens. It runs on every frame, paused or not, for the
 * reason it always did -- where the torch points is the crosshair and the
 * camera, not elapsed time.
 */
export class GunLightBuildSystem implements System<RenderContext> {
  readonly id = "gunlights.build";
  private readonly view = new CameraFrame();
  constructor(private readonly game: GameSystem) {}

  update(ctx: RenderContext): void {
    const cam = ctx.camera;
    cam.updateMatrixWorld();
    cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
    this.view.take(cam.matrixWorld.elements, cam.matrixWorldInverse.elements);
    this.game.buildGunLights(this.view);
  }

  resync(ctx: RenderContext): void {
    this.update(ctx);
  }
}
