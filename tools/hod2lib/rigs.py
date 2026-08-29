"""
Hand-coded object rigs, recovered from their draw routines.

A `cam/` `op_` path moves *something*, but that something is rarely one model.
The objects that follow object paths are rigs assembled in code: a draw routine
walks the matrix stack, pushing a transform and calling ``AssetDrawSlot`` for
each part. There is no rig data in the asset files at all -- the hierarchy only
exists as instructions.

### Why this is a transcription and not a parser

**[proved]** There is no rig data to parse. The evidence:

* The transforms and slot ids are `PUSH imm32` **in the instruction stream**.
  `FUN_0048E600` at 0x0048E7C7 is `68 79 15 00 00` -- `PUSH 0x1579` -- with no
  table load anywhere near it.
* **168 distinct functions call `AssetDrawSlot`.** A data-driven rig format
  would have one interpreter looping over a part table, not 168 call sites
  spread across the gameplay code.
* The engine does have exactly one table-driven draw path, and it is for
  static scenery: `RegionDrawResidentSet` walks the region tables. Objects do
  not use it.
* NL1 has no node hierarchy either (see `docs/formats/nl1.md`), so the
  hierarchy is not hiding in the model files.

So reproducing one means transcribing its routine. This module holds the
transcriptions, as data, with the routine each came from named so it can be
checked -- and the cost is that each rig has to be read by hand. There are 31
functions calling `CamEvalObjectPath6`; one is transcribed.

What *is* data, and is read rather than transcribed: the per-path play length
at `0x00576D38` (`ExeTables.cam_path_length`), which these routines clamp with.

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
    #: Name of the part this one hangs off, when the routine nests a push
    #: inside another without popping. Empty means a child of the object root,
    #: which is the usual case -- MatrixStackPush(0) duplicates the top, so
    #: parts are normally siblings.
    parent: str = ""
    note: str = ""


@dataclass(frozen=True)
class Rig:
    name: str
    routine: str                           #: the draw routine transcribed
    #: Global cam path slots the routine passes to CamEvalObjectPath6 as a
    #: literal. Empty when it takes the slot from the object at runtime -- the
    #: rig is still exported, just parented at the origin rather than to a
    #: route.
    path_slots: tuple[int, ...] = ()
    #: Spawn class this rig belongs to, when the routine is a class handler
    #: from the table at 0x00593358. A rig with a class can be placed at every
    #: spawn descriptor of that class, which is how objects that take their
    #: path slot from the object at runtime still get exported.
    spawn_class: int | None = None
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
        # AssetDrawSlot(DAT_009A32A0 % 0xC + 0x8CE) -- a 12-frame cycle on a
        # global counter, frame 0 emitted; the right pair is the left model
        # mirrored with MatrixScale(-1, 1, 1). Measured, each is 11.7 long
        # along the travel axis, 2.9 wide and 2.6 tall, sitting at ground level
        # just outside the body -- and it is drawn only while moving. That is a
        # ground effect, not a wheel: the wheels are modelled into the body.
        RigPart("trail_fl", (0x08CE,), translation=(-9.63, 0.0, 15.989),
                animated="model cycles DAT_009A32A0 % 12 + 0x8CE",
                condition=_MOVING,
                note="[likely] a dust/spray trail behind a wheel"),
        RigPart("trail_fr", (0x08CE,), translation=(9.63, 0.0, 15.989),
                scale=(-1.0, 1.0, 1.0),
                animated="model cycles DAT_009A32A0 % 12 + 0x8CE",
                condition=_MOVING),
        RigPart("trail_rl", (0x08CE,), translation=(-9.63, 0.0, -12.9132),
                animated="model cycles DAT_009A32A0 % 12 + 0x8CE",
                condition=_MOVING),
        RigPart("trail_rr", (0x08CE,), translation=(9.63, 0.0, -12.9132),
                scale=(-1.0, 1.0, 1.0),
                animated="model cycles DAT_009A32A0 % 12 + 0x8CE",
                condition=_MOVING),
    ),
)

#: Every transcribed rig. One so far -- the others need their routines read.
RIGS: tuple[Rig, ...] = (ST1_VEHICLE,)


def ordered_parts(rig: Rig) -> list[RigPart]:
    """Parts in an order where a parent always precedes its children."""
    by_name = {p.name: p for p in rig.parts}
    out: list[RigPart] = []
    seen: set[str] = set()

    def emit(p: RigPart, guard: frozenset) -> None:
        if p.name in seen:
            return
        if p.parent and p.parent in by_name and p.parent not in guard:
            emit(by_name[p.parent], guard | {p.name})
        seen.add(p.name)
        out.append(p)

    for part in rig.parts:
        emit(part, frozenset())
    return out


def rig_for_slot(path_slot: int) -> Rig | None:
    """The rig that follows a given global cam path slot, if one is known."""
    for rig in RIGS:
        if path_slot in rig.path_slots:
            return rig
    return None
