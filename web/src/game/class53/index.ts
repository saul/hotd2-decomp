/**
 * Class 0x53 — the cat, and a **route-branch trigger**.
 *
 * Four spawns, all stage 2, in blocks 3, 5, 8 and 11. `CatInit`
 * (`FUN_00431250`) reads two s16s off the descriptor tail: an animation set
 * that indexes the playlist at `g_cat_motions` (`0x00589A64`), and a
 * sub-type. The sub-type picks which of two routines the object runs for the
 * rest of its life:
 *
 * ```
 * 0, 1     CatMotionListUpdate      plays its set's clips in order, leaves at 1000 frames
 * 2 and up CatBranchTriggerUpdate   waits to be shot in block 8, writes route 2, runs off
 * ```
 *
 * The species is settled rather than guessed: `g_character_skeletons`
 * (`0x004E0430`) puts all eighteen of character type `0x1A`'s nodes in
 * `cat.bin`, which is one of the binary's two name tables.
 *
 * ## Nothing in the class moves the cat. Its clips do.
 *
 * Neither routine writes `obj+0x40`. What carries the cat across the room is
 * the clip's own root translation, which `SkeletonApplyRootMotion`
 * (`FUN_00410C50`) applies from inside `DrawSkinnedModelAndShadow` on every
 * skinned actor — `ActorBuildSkinnedModel` leaves `model+0x64` bit 1 set, and
 * no cat routine clears it. So the whole of "the cat runs away" is *which clip
 * is playing*: `0x2FD`, the last entry of four of the six sets and the clip
 * the trigger flees on, is the one that travels.
 *
 * That is why the block-11 report was a bundle gap as much as a port gap. The
 * exporter baked only entry 0 of each spawn's set, so character type `0x1A`
 * carried `0x2FC`, `0x2FF`, `0x301` and `0x305` and **not** `0x2FD`: even a
 * transcribed playlist would have stepped on to a clip with no frames and no
 * play length, and the cat would have crept 2.7 units and stopped. `CAT_CLIPS`
 * (`records.ts`) is every clip the class can reach, and the exporter bakes it.
 *
 * ## The block gate, and why the data proves it
 *
 * ```c
 * if ((obj->+0x34 & 8) && g_script_branch_var == 0 && g_evt_block_index == 8) {
 *     g_script_branch_var = 2;
 *     ...motion 0x2FD, sub-state 1...
 * }
 * ```
 *
 * Three conditions, and the shipped data agrees with all three at once. Of the
 * four spawns **only block 8's carries a sub-type above 1** — the others are
 * sets 2, 4 and 5 at sub-types 0, 0 and 1 — so the one cat that could answer
 * is the one standing in the block that is allowed to. And block 8's route
 * record is `{10, -1, 32}`: slot 1 is a hole and slot 2 is real, which is
 * exactly what a write of 2 wants. Blocks 3, 5 and 11 have live slots that a 2
 * would miss or a hole it would fall into, and the gate is what keeps their
 * cats out of it.
 *
 * `g_script_branch_var == 0` is the third condition and it is a **courtesy**:
 * this trigger will not overwrite an answer something else has already given.
 * It is the only writer in the game that checks.
 *
 * ## What is not ported
 *
 * `obj+0x1FC = 1`, `model+0x68`: the order `SkeletonApplyRootMotion` composes
 * the three object rotations in. The port has no field for it on an actor
 * without the model block, and every shipped cat is turned about y alone, for
 * which all six orders are the same matrix.
 */
import type { Actor } from "../actor";
import { ActorFlag, ZombieAux } from "../actor";
import { ActorSetMotionBlended } from "../class30/motion_cue";
import { RegisterForShotTest } from "../combat/shot_test";
import { ActorDespawn } from "../despawn";
import { GameMode } from "../game_mode";
import { G } from "../globals";
import type { GameHost } from "../host";
import {
  registerClass, type ActorDebug, type ClassFrame, type ClassHandler,
} from "../registry";
import { SpawnClass } from "../spawn_class";
import { MotionPlayLength } from "../tables";
import {
  CAT_LIST_END, CAT_LIST_STRIDE, CAT_MOTION_REPEATS, CAT_MOTIONS,
  CAT_REPEAT_FOREVER,
} from "./records";
import { CatTriggerState, type CatTail } from "./state";

export { CatTriggerState } from "./state";
export type { CatTail } from "./state";

/** `obj+0x1F4 = 0x1A` — `cat.bin`, and the only type the class writes. */
export const CAT_CHAR_TYPE = 0x1a;

/** The one event block `CatBranchTriggerUpdate` answers in. */
export const CAT_BRANCH_BLOCK = 8;

/** What it writes there. */
export const CAT_BRANCH_VALUE = 2;

/** The sub-type at and above which the cat is a trigger rather than a cat. */
export const CAT_FIRST_TRIGGER_SUBTYPE = 2;

/** The sub-type that also raises `obj+0x38` bit 3 — drawn scene-lit. */
export const CAT_SCENE_LIT_SUBTYPE = 1;

/**
 * `sub+0x12 > 1000` — `CatMotionListUpdate` despawns the cat on the frame
 * its life passes this, whatever clip it is on.
 */
export const CAT_LIFE_FRAMES = 1000;

/**
 * `obj+0x124 = 4.0` (`0x40800000`) — the trigger's shot sphere. Only the
 * trigger arm writes it, and only the trigger registers for the shot test at
 * all: a cat that plays its list cannot be shot.
 */
export const CAT_TRIGGER_HIT_RADIUS = 4.0;

/** The clip `CatInit` seats a trigger on, and the one it stops on. */
export const CAT_TRIGGER_IDLE_MOTION = 0x305;
/** `ActorSetMotionBlended(model, 0x2FA, 0, 10)` once 200 frames have passed. */
export const CAT_TRIGGER_CUE_MOTION = 0x2fa;
/** ...and `0x2FD` on the shot: the clip that carries it away. */
export const CAT_TRIGGER_FLEE_MOTION = 0x2fd;
/** `199 < sub+0x12` — the wait before the cue clip. */
export const CAT_TRIGGER_CUE_AFTER = 199;
/** The fade every one of the trigger's three clip changes asks for. */
export const CAT_TRIGGER_FADE = 10;
/** `obj+0x40 < -478.0` — where the flight stops. */
export const CAT_TRIGGER_STOP_X = -478.0;
/**
 * `g_script_flags[0x83]` — `DAT_009C7283`. Set, the trigger despawns on its
 * next frame. Stage 2's script raises it in block 8, on the line after it
 * frees `cat.bin`.
 */
export const CAT_TRIGGER_REMOVE_FLAG = 0x83;

/** An actor already narrowed to class 0x53. */
type CatActor = Actor & { cat: CatTail };

function Tail(obj: Actor): CatTail | null {
  return (obj as CatActor).cat ?? null;
}

function SubType(obj: Actor): number {
  return obj.class53?.subtype ?? 0;
}

/**
 * `CatInit` — `FUN_00431250`.
 *
 * ```c
 * obj->+0x1F4 = 0x1A;  obj->+0x1FC = 1;
 * sub = ActorAllocSub(0x24);  obj->+0x1310 = sub;
 * sub->+0x10 = tail->+0x00;  sub->+0x12 = 0;  sub->+0x1E = 0;  sub->+0x1C = 0;
 * obj->+0x1B4 = g_cat_motions[set * 5];
 * if (tail->+0x02 < 2) {
 *     if (tail->+0x02 == 1) obj->+0x38 |= 8;
 *     ActorBuildSkinnedModel(...);
 *     *obj = CatMotionListUpdate;  obj->+0x34 &= ~0x80;  return;
 * }
 * if (g_GameMode != 1) { ActorDespawn(obj); return; }
 * obj->+0x1B4 = 0x305;  obj->+0x124 = 4.0;  sub->+0x10 = 0;  sub->+0x12 = 0;
 * ActorBuildSkinnedModel(...);
 * *obj = CatBranchTriggerUpdate;  obj->+0x34 &= ~0x80;
 * ```
 *
 * **The mode gate is in the Init**, so an arcade run never has a trigger cat
 * standing inert — it has no cat at all in that slot.
 *
 * Both of its `ActorBuildSkinnedModel` calls (`0x004312C8`, `0x00431319`) are
 * followed by `AND AL,0x7F` on `obj+0x34` (`0x004312D3`, `0x00431324`), which
 * takes back the per-bone bit the build has just raised: a cat is shot as one
 * sphere. `ActorSpawn` runs the build before this, so the clear is here.
 *
 * `obj+0x38 |= 8` is {@link ZombieAux.SceneLit}: sub-type 1 is drawn through
 * the scene light array while `g_scene_lighting` is up. Block 11's cat is
 * that sub-type, spawned three instructions after the block turns the scene
 * lighting on.
 */
export function CatInit(obj: Actor): void {
  const sub = Tail(obj);
  if (!sub) return;
  obj.charType = CAT_CHAR_TYPE;
  sub.set = obj.class53?.anim_set ?? 0;
  sub.frames = 0;
  sub.loops = 0;
  sub.index = 0;
  obj.motion = CAT_MOTIONS[sub.set * CAT_LIST_STRIDE] ?? obj.motion;
  const subtype = SubType(obj);
  if (subtype < CAT_FIRST_TRIGGER_SUBTYPE) {
    if (subtype === CAT_SCENE_LIT_SUBTYPE) obj.flags38 |= ZombieAux.SceneLit;
    obj.flags &= ~ActorFlag.ShootPerBone;
    return;
  }
  if (G.g_GameMode !== GameMode.Original) {
    ActorDespawn(obj);
    return;
  }
  obj.motion = CAT_TRIGGER_IDLE_MOTION;
  obj.hitRadius = CAT_TRIGGER_HIT_RADIUS;
  sub.set = CatTriggerState.Waiting;
  sub.frames = 0;
  obj.flags &= ~ActorFlag.ShootPerBone;
}

/**
 * `CatMotionListUpdate` — `FUN_00431340`. Sub-types 0 and 1: the cat that
 * plays its set's clips, one after another, and leaves.
 *
 * ```c
 * LightsUseSecondarySet();
 * DrawSkinnedModelAndShadow(obj+0x194, obj+0x40, obj+0x20C);
 * LightsRestoreScene();
 * model[0] += 1;  sub->+0x12 += 1;
 * row = sub->+0x10 * 5;
 * if (model[0] == g_motion_play_length[g_cat_motions[row + sub->+0x1C]] - 1) {
 *     model[0] = 0;  sub->+0x1E += 1;
 *     rep = g_cat_motion_repeats[row + sub->+0x1C];
 *     if (rep != -2 && rep == sub->+0x1E) {
 *         if (g_cat_motions[row + ++sub->+0x1C] == -1) sub->+0x1C = 0;
 *         obj->+0x1B4 = g_cat_motions[row + sub->+0x1C];
 *         model[0] = 0;  sub->+0x1E = 0;
 *     }
 * }
 * if (1000 < sub->+0x12) ActorDespawn(obj);
 * ```
 *
 * **A clip plays to `play_length - 2` and no further**: the counter is reset
 * the moment it *reaches* `play_length - 1`, before anything draws it. And the
 * next clip is seated by writing `obj+0x1B4` outright, not through
 * `ActorSetMotion` — no fade, no re-seeded root baseline — so the cut is
 * hard, and `SkeletonApplyRootMotion`'s large-jump test is what keeps the
 * change from teleporting the cat.
 *
 * Set 5, block 11's: `0x305` twice (in place, 57 frames each), `0x2FC` once
 * (78 frames), then `0x2FD` for ever — so the cat stands for 114 frames,
 * walks for 78, and runs from frame 192 until it is taken away at 1001.
 *
 * The draw and `model[0] += 1` are the port's: the director's
 * `ActorAdvanceMotion` steps the counter before this runs, which is the value
 * the engine's test reads after its own increment.
 */
export function CatMotionListUpdate(obj: Actor): void {
  const sub = Tail(obj);
  if (!sub) return;
  sub.frames += 1;
  const row = sub.set * CAT_LIST_STRIDE;
  const clip = CAT_MOTIONS[row + sub.index] ?? obj.motion;
  if (obj.playTicks === MotionPlayLength(obj, clip) - 1) {
    obj.playTicks = 0;
    sub.loops += 1;
    const rep = CAT_MOTION_REPEATS[row + sub.index];
    if (rep !== CAT_REPEAT_FOREVER && rep === sub.loops) {
      sub.index += 1;
      if ((CAT_MOTIONS[row + sub.index] ?? CAT_LIST_END) === CAT_LIST_END) {
        sub.index = 0;
      }
      obj.motion = CAT_MOTIONS[row + sub.index] ?? obj.motion;
      obj.playTicks = 0;
      sub.loops = 0;
    }
  }
  if (sub.frames > CAT_LIFE_FRAMES) ActorDespawn(obj);
}

/**
 * `CatBranchTriggerUpdate` — `FUN_00431430`. Sub-type 2 and up: **the branch
 * writer**, and the cat that runs from the shot.
 *
 * ```c
 * if (g_script_flags[0x83] == 1) { ActorDespawn(obj); return; }
 * if (sub->+0x10 == 0) {
 *     sub->+0x12 += 1;
 *     if (obj->+0x1B4 == 0x305 && 199 < sub->+0x12)
 *         ActorSetMotionBlended(model, 0x2FA, 0, 10);
 *     if ((obj->+0x34 & 8) && g_script_branch_var == 0 && g_evt_block_index == 8) {
 *         g_script_branch_var = 2;
 *         ActorSetMotionBlended(model, 0x2FD, 0, 10);
 *         sub->+0x10 = 1;
 *     }
 * } else if (sub->+0x10 != 1) goto draw;
 * if (obj->+0x40 < -478.0) { sub->+0x10 = 2; ActorSetMotionBlended(model, 0x305, 0, 10); }
 * draw: ...DrawSkinnedModelAndShadow...;  model[0] += 1;
 * ActorRegisterOriginInViewSpace(obj);
 * ```
 *
 * The `g_script_branch_var == 0` test means a route already answered stands,
 * which no other writer in the game respects. The `x` test runs in the waiting
 * arm too, so a trigger placed past `-478` would stop on its first frame;
 * block 8's stands at `-411.3`, facing `-x`, and `0x2FD`'s root motion is
 * what takes it the 67 units to the line.
 *
 * **Nothing here clears `obj+0x34` bit 3**, and nothing else does either:
 * `ProcessPlayerShots` (`FUN_00404570`) only raises it. Once shot, the bit
 * stays up, which matters only while the trigger is still waiting — a shot in
 * block 8 after the route is already answered stays pending, and answers if
 * the variable is ever 0 again while the cat is in block 8.
 *
 * The draw and `model[0] += 1` are the port's, as for
 * {@link CatMotionListUpdate}.
 */
export function CatBranchTriggerUpdate(obj: Actor, host: GameHost): void {
  const sub = Tail(obj);
  if (!sub) return;
  if ((G.g_script_flags[CAT_TRIGGER_REMOVE_FLAG] ?? 0) === 1) {
    ActorDespawn(obj);
    return;
  }
  let testX = false;
  if (sub.set === CatTriggerState.Waiting) {
    sub.frames += 1;
    if (obj.motion === CAT_TRIGGER_IDLE_MOTION
        && sub.frames > CAT_TRIGGER_CUE_AFTER) {
      ActorSetMotionBlended(obj, CAT_TRIGGER_CUE_MOTION, 0, CAT_TRIGGER_FADE);
    }
    if ((obj.flags & ActorFlag.Hit) !== 0
        && G.g_script_branch_var === 0
        && G.g_evt_block_index === CAT_BRANCH_BLOCK) {
      G.g_script_branch_var = CAT_BRANCH_VALUE;
      ActorSetMotionBlended(obj, CAT_TRIGGER_FLEE_MOTION, 0, CAT_TRIGGER_FADE);
      sub.set = CatTriggerState.Fleeing;
    }
    testX = true;
  } else if (sub.set === CatTriggerState.Fleeing) {
    testX = true;
  }
  if (testX && obj.pos.x < CAT_TRIGGER_STOP_X) {
    sub.set = CatTriggerState.Stopped;
    ActorSetMotionBlended(obj, CAT_TRIGGER_IDLE_MOTION, 0, CAT_TRIGGER_FADE);
  }
  ActorRegisterOriginInViewSpace(obj, host);
}

/**
 * `ActorRegisterOriginInViewSpace` — `FUN_0043F950`. The actor's own
 * position, through `g_camera_world_to_view[g_camera_index]`, into
 * `obj+0x70..0x78`, and then `RegisterForShotTest`.
 *
 * Ghidra's body ends at the `MatrixStackPop`, which it believes does not
 * return, so the pseudocode stops one call short (`L35`). The bytes carry on:
 *
 * ```
 * 0043F9B3  MOV [ESI+0x70],ECX / [ESI+0x74],EDX / [ESI+0x78],EAX
 * 0043F9BC  CALL MatrixStackPop(1)
 * 0043F9C1  PUSH ESI
 * 0043F9C2  CALL 0x00405160                  ; RegisterForShotTest(obj)
 * ```
 *
 * So the trigger is tested as one sphere of `obj+0x124` about its **feet** —
 * not about a bone, and not lifted — and it is the only caller.
 *
 * The port keeps `obj+0x70..0x78` in world space ({@link Actor.shotCentre})
 * and `RegisterForShotTest` takes the depth itself, so the transform is the
 * identity here.
 */
export function ActorRegisterOriginInViewSpace(obj: Actor,
                                                 host: GameHost): void {
  obj.shotCentre.x = obj.pos.x;
  obj.shotCentre.y = obj.pos.y;
  obj.shotCentre.z = obj.pos.z;
  RegisterForShotTest(obj, host);
}

/**
 * [port-only] The engine installs `CatMotionListUpdate` or
 * `CatBranchTriggerUpdate` in `*obj` once, in `CatInit`, and never swaps it;
 * this is that choice written as a test on the sub-type, which is what
 * decided it.
 */
export function CatUpdate(obj: Actor, f: ClassFrame): void {
  if (SubType(obj) < CAT_FIRST_TRIGGER_SUBTYPE) CatMotionListUpdate(obj);
  else CatBranchTriggerUpdate(obj, f.host);
}

function CatDebug(obj: Actor): ActorDebug {
  const sub = Tail(obj);
  const subtype = SubType(obj);
  if (!sub) return { summary: "no class 0x53 tail", hot: true };
  // The summary leads with the clip for a cat that plays its list, and with
  // the state for a trigger: that first word is what `tools/animals.mjs`
  // collects as the states an actor passed through.
  if (subtype < CAT_FIRST_TRIGGER_SUBTYPE) {
    return {
      summary: `0x${obj.motion.toString(16)} · entry ${sub.index} · `
        + `pass ${sub.loops}`,
      detail: [
        `sub-type ${subtype} · set ${sub.set} · a cat, not a trigger`,
        `life ${sub.frames} / ${CAT_LIFE_FRAMES}`,
      ],
    };
  }
  const waiting = sub.set === CatTriggerState.Waiting;
  const live = waiting && G.g_evt_block_index === CAT_BRANCH_BLOCK;
  return {
    summary: `${CatTriggerState[sub.set] ?? `state ${sub.set}`}`
      + (live ? " · shoot for route 2"
        : waiting ? ` · for block ${CAT_BRANCH_BLOCK}` : ""),
    detail: [`g_evt_block_index ${G.g_evt_block_index}`,
             `g_script_branch_var ${G.g_script_branch_var}`],
    hot: live,
  };
}

export const CatHandler: ClassHandler = {
  init: CatInit,
  update: CatUpdate,
  // The class reads `obj+0x34` bit 3 itself and has no hit points.
  ownsShotResult: true,
  // `CatBranchTriggerUpdate` registers itself through
  // `ActorRegisterOriginInViewSpace`, and `CatMotionListUpdate` never does:
  // the cat that plays its list is not in the shot test at all.
  registersForShotTest: true,
  debug: CatDebug,
};

registerClass(SpawnClass.SkinnedNpc, CatHandler);
