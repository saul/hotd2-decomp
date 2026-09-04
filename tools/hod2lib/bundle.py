"""Writes the static bundle the browser player loads.

The player does **not** parse `pol/`, `tex/`, `cam/`, `evt/` or `Hod2.exe`.
Re-implementing `lz`, `container`, `nl1`, `texbank`, `exetab`, `cam`, `evt` and
the PowerVR2 decoder in TypeScript would be ~2500 lines and, worse, a second
implementation of every format that could drift from this one. So Python
pre-processes and the browser consumes.

The cost is stated plainly: the user runs ``tools/export_player.py`` once
before opening the player. What that buys is exactly one implementation of
every format, with ``dump_stage_script.py`` still a valid text oracle for the
JSON the browser eats, because both come out of :mod:`hod2lib.script`.

Layout::

    extract/player/
      manifest.json                stages present, tool version, source hashes
      stage2/
        stage2.glb                 geometry, materials, textures (or .gltf set)
        stage2.cam.json            Hermite curves keyed by global path slot
        stage2.script.json         the resolved event script and route graph
      stage2_original/             game mode 1, same shape

``manifest.json`` records the SHA-256 of every source file consumed, so a
bundle built from a different game build is detectable rather than
mysteriously wrong -- the same principle as ``manifest.csv``.
"""

from __future__ import annotations

import hashlib
import json
import struct
import time
from pathlib import Path

from . import degraded
from . import charmotion
from . import (__version__, characters as charlib, evt as evtlib, gltf,
               props as propslib, rigs as rigslib,
               schema as schemalib, spawnres as spawnreslib,
               script as scriptlib, stage as stagelib)

__all__ = ["BUNDLE_FORMAT", "build_stage", "write_manifest"]

#: Bumped when the on-disk shape changes in a way the client must notice. The
#: client refuses a bundle it does not know how to read rather than rendering
#: something subtly wrong.
#:
#: **It stayed at 1 across 23 commits to this file** -- the ones that added
#: ``coli``, ``civilians``, ``humanoids`` and ``set_pieces``, and the one that
#: renumbered ``game_mode``. ``web/src/bundle/stage.ts`` has checked it the
#: whole time and could never fire, so a bundle built before collision existed
#: loaded happily and lost it, with no message. A version check whose constant
#: nobody bumps is documentation, not a check.
#:
#: Bump it in the same commit as the shape change. 2 was the first honest
#: value: it said "not whatever those older bundles were".
#:
#: 3 adds the `schema` digest below and a per-stage `format`.
#:
#: **This integer is still the coarse check, and it is not the one that will
#: fire.** Bumping it is a thing a person has to remember, which is how it
#: came to sit at 1 for 23 commits. It says "the *layout* moved" -- a new file
#: in a stage directory, a block renamed -- and the digest beside it, which
#: nobody has to remember, catches the field-level drift.
BUNDLE_FORMAT = 3

#: Every asset slot the three container families can draw. The group props
#: use the first four; `KindedPropUpdate` adds the three kinded models and the
#: smaller shadow, and `FallingContainerUpdate` the whole/loose/fragment trio.
BREAKABLE_SLOTS = (
    0x19E8, 0x19E6, 0x1A0F, 0x10D0,          # BreakablePropUpdate
    0x17A9, 0x17AA, 0x17AB, 0x10D1,          # KindedPropUpdate
    0x0A50, 0x0A51, 0x0A55,                  # FallingContainerUpdate
)

#: What each `PlaceGenericProp` type actually draws, by class-0x41 type.
#:
#: **[proved]**, one routine at a time, out of `g_class41_updates`. This exists
#: because `PlaceGenericProp` writes the descriptor's ``+0x11C`` into *both*
#: ``obj+0x11C`` (the lifetime `PropExpireByStepLifetime` counts down) and
#: ``obj+0x28C`` (the asset slot), and only three types ever draw the latter.
#: For every other type the value is a **lifetime of 0-5 event blocks** and the
#: model is a literal in the routine, so exporting ``+0x11C`` as a slot
#: resolved 46 of stage 2's 67 generic props to `char_adv03.bin`,
#: `eff_boss4.bin` and other characters -- which is what "the props are not
#: rendering" looked like.
#:
#: The measurement that says the two meanings never overlap: the distinct
#: ``+0x11C`` values stage 2 places are 0,1,2,3,4,5 and then 0x1D8 upwards,
#: with nothing in between, and the three types carrying the high values are
#: exactly the three whose routine draws ``obj+0x28C``.
#:
#: ``None`` means the routine draws no static model at all -- an effect at
#: ``obj+0x324``, and nothing for this exporter to place. An empty tuple with
#: `descriptor=True` means "the spawn descriptor names it", handled below.
GENERIC_DESCRIPTOR_SLOT = (5, 12, 33)

#: The literal slots each read routine passes to `AssetDrawSlot`, in the order
#: it draws them. Cited by the routine that draws each one.
GENERIC_STATIC_SLOTS: dict[int, tuple[int, ...]] = {
    6:  (0x1032,),                  # ctor arm; FUN_004668A0 animates from it
    8:  (0x1A36,),                  # FUN_00467080, `0x1A36 - obj+0x290`
    10: (0x10C4,),                  # ctor arm; FUN_004668A0
    11: (0x01CF, 0x01D0),           # FUN_00467C80, `0x1CF + (frame & 1)`
    13: (0x1A4A, 0x1A49, 0x1A43),   # FUN_00467F50
    14: (0x10D2,),                  # FUN_00468180
    19: (0x01CE, 0x10D3),           # FUN_00468F00, body plus the ctor arm
    20: (0x01E2,),                  # FUN_00469380
    21: tuple(range(0x132F, 0x1339)),   # FUN_004694A0, `0x132F + frame % 10`
    27: (0x17A9,),                  # FUN_00469E60
    30: (0x01DF,),                  # FUN_0046A0F0
    32: (0x197A, 0x197B, 0x1981),   # LiftUpdate -- car, cage leaf, panel
    35: (0x1812, 0x1813),           # FUN_0046B320
    49: (0x01D2, 0x10D0),           # FUN_0046E6E0, body plus its shadow
    56: (0x10D3,),                  # ctor arm 0x38
    58: (0x01D1,),                  # FUN_0046F580
    60: (0x01D8,),                  # FUN_0046F840
    64: (0x1A39, 0x0C27),           # FUN_0046FBE0
    77: (0x10AB,),                  # FUN_004717A0, Original Mode only
}

#: Types whose routine draws only an effect, never a static model.
#: `FUN_00468E50` (18), `FUN_00469AE0` (25) and `FUN_00469F50` (28).
GENERIC_NO_MODEL = (18, 25, 28)


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


#: Stage number -> the index in the BGM tables of that stage's own track.
#: The event script never plays these: every `bgm_entry_play` in the six
#: stage scripts names a *boss* or *transition* track, so the opening track is
#: started outside the event system by a path that has not been traced. The
#: names are unambiguous (`ST1_AR.WAV` ... `ST6_AR.WAV`), so the player offers
#: the stage track by name and labels it as not script-driven.
STAGE_BGM_INDEX = {1: 1, 2: 0, 3: 17, 4: 16, 5: 18, 6: 19}


def bgm_json(tables, stage_number: int | None, game_mode: int) -> dict:
    """The BGM mapping a stage needs: ids to filenames, plus its own track.

    Both tables travel, because which one the game picks depends on runtime
    state (`DAT_009C8E98 == 6 && g_GameMode == 0` selects the plain names, and
    everything else the `_AR` mix). Note the `0` there: it is a mode no stage
    is entered in, so neither `GameMode.ORIGINAL` nor `GameMode.ARCADE` can
    reach the plain table. The client defaults to `_AR` for that reason and
    can be pointed at the other.
    """
    names = tables.bgm_names()
    idx = STAGE_BGM_INDEX.get(stage_number or -1)
    return {
        "names": names,
        "default_table": "ar",
        "stage_track": (
            None if idx is None else {
                "index": idx,
                "id": 0x10000000 | idx,
                "ar": names["ar"][idx],
                "plain": names["plain"][idx] if idx < len(names["plain"]) else None,
                "note": "the stage's own track, named by convention rather "
                        "than by the script -- no bgm_entry_play in any stage "
                        "script starts it",
            }
        ),
        "game_mode": game_mode,
    }


def sound_json(tables) -> dict:
    """The SE and voice name tables, for the ids `se_play` can carry.

    `se_play` (0x38) is not restricted to SE: its operand goes through
    `PlaySoundId`, which dispatches on the top nibble, and the shipped scripts
    use all three namespaces through it -- 9 BGM ids, 6 voice ids and one stop
    control across the six stages. So the client needs every table, not just
    the SE one.
    """
    return {
        "se": {str(k): v for k, v in sorted(tables.se_names().items())},
        "voice": {str(k): v for k, v in sorted(tables.voice_names().items())},
        # evt 0x2D's message groups. The sprite is an asset id the player has
        # no 2D pipeline for, but the voice is an ordinary sound id and the
        # frame count and screen position are exact, so the line can be played
        # and the caption placed.
        "messages": {str(m["group"]): m["variants"]
                     for m in tables.screen_messages()},
        "screen": {"width": 640, "height": 480,
                   "note": "message x/y are pixels in the game's 640x480 "
                           "screen space"},
    }


#: The rain particle asset, from `FUN_004136A0`'s `AssetDrawSlotAlpha(0x53, 0.5)`.
#: No region draws it and no script opcode loads it, so it has to be pulled in
#: explicitly or the effect has no model.
RAIN_SLOT = 0x53


def rain_json(tables, prog) -> dict:
    """evt `0x1D`'s rain, transcribed from `FUN_004136A0`.

    Every constant here is read, not chosen::

        50 particles at 0x007C1EB8, three floats each, up to 0x007C2114
        y -= 2.0 every frame
        respawn when y <= -7:
            x = rand() % 0x14 - 10     ->  [-10,  9]
            y = rand() % 0x32 - 25     ->  [-25, 24]
            z = rand() % 0x19 - 35     ->  [-35,-11]
        world = RotY(camera_yaw) * (x, y, z) + camera_eye
        yaw   = horizontal angle from the camera to that point (dy forced 0)
        draw: Translate(world), RotY(yaw), RotZ(0x100), Scale(1.5, 3.5, 1.0),
              AssetDrawSlotAlpha(0x53, 0.5), inside draw layer 0xE
    """
    used = 0
    for b in prog.live_blocks():
        for st in b.steps:
            for op in st.ops:
                if op.opcode == 0x1D and op.detail.get("value"):
                    used += 1
    rec = tables.asset_slots().get(RAIN_SLOT)
    return {
        "slot": RAIN_SLOT,
        "file": rec[0] if rec else None,
        "entry": rec[1] if rec else None,
        "count": 50,
        "fall_per_frame": 2.0,
        "respawn_below": -7.0,
        # (modulo, offset) exactly as the routine spells them.
        "spawn": {"x": [0x14, -10.0], "y": [0x32, -25.0], "z": [0x19, -35.0]},
        "scale": [1.5, 3.5, 1.0],
        "roll_bams": 0x100,
        "alpha": 0.5,
        "draw_layer": 0xE,
        "enabled_by_script": used,
    }


def _generic_types(prog) -> set[int]:
    """The class-0x41 types `PlaceGenericProp` builds, from the dispatch table."""
    try:
        rows = prog.stage.tables.class41_dispatch()
    except Exception as exc:
        degraded.note("the class-0x41 dispatch table",
                      "no generic prop types, so every one is treated as "
                      "drawing nothing", exc)
        return set()
    ctor = 0x00461CF0
    return {r["type"] for r in rows if r["ctor"] == ctor}


def _container_placements(prog) -> list[dict]:
    """Every container spawn a stage places, decoded to what the port needs.

    Three families, three different descriptors, one list -- because they all
    decrement the same `g_item_set_countdown` and the port has to place them
    all before any of the countdowns mean anything:

    * ``group``   class 0x41 type 0, `PlaceBreakableGroup`. `+0x11C` is the
      group id and `desc+0x24` the lifetime in evt blocks.
    * ``kinded``  class 0x41 type 4, `PlaceKindedProp`. The *orientation* words
      carry the payload -- `desc+0x1C` is the object kind and `desc+0x14` the
      item-set size -- while `desc+0x22` is the lifetime and `desc+0x24` the
      item set. None of those three fields means what its name means elsewhere.
    * ``falling`` class 0x44 selector 16, `PlaceFallingContainer`. Same
      orientation trick, but the lifetime, item set and mode-1 item come from
      the **parameter tail** at `desc+0x24`, because class 0x44 spawns through
      the allocator that writes `obj+0x1390`.
    """
    if prog is None:
        return []
    raw = prog.evt.raw
    out: list[dict] = []
    generic = _generic_types(prog)
    for rec in evtlib.spawns(prog.evt):
        if rec.cls not in (0x41, 0x44):
            continue
        if rec.offset + 0x30 > len(raw):
            continue
        if rec.cls == 0x41:
            ctor = struct.unpack_from("<b", raw, rec.offset + 0x25)[0]
            if ctor == 0:
                out.append({
                    "at": rec.offset, "container": "group",
                    "group": rec.hp,
                    "lifetime_evt_steps":
                        struct.unpack_from("<b", raw, rec.offset + 0x24)[0],
                })
            elif ctor == 34:
                # `PlaceGenericProp` case 0x22 builds a falling container:
                # `+0x11C` is the lifetime and the slot is forced to 0xA50, so
                # this is the same object class 0x44 selector 16 places.
                out.append({
                    "at": rec.offset, "container": "falling", "kind": 0,
                    "item_set": struct.unpack_from("<b", raw,
                                                   rec.offset + 0x24)[0],
                    "story_item": -1,
                    "set_size": rec.orient[0],
                    "lifetime_evt_steps": rec.hp & 0xFF,
                    "pos": list(rec.pos), "yaw": rec.orient[1],
                })
            elif ctor in generic:
                # Everything else `PlaceGenericProp` builds. `+0x11C` goes to
                # **both** `obj+0x11C` and `obj+0x28C`, so it is the lifetime
                # in event blocks *and* the asset slot -- and only the three
                # types in `GENERIC_DESCRIPTOR_SLOT` ever draw the slot. Both
                # are carried under their own names; the client decides which
                # one this type's routine reads. See `GENERIC_STATIC_SLOTS`.
                out.append({
                    "at": rec.offset, "container": "generic",
                    "type": ctor, "slot": rec.hp,
                    "lifetime_evt_steps": rec.hp,
                    "pos": list(rec.pos),
                    "pitch": rec.orient[0], "yaw": rec.orient[1],
                    "roll": rec.orient[2],
                })
            elif ctor == 4:
                out.append({
                    "at": rec.offset, "container": "kinded",
                    "kind": rec.orient[2],
                    "item_set": struct.unpack_from("<b", raw,
                                                   rec.offset + 0x24)[0],
                    "set_size": rec.orient[0],
                    # `+0x11C` is the lifetime for this class, not hit points.
                    "lifetime_evt_steps": rec.hp,
                    "pos": list(rec.pos), "yaw": rec.orient[1],
                })
        elif rec.hp == 16:                      # class 0x44 selector 16
            tail = rec.offset + 0x24
            out.append({
                "at": rec.offset, "container": "falling",
                "kind": rec.orient[2],
                "item_set": struct.unpack_from("<b", raw, tail + 4)[0],
                "story_item": struct.unpack_from("<i", raw, tail + 8)[0],
                "set_size": rec.orient[0],
                "lifetime_evt_steps":
                    struct.unpack_from("<b", raw, tail)[0],
                "pos": list(rec.pos), "yaw": rec.orient[1],
            })
    return out


def set_pieces_json(prog) -> dict:
    """Class 0x24's parameter tail, per spawn.

    `SetPiecePropInit` (`FUN_00482CE0`) reads everything a set-piece does out
    of the tail at ``desc+0x24``, and the six state routines read nothing else.
    Keyed by the spawn's script address, which is the identity every layer of
    this project agrees on.

    ``obj+0x11C`` is carried as ``phase`` and is **not** hit points: `-1` means
    the Init draws a random start frame for the clip, which is how a row of
    identical set-pieces avoids animating in lockstep.
    """
    if prog is None:
        return {}
    raw = prog.evt.raw
    out: dict[str, dict] = {}
    for rec in evtlib.spawns(prog.evt):
        if rec.cls != 0x24:
            continue
        t = rec.offset + 0x24
        if t + 0x16 > len(raw):
            continue
        s16 = lambda o: struct.unpack_from("<h", raw, t + o)[0]   # noqa: E731
        out[str(rec.offset)] = {
            "selector": struct.unpack_from("<b", raw, t + 0x05)[0],
            "removePath": s16(0x06),
            "removeFrame": s16(0x08),
            "motion": s16(0x0A),
            "hold": s16(0x0C),
            "cuePath": s16(0x0E),
            "cueFrame": s16(0x10),
            "cue2Path": s16(0x12),
            "cue2Frame": s16(0x14),
            "phase": rec.hp,
        }
    return out


def scripted_humanoids_json(prog) -> dict:
    """Class 0x25's bytecode, decoded — see `game/class25`.

    `ScriptedHumanoidInit` (`FUN_004840D0`) reads a pointer out of the tail at
    `+0x0C` to a **command block**, installs `ScriptedHumanoidUpdate`
    (`FUN_004842A0`) and never runs again. The block opens with a four-word
    header and is followed by a list of 8-byte commands the VM walks.

    The commands are emitted as a flat list with jumps resolved to an **index**
    into it, because the engine's `op 15` carries an absolute pointer into the
    loaded evt and an index is the same edge without the address.

    All 137 blocks the six stages reach decode with every opcode in `0..18` or
    `-1`, which is the check that the command length rules are right: one wrong
    length desynchronises the stream and the opcodes go out of range
    immediately.
    """
    if prog is None:
        return {}
    raw = prog.evt.raw
    out: dict[str, dict] = {}
    for rec in evtlib.spawns(prog.evt):
        if rec.cls != 0x25:
            continue
        tail = rec.offset + 0x24
        blk = charmotion.humanoid_block_offset(prog.evt, rec)
        if blk is None:
            continue

        # The walk lives in `charmotion` because `characters` needs the same
        # one to bake the clips `op 2` and `op 3` name -- see
        # :func:`charmotion.humanoid_command_offsets`.
        order = charmotion.humanoid_command_offsets(prog.evt, rec)
        index = {off: i for i, off in enumerate(order)}

        cmds: list[dict] = []
        for off in order:
            op, mode, a, b = struct.unpack_from("<4h", raw, off)
            c: dict = {"op": op, "mode": mode, "a": a, "b": b}
            if charmotion.humanoid_cmd_len(op, mode) == 16:
                c["f0"], c["f1"] = struct.unpack_from("<2f", raw, off + 8)
            if op == 15:
                t = prog.evt.to_offset(
                    struct.unpack_from("<I", raw, off + 4)[0])
                c["next"] = index.get(t, -1) if t is not None else -1
            cmds.append(c)

        hdr = struct.unpack_from("<4h", raw, blk)
        out[str(rec.offset)] = {
            "charType": struct.unpack_from("<b", raw, tail)[0],
            "removePath": struct.unpack_from("<h", raw, tail + 2)[0],
            "removeFrame": struct.unpack_from("<h", raw, tail + 4)[0],
            "flags2": hdr[1],
            "motion": hdr[2],
            "phase": hdr[3],
            "cmds": cmds,
        }
    return out


def breakables_json(tables, prog) -> dict:
    """The class-0x41 breakable-prop tables the port needs to place a group.

    Spawn class 0x41 is a placer: `PropContainerPlacerUpdate` (`FUN_00461CD0`)
    dispatches ``obj+0x130C`` through 79 constructors and then kills itself.
    Type 0 is `PlaceBreakableGroup` (`FUN_00462A80`), which reads its members
    out of the **exe**, not the evt -- so the port cannot place them from the
    spawn descriptor alone and this block has to travel with the stage.

    All nine groups are emitted, indexed by group id, because the placer picks
    one by ``obj+0x11C`` at run time and a stage-filtered list would have to be
    re-indexed. Forty-two records is nothing next to the geometry.

    ``hull`` is `g_breakable_hull_points`, which
    `BreakablePropGroundContact` (`FUN_00465590`) needs to settle a toppled
    prop, and ``placements`` names the type-0 spawns so the player can show
    which script address placed which group.
    """
    placements = _container_placements(prog)
    return {
        "groups": tables.breakable_groups(),
        "hull": [list(p) for p in tables.breakable_hull_points()],
        "falling_hull": [list(p) for p in tables.falling_hull_points()],
        "kinds": tables.prop_kind_params(),
        "placements": placements,
        "level_height": tables.BREAKABLE_LEVEL_HEIGHT,
    }


def breakable_slot_entry(stage, prog=None) -> dict | None:
    """A hidden rig holding the breakable props' models, for the client to clone.

    Class 0x41's props are built at run time by `PlaceBreakableGroup`, not
    placed by the exporter, so there is no node per prop to emit -- the client
    makes one per live prop and needs a template to copy. Same shape as the
    gore rig: one part per asset slot, hidden, cloned by slot.

    The four slots are every one `BreakablePropUpdate` can draw: the whole
    prop, the cracked one it swaps to on the first shot, the `g_GameMode == 2`
    one-shot target, and the ground shadow. They all live in `komono_2.bin` --
    *komono*, small items -- which is not part of any stage's geometry set, so
    it is loaded on demand here exactly as the scripted props are.
    """
    from . import rigs as rigslib

    slots = stage.tables.asset_slots()
    cache: dict[str, tuple] = {}
    parts: list[tuple] = []
    # The three container families draw from a fixed set; the generic props
    # each name their own slot in the spawn descriptor, so those come from the
    # stage's own placements and differ per stage.
    want = list(BREAKABLE_SLOTS)
    for pl in _container_placements(prog):
        if pl["container"] != "generic":
            continue
        # The literals this type's routine draws, always; plus the descriptor
        # slot for the three types that read `obj+0x28C`. A type that is only
        # ever handed a lifetime contributes nothing, which is what stops
        # `+0x11C == 2` being exported as `char_adv03.bin`.
        for slot in GENERIC_STATIC_SLOTS.get(pl["type"], ()):
            if slot not in want:
                want.append(slot)
        if pl["type"] in GENERIC_DESCRIPTOR_SLOT and pl["slot"] not in want:
            want.append(pl["slot"])
    for slot in want:
        rec = slots.get(slot)
        if not rec:
            continue
        stem = rec[0].removesuffix(".bin")
        if stem not in cache:
            try:
                cache[stem] = stagelib.load_asset(stage.game, stem)
            except Exception as exc:
                degraded.note(f"breakable prop asset {stem}",
                              f"slot {slot:#06x} draws nothing", exc)
                cache[stem] = ([], None)
        models, bank = cache[stem]
        if rec[1] >= len(models):
            continue
        part = rigslib.RigPart(f"slot_{slot:04x}", (slot,),
                               note=f"breakable prop, slot {slot:#06x}")
        parts.append((part, [(models[rec[1]], bank, stem)]))
    if not parts:
        return None
    rig = rigslib.Rig(name="slots_breakable",
                      routine="class 0x41 (BreakablePropUpdate)",
                      world_space=False, parts=tuple(p for p, _ in parts),
                      note="breakable prop models; hidden, cloned per live prop")
    return {"rig": rig, "routes": [], "anchors": {}, "biases": {},
            "world": False, "placements": [], "blocked": "",
            "fixed": [{"kind": "fixed", "translation": [0.0, 0.0, 0.0],
                       "rotation_bams": [0, 0, 0], "cam_paths": [],
                       "note": rig.note}],
            "parts": parts}


def backdrop_json(tables, prog) -> dict:
    """The backdrop dome presets, plus the ones this scene's script selects.

    The dome models need no special export: every preset a stage uses is
    already pulled in, because the script loads its asset slot with opcode
    0x50 and `Stage.geometry()` includes those. The client finds them by the
    `hod2_slot` extras the glTF nodes already carry.
    """
    used: dict[int, int] = {}
    for b in prog.live_blocks():
        for st in b.steps:
            for op in st.ops:
                if op.opcode == 0x1B:
                    v = op.detail.get("value")
                    if isinstance(v, int):
                        used[v] = used.get(v, 0) + 1
    return {
        "presets": tables.backdrop_presets(),
        "used": sorted(used),
        "note": "evt 0x1B selects a preset, 0x1C the mode (0 off, 2 frozen, "
                "else animating). Drawn at (camera.x, camera.y + dy, "
                "camera.z), spun about Y by spin_bams per frame, scaled "
                "(1.2, 1.2, -1.2) -- the negative Z turns it inside out.",
    }


def rigs_json(instances, blocked, campaths, campaths_tables) -> dict:
    """The rig routes, gates and animation rules the client needs.

    The **geometry** goes into the glTF as ordinary nodes; this is the part
    that cannot: which `op_` path each instance rides, which `cp_` camera
    paths select it, and the runtime rules the transcription records but
    cannot bake.

    The player evaluates the path itself rather than riding a baked animation,
    which is why the bundle keeps the *slot* -- it can then honour the frame
    clamp and the position bias exactly, at any frame, including while
    scrubbing.
    """
    out = []
    for inst in instances:
        rig = inst["rig"]
        routes = []
        for r in inst["routes"]:
            ref = campaths.get(r["slot"])
            routes.append({
                "slot": r["slot"],
                "bias": list(r["bias"]),
                # The routines clamp with the EXE's per-path play length, NOT
                # the curve's own extent -- and only at the top:
                #     n = min(current_frame, CAM_PATH_LENGTH[slot])
                # For op_ slot 334 the curve runs 40..370.2 while the table
                # says 370, so clamping to the curve's *start* would hold the
                # object still for the first 40 frames instead of letting the
                # evaluator extrapolate back along the opening segment, which
                # is what the game does.
                "length": campaths_tables.cam_path_length(r["slot"]),
                # Set when the routine passes a literal evaluation time rather
                # than the clamped camera frame -- the object is parked at a
                # fixed point on the path, not riding it.
                "hold_frame": r.get("hold_frame"),
                # The routine's own "stop re-evaluating" test, which is not
                # always the path length: St1VehicleUpdate stops at 0x15D
                # (349) where op 0xFE's length is 350.
                "stop_frame": r.get("stop_frame"),
                # What the routine does when the path runs out. The
                # transcription records it per route; it is the difference
                # between "the object vanishes" and "the object freezes and
                # swaps model", which look very different on screen.
                "note": r.get("note", ""),
                # Empty means ungated: the rig is present whatever the camera
                # is doing. Otherwise it rides only while one of these cp_
                # slots is the active camera path.
                "cam_paths": r["cam_paths"],
                "file": ref.file if ref else None,
                "index": ref.index if ref else None,
                "duration": ref.duration if ref else None,
            })
        out.append({
            "name": rig.name,
            "routine": rig.routine,
            "note": rig.note,
            "routes": routes,
            "world_space": rig.world_space,
            "spawn_class": rig.spawn_class,
            # Rules the transcription records rather than bakes, so the client
            # can show them instead of pretending the part is static.
            "animated_parts": [
                {"part": p.name, "rule": p.animated, "condition": p.condition}
                for p, _models in inst["parts"] if p.animated or p.condition
            ],
        })
    return {
        "rigs": out,
        "blocked": [{"name": r.name, "routine": r.routine,
                     "reason": r.placement_blocked} for r in blocked],
        "note": "Object rigs are transcribed draw routines, not asset data -- "
                "there is no rig format. See docs/formats/rigs.md and "
                "hod2lib/rigs.py.",
    }


def civilians_json(prog, tables) -> dict:
    """Class 0x10's spawns and the exe's civilian scripts — see `game/class10`.

    Unlike class 0x24 and class 0x25, whose parameters live in the evt, a
    civilian's behaviour is a **command stream compiled into Hod2.exe**:
    `CivilianInit` (`FUN_0048A3E0`) indexes the 67-entry table at
    `g_civilian_scripts` (0x005702A8) with the spawn tail's byte at `+0x01`.

    So this emits two things — the streams once, decoded by
    `ExeTables.civilian_scripts`, and the per-spawn tail that selects one.
    Keyed by the spawn's script address, like every other class here.

    The tail, from `CivilianInit`'s own reads:

    ```
    tail+0x00  s8   character type      -> obj+0x1F4
    tail+0x01  s8   script index        -> g_civilian_scripts[n]
    tail+0x02  s16  removal cam path    -> sub+0x26
    tail+0x04  s16  removal cam frame   -> sub+0x28
    tail+0x06  s16  removal delay       -> sub+0x2A, once the cue is met
    tail+0x08  u32  part list           -> model+0x1170
    tail+0x0C  s32  child count         -> sub+0x1E
    tail+0x10  u32[] child descriptors  -> SpawnFromDescriptor, each
                                          parented at child+0x1394
    ```
    """
    if prog is None or tables is None:
        return {}
    raw = prog.evt.raw
    spawns: dict[str, dict] = {}
    for rec in evtlib.spawns(prog.evt):
        if rec.cls != 0x10:
            continue
        t = rec.offset + 0x24
        if t + 0x10 > len(raw):
            continue
        n = struct.unpack_from("<i", raw, t + 0x0C)[0]
        kids: list[dict] = []
        for k in range(max(0, min(n, 32))):
            off = prog.evt.to_offset(
                struct.unpack_from("<I", raw, t + 0x10 + k * 4)[0])
            if off is None or off > len(raw) - 0x24:
                continue
            # The children are **not** script spawns: nothing in the evt's
            # instruction stream points at these descriptors, so the walker
            # never sees them and the civilian's own Init is the only thing
            # that builds them. They come out whole for that reason.
            kid = evtlib.read_spawn(prog.evt, off, 0x0B)
            res = spawnreslib.resolve_spawn(tables, kid)
            kids.append({
                "at": off, "class": kid.cls, "charType": res.char_type,
                "pos": list(kid.pos), "yaw": kid.orient[1], "hp": kid.hp,
            })
        spawns[str(rec.offset)] = {
            "charType": struct.unpack_from("<b", raw, t)[0],
            "script": struct.unpack_from("<b", raw, t + 1)[0],
            "removePath": struct.unpack_from("<h", raw, t + 2)[0],
            "removeFrame": struct.unpack_from("<h", raw, t + 4)[0],
            "removeDelay": struct.unpack_from("<h", raw, t + 6)[0],
            "children": kids,
        }
    if not spawns:
        return {}
    return dict(tables.civilian_scripts(), spawns=spawns)


def build_stage(stage, out_root: Path, *, glb: bool = True,
                write_textures: bool = True, unlit: bool = True,
                cam_step: float = 2.0, progress=None) -> dict:
    """Write one stage's directory and return its manifest entry.

    Geometry is exported with ``--no-cameras``: the player draws camera rails
    itself, from the raw curves in ``<stage>.cam.json``, so it can colour them
    by playback state and highlight the ``start..end`` sub-range one
    ``queue_event`` command covers. A baked glTF animation can express
    neither.
    """
    say = progress or (lambda *_: None)
    # The count belongs to this stage, so it starts here rather than at the
    # top of the process. `export_player.py` builds up to twelve of these in
    # one run and a single running total would say nothing about which one
    # came out short.
    degraded.reset()
    name = stage.name
    out_dir = out_root / name
    out_dir.mkdir(parents=True, exist_ok=True)

    say(f"  {name}: geometry")
    parts, model_regions, regions = stage.geometry()

    # Rig geometry travels in the glTF, but *unparented*: the bundle exports
    # no camera nodes, so there is no baked animation to hang a rig under.
    # Passing `anchors = {slot: None}` makes the writer emit each instance as
    # a scene node tagged `hod2_path_slot`, which the client then drives from
    # the raw `op_` curve -- the same trick the camera rails use.
    # The rain particle model is drawn by FUN_004136A0, which no region lists
    # and no asset opcode loads -- it is referenced only as a literal slot id
    # in the effect routine. Append it as its own part with an empty region
    # list so the client can adopt it by slot, exactly as it does the dome.
    rain = rain_json(stage.tables, scriptlib.Program(stage))
    if rain["file"]:
        try:
            models, bank = stagelib.load_asset(
                stage.game, rain["file"].removesuffix(".bin"))
        except Exception as exc:
            degraded.note(f"the rain particle asset {rain['file']}",
                          "no rain model, so the stage draws no rain", exc)
            models = []
        if rain["entry"] is not None and rain["entry"] < len(models):
            parts = list(parts) + [("rain_fx", [models[rain["entry"]]], bank)]
            model_regions = dict(model_regions)
            model_regions[("rain_fx", 0)] = {
                "regions": [], "draw_mode": 0,
                "slot": rain["slot"], "entry": rain["entry"],
            }

    say(f"  {name}: object rigs")
    rig_instances, rig_blocked = rigslib.resolve_for_stage(stage)
    rig_data = [dict(inst, anchors={r["slot"]: None for r in inst["routes"]},
                     biases={})
                for inst in rig_instances]

    # Spawned characters ride the same writer: a skeleton is a tree of named
    # parts with a translation and an asset slot, which is exactly a rig. They
    # are appended to the glTF list only -- `rigs_json` below is built from
    # `rig_instances`, so a character never turns up as an object rig.
    say(f"  {name}: characters")
    char_defs, char_places, char_entries = charlib.resolve_for_stage(stage)

    # Scripted scenery -- the doors, shutters and vans the script opens. Same
    # writer again: a prop is one model at a pose, which is a rig with a fixed
    # placement.
    say(f"  {name}: scripted props")
    hinges, statics = propslib.resolve_for_stage(stage)
    prop_entries = propslib.rig_entries(stage, hinges, statics)

    # Before the glTF: the template rig has to include every asset slot the
    # stage's generic props name, and only the script knows which those are.
    prog = scriptlib.Program(stage)
    brk = breakable_slot_entry(stage, prog)
    info = gltf.export_level(
        name, parts, out_dir,
        rigs=rig_data + char_entries + prop_entries + ([brk] if brk else []),
        write_textures=write_textures,
        cam_files=[],                  # rails are drawn client-side
        unlit=unlit, model_regions=model_regions, glb=glb)

    say(f"  {name}: camera paths")
    cam_json = stage.campaths().to_json()
    # `allow_nan=False` on purpose: Python writes bare `NaN` and `Infinity`,
    # which are not JSON and which every browser rejects with a parse error
    # naming a byte offset rather than a field. A bundle that cannot be parsed
    # is worse than an export that fails, so this raises here instead.
    # Every file a stage directory holds names the format it was written in,
    # not just the manifest that indexes them. A manifest is rewritten by any
    # export; these are not, so a `stage2/` copied in from an older bundle --
    # or carried forward by `export_player.py` because its files were still on
    # disk -- is otherwise a stale stage inside a fresh bundle, which is the
    # one arrangement a single top-level version can never see.
    cam_json["format"] = BUNDLE_FORMAT
    (out_dir / f"{name}.cam.json").write_text(
        json.dumps(cam_json, allow_nan=False))

    say(f"  {name}: event script")
    script_json = prog.to_json()
    script_json["format"] = BUNDLE_FORMAT      # see the note on `cam.json`
    # The region table travels with the script because the client's region
    # visibility is driven by opcodes 0x28/0x29, and it needs to resolve a
    # region id to the models that region draws. glTF nodes carry
    # extras.hod2_regions for the same join from the other side.
    script_json["regions"] = stage.region_json()
    script_json["cam_slots_used"] = prog.cam_slots_used()
    script_json["bgm"] = bgm_json(stage.tables, stage.stage, stage.game_mode)
    script_json["sound"] = sound_json(stage.tables)
    script_json["backdrop"] = backdrop_json(stage.tables, prog)
    script_json["rigs"] = rigs_json(rig_instances, rig_blocked,
                                    stage.campaths(), stage.tables)
    script_json["rain"] = rain
    script_json["characters"] = charlib.characters_json(char_defs, char_places, stage.tables)
    script_json["props"] = propslib.props_json(stage.tables, hinges, statics)
    script_json["breakables"] = breakables_json(stage.tables, prog)
    script_json["set_pieces"] = set_pieces_json(prog)
    script_json["humanoids"] = scripted_humanoids_json(prog)
    script_json["civilians"] = civilians_json(prog, stage.tables)
    (out_dir / f"{name}.script.json").write_text(
        json.dumps(script_json, allow_nan=False))

    n_spawns = sum(len(o.detail.get("spawns", ()))
                   for b in prog.live_blocks() for s in b.steps for o in s.ops)
    # Drained here, at the end of the stage and before the entry is built, so
    # the list is exactly what this stage lost. See `degraded.py`.
    lost = degraded.drain()
    entry = {
        "name": name,
        # The entry's own format, which is not the manifest's: a partial
        # export carries forward the entries it did not rebuild, so a fresh
        # manifest can index a stage directory written by an older tool.
        "format": BUNDLE_FORMAT,
        "stage": stage.stage,
        "scene": stage.scene,
        "game_mode": stage.game_mode,
        "geometry": Path(info["gltf"]).name,
        "cam": f"{name}.cam.json",
        "script": f"{name}.script.json",
        "counts": {
            "parts": len(parts),
            "models": sum(len(m) for _n, m, _b in parts),
            "triangles": sum(m.triangle_count for _n, ms, _b in parts
                             for m in ms) - info["dropped_collapsed_uv"],
            "materials": info["materials"],
            "textures": info["textures"],
            "regions": len(regions),
            "blocks": len(prog.live_blocks()),
            "branch_points": len(prog.branch_blocks()),
            "cam_paths": len(stage.campaths()),
            "spawns": n_spawns,
            "rigs": info.get("rigs", 0),
            "characters": len(char_defs),
            "props": len(hinges) + len(statics),
            "posed_spawns": sum(1 for p in char_places if p.motion is not None),
            # **Zero is the only good value here.** Every other count says how
            # much is in the bundle; this one says how much of the game did
            # not make it, because something under `hod2lib` answered a
            # failure with an empty result. It answered *silently* until F16.
            "degraded": len(lost),
        },
        # And what each one was. A bundle missing a stage's characters should
        # be able to say so without the export log, which nobody keeps.
        "degraded": lost,
        "sources": {},
    }
    for p in stage.source_files():
        try:
            rel = p.relative_to(stage.game)
        except ValueError:
            rel = Path(p.name)
        entry["sources"][str(rel).replace("\\", "/")] = _sha256(p)
    return entry


def write_manifest(out_root: Path, stages: list[dict], *, game_dir: Path,
                   notes: dict | None = None) -> Path:
    """Write ``manifest.json``: what is in the bundle and what it came from.

    Carries the schema digest as well as the version, so the client can tell
    "this bundle predates a field you read" from "this bundle is fine".
    """
    doc = {
        "format": BUNDLE_FORMAT,
        # The digest of the TypeScript declarations this bundle was written
        # to satisfy. `BUNDLE_FORMAT` above is bumped by hand and therefore
        # sometimes is not; this moves whenever a declaration in
        # `web/src/bundle/` does, which is the drift it exists to catch.
        # `web/src/bundle/stage.ts` refuses a bundle whose digest is not the
        # one it was compiled against. See `hod2lib/schema.py`.
        "schema": {
            "hash": schemalib.schema_hash(),
            "files": schemalib.file_digests(),
        },
        "tool": "hod2lib",
        "tool_version": __version__,
        "built": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "game_dir": str(game_dir),
        "fps": 60,
        # Recovered from SetupSceneProjection. A compile-time constant for the
        # whole game -- there is no zoom and no per-camera FOV.
        "projection": {
            "yfov_deg": 41.100,
            "yfov_bams": gltf.CAM_FOV_BAMS,
            "aspect": 4.0 / 3.0,
            "znear": gltf.CAM_ZNEAR,
            "zfar": gltf.CAM_ZFAR,
        },
        "stages": stages,
    }
    if notes:
        doc["notes"] = notes
    path = out_root / "manifest.json"
    path.write_text(json.dumps(doc, indent=1))
    return path
