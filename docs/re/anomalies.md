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

## 4. `evt/` pointer ranges

`evt/*.bin` are Dreamcast RAM images with absolute `0x0Cxxxxxx` SH-4 pointers
still baked in. But the pointer span does not fit the file:

| File | Size | Pointer range | Span |
|---|---|---|---|
| `st1evtbl.bin` | 27722 | `0x0CEB5834` – `0x0CED0918` | 110820 |
| `st2evtbl.bin` | 92472 | `0x0C0B0200` – `0x0CEDBC28` | 14858792 |
| `comevtbl.bin` | 296 | `0x0CEB58F0` – `0x0CEB5A00` | 272 |

`comevtbl` fits neatly. The other two do not — spans are 4× and 160× the file
size. So either:

- the pointers target *other* loaded structures (models, motion data) and not
  just the event table itself, which the `st2evtbl` range starting at
  `0x0C0B0200` strongly suggests; or
- only a subset of the `0x0Cxxxxxx`-looking dwords are genuine pointers and the
  rest are float or integer payload that happens to land in that range.

Roughly 8% of all dwords fall in the Dreamcast RAM window, which is far too many
to all be pointers in a table this dense. Distinguishing real pointers from
coincidence requires the loader's fixup routine — hence Phase 6, and why `evt` is
the highest-risk format.

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
