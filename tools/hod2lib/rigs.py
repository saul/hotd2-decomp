"""
Hand-coded object rigs, recovered from their draw routines.

A `cam/` `op_` path moves *something*, but that something is rarely one model.
The objects that follow object paths are rigs assembled in code: a draw routine
walks the matrix stack, pushing a transform and calling ``AssetDrawSlot`` for
each part. There is no rig data in the asset files at all -- the hierarchy only
exists as instructions.

So reproducing one means transcribing its routine. This module holds the
transcriptions, as data, with the routine each came from named so it can be
checked.

Conventions, all established in ``docs/formats/cam.md``:

* Translations are in level units, rotations in BAMS (65536 = a full turn).
* A part's transform is applied ``T * Rz * Ry * Rx * S`` in the engine's
  column-vector convention, the same order the object root uses.
* ``MatrixStackPush(0)`` duplicates the top, so every part in a routine is a
  **sibling** whose transform is relative to the object root -- not a chain.
* A part may draw more than one slot at the same transform.

Parts whose rotation is driven at runtime carry ``animated`` describing the
rule rather than baking a frame of it in. Nothing here invents a value.
"""

from __future__ import annotations

from dataclasses import dataclass, field

__all__ = ["RigPart", "Rig", "RIGS", "rig_for_slot"]

Vec3 = tuple[float, float, float]


@dataclass(frozen=True)
class RigPart:
    name: str
    slots: tuple[int, ...]                 #: AssetDrawSlot ids, drawn in order
    translation: Vec3 = (0.0, 0.0, 0.0)
    rotation_bams: Vec3 = (0, 0, 0)        #: (rx, ry, rz)
    scale: Vec3 = (1.0, 1.0, 1.0)
    draw_layer: int | None = None          #: SetDrawLayerNibble, if overridden
    animated: str = ""                     #: runtime rule, not baked
    condition: str = ""                    #: when the routine draws it at all
    note: str = ""


@dataclass(frozen=True)
class Rig:
    name: str
    routine: str                           #: the draw routine transcribed
    path_slots: tuple[int, ...]            #: global cam path slots it follows
    parts: tuple[RigPart, ...] = field(default_factory=tuple)
    note: str = ""


#: Drawn only while the object is moving. FUN_0048E600 sets obj+0x1320 when the
#: camera is on cp_st1 0 or 1, and clears it on cp_st1 2 and once cp_st1 1 has
#: run past frame 0x15D.
_MOVING = "only while obj+0x1320 (moving) is set"

#: The stage-1 opening vehicle. `FUN_0048E600` picks its route from the camera
#: path -- cp_st1 0/1/2 (0x20/0x21/0x22) select op_st1 0/1/2 (0xFD/0xFE/0xFF) --
#: so the object runs in lockstep with the shot.
ST1_VEHICLE = Rig(
    name="st1_vehicle",
    routine="FUN_0048E600",
    path_slots=(0xFD, 0xFE, 0xFF),
    note="Draws car_pl.bin parts and char_adv00.bin occupants. Route selected "
         "by the active camera path, so it only moves during cp_st1 0/1/2.",
    parts=(
        RigPart("body", (0x1579, 0x157E),
                note="drawn at the object root, no local transform"),
        # two MatrixTranslate calls in a row compose: (-4.6755,0,0.239)+(0,9,6)
        RigPart("part_898", (0x0898,),
                translation=(-4.6755, 9.0, 6.239),
                rotation_bams=(0xD000, 0, 0),
                note="two consecutive MatrixTranslate calls, composed here"),
        RigPart("part_8cc", (0x08CC,),
                translation=(0.0, 10.739, 11.4021),
                rotation_bams=(-7168, 0, 0),
                animated="RotZ by ftol(sin(DAT_009A32A0 << 9)) between the two "
                         "RotX steps, then RotX(+7168); only the first RotX is "
                         "baked here",
                note="the second RotX(+0x1C00) cancels the first when the "
                     "sin-driven RotZ is zero"),
        # 11.3 tall, 11.7 deep, seated either side at y 9.4 -- they read as
        # the two occupants, but that is inference from the shape and place.
        RigPart("side_left", (0x157C, 0x157D),
                translation=(-10.0702, 6.1773, 6.8503),
                draw_layer=0xC,
                animated="RotY by obj+0x1334",
                note="[likely] an occupant; drawn in layer 0xC, then the "
                     "routine restores layer 8"),
        RigPart("side_right", (0x157A, 0x157B),
                translation=(10.077, 6.211, 6.8302),
                animated="RotY by -obj+0x1334",
                condition="the RotY is applied only while obj+0x1324 is set, "
                          "which happens when two players are in play",
                note="[likely] the other occupant"),
        # 20.8 wide -- the full track -- and spun about X at 0x2000 a frame,
        # which is 45 deg/frame or 7.5 turns a second at 60 Hz. Reads as a
        # wheel pair rather than an axle, but the routine does not say.
        RigPart("spinner_front", (0x157F,),
                translation=(0.0, 3.8497, 16.2239),
                animated="RotX by obj+0x1330, which gains 0x2000 a frame while "
                         "obj+0x1320 (moving) is set"),
        RigPart("spinner_rear", (0x1580,),
                translation=(0.0, 3.8497, -12.6732),
                animated="RotX by obj+0x1330"),
        # Wheels: AssetDrawSlot(DAT_009A32A0 % 0xC + 0x8CE) -- a 12-frame cycle
        # on a global counter. Frame 0 is emitted. The right pair is the left
        # model mirrored with MatrixScale(-1, 1, 1).
        RigPart("wheel_fl", (0x08CE,), translation=(-9.63, 0.0, 15.989),
                animated="model cycles DAT_009A32A0 % 12 + 0x8CE",
                condition=_MOVING),
        RigPart("wheel_fr", (0x08CE,), translation=(9.63, 0.0, 15.989),
                scale=(-1.0, 1.0, 1.0),
                animated="model cycles DAT_009A32A0 % 12 + 0x8CE",
                condition=_MOVING),
        RigPart("wheel_rl", (0x08CE,), translation=(-9.63, 0.0, -12.9132),
                animated="model cycles DAT_009A32A0 % 12 + 0x8CE",
                condition=_MOVING),
        RigPart("wheel_rr", (0x08CE,), translation=(9.63, 0.0, -12.9132),
                scale=(-1.0, 1.0, 1.0),
                animated="model cycles DAT_009A32A0 % 12 + 0x8CE",
                condition=_MOVING),
    ),
)

#: Every transcribed rig. One so far -- the others need their routines read.
RIGS: tuple[Rig, ...] = (ST1_VEHICLE,)


def rig_for_slot(path_slot: int) -> Rig | None:
    """The rig that follows a given global cam path slot, if one is known."""
    for rig in RIGS:
        if path_slot in rig.path_slots:
            return rig
    return None
