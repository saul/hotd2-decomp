/**
 * The stage-4 boss's per-frame helpers -- the calls `Boss4Update` makes
 * around its state dispatch: the footfalls, the draw half (the carrier ride,
 * the blade, the two props he carries), the rank, and the chainsaw.
 */
import type { Events } from "../../core/events";
import type { Actor } from "../actor";
import { ActorByAt, G } from "../globals";
import type { GameHost } from "../host";
import { CarrierPublishWorld } from "../carrier";
import {
  MatCopy, MatIdentity, MatrixRotateX, MatrixRotateY, MatrixRotateZ,
  MatrixTranslate, type Mat,
} from "../matrix";
import { vec3 } from "../vec";
import {
  BOSS4_BLADE_BONE, BOSS4_FOOT_A, BOSS4_FOOT_B, Boss4Flag, Boss4Sound,
  Boss4Tables,
} from "./state";
import type { Boss4Block as Blk } from "./state";
import { BOSS4_BLADE_FIRST, BOSS4_BLADE_LAST, BOSS4_PROP_SLOT } from "./slots";

// -- Boss4FootfallShake ---------------------------------------------------

/** `FCOMP [0x005308DC]` -- a raised foot lands below 45.0. */
const FOOT_LAND_Y = 45.0;
/** `FCOMP [0x00570A4C]` -- a planted foot is raised above 47.0. */
const FOOT_RAISE_Y = 47.0;
/** `MOV ESI, 0x5` -- a footfall's shake. */
const FOOTFALL_SHAKE = 5;
/** `ADD ESI, 0xA` within `[0x0055D2AC]` 50.0 of the eye. */
const FOOTFALL_NEAR = 50.0;
const FOOTFALL_NEAR_ADD = 0xa;
/** `[0x00570A48]` 150.0 and `[0x0055D230]` 0.1 -- the falloff. */
const FOOTFALL_FAR = 150.0;
const FOOTFALL_FALLOFF = Math.fround(0.1);

const _foot = vec3();

/**
 * `Boss4FootfallShake` — `FUN_00492460`. While state flag `0x10` is up, each
 * foot (bones 15 and 12, `char+0x910` and `char+0x760`) is watched with
 * hysteresis -- raised above 47, landed below 45 -- and a landing shakes the
 * screen, harder the nearer the camera:
 *
 * ```
 * shake = 0
 * foot A: raised ? (y < 45 -> raised = 0, shake = 5) : (y > 47 -> raised = 1)
 * foot B: the same with bit 0x200
 * if (shake) {
 *     d = |pos - eye| in x/z
 *     d <= 50 ? shake += 10 : d < 150 ? shake = ftol((150 - d) * 0.1 + shake) : shake
 *     if (g_screen_shake_frames < shake) g_screen_shake_frames = shake
 *     PlaySoundId(0x151BA9)      STAGE4_SE\BOS_WALK1_44.wav
 * }
 * ```
 *
 * The feet are the world translations of the two bones' records, which is what
 * `GameHost.boneWorld` answers; a headless host answers nothing and the feet
 * are left as they were.
 */
export function Boss4FootfallShake(obj: Actor, b: Blk,
                                   host: GameHost, events?: Events): void {
  if (!(b.flags & Boss4Flag.Footfalls)) return;
  let shake = 0;
  if (host.boneWorld(obj.at, BOSS4_FOOT_A, _foot)) {
    if (b.flags & Boss4Flag.FootARaised) {
      if (_foot.y < FOOT_LAND_Y) {
        b.flags &= ~Boss4Flag.FootARaised;
        shake = FOOTFALL_SHAKE;
      }
    } else if (!(_foot.y <= FOOT_RAISE_Y)) {
      b.flags |= Boss4Flag.FootARaised;
    }
  }
  if (host.boneWorld(obj.at, BOSS4_FOOT_B, _foot)) {
    if (b.flags & Boss4Flag.FootBRaised) {
      if (_foot.y < FOOT_LAND_Y) {
        b.flags &= ~Boss4Flag.FootBRaised;
        shake = FOOTFALL_SHAKE;
      }
    } else if (!(_foot.y <= FOOT_RAISE_Y)) {
      b.flags |= Boss4Flag.FootBRaised;
    }
  }
  if (shake === 0) return;
  // `g_camera_eye_z`/`_x` by address (`0x00492597`, `0x0049259F`) -- the
  // gameplay eye.
  const eye = G.g_camera_eye;
  const dz = obj.pos.z - eye.z;
  const dx = obj.pos.x - eye.x;
  const d = Math.fround(Math.sqrt(dx * dx + dz * dz));
  if (d <= FOOTFALL_NEAR) {
    shake += FOOTFALL_NEAR_ADD;
  } else if (d < FOOTFALL_FAR) {
    shake = Math.trunc((FOOTFALL_FAR - d) * FOOTFALL_FALLOFF + shake);
  }
  if (G.g_screen_shake_frames < shake) G.g_screen_shake_frames = shake;
  events?.emit("sound.play", { id: Boss4Sound.Footfall });
}

// -- Boss4AdvanceMotionAndDrawHeldProps -----------------------------------

/**
 * `Boss4AdvanceMotionAndDrawHeldProps` — `FUN_00492620`. The draw half of the
 * boss's frame, and what the port keeps of it:
 *
 * ```
 * LightsUseSecondarySet()
 * if (flags & 1) { Push; Translate(carrier+0x40); RotX(c+0x64); RotZ(c+0x6C); RotY(c+0x68);
 *                  DrawSkinnedModelAndShadow(char, obj+0x40, char+0x78); Pop }
 * else DrawSkinnedModelAndShadow(char, obj+0x40, char+0x78)
 * if (!(obj+0x34 & 0x4000)) char+0x00++                  -- the frame counter
 * if (flags & 4) { char+0x348++; if > 0x447 -> 0x444 }   -- bone 5's model
 * Push; for each g_boss4_held_props record i not yet thrown:
 *     SetTop(char + rec.bone*0x90 + 0xA0); Translate(rec.offset)
 *     RotZ(rec.rz); RotY(rec.ry); RotX(rec.rx); AssetDrawSlot(0x396)
 * Pop; LightsRestoreScene()
 * ```
 *
 * * The light set is `ActorDrawsUnderSecondaryLights`' (`game/light_sets.ts`).
 * * The frame counter is `ActorAdvanceMotion`'s (`game/motion.ts`), which the
 *   director runs for every actor and which honours `PoseFrozen`. The root
 *   motion happens inside the draw (`SkeletonApplyRootMotion`), and the port
 *   does it in the same place.
 * * **The ride.** With state flag 1 up the whole draw is under the carrier's
 *   `T · RotX · RotZ · RotY`: the boss's own position is in the carrier's
 *   frame. The port's riders publish the composed world point for the
 *   renderer (`CarrierPublishWorld`, `game/carrier.ts`); the boss does the
 *   same while the bit is up.
 * * **The two props** are drawn on their bones every frame until thrown. The
 *   matrix is built here on the bone's world matrix -- the product
 *   `g_camera_blocks` · record the engine's view-space record is -- and
 *   `render/effects.ts` draws slot 0x396 with it, as it draws the carried
 *   props.
 */
export function Boss4AdvanceMotionAndDrawHeldProps(obj: Actor, b: Blk,
                                                   host: GameHost): void {
  if (b.flags & Boss4Flag.OnCarrier) {
    const carrier = ActorByAt(b.carrierAt);
    obj.carrierAt = CarrierPublishWorld(obj, carrier) ? b.carrierAt : -1;
  } else {
    obj.carrierAt = -1;
  }
  if (b.flags & Boss4Flag.CycleBlade) {
    let slot = (obj.boneSlot[String(BOSS4_BLADE_BONE)] ?? BOSS4_BLADE_FIRST) + 1;
    if (slot > BOSS4_BLADE_LAST) slot = BOSS4_BLADE_FIRST;
    obj.boneSlot[String(BOSS4_BLADE_BONE)] = slot;
    host.setBoneSlot(obj.at, BOSS4_BLADE_BONE, slot);
  }
  const recs = Boss4Tables().held_props;
  b.propDraws = [];
  for (let i = 0; i < recs.length; i++) {
    if (b.propsUsed & (1 << i)) continue;
    const r = recs[i];
    const world: number[] = new Array(16).fill(0);
    if (!host.boneMatrix?.(obj.at, r.bone, world)) continue;
    const m: Mat = MatCopy(MatIdentity(), world);
    MatrixTranslate(m, r.offset[0], r.offset[1], r.offset[2]);
    MatrixRotateZ(m, r.rot[2]);
    MatrixRotateY(m, r.rot[1]);
    MatrixRotateX(m, r.rot[0]);
    b.propDraws.push({ slot: BOSS4_PROP_SLOT, m });
  }
}

// -- Boss4AdjustRank ------------------------------------------------------

/** `CMP byte ptr [EAX + 0xC], 2` / `3` -- head hits per rank step. */
const RANK_UP_HITS_ONE = 2;
const RANK_UP_HITS_TWO = 3;
/** `SUB byte ptr [EAX + 0xB], 3` -- a life lost. */
const RANK_DOWN_ON_LIFE = 3;
/** The rank's clamp -- `g_boss4_approach_picks` has sixteen rows. */
const RANK_MAX = 15;

/**
 * `Boss4AdjustRank` — `FUN_004934D0`. The boss's own adaptive rank: two head
 * hits (three with two players) push it up one, a life lost pulls it down
 * three, and it stays in 0..15. The lives it compares are the snapshot
 * `Boss4Init` took, refreshed whenever they differ.
 *
 * ```
 * one player:  if (hits >= 2) { rank++; hits = 0 }
 *              p = g_active_player
 *              if ((s8)lives[p] != g_player_lives[p]) {
 *                  if ((s8)lives[p] > g_player_lives[p]) { rank -= 3; hits = 0 }
 *                  lives[p] = (u8)g_player_lives[p] }
 * two:         if (hits >= 3) { rank++; hits = 0 }   and the lives test for both
 * rank = clamp(rank, 0, 15)
 * ```
 */
export function Boss4AdjustRank(b: Blk): void {
  const livesTest = (p: number): void => {
    const now = G.g_player_lives[p] ?? 0;
    const was = (b.lives[p] << 24) >> 24;
    if (was === now) return;
    if (was > now) {
      b.rank -= RANK_DOWN_ON_LIFE;
      b.headHits = 0;
    }
    b.lives[p] = now & 0xff;
  };
  if (G.g_players_in_play === 1) {
    if (b.headHits >= RANK_UP_HITS_ONE) { b.rank += 1; b.headHits = 0; }
    const p = G.g_active_player;
    if (p === 0 || p === 1) livesTest(p);
  } else {
    if (b.headHits >= RANK_UP_HITS_TWO) { b.rank += 1; b.headHits = 0; }
    livesTest(0);
    livesTest(1);
  }
  if (b.rank < 0) b.rank = 0;
  if (b.rank > RANK_MAX) b.rank = RANK_MAX;
}

// -- the chainsaw ---------------------------------------------------------

/**
 * `Boss4ChainsawOn` — `FUN_00493870`. Unless the loop is running, raise
 * `0x410` -- the loop and the footfalls -- and start the sound.
 */
export function Boss4ChainsawOn(b: Blk, events?: Events): void {
  if (b.flags & Boss4Flag.Chainsaw) return;
  b.flags |= Boss4Flag.Chainsaw | Boss4Flag.Footfalls;
  events?.emit("sound.play", { id: Boss4Sound.ChainsawOn });
}

/**
 * `Boss4ChainsawOff` — `FUN_00493890`. If the loop is running, drop `0x410`
 * and play the stop.
 */
export function Boss4ChainsawOff(b: Blk, events?: Events): void {
  if (!(b.flags & Boss4Flag.Chainsaw)) return;
  b.flags &= ~(Boss4Flag.Chainsaw | Boss4Flag.Footfalls);
  events?.emit("sound.play", { id: Boss4Sound.ChainsawOff });
}

/** `SUB EAX, 0xB9` / `SUB EAX, 0x8` -- the two arenas' camera paths. */
const PATH_ARENA_1 = 0xb9;
const PATH_ARENA_2 = 0xc1;

/**
 * The frames, on each path, `g_cam_path_frame` has to **equal** -- the
 * compare chains at `0x00493649` and `0x004935F1` and their byte tables
 * `0x00493798` (from 1075) and `0x004936AC` (from 900).
 */
const CHAINSAW_CUES: Readonly<Record<number,
  { off: readonly number[]; on: readonly number[] }>> = {
  [PATH_ARENA_1]: { off: [395, 785, 930, 1075, 1235],
                    on: [460, 810, 960, 1110, 1280] },
  [PATH_ARENA_2]: { off: [240, 500, 700, 900, 1070],
                    on: [310, 520, 760, 960, 1120] },
};

/**
 * `Boss4ChainsawCueByCameraFrame` — `FUN_004935E0`. On paths 185 and 193
 * only, at exact camera frames, the chainsaw goes off or on -- the pauses
 * between phases where the camera is flying and the boss is walking to his
 * next spot.
 */
export function Boss4ChainsawCueByCameraFrame(b: Blk, events?: Events): void {
  const cues = CHAINSAW_CUES[G.g_active_cam_path];
  if (!cues) return;
  const f = G.g_cam_path_frame;
  if (cues.on.includes(f)) Boss4ChainsawOn(b, events);
  else if (cues.off.includes(f)) Boss4ChainsawOff(b, events);
}
