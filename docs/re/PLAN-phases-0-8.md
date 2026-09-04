# HOTD2 (PC) — Reverse-Engineering & Asset Pipeline Plan

**Scope:** RE the asset + render pipeline.
**Export target:** engine-neutral glTF 2.0 + JSON sidecars.
**Method:** fully static — the game is never executed.

---

## Findings that motivate this plan

Established during initial investigation. Everything below is verified against
the actual files unless explicitly marked as a hypothesis.

### Binary

- `Hod2.exe`: PE32 i386, **MSVC 6.0**, linked **2001-05-09**, imagebase `0x400000`,
  `.text` = `0xC2520` (~795 KB, ~16.5k call sites), `.data` vsize `0x457000`
  (large BSS — emulated VRAM / framebuffers). The CRT is statically linked, so
  FLIRT signatures will strip a large fraction of it.
- Renderer is **Direct3D 7**, obtained by `QueryInterface` from
  `DirectDrawCreateEx`, built on the DX7 SDK **`d3du`/D3DX utility library**.
  Confirmed by the presence of `IID_IDirect3D7`, `IID_IDirect3DHALDevice`,
  `IID_IDirect3DTnLHalDevice`, `IID_IDirect3DRGBDevice` and the stock
  `CD3duContext` / `CD3duGlobals` / `CHelInfo` diagnostic strings.
- Input is DirectInput 7 plus `SEGAJOY.VXD`; audio is DirectSound.
- The port keeps native PowerVR2 data and converts it at runtime. That conversion
  code is the authoritative source for material semantics.

### Asset loading

All six asset directories are loaded through the same shape:

```
sprintf(path, "<dir>\\%s", name);
h = CreateFileA(path, GENERIC_READ, FILE_SHARE_READ, NULL, OPEN_EXISTING, 0x80, NULL);
size = GetFileSize(h, NULL);
buf  = alloc(size + 0x20);          /* 0x4A7400, result aligned up to 32 */
ReadFile(h, buf, size, &read, NULL);
```

Some loaders (e.g. `cam`) split this across two functions — open + allocate in
one, `ReadFile` in another — i.e. deferred/streamed loading.

### Directory inventory

| Dir | Files | Format |
|---|---|---|
| `pol/` | 656 `.bin` | 192 raw-table + 1 raw-blob + 463 compressed. 326 are `pol_`-prefixed duplicates (320 byte-identical, 6 differing). Plus a stray `files.txt` |
| `tex/` | 492 | 29 raw-table + 68 raw-blob + 325 compressed + 47 Windows BMP + 23 empty |
| `mot/` | 51 | `u32` offset table + animation blocks |
| `cam/` | 24 | `u32` offset table (monotonic) + camera path blocks |
| `coli/` | 9 | count-prefixed float record arrays |
| `evt/` | 13 | **Dreamcast RAM images with baked absolute `0x0Cxxxxxx` SH-4 pointers** |
| `sound/` | — | plain `.wav`, directly usable |

### `pol/` container — solved

2048-byte (`0x800`) `u32` offset table, then payload. Entries are start/end
pairs. `pol/st2_02.bin`: `800, 800, 26800, 26800, 34000, 34000, 3E000` → three
models spanning `800→26800`, `26800→34000`, `34000→3E000`.

Each model is a **NaomiLib NL1** object (`objFormat = 1`, Super Index).
`pol/st2_01.bin` parses cleanly: 12 meshes, valid centroids and radii, texture
IDs 0–27, mesh chain terminating correctly on a zero dword.

### `tex/` container — solved in principle

Headerless: **no `PVRT`, no `GBIX`**. The file is the raw texture payloads
**concatenated in texture-ID order**, no per-texture header and no padding.

Texture metadata lives in the *model*, not the texture file:

- Dimensions from `TSP_instruction` — bits 0–2 V size, bits 3–5 U size, both
  `8 << n`.
- Pixel format, VQ, mipmap and scan order from `texture_control` — bit 26 scan
  order, bits 27–29 pixel format, bit 30 VQ, bit 31 mipmap.

Verified: for **7 of 85** raw `pol`/`tex` pairs the computed sizes sum *exactly*
to the file size. The remaining pairs show a positive, quantized delta,
consistent with the bank containing textures that particular `pol` file does not
reference. Resolving those gaps is Phase 4.

### Compression — SOLVED (Session 3)

Found at `0x0040ACD0`. LZSS, 8 KB window, LSB-first flag bits interleaved with
payload bytes. Verified against all 793 compressed files with zero failures.
Full spec in [`../formats/lz.md`](../formats/lz.md).

Historical note on the original framing, kept because the lesson generalises:

463 `pol/` + 325 `tex/` files use an unidentified codec. Header is a `u32`
uncompressed size followed by a bitstream:

```
pol/zabat.bin    C0 17 00 00 | 03 20 00 FF DD FC C0 17 00 F8 FF 14 ...
pol/bg_adv10.bin C0 03 00 00 | 03 20 00 FF DD FC C0 03 00 F8 FF 14 ...
pol/bg_adv00.bin 20 3C 02 00 | 03 20 00 FF DD FC C0 03 00 F8 FF 14 ...
```

`bg_adv00` and `bg_adv10` share a near-identical opening stream at very different
output sizes — a natural crib.

---

## Phase 0 — Baseline

1. `manifest.csv` — SHA-256 + size for every input file including both EXEs, so
   any tool change can be diffed against a fixed input set.
2. `inventory.csv` — per `pol/`+`tex/` file: classification, `dword0`,
   offset-table entries, model count, and for raw pairs the referenced-texture
   size sum vs actual file size (the delta Phase 4 must explain).
3. Prune the 326 `pol_` duplicates from consideration but keep the 3 anomalies
   flagged — same size, different bytes, possibly a different encoding rather
   than corruption. Worth revisiting once the codec is known.

**Status: complete.**

---

## Phase 1 — Ghidra environment

1. Import `Hod2.exe` (PE32, base `0x400000`).
2. **Noise removal first** — this is what makes 795 KB of `.text` tractable:
   - MSVC 6.0 FLIRT / Function ID signatures → removes the static CRT.
   - The `d3du`/D3DX utility classes are verbatim DX7 SDK sample code; their
     error strings are present in the binary, so they self-label and can be
     excised wholesale.
3. Import DX7 SDK headers (`ddraw.h`, `d3d.h`, `d3dtypes.h`, `dinput.h`,
   `dsound.h`) as a GDT so COM vtable dispatch resolves to named methods.
4. Seed the known anchors from `docs/re/addresses.md`.
5. Map the `.data` tables adjacent to the filename tables — these very likely
   hold per-bank texture counts, which Phase 4 needs.

---

## Phase 2 — The compression codec ⚠️ critical path

Gates 788 of 1148 `pol/`+`tex/` files. Static-only, so three converging attacks:

### 2a. Static RE (primary)

Follow the buffer from each loader's `ReadFile` to its consumer. Candidate 4 KB
sliding-window sites are listed in `docs/re/addresses.md`. The decompressor
should be a small leaf function taking `(src, dst)` with a shift-register inner
loop — visually distinctive in the Ghidra decompiler.

### 2b. Unicorn Engine function harness

The static-friendly substitute for a debugger. Rather than running the game,
lift the decompressor's bytes out of `.text` and execute **that single function
in isolation** under a Unicorn x86 emulator: map a scratch stack, point the
argument registers at buffers, run to `ret`, read the output.

This yields the same ground truth a runtime hook would — bit-for-bit correct
output on real inputs — with no Windows, no Wine, no game execution, and full
determinism. It also serves as the differential-test oracle for the clean-room
reimplementation.

Lives in `tools/emu/`.

### 2c. Cryptanalysis (validation and cross-check)

The constraints are unusually tight, so a wrong codec fails immediately:

- Output length must equal `dword0` exactly.
- Output must parse as a valid `0x800` offset table or an NL1 header
  (`01 00 00 00 | 01 00 00 00`).
- Every mesh chain must terminate cleanly on a zero dword.
- The `bg_adv00` / `bg_adv10` near-duplicate pair provides a crib.

**Deliverables:** `tools/hod2lib/lz.py` + `src/lz.c`, plus a test asserting all
788 compressed files decompress to exactly `dword0` bytes and re-parse without
error.

---

## Phase 3 — `hod2lib` core

- **`container.py`** — `0x800` offset table, transparent decompression,
  start/end pair resolution.
- **`nl1.py`** — independent NaomiLib NL1 parser written from the spec.
  Deliberately corrects four defects observed in the reference Blender addon
  (see `docs/formats/nl1.md` for detail):
  1. Mesh-0 end offset is `hdr + 0x50 + size`, not `size + 0x64`.
  2. `texture_control` address mask is `0x1FFFFFF`, not `& 23`.
  3. Bump (`shading == -2`) vertices are 56 bytes, not 32.
  4. Packed s8 normal byte order is ambiguous between the addon's reader and
     writer — settle empirically against HOD2 data and document the answer.

  Also: mask bit 0 out of vertex `x`, vertex `v` and `tex_ambient` — those are
  flags, not float data, and produce denormals if read naively.
- **Cross-validation harness** — parse every model with `hod2lib` and with the
  Blender addon; assert identical vertex/triangle counts, centroids and radii.
  Any divergence is a bug in one of them and gets documented.

---

## Phase 4 — Textures

1. **Global descriptor map.** Scan all `pol/` files, harvesting
   `(bank, texID) → (u, v, pixfmt, vq, mip, twiddled)` from each mesh's TSP and
   texture-control words.
2. **Resolve gaps.** For banks where referenced sizes do not sum to the file
   size, solve the layout as a constraint problem: offsets form a strict prefix
   sum, every slot must be a legal Dreamcast texture size, and the total must
   equal the file size. Cross-check against the `.data` count tables from
   Phase 1.
3. **Decode.** Use the `bl_pypvr.py` decoder as the reference for twiddling, VQ
   (2048-byte 256-entry codebook first, one index byte per 2×2 block, indices
   twiddled at half resolution, block expansion column-major), SmallVQ, and all
   pixel formats. Synthesize the `PVRT` header HOD2 omits.
4. **Handle outliers.** Some `tex/` entries are plain Windows BMPs; 23 are
   empty. Detect and pass through.
5. **Emit both** `TexID_%03d.PVR` — so the existing Blender addon works
   unmodified — and PNG for the glTF path.
6. **Oracle.** The RE'd D3D7 texture-upload path from Phase 5 performs exactly
   this decode; use it to confirm rather than guess.

---

## Phase 5 — Materials

Decompile the PowerVR2 → D3D7 state translation. Because the port had to convert
every ISP/TSP word into `SetRenderState` / `SetTextureStageState` calls, this
function is a complete and authoritative mapping. Recover exact semantics for:

- Culling mode, depth compare, Z-write (`ISP_TSP_instruction` bits 26–31)
- Blend factors — `SRC_AlphaInstr` bits 29–31, `DST_AlphaInstr` bits 26–28
- Texture shading (decal / modulate / decal-alpha / modulate-alpha), UV
  clamp/flip, filter mode, fog control
- List assignment: opaque vs translucent vs **punch-through**
  (`parameter_control` bits 24–26) — drives alpha-test vs alpha-blend downstream
- Shading modes: `-3` vertex colour, `-2` bump, `-1` constant, `>= 0` Lambert
- Environment mapping (per-strip flag bit 8), and the quirk where the palette
  index overloads the offset-colour alpha word for PAL4/PAL8 meshes

---

## Phase 6 — Remaining formats

- **`cam/`** — `u32` offset table, monotonic. Two families, `cp_*` and `op_*`.
  RE the playback routine for keyframe struct and interpolation, then export as
  glTF camera animation.
- **`evt/`** — the hard one. Relocatable Dreamcast RAM images with absolute
  `0x0Cxxxxxx` SH-4 pointers baked in (7–8% of all dwords in `st1evtbl` /
  `st2evtbl`). The loader must apply a fixup pass; RE it to recover the pointer
  map, then walk the event structs (spawns, triggers, timings, branching).
  Export as JSON.
- **`coli/`** — count-prefixed float records. RE the hit-test to determine
  whether these are shot volumes, player rails, or both.
- **`mot/`** — `u32` offset table of animation blocks. NL1 has **no skeleton**,
  so establish whether these are per-mesh rigid transforms or vertex morphs.
  That determines whether they export as glTF node animation or morph targets.

---

## Phase 7 — Documentation & C reference

- `docs/formats/*.md` — byte-exact spec per format, each with a worked hex
  example.
- `docs/re/` — annotated function inventory, address map, `.data` table map,
  Ghidra project export.
- `src/` — readable C for the RE'd subsystems: container, decompressor, NL1
  parser, texture decoder, material translation. Documentation-grade and
  independently compilable; not byte-matching.

---

## Phase 8 — glTF exporter

`tools/hod2export.py`:

- Meshes with UVs (`v` flipped) and vertex colours; strips converted to triangles
  with correct per-strip winding and parity.
- PNG textures, `KHR_materials_*` where it maps cleanly, and an `extras.pvr2`
  block carrying the raw ISP/TSP/TCT words verbatim so any engine can implement
  exact behaviour.
- Camera splines as glTF animations; `evt` and `coli` as JSON sidecars.
- A Blender scene-assembly script that lays out a whole stage from its
  `pol` + `tex` + `cam` + `evt` set.

---

## Timeline & risk

| Phase | Effort | Risk |
|---|---|---|
| 0 Baseline | ½ day | none |
| 1 Ghidra env | 2–3 days | low |
| **2 Codec** | **3–10 days** | **high — gates 60% of assets** |
| 3 `hod2lib` core | ~1 week | low (format already verified) |
| 4 Textures | ~1 week | medium (gap resolution) |
| 5 Materials | 3–5 days | low (translation layer is explicit) |
| 6 cam/coli/mot | ~1 week | medium |
| 6 `evt` | 1–2 weeks | high (pointer relocation) |
| 7–8 Docs + export | ~1 week | low |

**Fast path to visible results.** The 192 raw `pol/` files and their raw `tex/`
banks need no decompression at all. Phases 3–4 can be built and validated on
those immediately, in parallel with Phase 2 — so textured stage geometry should
appear in Blender/glTF well before the codec falls.

**Biggest risk is Phase 2.** The Unicorn harness in 2b is the mitigation: it
converts an open-ended cryptanalysis problem into a bounded "lift one function
and run it" problem, entirely within the static-only constraint.
