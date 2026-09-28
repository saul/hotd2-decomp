/**
 * What a `UiCommand` means.
 *
 * The one place the union becomes an effect, and exhaustive over it — a
 * command added to `ui/commands.ts` without a case here fails to compile.
 * That is the property `wireUi`'s twenty-odd anonymous listeners could not
 * have: there was no list of what the UI could do, and no way to be told one
 * had been missed.
 *
 * It reaches broadly into `Player` on purpose. A command *is* the composition
 * root deciding what a click does, so the coupling is the job rather than a
 * smell — the thing worth keeping narrow is the other direction, and
 * `PlayerView` keeps it.
 *
 * `PlayerCommands` below is the other half of that argument, and it is worth
 * being exact about what it does and does not buy. It does **not** narrow the
 * coupling; nothing here wants it narrowed. What it does is make the size of
 * the write surface visible and declared, the way `PlayerView` made the read
 * surface visible. Before it, these two functions took the whole 1060-line
 * `Player`, so a new case could reach for any member that happened to be in
 * scope and no diff would show that the surface had grown. Now a command
 * reaching for something new has to add a line here, in the open, and the
 * length of the interface is a standing measurement of how much of the player
 * the UI can move.
 */
import type { PerspectiveCamera, Scene } from "three";
import type { ToggleName, UiCommand } from "../ui/commands";
import type { PlayerState } from "./urlstate";
import type { CamCommand, FeedEntry, Walker } from "../script/walker";
import { ActorKillAll } from "../game/combat/resolve_hit";
import type { Bgm } from "../audio/bgm";
import type { Backdrop } from "../render/backdrop";
import type { BloodColourLayer } from "../render/bloodcolour";
import type { BreakableLayer } from "../render/breakables";
import type { EffectLayer } from "../render/effects";
import type { CameraRig } from "../render/camera";
import type { CharacterLayer } from "../render/characters";
import type { ColiDebugLayer } from "../render/coli_debug";
import type { DebugBoxLayer } from "../render/debug";
import type { FogMode, SceneFog } from "../render/fog";
import type { TextureFilter, TextureFilterMode }
  from "../render/texfilter";
import type { LightingMode, SceneLighting } from "../render/lighting";
import type { SpawnLayer } from "../render/overlays";
import type { PropLayer } from "../render/props";
import type { Rain } from "../render/rain";
import type { RigLayer } from "../render/rigs";
import type { Shooting } from "../render/shooting";
import type { StageScene } from "../render/stagescene";
import type { StuckDebugLayer } from "../render/stuck_debug";

/**
 * Everything the commands below may move, and nothing else.
 *
 * The `readonly` marks are the distinction that carries the information, so
 * they are worth reading carefully: a member is mutable here only if a command
 * *assigns to it* (`p.boxWait = c.on`), and `readonly` if the commands merely
 * reach *through* it (`p.lighting.setMode(...)`, `p.cam.rails?.setVisible()`).
 * The reference is fixed; what it names is not. So the mutable block is the
 * short honest list of player fields a click can overwrite, and the rest is
 * the list of layers a click can talk to.
 *
 * `state` is the case that makes the distinction concrete. `PlayerState` is a
 * plain mutable record and several commands write fields on it, so
 * `readonly state: PlayerState` says exactly the right thing: a command may
 * set `state.stage`, and may not swap the record the player is holding.
 */
export interface PlayerCommands {
  // -- assigned to ------------------------------------------------------

  /** The wait panel's `box` checkbox. */
  boxWait: boolean;
  /** Replaced rather than mutated, so the projection settles it by id. */
  toggles: Readonly<Record<ToggleName, boolean>>;
  /** True while the pointer is over the branch bar; freezes the countdown. */
  branchHover: boolean;
  /** Box the frame to 4:3, or fill the window. See `UiProjection.pillarbox`. */
  pillarbox: boolean;

  // -- reached through --------------------------------------------------

  /** Written field by field; never replaced. See the note above. */
  readonly state: PlayerState;
  readonly walker: Walker | null;
  /** Sets, so the contents move while the reference does not. */
  readonly boxedClasses: Set<number>;
  readonly shutClasses: Set<number>;
  readonly camera: PerspectiveCamera;
  readonly scene: Scene;
  readonly scene3d: StageScene | null;
  readonly cam: CameraRig;
  readonly lighting: SceneLighting;
  readonly sceneFog: SceneFog;
  readonly texFilter: TextureFilter;
  readonly bgm: Bgm;
  readonly backdrop: Backdrop;
  readonly rain: Rain;
  readonly rigs: RigLayer;
  readonly chars: CharacterLayer;
  readonly props: PropLayer;
  readonly breakables: BreakableLayer;
  /** The shot effects, for the muzzle-flash toggle. */
  readonly effects: EffectLayer;
  /** Red or green blood — the game's own option. */
  readonly bloodColour: BloodColourLayer;
  readonly spawns: SpawnLayer;
  readonly shooting: Shooting;
  readonly debug: DebugBoxLayer;
  readonly coliDebug: ColiDebugLayer;
  readonly stuckDebug: StuckDebugLayer;

  // -- asked to do something --------------------------------------------

  seekTo(block: number, step: number, op: number): void;
  setMode(mode: PlayerState["mode"]): void;
  play(): void;
  pause(): void;
  /** The start screen's button. See the `start` command. */
  startGame(): void;
  /** Sound on or off, as the viewer's own choice. */
  setMuted(muted: boolean): void;
  requestSkip(): void;
  /** The game-over screen's buttons and the menu's Restart. */
  restartRun(stage: number): void;
  /** A stage the menu chose, loaded and -- once started -- running. */
  loadAndPlay(): void;
  poseFromSlot(slot: number, frame: number): void;
  syncCameraToWalker(reseat?: boolean): void;
  onCamera(cmd: CamCommand): void;
  onFeed(e: FeedEntry): void;
  clearFeed(): void;
  markAddress(): void;
  pushUrl(): void;
  /** Put the bundle screen on the page. See `app/install/ExportScreen.tsx`. */
  openBundles(): void;
  resize(): void;
}

export function runCommand(p: PlayerCommands, c: UiCommand): void {
  switch (c.kind) {
    case "boxClass":
      if (c.on) p.boxedClasses.add(c.cls);
      else p.boxedClasses.delete(c.cls);
      return;
    case "foldClass":
      if (c.shut) p.shutClasses.add(c.cls);
      else p.shutClasses.delete(c.cls);
      return;
    case "boxWait":
      p.boxWait = c.on;
      return;
    case "seek":
      p.seekTo(c.block, c.step, c.op);
      return;
    case "toggle":
      p.toggles = { ...p.toggles, [c.name]: c.on };
      applyToggle(p, c.name, c.on);
      return;
    case "setStage":
      p.state.stage = c.stage;
      // The entry belongs to the stage that is leaving. Stage 4's block 4 is
      // not stage 5's anything, and carrying it over would open the next
      // stage in the middle of itself.
      p.state.entry = undefined;
      p.state.block = p.state.step = p.state.op = undefined;
      p.state.slot = p.state.frame = undefined;
      p.pushUrl();
      p.loadAndPlay();
      return;
    case "setEntry":
      p.state.entry = c.entry;
      // An address inside the stage is an address on one route through it, and
      // the other entry may not reach it. Drop it and open at the entry.
      p.state.block = p.state.step = p.state.op = undefined;
      p.state.slot = p.state.frame = undefined;
      p.pushUrl();
      p.loadAndPlay();
      return;
    case "setOriginal":
      p.state.original = c.on;
      p.pushUrl();
      p.loadAndPlay();
      return;
    case "setMode":    p.setMode(c.mode); return;
    case "play":       p.play(); return;
    case "pause":      p.pause(); return;
    case "start":      p.startGame(); return;
    case "requestSkip": p.requestSkip(); return;
    case "restartStage": p.restartRun(p.state.stage); return;
    case "restartFromStageOne": p.restartRun(1); return;
    case "branchHover":
      p.branchHover = c.over;
      return;
    case "openBundles":
      // The one command whose effect is not inside the player's own tree:
      // the bundle screen is a second React root over the page, because
      // it runs before there is a player at all and none of its state is
      // game state. `Player` owns the call; `ui/` only says it was clicked.
      p.openBundles();
      return;
    case "takeBranch":
      p.walker?.takeBranch(c.target);
      p.clearFeed();
      p.syncCameraToWalker();
      p.markAddress();
      return;
    case "previewBranch":
      p.poseFromSlot(c.slot, c.frame);
      return;
    case "endPreview": {
      p.syncCameraToWalker();
      // `poseFromSlot` moved the rail highlight to the preview path; put it
      // back on whatever the script is actually playing.
      const cam = p.walker?.cam;
      if (cam) p.onCamera(cam);
      else p.cam.rails?.highlight(null);
      return;
    }
    case "setPillarbox":
      p.pillarbox = c.on;
      p.resize();
      return;
    // No redraw here, and none needed: the projection is rebuilt every frame
    // from the one tick, so a setting that changes what a layer reports shows
    // up on the next one. Twenty controls each poking the UI was the second
    // update path, and it is gone.
    case "setLightMode":
      p.lighting.setMode(c.mode as LightingMode);
      return;
    case "setFogMode":
      p.sceneFog.setMode(c.mode as FogMode);
      return;
    case "setFilterMode":
      p.texFilter.setMode(c.mode as TextureFilterMode);
      return;
    case "setVolume":  p.bgm.setVolume(c.volume / 100); return;
    case "toggleMute": p.setMuted(!p.bgm.muted); return;
    case "killAll": {
      // The debug clear: `killAll` drops every live actor to zero hit points
      // and starts its directional death, which is what opens the enemy gate.
      // Civilians go with them — they are what `wait_scripted_actors` counts,
      // and a room cleared of enemies with the hostages still standing is a
      // script that has not moved.
      // `ActorKillAll` from here rather than through the character layer: a
      // debug clear is a *command*, and the composition root is what turns a
      // click into one. `render/` calling it was the port being driven from a
      // renderer, which is what step 21 closed.
      const n = ActorKillAll(p.shooting.cameraYawBams, p.chars.rng);
      const parts = [`${n.enemies} enem${n.enemies === 1 ? "y" : "ies"}`];
      if (n.civilians) parts.push(`${n.civilians} civilian`
                                  + (n.civilians === 1 ? "" : "s"));
      p.onFeed({
        seq: -1, block: p.walker?.block ?? -1, step: -1, opIndex: -1,
        op: { i: -1, at: 0, op: -1, name: "kill all", cat: "combat" },
        note: `${parts.join(" · ")} killed`,
      });
      return;
    }
  }
}

/**
 * What each view toggle does.
 *
 * Exhaustive over `ToggleName`, so a row added to the table in
 * `ui/panels/Toggles.tsx` without a case here fails to compile. That is the
 * property the sixteen anonymous `wireUi` listeners could not have: there
 * was no list of them, and no way to be told one had been missed.
 */
export function applyToggle(p: PlayerCommands, name: ToggleName,
                                    on: boolean): void {
  switch (name) {
    case "allRegions":
      p.state.all = on || undefined;
      p.scene3d?.setVisibility(on ? "all" : "region");
      p.pushUrl();
      return;
    case "rails":        p.cam.rails?.setVisible(on); return;
    case "aimRails":     p.cam.rails?.setAimRailsVisible(on); return;
    case "unported":     p.debug.showUnported = on; return;
    case "stuck":        p.stuckDebug.setEnabled(on); return;
    case "coli":         p.coliDebug.setEnabled(on); return;
    case "boxes":        p.debug.showBoxes = on; return;
    case "rigs":         p.rigs.setEnabled(on); return;
    case "sky":
      // One control for both: they are the same weather.
      p.backdrop.setEnabled(on);
      p.rain.setEnabled(on);
      return;
    case "hud":
      // Deliberately nothing. `.hud-layer`'s `hidden` is rendered by React
      // from `toggles.hud` since step 26 and the HUD strip's shutter row reads
      // the same field since step 28, so by the time this runs the toggle has
      // already reached both of its readers through `p.toggles`. The case
      // stays because the switch is exhaustive over `ToggleName` and that is
      // the property worth keeping: deleting it would make a toggle with no
      // effect indistinguishable from one somebody forgot to wire up.
      return;
    case "spawns":       p.spawns.setVisible(on); return;
    case "chars":        p.chars.setEnabled(on); return;
    case "props":        p.props.setEnabled(on); return;
    case "breakables":   p.breakables.setEnabled(on); return;
    case "propBoxes":    p.props.setDebugVisible(on); return;
    // Both of these are about what is *drawn*, not about what the game does:
    // the port spawns the same records and marks the same materials either
    // way, so neither changes a snapshot.
    case "muzzle":       p.effects.setMuzzle(on); return;
    case "redBlood":     p.bloodColour.setColour(on ? "red" : "green"); return;
    // A debug aid, not a view: it changes when the script moves on. The walker
    // reads it at the next branch; a stage loads its walker with the current
    // value (`stage_load.ts`). Turning it off while a branch is being held
    // lets the script go the way the engine would have on that frame, with the
    // choice it latched then.
    case "branchPause":
      if (!p.walker) return;
      p.walker.options.branchPause = on;
      if (!on && p.walker.branch) p.walker.takeBranch();
      return;
  }
}
