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

**[open] The waist is missing on the humanoids.** Assembled and posed,
`char_adv00`'s torso (bone 1) occupies ``y 0.25..4.25`` and its pelvis (bone 9)
``-3.55..-0.96``, leaving a 1.2-unit hole where an abdomen should be. This is
not a client bug -- it is in `export_character.py`'s output too -- and it is not
a broken parent chain: the two are separate roots in the EXE skeleton, which is
what `FUN_00410590` iterates.

What is known: `char_adv00.bin` holds 113 models and the skeleton names only
15, and the unused ones include slot ``0x1F02``, which sits *between* the bone
slots ``0x1F00, 0x1F01, 0x1F03, 0x1F06 ...``. Those interleaved gaps are most
likely the shot-off damage variants class 0x30 switches between, not a missing
limb. `FUN_004107E0` writes exactly one slot per bone into the draw record and
`FUN_00411050` draws that one slot, so the game really does draw 15 parts.

The untested lead is the second per-bone table `FUN_004107E0` consults:
``PTR_DAT_004D032C[char_type]``, stride ``0x14``, indexed ``bone - 1``. It
compares its first word against the node's asset slot and, on a match, copies
three more words plus a scale into the draw record. What those are has not been
established. The cat is unaffected -- 18 models, 18 bones, a clean 1:1 -- so
whatever this is, it is a humanoid thing.
"""

from __future__ import annotations

import math
import struct
from dataclasses import dataclass, field

from . import mot as motlib, spawnres

__all__ = ["MOTION_RULES", "Character", "Placement", "resolve_for_stage"]


#: How each class chooses the motion it starts in, from its handler.
#:
#: ``("table", base, stride, at, kind)`` reads the spawn's parameter tail at
#: *at* as *kind* to get a variant, then takes the ``u16`` at
#: ``base + variant * stride``. ``("literal", id)`` is a constant,
#: ``("param", at, kind)`` is read straight from the tail, and
#: ``("block", ptr_at, field)`` follows a pointer in the tail to a command
#: block and reads a ``s16`` from it.
#:
#: Class ``0x30`` -- the zombie, and the single largest population in the game
#: -- is `FUN_00452DA0`, which opens with the assignment::
#:
#:     if (obj[0x130C] == 4) obj[0x1B4] = 0x41E;   /* 1054, hzom.bin */
#:     else                  obj[0x1B4] = 0x3BC;   /*  956,  zom.bin */
#:
#: Both are real ids in real zombie banks, which is the corroboration. The
#: ``0x41E`` branch tests a field the allocator fills differently per spawn
#: opcode and is **not** taken here: 956 is the common path, and guessing the
#: rarer one wrong would be worse than always taking the default. Every
#: class-0x30 character type is 16-bone, so one motion serves all the skins --
#: which is what a shared `zom.bin` implies anyway.
#:
#: Class ``0x53`` -- the cat -- is `FUN_00431250`::
#:
#:     psVar2 = obj->params;                       /* obj+0x1390 */
#:     obj[0x6d] = *(short *)(0x00589A64 + *psVar2 * 10);   /* obj+0x1B4 */
#:
#: The table is five ``u16`` per variant, ``0xFFFF``-terminated -- a little
#: playlist -- and the handler takes the first. Every id in it falls inside
#: `nya.bin`'s 762..773, which is the corroboration that it is a motion table
#: and not something else with a convenient stride.
#: ``("by_char", {char_type: id}, default)`` is a constant chosen by the
#: character type, which is how `EnemyThrowerInit` does it:
#: ``obj+0x1B4 = (char == 0x17) ? 0x1BA : 0x3A8``. Same shape as
#: `EnemyZombieInit`'s, which is why class 0x30's is a plain literal.
MOTION_RULES: dict[int, tuple] = {
    # `SetPiecePropInit` (`FUN_00482CE0`) reads the motion straight out of the
    # parameter tail -- `obj+0x1B4 = (s16)tail+0x0A` -- with no variant table in
    # between. Without this rule the 48 set-piece props resolve to a character
    # with no motion, and the client skips anything it cannot pose.
    0x24: ("param", 0x0A, "i16"),
    # `ScriptedHumanoidInit` (`FUN_004840D0`) follows a pointer: the tail at
    # `+0x0C` names a command block, and the block's `+0x04` is the motion the
    # actor opens in. 137 of these, and without a rule they resolve to a
    # character the client cannot pose and so does not draw.
    0x25: ("block", 0x0C, 0x04),
    # `CivilianInit` (`FUN_0048A3E0`) writes `model+0x20 = 0x294` -- motion
    # **660**, from `people.bin` -- before it runs a line of script, and the
    # script's op 0x00 takes over from there. Without a rule the 47 civilians
    # resolved to a character with no motion and the client drew none of them,
    # so the whole class was invisible even once it was ported.
    0x10: ("literal", 0x294),
    0x30: ("literal", 0x3BC),
    0x31: ("by_char", {0x17: 0x1BA}, 0x3A8),
    0x53: ("table", 0x00589A64, 10, 0x00, "i16"),
}

#: `mot/` is authored at 30 Hz against the engine's 60 Hz clock -- see the note
#: on `g_motion_play_length` in docs/formats/mot.md, which runs at about twice
#: the frame count. The exact relation is open, so this is stated as the
#: playback rate rather than baked into the frame data.
MOTION_FPS = 30.0

#: Class 0x30's parameter tail also carries a **scripted entrance**.
#:
#: ``FUN_00452DA0`` copies ``params[2]`` to ``obj+0x1310``, which is the index
#: `FUN_004533F0` dispatches through the 54-state table at ``0x00592AE8``. State
#: **21** (`FUN_004577F0`) is a one-shot motion cue::
#:
#:     if (sub == 0) {
#:         PlayMotion(obj+0x194, params[+0x04]);   /* the entrance motion */
#:         obj[0x1330] = params[+0x08];            /* a start delay */
#:         sub++;
#:     }
#:     if (sub <= 1 && --obj[0x1330] > 0) return;  /* hold */
#:     if (obj[0x19C] >= play_length[obj[0x1B4]] - 1) {
#:         obj[0x1310] = params[3];                /* then this state */
#:         if (params[3] == 21) obj[0x1310] = 1;   /* 21 means "walk" */
#:     }
#:
#: The two zombies inside the stage-2 van are exactly this: state 21, motion
#: **923** from `zom.bin`, delays of **0 and 10 frames** so they come out one
#: after the other, then state 1. Motion 923 is a jump: its root translation
#: runs z 0 to -15.7 while y arcs 8.2 to 17.4 and back, which is a body
#: leaving a van and landing. The idle 956 has z = 0 and a flat y throughout.
#:
#: `[open]` whether the delay also freezes the animation. It gates the state
#: *transition* and clears bit 0x4000 of ``obj+0x34`` when it expires, which
#: reads like an animation-paused bit, but that is not established. Holding the
#: first frame for the delay is what reproduces the stagger, and that is what is
#: done here.
MOTION_STATE_CUE = 21

#: More than this and a bake is not worth its bytes; the longest motion in the
#: game is well inside it.
MAX_BAKED_FRAMES = 600

#: `PTR_DAT_004D032C[char_type]`, stride 0x14 indexed ``bone - 1``:
#: ``{u32 slot; f32 centre[3]; f32 radius}``. The per-bone hit sphere the shot
#: test uses -- see docs/formats/combat.md.
HIT_SPHERES = 0x004D032C
#: `PTR_DAT_004C8350[char_type]`: ``u16[bone][6]``, damage for each successive
#: hit on that bone.
HIT_DAMAGE = 0x004C8350
#: `PTR_DAT_004C7160[char_type]`: ``u16[bone][6]``, the asset slot the bone is
#: redrawn with after each hit -- the gore swap.
HIT_EFFECT = 0x004C7160
#: Steps per bone in both tables.
HIT_STEPS = 6

#: `PTR_DAT_004D0D84[char_type]`: ``s8[bone][16]``, added to the table damage.
#: Indexed by :data:`DAMAGE_RANK`, **not** by the menu difficulty.
HIT_DAMAGE_RANK = 0x004D0D84
#: Ranks in that table.
HIT_RANKS = 16

#: `DAT_004C4D18`: ``u8[16]``, bone -> the bit `RemoveBoneSubtree` sets in the
#: actor's destroyed-zone mask at ``obj+0x1318``. 0xFF means "no zone" -- the
#: shift is masked with 0x1F, so those land on bit 31 and mean nothing.
BONE_ZONE = 0x004C4D18

#: `DAT_005776B0`: ``s32[5]``, added to a spawn's hit points by
#: `ActorInitHitPoints` (`FUN_0040A8B0`) and then clamped to ``[1, 300]``.
DIFFICULTY_HP_DELTA = 0x005776B0
#: `DAT_005679F4`: ``s8[5]``, difficulty -> the rank `ResetDamageRank` starts
#: the game at. `UpdateDamageRank` then moves it within ``[0, 15]``.
INITIAL_DAMAGE_RANK = 0x005679F4
#: What `GetDamageRank` returns for a normal-difficulty start, which is what
#: the player uses because it has no adaptive-difficulty state to track.
DEFAULT_DIFFICULTY = 2

#: `PTR_PTR_00592FC8[char_type]` -> ``motion*[variant][group]``: the **stumble**
#: an actor plays when a shot hurts it but does not kill it. Read from
#: `ActorPlayHitReaction` (`FUN_004544C0`), which indexes it by the actor's
#: body condition (``obj+0x130C``) and then by the reaction *group* of the bone
#: that was hit.
HIT_REACT_TABLE = 0x00592FC8
#: Not really an alternate reaction table: this is the character's **general
#: motion row**, per body condition, and several states index it directly.
#:
#: ===== =========================================================
#: index what reads it
#: ===== =========================================================
#: 0, 1  `ZombieStateApproach` -- the two walk variants, picked by
#:       ``obj+0x136C`` bit 21
#: 2, 3  `ZombieStateAttackRun` -- the run, picked by bit 27
#: 4     `ZombieStateBackOff` -- the **back-away** walk, and also the
#:       zone-0 entry of the reaction set `FUN_004547C0` reads at
#:       ``+0x10 + zone*4``
#: ===== =========================================================
HIT_REACT_ALT_TABLE = 0x00592CBC
#: How many entries of that row to export.
MOTION_ROW_LEN = 8
#: Index 4: the clip `ZombieStateBackOff` plays while retreating.
MOTION_ROW_BACKOFF = 4
#: `DAT_004C84A8`: ``u16[16]``, bone -> reaction group. Eight groups, and they
#: partition the body exactly the way you would draw it:
#: 1 head, 2 torso, 3 right arm, 4 left arm, 5 pelvis, 6 right leg, 7 left leg.
REACT_GROUP = 0x004C84A8
#: Groups in a reaction row.
REACT_GROUPS = 8
#: How far before a pointer table its variant arrays are packed. They are
#: contiguous with it, so this only has to be generous, not exact.
ARRAY_BLOCK = 0x1000
#: `ActorPlayHitReaction` cross-fades over this many frames, +1, into the
#: actor's second motion track -- 20 when the hit severed something
#: (``obj+0x1364 == 3``) and 10 otherwise. Bones **9 and above** skip the
#: fade entirely: `ActorSetMotion` hard-sets the leg reaction.
REACT_BLEND = 10
REACT_BLEND_SEVER = 20
#: The bone below which the reaction is cross-faded rather than hard-set.
REACT_BLEND_MAX_BONE = 9

#: `DAT_004C4CD0`: four ``{inner, mid, outer}`` f32 ring sets, copied into
#: `g_enemy_approach_rings` by the scene reset (`FUN_0045EEC0`). No stage script
#: uses evt `0x0E`, the opcode that would override them, so these constants are
#: what every encounter in the game actually runs on.
APPROACH_RING_DEFAULTS = 0x004C4CD0
APPROACH_RING_SETS = 4
#: `FUN_00408D60`: ``base``, and what is added in the middle and outer bands.
#: Overridden by evt `0x0F` (54 uses) and `0x12` (6 uses, +1 in two-player).
APPROACH_STEP_DEFAULTS = (2, 3, 4)
#: `EnemyZombieInit`: character type 0 uses ring set 2, everything else set 0.
RING_SET_FOR_CHAR0 = 2

#: `PTR_DAT_00576C04`: four 64-byte turn-rate curves, indexed by the angle
#: between where the camera looks and where it wants to look, clamped to
#: :data:`TURN_ERROR_CLAMP` and shifted right 7. The scene reset picks curve
#: **1**. A larger value is a *slower* turn: `TurnLookAtToward` steps
#: ``1 / (1 + rate)`` of the remaining angle.
TURN_RATE_CURVES = 0x00576C04
TURN_RATE_CURVE_COUNT = 4
TURN_RATE_CURVE_LEN = 64
TURN_CURVE_DEFAULT = 1
#: 0x1FFF BAMS = 45 degrees; the curve covers exactly that.
TURN_ERROR_CLAMP = 0x1FFF
#: Rate used when nothing is being tracked -- the first byte of curve 2.
TURN_RATE_UNTRACKED = 12
#: `TurnLookAtToward` re-emits the look-at this far from the eye.
LOOKAT_RADIUS = 100.0

#: `RegisterForCameraTracking`: the sort key is ``|actor - eye| * 10`` as an
#: int, radix-sorted ascending -- nearest first.
CAMERA_TRACK_DISTANCE_SCALE = 10.0
#: Slots 0 and 1 are reserved for enemies holding an attack permit;
#: `ClaimCameraEnemySlot` fills 2..13 with everyone else.
CAMERA_ATTACK_SLOTS = 2
CAMERA_SLOTS = 16
CAMERA_MAX_CANDIDATES = 14
#: `TurnActorTowardCamera` faces this far in front of the camera, not the eye.
ACTOR_FACE_OFFSET = 1.5

#: `PTR_PTR_00592F18[char][body_condition]` -> 0x10-byte attack entries, read
#: by `ZombieStateStrike` (`FUN_00455A40`) and `ActorStrikeConnect`:
#:
#: ===== ==== ==========================================================
#: +0x00 s16  the strike motion
#: +0x02 s16  the lunge motion, played while still beyond *distance*
#: +0x04 f32  distance inside which the strike starts
#: +0x08 s16  the frame of the strike clip on which the hit lands
#: +0x0A s16  the motion the *player* plays when hit
#: +0x0C u16  cancel mask -- if every zone named here is destroyed, the
#:            strike whiffs. 1 head, 2 right arm, 4 left arm; 8 is
#:            outside the 3-bit zone mask, so it means "never cancelled"
#: ===== ==== ==========================================================
ATTACK_TABLE = 0x00592F18
ATTACK_ENTRY = 0x10
#: A hard cap on the entry scan. The real end comes from the next row's
#: address -- the rows are adjacent with no count, exactly like the reaction
#: variant arrays, and scanning a fixed number reads the next row's attacks as
#: this one's. That produced "hits on frame 40 of a 20-frame clip".
ATTACK_MAX = 16

#: `PTR_PTR_00592DC0[char][cond]`: which attack to use, as
#: ``picks[(rand/16 % 10) + (destroyed_zones & 7) * 10]`` -- ten choices for
#: each combination of destroyed zones, so a zombie that has lost an arm draws
#: from a different set.
ATTACK_PICK_TABLE = 0x00592DC0
ATTACK_PICK_PER_ZONE = 10
ATTACK_ZONE_COMBOS = 8

#: `PlayerTakeDamage` (`FUN_00415300`). A strike costs exactly one life --
#: there is no variable damage against the player.
PLAYER_LIFE_COST = 1
PLAYER_HIT_SCORE = -100
#: Frames of invulnerability after a hit (0x5A).
PLAYER_INVULN_FRAMES = 90
#: ...and the adaptive rank drops by this, which is how being hit makes the
#: game easier. `UpdateDamageRank` consumes it.
PLAYER_HIT_RANK_DELTA = -2
#: What the continue screen restores (`FUN_00497440`), and the player's default.
PLAYER_START_LIVES = 2

#: `PTR_DAT_00592A00[body_condition]` -> two 0x10-byte entries, the same layout
#: as :data:`ATTACK_TABLE`, read by `ThrowerStateThrow` (`FUN_0044FAF0`).
#: Entry 0 is the right hand (bone 5), entry 1 the left (bone 8), and `+0x08`
#: is the frame of the throw clip on which the weapon leaves the hand.
THROW_TABLE = 0x00592A00
THROW_CONDITIONS = 4

#: `EnemyThrowerInit` and `SpawnThrownWeapon` name these outright, per
#: character type. *held* is what the hand draws while armed, *bare* what it
#: drops to once thrown, and *projectile* the model that flies.
THROWER_SLOTS = {
    0x16: {                                    # zsass.bin
        5: {"held": 0x1FA2, "bare": 0x1F9F, "projectile": 0x1F91},
        8: {"held": 0x1F9E, "bare": 0x1F9B, "projectile": 0x1F90},
        "spin": 0x600,
    },
    0x18: {                                    # held slots come from the skeleton
        5: {"held": None, "bare": 0x1FF1, "projectile": 0x1FE2},
        8: {"held": None, "bare": 0x1FED, "projectile": 0x1FE1},
        "spin": 0,
    },
}

#: `ThrownWeaponFlyToTarget`. The weapon flies **straight** at a constant
#: 1.2 units per frame -- ``ttl = distance * 0.8333333`` and
#: ``velocity = (target - position) / ttl`` -- and when the timer runs out it
#: calls `PlayerTakeDamage` outright. There is no collision test: the hit is
#: timed, exactly like the melee strike's hit frame.
THROW_SPEED = 1.2
#: `AimThrownWeapon`: the target is this far in front of the camera, and in
#: two-player it is offset sideways by 0.6 per player.
THROW_AIM_AHEAD = 4.0
THROW_AIM_SIDE = 0.6
#: Frames the weapon sticks in view, then blinks, before despawning.
THROW_STICK_FRAMES = 30
THROW_BLINK_FRAMES = 60

#: `DAT_00577674`: the sound ids `ActorPlayHitVoice` (`FUN_0040A6F0`) picks
#: from. Fifteen dwords -- five flesh impacts, then six voice ids in
#: ``(set A, set B)`` pairs, then two two-entry pools. Read as ids and resolved
#: through `g_se_name_list`, so the names below are the game's own filenames.
HIT_VOICE_TABLE = 0x00577674

#: Character types that take **voice set A**. `ActorPlayHitVoice` switches on
#: ``obj+0x1F4`` and everything not listed here takes set B.
VOICE_SET_A_TYPES = (0, 2, 5, 6, 9, 0x0E, 0x0F, 0x10, 0x11)

#: `FUN_00407950`, material -> the ricochet sound the impact plays. The names
#: are what makes the material codes readable: SND sand, MET metal, OTH other,
#: WAT water, WOD wood. Materials 4 and 0x36 are silent, and the default arm
#: is silent too -- a shot into untagged geometry makes no noise.
RICOCHET_BY_MATERIAL = {
    0x01: 0x1316A9, 0x33: 0x1316A9,     # COMMON\BULLET_SND1_16.WAV
    0x02: 0x0E16A9, 0x34: 0x0E16A9,     # COMMON\BULLET_MET1_16.WAV
    0x03: 0x1216A9, 0x35: 0x1216A9,     # COMMON\BULLET_OTH1_16.WAV
    0x05: 0x1416A9, 0x37: 0x1416A9,     # COMMON\BULLET_WAT1_16.WAV
    0x06: 0x1516A9, 0x38: 0x1516A9,     # COMMON\BULLET_WOD1_16.WAV
    0x44: 0x0B16A9, 0x53: 0x0B16A9,     # COMMON\BOMB1_11.WAV
    0x45: 0x0B16A9,
    0x61: 0x0C16A9, 0x62: 0x0C16A9,     # COMMON\BOMB2_16.WAV
}

#: `FUN_004073B0`, material -> ``(first_texture, last_texture, scale)``. The
#: impact is an **animated sprite**: it runs the texture ids from first to last
#: and dies. The default arm -- an untagged surface -- is a single frame at
#: 0.1 scale, which is why a shot into scenery the level did not tag barely
#: shows.
IMPACT_SPRITE_BY_MATERIAL = {
    0x01: (0x091A, 0x092F, 1.0), 0x33: (0x091A, 0x092F, 1.0),
    0x02: (0x0DC3, 0x0DD1, 1.0), 0x34: (0x0DC3, 0x0DD1, 1.0),
    0x03: (0x0E25, 0x0E33, 1.0), 0x35: (0x0E25, 0x0E33, 1.0),
    0x52: (0x0E25, 0x0E33, 1.0),
    0x05: (0x08F8, 0x0903, 4.0), 0x37: (0x08F8, 0x0903, 4.0),
    0x06: (0x0904, 0x0919, 1.0), 0x38: (0x0904, 0x0919, 1.0),
    0x41: (0x0DD7, 0x0E22, 1.0),
    0x44: (0x0FD4, 0x1031, 1.0),
    0x45: (0x174A, 0x1785, 1.0),
    0x46: (0x0094, 0x00A2, 0.7), 0x4B: (0x0094, 0x00A2, 0.7),
    0x50: (0x023A, 0x0248, 1.0),
    0x51: (0x0054, 0x0062, 1.0),
    0x53: (0x0125, 0x013D, 1.0),
    0x61: (0x1339, 0x1356, 1.0), 0x62: (0x1339, 0x1356, 1.5),
    0x63: (0x091A, 0x092F, 5.0),
}
#: The default arm of that switch.
IMPACT_SPRITE_DEFAULT = (0x0904, 0x0904, 0.1)

#: `ActorShotFeedback` (`FUN_00454050`) -- the blood spray's scale by hit
#: result, and the ricochet a result-5 hit plays instead of blood.
BLOOD_SCALE_BY_RESULT = {1: 0.75, 2: 0.5, 3: 1.0, 4: 1.0}
#: Result 5 -- the shot did nothing. Character type 2 gets its own ricochet.
NO_EFFECT_RICOCHET = 0x1116A9          # COMMON\BULLET_MET3_22.WAV
NO_EFFECT_RICOCHET_TYPE2 = 0x0F16A9    # COMMON\BULLET_MET2_16.WAV
#: ...and the impact sprite material it spawns, 0x51 for character type 3.
NO_EFFECT_MATERIAL = 3
NO_EFFECT_MATERIAL_TYPE3 = 0x51

#: How a dying actor picks its animation, from `FUN_004560B0` -> `FUN_00456220`.
#:
#: The general case is **directional**. `FUN_00456220` takes
#: ``camera_yaw - actor_yaw`` and tests it against four +/-45 degree arcs with
#: `FUN_0040A040(angle, centre, 0x2000)`::
#:
#:     arc 0x0000  -> a random pick from DAT_0059309C[4]
#:     arc 0x4000  -> motion 992
#:     arc 0x8000  -> a random pick from DAT_00593084[6]
#:     arc 0xC000  -> motion 991
#:
#: The arcs are named here by their **angle**, not "front" and "back", because
#: which is which depends on two conventions at once: the camera yaw is the
#: direction from target to eye (`FUN_00403AC0`), and a character model faces
#: its local -Z. Working both through, an actor facing the camera lands in the
#: 0x8000 arc.
#:
#: What the *data* says is unambiguous and is the useful half: the 0x0000
#: table's motions carry the root -8.7, -9.5, -9.3 in z and the 0x8000 table's
#: carry it +7.4, +8.2, +2.5. Since the model faces -Z, negative z is forward,
#: so one set falls the way it is facing and the other falls back over. A body
#: falls away from whatever shot it.
#:
#: `FUN_004560B0` overrides this when a specific part has been destroyed
#: (`obj+0x1368` bits 8, 0x10, 0x40, 0x80 -> motions 428, 421, 633, 553) and for
#: some spawn variants; those are **not** implemented, so a character whose arm
#: has come off still plays a directional death rather than the special one.
DEATH_FRONT = 0x0059309C
DEATH_BACK = 0x00593084
DEATH_RIGHT = 992
DEATH_LEFT = 991
#: `0x2000` BAMS = 45 degrees, the half-width of each arc.
DEATH_ARC = 0x2000

#: The spawn's authored yaw is used **as written**. There is no half turn.
#:
#: An earlier revision added 0x8000 here on the strength of a measurement:
#: comparing every class-0x30 spawn's yaw against the direction to the nearest
#: camera eye, a raw reading appeared to leave 149 of 203 zombies facing away.
#: That measurement was unsound -- the nearest sample on a rail the camera
#: travels *past* is often behind the spawn -- and the conclusion drawn from it
#: was wrong. The chain is right as it stands, at every step:
#:
#: * `FUN_004088A0` copies ``desc+0x14/18/1C`` straight to ``obj+0x64/68/6C``;
#: * `FUN_00410590` feeds those to ``RotX; RotY; RotZ``;
#: * `MatrixRotateY` builds ``x' = c*x + s*z, z' = -s*x + c*z``, which is
#:   three.js's Y rotation exactly;
#: * `FUN_004016B0`, which is what produces every angle in the game, is
#:   ``yaw = atan2(dx, dz)``, so a yaw of theta names the direction
#:   ``(sin theta, 0, cos theta)``;
#: * the camera's own matrix is ``T(eye); RotZ(roll); RotY(yaw); RotX(pitch)``
#:   with ``yaw`` taken from ``eye - target`` -- so the game's camera looks down
#:   its local **-Z** on a right-handed basis, which is three.js's convention
#:   too. The scene is not mirrored.
#:
#: What settles the facing is the geometry, not an angle. Posed at motion 956
#: frame 0, `char_adv00`'s toe reaches world ``z = -2.47`` against a heel at
#: ``+0.88``, and the head's face juts to ``z = -1.48``: a posed character
#: faces **-Z**. ``RotY(theta)`` maps ``-Z`` to ``theta + 180``, so the
#: authored yaw already aims a character where the designer pointed it, and
#: adding a half turn aims it backwards.



@dataclass
class Character:
    """One character type, assembled and ready to pose."""

    char_type: int
    name: str                       #: pol file stem, e.g. ``cat``
    file: str                       #: ``cat.bin``
    bone_count: int                 #: motion frame stride, from the EXE
    #: One per skeleton node, parents first, as
    #: ``{"bone", "part", "slot", "offset", "parent"}``.
    bones: list[dict] = field(default_factory=list)
    #: ``{motion_id: {"bank", "frames", "root", "rot"}}``
    motions: dict[int, dict] = field(default_factory=dict)
    #: Asset slots the skeleton does not name -- see :func:`extra_parts`.
    extras: list[int] = field(default_factory=list)
    #: ``{slot: {"centre", "radius"}}`` for the damaged variants.
    gore: dict = field(default_factory=dict)
    #: `ResolveHit`'s torso stage count -- see :func:`torso_stage_count`.
    torso_stages: int = 0
    #: Asset slots this character's class-0x10 scripts can put in its hand --
    #: ops 0x13, 0x14 and 0x15. They ride the hidden gore template, which is
    #: what the client clones a held model from.
    held_slots: set = field(default_factory=set)
    #: ``obj+0x124``, from `g_actor_radius_by_char` (0x004C4D28). This is the
    #: radius `ShotTestSphere` (`FUN_00404630`) uses for an actor that is *not*
    #: shot per bone -- which is every class-0x10 civilian, since none of them
    #: ever raises `obj+0x34` bit 0x80. Ten units for all of them.
    actor_radius: float = 0.0
    #: ``{body_condition: [motion per reaction group]}`` -- see
    #: :func:`hit_reactions`.
    reactions: dict = field(default_factory=dict)
    #: ``{body_condition: [attack, ...]}`` -- see :func:`attack_tables`.
    attacks: dict = field(default_factory=dict)
    #: ``{body_condition: [80 pick indices]}`` -- see :func:`attack_picks`.
    attack_picks: dict = field(default_factory=dict)
    #: The thrown-weapon attack, or None -- see :func:`throw_tables`.
    throw: dict | None = None
    #: ``{body_condition: [motion, ...]}`` -- see :func:`motion_row`. Index 4
    #: is the back-away walk `ZombieStateBackOff` plays.
    motion_row: dict = field(default_factory=dict)

    def to_json(self) -> dict:
        return {
            "type": self.char_type,
            "name": self.name,
            "file": self.file,
            "bone_count": self.bone_count,
            "bones": self.bones,
            "extras": [f"0x{s:04X}" for s in self.extras],
            "gore": {str(k): v for k, v in self.gore.items()},
            # Bone 2 is the head on every 15-bone humanoid, and the head is
            # what the score model keys on; carried rather than assumed by
            # the client.
            "head_bone": 2,
            "torso_stages": self.torso_stages,
            "actor_radius": self.actor_radius,
            "reactions": {str(k): v for k, v in self.reactions.items()},
            "attacks": {str(k): {str(i): a for i, a in v.items()}
                        for k, v in self.attacks.items()},
            "attack_picks": {str(k): v for k, v in self.attack_picks.items()},
            "motion_row": {str(k): v for k, v in self.motion_row.items()},
            "backoff_index": MOTION_ROW_BACKOFF,
            "throw": (None if not self.throw else
                      {**self.throw,
                       "hands": {str(k): v
                                 for k, v in self.throw["hands"].items()}}),
            "motions": {str(k): v for k, v in self.motions.items()},
        }


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
        if self.target_script:
            d["target_script"] = self.target_script
        if self.attack_script:
            d["attack_script"] = self.attack_script
        if self.leap:
            d["leap"] = self.leap
        if self.path:
            d["path"] = self.path
        if self.walk_distance is not None:
            d["walk_distance"] = self.walk_distance
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


_BAMS = math.tau / 65536.0


def rot_matrix(bams) -> list[list[float]]:
    """``Rz(rz) @ Ry(ry) @ Rx(rx)`` -- the engine's order, as a 3x3."""
    ax, ay, az = (v * _BAMS for v in bams)
    ca, sa = math.cos(ax), math.sin(ax)
    cb, sb = math.cos(ay), math.sin(ay)
    cc, sc = math.cos(az), math.sin(az)
    return [
        [cc * cb, cc * sb * sa - sc * ca, cc * sb * ca + sc * sa],
        [sc * cb, sc * sb * sa + cc * ca, sc * sb * ca - cc * sa],
        [-sb,     cb * sa,                cb * ca],
    ]


def bams_from_matrix(M) -> tuple[int, int, int]:
    """Inverse of :func:`_rot`: a 3x3 back to a BAMS ``(rx, ry, rz)`` triple."""
    sb = max(-1.0, min(1.0, -M[2][0]))
    ay = math.asin(sb)
    if abs(M[2][0]) < 0.999999:
        ax = math.atan2(M[2][1], M[2][2])
        az = math.atan2(M[1][0], M[0][0])
    else:                                   # gimbal lock: fold into rx
        ax = math.atan2(-M[1][2], M[1][1])
        az = 0.0
    return tuple(int(round(v / _BAMS)) & 0xFFFF for v in (ax, ay, az))


def compose_bams(outer, inner) -> tuple[int, int, int]:
    """The BAMS triple equivalent to applying *outer* then *inner*."""
    A, B = rot_matrix(outer), rot_matrix(inner)
    return bams_from_matrix([[sum(A[i][k] * B[k][j] for k in range(3))
                      for j in range(3)] for i in range(3)])


def motion_for(tables, spawn_rec, cls: int) -> int | None:
    """The motion id a class handler starts this spawn in, or None."""
    rule = MOTION_RULES.get(cls)
    if rule is None:
        return None
    if rule[0] == "literal":
        return rule[1]
    if rule[0] == "block":
        _, ptr_at, field = rule
        evt = getattr(spawn_rec, "evt", None)
        if evt is None:
            return None
        raw = evt.raw
        base = spawn_rec.offset + 0x24 + ptr_at
        if base + 4 > len(raw):
            return None
        off = evt.to_offset(struct.unpack_from("<I", raw, base)[0])
        if off is None or off + field + 2 > len(raw):
            return None
        mid = struct.unpack_from("<h", raw, off + field)[0]
        return None if mid <= 0 else mid
    if rule[0] == "param":
        mid = spawn_rec.param(rule[1], rule[2])
        return None if mid is None or mid <= 0 else mid
    if rule[0] == "by_char":
        _, per_char, default = rule
        ct = spawn_rec.param(0x00, "i8")
        return per_char.get(ct, default)
    if rule[0] != "table":
        return None
    _, base, stride, at, kind = rule
    variant = spawn_rec.param(at, kind)
    if variant is None or variant < 0:
        return None
    r = tables._v2r(base + variant * stride)
    if r is None or r + 2 > len(tables.data):
        return None
    mid = struct.unpack_from("<H", tables.data, r)[0]
    return None if mid == 0xFFFF else mid


def intro_for(tables, spawn_rec, cls: int) -> tuple[int, int] | None:
    """A scripted entrance motion and its delay, or None."""
    if cls != 0x30:
        return None
    if spawn_rec.param(2, "i8") != MOTION_STATE_CUE:
        return None
    motion = spawn_rec.param(0x04, "i32")
    delay = spawn_rec.param(0x08, "i32") or 0
    bank = tables.motion_bank_of(motion) if motion and motion > 0 else None
    if bank is None or bank not in tables.motion_banks():
        return None
    return (motion, max(0, delay))


def _bake(game_dir, tables, motion_id: int, bone_count: int) -> dict | None:
    """Decode a motion into flat arrays the client can index cheaply."""
    bank_id = tables.motion_bank_of(motion_id)
    banks = tables.motion_banks()
    if bank_id not in banks:
        return None
    fname, ids = banks[bank_id]
    bank = motlib.load_bank(game_dir, fname, ids)
    if bank is None:
        return None
    # A motion belongs to the skeleton its own block size implies. Reading it
    # at any other stride walks into the next motion's data and returns
    # plausible-looking garbage rather than failing -- which is how `kame.bin`
    # motion 441, a 24-bone clip, reached a 16-bone character's bundle as
    # denormals and a NaN. This is the check the old `bone_count == 16` guards
    # were standing in for, stated directly.
    implied = bank.implied_bone_count(motion_id)
    if implied is not None and implied != bone_count:
        return None
    frames = bank.frames(motion_id, bone_count)
    if not frames:
        return None
    frames = frames[:MAX_BAKED_FRAMES]
    root: list[float] = []
    rot: list[int] = []
    for f in frames:
        root.extend(f.root)
        for b in f.bones:
            rot.extend(b)
    # A motion read with the wrong bone count decodes into whatever follows it
    # in the bank, which shows up as denormals and NaN rather than as an error.
    # Motion 441 of `kame.bin` reached the stage-2 bundle that way and made the
    # JSON unparseable. Refuse it here: a motion whose root is not finite was
    # not read correctly, whatever the stride said.
    if not all(math.isfinite(v) for v in root):
        return None
    return {"bank": fname, "frames": len(frames), "fps": MOTION_FPS,
            "root": root, "rot": rot}


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
        except Exception:
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
    except Exception:
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
                "civilian_child": rec.offset,
            })

    chars: dict[int, Character] = {}
    placements: list[Placement] = []
    class31 = class31_tables(tables)
    try:
        civscripts = tables.civilian_scripts()
    except Exception:
        civscripts = {"entries": [], "scripts": []}
    per_type: dict[int, list[dict]] = {}
    dset = death_motions(tables)

    for at, sp in sorted(by_at.items()):
        rec = recs.get(at)
        if rec is None:
            continue
        res = spawnres.resolve_spawn(tables, rec)
        if not res.identified or res.char_type is None:
            continue
        motion = motion_for(tables, rec, sp["class"])
        intro = intro_for(tables, rec, sp["class"])
        # The descriptor tail, as `EnemyZombieInit` (class 0x30) and
        # `EnemyThrowerInit` (class 0x31) read it: byte +1 is the body
        # condition, +2 the state the actor starts in, +3 the state a
        # permit-winner enters. Both inits do
        # `obj[0x130C] = d[1]; obj[0x1310] = d[2]`, so both classes get it;
        # every other class gets zeroes rather than a guess.
        tail = ((rec.param(1, "i8") or 0, rec.param(2, "i8") or 0,
                 rec.param(3, "i8") or 0)
                if sp["class"] in (0x30, 0x31) else (0, 0, 0))
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
        tscript = ascript = None
        if sp["class"] == 0x30:
            tscript = target_script(prog, prog.evt.to_offset(
                rec.param(4, "u32") or 0), tail[1])
            ascript = target_script(prog, prog.evt.to_offset(
                rec.param(8, "u32") or 0), tail[2])
        placements.append(Placement(
            at, sp["class"], res.char_type, motion, sp, intro,
            emerge=emerge, delayed_leap=delayed_leap,
            target_script=tscript, attack_script=ascript,
            body_condition=tail[0], initial_state=tail[1],
            attack_state=tail[2], leap=leap, path=path,
            walk_distance=walk_distance, entrance_motion=entrance_motion,
            pounce=pounce, grab=grab, back_away_delay=back_away_delay,
            cue=cue, leap_strike_frames=leap_strike_frames,
            ring_set=(RING_SET_FOR_CHAR0 if res.char_type == 0 else 0),
            hp=sp.get("hp", 0)))
        if motion is None:
            continue                      # marker only -- see the module note
        if res.char_type not in chars:
            built = _build(stage, tables, res.char_type, res.asset_file)
            if built is None:
                continue
            chars[res.char_type] = built
        c = chars[res.char_type]
        # The death set is authored against zom.bin's skeleton. `_bake` drops
        # it for any character whose bone count differs, so the list is offered
        # unconditionally and filtered by the data rather than by a constant.
        deaths = (list(dset["front"]) + list(dset["back"])
                  + [dset["right"], dset["left"]])
        # The stumble set, same reasoning as the deaths: authored for the
        # 16-bone humanoid skeleton, so baked only for those.
        # Every clip the states can reach. No bone-count guard is needed here:
        # `_bake` refuses a motion whose own block implies a different
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
        # each surface leap. `_bake` refuses a clip authored for another
        # skeleton, so the list is offered whole rather than filtered here.
        entry_clips = [p.entrance_motion for p in placements
                       if p.at == at and p.entrance_motion] \
                    + [p.pounce["motion"] for p in placements
                       if p.at == at and p.pounce] \
                    + [p.cue["motion"] for p in placements
                       if p.at == at and p.cue]
        if sp["class"] == 0x31:
            entry_clips += class31_motion_ids(class31)
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
        # `ActorSnapToGroundHeight` routes an actor over a drop into state 11,
        # whose landing clip is 0x3BA -- and every class-0x30 actor can now
        # reach it, so it is baked for all of them.
        entry_clips += [0x3BA]
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
            baked = _bake(stage.game, tables, mid, c.bone_count)
            if baked is not None:
                c.motions[mid] = baked
        if motion not in c.motions:
            continue
        per_type.setdefault(res.char_type, []).append(sp)

    entries = [_rig_entry(stage, tables, chars[ct], sps, pose_frame,
                          pose_motion)
               for ct, sps in sorted(per_type.items()) if ct in chars]
    # One hidden template per character type carrying its damaged parts. The
    # client clones from it on a hit -- emitting them on all 108 instances
    # instead would multiply the geometry for something only a few bones ever
    # show.
    # The gate is not `gore` alone: a class-0x10 civilian has no damaged parts
    # at all and still needs a template, because the models it holds ride the
    # same hidden rig. Gating on gore left every held item with nothing to
    # clone from.
    entries += [_gore_entry(stage, tables, chars[ct])
                for ct in sorted(per_type)
                if ct in chars and (chars[ct].gore or chars[ct].held_slots)]
    return chars, placements, [e for e in entries if e]


#: `PTR_DAT_0052ED08[char_type]` -> ``{u32 count; u32 *descriptors[]}``, each
#: descriptor's first word an asset slot.
#:
#: These are the parts a character draws that its **skeleton does not name**,
#: and without them a humanoid has a hole where its waist should be: the torso
#: mesh stops at ``y = 0.29`` and the pelvis starts at ``-0.98``, which is the
#: 1.2-unit gap between chest and belt. `char_adv00`'s single extra is slot
#: ``0x1F02`` -- model 99, ``y -0.09..1.69`` -- and dropped in at the second
#: root it closes that gap exactly.
#:
#: The split identified it: **every humanoid has one or two, and the cat has
#: none**, which is the same split as the gap. 68 of the 76 character types
#: with a skeleton carry at least one.
#:
#: The descriptor has four more fields -- two pointers to blocks 0x2D8 bytes
#: apart, a count, and a byte array reading
#: ``ff ff ff ff ff ff ff ff 0a 0b 0c 0d 0e 0f 16 17`` -- which look like
#: per-vertex skinning against several bones. That is **not** decoded, so the
#: part is attached rigidly here. See :func:`_second_root`.
EXTRA_PARTS = 0x0052ED08


def extra_parts(tables, char_type: int) -> list[int]:
    """Asset slots a character draws that its skeleton does not name."""
    base = tables._v2r(EXTRA_PARTS)
    if base is None or not (0 <= char_type < 0x100):
        return []
    blk = tables._v2r(struct.unpack_from("<I", tables.data,
                                         base + char_type * 4)[0])
    if blk is None or blk + 8 > len(tables.data):
        return []
    count, arr = struct.unpack_from("<2I", tables.data, blk)
    ao = tables._v2r(arr)
    if ao is None or not (0 < count < 16):
        return []
    out = []
    for i in range(count):
        d = tables._v2r(struct.unpack_from("<I", tables.data, ao + i * 4)[0])
        if d is None or d + 4 > len(tables.data):
            continue
        out.append(struct.unpack_from("<I", tables.data, d)[0])
    return out


def _second_root(bones: list[dict]) -> dict | None:
    """The pelvis root, which is what an extra part hangs off.

    Every character in the game has exactly two root nodes -- an upper body at
    bone 1 and a lower body whose bone index is 9 for the 15-bone humanoids but
    4, 10, 12 or 20 for the wings, `curien` and the HOD1 bosses. So the rule is
    structural, not the number 9.

    Verified by rendering: `char_adv00` with its extra part on the second root
    matches the game exactly, and on the *first* root the waist gap is still
    there.
    """
    roots = [b for b in bones if b["parent"] is None]
    return roots[1] if len(roots) > 1 else (roots[0] if roots else None)


def _u16_table(tables, base: int, char_type: int, bone: int) -> list[int]:
    """One bone's six-step row from a per-character ``u16[bone][6]`` table."""
    b = tables._v2r(base)
    if b is None:
        return []
    p = tables._v2r(struct.unpack_from("<I", tables.data, b + char_type * 4)[0])
    if p is None:
        return []
    o = p + bone * HIT_STEPS * 2
    if o + HIT_STEPS * 2 > len(tables.data):
        return []
    return list(struct.unpack_from(f"<{HIT_STEPS}H", tables.data, o))


def _u16_flat(tables, base: int, char_type: int, count: int) -> list[int]:
    """*count* u16s from the head of a per-character table, as one flat array.

    The six-step rows are read flat on purpose. `ResolveHit` computes
    ``i = bone*6 + n`` and then reads **both** ``[i]`` and ``[i + 1]``, so the
    last step of every bone takes its control code from the *next* bone's row.
    Splitting the table into rows first would quietly lose that.
    """
    b = tables._v2r(base)
    if b is None:
        return []
    p = tables._v2r(struct.unpack_from("<I", tables.data, b + char_type * 4)[0])
    if p is None or p + count * 2 > len(tables.data):
        return []
    return list(struct.unpack_from(f"<{count}H", tables.data, p))


def hit_steps(tables, char_type: int, bone: int) -> list[list[int]]:
    """The six ``[slot, code, damage]`` steps `ResolveHit` walks for one bone.

    *slot* is what the bone is redrawn with, *damage* what the hit costs, and
    *code* is the **next** entry in the effect table -- which `FUN_00409430`
    branches on rather than treating as a slot:

    ===== =========================================================
    code  what the hit does
    ===== =========================================================
    0     last step. Damage; swap once and latch; no dismemberment.
    1     **sever**. Damage, swap this bone, and remove every bone
          below it (`SeverBoneChildren` -> `RemoveBoneSubtree`).
    2     nothing at all -- no damage and no score.
    >2    escalate: damage, swap, and advance to the next step.
    ===== =========================================================

    For ``char_adv00`` code 1 sits at step 5 of bones 3, 4, 6, 7, 10, 11, 13
    and 14 -- the upper arms, forearms, thighs and shins, and nothing else.
    A limb comes off on the fifth hit, not the first.
    """
    n = tables.character_bone_count(char_type) or 0
    span = (n + 2) * HIT_STEPS
    eff = _u16_flat(tables, HIT_EFFECT, char_type, span)
    dmg = _u16_flat(tables, HIT_DAMAGE, char_type, span)
    if not eff:
        return []
    out = []
    for i in range(HIT_STEPS):
        j = bone * HIT_STEPS + i
        if j + 1 >= len(eff):
            break
        out.append([eff[j], eff[j + 1], dmg[j] if j < len(dmg) else 0])
    return out


def motion_row(tables, char_type: int) -> dict[int, list[int]]:
    """``{body_condition: [motion, ...]}`` from :data:`HIT_REACT_ALT_TABLE`."""
    out: dict[int, list[int]] = {}
    for cond, row in enumerate(_bounded_ptr_array(tables, HIT_REACT_ALT_TABLE,
                                                  char_type)):
        o = tables._v2r(row)
        if o is None or o + MOTION_ROW_LEN * 4 > len(tables.data):
            continue
        out[cond] = list(struct.unpack_from(f"<{MOTION_ROW_LEN}I",
                                            tables.data, o))
    return out


def torso_stage_count(tables, char_type: int) -> int:
    """`ResolveHit`'s inline count of the torso's real gore stages.

    The default branch walks the effect table forward from bone 1 step 0 while
    the entries are greater than 2, and **withholds the last torso stage while
    the actor is still alive** (``if (count <= hits + 1) skip the swap``). So a
    zombie only ever shows its final torso wound once it is dead.
    """
    n = tables.character_bone_count(char_type) or 0
    eff = _u16_flat(tables, HIT_EFFECT, char_type, (n + 2) * HIT_STEPS)
    c = 0
    while HIT_STEPS + c < len(eff) and eff[HIT_STEPS + c] > 2:
        c += 1
    return c


def damage_rank_row(tables, char_type: int, bone: int) -> list[int]:
    """``s8[16]`` added to the table damage, one entry per adaptive rank."""
    b = tables._v2r(HIT_DAMAGE_RANK)
    if b is None:
        return []
    v = struct.unpack_from("<I", tables.data, b + char_type * 4)[0]
    p = tables._v2r(v) if v else None
    if p is None:
        return []
    o = p + bone * HIT_RANKS
    if o + HIT_RANKS > len(tables.data):
        return []
    return list(struct.unpack_from(f"<{HIT_RANKS}b", tables.data, o))


def bone_zones(tables) -> list[int]:
    """:data:`BONE_ZONE` -- bone to destroyed-zone bit, 0xFF for none."""
    o = tables._v2r(BONE_ZONE)
    if o is None:
        return []
    return list(struct.unpack_from("<16B", tables.data, o))


def _bounded_ptr_array(tables, base: int, char_type: int) -> list[int]:
    """The variant array for *char_type*, bounded by the next array's start.

    These arrays sit end to end with no count, so reading a fixed number of
    entries walks into the neighbour's -- which is exactly how a first pass at
    this reported a reaction set that belonged to another character.

    Two things bound it. The arrays are packed **immediately before the
    pointer table**, so an entry that does not point into that block is not a
    variant array at all and is rejected; and an array that is a variant array
    ends where the next one begins, or where the pointer table itself does,
    because the last one butts straight up against it.
    """
    b = tables._v2r(base)
    if b is None:
        return []
    lo = base - ARRAY_BLOCK
    tops: set[int] = set()
    for ct in range(160):
        v = struct.unpack_from("<I", tables.data, b + ct * 4)[0]
        if lo <= v < base and tables._v2r(v) is not None:
            tops.add(v)
    p = struct.unpack_from("<I", tables.data, b + char_type * 4)[0]
    if p not in tops:
        return []
    after = sorted(v for v in tops if v > p)
    end = after[0] if after else base
    o = tables._v2r(p)
    return list(struct.unpack_from(f"<{(end - p) // 4}I", tables.data, o))


def reaction_groups(tables) -> list[int]:
    """:data:`REACT_GROUP` -- bone to reaction group."""
    o = tables._v2r(REACT_GROUP)
    return list(struct.unpack_from("<16H", tables.data, o)) if o else []


def hit_reactions(tables, char_type: int) -> dict[int, list[int]]:
    """``{body_condition: [motion per reaction group]}`` for one character.

    Only two distinct rows exist for the humanoids. The ordinary one is::

        head 977   torso 982   r.arm 981   l.arm 979
        pelvis 974   r.leg 961   l.leg 960

    all 29 frames except the legs at 39 -- short one-shots, and plainly not
    the deaths, which run 74 to 161. The second row (motions 257-263, 43
    frames) is reached only at body condition 3.
    """
    out: dict[int, list[int]] = {}
    for variant, row in enumerate(_bounded_ptr_array(tables, HIT_REACT_TABLE,
                                                     char_type)):
        o = tables._v2r(row)
        if o is None or o + REACT_GROUPS * 4 > len(tables.data):
            continue
        out[variant] = list(struct.unpack_from(f"<{REACT_GROUPS}I",
                                               tables.data, o))
    return out


def attack_tables(tables, char_type: int) -> dict:
    """``{body_condition: {index: attack}}`` -- see :data:`ATTACK_TABLE`.

    Only the entries the **pick table names** are exported, because those are
    the only ones the game ever reads: `ZombieStateStrike` indexes with
    ``obj+0x131A``, which `attack_picks` supplies, and never scans. That also
    sidesteps the row-length problem -- the rows are adjacent with no count, so
    a fixed scan reads the next row's attacks as this one's, which is what
    produced entries "hitting on frame 40 of a 20-frame clip".

    Each entry is checked against its own strike clip before being kept: a hit
    frame at or past the clip's length means the entry was not really there.
    """
    o = tables._v2r(0x004E07D0)
    play = lambda m: struct.unpack_from("<h", tables.data, o + m * 2)[0]
    picks = attack_picks(tables, char_type)
    rows = _bounded_ptr_array(tables, ATTACK_TABLE, char_type)
    out: dict[int, dict[int, dict]] = {}
    for cond, row in enumerate(rows):
        base = tables._v2r(row)
        if base is None or cond not in picks:
            continue
        want = sorted({v for v in picks[cond] if 0 <= v < ATTACK_MAX})
        got: dict[int, dict] = {}
        for i in want:
            a = base + i * ATTACK_ENTRY
            if a + ATTACK_ENTRY > len(tables.data):
                continue
            strike, lunge = struct.unpack_from("<2h", tables.data, a)
            dist, = struct.unpack_from("<f", tables.data, a + 4)
            hit, dmot, mask = struct.unpack_from("<3h", tables.data, a + 8)
            if strike <= 0 or lunge <= 0:
                continue
            if not (0 <= hit < play(strike)) or not (0 < play(lunge) <= 400):
                continue
            got[i] = {"strike": strike, "lunge": lunge, "distance": dist,
                      "hit_frame": hit, "player_motion": dmot,
                      "cancel_mask": mask & 0xFFFF}
        if got:
            out[cond] = got
    return out


def throw_tables(tables, char_type: int) -> dict | None:
    """The thrown-weapon attack for one character type, or None.

    Only the types :data:`THROWER_SLOTS` names throw, because only those have
    a projectile model: `SpawnThrownWeapon` switches on the character type and
    does nothing for any other.
    """
    kit = THROWER_SLOTS.get(char_type)
    if kit is None:
        return None
    o = tables._v2r(0x004E07D0)
    play = lambda m: struct.unpack_from("<h", tables.data, o + m * 2)[0]
    b = tables._v2r(THROW_TABLE)
    out: dict[int, list] = {}
    for cond in range(THROW_CONDITIONS):
        ptr = struct.unpack_from("<I", tables.data, b + cond * 4)[0]
        q = tables._v2r(ptr)
        if q is None:
            continue
        hands = []
        for i, bone in enumerate((5, 8)):
            a = q + i * ATTACK_ENTRY
            motion, alt = struct.unpack_from("<2h", tables.data, a)
            rng, = struct.unpack_from("<f", tables.data, a + 4)
            rel, dmot, mask = struct.unpack_from("<3h", tables.data, a + 8)
            if motion <= 0 or not (0 <= rel < play(motion)):
                continue
            hands.append({"bone": bone, "motion": motion, "release_frame": rel,
                          "range": rng, "player_motion": dmot,
                          "cancel_mask": mask & 0xFFFF, **kit[bone]})
        if hands:
            out[cond] = hands
    if not out:
        return None
    return {"hands": out, "spin": kit["spin"],
            "speed": THROW_SPEED, "aim_ahead": THROW_AIM_AHEAD,
            "aim_side": THROW_AIM_SIDE,
            "stick_frames": THROW_STICK_FRAMES,
            "blink_frames": THROW_BLINK_FRAMES}


def attack_picks(tables, char_type: int) -> dict:
    """``{body_condition: [80 indices]}`` -- see :data:`ATTACK_PICK_TABLE`."""
    n = ATTACK_PICK_PER_ZONE * ATTACK_ZONE_COMBOS
    out: dict[int, list[int]] = {}
    for cond, row in enumerate(_bounded_ptr_array(tables, ATTACK_PICK_TABLE,
                                                  char_type)):
        o = tables._v2r(row)
        if o is None or o + n * 4 > len(tables.data):
            continue
        out[cond] = list(struct.unpack_from(f"<{n}i", tables.data, o))
    return out


def player_damage() -> dict:
    """`PlayerTakeDamage` -- one life, -100, 90 frames of invulnerability."""
    return {
        "life_cost": PLAYER_LIFE_COST,
        "score": PLAYER_HIT_SCORE,
        "invuln_frames": PLAYER_INVULN_FRAMES,
        "rank_delta": PLAYER_HIT_RANK_DELTA,
        "start_lives": PLAYER_START_LIVES,
    }


def approach_tables(tables) -> dict:
    """The advance rings and the step counts, with their defaults.

    `TestApproachRing` and `ZombieStateApproach` both measure the actor's
    distance **to the camera** and read the same three radii, so one table
    serves the walk-in and the attack run.
    """
    o = tables._v2r(APPROACH_RING_DEFAULTS)
    sets = []
    for i in range(APPROACH_RING_SETS):
        inner, mid, outer = struct.unpack_from("<3f", tables.data, o + i * 12)
        sets.append({"inner": inner, "mid": mid, "outer": outer})
    return {
        "rings": sets,
        "steps": {"base": APPROACH_STEP_DEFAULTS[0],
                  "mid_add": APPROACH_STEP_DEFAULTS[1],
                  "outer_add": APPROACH_STEP_DEFAULTS[2]},
        "ring_set_for_char0": RING_SET_FOR_CHAR0,
    }


def camera_tracking(tables) -> dict:
    """What the gameplay camera aims at, and how fast it turns.

    Three routines, all in docs/formats/combat.md §10: enemies register
    themselves nearest-first, `SelectCameraLookAtTarget` picks a point from the
    slot table, and `TurnLookAtToward` eases the camera onto it.
    """
    b = tables._v2r(TURN_RATE_CURVES)
    curves = []
    for i in range(TURN_RATE_CURVE_COUNT):
        ptr = struct.unpack_from("<I", tables.data, b + i * 4)[0]
        o = tables._v2r(ptr)
        curves.append(list(struct.unpack_from(f"<{TURN_RATE_CURVE_LEN}b",
                                              tables.data, o))
                      if o is not None else [])
    return {
        "curves": curves,
        "curve": TURN_CURVE_DEFAULT,
        "error_clamp": TURN_ERROR_CLAMP,
        "rate_untracked": TURN_RATE_UNTRACKED,
        "lookat_radius": LOOKAT_RADIUS,
        "distance_scale": CAMERA_TRACK_DISTANCE_SCALE,
        "attack_slots": CAMERA_ATTACK_SLOTS,
        "slots": CAMERA_SLOTS,
        "max_candidates": CAMERA_MAX_CANDIDATES,
        "face_offset": ACTOR_FACE_OFFSET,
    }


def combat_tables(tables) -> dict:
    """Every sound and sprite a shot can produce, with the names resolved.

    All of it is proved: `FUN_00407950` is a bare switch of `PlaySoundId`
    calls, `FUN_004073B0` a bare switch of texture ranges, and
    :data:`HIT_VOICE_TABLE` is read as sound ids and resolved through
    `g_se_name_list` -- so ``COMMON\\BULLET_WOD1_16.WAV`` sitting under
    material 6 is what proves material 6 is wood, rather than anyone guessing.
    """
    o = tables._v2r(HIT_VOICE_TABLE)
    v = list(struct.unpack_from("<15I", tables.data, o)) if o else [0] * 15
    se = tables.se_names()
    name = lambda i: se.get(i, "")
    named = lambda ids: [{"id": i, "file": name(i)} for i in ids]
    return {
        # `ActorPlayHitVoice`. `impact` plays on every hurt and every body
        # kill; `head` replaces it on a headshot kill.
        "impact": named(v[0:5]),
        "head_impact": named([0x0116A9, 0x0516A9]),
        "voice": {
            "hurt": named([v[5], v[6]]),
            "kill": named([v[7], v[8]]),
            "head": named([v[9], v[10]]),
        },
        "voice_set_a_types": list(VOICE_SET_A_TYPES),
        # `FUN_00407950` and `FUN_004073B0`, keyed by collision material.
        "ricochet": {str(k): {"id": i, "file": name(i)}
                     for k, i in sorted(RICOCHET_BY_MATERIAL.items())},
        "impact_sprite": {str(k): list(t)
                          for k, t in sorted(IMPACT_SPRITE_BY_MATERIAL.items())},
        "impact_sprite_default": list(IMPACT_SPRITE_DEFAULT),
        # `ActorShotFeedback`.
        "blood_scale": {str(k): s for k, s in BLOOD_SCALE_BY_RESULT.items()},
        "no_effect": {
            "sound": {"id": NO_EFFECT_RICOCHET,
                      "file": name(NO_EFFECT_RICOCHET)},
            "sound_type2": {"id": NO_EFFECT_RICOCHET_TYPE2,
                            "file": name(NO_EFFECT_RICOCHET_TYPE2)},
            "material": NO_EFFECT_MATERIAL,
            "material_type3": NO_EFFECT_MATERIAL_TYPE3,
        },
    }


def difficulty_tables(tables) -> dict:
    """The two difficulty tables `ActorInitHitPoints` and `ResetDamageRank` use."""
    a = tables._v2r(DIFFICULTY_HP_DELTA)
    b = tables._v2r(INITIAL_DAMAGE_RANK)
    return {
        "hp_delta": list(struct.unpack_from("<5i", tables.data, a)) if a else [],
        "initial_rank": list(struct.unpack_from("<5b", tables.data, b)) if b else [],
        "default": DEFAULT_DIFFICULTY,
        "hp_min": 1, "hp_max": 300,
    }


def death_motions(tables) -> dict:
    """The directional death set. See :data:`DEATH_FRONT`."""
    def rd(base, n):
        o = tables._v2r(base)
        if o is None:
            return []
        return list(struct.unpack_from(f"<{n}I", tables.data, o))
    return {"front": rd(DEATH_FRONT, 4), "back": rd(DEATH_BACK, 6),
            "right": DEATH_RIGHT, "left": DEATH_LEFT, "arc": DEATH_ARC}


def gore_parts(tables, char_type: int) -> dict:
    """The damaged-part spheres, keyed by asset slot.

    `FUN_004099A0` searches the **tail** of the same table the bone spheres come
    from: past ``bone_count - 1`` entries, ``{slot, centre, radius}`` again, and
    ``slot == -1`` ends it. So a gore part carries the sphere of the part it
    replaces, which is how a half-destroyed limb keeps a sensible hit volume.

    Bounded by the slots the zone table actually names, because a character with
    no gore -- the cat -- has no terminator either, and reading on walks into
    whatever follows.
    """
    named: set[int] = set()
    for bone in range(1, 64):
        for v in _u16_table(tables, HIT_EFFECT, char_type, bone):
            if v > 2:
                named.add(v)
    if not named:
        return {}
    b = tables._v2r(HIT_SPHERES)
    p = tables._v2r(struct.unpack_from("<I", tables.data, b + char_type * 4)[0])
    n = tables.character_bone_count(char_type)
    out: dict[int, dict] = {}
    for i in range(n - 1, n + 64):
        o = p + i * 0x14
        if o + 0x14 > len(tables.data):
            break
        slot, = struct.unpack_from("<i", tables.data, o)
        if slot == -1:
            break
        if slot not in named:
            continue
        cx, cy, cz, r = struct.unpack_from("<4f", tables.data, o + 4)
        out[slot] = {"centre": [cx, cy, cz], "radius": r}
    return out


def hit_sphere(tables, char_type: int, bone: int):
    """``(centre, radius)`` for one bone, or None when it has no sphere."""
    b = tables._v2r(HIT_SPHERES)
    if b is None or bone < 1:
        return None
    p = tables._v2r(struct.unpack_from("<I", tables.data, b + char_type * 4)[0])
    if p is None:
        return None
    o = p + (bone - 1) * 0x14
    if o + 0x14 > len(tables.data):
        return None
    cx, cy, cz, r = struct.unpack_from("<4f", tables.data, o + 4)
    return ((cx, cy, cz), r) if r > 0 else None


#: `g_actor_radius_by_char` -- one float per character type, copied to
#: ``obj+0x124`` by every Init that has one.
ACTOR_RADIUS_TABLE = 0x004C4D28


def actor_radius(tables, char_type: int) -> float:
    """``obj+0x124`` for a character type, or 0 when the table has no row."""
    v = tables._u32(ACTOR_RADIUS_TABLE + char_type * 4)
    if v is None:
        return 0.0
    r = struct.unpack("<f", struct.pack("<I", v))[0]
    return r if math.isfinite(r) and 0 < r < 1000 else 0.0


def _build(stage, tables, char_type: int, asset_file: str) -> Character | None:
    skel = tables.character_skeleton(char_type)
    if not skel:
        return None
    bones = []
    for n in skel:
        b = {"bone": n["bone"],
             "part": f"bone{n['bone']:02d}_{n['slot']:04x}",
             "slot": n["slot"],
             "offset": list(n["offset"]),
             "parent": n["parent"]}
        sph = hit_sphere(tables, char_type, n["bone"])
        if sph:
            b["hit_centre"] = list(sph[0])
            b["hit_radius"] = sph[1]
        # `[slot, code, damage]` per step, with the control codes intact. An
        # earlier revision folded 0/1/2 to 0 and trimmed the tail, which threw
        # away the sever code entirely -- so a limb was reskinned on the first
        # hit and never came off. See :func:`hit_steps`.
        steps = hit_steps(tables, char_type, n["bone"])
        while steps and steps[-1][0] == 0 and steps[-1][1] == 0 \
                and steps[-1][2] == 0:
            steps.pop()
        if steps:
            b["steps"] = steps
        rank = damage_rank_row(tables, char_type, n["bone"])
        if any(rank):
            b["damage_rank"] = rank
        bones.append(b)
    return Character(char_type=char_type,
                     name=asset_file.removesuffix(".bin"),
                     file=asset_file,
                     bone_count=tables.character_bone_count(char_type),
                     bones=bones,
                     extras=extra_parts(tables, char_type),
                     gore=gore_parts(tables, char_type),
                     torso_stages=torso_stage_count(tables, char_type),
                     actor_radius=actor_radius(tables, char_type),
                     reactions=hit_reactions(tables, char_type),
                     attacks=attack_tables(tables, char_type),
                     attack_picks=attack_picks(tables, char_type),
                     throw=throw_tables(tables, char_type),
                     motion_row=motion_row(tables, char_type))


def _rig_entry(stage, tables, char: Character, spawns: list[dict],
               pose_frame: int | None = None,
               pose_motion: int | None = None) -> dict | None:
    """A `gltf.export_level` rig entry: the skeleton, placed at every spawn.

    *pose_frame* bakes a motion frame into the parts instead of leaving them at
    bind. The browser poses at runtime and does not want this; a still render
    for verification does, because bind is a heap of parts and proves nothing.

    The bake folds the frame's root translation into the root bones. That is
    exact only while bone 0 carries no rotation -- it does not for every motion,
    so a non-zero bone 0 is refused rather than approximated.
    """
    from . import rigs as rigslib, stage as stagelib

    try:
        models, bank = stagelib.load_asset(stage.game, char.name)
    except Exception:
        return None
    slots = tables.asset_slots()

    pose = None
    if pose_frame is not None and char.motions:
        mid = (pose_motion if pose_motion in char.motions
               else next(iter(char.motions)))
        m = char.motions[mid]
        f = max(0, min(pose_frame, m["frames"] - 1))
        n = char.bone_count
        pose = {b: tuple(m["rot"][f * n * 3 + b * 3: f * n * 3 + b * 3 + 3])
                for b in range(n)}
        # Bone 0 sits between the object and the skeleton, and the rig writer
        # has no node there, so it is composed into each root bone -- exactly,
        # not approximated: the rotation multiplies and the root translation is
        # carried through it.
        root = m["root"][f * 3: f * 3 + 3]
        R0 = rot_matrix(pose[0])

    parts: list[tuple] = []
    for i, b in enumerate(char.bones):
        offset = list(b["offset"])
        rot = pose[b["bone"]] if pose else (0, 0, 0)
        if pose is not None and b["parent"] is None:
            offset = [sum(R0[i][k] * offset[k] for k in range(3)) + root[i]
                      for i in range(3)]
            rot = compose_bams(pose[0], rot)
        part = rigslib.RigPart(
            b["part"], (b["slot"],),
            translation=tuple(offset),
            # Bind pose unless a frame was asked for. The client overwrites
            # every bone from the motion each frame; this is what the file
            # loads as.
            rotation_bams=rot,
            parent=(char.bones[b["parent"]]["part"]
                    if b["parent"] is not None else ""),
            note=f"bone {b['bone']} of character type {char.char_type:#04x}")
        rec = slots.get(b["slot"])
        idx = rec[1] if rec else None
        model = models[idx] if idx is not None and idx < len(models) else None
        parts.append((part, [(model, bank, char.name)] if model else []))

    # The parts the skeleton does not name, hung off the second root with no
    # transform of their own. They are deliberately NOT added to
    # ``Character.bones``: the client poses by bone index, and an extra part
    # has none -- it rides its parent, which is what rigid attachment means.
    host = _second_root(char.bones)
    for i, slot in enumerate(char.extras):
        rec = slots.get(slot)
        idx = rec[1] if rec else None
        model = models[idx] if idx is not None and idx < len(models) else None
        if model is None:
            continue
        parts.append((rigslib.RigPart(
            f"extra{i}_{slot:04x}", (slot,),
            parent=host["part"] if host else "",
            note=f"part {i} of character type {char.char_type:#04x}'s extra "
                 f"list; the skeleton does not name it"),
            [(model, bank, char.name)]))

    rig = rigslib.Rig(
        name=f"chr_{char.name}",
        routine=f"character type {char.char_type:#04x}",
        world_space=False,
        spawn_class=None,
        parts=tuple(p for p, _ in parts),
        note="skeleton from the EXE; posed per frame from mot/")
    return {"rig": rig, "routes": [], "anchors": {}, "biases": {},
            "fixed": [], "world": False, "placements": spawns,
            "blocked": "", "parts": [(p, m) for p, m in parts if m]}


def _gore_entry(stage, tables, char: Character) -> dict | None:
    """A hidden rig holding one part per damaged variant, for the client to clone."""
    from . import rigs as rigslib, stage as stagelib

    slots = tables.asset_slots()
    cache: dict[str, tuple] = {}
    parts: list[tuple] = []
    # The thrower's projectile and its two hand states ride in the same hidden
    # rig: the client clones by asset slot either way, and neither the held
    # hand nor the weapon in flight is named by the skeleton.
    want = set(char.gore)
    # Class 0x10's held items ride here too, for the same reason the thrower's
    # hands do: the client clones by asset slot, and the skeleton names none of
    # them.
    want.update(char.held_slots)
    for hands in (char.throw or {}).get("hands", {}).values():
        for h in hands:
            want.update(v for v in (h["held"], h["bare"], h["projectile"])
                        if v)
    for slot in sorted(want):
        rec = slots.get(slot)
        if not rec:
            continue
        stem = rec[0].removesuffix(".bin")
        if stem not in cache:
            try:
                cache[stem] = stagelib.load_asset(stage.game, stem)
            except Exception:
                cache[stem] = ([], None)
        models, bank = cache[stem]
        if rec[1] >= len(models):
            continue
        part = rigslib.RigPart(f"gore_{slot:04x}", (slot,),
                               note=f"damaged variant, slot {slot:#06x}")
        parts.append((part, [(models[rec[1]], bank, stem)]))
    if not parts:
        return None
    rig = rigslib.Rig(name=f"gore_{char.name}",
                      routine=f"character type {char.char_type:#04x}",
                      world_space=False, parts=tuple(p for p, _ in parts),
                      note="damaged parts; hidden, cloned onto a bone when hit")
    return {"rig": rig, "routes": [], "anchors": {}, "biases": {},
            "world": False, "placements": [], "blocked": "",
            "fixed": [{"kind": "fixed", "translation": [0.0, 0.0, 0.0],
                       "rotation_bams": [0, 0, 0], "cam_paths": [],
                       "note": rig.note}],
            "parts": parts}


#: Class 0x31's own tables, four **behaviour sets** deep.
#:
#: Every one of these is indexed by ``obj+0x130C``, which `EnemyThrowerInit`
#: takes straight from the descriptor tail's byte +1 -- **not** by the body
#: condition (`ActorBodyConditionFromHands` has exactly one caller, and it is
#: class 0x30's state 2). Stage 2 gives the `zstin` spawns set 0 and the
#: `zsass` spawns set 1, and the motion sets identify the other two: set 2's
#: first entry is 0x1BA, the motion `EnemyThrowerInit` starts character type
#: 0x17 in, and set 3's clips are the 0x208 family that `ThrowerStateThrow`
#: and `ThrowerStateWaitForPermit` reach for when the character is 0x18.
#:
#: ==== ============== =============================================
#: set  character      how it fights
#: ==== ============== =============================================
#: 0    `zstin`        leaps at walls and the ceiling, then pounces
#: 1    `zsass`        throws
#: 2    `zskamere`     [open]
#: 3    `zslman`       [open]
#: ==== ============== =============================================
CLASS31_SETS = 4

#: ``PTR_DAT_005929F0[set]`` -> six motion ids:
#:
#: ===== ======================================================
#: index what reads it
#: ===== ======================================================
#: 0, 1  the stand `ThrowerStateWaitForPermit` picks between at
#:       random, and index 1 is also the pause
#:       `ThrowerStateStrikeOnTheSpot` plays between strikes
#: 2, 3  the walk/idle `ThrowerStateStandAndDecide` and
#:       `ThrowerStateWalkDistance` play, picked by
#:       ``obj+0x34`` bit 27
#: 4     the landing clip `ThrowerStateLeapAside` and
#:       `ThrowerStateWithdraw` play
#: 5     `[open]` -- no reader found
#: ===== ======================================================
CLASS31_MOTION_SETS = 0x005929F0
CLASS31_MOTION_SET_LEN = 6

#: ``PTR_PTR_00592A10[set]`` -> 0x10-byte attack entries, indexed
#: ``obj+0x131A + stance * 4``. `ThrowerStrikeConnect` reads the last three
#: fields and `ThrowerLoadAttackArcScript` the first:
#:
#: ===== ==== ====================================================
#: +0x00 u32  pointer to the three-stage arc motion script
#: +0x04 s32  frame of that clip on which the hit lands, or -1 for
#:            "when the arc reaches its landing phase"
#: +0x08 s32  the reaction the *player* plays when hit
#: +0x0C u32  cancel mask -- if every zone named here is destroyed
#:            the strike whiffs
#: ===== ==== ====================================================
CLASS31_ATTACK_TABLE = 0x00592A10
#: The stance rows: ``bit6 + 2*(bit7 + 2*bit17) + 3*bit8`` of ``obj+0x136C``,
#: so 0 the ground, 1 one wall, 2 the other, 3 the ceiling, and 4 the same
#: four again while a leap is in progress (bit 17). The rows are **not all the
#: same length** -- set 0 and set 3 carry five stances, sets 1 and 2 share a
#: single one -- and they sit end to end with no count, so the reader bounds
#: each row by the start of the next thing in the block. Reading a fixed eight
#: walks into the neighbour, which is the adjacent-array trap.
CLASS31_STANCES = 8
CLASS31_ATTACKS_PER_STANCE = 4

#: ``PTR_DAT_00592A20[set][(rand()>>4) % 10 + (obj+0x1318 & 7) * 10]`` -- which
#: attack index to use, by destroyed zones. The same shape as class 0x30's
#: :data:`ATTACK_PICK_TABLE`, read a byte at a time out of an int array.
CLASS31_ATTACK_PICKS = 0x00592A20

#: The same address as :data:`THROW_TABLE`, under the name the *melee* reader
#: uses. `ThrowerStateCloseAndStrike` (class 0x31 state 24) indexes it by
#: ``obj+0x131A`` and reads all four fields; `ThrowerStateThrow` reads entries 0
#: and 1 as the right and left hand. Eight entries a row.
CLASS31_THROW_TABLE = THROW_TABLE
CLASS31_THROW_ENTRIES = 8

#: ``PTR_PTR_00592A60[set]`` -> three band pointers, each to 80 ints laid out
#: ``[destroyed zones 0..7][10]``. `ThrowerPickNextState` draws a **state id**
#: out of it and offers it to `ThrowerTryEnterState`. Band 0 is never reached:
#: the router only ever produces band 1 (40 < d <= 50) or band 2.
CLASS31_STATE_PICKS = 0x00592A60
CLASS31_BANDS = 3
CLASS31_PICKS = ATTACK_PICK_PER_ZONE * ATTACK_ZONE_COMBOS

#: ``PTR_DAT_00592A70[set][g_react_group[bone]]`` -- the stumble, eight groups.
CLASS31_REACTIONS = 0x00592A70

#: The pose frame a class-0x31 corpse freezes on, keyed by the clip it died in.
#: `ThrowerStateCorpseSink` and `ThrowerStateCorpseBlink` pick between the two
#: entries with ``rand() % 17 >> 4``, so the second comes up once in seventeen.
#:
#: The general table at `g_class31_corpse_frames` (0x00592A80) covers motions
#: 0x3D9..0x3E0, and **class 0x31 never plays one of those** -- every use of it
#: reads outside the array. Only these four special cases are real, so only
#: these are exported and the port keeps the current frame otherwise.
CLASS31_CORPSE_FRAMES = {
    0x11E: 0x00592AD8,      # character 0x16's death clip
    0x11D: 0x00592AD0,      # ...0x18's and 0x19's
    0x1BC: 0x00592AC8,      # ...0x17's
    0x3A6: 0x00592AC0,      # the airborne clip of sets 0 and 3
}

#: A three-stage arc motion script, the 12 dwords `InstallArcMotionScript`
#: (`FUN_0044DA60`) copies into the actor's slot: ``{s32 motion, s32 start
#: frame, s32 fade, s32 threshold} x 3``. `ActorArcStep` plays stage 0 at the
#: start of the arc, stage 1 once the clip frame passes stage 0's threshold,
#: stage 2 once it passes stage 1's, and reports the arc over once it passes
#: stage 2's. Every script in the program names the **same motion** in all
#: three stages, so it is one clip cut into windup / flight / landing.
ARC_SCRIPT_STAGES = 3

#: The arc scripts that are named by a state rather than by an attack entry.
#: `ThrowerStateLeapAside` picks between the first four and
#: `ThrowerStateLeapToSurface` uses one per state id.
CLASS31_ARC_SCRIPTS = {
    "aside": 0x00564AC8,             # every character but 0x16 and 0x18
    "aside_attack3": 0x00564AF8,     # ...unless obj+0x131A is 3
    "aside_zsass": 0x005649A8,       # character type 0x16
    "aside_zslman": 0x00564D08,      # character type 0x18, then +0x60 a stance
    "wall_left": 0x00564A68,         # state 14
    "wall_right": 0x00564A38,        # state 15
    "ceiling": 0x00564A98,           # state 16
}
#: `ThrowerStateLeapAside`'s character-0x18 block is one script per stance.
CLASS31_ARC_SCRIPT_BYTES = ARC_SCRIPT_STAGES * 4 * 4


#: The motion ids class 0x31's states name as **literals** rather than through
#: a table, so nothing collects them from the data. Every one is read out of the
#: routine beside it; `_bake` refuses a clip that belongs to another skeleton,
#: so the whole list is offered to every class-0x31 character rather than
#: filtered here.
#:
#: Leaving these out is not a subtle failure: a `zstin` that leaps onto a wall
#: has no idle for the stance it arrives in, so `ThrowerSetMotionIfIdle`
#: refuses the clip and it holds whatever it was playing.
CLASS31_LITERAL_MOTIONS = {
    # `ThrowerStateStandAndDecide` (state 7): the idle per stance, and
    # character type 0x18's own three.
    0x138, 0x137, 0x131, 0x20F, 0x20C, 0x212,
    # `ThrowerStateWaitForPermit` (state 8), the same shape plus its default.
    0x129, 0x124, 0x134, 0x127, 0x208, 0x1FD, 0x1F3, 0x205,
    # `ThrowerStateLeapAside` (state 10), character 0x18's four.
    0x211, 0x20E, 0x214, 0x20B,
    # `ThrowerStateFallToSurface` (state 11): the fall and the two landings.
    # Each is a pair `(-(char != 0x17) & delta) + base`, so 0x3A5/0x3A9 for
    # every type but 0x17 and 0x1BC/0x1BA for that one -- and 0x1BC and 0x1BA
    # are bank 20, `zskamere`'s own, so `_bake` rightly refuses them elsewhere.
    0x1BC, 0x3A5, 0x1BA, 0x3A9,
    # State 3, the death clip, per character type.
    0x11E, 0x11D,
    # `ThrowerStateStrikeOnTheSpot` (state 32).
    0x1B8,
    # `ThrowerStateGrabPlayer` (state 27): the ride, the two grabs, the finish.
    0x1E9, 0x1E5, 0x1E7, 0x1E8,
    # `ThrowerStateKnockedTumbling` (state 33): the tumble and the get-up.
    0x215, 0x1FE, 0x1F4, 0x206, 0x216, 0x1FF, 0x1F5, 0x207,
    # `ThrowerStateThrow`'s character-0x18 branch.
    0x1F7, 0x1F6, 0x1FC, 0x1FB, 0x1F2, 0x1F1, 0x204, 0x203,
}


def _next_block(tables, base: int, count: int, after: int,
                this: int) -> int:
    """Where the row at *this* ends: the next row's start, or *after*'s first.

    The rows of these tables are packed end to end with no count, so a fixed
    length reads the neighbour's entries as if they were this row's -- which
    is exactly the adjacent-array trap. Bounding by the next start recovers
    set 0's five stances and sets 1 and 2's single one.
    """
    ends = set()
    for k in range(count):
        v = _ptr_row(tables, base, k)
        if v and v > this:
            ends.add(v)
        v = _ptr_row(tables, after, k)
        if v and v > this:
            ends.add(v)
    return min(ends) if ends else this


def _arc_script(tables, addr: int) -> list[dict] | None:
    """The 12 dwords at *addr* as three ``{motion, start, fade, until}`` stages."""
    o = tables._v2r(addr) if addr else None
    if o is None or o + CLASS31_ARC_SCRIPT_BYTES > len(tables.data):
        return None
    v = struct.unpack_from("<12i", tables.data, o)
    out = [{"motion": v[i * 4], "start": v[i * 4 + 1],
            "fade": v[i * 4 + 2], "until": v[i * 4 + 3]}
           for i in range(ARC_SCRIPT_STAGES)]
    return out if out[0]["motion"] > 0 else None


def _ptr_row(tables, base: int, i: int) -> int | None:
    o = tables._v2r(base)
    if o is None or o + (i + 1) * 4 > len(tables.data):
        return None
    return struct.unpack_from("<I", tables.data, o + i * 4)[0]


def class31_tables(tables) -> dict:
    """Class 0x31's four behaviour sets -- see :data:`CLASS31_SETS`.

    Everything here is read from the routine that consumes it, and the routine
    is named in each constant's own comment. The arc scripts are resolved and
    inlined rather than left as addresses, because the client has no way to
    dereference one.
    """
    if tables is None:
        return {}
    sets = []
    for i in range(CLASS31_SETS):
        row: dict = {"set": i}
        o = tables._v2r(_ptr_row(tables, CLASS31_MOTION_SETS, i) or 0)
        row["motions"] = (
            list(struct.unpack_from(f"<{CLASS31_MOTION_SET_LEN}i",
                                    tables.data, o)) if o is not None else [])
        # The attack entries, flattened to [stance][index] with the arc script
        # resolved in place. An entry whose script pointer is null is a hole --
        # the pick table never names it.
        ptr_row = _ptr_row(tables, CLASS31_ATTACK_TABLE, i) or 0
        o = tables._v2r(ptr_row)
        attacks: dict[str, dict[str, dict]] = {}
        if o is not None:
            n = min(CLASS31_STANCES * CLASS31_ATTACKS_PER_STANCE,
                    (_next_block(tables, CLASS31_ATTACK_TABLE, CLASS31_SETS,
                                 CLASS31_ATTACK_PICKS, ptr_row) - ptr_row)
                    // ATTACK_ENTRY)
            if n > 0 and o + n * ATTACK_ENTRY <= len(tables.data):
                for k in range(n):
                    ptr, hit, hurt, mask = struct.unpack_from(
                        "<IiiI", tables.data, o + k * ATTACK_ENTRY)
                    script = _arc_script(tables, ptr)
                    if script is None:
                        continue
                    stance, idx = divmod(k, CLASS31_ATTACKS_PER_STANCE)
                    attacks.setdefault(str(stance), {})[str(idx)] = {
                        "script": script, "hit_frame": hit,
                        "player_motion": hurt, "cancel_mask": mask & 0xFFFF}
        row["attacks"] = attacks
        # `g_class31_throws` in the raw, per set. `throw_tables` reads the same
        # two rows for the projectile, keyed by the hand; `ThrowerStateCloseAndStrike`
        # reads them as a **melee** attack -- strike clip, approach clip, the
        # distance it closes to, and the frame the hit lands on.
        ptr_throw = _ptr_row(tables, CLASS31_THROW_TABLE, i) or 0
        o = tables._v2r(ptr_throw)
        strikes: dict[str, dict] = {}
        if o is not None:
            n = min(CLASS31_THROW_ENTRIES,
                    (_next_block(tables, CLASS31_THROW_TABLE, CLASS31_SETS,
                                 CLASS31_ATTACK_TABLE, ptr_throw) - ptr_throw)
                    // ATTACK_ENTRY)
            for k in range(max(0, n)):
                a = o + k * ATTACK_ENTRY
                if a + ATTACK_ENTRY > len(tables.data):
                    break
                strike, lunge = struct.unpack_from("<2h", tables.data, a)
                dist, = struct.unpack_from("<f", tables.data, a + 4)
                hit, hurt, mask = struct.unpack_from("<3h", tables.data, a + 8)
                if strike <= 0:
                    continue
                strikes[str(k)] = {"strike": strike, "lunge": lunge,
                                   "distance": dist, "hit_frame": hit,
                                   "player_motion": hurt,
                                   "cancel_mask": mask & 0xFFFF}
        row["strikes"] = strikes
        o = tables._v2r(_ptr_row(tables, CLASS31_ATTACK_PICKS, i) or 0)
        row["attack_picks"] = (
            list(struct.unpack_from(f"<{CLASS31_PICKS}i", tables.data, o))
            if o is not None and o + CLASS31_PICKS * 4 <= len(tables.data)
            else [])
        # The state picks are a pointer to a pointer: one band pointer each.
        bands: dict[str, list[int]] = {}
        b = tables._v2r(_ptr_row(tables, CLASS31_STATE_PICKS, i) or 0)
        if b is not None:
            for band in range(CLASS31_BANDS):
                ptr, = struct.unpack_from("<I", tables.data, b + band * 4)
                o = tables._v2r(ptr)
                if o is None or o + CLASS31_PICKS * 4 > len(tables.data):
                    continue
                bands[str(band)] = list(struct.unpack_from(
                    f"<{CLASS31_PICKS}i", tables.data, o))
        row["state_picks"] = bands
        o = tables._v2r(_ptr_row(tables, CLASS31_REACTIONS, i) or 0)
        row["reactions"] = (
            list(struct.unpack_from(f"<{REACT_GROUPS}i", tables.data, o))
            if o is not None and o + REACT_GROUPS * 4 <= len(tables.data)
            else [])
        sets.append(row)

    corpse = {}
    for motion, addr in CLASS31_CORPSE_FRAMES.items():
        o = tables._v2r(addr)
        if o is not None and o + 8 <= len(tables.data):
            corpse[str(motion)] = list(struct.unpack_from("<2i", tables.data, o))

    scripts = {k: _arc_script(tables, a)
               for k, a in CLASS31_ARC_SCRIPTS.items() if k != "aside_zslman"}
    # Character 0x18's is four scripts, one per surface stance, so it goes in
    # flat rather than nested -- the client indexes it by name.
    for st in range(4):
        scripts[f"aside_zslman_{st}"] = _arc_script(
            tables, CLASS31_ARC_SCRIPTS["aside_zslman"]
            + st * CLASS31_ARC_SCRIPT_BYTES)
    return {"sets": sets, "corpse_frames": corpse,
            "scripts": {k: v for k, v in scripts.items() if v},
            "note": (
                "Class 0x31's behaviour, four sets deep, indexed by the "
                "descriptor tail's byte +1 (obj+0x130C). Set 0 is zstin, "
                "which is the wall-crawler.")}


#: The class-0x30 states that work on ``obj+0x1394`` -- the object the actor
#: was built for, which for the 47 class-0x10 captors is the civilian.
#:
#: Each takes a script through `ZombieScriptForState` (`FUN_0045CA10`): the
#: descriptor tail's `+0x08` when the actor is in the tail's attack state,
#: `+0x04` otherwise. The blob opens with a header whose shape belongs to the
#: state that *entered* it and continues as a list of motion entries, which
#: `ZombieStateTargetMotionScript` (state 35) steps whoever put the cursor
#: there. A list ends on the first entry whose motion is below 1.
#:
#: ``(header bytes, shorts per entry)``.
TARGET_SCRIPT_SHAPE: dict[int, tuple[int, int]] = {
    34: (10, 4),   # {f32 arrive_dist; u16 loops; u16 motion; u16 frame}
    35: (0, 4),    # straight into the entries
    36: (0, 5),    # ...with a g_script_flags index per entry
    37: (0x38, 4),  # the carried-prop record; [open] beyond its motion fields
    38: (20, 4),   # {f32 x, y, z; s16 motion, frame; s16 loops, mode}
    40: (16, 4),   # {f32 x, y, z; s16 motion, frame}
    41: (16, 4),   # the same, arrived at rather than walked past
    43: (4, 0),    # {s16 loops; s16 cue_frame} -- no list
}


def target_script(prog, off: int, state: int) -> dict | None:
    """One captor script blob, decoded for the state that enters it.

    The check that the shapes are right is that **every** blob terminates: all
    86 the six stages reach end on an entry whose motion is below 1, within 64
    entries. A wrong header length walks into the middle of a float and the
    list runs away immediately.
    """
    shape = TARGET_SCRIPT_SHAPE.get(state)
    if shape is None or off is None:
        return None
    head_len, per = shape
    raw = prog.evt.raw
    if off + head_len > len(raw):
        return None
    head: dict = {}
    if state == 34:
        head = {"arrive": struct.unpack_from("<f", raw, off)[0],
                "loops": struct.unpack_from("<H", raw, off + 4)[0],
                "motion": struct.unpack_from("<H", raw, off + 6)[0],
                "frame": struct.unpack_from("<H", raw, off + 8)[0]}
    elif state in (38, 40, 41):
        pt = list(struct.unpack_from("<3f", raw, off))
        head = {"point": pt,
                "motion": struct.unpack_from("<h", raw, off + 12)[0],
                "frame": struct.unpack_from("<h", raw, off + 14)[0]}
        if state == 38:
            head["loops"] = struct.unpack_from("<h", raw, off + 16)[0]
            head["mode"] = struct.unpack_from("<h", raw, off + 18)[0]
    elif state == 43:
        head = {"loops": struct.unpack_from("<h", raw, off)[0],
                "cue": struct.unpack_from("<h", raw, off + 2)[0]}
    entries: list[dict] = []
    p = off + head_len
    while per and len(entries) < 64 and p + per * 2 <= len(raw):
        v = struct.unpack_from("<%dh" % per, raw, p)
        if v[0] < 1:
            break
        e = {"motion": v[0], "frame": v[1], "loops": v[2], "mode": v[3]}
        if per > 4:
            e["flag"] = v[4]
        entries.append(e)
        p += per * 2
    return {"state": state, "head": head, "entries": entries}


def target_script_motions(script: dict | None) -> list[int]:
    """Every clip a decoded captor script names, for the bake list."""
    if not script:
        return []
    out = [script["head"].get("motion", 0)]
    out += [e["motion"] for e in script["entries"]]
    return [m for m in out if 0 < m < 4096]


def civilian_motion_ids(block: dict, entry: int) -> list[int]:
    """Every clip class 0x10's script *entry* can reach.

    Ops 0x00 and 0x01 name the clip; ops 0x0E, 0x0F, 0x1E and 0x1F name another
    stream, so the answer is the transitive closure from the entry rather than
    one stream's worth. `_bake` refuses a clip authored for another skeleton,
    so the whole set is offered rather than filtered here.
    """
    scripts = block.get("scripts") or []
    entries = block.get("entries") or []
    if not (0 <= entry < len(entries)):
        return []
    out: list[int] = []
    seen: set[int] = set()
    pending = [entries[entry]]
    while pending:
        i = pending.pop()
        if i in seen or not (0 <= i < len(scripts)):
            continue
        seen.add(i)
        for c in scripts[i]:
            if c["op"] in (0, 1):
                m = c["args"][0]
                if 0 < m < 4096:
                    out.append(m)
            pending += [j for j in (c.get("scripts") or []) if j >= 0]
    return sorted(set(out))


def civilian_item_slots(block: dict, entry: int) -> set[int]:
    """Every asset slot class 0x10's script *entry* can put in a hand.

    Ops 0x13 and 0x14 name a record directly, op 0x15 a weighted table of
    them, and a record draws its own slot plus, for some kinds, a fixed second
    one. All of it goes in the hidden template the client clones from.
    """
    scripts = block.get("scripts") or []
    entries = block.get("entries") or []
    items = block.get("items") or []
    if not (0 <= entry < len(entries)):
        return set()
    picked: set[int] = set()
    seen: set[int] = set()
    pending = [entries[entry]]
    while pending:
        i = pending.pop()
        if i in seen or not (0 <= i < len(scripts)):
            continue
        seen.add(i)
        for c in scripts[i]:
            if c.get("item") is not None and c["item"] >= 0:
                picked.add(c["item"])
            for _w, k in c.get("itemTable") or ():
                if k >= 0:
                    picked.add(k)
            pending += [j for j in (c.get("scripts") or []) if j >= 0]
    out: set[int] = set()
    for k in picked:
        if 0 <= k < len(items):
            out.add(items[k]["slot"])
            if items[k].get("extra"):
                out.add(items[k]["extra"])
    return out


def class31_motion_ids(block: dict) -> list[int]:
    """Every clip the class-0x31 tables can reach, for the bake list."""
    out: list[int] = []
    for row in block.get("sets", []):
        out += [m for m in row.get("motions", []) if 0 < m < 4096]
        out += [m for m in row.get("reactions", []) if 0 < m < 4096]
        for e in row.get("strikes", {}).values():
            out += [e["strike"], e["lunge"]]
        for stance in row.get("attacks", {}).values():
            for e in stance.values():
                out += [st["motion"] for st in e["script"]]
    for script in block.get("scripts", {}).values():
        if script:
            out += [st["motion"] for st in script]
    out += sorted(CLASS31_LITERAL_MOTIONS)
    return sorted({m for m in out if 0 < m < 4096})


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
        "reaction_blend": {"frames": REACT_BLEND, "sever": REACT_BLEND_SEVER,
                           "hard_set_from_bone": REACT_BLEND_MAX_BONE},
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
