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
 */
import type { Events } from "../../core/events";
import type { Rng } from "../../core/rng";
import { G } from "../globals";
import { T } from "../tables";
import { BAMS } from "../vec";
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
/** The three fragments the destroying shot throws draw this. */
export const FALLING_SLOT_FRAGMENT = 0xa55;

/** Gravity while it tumbles — the engine's own 0.05444, not the group props'. */
export const FALLING_GRAVITY = 0.05444;

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
  p.spawnBlock = G.g_evt_block_counter;
  p.blocksElapsed = 0;
  // Two shots, and unlike the kinded props this really is a shot count.
  p.hp = 2;
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
 * `FUN_0046B040` — the falling container's ground contact.
 *
 * Structurally `BreakablePropGroundContact`, and different in three ways that
 * all matter: the rotation is `Rz * Ry * Rx`, the floor is the container's own
 * `+0x2E0` rather than the camera's ground plane, and the hull point is used
 * raw where the group props first subtract their model height.
 */
export function FallingContainerGroundContact(p: BreakableProp): boolean {
  const hull = T.breakables?.falling_hull;
  if (!hull?.length) return false;

  const floor = p.floorY - 0.1;
  let touched = false;
  let lowest = 10000.0;

  for (let i = 0; i < hull.length; i++) {
    const [hx, hy, hz] = hull[i];
    const q = RotateZYX(hx, hy, hz, p.yaw, p.roll, p.pitch);
    if (q.y + p.y >= floor) continue;

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
 * `FallingContainerUpdate` — `FUN_0046A580`. One container, one 60 Hz frame.
 */
export function FallingContainerUpdate(p: BreakableProp, rng: Rng,
                                       events?: Events): void {
  if (G.g_evt_block_counter !== p.spawnBlock) {
    p.blocksElapsed += 1;
    if (p.blocksElapsed > p.lifetime) { ActorDespawnProp(p); return; }
    p.spawnBlock = G.g_evt_block_counter;
  }

  if ((p.flags & BreakableFlag.Hit) !== 0 && p.hp > 0) {
    if (p.hp === 1) {
      // Destroyed: ten points, three fragments, and the item.
      BreakablePropAwardHit(p.flags, true, rng);
      events?.emit("prop.broken", {
        id: p.id,
        sound: (MsvcRand(rng) & 1) === 0
          ? SFX_FALLING_BREAK_A : SFX_FALLING_BREAK_B,
      });
      // [diverges] The three `FUN_0046AD20` fragments are a render-only
      // effect; nothing in `game/` observes them, so the port raises the
      // event and lets the container go rather than pooling three more
      // objects per break that no rule ever reads back.
      events?.emit("prop.shattered",
                   { id: p.id, x: p.x, y: p.floorY, z: p.z });
      // The release is measured from the floor, not from wherever the tumble
      // left the model.
      p.y = p.floorY;
      ReleaseHiddenItem(p, events);
      ActorDespawnProp(p);
      return;
    }
    if (p.hp === 2) {
      // Knocked loose: no score, a new model, and it is thrown upward.
      BreakablePropAwardHit(p.flags, false, rng);
      p.slot = FALLING_SLOT_LOOSE;
      events?.emit("prop.cracked", { id: p.id, sound: SFX_FALLING_KNOCKED });
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
    if (FallingContainerGroundContact(p) && p.vy < 0) {
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
    FallingContainerGroundContact(p);
  }
}
