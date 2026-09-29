/**
 * `RegisterForShotTest` for the prop pool, and the sphere it publishes.
 *
 * ## One list
 *
 * A prop files itself in `G.g_shot_test_list`, the list every actor files in,
 * and `combat/shot_test.ts` tests it there: a sphere, or its own collision
 * mesh when `obj+0x34` has bit `0x10`, sorted with every actor's candidate on
 * the view depth. That is the engine's arrangement -- the class-0x41 and
 * class-0x44 objects are tasks like any other and `RegisterForShotTest`
 * (`FUN_00405160`) takes whatever calls it -- and it is what lets a mesh
 * object stop a shot at a zombie behind it. The port used to keep a flag on
 * each prop and let `render/` pick props by the distance along the ray; the
 * class-0x44 meshes (the story-mode switch, stage 1's window) could not be
 * shot at all that way.
 *
 * ## The thing this file existed to fix first
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
 * switch, and the sphere is **not** what opens those: every shipped switch is
 * a mesh object, and the mesh is what is shot (`class44/story_switch.ts`).
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
 * The engine's `obj+0x70..0x78` is a **view-space** point; the port stores
 * the world point ({@link BreakableProp.shotX}) and takes it into view space
 * through the drawn block's world-to-view -- here for the depth half of the
 * gate, and in `combat/shot_test.ts` for `RayTestSphere` -- which is the
 * matrix the engine's routine multiplied it by.
 */
import { CameraBlockWorldToView } from "../camera/view";
import type { ShotTestEntry } from "../combat/shot_test";
import { G } from "../globals";
import { MatrixTransformPoint } from "../matrix";
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
 * `obj+0x34` bit 4 -- test this object against its own collision mesh
 * (`ShotTestMesh`, `FUN_00404A00`) rather than a sphere, and take it at any
 * depth. The prop pool's name for `ActorFlag.ShotTestMesh`; a literal here
 * because this module must not read `actor.ts` at load (`L56`).
 */
export const SHOT_TEST_MESH = 0x10;

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
 * The lines every sphere-registering routine ends with: `obj+0x70..0x78` =
 * the point, then `RegisterForShotTest` (`FUN_00405160`).
 *
 * [port-only] as a *signature*: the engine's routine takes the object and
 * reads the point out of it, because the point was already written on the
 * lines above the call. The port passes it in rather than making every caller
 * write three fields first. The point is written whether or not the object is
 * then taken, as the caller's own stores are.
 */
export function PropRegisterForShotTest(p: BreakableProp, x: number, y: number,
                                        z: number): void {
  p.shotX = x;
  p.shotY = y;
  p.shotZ = z;
  PropShotTestRegister(p);
}

const _view = { x: 0, y: 0, z: 0 };

/**
 * `RegisterForShotTest` (`FUN_00405160`), for an object of the prop pool.
 *
 * ```
 * 00405165  MOV EAX,[EDI+0x34]; TEST AH,0x80; JNZ out     ; bit 0x8000: never
 * 00405171  MOV ECX,EAX; AND ECX,0x10; JNZ take            ; a mesh: always
 * 00405178  FLD [EDI+0x78]; FCOMP [0x004C436C]             ; view z against 0.0
 * 00405181  FNSTSW AX; TEST AH,0x41; JZ out                ; z > 0: behind, out
 * 004051D7  list[g_shot_test_count++] = {obj, obj+0x34, obj+0x12C..0x134}
 * ```
 *
 * `obj+0x78` is the view depth of the point the caller wrote, taken here
 * through the drawn block's world-to-view -- the matrix the routine's caller
 * multiplied it by -- and `TEST AH,0x41` passes on "less", "equal" and
 * "unordered", so only a depth strictly behind the eye is refused. A mesh
 * object ({@link SHOT_TEST_MESH}) is taken at any depth, and its registered
 * point is never read.
 *
 * The entry's `obj+0x12C..0x134` is zero for every prop: `ActorClearGameFields`
 * zeroes it and no class-0x41 or class-0x44 routine is among the writers of
 * `[reg + 0x12c]` (`ColiTestSphereAgainstActors` in `coli.ts` has the search),
 * `[likely]`.
 *
 * [port-only] as a separate function from `combat/shot_test.ts`'s: the
 * engine has one routine for every object, and the port's props are not
 * `Actor`s, so the entry names the prop by `prop` beside the placement's `at`.
 * `p.dead` is the port's pool bookkeeping for an object that has already left.
 */
export function PropShotTestRegister(p: BreakableProp): void {
  if ((p.flags & SHOT_TEST_SUPPRESSED) !== 0 || p.dead) return;
  if ((p.flags & SHOT_TEST_MESH) === 0) {
    MatrixTransformPoint(CameraBlockWorldToView(G.g_camera_index),
                         { x: p.shotX, y: p.shotY, z: p.shotZ }, _view);
    if (_view.z > 0) return;
  }
  const entry: ShotTestEntry = {
    at: p.at, flags: p.flags, x: 0, y: 0, z: 0, prop: p.id,
  };
  G.g_shot_test_list.push(entry);
}

/**
 * Whether this prop is in `g_shot_test_list` (`0x0059D8E8`) now: whether its
 * routine reached `RegisterForShotTest` since the list was last emptied.
 *
 * [port-only] A reading of the list, for the debug panel and the tests; the
 * engine never asks.
 */
export function PropInShotTestList(p: BreakableProp): boolean {
  return G.g_shot_test_list.some((e) => e.prop === p.id);
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
 * Nothing of the pool's is registered this frame until its own routine says
 * so — the engine rebuilds `g_shot_test_list` from zero every frame:
 * `ProcessPlayerShots` resets the count at the end of its pass
 * (`0x0040461E`), which the director runs as `ShotTestListReset` before any
 * task after the player's.
 *
 * [port-only] So in the game this finds nothing to drop. It is here because
 * the pool is also stepped on its own, with no director around it, and a
 * step taken that way would otherwise see the last step's props still filed.
 * Called at the top of the pool's frame.
 */
export function ClearPropShotTestList(): void {
  G.g_shot_test_list = G.g_shot_test_list.filter((e) => e.prop === undefined);
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
