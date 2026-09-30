/**
 * Class 0x41 constructor 17 -- three small `bridge.bin` pieces that fall from
 * the placer's point, and bounce back up each time one is shot.
 *
 * One spawn in the game: stage 2 block 21 step 2, evt `0xECBC`, at
 * `(-815, 75, -1298.8)`. The models are `bridge.bin[4]`, `[5]` and `[6]`,
 * drawn at a twentieth of their size. `[open]` what they depict.
 *
 * ## The routines `[proved]`
 *
 * `PlaceType17Props` (`0x004630B0`), `g_class41_constructors[17]`, from the
 * disassembly (`0x004630B0`..`0x00463154`) -- the pseudocode reads the three
 * offsets as one `fsin` with an operand missing, and it is one `fsin` whose
 * product is used three times:
 *
 * ```c
 * for (i = 0, a = 0; a < 0xC000; i++, a += 0x4000) {
 *     obj = ActorAlloc(PropUpdateType17, 0x378); ActorClearGameFields(obj);
 *     obj->+0x290 = i;
 *     s = fsin(a * 2pi/65536);                       // 0, 1, sin(pi)
 *     obj->+0x19C = placer->+0x40 + s * 5.0;         // double 0x00565E10
 *     obj->+0x1A0 = placer->+0x44 + s * 4.0;         // double 0x004C4CA8
 *     obj->+0x1A4 = placer->+0x48 + s * 5.0;
 *     obj->+0x1C4 = -0.1f;  obj->+0x124 = 2.0f;  obj->+0x34 = 0x80000001;
 * }
 * ```
 *
 * so objects 0 and 2 start at the placer's point and object 1 five units out
 * on x and z and four up. No lifetime word is written, and the routine reads
 * none.
 *
 * `PropUpdateType17` (`0x00468D10`), from `0x00468D10`..`0x00468E44`:
 *
 * ```c
 * if (obj->+0x34 & 8) {
 *     BreakablePropAwardHit(obj->+0x34, 1);  obj->+0x34 &= ~8;
 *     SpawnPropHitEffectScaled(obj, (obj->+0x34 & 2) == 0, 1.2f);
 *     PlaySoundId(0xE16A9);  obj->+0x1C4 = 0.3f;
 * }
 * obj->+0x1C4 -= 0.05444f;  obj->+0x1A0 += obj->+0x1C4;
 * if (obj->+0x1A0 < g_camera_fixed_eye_y) { ActorDespawn(obj); return; }
 * Push(0); T(x, y, z); Scale(0.05, 0.05, 0.05); NoOpStub(0.05);
 * AssetDrawSlot(0x842 + obj->+0x290); Pop;
 * RegisterForShotTest at (x, y, z).
 * ```
 *
 * Every hit scores and bounces it; only bit 3 is cleared, so the two player
 * bits a hit sets stay set. Nothing here touches an enemy counter.
 */
import type { Events } from "../../core/events";
import type { Rng } from "../../core/rng";
import { BAMS_TO_RAD_F64 } from "../../core/bams";
import { SpawnPropHitEffectScaled } from "../effects/sprite";
import { G } from "../globals";
import { MatrixScale, MatrixTranslate } from "../matrix";
import { ActorDespawnProp, BreakablePropAwardHit } from "./prop";
import { PropDrawBegin, PropDrawSlot, PropMatrixPush } from "./prop_draw";
import {
  BreakableFlag, makeBreakableProp, PropFamily, type BreakableProp,
} from "./prop_state";
import { PropRegisterForShotTest } from "./shot_test";
import { TYPE17_FIRST_SLOT, TYPE17_OBJECTS } from "./type17_slots";

/** `ADD EBP, 0x4000` -- the angle each object's offset is the sine of. */
export const TYPE17_ANGLE_STEP = 0x4000;
/** `FMUL double [0x00565E10]` and `[0x004C4CA8]` -- 5.0 across, 4.0 up. */
export const TYPE17_OFFSET_XZ = 5.0;
export const TYPE17_OFFSET_Y = 4.0;
/** `MOV dword [ESI+0x1C4], 0xBDCCCCCD` -- the fall it starts on. */
export const TYPE17_START_VY = Math.fround(-0.1);
/** `MOV dword [ESI+0x124], 0x40000000`. */
export const TYPE17_RADIUS = 2.0;
/** `MOV dword [ESI+0x1C4], 0x3E99999A` -- a hit's bounce. */
export const TYPE17_BOUNCE_VY = Math.fround(0.3);
/** `FSUB float [0x00569098]`. */
export const TYPE17_GRAVITY = Math.fround(0.05444);
/** `PUSH 0x3D4CCCCD` x3 into `MatrixScale`. */
export const TYPE17_SCALE = Math.fround(0.05);
/** `PUSH 0x3F99999A` -- `SpawnPropHitEffectScaled`'s size. */
const TYPE17_HIT_EFFECT_SCALE = Math.fround(1.2);
/** `PUSH 0xE16A9`. */
export const SFX_TYPE17_HIT = 0xe16a9;

/**
 * `PlaceType17Props` — `FUN_004630B0`. `g_class41_constructors[17]`.
 * `x, y, z` are the placer's `+0x40..+0x48`; nothing else of it is read.
 */
export function PlaceType17Props(at: number, x: number, y: number,
                                 z: number): BreakableProp[] {
  const out: BreakableProp[] = [];
  for (let i = 0; i < TYPE17_OBJECTS; i++) {
    const p = makeBreakableProp(G.g_breakable_next_id++, 0, 0);
    p.family = PropFamily.Type17;
    p.at = at;
    p.kind = i;                                   // +0x290
    // `FILD; FMUL double; FSIN` once, and the product used three times.
    const s = Math.sin(i * TYPE17_ANGLE_STEP * BAMS_TO_RAD_F64);
    p.x = Math.fround(x + s * TYPE17_OFFSET_XZ);
    p.y = Math.fround(y + s * TYPE17_OFFSET_Y);
    p.z = Math.fround(z + s * TYPE17_OFFSET_XZ);
    p.vy = TYPE17_START_VY;
    p.hitRadius = TYPE17_RADIUS;
    p.flags = 0x80000000 | BreakableFlag.Live;
    // `ActorClearGameFields` (`FUN_004A73D0`) zeroed the rest.
    p.storyItem = 0;
    p.removeFlag = 0;
    out.push(p);
  }
  return out;
}

/** `PropUpdateType17` — `FUN_00468D10`. One object, one 60 Hz frame. */
export function PropUpdateType17(p: BreakableProp, rng: Rng,
                                 events?: Events): void {
  PropDrawBegin(p);
  const f = p.flags;
  if ((f & BreakableFlag.Hit) !== 0) {
    BreakablePropAwardHit(f, true, rng);
    p.flags &= ~BreakableFlag.Hit;
    if (p.hitAim) {
      SpawnPropHitEffectScaled(p.hitAim.x, p.hitAim.y, p.z,
                               TYPE17_HIT_EFFECT_SCALE);
    }
    events?.emit("sound.play", { id: SFX_TYPE17_HIT });
    p.vy = TYPE17_BOUNCE_VY;
  }
  // `FSUB; FST [+0x1C4]; FADD [+0x1A0]; FST [+0x1A0]; FCOMP` -- the compare
  // is of the unrounded sum.
  const vy = p.vy - TYPE17_GRAVITY;
  p.vy = Math.fround(vy);
  const y = vy + p.y;
  p.y = Math.fround(y);
  if (y < G.g_camera_fixed_eye_y) {
    ActorDespawnProp(p);
    return;
  }
  const m = PropMatrixPush();
  MatrixTranslate(m, p.x, p.y, p.z);
  MatrixScale(m, TYPE17_SCALE, TYPE17_SCALE, TYPE17_SCALE);
  // `NoOpStub(0.05)` between the scale and the draw: empty.
  PropDrawSlot(p, m, TYPE17_FIRST_SLOT + ((p.kind << 16) >> 16));
  PropRegisterForShotTest(p, p.x, p.y, p.z);
}
