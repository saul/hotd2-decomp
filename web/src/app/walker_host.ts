/**
 * What the script asks of the player.
 *
 * `WalkerHost` is the interpreter's one outward port: fifteen callbacks
 * covering four different kinds of thing, which is the smell the architecture
 * doc names — "the machine reaching into everything". Collecting them here
 * does not shrink the port, but it makes the shape visible, and it is the
 * list to work down.
 *
 * Reading it, they are:
 *
 * * **Streaming** — `enterRegion`, `loadSlot`, `unloadSlot`. Real services:
 *   only the scene knows what a region is.
 * * **Notifications out** — `onFeed`, `onBranch`, `startCamera`. These want
 *   to be events on the bus, not host methods; the script is telling, not
 *   asking.
 * * **Questions about the world** — `aliveEnemies`, `aliveCivilians`,
 *   `cameraFree`. The genuinely irreducible part, and the read-only port the
 *   doc says should be all that survives.
 * * **Output devices** — `playSound`, `setShutter`, `showMessage`,
 *   `endDialogue`. Audio and the screen-space layer, reached directly.
 *
 * `loadRegion` and `releaseCamera` do nothing at all, and have not since the
 * streaming moved into `enterRegion`.
 */
import { Walker, type WalkerHost } from "../script/walker";
import type { ScriptJson } from "../bundle";
import { G } from "../game/globals";
import { screenMessage } from "./projection/message";
import type { Player } from "./main";

export function makeWalkerHost(p: Player, script: ScriptJson): WalkerHost {
  return {
    enterRegion: (r) => p.scene3d?.enterRegion(r),
    loadRegion: () => {},
    loadSlot: (s) => p.scene3d?.loadSlot(s),
    unloadSlot: (s) => p.scene3d?.unloadSlot(s),
    startCamera: (c) => p.onCamera(c),
    releaseCamera: () => {},
    onFeed: (e) => p.onFeed(e),
    // Nothing to do: the branch bar is a projection now, so the next frame
    // draws it. The callback stays because the walker's contract has one.
    onBranch: () => {},
    playSound: (id) => p.bgm.play(id),
    // `g_enemies_alive` — the engine's own counter, stepped by
    // `CountEnemyZombieIn` / `CountEnemyThrowerIn` and the four retires in
    // `game/combat/counts.ts`, exactly as `g_civilians_alive` below is.
    //
    // It used to be `chars.aliveCount`, which recounts
    // `instances.filter(visible && !dead && isEnemy)` in the **renderer**.
    // That is the derived count `counts.ts` exists to explain is not the same
    // quantity, and three things followed from it: an actor hidden for one
    // frame left the gate's count, a class 0x31 whose death is a four-state
    // chain left it on the first frame of the fall while it was still on
    // screen attacking, and an enemy class the port cannot run at all — 0x43
    // and 0x51 are in `ENEMY_CLASSES` — was counted and could never die.
    //
    // Null unless Shoot is on: only then is there anything that can make
    // the count fall, so only then is the gate a real condition.
    aliveEnemies: () => p.shooting.isEnabled ? G.g_enemies_alive : null,
    // `g_civilians_alive` is maintained by the class-0x10 port itself --
    // `CivilianInit` raises it, op 0x2C's `LeaveCountNow` and the removal
    // path drop it -- so this is the engine's own counter, not a restatement
    // of it. Null while Shoot is off, for the reason on `aliveEnemies`.
    aliveCivilians: () => p.shooting.isEnabled ? G.g_civilians_alive : null,
    // `g_camera_free` -- the room-clear waits need the camera back on its
    // rail, not just the count at zero. Null while Shoot is off, where the
    // counts never fall anyway and the gates pass on their own.
    cameraFree: () => p.shooting.isEnabled ? G.g_camera_free !== 0 : null,
    // The shutter is the walker's own state now: there is nothing to tell.
    showMessage: (g) => {
      // Variant 0 is the 1P / player-1 configuration, which is what a
      // single-viewer playback corresponds to.
      const raw = script.sound?.messages?.[String(g)]?.[0] ?? null;
      const v = screenMessage(raw);
      if (!raw || !v) return null;
      if (raw.voice) p.bgm.play(raw.voice);
      const said = v.lines.map((l) => l.text).join(" / ");
      return {
        frames: v.frames,
        note: said
          ? `“${said}”${v.voiceFile ? `  ·  ${v.voiceFile}` : ""}`
          : `dialogue ${v.frames}f${v.voiceFile ? ` · ${v.voiceFile}` : ""}`
            + " (no subtitle lines)",
      };
    },
    // The subtitle task tests the skip flag every frame and ends itself, so
    // the caption goes at once. The voice is a fire-and-forget PlaySoundId
    // that the game leaves playing; it is stopped here because the player
    // owns the audio element and a line talking over a scene you have just
    // skipped past reads as a bug rather than as fidelity.
    endDialogue: () => {
      p.bgm.stopVoice();
    },
  };
}

export type { Walker };
