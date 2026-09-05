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
 * {@link PROP_SHOT_OFFSET} is a table read out of the routines one at a time.
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
 * registering, read one routine at a time out of the twenty that were read.
 *
 * There is no general rule and this table does not invent one. Type 7
 * registers **57 units below** its origin against a radius of 12; type 11
 * registers its raw origin while its draw orbits around it; type 57 ignores
 * its position entirely; type 74's offset is a function of its own radius.
 * Eight of the twenty are a plain zero, which is why an absent entry means
 * that and not "unread" — {@link PROP_SHOT_READ} is what says which is which.
 */
export const PROP_SHOT_OFFSET: Partial<Record<number, PropShotOffset>> = {
  7: { y: -57.0 },     // `FUN_00466930`, against a radius of 12
  11: {},              // `FUN_00467C80`; its DRAW orbits, the sphere does not
  14: {},              // `PropUpdateType14`
  19: {},              // `PropUpdateType19` -- see PROP_SHOT_DERIVED
  20: { y: -1.0 },     // `FUN_00469380`
  25: { y: 12.0 },     // `PropUpdateType25`
  41: { y: 5.0 },      // `FUN_0046CC50`, a two-panel hinge; one sphere either way
  49: { y: 1.0 },      // `FUN_0046E6E0` -- see PROP_SHOT_DERIVED
  56: { x: 4.8, y: -0.55, z: -10.5 },   // `PropUpdateType56`, off the base
  57: { world: [-697.042, -9.861, -529.244] },   // `FUN_0046F350`
  58: {},              // `FUN_0046F580`
  60: {},              // `FUN_0046F840`
  69: { y: 1.5 },      // `PropUpdateType69`
  70: { y: 1.5 },      // `OriginalItemPropUpdate`; y is live on the bobbing one
  71: { y: 1.5 },      // the same routine
  73: { y: 8.0 },      // `PropUpdateType73`; its DRAW adds +0x1C8 to z, this does not
  // `PropUpdateType76` arm 0. The same three magnitudes the sub-model is drawn
  // at -- but the draw applies them INSIDE its rotation frame and this applies
  // them on world axes. That is the exe's own inconsistency, not a reading.
  76: { x: -2.5, y: -30.0, z: -17.5 },
  72: { y: 1.5 },      // `FUN_00470750`, and only while it is falling
  74: { y: -2.0, halfRadius: true },    // `FUN_00470E20`; r*0.5 - 2, so 2.5 at r=9
  75: {},              // `FUN_004710C0`; the sphere stays put while the model flies
};

/**
 * `PropUpdateType40`'s y offset, which its own routine picks from the **draw
 * slot** rather than from the sub-kind, as a chain of overrides:
 *
 * ```c
 * y = 0.0;
 * if (obj+0x1BA == 0)                              y = 2.5;
 * if (obj+0x1E0 == 0x17C6)                         y = 8.0;
 * if (obj+0x1E0 == 0x1786 || obj+0x1E0 == 0x16B1)  y = 5.0;
 * ```
 *
 * Resolved through `PlaceFragmentProps`' slot table this gives the per-sub-kind
 * values below. **Sub-kind 9 — the route-branch pair — is 8.0**, which is a
 * long way up against a radius of 5.5 and is exactly the sort of number a port
 * gets wrong by assuming zero.
 */
export const FRAGMENT_SHOT_RISE: Partial<Record<number, number>> = {
  0: 2.5,
  2: 8.0, 3: 8.0, 4: 8.0, 9: 8.0, 10: 8.0, 15: 8.0,
  5: 5.0, 7: 5.0, 8: 5.0,
};

/** `PlaceFragmentProps` writes `obj+0x124 = 0x40B00000` for every sub-kind. */
export const FRAGMENT_RADIUS = 5.5;

/**
 * The types whose registration the routine **gates**, and on what.
 *
 * A gate here is the difference between a prop you can shoot once and a prop
 * you can shoot for ever. Type 25's is the sharpest: a scoring hit sets
 * `obj+0x34 |= 0x44000000` and bit 26 removes it from the shot test
 * permanently, which is why its route can only be opened once.
 *
 * [port-only] as a *function*: four routines put their own test around their
 * own registration, and they are gathered here so a reader can see there are
 * four and not thirty.
 */
export function PropIsRegisteredThisFrame(p: BreakableProp): boolean {
  switch (p.kind) {
    // `CMP AL,1 / JG` on `obj+0x192`: states 0 and 1 register, 2 and 3 do not.
    case 14: return p.state <= BreakableState.Falling;
    // `TEST [ESI+0x34], 0x4000000 / JNZ` -- one scoring hit ends it.
    case 25: return (p.flags & PROP_SHOT_TEST_DONE) === 0;
    // The registration lives inside the state-1 arm; states 0 and 2 jump past.
    case 72: return p.state === BreakableState.Falling;
    // `PropUpdateType40`: gated solely by `obj+0x1B9 == 0`, which the first
    // hit sets and nothing ever clears. **One shot ends it for ever** — the
    // forty-piece debris that follows runs unregistered.
    case 40: return !p.branchLatched;
    default: return true;
  }
}

/**
 * `obj+0x34` bit 26 — `PropUpdateType25`'s "already answered, stop testing".
 * Its scoring hit sets `0x44000000`, and bit 26 is the half that gates the
 * registration; bit 30 alone (which the frame-0xFE timeout sets) stops the
 * award and leaves it shootable.
 */
export const PROP_SHOT_TEST_DONE = 0x04000000;

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
 * * **19** — the point is `obj+0x40` plus `(-9.0, 11.0, 0.5)` put through
 *   `RotY(0xC000) * Rz(+0x6C) * RotY(+0x68) * Rx(+0x64) * Rx(+0x1E4)` and then
 *   `translate(0, -2, 0)`. All four angle fields are zero on a freshly placed
 *   prop, so only the constant `RotY(0xC000)` is missing at rest.
 * * **49** — the position is rewritten each frame by resting one of thirteen
 *   hull vertices on the floor; the port does not run the tumble.
 * * **75** — the model flies `CamEvalObjectPath6(0x178, ...)` and the sphere
 *   stays at the spawn point. **That is the engine's own behaviour**, not a
 *   divergence, and it is here so nobody `fixes` it.
 * * **77** — `pos + RotY(obj+0x1D0) * CamEvalObjectPath6(0x195, ...)`.
 */
export const PROP_SHOT_DERIVED: ReadonlySet<number> = new Set([19, 49, 75, 77]);

/**
 * Every generic type whose routine has been read for its shot point.
 *
 * A type **absent** from this set has not been read, and the port registers it
 * at its own origin — which is right for eight of the twenty that were read
 * and is a guess for the rest. Saying which is which is the whole point of
 * having the set.
 */
export const PROP_SHOT_READ: ReadonlySet<number> = new Set([
  7, 11, 14, 19, 20, 25, 41, 49, 56, 57, 58, 60, 69, 70, 71, 72, 73, 74, 75,
  76, 77,
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
  // Type 40 picks its rise from the draw slot, which resolves per sub-kind.
  if (p.kind === 40) {
    PropRegisterForShotTest(p, p.x,
                            p.y + (FRAGMENT_SHOT_RISE[p.subKind] ?? 0), p.z);
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
