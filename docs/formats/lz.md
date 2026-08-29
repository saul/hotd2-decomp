# Compression codec

**Status: SOLVED.** Located at `0x0040ACD0` in `Hod2.exe`, reimplemented in
[`tools/hod2lib/lz.py`](../../tools/hod2lib/lz.py), and verified against every
compressed asset in the game.

## Verification

```
793 compressed files (458 pol/ + 335 tex/)
  0 failures
  60,571,242 bytes in -> 131,562,208 bytes out   (2.17x)
18,027 models parsed from the decompressed containers
```

Every file produces **exactly** the byte count its header declares. Reproduce
with:

```sh
python3 tools/verify_lz.py --game-dir "/path/to/THE HOUSE OF THE DEAD 2"
```

## Container form

```
+0x000   u32   uncompressed size
+0x004   ...   bitstream
```

Callers read the `u32` themselves and pass `src = file + 4` to the decompressor.
A size of 0 means an empty file (23 `tex/` entries are exactly this).

## Algorithm

An LZSS variant with an 8192-byte window.

Flag bits are read **LSB-first** from the *same* byte stream that carries
literal and match payload bytes. A payload byte is fetched from the current
read position even if the flag byte is only partly consumed; a fresh flag byte
is loaded only once its 8-bit budget is exhausted. Flags and data are therefore
interleaved, not separated into blocks.

```
loop:
    while flag_bit() == 1:
        emit_literal(read_u8())

    # flag bit was 0, so a match follows
    if flag_bit() == 1:
        # long form
        w = read_u16()
        if w == 0:
            return                          # end of stream
        offset = (w >> 3) - 8192            # 13 bits, always negative
        n      = w & 7
        length = n + 2      if n != 0
        length = read_u8() + 1   if n == 0
    else:
        # short form
        hi = flag_bit()
        lo = flag_bit()                     # 2-bit length, MSB first
        offset = read_u8() - 256            # 8 bits, always negative
        length = ((hi << 1) | lo) + 2

    src = out_pos + offset
    for i in range(length):
        emit(out[src + i])                  # byte at a time
```

### Notes

- **Offsets are always negative**, relative to the current output position.
  The `| 0xFFFFE000` / `| 0xFFFFFF00` sign-extension in the original makes this
  explicit.
- **Matches are copied one byte at a time**, so overlapping copies are
  intentional: an offset of `-1` is a legal run fill, which is how the codec
  encodes runs of a repeated byte.
- **Length ranges.** Short form 2–5. Long form 3–9 when `n != 0`, or 1–256 via
  the extra length byte when `n == 0`.
- **Termination** is a long-form match whose `u16` is zero. There is no length
  field in the container beyond the leading `u32`, so the end marker is
  load-bearing.
- The routine returns the number of bytes written, which callers can compare
  against the header.

## Why it took a while to find

The initial static sweep looked for a 4 KB sliding window (`& 0xFFF`) based on
the assumption of a stock LZSS. The window here is **8 KB** and the mask is
never materialised — the offset is produced by sign-extending a 13-bit field, so
no window-size constant appears in the code at all. None of the fourteen
`0xFFF` candidate sites was the decompressor.

What actually found it was following the asset loader. `LoadCommonPolTexBanks`
at `0x00418200` reads a file, takes `*buffer` as the size, and calls
`LzDecompress(buffer + 1, dst)` — twice, once for `pol/` and once for `tex/`.
The `+ 1` on a `u32*` is the header skip, and that shape identified the callee
immediately.

**Lesson recorded:** trace the data path from the loader rather than pattern
matching on constants.

## Corroboration

The `pol/files.txt` build listing predicted this. 225 of its 327 entries differ
in size from the shipped files by small amounts in both directions while 102 are
identical — the signature of recompression rather than content change. See
[`../re/provenance.md`](../re/provenance.md).

## Classification caveat

Do **not** classify files by `dword0 > filesize`. Raw texture banks routinely
begin with pixel data whose first dword exceeds the file size —
`tex/etc_boy_kao.bin` starts `0xA32992E8` and is entirely uncompressed.

Classify by trial instead, as [`container.py`](../../tools/hod2lib/container.py)
does: check for a valid container first, then attempt decompression, and only
fall back to "opaque blob" if both fail. Using the naive heuristic produced 24
false positives.

## Reference implementation

- [`tools/hod2lib/lz.py`](../../tools/hod2lib/lz.py) — Python
- `src/lz.c` — C, still to be written (Phase 7)

## Remaining questions

1. How does the *game* decide a file is compressed? `LoadCommonPolTexBanks`
   decompresses unconditionally, yet 192 `pol/` files are stored raw. Either a
   different loader handles those, or a flag lives in a `.data` table. Worth
   resolving, though it no longer blocks anything.
2. The 6 opaque `pol/` blobs — see [`../re/anomalies.md`](../re/anomalies.md).
   Four are 987-byte placeholders; three are the known-corrupt `pol_*` twins.
