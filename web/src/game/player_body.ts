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
import { PLAYER_BODY_AT } from "./player_body_data";
import {
  ActorModelScale, ActorSeedRootBaseline, RootMotionStep,
} from "./root_motion";
import { T } from "./tables";
import { authoredFrameHeld } from "../core/play_cursor";
import { vec3, type Vec3 } from "./vec";
import type { BakedMotion } from "../bundle";

/** The clip-space delta `RootMotionStep` hands back, reused. */
const _step: Vec3 = { x: 0, y: 0, z: 0 };

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
   * `model+0x10` -- the authored frame the last draw posed, which
   * `SkeletonApplyRootMotion` (`FUN_00410C50`) compares with the next one's
   * to find a wrap. See `Actor.rootFrame`.
   */
  rootFrame: number;
  /**
   * `model+0x1160..0x1168` -- the root-motion baseline. See `Actor.rootBase`.
   */
  rootBase: Vec3;
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
    const b: PlayerBody = {
      at, charType: ct, motion: go.body_start_motions[p], playTicks: 0,
      pos: vec3(), yaw: 0, motionFlags: MOTION_FLAGS_INIT,
      scale: ActorModelScale(ct), rootFrame: 0, rootBase: vec3(), drawn: 0,
    };
    // `ActorBuildSkinnedModel` after the clip is written:
    // `SkeletonBuildAndPose` seeds the baseline from its frame 0.
    ActorSeedRootBaseline(b, BodyMotion(b));
    return b;
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
  if (b.motionFlags & MotionFlag.RootMotion) {
    ActorSeedRootBaseline(b, BodyMotion(b));
  } else {
    b.rootFrame = 0;
  }
}

/** `[port-only]` -- the body's clip, from its own character type's table. */
function BodyMotion(b: PlayerBody): BakedMotion | undefined {
  return T.types[String(b.charType)]?.motions[String(b.motion)];
}

/**
 * `GameOverPlaceBody` — `FUN_00415A80`. The body's position is a table point
 * pushed through the camera's own matrix -- `T(g_camera_eye) Rz Ry Rx` -- and
 * on the game-over screen that matrix is the identity: `GameOverRunPhase`
 * zeroes the eye and all three angles in phase 0, and the only other writers
 * are camera hooks the fly-over's scene state (0, 0) does not install.
 * `[proved]` So the point is the position.
 */
export function GameOverPlaceBody(player: number): void {
  const b = G.g_player_bodies[player];
  if (!b) return;
  const row = T.gameOver?.body_offsets[player - 2 + G.g_game_over_players * 2]
    ?? [0, 0];
  b.pos.x = row[0];
  b.pos.y = 0;
  b.pos.z = row[1];
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
  const m = BodyMotion(b);
  if (m && m.frames > 0) {
    const f = authoredFrameHeld(b.playTicks, m.fps, m.frames);
    const d = _step;
    if (RootMotionStep(b.rootBase, b.rootFrame, m,
                       m.play ?? Math.max(1, m.frames * 2 - 2), f, false,
                       (b.motionFlags & MotionFlag.RootMotion) !== 0, d)) {
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
    b.rootFrame = f;
  }
  b.drawn = 1;
}
