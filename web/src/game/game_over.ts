/**
 * The game-over screen: app state 7, `GameOverRunPhase` (`FUN_00460960`).
 *
 * The run asks for it when nobody is left in play and no continue is taken
 * (`RunPhaseContinueCountdown`, `RunPhaseNoContinueWait`); `CommitAppState`
 * applies it and leaves run phase 0. Six phases, all `[proved]`:
 *
 * | phase | what |
 * |---:|---|
 * | 0 | **releases the stage** and loads the screen's own assets, zeroes the camera, builds the fly-over's task list -- the fly-over camera, the camera tasks (which make the players' bodies), the player tasks, `SelectAttackablePlayer` -- puts every player still at 4 into 6, **200** frames on the timer, drops furniture bit 1, and starts BGM 9, `OVR_AR.WAV`, unlooped |
 * | 1 | the fly-over: camera path `0x1F` from frame 10, one frame a tick, over the players' bodies falling; the trigger cuts it short once the timer is under `0xA5`. In Original Mode the carried items are copied out on its 0xC6th frame and saved |
 * | 2 | a new task list: the camera reset and the **GAME OVER** logo task; **180** frames |
 * | 3 | the logo (below); the trigger cuts it short under `0xAF`. Then Training and Boss restart the stage (players at 6 go to 0, app state 6); everything else goes on |
 * | 4 | the route map: the route this run took, drawn over a scrolling map, with the players' characters |
 * | 5 | waits for the trigger (or the map to say it is done, `0x007DCCE4 == -1`), then clears the credits and asks for the next screen, `g_app_state_next_table[caption][7]` = **3** |
 *
 * ## The fly-over is not the stage
 *
 * Phase 0 opens as `LoadSceneAndReset` does -- `FUN_004A7310`, then
 * `FUN_0041D510`, whose callees include `CamSlotsReset` (every cam file out)
 * and `FUN_00418690` (every pol slot back to the resident common set) -- and
 * then queues its own: pol file `0x4D`, `gameover_player.bin` (in Original
 * Mode `0xBE + p`, `player1.bin`/`player2.bin`: the character byte at
 * `0x009A2242 + p*0x14` is only ever the player index), cam file 5,
 * `cp_gmovr.bin` (`AssetQueueLoadCamFile`), motion banks `0x25..0x27`,
 * texbank `0x155`, and outside Training and Boss texbank `0x14F` and pol file
 * `0x4E`, `gameover_route.bin`. The task list it builds (`TaskListBuild`)
 * replaces the scene's, so no enemy runs or draws. What is on screen is the
 * players' bodies (`game/player_body.ts`): `PlayerStateArmGameOver`
 * (`FUN_00414420`), in app state 7, puts a body on motion `0x338` and
 * installs `PlayerHookDrawBodyUntilMotionEnd` (`FUN_004151D0`), which draws
 * it and steps the motion once `g_cam_path_frame` passes `0x3B` (one player)
 * or `0x004EC8C4[player]` (two) -- and stops drawing it on the clip's last
 * frame. The camera is `GameOverCameraFlyTick` on global path `0x1F`, the one
 * path in `cp_gmovr.bin`, whose keys start at frame 10 -- the frame
 * `GameOverSpawnCameraFly` starts it on -- and run 210 frames, more than
 * phase 1's 200 (measured on the exported path).
 *
 * Every player at 6 falls on `0x338`, whichever way they got there: the
 * list's `PlayerTasksCreate` puts each player's task back to its state's
 * handler, so a player whose own continue countdown already put them at 6 in
 * play is armed again, in app state 7.
 *
 * ## What the port runs, and what it draws
 *
 * All six phases, the fly-over (the stage released -- `g_stage_unloaded`,
 * which `render/game_over_scene.ts` reads -- the camera on `cp_gmovr`'s path,
 * the bodies made, armed, placed, stepped and dropped), the logo
 * (`ScreenSpriteAnimTick` records drawn through `ScreenSpriteDraw`, the
 * bundle's `scr_gameover.bin` images) and the route map (`game/route_map.ts`:
 * the history the `checkpoint` opcode records, the walk, the tiles through
 * `DrawScreenSprite`, the figures, their discs and the footprints). Every
 * screen sprite goes through `G.g_screen_sprite_draws`, like the HUD's.
 *
 * `[diverges]` Two small ones, both drawing. The route figures' draw takes no
 * horizontal root delta: the engine's `SkeletonApplyRootMotion` moves a figure
 * by one frame's delta inside its draw, and the task puts it back on its
 * cursor point before the next -- a fraction of a unit, re-seated every frame.
 * And the old actor pool is not emptied at phase 0: the engine's arena reset
 * frees it, the port leaves it be, and with `GameUpdate` running only
 * `GameOverRunPhase` nothing in it runs or is drawn.
 */
import type { Events } from "../core/events";
import { RequestAppState } from "./app_state";
import { CreditTiersUpdate } from "./credits";
import { GameMode } from "./game_mode";
import { AppState, G } from "./globals";
import { PlayerSetState, PlayerTasksCreate, PlayerTasksRun,
         type PlayerFrame }
  from "./player_shell";
import { PlayerState } from "./player_state";
import { PlayerBodiesCreate } from "./player_body";
import { ProfileSaveAndApply } from "./profile";
import { GameOverRouteMapArm, GameOverRouteMapWait } from "./route_map";
import { ScreenSpriteDraw } from "./screen_sprite";
import { GAME_OVER_CAM_PATH } from "./player_body_data";
import { CameraBlocksReset } from "./camera/actions";
import { CamBlockSetAnglesFromLookAt, CamEvalPath7, CameraPoseBlock }
  from "./camera/path";
import { UpdateSceneViewAndLight } from "./camera/view";

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
/** `CMP EAX, 0xC6` at `0x00460B43`: the fly-over frame Original Mode saves on. */
const GAME_OVER_SAVE_FRAME = 0xc6;
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
 * sprite drawn every frame by `ScreenSpriteDraw` (`FUN_00499F00`), centred on
 * its (x, y), and animated by `ScreenSpriteAnimTick` until its count runs out.
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
 * `ScreenSpriteAnimTick` — `FUN_00499CE0`. Draw (`ScreenSpriteDraw`, at
 * depth 1.0), then the scale mode, then the alpha mode and the end test, then
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
  // `ScreenSpriteDraw(id, x, y, 1.0, sx, sy, alpha)` -- the draw comes first,
  // so a record's values are drawn before this frame's step changes them.
  ScreenSpriteDraw(s.id, s.x, s.y, 1, s.sx, s.sy, s.alpha);
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

/** `GameOverSpawnCameraFly` starts the path here, not at its own start. */
const FLY_START_FRAME = 10;

export { CameraBlocksReset };

/**
 * `GameOverCameraFlyTick` — `FUN_00460E60`:
 *
 * ```c
 * g_cam_path_frame = task+0x50;
 * CamEvalPath7(0x1F, (float)g_cam_path_frame, &block.eye, &block.target, ...);
 * task+0x50 += 1;
 * CamBlockSetAnglesFromLookAt(&block, &block.target, 0);
 * UpdateSceneViewAndLight();
 * ```
 *
 * Whatever the path's roll channel says, the fly-over is level. `[proved]`
 * The path is the stage bundle's `cp_gmovr` slot, read through
 * `CamEvalPath7` like every other.
 */
export function GameOverCameraFlyTick(): void {
  G.g_cam_path_frame = G.g_game_over_fly_frame;
  CamEvalPath7(GAME_OVER_CAM_PATH, G.g_cam_path_frame, G.g_camera_block_eye,
               G.g_camera_block_target);
  G.g_game_over_fly_frame += 1;
  CamBlockSetAnglesFromLookAt(CameraPoseBlock.Camera, G.g_camera_block_target,
                              0);
  UpdateSceneViewAndLight();
}

/**
 * `GameOverSpawnCameraFly` — `FUN_00460EC0`. The fly-over's camera task:
 * `CameraBlocksReset`, the counter at 10, and its first tick at once.
 */
export function GameOverSpawnCameraFly(): void {
  CameraBlocksReset();
  G.g_game_over_fly_frame = FLY_START_FRAME;
  G.g_cam_path_frame = FLY_START_FRAME;
  GameOverCameraFlyTick();
}

/**
 * `GameOverBuildFlyTasks` — `FUN_00460BB0`: the fly-over's task list, built
 * by `TaskListBuild` in phase 0. `GameOverSpawnCameraFly`; the camera tasks
 * (`FUN_00414F20`), whose `CameraUpdateTick` runs the no-op hook scene state
 * (0, 0) installed and whose `PlayerBodiesCreate` makes the bodies;
 * `PlayerTasksCreate`, which puts each player's task back to its state's
 * handler; and `SpawnAttackablePlayerTask`, whose screen shake has nothing to
 * shake.
 */
export function GameOverBuildFlyTasks(): void {
  GameOverSpawnCameraFly();
  PlayerBodiesCreate();
  // `PlayerTasksCreate`: every player's task is its state's handler again --
  // so a player already at 6 is armed afresh, in app state 7, onto the fall.
  PlayerTasksCreate();
}

/**
 * `GameOverResetCamera` — `FUN_00460EF0`, the logo list's first task:
 * `CameraBlocksReset` and `UpdateSceneViewAndLight`. With the block at the
 * origin, its angles zero and no stage resident, the logo sits on black.
 */
export function GameOverResetCamera(): void {
  CameraBlocksReset();
  UpdateSceneViewAndLight();
}

/**
 * `[port-only]` -- a task list replaced. The bodies are sub-objects of the
 * fly-over's tasks: the logo's list has no player tasks, so nothing draws
 * them again.
 */
function GameOverBodiesUndrawn(): void {
  for (const b of G.g_player_bodies) b.drawn = 0;
}

/**
 * `GameOverRunPhase` — `FUN_00460960`. See the file comment for the six
 * phases. `f` is the player tasks' frame: phase 1's task list is the
 * fly-over camera (not ported), the two player tasks and
 * `SelectAttackablePlayer`.
 */
export function GameOverRunPhase(f: PlayerFrame, events?: Events): void {
  // `[port-only]` -- the frame's screen sprites start empty: the engine draws
  // immediate-mode, and this screen's task lists are what draw them.
  G.g_screen_sprite_draws = [];
  G.g_view_slot_draws = [];
  G.g_world_slot_draws = [];
  switch (G.g_nRunPhase) {
    case GameOverPhase.Arm:
      // `FUN_004A7310` and `FUN_0041D510`: the stage is released -- every pol
      // slot back to the resident set, every cam file out. Then the screen's
      // own assets are queued; the port's bundle carries them already.
      G.g_stage_unloaded = 1;
      // `g_camera_eye_x/y/z` and the three angles (`0x009C71E0`..`F4`), each
      // stored 0 (`0x00460A6E`..`0x00460AA0`): they are what
      // `GameOverPlaceBody` pushes the body's table point through, and zero
      // makes that the identity.
      G.g_camera_eye.x = 0;
      G.g_camera_eye.y = 0;
      G.g_camera_eye.z = 0;
      G.g_camera_pitch_bams = 0;
      G.g_camera_yaw_bams = 0;
      G.g_camera_roll_bams = 0;
      GameOverBuildFlyTasks();
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
      // The fly-over's task list, walked: the camera task first, then the
      // players, whose hook draws the bodies.
      GameOverBodiesUndrawn();
      GameOverCameraFlyTick();
      PlayerTasksRun(f);
      // Original Mode copies the items it has counted into the profile on
      // frame 0xC6 and saves it (`ProfileSaveAndApply`, `FUN_004011F0`):
      // `REP MOVSD` from `0x009C90C0` to `0x009C9F3D` at `0x00460B64`.
      if (G.g_game_over_timer === GAME_OVER_SAVE_FRAME
          && G.g_GameMode === GameMode.Original) {
        G.g_profile_original_items = [...G.g_original_items_taken];
        ProfileSaveAndApply(events);
      }
      if (G.g_game_over_timer < FLY_OVER_SKIP_BELOW
          && (G.g_pad_state & GAME_OVER_SKIP_BITS) !== 0) {
        G.g_game_over_timer = 1;
      }
      G.g_game_over_timer -= 1;
      if (G.g_game_over_timer === 0) G.g_nRunPhase += 1;
      return;
    case GameOverPhase.ArmLogo:
      // `TaskListBuild(GameOverBuildLogoTasks)`: `GameOverResetCamera` runs
      // as it is allocated, then the logo task.
      GameOverBodiesUndrawn();
      GameOverResetCamera();
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
      // The logo's list is replaced by the route map's.
      G.g_screen_sprite_anims = [];
      GameOverRouteMapArm(f);
      return;
    case GameOverPhase.RouteMap:
      if (!GameOverRouteMapWait(f,
                                (G.g_pad_state & GAME_OVER_SKIP_BITS) !== 0)) {
        return;
      }
      CreditsClear();
      AppStateAdvanceByTable();
      return;
    default:
      return;
  }
}
