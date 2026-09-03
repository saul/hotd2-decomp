/**
 * Class 0x10 — the civilian, and the game's rescue mechanic.
 *
 * 47 spawns across the six stages, and every one of them is a **script**:
 * `CivilianInit` (`FUN_0048A3E0`) reads a byte at the descriptor tail's `+0x01`
 * and indexes `g_civilian_scripts` (0x005702A8) with it, then hands the stream
 * to `CivilianRunScript` (`FUN_0048B9E0`). Unlike class 0x24 and class 0x25,
 * whose parameters live in the evt, **these scripts are compiled into
 * Hod2.exe** — 67 entry points, 136 streams once the ones only an operand
 * points at are followed, 1,967 commands.
 *
 * ## Two halves, and why there are two
 *
 * A stream is a run of **blocks**, each led by a `Wait` and followed by its
 * actions:
 *
 * * `CivilianRunScript` (`FUN_0048B9E0`) executes opcodes `0x00..0x2C` and
 *   stops before anything above `0x2B`, parking the cursor on the next
 *   `Wait`.
 * * `CivilianStepScript` (`FUN_0048B1E0`) runs every frame and decides whether
 *   the parked wait is over. When it is, `CivilianUpdate` calls the VM again
 *   from the cursor.
 *
 * **The wait word leads its block and governs the wait that follows it.** That
 * is why every shipped stream opens with a `Wait`: the VM runs its first
 * command whatever it is, so the opening `Wait` loads a word, the block runs,
 * and the actor then waits on that word. A word with no wait bits and no timer
 * parks the actor for good, which is how a civilian that has said its line
 * simply stands there — and it is the last command of most of the 136 streams.
 *
 * Every bit of the word is a *reason to keep waiting* — see
 * {@link CivilianWait} — which makes `CivilianStepScript`'s conjunction read
 * inverted: it returns false while the reasons hold.
 *
 * Two consequences worth knowing, both of them the engine's and neither
 * obvious:
 *
 * * **A block whose own wait is already satisfied is skipped.** Once the
 *   parked wait clears, the step loop loads the *cursor's* word and tests it
 *   too; if that passes as well it advances again, and the block it walked
 *   past never runs its actions.
 *   `CivilianReapplyWaitCommand` (`FUN_0048B760`) is what makes that safe — it
 *   re-applies the skipped block's clip, target, timer and cues, which are the
 *   only things a later wait can read.
 * * **The timer does not delay its own block.** The step loop clears it on
 *   every resume, so the value that survives is the one the reapply walk reads
 *   out of the block *ahead* — and a timer of `n` costs `n + 1` frames,
 *   because the test reads the value before the decrement.
 *
 * ## The rescue
 *
 * `CivilianInit` reads a **child count** at tail `+0x0C` and an array of
 * descriptor pointers at `+0x10`, and calls `SpawnFromDescriptor` on each,
 * parenting every one at `child+0x1394`. Those children are the zombies
 * holding the civilian: 47 of them, class 0x30, and **nothing in the evt's
 * instruction stream points at their descriptors** — so the script walker
 * never saw them and this port had neither the zombies nor the rescue.
 *
 * `CivilianPruneDeadChildren` (`FUN_0048CA60`) drops a child from the list
 * when it dies and remembers which player killed it. Wait bit `0x04` blocks
 * until the list is shorter than `childrenGoal`, and the block it unblocks
 * ends with a wait word carrying `0x10000000` — which is where
 * `CivilianRunScript` pays **+400**, to that player or to both.
 *
 * Shooting the civilian instead costs the shooter a **life** and **-100**, and
 * a killing shot costs *both* players 100. That asymmetry is in the code, not
 * a reading of it: the survivable branch calls `ScoreAddForPlayer` once with
 * the player the hit flags name, and the killed branch calls it twice.
 *
 * ## What this does not do
 *
 * [diverges] The **drawing** stays in the renderer, which is where it belongs:
 * `CivilianDrawHeldItems` (`FUN_0048CD10`) is `syncHeldItems` in
 * `render/characters.ts`, and `ActorRegisterCameraPoint`'s shot sphere is that
 * layer's `pick` — this side owns the radius at `obj+0x124` and the item list,
 * and nothing else. `CivilianApplyMotionPose` (`FUN_0048C310`) is not ported:
 * it blends the clip, takes the root translation off the pol file and turns
 * the body by the difference between two bone directions, and the generic
 * `ActorAdvanceMotion` root walk already carries a civilian where its clips
 * say.
 *
 * [open] `CivilianUpdateOnCarrier` (`FUN_0048B140`) pushes a carrier object's
 * translate and rotate around the whole update, for the **7 of 47** spawns
 * whose descriptor `+0x22` is non-zero. The carrier is `g_civilian_carrier`
 * (0x009A2C88), which a class-0x13 sub-constructor writes — and class 0x13 is
 * not read, let alone ported, so there is no object to ride. Those seven stand
 * where the script put them until it is. Naming the dependency is the point:
 * approximating the ride would put them somewhere plausible and wrong.
 *
 * [open] `SpawnCivilianBloodPool` (`FUN_0048E080`) builds a ground decal at the
 * shot point, scaled by how far below the camera plane it is. It is a whole
 * object of its own class with an unread update, and the renderer's impact
 * sprite already marks the hit.
 *
 * ## Where each routine lives
 *
 * One file per group of engine functions, on the exe's own boundaries — this
 * file is the class's assembly point and holds no behaviour of its own.
 *
 * | file          | the engine functions in it                                |
 * | ------------- | --------------------------------------------------------- |
 * | `ops.ts`      | the opcode, wait-bit, target and hook sets both VMs switch on |
 * | `init.ts`     | `CivilianInit` `FUN_0048A3E0`                              |
 * | `script.ts`   | `CivilianRunScript` `FUN_0048B9E0`, `CivilianReapplyWaitCommand` `FUN_0048B760` |
 * | `items.ts`    | `CivilianAddHeldItem` `FUN_0048CAE0`, `CivilianAddPickedItem` `FUN_0048CB60`, `CivilianPickHeldItem` `FUN_0048CBF0` |
 * | `step.ts`     | `CivilianStepScript` `FUN_0048B1E0`                        |
 * | `turn.ts`     | `CivilianStepTurnToTarget` `FUN_0048C850`, `ActorTurnTowardPoint` `FUN_0048C990` |
 * | `children.ts` | `CivilianPruneDeadChildren` `FUN_0048CA60`, `CivilianHookRideChildrenStep` `FUN_0048DAB0` |
 * | `hooks.ts`    | `CivilianHookFallStep` `FUN_0048DA20`, `PoseHookGrowAndPushOutOfWorld` `FUN_0048D070` |
 * | `shot.ts`     | `CivilianPlayDeathVoice` `FUN_0048D140`, and the shot branch of the update |
 * | `loops.ts`    | the update's clip-loop arm                                 |
 * | `update.ts`   | `CivilianUpdate` `FUN_0048A920` and its inline tails        |
 * | `debug.ts`    | the sidebar's row. No exe function.                        |
 * | `state.ts`    | the 0xC4-byte sub-block, field by field                     |
 */
import type { Actor } from "../actor";
import { registerClass, type ClassHandler } from "../registry";
import { SpawnClass } from "../spawn_class";
import { CivilianDebug } from "./debug";
import { CivilianInit } from "./init";
import { CivilianLeaveField, CivilianUpdate } from "./update";
import type { CivilianState } from "./state";

// The class as one name, for `port.test.ts` and for `class30/target.ts`, which
// reads one wait bit. A file that wants one routine should import that file --
// `./ops` for the enums is the common case -- rather than the whole class.
export * from "./ops";
export * from "./items";
export * from "./turn";
export * from "./children";
export * from "./hooks";
export * from "./loops";
export * from "./shot";
export * from "./script";
export * from "./step";
export * from "./init";
export * from "./update";
export * from "./debug";
export type { CivilianState };

export const CivilianHandler: ClassHandler = {
  init: CivilianInit,
  update: CivilianUpdate,
  debug: CivilianDebug,
  // A civilian has no hit table and no hit points: the shot test marks it and
  // `CivilianCheckShot` is what a hit *means*. See `combat/shot.ts`.
  ownsShotResult: true,
  // A shot civilian keeps running: its on-shot script is what plays the fall,
  // the voice and the removal, and stopping at `dead` froze it upright.
  updatesWhenDead: true,
  // `CivilianCheckShot`'s first branch: no on-shot script, no way to be hurt.
  invulnerable: (obj: Actor) => (obj.civ?.onShotScript ?? -1) < 0,
  leave: CivilianLeaveField,
};

/**
 * The civilian, and with it the rescue.
 */
registerClass(SpawnClass.Civilian, CivilianHandler);
