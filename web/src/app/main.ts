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
  Vector3,
  WebGLRenderer,
} from "three";
import {
  loadManifest,
  loadStage,
  type Manifest,
  type StageEntry,
} from "../bundle";
import type { SoundJson } from "../bundle/scene";
import { CamPaths } from "../render/campath";
import { CameraDrawSystem, CameraRig, CameraSeatSystem }
  from "../render/camera";
import { StageScene } from "../render/stagescene";
import { RailLayer, SpawnLayer } from "../render/overlays";
import { FreeRoam, isTyping } from "../render/freeroam";
import { Walker, type BranchChoice, type CamCommand, type FeedEntry } from "../script/walker";
import { readState, writeState, type PlayerState } from "./urlstate";
import { restoreViewPrefs } from "./viewprefs";
import { Minimap, rememberFolds } from "../hud/ui";
import { Bgm } from "../audio/bgm";
import { SceneFog, type FogMode } from "../render/fog";
import { SceneLighting, type LightingMode } from "../render/lighting";
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
import type { UiProjection } from "../ui/projection";
import { EMPTY_TOGGLES, type UiCommand } from "../ui/commands";
import { globalsProjection } from "./projection/globals";
import { screenMessage } from "./projection/message";
import { feedRow, inspectorText, minimapGraph, opSummary, treeProjection }
  from "./projection/script";
import type { FeedRow, MinimapGraph, TreeProjection }
  from "../ui/projection";
import { actorsProjection, highlightSet, waitProjection }
  from "./projection/sidebar";
import { Events } from "../core/events";
import { Rng } from "../core/rng";
import type { Tick } from "../core/system";
import type { RenderContext } from "../render/context";
import type { Snapshot } from "../core/snapshot";
import { Loop, TICK } from "./loop";
import { wireSplitter } from "../hud/splitter";
import { GameSystem, ScriptSystem, panelSystem } from "./systems";
import { ProjectileLayer } from "../render/projectiles";
import { DebugBoxLayer } from "../render/debug";
import { GameMode } from "../game/game_mode";
import { G } from "../game/globals";
import { SetGameTables } from "../game/tables";
import { Hud as HudLayer } from "../hud/hud";
import { Rain } from "../render/rain";
import { RainSystem } from "../game/effects/rain";
import { BreakableLayer } from "../render/breakables";
import { ResetPropContainers } from "../game/class41";
import { SpawnPropContainers } from "../game/director";

const $ = <T extends HTMLElement>(sel: string): T =>
  document.querySelector(sel) as T;

/**
 * How often the playing address may be written back to the URL.
 *
 * Safari throttles `history.replaceState` to about one call every 300 ms and
 * throws once a page exceeds it, so this stays comfortably the safe side.
 */
const URL_SYNC_MS = 500;

class Player {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera: PerspectiveCamera;
  private readonly viewport = $("#viewport");
  private readonly canvas = $<HTMLCanvasElement>("#view");

  private manifest!: Manifest;
  private stage: StageScene | null = null;
  private spawns = new SpawnLayer();
  private paths: CamPaths | null = null;
  /**
   * The script, and the one copy of it.
   *
   * It lives on the `Context` because every system reads it there; this is the
   * same reference under the name the player's own code has always used, so
   * the two can never drift apart.
   */
  private get walker(): Walker | null { return this.ctx.walker; }
  private set walker(w: Walker | null) { this.ctx.walker = w; }

  private readonly minimap = new Minimap();
  /**
   * The script tree, built once per stage.
   *
   * Thousands of rows and none of them change, so it is kept by reference and
   * `treeVersion` is what tells the projection's change key it moved — walking
   * it every frame to notice it had not would cost more than drawing it.
   */
  private treeProj: TreeProjection | null = null;
  private treeVersion = 0;
  private minimapGraph: MinimapGraph | null = null;
  /** The event feed, capped. Append-only, so a version beats a compare. */
  private feedRows: FeedRow[] = [];
  private feedVersion = 0;
  /** The HUD strip, rebuilt by `refreshUi` and read by the projection. */
  private hudRows: [string, string, boolean?][] = [];
  private readonly freeRoam = new FreeRoam($("#viewport"));
  private readonly bgm = new Bgm();
  private readonly sceneFog: SceneFog;
  private readonly lighting: SceneLighting;
  private readonly backdrop = new Backdrop();
  private readonly rigs = new RigLayer();
  private readonly chars = new CharacterLayer();
  private readonly props = new PropLayer();
  private readonly breakables = new BreakableLayer();
  private readonly shooting = new Shooting($("#viewport"), this.chars);
  /** The `coli/` overlay — see `render/coli_debug.ts`. */
  private readonly coliDebug = new ColiDebugLayer();
  private readonly stuckDebug = new StuckDebugLayer();
  /**
   * The stage's `sound` block, kept for the one caller that is not the walker:
   * class 0x10's op 0x1D plays a dialogue group from inside the port, and the
   * port cannot reach the bundle.
   */
  private dialogue: SoundJson | null = null;
  /** The registry and the tick order: script -> game -> render -> hud. */
  private readonly world = new World<RenderContext>();
  /**
   * The root of the disposal tree, and the two scopes under it that matter.
   *
   * `stage` dies when a different stage is loaded; `session` dies whenever the
   * game state is replaced under the renderer — a seek or a snapshot load —
   * and is exactly what `resync` would otherwise have to rebuild by hand.
   */
  private readonly appScope = new Scope("app", () => this.lifeFrame);
  /**
   * Frames since the page loaded, which never resets.
   *
   * `ctx.frame` restarts at zero on every stage load, so it cannot order two
   * scopes across a stage switch — and "was this opened before the current
   * stage loaded" is the one question the panel exists to answer.
   */
  private lifeFrame = 0;
  private stageScope: Scope | null = null;
  private stageLoadedAt = 0;
  /** The one thing React subscribes to. See `ui/store.ts`. */
  private readonly ui = new UiStore();
  /** Bumped when the projection actually changed, so React can skip a frame. */
  private uiRevision = 0;
  private lastUiKey = "";
  /** The sidebar's own state: which classes are boxed, and which are folded. */
  private readonly boxedClasses = new Set<number>();
  private readonly shutClasses = new Set<number>();
  private readonly events = new Events();
  /** The one random source in the player, and part of every snapshot. */
  private readonly rng = new Rng(1);
  private readonly loop = new Loop();
  private readonly script = new ScriptSystem();
  /** Approach, attack permits, and the look-at the camera tracks. */
  private readonly game = new GameSystem();
  private readonly bullets = new ProjectileLayer();
  /** Debug overlays: unported classes, the permit holder, the awaited enemies. */
  private readonly debug = new DebugBoxLayer();
  private readonly rain = new Rain();
  /** The rain pool, advanced in the game phase. See `game/effects/rain.ts`. */
  private readonly rainSim = new RainSystem();
  private readonly hudLayer = new HudLayer($("#viewport"));

  private state: PlayerState = readState();
  private playing = false;
  /** The address last written to the URL, and when — see `syncUrlToWalker`. */
  private urlSyncKey = "";
  private urlSyncAt = 0;
  private speed = 1;
  /** The camera's own state: the pose scratch, the rails, and the two toggles. */
  private readonly cam = new CameraRig();
  /** Everything a system is handed. Built once; the stage index moves. */
  private readonly ctx: RenderContext;
  /** The last snapshot taken, for the Load button. */
  private saved: Snapshot | null = null;
  /** Set while the frame slider is driving the camera by hand. */
  private scrubbing = false;
  private pillarbox = true;

  constructor() {
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
    this.scene.add(this.breakables.group);

    this.ctx = {
      scene: this.scene,
      camera: this.camera,
      events: this.events,
      rng: this.rng,
      walker: null,
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
    // The port's data segment on screen, and the sidebar. Driven from the
    // tick rather than from `refreshUi`, which only runs during playback:
    // both are at their most useful when the clock is stopped.
    // The React half. One projection a frame, published only when it differs.
    this.world.add("hud", panelSystem("ui", (ctx) => this.publishUi(ctx)));
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
      this.refreshUi();
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
      this.refreshUi();
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
      if (v?.voice) this.bgm.play(v.voice);
      this.hudLayer.showMessage(d.group, screenMessage(v));
    });
    this.events.on("civilian.rescued", (d) => {
      this.onFeed({
        seq: -1, block: this.walker?.block ?? -1, step: -1, opIndex: -1,
        op: { i: -1, at: 0, op: -1, cat: "combat", name: "civilian rescued" },
        note: `+400 to ${d.player < 0 ? "both players" : `player ${d.player}`}`
            + ` → ${d.score}`,
      });
      this.refreshUi();
    });
    this.events.on("civilian.shot", (d) => {
      this.onFeed({
        seq: -1, block: this.walker?.block ?? -1, step: -1, opIndex: -1,
        op: { i: -1, at: 0, op: -1, cat: "combat", name: "civilian shot" },
        note: `player ${d.player < 0 ? "?" : d.player} · −1 life · −100 twice`,
      });
      this.refreshUi();
    });

    this.wireUi();
    // The one place a `UiCommand` means anything. Everything in `ui/` reaches
    // the world through here and nowhere else.
    this.ui.onCommand((c) => this.runCommand(c));
    mountUi(this.ui);
    wireSplitter();
    // Watching the viewport rather than the window catches the splitter drag
    // and the branch bar appearing, neither of which resizes the window.
    new ResizeObserver(() => this.resize()).observe(this.viewport);
    this.resize();
  }

  // -- bootstrap ---------------------------------------------------------

  async start(): Promise<void> {
    try {
      this.manifest = await loadManifest();
    } catch (err) {
      return this.fail(
        `${err instanceof Error ? err.message : String(err)}\n\n` +
          "Build a bundle first:\n" +
          '  python3 tools/export_player.py --game-dir "/path/to/THE HOUSE OF THE DEAD 2" --all',
      );
    }

    const sel = $<HTMLSelectElement>("#stage-select");
    const stages = [
      ...new Set(this.manifest.stages.map((s) => s.stage ?? s.scene)),
    ].sort((a, b) => a - b);
    sel.replaceChildren(
      ...stages.map((n) => {
        const o = document.createElement("option");
        o.value = String(n);
        o.textContent = String(n);
        return o;
      }),
    );
    if (!stages.includes(this.state.stage)) this.state.stage = stages[0];
    sel.value = String(this.state.stage);

    await this.loadStage();
    this.setMode(this.state.mode);
    this.loop.start(performance.now());
    requestAnimationFrame(this.frame);
  }

  private entryFor(stage: number, original: boolean): StageEntry | undefined {
    return this.manifest.stages.find(
      (s) => (s.stage ?? s.scene) === stage &&
        (s.game_mode === GameMode.Original) === original,
    );
  }

  private async loadStage(): Promise<void> {
    const entry = this.entryFor(this.state.stage, this.state.original) ??
      this.entryFor(this.state.stage, false);
    if (!entry) return this.fail(`stage ${this.state.stage} is not in this bundle`);

    this.setLoading(`loading ${entry.name}…`);
    this.playing = false;
    this.setPlayButton();

    // Cleared before anything is torn down: `world.detach` and the layers'
    // builders both run before the new one exists, and a layer that read the
    // *previous* stage's script there would place the old stage's spawns in
    // the new stage's scene.
    this.walker = null;
    // Everything the previous stage built goes back before anything of the new
    // one is made, so a leak shows as a scope that outlived this call rather
    // than as a slow climb nobody attributes to a stage switch.
    this.stageScope?.dispose();
    this.stageScope = this.appScope.child(`stage:${this.state.stage}`);
    this.ctx.scope = this.stageScope;
    this.newSession();
    if (this.stage) {
      this.scene.remove(this.stage.root);
      this.stage.dispose();
    }
    if (this.cam.rails) this.scene.remove(this.cam.rails.group);

    const bundle = await loadStage(entry);
    this.paths = new CamPaths(bundle.cam);
    this.stage = await StageScene.load(bundle.geometryUrl, bundle.script);
    // Honour the per-mesh fog bit and compile the radial-fog variant.
    this.sceneFog.prepare(this.stage.root);
    // Adopt the dome models before lighting, so its material swap sees the
    // clones the backdrop made rather than the shared originals.
    this.backdrop.build(this.stage.root, this.ctx.scope,
                        bundle.script.backdrop);
    this.rigs.build(this.stage.root, bundle.script.rigs, this.paths);
    // The scene reset comes first: it empties the object pool and copies the
    // approach rings into the globals, and `chars.attach` spawns into that
    // pool. Doing it the other way round drops every actor it just made.
    this.world.detach(this.ctx);
    this.ctx.stage = this.state.stage;
    this.ctx.frame = 0;
    this.rng.reseed(this.state.seed ?? 1);
    // `attach` runs the scene reset, which zeroes the data segment -- so the
    // tables go in **after** it. The other way round the reset wiped
    // `g_enemy_approach_rings` seconds after `SetGameTables` filled it, every
    // actor read every ring as zero, and so nothing ever reached striking
    // range: they walked into the camera and spun on a facing angle that has
    // no direction at zero distance.
    this.world.attach(this.ctx);
    SetGameTables(bundle.script.characters, bundle.script.breakables,
                  bundle.script.set_pieces, bundle.script.humanoids,
                  bundle.script.coli, bundle.script.civilians);
    G.g_player_lives = [
      bundle.script.characters?.player?.start_lives ?? 2,
      bundle.script.characters?.player?.start_lives ?? 2,
    ];
    // Nothing wrote this before, so every run was Arcade whichever bundle was
    // loaded. That stopped being harmless the moment class 0x41 grew a branch
    // on it: `PlaceGenericProp`'s types 70-72 and 77 despawn on their first
    // frame unless the mode is Original, and the whole item hunt is behind it.
    G.g_GameMode = bundle.script.game_mode;
    // Characters are already in the stage glTF, one hierarchy per spawn;
    // this adopts them and takes over the pose.
    // The object paths class 0x25 rides live in the camera bundle; the
    // character layer is the seam the port already reaches the renderer
    // through, so they are handed to it rather than duplicated in `game/`.
    this.chars.paths = this.paths;
    this.coliDebug.build(this.stage.root, this.ctx.scope,
                         bundle.script.coli);
    this.stuckDebug.build(this.stage.root, this.ctx.scope);
    this.chars.civilians = bundle.script.civilians ?? null;
    this.chars.build(this.stage.root, this.ctx.scope,
                     bundle.script.characters);
    this.spawns.setPosed(this.chars.posed);
    // Doors, shutters and the vans they hang off; driven by the script's
    // own flags, so nothing here needs a clock of its own.
    this.props.build(this.stage.root, this.ctx.scope, bundle.script.props);
    // Class 0x41's props are built at run time, so only the templates are
    // adopted here; the nodes follow `G.g_breakable_props`.
    this.breakables.adopt(this.stage.root);
    this.shooting.breakables = this.breakables;
    this.shooting.reset();
    this.shooting.setTables(bundle.script.characters?.combat);
    this.dialogue = bundle.script.sound ?? null;
    this.bullets.source = this.chars;
    this.scene.add(this.bullets.group);
    this.shooting.playSound = (id) => { this.bgm.play(id); };
    this.shooting.setEnabled(
      $<HTMLInputElement>("#shoot").checked, this.camera, this.scene);
    const rainCfg = bundle.script.rain;
    this.rain.build(this.ctx, this.stage.root, rainCfg);
    this.rainSim.configure(
      rainCfg?.enabled_by_script
        ? { fallPerFrame: rainCfg.fall_per_frame,
            respawnBelow: rainCfg.respawn_below, spawn: rainCfg.spawn }
        : null,
      this.rng);
    this.lighting.build(this.stage.root);
    this.scene.add(this.stage.root);

    this.cam.rails = new RailLayer(this.paths);
    this.scene.add(this.cam.rails.group);
    this.cam.rails.setVisible($<HTMLInputElement>("#show-rails").checked);
    this.cam.rails.setAimRailsVisible($<HTMLInputElement>("#show-aim").checked);
    this.debug.showUnported = $<HTMLInputElement>("#show-unported").checked;
    this.debug.showBoxes = $<HTMLInputElement>("#show-boxes").checked;
    this.coliDebug.setEnabled($<HTMLInputElement>("#show-coli").checked);
    this.stuckDebug.setEnabled($<HTMLInputElement>("#show-stuck").checked);

    this.walker = new Walker(bundle.script, {
      enterRegion: (r) => this.stage?.enterRegion(r),
      loadRegion: () => {},
      loadSlot: (s) => this.stage?.loadSlot(s),
      unloadSlot: (s) => this.stage?.unloadSlot(s),
      startCamera: (c) => this.onCamera(c),
      releaseCamera: () => {},
      onFeed: (e) => this.onFeed(e),
      onBranch: (b) => this.showBranch(b),
      playSound: (id) => this.bgm.play(id),
      // Null unless Shoot is on: only then is there anything that can make
      // the count fall, so only then is the gate a real condition.
      aliveEnemies: () => this.shooting.isEnabled ? this.chars.aliveCount : null,
      // `g_civilians_alive` is maintained by the class-0x10 port itself --
      // `CivilianInit` raises it, op 0x2C's `LeaveCountNow` and the removal
      // path drop it -- so this is the engine's own counter, not a restatement
      // of it. Null while Shoot is off, for the reason on `aliveEnemies`.
      aliveCivilians: () => this.shooting.isEnabled ? G.g_civilians_alive : null,
      // `g_camera_free` -- the room-clear waits need the camera back on its
      // rail, not just the count at zero. Null while Shoot is off, where the
      // counts never fall anyway and the gates pass on their own.
      cameraFree: () => this.shooting.isEnabled ? G.g_camera_free !== 0 : null,
      setShutter: (st) => this.hudLayer.setShutterState(st),
      showMessage: (g) => {
        // Variant 0 is the 1P / player-1 configuration, which is what a
        // single-viewer playback corresponds to.
        const v = bundle.script.sound?.messages?.[String(g)]?.[0] ?? null;
        if (v?.voice) this.bgm.play(v.voice);
        return this.hudLayer.showMessage(g, screenMessage(v));
      },
      // The subtitle task tests the skip flag every frame and ends itself, so
      // the caption goes at once. The voice is a fire-and-forget PlaySoundId
      // that the game leaves playing; it is stopped here because the player
      // owns the audio element and a line talking over a scene you have just
      // skipped past reads as a bug rather than as fidelity.
      endDialogue: () => {
        this.hudLayer.endMessage();
        this.bgm.stopVoice();
      },
    }, { seed: this.state.seed ?? 1 });
    this.script.walker = this.walker;

    this.hudLayer.reset();
    this.bgm.setTable(bundle.script.bgm, entry.game_mode);
    this.bgm.setSoundTables(bundle.script.sound);
    this.treeProj = treeProjection(bundle.script);
    this.treeVersion += 1;
    this.minimapGraph = minimapGraph(bundle.script);
    this.minimap.build(this.minimapGraph);
    this.clearFeed();

    if (bundle.script.warnings.length) {
      // Decoder warnings are surfaced, not swallowed: a step that failed to
      // disassemble is a hole in the timeline and the user should know.
      for (const w of bundle.script.warnings) {
        this.onFeed({
          seq: -1, block: -1, step: -1, opIndex: -1,
          op: { i: -1, at: 0, op: -1, name: "decoder warning", cat: "flow" },
          note: w,
        });
      }
    }

    // The stage is up. Anything opened under it from here belongs to this
    // stage's run, and anything older that is still under `stage:` did not
    // come from this load -- which is what the panel flags.
    this.stageLoadedAt = this.lifeFrame;
    this.applyIncomingState();
    // No `bgm_entry_play` in any stage script starts the stage's own track --
    // they only switch to boss and transition music -- so the opening track
    // is started here and labelled as not script-driven.
    const st = bundle.script.bgm?.stage_track;
    if (st) this.bgm.play(st.id, "stage");
    this.setLoading(null);
    const status = $("#status");
    status.textContent =
      `${entry.name} · ${entry.counts.models} models · ` +
      `${entry.counts.triangles.toLocaleString()} tris · ` +
      `${entry.counts.regions} regions · ${entry.counts.blocks} blocks · ` +
      `${entry.counts.branch_points} branch points`;
    // A re-export changes the data under a page that looks identical, and a
    // stale bundle is indistinguishable from a bug. Say when this one was
    // built so the two can be told apart.
    if (this.manifest?.built) {
      const built = new Date(this.manifest.built);
      const age = (Date.now() - built.getTime()) / 1000;
      const tag = document.createElement("span");
      tag.className = "dim";
      tag.title = `Bundle built ${this.manifest.built} by `
        + `${this.manifest.tool} ${this.manifest.tool_version}`;
      tag.textContent = ` · bundle ${
        age < 3600 ? `${Math.max(0, Math.round(age / 60))} min old`
          : built.toLocaleString()}`;
      status.appendChild(tag);
    }
  }

  /** Honour the deep link: either an op address, or a raw camera pose. */
  private applyIncomingState(): void {
    const w = this.walker;
    if (!w) return;
    if (this.state.slot !== undefined) {
      this.poseFromSlot(this.state.slot, this.state.frame ?? 0);
    } else if (this.state.block !== undefined) {
      const arrived = w.seek(this.state.block, this.state.step ?? 1,
                             this.state.op ?? 0);
      if (!arrived) {
        // The address is not on any route the script can take from the entry
        // block -- a stale link, or a branch this run did not take. Say so
        // rather than silently presenting whatever the replay ran into.
        console.warn(`no route to ${this.state.block}/${this.state.step ?? 1}` +
                     `/${this.state.op ?? 0}; showing ${w.block}/${w.step}` +
                     `/${w.opIndex}`);
      }
      // Land in the same shot, not at the start of it.
      if (this.state.frame !== undefined && w.cam) {
        w.cam.frame = this.state.frame;
      }
      this.syncCameraToWalker(true);
      this.syncBgmToWalker();
    } else {
      w.reset();
      // Instruction 0 of block 0 has entered no region and issued no camera
      // command, so opening there is a truthful black screen. Prime to where
      // the stage actually starts instead.
      w.primeToFirstWait();
      this.syncCameraToWalker(true);
    }
    if (this.state.all) {
      $<HTMLInputElement>("#all-regions").checked = true;
      this.stage?.setVisibility("all");
    }
    this.refreshUi();
  }

  // -- ui wiring ---------------------------------------------------------

  private wireUi(): void {
    $<HTMLSelectElement>("#stage-select").addEventListener("change", (e) => {
      this.state.stage = Number((e.target as HTMLSelectElement).value);
      this.state.block = this.state.step = this.state.op = undefined;
      this.state.slot = this.state.frame = undefined;
      this.pushUrl();
      void this.loadStage();
    });

    $<HTMLInputElement>("#original-toggle").addEventListener("change", (e) => {
      this.state.original = (e.target as HTMLInputElement).checked;
      this.pushUrl();
      void this.loadStage();
    });

    for (const b of document.querySelectorAll<HTMLButtonElement>(".mode")) {
      b.addEventListener("click", () =>
        this.setMode(b.dataset.mode as PlayerState["mode"]));
    }

    $<HTMLInputElement>("#all-regions").addEventListener("change", (e) => {
      const all = (e.target as HTMLInputElement).checked;
      this.state.all = all || undefined;
      this.stage?.setVisibility(all ? "all" : "region");
      this.pushUrl();
      this.refreshUi();
    });

    $<HTMLInputElement>("#show-rails").addEventListener("change", (e) => {
      this.cam.rails?.setVisible((e.target as HTMLInputElement).checked);
    });
    $<HTMLInputElement>("#show-aim").addEventListener("change", (e) => {
      this.cam.rails?.setAimRailsVisible((e.target as HTMLInputElement).checked);
    });
    $<HTMLInputElement>("#show-unported").addEventListener("change", (e) => {
      this.debug.showUnported = (e.target as HTMLInputElement).checked;
    });
    $<HTMLInputElement>("#show-stuck").addEventListener("change", (e) => {
      this.stuckDebug.setEnabled((e.target as HTMLInputElement).checked);
    });
    $<HTMLInputElement>("#show-coli").addEventListener("change", (e) => {
      this.coliDebug.setEnabled((e.target as HTMLInputElement).checked);
    });
    rememberFolds();
    $<HTMLInputElement>("#show-boxes").addEventListener("change", (e) => {
      this.debug.showBoxes = (e.target as HTMLInputElement).checked;
    });
    $<HTMLInputElement>("#show-rigs").addEventListener("change", (e) => {
      this.rigs.setEnabled((e.target as HTMLInputElement).checked);
    });
    $<HTMLInputElement>("#show-sky").addEventListener("change", (e) => {
      const on = (e.target as HTMLInputElement).checked;
      this.backdrop.setEnabled(on);
      this.rain.setEnabled(on);
    });
    $<HTMLInputElement>("#show-hud").addEventListener("change", (e) => {
      this.hudLayer.setEnabled((e.target as HTMLInputElement).checked);
    });
    $<HTMLInputElement>("#show-spawns").addEventListener("change", (e) => {
      this.spawns.setVisible((e.target as HTMLInputElement).checked);
    });
    $<HTMLInputElement>("#show-chars").addEventListener("change", (e) => {
      this.chars.setEnabled((e.target as HTMLInputElement).checked);
    });
    $<HTMLInputElement>("#show-props").addEventListener("change", (e) => {
      this.props.setEnabled((e.target as HTMLInputElement).checked);
    });
    $<HTMLInputElement>("#show-breakables").addEventListener("change", (e) => {
      this.breakables.setEnabled((e.target as HTMLInputElement).checked);
    });
    $<HTMLInputElement>("#track-enemies").addEventListener("change", (e) => {
      this.cam.trackEnabled = (e.target as HTMLInputElement).checked;
      this.syncCameraToWalker();
    });
    $<HTMLInputElement>("#shoot").addEventListener("change", (e) => {
      const on = (e.target as HTMLInputElement).checked;
      this.shooting.setEnabled(on, this.camera, this.scene);
      $<HTMLButtonElement>("#btn-kill").hidden = !on;
      this.refreshUi();
    });
    // The save state. Held in memory rather than written out: the value is
    // plain JSON, so a `copy(player.saveSnapshot())` in the console is a file
    // whenever one is wanted, and the button is for the loop you actually run
    // -- snapshot, try something, put it back.
    $<HTMLButtonElement>("#btn-save").addEventListener("click", () => {
      this.saved = this.saveSnapshot();
      $<HTMLButtonElement>("#btn-load").disabled = false;
      this.onFeed({
        seq: -1, block: this.walker?.block ?? -1, step: -1, opIndex: -1,
        op: { i: -1, at: 0, op: -1, name: "state saved", cat: "flow" },
        note: `block ${this.saved.stage}/${this.saved.frame | 0} · `
            + `${Object.keys(this.saved.parts).length} slices`,
      });
    });
    $<HTMLButtonElement>("#btn-load").addEventListener("click", () => {
      if (!this.saved) return;
      const err = this.loadSnapshot(this.saved);
      this.onFeed({
        seq: -1, block: this.walker?.block ?? -1, step: -1, opIndex: -1,
        op: { i: -1, at: 0, op: -1, name: "state loaded", cat: "flow" },
        note: err ?? `back to frame ${this.saved.frame | 0}`,
      });
    });

    // The debug clear: `killAll` drops every live actor to zero hit points and
    // starts its directional death, which is what opens the enemy gate.
    $<HTMLButtonElement>("#btn-kill").addEventListener("click", () => {
      const n = this.chars.killAll(this.shooting.cameraYawBams);
      this.onFeed({
        seq: -1, block: this.walker?.block ?? -1, step: -1, opIndex: -1,
        op: { i: -1, at: 0, op: -1, name: "kill all", cat: "combat" },
        note: `${n} enem${n === 1 ? "y" : "ies"} killed`,
      });
      this.refreshUi();
    });
    // Every shot goes to the feed, so a session reads back as a transcript.
    this.shooting.onShot = (r, note) => {
      this.onFeed({
        seq: -1, block: this.walker?.block ?? -1, step: -1, opIndex: -1,
        op: { i: -1, at: 0, op: -1,
              name: r.hit ? "shot · hit" : "shot · miss", cat: "combat" },
        note,
      });
      this.refreshUi();
    };
    $<HTMLInputElement>("#pillarbox").addEventListener("change", (e) => {
      this.pillarbox = (e.target as HTMLInputElement).checked;
      this.resize();
    });
    $<HTMLSelectElement>("#light-mode").addEventListener("change", (e) => {
      this.lighting.setMode(
        (e.target as HTMLSelectElement).value as LightingMode);
      this.refreshUi();
    });
    $<HTMLSelectElement>("#fog-mode").addEventListener("change", (e) => {
      this.sceneFog.setMode((e.target as HTMLSelectElement).value as FogMode);
      this.refreshUi();
    });

    // Deciding is not a race. Hovering the bar -- to read the routes, or to
    // preview a shot -- stops the arcade countdown until the pointer leaves.
    const bar = $("#branchbar");
    bar.addEventListener("pointerenter", () => {
      this.branchHover = true;
      this.refreshBranchCountdown();
    });
    bar.addEventListener("pointerleave", () => {
      this.branchHover = false;
      this.refreshBranchCountdown();
    });

    const sound = $("#btn-sound");
    sound.addEventListener("click", () => this.bgm.setMuted(!this.bgm.muted));
    $<HTMLInputElement>("#volume").addEventListener("input", (e) =>
      this.bgm.setVolume(Number((e.target as HTMLInputElement).value) / 100));
    this.bgm.onChange = (bs) => {
      const on = !this.bgm.muted;
      // The button states what it currently IS, not what pressing it does.
      sound.setAttribute("aria-pressed", String(on));
      $("#sound-icon").textContent = on ? "🔊" : "🔇";
      $("#sound-text").textContent = on
        ? (bs.playing ? "Sound on" : "Sound on…")
        : "Muted";
      const label = $("#bgm-label");
      label.classList.toggle("blocked", bs.blocked && !this.bgm.muted);
      label.textContent = !bs.file
        ? "no bgm"
        : bs.blocked && !this.bgm.muted
          ? "click 🔇 to allow audio"
          : `${bs.file}${bs.source === "stage" ? " (stage)" : ""}`;
    };

    $("#btn-play").addEventListener("click", () => this.togglePlay());
    $("#btn-step").addEventListener("click", () => this.stepOnce());
    $("#btn-stepback").addEventListener("click", () => this.stepBack());
    $("#skip-go").addEventListener("click", () => this.requestSkip());
    $("#btn-reset").addEventListener("click", () => {
      this.clearFeed();
      this.walker?.reset();
      this.walker?.primeToFirstWait();
      this.syncCameraToWalker();
      this.refreshUi();
      this.pushUrl();
    });

    $<HTMLSelectElement>("#speed").addEventListener("change", (e) => {
      this.speed = Number((e.target as HTMLSelectElement).value);
    });

    const slider = $<HTMLInputElement>("#frame-slider");
    slider.addEventListener("input", () => {
      this.scrubbing = true;
      const w = this.walker;
      if (!w?.cam) return;
      w.cam.frame = Number(slider.value);
      this.syncCameraToWalker();
      this.state.frame = w.cam.frame;
      this.pushUrl();
    });
    slider.addEventListener("change", () => { this.scrubbing = false; });

    this.minimap.onSeek = (b) => this.seekTo(b, 1, 0);
    $("#feed-clear").addEventListener("click", () => this.clearFeed());

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

    // Last, so the restore's dispatched `change` events land on the handlers
    // registered above rather than on nothing.
    restoreViewPrefs();
  }

  /**
   * The splitter between the script panel and the viewport.
   *
   * The panel starts narrow because the viewport is the point of the tool;
   * the tree is a navigator, not the content. Width is a per-viewer
   * convenience, so it lives in `localStorage` and nowhere else.
   */
  private setMode(mode: PlayerState["mode"]): void {
    this.state.mode = mode;
    for (const b of document.querySelectorAll<HTMLButtonElement>(".mode")) {
      b.classList.toggle("active", b.dataset.mode === mode);
    }
    this.freeRoam.enabled = mode === "free";
    if (mode === "free") {
      this.freeRoam.adoptFrom(this.camera);
      // A region holds only the few models the game draws from one point on
      // the rail. Free roam therefore shows the whole level -- otherwise most
      // of it simply is not there.
      this.stage?.setVisibility("all");
      this.cam.rails?.setCameraMarkerVisible(true);
    } else {
      const all = $<HTMLInputElement>("#all-regions").checked;
      this.stage?.setVisibility(all ? "all" : "region");
      this.cam.rails?.setCameraMarkerVisible(false);
      this.syncCameraToWalker();
    }
    this.playing = mode === "play" ? this.playing : false;
    this.setPlayButton();
    this.pushUrl();
    this.refreshUi();
  }

  private togglePlay(): void {
    if (this.state.mode === "free") this.setMode("play");
    this.playing = !this.playing;
    if (this.playing && this.state.mode === "step") this.setMode("play");
    this.setPlayButton();
  }

  /**
   * Press Start during a skippable cutscene.
   *
   * The whole feature is live in the retail game -- region, Start poll, watcher
   * task, and every consumer of the flag. See `Walker.skipRequested`.
   */
  private requestSkip(): void {
    const w = this.walker;
    if (!w || !w.requestSkip()) return;
    this.syncCameraToWalker();
    this.refreshUi();
    this.pushUrl();
  }

  /**
   * The skip bar, shown under the game's own condition.
   *
   * `Walker.canSkip` is `DAT_009A2D7C != 0 && DAT_009C8E00 == 0` -- the exact
   * test both player-update routines make before looking at Start. So the bar
   * appears precisely where the game would have accepted a skip, which is
   * something the retail build never shows you, its skip being one assignment
   * short of working.
   *
   * Unlike the branch bar this is an offer, not a question: playback is not
   * waiting on it and ignoring it changes nothing.
   */
  private showSkipBar(): void {
    const bar = $("#skipbar");
    const go = $<HTMLButtonElement>("#skip-go");
    const w = this.walker;
    // The bar follows the region, not the offer. `canSkip` adds the firing
    // gate, and gating *visibility* on that made the whole feature invisible
    // whenever the gate happened to be up -- which is not worth the fidelity,
    // since the region is the thing the script actually declares. So the bar
    // shows for the region and the button carries the gate.
    const open = w?.skippable ?? false;
    bar.hidden = !open;
    if (!open || !w) return;
    const can = w.canSkip;
    go.disabled = !can;
    // On the rare frame a branch point is live too, sit above it rather than
    // under it.
    bar.classList.toggle("stacked", !$("#branchbar").hidden);
    const held = w.wait?.blocksOn;
    $("#skip-sub").textContent = !can
      ? "region open, but the shutter's firing gate is up — the game would not "
        + "poll Start here"
      : held
        ? `holding on ${held} — skips every wait until the region closes`
        : "skips every wait until set_skippable_region closes";
  }

  private setPlayButton(): void {
    const b = $("#btn-play");
    b.textContent = this.playing ? "❚❚" : "▶";
    b.classList.toggle("playing", this.playing);
    // Every path that changes `playing` or the mode goes through here, which
    // is why the overlay is refreshed from it rather than from the frame loop.
    this.refreshPausedOverlay();
  }

  private stepOnce(): void {
    const w = this.walker;
    if (!w) return;
    this.playing = false;
    this.setPlayButton();
    w.stepOnce();
    this.syncCameraToWalker();
    this.refreshUi();
    this.pushUrl();
  }

  /**
   * "Previous instruction" replays from the entry block to the op before this
   * one. There is no undo: an instruction's effect on the region set, the
   * streamed slots and the camera is not invertible, so the only correct way
   * back is to run forward again.
   */
  private stepBack(): void {
    const w = this.walker;
    if (!w) return;
    this.playing = false;
    this.setPlayButton();
    if (w.opIndex > 0) this.seekTo(w.block, w.step, w.opIndex - 1);
    else if (w.step > 0) {
      const ops = w.currentBlock?.steps?.[w.step - 1]?.ops?.length ?? 1;
      this.seekTo(w.block, w.step - 1, Math.max(0, ops - 1));
    }
  }

  private seekTo(block: number, step: number, op: number): void {
    const w = this.walker;
    if (!w) return;
    this.playing = false;
    this.setPlayButton();
    this.clearFeed();
    // A seek replays quietly, so no dialogue or shutter op reaches the layer.
    // Without this the caption from wherever you were still hangs there.
    this.hudLayer.reset();
    this.shooting.reset();
    // The replay rebuilds the spawn list, so the placers must be able to run
    // again -- otherwise the pre-seek props stand there for ever.
    ResetPropContainers();
    // The replay rewrites the world; nothing that described the old one may
    // outlive it.
    this.newSession();
    w.seek(block, step, op);
    // A seek replaces the world exactly as a snapshot load does, so it takes
    // the same rebuild path. Running only half of it is what let a rig keep a
    // held pose across a seek.
    this.world.resync(this.ctx);
    // No `syncCameraToWalker` and no `props.reset` here any more: the resync
    // pass does both, and the camera's is the stronger of the two -- it seats
    // the block on the rail even where the restored shot's action has already
    // retired. Two rebuild paths that nearly agree is the thing being removed.
    this.hudLayer.setShutterState(w.shutterState);
    this.syncBgmToWalker();
    this.state.block = block;
    this.state.step = step;
    this.state.op = op;
    this.state.slot = this.state.frame = undefined;
    this.pushUrl();
    this.refreshUi();
  }

  /** `?slot=59&frame=170`: pose the camera straight off a path, no script. */
  private poseFromSlot(slot: number, frame: number): void {
    this.cam.poseFromSlot(this.camera, this.walker?.rollEnabled ?? false,
                          this.walker?.useFixedEyeY ?? false,
                          this.walker?.fixedEyeY ?? 0, slot, frame);
  }

  // -- walker callbacks --------------------------------------------------

  private onCamera(cmd: CamCommand): void {
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

  private onFeed(e: FeedEntry): void {
    this.feedRows = [...this.feedRows, feedRow(e)].slice(-Player.FEED_MAX);
    this.feedVersion += 1;
  }

  private clearFeed(): void {
    this.feedRows = [];
    this.feedVersion += 1;
  }

  /**
   * Show a branch point in the bar at the bottom of the window.
   *
   * Not a modal. A branch is a fact about where playback has got to, not a
   * question that has to be answered before anything else can happen -- so
   * the script, the scrubber and free roam all stay usable while it is up,
   * and it never covers the shot you are choosing between.
   */
  private shownBranch: string | null = null;
  /** True while the pointer is over the branch bar; freezes the countdown. */
  private branchHover = false;

  /**
   * The countdown label. Three states, and each says what it means: running,
   * frozen because the pointer is over the bar, or simply waiting because
   * only Play mode runs the arcade timer at all.
   */
  private refreshBranchCountdown(): void {
    const b = this.walker?.branch;
    const el = $("#branch-countdown");
    if (!b) {
      el.textContent = "";
      return;
    }
    if (!this.playing) el.textContent = "waiting for a choice";
    else if (this.branchHover) el.textContent = "countdown paused";
    else el.textContent = `picking in ${Math.max(0, b.countdown).toFixed(1)} s`;
    el.classList.toggle("paused", this.playing && this.branchHover);
  }

  private showBranch(b: BranchChoice | null): void {
    const bar = $("#branchbar");
    if (!b) {
      bar.hidden = true;
      this.shownBranch = null;
      return;
    }
    // Rebuilding the buttons while one is being clicked destroys the click.
    // Only a different branch point is worth redrawing for.
    const key = `${b.block}:${b.targets.join(",")}`;
    if (this.shownBranch === key && !bar.hidden) return;
    this.shownBranch = key;
    bar.hidden = false;
    const route = this.walker?.currentBlock?.route;
    $("#branch-sub").textContent =
      `block ${b.block} → ${b.targets.join(" or ")}`;

    const box = $("#branch-buttons");
    box.replaceChildren(
      ...b.targets.map((t) => {
        const btn = document.createElement("button");
        const choice = route ? route.next.indexOf(t) : -1;
        btn.textContent = `→ ${t}`;
        btn.title = `Take route to block ${t}` +
          (choice >= 0 ? ` (branch_choice ${choice})` : "");
        // The arcade shows a preview of each route before you commit. Those
        // shots are the store_six operands, indexed by branch_choice.
        // Unused choices are stored as slot 0 / frame 0 and resolve to no
        // path; those get no preview rather than a shot of somewhere else.
        const shot = b.preview?.find((p) => p.choice === choice && p.cam);
        if (shot) {
          btn.classList.add("has-preview");
          btn.addEventListener("pointerenter", () =>
            this.poseFromSlot(shot.slot, shot.frame));
          btn.addEventListener("pointerleave", () => {
            this.syncCameraToWalker();
            // poseFromSlot moved the rail highlight to the preview path; put
            // it back on whatever the script is actually playing.
            const c = this.walker?.cam;
            if (c) this.onCamera(c);
            else this.cam.rails?.highlight(null);
          });
        }
        btn.addEventListener("click", () => {
          this.walker?.takeBranch(t);
          this.clearFeed();
          this.syncCameraToWalker();
          this.refreshUi();
        });
        return btn;
      }),
    );
    this.refreshBranchCountdown();

    // The bar is a grid row, so showing it shortens the viewport. The
    // ResizeObserver on #viewport picks that up; nothing to do here.
  }

  // -- per-frame ---------------------------------------------------------

  /**
   * After a seek, play whatever track the replay last passed.
   *
   * The replay itself is silent -- retriggering audio for every instruction
   * skipped over would be a burst of stops and starts -- so the walker records
   * the track and the result is applied once, here.
   */
  private syncBgmToWalker(): void {
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
  private syncCameraToWalker(force = false): void {
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
    // Driven from here as well as from `setPlayButton`, because a stage that
    // has just finished loading arrives paused without anything having touched
    // the transport. Both calls are idempotent DOM toggles.
    this.refreshPausedOverlay();

    if (!this.state.freeze && this.state.mode === "free") {
      this.freeRoam.update(wall, this.camera);
    } else if (!this.state.freeze && this.playing && this.walker) {
      if (this.walker.branch) {
        if (!this.branchHover) this.walker.tickBranchCountdown(wall);
        this.refreshBranchCountdown();
      } else {
        // The 60 Hz frames the walker actually advanced. The shutter slide and
        // the dialogue countdown are script state measured in those frames, so
        // they are driven from here rather than from wall time -- otherwise a
        // caption put up in Step mode quietly expires two seconds later while
        // playback is paused, which is exactly long enough to look at the
        // script tree and miss it.
        const script = this.loop.advance(wall, () => {
          this.walker!.tick(TICK);
          return !this.walker!.branch && !this.walker!.finished;
        });
        this.hudLayer.tick(script.frames);
        this.syncUrlToWalker(now);
      }
      this.refreshUi();
    }

    if (this.walker) {
      // The port and the render layers run on wall time, not on the walker's
      // accumulator, and they run in every mode: a zombie loops its walk while
      // you step through the script one instruction at a time, and the rain
      // keeps falling in free roam. Only the shutter and the dialogue
      // countdown ride the script's own clock, and they took `tick` above.
      const game = this.gameTick(wall);
      this.syncPortGlobals();
      // One call, and the order inside it is `World`'s: the shot seats the
      // camera block, the port's frame eases it, the draw reads it back, and
      // every render layer poses against the camera that draw placed.
      // `CamStartPathPlayback` -> `CamAdvancePathFrame` runs in Step mode too:
      // the walker is not advancing, but the port is, and the camera hook
      // still has to have a rail to fall back onto.
      this.cam.driving = !this.scrubbing;
      this.cam.scripted = this.state.mode !== "free";
      this.world.update(this.ctx, game);
      // The stats panel is driven from here, not from the playback branch.
      // Read from there it only ever showed the state from *before* the first
      // frame -- which read `0/44 no node` for props that were all fine and
      // `none placed` for a pool with 39 things in it. A panel that lies when
      // the clock is stopped is worse than no panel, and the clock is stopped
      // for most of the time anyone spends looking at it.
      this.refreshUi();
    }
    this.renderer.render(this.scene, this.camera);
  };

  /**
   * The two script-owned globals the port reads, and the spawns it needs.
   *
   * `g_camera_fixed_eye_y` is where class 0x41 puts a group's floor and what
   * `BreakablePropGroundContact` settles against. The camera opcode writes it
   * too, so a group placed during a seek replay gets the right floor; this
   * keeps it true for every other frame.
   */
  private syncPortGlobals(): void {
    const w = this.walker;
    if (!w) return;
    G.g_camera_fixed_eye_y = w.fixedEyeY;
    // `g_camera_block_eye` is the camera block's own eye, and `cam_play`
    // owns it — `CamAdvancePathFrame` writes it from the curve. Free roam has
    // no path and therefore no block, so there it is taken from the viewer's
    // camera instead, which is the only thing standing in for one.
    if (this.state.mode === "free") {
      G.g_camera_block_eye.x = this.camera.position.x;
      G.g_camera_block_eye.y = this.camera.position.y;
      G.g_camera_block_eye.z = this.camera.position.z;
    }
    // `ColiLoadForScene` indexes its file list with this, so it is zero-based
    // and scene 1 is stage 2.
    G.g_scene_index = w.script.scene ?? 0;
    // Class 0x24's set-pieces are choreographed against the camera: every one
    // of their removal and freeze triggers is a `cp_` slot plus a frame.
    G.g_active_cam_path = w.cam ? w.cam.slot : -1;
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
  private refreshPausedOverlay(): void {
    const paused = this.state.mode === "play" && !this.playing
                   && !!this.walker;
    $("#viewport").classList.toggle("paused", paused);
    $("#paused-overlay").hidden = !paused;
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
  private newSession(): void {
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
    switch (c.kind) {
      case "boxClass":
        if (c.on) this.boxedClasses.add(c.cls);
        else this.boxedClasses.delete(c.cls);
        return;
      case "foldClass":
        if (c.shut) this.shutClasses.add(c.cls);
        else this.shutClasses.delete(c.cls);
        return;
      case "seek":
        this.seekTo(c.block, c.step, c.op);
        return;
      default:
        // The rest of the union is still driven by `wireUi`'s listeners, and
        // moves here panel by panel as step 11 proceeds.
        return;
    }
  }

  private publishUi(ctx: RenderContext): void {
    const w = this.walker;
    const eye = this.camera.position;
    // The boxes follow the sidebar's selection whether or not the sidebar is
    // drawn, so this is computed before anything is folded away.
    this.debug.highlight = highlightSet(
      w, this.boxedClasses, $<HTMLInputElement>("#hl-wait").checked);
    const p: UiProjection = {
      revision: 0,
      stage: this.state.stage,
      stages: [],
      original: !!this.state.original,
      loading: null,
      status: "",
      toggles: EMPTY_TOGGLES,
      transport: {
        playing: this.playing, mode: this.state.mode, speed: this.speed,
        frozen: !!this.state.freeze, camSlot: null, camFrame: 0,
        camFrameLo: 0, camFrameHi: 0, camLabel: "",
      },
      // A folded panel is not built. Its *selection* still counts, though —
      // `highlightSet` is computed below whatever the panels are showing.
      wait: w && $<HTMLDetailsElement>("#panel-wait").open
        ? waitProjection(w, eye) : null,
      actorPanel: $<HTMLDetailsElement>("#panel-actors").open
        ? actorsProjection(eye, this.boxedClasses, this.shutClasses) : null,
      // Built only while the panel is open: it walks every global and every
      // actor and formats them all.
      globals: $<HTMLDetailsElement>("#globals-panel").open
        ? globalsProjection() : null,
      tree: this.treeProj,
      minimap: this.minimapGraph,
      treeVersion: this.treeVersion,
      current: w ? { block: w.block, step: w.step, op: w.opIndex } : null,
      feed: this.feedRows,
      feedVersion: this.feedVersion,
      inspector: w?.currentOp
        ? inspectorText(w.currentOp, { summary: opSummary(w.currentOp) }) : "",
      hudRows: this.hudRows,
      scopes: this.appScope.snapshot(),
      scopeContext: { frame: ctx.frame, stageLoadedAt: this.stageLoadedAt },
      hasSaved: !!this.saved,
    };
    // The whole projection is the key. Same cost as the string compare each
    // panel used to do for itself, done once, and it cannot go stale the way
    // a hand-listed set of fields would the first time one is added.
    // Without `tree` and `feed`: the first is thousands of rows that change
    // only on a stage load and the second is up to four hundred that only
    // grow, so both carry a version instead. Stringifying them sixty times a
    // second to discover they had not moved was the one shape of this that
    // would have been too slow.
    const key = JSON.stringify({ ...p, tree: null, feed: null, minimap: null });
    if (key === this.lastUiKey) return;
    this.lastUiKey = key;
    p.revision = ++this.uiRevision;
    this.ui.publish(p);
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
    this.refreshUi();
    return null;
  }

  private refreshUi(): void {
    const w = this.walker;
    if (!w || !this.stage) return;
    this.minimap.draw(w.block);
    this.showSkipBar();

    const cam = w.cam;
    const slider = $<HTMLInputElement>("#frame-slider");
    const path = cam ? this.paths?.paths.get(cam.slot) : undefined;
    if (cam && path) {
      const lo = Math.min(cam.startFrame, cam.endFrame);
      const hi = Math.max(cam.startFrame, cam.endFrame, lo + 1);
      slider.min = String(Math.floor(lo));
      slider.max = String(Math.ceil(hi));
      if (!this.scrubbing) slider.value = String(cam.frame);
      slider.disabled = false;
      $("#frame-label").textContent =
        `${path.file}[${path.index}] slot ${cam.slot}  ` +
        `frame ${cam.frame.toFixed(0)} / ${hi.toFixed(0)}` +
        (cam.isStatic ? "  (static pose)" : "");
    } else {
      slider.disabled = true;
      $("#frame-label").textContent = "no camera path";
    }

    const route = w.currentBlock?.route;
    this.hudRows = [
      ["mode", this.state.mode],
      ["block", `${w.block}  (${route?.kind ?? "?"}` +
        `${route && route.next.some((n) => n >= 0)
          ? " → " + route.next.filter((n) => n >= 0).join(",") : ""})`],
      ["step / op", `${w.step} / ${w.opIndex}`],
      ["region", w.region < 0 ? "—" : String(w.region),
        this.stage.visibility === "all"],
      ["drawn", `${this.stage.visibleCount} models, ` +
        `${this.stage.visibleTriangles.toLocaleString()} tris`],
      ["cam slot", cam ? String(cam.slot) : "—"],
      ["cam frame", cam ? cam.frame.toFixed(1) : "—"],
      ["roll channel", w.rollEnabled ? "on (opcode 0x35)" : "off"],
      ["spawns", `${w.spawns.length} placed`
        + (w.liveEnemies ? `, ${w.liveEnemies} the enemy gate waits on` : "")],
      ["waiting on", w.wait ? w.wait.blocksOn : "—", !!w.wait],
      ["bgm", w.bgmTrack === null ? "—" : `track ${w.bgmTrack}`],
      ["fog", this.sceneFog.describe],
      ["light", this.lighting.describe],
      ["sky", this.backdrop.describe],
      ["rigs", this.rigs.describe],
      ["characters", this.chars.describe],
      ["props", this.props.describe],
      ["breakables", this.breakables.describe],
      ["shooting", this.shooting.describe],
      ["coli", this.coliDebug.describe],
      ["wedged", this.stuckDebug.describe],
      ["enemies", this.game.describe],
      ["lives", `${G.g_player_lives[0]}`
        + (G.g_player_invuln_frames > 0
          ? ` · invulnerable ${Math.ceil(G.g_player_invuln_frames)}f` : "")],
      ["shutter", this.hudLayer.describe],
      // The two globals the skip feature hangs off, so it is visible that the
      // region opened and the gate dropped even when nothing is pressed.
      ["skip", w.skipRequested ? "requested"
        : w.canSkip ? "offered"
        : w.skippable ? "region open, firing gate up" : "—"],
      ["rain", this.rain.describe],
      ["last se", w.lastSound === null ? "—"
        : `0x${w.lastSound.toString(16).toUpperCase()}`],
      ["eye", fmtVec(this.camera.position)],
    ];

    this.state.block = w.block;
    this.state.step = w.step;
    this.state.op = w.opIndex;
  }

  // -- chrome ------------------------------------------------------------

  private resize(): void {
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

  private setLoading(text: string | null): void {
    const el = $("#loading");
    el.hidden = text === null;
    if (text !== null) $("#loading-text").textContent = text;
  }

  private fail(msg: string): void {
    const el = $("#loading");
    el.hidden = false;
    el.querySelector(".spinner")?.remove();
    const p = $("#loading-text");
    p.className = "err";
    p.textContent = msg;
  }

  private pushUrl(): void {
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

function fmtVec(v: Vector3): string {
  return `${v.x.toFixed(1)}, ${v.y.toFixed(1)}, ${v.z.toFixed(1)}`;
}

void new Player().start();
