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
(`0x004C476C`) for all 24 files.

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

## Timebase

Times are **frame numbers at 60 Hz**. 99.68 % of the 44,750 real keyframe times
sit within 0.01 of an integer; the residue is f32 accumulation error in whatever
tool exported them, not a finer subdivision. The longest curve runs to frame
3600 — exactly 60 seconds.

Path durations run from 55 frames (0.9 s) to 1810 frames (30 s).

## Binding: which path is which

Which global **slot** a file's path *k* occupies is not in the file. Three
parallel tables in `Hod2.exe` hold it, and `FUN_00404000` applies them at load:

| Address | Indexed by | Contents |
|---|---|---|
| `0x004C476C` | cam file | `u16` path count |
| `0x004C470C` | cam file | pointer to `s16[count]` — the global slot id of each path |
| `0x004C479C` | slot | `s8` owning cam file index |
| `0x004D1BC8` | cam file | filename pointer |
| `0x0059C9F8` | slot | runtime `{u32 ptr; u16 state}`, 8 bytes |

Slot ids are allocated as one contiguous ascending run per file
(`op_st1` owns 253–327, for example).

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

Each channel becomes a glTF `CUBICSPLINE` sampler. `cp_` paths target a camera
node — eye from the first three channels, and a look-at built from the next
three (glTF has no look-at, so the exporter must compose a rotation). `op_`
paths target ordinary node translation/rotation, with the rotation channels
converted from BAMS (`65536 = 360°`).

## Open questions

1. What is the eighth `cp_` descriptor index for? It is always a valid curve.
2. Which `evt/` opcode selects a path slot? Opcodes `0x18`/`0x19` write the two
   fields at view+0x18/+0x1C that `FUN_004041E0` is called with
   (`FUN_00401F40` passes `DAT_009A3558`/`DAT_009A355C`), so those are the
   prime suspects, but the mapping from operand to slot id is not yet traced.
3. Are the six corrupt `op_st1` entries dead data, or does the game read
   garbage for those slots? Their slot ids (304, 306, 309, 320, 322, 324) are
   ordinary members of the file's contiguous run and nothing in the EXE marks
   them special.
