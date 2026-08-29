# `cam/` camera and object paths

**Status:** solved. All 24 files parse at **100.0000 % byte coverage** — every
byte is claimed by exactly one of {offset table, curve, path descriptor}.
Implemented in [`tools/hod2lib/cam.py`](../../tools/hod2lib/cam.py); checked by
`tools/verify_phase6.py`.

A `cam/` file is a pool of independent **scalar cubic-Hermite animation
curves**, plus one small descriptor per path naming the curve that drives each
channel. There is no keyframe struct in the sense the old plan assumed — the
channels are not interleaved, they are separate curves.

## Container

```
+0x00   u32 path_offset[n]     byte offset of each path descriptor
        u32 0xFFFFFFFF         terminator
+base   curve pool and path descriptors, interleaved      base = 4 + n*4
```

The terminator makes the file self-describing: `n` can be recovered without
reference to `Hod2.exe`. It agrees with the EXE's per-file count table
(`0x004C476C`, **`u16` stride** — see the warning under *Binding*) for all
24 files.

Curve indices inside a descriptor are **dword indices relative to `base`**:

```
curve_addr = base + index * 4
```

Curves and descriptors are interleaved — a path's curves are emitted first,
then that path's descriptor, then the next path. A parser therefore walks the
pool linearly from `base`, chaining `4 + key_count * 16` through curves and
stepping over anything that is not a curve header.

### Curve

```
+0x00   u16 key_count          always a power of two
+0x02   u16 search_steps       log2(key_count)
+0x04   key[key_count]         16 bytes each
```

Key:

```
+0x00   f32 time               frame number (see "Timebase")
+0x04   f32 value
+0x08   f32 tangent_out        used when leaving this key
+0x0C   f32 tangent_in         used when arriving at this key
```

`key_count` is a power of two because the evaluator does a fixed
`log2(count)`-step binary search rather than a bounded loop. Curves with fewer
real keys are padded, and a padding slot is marked by storing `0xFFFF0000` — a
NaN — in its `time`. Only **5 curves in `cp_st1.bin`** are padded, but the
evaluator returns NaN if a padding slot is ever selected, so a parser must trim
at the first non-finite time.

### Path descriptor

One `u32` curve index per channel.

| Family | Words | Channels |
|---|---|---|
| `cp_*` | 8 | `eye.x eye.y eye.z  target.x target.y target.z  roll` + one more index |
| `op_*` | 6 | `pos.x pos.y pos.z  rot.x rot.y rot.z` |

**`cp_` vs `op_` — resolved.** The container is identical; the two families
differ only in who consumes them:

- `FUN_004041E0` reads **seven** channels and produces an eye point, a look-at
  point and an integer roll. That is a **camera path**.
- `FUN_004042D0` reads **six** and converts the last three through `__ftol`,
  i.e. they are integers, not floats. That is an **object path** — position
  plus a BAMS Euler triple.

`cp_` descriptors carry an **eighth** curve index that neither evaluator reads.
It always points at a real curve in the pool, so it is not padding; its purpose
is unknown. It is exposed as `Path.trailing`.

## Evaluation

`FUN_004040F0(curve, t)` is a textbook cubic Hermite segment. With
`h = t1 - t0` and `s = (t - t0) / h`:

```
v =  ( 2s³ - 3s² + 1) · v0
  +  (  s³ - 2s² + s) · h · m0        m0 = key[i-1].tangent_out
  +  (-2s³ + 3s²    ) · v1
  +  (  s³ -  s²    ) · h · m1        m1 = key[i].tangent_in
```

Tangents are in value-per-unit-time, which is exactly glTF's `CUBICSPLINE`
convention — the curves convert to glTF animation samplers with no reshaping
beyond scaling tangents by `h`.

The binary search cannot leave the key array, so querying outside a curve's
range extrapolates along the end segment rather than clamping. `Curve.evaluate`
reproduces that.

## Selection: how the event script drives a path

**[proved]** Not a dedicated opcode. Camera playback is a **queued action**:
`evt` opcode `0x30` (`queue_event`) with selector `0x40` pushes a job whose
operands are copied to `0x009A6184`, and `EvtRunQueuedActions`
(`FUN_00402320`) installs `EvtActionCamPlay40` (`FUN_00403360`) as the
per-frame handler. That resolves to `CamEvalStaticPose` / `FUN_00403510`,
which call the evaluator:

```c
CamEvalPath7(args[2],            /* cam path slot   */
             (float)args[0],     /* time, in frames */
             &eye, &target, &roll, ...);
```

So the operand layout of the camera action is:

```
[0x30][0x40][ t ][ ? ][ path slot ][ flags ]
```

**[measured]** Of the **885** `sel=0x40` occurrences across all event scripts,
**880 (99.4 %)** have an `args[2]` that is a valid cam path slot, and every
script references **only its own** cam file — `st1evtbl`→`cp_st1`,
`st2evtbl`→`cp_st2`, … `trnevtbl`→`cp_train`, `endevtbl`→`cp_end`,
`advevtbl`→`cp_demo`, `adv2evtbl`→`cp_demo2`. No cross-references at all.

The five exceptions are all in `trnevtbl.bin` block 7 and all name slot
**418** — exactly one past the end of the allocated range 0–417. A data defect,
recorded in [`../re/anomalies.md`](../re/anomalies.md).

`sel=0x21` (`FUN_00403710`, 444 uses) hands control back from a path;
`sel=0x60` (`FUN_004038A0`, 13 uses) sets a six-component pose directly.
Only **nine** selectors exist in total, not the 100+ estimated earlier.

## Timebase

Times are **frame numbers at 60 Hz**. 99.68 % of the 44,750 real keyframe times
sit within 0.01 of an integer; the residue is f32 accumulation error in whatever
tool exported them, not a finer subdivision. The longest curve runs to frame
3600 — exactly 60 seconds.

Path durations run from 55 frames (0.9 s) to 1810 frames (30 s).

## Binding: which path is which

Which global **slot** a file's path *k* occupies is not in the file. Three
parallel tables in `Hod2.exe` hold it, and `FUN_00404000` applies them at load:

> **The strides differ. Read them exactly as written.**
> `0x004C476C` is indexed `[file * 2]`, not `[file * 4]`. A `u32` read does not
> fail — it silently returns garbage. For `cp_st2.bin` (file 7) the correct
> `u16` read gives **66** paths; a `u32` read gives **65537** (`0x00010001`),
> whose low word is 1. Every table below is annotated with its element size and
> the exact addressing expression for this reason.

| Address | Element | Address expression | Contents |
|---|---|---|---|
| `0x004D1BC8` | `u32` | `+ file * 4` | filename pointer |
| `0x004C476C` | **`u16`** | **`+ file * 2`** | path count |
| `0x004C470C` | `u32` | `+ file * 4` | pointer to `s16[count]` — the global slot id of each path |
| `0x004C479C` | **`s8`** | **`+ slot * 1`** | owning cam file index |
| `0x0059C9F8` | 8 bytes | `+ slot * 8` | runtime `{u32 ptr; u16 state}` |

Slot ids partition cleanly: each file owns one contiguous ascending run, and
the runs tile 0–417 with no gaps or overlaps (`cp_demo` 0–17, `cp_st2` 55–120,
`op_st1` 253–327, `op_train` 406–417).

**[measured]** For all **23** cam files listed in the EXE, the `u16` count
equals the number of paths the file parser finds, and every slot in the
forward list maps back to the same file through the `s8` reverse table.

In `hod2lib`: `ExeTables.cam_files()`, `.cam_path_slots()`,
`.cam_slots_for(name)`, `.slot_cam_file(slot)`.

Loader: `0x00403EC0` opens the file, allocates `size + 0x20`, aligns the buffer
up to 32 and stores the base at `0x0059C9EC`; `0x00403FB0` performs the
`ReadFile`; `0x00404000` then resolves each table entry to `base + offset` and
files it under its slot id.

## Anomaly

`op_st1.bin` ships with **six corrupt offset-table entries** (indices 51, 53,
56, 67, 69, 71). They are not dword aligned — every one is ≡ 2 mod 4 — and point
into the middle of keyframe data. The descriptors they should name do exist:
the structural pool walk finds exactly six descriptors the table never
mentions, and both lists are ascending, so the pairing is unambiguous.
`hod2lib` repairs them and reports each substitution in `CamFile.repairs`.
See [`../re/anomalies.md`](../re/anomalies.md).

## Export

Implemented in `hod2lib.gltf._emit_paths`, reached from
`tools/export_level.py --stage N`.

glTF has no look-at, so the exporter composes a rotation per sample: the
camera's local −Z is set to `normalize(target − eye)`, +Y up, and roll applied
about the view axis. Because that rotation is a non-linear function of two
curves, it cannot be expressed as a `CUBICSPLINE` over the source tangents —
so both translation and rotation are **baked** on a fixed frame grid
(default every 2 frames) and emitted as `LINEAR`. Times are converted to
seconds (`frame / 60`).

Each path also produces a visible **rail**: an edge-only `LINE_STRIP` mesh with
two polylines, the eye track and the look-at track. That makes the camera
layout inspectable without playback.

`op_` paths export as a translation-only rail. Their three integer channels
reach the same object fields as the `evt/` spawn descriptor's `+0x14`/`+0x1C`,
whose meaning is **not** settled — so no rotation is emitted for them rather
than guessing.

Verified by rendering through an exported camera: `cp_st2_50_cam` at frame 90
produces a recognisable stage-2 Venice plaza shot, which exercises the keyframe
layout, the Hermite evaluation, the look-at construction and the coordinate
space in one go. `tools/blender_camview.py` automates this.

## Open questions

1. What is the eighth `cp_` descriptor index for? It is always a valid curve.
   **Field of view is the obvious candidate** — it is the one per-path scalar a
   camera needs that no other channel supplies. Unverified, so the exporter
   uses a neutral 60° and flags it.
2. ~~Which `evt/` opcode selects a path slot?~~ **SOLVED** — see *Selection*
   below.
3. Are the six corrupt `op_st1` entries dead data, or does the game read
   garbage for those slots? Their slot ids (304, 306, 309, 320, 322, 324) are
   ordinary members of the file's contiguous run and nothing in the EXE marks
   them special.

## What starts a path — SOLVED

**[proved]** `evt` opcode `0x30` (`queue_event`) with selector `0x40`:

```
queue_event 0x40, start_frame, end_frame, path_index, flags
```

`EvtActionCamPlay40` → `CamStartPathPlayback` → `CamAdvancePathFrame`, which
calls `CamEvalPath7(path_index, frame, &eye, &lookat, &roll, &_)` once per
frame and increments `frame` until it passes `end_frame`. `start_frame == -1`
resumes from where the previous path left off; `start_frame == end_frame`
takes the `CamEvalStaticPose` branch and holds a fixed pose.

The earlier suspects, opcodes `0x18`/`0x19`, are not it.

### Path indices are global, not per file

`CamEvalPath7` looks the descriptor up in `DAT_0059C9F8` and the owning file in
`DAT_004C479C`, a byte-per-path table with one contiguous run per `cam/` file,
`cp_*` first then `op_*`. It is exactly as long as the total path count and has
no terminator.

**[measured]** 23 files, 418 paths, 23 distinct file ids with no id repeated.
Stage ranges: `cp_st1` 32–54, `cp_st2` 55–120, `cp_st3` 121–162,
`cp_st4` 163–202, `cp_st5` 203–216, `cp_st6` 217–232.

**[proved by measurement]** 751/751 camera-play actions in stages 1–6 name a
path from their own stage. `tools/verify_evt_cam.py`.

## Field of view — SOLVED

41.100° vertical (`0x1D3B` BAMS), 53.115° horizontal, 4:3, near 0.8, far 8000,
constant for the whole game. Recovered from `SetupSceneProjection`; see
[`pipeline.md`](pipeline.md). The exporter writes it into every glTF camera.

## The roll channel is gated

**[proved]** `CamEvalPath7` always evaluates curve channels 0–5 into eye and
look-at. It evaluates channel **6** — roll/bank — only when `DAT_009A21B0` is
non-zero, and forces roll to 0 otherwise. That global is written by `evt`
opcode `0x35`. So a `cp_` path's roll curve exists in every file but is only
honoured when the script asks for it.
