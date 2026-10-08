/**
 * The three things the port cannot work out on its own.
 *
 * [diverges] The engine reads a bone's world matrix straight out of the
 * actor's own draw records at `obj+0x20C + bone*0x90`, and builds the aim
 * point in the camera's matrix, which it also owns. Here the skeleton and the
 * camera live in three.js, and `game/` may not import it. So the renderer
 * supplies these three answers and the port asks for them by name — a seam,
 * declared, rather than three.js leaking across the boundary.
 *
 * Nothing here returns state: every answer is derived from this frame's pose,
 * so none of it is in a snapshot.
 */
import type { CamPath } from "./camera/curve";
import type { Vec3 } from "./vec";

/**
 * The segment one trigger pull tests.
 *
 * `BuildShotRay` (`FUN_00406110`) unprojects the crosshair with the game's own
 * projection distance and writes the per-player shot record; `ShotBuildSegment`
 * (`FUN_00404AD0`) turns it into `origin -> origin + direction * 1000`. The
 * port carries the two halves it needs — where the shot starts and which way
 * it points — because a queued request has to survive a snapshot and be
 * replayable, and a `Raycaster` is neither plain nor the port's.
 */
export interface ShotRay {
  origin: Vec3;
  /** Unit length, as `ShotBuildSegment` scales it. */
  dir: Vec3;
}

/**
 * What a shot ray found: the nearest thing along it, or nothing.
 *
 * The engine walks **one** depth-sorted candidate list — `MarkActorShot`
 * (`FUN_00404DB0`) sorts it — so a barrel in front of a zombie stops the
 * bullet. The two kinds are different objects in the engine's pools (an actor
 * against a 0x378 breakable), which is why this is a union rather than one
 * shape with two optional halves.
 */
export type ShotPick =
  ({
      kind: "actor";
      /** The actor's spawn address, which is the port's identity for it. */
      at: number;
      /** The bone whose hit sphere the ray entered. */
      bone: number;
      /**
       * Hit **whole**, as the one sphere at `obj+0x124` rather than through
       * a bone -- `ShotTestSphere` (`FUN_00404630`)'s else arm, which
       * `MarkActorShot` records as bone byte 1 rather than an index.
       */
      whole?: boolean;
      /** Where the ray met it, in world space — for the impact effect. */
      point: Vec3;
      /**
       * **A bone shot-tested against its collision mesh** rather than its
       * sphere (`Actor.boneColi`): the quad's surface id, which is the
       * decision's input, and its normal in world space. `ShotTestBoneMesh`
       * (`FUN_004048A0`) traces the shot segment through the bone's own
       * frame against the blob and pushes the nearest quad as the
       * candidate; `MarkActorShot` then runs `SpawnWorldImpact` on it, which
       * is what leaves the point, surface and normal in
       * `g_shot_hit_records`. What a surface *means* is the class's --
       * `Boss4ResolveShot`'s `0x3D` is flesh. Absent for a sphere hit.
       */
      mesh?: { surface: number; normal: Vec3 };
    }
  | {
      kind: "prop"; propId: number; point: Vec3;
      /**
       * A prop shot through its own collision mesh (`ShotTestMesh`,
       * `FUN_00404A00`), which only ever arrives from the registration list:
       * the quad's surface and its normal, for `MarkActorShot`'s world
       * impact, as on an actor. Absent for `render/`'s sphere pick.
       */
      mesh?: { surface: number; normal: Vec3 };
    }
  /**
   * One of `znjoe`'s released creatures — `G.g_body_creatures`, identified by
   * its `id`.
   *
   * Its own kind for the same reason `prop` is one: it is a separate pool in
   * the port, not an actor, so there is no `at` to look it up by. The engine
   * makes no such distinction — `ShotTestSphere` (`FUN_00404630`) tests the
   * creature's `obj+0x70..0x78` sphere in exactly the list it tests every
   * other registered object in — and the split here is the port's object pool
   * showing, not a difference in what a bullet does.
   */
  | { kind: "creature"; creatureId: number; point: Vec3 }
  /**
   * A prop a class-0x30 zombie is carrying or has thrown —
   * `G.g_carried_props`, by `id`. Its own kind for the reason the creature's
   * is: a separate pool in the port, one list in the engine.
   */
  | { kind: "carried"; carriedId: number; point: Vec3 }
  /**
   * A thrown weapon -- `G.g_thrown_weapons`, by `id`. It only ever arrives
   * from the registration list, never from `pickShot`: the weapon registers
   * itself the engine's way (`game/thrown_weapon.ts`).
   */
  | { kind: "thrown"; thrownId: number; point: Vec3 })
  & {
    /**
     * `[port-only]` How far along the shot the pick is, which is how two
     * picks are compared when they come from different places -- see
     * `MergeShotPicks` in `combat/shot.ts`. A pick without it loses to any
     * candidate from the registration list.
     */
    t?: number;
    /**
     * The radius of the sphere the shot entered, whose centre is `point`:
     * `obj+0x124` for a thing hit whole, the bone record's `+0x78` for a
     * bone. `MarkActorShot` (`FUN_00404DB0`) reads it back to put GRENADE's
     * blast on the sphere's near side -- see `MarkActorShotBlast`. Absent for
     * a collision-mesh hit, whose `point` is the hit itself, and for a
     * breakable prop.
     */
    radius?: number;
  };

export interface GameHost {
  /**
   * `CamEvalObjectPath6` — a point on an `op_` object path at a frame.
   *
   * Class 0x25's actors ride these, and the curves live in the bundle's camera
   * block, which `game/` cannot reach: evaluating a Hermite spline is the
   * renderer's job and its result is three.js's. Optional, because a host with
   * no camera paths is a valid host — the port then leaves the actor where it
   * was, which is what a missing path should look like.
   *
   * **Six values.** `FUN_004042D0` fills `{float x,y,z; int rx,ry,rz}` and
   * `ScriptedHumanoidUpdate`'s tail writes all three angles onto `obj+0x64`,
   * `+0x68` and `+0x6C` at `0x00484B6E`-`0x00484B74`. `pitch`/`roll` are here
   * so the attachment-offset rotation in `class25` can stop passing zeros for
   * them; they are optional because a host that only knows a position is
   * still a host.
   */
  objectPath?(slot: number, frame: number):
    { x: number; y: number; z: number;
      pitch?: number; yaw?: number; roll?: number } | null;

  /**
   * A `cp_` camera path by global slot, for the port's own `CamEvalPath7`
   * (`FUN_004041E0`) calls -- `GameOverCameraFlyTick`'s. Optional for the
   * same reason as {@link objectPath}: a host with no paths leaves the camera
   * block where it is.
   */
  camPath?(slot: number): CamPath | null;

  /** World position of one bone on one actor. False if it is not posed. */
  boneWorld(at: number, bone: number, out: Vec3): boolean;
  /** A point `ahead` units in front of the camera, at the eye's height. */
  aimPoint(ahead: number, out: Vec3): void;
  /**
   * A point in the camera's own space, in world coordinates. The engine builds
   * these by unprojecting a screen offset at a depth — see
   * `ThrowerPickLandingPoint`.
   */
  viewPoint(x: number, y: number, z: number, out: Vec3): void;
  /**
   * The actor's tracked point in the camera's own space — `obj+0x70/74/78`,
   * which `FUN_00409B70` fills each frame for every actor.
   *
   * **The field, in the engine's own sign, and no opinion about it.** `-z` is
   * in front: `ThrowerPickLandingPoint` (`FUN_0044CBA0`) unprojects at a
   * literal `-15.5`. It used to hand the depth over *positive* and refuse an
   * actor behind the camera, which is a judgement neither reader asked for —
   * `ActorIsOnScreen` (`FUN_00409C10`) divides by z with no sign test at all,
   * and `ThrowerBeginKnockbackArc` (`FUN_0044D120`) subtracts from it. Both
   * now get what the engine gets.
   *
   * False means there is no camera to measure against, which the engine never
   * has and a headless run always does.
   */
  viewSpaceOf(at: number, out: Vec3): boolean;
  /**
   * A **world point** in the camera's own space — the inverse of
   * {@link GameHost.viewPoint}, and the same sign convention as
   * {@link GameHost.viewSpaceOf}: `-z` is in front.
   *
   * `SpawnSpriteEffectFromParams` (`FUN_004073B0`) reads exactly this, through
   * `MatrixStackSetTopFromArray(&g_camera_blocks + camera * 0x1A4)` at the
   * block's `+0x00` matrix rather than the `+0x40` one every other caller
   * uses, and it is what decides an impact sprite's size. The muzzle effects
   * need it too, to recover the crosshair direction the engine reads straight
   * out of `g_crosshair_x` in pixels.
   *
   * Optional, and false with no camera: an effect then keeps its kind's base
   * scale, which is what the engine uses past fifteen units anyway.
   */
  viewSpaceOfPoint?(p: Vec3, out: Vec3): boolean;
  /**
   * One bone's **world** matrix, sixteen floats in `g_MatrixStackTop`'s own
   * layout (which is `Matrix4.elements`'). The engine reads the bone's
   * view-space draw record at `obj + 0x20C + bone*0x90 + 0x28`; the port
   * multiplies this by {@link GameHost.cameraMatrices}'s world-to-view to get
   * the same numbers. `CarriedPropSeatBetweenBones` (`FUN_00442EB0`) is the
   * reader. Optional and false when the actor is not posed.
   */
  boneMatrix?(at: number, bone: number, out: number[]): boolean;
  /**
   * One bone's world matrix **as the pose left it**, before the class's
   * node hook rewrote the record: what `SkeletonEmitNode` (`FUN_004114C0`)
   * `MatrixStore`s at `+0x28` just before it calls the hook, and what the
   * hook reads there. The same as {@link GameHost.boneMatrix} for every bone
   * a hook leaves alone; different for a civilian's turned head, whose
   * `CivilianDrawBonePart` (`FUN_0048D1F0`) stores the turn over the pose and
   * reads the pose to turn it. Optional and false when the actor is not
   * posed.
   */
  bonePoseMatrix?(at: number, bone: number, out: number[]): boolean;
  /**
   * The two matrices of the camera block `g_camera_index` names:
   * `g_camera_world_to_view` (`0x009A6000`, the block's `+0x00`) and its
   * inverse `g_camera_blocks` (`0x009A6040`, `+0x40`), each `+ index *
   * 0x1A4` -- block 2's under scene state (1, 3), block 0's otherwise -- in
   * the engine's layout. False with no camera.
   */
  cameraMatrices?(worldToView: number[], viewToWorld: number[]): boolean;
  /**
   * One bone's hit sphere: its **world** centre into `out` and its radius
   * returned — `obj + bone*0x90 + 0x274` and `+0x284`, which the engine keeps
   * in view space. `CarriedPropHitTargetSphere` (`FUN_00443540`) tests a
   * dropped prop against the civilian's bone 2 with it. Null when not posed.
   */
  boneSphere?(at: number, bone: number, out: Vec3): number | null;
  /** Swap the asset drawn for one bone — a hand going bare, or gore. */
  setBoneSlot(at: number, bone: number, slot: number): void;
  /**
   * `ShotTestSphere` (`FUN_00404630`) — what one shot segment hits first.
   *
   * The **decision** a hit leads to is the port's and lives in
   * `combat/shot.ts`; the intersection test is not, because the hit spheres
   * ride bones the skeleton poses and the skeleton is three.js's. So the port
   * asks for the nearest candidate and does everything else itself.
   *
   * Optional, because a host with no scene is a valid host: a headless run
   * queues no shots, and one that did would get `undefined` here and resolve
   * every request as a miss.
   *
   * **The spheres are where the last drawn frame put them, and so are the
   * engine's.** `ProcessPlayerShots` (`FUN_00404570`) is a task of its own,
   * created after the player tasks and before any actor (`0x00460751`), so it
   * runs *before* the object pass and reads the draw records the previous
   * frame's pass wrote. A pick made at the head of tick *n* against tick
   * *n-1*'s pose is therefore the engine's arrangement, not a lag. `[proved]`
   * from the task order; see `combat/shot_test.ts`. (This said the opposite
   * for a long time -- that the engine tests the pose it is about to draw.)
   *
   * [diverges] What is left is the case where more than one tick runs between
   * two draws: the engine draws every frame, and the port's pose is then more
   * than one tick old.
   *
   * **Under `Harness.pump` the lag is not one frame, it is all of them.**
   * Nothing draws, so the skeleton holds whatever pose the last real render
   * left, and every pick in a pumped run resolves against that. A harness that
   * pumps and shoots is measuring the wrong thing; `test/port/` stubs
   * `pickShot` rather than pretending otherwise.
   *
   * Closing it means posing in the engine — the skeleton's forward kinematics
   * in `game/` — which is the same missing piece the headless replay needs.
   */
  pickShot?(ray: ShotRay): ShotPick | null;
}

/*
 * `QueryGroundHeightAt`, `QueryGroundSurfaceAt` and `ColiTraceSegmentAllSets`
 * used to be host methods, answered off the *drawn* geometry.
 *
 * They are not any more. The bundle carries the game's own `coli/` sets, so
 * `game/coli.ts` answers them itself — which means the wall search, the ground
 * height and the surface material all work headlessly, against the same quads
 * the engine tests, with the material ids that only `coli/` has. A seam that
 * could only see the resident region and had to report 0 for every surface was
 * the wrong shape for the question.
 */

/** A host that knows nothing, for headless runs. */
export const NULL_HOST: GameHost = {
  boneWorld: () => false,
  aimPoint: () => {},
  viewPoint: () => {},
  viewSpaceOf: () => false,
  setBoneSlot: () => {},
};
