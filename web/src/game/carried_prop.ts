/**
 * The thing a class-0x30 zombie in state 37 is carrying — stage 3's drums on
 * the bridge, and the barrel-throwers of stages 1 and 2.
 *
 * `ZombieStateCarryProp` (`FUN_0045B380`) allocates a 0x19C-byte object with
 * **no class id** — `ActorAlloc(CarriedPropInit, 0x19C)` — so, like the
 * creature `znjoe` releases and the thrown weapon, it is reached only through
 * that allocation and has no `SpawnClass`. What it is is decided by the
 * state-37 script (the descriptor tail's `+0x04` blob): `+0x00` indexes
 * `g_carried_prop_types`, `+0x04` picks the `g_prop_behaviours` entry it
 * starts in, and `+0x08` the entry the throw hands it to.
 *
 * ## The life of one, as the engine runs it
 *
 * 1. `CarriedPropInit` (`FUN_00442740`): hit points, radii and a draw slot
 *    from the type record; the offset in the hands, the spin and the launch
 *    words from the script.
 * 2. `CarriedPropHeldUpdate` (`FUN_00442820`, `g_prop_behaviours[1]`): seated
 *    between the carrier's bones 4 and 7 every frame, and **shootable** —
 *    `RegisterForShotTest` is called — but nothing reads the hit bit yet.
 * 3. On the carrier's cue frame `ZombieStateCarryProp` writes the release
 *    mode into `sub+0x10`, and the held routine's next frame calls
 *    `CarriedPropRelease` (`FUN_00442B90`): into the world, and for mode 4 a
 *    ballistic launch that lands fifteen units in front of the camera after
 *    `script +0x24` frames.
 * 4. `CarriedPropThrowAtCamera` (`FUN_00443B90`, `g_prop_behaviours[4]`)
 *    flies it. Each frame it is shot-tested and `CarriedPropCheckShot`
 *    (`FUN_004423F0`) takes a hit point per hit and steps the draw slot down;
 *    at zero it **breaks** (`CarriedPropBreakUpdate`, `FUN_00444EE0`). If it
 *    arrives with hit points left it costs the player a life and sticks to the
 *    screen for ninety frames (`CarriedPropStuckToScreen`, `FUN_00444160`),
 *    which is where the attack permit the carrier claimed is finally given
 *    back.
 *
 * ## Spaces
 *
 * The engine keeps this object's position in whichever space the current
 * routine draws in, and the port keeps it the same way: **view space** while
 * held (the routine starts from `MatrixLoadIdentity` and the bone matrices it
 * reads are the carrier's view-space draw records) and while stuck to the
 * screen, **world space** in flight. `g_camera_world_to_view` (`0x009A6000`)
 * and its inverse `g_camera_blocks` (`0x009A6040`) are the two matrices it
 * crosses with, and they come across the seam as
 * {@link GameHost.cameraMatrices}. What the renderer is handed is the
 * engine's own draw matrix and which of the two spaces it is in.
 *
 * ## Why plain records in `G`
 *
 * Same answer as `g_body_creatures`: the engine allocates a task, the port
 * keeps a fixed pool whose every slice survives `clonePlain`, and there is no
 * class id to key a handler on.
 */
import type { Events } from "../core/events";
import type { Rng } from "../core/rng";
import type { TargetScriptJson } from "../bundle/characters";
import { ActorFlag, type Actor } from "./actor";
import { PlayerTakeDamage } from "./combat/player";
import { ActorByAt, G } from "./globals";
import type { GameHost } from "./host";
import {
  FtolS16, MatCopy, MatIdentity, MatrixGetTranslation, MatrixLoadIdentity,
  MatrixMultiply, MatrixRotateX, MatrixRotateY, MatrixRotateZ,
  MatrixInvert, MatrixRotateAxis, MatrixToEulerZYX, MatrixTransformPoint,
  MatrixTransformVector, MatrixTranslate, RADIANS_TO_BAMS, VecAimXAxisYThenZ,
  VecAngleBetween, type Mat,
} from "./matrix";
import { QueryGroundHeightAt } from "./coli";
import { RegisterPropForCameraTracking } from "./camera/slots";
import { T } from "./tables";
import { EffectNodePoseAt } from "./class44/script_flag_effect";
import { PROJECTION_DISTANCE_PX } from "./combat/permits";
import { PropBehaviour } from "./class13";
import { vec3, VecToAngles, type Vec3 } from "./vec";

/**
 * Which routine is installed at `obj+0x00`.
 *
 * The four `g_prop_behaviours` entries keep the table's own numbers — the
 * script's `+0x04` and `+0x08` are indices into it — and the routines the
 * behaviours install for themselves, which have no index, are numbered past
 * the table's end. `[port-only]` for those four.
 */
export enum CarriedPropRoutine {
  /** `CarriedPropInit` (`FUN_00442740`) — the first update. */
  Init = -1,
  /** `CarriedPropHeldUpdate` (`FUN_00442820`), `g_prop_behaviours[1]`. */
  Held = PropBehaviour.CarriedPropHeld,
  /** `CarriedPropThrowAtTarget` (`FUN_004432D0`), `g_prop_behaviours[3]`. */
  ThrowAtTarget = PropBehaviour.CarriedPropThrowAtTarget,
  /** `CarriedPropThrowAtCamera` (`FUN_00443B90`), `g_prop_behaviours[4]`. */
  ThrowAtCamera = PropBehaviour.CarriedPropThrowAtCamera,
  /** `CarriedPropRollAtCamera` (`FUN_00443DC0`), `g_prop_behaviours[5]`. */
  RollAtCamera = PropBehaviour.CarriedPropRollAtCamera,
  /** `CarriedPropStuckToScreen` (`FUN_00444160`). */
  StuckToScreen = 16,
  /** `CarriedPropFallFree` (`FUN_00444D80`), installed by the drop. */
  FallFree = 17,
  /** `CarriedPropBreakUpdate` (`FUN_00444EE0`). */
  Break = 18,
}

/** `sub+0x10 == 10`: still in the hands. Anything else is the release mode. */
export const CARRIED_PROP_HELD = 10;

/** One record of `g_carried_prop_types`. */
export interface CarriedPropType {
  /** s16 `+0x00` — the break effect's model, `sub+0x44`. */
  breakModel: number;
  /** s16 `+0x02` — the break effect's motion, `sub+0x48`. */
  breakMotion: number;
  /**
   * `g_motion_play_length[breakMotion]` (`0x004E07D0`), read out of `.data`:
   * `0x1E` for motion 463 at `0x004E0B6E`, `0x46` for 474 at `0x004E0B84`.
   * The break lasts that many frames less one.
   */
  breakPlay: number;
  /** f32 `+0x04` — `obj+0x124`, the sphere `ShotTestSphere` tests. */
  radius: number;
  /** f32 `+0x08` — `obj+0x128`. */
  bodyRadius: number;
  /**
   * f32 `+0x0C`, `+0x10`, `+0x14` — what `CarriedPropGroundContact` measures
   * the prop with: the drop from its centre to the ground, the same from each
   * end, and the half-length from the centre to each end along its own +X.
   */
  contactCentre: number;
  contactEnd: number;
  halfLength: number;
  /** u32 `+0x18` — the sound a hit that does not break it plays. */
  hitSound: number;
  /** u32 `+0x1C` — the sound the last hit plays. */
  breakSound: number;
  /** s16 `+0x20` — hit points. */
  hp: number;
  /** s16 `+0x20 + hp*2` — the draw slot for each remaining hit point. */
  slots: Record<number, number>;
}

/**
 * `g_carried_prop_types` — `0x005644D8`. Three pointers, to 0x28-byte records
 * at `0x00564460`, `0x00564488` and `0x005644B0`, read out of `.rdata`:
 *
 * ```
 * 0x00564460  0400 da01  00009040 00006040 33335340 00002040 00008040
 *             a9161d00 a9162200  0200 e719 e919
 * 0x00564488  1200 cf01  00000041 00000041 0000a040 0000a040 0000f040
 *             a9161800 a9161600  0300 530a 540a 570a
 * 0x005644B0  0000 0000  0000b040 ...                a9160e00 a9160f00
 *             0100 9603
 * ```
 *
 * Type 1 is stage 3's drum: three hit points, drawn `0xA57`, `0xA54`, `0xA53`
 * as they go. `CARRIED_PROP_SLOTS` in `hod2lib/combat.ts` is the exporter's
 * copy of the slot runs.
 */
export const g_carried_prop_types: readonly CarriedPropType[] = [
  { breakModel: 4, breakMotion: 0x1da, breakPlay: 0x46, radius: 4.5,
    bodyRadius: 3.5, contactCentre: 3.3, contactEnd: 2.5, halfLength: 4.0, hitSound: 0x001d16a9, breakSound: 0x002216a9, hp: 2,
    slots: { 1: 0x19e7, 2: 0x19e9 } },
  { breakModel: 0x12, breakMotion: 0x1cf, breakPlay: 0x1e, radius: 8,
    bodyRadius: 8, contactCentre: 5, contactEnd: 5, halfLength: 7.5, hitSound: 0x001816a9, breakSound: 0x001616a9, hp: 3,
    slots: { 1: 0x0a53, 2: 0x0a54, 3: 0x0a57 } },
  { breakModel: 0, breakMotion: 0, breakPlay: 0, radius: 5.5,
    bodyRadius: 0, contactCentre: 0, contactEnd: 0, halfLength: 0, hitSound: 0x000e16a9, breakSound: 0x000f16a9,
    hp: 1, slots: { 1: 0x0396 } },
];

/**
 * `obj+0x5C = 0xBCDF0123` in `CarriedPropInit` — the gravity every prop
 * starts with, until `CarriedPropRelease` replaces it with the script's own.
 */
const INIT_GRAVITY = -0.027222221717238426;
/** `CarriedPropSeatBetweenBones(carrier, 0xC0800000)` — four units down each bone. */
const SEAT_ALONG_BONE = -4.0;
/** The two bones a prop is carried between: records at `obj+0x474` and `+0x624`. */
const SEAT_BONE_A = 4;
const SEAT_BONE_B = 7;
/** `MOV dword [EDI + 0x98], 0x5A` — frames stuck to the screen after a hit. */
const STUCK_FRAMES = 0x5a;
/** ...and below `0x3D` of them it blinks. */
const STUCK_BLINK_BELOW = 0x3d;
/** `-15.0` — the view depth the thrown prop is aimed at and arrives at. */
const ARRIVE_DEPTH = -15.0;
/** `3.0` — the sideways aim, per permit, when two are running. */
const TWO_PLAYER_AIM = 3.0;
/** `PlayerTakeDamage(player, 1, 7)` — and `1` for a type-2 prop. */
const HIT_KIND = 7;
const HIT_KIND_TYPE2 = 1;
/** `obj+0x34` bits `CarriedPropCheckShot` clears with `& 0xFFFFFFF1`. */
const SHOT_BITS = 0xe;
/** `RegisterForShotTest`: skipped outright while this bit is up. */
const SHOT_TEST_SKIP = 0x8000;
/** ...and taken when this one is, whatever the depth. */
const SHOT_TEST_MESH = 0x10;

/** One live carried prop. Engine fields carry their offsets. */
export interface CarriedProp {
  /** `[port-only]` — the pool's identity, for the renderer and the shot pick. */
  id: number;
  /** `obj+0x00` — the installed routine. */
  routine: CarriedPropRoutine;
  /** `obj+0x194` — the state-37 script, until init reads it. */
  script: TargetScriptJson["head"];
  /** `sub+0x00` — the carrier, as its spawn address. */
  carrier: number;
  /** `sub+0x04` — the carrier's `obj+0x1394` at init; `-1` when it had none. */
  target: number;
  /** `sub+0x08` — which `g_carried_prop_types` record. */
  type: number;
  /** `sub+0x0C` — the draw slot. */
  slot: number;
  /** `sub+0x10` — {@link CARRIED_PROP_HELD}, or the behaviour to release into. */
  mode: number;
  /** `sub+0x14..0x1C` — the last position the flight published. */
  lastPos: Vec3;
  /**
   * `sub+0x20..0x28` — the point the prop turns about, in its own frame:
   * zero in free flight, the contact point after `CarriedPropHitTargetSphere`
   * has bounced it.
   */
  pivot: Vec3;
  /**
   * `sub+0x2C/0x30/0x34` — BAMS a frame. The flights add them to `rx`, `ry`,
   * `rz`; the roll and the fall read `+0x2C` as a spin about X and `+0x34` as
   * the angle turned about {@link axis} each frame.
   */
  spin: [number, number, number];
  /** `sub+0x38..0x40` — the axis the roll and the fall turn about. */
  axis: Vec3;
  /** `sub+0x50` — the break effect's previous frame, `EffectDrawTree`'s. */
  breakPrev: number;
  /**
   * `[port-only]` — the break effect's drawn nodes this frame: each node's
   * slot and world matrix. Empty but for `CarriedPropBreakUpdate`.
   */
  parts: { slot: number; m: Mat }[];
  /** `sub+0x98` — frames left stuck to the screen. */
  stuck: number;
  /** `sub+0x4C` — the break effect's frame. */
  breakFrame: number;
  /** `obj+0x34`. */
  flags: number;
  /** `obj+0x40..0x48` — in the space the routine draws in (see the file note). */
  pos: Vec3;
  /** `obj+0x4C..0x54` — the launch words, then the velocity. */
  vel: Vec3;
  /** `obj+0x5C`. */
  gravity: number;
  /** `obj+0x64`, `obj+0x68`, `obj+0x6C` — BAMS. */
  rx: number;
  ry: number;
  rz: number;
  /** `obj+0x70..0x78` — the view-space point the shot test uses. */
  shotPoint: Vec3;
  /** `obj+0x11C`. */
  hp: number;
  /** `obj+0x121` — the player it is thrown at; `-1` for none. */
  player: number;
  /** `obj+0x124`. */
  radius: number;
  /** `obj+0x128`. */
  bodyRadius: number;
  /**
   * `[port-only]` — what this frame's `AssetDrawSlot` drew with: the engine's
   * matrix, and whether it was in view space. `null` for a frame that drew
   * nothing (the blink, a routine with no draw). Render reads it; nothing
   * reads it back.
   */
  draw: { m: Mat; view: boolean } | null;
  /** `[port-only]` — `RegisterForShotTest` took it this frame. */
  shootable: boolean;
  /**
   * `obj+0x100` — the point the camera aims at if it deals the prop a slot:
   * its own position, or its view-space position taken back to the world
   * while it is stuck to the lens. Written just before every
   * `RegisterForCameraTracking` call on this path.
   */
  lookAt: Vec3;
}

/**
 * `ActorAlloc(CarriedPropInit, 0x19C)` and the three writes that follow it in
 * `ZombieStateCarryProp`'s sub 0: `+0x198` the carrier, `+0x194` the script,
 * `+0x3C = -1`. `[port-only]` as a function; the init itself runs as the
 * object's first update, a pool step later, exactly as the task list does.
 */
export function CarriedPropAlloc(carrier: Actor,
                                 script: TargetScriptJson["head"]): number {
  const p: CarriedProp = {
    id: G.g_carried_prop_seq++,
    routine: CarriedPropRoutine.Init,
    script,
    carrier: carrier.at,
    target: -1,
    type: 0,
    slot: 0,
    mode: 0,
    lastPos: vec3(),
    pivot: vec3(),
    spin: [0, 0, 0],
    axis: vec3(),
    breakPrev: 0,
    parts: [],
    stuck: 0,
    breakFrame: 0,
    // `ActorClearGameFields` zeroes the object from `+0x34` on.
    flags: 0,
    pos: vec3(),
    vel: vec3(),
    gravity: 0,
    rx: 0, ry: 0, rz: 0,
    shotPoint: vec3(),
    hp: 0,
    player: -1,
    radius: 0,
    bodyRadius: 0,
    draw: null,
    shootable: false,
    lookAt: vec3(),
  };
  G.g_carried_props.push(p);
  return p.id;
}

/** The record `obj+0x139C` names, or undefined once it has despawned.
 * `[port-only]`.
 */
export function CarriedPropById(id: number): CarriedProp | undefined {
  return G.g_carried_props.find((p) => p.id === id);
}

/**
 * `CarriedPropInit` — `FUN_00442740`. Everything else reads what this wrote.
 */
export function CarriedPropInit(p: CarriedProp): void {
  const s = p.script;
  const carrier = ActorByAt(p.carrier);
  // `sub[1] = carrier+0x1394` -- the civilian a captor carries it for, if any.
  p.target = carrier?.targetAt ?? -1;
  p.type = s.prop_type ?? 0;
  const rec = g_carried_prop_types[p.type] ?? g_carried_prop_types[0];
  p.slot = rec.slots[rec.hp] ?? 0;
  p.mode = CARRIED_PROP_HELD;
  p.pos.x = s.offset?.[0] ?? 0;
  p.pos.y = s.offset?.[1] ?? 0;
  p.pos.z = s.offset?.[2] ?? 0;
  p.rx = 0; p.ry = 0; p.rz = 0;
  p.vel.x = s.launch?.[0] ?? 0;
  p.vel.y = s.launch?.[1] ?? 0;
  p.vel.z = s.launch?.[2] ?? 0;
  p.gravity = INIT_GRAVITY;
  p.spin = [s.spin?.[0] ?? 0, s.spin?.[1] ?? 0, s.spin?.[2] ?? 0];
  p.radius = rec.radius;
  p.bodyRadius = rec.bodyRadius;
  p.hp = rec.hp;
  p.player = -1;
  p.routine = (s.behaviour ?? CarriedPropRoutine.Held) as CarriedPropRoutine;
}

/**
 * `CarriedPropSeatBetweenBones` — `FUN_00442EB0`. Where the hands are, and
 * which way the prop between them faces.
 *
 * The two bone records' matrices are the carrier's **view-space** draw
 * records; the port rebuilds them from the world matrices the skeleton has
 * and the camera's world-to-view, which is the product the engine's draw
 * stored. The roll is the average of the two bones' up-vectors about the
 * segment, turned half round:
 *
 * ```
 * 00443159  FMUL double ptr [0x004C4378]   ; bone 7:  +65536/2pi
 * 00443171  FMUL double ptr [0x0055CB20]   ; bone 4:  -65536/2pi
 * 0044317c  MOV ECX,ESI / NEG ECX / SUB ECX,EAX / AND ECX,0xFFFF
 * 004431c7  LEA EDX,[EAX + ECX*1 + 0x8000] ; d/2 + a7 + 0x8000
 * ```
 */
export function CarriedPropSeatBetweenBones(carrier: Actor, along: number,
                                            host: GameHost, w2v: Mat):
    { pos: Vec3; rx: number; ry: number; rz: number } | null {
  const a = boneViewMatrix(carrier, SEAT_BONE_A, host, w2v);
  const b = boneViewMatrix(carrier, SEAT_BONE_B, host, w2v);
  if (!a || !b) return null;
  const pa = vec3(), pb = vec3();
  const t = MatCopy(MatIdentity(), a);
  MatrixTranslate(t, 0, along, 0);
  MatrixGetTranslation(t, pa);
  MatCopy(t, b);
  MatrixTranslate(t, 0, along, 0);
  MatrixGetTranslation(t, pb);
  const { ry, rz } = VecAimXAxisYThenZ(pb.x - pa.x, pb.y - pa.y, pb.z - pa.z);
  // `MatrixLoadIdentity; MatrixRotateZ(-rz); MatrixRotateY(-ry)`, then each
  // bone's rotation (translation zeroed) multiplied on, and its +Y read out.
  const up = (m: Mat): Vec3 => {
    const u = MatIdentity();
    MatrixRotateZ(u, -rz);
    MatrixRotateY(u, -ry);
    const rot = m.slice(0, 16);
    rot[3] = 0; rot[7] = 0; rot[11] = 0;
    rot[12] = 0; rot[13] = 0; rot[14] = 0; rot[15] = 1;
    MatrixMultiply(u, rot);
    const out = vec3();
    MatrixTransformPoint(u, { x: 0, y: 1, z: 0 }, out);
    return out;
  };
  const ua = up(a), ub = up(b);
  const a7 = FtolS16(Math.atan2(ub.z, ub.y) * RADIANS_TO_BAMS);
  const a4 = Math.trunc(Math.atan2(ua.z, ua.y) * -RADIANS_TO_BAMS);
  let d = (-a7 - a4) & 0xffff;
  if (d >= 0x8000) d -= 0x10000;
  // `CDQ / SUB EAX,EDX / SAR EAX,1` — a division that truncates toward zero.
  const rx = Math.trunc(d / 2) + a7 + 0x8000;
  return {
    pos: vec3((pa.x + pb.x) * 0.5, (pa.y + pb.y) * 0.5, (pa.z + pb.z) * 0.5),
    rx, ry, rz,
  };
}

/** `carrier + 0x20C + bone*0x90 + 0x28`, as the engine's draw left it. */
function boneViewMatrix(carrier: Actor, bone: number, host: GameHost,
                        w2v: Mat): Mat | null {
  const world: number[] = new Array(16).fill(0);
  if (!host.boneMatrix?.(carrier.at, bone, world)) return null;
  const m = MatCopy(MatIdentity(), w2v);
  MatrixMultiply(m, world);
  return m;
}

/**
 * `CarriedPropHeldUpdate` — `FUN_00442820`. `g_prop_behaviours[1]`.
 *
 * The draw is `seat · offset · RotX RotZ RotY`, in view space from an
 * identity, and the translation of that is the shot point. The carrier's
 * death takes it to {@link CarriedPropDrop}; the release mode appearing in
 * `sub+0x10` takes it to {@link CarriedPropRelease}.
 */
export function CarriedPropHeldUpdate(p: CarriedProp, host: GameHost,
                                      cam: CameraPair | null): void {
  const carrier = ActorByAt(p.carrier);
  const m = MatIdentity();
  const seat = carrier && cam
    ? CarriedPropSeatBetweenBones(carrier, SEAT_ALONG_BONE, host, cam.w2v)
    : null;
  if (seat) {
    MatrixLoadIdentity(m);
    MatrixTranslate(m, seat.pos.x, seat.pos.y, seat.pos.z);
    MatrixRotateY(m, seat.ry);
    MatrixRotateZ(m, seat.rz);
    MatrixRotateX(m, seat.rx);
    MatrixTranslate(m, p.pos.x, p.pos.y, p.pos.z);
    MatrixRotateX(m, p.rx);
    MatrixRotateZ(m, p.rz);
    MatrixRotateY(m, p.ry);
    p.draw = { m, view: true };
  } else if (p.draw) {
    // `[port-only]`: no skeleton or no camera to seat it with -- a headless
    // run -- so it keeps the last matrix it had rather than inventing one.
    MatCopy(m, p.draw.m);
  }
  // `(carrier+0x34 & 0x4000000) == 0`. A carrier the pool has already dropped
  // is dead by definition; the engine's pointer would be to freed memory.
  const dead = !carrier || (carrier.flags & ActorFlag.Dead) !== 0;
  if (!dead) {
    if (p.mode !== CARRIED_PROP_HELD) CarriedPropRelease(p, m, host, cam);
  } else {
    CarriedPropDrop(p, m, seat, cam);
    // `*(target+0x1310 + 0x4C) = 0` for a target still alive. `[open]` what
    // that word of the civilian's block is; no state-37 spawn in the game has
    // a civilian, so the write has no reader to reach.
  }
  MatrixGetTranslation(m, p.shotPoint);
  RegisterForShotTest(p);
}

/**
 * `CarriedPropRelease` — `FUN_00442B90`. Out of the hands and into the world.
 *
 * `m` is the matrix the held routine just drew with. Mode 4 aims at a point
 * fifteen units in front of the camera — dead centre with one permit, three
 * units to the permit-holder's side with two — and turns the script's launch
 * words into a ballistic arc that gets there in `obj+0x4C` frames.
 */
export function CarriedPropRelease(p: CarriedProp, m: Mat, host: GameHost,
                                   cam: CameraPair | null): void {
  p.flags &= ~ActorFlag.ShotImmune;
  // `MatrixStore; top = g_camera_blocks; MatrixMultiply(stored)` -- view to
  // world, which is what makes `g_camera_blocks` the inverse. See the note on
  // `g_camera_world_to_view` in globals.tsv.
  const w = MatCopy(MatIdentity(), cam?.v2w ?? MatIdentity());
  MatrixMultiply(w, m);
  MatrixGetTranslation(w, p.pos);
  p.lastPos.x = p.shotPoint.x;
  p.lastPos.y = p.shotPoint.y;
  p.lastPos.z = p.shotPoint.z;
  const e = MatrixToEulerZYX(w);
  p.rx = e.rx; p.ry = e.ry; p.rz = e.rz;
  // `obj+0x100 = pos; RegisterForCameraTracking(obj)` at `0x00442C36`..
  // `0x00442C4D`.
  CarriedPropRegisterCameraPoint(p, p.pos);
  const carrier = ActorByAt(p.carrier);
  if (p.mode === CarriedPropRoutine.ThrowAtCamera) {
    const side = G.g_max_attackers === 1 ? 0
      : (p.player * 2 - 1) * TWO_PLAYER_AIM;
    const aim = vec3();
    MatrixTransformPoint(cam?.v2w ?? MatIdentity(),
                         { x: side, y: 0, z: ARRIVE_DEPTH }, aim);
    const yaw = FtolS16(VecToAngles(aim.x - p.pos.x, aim.y - p.pos.y,
                                    aim.z - p.pos.z).yaw);
    const dz = p.pos.z - aim.z;
    const dx = p.pos.x - aim.x;
    const frames = p.vel.x;
    p.gravity = p.vel.y;
    const dy = aim.y - p.pos.y;
    const r = MatIdentity();
    MatrixRotateY(r, yaw);
    const v = vec3();
    MatrixTransformPoint(r, { x: 0, y: 0, z: Math.sqrt(dz * dz + dx * dx) / frames },
                         v);
    p.vel.x = v.x;
    p.vel.z = v.z;
    p.vel.y = dy / frames - frames * p.gravity * 0.5;
  } else {
    // Mode 3 (stage 1's), 5 (stage 2's) and anything else: the launch words
    // turned by the carrier's own facing. Mode 5 also sets
    // `sub+0x38..0x40 = (0, 0, 1)`, the axis its roll turns about.
    if (p.mode === CarriedPropRoutine.RollAtCamera) {
      p.axis.x = 0; p.axis.y = 0; p.axis.z = 1;
    }
    const r = MatIdentity();
    MatrixRotateX(r, carrier?.pitch ?? 0);
    MatrixRotateZ(r, carrier?.roll ?? 0);
    MatrixRotateY(r, carrier?.yaw ?? 0);
    MatrixTransformPoint(r, { ...p.vel }, p.vel);
  }
  p.routine = p.mode as CarriedPropRoutine;
  void host;
}

/**
 * `CarriedPropDrop` — `FUN_00442950`. The carrier died holding it.
 *
 * The held matrix `m` goes to the world through `g_camera_blocks`; the angle
 * the seat faces decides which way it falls: turned by the carrier's own
 * rotation, a push of `0.15` forward and a tumble one way when the carrier was
 * not holding a weapon and the seat's pitch is below 1, backward and the other
 * way otherwise. Then `CarriedPropFallFree`, and the permit back.
 */
export function CarriedPropDrop(p: CarriedProp, m: Mat,
                                seat: { rx: number; ry: number; rz: number } | null,
                                cam: CameraPair | null): void {
  p.flags &= ~ActorFlag.ShotImmune;
  const v2w = cam?.v2w ?? MatIdentity();
  const w = MatCopy(MatIdentity(), v2w);
  MatrixMultiply(w, m);
  MatrixGetTranslation(w, p.pos);
  p.lastPos.x = p.shotPoint.x;
  p.lastPos.y = p.shotPoint.y;
  p.lastPos.z = p.shotPoint.z;
  const e = MatrixToEulerZYX(w);
  p.rx = e.rx; p.ry = e.ry; p.rz = e.rz;
  const f = MatCopy(MatIdentity(), v2w);
  MatrixRotateY(f, seat?.ry ?? 0);
  MatrixRotateZ(f, seat?.rz ?? 0);
  MatrixRotateX(f, seat?.rx ?? 0);
  const d = vec3();
  MatrixTransformVector(f, { x: 0, y: 0, z: 1 }, d);
  const pitch = FtolS16(VecToAngles(d.x, d.y, d.z).pitch);
  const carrier = ActorByAt(p.carrier);
  const r = MatIdentity();
  MatrixRotateX(r, carrier?.pitch ?? 0);
  MatrixRotateZ(r, carrier?.roll ?? 0);
  MatrixRotateY(r, carrier?.yaw ?? 0);
  const holding = ((carrier?.flags ?? 0) & ActorFlag.HoldingWeapon) !== 0;
  if (!holding && pitch < 1) {
    MatrixTransformPoint(r, { x: 0, y: 0, z: DROP_PUSH }, p.vel);
    p.spin = [-0x200, 0, -0x100];
  } else {
    MatrixTransformPoint(r, { x: 0, y: 0, z: -DROP_PUSH }, p.vel);
    p.spin = [0x200, 0, 0x100];
  }
  p.axis.x = 0; p.axis.y = 0; p.axis.z = 1;
  p.routine = CarriedPropRoutine.FallFree;
  if (p.player >= 0) {
    G.g_attack_permits[p.player] = -1;
    p.player = -1;
  }
}

/** `0x3E19999A` — the push a dropped prop leaves the hands with. */
const DROP_PUSH = 0.15;

/**
 * `CarriedPropThrowAtCamera` — `FUN_00443B90`. `g_prop_behaviours[4]`.
 *
 * The flight: `pos += vel; vel.y += gravity`, the spin, a draw under
 * `g_camera_world_to_view`, the shot test and the shot response. Arriving
 * with hit points left — view depth no nearer than `-15` — is the hit: the
 * prop is taken into view space, stuck there for ninety frames, and the
 * player it was thrown at loses a life.
 */
export function CarriedPropThrowAtCamera(p: CarriedProp, cam: CameraPair | null,
                                         rng: Rng, events?: Events): void {
  p.pos.x += p.vel.x;
  p.pos.y += p.vel.y;
  p.pos.z += p.vel.z;
  p.vel.y += p.gravity;
  p.ry += p.spin[1];
  p.rx += p.spin[0];
  p.rz += p.spin[2];
  p.lastPos.x = p.pos.x; p.lastPos.y = p.pos.y; p.lastPos.z = p.pos.z;
  const m = MatCopy(MatIdentity(), cam?.w2v ?? MatIdentity());
  MatrixTranslate(m, p.pos.x, p.pos.y, p.pos.z);
  MatrixRotateZ(m, p.rz);
  MatrixRotateY(m, p.ry);
  MatrixRotateX(m, p.rx);
  p.draw = { m: m.slice(0, 16), view: true };
  // `obj+0x100 = pos; RegisterForCameraTracking` at `0x00443C70`..`0x00443C87`.
  CarriedPropRegisterCameraPoint(p, p.pos);
  MatrixGetTranslation(m, p.shotPoint);
  RegisterForShotTest(p);
  CarriedPropCheckShot(p, m, cam, rng, events);
  if (p.hp > 0 && ARRIVE_DEPTH <= p.shotPoint.z && cam) {
    MatrixGetTranslation(m, p.pos);
    const e = MatrixToEulerZYX(m);
    p.rx = e.rx; p.ry = e.ry; p.rz = e.rz;
    p.stuck = STUCK_FRAMES;
    p.routine = CarriedPropRoutine.StuckToScreen;
    let kind = HIT_KIND;
    if (p.type === 2) { p.rx = -0x800; kind = HIT_KIND_TYPE2; }
    PlayerTakeDamage(p.player, 1, kind, events, null, "thrown");
  }
}

/**
 * `CarriedPropStuckToScreen` — `FUN_00444160`. Ninety frames on the lens,
 * blinking for the last sixty, and then the attack permit the carrier claimed
 * goes back — the only place on this path that gives it up.
 */
export function CarriedPropStuckToScreen(p: CarriedProp,
                                         v2w?: ArrayLike<number>): boolean {
  const t = p.stuck;
  p.stuck = t - 1;
  if (t === 0) {
    if (p.player >= 0) G.g_attack_permits[p.player] = -1;
    return false;                                   // `ActorDespawn`
  }
  p.draw = null;
  p.shootable = false;
  // `(t - 1) < 0x3D` and even: skip the draw, which is the blink.
  if (p.stuck < STUCK_BLINK_BELOW && p.stuck % 2 === 0) return true;
  const m = MatIdentity();
  MatrixTranslate(m, p.pos.x, p.pos.y, p.pos.z);
  MatrixRotateZ(m, p.rz);
  MatrixRotateY(m, p.ry);
  MatrixRotateX(m, p.rx);
  p.draw = { m, view: true };
  // `obj+0x100 = g_camera_blocks * pos; RegisterForCameraTracking(obj)` at
  // `0x00444220`..`0x00444244` -- after the blink's early return, so a
  // blinked-out frame is not counted. The prop sits in view space here, so
  // the camera's point is taken back to the world.
  if (v2w) MatrixTransformPoint(v2w, p.pos, _stuckWorld);
  else { _stuckWorld.x = p.pos.x; _stuckWorld.y = p.pos.y; _stuckWorld.z = p.pos.z; }
  CarriedPropRegisterCameraPoint(p, _stuckWorld);
  return true;
}

const _stuckWorld = vec3();

/**
 * `CarriedPropCheckShot` — `FUN_004423F0`. What a hit does.
 *
 * `m` is the top of the stack at the call — the flight's view-space draw
 * matrix — which the break takes back into the world.
 */
export function CarriedPropCheckShot(p: CarriedProp, m: Mat,
                                     cam: CameraPair | null, rng: Rng,
                                     events?: Events): void {
  if (!(p.flags & ActorFlag.Hit)) return;
  const rec = g_carried_prop_types[p.type] ?? g_carried_prop_types[0];
  const who = p.flags & 6;
  const player = who === 2 ? 0 : who === 4 ? 1 : rng.int(2);
  // `if (DAT_009A5C48 == 0) g_player_hit_count[player]++`. `[open]` what the
  // guard word is; nothing the port runs writes it, so the count is taken.
  G.g_player_hit_count[player] = (G.g_player_hit_count[player] ?? 0) + 1;
  const immune = (p.flags & ActorFlag.ShotImmune) !== 0;
  if (!immune) p.hp -= 1;
  p.flags &= ~SHOT_BITS;
  if (p.hp === 0) {
    if (p.type !== 2) {
      p.breakFrame = 0;
      p.routine = CarriedPropRoutine.Break;
      const w = MatCopy(MatIdentity(), cam?.v2w ?? MatIdentity());
      MatrixMultiply(w, m);
      MatrixGetTranslation(w, p.pos);
      w[12] = 0; w[13] = 0; w[14] = 0;               // `MatrixSetTranslation(0)`
      const ax = vec3();
      MatrixTransformPoint(w, { x: 1, y: 0, z: 0 }, ax);
      const a = VecAimXAxisYThenZ(ax.x, ax.y, ax.z);
      p.ry = a.ry;
      p.rz = a.rz;
    }
    // `[open]` Type 2 is deflected along the ground instead of breaking
    // (`0x0044257C`..`0x004426D0`, which installs `0x00444F70`). No state-37
    // script in the six stages names type 2, so that arm is not ported.
    //
    // **Both arms then share a tail Ghidra leaves out of the function** (`L37`
    // -- the break arm ends `JMP 0x004426D6`): the permit the prop was thrown
    // on goes back, the break sound plays, and a live target has its
    // `sub+0x4C` zeroed. So a drum shot out of the air frees the next
    // attacker at once rather than holding the permit for ever.
    //
    // ```
    // 004426d6  MOV AL,[ESI+0x121] / CMP AL,BL / JL
    // 004426e3  MOV dword ptr [EDX*4 + 0x9a2ba0], EBX   ; g_attack_permits[p] = 0
    // 004426ea  MOV EAX,[EBP+0x1c] / PUSH EAX / CALL 0x0041cfd0   ; the break sound
    // ```
    if (p.player >= 0) G.g_attack_permits[p.player] = -1;
    events?.emit("sound.play", { id: rec.breakSound });
    return;
  }
  if (!immune) {
    p.slot = rec.slots[p.hp] ?? p.slot;
    events?.emit("sound.play", { id: rec.hitSound });
  }
}

/**
 * `CarriedPropBreakUpdate` — `FUN_00444EE0`. The broken prop, as an effect.
 *
 * While the break motion is resident (`g_motion_slots[motion].state == 2`) it
 * halves the roll and draws effect `sub+0x44` (`EffectDrawUnlit`,
 * `0x0040DD90`) at `T(pos) RotY RotZ`; then, in every case — Ghidra ends the
 * draw arm at the pop and the bytes fall through at `0x00444F46`, `L37` — the
 * cursor steps and the object despawns at `g_motion_play_length - 1`.
 *
 * `[likely]` the motion is resident: the stage loads the pol file the effect
 * belongs to before it spawns the carrier, and the port has no residency.
 */
export function CarriedPropBreakUpdate(p: CarriedProp): boolean {
  p.draw = null;
  p.shootable = false;
  p.parts = [];
  const rec = g_carried_prop_types[p.type] ?? g_carried_prop_types[0];
  const def = T.breakables?.effects?.[String(rec.breakModel)] ?? null;
  if (p.rz !== 0) p.rz = Math.trunc(p.rz / 2);
  if (def) {
    const base = MatIdentity();
    MatrixTranslate(base, p.pos.x, p.pos.y, p.pos.z);
    MatrixRotateY(base, p.ry);
    MatrixRotateZ(base, p.rz);
    EffectDrawTreeInto(p, def, base);
  }
  p.breakFrame += 1;
  return p.breakFrame < rec.breakPlay - 1;
}

/**
 * `EffectDrawTree` (`FUN_0040DDC0`) and `EffectDrawNode` (`FUN_0040DE50`),
 * for this pool: wrap the cursor, then walk the tree from the root with a
 * matrix pushed per node, so a child composes on its parent's pose, and emit
 * one part per node with a slot. `[port-only]` as a function -- the two are
 * the renderer's walk in the engine; here they produce the matrices it draws.
 * No carried prop's tree has the `0x10CE` node that draws at a random scale.
 */
function EffectDrawTreeInto(p: CarriedProp,
                            def: NonNullable<NonNullable<typeof T.breakables>["effects"]>[string],
                            base: Mat): void {
  const play = def.play_length;
  if (play - 1 <= p.breakFrame) p.breakFrame = 0;
  if (p.breakFrame < 0) p.breakFrame = play - 2;
  const walk = (i: number, parent: Mat): void => {
    const n = def.nodes[i];
    const m = parent.slice(0, 16);
    if (n.bone >= 1) {
      const pose = EffectNodePoseAt(def, i, p.breakFrame, p.breakPrev);
      if (pose) {
        MatrixTranslate(m, pose.x, pose.y, pose.z);
        MatrixRotateZ(m, pose.roll);
        MatrixRotateY(m, pose.yaw);
        MatrixRotateX(m, pose.pitch);
      }
      if (n.slot) p.parts.push({ slot: n.slot, m });
    }
    for (const c of n.children) walk(c, m);
  };
  for (const c of def.nodes[0]?.children ?? []) walk(c, base);
  p.breakPrev = p.breakFrame;
}

/** `PlaySoundId(0x1916A9)` — a rolling prop touching the ground. */
const ROLL_GROUND_SOUND = 0x001916a9;
/** `-40.0` — the depth inside which a grounded roll re-aims itself at the lens. */
const ROLL_REAIM_DEPTH = -40.0;
/** `FADD [0x004C43B0]` — the ground query starts this far above the prop. */
const GROUND_QUERY_LIFT = 100.0;
/** The two surfaces the ground query does not count as ground. */
const SURFACE_NOT_GROUND_A = 5;
const SURFACE_NOT_GROUND_B = 0x37;
/** `[0x0056453C]` — friction along the ground, per contact. */
const GROUND_FRICTION = 0.105;
/** `[0x0055D2C4]` — the bounce: the normal velocity reversed and scaled. */
const GROUND_RESTITUTION = -0.3;
/** `[0x004E3100]` — a vertical speed below this is zeroed. */
const GROUND_REST_SPEED = 0.02;
/** `[0x005643E0]` — the X spin kept per contact. */
const SPIN_KEEP = 0.99;
/** `[0x00564534]` — the axis turn kept per flat contact. */
const TURN_KEEP = 0.85;
/** `[0x00564538]` — the edge contact's tilt, scaled into the turn. */
const TILT_KEEP = 0.975;
/** `[0x00564530]` — `2^-15`: a BAMS spin times a radius is a roll distance. */
const ROLL_SCALE = 3.0517578e-05;
/** `2pi / 65536`, `[0x004C4370]`. */
const BAMS_RAD = 9.587379924285257e-05;

/**
 * `CarriedPropGroundContact` — `FUN_00444280`. Ground under a falling or
 * rolling prop, and what touching it does.
 *
 * Everything is measured in the frame of the ground under the prop — the
 * ground height `QueryGroundHeightAt` finds (or `g_camera_fixed_eye_y` over
 * water, surfaces 5 and `0x37`), tilted to the surface normal when there is
 * one. The prop's two ends, `+-halfLength` along its own +X, and its centre
 * are dropped by the record's contact extents; the lowest of the three is
 * the contact. At or below the ground: lift the prop out, bounce the velocity
 * (friction 0.105 along, `-0.3` across), stop a vertical speed under 0.02,
 * decay the spins, and — when an **end** touches — set the roll axis and tilt
 * from how that end is moving; if either end is still in the air, turn the
 * axis toward the ground by a step of the angle. Last, roll the prop forward
 * by its X spin times the radius it rolls on. True on a contact.
 */
export function CarriedPropGroundContact(p: CarriedProp): boolean {
  const rec = g_carried_prop_types[p.type] ?? g_carried_prop_types[0];
  const a = rec.contactCentre, b = rec.contactEnd, c = rec.halfLength;
  let edge = false;
  let ground = QueryGroundHeightAt(p.pos.x, p.pos.y + GROUND_QUERY_LIFT,
                                   p.pos.z);
  if (G.g_coli_hit_surface === SURFACE_NOT_GROUND_A
      || G.g_coli_hit_surface === SURFACE_NOT_GROUND_B) {
    G.g_coli_hit_surface = 0;
    ground = G.g_camera_fixed_eye_y;
  }
  const top = MatIdentity();
  MatrixTranslate(top, p.pos.x, ground, p.pos.z);
  let groundM = top.slice(0, 16);                     // `MatrixStore(local_40)`
  MatrixTranslate(top, 0, p.pos.y - ground, 0);
  MatrixRotateZ(top, p.rz); MatrixRotateY(top, p.ry); MatrixRotateX(top, p.rx);
  const pP = vec3(), pM = vec3();
  MatrixTransformPoint(top, { x: c, y: 0, z: 0 }, pP);
  MatrixTransformPoint(top, { x: -c, y: 0, z: 0 }, pM);
  let side = -c;
  MatrixRotateAxis(top, p.axis, p.spin[2]);
  const qP = vec3(), qM = vec3();
  MatrixTransformPoint(top, { x: c, y: 0, z: 0 }, qP);
  MatrixTransformPoint(top, { x: -c, y: 0, z: 0 }, qM);
  const dP = vec3(qP.x - pP.x, qP.y - pP.y, qP.z - pP.z);
  const dM = vec3(qM.x - pM.x, qM.y - pM.y, qM.z - pM.z);
  if (G.g_coli_hit_surface !== 0) {
    const [nx, ny, nz] = G.g_coli_hit_normal;
    const tilt = VecAngleBetween(nx, ny, nz, 0, 1, 0);
    const yaw = FtolS16(Math.atan2(nx, nz) * RADIANS_TO_BAMS);
    const g = groundM.slice(0, 16);
    MatrixRotateY(g, yaw);
    MatrixRotateX(g, tilt);
    groundM = g;
  }
  const inv = groundM.slice(0, 16);
  MatrixInvert(inv);
  const lp = vec3(), A = vec3(), B = vec3();
  MatrixTransformPoint(inv, p.pos, lp);
  MatrixTransformPoint(inv, pP, A);
  MatrixTransformPoint(inv, pM, B);
  const seg = VecAimXAxisYThenZ(A.x - B.x, A.y - B.y, A.z - B.z);
  const s = MatIdentity();
  MatrixRotateY(s, seg.ry);
  MatrixRotateZ(s, seg.rz);
  const drop = (at: Vec3, by: number): Vec3 => {
    s[12] = at.x; s[13] = at.y; s[14] = at.z;         // `MatrixSetTranslation`
    MatrixTranslate(s, 0, -by, 0);
    const o = vec3();
    MatrixGetTranslation(s, o);
    return o;
  };
  const centre = drop(lp, a);
  const aEnd = drop(A, b);
  const bEnd = drop(B, b);
  let low = centre;
  let lowDelta = centre;
  if (bEnd.y <= aEnd.y) {
    if (bEnd.y < centre.y) { low = bEnd; lowDelta = dM; edge = true; }
  } else if (aEnd.y < centre.y) {
    low = aEnd; lowDelta = dP; edge = true; side = c;
  }
  if (!(low.y <= 0)) return false;

  // Out of the ground, along the ground's own up.
  const lift = groundM.slice(0, 16);
  lift[12] = p.pos.x; lift[13] = p.pos.y; lift[14] = p.pos.z;
  MatrixTranslate(lift, 0, -low.y, 0);
  MatrixGetTranslation(lift, p.pos);
  MatrixInvert(lift);
  const vl = vec3();
  MatrixTransformVector(lift, p.vel, vl);
  const v2 = vec3(vl.x - vl.x * GROUND_FRICTION, vl.y * GROUND_RESTITUTION,
                  vl.z - vl.z * GROUND_FRICTION);
  MatrixTransformVector(groundM, v2, p.vel);
  if (Math.abs(p.vel.y) < GROUND_REST_SPEED) p.vel.y = 0;

  const toLocal = MatIdentity();
  MatrixRotateX(toLocal, -p.rx); MatrixRotateY(toLocal, -p.ry);
  MatrixRotateZ(toLocal, -p.rz);
  if (edge) {
    const gi = groundM.slice(0, 16);
    MatrixInvert(gi);
    const d = vec3();
    MatrixTransformVector(gi, lowDelta, d);
    const dy = d.y < 0 ? d.y * GROUND_RESTITUTION : d.y;
    const r = vec3();
    MatrixTransformPoint(toLocal, { x: d.x + v2.x, y: dy + v2.y, z: d.z + v2.z },
                         r);
    p.axis.x = 0;
    p.axis.y = -(r.z * side);
    p.axis.z = r.y * side;
    p.spin[0] = Math.trunc(p.spin[0] * SPIN_KEEP);
    const tilt = FtolS16(Math.atan2(Math.sqrt(r.y * r.y + r.z * r.z), c)
                         * RADIANS_TO_BAMS);
    p.spin[2] = Math.trunc(tilt * TILT_KEEP);
  } else {
    p.spin[0] = Math.trunc(p.spin[0] * SPIN_KEEP);
    p.spin[2] = Math.trunc(p.spin[2] * TURN_KEEP);
  }
  if (aEnd.y > 0 || bEnd.y > 0) {
    // An end in the air: tip the turn toward the ground.
    const w = vec3();
    MatrixTransformPoint(groundM, low, w);
    const up = vec3(), rel = vec3();
    MatrixTransformPoint(toLocal, { x: 0, y: 1, z: 0 }, up);
    MatrixTransformPoint(toLocal, { x: p.pos.x - w.x, y: p.pos.y - w.y,
                                    z: p.pos.z - w.z }, rel);
    const ax = vec3(rel.z * up.y - rel.y * up.z, rel.x * up.z - rel.z * up.x,
                    rel.y * up.x - rel.x * up.y);
    const ang = VecAngleBetween(up.x, up.y, up.z, rel.x, rel.y, rel.z);
    if (ang > 0x100) {
      const m3 = MatIdentity();
      MatrixRotateAxis(m3, p.axis, p.spin[2]);
      const step = Math.trunc(ang / 256);
      MatrixRotateAxis(m3, ax, edge ? step : -step);
      const e = vec3();
      MatrixTransformPoint(m3, { x: 1, y: 0, z: 0 }, e);
      p.axis.z = e.y;
      p.axis.y = -e.z;
      p.axis.x = 0;
      p.spin[2] = VecAngleBetween(1, 0, 0, e.x, e.y, e.z);
    }
  }
  // Roll: the X spin over the radius it rolls on, along the segment's heading.
  const k = Math.cos(seg.rz * BAMS_RAD) * p.spin[0] * (edge ? b : a)
    * ROLL_SCALE;
  const rm = groundM.slice(0, 16);
  MatrixRotateY(rm, seg.ry);
  MatrixRotateZ(rm, seg.rz);
  const mv = vec3();
  MatrixTransformVector(rm, { x: 0, y: 0, z: k }, mv);
  p.pos.x += mv.x; p.pos.y += mv.y; p.pos.z += mv.z;
  return true;
}

/**
 * The spin step `CarriedPropRollAtCamera` and `CarriedPropFallFree` share:
 * `LoadIdentity; RotZ RotY RotX; MatrixRotateAxis(axis, sub+0x34);
 * RotX(sub+0x2C)`, read back into the three angles. `[port-only]` as a
 * function -- both routines write it inline.
 */
function CarriedPropTumble(p: CarriedProp): void {
  const m = MatIdentity();
  MatrixRotateZ(m, p.rz); MatrixRotateY(m, p.ry); MatrixRotateX(m, p.rx);
  MatrixRotateAxis(m, p.axis, p.spin[2]);
  MatrixRotateX(m, p.spin[0]);
  const e = MatrixToEulerZYX(m);
  p.rx = e.rx; p.ry = e.ry; p.rz = e.rz;
}

/** `w2v . T(pos) . RotZ RotY RotX`, drawn and read back as the shot point. */
function CarriedPropDrawWorld(p: CarriedProp, w2v: Mat): Mat {
  const d = MatCopy(MatIdentity(), w2v);
  MatrixTranslate(d, p.pos.x, p.pos.y, p.pos.z);
  MatrixRotateZ(d, p.rz); MatrixRotateY(d, p.ry); MatrixRotateX(d, p.rx);
  p.draw = { m: d, view: true };
  MatrixGetTranslation(d, p.shotPoint);
  return d;
}

/**
 * `CarriedPropRollAtCamera` — `FUN_00443DC0`. `g_prop_behaviours[5]`, stage
 * 2's pair: the barrel dropped from the hands rolls along the ground at the
 * player.
 *
 * Integrate, tumble, `CarriedPropGroundContact` (the sound `0x1916A9` on a
 * contact), draw, camera-track, shot-test. With hit points left: inside
 * `-15` it has arrived -- onto the lens for ninety frames, a life from the
 * player on the side of the screen it reached, and that player's permit
 * raised; on the ground inside `-40` it re-aims its vertical speed so the arc
 * it is on meets the lens.
 */
export function CarriedPropRollAtCamera(p: CarriedProp, cam: CameraPair | null,
                                        rng: Rng, events?: Events): void {
  p.pos.x += p.vel.x;
  p.pos.y += p.vel.y;
  p.pos.z += p.vel.z;
  p.vel.y += p.gravity;
  CarriedPropTumble(p);
  const contact = CarriedPropGroundContact(p);
  if (contact) events?.emit("sound.play", { id: ROLL_GROUND_SOUND });
  p.lastPos.x = p.pos.x; p.lastPos.y = p.pos.y; p.lastPos.z = p.pos.z;
  const w2v = cam?.w2v ?? MatIdentity();
  const d = CarriedPropDrawWorld(p, w2v);
  // `obj+0x100 = pos; RegisterForCameraTracking` at `0x00443EE4`..`0x00443EFB`.
  CarriedPropRegisterCameraPoint(p, p.pos);
  RegisterForShotTest(p);
  CarriedPropCheckShot(p, d, cam, rng, events);
  if (!(p.hp > 0)) return;
  if (ARRIVE_DEPTH <= p.shotPoint.z && cam) {
    MatrixGetTranslation(d, p.pos);
    const e = MatrixToEulerZYX(d);
    p.rx = e.rx; p.ry = e.ry; p.rz = e.rz;
    p.stuck = STUCK_FRAMES;
    p.routine = CarriedPropRoutine.StuckToScreen;
    if (G.g_players_in_play === 1) p.player = G.g_active_player;
    else if (G.g_players_in_play === 2) p.player = p.shotPoint.x >= 0 ? 1 : 0;
    PlayerTakeDamage(p.player, 1, HIT_KIND, events, null, "thrown");
    // The engine writes 1; the port's permits hold a claimant, and this one
    // has no actor of its own -- the carrier is the nearest thing to one.
    if (p.player >= 0) G.g_attack_permits[p.player] = p.carrier;
    return;
  }
  if (contact && ROLL_REAIM_DEPTH <= p.shotPoint.z && cam) {
    const fwd = vec3();
    MatrixTransformVector(cam.v2w, { x: 0, y: 0, z: 1 }, fwd);
    const ang = VecToAngles(fwd.x, fwd.y, fwd.z);
    const pitch = FtolS16(ang.pitch) * BAMS_RAD;
    const yaw = FtolS16(ang.yaw) * BAMS_RAD;
    const s1 = Math.sin(pitch), c1 = Math.cos(pitch);
    const f10 = Math.sin(yaw) * p.vel.x + Math.cos(yaw) * p.vel.z;
    const f9 = (-p.shotPoint.y * s1 + (ARRIVE_DEPTH - p.shotPoint.z) * c1) / f10;
    p.vel.y = (-p.shotPoint.y / f9 - f10 * s1) / c1 - f9 * p.gravity * 0.5;
  }
}

/**
 * `CarriedPropFallFree` — `FUN_00444D80`. A prop dropped from a dead
 * carrier's hands: integrate, tumble, `CarriedPropGroundContact`, draw, and a
 * shot test only while `CarriedPropIsOnScreen`. Nothing here despawns it.
 */
export function CarriedPropFallFree(p: CarriedProp, cam: CameraPair | null,
                                    rng: Rng, events?: Events): void {
  p.pos.x += p.vel.x;
  p.pos.y += p.vel.y;
  p.pos.z += p.vel.z;
  p.vel.y += p.gravity;
  CarriedPropTumble(p);
  CarriedPropGroundContact(p);
  p.lastPos.x = p.pos.x; p.lastPos.y = p.pos.y; p.lastPos.z = p.pos.z;
  const d = CarriedPropDrawWorld(p, cam?.w2v ?? MatIdentity());
  if (CarriedPropIsOnScreen(p)) {
    RegisterForShotTest(p);
    CarriedPropCheckShot(p, d, cam, rng, events);
  }
}

/** `g_app_state` 10, in which a dropped prop hits nothing. `[open]` what screen it is. */
const APP_STATE_NO_TARGET_HIT = 10;
/** `PlaySoundId(0x1D16A9)` — the prop landing on its target. */
const TARGET_HIT_SOUND = 0x001d16a9;
/**
 * The bone of the target the prop is tested against: `target + 0x32C` is the
 * record of bone 2 (`0x20C + 2*0x90`), whose `+0x68`/`+0x78` are the sphere
 * `ShotTestBoneSphere` uses — the head.
 */
const TARGET_BONE = 2;
/** `FMUL 0.8` on x and y, `0.7` on z, of the velocity in the contact frame. */
const BOUNCE_KEEP_XY = 0.8;
const BOUNCE_KEEP_Z = 0.7;
/** `MatrixRotateAxis(axis, 0x200)` — the tumble a contact adds per frame. */
const BOUNCE_TUMBLE = 0x200;

/**
 * `CarriedPropThrowAtTarget` — `FUN_004432D0`. `g_prop_behaviours[3]`.
 *
 * Stage 1's barrel, held over a civilian and let go: `pos += vel`,
 * `vel.y += gravity`, and every frame a test against the target's head
 * sphere. The first contact raises the target's `0x4000000` — the same bit a
 * killing shot raises, so the civilian's own update runs its killed branch —
 * and plays `0x1D16A9`; every contact bounces the prop. It then turns by its
 * spin **about the pivot** the contact left, draws under
 * `g_camera_world_to_view`, and is shootable only while
 * `CarriedPropIsOnScreen`. Nothing here despawns it.
 */
export function CarriedPropThrowAtTarget(p: CarriedProp, host: GameHost,
                                         cam: CameraPair | null, rng: Rng,
                                         events?: Events): void {
  const w2v = cam?.w2v ?? MatIdentity();
  p.pos.x += p.vel.x;
  p.pos.y += p.vel.y;
  p.pos.z += p.vel.z;
  p.vel.y += p.gravity;
  const m = MatCopy(MatIdentity(), w2v);
  MatrixTranslate(m, p.pos.x, p.pos.y, p.pos.z);
  MatrixGetTranslation(m, p.shotPoint);
  if (G.g_app_state !== APP_STATE_NO_TARGET_HIT) {
    const t = p.target >= 0 ? ActorByAt(p.target) : undefined;
    if (t && CarriedPropHitTargetSphere(p, t, host, cam)
        && !(t.flags & ActorFlag.Dead)) {
      t.flags |= ActorFlag.Dead;
      events?.emit("sound.play", { id: TARGET_HIT_SOUND });
    }
  }
  // Turn about the pivot: out to it, spin, and back.
  const r = MatIdentity();
  MatrixTranslate(r, p.pos.x, p.pos.y, p.pos.z);
  MatrixRotateZ(r, p.rz); MatrixRotateY(r, p.ry); MatrixRotateX(r, p.rx);
  MatrixTranslate(r, p.pivot.x, p.pivot.y, p.pivot.z);
  const c = vec3();
  MatrixGetTranslation(r, c);
  p.ry += p.spin[1];
  p.rx += p.spin[0];
  p.rz += p.spin[2];
  MatrixLoadIdentity(r);
  MatrixTranslate(r, c.x, c.y, c.z);
  MatrixRotateZ(r, p.rz); MatrixRotateY(r, p.ry); MatrixRotateX(r, p.rx);
  MatrixTranslate(r, -p.pivot.x, -p.pivot.y, -p.pivot.z);
  MatrixGetTranslation(r, p.pos);
  p.lastPos.x = p.pos.x; p.lastPos.y = p.pos.y; p.lastPos.z = p.pos.z;
  const d = MatCopy(MatIdentity(), w2v);
  MatrixTranslate(d, p.pos.x, p.pos.y, p.pos.z);
  MatrixRotateZ(d, p.rz); MatrixRotateY(d, p.ry); MatrixRotateX(d, p.rx);
  p.draw = { m: d, view: true };
  MatrixGetTranslation(d, p.shotPoint);
  if (CarriedPropIsOnScreen(p)) {
    RegisterForShotTest(p);
    CarriedPropCheckShot(p, d, cam, rng, events);
  }
}

/**
 * `CarriedPropHitTargetSphere` — `FUN_00443540`. Does the prop touch the
 * target's head, and if it does, bounce it.
 *
 * Everything is in view space, as the engine's bone records are: the head's
 * centre comes across the seam in the world and goes through
 * `g_camera_world_to_view` here. The contact point is where the line from
 * last frame's position to this one's enters the sphere of both radii
 * (`LineSphereIntersect`), the nearer of its two crossings to where the prop
 * came from; the velocity is damped in the frame that faces the head, the
 * prop is given a tumble about `normal x its own +X`, and the pivot is the
 * point between the two sphere centres at the ratio of their radii.
 */
export function CarriedPropHitTargetSphere(p: CarriedProp, target: Actor,
                                           host: GameHost,
                                           cam: CameraPair | null): boolean {
  const miss = (): boolean => {
    p.pivot.x = 0; p.pivot.y = 0; p.pivot.z = 0;
    return false;
  };
  const cw = vec3();
  const tr = host.boneSphere?.(target.at, TARGET_BONE, cw) ?? null;
  if (tr === null || !cam) return miss();
  const C = vec3();
  MatrixTransformPoint(cam.w2v, cw, C);
  const R = tr + p.bodyRadius;
  const P = p.shotPoint;
  if (!(Math.hypot(P.z - C.z, P.y - C.y, P.x - C.x) < R)) return miss();
  const prev = vec3();
  MatrixTransformPoint(cam.w2v, p.lastPos, prev);
  const hit = LineSphereIntersect(R, C, P, prev);
  if (!hit) return miss();
  const [e0, e1] = hit;
  const pick = Math.hypot(prev.z - e1.z, prev.y - e1.y, prev.x - e1.x)
    <= Math.hypot(prev.z - e0.z, prev.y - e0.y, prev.x - e0.x) ? e1 : e0;
  MatrixTransformPoint(cam.v2w, pick, p.pos);
  const a = vec3(), b = vec3();
  MatrixTransformPoint(cam.v2w, pick, a);
  MatrixTransformPoint(cam.v2w, C, b);
  const n = vec3(b.x - a.x, b.y - a.y, b.z - a.z);
  const ang = VecToAngles(n.x, n.y, n.z);
  const yaw = FtolS16(ang.yaw), pitch = FtolS16(ang.pitch);
  const m = MatIdentity();
  MatrixRotateX(m, -pitch);
  MatrixRotateY(m, -yaw);
  MatrixTransformPoint(m, { ...p.vel }, p.vel);
  MatrixLoadIdentity(m);
  MatrixRotateY(m, yaw);
  MatrixRotateX(m, pitch);
  MatrixTransformPoint(m, { x: p.vel.x * BOUNCE_KEEP_XY,
                            y: p.vel.y * BOUNCE_KEEP_XY,
                            z: p.vel.z * BOUNCE_KEEP_Z }, p.vel);
  // Into the prop's own frame: its +X and the normal, and their cross.
  const inv = MatIdentity();
  MatrixRotateX(inv, -p.rx); MatrixRotateY(inv, -p.ry); MatrixRotateZ(inv, -p.rz);
  const x1 = vec3(), nn = vec3();
  MatrixTransformPoint(inv, { x: 1, y: 0, z: 0 }, x1);
  MatrixTransformPoint(inv, n, nn);
  const axis = vec3(nn.z * x1.y - nn.y * x1.z,
                    nn.x * x1.z - nn.z * x1.x,
                    nn.y * x1.x - nn.x * x1.y);
  const axisLocal = vec3();
  MatrixTransformPoint(inv, axis, axisLocal);
  const rot = MatIdentity();
  MatrixRotateZ(rot, p.rz); MatrixRotateY(rot, p.ry); MatrixRotateX(rot, p.rx);
  MatrixRotateAxis(rot, axisLocal, BOUNCE_TUMBLE);
  const e = MatrixToEulerZYX(rot);
  p.spin = [e.rx - p.rx, e.ry - p.ry, e.rz - p.rz];
  const sum = tr + p.bodyRadius;
  const fa = p.bodyRadius / sum, fb = tr / sum;
  const pv = vec3(fa * C.x + fb * pick.x, fa * C.y + fb * pick.y,
                  fa * C.z + fb * pick.z);
  const pw = vec3();
  MatrixTransformPoint(cam.v2w, pv, pw);
  MatrixTransformPoint(inv, { x: pw.x - p.pos.x, y: pw.y - p.pos.y,
                              z: pw.z - p.pos.z }, p.pivot);
  return true;
}

/**
 * `ClosestPointOnLine` — `FUN_00445B10`. The foot of the perpendicular from
 * `c` to the **line** (not the segment) through `a` and `b`, into `out`, and
 * its distance returned — the FPU return Ghidra drops (`L1`).
 */
export function ClosestPointOnLine(c: Vec3, a: Vec3, b: Vec3, out: Vec3):
    number {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const t = -(((a.x - c.x) * dx + (a.y - c.y) * dy + (a.z - c.z) * dz)
              / (dx * dx + dy * dy + dz * dz));
  const ox = t * dx + (a.x - c.x), oy = t * dy + (a.y - c.y),
    oz = t * dz + (a.z - c.z);
  out.x = ox + c.x; out.y = oy + c.y; out.z = oz + c.z;
  return Math.sqrt(ox * ox + oy * oy + oz * oz);
}

/**
 * `LineSphereIntersect` — `FUN_00445C00`. Where the line through `a` and `b`
 * crosses the sphere of radius `r` at `c`: both points, or null when it
 * misses. A tangent gives the one point twice.
 */
export function LineSphereIntersect(r: number, c: Vec3, a: Vec3, b: Vec3):
    [Vec3, Vec3] | null {
  const f = vec3();
  const d = ClosestPointOnLine(c, a, b, f);
  if (d < r) {
    const q = (f.x !== a.x || f.y !== a.y || f.z !== a.z) ? a : b;
    const qd = Math.hypot(c.z - q.z, c.y - q.y, c.x - q.x);
    let k0: number, k1: number, len: number;
    if (d === 0) {
      len = qd;
      k0 = r / len;
      k1 = len + r;
    } else {
      len = Math.sqrt(qd * qd - d * d);
      const h = Math.sqrt(r * r - d * d);
      k0 = h / len;
      k1 = h + len;
    }
    k1 /= len;
    return [
      vec3((q.x - f.x) * k0 + f.x, (q.y - f.y) * k0 + f.y, (q.z - f.z) * k0 + f.z),
      vec3(k1 * f.x - k0 * q.x, k1 * f.y - k0 * q.y, k1 * f.z - k0 * q.z),
    ];
  }
  if (d === r) return [vec3(f.x, f.y, f.z), vec3(f.x, f.y, f.z)];
  return null;
}

/**
 * `CarriedPropIsOnScreen` — `FUN_004459C0`. The sphere at the shot point,
 * projected at `g_projection_distance_px` against a 640x480 frame; anything
 * at or behind the eye is off.
 */
export function CarriedPropIsOnScreen(p: CarriedProp): boolean {
  const { x, y, z } = p.shotPoint;
  if (0 <= z) return false;
  const r = p.radius;
  const ex = x <= 0 ? -x - r : r - x;
  const ey = y <= 0 ? -y - r : r - y;
  const k = PROJECTION_DISTANCE_PX / z;
  const sx = k * ex, sy = k * ey;
  const cx = -((PROJECTION_DISTANCE_PX * x) / z);
  const cy = -((PROJECTION_DISTANCE_PX * y) / z);
  if (((sx < 320 || cx < 320) && (-320 < sx || -320 < cx))
      && (sy < 240 || cy < 240)) {
    return !(sy <= -240 && cy <= -240);
  }
  return false;
}

/**
 * `RegisterForShotTest` (`FUN_00405160`)'s gate, for this pool. The list it
 * appends to is the renderer's pick; what the port owns is the decision.
 */
function RegisterForShotTest(p: CarriedProp): void {
  p.shootable = !(p.flags & SHOT_TEST_SKIP)
    && ((p.flags & SHOT_TEST_MESH) !== 0 || p.shotPoint.z <= 0);
}

/**
 * `obj+0x100 = point; RegisterForCameraTracking(obj)` (`FUN_00408EC0`) --
 * the pair every call site on this path writes. `[port-only]` as a function.
 */
function CarriedPropRegisterCameraPoint(p: CarriedProp, point: Vec3): void {
  p.lookAt.x = point.x;
  p.lookAt.y = point.y;
  p.lookAt.z = point.z;
  RegisterPropForCameraTracking(p.id, p.flags, p.pos);
}

/** The two camera matrices, `g_camera_world_to_view` and `g_camera_blocks`. */
export interface CameraPair { w2v: Mat; v2w: Mat }

/**
 * `[port-only]` — the pool step the engine gets from its task list, beside the
 * other non-actor pools in `GameUpdate`.
 */
export function CarriedPropPoolUpdate(rng: Rng, host: GameHost,
                                      events?: Events): void {
  if (!G.g_carried_props.length) return;
  const w2v = new Array(16).fill(0), v2w = new Array(16).fill(0);
  const cam = host.cameraMatrices?.(w2v, v2w) ? { w2v, v2w } : null;
  G.g_carried_props = G.g_carried_props.filter((p) => {
    p.shootable = false;
    switch (p.routine) {
      case CarriedPropRoutine.Init:
        CarriedPropInit(p);
        return true;
      case CarriedPropRoutine.Held:
        CarriedPropHeldUpdate(p, host, cam);
        return true;
      case CarriedPropRoutine.ThrowAtCamera:
        CarriedPropThrowAtCamera(p, cam, rng, events);
        return true;
      case CarriedPropRoutine.ThrowAtTarget:
        CarriedPropThrowAtTarget(p, host, cam, rng, events);
        return true;
      case CarriedPropRoutine.RollAtCamera:
        CarriedPropRollAtCamera(p, cam, rng, events);
        return true;
      case CarriedPropRoutine.FallFree:
        CarriedPropFallFree(p, cam, rng, events);
        return true;
      case CarriedPropRoutine.StuckToScreen:
        return CarriedPropStuckToScreen(p, cam?.v2w);
      case CarriedPropRoutine.Break:
        return CarriedPropBreakUpdate(p);
      default:
        // Every routine a shipped script can reach is above; a script naming
        // another `g_prop_behaviours` entry would leave the object here,
        // undrawn and unshootable. No shipped one does.
        p.draw = null;
        return true;
    }
  });
}

/**
 * `[port-only]` — the shot, from `render/`'s side of the seam: the line
 * `MarkActorShot` (`FUN_00404DB0`) runs on every registered object, and the
 * next update decides what it means.
 */
export function MarkCarriedPropShot(p: CarriedProp, player: number): void {
  p.flags |= (1 << ((player + 1) & 0x1f)) | ActorFlag.Hit;
}
