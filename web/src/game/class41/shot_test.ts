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
 * world point. There is no general rule and this file does not invent one:
 * every routine (`class41/generic_routines.ts` for the generic types) calls
 * {@link PropRegisterForShotTest} itself with the point it builds.
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
import { BreakableFlag, PropFamily, type BreakableProp } from "./prop_state";

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

/**
 * `StoryModeSwitchUpdate` **never writes `obj+0x70..0x78`**, and calls
 * `RegisterForShotTest` anyway.
 *
 * `PlaceStoryModeSwitch` decides which consumer sees it, from the descriptor's
 * `+0x08`:
 *
 * * `!= -1` — `obj+0x34 |= 0x51`, so **bit 4 is set** and `ProcessPlayerShots`
 *   sends it to `ShotTestMesh` (`FUN_00404A00`), the volume test on
 *   `obj+0x14C`/`+0x150`. The port has that routine for an actor
 *   (`combat/shot_test.ts`), but the prop pool files itself in its own flag,
 *   not in `G.g_shot_test_list`, and carries neither the volume as a blob nor
 *   a matrix, so these are unshootable here. **Every shipped switch names a
 *   volume** -- all nine records in the arcade bundles -- so this is the arm
 *   the game takes.
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
