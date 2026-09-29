# `tex/` texture bank

**Status: solved.** Implemented in
[`web/src/hod2lib/texbank.ts`](../../web/src/hod2lib/texbank.ts) and
[`web/src/hod2lib/exetab.ts`](../../web/src/hod2lib/exetab.ts). All 303 banks
with a descriptor table resolve **exactly**: every texture lands inside the file
and the last one ends precisely at the file size.

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

## The screen banks: PAL4, with the palettes in the exe

The table above is the **models'**. The 2D screen banks are different:
`tex/scr_common.bin` (bank `0x147`), which holds the in-play HUD -- bullets,
life lamps, RELOAD, the digits -- is **PAL4**, layout `0x500`. Whether every screen bank is, is `[open]`.
`[proved]` from
`DecodeTextureToSurface` (`0x004AC270`):

* the pixels are 4-bit indices, two to a byte, low nibble first, in the
  twiddled (Morton) order -- cut into `h`-wide square blocks along x once
  `x >= h` for a texture wider than tall `[likely]`: which loop bound is the
  height is read off Ghidra's stack locals;
* the palette is 16 ARGB1555 entries in `.rdata` (`0x004ECB8C..`), listed by
  `g_texture_palette_table` (`0x0057A010`), whatever the texture's own pixel
  format; the entries are converted to the surface format (1555, 565 or 4444
  by the descriptor's format, the table at `0x00571250`);
* **which** palette is the bank's choice: `TexBankPaletteIndex`
  (`0x0041C9E0`) switches on the bank, and for `scr_common` reads the s16 per
  texture at `g_scr_common_palette_index` (`0x0057A524`).

A screen sprite is named by id, not by texture: `DrawScreenSprite`
(`0x0041C6D0`) looks the id up in `g_screen_sprite_bank` (`0x0057A5BC`) for
the bank and `g_screen_sprite_tex_slot` (`0x0057D448`) for the global texture
slot (the descriptor's `+0x0C`). And `DrawSpriteQuadCommand` (`0x004A7AB0`)
puts texture row 0 at the **bottom** of the quad, so every screen texture is
stored upside down relative to the picture it shows.

The exporter (`hod2lib/texbank.ts`, `exetab.ts`, and `bundle.ts`'s
`screenSpritesJson`) decodes the ids the game draws -- the HUD's, which
`web/src/game/hud_sprites.ts` lists, the game-over logo's `0x43A..0x43D`
(`scr_gameover.bin`, direct colour) and the route map's 300 tiles from
`g_route_map_tiles` (`scr_bunki.bin`, direct colour) -- flips them, and writes
them into `script.json` as `screen_sprites` (format 12; `hud_sprites` before):
`{w, h, png}` by sprite id.

The continue screen's are in `scr_common` too, PAL4 like the HUD's, and
`hud_sprites.ts`'s `CONTINUE_SCREEN_SPRITES` lists them. Each was decoded and
looked at before it was named `[proved]`:

| id | size | shows | drawn by |
|---|---|---|---|
| `0x22C` | 512x64 | CONTINUE? | `RunPhaseContinueCountdown`, `HudDrawContinuePrompt` |
| `0x4F..0x58` | 64x128 | the countdown's `0`..`9` | the same two, `0x4F + digit` |
| `0x22E` | 128x32 | CREDIT(S) | `CreditPromptDrawCount` |
| `0x332` | 128x32 | FREE PLAY | `CreditPromptDrawCount` |
| `0x43E` | 512x64 | GAME OVER (the small one, in play) | `HudDrawPlayerGameOver` |
| `0x5BB` | 256x32 | INSERT COIN(S) | `CreditPromptDrawMessage` |
| `0x5BC` | 256x32 | INSERT MORE COIN(S) | `CreditPromptDrawMessage` |
| `0x8FF` | 128x16 | PRESS START BUTTON | `CreditPromptDrawMessage`, at 1.4 |
| `0x900` | 512x32 | PRESS START BUTTON (attract) | `CreditBlinkTick` |

The credit count's digits are the HUD's `0x59 + d`, 16x32, at the credit
line's 0.85. `web/tools/checks/continue_screen.ts` checks each id resolves at
that size.

## Two banks that overwrite a third: the blood colour

`tex/scr_blood_red.bin` and `tex/scr_blood_green.bin` hold **39 textures each,
at the same global slot ids** — 159, 160, 161 … — and `tex/common.bin` holds
those ids too. They are not three sets of art; they are one set and two
palettes, and the third is a copy of one of them.

**[measured]** Slot 159 decodes to the same 64x64 shape in all three, with only
the channel moved: `common` and `scr_blood_green` are alpha-weighted
`(0, 119, 0)`, and `scr_blood_red` is `(119, 0, 0)`.

So the shipped default in `common.bin` is **green**, and the red bank carries
the same slots in red. The options screen has a **Blood Color** row -- the
string is at `0x005971C4`, beside `"  Red"` and `"Green"` at `0x0056974C` and
`0x00569752` -- but in this build the row is never shown and its setting
(`0x009C9F22`) is read by nothing but the screen's own copy
(`docs/re/options-screen.md`); what loads the red bank, if anything, is
`[open]`. The two filenames are ordinary entries in the `tex/` name table at
`0x004D1410`. (This said the option loaded the red bank, until the options
screen was read.)

`G_ENABLE` in `Hod2.ini` is **not** this. `FUN_0049E4A0` reads it out of
`[Flush Setting]` alongside `FLUSH_POWER`, `FLUSH_FRAME` and `SCREEN_LIGHT`, so
it is the screen-flash setting and nothing to do with the blood.

Consequence for anything that binds a bank by the owning `pol/` file: the blood
flipbook is `pol/common.bin` slots `0x3A..0x52`, so binding `tex/common.bin`
gives green. Red needs the override bank bound over it, which is a decision
about which option to reproduce rather than a fact about the format.

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
