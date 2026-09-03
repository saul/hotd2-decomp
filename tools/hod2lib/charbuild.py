"""Assembling one character type, and the glTF rig it draws through.

:class:`Character` is a character *type* -- its skeleton, its per-bone combat
rows and the motions baked for it -- not an instance; `placement.Placement` is
the instance. :func:`build` reads one out of the EXE tables and
:func:`rig_entry` turns it into the joints and inverse binds the glTF writer
wants.
"""

from __future__ import annotations

import struct
from dataclasses import dataclass, field

from . import degraded
from .bams import compose_bams, rot_matrix
from .combat import (MOTION_ROW_BACKOFF, actor_radius, attack_picks,
                     attack_tables, damage_rank_row, gore_parts,
                     hit_reactions, hit_sphere, hit_steps, motion_row,
                     throw_tables, torso_stage_count, zombie_throw_tables)


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
    #: Class 0x30's own hand kit -- see :data:`ZOMBIE_THROW_SLOTS`. A different
    #: family from :attr:`throw`, which is class 0x31's.
    zombie_throw: dict | None = None
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
            "zombie_throw": self.zombie_throw,
            "motions": {str(k): v for k, v in self.motions.items()},
        }


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


def build(stage, tables, char_type: int, asset_file: str) -> Character | None:
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
                     zombie_throw=zombie_throw_tables(char_type),
                     motion_row=motion_row(tables, char_type))


def rig_entry(stage, tables, char: Character, spawns: list[dict],
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
    except Exception as exc:
        degraded.note(f"character asset {char.name}",
                      f"{char.name} has no model, so every spawn of it is "
                      f"invisible", exc)
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


def gore_entry(stage, tables, char: Character) -> dict | None:
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
            except Exception as exc:
                degraded.note(f"damaged-variant asset {stem}",
                              f"slot {slot:#06x} keeps its undamaged model",
                              exc)
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
