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
import { CameraBlockViewToWorld, CameraBlockWorldToView, CameraReseatFromFrame }
  from "../game/camera/view";
import type { CamPaths } from "../game/camera/curve";
import { MatCopy, MatrixTransformPoint } from "../game/matrix";
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

const _p = { x: 0, y: 0, z: 0 };

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

  /** The stage's camera paths, held for `camPath` the same way. */
  private paths: CamPaths | null = null;
  private readonly host: GameHost = {
    boneWorld: (at, bone, out) =>
      this.backend?.boneWorld(at, bone, out) ?? false,
    boneMatrix: (at, bone, out) =>
      this.backend?.boneMatrix?.(at, bone, out) ?? false,
    boneSphere: (at, bone, out) =>
      this.backend?.boneSphereWorld?.(at, bone, out) ?? null,
    // The two matrices of the camera block `g_camera_index` names, as
    // `UpdateSceneViewAndLight` built them in this tick's `CameraActorTick`
    // -- `g_camera_world_to_view[g_camera_index]` and
    // `g_camera_blocks[g_camera_index]`, the pair the engine's readers index.
    // The carried props cross between the spaces with them.
    cameraMatrices: (w2v, v2w) => {
      MatCopy(w2v, CameraBlockWorldToView(G.g_camera_index));
      MatCopy(v2w, CameraBlockViewToWorld(G.g_camera_index));
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
    aimPoint: (ahead, out) => {
      _p.x = 0; _p.y = 0; _p.z = -ahead;
      MatrixTransformPoint(CameraBlockViewToWorld(G.g_camera_index), _p, out);
    },
    // A point in the camera's own space, in world coordinates. The engine
    // unprojects a screen offset at a depth to get one -- see
    // `ThrowerPickLandingPoint`.
    viewPoint: (x, y, z, out) => {
      _p.x = x; _p.y = y; _p.z = z;
      MatrixTransformPoint(CameraBlockViewToWorld(G.g_camera_index), _p, out);
    },
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
      if (!a) return false;
      MatrixTransformPoint(CameraBlockWorldToView(G.g_camera_index), a.lookAt,
                           out);
      return true;
    },
    // The same transform as `viewSpaceOf`, for a point nothing owns: an
    // impact sprite's size and the muzzle effects' aim both come from it.
    viewSpaceOfPoint: (p, out) => {
      MatrixTransformPoint(CameraBlockWorldToView(G.g_camera_index), p, out);
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
    this.paths = (ctx as Partial<RenderContext>).paths ?? null;
    // No camera word is written here. `g_camera_yaw_bams` and the gameplay
    // eye are the scene state's hook's (`CameraUpdateTick`), and the view is
    // `UpdateSceneViewAndLight`'s, both inside the tick; they used to be
    // copied in from the three.js camera, which put the drawn camera's heading
    // where the engine keeps the players' -- two different things under (2,4),
    // whose hook holds the heading while the aim swings. The two combat
    // `Init`s' head-aim seed reads `g_camera_eye` as the engine's hook last
    // wrote it, which is what the exe's reads.
    // The gun lights are **not** built here -- see `GunLightBuildSystem`.
    // **And nothing else.** A frame that owes no tick must not do part of one,
    // and resolving a shot is the whole of a game-time job: `ResolveHit` takes
    // hit points off, `ScoreAddForPlayer` pays, and `PlayerShotEffectSpawn`
    // fills three rings that only `ShotEffectsTick` — which runs on this same
    // tick, one line down — can ever empty again.
    //
    // This branch used to drain `g_shot_requests` anyway, on the argument that
    // a trigger pull is input rather than elapsed time. The argument does not
    // survive the case it was made for: **step mode never reached this
    // branch.** Stepping stopped the *script* and ran the port at full rate, so
    // its ticks carried time and took the path below. (The mode has since
    // gone; the argument stands without it.) What this branch actually served was
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
    // No eye: the drawn camera is the render half's, and the game reads its
    // own -- `g_camera_eye` or a camera block -- from `G`. See `ClassFrame`.
    GameUpdate(t.dt, this.host, ctx.rng, ctx.events);
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
 * objects from the descriptor tail (`SpawnScriptedCharacters`), whose class
 * `Init`s the frame's task walk runs; the renderer binds its nodes to what
 * came back and hands over the ones the script has stopped listing, which the
 * port retires. `render/characters.ts` used to do all three, which put
 * `SpawnFromDescriptor`'s decisions in a layer no headless test can reach.
 */
export function syncCharacterSpawns(chars: CharacterPool,
                                    spawns: readonly ScriptSpawn[]): void {
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
    made.push(...SpawnScriptedCharacters([r]));
    for (const c of reqs) {
      if (c.parentAt === r.at && !listed.has(c.at)) make(c);
    }
  };
  SlotActorsForgetUnlisted(spawns);
  // Class 0x40's placers are built per instruction rather than per address,
  // ahead of the rest -- see `SpawnHordePlacers`. They read nothing another
  // spawn leaves behind, so building them first changes nothing they do.
  SpawnHordePlacers(spawns, T.chars?.placements ?? []);
  for (const s of spawns) {
    const r = ready.get(s.at);
    if (r) make(r);
    else SpawnSlotActor(s);
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
  // `g_camera_block_eye` is the camera block's own eye, and the camera's
  // routines own it. Free roam has no camera running and no tick, so there it
  // is taken from the viewer's camera instead, for the panels.
  if (freeRoam) {
    G.g_camera_block_eye.x = eye.x;
    G.g_camera_block_eye.y = eye.y;
    G.g_camera_block_eye.z = eye.z;
  }
  // `ColiLoadForScene` indexes its file list with this, so it is zero-based
  // and scene 1 is stage 2.
  G.g_scene_index = w.script.scene ?? 0;
  // No camera word and no scene state is copied in here any more: the path,
  // the published frame and the scene state are the engine's own globals,
  // written by the action ring, the scene state's hook and the goto opcodes
  // where the engine writes them. They used to be copied out of the walker
  // once a frame, which put every one of them a task out of place.
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
 * Draw the port's camera now, for a path that runs no game tick -- a branch
 * taken by hand, a preview ended, a toggle. The view is `G`'s and nothing is
 * written.
 */
export function drawCamera(rig: CameraRig, ctx: RenderContext): void {
  rig.draw(ctx);
}

/**
 * `[port-only]` -- put the camera block where the camera words say, then draw:
 * for a seek and a stage opening at an address, the two places the player
 * moves the script without running the frames that
 * would have written the block. `CameraReseatFromFrame` is the game's; this
 * is the composition. Never after a snapshot load, whose `G` already holds
 * the block and its view.
 */
export function reseatCamera(rig: CameraRig, ctx: RenderContext): void {
  CameraReseatFromFrame();
  rig.draw(ctx);
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
