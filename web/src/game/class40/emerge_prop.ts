/**
 * Class 0x40 selector 2 — the prop the horde pushes out of the way.
 *
 * `SpawnHordeEmergeProp` (`FUN_0043DC30`) builds a `0x1F8`-byte object at
 * `(x, -9.2769, -538.8)` — **only `x` comes from the placer**; the other two
 * are literals — drawing `komono_st1b.bin` part 12 (slot `0x17CC`) twice, the
 * second half turned round and stretched 1.25 in y. Stage 1's four selector-2
 * spawns are at `x = -100.87` (block 3) and `x = -200.87` (blocks 7, 8 and
 * 12), and formations 0 and 1 start their splines at exactly those two spots:
 * it is what the horde comes up through. What it *is* is `[open]`; nothing
 * but the model names it, and the model's name says nothing.
 *
 * It lies flat until the first member leaves its hold (`g_horde_emerged`),
 * then tips up on end and slides clear. From then on it is a target: shot, it
 * rings (`COMMON\BULLET_MET3_22.WAV`), jumps, tumbles, lands on a corner and
 * rocks flat, and can be shot again. It scores nothing and counts for nothing.
 * It goes when the event step has changed twice (block 3) or four times
 * (anywhere else).
 */
import { BAMS_TO_RAD } from "../../core/bams";
import type { Rng } from "../../core/rng";
import { ActorFlag, type Actor } from "../actor";
import { ActorDespawn } from "../despawn";
import { G } from "../globals";
import type { ClassFrame } from "../registry";
import { ActorSpawn } from "../spawn";
import { SpawnClass } from "../spawn_class";
import { PROP_SPARK_KIND } from "../effects/sprite";
import type { GameHost } from "../host";
import { vec3 } from "../vec";
import { HordeEffectAt } from "./splash";
import { EmergePropState, HordeKind, type HordeTail } from "./state";
import { EMERGE_PROP_RIM_POINTS } from "./tables";

/** `+0x198` and `+0x19C` — the two coordinates the placer does not supply. */
export const EMERGE_PROP_Y = -9.2769;
export const EMERGE_PROP_Z = -538.8;
/** `+0x1D8 = 0.8`, losing 0.025 a frame, then `z += 3` on the way to rest. */
export const EMERGE_PROP_LIFT_VZ = 0.8;
export const EMERGE_PROP_LIFT_DECAY = 0.025;
export const EMERGE_PROP_LIFT_SETTLE = 3.0;
/** The lift pitches it `0x600` a frame to `0x4000`, turning past `0x1800`. */
export const EMERGE_PROP_LIFT_PITCH_STEP = 0x600;
export const EMERGE_PROP_UPRIGHT = 0x4000;
export const EMERGE_PROP_TURN_AFTER = 0x1800;
export const EMERGE_PROP_TURN_STEP = 0x40;
/** `obj+0x124 = 3.0`. */
export const EMERGE_PROP_HIT_RADIUS = 3.0;
/** The shot: `+0x1D4 = 0.6`, spins drawn from `rand() % 0x401 - 0x200`. */
export const EMERGE_PROP_JUMP_VY = 0.6;
export const EMERGE_PROP_SPIN_STEPS = 0x401;
export const EMERGE_PROP_SPIN_BIAS = 0x200;
export const EMERGE_PROP_GRAVITY = 0.02722;
/** A corner below the ground plane plus this has landed. */
export const EMERGE_PROP_GROUND_SLACK = 0.2;
export const EMERGE_PROP_ROCK_RATE = 0x200;
/** Three settles and it is at rest. */
export const EMERGE_PROP_SETTLES = 3;
/** `COMMON\BULLET_MET3_22.WAV`. */
export const SND_EMERGE_PROP_HIT = 0x1116a9;
/** `+0x1F4`: 0 step pairs in block 3, one anywhere else. */
export const EMERGE_PROP_BLOCK_SHORT = 3;

function Tail(obj: Actor): HordeTail | null {
  return (obj as Actor & { horde?: HordeTail }).horde ?? null;
}

/**
 * `SpawnHordeEmergeProp` — `FUN_0043DC30`. `PlaceHorde`'s selector 2.
 *
 * Also lowers `g_horde_emerged`, so a prop placed after a horde has already
 * come up waits for the *next* one.
 */
export function SpawnHordeEmergeProp(placer: Actor, x: number,
                                     rng?: Rng): Actor | null {
  // `[port-only]` the address: a fresh one per prop, because the same
  // descriptor lays one in each of three blocks and two can be alive at once.
  void placer;
  const obj = ActorSpawn(HordeEffectAt(), SpawnClass.HordeSpawner,
                         -1, "horde emerge prop", { visible: true }, rng);
  const t = Tail(obj);
  if (!t) return null;
  t.kind = HordeKind.EmergeProp;
  t.propY = EMERGE_PROP_Y;
  t.propX = x;
  t.propZ = EMERGE_PROP_Z;
  t.propPitch = 0;
  t.propYaw = 0;
  t.propRoll = 0;
  t.seenStep = G.g_evt_step_index;
  t.liftVz = EMERGE_PROP_LIFT_VZ;
  t.propState = EmergePropState.Wait;
  obj.hitRadius = EMERGE_PROP_HIT_RADIUS;
  obj.flags = 1;
  t.rimPoint = -1;
  t.settles = 0;
  t.lifetime = G.g_evt_block_index === EMERGE_PROP_BLOCK_SHORT ? 0 : 1;
  G.g_horde_emerged = 0;
  EmergePropSyncPosition(obj, t);
  return obj;
}

/**
 * `[port-only]` as a function: `R = Ry(yaw) Rz(roll) Rx(pitch)` applied to a point in the prop's frame —
 * the rotation `HordeEmergePropUpdate` pushes for the corner test and for its
 * draw. The engine's rotations are the right-handed ones `three.js` uses; see
 * `render/effects.ts`.
 */
export function EmergePropRotate(t: HordeTail, x: number, y: number,
                                 z: number): [number, number, number] {
  const ax = t.propPitch * BAMS_TO_RAD;
  const az = t.propRoll * BAMS_TO_RAD;
  const ay = t.propYaw * BAMS_TO_RAD;
  // Rx
  const y1 = y * Math.cos(ax) - z * Math.sin(ax);
  const z1 = y * Math.sin(ax) + z * Math.cos(ax);
  // Rz
  const x2 = x * Math.cos(az) - y1 * Math.sin(az);
  const y2 = x * Math.sin(az) + y1 * Math.cos(az);
  // Ry
  const x3 = x2 * Math.cos(ay) + z1 * Math.sin(ay);
  const z3 = -x2 * Math.sin(ay) + z1 * Math.cos(ay);
  return [x3, y2, z3];
}

/**
 * `[port-only]` — `obj+0x40` for the generic code (the pick, the debug
 * panel). The engine's object keeps its position at `+0x194` and never
 * writes `+0x40`.
 */
function EmergePropSyncPosition(obj: Actor, t: HordeTail): void {
  obj.pos.x = t.propX;
  obj.pos.y = t.propY;
  obj.pos.z = t.propZ;
  obj.shotCentre.x = t.propX;
  obj.shotCentre.y = t.propY;
  obj.shotCentre.z = t.propZ;
}

/**
 * `HordeEmergePropUpdate` — `FUN_0043DD00`. Five states, a lifetime and a
 * shot sphere.
 *
 * **Ghidra loses two tails of this routine** (`L35`). The fall's corner loop
 * ends in `MatrixStackPop` at `0x0043E048`, which Ghidra has as no-return, so
 * the pseudocode returns there — but the bytes `JMP` on to the draw. And after
 * both draws, at `0x0043E2E4`, the routine clears `obj+0x34` bit 3, publishes
 * its position to `obj+0x70` and calls `RegisterForShotTest`: without that
 * nothing could ever shoot it, and the pseudocode shows none of it.
 */
export function HordeEmergePropUpdate(obj: Actor, f: ClassFrame): void {
  const t = Tail(obj);
  if (!t) return;
  if (G.g_evt_step_index !== t.seenStep) {
    t.stepChanges += 1;
    if (t.lifetime * 2 + 1 < t.stepChanges) {
      ActorDespawn(obj);
      return;
    }
    t.seenStep = G.g_evt_step_index;
  }
  switch (t.propState) {
    case EmergePropState.Wait:
      if (G.g_horde_emerged !== 0) t.propState = EmergePropState.Lift;
      break;
    case EmergePropState.Lift:
      if (t.propPitch < EMERGE_PROP_UPRIGHT) {
        t.propPitch += EMERGE_PROP_LIFT_PITCH_STEP;
        if (t.propPitch > EMERGE_PROP_TURN_AFTER) {
          t.propYaw += EMERGE_PROP_TURN_STEP;
        }
      }
      t.liftVz -= EMERGE_PROP_LIFT_DECAY;
      if (t.liftVz <= 0) {
        t.propState = EmergePropState.Rest;
        t.propZ += EMERGE_PROP_LIFT_SETTLE;
      } else {
        t.propZ += t.liftVz;
      }
      break;
    case EmergePropState.Fall: {
      t.fallVy -= EMERGE_PROP_GRAVITY;
      t.pitchRate += t.pitchAccel;
      t.propY += t.fallVy;
      t.rollRate += t.rollAccel;
      t.propRoll += t.rollRate;
      t.propPitch += t.pitchRate;
      if (t.fallVy < 0) {
        // Every corner that has gone through the ground is a landing, and
        // the last of the four wins -- each one counts a settle.
        for (let i = 0; i < EMERGE_PROP_RIM_POINTS.length; i += 1) {
          const [rx, ry] = EMERGE_PROP_RIM_POINTS[i];
          const [px, py, pz] = EmergePropRotate(t, rx, ry, 0);
          if (py + t.propY < G.g_camera_fixed_eye_y + EMERGE_PROP_GROUND_SLACK) {
            t.pitchRate = t.propPitch <= EMERGE_PROP_UPRIGHT
              ? EMERGE_PROP_ROCK_RATE : -EMERGE_PROP_ROCK_RATE;
            t.pivotX = px + t.propX;
            t.rollRate = t.propRoll < 1
              ? EMERGE_PROP_ROCK_RATE : -EMERGE_PROP_ROCK_RATE;
            t.pivotZ = pz + t.propZ;
            t.pivotY = G.g_camera_fixed_eye_y;
            t.propState = EmergePropState.Settle;
            t.settles += 1;
            t.rimPoint = i;
          }
        }
      }
      break;
    }
    case EmergePropState.Settle: {
      const pr = t.pitchRate;
      const rr = t.rollRate;
      const pitch = t.propPitch + pr;
      const roll = t.propRoll + rr;
      t.propPitch = pitch;
      t.propRoll = roll;
      if ((pr > 0 && pitch > EMERGE_PROP_UPRIGHT)
          || (pr < 0 && pitch < EMERGE_PROP_UPRIGHT)) {
        t.pitchRate = 0;
        t.propPitch = EMERGE_PROP_UPRIGHT;
        t.settles += 1;
      }
      if ((rr > 0 && roll > 0) || (rr < 0 && roll < 0)) {
        t.rollRate = 0;
        t.propRoll = 0;
        t.settles += 1;
      }
      if (t.settles >= EMERGE_PROP_SETTLES) {
        t.propPitch = EMERGE_PROP_UPRIGHT;
        t.propRoll = 0;
        t.pitchRate = 0;
        t.rollRate = 0;
        t.settles = 0;
        t.propState = EmergePropState.Rest;
      }
      break;
    }
    case EmergePropState.Rest:
      if (obj.flags & ActorFlag.Hit) {
        f.events?.emit("sound.play", { id: SND_EMERGE_PROP_HIT });
        t.propState = EmergePropState.Fall;
        t.fallVy = EMERGE_PROP_JUMP_VY;
        t.pitchRate = f.rng.int(EMERGE_PROP_SPIN_STEPS) - EMERGE_PROP_SPIN_BIAS;
        t.rollRate = f.rng.int(EMERGE_PROP_SPIN_STEPS) - EMERGE_PROP_SPIN_BIAS;
        t.pitchAccel = -Math.trunc(t.pitchRate / 32);
        t.rollAccel = -Math.trunc(t.rollRate / 32);
        SpawnEmergePropSparkAtCrosshair(
          t, (obj.flags & ActorFlag.HitByPlayer0) ? 0 : 1, f.host);
      }
      break;
    default:
      break;
  }
  if (t.propState === EmergePropState.Settle) {
    // The draw's `MatrixGetTranslation`: resting on corner `+0x1E8`, the
    // prop's origin is the pivot less that corner, rotated.
    const [rx, ry] = EMERGE_PROP_RIM_POINTS[t.rimPoint] ?? [0, 0];
    const [ox, oy, oz] = EmergePropRotate(t, -rx, -ry, 0);
    t.propX = t.pivotX + ox;
    t.propY = t.pivotY + oy;
    t.propZ = t.pivotZ + oz;
  }
  // `0x0043E2E4`: the hit bit goes, and the sphere is published.
  obj.flags &= ~ActorFlag.Hit;
  EmergePropSyncPosition(obj, t);
}

/** `EmergePropHitSparkUpdate` draws `0xE26`..`0xE33` at scale 1.5. */
export const EMERGE_SPARK_FIRST_SLOT = 0xe26;
export const EMERGE_SPARK_LAST_SLOT = 0xe33;
export const EMERGE_SPARK_SCALE = 1.5;

/**
 * `SpawnEmergePropSparkAtCrosshair` — `FUN_0043E3D0`. `(prop, player)`.
 *
 * Unprojects that player's crosshair at the prop's own view depth
 * (`obj+0x78`), then **overwrites z with the prop's**, and starts
 * `EmergePropHitSparkUpdate` (`FUN_0043E360`) there: `common.bin` 183..197
 * (slots `0xE25`..`0xE33`), one a frame, billboarded (`MatrixClearRotation`)
 * at scale 1.5. That routine steps its slot **before** it draws, so `0xE25` is
 * never seen and the record starts at `0xE26`.
 *
 * `[port-only]` The crosshair is the last shot ray that player fired
 * (`G.g_crosshair_ray`), cut at the prop's view-space depth through the host's
 * camera -- the arithmetic `SpawnPropHitSpark`'s port does for the same
 * reason. The sprite rides the sprite-effect pool, which steps a record the
 * way `EmergePropHitSparkUpdate` steps its object. With no ray or no camera it
 * goes where the prop is, which is where the engine's lands for a shot at the
 * middle of the screen.
 */
export function SpawnEmergePropSparkAtCrosshair(t: HordeTail, player: number,
                                                host?: GameHost): void {
  const ray = G.g_crosshair_ray[player];
  let x = t.propX;
  let y = t.propY;
  if (ray && host?.viewSpaceOfPoint) {
    const a = vec3();
    const b = vec3();
    const p = vec3();
    const end = vec3(ray.origin.x + ray.dir.x, ray.origin.y + ray.dir.y,
                     ray.origin.z + ray.dir.z);
    if (host.viewSpaceOfPoint(ray.origin, a)
        && host.viewSpaceOfPoint(end, b)
        && host.viewSpaceOfPoint(vec3(t.propX, t.propY, t.propZ), p)
        && b.z !== a.z) {
      const s = (p.z - a.z) / (b.z - a.z);
      x = ray.origin.x + ray.dir.x * s;
      y = ray.origin.y + ray.dir.y * s;
    }
  }
  G.g_sprite_effects.push({
    id: G.g_sprite_effect_seq++,
    kind: PROP_SPARK_KIND,
    pos: vec3(x, y, t.propZ),
    pitch: 0, yaw: 0, roll: 0,
    scale: vec3(EMERGE_SPARK_SCALE, EMERGE_SPARK_SCALE, EMERGE_SPARK_SCALE),
    slot: EMERGE_SPARK_FIRST_SLOT,
    lastSlot: EMERGE_SPARK_LAST_SLOT,
  });
}
