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

## Phase 1 — Ghidra environment 🔶 in progress

Environment is up and reproducible; analysis proper has not started.
See [`re/session-log.md`](re/session-log.md) for state and next actions.

- [x] Import `Hod2.exe`, base `0x400000` — auto-analysis succeeded
- [x] Reproducible headless driver (`ghidra/run.sh`) + Java script template
- [x] Baseline inventory exported: **1891 functions**, 73 non-default names,
      417259 of 798720 `.text` bytes covered (**~52%**)
- [x] Ghidra MCP registered in opencode config (needs restart to take effect)
- [ ] Apply MSVC 6.0 FLIRT / Function ID signatures ← **highest leverage next**
- [ ] Identify and excise the `d3du` / D3DX utility library
- [ ] Force disassembly over the ~380 KB of uncovered `.text`
- [ ] Import DX7 SDK headers as a GDT
- [ ] Seed anchors from `re/addresses.md` (as a committed `SeedAnchors.java`)
- [ ] Find the `pol/` loader via the dir-template table at `0x57A008`
- [ ] Identify the import at `0x4C40A4` called before every `CreateFileA`
- [ ] Map the `.data` tables adjacent to the filename tables

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

## Phase 3 — `hod2lib` core 🔶 in progress

- [x] `container.py` — offset table + transparent decompression
- [ ] `nl1.py` — independent NL1 parser
- [ ] Resolve the packed s8 normal byte-order ambiguity empirically
- [ ] Cross-validation harness against the Blender addon
- [ ] Golden-file regression suite in `tests/`

## Phase 4 — Textures

- [ ] Global `(bank, texID) → descriptor` map from all `pol/` files
- [ ] Constraint solver for banks with unreferenced gaps
- [ ] Decoder for twiddled / VQ / SmallVQ / all pixel formats
- [ ] BMP and empty-file outliers handled
- [ ] Emit `TexID_%03d.PVR` + PNG
- [ ] Cross-check against the RE'd D3D7 upload path

## Phase 5 — Materials

- [ ] Locate the PVR2 → D3D7 state translation
- [ ] Document culling / depth / Z-write
- [ ] Document blend factors
- [ ] Document texture shading, UV clamp/flip, filtering, fog
- [ ] Document list assignment (opaque / translucent / punch-through)
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

## Phase 8 — glTF exporter

- [ ] Mesh + UV + vertex colour export
- [ ] Materials with `extras.pvr2` raw state words
- [ ] Camera splines as glTF animations
- [ ] `evt` / `coli` JSON sidecars
- [ ] Blender stage-assembly script

## Open questions

Tracked as they arise; each should end up answered in `docs/formats/` or
`docs/re/`.

1. ~~What is the compression codec?~~ **SOLVED** — LZSS at `0x0040ACD0`
2. How are unreferenced texture-bank slots sized? (Phase 4)
3. Packed s8 normal byte order — reader convention or writer convention?
   (Phase 3)
4. Are the 3 anomalous `pol_*` files corrupt, or differently encoded? (Phase 2)
5. Do `mot/` blocks drive rigid transforms or vertex morphs? (Phase 6)
6. What is the `evt/` pointer-relocation scheme? (Phase 6)
7. What distinguishes `cam/cp_*` from `cam/op_*`? (Phase 6)
8. How does the game decide a file is compressed? `LoadCommonPolTexBanks`
   decompresses unconditionally, yet 192 `pol/` files are raw. (Phase 3)
9. What are the four 987-byte placeholder files? (low priority)
