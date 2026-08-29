# Anomalies

Things that don't fit the model yet. Each should end up either explained or
dismissed.

## 1. The `pol_`-prefixed duplicate set

`pol/` contains 656 `.bin` files. 326 carry a `pol_` prefix and have a same-named
counterpart without it. **320 of those pairs are byte-identical** — dead weight,
presumably a build-system artefact.

Six pairs differ. Three differ only in length, which is unremarkable. **Three
have identical length but different content**, which is not:

| File | Size | `X.bin` first bytes | `pol_X.bin` first bytes |
|---|---|---|---|
| `boss2_hane_hod1` | 148295 | `C0 10 04 00 4F 40 03 00 00 FC BB A0` | `08 22 11 BE FF 07 CC A9 DF 54 BF A1` |
| `komono_suimonie` | 18479 | `00 8B 00 00 03 60 00 FF 77 FC 0E E4` | `B7 3E 9B EE 62 3F 6F 7D 1C B2 BE 82` |
| `znonoo` | 71053 | `40 CC 01 00 CF 80 01 00 00 FC DD 0E` | `15 01 F4 4E 01 F4 62 FE 01 F4 C2 3A` |

The unprefixed versions have the normal compressed-file signature: a plausible
`u32` uncompressed size followed by a bitstream. The `pol_` versions have no
recognisable header — `dword0` is not a sensible size.

Two hypotheses:

- **Corruption.** A bad copy in the original release. Most likely, given the game
  presumably loads the unprefixed names.
- **A second encoding.** Less likely, but the byte distributions do not look like
  truncation or zero-fill.

Revisit once Phase 2 lands. If the codec cannot make sense of them, they're
corrupt and can be dropped.

The other three differing pairs, for completeness:

| File | `X.bin` | `pol_X.bin` |
|---|---|---|
| `etc_1` | 270336 | 270336 (identical prefix; differs later) |
| `komono_title` | 1773 | 1587 |
| `zabat` | 4148 | 4161 |

## 1b. Resolved: the opaque `pol/` blobs

With the codec solved, exactly **6** `pol/` files fail to parse as either a
container or a compressed stream:

| File | Size | `dword0` |
|---|---|---|
| `bg_adv19.bin` | 987 | `0x00000000` |
| `komono_0.bin` | 987 | `0xC5947546` |
| `tv2.bin` | 987 | `0x37496368` |
| `pol_boss2_hane_hod1.bin` | 148295 | `0xBE112208` |
| `pol_komono_suimonie.bin` | 18479 | `0xEE9B3EB7` |
| `pol_znonoo.bin` | 71053 | `0x4EF40115` |

The last three are exactly the anomalous `pol_` twins identified in Phase 0, now
**confirmed corrupt**: their unprefixed counterparts decompress cleanly while
these do not.

The three 987-byte files are placeholders. A fourth,
`tex/scr_tod_itm_itamidome2.bin`, is also 987 bytes. All four have distinct
hashes, so they are not copies of one dummy — but all four are referenced by
name in `Hod2.exe`, so the game does try to load them. `bg_adv19.bin` has
`dword0 == 0`, which under the codec means "empty".

Best guess: cut content whose asset slots were filled with junk of a fixed size
rather than removed. Low priority.

## 2. Texture banks that sum exactly

Of 85 raw `pol`/`tex` pairs, **7** have referenced-texture sizes summing exactly
to the `tex/` file size. This is the primary evidence that the bank is a plain
concatenation in texture-ID order with no per-texture header and no padding.

The other 78 show a positive, quantized delta. Deltas are frequently multiples of
3072 (a 64×64 VQ RGB565 texture: 2048-byte codebook + 1024 index bytes) or of
1024 / 2048, which is consistent with whole unreferenced textures sitting in the
bank rather than with alignment padding.

`inventory.csv` carries the per-file numbers in `tex_referenced_bytes`,
`tex_file_bytes` and `tex_delta_bytes`.

The problem this creates: if texture *n* is unreferenced and its size is unknown,
every texture after it in the bank has an unknown offset. Phase 4 resolves this by
pooling descriptors across all `pol/` files and then solving the remainder as a
constraint problem.

## 3. `tex/` files that are not textures

Some `tex/` entries are plain Windows BMPs. `tex/segalogor_00.bin` begins `42 4D`
(`BM`), 196664 bytes, 256×256 24-bit. Presumably PC-port-specific replacements
for the boot logos.

23 `tex/` files are effectively empty — `tex/bg_adv10.bin` is 4 bytes of zero,
i.e. a valid compressed file whose uncompressed size is 0.

## 4. `evt/` pointer ranges — RESOLVED (Session 11)

**Not an anomaly.** The apparent problem was an artefact of too wide a filter.

The old reading counted every dword that looked like `0x0Cxxxxxx` and got spans
4x and 160x the file size. The loader's fixup routine (`FUN_00413120`) shows the
real test is much narrower:

```c
if ((w & 0xFFF80000) == 0x0CE80000) w += 0xF3AC1A00;
```

Only the 512 KB window `0x0CE80000..0x0CEFFFFF` is relocated. Under that mask
every in-range dword in every file resolves to a sane offset, 99.95 % of them
are dword aligned (6619 of 6622), and the whole structure walks cleanly.

The `st2evtbl` value at `0x0C0B0200` that suggested cross-file pointers is
outside the mask and is therefore ordinary payload, not a pointer.

Kept here because the lesson generalises: **a heuristic filter that is wider
than the program's own test will manufacture anomalies that do not exist.**
See [`../formats/evt.md`](../formats/evt.md).

## 5. `pol/files.txt`

A stray Shift-JIS `dir` listing from the developers' build machine
(`E:\Hod2\Image\pol`, dated 2000-05-24/25) shipped inside `pol/`. Not loaded by
the game. It is a snapshot of an earlier build, and 225 of its 327 entries differ
in size from the shipped files by small amounts in both directions — the
signature of recompression rather than content change.

Analysed in full in [`provenance.md`](provenance.md); relevant to Phase 2.

## 6. `pol/etc_1.bin` offset table

Most raw `pol/` offset tables start `800, 800, ...`. `etc_1.bin` starts
`800, 800, 1000, 1000, ...` — a much smaller first span. Either it holds many
small models, or the table has a different meaning here. Low priority; noted so
the `container.py` parser is tested against it.

## 7. `cam/op_st1.bin` corrupt offset-table entries

Six of the 75 entries in `op_st1.bin`'s path offset table are corrupt:

| Entry | Table offset | Alignment | Real descriptor |
|---|---|---|---|
| 51 | `0xA7EE` | 2 mod 4 | `0xA758` |
| 53 | `0xAFEE` | 2 mod 4 | `0xAF38` |
| 56 | `0xB9EE` | 2 mod 4 | `0xB988` |
| 67 | `0xDBEE` | 2 mod 4 | `0xDB98` |
| 69 | `0xDFEE` | 2 mod 4 | `0xDFB8` |
| 71 | `0xE5EE` | 2 mod 4 | `0xE558` |

Every one is misaligned and points into the middle of keyframe data. The
descriptors they should name do exist: a structural walk of the curve pool finds
exactly six descriptors the table never mentions, and both lists are ascending,
so the pairing is unambiguous. `hod2lib.cam` repairs them and reports each
substitution in `CamFile.repairs`.

Nothing in `Hod2.exe` marks these six as special — their slot ids (304, 306,
309, 320, 322, 324) are ordinary members of the file's contiguous run 253-327.
So the game would bind them and read garbage if anything ever selected them.
Whether anything does is unknown; no other cam file has the defect.

The deltas between corrupt and real offsets (150, 182, 102, 86, 54, 150 bytes)
are not constant, so this is not a uniform off-by-N — it looks like an exporter
bug or a partially rewritten table.
