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
#: ``base + variant * stride``. ``("literal", id)`` is a constant.
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

#: A waypoint: ``{s16 step, s16 motion_set, f32 x, f32 y, f32 z}``, sixteen
#: bytes, and the list is terminated by a step of -1. *step* is frames per
#: unit -- `ActorArcBeginTo` sets the duration from ``dist2d * step`` -- and it
#: doubles as the arc kind `ActorArcStep` switches on.
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
        if self.leap:
            d["leap"] = self.leap
        if self.path:
            d["path"] = self.path
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

    chars: dict[int, Character] = {}
    placements: list[Placement] = []
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
        placements.append(Placement(
            at, sp["class"], res.char_type, motion, sp, intro,
            body_condition=tail[0], initial_state=tail[1],
            attack_state=tail[2], leap=leap, path=path,
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
        for mid in [motion, intro[0] if intro else None] + deaths + reacts:
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
    entries += [_gore_entry(stage, tables, chars[ct])
                for ct in sorted(per_type) if ct in chars and chars[ct].gore]
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
