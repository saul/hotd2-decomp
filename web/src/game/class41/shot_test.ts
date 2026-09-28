/**
 * `RegisterForShotTest` for the prop pool, and the sphere it publishes.
 *
 * ## The thing this file exists to fix
 *
 * The port used to pick a prop by the **bounding box of its drawn node**. The
 * engine has never needed a model to shoot something:
 *
 * ```c
 * RegisterForShotTest (FUN_00405160):
 *   if (!(obj+0x34 & 0x8000) && ((obj+0x34 & 0x10) || obj+0x78 <= 0.0))
 *       g_shot_test_list[n++] = { obj, obj+0x34, obj+0x12C, +0x130, +0x134 };
 *
 * ShotTestSphere (FUN_00404630):
 *   if (RayTestSphere(player, obj+0x70, obj+0x74, obj+0x78, obj+0x124) > 0) {
 *       if ((obj+0x34 & 0x80) && skeleton[obj+0x1F4]->nodes > 0
 *           && !(obj+0x34 & 0x8000))  ShotTestSkeleton(obj, player);
 *       else  ...the whole object is one candidate...
 *   }
 * ```
 *
 * A prop has no skeleton, so it is always the else-arm: **one sphere at
 * `obj+0x70..0x78` with radius `obj+0x124`**, and whether it draws anything is
 * beside the point. Nine of the game's route-branch triggers are props the
 * port could not shoot for exactly this reason — three of them draw no static
 * model at all, and one of those, class 0x41 type 25, was the only branch in
 * arcade mode the port could not reach. Five of the nine are the story-mode
 * switch, and the sphere is **not** what opens those: see
 * {@link STORY_SWITCH_RADIUS}. This closes four of the nine and arcade
 * outright, and names what is left.
 *
 * ## Where the point comes from
 *
 * Each update routine builds it itself, at its tail, out of its own position
 * and its own offset — and they all differ. Type 11 registers its raw origin
 * while its *draw* orbits around it; type 7 registers 57 units **below** its
 * origin; type 57 ignores its position entirely and registers a hard-coded
 * world point. There is no general rule and this file does not invent one: a
 * routine transcribed whole (`class41/generic_routines.ts`) calls
 * {@link PropRegisterForShotTest} itself with the point it builds, and
 * {@link PROP_SHOT_OFFSET} is what stands in for the tail of the routines
 * that are not, read out of them one at a time.
 *
 * [diverges] The engine's `obj+0x70..0x78` is a **view-space** point, because
 * `RayTestSphere` (`FUN_004062A0`) works in the shot's own frame. The port
 * stores the world-space point and lets `render/` do the ray test, for the
 * same reason `render/slotmodels.ts` does: the perpendicular distance from a
 * ray to a point is the same number in either frame. The one thing that does
 * *not* survive the change is the `obj+0x78 <= 0` half of the gate above,
 * which is "in front of the camera" — the renderer's own `t <= 0` test is
 * where that lives instead.
 */
import { G } from "../globals";
import {
  BreakableFlag, BreakableState, PropFamily, type BreakableProp,
} from "./prop_state";

/**
 * `obj+0x34` bit 15 — **do not register**. `ActorDespawn` (`FUN_00409CC0`)
 * sets `0x34 |= 0x80018000`, so an object that despawned earlier in the same
 * frame still *calls* `RegisterForShotTest` at its tail and the append does
 * not happen. Transcribed rather than short-circuited, because three of the
 * routines are written exactly that way.
 */
export const SHOT_TEST_SUPPRESSED = 0x8000;

/**
 * `PlaceBreakableGroup` writes `obj+0x124 = 5.0` for every group member.
 * `PlaceFallingContainer` writes 8.0. The kinded props take theirs from
 * `g_prop_kind_params`, which the bundle already carries as `radius`.
 */
export const BREAKABLE_GROUP_RADIUS = 5.0;
export const FALLING_CONTAINER_RADIUS = 8.0;

/**
 * `BreakablePropUpdate`'s standing shot point sits **half a stack level** above
 * the prop's origin — 3.770148, where `level_height` is 7.540296. A prop that
 * is falling or settled registers its raw origin instead, because the routine
 * only assigns the rise inside its `state == 0` arm.
 */
export const BREAKABLE_STANDING_RISE = 3.770148;

/** One type's shot-point offset, in the prop's own space. */
export interface PropShotOffset {
  x?: number;
  y?: number;
  z?: number;
  /** A world point the routine uses **instead** of its own position. */
  world?: readonly [number, number, number];
  /** `y += hitRadius * 0.5` before the constant. Only type 74 does this. */
  halfRadius?: boolean;
}

/**
 * What each **generic** type's routine adds to its own position before
 * registering, for the types whose routine is not transcribed whole — the
 * rows the whole routines used to have here are their own tails now, and all
 * fourteen of those were confirmed against the exe before they went.
 *
 * There is no general rule and this table does not invent one: type 74's
 * offset is a function of its own radius, and type 76's is three magnitudes
 * on world axes. An absent entry means a zero offset, and
 * {@link PROP_SHOT_READ} is what says whether that was read.
 */
export const PROP_SHOT_OFFSET: Partial<Record<number, PropShotOffset>> = {
  70: { y: 1.5 },      // `OriginalItemPropUpdate`; y is live on the bobbing one
  71: { y: 1.5 },      // the same routine
  // `PropUpdateType76` arm 0. The same three magnitudes the sub-model is drawn
  // at -- but the draw applies them INSIDE its rotation frame and this applies
  // them on world axes. That is the exe's own inconsistency, not a reading.
  76: { x: -2.5, y: -30.0, z: -17.5 },
  72: { y: 1.5 },      // `FUN_00470750`, and only while it is falling
  74: { y: -2.0, halfRadius: true },    // `FUN_00470E20`; r*0.5 - 2, so 2.5 at r=9
  75: {},              // `FUN_004710C0`; the sphere stays put while the model flies
};

/**
 * The types whose registration the routine **gates**, and on what, among
 * those not transcribed whole.
 *
 * A gate here is the difference between a prop you can shoot once and a prop
 * you can shoot for ever.
 *
 * [port-only] as a *function*: the routines put their own test around their
 * own registration. Types 14, 25 and 40 were here and are not any more: each
 * is transcribed whole and gates its own tail.
 */
export function PropIsRegisteredThisFrame(p: BreakableProp): boolean {
  switch (p.kind) {
    // The registration lives inside the state-1 arm; states 0 and 2 jump past.
    case 72: return p.state === BreakableState.Falling;
    default: return true;
  }
}

/**
 * The types whose registered point the engine **derives every frame** from a
 * matrix chain the port does not run.
 *
 * [diverges] For these the port registers the placed position plus whatever
 * of the offset is a constant, and the sphere therefore sits where the object
 * was put rather than where it has swung, fallen or flown to. Named here
 * rather than left implicit, because a sphere in the wrong place is a shot
 * that misses and there is no other way to tell.
 *
 * * **75** — the model flies `CamEvalObjectPath6(0x178, ...)` and the sphere
 *   stays at the spawn point. **That is the engine's own behaviour**, not a
 *   divergence, and it is here so nobody `fixes` it.
 * * **77** — `pos + RotY(obj+0x1D0) * CamEvalObjectPath6(0x195, ...)`.
 */
export const PROP_SHOT_DERIVED: ReadonlySet<number> = new Set([75, 77]);

/**
 * Every generic type whose routine has been read for its shot point and is
 * not transcribed whole — a whole routine registers itself and never reaches
 * {@link GenericPropRegisterForShotTest}.
 *
 * A type **absent** from both has not been read, and the port registers it at
 * its own origin. Saying which is which is the whole point of having the set.
 */
export const PROP_SHOT_READ: ReadonlySet<number> = new Set([
  70, 71, 72, 74, 75, 76, 77,
]);

/**
 * `ChainSegmentUpdate`'s link spacing — `MatrixTranslate(0, -1.5, 0)` at the
 * end of each link's chain, so `M_i = M_{i-1} * Rz * Rx * T(0, -1.5, 0)`.
 *
 * The sphere sits at the **bottom** of a link while the model is drawn at its
 * top, and with no swing the twenty links cover thirty units of drop from the
 * anchor. That is why the port places them all at the anchor and then steps
 * them down: a chain of twenty spheres in one spot is one link, not twenty.
 */
export const CHAIN_LINK_DROP = -1.5;

/**
 * `StoryModeSwitchUpdate` **never writes `obj+0x70..0x78`**, and calls
 * `RegisterForShotTest` anyway.
 *
 * `PlaceStoryModeSwitch` decides which consumer sees it, from the descriptor's
 * `+0x08`:
 *
 * * `!= -1` — `obj+0x34 |= 0x51`, so **bit 4 is set** and `ProcessPlayerShots`
 *   sends it to `ShotTestMesh` (`FUN_00404A00`), the volume test on
 *   `obj+0x14C`/`+0x150`. The port has no mesh test, so those are `[open]` and
 *   unshootable here.
 * * `== -1` — bit 4 clear, radius 8.0, and the sphere centre is **still
 *   `(0, 0, 0)`** because nothing ever wrote it. `RayTestSphere`
 *   (`FUN_004062A0`) is a perpendicular-distance test with no divide, so a
 *   centre at the origin is distance 0 from every ray: **the switch answers
 *   any shot fired anywhere on screen.**
 *
 * That is what the binary does. Whether it is intentional is `[open]` — but it
 * is the only reading that explains a switch with no visible target, and the
 * port reproduces it rather than inventing a hitbox the engine has not got.
 */
export const STORY_SWITCH_RADIUS = 8.0;

/**
 * `RegisterForShotTest` (`FUN_00405160`), the prop half.
 *
 * Publishes the sphere centre and marks the object as being in
 * `g_shot_test_list` for this frame. The suppression bit is the engine's; the
 * in-front-of-the-camera half of its condition is the renderer's, per the file
 * comment.
 *
 * [port-only] as a *signature*: the engine's routine takes the object and
 * reads the point out of it, because the point was already written to
 * `obj+0x70..0x78` on the two lines above the call. The port passes it in
 * rather than making every caller write three fields first.
 */
export function PropRegisterForShotTest(p: BreakableProp, x: number, y: number,
                                        z: number): void {
  if ((p.flags & SHOT_TEST_SUPPRESSED) !== 0 || p.dead) {
    p.shotRegistered = false;
    return;
  }
  p.shotX = x;
  p.shotY = y;
  p.shotZ = z;
  p.shotRegistered = true;
}

/**
 * The commonest tail: the prop's own origin, unshifted.
 *
 * [port-only] as a *function*. The engine writes these three lines out at the
 * bottom of the routines that use it; one here, because eight of the twenty
 * that were read want exactly this and eight copies is eight chances to get
 * one of them wrong.
 */
export function PropRegisterAtOrigin(p: BreakableProp): void {
  PropRegisterForShotTest(p, p.x, p.y, p.z);
}

/**
 * A generic prop's tail, from {@link PROP_SHOT_OFFSET} and
 * {@link PROP_SHOT_WORLD_POINT}.
 *
 * [port-only] as a *function*: the engine writes these three lines out at the
 * bottom of thirty routines. One here, driven by a table, because thirty
 * copies of `y + k` is thirty chances for one of them to be `y - k`.
 */
export function GenericPropRegisterForShotTest(p: BreakableProp): void {
  if (!PropIsRegisteredThisFrame(p)) {
    p.shotRegistered = false;
    return;
  }
  const off = PROP_SHOT_OFFSET[p.kind];
  if (off?.world) {
    PropRegisterForShotTest(p, off.world[0], off.world[1], off.world[2]);
    return;
  }
  const rise = (off?.halfRadius ? p.hitRadius * 0.5 : 0) + (off?.y ?? 0);
  PropRegisterForShotTest(p, p.x + (off?.x ?? 0), p.y + rise,
                          p.z + (off?.z ?? 0));
}

/**
 * Nothing is registered this frame until its own routine says so — the engine
 * rebuilds `g_shot_test_list` from zero every frame and
 * `ProcessPlayerShots` resets the count at the end of its pass.
 *
 * [port-only] The port has no list to clear, so this clears the flag on every
 * prop instead. Called at the top of the pool's frame, which is where
 * `FUN_00404570`'s `DAT_005A4C80 = 0` effectively puts it.
 */
export function ClearPropShotTestList(): void {
  for (const p of G.g_breakable_props) p.shotRegistered = false;
}

/**
 * Whether this prop is shootable while drawing nothing — an **invisible
 * target**, which is a thing the engine has and the port used not to.
 *
 * [port-only] The engine never asks: its shot test does not look at models at
 * all. This is for the debug panel, so a prop the port cannot draw can still
 * be seen to exist.
 */
export function PropIsInvisibleTarget(p: BreakableProp): boolean {
  return p.family === PropFamily.Generic && p.hitRadius > 0
    && (p.flags & BreakableFlag.Live) !== 0;
}
