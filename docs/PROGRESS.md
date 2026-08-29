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
- [x] Import DX7 SDK headers — `tools/dx7_types.py` extracts a Ghidra-parseable
      subset from `dx7sdk-7001.exe`; `D3DRENDERSTATETYPE` + value enums and the
      `D3DLIGHT7`/`D3DMATERIAL7`/`D3DMATRIX` structs are in the program
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

## Phase 3 — `hod2lib` core 🔶 one known gap

- [x] `container.py` — offset table + transparent decompression
- [x] `nl1.py` — independent NL1 parser
- [x] Validated: 9,112 models, 1.49M verts, 1.32M tris, zero structural problems
- [x] ~~Packed s8 normal byte order~~ — **moot**: no vertex-colour meshes exist
- [x] Cross-validated against the reference `NLimporter.parse_nl()` — UVs match
      byte for byte
- [x] Collapsed-UV triangles (5.1%) identified and dropped at export
- [ ] **16-bit UVs (`parameter_control` bit 0) are not decoded** — 128 stage
      meshes affected; the reference addon has the same gap
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

- [x] Global device state decoded (`RenderInitStates`) — `CULLMODE` is
      `D3DCULL_NONE`, `COLORVERTEX` off, all material sources `D3DMCS_MATERIAL`,
      global alpha test at `GREATEREQUAL`/ref 1
- [ ] Locate the per-draw PVR2 → D3D7 state translation
- [x] Document culling (settled empirically, see `formats/nl1.md`)
- [x] Document blend factors — two modes in use, standard and additive
- [x] Document list assignment — no punch-through anywhere in the game
- [x] Alpha handling incl. `IgnoreTexAlpha` opaque variants
- [x] Two lighting setups identified: `SetLightingDefaultSingle` (one
      directional) vs `SetLightingSceneArray` (up to 16 `D3DLIGHT7`), selected
      by draw-command bit `0x04000000` — see `formats/pipeline.md`
- [ ] Document texture shading, UV clamp/flip, filtering, fog
- [ ] Document shading modes and environment mapping

## Phase 6 — Remaining formats 🔶 `evt/` and `cam/` solved

- [x] `cam/` — **solved.** Not a keyframe struct: a pool of independent scalar
      **cubic Hermite** curves plus a per-path descriptor naming one curve per
      channel. `cp_` = 7 channels (eye, look-at, roll), `op_` = 6 (position +
      BAMS Euler). Times are 60 Hz frame numbers. **100.0000 % byte coverage on
      all 24 files.** Spec: [`formats/cam.md`](formats/cam.md)
- [x] `evt/` — **solved structurally.** Fixup is a one-line mask
      (`FUN_00413120`); the payload is a 96-opcode bytecode VM
      (`FUN_0045ECC0`, dispatch table at `0x005931D8`). 16,991 instructions
      decode with zero errors. Spec: [`formats/evt.md`](formats/evt.md)
- [x] Stage routing graph recovered (`0x00597890`) — the branching-path mechanism
- [x] Spawn descriptors: 1,410 recovered; **1216/1216** stage-1/2/4/5/6 spawns
      verified inside their own level geometry
- [x] Asset streaming: job queue, handler tables, slot→pol-file map
      (326/326 entry counts validated), opcodes `0x50`–`0x57` identified
- [x] `tools/dump_stage_script.py` — event script as a readable timeline
- [x] **Stage geometry streaming solved** — regions. Per-scene region tables at
      `0x00576A2C`/`0x00576A5C`; evt opcodes `0x28`/`0x29` (previously
      mis-named BGM) enter/preload a region; load and unload are set
      differences between consecutive regions. Validated: max region operand ==
      region count - 1 on all six stages
- [ ] `evt/` semantics — ~30 opcodes named only by the global they write
- [ ] `evt/` remaining 21 % of bytes (behaviour tails, tween constant pool)
- [ ] `coli/` — record layout + hit-test semantics
- [ ] `mot/` — rigid transforms vs vertex morphs

## Phase 7 — Documentation & C reference

- [ ] Complete `docs/formats/*.md` with worked hex examples
- [ ] Annotated function inventory + Ghidra export
- [ ] `src/` reference implementations compile cleanly

## Phase 8 — glTF exporter 🔶 mostly done

- [x] Mesh + UV + vertex colour export
- [x] Materials with `extras.pvr2` raw state words
- [x] Whole stages merged into one file, one parent node per segment
- [x] `tools/blender_check.py` headless verification + preview render
- [x] Camera splines as glTF animations — `cam/` paths export as visible rail
      polylines plus animated cameras; verified by rendering through a game
      camera and getting a recognisable stage-2 shot
- [x] `--unlit` (`KHR_materials_unlit`) — the game bakes lighting into its
      textures and ships no lights, so a lit render is black
- [x] Correct stage geometry set from the exe region tables, replacing the
      `st<N>_*` glob; `<stage>_regions.json` sidecar and `extras.hod2_regions`
      per model node
- [ ] Camera FOV — not recovered; exported cameras use a neutral 60°
- [ ] `evt` / `coli` JSON sidecars — `evt/` unblocked

## Open questions

Tracked as they arise; each should end up answered in `docs/formats/` or
`docs/re/`.

1. ~~What is the compression codec?~~ **SOLVED** — LZSS at `0x0040ACD0`
2. ~~How are unreferenced texture-bank slots sized?~~ **SOLVED** — descriptor
   tables in `Hod2.exe` at `0x0055B9B8`, no sizing needed
3. ~~Packed s8 normal byte order~~ **MOOT** — no vertex-colour meshes exist
4. Are the 3 anomalous `pol_*` files corrupt, or differently encoded? (Phase 2)
5. Do `mot/` blocks drive rigid transforms or vertex morphs? (Phase 6)
6. ~~What is the `evt/` pointer-relocation scheme?~~ **SOLVED** — one mask at
   `0x00413120`: dwords in `0x0CE80000..0x0CEFFFFF` get `-0x0C53E600`
7. ~~What distinguishes `cam/cp_*` from `cam/op_*`?~~ **SOLVED** — same
   container, different consumers: 7 channels (camera) vs 6 (object, with the
   last three converted by `__ftol` to BAMS angles)
8. How does the game decide a file is compressed? `LoadCommonPolTexBanks`
   decompresses unconditionally, yet 192 `pol/` files are raw. (Phase 3)
9. What are the four 987-byte placeholder files? (low priority)
10. ~~**When are stage segments streamed in?**~~ **SOLVED** — regions. A stage
    is a sequence of overlapping resident sets; opcode `0x29` enters one and
    frees what it no longer needs, `0x28` preloads. See
    [`formats/pipeline.md`](formats/pipeline.md).
11. Is the twiddle Morton convention correct, or transposed? (needs visual check)
12. **What is the 16-bit UV vertex layout?** `parameter_control` bit 0 selects
    it, 128 stage meshes use it, and neither `hod2lib` nor the reference addon
    decodes it. Read the branch out of `Hod2.exe`. (Phase 3)
13. Why does the game not display collapsed-UV triangles? Hardware rejection of
    zero-UV-area polygons, or hidden by the camera rail? (Phase 5/6)
14. Are the reported stretched faces among the 128 16-bit-UV meshes, or is the
    anisotropy genuinely authored? (Phase 3)
15. What is the eighth curve index in a `cp_` path descriptor? Neither
    evaluator reads it, and it always points at a real curve. (Phase 6)
16. Which `evt/` opcode selects a `cam/` path slot? Opcodes `0x18`/`0x19` are
    the prime suspects — they write the two view fields the camera evaluator is
    called with. Answering this reconstructs the camera rail, which would also
    settle question 13. (Phase 6)
17. What do the `queue_event` (`0x30`) selectors mean? The two-level table at
    `0x005776EC` holds 100+ scripted actions — the cutscene vocabulary.
18. Are `+0x14` / `+0x1C` of the spawn descriptor really the other two Euler
    angles? They sit either side of a confirmed BAMS yaw but do not look like
    angles. (Phase 6)
