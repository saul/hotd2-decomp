/**
 * Class 0x41 type 75 — the one prop in the game that opens a
 * `wait_script_flag` gate.
 *
 * `PropUpdateType75` is `g_class41_updates[75]`, and it
 * raises `g_script_flags[20]` on **three** different instructions —
 * `0x004710D7`, `0x00471120` and `0x00471263`. Stage 4's block 2 step 7 opens
 * with `wait_script_flag 0x14`, no `set_script_flag` anywhere in stage 4 names
 * flag 20, and this is the only writer of it in the image. One shipped spawn:
 * stage 4 block 2 step 5, script address 9580, a `generic` placement of type
 * 75 with `lifetime_evt_steps` 2.
 *
 * What the model it draws, `0xA6B`, depicts is `[open]`: the engine
 * identifies the object by its type number and nothing else.
 *
 * ## Its head
 *
 * It does not call `PropExpireByStepLifetime` (`FUN_00466640`). It **inlines
 * a variant** of it: the `g_scene_index == 1 && g_script_flags[0x77]` sweep
 * is left out, and two lines are folded into the middle of the step-change
 * arm, between spotting the change and charging the lifetime for it. Like
 * every generic routine it is a `GENERIC_ROUTINES` row
 * (`class41/generic_routines.ts`) and brings its own head and tail.
 *
 * Its mode test is the other thing. Types 70, 71, 72 and 76 open with a bare
 * `if (g_GameMode != 1) { ActorDespawn(obj); return; }` and 77 with the same
 * test and a sound. This one **raises the flag on its way out**, so a plain
 * despawn would leave stage 4's gate shut for ever in Arcade Mode, which is
 * the mode the player runs in. Type 74 is the only other routine shaped like
 * it: its Arcade exit raises `g_script_flags[0x13]` (`class41/type74.ts`).
 *
 * ## The three ways the flag goes up
 *
 * | where | when |
 * |---|---|
 * | `0x004710D7` | first frame, whenever `g_GameMode != 1` |
 * | `0x00471120` | the **second** change of `g_evt_step_index`, if unshot |
 * | `0x00471263` | 290 frames after it is shot |
 *
 * So the gate opens on its own in every configuration; shooting the prop only
 * changes how long it takes and what it drops on the way.
 *
 * ## A seek, and the step it counts
 *
 * The middle row is a count of step changes the prop *saw*, and a replay runs
 * no frames to show it any. The placer enters the pool when its instruction
 * runs and places the prop on its first frame, which for a replay is the
 * first frame after the landing -- so a seek to block 2 step 6 or 7 in
 * Original Mode built it with `+0x2A4` at 0 and `+0x196` at the landing step.
 * Step 7's gate waits for this flag before the step can change again, so the
 * prop never saw a second change and the stage parked there until the prop
 * was shot -- the ride arm raised it 290 frames later, which is how a
 * playthrough's spray at a parked flag gate got past -- while a run played
 * through from step 5 passes on step 7's first frame. A seek to step 8 put
 * back a prop play had despawned at that change. A reload is a seek, so a
 * player reloading there met it; nobody playing through could. `L97` is the
 * shape.
 *
 * {@link PropType75FollowReplayFrame} is that count, kept for the prop while
 * the replay runs, and {@link PropType75ResumeFromReplay} hands it to the
 * prop the placer builds. It is a twin of the head and the step arm and of
 * nothing else: a replay fires no shot, so the shot and ride arms cannot run.
 *
 * ## What it draws, and where
 *
 * Every frame, shot or not, the tail evaluates `op_` path 0x178 at the
 * cursor `obj+0x2C0` and draws `AssetDrawSlot(0xA6B)` **at the path's pose
 * and nothing of its own**: `T(path xyz) RotZ(rz) RotY(ry) RotX(rx)`, the
 * three `__ftol`ed angles `CamEvalObjectPath6` (`FUN_004042D0`) returns
 * (`0x0047127A`..`0x004712CE`). Until it is shot the cursor is 0, so the
 * model waits at the path's first point, which is not its placement; shot,
 * it flies the path for 290 frames and stops at its end. The **shot sphere
 * does not fly**: the registration after the draw is at `obj+0x19C`, the
 * placed origin.
 *
 * `PoseHookNone` (`FUN_00420810`), which the shot arm calls with `(6,
 * 0x1F4)` and the ride's end with `(0, 1)`, is an empty function and is not
 * called here.
 */
import type { Events } from "../../core/events";
import type { Rng } from "../../core/rng";
import { SpawnPropHitEffectScaled } from "../effects/sprite";
import { GameMode } from "../game_mode";
import { G } from "../globals";
import { SpawnStoryModeItem } from "./items";
import { PropEvalObjectPath6 } from "./object_path";
import { BreakablePropAwardHit, ActorDespawnProp } from "./prop";
import { PropDrawBegin, PropDrawSlot, PropMatrixPush, PropMatrixTRzRyRx }
  from "./prop_draw";
import {
  BreakableFlag, PropCuePhase, type BreakableProp,
} from "./prop_state";
import type { PropContainerTail } from "./placer_state";
import { PropRegisterAtOrigin } from "./shot_test";

/**
 * The `obj+0x130C` this module's routine belongs to — `g_class41_updates[75]`,
 * at `0x005936BC + 75 * 4 = 0x005937E8`, which is that slot's only xref.
 */
export const PROP75_TYPE = 75;

/**
 * `g_script_flags` — `0x009C7200`, index 20.
 *
 * A literal in the routine and not a field of the placement: all three writes
 * are `MOV byte ptr [0x009C7214], 0x1`, bytes `c60514729c0001`. So it is the
 * same flag for every type-75 prop, which is what lets
 * {@link ClassHandler.raisesScriptFlag} declare it from the spawn record.
 */
export const PROP75_SCRIPT_FLAG = 0x14;

/**
 * `CMP EAX, 0x2` at `0x00471111` — the tick of `obj+0x2A4` the unshot arm
 * fires on.
 *
 * Not "after two steps have elapsed": the counter is incremented and then
 * tested for **equality**, so the flag goes up on that one change and on no
 * other. A prop that lived longer would not raise it again.
 */
export const PROP75_FLAG_STEP = 2;

/** `FADD float ptr [0x004C4380]` — `1.0`, once a frame. */
export const PROP75_RIDE_STEP = 1.0;

/**
 * `FCOMP float ptr [0x0056914C]` — `290.0`.
 *
 * The comparison is `FCOMP` then `TEST AH, 0x1`, which tests C0 — set when the
 * cursor is *below* the constant — and jumps past on that. So the arm fires at
 * `>= 290.0`, and since `ActorAlloc` zeroes `obj+0x2C0` and nothing resets it,
 * that is 290 frames from the shot.
 */
export const PROP75_RIDE_LENGTH = 290.0;

/**
 * `obj+0x2A0 = 1` at `0x004711C9` — the story-mode item kind this drops.
 *
 * `SpawnStoryModeItem` (`FUN_00467B90`) reads the kind out of that word, so
 * the prop is writing its own drop rather than taking one from a placement.
 */
export const PROP75_STORY_ITEM = 1;

/**
 * The world point the drop is made at, `0x004711E7`..`0x00471204`.
 *
 * The routine **overwrites its own position** with these three, calls
 * `SpawnStoryModeItem`, and puts the position straight back — because that
 * routine reads `obj+0x19C`/`+0x1A0`/`+0x1A4` and takes no coordinates. Raw
 * words `0x430E0000`, `0xC26F3333`, `0xC45E2CCD`.
 */
export const PROP75_DROP_AT: readonly [number, number, number] =
  [142.0, -59.79999923706055, -888.7000122070312];

/** `PUSH 0x178` — the `op_` path the model rides. */
export const PROP75_PATH = 0x178;
/** `PUSH 0xA6B` — what it draws. */
export const PROP75_SLOT = 0x0a6b;
/** `PUSH 0x3FC00000` — `SpawnPropHitEffectScaled`'s scale. */
export const PROP75_HIT_EFFECT_SCALE = 1.5;
/** `PlaySoundId(0xE16A9)` and `PlaySoundId(0x391BA9)` — shot. */
export const SFX_PROP75_HIT = 0xe16a9;
export const SFX_PROP75_RIDE = 0x391ba9;
/** `PlaySoundId(0x3A1BA9)` — the ride ends. */
export const SFX_PROP75_RIDE_END = 0x3a1ba9;

/**
 * The shot arm, `0x00471169`..`0x00471226`.
 *
 * `[port-only]` as a *function*: in the engine it is the body of an `if`
 * inside `PropUpdateType75`. It is split out because it is the only part of
 * this routine that needs the `Rng` and the event sink, and folding those
 * through the whole update would put them on three arms that cannot use them.
 * The test stays at the call site, where the engine keeps it.
 */
function PropType75OnShot(p: BreakableProp, rng: Rng, events?: Events): void {
  // `BreakablePropAwardHit(obj+0x34, 0)` — the second argument is 0, so this
  // pays no points; it still counts the hit for the accuracy grade.
  BreakablePropAwardHit(p.flags, false, rng);
  // `SpawnPropHitEffectScaled(obj, (flags & 2) ? 0 : 1, 1.5f)`, at the aim
  // `combat/shot.ts` left on the prop, at the prop's depth.
  if (p.hitAim) {
    SpawnPropHitEffectScaled(p.hitAim.x, p.hitAim.y, p.z,
                             PROP75_HIT_EFFECT_SCALE);
  }
  events?.emit("sound.play", { id: SFX_PROP75_HIT });
  events?.emit("sound.play", { id: SFX_PROP75_RIDE });

  // `obj+0x2A0 = 1`, then the position swap around `SpawnStoryModeItem`.
  p.storyItem = PROP75_STORY_ITEM;
  p.cuePhase = PropCuePhase.Riding;
  const [x, y, z] = [p.x, p.y, p.z];
  [p.x, p.y, p.z] = PROP75_DROP_AT;
  SpawnStoryModeItem(p, rng, events);
  // `MOV byte ptr [0x007DCD14], 0` at `0x00471211`, inside the swap.
  G.g_original_item_pickup_blocked = 0;
  [p.x, p.y, p.z] = [x, y, z];
}

/**
 * `PropUpdateType75` — `FUN_004710C0`. One prop, one 60 Hz frame.
 */
export function PropUpdateType75(p: BreakableProp, rng: Rng,
                                 events?: Events): void {
  PropDrawBegin(p);
  // `if (g_GameMode != 1) { g_script_flags[0x14] = 1; ActorDespawn(obj); }`
  if (G.g_GameMode !== GameMode.Original) {
    G.g_script_flags[PROP75_SCRIPT_FLAG] = 1;
    ActorDespawnProp(p);
    return;
  }

  // `PropExpireByStepLifetime` written out, without its scene-1 sweep and
  // with the flag tick folded into the middle. `obj+0x2A4` is a count of
  // step *changes* and is a different field from the lifetime's `obj+0x197`:
  // the lifetime one is a `char` and this one a full `int`.
  if (G.g_evt_step_index !== p.lastStepIndex) {
    p.removeFlag += 1;
    if (p.removeFlag === PROP75_FLAG_STEP
        && p.cuePhase === PropCuePhase.Untouched) {
      G.g_script_flags[PROP75_SCRIPT_FLAG] = 1;
    }
    p.stepsElapsed += 1;
    if (p.lifetime < p.stepsElapsed) {
      ActorDespawnProp(p);
      return;
    }
    p.lastStepIndex = G.g_evt_step_index;
    // `CMP g_GameMode, EDI / JNZ 0x00471227` at `0x00471161`, with `EDI` still
    // the 1 loaded at `0x004710CA`. **Dead**: the head above has already
    // returned for every mode but 1. Written here as the fall-through it is
    // rather than dropped, so the routine reads as the engine has it.
  }

  if ((p.flags & BreakableFlag.Hit) !== 0
      && p.cuePhase === PropCuePhase.Untouched) {
    PropType75OnShot(p, rng, events);
  }

  // `if (obj+0x192 == 1) { obj+0x2C0 += 1.0; if (obj+0x2C0 >= 290.0) ... }`
  if (p.cuePhase === PropCuePhase.Riding) {
    p.shake += PROP75_RIDE_STEP;
    if (p.shake >= PROP75_RIDE_LENGTH) {
      p.cuePhase = PropCuePhase.Done;
      G.g_original_item_pickup_blocked = 1;
      G.g_script_flags[PROP75_SCRIPT_FLAG] = 1;
      events?.emit("sound.play", { id: SFX_PROP75_RIDE_END });
    }
  }

  // `CamEvalObjectPath6(0x178, obj+0x2C0, &local)`, and the draw at the
  // path's pose alone: `T(xyz) RotZ(rz) RotY(ry) RotX(rx)` on the three
  // `__ftol`ed angles, `0x0047127A`..`0x004712D4`.
  const at = PropEvalObjectPath6(PROP75_PATH, p.shake);
  if (at) {
    const m = PropMatrixPush();
    PropMatrixTRzRyRx(m, at.x, at.y, at.z, at.rx, at.ry, at.rz);
    PropDrawSlot(p, m, PROP75_SLOT);
  }

  // The tail. **The hit bits are not cleared** — this routine has no `AND` on
  // `obj+0x34` anywhere in its 617 bytes, unlike the thirty that share the
  // prologue, and `class41/pool.ts` therefore must not clear them for it
  // either. Nothing re-fires on a stale bit, because both arms that read it
  // are latched on `obj+0x192`. The point is its own origin: the sphere does
  // not fly with the model.
  PropRegisterAtOrigin(p);
}

/**
 * `[port-only]` One frame of {@link PropUpdateType75} as a replay stands in
 * for it, for the prop *t*'s placer will build: the head and the step arm,
 * counted into `t.replay` -- see {@link ClassHandler.followReplayFrame}.
 * Returns false once play would have despawned the prop, which is the
 * caller's to carry out on the placer.
 *
 * The first frame shown is the placer's own, and the prop runs on it too
 * (`ActorAlloc` appends it to the walk behind the placer): `PlaceGenericProp`
 * latches `+0x196 = (u8)g_evt_step_index` and zeroes `+0x197`
 * (`0x00461D61`..`0x00461D6C`), `ActorClearGameFields` has zeroed `+0x2A4`,
 * and case `0x4B` writes only the radius, so the prop sees no change on it. The head runs on it, and in any mode but
 * Original it is the prop's whole life.
 *
 * `obj+0x192` is 0 throughout: a replay fires no shot. `+0x197` and `+0x2A4`
 * start at 0 together and are incremented in the same arm, so one count is
 * both.
 */
export function PropType75FollowReplayFrame(t: PropContainerTail,
                                            lifetime: number): boolean {
  if (G.g_GameMode !== GameMode.Original) {
    G.g_script_flags[PROP75_SCRIPT_FLAG] = 1;
    return false;
  }
  if (t.replay === null) {
    t.replay = { stepSeen: G.g_evt_step_index, steps: 0 };
    return true;
  }
  const w = t.replay;
  if (G.g_evt_step_index !== w.stepSeen) {
    w.steps += 1;
    if (w.steps === PROP75_FLAG_STEP) {
      G.g_script_flags[PROP75_SCRIPT_FLAG] = 1;
    }
    if (lifetime < w.steps) return false;
    w.stepSeen = G.g_evt_step_index;
  }
  return true;
}

/**
 * `[port-only]` Seat what {@link PropType75FollowReplayFrame} counted on the
 * prop the placer has just built: the latch `+0x196`, the lifetime's `+0x197`
 * and the flag's `+0x2A4`. The first frame after the landing is then the
 * frame play would have run there, change and all.
 */
export function PropType75ResumeFromReplay(
    p: BreakableProp, w: Readonly<{ stepSeen: number; steps: number }>): void {
  p.lastStepIndex = w.stepSeen;
  p.stepsElapsed = w.steps;
  p.removeFlag = w.steps;
}
