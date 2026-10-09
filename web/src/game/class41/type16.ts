/**
 * Class 0x41 constructor 16 -- six `dolam.bin` objects standing in stage 2's
 * warehouse water, which crack, fly and then float when shot.
 *
 * One spawn in the game: stage 2 block 24 step 1, evt `0x10980`, placed in the
 * same instruction as constructor 26's ripple task (`0x109A8`), whose rings
 * are centred on (-472.5, -1230.7) -- among these six, which stand at x -475
 * to -411, z -1230 to -1258. `[likely]` drums, from the file name (`dolam`);
 * the port names nothing for it.
 *
 * ## The routines `[proved]`
 *
 * `PlaceTable16Props` (`0x00462FE0`), `g_class41_constructors[16]`, from
 * the disassembly (`0x00462FE0`..`0x004630AB`):
 *
 * ```c
 * for (row = g_type16_prop_xz; row < g_type16_prop_xz + 6; row++) {
 *     obj = ActorAlloc(PropUpdateType16, 0x378); ActorClearGameFields(obj);
 *     obj->+0x34 = 0x80000001;
 *     obj->+0x1A0 = -1.9f;  obj->+0x19C = row.x * 0.1f;  obj->+0x1A4 = row.z * 0.1f;
 *     obj->+0x1D0 = rand() & 0x8000FFFF;       // with the sign fix-up: rand()
 *     obj->+0x11C = 2;  obj->+0x28C = 0xA50;  obj->+0x199 = (u8)placer->+0x11C;
 *     obj->+0x196 = (u8)g_evt_step_index;  obj->+0x197 = 0;  obj->+0x124 = 8.0f;
 * }
 * ```
 *
 * `PropUpdateType16` (`0x00468640`), transcribed below from the disassembly
 * (`0x00468640`..`0x00468C47`): an inline step lifetime against `+0x199`
 * **before** the scene-1 sweep, a three-arm hit switched on `+0x11C` -- 2
 * cracks (`0xA51`, no score, a rattle), 1 launches (`0xA56`, scored, the base
 * `0xA55` left behind), 0 re-seeds the bob of one already afloat -- the
 * flight, the landing below y -5.0, the bob, the rattle, the lit draw and the
 * shot sphere. Nothing in it touches `g_enemies_alive` or
 * `g_enemies_present`; it counts toward no gate.
 *
 * `SpawnType16DropStrip` (`0x00468C50`) and `Type16DropStripUpdate`
 * (`FUN_00468CA0`): the 29-frame `common.bin` strip the landing leaves at the
 * object's point.
 */
import type { Events } from "../../core/events";
import type { Rng } from "../../core/rng";
import { BAMS_TO_RAD_F64 } from "../../core/bams";
import { SpawnPropHitEffectScaled } from "../effects/sprite";
import { G } from "../globals";
import { T } from "../tables";
import { CameraBlockYaw } from "../camera/view";
import { MatrixRotateX, MatrixRotateY, MatrixRotateZ, MatrixScale,
         MatrixTranslate } from "../matrix";
import { MsvcRand } from "./group";
import { SCRIPT_FLAG_CLEAR_PROPS } from "./lifetime";
import { ActorDespawnProp, ActorKillProp, BreakablePropAwardHit } from "./prop";
import {
  PropDrawBegin, PropDrawSlot, PropMatrixPush,
  PropSubmitSlotWithSceneLightArray,
} from "./prop_draw";
import {
  BreakableFlag, makeBreakableProp, PropFamily, type BreakableProp,
} from "./prop_state";
import { PropRegisterForShotTest } from "./shot_test";
import { PropWords } from "./words";
import {
  TYPE16_BASE_SLOT, TYPE16_CRACKED_SLOT, TYPE16_LAUNCHED_SLOT,
  TYPE16_STRIP_FIRST, TYPE16_STRIP_LAST, TYPE16_WHOLE_SLOT,
} from "./type16_slots";

/** `FMUL float [0x0055D230]` -- the table's s16s are tenths. */
export const TYPE16_ROW_SCALE = Math.fround(0.1);
/** `MOV dword [ESI+0x1A0], 0xBFF33333` -- where every object stands. */
export const TYPE16_START_Y = Math.fround(-1.9);
/** `MOV word [ESI+0x11C], 2` -- two shots to launch one. */
export const TYPE16_SHOTS = 2;
/** `MOV dword [ESI+0x124], 0x41000000`. */
export const TYPE16_RADIUS = 8.0;

/** `g_scene_index` 1 -- stage 2, the one scene whose sweep this obeys. */
const SCENE_STAGE2 = 1;

/** `PUSH 0xE16A9` -- the crack and the knock afloat. */
export const SFX_TYPE16_HIT = 0xe16a9;
/** `PUSH 0x1616A9` -- the launch. */
export const SFX_TYPE16_LAUNCH = 0x1616a9;
/** `PUSH 0x4616A9` -- the landing. */
export const SFX_TYPE16_LAND = 0x4616a9;
/** `PUSH 0x3FC00000` -- `SpawnPropHitEffectScaled`'s size, 1.5. */
const TYPE16_HIT_EFFECT_SCALE = 1.5;

/** `FMUL double [0x005643D8]` -- the launch's horizontal speed, 0.1. */
export const TYPE16_LAUNCH_SPEED = 0.1;
/** `rand() & 0x80000003` (fixed up: `% 4`), `FMUL 0.1f`, `FADD 0.5f`. */
export const TYPE16_LAUNCH_VY_SPREAD = 4;
export const TYPE16_LAUNCH_VY_STEP = Math.fround(0.1);
export const TYPE16_LAUNCH_VY_BASE = 0.5;
/** `FSUB float [0x00569098]` -- gravity, 0.05444 a frame. */
export const TYPE16_GRAVITY = Math.fround(0.05444);
/** `FCOMP float [0x0055D79C]` and `MOV [ESI+0x1AC], 0xC0A00000` -- -5.0. */
export const TYPE16_WATER_Y = -5.0;
/** `MOV [ESI+0x1DC], EDI` with `EDI = 0x800` -- the bob's rate. */
export const TYPE16_BOB_RATE = 0x800;
/** `0x3FC00000` on landing, `0x3F000000` on a knock afloat. */
export const TYPE16_LAND_BOB = 1.5;
export const TYPE16_KNOCK_BOB = 0.5;
/** `FMUL float [0x004E30F8]` -- the bob decays by 0.35 a cycle. */
export const TYPE16_BOB_DECAY = Math.fround(0.35);
/** `MOV EAX, 0x2AAAAAAB; IMUL; SAR EDX, 3` -- the spin springs back by /48. */
export const TYPE16_SPRING_DIVISOR = 48;
/** `PUSH 0xC0F00000` -- the base's height, -7.5. */
export const TYPE16_BASE_Y = -7.5;
/**
 * The spin a hit seeds: `0x60 - (rand() % 2) * 0xA0 - rand() % 0x21` (`LEA
 * EDX, [EAX+EAX*4]; SHL EDX, 5` is the `* 0xA0`).
 */
export const TYPE16_SPIN_BASE = 0x60;
export const TYPE16_SPIN_FLIP = 0xa0;
export const TYPE16_SPIN_SPREAD = 0x21;
/** `rand() % 0xC9`, `FSUB 100.0f`, `FMUL [+0x2C4]`, `FMUL 0.01f`. */
export const TYPE16_RATTLE_SPREAD = 0xc9;
export const TYPE16_RATTLE_CENTRE = 100;
export const TYPE16_RATTLE_SCALE = Math.fround(0.01);
/** `FCOMP 0.01f`; `FMUL float [0x00564404]` -- 0.9 a frame. */
export const TYPE16_RATTLE_FLOOR = Math.fround(0.01);
export const TYPE16_RATTLE_DECAY = Math.fround(0.9);

/** `MOV dword [ESI+0x2C4], 0x3F800000` -- the crack's rattle. */
const TYPE16_CRACK_RATTLE = 1.0;
/** `PUSH 0x3FC00000` x3 into `MatrixScale` -- the drop strip's size. */
export const TYPE16_STRIP_SCALE = 1.5;

/**
 * The words of the 0x378 object this routine keeps that no shared field
 * carries. `+0x1AC` (the bob's centre) is `restY`, `+0x1B8` (where the launch
 * started) `restHeight`, `+0x1DC` (the bob's rate) `yawSpin`, `+0x1E8` (its
 * phase) `hingeB` and `+0x2C0` (its amplitude) `shake`, each read through the
 * field that carries that offset.
 */
export interface Type16Words {
  /** `obj+0x1B4` -- the launch's x, where the base is drawn. */
  o1b4: number;
  /** `obj+0x1BC` -- the launch's z. */
  o1bc: number;
  /** `obj+0x2C4` -- the rattle, 1.0 on a crack, times 0.9 a frame. */
  o2c4: number;
}
const TYPE16_WORDS: Type16Words = { o1b4: 0, o1bc: 0, o2c4: 0 };

/** `(s16)` of a word and `(char)` of a byte. */
const s16 = (v: number): number => (v << 16) >> 16;
const s8 = (v: number): number => (v << 24) >> 24;

/**
 * `PlaceTable16Props` — `FUN_00462FE0`. `g_class41_constructors[16]`.
 *
 * The rows are `g_type16_prop_xz`, which the bundle carries raw
 * (`breakables.type16_xz`); the placer contributes only `lifetime`, its
 * `+0x11C`, which each object keeps as the byte `+0x199`. See the file
 * comment for the listing.
 */
export function PlaceTable16Props(at: number, lifetime: number,
                                  rng: Rng): BreakableProp[] {
  return (T.breakables?.type16_xz ?? []).map((row) => {
    const p = makeBreakableProp(G.g_breakable_next_id++, 0, 0);
    p.family = PropFamily.Type16;
    p.at = at;
    p.flags = 0x80000000 | BreakableFlag.Live;
    p.y = TYPE16_START_Y;
    // `FILD; FMUL float; FSTP float`.
    p.x = Math.fround(row[0] * TYPE16_ROW_SCALE);
    p.z = Math.fround(row[1] * TYPE16_ROW_SCALE);
    p.yaw = MsvcRand(rng);
    p.hp = TYPE16_SHOTS;
    p.slot = TYPE16_WHOLE_SLOT;
    // `MOV DL, byte [EBP+0x11C]; MOV byte [ESI+0x199], DL`.
    p.lifetime = lifetime & 0xff;
    p.lastStepIndex = G.g_evt_step_index & 0xff;
    p.stepsElapsed = 0;
    p.hitRadius = TYPE16_RADIUS;
    // `ActorClearGameFields` (`FUN_004A73D0`) zeroed the rest.
    p.storyItem = 0;
    p.removeFlag = 0;
    PropWords(p, TYPE16_WORDS);
    return p;
  });
}

/** The spin a hit seeds, both draws in the engine's order. */
function Type16SeedSpin(rng: Rng): number {
  const flip = rng.int(2) * TYPE16_SPIN_FLIP;
  return TYPE16_SPIN_BASE - flip - rng.int(TYPE16_SPIN_SPREAD);
}

/**
 * `PropUpdateType16` — `FUN_00468640`. One object, one 60 Hz frame.
 *
 * `+0x11C` is {@link BreakableProp.hp}, the shots left and then 0 for one
 * afloat; `+0x199` {@link BreakableProp.lifetime}; `+0x1C0..+0x1C8` the
 * velocity; `+0x1D8`/`+0x1E0` {@link BreakableProp.spin}/`rollSpin`, added to
 * pitch and roll.
 */
export function PropUpdateType16(p: BreakableProp, rng: Rng,
                                 events?: Events): void {
  PropDrawBegin(p);
  let dx = 0;
  let dz = 0;
  // The inline lifetime, `0x00468658`: the byte counter and the byte limit,
  // compared signed, and before the sweep.
  if (s16(G.g_evt_step_index) !== s8(p.lastStepIndex)) {
    p.stepsElapsed = (p.stepsElapsed + 1) & 0xff;
    if (s8(p.stepsElapsed) > s8(p.lifetime)) {
      ActorDespawnProp(p);
      return;
    }
    p.lastStepIndex = G.g_evt_step_index & 0xff;
  }
  if (G.g_scene_index === SCENE_STAGE2
      && (G.g_script_flags[SCRIPT_FLAG_CLEAR_PROPS] ?? 0) !== 0) {
    ActorDespawnProp(p);
    return;
  }
  const w = PropWords(p, TYPE16_WORDS);

  const f = p.flags;
  if ((f & BreakableFlag.Hit) !== 0) {
    switch (s16(p.hp)) {
      case 0:
        // Afloat: knocked into a new bob.
        events?.emit("sound.play", { id: SFX_TYPE16_HIT });
        p.yawSpin = TYPE16_BOB_RATE;
        p.hingeB = 0;
        p.shake = TYPE16_KNOCK_BOB;
        p.spin = Type16SeedSpin(rng);
        p.rollSpin = Type16SeedSpin(rng);
        break;
      case 1: {
        // The second shot: launched, scored, the base left where it stood.
        BreakablePropAwardHit(f, true, rng);
        events?.emit("sound.play", { id: SFX_TYPE16_LAUNCH });
        p.slot = TYPE16_LAUNCHED_SLOT;
        // `FILD (yaw + 0x8000); FMUL double; FSIN; FMUL double 0.1; FSTP`.
        const a = ((CameraBlockYaw(G.g_camera_index) + 0x8000) | 0)
          * BAMS_TO_RAD_F64;
        p.vx = Math.fround(Math.sin(a) * TYPE16_LAUNCH_SPEED);
        p.vy = Math.fround(rng.int(TYPE16_LAUNCH_VY_SPREAD)
                           * TYPE16_LAUNCH_VY_STEP + TYPE16_LAUNCH_VY_BASE);
        w.o1b4 = p.x;
        p.restHeight = p.y;             // `+0x1B8`, which nothing reads back
        w.o1bc = p.z;
        p.vz = Math.fround(Math.cos(a) * TYPE16_LAUNCH_SPEED);
        p.spin = Type16SeedSpin(rng);
        p.rollSpin = Type16SeedSpin(rng);
        break;
      }
      case 2:
        // The first shot: cracked, turned to the camera block, rattling.
        BreakablePropAwardHit(f, false, rng);
        events?.emit("sound.play", { id: SFX_TYPE16_HIT });
        p.slot = TYPE16_CRACKED_SLOT;
        p.yaw = CameraBlockYaw(G.g_camera_index);
        p.hp = s16(p.hp - 1);
        w.o2c4 = TYPE16_CRACK_RATTLE;
        break;
      default:
        break;
    }
    // `SpawnPropHitEffectScaled(obj, (obj+0x34 & 2) ? 0 : 1, 1.5f)`
    // (`FUN_004666B0`) at the point `combat/shot.ts` left on the prop.
    if (p.hitAim) {
      SpawnPropHitEffectScaled(p.hitAim.x, p.hitAim.y, p.z,
                               TYPE16_HIT_EFFECT_SCALE);
    }
    p.flags &= ~BreakableFlag.Hit;
  }
  p.flags &= ~(BreakableFlag.HitByPlayer0 | BreakableFlag.HitByPlayer1);

  // The flight, `0x00468941`: the new vy stays on the FPU for the sum, and
  // the landing compares the unrounded height.
  if (s16(p.slot) === TYPE16_LAUNCHED_SLOT && s16(p.hp) !== 0) {
    const vy = p.vy - TYPE16_GRAVITY;
    p.pitch = (p.pitch + p.spin) | 0;
    p.vy = Math.fround(vy);
    p.roll = (p.roll + p.rollSpin) | 0;
    p.x = Math.fround(p.vx + p.x);
    const y = vy + p.y;
    p.y = Math.fround(y);
    p.z = Math.fround(p.vz + p.z);
    if (y < TYPE16_WATER_Y) {
      p.hp = 0;
      p.restY = TYPE16_WATER_Y;
      p.yawSpin = TYPE16_BOB_RATE;
      p.hingeB = 0;
      p.shake = TYPE16_LAND_BOB;
      SpawnType16DropStrip(p, rng);
      events?.emit("sound.play", { id: SFX_TYPE16_LAND });
    }
  }

  // Afloat, `0x00468A00`: the bob from the old phase, the decay on the new
  // one's low sixteen bits, and the spins sprung back toward zero.
  if (s16(p.hp) === 0) {
    const phase = p.hingeB;
    const next = (phase + p.yawSpin) | 0;
    p.hingeB = next;
    p.y = Math.fround(Math.sin(phase * BAMS_TO_RAD_F64) * p.shake + p.restY);
    if ((next & 0xffff) === 0) {
      p.shake = Math.fround(p.shake * TYPE16_BOB_DECAY);
    }
    const spin = (p.spin
      - Math.trunc(((p.spin + p.pitch) | 0) / TYPE16_SPRING_DIVISOR)) | 0;
    p.spin = spin;
    const rollSpin = (p.rollSpin
      - Math.trunc(((p.roll + p.rollSpin) | 0) / TYPE16_SPRING_DIVISOR)) | 0;
    p.rollSpin = rollSpin;
    p.pitch = (Math.trunc(spin / 2) + p.pitch) | 0;
    p.roll = (Math.trunc(rollSpin / 2) + p.roll) | 0;
  }

  // The rattle, two draws a frame while it lasts: x's first.
  if (w.o2c4 > TYPE16_RATTLE_FLOOR) {
    dx = Math.fround((rng.int(TYPE16_RATTLE_SPREAD) - TYPE16_RATTLE_CENTRE)
                     * w.o2c4 * TYPE16_RATTLE_SCALE);
    dz = Math.fround((rng.int(TYPE16_RATTLE_SPREAD) - TYPE16_RATTLE_CENTRE)
                     * w.o2c4 * TYPE16_RATTLE_SCALE);
    w.o2c4 = Math.fround(w.o2c4 * TYPE16_RATTLE_DECAY);
  }

  // `SubmitSlotWithSceneLightArray` (`FUN_004185E0`), twice for a launched
  // one: the object, then the base where it stood.
  const m = PropMatrixPush();
  MatrixTranslate(m, Math.fround(dx + p.x), p.y, Math.fround(dz + p.z));
  MatrixRotateY(m, p.yaw);
  MatrixRotateZ(m, p.roll);
  MatrixRotateX(m, p.pitch);
  PropSubmitSlotWithSceneLightArray(p, m, p.slot);           // 0x00468B9F
  if (s16(p.slot) === TYPE16_LAUNCHED_SLOT) {
    const b = PropMatrixPush();
    MatrixTranslate(b, w.o1b4, TYPE16_BASE_Y, w.o1bc);
    MatrixRotateY(b, p.yaw);
    PropSubmitSlotWithSceneLightArray(p, b, TYPE16_BASE_SLOT); // 0x00468BE9
  }
  // The sphere at the origin, without the rattle, every frame.
  PropRegisterForShotTest(p, p.x, p.y, p.z);
}

/**
 * `SpawnType16DropStrip` — `FUN_00468C50`. `ActorAlloc(Type16DropStripUpdate,
 * 0x50)` at the object's point, turned by one `rand()`, the strip's cursor at
 * `0x1339`. No `ActorClearGameFields`, and nothing but these is read.
 *
 * The task keeps its point at `+0x34..+0x3C`, its yaw at `+0x40` and its
 * cursor at `+0x48`; the port's object keeps them where every other family
 * keeps a position, a yaw and a slot. `ActorAlloc` appends it to the list
 * the pool is walking, so it takes its first step this frame.
 */
export function SpawnType16DropStrip(p: BreakableProp, rng: Rng): void {
  const q = makeBreakableProp(G.g_breakable_next_id++, 0, 0);
  q.family = PropFamily.Type16DropStrip;
  q.x = p.x;
  q.y = p.y;
  q.z = p.z;
  q.yaw = MsvcRand(rng);
  q.slot = TYPE16_STRIP_FIRST;
  G.g_breakable_props.push(q);
}

/**
 * `Type16DropStripUpdate` — `FUN_00468CA0`. Step, then draw: the first frame
 * shown is `0x133A` and the last `0x1356`, and the frame the cursor passes it
 * is an `ActorKill` with no draw.
 */
export function Type16DropStripUpdate(p: BreakableProp): void {
  PropDrawBegin(p);
  p.slot += 1;
  if (p.slot > TYPE16_STRIP_LAST) {
    ActorKillProp(p);
    return;
  }
  const m = PropMatrixPush();
  MatrixTranslate(m, p.x, p.y, p.z);
  MatrixRotateY(m, p.yaw);
  MatrixScale(m, TYPE16_STRIP_SCALE, TYPE16_STRIP_SCALE, TYPE16_STRIP_SCALE);
  // `NoOpStub(1.5)` between the scale and the draw: empty.
  PropDrawSlot(p, m, p.slot);
}
