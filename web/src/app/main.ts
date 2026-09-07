/**
 * The stage player.
 *
 * Three modes over one scene and one script walker:
 *
 *   Step       block -> step -> instruction, every one of them seekable, with
 *              a frame slider inside a camera move
 *   Play       60 Hz with a speed control, pausing at every branch point
 *   Free roam  orbit and fly, detached from the rail
 *
 * The camera is the game's own: 41.100 degrees vertical, 4:3, near 0.8, far
 * 8000, recovered from `SetupSceneProjection`. It is a compile-time constant
 * for the whole game -- there is no zoom and no per-camera FOV -- so the only
 * choice the player offers is whether to pillarbox to 4:3 or fill the window.
 */

import {
  Color,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
} from "three";
import { type Manifest } from "../bundle";
import type { SoundJson } from "../bundle/scene";
import type { ScriptJson } from "../bundle/stage";
import { CamPaths } from "../game/camera/curve";
import { QueueShotRequest } from "../game/combat/shot";
import { CameraDrawSystem, CameraRig, CameraTakeSystem }
  from "../render/camera";
import { StageScene } from "../render/stagescene";
import { SpawnLayer } from "../render/overlays";
import { FreeRoam, ownsKey } from "../render/freeroam";
import { Walker, type CamCommand, type FeedEntry } from "../script/walker";
import { ALL_STAGES, BundleIndex, slotKey } from "./bundles";
import { hasThumb, rememberedInstall, runExport,
         writeThumb } from "./install";
import { hideExportScreen, showExportScreen } from "./install/ExportScreen";
import { readState, writeState, type PlayerState } from "./urlstate";
import { seekTo as seekWalkerTo } from "../script/seek";
import { readViewPrefs, writeViewPrefs } from "./viewprefs";
import { Bgm } from "../audio/bgm";
import { Backdrop } from "../render/backdrop";
import { RigLayer } from "../render/rigs";
import { CharacterLayer } from "../render/characters";
import { PropLayer } from "../render/props";
import { Shooting } from "../render/shooting";
import { ColiDebugLayer } from "../render/coli_debug";
import { StuckDebugLayer } from "../render/stuck_debug";
import { World } from "../core/world";
import { Scope } from "../core/scope";
import { UiStore } from "../ui/store";
import { mountUi } from "./ui_root";
import type { UiHost } from "../ui/App";
import type { UiSlice } from "../ui/store";
import type { ToggleName, UiCommand } from "../ui/commands";
import { TOGGLE_DEFAULTS } from "../ui/panels/Toggles";
import { feedRow } from "./projection/script";
import type {
  BranchProjection, FeedRow, LoadingProjection, MinimapGraph, SkipProjection,
  SoundProjection, StatusProjection, TransportProjection, TreeProjection,
} from "../ui/projection";
import { highlightSet } from "./projection/sidebar";
import { buildProjection, type PlayerView } from "./projection/player";
import { groupRows, hudInputs, hudRows } from "./projection/hud";
import type { RigSource } from "./projection/rigs";
import type { DebugGroupName, StripRow } from "../ui/projection";
import {
  branchProjection, skipProjection, soundProjection, transportProjection,
} from "./projection/chrome";
import { SceneFog } from "../render/fog";
import { TextureFilter } from "../render/texfilter";
import { SceneLighting } from "../render/lighting";
import { applyToggle, runCommand, type PlayerCommands } from "./commands";
import { entryBlockFor, loadStageInto } from "./stage_load";
import { Events } from "../core/events";
import { Rng } from "../core/rng";
import type { Tick } from "../core/system";
import type { RenderContext } from "../render/context";
import { CameraFrame } from "../core/camera";
import type { Snapshot } from "../core/snapshot";
import { TICK } from "./loop";
import { DRIVEN_TICK, Pacer, STOPPED_TICK, type PacerHost } from "./pacer";
import { SnapshotRing, type HistoryView } from "./ring";
import {
  CameraSeatSystem, CharacterBindSystem, GameSystem, ScriptSystem, drawSystem,
  seatCamera, syncCamera, syncCharacterSpawns, syncPortGlobals,
} from "./systems";
import { ProjectileLayer } from "../render/projectiles";
import { SeveredHeadLayer } from "../render/severed_heads";
import { DebugBoxLayer } from "../render/debug";
import { Hud as HudLayer } from "../hud/hud";
import { Rain } from "../render/rain";
import { RainSystem } from "../game/effects/rain";
import { BreakableLayer } from "../render/breakables";
import { BloodColourLayer } from "../render/bloodcolour";
import { EffectLayer } from "../render/effects";
import { SlotModelLayer } from "../render/slotmodels";
import { ResetPropContainers } from "../game/class41";
import { ResetGameGlobals } from "../game/globals";
import { SetGameTables } from "../game/tables";

/** Before a stage is up there is nothing to report, and the shape is fixed. */
const EMPTY_GROUPS: Readonly<Record<DebugGroupName, readonly StripRow[]>> = {
  camera: [], scene: [], actors: [], props: [], collision: [], shooting: [],
};

/** The commands that change something worth remembering across a reload. */
const PREF_COMMANDS: ReadonlySet<string> = new Set([
  "toggle", "setLightMode", "setFogMode", "setFilterMode", "setPillarbox",
  "setSpeed",
]);

/**
 * How far into a stage its picture is taken: seven seconds of the game's own
 * clock. See {@link Player.captureThumb} for why it is not zero.
 */
const THUMB_FRAMES = 420;

export class Player implements PlayerView, PlayerCommands, PacerHost {
  private readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  /** React's, handed over once it has them. See `app/ui_root.ts`. */
  private readonly viewport: HTMLElement;
  private readonly canvas: HTMLCanvasElement;

  /**
   * Which stages exist, where each comes from, and the merged manifest.
   * See `app/bundles.ts`; there are two bundles and both are live.
   */
  readonly bundles = new BundleIndex();
  /**
   * The merged manifest, or null when neither bundle produced one -- which is
   * a real state now: an install and an empty cache is a page that can play
   * every stage and has none of them yet. Whatever describes *a* bundle
   * rather than a stage reads this, such as the build stamp in the status
   * line.
   */
  manifest: Manifest | null = null;
  /** Which stages the picker offers. See {@link Player.refreshStages}. */
  stages: number[] = [];
  /**
   * **The stage on screen** was written by an older exporter than this page.
   *
   * Not "any stage is": the first version asked that, and rebuilding the one
   * you were playing left the warning up because five others in the served
   * bundle were still old. A warning that stays on after you have done the
   * thing it asked for is one people learn to ignore. The bundle screen is
   * where every stale stage is listed, because that is the screen you go to in
   * order to do something about them.
   *
   * A getter rather than a field: it depends on `state.stage`, which the top
   * bar changes without going near {@link Player.refreshStages}. It is a map
   * lookup.
   */
  get bundleStale(): boolean {
    return this.bundles.find(this.state.stage, this.state.original)?.stale
      === true;
  }

  /**
   * The blocks the loaded stage can open at. See {@link UiProjection.entries}.
   *
   * Off the walker's script rather than off the manifest, because it is a fact
   * about the stage that is loaded and not about the stage that is selected --
   * during a load the two are different, and the picker offering the incoming
   * stage's entries against the outgoing stage's number would be a control
   * that lies for the length of a load.
   */
  get entries(): readonly number[] {
    const script = this.walker?.script;
    if (!script) return [];
    return script.entries?.length ? script.entries : [script.entry_block];
  }

  /** Which of {@link Player.entries} this run opened at. */
  get entry(): number {
    const script = this.walker?.script;
    return script ? entryBlockFor(this.state, script) : 0;
  }
  /** An install this browser can build from, so a missing stage is buildable. */
  canBuild = false;
  /** The loaded stage geometry. Named apart from `stage`, the number. */
  scene3d: StageScene | null = null;
  spawns = new SpawnLayer();
  /**
   * The script, and the one copy of it.
   *
   * It lives on the `Context` because every system reads it there; this is the
   * same reference under the name the player's own code has always used, so
   * the two can never drift apart.
   */
  get walker(): Walker | null { return this.ctx.walker; }
  set walker(w: Walker | null) { this.ctx.walker = w; }

  /**
   * The script tree, built once per stage.
   *
   * Thousands of rows and none of them change, so it is kept **by reference**
   * and replaced only on a stage load. That one fact is what stops the
   * projection walking it: `stabilise` settles an unmoved reference with an
   * `Object.is` and goes no further.
   */
  treeProj: TreeProjection | null = null;
  minimapGraphData: MinimapGraph | null = null;
  /**
   * The event feed, capped.
   *
   * Replaced rather than pushed to, for the same reason as the tree: an array
   * mutated in place is one the projection cannot tell has changed, and one it
   * has to walk to find out that it has not.
   */
  private feedRows: readonly FeedRow[] = [];
  private readonly freeRoam: FreeRoam;
  readonly bgm = new Bgm();
  readonly sceneFog: SceneFog;
  readonly texFilter = new TextureFilter();
  readonly lighting: SceneLighting;
  readonly backdrop = new Backdrop();
  readonly rigs = new RigLayer();
  readonly chars = new CharacterLayer();
  readonly props = new PropLayer();
  readonly breakables = new BreakableLayer();
  /**
   * The actors drawn from an asset slot rather than a skeleton — see
   * `render/slotmodels.ts`. Its own layer because the character pool cannot
   * hold one: those actors have no character type to resolve.
   */
  readonly slotModels = new SlotModelLayer();
  /**
   * The shot effects — blood, muzzle flash, tracer, impacts. Its own layer
   * because it draws in two spaces at once: one group in the world and one
   * whose matrix is the camera's.
   */
  readonly effects = new EffectLayer();
  /**
   * Red blood or green — the game's own Blood Color option, offered where the
   * player can reach it. See `render/bloodcolour.ts`.
   */
  readonly bloodColour = new BloodColourLayer();
  readonly shooting: Shooting;
  /** The `coli/` overlay — see `render/coli_debug.ts`. */
  readonly coliDebug = new ColiDebugLayer();
  readonly stuckDebug = new StuckDebugLayer();
  /**
   * The stage's `sound` block, kept for the one caller that is not the walker:
   * class 0x10's op 0x1D plays a dialogue group from inside the port, and the
   * port cannot reach the bundle.
   */
  dialogue: SoundJson | null = null;
  /** The registry and the tick order: script -> game -> render -> hud. */
  readonly world = new World<RenderContext>();
  /**
   * The root of the disposal tree, and the two scopes under it that matter.
   *
   * `stage` dies when a different stage is loaded; `session` dies whenever the
   * game state is replaced under the renderer — a seek or a snapshot load —
   * and is exactly what `resync` would otherwise have to rebuild by hand.
   */
  readonly appScope = new Scope("app", () => this.lifeFrame);
  /**
   * Frames since the page loaded, which never resets.
   *
   * `ctx.frame` restarts at zero on every stage load, so it cannot order two
   * scopes across a stage switch — and "was this opened before the current
   * stage loaded" is the one question the panel exists to answer.
   */
  lifeFrame = 0;
  stageScope: Scope | null = null;
  stageLoadedAt = 0;
  /**
   * The stage's camera paths, and the one copy of them.
   *
   * The same arrangement as `walker` above and for the same reason: it lives
   * on the context because every layer that evaluates a shot reads it there,
   * and this is that reference under the name the player's own code uses, so
   * the two cannot drift apart. `CameraRig` used to keep a second copy that
   * nothing ever assigned, which parked the camera at the origin.
   */
  get paths(): CamPaths | null { return this.ctx.paths; }
  set paths(v: CamPaths | null) { this.ctx.paths = v; }

  /** The one thing React subscribes to. See `ui/store.ts`. */
  private readonly ui: UiStore;
  /** The sidebar's own state: which classes are boxed, and which are folded. */
  readonly boxedClasses = new Set<number>();
  /** The rigs panel's selection — see the `boxRig` command. */
  readonly boxedRigs = new Set<string>();
  readonly shutClasses = new Set<number>();
  /** The wait panel's `box` checkbox — see the `boxWait` command. */
  boxWait = false;
  /** What the mounted panels are showing. See `UiStore.demand`. */
  readonly wants = (slice: UiSlice): boolean => this.ui.wants(slice);
  /** The overlay over the viewport, and the stage's line in the top bar. */
  loading: LoadingProjection | null = { text: "loading bundle…", failed: false };
  status: StatusProjection = { text: "", note: "", noteTitle: "" };
  /** The view toggles. Defaults come from the table the panel renders. */
  toggles: Readonly<Record<ToggleName, boolean>> = TOGGLE_DEFAULTS;
  private readonly events = new Events();
  /** The one random source in the player, and part of every snapshot. */
  readonly rng = new Rng(1);
  /**
   * Who asks for frames, and when. See `app/pacer.ts`.
   *
   * Handed `this`: the pacer drives the frame and calls back into the four
   * hooks of `PacerHost` below, which is the whole of what it knows about a
   * stage, an actor or a panel.
   */
  private readonly pacer = new Pacer(this);
  /**
   * The history a `rewind` walks back through. See `app/ring.ts`.
   *
   * Offered one frame's state per tick and takes one on its own cadence, so
   * the composition root does not have to know what that cadence is.
   */
  private readonly ring = new SnapshotRing();
  readonly script = new ScriptSystem();
  /** Approach, attack permits, and the look-at the camera tracks. */
  readonly game = new GameSystem();
  readonly bullets = new ProjectileLayer();
  readonly heads = new SeveredHeadLayer();
  /** Debug overlays: unported classes, the permit holder, the awaited enemies. */
  readonly debug = new DebugBoxLayer();
  readonly rain = new Rain();
  /** The rain pool, advanced in the game phase. See `game/effects/rain.ts`. */
  readonly rainSim = new RainSystem();
  readonly hudLayer: HudLayer;

  state: PlayerState = readState();
  playing = false;
  speed = 1;
  /** The camera's own state: the pose scratch, the rails, and the two toggles. */
  readonly cam = new CameraRig();
  /** Everything a system is handed. Built once; the stage index moves. */
  readonly ctx: RenderContext;
  /** The last snapshot taken, for the Load button. */
  saved: Snapshot | null = null;
  /** Set while the frame slider is driving the camera by hand. */
  scrubbing = false;
  pillarbox = true;

  constructor(ui: UiStore, host: UiHost) {
    this.ui = ui;
    this.viewport = host.viewport;
    this.canvas = host.canvas;
    this.freeRoam = new FreeRoam(host.viewport, host.canvas);
    // Both take the nodes React rendered for them rather than a parent to
    // insert into: the crosshair and the four hud divs are `#viewport`'s
    // children and `#viewport` is React's element, so React renders them and
    // hands them across in `UiHost`. See `ui/panels/Viewport.tsx`.
    this.shooting = new Shooting(host.viewport, host.crosshair, this.chars,
                                 this.appScope, this.events);
    // A click is input. The renderer says what the viewer did; the port owns
    // the queue and decides what it means. See `game/combat/shot.ts`.
    //
    // **And it wakes the pacer.** `Pacer.rafId === null` means the loop is
    // asleep, which it is whenever nothing wants a frame — a paused player
    // with no sprites out is the common case, and shooting while paused is a
    // thing the transport deliberately allows. `QueueShotRequest` only pushes
    // onto `G.g_shot_requests`; without a `wake` the queue sat there until
    // some *other* waker ran, so the shot landed on whatever frame a later
    // keypress or panel click happened to ask for. The pacer's own list of
    // wakers already said "a shot" — the obligation was written down and the
    // call was missing.
    //
    // **And a pull the clock can never consume is not queued at all.** The
    // queue is drained by `GameUpdate`, which runs only on a tick that carries
    // game time, so a click made while the transport is stopped would sit
    // there until the clock started again and then land — twenty clicks made
    // while paused arriving on one frame, along rays taken from wherever the
    // free-roam camera happened to be. Whether a click is *input* is the
    // transport's question and this is the one place intent enters `G`, so it
    // is answered here rather than in `game/`, which has no idea the player
    // can be paused. Step mode is not stopped and is deliberately unaffected:
    // the script stands still there while the port runs at full rate, so a
    // shot fired in it queues and resolves on the very next tick.
    //
    // The `wake` is unconditional. It is a redraw, not a tick — `Shooting.fire`
    // has already counted the click in the HUD's own shots tally — and the
    // pacer's list of wakers says "a shot" without qualification.
    this.shooting.onFire = (ray) => {
      if (this.gameRunning && !this.frozen) QueueShotRequest(0, ray);
      this.pacer.wake();
    };
    this.hudLayer = new HudLayer(host.hud);
    this.renderer = new WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.scene.background = new Color(0x05070a);

    // SetupSceneProjection: BuildPerspectiveProjection(0x1D3B, 4/3, 0.8, 8000).
    this.camera = new PerspectiveCamera(41.1, 4 / 3, 0.8, 8000);
    // Shooting needs a camera to cast through and a scene to cast at, and
    // this is the first moment both exist. It used to be handed them by the
    // Shoot toggle's command, which meant a click did nothing at all until
    // somebody found that checkbox.
    this.shooting.castThrough(this.camera);
    this.sceneFog = new SceneFog(this.scene);
    // The anisotropy ceiling is the renderer's to report, so the layer is
    // told about it once rather than reaching for a global.
    this.texFilter.setRenderer(this.renderer);
    this.lighting = new SceneLighting(this.scene);
    this.scene.add(this.backdrop.group);
    this.scene.add(this.rain.group);
    this.scene.add(this.spawns.group);
    this.scene.add(this.debug.group);
    // The outlines the rigs panel draws. The rig roots themselves are nodes of
    // the stage's own glTF and are already in the scene; this is only the
    // boxes round the ones the sidebar has ticked.
    this.scene.add(this.rigs.group);
    this.scene.add(this.breakables.group);
    this.scene.add(this.slotModels.group);
    this.scene.add(this.effects.group);
    this.scene.add(this.effects.viewGroup);

    this.ctx = {
      scene: this.scene,
      camera: this.camera,
      // The camera again, as plain numbers, for the half of the player that
      // may not know what a `Camera` is. `CameraTakeSystem` fills it in.
      view: new CameraFrame(),
      events: this.events,
      rng: this.rng,
      walker: null,
      paths: null,
      scope: this.appScope,
      // Replaced by `newSession` before anything registers on it.
      session: this.appScope.child("session:boot"),
      stage: this.state.stage,
      frame: 0,
    };
    // The tick order is the engine's frame: the script decides what exists,
    // the port decides where it is and what it is doing, and the renderer
    // reads that. Adding a layer is one `add` and never touches the loop.
    this.world.add("script", this.script);
    // The camera's two halves straddle the game phase: the shot writes the
    // block, `CameraTrackEnemiesTick` eases it, and only then does the draw
    // read it back. See `render/camera.ts`.
    this.world.add("script", new CameraSeatSystem(this.cam));
    // At the head of the game phase, where `GameSystem` used to read the
    // camera for itself. Same place in the order, same values.
    this.world.add("game", new CameraTakeSystem());
    this.world.add("game", this.game);
    // After the port's frame, in the same phase: the renderer's references to
    // the object pool, rebound. A load replaces every actor and a seek wipes
    // the pool, and `render/` may not look one up for itself.
    this.world.add("game", new CharacterBindSystem(this.chars));
    this.world.add("game", this.rainSim);
    this.world.add("render", new CameraDrawSystem(this.cam));
    // ...and free roam is the other half of that: the draw returns early
    // while `cam.scripted` is false, and this flies the camera instead. It is
    // a system rather than a hand-rolled tick so that a seek and a snapshot
    // load both reach it -- see `render/freeroam.ts`.
    this.world.add("render", this.freeRoam);
    // Everything below poses against the camera the draw just placed.
    this.world.add("render", this.spawns);
    this.world.add("render", this.sceneFog);
    this.world.add("render", this.lighting);
    this.world.add("render", this.backdrop);
    this.world.add("render", this.rigs);
    this.world.add("render", this.chars);
    this.world.add("render", this.props);
    this.world.add("render", this.breakables);
    this.world.add("render", this.slotModels);
    this.world.add("render", this.effects);
    this.world.add("render", this.bullets);
    this.world.add("render", this.heads);
    this.world.add("render", this.shooting);
    this.world.add("render", this.coliDebug);
    this.world.add("render", this.stuckDebug);
    this.world.add("render", this.rain);
    this.world.add("render", this.debug);
    // The screen-space layer, and the last thing the tick does: it draws the
    // shutter and the caption straight off the walker, and holds no state of
    // its own for a snapshot to miss. The projection is *not* built here --
    // it is built at the end of `frame`, outside the tick, because a world
    // with no walker in it does not tick at all. See `frame`.
    this.world.add("hud", drawSystem("hud.layer",
                                    (ctx) => this.hudLayer.draw(ctx.walker)));
    this.game.backend = this.chars;
    this.debug.source = this.chars;
    // One generator for the whole player, so a snapshot replays the gore
    // rolls and the death directions as well as the attacks.
    this.chars.rng = this.rng;

    // `PlayerTakeDamage` raises this wherever it is called from -- a strike, a
    // thrown weapon, and whatever comes next -- instead of the two duplicated
    // callbacks this used to carry.
    this.events.on("player.damaged", (d) => {
      this.onFeed({
        seq: -1, block: this.walker?.block ?? -1, step: -1, opIndex: -1,
        op: { i: -1, at: 0, op: -1, cat: "combat",
              name: d.source === "thrown" ? "hit by thrown weapon"
                                          : "hit by enemy" },
        note: `${d.who}${d.attack >= 0 ? ` attack ${d.attack}` : ""}`
            + ` · −1 life → ${d.lives} · ${d.score} pts`,
      });
    });

    // Class 0x41 raises these where the engine calls `PlaySoundId`, so the
    // sound belongs to the port's decision rather than to the click that
    // caused it -- a prop cracked by a collapsing stack sounds the same as one
    // cracked by a bullet, which is what the engine does.
    const propFeed = (name: string) => (d: { id: number; sound: number }) => {
      this.bgm.play(d.sound);
      this.onFeed({
        seq: -1, block: this.walker?.block ?? -1, step: -1, opIndex: -1,
        op: { i: -1, at: 0, op: -1, cat: "combat", name },
        note: `prop ${d.id}`,
      });
    };
    this.events.on("prop.cracked", propFeed("breakable cracked"));
    this.events.on("prop.broken", propFeed("breakable broken"));
    this.events.on("prop.settled", propFeed("breakable settled"));
    // The payoff: the item a set of props was hiding.
    this.events.on("item.released", (d) => {
      if (d.sound) this.bgm.play(d.sound);
      this.onFeed({
        seq: -1, block: this.walker?.block ?? -1, step: -1, opIndex: -1,
        op: { i: -1, at: 0, op: -1, cat: "combat", name: "item released" },
        note: `set ${d.set} from prop ${d.from}`
            + ` at ${d.x.toFixed(1)}, ${d.y.toFixed(1)}, ${d.z.toFixed(1)}`,
      });
    });

    // Nothing was listening to this. The port raises `sound.play` wherever the
    // engine calls `PlaySoundId` from gameplay -- class 0x31's laser sword and
    // its footsteps, class 0x10's queued cries -- and every one of them was
    // going nowhere.
    this.events.on("sound.play", (d) => { this.bgm.play(d.id); });

    // -- class 0x10, the civilians ---------------------------------------
    // Op 0x1D is `EvtOpPlayDialogue2D`, the same call evt op 0x2D makes, so a
    // civilian's line goes through the player's own subtitles and voice rather
    // than out as a bare sound id.
    this.events.on("civilian.dialogue", (d) => {
      const v = this.dialogue?.messages?.[String(d.group)]?.[0] ?? null;
      if (!v || !this.walker) return;
      if (v.voice) this.bgm.play(v.voice);
      // Onto the walker, not into the layer: a caption is script state, and
      // the one raised by a civilian is no less so than the one raised by
      // evt 0x2D. It goes in the snapshot with the rest.
      this.walker.captionGroup = d.group;
      this.walker.captionFrames = v.frames;
    });
    this.events.on("civilian.rescued", (d) => {
      this.onFeed({
        seq: -1, block: this.walker?.block ?? -1, step: -1, opIndex: -1,
        op: { i: -1, at: 0, op: -1, cat: "combat", name: "civilian rescued" },
        note: `+400 to ${d.player < 0 ? "both players" : `player ${d.player}`}`
            + ` → ${d.score}`,
      });
    });
    this.events.on("civilian.shot", (d) => {
      this.onFeed({
        seq: -1, block: this.walker?.block ?? -1, step: -1, opIndex: -1,
        op: { i: -1, at: 0, op: -1, cat: "combat", name: "civilian shot" },
        note: `player ${d.player < 0 ? "?" : d.player} · −1 life · −100 twice`,
      });
    });

    this.wireUi();
    // The one place a `UiCommand` means anything. Everything in `ui/` reaches
    // the world through here and nowhere else.
    this.ui.onCommand((c) => this.runCommand(c));
    // Watching the viewport rather than the window catches the splitter drag
    // and the branch bar appearing, neither of which resizes the window.
    new ResizeObserver(() => this.resize()).observe(this.viewport);
    this.resize();
  }

  // -- what the UI may know ----------------------------------------------

  /**
   * `PlayerView`, implemented.
   *
   * Read-only accessors and nothing else: the interface in
   * `app/projection/player.ts` is the written-down answer to "what does the
   * UI depend on?", and `implements` is what keeps the answer true. A panel
   * that needs a new fact gets a line here, in the open, rather than a reach
   * into whatever happens to be reachable.
   */
  get stage(): number { return this.state.stage; }
  get original(): boolean { return !!this.state.original; }
  get mode(): "play" | "step" | "free" { return this.state.mode; }
  get frozen(): boolean { return !!this.state.freeze; }
  get lightMode(): string { return this.lighting.lightingMode; }
  get fogMode(): string { return this.sceneFog.fogMode; }
  get filterMode(): string { return this.texFilter.filterMode; }
  get anisotropyLimit(): number { return this.texFilter.anisotropyLimit; }
  get camEye(): { x: number; y: number; z: number } {
    return this.camera.position;
  }
  get tree(): TreeProjection | null { return this.treeProj; }
  get minimap(): MinimapGraph | null { return this.minimapGraphData; }
  get feed(): readonly FeedRow[] { return this.feedRows; }
  get hudRows(): readonly StripRow[] {
    const w = this.walker;
    const x = hudInputs(this);
    return w && x ? hudRows(w, x) : [];
  }

  get groups(): Readonly<Record<DebugGroupName, readonly StripRow[]>> {
    const w = this.walker;
    const x = hudInputs(this);
    return w && x ? groupRows(w, x) : EMPTY_GROUPS;
  }
  /** Every rig in the stage, for the rigs panel. See `render/rigs.ts`. */
  get rigList(): readonly RigSource[] { return this.rigs.list; }
  get hasSaved(): boolean { return !!this.saved; }
  /** How much rewindable history is held. See `app/ring.ts`. */
  get history(): HistoryView { return this.ring.view; }
  get sound(): SoundProjection { return soundProjection(this); }
  get skip(): SkipProjection | null { return skipProjection(this); }
  get branch(): BranchProjection | null { return branchProjection(this); }
  get transport(): TransportProjection { return transportProjection(this); }

  // -- bootstrap ---------------------------------------------------------

  /**
   * The clock first, then the bundle.
   *
   * The frame loop starts before anything is awaited, so it is turning for
   * the whole of the bundle fetch and the first stage load. That is what
   * makes the loading overlay -- and the failure message, which is the case
   * where no stage will ever load -- reach the screen through the same
   * once-a-frame publish as everything else, rather than through a hand-push
   * at each of the places that happen to know the text changed.
   */
  async start(): Promise<void> {
    // The clock, the drive seam and the hidden-tab handling, in the order
    // `app/pacer.ts` says they have to go in. It ends by asking for the first
    // frame, so the loop is turning for the whole of the fetch below.
    this.pacer.start(this.state);
    // Both bundles are read, and which one a *stage* comes from is decided
    // per stage. See `app/bundles.ts`.
    await this.refreshStages();
    if (this.bundles.manifest === null && !this.canBuild) {
      // Nothing to play and nothing to build from. The bundle screen is the
      // answer to that, so it is offered rather than described -- the reason
      // the server was refused is what it opens with.
      const why = this.bundles.refusals.get("server")
        ?? this.bundles.refusals.get("cache") ?? "no bundle";
      this.fail(`${why}\n\nBuild one from your own copy of the game.`);
      showExportScreen({
        reason: why,
        onDismiss: null,
        onBuilt: () => {},
        // The one place a reload is still right: `start` gave up before it
        // built a scene, so there is nothing to swap a stage into.
        onReady: () => { window.location.reload(); },
      });
      return;
    }
    hideExportScreen();

    if (!this.stages.includes(this.state.stage)) {
      this.state.stage = this.stages[0];
    }

    await this.loadStage();
    this.setMode(this.state.mode);
  }

  /**
   * The stage's tables, kept because a seek has to put them back.
   *
   * `ResetGameGlobals` clears the approach rings along with everything else,
   * and **the replay cannot rewrite them**: they are table-derived, copied out
   * of the bundle by `SetGameTables`, and no opcode touches them. A seek that
   * only reset left every ring at zero, so `TestApproachRing` answered band 4
   * for every actor at every distance, nothing ever reached striking range,
   * and nothing ever claimed an attack permit. Two enemies stood at d=37
   * running on the spot.
   *
   * Held here so the argument list exists once. `stage_load.ts` sets it and
   * `seekTo` puts it back.
   */
  private gameTables: ScriptJson | null = null;

  /**
   * Which stage load is the live one. See `stage_load.ts` — every call takes
   * the next number and bails at its next `await` if a later one has started.
   */
  stageLoadSeq = 0;

  /** Point the port's tables at this stage, and copy what `G` holds of them. */
  applyGameTables(script: ScriptJson): void {
    this.gameTables = script;
    SetGameTables(script.characters, script.breakables, script.set_pieces,
                  script.humanoids, script.coli, script.civilians);
  }

  /**
   * Put the bundle screen on the page.
   *
   * It used to appear only when no bundle loaded, which meant that on any
   * machine with `extract/player/` populated -- every developer's -- none of
   * it was reachable at all. Rebuilding a stage, switching to the copy the
   * browser exported for itself, and downloading that copy are all things you
   * want *with* a bundle already open, so the top bar has a button now.
   */
  openBundles(): void {
    showExportScreen({
      reason: null,
      // Open on what is on screen: rebuilding that is the commonest reason to
      // be here, and it used to mean finding it in the grid again.
      openOn: { stage: this.state.stage, original: this.state.original },
      onBuilt: (stage, original) => this.stageBuilt(stage, original),
      // The install may have been chosen while the screen was up, and that
      // is what decides whether the picker offers stages nothing holds yet.
      onDismiss: () => { void this.closeBundles(); },
      onReady: (stage, original) => { void this.closeBundles(stage, original); },
    });
  }

  /**
   * Stages the bundle screen rebuilt while it was open.
   *
   * Emptied by {@link Player.closeBundles}, which is the only reader: what it
   * is for is deciding whether the scene on screen came out of a file that has
   * since been replaced.
   */
  private readonly rebuilt = new Set<string>();

  /**
   * The queue of pictures owed, as one chained promise.
   *
   * Serial because each one loads a stage, and two stage loads at once is not
   * a thing this player does. `closeBundles` waits on it before its own load,
   * so the last capture cannot be torn down half-finished.
   */
  private thumbQueue: Promise<void> = Promise.resolve();

  /**
   * A stage has just finished building. Record it, and photograph it.
   *
   * **The picture is taken here, as each stage lands, and not when the screen
   * closes.** Deferring it lost every picture for anyone who reloaded the page
   * after a build instead of pressing Back -- which after a twelve-minute
   * *Build all* is the natural thing to do, and the report that found this.
   * Taking them as they land also means the tiles fill in while the run is
   * still going, which is the difference between a screen that looks busy and
   * one that looks stuck.
   *
   * It is only possible because the worker now writes the manifest after every
   * stage: a stage the index does not name cannot be loaded, and loading it is
   * how its picture gets taken.
   */
  private stageBuilt(stage: number, original: boolean): Promise<void> {
    this.rebuilt.add(slotKey(stage, original));
    return this.thumbQueue = this.thumbQueue.then(async () => {
      // The stage was written moments ago and the index has not seen it.
      await this.refreshStages();
      await this.captureThumb(stage, original);
    }).catch(() => {
      // A picture is never worth breaking the run over, and the export itself
      // has its own error path. The tile simply keeps whatever it had.
    });
  }

  /**
   * Take the bundle screen down, and adopt whatever it did.
   *
   * **This used to be `window.location.reload()`**, on a comment claiming a
   * stage was not hot-swappable from here. It is: the top bar's stage picker
   * has always been `state.stage = n; loadStage()`, which tears the scope down
   * and rebuilds it from whichever bundle now holds that stage. So the reload
   * bought nothing, and the *other* exit from the screen -- Back, and Escape
   * with it -- did not reload, which is the bug: rebuild the stage you are
   * looking at, press Back, and the page goes on drawing the geometry it
   * already had. Refreshing by hand was the only way out, and nobody should
   * have to know that.
   *
   * Given a stage, it switches to it. Given none, it reloads the current one
   * only if the screen rebuilt it -- so dismissing a screen that built nothing
   * costs a manifest read and no teardown.
   *
   * **Every stage the screen built has its picture taken here**, before that
   * load, because taking one means playing the stage and this is the moment
   * the player is already between stages. {@link Player.captureThumb} leaves
   * it pointed at whatever it photographed last, so the load at the end is
   * both the thing that adopts the rebuild and the thing that undoes them.
   */
  private async closeBundles(stage?: number, original?: boolean): Promise<void> {
    hideExportScreen();
    await this.refreshStages();
    const want = stage ?? this.state.stage;
    const wantOriginal = original ?? this.state.original;
    const shot = this.rebuilt.size > 0;
    const switching = want !== this.state.stage
      || wantOriginal !== this.state.original;
    const replaced = this.rebuilt.has(slotKey(want, wantOriginal));
    this.rebuilt.clear();
    // The pictures were taken as the stages landed; this is the last of them
    // finishing. Waiting is what keeps the load below from tearing down a
    // stage that is still being photographed.
    await this.thumbQueue;
    // A capture leaves the world holding the stage it photographed, so once
    // one has run a load is owed whether or not anything else changed.
    if (!shot && !switching && !replaced) return;
    if (switching) {
      this.state.stage = want;
      this.state.original = wantOriginal;
      // The same reset the stage picker does: an address in the stage you
      // just left names nothing in the one you are entering.
      this.state.block = this.state.step = this.state.op = undefined;
      this.state.slot = this.state.frame = undefined;
      this.pushUrl();
    }
    await this.loadStage();
  }

  /**
   * Re-read both bundles, and work out what the picker may offer.
   *
   * **Every stage, when there is an install to build from.** The picker used
   * to list what the manifest happened to hold, which was right when a bundle
   * was a thing you were handed and wrong now that the page can make one: a
   * stage you have not built yet is a stage you can ask for, and asking is
   * what builds it. See {@link Player.buildStage}.
   */
  async refreshStages(): Promise<void> {
    await this.bundles.refresh();
    this.canBuild = (await rememberedInstall()) !== null;
    if (this.bundles.manifest) this.manifest = this.bundles.manifest;
    const built = [...new Set(this.bundles.built().map((s) => s.stage))];
    this.stages = (this.canBuild ? [...ALL_STAGES] : built)
      .sort((a, b) => a - b);
    if (!this.stages.length) this.stages = built.length ? built : [1];
  }

  /**
   * Build one stage from the remembered install, into the cache.
   *
   * This is the on-demand half of the bundle screen: picking a stage the page
   * does not hold decodes it, keeps it, and plays it, and the next time it is
   * asked for it is already there. The progress goes through the loading
   * overlay because it *is* the load -- there is nothing else to look at, and
   * a minute of a blank viewport with no explanation is the worst version of
   * this.
   *
   * Returns whether the stage is now in the index.
   */
  async buildStage(stage: number, original: boolean): Promise<boolean> {
    const install = await rememberedInstall();
    if (!install) return false;
    const what = `stage ${stage}${original ? " (Original Mode)" : ""}`;
    this.setLoading(`building ${what}…`);
    let failure: string | null = null;
    const run = runExport(
      { kind: "export", install, stages: [stage], modes: [original],
        fresh: false },
      (msg) => {
        if (msg.kind === "progress") this.setLoading(`${what}: ${msg.line}`);
        else if (msg.kind === "error") failure = msg.message;
      });
    await run.done;
    if (failure !== null) {
      this.fail(`could not build ${what}:\n${failure as string}`);
      return false;
    }
    await this.refreshStages();
    return this.bundles.find(stage, original) !== undefined;
  }

  /** Load the stage the URL names. The sequence is `app/stage_load.ts`. */
  async loadStage(): Promise<void> {
    // Three megabytes of another stage's history. `snapshotRefusal` would
    // refuse every slot of it anyway -- a snapshot names the stage it was
    // taken against -- so keeping it is guaranteed waste.
    this.ring.clear();
    await loadStageInto(this);
  }

  // -- ui wiring ---------------------------------------------------------

  /**
   * What is left of the wiring.
   *
   * Every control the player has is a `UiCommand` now. These are the three
   * things that are not controls: the keyboard, the browser's own back
   * button, and the one callback a layer raises *into* the shell.
   */
  private wireUi(): void {
    // Every shot goes to the feed, so a session reads back as a transcript.
    this.shooting.onShot = (r, note) => {
      // The sprite and the feed row both want drawing, and a shot is allowed
      // while the transport is stopped.
      this.wake();
      this.onFeed({
        seq: -1, block: this.walker?.block ?? -1, step: -1, opIndex: -1,
        op: { i: -1, at: 0, op: -1,
              name: r.hit ? "shot · hit" : "shot · miss", cat: "combat" },
        note,
      });
    };

    window.addEventListener("keydown", (e) => {
      // Asked about the key, not only about the element: a focused button
      // takes Space and Enter and nothing else, so clicking **Free roam** no
      // longer leaves every shortcut on the page swallowed by the button that
      // entered it. See `ownsKey` in `render/freeroam.ts`.
      if (ownsKey(e.target, e.code)) return;
      // Before the branches, not after: every one of them changes something
      // worth drawing, and a paused player has no loop running to draw it.
      this.wake();
      if (e.code === "Space") { e.preventDefault(); this.togglePlay(); }
      else if (e.code === "ArrowRight") { e.preventDefault(); this.stepOnce(); }
      // Shift reads as "a bigger step back", and it is: `stepBack` moves one
      // instruction, `rewind` moves half a second of game time. Deliberately
      // not a letter -- `tools/pacing.mjs` presses `KeyZ` to prove that a key
      // the player binds nothing to still wakes the loop, and every letter
      // bound here is one that check can no longer use.
      else if (e.code === "ArrowLeft") {
        e.preventDefault();
        if (e.shiftKey) this.rewind(); else this.stepBack();
      }
      else if (e.code === "Digit1") this.setMode("step");
      else if (e.code === "Digit2") this.setMode("play");
      else if (e.code === "Digit3") this.setMode("free");
      else if (e.code === "Enter") { e.preventDefault(); this.requestSkip(); }
    });

    window.addEventListener("popstate", () => {
      this.state = readState();
      this.wake();
      void this.loadStage();
    });

    // The saved preferences go back through `runCommand`, which is the same
    // path a click takes -- there is deliberately no second way for a setting
    // to take effect, because two would drift.
    const prefs = readViewPrefs();
    for (const [name, on] of Object.entries(prefs.toggles)) {
      this.runCommand({ kind: "toggle", name: name as ToggleName, on });
    }
    if (prefs.lightMode) {
      this.runCommand({ kind: "setLightMode", mode: prefs.lightMode });
    }
    if (prefs.fogMode) {
      this.runCommand({ kind: "setFogMode", mode: prefs.fogMode });
    }
    if (prefs.filterMode) {
      this.runCommand({ kind: "setFilterMode", mode: prefs.filterMode });
    }
    if (prefs.pillarbox !== undefined) {
      this.runCommand({ kind: "setPillarbox", on: prefs.pillarbox });
    }
    if (prefs.speed) this.runCommand({ kind: "setSpeed", speed: prefs.speed });
  }

  /** Every setting worth remembering, as it stands now. */
  private saveViewPrefs(): void {
    writeViewPrefs({
      toggles: this.toggles,
      lightMode: this.lighting.lightingMode,
      fogMode: this.sceneFog.fogMode,
      // Not `anisotropyLimit`: that is what the hardware allows, not something
      // the viewer chose, and persisting it would carry one machine's ceiling
      // to another.
      filterMode: this.texFilter.filterMode,
      pillarbox: this.pillarbox,
      speed: this.speed,
    });
  }

  /**
   * The splitter between the script panel and the viewport.
   *
   * The panel starts narrow because the viewport is the point of the tool;
   * the tree is a navigator, not the content. Width is a per-viewer
   * convenience, so it lives in `localStorage` and nowhere else.
   */
  setMode(mode: PlayerState["mode"]): void {
    this.state.mode = mode;
    this.freeRoam.enabled = mode === "free";
    if (mode === "free") {
      this.freeRoam.adoptFrom(this.camera);
      // A region holds only the few models the game draws from one point on
      // the rail. Free roam therefore shows the whole level -- otherwise most
      // of it simply is not there.
      this.scene3d?.setVisibility("all");
      this.cam.rails?.setCameraMarkerVisible(true);
    } else {
      const all = this.toggles.allRegions;
      this.scene3d?.setVisibility(all ? "all" : "region");
      this.cam.rails?.setCameraMarkerVisible(false);
      this.syncCameraToWalker();
    }
    this.playing = mode === "play" ? this.playing : false;
    this.pushUrl();
  }

  togglePlay(): void {
    if (this.state.mode === "free") this.setMode("play");
    this.playing = !this.playing;
    if (this.playing && this.state.mode === "step") this.setMode("play");
  }

  /**
   * Press Start during a skippable cutscene.
   *
   * The whole feature is live in the retail game -- region, Start poll, watcher
   * task, and every consumer of the flag. See `Walker.skipRequested`.
   */
  requestSkip(): void {
    const w = this.walker;
    if (!w || !w.requestSkip()) return;
    this.syncCameraToWalker();
    this.markAddress();
    this.pushUrl();
  }


  stepOnce(): void {
    const w = this.walker;
    if (!w) return;
    this.playing = false;
    w.stepOnce();
    this.syncCameraToWalker();
    this.markAddress();
    this.pushUrl();
  }

  /**
   * "Previous instruction" replays from the entry block to the op before this
   * one. There is no undo: an instruction's effect on the region set, the
   * streamed slots and the camera is not invertible, so the only correct way
   * back is to run forward again.
   */
  stepBack(): void {
    const w = this.walker;
    if (!w) return;
    this.playing = false;
    if (w.opIndex > 0) this.seekTo(w.block, w.step, w.opIndex - 1);
    else if (w.step > 0) {
      const ops = w.currentBlock?.steps?.[w.step - 1]?.ops?.length ?? 1;
      this.seekTo(w.block, w.step - 1, Math.max(0, ops - 1));
    }
  }

  /**
   * Back half a second of game time, through the snapshot ring.
   *
   * **Not the same axis as `stepBack`,** which is why both exist. `stepBack`
   * is a *script* step: it seeks to the previous instruction, and a seek
   * replays from the entry block with the data segment cleared, so the fight
   * you were watching is gone. This puts the world back exactly as it stood
   * half a second ago, mid-fight, which is the thing the awkward bug wants —
   * *it only happens after the second zombie dies*.
   *
   * It goes through `loadSnapshot`, so it is the same `World.load` → `resync`
   * a Load button press and a seek take. A rewind cannot leave a rig in a pose
   * play would never produce, because there is no second rebuild path for it
   * to take.
   *
   * The transport is deliberately left alone. A rewind is a jump in time, not
   * a change of transport state — the same as Load — and rewinding while
   * playing is precisely how you watch the moment again.
   */
  rewind(): void {
    const snap = this.ring.take(this.ctx.frame);
    const at = this.ctx.frame;
    if (!snap) {
      this.onFeed({
        seq: -1, block: this.walker?.block ?? -1, step: -1, opIndex: -1,
        op: { i: -1, at: 0, op: -1, name: "rewind", cat: "flow" },
        note: "nothing in the ring older than this frame",
      });
      return;
    }
    const err = this.loadSnapshot(snap);
    this.onFeed({
      seq: -1, block: this.walker?.block ?? -1, step: -1, opIndex: -1,
      op: { i: -1, at: 0, op: -1, name: "rewind", cat: "flow" },
      note: err ?? `frame ${at | 0} → ${snap.frame | 0}`
          + ` · ${this.ring.view.depth} slots left`,
    });
    this.pushUrl();
  }

  seekTo(block: number, step: number, op: number): void {
    const w = this.walker;
    if (!w) return;
    this.playing = false;
    this.clearFeed();
    // No `hudLayer.reset()` here any more. The shutter and the caption are
    // the walker's state, `seekWalkerTo` resets it with everything else, and
    // `world.resync` redraws from what the replay left -- one rebuild path
    // rather than one path plus a thing this had to remember.
    this.shooting.reset();
    // The replay rebuilds the spawn list, so the placers must be able to run
    // again -- otherwise the pre-seek props stand there for ever.
    ResetPropContainers();
    // ...and the data segment with them. A seek used to leave the whole of `G`
    // exactly as the run before it left it: the actor pool, the enemy ring
    // tables, `g_frame`, and -- the one that bites -- `g_coli_full_set`, which
    // a `collision` op sets and no op ever clears. Seeking *backwards* past
    // one therefore arrived with the future's collision world loaded. A load
    // restores the whole segment; a seek has to clear it and let the replay
    // write it again, or the two are not the same rebuild.
    // `web/test/state.test.ts` is what found this: two seeks to one address
    // from different histories reached different worlds.
    ResetGameGlobals();
    // ...but not the half of `G` the replay cannot write. The approach rings
    // come from the bundle, not from an opcode, so clearing them without
    // putting them back parks every enemy in the outermost band for ever.
    if (this.gameTables) this.applyGameTables(this.gameTables);
    // The world RNG, with everything else. A seek resets `G`, the containers,
    // the session scope and the walker -- and left this alone, so two seeks to
    // one address from different histories replayed the script identically and
    // then diverged on the first `rng.int()`. Some thirty-five draw sites in
    // the port consume it: which idle a zombie picks, which attack, the start
    // phase of every clip. `stage_load.ts` was the only place that reseeded, so
    // "the same address" meant the same script state and a different game.
    this.rng.reseed(this.state.seed ?? 1);
    // The replay rewrites the world; nothing that described the old one may
    // outlive it. The rewind ring is part of that: `ctx.frame` goes back to
    // near zero with `g_frame`, so every slot it holds is the future of a
    // timeline this seek has just left.
    this.newSession();
    this.ring.clear();
    seekWalkerTo(w, block, step, op);
    // A seek replaces the world exactly as a snapshot load does, so it takes
    // the same rebuild path. Running only half of it is what let a rig keep a
    // held pose across a seek.
    this.world.resync(this.ctx);
    // No `syncCameraToWalker` and no `props.reset` here any more: the resync
    // pass does both, and the camera's is the stronger of the two -- it seats
    // the block on the rail even where the restored shot's action has already
    // retired. Two rebuild paths that nearly agree is the thing being removed.
    this.syncBgmToWalker();
    this.state.block = block;
    this.state.step = step;
    this.state.op = op;
    this.state.slot = this.state.frame = undefined;
    this.pushUrl();
  }

  /** `?slot=59&frame=170`: pose the camera straight off a path, no script. */
  poseFromSlot(slot: number, frame: number): void {
    this.cam.poseFromSlot(this.ctx, this.walker?.rollEnabled ?? false,
                          this.walker?.useFixedEyeY ?? false,
                          this.walker?.fixedEyeY ?? 0, slot, frame);
  }

  // -- walker callbacks --------------------------------------------------

  onCamera(cmd: CamCommand): void {
    const p = this.paths?.paths.get(cmd.slot);
    this.cam.rails?.highlight(
      cmd.slot,
      Math.min(cmd.startFrame, cmd.endFrame),
      Math.max(cmd.startFrame, cmd.endFrame),
    );
    if (!p) {
      this.onFeed({
        seq: -1, block: this.walker?.block ?? -1, step: -1, opIndex: -1,
        op: { i: -1, at: 0, op: 0x30, name: "cam_play", cat: "camera" },
        note: `slot ${cmd.slot} is not in this stage's cam file`,
      });
      return;
    }
    // `CamStartPathPlayback` (`FUN_00403510`) ends by calling
    // `CamAdvancePathFrame` itself, and `CamEvalStaticPose` writes the block
    // outright: a new shot always seats the camera on its own pose rather
    // than swinging onto it. That is what keeps the script's cuts sharp — and
    // 148 of the 631 consecutive `cam_play` pairs in stages 1-6 are cuts, some
    // of them a full 173 degrees.
    seatCamera(this.cam, this.ctx, true);
  }

  /** The feed is capped so a long session cannot grow without bound. */
  private static readonly FEED_MAX = 400;

  /**
   * The next feed row's key, and it never goes back.
   *
   * `clearFeed` does not reset it and neither does a seek or a load, which is
   * the whole requirement: React only asks that a key never repeat among the
   * rows it is looking at, and the cheapest way to promise that is a counter
   * with no way of going down. `FeedEntry.seq` cannot do the job — it is the
   * walker's instruction counter, it is in the snapshot, a load or a seek
   * restores it, and the dozen handlers below that raise an entry for
   * something that is not an instruction all pass `seq: -1`.
   */
  private feedSeq = 0;

  onFeed(e: FeedEntry): void {
    this.feedRows =
      [...this.feedRows, feedRow(e, this.feedSeq++)].slice(-Player.FEED_MAX);
  }

  clearFeed(): void {
    this.feedRows = [];
  }

  /**
   * Show a branch point in the bar at the bottom of the window.
   *
   * Not a modal. A branch is a fact about where playback has got to, not a
   * question that has to be answered before anything else can happen -- so
   * the script, the scrubber and free roam all stay usable while it is up,
   * and it never covers the shot you are choosing between.
   */
  /** True while the pointer is over the branch bar; freezes the countdown. */
  branchHover = false;


  // -- per-frame ---------------------------------------------------------

  /**
   * After a seek, play whatever track the replay last passed.
   *
   * The replay itself is silent -- retriggering audio for every instruction
   * skipped over would be a burst of stops and starts -- so the walker records
   * the track and the result is applied once, here.
   */
  syncBgmToWalker(): void {
    const t = this.walker?.bgmTrack;
    if (t !== null && t !== undefined && t !== 0) this.bgm.play(t);
  }

  /**
   * Seat and draw in one go, for the paths that have no game tick between —
   * a seek, a slider drag, a stage that has just finished loading.
   *
   * `force` puts the aim on the rail even though the shot's action has
   * retired. See `seatCamera` in `app/systems.ts`.
   */
  syncCameraToWalker(force = false): void {
    syncCamera(this.cam, this.ctx, force);
  }

  // -- what a frame is made of -------------------------------------------
  //
  // The four hooks of `PacerHost`, in the order `app/pacer.ts` calls them.
  // Between them they are everything a frame *does*; when it happens, and
  // whether it happens at all, is the pacer's.

  /**
   * The frame has begun, before any tick it owes.
   *
   * `lifeFrame` is the scope panel's clock — frames since the page loaded,
   * which never resets, because `ctx.frame` restarts on every stage load and
   * so cannot order two scopes across a stage switch.
   *
   * Free roam used to fly here, by hand, for the reason that it rides wall
   * time rather than game time. It is a render-phase `System` now — step 23 —
   * so it is inside `resync` and a seek can no longer leave the camera
   * somewhere play would never put it. The ordering that made a hand call
   * look necessary is expressed as its position in the tick order instead.
   */
  // `_wall` because nothing left in this hook rides wall time: free roam was
  // the only thing that did. The parameter stays because `PacerHost` declares
  // it, and a hook that drops it would have to be re-added to move anything
  // back here.
  beginFrame(_wall: number): void {
    this.lifeFrame += 1;
  }

  /**
   * The frame a stopped player still gets.
   *
   * Everything `stepOneFrame` does except advance any game time: the render
   * layers pose against the camera, and the systems that ride `t.wall` get
   * the real delta. `world.update` is the one call for the whole tick order
   * whether or not the order has anything to do.
   */
  idleTick(t: Tick): void {
    if (!this.walker) return;
    this.pushPortGlobals();
    this.cam.driving = !this.scrubbing;
    this.cam.scripted = this.state.mode !== "free";
    this.world.update(this.ctx, t);
  }

  /** The stage a picture is owed of, or 0. See {@link Player.requestThumb}. */
  private thumbStage = 0;
  /** Frames still to let pass. The script places the camera on the way in. */
  private thumbDelay = 0;

  /**
   * Keep a picture of this stage, once the next few frames have gone by --
   * **but only if it has none.**
   *
   * The bundle screen's stage picker shows one, and it is the player's own
   * frame rather than an image in the repository: a screenshot of the game is
   * game-derived data, and none of that is committed here.
   *
   * This is the fallback. {@link Player.captureThumb} is the real one, taken
   * seven seconds into the stage when it is built, and it is the picture worth
   * keeping -- so this must not overwrite it. Eight frames after a load is
   * whatever the script has put on screen by then, which for most stages is a
   * shutter closing over a camera that has not moved yet. The gate is what
   * makes the two coexist: a stage the browser built shows the deliberate
   * frame, a stage that was only ever served shows something rather than
   * nothing.
   */
  requestThumb(stage: number): void {
    // `captureThumb` loads a stage too, and it is taking the real picture of
    // it. Two requests for one stage is how the deliberate one got
    // overwritten by a frame from the middle of the next stage's teardown.
    if (this.capturing) return;
    void hasThumb(stage).then((has) => {
      // Asking the file system is asynchronous, and a stage switch is faster
      // than it: by the time this answers, the player may be somewhere else.
      if (has || this.capturing || this.state.stage !== stage) return;
      this.thumbStage = stage;
      this.thumbDelay = 8;
      this.wake();
    });
  }

  /**
   * Keep the frame just drawn, if one is owed.
   *
   * It has to happen **here**, in the same task as the draw: the renderer is
   * not built with `preserveDrawingBuffer`, so the back buffer is gone by the
   * next turn of the loop and `toBlob` would hand back a blank image. That is
   * also why this is a frame-loop concern and not something the loader can do
   * for itself after an await.
   */
  private keepThumb(): void {
    if (this.thumbStage === 0) return;
    // **Not during a load.** The scene has been torn down and the next one is
    // not built, so what is on the canvas is the clear colour -- and this is
    // exactly how a good picture came to be replaced by a flat fill of the
    // fog: a second request, armed by the loader, landed a second later while
    // the stage after it was being taken apart. Still armed, so it fires when
    // there is something to photograph.
    if (this.loading) return;
    // The stage moved on while this was waiting. Whatever is on screen now is
    // not what was asked for.
    if (this.state.stage !== this.thumbStage) {
      this.thumbStage = 0;
      const gone = this.thumbDone;
      this.thumbDone = null;
      gone?.();
      return;
    }
    if (this.thumbDelay-- > 0) {
      // Ask for the next one. The loop sleeps whenever the game clock is
      // stopped, which is what a stage that has just loaded is: without this
      // the countdown got exactly the one frame `requestThumb` woke, then sat
      // at seven for ever and no picture was ever taken.
      this.wake();
      return;
    }
    const stage = this.thumbStage;
    this.thumbStage = 0;
    this.grabThumb(stage);
    const done = this.thumbDone;
    this.thumbDone = null;
    done?.();
  }

  /** Resolved by {@link Player.keepThumb} once the picture is taken. */
  private thumbDone: (() => void) | null = null;

  /**
   * Take the picture on the **next frame**, and wait for it.
   *
   * `keepThumb` runs from `endFrame`, in the `requestAnimationFrame` callback
   * that drew the frame, and that turns out to be the only place this works.
   * Rendering and copying inline -- `renderer.render(...)` immediately
   * followed by `drawImage` in the same synchronous block, off the frame loop
   * -- draws (222 calls, 2,880 triangles, measured) and then copies **the
   * clear colour**: a flat fill of the fog, every time. So the rule in
   * {@link Player.grabThumb} is stronger than "the same task"; it is "the
   * frame callback", and the way to take a picture is to ask the loop for one.
   */
  private nextThumb(stage: number): Promise<void> {
    return new Promise<void>((resolve) => {
      this.thumbStage = stage;
      this.thumbDelay = 0;
      this.thumbDone = resolve;
      this.wake();
      // A picture is not worth hanging the page for. The loop is running --
      // the transport is playing, so `wantsFrame` is true -- but if anything
      // stops it, the stage load waiting behind this must still happen.
      setTimeout(() => {
        if (this.thumbDone !== resolve) return;
        this.thumbStage = 0;
        this.thumbDone = null;
        resolve();
      }, 4000);
    });
  }

  /**
   * Copy the frame **now on the back buffer** into the thumbnail store.
   *
   * Synchronous up to the copy, for the reason above: `drawImage` off the
   * WebGL canvas has to happen in the task that drew it. `toBlob` afterwards
   * reads the 2D canvas, which is an ordinary bitmap and keeps.
   */
  private grabThumb(stage: number): void {
    const w = 320;
    const h = Math.max(1, Math.round(
      w * this.canvas.height / Math.max(1, this.canvas.width)));
    const small = document.createElement("canvas");
    small.width = w;
    small.height = h;
    const ctx = small.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(this.canvas, 0, 0, w, h);
    small.toBlob((blob) => {
      if (blob) void writeThumb(stage, blob);
    }, "image/png");
  }

  /**
   * Take a stage's picture seven seconds into it, by playing it.
   *
   * **What a stage looks like is not what its first frame looks like.** Every
   * stage opens on a closed shutter, an unplaced camera, or a region that has
   * not streamed in, so a picture taken on arrival is a picture of the loading
   * moment. Two seconds of the game's own clock is past all of that and is the
   * same seven seconds every time, on any machine: the port is deterministic
   * given the stage and the seed, so this is a property of the stage rather
   * than of whoever happened to be watching.
   *
   * It is simulated rather than waited out. {@link Player.stepOneFrame} is the
   * one unit of game time in the player and the driven clock already calls it
   * in a loop; 420 of them is seven seconds and takes a fraction of one.
   *
   * **It plays the stage to do it**, which means loading it, so the caller
   * gets the player back pointed at this stage at frame 120 and must put it
   * where it belongs afterwards -- {@link Player.closeBundles} does, with the
   * load it was going to do anyway. Audio is muted across it: a thumbnail of
   * stage 5 taken while you are playing stage 3 should not start stage 5's
   * music for seven seconds.
   */
  async captureThumb(stage: number, original: boolean): Promise<void> {
    // Everything this disturbs, put back in the `finally`. The **world** is
    // not on that list: it is left holding the stage that was photographed,
    // and the caller reloads. That is deliberate rather than lazy -- the
    // caller was going to load a stage anyway, and undoing this one here
    // would mean loading twice for nothing.
    const was = { ...this.state };
    const wasMuted = this.bgm.muted;
    const wasPlaying = this.playing;
    this.bgm.setMuted(true);
    this.state.stage = stage;
    this.state.original = original;
    this.state.block = this.state.step = this.state.op = undefined;
    this.state.slot = this.state.frame = undefined;
    // The walker only advances in `play` with the transport running.
    this.state.mode = "play";
    // Nothing goes through `pushUrl` here: the address bar should not spend
    // seven seconds describing a stage nobody asked to look at.
    this.capturing = true;
    try {
      await this.loadStage();
      // **After the load, not before.** `loadStageInto` stops the transport
      // on its way in -- a stage arrives paused whoever asked for it -- so a
      // `playing` set before the await is a `playing` that has been cleared by
      // the time the frames run. It looked like it worked: the walker still
      // reaches its first wait, the region still streams, and the picture
      // still came out. It came out as a flat fill of the fog colour.
      this.playing = true;
      for (let i = 0; i < THUMB_FRAMES; i++) {
        if (!this.stepOneFrame()) break;
      }
      // Handed to the frame loop rather than drawn here; `nextThumb` says why
      // that is not a detail.
      await this.nextThumb(stage);
    } finally {
      this.capturing = false;
      Object.assign(this.state, was);
      this.playing = wasPlaying;
      this.bgm.setMuted(wasMuted);
    }
  }

  /**
   * A thumbnail is being taken, so the address bar is not the player's.
   *
   * `syncUrlToWalker` runs off `stepOneFrame`, and seven seconds of it would
   * write a hundred addresses in a stage the viewer never asked to see -- and
   * leave the last one behind if anything threw.
   */
  private capturing = false;

  /** Draw, then publish. Every frame, whether or not it owed a tick. */
  endFrame(): void {
    this.renderer.render(this.scene, this.camera);
    this.keepThumb();
    // The one update path, and it is unconditional on purpose. A projection a
    // frame, published only when it differs -- so the sidebar and the globals
    // panel are live while the clock is stopped, and the loading overlay is
    // live before there is a stage to tick.
    this.publishUi();
  }

  /**
   * Ask for a frame.
   *
   * The player's half of the chokepoint: everything that changes what is on
   * screen calls this, and `app/pacer.ts` is what it means. The wakers are
   * few and they are all chokepoints -- `runCommand`, the keydown handler,
   * `popstate`, `setLoading`, `fail`, a shot, and the harness.
   * `web/tools/pacing.mjs` is what proves the sleep and the waking, on the
   * real page.
   */
  wake(): void {
    this.pacer.wake();
  }

  /**
   * Is there game time for a frame to owe?
   *
   * `Loop.running` is set from this, and it is the difference between a
   * transport that is stopped and one that is merely between ticks: a paused
   * player, a free-roam session and a page with no stage on it accrue no debt
   * at all rather than accruing one nobody wants paid. See `app/loop.ts`,
   * "a debt worth dropping is never allowed to form".
   */
  get gameRunning(): boolean {
    return !this.gameStopped && !!this.walker;
  }

  /**
   * Is there anything for another frame to do?
   *
   * The answer is no more often than it looks: a paused player with no sprites
   * out has nothing to draw that is not already drawn, and `?freeze=1` means
   * *one* frame by definition. Step mode is not in that list on purpose — the
   * script stands still there but the port does not, which is what makes a
   * zombie loop its walk while you read the tree.
   *
   * **Free roam is above the freeze, and that is the whole of it.** `freeze`
   * stops *game* time; the free camera is not game state and flies on
   * `Tick.wall`, which `render/freeroam.ts` says in its own header and which
   * `FreeRoam.update` has done since it became a system. But this test sat
   * below the freeze, so a frozen free-roam player was asked for no frames at
   * all: WASD moved the camera exactly one frame — the one the keydown waker
   * bought — and then the loop went back to sleep and the keys did nothing.
   * Pausing to look around is the obvious way to use free roam, so it was the
   * common case that was broken.
   *
   * The driven case is not here: under `?drive=1` the harness owns the clock,
   * so it owns the question, and `Pacer` asks it instead.
   */
  wantsFrame(): boolean {
    if (this.loading) return true;
    if (this.state.mode === "free") return true;
    if (this.state.freeze) return false;
    if (!this.gameStopped) return true;
    // Feedback for a click outlives the click.
    return this.shooting.busy;
  }

  /** The script-owned globals the port reads. See `app/systems.ts`. */
  private pushPortGlobals(): void {
    if (!this.walker) return;
    syncPortGlobals(this.walker, this.state.mode === "free",
                    this.camera.position);
    // The spawn opcodes, made real. `SpawnPropContainers` above does class
    // 0x41's; this does the characters, and both sit here for the same reason
    // — the script phase, so an actor spawned by an instruction ticks on the
    // frame that instruction ran, exactly as `SpawnFromDescriptor`'s does.
    // What the script stopped placing leaves the world here rather than in
    // the layer that noticed: `render/` may notice that a spawn is placeable,
    // it does not get to decide that an object exists or that a lifetime has
    // ended. `verify_layers.py` is what keeps that honest, and
    // `syncCharacterSpawns` is where the three layers meet.
    syncCharacterSpawns(this.chars, this.walker.spawns);
  }

  /**
   * Is the **game** clock stopped?
   *
   * Two cases, and neither is `?freeze=1`, which stops everything including
   * wall time:
   *
   * * **paused** — play mode with the transport stopped. Nothing should move:
   *   an enemy holds the frame it was on, its motion clock does not advance,
   *   and neither does the port.
   * * **free roam** — you are flying the camera around a scene, not watching
   *   it. `Loop.idle` has said "for the frozen and free-roam paths" since it
   *   was written; free roam simply never took it.
   *
   * **Step mode is deliberately not here.** Stepping is for advancing the
   * script an instruction at a time while the port keeps running underneath —
   * that is what makes a zombie loop its walk while you read the tree — and it
   * has its own mode button rather than a paused transport.
   */
  private get gameStopped(): boolean {
    if (this.state.mode === "free") return true;
    return this.state.mode === "play" && !this.playing;
  }

  /**
   * One whole 60 Hz frame — the walker and the port, together.
   *
   * The driven clock's only unit of work, and the shape the engine's own frame
   * has: `g_cam_path_frame` is `__ftol`'d and steps by exactly one, so an
   * exact-frame cue is safe there and is only unsafe here because the port is
   * normally handed `frames: wall * 60`. This hands it 1.
   *
   * **The one unit of simulated work in the player**, driven or not: the wall
   * clock reaches it through `Loop.advance`, and a driver reaches it through
   * `Harness.pump`. The walker only runs while the transport is playing and
   * off a branch, the port runs unless the transport has stopped it, and
   * `world.update` is the one call for the whole tick order.
   *
   * `speed` is deliberately not applied. Under the flag a frame is a frame;
   * the driver sets the rate by asking for more or fewer of them.
   */
  stepOneFrame(): boolean {
    const w = this.walker;
    if (!w || this.state.freeze) return false;
    if (this.playing && this.state.mode !== "free") {
      if (w.branch) {
        // On the script's clock rather than the wall's. The countdown is what
        // picks the route when nobody answers it, so a branch that expired
        // after a variable number of frames put the whole rest of the stage on
        // a different frame in every run.
        if (!this.branchHover) w.tickBranchCountdown(TICK);
      } else if (!w.finished) {
        w.tick(TICK);
        this.syncUrlToWalker();
      }
    }
    this.pushPortGlobals();
    this.cam.driving = !this.scrubbing;
    this.cam.scripted = this.state.mode !== "free";
    this.world.update(this.ctx,
                      this.gameStopped ? STOPPED_TICK : DRIVEN_TICK);
    // The history a rewind walks back through, offered every tick and taken
    // on the ring's own cadence. Here rather than in the pacer because a
    // snapshot is game state and this is the one place game state moves.
    if (!this.gameStopped) {
      this.ring.offer(this.ctx.frame, () => this.saveSnapshot());
    }
    // A finished stage is the one thing that stops the accumulator mid-drain:
    // the ticks it would have run are not owed, because there is nothing left
    // to run them.
    if (w.finished) this.advanceScene();
    return !w.finished;
  }

  /**
   * Whether a stage that has run out is currently being followed by the next.
   *
   * A load is minutes on a cold cache and one tick is nothing like that long,
   * so the flag is what stops the frame loop asking again every 16 ms.
   */
  private advancing = false;

  /**
   * The stage-to-stage transition: the run's phase machine, as much of it as
   * the port has.
   *
   * The engine spends two run phases and a scene load on this. When the route
   * table walks off the end of a scene, `EvtAdvanceStepOrRoute`
   * (`FUN_0045F000`) calls `MarkSceneOver` (`FUN_0045ED90`), which hands
   * `g_nRunPhase` to 5; `RunPhaseArmSceneAdvance` (`FUN_00460390`) steps it to
   * 6; `RunPhaseStepToNextScene` (`FUN_004603B0`) does `g_scene_index += 1`
   * and hands it to 1; and phase 1 is `AdvanceToNextScene` (`FUN_0045FFF0`),
   * which parks both players out of *in play* and calls `LoadSceneAndReset`.
   *
   * **The block the next stage opens at is decided before any of that**, by
   * the scene-over path itself, and it travels in `g_evt_block_index` because
   * nothing on the way touches that global. `Walker.nextEntryBlock` is the
   * port's copy of the value; see it for the arithmetic and the proof.
   *
   * What the port does not have: the continue screen the engine reaches
   * through phases 2, 3 and 4 when a player is out of *in play*, and the
   * ending it reaches at phase 7 once the increment passes the last stage.
   * The player stops on the last stage instead.
   *
   * `[diverges]` **The stage carries its transport and its mode across.** The
   * engine has one run and one transport; the port has a Play button and a
   * Step button and a stage picker, and a viewer who stepped into the end of a
   * stage does not want the next one running away from them. So the advance
   * only fires in `play` mode with the transport running, which is the only
   * arrangement that corresponds to a run at all.
   */
  private advanceScene(): void {
    if (this.advancing || this.capturing) return;
    if (this.state.mode !== "play" || !this.playing) return;
    const next = this.state.stage + 1;
    const entry = this.walker?.nextEntryBlock;
    if (entry === undefined || entry === null) return;
    if (!this.stages.includes(next)) return;
    this.advancing = true;
    this.state.stage = next;
    this.state.entry = entry;
    this.state.block = this.state.step = this.state.op = undefined;
    this.state.slot = this.state.frame = undefined;
    this.pushUrl();
    void this.loadStage().finally(() => {
      this.advancing = false;
      // `loadStageInto` stops the transport, and a run does not stop between
      // stages. Restarted after the load for the same reason `captureThumb`
      // does it there: the load is what cleared it.
      if (this.state.mode === "play") this.playing = true;
    });
  }

  /**
   * The paused state, on screen: the rendered frame drains to grey and the
   * word sits in the middle of it.
   *
   * Free roam stops the same clock but does **not** raise this — it is a mode
   * you chose, with its own lit button, and covering the view you are flying
   * through with `PAUSED` would be worse than saying nothing.
   */
  get paused(): boolean {
    return this.state.mode === "play" && !this.playing && !!this.walker;
  }

  // -- save state --------------------------------------------------------

  /**
   * The whole game state, as a plain value.
   *
   * Everything that determines the next frame and nothing that does not: the
   * walker's program counter and flags, the data segment, the object pool, and
   * the RNG. No three.js, because the renderers rebuild from those.
   */
  saveSnapshot(): Snapshot {
    return this.world.save(this.ctx);
  }

  /**
   * Start a new session scope.
   *
   * Everything that describes *how the game got where it is* — as opposed to
   * where it is — hangs off this, and a seek or a snapshot load makes that
   * history untrue. Recycling the scope is what makes "a seek cannot leave a
   * layer holding state play would never produce" structural rather than a
   * thing each `resync` has to remember.
   */
  newSession(): void {
    this.ctx.session.dispose();
    this.ctx.session = this.stageScope!.child("session");
  }

  /**
   * Build this frame's projection and hand it to React.
   *
   * The `key` is what decides whether anything is published at all. A sidebar
   * that has not changed being diffed sixty times a second is the cost this
   * avoids, and it is cheaper to build a short string here than to let React
   * walk a few hundred rows — the scope tree alone is the whole disposal graph.
   */
  /**
   * What a `UiCommand` means.
   *
   * Exhaustive on purpose: the union in `ui/commands.ts` is the list of
   * everything the UI can ask for, and adding a case there without one here
   * fails to compile. That is the property `wireUi`'s sixteen anonymous
   * listeners could not have.
   */
  /**
   * Every UI command, and a frame to show what it did.
   *
   * The `wake` is here rather than at each command because this is the one
   * door: a setting that took effect and did not redraw would look like the
   * setting not working, and a paused player is asleep.
   */
  private runCommand(c: UiCommand): void {
    this.wake();
    this.dispatchCommand(c);
    // One place, rather than a `write` on each of twenty controls. Cheap: it
    // is a small object and only a command can have changed it.
    if (PREF_COMMANDS.has(c.kind)) this.saveViewPrefs();
  }

  private dispatchCommand(c: UiCommand): void {
    runCommand(this, c);
  }

  /** Everything a fresh stage has to be told about the current toggles. */
  applyAllToggles(): void {
    for (const [name, on] of Object.entries(this.toggles)) {
      applyToggle(this, name as ToggleName, on);
    }
  }



  /**
   * This frame's projection, if it differs from the last.
   *
   * The `Player` satisfies `PlayerView` structurally, so the read-only
   * interface in `app/projection/player.ts` is the whole list of what the UI
   * depends on — and nothing in the builder can write back.
   */
  private publishUi(): void {
    // The boxes follow the sidebar's selection whether or not the sidebar is
    // drawn, so this is computed before anything is folded away.
    this.debug.highlight = highlightSet(
      this.walker, this.boxedClasses, this.boxWait);
    // Same reasoning, one layer over: the composition root is what sees both
    // the panel's selection and the layer that can draw it.
    this.rigs.highlight = this.boxedRigs;

    // `stabilise` inside the builder hands back the value the store already
    // holds when nothing moved, so `publish` decides with an identity test.
    // There is no key, no counter and no list of fields to keep in step.
    this.ui.publish(buildProjection(this, this.ctx, this.ui.getSnapshot()));
  }

  /** Put one back. Returns the reason it was refused, or null. */
  loadSnapshot(snap: Snapshot): string | null {
    // Before `load`, because `load` ends by resyncing every system and a
    // system's `resync` claims the *new* session.
    this.newSession();
    const err = this.world.load(snap, this.ctx);
    if (err) return err;
    // Every layer has resynced, the camera included -- it is the first system
    // in the render phase, so the rest posed against the shot it restored.
    this.markAddress();
    return null;
  }

  /**
   * Remember where the script is, for the next `pushUrl`.
   *
   * The other half of what `refreshUi` did, and the only half that was ever
   * about state rather than about drawing. It is called from the paths that
   * *move* the script and nowhere else -- `setStage` and `reset` deliberately
   * clear the address, and a sync folded into `pushUrl` would put it back.
   */
  markAddress(): void {
    const w = this.walker;
    if (!w) return;
    this.state.block = w.block;
    this.state.step = w.step;
    this.state.op = w.opIndex;
  }

  // -- chrome ------------------------------------------------------------

  resize(): void {
    const w = this.viewport.clientWidth;
    const h = this.viewport.clientHeight;
    if (w === 0 || h === 0) return;
    if (this.pillarbox) {
      // The game is 4:3 and its vertical FOV is fixed, so filling a wide
      // window would either stretch the image or silently widen the shot.
      const aspect = 4 / 3;
      const cw = Math.min(w, h * aspect);
      const ch = cw / aspect;
      this.renderer.setSize(cw, ch, true);
      this.canvas.style.margin = `${(h - ch) / 2}px ${(w - cw) / 2}px`;
      this.camera.aspect = aspect;
    } else {
      this.renderer.setSize(w, h, true);
      this.canvas.style.margin = "0";
      this.camera.aspect = w / h;
    }
    this.camera.updateProjectionMatrix();
  }

  /**
   * The overlay over the viewport.
   *
   * A field and nothing else. The element is React's, and the frame loop is
   * running from before the bundle is fetched -- so the next frame picks this
   * up the same way it picks up everything else, including `fail`, which runs
   * when no stage will ever load and used to be the reason for a second
   * publish path here.
   */
  setLoading(text: string | null): void {
    this.loading = text === null ? null : { text, failed: false };
    this.wake();
  }

  fail(msg: string): void {
    this.loading = { text: msg, failed: true };
    this.wake();
  }

  pushUrl(): void {
    writeState(this.state);
  }

  /**
   * Keep the address in the URL current while the script plays.
   *
   * The URL is the only thing that survives a page reload or a Vite HMR
   * update, and `applyIncomingState` can only seek to an address it is given —
   * so without this a refresh part-way through a stage restarts at the entry
   * block, which is a long way back from wherever you were looking.
   *
   * `replaceState` rather than `pushState`, so playing does not fill the back
   * button with one entry per instruction, and throttled because Safari
   * rate-limits the history API to roughly one call every 300 ms.
   */
  private syncUrlToWalker(): void {
    const w = this.walker;
    if (this.capturing) return;
    if (!w || this.state.mode === "free" || this.state.slot !== undefined) {
      return;
    }
    // *What* goes in the URL is here; *how often* is `Pacer.mayWriteUrl`,
    // which owns the throttle and the clock it is measured against.
    if (!this.pacer.mayWriteUrl(`${w.block}/${w.step}/${w.opIndex}`)) return;
    this.state.block = w.block;
    this.state.step = w.step;
    this.state.op = w.opIndex;
    // The frame within the running camera move, so a reload comes back to the
    // same shot rather than to the beginning of it.
    this.state.frame = w.cam ? Math.round(w.cam.frame) : undefined;
    this.pushUrl();
  }
}

// React first: the canvas and the viewport are its elements, so the `Player`
// is built once it has committed them and handed them over. Nothing here
// reaches into the document for a mount point of its own.
//
// Once, and guarded: an effect that runs twice -- strict mode, or a dev-server
// remount -- would build a second `Player` over the same canvas, and the two
// would fight for the frame.
let player: Player | null = null;
const ui = new UiStore();
mountUi(ui, (host) => {
  if (player) return;
  player = new Player(ui, host);
  void player.start();
}, (label, error, info) => {
  // A panel that threw belongs in the transcript, next to whatever the script
  // was doing when it did. That is the whole point of the feed: it is the one
  // place the session reads back in order, and a boundary's fallback says
  // *which* region died but not *when*.
  //
  // `console.error` as well, always. The feed is capped at four hundred rows,
  // a throw that repeats will push its own cause off the top, and the stack is
  // in the console and nowhere else.
  console.error(`ui: ${label} threw`, error, info);
  // Before `Player` exists there is nothing to push into. That window is real
  // -- `mountUi` calls `createRoot(...).render(...)` and the very first render
  // happens before `onHost` has handed the canvas over -- and the console line
  // above is the whole of the report for anything thrown inside it.
  if (!player) return;
  // `onFeed` assigns an array and nothing else. It must not publish: this runs
  // inside React's error handling, and publishing from there would re-enter
  // the render that is in the middle of failing. The next frame picks the row
  // up like any other.
  player.onFeed({
    seq: -1, block: -1, step: -1, opIndex: -1,
    op: { i: -1, at: 0, op: -1, name: "ui error", cat: "flow" },
    note: `${label} threw: ${error instanceof Error ? error.message
                                                    : String(error)}`,
  });
});
