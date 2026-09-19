/**
 * The game-over screen: app state 7, `GameOverRunPhase` (`FUN_00460960`).
 *
 * The run asks for it when nobody is left in play and no continue is taken
 * (`RunPhaseContinueCountdown`, `RunPhaseNoContinueWait`); `CommitAppState`
 * applies it and leaves run phase 0. Six phases, all `[proved]`:
 *
 * | phase | what |
 * |---:|---|
 * | 0 | loads the screen's assets (texbanks 0x155 and, outside Training and Boss, 0x14F; the scene set 0x4D), zeroes the camera, builds the first task list -- the fly-over camera, the player tasks, `SelectAttackablePlayer` -- puts every player still at 4 into 6, **200** frames on the timer, drops furniture bit 1, and starts BGM 9, `OVR_AR.WAV`, unlooped |
 * | 1 | the fly-over: camera path `0x1F` from frame 10, one frame a tick; the trigger cuts it short once the timer is under `0xA5`. In Original Mode the carried items are copied out on its 0xC6th frame and saved |
 * | 2 | a new task list: the camera reset and the **GAME OVER** logo task; **180** frames |
 * | 3 | the logo (below); the trigger cuts it short under `0xAF`. Then Training and Boss restart the stage (players at 6 go to 0, app state 6); everything else goes on |
 * | 4 | the route map: the route this run took, drawn over a scrolling map, with the players' characters |
 * | 5 | waits for the trigger (or the map to say it is done, `0x007DCCE4 == -1`), then clears the credits and asks for the next screen, `g_app_state_next_table[caption][7]` = **3** |
 *
 * ## What the port runs, and what it draws
 *
 * Every phase transition, timer, skip, player-state change, sound and the
 * next-screen request is here. The logo's sprites are here too, as the
 * records the engine's `ScreenSpriteAnimTick` tasks hold, so the HUD can draw
 * them from game state.
 *
 * `[diverges]` **Three things are not ported, and all three are drawing:**
 * the fly-over (camera path `0x1F` over the game-over scene set, which the
 * bundle does not carry -- the stage stays on screen, frozen), the logo's
 * **textures** (sprite ids `0x43A..0x43D` are texbank `0x155`'s global slots
 * `0x9F0..0x9F3`, and the bundle carries no screen-sprite texbanks: the HUD
 * draws the records as styled text instead), and the route map with its two
 * character figures (`GameOverBuildRouteTasks`, `RouteMapDrawTask`). The
 * route map's own "done" flag is therefore never raised, and phase 5 waits
 * for the trigger, which is one of its two exits in the engine as well.
 */
import type { Events } from "../core/events";
import { RequestAppState } from "./app_state";
import { CreditTiersUpdate } from "./credits";
import { GameMode } from "./game_mode";
import { AppState, G } from "./globals";
import { PlayerSetState, PlayerTasksRun, type PlayerFrame }
  from "./player_shell";
import { PlayerState } from "./player_state";

/** `GameOverRunPhase`'s phases -- `g_nRunPhase` while `g_app_state` is 7. */
export enum GameOverPhase {
  /** Load, arm the fly-over, 200 frames, the music. */
  Arm = 0,
  /** The fly-over. */
  FlyOver = 1,
  /** Build the logo's task list. */
  ArmLogo = 2,
  /** The logo. */
  Logo = 3,
  /** `GameOverRouteMapArm` (`FUN_00460F00`). */
  ArmRouteMap = 4,
  /** `GameOverRouteMapWait` (`FUN_004610F0`). */
  RouteMap = 5,
}

/** `g_pad_state` bits both cuts test: `2` player 0, `0x20000` player 1. */
export const GAME_OVER_SKIP_BITS = 0x2 | 0x20000;
/** Phase 0's timer: 200 frames of fly-over. */
const FLY_OVER_FRAMES = 200;
/** The fly-over can be cut once the timer is under this. */
const FLY_OVER_SKIP_BELOW = 0xa5;
/** Phase 2's timer: 180 frames of logo. */
const LOGO_FRAMES = 0xb4;
/** The logo can be cut once the timer is under this. */
const LOGO_SKIP_BELOW = 0xaf;
/** `PlaySoundId(0x10000009)`: BGM 9, `OVR_AR.WAV`, not looped. */
export const GAME_OVER_BGM = 0x10000009;
/** `g_app_state_next_table[*][7]` at `0x004E1014 + 7`: the next screen. */
export const GAME_OVER_NEXT_APP_STATE = 3;

/**
 * One `ScreenSpriteAnimSpawn` task (`FUN_00499C60`, `0x60` bytes): a 2D
 * sprite drawn every frame by `ScreenSpriteDraw` (`FUN_00499F00`) on layer
 * 10 and animated by `ScreenSpriteAnimTick` until its count runs out.
 */
export interface ScreenSpriteAnim {
  /** `+0x34` -- the sprite id; `0x0057A5BC[id]` is its texbank. */
  id: number;
  /** `+0x48`, `+0x4C` -- screen pixels, 640x480, the sprite's centre. */
  x: number;
  y: number;
  /** `+0x50`, `+0x54` -- scale. */
  sx: number;
  sy: number;
  /** `+0x58` -- alpha, 0..1. */
  alpha: number;
  /** `+0x5C` -- the per-frame alpha step mode 1 uses. */
  alphaStep: number;
  /** `+0x38` -- frames run. */
  count: number;
  /** `+0x3C` -- the lifetime the modes measure against. */
  frames: number;
  /** `+0x40` -- the scale mode. */
  scaleMode: number;
  /** `+0x44` -- the alpha mode. */
  alphaMode: number;
  /**
   * `[port-only]` -- the task killed itself this frame. The engine draws
   * before it tests, so a record's last frame is still drawn; the walk drops
   * it at the start of the next.
   */
  done: boolean;
}

/**
 * `ScreenSpriteAnimSpawn` — `FUN_00499C60`. `alphaStep` is a fifth of the
 * alpha for mode 0 and alpha / frames for any other.
 */
export function ScreenSpriteAnimSpawn(id: number, x: number, y: number,
                                      sx: number, sy: number, alpha: number,
                                      frames: number, scaleMode: number,
                                      alphaMode: number): void {
  G.g_screen_sprite_anims.push({
    id, x, y, sx, sy, alpha, frames, scaleMode, alphaMode, count: 0,
    done: false,
    alphaStep: alphaMode === 0 ? alpha * 0.2 : alpha / frames,
  });
}

/**
 * `ScreenSpriteAnimTick` — `FUN_00499CE0`. Draw (the HUD's, from this
 * record), then the scale mode, then the alpha mode and the end test, then
 * the count. Returns false once the task has killed itself.
 *
 * ```
 * scale  1: sx -= 1/frames, sy += 1     2: both -= 1/frames    3: both -= 5/frames
 *        4: both += 1/frames, then 5's  5: sx += 3/frames, sy += 3/frames
 * alpha  0: the last 10 frames -0.1     1: -= alphaStep, floored at 0
 *        2: +0.02 under 50, -0.05 in the last 20
 *        4: +1/60 under 60, -1/30 in the last 30   5: +-0.1 at either end
 *        6: +0.1 under 10                7: the last 30 frames -1/30
 * ends once count passes frames
 * ```
 */
export function ScreenSpriteAnimTick(s: ScreenSpriteAnim): boolean {
  switch (s.scaleMode) {
    case 1:
      s.sx -= 1.0 / s.frames;
      s.sy += 1.0;
      break;
    case 2: {
      const d = 1.0 / s.frames;
      s.sx -= d; s.sy -= d;
      break;
    }
    case 3: {
      const d = 5.0 / s.frames;
      s.sx -= d; s.sy -= d;
      break;
    }
    case 4: {
      // The engine's case 4 adds 1/frames and falls into case 5's 3/frames.
      const d = 1.0 / s.frames + 3.0 / s.frames;
      s.sx += d; s.sy += d;
      break;
    }
    case 5: {
      const d = 3.0 / s.frames;
      s.sx += d; s.sy += d;
      break;
    }
    default:
      break;
  }
  switch (s.alphaMode) {
    case 0:
      if (s.count > s.frames - 10) s.alpha -= 0.1;
      break;
    case 1:
      s.alpha -= s.alphaStep;
      if (s.alpha < 0) s.alpha = 0;
      break;
    case 2:
      if (s.count < 0x32) s.alpha += 0.02;
      if (s.frames - 0x14 < s.count) s.alpha -= 0.05;
      break;
    case 4:
      if (s.count < 0x3c) s.alpha += 1 / 60;
      if (s.frames - 0x1e < s.count) s.alpha -= 1 / 30;
      break;
    case 5:
      if (s.count < 10) s.alpha += 0.1;
      if (s.frames - 10 < s.count) s.alpha -= 0.1;
      break;
    case 6:
      if (s.count < 10) s.alpha += 0.1;
      break;
    case 7:
      if (s.frames - 0x1e < s.count) s.alpha -= 1 / 30;
      break;
    default:
      break;
  }
  if (s.count > s.frames) {
    s.done = true;
    return false;
  }
  s.count += 1;
  return true;
}

/**
 * `GameOverLogoTask` — `FUN_00460CD0`, the task phase 2 allocates: a frame
 * counter (`+0x34`) that spawns the logo's sprites on seven frames and kills
 * itself on the 165th. Frame 0: the **GAME OVER** plate `0x43A`, fading in
 * over 50 frames (alpha mode 2, 130 frames); 120..140: five 20-frame flashes
 * of `0x43B..0x43D` around it; 145: the plate again, squashing (scale mode
 * 1) and fading (alpha mode 1) over 20. Returns false once it is gone.
 */
export function GameOverLogoTask(): boolean {
  const f = G.g_game_over_logo_frame;
  if (f === 0) ScreenSpriteAnimSpawn(0x43a, 320, 240, 1, 1, 0, 0x82, 0, 2);
  if (f === 0x78) ScreenSpriteAnimSpawn(0x43b, 340, 260, 1, 1, 1, 0x14, 0, 0);
  if (f === 0x7d) ScreenSpriteAnimSpawn(0x43c, 310, 250, 2, 1.5, 1, 0x14, 0, 0);
  if (f === 0x82) ScreenSpriteAnimSpawn(0x43d, 320, 230, 1, 1, 1, 0x14, 0, 0);
  if (f === 0x87) ScreenSpriteAnimSpawn(0x43b, 290, 210, 1, 1, 1, 0x14, 0, 0);
  if (f === 0x8c) ScreenSpriteAnimSpawn(0x43d, 350, 270, 1, 1, 1, 0x14, 0, 0);
  if (f === 0x91) ScreenSpriteAnimSpawn(0x43a, 320, 240, 1, 1, 1, 0x14, 1, 1);
  if (f === 0xa5) {
    G.g_game_over_logo_frame = -1;
    return false;
  }
  G.g_game_over_logo_frame = f + 1;
  return true;
}

/**
 * `[port-only]` -- phase 3's task list, walked in order: the logo task, then
 * every sprite task. A sprite the logo spawns this frame is appended and
 * reached by the same walk `[likely]`: the list is linked, and the walk reads
 * each node's next pointer after running it.
 */
function GameOverLogoTaskWalk(): void {
  G.g_screen_sprite_anims = G.g_screen_sprite_anims.filter((s) => !s.done);
  if (G.g_game_over_logo_frame >= 0) GameOverLogoTask();
  for (const s of G.g_screen_sprite_anims) ScreenSpriteAnimTick(s);
}

/**
 * `CreditsClear` — `FUN_00406FD0`. `CreditsSetCount(0)`, both counts 0, and
 * the tiers.
 */
export function CreditsClear(): void {
  G.g_free_play = 0;
  G.g_credits = [0, 0];
  CreditTiersUpdate();
  G.g_credits = [0, 0];
  CreditTiersUpdate();
}

/** `AppStateAdvanceByTable` — `FUN_0040E960`, for app state 7. */
export function AppStateAdvanceByTable(): void {
  RequestAppState(GAME_OVER_NEXT_APP_STATE);
}

/**
 * `GameOverRunPhase` — `FUN_00460960`. See the file comment for the six
 * phases. `f` is the player tasks' frame: phase 1's task list is the
 * fly-over camera (not ported), the two player tasks and
 * `SelectAttackablePlayer`.
 */
export function GameOverRunPhase(f: PlayerFrame, events?: Events): void {
  switch (G.g_nRunPhase) {
    case GameOverPhase.Arm:
      // Asset loads, the camera zeroed, the fly-over task list: drawing.
      for (let p = 0; p < 2; p++) {
        if (G.g_player_state[p] === PlayerState.Continue) {
          PlayerSetState(PlayerState.GameOver, 1, p);
        }
      }
      G.g_game_over_timer = FLY_OVER_FRAMES;
      G.g_screen_furniture_flags &= ~2;
      events?.emit("sound.play", { id: GAME_OVER_BGM });
      G.g_nRunPhase += 1;
      return;
    case GameOverPhase.FlyOver:
      PlayerTasksRun(f);
      // Original Mode copies the carried items out on frame 0xC6 and saves
      // them (`FUN_004011F0`); the port keeps no save.
      if (G.g_game_over_timer < FLY_OVER_SKIP_BELOW
          && (G.g_pad_state & GAME_OVER_SKIP_BITS) !== 0) {
        G.g_game_over_timer = 1;
      }
      G.g_game_over_timer -= 1;
      if (G.g_game_over_timer === 0) G.g_nRunPhase += 1;
      return;
    case GameOverPhase.ArmLogo:
      G.g_screen_sprite_anims = [];
      G.g_game_over_logo_frame = 0;
      G.g_game_over_timer = LOGO_FRAMES;
      G.g_nRunPhase += 1;
      return;
    case GameOverPhase.Logo:
      GameOverLogoTaskWalk();
      if (G.g_game_over_timer < LOGO_SKIP_BELOW
          && (G.g_pad_state & GAME_OVER_SKIP_BITS) !== 0) {
        G.g_game_over_timer = 1;
      }
      G.g_game_over_timer -= 1;
      if (G.g_game_over_timer === 0) {
        if (G.g_GameMode > GameMode.Original && G.g_GameMode < 4) {
          // Training and Boss go round again: players at 6 back to 0, and
          // the play screen. No shipped bundle is either mode.
          for (let p = 0; p < 2; p++) {
            if (G.g_player_state[p] === PlayerState.GameOver) {
              G.g_player_state[p] = PlayerState.EnterNewGame;
            }
          }
          RequestAppState(AppState.InPlay);
          return;
        }
        G.g_nRunPhase += 1;
      }
      return;
    case GameOverPhase.ArmRouteMap:
      // The route history and the map task list: drawing.
      G.g_screen_sprite_anims = [];
      G.g_game_over_route_done = 0;
      G.g_nRunPhase += 1;
      return;
    case GameOverPhase.RouteMap:
      if ((G.g_pad_state & GAME_OVER_SKIP_BITS) !== 0) {
        G.g_game_over_route_done = -1;
      } else if (G.g_game_over_route_done !== -1) {
        return;
      }
      CreditsClear();
      AppStateAdvanceByTable();
      return;
    default:
      return;
  }
}
