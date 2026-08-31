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
    #: Evaluation time when the routine passes a **literal** rather than the
    #: clamped camera frame, i.e. the object is parked at a fixed point on the
    #: path. ``None`` means the usual ``min(g_cam_path_frame,
    #: cam_path_length[slot])``.
    hold_frame: float | None = None
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
    #: When the rig's class selects between prop sets with a parameter, the
    #: value of that selector this part is drawn for. None means always.
    variant: int | None = None
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
    #: Where the class's variant selector lives in the spawn parameter tail,
    #: as ``(offset, kind)`` -- the offset a handler writes as
    #: ``obj+0x1390 + n``. See `hod2lib.evt.PARAM_OPCODES`.
    variant_param: tuple[int, str] | None = None
    #: Where the object path slot lives in the parameter tail, same spelling.
    route_param: tuple[int, str] | None = None
    #: Where the object's *main* asset slot lives in the tail, when the class
    #: takes it from the descriptor rather than a literal. Recorded so the
    #: per-instance body can be resolved; see the note on `obj_4331d0`.
    main_asset_param: tuple[int, str] | None = None
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
        Route(0xFE, cam_paths=(0x21,),
              note="obj+0x1320 is cleared once the frame passes 0x15D (349) "
                   "and the routine then stops re-evaluating, so the pose is "
                   "held at the end of the path"),
        # cp_st1 2 does NOT ride a path. `FUN_0048E600` evaluates op 0xFE at
        # the literal 0x43AF0000 = 350.0 -- the end of the path the car has
        # just finished -- and clears obj+0x1320, so the car is parked and its
        # wheels and dust trails stop being drawn. It reads op 0xFF only for
        # `local_8` (rot_y), which becomes obj+0x1334, the occupants' yaw; op
        # 0xFF's position channels are never read by this routine at all.
        Route(0xFE, cam_paths=(0x22,), hold_frame=350.0,
              note="parked: CamEvalObjectPath6(0xFE, 350.0), a literal, not "
                   "the camera frame"),
    ),
    note="Draws car_pl.bin parts and char_adv00.bin occupants. Route selected "
         "by the active camera path: cp_st1 0/1 ride op_st1 0/1 in lockstep, "
         "and cp_st1 2 parks the car at the end of op_st1 1.",
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
                animated="RotY by obj+0x1334 = rot_y of op_st1 2 (slot 0xFF) "
                         "at frame clamp(g_cam_path_frame, 0, 0x31) + 100, or "
                         "150.0 when out of that range, minus 0x4000",
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
    variant_param=(6, "i16"),
    note="variant = *(int16*)(obj+0x1390 + 6), which is descriptor +0x2A -- "
         "the parameter tail opcodes 0x0B/0x0C/0x0D attach. Variants 1 and 2 "
         "occur in stage 2, 3 and 4 in stage 3. The variant-4 descriptor sits "
         "at (-635.1, 43.0, -955.9), which is where the routine hardcodes "
         "part_10df_v4 -- independent corroboration of both readings. The "
         "variant-3 parts take their path slot from obj+0x135C at runtime and "
         "are still not placeable. The whole routine is gated on "
         "DAT_009A5900 & 0x20, and [likely] that bit is dead: of 54 "
         "references, the setters are OR 1/2/8/0x10/0x18 and nothing sets "
         "0x20, so the early-out never fires in the retail build.",
    parts=(
        RigPart("part_1a37_v1", (0x1A37,),
                translation=(-1367.0, -17.0, -1845.3),
                rotation_bams=(0, 0x8000, 0),
                variant=1,
                condition="variant == 1",
                note="raw x=0xC4AAE000 y=0xC1880000 z=0xC4E6A99A, "
                     "rotY 0x8000 = 180 deg. World space."),
        RigPart("part_1a37_v2", (0x1A37,),
                translation=(214.0, -17.0, -2172.0),
                rotation_bams=(0, 0xAAAA, 0),
                variant=2,
                condition="variant == 2",
                note="raw x=0x43560000 y=0xC1880000 z=0xC507C000, "
                     "rotY 0xAAAA. World space."),
        RigPart("part_10df_v4", (0x10DF,),
                translation=(-636.0, 43.35, -952.0),
                rotation_bams=(0xC000, 0, 0),
                variant=4,
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

#: `FUN_00432840`, spawn class 0x28 (table entry 0x005933F8 -> FUN_00432610).
#: The route is chosen per instance by obj+0x11C through the 4-entry table at
#: 0x00589AE0, NOT by the camera path -- cp_st1 15 (0x2F) gates when the object
#: starts *moving*, which is a different thing. Conflating the two would claim
#: a cp_st1 gate on op_st2 routes, a gate that could never fire.
OBJ_432840 = Rig(
    name="obj_432840",
    routine="FUN_00432840",
    spawn_class=0x28,
    routes=(
        Route(0x145, note="obj+0x11C == 0; held at frame 0x29F before launch"),
        Route(0x146, note="obj+0x11C == 1; held at frame 0x29B before launch"),
        Route(0x149, note="obj+0x11C == 2; held at frame 0"),
        Route(0x14A, note="obj+0x11C == 3; held at frame 0"),
    ),
    note="Max matrix depth 1, 3 balanced push/pop pairs, all parts siblings. "
         "No SetDrawLayerNibble, so everything is on the default layer. "
         "Until obj+0x1320 flips the pose is the route sampled ONCE at the "
         "table's freeze frame and held; it flips on the first frame where "
         "g_active_cam_path == 0x2F and g_frame >= that freeze frame, and the "
         "pose then tracks the live frame. Killed once "
         "cam_path_length[route] <= g_frame. In g_mode(0x009C8E98) == 10 the "
         "route is replaced by a literal pose from 0x0055DD18 and the object "
         "is killed once the camera reaches path 8; only sub-types 0 and 1 "
         "have plausible records there, so those poses are recorded in the "
         "note rather than emitted. [open] what mode 10 denotes.",
    parts=(
        RigPart("part_0033", (0x33,),
                note="drawn at the object root with no scale of its own, so it "
                     "inherits the incoming scale. Slot is the literal 0x33 "
                     "stored into obj+0x13F0 at init."),
        # Both sprite parts bias the path position before the billboard yaw, so
        # neither offset can be expressed as a child of the rotated root.
        RigPart("part_135f", (0x135F,),
                translation=(0.0, 5.0, 0.0),
                scale=(1.5, 2.0, 1.0),
                animated="slot = 0x135F + (frame counter 0x009A32A0 % 15), a "
                         "15-slot loop 0x135F..0x136D. RotY is a pure "
                         "camera-facing yaw from VecToAngles(camX - obj.x, 0.0, "
                         "camZ - obj.z) -- a billboard with no pitch. The "
                         "object's own rotations are NOT applied to this part. "
                         "The +5.0 is a bias on the path position, applied "
                         "before the yaw.",
                condition="only while obj+0x1320 == 0, i.e. before launch"),
        RigPart("part_0b67", (0xB67,),
                translation=(0.0, 0.0, 12.0),
                scale=(7.0, 7.0, 7.0),
                animated="slot = 0xB67 + (frame counter 0x009A32A0 & 7), an "
                         "8-slot loop 0xB67..0xB6E, advancing in step with "
                         "part_135f. Reuses the same yaw, not recomputed. Its "
                         "path-position bias is +8.0 in Y, NOT the 5.0 that "
                         "part_135f uses; the (0,0,12) here is a genuine "
                         "post-rotation offset, since the yaw sits between the "
                         "two translates and so they do not compose.",
                condition="only while obj+0x1320 == 0, i.e. before launch"),
    ),
)

#: `SUB_004331D0`, spawn class 0x33, selected when obj+0x11C == 1 inside the
#: class handler FUN_00432FF0. The largest rig found: 9 draw sites.
#: Not placed -- see `placement_blocked`.
OBJ_4331D0 = Rig(
    name="obj_4331d0",
    routine="SUB_004331D0",
    spawn_class=0x33,
    route_param=(0x0C, "i32"),
    # The five sub-parts below are drawn only when the main asset is 0x1B0E,
    # and the main asset is itself a tail field -- obj+0x13F0 = p+0x00. So the
    # selector for this rig is the asset id.
    variant_param=(0x00, "i32"),
    main_asset_param=(0x00, "i32"),
    note="Max matrix depth 1, 8 balanced push/pop pairs, no nesting -- every "
         "part is a sibling. Two of the pushed blocks draw nothing; one caches "
         "the object's camera-space position. No SetDrawLayerNibble anywhere. "
         "The parts split into two MUTUALLY EXCLUSIVE sets by the main asset "
         "id at obj+0x13F0: 0x1B0E gets part_0899/part_08cb_a/part_08cb_b/"
         "part_1b0a/part_1b0d and never the sprite loops; anything else gets "
         "the sprite loops and never those five. Every configuration draws "
         "part_main_13f0, and part_1aab once detonated.",
    parts=(
        RigPart("part_main_13f0", (),
                animated="slot is obj+0x13F0, taken from the spawn parameter "
                         "block, so it is runtime and nothing is exported. "
                         "Uniform scale is 1.0, or 2.5 for assets 0x1A35/"
                         "0x1A36; asset 0x1A36 also gets ry += 0x4000."),
        RigPart("part_1aab", (),
                animated="a 40-frame loop over slots 0x1AAB..0x1AD2. Placed in "
                         "WORLD space -- it is drawn before the object's own "
                         "push -- at a pose copied from the spawn parameter "
                         "block, with RotY set to face the live camera by "
                         "VecToAngles and RotX forced to 0. [likely] fire or "
                         "smoke: it is triggered 20 frames after detonation, "
                         "which also spawns an explosion FX and a sound, and "
                         "once set the flag never clears.",
                condition="obj+0x34 & 0x00200000, set 20 frames after the "
                          "object detonates"),
        RigPart("part_024a", (),
                translation=(0.0, 0.0, 25.0), scale=(0.6, 0.5, 0.7),
                animated="a 22-slot loop 0x24A..0x25F, +1 per draw",
                condition="main asset != 0x1B0E, and only while the path plays"),
        RigPart("part_0260", (),
                translation=(0.0, 0.0, 25.0), scale=(0.6, 0.5, 0.7),
                animated="a 22-slot loop 0x260..0x275, +1 per draw",
                condition="main asset != 0x1B0E, and only while the path plays",
                note="transform is byte-for-byte identical to part_024a: two "
                     "co-located sprite loops running different sequences"),
        RigPart("part_0899", (0x899,),
                translation=(-5.2664, 8.3328, 6.717),
                rotation_bams=(-11578, 0, 0),
                variant=0x1B0E,
                condition="main asset == 0x1B0E",
                note="raw x=0xC0A88659 y=0x41055326 z=0x40D6F1AA; "
                     "rotX 0xFFFFD2C6 = -11578 = -63.5999 deg"),
        RigPart("part_08cb_a", (0x8CB,),
                translation=(0.0, 3.5437, 17.0281),
                animated="RotX by obj+0x135C, which gains 0x2000 BAMS (45 deg) "
                         "once per draw immediately before this part",
                variant=0x1B0E,
                condition="main asset == 0x1B0E"),
        RigPart("part_08cb_b", (0x8CB,),
                translation=(0.0, 3.5437, -12.384),
                animated="RotX by obj+0x135C -- the same value part_08cb_a "
                         "just advanced, read and not incremented again, so "
                         "the two are always in phase",
                variant=0x1B0E,
                condition="main asset == 0x1B0E"),
        RigPart("part_1b0a", (0x1B0A,),
                translation=(10.0, 6.216, 6.878),
                variant=0x1B0E,
                condition="main asset == 0x1B0E"),
        RigPart("part_1b0d", (0x1B0D,),
                translation=(-10.0, 6.216, 6.878),
                variant=0x1B0E,
                condition="main asset == 0x1B0E",
                note="[likely] a mirrored pair with part_1b0a -- same y and z, "
                     "x negated -- but they are different asset ids, so they "
                     "are two distinct models rather than one mirrored twice"),
    ),
)

#: `FUN_00452320`, the stage-2 opening vehicle. **[proved] a car**: its poser
#: `FUN_00452930` plays sound 0x719A9, whose SE record at 0x005868B4 names
#: ``STAGE2_SE\CAR_SRIP_22.wav`` -- a tyre skid. The neighbouring record
#: 0x619A9 is ``STAGE2_SE\CAR_CRASH1.wav``; both are in the stage-2 preload
#: list at 0x00569C98, but no code site plays the crash, so if one sounds it is
#: fired by the event script.
#:
#: This rig is why the 9-vs-22 split in `docs/re/rig-survey.md` is a filter and
#: not a definition: the posers evaluate the path and never draw, while the rig
#: lives here.
OBJ_452320 = Rig(
    name="obj_452320",
    routine="FUN_00452320",
    routes=(
        Route(0x148, cam_paths=(0x38,),
              note="poser FUN_004521B0; playlen 200, no end-of-path transition"),
        Route(0x14E, cam_paths=(0x39,),
              note="playlen 370. At frame >= 370 the asset set swaps to "
                   "variant 1 and the think pointer becomes FUN_004522A0, "
                   "which never re-samples a path -- so the body pose freezes "
                   "there permanently. [likely] the crash."),
        Route(0x14D, cam_paths=(0x3A,),
              note="playlen 130. At frame >= 80 the X-spin flag obj+0x1320 is "
                   "cleared permanently; at 130 the think pointer becomes "
                   "FUN_004522A0 and the variant stays 0."),
    ) + tuple(
        Route(slot, note="traffic instance %d, poser FUN_00452930, route from "
                         "int16[0x00565EF4 + obj+0x1350 * 2]; these are "
                         "op_train paths, so they are not in a numbered stage "
                         "export" % (i + 3))
        for i, slot in enumerate(range(0x19A, 0x1A2))
    ),
    note="Max matrix depth 2, balanced. No SetDrawLayerNibble, no MatrixScale, "
         "no lit-submit variant and NO pose bias anywhere -- every pose is "
         "written verbatim from CamEvalObjectPath6. "
         "Spawned by FUN_00452120 -> FUN_004A6FA0(FUN_00452150, 0x13F4), which "
         "sets obj+0x1350 to the instance index; the think pointer is "
         "FUN_004521B0, or FUN_00452930 when g_GameMode == 2. "
         "ASSET VARIANT: every part draws "
         "dword[0x00565F2C + obj+0x13F0 * 0x10 + column], a 2x4 int table. "
         "Variant 0 is exported; variant 1 is the set it swaps to after shot "
         "0x39 ends. Only two rows exist. "
         "LATENT BUG [proved], same shape as FUN_0048F560's: on a camera path "
         "other than 0x38/0x39/0x3A, FUN_004521B0 leaves the actor pointer in "
         "ECX and sign-extends its low 16 bits as the path index. Harmless "
         "only because the actor exists solely during those three shots. "
         "[open] asset identities -- slots 0x2D..0x35 are runtime indices with "
         "no static name table in the exe.",
    parts=(
        RigPart("part_002d", (0x2D,),
                note="the object root itself: Translate(pose) then RotZ, RotY, "
                     "RotX from obj+0x40/44/48 and 0x6C/68/64. "
                     "Variant 1 draws 0x2E instead."),
        # A genuine nested push: this one is inside part_002d's, not a sibling.
        RigPart("part_002f", (0x2F,),
                translation=(9.0582619, 6.368186, 8.9433079),
                parent="part_002d",
                animated="RotY by obj+0x1334, applied only while obj+0x1324 is "
                         "non-zero -- which happens only under FUN_004522A0, "
                         "after the shot-0x39 freeze. obj+0x1334 is then "
                         "0x4000 - CamEvalObjectPath6(0x153, t + 100.0).ry for "
                         "t = 1..39, and frozen after. So this part only moves "
                         "once the body has stopped.",
                note="raw z=0x410F17C2, y=0x40CBC84B, x=0x4110EECC. "
                     "Variant 1 draws 0x30. [open] what it is: the geometry "
                     "and the timing would fit a panel swinging open, but "
                     "nothing in the code or any string says so."),
        # Both of these are really children of a second, non-drawing root that
        # re-applies the body orientation with the roll passed through a
        # limiter. That root is identical to the object root whenever the roll
        # is inside the limiter's deadzone, so they are exported as children of
        # the rig root and the limiter is recorded here instead.
        RigPart("part_0034", (0x34,),
                translation=(0.0, 3.1674952, 13.6489019),
                animated="RotX by obj+0x1330, applied only while obj+0x1320 is "
                         "set. obj+0x1330 gains 0x1000 BAMS (22.5 deg) every "
                         "frame under FUN_004521B0 and FUN_00452930, and is "
                         "never reset; FUN_004522A0 does not advance it, so "
                         "the spin freezes there.",
                note="raw z=0x415A61E5, y=0x404AB852, x=0.0. Variant 1 draws "
                     "0x35. Its true parent is a roll-limited copy of the body "
                     "frame: FUN_004018E0 decomposes Rz.Ry.Rx into a YXZ "
                     "triple, then the roll r (&0xFFFF) is remapped -- "
                     "r<=0x800 -> 0; 0x800<r<=0x4000 -> r-0x800; "
                     "0x4000<r<0xC000 -> r; 0xC000<=r<0xE800 -> r-0xE800; "
                     "r>=0xE800 -> 0. An asymmetric deadzone over "
                     "-33.75..+11.25 deg, identity at rest."),
        RigPart("part_0031", (0x31,),
                translation=(0.0, 3.1674952, -9.4799995),
                animated="RotX by obj+0x1330, same rule and same gate as "
                         "part_0034",
                note="raw z=0xC117AE14, y=0x404AB852, x=0.0. Variant 1 draws "
                     "0x32. [likely] this and part_0034 are the wheels or "
                     "axles: both sit on the centreline at x=0 and the same "
                     "height, 23.13 apart in Z, both spin about X only at a "
                     "constant rate under one shared flag, and their parent "
                     "carries a roll limiter of exactly the kind you write so "
                     "wheels do not cut through the ground when the body "
                     "rolls. Note there are only TWO such parts and both are "
                     "at x=0, so they are not four wheels; and the code gives "
                     "no forward axis, so neither is named front or rear."),
    ),
)

#: Every transcribed rig. Twelve of the 31 CamEvalObjectPath6 callers; the other
#: 22 evaluate a path but never call AssetDrawSlot, so they position an object
#: that some other routine draws.
RIGS: tuple[Rig, ...] = (
    ST1_VEHICLE, OBJ_48EAD0, OBJ_48F050, OBJ_48F190, OBJ_48F560,
    OBJ_484FF0_PROPS, OBJ_470B70, OBJ_470080, OBJ_416B00,
    OBJ_432840, OBJ_4331D0, OBJ_452320,
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
    #: The same descriptors as `evt.Spawn` records, which can read the
    #: parameter tail. **[proved]** the allocator behind spawn opcodes
    #: 0x0B/0x0C/0x0D ends with ``obj+0x1390 = descriptor + 0x24``, so a class
    #: handler reading ``obj+0x1390 + k`` is reading ``spawn.param(k)``.
    raw: dict[int, list] = {}
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
            try:
                from . import evt as evtlib
                for rec in evtlib.spawns(prog.evt):
                    if rec.cls in wanted:
                        raw.setdefault(rec.cls, []).append(rec)
            except Exception:
                pass

    out: list[dict] = []
    blocked: list[Rig] = []
    for rig in RIGS:
        routes: list[dict] = []

        def take(slot, cam_paths, bias=(0.0, 0.0, 0.0), hold_frame=None,
                 note=""):
            if slot is None or slot not in have:
                return
            if cam_paths and not (set(cam_paths) & have_cam):
                return
            # `note` and `hold_frame` travel with the route rather than being
            # looked up by slot later: a rig may ride the same op_ slot from
            # two different shots with different rules, which the stage-1
            # vehicle does (cp_st1 1 rides op 0xFE, cp_st1 2 parks on it).
            routes.append({"slot": slot, "bias": tuple(bias),
                           "cam_paths": [c for c in cam_paths],
                           "hold_frame": hold_frame, "note": note})

        for slot in rig.path_slots:          # flat spelling, no cam gate
            take(slot, ())
        for route in rig.routes:
            take(route.slot, route.cam_paths, route.bias, route.hold_frame,
                 route.note)

        fixed = [{"kind": "fixed", "translation": list(fp.translation),
                  "rotation_bams": list(fp.rotation_bams),
                  "cam_paths": list(fp.cam_paths), "note": fp.note}
                 for fp in rig.fixed_poses
                 if not fp.cam_paths or (set(fp.cam_paths) & have_cam)]

        # Some classes select between prop sets, or pick a route, with a field
        # of the spawn parameter tail rather than a literal in the code. That
        # field is the real per-stage gate: a stage bounding box could never be
        # one, because levels span thousands of units and would accept absolute
        # props everywhere.
        variants: set[int] = set()
        if rig.variant_param and rig.spawn_class is not None:
            at, kind = rig.variant_param
            for rec in raw.get(rig.spawn_class, ()):
                v = rec.param(at, kind)
                if v:
                    variants.add(v)
        if rig.route_param and rig.spawn_class is not None:
            at, kind = rig.route_param
            for rec in raw.get(rig.spawn_class, ()):
                take(rec.param(at, kind), ())

        # A world-space rig has no root to place: its part translations are
        # already absolute, so it is emitted only when this stage actually
        # spawns a variant it draws.
        world = bool(rig.world_space and not rig.placement_blocked
                     and (variants if rig.variant_param else bbox is not None))

        if rig.placement_blocked:
            blocked.append(rig)
            continue
        if not routes and not fixed and not world \
                and not placements.get(rig.spawn_class):
            continue

        parts = []
        for part in ordered_parts(rig):
            if part.variant is not None and part.variant not in variants:
                continue
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
                                       if not (rig.world_space or rig.route_param
                                               or rig.variant_param) else [])})
    return out, blocked
