/**
 * How a class-0x10 civilian's life ends, as a **replay** has to reproduce it.
 *
 * [port-only] The engine never asks any of this: its civilians run their own
 * scripts and leave by themselves. A seek replays the evt with every wait
 * stepped over and no actor running, so a civilian spawned before the landing
 * address is still in the walker's spawn list there, and gets rebuilt at her
 * **first** command -- with her captors, her camera slot and her rescue all
 * still ahead of her, a state the exe is never in once the room she was
 * spawned in has been played. The user files every bug as a deep link, so
 * that is the address lying.
 *
 * The exe's own ways out, read at the tail of `CivilianUpdate`
 * (`FUN_0048A920`, `0x0048AF8E..0x0048B0C8`), and what a replay can see of
 * each:
 *
 * | arm | the exe | the replay's evidence |
 * |---|---|---|
 * | cue | `g_active_cam_path == sub+0x26 && g_cam_path_frame == sub+0x28` arms `sub+0x2A = tail+0x06`; at zero, with no children left, the despawn | the camera the replay runs plays that path past that frame -- exact |
 * | off camera | the wait word carries `0x2000000`, `ActorBoundsOnScreen` (`FUN_0045CA60`) says no, `g_scene_state_major_entered != 2`, no children: the despawn at once | `goto_scene_state` (major 1) after her room's gate -- see below |
 * | skip | `g_cutscene_skipping` and not wait bit `0x20000000`: `sub+0x2A = 1` | none -- a replay skips nothing |
 * | flag | not a removal: her `SetScriptFlag` (op 0x1C) | the `wait_script_flag` stepped over, `Walker.retireFlagRaisers` |
 *
 * "Her room's gate" is the first room-clear gate the replay steps over after
 * her spawn: `wait_enemies_alive`/`_present` (her captors are class 0x30 and
 * counted, so they are dead), `wait_scripted_actors` (she has left the
 * count), `wait_targets_clear` (nothing is tracked, so her tracked blocks are
 * behind her -- bug 18). A civilian with no children has none to wait for.
 *
 * The off-camera arm is the one a replay cannot evaluate exactly, because it
 * has no camera pose and no actor position. What it can say is **when the
 * exe first could**: every room-clear gate in the shipped scripts is followed
 * by `goto_scene_state`, which is `EvtOpGotoSceneState31` setting
 * `g_scene_state_major_entered` to 1, and a civilian whose every stream ends
 * on a `0x2000000` word is removed on the first frame of that spell she is off
 * screen. `[likely]` that she is -- the camera the gate held for her hands
 * back to the rail and the script moves on to the next room. A deep link that
 * lands in the seconds between is the one place this can be early.
 */
import type { CiviliansJson } from "../bundle";

/** `CivilianWait.RemoveOffCamera` -- the word bit the off-camera arm reads. */
const WAIT_REMOVE_OFF_CAMERA = 0x02000000;
/** `CivilianOp.Wait` and the two resume ops, by number: `script/` sits below
 * `game/class10` in nothing, but the class's enum is a module with behaviour
 * behind it, and this reads the bundle's data rather than running it. */
const OP_WAIT = 0x2c;
const OP_SET_RESUME = 0x1e;
const OP_SET_RESUME_BY_MODE = 0x1f;

/**
 * Whether the stream the civilian at `at` **finishes a rescue in** ends on a
 * wait word carrying `0x2000000` -- i.e. whether the off-camera arm can take
 * her once her room is played.
 *
 * The rescue path is the entry stream and whatever op 0x1E/0x1F hands it to
 * (the first of 0x1F's two, as `CivilianRunScript` takes it in a one-player
 * game); the on-shot streams op 0x0E/0x0F install are not followed. `[likely]`
 * that is the right assumption for a replay: it does not know how the room was
 * played, and rescuing her is the outcome the script is written for -- the
 * other costs a life. A shot civilian's streams end on `0x80000` or
 * `0x2080000`, so where it matters she is still retired by her cue.
 */
export function CivilianEndsRemovable(civ: CiviliansJson | undefined,
                                      at: number): boolean {
  const sp = civ?.spawns?.[String(at)];
  if (!civ || !sp) return false;
  const seen = new Set<number>();
  let id = civ.entries?.[sp.script] ?? -1;
  while (id >= 0 && !seen.has(id)) {
    seen.add(id);
    const stream = civ.scripts?.[id];
    if (!stream) return false;
    let last: number | null = null;
    let next = -1;
    for (const c of stream) {
      if (c.op === OP_WAIT) last = c.args[0] ?? 0;
      if (c.op === OP_SET_RESUME || c.op === OP_SET_RESUME_BY_MODE) {
        next = c.scripts?.[0] ?? -1;
      }
    }
    if (next < 0) return last !== null && (last & WAIT_REMOVE_OFF_CAMERA) !== 0;
    id = next;
  }
  return false;
}

/** The descriptor tail's removal cue, or null when `+0x26` is -1. */
export function CivilianRemoveCue(civ: CiviliansJson | undefined, at: number):
    { path: number; frame: number } | null {
  const sp = civ?.spawns?.[String(at)];
  if (!sp || sp.removePath < 0) return null;
  return { path: sp.removePath, frame: sp.removeFrame };
}

/** Whether `CivilianInit` builds children for this spawn at all. */
export function CivilianHasChildren(civ: CiviliansJson | undefined,
                                    at: number): boolean {
  return (civ?.spawns?.[String(at)]?.children.length ?? 0) > 0;
}

/**
 * One listed civilian's progress through a replay. Only ever filled while
 * `Walker.replaying`; a seek is one call, so none of it is saved.
 */
export interface CivilianLife {
  /** Her room's gate has been stepped over -- see the file header. */
  roomCleared: boolean;
  /** The replay's camera has played her removal cue. */
  cueSeen: boolean;
}
