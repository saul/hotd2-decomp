/**
 * Class 0x22's entrances — the stage-1 cameo, the ride-in to the stage-1
 * fight, the descent into stage 5's, and the attract loop's pose.
 *
 * Every one keys itself to the camera, not to a clock of its own: the
 * cameo and the ride-in ride `op_st1` paths `0x100`..`0x103` at
 * `g_cam_path_frame`, and hand over on exact camera frames. The ride-in
 * raises `g_script_flags[2]` on the frame the camera reaches the end of
 * `cp_st1` path `0x2F`, which is what starts the name banner
 * (`boss_banner.ts`); both fighting entrances then wait out a fixed count --
 * 300 frames in stage 1, the banner's own length, and 840 in stage 5 -- and
 * join the counters and spawn the health bar on the same frame.
 */
import type { JudgmentActor } from "../actor";
import { BossHpBarSpawn } from "../boss_hp_bar";
import { ActorSetMotion, ActorSetMotionBlended }
  from "../class30/motion_cue";
import { DescriptorFromPlacement } from "../descriptor";
import { ActorDespawn } from "../despawn";
import { GameMode } from "../game_mode";
import { ActorByAt, G } from "../globals";
import { ActorReleaseHitSlot } from "../hit_slots";
import {
  MatIdentity, MatrixRotateY, MatrixTransformPoint, MatrixTranslate,
} from "../matrix";
import { ActorAdvanceMotion } from "../motion";
import type { ClassFrame } from "../registry";
import { ActorSpawn } from "../spawn";
import { SpawnClass } from "../spawn_class";
import { MotionPlayLength, T } from "../tables";
import { LerpWeighted } from "../vec";
import { Class22DrawAndPoseSubActor } from "./draw";
import { SND_FLAP } from "./fight";
import {
  Class22EvalObjectPathOffset, Class22FaceCamera, Class22PlaceOnObjectPath,
} from "./paths";
import {
  CAM_PATH_LENGTH, CUTSCENE_FLAP_FRAME, Class22Clip, RIDE_IN_GLIDE_FRAME,
  RIDE_IN_NODE2_OFF_FRAME, RIDE_IN_NODE2_ON_FRAME, RIDE_LEAVE_GLIDE_FRAME,
} from "./records";
import { Class22PlaySound, JudgmentReleaseEnemySlot } from "./shot";
import type { Class22Descriptor } from "./state";
import { BACK_OFF_DISTANCE } from "../class23/records";

/** `g_script_flags[0xF8]` — the chapter card's; the cameo leaves on it. */
const CHAPTER_CARD_FLAG = 0xf8;
/** `g_script_flags[2]` — `MOV byte ptr [0x009C7202], 1`, the banner's start. */
export const CLASS22_BANNER_FLAG = 2;
/** `g_screen_furniture_flags` bit `0x20` — the chapter card is showing. */
const FURNITURE_CHAPTER_CARD = 0x20;

/** The cameo's perch: `(-406.0, 152.5, 142.4)`, yaw `0x717F`. */
const CAMEO_POS = { x: -406.0, y: 152.5, z: Math.fround(142.4) };
const CAMEO_YAW = 0x717f;
/** `[0x00570488]` 70.0 — the camera frame the cameo takes off on. */
const CAMEO_TAKE_OFF_FRAME = BACK_OFF_DISTANCE;
/** `PlaySoundId(0x004517A9)` — `COMMON2\HABATAKI2_16`. */
const SND_FLAP2 = 0x4517a9;
/** `obj+0x1350` of the sub-actor, seated 2 by the cameo and 1 when it leaves. */
const CAMEO_WINGS_FOLDED = 2;
const CAMEO_WINGS_FLYING = 1;

/** The cameo's and ride-and-leave's `op_st1` paths. */
const PATH_CAMEO = 0x100;
const PATH_LEAVE_A = 0x101;
const PATH_LEAVE_B = 0x102;
const PATH_RIDE_IN = 0x103;
const PATH_DESCENT = 0x17f;
/** `cp_st1` paths `0x21` and `0x22`, the two `RideAndLeave` rides on. */
const CAM_LEAVE_A = 0x21;
const CAM_LEAVE_B = 0x22;
/** Ride-and-leave's cues on camera path `0x21` (280.0, `[0x005691CC]`) and `0x22` (180.0 `[0x00570A5C]`, 240.0 `[0x004C49C8]`). */
const LEAVE_A_SWOOP_FRAME = 280;
const LEAVE_B_FLAP_FRAME = 180;
const LEAVE_B_TURN_FRAME = 240;
/** `CMP [+0x19C], 99` and `CMP [+0x19C], 0x75` — the swoop's and the turn's last cursor. */
const SWOOP_LAST_CURSOR = 99;
const TURN_LAST_CURSOR = 0x75;

/** Where the ride-in and Boss Mode seat the flier: `(-1054.0, 30.0, -479.1)`, yaw `0xC6DD`. */
const FIGHT_START = { x: -1054.0, y: 30.0, z: Math.fround(-479.1) };
const FIGHT_START_YAW = 0xc6dd;
/** `BossHpBarSpawn(320.0, 35.0)` — `PUSH 0x420C0000; PUSH 0x43A00000`. */
const HP_BAR_X = 320;
const HP_BAR_Y = 35;

/** The descent's node-2 and clip cues, on its own frame counter. */
const DESCENT_JOIN_FRAME = 0x348;

/**
 * The frame cues the cutscenes test are `(float)g_cam_path_frame == c` --
 * `FILD; FCOMP` against a float, an exact compare of an integer.
 */
function AtCamFrame(frame: number): boolean {
  return G.g_cam_path_frame === frame;
}

/**
 * `SpawnFromDescriptor` (`FUN_00408A20`) on the nested descriptor at
 * `tail+0x10` -- the companion -- from inside the flier's entrance, which is
 * where the engine calls it (`0x0049B6FA`, `0x0049CE42`). Returns the made
 * actor, or the one already in the pool.
 *
 * The descriptor's own fields go on before `Class23Init` runs, as
 * `SpawnFromDescriptor` puts them on: the flags word, the `+0x20` word, the
 * position and angles, and `+0x22` into both hit-point words. The bundle
 * carries the nested descriptor as a placement at its own evt offset,
 * `parent_at` this flier and `synthetic` -- see `CharacterPlacement`.
 */
export function Class22SpawnCompanion(d: Class22Descriptor,
                                      f: ClassFrame): number {
  const at = d.companion_at;
  if (at === null || at === undefined) return -1;
  const existing = ActorByAt(at);
  if (existing && !existing.despawned) return at;
  const p = (T.chars?.placements ?? []).find((x) => x.at === at);
  if (!p) return -1;
  const type = T.types[String(p.char_type)];
  const c23 = p.class23;
  ActorSpawn(at, SpawnClass.JudgmentCompanion, type?.type ?? p.char_type,
             type?.name ?? `spawn ${at}`,
             { ...DescriptorFromPlacement(p),
               hp: p.hp, maxHp: p.hp,
               pos: { x: c23?.pos?.[0] ?? 0, y: c23?.pos?.[1] ?? 0,
                      z: c23?.pos?.[2] ?? 0 },
               pitch: c23?.angles?.[0] ?? 0,
               yaw: c23?.angles?.[1] ?? p.yaw ?? 0,
               roll: c23?.angles?.[2] ?? 0,
               visible: true },
             f.rng, f.events);
  return at;
}

/**
 * The cross-link the entrances make on the line after the spawn:
 * `comp+0x1394 = obj; obj+0x1394 = comp`.
 */
function Class22LinkCompanion(obj: JudgmentActor, compAt: number): void {
  const comp = ActorByAt(compAt);
  obj.judgment.companionAt = compAt;
  if (comp && comp.cls === SpawnClass.JudgmentCompanion) {
    comp.companion.companionAt = obj.at;
  }
}

/** The tail every entrance ends in: draw, then `obj+0x194++`. */
function DrawAndStep(obj: JudgmentActor, f: ClassFrame): void {
  Class22DrawAndPoseSubActor(obj, f);
  ActorAdvanceMotion(obj, f.dt);
}

/**
 * `Class22CutsceneHoldUntilChapterCard` — `FUN_0049B280`. Stage 1 block 0:
 * the flier perched over the square, taking off on camera frame 70 and
 * flying `op_st1` path `0x100` until the chapter card raises flag `0xF8`.
 *
 * Drawn -- and so advanced -- only while the chapter card is **not** up
 * (`g_screen_furniture_flags & 0x20`), and not at all on the frames sub 3
 * waits for its wing-beat.
 */
export function Class22CutsceneHoldUntilChapterCard(obj: JudgmentActor,
                                                    f: ClassFrame): void {
  const t = obj.judgment;
  const sub = ActorByAt(t.subActorAt);
  let step = false;
  if (obj.sub === 0) {
    obj.pos.x = CAMEO_POS.x; obj.pos.y = CAMEO_POS.y; obj.pos.z = CAMEO_POS.z;
    obj.yaw = CAMEO_YAW;
    obj.roll = 0;
    obj.pitch = 0;
    t.hint = 0;
    if (sub?.cls === obj.cls) sub.judgment.subClipWanted = CAMEO_WINGS_FOLDED;
    obj.sub += 1;
  }
  switch (obj.sub) {
    case 1:
      if (!AtCamFrame(CAMEO_TAKE_OFF_FRAME)) break;
      ActorSetMotionBlended(obj, Class22Clip.TakeOff, 0, 5);
      Class22PlaySound(f, SND_FLAP);
      t.hint = 1;
      step = true;
      break;
    case 2:
      obj.pos.x = CAMEO_POS.x;
      obj.pos.z = CAMEO_POS.z;
      if (t.cursor !== MotionPlayLength(obj) - 1) break;
      ActorSetMotion(obj, Class22Clip.Idle);
      step = true;
      break;
    case 3:
      // `if ((float)g_cam_path_frame != 170.0) return;` -- undrawn.
      if (!AtCamFrame(CUTSCENE_FLAP_FRAME)) return;
      Class22PlaySound(f, SND_FLAP2);
      step = true;
      break;
    case 4:
      Class22PlaceOnObjectPath(obj, f.host, PATH_CAMEO, G.g_cam_path_frame);
      if (G.g_script_flags[CHAPTER_CARD_FLAG] === 1) {
        if (sub?.cls === obj.cls) {
          sub.judgment.subClipWanted = CAMEO_WINGS_FLYING;
        }
        obj.state += 1;
        obj.sub = 0;
        return;
      }
      break;
    default:
      break;
  }
  if (step) obj.sub += 1;
  if ((G.g_screen_furniture_flags & FURNITURE_CHAPTER_CARD) === 0) {
    DrawAndStep(obj, f);
  }
}

/**
 * `Class22CutsceneRideAndLeave` — `FUN_0049B3F0`. The cameo's second half:
 * ride `op_st1` path `0x101` while the camera plays `cp_st1` `0x21`, then
 * `0x102` on `0x22`, and `ActorKill` on the descriptor's camera cue
 * (`0x22`, frame 400). Undrawn on any other camera path.
 */
export function Class22CutsceneRideAndLeave(obj: JudgmentActor,
                                            f: ClassFrame,
                                            d: Class22Descriptor): void {
  const t = obj.judgment;
  if (Class22TailCueReached(d)) {
    // `ActorFreeHitSlot` if `+0x3C != -1`, `ReleaseCameraEnemySlot` if
    // `+0x120 != 0xFF`, then `ActorKill` -- not `ActorDespawn`.
    ActorReleaseHitSlot(obj);
    JudgmentReleaseEnemySlot(t);
    Class22Kill(obj);
    return;
  }
  const frame = G.g_cam_path_frame;
  if (G.g_active_cam_path === CAM_LEAVE_A) {
    Class22PlaceOnObjectPath(obj, f.host, PATH_LEAVE_A, frame);
    if (AtCamFrame(RIDE_LEAVE_GLIDE_FRAME)) {
      ActorSetMotionBlended(obj, Class22Clip.Glide, 0, 8);
    }
    if (AtCamFrame(LEAVE_A_SWOOP_FRAME)) {
      t.node2Mode = 1;
      t.node2Count = 0;
      ActorSetMotionBlended(obj, Class22Clip.Swoop, 0, 3);
    }
  } else if (G.g_active_cam_path === CAM_LEAVE_B) {
    Class22PlaceOnObjectPath(obj, f.host, PATH_LEAVE_B, frame);
    if (AtCamFrame(LEAVE_B_FLAP_FRAME)) {
      t.node2Mode = 0;
      Class22PlaySound(f, SND_FLAP);
    }
    if (AtCamFrame(LEAVE_B_TURN_FRAME)) {
      ActorSetMotionBlended(obj, Class22Clip.Turn, 0, 3);
    }
  } else {
    return;
  }
  if (obj.motion === Class22Clip.Swoop && t.cursor === SWOOP_LAST_CURSOR) {
    ActorSetMotionBlended(obj, Class22Clip.Glide, 0, 3);
  }
  if (obj.motion === Class22Clip.Turn && t.cursor === TURN_LAST_CURSOR) {
    ActorSetMotionBlended(obj, Class22Clip.Glide, 0, 3);
  }
  DrawAndStep(obj, f);
}

/**
 * `Class22PoseUntilCameraCue` — `FUN_0049B5B0`, variant 3's whole update
 * (`advevtbl.bin`, the attract loop): the tail cue's `ActorKill`, else draw
 * and step.
 */
export function Class22PoseUntilCameraCue(obj: JudgmentActor, f: ClassFrame,
                                          d: Class22Descriptor): void {
  if (Class22TailCueReached(d)) {
    ActorReleaseHitSlot(obj);
    JudgmentReleaseEnemySlot(obj.judgment);
    Class22Kill(obj);
    return;
  }
  DrawAndStep(obj, f);
}

/**
 * `Class22RideInAndJoinFight` — `FUN_0049B640`. `g_class22_states[2]`,
 * variant 1's entrance.
 *
 * Sub 0 spawns the companion and, outside Boss Mode, falls into sub 1: ride
 * `op_st1` path `0x103` at the camera's frame. On the integer frame
 * `g_cam_path_length[0x2F]` (830) it raises `g_script_flags[2]` -- the
 * banner's start -- and seats the flier at the fight's start. Sub 2 counts
 * `g_cam_path_length[0x30]` (300) frames, the banner's own run, and joins
 * the fight: hit points, the health bar, both counters, `g_boss_engaged`.
 */
export function Class22RideInAndJoinFight(obj: JudgmentActor, f: ClassFrame,
                                          d: Class22Descriptor): void {
  const t = obj.judgment;
  if (obj.sub === 0) {
    Class22LinkCompanion(obj, Class22SpawnCompanion(d, f));
    if (G.g_GameMode === GameMode.Boss) {
      ActorSetMotion(obj, Class22Clip.Glide);
      G.g_script_flags[CLASS22_BANNER_FLAG] = 1;       // 0x0049B726
      Class22SeatAtFightStart(obj);
      obj.yaw = FIGHT_START_YAW;
      obj.roll = 0;
      obj.pitch = 0;
      t.counter = 0;
      obj.sub = 2;
      DrawAndStep(obj, f);
      return;
    }
    obj.sub += 1;
  } else if (obj.sub !== 1) {
    if (obj.sub === 2) {
      t.counter += 1;
      if (CAM_PATH_LENGTH[0x30] <= t.counter) {
        obj.hp = d.hp;
        t.hpStage = 0;
        BossHpBarSpawn(HP_BAR_X, HP_BAR_Y);            // 0x0049B6A8
        G.g_enemies_present += 1;                      // 0x0049B6B4
        G.g_enemies_alive += 1;                        // 0x0049B6BB
        ActorSetMotionBlended(obj, Class22Clip.Fly, 0, 3);
        G.g_boss_engaged = 1;                          // 0x0049B6CF
        obj.state += 1;
        obj.sub = 0;
        DrawAndStep(obj, f);
        return;
      }
    }
    DrawAndStep(obj, f);
    return;
  }
  // Sub 1.
  const frame = G.g_cam_path_frame;
  Class22PlaceOnObjectPath(obj, f.host, PATH_RIDE_IN, frame);
  obj.yaw = FIGHT_START_YAW;
  if (AtCamFrame(RIDE_IN_GLIDE_FRAME)) {
    ActorSetMotionBlended(obj, Class22Clip.Glide, 0, 8);
  }
  if (AtCamFrame(RIDE_IN_NODE2_ON_FRAME)) {
    t.node2Mode = 1;
    t.node2Count = 0;
  }
  if (AtCamFrame(RIDE_IN_NODE2_OFF_FRAME)) t.node2Mode = 0;
  // An **integer** compare, `CMP [g_cam_path_frame], [0x00576DF4]`, and no
  // test of which path is playing.
  if (G.g_cam_path_frame === CAM_PATH_LENGTH[0x2f]) {
    G.g_script_flags[CLASS22_BANNER_FLAG] = 1;         // 0x0049B809
    Class22SeatAtFightStart(obj);
    obj.sub += 1;
    t.counter = 0;
  }
  DrawAndStep(obj, f);
}

/** `pos = (-1054.0, 30.0, -479.1)` — `0xC483C000`, `0x41F00000`, `0xC3EF8CCD`. */
function Class22SeatAtFightStart(obj: JudgmentActor): void {
  obj.pos.x = FIGHT_START.x;
  obj.pos.y = FIGHT_START.y;
  obj.pos.z = FIGHT_START.z;
}

const _m = MatIdentity();

/**
 * `Class22DescendAndJoinFight` — `FUN_0049CE10`. `g_class22_states[6]`,
 * variant 2's entrance (stage 5).
 *
 * Ride `op_st5` path `0x17F` until the camera's integer frame reaches
 * `g_cam_path_length[0xCE]` (445); then a counted hover with node 2's cycle
 * switched on and off, the turn clip at 600, and when the turn ends a glide
 * down onto the phase-1 offset in the walker's frame. The fight joins on
 * frame `0x348` (840) of the counter -- the count the stage-5 script waits
 * before it opens the shutter. No banner, and `g_boss_engaged` is never
 * raised by this variant (its only writers are `0x0049B6CF` and
 * `0x0049D507`).
 */
export function Class22DescendAndJoinFight(obj: JudgmentActor,
                                           f: ClassFrame,
                                           d: Class22Descriptor): void {
  const t = obj.judgment;
  if (obj.sub === 0) {
    Class22LinkCompanion(obj, Class22SpawnCompanion(d, f));
    obj.sub += 1;
  }
  switch (obj.sub) {
    case 1:
      Class22PlaceOnObjectPath(obj, f.host, PATH_DESCENT, G.g_cam_path_frame);
      // Dead: the tail's `Class22FaceCamera` overwrites it.
      obj.yaw += 0x8000;
      if (G.g_cam_path_frame === CAM_PATH_LENGTH[0xce]) {
        obj.sub += 1;
        t.counter = 0;
      }
      break;
    case 2: {
      const old = t.counter;
      const n = old + 1;
      t.counter = n;
      if (n < 0x191) {
        if (n === 400 || n === 0x78) {
          t.node2Mode = 1;
          t.node2Count = 0;
        } else if (n === 0x17c) {
          t.node2Mode = 0;
        }
      } else if (old === 0x22f) {
        t.node2Mode = 0;
      } else if (n === 600) {
        t.node2Mode = 1;
        t.node2Count = 0;
        ActorSetMotionBlended(obj, Class22Clip.Turn, 0, 3);
      }
      if (obj.motion === Class22Clip.Turn && t.cursor === TURN_LAST_CURSOR) {
        const comp = ActorByAt(t.companionAt);
        ActorSetMotionBlended(obj, Class22Clip.Glide, 0, 8);
        Class22EvalObjectPathOffset(t, f.host, 0x104, 0);
        if (comp) {
          for (let i = 0; i < 16; i++) _m[i] = i % 5 === 0 ? 1 : 0;
          MatrixTranslate(_m, comp.pos.x, comp.pos.y, comp.pos.z);
          MatrixRotateY(_m, comp.yaw + 0x8000);
          MatrixTransformPoint(_m, { ...t.point }, t.point);
          t.point.x = Math.fround(t.point.x);
          t.point.y = Math.fround(t.point.y);
          t.point.z = Math.fround(t.point.z);
        }
        obj.sub += 1;
        t.path = 0;
      }
      break;
    }
    case 3: {
      t.counter += 1;
      const den = 0x3c - t.path;
      obj.pos.x = Math.fround(LerpWeighted(obj.pos.x, t.point.x, 1, den));
      obj.pos.y = Math.fround(LerpWeighted(obj.pos.y, t.point.y, 1, den));
      obj.pos.z = Math.fround(LerpWeighted(obj.pos.z, t.point.z, 1, den));
      const k = t.path;
      t.path = k + 1;
      if (k > 0x3c) {
        obj.pos.x = t.point.x; obj.pos.y = t.point.y; obj.pos.z = t.point.z;
        obj.sub += 1;
        t.path = 0;
      }
      break;
    }
    case 4:
      t.counter += 1;
      if (t.counter === DESCENT_JOIN_FRAME) {
        obj.hp = d.hp;
        t.hpStage = 0;
        BossHpBarSpawn(HP_BAR_X, HP_BAR_Y);            // 0x0049D0F8
        G.g_enemies_present += 1;                      // 0x0049D104
        G.g_enemies_alive += 1;                        // 0x0049D10B
        ActorSetMotionBlended(obj, Class22Clip.Fly, 0, 3);
        obj.state += 1;
        t.counter = 0;
        obj.sub = 0;
      }
      break;
    default:
      break;
  }
  obj.yaw = Class22FaceCamera(obj.pos.x, obj.pos.z, f.eye.x, f.eye.z);
  DrawAndStep(obj, f);
}


/**
 * The despawn cue three states test first:
 * `g_active_cam_path == (s16)tail[6] && g_cam_path_frame >= (s16)tail[8]`.
 */
export function Class22TailCueReached(d: Class22Descriptor): boolean {
  return G.g_active_cam_path === d.despawn_path
    && d.despawn_frame <= G.g_cam_path_frame;
}

/**
 * `ActorKill` (`FUN_004A7040`) — the task unlinks itself; the port's pool
 * removal is `despawned`. `[port-only]` for the sub-actor: it is the flier's
 * `ActorAllocSub` block and has no task, so it goes when the flier's memory
 * does; in the port it is an actor of its own and is taken out beside it.
 */
export function Class22Kill(obj: JudgmentActor): void {
  obj.despawned = true;
  obj.visible = false;
  Class22DropSubActor(obj);
}

/** `ActorDespawn` (`FUN_00409CC0`) on the flier, and its sub-actor with it. */
export function Class22Despawn(obj: JudgmentActor): void {
  ActorDespawn(obj);
  Class22DropSubActor(obj);
}

function Class22DropSubActor(obj: JudgmentActor): void {
  const sub = ActorByAt(obj.judgment.subActorAt);
  if (sub && sub !== obj && sub.cls === obj.cls) ActorDespawn(sub);
}

