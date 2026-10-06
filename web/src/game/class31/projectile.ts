/**
 * Class 0x31's weapon — `zsass`'s knives and `zslman`'s crescent blades —
 * from the frame it leaves the hand to the frame it is gone.
 *
 * `ThrownWeaponUpdate`, at `0x00450780`, runs one of two states out of
 * `g_thrown_weapon_states` (`0x00592AE0`) and then draws the weapon:
 *
 * | state | routine | what |
 * |---|---|---|
 * | 0 | `ThrownWeaponFlyToTarget`, `0x0044FD40` | launch, flight, the timed hit, stuck to the screen, blink, gone |
 * | 1 | `ThrownWeaponDeflected`, `0x00450050` | shot out of the air: a spark, a ricochet, and it tumbles off |
 *
 * ## The spin
 *
 * **`0x2400` BAMS a frame about the weapon's own Y** — `MOV dword ptr
 * [ESI + 0x135c], 0x2400` (`c7865c13000000240000`) at `0x0045072C`, the last
 * write `SpawnThrownWeapon` (`FUN_004504E0`) makes, and `obj+0x68 += obj+0x135C`
 * at `0x0044FDE9`, negated unless the throwing hand is bone 5. Fifty degrees a
 * frame: a knife goes round in seven frames, eight and a half times a second.
 * The draw is `Rz(obj+0x6C) · Ry(obj+0x68) · Rx(obj+0x1364 + obj+0x64)`, and
 * the launch leaves `obj+0x64` and `obj+0x6C` at zero — `ActorClearGameFields`
 * (`FUN_004A73D0`) zeroed them and nothing writes them before the landing —
 * so the knife starts square to the world, leans by its type's fixed
 * `obj+0x1364` (`0x600`, 8.4°, for `zsass`) and spins flat about the vertical.
 * `[proved]`
 *
 * The port used to tumble every thrown weapon at `0x200` — a rate of its own,
 * eighteen times too slow — on a reading that nothing writes `obj+0x135C` and
 * the allocator leaves it uninitialised. Both halves of that were wrong: the
 * write is past the `MatrixStackPop` Ghidra has marked no-return, so the
 * decompilation of `SpawnThrownWeapon` simply stops before it (`L35`), and
 * `ActorClearGameFields` runs on the line after `ActorAlloc`.
 *
 * ## The shot
 *
 * Every frame it draws, the weapon puts its view-space position in
 * `obj+0x70..0x78` and calls `RegisterForShotTest` — see `game/thrown_weapon.ts`
 * for the whole path. A marked weapon goes to state 1 on its next frame, bumps
 * `g_player_hit_count`, and **gives its thrower's permit back on the spot**:
 * the reason to shoot a knife is not only the life it would have cost but the
 * next enemy it lets in sooner. Nothing is scored.
 *
 * ## The trail
 *
 * A `zslman` blade leaves **afterimages** while it is in the air — launching,
 * flying, or cartwheeling away after it was shot — and stops the frame it
 * lands. `ZslmanBladeEmitAfterimage`, below, makes one every fifth
 * frame, under ten at a time, each a copy of the blade's pose that draws a
 * single-mesh model of its own (`0x1FE4` / `0x1FE5`, `zslman.bin` parts 13 and
 * 14, both additive) and dims over fifteen frames through
 * `SetRenderLightColour` (`FUN_004AA0A0`): 0.75 to below zero, so the last
 * few frames add nothing to the screen before it goes. They give their count
 * back as they go — but not once the blade is spent, so a blade that has been
 * shot down stops trailing after its tenth. `[proved]`
 */
import type { Rng } from "../../core/rng";
import { ActorByAt, G, HIT_SLOT_NONE } from "../globals";
import { PlayerTakeDamage } from "../combat/player";
import { ThrowerReleaseAttackPermit } from "../combat/permits";
import { SpawnSpriteEffect, SpriteEffectKind } from "../effects/sprite";
import { FtolS16, MatIdentity, MatrixTransformPoint } from "../matrix";
import {
  RegisterThrownWeaponForShotTest, ThrownWeaponAlloc, ThrownWeaponDespawn,
  ThrownWeaponDraw, ThrownWeaponDrawAndProject, ThrownWeaponFlag,
  ThrownWeaponRoutine, ThrownWeaponShotDownTarget, ThrownWeaponTakeMark,
  Vec3Normalize, SFX_RICOCHET, SHOT_DOWN_FRAMES, SHOT_DOWN_SPIN_SCALE,
  THROWN_WEAPON_DRAWN,
  type ThrownWeapon, type ThrownWeaponCamera, type ThrownWeaponFrame,
} from "../thrown_weapon";
import { ZombieThrownWeaponUpdate } from "../class30/thrown_weapon";
import { RegisterThrownWeaponForCameraTracking } from "../camera/slots";
import { ActorDrawGroundShadowWithSize } from "../ground_shadow";
import { VecToAngles } from "../vec";

/** `g_thrown_weapon_states` — `0x00592AE0`. Read as `40fd4400 50004500`. */
export enum ThrownWeaponState {
  /** `ThrownWeaponFlyToTarget`, the routine at `0x0044FD40`. */
  Fly = 0,
  /** `ThrownWeaponDeflected`, the routine at `0x00450050`. */
  Deflected = 1,
}

/**
 * `ThrownWeaponFlyToTarget`'s sub-states. The jump table at `0x00450030` has
 * five entries and **each arm runs straight on into the next**, so a launch
 * frame is also a flight frame and a landing frame is also a stuck one.
 */
export enum FlySub {
  Launch = 0,
  Flight = 1,
  Land = 2,
  Stick = 3,
  Blink = 4,
}

/**
 * `ThrownWeaponDeflected`'s sub-states, off the jump table at `0x004503B8`
 * (`6f004500 d3004500 34024500 5c024500`). The first three fall through too.
 */
export enum DeflectSub {
  /** The spark, the flags, the permit. */
  Struck = 0,
  /** Where it will fly, how fast it spins, the two sounds. */
  Aim = 1,
  /** Five frames hanging where it was hit. */
  Hang = 2,
  /** Away, until it gets there or three seconds pass. */
  Away = 3,
}

/** `mov dword ptr [esi+0x135c], 0x2400` at `0x0045072C`. BAMS a frame. */
export const THROWN_WEAPON_SPIN = 0x2400;
/**
 * `obj+0x133C = obj+0x1338 = 4` at `0x00450736`: the afterimage timers
 * `SpawnThrownWeapon` (`FUN_004504E0`) arms, so a `zslman` blade trails every
 * fifth frame.
 */
export const THROWN_WEAPON_AFTERIMAGE_PERIOD = 4;
/** `FMUL float ptr [0x00565EE8]` — `0x3F555555`, the flight time per unit. */
const TTL_PER_UNIT = 0.8333333134651184;
/** `FSUB float ptr [0x004C4380]` — one frame of flight. */
const TTL_STEP = 1.0;
/** `PlayerTakeDamage(obj+0x121, 1, 6)` — `PUSH 0x6` at `0x0044FE4C`. */
export const THROWER_WEAPON_HIT_KIND = 6;
/** `obj+0x1330 = 0x1E` at `0x0044FF5F`: frames stuck to the screen. */
const STICK_FRAMES = 0x1e;
/** `obj+0x1330 = 0x3C` at `0x0044FFBA`: frames blinking before it goes. */
const BLINK_FRAMES = 0x3c;
/** Bone 5, the right hand: its spin is added and its landing kick negated. */
const RIGHT_HAND = 5;
/** `zslman`'s blade out of hand 8 (`SpawnThrownWeapon`, `FUN_004504E0`). */
const ZSLMAN_BLADE_HAND8 = 0x1fe1;
/** ...and out of hand 5. */
const ZSLMAN_BLADE_HAND5 = 0x1fe2;
/** `zslman`'s two blades, the landing's other arm: `CMP EAX, 0x1FE1 / 0x1FE2`. */
const ZSLMAN_BLADES: readonly number[] = [ZSLMAN_BLADE_HAND8, ZSLMAN_BLADE_HAND5];
/** What hand 8's blade trails: `MOV [EBX+0x13F0], 0x1FE4` at `0x004509E0`. */
const ZSLMAN_AFTERIMAGE_HAND8 = 0x1fe4;
/** ...and hand 5's: `MOV [EBX+0x13F0], 0x1FE5` at `0x004509FC`. */
const ZSLMAN_AFTERIMAGE_HAND5 = 0x1fe5;
/**
 * `CMP word ptr [ESI+0x1F4], 0x18` (`6683bef401000018`) at `0x004508C2`: the
 * one character type whose weapon trails, `zslman`. `obj+0x1F4` is the
 * thrower's type, which `SpawnThrownWeapon` copies onto the weapon.
 */
const CHAR_ZSLMAN = 0x18;
/** `PUSH 0x40a00000` twice at `0x004508AF`: the shadow, 5.0 by 5.0. */
export const THROWN_WEAPON_SHADOW_SIZE = 5.0;
/** `CMP dword ptr [EBP+0x1368], 0xA` / `JGE` at `0x00450948`: under ten out. */
const AFTERIMAGE_LIMIT = 0xa;
/** `MOV dword ptr [EBX+0x1330], 0xF` at `0x0045099D`: its life. */
const AFTERIMAGE_LIFE = 0xf;
/** `MOV dword ptr [EBX+0x1384], 0x3F800000` at `0x004509A7`: its light. */
const AFTERIMAGE_LIGHT = 1.0;
/** `MOV ECX, 0x3F400000` at `0x004509D3`: a `zslman` blade's instead. */
const AFTERIMAGE_BLADE_LIGHT = 0.75;
/**
 * `MOV dword ptr [EBX+0x1388], 0x3D888889` at `0x004509B1` — a fifteenth, as
 * an f32, taken off the light every frame the afterimage draws.
 */
const AFTERIMAGE_LIGHT_STEP = 0.06666667014360428;
/** `zsass`'s two knives, which spark kind 3 when shot rather than 0x51. */
const ZSASS_KNIVES: readonly number[] = [0x1f90, 0x1f91];
/** `CMP word ptr [0x009C8E84], 0x2` — the two-permit game. */
const TWO_ATTACKERS = 2;
/** `ADD dword ptr [EDI], 0x8000` — half a turn. */
const HALF_TURN = 0x8000;
/** `PlaySoundId(0x5117A9)` — `COMMON2\KNIFE2_44.wav`, the launch. */
const SFX_KNIFE = 0x5117a9;
/** `PlaySoundId(0x5217A9)` — `COMMON2\KNIFE2_44_OFF.wav`, landing and deflect. */
const SFX_KNIFE_OFF = 0x5217a9;
/** `obj+0x1330 = 5` at `0x00450211`: frames it hangs where it was hit. */
const DEFLECT_HANG = 5;
/** `FMUL float ptr [0x00564708]` — `0x3F99999A`: speed, and the arrival box. */
const DEFLECT_SPEED = 1.2000000476837158;
/** `FMUL float ptr [0x00565EF0]` — `0xBF19999A`, -0.6: one gun's offset. */
const AIM_SIDE = -0.6000000238418579;
/** `MOV dword ptr [ESP + 0x1c], 0xc0800000` — four units down the view. */
const AIM_DEPTH = -4.0;

/** CRT `rand()` (`0x004ABE60`): 15 bits, from the world's generator. */
function rand(rng: Rng): number {
  return rng.int(0x8000);
}

/**
 * `AimThrownWeapon` — `FUN_004503D0`. The weapon's target: a point four units
 * down the camera's own -Z, taken into the world through the block's `+0x40`
 * matrix — straight ahead in a one-permit game, and 0.6 to the side of the
 * player whose permit the weapon holds in a two-permit one.
 *
 * ```
 * if (g_max_attackers == 1) p = (0, 0, -4)
 * else                      p = ((1 - 2 * obj+0x121) * -0.6, 0, -4)
 * obj+0x13C0..0x13C8 = g_camera_blocks[idx] + 0x40  *  p
 * ```
 *
 * It used to be the thrower's, flattened to the eye's height with no side
 * offset. It is the **weapon's** routine — `SpawnThrownWeapon` calls it on the
 * new object at `0x00450750`, and the stuck arms call it every frame to keep
 * the weapon glued to the screen — and it has no height of its own: a camera
 * looking down puts the point below the eye.
 */
export function AimThrownWeapon(w: ThrownWeapon,
                                cam: ThrownWeaponCamera | null): void {
  const p = G.g_max_attackers === 1
    ? { x: 0, y: 0, z: AIM_DEPTH }
    : { x: (1 - 2 * w.attackPermit) * AIM_SIDE, y: 0, z: AIM_DEPTH };
  MatrixTransformPoint(cam?.v2w ?? MatIdentity(), p, w.target);
}

/**
 * `ThrownWeaponFlyToTarget` — `FUN_0044FD40`, state 0.
 *
 * The launch solves a straight line: `ttl = |target - pos| * 0.8333`, the
 * velocity the difference over it, 1.2 units a frame. Each flight frame spins
 * and steps, and when `ttl` runs out **the player is hit, wherever the weapon
 * is** — `PlayerTakeDamage(obj+0x121, 1, 6)`: the hit is timed, not tested,
 * like the melee hit frame. Then it turns to face the camera, sticks to the
 * screen for thirty frames, blinks for sixty, gives the permit back and goes.
 */
export function ThrownWeaponFlyToTarget(w: ThrownWeapon,
                                        f: ThrownWeaponFrame): void {
  if (w.sub === FlySub.Launch) {
    const dx = w.target.x - w.pos.x;
    const dy = w.target.y - w.pos.y;
    const dz = w.target.z - w.pos.z;
    w.ttl = Math.sqrt(dx * dx + dy * dy + dz * dz) * TTL_PER_UNIT;
    w.vel.x = dx / w.ttl;
    w.vel.y = dy / w.ttl;
    w.vel.z = dz / w.ttl;
    f.events?.emit("sound.play", { id: SFX_KNIFE });
    w.sub = FlySub.Flight;
  }

  if (w.sub === FlySub.Flight) {
    // `CMP dword ptr [ESI + 0x1358], EBX` with `EBX = 5` (0x0044FDE1): the
    // right hand spins one way and anything else the other.
    w.ry = w.hand === RIGHT_HAND
      ? (w.ry + w.spinRate) | 0 : (w.ry - w.spinRate) | 0;
    w.pos.x += w.vel.x;
    w.pos.y += w.vel.y;
    w.pos.z += w.vel.z;
    w.ttl -= TTL_STEP;
    // `FCOMP [0.0]; TEST AH, 0x41; JZ` -- on while `ttl > 0`.
    if (w.ttl > 0) return;
    PlayerTakeDamage(w.attackPermit, 1, THROWER_WEAPON_HIT_KIND, f.events,
                     ActorByAt(w.from) ?? null, "thrown");
    w.sub = FlySub.Land;
  }

  if (w.sub === FlySub.Land) {
    ThrownWeaponLand(w, f);
    w.sub = FlySub.Stick;
  }

  if (w.sub === FlySub.Stick) {
    AimThrownWeapon(w, f.cam);
    w.pos.x = w.target.x; w.pos.y = w.target.y; w.pos.z = w.target.z;
    w.timer -= 1;
    if (w.timer > 0) return;
    w.sub = FlySub.Blink;
    w.timer = BLINK_FRAMES;
  }

  if (w.sub === FlySub.Blink) {
    AimThrownWeapon(w, f.cam);
    w.pos.x = w.target.x; w.pos.y = w.target.y; w.pos.z = w.target.z;
    // `obj+0x1330 & 0x80000001`, sign-corrected: an even count draws.
    if (w.timer % 2 === 0) w.drawFlags |= THROWN_WEAPON_DRAWN;
    else w.drawFlags &= ~THROWN_WEAPON_DRAWN;
    w.timer -= 1;
    if (w.timer > 0) return;
    ThrowerReleaseAttackPermit(w);
    ThrownWeaponDespawn(w);
  }
}

/**
 * The landing arm, `0x0044FE59`..`0x0044FF73` — one arm of
 * `ThrownWeaponFlyToTarget` (`0x0044FD40`), named here because it is the
 * pose the weapon keeps for the ninety frames it is stuck to the screen.
 *
 * ```
 * obj+0x34 |= 0x400C000
 * VecToAngles(eye.x - x, 0, eye.z - z) -> obj+0x64, obj+0x68; obj+0x64 = 0
 * zslman's blades:  a half turn for the other player's blade in a
 *                   two-permit game; then kick = -(rand() & 5) for bone 5,
 *                   +(rand() & 5) otherwise
 * everything else:  obj+0x64 += (1 - 2*(rand() % 2)) * (rand() & 2) * 0x100;
 *                   then the same kick
 * obj+0x68 += kick * 0x100; obj+0x1330 = 0x1E; KNIFE2_OFF
 * ```
 *
 * It faces the **eye** (`g_camera_eye_x/z`, `0x009C71E0` / `0x009C71E8`), not
 * the target, and keeps its `obj+0x1364` tilt. The port used to point the
 * model at the eye with a look-at of its own, which dropped the tilt and the
 * two kicks, and pitched it up at the lens as well.
 *
 * `[port-only]` as a function.
 */
function ThrownWeaponLand(w: ThrownWeapon, f: ThrownWeaponFrame): void {
  w.flags |= ThrownWeaponFlag.Spent | ThrownWeaponFlag.NoShotTest
    | ThrownWeaponFlag.Landed;
  const eye = G.g_camera_eye;
  const a = VecToAngles(eye.x - w.pos.x, 0, eye.z - w.pos.z);
  w.ry = FtolS16(a.yaw);
  w.rx = 0;
  let kick: number;
  if (ZSLMAN_BLADES.includes(w.slot)) {
    if (w.hand === RIGHT_HAND) {
      if (G.g_max_attackers === TWO_ATTACKERS && w.attackPermit === 1) {
        w.ry = (w.ry + HALF_TURN) | 0;
      }
      kick = -(rand(f.rng) & 5);
    } else {
      if (G.g_max_attackers === TWO_ATTACKERS && w.attackPermit === 0) {
        w.ry = (w.ry + HALF_TURN) | 0;
      }
      kick = rand(f.rng) & 5;
    }
  } else {
    const sign = 1 - 2 * (rand(f.rng) % 2);
    w.rx = (w.rx + sign * (rand(f.rng) & 2) * 0x100) | 0;
    kick = w.hand === RIGHT_HAND ? -(rand(f.rng) & 5) : rand(f.rng) & 5;
  }
  w.ry = (w.ry + kick * 0x100) | 0;
  w.timer = STICK_FRAMES;
  f.events?.emit("sound.play", { id: SFX_KNIFE_OFF });
}

/**
 * `ThrownWeaponDeflected` — `FUN_00450050`, state 1: shot out of the air.
 *
 * ```
 * sub 0  SpawnSpriteEffect(pos, zsass's knives ? 3 : 0x51, 1, -1)
 *        obj+0x34 |= 0x4008000; ThrowerReleaseAttackPermit(obj)
 * sub 1  obj+0x13C0 = a point up to 100 off its view position, into the world
 *        obj+0x135C = ftol(obj+0x135C * 1.3 * (1 - 2*(rand() % 2)))
 *        obj+0x1330 = 5; KNIFE2_OFF; BULLET_MET3
 * sub 2  hang there until --obj+0x1330 reaches zero
 * sub 3  fly at 1.2 a frame, spinning about **X** now, the sign by the hand;
 *        gone after 180 frames or inside 1.2 of the point on every axis
 * ```
 *
 * The arm that picks the point and the new spin ends in a `MatrixStackPop`
 * Ghidra marks no-return, so its decompilation stops at the point and loses
 * the spin, the counter, both sounds and the fall-through (`L35`):
 * `0x004501D1`..`0x0045022D` is where they are. The tumble switches axis — the
 * flight spun `obj+0x68`, this spins `obj+0x64` (`0x004502FF`..`0x0045031D`,
 * subtracted for bone 5) — which is what makes a deflected knife cartwheel away
 * rather than keep spinning flat. `[proved]`
 */
export function ThrownWeaponDeflected(w: ThrownWeapon,
                                      f: ThrownWeaponFrame): void {
  if (w.sub === DeflectSub.Struck) {
    const kind = ZSASS_KNIVES.includes(w.slot)
      ? SpriteEffectKind.Other : SpriteEffectKind.NoEffectType3;
    SpawnSpriteEffect({ x: w.pos.x, y: w.pos.y, z: w.pos.z }, 0, 0, kind, 1,
                      -1, f.host, f.events);
    w.flags |= ThrownWeaponFlag.Spent | ThrownWeaponFlag.NoShotTest;
    ThrowerReleaseAttackPermit(w);
    w.sub = DeflectSub.Aim;
  }

  if (w.sub === DeflectSub.Aim) {
    ThrownWeaponShotDownTarget(w, f.cam, () => rand(f.rng));
    const sign = 1 - 2 * (rand(f.rng) % 2);
    w.spinRate = Math.trunc(w.spinRate * SHOT_DOWN_SPIN_SCALE * sign) | 0;
    w.timer = DEFLECT_HANG;
    f.events?.emit("sound.play", { id: SFX_KNIFE_OFF });
    f.events?.emit("sound.play", { id: SFX_RICOCHET });
    w.sub = DeflectSub.Hang;
  }

  if (w.sub === DeflectSub.Hang) {
    w.timer -= 1;
    if (w.timer > 0) return;
    w.sub = DeflectSub.Away;
    w.timer = 0;
  }

  if (w.sub !== DeflectSub.Away) return;
  const d = { x: w.target.x - w.pos.x, y: w.target.y - w.pos.y,
              z: w.target.z - w.pos.z };
  const n = { x: 0, y: 0, z: 0 };
  Vec3Normalize(d, n);
  w.vel.x = n.x * DEFLECT_SPEED;
  w.vel.y = n.y * DEFLECT_SPEED;
  w.vel.z = n.z * DEFLECT_SPEED;
  w.pos.x += w.vel.x;
  w.pos.y += w.vel.y;
  w.pos.z += w.vel.z;
  w.rx = w.hand === RIGHT_HAND
    ? (w.rx - w.spinRate) | 0 : (w.rx + w.spinRate) | 0;
  w.timer += 1;
  // The box is tested on the distance **before** the step, and only when the
  // three seconds are not yet up; `FCOMP` against 1.2 with `TEST AH, 0x41`
  // stays while any axis is further.
  if (w.timer >= SHOT_DOWN_FRAMES
      || (Math.abs(d.x) <= DEFLECT_SPEED && Math.abs(d.y) <= DEFLECT_SPEED
          && Math.abs(d.z) <= DEFLECT_SPEED)) {
    ThrownWeaponDespawn(w);
  }
}

/**
 * `ThrownWeaponUpdate` — `FUN_00450780`. One weapon, one frame.
 *
 * ```
 * if ((obj+0x34 & 8) && !(obj+0x34 & 0x4000000)) {
 *     g_player_hit_count[obj+0x34 & 0x10 ? 1 : 0]++;  state = 1; sub = 0;
 * }
 * g_thrown_weapon_states[state](obj);
 * if (obj+0x1F8 & 1) { draw; obj+0x70 = view pos; RegisterForShotTest(obj);
 *                      ActorDrawGroundShadowWithSize(obj, 5.0, 5.0) }
 * if (obj+0x1F4 == 0x18 && (state == 0 && sub < 2 || state == 1))
 *     ZslmanBladeEmitAfterimage(obj);
 * if (state == 0) { obj+0x100 = pos; RegisterForCameraTracking(obj); }
 * ```
 *
 * The draw is not a tail the decompiler shows: it returns after
 * `MatrixStackPop` (`L35`), and the view point, the registration and the
 * shadow are `0x00450840`..`0x004508BF`, which then fall through to the
 * `zslman` test like the undrawn path does. The test reads the state and
 * sub-state the dispatch **left**, so a blade that launched this frame is
 * already at sub 1 and trails, and one that landed is at sub 3 and does not.
 *
 * A state routine that despawned the weapon never returns here: see
 * {@link ThrownWeaponDespawn}. So the weapon is not drawn on the frame it
 * goes, and makes no afterimage then.
 *
 * **The shadow** is `ActorDrawGroundShadowWithSize` (`FUN_0040A600`) at 5 by
 * 5, `0x004508AF`..`0x004508BA`: slot `0x10D0` in draw layer `0xD`, on the
 * floor traced three units above the weapon (its `obj+0x1F8` is 5, so bit 2
 * is up) and lifted 0.1 off it. It is drawn on every frame the weapon is,
 * the blink's on half included, and follows a knife stuck to the screen
 * along the ground under it.
 *
 * **The camera.** Every frame in state 0 -- launch, flight, stuck and blink
 * alike -- the weapon puts its position in `obj+0x100` and offers itself to
 * `RegisterForCameraTracking` (`FUN_00408EC0`), and `SpawnThrownWeapon`
 * (`FUN_004504E0`) already did once on the frame it was made. It carries its
 * thrower's permit, so the next slot fill deals it slot 0 or 1, and
 * `SelectCameraLookAtTarget` (`FUN_00403050`) looks at it -- at the midpoint
 * of it and whatever else holds a permit, the thrower included, which the
 * launch leaves holding 0. A weapon that has been shot down, in state 1, is
 * not offered. `[proved]`
 *
 * Both used to be left out, under a note that the port drew no ground shadow
 * for anything and that the camera's candidate list took only actors.
 */
export function ThrownWeaponUpdate(w: ThrownWeapon,
                                   f: ThrownWeaponFrame): void {
  ThrownWeaponTakeMark(w, ThrownWeaponState.Deflected);
  w.draw = null;
  w.shadow = null;
  switch (w.state as ThrownWeaponState) {
    case ThrownWeaponState.Fly: ThrownWeaponFlyToTarget(w, f); break;
    case ThrownWeaponState.Deflected: ThrownWeaponDeflected(w, f); break;
  }
  // `ActorKill`'s `_longjmp`: a despawn inside the state is the end of it.
  if (w.despawned) return;
  if (w.drawFlags & THROWN_WEAPON_DRAWN) {
    if (ThrownWeaponDrawAndProject(w, (w.tilt + w.rx) | 0, f.cam)) {
      RegisterThrownWeaponForShotTest(w);
    }
    w.shadow = ActorDrawGroundShadowWithSize(w, w.drawFlags,
                                             THROWN_WEAPON_SHADOW_SIZE,
                                             THROWN_WEAPON_SHADOW_SIZE,
                                             f.cam?.w2v ?? null);
  }
  if (w.charType === CHAR_ZSLMAN
      && ((w.state === ThrownWeaponState.Fly && w.sub < FlySub.Land)
          || w.state === ThrownWeaponState.Deflected)) {
    ZslmanBladeEmitAfterimage(w);
  }
  if (w.state === ThrownWeaponState.Fly) {
    w.lookAt.x = w.pos.x;
    w.lookAt.y = w.pos.y;
    w.lookAt.z = w.pos.z;
    RegisterThrownWeaponForCameraTracking(w);
  }
}

/**
 * `ZslmanBladeEmitAfterimage` — `FUN_00450930`. One more afterimage behind a
 * `zslman` blade, if it is time and there are fewer than ten.
 *
 * ```
 * if (--obj+0x1338 < 0) {                          // JNS at 0x00450942
 *     if (obj+0x1368 < 10) {
 *         a = ActorAlloc(ZslmanBladeAfterimageFade, 0x13F4); ActorClearGameFields(a)
 *         a+0x40..0x6C = obj+0x40..0x6C            // REP MOVSD, 12 dwords
 *         a+0x1390 = obj; a+0x135C = obj+0x135C; a+0x1364 = obj+0x1364
 *         a+0x1330 = 15; a+0x1384 = 1.0; a+0x1388 = 1/15; a+0x3C = -1
 *         a+0x13F0 = obj+0x13F0
 *         if (a+0x13F0 == 0x1FE1) { a+0x1384 = 0.75; a+0x13F0 = 0x1FE4 }
 *         if (a+0x13F0 == 0x1FE2) { a+0x1384 = 0.75; a+0x13F0 = 0x1FE5 }
 *         a+0x1368 = obj+0x1368; obj+0x1368++
 *     }
 *     obj+0x1338 = obj+0x133C
 * }
 * ```
 *
 * The count is decremented **before** the test, and the test is `JNS`, so
 * the launcher's 4 makes the first afterimage on the fifth call and every
 * fifth after it — not every fourth. The second model test reads the
 * afterimage's slot *after* the first has rewritten it, so it cannot fire on
 * a slot the first just made; transcribed as the two tests it is.
 *
 * `a+0x1390` is the weapon itself (`MOV [EBX+0x1390], EBP`), which is how the
 * afterimage finds the count to give back. `a+0x3C = -1` is "no hit slot" for
 * `ActorDespawn` (`FUN_00409CC0`), whose clear of `g_hit_slots` is gated on
 * `obj+0x38` bit `0x40` first, which nothing sets here — so the store has no
 * reader on this object, and is made anyway because it is the routine's.
 *
 * `ActorAlloc` (`FUN_004A6FA0`) links the new task at the **tail** of the
 * running one's sibling list, so it runs, and draws, on the frame it is made,
 * after its weapon: the port appends it to the list the pool is walking.
 * `[proved]`
 */
export function ZslmanBladeEmitAfterimage(w: ThrownWeapon): void {
  w.afterimageTimer -= 1;
  if (w.afterimageTimer >= 0) return;
  if (w.afterimages < AFTERIMAGE_LIMIT) {
    const a = ThrownWeaponAlloc(ThrownWeaponRoutine.ZslmanAfterimage);
    a.pos.x = w.pos.x; a.pos.y = w.pos.y; a.pos.z = w.pos.z;
    a.vel.x = w.vel.x; a.vel.y = w.vel.y; a.vel.z = w.vel.z;
    a.acc.x = w.acc.x; a.acc.y = w.acc.y; a.acc.z = w.acc.z;
    a.rx = w.rx; a.ry = w.ry; a.rz = w.rz;
    a.weapon = w.id;
    a.spinRate = w.spinRate;
    a.tilt = w.tilt;
    a.timer = AFTERIMAGE_LIFE;
    a.light = AFTERIMAGE_LIGHT;
    a.lightStep = AFTERIMAGE_LIGHT_STEP;
    a.hitSlot = HIT_SLOT_NONE;
    a.slot = w.slot;
    if (a.slot === ZSLMAN_BLADE_HAND8) {
      a.light = AFTERIMAGE_BLADE_LIGHT;
      a.slot = ZSLMAN_AFTERIMAGE_HAND8;
    }
    if (a.slot === ZSLMAN_BLADE_HAND5) {
      a.light = AFTERIMAGE_BLADE_LIGHT;
      a.slot = ZSLMAN_AFTERIMAGE_HAND5;
    }
    a.afterimages = w.afterimages;
    w.afterimages += 1;
    G.g_thrown_weapons.push(a);
  }
  w.afterimageTimer = w.afterimagePeriod;
}

/**
 * `ZslmanBladeAfterimageFade` — `FUN_00450A30`. One afterimage, one frame.
 *
 * ```
 * if (--obj+0x1330 >= 0 && !(weapon+0x34 & 0x4000)) {
 *     obj+0x1384 -= obj+0x1388
 *     MatrixStackPush(0); T(pos); Rz(obj+0x6C); Ry(obj+0x68)
 *     Rx(obj+0x1364 + obj+0x64)
 *     obj+0x13F0 is 0x1FE1 or 0x1FE2 ? SetRenderLightColour(0, 0, light)
 *                                    : SetRenderLightColour(light, light, light)
 *     AssetDrawSlot(obj+0x13F0); MatrixStackPop(1)
 *     return
 * }
 * if (!(weapon+0x34 & 0x4000000)) weapon+0x1368--
 * ActorDespawn(obj)
 * ```
 *
 * It stands where it was made — nothing here moves it — and draws the pose it
 * was given, dimmer each frame. It goes when its fifteen are up, or at once
 * when its blade has landed ({@link ThrownWeaponFlag.Landed}, raised only by
 * the landing arm at `0x0044FE64`). Either way it gives its place in the
 * blade's count back, unless the blade is {@link ThrownWeaponFlag.Spent} —
 * which the landing and the shot-down arm both make it.
 *
 * **The blue arm is not reached.** The light goes to red, green and blue
 * alike unless the model is `0x1FE1` or `0x1FE2`, and the emitter has already
 * swapped exactly those two for `0x1FE4` and `0x1FE5`: the only weapons that
 * trail are `zslman`'s, and those are the only two models they throw. So
 * every afterimage in the game is lit grey. `[proved]` — the arm is
 * transcribed anyway, because it is the routine's.
 *
 * **Its blade may be gone.** A blade shot out of the air despawns when it
 * reaches its point, with afterimages up to fifteen frames younger than that
 * still out. The engine reads the freed task's `+0x34` regardless:
 * `ActorKill` (`FUN_004A7040`) rewrites only the header's `+0x08`, `+0x0C`
 * and `+0x14`, so what it finds is the blade's last word — spent, not landed
 * — and the afterimage fades out its fifteen and returns nothing. The port
 * reads the record while it is in the list and that same answer when it is
 * not. `[likely]`: whether the block is handed to another `ActorAlloc` inside
 * those frames, and what that one writes at `+0x34`, is the allocator's and
 * is not modelled.
 */
export function ZslmanBladeAfterimageFade(a: ThrownWeapon,
                                          f: ThrownWeaponFrame): void {
  const weapon = G.g_thrown_weapons.find((x) => x.id === a.weapon);
  const weaponFlags = weapon ? weapon.flags : GONE_WEAPON_FLAGS;
  a.draw = null;
  a.lightColour = null;
  a.timer -= 1;
  if (a.timer >= 0 && !(weaponFlags & ThrownWeaponFlag.Landed)) {
    // `FLD [ESI+0x1384]; FSUB [ESI+0x1388]; FSTP [ESI+0x1384]`.
    a.light = Math.fround(a.light - a.lightStep);
    a.lightColour = ZSLMAN_BLADES.includes(a.slot)
      ? [0, 0, a.light] : [a.light, a.light, a.light];
    ThrownWeaponDraw(a, (a.tilt + a.rx) | 0, f.cam);
    return;
  }
  if (weapon && !(weaponFlags & ThrownWeaponFlag.Spent)) weapon.afterimages -= 1;
  ThrownWeaponDespawn(a);
}

/**
 * What an afterimage reads for a blade that is no longer in the list: the
 * word a shot-down blade leaves when it despawns — spent, not landed. See
 * {@link ZslmanBladeAfterimageFade}.
 */
const GONE_WEAPON_FLAGS = ThrownWeaponFlag.Spent;

/**
 * `[port-only]` The weapons' share of the task walk: each record runs the
 * routine its allocator installed, in allocation order, and a record despawned
 * on an earlier frame leaves first — the engine unlinks it, the port filters.
 *
 * A record made **during** the walk — an afterimage — is appended to the list
 * being walked and so runs on the frame it was made, after everything already
 * in it: the tail of the sibling list, which is where `ActorAlloc` links it.
 */
export function ThrownWeaponPoolUpdate(f: ThrownWeaponFrame): void {
  if (G.g_thrown_weapons.some((w) => w.despawned)) {
    G.g_thrown_weapons = G.g_thrown_weapons.filter((w) => !w.despawned);
  }
  const list = G.g_thrown_weapons;
  for (let i = 0; i < list.length; i++) {
    const w = list[i]!;
    switch (w.routine) {
      case ThrownWeaponRoutine.Thrower: ThrownWeaponUpdate(w, f); break;
      case ThrownWeaponRoutine.Zombie: ZombieThrownWeaponUpdate(w, f); break;
      case ThrownWeaponRoutine.ZslmanAfterimage:
        ZslmanBladeAfterimageFade(w, f); break;
    }
  }
}
