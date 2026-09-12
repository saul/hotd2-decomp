/**
 * One spawn, decoded: where it stands and what its descriptor tail says.
 * The port of `tools/hod2lib/placement.py`.
 *
 * A spawn descriptor is 0x18 bytes of tail whose meaning belongs to the
 * **state the spawn starts in**, not to the class -- every one of the tables
 * here reads the same bytes as something else, which is why each is gated on
 * its own initial state. {@link Placement} is what comes out.
 */

import { i16 } from "./bytes";
import type { EvtFile, Spawn } from "./evt";
import type { TargetScript } from "./actorscript";

/**
 * Where a class's `Init` reads its **attachment list** pointer from, inside
 * the descriptor tail.
 *
 * The list is an `s16[]` of ids into `g_actor_attachment_records`, terminated
 * by a negative. `ActorBindPartList` (`FUN_00412440`) binds it and
 * `ActorDrawAttachedParts` (`FUN_004124F0`) draws it, and both are shared --
 * but **where the pointer lives is not**, which is L3 in its usual form:
 *
 * * `CivilianInit` (`FUN_0048A3E0`) reads `tail+0x08`;
 * * `ScriptedHumanoidInit` (`FUN_004840D0`) reads `tail+0x08`;
 * * `SetPiecePropInit` (`FUN_00482CE0`) reads `tail+0x00`.
 *
 * Three more callers of `ActorBindPartList` -- `FUN_004613C0`, `FUN_004617F0`
 * and `FUN_0049A760` -- are unread, so their classes are `[open]` and are not
 * listed here. Reading the wrong offset for a class does not fail loudly: the
 * bytes are some other field and the ids that come out are plausible, so this
 * is deliberately a table of the three Inits that have been read rather than
 * a default.
 */
export const ATTACHMENT_TAIL_OFFSET: Record<number, number> = {
  0x10: 0x08, 0x24: 0x00, 0x25: 0x08,
};

/** Ids are indices into an 81-row table; nothing longer than this appears. */
const ATTACHMENT_LIST_MAX = 32;

/**
 * One spawn's attachment list, as record ids.
 *
 * Empty for a class whose `Init` has not been read, for a tail whose pointer
 * is not a pointer, and for a list carrying an id outside the record table --
 * an out-of-range id means the bytes are not a list, and half a list is worse
 * than none.
 */
export function attachmentList(evt: EvtFile, rec: Spawn, cls: number,
                               recordCount: number): number[] {
  const at = ATTACHMENT_TAIL_OFFSET[cls];
  if (at === undefined || !rec.hasParams) return [];
  const w = rec.param(at, "u32");
  if (w === null) return [];
  const off = evt.toOffset(w);
  if (off === null || off < 0 || off + 2 > evt.raw.length) return [];
  const out: number[] = [];
  for (let o = off; o + 2 <= evt.raw.length; o += 2) {
    const v = i16(evt.raw, o);
    if (v < 0) return out;
    if (v >= recordCount || out.length >= ATTACHMENT_LIST_MAX) return [];
    out.push(v);
  }
  return [];
}

/**
 * Which state index means "ride a ballistic arc to a named point", per class.
 * `ThrowerStateLeapToPoint` and `ZombieStateLeapToPoint` are the two read.
 */
export const LEAP_STATES: Record<number, number[]> = { 0x30: [24], 0x31: [20] };

/** Which state means "follow a list of waypoints" -- `ThrowerStatePathFollow`. */
export const PATH_STATES: Record<number, number[]> = { 0x31: [26] };

/**
 * `ThrowerStateWalkDistance` (class 0x31 state 18) and
 * `ZombieStateWalkDistance` (class 0x30 state 15) both walk until the 2D
 * distance from where they started reaches the **float** at descriptor tail
 * `+0x04`.
 *
 * Class 0x30 was missing here, and it is the commonest scripted entrance in
 * the game after the attack run: fifty spawns, every one of them an exact
 * integer between 3 and 30. Without the field the port had nothing to walk and
 * sent all fifty straight at the camera from their first frame.
 */
export const WALK_DISTANCE_STATES: Record<number, number[]> =
  { 0x30: [15], 0x31: [18] };

/** `ThrowerStateEntranceClip` (class 0x31 state 19) plays tail `+0x04` once. */
export const ENTRANCE_CLIP_STATES: Record<number, number[]> = { 0x31: [19] };

/**
 * `ThrowerStateWaitForCue` (class 0x31 state 28) plays the motion at tail
 * `+0x04` from a random frame and waits on the condition the s16 at `+0x08`
 * selects -- 0 a frame count, 1 the camera path frame, 2 a script flag --
 * against the operand at `+0x0A`, then jumps to the state at `+0x03`.
 */
export const CUE_STATES: Record<number, number[]> = { 0x31: [28] };

/**
 * `ThrowerStateLeapStrike` (class 0x31 state 22) arcs to the landing point
 * over the s32 frame count at tail `+0x04`. **No shipped spawn starts in it
 * and no state can reach it**; it is exported for completeness.
 */
export const LEAP_STRIKE_STATES: Record<number, number[]> = { 0x31: [22] };

/**
 * `ThrowerStateGrabPlayer` (class 0x31 state 27) rides a **camera-relative**
 * offset. Its tail is 0x18 bytes: `f32 dx, dy, dz` at `+0x04`, the camera path
 * frame it waits for at `+0x10`, the frames it takes to drop at `+0x12`, the
 * frames it holds the grab for at `+0x14`, and the player it grabs at `+0x16`
 * -- `-1` meaning either.
 */
export const GRAB_STATES: Record<number, number[]> = { 0x31: [27] };

/**
 * `ThrowerStateBlinkInThreeHops` (class 0x31 state 34) holds its stance's idle
 * for the frame count at tail `+0x04` and then jumps to the state named by the
 * signed byte at tail `+0x03`.
 */
export const BACK_AWAY_STATES: Record<number, number[]> = { 0x31: [34] };

/**
 * `ThrowerStateDelayedPounce` (class 0x31 state 23) plays the motion at tail
 * `+0x04` for the frame count at `+0x08`, then leaps at the camera over that
 * same count. The int at `+0x0C` is in the record and is `[open]`.
 */
export const POUNCE_STATES: Record<number, number[]> = { 0x31: [23] };

/**
 * The twelve class-0x30 entrance states that read a tail of their own -- 133
 * of the game's 356 class-0x30 spawns, against the 17 states the port already
 * read. Each is gated on its own initial state because every one of them reads
 * the same bytes as something else.
 *
 * `ZombieStateRideCarrier` (29) is deliberately absent: it reads **nothing**
 * from the tail but byte 3, and the tail it sits on belongs to the state it
 * hands over to.
 */
export const ENTRY_TAIL_STATES: Record<number, string> = {
  /** `ZombieStateSurfaceOnCameraCue`: camera frame `+0x04`, walk `+0x08`. */
  13: "surface_cue",
  /** `ZombieStateRunInPlaceTimed`: frames at `+0x04`. */
  14: "run_in_place",
  /** `ZombieStateHoldClipThenBranch`: motion `+0x04`, frames `+0x08`. */
  17: "hold_clip",
  /** `ZombieStateWaitCameraFrameThenBranch`: motion `+0x04`, frame `+0x08`. */
  18: "wait_cam_frame",
  /** `ZombieStateWaitForCameraFrame`: motion `+0x04`, s16 frame `+0x08`. */
  19: "wait_cam_strike",
  /** `ZombieStateWaitScriptFlagThenBranch`: motion `+0x04`, flag `+0x08`. */
  20: "wait_flag",
  /** `ZombieStateScriptedGrabAndDespawn`: cue `+0x04`, motion `+0x08`. */
  23: "grab_kill",
  /** `ZombieStateLeapToPoint`: dest `+0x04`, s16 frames `+0x10`. */
  24: "leap_strike",
  /** `ZombieStateArcScriptedEntrance`: dest `+0x04`, arc frames `+0x10`. */
  30: "arc_entrance",
  /** `ZombieStateWaitScriptFlagThenEnter`: u8 flag `+0x04`. */
  31: "flag_enter",
  /** `ZombieStateDelayedStrikeInPlace`: s16 delay `+0x04`. */
  32: "delayed_strike",
};

/**
 * The tail one of {@link ENTRY_TAIL_STATES} reads, or null.
 *
 * Every field is bounds-checked, because for any state but its own these bytes
 * are the *next* descriptor: a motion id has to be a plausible id, a frame
 * count has to be a plausible count. A field that fails is dropped rather than
 * guessed, and the port's state falls back to its own default.
 */
export function entryTail(rec: Spawn, state: number,
                          exitState: number): Record<string, unknown> | null {
  const i32 = (off: number) => rec.param(off, "i32");

  const motion = (off: number): number | null => {
    const m = rec.param(off, "i32");
    return m !== null && m > 0 && m < 4096 ? m : null;
  };

  const frames = (off: number, lim = 100000): number | null => {
    const n = rec.param(off, "i32");
    return n !== null && n >= 0 && n < lim ? n : null;
  };

  const dist = (off: number): number | null => {
    // Read as an *integer* and converted, which is what the two arms that hand
    // to state 15 do -- `(float)*(uint *)(tail + n)`, an FILD. The float
    // reading of the same bytes would be a denormal.
    const d = rec.param(off, "u32");
    return d !== null && d > 0 && d < 4096 ? d : null;
  };

  const kind = ENTRY_TAIL_STATES[state];
  if (kind === undefined) return null;
  if (kind === "surface_cue") {
    const t: Record<string, unknown> = { cue_frame: frames(0x04) || 0 };
    if (exitState === 15) {
      const d = dist(0x08);
      if (d !== null) t.walk_distance = d;
    }
    return t;
  }
  if (kind === "run_in_place") {
    const n = frames(0x04, 3600);
    return n ? { frames: n } : null;
  }
  if (kind === "hold_clip") {
    const m = motion(0x04);
    const n = frames(0x08, 3600);
    if (m === null || n === null) return null;
    const t: Record<string, unknown> = { motion: m, frames: n };
    if (exitState === 15) {
      const d = dist(0x0c);
      if (d !== null) t.walk_distance = d;
    }
    return t;
  }
  if (kind === "wait_cam_frame" || kind === "wait_flag") {
    const m = motion(0x04);
    const n = i32(0x08);
    if (m === null || n === null || !(n >= 0 && n < 100000)) return null;
    return { motion: m, cue: n };
  }
  if (kind === "wait_cam_strike") {
    const m = motion(0x04);
    const f = rec.param(0x08, "i16");
    if (m === null || f === null) return null;
    return { motion: m, cue_frame: f,
             freeze: (rec.param(0x0c, "i8") || 0) === 0,
             claim: (rec.param(0x0d, "i8") || 0) !== 0,
             delay: rec.param(0x0e, "i16") || 0,
             cooldown: rec.param(0x10, "i16") || 0 };
  }
  if (kind === "grab_kill") {
    const cue = i32(0x04);
    const m = motion(0x08);
    const hit = frames(0x0c, 3600);
    if (m === null || hit === null || cue === null) return null;
    return { cue_frame: cue, motion: m, hit_frame: hit };
  }
  if (kind === "leap_strike") {
    const dest = [0, 1, 2].map((k) => rec.param(0x04 + 4 * k, "f32"));
    const n = rec.param(0x10, "i16");
    const idle = motion(0x14);
    const strike = motion(0x18);
    const hit = rec.param(0x1c, "u16");
    if (!dest.every((v) => v !== null && Number.isFinite(v))
        || !n || n <= 0 || idle === null || strike === null || hit === null) {
      return null;
    }
    return { dest, frames: n, delay: rec.param(0x12, "i16") || 0,
             idle_motion: idle, strike_motion: strike, hit_frame: hit,
             player: rec.param(0x1e, "i8") || 0 };
  }
  if (kind === "arc_entrance") {
    const dest = [0, 1, 2].map((k) => rec.param(0x04 + 4 * k, "f32"));
    const n = rec.param(0x10, "i32");
    const step = rec.param(0x14, "i32");
    if (!dest.every((v) => v !== null && Number.isFinite(v))
        || !n || n <= 0 || !step || step <= 0) {
      return null;
    }
    return { dest, frames: n, step, delay: frames(0x18, 3600) || 0 };
  }
  if (kind === "flag_enter") {
    const idle = motion(0x08);
    const m = motion(0x10);
    const flag = rec.param(0x04, "u8");
    if (idle === null || m === null || flag === null) return null;
    return { flag, idle_motion: idle, motion: m,
             delay: frames(0x0c, 3600) || 0 };
  }
  if (kind === "delayed_strike") {
    return { delay: rec.param(0x04, "i16") || 0,
             rearm: rec.param(0x06, "i16") || 0,
             player: rec.param(0x08, "i8") || 0 };
  }
  return null;
}

/**
 * A waypoint: `{s16 step, s16 script, f32 x, f32 y, f32 z}`, sixteen bytes,
 * and the list is terminated by a step of -1.
 *
 * *step* is the arc's parameter-advance rate: `ActorArcBeginTo` sets the
 * duration to `dist2d * step` rounded down to a multiple of *step*. It is
 * **not** the arc kind.
 *
 * *script* selects the leg's three-stage arc motion script for every character
 * type but 0x17.
 */
export const WAYPOINT_BYTES = 0x10;

/** The `spawn` dict a `Placement` carries, as the script walker builds it. */
export interface SpawnJson {
  orient: number[];
  civilian_child?: unknown;
  desc_flags?: number;
  [k: string]: unknown;
}

/** One spawn descriptor resolved to a character and a motion. */
export class Placement {
  /** evt file offset, the descriptor's identity. */
  at = 0;
  cls = 0;
  char_type = 0;
  motion: number | null = null;
  /** The script's own spawn dict. */
  spawn: SpawnJson = { orient: [0, 0, 0] };
  /** A scripted entrance played once before the loop: `[motion, delay]`. */
  intro: [number, number] | null = null;
  /**
   * The class-0x30 descriptor tail, from `EnemyZombieInit` and
   * `ZombieStateApproach`: `{i8 char_type; i8 body_condition; i8
   * initial_state; i8 attack_state}`. State 22 is the approach and state 0 is
   * the no-op, so an attack state of 0 means this actor never attacks.
   */
  body_condition = 0;
  initial_state = 0;
  attack_state = 0;
  /** `obj+0x131F` -- which ring set this actor measures against. */
  ring_set = 0;
  /**
   * The ballistic arc a spawn placed in the air rides to the ground. Only the
   * two leap states read those bytes, so it is emitted only for them; for any
   * other state the same bytes mean something else.
   */
  leap: Record<string, unknown> | null = null;
  /** The waypoint path a `ThrowerStatePathFollow` spawn walks. */
  path: Record<string, unknown> | null = null;
  /** `ThrowerStateWalkDistance`'s target distance. */
  walk_distance: number | null = null;
  /** `ThrowerStateEntranceClip`'s one-shot motion. */
  entrance_motion: number | null = null;
  /** `ThrowerStateDelayedPounce`'s `{motion, frames}`. */
  pounce: Record<string, unknown> | null = null;
  /** `ThrowerStateGrabPlayer`'s offset and timing. */
  grab: Record<string, unknown> | null = null;
  /** `ThrowerStateBlinkInThreeHops`' hold, in frames. */
  back_away_delay: number | null = null;
  /** `ThrowerStateWaitForCue`'s `{motion, cond, operand}`. */
  cue: Record<string, unknown> | null = null;
  /** `ThrowerStateLeapStrike`'s arc duration. */
  leap_strike_frames: number | null = null;
  /** `ZombieStateStandAndThrow`'s tail. */
  stand_throw: Record<string, unknown> | null = null;
  /**
   * The spawn record's own flags word, which `ActorInitFlags` makes the
   * actor's `obj+0x34`. Bit 17 skips the per-frame ground snap, bit 27 picks
   * the run variant, bit 15 takes the actor out of the shot test. Carried
   * whole rather than bit by bit, because that is what the engine does.
   */
  init_flags = 0;
  /** `ZombieStateEmerge`'s (state 27) `{delay, motion}`. */
  emerge: Record<string, unknown> | null = null;
  /** `ZombieStateDelayedLeap`'s (state 26) `{delay, dest, gravity}`. */
  delayed_leap: Record<string, unknown> | null = null;
  /**
   * The two captor scripts, decoded. `target` is the tail's `+0x04` blob read
   * for the initial state, `attack` the `+0x08` blob read for the attack state.
   */
  target_script: TargetScript | null = null;
  attack_script: TargetScript | null = null;
  /** The captor family's camera cue, `{path, frame}` from `+0x0C`/`+0x0E`. */
  camera_cue: Record<string, unknown> | null = null;
  /** The tail one of the twelve {@link ENTRY_TAIL_STATES} reads. */
  entry: Record<string, unknown> | null = null;
  /**
   * Class 0x20's whole descriptor tail. **Its own block and not the shared
   * fields**, because class 0x20 reads those same bytes as something else.
   */
  class20: Record<string, unknown> | null = null;
  /** Class 0x11's tail -- the frog's cue, wedge and command list. */
  class11: Record<string, unknown> | null = null;
  /** Class 0x43's two bytes -- the owl's member index and sub-type. */
  class43: Record<string, unknown> | null = null;
  class46: Record<string, unknown> | null = null;
  /**
   * The placement this one rides, when it is not a descriptor of its own.
   *
   * `[port-only]`, and the bundle's one **synthetic** row: `SpawnBatWings`
   * (`FUN_0042E060`) builds a bat's wings as a second actor with no spawn
   * record at all, and the client binds geometry to a placement by address —
   * so a child actor that is drawn needs a row. It is not spawned from: see
   * {@link Placement.synthetic}.
   */
  parent_at: number | null = null;
  /**
   * This row is **not** an evt descriptor.
   *
   * Nothing in the script places it and `SpawnScriptedCharacters` refuses to
   * build one: the object is made by the class that owns it, exactly where the
   * engine makes it. The row carries geometry and an address to adopt it by,
   * and saying so in the bundle is what stops a reader treating the count of
   * placements as the count of descriptors.
   */
  synthetic = false;
  /**
   * Class 0x51's tail -- the fish's speeds, bob and timings, **or** the water
   * level, when `subtype` is 6 and the record is a group header.
   */
  class51: Record<string, unknown> | null = null;
  /** Class 0x52's tail -- `{subtype}`. */
  class52: Record<string, unknown> | null = null;
  /** Class 0x53's tail -- `{anim_set, subtype}`. */
  class53: Record<string, unknown> | null = null;
  /** Class 0x14's tail -- the stage-2 boss's state, route quad and cue. */
  class14: Record<string, unknown> | null = null;
  /**
   * Class 0x33 **selector 1's** tail -- the draw slot, the `op_` path it
   * rides, and the four cues that raise its two `obj+0x34` bits and take it
   * off the field. Selector 1 only: the other ten sub-handlers read the same
   * bytes as something else.
   */
  class33: Record<string, unknown> | null = null;
  /**
   * Class 0x33 **selector 4's** tail -- the draw slot, the sphere, and the two
   * script flags that arm the push and take the object off the field.
   *
   * Selector 4 only, and never set on the same placement as {@link class33}:
   * they are two sub-handlers' readings of the same bytes, and the port takes
   * which key is present as the selector.
   */
  class33_push: Record<string, unknown> | null = null;
  /**
   * The spawn's attachment list -- `obj+0x1170`, ids into
   * `g_actor_attachment_records`.
   *
   * Faces below `0x24`, accessories at or above it. This is where a
   * civilian's hair comes from: without it a civilian's head is the shell the
   * skeleton names, which is open at the back.
   */
  attachments: number[] = [];
  /** The descriptor's `+0x22`, **before** difficulty scaling. */
  hp = 0;

  toJson(): Record<string, unknown> {
    const d: Record<string, unknown> = {
      at: this.at, class: this.cls, char_type: this.char_type,
      motion: this.motion, hp: this.hp,
      body_condition: this.body_condition,
      initial_state: this.initial_state,
      attack_state: this.attack_state,
      ring_set: this.ring_set,
      // The actor's own yaw, which the directional death compares the
      // camera's against.
      yaw: this.spawn.orient[1] & 0xffff,
    };
    // A class-0x10 child: present exactly when the civilian that built it is,
    // because nothing in the script ever places it.
    if (this.spawn.civilian_child !== undefined
        && this.spawn.civilian_child !== null) {
      d.civilian_child = this.spawn.civilian_child;
    }
    if (this.emerge) d.emerge = this.emerge;
    if (this.delayed_leap) d.delayed_leap = this.delayed_leap;
    if (this.entry) d.entry = this.entry;
    if (this.target_script) d.target_script = this.target_script;
    if (this.attack_script) d.attack_script = this.attack_script;
    if (this.camera_cue) d.camera_cue = this.camera_cue;
    if (this.leap) d.leap = this.leap;
    if (this.path) d.path = this.path;
    if (this.walk_distance !== null) d.walk_distance = this.walk_distance;
    if (this.stand_throw !== null) d.stand_throw = this.stand_throw;
    if (this.init_flags) d.init_flags = this.init_flags;
    // The descriptor's own `+0x20` word, which `SpawnFromDescriptor` copies to
    // `obj+0x1316` and both `EnemyThrowerInit` and `EnemyZombieInit` make the
    // low half of `obj+0x136C`. Read off the spawn dict rather than carried as
    // a field of its own, the same way `yaw` and `civilian_child` are.
    if (this.spawn.desc_flags) d.desc_flags = this.spawn.desc_flags;
    if (this.entrance_motion !== null) d.entrance_motion = this.entrance_motion;
    if (this.pounce) d.pounce = this.pounce;
    if (this.grab) d.grab = this.grab;
    if (this.back_away_delay !== null) {
      d.back_away_delay = this.back_away_delay;
    }
    if (this.cue) d.cue = this.cue;
    if (this.leap_strike_frames !== null) {
      d.leap_strike_frames = this.leap_strike_frames;
    }
    if (this.intro) d.intro = { motion: this.intro[0], delay: this.intro[1] };
    if (this.class20) d.class20 = this.class20;
    if (this.class11) d.class11 = this.class11;
    if (this.class43) d.class43 = this.class43;
    if (this.class46) d.class46 = this.class46;
    if (this.parent_at !== null) d.parent_at = this.parent_at;
    if (this.synthetic) d.synthetic = true;
    if (this.class51) d.class51 = this.class51;
    if (this.class52) d.class52 = this.class52;
    if (this.class53) d.class53 = this.class53;
    if (this.class14) d.class14 = this.class14;
    if (this.class33) d.class33 = this.class33;
    if (this.class33_push) d.class33_push = this.class33_push;
    if (this.attachments.length) d.attachments = [...this.attachments];
    return d;
  }
}
