"""What a shot does: damage, reactions, attacks, gore and death.

The tables `ResolveHit`, `ActorPlayHitReaction`, `ZombieStateStrike`,
`ThrowerStateThrow`, `ActorShotFeedback` and `FUN_00456220` read, with the
address of each beside it. `docs/formats/combat.md` is the long form; this is
the reader.

**Every address here is `.rdata` and every literal is `.text`, and the two go
to different places.** A table is read out of the EXE and travels in the
bundle; an immediate compiled into a routine is a *constant of the port* and
belongs in `web/src/game/` beside the code that uses it, carrying the citation
it has here.

The immediates left in this module are the ones nothing in `game/` reads:
the shot sounds and sprites, whose only reader is `web/src/render/shooting.ts`;
the hit-point clamp, read by `web/src/render/characters.ts`; the asset slots,
which are join keys into geometry the exporter wrote; and
:data:`PLAYER_START_LIVES`, read by `web/src/app/stage_load.ts` before any of
`game/` has run. `docs/formats/bundle.md` lists them and says what each is
waiting on.
"""

from __future__ import annotations

import math
import struct

from .arcscript import CLASS30_ARC_SCRIPTS, arc_script


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

#: The **class 0x30** hand kits, which are a different family from
#: :data:`THROWER_SLOTS` above: `ZombiePickThrowingHand` (`FUN_00458F00`) tests
#: *held* to see whether a hand is still armed, and `ZombieThrowHandWeapon`
#: (`FUN_0045A240`) swaps it to *bare*, clears the weapon bone beside it and
#: gives the projectile *projectile*.
#:
#: Only three character types throw, and the switch in each of those two
#: functions is the whole list -- there is no table. Resolved through
#: `asset_slots()` the names say what they are: 0x13 is **tutorial.bin**, 0x14
#: is znonoopa.bin, and what 0x13 and 0x14 throw is `znonoo.bin` part 0, the
#: axe. Char type 1 (znassb.bin) throws parts of its own model instead.
#:
#: *weapon_bone* is the bone the routine zeroes alongside the hand: the weapon
#: mesh hangs off the hand, and leaving it drawn leaves an axe floating in an
#: empty fist.
ZOMBIE_THROW_SLOTS = {
    0x01: {                                    # znassb.bin
        5: {"held": 0x1BA9, "bare": 0x1BAC, "weapon_bone": 6,
            "projectile": 0x1B8D},
        8: {"held": 0x1BA5, "bare": 0x1BA8, "weapon_bone": 9,
            "projectile": 0x1B8C},
    },
    0x13: {                                    # tutorial.bin
        5: {"held": 0x1ECE, "bare": 0x1ECB, "weapon_bone": 6,
            "projectile": 0x249},
        8: {"held": 0x1ECA, "bare": 0x1EC7, "weapon_bone": 9,
            "projectile": 0x249},
    },
    0x14: {                                    # znonoopa.bin
        5: {"held": 0x1EF9, "bare": 0x1EF6, "weapon_bone": 6,
            "projectile": 0x249},
        8: {"held": 0x1EF5, "bare": 0x1EF3, "weapon_bone": 9,
            "projectile": 0x249},
    },
}

#: `znonoo.bin` part 0 -- the axe, and the only projectile that flies straight.
#: `ZombieThrowHandWeapon` sends it to state 1 and everything else to state 2,
#: the arc.
ZOMBIE_AXE_SLOT = 0x249

#: The forty frames the creature `znjoe` releases is drawn with, per character
#: type.
#:
#: `BodyCreatureUpdate` (`FUN_0043E880`) ends
#: `AssetDrawSlot(obj+0x1330 % 0x28 + 0x1D31)`, and `ExeTables.asset_slots`
#: resolves `0x1D31..0x1D58` to **`znjoe.bin` entries 176..215** -- the host
#: character's own model bank, past the last entry any skeleton node names, so
#: nothing that walks a skeleton carries them.
#:
#: Keyed on the character type rather than on a spawn class because the
#: creature has no class id, and because the run only exists in the file that
#: type loads. Only character type `0x0A` releases one: `ActorReactToHit`
#: (`FUN_004543F0`) is the one place in the image that tests for it, and
#: exactly seven spawns in the twelve shipped scripts resolve to it, all in
#: stage 5.
BODY_CREATURE_SLOTS: dict[int, tuple[int, ...]] = {
    0x0A: tuple(range(0x1D31, 0x1D31 + 0x28)),
}

#: `ZombieThrowHandWeapon`'s two speeds for `obj+0x1370`: the stationary
#: thrower's axe is faster than an ordinary one's.
ZOMBIE_THROW_SPEED_STANDING = 1.5

ZOMBIE_THROW_SPEED = 1.0

#: `ZombieThrownWeaponAimAtCamera`: the axe aims this far below the eye, and
#: everything aims 4.0 in front with the same 0.6 per-player side offset the
#: class-0x31 throw uses.
ZOMBIE_THROW_AIM_DROP = 1.5

#: `ZombieThrownWeaponStateArc`'s gravity, `0x3C1374BC`, negated for bone 8.
ZOMBIE_THROW_ARC_GRAVITY = 0.008999999612569809

#: `PlayerTakeDamage`'s third argument: 4 for the straight throw, 6 for the arc.
ZOMBIE_THROW_HIT_KIND = 4

ZOMBIE_THROW_ARC_HIT_KIND = 6

#: `ZombieStateStandAndThrow` (class 0x30 state 33) reads its own tail.
STAND_AND_THROW_STATES = {0x30: (33,)}

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
#: ``(set A, set B)`` pairs, then two two-entry pools, which are **kind 3's**:
#: the attack cry is a pair per set rather than one id per set, because the
#: routine coin-flips inside the set. Read as ids and resolved through
#: `g_se_name_list`, so the names below are the game's own filenames.
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


def attack_hit_lands(hit_frame: int, strike_play_length: int) -> bool:
    """Whether `ZombieStateStrike` can ever fire this entry's hit.

    It cannot when the hit frame is at or past the strike clip's play length,
    and that is the engine's own behaviour rather than a misread row.
    `ZombieStateStrike` (`FUN_00455A40`) sub 2 is two independent tests in one
    pass, and both the operators matter:

    * the strike is an **exact equality** --
      ``00455bdf CMP ECX,EAX`` / ``00455be1 JNZ`` over the
      ``CALL 0x00456490``, so ``obj+0x19C == entry+0x08`` or nothing happens;
    * the exit is ``00455c02 MOVSX EDX,[ECX*2 + 0x4e07d0]`` / ``DEC`` /
      ``CMP EAX,EDX`` / ``JL``, so the state hands to `ZombieStateBackOff` as
      soon as ``obj+0x19C >= g_motion_play_length[obj+0x1B4] - 1``.

    The cursor is reset to 0 when the clip starts (`ActorSetMotionBlended`,
    ``param_1[2] = param_3``), so it only ever takes the values
    ``0 .. play_length - 1``. A hit frame outside that range is unreachable:
    the strike **never fires**, the state is not aborted and nothing is
    retried, the clip runs to its end and the actor retreats having swung and
    missed.

    **Why dropping these entries was right until now.** The rows of
    :data:`ATTACK_TABLE` are adjacent with no count, so an early version of
    this reader scanned a fixed number of them and read the next row's attacks
    as this one's -- and "hits on frame 40 of a 20-frame clip" is precisely
    what that produced. Keeping only the entries the pick table names fixed the
    row-length problem at its source; the hit-frame bound stayed on afterwards
    as a second line of defence, and in doing so it deleted the three entries
    the game really does carry with an unreachable hit frame. Across every
    character type those three are the *only* picked entries it rejects --
    types 0x07, 0x0B and 0x0C, body condition 4, index 2, all of them
    ``{997, 1051, 26.0f, 40, 9, 1}`` against ``g_motion_play_length[997] ==
    20`` -- and they are the crawlers' undamaged attack, which is meant to
    miss. `tools/verify_combat.py` asserts that set rather than the bound, so
    a genuine misread still fails a check.
    """
    return 0 <= hit_frame < strike_play_length


def attack_tables(tables, char_type: int) -> dict:
    """``{body_condition: {index: attack}}`` -- see :data:`ATTACK_TABLE`.

    Only the entries the **pick table names** are exported, because those are
    the only ones the game ever reads: `ZombieStateStrike` indexes with
    ``obj+0x131A``, which `attack_picks` supplies, and never scans. That also
    sidesteps the row-length problem -- the rows are adjacent with no count, so
    a fixed scan reads the next row's attacks as this one's, and an entry whose
    hit frame lands outside its own clip is what that looked like from here.

    Each entry is checked against its own strike clip before being kept, but
    **a hit frame past the end of that clip is not a reason to drop it** -- see
    :func:`attack_hit_lands`.
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
            if hit < 0 or play(strike) <= 0 or not (0 < play(lunge) <= 400):
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


def zombie_throw_tables(char_type: int) -> dict | None:
    """Class 0x30's hand kit, or None for a type that does not throw.

    Every value here is a literal out of `ZombiePickThrowingHand` and
    `ZombieThrowHandWeapon` -- there is no table in the exe, only a switch on
    the character type in each of those two functions, and three types in it.
    See :data:`ZOMBIE_THROW_SLOTS`.
    """
    kit = ZOMBIE_THROW_SLOTS.get(char_type)
    if kit is None:
        return None
    hands = [{"bone": bone, **kit[bone]} for bone in (5, 8)]
    # The axe flies straight; anything else arcs. `ZombieThrowHandWeapon`
    # decides by the projectile slot, not by the character.
    straight = all(h["projectile"] == ZOMBIE_AXE_SLOT for h in hands)
    return {
        "hands": hands,
        "straight": straight,
        "speed": ZOMBIE_THROW_SPEED,
        "speed_standing": ZOMBIE_THROW_SPEED_STANDING,
        "aim_ahead": THROW_AIM_AHEAD,
        "aim_side": THROW_AIM_SIDE,
        "aim_drop": ZOMBIE_THROW_AIM_DROP if straight else 0.0,
        "arc_gravity": ZOMBIE_THROW_ARC_GRAVITY,
        "hit_kind": ZOMBIE_THROW_HIT_KIND if straight
                    else ZOMBIE_THROW_ARC_HIT_KIND,
        "stick_frames": THROW_STICK_FRAMES,
        "blink_frames": THROW_BLINK_FRAMES,
    }


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
    """What the shell needs before a game starts, which is the life count.

    The cost of a hit -- one life, -100, 90 frames, -2 rank -- is four
    immediates in `PlayerTakeDamage` and they live in
    `web/src/game/combat/player.ts` with this citation; see
    `docs/formats/bundle.md`. :data:`PLAYER_START_LIVES` is the same kind of
    number and is exported only because `web/src/app/stage_load.ts` reads it
    to seed the counter before any of `game/` has run.
    """
    return {"start_lives": PLAYER_START_LIVES}


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
        # `ActorPlayHitVoice`. `impact` plays on kinds 0 and 1; `head_impact`
        # replaces it on kind 2 -- which is the **hit result being 2**, not a
        # headshot: `ZombieOnShot` (`FUN_00453EB0`) picks between kinds 1 and 2
        # at `0x00453F6E CMP EAX,0x2` on `g_hit_result` and tests no bone at
        # all, and `ThrowerOnShot` (`FUN_004499A0`) agrees at `0x00449A76`.
        # The two kinds share one voice pair, so the impact is the only
        # audible difference; `tools/verify_combat.py` check 15 asserts both.
        "impact": named(v[0:5]),
        "head_impact": named([0x0116A9, 0x0516A9]),
        "voice": {
            "hurt": named([v[5], v[6]]),
            "kill": named([v[7], v[8]]),
            "head": named([v[9], v[10]]),
            # **Kind 3, the attack cry**, and the table's shape changes here:
            # kinds 0-2 are one id per voice set, and this is a *pair* per set
            # that the routine tosses a coin within (`rand() & 1` at
            # `0x0040A7B8` and `0x0040A7E0`). So it is
            # ``[set A pair, set B pair]`` rather than ``[set A, set B]``.
            #
            # This parser read all fifteen dwords and emitted eleven for as
            # long as `web/src/hod2lib/combat.ts` did. The TS half was fixed
            # when the silent swing was reported and this one was not, which is
            # the drift `tools/verify_exporters.py` is meant to catch and
            # cannot: it compares the two halves' *modules and version*, not
            # the fields they emit.
            "attack": [named([v[11], v[12]]), named([v[13], v[14]])],
        },
        "voice_set_a_types": list(VOICE_SET_A_TYPES),
        # `FUN_00407950` and `FUN_004073B0`, keyed by collision material.
        "ricochet": {str(k): {"id": i, "file": name(i)}
                     for k, i in sorted(RICOCHET_BY_MATERIAL.items())},
        "impact_sprite": {str(k): list(t)
                          for k, t in sorted(IMPACT_SPRITE_BY_MATERIAL.items())},
        "impact_sprite_default": list(IMPACT_SPRITE_DEFAULT),
        # `ZombieStateArcScriptedEntrance` (class 0x30 state 30) names these by
        # character type. The arc machinery is class 0x31's, but these two
        # scripts are class 0x30's own -- see :data:`CLASS30_ARC_SCRIPTS`.
        "arc_scripts": {k: v for k, v in
                        ((k, arc_script(tables, a))
                         for k, a in CLASS30_ARC_SCRIPTS.items()) if v},
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
    # `default` is gone: :data:`DEFAULT_DIFFICULTY` is an immediate and the
    # port already carries it as `G.g_difficulty`. The clamp stays because its
    # only reader is `web/src/render/characters.ts`.
    return {
        "hp_delta": list(struct.unpack_from("<5i", tables.data, a)) if a else [],
        "initial_rank": list(struct.unpack_from("<5b", tables.data, b)) if b else [],
        "hp_min": 1, "hp_max": 300,
    }


def death_motions(tables) -> dict:
    """The directional death set. See :data:`DEATH_FRONT`."""
    def rd(base, n):
        o = tables._v2r(base)
        if o is None:
            return []
        return list(struct.unpack_from(f"<{n}I", tables.data, o))
    # Two of the four arcs read a table and two name a literal motion; only
    # the tables travel. :data:`DEATH_RIGHT`, :data:`DEATH_LEFT` and
    # :data:`DEATH_ARC` are in `web/src/game/combat/resolve_hit.ts`.
    return {"front": rd(DEATH_FRONT, 4), "back": rd(DEATH_BACK, 6)}


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
