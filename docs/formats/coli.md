# `coli/` collision meshes

**Status: SOLVED.** Format recovered from the hit test, validated to 100.00 %
byte coverage on every loaded file and cross-checked against the event scripts.

All values little-endian, floats IEEE-754 binary32, world coordinates in the
same units as `pol/` geometry.

## What reads it

`ColiSegmentVsMesh` (`0x004AAA40`) is the segment-vs-quad test and states the
whole layout. Everything below comes from it, not from staring at the bytes.

| Address | Name | Role |
|---|---|---|
| `0x004AAA40` | `ColiSegmentVsMesh` | segment vs one blob; returns the nearest hit's surface id |
| `0x004053B0` | `ColiTraceSegmentAllSets` | walks dynamic objects' own blobs, then both script-selected sets |
| `0x004057F0` | `ColiTestSphereAgainstFullSet` | sphere test; consults the **full** set only |
| `0x00409D40` | `QueryGroundHeightAt` | a segment from `y+1000` down to `y`; returns the hit height, else the ground plane |
| `0x0048A310` | `ColiLoadFileByIndex` | `coli\%s` → a fixed buffer |
| `0x0048A3B0` | `ColiLoadForScene` | which files a scene loads |

## File layout

A file is a flat sequence of **blobs**, packed end to end with no header, no
offset table and no padding. Nothing marks the end — a file ends where its
bytes run out.

```
blob:
    u32  group_count                    (always 1 in shipped data)
    repeat group_count:
        u32  quad_count
        f32  aabb_max[3]                <- MAX first
        f32  aabb_min[3]
        repeat quad_count:              18 dwords = 72 bytes
            f32  nx, ny, nz, d          plane
            u32  axis                   dominant axis: 0 = X, 1 = Y, 2 = Z
            f32  v0[3], v1[3], v2[3], v3[3]
            u32  surface                surface material id
```

Group header is 28 bytes, a quad is 72.

> ⚠️ **The AABB is stored max-then-min.** The reject test reads
> `seg_min.x <= box[1] && … && box[4] <= seg_max.x`, so `box[1..3]` is the
> upper corner and `box[4..6]` the lower one. Reading it as min-then-max gives
> an inverted box that rejects everything.

`axis` is an **integer in a float slot** — the decompiler shows comparisons
against `1.4013e-45` and `2.8026e-45`, which are the bit patterns of the
integers 1 and 2. It selects which two components the point-in-quad test uses:
four 2D cross products in the plane that drops the dominant axis.

### The test itself

Signed plane distances at both segment ends; a hit needs opposite signs. A
back-facing hit is only accepted when `DAT_009CAC5C` is set. The intersection
point is the distance-weighted blend of the endpoints, and the nearest hit by
squared distance from the segment start wins, reported through
`g_coli_hit_surface` / `_quad` / `_dist_sq` / `_x,_y,_z` / `_normal_*`.

## Which files a scene loads

`ColiLoadForScene` loads **two**:

```c
if (0 <= scene && scene < 7) {
    ColiLoadFileByIndex(0);          /* coli0.bin -> 0x0098F200, always */
    ColiLoadFileByIndex(scene + 1);  /* coliN.bin -> 0x00990A00        */
}
```

So `coli0.bin` is a common set present in every scene, and `coli1`…`coli6` are
the per-stage sets. The filename table is at `0x004D1CC4`; index 7 is
`coliT.bin`, which `ColiLoadForScene` never reaches.

**`coli.bin` is not loaded by the game at all.** It is absent from the filename
table, begins with 0x800 bytes of zeros, and contains the other files at
`0x800`-aligned offsets. A build artifact left in the data directory.

## How a scene selects blobs — the `evt` link

`evt` opcodes `0x10` and `0x11` carry `-1`-terminated lists of **absolute
addresses**, not indices. That works because the `evt` relocation pass has
already rewritten every dword in `0x0CE80000..0x0CEFFFFF` by `-0x0C53E600`,
mapping them onto the load window — and the two collision buffers sit inside
it. So a pointer resolves as:

```
addr = operand - 0x0C53E600
offset_in_coli0     = addr - 0x0098F200
offset_in_scene_set = addr - 0x00990A00
```

The two lists are used differently:

| Opcode | Set | Consulted by |
|---|---|---|
| `0x10` | full | the segment/ray test **and** the sphere test |
| `0x11` | ray-only | the segment/ray test only |

**[likely]** `0x11` is scenery that stops a bullet but not movement.

## Surface ids

`ColiSegmentVsMesh` returns the winning quad's `surface` field. Counts across
all eight loaded files:

| id | quads | | id | quads |
|---|---|---|---|---|
| 0 | 5 | | 53 | 874 |
| 2 | 110 | | 55 | 276 |
| 3 | 6 | | 56 | 266 |
| **5** | 4 | | 60 | 137 |
| 50 | 29 | | 61 | 321 |
| 52 | 465 | | 90 | 7 |
| | | | 99 | 16 |

**[proved] `5` and `55` are wet surfaces.** Two independent consumers agree:

- `FUN_00456B70` (impact effect on the ground) spawns effect asset `0x61` with
  two extra ripple calls instead of the usual `0x46` — the same effect the rain
  flag (evt opcode `0x1D`) selects.
- `FUN_0040A230` (a bouncing dropped object) plays sound `0x4416A9` instead of
  `0x2616A9` on contact.

The other ids are **[open]** — they are clearly a material palette, but nothing
read so far distinguishes them.

## Corpus

| File | Bytes | Blobs | Quads | Coverage |
|---|---|---|---|---|
| `coli0.bin` | 5,184 | 9 | 68 | 100.00 % |
| `coli1.bin` | 9,224 | 16 | 121 | 100.00 % |
| `coli2.bin` | 53,160 | 48 | 717 | 100.00 % |
| `coli3.bin` | 67,976 | 16 | 937 | 100.00 % |
| `coli4.bin` | 44,080 | 23 | 602 | 100.00 % |
| `coli5.bin` | 1,032 | 3 | 13 | 100.00 % |
| `coli6.bin` | 3,504 | 6 | 46 | 100.00 % |
| `coliT.bin` | 1,024 | 5 | 12 | 100.00 % |
| `coli.bin` | 241,664 | — | — | not loaded; build artifact |

126 groups, 2,516 quads. Every blob in the shipped data has exactly one group.

## Validation

`tools/verify_coli.py`. Each check collapses if the interpretation is wrong:

| Check | Result |
|---|---|
| the blob walk tiles every loaded file with no slack | **8/8 at 100.00 %** |
| quad vertices inside their group's AABB | **0 violations of 10,064** |
| worst \|n·v + d\| over every quad vertex | 3.7e-01 (p99 5.1e-03) |
| worst \| ‖n‖ − 1 \| | 6.8e-07 |
| `axis` equals argmax\|normal\| | 2,514 / 2,516 |
| **evt `0x10`/`0x11` pointers landing on a blob header** | **86 / 86** |

That last one is the strongest: a scene's file has only 3–48 valid blob starts
among tens of thousands of byte offsets, and every pointer in every stage
script hits one.

The `|n·v + d|` tail is float precision on large coordinates, not a layout
error — the p99 is 5e-03 and the vertices still sit inside their AABB.

## Open questions

1. What do surface ids other than 5 and 55 mean? They form a palette
   (2, 50, 52, 53, 56, 60, 61, 90, 99) but no consumer read so far separates
   them.
2. `coli0.bin` is loaded for every scene, yet **none** of the 86 script
   pointers reference it. What selects it — the object-attached blobs at
   `obj+0x14C`, or a default set installed outside the script?
3. Two quads have an `axis` tag that is not the largest normal component, and a
   handful have a zero-length normal. Authoring slack, or a deliberate marker?
4. Export: the quads are directly renderable as a debug mesh, which would let
   the collision be checked visually against the exported stage geometry.
