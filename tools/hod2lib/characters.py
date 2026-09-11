"""Assemble a spawned character: skeleton, placement and motion.

:mod:`hod2lib.spawnres` answers *what* a spawn is -- its class, its character
type, the `pol/` file its parts live in. This module answers the two questions
after that, which are what a viewer actually needs:

* **How is it built?** ``ExeTables.character_skeleton`` gives the bone tree
  straight out of the EXE, so a character assembles with no `mot/` data at all.
* **What is it doing?** A character in bind pose is not standing still, it is a
  heap: every bone offset runs along its own local X, so zero rotations pile the
  parts on top of each other. It has to be posed from a motion frame to look
  like anything, and *which* motion is a property of the class handler.

That last point is why this is conservative. ``obj+0x1B4`` is the motion id --
``FUN_00410590`` passes it to the sampler as
``FUN_00412F50(obj+0x1F4, obj+0x1B4, frame)``, character type and motion id --
and a class handler is the only thing that writes it. So a class earns a motion
rule the same way it earns a character-type rule in `spawnres`: by having its
handler read. There is deliberately no fallback.

A tempting one was tried and rejected. Deriving the bank from the character's
bone count *almost* works -- the stride ``(bones*6+15) & ~3`` has to divide
every block in the bank exactly, which is a real constraint, and it uniquely
picks `nya.bin` for the cat's 19 bones, `frog.bin` for 15 and `kame.bin` for
24. But 30 of the 49 banks are 16-bone, so every humanoid would get an
arbitrary one of thirty. A character posed from another character's animation
is worse than a character not posed at all, because it looks like a decoding
bug rather than a missing feature.

Characters with no motion rule keep their spawn marker. See
docs/formats/mot.md and docs/formats/spawns.md.

**The waist was missing on the humanoids, and it is the extra-part list.**
`charbuild.extra_parts` reads ``EXTRA_PARTS`` (0x0052ED08) and
`charbuild._second_root` hangs what it names off the **pelvis** root; slot
``0x1F02`` -- the one that sits between `char_adv00`'s bone slots ``0x1F00,
0x1F01, 0x1F03, 0x1F06`` -- is that character's abdomen, and with it in place
the render matches the game. The bundle carries one per spawn: 32 of stage 2's
`char_adv00` hierarchies have a ``_extra0_1f02`` node. `[proved]`

The old guess in this docstring was that the gap was in the skeleton walk. It
was not: `FUN_004107E0` writes exactly one slot per bone into the draw record,
`FUN_00411050` (`SkeletonDrawNodeSlot`) draws that one slot through
`AssetDrawSlot`, and ``PTR_DAT_004D032C[char_type]`` -- the untested lead --
turned out to be the per-bone **hit sphere** (`combat.HIT_SPHERES`), which is
why its first word is compared against the node's slot.

**Twenty-one character types have no extra part, and the one that showed it
was a different mechanism entirely.** ``EXTRA_PARTS`` is a null pointer for 21
of the 86 types that have a skeleton -- the cat and most of the bosses among
them, where nothing is obviously missing. Type 0 is `char_adv02`, the commonest
zombie, and it looked like the exception: its *undamaged* torso model (slot
``0x1B3D``) reaches ``y -2.0..5.5``, the first two damaged stages of bone 1
(``0x1B70`` and ``0x1B71``) are chest-only at ``y 1.35..5.53``, and the pelvis
tops out at ``y -0.45``, so a shot zombie had a 1.75-unit hole where its
midriff should be.

The band is drawn by `ZombieDrawBonePart` (`FUN_004534A0`), class 0x30's
**per-bone draw callback** -- installed at ``obj+0x12EC`` by `EnemyZombieInit`
and called by `SkeletonEmitNode` *instead of* `SkeletonDrawNodeSlot`. It
switches on the slot the bone is currently drawing, and for ``0x1B70`` and
``0x1B71`` it draws that slot **and** a second model, ``0x1B52 + (counter +
obj+0x3C * 10) % 30``: a thirty-cel flipbook of the lower torso. For the
undamaged ``0x1B3D`` it draws no such thing as ``0x1B3D`` at all -- a twenty-cel
chest, ``0x1B3E + seed % 20``, plus the same lower torso. Stages ``0x1B72``,
``0x1B73`` and ``0x1B74`` fall to the default arm and draw alone, and those
three are exactly the ones whose own geometry already reaches ``y -2.02``,
which is the check on the reading.

What this docstring used to say about the band, and why it was wrong: the two
things ruled out were ruled out correctly -- `AssetDrawSlot` (`FUN_00418560`)
draws one model per slot and `FUN_004122E0` only ever **suppresses** a draw --
but "so a bone cannot draw two" does not follow, because the *hook* calls the
draw as many times as it likes. It also said ``harold.bin`` carries five
lower-torso models at ``0x1B6B..0x1B6F`` "of exactly the missing extent and
exactly as many as bone 1 has damage stages, which no table in the EXE
references". The scan was right that no table names them and the file was
wrong -- they are in **both** `char_adv02.bin` and `harold.bin` -- and the run
is ``0x1B52..0x1B6F``, thirty models, not five: reading only the last five of
it is what made the count look meaningful. The selection is arithmetic in the
hook, so no amount of scanning for a table could have found it.
`web/src/game/class30/bonecels.ts` carries the table, the measurements and the
seven arms that are not yet ported.
"""

from __future__ import annotations

import math

from . import degraded, spawnres
from .bams import (  # noqa: F401
                   bams_from_matrix, compose_bams, rot_matrix)
from .arcscript import (  # noqa: F401
                        ARC_SCRIPT_STAGES, CLASS30_ARC_SCRIPTS,
                        CLASS31_ARC_SCRIPTS, CLASS31_ARC_SCRIPT_BYTES,
                        arc_script)
from .charmotion import (  # noqa: F401
    BOSS4_CLIPS, CLASS20_DEATH_MOTION, CLASS20_IDLE_MOTIONS, humanoid_motion_ids,
                         MAX_BAKED_FRAMES, MOTION_FPS, MOTION_RULES,
                         MOTION_STATE_CUE, bake, intro_for, motion_for)
from .combat import (  # noqa: F401
                     ACTOR_RADIUS_TABLE, ARRAY_BLOCK, ATTACK_ENTRY,
                     ATTACK_MAX, ATTACK_PICK_PER_ZONE, ATTACK_PICK_TABLE,
                     ATTACK_TABLE, ATTACK_ZONE_COMBOS, BLOOD_SCALE_BY_RESULT,
                     BONE_ZONE, DEATH_BACK, DEATH_FRONT, DEATH_LEFT,
                     DEATH_RIGHT, DIFFICULTY_HP_DELTA, HIT_DAMAGE,
                     HIT_DAMAGE_RANK, HIT_EFFECT, HIT_RANKS,
                     HIT_REACT_ALT_TABLE, HIT_REACT_TABLE, HIT_SPHERES,
                     HIT_STEPS, HIT_VOICE_TABLE, IMPACT_SPRITE_BY_MATERIAL,
                     IMPACT_SPRITE_DEFAULT, INITIAL_DAMAGE_RANK,
                     MOTION_ROW_BACKOFF, MOTION_ROW_LEN, NO_EFFECT_MATERIAL,
                     NO_EFFECT_MATERIAL_TYPE3, NO_EFFECT_RICOCHET,
                     NO_EFFECT_RICOCHET_TYPE2, PLAYER_START_LIVES,
                     REACT_GROUP, REACT_GROUPS, RICOCHET_BY_MATERIAL,
                     STAND_AND_THROW_STATES, THROWER_SLOTS, THROW_AIM_AHEAD,
                     THROW_AIM_SIDE, THROW_BLINK_FRAMES, THROW_CONDITIONS,
                     THROW_SPEED, THROW_STICK_FRAMES, THROW_TABLE,
                     VOICE_SET_A_TYPES, ZOMBIE_AXE_SLOT,
                     ZOMBIE_THROW_AIM_DROP, ZOMBIE_THROW_ARC_GRAVITY,
                     ZOMBIE_THROW_ARC_HIT_KIND, ZOMBIE_THROW_HIT_KIND,
                     ZOMBIE_THROW_SLOTS, ZOMBIE_THROW_SPEED,
                     ZOMBIE_THROW_SPEED_STANDING, actor_radius, attack_picks,
                     attack_tables, bone_zones, combat_tables,
                     damage_rank_row, death_motions, difficulty_tables,
                     gore_parts, hit_reactions, hit_sphere, hit_steps,
                     motion_row, player_damage, reaction_groups, throw_tables,
                     torso_stage_count, zombie_throw_tables)
from .approach import (  # noqa: F401
                       APPROACH_RING_DEFAULTS, APPROACH_RING_SETS,
                       RING_SET_FOR_CHAR0, TURN_RATE_CURVES,
                       TURN_RATE_CURVE_COUNT, TURN_RATE_CURVE_LEN,
                       approach_tables, camera_tracking)
from .class31 import (  # noqa: F401
                      CLASS31_ATTACKS_PER_STANCE, CLASS31_ATTACK_PICKS,
                      CLASS31_ATTACK_TABLE, CLASS31_BANDS,
                      CLASS31_CORPSE_FRAMES, CLASS31_LITERAL_MOTIONS,
                      CLASS31_MOTION_SETS, CLASS31_MOTION_SET_LEN,
                      CLASS31_PICKS, CLASS31_REACTIONS, CLASS31_SETS,
                      CLASS31_STANCES, CLASS31_STATE_PICKS,
                      CLASS31_THROW_ENTRIES, CLASS31_THROW_TABLE,
                      class31_motion_ids, class31_tables)
from .actorscript import (  # noqa: F401
                          TARGET_SCRIPT_SHAPE, civilian_item_slots,
                          civilian_motion_ids, civilian_ordered_states,
                          target_script, target_script_motions)
from .placement import (  # noqa: F401
                        BACK_AWAY_STATES, CUE_STATES, ENTRANCE_CLIP_STATES,
                        ENTRY_TAIL_STATES, GRAB_STATES, LEAP_STATES,
                        LEAP_STRIKE_STATES, PATH_STATES, POUNCE_STATES,
                        Placement, WALK_DISTANCE_STATES, WAYPOINT_BYTES,
                        entry_tail)
from .charbuild import (  # noqa: F401
                        Character, EXTRA_PARTS, build, extra_parts,
                        gore_entry, rig_entry)

# -- the package's front door for character data ---------------------------
#
# `characters` was 2,772 lines and is now the top of a small DAG: `bams`,
# `arcscript`, `charmotion`, `combat`, `approach`, `class31`, `actorscript`,
# `placement` and `charbuild` below it, nothing importing upwards. What is
# left here is the two functions that need all of them -- resolving a whole
# stage's spawns, and serialising the result.
#
# Every name any of those modules exports is re-exported from here, so
# `from hod2lib import characters as ch; ch.hit_steps(...)` still reads the
# same as it did. Importing from the module that owns a name is better and is
# what new code should do; this exists so that the split was a refactor and
# not a flag day across `tools/verify_*.py`.
__all__ = [
    "ACTOR_RADIUS_TABLE",
    "APPROACH_RING_DEFAULTS",
    "APPROACH_RING_SETS",
    "ARC_SCRIPT_STAGES",
    "ARRAY_BLOCK",
    "ATTACK_ENTRY",
    "ATTACK_MAX",
    "ATTACK_PICK_PER_ZONE",
    "ATTACK_PICK_TABLE",
    "ATTACK_TABLE",
    "ATTACK_ZONE_COMBOS",
    "BACK_AWAY_STATES",
    "BLOOD_SCALE_BY_RESULT",
    "BONE_ZONE",
    "CLASS20_DEATH_MOTION",
    "CLASS20_IDLE_MOTIONS",
    "CLASS30_ARC_SCRIPTS",
    "CLASS31_ARC_SCRIPTS",
    "CLASS31_ARC_SCRIPT_BYTES",
    "CLASS31_ATTACKS_PER_STANCE",
    "CLASS31_ATTACK_PICKS",
    "CLASS31_ATTACK_TABLE",
    "CLASS31_BANDS",
    "CLASS31_CORPSE_FRAMES",
    "CLASS31_LITERAL_MOTIONS",
    "CLASS31_MOTION_SETS",
    "CLASS31_MOTION_SET_LEN",
    "CLASS31_PICKS",
    "CLASS31_REACTIONS",
    "CLASS31_SETS",
    "CLASS31_STANCES",
    "CLASS31_STATE_PICKS",
    "CLASS31_THROW_ENTRIES",
    "CLASS31_THROW_TABLE",
    "CUE_STATES",
    "Character",
    "class20_tail",
    "SLOT_DRAWN_CLASSES",
    "CLASS33_CARRIER",
    "slot_drawn_spawn",
    "class33_tail",
    "class52_tail",
    "class53_tail",
    "class14_tail",
    "CLASS14_MOTIONS",
    "DEATH_BACK",
    "DEATH_FRONT",
    "DEATH_LEFT",
    "DEATH_RIGHT",
    "DIFFICULTY_HP_DELTA",
    "ENTRANCE_CLIP_STATES",
    "ENTRY_TAIL_STATES",
    "EXTRA_PARTS",
    "GRAB_STATES",
    "HIT_DAMAGE",
    "HIT_DAMAGE_RANK",
    "HIT_EFFECT",
    "HIT_RANKS",
    "HIT_REACT_ALT_TABLE",
    "HIT_REACT_TABLE",
    "HIT_SPHERES",
    "HIT_STEPS",
    "HIT_VOICE_TABLE",
    "IMPACT_SPRITE_BY_MATERIAL",
    "IMPACT_SPRITE_DEFAULT",
    "INITIAL_DAMAGE_RANK",
    "LEAP_STATES",
    "LEAP_STRIKE_STATES",
    "MAX_BAKED_FRAMES",
    "MOTION_FPS",
    "MOTION_ROW_BACKOFF",
    "MOTION_ROW_LEN",
    "MOTION_RULES",
    "MOTION_STATE_CUE",
    "NO_EFFECT_MATERIAL",
    "NO_EFFECT_MATERIAL_TYPE3",
    "NO_EFFECT_RICOCHET",
    "NO_EFFECT_RICOCHET_TYPE2",
    "PATH_STATES",
    "PLAYER_START_LIVES",
    "POUNCE_STATES",
    "Placement",
    "REACT_GROUP",
    "REACT_GROUPS",
    "RICOCHET_BY_MATERIAL",
    "RING_SET_FOR_CHAR0",
    "STAND_AND_THROW_STATES",
    "TARGET_SCRIPT_SHAPE",
    "THROWER_SLOTS",
    "THROW_AIM_AHEAD",
    "THROW_AIM_SIDE",
    "THROW_BLINK_FRAMES",
    "THROW_CONDITIONS",
    "THROW_SPEED",
    "THROW_STICK_FRAMES",
    "THROW_TABLE",
    "TURN_RATE_CURVES",
    "TURN_RATE_CURVE_COUNT",
    "TURN_RATE_CURVE_LEN",
    "VOICE_SET_A_TYPES",
    "WALK_DISTANCE_STATES",
    "WAYPOINT_BYTES",
    "ZOMBIE_AXE_SLOT",
    "ZOMBIE_THROW_AIM_DROP",
    "ZOMBIE_THROW_ARC_GRAVITY",
    "ZOMBIE_THROW_ARC_HIT_KIND",
    "ZOMBIE_THROW_HIT_KIND",
    "ZOMBIE_THROW_SLOTS",
    "ZOMBIE_THROW_SPEED",
    "ZOMBIE_THROW_SPEED_STANDING",
    "actor_radius",
    "approach_tables",
    "arc_script",
    "attack_picks",
    "attack_tables",
    "bake",
    "bams_from_matrix",
    "bone_zones",
    "build",
    "camera_tracking",
    "characters_json",
    "civilian_item_slots",
    "civilian_motion_ids",
    "class31_motion_ids",
    "class31_tables",
    "combat_tables",
    "compose_bams",
    "damage_rank_row",
    "death_motions",
    "difficulty_tables",
    "entry_tail",
    "extra_parts",
    "gore_entry",
    "gore_parts",
    "hit_reactions",
    "hit_sphere",
    "hit_steps",
    "intro_for",
    "motion_for",
    "motion_row",
    "player_damage",
    "reaction_groups",
    "resolve_for_stage",
    "rig_entry",
    "rot_matrix",
    "civilian_ordered_states",
    "target_script",
    "target_script_motions",
    "throw_tables",
    "torso_stage_count",
    "zombie_throw_tables",
]


def class20_tail(rec) -> dict:
    """Class 0x20's descriptor tail, as `OneHitTargetInit` reads it.

    ``{i8 char_type; i8 subtype; s16 remove_path; s16 remove_frame;
    s16 motion}``, and for sub-type 2 four more floats at ``+0x08``..``+0x14``
    bounding the actor's x and z.

    **The same eight bytes are three different things across classes** --
    class 0x30 reads ``+0x01``/``+0x02``/``+0x03`` as the body condition, the
    initial state and the attack state -- so this is gated on the class and
    emitted under a class-named key rather than into the shared fields.

    The box is emitted only for sub-type 2 because only sub-type 2 reads it:
    for the four stage-2 spawns at 0x52EC..0x5370 the tail is **eight bytes**
    and ``+0x08`` is already the next descriptor's class word.
    """
    subtype = rec.param(0x01, "i8") or 0
    box = None
    if subtype == 2:
        v = [rec.param(o, "f32") for o in (0x08, 0x0C, 0x10, 0x14)]
        if all(x is not None and math.isfinite(x) for x in v):
            box = v
    return {"subtype": subtype,
            "remove_path": rec.param(0x02, "i16") or 0,
            "remove_frame": rec.param(0x04, "i16") or 0,
            # 0 is a value here and not an absence: it means the random draw
            # from `g_class20_idle_motions`, which is the port's to make.
            "motion": rec.param(0x06, "i16") or 0,
            "box": box}


#: Classes whose actors are drawn by `AssetDrawSlot` rather than by a
#: skeleton, so `spawnres` can never identify one and the placement has to
#: survive that anyway. See the note in :func:`resolve_for_stage`.
SLOT_DRAWN_CLASSES = frozenset({0x33, 0x52})

#: The one class-0x33 sub-handler the player runs: ``obj+0x11C == 1``.
#:
#: `ScriptedSceneryDispatch33` (`FUN_00432FF0`) switches that word into eleven
#: different objects, so :func:`class33_tail` is **one** handler's reading of
#: the bytes and not the class's. ``MOVSX ECX, word ptr [EAX + 0x11c]`` at
#: 0x00432FF4 is the switch, and the descriptor's ``+0x22`` is what reaches it.
CLASS33_CARRIER = 1


def slot_drawn_spawn(cls: int, rec) -> bool:
    """Which spawns of a :data:`SLOT_DRAWN_CLASSES` class carry a placement.

    Class 0x52 is one object, so every spawn of it qualifies. Class 0x33 is
    eleven, and only selector 1's tail is decoded -- selector 2's props already
    reach the player through `props`, and the other nine are unread. Emitting
    them would be a placement whose ``class33`` block is a different handler's
    bytes read under this one's names, which is `L3` written into the bundle.
    """
    if cls == 0x33:
        return rec.hp == CLASS33_CARRIER
    return True


def class52_tail(rec) -> dict:
    """Class 0x52's descriptor tail, as `MouseInit` reads it.

    One s16 at ``+0x00``: the **subtype**. 0 and 1 wander and self-despawn;
    2, 3 and 4 run `MouseBranchTriggerUpdate`, a shootable route-branch
    trigger, and only while ``g_GameMode == 1``.

    Emitted under a class-named key for the same reason class 0x20's is: the
    same two bytes are class 0x30's body condition and initial state.
    """
    return {"subtype": rec.param(0x00, "i16") or 0}


def class53_tail(rec) -> dict:
    """Class 0x53's descriptor tail, as `CatInit` reads it.

    Two s16s: ``+0x00`` an animation set that indexes 0x00589A64 for the
    motion, ``+0x02`` the **subtype**. Subtype 2 and up runs
    `CatBranchTriggerUpdate`, which writes the route branch in event block 8
    and nowhere else, and only while ``g_GameMode == 1``.

    All four shipped spawns are stage 2, and only the one in block 8 carries a
    subtype above 1 -- so the block gate and the data agree exactly.
    """
    return {"anim_set": rec.param(0x00, "i16") or 0,
            "subtype": rec.param(0x02, "i16") or 0}


def class33_tail(rec) -> dict:
    """Class 0x33 selector 1's tail, as `ScriptedCarrierUpdate33`
    (`FUN_004331D0`) and `ScriptedCarrierStepPath33` (`FUN_00433860`) read it.

    ::

        tail+0x00  i32  draw slot                    -> obj+0x13F0
        tail+0x04  i32  shot mesh, -1 for none       -> obj+0x14C, obj+0x34 |= 0x50
        tail+0x08  f32  shot sphere, when it is -1   -> obj+0x124 and obj+0x128
        tail+0x0C  i32  the `op_` path slot          -> obj+0x1350
        tail+0x10  f32  the last frame of the run    -> obj+0x1374
        tail+0x14  f32  the frame the effect fires, -1.0 for never
        tail+0x18  i32  the frame that raises bit 0x10000000
        tail+0x1C  i32  the camera frame that despawns it
        tail+0x20  u8   a script flag that raises bit 0x10000000
        tail+0x21  u8   a script flag that despawns it
        tail+0x24  f32[6]  where the effect is spawned: x, y, z and three rotations

    The two frame fields are **not** camera frames even though one is seeded
    from ``g_cam_path_frame``: `ScriptedCarrierStepPath33` starts ``obj+0x1370``
    at ``g_cam_path_frame - 1`` on its first frame and then steps it by one
    itself, so after that the object is on its own clock. ``tail+0x1C`` *is* a
    camera frame -- `ScriptedCarrierUpdate33` compares it against
    ``g_cam_path_frame`` and ``g_cam_path_frame_2`` directly.

    Emitted under a class-named key for the reason class 0x20's and 0x52's are:
    ``tail+0x00`` is class 0x30's body condition.

    Three shipped spawns, all `spawn_obj` (opcode 0x0B): stage 2's 0x4FD0 and
    0x12590, and stage 5's 0x1CE4.
    """
    def f(at: int, dflt: float = 0.0) -> float:
        v = rec.param(at, "f32")
        return dflt if v is None else v

    def i(at: int, dflt: int = -1) -> int:
        v = rec.param(at, "i32")
        return dflt if v is None else v

    def u8(at: int) -> int:
        v = rec.param(at, "u8")
        return 0xFF if v is None else v

    return {
        "slot": i(0x00, 0),
        "shot_mesh": i(0x04),
        "shot_radius": f(0x08),
        "path": i(0x0C),
        "path_end": f(0x10),
        "effect_frame": f(0x14, -1.0),
        "commit_frame": i(0x18),
        "despawn_frame": i(0x1C),
        "commit_flag": u8(0x20),
        "despawn_flag": u8(0x21),
        "effect": [f(0x24 + 4 * k) for k in range(6)],
    }


def class14_tail(rec) -> dict:
    """Class 0x14's descriptor tail, as `Class14Init` (`FUN_00475E90`) reads it.

    ``+0x00`` the character type -- 0x47, `boss2.bin`, on all five shipped
    spawns -- and ``+0x01`` the state the stage-2 boss starts in, which is the
    only thing that tells stage 2's four alternative endings apart: 0, 1, 3 and
    4 there and 2 in stage 5. ``+0x04``..``+0x0C`` is the route's forward
    direction, ``+0x10``..``+0x2C`` are four x/z corners of the patch of water
    it swims inside, and ``+0x30``/``+0x32`` are the camera path and frame that
    despawn it.

    Emitted under a class-named key for the reason class 0x20's and 0x52's are:
    the same two bytes are class 0x30's body condition and initial state.
    """
    def f(at: int) -> float:
        v = rec.param(at, "f32")
        return 0.0 if v is None else v
    return {
        "char_type": rec.param(0x00, "u8") or 0,
        "state": rec.param(0x01, "u8") or 0,
        "dir": [f(0x04), f(0x08), f(0x0C)],
        # **Eight floats, not four vec3s.** `Class14Init` copies ``tail+0x10``
        # and ``tail+0x14`` to ``state+0x28`` and ``state+0x30`` -- the x and
        # the z of the first corner, with the y between them left alone -- and
        # repeats that four times at a stride of 8. Read as vec3s the quad
        # comes out as ``[660, -4900, 660]``, a corner carrying the next
        # corner's x in its y, and the fourth reads past the record into the
        # despawn cue.
        "route": [
            [f(0x10), 0.0, f(0x14)],
            [f(0x18), 0.0, f(0x1C)],
            [f(0x20), 0.0, f(0x24)],
            [f(0x28), 0.0, f(0x2C)],
        ],
        "despawn_path": rec.param(0x30, "i16") or 0,
        "despawn_frame": rec.param(0x32, "i16") or 0,
    }


#: Class 0x14's motion set: `boss2.bin`'s own bank, 21..58.
#:
#: Every clip the class names comes either from a literal in one of its 21
#: states or from the first short of a `g_class14_anim_cues` record that
#: `g_class14_anim_slots` (0x00596408) points at, and every one of those ids is
#: in that range. **Every state measures its exit on the play clock of the clip
#: it names**, so an unbaked clip is not cosmetic: `MotionPlayLength` is 0, the
#: cursor never reaches the last frame, and the boss stands in the water for
#: ever with its gate shut. The range is offered whole and `bake` refuses the
#: ids authored for another skeleton.
CLASS14_MOTIONS: tuple[int, ...] = tuple(range(21, 59))


def resolve_for_stage(stage, prog=None, pose_frame: int | None = None,
                      pose_motion: int | None = None):
    """Characters, their placements, and glTF rig entries for the geometry.

    Returns ``(characters, placements, rig_entries)``:

    * *characters* -- ``{char_type: Character}``, only for types that both
      resolve to geometry **and** have a motion, since an unposed character is
      a heap of parts rather than a character;
    * *placements* -- one :class:`Placement` per spawn descriptor;
    * *rig_entries* -- ready for ``gltf.export_level(rigs=...)``, one entry per
      character type with a ``placements`` list, so the exporter emits a full
      posed hierarchy at every spawn. A skeleton is exactly a rig -- a tree of
      named parts each with a translation, a BAMS triple and an asset slot --
      which is why this goes through the existing writer rather than a second
      glTF path.
    """
    from . import rigs as rigslib, script as scriptlib, stage as stagelib
    from . import evt as evtlib

    tables = stage.tables
    if prog is None:
        try:
            prog = scriptlib.Program(stage)
        except Exception as exc:
            degraded.note("the stage's event script",
                          "no characters at all -- an empty stage", exc)
            return {}, [], []

    # The script's spawn dicts carry the placement; the evt.Spawn records carry
    # the parameter tail a motion rule reads. They join on the descriptor's
    # file offset.
    by_at: dict[int, dict] = {}
    for blk in prog.blocks:
        for step in blk.steps:
            for op in step.ops:
                for sp in op.detail.get("spawns", []) or []:
                    by_at.setdefault(sp["at"], sp)
    try:
        recs = {r.offset: r for r in evtlib.spawns(prog.evt)}
    except Exception as exc:
        degraded.note("the evt spawn descriptors",
                      "characters lose the parameter tail their motion rules "
                      "read, and class 0x10's children are not spawned", exc)
        recs = {}

    # **Class 0x10's children are not script spawns.** `CivilianInit`
    # (`FUN_0048A3E0`) reads a count at tail+0x0C and an array of descriptor
    # pointers at tail+0x10 and calls `SpawnFromDescriptor` on each, parenting
    # every one at `child+0x1394`. Nothing in the evt's instruction stream
    # points at those descriptors, so `evt.spawns()` never returns them and
    # the fifty zombies holding the game's civilians hostage had no geometry,
    # no placement and no actor. They are the reason a civilian can be
    # rescued at all -- the rescue is `wait until my children are dead`.
    for rec in list(recs.values()):
        if rec.cls != 0x10:
            continue
        n = rec.param(0x0C, "i32") or 0
        for k in range(max(0, min(n, 32))):
            w = rec.param(0x10 + k * 4, "u32")
            off = prog.evt.to_offset(w) if w else None
            if off is None or off in recs or off > len(prog.evt.raw) - 0x24:
                continue
            kid = evtlib.read_spawn(prog.evt, off, 0x0B)
            recs[off] = kid
            by_at.setdefault(off, {
                "at": off, "class": kid.cls, "flags": kid.init_flags,
                "pos": list(kid.pos), "yaw_deg": kid.yaw_deg,
                "orient": list(kid.orient), "hp": kid.hp,
                # The descriptor's +0x20 word, the same as the script-walker
                # path carries. These 75 children are built here rather than
                # by the walker, so a key added there does not reach them:
                # nine of them set the word, eight class 0x30 and one 0x18.
                "desc_flags": kid.desc_flags,
                "civilian_child": rec.offset,
            })

    chars: dict[int, Character] = {}
    placements: list[Placement] = []
    class31 = class31_tables(tables)
    try:
        civscripts = tables.civilian_scripts()
    except Exception as exc:
        degraded.note("the civilian script table",
                      "no civilian follows a script", exc)
        civscripts = {"entries": [], "scripts": []}
    per_type: dict[int, list[dict]] = {}
    dset = death_motions(tables)

    for at, sp in sorted(by_at.items()):
        rec = recs.get(at)
        if rec is None:
            continue
        res = spawnres.resolve_spawn(tables, rec)
        if not res.identified or res.char_type is None:
            # **The gate is about geometry, not about the placement.** A class
            # whose draw is an `AssetDrawSlot` rather than a skeleton has no
            # character type to resolve and never will -- class 0x52's mouse
            # is drawn from `mouse.bin` slots 0x1385..0x138E -- but the port
            # still needs its descriptor tail to build the actor at all. Those
            # classes are emitted with `char_type` and `motion` of -1 and
            # `None`; the renderer's ingest already skips a placement with no
            # motion, so nothing downstream has to learn about them, and
            # `game/director.ts` places them from the script's own spawn list.
            #
            # Everything else still falls out here, deliberately. Reading
            # `desc+0x24` as a character type for every class "identified" 962
            # of 1225 spawns, most of them as `char_adv02` because a lifetime
            # of 0 is character type 0.
            if sp["class"] not in SLOT_DRAWN_CLASSES:
                continue
            # ...and, for a class that is several objects behind one id, only
            # the spawns whose sub-handler this library has read. See
            # :func:`slot_drawn_spawn`.
            if not slot_drawn_spawn(sp["class"], rec):
                continue
        motion = motion_for(tables, rec, sp["class"])
        intro = intro_for(tables, rec, sp["class"])
        # The descriptor tail, as `EnemyZombieInit` (class 0x30) and
        # `EnemyThrowerInit` (class 0x31) read it: byte +1 is the body
        # condition, +2 the state the actor starts in, +3 the state a
        # permit-winner enters. Both inits do
        # `obj[0x130C] = d[1]; obj[0x1310] = d[2]`, so both classes get it;
        # every other class gets zeroes rather than a guess.
        # Class 0x19 reads the **same byte** as something else entirely.
        # `Boss4Init` (`FUN_004917E0`) does `MOV byte ptr [EAX + 0x4], DL`
        # with `DL` the tail's byte +1, and that is the index into
        # `g_class19_states` the boss starts in -- one of four entrances, and
        # the four shipped spawns carry one each. It is not a body condition,
        # so it is emitted as `initial_state` and `body_condition` stays 0:
        # the same offset, named for what the class using it uses it as.
        if sp["class"] in (0x30, 0x31):
            tail = (rec.param(1, "i8") or 0, rec.param(2, "i8") or 0,
                    rec.param(3, "i8") or 0)
        elif sp["class"] == 0x19:
            tail = (0, rec.param(1, "u8") or 0, 0)
        else:
            tail = (0, 0, 0)
        # The leap states read a destination and a duration out of the same
        # descriptor; every other state uses those bytes for something else,
        # so this is gated on the state rather than emitted blind.
        leap = None
        if rec is not None and tail[1] in LEAP_STATES.get(sp["class"], ()):
            frames = rec.param(0x10, "i32") or 0
            dest = [rec.param(o, "f32") for o in (4, 8, 0xC)]
            if 0 < frames < 3600 and all(math.isfinite(v) for v in dest):
                leap = {"dest": dest, "frames": frames}
        path = None
        if rec is not None and tail[1] in PATH_STATES.get(sp["class"], ()):
            pts = []
            off = 8
            for _ in range(32):                 # the longest seen is 3
                step = rec.param(off, "i16")
                if step is None or step == -1:
                    break
                dest = [rec.param(off + 4 + 4 * k, "f32") for k in range(3)]
                if not all(v is not None and math.isfinite(v) for v in dest):
                    break
                pts.append({"step": step,
                            "motion_set": rec.param(off + 2, "i16") or 0,
                            "dest": dest})
                off += WAYPOINT_BYTES
            if pts:
                path = {"delay": rec.param(4, "i32") or 0, "points": pts}
        # The other three class-0x31 entrances read the same four bytes as
        # something else again, so each is gated on its own state.
        walk_distance = None
        if tail[1] in WALK_DISTANCE_STATES.get(sp["class"], ()):
            d = rec.param(4, "f32")
            if d is not None and math.isfinite(d) and 0 < d < 4096:
                walk_distance = d
        # `ZombieStateStandAndThrow` reads four delays and then, by the same
        # `tail+0x03` byte the port already carries as `attack_state`, either a
        # walk distance at `+0x10` or a leap point at `+0x10`..`+0x18` with its
        # gravity at `+0x20`. The two readings are cleanly separated: all five
        # spawns whose byte is 0 have a small distance at `+0x10` and zeroes
        # after it, and both whose byte is 26 have a real world point.
        stand_throw = None
        if tail[1] in STAND_AND_THROW_STATES.get(sp["class"], ()):
            exit_state = tail[2]
            st = {
                "delay_two_hands": rec.param(0x04, "i32") or 0,
                "delay_one_hand": rec.param(0x08, "i32") or 0,
                "delay_after_throw": rec.param(0x0C, "i32") or 0,
                "exit_state": exit_state,
            }
            if exit_state == 0:
                d = rec.param(0x10, "f32")
                if d is not None and math.isfinite(d) and 0 < d < 4096:
                    st["walk_distance"] = d
            else:
                dest = [rec.param(0x10 + 4 * k, "f32") for k in range(3)]
                g = rec.param(0x20, "f32")
                if (all(v is not None and math.isfinite(v) for v in dest)
                        and g is not None and math.isfinite(g)):
                    st["leap"] = {"dest": dest, "gravity": g}
            # `+0x1C` is only read on the arm `obj+0x38` bit 0x10 opens, and
            # nothing seen sets that bit -- so it is the next descriptor's
            # bytes for most spawns. Emitted only when it reads as a delay.
            leave = rec.param(0x1C, "i32")
            if leave is not None and 0 <= leave < 3600:
                st["leave_delay"] = leave
            stand_throw = st
        # The twelve entrance states, each gated on its own initial state --
        # see :data:`ENTRY_TAIL_STATES`. Class 0x30 only: class 0x31 numbers
        # its states differently and reads different bytes for them.
        entry = None
        if sp["class"] == 0x30:
            entry = entry_tail(rec, tail[1], tail[2])
        entrance_motion = None
        if tail[1] in ENTRANCE_CLIP_STATES.get(sp["class"], ()):
            m = rec.param(4, "i32")
            if m is not None and 0 < m < 4096:
                entrance_motion = m
        pounce = None
        if tail[1] in POUNCE_STATES.get(sp["class"], ()):
            m, n = rec.param(4, "i32"), rec.param(8, "i32")
            if m is not None and 0 < m < 4096 and n is not None and 0 < n < 3600:
                pounce = {"motion": m, "frames": n}
        grab = None
        if tail[1] in GRAB_STATES.get(sp["class"], ()):
            off = [rec.param(o, "f32") for o in (4, 8, 0xC)]
            cue, drop, hold = (rec.param(0x10, "i16"), rec.param(0x12, "i16"),
                               rec.param(0x14, "i16"))
            if (all(v is not None and math.isfinite(v) for v in off)
                    and cue is not None and drop and hold):
                grab = {"offset": off, "cue_frame": cue, "drop_frames": drop,
                        "hold_frames": hold,
                        "player": rec.param(0x16, "i8") or 0}
        back_away_delay = None
        if tail[1] in BACK_AWAY_STATES.get(sp["class"], ()):
            n = rec.param(4, "i32")
            if n is not None and 0 <= n < 3600:
                back_away_delay = n
        cue = None
        if tail[1] in CUE_STATES.get(sp["class"], ()):
            m, cond, arg = (rec.param(4, "i32"), rec.param(8, "i16"),
                            rec.param(0xA, "i16"))
            if m is not None and 0 < m < 4096 and cond is not None:
                cue = {"motion": m, "cond": cond, "operand": arg or 0}
        leap_strike_frames = None
        if tail[1] in LEAP_STRIKE_STATES.get(sp["class"], ()):
            n = rec.param(4, "i32")
            if n is not None and 0 < n < 3600:
                leap_strike_frames = n
        # The two placing entrances. Both are class 0x30 only, and both are
        # read off the tail at offsets no other state uses -- which is why
        # neither could be folded into `leap` above.
        emerge = delayed_leap = None
        if sp["class"] == 0x30 and tail[1] == 27:
            m = rec.param(8, "i32")
            if m is not None and 0 < m < 4096:
                emerge = {"delay": rec.param(4, "i32") or 0, "motion": m}
        if sp["class"] == 0x30 and tail[1] == 26:
            dest = [rec.param(8 + 4 * k, "f32") for k in range(3)]
            g = rec.param(0x14, "f32")
            if (all(v is not None and math.isfinite(v) for v in dest)
                    and g is not None and 0 < g < 10):
                delayed_leap = {"delay": rec.param(4, "i32") or 0,
                                "dest": dest, "gravity": g}
        class20 = class20_tail(rec) if sp["class"] == 0x20 else None
        class52 = class52_tail(rec) if sp["class"] == 0x52 else None
        class53 = class53_tail(rec) if sp["class"] == 0x53 else None
        class14 = class14_tail(rec) if sp["class"] == 0x14 else None
        class33 = class33_tail(rec) if sp["class"] == 0x33 else None
        tscript = ascript = None
        camera_cue = None
        if sp["class"] == 0x30:
            # **The header shape belongs to the state that reads the blob,
            # not to the state the descriptor starts the actor in.**
            # `ZombieScriptForState` (`FUN_0045CA10`) is
            # `state == tail[3] ? tail+0x08 : tail+0x04`, so tail+0x04 is read
            # by *whatever* state the actor is in that is not its attack
            # state -- and a captor whose initial state is 39,
            # `ZombieStateAwaitCivilianOrder`, is put into a state by its
            # civilian's op 0x1A rather than by its own descriptor.
            #
            # Keying the shape on tail[1] therefore dropped the blob for the
            # six such spawns in the game, because 39 has no shape of its own.
            # Two of them are stage 1 block 9's captors 0x4B74 and 0x4BD0:
            # their civilian orders state 34, their tail+0x04 is
            # `00 00 40 41 | 00 00 | 02 04 | 00 00` -- arrive 12.0, motion
            # 1026 -- and with no script at all `ZombieStateWalkToTarget` read
            # an arrive radius of zero and stood there for ever. All six decode
            # cleanly under the ordered state's shape and under no other.
            tstate = tail[1]
            if tstate not in TARGET_SCRIPT_SHAPE:
                parent = recs.get(sp.get("civilian_child") or -1)
                if parent is not None:
                    for st in civilian_ordered_states(
                            civscripts, parent.param(0x01, "i8") or 0):
                        if st in TARGET_SCRIPT_SHAPE:
                            tstate = st
                            break
            tscript = target_script(prog, prog.evt.to_offset(
                rec.param(4, "u32") or 0), tstate)
            ascript = target_script(prog, prog.evt.to_offset(
                rec.param(8, "u32") or 0), tail[2])
            # The captor family's camera cue, at tail +0x0C/+0x0E.
            # `ZombieScriptEnded` (`FUN_0045C8D0`) tests `tail+0x0C != -1`
            # twice: once to raise `obj+0x34 & 0x10000` on the walk-to-point
            # arm, and once to divert an exit that would have gone to
            # `AttackRun` into state 42 instead, which holds the actor off the
            # player until the camera reaches `(tail+0x0C, tail+0x0E)`.
            # -1 means no cue, and only three spawns in the game set one.
            #
            # Gated on the actor actually being a captor, not on its class.
            # Those bytes are a destination float, a waypoint, a pounce or a
            # grab for other states, and read blind they yield 333 "cues" of
            # which 330 are mantissa -- `path: 13107, frame: -16093` and the
            # like. Only a spawn with one of the two scripts reads them as a
            # camera cue at all.
            if tscript or ascript:
                cue_path = rec.param(0xC, "i16")
                if cue_path is not None and cue_path != -1:
                    camera_cue = {"path": cue_path,
                                  "frame": rec.param(0xE, "i16") or 0}
        placements.append(Placement(
            # -1, not None: a slot-drawn class has no character type and the
            # client's field is a number. The renderer skips these on the
            # `motion` test above it, so -1 never reaches a skeleton lookup.
            at, sp["class"], -1 if res.char_type is None else res.char_type,
            motion, sp, intro,
            emerge=emerge, delayed_leap=delayed_leap,
            target_script=tscript, attack_script=ascript,
            camera_cue=camera_cue,
            entry=entry,
            body_condition=tail[0], initial_state=tail[1],
            attack_state=tail[2], leap=leap, path=path,
            walk_distance=walk_distance, entrance_motion=entrance_motion,
            stand_throw=stand_throw,
            init_flags=int(sp.get("flags") or 0),
            pounce=pounce, grab=grab, back_away_delay=back_away_delay,
            cue=cue, leap_strike_frames=leap_strike_frames,
            ring_set=(RING_SET_FOR_CHAR0 if res.char_type == 0 else 0),
            class20=class20,
            class52=class52,
            class53=class53,
            class14=class14,
            class33=class33,
            hp=sp.get("hp", 0)))
        if motion is None:
            continue                      # marker only -- see the module note
        if res.char_type not in chars:
            built = build(stage, tables, res.char_type, res.asset_file)
            if built is None:
                continue
            chars[res.char_type] = built
        c = chars[res.char_type]
        # The death set is authored against zom.bin's skeleton. `bake` drops
        # it for any character whose bone count differs, so the list is offered
        # unconditionally and filtered by the data rather than by a constant.
        # `DEATH_RIGHT` and `DEATH_LEFT` are not in `dset` -- they are `.text`
        # immediates and live in `web/src/game/combat/resolve_hit.ts` now --
        # but the exporter still has to *bake* the clips they name, so it
        # reads them from `combat` directly. See `docs/formats/bundle.md`.
        deaths = (list(dset["front"]) + list(dset["back"])
                  + [DEATH_RIGHT, DEATH_LEFT])
        # The stumble set, same reasoning as the deaths: authored for the
        # 16-bone humanoid skeleton, so baked only for those.
        # Every clip the states can reach. No bone-count guard is needed here:
        # `bake` refuses a motion whose own block implies a different
        # skeleton, so a table row naming another creature's clip -- which the
        # shared, condition-indexed throw table does -- simply does not bake.
        reacts = sorted({m for row in c.reactions.values() for m in row})
        for row in c.attacks.values():
            for e in row.values():
                reacts += [e["strike"], e["lunge"]]
        for hands in (c.throw or {}).get("hands", {}).values():
            reacts += [h["motion"] for h in hands]
        # The whole row the five ported states reach: 0/1 the walk
        # `ZombieStateApproach` and `ZombieStateHoldAtRange` play, **2/3 the
        # run `ZombieStateAttackRun` plays**, and the back-away
        # `ZombieStateBackOff` plays. Baking only 0, 1 and the back-away --
        # which this did, from when the approach was believed to do the
        # walking -- leaves the attack run with no clip, and since the closing
        # is that clip's own root motion, the zombies never advanced.
        for row in c.motion_row.values():
            reacts += [row[i] for i in (0, 1, 2, 3, MOTION_ROW_BACKOFF)
                       if i < len(row) and 0 < row[i] < 4096]
        # The entrance clips a class-0x31 descriptor names for itself, plus
        # every clip its behaviour set can reach: the idle and walk pair, the
        # eight stumbles, and the arc motion scripts behind each attack and
        # each surface leap. `bake` refuses a clip authored for another
        # skeleton, so the list is offered whole rather than filtered here.
        entry_clips = [p.entrance_motion for p in placements
                       if p.at == at and p.entrance_motion] \
                    + [p.pounce["motion"] for p in placements
                       if p.at == at and p.pounce] \
                    + [p.cue["motion"] for p in placements
                       if p.at == at and p.cue]
        if sp["class"] == 0x31:
            entry_clips += class31_motion_ids(class31)
        if sp["class"] == 0x19:
            entry_clips += list(BOSS4_CLIPS)
        # The stage-2 boss's whole bank -- see `CLASS14_MOTIONS`.
        if sp["class"] == 0x14:
            entry_clips += list(CLASS14_MOTIONS)
        # Class 0x10 chooses its clips from the **exe's** command streams, and
        # from every stream those can branch to: ops 0x0E/0x0F/0x1E/0x1F carry
        # pointers to further streams, and a civilian that is shot spends the
        # rest of its life in one of them. Baking only the opening motion left
        # every civilian frozen in its idle the moment its script moved on.
        # The captor family's own clips: a zombie that walks at a civilian and
        # then mauls it plays motions its general row never names, and an
        # unbaked clip is an actor frozen mid-script.
        # The emerge clip, the submerged pose it holds first, and the two
        # clips the delayed leap plays. An unbaked entrance is an actor
        # standing in the water.
        if emerge:
            entry_clips += [emerge["motion"], 0xB9]
        if delayed_leap:
            entry_clips += [0x3BB, 0x399, 0x3F7]
        # The twelve entrance states' own clips. Every one of these states
        # measures its exit on the **play clock** of a clip it names, so an
        # unbaked clip is not a cosmetic gap: `MotionPlayLength` is 0, the
        # cursor never reaches the last frame, and the actor waits for ever.
        # That is exactly what `tools/entrances.mjs` caught for states 13, 24
        # and 30 -- 984, 1010 and 927 were named by the descriptor and baked
        # for nobody.
        if entry:
            entry_clips += [entry.get(k) for k in
                            ("motion", "idle_motion", "strike_motion")]
            if tail[1] == 13:
                # Chosen by character type, not named in the tail -- see
                # `ZombieStateSurfaceOnCameraCue`.
                entry_clips += [0xB8, 0x3D8]
            if tail[1] == 23:
                # The paired wait/grab clips: it plays 0xBB and blends 0xBA.
                entry_clips += [0xBA, 0xBB]
            if tail[1] == 30:
                # The crouch and the three arc-script stages, both by type.
                entry_clips += [0x10C, 0x39F]
                for a30 in CLASS30_ARC_SCRIPTS.values():
                    entry_clips += [st["motion"]
                                    for st in (arc_script(tables, a30) or [])]
        # `ActorSnapToGroundHeight` routes an actor over a drop into state 11,
        # whose landing clip is 0x3BA -- and every class-0x30 actor can now
        # reach it, so it is baked for all of them.
        entry_clips += [0x3BA]
        # Class 0x25's own clips: the ones its command block names with `op 2`
        # and `op 3`, which is every clip the program can put on the actor
        # after the opening one. Baking only the header's motion left 118 of
        # the six stages' 263 (program, clip) pairs with no frames, and a
        # class-0x25 actor whose clip has none is not merely undrawn -- its
        # `op 1` mode 2 wait on the clip's last frame can never fire, so the
        # VM parks and the skeleton holds one pose for the rest of the stage.
        if sp["class"] == 0x25:
            entry_clips += humanoid_motion_ids(prog.evt, rec)
        # Class 0x20's four idles -- `OneHitTargetInit` picks between them with
        # `rand() & 3`, so all four have to exist before the draw is made --
        # and the clip `OneHitTargetUpdate` cues the frame the actor is shot.
        if sp["class"] == 0x20:
            entry_clips += list(CLASS20_IDLE_MOTIONS) + [CLASS20_DEATH_MOTION]
        entry_clips += target_script_motions(tscript)
        entry_clips += target_script_motions(ascript)
        if sp["class"] == 0x10:
            entry_clips += civilian_motion_ids(
                civscripts, rec.param(0x01, "i8") or 0)
            chars[res.char_type].held_slots.update(
                civilian_item_slots(civscripts, rec.param(0x01, "i8") or 0))
        for mid in ([motion, intro[0] if intro else None]
                    + deaths + reacts + entry_clips):
            if mid is None or mid in c.motions:
                continue
            baked = bake(stage.game, tables, mid, c.bone_count)
            if baked is not None:
                c.motions[mid] = baked
        if motion not in c.motions:
            continue
        per_type.setdefault(res.char_type, []).append(sp)

    entries = [rig_entry(stage, tables, chars[ct], sps, pose_frame,
                          pose_motion)
               for ct, sps in sorted(per_type.items()) if ct in chars]
    # One hidden template per character type carrying its damaged parts. The
    # client clones from it on a hit -- emitting them on all 108 instances
    # instead would multiply the geometry for something only a few bones ever
    # show.
    # **The gate asks `gore_entry` rather than guessing what it will emit.**
    # It used to test `gore or held_slots`, and every time something new
    # started riding this rig the gate was left behind: gating on `gore` alone
    # left every held item with nothing to clone from, and adding `held_slots`
    # then left every *head* with nothing to clone from once the severed head
    # started cloning the pristine head model. A gate that enumerates a subset
    # of what the body uses will be wrong again the next time the body grows.
    #
    # `gore_entry` already returns None when it has no parts, so asking it is
    # both cheaper to keep correct and exactly as selective.
    entries += [gore_entry(stage, tables, chars[ct])
                for ct in sorted(per_type) if ct in chars]
    return chars, placements, [e for e in entries if e]


def characters_json(chars: dict[int, Character],
                    placements: list[Placement], tables=None) -> dict:
    """The `characters` block of ``<stage>.script.json``."""
    posed = sum(1 for p in placements if p.motion is not None)
    return {
        "deaths": death_motions(tables) if tables is not None else {},
        "difficulty": difficulty_tables(tables) if tables is not None else {},
        "combat": combat_tables(tables) if tables is not None else {},
        "reaction_groups": reaction_groups(tables) if tables is not None else [],
        "approach": approach_tables(tables) if tables is not None else {},
        "tracking": camera_tracking(tables) if tables is not None else {},
        "player": player_damage(),
        "bone_zones": bone_zones(tables) if tables is not None else [],
        "class31": class31_tables(tables) if tables is not None else {},
        "types": {str(ct): c.to_json() for ct, c in sorted(chars.items())},
        "placements": [p.to_json() for p in placements],
        "note": (
            "A character is assembled from the EXE skeleton and posed from a "
            "mot/ frame. Bind pose is not a rest pose -- every bone offset "
            "runs along its own local X, so an unposed character is a heap of "
            "parts. Only classes whose handler has been read get a motion "
            "rule, so the rest keep their spawn marker: "
            f"{posed} of {len(placements)} identified spawns are posed."),
    }
