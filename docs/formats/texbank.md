# `tex/` texture bank

**Status: solved.** Implemented in
[`tools/hod2lib/texbank.py`](../../tools/hod2lib/texbank.py) and
[`tools/hod2lib/exetab.py`](../../tools/hod2lib/exetab.py). All 303 banks with a
descriptor table resolve **exactly**: every texture lands inside the file and
the last one ends precisely at the file size.

## The key fact: metadata lives in the executable

A `tex/` file is raw PowerVR2 texture payloads with **no header of any kind** —
no `PVRT`, no `GBIX`, no offset table, no per-texture header.

The layout of each bank is a table **compiled into `Hod2.exe`**:

```c
descriptor_table = *(u32 *)(0x0055B9B8 + bank_index * 4);
descriptor       = descriptor_table + texture_id * 16;
```

`bank_index` is the same index used for the `tex/` filename table at
`0x004D1410`, so bank name and descriptor table are trivially correlated.

Recovered from `FUN_00418E40` (bank setup) and `FUN_004AC980` (per-model texture
binding); the decoder at `FUN_004AC270` confirms every field.

### Descriptor — 16 bytes

| Offset | Type | Field |
|---|---|---|
| `+0x00` | `u16` | width (**real pixels**) |
| `+0x02` | `u16` | height (**real pixels**) |
| `+0x04` | `u8` | pixel format — 0 ARGB1555, 1 RGB565, 2 ARGB4444 |
| `+0x05` | `u8` | data layout — PVR code: 1 twiddled, 3 VQ, 9 rectangle/linear, 13 twiddled rectangle |
| `+0x06` | `u16` | reserved (always 0 observed) |
| `+0x08` | `u32` | **byte offset into the bank** |
| `+0x0C` | `u32` | global texture slot id |

A row of all zeros terminates the table.

## Why the obvious approach fails

The natural guess — textures concatenated in ID order, offsets as a prefix sum
of computed sizes — is wrong, for two independent reasons. Both were found the
hard way, and both are invisible until you decode an actual image.

### 1. Sizes are padded to 2048-byte boundaries

A 64×64 VQ texture needs `2048 + (64*64)/4 = 3072` bytes but occupies **4096**.
A 32×8 texture needs 512 bytes and occupies **2048**. Sizes that already land on
a 2048 boundary (128×128 VQ = 6144, 128×256 RGB565 = 65536) are unpadded, which
is why a prefix sum appears to work for some banks and silently drifts in
others.

### 2. For VQ, the model's TSP size field is *half* the real size

The `TSP_instruction` U/V size bits describe the **index array**, not the image.
Each VQ index covers a 2×2 pixel block, so real dimensions are `2x` the TSP
field.

This is unambiguous in the data: for `st2_01`, textures 20–27 (non-VQ) matched
the model-derived dimensions exactly, while textures 0–19 (all VQ) were every
one of them exactly 2× off.

Consequence: **all 115 banks whose prefix sum landed exactly were non-VQ, and
every VQ-containing bank was wrong.** That correlation is what exposed the bug.

Because both corrections are needed simultaneously, and padding depends on the
corrected size, reading the exe table is far more reliable than reproducing the
rules. Use `exetab`; the size formula in `TexDesc.size` exists only for the 23
assets with no table.

## Decoding

Once located, payloads are standard PowerVR2:

- **Twiddled** (layouts 1 and 13) — Morton order. Non-square textures are a run
  of square blocks of side `min(w, h)` along the longer axis.
- **Rectangle** (layout 9) — linear, no swizzle.
- **VQ** (layout 3) — a 2048-byte codebook of 256 entries, each four 16-bit
  pixels forming a 2×2 block, followed by one index byte per block at `+0x800`.
  Indices are themselves twiddled at half resolution. Block expansion is
  column-major.

`FUN_004AC270` confirms the codebook size and the `+0x800` index base directly.

## What the game actually uses

Measured across all 9,112 models — much narrower than the hardware allows:

| | |
|---|---|
| pixel formats | RGB565, ARGB4444, ARGB1555 only |
| palettised (PAL4/PAL8) | **none** — so no palette data exists anywhere |
| bump / YUV422 | **none** |
| mipmaps | **none** |
| layouts | twiddled, twiddled-rectangle, rectangle, VQ |

The open question from Phase 0 about where palettes live is therefore answered:
there are none.

## Non-texture entries

- **Windows BMP.** 47 `tex/` files start `42 4D`; `tex/segalogor_00.bin` is
  256×256 24-bit. PC-port boot logos. Detect by magic and pass through.
- **Empty.** 23 files are a 4-byte zero header — a valid compressed file whose
  uncompressed size is 0.
- **23 `pol/` assets have no descriptor table** in the exe and fall back to the
  computed-size path.

## Open questions

1. What are the trailing bytes in banks where the descriptor table stops short
   of the file size? Probably textures for models in other `pol/` files loaded
   alongside.
2. What is the global texture slot id at `+0x0C` used for? It looks like an
   index into a program-wide texture handle array, and values are not
   contiguous per bank.
