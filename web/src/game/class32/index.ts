/**
 * Class 0x32 — **the stage-5 boss**, character type `0x4B` (`boss5.bin`,
 * with four nodes from `boss5b.bin`), 450 hit points. One descriptor in the
 * game (evt `0x3D84`), spawned by stage 5's block 7 and by block 9, the
 * Boss Mode entry. The reading is `docs/re/boss-magician.md`.
 *
 * ## How the fight gates the script
 *
 * ```
 * block 7 step 2: spawn at the origin (pose frozen); cam path 211 from 420
 * cam frame 419..598  -> ride object path 0x180 down (state 0 sub 1)
 * step 3: set_script_flag 22 -> the name banner flies cam path 212 (300 frames)
 *         wait queued events; set_script_flag 23 -> state 1: glide to the mark,
 *         the health bar, then the fight (states 5..10)
 * step 4: wait_enemies_alive 0  <- state 3 gives both counters back
 *         goto_scene_state_when_alive 3; cam path 213 (frames 0..170)
 *         wait_script_flag 30   <- state 4, 299 frames from cam frame 170
 * ```
 *
 * ## The port's shape
 *
 * One TS function per exe routine, under its Ghidra name. The boss carries
 * the engine's model block (`Actor.skel`, `game/skeleton.ts`) as class 0x14
 * does, posed and clocked inside its own update by `Class32DrawAndAdvance`,
 * and its node hook is `Class32DrawBonePart` at `model+0x1158`. Its
 * projectiles are actors of this class whose `Boss5Tail.routine` is the
 * projectile's; its other tasks are `G.g_class32_tasks` (`tasks.ts`).
 *
 * `state.ts` the words, `tables.ts` the `.rdata`, `shot.ts` being shot,
 * `entrance.ts`, `fight.ts` and `death.ts` the twelve states, `common.ts`
 * the four small routines they share, `projectile.ts`, `tasks.ts`, `draw.ts`
 * and `bone_parts.ts` the rest, and this file the class.
 */
import type { Events } from "../../core/events";
import type { Rng } from "../../core/rng";
import {
  ActorFlag, MotionFlag, type Actor, type Boss5Actor,
} from "../actor";
import { BossIntroBannerSpawn } from "../boss_banner";
import { ActorRegisterCameraPoint } from "../camera/track";
import { PropEvalObjectPath6 } from "../class41/object_path";
import { GameMode } from "../game_mode";
import { G } from "../globals";
import { FtolS16 } from "../matrix";
import {
  registerClass, type ActorDebug, type ClassFrame, type ClassHandler,
} from "../registry";
import { MakeSkeletonModel } from "../skeleton";
import { ActorBuildSkinnedModel } from "../spawn";
import { SpawnClass } from "../spawn_class";
import { CharacterTypeOf } from "../tables";
import { VecToAngles } from "../vec";
import { CLASS32_DEAD_FLAG, CLASS32_LEAVING_FLAG,
         Class32StateDeathRetire, Class32StateDeathSequence,
         Class32StateRaiseFlagAndLeave } from "./death";
import { CLASS32_NODE_HOOK, Class32DrawAndAdvance } from "./draw";
import {
  CLASS32_ARRIVAL_PATH, CLASS32_BANNER_FLAG, Class32StateMoveToFixedPoint,
  Class32StateWaitCamAndFlags,
} from "./entrance";
import {
  Class32StateCastProjectiles, Class32StateCircleCamera,
  Class32StateFinalBarrage, Class32StateHitReaction, Class32StateHopNearCamera,
  Class32StateLungeAtCamera,
} from "./fight";
import { Class32ProjectileDispatchAndDraw } from "./projectile";
import { Class32OnShot } from "./shot";
import { Class32Routine, Class32State } from "./state";
import { Class32TailOf } from "./tables";

export { Class32State } from "./state";

/**
 * `BossIntroBannerSpawn(0x596AC0)` -- `PUSH 0x596ac0` at `0x0047F762`. The
 * record itself is `boss_banner_records.ts`'s.
 */
export const CLASS32_INTRO_BANNER = 0x00596ac0;
/** `MOV dword ptr [ESI + 0x1b4], 0x8e` at `0x0047F606` -- the clip it is built on. */
const CLASS32_FIRST_CLIP = 0x8e;
/** `MOV byte ptr [ESI + 0x1fc], 0x1` at `0x0047F639` -- RotX, RotZ, RotY. */
const CLASS32_ROTATION_ORDER = 1;
/** `OR ECX, 0xc` into `obj+0x1F8` at `0x0047F647`. */
const CLASS32_MOTION_FLAGS = MotionFlag.TraceGround | MotionFlag.SwingTwistBetween;
/** `MOV dword ptr [ESI + 0x128], 0x40a00000` -- 5.0. */
const CLASS32_BODY_RADIUS = 5.0;
/** `FADD double ptr [0x00565DD8]` -- 15.0 above the eye, for the aim `Init` stores. */
const INIT_AIM_RISE = 15.0;
/** `PUSH 0x44158000` -- the path's frame 598 Boss Mode starts on. */
const BOSS_MODE_PATH_FRAME = 598.0;
/** `MOV word ptr [ESI + 0x1312], BP` with `BP = 3` -- Boss Mode's sub. */
const BOSS_MODE_SUB = 3;
/** The skeleton, if the character type is missing: boss5's fifteen nodes, sixteen records. */
const CLASS32_BONES = 16;
/** `FADD float ptr [0x004C4380]` -- 1.0 a frame, to `[0x005691B0]` 18000.0. */
const CLOCK_LIMIT = 18000.0;
/** `MOV byte ptr [ESI + 0x131e], 0x10` -- the rank a long fight ends up on. */
const CLOCK_RANK = 0x10;

/** `[port-only]` Narrow to this class. */
function IsBoss5(obj: Actor): obj is Boss5Actor {
  return obj.cls === SpawnClass.Boss5;
}

/**
 * `Class32Init` — `FUN_0047F5F0`.
 *
 * ```
 * tail = obj+0x1390; g_cur_actor = obj; obj+0x1B4 = 0x8E
 * obj+0x1F4 = (s8)tail[0]; ActorBuildSkinnedModel(obj+0x194, obj+0x40, obj+0x20C)
 * obj+0x1FC = 1; obj+0x12EC = Class32DrawBonePart; obj+0x1F8 |= 0xC
 * obj+0x124 = g_actor_radius_by_char[type]; obj+0x128 = 5.0
 * if (!(obj+0x34 & 0x40000)) {
 *     VecToAngles(eye.x - x, eye.y + 15.0 - y, eye.z - z, &p, &yw)
 *     obj+0x1320 = p & 0xFFFF; obj+0x1324 = yw & 0xFFFF
 * }
 * obj+0x121 = 0xFF; obj+0x1310 = (s8)tail[2]; obj+0x1312 = 0
 * if (g_GameMode == 3) {
 *     CamEvalObjectPath6(0x180, 598.0, &p); pos, angles = p; sub = 3
 *     g_script_flags[22] = 1
 * }
 * g_enemies_present++; g_enemies_alive++           ; 0x0047F754, 0x0047F75B
 * BossIntroBannerSpawn(0x596AC0); obj+0x00 = Class32Update
 * ```
 *
 * Both counters, so the script's `wait_enemies_alive 0` in step 4 waits on
 * the boss; the banner waits on flag 22 before it flies. The actor carries
 * the model block (`game/skeleton.ts`) as class 0x14 does, built here where
 * the engine builds it.
 */
export function Class32Init(obj: Actor, rng?: Rng, events?: Events): void {
  void rng;
  void events;
  if (!IsBoss5(obj)) return;
  const t = obj.boss5;
  const tail = Class32TailOf(obj);
  if (tail) obj.charType = tail.char_type;
  // `[port-only]` The block is embedded at `obj+0x194` in the engine; the
  // port makes it here, where the engine starts writing it.
  const skel = MakeSkeletonModel(
    CharacterTypeOf(obj)?.bone_count ?? CLASS32_BONES, 5);
  skel.motion = CLASS32_FIRST_CLIP;
  obj.skel = skel;
  obj.motion = CLASS32_FIRST_CLIP;
  ActorBuildSkinnedModel(obj);
  skel.order = CLASS32_ROTATION_ORDER;
  skel.hook = CLASS32_NODE_HOOK;
  obj.motionFlags |= CLASS32_MOTION_FLAGS;
  const r = CharacterTypeOf(obj)?.actor_radius ?? 0;
  obj.hitRadius = r;
  obj.radius = r;
  obj.bodyRadius = CLASS32_BODY_RADIUS;
  if ((obj.flags & ActorFlag.NoHeadAim) === 0) {
    const e = G.g_camera_eye;
    const a = VecToAngles(e.x - obj.pos.x, e.y + INIT_AIM_RISE - obj.pos.y,
                          e.z - obj.pos.z);
    t.initPitch = FtolS16(a.pitch) & 0xffff;
    t.initYaw = FtolS16(a.yaw) & 0xffff;
  }
  obj.attackPermit = -1;
  obj.state = tail?.state ?? 0;
  obj.sub = 0;
  if (G.g_GameMode === GameMode.Boss) {
    const p = PropEvalObjectPath6(CLASS32_ARRIVAL_PATH, BOSS_MODE_PATH_FRAME);
    if (p) {
      obj.pos.x = p.x; obj.pos.y = p.y; obj.pos.z = p.z;
      obj.pitch = p.rx; obj.yaw = p.ry; obj.roll = p.rz;
    }
    obj.sub = BOSS_MODE_SUB;
    G.g_script_flags[CLASS32_BANNER_FLAG] = 1;
  }
  G.g_enemies_present += 1;
  G.g_enemies_alive += 1;
  BossIntroBannerSpawn(CLASS32_INTRO_BANNER);
  t.routine = Class32Routine.Boss;
}

/** `CALL dword ptr [EDX*0x4 + 0x596738]` at `0x0047C9E1` -- `g_class32_states`. */
function Class32RunState(obj: Boss5Actor, f: ClassFrame): void {
  switch (obj.state as Class32State) {
    case Class32State.WaitCamAndFlags: Class32StateWaitCamAndFlags(obj); return;
    case Class32State.MoveToFixedPoint: Class32StateMoveToFixedPoint(obj); return;
    case Class32State.DeathSequence:
      Class32StateDeathSequence(obj, f.rng, f.events); return;
    case Class32State.DeathRetire: Class32StateDeathRetire(obj, f.events); return;
    case Class32State.RaiseFlagAndLeave: Class32StateRaiseFlagAndLeave(obj); return;
    case Class32State.HitReaction: Class32StateHitReaction(obj, f); return;
    case Class32State.HopNearCamera: Class32StateHopNearCamera(obj, f); return;
    case Class32State.CastProjectiles: Class32StateCastProjectiles(obj); return;
    case Class32State.CircleCamera: Class32StateCircleCamera(obj, f); return;
    case Class32State.LungeAtCamera: Class32StateLungeAtCamera(obj, f); return;
    case Class32State.FinalBarrage:
    case Class32State.FinalBarrage11:
      Class32StateFinalBarrage(obj, f); return;
    // [12] is `FUN_0041EBB0`, a bare `RET`.
    case Class32State.NoOp12: return;
  }
}

/**
 * `Class32Update` — `FUN_0047C960`. The boss, one 60 Hz frame.
 *
 * ```
 * g_cur_actor = obj
 * g_boss_hp_fraction = hp < 1 ? 0.0 : (float)hp / (float)maxHp   ; FILD/FIDIV
 * if ((obj+0x138C += 1.0) > 18000.0) { obj+0x131E = 0x10; obj+0x138C = 0 }
 * Class32OnShot(obj)
 * g_class32_states[(s16)obj+0x1310](obj)
 * pos += vel                                        ; obj+0x40 += obj+0x4C ...
 * VecToAngles(pos - g_camera_eye, &p, &obj+0x68)     ; faces away from the eye
 * Class32DrawAndAdvance(obj); ActorRegisterCameraPoint(0)
 * ```
 *
 * A state that despawns the boss ends the update there (L72).
 */
export function Class32Update(obj: Boss5Actor, f: ClassFrame): void {
  const t = obj.boss5;
  G.g_boss_hp_fraction = obj.hp < 1 ? 0.0 : Math.fround(obj.hp / obj.maxHp);
  t.clock = Math.fround(t.clock + 1.0);
  if (t.clock > CLOCK_LIMIT) {
    t.rank = CLOCK_RANK;
    t.clock = 0;
  }
  Class32OnShot(obj, f.rng, f.host, f.events);
  Class32RunState(obj, f);
  if (obj.despawned) return;
  obj.pos.x = Math.fround(obj.vel.x + obj.pos.x);
  obj.pos.y = Math.fround(obj.vel.y + obj.pos.y);
  obj.pos.z = Math.fround(obj.vel.z + obj.pos.z);
  const e = G.g_camera_eye;
  obj.yaw = FtolS16(VecToAngles(obj.pos.x - e.x, obj.pos.y - e.y,
                                obj.pos.z - e.z).yaw);
  Class32DrawAndAdvance(obj);
  ActorRegisterCameraPoint(obj, f.host, 0);
}

/**
 * `[port-only]` The task walk's call through `obj+0x00`: the routine this
 * actor's allocation installed -- `Class32Update` for the boss,
 * `Class32ProjectileDispatchAndDraw` for a projectile.
 */
function Class32RunRoutine(obj: Actor, f: ClassFrame): void {
  if (!IsBoss5(obj)) return;
  if (obj.boss5.routine === Class32Routine.Projectile) {
    Class32ProjectileDispatchAndDraw(obj, f.rng, f.host, f.events);
    return;
  }
  Class32Update(obj, f);
}

/** The sidebar's line for this class. */
function Class32Debug(obj: Actor): ActorDebug {
  if (!IsBoss5(obj)) return { summary: "boss 5 · no tail" };
  const t = obj.boss5;
  if (t.routine === Class32Routine.Projectile) {
    return { summary: `boss 5 projectile · kind ${t.kind} state ${obj.state}`
      + ` sub ${obj.sub}`, detail: [`hp ${obj.hp}, slot 0x${t.slot.toString(16)}`] };
  }
  return {
    summary: `boss 5 · ${Class32State[obj.state] ?? obj.state} sub ${obj.sub}`,
    detail: [
      `hp ${obj.hp}/${obj.maxHp}, phase ${t.phase}, rank ${t.rank}`,
      `attack ${t.attack}, projectiles ${t.liveProjectiles}, timer ${t.timer}`,
      `flags 22/23/24/30: ${G.g_script_flags[22] ? 1 : 0}`
        + `/${G.g_script_flags[23] ? 1 : 0}/${G.g_script_flags[24] ? 1 : 0}`
        + `/${G.g_script_flags[30] ? 1 : 0}`,
    ],
    hot: obj.state === Class32State.DeathSequence
      || obj.state === Class32State.RaiseFlagAndLeave,
  };
}

export const Boss5Handler: ClassHandler = {
  init: Class32Init,
  update: Class32RunRoutine,
  // The death is three states of the class's own; the class never sets
  // `obj.dead`, so this is a declaration of intent rather than a path taken.
  updatesWhenDead: true,
  // `Class32OnShot` reads `obj+0x34` bit 3 itself, and so do the
  // projectiles' flights.
  ownsShotResult: true,
  // `Class32Update` calls `ActorRegisterCameraPoint(0)` at `0x0047CA3A`,
  // which ends in `RegisterForShotTest`; a projectile calls
  // `RegisterForShotTest` from its own draw.
  registersForShotTest: true,
  // The boss steps its block's counter inside `Class32DrawAndAdvance`
  // (`FUN_0047FE40`), after the state; a projectile has no clip.
  advancesOwnMotion: true,
  // `Class32Init` raises 22 in Boss Mode; state 4 raises 24 and 30
  // (`MOV byte ptr [0x009C7218], 1`, `[0x009C721E], 1`). Every link from the
  // spawn to both is ported.
  raisesScriptFlag: [CLASS32_BANNER_FLAG, CLASS32_LEAVING_FLAG,
                     CLASS32_DEAD_FLAG],
  // **Nothing to give back.** The class's own state 3 gives both enemy
  // counters back and releases its permit; a projectile holds neither.
  onDeadSweep: () => {},
  debug: Class32Debug,
};

registerClass(SpawnClass.Boss5, Boss5Handler);
