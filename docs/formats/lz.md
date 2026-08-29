# Compression codec

**Status: UNSOLVED. This is the critical path.** 788 of 1148 `pol/`+`tex/` files are
compressed with it.

## What is known

```
+0x000   u32   uncompressed size
+0x004   ...   bitstream
```

`dword0` is greater than the file size in every case, and the decompressed result
is expected to be one of the raw layouts in [`container.md`](container.md).

Affected files:

| Directory | Compressed | Total |
|---|---|---|
| `pol/` | 463 | 656 |
| `tex/` | 325 | 492 |

## Sample streams

```
pol/zabat.bin       C0 17 00 00 | 03 20 00 FF DD FC C0 17 00 F8 FF 14 01 FA E5 FF
pol/bg_adv10.bin    C0 03 00 00 | 03 20 00 FF DD FC C0 03 00 F8 FF 14 01 FA E5 FF
pol/bg_adv00.bin    20 3C 02 00 | 03 20 00 FF DD FC C0 03 00 F8 FF 14
pol/komono_title    80 0E 00 00 | 03 40 00 FF ED FC 00 02 E4 FF 40 04
pol/komono_suimonie 00 8B 00 00 | 03 60 00 FF 77 FC 0E E4 FF A0 2D 77
pol/boss1z.bin      00 CE 02 00 | CF 20 01 00 00 FC ED 0B E5 FF 15 E4 FF 40 17 76
pol/znonoo.bin      40 CC 01 00 | CF 80 01 00 00 FC DD 0E E4 FF E0 12
tex/boss1z.bin      00 60 01 00 | 5D 00 F8 FF 14 20 08 E4 FF 65 D7 FF
```

### Observations

- **`bg_adv00` and `bg_adv10` share a near-identical opening stream** despite
  uncompressed sizes of `0x23C20` and `0x3C0` — a factor of 96 apart. Their first
  twelve stream bytes are identical. This is a strong crib: whatever the first
  several output bytes are, they are the same for both.
- The byte pair `FC` appears at stream offset 5 in several files, and `E4 FF` /
  `E5 FF` recur constantly throughout. If the format interleaves flag bytes with
  data, these are candidates for flag positions.
- Files starting `03 20 00 FF DD FC` vs `CF 20 01 00 00 FC` vs `03 40 00 FF ED FC`
  suggest the first byte is not a fixed magic.
- Floating-point exponent bytes (`3F`, `BF`, `C0`, `42`, `43`) appear scattered
  through the streams, consistent with a byte-oriented LZ over data that is
  largely `f32` vertex arrays.

### Corroboration from `pol/files.txt`

A stray build listing shipped in `pol/` records the same 327 files a year before
release. 225 of them differ in size from the shipped versions by small amounts in
**both** directions, while 102 are size-identical.

That pattern is the signature of recompression, not of content change: a codec
whose match-search effort or window parameters were tweaked between builds
produces identical output on simple inputs and small bidirectional wobble on
complex ones. Genuine asset edits would give large, mostly one-directional
differences.

It is independent evidence that these files are LZ-compressed. See
[`../re/provenance.md`](../re/provenance.md).

## Attack plan

### 2a. Static RE — primary

Follow the buffer from each loader's `ReadFile` to its consumer. The
decompressor should be a small leaf function taking `(src, dst)` with a
shift-register inner loop — distinctive in the Ghidra decompiler.

Candidate sites masking with `0xFFF` (a 4 KB sliding window) are listed in
[`../re/addresses.md`](../re/addresses.md). The cluster at
`0x41D15D` – `0x41D25D` is the strongest lead: four masks in one function, close
to the `tex` loaders at `0x41C8DA` and `0x41CDC2`.

The constant `0xFEE` does **not** appear anywhere in the binary, so this is not
stock Okumura LZSS with its classic ring-buffer initialisation.

### 2b. Unicorn function harness

Rather than running the game, lift the decompressor's bytes out of `.text` and
execute that single function in isolation under a Unicorn x86 emulator: map a
scratch stack, point the argument registers at input and output buffers, run to
`ret`, read the output.

This gives bit-for-bit correct ground truth on real inputs with no Windows, no
Wine and no game execution, and is fully deterministic. It doubles as the
differential-test oracle for the clean-room reimplementation.

Lives in `tools/emu/`.

### 2c. Cryptanalysis — validation

The constraints are unusually tight, so a wrong guess fails immediately:

- Output length must equal `dword0` **exactly**.
- Output must begin with either a `0x800` offset table
  (`00 08 00 00 | 00 08 00 00 | ...`) or an NL1 header
  (`01 00 00 00 | 01 00 00 00 | <centroid f32 × 3> <radius f32>`).
- Every NL1 mesh chain must terminate cleanly on a zero dword.
- Centroid and radius floats must be finite and physically plausible.
- The `bg_adv00` / `bg_adv10` pair must produce a common prefix.

Worth testing standard Sega-era codecs before assuming the format is bespoke:
LZSS variants with differing window and match-length encodings, PRS, and LZ11.

## Acceptance criteria

1. All 788 compressed files decompress to exactly `dword0` bytes.
2. Every decompressed `pol/` file parses as a valid container and its models
   parse as valid NL1.
3. Every decompressed `tex/` file's size is consistent with the texture
   descriptors harvested from its paired `pol/` file.
4. `tools/hod2lib/lz.py` and `src/lz.c` produce identical output on all inputs.

## Deliverables

- `tools/hod2lib/lz.py`
- `src/lz.c`
- `tools/emu/` harness
- A regression test over all 788 files

## Open questions

1. Is `dword0` the only header field, or is part of what looks like stream data
   actually a second header word?
2. How does the loader decide a file is compressed at all?
3. Are the three anomalous `pol_*` files a second encoding, or corruption? See
   [`../re/anomalies.md`](../re/anomalies.md).
