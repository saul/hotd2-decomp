/**
 * What the ground does under a class-0x31 actor: the puff where a knocked-down
 * body bounces, the puff where a leap comes down, and the scuffs `zsass`
 * leaves behind it as it moves.
 *
 * All three are one routine, `ThrowerEmitGroundDust`, keyed by a code its
 * three callers pass -- and one of the three is not a separate case at all.
 * The routine's `else if` chain only returns for a code that is neither 0x50
 * nor 0x5A, so **every arc landing also runs the trail**:
 *
 * | code | caller | what it spawns |
 * |---|---|---|
 * | `0x46` | `ThrowerStateFallAndLand`'s bounce | once per landing: a splash in the rain or on water, else dust |
 * | `0x50` | `ActorArcStep`'s landing | for a leaping thrower: a splash in the rain, else a tall dust column -- then the trail |
 * | `0x5A` | every exit of `ThrowerStateStandAndDecide` | the trail |
 *
 * The trail is character type 0x16's alone, and only while the track holds
 * behaviour set **1**'s walk -- whatever set the actor itself is in, because
 * the routine reads `g_class31_motion_sets[1]` by its address. In the stand it
 * fires on the walk's two footfalls; anywhere else, every call.
 */
import type { Events } from "../../core/events";
import { ActorFlag, ThrowerFlag, type Actor } from "../actor";
import { QueryGroundSurfaceAt } from "../coli";
import {
  SpawnSpriteEffect, SpawnSpriteEffectFromParamsThunk, SpriteEffectKind,
  type SpriteEffectParams,
} from "../effects/sprite";
import { G } from "../globals";
import type { GameHost } from "../host";
import { FtolS16, VecAimYAxisZThenX } from "../matrix";
import { SpawnClass } from "../spawn_class";
import { MotionPlayFrame, T } from "../tables";
import { vec3, VecToAngles } from "../vec";
import { ThrowerMotion, ThrowerState } from "./states";

/** The three codes the routine answers; any other returns at once. */
export enum GroundDustCode {
  /** `PUSH 0x46` at `0x0044A658`, in `ThrowerStateFallAndLand`'s bounce. */
  Bounce = 0x46,
  /** `PUSH 0x50` at `0x0044D9FA`, where `ActorArcStep`'s arc comes down. */
  ArcLanding = 0x50,
  /** `PUSH 0x5A` at `0x0044B3B2`, the last line of `ThrowerStateStandAndDecide`. */
  Trail = 0x5a,
}

/** The two surfaces both arms splash on rather than raise dust. */
const SURFACE_WATER = 5;
const SURFACE_WATER_ALT = 0x37;
/** The character types the landing arm answers, `CMP 0x16 / JL`, `CMP 0x19 / JG`. */
const LANDING_TYPE_LO = 0x16;
const LANDING_TYPE_HI = 0x19;
/** `CMP word ptr [ESI + 0x1F4], 0x16` at `0x0044D340` -- `zsass`. */
const CHAR_ZSASS = 0x16;
/**
 * `MOV ECX, [0x005929F4]` at `0x0044D351`: the second pointer of
 * `g_class31_motion_sets` (`0x005929F0`), which Ghidra shows as
 * `PTR_DAT_005929F4`. A constant, not `obj+0x130C`. `[proved]`
 */
const TRAIL_MOTION_SET = 1;
/** `CMP EAX, 0x19` and `CMP EAX, 0x32` on `obj+0x19C`: the walk's footfalls. */
const TRAIL_FOOTFALL_A = 0x19;
const TRAIL_FOOTFALL_B = 0x32;
/** `SpawnSpriteEffect`'s last two: face the camera fully or by yaw, and no player. */
const FACE_NONE = 0;
const FACE_CAMERA = 1;
const FACE_CAMERA_YAW = 2;
const NO_PLAYER = -1;
/**
 * `0x3ECCCCCD, 0x40000000, 0x3E4CCCCD` at `params[6..8]`, stored at
 * `0x0044D30C`..`0x0044D31C` -- the landing's column, narrow and tall.
 */
const LANDING_SCALE = [Math.fround(0.4), 2.0, Math.fround(0.2)] as const;
/** `FMUL float ptr [0x004C43AC]` = 0.5 -- the trail sits at the midpoint. */
const HALF = 0.5;
/** `FMUL float ptr [0x00565E18]` = `0x3D74FCBA` -- width per unit of travel. */
const TRAIL_WIDTH_PER_UNIT = Math.fround(0.05981133);
/** `0x3F4CCCCD, 0x3E4CCCCD` at `params[7..8]`, `0x0044D4AA` and `0x0044D4B2`. */
const TRAIL_HEIGHT = Math.fround(0.8);
const TRAIL_DEPTH = Math.fround(0.2);
/** `FADD double ptr [0x00565E10]` = 5.0 -- where the trail's surface probe starts. */
const TRAIL_PROBE_RISE = 5.0;
/** `ADD ECX, 0x4000` at `0x0044D46D`, then `ADD EDX, 0x8000` at `0x0044D511`. */
const TRAIL_YAW_FIRST = 0x4000;
const TRAIL_YAW_SECOND = 0x8000;

function wet(surface: number): boolean {
  return surface === SURFACE_WATER_ALT || surface === SURFACE_WATER;
}

/**
 * `ThrowerEmitGroundDust` — `FUN_0044D260`. One of three ground effects,
 * chosen by `code`, for the actor the sweep is on.
 *
 * Read from the listing rather than the decompilation, because the parameter
 * block is assembled in pieces the decompiler folds together: the landing's
 * block at `[ESP+0x3C]`, the trail's at the same place with its first six
 * words copied from the pose at `[ESP+0x24]` by `MOVSD.REP`.
 *
 * **What the pose holds is mostly never seen.** Every spawn but the trail's
 * passes a non-zero face-camera word, and `SpawnSpriteEffectFromParams`
 * overwrites `params[3]` and `params[4]` from the eye before it reads them --
 * so the bounce's angles off `g_coli_hit_normal` and the landing's
 * uninitialised stack words both go nowhere, and `params[5]` is read by
 * nothing at all. The port passes the bounce's angles as the engine computes
 * them, and zero for the landing's garbage.
 */
export function ThrowerEmitGroundDust(obj: Actor, code: GroundDustCode,
                                      host?: GameHost,
                                      events?: Events): void {
  if (code === GroundDustCode.Bounce) {
    // `MOV EDI, 0x4000; TEST EDI, EAX` on `obj+0x136C` at `0x0044D531`.
    if (obj.flags2 & ThrowerFlag.LandingDustEmitted) return;
    // `[port-only]` `obj+0x1350` is `ThrowerTail.landSurface` on a thrower
    // and another field on every other class (L3). The one caller that passes
    // 0x46 is `ThrowerStateFallAndLand`, so this narrows and never refuses.
    if (obj.cls !== SpawnClass.Thrower) return;
    let pitch = 0;
    if (obj.thr.landSurface > 0) {
      // `VecAimYAxisZThenX(g_coli_hit_normal_x, _y, _z, &params[3],
      // &params[5])` at `0x0044D57D`; `params[4]` is zeroed after it.
      const n = G.g_coli_hit_normal;
      pitch = VecAimYAxisZThenX(n[0], n[1], n[2]).rx;
    }
    const at = vec3(obj.pos.x, obj.pos.y, obj.pos.z);
    if (G.g_rain_enabled === 1 || wet(G.g_coli_hit_surface)) {
      SpawnSpriteEffect(at, pitch, 0, SpriteEffectKind.Splash, FACE_CAMERA,
                        NO_PLAYER, host, events);
    } else {
      SpawnSpriteEffect(at, pitch, 0, SpriteEffectKind.Dust, FACE_CAMERA_YAW,
                        NO_PLAYER, host, events);
    }
    obj.flags2 |= ThrowerFlag.LandingDustEmitted;
    return;
  }

  if (code === GroundDustCode.ArcLanding) {
    // Every test here fails **into the trail**, not out of the routine: all
    // four `J` at `0x0044D29B`..`0x0044D2BF` go to `0x0044D340`.
    const type = obj.charType;
    if (!(obj.flags & ActorFlag.Committed)            // 0x10000000 clear
        && (obj.flags & ActorFlag.BackingOff)          // 0x20000000 set
        && type >= LANDING_TYPE_LO && type <= LANDING_TYPE_HI) {
      const at = vec3(obj.pos.x, obj.pos.y, obj.pos.z);
      if (G.g_rain_enabled === 1) {
        SpawnSpriteEffect(at, 0, 0, SpriteEffectKind.Splash, FACE_CAMERA,
                          NO_PLAYER, host, events);
      } else {
        SpawnSpriteEffectFromParamsThunk({
          pos: at, pitch: 0, yaw: 0, scale: vec3(...LANDING_SCALE),
          kind: SpriteEffectKind.DustAlt, faceCamera: FACE_CAMERA,
          player: NO_PLAYER,
        }, host, events);
      }
    }
  } else if (code !== GroundDustCode.Trail) {
    return;
  }

  // -- the trail, `0x0044D340`: reached by 0x5A and by every 0x50 ------------
  if (obj.charType !== CHAR_ZSASS) return;
  // `[port-only]` The engine has one motion track at `obj+0x194`, whose clip
  // is `+0x1B4` and whose wrapped cursor is `+0x19C`; the port keeps a
  // one-shot on `obj.action` over the base loop, so the track is whichever
  // is on top.
  const trackMotion = obj.action ? obj.action.motion : obj.motion;
  const cursor = obj.action ? obj.action.ticks : MotionPlayFrame(obj);
  // `SHR EDX, 0x1B; AND EDX, 1; CMP EAX, [ECX + EDX*4 + 8]` -- the walk pair,
  // picked by `obj+0x34` bit 27 as the stand itself picks it.
  const walk = T.chars?.class31?.sets?.[TRAIL_MOTION_SET]?.motions?.[
    ThrowerMotion.Walk + ((obj.flags >>> 27) & 1)];
  if (trackMotion !== walk) return;
  if (cursor !== TRAIL_FOOTFALL_A && cursor !== TRAIL_FOOTFALL_B
      && obj.state === ThrowerState.StandAndDecide) {
    return;
  }

  // The trail point moves on before anything is spawned from it.
  const old = obj.target;
  const ox = old.x, oy = old.y, oz = old.z;
  const x = obj.pos.x, y = obj.pos.y, z = obj.pos.z;
  obj.target = { x, y, z };
  const mid = vec3((x + ox) * HALF, (y + oy) * HALF, (z + oz) * HALF);
  // `VecToAngles(now - old, &params[3], &params[4])` at `0x0044D43F`, both
  // truncated to s16 inside it.
  const a = VecToAngles(x - ox, y - oy, z - oz);
  const dx = ox - x, dy = oy - y, dz = oz - z;
  const params: SpriteEffectParams = {
    pos: mid,
    pitch: FtolS16(a.pitch),
    yaw: FtolS16(a.yaw) + TRAIL_YAW_FIRST,
    scale: vec3(Math.fround(Math.sqrt(dx * dx + dy * dy + dz * dz)
                            * TRAIL_WIDTH_PER_UNIT),
                TRAIL_HEIGHT, TRAIL_DEPTH),
    // `QueryGroundSurfaceAt(mid.x, mid.y + 5.0, mid.z)` at `0x0044D4CC`.
    kind: wet(QueryGroundSurfaceAt(mid.x, mid.y + TRAIL_PROBE_RISE, mid.z))
      ? SpriteEffectKind.Splash : SpriteEffectKind.DustAlt,
    faceCamera: FACE_NONE,
    player: NO_PLAYER,
  };
  SpawnSpriteEffectFromParamsThunk(params, host, events);
  // The same block again, turned a further half-turn: `+0x4000` and
  // `+0xC000`, one to each side of the line walked.
  params.yaw += TRAIL_YAW_SECOND;
  SpawnSpriteEffectFromParamsThunk(params, host, events);
}
