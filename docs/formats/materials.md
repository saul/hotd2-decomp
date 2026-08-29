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
| **IgnoreTexAlpha** | `tsp_instruction` 19 | discard the texture's alpha channel |
| **UseAlpha** | `tsp_instruction` 20 | let the *vertex / base colour* alpha participate |

**Blending is selected by the list type.** `UseAlpha` does **not** control
whether blending happens — it controls whether the polygon's own colour alpha
takes part.

> ⚠️ Requiring `UseAlpha` before emitting a blended material marks **8,554**
> translucent meshes as opaque, which is most of the game's glass, foliage and
> smoke. Drive `alphaMode` from the list type alone.

## What the game actually uses

Measured across all 9,112 models:

| list | src blend | dst blend | IgnoreTexAlpha | meshes | meaning |
|---|---|---|---|---|---|
| 0 | one | zero | 1 | 24,180 | opaque |
| 2 | src_alpha | inv_src_alpha | 0 | 8,554 | standard alpha blend |
| 2 | src_alpha | inv_src_alpha | 0 | 5,526 | as above, `UseAlpha` also set |
| 2 | src_alpha | **one** | 0 | 1,740 | **additive** |
| 2 | src_alpha | one | 0 | 702 | additive, `UseAlpha` set |
| 2 | src_alpha | inv_src_alpha | **1** | 467 | blended, texture alpha discarded |
| 2 | src_alpha | one | 1 | 262 | additive, texture alpha discarded |

Notes:

- **The opaque list is perfectly uniform**: `one`/`zero` with `IgnoreTexAlpha`
  set, every single time.
- **Punch-through (list 4) never occurs.** There is no alpha testing in this
  game; cutouts are done with ordinary blending.
- **Additive blending is real but confined to effects.** All 2,704 additive
  meshes live in `eff_*` and boss assets — `eff_boss3`, `eff_org9`, `eff_boss5`
  and similar. Stage geometry contains none.

## Textures that carry alpha the game throws away

2,126 meshes use an **ARGB4444 texture on an opaque mesh** with
`IgnoreTexAlpha` set, plus a further 1,698 ARGB1555. The stored alpha is real
but the hardware discards it.

Exporting that alpha as-is punches holes in solid geometry. The exporter
therefore emits a **separate fully-opaque image variant** (`tex_NNN_opaque.png`)
whenever `IgnoreTexAlpha` is set, and keys the texture cache on
`(part, texture_id, strip_alpha)` so a texture used both ways yields both
variants.

In stage 1 that is 576 of 822 exported images.

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

`parameter_control & 0x40` selects `SHADEMODE`: clear → `D3DSHADE_FLAT`,
set → `D3DSHADE_GOURAUD`. `& 8` selects triangle list (count × 3) over strip.

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
3. **A global alpha test discards alpha-0 texels** (`GREATEREQUAL`, ref 1).
   That is how the game gets punch-through behaviour without ever using the
   PowerVR2 punch-through list — which is why no mesh in the game sets it.

**[open]** Whether any per-draw path overrides `ALPHAFUNC`/`ALPHAREF` has not
been checked; `RenderEnqueueCommand`'s per-command state work is not yet read.

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
| list 0 (opaque) | `alphaMode: OPAQUE` |
| list 2/3 (translucent) | `alphaMode: BLEND` |
| list 4 (punch-through) | `alphaMode: MASK`, cutoff 0.5 (unused in practice) |
| `IgnoreTexAlpha` | opaque image variant |
| clamp / flip UV | sampler `wrapS` / `wrapT` |
| filter mode 0 | `NEAREST`, else `LINEAR` |
| culling | `doubleSided` |

**Additive blending has no glTF equivalent.** It is exported as `BLEND` and
flagged `extras.pvr2.additive` so a target engine can restore it. In Blender
this needs the material's blend mode changing by hand; effects will otherwise
look slightly dark.

Every material also carries the raw register words in `extras.pvr2` —
`parameter_control`, `isp_tsp_instruction`, `tsp_instruction`,
`texture_control` — so nothing is lost to the approximate PBR mapping.
