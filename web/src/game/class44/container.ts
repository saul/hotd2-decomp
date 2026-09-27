/**
 * `PlaceFallingContainer` and `FallingContainerUpdate` — class 0x44 selector 16.
 *
 * The one container that is not simply broken where it stands. The first shot
 * knocks it **loose**: it is thrown upward and tumbles under gravity until one
 * of its 48 hull points reaches its own floor, and only the second shot
 * destroys it. Two spawns, both in stage 2.
 *
 * Its floor is its own — `+0x2E0`, set at placement to `y - 7.35` — rather
 * than `g_camera_fixed_eye_y`. A container hung above the ground therefore
 * comes to rest in the air, which is the whole point of having the field.
 *
 * The second shot throws **two** pieces, each a 0x378 object in the same pool
 * running `FallingContainerFragmentUpdate` (`FUN_0046AD20`) — see
 * `class44/container_fragment.ts`. They were once written up as three and
 * then left out as a render-only effect; the loop runs twice, and it draws ten
 * `rand()`s that every later `rand()` in the stage is downstream of.
 */
import type { Events } from "../../core/events";
import type { Rng } from "../../core/rng";
import { G } from "../globals";
import { FALLING_CONTAINER_RADIUS, PropRegisterForShotTest }
  from "../class41/shot_test";
import { T } from "../tables";
import { BAMS } from "../vec";
import { SpawnPropHitEffectScaled } from "../effects/sprite";
import { MsvcRand } from "../class41/group";
import { ReleaseHiddenItem } from "../class41/items";
import { ActorDespawnProp, BreakablePropAwardHit } from "../class41/prop";
import {
  BreakableFlag, BreakableState, HIT_FLAG_MASK, makeBreakableProp,
  PropFamily, type BreakableProp,
} from "../class41/prop_state";

/** `+0x2E0 = y - 7.35`: how far the container's floor sits below its origin. */
export const FALLING_FLOOR_DROP = 7.35;

/** The slots it draws: whole, then knocked loose. */
export const FALLING_SLOT_WHOLE = 0xa50;
export const FALLING_SLOT_LOOSE = 0xa51;
/** `MOV word ptr [ESI+0x28C], 0xA55` — what each of its two pieces draws. */
export const FALLING_SLOT_FRAGMENT = 0xa55;

/** Gravity while it tumbles — the engine's own 0.05444, not the group props'. */
export const FALLING_GRAVITY = 0.05444;

/** `FallingContainerGroundContact`'s wall: scene 1, block `0x12`, `x = -840`. */
export const FALLING_WALL_SCENE = 1;
export const FALLING_WALL_BLOCK = 0x12;
export const FALLING_WALL_X = -840.0;

/**
 * `g_script_flags[0x77]` in scene 1, and camera path `0x2F` at frame `0x96`:
 * the two things besides its lifetime that take a container away
 * (`0x0046A5D3`, `0x0046A5FB`).
 */
export const FALLING_SWEEP_SCENE = 1;
export const SCRIPT_FLAG_FALLING_SWEEP = 0x77;
export const FALLING_REMOVE_CAM_PATH = 0x2f;
export const FALLING_REMOVE_CAM_FRAME = 0x96;
/** `PUSH 0x3FC00000` — the knock's impact effect is one and a half size. */
export const FALLING_KNOCK_EFFECT_SCALE = 1.5;
/** `FADD [0x004C43AC]` — a story item comes out half a unit above the floor. */
export const FALLING_STORY_ITEM_RISE = 0.5;
/**
 * The destroy arm's loop counter: `MOV EBP, 1` ... `SUB EBP, 2; CMP EBP, -3;
 * JG` (`0x0046A7E2`..`0x0046A95D`). It runs for 1 and -1 and stops at -3, so
 * the container throws **two** pieces, one each way.
 */
export const FALLING_FRAGMENT_SIDE_FIRST = 1;
export const FALLING_FRAGMENT_SIDE_STEP = 2;
export const FALLING_FRAGMENT_SIDE_END = -3;

/** Sounds, as `PlaySoundId` ids. */
export const SFX_FALLING_KNOCKED = 0x0e16a9;
export const SFX_FALLING_LAND_A = 0x1916a9;
export const SFX_FALLING_LAND_B = 0x1816a9;
export const SFX_FALLING_BREAK_A = 0x1716a9;
export const SFX_FALLING_BREAK_B = 0x1616a9;

/**
 * `PlaceFallingContainer` — `FUN_00473940`.
 *
 * The orientation words carry the kind and the item-set size, as they do for
 * the kinded props; the lifetime, item set and mode-1 item come from the
 * **parameter tail** at `desc+0x24`, because class 0x44 spawns through the
 * allocator that writes `obj+0x1390`.
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
  p.itemSet = itemSet;
  p.storyItem = storyItem;
  p.lifetime = lifetime;
  p.lastStepIndex = G.g_evt_step_index;
  p.stepsElapsed = 0;
  // Two shots, and unlike the kinded props this really is a shot count.
  p.hp = 2;
  // `obj+0x124 = 0x41000000` — 8.0, the largest of the three families.
  p.hitRadius = FALLING_CONTAINER_RADIUS;
  p.slot = FALLING_SLOT_WHOLE;
  p.state = BreakableState.Standing;
  p.flags = 0x80000000 | BreakableFlag.Live;
  p.x = x;
  p.y = y;
  p.z = z;
  p.yaw = yaw;
  p.floorY = y - FALLING_FLOOR_DROP;

  const params = T.breakables?.kinds?.[kind];
  p.effect = params?.effect ?? 0;
  p.effectVariant = params?.effect_variant ?? 0;

  if (itemSet > 0) {
    G.g_item_set_countdown[itemSet] =
      setSize > 1 ? (MsvcRand(rng) % setSize) + 1 : 1;
  }
  return p;
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
 * Structurally `BreakablePropGroundContact`, and different in three ways that
 * all matter: the rotation is `Rz * Ry * Rx`, the floor is the container's own
 * `+0x2E0` rather than the camera's ground plane, and the hull point is used
 * raw where the group props first subtract their model height.
 *
 * The hull is an **argument**: the container passes
 * `g_falling_container_hull_points` — `0x00594788` — with a count of `0x30`,
 * and its two pieces pass `g_container_fragment_hull_points` — `0x005948A8` —
 * with `0x37`. `hull.length` is that count.
 *
 * And one test the port did not have: in scene 1's block `0x12` a hull point
 * further out than `x = -840` than any before it (`local < best`, which starts
 * at 0) pushes the object back to `-840` and reverses `vx` (`0x0046B1B9`). A
 * wall, written into the routine; stage 2's two containers are both in scene
 * 1, so it is live.
 */
export function FallingContainerGroundContact(
    p: BreakableProp, hull: readonly (readonly [number, number, number])[]):
    boolean {
  if (!hull.length) return false;

  const floor = p.floorY - 0.1;
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
        p.restX = q.x + p.x;
        p.restY = G.g_camera_fixed_eye_y;
        p.restZ = q.z + p.z;
      } else if (p.state === BreakableState.Settled && i !== p.contact
                 && q.y < lowest) {
        p.contact = i;
        lowest = q.y;
        p.restX = q.x + p.x;
        p.restY = p.floorY;
        p.restZ = q.z + p.z;
      }
    }
    // `FADD [0x005690E0]` (840.0) then `FSUBR [ESI+0x19C]`: x -= wx + 840,
    // measured with the x this loop may already have moved.
    if (G.g_scene_index === FALLING_WALL_SCENE
        && G.g_evt_block_index === FALLING_WALL_BLOCK) {
      const wx = q.x + p.x;
      if (wx < FALLING_WALL_X && q.x < furthest) {
        furthest = q.x;
        p.x -= wx - FALLING_WALL_X;
        p.vx *= -1.0;
      }
    }
  }

  // The engine re-seats on **every** settled frame, not only on the ones that
  // find a corner below the floor: the `if (state == 2)` around the re-seat is
  // outside the hull loop. Gating it on a contact leaves the origin wherever
  // the fall stopped, which is a fraction of a unit into the ground.
  if (p.state === BreakableState.Settled) {
    const [cx, cy, cz] = hull[p.contact] ?? [0, 0, 0];
    const back = RotateZYX(-cx, -cy, -cz, p.yaw, p.roll, p.pitch);
    p.x = p.restX + back.x;
    p.y = p.restY + back.y;
    p.z = p.restZ + back.z;
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
 *     f+0x1C0 += (rand() % 11 * .01 + .1) * side;
 *     f+0x1C4  = rand() % 0x15 * .01 + i * 0.5 + 1.5;
 *     f+0x1CC  = pitch;
 *     f+0x1C8 += (rand() % 11 * .01 + .1) * side;
 *     f+0x1D0  = obj+0x1D0;
 *     f+0x1D8  = rand() % 0x101 - 0x80;
 *     f+0x192  = 1;
 *     f+0x1E0  = -0x40 - rand() % 0x41;
 *     f+0x199  = (char)obj+0x11C;  f+0x196 = g_evt_step_index;
 * }
 * ```
 *
 * One piece goes each way along x and z, the second two units higher and half
 * a unit a frame faster upward, and they start a half-turn apart in pitch.
 * The roll and the frame count (`+0x1D4`, `+0x2A0`) are not written;
 * `ActorClearGameFields` (`FUN_004A73D0`) has zeroed them, so the port starts
 * each from a cleared record.
 */
export function FallingContainerThrowFragments(p: BreakableProp,
                                               rng: Rng): void {
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
    f.y = i + i + p.floorY;
    f.z = p.z;
    f.vx += ((MsvcRand(rng) % 0xb) * 0.01 + 0.1) * side;
    f.vy = (MsvcRand(rng) % 0x15) * 0.01 + i * 0.5 + 1.5;
    f.pitch = pitch;
    f.vz += ((MsvcRand(rng) % 0xb) * 0.01 + 0.1) * side;
    f.yaw = p.yaw;
    f.spin = (MsvcRand(rng) % 0x101) - 0x80;
    f.state = BreakableState.Falling;
    f.rollSpin = -0x40 - (MsvcRand(rng) % 0x41);
    // `MOV CL, byte ptr [EDI+0x11C]` -- the container's shots-left, which is
    // 1 on this arm. The piece never reads its lifetime.
    f.lifetime = p.hp & 0xff;
    f.lastStepIndex = G.g_evt_step_index;
    G.g_breakable_props.push(f);
    i += 1;
    pitch -= 0x8000;
  }
}

/**
 * `FallingContainerUpdate` — `FUN_0046A580`. One container, one 60 Hz frame.
 */
export function FallingContainerUpdate(p: BreakableProp, rng: Rng,
                                       events?: Events): void {
  if (G.g_evt_step_index !== p.lastStepIndex) {
    p.stepsElapsed += 1;
    if (p.stepsElapsed > p.lifetime) { ActorDespawnProp(p); return; }
    p.lastStepIndex = G.g_evt_step_index;
  }
  // Stage 2's sweep, then a camera cue: path 0x2F at exactly frame 0x96.
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
      // Destroyed: ten points, two pieces, and the item.
      BreakablePropAwardHit(p.flags, true, rng);
      events?.emit("prop.broken", {
        id: p.id,
        sound: (MsvcRand(rng) & 1) === 0
          ? SFX_FALLING_BREAK_A : SFX_FALLING_BREAK_B,
      });
      FallingContainerThrowFragments(p, rng);
      events?.emit("prop.shattered",
                   { id: p.id, x: p.x, y: p.floorY, z: p.z });
      // The release is measured from the floor, not from wherever the tumble
      // left the model -- and a story item from half a unit above it.
      p.y = p.floorY;
      ReleaseHiddenItem(p, events, 0, FALLING_STORY_ITEM_RISE);
      ActorDespawnProp(p);
      return;
    }
    if (p.hp === 2) {
      // Knocked loose: no score, a new model, turned to face the camera, a
      // big impact at the crosshair, and it is thrown upward.
      BreakablePropAwardHit(p.flags, false, rng);
      events?.emit("prop.cracked", { id: p.id, sound: SFX_FALLING_KNOCKED });
      p.slot = FALLING_SLOT_LOOSE;
      // `MOV EAX, [EDX*4 + 0x009A60D0]` at `0x0046A685`: the camera block's
      // yaw, `g_camera_block_yaw_bams` — `0x009A60D0`.
      p.yaw = G.g_camera_block_yaw_bams;
      // `SpawnPropHitEffectScaled(obj, player, 1.5f)` (`FUN_004666B0`) at the
      // point the shot was aimed, which `combat/shot.ts` left on the prop.
      if (p.hitAim) {
        SpawnPropHitEffectScaled(p.hitAim.x, p.hitAim.y, p.z,
                                 FALLING_KNOCK_EFFECT_SCALE);
      }
      p.vy = (MsvcRand(rng) % 0x29) * 0.01 + 0.8;
      p.spin = -0x180 - (MsvcRand(rng) % 0x101);
      p.rollSpin = -0x80 - (MsvcRand(rng) % 0x81);
      p.state = BreakableState.Falling;
    }
    p.hp -= 1;
  }
  p.flags &= ~HIT_FLAG_MASK;

  if (p.state === BreakableState.Falling) {
    p.vy -= FALLING_GRAVITY;
    p.pitch += p.spin;
    p.roll += p.rollSpin;
    p.y += p.vy;
    // It only settles on the way *down*: the test is `contact && vy < 0`, so
    // a hull point that clips the floor on the way up does not stop it.
    if (FallingContainerGroundContact(p, T.breakables?.falling_hull ?? [])
        && p.vy < 0) {
      p.state = BreakableState.Settled;
      events?.emit("prop.settled", {
        id: p.id,
        sound: (MsvcRand(rng) & 1) === 0
          ? SFX_FALLING_LAND_A : SFX_FALLING_LAND_B,
      });
    }
  } else if (p.state === BreakableState.Settled) {
    // Both spins ease out by a 32nd of the overshoot. The engine writes it as
    // `spin -= (x >> 5)` with the sign fixup that makes the shift round toward
    // zero, which is `Math.trunc(x / 32)`; the pitch aims a quarter-turn past
    // where it is, which is what tips the container onto a face.
    p.rollSpin -= Math.trunc((p.roll + p.rollSpin) / 32);
    p.roll += p.rollSpin;
    p.spin -= Math.trunc((p.pitch + 0x4000 + p.spin) / 32);
    p.pitch += p.spin;
    FallingContainerGroundContact(p, T.breakables?.falling_hull ?? []);
  }

  // `if (obj+0x11C > 0) { ...transform...; RegisterForShotTest(obj); }` --
  // the raw origin, no rise, and only while it has shots left. The second one
  // takes it out of the pool anyway, so this is really "not the frame it
  // bursts".
  if (p.hp > 0) PropRegisterForShotTest(p, p.x, p.y, p.z);
}
