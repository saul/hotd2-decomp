# `pol/` and `tex/` container

**Status:** solved. Parser in
[`tools/hod2lib/container.py`](../../tools/hod2lib/container.py); verified
across every asset in the game.

## Layout

```
+0x000     u32[n]   offset table   (n = entry[0] / 4)
+entry[0]  ...      payload
```

**Entry 0 doubles as the table size.** It is the byte offset at which the
payload starts, so the table occupies exactly `entry[0]` bytes.

> ⚠️ An earlier revision of this document claimed a fixed `0x800` table. That
> was wrong — it was inferred from the uncompressed files, which happen to use
> that value. Decompressed containers carry a right-sized table. Observed sizes
> range from `0x20` upward and are **always a multiple of 32**.

Remaining entries are byte offsets forming **start/end pairs**, one per model.
Unused entries are zero. Entries are non-decreasing and the largest never
exceeds the file size.

## Classification

A file on disk is one of:

| Kind | Test |
|---|---|
| `empty` | fewer than 8 bytes |
| `bmp` | starts `42 4D` (`BM`) |
| `raw` | is a valid container as-is |
| `compressed` | decompresses successfully, per [`lz.md`](lz.md) |
| `blob` | none of the above — opaque data |

Order matters, and the test must be **by trial, not by magic value**. The
obvious heuristic "`dword0 > filesize` implies compressed" is wrong: raw texture
banks routinely open with pixel data whose first dword is huge.
`tex/etc_boy_kao.bin` begins `0xA32992E8` and is entirely uncompressed. Using the
naive test produced 24 false positives.

A valid container is recognised by: `entry[0]` is a multiple of 4, at least 8,
and less than the file size; the used entries are non-decreasing and bounded by
the file size; and the payload at `entry[0]` begins with a valid NL1 object
header.

## Census

```
pol/   458 compressed   192 raw     6 blob
tex/   335 compressed   87 blob    47 bmp    23 empty
```

18,027 models parse out of the `pol/` containers in total.

Note that `tex/` has **no** raw containers: texture banks are either compressed
or bare blobs, because a bank has no offset table at all. See
[`texbank.md`](texbank.md).

## Worked example — `pol/bg_adv10.bin`

232 bytes on disk, header says `0x3C0` = 960 uncompressed.

```
00000000  20 00 00 00  20 00 00 00  c0 03 00 00  00 00 00 00
00000010  00 00 00 00  00 00 00 00  00 00 00 00  00 00 00 00
00000020  01 00 00 00  01 00 00 00  ...
```

Table is `0x20` bytes = 8 entries, of which three are used: `0x20, 0x20, 0x3C0`.
So one model spanning `0x20 → 0x3C0`, and `0x3C0` equals the total size. At
`0x20` sits `01 00 00 00 | 01 00 00 00` — an NL1 header with `objFormat = 1`
(Super Index) and `globalFlag = 1`.

## Worked example — `pol/st2_02.bin` (uncompressed)

Table is `0x800`. Used entries:

```
0x800, 0x800, 0x26800, 0x26800, 0x34000, 0x34000, 0x3E000
```

| Model | Start | End | Size |
|---|---|---|---|
| 0 | `0x00800` | `0x26800` | 155648 |
| 1 | `0x26800` | `0x34000` | 55296 |
| 2 | `0x34000` | `0x3E000` | 40960 |

The final entry equals the file size.

## Loading in the game

`LoadCommonPolTexBanks` at `0x00418200` is the clearest example:

```c
wsprintfA(path, "pol\\%s", "common.bin");
h = CreateFileA(path, GENERIC_READ, FILE_SHARE_READ, NULL, OPEN_EXISTING, 0x80, NULL);
size = GetFileSize(h, NULL);
ReadFile(h, staging, size, &read, NULL);
size = *staging;                       /* u32 uncompressed size */
LzDecompress(staging + 1, dst);        /* +1 on a u32* skips the header */
```

The `pol` bank decompresses into a fixed `.data` buffer at `0x00811720`; the
`tex` bank is allocated at run time as `alloc(size + 0x20)` then aligned up to a
32-byte boundary.

## Naming and pairing

`pol/NAME.bin` and `tex/NAME.bin` are a matched pair: models in the former index
into the texture bank in the latter. See [`texbank.md`](texbank.md).

`pol/` also holds 326 `pol_`-prefixed files. 320 duplicate their unprefixed twin
byte-for-byte. See [`../re/anomalies.md`](../re/anomalies.md) for the rest.

## Open questions

1. How does the game decide a file is compressed? `LoadCommonPolTexBanks`
   decompresses unconditionally, yet 192 `pol/` files are raw. Either another
   loader handles them or a flag lives in a `.data` table.
2. Is entry 0 conceptually "table size" or "first model start"? It is both in
   every file observed, so the distinction has not mattered yet.
