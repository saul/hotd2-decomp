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
- [ ] Remaining ~30% of `.text` — real code Ghidra cannot form function bodies
      for. **[measured]** of 204,510 bytes in enumerated gaps, **94% is game
      code** and only 11.5 KB is CRT/d3du; most large gaps carry orphaned
      instructions, so it is code rather than data. It is concentrated in
      `0x420000–0x450000`, `0x460000–0x480000` and `0x490000+` — enemy and boss
      logic, effects, HUD and menus. **None of it is in the asset or render
      pipeline**, which is this project's scope

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

## Phase 3 — `hod2lib` core ✅ (one test suite outstanding)

- [x] `container.py` — offset table + transparent decompression
- [x] `nl1.py` — independent NL1 parser
- [x] Validated: 9,112 models, 1.49M verts, 1.32M tris, zero structural problems
- [x] ~~Packed s8 normal byte order~~ — **moot**: no vertex-colour meshes exist
- [x] Cross-validated against the reference `NLimporter.parse_nl()` — UVs match
      byte for byte
- [x] Collapsed-UV triangles (5.1%) identified and dropped at export
- [x] **Untextured meshes exempted from the collapsed-UV drop** — their UVs are
      all legitimately zero, so the filter was deleting 903 meshes outright
      (811 triangles / 43 materials on stage 2 alone)
- [x] **16-bit UVs — SOLVED, and there was no bug.** `parameter_control` bit 0
      is set on exactly the 903 meshes with `texture_id == -1` and does not
      change the vertex layout. Both of the game's own mesh-chain walkers use a
      fixed 32/8-byte stride keyed only on bit 0 of the vertex record;
      `tools/verify_walk.py` replays that walk over all 9,112 models and lands
      exactly on every declared mesh end
- [x] Vertex stride, back-reference test and `mesh_data_size` masking taken
      from the binary rather than the reference addon
- [ ] Golden-file regression suite in `tests/`

## Phase 4 — Textures ✅ complete

- [x] ~~Global descriptor map from `pol/` files~~ — **superseded**: the
      descriptor tables are compiled into `Hod2.exe`
- [x] ~~Constraint solver for gaps~~ — **not needed**, offsets are explicit
- [x] Decoder for twiddled / rectangle / VQ, all three pixel formats in use
- [x] **303/303 banks resolve exactly** (mean coverage 1.000, zero overflow)
- [x] BMP and empty-file outliers handled
- [ ] Confirm the twiddle transpose visually (needs a texture with legible text)

## Phase 5 — Materials ✅ complete

Alpha, blending and list assignment are resolved from measured usage, and the
PowerVR2 → D3D7 state translation is fully decompiled. See
[`formats/materials.md`](formats/materials.md).

- [x] Global device state decoded (`RenderInitStates`) — `CULLMODE` is
      `D3DCULL_NONE`, `COLORVERTEX` off, all material sources `D3DMCS_MATERIAL`,
      global alpha test at `GREATEREQUAL`/ref 1
- [x] **PVR2 → D3D7 translation located and fully decoded** —
      `TranslatePvr2StateToD3D` at `0x004A7780`, with all five lookup tables
      resolved against the SDK. See [`formats/materials.md`](formats/materials.md)
- [x] Document culling (settled empirically, see `formats/nl1.md`)
- [x] Document blend factors — two modes in use, standard and additive
- [x] Document list assignment — no punch-through anywhere in the game
- [x] Alpha handling incl. `IgnoreTexAlpha` opaque variants
- [x] Two lighting setups identified: `SetLightingDefaultSingle` (one
      directional) vs `SetLightingSceneArray` (up to 16 `D3DLIGHT7`), selected
      by draw-command bit `0x04000000` — see `formats/pipeline.md`
- [x] Texture shading, UV clamp/flip, filtering, fog, blend, ZFUNC — all mapped
- [x] Culling table confirms the Session 6 winding fix from the binary
- [x] ~~Shading modes (`parameter_control & 0x40` → FLAT/GOURAUD)~~ —
      **superseded**, see the correction two lines below
- [x] **Environment mapping — proved absent.** 263 models and 2,976 strips set
      the flags; the port reads neither. Only three `SetTextureStageState` call
      sites exist and none touches `TEXCOORDINDEX` or `TEXTURETRANSFORMFLAGS`,
      so texgen keeps its D3D defaults and no UV is ever computed
- [x] Shade mode corrected — it comes from **strip** flag bit 6, not
      `parameter_control`; `TranslatePvr2StateToD3D` never reads
      `parameter_control` at all
- [x] Strip flag bit 7 (reuse previous state) and bit 5 (super index)
      semantics measured corpus-wide
- [x] Opaque/translucent two-pass selector decoded
      (`(tsp & 0x180000) != 0x80000`)

## Phase 6 — Remaining formats 🔶 `evt/`, `cam/` and `coli/` solved; `mot/` open

- [x] `cam/` — **solved.** Not a keyframe struct: a pool of independent scalar
      **cubic Hermite** curves plus a per-path descriptor naming one curve per
      channel. `cp_` = 7 channels (eye, look-at, roll), `op_` = 6 (position +
      BAMS Euler). Times are 60 Hz frame numbers. **100.0000 % byte coverage on
      all 23 files** — 418 paths, 3,018 curves, 44,800 keyframes.
      Spec: [`formats/cam.md`](formats/cam.md)
- [x] **119 damaged keyframe words in three shipped `cam/` files** (`cp_demo`
      20, `cp_st1` 91, `cp_title` 8) repaired on read, and the repair counted
      and printed rather than silent. Distinct from the 12 trailing padding
      slots, which are part of the format. See
      [`re/anomalies.md`](re/anomalies.md)
- [x] `evt/` — **solved structurally.** Fixup is a one-line mask
      (`FUN_00413120`); the payload is a 96-opcode bytecode VM
      (`FUN_0045ECC0`, dispatch table at `0x005931D8`). **17,150 instructions
      decode with zero errors**, 77 distinct opcodes, no stub ever reached. Spec: [`formats/evt.md`](formats/evt.md)
- [x] Stage routing graph recovered (`0x00597890`) — the branching-path mechanism
- [x] Spawn descriptors: 1,419 recovered; **1546/1546** spawns across all six
      stages verified inside their own level geometry, and **35/35** distinct
      class ids defined in the handler table (`tools/verify_objects.py`)
- [x] **Object paths solved.** `op_` routes are addressed by the same global
      path slot as the cameras; an object binds to one with a slot constant in
      its draw routine. The BAMS Euler triple's application order is recovered
      from the draw chain every path-follower shares — `T·Rz·Ry·Rx`, so
      `q = qZ·qY·qX` — and reproduces an explicit matrix to 4.4e-16. Worked
      example: the stage-1 jeep (`car_pl.bin` + occupants) follows `op_st1`
      0/1/2 in lockstep with `cp_st1` 0/1/2
- [x] Asset streaming: job queue, handler tables, slot→pol-file map
      (326/326 entry counts validated), opcodes `0x50`–`0x57` identified
- [x] `tools/dump_stage_script.py` — event script as a readable timeline
- [x] **Stage geometry streaming solved** — regions. Per-scene region tables at
      `0x00576A2C`/`0x00576A5C`; evt opcodes `0x28`/`0x29` (previously
      mis-named BGM) enter/preload a region; load and unload are set
      differences between consecutive regions. Validated: max region operand ==
      region count - 1 on all six stages
- [x] **Mode-1 region tables at `0x00576A8C` — solved: Original Mode.** Same
      region membership, different id→slot mapping, swapping in the
      `st_org00`–`st_org03` models no region draws in Arcade mode. Every
      substituted model's bounding box lies inside its stage's
- [x] **`queue_event` (`0x30`) fully decoded** — the two-level table at
      `0x005776EC` holds **ten** handlers, not the 100+ previously claimed;
      every selector used anywhere in the game is one of them
- [x] **`evt` → `cam` link solved** — selector `0x40` plays a `cam/` path;
      operand 2 is a *global* path index. **751/751** camera-play actions in
      stages 1–6 name a path from their own stage (`tools/verify_evt_cam.py`)
- [x] **Scene state machine at `0x00576C14` decoded** — a 6×9 table of
      behaviour installers reached by `queue_event` selectors `0x11`/`0x21`.
      Unused cells are a `while(1);` hang loop, so the live set is exact; all
      444 transitions in the shipped scripts land on a live cell. Rows 0–2 are
      the camera modes, including the two that play a path stashed by
      `0x40 flags&2` — **196/196** deferred plays are followed by a transition
      to one of them
- [x] **`evt/` opcode semantics — largely solved.** The ~30 opcodes known only
      by the global they wrote are now decoded from their consumers: scene
      lighting and spotlights, ambient colour, ground plane, backdrop dome,
      rain, HUD shutter, accuracy scoring, camera-path roll/advance gates, the
      wait family (queued events, camera frame, frames, two distinct enemy
      counters, a 256-byte script-flag array, targetable entities), the asset
      job drains, and two stubbed NAOMI sound calls. Full table with
      per-row confidence in [`formats/evt.md`](formats/evt.md)
- [x] **Corrections:** `0x20`–`0x27` are **fog/light tweens**, not per-player
      view tweens — `DAT_009A3540`/`DAT_009A59E0` are the scene light/fog
      blocks; `0x16` is ambient colour, not fog; `0x10`/`0x11` carry relocated
      **collision-mesh pointers**, not ids; `0x0E`/`0x0F`/`0x12` are the enemy
      approach-distance pacing table
- [x] **The skip/fast-forward feature is dead code** — `DAT_009A2D74` is never
      written non-zero anywhere, so every `if (skip)` branch, and opcode `0x2E`
      entirely, is unreachable
- [ ] `evt/` remaining unknowns: the actor class counted by `0x46`, `0x16`'s
      numeric scale, `0x2D`'s sprite-vs-text mode flag, `0x33`'s second
      operand, and `0x1E` (unrecoverable — nothing reads it)
- [x] `tools/hod2lib/evt.py`'s `OPCODES` table updated with the recovered
      names, plus `QUEUE_ACTIONS` for the ten `queue_event` selectors
- [ ] `evt/` remaining 21 % of bytes (behaviour tails, tween constant pool)
- [x] **`coli/` — SOLVED.** Quad-soup collision meshes: per-group AABB
      (stored max-then-min) plus 72-byte quads of `{plane, dominant axis, 4
      verts, surface id}`, recovered from `ColiSegmentVsMesh` (`0x004AAA40`).
      **100.00 % byte coverage on all 8 loaded files**; all 10,064 quad
      vertices lie inside their group's AABB; and **86/86** evt `0x10`/`0x11`
      pointers land exactly on a blob header. Surface ids 5 and 55 are wet.
      Spec: [`formats/coli.md`](formats/coli.md)
- [x] `hod2lib/coli.py` — the parser as a library module; `Stage.colisets()`
      loads a scene's pair, and `script.py` resolves opcode `0x10`/`0x11`
      operands to `file + blob offset + quad count + surface ids`, so
      `dump_stage_script.py` prints
      `set_collision_set_full  full: coli2.bin+0xb148(6q surf 52,53)`
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
- [x] **Texture/sampler split** — a glTF texture is (image, sampler); caching
      on the image alone gave every material sharing an image the addressing
      of whichever mesh was written last. 2,176/2,176 stage-2 materials now
      carry their own `wrapS`/`wrapT`
- [x] `--original` — export Original Mode geometry
- [x] `tools/blender_probe.py` — headless "what is at this pixel", with
      `--sweep` to rank a frame by texel aspect
- [x] Correct stage geometry set from the exe region tables, replacing the
      `st<N>_*` glob; `<stage>_regions.json` sidecar and `extras.hod2_regions`
      per model node
- [x] **Camera FOV recovered** — 41.100° vertical (`0x1D3B` BAMS), 53.115°
      horizontal, 4:3, near 0.8, far 8000, constant for the whole game. From
      `SetupSceneProjection`; the 60° in `InitD3DDeviceAndTextureStages` is
      dead `d3du` scaffolding. Written into every exported glTF camera
- [x] `coli` JSON sidecar — `<stage>_coli.json` carries both files the scene
      loads, every quad's plane/verts/surface, and the blobs the script
      actually activates. **[measured]** the collision bounding box lies inside
      the exported geometry's, so the coordinate spaces match
- [x] **Object export** — every `op_` path is now an animated node
      (translation + rotation), not just a rail; `<stage>_objects.json` carries
      the spawns the event script places and the routes together
- [ ] Path-following objects are hand-coded rigs (a set of asset slots with
      relative transforms in the draw routine), so the animated nodes carry no
      model yet. `FUN_0048E600` is decoded as the worked example
- [ ] `evt` JSON sidecar — `dump_stage_script.py --json` covers it for now

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
12. ~~**What is the 16-bit UV vertex layout?**~~ **SOLVED** — there isn't one.
    `parameter_control` bit 0 marks an *untextured* mesh (perfect 1:1 with
    `texture_id == -1` over 41,463 meshes) and the vertex stride is a fixed 32
    bytes everywhere. `FUN_00419270` turned out to be
    `ModelFlipStripCullingParity`, a content patch for four asset slots.
13. Why does the game not display collapsed-UV triangles? Hardware rejection of
    zero-UV-area polygons, or hidden by the camera rail? (Phase 5/6)
14. ~~Are the reported stretched faces among the 128 16-bit-UV meshes, or is
    the anisotropy genuinely authored?~~ **SOLVED** — neither. They were a
    texture/sampler aliasing bug in the exporter, amplified by Blender's
    Workbench engine ignoring the importer's wrap-mode emulation nodes. See
    [`formats/materials.md`](formats/materials.md).
15. What is the eighth curve index in a `cp_` path descriptor? Neither
    evaluator reads it, and it always points at a real curve. (Phase 6)
16. ~~Which `evt/` opcode selects a `cam/` path slot?~~ **SOLVED** — not
    `0x18`/`0x19`. It is `queue_event` (`0x30`) selector `0x40`:
    `(start_frame, end_frame, global_path_index, flags)`. 751/751 verified.
17. ~~What do the `queue_event` (`0x30`) selectors mean?~~ **SOLVED** — ten
    handlers, tabulated in [`formats/evt.md`](formats/evt.md). The "100+" in
    the old note was an estimate from the region size, not a count.
18. Are `+0x14` / `+0x1C` of the spawn descriptor really the other two Euler
    angles? They sit either side of a confirmed BAMS yaw but do not look like
    angles. (Phase 6)
19. What starts a stage's own BGM? No `bgm_entry_play` in any of the six stage
    scripts names its stage track — they only switch to boss and transition
    music. The tables and the dispatcher are solved
    ([`formats/sound.md`](formats/sound.md)); the scene-entry path that plays
    `ST1_AR`..`ST6_AR` is not. `PlaySoundId` has 496 callers, so this wants the
    scene-entry path, not an xref sweep.
20. What is `DAT_009C8E98`? It selects the plain vs `_AR` BGM mix
    (`== 6`), gates `EvtInterpreterLoop`'s hardcoded scene-5 skip (`== 5`), and
    picks the entry step in `FUN_0045EBC0` (`== 5 || == 9`). Read as "scene id"
    in one place and "scene state" in another; the two readings disagree.
