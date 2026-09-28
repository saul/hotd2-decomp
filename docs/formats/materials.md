# Materials and alpha

How PowerVR2 render state maps to a portable material, and specifically how
transparency works.

Implemented in [`tools/hod2lib/gltf.py`](../../tools/hod2lib/gltf.py). Bitfield
definitions live in [`nl1.md`](nl1.md).

## Alpha is not stored in the texture alone

Three separate pieces of state decide whether a surface is transparent, and
using the wrong one produces geometry that is silently opaque:

| State | Bits | Meaning |
|---|---|---|
| **list type** | `parameter_control` 24–26 | which hardware pass: 0 opaque, 2 translucent, 4 punch-through |
| **IgnoreTexAlpha** | `tsp_instruction` 19 | on PowerVR2, discard the texture's alpha; **on the PC port, half of the pass selector and nothing else** — see *Texture alpha on the D3D path* |
| **UseAlpha** | `tsp_instruction` 20 | let the *vertex / base colour* alpha participate |

**On the PC port the pass is the TSP pair**, `(tsp & 0x180000) != 0x80000`
(`WalkMeshChainAndDraw`, below), and `TranslatePvr2StateToD3D` never reads the
list type. Over every mesh in `pol/` the two agree for every textured mesh;
the only disagreements are five untextured list-2 meshes (`zndina` 4,
`zslman` 1) drawn in the opaque pass. `UseAlpha` alone does **not** decide
whether blending happens.

> ⚠️ Requiring `UseAlpha` before emitting a blended material marks **8,554**
> translucent meshes as opaque, which is most of the game's glass, foliage and
> smoke. The exporter's `alphaMode` is the pass: both bits.

## What the game actually uses

Measured across all 9,112 models:

| list | src blend | dst blend | IgnoreTexAlpha | meshes | meaning |
|---|---|---|---|---|---|
| 0 | one | zero | 1 | 24,180 | opaque |
| 2 | src_alpha | inv_src_alpha | 0 | 8,554 | standard alpha blend |
| 2 | src_alpha | inv_src_alpha | 0 | 5,526 | as above, `UseAlpha` also set |
| 2 | src_alpha | **one** | 0 | 1,740 | **additive** |
| 2 | src_alpha | one | 0 | 702 | additive, `UseAlpha` set |
| 2 | src_alpha | inv_src_alpha | **1** | 467 | blended; `IgnoreTexAlpha` set and ignored — the PC blends by the texture alpha |
| 2 | src_alpha | one | 1 | 262 | additive, the same |

Notes:

- **The opaque list is perfectly uniform**: `one`/`zero` with `IgnoreTexAlpha`
  set, every single time.
- **Punch-through (list 4) never occurs.** Cutouts are ordinary blending plus
  the translucent pass's alpha test at ref 1 — see *What a pass switches*.
- Every textured list-2 mesh with `IgnoreTexAlpha` also sets `UseAlpha`, so it
  is in the translucent pass on the PC, and its texture's alpha blends. (This
  table's counts include the `pol_` copies of files; see
  `tools/verify_texture_alpha.py` for the de-duplicated corpus.)
- **Additive blending is real but confined to effects.** All 2,704 additive
  meshes live in `eff_*` and boss assets — `eff_boss3`, `eff_org9`, `eff_boss5`
  and similar. Stage geometry contains none.

## Texture alpha on the D3D path — [proved]

The PC port **never drops a texture's alpha**; the pass it draws a mesh in
decides whether the alpha shows. What used to be written here — "the hardware
discards it", so the exporter wrote a fully-opaque `tex_NNN_opaque.png` for
every mesh with `IgnoreTexAlpha` set — is the PowerVR2's meaning of the bit,
and nothing on the D3D path reads it that way.

* **One surface per texture.** `BindModelTextureHandles` (`0x004AC980`)
  decodes each bank texture once, into its global slot, from the bank entry
  and its data — no mesh word is an input — so every mesh that names a
  texture samples the same surface whatever its TSP says.
* **The upload keeps the alpha.** `DecodeTextureToSurface` (`0x004AC270`)
  creates the surface with `CreateSurfaceInTextureFormat` in slot
  `g_pvr_pixfmt_texture_format[entry +0x04 & 7]` (`0x00571250` =
  `{5, 2, 6, 8, 8, 8, 7, 0}`) and copies the 16-bit texels verbatim.
  `EnumTextureFormatsCallback` (`0x004A5BC0`) fills slot 5 with the
  `7C00/03E0/001F` format **only under `DDPF_ALPHAPIXELS`** (`TEST BL, 1` at
  `0x004A5CD0`; the alpha-less one goes to slot 3, which no PVR format uses),
  so ARGB1555 is uploaded as `A1R5G5B5`. ARGB4444 goes to slot 6, the
  `0F00/00F0/000F` format, which the callback files without testing the alpha
  flag — `[likely]` `A4R4G4B4` on any DX7 device: that is the 4:4:4 format
  drivers enumerate, and the PAL4 arm writes an alpha nibble into this slot.
  `PromoteSurfaceToTexture` (`0x004A6010`) blits into a texture of the same
  pixel format.
* **The alpha op takes it.** `InitD3DDeviceAndTextureStages` sets stage 0
  once: `ALPHAOP` `MODULATE`, `ALPHAARG1` `TEXTURE`, `ALPHAARG2` `DIFFUSE`
  (and `COLOROP` `MODULATE` of `TEXTURE` and `DIFFUSE`).
  `TranslatePvr2StateToD3D`'s mode switch only swaps in `SELECTARG1` for mode
  1 — jump table `0x004A79C8` = `{0x4A792E, 0x4A790F, 0x4A792E, 0x4A792E}` —
  so a textured mesh's alpha is the texel's, alone or times the material
  alpha.
* **Nothing else reads bit 19.** A disassembly of the D3D module
  (`0x004A4DA0`–`0x004ACD20`) finds five instructions that touch the bit, all
  the `0x180000` pass pair: `TranslatePvr2StateToD3D`'s `ALPHATESTENABLE` and
  `WalkMeshChainAndDraw`'s selector. `DrawModelWithForcedAlphaBlend`'s mask
  `0x03FFFF7F` keeps it.

So, by pass:

| Draw | Blend | Alpha test | Texture alpha |
|---|---|---|---|
| opaque pass (`(tsp & 0x180000) == 0x80000`) | off | off | reaches nothing: the texel's colour is written whatever its alpha |
| translucent pass | on, TSP factors | on, ref 1 | blends and is tested |
| `DrawModelWithForcedAlphaBlend` (any `AssetDrawSlotWithAlpha`, 1.0 included) | on, `SRCALPHA`/`INVSRCALPHA` | the mesh's own pass's | blends — **also on an opaque-pass mesh** |

Measured over the corpus: 112 translucent-pass meshes set `IgnoreTexAlpha` on
an ARGB texture, and **101** of those textures have alpha below 255 — the
additive blades of `zslman` and `zndina`, `eff_boss5`'s cels, a sliver of
`boss6`, and two `st_adver03` meshes whose base alpha is 0 and which are
invisible either way. The stripped copies drew the blades' glow as solid
cards. 3,147 opaque-pass meshes sit on textures with transparent texels; the
opaque pass shows them as before, and only a faded draw would change them.

**The exporter** writes one image per bank texture with the bank's alpha;
the material's `alphaMode` is the pass, so a viewer ignores the alpha of an
opaque-pass material as the game does. **The player** reproduces pass 0's
indifference with three.js's `OPAQUE` define (compiled for a material that is
not `transparent` and has `NormalBlending`, which `draw_order.ts` gives every
opaque-pass material), and a fade flips the pass. Two things leaned on the
stripped images and changed with them: `setAssetDrawAlpha` draws an
`AssetDrawSlotWithAlpha` at 1.0 in the forced state rather than plainly, and
the blood-colour transpose reads pixels back through WebGL instead of a 2D
canvas, which is premultiplied and turned the colour under 904 opaque-pass
gore texels at alpha 0 black. `tools/verify_texture_alpha.py` holds the bytes,
the scan, the corpus counts, and a current bundle's images against the bank.

## One material per mesh — [proved]

`WalkMeshChainAndDraw` calls `SetMaterial` for **every mesh** from its own
header: diffuse `(+0x30, +0x34, +0x38, +0x2C)`, ambient that times `+0x28`
(`ModelSetMeshAmbientScale`, `0x00419380`, writes it), and a specular colour
`+0x40..+0x48` at power `1 << +0x24` when `+0x24 >= 1`. The exporter's
material cache was keyed on the part, the texture and the four words, **not
the base colour or the culling**, so a mesh with the same texture and state
as an earlier one got the earlier one's colour: about a fifth of the game's
meshes, nearly all of them with another mesh's baked lighting or base alpha.
The stage-2 car's driver's door (`char_adv04` model 4, white) drew black —
the colour of the body's inner copies in model 2, same texture 33 and TSP.
The key carries the clamped colour and `doubleSided` now, and
`verify_texture_alpha.py` holds every model primitive of a bundle to its own
mesh's colour and culling, found by the header sphere it carries.

## Pixel formats and their alpha

| Format | Alpha |
|---|---|
| RGB565 | none — always opaque |
| ARGB1555 | 1 bit, so 0 or 255 |
| ARGB4444 | 4 bits, scaled by 17 to 0–255 |

No palettised, YUV422 or bump textures occur, so those paths never run.

### Worked example — `st1_05` texture 46

64×128 ARGB4444, twiddled rectangle, on a mesh with `list=2`,
`src=src_alpha`, `dst=inv_src_alpha`, `IgnoreTexAlpha=0`.

Decoded alpha has **16 distinct values** with a soft gradient (255, 153, 221,
187, 238, 102, …) — 96.2% fully opaque with a soft edge, i.e. an
anti-aliased cutout rather than a hard mask. Exported as `alphaMode: BLEND`
with the alpha channel intact.

## Baked static lighting lives in the base colour

The per-mesh **base colour** at mesh header `+0x2C` is not decoration — it is
this game's baked static lighting.

**5,971 of 6,085** stage meshes use texture shading mode **modulate**
(`tsp_instruction` bits 6-7), where the hardware computes
`final = texture x base_colour`. Across stages 1 and 2:

| base colour (R=G=B) | meshes |
|---|---|
| 1.00 | 4,114 |
| 0.50 | 281 |
| 0.20 | 279 |
| 0.80 | 147 |
| 0.10 | 117 |
| 0.00 | 80 |
| … | … |

**32.2%** of meshes carry a value below 0.95, down to 0.00. Forcing the factor
to white — on the reasoning that "the texture already supplies the colour" —
flattens every bit of that away and makes dim corridors render as brightly as
lit rooms.

glTF multiplies `baseColorTexture` by `baseColorFactor`, which is exactly what
modulate does, so the base colour maps across directly.

Under **decal** (3 meshes) the texture replaces the colour outright, so there
the factor must stay white.

## The PowerVR2 → Direct3D 7 translation — SOLVED

`TranslatePvr2StateToD3D` (`0x004A7780`) is the function the README calls this
project's Rosetta stone. It takes the mesh's four PVR2 words and issues D3D7
state changes, skipping any whose bits are unchanged from the previous mesh.
Every mapping below is read from that function and its lookup tables; the D3D
constants are resolved against the real SDK headers.

### From `isp_tsp_instruction`

| Bits | D3D7 state | Mapping |
|---|---|---|
| 31–29 | `ZFUNC` | table `0x00598B00` |
| 26 | `ZWRITEENABLE` | **inverted** — the PVR2 bit is *disable* |

`ZFUNC` table: `NEVER, GREATEREQUAL, EQUAL, GREATER, LESSEQUAL, NOTEQUAL, LESS,
ALWAYS`.

### From `tsp_instruction`

| Bits | D3D7 state | Mapping |
|---|---|---|
| 31–29 | `SRCBLEND` | table `0x00598AB0` |
| 28–26 | `DESTBLEND` | table `0x00598AD0` |
| 23 | `FOGENABLE` | **inverted** |
| 20–19 | `ALPHATESTENABLE` | enabled unless the field is `0b01` |
| 16 / 18 | `D3DTSS_ADDRESSU` | table `0x00598AF0`, index `(clamp<<1)\|flip` |
| 15 / 17 | `D3DTSS_ADDRESSV` | same table |
| 14–13 | `MAGFILTER`, `MINFILTER` | `0` → `POINT`, anything else → `LINEAR` |
| 7–6 | `COLOROP`, `ALPHAOP` | see below |

Blend tables:

```
SRCBLEND  : ZERO, ONE, DESTCOLOR, INVDESTCOLOR, SRCALPHA, INVSRCALPHA, DESTALPHA, INVDESTALPHA
DESTBLEND : ZERO, ONE, SRCCOLOR,  INVSRCCOLOR,  SRCALPHA, INVSRCALPHA, DESTALPHA, INVDESTALPHA
```

UV address table: `WRAP, MIRROR, CLAMP, MIRROR`. **The last row matters** —
clamp *and* flip together resolves to `MIRROR`, not `CLAMP`. It is reachable:
157 mesh-axes set both on U, 90 on V.

### Texture shading is not what its name suggests

The four PVR2 shading modes collapse to:

| Mode | `COLOROP` | `ALPHAOP` | Meshes |
|---|---|---|---|
| 0 "decal" | `MODULATE` | `MODULATE` | 1,111 |
| 1 "modulate" | `MODULATE` | `SELECTARG1` | 33,429 |
| 2 "decal alpha" | `MODULATE` | `MODULATE` | 0 |
| 3 "modulate alpha" | `MODULATE` | `MODULATE` | 6,923 |

**`COLOROP` is `MODULATE` unconditionally.** The port does not implement decal
at all — the base colour multiplies the texture in every mode. Only the alpha
op varies, and only for mode 1, which takes texture alpha alone and ignores the
material alpha.

This corrects an earlier assumption here that mode 0 replaced the colour
outright; 1,111 meshes were being exported with their baked lighting flattened
to white.

### Culling

`WalkMeshChainAndDraw` sets `CULLMODE` per mesh from `parameter_control & 3`
through table `0x00598B20`:

| Value | D3D7 |
|---|---|
| 0 | `D3DCULL_NONE` |
| 1 | `D3DCULL_NONE` |
| 2 | `D3DCULL_CCW` |
| 3 | `D3DCULL_CW` |

This confirms the winding fix made empirically in Session 6 — the reversal
belongs on culling 3, not 2 — from the binary rather than from screenshots.

### Shade mode is per *strip*, not per mesh — correction

An earlier revision of this document said `parameter_control & 0x40` selects
`SHADEMODE`. It does not. `TranslatePvr2StateToD3D` never reads
`parameter_control` at all — it takes `isp_tsp_instruction`,
`tsp_instruction` and `texture_control`, and merely caches the first word.

`SHADEMODE` and `CULLMODE` are both set by `WalkMeshChainAndDraw` from the
**strip control word**:

```c
if (!(strip & 0x80)) {                       /* bit 7: reuse previous state */
    if ((strip ^ prev) & 3)
        SetRenderState(CULLMODE,  cull_table[strip & 3]);
    if ((strip ^ prev) & 0x40)
        SetRenderState(SHADEMODE, (strip & 0x40) ? 2 : 1);   /* GOURAUD : FLAT */
    prev = strip;
}
```

`strip & 8` selects triangle list (count × 3) over triangle strip. Strip flag
frequencies and the bit-7 inheritance rule are in
[`nl1.md`](nl1.md#strip-control-word--measured-over-all-278807-strips).

### Environment mapping is not implemented in this port — [proved]

263 models set `globalFlag` bit 2 ("environment mapping used") and 2,976 strips
set strip-flag bit 8 ("environment mapping"). **The PC port reads neither.**
The proof is a closed set, not an absence of evidence:

1. **Only three call sites of `SetTextureStageState` exist in the whole
   binary** — `InitD3DDeviceAndTextureStages` (`0x004A4DA0`),
   `TranslatePvr2StateToD3D` (`0x004A7780`) and `DrawSpriteQuadCommand`
   (`0x004A7AB0`). Between them they set exactly six states:

   | State | # | Set by |
   |---|---|---|
   | `COLOROP` (1) / `COLORARG1` (2) / `COLORARG2` (3) | | init, translate |
   | `ALPHAOP` (4) / `ALPHAARG1` (5) / `ALPHAARG2` (6) | | init, translate |
   | `ADDRESSU` (13) / `ADDRESSV` (14) | | translate |
   | `MAGFILTER` (16) / `MINFILTER` (17) / `MIPFILTER` (18) | | init, translate |

   **`TEXCOORDINDEX` (11) and `TEXTURETRANSFORMFLAGS` (24) are never set**, so
   they keep their D3D defaults: coordinate set 0 taken straight from the
   vertex, and no texture transform. Searching the binary for the DX7
   texgen selectors `D3DTSS_TCI_CAMERASPACENORMAL` (`0x20000`) and
   `D3DTSS_TCI_CAMERASPACEREFLECTIONVECTOR` (`0x30000`) finds no use of either.
2. **No UV is ever computed.** `WalkMeshChainAndDraw` either hands D3D a
   pointer into the model file or copies 8 dwords per vertex unmodified. The
   only arithmetic it ever performs on a UV is the mirror fold, and that is a
   fallback for devices without `D3DTADDRESS_MIRROR` (see `nl1.md`).
3. **Neither flag is read.** The walker loads `globalFlag` and tests only
   bit 4. Nothing in the program tests `0x100` against a strip control word.

Only stage 0 is ever configured; `InitD3DDeviceAndTextureStages` disables
stage 1 (`COLOROP`/`ALPHAOP` = `D3DTOP_DISABLE`) and nothing re-enables it.
So there is no second texture stage for a reflection map to live in either.

**For the exporter this is a decision, not a gap:** the faithful reproduction
of this port ignores both flags. `nl1.Strip.env_mapped` is kept so the flag
survives into `extras`, but nothing acts on it.

### The addressing table, read from the binary

`0x00598AF0` holds four `D3DTEXTUREADDRESS` values: **`1, 2, 3, 2`** =
`WRAP, MIRROR, CLAMP, MIRROR`. It is indexed per axis, and the index is
built by substitution (not by eyeballing the shifts):

| Axis | State | Index | tsp bits |
|---|---|---|---|
| V | `ADDRESSV` (14) | `(bit15 << 1) \| bit17` | 15 clamp V, 17 flip V |
| U | `ADDRESSU` (13) | `(bit16 << 1) \| bit18` | 16 clamp U, 18 flip U |

So clamp **and** flip together gives `MIRROR`, not clamp.

> ⚠️ **A clamped axis whose UVs leave `[0,1]` smears one row or column of
> texels across the whole face.** That is reachable in this data and it is what
> a "stretched face" usually turns out to be. In glTF this makes the sampler
> part of a material's identity — see *A glTF texture is (image, sampler)*
> below.

### Scene fog and the single directional light

Fog and lighting are **scene** state, not per-mesh — only the *enable* is per
mesh (TSP bit 23, inverted). Both live in the light block evt opcodes
`0x17`–`0x27` drive, and both are pushed to the device from the per-frame
scene update `UpdateSceneViewAndLight` (`0x00401F40`).

#### Fog range is doubled — [proved]

`PushSceneFogFromLightBlock` (`0x0040C320`) hands the block's `+0x30` and
`+0x34` — the near and far that tween channels 0 and 1 write — to
`SetFogRange` (`0x004ABDF0`), which **doubles both** before the device sees
them:

```
[esp+4] = near * 2 ;  [esp+8] = far * 2
if (near*2 < far*2) { FOGSTART = near*2; FOGEND = far*2; }
else                { FOGSTART = far*2;  FOGEND = near*2; }   /* swap guard */
```

So a script's `near 21, far 507` is really a **42 … 1014** ramp. Rendering
with the raw pair halves the ramp and the fog comes out roughly twice as
thick. `FOGSTART`/`FOGEND` also fix the model as `D3DFOG_LINEAR` — a straight
ramp `(end − d) / (end − start)`, not a curve.

**The swap guard is not a sanity check; it is a feature the scripts use, and
there is no on/off test anywhere in the routine.** Two consequences a reader
has to have:

* `near == far` is a **zero-width ramp**, which for a straight
  `(end − d)/(end − start)` is a step: every fragment past `FOGSTART` is 100%
  fog colour. That is how the game fades. Forty sites across the six stages
  set or tween `fog_near` and `fog_far` both to 1 against a black fog colour,
  at the head of a block or at the end of one, and every stage opens and
  closes on it.
* `near > far` is a **real band**, drawn between `far*2` and `near*2`. Stage 5
  blocks 7 and 9 set `near 1472, far 614`, which is 1228 … 2944.

A renderer that reads `far > near` as "fog is enabled" loses both. Nothing in
the engine ever disables fog from these two channels — the per-mesh
`D3DRENDERSTATE_FOGENABLE` from TSP bit 23 is the only switch there is.

#### Fog colour is an sRGB D3DCOLOR, blended in sRGB — [proved]

`PushSceneFogColour` (`0x0040D5B0`) runs every frame from the scene draw and
packs three integer globals into one word:

```c
SetFogColour((g_scene_fog_r << 8 | g_scene_fog_g) << 8 | g_scene_fog_b);
```

`SetFogColour` (`0x004ABDD0`) passes it to `D3DRENDERSTATE_FOGCOLOR` (`0x22`)
and does nothing else. `g_scene_fog_r/g/b` (`0x009A3564/68/6C`) are the integer
form of light-block channels **2, 3 and 4** — see the channel map below, which
`ApplyLightChannelOperand` states outright.

Two things follow, and they are the difference between the right colour and a
colour that is two to five times too bright:

* **Those bytes are framebuffer bytes.** A D3DCOLOR is whatever the display
  wants, which on any DX7-era target is sRGB-encoded. A renderer with a linear
  working space must convert them in, not adopt them.
* **The blend is in that same encoding.** Fixed-function fog is
  `C = f·C_pixel + (1 − f)·C_fog` evaluated on the encoded values; DX7 has no
  sRGB write path and no gamma stage to opt into. A renderer that mixes in
  linear light and encodes afterwards computes a different sum — over a dark
  surface at half fog it lands about `10/255` too bright.

#### The eleven light-block channels — [proved]

`ApplyLightChannelOperand` (`0x0040B3F0`) is the body of evt opcodes `0x20` and
`0x24`, and its `switch` on the channel index **is** the channel map. These are
dword offsets into the block at `g_scene_light_block0` (`0x009A3540`):

| ch | block | global | |
|---:|---|---|---|
| 0 | `[0x0C]` +0x30 | `g_scene_fog_near` | |
| 1 | `[0x0D]` +0x34 | `g_scene_fog_far` | |
| 2 | `[0x09]` +0x24 | `g_scene_fog_r` | |
| 3 | `[0x0A]` +0x28 | `g_scene_fog_g` | |
| 4 | `[0x0B]` +0x2C | `g_scene_fog_b` | |
| 5 | — | — | writes 2 and 3, then **falls through** into case 4 |
| 6 | `[0x90]` +0x240 | `g_scene_light_colour_r` | |
| 7 | `[0x91]` +0x244 | `g_scene_light_colour_g` | |
| 8 | `[0x92]` +0x248 | `g_scene_light_colour_b` | |
| 9 | — | — | writes 6, 7 and 8 |
| 10 | `[0x93]` +0x24C | `g_scene_light_ambient` | |

Each case also writes a parallel **tween block** (`g_light_tween_block0`,
`0x009C89E0`) at dword indices `1, 5, 9, 0xD, 0x11, 0x15, 0x19, 0x1D, 0x21` —
stride `0x10`, value at `+4`. That is **nine** slots for eleven channel
numbers, because the two aliases have none: the tween index is a *compacted*
one (`0,1,2,3,4,6,7,8,10 → 0…8`) and coincides with the channel number only up
to 4. Reading the map off that array rather than off this `switch` puts every
channel from 6 up one slot out.

#### Fog is per-pixel and planar — [proved]

`InitD3DDeviceAndTextureStages` chooses the fog stage from the device caps at
`0x004A4FE3`:

```
if (caps & D3DPRASTERCAPS_FOGTABLE)       SetRenderState(0x23 FOGTABLEMODE,  3)
else if (caps & D3DPRASTERCAPS_FOGVERTEX) SetRenderState(0x8C FOGVERTEXMODE, 3)
```

Both `3`s are `D3DFOG_LINEAR`, and table fog wins wherever it exists — so the
shipped configuration is **per-pixel table fog**.
`D3DRENDERSTATE_RANGEFOGENABLE` (`0x30`) is set **nowhere in the binary**, and
would not apply to table fog if it were: the factor comes from planar eye-space
depth, not from distance to the eye. `FOGSTART`/`FOGEND` arriving as `42…1014`
rather than a `0…1` device range is what says that depth is eye-space **W**.

The visible consequence is an artefact of the original and not a bug to fix:
the screen corners fog less than the centre at the same true distance, and the
fog on a wall shifts as the camera turns.

#### The directional light — [proved]

`SetLightingDefaultSingle` (`0x004AA120`) is short enough to give in full.
The decompiler drops every FPU argument in it — `__ftol()` with no arguments,
`unaff_EDI` — so this is from the disassembly, with the constants read out of
the image at `0x00570F5C` (255.0), `0x00565DE4` (1.4) and `0x004C4D10` (0.3):

```c
t = light_colour * ambient;                       /* [esp+0xC/0x10/0x14] */
SetRenderState(D3DRENDERSTATE_AMBIENT, 0xFF000000 | pack(t * 255));
light.diffuse  = t * 1.4;                         /* block +0x240..+0x248 */
light.specular = light.diffuse;                   /* copied dword-for-dword */
light.ambient  = light_colour * 0.3;              /* NOT scaled by ambient */
light.direction = g_render_light_dir;
SetLight(0, &light);  LightEnable(0, TRUE);
for (i = 1; i < 16; i++) LightEnable(i, FALSE);
```

**Channel 10 is a master brightness, not an ambient term.** It multiplies the
light colour into the D3D ambient render state *and* into the light's diffuse,
so lowering it dims the directional light with it; only `light.ambient`
escapes. And the render-state ambient is `colour * ambient` — **tinted**, never
a neutral grey. In the fixed-function sum the two ambients add, so with one
unattenuated light the total ambient multiplier is `colour * (ambient + 0.3)`.

An earlier version of this section had `pack_argb(ambient)` and
`light.diffuse = light_colour * 1.4`. Both were wrong, and the browser player
was built from them.

The D3DLIGHT7 at `0x007E79C0` is laid out `+0x04` diffuse, `+0x14` specular,
`+0x24` ambient, `+0x40` direction. The three `ftol` conversions truncate and
are **not** clamped, so a `colour * ambient` product above 1.0 would carry into
the next byte of the packed D3DCOLOR — `[open]` whether any shipped script does
it.

`BuildSceneLightDirection` (`0x0040E0B0`) makes the direction by rotating
`(0, 0, 1)` — `MatrixRotateY(yaw)` then `MatrixRotateX(pitch)`, both BAMS
(the rotators multiply by `9.58738e-05` = 2π/65536). Those rotators
pre-multiply and the transform is D3D's row-vector form, so pitch applies
first:

```
dir = ( cos(pitch)·sin(yaw), −sin(pitch), cos(pitch)·cos(yaw) )
```

`SetRenderLightDirection` negates it, so `dir` is the direction the light
comes **from**. Note the caller passes the **view-space** vector, not the
world one.

### The mesh fog patch

`ModelForceFogControlNone` (`0x00419300`) rewrites every mesh header of four
specific asset slots to `tsp = (tsp & 0xFFBFFFFF) | 0x00800000`, forcing fog
control (bits 22–23) to 2 = *none*. It is a per-asset content patch applied at
load, not a global rule — see [`nl1.md`](nl1.md).

### Opaque and translucent are two passes over the same chain

`RenderEnqueueCommand` calls `WalkMeshChainAndDraw(cmd, 0)` and the flush pass
calls it again with `1`. The per-mesh selector is

```c
is_translucent = (tsp_instruction & 0x180000) != 0x80000;
```

— a mesh is drawn in the opaque pass only when `IgnoreTexAlpha` (bit 19) is set
*and* `UseAlpha` (bit 20) is clear. Everything else is translucent. Meshes for
the other pass are skipped by `mesh_data_size` and contribute only their
transformed Z to the command's sort key.

### What a pass switches, and what it does not — [proved]

The **pass** decides three things; the **mesh** decides the rest, in both
passes alike.

| State | Opaque pass | Translucent pass | Set by |
|---|---|---|---|
| `ALPHABLENDENABLE` (27) | off | **on** | `RenderBeginCommandList` (`0x004A7A10`) clears it when the frame's list opens; `RenderFlushCommandList` (`0x004A88E0`) sets it before the flush |
| `ALPHATESTENABLE` (15) | off | **on**, ref 1 `GREATEREQUAL` | `TranslatePvr2StateToD3D`, `(tsp & 0x180000) != 0x80000` — the pass bits themselves |
| when it is drawn | at submission, submission order | after everything, sorted | `RenderEnqueueCommand` / `RenderFlushCommandList` |
| `ZWRITEENABLE` | ISP bit 26 | ISP bit 26 | `TranslatePvr2StateToD3D` |
| `ZFUNC` | ISP 31–29 | ISP 31–29 | `TranslatePvr2StateToD3D` |
| `SRCBLEND` / `DESTBLEND` | (ignored: blending off) | TSP 31–26 | `TranslatePvr2StateToD3D` |

Two corrections to what used to be written here and in the annotations:

* **State 0x0F is `ALPHATESTENABLE`, not `ALPHABLENDENABLE`.** The
  `TranslatePvr2StateToD3D` row in `functions.tsv` said the pass bits drive
  blending. They drive the alpha *test*; blending is `0x1B`, and it is switched
  once per pass, not per mesh.
* **Translucent meshes write depth.** Over all 82,494 meshes in `pol/`, ISP bit
  26 is clear and the compare mode is 4 (`LESSEQUAL`) — no mesh in the game
  turns the depth write off or changes the test. So the order the translucent
  pass is drawn in decides which translucent surfaces survive, and it is not a
  painter's order.

`tools/verify_draw_order.py` asserts all of it from the bytes and the corpus.

### The translucent order — [proved]

`RenderFlushCommandList` qsorts **whole commands** — one per model draw —
with `RenderCommandCompare` (`0x004A8A20`): draw layer ascending, then the
command's `+0x04` **descending**, and draws each command's translucent meshes
in chain order. See [`pipeline.md`](pipeline.md#draw-order--solved) for the
comparator. The two halves of the key:

* **`+0x04` is eye z on the matrix stack, and the stack looks down −z.**
  `RenderInitStates` installs `VIEW = diag(1, 1, −1, 1)` (`g_view_flip_z`,
  `0x00598B38`) under the left-handed projection `BuildPerspectiveProjection`
  builds (`_34 = +1`), so a point in front of the camera is negative on the
  stack. Descending is therefore **nearest first**.
* **It is the least z of the command's skipped points.**
  `RenderSubmitModelDefaultLight` seeds it with the modelview's `_43` (the
  model origin), and pass 0 lowers it to each skipped mesh's sphere-centre z
  when that is less — every translucent mesh, and every opaque one whose
  sphere is wholly outside the frustum. The least z is the farthest point.

So a command is placed by its farthest skipped point, and the command whose
farthest point is nearest draws first. With depth writes on, a nearer
translucent surface drawn first hides the translucent surfaces behind it that
come later, where its alpha passes the test; opaque geometry behind it, drawn
in pass 0, shows through the blend.

A faded draw — `AssetDrawSlotWithAlpha` (`0x004185A0`) →
`RenderSubmitModelFadedDefaultLight` (`0x004AA350`) →
`RenderEnqueueCommandFaded` (`0x004A8390`) — draws nothing in pass 0, so
every mesh is skipped and counts toward the key, and pass 1 is
`DrawModelWithForcedAlphaBlend` (`0x004A8440`): every visible mesh, with the
TSP rewritten `(tsp & 0x03FFFF7F) | 0x94000080` (`SRCALPHA`/`INVSRCALPHA`, an
alpha-modulating texture mode) and the material alpha the mesh's base alpha
times the draw's. The ISP word is not touched, so a fading model still writes
depth.

**In the player** this is `web/src/render/draw_order.ts`: every exported
material gets the table above at load, and `RenderCommandOrder` is the
renderer's transparent sort, keyed by the glTF node (split by `hod2_model`)
and each primitive's exported header sphere (`hod2_sphere`). It replaced
`GLTFLoader`'s `alphaMode: BLEND` → `depthWrite: false` and three.js's
per-primitive far-first sort, which between them drew the stage-2 car's
black inner shells over its bodywork, and turned every additive mesh in the
game — 5,408 of them — into an ordinary blend.

## The global D3D7 render state — SOLVED

`RenderInitStates` (`0x004A7630`) sets the device state once, and per-draw code
only overrides parts of it. Decoded against the real DX7 SDK headers (see
`tools/dx7_types.py`), it is:

| State | Value | Meaning |
|---|---|---|
| `ZENABLE` | 1 | `D3DZB_TRUE` |
| `ALPHATESTENABLE` | 1 | on |
| `ALPHAFUNC` | 7 | `D3DCMP_GREATEREQUAL` |
| `ALPHAREF` | 1 | so a texel with alpha 0 is discarded |
| `DITHERENABLE` | 1 | on |
| `SPECULARENABLE` | 1 | on |
| `CULLMODE` | 1 | **`D3DCULL_NONE`** |
| `SHADEMODE` | 2 | `D3DSHADE_GOURAUD` |
| `COLORVERTEX` | 0 | **off** |
| `DIFFUSE/SPECULAR/AMBIENT/EMISSIVEMATERIALSOURCE` | 0 | all `D3DMCS_MATERIAL` |
| `COLORKEYBLENDENABLE` | 0 | off |
| `TEXTUREFACTOR` | `0xFF000000` | opaque black |

Three of these matter for the export:

1. **`CULLMODE` is `D3DCULL_NONE` globally.** Backface culling is therefore not
   a device state — it comes from the per-mesh `culling` field in the NL1 data,
   exactly as [`nl1.md`](nl1.md) concluded empirically.
2. **`COLORVERTEX` is off and every material source is `D3DMCS_MATERIAL`.**
   Vertex colour does not feed the lighting equation at all; the per-mesh base
   colour must be applied as a *material*, which is what
   *Baked static lighting lives in the base colour* above found the hard way.
3. **An alpha test discards alpha-0 texels** (`GREATEREQUAL`, ref 1) — in the
   translucent pass only: `TranslatePvr2StateToD3D` turns the enable on for
   exactly the meshes whose pass bits say translucent. That is how the game
   gets punch-through behaviour without ever using the PowerVR2 punch-through
   list — which is why no mesh in the game sets it. (This said "global" until
   the per-mesh enable was read.)

**No per-draw path overrides `ALPHAFUNC`/`ALPHAREF`** — [likely]. The only
immediate pushes of state `0x18` and `0x19` in the image are here and in
`InitD3DDeviceAndTextureStages`, with the same values (the other two `PUSH
0x19` hits are a glyph routine and CRT code); `TranslatePvr2StateToD3D`,
`RenderEnqueueCommand` and `RenderFlushCommandList` are read and set neither.
The caveat is L32's: a state number held in a register would not show in an
operand search. What *is* per draw is the enable — see *What a pass switches*
above: the alpha test is on for the translucent pass only.

### Lighting

Two setups, selected by bit `0x04000000` of the draw command — see
[`pipeline.md`](pipeline.md) for how a region entry chooses between them:

- `SetLightingDefaultSingle` — ambient + **one** directional light.
- `SetLightingSceneArray` — ambient + up to **16** lights from an array of
  `D3DLIGHT7` at `0x007E7AA8`. Ghidra confirms `sizeof(D3DLIGHT7)` is **104**,
  matching the stride measured from the loop before the headers were available.

## Debugging exported materials

Two tools exist for tracing a visual problem back to source data:

```sh
# whole level with every texture replaced by a UV checkerboard
python3 tools/export_level.py --game-dir "..." --stage 2 --uv-check

# everything known about one Blender material
python3 tools/inspect_material.py --game-dir "..." --material st2_07_tex12_lambert
```

`tools/blender_whatsthis.py` pastes into Blender's Scripting tab and reports the
selected face's UV bounds, world-space area and per-axis texel density, writing
to `~/hod2_whatsthis.txt`.

**Interpreting `--uv-check`:** if a face is still wrong with a checkerboard on
it, the texture pipeline is not at fault — look at UVs, geometry or material
state instead. That single distinction eliminates most of the search space.

## glTF mapping

| PowerVR2 | glTF |
|---|---|
| opaque pass, `(tsp & 0x180000) == 0x80000` | `alphaMode: OPAQUE` |
| translucent pass, anything else | `alphaMode: BLEND` |
| `IgnoreTexAlpha` | nothing of its own: half of the pass; the image keeps the bank's alpha |
| base colour, culling | one material per distinct value (the cache key carries both) |
| clamp / flip UV | sampler `wrapS` / `wrapT` — part of the texture's identity, see below |
| filter mode 0 | `NEAREST`, else `LINEAR` |
| culling | `doubleSided` |

**Additive blending has no glTF equivalent.** It is exported as `BLEND` and
flagged `extras.pvr2.additive` so a target engine can restore it. In Blender
this needs the material's blend mode changing by hand; effects will otherwise
look slightly dark.

Every material also carries the raw register words in `extras.pvr2` —
`parameter_control`, `isp_tsp_instruction`, `tsp_instruction`,
`texture_control` — so nothing is lost to the approximate PBR mapping.

**The player does not use `alphaMode`.** It is the pass, but a glTF `BLEND`
means "no depth write" to `GLTFLoader` — the opposite of what this game
does. `web/src/render/draw_order.ts` rebuilds the pass, the
blend factors, the depth state and the alpha test from `extras.pvr2` for
every material; see *What a pass switches* above. Blender and other viewers
still get the approximation.

### A glTF texture is (image, sampler) — a fixed exporter bug

In glTF a `texture` binds one `image` to one `sampler`, and the *material*
references the texture. The exporter used to cache textures on the decoded
image alone — `(part, texture_id, opaque)`, the last from the alpha-stripped
variants it no longer writes — and then stamp the sampler onto the shared
texture as each material was written.

That is last-writer-wins. A single mesh with a clamped or mirrored axis
retroactively gave its addressing to **every** other mesh in the segment using
the same image. On stage 2, 2,176 textured materials shared 1,241 textures, and
a large fraction ended up clamped when their own TSP said wrap — smearing one
row or column of texels across whole walls. The carved marble plinths on the
canal rendered as flat grey streaks because of it.

Fixed by splitting the caches: images are still deduplicated on
`(part, texture_id)`, textures on `(image, sampler)`. Stage 2 now emits
1,754 textures over the same 1,241 images, and **2,176 / 2,176 materials carry
the addressing modes their own `tsp_instruction` demands**.

> ⚠️ **Blender's Workbench engine cannot show this correctly.** The glTF
> importer cannot express two different wrap modes on an Image Texture node, so
> it sets `extension = EXTEND` and emulates the real modes with shader math
> nodes. Workbench does not evaluate shader nodes — it reads `extension`
> directly — so under Workbench *every* material with a non-`REPEAT` axis
> renders clamped on **both** axes, producing exactly the streaks and
> solid-black faces the real bug produced. `blender_camview.py` now defaults to
> EEVEE for unlit exports for this reason. Use `--engine workbench` only for
> geometry checks.
