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

## 8. `trnevtbl.bin` references cam path slot 418

Five `queue_event` camera actions in `trnevtbl.bin` block 7 (offsets `0x231C`,
`0x238C`, `0x23A8`, `0x23C4`, `0x23E0`) name cam path slot **418**. The
allocated slot space is exactly 0–417: the 23 cam files tile it with no gaps,
`op_train.bin` owning the last run 406–417. 418 is one past the end.

Everything else agrees perfectly — the other 880 of 885 camera actions name a
valid slot, and every script references only its own cam file — so this is an
isolated off-by-one in the data, not a misreading of the format. What the game
does when it binds slot 418 is unknown; `0x0059C9F8 + 418 * 8` is whatever
follows the slot array.

## `cam/` — individual bytes smashed to `0xFF` in four shipped files

**[measured]** Scattered keyframe bytes in four `cam/` files read `0xFF` where
the authored value had something else. Both retail copies checked are
byte-identical here, so this is how the game ships.

The damage is per **byte**, not per word, and that matters:

* when the smashed byte is the top one, the exponent is destroyed and the float
  decodes to NaN or about 1e38 — obvious;
* when it is a mantissa byte, the result is an ordinary-looking number that no
  finiteness test will ever flag.

`cp_st1` path 1's `target_y` shows both in one curve. Seventeen consecutive
keys hold `da 2c 40 41` = 12.011. Four read `da 2c 40 ff` (NaN) and three read
`da 2c ff 41` — a perfectly plausible **31.897** that is not in the data. The
same curve's twelve-key trailing run at t = 380 holds `cc 0b b0 41` = 22.006 ten
times, `cc 0b b0 ff` once and `cc 0b ff 41` once. Twelve copies of one key,
differing in single `0xFF` bytes.

| File | non-finite | finite but smashed |
|---|---|---|
| `cp_demo.bin` | 20 | 0 |
| `cp_st1.bin` | 92 | 3 |
| `cp_title.bin` | 8 | 1 |
| `cp_st3.bin` | 0 | 3 |
| **total** | **120** | **7** |

(The finite column counts only what the conservative detector below proves.
It is a floor, not a census: a smashed mantissa byte in a curve with no
repeated value leaves no evidence at all.)

### Why this is the data and not a misreading

The obvious suspicion is that the parse is wrong and these bytes mean something
else. It is not, and the whole chain is checkable in the disassembly:

* the loader at `0x00403f89` reads the path count from the EXE table at
  `0x004C476C` and computes the curve base with `LEA ECX, [EAX + EDX*4 + 4]` —
  file pointer plus `4 + n*4`. Deriving *n* by scanning to the `0xFFFFFFFF`
  terminator instead gives the identical number for all 23 shipped files.
* the file is placed by a plain `CreateFileA` / `GetFileSize` / `ReadFile` /
  `CloseHandle` sequence into a 32-byte-aligned buffer. Nothing decodes,
  decompresses or relocates it.
* `CamBindPathSlots` (`0x00404000`) walks the offset table and the EXE slot list
  in lockstep — `*(int *)(&DAT_0059c9f8 + slot * 8) = *piVar4 + DAT_0059c9ec` —
  so path *k* is global slot `slot_list[k]`, and it touches no payload byte.
* `CamEvalPath7` resolves a channel as `curve_base + descriptor[ch] * 4`.
* `CamEvalHermiteCurve` indexes `*(float *)(param_1 + i * 8 + 2)` on a
  `ushort *` — byte `i * 16 + 4` — and reads `pfVar1[-3]`, `pfVar1[-2]`,
  `pfVar1[1]`, `pfVar1[3]`, fixing the 16-byte stride and the field order at
  `{time, value, tangent_out, tangent_in}`. There is no masking, no sentinel
  and no integer path.
* the two EXE tables are independent — the descriptor pointer comes from
  `CAM_SLOT_LIST`, the curve base from `SLOT_TO_CAM` — and they agree for all
  418 slots.
* the structural pool walk lands exactly on the end of every one of the 23
  files, with zero slack.

So the bytes the evaluator sees are the bytes on disk, and the shipped
executable evaluates these words too.

Three independent sources then say what the values should have been:

1. **The other channels of the same path.** `cp_st1` path 1's `target_y` and
   `target_z` carry the complete healthy time base
   `0 10 20 … 160 190 260 330 380 ×12`; `target_x`, the same 32-key curve, has
   that sequence with sixteen holes. Path 2's six healthy channels say
   `0 80 190 240 370 425 445 470` where `target_z` says `0 80 **510** _ 370 _
   445 _` — and 510 is `00 00 ff 43` against 190's `00 00 3e 43`.
2. **`st1evtbl` itself.** The script plays these paths with
   `cam_play 0..230` (slot 32), `0..380` (33), `0..170 / 171..359 / 360..470`
   (34) and `0..125 / 126..140` (35) — the exact durations the restored time
   columns give, from a different file authored by the same tools.
3. **Duplicate keys.** Keys sharing a time are copies of one key and must be
   byte-identical, so any member differing by a single `0xFF` byte is convicted
   by its twins.

### What the restoration does

`hod2lib.cam` trims the trailing padding, then works through the evidence in
order of strength, recording which rule answered each field in
`Curve.damage` (`Damage.how`):

| rule | evidence |
|---|---|
| `duplicate` / `constant` | a repeated key or column, differing by one `0xFF` byte |
| `sibling` | the time column, from a channel of the same path that agrees with the surviving times |
| `partner` | `tangent_out` from this key's own `tangent_in`, which carries the same low three bytes |
| `twin` | another key in the curve holds the same low three bytes with a sane top byte, and no other top byte occurs |
| `order` | the only top byte keeping the time column strictly increasing between healthy neighbours |
| `nearest` | no exact evidence — the top byte landing closest to the neighbours. A reconstruction |

Across the corpus that is **90 fields restored, 81 of them determined by the
file itself** and 9 reconstructed. `verify_phase6.py` prints the breakdown, so
no substitution is silent.

> ⚠️ **Padding is not damage.** `key_count` is always a power of two because the
> binary search runs a fixed `log2(count)` steps, so short curves are padded and
> a padding slot stores `0xFFFF0000` in its time field. Padding is always a
> *trailing* run. An earlier note recorded "103 damaged words in cp_st1", which
> was its damaged words and its 11 padding slots added together, and a second
> recorded 91 by counting only the non-finite ones.

Eight channels have no evidence left and are zero-filled and flagged in
`Path.damaged` so a consumer can badge them rather than present them as data.
`cp_st1` path 0's `eye_x` is the one that matters: all eight keys read
`ff 64 bc ff`, no other curve in any `cam/` file carries those low three bytes,
and the channel is constant so no neighbour constrains it. That camera's x is
one of ±23.5, ±94.2, ±376.8 or ±1507.2 and the file no longer says which.
