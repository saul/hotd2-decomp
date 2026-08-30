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
  type OpJson,
} from "./bundle";
import { CamPaths, applyPose, cameraEyeY, type CameraPose } from "./campath";
import { StageScene } from "./stagescene";
import { RailLayer, SpawnLayer } from "./overlays";
import { FreeRoam, isTyping } from "./freeroam";
import { Walker, type BranchChoice, type CamCommand, type FeedEntry } from "./walker";
import { readState, writeState, type PlayerState } from "./urlstate";
import { restoreViewPrefs } from "./viewprefs";
import { EventFeed, Hud, Inspector, Minimap, ScriptTree, opSummary } from "./ui";
import { Bgm } from "./bgm";
import { SceneFog, type FogMode } from "./fog";
import { SceneLighting, type LightingMode } from "./lighting";
import { Backdrop } from "./backdrop";
import { RigLayer } from "./rigs";
import { Hud as HudLayer } from "./hud";
import { Rain } from "./rain";

const TICK = 1 / 60;

/** Script-panel width: narrow by default, dragged by the splitter. */
const LEFT_MIN = 130;
const LEFT_MAX = 620;
const LEFT_DEFAULT = 190;
const LEFT_KEY = "hod2.leftWidth";

const $ = <T extends HTMLElement>(sel: string): T =>
  document.querySelector(sel) as T;

class Player {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera: PerspectiveCamera;
  private readonly viewport = $("#viewport");
  private readonly canvas = $<HTMLCanvasElement>("#view");

  private manifest!: Manifest;
  private stage: StageScene | null = null;
  private rails: RailLayer | null = null;
  private spawns = new SpawnLayer();
  private paths: CamPaths | null = null;
  private walker: Walker | null = null;

  private readonly tree = new ScriptTree();
  private readonly feed = new EventFeed();
  private readonly hud = new Hud();
  private readonly inspector = new Inspector();
  private readonly minimap = new Minimap();
  private readonly freeRoam = new FreeRoam($("#viewport"));
  private readonly bgm = new Bgm();
  private readonly sceneFog: SceneFog;
  private readonly lighting: SceneLighting;
  private readonly backdrop = new Backdrop();
  private readonly rigs = new RigLayer();
  private readonly rain = new Rain();
  private readonly hudLayer = new HudLayer($("#viewport"));

  private state: PlayerState = readState();
  private playing = false;
  private speed = 1;
  private accum = 0;
  private last = 0;
  private pose: CameraPose = {
    eye: new Vector3(0, 0, 0),
    target: new Vector3(0, 0, -1),
    roll: 0,
  };
  /** Set while the frame slider is driving the camera by hand. */
  private scrubbing = false;
  private pillarbox = true;
  private readonly _fwd = new Vector3();

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

    this.wireUi();
    this.wireResizer();
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
    this.last = performance.now();
    requestAnimationFrame(this.frame);
  }

  private entryFor(stage: number, original: boolean): StageEntry | undefined {
    return this.manifest.stages.find(
      (s) => (s.stage ?? s.scene) === stage &&
        (s.game_mode === 1) === original,
    );
  }

  private async loadStage(): Promise<void> {
    const entry = this.entryFor(this.state.stage, this.state.original) ??
      this.entryFor(this.state.stage, false);
    if (!entry) return this.fail(`stage ${this.state.stage} is not in this bundle`);

    this.setLoading(`loading ${entry.name}…`);
    this.playing = false;
    this.setPlayButton();

    if (this.stage) {
      this.scene.remove(this.stage.root);
      this.stage.dispose();
    }
    if (this.rails) this.scene.remove(this.rails.group);

    const bundle = await loadStage(entry);
    this.paths = new CamPaths(bundle.cam);
    this.stage = await StageScene.load(bundle.geometryUrl, bundle.script);
    // Honour the per-mesh fog bit and compile the radial-fog variant.
    this.sceneFog.prepare(this.stage.root);
    // Adopt the dome models before lighting, so its material swap sees the
    // clones the backdrop made rather than the shared originals.
    this.backdrop.attach(this.stage.root, bundle.script.backdrop);
    this.rigs.attach(this.stage.root, bundle.script.rigs, this.paths);
    this.rain.attach(this.stage.root, bundle.script.rain);
    this.lighting.attach(this.stage.root);
    this.scene.add(this.stage.root);

    this.rails = new RailLayer(this.paths);
    this.scene.add(this.rails.group);
    this.rails.setVisible($<HTMLInputElement>("#show-rails").checked);
    this.rails.setAimRailsVisible($<HTMLInputElement>("#show-aim").checked);

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
      setShutter: (st) => this.hudLayer.setShutterState(st),
      showMessage: (g) => {
        // Variant 0 is the 1P / player-1 configuration, which is what a
        // single-viewer playback corresponds to.
        const v = bundle.script.sound?.messages?.[String(g)]?.[0] ?? null;
        if (v?.voice) this.bgm.play(v.voice);
        return this.hudLayer.showMessage(g, v);
      },
    }, { seed: this.state.seed ?? 1 });

    this.hudLayer.reset();
    this.bgm.setTable(bundle.script.bgm, entry.game_mode);
    this.bgm.setSoundTables(bundle.script.sound);
    this.tree.build(bundle.script);
    this.minimap.build(bundle.script);
    this.feed.clear();

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
      w.seek(this.state.block, this.state.step ?? 1, this.state.op ?? 0);
      this.syncCameraToWalker();
      this.syncBgmToWalker();
    } else {
      w.reset();
      // Instruction 0 of block 0 has entered no region and issued no camera
      // command, so opening there is a truthful black screen. Prime to where
      // the stage actually starts instead.
      w.primeToFirstWait();
      this.syncCameraToWalker();
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
      this.rails?.setVisible((e.target as HTMLInputElement).checked);
    });
    $<HTMLInputElement>("#show-aim").addEventListener("change", (e) => {
      this.rails?.setAimRailsVisible((e.target as HTMLInputElement).checked);
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
      this.feed.clear();
      this.walker?.reset();
      this.walker?.primeToFirstWait();
      this.syncCameraToWalker();
      this.refreshUi();
      this.pushUrl();
    });

    $<HTMLSelectElement>("#speed").addEventListener("change", (e) => {
      this.speed = Number((e.target as HTMLSelectElement).value);
    });

    $<HTMLSelectElement>("#combat").addEventListener("change", (e) => {
      const v = Number((e.target as HTMLSelectElement).value);
      if (!this.walker) return;
      this.walker.options.simulateCombat = v >= 0;
      this.walker.options.secondsPerEnemy = Math.max(0, v);
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

    this.tree.onSeek = (t) => this.seekTo(t.block, t.step, t.op);
    this.feed.onSeek = (t) => this.seekTo(t.block, t.step, t.op);
    this.minimap.onSeek = (b) => this.seekTo(b, 1, 0);

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
  private wireResizer(): void {
    const bar = $("#left-resize");
    const area = $("#stagearea");
    const set = (px: number) => {
      const w = Math.round(Math.max(LEFT_MIN, Math.min(LEFT_MAX, px)));
      document.documentElement.style.setProperty("--left-w", `${w}px`);
      bar.setAttribute("aria-valuenow", String(w));
      return w;
    };

    let w = LEFT_DEFAULT;
    try {
      const saved = Number(localStorage.getItem(LEFT_KEY));
      if (Number.isFinite(saved) && saved > 0) w = saved;
    } catch {
      // Private windows and blocked site data both throw here. A default
      // width is a perfectly good outcome, so there is nothing to report.
    }
    set(w);

    const save = (px: number) => {
      try {
        localStorage.setItem(LEFT_KEY, String(px));
      } catch {
        /* see above */
      }
    };

    let dragging = false;
    bar.addEventListener("pointerdown", (e) => {
      dragging = true;
      bar.setPointerCapture(e.pointerId);
      bar.classList.add("dragging");
      document.body.classList.add("resizing");
      e.preventDefault();
    });
    bar.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      set(e.clientX - area.getBoundingClientRect().left);
    });
    const end = (e: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      bar.releasePointerCapture(e.pointerId);
      bar.classList.remove("dragging");
      document.body.classList.remove("resizing");
      save(set(e.clientX - area.getBoundingClientRect().left));
    };
    bar.addEventListener("pointerup", end);
    bar.addEventListener("pointercancel", end);
    bar.addEventListener("dblclick", () => save(set(LEFT_DEFAULT)));
    bar.addEventListener("keydown", (e) => {
      const step = e.shiftKey ? 40 : 10;
      const cur = $("#left").getBoundingClientRect().width;
      if (e.key === "ArrowLeft") save(set(cur - step));
      else if (e.key === "ArrowRight") save(set(cur + step));
      else if (e.key === "Home") save(set(LEFT_DEFAULT));
      else return;
      e.preventDefault();
    });
  }

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
      this.rails?.setCameraMarkerVisible(true);
    } else {
      const all = $<HTMLInputElement>("#all-regions").checked;
      this.stage?.setVisibility(all ? "all" : "region");
      this.rails?.setCameraMarkerVisible(false);
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
   * Supply the assignment the retail build is missing.
   *
   * `set_skippable_region` (0x2C), the Start poll in both player-update
   * routines and the skip test in every wait opcode are all present in the
   * shipped executable; the only broken link is that the poll writes
   * `DAT_009A1A18`, which nothing reads, instead of the flag `DAT_009A2D74`
   * that the waits test. Pressing this is that write. Everything it sets in
   * motion is the game's own code -- see `Walker.skipRequested`.
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
    this.feed.clear();
    // A seek replays quietly, so no dialogue or shutter op reaches the layer.
    // Without this the caption from wherever you were still hangs there.
    this.hudLayer.reset();
    w.seek(block, step, op);
    this.hudLayer.setShutterState(w.shutterState);
    this.syncCameraToWalker();
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
    const p = this.paths?.paths.get(slot);
    if (!p) return;
    p.pose(frame, this.walker?.rollEnabled ?? false, this.pose);
    applyPose(this.camera, this.pose,
              cameraEyeY(this.pose, this.walker?.useFixedEyeY ?? false,
                         this.walker?.fixedEyeY ?? 0));
    this.rails?.highlight(slot, p.start, p.end);
    this.rails?.setCameraPose(this.camera.position, this.pose.target);
  }

  // -- walker callbacks --------------------------------------------------

  private onCamera(cmd: CamCommand): void {
    const p = this.paths?.paths.get(cmd.slot);
    this.rails?.highlight(
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
    }
  }

  private onFeed(e: FeedEntry): void {
    this.feed.push(e);
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
            else this.rails?.highlight(null);
          });
        }
        btn.addEventListener("click", () => {
          this.walker?.takeBranch(t);
          this.feed.clear();
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

  private syncCameraToWalker(): void {
    const w = this.walker;
    if (!w || this.state.mode === "free") return;
    const cam = w.cam;
    if (!cam) return;
    const p = this.paths?.paths.get(cam.slot);
    if (!p) return;
    p.pose(cam.frame, w.rollEnabled, this.pose);
    // The orientation comes from the raw curve pair; only the eye's height is
    // adjusted, and only after. Doing it the other way round tilts the shot.
    applyPose(this.camera, this.pose,
              cameraEyeY(this.pose, w.useFixedEyeY, w.fixedEyeY));
    this.rails?.setCameraPose(this.camera.position, this.pose.target);
  }

  private frame = (now: number) => {
    requestAnimationFrame(this.frame);
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;

    // `?freeze=1` halts the clock and renders exactly one frame, so a test can
    // assert against a state rather than against a race.
    if (!this.state.freeze) {
      if (this.state.mode === "free") {
        this.freeRoam.update(dt, this.camera);
      } else if (this.playing && this.walker) {
        if (this.walker.branch) {
          if (!this.branchHover) this.walker.tickBranchCountdown(dt);
          this.refreshBranchCountdown();
        } else {
          this.accum += dt * this.speed;
          let guard = 0;
          // Count the 60 Hz frames the walker actually advanced. The shutter
          // slide and the dialogue countdown are script state measured in
          // those frames, so they have to be driven from here rather than from
          // wall time -- otherwise a caption put up in Step mode quietly
          // expires two seconds later while playback is paused, which is
          // exactly long enough to look at the script tree and miss it.
          let advanced = 0;
          while (this.accum >= TICK && guard++ < 600) {
            this.accum -= TICK;
            this.walker.tick(TICK);
            advanced++;
            if (this.walker.branch || this.walker.finished) break;
          }
          this.hudLayer.tick(this.state.freeze ? 0 : advanced);
          if (!this.scrubbing) this.syncCameraToWalker();
        }
        this.refreshUi();
      }
    }

    if (this.walker) {
      this.spawns.update(this.walker.spawns);
      // Both animate: the script ramps fog and light over frames rather than
      // switching them. `update`/`set` no-op when nothing actually moved.
      const f = this.walker.fog;
      this.sceneFog.update(f.near, f.far, f.rgb, this.walker.fogSet);
      this.lighting.set(this.walker.light);
      this.backdrop.update(this.walker.backdropPreset, this.walker.backdropMode,
                           this.camera.position, this.state.freeze ? 0 : dt * 60);
      // Rigs ride the camera's clock: the routines dispatch on
      // g_active_cam_path, so object and shot run in lockstep.
      const cam = this.walker.cam;
      this.rigs.update(cam ? cam.slot : null, cam ? cam.frame : 0);
      // The volume follows the camera's yaw only, so it stays world-vertical.
      this.rain.update(this.walker.rain, this.camera.position,
                       Math.atan2(-this._fwd.x, -this._fwd.z),
                       this.state.freeze ? 0 : dt * 60);
      this.lighting.setGunLights(this.walker.gunLights);
      this.lighting.setSceneLighting(this.walker.sceneLighting);
      this.lighting.updateGunLights(
        this.camera.position,
        this.camera.getWorldDirection(this._fwd));
    }
    this.renderer.render(this.scene, this.camera);
  };

  private refreshUi(): void {
    const w = this.walker;
    if (!w || !this.stage) return;
    this.tree.mark(w.block, w.step, w.opIndex);
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

    const op: OpJson | undefined = w.currentOp;
    this.inspector.show(op ?? null, op ? { summary: opSummary(op) } : undefined);

    const route = w.currentBlock?.route;
    this.hud.set([
      ["mode", this.state.mode],
      ["block", `${w.block}  (${route?.kind ?? "?"}` +
        `${route && route.next.some((n) => n >= 0)
          ? " → " + route.next.filter((n) => n >= 0).join(",") : ""})`],
      ["step / op", `${w.step} / ${w.opIndex}`],
      ["region", w.region < 0 ? "—" : String(w.region),
        this.stage.visibility === "all"],
      ["drawn", `${this.stage.visibleCount} models, ` +
        `${this.stage.visibleTriangles.toLocaleString()} tris`],
      ["cam slot", (() => {
        if (!cam) return "—";
        const p = this.paths?.paths.get(cam.slot);
        if (!p) return String(cam.slot);
        if (p.isDamaged) {
          return `${cam.slot} ⚠ ${Object.keys(p.damaged).join(",")} invented`;
        }
        return p.repairs ? `${cam.slot} (${p.repairs} repaired)` : String(cam.slot);
      })(), !!(cam && this.paths?.paths.get(cam.slot)?.isDamaged)],
      ["cam frame", cam ? cam.frame.toFixed(1) : "—"],
      ["roll channel", w.rollEnabled ? "on (opcode 0x35)" : "off"],
      ["spawns", `${w.liveEnemies} live / ${w.spawns.length} placed`],
      ["waiting on", w.wait ? w.wait.blocksOn : "—", !!w.wait],
      ["bgm", w.bgmTrack === null ? "—" : `track ${w.bgmTrack}`],
      ["fog", this.sceneFog.describe],
      ["light", this.lighting.describe],
      ["sky", this.backdrop.describe],
      ["rigs", this.rigs.describe],
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
    ]);

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
}

function fmtVec(v: Vector3): string {
  return `${v.x.toFixed(1)}, ${v.y.toFixed(1)}, ${v.z.toFixed(1)}`;
}

void new Player().start();
