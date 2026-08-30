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
MOTION_RULES: dict[int, tuple] = {
    0x30: ("literal", 0x3BC),
    0x53: ("table", 0x00589A64, 10, 0x00, "i16"),
}

#: `mot/` is authored at 30 Hz against the engine's 60 Hz clock -- see the note
#: on `g_motion_play_length` in docs/formats/mot.md, which runs at about twice
#: the frame count. The exact relation is open, so this is stated as the
#: playback rate rather than baked into the frame data.
MOTION_FPS = 30.0

#: More than this and a bake is not worth its bytes; the longest motion in the
#: game is well inside it.
MAX_BAKED_FRAMES = 600

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

    def to_json(self) -> dict:
        return {
            "type": self.char_type,
            "name": self.name,
            "file": self.file,
            "bone_count": self.bone_count,
            "bones": self.bones,
            "motions": {str(k): v for k, v in self.motions.items()},
        }


@dataclass
class Placement:
    """One spawn descriptor resolved to a character and a motion."""

    at: int                         #: evt file offset, the descriptor's identity
    cls: int
    char_type: int
    motion: int | None
    spawn: dict                     #: the script's own spawn dict

    def to_json(self) -> dict:
        return {"at": self.at, "class": self.cls, "char_type": self.char_type,
                "motion": self.motion}


def motion_for(tables, spawn_rec, cls: int) -> int | None:
    """The motion id a class handler starts this spawn in, or None."""
    rule = MOTION_RULES.get(cls)
    if rule is None:
        return None
    if rule[0] == "literal":
        return rule[1]
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
    return {"bank": fname, "frames": len(frames), "fps": MOTION_FPS,
            "root": root, "rot": rot}


def resolve_for_stage(stage, prog=None):
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

    for at, sp in sorted(by_at.items()):
        rec = recs.get(at)
        if rec is None:
            continue
        res = spawnres.resolve_spawn(tables, rec)
        if not res.identified or res.char_type is None:
            continue
        motion = motion_for(tables, rec, sp["class"])
        placements.append(Placement(at, sp["class"], res.char_type, motion, sp))
        if motion is None:
            continue                      # marker only -- see the module note
        if res.char_type not in chars:
            built = _build(stage, tables, res.char_type, res.asset_file)
            if built is None:
                continue
            chars[res.char_type] = built
        c = chars[res.char_type]
        if motion not in c.motions:
            baked = _bake(stage.game, tables, motion, c.bone_count)
            if baked is None:
                continue
            c.motions[motion] = baked
        per_type.setdefault(res.char_type, []).append(sp)

    entries = [_rig_entry(stage, tables, chars[ct], sps)
               for ct, sps in sorted(per_type.items()) if ct in chars]
    return chars, placements, [e for e in entries if e]


def _build(stage, tables, char_type: int, asset_file: str) -> Character | None:
    skel = tables.character_skeleton(char_type)
    if not skel:
        return None
    bones = [{"bone": n["bone"],
              "part": f"bone{n['bone']:02d}_{n['slot']:04x}",
              "slot": n["slot"],
              "offset": list(n["offset"]),
              "parent": n["parent"]}
             for n in skel]
    return Character(char_type=char_type,
                     name=asset_file.removesuffix(".bin"),
                     file=asset_file,
                     bone_count=tables.character_bone_count(char_type),
                     bones=bones)


def _rig_entry(stage, tables, char: Character, spawns: list[dict]) -> dict | None:
    """A `gltf.export_level` rig entry: the skeleton, placed at every spawn."""
    from . import rigs as rigslib, stage as stagelib

    try:
        models, bank = stagelib.load_asset(stage.game, char.name)
    except Exception:
        return None
    slots = tables.asset_slots()

    parts: list[tuple] = []
    for i, b in enumerate(char.bones):
        part = rigslib.RigPart(
            b["part"], (b["slot"],),
            translation=tuple(b["offset"]),
            # Bind pose. The client overwrites every bone from the motion each
            # frame; this is only what the file loads as.
            rotation_bams=(0, 0, 0),
            parent=(char.bones[b["parent"]]["part"]
                    if b["parent"] is not None else ""),
            note=f"bone {b['bone']} of character type {char.char_type:#04x}")
        rec = slots.get(b["slot"])
        idx = rec[1] if rec else None
        model = models[idx] if idx is not None and idx < len(models) else None
        parts.append((part, [(model, bank, char.name)] if model else []))

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


def characters_json(chars: dict[int, Character],
                    placements: list[Placement]) -> dict:
    """The `characters` block of ``<stage>.script.json``."""
    posed = sum(1 for p in placements if p.motion is not None)
    return {
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
