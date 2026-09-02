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
import {
  loadManifest,
  type Manifest,
} from "../bundle";
import type { SoundJson } from "../bundle/scene";
import type { ScriptJson } from "../bundle/stage";
import { CamPaths } from "../render/campath";
import { CameraDrawSystem, CameraRig, CameraSeatSystem, CameraTakeSystem }
  from "../render/camera";
import { StageScene } from "../render/stagescene";
import { SpawnLayer } from "../render/overlays";
import { FreeRoam, isTyping } from "../render/freeroam";
import { Walker, type CamCommand, type FeedEntry } from "../script/walker";
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
import { describeShutter, groupRows, hudRows, type HudInputs }
  from "./projection/hud";
import type { RigSource } from "./projection/rigs";
import type { DebugGroupName, StripRow } from "../ui/projection";
import {
  branchProjection, skipProjection, soundProjection, transportProjection,
} from "./projection/chrome";
import { SceneFog } from "../render/fog";
import { SceneLighting } from "../render/lighting";
import { applyToggle, runCommand, type PlayerCommands } from "./commands";
import { loadStageInto } from "./stage_load";
import { Events } from "../core/events";
import { Rng } from "../core/rng";
import type { Tick } from "../core/system";
import type { RenderContext } from "../render/context";
import { CameraFrame } from "../core/camera";
import type { Snapshot } from "../core/snapshot";
import { Loop, TICK } from "./loop";
import { GameSystem, ScriptSystem, drawSystem, syncPortGlobals }
  from "./systems";
import { ProjectileLayer } from "../render/projectiles";
import { DebugBoxLayer } from "../render/debug";
import { Hud as HudLayer } from "../hud/hud";
import { Rain } from "../render/rain";
import { RainSystem } from "../game/effects/rain";
import { BreakableLayer } from "../render/breakables";
import { ResetPropContainers } from "../game/class41";
import { ResetGameGlobals } from "../game/globals";
import { ActorRetireFromWorld } from "../game/despawn";
import { SetGameTables } from "../game/tables";

/**
 * How often the playing address may be written back to the URL.
 *
 * Safari throttles `history.replaceState` to about one call every 300 ms and
 * throws once a page exceeds it, so this stays comfortably the safe side.
 */
const URL_SYNC_MS = 500;

/** Before a stage is up there is nothing to report, and the shape is fixed. */
const EMPTY_GROUPS: Readonly<Record<DebugGroupName, readonly StripRow[]>> = {
  camera: [], scene: [], actors: [], props: [], collision: [], shooting: [],
};

/** The commands that change something worth remembering across a reload. */
const PREF_COMMANDS: ReadonlySet<string> = new Set([
  "toggle", "setLightMode", "setFogMode", "setPillarbox", "setSpeed",
]);

export class Player implements PlayerView, PlayerCommands {
  private readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  /** React's, handed over once it has them. See `app/ui_root.ts`. */
  private readonly viewport: HTMLElement;
  private readonly canvas: HTMLCanvasElement;

  manifest!: Manifest;
  /** Which stages the bundle holds, for the picker. */
  stages: number[] = [];
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
  readonly lighting: SceneLighting;
  readonly backdrop = new Backdrop();
  readonly rigs = new RigLayer();
  readonly chars = new CharacterLayer();
  readonly props = new PropLayer();
  readonly breakables = new BreakableLayer();
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
  private readonly loop = new Loop();
  readonly script = new ScriptSystem();
  /** Approach, attack permits, and the look-at the camera tracks. */
  private readonly game = new GameSystem();
  readonly bullets = new ProjectileLayer();
  /** Debug overlays: unported classes, the permit holder, the awaited enemies. */
  readonly debug = new DebugBoxLayer();
  readonly rain = new Rain();
  /** The rain pool, advanced in the game phase. See `game/effects/rain.ts`. */
  readonly rainSim = new RainSystem();
  readonly hudLayer: HudLayer;

  state: PlayerState = readState();
  playing = false;
  /** The address last written to the URL, and when — see `syncUrlToWalker`. */
  private urlSyncKey = "";
  private urlSyncAt = 0;
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
    this.freeRoam = new FreeRoam(host.viewport);
    // Both take the nodes React rendered for them rather than a parent to
    // insert into: the crosshair and the four hud divs are `#viewport`'s
    // children and `#viewport` is React's element, so React renders them and
    // hands them across in `UiHost`. See `ui/panels/Viewport.tsx`.
    this.shooting = new Shooting(host.viewport, host.crosshair, this.chars);
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
    this.sceneFog = new SceneFog(this.scene);
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
    this.world.add("game", this.rainSim);
    this.world.add("render", new CameraDrawSystem(this.cam));
    // Everything below poses against the camera the draw just placed.
    this.world.add("render", this.spawns);
    this.world.add("render", this.sceneFog);
    this.world.add("render", this.lighting);
    this.world.add("render", this.backdrop);
    this.world.add("render", this.rigs);
    this.world.add("render", this.chars);
    this.world.add("render", this.props);
    this.world.add("render", this.breakables);
    this.world.add("render", this.bullets);
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
  get camEye(): { x: number; y: number; z: number } {
    return this.camera.position;
  }
  get tree(): TreeProjection | null { return this.treeProj; }
  get minimap(): MinimapGraph | null { return this.minimapGraphData; }
  get feed(): readonly FeedRow[] { return this.feedRows; }
  /**
   * Everything the debug sidebar reads, built where it is read.
   *
   * One call, two shapes: the Player strip and the per-subject groups. They
   * share every input, so building them apart would mean reading the same
   * dozen layers twice a frame and keeping two argument lists in step.
   */
  private get hudInputs(): HudInputs | null {
    const w = this.walker;
    if (!w || !this.scene3d) return null;
    return {
      mode: this.state.mode,
      allRegions: this.scene3d.visibility === "all",
      drawn: `${this.scene3d.visibleCount} models, `
           + `${this.scene3d.visibleTriangles.toLocaleString()} tris`,
      eye: this.camera.position,
      target: this.cam.pose.target,
      yawBams: this.ctx.view.yawBams,
      describe: {
        characters: this.chars.describe,
        props: this.props.describe,
        rigs: this.rigs.describe,
        breakables: this.breakables.describe,
        shooting: this.shooting.describe,
        coli: this.coliDebug.describe,
        wedged: this.stuckDebug.describe,
        enemies: this.game.describe,
        shutter: describeShutter(w, this.toggles.hud),
        rain: this.rain.describe,
        fog: this.sceneFog.describe,
        light: this.lighting.describe,
        sky: this.backdrop.describe,
      },
    };
  }

  get hudRows(): readonly StripRow[] {
    const w = this.walker;
    const x = this.hudInputs;
    return w && x ? hudRows(w, x) : [];
  }

  get groups(): Readonly<Record<DebugGroupName, readonly StripRow[]>> {
    const w = this.walker;
    const x = this.hudInputs;
    return w && x ? groupRows(w, x) : EMPTY_GROUPS;
  }
  /** Every rig in the stage, for the rigs panel. See `render/rigs.ts`. */
  get rigList(): readonly RigSource[] { return this.rigs.list; }
  get hasSaved(): boolean { return !!this.saved; }
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
    // Before the first `wallDelta`, or the first frame's delta is however
    // long the page took to get here.
    this.loop.start(performance.now());
    requestAnimationFrame(this.frame);
    try {
      this.manifest = await loadManifest();
    } catch (err) {
      return this.fail(
        `${err instanceof Error ? err.message : String(err)}\n\n` +
          "Build a bundle first:\n" +
          '  python3 tools/export_player.py --game-dir "/path/to/THE HOUSE OF THE DEAD 2" --all',
      );
    }

    // The select is React's; this is only the list it draws from.
    this.stages = [
      ...new Set(this.manifest.stages.map((s) => s.stage ?? s.scene)),
    ].sort((a, b) => a - b);
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

  /** Point the port's tables at this stage, and copy what `G` holds of them. */
  applyGameTables(script: ScriptJson): void {
    this.gameTables = script;
    SetGameTables(script.characters, script.breakables, script.set_pieces,
                  script.humanoids, script.coli, script.civilians);
  }

  /** Load the stage the URL names. The sequence is `app/stage_load.ts`. */
  async loadStage(): Promise<void> {
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
      this.onFeed({
        seq: -1, block: this.walker?.block ?? -1, step: -1, opIndex: -1,
        op: { i: -1, at: 0, op: -1,
              name: r.hit ? "shot · hit" : "shot · miss", cat: "combat" },
        note,
      });
    };

    window.addEventListener("keydown", (e) => {
      if (isTyping(e.target)) return;
      if (e.code === "Space") { e.preventDefault(); this.togglePlay(); }
      else if (e.code === "ArrowRight") { e.preventDefault(); this.stepOnce(); }
      else if (e.code === "ArrowLeft") { e.preventDefault(); this.stepBack(); }
      else if (e.code === "Digit1") this.setMode("step");
      else if (e.code === "Digit2") this.setMode("play");
      else if (e.code === "Digit3") this.setMode("free");
      else if (e.code === "Enter") { e.preventDefault(); this.requestSkip(); }
    });

    window.addEventListener("popstate", () => {
      this.state = readState();
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
    // The replay rewrites the world; nothing that described the old one may
    // outlive it.
    this.newSession();
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
    this.cam.seat(this.ctx, true);
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
   * retired. See `CameraRig.seat`.
   */
  syncCameraToWalker(force = false): void {
    this.cam.sync(this.ctx, force);
  }

  private frame = (now: number) => {
    requestAnimationFrame(this.frame);
    this.lifeFrame += 1;
    const wall = this.loop.wallDelta(now);

    // `?freeze=1` halts the clock and renders exactly one frame, so a test can
    // assert against a state rather than against a race.
    this.loop.freeze = !!this.state.freeze;
    this.loop.speed = this.speed;
    this.loop.running = this.playing && this.state.mode !== "free"
                        && !!this.walker && !this.walker.branch;
    if (!this.state.freeze && this.state.mode === "free") {
      this.freeRoam.update(wall, this.camera);
    } else if (!this.state.freeze && this.playing && this.walker) {
      if (this.walker.branch) {
        if (!this.branchHover) this.walker.tickBranchCountdown(wall);
      } else {
        // The 60 Hz frames the walker actually advanced. The shutter slide and
        // the dialogue countdown are script state measured in those frames, so
        // they are driven from here rather than from wall time -- otherwise a
        // caption put up in Step mode quietly expires two seconds later while
        // playback is paused, which is exactly long enough to look at the
        // script tree and miss it.
        this.loop.advance(wall, () => {
          this.walker!.tick(TICK);
          return !this.walker!.branch && !this.walker!.finished;
        });
        this.syncUrlToWalker(now);
      }
    }

    if (this.walker) {
      // The port and the render layers run on wall time, not on the walker's
      // accumulator, and they run in every mode: a zombie loops its walk while
      // you step through the script one instruction at a time, and the rain
      // keeps falling in free roam. Only the shutter and the dialogue
      // countdown ride the script's own clock, and they took `tick` above.
      const game = this.gameTick(wall);
      this.pushPortGlobals();
      // One call, and the order inside it is `World`'s: the shot seats the
      // camera block, the port's frame eases it, the draw reads it back, and
      // every render layer poses against the camera that draw placed.
      // `CamStartPathPlayback` -> `CamAdvancePathFrame` runs in Step mode too:
      // the walker is not advancing, but the port is, and the camera hook
      // still has to have a rail to fall back onto.
      this.cam.driving = !this.scrubbing;
      this.cam.scripted = this.state.mode !== "free";
      this.world.update(this.ctx, game);
    }
    this.renderer.render(this.scene, this.camera);
    // The one update path, and it is unconditional on purpose. A projection a
    // frame, published only when it differs -- so the sidebar and the globals
    // panel are live while the clock is stopped, and the loading overlay is
    // live before there is a stage to tick.
    //
    // It used to be a system in the `hud` phase, which put it inside the
    // `if (this.walker)` above: nothing was published at all until the first
    // stage had loaded, and `setLoading` and `fail` each carried a hand-push
    // to cover for that. Two update paths in the layer built to have one.
    // Both hand-pushes are gone, and so is `panelSystem`.
    this.publishUi();
  };

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
    // the layer that noticed: `render/` may perform a spawn, it does not get
    // to decide a lifetime. `verify_layers.py` is what keeps that honest.
    for (const a of this.chars.syncSpawns(this.walker.spawns)) {
      ActorRetireFromWorld(a);
    }
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

  /** Game time for this frame: wall clock scaled by `speed`, zero while frozen. */
  private gameTick(wall: number): Tick {
    if (this.state.freeze || this.gameStopped) return this.loop.idle(wall);
    const dt = wall * this.speed;
    return { dt, frames: dt * 60, wall, frozen: false };
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
  private runCommand(c: UiCommand): void {
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
  }

  fail(msg: string): void {
    this.loading = { text: msg, failed: true };
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
  private syncUrlToWalker(nowMs: number): void {
    const w = this.walker;
    if (!w || this.state.mode === "free" || this.state.slot !== undefined) {
      return;
    }
    const key = `${w.block}/${w.step}/${w.opIndex}`;
    if (key === this.urlSyncKey || nowMs - this.urlSyncAt < URL_SYNC_MS) return;
    this.urlSyncKey = key;
    this.urlSyncAt = nowMs;
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
