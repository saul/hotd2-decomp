# Build provenance

Artefacts left in the shipped game that reveal how it was built.

## `pol/files.txt`

A stray Shift-JIS `dir` listing accidentally shipped inside `pol/`. It is not
loaded by the game — the `pol\%s` path template only ever forms `.bin` names.

It records:

| | |
|---|---|
| Volume label | `WORK` |
| Volume serial | `B892-3D05` |
| Directory | `E:\Hod2\Image\pol` |
| Directory timestamps | 2000-03-21 16:11 |
| File timestamps | 2000-05-24 15:17 – 2000-05-25 |
| Entries | 327 |

`Hod2\Image\pol` implies the assets were staged into a disc/ROM **image** tree
during the build, matching a NAOMI/Dreamcast origin.

### It is a snapshot of an earlier build

All 327 listed files exist in the shipped game, but the sizes mostly do not
match:

| | Count |
|---|---|
| Listed size == shipped size | 102 |
| Listed size != shipped size | 225 |
| Listed but absent from disk | 0 |

The differences are small and go **both** directions:

| File | Listed (2000-05-24) | Shipped (2001-05-09) | Delta |
|---|---|---|---|
| `b6boss1z.bin` | 29952 | 30021 | +69 |
| `b6boss1z_wing.bin` | 2443 | 2442 | −1 |
| `b6boss2.bin` | 31643 | 32008 | +365 |
| `b6boss3.bin` | 31250 | 31151 | −99 |
| `bg_adv00.bin` | 63465 | 63515 | +50 |
| `bg_adv03.bin` | 81848 | 81832 | −16 |
| `bg_adv04.bin` | 3899 | 3896 | −3 |
| `bg_adv06.bin` | 6506 | 6528 | +22 |

The `Hod2.exe` link timestamp is 2001-05-09, roughly a year after the listing.

### Why this matters for Phase 2

Small bidirectional size deltas on the same logical assets are the signature of
**recompression**, not of content change. Genuine asset edits over a year would
produce large, mostly one-directional differences and would not leave 102 files
byte-size-identical.

So the listing is corroborating evidence that these files are compressed, and
that the codec — or its parameters — was touched between the two builds. A
pure-LZ codec with a different match-search effort or window size produces
exactly this pattern: identical output for simple inputs, small wobble
either way for complex ones.

Two consequences:

1. If a Dreamcast or NAOMI release of HOTD2 is available for comparison, its
   `pol/` files should decompress with the *same* algorithm to *identical*
   plaintext, giving free cross-validation.
2. The 102 size-identical files are the most likely to be bit-identical across
   builds, so they are the best candidates for any cross-version differential
   work.

### Caveats

- The listing is DOS 8.3 + long-name `dir` output; some 8.3 names are truncated
  (`B6BOSS~1`), so always key off the long name in the last column.
- It covers `pol/` only. No equivalent listing exists for `tex/`, `mot/`, `cam/`,
  `evt/` or `coli/`.
- 327 listed vs 326 `pol_`-prefixed files on disk — close, but the sets are not
  identical and the correspondence has not been established. The listing enumerates
  unprefixed names.

## Other build traces

| Source | Detail |
|---|---|
| `Hod2.exe` link timestamp | 2001-05-09 07:10:09 UTC |
| Compiler | MSVC 6.0 (linker version 6.0) |
| `exception.log` | Three crash dumps from 2022-07-30, from an end user rather than the build |
| `evt/st1evtbl - Copy.bin` | A stray Explorer-made duplicate of `st1evtbl.bin`, byte-identical |
| `evt/` pointer values | Dreamcast RAM addresses left in shipped data — see [`../formats/evt.md`](../formats/evt.md) |

`exception.log` is not a build artefact but is still useful: its stack dumps
contain the ASCII path `\evt\st1evtbl.bin`, which anchors the `evt` loader near
`0x413133`. See [`addresses.md`](addresses.md).
