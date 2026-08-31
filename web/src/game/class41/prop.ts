/**
 * `BreakablePropUpdate` and the routines it calls.
 *
 * One prop, one frame. The engine interleaves this with its drawing — the
 * `MatrixStackPush` / `AssetDrawSlot` block is inside the same function — but
 * the port keeps only the state half, and the renderer reads `x/y/z`,
 * `pitch/yaw/roll`, `slot` and `state` back out. That seam is the `game/`
 * boundary and nothing about the behaviour crosses it.
 *
 * There are **two** lifecycles here and they are easy to conflate:
 *
 * * **Destroyed** — two shots. A prop at stack level 0 turns into the break
 *   puff (`BreakableEffectUpdate`) and releases whatever it was hiding; one
 *   above level 0 bursts into fragments and is gone. Neither falls.
 * * **Toppled** — a prop whose supporting members have all left notices the
 *   floor beneath it has gone and falls under gravity until a hull corner
 *   touches the ground. That is the entire stack collapse: nothing pushes
 *   anything, each prop only ever checks what it is standing on.
 */
import type { Events } from "../../core/events";
import type { Rng } from "../../core/rng";
import { G } from "../globals";
import { T } from "../tables";
import { BAMS } from "../vec";
import {
  BreakableGroupMembers, BreakablePropAt, MsvcRand, SetBreakableMemberSlot,
} from "./group";
import { ReleaseHiddenItem } from "./items";
import {
  BreakableFlag, BreakableSlot, BreakableState, HIT_FLAG_MASK, PropFamily,
  type BreakableProp,
} from "./prop_state";

// -- the constants the routine spells out ----------------------------------

/** Gravity on a falling prop, per 60 Hz frame. */
export const BREAKABLE_GRAVITY = 0.01361;

/** The prop's own height; every draw and every hull test is offset by it. */
export const BREAKABLE_HEIGHT = 3.770148;

/** How close another prop must be for a faller to rest on it rather than drop. */
export const BREAKABLE_REST_RADIUS = 6.0;

/** The shake a crack imparts, and the factor it decays by each frame. */
export const BREAKABLE_SHAKE = 1.0;
export const BREAKABLE_SHAKE_DECAY = 0.85;
/** A prop standing on a cracked one is shaken by half as much. */
export const BREAKABLE_SHAKE_NEIGHBOUR = 0.5;

/** The pitch a topple eases toward, signed by which way it went. */
export const BREAKABLE_REST_PITCH = 0x4000;

/** How long the break puff lasts, in 60 Hz frames. */
export const BREAKABLE_EFFECT_FRAMES = 0x48;

/** Sounds, as `PlaySoundId` ids. */
export const SFX_PROP_CRACK = 0x1d16a9;
export const SFX_PROP_BREAK = 0x1a16a9;
export const SFX_PROP_SETTLE = 0x1c16a9;

/** Points a landed shot on a prop is worth — and only the *destroying* one. */
export const PROP_HIT_SCORE = 10;

// -- the call graph --------------------------------------------------------

/**
 * `BreakablePropAwardHit` — `FUN_004650F0`.
 *
 * Works out whose shot it was from the two hit bits, pays for it and counts
 * it. `award` is the engine's second argument, and it is what separates the
 * two hits: the **crack** passes 0 and the **destroy** passes 1, so cracking a
 * prop is worth nothing and breaking it is worth ten. `ExtraLifePickupUpdate`
 * passes 0 too, so a pickup pays no points of its own either.
 *
 * Returns the player, because `GrantExtraLife` needs to know who to pay.
 */
export function BreakablePropAwardHit(flags: number, award: boolean,
                                      rng: Rng): number {
  const noP0 = (flags & BreakableFlag.HitByPlayer0) === 0;
  const noP1 = (flags & BreakableFlag.HitByPlayer1) === 0;
  // Both players landed on the same frame: the engine picks one at random.
  const player = (!noP0 && !noP1) ? MsvcRand(rng) & 1 : (noP0 ? 1 : 0);

  if (award && G.g_GameMode !== 2) {
    G.g_player_score[player] = (G.g_player_score[player] ?? 0) + PROP_HIT_SCORE;
  }
  G.g_player_hit_count[player] = (G.g_player_hit_count[player] ?? 0) + 1;
  return player;
}

/** `MatrixRotateY(yaw) * MatrixRotateZ(roll) * MatrixRotateX(pitch)`, in BAMS. */
function RotateYZX(x: number, y: number, z: number,
                   yaw: number, roll: number, pitch: number):
    { x: number; y: number; z: number } {
  let cs = Math.cos(pitch / BAMS), sn = Math.sin(pitch / BAMS);
  let rx = x;
  let ry = y * cs - z * sn;
  let rz = y * sn + z * cs;

  cs = Math.cos(roll / BAMS); sn = Math.sin(roll / BAMS);
  const zx = rx * cs - ry * sn;
  ry = rx * sn + ry * cs;
  rx = zx;

  cs = Math.cos(yaw / BAMS); sn = Math.sin(yaw / BAMS);
  const yx = rx * cs + rz * sn;
  rz = -rx * sn + rz * cs;
  rx = yx;
  return { x: rx, y: ry, z: rz };
}

/**
 * `BreakablePropGroundContact` — `FUN_00465590`.
 *
 * Transforms all 96 of `g_breakable_hull_points` by the prop's `Ry * Rz * Rx`
 * and reports whether any of them has gone below the floor.
 *
 * In `Falling` it records the **first** such point. In `Settled` it keeps the
 * **lowest** one that is not already the contact and re-seats the prop's
 * origin on it, which is how a broken prop comes to rest leaning on a corner
 * rather than sinking through the floor.
 */
export function BreakablePropGroundContact(p: BreakableProp): boolean {
  const hull = T.breakables?.hull;
  if (!hull?.length) return false;

  const floor = G.g_camera_fixed_eye_y - 0.1;
  let touched = false;
  let lowest = 10000.0;

  for (let i = 0; i < hull.length; i++) {
    const [hx, hy, hz] = hull[i];
    const q = RotateYZX(hx, hy - BREAKABLE_HEIGHT, hz, p.yaw, p.roll, p.pitch);
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
      p.restY = G.g_camera_fixed_eye_y;
      p.restZ = q.z + p.z;
    }
  }

  // Settling re-derives the origin from the contact point: put the rested
  // corner where it landed, re-apply the rotation, and step back along the
  // hull offset to find where the prop's own origin now is.
  // The engine re-seats on **every** settled frame, not only on the ones that
  // find a corner below the floor: the `if (state == 2)` around the re-seat is
  // outside the hull loop. Gating it on a contact leaves the origin wherever
  // the fall stopped, which is a fraction of a unit into the ground.
  if (p.state === BreakableState.Settled) {
    const [cx, cy, cz] = hull[p.contact] ?? [0, 0, 0];
    const back = RotateYZX(-cx, -(cy - BREAKABLE_HEIGHT), -cz,
                           p.yaw, p.roll, p.pitch);
    p.x = p.restX + back.x;
    p.y = p.restY + back.y;
    p.z = p.restZ + back.z;
  }
  return touched;
}

/**
 * `BreakablePropSpawnShatter` — `FUN_00465170`.
 *
 * A prop above stack level 0 does not topple, it bursts: fifteen fragments,
 * each thrown along its own bearing at 0.1..0.3 and spinning by up to
 * +/-0x400 on each axis.
 *
 * [diverges] The port raises an event and lets the prop go; the fragments are
 * a render-only effect that nothing in `game/` observes, and modelling fifteen
 * of them per break would put state in the snapshot that no rule reads back.
 * The offsets and angles are exported as `g_shatter_fragment_offsets` and
 * `g_shatter_fragment_angles` for whoever draws them.
 */
export function BreakablePropSpawnShatter(p: BreakableProp,
                                          events?: Events): void {
  events?.emit("prop.shattered", { id: p.id, x: p.x, y: p.y, z: p.z });
  ActorDespawnProp(p);
}

/**
 * `BreakableEffectUpdate` — `FUN_00465500`. What a destroyed ground-level prop
 * becomes: the engine overwrites the object's entry point with this, so the
 * prop stops being a prop and spends 0x48 frames as a puff before it dies.
 */
export function BreakableEffectUpdate(p: BreakableProp): void {
  if (p.effectFrames < BREAKABLE_EFFECT_FRAMES) {
    p.effectFrames += 1;
    return;
  }
  ActorDespawnProp(p);
}

/**
 * `ActorDespawn` (`FUN_00409CC0`) as a prop sees it: flagged dead, taken out
 * of its member slot, and dropped from the pool by `BreakablePropPoolUpdate`.
 * A prop-shaped wrapper, not a port of the shared routine — that one clears a
 * light slot at `+0x3C` which a prop never holds.
 */
export function ActorDespawnProp(p: BreakableProp): void {
  p.dead = true;
  p.flags = (p.flags & ~BreakableFlag.Live) | 0x80018000;
  if (G.g_breakable_members[p.group * 9 + p.member] === p.id) {
    SetBreakableMemberSlot(p.group, p.member, 0);
  }
}

/**
 * `BreakablePropUpdate` — `FUN_00464620`. One prop, one 60 Hz frame.
 */
export function BreakablePropUpdate(p: BreakableProp, rng: Rng,
                                    events?: Events): void {
  // A destroyed ground-level prop has had its entry point replaced; it runs
  // the puff and nothing else.
  if (p.family === PropFamily.Effect) { BreakableEffectUpdate(p); return; }

  // The prop re-registers itself every frame, so a slot freed by a break is
  // only ever reclaimed by something still alive.
  SetBreakableMemberSlot(p.group, p.member, p.id);

  // Lifetime is counted in **evt blocks**, not frames: one tick each time the
  // script moves on. A prop outlives a slow player and not a fast one.
  if (G.g_evt_step_index !== p.lastStepIndex) {
    p.stepsElapsed += 1;
    if (p.stepsElapsed > p.lifetime) { ActorDespawnProp(p); return; }
    p.lastStepIndex = G.g_evt_step_index;
  }

  const rec = BreakableGroupMembers(p.group)[p.member];
  const level = rec?.level ?? 0;

  // -- the hit ------------------------------------------------------------
  // Gated on bit 3, and skipped entirely for group 4, whose props are scenery
  // the script breaks rather than the player.
  //
  // [open] The engine also gates on a scene condition — `!(g_scene == 1 &&
  // DAT_009A2BC0 == 0x11 && DAT_009C7228 == 0)` — over three script globals
  // that have not been read out. Nothing here reproduces it.
  if ((p.flags & BreakableFlag.Hit) !== 0 && p.group !== 4) {
    if (p.hp === 1) {
      BreakDestroy(p, level, rng, events);
      // `BreakDestroy` may have swapped the entry point out from under us.
      if (p.dead || (p.family as PropFamily) === PropFamily.Effect) {
        p.flags &= ~HIT_FLAG_MASK;
        return;
      }
    } else if (p.hp === 2) {
      BreakCrack(p, level, rng, events);
    }
  }
  p.flags &= ~HIT_FLAG_MASK;

  // -- the shake ----------------------------------------------------------
  // Purely a draw offset in the engine: `(rand() % 0x97 - 75) * shake * 0.01`
  // on x and z, added at draw time and never written back. The renderer
  // applies it; the port only decays it, because a shake that moved the prop
  // would drag its hull and its hit test along with it.
  if (p.shake > 0.01) p.shake *= BREAKABLE_SHAKE_DECAY;

  switch (p.state) {
    case BreakableState.Standing: StandingStep(p, rec, level, rng); break;
    case BreakableState.Falling: FallStep(p, events); break;
    case BreakableState.Settled: SettleStep(p); break;
    case BreakableState.Removed: break;
  }
}

/** The second shot. Ten points, and then one of two ways to leave. */
function BreakDestroy(p: BreakableProp, level: number, rng: Rng,
                      events?: Events): void {
  BreakablePropAwardHit(p.flags, true, rng);
  p.state = BreakableState.Removed;
  SetBreakableMemberSlot(p.group, p.member, 0);
  events?.emit("prop.broken", { id: p.id, sound: SFX_PROP_BREAK });

  if (level !== 0) {
    // Stacked: it bursts where it stands and is gone this frame.
    BreakablePropSpawnShatter(p, events);
    return;
  }
  // Ground level: the object's entry point is replaced with the puff, and
  // this is where whatever it was hiding comes out.
  p.family = PropFamily.Effect;
  p.effect = 0;
  p.effectFrames = 0;
  ReleaseHiddenItem(p, events);
}

/** The first shot. No score at all — only the hit count and the crack. */
function BreakCrack(p: BreakableProp, level: number, rng: Rng,
                    events?: Events): void {
  if (G.g_GameMode !== 2) BreakablePropAwardHit(p.flags, false, rng);
  p.slot = BreakableSlot.Broken;
  // [diverges] A prop cracked while still standing is turned to face the
  // camera — `obj+0x1D0 = g_camera_angles[g_camera_index].y`. The port has no
  // camera record, so the yaw the group placer drew is kept.
  p.hp -= 1;
  p.shake = BREAKABLE_SHAKE;
  events?.emit("prop.cracked", { id: p.id, sound: SFX_PROP_CRACK });
  ShakeSupportedMembers(p, level);
}

/**
 * A cracked prop shakes every member standing on it.
 *
 * The engine walks the whole group's records and shakes any member that names
 * *this* one as a support — the "who is standing on me" question, read from
 * the other side of the same list. Only props at level 0 or 1 do it.
 */
function ShakeSupportedMembers(p: BreakableProp, level: number): void {
  if (level >= 2) return;
  for (const m of BreakableGroupMembers(p.group)) {
    if (!m.supports?.includes(p.member)) continue;
    const above = BreakablePropAt(p.group, m.index);
    if (above) above.shake = BREAKABLE_SHAKE_NEIGHBOUR;
  }
}

/**
 * Standing: the only thing a whole prop does is check what it is standing on.
 *
 * The engine does **not** stop at the first missing support — it runs the
 * whole entry once per gone support, so a prop losing both draws the random
 * bearing twice. That is two `rand()` calls, and the port makes the same two,
 * because the generator is part of the save state.
 */
function StandingStep(p: BreakableProp, rec: { level: number;
                                               supports: number[] } | undefined,
                      level: number, rng: Rng): void {
  if (level <= 0 || !(rec?.supports?.length)) return;
  for (const s of rec.supports) {
    const under = BreakablePropAt(p.group, s);
    if (under && under.state === BreakableState.Standing) continue;
    BeginFall(p, rng);
  }
}

/** Enter the fall: leave the stack, pick a bearing, and throw the prop. */
function BeginFall(p: BreakableProp, rng: Rng): void {
  p.state = BreakableState.Falling;
  p.vy = 0;
  p.y += BREAKABLE_HEIGHT;

  if ((p.flags & BreakableFlag.FixedTopple) === 0) {
    // `(1 - 2*(rand()&1)) * (rand() % 0x81 + 0x80)`: at least 0x80 of spin,
    // either way. The engine spells the sign with the same masked-modulo
    // idiom the yaw draw uses.
    const sign = 1 - 2 * (MsvcRand(rng) & 1);
    p.spin = sign * ((MsvcRand(rng) % 0x81) + 0x80);
  } else {
    // The authored case keeps the spin the constructor gave it and takes its
    // bearing from `+0x1FE`.
    p.yaw = p.topple;
  }

  // Which way it leans decides the rest pitch, and which end of the bearing
  // the horizontal throw is taken from. `spin < 1` so a zero spin leans back.
  const back = p.spin < 1;
  p.restPitch = back ? -BREAKABLE_REST_PITCH : BREAKABLE_REST_PITCH;
  const bearing = back ? p.yaw + 0x8000 : p.yaw;

  // Two separate draws: the engine calls `rand()` once for each axis.
  p.vx = Math.sin(bearing / BAMS) * ((MsvcRand(rng) % 0xb) * 0.01 + 0.1);
  p.vz = Math.cos(bearing / BAMS) * ((MsvcRand(rng) % 0xb) * 0.01 + 0.1);
}

/**
 * One frame of the fall: gravity, integrate, then ask the hull whether a
 * corner has reached the floor.
 */
function FallStep(p: BreakableProp, events?: Events): void {
  // [open] The engine first looks for another member of the same group that
  // is *below* this one and within 6 units, and zeroes the fall if it finds
  // one — a prop landing on a prop. It measures that with `obj+0x40..0x48`,
  // and nothing in this class ever writes those three floats: `ActorAlloc`
  // zeroes the object from `+0x34` up and `BreakablePropUpdate` only ever
  // writes the position at `+0x19C`. So the comparison is `0 < 0` for every
  // pair and the branch cannot fire. Transcribed, and dead, exactly as it is
  // in the engine — see `hitPos`.
  let resting = false;
  for (const other of G.g_breakable_props) {
    if (other === p || other.dead || other.group !== p.group) continue;
    if (other.member === p.member) continue;
    if (!(other.hitPos.y < p.hitPos.y)) continue;
    const d = Math.hypot(p.hitPos.x - other.hitPos.x,
                         p.hitPos.y - other.hitPos.y,
                         p.hitPos.z - other.hitPos.z);
    if (d < BREAKABLE_REST_RADIUS) { resting = true; p.vy = 0; break; }
  }
  if (!resting) {
    p.vy -= BREAKABLE_GRAVITY;
    p.y += p.vy;
  }

  p.pitch += p.spin;
  p.x += p.vx;
  p.z += p.vz;

  if (BreakablePropGroundContact(p)) {
    p.state = BreakableState.Settled;
    p.settleTimer = 500.0;
    events?.emit("prop.settled", { id: p.id, sound: SFX_PROP_SETTLE });
  }
}

/**
 * One frame of settling: ease the spin toward the rest pitch, and keep
 * re-seating on the lowest hull corner until the motion drops under 0x20.
 */
function SettleStep(p: BreakableProp): void {
  const err = p.restPitch - p.pitch - p.spin;
  p.spin = (err >> 4) + p.spin;
  if (Math.abs(p.spin) > 0x20) {
    p.pitch += p.spin >> 3;
    BreakablePropGroundContact(p);
  }
}

/**
 * Land a shot on a prop, the way the engine's gunshot hit test would: it sets
 * the flag bits that `BreakablePropUpdate` reads on its next frame.
 */
export function BreakablePropTakeShot(p: BreakableProp, player: number): void {
  p.flags |= BreakableFlag.Hit
    | (player === 0 ? BreakableFlag.HitByPlayer0 : BreakableFlag.HitByPlayer1);
}
