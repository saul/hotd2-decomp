# `cam/` camera data

**Status:** container understood, block contents unknown. Phase 6.

24 files, two naming families:

| Prefix | Count | Examples |
|---|---|---|
| `cp_` | 14 | `cp_st1` … `cp_st6`, `cp_demo`, `cp_end`, `cp_title`, `cp_train`, `cp_tuto`, `cp_test`, `cp_gmovr` |
| `op_` | 10 | `op_st1` … `op_st6`, `op_demo`, `op_org`, `op_train` |

Every stage has both a `cp_` and an `op_` file, so they are complementary rather
than alternative. A plausible reading is "camera path" and "object path", but
this is unconfirmed.

## Container

`u32` offset table at the start of the file, monotonically increasing, no `0x800`
padding — unlike `pol/`, the table is sized to its contents.

`cam/cp_st2.bin`, 127308 bytes:

```
0x4AC, 0xE6C, 0x16AC, 0x1BEC, 0x28AC, 0x356C, 0x392C, 0x3B6C,
0x422C, 0x48EC, 0x55AC, 0x626C, ...
```

The first entry (`0x4AC` = 1196) is presumably where the table ends and data
begins, implying 299 `u32` entries. Confirm by checking that the table region
contains only monotonically increasing values.

Sizes vary widely: `cp_gmovr` and `cp_title` are 584 bytes; `cp_st2` is 127308.

## Loader

`0x403F1B` builds the path from `cam\%s` (`0x5773D0`) and a filename pointer
table at `0x4D1BC8`. It is split across two functions:

- `0x403F1B` — `sprintf`, `CreateFileA`, `GetFileSize`, allocate `size + 0x20`,
  align up to 32
- `0x403FB0` — the actual `ReadFile`

Between them the loader computes `base + 4 + count * 4` where `count` comes from
a `u16` table at `0x4C476C`, and stores 8-byte records into an array at
`0x59C9F8`. That arithmetic is consistent with skipping a per-file offset table
whose length is known in advance — good corroboration for the container reading
above.

## Approach

RE the playback routine rather than guessing the block layout. What is needed:

- The keyframe struct — position, target/orientation, roll, FOV, timing
- The interpolation scheme — linear, Catmull-Rom, Bezier
- How a block is selected and triggered, and how it relates to `evt/` events
- What distinguishes `cp_` from `op_`

## Export

Camera paths become glTF animations targeting a camera node. If `op_` turns out
to drive scenery or enemies, those become node animations on the relevant
objects.

## Open questions

1. `cp_` vs `op_` — what is the actual distinction?
2. Is the first table entry a count, a data-start pointer, or both?
3. Are timings in frames at 60 Hz, or in some other unit?
4. Do camera blocks reference `evt/` entries, or vice versa?
