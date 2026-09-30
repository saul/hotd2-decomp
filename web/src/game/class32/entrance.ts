/**
 * Class 0x32's way in: states 0 and 1.
 *
 * Stage 5's block 7 spawns the boss at the origin with the pose frozen
 * (`obj+0x34` bit `0x4000`) while camera path 211 plays the arrival; from
 * that path's frame `0x1A3` the boss rides object path `0x180` down out of
 * the sky, and past frame `0x256` it waits for the script's two flags --
 * 22, which also starts its name banner, and 23, set once the banner's own
 * camera flight (path 212) has finished. Then it glides to its mark and the
 * fight begins. Boss Mode (block 9) enters state 0 at sub 3, already on the
 * path's last frame, with flag 22 raised by `Class32Init` itself.
 */
import type { Boss5Actor } from "../actor";
import { ActorFlag } from "../actor";
import { BossHpBarSpawn } from "../boss_hp_bar";
import { PropEvalObjectPath6 } from "../class41/object_path";
import { G } from "../globals";
import { Class32StopMoving } from "./common";
import { Class32State } from "./state";
import { Class32Phase } from "./tables";

/** Object path `0x180` -- `PUSH 0x180`, the ride down; `Class32Init` reads it too. */
export const CLASS32_ARRIVAL_PATH = 0x180;
/** `CMP [g_cam_path_frame], 0x1A3; JLE` -- the ride starts past frame 419... */
const ARRIVAL_RIDE_FROM = 0x1a3;
/** ...and the wait for the flags past frame 598. */
const ARRIVAL_RIDE_TO = 0x256;
/** `CMP byte ptr [0x009C7216], 0` and `[0x009C7217]` -- flags 22 and 23. */
export const CLASS32_BANNER_FLAG = 22;
export const CLASS32_FIGHT_FLAG = 23;

/** `BossHpBarSpawn(0x43A00000, 0x420C0000)` -- (320.0, 35.0). */
const HP_BAR_X = 320.0;
const HP_BAR_Y = 35.0;
/** `obj+0x13C0..0x13C8 = 0x4410C000, 0xC2820000, 0xC60A0000` -- the mark. */
const MARK = { x: 579.0, y: -65.0, z: -8832.0 };
/** `obj+0x1330 = 0x91` -- the glide's frames. */
const MARK_FRAMES = 0x91;

/**
 * `Class32StateWaitCamAndFlags` — `FUN_00480050`. The subs fall through.
 *
 * ```
 * 0: obj+0x34 |= 0x4000; sub++
 * 1: if (g_cam_path_frame > 0x1A3)
 *        CamEvalObjectPath6(0x180, (float)g_cam_path_frame, &p)
 *        obj+0x40..0x48 = p.xyz; obj+0x64..0x6C = p.angles
 *    if (g_cam_path_frame <= 0x256) return; sub++
 * 2: if (!g_script_flags[22]) return; sub++
 * 3: if (!g_script_flags[23]) return; sub++
 * 4: state 1, sub 0
 * ```
 */
export function Class32StateWaitCamAndFlags(obj: Boss5Actor): void {
  let s = obj.sub;
  if (s === 0) {
    obj.flags |= ActorFlag.PoseFrozen;
    obj.sub += 1;
    s = 1;
  }
  if (s === 1) {
    if (G.g_cam_path_frame > ARRIVAL_RIDE_FROM) {
      const p = PropEvalObjectPath6(CLASS32_ARRIVAL_PATH, G.g_cam_path_frame);
      if (p) {
        obj.pos.x = p.x; obj.pos.y = p.y; obj.pos.z = p.z;
        obj.pitch = p.rx; obj.yaw = p.ry; obj.roll = p.rz;
      }
    }
    if (G.g_cam_path_frame <= ARRIVAL_RIDE_TO) return;
    obj.sub += 1;
    s = 2;
  }
  if (s === 2) {
    if (!G.g_script_flags[CLASS32_BANNER_FLAG]) return;
    obj.sub += 1;
    s = 3;
  }
  if (s === 3) {
    if (!G.g_script_flags[CLASS32_FIGHT_FLAG]) return;
    obj.sub += 1;
    s = 4;
  }
  if (s === 4) {
    obj.state = Class32State.MoveToFixedPoint;
    obj.sub = 0;
  }
}

/**
 * `Class32StateMoveToFixedPoint` — `FUN_0047D120`.
 *
 * ```
 * sub 0: obj+0x34 |= 0x100; BossHpBarSpawn(320.0, 35.0)
 *        dest = (579.0, -65.0, -8832.0); obj+0x1330 = 0x91; Class32StopMoving
 *        sub++; vel = (dest - pos) / 145.0                  ; and on
 * sub 1: if (--obj+0x1330 >= 1) return
 *        obj+0x34 &= ~0x100; Class32StopMoving; obj+0x131E = GetDamageRank()
 *        obj+0x132C = 0; obj+0x138C = 0
 *        state = g_class32_phases[0].state; sub 0; g_boss_engaged = 1
 * ```
 *
 * `Class32Update` integrates the velocity, so the boss arrives as the
 * count runs out. `GetDamageRank` (`FUN_0040A8A0`) is `g_damage_rank` read
 * as a signed byte.
 */
export function Class32StateMoveToFixedPoint(obj: Boss5Actor): void {
  const t = obj.boss5;
  if (obj.sub === 0) {
    obj.flags |= ActorFlag.ShotImmune;
    BossHpBarSpawn(HP_BAR_X, HP_BAR_Y);
    t.dest.x = MARK.x; t.dest.y = MARK.y; t.dest.z = MARK.z;
    t.timer = MARK_FRAMES;
    Class32StopMoving(obj);
    const f = t.timer;
    obj.sub += 1;
    obj.vel.x = Math.fround((t.dest.x - obj.pos.x) / f);
    obj.vel.y = Math.fround((t.dest.y - obj.pos.y) / f);
    obj.vel.z = Math.fround((t.dest.z - obj.pos.z) / f);
  } else if (obj.sub !== 1) {
    return;
  }
  t.timer -= 1;
  if (t.timer >= 1) return;
  obj.flags &= ~ActorFlag.ShotImmune;
  Class32StopMoving(obj);
  t.rank = (G.g_damage_rank << 24) >> 24;
  t.castMode = 0;
  t.clock = 0;
  obj.state = Class32Phase(0)[0];
  obj.sub = 0;
  G.g_boss_engaged = 1;
}
