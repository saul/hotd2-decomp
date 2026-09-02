"""Scripted scenery: doors, shutters, windows and the vans they hang off.

The zombies that lunge at you out of the back of a van in stage 2 are not
standing in the open waiting for the camera. They are inside a van, and the
doors swing apart on a script cue. That mechanism is this module.

## Where a prop comes from

Two spawn classes matter, and they usually sit at the *same position* because
they are two halves of one set piece:

* **class 0x33, selector 2** (`FUN_00433A10`) is a **static scripted prop**::

      if (params[3] != g_cam_path_frame && !g_script_flags[params.u8(0x11)]) {
          Translate(obj.pos); RotZ(obj.rz); RotY(obj.yaw); RotX(obj.rx);
          Scale(1,1,1); AssetDrawSlot(params[0]);
      } else ActorKill();

  -- one model, drawn at the spawn's own pose, which disappears when a script
  flag is set or the camera path reaches a given frame. The van body is one of
  these.

* **class 0x44** (`FUN_00472B10`) is a **prop placer**: it dispatches on
  ``obj+0x11C`` through the 18 builders at ``0x00595AB8`` and each builds child
  actors. Selectors **1, 2 and 4 all share one child behaviour**,
  `HingeUpdate` (`FUN_00473CF0`) -- 53 of the 123 class-0x44 spawns in the
  game -- and that behaviour is a hinge.

## The hinge

`HingeUpdate` (`FUN_00473CF0`), per frame:

```c
if (remove_flag >= 0 && g_script_flags[remove_flag]) { despawn(); }
if (g_script_flags[open_flag]) {
    f = frame++;                       /* obj+0x2A8; stops at 60, 130 on 4 */
    if (curve in {0, 2, 3}) {          /* 6-byte {s16 rx, ry, rz} frames */
        rx = xyz[curve][f].rx;  rz = xyz[curve][f].rz;
        ry = xyz[curve][f].ry;         /* MOVSX -- signed */
    } else {                           /* u16 yaw-only frames */
        rx = rz = 0;  ry = y[curve][f];   /* XOR EDX,EDX; MOV DX -- unsigned */
    }
    obj.rz  = base_rz + rz;                            /* never mirrored */
    if (side > 0) { obj.rx = base_rx + rx; obj.yaw = +ftol(ry * scale); }
    else          { obj.rx = base_rx - rx; obj.yaw = -ftol(ry * scale); }
}
Translate(pos); RotY(base_yaw); RotZ(obj.rz); RotY(obj.yaw); RotX(obj.rx);
Scale(scale); AssetDrawSlot(slot);
```

Note the two Y rotations with a Z between them: the hinge's *mounting* yaw and
its *swing* are separate, which is what lets one pair of curves serve doors
mounted at any angle. `side` mirrors the swing, so a pair of doors opens
outward from one curve.

## `side` is read for its sign; its magnitude belongs to something else

``side`` is ``obj+0x1DC``, and `HingeUpdate` touches it exactly twice:

* ``TEST EAX,EAX; JLE`` at ``0x00473EE6``. The two arms differ only in
  ``ADD ECX`` vs ``SUB ECX`` on the X angle and a ``NEG EAX`` on the yaw --
  a **sign test**. The magnitude reaches neither angle.
* ``IMUL EAX, [ESI+0x1DC]`` at ``0x00473FB5`` -- the amplitude, in BAMS, of the
  damped yaw wobble the prop does when it is **shot**.

So it is a wobble amplitude whose sign also picks the side.
`PropBuildVanDoors` (`FUN_00472C90`) hands those two doors a literal -1 and
+1, which is what makes it look like a pure mirror; selectors 1 and 4 read an
authored ``i32``, and stage 1 has four
hinges carrying **+/-512 and +/-416**. A consumer that multiplies by it rather
than by its sign throws those four doors through ~100 turns of X at the frame
where the curve's slam judder peaks. The player did exactly that until it was
found; see ``docs/PLAYER_PROGRESS.md``.

``scale`` is ``obj+0x2C0``: all three constructors seed it ``1.0f`` and
neither `HingeUpdate` nor the draw path writes it, so the ``FMUL`` is an
identity and it is not exported. ``base_rx``/``base_rz`` (``obj+0x1CC`` and
``obj+0x1D4``) are never written by any of the three either, so they are the
pool's zero.

## The curves

Four, and they are baked keyframes rather than a spring:

| Curve | Frames | Shape |
|---|---|---|
| 0 | 60 | flung to 111.9 deg by frame ~20, rebounding to 85.9 |
| 1 | 60 | smooth ease to 122.6 deg, held |
| 2 | 60 | **the van doors** -- 179.1 deg by frame 12, settling to 137.0 |
| 3 | 60 | flung to 91.3 deg, rebounding to 64.4 |
| 4 | 130 | curve 1's shape stretched over 130 frames |

Curves 0, 2 and 3 carry a small X and Z wobble alongside the yaw; 1 and 4 are
yaw only, and live in a separate table.

## What is not here

`HingeUpdate` also has an impact wobble -- when the prop is shot, a flag on
``obj+0x34`` starts ``obj+0x1E8 += 0x1000`` and swings the yaw by a sine of it
until it passes 0x10000, i.e. one damped cycle over 16 frames. There is no
shooting in the player, so it is transcribed in the notes and not run.

The other fifteen class-0x44 builders have their own child behaviours
(`0x473B90`, `0x474120`, `0x474240`, ...) and are not decoded.
"""

from __future__ import annotations

import struct
from dataclasses import dataclass, field

__all__ = ["Hinge", "StaticProp", "hinge_curve", "resolve_for_stage",
           "props_json"]

#: `FUN_00472B10`'s 18 builders, indexed by ``obj+0x11C``.
PROP_BUILDERS = 0x00595AB8
#: 6-byte ``{s16 rx, s16 ry, s16 rz}`` frames, for curve selectors 0, 2 and 3.
HINGE_CURVES_XYZ = 0x005960B4
#: ``u16`` yaw-only frames, for the others.
HINGE_CURVES_Y = 0x005960C8
#: `HingeUpdate` stops posing here -- ``CMP EDI,0x82; JGE`` on curve 4,
#: ``CMP EDI,0x3C; JL`` on the rest, so the last frame it reads is 129 or 59.
#: These are the frame *counts*.
HINGE_FRAMES = {4: 0x82}
HINGE_FRAMES_DEFAULT = 0x3C
#: The selectors `HingeUpdate` sends to `HINGE_CURVES_XYZ`; every other one
#: goes to the yaw-only table. An explicit ``AX == 0 / 2 / 3`` switch at
#: 0x00473E8D, not a test of whether the pointer is populated.
HINGE_CURVES_XYZ_SELECTORS = (0, 2, 3)

#: The two rear doors selector 2 builds, from `PropBuildVanDoors`
#: (`FUN_00472C90`). The offsets are
#: literals in the code and the slots are ``0x1794 + i``; only the van uses it.
VAN_DOOR_SLOT = 0x1794
VAN_DOOR_OFFSETS = ((-9.29, 11.5, 22.68), (9.29, 11.5, 22.68))

BAMS_TO_DEG = 360.0 / 65536.0


@dataclass
class Hinge:
    """One swinging prop -- a door leaf, a shutter, a window."""

    at: int                     #: evt offset of the spawn that built it
    index: int                  #: which child of that spawn
    selector: int               #: the class-0x44 builder that made it
    slot: int
    pos: tuple[float, float, float]
    base_yaw: int               #: BAMS, the mounting angle
    #: ``obj+0x1DC``. Its **sign** mirrors the swing; its magnitude is the
    #: shot-wobble amplitude and must never scale the pose. Not always +/-1:
    #: stage 1 carries +/-512 and +/-416.
    side: int
    curve: int
    open_flag: int              #: script flag that starts the swing
    remove_flag: int            #: script flag that deletes it, or -1
    scale: tuple[float, float, float] = (1.0, 1.0, 1.0)

    @property
    def name(self) -> str:
        return f"prop_{self.at:04x}_{self.index}"

    def to_json(self) -> dict:
        return {"name": self.name, "kind": "hinge", "at": self.at,
                "selector": self.selector, "slot": self.slot,
                "side": self.side, "curve": self.curve,
                "base_yaw": self.base_yaw,
                "open_flag": self.open_flag, "remove_flag": self.remove_flag}


@dataclass
class StaticProp:
    """A class-0x33 selector-2 prop: drawn until a flag or a camera frame."""

    at: int
    slot: int
    pos: tuple[float, float, float]
    rot_bams: tuple[int, int, int]
    remove_flag: int
    #: `params[3]`: the camera path frame it dies on, or None when -1.
    remove_frame: int | None

    @property
    def name(self) -> str:
        return f"prop_{self.at:04x}_s"

    def to_json(self) -> dict:
        return {"name": self.name, "kind": "static", "at": self.at,
                "slot": self.slot, "remove_flag": self.remove_flag,
                "remove_frame": self.remove_frame}


def hinge_curve(tables, sel: int) -> list[tuple[int, int, int]]:
    """One swing curve as ``[(rx, ry, rz), ...]`` in BAMS, frame by frame.

    Which table a selector reads is the exe's own switch, not an inference from
    which pointer is populated. The two agree on the shipped data -- XYZ slots
    1 and 4 are null -- but a rule that holds only by luck is the
    adjacent-array trap waiting for the first re-authored curve.
    """
    n = HINGE_FRAMES.get(sel, HINGE_FRAMES_DEFAULT)
    xyz = tables._v2r(HINGE_CURVES_XYZ)
    yon = tables._v2r(HINGE_CURVES_Y)
    if xyz is None or yon is None or not (0 <= sel < 6):
        return []
    if sel in HINGE_CURVES_XYZ_SELECTORS:
        p = struct.unpack_from("<I", tables.data, xyz + sel * 4)[0]
        o = tables._v2r(p) if p else None
        if o is None:
            return []
        # Three MOVSX loads at 0x00473EC8: every component is signed.
        return [tuple(struct.unpack_from("<3h", tables.data, o + f * 6))
                for f in range(n)]
    p = struct.unpack_from("<I", tables.data, yon + sel * 4)[0]
    o = tables._v2r(p) if p else None
    if o is None:
        return []
    # ``XOR EDX,EDX; MOV DX, word ptr [EAX + EDI*2]`` at 0x00473EAA -- zero
    # extended, so a yaw-only curve past 180 degrees stays past it rather than
    # folding negative. Nothing shipped reaches 0x8000, so this changes no
    # exported byte; reading it the way the exe does is what keeps it true.
    return [(0, struct.unpack_from("<H", tables.data, o + f * 2)[0], 0)
            for f in range(n)]


def posed_rot_bams(hinge: "Hinge", curve, frame: int) -> tuple[int, int, int]:
    """The hinge's orientation at *frame*, as one BAMS ``(rx, ry, rz)`` triple.

    `HingeUpdate` composes ``RotY(base_yaw); RotZ(rz); RotY(swing); RotX(rx)``,
    which is not a single Rz-Ry-Rx Euler as written -- so it is multiplied out
    and decomposed. Used to bake a still for verification; the player applies
    the four rotations directly and never needs this.
    """
    from .characters import bams_from_matrix, rot_matrix
    if not curve:
        return (0, hinge.base_yaw, 0)
    f = max(0, min(frame, len(curve) - 1))
    rx, ry, rz = curve[f]
    # ``TEST EAX,EAX; JLE`` -- the sign of ``side``, never its magnitude.
    mirror = -1 if hinge.side <= 0 else 1
    seq = [rot_matrix((0, hinge.base_yaw, 0)),
           rot_matrix((0, 0, rz)),
           rot_matrix((0, mirror * ry, 0)),
           rot_matrix((mirror * rx, 0, 0))]
    M = seq[0]
    for N in seq[1:]:
        M = [[sum(M[i][k] * N[k][j] for k in range(3)) for j in range(3)]
             for i in range(3)]
    return bams_from_matrix(M)


def _rot_y(bams: int, v):
    """`MatrixRotateY`: ``x' = c*x + s*z, z' = -s*x + c*z``."""
    import math
    a = bams * (math.tau / 65536.0)
    c, s = math.cos(a), math.sin(a)
    return (c * v[0] + s * v[2], v[1], -s * v[0] + c * v[2])


def resolve_for_stage(stage, prog=None):
    """``(hinges, statics)`` for every scripted prop the stage's script places."""
    from . import evt as evtlib, script as scriptlib

    tables = stage.tables
    if prog is None:
        try:
            prog = scriptlib.Program(stage)
        except Exception:
            return [], []

    by_at: dict[int, dict] = {}
    for blk in prog.blocks:
        for step in blk.steps:
            for op in step.ops:
                for sp in op.detail.get("spawns", []) or []:
                    by_at.setdefault(sp["at"], sp)
    try:
        recs = {r.offset: r for r in evtlib.spawns(prog.evt)}
    except Exception:
        return [], []

    hinges: list[Hinge] = []
    statics: list[StaticProp] = []

    for at, sp in sorted(by_at.items()):
        rec = recs.get(at)
        if rec is None or not rec.has_params:
            continue
        sel = sp.get("hp", 0)
        pos = tuple(sp["pos"])
        yaw = sp["orient"][1] & 0xFFFF

        if sp["class"] == 0x33 and sel == 2:
            slot = rec.param(0x00, "u32")
            frame = rec.param(0x0C, "i32")
            flag = rec.param(0x11, "u8")
            if slot:
                statics.append(StaticProp(
                    at=at, slot=slot, pos=pos,
                    rot_bams=(sp["orient"][0] & 0xFFFF, yaw,
                              sp["orient"][2] & 0xFFFF),
                    remove_flag=flag if flag is not None else -1,
                    remove_frame=None if frame in (None, -1) else frame))
            continue

        if sp["class"] != 0x44:
            continue

        if sel == 2:
            # FUN_00472C90: two rear doors at literal offsets, slots 0x1794+i,
            # the second mirrored by half a turn.
            for i, off in enumerate(VAN_DOOR_OFFSETS):
                r = _rot_y(yaw, off)
                hinges.append(Hinge(
                    at=at, index=i, selector=sel, slot=VAN_DOOR_SLOT + i,
                    pos=(pos[0] + r[0], pos[1] + r[1], pos[2] + r[2]),
                    base_yaw=(yaw + i * 0x8000) & 0xFFFF,
                    side=-1 if i == 0 else 1, curve=2,
                    open_flag=rec.param(0x20, "i8") or 0,
                    remove_flag=rec.param(0x21, "i8")))
        elif sel == 1:
            # FUN_00472BD0, reading the parameter tail throughout.
            hinges.append(Hinge(
                at=at, index=0, selector=sel, slot=rec.param(0x04, "u16"),
                pos=pos, base_yaw=yaw, side=rec.param(0x10, "i32") or 0,
                curve=rec.param(0x00, "u16") or 0,
                open_flag=rec.param(0x20, "i8") or 0,
                remove_flag=rec.param(0x21, "i8")))
        elif sel == 4:
            # FUN_00472EB0: as selector 1, but the flags move and it carries a
            # per-instance scale.
            hinges.append(Hinge(
                at=at, index=0, selector=sel, slot=rec.param(0x04, "u16"),
                pos=pos, base_yaw=yaw, side=rec.param(0x0C, "i32") or 0,
                curve=rec.param(0x00, "u16") or 0,
                open_flag=rec.param(0x10, "i8") or 0,
                remove_flag=rec.param(0x11, "i8"),
                scale=(rec.param(0x14, "f32") or 1.0,
                       rec.param(0x18, "f32") or 1.0,
                       rec.param(0x1C, "f32") or 1.0)))

    hinges = [h for h in hinges if h.slot]
    return hinges, statics


def props_json(tables, hinges: list[Hinge], statics: list[StaticProp]) -> dict:
    """The `props` block of ``<stage>.script.json``."""
    used = sorted({h.curve for h in hinges})
    return {
        "hinges": [h.to_json() for h in hinges],
        "statics": [s.to_json() for s in statics],
        # BAMS per frame, so the client can apply them exactly rather than
        # approximating a spring.
        "curves": {str(c): hinge_curve(tables, c) for c in used},
        "note": (
            "Hinged props are class-0x44 selectors 1, 2 and 4, which share the "
            "child behaviour FUN_00473CF0; statics are class 0x33 selector 2. "
            "A hinge swings when its open_flag is set by set_script_flag "
            "(0x48) and vanishes on remove_flag. The transform is "
            "Translate(pos); RotY(base_yaw); RotZ(rz); RotY(swing); RotX(rx), "
            "with rx/rz mirrored and the swing negated when side < 1."),
    }


def rig_entries(stage, hinges: list[Hinge], statics: list[StaticProp],
                open_frame: int | None = None) -> list[dict]:
    """glTF rig entries for the prop geometry, one instance per prop.

    A prop is a single model at a pose, which is the simplest thing the rig
    writer draws -- so it goes through that rather than a third glTF path, the
    same reasoning as characters. One rig per prop rather than one per slot:
    the client has to address each instance separately to swing it, and a
    shared rig with several placements gives them all the same name.

    The models live in `komono_*` and `etc_*` files that are not part of any
    stage's geometry set, so they are loaded here on demand and cached.
    """
    from . import rigs as rigslib, stage as stagelib

    slots = stage.tables.asset_slots()
    cache: dict[str, tuple] = {}

    def asset(stem: str):
        if stem not in cache:
            try:
                cache[stem] = stagelib.load_asset(stage.game, stem)
            except Exception:
                cache[stem] = ([], None)
        return cache[stem]

    out: list[dict] = []
    for p in list(hinges) + list(statics):
        rec = slots.get(p.slot)
        if not rec:
            continue
        models, bank = asset(rec[0].removesuffix(".bin"))
        if rec[1] >= len(models):
            continue
        model = models[rec[1]]
        if isinstance(p, Hinge):
            rot = ((0, p.base_yaw, 0) if open_frame is None else
                   posed_rot_bams(p, hinge_curve(stage.tables, p.curve),
                                  open_frame))
        else:
            rot = p.rot_bams
        part = rigslib.RigPart(
            "body", (p.slot,),
            scale=(p.scale if isinstance(p, Hinge) else (1.0, 1.0, 1.0)),
            note=f"asset slot {p.slot:#06x}")
        rig = rigslib.Rig(
            name=p.name,
            routine=("class 0x44 selector %d (FUN_00473CF0)" % p.selector
                     if isinstance(p, Hinge) else "class 0x33 selector 2"),
            world_space=False, parts=(part,),
            note=("swings on script flag %d" % p.open_flag
                  if isinstance(p, Hinge)
                  else "removed on script flag %d" % p.remove_flag))
        out.append({
            "rig": rig, "routes": [], "anchors": {}, "biases": {},
            "world": False, "placements": [], "blocked": "",
            # A fixed pose is the rig writer's own idiom for "the routine
            # hardcodes where this goes", which is exactly the case here.
            "fixed": [{"kind": "fixed", "translation": list(p.pos),
                       "rotation_bams": list(rot), "cam_paths": [],
                       "note": rig.note}],
            "parts": [(part, [(model, bank, rec[0].removesuffix(".bin"))])],
        })
    return out
