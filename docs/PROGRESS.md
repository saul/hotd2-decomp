# Progress

Phase detail lives in [`PLAN.md`](PLAN.md).

> **Resuming work?** Read [`re/session-log.md`](re/session-log.md) first — the
> last entry records exactly where the previous session stopped, what was tried
> and failed, and the ordered next actions.

## Phase 0 — Baseline ✅

- [x] Repo initialised, `.gitignore` blocks all asset types
- [x] `tools/baseline.py` written
- [x] `manifest.csv` generated (SHA-256 + size for every input file)
- [x] `inventory.csv` generated (classification, `dword0`, table entries, model
      count, texture-size delta)
- [x] `pol_`-prefixed duplicates identified and the 3 anomalies flagged in
      `re/anomalies.md`
- [x] Format specs stubbed with everything confirmed so far
- [x] Build provenance recorded in `re/provenance.md` (stray `pol/files.txt` build listing)

## Phase 1 — Ghidra environment ✅ complete

Environment reproducible, library noise identified and tagged, code coverage
raised from 52% to 70%. See [`re/session-log.md`](re/session-log.md).

- [x] Import `Hod2.exe`, base `0x400000` — auto-analysis succeeded
- [x] Reproducible headless driver (`ghidra/run.sh`) + Java script template
- [x] Baseline inventory exported: **1891 functions**, 73 non-default names,
      417259 of 798720 `.text` bytes covered (**~52%**)
- [x] Ghidra MCP registered in opencode config (needs restart to take effect)
- [x] MSVC 6.0 Function ID signatures — already applied by auto-analysis via
      `vsOlder_x86.fidbf`; ~35 CRT functions named (`__ftol` alone has 308 xrefs)
- [x] Identify and tag the `d3du`/D3DX utility library — **30 functions named
      exactly** from their diagnostic strings, all tagged `D3DX_LIB`
- [x] Recover missed functions in uncovered `.text` — **1891 → 2278 functions**,
      coverage **52% → 69.9%**
- [x] Find the `pol/` loader (`LoadCommonPolTexBanks` at `0x00418200`)
- [x] Identify the import at `0x4C40A4` — `OutputDebugStringA`
- [ ] Import DX7 SDK headers as a GDT (deferred; needed for Phase 5 materials)
- [ ] Map the `.data` tables adjacent to the filename tables (Phase 4 needs these)
- [ ] Remaining 30% of `.text` — real code, but Ghidra cannot form function
      bodies for it. See the session log; likely truncated-flow damage.

## Phase 2 — Compression codec ✅ SOLVED

Found at `0x0040ACD0` by tracing the data path from the asset loader, not by
constant matching. LZSS, 8 KB window, LSB-first interleaved flag bits.
Spec: [`formats/lz.md`](formats/lz.md).

- [x] Trace each loader's `ReadFile` buffer to its consumer ← this is what worked
- [x] ~~Triage the candidate sliding-window sites~~ — dead end, all 14 were wrong
- [x] ~~Unicorn function harness~~ — **not needed**, static RE was sufficient
- [x] Clean-room `tools/hod2lib/lz.py`
- [x] **793 compressed files decompress to exactly `dword0` bytes, 0 failures**
- [x] 18,027 models parse out of the decompressed containers
- [ ] `src/lz.c` reference implementation (deferred to Phase 7)

## Phase 3 — `hod2lib` core ✅ complete

- [x] `container.py` — offset table + transparent decompression
- [x] `nl1.py` — independent NL1 parser
- [x] Validated: 9,112 models, 1.49M verts, 1.32M tris, zero structural problems
- [x] ~~Packed s8 normal byte order~~ — **moot**: no vertex-colour meshes exist
- [ ] Golden-file regression suite in `tests/`

## Phase 4 — Textures ✅ complete

- [x] ~~Global descriptor map from `pol/` files~~ — **superseded**: the
      descriptor tables are compiled into `Hod2.exe`
- [x] ~~Constraint solver for gaps~~ — **not needed**, offsets are explicit
- [x] Decoder for twiddled / rectangle / VQ, all three pixel formats in use
- [x] **303/303 banks resolve exactly** (mean coverage 1.000, zero overflow)
- [x] BMP and empty-file outliers handled
- [ ] Confirm the twiddle transpose visually (needs a texture with legible text)

## Phase 5 — Materials 🔶 partly done

Alpha, blending and list assignment are resolved from measured usage;
see [`formats/materials.md`](formats/materials.md). The D3D7 state
translation has not been decompiled yet.

- [ ] Locate the PVR2 → D3D7 state translation
- [x] Document culling (settled empirically, see `formats/nl1.md`)
- [x] Document blend factors — two modes in use, standard and additive
- [x] Document list assignment — no punch-through anywhere in the game
- [x] Alpha handling incl. `IgnoreTexAlpha` opaque variants
- [ ] Document texture shading, UV clamp/flip, filtering, fog
- [ ] Document shading modes and environment mapping

## Phase 6 — Remaining formats

- [ ] `cam/` — keyframe struct + interpolation
- [ ] `coli/` — record layout + hit-test semantics
- [ ] `mot/` — rigid transforms vs vertex morphs
- [ ] `evt/` — pointer fixup pass, then event struct walk

## Phase 7 — Documentation & C reference

- [ ] Complete `docs/formats/*.md` with worked hex examples
- [ ] Annotated function inventory + Ghidra export
- [ ] `src/` reference implementations compile cleanly

## Phase 8 — glTF exporter 🔶 mostly done

- [x] Mesh + UV + vertex colour export
- [x] Materials with `extras.pvr2` raw state words
- [x] Whole stages merged into one file, one parent node per segment
- [x] `tools/blender_check.py` headless verification + preview render
- [ ] Camera splines as glTF animations
- [ ] `evt` / `coli` JSON sidecars

## Open questions

Tracked as they arise; each should end up answered in `docs/formats/` or
`docs/re/`.

1. ~~What is the compression codec?~~ **SOLVED** — LZSS at `0x0040ACD0`
2. ~~How are unreferenced texture-bank slots sized?~~ **SOLVED** — descriptor
   tables in `Hod2.exe` at `0x0055B9B8`, no sizing needed
3. ~~Packed s8 normal byte order~~ **MOOT** — no vertex-colour meshes exist
4. Are the 3 anomalous `pol_*` files corrupt, or differently encoded? (Phase 2)
5. Do `mot/` blocks drive rigid transforms or vertex morphs? (Phase 6)
6. What is the `evt/` pointer-relocation scheme? (Phase 6)
7. What distinguishes `cam/cp_*` from `cam/op_*`? (Phase 6)
8. How does the game decide a file is compressed? `LoadCommonPolTexBanks`
   decompresses unconditionally, yet 192 `pol/` files are raw. (Phase 3)
9. What are the four 987-byte placeholder files? (low priority)
10. **When are stage segments streamed in?** Segments are separate `pol/` files
    already positioned in world space; `evt/` and `cam/` almost certainly drive
    load order. Key to reconstructing a playable level. (Phase 6)
11. Is the twiddle Morton convention correct, or transposed? (needs visual check)
