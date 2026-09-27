/**
 * What a stacked breakable prop becomes when its second shot lands: one
 * object carrying fifteen pieces.
 *
 * `BreakablePropUpdate` (`FUN_00464620`) sends a destroyed prop whose group
 * record puts it above stack level 0 to `0x00464BBD`, which is
 * `BreakablePropSpawnShatter(obj); ActorKill();`. The same two calls end the
 * group-4 script break at `0x0046493F`. The spawn is **one**
 * `ActorAlloc(BreakablePropShatterUpdate, 0x2B4)`, not fifteen: the pieces are
 * parallel arrays inside it.
 *
 * ```
 * obj+0x034  u8     the prop's member (+0x290)
 * obj+0x035  u8     the prop's group  (+0x194); 0x63 turns the floor off
 * obj+0x036  u8     the prop's +0x324; picks the slot table
 * obj+0x038  15 x { f32 x, y, z }        position
 * obj+0x0EC  15 x { s16 rx, ry, rz }     BAMS, drawn Rz Ry Rx
 * obj+0x148  15 x { f32 vx, vy, vz }     per 60 Hz frame
 * obj+0x1FC  15 x i32                    rx spin    } only the low sixteen
 * obj+0x238  15 x i32                    ry spin    } bits are ever added
 * obj+0x274  15 x i32                    rz spin    }
 * obj+0x2B0  i32    frames run
 * ```
 *
 * Every piece is a model and nothing else: no shot test, no collision with
 * anything but the ground plane, no `rand()` once it is thrown. That is why
 * the port once let the prop go with an event instead -- and why that was
 * wrong: the spawn draws 75 `rand()`s, so a port without it runs the rest of
 * the stage on a different random stream from the game.
 *
 * ## Plain records in `G`, not a `Scope`
 *
 * The engine allocates a task; `game/` holds a fixed pool and a snapshot slice
 * has to survive `clonePlain`, so the shatters are an array in `G` the way
 * `g_severed_heads` and `g_prop_strip_effects` are. `render/prop_shatter.ts`
 * draws them.
 */
import type { Events } from "../../core/events";
import type { Rng } from "../../core/rng";
import { G } from "../globals";
import {
  MatIdentity, MatrixGetTranslation, MatrixMultiply, MatrixRotateX,
  MatrixRotateY, MatrixRotateZ, MatrixToEulerZYX, MatrixTranslate,
  type Mat,
} from "../matrix";
import { T } from "../tables";
import { vec3 } from "../vec";
import { MsvcRand } from "./group";
import type { BreakableProp } from "./prop_state";

/** `CMP ESI, 0x5A` in steps of six at `0x00465388`: fifteen pieces. */
export const SHATTER_PIECES = 15;
/** `FSUB [0x00569048]`, `0x3D8B5DCC` — gravity on every piece, per frame. */
export const SHATTER_GRAVITY = 0.06804999709129333;
/** `FMUL [0x00569044]`, `0xBF4CCCCD` — what a bounce keeps of `vy`. */
export const SHATTER_BOUNCE = -0.800000011920929;
/** `FADD [0x004C4380]` — the pieces land one unit above the ground plane. */
export const SHATTER_FLOOR_RISE = 1.0;
/** `CMP byte ptr [ECX+0x35], 0x63` — the one group whose pieces never land. */
export const SHATTER_NO_FLOOR_GROUP = 0x63;
/**
 * `CMP EAX, 0x48` on the count **before** it is incremented, at `0x004653BA`:
 * the frames that read 0..0x48 all step and draw -- 73 of them -- and the
 * 74th `ActorKill`s the object.
 */
export const SHATTER_FRAMES = 0x48;
/** `MOV [EDI+0x110], 0x3F800000` — every piece is thrown upward at 1.0. */
export const SHATTER_RISE_SPEED = 1.0;
/**
 * `rand() % 0x15 * 0.01 + 0.1` — the horizontal throw, drawn separately for
 * `x` and `z`, along piece `i`'s bearing `i * 0x1000`.
 */
export const SHATTER_SPEED_SPREAD = 0x15;
export const SHATTER_SPEED_STEP = 0.009999999776482582;
export const SHATTER_SPEED_BASE = 0.10000000149011612;
/** `ADD [ESP+0x38], 0x1000` per piece: sixteen bearings, fifteen used. */
export const SHATTER_BEARING_STEP = 0x1000;
/** `rand() % 0x801 - 0x400` — each spin, in BAMS a frame. */
export const SHATTER_SPIN_SPREAD = 0x801;
export const SHATTER_SPIN_CENTRE = 0x400;
/** `FMUL [0x0055D2B0]` — the offset table is in thousandths. */
const OFFSET_SCALE = 0.0010000000474974513;
/** `FMUL double [0x004C4370]` — BAMS to radians, `2pi / 65536`. */
const BAMS_TO_RADIANS = 9.587379924285257e-05;

/** One of the fifteen. Field `i` of each of the object's parallel arrays. */
export interface ShatterPiece {
  x: number;              // +0x038 + 12i
  y: number;              // +0x03C + 12i
  z: number;              // +0x040 + 12i
  /** s16 BAMS; the draw is `RotZ(rz); RotY(ry); RotX(rx)`. */
  rx: number;             // +0x0EC + 6i
  ry: number;             // +0x0EE + 6i
  rz: number;             // +0x0F0 + 6i
  vx: number;             // +0x148 + 12i
  vy: number;             // +0x14C + 12i
  vz: number;             // +0x150 + 12i
  /** BAMS a frame, added to the angle as a sixteen-bit word. */
  sx: number;             // +0x1FC + 4i
  sy: number;             // +0x238 + 4i
  sz: number;             // +0x274 + 4i
  /**
   * [port-only] The slot the draw hands `AssetDrawSlot` for this piece:
   * `g_shatter_fragment_slots_a[i]`, or `_b[i]` when `obj+0x36` is non-zero.
   * The draw picks it every frame; its only input is written once, at the
   * spawn, so it is picked there and left here for `render/`.
   */
  slot: number;
}

/** The 0x2B4 object `BreakablePropSpawnShatter` allocates. */
export interface PropShatter {
  /** `[port-only]` — the engine's identity is the task pointer. */
  id: number;
  /** `obj+0x34` — the prop's member index, as a byte. Nothing reads it. */
  member: number;
  /** `obj+0x35` — the prop's group; `0x63` switches the floor off. */
  group: number;
  /** `obj+0x36` — the prop's `+0x324`; non-zero draws table `_b`. */
  effect: number;
  /** `obj+0x2B0` — frames run. */
  frames: number;
  pieces: ShatterPiece[];
}

/** `(s16)(a + b)`: the engine adds the spins with a 16-bit `ADD`. */
function AddS16(a: number, b: number): number {
  return ((a + b) << 16) >> 16;
}

/**
 * The two camera matrices, as `GameHost.cameraMatrices` hands them over, or
 * null with no camera. The same shape `carried_prop.ts` passes about.
 */
export interface ShatterCamera { w2v: Mat; v2w: Mat }

/**
 * `BreakablePropSpawnShatter` — `FUN_00465170`.
 *
 * ```
 * obj = ActorAlloc(BreakablePropShatterUpdate, 0x2B4);  obj+0x2B0 = 0;
 * obj+0x34..0x36 = prop+0x290, prop+0x194, prop+0x324   (bytes)
 * MatrixStackPush(0); MatrixInvert(0); MatrixMultiply(prop+0x2E4);
 * for (i = 0; i < 15; i++) {
 *     MatrixStackPush(0);
 *     MatrixTranslate(off[i].x * .001, off[i].y * .001, off[i].z * .001);
 *     MatrixRotateZ(ang[i].rz); MatrixRotateY(ang[i].ry); MatrixRotateX(ang[i].rx);
 *     MatrixGetTranslation(&pos[i]);  MatrixToEulerZYX(&rx[i], &ry[i], &rz[i]);
 *     MatrixStackPop(1);
 *     vx[i] = sin(i * 0x1000) * (rand() % 0x15 * .01 + .1);
 *     vz[i] = cos(i * 0x1000) * (rand() % 0x15 * .01 + .1);   vy[i] = 1.0;
 *     sx[i] = rand() % 0x801 - 0x400;  sy[i] = ...;  sz[i] = ...;
 * }
 * MatrixStackPop(1);
 * ```
 *
 * Read from the disassembly, `0x00465170`..`0x004653A6`: the decompiler shows
 * the first piece and nothing of the loop, because it ends the body at the
 * `MatrixStackPop` it has marked no-return (L37).
 *
 * `prop+0x2E4` is the matrix the prop's last draw stored, **with** the view
 * under it; `MatrixInvert(0)` takes off the view that is on the stack *now*.
 * `cam` is both halves of that: the stored view comes from the prop and the
 * current one from the host. With no camera there is no view on either side
 * and the pieces start from the model matrix as it is.
 */
export function BreakablePropSpawnShatter(p: BreakableProp, rng: Rng,
                                          cam: ShatterCamera | null,
                                          events?: Events): PropShatter {
  const s: PropShatter = {
    id: G.g_prop_shatter_seq++,
    member: p.member & 0xff,
    group: p.group & 0xff,
    effect: p.effect & 0xff,
    frames: 0,
    pieces: [],
  };

  // MatrixStackPush(0); MatrixInvert(0); MatrixMultiply(prop+0x2E4). The
  // engine's `prop+0x2E4` is the model on top of the view it was drawn under,
  // so the product here is `model * view(then) * view(now)^-1`.
  const base = cam ? cam.v2w.slice(0, 16) : MatIdentity();
  if (cam && p.drawView.length === 16) MatrixMultiply(base, p.drawView);
  MatrixMultiply(base, p.drawMatrix.length === 16
    ? p.drawMatrix : MatIdentity());

  const table = T.breakables?.shatter;
  const at = vec3();
  for (let i = 0; i < SHATTER_PIECES; i++) {
    const [ox, oy, oz] = table?.offsets[i] ?? [0, 0, 0];
    const [ax, ay, az] = table?.angles[i] ?? [0, 0, 0];
    const m = base.slice(0, 16);
    MatrixTranslate(m, ox * OFFSET_SCALE, oy * OFFSET_SCALE, oz * OFFSET_SCALE);
    MatrixRotateZ(m, az);
    MatrixRotateY(m, ay);
    MatrixRotateX(m, ax);
    MatrixGetTranslation(m, at);
    const e = MatrixToEulerZYX(m);

    // `FILD [ESP+0x38]` — the bearing counter, `i * 0x1000`, as an integer
    // BAMS angle. `x` then `z`, each with its own draw.
    const bearing = i * SHATTER_BEARING_STEP * BAMS_TO_RADIANS;
    const vx = Math.sin(bearing) * ((MsvcRand(rng) % SHATTER_SPEED_SPREAD)
      * SHATTER_SPEED_STEP + SHATTER_SPEED_BASE);
    const vz = Math.cos(bearing) * ((MsvcRand(rng) % SHATTER_SPEED_SPREAD)
      * SHATTER_SPEED_STEP + SHATTER_SPEED_BASE);
    // `[EBX-0x3C]`, `[EBX]`, `[EBX+0x38]` after `EBX += 4`: rx, ry, rz spins.
    const sx = (MsvcRand(rng) % SHATTER_SPIN_SPREAD) - SHATTER_SPIN_CENTRE;
    const sy = (MsvcRand(rng) % SHATTER_SPIN_SPREAD) - SHATTER_SPIN_CENTRE;
    const sz = (MsvcRand(rng) % SHATTER_SPIN_SPREAD) - SHATTER_SPIN_CENTRE;

    s.pieces.push({
      x: at.x, y: at.y, z: at.z,
      rx: e.rx, ry: e.ry, rz: e.rz,
      vx, vy: SHATTER_RISE_SPEED, vz,
      sx, sy, sz,
      slot: ShatterPieceSlot(s, i),
    });
  }
  G.g_prop_shatters.push(s);
  events?.emit("prop.shattered", { id: p.id, x: p.x, y: p.y, z: p.z });
  return s;
}

/**
 * `BreakablePropShatterUpdate` — `FUN_004653B0`. One frame of all fifteen.
 * Returns false on the frame it `ActorKill`s itself.
 *
 * ```
 * if (obj+0x2B0++ > 0x48) ActorKill();                  // JMP 0x004A7040
 * for (i = 0; i < 15; i++) {
 *     vy[i] -= 0.06805;  pos[i] += v[i];
 *     rx[i] += sx[i];  ry[i] += sy[i];  rz[i] += sz[i];  // 16-bit ADDs
 *     if (pos[i].y < g_camera_fixed_eye_y + 1.0 && obj+0x35 != 0x63) {
 *         pos[i].y = g_camera_fixed_eye_y + 1.0;  vy[i] *= -0.8;
 *     }
 *     Push; Translate(pos[i]); RotZ(rz[i]); RotY(ry[i]); RotX(rx[i]);
 *     AssetDrawSlot(obj+0x36 ? g_shatter_fragment_slots_b[i]
 *                            : g_shatter_fragment_slots_a[i]);  Pop;
 * }
 * ```
 *
 * Again the loop is past the end Ghidra gives the function: the decompiler
 * shows piece 0 only (L37).
 */
export function BreakablePropShatterUpdate(s: PropShatter): boolean {
  const was = s.frames;
  s.frames = was + 1;
  if (was > SHATTER_FRAMES) return false;

  const floor = G.g_camera_fixed_eye_y + SHATTER_FLOOR_RISE;
  for (const q of s.pieces) {
    q.vy -= SHATTER_GRAVITY;
    q.x += q.vx;
    q.y += q.vy;
    q.z += q.vz;
    q.rx = AddS16(q.rx, q.sx);
    q.ry = AddS16(q.ry, q.sy);
    q.rz = AddS16(q.rz, q.sz);
    // `FCOM` then `TEST AH, 0x41`: strictly below, and never for group 0x63.
    if (floor > q.y && s.group !== SHATTER_NO_FLOOR_GROUP) {
      q.y = floor;
      q.vy *= SHATTER_BOUNCE;
    }
  }
  return true;
}

/**
 * `[port-only]` as a function: the slot `BreakablePropShatterUpdate` draws for
 * piece `i` — the one decision in its draw block, made in `game/` because it
 * is the routine's, and kept on {@link ShatterPiece.slot}. Zero, the tables'
 * own terminator, for a bundle that carries none.
 */
export function ShatterPieceSlot(s: PropShatter, i: number): number {
  const table = T.breakables?.shatter;
  const slots = s.effect !== 0 ? table?.slots_b : table?.slots_a;
  return slots?.[i] ?? 0;
}

/** `[port-only]` — walk the pool, as `PropStripEffectsTick` does its own. */
export function PropShattersTick(): void {
  if (!G.g_prop_shatters.length) return;
  G.g_prop_shatters = G.g_prop_shatters.filter(BreakablePropShatterUpdate);
}
