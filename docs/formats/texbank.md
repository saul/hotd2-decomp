# `tex/` texture bank

**Status:** layout hypothesis strongly supported by evidence; gap resolution is
Phase 4.

## The key property: headerless

`tex/` files contain **no `PVRT` header and no `GBIX` chunk**. There is no
per-texture header at all, and no width, height or pixel format stored anywhere
in the file.

All of that metadata lives in the **model** that references the texture — in the
`tsp_instruction` and `texture_control` words of each mesh header. See
[`nl1.md`](nl1.md).

This is a direct consequence of the game being a Dreamcast port: on hardware,
these bytes were DMA'd straight into PowerVR texture memory and the format was
supplied by the register words at draw time. The PC port keeps the same
arrangement.

## Layout

A bank is the raw texture payloads **concatenated in texture-ID order**, with no
header, no padding and no alignment between entries.

```
offset(0)   = 0
offset(n+1) = offset(n) + size(n)
```

`pol/NAME.bin` and `tex/NAME.bin` are a matched pair; a mesh's `texture ID` at
mesh header `+0x20` is the index into that bank.

## Computing a texture's size

From the referencing mesh:

```
u = 8 << ((tsp_instruction >> 3) & 7)        # width
v = 8 << ( tsp_instruction       & 7)        # height
pixfmt = (texture_control >> 27) & 7
vq     = (texture_control >> 30) & 1
mip    = (texture_control >> 31) & 1
```

| `pixfmt` | Format | Bits/px |
|---|---|---|
| 0 | ARGB1555 | 16 |
| 1 | RGB565 | 16 |
| 2 | ARGB4444 | 16 |
| 3 | YUV422 | 16 |
| 4 | bump (S/R pair) | 16 |
| 5 | PAL4 | 4 |
| 6 | PAL8 | 8 |

Size:

```
if vq:  size = 2048 + (u * v) / 4        # 256-entry codebook, 1 index byte per 2x2 block
else:   size = u * v * bpp / 8
```

Mipmapped textures add the mip chain; no mipmapped textures have been observed in
HOD2 yet, so this is untested.

## Evidence for the layout

Across 85 raw `pol`/`tex` pairs, referenced-texture sizes were summed and
compared against the actual `tex/` file size.

- **7 pairs match exactly.** With no header, no padding and no alignment, an
  exact match across seven independent files is not coincidence.
- The other 78 show a **positive, quantized** delta — never negative, which rules
  out overlap, and frequently a multiple of 3072 (a 64×64 VQ RGB565 texture) or
  of 1024 / 2048.

Positive quantized deltas are what you get when the bank contains whole textures
that the paired `pol/` file happens not to reference. Per-file figures are in
`inventory.csv`.

## Worked example — `tex/st2_01.bin`

`pol/st2_01.bin` references 28 textures, IDs 0–27:

| ID | Size | Format | Bank bytes |
|---|---|---|---|
| 0 | 128×128 | ARGB4444, VQ | 6144 |
| 1 | 128×128 | RGB565, VQ | 6144 |
| 2 | 32×32 | RGB565, VQ | 2304 |
| … | | | |
| 20 | 128×256 | RGB565 | 65536 |
| 21 | 64×512 | RGB565 | 65536 |
| 27 | 64×128 | RGB565 | 16384 |

Referenced total: 241408 bytes. Actual file: 329728 bytes. Delta: 88320 —
unreferenced textures elsewhere in the bank.

## The gap problem

If texture *n* is unreferenced and its size is unknown, then every texture after
it has an unknown offset. This is the central difficulty of Phase 4.

Resolution strategy, in order:

1. **Pool descriptors globally.** Scan every `pol/` file, not just the paired
   one. Other models may reference the missing IDs.
2. **Use the `.data` count tables.** The tables adjacent to the `tex/` filename
   table at `0x4D1410` very likely hold per-bank texture counts. See
   [`../re/addresses.md`](../re/addresses.md).
3. **Solve the remainder.** Offsets form a strict prefix sum, each unknown slot
   must be a legal Dreamcast texture size (a small finite set), and the total
   must equal the file size. That is usually enough to pin the layout uniquely.
4. **Confirm against the binary.** The texture upload path — reachable via the
   `Texture Skipped.` string — computes exactly these offsets.

## Decoding

Once located, payloads are standard Dreamcast PowerVR2 textures:

- **Twiddled** unless `texture_control` bit 26 is set (Morton-order swizzle).
- **VQ**: a 2048-byte codebook of 256 entries first, each entry four 16-bit
  pixels forming a 2×2 block. Then one index byte per block,
  `(u × v) / 4` bytes. Indices are themselves twiddled at half resolution.
  Block expansion is column-major: codebook entries map to
  `(2y, 2x)`, `(2y+1, 2x)`, `(2y, 2x+1)`, `(2y+1, 2x+1)`.
- **SmallVQ** uses a reduced codebook sized by texture width.

The `bl_pypvr.py` decoder from the `blender-NaomiLib` project implements all of
this and is the reference; the only missing piece is the `PVRT` header, which we
synthesize from the model's register words.

## Non-texture entries

Some `tex/` files are not PowerVR data at all:

- **Windows BMP.** `tex/segalogor_00.bin` begins `42 4D` (`BM`), 196664 bytes,
  256×256 24-bit. Likely PC-port-specific boot logos. Detect by magic and pass
  through.
- **Empty.** 23 files are effectively empty; `tex/bg_adv10.bin` is four zero
  bytes — a valid compressed file with an uncompressed size of 0.

## Open questions

1. How are unreferenced slots sized? (the gap problem above)
2. Do mipmapped textures occur anywhere in the game?
3. Where do palettes live for PAL4/PAL8 textures? Nothing resembling a palette
   block has been located yet. The mesh header's offset-colour-alpha word carries
   a palette *index*, which implies a palette bank exists somewhere.
4. Do the 29 `tex/` files with a `0x800` offset table use it to index textures
   directly, making them self-describing? If so they are the ideal validation set.
