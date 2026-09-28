/**
 * Class 0x30's weapon — the axe `tutorial` and `znonoopa` throw flat, and the
 * two curved blades `znassb` lobs — once it has left the hand.
 *
 * `ZombieThrownWeaponUpdate`, at `0x0045A4F0`, is the task `ZombieThrowHandWeapon`
 * (`FUN_0045A240`) installs, and it is referenced by nothing else: no class id,
 * no `g_class_handlers` entry. It runs one of four states out of
 * `g_zombie_thrown_weapon_states` (`0x00593170`, read as
 * `10084200 90964500 f0984500 209d4500`) and then draws.
 *
 * ## The spin, which is not one spin
 *
 * | weapon | state | rate (`obj+0x135C`) | term | axis |
 * |---|---|---|---|---|
 * | the axe, `0x249` | 1, straight | `0xB00` (`0x0045A427`) | `obj+0x64` (`0x00459731`) | **X** |
 * | `znassb`'s blades | 2, arc | `0x1600` (`0x0045A43C`) | `obj+0x68` (`0x00459998`) | **Y** |
 *
 * Both unsigned by the hand. And the weapon does not start square: the
 * launcher points it at its target — `VecToAngles(target - pos)` into
 * `obj+0x64` and `obj+0x68` — and rolls it `0x800` (`MOV dword ptr [ESI+0x6c],
 * 0x800` at `0x0045A4C4`). `[proved]`
 *
 * The port had both families tumbling at its own `0x200` and both of this
 * family's weapons about X, on a reading of the straight state alone; the arc
 * state is the other axis. The draw is `Rz(obj+0x6C) · Ry(obj+0x68) ·
 * Rx(obj+0x64)` — **no** `obj+0x1364` term, which is class 0x31's alone
 * (`0x0045A58C`..`0x0045A590`, `MOV EAX, [ESI+0x64]; PUSH EAX; CALL
 * MatrixRotateX`); the note that said otherwise was harmless only because
 * nothing writes the field here.
 *
 * ## The shot
 *
 * The same as class 0x31's: registered for the shot test every frame it
 * draws, taken whole as a two-unit sphere, and a marked weapon goes to state 3,
 * `ZombieThrownWeaponStateShotDown`, on its next frame. That was the one
 * routine of the family the port had named and not ported.
 */
import { ActorByAt } from "../globals";
import { PlayerTakeDamage } from "../combat/player";
import { ReleaseAttackSlot } from "../combat/permits";
import { SpawnSpriteEffect, SpriteEffectKind } from "../effects/sprite";
import { AngleWithinTolerance } from "../actor_turn";
import { FtolS16, MatIdentity, MatrixTransformPoint } from "../matrix";
import {
  RegisterThrownWeaponForShotTest, ThrownWeaponDespawn,
  ThrownWeaponDrawAndProject, ThrownWeaponFlag, ThrownWeaponShotDownTarget,
  ThrownWeaponTakeMark, Vec3Normalize, SFX_RICOCHET, SHOT_DOWN_FRAMES,
  SHOT_DOWN_SPIN_SCALE, THROWN_WEAPON_DRAWN, type ThrownWeapon,
  type ThrownWeaponCamera, type ThrownWeaponFrame,
} from "../thrown_weapon";
import { VecToAngles, type Vec3 } from "../vec";

/** `g_zombie_thrown_weapon_states` — `0x00593170`. */
export enum ZombieThrownWeaponState {
  /** `PoseHookNone` (`FUN_00420810`) — a bare `RET`. Nothing ever sets it. */
  None = 0,
  /** `ZombieThrownWeaponStateStraight`, at `0x00459690` — the axe. */
  Straight = 1,
  /** `ZombieThrownWeaponStateArc`, at `0x004598F0` — everything else. */
  Arc = 2,
  /** `ZombieThrownWeaponStateShotDown`, at `0x00459D20`. */
  ShotDown = 3,
}

/**
 * The flight states' sub-states, shared by straight and arc — their jump
 * tables (`0x004598D0`, `0x00459B5C`) have five arms each, laid out alike, and
 * every arm but the last runs on into the next.
 */
export enum ZombieFlySub {
  Launch = 0,
  Flight = 1,
  Land = 2,
  Stick = 3,
  Blink = 4,
}

/** `ZombieThrownWeaponStateShotDown`'s, off `0x0045A060`. */
export enum ZombieShotDownSub {
  Struck = 0,
  Aim = 1,
  Hang = 2,
  Away = 3,
}

/** `znonoo.bin` part 0: `CMP ECX, 0x249` at `0x0045A3FD`. The axe. */
export const ZOMBIE_AXE_SLOT = 0x249;
/** `obj+0x135C = 0xB00` for the axe (`c7865c130000000b0000`, `0x0045A427`). */
export const ZOMBIE_AXE_SPIN = 0xb00;
/** `obj+0x135C = 0x1600` for the rest (`c7865c13000000160000`, `0x0045A43C`). */
export const ZOMBIE_BLADE_SPIN = 0x1600;
/** `obj+0x6C = 0x800` at `0x0045A4C4`: the roll every one leaves the hand at. */
export const ZOMBIE_WEAPON_ROLL = 0x800;
/** `PlayerTakeDamage(obj+0x121, 1, 4)` — `PUSH 0x4` at `0x0045977E`. */
const STRAIGHT_HIT_KIND = 4;
/** `PlayerTakeDamage(obj+0x121, 1, 6)` — `PUSH 0x6` at `0x00459A07`. */
const ARC_HIT_KIND = 6;
/** `FSUB float ptr [0x004C4380]` — one frame of flight. */
const TTL_STEP = 1.0;
/** `obj+0x1330 = 0x1E`, then `0x3C`: stuck, then blinking. */
const STICK_FRAMES = 0x1e;
const BLINK_FRAMES = 0x3c;
/** `ADD dword ptr [EDI], 0x8000` at `0x004597C9`: the landing faces back. */
const HALF_TURN = 0x8000;
/** The right hand: `CMP EAX, 0x5` at `0x00459940`. */
const RIGHT_HAND = 5;
/**
 * `0x3C1374BC` — 0.009, the arc's acceleration, `0xBC1374BC` for any hand but
 * bone 5 (`0x0045994B` / `0x00459955`).
 */
const ARC_GRAVITY = 0.008999999612569809;
/** `PUSH 0x3F800000` at `0x00459968`: the arc's speed, a literal 1.0. */
const ARC_SPEED = 1.0;
/** `obj+0x1330 = 5` at `0x00459EBD`. */
const SHOT_DOWN_HANG = 5;
/** `FMUL float ptr [0x00565EF0]` — -0.6, one gun's offset. */
const AIM_SIDE = -0.6000000238418579;
/** `0xBFC00000` — how far below the eye the axe is aimed. */
const AXE_DROP = -1.5;
/** `0xC0800000` — four units down the view. */
const AIM_DEPTH = -4.0;
/** `PlaySoundId(0x4F17A9)` — `COMMON2\KNIFE1_44.wav`, the launch. */
const SFX_KNIFE = 0x4f17a9;
/** `PlaySoundId(0x5017A9)` — `COMMON2\KNIFE1_44_OFF.wav`. */
const SFX_KNIFE_OFF = 0x5017a9;

/** CRT `rand()` (`0x004ABE60`): 15 bits, from the world's generator. */
function rand(f: ThrownWeaponFrame): number {
  return f.rng.int(0x8000);
}

/**
 * `ZombieThrownWeaponAimAtCamera` — `FUN_0045A070`. Where the weapon is
 * aimed: a point in **camera space**, into the world through the camera
 * block's `+0x40` matrix.
 *
 * ```
 * side = obj+0x1360 == 1 ? 0 : (1 - 2 * obj+0x121) * -0.6
 * p    = the axe ? (side, -1.5, -4) : (side, 0, -4)
 * ```
 *
 * `obj+0x1360` is `g_max_attackers` latched at the throw. The drop is in the
 * camera's own space, not the world's: it used to be subtracted from the eye's
 * height, with the side taken along the camera's yaw, which is the same point
 * only while the camera looks level.
 */
export function ZombieThrownWeaponAimAtCamera(w: ThrownWeapon,
                                              cam: ThrownWeaponCamera | null):
    void {
  const side = w.maxAttackers === 1 ? 0 : (1 - 2 * w.attackPermit) * AIM_SIDE;
  const p = { x: side, y: w.slot === ZOMBIE_AXE_SLOT ? AXE_DROP : 0,
              z: AIM_DEPTH };
  MatrixTransformPoint(cam?.v2w ?? MatIdentity(), p, w.target);
}

/**
 * The landing arm the two flight states share byte for byte bar the hit kind:
 * `0x0045978B`..`0x00459814` in the straight one and `0x00459A14`..`0x00459A9D`
 * in the arc. `[port-only]` as a function.
 *
 * ```
 * obj+0x34 |= 0x4008000
 * VecToAngles(target.x - x, 0, target.z - z) -> obj+0x64, obj+0x68
 * obj+0x68 += 0x8000
 * obj+0x64 += (1 - 2*(rand() % 2)) * (rand() & 2) * 0x100
 * obj+0x1330 = 0x1E; KNIFE1_OFF
 * ```
 *
 * The heading is taken to the **target** it has just reached, not to the eye
 * the way class 0x31's is; the pitch `VecToAngles` writes replaces the flight's
 * accumulated tumble outright.
 */
function ZombieThrownWeaponLand(w: ThrownWeapon, f: ThrownWeaponFrame): void {
  w.flags |= ThrownWeaponFlag.Spent | ThrownWeaponFlag.NoShotTest;
  const a = VecToAngles(w.target.x - w.pos.x, 0, w.target.z - w.pos.z);
  w.rx = FtolS16(a.pitch);
  w.ry = (FtolS16(a.yaw) + HALF_TURN) | 0;
  const sign = 1 - 2 * (rand(f) % 2);
  w.rx = (w.rx + sign * (rand(f) & 2) * 0x100) | 0;
  w.timer = STICK_FRAMES;
  f.events?.emit("sound.play", { id: SFX_KNIFE_OFF });
}

/**
 * Subs 3 and 4 of both flight states, also identical: stuck to the screen,
 * then blinking, then the permit goes back and the weapon with it.
 * `[port-only]` as a function.
 */
function ZombieThrownWeaponStickAndBlink(w: ThrownWeapon,
                                         f: ThrownWeaponFrame): void {
  if (w.sub === ZombieFlySub.Stick) {
    ZombieThrownWeaponAimAtCamera(w, f.cam);
    w.pos.x = w.target.x; w.pos.y = w.target.y; w.pos.z = w.target.z;
    w.timer -= 1;
    if (w.timer > 0) return;
    w.sub = ZombieFlySub.Blink;
    w.timer = BLINK_FRAMES;
  }
  if (w.sub !== ZombieFlySub.Blink) return;
  ZombieThrownWeaponAimAtCamera(w, f.cam);
  w.pos.x = w.target.x; w.pos.y = w.target.y; w.pos.z = w.target.z;
  if (w.timer % 2 === 0) w.drawFlags |= THROWN_WEAPON_DRAWN;
  else w.drawFlags &= ~THROWN_WEAPON_DRAWN;
  w.timer -= 1;
  if (w.timer > 0) return;
  // `ReleaseAttackSlot` (`FUN_00456520`) — the class-0x30 release, bit
  // `0x20000` — at `0x004598C0`, then `ActorDespawn`.
  ReleaseAttackSlot(w);
  ThrownWeaponDespawn(w);
}

/**
 * `ZombieThrownWeaponStateStraight` — `FUN_00459690`, state 1: the axe.
 *
 * `ttl = |target - pos| / obj+0x1370` and the velocity from it; each flight
 * frame steps and tumbles `obj+0x64 += obj+0x135C` — **X**, no sign test on
 * the hand (`0x00459731`); on `ttl` running out, `PlayerTakeDamage(obj+0x121,
 * 1, 4)` wherever it is. Then the landing, the stick and the blink.
 */
export function ZombieThrownWeaponStateStraight(w: ThrownWeapon,
                                                f: ThrownWeaponFrame): void {
  if (w.sub === ZombieFlySub.Launch) {
    const dx = w.target.x - w.pos.x;
    const dy = w.target.y - w.pos.y;
    const dz = w.target.z - w.pos.z;
    w.ttl = Math.sqrt(dx * dx + dy * dy + dz * dz) / w.speed;
    w.vel.x = dx / w.ttl;
    w.vel.y = dy / w.ttl;
    w.vel.z = dz / w.ttl;
    f.events?.emit("sound.play", { id: SFX_KNIFE });
    w.sub = ZombieFlySub.Flight;
  }
  if (w.sub === ZombieFlySub.Flight) {
    w.pos.x += w.vel.x;
    w.rx = (w.rx + w.spinRate) | 0;
    w.pos.y += w.vel.y;
    w.pos.z += w.vel.z;
    w.ttl -= TTL_STEP;
    if (w.ttl > 0) return;
    PlayerTakeDamage(w.attackPermit, 1, STRAIGHT_HIT_KIND, f.events,
                     ActorByAt(w.from) ?? null, "thrown");
    w.sub = ZombieFlySub.Land;
  }
  if (w.sub === ZombieFlySub.Land) {
    ZombieThrownWeaponLand(w, f);
    w.sub = ZombieFlySub.Stick;
  }
  ZombieThrownWeaponStickAndBlink(w, f);
}

/**
 * `ZombieThrownWeaponBeginArc` — `FUN_00459B70`. The lob's velocity.
 *
 * The heading is taken **from the thrower**, `obj+0x1390`'s position, to the
 * target, and it picks the axis the curve bends along:
 *
 * ```
 * along Z (within 0x2000 of 0 or 0x8000):  t = |(dy, dz)| / speed
 *     acc = (g, 0, 0); vel = ((2dx - g t^2) / 2t, dy / t, dz / t)
 * otherwise:                               t = |(dx, dy)| / speed
 *     acc = (0, 0, g); vel = (dx / t, dy / t, (2dz - g t^2) / 2t)
 * ```
 *
 * So the curve bends **across** the direction of the throw — a blade thrown
 * down Z swings out along X and comes back in — and the flight time is the
 * distance in the other two axes. Four `AngleWithinTolerance` (`FUN_0040A040`)
 * calls, of which the `0x4000` and `0xC000` answers go nowhere (`TEST EAX,
 * EAX; JZ` to the next line at `0x00459BC5`, and `XOR EDI, EDI` into an `EDI`
 * that is already 0 at `0x00459BE2`): the choice is the `0` and `0x8000`
 * windows alone. `[proved]`
 *
 * The port used to solve this at the spawn, with the choice the other way
 * round (the curve along the axis the throw runs down), the full distance for
 * the time, and the thrower's standing speed where the routine passes 1.0.
 */
export function ZombieThrownWeaponBeginArc(w: ThrownWeapon, from: Vec3,
                                           to: Vec3, g: number,
                                           speed: number): number {
  const thrower = ActorByAt(w.from);
  // The engine reads `obj+0x1390`'s position whatever it is; the thrower is
  // always there on the frame this runs, which is the frame it threw.
  const ox = thrower?.pos.x ?? from.x;
  const oz = thrower?.pos.z ?? from.z;
  const yaw = FtolS16(VecToAngles(w.target.x - ox, 0, w.target.z - oz).yaw);
  AngleWithinTolerance(yaw, 0x4000, 0x2000);
  AngleWithinTolerance(yaw, 0xc000, 0x2000);
  const alongZ = AngleWithinTolerance(yaw, 0, 0x2000)
    || AngleWithinTolerance(yaw, 0x8000, 0x2000);
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
  let t: number;
  if (alongZ) {
    t = Math.sqrt(dz * dz + dy * dy) / speed;
    w.acc.x = g; w.acc.y = 0; w.acc.z = 0;
    w.vel.x = (dx + dx + g * -1.0 * t * t) / (t + t);
    w.vel.y = dy / t;
    w.vel.z = dz / t;
  } else {
    t = Math.sqrt(dx * dx + dy * dy) / speed;
    w.acc.x = 0; w.acc.y = 0; w.acc.z = g;
    w.vel.x = dx / t;
    w.vel.y = dy / t;
    w.vel.z = (g * -1.0 * t * t + (dz + dz)) / (t + t);
  }
  return t;
}

/**
 * `ZombieThrownWeaponStateArc` — `FUN_004598F0`, state 2: `znassb`'s blades.
 *
 * `ZombieThrownWeaponBeginArc` with `±0.009` by the hand and a speed of 1.0;
 * each flight frame adds the acceleration into the velocity, tumbles
 * `obj+0x68 += obj+0x135C` — **Y** (`0x00459998`) — and steps; on arrival
 * `PlayerTakeDamage(obj+0x121, 1, 6)`. Then the same landing, stick and blink
 * as the straight one.
 */
export function ZombieThrownWeaponStateArc(w: ThrownWeapon,
                                           f: ThrownWeaponFrame): void {
  if (w.sub === ZombieFlySub.Launch) {
    const g = w.hand === RIGHT_HAND ? ARC_GRAVITY : -ARC_GRAVITY;
    w.ttl = ZombieThrownWeaponBeginArc(w, { ...w.pos }, { ...w.target }, g,
                                       ARC_SPEED);
    f.events?.emit("sound.play", { id: SFX_KNIFE });
    w.sub = ZombieFlySub.Flight;
  }
  if (w.sub === ZombieFlySub.Flight) {
    w.vel.x += w.acc.x;
    w.ry = (w.ry + w.spinRate) | 0;
    w.vel.y += w.acc.y;
    w.vel.z += w.acc.z;
    w.pos.x += w.vel.x;
    w.pos.y += w.vel.y;
    w.pos.z += w.vel.z;
    w.ttl -= TTL_STEP;
    if (w.ttl > 0) return;
    PlayerTakeDamage(w.attackPermit, 1, ARC_HIT_KIND, f.events,
                     ActorByAt(w.from) ?? null, "thrown");
    w.sub = ZombieFlySub.Land;
  }
  if (w.sub === ZombieFlySub.Land) {
    ZombieThrownWeaponLand(w, f);
    w.sub = ZombieFlySub.Stick;
  }
  ZombieThrownWeaponStickAndBlink(w, f);
}

/**
 * `ZombieThrownWeaponStateShotDown` — `FUN_00459D20`, state 3: the player shot
 * it out of the air.
 *
 * Class 0x31's `ThrownWeaponDeflected` (`FUN_00450050`) with three
 * differences: sprite kind `0x52` for every weapon, `KNIFE1_OFF` rather than
 * `KNIFE2_OFF`, and the flight away at **`obj+0x1370`** — the throw's own
 * speed — with that same number as the arrival box, where class 0x31 has a
 * literal 1.2. The spin still goes up by 1.3 with a random sign and turns
 * about X, and this family adds it with no hand test.
 *
 * ```
 * sub 0  SpawnSpriteEffect(pos, 0x52, 1, -1); obj+0x34 |= 0x4008000;
 *        ReleaseAttackSlot(obj)
 * sub 1  obj+0x13C0 = up to 100 off its view position, into the world
 *        obj+0x135C = ftol(obj+0x135C * 1.3 * (1 - 2*(rand() % 2)))
 *        obj+0x1330 = 5; KNIFE1_OFF; BULLET_MET3
 * sub 2  hang for the five
 * sub 3  fly at obj+0x1370; gone after 180 frames or inside the box
 * ```
 *
 * The decompilation of sub 1 stops at its `MatrixStackPop` (`L35`); the spin,
 * the counter and the two sounds are `0x00459E7D`..`0x00459ED9`.
 */
export function ZombieThrownWeaponStateShotDown(w: ThrownWeapon,
                                                f: ThrownWeaponFrame): void {
  if (w.sub === ZombieShotDownSub.Struck) {
    SpawnSpriteEffect({ x: w.pos.x, y: w.pos.y, z: w.pos.z }, 0, 0,
                      SpriteEffectKind.DeflectedWeapon, 1, -1, f.host,
                      f.events);
    w.flags |= ThrownWeaponFlag.Spent | ThrownWeaponFlag.NoShotTest;
    ReleaseAttackSlot(w);
    w.sub = ZombieShotDownSub.Aim;
  }
  if (w.sub === ZombieShotDownSub.Aim) {
    ThrownWeaponShotDownTarget(w, f.cam, () => rand(f));
    const sign = 1 - 2 * (rand(f) % 2);
    w.spinRate = Math.trunc(w.spinRate * SHOT_DOWN_SPIN_SCALE * sign) | 0;
    w.timer = SHOT_DOWN_HANG;
    f.events?.emit("sound.play", { id: SFX_KNIFE_OFF });
    f.events?.emit("sound.play", { id: SFX_RICOCHET });
    w.sub = ZombieShotDownSub.Hang;
  }
  if (w.sub === ZombieShotDownSub.Hang) {
    w.timer -= 1;
    if (w.timer > 0) return;
    w.sub = ZombieShotDownSub.Away;
    w.timer = 0;
  }
  if (w.sub !== ZombieShotDownSub.Away) return;
  const d = { x: w.target.x - w.pos.x, y: w.target.y - w.pos.y,
              z: w.target.z - w.pos.z };
  const n = { x: 0, y: 0, z: 0 };
  Vec3Normalize(d, n);
  w.vel.x = w.speed * n.x;
  w.vel.y = w.speed * n.y;
  w.vel.z = w.speed * n.z;
  w.rx = (w.rx + w.spinRate) | 0;
  w.timer += 1;
  w.pos.x += w.vel.x;
  w.pos.y += w.vel.y;
  w.pos.z += w.vel.z;
  if (w.timer >= SHOT_DOWN_FRAMES
      || (Math.abs(d.x) <= w.speed && Math.abs(d.y) <= w.speed
          && Math.abs(d.z) <= w.speed)) {
    ThrownWeaponDespawn(w);
  }
}

/**
 * `ZombieThrownWeaponUpdate` — `FUN_0045A4F0`. One weapon, one frame.
 *
 * The hit test, the state, then — while `obj+0x1F8` bit 0 is up — the draw,
 * `obj+0x70` and `RegisterForShotTest` (`0x0045A562`..`0x0045A612`), which is
 * the same tail as class 0x31's with no `obj+0x1364` in the X term.
 *
 * `[diverges]` Two calls are not made, for the reasons
 * `ThrownWeaponUpdate` (`FUN_00450780`) gives for its own: the 5-by-5 ground
 * shadow at `0x0045A622`, and `RegisterForCameraTracking` for states 1 and 2
 * at `0x0045A676`, which lifts the axe's point by 1.5 first.
 */
export function ZombieThrownWeaponUpdate(w: ThrownWeapon,
                                         f: ThrownWeaponFrame): void {
  ThrownWeaponTakeMark(w, ZombieThrownWeaponState.ShotDown);
  switch (w.state as ZombieThrownWeaponState) {
    case ZombieThrownWeaponState.Straight:
      ZombieThrownWeaponStateStraight(w, f); break;
    case ZombieThrownWeaponState.Arc:
      ZombieThrownWeaponStateArc(w, f); break;
    case ZombieThrownWeaponState.ShotDown:
      ZombieThrownWeaponStateShotDown(w, f); break;
    case ZombieThrownWeaponState.None:
      break;
  }
  w.draw = null;
  if (w.drawFlags & THROWN_WEAPON_DRAWN) {
    if (ThrownWeaponDrawAndProject(w, w.rx, f.cam)) {
      RegisterThrownWeaponForShotTest(w);
    }
  }
}
