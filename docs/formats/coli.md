# `coli/` collision data

**Status:** structure partially visible, semantics unknown. Phase 6.

9 files:

| File | Size |
|---|---|
| `coli.bin` | 241664 |
| `coli0.bin` … `coli6.bin` | 1032 – 67976 |
| `coliT.bin` | 1024 |

`coli0` – `coli6` map to the six stages plus a common set; `coli.bin` is roughly
the sum of the rest and may be a combined build. `coliT` is probably the tutorial
or a test asset.

## Observed layout

Unlike `pol/` and `cam/`, there is no offset table. The file opens with small
integer counts followed immediately by float data.

`coli/coli2.bin`, 53160 bytes:

```
offset  0x00  01 00 00 00    u32  1
offset  0x04  12 00 00 00    u32  0x12 = 18
offset  0x08  EA EE 0E C4    f32  -571.73
offset  0x0C  99 63 30 42    f32   44.10
offset  0x10  8A E5 99 C4    f32  -1231.17
offset  0x14  9D B2 19 C4    f32  -614.79
offset  0x18  01 43 5C C1    f32  -13.77
offset  0x1C  62 94 A1 C4    f32  -1292.64
...
offset  0x30  02 00 00 00    u32  2
```

The magnitudes match the model coordinate space — `pol/st2_01.bin` has a
bounding radius of 183 and a centroid near `(-10, 100, 51)` — so these are world
coordinates in the same units.

A second `u32` count (`2`) appears at `0x30`, suggesting a repeating
`count → records` structure rather than one flat array.

There is also a plausible normal at `0x24`–`0x2C`:
`(-0.199, 0.0, -0.980)`. That vector is close to unit length, which would make
these plane- or face-based records rather than raw triangle soup.

## Loader

`0x48A326` builds the path from `coli\%s` (`0x597260`). The surrounding function
has not been analysed.

## Approach

RE the hit-test routine, which is the only reliable way to learn what these
records mean. Open questions it should answer:

- Are these shot-collision volumes — what the player's gun tests against?
- Player rails or movement bounds?
- Enemy pathing / navigation surfaces?
- All of the above, distinguished by the leading type field?

The nesting (`count`, records, `count`, records) suggests a grouped structure:
possibly per-object, per-region, or a spatial partition.

## Export

JSON sidecars, plus optionally a debug glTF mesh so the volumes can be
visualised against the level geometry — a good sanity check that the coordinate
spaces really do match.

## Open questions

1. What do the leading `u32` values mean — type tags, counts, or IDs?
2. Is the record stride fixed? The gap from `0x08` to `0x30` is 40 bytes, which
   would be 10 floats — a plausible record but not yet confirmed.
3. Is `coli.bin` a concatenation of `coli0` – `coli6`, or a separate dataset?
4. How does a record link back to a model or a stage region?
