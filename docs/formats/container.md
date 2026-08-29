# `pol/` and `tex/` container

**Status:** solved for uncompressed files; compressed variant blocked on
[`lz.md`](lz.md).

Both `pol/` and `tex/` use the same outer wrapper. A file is either **raw** or
**compressed**; the loader distinguishes them, and determining exactly how is a
Phase 1 task. The working heuristic is below.

## Detection heuristic

Read `dword0` (`u32`, little-endian):

| Condition | Classification |
|---|---|
| file size < 8 | empty / degenerate |
| first two bytes are `42 4D` (`BM`) | Windows BMP, pass through |
| `dword0 == 0x800` | raw, with an offset table |
| `dword0 > file_size` | compressed; `dword0` is the uncompressed size |
| otherwise | raw blob, no table (most `tex/` banks) |

This is a heuristic derived from the data, not from the loader. Counts across the
shipped game:

| Directory | raw w/ table | raw blob | compressed | empty | BMP |
|---|---|---|---|---|---|
| `pol/` | 192 | 1 | 463 | 0 | 0 |
| `tex/` | 29 | 68 | 325 | 23 | 47 |

## Raw layout — offset table

```
+0x000   u32[512]   offset table   (2048 bytes = 0x800)
+0x800   ...        payload
```

Table entries are byte offsets from the start of the file. Unused entries are
zero. The used entries form a monotonically non-decreasing sequence of
**start/end pairs**.

### Worked example — `pol/st2_02.bin` (253952 bytes = `0x3E000`)

Non-zero table entries:

```
0x800, 0x800, 0x26800, 0x26800, 0x34000, 0x34000, 0x3E000
```

Read as `[start, end]` pairs after the leading data-start marker:

| Model | Start | End | Size |
|---|---|---|---|
| 0 | `0x00800` | `0x26800` | 155648 |
| 1 | `0x26800` | `0x34000` | 55296 |
| 2 | `0x34000` | `0x3E000` | 40960 |

The final entry equals the file size. Each start offset holds a valid NaomiLib
NL1 header — see [`nl1.md`](nl1.md).

### Worked example — `pol/st2_01.bin` (40960 bytes = `0xA000`)

```
0x800, 0x800, 0xA000
```

A single model spanning `0x800 → 0xA000`. Verified: parses as NL1 with
`objFormat = 1`, `globalFlag = 0x1`, centroid `(-9.97, 99.75, 50.76)`,
radius `183.07`, 12 meshes, mesh chain terminating correctly on a zero dword.

### Duplicate entries

The repeated values (`0x800, 0x800`) are consistent across every raw file, so the
first entry is most likely a data-start pointer with the pair list beginning at
entry 1. This should be confirmed against the loader rather than assumed —
`pol/etc_1.bin` starts `800, 800, 1000, 1000, ...`, which fits the pair reading
but with an unusually small first model.

## Compressed layout

```
+0x000   u32   uncompressed size
+0x004   ...   bitstream
```

The decompressed result is expected to be one of the raw layouts above. See
[`lz.md`](lz.md).

## Naming and pairing

`pol/NAME.bin` and `tex/NAME.bin` are a matched pair: the models in the former
index into the texture bank in the latter. See [`texbank.md`](texbank.md).

`pol/` additionally contains 326 `pol_`-prefixed files. 320 duplicate their
unprefixed counterpart byte-for-byte and should be ignored. See
[`../re/anomalies.md`](../re/anomalies.md) for the six that don't.

## Open questions

1. How does the loader distinguish raw from compressed? A magic check, a size
   comparison, or a flag in a table elsewhere?
2. Is table entry 0 a data-start pointer, or is the pair list zero-based with a
   degenerate first entry?
3. Does the table have a terminator, or is it bounded only by the zero fill?
