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
