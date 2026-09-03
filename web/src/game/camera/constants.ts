/**
 * The camera director's compiled-in numbers.
 *
 * Every constant here is an **immediate in `.text`** — a literal the compiler
 * put inside a routine — not an entry in a table the exporter can read. Under
 * the rule in `docs/formats/bundle.md` those belong in `game/` with their
 * citation, not in the bundle: they were in `manifest`-adjacent JSON, which
 * meant the number lived in `hod2lib/approach.py` with the function that
 * proves it while the TypeScript using it had a bare `?? 14` and
 * `verify_port.py` could not see either half.
 *
 * The one thing here that is *not* in this file is the turn-rate curves
 * themselves: `PTR_DAT_00576C04` is four 64-byte arrays in `.rdata`, so those
 * still travel in the bundle as `tracking.curves`.
 */

/**
 * `RegisterForCameraTracking` (`FUN_00408EC0`) sorts candidates by
 * `|actor - eye| * 10` as an int, ascending — nearest first. The scale is what
 * makes it a radix sort over integers rather than a float compare, so two
 * actors within a tenth of a unit of each other keep their list order.
 */
export const CAMERA_TRACK_DISTANCE_SCALE = 10;

/** How many of that sorted list are considered at all. */
export const CAMERA_MAX_CANDIDATES = 14;

/**
 * Slots 0 and 1 are reserved for enemies holding an attack permit; the rest
 * of the table fills from 2.
 */
export const CAMERA_ATTACK_SLOTS = 2;

/**
 * The slot table's length. Nothing in the port bounds `g_enemy_slots` by it
 * yet — `CAMERA_MAX_CANDIDATES` is the tighter limit and does the work — but
 * it is the engine's array size and belongs beside the other two.
 */
export const CAMERA_SLOTS = 16;

/**
 * `TurnActorTowardCamera` (`FUN_00409ED0`) faces an actor at a point this far
 * in front of the camera, not at the eye.
 *
 * `SelectCameraLookAtTarget` (`FUN_00403050`) reuses the number to lift the
 * stand-in look-at point off an actor's origin while the renderer has not yet
 * posed it and found the real bone.
 */
export const ACTOR_FACE_OFFSET = 1.5;

/**
 * The angle error `ComputeLookAtAngleError` clamps to before indexing the
 * turn-rate curve. `0x1FFF` BAMS is 45°, and the curve covers exactly that.
 */
export const TURN_ERROR_CLAMP = 0x1fff;

/**
 * Which of the four curves the scene reset (`FUN_0045EEC0`) selects into
 * `g_camera_turn_curve`. It is a runtime global because the engine *can* point
 * it at any of the four, not because anything shipped ever does.
 */
export const TURN_CURVE_DEFAULT = 1;

/**
 * The rate used while nothing is being tracked — the first byte of curve 2.
 *
 * A larger value is a *slower* turn: `TurnLookAtToward` (`FUN_00403C00`) steps
 * `1 / (1 + rate)` of the remaining angle.
 */
export const TURN_RATE_UNTRACKED = 12;

/** `TurnLookAtToward` re-emits the eased look-at this far from the eye. */
export const LOOKAT_RADIUS = 100;
