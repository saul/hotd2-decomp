# `coli/` collision meshes

**Status: SOLVED, and shipped.** The browser player runs *this* collision —
`game/coli.ts` is a transcription of `ColiSegmentVsMesh` and its callers, and
the bundle carries every blob of both files a scene loads. See
[the port section](#what-the-player-does-with-it) at the end.

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

## Tooling

`hod2lib/coli.py` implements the format; `tools/verify_coli.py` only checks it.

```python
from hod2lib import coli
f = coli.load("coli/coli2.bin")
f.coverage          # 1.0 -- the blob walk tiled the file
f.blobs[0].quads    # [Quad(normal=..., plane_d=..., axis=..., verts=..., surface=...)]
coli.scene_files(1) # ('coli0.bin', 'coli2.bin') -- what scene 1 loads
```

`Stage.colisets()` loads a scene's pair, and `hod2lib/script.py` resolves an
opcode `0x10`/`0x11` operand through `coli.pointer_to_offset`, so the script
dump reads:

```
001438  10 set_collision_set_full  full: coli2.bin+0xb148(6q surf 52,53)
001920  10 set_collision_set_full  full: clear
```

**[measured]** Across stages 1–6 there are 113 collision-set instructions: 41
clear the set and 72 carry 86 pointers, all 86 of which resolve.

`export_level.py` writes `<stage>_coli.json`: both files the scene loads, every
quad's plane, vertices and surface id, plus an `activated` list of the blobs the
event script actually switches on. **[measured]** the collision bounding box for
stage 2 lies inside the exported geometry's bounding box, so the two coordinate
spaces really are the same — `--no-coli` skips it.

## Open questions

1. What do surface ids other than 5 and 55 mean? They form a palette
   (2, 50, 52, 53, 56, 60, 61, 90, 99) but no consumer read so far separates
   them.
2. `coli0.bin` is loaded for every scene, yet **none** of the 86 script
   pointers reference it. What selects it — the object-attached blobs at
   `obj+0x14C`, or a default set installed outside the script?
3. Two quads have an `axis` tag that is not the largest normal component, and a
   handful have a zero-length normal. Authoring slack, or a deliberate marker?
4. Export: the sidecar carries the geometry, but nothing yet builds a debug
   mesh from it. Overlaying it on the exported stage in Blender would be the
   visual confirmation, and would show whether the surface palette lines up
   with visible materials.

## What the player does with it

The browser port answers its own collision queries, in `web/src/game/coli.ts`,
against the quads exported here. It does **not** raycast the drawn geometry —
an earlier pass did, through a `GameHost` seam, and that was wrong twice over:
the drawn mesh only ever has the resident region in it, and it carries no
surface ids at all, so every material test came back 0.

The exporter emits every blob of both files a scene loads, keyed
`"<file>:<offset>"` — which is what an opcode `0x10` / `0x11` pointer resolves
to, so a script selection is a lookup rather than an index. Flat arrays per
blob, the way the baked motions are:

```
min[3] max[3]      the group AABB, written back as an honest min/max pair
n                  quads
plane[4n]          nx, ny, nz, d
verts[12n]         four corners, three floats each
axis[n]            0 = X, 1 = Y, 2 = Z — the component the winding test drops
surface[n]
```

The whole of stage 2's collision is **785 quads across 57 blobs**, about 250 KB
of JSON, so there is no spatial index and none is warranted.

`verify_coli.py` re-derives every blob through the exporter and compares it
field by field with the parsed file — 166 blobs, 0 differing. That check exists
because a transposed vertex triple or an off-by-one stride reads as plausible
geometry and silently moves walls.

### The two sets are the whole of the selection

`G.g_coli_full_set` and `G.g_coli_ray_set` hold blob keys, and evt `0x10` and
`0x11` **replace** them — so a step with an empty operand list clears one.
Both are snapshot state; the blobs themselves are table data and are not.

The segment test consults both sets; the sphere test consults the full set
only. That difference is the only thing distinguishing them, and it is what
makes `0x11` read as scenery that stops a bullet but not a body.

### What asks

| Query | Exe | Who asks |
|---|---|---|
| `ColiTraceSegmentAllSets` | `FUN_004053B0` | everything below |
| `QueryGroundHeightAt` | `FUN_00409D40` | class 0x31's falls; the ground under a wall probe |
| `QueryGroundSurfaceAt` | `FUN_00409D80` | `zskamere`'s perch test, against surface `0x35` |
| `ColiTestSphereAgainstFullSet` | `FUN_004057F0` | `ThrowerPushOutOfWorld`'s two push-outs |

`ThrowerFindWallBeside`, `ThrowerFindCeilingAbove` and
`TraceActorSurfaceContactPoint` are the class-0x31 probes built on top of them
— the wall search that decides whether a `zstin` may climb, and the per-frame
snap that holds it on the wall it climbed. Against the real data, **24 of the
game's 49 class-0x31 spawns have a wall within reach and 14 have a ceiling**;
`tools/verify_thrower_walls.py` measures it.

### Surface `0x35` is the commonest one in the game

The whole-corpus histogram is worth having in one place, because two gameplay
tests key on a specific id:

```
 0:   5    2: 110    3:   6    5:   4   50:  29   52: 465
53: 874   55: 276   56: 266   60: 137   61: 321   90:   7   99:  16
```

`5` and `55` are the wet surfaces — the splash, the ricochet and the canal's
wet footprint all key on them. **`53` = `0x35` is 874 quads, more than a third
of the whole game's collision**, which makes `zskamere`'s perch condition read
as "standing on ordinary ground, more than fifteen units above the camera"
rather than on any special material. `90` = `0x5A` is the seven quads that
**kill whatever lands on them** — class 0x31 tests for it by name in its fall
and its tumble.
