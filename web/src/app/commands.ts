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
 */
import type { Player } from "./main";
import type { ToggleName, UiCommand } from "../ui/commands";
import type { FogMode } from "../render/fog";
import type { LightingMode } from "../render/lighting";

export function runCommand(p: Player, c: UiCommand): void {
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
      p.state.block = p.state.step = p.state.op = undefined;
      p.state.slot = p.state.frame = undefined;
      p.pushUrl();
      void p.loadStage();
      return;
    case "setOriginal":
      p.state.original = c.on;
      p.pushUrl();
      void p.loadStage();
      return;
    case "setMode":    p.setMode(c.mode); return;
    case "setSpeed":   p.speed = c.speed; return;
    case "play":
    case "pause":      p.togglePlay(); return;
    case "stepForward": p.stepOnce(); return;
    case "stepBack":   p.stepBack(); return;
    case "requestSkip": p.requestSkip(); return;
    case "branchHover":
      p.branchHover = c.over;
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
    case "reset":
      p.clearFeed();
      p.walker?.reset();
      p.walker?.primeToFirstWait();
      p.syncCameraToWalker();
      p.markAddress();
      p.pushUrl();
      return;
    case "scrubFrame": {
      // `done` is the pointer coming off the slider. While it is down the
      // camera systems must not fight the drag for the pose, which is what
      // `cam.driving` is read for in the frame.
      p.scrubbing = !c.done;
      const w = p.walker;
      if (!w?.cam) return;
      w.cam.frame = c.frame;
      p.syncCameraToWalker();
      p.state.frame = w.cam.frame;
      p.pushUrl();
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
    case "setVolume":  p.bgm.setVolume(c.volume / 100); return;
    case "toggleMute": p.bgm.setMuted(!p.bgm.muted); return;
    case "saveState": {
      // Held in memory rather than written out: the value is plain JSON, so
      // a `copy(player.saveSnapshot())` in the console is a file whenever
      // one is wanted, and the button is for the loop you actually run --
      // snapshot, try something, put it back.
      const snap = p.saved = p.saveSnapshot();
      p.onFeed({
        seq: -1, block: p.walker?.block ?? -1, step: -1, opIndex: -1,
        op: { i: -1, at: 0, op: -1, name: "state saved", cat: "flow" },
        note: `block ${snap.stage}/${snap.frame | 0} · `
            + `${Object.keys(snap.parts).length} slices`,
      });
      return;
    }
    case "loadState": {
      if (!p.saved) return;
      const err = p.loadSnapshot(p.saved);
      p.onFeed({
        seq: -1, block: p.walker?.block ?? -1, step: -1, opIndex: -1,
        op: { i: -1, at: 0, op: -1, name: "state loaded", cat: "flow" },
        note: err ?? `back to frame ${p.saved.frame | 0}`,
      });
      return;
    }
    case "killAll": {
      // The debug clear: `killAll` drops every live actor to zero hit points
      // and starts its directional death, which is what opens the enemy gate.
      const n = p.chars.killAll(p.shooting.cameraYawBams);
      p.onFeed({
        seq: -1, block: p.walker?.block ?? -1, step: -1, opIndex: -1,
        op: { i: -1, at: 0, op: -1, name: "kill all", cat: "combat" },
        note: `${n} enem${n === 1 ? "y" : "ies"} killed`,
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
export function applyToggle(p: Player, name: ToggleName,
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
    case "hud":          p.hudLayer.setEnabled(on); return;
    case "spawns":       p.spawns.setVisible(on); return;
    case "chars":        p.chars.setEnabled(on); return;
    case "props":        p.props.setEnabled(on); return;
    case "breakables":   p.breakables.setEnabled(on); return;
    case "trackEnemies":
      p.cam.trackEnabled = on;
      p.syncCameraToWalker();
      return;
    case "shoot":
      p.shooting.setEnabled(on, p.camera, p.scene);
      return;
  }
}
