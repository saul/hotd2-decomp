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

__all__ = ["Route", "FixedPose", "RigPart", "Rig", "RIGS", "rig_for_slot"]

Vec3 = tuple[float, float, float]


@dataclass(frozen=True)
class Route:
    """An object path the routine follows, and the camera paths that select it.

    Routines dispatch on ``g_active_cam_path`` (0x009A2D78) through a jump
    table and pick a different ``op_`` slot per shot, so a rig is only present
    while the camera is on one of ``cam_paths``. Those are ``cp_`` slots in the
    same 418-slot space as ``slot`` itself, which is what makes them usable as
    a per-stage gate: a stage owns the rig iff it owns the cp_ file.
    """
    slot: int                              #: op_ slot passed to CamEvalObjectPath6
    cam_paths: tuple[int, ...] = ()        #: cp_ slots that select this route
    frame: str = "clamped"                 #: "clamped", "zero", or a rule
    #: Added to the path *position* before the pose rotations are applied, so
    #: it cannot be expressed as a child offset of the rotated anchor.
    bias: Vec3 = (0.0, 0.0, 0.0)
    note: str = ""


@dataclass(frozen=True)
class FixedPose:
    """A pose the routine hardcodes instead of evaluating a path."""
    translation: Vec3
    rotation_bams: Vec3 = (0, 0, 0)
    cam_paths: tuple[int, ...] = ()
    note: str = ""


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
    #: Routes the routine can follow, with the camera paths that select each.
    #: Preferred over `path_slots`, which stays as the flat derived view.
    routes: tuple[Route, ...] = field(default_factory=tuple)
    #: Poses the routine hardcodes instead of evaluating a path.
    fixed_poses: tuple[FixedPose, ...] = field(default_factory=tuple)
    #: True when the parts carry absolute world coordinates rather than
    #: offsets from an object root -- the routine draws them straight off the
    #: view matrix with no root push of its own.
    world_space: bool = False
    #: Set when the rig is understood but cannot be *placed*, explaining why.
    #: The transcription is still worth keeping; the exporter reports the
    #: reason rather than guessing at a position.
    placement_blocked: str = ""
    #: Spawn class this rig belongs to, when the routine is a class handler
    #: from the table at 0x00593358. A rig with a class can be placed at every
    #: spawn descriptor of that class, which is how objects that take their
    #: path slot from the object at runtime still get exported.
    spawn_class: int | None = None
    parts: tuple[RigPart, ...] = field(default_factory=tuple)
    note: str = ""

    @property
    def all_path_slots(self) -> tuple[int, ...]:
        """Every op_ slot the rig can follow, from both spellings."""
        return tuple(dict.fromkeys(
            list(self.path_slots) + [r.slot for r in self.routes]))

    @property
    def cam_paths(self) -> tuple[int, ...]:
        """Every cp_ slot that can select this rig. Empty means ungated."""
        seen: list[int] = []
        for src in (*self.routes, *self.fixed_poses):
            seen += [c for c in src.cam_paths if c not in seen]
        return tuple(seen)


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
    routes=(
        Route(0xFD, cam_paths=(0x20,)),
        Route(0xFE, cam_paths=(0x21,)),
        Route(0xFF, cam_paths=(0x22,)),
    ),
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
        # RotX(-0x1C00) . RotZ(sin-driven) . RotX(+0x1C00): a rotation about an
        # axis tilted -39.375 deg from Z, and IDENTITY when the sin term is 0.
        # Baking only the first RotX would leave the part half-rotated, which
        # is what an earlier revision of this file did.
        RigPart("part_8cc", (0x08CC,),
                translation=(0.0, 10.739, 11.4021),
                animated="RotX(-0x1C00) . RotZ(ftol(sin(DAT_009A32A0 << 9))) . "
                         "RotX(+0x1C00) -- a swing about an axis tilted "
                         "-39.375 deg from Z. Identity while the sin term is 0, "
                         "which is the pose exported here"),
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


# ---------------------------------------------------------------------------
# Transcribed 2026-08-29 from the remaining CamEvalObjectPath6 callers that
# also call AssetDrawSlot. Every constant below was re-read from raw bytes
# with `disassemble_bytes`, because Ghidra's decompiler silently drops FPU
# arguments; the raw hex is kept in each part's `note` so it can be rechecked.
#
# A shared idiom, [proved] in all of them: the routine self-destructs rather
# than drawing when the byte at 0x009C72E0 is 1 (ActorKill, 0x004A7040, which
# longjmps and does not return).
# ---------------------------------------------------------------------------

#: `FUN_0048EAD0`, state 2 of the object family dispatched at 0x0048E290.
#: Almost the whole routine is camera-path dispatch; it draws one slot.
OBJ_48EAD0 = Rig(
    name="obj_48ead0",
    routine="FUN_0048EAD0",
    routes=tuple(
        Route(slot, cam_paths=(cam,), bias=(0.0, 2.0, 0.0),
              note="pose.y is biased by the literal 2.0 at 0x004E30F0 before "
                   "the rotations, so it is baked into the anchor")
        for cam, slot in ((0x7C, 0x156), (0x7D, 0x157), (0x7E, 0x158),
                          (0x7F, 0x159), (0x82, 0x15A), (0x85, 0x15B),
                          (0x86, 0x15C), (0x87, 0x15D))
    ) + tuple(
        Route(0x199, cam_paths=(cam,), bias=(0.0, 2.0, 0.0))
        for cam in (0xF6, 0xF7, 0xF8)
    ),
    note="Frame is min(g_frame, cam_path_length[slot]) -- clamped to the end "
         "of the path. On a camera path outside the table the pose is not "
         "refreshed and the object draws at whatever pose it last held.",
    parts=(
        RigPart("part_1a37", (0x1A37,),
                animated="Root Y rotation is overridden while the latch "
                         "obj+0x1350 is set: obj+0x68 becomes the live camera "
                         "yaw (0x009A6040 + cam*0x1A4 + 0x90) + 0x8000, i.e. "
                         "the part turns to face 180 deg from the camera. The "
                         "latch is toggled at hardcoded frames per path -- see "
                         "docs/formats/cam.md. Exported at the path pose.",
                note="drawn at the object root; FUN_004A8CA0 then snapshots "
                     "the matrix into obj+0x150 for hit-testing, not a draw"),
    ),
)

#: `FUN_0048F050`. One slot at the object root.
OBJ_48F050 = Rig(
    name="obj_48f050",
    routine="FUN_0048F050",
    routes=(
        Route(0x173, cam_paths=(0xAE, 0xAF, 0xB2), frame="zero",
              note="frame is a literal 0.0f (6A 00), not the clamped frame"),
        Route(0x173, cam_paths=(0xB0,)),
        Route(0x174, cam_paths=(0xB1,)),
    ),
    note="Jump table at 0x0048F17C, index cam_path - 0xAE. On any other "
         "camera path there is no path eval at all and the object draws with "
         "the pose it already holds. Push/pop depth 1.",
    parts=(
        RigPart("part_185b", (0x185B,),
                note="drawn directly on the object root"),
    ),
)

#: `FUN_0048F190`. Push/pop depth 2: the outer push holds the object root and
#: is held open, so the sub-parts are children of it rather than siblings that
#: each re-apply the root. Same part offsets as ST1_VEHICLE with different
#: asset slots -- FUN_0048E600 is a sibling state of the same object.
OBJ_48F190 = Rig(
    name="obj_48f190",
    routine="FUN_0048F190",
    routes=(
        Route(0x17A, cam_paths=(0xCD,)),
        Route(0x17B, cam_paths=(0xCE,)),
        Route(0x17C, cam_paths=(0xCF,)),
        Route(0x17D, cam_paths=(0xD1,)),
    ),
    fixed_poses=(
        FixedPose((528.4, -0.1, -308.2), (0, 0xA16D, 0), cam_paths=(0xCC,),
                  note="hardcoded pose, no path eval"),
    ),
    note="Jump table at 0x0048F53C, index cam_path - 0xCC; 0xD0 and 0xD2 do "
         "no path eval. ROOT YAW OVERRIDE: while obj+0x1350 is set the root Y "
         "becomes camera yaw + 0x8000, i.e. the rig faces the camera. Latch "
         "frames: cp 0xCE set@100 clear@200; 0xCF set@70,630 clear@230,970; "
         "0xD1 set@80,470 clear@320,1215.",
    parts=(
        RigPart("part_8c7_145c", (0x8C7, 0x145C),
                note="drawn on the held-open object-root push"),
        RigPart("part_899", (0x899,),
                translation=(-4.6755, 9.0, 6.239),
                rotation_bams=(0xD000, 0, 0),
                note="two consecutive MatrixTranslate calls compose by "
                     "addition: (-4.6755,0,0.239) then (0,9,6). "
                     "rotX raw 68 00 d0 00 00 = 0xD000"),
        # Rx(-a).Rz(90).Rx(a) == Rz(90).Ry(a).Rx(a) exactly for a = 0x1C00,
        # verified to 1e-16 against the engine's rotation sign convention.
        # The sibling FUN_0048E600 has the same sandwich with a sin-driven
        # middle term, where it collapses to identity at rest instead.
        RigPart("part_8cd", (0x8CD,),
                translation=(0.0, 10.739, 11.4021),
                rotation_bams=(0x1C00, 0x1C00, 0x4000),
                note="literal call order rotX(-0x1C00), rotZ(0x4000), "
                     "rotX(+0x1C00); the triple here is the exact equivalent"),
        RigPart("part_896", (0x896,),
                translation=(-10.0702, 6.1773, 6.8503),
                animated="RotY by obj+0x1334, a runtime yaw",
                note="mirror partner of part_893"),
        RigPart("part_893", (0x893,),
                translation=(10.077, 6.211, 6.8302),
                animated="RotY by -(obj+0x1334)",
                condition="the rotation, not the draw, is applied only while "
                          "obj+0x1324 is set"),
        RigPart("part_157f", (0x157F,),
                translation=(0.0, 3.8497, 16.2239),
                animated="RotX by obj+0x1330, a free-running accumulator "
                         "gaining 0x2000 a frame in the sibling state"),
        RigPart("part_1580", (0x1580,),
                translation=(0.0, 3.8497, -12.6732),
                animated="RotX by obj+0x1330, same accumulator and sign"),
        RigPart("part_145d", (0x145D,),
                animated="drawn under its OWN root push after the main root "
                         "push is popped, and its root translate substitutes "
                         "y = g_camera_fixed_eye_y (0x009C8E58) for obj+0x44 "
                         "whenever obj+0x1328 is set (cp 0xCC, 0xCD, 0xD2)",
                note="a sibling of the root group, not a child of it"),
    ),
)

#: `FUN_0048F560`. Three fixed groups plus a two-digit numeric readout drawn
#: twice, on opposite faces. Ghidra mis-renders the digit dispatch as an
#: indirect call and leaves 0x48F796..0x48F80F undisassembled; the tables were
#: recovered by hand from 0x0048F918.
OBJ_48F560 = Rig(
    name="obj_48f560",
    routine="FUN_0048F560",
    routes=(
        Route(0x182, cam_paths=(0xDA,), frame="zero",
              note="frame is a literal 0.0f"),
        Route(0x182, cam_paths=(0xDB,)),
    ),
    fixed_poses=(
        FixedPose((557.5, 2492.2, -9880.2), (0, 0x7555, 0),
                  cam_paths=(0xDC, 0xEC), note="hardcoded pose"),
    ),
    note="Byte-index table 0x0048F904 into targets at 0x0048F8F0. Push/pop "
         "depth 2, 7/7 balanced. KNOWN BUG, [proved]: on any camera path "
         "outside {0xDA,0xDB,0xDC,0xEC} the four digit slot indices are read "
         "from [ESP+0x2C], the routine's own obj argument slot reused as "
         "scratch and never written on that path, giving 0xAD4 + "
         "(int16)obj_ptr. [likely] unreachable, since the routine is only "
         "installed as the handler during those paths.",
    parts=(
        RigPart("part_1913", (0x1913,),
                note="drawn on the held-open object-root push"),
        RigPart("part_afe_aff", (0xAFE, 0xAFF),
                translation=(0.0, 6.5, 15.5),
                condition="drawn only while g_active_cam_path == 0xDA"),
        RigPart("part_afc_afd", (0xAFC, 0xAFD),
                translation=(0.0, 6.5, -11.3),
                condition="drawn only while g_active_cam_path is 0xDB or 0xEC"),
        # Four banks of exactly 10 consecutive slots, indexed n/10 and n%10.
        # Frame 0 of each bank is emitted; the running value is a runtime rule.
        RigPart("part_digit_hi_a", (0xAD4,),
                translation=(-6.4712, 26.4288, 14.8662),
                animated="slot = 0xAD4 + n/10 over the bank 0xAD4..0xADD. "
                         "n: cp 0xDA -> 1; cp 0xDB -> (int16)((min(g_frame, "
                         "cam_path_length[0x182]) - 50)/6 + 5); cp 0xDC -> 50 "
                         "if g_frame >= 84 else g_frame/6 + 36; cp 0xEC -> 50. "
                         "All divisions signed-truncating."),
        RigPart("part_digit_lo_a", (0xADE,),
                translation=(-7.5321, 26.4152, 14.8665),
                animated="slot = 0xADE + n%10 over the bank 0xADE..0xAE7"),
        RigPart("part_digit_hi_b", (0xAE8,),
                translation=(6.1895, 26.4288, -10.7128),
                animated="slot = 0xAE8 + n/10 over the bank 0xAE8..0xAF1"),
        RigPart("part_digit_lo_b", (0xAF2,),
                translation=(7.2504, 26.4152, -10.7116),
                animated="slot = 0xAF2 + n%10 over the bank 0xAF2..0xAFB"),
    ),
)

#: `FUN_00484FF0`, the draw tail of a script-driven object (its bytecode VM is
#: FUN_004842A0). The object's own body is a skeletal model drawn by
#: FUN_00411090 *before* this switch; these are extra props drawn alongside it.
#: [proved] world space: nothing pushes an object root before the call and the
#: case 1/2/4 translations are absolute magnitudes matching the path coords.
OBJ_484FF0_PROPS = Rig(
    name="obj_484ff0_props",
    routine="FUN_00484FF0",
    world_space=True,
    spawn_class=0x25,
    placement_blocked=(
        "the variant that selects which prop is drawn is "
        "*(int16*)(*(int*)(obj+0x1390) + 6), and obj+0x1390 does NOT point at "
        "the evt spawn descriptor: reading +6 there (the high half of "
        "init_flags) gives 0 for all 142 class-0x25 descriptors in all six "
        "stages, and variant 0 draws nothing. Until that record is identified "
        "there is no way to say which stage holds these props, so they are "
        "transcribed but not placed -- putting them in every stage would be "
        "worse than leaving them out."),
    note="variant = *(int16*)(*(int*)(obj+0x1390) + 6), a field of the stage "
         "spawn descriptor. The routine takes its path slot from obj+0x135C "
         "at runtime, not from a literal, so the variant-3 parts cannot be "
         "placed by this exporter. The whole routine is gated on "
         "DAT_009A5900 & 0x20, and [likely] that bit is dead: of 54 "
         "references, the setters are OR 1/2/8/0x10/0x18 and nothing sets "
         "0x20, so the early-out never fires in the retail build.",
    parts=(
        RigPart("part_1a37_v1", (0x1A37,),
                translation=(-1367.0, -17.0, -1845.3),
                rotation_bams=(0, 0x8000, 0),
                condition="variant == 1",
                note="raw x=0xC4AAE000 y=0xC1880000 z=0xC4E6A99A, "
                     "rotY 0x8000 = 180 deg. World space."),
        RigPart("part_1a37_v2", (0x1A37,),
                translation=(214.0, -17.0, -2172.0),
                rotation_bams=(0, 0xAAAA, 0),
                condition="variant == 2",
                note="raw x=0x43560000 y=0xC1880000 z=0xC507C000, "
                     "rotY 0xAAAA. World space."),
        RigPart("part_10df_v4", (0x10DF,),
                translation=(-636.0, 43.35, -952.0),
                rotation_bams=(0xC000, 0, 0),
                condition="variant == 4 and g_active_cam_path == 0x93",
                note="raw x=0xC41F0000 y=0x422D6666 z=0xC46E0000, "
                     "rotX 0xC000 = 270 deg. World space."),
        # Variant 3 draws the same slot from the runtime path pose, plus a
        # mirrored flipbook pair under an anchor at pose.xz with y forced to
        # -25.0 and the pose's heading only. No literal slot, so not placed.
        RigPart("part_1a37_v3_path", (),
                condition="variant == 3",
                animated="placed entirely from CamEvalObjectPath6(obj+0x135C, "
                         "g_frame) -- the slot is runtime, so nothing is "
                         "exported for this part",
                note="slot 0x1A37 at the path pose"),
        RigPart("part_24a_pair", (),
                condition="variant == 3",
                animated="mirrored pair at x = +/-1.7, z = 20, under an anchor "
                         "at (pose.x, -25.0, pose.z) rotated by the pose's "
                         "heading alone (pitch and roll discarded by the "
                         "matrix->Euler decomposition at FUN_00401AE0). Each "
                         "draws slot 0x24A + (g_counter % 22), a 22-frame "
                         "flipbook. Runtime slot, so nothing is exported."),
    ),
)

#: `FUN_00470B70`, actor state 412 (dispatch table 0x00593170, entry
#: 0x005937E0). One part, one literal slot, standard Z,Y,X rotation order.
OBJ_470B70 = Rig(
    name="obj_470b70",
    routine="FUN_00470B70",
    routes=(Route(0x179, frame="obj+0x2C0, advancing +1.0 a frame only while "
                                "obj+0x192 == 1"),),
    note="Push/pop depth 1. After the pop it transforms (pose.x, pose.y + 8.0, "
         "pose.z) by the parent matrix into obj+0x70..0x78 -- a world anchor, "
         "not a draw. Returns early to FUN_00409CC0 when DAT_009C8E98 == 5, "
         "and ActorKills when the object is out of its scene segment.",
    parts=(
        RigPart("part_1871", (0x1871,),
                animated="drawn at the path pose with obj+0x1C8 added to z; "
                         "the frame freezes at 105, when obj+0x192 becomes 2",
                note="the draw call is chosen at runtime -- "
                     "SubmitSlotWithSceneLightArray(0x1871) when DAT_009A2BB4 "
                     "is set, else AssetDrawSlot(0x1871). Same slot either "
                     "way: a lighting variant, not a transform variant."),
    ),
)

#: `FUN_00470080`, actor state 406. Transcribed for the record only: its one
#: drawn slot is obj+0x28C, a per-instance runtime field, so there is no
#: geometry to place.
OBJ_470080 = Rig(
    name="obj_470080",
    routine="FUN_00470080",
    routes=tuple(Route(s) for s in (406, 407, 408)),
    note="Path slot comes from the word table at 0x00595778 indexed by "
         "(int16)obj+0x290, whose ~20 writers are spread across the binary, "
         "so which route an instance takes is per-instance. Two SEQUENTIAL "
         "push/pop pairs, not nested: the first draws nothing, it only builds "
         "a scratch rotation to transform one vector. The path's rotation "
         "output is read but never used -- only pose.xyz is stored. Rotation "
         "order here is Y, Z, X, NOT the usual Z, Y, X.",
    parts=(
        RigPart("part_obj28c", (),
                scale=(2.5, 2.5, 2.5),
                animated="composed transform is T(p + d0) . R . T(-R.d0) with "
                         "d0 = (sin, 0, cos) * 0.15 and R = RotY.RotZ.RotX; "
                         "rotX and rotZ are bounded to +/-640 BAMS but rotY is "
                         "set outside the routine and unbounded, so the offset "
                         "does not provably cancel. Slot is obj+0x28C.",
                note="after the draw, Scale(0.4) then MatrixStore(obj+0x2E4) "
                     "-- 2.5 * 0.4 == 1.0, so obj+0x2E4 gets the UNSCALED part "
                     "matrix, an attach point for something else"),
    ),
)

#: `FUN_00416B00`. Not a static rig: a loop i = 0..5 over three parallel
#: 0x30-byte record arrays, record = ARRAY + 0x30*(i + 6*player). Every
#: translation and rotation is runtime data and all but one slot id is
#: computed, so only the record layout and the rules are transcribed.
OBJ_416B00 = Rig(
    name="obj_416b00",
    routine="FUN_00416B00",
    routes=(Route(0x194, frame="(age % 24), a 24-frame loop"),),
    note="[likely] the per-shot gunfire effect set -- spawned from the "
         "player's crosshair at unit view depth by FUN_00416F70, per player, "
         "a ring of 6 with short frame-counted lifetimes, drawn in layer 0xC. "
         "Record layout [proved]: +0x00 s16 active, +0x02 s16 variant "
         "(= player index), +0x04/08/0C f32 pos, +0x10/14/18 i32 rot, "
         "+0x1C/20/24 f32 velocity, +0x28 i32 age, +0x2C i32 kind. "
         "Slot tables at 0x00579F78 and 0x00579F7C hold 373/383 and "
         "2934/2948. Nothing here is placeable: see the parts.",
    parts=(
        RigPart("a_tbl", (), scale=(0.1, 0.1, 0.1), draw_layer=0xC,
                animated="MatrixLoadIdentity first, so this draws in VIEW "
                         "space. Slot = table[variant] + age. A second draw "
                         "shares the same push, so its scale is cumulative on "
                         "the 0.1: 0.075 when kind == 4, else 0.05.",
                condition="record active and kind != 3; forced inactive at "
                          "age >= 9"),
        RigPart("b_spin", (), draw_layer=0xC,
                animated="inherits the caller's matrix, then "
                         "MatrixClearRotation (0x004A9F70) wipes the 3x3 -- a "
                         "screen-axis billboard -- then RotZ gains 0x1000 "
                         "BAMS (22.5 deg) per call",
                condition="record active and kind != 5"),
        RigPart("b_path404", (0x109D,), draw_layer=0xC,
                animated="Translate(record pos), then "
                         "CamEvalObjectPath6(0x194, age % 24) and Translate of "
                         "that pose -- the two translations compose by "
                         "addition -- then MatrixClearRotation and the pose "
                         "rotations. The record position is runtime, so this "
                         "is not placeable either.",
                condition="record active and kind == 5, which FUN_00416F70 "
                          "only assigns while g_GameMode == 1"),
        RigPart("c_0xa6f", (), scale=(0.05, 0.05, 0.05), draw_layer=0xC,
                animated="VIEW space again; slot = 0xA6F + age over 24 frames. "
                         "RotZ is seeded at spawn from rand() % 0xFFFF and is "
                         "not animated.",
                condition="g_GameMode == 1 and kind == 4 and record active"),
    ),
)

#: Every transcribed rig. Nine of the 31 CamEvalObjectPath6 callers; the other
#: 22 evaluate a path but never call AssetDrawSlot, so they position an object
#: that some other routine draws.
RIGS: tuple[Rig, ...] = (
    ST1_VEHICLE, OBJ_48EAD0, OBJ_48F050, OBJ_48F190, OBJ_48F560,
    OBJ_484FF0_PROPS, OBJ_470B70, OBJ_470080, OBJ_416B00,
)


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
        if path_slot in rig.all_path_slots:
            return rig
    return None


# ---------------------------------------------------------------------------
# resolution against a stage
# ---------------------------------------------------------------------------


def resolve_for_stage(stage, bbox=None) -> tuple[list[dict], list[Rig]]:
    """Which rigs this stage holds, with their part models loaded.

    Returns ``(instances, blocked)``. Each instance is::

        {"rig": Rig,
         "routes":     [{"slot": int, "bias": Vec3, "cam_paths": [int]}],
         "fixed":      [{"translation", "rotation_bams", "cam_paths", "note"}],
         "placements": [spawn descriptor dicts],
         "world":      bool,
         "parts":      [(RigPart, [(model, bank, file_stem)])]}

    A rig's parts name **asset slots**, which resolve through the EXE's slot
    table to a pol file and an entry index -- and those files are deliberately
    *not* in the stage geometry set, because they are spawnable actors rather
    than placed scenery. So they are loaded here on demand.

    This lives in the library rather than in ``export_level.py`` because two
    consumers need it: the glTF exporter, which parents each rig under the
    baked animation node of its route, and the browser player's bundle, which
    keeps the route as a *path slot* and evaluates it at runtime. Duplicating
    the resolution would let the two disagree about which rigs a stage has.
    """
    from . import stage as stagelib, script as scriptlib

    cp = stage.campaths()
    if cp is None:
        return [], []
    slots = stage.tables.asset_slots()
    have = {r.slot for r in cp.by_slot.values() if r.is_object_path}
    # The cp_ slots this stage owns. Routines dispatch on `g_active_cam_path`
    # to pick a route, and those ids live in the same 418-slot space as the
    # object paths, so a rig belongs to a stage iff the stage owns the camera
    # path that selects it.
    have_cam = {r.slot for r in cp.by_slot.values() if not r.is_object_path}

    cache: dict[str, tuple] = {}

    def asset(file_stem: str):
        if file_stem not in cache:
            try:
                cache[file_stem] = stagelib.load_asset(stage.game, file_stem)
            except Exception:
                cache[file_stem] = ([], None)
        return cache[file_stem]

    # Spawn descriptors, grouped by class, so a rig that is a class handler can
    # be placed at every instance the event script puts in the stage.
    placements: dict[int, list[dict]] = {}
    wanted = {r.spawn_class for r in RIGS if r.spawn_class is not None}
    if wanted:
        try:
            prog = scriptlib.load(stage)
        except Exception:
            prog = None
        if prog is not None:
            for blk in prog.blocks:
                for step in blk.steps:
                    for op in step.ops:
                        for sp in op.detail.get("spawns", []) or []:
                            if sp["class"] in wanted:
                                placements.setdefault(sp["class"], []).append(sp)

    out: list[dict] = []
    blocked: list[Rig] = []
    for rig in RIGS:
        routes: list[dict] = []

        def take(slot, cam_paths, bias=(0.0, 0.0, 0.0)):
            if slot not in have:
                return
            if cam_paths and not (set(cam_paths) & have_cam):
                return
            routes.append({"slot": slot, "bias": tuple(bias),
                           "cam_paths": [c for c in cam_paths]})

        for slot in rig.path_slots:          # flat spelling, no cam gate
            take(slot, ())
        for route in rig.routes:
            take(route.slot, route.cam_paths, route.bias)

        fixed = [{"kind": "fixed", "translation": list(fp.translation),
                  "rotation_bams": list(fp.rotation_bams),
                  "cam_paths": list(fp.cam_paths), "note": fp.note}
                 for fp in rig.fixed_poses
                 if not fp.cam_paths or (set(fp.cam_paths) & have_cam)]

        # A world-space rig has no root to place: its part translations are
        # already absolute, so it needs a gate saying which stage holds it.
        # Without a confirmed gate it is transcribed but not placed.
        world = bool(rig.world_space and bbox is not None
                     and not rig.placement_blocked)

        if rig.placement_blocked:
            blocked.append(rig)
            continue
        if not routes and not fixed and not world \
                and not placements.get(rig.spawn_class):
            continue

        parts = []
        for part in ordered_parts(rig):
            models = []
            for sid in part.slots:
                rec = slots.get(sid)
                if not rec:
                    continue
                stem = rec[0][:-4] if rec[0].endswith(".bin") else rec[0]
                ms, bank = asset(stem)
                if rec[1] < len(ms):
                    models.append((ms[rec[1]], bank, stem))
            if models:
                parts.append((part, models))
        if parts:
            out.append({"rig": rig, "routes": routes, "parts": parts,
                        "blocked": rig.placement_blocked,
                        "fixed": fixed, "world": world,
                        "placements": (placements.get(rig.spawn_class, [])
                                       if not rig.world_space else [])})
    return out, blocked
