# NaomiLib NL1 model

**Status:** layout confirmed by parsing real HOD2 data; a few semantics still
open.

All values little-endian. All floats IEEE-754 binary32. All offsets are byte
offsets from the start of the model (**not** the start of the containing file).

Models live inside the `pol/` container — see [`container.md`](container.md).
HOD2 uses NL1 throughout; the NAOMI2 (`NL2`) variant, identified by
`dword0 == 0x100`, does not appear.

## Validity check

A model header is recognised by:

- `u32 @0x00` is `0` or `1`
- `u32 @0x04` has bit 0 set
- `u32 @0x04` has no bits above bit 4 set

Every HOD2 model observed so far has `objFormat == 1` (Super Index) and
`globalFlag == 0x1`.

## Object header — 0x18 bytes

| Offset | Type | Field | Notes |
|---|---|---|---|
| `0x00` | `u32` | `objFormat` | `0` = Pure/Beta index, `1` = Super Index, `0xFFFFFFFF` = null model |
| `0x04` | `u32` | `globalFlag` | bitfield, below |
| `0x08` | `f32` | `centroid.x` | bounding **sphere** centre |
| `0x0C` | `f32` | `centroid.y` | |
| `0x10` | `f32` | `centroid.z` | |
| `0x14` | `f32` | `radius` | |

### `globalFlag`

| Bit | Meaning |
|---|---|
| 0 | always set on a valid model |
| 1 | no lighting |
| 2 | environment mapping used |
| 3 | palettised texture used |
| 4 | bump map used |
| 5–31 | reserved; must be zero |

Meshes begin at `0x18`.

## Mesh header — 0x50 bytes

| Offset | Type | Field | Notes |
|---|---|---|---|
| `+0x00` | `u32` | `parameter_control` | PCW, below |
| `+0x04` | `u32` | `isp_tsp_instruction` | below |
| `+0x08` | `u32` | `tsp_instruction` | below |
| `+0x0C` | `u32` | `texture_control` | below |
| `+0x10` | `f32` | mesh centroid x | |
| `+0x14` | `f32` | mesh centroid y | |
| `+0x18` | `f32` | mesh centroid z | |
| `+0x1C` | `f32` | mesh radius | |
| `+0x20` | `s32` | **texture ID** | index into the paired `tex/` bank; `-1` = untextured |
| `+0x24` | `s32` | **shading mode** | selects the vertex layout — see below |
| `+0x28` | `f32` | texture ambient | **bit 0 is a flag**, not float data |
| `+0x2C` | `f32` | base colour A | |
| `+0x30` | `f32` | base colour R | |
| `+0x34` | `f32` | base colour G | |
| `+0x38` | `f32` | base colour B | |
| `+0x3C` | `f32` | offset colour A | **doubles as the palette index** for PAL4/PAL8 |
| `+0x40` | `f32` | offset colour R | |
| `+0x44` | `f32` | offset colour G | |
| `+0x48` | `f32` | offset colour B | |
| `+0x4C` | `u32` | `mesh_data_size` | bytes of geometry that follow |

Geometry starts at `hdr + 0x50`. The mesh ends at:

```
mesh_end = hdr + 0x50 + mesh_data_size
```

> ⚠️ The reference Blender addon computes `size + 0x64` for mesh 0, which is
> 4 bytes short. Use the formula above uniformly.

### Mesh iteration

Read a `u32` at the current position. If it is zero, the mesh list is over — the
following `u32` is the model's total vertex count. Otherwise parse a mesh header
at that position and advance by `0x50 + mesh_data_size`.

## Register bitfields

These are PowerVR2 hardware register words carried verbatim. They are the
authoritative source for material state; see [`../PLAN.md`](../PLAN.md) Phase 5.

### `parameter_control` (PCW)

| Bits | Field | Values |
|---|---|---|
| 0 | 16-bit UV | 0 = two `f32` UVs, 1 = 16-bit |
| 1 | Gouraud | |
| 2 | offset colour enable | |
| 3 | texture enable | |
| 4–5 | colour type | 0 packed, 1 floating, 2 intensity 1, 3 intensity 2 |
| 6–7 | volume / shadow | 2 = shadow volume |
| 16–17 | user clip mode | |
| 18–19 | strip length | |
| 23 | group enable | |
| 24–26 | **list type** | 0 opaque, 1 opaque mod-vol, 2 translucent, 3 trans mod-vol, **4 punch-through** |
| 29–31 | parameter type | 4 = global parameter polygon |

List type drives alpha-test vs alpha-blend downstream and matters a great deal
for correct export.

### `isp_tsp_instruction`

| Bits | Field | Values |
|---|---|---|
| 20 | D-calc control | |
| 21 | cache bypass | |
| 22 | 16-bit UV | |
| 23 | Gouraud | |
| 24 | offset colour | |
| 25 | texture | |
| 26 | Z-write **disable** | |
| 27–28 | culling mode | 0 none, 1 cull if small, 2 cull if negative, 3 cull if positive |
| 29–31 | depth compare | 0 never … 7 always |

Effective per-triangle culling comes from the **per-strip** 2-bit field, not from
here — see below.

### `tsp_instruction`

| Bits | Field | Values |
|---|---|---|
| 0–2 | texture **V** size | `8 << n`, so 8 … 1024 |
| 3–5 | texture **U** size | `8 << n` |
| 6–7 | texture shading | 0 decal, 1 modulate, 2 decal-alpha, 3 modulate-alpha |
| 8–11 | mipmap D adjust | |
| 12 | supersample | |
| 13–14 | filter mode | 0 point, 1 bilinear, 2/3 trilinear pass A/B |
| 15–16 | clamp UV | 0 none, 1 clamp V, 2 clamp U, 3 both |
| 17–18 | flip UV | 0 none, 1 flip V, 2 flip U, 3 both |
| 19 | ignore texture alpha | |
| 20 | use alpha | |
| 21 | colour clamp | |
| 22–23 | fog control | 0 LUT, 1 per-vertex, 2 none, 3 LUT mode 2 |
| 24 | DST select | |
| 25 | SRC select | |
| 26–28 | DST blend factor | 0 zero, 1 one, 2 other colour, 3 inv other colour, 4 SRC alpha, 5 inv SRC alpha, 6 DST alpha, 7 inv DST alpha |
| 29–31 | SRC blend factor | same enum |

**Texture dimensions come from here**, which is why the `tex/` bank can be
headerless.

### `texture_control`

| Bits | Field | Values |
|---|---|---|
| 0–20 | texture address | 64-byte-aligned VRAM address; **`0` in every HOD2 model observed** |
| 21–25 | palette selector | |
| 25 | stride select | |
| 26 | scan order | 0 = twiddled, 1 = non-twiddled |
| 27–29 | **pixel format** | 0 ARGB1555, 1 RGB565, 2 ARGB4444, 3 YUV422, 4 bump, 5 PAL4, 6 PAL8, 7 reserved |
| 30 | **VQ compressed** | |
| 31 | **mipmapped** | |

> ⚠️ The reference addon masks the address field with decimal `23` rather than
> `0x1FFFFFF`. Use `0x1FFFFFF`.

Bits 21–25 and 25–26 overlap in the sources consulted. Resolve against the
binary in Phase 5.

## Strip header — 8 bytes

Geometry is a sequence of strips, each introduced by:

| Offset | Type | Field |
|---|---|---|
| `+0` | `u32` | strip flags |
| `+4` | `u32` | count |

If flag bit 3 (triangle list) is set, `count` is a **triangle** count and the
vertex count is `count * 3`. Otherwise `count` is the vertex count directly.

### Strip flags

| Bit | Meaning |
|---|---|
| 0–1 | **culling**: 0 none, 1 double-sided, 2 backface culled, 3 frontface culled |
| 2 | sprite / quad |
| 3 | independent triangle list |
| 4 | triangle strip |
| 5 | super-index format — back-references may appear |
| 6 | Gouraud |
| 7 | reuse previous global parameters |
| 8 | environment mapping |

## Vertex records

The layout is selected by the mesh header's **shading mode** at `+0x24`, not by a
per-vertex tag.

### Default — `shading >= 0` (Lambert) or `-1` (constant): 32 bytes

| Offset | Type | Field |
|---|---|---|
| `0x00` | `f32` | x — **bit 0 is a start-of-vertex marker** |
| `0x04` | `f32` | y |
| `0x08` | `f32` | z |
| `0x0C` | `f32` | nx |
| `0x10` | `f32` | ny |
| `0x14` | `f32` | nz |
| `0x18` | `f32` | u |
| `0x1C` | `f32` | v — **bit 0 is an end-of-vertex marker** |

Because bit 0 is stamped into `x` and `v`, a true `+0.0` is stored as
`0x00000001` — a denormal. Clamp denormals to `±0.0` on read.

### Vertex colour — `shading == -3`: 32 bytes

| Offset | Type | Field |
|---|---|---|
| `0x00`–`0x0B` | `3 × f32` | x, y, z |
| `0x0C`–`0x0E` | `3 × s8` | packed normal — **byte order unresolved**, see below |
| `0x0F` | `u8` | padding |
| `0x10`–`0x13` | `4 × u8` | vertex colour, B G R A |
| `0x14`–`0x17` | `4 × u8` | duplicate colour, discard |
| `0x18`–`0x1F` | `2 × f32` | u, v |

`s8 → float`: `n > 0x7F ? (n - 0x100) / 128.0 : n / 127.0`.

### Bump — `shading == -2`: **56 bytes**

| Offset | Type | Field |
|---|---|---|
| `0x00`–`0x0B` | `3 × f32` | x, y, z |
| `0x0C`–`0x17` | `3 × f32` | normal — bit 0 of `nx` is a "same bump" flag |
| `0x18`–`0x23` | `3 × f32` | tangent |
| `0x24`–`0x2F` | `3 × f32` | binormal |
| `0x30`–`0x37` | `2 × f32` | u, v |

> ⚠️ One of the reference addon's code paths walks these as 32 bytes. 56 is
> correct — it matches both the reader and the writer.

### Back-reference — 8 bytes

Only in Super Index models (`objFormat == 1`). Detected by reading a `u32` at the
vertex position and testing `(word0 >> 20) == 0x5FF`.

| Offset | Type | Field |
|---|---|---|
| `+0` | `u32` | DMA back-distance token |
| `+4` | `s32` | relative offset; target = `(position_of_this_record + 8) + word1` |

Resolve the target against a per-mesh map of `file_offset → vertex_index`. A
back-reference occupies a strip slot but creates no new vertex. The map resets at
every mesh boundary, so references never cross meshes.

## Strip → triangle conversion

Let `slots` be the per-mesh list of vertex indices in emission order and `base`
the strip's first slot.

**Triangle list:** for each `j`, `i = base + 3j`. Emit `(i, i+1, i+2)`, or
`(i+1, i, i+2)` when culling is 2.

Both primitive types share one base winding — **the first two indices are
swapped** — and reversal keys on **culling mode 3** (`rclock`, reversed
clockwise), *not* mode 2.

**Triangle list:** emit `(i+1, i, i+2)`, or `(i, i+1, i+2)` when `culling == 3`.

**Strip:** for `j` in `0 .. n-3`, swap the first two indices when
`(j is even) != (culling == 3)`.

> ⚠️ An earlier revision of this document had the reversal on `culling == 2`.
> That is wrong and produces almost entirely back-facing geometry.

This was settled empirically rather than by reading the flag names. NL1 stores
per-vertex normals, so for each candidate rule the geometric normal
`(b-a) x (c-a)` can be compared against the summed vertex normals:

| Rule | Agreement |
|---|---|
| triangle lists, base `(b,a,c)` | **100.0%** (at both `cull=1` and `cull=2`) |
| strips, swap-on-even + reverse on `cull==3` | **99.6%** |
| strips, no reversal at all | 77.8% |
| strips, reverse on `cull==2` (the old rule) | 2.0% |

Corpus-wide after the fix: **97.81%** of 1,305,883 triangles agree. The residual
~2% is source data whose stored normals genuinely disagree with face winding.

No `culling == 3` triangle lists occur anywhere in the game, so that combination
is inferred from the strip behaviour rather than measured.

Culling 0 or 1 means double-sided; 2 or 3 means single-sided.

UVs are stored with `v` inverted relative to the usual convention — flip on
import.

## 16-bit UVs are not decoded ⚠️ known bug

`parameter_control` bit 0 selects **16-bit UV** instead of two `f32`. Across
stage1+2 geometry:

| | meshes |
|---|---|
| 32-bit UV | 5,957 |
| **16-bit UV** | **128** (2.1%) |

Worst files: `st2_02` (13), `st1_03b` (12), `st2_07` (11), `st1_1` (10),
`st2_03` (9).

`_read_vertex()` always reads two 32-bit floats, so for those 128 meshes both
the vertex stride and the UV values are wrong. The reference Blender addon has
the same gap — it never honours the flag either — so it cannot be used as an
oracle here.

### What the render path rules out

`WalkMeshChainAndDraw` (`0x004A7EF0`) is the mesh-chain walker, and it submits
vertices with:

```c
DrawPrimitive(D3DPT_TRIANGLESTRIP /*5*/, 0x112, verts, count, 0);   // strips
DrawPrimitive(D3DPT_TRIANGLELIST  /*4*/, 0x112, verts, count, 0);   // lists
```

FVF `0x112` is `D3DFVF_XYZ | D3DFVF_NORMAL | D3DFVF_TEX1` — 8 dwords, UV at
dwords 6–7. That is exactly the 32-byte layout `_read_vertex()` already
assumes, and it is the *only* format handed to D3D.

So there is **no 16-bit UV path at draw time**. Whatever bit 0 does, the
vertices reaching the device are always two `f32` UVs. Two possibilities
remain, in order of likelihood:

1. **A load-time conversion.** `FUN_00419270`, run on every model after load,
   walks the mesh chain and does `*strip_ctrl ^= 1` — it *toggles bit 0* of
   each strip control word. A load-time expand-in-place of packed UVs would fit
   that exactly, with the toggle marking "already converted".
2. **Bit 0 does not mean 16-bit UV here.** The bit assignment in the table
   above came from PowerVR2 documentation, not from this binary.

The walker's second vertex path — 2 dwords for a back-reference, 14 inline —
is guarded by `global_flag & 0x10`, and **no model in the game sets that bit**
(0 of 9,112). It is dead code and not the answer.

Next step is `FUN_00419270` and its caller in the asset load path, not the
renderer.

## UV anisotropy is authored, not an export fault

Worth recording because it was investigated at length. For every triangle,
world-units-per-texel along u versus along v, via the texel→world Jacobian:

```
geometric mean 0.937   median 0.955   n = 72,209
```

Centred on 1.0 and symmetric — 24.2% below 0.55, 15.6% above 2.2. A global
aspect error would skew this to one side; it does not.

Competing hypotheses, by median anisotropy (lower is better):

| hypothesis | median |
|---|---|
| as-is, exe texture dimensions | **1.81** |
| VQ half dimensions | 1.81 |
| square 1:1 | 2.15 |
| u/v swapped | 2.50 |

The parser's UV values were also verified **identical** to the reference
`NLimporter.parse_nl()` on `st2_07` model 12. So heavily anisotropic faces are
present in the source art; the game presumably hides them behind its fixed
camera rail.

## Collapsed-UV triangles

**5.1% of triangles have real 3D area but near-zero UV area** — all three
vertices collinear in UV space. One row or column of texels then stretches
across the whole face, giving a hard directional streak, or a solid-looking
face when those texels are uniform.

They cluster at strip boundaries:

| position in strip | share collapsed |
|---|---|
| first triangle | 4.9% |
| middle | 1.1% |
| last | 4.8% |

Only 8.6% involve a back-reference, so this is not a vertex-reuse fault — it
looks like stitching artifacts at strip joins.

`drop_collapsed_uv_triangles()` removes them; the exporter does so by default.
Why the hardware does not display them is unresolved.

## Skeleton

There is none. NL1 has no bones, no skin weights and no node hierarchy.
Multi-part models are multiple mesh blocks in one file, or multiple models in one
container. Whatever `mot/` drives, it is not a skeleton — see
[`mot.md`](mot.md).

## Worked example — `pol/st2_01.bin`, model at `0x800`

```
objFormat = 1   globalFlag = 0x1
centroid  = (-9.97, 99.75, 50.76)   radius = 183.07
```

First three meshes:

| # | Offset | PCW | ISP | TSP | TCT | texID | shading | size |
|---|---|---|---|---|---|---|---|---|
| 0 | `0x000818` | `800000AC` | `83000000` | `200E045B` | `4C000000` | 14 | 0 | 5376 |
| 1 | `0x001D68` | `800000BC` | `83000000` | `200E0464` | `4C000000` | 13 | 0 | 1344 |
| 2 | `0x0022F8` | `800000BC` | `83000000` | `200C045B` | `4C000000` | 16 | 0 | 200 |

Decoding mesh 0's texture words: `TSP = 0x200E045B` → V size `0b011` = 64,
U size `0b011` = 64. `TCT = 0x4C000000` → scan order 1 (non-twiddled), pixel
format 1 (RGB565), VQ 1, mipmap 0. So a 64×64 VQ-compressed RGB565 texture,
which costs `2048 + (64 × 64) / 4 = 3072` bytes in the bank.

Twelve meshes total, texture IDs 0–27 across the model, chain terminating
correctly.

## Open questions

1. **Packed s8 normal byte order.** The reference reader treats byte 0 as `nx`;
   the reference writer emits byte 0 as `nz`. Settle empirically against HOD2
   data — compare packed normals against the face normals they should
   approximate.
2. `texture_control` bits 21–26: palette selector width and its overlap with
   stride select and scan order.
3. Sprite/quad strips (flag bit 2) — do they occur in HOD2 at all?
4. 16-bit UVs (PCW bit 0) — do they occur? The reference importer never honours
   the flag.
5. The exact meaning of the `tex_ambient` bit-0 flag.
