/**
 * The player's own body, as the game-over fly-over draws it.
 *
 * Each player has a skinned body actor in the exe: `PlayerBodiesCreate`
 * (`FUN_00416450`) allocates one per player into `0x009A5CD8 + p*0x130`
 * (`ActorAllocSub(0x13F4)`, so a sub-object of the task that made it and not a
 * task of its own) whenever a task list with the camera tasks in it is built.
 * In play the port does not draw it -- `game/player_shell.ts` says why -- and
 * the one place it does is the game-over screen:
 *
 * * `GameOverBuildFlyTasks` (`FUN_00460BB0`) runs the camera tasks, so the
 *   bodies are made afresh;
 * * `PlayerStateArmGameOver` (`FUN_00414420`), in app state 7, puts the body
 *   on motion `0x338`, places it with `GameOverPlaceBody` and installs
 *   `PlayerHookDrawBodyUntilMotionEnd` as the player's camera hook;
 * * `PlayerGameOverWait` (`FUN_004144C0`), in app state 7, runs that hook every
 *   frame the fly-over's task list is walked -- and only then, because the logo's
 *   list has no player tasks in it.
 *
 * What the renderer needs is the record below and nothing else: where the body
 * is, which clip, which cursor, and whether the hook drew it this frame.
 */
import { MotionFlag, MOTION_FLAGS_INIT } from "./actor";
import { G } from "./globals";
import { MatIdentity, MatrixRotateX, MatrixRotateY, MatrixRotateZ,
         MatrixTransformPoint, MatrixTranslate } from "./matrix";
import { PLAYER_BODY_AT } from "./player_body_data";
import { ActorModelScale, rootDelta } from "./root_motion";
import { T } from "./tables";
import { vec3, type Vec3 } from "./vec";

/** One player's body actor -- the fields of it the fly-over reads. */
export interface PlayerBody {
  /** `[port-only]` -- the address the bundle's row is known by. */
  at: number;
  /** `obj+0x1F4`. */
  charType: number;
  /** `obj+0x1B4` -- `model[8]`, what `ActorSetMotion` writes. */
  motion: number;
  /**
   * `obj+0x194` -- `model[0]`, the frame cursor the draw reads, in 60 Hz
   * ticks: `PlayerHookDrawBodyUntilMotionEnd` steps it and compares it with
   * `g_motion_play_length[motion] - 1`.
   */
  playTicks: number;
  /** `obj+0x40`..`+0x48`. */
  pos: Vec3;
  /** `obj+0x64`..`+0x6C`, BAMS. Nothing writes them after the allocation. */
  yaw: number;
  /** `model+0x64` -- `ActorBuildSkinnedModel` leaves 3. */
  motionFlags: number;
  /** `model+0x116C`, from the character type alone. */
  scale: number;
  /**
   * `[port-only]` -- the play cursor the last draw posed, so the next one
   * can take the root delta `SkeletonApplyRootMotion` (`FUN_00410C50`) takes
   * from inside the draw. -1: nothing drawn since `ActorSetMotion`.
   */
  lastFrame: number;
  /**
   * `[port-only]` -- the hook drew the body this frame. The engine's draw is
   * the hook's own `DrawSkinnedModelAndShadow` call; the port's is the
   * renderer's, which draws exactly the bodies this says were drawn.
   */
  drawn: number;
}

/** With one player the body falls from the path frame after this one. */
const ONE_PLAYER_FALL_AFTER = 0x3b;

/**
 * `PlayerBodiesCreate` — `FUN_00416450`. One body per player, on the start
 * motion `0x004EC8A4` names, at the allocation's zeroed pose.
 *
 * The type is `g_player_body_char_types[p]` (`0x00579F50`, `T.gameOver`) in
 * both modes: Original Mode reads a character byte at `0x009A2242 + p*0x14`
 * instead unless it equals `p`, and that byte's only writer,
 * `ResetOriginalModeLoadout` (`FUN_0048A0D0`), stores `p`. `[proved]` The hit slot
 * (`obj+0x3C = 0xE + p`) and the per-part draw callback at `obj+0x12EC`
 * (`FUN_00416570`, which widens two bones in Original Mode's big-head cheat)
 * are left out: nothing shoots the body, and the cheat is not in the port.
 */
export function PlayerBodiesCreate(): void {
  const go = T.gameOver;
  if (!go) {
    G.g_player_bodies = [];
    return;
  }
  G.g_player_bodies = PLAYER_BODY_AT.map((at, p) => {
    const ct = go.body_char_types[p];
    return {
      at, charType: ct, motion: go.body_start_motions[p], playTicks: 0,
      pos: vec3(), yaw: 0, motionFlags: MOTION_FLAGS_INIT,
      scale: ActorModelScale(ct), lastFrame: -1, drawn: 0,
    };
  });
}


/**
 * `[port-only]` in spelling: `ActorSetMotion` (`FUN_00411930`) on a body --
 * the clip, and the cursor back to 0. The port's `Actor` has its own, and a
 * body is not one.
 */
export function PlayerBodySetMotion(b: PlayerBody, motion: number): void {
  b.motion = motion;
  b.playTicks = 0;
  b.lastFrame = -1;
}

/**
 * `GameOverPlaceBody` — `FUN_00415A80`. The body's position is a table point
 * pushed through the gameplay eye's own matrix. `[proved]`:
 *
 * ```
 * 00415aa2  MatrixLoadIdentity()
 * 00415abb  MatrixTranslate(g_camera_eye_x, _y, _z)      ; 0x009C71E0..E8
 * 00415ac6  MatrixRotateZ([0x009c71f4])                  ; roll
 * 00415ad2  MatrixRotateY(g_camera_yaw_bams)             ; 0x009C71F0
 * 00415ade  MatrixRotateX(g_camera_pitch_bams)           ; 0x009C71EC
 * 00415b1d  MatrixTransformPoint((row.x, 0, row.z), &body+0x40)
 * ```
 *
 * On the game-over screen that matrix is the identity: `GameOverRunPhase`
 * zeroes the eye and all three angles in phase 0 (`0x00460A6E..AA0`), and the
 * only other writers are camera hooks the fly-over's scene state (0, 0) does
 * not install. So the point is the position -- here as in the engine, by the
 * same arithmetic.
 */
export function GameOverPlaceBody(player: number): void {
  const b = G.g_player_bodies[player];
  if (!b) return;
  const row = T.gameOver?.body_offsets[player - 2 + G.g_game_over_players * 2]
    ?? [0, 0];
  const m = MatIdentity();
  MatrixTranslate(m, G.g_camera_eye.x, G.g_camera_eye.y, G.g_camera_eye.z);
  MatrixRotateZ(m, G.g_camera_roll_bams);
  MatrixRotateY(m, G.g_camera_yaw_bams);
  MatrixRotateX(m, G.g_camera_pitch_bams);
  MatrixTransformPoint(m, { x: row[0], y: 0, z: row[1] }, b.pos);
}

/**
 * `PlayerHookDrawBodyUntilMotionEnd` — `FUN_004151D0`. In app state 7: draw
 * the body, and either hand the hook over to `PlayerHookSetCurActor` -- which
 * draws nothing, so the body is gone from the next frame on -- once the cursor
 * is on the clip's last frame, or step the cursor once the fly-over's path
 * frame has reached the body's cue.
 *
 * ```
 * DrawSkinnedModelAndShadow(body);         // push, walk, pop, shadow
 * if (cursor == g_motion_play_length[motion] - 1) { hook = SetCurActor; return; }
 * if (g_game_over_players == 2) { if (0x004EC8C4[p] <= g_cam_path_frame) cursor++; }
 * else if (0x3B < g_cam_path_frame) cursor++;
 * ```
 *
 * `DrawSkinnedModelAndShadow` (`FUN_00411090`) is `MatrixStackPush`,
 * `SkeletonDrawWalk`, `MatrixStackPop` -- and then `ActorDrawShadow`
 * (`FUN_0040A590`) on **`g_cur_actor`**, past the `MatrixStackPop` Ghidra
 * marks no-return (`L35`); this note said "no shadow" until that was read. So
 * the shadow drawn here is whatever actor `g_cur_actor` last named, not the
 * body's. `[proved]` for the call, `[open]` for which actor that is in app
 * state 7; the port draws no character shadow either way.
 */
export function PlayerHookDrawBodyUntilMotionEnd(player: number): boolean {
  const b = G.g_player_bodies[player];
  if (!b) return true;
  PlayerBodyDraw(b);
  const m = T.types[String(b.charType)]?.motions[String(b.motion)];
  const len = m ? (m.play ?? Math.max(1, m.frames * 2 - 2)) : 0;
  if (b.playTicks === len - 1) return false;
  if (G.g_game_over_players === 2) {
    if ((T.gameOver?.fall_frames[player] ?? 0) <= G.g_cam_path_frame) {
      b.playTicks += 1;
    }
  } else if (ONE_PLAYER_FALL_AFTER < G.g_cam_path_frame) {
    b.playTicks += 1;
  }
  return true;
}

/**
 * The draw's engine half: the root delta `SkeletonApplyRootMotion`
 * (`FUN_00410C50`) takes from inside `SkeletonDrawWalk`, then the flag the
 * renderer draws by. With `model+0x64` bit 1 up -- and
 * `ActorBuildSkinnedModel` leaves it up -- the clip's horizontal root moves
 * the body and the pose keeps only its height.
 */
function PlayerBodyDraw(b: PlayerBody): void {
  const m = T.types[String(b.charType)]?.motions[String(b.motion)];
  if (m && m.frames > 0) {
    // The play cursor, `counter % (play_length + 1)`: the body's counter
    // stops a frame short of the play length (`PlayerBodyAdvance`), so it is
    // the counter itself, and the root is sampled there -- between two
    // authored frames on an odd one.
    const play = m.play ?? Math.max(1, m.frames * 2 - 2);
    const f = b.playTicks % (play + 1);
    if ((b.motionFlags & MotionFlag.RootMotion) !== 0) {
      const d = rootDelta(m, play, b.lastFrame, f);
      if (d.x !== 0 || d.z !== 0) {
        const a = b.yaw * ((Math.PI * 2) / 65536);
        const s = Math.sin(a);
        const c = Math.cos(a);
        const dx = d.x * b.scale;
        const dz = d.z * b.scale;
        b.pos.x += dx * c + dz * s;
        b.pos.z += dz * c - dx * s;
      }
    }
    b.lastFrame = f;
  }
  b.drawn = 1;
}
