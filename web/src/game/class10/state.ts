/**
 * `ActorAllocSub(0xC4)` — the block `CivilianInit` hangs at `obj+0x1310`.
 *
 * Every routine in class 0x10 reads it through the scratch global
 * `g_cur_civilian` (0x007DD0A0), which `CivilianInit` and `CivilianUpdate`
 * both point at the object they are working on. Here it is a field, because a
 * pointer-shaped global that is only ever the current actor is a `this` with
 * extra steps — and a snapshot can carry a field.
 *
 * Offsets are the engine's, so the decompilation and this can be read side by
 * side. The fields the port does not use yet are still named and still carry
 * their offset: an unnamed gap is where the next wrong reading goes.
 */
export interface CivilianState {
  /** +0x00 the wait word op 0x2C loads, `& 0xFBFFFFFF`. See `CivilianWait`. */
  wait: number;
  /**
   * +0x04 bit 0: this civilian has already left `g_civilians_alive`.
   *
   * This is `sub+0x04`, a word of the 0xC4-byte block, and it has **nothing
   * to do with `Actor.flags2` (`obj+0x136C`)** — a different address on a
   * different object. It was called `flags2` here, which is a name a reader
   * of the union will get wrong exactly once. `[proved]`: `CivilianUpdate`
   * (`FUN_0048A920`) and `CivilianLeaveField` test it as
   * `if ((g_cur_civilian[1] & 1) == 0) g_civilians_alive--;`, and
   * `CivilianRunScript` (`FUN_0048B9E0`) op 0x2C sets bit 0 at 0x0048BA3C.
   * Bit 0 is the only bit anything reads.
   */
  subFlags: number;
  /** +0x08 op 2 — stop the clip on this frame instead of the clip's length. */
  frameLimit: number;
  /** +0x0C how many more times the clip may loop. Negative loops for ever. */
  loops: number;
  /**
   * +0x0E, written by op 3 and by `CivilianInit`'s own 10.
   *
   * [open] **Nothing in the civilian's turn reads it.**
   * `CivilianStepTurnToTarget` (`FUN_0048C850`) passes the literal `0x100` to
   * `ActorTurnTowardPoint`, and this port passed this field instead — which
   * made every civilian turn twenty-five times too slowly. What does read it
   * is unread; it is kept because op 3 writes it and the sidebar shows it.
   */
  turnRate: number;
  /** +0x10 / +0x12 op 0x0D — the camera cue wait bit 0x80 tests. */
  cuePath: number;
  cueFrame: number;
  /** +0x14 op 9 — frames left to wait. `-1` waits on the flags alone. */
  timer: number;
  /** +0x16 op 4 — the motion id wait bit 0x200 compares against. */
  motionCompare: number;
  /** +0x18 raised by a frame hook while it is still running; bit 0x400. */
  hookBusy: number;
  /** +0x1A op 0x20 — which `g_script_flags` byte wait bit 0x2000 reads. */
  flagIndex: number;
  /** +0x1C op 0x11 — wait commands to re-apply and skip on the next resume. */
  skipCount: number;
  /** +0x1E how many children `CivilianInit` built, less those that have died. */
  childCount: number;
  /** +0x20 op 0x0B — wait bit 0x04 unblocks once `childCount` drops below it. */
  childrenGoal: number;
  /** +0x22 op 0x0A — the same for `g_enemies_present` / `g_enemies_alive`. */
  enemiesGoal: number;
  /** +0x24 op 0x0C — the same for `g_civilians_alive`. */
  civiliansGoal: number;
  /** +0x26 / +0x28 the descriptor's removal cue: camera path and frame. */
  removePath: number;
  removeFrame: number;
  /** +0x2A frames left before the actor leaves, once the cue has been met. */
  removeDelay: number;
  /**
   * +0x2C / +0x2E — **the order this civilian gives its captors**, from op
   * 0x1A. `ZombieStateAwaitCivilianOrder` (`FUN_0045BAD0`) counts the frames
   * down and takes the state id; `0x31` means die. This is the civilian's
   * script driving the zombies that are holding it, and it is the reverse
   * direction of the `Free` bit they raise on arrival.
   */
  childOrder: number;
  childOrderFrames: number;
  /**
   * +0x64 — the one captor currently pouncing, by spawn address, or 0.
   * `ZombieStatePounceOnTarget` claims it so a civilian held by three is
   * mauled by one at a time, and `CivilianPruneDeadChildren` clears it when
   * that one dies.
   */
  pouncer: number;
  /** +0x30..+0x38 the point the actor turns toward and walks at. */
  target: { x: number; y: number; z: number };
  /** +0x3C op 5's arrival radius; wait bit 0x10 unblocks inside it. */
  radius: number;
  /**
   * +0x40 what `target` means. `0` none, `>0` a fixed point, `-1` the camera,
   * `-2` the actor's own position mirrored through the camera.
   */
  targetMode: number;
  /** +0x48 the command this script is suspended on — always a `Wait`. */
  cursor: number;
  /** +0x4C / +0x50 op 0x0E / 0x0F — the script a shot switches to. */
  onShot: number;
  onShotAlt: number;
  /** +0x54 ops 0x1E / 0x1F — a script to resume into instead of the cursor. */
  resume: number;
  /** +0x58 op 0x22's remaining `(id, delay)` pairs. */
  sounds: [number, number][];
  /** +0x5C op 0x10's per-frame hook — see {@link CivilianHook}. */
  hook: number;
  /** +0x60 the actors `CivilianInit` built, by spawn address. */
  children: number[];
  /** +0x68 the object this civilian rides, when it has one. */
  carrier: number;
  /** +0x6C who gets the +400, or `-1` for both. From the child that died. */
  rescuePlayer: number;
  /**
   * +0x70 the held-item array, and +0x6E its length. Indices into
   * `T.civilians.items`; ops 0x13 and 0x14 append and the draw walks them.
   */
  items: number[];
  /** +0x74 what op 0x15 last picked, for op 0x14 to append. */
  pickedItem: number;
  /**
   * +0x82 which of a record's six attach sets this character uses.
   * `CivilianInit` picks it from the character type.
   */
  attachSet: number;
  /** +0x78 / +0x7C op 0x16 — the radius ramp `PoseHookGrowAndPushOutOfWorld` runs. */
  scaleTarget: number;
  scaleStep: number;
  /**
   * +0x80 op 0x17 — which point `CivilianUpdate`'s switch writes into
   * `obj+0x12C`, the collision-sphere centre — `Actor.sphereCentre`. It is not
   * what `ActorRegisterCameraPoint` (`FUN_00409B70`) registers: that is
   * `obj+0x100`, which the skeleton walk writes.
   */
  cameraPointMode: number;
  /** +0x81 op 0x2A — which death voice, or `0xFF` to pick by character type. */
  deathVoice: number;
  /** +0x84 / +0x88 the sound queued to play, and the frames left before it. */
  soundId: number;
  soundDelay: number;
  /** +0xAC op 0x28 — the bone the camera point rides. */
  cameraBone: number;
  /** +0xAE / +0xB0..+0xB8 op 0x26's move: frames left, and where to. */
  moveFrames: number;
  moveTo: { x: number; y: number; z: number };
  /**
   * Not the engine's. `CivilianRunScript` is entered with a **pointer**; the
   * port carries the index of the stream it is in, because the exported
   * scripts are a list and an index is the same edge without the address.
   */
  script: number;
  /** Where in that stream the cursor sits. */
  pc: number;
  /** The script `onShot` / `resume` name, as an index. Same reason. */
  onShotScript: number;
  onShotAltScript: number;
  resumeScript: number;
}

/** A fresh sub-block, with `CivilianInit`'s own initial values. */
export function makeCivilianState(): CivilianState {
  return {
    wait: 0, subFlags: 0, frameLimit: 0, loops: 0,
    turnRate: 10, cuePath: 0, cueFrame: 0, timer: -1, motionCompare: 0,
    hookBusy: 0, flagIndex: 0, skipCount: 0, childCount: 0, childrenGoal: 0,
    enemiesGoal: 0, civiliansGoal: 0, removePath: 0, removeFrame: 0,
    removeDelay: 0, childOrder: 0, childOrderFrames: 0, pouncer: 0,
    target: { x: 0, y: 0, z: 0 }, radius: 0, targetMode: 0,
    cursor: 0, onShot: 0, onShotAlt: 0, resume: 0, sounds: [],
    hook: 0, children: [], carrier: 0, rescuePlayer: -1,
    items: [], pickedItem: -1, attachSet: 5,
    scaleTarget: 1, scaleStep: 0, cameraPointMode: 2, deathVoice: 0xff,
    soundId: 0, soundDelay: 0, cameraBone: 2,
    moveFrames: 0, moveTo: { x: 0, y: 0, z: 0 },
    script: -1, pc: 0, onShotScript: -1, onShotAltScript: -1,
    resumeScript: -1,
  };
}
