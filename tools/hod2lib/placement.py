"""One spawn, decoded: where it stands and what its descriptor tail says.

A spawn descriptor is 0x18 bytes of tail whose meaning belongs to the **state
the spawn starts in**, not to the class -- every one of the tables here reads
the same bytes as something else, which is why each is gated on its own
initial state. :class:`Placement` is what comes out.
"""

from __future__ import annotations

import math
from dataclasses import dataclass


#: Which state index means "ride a ballistic arc to a named point", per class.
#: `ThrowerStateLeapToPoint` and `ZombieStateLeapToPoint` are the two read.
LEAP_STATES = {0x30: (24,), 0x31: (20,)}

#: Which state index means "follow a list of waypoints" -- `ThrowerStatePathFollow`.
PATH_STATES = {0x31: (26,)}

#: `ThrowerStateWalkDistance` (class 0x31 state 18) and
#: `ZombieStateWalkDistance` (class 0x30 state 15) both walk until the 2D
#: distance from where they started reaches the **float** at descriptor tail
#: ``+0x04``.
#:
#: Class 0x30 was missing here, and it is the commonest scripted entrance in
#: the game after the attack run: fifty spawns, every one of them an exact
#: integer between 3 and 30 -- which is what ``verify_walk_distance.py``
#: checks. Without the field the port had nothing to walk and sent all fifty
#: straight at the camera from their first frame.
WALK_DISTANCE_STATES = {0x30: (15,), 0x31: (18,)}

#: `ThrowerStateEntranceClip` (class 0x31 state 19) plays the motion named by
#: the int at descriptor tail ``+0x04`` once and then stands.
ENTRANCE_CLIP_STATES = {0x31: (19,)}

#: `ThrowerStateWaitForCue` (class 0x31 state 28) plays the motion at tail
#: ``+0x04`` from a random frame and waits on the condition the s16 at ``+0x08``
#: selects -- 0 a frame count, 1 the camera path frame, 2 a script flag --
#: against the operand at ``+0x0A``, then jumps to the state at ``+0x03``. Six
#: shipped spawns, all in ``trnevtbl.bin``.
CUE_STATES = {0x31: (28,)}

#: `ThrowerStateLeapStrike` (class 0x31 state 22) arcs to the landing point over
#: the s32 frame count at tail ``+0x04``. **No shipped spawn starts in it and no
#: state can reach it**; it is exported for completeness, not for use.
LEAP_STRIKE_STATES = {0x31: (22,)}

#: `ThrowerStateGrabPlayer` (class 0x31 state 27) rides a **camera-relative**
#: offset. Its tail is 0x18 bytes: `f32 dx, dy, dz` at ``+0x04``, the camera
#: path frame it waits for at ``+0x10``, the frames it takes to drop at
#: ``+0x12``, the frames it holds the grab for at ``+0x14``, and the player it
#: grabs at ``+0x16`` -- `-1` meaning either. Stage 5 spawns four, all
#: character type 0x18, all naming the offset (0, 0, -10).
GRAB_STATES = {0x31: (27,)}

#: `ThrowerStateBlinkInThreeHops` (class 0x31 state 34) holds its stance's
#: idle for the frame count at tail ``+0x04`` and then jumps to the state named
#: by the signed byte at tail ``+0x03``, which `Placement.attack_state` already
#: carries. Stage 6 spawns eight, all character 0x18, all naming state 7.
BACK_AWAY_STATES = {0x31: (34,)}

#: `ThrowerStateDelayedPounce` (class 0x31 state 23) plays the motion at tail
#: ``+0x04`` for the frame count at ``+0x08``, then leaps at the camera over
#: that same count. The int at ``+0x0C`` is in the record and is `[open]` --
#: the state does not read it.
POUNCE_STATES = {0x31: (23,)}

#: The twelve class-0x30 entrance states that read a tail of their own and had
#: no decoding here at all -- 133 of the game's 356 class-0x30 spawns, against
#: the 17 states the port already read. Each is gated on its own initial state
#: because every one of them reads the same bytes as something else.
#:
#: `ZombieStateRideCarrier` (29) is deliberately absent: it reads **nothing**
#: from the tail but byte 3, and the tail it sits on belongs to the state it
#: hands over to. All six shipped spawns prove it -- the three whose byte 3 is
#: 26 carry a `ZombieStateDelayedLeap` tail and the three whose byte 3 is 30
#: carry a `ZombieStateArcScriptedEntrance` one, each already decoded by the
#: rule for that state.
ENTRY_TAIL_STATES = {
    #: `ZombieStateSurfaceOnCameraCue`: the camera frame at ``+0x04``, and a
    #: walk distance at ``+0x08`` read only when ``+0x03`` is 15.
    13: "surface_cue",
    #: `ZombieStateRunInPlaceTimed`: frames at ``+0x04``.
    14: "run_in_place",
    #: `ZombieStateHoldClipThenBranch`: motion at ``+0x04``, frames at
    #: ``+0x08``, and a walk distance at ``+0x0C`` when ``+0x03`` is 15.
    17: "hold_clip",
    #: `ZombieStateWaitCameraFrameThenBranch`: motion ``+0x04``, frame ``+0x08``.
    18: "wait_cam_frame",
    #: `ZombieStateWaitForCameraFrame`: motion ``+0x04``, s16 frame ``+0x08``,
    #: freeze ``+0x0C``, claim ``+0x0D``, s16 delay ``+0x0E``, s16 cooldown
    #: ``+0x10``.
    19: "wait_cam_strike",
    #: `ZombieStateWaitScriptFlagThenBranch`: motion ``+0x04``, flag ``+0x08``.
    20: "wait_flag",
    #: `ZombieStateScriptedGrabAndDespawn`: cue ``+0x04`` (-1 for at once),
    #: motion ``+0x08``, hit frame ``+0x0C``.
    23: "grab_kill",
    #: `ZombieStateLeapToPoint`: dest ``+0x04``, s16 frames ``+0x10``, s16
    #: delay ``+0x12``, idle motion ``+0x14``, strike motion ``+0x18``, u16 hit
    #: frame ``+0x1C``, s8 player ``+0x1E``.
    24: "leap_strike",
    #: `ZombieStateArcScriptedEntrance`: dest ``+0x04``, arc frames ``+0x10``,
    #: arc step ``+0x14``, delay ``+0x18``.
    30: "arc_entrance",
    #: `ZombieStateWaitScriptFlagThenEnter`: u8 flag ``+0x04``, idle motion
    #: ``+0x08``, delay ``+0x0C``, motion ``+0x10``.
    31: "flag_enter",
    #: `ZombieStateDelayedStrikeInPlace`: s16 delay ``+0x04``, s16 rearm
    #: ``+0x06``, s8 player ``+0x08``.
    32: "delayed_strike",
}


def entry_tail(rec, state: int, exit_state: int) -> dict | None:
    """The tail one of :data:`ENTRY_TAIL_STATES` reads, or ``None``.

    Every field is bounds-checked, because for any state but its own these
    bytes are the *next* descriptor: a motion id has to be a plausible id, a
    frame count has to be a plausible count. A field that fails is dropped
    rather than guessed, and the port's state falls back to its own default.
    """
    def i32(off):
        return rec.param(off, "i32")

    def motion(off):
        m = rec.param(off, "i32")
        return m if m is not None and 0 < m < 4096 else None

    def frames(off, lim=100000):
        n = rec.param(off, "i32")
        return n if n is not None and 0 <= n < lim else None

    def dist(off):
        # Read as an *integer* and converted, which is what the two arms that
        # hand to state 15 do -- `(float)*(uint *)(tail + n)`, an FILD. The
        # float reading of the same bytes would be a denormal.
        d = rec.param(off, "u32")
        return float(d) if d is not None and 0 < d < 4096 else None

    kind = ENTRY_TAIL_STATES.get(state)
    if kind is None:
        return None
    if kind == "surface_cue":
        t = {"cue_frame": frames(0x04) or 0}
        if exit_state == 15:
            d = dist(0x08)
            if d is not None:
                t["walk_distance"] = d
        return t
    if kind == "run_in_place":
        n = frames(0x04, 3600)
        return {"frames": n} if n else None
    if kind == "hold_clip":
        m, n = motion(0x04), frames(0x08, 3600)
        if m is None or n is None:
            return None
        t = {"motion": m, "frames": n}
        if exit_state == 15:
            d = dist(0x0C)
            if d is not None:
                t["walk_distance"] = d
        return t
    if kind in ("wait_cam_frame", "wait_flag"):
        m, n = motion(0x04), i32(0x08)
        if m is None or n is None or not 0 <= n < 100000:
            return None
        return {"motion": m, "cue": n}
    if kind == "wait_cam_strike":
        m = motion(0x04)
        f = rec.param(0x08, "i16")
        if m is None or f is None:
            return None
        return {"motion": m, "cue_frame": f,
                "freeze": (rec.param(0x0C, "i8") or 0) == 0,
                "claim": (rec.param(0x0D, "i8") or 0) != 0,
                "delay": rec.param(0x0E, "i16") or 0,
                "cooldown": rec.param(0x10, "i16") or 0}
    if kind == "grab_kill":
        cue, m, hit = i32(0x04), motion(0x08), frames(0x0C, 3600)
        if m is None or hit is None or cue is None:
            return None
        return {"cue_frame": cue, "motion": m, "hit_frame": hit}
    if kind == "leap_strike":
        dest = [rec.param(0x04 + 4 * k, "f32") for k in range(3)]
        n = rec.param(0x10, "i16")
        idle, strike = motion(0x14), motion(0x18)
        hit = rec.param(0x1C, "u16")
        if (not all(v is not None and math.isfinite(v) for v in dest)
                or not n or n <= 0 or idle is None or strike is None
                or hit is None):
            return None
        return {"dest": dest, "frames": n,
                "delay": rec.param(0x12, "i16") or 0,
                "idle_motion": idle, "strike_motion": strike,
                "hit_frame": hit, "player": rec.param(0x1E, "i8") or 0}
    if kind == "arc_entrance":
        dest = [rec.param(0x04 + 4 * k, "f32") for k in range(3)]
        n, step = rec.param(0x10, "i32"), rec.param(0x14, "i32")
        if (not all(v is not None and math.isfinite(v) for v in dest)
                or not n or n <= 0 or not step or step <= 0):
            return None
        return {"dest": dest, "frames": n, "step": step,
                "delay": frames(0x18, 3600) or 0}
    if kind == "flag_enter":
        idle, m = motion(0x08), motion(0x10)
        flag = rec.param(0x04, "u8")
        if idle is None or m is None or flag is None:
            return None
        return {"flag": flag, "idle_motion": idle, "motion": m,
                "delay": frames(0x0C, 3600) or 0}
    if kind == "delayed_strike":
        return {"delay": rec.param(0x04, "i16") or 0,
                "rearm": rec.param(0x06, "i16") or 0,
                "player": rec.param(0x08, "i8") or 0}
    return None


#: A waypoint: ``{s16 step, s16 script, f32 x, f32 y, f32 z}``, sixteen bytes,
#: and the list is terminated by a step of -1.
#:
#: *step* is the arc's parameter-advance rate: `ActorArcBeginTo` sets the
#: duration to ``dist2d * step`` rounded down to a multiple of *step*, and
#: `ActorArcStepInterp` advances the counter by *step* a frame -- so the leg
#: still takes about ``dist2d`` frames, at *step* times the resolution. It is
#: **not** the arc kind: that is ``obj+0x1354``, which `SelectActorGravityAxis`
#: writes from the surface the actor is attached to.
#:
#: *script* selects the leg's three-stage arc motion script for every character
#: type but 0x17 -- 1 -> ``0x00565E58``, 2 -> ``0x00565E88``, anything else
#: ``0x00565EB8``; type 0x17 always takes ``0x00565E28``.
WAYPOINT_BYTES = 0x10


@dataclass
class Placement:
    """One spawn descriptor resolved to a character and a motion."""

    at: int                         #: evt file offset, the descriptor's identity
    cls: int
    char_type: int
    motion: int | None
    spawn: dict                     #: the script's own spawn dict
    #: A scripted entrance played once before the loop -- see
    #: :data:`MOTION_STATE_CUE`.
    intro: tuple[int, int] | None = None   #: ``(motion, delay_frames)``
    #: The class-0x30 descriptor tail, from `EnemyZombieInit` and
    #: `ZombieStateApproach`: ``{i8 char_type; i8 body_condition;
    #: i8 initial_state; i8 attack_state}``. State 22 is the approach and
    #: state 0 is the no-op, so an attack state of 0 means this actor never
    #: attacks.
    body_condition: int = 0
    initial_state: int = 0
    attack_state: int = 0
    #: ``obj+0x131F`` -- which ring set this actor measures against.
    ring_set: int = 0
    #: The ballistic arc a spawn placed in the air rides to the ground:
    #: ``{dest: [x, y, z], frames: n}`` from the descriptor's ``+0x04``..
    #: ``+0x10``. Only the two leap states read those bytes -- class 0x31's
    #: state 20 (`ThrowerStateLeapToPoint`) and class 0x30's state 24
    #: (`ZombieStateLeapToPoint`) -- so it is emitted only for them; for any
    #: other state the same bytes mean something else.
    leap: dict | None = None
    #: The waypoint path a `ThrowerStatePathFollow` spawn walks:
    #: ``{delay, points: [{step, motion_set, dest}]}`` from the descriptor's
    #: ``+0x04`` and the 16-byte entries at ``+0x08``.
    path: dict | None = None
    #: `ThrowerStateWalkDistance`'s target distance -- see
    #: :data:`WALK_DISTANCE_STATES`.
    walk_distance: float | None = None
    #: `ThrowerStateEntranceClip`'s one-shot motion -- see
    #: :data:`ENTRANCE_CLIP_STATES`.
    entrance_motion: int | None = None
    #: `ThrowerStateDelayedPounce`'s ``{motion, frames}`` -- see
    #: :data:`POUNCE_STATES`.
    pounce: dict | None = None
    #: `ThrowerStateGrabPlayer`'s ``{offset, cue_frame, drop_frames,
    #: hold_frames, player}`` -- see :data:`GRAB_STATES`.
    grab: dict | None = None
    #: `ThrowerStateBlinkInThreeHops`' hold, in frames -- see
    #: :data:`BACK_AWAY_STATES`.
    back_away_delay: int | None = None
    #: `ThrowerStateWaitForCue`'s ``{motion, cond, operand}`` -- see
    #: :data:`CUE_STATES`.
    cue: dict | None = None
    #: `ThrowerStateLeapStrike`'s arc duration -- see :data:`LEAP_STRIKE_STATES`.
    leap_strike_frames: int | None = None
    #: `ZombieStateStandAndThrow`'s tail -- see :data:`STAND_AND_THROW_STATES`.
    stand_throw: dict | None = None
    #: The spawn record's own flags word, which `ActorInitFlags`
    #: (`FUN_00408970`) makes the actor's ``obj+0x34``: ``obj[0x34] = flags | 1``.
    #: Bit 17 skips the per-frame ground snap, bit 27 picks the run variant,
    #: bit 15 takes the actor out of the shot test. Carried whole rather than
    #: bit by bit, because that is what the engine does with it.
    init_flags: int = 0
    #: `ZombieStateEmerge`'s (state 27) ``{delay, motion}`` from the tail's
    #: ``+0x04`` and ``+0x08``. The clip's own root translation is what lifts
    #: the actor out of the water or the ground -- a spawn's ``y`` is where its
    #: entrance *starts*, not where it stands.
    emerge: dict | None = None
    #: `ZombieStateDelayedLeap`'s (state 26) ``{delay, dest, gravity}`` from
    #: ``+0x04``, ``+0x08``..``+0x10`` and ``+0x14``. The last is a per-frame
    #: downward **acceleration**, not a duration -- `FUN_0040A090` counts the
    #: frames out by simulating the drop.
    delayed_leap: dict | None = None
    #: The two captor scripts, decoded -- see :func:`target_script`. ``target``
    #: is the tail's ``+0x04`` blob read for the initial state, ``attack`` the
    #: ``+0x08`` blob read for the attack state. Only class-0x30 spawns whose
    #: state is in :data:`TARGET_SCRIPT_SHAPE` carry them.
    target_script: dict | None = None
    attack_script: dict | None = None
    #: The captor family's camera cue, ``{path, frame}`` from the tail's
    #: ``+0x0C``/``+0x0E``, or ``None`` when ``+0x0C`` is -1. `ZombieScriptEnded`
    #: reads it to decide whether a captor that has finished its script may turn
    #: on the player at once or must first hold in state 42 until the camera
    #: reaches that path and frame. Three spawns in the game set one.
    camera_cue: dict | None = None
    #: The tail one of the twelve :data:`ENTRY_TAIL_STATES` reads, decoded by
    #: :func:`entry_tail` and shaped by which state it is. Together these are
    #: 133 of the game's 356 class-0x30 spawns; before it they all fell through
    #: `ZombieEntryState` to `AttackRun` and charged the camera on frame one.
    entry: dict | None = None
    #: The descriptor's ``+0x22``, **before** difficulty scaling.
    #: `ActorInitHitPoints` adds ``difficulty.hp_delta[rank]`` and clamps to
    #: ``[1, 300]``; the client does that, because it is the client that owns
    #: the difficulty setting.
    hp: int = 0

    def to_json(self) -> dict:
        d = {"at": self.at, "class": self.cls, "char_type": self.char_type,
             "motion": self.motion, "hp": self.hp,
             "body_condition": self.body_condition,
             "initial_state": self.initial_state,
             "attack_state": self.attack_state,
             "ring_set": self.ring_set,
             # The actor's own yaw, which the directional death compares the
             # camera's against.
             "yaw": self.spawn["orient"][1] & 0xFFFF}
        # A class-0x10 child: present exactly when the civilian that built it
        # is, because nothing in the script ever places it.
        if self.spawn.get("civilian_child") is not None:
            d["civilian_child"] = self.spawn["civilian_child"]
        if self.emerge:
            d["emerge"] = self.emerge
        if self.delayed_leap:
            d["delayed_leap"] = self.delayed_leap
        if self.entry:
            d["entry"] = self.entry
        if self.target_script:
            d["target_script"] = self.target_script
        if self.attack_script:
            d["attack_script"] = self.attack_script
        if self.camera_cue:
            d["camera_cue"] = self.camera_cue
        if self.leap:
            d["leap"] = self.leap
        if self.path:
            d["path"] = self.path
        if self.walk_distance is not None:
            d["walk_distance"] = self.walk_distance
        if self.stand_throw is not None:
            d["stand_throw"] = self.stand_throw
        if self.init_flags:
            d["init_flags"] = self.init_flags
        # The descriptor's own `+0x20` word, which `SpawnFromDescriptor`
        # (`FUN_00408A20`) copies to `obj+0x1316` and both `EnemyThrowerInit`
        # and `EnemyZombieInit` make the low half of `obj+0x136C`. Read off the
        # spawn dict rather than carried as a field of its own, the same way
        # `yaw` and `civilian_child` are -- see `evt.SPAWN_DESC_FLAGS`.
        #
        # A class-0x10 child placement has no `desc_flags` key at all: those
        # spawn dicts are built by `characters.py` rather than by the script
        # walker. Nine of the game's 75 civilian children set the word and all
        # nine are class 0x30 or 0x18, so no class-0x31 spawn is affected.
        if self.spawn.get("desc_flags"):
            d["desc_flags"] = self.spawn["desc_flags"]
        if self.entrance_motion is not None:
            d["entrance_motion"] = self.entrance_motion
        if self.pounce:
            d["pounce"] = self.pounce
        if self.grab:
            d["grab"] = self.grab
        if self.back_away_delay is not None:
            d["back_away_delay"] = self.back_away_delay
        if self.cue:
            d["cue"] = self.cue
        if self.leap_strike_frames is not None:
            d["leap_strike_frames"] = self.leap_strike_frames
        if self.intro:
            d["intro"] = {"motion": self.intro[0], "delay": self.intro[1]}
        return d
