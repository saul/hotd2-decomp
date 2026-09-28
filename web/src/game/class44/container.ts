/**
 * The falling container: `FallingContainerUpdate`'s object, and the **two**
 * constructors that build it.
 *
 * `FallingContainerUpdate` is `g_class41_updates[34]` (`0x00593744`) and the
 * routine class 0x44 selector 16 hands `ActorAlloc` — one routine, two
 * builders:
 *
 * * **class 0x44 selector 16**, `PlaceFallingContainer` — stage 2's two, at
 *   evt `0xD48C` and `0xD4BC`, each with a story item of its own;
 * * **class 0x41 type 34**, `PlaceGenericProp` case 0x22 (`0x004620DA`) —
 *   `g_class41_constructors[34]` (`0x00593608`) is `PlaceGenericProp`
 *   (`FUN_00461CF0`) itself `[proved]`. Twelve spawns: stages 1 (two), 3
 *   (two), 4 (six) and 5 (two).
 *
 * The first shot knocks it **loose**: it is thrown upward and tumbles under
 * gravity until a hull point reaches its floor, and only the second shot
 * breaks it — into two pieces (`class44/container_fragment.ts`) and, when its
 * item set runs out, the item.
 *
 * ## The two constructors build the same object, less three words
 *
 * `[proved]` from `0x00473940`..`0x00473A6D` and `0x004620DA`..`0x0046216B`
 * (after `PlaceGenericProp`'s prologue, `0x00461D18`..`0x00461D9E`):
 *
 * | word | selector 16 | type 34 (prologue, then arm) |
 * |---|---|---|
 * | `+0x19C..0x1A4` | placer pos | placer pos |
 * | `+0x1D0` yaw | `placer+0x68` | `placer+0x68` |
 * | `+0x1CC` pitch | 0 | **`placer+0x64`** — the set-size word |
 * | `+0x1D4` roll | 0 | **`placer+0x6C`** |
 * | `+0x290` kind | `placer+0x6C` | 0 |
 * | `+0x324`/`+0x328` | `g_prop_kind_params[kind]` effect/motion | 0 |
 * | `+0x11C` | 2 | 2 (over the prologue's `placer+0x11C`) |
 * | `+0x28C` | `0xA50` | `0xA50` |
 * | `+0x124` | 8.0 | 8.0 |
 * | `+0x2E0` floor | `y - 7.35f` | `y - 7.35f` |
 * | `+0x199` lifetime | `desc[0]` (s8) | `(u8)placer+0x11C` |
 * | `+0x194` item set | `desc[4]` (s8) | `(s8)placer+0x1F4` = desc+0x24 |
 * | `+0x2A0` story item | `desc[8]` (s32) | -1 |
 * | `+0x192`, `+0x196`, `+0x197`, `+0x32C`, `+0x330`, `+0x34` | 0, step, 0, 0, 0, `0x80000001` | the same |
 * | countdown | `(s8)+0x194 > 0`: `placer+0x64 > 1 ? rand() % placer+0x64 + 1 : 1` | the same |
 *
 * `desc` is the class-0x44 placer's parameter tail at `placer+0x1390`. The
 * routine never reads `+0x290`, `+0x324` or `+0x328` (every operand in
 * `0x0046A580`..`0x0046ACF9` was read), so the kind and effect differences are
 * invisible; **the pitch and roll are not**. A type-34 container starts
 * pitched by its set-size word — 1 or 2 BAMS on nine of the twelve shipped
 * spawns, all twelve with roll 0 — and the settle eases that pitch like any
 * other. The port used to build type 34 with the selector-16 constructor,
 * dropping both; {@link PlaceGenericPropType34} is the arm, for
 * `PlaceGenericProp` to run.
 *
 * ## `obj+0x11C` is the shot count, and `obj+0x199` the lifetime
 *
 * `[proved]`. The routine opens with its **own** step lifetime against the s8
 * `+0x199` (`0x0046A58B`..`0x0046A5CD`, `MOV CL,[EDI+0x199] ; CMP AL,CL ;
 * JLE`) and calls neither `PropExpireByStepLifetime` (`FUN_00466640`) nor
 * anything else that reads `+0x11C` as a lifetime. `+0x11C` is read four ways,
 * all as shots left: the hit gate `TEST CX,CX ; JLE` (`0x0046A633`), the switch
 * `DEC ECX ; JZ` / `DEC ECX ; JNZ` (`0x0046A63F`..`0x0046A647`), the
 * `DEC word [EDI+0x11c]` after it (`0x0046A712`), and `CMP word
 * [EDI+0x11c],0 ; JLE` before `RegisterForShotTest` (`0x0046AC9D`). So the
 * literal 2 both arms write is two shots. The break writes `+0x11C =
 * (s16)(s8)+0x199` just before each item spawner and 1 after it (`0x0046A991`,
 * `0x0046AA0F`, `0x0046AA35`, `0x0046AA6E`), which is the spawners' business.
 * In the port `hp` is `+0x11C` and `lifetime` is `+0x199` for this family.
 *
 * ## The routine, `0x0046A580`..`0x0046ACF9` `[proved]`
 *
 * ```
 * 0046a58b  inline lifetime on (s8)+0x199            -> ActorDespawn
 * 0046a5d3  g_scene_index == 1 && g_script_flags[0x77] -> ActorDespawn
 * 0046a5fb  g_active_cam_path == 0x2F && g_cam_path_frame == 0x96 -> ActorDespawn
 * 0046a621  if ((f & 8) && (s16)+0x11C > 0) {
 *             1: the break (below; ends in ActorDespawn)
 * 0046a64d    2: BreakablePropAwardHit(f, 0); PlaySoundId(0xE16A9);
 *                +0x28C = 0xA51; +0x1D0 = g_camera_block_yaw_bams;
 *                SpawnPropHitEffectScaled(obj, (f & 2) ? 0 : 1, 1.5);
 *                +0x34 &= ~8;                          ; 0x0046A6AA
 *                vy = rand() % 0x29 * 0.01f + 0.8f;
 *                +0x1D8 = -0x180 - rand() % 0x101; +0x192 = 1;
 *                +0x1E0 = -0x80 - rand() % 0x81
 * 0046a712    +0x11C -= 1
 *           }
 * 0046a723  +0x34 &= ~6
 * 0046aa86  state 1: vy -= 0.05444f; pitch += spin; roll += rollSpin; y += vy;
 *             if (FallingContainerGroundContact(obj, hull, 0x30) && vy < 0)
 *               { state = 2; PlaySoundId(rand() & 1 ? 0x1816A9 : 0x1916A9) }
 * 0046a737  state 2: rollSpin -= (roll + rollSpin) / 32; roll += rollSpin;
 *                    spin -= (pitch + 0x4000 + spin) / 32; pitch += spin;
 *                    FallingContainerGroundContact(obj, hull, 0x30)
 * 0046ab21  state 2: Push; T(+0x1A8..0x1B0) . Rz . Ry . Rx . T(hull[contact] * -0.001f);
 *                    draw +0x28C; MatrixStore(+0x2E4); Pop
 *           else:    Push; T(x, y, z) . Rz . Ry . Rx; draw +0x28C; Pop
 *           (lit or unlit on g_scene_lighting -- one recorded call either way)
 * 0046ac9d  if ((s16)+0x11C > 0) RegisterForShotTest(obj) at (x, y, z)
 * ```
 *
 * The break (`0x0046A7A4`): `BreakablePropAwardHit(f, 1)`; `PlaySoundId(rand()
 * & 1 ? 0x1616A9 : 0x1716A9)`; the two pieces (ten `rand()`s); then either the
 * `g_GameMode == 1 && byte [0x009C88AA]` extra life (`[open]` — see
 * `ReleaseHiddenItem`) or the item-set countdown and its release, with a story
 * item seated half a unit above the floor and a set's item on it; then
 * `ActorDespawn`. Every `PlaySoundId` and `MatrixStackPop` in it is marked
 * no-return, so the pseudocode stops at the first of each (`L35`).
 */
import type { Events } from "../../core/events";
import type { Rng } from "../../core/rng";
import type { BreakablePlacement } from "../../bundle";
import { G } from "../globals";
import { FALLING_CONTAINER_RADIUS, PropRegisterForShotTest }
  from "../class41/shot_test";
import { T } from "../tables";
import { BAMS } from "../vec";
import { MatrixTranslate } from "../matrix";
import { SpawnPropHitEffectScaled } from "../effects/sprite";
import { ReleaseHiddenItem } from "../class41/items";
import { ActorDespawnProp, BreakablePropAwardHit } from "../class41/prop";
import {
  PropDrawBegin, PropDrawSlot, PropMatrixPush, PropMatrixTRzRyRx,
} from "../class41/prop_draw";
import {
  BreakableFlag, BreakableState, makeBreakableProp, PropFamily,
  type BreakableProp,
} from "../class41/prop_state";

/**
 * `FSUB float [0x00568FF8]` (`0x40EB3333`, 7.35): how far the container's
 * floor, `+0x2E0`, sits below its origin. Both constructors.
 */
export const FALLING_FLOOR_DROP = 7.35;

/** `MOV word [ESI+0x28C],0xA50` / `0xA51` — whole, then knocked loose. */
export const FALLING_SLOT_WHOLE = 0xa50;
export const FALLING_SLOT_LOOSE = 0xa51;
/** `MOV word ptr [ESI+0x28C], 0xA55` — what each of its two pieces draws. */
export const FALLING_SLOT_FRAGMENT = 0xa55;

/**
 * `FSUB float [0x00569098]` (`0x3D5EFC7A`, 0.05444) — gravity while it
 * tumbles; its pieces use the same.
 */
export const FALLING_GRAVITY = 0.05444;

/** `FallingContainerGroundContact`'s wall: scene 1, block `0x12`, `x = -840`. */
export const FALLING_WALL_SCENE = 1;
export const FALLING_WALL_BLOCK = 0x12;
export const FALLING_WALL_X = -840.0;

/**
 * `g_script_flags[0x77]` in scene 1, and camera path `0x2F` at frame `0x96`:
 * the two things besides its lifetime that take a container away
 * (`0x0046A5D3`, `0x0046A5FB`) — both **after** the lifetime test, which is
 * the other way round from `PropExpireByStepLifetime`.
 */
export const FALLING_SWEEP_SCENE = 1;
export const SCRIPT_FLAG_FALLING_SWEEP = 0x77;
export const FALLING_REMOVE_CAM_PATH = 0x2f;
export const FALLING_REMOVE_CAM_FRAME = 0x96;
/** `PUSH 0x3FC00000` — the knock's impact effect is one and a half size. */
export const FALLING_KNOCK_EFFECT_SCALE = 1.5;
/** `FADD [0x004C43AC]` (0.5) — a story item comes out half a unit above the floor. */
export const FALLING_STORY_ITEM_RISE = 0.5;
/**
 * The destroy arm's loop counter: `MOV EBP, 1` ... `SUB EBP, 2; CMP EBP, -3;
 * JG` (`0x0046A7E2`..`0x0046A95D`). It runs for 1 and -1 and stops at -3, so
 * the container throws **two** pieces, one each way.
 */
export const FALLING_FRAGMENT_SIDE_FIRST = 1;
export const FALLING_FRAGMENT_SIDE_STEP = 2;
export const FALLING_FRAGMENT_SIDE_END = -3;

/**
 * The knock's throw (`0x0046A6B0`): `vy = rand() % 0x29 * 0.01f + 0.8f`
 * (`0x004D5464` = `0x3C23D70A`, `0x004C43A8` = `0x3F4CCCCD`), pitch spin
 * `-0x180 - rand() % 0x101`, roll spin `-0x80 - rand() % 0x81`.
 */
const FALLING_THROW_JITTER = 0x29;
const FALLING_THROW_STEP = Math.fround(0.01);
const FALLING_THROW_BASE = Math.fround(0.8);
const FALLING_PITCH_SPIN_BASE = -0x180;
const FALLING_PITCH_SPIN_JITTER = 0x101;
const FALLING_ROLL_SPIN_BASE = -0x80;
const FALLING_ROLL_SPIN_JITTER = 0x81;
/** `LEA EAX,[ESI+ECX+0x4000]` at `0x0046A775` — the settle aims a quarter-turn on. */
const FALLING_SETTLE_PITCH_BIAS = 0x4000;
/** `SAR EDX,5` with the `AND EDX,0x1F` fixup — a truncating divide by 32. */
const FALLING_SETTLE_EASE = 32;

/** Sounds, as `PlaySoundId` ids. */
export const SFX_FALLING_KNOCKED = 0x0e16a9;
export const SFX_FALLING_LAND_A = 0x1916a9;
export const SFX_FALLING_LAND_B = 0x1816a9;
export const SFX_FALLING_BREAK_A = 0x1716a9;
export const SFX_FALLING_BREAK_B = 0x1616a9;

/**
 * `g_item_set_countdown[set] = placer+0x64 > 1 ? rand() % placer+0x64 + 1 : 1`,
 * when `(s8)set > 0` — identical in both constructors (`0x00473A25`,
 * `0x00462123`). The count is a byte (`INC DL`).
 */
function FallingSeedCountdown(itemSet: number, setSize: number,
                              rng: Rng): void {
  if (itemSet <= 0) return;
  G.g_item_set_countdown[itemSet] =
    setSize > 1 ? (rng.int(setSize) + 1) & 0xff : 1;
}

/**
 * `PlaceFallingContainer` — `FUN_00473940`. Class 0x44 selector 16.
 *
 * The orientation words carry the set size (`+0x64`), the yaw (`+0x68`) and
 * the kind (`+0x6C`); the lifetime, item set and story item come from the
 * **parameter tail** at `placer+0x1390`. `[port-only]` as a *signature*: the
 * engine reads the placer; the port is handed what the bundle decoded from it.
 */
export function PlaceFallingContainer(at: number, kind: number,
                                      itemSet: number, storyItem: number,
                                      setSize: number, lifetime: number,
                                      x: number, y: number, z: number,
                                      yaw: number, rng: Rng): BreakableProp {
  const p = makeBreakableProp(G.g_breakable_next_id++, 0, 0);
  p.family = PropFamily.Falling;
  p.at = at;
  p.kind = kind;
  p.x = x;
  p.y = y;
  p.z = z;
  p.floorY = Math.fround(y - Math.fround(FALLING_FLOOR_DROP));
  p.yaw = yaw;
  p.hp = 2;
  p.slot = FALLING_SLOT_WHOLE;
  // `obj+0x124 = 0x41000000` — 8.0.
  p.hitRadius = FALLING_CONTAINER_RADIUS;
  p.lastStepIndex = G.g_evt_step_index;
  p.stepsElapsed = 0;
  p.flags = 0x80000000 | BreakableFlag.Live;
  p.state = BreakableState.Standing;
  p.lifetime = (lifetime << 24) >> 24;
  p.itemSet = (itemSet << 24) >> 24;
  p.storyItem = storyItem;
  const params = T.breakables?.kinds?.[kind];
  p.effect = params?.effect ?? 0;
  p.effectVariant = params?.effect_variant ?? 0;
  p.effectFrames = 0;
  p.effectPrevFrame = 0;
  FallingSeedCountdown(p.itemSet, setSize, rng);
  return p;
}

/**
 * `PlaceGenericProp` case 0x22's own arm — class 0x41 type 34, run on the
 * object the prologue built.
 *
 * `[port-only]` as a *function*: in the engine it is the arm at `0x004620DA`
 * of `PlaceGenericProp`'s switch, and not called. The prologue has already
 * written the placer's position, **pitch, yaw and roll** (`+0x1CC..+0x1D4`),
 * `+0x28C` and `+0x11C` from the placer's `+0x11C`, `+0x196`/`+0x197`,
 * `+0x34 = 0x80000001` and `+0x32C = +0x330 = 0`; the arm then writes, in its
 * order:
 *
 * ```
 * 004620da  +0x194 = (s8)placer+0x1F4          ; desc+0x24
 * 004620ec  +0x11C = 2                         ; two shots
 * 004620f5  +0x28C = 0xA50
 * 004620fe  +0x124 = 8.0
 * 00462108  +0x199 = (u8)placer+0x11C          ; the lifetime
 * 00462114  +0x2E0 = y - 7.35f
 * 0046211c  +0x192 = 0 ; +0x2A0 = -1
 * 00462123  the countdown, from placer+0x64
 * ```
 *
 * It needs the family `PlaceGenericProp` gives type 34 to be
 * {@link PropFamily.Falling}, which is `g_class41_updates[34]`.
 */
export function PlaceGenericPropType34(p: BreakableProp,
                                       pl: BreakablePlacement,
                                       rng: Rng): void {
  p.itemSet = ((pl.field_1f4 ?? 0) << 24) >> 24;
  p.hp = 2;
  p.slot = FALLING_SLOT_WHOLE;
  p.hitRadius = FALLING_CONTAINER_RADIUS;
  // `MOV AL,byte [EBP+0x11c]` into the byte the routine reads signed.
  p.lifetime = ((pl.lifetime_evt_steps ?? 0) << 24) >> 24;
  p.floorY = Math.fround(p.y - Math.fround(FALLING_FLOOR_DROP));
  p.state = BreakableState.Standing;
  p.storyItem = -1;
  FallingSeedCountdown(p.itemSet, pl.pitch ?? 0, rng);
}

/** `Rz(roll) * Ry(yaw) * Rx(pitch)` — **not** the group props' `Ry*Rz*Rx`. */
function RotateZYX(x: number, y: number, z: number,
                   yaw: number, roll: number, pitch: number):
    { x: number; y: number; z: number } {
  let cs = Math.cos(pitch / BAMS), sn = Math.sin(pitch / BAMS);
  let rx = x;
  let ry = y * cs - z * sn;
  let rz = y * sn + z * cs;

  cs = Math.cos(yaw / BAMS); sn = Math.sin(yaw / BAMS);
  const yx = rx * cs + rz * sn;
  rz = -rx * sn + rz * cs;
  rx = yx;

  cs = Math.cos(roll / BAMS); sn = Math.sin(roll / BAMS);
  const zx = rx * cs - ry * sn;
  ry = rx * sn + ry * cs;
  rx = zx;
  return { x: rx, y: ry, z: rz };
}

/**
 * `FallingContainerGroundContact` — `FUN_0046B040`.
 *
 * `[proved]` from `0x0046B040`..`0x0046B31D`: `Push; LoadIdentity; RotZ(roll);
 * RotY(yaw); RotX(pitch)`, then for each hull point `hull[i] * 0.001f`
 * (`0x0055D2B0`) through it:
 *
 * ```
 * if (q.y + y < floor - 0.1f) {                 ; 0x0046B10F, FCOMPP ; TEST AH,0x41
 *     touched = 1
 *     state 1: contact = i; rest = (q.x + x, g_camera_fixed_eye_y, q.z + z)
 *     state 2, i != contact, q.y < lowest (10000.0 at the start):
 *              contact = i; lowest = q.y; rest = (q.x + x, floor, q.z + z)
 * }
 * if (g_scene_index == 1 && g_evt_block_index == 0x12
 *     && q.x + x < -840.0 && q.x < furthest (0.0 at the start)) {
 *     furthest = q.x; x -= (q.x + x) + 840.0; vx *= -1.0
 * }
 * ```
 *
 * and after the loop, in state 2 only, `x, y, z = the translation of
 * T(rest) . Rz . Ry . Rx . T(-hull[contact] * 0.001f)` — the re-seat runs
 * every settled frame, contact or not. The state-1 contact records the
 * **camera's** ground plane as the rest height (`MOV EAX,[0x009c8e58]` at
 * `0x0046B14E`) and only a later re-seat onto another corner puts the
 * container's own floor there. Structurally `BreakablePropGroundContact`,
 * different in the rotation order, the floor and the model height it does
 * not subtract.
 *
 * The hull is an **argument**: the container passes
 * `g_falling_container_hull_points` — `0x00594788` — with a count of `0x30`,
 * and its two pieces pass `g_container_fragment_hull_points` — `0x005948A8` —
 * with `0x37`. `hull.length` is that count; the bundle's points are already
 * scaled by 0.001.
 */
export function FallingContainerGroundContact(
    p: BreakableProp, hull: readonly (readonly [number, number, number])[]):
    boolean {
  if (!hull.length) return false;

  const floor = p.floorY - Math.fround(0.1);
  let touched = false;
  let lowest = 10000.0;
  let furthest = 0.0;

  for (let i = 0; i < hull.length; i++) {
    const [hx, hy, hz] = hull[i];
    const q = RotateZYX(hx, hy, hz, p.yaw, p.roll, p.pitch);
    if (q.y + p.y < floor) {
      touched = true;
      if (p.state === BreakableState.Falling) {
        p.contact = i;
        p.restX = Math.fround(q.x + p.x);
        p.restY = G.g_camera_fixed_eye_y;
        p.restZ = Math.fround(q.z + p.z);
      } else if (p.state === BreakableState.Settled && i !== p.contact
                 && q.y < lowest) {
        p.contact = i;
        lowest = q.y;
        p.restX = Math.fround(q.x + p.x);
        p.restY = p.floorY;
        p.restZ = Math.fround(q.z + p.z);
      }
    }
    // `FADD [0x005690E0]` (840.0) then `FSUBR [ESI+0x19C]`: x -= wx + 840,
    // measured with the x this loop may already have moved.
    if (G.g_scene_index === FALLING_WALL_SCENE
        && G.g_evt_block_index === FALLING_WALL_BLOCK) {
      const wx = Math.fround(q.x + p.x);
      if (wx < FALLING_WALL_X && q.x < furthest) {
        furthest = q.x;
        p.x = Math.fround(p.x - (wx - FALLING_WALL_X));
        // `FMUL [0x004C4C64]` (-1.0): exact on a float32, so no rounding.
        p.vx *= -1.0;
      }
    }
  }

  if (p.state === BreakableState.Settled) {
    const [cx, cy, cz] = hull[p.contact] ?? [0, 0, 0];
    const back = RotateZYX(-cx, -cy, -cz, p.yaw, p.roll, p.pitch);
    p.x = Math.fround(p.restX + back.x);
    p.y = Math.fround(p.restY + back.y);
    p.z = Math.fround(p.restZ + back.z);
  }
  return touched;
}

/**
 * `[port-only]` as a function: the destroy arm's loop at `0x0046A7D5`..
 * `0x0046A95D`, inline in `FallingContainerUpdate`.
 *
 * ```
 * for (i = 0, side = 1, pitch = 0x4000; side > -3; i++, side -= 2, pitch -= 0x8000) {
 *     f = ActorAlloc(FallingContainerFragmentUpdate, 0x378);
 *     ActorClearGameFields(f);                       // +0x34 .. end, zeroed
 *     f+0x28C = 0xA55;  f+0x2E0 = obj+0x2E0;
 *     f+0x19C = obj+0x19C;  f+0x1A0 = i + i + obj+0x2E0;  f+0x1A4 = obj+0x1A4;
 *     f+0x1C0 += (rand() % 11 * .01f + .1f) * side;
 *     f+0x1C4  = rand() % 0x15 * .01f + i * 0.5f + 1.5f;
 *     f+0x1CC  = pitch;
 *     f+0x1C8 += (rand() % 11 * .01f + .1f) * side;
 *     f+0x1D0  = obj+0x1D0;
 *     f+0x1D8  = rand() % 0x101 - 0x80;
 *     f+0x192  = 1;
 *     f+0x1E0  = -0x40 - rand() % 0x41;
 *     f+0x199  = (char)obj+0x11C;  f+0x196 = g_evt_step_index;
 * }
 * ```
 *
 * `0x004C4CC8` is 0.1f (`0x3DCCCCCD`), `0x004C43AC` 0.5f and `0x004C4CB8`
 * 1.5f. One piece goes each way along x and z, the second two units higher
 * and half a unit a frame faster upward, and they start a half-turn apart in
 * pitch. The roll and the frame count (`+0x1D4`, `+0x2A0`) are not written;
 * `ActorClearGameFields` (`FUN_004A73D0`) has zeroed them.
 */
export function FallingContainerThrowFragments(p: BreakableProp,
                                               rng: Rng): void {
  const tenth = Math.fround(0.1);
  const hundredth = Math.fround(0.01);
  let i = 0;
  let pitch = 0x4000;
  for (let side = FALLING_FRAGMENT_SIDE_FIRST; side > FALLING_FRAGMENT_SIDE_END;
       side -= FALLING_FRAGMENT_SIDE_STEP) {
    const f = makeBreakableProp(G.g_breakable_next_id++, 0, 0);
    // `ActorClearGameFields`: everything from `+0x34` is zero, including the
    // words `makeBreakableProp` seeds to -1 for the families that read them.
    f.storyItem = 0;
    f.removeFlag = 0;
    f.key0 = f.key1 = f.key2 = f.key3 = 0;
    f.family = PropFamily.ContainerFragment;
    f.slot = FALLING_SLOT_FRAGMENT;
    f.floorY = p.floorY;
    f.x = p.x;
    f.y = Math.fround(i + i + p.floorY);
    f.z = p.z;
    f.vx = Math.fround((rng.int(0xb) * hundredth + tenth) * side + f.vx);
    f.vy = Math.fround(rng.int(0x15) * hundredth + i * 0.5 + 1.5);
    f.pitch = pitch;
    f.vz = Math.fround((rng.int(0xb) * hundredth + tenth) * side + f.vz);
    f.yaw = p.yaw;
    f.spin = rng.int(0x101) - 0x80;
    f.state = BreakableState.Falling;
    f.rollSpin = -0x40 - rng.int(0x41);
    // `MOV CL, byte ptr [EDI+0x11C]` -- the container's shots left, which is
    // 1 on this arm. The piece never reads its lifetime.
    f.lifetime = (p.hp << 24) >> 24;
    f.lastStepIndex = G.g_evt_step_index;
    G.g_breakable_props.push(f);
    i += 1;
    pitch -= 0x8000;
  }
}

/**
 * `FallingContainerUpdate` — `FUN_0046A580`. `g_class41_updates[34]`
 * (`0x00593744`) and class 0x44 selector 16's routine. One container, one
 * 60 Hz frame, transcribed whole: see the file comment for the listing.
 */
export function FallingContainerUpdate(p: BreakableProp, rng: Rng,
                                       events?: Events): void {
  PropDrawBegin(p);
  // Its own lifetime, on `+0x199` (`p.lifetime` for this family).
  if (G.g_evt_step_index !== p.lastStepIndex) {
    p.stepsElapsed += 1;
    if (p.stepsElapsed > p.lifetime) { ActorDespawnProp(p); return; }
    p.lastStepIndex = G.g_evt_step_index;
  }
  if (G.g_scene_index === FALLING_SWEEP_SCENE
      && (G.g_script_flags[SCRIPT_FLAG_FALLING_SWEEP] ?? 0) !== 0) {
    ActorDespawnProp(p);
    return;
  }
  if (G.g_active_cam_path === FALLING_REMOVE_CAM_PATH
      && G.g_cam_path_frame === FALLING_REMOVE_CAM_FRAME) {
    ActorDespawnProp(p);
    return;
  }

  if ((p.flags & BreakableFlag.Hit) !== 0 && p.hp > 0) {
    if (p.hp === 1) {
      FallingContainerBreak(p, rng, events);
      return;
    }
    if (p.hp === 2) FallingContainerKnock(p, rng, events);
    p.hp -= 1;
  }
  // `AND EDX,0xFFFFFFF9` at `0x0046A723`: the player bits only. Bit 3 is the
  // knock's to clear, and nothing else reaches it with a shot left.
  p.flags &= ~(BreakableFlag.HitByPlayer0 | BreakableFlag.HitByPlayer1);

  const hull = T.breakables?.falling_hull ?? [];
  if (p.state === BreakableState.Falling) {
    // `FLD; FSUB float; FST vy; FADD y; FSTP y` -- y takes the unrounded
    // difference, vy the stored one.
    const vy = p.vy - Math.fround(FALLING_GRAVITY);
    p.pitch = (p.pitch + p.spin) | 0;
    p.vy = Math.fround(vy);
    p.roll = (p.roll + p.rollSpin) | 0;
    p.y = Math.fround(vy + p.y);
    // It only settles on the way *down*: `contact && vy < 0`, so a hull point
    // that clips the floor on the way up does not stop it.
    if (FallingContainerGroundContact(p, hull) && p.vy < 0) {
      p.state = BreakableState.Settled;
      events?.emit("prop.settled", {
        id: p.id,
        sound: rng.int(2) === 0 ? SFX_FALLING_LAND_A : SFX_FALLING_LAND_B,
      });
    }
  } else if (p.state === BreakableState.Settled) {
    // Both spins ease out by a 32nd of the overshoot, `x >> 5` with the sign
    // fixup that makes the shift round toward zero; the pitch aims a
    // quarter-turn past where it is, which is what tips the container onto
    // a face.
    p.rollSpin = (p.rollSpin
      - Math.trunc((p.roll + p.rollSpin) / FALLING_SETTLE_EASE)) | 0;
    p.roll = (p.roll + p.rollSpin) | 0;
    p.spin = (p.spin - Math.trunc(
      (p.pitch + FALLING_SETTLE_PITCH_BIAS + p.spin) / FALLING_SETTLE_EASE))
      | 0;
    p.pitch = (p.pitch + p.spin) | 0;
    FallingContainerGroundContact(p, hull);
  }

  if (p.state === BreakableState.Settled) {
    const m = PropMatrixPush();
    PropMatrixTRzRyRx(m, p.restX, p.restY, p.restZ, p.pitch, p.yaw, p.roll);
    const [cx, cy, cz] = hull[p.contact] ?? [0, 0, 0];
    // `FMUL float [0x0056903C]` -- `-0.001f` on the raw s16 point.
    MatrixTranslate(m, -cx, -cy, -cz);
    PropDrawSlot(p, m, p.slot);
    // `MatrixStore(obj+0x2E4)` (`0x004A8CA0`). Nothing reads it back for this
    // family; kept because the routine writes it. World space, as for the
    // group props.
    p.drawMatrix = m.slice(0, 16);
  } else {
    const m = PropMatrixPush();
    PropMatrixTRzRyRx(m, p.x, p.y, p.z, p.pitch, p.yaw, p.roll);
    PropDrawSlot(p, m, p.slot);
  }

  // `if ((s16)obj+0x11C > 0)` -- the raw origin, no rise, only while it has a
  // shot left. The second one takes it out of the pool anyway, so this is
  // really "not the frame it bursts".
  if (p.hp > 0) PropRegisterForShotTest(p, p.x, p.y, p.z);
}

/**
 * The first shot, `0x0046A64D`..`0x0046A70C`: no score, the loose model,
 * turned to the camera block's heading (`MOV EAX,[EDX*4 + 0x009A60D0]`), a
 * big impact at the crosshair, the hit bit cleared, and thrown upward.
 * `[port-only]` as a function.
 */
function FallingContainerKnock(p: BreakableProp, rng: Rng,
                               events?: Events): void {
  BreakablePropAwardHit(p.flags, false, rng);
  events?.emit("prop.cracked", { id: p.id, sound: SFX_FALLING_KNOCKED });
  p.slot = FALLING_SLOT_LOOSE;
  p.yaw = G.g_camera_block_yaw_bams;
  // `SpawnPropHitEffectScaled(obj, player, 1.5f)` (`FUN_004666B0`) at the
  // point the shot was aimed, which `combat/shot.ts` left on the prop.
  if (p.hitAim) {
    SpawnPropHitEffectScaled(p.hitAim.x, p.hitAim.y, p.z,
                             FALLING_KNOCK_EFFECT_SCALE);
  }
  p.flags &= ~BreakableFlag.Hit;
  p.vy = Math.fround(rng.int(FALLING_THROW_JITTER) * FALLING_THROW_STEP
                     + FALLING_THROW_BASE);
  p.spin = FALLING_PITCH_SPIN_BASE - rng.int(FALLING_PITCH_SPIN_JITTER);
  p.state = BreakableState.Falling;
  p.rollSpin = FALLING_ROLL_SPIN_BASE - rng.int(FALLING_ROLL_SPIN_JITTER);
}

/**
 * The second shot, `0x0046A7A4`..`0x0046AA85`: ten points, the break sound,
 * two pieces, the item, and gone. `[port-only]` as a function.
 */
function FallingContainerBreak(p: BreakableProp, rng: Rng,
                               events?: Events): void {
  BreakablePropAwardHit(p.flags, true, rng);
  events?.emit("prop.broken", {
    id: p.id,
    sound: rng.int(2) === 0 ? SFX_FALLING_BREAK_A : SFX_FALLING_BREAK_B,
  });
  FallingContainerThrowFragments(p, rng);
  // The release is measured from the floor, not from wherever the tumble
  // left the model -- and a story item from half a unit above it. The
  // routine writes `+0x1A0` only when the countdown empties; the object is
  // despawned on the next line either way.
  p.y = p.floorY;
  ReleaseHiddenItem(p, events, 0, FALLING_STORY_ITEM_RISE);
  ActorDespawnProp(p);
}
