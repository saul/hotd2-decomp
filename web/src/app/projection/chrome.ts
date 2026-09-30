/**
 * The four small projections the chrome reads.
 *
 * Each is a read of the player's own state turned into plain values: the
 * transport's mode and camera label, the sound, the skip offer and the branch
 * question. They sit beside `buildProjection` because they are the same kind
 * of thing — and out of `main.ts` because a composition root that also formats
 * strings is doing two jobs.
 */
import type { Player } from "../main";
import type {
  BranchProjection, ContinueProjection, JoinProjection, GameOverProjection,
  SkipProjection, SoundProjection, TransportProjection,
} from "../../ui/projection";
import { AppState, G, PlayerState, RunPhase } from "../../game/globals";
import { CreditsAvailable } from "../../game/credits";
import { SpawnClass } from "../../game/spawn_class";

/**
 * The skip bar, shown under the game's own condition.
 *
 * `Walker.canSkip` is `DAT_009A2D7C != 0 && g_nFiringGate == 0` -- the exact
 * test both player-update routines make before looking at Start. So the bar
 * appears precisely where the game would have accepted a skip, which is
 * something the retail build never shows you, its skip being one assignment
 * short of working.
 *
 * Unlike the branch bar this is an offer, not a question: playback is not
 * waiting on it and ignoring it changes nothing.
 */
export function skipProjection(p: Player): SkipProjection | null {
  const w = p.walker;
  // The bar follows the region, not the offer. `canSkip` adds the firing
  // gate, and gating *visibility* on that made the whole feature invisible
  // whenever the gate happened to be up -- which is not worth the fidelity,
  // since the region is the thing the script actually declares. So the bar
  // shows for the region and the button carries the gate.
  if (!w?.skippable) return null;
  // Not over the options screen: the walker stands still under it and the
  // skip poll is the in-play player's, so START there is the list's alone.
  if (G.g_app_state === AppState.Options) return null;
  const can = w.canSkip;
  const held = w.wait?.blocksOn;
  return {
    canSkip: can,
    // On the rare frame a branch point is live too, sit above it.
    stacked: !!w.branch,
    sub: !can
      ? "region open, but the shutter's firing gate is up — the game would "
        + "not poll Start here"
      : held
        ? `holding on ${held} — skips every wait until the region closes`
        : "skips every wait until set_skippable_region closes",
  };
}

/**
 * The continue offer, read off the player's shell.
 *
 * Shown for as long as player 1 is on `PlayerContinueCountdown` in play --
 * its own countdown or the run's (phase 4, `g_continue_timer`), which is the
 * digit the game draws either way. Enabled on the tests `PlayerTryStartPress`
 * makes before it spends (`game/player_shell.ts`): the screen furniture's bit
 * 2 and a credit. The spend itself is the game's to make when START lands.
 */
export function continueProjection(player = 0): ContinueProjection | null {
  if (G.g_app_state !== AppState.InPlay
      || G.g_player_state[player] !== PlayerState.Continue) return null;
  const t = G.g_nRunPhase === RunPhase.ContinueCountdown
    ? G.g_continue_timer : G.g_player_continue_timer[player];
  const can = CreditsAvailable() !== 0
    && (G.g_screen_furniture_flags & 2) !== 0;
  const credits = G.g_free_play === 1 ? "free play" : `${G.g_credits[0]} credits`;
  return {
    canContinue: can,
    digit: Math.max(0, t >> 12),
    sub: can ? `START: spend a credit and play on (${credits})`
             : "START would not be heard here: no credit, or the screen is not up",
  };
}

/**
 * The join offer, read off the player's shell. The player is out
 * (`PlayerStateOut`, whose task polls for START) on the play screen with the
 * screen furniture's bit 2 up -- which is exactly when `PlayerPollStart`
 * draws the credit line, PRESS START BUTTON -- and `PlayerTryStartPress` takes
 * the START if there is a credit, as a join (`EnterJoinIn`).
 */
export function joinProjection(player = 0): JoinProjection | null {
  if (G.g_app_state !== AppState.InPlay
      || G.g_player_state[player] !== PlayerState.Out
      || (G.g_screen_furniture_flags & 2) === 0) return null;
  const can = CreditsAvailable() !== 0;
  const credits = G.g_free_play === 1 ? "free play" : `${G.g_credits[0]} credits`;
  return {
    label: player === 1 ? "Join" : "Start",
    canJoin: can,
    sub: can ? `START: spend a credit and join as player ${player + 1} (${credits})`
             : "no credit left to join with",
  };
}

/**
 * The branch bar's contents.
 *
 * **The game has already decided.** `b.choice` is `g_script_branch_var` as it
 * stood when the step list ran out, and the bar's job is to say which route
 * that is and give a viewer a moment to take the other one -- not to ask a
 * question the engine never asks. The countdown label has three states, each
 * saying what it means: running, frozen because the pointer is over the bar,
 * or simply waiting because only Play mode runs the window at all.
 */
export function branchProjection(p: Player): BranchProjection | null {
  const b = p.walker?.branch;
  if (!b) return null;
  const route = p.walker?.currentBlock?.route;
  const taking = route?.next[b.choice] ?? -1;
  return {
    sub: `block ${b.block} → ${b.targets.join(" or ")}`,
    options: b.targets.map((t) => {
      const choice = route ? route.next.indexOf(t) : -1;
      // The arcade shows a preview of each route before you commit. Those
      // shots are the `store_six` operands, indexed by `branch_choice`.
      // Unused choices are stored as slot 0 / frame 0 and resolve to no
      // path; those get no preview rather than a shot of somewhere else.
      const shot = b.preview?.find((q) => q.choice === choice && q.cam);
      const chosen = t === taking;
      return {
        target: t,
        label: `→ ${t}`,
        title: chosen
          ? "The route the game itself is taking, because "
            + `g_script_branch_var is ${b.choice}. Nothing has to be clicked.`
          : `Override: take route to block ${t} instead`
            + (choice >= 0 ? ` (branch_choice ${choice})` : ""),
        chosen,
        preview: shot ? { slot: shot.slot, frame: shot.frame } : null,
      };
    }),
    countdown: !p.playing
      ? "paused -- Play runs the window"
      : p.branchHover
        ? "window paused"
        : taking >= 0
          ? `taking → ${taking} in ${Math.max(0, b.countdown).toFixed(1)} s`
          : `ending the scene in ${Math.max(0, b.countdown).toFixed(1)} s`,
    paused: p.playing && p.branchHover,
  };
}

/** Play or free roam, running or not, and the shot's own label. */
export function transportProjection(p: Player): TransportProjection {
  const w = p.walker;
  const cam = w?.cam;
  const path = cam ? p.paths?.paths.get(cam.slot) : undefined;
  const base = { playing: p.playing, mode: p.state.mode };
  if (!cam || !path) return { ...base, camLabel: "no camera path" };
  const lo = Math.min(cam.startFrame, cam.endFrame);
  const hi = Math.max(cam.startFrame, cam.endFrame, lo + 1);
  return {
    ...base,
    camLabel: `${path.file}[${path.index}] slot ${cam.slot}  `
      + `frame ${cam.frame.toFixed(0)} / ${hi.toFixed(0)}`
      + (cam.isStatic ? "  (static pose)" : ""),
  };
}

export function soundProjection(p: Player): SoundProjection {
  const bs = p.bgm.current;
  const on = !p.bgm.muted;
  return {
    muted: p.bgm.muted,
    volume: Math.round(p.bgm.volume * 100),
    blocked: bs.blocked,
    // The button states what it currently IS, not what pressing it does.
    text: on ? (bs.playing ? "Sound on" : "Sound on…") : "Muted",
    label: !bs.file
      ? "no bgm"
      : bs.blocked && on
        ? "press the speaker to allow audio"
        : `${bs.file}${bs.loop === false ? " (once)" : ""}`,
  };
}

/** What each of `GameOverRunPhase`'s phases is showing. */
const GAME_OVER_LABELS = [
  "game over", "game over", "game over", "GAME OVER", "your route",
  "your route -- click to go on",
];

/**
 * Whether the game drew this page's player's crosshair this frame --
 * `HudDrawCrosshair`'s decision, recorded in `G.g_crosshair_drawn`. The
 * reticle itself is the page's, because it follows the pointer between ticks.
 * Player 1's alone or hosting; player 2's on a netplay replica.
 */
export function crosshairProjection(player = 0): boolean {
  return G.g_crosshair_drawn[player] !== 0;
}

/**
 * The game-over screen, read off `G`. Null while app state 6 runs; on the
 * game-over screen (7) the phase -- its sprites are the HUD layer's, through
 * `G.g_screen_sprite_draws` like every other screen sprite; once it has
 * handed on to the next screen (3, which the port does not have) phase -1,
 * so the buttons stay up. Null on the options screen (0x0C), which is not a
 * game over, and on the title it hands back to (4), which the page leaves at
 * once for a new game.
 */
export function gameOverProjection(): GameOverProjection | null {
  if (G.g_app_state === AppState.InPlay || G.g_app_state === AppState.Options
      || G.g_app_state === AppState.Title) {
    return null;
  }
  const over = G.g_app_state === AppState.GameOver;
  return {
    phase: over ? G.g_nRunPhase : -1,
    label: over ? (GAME_OVER_LABELS[G.g_nRunPhase] ?? "game over")
                : "game over",
  };
}

/**
 * `[port-only]` -- whether Original Mode's trunk (class 0x6E) is open: a
 * live one in the pool. The screen reads the pad, not the gun.
 */
export function ItemSelectOpen(): boolean {
  return G.g_object_list.some((o) => o.cls === SpawnClass.ItemSelect && !o.dead);
}

/**
 * `[port-only]` -- whether a screen the game drives with the pad rather than
 * the gun is up: the options (app state 0x0C) or Original Mode's trunk. The
 * page's arrows, Right Shift and a tap mean the pad there.
 */
export function padScreenUp(): boolean {
  return G.g_app_state === AppState.Options
    || (G.g_app_state === AppState.InPlay && ItemSelectOpen());
}

/** The saved Original Mode items, for the menu, in Original Mode only. */
export function originalItemsProjection(original: boolean):
    { count: number; kinds: number } | null {
  if (!original) return null;
  const items = G.g_profile_original_items;
  return {
    count: items.reduce((a, n) => a + Math.max(0, n), 0),
    kinds: items.filter((n) => n > 0).length,
  };
}
