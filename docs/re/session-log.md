# Session log

Append-only record of work sessions. **Read the most recent entry first** — it
tells you exactly where the previous agent stopped and what to do next.

Conventions:

- Newest entry at the **bottom**.
- Every entry ends with an explicit **Next actions** list.
- Record what was *tried and failed* as well as what worked. Dead ends are
  expensive to rediscover.

---

## Session 1 — Phase 0 baseline

**Outcome:** repo bootstrapped, Phase 0 complete. Commit `647cbad`.

Established the asset inventory, the `pol/` container layout, the `tex/`
headerless texture-bank hypothesis, and that the renderer is Direct3D 7. Full
detail in [`../PLAN.md`](../PLAN.md) and [`../formats/`](../formats/).

Key numbers recorded in `manifest.csv` / `inventory.csv`; key invariants in
[`../../tests/README.md`](../../tests/README.md).

---

## Session 2 — Phase 1 start: Ghidra environment

**Outcome:** Ghidra project created and auto-analysed. Baseline inventory
exported. Analysis proper has **not** started.

### Environment

| | |
|---|---|
| Ghidra | 12.1.3 PUBLIC at `~/ghidra_12.1.3_PUBLIC` |
| Java | Temurin 25.0.4.1 |
| Project | `ghidra/project/HOTD2.gpr` (gitignored, 17 MB) |
| Driver | `ghidra/run.sh` (committed) |
| Scripts | `ghidra/scripts/` (committed) |
| Output | `ghidra/out/` (gitignored) |

Recreate the project from scratch at any time with:

```sh
./ghidra/run.sh import                        # ~2 min, runs auto-analysis
./ghidra/run.sh script ExportInventory.java   # regenerate the baseline
```

### Auto-analysis baseline

```
image base        : 0x00400000
language          : x86:LE:32:default
compiler spec     : windows
functions total   : 1891
  non-default name: 73
  thunks          : 17
bytes in functions: 417259
```

Memory blocks match the Phase 0 header parse exactly, which cross-validates both:

| Block | Range | Size |
|---|---|---|
| `Headers` | `00400000`–`00400fff` | 4096 |
| `.text` | `00401000`–`004c3fff` | 798720 |
| `.rdata` | `004c4000`–`00574fff` | 724992 |
| `.data` | `00575000`–`009cbfff` | 4550656 |
| `.rsrc` | `009cc000`–`009cdfff` | 8192 |
| `tdb` | `ffdff000`–`ffdfffff` | 4096 (Ghidra synthetic) |

### Two observations that matter

**1. Function coverage is only ~52%.** 417259 bytes of the 798720-byte `.text`
are inside recognised functions. The remaining ~380 KB is either unreached code,
data embedded in `.text`, or jump tables Ghidra did not resolve.

This is expected for an MSVC 6.0 binary with no symbols, but it is also a
**risk**: the decompressor could easily be sitting in the unanalysed 48%. Before
concluding a function does not exist, force disassembly over the gaps.

**2. Only 73 of 1891 functions have non-default names.** These come from
imported thunks. No CRT or library identification has happened yet, so
essentially the whole binary is still `FUN_xxxxxxxx`. Applying signatures is the
single highest-leverage next step.

### Ghidra MCP

The `ghidra-mcp` bridge is deployed and healthy at `http://127.0.0.1:8089`
(`/mcp/health` returns ok). It was **not usable** in this session: the agent had
no MCP tools registered, and the bridge speaks MCP to a registered client rather
than plain HTTP — every path except `/mcp/health` returns
`404 No context found for request`.

Registered it in `~/.config/opencode/opencode.jsonc`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "ghidra": { "type": "remote", "url": "http://127.0.0.1:8089/mcp", "enabled": true }
  }
}
```

Config is only read at startup, so this takes effect after an opencode restart.
The next session should have Ghidra MCP tools available for interactive queries.

**Note:** MCP is for interactive exploration. Anything that constitutes a
*result* should still be captured as a committed script in `ghidra/scripts/` or
as documentation, because MCP calls leave no reproducible trail.

### Dead ends — do not repeat

- **PyGhidra scripts do not work.** This Ghidra was not launched with PyGhidra,
  so `.py` GhidraScripts fail with `Python is not available`. `support/pyghidraRun`
  exists, but enabling it needs the `pyghidra` Python package. **Write Ghidra
  scripts in Java** (`.java` GhidraScript) — that always works, and
  `ExportInventory.java` is a working template to copy.
- **Raw HTTP against the MCP bridge does not work.** Only `/mcp/health` responds.
  Do not waste time probing paths; use a registered MCP client.

### Next actions

Nothing below has been started.

1. **Apply MSVC 6.0 signatures.** Ghidra's `Function ID` analyser with the
   `vs6` / MSVC signature sets. Expected to name a large fraction of the ~1891
   functions and remove the static CRT from consideration. Biggest single win
   available.
2. **Identify and tag the `d3du`/D3DX utility library.** Its diagnostic strings
   are present (`CD3duContext::Resize`, `CHelInfo::Initialize`, `_ChooseZBuffer`
   and others); walk their xrefs to name the owning functions, then tag the whole
   cluster as library noise. Stock DX7 SDK sample code, safe to excise.
3. **Force disassembly over the ~380 KB of uncovered `.text`** and re-export the
   inventory to see how much new code appears.
4. **Import DX7 SDK headers as a GDT** so COM vtable dispatch resolves.
5. **Seed the anchors** from [`addresses.md`](addresses.md) as named labels —
   the six asset loaders, the allocator at `0x4A7400`, the `.data` tables. Write
   this as a committed Java script (`SeedAnchors.java`) so it is idempotent and
   re-runnable after any re-import.
6. **Find the `pol/` loader** by following xrefs from the dir-template table at
   `0x57A008`. This is the entry point to the largest asset set and is still
   unknown.
7. **Resolve `0x4C4074`'s neighbour at `0x4C40A4`** — an imported function called
   on the path buffer immediately before every `CreateFileA`. Probably a path
   normaliser or a debug logger; naming it clarifies all six loaders at once.
8. **Then Phase 2:** trace each loader's `ReadFile` buffer to its consumer and
   triage the decompressor candidates listed in `addresses.md`.

### Files added this session

```
ghidra/run.sh                      reproducible headless driver
ghidra/scripts/ExportInventory.java  function/symbol inventory exporter
docs/re/session-log.md             this file
```

`.gitignore` was amended so `ghidra/scripts/` and `ghidra/run.sh` are tracked
while `ghidra/project/` and `ghidra/out/` are not.

---

## Session 3 — Phase 2 SOLVED: the compression codec

**Outcome:** the codec is broken, implemented and verified. Phase 2 is done.
This unblocks 793 of the ~1150 asset files.

### Ghidra MCP now works

After an opencode restart the MCP tools registered. The GUI had **no project
open**, so the sequence that actually works is:

```sh
~/ghidra_12.1.3_PUBLIC/ghidraRun ~/hotd2-decomp/ghidra/project/HOTD2.gpr &
# then, via MCP tools:
list_instances   ->  connect_instance("HOTD2")  ->  open_program("/Hod2.exe")
```

`list_instances` reporting `program_count: 0` and `open_programs: []` means the
GUI is up but idle — connect, then explicitly `open_program`.

### How the codec was found

Not by pattern matching. `get_xrefs_to(0x57A008)` — the `pol\%s` dir-template
table — pointed at `FUN_00418200`, and one decompile made it obvious:

```c
ReadFile(h, staging, size, &read, NULL);
size = *staging;                    /* u32 uncompressed size */
LzDecompress(staging + 1, dst);     /* +1 on a u32* skips the header */
```

Two call sites in that one function, `pol/` and `tex/`, identical shape. The
callee at `0x0040ACD0` is the decompressor.

**The Phase 1 candidate list was entirely wrong.** All fourteen sites were found
by searching for a 4 KB window mask (`& 0xFFF`). The real window is 8 KB and its
size never appears as a constant — the offset comes from sign-extending a 13-bit
field, so there is no mask to grep for.

> **Lesson, recorded because it generalises:** trace the data path from the
> loader. Do not hunt for algorithm-shaped constants.

The Unicorn harness planned in `tools/emu/` turned out to be **unnecessary** —
the decompiled function was directly readable. That directory is now unused;
keep it only if a future function resists static reading.

### The format

LZSS, 8192-byte window. Flag bits LSB-first, interleaved with payload bytes in
one stream. Long form: 13-bit offset + 3-bit length, with an extra length byte
when the field is 0; `u16 == 0` terminates. Short form: 2-bit length + 8-bit
offset. Offsets always negative; matches copied byte-at-a-time so overlapping
runs are intentional. Full spec in [`../formats/lz.md`](../formats/lz.md).

### Verification

```
793 compressed files (458 pol/ + 335 tex/), 0 failures
60,571,242 -> 131,562,208 bytes (2.17x)
18,027 models parsed from the decompressed containers
```

```sh
python3 tools/verify_lz.py --game-dir "/path/to/THE HOUSE OF THE DEAD 2"
```

### Two corrections to earlier work

**1. The container offset table is NOT a fixed `0x800`.** Entry 0 *is* the table
size. Decompressed containers carry right-sized tables — observed `0x20` upward,
always a multiple of 32. The Phase 0 spec generalised from the uncompressed
files, which happen to use `0x800`. `container.md` is corrected.

**2. Classifying by `dword0 > filesize` is unsafe.** Raw texture banks routinely
open with pixel data whose first dword exceeds the file size —
`tex/etc_boy_kao.bin` starts `0xA32992E8` and is entirely uncompressed. That
heuristic produced **24 false positives**. Classification is now trial-based in
`container.py`: valid container, then attempt decompression, then blob.

Corrected census:

```
pol/   458 compressed   192 raw     6 blob
tex/   335 compressed   87 blob    47 bmp    23 empty
```

### Anomalies resolved

The three same-size-but-different `pol_*` twins from Phase 0 are **confirmed
corrupt** — their unprefixed counterparts decompress cleanly, these do not.

Four files are exactly 987 bytes with distinct hashes (`bg_adv19.bin`,
`komono_0.bin`, `tv2.bin`, `tex/scr_tod_itm_itamidome2.bin`). All are referenced
by name in the exe. Probably cut content whose slots were filled with junk.
Low priority.

### Ghidra annotations (saved to the project)

| Address | Name |
|---|---|
| `0x0040ACD0` | `LzDecompress` + full format plate comment |
| `0x00418200` | `LoadCommonPolTexBanks` + plate comment |
| `0x004C40A4` | resolved as `OutputDebugStringA` — debug logging, not path processing |

Note the MCP rename tool enforces a PascalCase + known-verb convention and warns
on violations; `LzDecompress` trips the verb check harmlessly.

### Next actions

Phase 2 is closed. Phase 1 housekeeping is still **not** done and is now the
main blocker on understanding materials.

1. **Apply MSVC 6.0 Function ID signatures.** Still untouched. 2048 functions,
   almost all `FUN_*`. Biggest single win available.
2. **Identify and tag the `d3du`/D3DX library** via its diagnostic strings.
3. **Force disassembly over the uncovered `.text`** (~48% at last count) and
   re-export the inventory to see what appears.
4. **Resolve how the game picks raw vs compressed.** `LoadCommonPolTexBanks`
   decompresses unconditionally, yet 192 `pol/` files are raw. Check the other
   two `0x57A008` consumers at `0x0041887D` and `0x00418C80`, neither of which
   is currently inside a recognised function.
5. **Phase 3: write `nl1.py`.** The container parser already yields 18,027
   models; parsing them is the next deliverable and needs no new RE.
6. **Phase 4: textures.** Now unblocked for the compressed banks too, which
   should shrink the unreferenced-slot gap problem considerably.

### Files added/changed

```
tools/hod2lib/lz.py          the decompressor            (new)
tools/hod2lib/container.py   container parser            (new)
tools/verify_lz.py           whole-corpus verification   (new)
docs/formats/lz.md           rewritten: SOLVED
docs/formats/container.md    rewritten: table size corrected
docs/re/addresses.md         identified functions; dead-end list retained
docs/re/anomalies.md         blobs resolved
docs/PROGRESS.md, docs/PLAN.md, tests/README.md
```

---

## Session 4 — Phase 1 closed: signatures, library tagging, code recovery

**Outcome:** Phase 1 complete. Library noise identified and tagged, function
coverage raised from 52% to 70%.

### MSVC 6.0 signatures — already done, no action needed

Ghidra ships `vsOlder_x86.fidbf`, the Function ID database covering VS6, and the
Function ID analyser is **enabled by default**. It had already run during the
Session 2 auto-analysis.

Result is thin but real: ~35 genuine CRT functions (`__ftol` with 308 xrefs,
`_malloc`, `_memset`, `_strlen`, `_strcmp`, `__CxxThrowException@8`, the
`__local_unwind2` family), plus a large set of `Catch@`/`Unwind@` labels from the
PE exception-handling analyser.

Do not expect more from FID here. MSVC 6.0 coverage in `vsOlder_x86` is limited,
and there is no PDB. The remaining CRT is identifiable by *position* instead —
see the library map below.

### The d3du/D3DX library — 30 functions named exactly

The much bigger win. The DX7 SDK utility library is stock Microsoft sample code
compiled in, and its diagnostic strings carry literal `Class::Method - message`
text. That means the owning function can be named **exactly**, not guessed.

`ghidra/scripts/TagLibraryFunctions.java` does this: match the diagnostic
pattern over defined strings, walk xrefs to the containing function, vote on the
most frequent candidate name, rename, and tag `D3DX_LIB`.

70 strings matched, 30 functions named — `D3DXInitialize`, `d3dxCreateContext`,
`CD3duContext__Resize`, `CD3duContext___CreateZBuffer`, `_ChooseZBuffer`,
`CD3duGlobals__FindBestMatchForHWLevel` and so on. Full list in
`ghidra/out/d3dx_lib.txt`. Idempotent — re-running renames nothing already named.

### Library vs game code

The single most useful structural fact learned this session: **`.text` splits
cleanly.**

| Range | Contents |
|---|---|
| `0x00401000` – `~0x004AC000` | **game code** |
| `~0x004ACF50` – `0x004B74xx` | statically linked MSVC 6.0 CRT |
| `0x004B74FC` – `0x004BC063` | DX7 SDK `d3du`/D3DX library (tagged `D3DX_LIB`) |
| `0x004C31xx` – `0x004C3FFF` | CRT tail, exception unwind helpers |

Everything from roughly `0x004ACF50` upward is library. Filter `D3DX_LIB` and
ignore that range when hunting game logic. This is consistent with
`LzDecompress` at `0x0040ACD0` and every asset loader sitting well below the
boundary.

### Code recovery — 52% to 70%

Auto-analysis left ~380 KB of `.text` outside any function.
`ghidra/scripts/RecoverCodeGaps.java` recovers it, deliberately conservatively.

Inspecting a gap showed what was actually wrong: the bytes at `0x004023C6` are
**already disassembled** — a `CALL`/`JMP` stub pair followed by a state machine
on a global. Real game code that Ghidra never wrapped in a function. The gap
report flags this as `has_orphaned_instructions`.

The fix exploits an MSVC convention visible in that dump: **runs of `NOP`/`int3`
padding delimit functions.** So a gap qualifies if, after skipping padding, it
either starts with a known MSVC prologue *or* is already disassembled and sat
behind padding.

Run repeatedly — each pass exposes new gaps as bodies form:

```sh
HOTD2_APPLY=1 ./ghidra/run.sh script RecoverCodeGaps.java   # repeat until 0
./ghidra/run.sh script ExportInventory.java
```

| Metric | Session 2 | Now |
|---|---|---|
| functions | 1891 | **2278** |
| bytes in functions | 417,259 | **557,972** |
| `.text` coverage | 52.2% | **69.9%** |
| non-default names | 73 | 105 |

### The remaining 30%

240,789 bytes still uncovered across 1859 ranges. Composition: ~26 KB already
disassembled but orphaned, ~27 KB defined data, ~12 KB padding — so roughly
175 KB is undisassembled bytes.

Recovery converges asymptotically (one function per pass at the end), so the
easy wins are taken. The residue is most likely **flow-truncation damage**: a
callee wrongly marked non-returning cuts its caller short, leaving the tail
orphaned. Ghidra's `clear_flow_and_repair` addresses exactly this, but its own
documentation warns it can clear healthy code and is not idempotent. **Do not
run it broadly** — apply per-function, verify, and only where a specific
function is visibly truncated.

This is not blocking. Every function needed so far — the loaders, the
decompressor — is fully formed.

### Gotchas

- **Script execution over MCP is disabled** (`GHIDRA_MCP_ALLOW_SCRIPTS` unset),
  so scripts must be run headless via `./ghidra/run.sh`.
- **Headless cannot open a project the GUI holds.** Save via MCP, `pkill -f
  ghidra.GhidraRun`, run the scripts, then relaunch. Batch headless work rather
  than alternating.
- `createFunction` returning null is normal in damaged regions; the script
  reports the first ten failures rather than swallowing them.

### Next actions

Phase 1 and Phase 2 are both closed. The critical path is now Phase 3/4.

1. **Phase 3: `nl1.py`.** The container parser already yields 18,027 models.
   Parsing them needs no new RE and is the shortest path to visible geometry.
   Spec is written; mind the four known reference-implementation bugs.
2. **Phase 4: textures.** Now unblocked for compressed banks too, which should
   shrink the unreferenced-slot gap problem substantially.
3. **Map the `.data` filename/count tables** (`0x4D1410`, `0x4D1B00`,
   `0x4D1BC8`, and neighbours). Phase 4 needs the per-bank texture counts.
4. **Import DX7 SDK headers as a GDT** before Phase 5 materials work, so COM
   vtable dispatch resolves.
5. Optional: resolve how the game picks raw vs compressed — the other two
   `0x57A008` consumers at `0x0041887D` and `0x00418C80`.

### Files added/changed

```
ghidra/scripts/TagLibraryFunctions.java   name + tag the d3du/D3DX library  (new)
ghidra/scripts/RecoverCodeGaps.java       recover missed functions          (new)
docs/re/addresses.md                      library vs game code map
docs/PROGRESS.md                          Phase 1 closed
```

---

## Session 5 — Phase 3/4: levels, textures and glTF export

**Outcome:** whole stages export to glTF with correct textures and verify in
Blender. Phases 3 and 4 are functionally complete.

### NL1 parser

`tools/hod2lib/nl1.py`, written from the spec with the four known
reference-implementation bugs fixed. Validated across the corpus:

```
327 files, 9,112 models, 1,488,301 vertices, 1,317,805 triangles
no structural problems (indices in range, all positions/UVs finite)
```

That run also closed several open questions outright — the game uses a much
narrower slice of the hardware than NL1 allows:

| | |
|---|---|
| shading modes | lambert and constant only — **no bump, no vertex colour** |
| pixel formats | RGB565, ARGB4444, ARGB1555 — **no palettised, no YUV422** |
| mipmaps | **none** |
| list types | opaque and translucent — **no punch-through** |

So the packed-s8-normal byte-order question is moot (vertex-colour meshes never
occur), the 56-byte bump vertex path is never exercised, and there are no
palettes to find.

### Textures — the hard part

The Phase 0 hypothesis (concatenated in ID order, offsets = prefix sum of
computed sizes) was **wrong**, and wrong in a way that looked right: 115 banks
summed exactly. Decoding an actual image is what exposed it — `st2_01` texture 0
was a clean gradient, texture 1 was pure noise.

Two independent bugs, both invisible without looking at pixels:

1. **Sizes are padded to 2048-byte boundaries.** 64×64 VQ needs 3072 bytes and
   occupies 4096. Sizes already on a 2048 boundary are unpadded, so a prefix sum
   works for some banks and silently drifts in others.
2. **For VQ, the TSP size field is half the real dimensions.** It describes the
   index array; each index covers a 2×2 block.

The tell: **all 115 exactly-summing banks were non-VQ; every VQ bank was wrong.**

#### What actually solved it

Reading the game's own code, not more statistics. `FUN_00418E40` sets
`DAT_00960720 = *(u32 *)(0x0055B9B8 + bank_index * 4)`, and `FUN_004AC980`
indexes it as `table + texture_id * 16`.

**Texture metadata is compiled into `Hod2.exe`, not stored in `tex/` at all.**
16-byte descriptors: width, height, pixel format, PVR layout code, bank offset,
global slot id. `exetab.py` extracts them straight from the PE.

Result: **303/303 banks resolve exactly** — mean coverage 1.000, zero overflow.

> I burned a lot of this session on statistical proxies (adjacent-pixel
> coherence, brute-forced base offsets, SmallVQ hypotheses) that were all
> inconclusive or actively misleading — one metric scored flat black regions as
> perfect. The Phase 2 lesson applied here too and I was slow to reach for it:
> **trace the data path in the binary.** Reach for the decompiler first when a
> layout question resists two quick experiments.

### Export

`tools/hod2lib/gltf.py` writes glTF 2.0 + `.bin` + PNGs, with raw PowerVR2 state
preserved in `material.extras.pvr2` so a target engine can be exact rather than
relying on the approximate PBR mapping.

Stages span many `pol/` files, so `--stage N` merges them into **one** glTF with
a parent node per segment. Texture IDs are per-bank — tex 0 of `st2_01` is
unrelated to tex 0 of `st2_02` — so everything keyed by texture is keyed by
`(part, texture_id)` and PNGs go in per-part subfolders. Getting this wrong
silently cross-wires textures between segments.

Segments are already positioned in **world space**: stage 2 spans x ±3384 with
no per-segment transform needed.

```
stage2: 18 segments, 141,802 verts, 97,799 tris, 1811 materials, 947 textures
Blender: 51 mesh objects, 0 broken images, 0 objects without UVs -> CHECK-OK
```

`tools/blender_check.py` runs Blender headless to verify an export and render a
preview. Worth keeping — it caught the texture bug immediately and is much
faster than opening the GUI.

### Still to verify visually

- **Twiddle transpose.** Morton A (y even, x odd) is implemented. For square
  textures the alternative is an exact transpose, and my symmetric coherence
  metric cannot distinguish them by construction. Decoded images look correct,
  but a definitive check needs a texture with legible text or a known logo.
- **UV V orientation.** Written as stored; Blender's importer flips it, matching
  the reference addon. UV ranges well outside [0,1] are normal here — the game
  relies on REPEAT wrapping.

### Next actions

1. **`coli/` collision.** Structure is partly visible: a 216-byte repeating
   record `[tag][count=52][52 floats]` containing unit normals and plane
   distances, but the leading records do not fit that stride. Needs the hit-test
   routine RE'd rather than guessed — `FUN_0048A310` is the loader.
2. **`evt/` and `cam/` for segment streaming.** Stage segments exist as separate
   `pol/` files and are almost certainly loaded on demand; the event tables and
   camera paths should say when. This is the missing piece for reconstructing a
   playable level rather than a static dump.
3. **DX7 SDK headers as a GDT** before Phase 5 materials work.
4. Trailing bytes in banks where the descriptor table stops short of the file.

### Files added

```
tools/hod2lib/nl1.py       NL1 model parser
tools/hod2lib/texbank.py   bank layout + PowerVR2 decode
tools/hod2lib/exetab.py    descriptor tables extracted from Hod2.exe
tools/hod2lib/gltf.py      glTF 2.0 writer
tools/hod2lib/png.py       minimal PNG writer (no PIL dependency)
tools/export_level.py      CLI
tools/verify_nl1.py        corpus-wide parser validation
tools/blender_check.py     headless Blender import check + preview render
```

---

## Session 6 — face winding fix

**Reported:** exported levels showed back-faces almost everywhere.

**Confirmed and fixed.** Corpus-wide agreement went from **3.4% → 97.81%**.

### Diagnosis

NL1 stores per-vertex normals, which makes winding objectively testable rather
than a matter of taste: compare the geometric normal `(b-a) x (c-a)` against the
summed vertex normals and count sign agreement.

First measurement, before any change:

```
agree     3.4%
disagree 96.6%

by culling flag:
  cull=1  agree 84.7%      <- base winding already correct
  cull=2  agree  1.8%      <- reversal applied here, wrongly
  cull=3  agree  0.7%      <- reversal belongs here
```

The per-flag split is what identified the bug: `cull=1` was already right, so
the base winding was fine and only the *reversal condition* was misplaced. That
matches the flag semantics — mode 2 is "clock", mode 3 is "**r**clock", i.e.
reversed clockwise. The reversal was keyed on 2 instead of 3.

Triangle lists needed separate treatment. `cull==2` and "always reverse" both
scored 100% at first because the initial sample contained only `cull=2`
triangle lists. Widening to the whole corpus found 279 `cull=1` triangle lists,
which disambiguated cleanly:

```
TRIANGLE LISTS, agreement by base winding
  cull=1 base=(a,b,c)    0.0%      cull=1 base=(b,a,c)  100.0%
  cull=2 base=(a,b,c)    0.0%      cull=2 base=(b,a,c)  100.0%
```

So both primitive types share one base winding (first two indices swapped) and
both reverse on `culling == 3`.

> Worth noting the near-miss: had I stopped at the first sample I would have
> "confirmed" a rule that only held because the sample was homogeneous. Check
> the distribution of the discriminating variable before trusting a 100%.

No `cull==3` triangle lists exist anywhere in the game, so that combination is
inferred from strip behaviour, not measured. Flagged in `nl1.md`.

### Exports

Both stages re-exported and re-verified:

```
stage1: 13 segments, 99,580 verts, 69,223 tris, 784 textures  -> CHECK-OK
stage2: 18 segments, 141,802 verts, 97,799 tris, 947 textures -> CHECK-OK
```

Stage 1 spans 7200 x 8198 x 2024 units, stage 2 spans 6698 x 3516 x 812 — both
already laid out in world space.

---

## Session 7 — texture alpha

**Reported:** `stage1` texture 46 should have transparency but did not.

**Confirmed.** The texture decode was already correct; the bug was in the
**material**.

### Diagnosis

`tex_046` is a different texture in every bank, which briefly muddied things:

| bank | tex 46 | list | IgnoreTexAlpha |
|---|---|---|---|
| `st1_01` | 64×64 RGB565 VQ | 0 | 1 |
| `st1_01c` | 128×64 RGB565 | 0 | 1 |
| `st1_02` | 64×256 RGB565 | 0 | 1 |
| **`st1_05`** | **64×128 ARGB4444** | **2** | **0** |

Only `st1_05` is meant to be transparent; the RGB565 ones have no alpha bits
and are genuinely opaque.

Its alpha *was* decoding correctly — 16 distinct values, soft gradient, 96.2%
opaque with an anti-aliased edge — and *was* present in the PNG (colour type 6,
RGBA). But the material said `alphaMode: OPAQUE`, so Blender ignored it.

### Cause

`alphaMode` was gated on the TSP **UseAlpha** bit (bit 20). That bit governs
whether the *vertex / base colour* alpha participates. It does not decide
whether blending happens — the **list type** does.

Requiring it marked **8,554** translucent meshes as opaque: most of the game's
glass, foliage and smoke. `alphaMode` now derives from the list type alone.

### Second problem, found while fixing the first

The corpus survey turned up **2,126 ARGB4444 meshes on the opaque list with
IgnoreTexAlpha set**, plus 1,698 ARGB1555. These textures carry real alpha that
the hardware discards. Emitting it would punch holes in solid geometry — the
mirror image of the reported bug, and one that would have been much harder to
attribute.

The exporter now writes a separate fully-opaque variant (`tex_NNN_opaque.png`)
when `IgnoreTexAlpha` is set, keying the texture cache on
`(part, texture_id, strip_alpha)` so a texture used both ways produces both. In
stage 1 that is 576 of 822 images.

### Also learned

- **Punch-through (list 4) never occurs anywhere.** No alpha testing in this
  game; cutouts use ordinary blending.
- **Additive blending (`src_alpha`/`one`) is real** — 2,704 meshes — but
  entirely confined to `eff_*` and boss assets. Stage geometry has none, which
  is why stages 1 and 2 report `additive=0`. glTF has no additive mode, so it
  exports as `BLEND` with `extras.pvr2.additive` set.
- The opaque list is perfectly uniform: `one`/`zero` + `IgnoreTexAlpha`, always.

Written up in [`../formats/materials.md`](../formats/materials.md).

### Result

```
stage1: 1520 materials -> 1125 OPAQUE, 395 BLEND, 822 images (576 opaque variants)
stage2: 1811 materials -> 1607 OPAQUE, 204 BLEND, 972 images (816 opaque variants)
both CHECK-OK
```

---

## Session 8 — baked lighting was being discarded

**Reported:** a face looked stretched, and separately looked black.

**Stretch: not a bug.** Measured texel density on the reported face
(`st2_03_model_002`, `st2_03_tex8_lambert`): u 6.94/unit, v 5.63/unit, ratio
**1.23 — uniform**. The texture is 128x128 square and decodes cleanly. Whatever
looked stretched there is authored tiling, not an export fault.

Getting to that took a script fix: `blender_whatsthis.py` was reading
`mesh.uv_layers` after re-entering Edit Mode, where the data is stale, so every
report silently omitted its UV section. Now reads in Object Mode and also
reports world-space face area and per-axis texel density — the metric that
actually distinguishes a stretched face from a legitimately tiled one.

### The real bug

The per-mesh **base colour** at mesh header `+0x2C` is the game's baked static
lighting, and the exporter was throwing it away.

`tsp_instruction` bits 6-7 select texture shading: **5,971 of 6,085** stage
meshes use **modulate**, i.e. `final = texture x base_colour`. And **32.2%** of
meshes carry a base colour below 0.95 — 281 at 0.50, 279 at 0.20, 117 at 0.10,
**80 at 0.00**.

The exporter forced `baseColorFactor` to white whenever a texture was present,
reasoning that the texture already supplied the colour and the base would
double-modulate. That reasoning was wrong: modulate *is* a multiply, and glTF's
`baseColorTexture x baseColorFactor` matches it exactly. The result was every
surface rendering at full brightness with all baked shading flattened out.

Now preserved, except under **decal** (3 meshes) where the texture genuinely
replaces the colour and white is correct.

```
stage2 baseColorFactor: 1437 white, 318 mid, 56 below 0.2
```

### Ruled out along the way

Chasing the stretch report eliminated a lot, all recorded so they are not
re-checked:

- non-square textures decode as well as square (coherence 0.294 vs 0.270/0.315)
- zero env-mapped strips in stage geometry
- clamp/flip axis mapping is correct (`clamp==1` has V fitting one tile 83% of
  the time vs U at 32%; `clamp==2` inverts)
- strip parsing is clean: 26,170 back-references, zero failures, zero abandoned
- degenerate triangles are only 0.35% of stage1+2 geometry
- per-triangle texel anisotropy: median 1.76, p90 5.68 (extremes are the
  degenerates)

One open item remains: **60 meshes have a clamped axis with a UV span beyond
one tile**, which smears by construction. The game clamps them too, so this may
be authentic rather than an export fault; resolving it needs the PowerVR clamp
semantics from the binary rather than inference.

---

## Session 9 — collapsed-UV triangles: the stretched/black faces

**Reported:** faces looking very stretched and very dark, persisting across a
clean re-import.

**Found and fixed.** 5.1% of triangles have real 3D area but **near-zero UV
area** — all three vertices collinear in UV space, so one row or column of
texels is smeared across the face's whole 2D extent.

### Evidence

```
mesh 0x12818  3D area 1079.1   uv v = 0.0000 on all three vertices, u 10.0 -> 0.0
mesh 0x19b68  3D area   39.3   uv u = 4.9186 on all three vertices, v varies
```

One UV axis pinned to a constant. That produces a hard directional streak, and a
solid-looking face when the sampled texels are uniform — which is exactly why
the affected faces rendered identically under `--uv-check` (solid grey rather
than a checkerboard).

Distribution across stage1+2: **8,500 of 166,440** triangles (5.1%), worst in
`st1_03` (1,250) and `st2_07` (1,197).

Position within the strip is the diagnostic:

```
first triangle   bad 4.9%
middle           bad 1.1%
last             bad 4.8%
```

**~4.5x concentration at strip boundaries** — the signature of stitching
artifacts. Only 8.6% involve a back-reference, so vertex reuse is not the cause.

Now dropped at export (`--keep-collapsed-uv` to retain). stage1 loses 3,615
triangles (5.5%), stage2 loses 5,452 (5.9%).

### Wrong turns, recorded so they are not repeated

This took far longer than it should have. Hypotheses pursued and disproved:

| Hypothesis | Disproved by |
|---|---|
| non-square texture decode | coherence 0.294 vs 0.270/0.315 for square |
| env-mapped UVs | zero env-mapped strips in stage geometry |
| clamp/flip axis swap | `clamp==1` has V fitting one tile 83% vs U 32% |
| back-reference resolution | 26,170 back-refs, zero failures |
| VQ sizing in that bank | offsets consistent at 6144 per 128x128 entry |
| base colour over-darkening | the face's mesh has base 1.00 |
| texture decoding dark | near-black textures are 36/972, spread across all formats |
| **duplicate imports z-fighting** | **user re-imported clean; identical result** |

The duplicate-import call was the worst of these: I read `.002`/`.003` object
suffixes in a screenshot as proof and asserted it confidently instead of
treating it as one candidate among several. The user had already been deleting
old imports. **A suffix is evidence of a name collision, not proof of its
cause.**

What actually solved it was giving up on aggregate statistics and dumping the
raw vertex data of specific bad triangles. The corpus-level metrics all looked
healthy — median anisotropy 1.76, 0.35% degenerate 3D triangles, uniform texel
density on the sampled faces — because a 5% tail does not move a median. The
per-face reports the user sent were also clean, because the faces they happened
to sample were not the collapsed ones.

**Lesson: when aggregate health contradicts a consistent visual report, stop
computing aggregates and print the raw records of the outliers.**

### Still unresolved

Why the game does not display these. Either the hardware rejects polygons with
zero UV area, or they are hidden along the camera rail. Worth settling from the
binary rather than inferring, but dropping them is safe regardless — they carry
no displayable texture information.

Also still open: 60 meshes with a clamped axis and a UV span beyond one tile.

---

## Session 10 — stretched faces: what was proved, and what is still open

**Reported:** faces look very stretched. Persists after the collapsed-UV fix,
after a clean re-import, and — critically — **under `--uv-check` as well**, which
rules out texture content entirely.

**Not solved.** Two real bugs were found and fixed along the way, but neither
fully explains the report. This entry records the evidence so the next session
does not re-tread it.

### Ground truth: my UVs match the reference implementation exactly

The cross-check planned back in Phase 3 and repeatedly deferred. Extracted
`st2_07` model 12 to a standalone NL1 file and ran the reference
`NLimporter.parse_nl()` inside Blender:

```
reference : (2.0000, -1.0000) (0.0000, -1.0000) (1.8434, -0.0000) (0.1566, -0.0000)
hod2lib   : (2.000,  -1.000)  (0.000,  -1.000)  (1.843,  -0.000)  (0.157,  -0.000)
```

Identical. **UV parsing is correct**, and the reference addon would render the
same apparent stretching. To re-run:

```sh
mkdir -p /tmp/nlpkg && ln -sfn ~/blender-NaomiLib /tmp/nlpkg/naomilib
# then inside Blender: sys.path.insert(0,"/tmp/nlpkg"); from naomilib.NLimporter import parse_nl
```

### No systematic u/v bias

For every triangle, world-units-per-texel along u versus along v, via the
texel→world Jacobian:

```
geometric mean 0.937      median 0.955      n = 72,209

  <0.55     24.2%
  0.55-0.9  22.9%
  ~1.0      14.6%
  1.1-1.8   16.6%
  ~2.0       6.1%
  >2.2      15.6%
```

Centred on 1.0 and **symmetric in both directions**. A global aspect error — a
factor of 2 somewhere, u/v transposed, VQ half-size mishandled — would skew this
distribution hard to one side. It does not. Competing hypotheses scored worse on
median anisotropy: as-is 1.81, VQ-half-dims 1.81, square-1:1 2.15, u/v-swapped
2.50.

So the anisotropy is **in the source data**, spread symmetrically, i.e. it looks
authored.

### Ruled out this session

| Hypothesis | Disproved by |
|---|---|
| UV parsing wrong | matches reference `parse_nl()` byte for byte |
| u/v transposed | median anisotropy worsens 1.81 → 2.50 |
| VQ half-size affects UVs | identical result to as-is |
| systematic aspect factor | geometric mean 0.937, symmetric spread |
| duplicate geometry in one export | 14/14, 3/3, 3/3 models distinct by vertex hash |
| texture content streaking | `--uv-check` is stretched too |
| vertex stride wrong | 100% of sampled normals unit length |

### Two real bugs found and fixed

1. **Collapsed-UV triangles** (previous entry) — 5.1% of triangles have real 3D
   area but ~zero UV area, concentrated 4.5x at strip boundaries. Now dropped.
2. **Base colour discarded** — 32% of meshes carry baked lighting below 0.95.
   Now applied under `modulate`.

Neither accounts for widespread stretching.

### The live lead: 16-bit UVs are never decoded

`parameter_control` bit 0 selects **16-bit UV** instead of two `f32`. Across
stage1+2:

```
32-bit UV : 5,957 meshes
16-bit UV :   128 meshes   (2.1%)
```

Worst files: `st2_02` (13), `st1_03b` (12), `st2_07` (11), `st1_1` (10),
`st2_03` (9).

**Neither `hod2lib` nor the reference addon honours this flag** — both always
read two 32-bit floats. For those 128 meshes the vertex stride and the UV values
are therefore both wrong, which would produce exactly this kind of garbage
mapping.

Caveat, stated plainly: **2.1% of meshes cannot explain stretching seen across
many surfaces.** This is worth fixing because it is definitely wrong, but it
should not be presented as the answer until it is measured. `st2_07` — the file
the reported face lives in — is third worst, so check whether the reported mesh
is one of the 128 before assuming.

### Next steps

1. Determine the 16-bit UV vertex layout from `Hod2.exe` rather than guessing.
   The renderer must branch on PCW bit 0 somewhere near the vertex submission
   path. Fix `_read_vertex` and re-measure anisotropy on the affected meshes.
2. Check whether the specific reported faces are among those 128 meshes.
3. If they are not, the remaining explanation is that the anisotropy is genuine
   and the game hides it behind its fixed camera rail — which would make `cam/`
   and `evt/` (Phase 6) the way to confirm, by reconstructing the intended view.

### Process note

This took far too long. The pattern of failure was consistent: corpus-wide
statistics kept coming back healthy because the artefacts sit in a small tail
that does not move a median, and the two per-face reports supplied happened to
sample clean faces. Progress only came from dumping raw records for specific bad
triangles, and from finally running the reference implementation instead of
reasoning about whether it would agree.

Worse, I asserted a wrong root cause (duplicate imports z-fighting) from a
`.002` suffix in a screenshot. It was a plausible candidate; it was not proof,
and I stated it as though it were. **Offer candidates as candidates until a
measurement settles them.**

---

## Session 11 — Phase 6: `evt/` and `cam/` both solved

Both formats went from "highest-risk, largely unknown" to parsed and validated
in one session. The reason is worth recording, because it contradicts how the
plan framed the work: **neither needed the data-first analysis the plan
proposed.** Both fell out of reading the binary directly, and both of the
"hard problems" the plan warned about turned out to be artefacts of guessing
from data instead of reading code.

New code: `tools/hod2lib/evt.py`, `tools/hod2lib/cam.py`,
`tools/verify_phase6.py`, plus scene/route tables in `tools/hod2lib/exetab.py`.

### `evt/` — the fixup routine was three functions from the known crash site

`docs/re/addresses.md` already recorded a crash at `0x413133` with
`\evt\st1evtbl.bin` on the stack. The containing function is `FUN_00413160`,
whose last call before returning is:

```c
FUN_00413120(PTR_DAT_005798EC, (int)nBytes >> 2);
```

and that is the entire relocation scheme:

```c
for (; n; n--, p++)
    if ((*p & 0xFFF80000) == 0x0CE80000)
        *p += 0xF3AC1A00;          /* -= 0x0C53E600 */
```

Total elapsed: two tool calls. The plan had budgeted `evt/` as the highest-risk
item in the project.

**The "span problem" never existed.** `docs/formats/evt.md` recorded pointer
ranges 4x and 160x the file size and concluded that pointers must cross into
other loaded structures. They do not. That analysis filtered on `0x0Cxxxxxx` —
a 16 MB window. The program's own test is a 512 KB window,
`0x0CE80000..0x0CEFFFFF`. Under the correct mask every candidate resolves
inside its buffer and 6619 of 6622 are dword-aligned.

**Lesson, and it is the same one as Session 10 in a different costume: a
heuristic filter wider than the program's own test manufactures anomalies that
do not exist.** Both times the fix was to stop reasoning about the data and go
read what the code actually does.

The load addresses are fixed and adjacent, which is what makes the offsets
recoverable: `comevtbl.bin` at `0x00977200` (DC `0x0CEB5800`), the scene table
at `0x00977400` (DC `0x0CEB5A00`). `comevtbl` is 0x200 bytes of scratch
immediately below the scene table, and scene tables do point back into it —
answering the old question about whether the two link.

#### The event VM

`FUN_0045ECC0` is an interpreter over a **96-entry dispatch table at
`0x005931D8`**, opcodes `0x00`–`0x5F`, dword-granular, each handler advancing
`pc` itself. Transcribing the operand length of all 96 handlers is the bulk of
the session's manual work and is captured in `evt.OPCODES`.

Validation is by exhaustion and it is sharp: **16,991 instructions across all
13 files decode with zero errors, and none of the five empty-stub dispatch
slots is ever encoded.** A single wrong operand length desynchronises the
decoder and lands it on garbage within a few instructions, so this is a real
test rather than an absence of crashes.

Three levels of indirection: `comevtbl[scene]` → block table → step table →
bytecode.

#### Two traps in the container

1. **`-1` in the root array is a hole, not a terminator.** Stopping at the
   first one loses blocks (17 → 15 for stage 1) and silently drops ~10 % of
   each file. Two independent fixes agree on all 10 files: scan while entries
   are pointer-or-hole, or read the block count from the EXE route table.
2. `FUN_0045EBB0`, which every handler calls on pointer operands, is
   `mov eax,[esp+4]; ret` — a no-op left over from the Dreamcast build. It
   looks like an ID→pointer translation and is not one. Do not read meaning
   into it.

#### Stage routing — bonus result

`0x00597890` is a scene-indexed **route table**: 8-byte records
`{kind, next[3]}` where kind 0 = goto, 1 = branch on `DAT_009C88A4`, 2 = end.
This is the branching-path mechanism the game is known for. Stage 2 has 42
nodes with 15 branch points. This also answers open question 10 in part —
block order, and therefore segment order, is driven from here.

#### Spawn descriptors, and the check that mattered

Header is 0x24 bytes (`FUN_004088A0` / `FUN_00408A20` / `FUN_00408BC0`):
class, flags, `f32 pos[3]`, `s32 orient[3]`, `u16 hp`, variable tail.

The falsifiable test: sample every spawn position against the bounding box of
the matching `pol/` geometry. **1216 of 1216** stage-1/2/4/5/6 spawns land
inside their own stage. Stage 3 scores 77 % — its geometry bounds come out as
z ∈ [−4486, −493] while spawns run to z = +4, so the `st3_*` prefix probably
does not cover every segment of that stage. Worth a look, not alarming.

`+0x22` is hit points: it is written to *both* a current and a maximum field,
and ranges 0–18 over 1410 descriptors. `+0x18` is a BAMS yaw (range covers
±65536, `0x4000` = 90°).

**Stated as unresolved rather than guessed:** `+0x14` and `+0x1C`. They reach
object +0x64 and +0x6C and sit either side of a confirmed angle, so "the other
two Euler angles" is the obvious reading — but their distributions (mostly 0,
otherwise 1–10) do not look like angles at all. Flagged in `evt.md`; do not
export them as rotations without settling it.

### `cam/` — the container was never an offset table

The old spec read the leading `u32` array as "start of data" and hypothesised a
keyframe struct with interleaved channels. Both were wrong.

`FUN_004041E0` gives the whole structure away:

```c
p    = slot[index].ptr;                       /* -> 7 curve indices */
base = file_base;
out_pos[0] = eval(base + p[0]*4, t);          /* eye.x   */
...
out_tgt[2] = eval(base + p[5]*4, t);          /* target.z */
roll       = (int)eval(base + p[6]*4, t);
```

So a file is a **pool of independent scalar curves** plus a small descriptor per
path naming one curve per channel. Channels are not interleaved.

`FUN_004040F0` is a textbook **cubic Hermite** evaluator with independent
in/out tangents — which maps onto glTF `CUBICSPLINE` with no reshaping beyond
scaling tangents by the segment length.

```
+0x00  u16 key_count       always a power of two
+0x02  u16 search_steps    log2(key_count)
+0x04  key[]               {f32 time, value, tangent_out, tangent_in}
```

`key_count` is a power of two because the search runs a fixed `log2(count)`
steps rather than a bounded loop.

**`cp_` vs `op_` — answered.** Identical container, two consumers.
`FUN_004041E0` reads 7 channels (eye, look-at, roll) — camera path.
`FUN_004042D0` reads 6 and pushes the last three through `__ftol` — object
path, position plus a BAMS Euler triple. That the integer conversion is visible
in the decompilation is what settles it; the naming alone never could.

**Timebase — answered.** Times are frame numbers at 60 Hz. 99.68 % of 44,750
keyframe times sit within 0.01 of an integer; the residue is f32 accumulation
error, not a finer grid. Longest curve ends at frame 3600 = exactly 60 s.

Validation: **100.0000 % byte coverage on all 24 files.** Every byte is claimed
by exactly one of {offset table, curve, descriptor}. This is an unusually
strong check — a wrong keyframe stride or descriptor size desynchronises the
linear pool walk immediately and coverage collapses.

Camera eye positions sampled against level geometry land inside the stage
90–100 % of the time.

### Dead ends and wrong turns

- **Assuming a fixed descriptor size.** First pass hardcoded 8 dwords for `cp_`
  and 6 for `op_`. `cp_` was right; `op_` broke on `op_st1` and `op_st6`
  (71.7 % and 91.9 % coverage). The fix was to stop assuming and derive the
  span structurally — run to the next valid curve header. Curve headers are
  unambiguous (`key_count` a power of two *and* `search_steps == log2` of it),
  so this is safe, and it took coverage to exactly 100 % on every file.
- **Trusting the offset table to locate descriptors.** A table-driven pool walk
  desynchronises on `op_st1`, because six of its entries are corrupt. Table-free
  structural walking is strictly better here.
- **`E.spawns()` returned 0 on the first run.** `Instr.words` holds *relocated*
  operands, so `is_pointer()` on them is always false. Pointer resolution has to
  use `Instr.raw`. Silent wrong answer, not a crash — the kind of bug that
  survives a smoke test.
- **Reading `+0x22` of the spawn descriptor as "flags" and `+0x24` as hp.**
  Backwards. Corrected by dumping raw descriptors at a 0x28 stride rather than
  trusting the first field assignment that looked plausible.
- Ghidra could not form function bodies for **31 of the 84** dispatch targets —
  the Phase 1 coverage gap, still unfixed. The dispatch table is itself the
  cure: it is 96 known-good entry points. Created them by hand via MCP.
  `run_script_inline` is disabled (`GHIDRA_MCP_ALLOW_SCRIPTS` unset), so this
  was one call per address rather than one script.

### State

`tools/verify_phase6.py --game-dir "..."` — passes with no structural problems.

```
cam/  418 paths, 3018 curves, 44,800 keyframes, 100.0000 % byte coverage
evt/  141 blocks, 583 steps, 16,991 instructions, 1,410 spawn descriptors,
      76 distinct opcodes all inside the 96-entry table, 78.8 % byte coverage
```

`evt/` coverage is 78.8 % rather than ~100 % because operand data behind
opcodes whose targets are not yet followed is unaccounted for — chiefly the
behaviour tails of `0x0B`/`0x0C` descriptors and the float constant pool the
tween opcodes point into. The structure is solved; the residue is semantics.

### Next actions, in order

1. **Export.** Both formats now have everything the exporter needs.
   `cam/` → glTF `CUBICSPLINE` animations; `evt/` spawns → a JSON sidecar.
   This is the highest-value next step and closes two Phase 8 boxes.
2. **Link `evt` → `cam`.** Opcodes `0x18`/`0x19` write the two view fields that
   `FUN_00401F40` passes to the camera evaluator. Tracing operand → slot id
   would let a whole stage be reconstructed as a playable camera rail — and
   would settle open question 13 (whether collapsed-UV faces are simply never
   on screen) by reconstructing the intended view.
3. **Decode the `queue_event` action table** at `0x005776EC`. 100+ named
   scripted actions; this is the cutscene vocabulary.
4. Chase the remaining 21 % of `evt/` bytes by following `0x0B`/`0x0C` tails.
5. Stage 3's spawn/geometry mismatch — probably a missing `pol/` prefix.

### Addendum — camera paths in the glTF export

Asked whether the splines were in the stage glTF. They were not: `cam/` parsing
landed but the exporter had never been wired to it. Now done, and closing two
Phase 8 boxes.

Per `cp_` path the exporter emits **both** an animated camera and a visible
**rail** — an edge-only `LINE_STRIP` mesh with two polylines, eye track and
look-at track. The rail is the more useful half: it shows the whole camera
layout over the level without playing anything.

**Rotation cannot be a `CUBICSPLINE`.** The plan assumed `cam/` curves would
map one-for-one onto glTF samplers, and for translation they do. But glTF has
no look-at, so orientation has to be composed from *two* curves
(`-Z = normalize(target - eye)`), and that composition is non-linear — the
source tangents do not carry through it. Both channels are therefore baked on a
fixed frame grid (default every 2 frames) and emitted `LINEAR`. Faithfulness is
in the sampling rate, not the interpolation mode.

`op_` paths export translation only. Their three integer channels land in the
same object fields as the `evt/` spawn descriptor's `+0x14`/`+0x1C`, which this
session explicitly declined to identify — so emitting them as rotation would be
guessing twice over.

#### The check that mattered

Rendering through `cp_st2_50_cam` at frame 90 produces a recognisable stage-2
Venice canal-side plaza. That single image exercises the keyframe layout, the
Hermite evaluation, the look-at construction and the coordinate space at once,
and none of them can be wrong if the frame looks like the game.
`tools/blender_camview.py` is that check, committed.

#### Black renders — a real bug, found by making a wrong assumption first

First render attempt came out black. My initial explanation was the one already
in the README ("interiors carry no lights, add one"), so I added a sun and
re-rendered — still black.

**That explanation was incomplete and adding a light was the wrong fix.** HOTD2
bakes all illumination into its textures and per-mesh base colour and ships
*no* light sources; the geometry is not meant to be lit at all. The correct
model is `KHR_materials_unlit`, now available as `export_level.py --unlit`.
With it, EEVEE renders correctly with **zero** lights in the scene — verified.

Two process notes:

- I very nearly reported "it's just lighting, add a sun" without testing it.
  Diagnosing with Workbench + FLAT + TEXTURE first removes lighting as a
  variable entirely, which is why `blender_camview.py` defaults to it and why
  it ray-casts down the view axis: a camera aimed at nothing and a camera in
  the dark look identical in a PNG, and they are completely different bugs.
- `blender_camview.py` prints mean luminance, so "it rendered black" is a
  number rather than an impression.

#### Smaller traps

- glTF animation time is **seconds**; Blender's scene default is 24 fps while
  the game runs at 60, so game frame numbers and Blender frame numbers do not
  agree until the scene is set to 60 fps. The tool sets it; the README says so.
- Blender 5.2 dropped `BLENDER_EEVEE_NEXT` back to `BLENDER_EEVEE`. The tool
  picks whichever the running build actually offers instead of hardcoding.

#### Still guessed, and flagged as such

Field of view. The exported cameras use a neutral 60° and carry
`extras.hod2_yfov_is_a_guess`. The unread eighth curve index in every `cp_`
descriptor is the obvious candidate — it is the one per-path scalar a camera
needs that no channel supplies — but that is a hypothesis, not a finding.

### Addendum 2 — the asset pipeline, and how three guesses died

Asked whether an event stipulates which parts of a stage load and unload, and
how `cam`/`evt`/`pol`/stages relate during play. New doc:
[`formats/pipeline.md`](../formats/pipeline.md), and
`tools/dump_stage_script.py` renders a stage's script as a readable timeline.

**Answer: partly, and less than expected.** Opcodes `0x50`–`0x57` are the asset
load/unload vocabulary and the whole job queue is now mapped — but the stage-2
script references only **2 of its 18** `st2_*` geometry files. What brings in
the rest is still unknown.

#### What was established

Loading runs through a 64-entry job ring at `0x007DA220`,
`{kind, _, arg, state}`, dispatched by `FUN_0041D5A0` through a handler table
at `0x00588C20`. `FUN_00418820` loads **one model** out of a pol file by reading
its offset table, seeking, and reading just that entry — genuine slot-level
streaming.

The id plumbing is four EXE tables (file→name, file→count, file→slot list,
slot→file). Validated: for all **326** live pol files the EXE's entry count
equals the container's model count. Indices ≥328 are a disabled duplicate name
range with count 0 — which incidentally explains the `pol_`-prefixed duplicates
from Phase 0: they are switched-off table entries.

`dump_stage_script.py` resolves every operand to a filename. Stage 2: 405 slot
ops and 794 file ops, **zero unresolved**.

#### Three wrong answers, in order

1. **`0x0F`/`0x12` "set_pending_ids" as segment streaming.** They write an id
   list that `FUN_00456650` reads while comparing an object's distance to
   camera against three radii — it is **LOD model selection**, not loading.

2. **`0x52`/`0x53` as voice calls.** I had named them `voice_a`/`voice_b` in the
   opcode table last session purely from their handler addresses sitting near
   other sound code. They are `asset_load_polfile` / `asset_free_polfile`. The
   giveaway was `FUN_0041D5A0` indexing a handler table that contains the
   **unload** routine `FUN_00418BA0`. Naming a function from its neighbours is
   not evidence.

3. **A "per-stage segment list" at `0x004E7C90`.** This one is the instructive
   failure. The table decoded as
   `st1_1b, st1_01, st1_01b … st2_01, st2_02, st2_03`, in perfect stage order.
   It looked conclusive. It is wrong: the values are **asset slot ids**, not pol
   file indices, and the groups are contiguous slot runs covering one model file
   each — group 0 is every model in `boss6.bin`.

   **pol file indices are assigned alphabetically, so *any* run of consecutive
   integers decodes through that table into a plausible sequence of related
   filenames.** The "evidence" was an artefact of the lookup table's ordering,
   not of the data. Caught only by decoding the same run through the *other* id
   space and seeing it make equally good sense there.

   This is the same failure as the `evt` "span problem" and the `0x0Cxxxxxx`
   filter: **a decoding that cannot fail is not a decoding.** Both id spaces had
   to be tried before either could be believed.

#### Also corrected

`cam.md` claimed opcodes `0x18`/`0x19` were the likely camera-path selectors.
They are not — they write view+0x18/+0x1C, which `FUN_0040E0B0` feeds to the
matrix rotation helpers. They are camera *angles*. How a `cam/` path slot gets
selected is still untraced; `FUN_004041E0` has 15 callers and none has been
looked at.

#### Bug fixed on the way

Attributing every uncovered byte to the opcode pointing at it showed the biggest
run sitting immediately after `st1evtbl.bin`'s root table — the wrong place for
operand data. A step-table entry that resolves outside the file is an external
reference into the shared `comevtbl` buffer, not a terminator. Fixing it
recovered 4 steps, 159 instructions and 9 spawn descriptors. Corpus coverage
78.8 % → 79.4 %.

#### Next

1. Find what loads the bulk of stage geometry. Untried: the load-until-drained
   loop in `FUN_00460030`, job kinds 8/9, and a per-scene list behind an
   untraced pointer.
2. Trace `FUN_004041E0`'s callers to link `evt` → `cam`.
3. The `queue_event` action table at `0x005776EC`.

### Addendum 3 — method rule recorded; evt→cam link closed

Pulled up for guessing from data files instead of reading the code. Correct
call: every real result this session came from the binary, every dead end came
from statistics over bytes. Written down as
[`docs/re/method.md`](method.md) — **Rule 1: read the code before you read the
data** — with the four project-specific traps that produced wrong answers
(the `0x0Cxxxxxx` filter, the alphabetical-table artefact, naming a function
from its neighbours, and mistaking LOD id lists for streaming).

Applying the rule immediately paid off.

#### evt → cam is solved, and it was never an opcode

I had been looking for a dedicated "select camera path" opcode and had already
burnt one wrong candidate (`0x18`/`0x19`, which are angles). Reading
`EvtRunQueuedActions` instead of hunting for more candidates gave it in one
step: camera playback is a **queued action**, `queue_event` (`0x30`) with
selector `0x40`. Its handler resolves to `CamEvalPath7(args[2], args[0], …)`.

```
[0x30][0x40][ t ][ ? ][ cam path slot ][ flags ]
```

**880 of 885** occurrences carry a valid path slot, and **every script
references only its own cam file** — `st2evtbl`→`cp_st2`, `trnevtbl`→`cp_train`,
and so on, with zero cross-references. That is not a coincidence one can
manufacture.

Also corrected a claim I made two addenda ago: the `queue_event` table holds
**nine** selectors, not "100+ scripted actions". That estimate came from
eyeballing the size of the table region — data-guessing again, in the same
session I was writing up the dangers of it.

The five exceptions all name slot **418**, one past the end of the 0–417 range,
all in `trnevtbl` block 7. Recorded as anomaly 8.

#### Other work

- **`cam` slot binding** added to `exetab.py`: `cam_files()`,
  `cam_path_slots()`, `cam_slots_for()`, `slot_cam_file()`. Validated 23/23 —
  the EXE count matches the parsed path count for every file, the forward and
  reverse tables agree, and the slots tile 0–417 with no gaps or overlaps.
- **`cam.md` stride hazard fixed.** The binding table listed addresses with an
  "indexed by" column and no element size, which reads as a uniform `u32`
  stride. `0x004C476C` is `u16`. A `u32` read does not fail — for `cp_st2` it
  returns 65537 instead of 66. Every table now carries its element size *and*
  the exact addressing expression, with the failure mode spelled out.
- **`ApplyKnownTables.java`** — one script that turns all five recovered
  dispatch tables (96 opcodes, 56 class handlers, 8 job kinds, 7 sub-steps, 9
  queued actions) into created + named functions, and reports the `.text`
  coverage delta. This is the reproducible form of what has been done by hand
  over MCP for three sessions. Run it first after a fresh import.
- 15 functions named in the live database, PascalCase to match the existing
  convention (`LzDecompress`, `LoadCommonPolTexBanks`).

#### Still open, and how to attack it *from the code*

**What loads the bulk of a stage's geometry.** 55 of 72 stage-geometry pol
files are never named by any event script, so a separate path exists. Two
data-first attempts already failed (a scan for u16 stage tables, and the
`0x004E7C90` group table that turned out to be slot runs).

The code-first attack, not yet done: every geometry load *must* pass
`FUN_0041D5D0`, whose callers are a **closed set of 12**. Four are already
accounted for (the evt opcode, stage init, and two attract-mode setups).
Reading the remaining eight settles it. `FUN_00412440` is the most promising —
it walks a `s16` list from an object field and enqueues a slot per entry via a
record table at `0x004EC748`.

Do that before touching the data again.

### Addendum 4 — stage geometry streaming: regions

Solved, decompilation-first as instructed. The user's observation that stage 2's
geometry overlaps in an export but never on screen was the correct diagnosis and
pointed straight at it.

**A stage is a sequence of overlapping *regions*.** `DAT_009A2224` holds the
current region id. Each region names up to 12 asset slots, and that one set is
used for **both drawing and streaming**:

```
RegionDrawResidentSet  0x00401260   bounding sphere -> frustum cull -> draw
RegionLoadDelta        0x00401510   load  (new \ old)
RegionUnloadDelta      0x004015A0   free  (old \ new)
```

The two halves are exact mirrors — the same set-difference walk, one calling the
load enqueues and the other the free enqueues. Consecutive regions share most of
their contents and swap one or two, a sliding window along the rail. Stage 2:

```
region 5 : st2_10[0], st2_10[1], st2_10[2]
region 6 : st2_04[0], st2_04[2], st2_10[1], st2_10[2], st2_11[0]
region 7 : st2_04[0], st2_04[2], st2_07[1], st2_10[2], st2_11[0], st2_07[7]
```

#### Another two mis-namings corrected

Opcodes `0x28`/`0x29` were in the table as `bgm_restore`/`bgm_set`. They are
`region_load`/`region_enter`. That is the **third** pair of opcodes this project
named from neighbouring addresses and got wrong (after `0x52`/`0x53`). The
lesson is now Rule 1 corollary 5 in `method.md`; it keeps being earned.

#### How it was found

Followed the plan recorded last session rather than searching data again: every
geometry load must pass `FUN_0041D5D0`, whose callers are a closed set of 12.
`FUN_00401510` was the second one read. Total cost: two decompilations.

The two earlier data-first attempts at this question — a u16 scan for stage
tables, and the `0x004E7C90` group table — had consumed far more effort and
produced one confident wrong answer.

#### Validation

The region table's length is not stored; it ends where the next scene's begins.
Bounded that way the counts are 13/59/26/39/10/14 for stages 1-6, and **the
largest region id any script passes to `0x28`/`0x29` is exactly `count - 1` for
every stage**, no operand out of range. Six independent exact fits.

Then the check the user predicted. Spawn positions against the geometry
bounding box:

```
stage 3   glob 77 %   ->   region set 100 %
stage 2   512/513     ->   513/513
stage 4   199/201     ->   201/201
```

Stage 3's long-standing 77 % was exactly what was diagnosed: the glob missing
`st3.bin`. All six stages are now 100 %.

Stage 6 initially *regressed* to 85 % on the region set alone, which turned out
to be informative rather than a bug: stage 6 loads `st5_01/01b/02/02b` through
the event script's `0x50` slot loads, not through its regions. So the correct
rule is **regions ∪ opcode-0x50 slots**; whole-file `0x52` loads are excluded
because those are spawnable actors, not placed scenery.

#### Exporter

`export_level.py --stage N` now uses the region tables. `--glob-geometry` keeps
the old behaviour for comparison. Every model node carries
`extras.hod2_regions`; a `<stage>_regions.json` sidecar lists each region's
contents, which is what makes the overlapping geometry intelligible in Blender.

Also fixed a false positive I introduced last session: `blender_check.py`
counted the camera rails as geometry and failed on "34 objects without UVs".
Rails are edge-only `LINE_STRIP` meshes with no UVs by design; they are now
excluded. Verified the 34 were all rails before changing the check.

#### Named in Ghidra

`RegionLoadDelta`, `RegionUnloadDelta`, `RegionDrawResidentSet`,
`RegionBindSceneTables`, `RegionInit`, `EvtOpRegionEnter29`,
`EvtOpRegionLoad28`, `AssetDrawSlot`, `AssetGetBoundingSphere`,
`CheckSphereInFrustum` — plus the 15 from the previous addendum.
`ApplyKnownTables.java` now carries a FIXED list of these core routines so a
fresh import reproduces them.

#### Next

1. `draw_mode` — the second `s16` of a region id entry. Values 0/1/2 select
   different paths in `RegionDrawResidentSet`; only mode 0 is understood.
2. The mode-1 region tables at `0x00576A8C`/`0x00576ABC` — a second full set,
   presumably the alternate game mode. Unexamined.
3. Region → camera path correlation: both are now recoverable, so the intended
   view for any point in a stage can be reconstructed. That would settle
   question 13 (whether collapsed-UV faces are ever on screen).

### Addendum 5 — `draw_mode` solved: it is a lighting selector

The second `s16` of a region id entry. Three values, distribution across all
scenes: **470 mode 0, 90 mode 1, 4 mode 2**.

#### Mode 1 — scene light array

`RegionDrawResidentSet` sends mode-1 entries through a different submit routine
when the opcode-`0x14` toggle `DAT_009A2BB4` is set. The two submit routines are
**identical except for one field**:

```c
RenderSubmitModelDefaultLight:  cmd.flags = 0
RenderSubmitModelSceneLights:   cmd.flags = 0x04000000
```

`RenderEnqueueCommand` tests that bit and swaps the D3D7 lighting setup:

```c
if ((flags ^ prev) & 0x0C000000)
    (flags & 0x04000000) ? SetLightingSceneArray()      /* up to 16 lights */
                         : SetLightingDefaultSingle();  /* one directional */
```

The identification is anchored on a measurement rather than a guess: the light
array at `0x007E7AA8` has a stride of `0x1A` dwords = **104 bytes**, which is
exactly `sizeof(D3DLIGHT7)`, and the enable loop runs 0–15. That fixes the
device vtable offsets `+0x48 SetLight`, `+0x50 SetRenderState`,
`+0xB0 LightEnable`, and `0x8B` = `D3DRENDERSTATE_AMBIENT`.

Opcode `0x14` — previously `set_g_2bb4` — is `set_scene_lighting`, operand 0/1
(19 zeros, 39 ones across the corpus). So the script turns the richer lighting
on and off, and region entries opt in per model.

#### Mode 2 — draw layer

`SetDrawLayerNibble(n)` stores `n & 0xF`; `RenderEnqueueCommand` ORs it into the
command header. `RenderInitStates` sets the default to **8**, and mode 2
brackets the draw with 7 then 8 — an *earlier* layer. Only four entries in the
game use it, all stage 1.

#### Not claimed

The other render-state numbers in `RenderInitStates` are left unmapped. They
need the DX7 GDT, which is still the deferred Phase 1 item. Guessing enum names
from memory is exactly the failure mode `method.md` warns about.

#### Exported

`extras.hod2_draw_mode` on every model node. Stage 2: 108 mode-0, 9 mode-1
(`st2_13[0..3]`, `st2_12[0..1]`, `st2_06[3..4]`, `st2_02b[1]`), no mode-2.

#### Note on the naming gate

The MCP rejected `AssetDrawSlotSceneLights` and `AssetDrawSlotLitByScene` as
token-subset collisions with `AssetDrawSlot` — correctly. Both differ from the
existing name only by appended tokens, which hides *why* they differ. Settled on
`SubmitSlotWithSceneLightArray`.

#### Next

1. Mode-1 region tables at `0x00576A8C`/`0x00576ABC` — a complete second set for
   game mode 1, still unexamined.
2. Import the DX7 GDT and map the render states in `RenderInitStates`; that
   feeds Phase 5 directly.
3. Region → camera path correlation, to reconstruct the intended view.

### Addendum 6 — DX7 SDK imported; three inferences confirmed, Phase 1 item closed

The user supplied `dx7sdk-7001.exe`. It is a WinZip self-extractor, so `7z x`
works on macOS; only `include/*.h` is needed.

The SDK headers cannot be committed (Microsoft licensing) and cannot be fed to
Ghidra directly either — they pull in `windows.h`, COM macros and packing
pragmas the CParser rejects. `tools/dx7_types.py` extracts a self-contained
subset instead. **The script is the committed artefact**; its output lands in
the gitignored `extract/`.

#### The inferences held

Last session I claimed three vtable offsets and a struct size from indirect
evidence — the 0–15 enable loop and an array stride. All four now check out
against the authoritative header:

| Claim | Basis last session | SDK |
|---|---|---|
| `+0x48` `SetLight` | position in the call sequence | confirmed |
| `+0x50` `SetRenderState` | (state, value) call shape | confirmed |
| `+0xB0` `LightEnable` | 0..15 loop | confirmed |
| `sizeof(D3DLIGHT7)` = 104 | measured array stride `0x1A` dwords | Ghidra reports **104** |

Worth noting because the inference was sound *and* cheap; the headers upgraded
it from "strong" to "proved" rather than overturning it. That is the right
outcome for the method rule — infer from code, then confirm when the
authority becomes available.

`IID_IDirect3DDevice7` is **not** in the binary, which initially looked like a
contradiction of the README. It is not: DX7 obtains a device by passing a
device-*type* GUID to `CreateDevice`. Checking every `DEFINE_GUID` in the SDK
against `.rdata` found seven present — the four the README lists, plus
`IID_IDirectDraw7`, `IID_IDirect3DRefDevice`, `IID_IDirect3DNullDevice`.

#### Phase 5 payoff: the global device state

`RenderInitStates` decodes completely now. Three results change how materials
should be exported:

1. **`CULLMODE` is `D3DCULL_NONE` globally.** Backface culling is not a device
   state — it comes from the per-mesh NL1 `culling` field, which is exactly
   what Session 6 concluded empirically after getting the winding wrong twice.
2. **`COLORVERTEX` is off and all four material sources are
   `D3DMCS_MATERIAL`.** Vertex colour does not enter the lighting equation.
   The per-mesh base colour must be a *material* — which is why Session 8's fix
   worked.
3. **A global alpha test discards alpha-0 texels** (`ALPHAFUNC` =
   `D3DCMP_GREATEREQUAL`, `ALPHAREF` = 1). That is how the game gets
   punch-through behaviour without ever using the PowerVR2 punch-through list —
   and explains the standing observation in `materials.md` that *no mesh in the
   game sets punch-through*.

Two independent empirical findings from earlier sessions are now explained by
one register write each. That is the value of the headers.

#### In the program

`D3DRENDERSTATETYPE` (82 members), `D3DCMPFUNC`, `D3DCULL`, `D3DSHADEMODE`,
`D3DBLEND`, `D3DMATERIALCOLORSOURCE`, `D3DTEXTUREADDRESS`, plus `D3DLIGHT7`,
`D3DMATERIAL7`, `D3DMATRIX`, `D3DVECTOR`, `D3DCOLORVALUE`, `D3DVIEWPORT7`.

#### Next

`RenderEnqueueCommand`'s per-command state work is still unread — that is the
actual PVR2 → D3D7 translation Phase 5 wants, and the enums are now in place to
make it readable.

### Addendum 7 — the PVR2 → D3D7 translation, the project's stated Rosetta stone

`TranslatePvr2StateToD3D` (`0x004A7780`), reached from
`WalkMeshChainAndDraw` (`0x004A7EF0`) which is the NL1 mesh-chain walker.
Together they are the thing the README has claimed since Phase 0 exists: an
authoritative, complete PowerVR2 → Direct3D 7 mapping, so material behaviour
can be *recovered* rather than inferred.

It is now fully decoded, with all five lookup tables resolved against the SDK
headers imported last addendum. Full table in `formats/materials.md`; the
shape is:

```
isp_tsp  31-29 -> ZFUNC (table)          26 -> ZWRITEENABLE (inverted)
tsp      31-29 -> SRCBLEND (table)    28-26 -> DESTBLEND (table)
            23 -> FOGENABLE (inverted) 20-19 -> ALPHATESTENABLE
       16/18 -> ADDRESSU   15/17 -> ADDRESSV   14-13 -> MIN/MAGFILTER
          7-6 -> COLOROP / ALPHAOP
param_ctl  &3 -> CULLMODE (table)      &0x40 -> SHADEMODE      &8 -> list/strip
```

#### It confirmed one earlier finding and overturned two assumptions

**Confirmed.** The culling table is `NONE, NONE, CCW, CW`. Session 6 changed the
winding reversal from culling 2 to culling 3 on the strength of screenshots.
The binary agrees exactly. Good to have that closed from the code.

**Overturned 1 — texture shading.** `materials.md` described modes as
decal / modulate / decal-alpha / modulate-alpha, and the exporter withheld the
base colour under "decal". The port sets `COLOROP = D3DTOP_MODULATE`
**unconditionally** and varies only the alpha op. There is no decal path. 1,111
meshes were being exported with their baked lighting flattened to white.

Only mode 1 differs, taking `ALPHAOP = SELECTARG1` — texture alpha alone,
ignoring material alpha — and it is by far the most common (33,429 of 41,463).

**Overturned 2 — UV addressing.** The table is `WRAP, MIRROR, CLAMP, MIRROR`
indexed by `(clamp << 1) | flip`. Clamp *and* flip together gives **MIRROR**,
not clamp. `_wrap_mode` returned `CLAMP_TO_EDGE` whenever clamp was set. The
row is reachable — 157 mesh-axes on U, 90 on V — and this is a strong candidate
for the Session 9 loose end "60 meshes with a clamped axis and a UV span beyond
one tile", which is exactly what a wrongly-clamped mirror axis looks like.

#### A near miss worth recording

I first read the ADDRESSU/ADDRESSV bit extraction backwards and was about to
report that `nl1.py` had clamp and flip swapped. Recomputing the shifts on
paper — `((tsp >> 3) & 0x4000 | tsp & 0x8000) >> 14` puts **bit 15** at index
bit 1, not bit 0 — showed `nl1.py` was right all along.

Two bit-twiddling reads of the same expression, opposite conclusions. The one
that survived was the one done by substituting single-bit values and printing
the index. **Do the arithmetic, do not eyeball the shifts.**

#### Fixed

- `_wrap_mode`: clamp+flip → `MIRRORED_REPEAT`.
- `modulates_base_colour`: now documents that it is unconditionally true on
  this port, with the reason. Added `texture_alpha_only` for the mode-1 alpha
  behaviour.
- Exporter no longer withholds `baseColorFactor` for mode 0.

#### Named

`TranslatePvr2StateToD3D`, `WalkMeshChainAndDraw`, `DrawStripPrimitive`,
`BindTextureStage`.

#### Next

1. `WalkMeshChainAndDraw`'s per-vertex path (`FUN_004A59C0` / `FUN_004A5A40`)
   and the 16-bit UV branch — Phase 3's last open item, question 12. The mesh
   walker is the right place to find it: it already branches on
   `parameter_control` bits for list/strip.
2. Environment mapping, the last unticked Phase 5 line.
3. Re-measure the Session 9 stretched-face tail now that clamp+flip is right.

### Addendum 8 — the vertex path; a fix written, tested and rejected

Went after the 16-bit UV question (Phase 3, question 12) through the render
path, as planned. Did not solve it, but ruled out most of the search space and
found — then discarded — a plausible-looking change to the exporter.

#### The vertex submission format

`WalkMeshChainAndDraw` submits with

```c
DrawPrimitive(D3DPT_TRIANGLESTRIP, 0x112, verts, count, 0);
DrawPrimitive(D3DPT_TRIANGLELIST,  0x112, verts, count, 0);
```

FVF `0x112` = `XYZ | NORMAL | TEX1`: 8 dwords, UV at dwords 6–7. Exactly what
`_read_vertex()` already assumes, and the only format reaching the device.

**So there is no 16-bit UV path at draw time.** The walker's other vertex
stride — 2 dwords for a back-reference, 14 inline — sits behind
`global_flag & 0x10`, and **no model in the game sets that bit** (0 of 9,112).
Dead code.

That leaves a load-time conversion. `FUN_00419270` runs over every model after
load and does `*strip_ctrl ^= 1` — it toggles bit 0 of each strip control word,
which is what an expand-in-place would look like with the toggle as a "done"
marker. That is where to look next, not the renderer.

#### The fold: found, implemented, measured, rejected

The walker has a CPU-side UV fixup for mirrored axes:

```c
frac = u - trunc(u);
u    = (frac >= 0 ? 1.0 : -1.0) - frac;
```

It is **not** equivalent to hardware mirroring — that is a period-2 triangle
wave, so 4.7 maps to 0.7, while this always gives `1 - frac` and maps it to
0.3. They agree only for odd positive tile indices. It looked like a real
divergence worth reproducing: 2,328 stage meshes, 107,275 vertices.

I implemented it and made it the default. Then checked it.

**It is visibly wrong.** Rendering stage 2 through `cp_st2_50_cam` strips the
stonework off the canal wall — a triangle straddling a tile boundary has both
ends folded to the same coordinate. Collapsed-UV drops rose 6,036 → 6,899.

Re-reading the guard explains it: the fold only runs when
`(DAT_007DE6B0 & 2) == 0`. When that capability bit *is* set the game plain-copies
and lets the address mode do the work. **It is a fallback for devices without
`D3DTADDRESS_MIRROR`**, not the normal path. Exporting to a target that mirrors
correctly must not apply it.

Now `--fold-mirror-uv`, off by default, kept and documented because it is a
real reachable path and reproducing one machine's output may matter later.

#### The lesson, and it is a new one

Mean luminance was **0.3194 raw vs 0.3193 folded**. Every numeric check I had
would have passed this change. The corpus statistics were fine, the Blender
import check was fine, the triangle count moved in a direction I had a story
for. Only looking at the two images side by side showed the wall had gone flat.

`method.md` Rule 3 says to pick a metric that collapses when the interpretation
is wrong. For *geometry and parsing* that works — byte coverage, decode errors.
**For appearance there is no such metric, and I should stop pretending
otherwise.** Added as a corollary: a change that alters what pixels are
sampled gets a before/after render through a game camera, compared visually,
before it is committed as default.

Also worth stating plainly: I had already written the change in as the default
and moved on to documenting it. The check happened only because the
collapsed-UV count moved and I chased it. That is luck, not process.

#### Next

1. `FUN_00419270` and its caller — the load-time strip fixup, best remaining
   lead on 16-bit UVs.
2. Environment mapping, the last unticked Phase 5 line.
3. The mode-1 region tables at `0x00576A8C`.

---

## Session 13 — the mesh path, end to end; and a stretched-face bug that was real

Three things were on the list: `FUN_00419270`, environment mapping, and the
mode-1 region tables at `0x00576A8C`. All three are closed. A fourth problem
turned up on the way and mattered more than any of them.

Screenshots for everything below were written to
`extract/compare/session13/`. `extract/` is gitignored — they are derived from
game assets and are not committed — so regenerate them with the commands in
each section if you need them again.

### 1. `FUN_00419270` is not a 16-bit-UV conversion — and there is no 16-bit UV

The lead was that it "toggles bit 0 of every strip control word", which looked
like an expand-in-place with the toggle as a done-marker. It is not. Read
properly it is:

```c
ModelFlipStripCullingParity(model)   /* 0x00419270 */
    *strip_ctrl ^= 1;                /* culling 2 <-> 3, 0 <-> 1 */
```

Bit 0 of a *strip* control word is the low bit of the 2-bit culling field, so
this flips backface↔frontface culling. Its only caller is `AssetLoadTexBankStep`
(`0x00418A00`, entry 1 of the job sub-step table), and it runs **only for the
four asset slots listed at `0x0057A280`** — `0x17A0, 0x17A1, 0x18A3, 0x18A5`.
Its sibling `ModelForceFogControlNone` (`0x00419300`) forces those same models'
fog control to *none*. Two per-asset content patches, not a load step.

**But the function answers the actual question by accident**, because it is the
canonical statement of the NL1 chain walk. Three rules and nothing else:

```
bit 31 set   -> mesh header, 0x50 bytes, skip geometry by (mesh_data_size & ~3)
bit 31 clear -> strip header {flags,count}, 8 bytes; count*3 when flags & 8
vertex       -> 32 bytes when bit 0 of its first dword is set, else 8 (back-ref)
```

No `parameter_control`, no shading mode, no 16-bit-UV flag. `WalkMeshChainAndDraw`
uses exactly the same rules.

`tools/verify_walk.py` replays that walk over the whole corpus:

```
models walked : 9112
  meshes  41463   strips 278807   vertices 1488301   back-references 447930
clean: the binary's walk lands exactly on every declared mesh end
```

Zero desyncs. A wrong stride desynchronises immediately, so this settles it.

Then the correlation that closes question 12 outright:

| | meshes | `texture_id` |
|---|---|---|
| `parameter_control` bit 0 clear | 40,560 | all `>= 0` |
| `parameter_control` bit 0 set | **903** | **all `-1`** |

Perfect 1:1 with *untextured*. `isp_tsp` bit 22 agrees on all 41,463. Every one
of the 33,875 vertices in those meshes has `u == v == 0`. **So the bit marks a
mesh with no texture coordinates, `_read_vertex` was right all along, and the
"128 affected stage meshes" alarm was a false one.**

Two more results fall out and are now documented in `nl1.md`: the back-reference
test is `(word0 & 1) == 0` (the addon's `(w >> 20) == 0x5FF` agrees on all
447,930 but is not what the binary does), and `mesh_data_size` is masked to a
4-byte boundary by both walkers.

#### The bit was hiding a real bug in the exporter

An untextured mesh has all-zero UVs, so **every** triangle in it has zero UV
area, and `drop_collapsed_uv_triangles()` — on by default — deleted the whole
mesh. Stage 2 was losing 811 triangles and **43 entire materials**: flat-black
shadow panels, dark window recesses, wall inserts. Fixed with an early return
for `texture_id < 0`. Stage 2 went 94,875 → 97,029 triangles, 2,179 → 2,222
materials.

Before/after through `cp_st2_35_cam`: the restored black panels correctly
occlude bright fixtures that were showing through the wall
(`03_untextured_before.png` / `04_untextured_after.png`).

### 2. Environment mapping: proved absent, not merely unfound

263 models set `globalFlag` bit 2 and 2,976 strips set strip-flag bit 8. The
port reads neither. This is a closed set rather than a failure to find:

- `SetTextureStageState` (`dev+0x94`) has exactly **three** call sites in the
  whole binary. Between them they set `COLOROP`, `COLORARG1/2`, `ALPHAOP`,
  `ALPHAARG1/2`, `ADDRESSU`, `ADDRESSV`, `MAGFILTER`, `MINFILTER`, `MIPFILTER`
  — and nothing else. **`TEXCOORDINDEX` (11) and `TEXTURETRANSFORMFLAGS` (24)
  are never set**, so texgen keeps its defaults: coordinate set 0 straight from
  the vertex, no transform. Neither DX7 texgen selector constant (`0x20000`,
  `0x30000`) appears anywhere in `.text`.
- No UV is ever computed. The walker hands D3D a pointer into the model file,
  or copies 8 dwords per vertex unchanged.
- Stage 1 is disabled at init and never re-enabled, so there is nowhere for a
  reflection map to live.

Two corrections to `materials.md` came out of the same read:

- **Shade mode is per *strip*, from strip flag bit 6** — not
  `parameter_control & 0x40`. `TranslatePvr2StateToD3D` never reads
  `parameter_control` at all.
- **Opaque and translucent are two passes over the same chain**, selected by
  `(tsp & 0x180000) != 0x80000`.

Strip flags measured over all 278,807 strips: bit 2 (sprite/quad) is set on
65,494 and **never tested by this port**; bit 5 (super index) on 153,889, and
zero back-references occur outside a bit-5 strip; bit 7 (reuse previous state)
on 225,744, and its inherited culling/shade mode is **always identical** to the
strip's own bits, so reading them per strip is safe here.

### 3. Mode-1 region tables = Original Mode

`RegionBindSceneTables` selects the `0x00576A8C`/`0x00576ABC` pair when
`g_GameMode` (`0x009CA08C`) is 1. Diffing the tables:

- the **region tables are the same pointers** in both modes on all 12 scenes;
- five scenes get a different **id table**, differing in 2, 2, 2, 9 and 1
  entries respectively;
- what changes is which asset slot an id resolves to, and the substitutes are
  `st_org00`–`st_org03` — *stage, original mode* — plus alternate `st1_*`
  entries on stage 1. `draw_mode` is preserved every time.

Cross-checks: every substituted model's bounding box lies strictly inside its
stage's mode-0 bounding box; `FUN_004040A0` appends slot `0x16` to every scene
slot only when `g_GameMode == 1`; and `pol/` carries a whole `_org` family.

Exported with `export_level.py --original`.

### 4. The one that mattered: stretched faces were a texture/sampler bug

Reported by the user against a stage-2 screenshot: faces on the left of the
canal view "completely stretched". They were.

The path there is worth recording because most of it was wasted:

- Probed the pixels by eye, got faces with anisotropy 1.0–1.8 and clean UVs,
  and concluded the mapping was fine. Wrong location — reading pixel
  coordinates off a screenshot by eye is guesswork. Wrote
  `tools/blender_probe.py` (raycast a pixel; `--sweep` ranks a frame) to stop
  doing that.
- `--uv-check` showed the checkerboard degenerating into 1-D bands on exactly
  those faces, which is equally consistent with degenerate UVs *and* with a
  clamped axis. Spent a long time on the first.
- Dumped the worst meshes: mostly 4-vertex strips of two coincident vertex
  pairs — authored 0.1-unit rim polygons, sub-pixel, harmless.
- **Then turned one thing off.** Forcing every sampler to `REPEAT` and
  re-rendering made the plinths render as carved marble with gold panels
  (`07_zoom_all_repeat.png`). Isolating further: CLAMP was the cause,
  MIRROR was not.

The bug: **in glTF a `texture` is an (image, sampler) pair**, and the exporter
cached textures on the decoded image alone, then stamped
`textures[i]["sampler"]` as each material was written. Last writer wins. One
mesh with a clamped axis retroactively clamped every other mesh in the segment
sharing that image, smearing a single row or column of texels across whole
walls. Stage 2 had 2,176 textured materials over 1,241 textures.

Fixed by splitting the caches — images on `(part, tex_id, opaque)`, textures on
`(image, sampler)`. Stage 2 now emits 1,754 textures over the same 1,241 images
and **2,176 / 2,176 materials carry the addressing their own `tsp_instruction`
demands**, asserted directly against `extras.pvr2.clamp_uv` / `flip_uv`.

#### And a second cause, in the check itself

After the fix one block was still streaked and one face had gone solid black.
Dumping Blender's imported node graph explained it:

```
st2_14_tex10_lambert       extension=REPEAT      (plain wrap -- correct)
st2_14_tex10_lambert.001   extension=EXTEND  + Math/SeparateXYZ/CombineXYZ
st2_14_tex18_lambert       extension=EXTEND  + Math/SeparateXYZ/CombineXYZ
```

Blender's glTF importer cannot express two different wrap modes on an Image
Texture node, so it sets `extension = EXTEND` and emulates the real mode with
shader nodes. **Workbench does not evaluate shader nodes.** So under Workbench
every material with a clamped *or mirrored* axis renders clamped on **both**
axes — the exact same streaks, plus solid black wherever UVs run negative.

`blender_camview.py` defaulted to Workbench. The diagnostic was manufacturing
the artifact it was being used to diagnose. It now defaults to EEVEE for unlit
exports; `11_zoom_eevee_correct.png` is the same crop rendered correctly.

Two corollaries added to `method.md`: *the renderer you check with is part of
the experiment*, and *bisect the pipeline, don't stare* — turning one feature
off found in one step what an hour of probing correct UV values did not.

### Named this session

`ModelFlipStripCullingParity`, `ModelForceFogControlNone`,
`AssetLoadTexBankStep`, `BindModelTextureHandles`, `DrawTriangleListPrimitive`,
`DrawSpriteQuadCommand`, `RenderFlushCommandList`, `MatrixStackPush`,
`MatrixStackPop`, `InitD3DDeviceAndTextureStages`, plus the five translation
lookup tables, `g_game_mode`, `g_matrix_stack_top` and
`g_model_fixup_slot_list`. `AssetLoadTexBankStep` had no function body — the
job sub-step table at `0x0057A29C` had not been fed to Ghidra.

Also decoded: the **draw command** is 0x1D dwords, `+0x0C` model pointer and
`+0x34` a 4×4 world matrix from a matrix stack at `0x007E7990`.
`RegionDrawResidentSet` brackets each slot draw with a push/pop that modifies
nothing, so **region scenery carries no per-model transform** — exporting raw
vertices is correct, now proved rather than assumed.

### Next

1. `mot/` — rigid transforms vs vertex morphs. The last unsolved format, and
   the draw command's world matrix is now understood, which is where per-object
   animation would land.
2. `coli/` — record layout and hit-test semantics.
3. Re-measure the collapsed-UV tail now that untextured meshes are exempt and
   samplers are right. 4.9% of stage-2 triangles still go; the rim-polygon
   finding suggests a good fraction are authored and the filter could be
   narrowed to genuinely-degenerate cases.
4. The golden-file regression suite in `tests/`, still the one Phase 3 gap.

---

## Session 14 — the projection matrix, and the `evt` → `cam` link

Two questions: how the projection matrices are set up and where the FOV comes
from, and whether the `evt/` tables are actually fully understood. Both are now
answered, one completely and one honestly.

### 1. Field of view: 41.1°, and the 60° was a red herring

The first thing found was the wrong thing. `InitD3DDeviceAndTextureStages`
builds a perspective matrix from `DAT_00598778`, which reads **60.0 degrees**,
with aspect 0.9, near 1.0, far 6000. That is exactly the placeholder the
exporter had been using, which made it look like a confirmation.

It is dead code. `DAT_007DE5C8` — the matrix it fills — has **one** xref, the
call that fills it. `DAT_00598778` has **one** read. The builder `0x004B73CC`
has one caller. Nothing hands any of it to the device. It is stock `d3du`
sample scaffolding that the port never removed.

The real projection is built through an **OpenGL-style matrix API** that had
not been recognised:

```c
SetMatrixMode(3);                                   /* PROJECTION */
MatrixLoadIdentity();
MatrixTranslate(g_screen_offset_x, g_screen_offset_y, 0);    /* both 0 */
BuildPerspectiveProjection(0x1D3B, 4.0f/3.0f, 0.8f, 8000.0f);
SetMatrixMode(1);                                   /* commits it */
```

`SetMatrixMode` (`0x004A9250`) is the trick: the projection is built on the
same matrix stack the renderer uses for world transforms, and installed on the
**3 → 1 transition**, which is the only `SetTransform(D3DTRANSFORMSTATE_PROJECTION)`
in the program. That is why searching for the projection by looking for
`SetTransform` sites found nothing interesting.

Ghidra's decompilation of `BuildPerspectiveProjection` had dropped an FPU
argument, showing `iVar1 = __ftol()` with no operand and making the angle look
like a full 41°. The disassembly has it:

```asm
FILD  [ESP+0x44]            ; fov_bams
FMUL  double [0x004C4C98]   ; * 0.5      <- the halving
CALL  __ftol
FILD  ...
FMUL  double [0x004C4370]   ; * 2*PI/65536
FCOS / FSIN / FDIVP         ; cot(half)
```

So the argument is the **full vertical FOV in BAMS**, halved with truncation:

```
0x1D3B = 7483   half = (int)3741.5 = 3741
fovY = 2 * 3741 * 2*PI/65536 = 0.7173277659 rad = 41.100 deg
fovX (4:3)                                      = 53.115 deg
```

`BuildPerspectiveProjection` has exactly two call sites —
`SetupSceneProjection` and `SetProjectionNearPlane(zn)` for HUD layers — and
**both pass `0x1D3B` and 4:3**. There is no zoom and no per-camera FOV.

**Cross-checked independently.** `SetupSceneProjection` also computes
`240.0 / tan(0.35866388296751145)` = 640.21, the projection distance in pixels
for a 480-tall viewport. `0.35866388296751145` is *bit for bit* equal to
`3741 * 2π/65536` — the compiler folded the same half-angle. Two constants
arrived at by different routes, one FOV.

Written into every exported glTF camera along with the real near/far
(0.8 / 8000) and 4:3 aspect. The framing is noticeably tighter and reads as an
arcade rail shot rather than a wide-angle one
(`extract/compare/session13/15_fov_41deg.png`).

Also mapped while in there: the whole matrix API (`MatrixLoadIdentity`,
`MatrixTranslate`, `MatrixRotateX/Y`, `MatrixMultiply`, push/pop, all angles
BAMS), and `DrawModelWithForcedAlphaBlend` (`0x004A8440`) — a second mesh
walker that rewrites each mesh's TSP to `(tsp & 0x03FFFF7F) | 0x94000080`
(forcing `SRC_ALPHA`/`INV_SRC_ALPHA`) and scales material alpha by the draw
command's `+0x10` word. That fills in the last unknown field of the draw
command: it is a per-command fade alpha.

### 2. Are the `evt` tables fully understood? Structurally yes, semantically no

Worth stating plainly, because the docs were overclaiming in one place and
underclaiming in another.

**Solid:** all 96 dispatch slots enumerated, 76 used, 5 stubs never reached,
operand length known for every opcode, 17,150 instructions decode with zero
errors. The container, fixups, routing graph, spawn descriptors and the asset
vocabulary are all recovered.

**Not solid:** ~30 opcodes are named only by the global they write, and 20.6%
of `evt/` bytes are still unattributed (90% of that being spawn behaviour
tails).

So I went after the biggest single gap — `queue_event`, opcode `0x30` — which
`evt.md` described as a two-level table naming "100+ scripted actions".

**It names ten.** The "100+" was an estimate from the size of the surrounding
region, never a count. The index table at `0x005776EC` has seven slots, four of
them null, and its sub-tables are laid out immediately *before* it:

```
group 1 @ 0x005776C4  6 handlers  selectors 0x10..0x15
group 2 @ 0x005776DC  2 handlers  0x20..0x21
group 4 @ 0x005776E4  1 handler   0x40
group 6 @ 0x005776E8  1 handler   0x60
```

The high nibble is *both* the group index and the operand count, which is why
the instruction length is `2 + (selector >> 4)` — the groups are organised by
arity. All ten are now named and tabulated in `evt.md`. Measured across stages
1–6, the only selectors that occur are exactly those ten minus `0x13`.

#### Selector `0x40` is the `evt` → `cam` link

Open since Session 11, and the previous guess (`0x18`/`0x19`) was wrong.

```
queue_event 0x40, start_frame, end_frame, path_index, flags
```

`EvtActionCamPlay40` → `CamStartPathPlayback` → `CamAdvancePathFrame`, which
calls `CamEvalPath7(g_active_cam_path, (float)frame, &eye, &lookat, &roll, &_)`
once per frame and increments until it passes `end_frame`. `start_frame == -1`
resumes rather than seeks; `start_frame == end_frame` takes the
`CamEvalStaticPose` branch and holds a pose.

**`path_index` is global across every `cam/` file**, not per-file.
`DAT_004C479C` is one byte per global path giving its owning file, with one
contiguous run per file, `cp_*` first then `op_*`.

Two metrics that collapse:

- 23 `cam/` files, 418 paths total, and the table resolves to **23 distinct
  file ids with no id repeated** — every run length equals a real file's path
  count.
- **751 / 751** selector-`0x40` instructions in stages 1–6 name a path inside
  their own stage's range. With 418 paths in the global space and a stage
  owning 14–66 of them, a wrong operand order scatters immediately.

`tools/verify_evt_cam.py`.

#### A bug worth recording

The first version of that verifier read a fixed 512 bytes of `DAT_004C479C`.
The table is 418 bytes with no terminator, so the slop past its end produced
extra runs that reused the same small file ids and silently overwrote every
base — reporting 0/751 and six one-path stages. The fix is to derive the length
from the corpus (total paths across all `cam/` files) rather than guess it.

Same shape as `_region_table_bounds` in `exetab.py`: **these tables end where
something else begins, and nothing marks it.** Worth assuming by default in
this binary.

### Named this session

`BuildPerspectiveProjection`, `SetupSceneProjection`, `SetProjectionNearPlane`,
`SetMatrixMode`, `MatrixLoadIdentity`, `MatrixTranslate`, `MatrixRotateX`,
`MatrixRotateY`, `MatrixMultiply`, `DrawModelWithForcedAlphaBlend`,
`EvtEnterSceneState`, `CamStartPathPlayback`, `CamAdvancePathFrame`, and the
ten `EvtAction*` handlers. Labels for `g_matrix_mode`,
`g_projection_matrix_cache`, `g_identity_matrix`, `g_projection_distance_px`,
`g_screen_offset_x/y`, `g_active_cam_path`, `g_evt_action_operands`,
`g_evt_action_table`, `g_scene_state_table`, `g_camera_preset_table`,
`g_cam_path_file_id`, and the two dead `d3du` globals, flagged as dead.

`EvtActionSetContinuation13` had no function body — nothing references it
except the action table, which had not been fed to Ghidra.

### Next

1. `mot/` — rigid transforms vs vertex morphs. The last unsolved format, and
   the draw command's world matrix is now understood, which is where per-object
   animation has to land.
2. `coli/` — record layout and hit-test semantics.
3. The ~28 remaining `evt` opcodes named only by the global they write. The
   scene state machine at `0x00576C14` (2-D, 9 columns) is the next free
   function inventory and should name a lot of them at once.
4. Spawn behaviour tails — 90% of the uncovered `evt/` bytes; the class table
   is the way in.

---

## Session 15 — the scene state machine, and semantics for the whole opcode set

Two tasks: decode the state machine at `0x00576C14`, and give the ~30 opcodes
that were named only by the global they write an actual meaning. The second was
fanned out to four parallel agents, read-only in Ghidra, with the parent doing
all the writes.

### 1. The state machine is a table of behaviour installers — and a trap

`EvtEnterSceneState(major, minor)` jumps into `table[major*9 + minor]`. The `*9`
came from the disassembly (`LEA ECX,[ECX+EAX*8]; ADD EAX,ECX`), not the
decompiler.

A cell installs hooks rather than doing work: the camera update
(`g_camera_update_hook`, run each frame by `CameraUpdateTick`) and two
per-player routine pointers, one of which `queue_event` selector `0x12` can
also overwrite from script.

**The unused cells are `while(1);`.** An invalid transition deliberately locks
the game up, which turns the live-cell set into a hard statement rather than an
inference. Six state handlers had no function body at all — nothing references
them but this table.

Rows 0–2 are the camera modes: follow the player midpoint, build the pose from
the view struct, snap to the `cam/` path eye, path plus a 30-frame decaying
impulse shake, and two variants that play a *deferred* path.

That last pair closes a loop with Session 14. States (2,6) and (2,7) call
`CamEvalPath7` themselves, stepping `g_stashed_path_frame` toward
`g_stashed_path_end_frame` — exactly the globals `EvtActionCamPlay40`'s
`flags & 2` branch stashes. A deferred camera play is a two-instruction idiom:

```
queue_event 0x40, start, end, path, 2     ; stash
queue_event 0x21, 6 (or 7)                ; enter the state that plays it
```

Three measurements, all in `verify_evt_cam.py`: selector `0x21`'s 418 operands
are only 4, 6 and 7 (row 2's live set is `{4,5,6,7}`); `0x11`'s are 1 and 3
(row 1's is `{1,2,3}`); and **196/196** deferred plays are followed within three
queued actions by a transition to state 6 or 7. A wrong row width would drop
these onto the hang loop.

### 2. Opcode semantics, four agents in parallel

Each agent got a cluster, the handler addresses, this project's method rules,
and an explicit instruction to mark every claim `[proved]` / `[likely]` /
`[open]` and to say plainly when it could not tell. All four did. The full
table now lives in `formats/evt.md`; the highlights:

**Environment.** `0x15` puts one `D3DLIGHT7` **spotlight per entity** into a
16-slot array; `0x16` is the **ambient colour** (its old name `set_fog_or_clear3`
was wrong — nothing on that path touches fog); `0x1A` is the **ground plane**,
both the fallback for a missed downward raycast and the plane blob shadows
project onto; `0x1B`/`0x1C` drive a camera-following backdrop dome from a
12-entry table; `0x1D` is rain; `0x1F` is a 9-state HUD shutter that also gates
firing and ammo.

**Camera.** `0x35` gates `CamEvalPath7`'s **7th curve channel** — roll exists in
every `cp_` path but is only honoured when the script asks. `0x36` pins the view
Y to the ground plane. `0x37` bypasses the "room cleared" gate on path advance.

**Waits.** All eight decoded. `0x41` waits on a camera path frame (operand 0 =
end of path). `0x43` and `0x44` watch **two different enemy counters** —
`0x009C904A` drops at kill time, `0x009C7006` at death-animation end, so
`present >= alive`. `0x45`/`0x48` are the reader and writer halves of a
256-byte script flag array. `0x42`'s countdown can be **clamped downward** by an
external wave-pacing routine, shortening a wait already in progress.

**Assets and sound.** `0x58`/`0x59`/`0x5A` drain the asset job ring: all jobs,
only `tex\`+`pol\`, or only `mot\`. `0x5D`/`0x5E` are `OutputDebugStringA`
stubs — NAOMI sound-driver calls the PC port replaced with individual `.wav`
streaming. `0x5F` consumes four operands and uses **only the third**.

**Scoring.** `0x2B` is the end-of-stage accuracy bonus: `hits*100/shots`,
indexed into `{0,0,0,0,500,1000,1500,2000,2500,3000,4000}`. `0x2F` suppresses
the counters it grades.

#### Four corrections to previously documented claims

1. **`0x20`–`0x27` are fog and light tweens, not view tweens.** `DAT_009A3540`
   and `DAT_009A59E0` are the two **scene light/fog blocks**, not per-player
   view structs. I verified the renderer end myself before overturning it:
   `FUN_004AA0E0` writes `g_render_light_dir_*`, `FUN_004AA0A0` the light
   colour, `FUN_004AA070` the ambient — and those are read by the already-named
   `SetLightingDefaultSingle` and `RenderSubmitModel*Light`. The tween's ten
   channels are fog near/far, fog RGB, light RGB and ambient.
2. **The draw command's `+0x14` and `+0x28` fields** were labelled
   "fog/ambient parameters" and "fog colour" last session. They are the light
   colour + ambient and the (negated) light direction. Corrected in
   `pipeline.md`.
3. **`0x10`/`0x11` carry relocated absolute pointers to collision-mesh blobs**,
   not id lists — legal because `EvtRelocatePointers` has already rewritten
   them. List A is consulted by both ray and sphere queries, list B by rays
   only.
4. **`0x0E`/`0x0F`/`0x12` are the enemy approach-distance pacing table**, not
   spawn ids. `0x0E`'s operands are floats — the ROM defaults decode as
   `{25,38,51}`, which as integers would be `0x41C80000`.

#### The skip feature is dead code

`DAT_009A2D74` is never written with a non-zero value anywhere in the binary
(14 references: 12 reads, 2 writes, both storing 0). Same for `DAT_009A2230`
and `DAT_009A1A18`. So every `if (skip_flag)` branch in this opcode family is
unreachable, opcode `0x2E` is a no-op, and `0x2C` registers its request into a
variable nothing reads. Worth knowing before anyone tries to implement it.

Also: `0x3F`, `0x5B` and `0x5C` share **one** handler that is opcode-blind
(`ADD [pc],4; RET`), so they are three identical retired no-ops, and `0x1E`
writes a global with **no readers anywhere** — vestigial and unrecoverable.

### A methodological note worth keeping

One agent hit a **false `READ` xref**: `get_xrefs_to` reported `FUN_00429680`
reading `DAT_009C8D4C`, but disassembling it showed a `REP MOVSD` whose operands
Ghidra had mis-attributed. Cross-check any single-xref conclusion with
`search_instructions` or the disassembly before naming from it.

### Process notes

Two mistakes of my own, both caught and fixed:

- `git add -A` swept the peer session's in-progress library split
  (`hod2lib/campaths.py`, `script.py`, `stage.py`, `PLAYER_PLAN.md`) into my
  commits — twice. Both were split back out with a soft reset. **Stage explicit
  paths in this repo; another workstream is live in the same tree.**
- Ghidra's inline-script tool is disabled here (`GHIDRA_MCP_ALLOW_SCRIPTS`), so
  ~50 renames had to go one call at a time. The high-value alternative is a
  single plate comment carrying the whole table, which is what
  `EvtInterpreterLoop` now has.

`tools/hod2lib/evt.py`'s `OPCODES` dict still carries the old placeholder names.
It was deliberately left alone — the Python is being restructured in a parallel
workstream. `formats/evt.md` is the authoritative list until that lands.

### Next

1. `mot/` and `coli/` — the last two unsolved formats. `coli/` just got a large
   push: the blob layout is now known from `FUN_004AAA40`
   (`[group_count][per group: quad_count, AABB, quads of {plane, axis tag,
   4 verts, surface flag}]`), and opcodes `0x10`/`0x11` say how a scene selects
   its sets.
2. The spawn behaviour tails — still 90% of the uncovered `evt/` bytes.
3. Fold the opcode names into `hod2lib/evt.py` once the library split lands.

---

## Session 16 — `coli/` solved, and the opcode names folded into the library

### 1. `hod2lib/evt.py`

The `OPCODES` table now carries the recovered names instead of the placeholders
that described a handler by the global it wrote. **Renames only** — every
operand size was already correct, independently validated by the 17,150
instructions that decode with zero errors, and the agents' measured sizes
agreed with the table on every row I checked. Added `QUEUE_ACTIONS`, the ten
`queue_event` selectors, which a timeline dump needs.

`dump_stage_script.py` now reads semantically, and the output contains its own
confirmation:

```
0001DC  30 queue_event   00000040 00000000 00000000 00000037 00000000
```

`0x37` = 55, and 55 is exactly `cp_st2`'s first global camera-path index.

### 2. `coli/` — solved

Rule 1 paid out immediately. `ColiSegmentVsMesh` (`0x004AAA40`) is the segment
test and states the entire format:

```
u32 group_count                       (always 1 in shipped data)
  u32 quad_count
  f32 aabb_max[3]                     <- MAX first
  f32 aabb_min[3]
    quad, 18 dwords:
      f32 nx, ny, nz, d               plane
      u32 axis                        dominant axis 0/1/2
      f32 v0[3] v1[3] v2[3] v3[3]
      u32 surface                     material id, the hit test's return value
```

Two details that would have been very hard to guess and are obvious from the
code:

- **The AABB is stored max-then-min.** The reject test reads
  `seg_min.x <= box[1] && … && box[4] <= seg_max.x`. Reading it the natural way
  gives an inverted box that rejects everything. This is also visible in the
  old stub of `coli.md`, which had recorded the first six floats of `coli2.bin`
  and noted they looked like a normal — they were the AABB, upside down.
- **`axis` is an integer in a float slot.** The decompiler compares it against
  `1.4013e-45` and `2.8026e-45`, which are the bit patterns of 1 and 2.

The format parsed **100.00 % of every loaded file on the first attempt** — 8
files, 126 groups, 2,516 quads, no slack anywhere.

#### Four checks, each of which collapses if the reading is wrong

| Check | Result |
|---|---|
| blob walk tiles each file exactly | 8/8 at 100.00 % |
| quad vertices inside their group's AABB | 0 of 10,064 outside |
| stored plane fits its own four vertices | p99 5.1e-03 |
| ‖normal‖ = 1 | worst 6.8e-07 |
| **evt `0x10`/`0x11` pointers land on a blob header** | **86/86** |

The last one is the strongest. A scene's collision file has only 3–48 valid
blob starts among tens of thousands of byte offsets, and every collision-set
pointer in every stage script hits one.

It also confirmed the loader arithmetic from the other direction. Operand
`0x0CECF000`, relocated by `-0x0C53E600`, is `0x00990A00` — exactly the address
`ColiLoadFileByIndex` computes for a non-zero index. The first attempt used
`ins.raw` unrelocated and scored 0/86, which is what a wrong answer looks like
here; applying the documented fixup took it straight to 86/86.

#### Which files a scene uses

`ColiLoadForScene` loads **two**: `coli0.bin` into a dedicated buffer for every
scene, and `coli<scene+1>.bin` into another. So `coli0` is a common set and
`coli1`–`coli6` are per-stage.

`coli.bin` is **not loaded at all** — absent from the filename table, 0x800
bytes of leading zeros, and it contains the other files at 0x800-aligned
offsets. A build artifact. Old open question 3 ("is `coli.bin` a concatenation
or a separate dataset?") is answered: neither, it is a memory image nobody
reads.

#### Surface ids

The hit test returns the quad's `surface` field, and the shipped data uses 13
distinct values. **5 and 55 are wet**, confirmed by two independent consumers:
the ground-impact effect swaps asset `0x46` for `0x61` plus two ripple calls
(the same effect the rain opcode selects), and a bouncing dropped object plays
a different impact sound. The rest are a material palette nothing read so far
distinguishes.

### Note on the parser's home

The parser lives in `tools/verify_coli.py` rather than `hod2lib/`, deliberately:
the library is being restructured in a parallel workstream and a new module
would collide. It is self-contained and should move into `hod2lib/coli.py` once
that lands.

### Next

1. `mot/` — the last unsolved format, and the only remaining Phase 6 item.
2. `coli/` export: the quads are directly renderable as a debug mesh, which
   would let collision be checked visually against the exported stage geometry
   — and would settle whether the surface palette lines up with visible
   materials.
3. `coli0.bin` is loaded for every scene but **no** script pointer references
   it. Find what installs it.

---

## Session 17 — objects: what is in a stage, and the routes they take

Asked for the objects' assets and paths, exported, and checked against the
event tables. Both halves are data the project already had but had never
connected.

### Object routes

`op_` paths were exported as **static green polylines only**. The reason was in
the exporter's own docstring: "op_ paths carry a BAMS Euler triple ... what the
three components actually mean is not settled, so no rotation is emitted".

It is settled now, from the draw chain every path-following object shares —
`FUN_0048E600` being the clearest:

```c
CamEvalObjectPath6(slot, frame, pose);
obj+0x40..0x48     = pose[0..2];     /* position            */
obj+0x64,0x68,0x6C = pose[3..5];     /* rot_x, rot_y, rot_z */
MatrixTranslate(pos); MatrixRotateZ(rz); MatrixRotateY(ry); MatrixRotateX(rx);
```

The missing piece was the matrix convention. `MatrixMultiply` computes
`top = top * M` over **column-major** storage — `new[0] = old[0]M[0] +
old[4]M[1] + old[8]M[2] + old[12]M[3]` is `row0(old)·col0(M)` — and
`MatrixTranslate` updates the translation *column*. That is `glMultMatrix` and
`glTranslatef` exactly, so the composite is `T·Rz·Ry·Rx` on column vectors and
`Rx` reaches the vertex first. As a quaternion, `qZ·qY·qX`.

Checked rather than asserted: the quaternion reproduces an explicitly built
`Rz·Ry·Rx` matrix to **4.4e-16** over a grid of angles. And the channels really
are BAMS — they span −71,867…+80,202 across the corpus, more than a full
65,536-unit turn, so they cannot be radians.

`_emit_paths` now emits an animated node per `op_` path alongside the rail.
Stage 1 gets 75.

### Binding an object to a route

An object names its route by the **global** path slot — the same index space
the cameras use, which last session's `DAT_004C479C` decode established.
`CamEvalObjectPath6` has 48 call sites in 31 functions; some take the slot from
the object, six pass a literal. All six land in `op_` files and none in a `cp_`
one.

`FUN_0048E600` is worth recording in full because it shows what a
path-following object actually *is*. It follows `op_st1` 0/1/2 (`0xFD`–`0xFF`),
**selected by which `cp_st1` path the camera is on** — the object route tracks
the camera route. Then it draws a rig by matrix chain: body, two occupants each
yawed by a per-object angle, parts pitched by a counter incremented `0x2000` a
frame, and wheels picked from a 12-frame cycle and mirrored on the left side.
The slots resolve to `car_pl.bin` and `char_adv00.bin` — the opening jeep.

So a path-following object is **not one model**. It is a hand-coded rig: a set
of asset slots with relative transforms baked into its draw routine. The
animated nodes are therefore emitted empty, and that limitation is recorded
rather than papered over.

### What is in a stage

The authoritative list is the event tables, not a guess about which models look
like enemies: every spawn descriptor the script reaches, with class, world
position, BAMS yaw and hit points. `<stage>_objects.json` now carries those
plus the routes.

`tools/verify_objects.py` checks both, with two metrics that collapse:

- **1546 / 1546** spawns across all six stages fall inside the bounding box of
  their own stage's geometry. A wrong descriptor stride scatters them at once.
  (The old figure was 1216/1216 over five stages; PROGRESS carried the stale
  one.)
- **35 distinct class ids used, all 35 defined** in the handler table at
  `0x00593358`. An undefined id dispatches to the empty stub, so this is a real
  check.

Plus: every exported `op_` slot resolves to its own stage's `op_` file, and the
six code literals resolve to `op_` files.

### Next

1. Reproduce a rig. `FUN_0048E600` is fully decoded — emitting its slot
   hierarchy as glTF child nodes would put the jeep on its route and prove the
   whole chain end to end.
2. The other 30 `CamEvalObjectPath6` callers: which spawn classes they belong
   to, and which take their slot from the object rather than a literal.
3. `mot/` — still the last unsolved format, and the obvious source of the
   per-object animation these rigs do by hand.

---

## Session — the browser stage player, and sound

**Outcome:** the player from [`../PLAYER_PLAN.md`](../PLAYER_PLAN.md) is built
and working (R0–W5; W6 deferred as planned). Running notes and the open list
live in [`../PLAYER_PROGRESS.md`](../PLAYER_PROGRESS.md); how to use it is in
[`../../web/README.md`](../../web/README.md).

The player turned out to be a good oracle for the RE. Several readings that
looked right on paper produced visibly wrong behaviour, and reading the
binary settled each one.

### Corrections to previously documented behaviour

**`EvtAdvanceBlockOrRoute` — three separate mistakes, all mine.**

1. **A block's steps run in sequence.** `end_block` (`0x4F`) increments the
   step index and runs the next step; only an *exhausted step table* reaches
   the route table. Treating every `end_block` as a block exit runs one step
   per block and skips most of a stage — including the `region_enter` and
   `cam_play` instructions that live in the later steps. This is what made
   region streaming and camera playback look broken.
2. **Route kind 2 is not "the scene ends".** It falls through to `block + 1`.
   The scene ends when the block it lands on is a hole, i.e. when
   `EvtGetBlock` returns -1.
3. **A branch takes `next[branch_choice]`**, not an arbitrary target.
   `branch_choice` (`DAT_009C88A4`) is reset to 0 at the tail of every block
   change and **every writer of it is gameplay code** — 25 xrefs, all in the
   entity/enemy handlers. With no gameplay a branch always takes `next[0]`.

**`FUN_0045EBC0` picks the scene's first step by game mode:** 1 for normal
Arcade play, **5** for Original Mode on scene 0, 0 only on the continue and
checkpoint paths.

**`queue_event` selector `0x21` is a camera *state selector*.** It is
`EvtEnterSceneState(2, minor)`, and row 2's live cells are 4
(`CameraSnapToPathEye`), 6 and 7 (the two routines that play a stashed path).
It does **not** "hand control back from a path", which an earlier note said.
Relatedly, **`cam_play` with `flags & 2` does not play** — it stashes the
frame range for a later `0x21, 6|7`. All 208 deferred plays follow that idiom.

### `0x60` is the arcade branch preview — [proved]

`EvtActionStoreSixOperands60` scatters the six operands and `FUN_00403DB0`
gathers them back as `frame = *(&DAT_009C6FE0 + choice*8)`,
`path = *(&DAT_009C6FDC + choice*8)` — three **`(frame, slot)`** pairs indexed
by `branch_choice`, the shot the arcade shows for each route. Note the order:
frame first. `PLAYER_PLAN.md` guessed `(slot, frame)` and had it backwards.
Written up in [`../formats/evt.md`](../formats/evt.md).

### Sound — solved, and a new format doc

[`../formats/sound.md`](../formats/sound.md). `PlaySoundId` (`0x0041CFD0`) is
the single entry point for every sound, dispatching on the **top nibble** of
the id: 0 SE, 1 BGM, 2 voice, 8 control (`0x80000000` stops). All three name
tables are now read by `hod2lib.exetab`:

| Table | Address | Entries | Bounded by |
|---|---|---|---|
| `g_bgm_names_ar` | `0x00580354` | 41 | the plain table immediately after it |
| `g_bgm_names_plain` | `0x005803F8` | 20 | — |
| `g_voice_records` | `0x0058044A` | 467 | the SE list two bytes past its end |
| `g_se_name_list` | `0x005845F8` | 324 | `id == 0xFFFF` |

**None of these tables stores its own count.** Three of the four are bounded
only by the table that follows them — the same pattern as the scene route and
region tables. Reading any of them with a guessed length invents entries.

**[measured]** 288/324 SE names resolve under `sound/SE/`; the 36 that do not
all end in `_OFF` and are not shipped. 463 of the non-empty voice names
resolve. Every non-null BGM name resolves. Match case-insensitively — the
tables spell `.WAV`, the files are `.wav`.

**`se_play` is not restricted to SE.** Its operand goes through the same
dispatcher, and across the six stage scripts it names 9 BGM tracks, 6 voice
lines and one stop as well as SE.

**[open] What starts a stage's own music.** No `bgm_entry_play` in any of the
six stage scripts names its stage track — they only switch to boss and
transition music. Recorded as open question 19 in
[`../PROGRESS.md`](../PROGRESS.md).

### Fog is per-mesh, and its values were already in the data

TSP bit 23 → `D3DRENDERSTATE_FOGENABLE`, **inverted**, so fog is on when the
bit is clear — which is what `ModelForceFogControlNone` exploits. Exposed as
`Mesh.fog_enabled` / `.fog_control` and in the glTF material extras;
2197/2219 stage-2 materials are fogged.

The colour and range are scene state, from the `0x20`–`0x27` light block.
Their operands are **pointers to float constants inside the evt file**, and
dereferencing them turns what the coverage analysis lists as 1,888 bytes of
unattributed residue into values: stage 2 block 3 opens with fog near 21, far
507, light RGB (1.0, 0.9, 0.77), ambient 0.5.

### A shipped-data defect: `cp_st1.bin`

119 keyframe words across `cp_st1`, `cp_demo` and `cp_title` decode to NaN or
~1e38, and `st1evtbl` plays the affected paths. Both retail copies checked are
byte-identical, so it is how the game ships. `hod2lib.cam` repairs and counts
them. Before that, **stage 1 could not be exported at all** — the glTF writer
died packing a non-finite float.

### Recorded but NOT applied: `eye.y = path.y - 15`

Every camera hook that plays a path contains
`eye.y = use_fixed_y ? fixed_eye_y : path.y - 15.0f`, unambiguously, in three
functions. Applying it to the `cp_` curve's eye Y is nevertheless wrong:
measured over all 201 camera paths in stages 1–6 it puts **173 of them looking
upward at their own aim point**, and on stage 2's opening path the eye lands
below the floor. The raw value agrees with the established-good oracle (the
exported glTF cameras, validated against the Venice plaza shot).

Something compensates for that line which has not been traced. The lead:
`CameraPathWithImpulseShake` reads eye **x/z** from `0x009A60C0` but eye **y**
from `0x009C70C4` — two different pose blocks. Reasoning and a switch to
re-enable it are in `web/src/campath.ts`.

Note also that `0x36`, which selects the fixed-height branch, occurs **zero**
times in any shipped script, so that half is unreachable from the data.

### Fog range is doubled, and the light setup is transcribed — [proved]

Two more findings from making the player's fog match the game, both now in
[`../formats/materials.md`](../formats/materials.md).

**`SetFogRange` (`0x004ABDF0`) doubles both values** before setting
`FOGSTART`/`FOGEND`, with a swap guard if they arrive the wrong way round.
The disassembly is unambiguous where the decompiler's FPU tracking is not. So
a script's `near 21, far 507` is really a **42 … 1014** ramp — using the raw
pair makes fog about twice as thick, which is exactly how the player looked
until this was read. `FOGSTART`/`FOGEND` also fix the model as
`D3DFOG_LINEAR`, a straight ramp rather than a curve.

**`SetLightingDefaultSingle` (`0x004AA120`)** is the whole default lighting
setup: `diffuse = colour × 1.4`, `specular = diffuse`,
`light.ambient = colour × 0.3`, plus `D3DRENDERSTATE_AMBIENT` from the block's
`+0x24C`, one directional light enabled and lights 1–15 disabled.
`BuildSceneLightDirection` (`0x0040E0B0`) makes the direction by rotating
`(0,0,1)` through `RotateY(yaw)` then `RotateX(pitch)`; those rotators
pre-multiply and the transform is row-vector, so pitch applies first and

    dir = ( cos(pitch)·sin(yaw), −sin(pitch), cos(pitch)·cos(yaw) )

`SetRenderLightDirection` negates it, so `dir` is where the light comes
**from**. The rotators multiply by `9.58738e-05` = 2π/65536, confirming BAMS.

Renamed in Ghidra: `SetFogRange`, `PushSceneFogFromLightBlock`,
`BuildSceneLightDirection`, `SetRenderLightDirection`, `SetRenderLightColour`,
`SetRenderAmbient`, plus seven labelled light-block globals.

### Next actions

1. Backdrop dome (`0x1B`/`0x1C`): the table at `0x00579968` is documented but
   not read; **the sky is currently missing** and is now the biggest visual
   gap in the player.
2. Trace what starts a stage's BGM (open question 19) — the scene-entry path,
   not an xref sweep over `PlaySoundId`'s 496 callers.
3. Trace `0x009A60C0` to settle the `path.y - 15` question (open question in
   `PLAYER_PROGRESS.md`).
4. `0x40C790`, the follow-on hook for deferred camera plays: settles whether
   state 6/7 shots are yaw-only.
5. The `0x21`/`0x23` tween stepping — the `{enabled, from, to, rate}` block is
   read but the per-frame step is not, so the player jumps to the target.

## Session 19 — the rest of the object rigs

Fanned out four read-only agents over the `CamEvalObjectPath6` callers. Eight
new transcriptions in `hod2lib/rigs.py`, a survey of all 31 in
[`rig-survey.md`](rig-survey.md), and three placement modes the one-rig version
could not express.

**The big structural finding.** A rig is not simply attached to a route. Draw
routines dispatch on `g_active_cam_path` through a jump table and select a
different `op_` slot per camera shot. Those camera ids turn out to share the
418-slot space with the object paths — every gate resolves to a `cp_` file,
every route to an `op_` file, and a gate always sits in the same stage file as
the route it selects. That makes the gate the per-stage binding: a stage owns a
rig iff it owns the camera path that selects it. `verify_objects.py` now
enforces all three halves.

**A transform I had wrong.** `st1_vehicle`'s `part_8cc` is
`RotX(-0x1C00) · RotZ(θ) · RotX(+0x1C00)` — a swing about a tilted axis, and
identity at θ=0. I had baked only the first `RotX`, leaving the part
permanently 39° off. Found by re-reading my own transcription, not by a check:
the bounding box and the render both looked fine with it wrong, because the
part is small and mostly hidden. Independently corroborated by the sibling
routine `FUN_0048F190`, where the middle term is a literal `RotZ(0x4000)` and
the sandwich collapses to `Rz(90)·Ry(a)·Rx(a)` exactly.

**A placement I refused to make.** `obj_484ff0_props` draws world-space props
selected by `*(int16*)(*(int*)(obj+0x1390) + 6)`. `obj+0x1390` does *not* point
at the evt spawn descriptor: `+6` there is the high half of `init_flags`, which
is 0 for all 142 class-`0x25` descriptors in all six stages, and variant 0
draws nothing. I tried gating by stage bounding box instead and rejected it —
levels span thousands of units, so the box accepted the props in every stage,
which is exactly the failure mode of guessing. The rig is transcribed and the
exporter prints why it is not placed. `[open]`: what `obj+0x1390` points at.

**The 9-vs-22 split is a filter, not a definition.** I split the 31 callers by
whether they also call `AssetDrawSlot`, and gave the 22 that don't to a survey
agent. That was right for finding rigs quickly and wrong as a stopping rule:
the stage-2 opening vehicle's poser (`FUN_004521B0`) evaluates the path and
never draws, while its rig lives in `FUN_00452320`. The user asked about that
car directly, which is how it surfaced. When hunting a rig, follow the poser to
its `obj[0]`.

**Verification that actually bit.** Rendering each rig in EEVEE:
`obj_48f190` assembles into a clean convertible and `obj_48ead0` into a
speedboat with an outboard motor. A wrong parent or a dropped FPU argument does
not produce a recognisable vehicle, so this is a real check and not decoration.

**Ghidra hazards, recorded in the survey**: the decompiler silently drops FPU
arguments to the matrix calls (every constant re-read from raw bytes);
`CamEvalObjectPath6` returns `{float x,y,z; int rx,ry,rz}` though Ghidra types
all six as float; and on `FUN_0048F560` it renders a jump table as an indirect
call and leaves `0x48F796`–`0x48F80F` undisassembled.

### Session 19, continued — the stage-2 car

The user asked whether the car at the start of stage 2 was among the rigs. It
was not, and stage 2 had zero rigs. The reason is the flaw in my own split: I
filtered the 31 `CamEvalObjectPath6` callers by whether they also call
`AssetDrawSlot` and treated the 9 that do as "the rigs". For this car the poser
and the drawer are different functions — `FUN_004521B0` evaluates the path and
never draws, and the rig is in `FUN_00452320`. The survey agent had flagged it;
I had filed it under "positioners" and moved on. **When hunting a rig, follow
the poser to its `obj[0]`.**

It is `[proved]` a car, by sound record rather than by shape: `FUN_00452930`
plays `0x719A9` = `STAGE2_SE\CAR_SRIP_22.wav`. It renders as a red hatchback
with its wheels in place.

Three more findings from the same pass:

* **The verifier earned its keep.** The same-stage-file check added earlier in
  the session immediately caught a bad transcription: `FUN_00432840`'s cam
  `0x2F` gate is cp_st1 while two of its routes are op_st2. The gate controls
  when the object starts *moving*, not which route it takes — that is
  `obj+0x11C`. A camera-path gate is not always a route selector.
* **`obj+0x1390` is not the evt spawn descriptor**, now confirmed from two
  independent classes: `0x25` wants `+6` as a variant (it is 0 in all 142
  descriptors) and `0x33` wants `+0x0C` as a path slot (it is float data in all
  44). It is a per-class parameter block, `[open]` where. Two rigs stay
  unplaced because of it.
* `RigPart.slots` means "draw all of these at this transform". The car's part
  literals list two slots each, but those are the two *variants* of one part —
  pasting them as-is would have drawn the intact and wrecked models
  superimposed. Only variant 0 is exported.

`[open]`: the car body carries 17 primitives and `part_002f` 5, of which
several are untextured with a black base colour, and they render as large flat
black wedges projecting from the model. They are inside the models' own mesh
lists, not a rig error, but whether the engine draws them at all — and in what
mode — is unresolved.

### Session 19, continued — draw order

The user looked at the stage-2 car render and said the black wedges were a
draw-order problem with transparent faces. That was right, and my first reading
was not.

I had reported the black shapes as "opaque untextured black meshes". True of
five of them, but I stopped there and missed that prims 6/7/8 are *textured*
meshes whose black base colour annihilates their texture. Forcing those factors
to white made the render look right — it revealed a licence plate that had been
buried — and it is **wrong**. `InitD3DDeviceAndTextureStages` sets
`COLOROP = MODULATE`, `COLORARG1 = D3DTA_TEXTURE`, `COLORARG2 = D3DTA_DIFFUSE`,
and these meshes carry no per-vertex colour, so the mesh base colour *is* the
diffuse. The black modulation is faithful; whitening it neutered a real pass.
The experiment was worth running, but shipping it would have baked a lie into
every export.

The real cause is what the user said. Both symptoms — the wedges and the
see-through roof — come from the exporter throwing away render order:

* `RenderEnqueueCommand` draws the opaque pass immediately, in submission
  order. `RenderFlushCommandList` sorts the whole list and draws the
  translucent pass. The comparator at `0x004A8A20` is (draw layer ascending,
  sort depth descending) — painter's order with the layer as outer key.
* The pass selector is `(tsp & 0x180000) == 0x80000`, the **TSP bits, not the
  list type**. `nl1.Mesh.opaque_pass` now spells that out separately from
  `translucent`, because the two can disagree and it is the pass that decides
  order.
* The car's body is genuinely **two coincident translucent shells** — prim 0
  (texture 2, white) and prim 6 (texture 33, black), centroids 0.03 apart,
  radii 20.32 and 20.16. Nothing in glTF orders those.

So the export now carries the order rather than pretending it does not matter:
primitives opaque-first then translucent in chain order, `hod2_pass` and
`hod2_chain_index` on every triangle primitive, and the full rule in
`asset.extras.hod2_draw_order`. The web player eats the same glTF the exporter
writes, so it inherits this without touching `bundle.py` — which mattered,
because that file had uncommitted work from the parallel workstream.

For the Blender viewers, which cannot honour order at all, blended materials
are switched to hashed transparency. That resolves per fragment instead of per
object: the wedges go, the roof is opaque, and the windows stay correctly
see-through into the interior. It is not the engine's order and the docs say so.

Checked the alpha before blaming it, incidentally: texture 2's alpha nibbles
spread across 7..15, a real gradient, so ARGB4444 is decoding correctly. It
simply never reaches 0, which is why mis-ordered blending washes out rather
than cutting holes.

## The `cam/` files are damaged, and this is how you can be sure

The user pushed back twice on the claim that `cp_st1.bin` ships damaged —
"it's far more likely your interpretation of the data is wrong", then "are you
not able to decomp the camera and object path code to see exactly how this is
being interpreted?". Both were the right question, and answering it properly
changed the answer.

The format reading is now pinned instruction by instruction:

* the loader at `0x00403F89` takes the path count from the EXE table at
  `0x004C476C` and computes the curve base with `LEA ECX, [EAX + EDX*4 + 4]`.
  Deriving *n* by scanning to the `0xFFFFFFFF` terminator instead gives the
  identical number for all 23 shipped files.
* the file arrives by `CreateFileA` / `GetFileSize` / `ReadFile` /
  `CloseHandle` into a 32-byte-aligned buffer. Nothing decodes or relocates it.
* `CamBindPathSlots` walks the offset table and the slot list in lockstep and
  touches no payload byte.
* `CamEvalHermiteCurve` indexes `*(float *)(param_1 + i * 8 + 2)` on a
  `ushort *` — byte `i * 16 + 4` — and reads `pfVar1[-3]`, `pfVar1[-2]`,
  `pfVar1[1]`, `pfVar1[3]`. That fixes the stride at 16 and the fields at
  `{time, value, tangent_out, tangent_in}`, with no masking and no sentinel.
* the two EXE tables that `CamEvalPath7` consults are independent and agree for
  all 418 slots; the structural pool walk lands exactly on the end of all 23
  files with zero slack.

So the bytes on disk are the bytes the shipped game evaluates. The
interpretation was not the problem — but the *diagnosis* was, in two ways.

**It is per byte, not per word.** `cp_st1` path 1's `target_y` holds
`da 2c 40 41` (12.011) seventeen times, `da 2c 40 ff` four times — NaN, caught
— and `da 2c ff 41` three times, which is 31.897: finite, plausible, and not in
the data. The old repair was filtering on non-finiteness, so it had been
feeding those spikes to the camera all along. That, not the NaNs, is what the
user was seeing at the start of stage 1.

**The files over-determine themselves.** Three independent sources say what the
values were:

* the other channels of the same path. Path 1's `target_y` and `target_z` carry
  the complete time base `0 10 20 … 160 190 260 330 380 ×12`; `target_x`, same
  32 keys, has that sequence with sixteen holes. Path 2's six healthy channels
  say `… 190 …` where `target_z` says `510` — `00 00 ff 43` against
  `00 00 3e 43`, a smashed byte 2 that no finiteness test would ever flag.
* `st1evtbl` itself. It plays these paths with `cam_play 0..230`, `0..380`,
  `0..170 / 171..359 / 360..470` and `0..125 / 126..140` — exactly the
  durations the restored time columns give, from a different file.
* duplicate keys. Keys sharing a time are copies of one key and must be
  byte-identical, so a member differing by one `0xFF` byte is convicted by its
  twins.

The restoration now works down that evidence in order and records which rule
answered each field: **90 fields, 81 determined by the file itself**, 9
reconstructed and labelled as such. Stage 1's opening cameras chain end to end
again — path 2 finishes at eye `(−37.88, 15.20, 133.74)` and path 3 starts
there — where before they jerked.

Eight channels have no evidence left at all. `cp_st1` path 0's `eye_x` is the
one that stings: all eight keys read `ff 64 bc ff`, no other curve in any
`cam/` file carries those low three bytes, and the channel is constant so no
neighbour constrains it. Its camera sits at one of ±23.5, ±94.2, ±376.8 or
±1507.2 and the file no longer says which. That is flagged, not guessed.

The earlier note's "119 damaged words" was also two different numbers added
together, and is corrected in `anomalies.md`.

## The skip feature is one assignment short of working

Recorded previously as "entirely dead code". That was right about the flag and
wrong about the feature, and the difference matters.

`set_skippable_region` (`0x2C`) is live: it drives `g_nEvtSkippableRegion`
(`0x009A2D7C`), which both player-update routines read. Each ends with

```c
if (g_nFiringGate == 0 && g_nEvtSkippableRegion != 0) {
    mask[0] = 0x2; mask[1] = 0x20000;        // Start, player 1 / player 2
    if (mask[player] & _DAT_009C9028) g_nSkipRequestedDeadEnd = 1;
}
```

and `0x40`, `0x41`, `0x42` and `0x2E` all test the skip flag and walk past
their wait when it is up. The gate is the same `g_nFiringGate` the shutter
machine drives, so a skip is only offered while the letterbox is closed —
which is a genuinely nice piece of design, and is why the two features had to
be understood together.

The break is one line: the Start poll writes `g_nSkipRequestedDeadEnd`
(`0x009A1A18`), which has **two writers and no readers anywhere in the
binary**, and the only two writers of the flag itself both store 0. The player
transcribes the machinery as written and supplies that assignment from a Skip
button, so the feature can actually be exercised.

## The shutter was drawing at a fortieth of its size

`MatrixTranslate(0, ±0.35, -1)` positions the bar's **origin**, and the
implementation had been treating 0.35 as its inner edge. Asset `0x93E` is
`common.bin` model 129: one four-vertex quad, x −0.515..0.515, y −0.05..0.05.
So a closed bar spans 0.30..0.40 and its inner edge is 0.30 — 80 % of the
0.3748 frustum half-height, giving a 10 % band top and bottom. Reading 0.35 as
the edge gave 3.3 % of the frame, a hairline, which is why it looked like it
was not rendering at all.

The quad's 0.515 half-width just exceeds the 0.4997 half-width of a 4:3
frustum at this FOV, so the artwork was cut for a 4:3 screen exactly. The
player draws the bars full width and says so; stopping them short of a wide
frame edge would be the worse likeness.

## `show_screen_message` is `play_dialogue`, and the subtitles are right there

The user's hunch — "I think `show_screen_message` is actually some kind of
`play_dialogue` (that shows subtitles and plays audio)" — was exactly right,
and the reason it had been missed is instructive.

`FUN_00435B80` was read as far as "plays a voice, then starts a task holding a
sprite id and a frame count", and the 0x10-byte record at `0x00589DA8` really
does carry a `sprite`, an `x` and a `y`. What was never followed was the task
itself. `FUN_00435AA0` has two branches:

```c
if (DAT_009C911E != 1) { ...draw text... }
FUN_0041C6D0(rec.sprite, rec.x, rec.y, ...);   /* the sprite */
```

and `DAT_009C911E` has **one writer in the entire binary** — `FUN_0040AC60`,
which stores 2 — over a BSS global. The `== 1` test is never true. The sprite
path, the `sprite` field and the `x`/`y` in the record are all dead; the game
only ever draws text. Reading the record and stopping there had produced a
plausible-looking description of a feature that does not run.

The text path needs two more tables neither of which stores a count:
`u16[variant][4]` line ids at `0x005919A8`, `0xFFFF`-terminated, and 0x40-byte
`{f32 x_offset, char text[0x3A], u16 end_frame}` records at `0x0058BC68`. So a
dialogue line is up to four subtitles, and they advance on a **countdown** —
`frames` counts down from the record's duration and the line index steps when
it falls under the current line's `end_frame`, which makes `end_frame` "frames
still left when this line gives way" and gives the last line 0.

`FUN_00436850` turned out to be a proportional bitmap text renderer: centre at
`320 − len × 5.6 + x_offset`, 11.2 px per glyph on a 384 baseline, a per-letter
baseline nudge for descenders, a char → glyph table at `0x0055E054`, colour
`(1.0, 0.8, 0.8)`.

The payoff is that the script's actual dialogue is now in the bundle and on
screen: *"We're meeting G over there."*, *"I've already taken care of G." /
"This is only the beginning."* And the player-configuration split is real
content rather than duplication — group 5 is **"Get him!"** for one player and
**"Get them!"** for two.

One more thing falls out. Both the setup and the task return early on
`g_nEvtSkipFlag`, so a skipped cutscene drops its subtitles and its voice line.
That is a third live consumer of the skip flag alongside `40`/`41`/`42` and
`2E`, and more evidence that the feature was finished and then lost a single
assignment.

## Telling the reader what an operand means

`set_hud_shutter_state 5` was displayed as "5". The nine states were already
read out of `HudDrawShutterState` and written down in `evt.md`, but the player
showed the number, so the knowledge sat in a document nobody has open while
watching a stage run.

`hod2lib.script` now attaches a `means` string to the operands whose space is
small, closed and fully read out of the handler — `0x1C`, `0x1D`, `0x1F` and
`0x2C` — plus `firing_gate` for `0x1F`, since which states drive
`DAT_009C8E00` is the non-obvious half. The client prefers `means` over the
bare value in every summary. Deriving it in the exporter rather than the client
keeps one source: the same table that documents the opcode produces the label.

## Session 20 — the spawn system

Code first, as asked. The entry point was the spawn opcode handler, not the
data, and it paid immediately.

**`obj+0x1390` is the descriptor + 0x24.** There are three allocators, not two:
opcode 0x09 → `FUN_004088A0` (0x13F4, no tail pointer, reads two tail bytes
inline); 0x0B/0x0D → `FUN_00408A20` (0x13F4, `obj+0x1390 = desc+0x24`); 0x0C →
`FUN_00408BC0` (**0x1314**, `obj+0x130C = desc+0x24`). All three end with
`= descriptor + 9` on an `int *`.

Last session I concluded the opposite — that `obj+0x1390` "does NOT point at
the evt spawn descriptor" — from two independent classes. Both readings were
off by exactly `0x24`, which is why one gave `init_flags` and the other float
data. Two independent wrong answers agreeing is not corroboration when they
share a method. The fix unblocked both rigs that were transcribed but unplaced.

**The sound record table at `0x005845F8` is the binary's only name table** —
324 `{id, filename}` records. There is no asset name table anywhere, so a
`PlaySoundId` id is very often the sole evidence for what an object is. Two of
the four class agents dead-ended looking for exactly this and reported the ids
unresolvable; a third found the table. Worth remembering that a negative result
from one agent is not a fact.

With it, class 0x30 is **proved** to be the zombie rather than assumed: state 2
of its own 54-entry state table plays `COMMON2\ZOMBIE_041_16.wav`. Its variants
play `CHAIN_SAW_22` and `KNIFE1_44`. Class 0x10 is the civilian, by five voice
records naming young man / man / young woman / old woman / child.

**Item placement is container placement.** Class 0x41 type 0 places a *group*
of breakable props from two EXE tables — nine groups, 42 props, a 10-byte
record each. Break the last prop of an item-set and that set's item is
released. The record's trailing bytes turned out to be a **support list** for
the topple physics, confirmed 42/42: every member at stack level *n* names
supports that are all at level *n−1*, and every ground-level member names none.
A wrong field offset could not produce a consistent height ordering, so that is
a real check rather than a plausible story.

**Two over-claims of my own, corrected.** I had written that all three
orientation words are Euler angles because the allocators copy them to
`obj+0x64/68/6C`. True of the spawn path, false as a universal: class 0x41
type 4 reads `obj+0x6C` as an object kind and `obj+0x64` as a group size. And
`desc+0x22` reaches both `obj+0x11C` and `obj+0x11E`, which is the classic
current/max HP idiom for combat classes — but at least eight classes repurpose
`obj+0x11C` as a sub-type selector, and for class 0x51 it is dead entirely.

**On the cat.** There is none in the sound table. The animals the binary names
are a frog, an owl, a bat and a worm. Class 0x52 is the best structural
candidate for a small ambient animal — it wanders, it is small, its model is
`0x1385 + rand() % 10` — but it plays no sound, so nothing in the code names
it. Left `[open]` rather than guessed.

Still open: classes 0x20, 0x45 and 0x46 were not reached; class 0x30's state
slots 0x16–0x35; and the ten behaviour functions at `0x005926A8`, three of
which play sounds and so are the next place identity evidence will come from.

### Session 20, continued — annotations became committed source

The user asked where the names actually live, and the honest answer was: not in
the repo. `ApplyKnownTables.java` covered the evt opcode and spawn-class
dispatch tables and nothing else. Every other symbol — ~90 project globals and
~130 function names, built up across many sessions — existed only in the live
database, applied interactively over the MCP bridge, which leaves no trail. The
markdown cheerfully referenced `g_camera_fixed_eye_y` and `FUN_00462A80` as
though they were durable. A fresh checkout would have rebuilt to neither.

So the model is now: **the database is derived, `ghidra/annotations/*.tsv` is
source.** `ExportAnnotations.java` dumps the project's symbols out of a
database; `ApplyAnnotations.java` replays them onto a fresh import, creating
functions that do not exist yet because most of the interesting ones are only
reachable through a table auto-analysis never recognised. `./ghidra/run.sh
rebuild` is the one command: import, apply tables, apply annotations.

Two design choices worth keeping. `ApplyAnnotations` renames only symbols still
carrying a Ghidra default name, so it is idempotent, never clobbers a name
chosen in the GUI, and does not care whether it runs before or after
`ApplyKnownTables`. And `ExportAnnotations` filters out everything a fresh
import recreates — `Catch@`/`Unwind@`, PE resources, TEB fields, and the
CRT/D3DX names the function ID analyser finds — so the committed file stays a
record of *this project's* findings rather than a snapshot of Ghidra's.

`tools/verify_annotations.py` checks every row against the EXE's own PE section
table, and immediately rejected three rows. The rule was mine that was wrong:
MSVC emits a switch's jump table inside the function body, so
`g_class33_selector_targets` and friends legitimately live in `.text`. They are
reported now rather than rejected.

Headless could not be used for any of this — the GUI instance holds the project
lock and `run_ghidra_script` is gated off over MCP — so the existing database
state was read back through MCP queries (`search_functions_enhanced` with
`has_custom_name`, and `list_globals`) and written to the TSVs by hand. The
scripts are what make the next round automatic.

## A parallel table only ever drifts

`opstatus.ts` held "how far does the player honour each opcode", in a table
next to — but separate from — the interpreter's dispatch switch. The user
asked why `enable_rain` was struck through as unimplemented, and the answer was
that it had been implemented for weeks: the switch had a `case 0x1d`, the
progress doc said **done**, and only the status table still said `shown`. Three
copies of one fact, two right.

Checking the rest turned up more of the same. `set_skippable_region` was marked
dead after being wired up. `set_backdrop_mode` was listed as "the sky is
missing" after the dome was built. Going the other way, `region_load` and
`pin_view_to_ground_plane` would have been *promoted* to done by a naive sweep,
and both would have been lies: `loadRegion` is an empty host hook because the
bundle holds every region from the start, and `cameraEyeY` ignores
`useFixedEyeY` because `APPLY_EYE_Y_RULE` is off pending the eye-height
question. Those two stay `shown` and `tracked`, with the reason on the entry.

So the table is gone and the status now sits on the same object as the handler:

```ts
0x1d: {                                     // enable_rain
  status: "done",
  run: (w, op) => { w.rain = !!op.value; return op.means; },
},
```

`Walker.OPS` is the whole registry — 65 opcodes, 48 with a `run` — and
`apply()` is one line through it. An entry with no `run` is a declaration that
the client deliberately does nothing, and an opcode absent from the table
defaults to `shown`. Adding a handler without saying what it achieves is no
longer expressible, and `opstatus.ts` is reduced to the vocabulary and the
hover labels, which are presentation and belong with neither.

Four light-block-1 opcodes moved `tracked` -> `none` on the way past.
"Tracked" claims state is kept and shown; the walker stores nothing for them,
and block 1 is pushed only at scene init and never reaches the renderer, so
they are no-ops in the game as much as here.

The one copy that can still drift is the human table in `PLAYER_PROGRESS.md`,
so `tools/verify_player_ops.py` compares the two. It caught `set_backdrop_mode`
on its first run.

## An absent xref is evidence about the disassembly, not about the program

Twice now the skip feature has been written up wrongly, and both times from the
same mistake.

First it was "entirely dead code": `DAT_009A2D74` has fourteen xrefs, twelve
reads and two writes, and both writes store 0. Then, after finding that
`set_skippable_region` really does drive `DAT_009A2D7C` and that both
player-update routines poll Start against it, "complete except for one
assignment" — because the poll writes `DAT_009A1A18`, and *that* had two
writers and no readers at all.

The user said flatly that the flag is definitely set, because you can skip
cutscenes in the game. That is a stronger piece of evidence than an xref list,
and it should have outweighed it immediately.

Scanning the raw image for the little-endian address settles it in one line:

```
g_nSkipRequested  VA 009A1A18 -> 5 byte occurrences
```

Ghidra had found two. The other three are at `0x00435F26`, `0x00435F4D` and
`0x00435F70`, in a block it had never disassembled — because
`CheckCutsceneSkipRequest` is only ever reached through a function pointer
written into a task struct, installed from the table at `0x005934E4`. Nothing
calls it, so nothing referenced it, so it did not exist as far as any xref
query was concerned.

The task is the missing link and it is unremarkable once seen:

```c
if (g_skippable_region == 0) { task_end(); return; }
if (g_skip_requested) {
    if (cam_end != cam_frame) cam_end = cam_frame;
    g_skip_requested = 0;
    g_skip_flag      = 1;
    DAT_009A2230     = 1;
    AssetDrainAllJobs();
    *task = FinishCutsceneSkip;
}
```

Two details are worth keeping. `DAT_009A6148` is the end frame and
`DAT_009A6144` the current one, so the skip **ends the current camera move
where it stands** — it does not fast-forward to the end of the path. And
`AssetDrainAllJobs` is there because the waits that would have covered the
streaming are about to be walked past.

Following the flag properly then turned up three consumers the earlier writeups
had dismissed. `EvtOpQueueEvent30` drops its action entirely when the flag is
up, which is the mechanism that makes a skip *skip*: with nothing queued and
every wait falling through, the interpreter races to `set_skippable_region(0)`.
`FUN_00408B70` (`0x0D`) walks its operand list either way but spawns nothing.
`FUN_0045F750` and `FUN_0045F780` (`0x3A`, `0x3B`) are genuinely gated — the
walker's comment had said the "unless skip" variants were gated on a flag
nothing ever raises, which was a fair reading right up until the player could
raise it.

**Method note.** `get_xrefs_to` answers "what did the analyser link", not "what
does the program do". When a global's reference count looks too small for the
role it plays — and "a flag twelve places test and nobody sets" is exactly that
shape — grep the image for the address before concluding anything.

## The button you could click but not see

The skip bar was invisible and clickable at the same time, which is a specific
enough symptom to name the cause: something opaque was painting over it that
took no pointer events. `.hud-layer` is `pointer-events: none`, is appended to
`#viewport` at construction so it is the last child, and carries the letterbox
shutter — a 10 % black band along the bottom. And a skippable region is
*precisely* when the shutter is closed, because the firing gate being down is
the condition for both. The bar was behind the letterbox every single time it
appeared. Explicit z-index on the layer, the bars and the loading overlay.

## Session 21 — `mot/`, the last format

Driven from the EXE throughout, and the data only opened at the end to check.

The chain, all of it read before a single file was touched:
`MotionRequestBankLoad` enqueues asset job kind 8; sub-step 0 builds the path
from the format string `"mot\%s"` sitting immediately after the sub-step
pointers; sub-step 1 does one `ReadFile` of the whole bank (no decompression,
unlike `pol/`); sub-step 2 is the entire parse and is four lines — one `int32`
offset per motion id in the bank. `MotionFrameAddress` then gives the stride,
`(bones*6+15) & ~3`, and the `+4` that steps over the block header.

Then, and only then, the files: **1058 of 1058 blocks** across all 49 banks have
a declared frame count that exactly equals their block size divided by a stride
the formula can produce. The verifier deliberately does not assume a bank
belongs to a known character — it tests the format's arithmetic — which is what
let it cover the `komono_*` prop banks whose bone counts are not in the
character table at all.

**A correction to last session, and it was load-bearing.** I said the rest pose
lives in the motion data because every part model is authored about its own
origin. Half right: the *models* are, but each skeleton node carries a **bone
offset in the EXE** (`+0x04..+0x0C`, floats). `mot/` supplies only rotations
and a root translation. So a character assembles from the EXE alone — which
means the player never needed `mot/` to show a skeleton, only to make it look
right. I had told the user the opposite and it shaped the plan.

The bind pose is still not a rest pose, which is the subtlety: bone offsets all
run along their own local X, so zero rotations collapse a character into a
heap. `export_character.py 0x1A` renders a pile; `--motion 762` renders a cat,
mid-stride, tail up. That render is the end-to-end proof of skeleton, stride,
frame layout, bone indexing and rotation order together — a wrong value in any
one of them does not produce a cat.

Two smaller traps worth keeping:

* `g_asset_bank_names` is **shared with the camera-path filenames**. Scanning
  it blind treats `cp_st1.bin` as a motion bank. An entry is a bank only if it
  also has an id list in `g_motion_bank_ids`.
* The `u32` at the head of each motion block is the frame count, and the engine
  never reads it — it drives playback from `g_motion_play_length` instead,
  which is about *twice* the frame count. Using that table as a frame count
  would double every animation. Left `[open]`; the block header is the one to
  trust.

Annotations for all of it went into `ghidra/annotations/*.tsv` — twelve
functions and fourteen globals — so the Ghidra database rebuilds with the
`mot/` work in it. `docs/PLAYER_PLAN.md` gained a section on wiring characters
and spawns into the player, including the warning not to bake every motion:
`people.bin` alone is 200 motions over 7105 frames.

## Characters in the player, and the motion rule that is worth not guessing

`mot/` being decoded made this a wiring job rather than a research one, and the
plan in `PLAYER_PLAN.md` was right about the shape: a skeleton is exactly a rig
— a tree of named parts, each with a translation, a BAMS triple and an asset
slot — so it goes through the existing rig writer rather than a second glTF
path. The writer already supported `placements`, one instance per spawn
descriptor, so the stage glTF now arrives with a full character hierarchy
standing at every spawn, positioned and yawed, and the client only has to pose
it.

The one thing that could not be baked is the transform between the object and
the bones. `FUN_00410590` reads:

```c
MatrixTranslate(obj.pos); Scale; RotX; RotY; RotZ   /* baked into the root */
MatrixTranslate(frame.root);                        /* <- not baked */
RotZ(bone0.rz); RotY(bone0.ry); RotX(bone0.rx);     /* <- not baked */
for (node in skeleton) DrawBone(node);
```

The motion root translation is expressed in the object's *rotated* frame, so
writing it onto the instance root would apply it in world space and slide every
character sideways. The client inserts a group for those two lines instead.

**Which motion an actor plays is where this could have gone wrong.**
`obj+0x1B4` is the motion id — the sampler is called as
`FUN_00412F50(obj+0x1F4, obj+0x1B4, frame)`, character type and motion — and
only a class handler writes it. Two are readable now:

* class `0x30`, the zombie, is a literal: `obj[0x1B4] = 0x3BC` (956, `zom.bin`),
  or `0x41E` (1054, `hzom.bin`) on a branch that tests a field the allocator
  fills differently per spawn opcode. 956 is the common path and the only one
  taken here.
* class `0x53`, the cat, reads `u16[0x00589A64 + variant*10]` where the variant
  is the spawn's parameter tail. The table is five `u16` per variant,
  `0xFFFF`-terminated — a playlist — and every id in it lands inside `nya.bin`'s
  762..773, which is the corroboration that it is a motion table at all.

A general rule was tried and rejected, and recording why matters more than the
result. The stride `(bones*6+15) & ~3` has to divide every block in a bank
exactly, which is a genuine constraint and does uniquely pick `nya.bin` for the
cat's 19 bones, `frog.bin` for 15 and `kame.bin` for 24. But **30 of the 49
banks are 16-bone**, so every humanoid would have been posed from an arbitrary
one of thirty. That is the same trap the spawn survey hit with `desc+0x24`: a
rule that raises the count and lowers the truth. A character posed from another
character's animation reads as a decoding bug, where a marker reads as a
feature not finished yet.

287 of 562 identified spawns are posed, 25 character types. The marker layer
skips any spawn that has a real character, so a cone never ends up stuck through
a zombie.

## Two ways a character can look wrong

The first render of the spawned characters had them backwards and coming apart,
and the two faults had nothing to do with each other.

**The bones.** The glTF was right — dumping the hierarchy showed every bone
nested under its parent with the correct offset, two roots (upper body, pelvis)
exactly as the EXE skeleton describes. The fault was one line of client code:
`/_bone(\d+)_/` against a node name. 863 of 1632 character bone nodes carry more
than one primitive, and `GLTFLoader` loads such a node as a group whose children
are named `<node>_0`, `_1`, … — all of which match that pattern. Depth-first
traversal meant the *last* match won, so the map pointed at a primitive, the
bone itself never rotated, and one piece of each limb span about the joint on
its own. Matching the exporter's part name as a suffix fixes it.

Worth noting how much time the wrong instinct would have cost: "parts are
detached" reads as a transform bug, and the first three things checked were the
parent chain, meshless bones breaking it, and the bind offsets. All three were
fine. Dumping the actual glTF node tree — rather than reasoning about what the
writer would have produced — is what ended it.

**The facing.** Here the data was checked before the code was changed, which
was the right order, because every individual step of the chain is correct:
`FUN_004088A0` copies the descriptor's `+0x14/18/1C` straight to
`obj+0x64/68/6C`; `FUN_00410590` feeds those to `RotX; RotY; RotZ`; and
`MatrixRotateY` builds `x' = c·x + s·z, z' = −s·x + c·z`, which is three.js's Y
rotation exactly. The exporter mirrors no axis and the client's `lookAt` is the
ordinary one. So nothing in the pipeline turns the yaw, and the half turn has to
be in the models: they face **+Z** in their own local space.

The measurement that settles it needs no rendering. Take every class-0x30 spawn
in the six stages, find the nearest camera eye sample on any `cp_` path, and
compare the authored yaw with the direction to it. A raw reading puts **149 of
203 zombies facing away** from the camera and 54 towards it; flipping reverses
that, and zombies face the player. The screenshot corroborated it independently.

The nicest part is that the spawn markers had been carrying this half turn all
along without anyone noticing — their cone is modelled pointing down local −Z,
so marker and character now agree. That is also why it survived this long: a
symmetric marker with the flip baked into its geometry looks correct either way.

Recorded as `[measured]`, not `[proved]`: where the *game* applies the half turn
has not been found. The zombie's setup computes an angle toward the camera into
`obj+0x4C8` and its update runs a 54-state machine, so a runtime turn is the
likely home, but that is a guess and the note says so.

## The half turn was mine, not the game's

Adding `+0x8000` to the spawn yaw was wrong, and the way it was wrong is worth
keeping: the measurement that justified it was badly designed and I did not
interrogate it before acting.

The measurement compared each class-0x30 spawn's authored yaw with the
direction to the **nearest camera eye sample on any `cp_` path**. 149 of 203
came out facing away, which looked decisive. It is not: a camera rail runs
*past* a spawn, so the nearest sample on it is very often behind the zombie.
The statistic measures rail geometry as much as it measures facing. The user's
"don't just do a yaw flip, dig into the code" was the right instruction.

Doing that, every step of the chain checks out:

* `FUN_004088A0` copies `desc+0x14/18/1C` straight to `obj+0x64/68/6C`;
* `FUN_00410590` feeds those to `RotX; RotY; RotZ`;
* `MatrixRotateY` builds `x' = c·x + s·z, z' = −s·x + c·z`, which is three.js's
  Y rotation exactly;
* `FUN_004016B0` — which produces every angle in this game, camera pose and
  enemy facing alike — is `yaw = atan2(dx, dz)` with the pitch negated, so a
  yaw of θ names the direction `(sin θ, 0, cos θ)`;
* `FUN_00415A80` builds the camera's own matrix as
  `T(eye); RotZ(roll); RotY(yaw); RotX(pitch)`, and `FUN_00403AC0` derives that
  yaw from `eye − target`. So the camera's local +Z points *backward* and it
  looks down its local **−Z**, on a basis whose X × Y = Z. That is three.js's
  camera convention exactly.

So the scene is not mirrored, which also answers the bigger worry: a
left-handed projection does not by itself mirror anything if the view basis is
built right-handed, and this one is.

**What actually settles the facing is geometry, not an angle.** A foot is long
toward the toe and a head is long toward the face. Posed at motion 956 frame 0,
`char_adv00`'s toe reaches world `z = −2.47` against a heel at `+0.88`, and the
head juts to `z = −1.48`. A posed character faces **−Z**; `RotY(θ)` maps −Z to
`θ + 180`; so the authored yaw already aims it correctly and the half turn aimed
it backwards. That test needs no rendering, no screenshot and no statistics, and
it is the one I should have reached for first.

The sound version of the measurement was then run as a check, not as the basis
for the decision: comparing each spawn against the camera *actually playing when
that spawn instruction executes* gives **131 of 191 zombies facing the camera**
within 60 degrees and **4** facing away, on a histogram that peaks at 0 and
falls away symmetrically. The biased version gave 54 against 149 and was
**bimodal at plus/minus 180**. That shape was the tell and I read past it:
a real facing distribution is unimodal about zero, and anything peaked at both
ends is measuring something other than what it claims to.

## An honest gap: the humanoids have no waist

`char_adv00` assembles with its torso at `y 0.25..4.25` and its pelvis at
`−3.55..−0.96` — a 1.2-unit hole. Recording what has been ruled out, because
the remaining space is small:

* not a client bug: `export_character.py` produces the same gap;
* not a broken parent chain: the torso and pelvis are separate roots in the EXE
  skeleton, which is exactly what `FUN_00410590` iterates over;
* not a missing draw: `FUN_004107E0` writes one slot per bone into the record
  array and `FUN_00411050` draws that one slot, so 15 parts is what the game
  draws too;
* probably not the unused models: the spare slots interleave with the bone
  slots (`0x1F00, 0x1F01, 0x1F02, 0x1F03, 0x1F06 …`), which reads as the
  shot-off damage variants class 0x30 switches between.

The untested lead is the second per-bone table `FUN_004107E0` consults:
`PTR_DAT_004D032C[char_type]`, stride `0x14`, indexed `bone − 1`. It compares
its first word against the node's asset slot and on a match copies three words
and a scale into the draw record. The cat is unaffected — 18 models, 18 bones,
a clean 1:1 — so whatever this is, it is specific to the humanoid rigs.

## Settling it by looking

Two indirect arguments said the spawn yaw was right — the mesh extents (a posed
`char_adv00`'s toe reaches `z = -2.47` against a heel at `+0.88`) and the
re-run measurement (131 of 191 facing the camera). The user asked for the
direct one: put the camera where the game puts it, pose the zombies, render.

Two small tools, because neither existed:

* `verify_spawn_facing.py` exports a stage with the characters **posed** rather
  than at bind. The bundle deliberately exports bind, since the browser poses
  at runtime, and bind is a heap of parts that proves nothing. Posing needed one
  new thing: bone 0 sits between the object and the skeleton and the rig writer
  has no node there, so it is composed into each root bone — the rotation
  multiplies and the root translation is carried through it. That composition
  goes through a BAMS `Rz·Ry·Rx` build and its exact inverse, round-tripped as
  a check rather than assumed.
* `blender_shot.py` renders from an eye/target given as arguments, so the caller
  evaluates the path with `hod2lib` — the same evaluation the player uses — and
  Blender only draws. `blender_camview.py` drives the *baked* camera animation
  instead, which is the right check for the spline export but makes the render
  depend on how Blender's importer binds animations; it was not binding them,
  and the camera stayed put at every frame.

At camera slot 59 frame 210, where stage 2 block 3 step 1 places two zombies:
both face the camera, arms out. The authored yaw is right, the revert was
right, and the half turn was mine.

The same render confirms the waist gap independently — visible between chest
and belt on both zombies — which rules the browser out of that one for good.

## The waist: the skeleton is not the whole character

With a reproducer in hand -- `verify_spawn_facing.py` plus `blender_shot.py` --
the gap took three checks and one lucky split.

Ruled out first, and each mattered:

* **The skeleton header.** It has a node's shape -- slot at +0, offset at +4,
  bone at +0x14 -- so an undrawn root part was the obvious candidate. Its slot
  is 0 for every character.
* **`PTR_DAT_004D032C`.** The lead recorded last session. Dumped, it is the
  per-bone **hit-sphere** table: `{slot, centre, radius}` in bone order, radii
  2.55 torso, 1.3 head, 0.8 hand, 1.75 pelvis, with the entries past the end
  belonging to the next character. Damage volumes, not geometry. Recorded as
  closed so it is not chased again.
* **`PTR_DAT_0052ED08`.** Reached by scanning the image for the only `u32`
  `0x00001F02` in it -- slot `0x1F02` being the one model in `char_adv00.bin`
  that fits the hole. The single hit at `0x0052BEF8` sits `0x38` bytes before
  the pointer that table already gave for `char_adv00`, which is what turned a
  guess into a structure: `{u32 count; u32 *descriptors[]}`, each descriptor's
  first word an asset slot.

The split settled it. **68 of the 76 character types with a skeleton have one
or two extra parts, and the cat has none** -- exactly the set with the gap and
exactly the one without. That is a much better argument than "the extents fit",
which was all I had before.

Attachment was decided by rendering both candidates rather than by reasoning:
on the **second root** the waist closes and the zombie matches the reference the
user supplied; on the first root the gap survives. Every character has exactly
two roots, at bones 1 and 9 for the 15-bone humanoids but 4, 10, 12 or 20 for
the wings, `curien` and the HOD1 bosses -- so the rule is "the second root", not
the number 9.

Left open honestly: the descriptor has four more fields, including a byte array
`ff ff ff ff ff ff ff ff 0a 0b 0c 0d 0e 0f 16 17` and two pointers to blocks
`0x2D8` bytes apart, which read like per-vertex skinning against several bones.
The part is attached rigidly, which matches the game at rest; a deforming waist
would only show in extreme poses.

## The van, the doors and the zombies inside it

The user pointed at two zombies in stage 2 and said they spawn in the back of a
van whose doors swing open. Every part of that turned out to be in the data, and
finding it was a chain of five short hops rather than one hard problem.

**Which spawns are the van.** Listing everything within 60 units of the two
zombies gave a class 0x33 and a class 0x44 at the *same* position, 13 units away
— two halves of one set piece. Class 0x33 selector 2 (`FUN_00433A10`) draws one
model until a script flag; its `params[0]` resolves to `char_adv04.bin` model 94,
20 x 20 x 45 units and 350 verts. A van.

**The doors.** Class 0x44 selector 2 (`FUN_00472C90`) builds *two* child actors
at literal offsets `(±9.29, 11.5, 22.68)` with slots `0x1794`/`0x1795` and a half
turn between them. Those slots are models 95 and 96: door leaves hinged at x = 0,
**9.29 wide** — the same number as the offset — and the van's rear face is at
z = 22.68. Three numbers agreeing is what turns a guess into a reading.

**The swing.** `FUN_00473CF0` is shared by selectors 1, 2 and 4, so one
transcription covers 53 of the 123 class-0x44 spawns. It is a baked curve, not a
spring: `PTR_DAT_005960B4[curve]` holds 6-byte `{s16 rx, ry, rz}` frames, with a
second yaw-only table at `0x005960C8` for the curves that do not need the wobble.
Curve 2 goes to 179 degrees by frame 12 and settles back to 137 — a door thrown
hard enough to rebound.

The transform is worth keeping: `RotY(base_yaw); RotZ(rz); RotY(swing); RotX(rx)`
— two Y rotations with a Z between them, so the mounting angle and the swing stay
independent and four curves serve every door in the game.

**Room doors are the same thing.** The user asked separately about doors between
rooms. They were already in the list — `etc_door`, `komono_souko` (warehouse),
`komono_shop` — and their open flags do land immediately before a `region_load` /
`region_enter`, while the others are followed by `se_play`. One mechanism, two
uses.

**The jump.** `FUN_00452DA0` copies `params[2]` to `obj+0x1310`, which is the
index into the 54-state table at `0x00592AE8`. The van zombies carry state 21;
the three on the roof carry 27. State 21 (`FUN_004577F0`) plays `params[+0x04]`,
holds `params[+0x08]` frames, waits for the clip to finish and moves to
`params[3]`. For the two in the van that is motion **923**, delays **0 and 10** —
staggered — then the ordinary walk.

Motion 923 identifies itself without any further reading: its root translation
runs z 0 to -15.7 while y arcs 8.2 to 17.4 and back, against the idle 956's
z = 0 and flat y. That is a body leaving a van and landing.

**Verified by rendering**, three times: doors shut (the van rear is a solid panel
and the zombies are hidden), doors at frame 59 (open, both standing in the cargo
bay on its ribbed floor), and the entrance at motion 923 frame 14 (both mid-leap,
clear of the van). `verify_spawn_facing.py` grew `--open-frame`,
`--pose-motion` and `--pose-frame` for exactly this.

One piece of arithmetic worth recording because it was checked rather than
assumed: baking a hinge pose into a single fixed rotation means collapsing
`Ry·Rz·Ry·Rx` into one `Rz·Ry·Rx` triple, which is not the identity it looks
like. All 195 composites round-trip to within 1e-4, so the odd-looking triples
the decomposition emits (0x8000 in x and z where a plain yaw was expected) are
equivalent branches and not errors.

## Shooting, read end to end

The chain from trigger to corpse turned out to be eight short functions, and
following it in the *reverse* direction — from where the damage lands back to
where the trigger is read — was much faster than looking for an input handler.

`FUN_004098C0` is three lines: `obj+0x11C -= damage`. Its only caller is
`FUN_00409430`, which is the whole damage model; its only caller is
`FUN_004092F0`, which each actor runs on itself; and above that the pick,
`FUN_00404570` → `FUN_00404630` → `FUN_00404700` → `FUN_00404750` →
`FUN_004047D0` → `FUN_004062A0`. Six functions, none longer than a screen.

Three findings worth keeping.

**The hit test reuses the render skeleton.** `FUN_00404700` walks
`PTR_DAT_004E0430[char_type]` — the same node tree, with the same `+0x16` count
and `+0x18` children — that `FUN_00410590` draws through. So the shot geometry
and the visible geometry cannot drift, and the per-bone hit spheres in
`PTR_DAT_004D032C` are copied into the bone's draw record by `FUN_004107E0`
alongside its matrix, which means they follow the animation for free. That table
is the one guessed at as "hit spheres" two sessions ago from the radii alone;
this is the confirmation, and it also closes it properly.

**Damage is per bone AND per hit on that bone.** `FUN_00409430` indexes
`bone * 6 + obj[0x298 + bone*0x90]`, the second term being the count of hits
that bone has already taken. So each bone has a six-step escalation, and a
zombie's head runs 100, 120, 140, 160 while its feet stay at 20. The same index
into `PTR_DAT_004C7160` gives the asset slot the bone is **redrawn** with —
`FUN_004098E0` writes it into `record[0]`, which is the slot `FUN_00411050`
draws — so a zombie visibly comes apart where you shoot it.

**The head combo resets on a body shot.** `ScoreAddForPlayer(player, 0x78)`
then `combo += 10`, and every non-head hit writes `combo = 0`. That reset is the
entire point of the counter and is easy to miss reading the branch quickly.

One thing the reverse walk gave away for free: `FUN_004093C0` randomises which
player resolves first in two-player, so simultaneous hits do not systematically
favour player 1.

Implemented with the sphere pass, the bone-indexed escalation, nearest-first
resolution and the exact score. Left out with reasons stated rather than
silently: the collision-mesh refinement, the difficulty modifier, ammo, reload,
civilians, and the death animation — the last because which motion a dying actor
plays comes from the 54-state machine and only two of those states have been
read.

## Deaths and gore: two loose ends, both closed by the same table

The shooting work left two things explicitly open. Both turned out to be one
short hop from what was already read.

**The gore swap** needed "the shared fallback set `FUN_004099A0` resolves".
`FUN_004099A0` is eleven lines, and it searches the **tail of
`PTR_DAT_004D032C`** — the very table the bone hit spheres come from. Past
`bone_count − 1` entries the same `{slot, centre, radius}` records continue,
terminated by `slot == -1`, one per damaged variant. So a gore part carries the
sphere of the part it replaces, which is how a half-destroyed limb keeps a
sensible hit volume: `char_adv00`'s head stage 1 has the head's own 1.3 radius
and stage 2 drops to 1.0 as more of it is gone.

That also corrects something from two sessions ago. Dumping that table then, I
saw entries 15 and 16 holding slots `0x1F3A`/`0x1F3B` and wrote them off as
"belonging to the next character" because they resolved to `znsam2.bin`. They
are `char_adv00`'s **torso gore stages** — the same two slots the zone table
names for bone 1. Reading past the end of a table and reading the *next thing in
the same table* look identical until you know what the next thing is.

The cat needed a bound: it has no gore, so it has no terminator either, and the
walk runs into floats read as slots. Bounding by "only slots the zone table
actually names" fixes it, and the split falls out cleanly — the characters with
gore entries are exactly the characters with damage escalation.

**The death animation** needed the 54-state machine. Rather than read 54
handlers, I scanned each for 32-bit immediates in 950–1030 and got a shortlist of
sixteen. State 6 was 512 bytes and referenced four of the death motions; it is
`FUN_00454D20`, and it calls `FUN_004560B0` to choose, then waits for the clip
to end.

The choice is **directional**: `camera_yaw − actor_yaw` against four ±45° arcs,
giving motion 992, 991, or a random pick from a four- or six-entry table.

Worth recording how the check went, because the order mattered. The death
motions were identified *first*, from the data alone — scanning `zom.bin` for
motions whose root translation ends lowest gave a clean cluster, 985–992 plus
1015 and 1017, all ending at y ≈ 1.5 from a standing 12. Only afterwards were
`DAT_0059309C` and `DAT_00593084` dumped, and **every entry in both is in that
cluster**. Two independent routes to the same set.

I deliberately did not label the arcs "front" and "back". Which is which depends
on the camera yaw being target-to-eye *and* the model facing its local −Z —
exactly the pair of conventions that produced the wrong yaw flip earlier in this
session. What the data says without needing either: one table moves the root
−8.7/−9.5/−9.3 in z and the other +7.4/+8.2, so one set falls the way the body
faces and the other falls back over. A body falls away from whatever shot it,
and that is the whole content of it.

---

## Dismemberment, the damage rank, and the sounds

Three things came out of one question: *"shooting an upper arm shouldn't leave
the lower arm still moving."* That is right, and the reason was a misreading
recorded here rather than quietly fixed.

### `[i + 1]` was never the next slot

`ResolveHit` reads `slot = effect[bone*6 + n]` and `code = effect[bone*6 + n + 1]`.
The earlier note called `code` "the following step, which is how the code knows
whether this hit is the last one that bone can take" — true as far as it goes,
and it caused the exporter to fold the values 0, 1 and 2 to "no slot" and trim
them off the end. `ResolveHit` does not use `code` as a slot at all. It
**branches** on it: 0 last step, **1 sever**, 2 no effect whatsoever, anything
larger escalate. Folding 0/1/2 away deleted the sever code entirely, so every
hit reskinned the bone and nothing ever came off.

The data makes the distinction unambiguous and the check now asserts it: across
all 86 character types with a skeleton there are 442 slot references, the lowest
being `0xB91`, and the only values below that are 0, 1 and 2. A gap of 2958 with
nothing in it. If `code` were an ordinary slot the table would be dense near
zero.

`FUN_00409AB0` had been listed as "called on the sever path and not yet read".
Reading it took two minutes and was the whole answer:

```c
SeverBoneChildren(bone):  for each CHILD of bone: RemoveBoneSubtree(child)
RemoveBoneSubtree(node):  zone_mask |= 1 << g_bone_damage_zone[node->bone];
                          rec[node->bone].slot = 0;  rec[node->bone].f78 = 0;
                          recurse into children
```

The severed bone keeps the stump `ActorSwapDamagedPart` gave it; everything
below it has its draw slot zeroed, which `ShotTestBoneTree` also treats as "not
there" — so a blown-off arm is unshootable as well as invisible.

**A second bug found while fixing the first.** `CharacterBone.parent` is an
**index into the flattened bone list**, not a bone number. The first cascade
compared `child.parent === bone` directly. On a humanoid the two differ by
exactly one, so it removed *almost* the right set and looked plausible — the
kind of error that survives a spot check. Resolved through the array now, and
`verify_combat.py` asserts every sever step has a subtree to remove.

Renders: `extract/compare/sever/intact.png` and `arm_severed.png` —
`char_adv00` at motion 956 frame 8, with and without bones 4 and 5. The
forearm and hand are gone, the upper arm remains, the rest is byte-identical.

Worth noting what *isn't* a bug: `char_adv00` carries code 1 at **step 0** on
both upper arms and both forearms, so one shot really does take an arm off.
`char_adv02` carries it at step 4. Both are the game.

### Difficulty is two numbers, not one

`DamageRankModifier` indexes `g_pBoneDamageByRank[char][bone*0x10 + rank]` where
`rank = GetDamageRank()` = `g_damage_rank` at `0x009C8E96` — which is **not**
`g_difficulty` at `0x009C8E94`, one short earlier. `g_difficulty` only feeds
`ActorInitHitPoints`: `hp += g_difficulty_hp_delta[difficulty]` = `{−30, −15,
0, 0, 0}`, clamped `[1, 300]`. `g_damage_rank` is the adaptive rank, seeded by
`ResetDamageRank` from `{−3, −1, 1, 4, 8}` and moved by `UpdateDamageRank` with
lives lost and elapsed time, clamped `[0, 15]`. Two adjacent shorts doing
completely different jobs; reading either as "the difficulty" gives wrong
numbers.

With that applied the client's arithmetic lands where it should: a stage-2
zombie has 220 hit points and on Normal — rank 1, head modifier 0 — two
headshots at 100 and 120 kill exactly.

### The sounds were a switch statement all along

`FUN_00407950` is a bare `switch (material) PlaySoundId(...)`, and the
filenames it resolves to are what make the material codes readable:
`BULLET_SND1` under 1, `BULLET_MET1` under 2, `BULLET_OTH1` under 3,
`BULLET_WAT1` under 5, `BULLET_WOD1` under 6 — sand, metal, other, water, wood.
`coli.py` had already observed the surface palette `(0, 2, 3, 0x32, 0x34, 0x35,
0x38, 0x3C, 0x3D, 0x5A, 0x63)` in the collision files without knowing what any
of it meant, and it lands inside this table.

The actor side is `ActorPlayHitVoice`: one of `BLOOD02/03/04/06/BONE01` plus a
voice from one of **two sets**, chosen by character type. A result-5 hit — the
`2` sentinel — plays `BULLET_MET3` instead: the shot bounced off, and scores
nothing.

### Method notes

* **An annotation file that other people append to must not be re-sorted.**
  The first pass at persisting this session's names rewrote `globals.tsv` into
  address order with section headers — a 262-line diff over 14 new rows, and a
  merge hazard for the concurrent workstream. Restored to the original order
  with the new rows appended, per the skill's rule. The tell was `git diff
  --stat` showing far more churn than the work justified.
* `run_script_inline` and headless are both unavailable — scripts are gated off
  and the GUI holds the project lock — so the annotations files really are the
  only durable place for a name. They are, and `verify_annotations.py` is clean
  at 252 functions and 166 globals.

---

## The stumble

Asked whether a shot zombie plays a hit reaction. It does, and the routing was
already half-read — `ZombieOnShot` calls `FUN_004543F0` on the surviving path
and I had labelled that "hit reaction motion" and moved on. Reading it took two
functions.

`ActorReactToHit` decides **whether** the hit interrupts, and the answer is
often no. Results 1 (damaged and swapped) and 3 (severed) always react; results
2 and 5 react only for character types 3 and 0x12. An ordinary zombie's pelvis
has no gore slot at all, so a pelvis shot always resolves as result 2 and
**never breaks its stride** — which is a satisfying explanation for something
anyone who has played the game has noticed.

`ActorPlayHitReaction` picks **which** clip, from two indices: the actor's body
condition (`obj+0x130C`) and the bone's *reaction group*. `DAT_004C84A8` is
`u16[16]` and partitions the body into eight groups — head, torso, right arm,
left arm, pelvis, right leg, left leg — which is the same partition as the
destroyed-zone mask but finer, and it is the first table in this binary that
names left and right separately.

Bones 1–8 cross-fade in over 10 frames (20 if the hit severed something) onto
**track 1** of the actor's motion block while the walk keeps running on track
0; bones 9 and up are hard-set with no fade. That asymmetry is in the code, not
inferred: `if (bone < 9 && ...) MotionCrossFadeTo(...) else ActorSetMotion(...)`.

### Reading pointer arrays that have no count

The variant arrays sit end to end in `.rdata` with nothing marking their
lengths, and the first pass read a fixed six entries per character. That
reported `char_adv02` as having a distinct reaction set at variant 3 *and* a
sixth variant — the sixth was the next character's array. Bounding by "the next
array pointer in the same table" fixed most of it and then failed twice more:
the **last** array butts straight up against the pointer table itself, and one
character's entry pointed somewhere else entirely, producing a thousand-entry
array of garbage. The rule that holds is that these arrays are packed
immediately before the table that points at them, so an entry outside that
block is not a variant array at all. With both bounds the table reads as 21
character types, no junk rows, and exactly two distinct motion sets.

Worth writing down as a shape: **a pointer table whose targets are adjacent
variable-length arrays bounds itself**, and the last element's bound is the
table.

### Checking it is a stumble and not something else

Three measurements, none of them "the numbers look plausible":

* every reaction is 29–43 frames and every death is 74–161, two disjoint
  ranges, now asserted;
* summing the unwrapped per-bone rotation over each clip, the reactions travel
  326–377° against the walk's 137° over twice the frames;
* every clip's last frame equals its first on every bone, which is what a
  one-shot laid over a loop must do to hand back cleanly.

That last one also explains a confusing render: frames 0 and 26 of motion 961
came out pixel-identical and looked like the exporter was ignoring `--frame`.
It was not — the clip is 21 frames, 26 clamped to the end, and the end is the
start. Rendering the *most displaced* frame instead (computed, not guessed)
gives the recoil: `extract/compare/sever/react_torso_f2.png` against the walk
baseline in `intact.png`.

### A loose end tied off

`ActorUpdateBodyCondition` sets `obj+0x130C = 5` when both arm zones are gone —
reading `obj+0x1318`, the mask `RemoveBoneSubtree` writes — and
`ChooseDeathMotion` gives condition 5 its own death. So the destroyed-zone mask
*does* reach the death animation, just not through `obj+0x1368`, which remains
open question 21.

---

## Why the staggers were invisible, and where the gameplay camera is

Two separate things, one of them my fault.

### The staggers

The implementation was correct; the *data* was not reaching it. Running
`export_player.py --stage 2` had rewritten `manifest.json` to advertise only
stage 2 and left the other eleven bundles at their previous export, which
predates the reaction tables. A client reading one of those found no
`reaction_groups`, and `startReaction` returned quietly — indistinguishable
from "the game has no staggers".

Fixed three ways rather than one: re-exported every stage, made the missing
data **say so** (one console warning per session instead of a silent return),
and put the reaction motion in the shot feed so a working stagger is visible in
the transcript.

While checking, found a genuine bug next to it. The cross-fade length is in
**60 Hz game frames** and was being compared against the clip's own 30 Hz
frame counter, so the fade ran twice as long as it should over a 16-frame clip
and the blend weight peaked at 0.8 instead of reaching 1. Measured before and
after by replaying the client's own arithmetic over the exported JSON: peak
deviation from the walk pose goes 64° -> 99° on a torso hit and 86° -> 109° on
a head hit. That measurement is also what ruled the animation *out* as the
cause of "no staggers" — 64° is plainly visible, so the problem had to be
upstream.

### The camera does not follow the enemies

Asked to decompile how the camera tracks the zombie about to attack. It does
not, and the evidence is clean enough to state plainly.

`ZombieStateApproach` measures its distance to `g_camera_eye_x/z` — to the
**camera**, not to a player — and picks how many steps to walk from which of
three concentric radii it falls inside. That was the first clue. The xrefs
settle it: every writer of `g_camera_yaw_bams` is a `cam/` path mode, the
split-screen midpoint of the two player view objects, the clear-pose helper, or
the results screen. None reads an actor, and none of the eight installers at
`0x00403970`..`0x00403A90` offers an enemy-tracking mode.

So during a combat wait the camera sits wherever its path left it and the
enemies walk to it. The camera *is* the player here, which is why the approach
rings are measured against it. Worth writing down because the perception that
it follows the attacker is a natural one — enemies converge on the camera, so
they end up centred without anything aiming at them.


---

## Correction: the camera does follow the enemies

I said it did not. That was wrong, and the way it was wrong is the same trap
this project has now hit twice.

The reasoning was: sweep the xrefs on `g_camera_yaw_bams`, find that every
writer is a path mode, the split-screen midpoint, the clear-pose helper or the
results screen, and conclude nothing aims at an actor. Every step of that is
true. It is also the wrong question, because **the tracking never writes a
yaw** — it writes a *point*, and a separate damped step turns the camera toward
it. Absence in one narrow query is not absence in the program. The skip flag
earlier in this project failed the same way.

The user's correction was precise and it is what pointed at the answer: "the
camera doesn't move but the angles / look-at definitely does". That is two
separate mechanisms, and looking for one that did both is why I missed them.

What is actually there, in three pieces:

* `SelectCameraLookAtTarget` (`FUN_00403050`) reads `g_enemy_slots`, a 16-entry
  `{u8 occupied; void *actor}` table, and picks a point: **the enemy holding an
  attack permit, alone**, else the midpoint of two registered enemies, else —
  only when none are registered — the `cam/` path's own target channel.
* `TryClaimAttackSlot` (`FUN_00455DE0`) is what makes an enemy "the one about
  to attack": one permit per player in `g_attack_permits`, and
  `ZombieStateApproach` may only enter its attack state if it gets one. The
  permit index lives in `obj+0x121`, and that single byte both gates the attack
  and selects the camera's focus.
* `StepCameraLookAtDamped` (`FUN_00402F80`) eases the block's look-at toward
  the desired point rather than snapping, at a rate `ComputeLookAtAngleError`
  reads from a curve indexed by the angle error. That is the smooth pan.

Two further things had to be understood before any of it was visible.

**The camera modes hide their own loops.** `CameraSnapToPathEye`,
`CameraStepDeferredRailWithFrameExport`, `CameraPathWithImpulseShake` and
`CameraPlayStashedPath` each re-point `g_camera_update_hook` at an address
*inside themselves* — `0x40C470`, `0x40C790`, `0x40C5C0`, `0x40C8B0` — so the
named function runs once and the steady state is a separate entry Ghidra had
not split out. Decompiling by name shows setup and hides the per-frame body.
`CameraHoldEyeTick` at `0x40C470` turned out to write **only** the eye, which is
half the answer to "the camera doesn't move but the angles do".

**The other half is authored.** `CamEvalPath7` returns eye and look-at as
independent channels, so a path can pin the eye and sweep the aim by itself.
Measured over stage 2's 66 paths: 3 hold the eye under 5 units of travel, and
paths 108 and 109 hold it at **0.00** over 160 frames while the target travels
150 and the yaw sweeps **110 degrees**. So both mechanisms exist and both
produce the same visible effect, which is worth remembering before attributing
a pan to either one.

---

## The gameplay loop: rings, permits, and the camera that follows them

Implemented the whole chain in the player. The decomp went in four steps and
each one hinged on something that an xref sweep alone would have missed.

**The camera modes hide their loops.** `CameraSnapToPathEye` and its three
siblings each re-point `g_camera_update_hook` at an address *inside*
themselves, so the named function is the first frame only. Splitting
`0x40C470` out as `CameraHoldEyeTick` showed it writes **only the eye** — which
is why the camera can sit still while the aim moves.

**The tracking camera is a separate function entirely**, `CameraTrackEnemiesTick`
(`FUN_00402890`), reachable only through a table at `0x00576CC8`. It calls
`SelectCameraLookAtTarget`, eases with `TurnLookAtToward`, and takes its rate
from `ComputeLookAtAngleError`.

**Registration is gated on a flag that the approach state owns.**
`RegisterForCameraTracking` skips any actor with `obj+0x34 & 0x10000`, and
`ZombieStateApproach` sets that while walking and clears it the moment the
actor wins an attack permit. So "the camera follows the zombie about to
attack" is not a heuristic anywhere — it is one flag, set in one place.

**The sort key had to be read as assembly.** The decompiler dropped the FPU
argument to `__ftol` in `RegisterForCameraTracking`, exactly as this project's
notes warn. The disassembly gives
`key = (int)(|actor − camera_eye| × 10.0f)`, radix-sorted ascending: nearest
first.

The turn-rate curve is the part that gives the camera its character: rate 64
(a 1/65 step) below about 18 degrees of error, ramping to 16 past 23. It
barely moves for small offsets and swings for wide ones.

### What was left open, deliberately

* **Walk speed.** The velocity source in the class-0x30 update was not found —
  no `fstp [reg+0x4c]` anywhere in `0x455000..0x459000`. Rather than invent a
  number, the player derives it from the ring table: an actor crosses a band in
  the number of steps that band allots, a step being one cycle of its walk
  motion. About 6 units/second on the default rings. Marked `[likely]`.
* **The strike.** Held for one step, then the permit is released.
* **Torso and head aim.** Asked whether zombies aim their upper body at the
  player independently of their body yaw. The pose path that has been read is
  pure motion: `SkeletonWalkNode` takes every bone's rotation from
  `g_frame_bone_rotations`, which points **into the loaded motion bank**, and
  nothing adds an actor-derived angle. `EnemyZombieInit` does compute a pitch
  and yaw toward the camera into `obj+0x1320/+0x1324` and no reader was found
  in the class-0x30 range.

  **Settled afterwards, and the answer is no.** Rather than leave it, I chased
  the stored callbacks as the note said to. `SkeletonApplyRootMotion` ends by
  calling a hook at motion block `+0x115C`, and a search of the whole program —
  197,671 instructions, not truncated — finds **exactly two** writes to that
  field: `PoseHookNone`, a bare `return` installed by `FUN_00410440` for every
  skeletal actor including the zombie, and `PoseHookGrowAndPushOutOfWorld` for
  one special class, which ramps a radius and pushes the actor out of world
  collision. Neither rotates a bone. With `SkeletonWalkNode` reading every
  rotation straight from the motion bank, there is no bone-level aim.

  What reads as aiming is the whole actor turning plus directionally selected
  motion variants — two walks on `obj+0x136C` bit 21, the attack on bit 27, the
  per-region stumbles, the four-arc deaths.

  The method note worth keeping: an xref sweep could not answer this either
  way, but a *hook* search could, because a stored function pointer is still
  written somewhere. "Find the writes to the field" is the move when "find the
  calls to the function" fails.

Data recovered along the way: the advance rings default to `{25, 38, 51}`
(`{37, 48, 51}` for character type 0) from `DAT_004C4CD0`, step counts 2 / +3 /
+4 from `FUN_00408D60`, and **no stage script uses evt `0x0E`** — the opcode
that would override the rings — so those constants are what every encounter in
the game actually runs on. Evt `0x0F` (54 uses) and `0x12` (6) do set the step
counts.


### Postscript: root motion is real, but it is not the walk

`SkeletonApplyRootMotion` (`FUN_00410C50`) converts the frame-to-frame delta of
the motion root into world movement, rotated by the actor's own orientation,
when `obj+0x64` bit 1 is set. That looked like the missing locomotion. It is
not: measured over the baked clips, the walk loop's root nets **+0.00** in both
x and z and only bobs by ±0.22, while the death clips net **−8.7** and
**−15.7**. Root motion carries a falling body away and nothing else.

So the approach velocity stays `[open]` — and slightly better characterised
than before, since it is now known not to be root motion and known not to be
written in the zombie's own code (no `fstp [reg+0x4c]` anywhere in
`0x455000..0x459000`).

---

## The strike, and damage to the player

The last of the gameplay loop. Four things worth recording.

**The strike is a table, not a state.** `ZombieStateStrike` (state 3) draws an
entry from `g_class30_attacks[char][body_condition]` and does what it says: play
the lunge until inside the entry's own distance, start the strike clip, shout
(`ActorPlayHitVoice` kind 3, which is what those two two-entry voice pools at
`0x005776A0`/`A8` were for), and call `ActorStrikeConnect` on the **exact frame
the entry names**. Not a collision test, not a distance check at the moment of
impact — a frame number.

**Shooting a limb off matters twice, and that is the nicest thing in here.**
Each entry carries a *cancel mask* of destroyed zones, and the hit whiffs if
every zone in it is gone. `znchain` has a right-arm swing cancelled by `0x2`, a
longer-reach left-arm one by `0x4`, a two-armed one by `0x6`, and a fallback
with `0x8` — outside the three-bit zone mask, so uncancellable. The *same* mask
indexes the pick table, so the zombie also reaches for a different attack:
`char_adv00` with a head always draws attack 2, and with the head shot off
always draws attack 3.

**One strike costs one life.** The entry's `+0x0A` looked like a damage amount
and is not — it is the motion the *player* plays when hit. `PlayerTakeDamage`
decrements lives by exactly one, subtracts 100 points, and sets 90 frames of
invulnerability. It also does `g_damage_rank_pending -= 2`, which
`UpdateDamageRank` consumes: being hit lowers the adaptive rank, which raises
the per-bone damage modifier. That closes a loop opened much earlier in this
session, when the rank table was read without knowing what moved it.

### The adjacent-array trap, third time

`g_class30_attacks`' rows are adjacent with no count, and a fixed-length scan
read the next row's attacks as this one's. The verifier caught it in the only
way it could: entries "hitting on frame 40 of a 20-frame clip", because the
frame and the clip length come from different tables and a misread cannot
satisfy both.

Bounding by the next row's address — the fix that worked for the reaction
tables — was not enough here, because different character types point into the
same rows at different offsets. The move that did work was to stop scanning
altogether: **the game only ever reads the entries its pick table names**, so
export exactly those and validate each against its own clip. Self-bounding, and
it needs no guess about row length at all.

Worth generalising: when a table has no count and its neighbours are ambiguous,
look for the *index source* and export what that names, rather than trying to
find the end.


---

## Correction: the ring table counts a queue, not steps

Committed the gameplay loop describing `obj+0x1358` as "how many steps an
enemy walks before it may attack", and derived the player's walk speed from
that reading. Both wrong.

`FUN_004090B0` runs once a frame over the distance-sorted enemy list and writes
each actor's **rank** into `obj+0x131D` — nearest is 0. The approach state's
test reads:

```c
if ((s8) obj[0x131D] < obj[0x1358] && obj[0x131E] < 3) TryClaimAttackSlot();
```

which is "if I am among the nearest N, and among the nearest 3 overall, I may
press an attack". The ring table is a **crowd throttle**, not a pedometer: far
out, a deeper slice of the queue is let through (9); close in, only the nearest
two. Nothing in the class-0x30 code counts a walking step.

How the reading went wrong is worth keeping. `obj+0x131D` is compared against a
count derived from distance, incremented nowhere I had looked, and sits next to
a genuine timer — so "steps walked" fitted every local fact. What broke it was
asking the boring question I had skipped: *what writes this field?* Three
writes in the whole program, one of them a rank assignment in a sort loop.

That also collapses the derived walk speed, which was justified entirely by the
step reading. Three candidates for locomotion are now ruled out — no velocity
write in the zombie's range, in-place walk clips (270/975/1000 net +0.00 to
+0.04 per cycle, against −8.7 and −15.7 for the deaths), and no step model — so
the player's closing speed is now labelled what it is: **invented**, present
only because the attack states plainly do close the distance and nothing
reaches striking range without it.

Two smaller things fell out of the same pass:

* `obj+0x4DC` and `obj+0x68C`, flagged `[open]` when `ActorUpdateBodyCondition`
  was read, are bones 5 and 8's draw-slot fields — `0x20C + bone*0x90` — so the
  body condition is derived from whether each **hand** still holds its original
  model.
* `ActorPlayHitVoice` kind 3, whose two-entry pools had no caller, is the
  **attack shout**: `ZombieStateStrike` raises it as the swing starts.

---

## Water: two systems, one name

Asked to look at water, on the observation that it is missing in some places
and "in the mesh" in others. Both halves of that are right, and they are
different systems.

**The surface is geometry, and nothing displaces it.** There is no water
renderer in the engine. `g_water_level`, the global that sounds like one, is
written by the class-0x51 water enemy's init and read only by that enemy — it
is the height it bobs at. The visible water is ordinary meshes, tagged in the
collision data by `WET_SURFACES` (5 and 55).

Two independent tables agree on where it is: stage 2's collision has 18 wet
quads at **y = −25.0**, and its script spawns a wave field whose plane is
**−25.5 / −25.0**. Stage 3 has 259 wet quads at the same height, and the two
footprints abut at z ≈ −2406 — one canal through both stages.

**Why it comes and goes.** In stage 2 the surface is twelve separate model
entries across five `pol/` files, each named by only a handful of regions; one
entry is named by exactly one region. `RegionDrawResidentSet` walks only the
current region's slot list, so water is drawn in 27 of stage 2's 58 non-empty
regions and not in the other 31. The browser player already reproduces that
rule, so "missing water" is a question about which region the walker is in
rather than about the water.

**The wave field is a query.** Classes 0x16 and 0x17 build a global plane plus
up to eight sources, travelling or circular. The travelling one accumulates
phase in the source's own `x`; the circular one walks the source along its yaw
and falls off linearly to nothing at 100 units. Both reduce to
`cos(2*pi * d / wavelength) * amplitude`, written as a BAMS cosine of
`(int)(d * 65536 / wavelength)`.

Its eleven callers are floating props and the water enemy. **None draws
anything.** So implementing it would move barrels, not water.

### Method note

The decompiler dropped the FPU arguments in both evaluators — the documented
trap in this project — and the phase expression is entirely in those dropped
operands. `WaveEvalTravelling` decompiles to something that looks like it
ignores its second parameter altogether; the disassembly shows it multiplying
the sampled point by a cosine. Anything with an `__ftol` call in it should be
read as assembly by default.

Also worth recording as a near-miss: I spent a while on `shading == -1` in the
water meshes, since 17 of 23 carry it and almost nothing else does. It is
`SHADE_CONSTANT`, a named mode the exporter already handles — the correlation is
real (water is flat-shaded) but it is not a fault. The white quad in the render
that prompted the detour is elsewhere in the scene.

---

## Three bugs in the gameplay implementation, and what each teaches

All three were reported from play, none would have shown up in a verifier, and
each is a different shape of mistake.

**The zombies turned away.** `TurnActorTowardCamera` uses
`VecToAngles(obj.x - p.x, ...)` — **actor minus camera**. I wrote camera minus
actor. That is exactly 180 degrees, and because the turn is eased it presents
as a slow rotation *away* rather than as an obvious backwards snap. I had even
written the correct expression into the annotation for that function and then
inverted it in the port.

**They stopped attacking.** There is one attack permit in single player, and an
actor that claims it and lands in a state with no handler holds it for ever.
Two doors into that: `attack_state == 0` is `g_class30_states[0]`, the engine's
*no-op* — **161 of the game's class-0x30 spawns carry 0 or −1** — and the
states that are not 1/2/3 (10, 15, 26, 30, 38; 51 more spawns) are approach
variants I do not model. So the first scenery zombie to reach the front of the
queue silently ended combat for the whole stage. Counting the spawns
afterwards was what made the severity obvious; the fix is to refuse the permit
rather than to add a timeout.

**The cat walked at the player.** `g_class30_states` is class 0x30's. The cat
is 0x53, civilians 0x10, scripted humanoids 0x25 — 279 placements — and I ran
the zombie approach on every character instance. The gate should have been
there from the start: a state machine belongs to the class it was read from.

The repeated-swing-with-no-damage was the second and third compounding: a type
with no usable attack entry entered the strike state, found nothing, dropped
straight out and immediately re-claimed, looping the lunge clip.

### And one enemy that is not meant to reach you

Stage 2 block 5 has two class-0x31 subtype-0x16 spawns at **y = 87** with 130
hit points, above the street. `EnemyThrowerInit` identifies them the way this
project identifies everything: it replaces bone 5 and bone 8's draw slots —
`obj+0x4DC` and `obj+0x68C`, the hand fields found earlier today from
`ActorBodyConditionFromHands` — with asset slots `0x1FA2`/`0x1F9E` instead of
the bare-hand parts, and the character resolves to **`zsass.bin`**. It spawns
with something in each hand and cannot walk to you. Its state machine is at
`LAB_00449910` and is unread, so the player gives class 0x31 no behaviour at
all rather than inventing one.

A pleasing coincidence while chasing it: the two per-class hooks
`ZombieStateStrike` calls turned out to be **water splashes**, gated on
`g_coli_hit_surface == 5 || 0x37` — the identical pair as `coli.py`'s
`WET_SURFACES`. The same two surface tags drive the ricochet sound, the wet
footprint of the canal, and a wading zombie's splash.

---

## The axe throw

Read class 0x31's state machine far enough to get the throw, which turned out
to need only four of its thirty states.

The route in was not the state table. Walking it from the entry state (20, an
entrance that hands to 7) would have taken a long time; instead I searched for
**writes of the held-item slot** `0x1FA2` that `EnemyThrowerInit` puts in the
hand. Two in the whole program: the init, and `ThrowerStateRearm`. That named
the re-arm, and searching for the *bare* slot `0x1F9F` gave exactly one write —
`SpawnThrownWeapon`. One xref from there gave the state that throws. Three
searches instead of thirty decompilations.

What it does is neat. The thrower **competes for the same attack permit as the
zombies**, and hands it to the projectile — so the weapon damages the player
the thrower had claimed, and the permit is not free again until the throw
resolves. Throwing leaves the hand bare and sets that arm's **destroyed-zone
bit**, the same bit shooting the arm off would set, which is why the cancel
mask works unchanged for both: an arm that has thrown and an arm that has been
shot off are the same state.

The flight is simpler than expected and worth recording precisely, because it
would be easy to over-engineer: `ttl = distance / 1.2`, `velocity =
(target − position) / ttl`, straight line, constant speed, and on expiry it
calls `PlayerTakeDamage` **outright**. No collision test. The target is a point
four units in front of the camera. Same design as the melee strike landing on a
frame number rather than on contact — this engine times its hits, it does not
test them.

Two details that pay off elsewhere: the projectile registers for the shot test,
so you can shoot an axe out of the air (it ricochets away with `BULLET_MET3`,
the same sound as a shot that does nothing to a zombie), and it registers for
camera tracking, so the camera follows a thrown weapon.

### A check that had to be weakened

I asserted the cancel mask always names the throwing arm — 2 for the right
hand, 4 for the left. It does for body conditions 0, 1 and 3, and **condition 2
uses a different clip with the uncancellable mask 8**. Twelve of sixteen hands
match the rule. Weakened to "one of 2, 4 or 8" with the match count reported,
which still catches a stride error and no longer claims more than the data
says.


### Postscript: the throw exported nothing, and why

Committed the thrown weapon, re-exported, and **no bundle carried a thrower**.
The tables were all correct; the actors never existed.

`resolve_for_stage` drops any spawn whose class has no entry in
`MOTION_RULES` — "marker only", since an unposed character is a heap of parts.
Class 0x31 had no rule, so all 49 of its spawns across the game were skipped
before `_build` ever ran, and the throw tables I had just decoded were attached
to characters that were never constructed.

The rule was one line away in the same function I had already read:
`EnemyThrowerInit` does `obj+0x1B4 = (char == 0x17) ? 0x1BA : 0x3A8`, the same
shape as `EnemyZombieInit`'s `0x3BC`. Added as a `by_char` rule kind.

Worth generalising: **decoding a class's tables and exporting its actors are
two different things**, and the second silently no-ops. `verify_combat.py` now
asserts that every class with a motion rule yields at least one posed
placement, and prints the ratio — `0x30=283/283, 0x31=49/49, 0x53=4/4` — so a
class that is decoded but not exported shows up as a failure rather than as an
empty scene.

---

## Three more gameplay bugs, and the state I never read

Reported from play: enemies do not take turns, they never walk backwards, and
they close until they overlap the camera. All three are the same omission —
**state 4**, which I had been mapping to "re-approach" without ever
decompiling it.

`ZombieStateBackOff` (`FUN_00455C30`) plays the back-away walk from
`g_class30_motion_rows[char][cond][4]`, turns away from the position recorded
when the strike began, and **keeps the attack permit through the whole
retreat** — releasing it only once the actor is back outside the inner ring or
240 frames have passed. So:

* the pause between attacks *is* the retreat. There is no cooldown timer for an
  ordinary zombie: `ZombieStateHoldAtRange` forces `obj+0x133C` to zero unless
  `obj+0x1368` bit 0 is set, and only state 4 clears it on exit;
* the backwards walk is a real clip — 256 for `char_adv02`, 1008 for
  `char_adv00`, both about 70 frames;
* and nothing walks inside the inner ring, because `ZombieStateAttackRun` stops
  at band 1 and hands to the hold. My `advance` had no floor, so the 161
  class-0x30 spawns with no attack state walked through the camera for ever.

Also corrected a naming mistake with consequences. I had called
`PTR_PTR_00592CBC` the "alternate hit-reaction table" and marked the path
`[open]`. It is nothing of the kind: it is the character's **general motion
row** per body condition — 0 and 1 the walk variants `ZombieStateApproach`
picks between on bit 21, 2 and 3 the attack run, 4 the back-away, and 4..6 the
reaction set at `+0x10`. Reading it as a reaction table meant I never looked
for the walk clips in it, which is why the actors have been sliding rather than
walking.

### And why the axe throwers never threw

`FUN_0044CA40`, class 0x31's permit claim, is `TryClaimAttackSlot` instruction
for instruction — and **neither tests the distance queue**. That gate
(`obj+0x131D < obj+0x1358 && obj+0x131E < 3`) lives in `ZombieStateApproach`,
*before* the call. Class 0x31's throw state calls the claim directly.

I had applied the rank gate to the thrower, so the two Johnnys in stage 2 block
5 — which spawn at y = 87, deliberately out of reach — always had a high
distance rank and never got a permit. A class-0x30 rule applied to a class that
does not have it.

The actor the report described as walking at the camera turned out to be a
different one: block 5 **step 3** is `tutorial.bin` (character 19, class 0x30,
attack state 0), not the throwers at step 6. It was walking for the third
reason above.

### A bundle that no browser could parse

The back-off export shipped `NaN` into two stage bundles and the player died on
`SyntaxError: Unexpected token 'N'` before drawing anything.

Cause: I added the throw clips to the bake list **outside** the
`bone_count == 16` guard that every other motion has. `zsass`'s throw table
carries a body-condition-2 row whose motions belong to `kame.bin` — the throw
table at `PTR_DAT_00592A00` is indexed by body condition and shared by every
character, so rows for conditions an actor never reaches name another
creature's clips. Read at a 16-bone stride, motion 441 decodes into whatever
follows it in the bank: denormals, ±1e38, and a NaN.

Two fixes, and the second matters more than the first:

* `_bake` rejects a motion whose root translation is not finite. A motion read
  with the wrong stride does not fail, it returns garbage, and "the root is not
  finite" is the cheapest true statement about that garbage.
* `json.dumps(..., allow_nan=False)` on both bundle writers. Python emits bare
  `NaN` and `Infinity` by default, which are not JSON; every consumer rejects
  them with a byte offset rather than a field name. **An export that fails is
  strictly better than a bundle that cannot be parsed**, and there was no
  reason for the writer to be permissive.

The lesson is the guard, not the NaN: every other motion source in that
function is wrapped in `if c.bone_count == 16` and I added a fifth one beside
them without it. Guards that exist four times and are missing once are worth a
second look during review.

### `bone_count == 16` was a proxy; the real rule is in the data

Challenged on the guard, and rightly. Sixteen is not a property of anything —
it is "the humanoid skeleton `zom.bin` was authored for", written as a
constant and copied to five call sites.

The real rule was already provable from the format. A motion block declares its
frame count in its first four bytes and occupies everything up to the next
block, and `verify_mot.py` shows `frames * stride` accounts for that span
exactly on all 1058 blocks. So the stride is `span / frames`, and inverting
`(bones * 6 + 15) & ~3` gives the bone count the block was **authored for**.
`MotionBank.implied_bone_count` does that, and `_bake` now refuses any motion
whose implied count differs from the character asking for it.

Measured: `kame.bin`'s motions 441 and 443 imply **24** bones; everything the
humanoid tables name implies 16. So the guard and the rule agree on today's
data — but the rule states *why*, works for the 19-bone cat and anything else
added later, and catches a foreign clip by construction rather than by a NaN
appearing downstream.

All five `bone_count == 16` guards are gone. `verify_combat.py` now asserts
each character's back-away clip implies that character's own skeleton, rather
than asserting the character is a humanoid.

## The player is a port now, and it can be saved

Two things landed together, and each is what makes the other worth having.

**The port.** Gameplay code moved out of `web/src/enemies.ts` — deleted — and
into `web/src/game/`, one TS function per exe function under the name
`ghidra/annotations/functions.tsv` gives it, with the `FUN_` address in the doc
comment. `game/globals.ts` is the data segment: `g_attack_permits`,
`g_player_lives`, `g_enemy_approach_rings`, all named as the annotations name
them. `game/actor.ts` is the object struct with the offsets in the comments.
`game/registry.ts` is `g_class_handlers`, so a class with no module gets no
behaviour rather than accidentally getting the zombie's.

`game/` may not import three.js and may not call `Math.random`.
`tools/verify_port.py` checks both, checks every `FUN_` citation against the
annotations, and reports the coverage: **33 of 101 annotated gameplay
functions**, 2 of 22 read classes, 5 declared `[diverges]`.

**The save state.** `world.save()` returns plain JSON that fully determines the
next frame; `world.load()` puts it back. It works because the port keeps its
state where the engine keeps its state — one enumerable `G` and a list of
plain-data actors — and because the renderers hold nothing a snapshot would
need. Restoring calls `resync` and they rebuild from the actors. If a renderer
could not, that would be a bug in the split, and the snapshot is the test that
finds it.

### What the headless test found in the first five minutes

`npm run test:port` imports `game/` and nothing else. Two failures on the first
run, both live in the shipped player:

* **The lunge could never reach its attack.** `ZombieStateStrike` closes to the
  attack entry's own distance, and `znchain`'s distances are *inside* the
  25-unit inner ring — but `ActorAdvanceTowardCamera` clamped every state at
  that ring, because that clamp was added to stop actors walking through the
  camera. So a zombie lunged for ever, swinging at a range it could not reach.
  That is the "they swing but don't hit, and then repeatedly do the swing anim"
  report, and it had been read as an animation bug.
* **The clip clock belonged to the renderer.** `action.t` was advanced inside
  `CharacterLayer.update`, so a strike's hit frame could only arrive if
  something was drawing it. The port could not be run headlessly at all, and a
  save state restored while paused would have sat on a half-played swing for
  ever. It is `ActorAdvanceMotion` now, in `game/`, where `ActorSetMotion` and
  the motion job keep it in the engine.

Neither was findable by reading, and both were one assertion each.

## The class-0x30 attack loop, read properly

The player's zombies walked up to the camera and stood there. The port had
three compounding errors, and all three came from guessing at things the
tables state outright.

**The state indices were guessed.** `g_class30_states` (0x00592AE8) reads
1 `ZombieStateAttackRun`, **2 `ZombieStateHoldAtRange`**, 3 `ZombieStateStrike`,
4 `ZombieStateBackOff`, 22 `ZombieStateApproach`. The port had the strike at 2,
which is the hold, so the hub of the whole loop was never entered and the
strike was reached by an index that means something else.

**`ZombieStateHoldAtRange` is where a zombie decides to swing**, and it was
missing entirely. It owns three things nothing else does: the spacing (inside
`inner - 1` it sends the actor to `ZombieStateBackOff`, every frame, not just
after a swing), the permit claim, and the cooldown. The real loop is

```
<entrance> -> AttackRun -> HoldAtRange -> Strike -> BackOff -> HoldAtRange
```

with the permit claimed in the hold and released in the retreat.
`ZombieStateApproach` is a *second* entry path that claims early and routes to
the descriptor's own attack state, and **no spawn in stage 2 starts there.**

**The start state is descriptor byte +2**, which `EnemyZombieInit` reads and
the exporter has always emitted as `initial_state`. The port ignored it and
started everything in `Approach`. In stage 2 the commonest starts are 1
(`AttackRun`, 32 spawns), 15 (`WalkDistance`, 19), 27 (18), 18, 31, 29 — never
22. States 15 and 27 both end by setting state 1, which is what justifies an
unported entrance resolving to `AttackRun` rather than aborting.

**`attack_state` does not gate the swing.** Byte +3 is read only by
`ZombieStateApproach`, to pick which state a permit-winner enters. The port
used it as "may this actor attack at all" and refused a permit when it was 0 or
-1 — which is 32 of stage 2's 90 zombies, including the single commonest
descriptor in the stage. In the game they attack perfectly well.

### And the movement `[open]` closes

`CLOSING_SPEED = 6` was invented on the grounds that no state writes a
velocity. That was true and the conclusion was wrong. `EnemyZombieUpdate`
integrates `obj+0x40 += obj+0x4C`; `ZombieStateWalkDistance` *measures* how far
the actor has travelled from a remembered point; neither makes sense unless the
clips move it. Measured on `char_adv02`'s own motion row:

```
walk       motion 270   31 frames   net  +0.023   in place
run        motion 264   16 frames   net -19.333   1.289/frame, 77 u/s
back away  motion 256   36 frames   net +15.000   0.429/frame
```

So the approach genuinely does not move — it plays an in-place walk while it
waits its turn — and the attack run closes at thirteen times the invented
speed. The port applies the clips' own root motion now. What is still `[open]`
is only the *mechanism* by which the root delta reaches `obj+0x4C`.

### The bug the headless test caught this time

A one-shot owns the body while it plays, so the base clip's root frame goes
stale underneath it. The first base delta after a strike ended therefore
spanned the entire swing and teleported the zombie eleven units — straight into
the camera. Forgetting the base frame while an action runs is the fix; the
trace that found it took one run.

### Also read, for the drop

Two more states, both scripted travel rather than physics:

* `ZombieStateLeapToPoint` (class 0x30 state 24, `FUN_00457CE0`) reads a
  destination and a frame count out of the descriptor and sets
  `vel = (dest - pos) / frames`.
* `ThrowerStateFallAndLand` (class 0x31 state 2, `FUN_0044A450`) sets
  `obj+0x5C` to **-0.05444444** — gravity, -196 units/s² at 60 Hz — and falls
  until `y + vel.y <= QueryGroundHeightAt(x, y + 4.5, z)`, then snaps to the
  ground and bounces with `vel.y *= -0.5`, `vel.xz *= 0.5`. Character type 0x16
  (zsass) never re-bounces and lands into state 7. `EnemyThrowerUpdate`
  integrates acceleration as well as velocity, which is what makes it a fall.

Stage 2 block 5 step 6 spawns two zsass at y = 87 with the ground at ~36, which
is the drop the player is missing. It needs the class-0x31 descriptor tail
exported — the exporter reads it only for class 0x30 — and a ground height the
bundle does not carry.

## The drop, and a spin axis I got wrong twice

**Spawns placed in the air ride a ballistic arc named in their own
descriptor.** Class 0x31 state 20 (`ThrowerStateLeapToPoint`) hands the actor's
position, a destination at descriptor `+0x04/08/0C` and a duration at `+0x10`
to `ActorArcBegin`, and `ActorArcVelocity` rebuilds the velocity every frame:

```
vel.xz = (dst - src) / T
vel.y  = -0.027222222*n + (T*T*0.027222222 + 2*dy) / (2*T)
```

Exact projectile motion, and the 0.027222222 is half the 0.05444444 that
`ThrowerStateFallAndLand` puts in `obj+0x5C` — which is what a discrete
`pos += vel; vel -= g` integrator needs for the arc to land on time.

The data agrees exactly. Stage 2's seven leap spawns are all class 0x31 state
20, and the two the report named — block 5 step 6, `0x20E8` and `0x2120` — sit
at y = 87 with destinations at y = 37, the street: **50 units down over 30 and
35 frames.** No gravity simulation and no ground query is involved; the landing
point is data.

`EnemyThrowerInit` reads its start state from descriptor byte +2 exactly as
`EnemyZombieInit` does, and the exporter was only reading that tail for class
0x30, so every thrower started in the throw state and stood in mid-air.

### The knife's spin: Z, then X, then Y

Reported as spinning about the wrong axis, and it took two reads to get right.

`ThrownWeaponUpdate` draws the weapon as
`Rz(obj+0x6C) * Ry(obj+0x68) * Rx(obj+0x1364 + obj+0x64)`, and this repo's own
annotation for it said "obj+0x1364 added to the X rotation as spin" — so the
first reading was **X**. That is where 0x1364 goes, but it is zero in flight.

`ThrownWeaponFlyToTarget` is what actually tumbles it:

```c
if (obj[0x1358] == 5) obj[0x68] += obj[0x135C];
else                  obj[0x68] -= obj[0x135C];
```

`obj+0x68` is the **Y** term, and 0x1358 is which hand threw it, which is where
the two hands' opposite spins come from. X and Z are set only on landing, when
`AimThrownWeapon` turns the stuck weapon back to face the camera.

So the port had it on Z, the first fix moved it to X, and the answer is Y. The
lesson is the one the method already states: the draw call says which term is
which, but only the writer says which term is the spin. The misleading
annotation has been corrected in place.

## The zombies stopped advancing, and why the test did not catch it

Porting the movement to root motion made every zombie stand still. Two causes,
and the second is the interesting one.

**The exporter never baked the run.** `resolve_for_stage` collected motion-row
indices `(0, 1, backoff)` — written when the approach was believed to do the
walking, before `ZombieStateAttackRun` was read. The states index `row[2]` and
`row[3]` for the run, and the closing *is* that clip's root motion, so with no
clip there is no movement. It now bakes 0, 1, 2, 3 and the back-away, and every
class-0x30 type in stage 2 gains both variants with real forward translation:
`char_adv00` −9.6 and −30.0, `znkage` −15.7 and −15.4, `znebi2` −11.8 and −14.6.

**The port asked for an index, not a clip.** `row[MotionRow.Run] ?? row[Alt]`
never fell through, because `row[2]` *is* a number — 272, 1022, 433 — it just
had nothing baked behind it, and `ZombieSetMotionIfIdle` then refused it and
left the actor on its idle. `FirstBakedOf` picks the first entry that actually
resolves to a clip. That matters beyond this bug: a row entry can legitimately
name a clip authored for **another skeleton**, which `_bake` rightly refuses.

**The synthetic test passed throughout**, because its motion row was written by
hand with a run clip in it. A headless test over invented data cannot catch a
bundle that is missing something — so the guard belongs in the corpus verifier,
and `verify_combat.py` now has it: every motion-row entry the ported states
read must be baked *if it belongs to that character's skeleton*, an entry
authored for another skeleton is reported rather than failed, and a type with
nothing that closes is called out by name. Run against the old exporter it
fails with **43 unbaked entries and 6 types that could never reach the player**.

That is the shape of the lesson: the port test guards the state machine, the
corpus verifier guards the data it runs on, and neither substitutes for the
other.

## Still not advancing: a signed byte and a state I did not read

The debug labels earned their keep immediately — "3/1/2 0x1E00 is just
HoldAtRange/0" named the actor, and its descriptor said `initial_state = 21`,
so it should have been in the attack run. Two causes.

**`obj+0x131D` is signed.** Every test reads it as `(s8)`, and
`EnemyZombieInit` writes `0xFF` — which is **-1**, so an actor that has not
been ranked yet passes `rank < allowance` rather than failing it. The port
stored 255. Since the renderer sets `visible` *after* the game phase, an
actor's first frame always runs before `RankEnemiesByDistance` has seen it, so
every zombie failed the test on frame one and dropped out of the attack run
immediately.

**`ZombieStateWaitTurn` (state 5) is the way back, and I had not read it.**
`ZombieStateAttackRun` sends a dropped-out actor there; it plays the *in-place*
walk, turns to the camera at 0x40 a frame, and returns to state 1 the moment
the rank is inside the allowance again. So the queue throttle is a **round
trip**. The port routed the drop-out through a made-up abort into
`HoldAtRange`, which has no exit except "too close" or "claim a permit" — so a
zombie that dropped out at 120 units parked in the hub for ever. That is
exactly `HoldAtRange/0`, standing still.

`ActorAbortAttackAndLeave` (`FUN_0045D9F0`) was also being cited for behaviour
it does not have: it is three calls that take no actor and assign no state. It
was an assumption from the very first pass at this file and it survived four
commits because nothing checked it. The port's own fallback is now named for
what it is — `ZombieGiveUpAttack`, tagged `[diverges]`, with no `FUN_`
citation — and it routes to `WaitTurn`, which has a way back.

`npm run test:port` gains the round trip, asserted on the state directly
because the director re-ranks every frame. Restoring the unsigned rank makes it
fail. The synthetic scene cannot reproduce the *stranding* half, because the
rank reset that now runs for unranked actors is itself part of the fix — so
that half is asserted as the recovery it is, rather than contrived.

## The route, the lockstep, and a tool to stop guessing

Three reports, and the first thing that changed is how they got answered:
`npm run replay -- 2 3 1` drives the port over a real stage bundle headless and
prints what every actor is doing under the same `block/step/n` labels the debug
boxes show. Two rounds of guessing at "stuck in WaitTurn" preceded it; the
third round took a minute.

**`ThrowerStatePathFollow` (class 0x31 state 26)** is a spawn that walks a
route before it fights. The descriptor carries a delay at `+0x04` and then
16-byte waypoints at `+0x08` — `{s16 step, s16 motion_set, f32 x, f32 y,
f32 z}` — terminated by a step of -1. Stage 2's `3/3/4`, descriptor `0x1EF0`,
waits 30 frames and then climbs: y = 100, y = 110, y = 115, and only then
throws. A second, `0x7EA4`, walks five legs.

Each leg is `ActorArcBeginTo`, and Ghidra hides the interesting half of it:
`__ftol` is shown taking no argument at all, and the disassembly says

```
FLD [sx]; FSUB [dx]; FLD [sz]; FSUB [dz]     ; 2D only -- y is not in it
... FSQRT ; FIMUL [step] ; CALL __ftol
IDIV [step] ; SUB ECX,EDX                    ; T = n - n % step
```

so `step` is **frames per unit** — 1 gives a unit a frame — and it doubles as
the arc kind `ActorArcStep` switches on.

**The crowd was moving in lockstep**, and the reason is one argument.
`ZombieSetMotionIfIdle` takes a start frame, and every caller passes a random
one: the approach and the attack run pass `rand() % clip_length`, the hold, the
retreat and the wait pass `rand() % 5`. The port started every clip at frame
zero, so two zombies given the same order at the same moment took exactly the
same steps at exactly the same time.

**Annotating by appending put a duplicate address in `functions.tsv` twice in
one session** — `ThrownWeaponFlyToTarget` and `RankEnemiesByDistance` — because
the address was already named and I did not look. `tools/annotate.py` upserts
by address now: it refuses to rename without `--rename`, replaces the comment,
and appends only what is genuinely new.

---

## Session 22 — class 0x41, the item containers

**Outcome:** spawn class `0x41` is read and ported. `web/src/game/class41/`
holds the placer, the type-0 group constructor, the breakable prop's own state
machine and the item releases; `verify_port.py` is green and
`web/test/port.test.ts` gained 25 assertions for it.

### What the class turned out to be

`PropContainerPlacerUpdate` (`FUN_00461CD0`) is three instructions — dispatch
`obj+0x130C` through the 79 constructors at `g_class41_constructors`, then
`ActorKill`. It is the most-placed class in the game (441 spawns) and it is a
*stub*: nothing it places is itself.

Type 0, `PlaceBreakableGroup`, is the container mechanism, and reading its one
consumer — `BreakablePropUpdate` (`FUN_00464620`) — settled what the items
actually are. Set 1 is **the extra life**: `SpawnExtraLifePickup` builds a
pickup whose shot handler calls `FUN_00415630`, which adds one to
`g_player_lives` or pays 300 points at the cap, so that routine is now
`GrantExtraLife`. Set 3 is **the golden frog** — a full `0x13F4` actor of
character type `0x1C`, which the skeleton table resolves to `frog_gold.bin`.
Sets 2 and 5–8 are the generic score pickup.

### Three things the docs had wrong, all found by reading the consumer

1. **The item does not drop on the last break.** `spawns.md` said it did. The
   constructor seeds `g_item_set_countdown` with `rand() % n + 1` and each
   break of a set member decrements it, so it is a **random** one of the set's
   breaks. Two runs of stage 2 pay out at different times.
2. **Member record `+0x05` is not an asset variant.** The constructor writes
   the asset slot unconditionally and puts `+0x05` in `obj+0x2A0`, whose only
   reader is `SpawnStoryModeItem` and only while `g_GameMode == 1`.
3. **Only the destroying shot pays.** `BreakablePropAwardHit` takes an award
   flag; the crack passes 0 and the destroy passes 1. Cracking a prop is worth
   nothing.

### What I got wrong

* **I checked the `+0x05` field with the wrong dict key** — `m.get("variant")`
  against a record that spells it `asset_variant` — got `None` for all 42, and
  wrote "unreachable in the retail data" into an annotation on that basis.
  Three members do carry one. A `.get()` that cannot fail is not a check; the
  fix was to print the record and read it.
* **I named the modes from memory.** I called `g_GameMode == 1` "Boss Mode"
  and `== 2` "Training Mode" and got as far as committing
  `SpawnBossModeItem` and `g_training_lesson` before checking `globals.tsv`,
  which already reads the global as *1 = original/story, 2 = arcade, 3 = boss
  rush*. Renamed to `SpawnStoryModeItem` and `g_prop_target_set`, and the
  four member sets are now described by number with the naming marked
  `[open]`. The repo's committed annotation outranks what I think I know
  about the game.
* **I ran `git checkout` on a shared file.** `./ghidra/run.sh
  export-annotations` cannot run while the GUI holds the project — it aborts
  on a lock error, as the skill says — so the `functions.tsv` diff I saw
  afterwards was a **peer session's live edit**, not my export, and I reverted
  it. Their tooling rewrote it seconds later so nothing was lost, but the rule
  is: never `git checkout` a file in this tree, and read `script.log` before
  believing an export happened.
* **I conflated destroyed with falling.** The first draft had a destroyed
  ground-level prop turn into a falling husk. It does not: its object entry
  point is overwritten with `BreakableEffectUpdate` and it becomes a puff.
  Only a prop whose *supports* have gone ever falls.

### Two dead branches, transcribed as dead

* The fall's land-on-another-prop test reads `obj+0x40..0x48`, and nothing in
  class 0x41 ever writes them — `ActorAlloc` zeroes the object from `+0x34`
  and a prop keeps its position at `+0x19C`. So it compares zero with zero for
  every pair and cannot fire. Ported as written, with the field carried as
  `hitPos` so the reason is visible.
* The yaw draw's `& 0x8000FFFF` and sign-extension are the compiler's
  `% 0x10000` idiom and are dead too: MSVC's `rand()` is 15 bits. The port
  routes every `rand()` in this class through `MsvcRand`, because a 32-bit
  draw would make both branches live and put half the props at a negative yaw
  the engine cannot produce.

### Next actions

* **Wire class-0x41 spawns into the live player.** The port is driven by
  `port.test.ts` but not yet by the running page: `ActorSpawn` is only called
  from `render/characters.ts`, and only for spawns that resolve to a skeleton,
  so a placer never reaches the registry. Extracting spawning from the
  renderer is step 5/7 of `PLAYER_ARCHITECTURE.md` and this is another reason
  to do it.
* **Draw the props.** The port sets `x/y/z`, `pitch/yaw/roll`, `slot` and
  `state`; nothing reads them yet. Slots `0x19E8` / `0x19E6` / `0x1A0F`.
* **Read type 4** (`PlaceKindedProp`, 70 spawns, the most-placed of the 79)
  and `FUN_00465FB0`, its prop. `FUN_00461CF0` is a single shared handler
  behind ~40 of the types and is 3042 bytes; it is the next big one.
* `FUN_004653B0` (the shatter fragments) and `FUN_004675A0` (the mode-1 item)
  are unread.

## The root track is a bone, not a odometer

Three reports at once — the camera on the zombies' feet, the walk sliding
backwards, and no pause between bites — and they turned out to be one
misreading with three faces.

**`m.root` is the root bone's position inside the model.** Its y sits around
11, which is standing height, and its x/z carry the character's travel:
`char_adv00`'s walk wobbles +/-0.7 and nets +0.03, its run runs to -30 over a
cycle, its back-away to +9.6, and its bite runs **0 -> -18.1 -> -15.55**, a
lunge and a recover. The port was consuming the horizontal delta as world
movement *and* the renderer was setting the pivot to the absolute root, so the
model slid out of its own footprint and snapped back on the loop. The pivot
keeps the height now and nothing else; the port keeps the travel.

**The camera aims at `obj+0x100`, never at `obj+0x40`.** `SkeletonEmitNode`
records a bone's world position there as it walks the skeleton — bone **1**,
the torso, for an ordinary humanoid — and `ActorRegisterCameraPoint` raises it
by 4.0 before the actor registers for tracking. `SelectCameraLookAtTarget`
reads only that. The port was aiming at the actor's origin plus a flat 12,
which is the feet.

**The pause between bites is the recover.** The bite ends 15.5 units forward of
where it started, and that is exactly the distance `ZombieStateBackOff` then
has to walk before `ZombieStateHoldAtRange` will let it claim again. Nothing
times it; the geometry is the timer. The previous commit had suppressed the
strike's travel to stop zombies ending up behind the player, which removed the
recover and with it the pause — so the zombie ended its swing already on the
ring, the retreat finished on its first frame, and it bit again on the spot.

The real fix for "behind the player" was never to suppress the travel: it was
that the renderer was double-applying it.

## Every transition was a cut

The motions snapped — most visibly from the bite into the walk-back — and the
answer was in calls already read and not looked at closely enough.
`ActorSetMotionBlended` (`FUN_004119A0`) takes **four** arguments, and the
fourth is a cross-fade length: it lands at `track+0x30` as length+1, next to
the start frame at `+0x08` and its half at `+0x18`. Every state passes one.

```
ZombieStateApproach   walk    5      ZombieStateAttackRun   run       10
ZombieStateStrike     swing   5      ZombieStateHoldAtRange idle      10
                                     ZombieStateBackOff     retreat   10
                                     ZombieStateWaitTurn    walk      10
                                     ZombieStateStrike      lunge     10
```

`ActorSetMotion` (`FUN_00411930`) is the one with no fade, and it is used for
the scripted cues that are meant to cut — the leap, the entrance. So the engine
distinguishes the two and the port did not: it swapped `obj.motion` outright
and every change was a hard cut.

The port keeps the outgoing clip and its clock on the actor now, so the fade is
game state and survives a save, and the renderer blends the two with the
`applyBlend` it already had for the stumble.

Two things that were not obvious. The fade has to come out of **what is on
screen**, which right after a swing is the strike clip rather than the base
motion the swing was covering — fading from `obj.motion` there fades out of a
walk nobody could see, and the bite still cuts. And `ZombieStateStrike` ends
its clip a frame early, so `ActorAdvanceMotion`'s own end-of-clip branch never
fires for it: the fade has to start in `endStrike`, at the transition itself.

## There is no collision avoidance, and that is the finding

Zombies retreating into each other, so: where does the engine separate them?
Everything in the class-0x30 call graph got read looking for it, and it is not
there.

* `FUN_00452A10`, the last thing `EnemyZombieUpdate` calls, is **footstep
  sounds** — a motion id and a frame number switched into a sound id.
* The two radii `EnemyZombieInit` sets, `obj+0x124` from
  `g_actor_radius_by_char` and `obj+0x128`, feed
  `ActorUpdateBoundingSphere` — centre `(x, y + 0x128 + 1, z)` at
  `obj+0x12C/130/134` — and that sphere is read by the shot test and by the
  frustum test at `FUN_0045CA60`. By nothing else.
* `SortEnemiesByDistance` is a plain radix sort. It orders; it moves no one.
* `FUN_0045E770` is the carrier-platform transform, `FUN_0045DD30` a skeleton
  node lookup, `FUN_0045DA60` the leave-and-collapse path.

So the crowd is not held apart by a separation pass. It is held apart by three
things that were already read: only `g_enemy_approach_steps` of them may come
inside the mid ring, only `g_max_attackers` may attack, and **each attacker
retreats to the spot it came from** — `obj+0x13D8/E0`, captured when its swing
began. The port had replaced that last one with "walk away from the player",
which funnels every retreating actor onto the same radial. That was the bug.

### And the reason restoring it did not work first time

`FUN_00409E00` is a **rate limit, not an ease**: it steps an angle toward
another by at most *rate* BAMS per frame, and `ZombieStateHoldAtRange` and
`ZombieStateWaitTurn` pass 0x40 with `ZombieStateBackOff` passing -0x40 — a
third of a degree a frame. The port had been treating the rate as a fraction of
the remaining angle, so every turn snapped round in a few frames. That is
harmless while an actor is turning toward something far away and fatal when it
passes the point it is turning *relative to*: the direction reverses, the snap
follows it instantly, and the retreat walks straight back into the camera. With
a real rate limit it cannot reverse in one step.

### The on-screen gate

`ActorIsOnScreen` (`FUN_00409C10`) projects the actor's tracked point and asks
whether it lands inside the frame — half-width `g_projection_distance_px * 0.5`,
half-height a literal 240, which is the second independent confirmation that
this is a 640x480 projection. `TryClaimAttackSlot` calls it **before** handing
out a permit, so an enemy off the side of the screen cannot start an attack,
and cannot sit on the one permit while it is out of shot. Ported, through a new
`viewSpaceOf` on `GameHost`.

## Session: class 0x40, the class-0x41 lift, and what `+0x11C` really means

Three questions from one report: what is class 64 ("furniture?"), where is the
c65 lift, and why do zombies stay alive while seeking.

### Class 0x40 is not furniture — it is a flock of eight enemies

`PlaceHorde` (`FUN_0043BD30`) was not even a function in the Ghidra database;
`docs/formats/spawns.md` had it as "horde spawner" from a disassembly read that
was never written back. Created and read: it allocates N members into
`g_horde_members`, hands each its index at `+0x131B`, and dies. Every member is
character type **0x1D — `mol.bin`**, a six-segment chain, and dies to one shot
for 80 points playing `PDMG_MORR1/2_44.wav`. `HordeMemberUpdate`
(`FUN_0043C440`) is a seven-state machine with an entry spline, a wander box, a
dive at the camera and neighbour avoidance inside 6.0 units.

So the answer to "is it some furniture?" is no, and the answer to "should we
port it?" is "that is an enemy AI of zombie scale, separately". Named and
documented; not ported.

Two globals fell out of it and are worth having on their own:
`g_evt_block_index` (0x009A2BC0) — the block **currently executing**, which is
*not* `g_evt_block_counter` (0x009A2BB0), the monotonic count of transitions
prop lifetimes measure — and `g_scene_index` (0x009A1A08), proved by
`ColiLoadForScene` indexing its file list with it.

### The lift, and a name taken from the wrong noun

Class 0x41 type 32 is `FUN_0046A360`. Its three models all live in
**`komono_suimon.bin`** — *suimon* (水門), a sluice gate — and its leaves play
`DOORKICK3`. Two name tables agreeing, so it was called `WaterGateUpdate` and
committed to nothing.

Then it was rendered, and it is a **folding lattice cage gate seen from
inside**, with a passenger's legs visible through it. The corroboration that
settles it is in the code, not the picture: while script flag 0x37 is up the
routine holds `obj+0x1A0` at `g_camera_block_eye.y - 15.0`, and stage 2 raises
that flag over `cp_st2` path 28 (slot 83), whose eye **climbs from 55.0 to
144.2** — so the object rides from 39.6 to 129.2, and 40.0 is exactly where the
spawn puts it. An 89-unit vertical ride with the camera standing on it.

**The asset file is named for the area, not for the object in it.** That is the
trap; `komono_suimon.bin` entries 5, 6 and 9 are a lift. Renamed to `LiftUpdate`
everywhere before anything shipped.

The three hinges are `+0x1D0` (near cage pair), `+0x1E8` (far pair) and
`+0x1CC` (an overhead panel, `[open]` what it is), each stepping 0x200 BAMS a
frame under a script flag, and each test is `< limit + 1` — so every hinge
comes to rest **one step past** the round number. `PlaceGenericProp` case 0x20
seeds all three, which is what makes the sound cues, written as equalities
against the rest angle, fire once and only on the first frame.

### `+0x11C` is a lifetime that is only *sometimes* also a slot

Reading the lift's constructor turned up the real prop bug.
`PlaceGenericProp` writes the descriptor's `+0x11C` into `obj+0x28C` (the asset
slot) **and** `obj+0x11C` (the lifetime `PropExpireByBlockLifetime` counts
down). The exporter had been carrying it as a slot only, and
`lifetime_evt_blocks: 0`.

All 25 routines that open with the prologue were then read for one question:
does this one draw `obj+0x28C`? Three do — types 5, 12 and 33. The rest
hardcode their models. Stage 2's 67 generic props carry the values
`0,1,2,3,4,5` and then `0x1D8` and up with **nothing in between**, and the
types carrying the high values are exactly those three. So 46 of 67 were being
drawn as `char_adv03.bin`, `eff_boss4.bin` and `bg_adv10.bin` — characters
standing in for scenery, which is what "a lot of the props aren't rendering"
looked like. `GENERIC_DRAW_SLOT` now carries the literal each read routine
draws, and the exporter emits those templates instead of the lifetime.

Types 70, 71, 72 and 77 open with `if (g_GameMode != 1) ActorDespawn(obj)` —
Original Mode's collectibles, which in an Arcade run should be gone on their
first frame and were instead standing in the level for ever.

### The kinded props that have no model are *supposed* to have no model

With the generic props fixed the panel still said 9 of 16 props undrawn.
`PlaceKindedProp` sets `obj+0x28C = 0xFFFF` and overrides it for four kinds
only; the other seven draw `FUN_0040DD90(obj+0x324)` — the animated-effect
system. So those markers are not an export gap, they are a renderer the player
does not have. The status line now says which of the three reasons applies,
because "16 up (7 drawn)" was the least useful line in the panel.

### Seeking left every zombie the script had ever placed

`wait_enemies_alive` / `wait_enemies_present` block until the counters fall,
and the counters only fall when the actors die — so *past* one of those gates
every enemy placed before it is dead, by construction. The replay shoots
nothing, so nothing retired them: a seek to block 17 step 8 arrived with six
zombies from steps 3, 5, 6 and 7 standing behind the camera. Every path that
releases a wait without testing it now goes through one `stepOverWait`, which
applies the postcondition.

All 488 enemy gates in the six shipped scripts wait for **zero** — 54 of `0x43`
and 434 of `0x44` — so there is no "leave two alive" case to get wrong.

The set of classes retired is deliberately **not** `registry.ts`'s
`ENEMY_CLASSES`: that one is narrower on purpose, because an unported class in
it is an actor that never dies and therefore a gate that never unblocks.

### One game-mode enumeration, and the end of simulated combat

Two clean-ups that were each hiding a small bug.

**`game_mode` meant two different things.** The exporter emitted
`1 if original else 0` under the same name the EXE uses for
`g_GameMode` — 1 original, 2 arcade, 3 boss rush — so a bundle's `0` was the
EXE's `2` and every reader had to know which side of the seam it stood on.
Worse, **nothing in the player ever wrote `G.g_GameMode` at all**, so every run
was Arcade whichever bundle was loaded. That was harmless until class 0x41 grew
a branch on it: `PlaceGenericProp`'s types 70–72 and 77 despawn on their first
frame unless the mode is Original, and Original Mode's whole item hunt is
behind it. There is one enumeration now — `hod2lib.stage.GameMode` and
`web/src/game/game_mode.ts` — and `main.ts` copies the bundle's value straight
into `G.g_GameMode`.

Typing the global as the enum turned up something the tests had been asserting
against a mode that does not exist. `propScene` set `g_GameMode = 0`, a neutral
that is neither Original nor Arcade, and under it "a prop takes two shots" held.
In **Arcade** it does not: `PlaceBreakableGroup` turns the members
`g_prop_target_set` names into one-shot targets, and every group has at least
one of them. So that fixture is Original now — the mode in which an ordinary
breakable is an ordinary breakable — and Arcade's rule has its own case, which
turned up a detail nobody had written down: a one-shot target is **removed
outright without its hit point being spent**, so `hp` is still 1 afterwards.

**The Combat dropdown is gone.** `wait_enemies_present`/`wait_enemies_alive`
were paced on a per-enemy stopwatch (instant / 0.5 s / 1 s / 2 s / pass
through) from before the player could shoot anything. It can shoot now, so with
Shoot on the gate is the real gate and with Shoot off nothing can make the
count fall and it passes — no invented wait lengths in between. That removed
`simulateCombat`, `secondsPerEnemy`, the `combat` wait policy and
`ActiveSpawn.secondsLeft`; `liveEnemies` now means what its name says, the
spawns an enemy gate is actually waiting on.

### The enemy-gate retirement was applied to playback as well as to replays

Retiring the enemies past a `wait_enemies_alive` is right for a **replay** and
wrong for **playback**, and the first version did both. In play the gate opens
because the player killed them and `FUN_00454D20` is still playing the death
clip out before handing the body on — so sweeping the spawn list the moment the
last one dies takes the corpses with it and the bodies vanish mid-fall.

`Walker.replaying` now says which is which. `seek` owns it, the drive loop in
`test/seek.test.ts` sets it because that loop is a replay standing in for
playback, and `retireGatedEnemies` is a no-op without it. The playback
completion path in `advance` does not retire at all any more.

Both halves are asserted: playback keeps the bodies when the gate opens, and a
replay drops them because nothing else will. Removing the guard fails the first
and leaves the second passing.

## Session 31 — the camera does not cut, and every step was losing its first instruction

Started from a report: at `?stage=2&mode=play&block=17&step=5&op=36&frame=150`
the camera "snaps from indoor to outdoors" instead of moving across smoothly.
Two separate bugs, one in the camera and one much larger in the interpreter.

### What the report was *not*

The first hypothesis — that the camera cuts to another rail — is wrong here,
and measuring said so before any code was written. Block 17's shots are all
`cp_st2[26]`/`[27]`, and evaluated at the seam they are continuous to within a
hundredth of a unit: slot 81 at frame 700 and slot 82 at frame 0 are the same
point. Across stages 1-6, **148 of 631 consecutive `cam_play` pairs** *are*
discontinuous — some by 173 degrees — so the game does cut, deliberately and
often, and blending across those seams would be wrong. Block 17 is simply not
one of them.

### The camera: `SelectCameraLookAtTarget` has no "off"

`FUN_00403050`'s "nothing registered" case is a **fallback, not an exit**. It
writes `g_camera_lookat_target = g_cam_path_target` and clears
`g_camera_is_tracking`; `CameraTrackEnemiesTick` (`FUN_00402890`) then eases
`g_camera_block_target` onto it with `TurnLookAtToward` **unconditionally**,
taking the rate from the angle-error curve while an enemy is registered and the
flat `*PTR_DAT_00576C0C` (12) when none is. There is no path through that
routine that assigns the desired point straight through.

The port had it as `if (tracking) ease; else use the raw path target`, so the
frame the last enemy died the aim teleported back onto the rail — **20.8
degrees in one frame**, measured, at exactly the `wait_enemies_alive 0` the
report linked. `game/camera/track.ts` now holds the routine as written and
`g_camera_block_target` is real state in `G`.

Three things fell out of reading it properly:

- `FUN_00401DF0` returns the **square** of the cosine, so the `> 0.99999`
  convergence tests are ~0.18 degrees, not 0.26. Named `VecCosSquaredSigned`.
- `g_camera_settled` (0x009C6F2F) is what those tests raise, and
  `EvtOpWaitTargetsClear47` gates on it — so op 0x47 cannot mean anything
  without the ease.
- `if (g_enemies_alive == 0 && DAT_009C6F2E == 2) rate = 0` is **dead code**:
  `DAT_009C6F2E` is read in two places and written in none.

Deliberately not ported: `CameraEaseBlockEyeToPathPose` (`FUN_00402EF0`), the
1/16-a-frame ease of the block *eye* toward the pose block at 0x009C70C0.
`CamAdvancePathFrame` writes the block eye straight from the curve every frame
a `cam_play` is live, which is what the port does; the second pose block that
ease reads is only written by the deferred-rail hooks and has no port yet.
`[open]`

### The interpreter: `end_block` moved the pc, and then the pc moved again

The remaining symptom — the camera's *position* jumping in the doorway — was
not a camera bug at all.

`Walker.executeOne` ended with an unconditional `this.opIndex++`. `end_block`
(0x4F) calls `advanceStepOrRoute`, which sets `step += 1; opIndex = 0` — and
then the increment ran anyway, so **op 0 of every step entered through an
`end_block` never executed**.

`EvtAdvanceBlockOrRoute` (`FUN_0045F000`) is unambiguous that this is wrong:
it ends by assigning the instruction pointer outright,
`DAT_009C7108 = FUN_0045EB90(scene, block, step)`, the address of the new
step's *first* instruction. This VM has no shared post-increment at all —
every handler advances the pointer for itself, e.g. `EvtOpGotoSceneState31`
does `DAT_009C7108 += 8`. Landing on an instruction means executing it.

**460 of the 479 steps in stages 1-6 open with a real instruction.** What was
being dropped, by opcode: 118 `checkpoint`, 118 `set_hud_shutter_state`, 63
`asset_load_polfile`, 21 `queue_event`, 15 `set_collision_set_full`, 12
`region_load`, 12 `spawn_placed`, 11 `spawn_obj`, 10 `set_ground_plane_y`, 10
`set_script_flag`, 8 `region_enter`, 8 `asset_load_slot`.

In block 17 that is both halves of the report:

- step 6 op 0 `region_enter 32` never ran, so the outdoor geometry arrived a
  step late — the "indoor to outdoors" pop;
- step 7 op 0 `cam_play 231..365` never ran, so the camera clock sat at frame
  230 through two waits until step 7 op 13's deferred play threw it to frame
  366 — **the eye moving 41 units in one frame**, in the doorway.

The fix is to increment only when the handler left the program counter where it
found it. `test/seek.test.ts` now walks all six stages and asserts every step
it enters runs its op 0; on the old code that fails on all six, with 149 steps
starting late.

### Wrong turns

- Chased the `cp_`/`op_` seam analysis and the scene-state camera-hook table a
  long way on the assumption the snap was a rail change. It was not, and the
  seam measurement is what should have redirected the search sooner — it was
  taken early and then not believed.
- Read row 5 of `g_scene_state_table` as live and briefly concluded
  `CameraTrackEnemiesTick` might never be installed. Every shipped
  `EvtEnterSceneState` call passes major 1 or 2; whether major 5 is reachable
  is still `[open]`, and it does not affect the port, which runs the tracking
  camera because the tracking data (slots, candidate sort, permits) is
  demonstrably maintained.

### And a third: `start == -1` in a **deferred** play

Reported separately, same session: stage 1 block 8 step 4 op 25 threw the
camera back before the start of its path and replayed the lot, once.

Op 23 is `cam_play -1, 685, slot 44, flags 2` — resume *and* deferred. The port
handled `start == -1` only in the non-deferred branch and stashed the literal
`-1`, so the `finish_sequence 7` at op 24 set the clock to frame -1 and ran 686
frames instead of the 8 the script asked for.

`FUN_00403490`, the stash branch of `EvtActionCamPlay40`, says what it means:

```c
g_stashed_path_frame = operands[0];
if (g_stashed_path_frame == -1)
    g_stashed_path_frame = g_cam_path_frame + 1;
```

The `+ 1` is not in `CamStartPathPlayback`'s own resume, and the difference is
real: `CamAdvancePathFrame` evaluates then increments, the rail hooks increment
then evaluate. Both are now transcribed, along with the branch **order** —
`EvtActionCamPlay40` tests `start == end` before it tests `flags & 2`, and the
port had those the other way round. No shipped play is both static and
deferred, so that half changes nothing today; it is fixed because a
transcription that only happens to agree with the data is not one.

**[measured]** four plays in the game name `-1`, all four deferred (stage 1
blocks 3 and 8, both bundles); none of the 1110 non-deferred plays does, so
`CamStartPathPlayback`'s resume is unreachable from the scripts.

---

## Session 2026-08-31 — the install was rotten, not the format

**Prompted by a plain question**: compare the installed game tree against the
retail disc (`/Users/Shared/hotd2.iso`) and report the differences. The answer
invalidated a documented "anomaly" and ~400 lines of parser.

### Method

The disc ships an MSI plus one 421 MB `DATA.CAB` whose members are flattened to
`F<seq>_<name>`, and 376 basenames collide across `pol/`, `tex/` and `mot/`, so
basename matching cannot work. Parsed the MSI's `File`, `Component` and
`Directory` tables directly (OLE compound file → `_StringPool`/`_StringData`,
`_Columns`, then column-wise table streams) to rebuild true install paths, then
compared by SHA-256. Script kept at `tools/`-adjacent scratch; the MSI reader is
~110 lines and worth re-deriving if ever needed again.

### Result

2047 files: **2040 byte-identical, 0 missing, 7 modified in place.**

| File | Δ | What it was |
|---|---|---|
| `Hod2.exe` | 1 byte | `JZ`→`JNZ` at `0x004A6857` — deliberate no-CD patch, kept |
| `evt/st1evtbl.bin` | 1 byte | rot; a pristine `st1evtbl - Copy.bin` sat beside it |
| `cam/cp_st1.bin` | 203 bytes → `0xFF` | rot |
| `cam/cp_demo.bin` | 20 bytes → `0xFF` | rot |
| `cam/cp_title.bin` | 9 bytes → `0xFF` | rot |
| `cam/op_st1.bin` | 6 bytes → `0xEE` | rot |
| `pol/tv2.bin` | 14 bytes | **[open]** — see below |

### What this cost

`docs/re/anomalies.md` §7 and its `cam/` smashed-bytes section were **both
descriptions of local bit-rot**, and `hod2lib.cam` had grown a full restoration
engine to work around them: offset-table repair, sibling time bases,
duplicate/constant convictions, a partner/twin/order/nearest evidence ladder,
`Curve.damage`, `Path.damaged`, a bundle `repairs` field and a client warning
badge. `docs/formats/cam.md` had absorbed a `0xFFFF0000` "NaN padding
convention" that does not exist — those were two more smashed `0xFF` bytes.

The load-bearing error was the sentence **"both retail copies checked are
byte-identical, so this is how the game ships"**. Two copies of the same
*installed* tree are not two retail copies. Nothing was ever compared against
the disc.

After restoring the four `cam/` files from the disc: all 23 files parse to
**100.0000% byte coverage**, 418 paths, 3,018 curves, 44,800 keyframes, zero
repairs, zero unrecoverable channels, zero padding keys. The repair code is
deleted; `CamFile.parse` now raises `CamError` on any keyframe word outside the
sane range so a damaged copy fails loudly instead of being invented over.

### Also checked

* The Ghidra pipeline works unchanged against the **disc's** `Hod2.exe`: two
  isolated scratch rebuilds (disc EXE vs installed patched EXE) export
  byte-identical symbol sets — 486 functions, 731 globals, `failed=0`. The
  no-CD patch is a same-length opcode swap, so no address moves.
* The live Ghidra DB holds work the restore scripts do **not** reproduce: 62
  function names present only in the DB (a whole `Thrower*` class, ~53 of them,
  `0x449620`–`0x451480`), 65 more where the DB improves on an
  `ApplyKnownTables` placeholder, and 10 globals. Not yet written back.
* `verify_annotations.py` would reject a straight export today:
  `CameraUpdateTick` is used at both `0x40c370` and `0x414f10`.

### Wrong turns this session

* Set up a scratch Ghidra project with `ghidra/annotations` **symlinked into the
  repo**, then ran `export-annotations` against it — which overwrote the
  committed TSVs. Restoring from HEAD lost ~35 uncommitted rows a peer session
  had staged in the working tree. Scratch projects must copy the annotations,
  never link them.
* First reading of the `0xFF`/`0xEE` byte scatter called it "deliberate RE probe
  edits". It was media rot. The tell was there: single low bytes, always the
  same value, never a whole field.

### Next actions

1. Write the 127 live-only function names and 10 globals into
   `ghidra/annotations/`, resolving the `CameraUpdateTick` duplicate first.
2. `pol/tv2.bin` — 14 bytes differ from the disc in 6 clusters across
   `0x26F`–`0x3B7`, but unlike every other `pol/` file it is high-entropy on
   **both** sides, so the usual header check says nothing. Restore it from the
   disc and find out what reads it. **[open]**
3. Re-check whether any other extract-derived "anomaly" in `docs/re/anomalies.md`
   has the same cause — §6 `pol/etc_1.bin` offset table is the obvious
   candidate, and it is the same shape of claim.

---

## Class 0x31 is a wall-crawler, and its behaviour is a table

Reported as: *"the game has only implemented the walking zombies, but these
zombies move and jump around the walls etc, before jumping on and stabbing the
player (then jump back)"*, pointing at `17/5/1`, descriptor `0xB9E8` in stage 2.

That descriptor is class **0x31**, character type **0x19 = `zstin.bin`**, and
the port gave the whole class one behaviour — stand still and throw. Reading
the other thirty-one states turned out to be less work than it sounds, because
**the behaviour is not in the code**.

### The route in: a distance, a band, and a pick table

`ThrowerStateStandAndDecide` (state 7) does not decide anything. It calls
`ThrowerPickNextState` (`FUN_0044ADB0`), which measures the ground distance to
the camera, turns it into a band — 1 for `40 < d <= 50`, 2 for everything else,
and `d <= 30` short-circuits to state 8 — and draws a **state id** out of
`g_class31_action_picks[set][band][rand%10 + zones*10]`. `ThrowerTryEnterState`
(`FUN_0044AFB0`) then refuses it if the actor cannot do it right now.

`zstin`'s band 1 is `14 14 14 15 15 15 16 16 16 12` and its band 2 is
`7 7 7 7 7 7 7 7 7 13`. States 14, 15 and 16 leap onto the wall on either side
and the ceiling; 12 and 13 are the pounce. **That table is the reported
behaviour, verbatim.** Sets 1 and 3 have only `7` and the throw in the same
slots and set 2 has nothing but `7`, which is why the four character types that
share this machine behave nothing alike.

### The thing I nearly got wrong twice

`obj+0x130C` is **not** the body condition here. The port's `Actor.condition`
is that offset and is documented as "derived from whether the hands still hold
their slots", which is true of class 0x30 — `ActorBodyConditionFromHands` has
exactly one caller in the program and it is class 0x30's state 2. For class
0x31 `EnemyThrowerInit` writes the spawn descriptor's byte +1 there and nothing
touches it again, so it is a **behaviour set**. An agent reading the tables
labelled the four rows `0x16, 0x17, 0x18, 0x19` by position and concluded that
`zstin` never climbs; the data says row 0 is `zstin` and row 2 is `zskamere`,
identified by set 2's first motion being `0x1BA`, the clip `EnemyThrowerInit`
starts character 0x17 in. Reading the row as a character index would have made
the whole climb unreachable.

The related bit, and the one that makes the class coherent: `obj+0x136C` bits
6, 7 and 8 are **which surface the actor is stuck to** — ground, either wall,
the ceiling. Three independent consumers agree: `SelectActorGravityAxis`
(`FUN_00450CF0`) maps them to a gravity axis, `TraceActorSurfaceContactPoint`
(`FUN_0044C370`) to a probe direction, and `ThrowerLoadAttackArcScript` to an
attack row. So the wall-crawling is not a special case bolted on — it is the
same state machine reading a different row, and states 14/15/16 exist only to
set the bit.

### The stab is timed, not tested

`ThrowerStrikeConnect` (`FUN_0044CE60`) has **no range test at all**. It fires
when the clip reaches the attack entry's `hit_frame` and the cancel mask has
not wiped out the limb. The aiming is `ThrowerPickLandingPoint`, which
unprojects a fixed pixel offset at a fixed depth — a place on the *screen* —
and the arc puts the actor there on that frame. The same design as the zombie's
strike and the thrown weapon's expiry.

### Four wrong turns worth recording

**The clip clock.** `hit_frame` is 62 and clip 303 bakes to 34 keys, so the hit
could never fire. `g_anim_frame_counts` and every threshold in this class are
in **engine frames at 60 Hz**; `mot/` is authored at 30 Hz. Reading the baked
index made the pounce land silently and connect never — the actor arrived, the
animation played, and nothing happened, which is exactly the failure that is
hardest to spot from a state trace.

**The 12-dword blocks are not waypoints.** I briefed an agent that
`DAT_00564A68` and friends were 16-byte waypoint lists, because a genuine
16-byte waypoint format exists a few states away in `ThrowerStatePathFollow`.
They are three-stage **arc motion scripts**, `{motion, start, fade, threshold}`
×3 — one clip cut into windup, flight and landing. Two agents found that
independently and the brief was corrected mid-flight.

**The adjacent-array trap, again.** `g_class31_melee_attacks` gives set 0 five
stance rows, sets 1 and 2 one, and set 3 five, packed end to end with no count.
Reading a fixed eight rows returns the neighbour's entries as if they were this
set's. Bounded by the next row's start, which is how `_bounded_ptr_array`
already does it elsewhere in the exporter.

**A peer session's commit dropped my annotations.** Twenty-six rows added to
`ghidra/annotations/functions.tsv` were gone from the working tree after a
concurrent commit landed, and `verify_port.py` caught it — forty-two citations
with no row. Re-applied from a scratch script, which is the lesson: with two
sessions in one tree, an annotation batch wants to be re-runnable.

### Two checks that can fail

`tools/verify_thrower_walls.py` runs `ThrowerFindWallBeside`'s and
`ThrowerFindCeilingAbove`'s own queries against the game's own `coli/` sets at
every class-0x31 spawn in the game. If the reading of the pick table were
wrong — if the climb were unreachable data — no spawn would have a wall. **24
of 49 do, and 14 have a ceiling**; 9 and 4 of those are in stage 2. It fails
only on zero, and its trace is deliberately looser than the engine's so it can
only over-report.

`verify_combat.py` gained a section asserting that every state id the pick
tables name is one `ThrowerTryEnterState` accepts. A pick naming a state the
gate refuses outright would be an actor that can only stand still.

### What is not ported, and why

Eighteen of the thirty-five states: the hit reactions and the death chain
(class 0x31 has its own, and the port kills actors through the shared combat
code), the fall to a surface, the two scripted attacks, the camera-relative
grab, the knock-back tumble, and the object-path entrance. All of them are read
and named; none of them is reachable from the states that are ported, and the
dispatcher sends anything unmodelled back to the hub rather than letting it sit
on a permit.

---

## Session 2026-08-31b — the stage-1 car was riding a path it never rides

**Symptom**: at the end of the stage-1 opening, the car spins several times on
the spot and ends up intersecting the camera.

### What it was

`FUN_0048E600`, now **`St1VehicleUpdate`**, dispatches on `g_active_cam_path`:

```c
if (g_active_cam_path == 0x20)      slot = 0xFD;      /* ride */
else if (g_active_cam_path == 0x21) {
    if (0x15D < g_cam_path_frame) { obj+0x1320 = 0; goto draw; }   /* stop */
    slot = 0xFE;                                       /* ride */
} else if (g_active_cam_path == 0x22) {
    CamEvalObjectPath6(0xFE, 0x43AF0000, &pose);       /* 350.0, a LITERAL */
    obj+0x1320 = 0;                                    /* parked */
    t = (g_cam_path_frame < 0 || 0x31 < g_cam_path_frame)
          ? 150.0 : g_cam_path_frame + 100.0;
    CamEvalObjectPath6(0xFF, t, &tmp);
    obj+0x1334 = tmp.rot_y - 0x4000;                   /* occupants' yaw only */
    goto draw;
}
n = min(g_cam_path_frame, g_cam_path_length[slot]);
CamEvalObjectPath6(slot, (float)n, &pose);
```

So on `cp_st1` 2 the car is **parked** at op `0xFE` frame 350 -- the end of the
path it has just finished -- and op `0xFF` is read for **`rot_y` only**, which
becomes the occupants' yaw. `0xFF`'s position is never read.

`hod2lib.rigs` had it as `Route(0xFF, cam_paths=(0x22,))`, i.e. "the car rides
op 0xFF over the camera frame". Both halves wrong.

### Why it span

`0xFF`'s `rot_*` keys start at frame **100**; its `pos_*` keys start at 0. They
are not sampled together and nothing in the file says they should be. Driving
the rotation from the camera frame therefore evaluates it up to 100 frames
*before its first key*, and `CamEvalHermiteCurve` extrapolates along the opening
segment rather than clamping -- **[proved]**, the fixed-depth binary search
lands on index 1 at the low end and `s` goes negative, so the cubic runs away:

| camFrame | `rot_y` BAMS | turns |
|---|---|---|
| 0 | 762,158 | 11.63 |
| 25 | 370,335 | 5.65 |
| 50 | 144,564 | 2.21 |
| 100 | 16,384 | 0.25 (correct) |

and the position swept 78 units off, back through the correct spot and 69 units
past it -- through the camera. Correct pose is stationary at
`(-64.05, 0, 137.48)`, yaw 113.4 deg.

### Fix

`Route` gains `hold_frame`: the literal evaluation time a routine passes instead
of the camera frame. `cp_st1` 2 becomes `Route(0xFE, hold_frame=350.0)` and the
bogus `0xFF` route is gone. `bundle.py` carries it; `rigs.ts` honours it.

`take()` in `resolve_for_stage` now carries `note`/`hold_frame` **with the
route** instead of `bundle.py` looking the note up by slot -- necessary now that
one rig has two routes on the same slot.

### Not done

* The occupants' yaw (`obj+0x1334`) is recorded as a part rule, not implemented:
  it needs per-part path-driven rotation in the renderer, which does not exist.
* `obj+0x1320` gates the wheel and dust-trail draws; the player does not honour
  that condition yet, so the parked car may still show its trails.
* The `cp_st1` 1 stop test is `> 0x15D` (349) but the player freezes at
  `camFrame > length` (350). One frame out; invisible here because op `0xFE`
  holds its value across 349..350, but it is not the same rule.

### Next actions

1. Look at the other 11 transcribed rigs for the same mistake -- any routine
   passing a literal to `CamEvalObjectPath6` is a `hold_frame`, and grepping
   the decompilation for a float constant in that argument would find them all.
2. Implement `condition` on parts so `_MOVING` actually gates the trails.

---

## Session 2026-08-31c — the rest of the stage-1 vehicle, and a route sweep

Follow-up to the previous entry. Four things, all in `St1VehicleUpdate`'s orbit.

### 0. A regression I introduced, and the assumption it exposed

Giving `cp_st1` 2 its own `Route(0xFE, hold_frame=350.0)` left the rig with
**two routes on slot 0xFE**, and `rigs.ts` built its route lookup as
`Map<slot, route>`. The second overwrote the first, so during `cp_st1` 1 no
instance gate matched `0x21` and the car stopped following the path at all --
the fix for the spin broke the drive before it.

The exporter emits one glTF root per *path slot*, so an instance is a slot and
may carry several routes. `Instance` now holds `routes: RigRoute[]` and
`update` picks the one whose `cam_paths` includes the active shot, falling back
to an ungated route and then to the first. A slot with one route behaves
exactly as before.

Worth remembering: **one route per slot was an assumption nothing stated.** It
held only because no transcribed rig had yet used a slot twice.

### 1. `stop_frame`

The routine's own "stop re-evaluating" test is not the path length.
`St1VehicleUpdate` stops at `0x15D` (349); `op_st1` 1's length is 350. So the
held pose is the path at 349 and never at 350. `Route.stop_frame` records it
and the player clamps with `min(stop_frame, length)`.

### 2. `hidden_unless="moving"`

The four dust trails are drawn inside `if (obj+0x1320 != 0)`. That flag is
clear whenever the object is parked or has run out, so a stopped car must not
trail dust. `RigPart.condition` already said so in English; the machine-readable
half is new, and the player now hides those parts when the instance is frozen
or riding a `hold_frame` route.

### 3. `path_rotation` — the occupants' yaw

`obj+0x1334 = CamEvalObjectPath6(0xFF, t).rot_y - 0x4000`, with
`t = clamp(g_cam_path_frame, 0, 0x31) + 100.0`, or `150.0` outside that range.
It rotates one occupant in Y and the other by its negation, the latter only
while `obj+0x1324` (two players) is set.

Three things about it that a "bake the pose" model cannot express, and which is
why `PathRotation` exists at all: the angle comes from a **different path**
than the body's, on a **different clock** than the camera frame, and it applies
only on **one shot**. Before `cp_st1` 2 the field is still zero, which is why
the occupants face forward for the whole drive and only turn once the car has
stopped.

The renderer composes it onto the part's baked quaternion, so the exported pose
stays the identity case.

### 4. The sweep, and what it did and did not find

**[measured]** All 51 `CamEvalObjectPath6` call sites, scanned for a `PUSH
imm32` decoding to a plausible frame float in the 24 bytes before the call:
nine hits, at `0048E64D`, `0048E6BD`, `0048F964`, `0048F9C4`, `0048FACF`,
`00426BA3`, `00426C83`, `0047F715`, `00432AB6`. Only the first two are in a
transcribed rig, and both are `St1VehicleUpdate`'s, already handled. So **no
other transcribed rig parks on a literal.**

The scan's blind spot, and it matters: `obj_432840` has the same *rule* --
"the pose is the route sampled ONCE at the table's freeze frame and held" until
`obj+0x1320` flips -- but the freeze frame comes from the table at
`0x00589AE0`, not a literal, so no byte pattern finds it. Its four routes
(`0x145`, `0x146`, `0x149`, `0x14A`) are still swept from frame 0 by the
player. **[open]**

### The check that would have caught it

`verify_objects.py` gains: no swept route may be evaluated before its own keys
begin. A `hold_frame` route is exempt, since its frame never sweeps. Confirmed
it fails on the original bug -- restoring `Route(0xFF, cam_paths=(0x22,))`
makes it report `route 0x0ff swept from 0 but rot_x@100, rot_y@100, rot_z@100`
and exit 1. Currently 27 swept routes, 0 bad.

The whole-corpus form of the same question across the exported bundles found
only four routes whose channels start at different frames at all, none of them
reached early: `st1_vehicle` `0xFD` (pos -5, rot -25) and `obj_48f190` `0x17A`
(rot 0, pos -10).

### Next actions

1. `obj_432840`'s freeze frames come from `0x00589AE0`. Read that table, give
   `Route` a `hold_frame_from` or resolve it at export, and the four routes
   stop being swept from 0.
2. `hidden_unless` currently has one value. `RigPart.condition` carries several
   other rules in English across the 12 rigs; each is a candidate.

---

## The other eighteen class-0x31 states, and a death that was never its own

Followed the wall-crawler with the half of the class that was read but not
ported: the damage chain, the death chain, the scripted entrances, and
`zskamere`'s two standing attacks. Four agents, one per group.

### The bug that was already shipping

Class 0x31 was dying through **class 0x30's directional death** — clips 985 to
992, `zom.bin`'s, which do bake for these skeletons and so played without
complaint. The engine gives the class its own four-state chain: an arc at the
camera, a bounce, the character's own death clip, and a corpse that sinks for
two seconds. Nothing reported it, because a zombie falling over the wrong way
looks like a zombie falling over.

Two structural things had to change for it. `ResolveHit` now hands class 0x31 a
**pending hit** rather than a stumble and a death clip — it keeps the shared
damage, gore and score and gives up only the animation, which is exactly the
split the engine has. And the director had to stop skipping dead actors: it
`continue`d on `obj.dead`, which is right for a class whose death is a clip and
fatal for one whose death is a state machine. A `ClassHandler.updatesWhenDead`
opt-in was the smallest honest fix; without it the body froze in mid-air on the
frame its hit points ran out.

### Reachability turned out to be the useful question

Asking "which of these can the shipped data actually reach" was worth more than
reading any single state:

* **21 and 22 are unreachable from anywhere** — not in a pick band, not written
  by any state, not named by any descriptor. Cut content.
* **6 is not a state.** Nothing in the program writes 6 to `obj+0x1310`;
  `ThrowerLeave` is a subroutine that happens to occupy the slot.
* **24 and 32 are `zskamere`'s alone**, entered only from state 8 — and state 8
  raises `obj+0x136C` bit `0x400` on the way in, which is what makes both of
  them resolve against `g_class31_throws` instead of the melee table. Neither
  sets that bit itself, so reading either in isolation would have got the wrong
  table.
* **29 and 30 can only come from a descriptor byte, and no descriptor names
  them.** The `ThrowerTryEnterState` cases for them are dead because no pick
  band contains `0x1D` or `0x1E`.
* **1, 2 and 33 are reachable only through `ThrowerOnShot`.** There is no other
  door into the reaction chain.

That left seven initial states in the shipped data — 18, 19, 20, 23, 26, **27**
and **34** — and the last two had been doing nothing. Stage 5's four `zslman`
grab a *named player* out of a camera-relative offset; stage 6's eight
materialise in three blinking hops.

### Four things I had wrong

**`ThrowerStateBackAwayThreeUnits` is a materialisation, not a retreat.** It
counts `obj+0x1348` **down** 3, 2, 1 and measures each hop from the origin it
captured on entry, so it appears ninety units out and jumps in to thirty. The
name was invented from a half-read and has been changed to
`ThrowerStateBlinkInThreeHops`, everywhere.

**`ThrowerOnShot` does not walk `g_hit_slots`.** It walks
`g_hit_player_order` at `0x009C8908`, which is a different two-entry array —
the player resolve order. The row said `g_hit_slots` and was wrong.

**State 11's fall clips were inverted.** `(-(char != 0x17) & 0x1E9) + 0x1BC` is
`0x3A5` for everything *but* 0x17; the annotation had it the other way round.

**The per-stance idles were never baked.** They are named as literals inside
the state routines, not through any table, so the exporter's motion collector
never saw them — a `zstin` that reached a wall had no idle for the stance it
arrived in and held whatever it was playing. Forty-five literal ids now go into
the bake list, and three of them are correctly refused: they are `kame.bin`
clips and the other three types are `szom.bin`.

### The thing that made the whole class make sense

Every per-set table in class 0x31 resolves to exactly **two** distinct rows,
and the line they split on is the motion bank: 0x16, 0x18 and 0x19 are sixteen
-bone `szom.bin` skeletons and 0x17 alone is twenty-four-bone `kame.bin`. The
"four behaviour sets" are two skeletons and two variations of one of them. Once
that was visible, the shared rows, the character-type branches and the one
genuine engine bug — `ThrowerStateGetUp` plays a `szom.bin` clip with no type
branch, and `zskamere` can reach it — all stopped looking arbitrary.

Also settled: **character type 0x18 appears under two different behaviour
sets**, set 0 in stage 5 and set 3 in stage 6. That is the clearest possible
evidence that the set is descriptor data rather than a property of the model,
and the docs had said "set 0 is `zstin`".

### Still open

The engine's `TraceActorSurfaceContactPoint` gives state 33 a wall to bounce
off on all six axes; the port has collision only through a raycast against the
drawn geometry, so a wall bounce settles on the frame cap instead of finding
its surface. `ThrowerStateCloseAndStrike` has no mover at all and freezes its
target point on entry, which means its range test can never change its answer —
whether something else carries a `zskamere` on surface `0x35` is unread. And
`PlaySoundId(0x2023A9)` fires on every frame of state 27's solid phase rather
than once, which is either an audio-layer dedupe or an original bug.

---

## The collision the player runs is now the game's own

Reported plainly: *"it's important we use the `coli/` rather than tracing
against the rendered mesh."* Right, and for a sharper reason than fidelity —
the drawn mesh is the wrong object twice over. Only the **resident region** is
in it, so a wall one region ahead is invisible; and it carries **no surface
ids**, so every material test came back 0 and `zskamere`'s perch condition
could never be true.

The fix turned out to make the port smaller, not bigger. `coli/` is a few
dozen blobs of quads — the whole of stage 2 is **785 quads across 57 blobs**,
250 KB — and the queries are plain arithmetic over plain arrays. So the
collision went into the bundle and the trace went into **`game/`**, and the
`GameHost.traceSegment` / `groundSurfaceAt` seam was deleted rather than
widened. The port now answers its own collision headlessly: the wall search,
the ground height and the material all work in `npm run test:port`.

Three things fell out of doing it properly.

**`ThrowerPushOutOfWorld` (`FUN_00449D40`) was a whole missing mechanism.** It
is class 0x31's collision hook at `obj+0x12F0` — the "collision push-out" this
project's docs already knew was one of the two implementations of that hook,
never read. It places the body sphere (`ThrowerPlaceCollisionSphere`, which
hangs the sphere *below* the origin on a ceiling and above it on the ground),
pushes out of two sphere tests, and — **only in states 7 and 8** — runs
`ThrowerSnapToSurface`. That last call is what holds a wall-crawler on its wall
while it stands and waits, and what drops it into the fall the moment the wall
goes. Without it a `zstin` that climbed would have stayed wherever it landed
for ever. Its middle branch is also the answer to an `[open]` from the previous
pass: the forced entry into state 2 is **the player shoving a wall-crawler off
its wall**.

**Surface `0x35` is the commonest surface in the game.** The corpus histogram
gives `53` = `0x35` 874 quads of about 2 500 — more than a third — so
`zskamere`'s perch test reads as "standing on ordinary ground more than fifteen
units above the camera" rather than on any special material. `90` = `0x5A`, the
one that kills whatever lands on it, is seven quads.

**The wall search now succeeds in the shipped level.** `npm run replay -- 2 17 5`
shows `LeapToWallB` firing at 46 units and the actor's idle changing to the
wall stance clip — the reported behaviour, against the game's own data, for the
first time.

### The check that would have caught a silent mistake

`verify_coli.py` re-derives every exported blob through the exporter and
compares it field by field with the parsed file: **166 blobs, 0 differing**. It
exists because a transposed vertex triple or an off-by-one stride in the flat
packing reads as perfectly plausible geometry and silently moves walls — the
kind of error that shows up as "the zombies climb the wrong thing" three
sessions later.

`port.test.ts` gained ten assertions against real quads in the real format
rather than a stub host that said "yes, there": the plane test, the winding
test, the ground fallback, the material, and the one difference between the two
sets.

### One thing deliberately not done

`ColiTestSphereAgainstFullSet` is ported, but `ThrowerPushOutOfWorld`'s two
push-outs are not wired: nothing has read the engine's own penetration depth,
and pushing an actor by a number I invented would be worse than not pushing it.
Marked `[open]` in the port.

## The winding test had a sign parity, and one polarity cannot serve three axes

`web/tools/coli_walls.mjs` runs the port's own `game/coli.ts` over every
class-0x31 spawn in the game and prints the same summary as
`tools/verify_thrower_walls.py`, which answers the same question in independent
Python straight off the `coli/` files. They disagreed, and badly:

```
port:   49 spawns: 1 stand on the collision mesh, 0 reach a wall, 0 have a ceiling
python: 49 spawns: 38 stand on the collision mesh, 24 reach a wall, 14 have a ceiling
```

The cross-check earned its keep twice over. Two separate faults, and the
disagreement named the spawn to look at in both cases.

**One:** the point-in-quad test's acceptance sign was inverted. `coli2.bin:13864`
quad 0 is a floor at `y = 40.1` spanning `x -776..-742`, `z -1796..-1707`, and
stage 2's `17/5/1` stands at `(-742, 40.1, -1725)` — plainly inside it. All four
edge terms came out negative under the transcribed `>= 0`, so every floor in the
game was being rejected.

**Two, and this is the one worth remembering:** flipping the sign fixed the
floors and left *every wall in the game* unreachable — 37 grounded, 1 wall. The
sign factor is the dominant normal component, but the reduction from a 3D
`edge × (P − vertex) · n` to two components picks up the handedness of
`û × v̂`, and that is `+x̂` for axis 0 and `+ẑ` for axis 2 but **`−ŷ`** for
axis 1, because `x̂ × ẑ` points *down*. One global polarity is not a
transcription detail that can be got slightly wrong; it is arithmetically
incapable of serving all three axes, and it will always look right on whichever
of the two families you tested. With `w = axis === 1 ? -ny : (axis === 0 ? nx : nz)`
the port reports **38 grounded, exactly matching the reference**.

### What the wrong turn cost, and what stopped it being worse

Two rounds were spent testing hypotheses that the data had already excluded —
disabling the AABB reject, disabling the surface-0 skip, comparing blob and
quad counts — and one round was wasted on a two-sided-plane experiment whose
patch silently did not apply, because the search string was indented four
spaces and the source two. `str.replace` on a non-matching string is a no-op
that returns the original, and the run that followed printed numbers identical
to the unpatched run, which read as "not the cause". **Any programmatic edit
used as an experiment needs an assertion that it applied.** The re-run with an
`assert` immediately gave 14 ceilings where the same "experiment" had given 11.

### The two places the port and the reference still differ, both settled

They do not agree exactly, and each gap was chased to the individual spawn
rather than waved through as "the Python is looser":

* **Ceilings, 11 against 14.** Three spawns stand on a floor whose plane they
  are 0.05 units *below* — `coli2.bin:23720` quad 11 under stage 2's
  `(-1033.1, 129.2, -1914.2)`, and two like it. A trace from a thousand units up
  meets that floor from the **front**, and the engine takes a quad only from
  behind, so it is not a ceiling. The reference is two-sided and counts the
  floor underfoot as a roof.
* **Walls, 22 against 24.** `ColiSegmentVsMesh` judges nearest from the
  segment's **second** endpoint — `ThrowerFindWallBeside` passes the actor
  there — and the reference measures from the first. On two stage-4 spawns that
  picks a different floor out of a stack and moves the nine-to-twenty-nine probe
  band off a wall quad only 10.8 units tall.

Flipping either rule in `coli.ts` reproduces the reference's number *exactly*,
which is what closes the accounting: the gap is those two decisions and nothing
else. `coli_walls.mjs` now asserts 49 / 38 / 22 / 11 and fails on any other
move, and `port.test.ts` gained a six-quad fixture covering both signs of all
three axes — the case that would have caught the parity in the first hour.

### The fixtures were wound to fit the bug

`port.test.ts`'s hand-authored floor quads were wound counter-clockwise seen
from above, and passed only because `coli.ts` had the matching wrong polarity:
two wrongs agreeing is exactly what a fixture written alongside the code under
test will do. The game's own floors run `+x, −z, −x, +z`; the fixtures now do
too, and say why.

## Class 0x31 state 27's sounds, and the looping-SE pair tables

`ThrowerStateGrabPlayer` (`FUN_0044EF90`) makes four `PlaySoundId` calls, and
what they are is settled by `g_se_name_list`:

| id | file | where |
| --- | --- | --- |
| `0x2516A9` | `COMMON\ENE_WALK2_11.WAV` | the cue frame, and again halfway through the finish clip |
| `0x2916A9` | `COMMON\ENE_WALK6_22.WAV` | the landing |
| `0x1F23A9` | `STAGE5_SE\LASER_SWORD_22.wav` | the hold begins |
| `0x2023A9` | `STAGE5_SE\LASER_SWORD_22_OFF.wav` | every non-blinking frame of the hold |

The last two are a **looping pair**, which is a general mechanism worth
recording. `PlaySoundId` (`0x0041CFD0`) carries two parallel tables walked in
lockstep — looping ids at `0x005887FC`, their stoppers at `0x005888B0`, both
terminated by `0xFFFFFFFF`. An id found in the first plays looped; an id found
in the second calls `SoundStopAllLoopingSe` and then plays itself. There are
**44 pairs, and all 44 are `X.wav` against `X_OFF.wav`** — `UFO_44`,
`CHAIN_SAW_22`, `RAIN3ST_44`, `BOAT_SLOW`, `QUAKE_22`, `LASER_SWORD_22`. Seven
ids appear twice in the tables, which is harmless: the walk stops at the first
match.

So the grab ignites a sustained hum on landing and kills it before the strike.

Two corrections to the earlier reading, both from the decompilation rather than
from the shape of the code:

* The blink is the **first** fifteen frames of the hold, not the last. The test
  is `hold_frames - 15 < timer` against a timer that starts at `hold_frames` and
  counts down, so the flicker is how the actor arrives and the rest of the hold
  is solid. The port's constant was named `GRAB_BLINK_TAIL`; it is now
  `GRAB_BLINK_FRAMES`.
* The `_OFF` cue is **not** a one-shot. It sits in the `else` arm of a per-frame
  branch with no edge test, so it fires on each of the `hold_frames - 15`
  non-blinking frames, and `PlaySoundId` takes a free channel every call. An
  earlier note here had it as "once on the crossing frame — do not re-fire",
  which was reading intent into the code instead of reading the code. The port
  emits all of them; a renderer may collapse them, the port may not decide that.

## `g_camera_fixed_eye_y` is misnamed, and is not being renamed today

`0x009C8E58` is a **ground plane**, not an eye height. `EvtOpSetGroundPlaneY1A`
writes it; `PlaceBreakableGroup` puts a group's floor at `this - 0.1`;
`BreakablePropGroundContact`, `ActorDrawGroundShadow`,
`TraceActorSurfaceContactPoint` and `QueryGroundHeightAt`'s miss path all read
it as the floor. Its one camera use is conditional on `g_camera_use_fixed_y`,
and that minority reader is where the name came from.

The rename is right and is roughly fifty sites across the port, the docs, the
tools and the live database — several of them in files a peer workstream is
editing right now. Doing it half-way is worse than not doing it, so it is
recorded at the definition in `globals.ts` and in `addresses.md` and left for a
session that can sweep it in one commit.

---

## Session 2026-08-31d — class 0x10, and fifty zombies that were never in the game

**Outcome:** class 0x10, the civilian, is read, annotated and ported. 22 new
functions and 6 new globals. New `tools/verify_civilian_scripts.py`, new
`docs/formats/civilians.md`, new `game/class10/`.

### The class is a VM, and its scripts are in the exe

`CivilianInit` (`FUN_0048A3E0`) reads a byte at the spawn tail's `+0x01` and
indexes a 67-entry pointer table at `0x005702A8`. That table is **`.rodata`
compiled into Hod2.exe** — the first gameplay data in this project that is not
in the evt, which is why the exporter had to grow a reader
(`ExeTables.civilian_scripts`) rather than another `bundle.py` walk.

Commands are dwords with a per-opcode length, opcodes `0x00..0x2D`. Following
the four opcodes that carry pointers to other streams (`0x0E`, `0x0F`, `0x1E`,
`0x1F`) finds 136 streams and 1,967 commands, of which the 67 table entries are
only the roots — the rest live in the gaps *between* the table's own entries,
and one of them starts before the first entry, which is what made the first
version of the verifier fail on a bounds check it had computed from the table.

The falsifiable check is the decode itself: 17,684 of the region's 18,728 bytes
are command, every stream ends in exactly one `0x2D`, and no byte is claimed by
two commands. One wrong length desynchronises a dword stream immediately.

**Op `0x10` has no fixed length.** It installs a native per-frame hook, and the
engine calls it as `next = hook(obj, cmd + 2)` and takes the pointer back — so
the hook decides. Four appear in the shipped data, consuming 2, 2, 3 and 5
dwords. The decoder refuses an unlisted hook rather than guessing, which is how
the 3-dword one (`0x0048DB90`, a launch speed) was found: the first run threw
on the byte after it.

### Two things that read backwards

Both cost a round of failing assertions, and both are in the port's doc
comment and in `docs/formats/civilians.md` now:

* **A wait word leads its block and governs the wait that *follows* it.** The
  VM runs its first command whatever it is and stops before the *next* opcode
  above `0x2B`, so a stream that does not open with a `0x2C` never loads a wait
  word and parks on the zero it started with. Every shipped stream opens with
  one. The first test fixture did not, and asserted a park that was really a
  never-started script.
* **`SetTimer` does not delay its own block.** `CivilianStepScript` clears the
  timer on every resume; the value that survives is the one
  `CivilianReapplyWaitCommand` reads out of the block *ahead*. A timer of `n`
  costs `n + 1` frames, because the test reads before the decrement.

And a third, which is stranger and is transcribed rather than smoothed over:
once the parked wait clears, the step loop loads the **cursor's own** word and
tests that too, and if it also passes it advances again — so a block whose wait
is already satisfied has its actions skipped entirely.
`CivilianReapplyWaitCommand` (`FUN_0048B760`) exists to make that survivable: a
second, smaller VM that re-applies only the opcodes a wait condition reads.
That is the whole reason there are two interpreters.

### The finding: the captors were not in the game

`CivilianInit` reads a child count at tail `+0x0C` and an array of descriptor
pointers at `+0x10`, and `SpawnFromDescriptor`s each one, parenting it at
`child+0x1394`. **Nothing in the evt's instruction stream points at those
descriptors.** `evt.spawns()` walks the instruction stream, so it never
returned them; the character exporter is built on that walk, so it never placed
them; and the client spawns from the placements, so 47 class-0x30 zombies
across stages 1–4 did not exist in the player at all.

They are the rescue. Wait bit `0x04` blocks while more than `sub+0x20` of them
are alive, and the block it unblocks ends with a wait word carrying
`0x10000000`, which is where `ScoreAddForPlayer` pays 400. Without the captors
there was nothing to kill, so no civilian could ever be rescued — and the class
having no module at all had hidden that completely.

`characters.py` now folds those descriptors into `by_at` before the placement
loop, tagged `civilian_child`, and the render layer makes a child present
exactly when its parent is (they have no spawn instruction to be placed by).

### Scoring, and what "−100 twice" means

`docs/formats/spawns.md` has said "shooting one costs a life and −100 twice"
since the class was first identified. The code says which: the survivable
branch calls `PlayerTakeDamageTimed`, which charges 100 of its own for the
life, and then charges another 100 — so the shooter is down 200. The *killing*
branch charges 100 to **both** players and no life. The test asserts both,
because the doc line reads either way and only one of them is the code.

### Wrong turns

* The first test fixtures were written as if a `Wait` at the head of a stream
  parked the actor, and as if a `SetTimer` delayed its own block. Five
  assertions failed; all five were the fixtures, not the port. Worth recording
  because the failures looked exactly like transcription bugs.
* `g_script_flags[i] !== 0` on an array the script has never written reads
  `undefined`, and `undefined !== 0` is true — so wait bit `0x2000` ended on
  frame one. Caught by an assertion written specifically because the array is
  sparse. It is `?? 0` now.
* `verify_civilian_scripts.py`'s first version derived the region's lower bound
  from the script table and reported eleven commands "outside the region". The
  bound was wrong, not the commands: one sub-stream sits below the first table
  entry. The bound now comes from the walk.

### Not done

* `CivilianApplyMotionPose` (`FUN_0048C310`), `CivilianDrawHeldItems`
  (`FUN_0048CD10`) and `CivilianUpdateOnCarrier` (`FUN_0048B140`) are read and
  named but not ported — they are the renderer's half, and the opcodes that
  only feed them (`0x13`–`0x15`, `0x27`) are decoded, named and left inert.
* The `RideChildren` hook (`0x0048DA90` → `0x0048DAB0`) averages the surviving
  captors' positions to carry the civilian between them. It needs posed
  skeletons, so it is `[open]` in the port.
* `obj+0x131C`, which names the player who killed a captor, is on `Actor` and
  nothing writes it: the port's shot path carries no player at all. The rescue
  therefore always takes the engine's own `-1` branch and pays both players.
* Ops `0x19`, `0x1B`, `0x23`, `0x24`, `0x25` and `0x2B` are named from their
  writes and `[open]` on meaning — nothing read reads those fields back.
* `./ghidra/run.sh export-annotations` still exits 1 while the GUI holds the
  project, so the database was synced over MCP (`rename_function`, and
  `create_label` for the seven the naming gate rejects and for the six
  globals). The TSVs remain the source of truth.

**Next actions:** re-export the bundle
(`python3 tools/export_player.py --game-dir "..." --all`) — the civilians block
and the 47 new captor placements are new and no committed bundle has them. Then
either class 0x11 (the plain script-spawned enemy) or the `0x20`/`0x45`/`0x46`
classes, which are unread and need a `/decomp` pass before anything else.

---

## Session 2026-08-31e — class 0x10 in the player, and a class that was ported and invisible

**Outcome:** the civilians are on screen, shootable, holding things and
talking. Follow-up to session 2026-08-31d, which ported the class but not its
half of the renderer.

### The class was ported and drew nothing

`MOTION_RULES` had no entry for class 0x10, so `resolve_for_stage` gave all 47
spawns `motion = None`, and the client skips anything it cannot pose. The
answer was in `CivilianInit` all along: `model+0x20 = 0x294` — motion **660**,
`people.bin` — written before a line of script runs. One literal.

Baking it is not enough on its own: op 0x00 changes the clip constantly, and a
shot civilian spends the rest of its life in another stream. `civilian_motion_ids`
takes the transitive closure of the entry stream's ops 0x00/0x01 across
0x0E/0x0F/0x1E/0x1F — 13 to 23 clips per character type.

Rendered and read back: `extract/compare/civ/hito_gal.png` is a woman in a dark
top and skirt, arms at her sides, correctly assembled and posed at motion 660
frame 0. Not a zombie.

### Shooting one does not go through `ResolveHit`

`ShotTestSphere` (`FUN_00404630`) is the fork, and it took two wrong guesses to
find it:

* **Not the descriptor's `init_flags`.** Bit 0x80 is clear on all 1,100 spawn
  descriptors in the game, so that is not where it comes from.
* **Not the skeleton record's `+0x16`.** It is 2 for every character type, so
  that clause never discriminates either.

It is `obj+0x34` bit 0x80, and nothing a civilian runs ever sets it — so a
civilian is a **sphere of radius `obj+0x124`**, ten units, and the shot ends at
`MarkActorShot` setting bit 3 and the shooter's bit. That is the same shape as
a breakable prop, and it is wired the same way: `ClassHandler.ownsShotResult`,
and `Shooting` marks and steps back.

Running `ResolveHit` over a civilian would have charged hit points it does not
have and swapped gore models it has none of.

### Held items

The 0x7C-byte record is fully readable off `CivilianDrawHeldItems`, which
copies all 31 dwords onto its stack: bone, asset slot, kind, three BAMS
rotations, a per-frame callback, and **six** `{x, y, z, scale}` attach sets.
`sub+0x82` picks the set from the character type, which is why one bottle fits
an old man and a schoolgirl.

Fourteen records; the models are `etc_1.bin` and `common.bin`, and the kinds'
second slots are effect billboards — `0x10A3` renders as a soft flame quad
(`extract/compare/civ/item_10a3.png`), and the schoolgirl's `0x10C3` is a small
white box (`item_10c3.png`).

They ride the hidden `gore_*` template the client already clones from. The gate
on emitting that template was `chars[ct].gore`, and a civilian has no damaged
parts at all — so the first export had the item slots computed and no template
to put them in. The gate is `gore or held_slots` now.

### Op 0x15 draws, and `Init` had no generator

The weighted pick is `rand() % total`, and it runs **in the Init** for at least
one shipped stream. `ClassHandler.init` took no `Rng`, so the opcode was
silently skipped and every civilian held nothing. `init(obj, rng?)` now, passed
from `ActorSpawn`; class 0x24's `FALLBACK_RNG` was the precedent for *not*
doing this, and it is the wrong precedent here — that class's random arm is
never taken, and this one is.

### Two things found on the way

* **Nothing was listening to `sound.play`.** Class 0x31's laser sword, its
  footsteps and its landing thump have been raising that event into an empty
  bus since they were ported. One line in `main.ts`.
* `ActorRegisterCameraPoint`'s first port **overwrote** `obj+0x100` with the
  actor's position, clobbering `render/characters.ts`'s `trackLookAt`, which
  already writes it from bone 1 and applies the same 4.0 rise. The port's copy
  is gone; the note that the draw owns that field is in its place.

### Not done, and why

* **The carrier.** 7 of 47 civilians have a non-zero `+0x22` and run
  `CivilianUpdateOnCarrier`, which pushes `g_civilian_carrier`'s transform
  around the whole update. That global is written by a class-0x13
  sub-constructor and class 0x13 is not read, so there is no object to ride.
  Approximating it would put seven civilians somewhere plausible and wrong.
* **`SpawnCivilianBloodPool`** (`FUN_0048E080`) — a ground decal that is a whole
  object of its own class with an unread update. The renderer's impact sprite
  already marks the hit.
* **`CivilianApplyMotionPose`** (`FUN_0048C310`) — the generic root-motion walk
  carries a civilian where its clips say; the bone-difference body turn is not
  ported.
* Ops 0x17 modes 1-3 write `obj+0x12C` from matrices inside the model block.
  Nothing read reads `obj+0x12C` back, so both halves are `[open]`.

**Next actions:** class 0x13, which would unblock the seven carried civilians
and is 15 spawns of its own; or the `0x20`/`0x45`/`0x46` classes, which are
unread.

---

## Session 2026-08-31f — the zombies were never supposed to be chasing you

**Outcome:** eleven class-0x30 states read, named and ported. 19 new function
annotations, a new `web/src/game/class30/target.ts`, a new
`tools/verify_captor_scripts.py`.

### The question, and the answer

"When civilians are involved in set pieces, shouldn't the zombies attack the
civilians first?" They should, and the engine does. Searching for readers of
`obj+0x1394` — the field `CivilianInit` fills with the parent civilian — turns
up **eleven entries of `g_class30_states`**: 34, 35, 36, 37, 38, 39, 40, 41,
43, 44 and 45. None of them looks at the camera. They walk at, maul, drag,
pounce on and wait beside the object the actor was *built for*.

The census settles it: of the 23 spawns in the whole game that start in state
34, **every one is a civilian's captor**. Same for 39 (6 of 6), 40, 43.

And the port had `ZombieEntryState` mapping every unported entrance to
`AttackRun`, so all 47 captors abandoned their hostage on frame one and charged
the camera. Exactly the reported behaviour.

### The script, and the flip

`ZombieScriptForState` (`FUN_0045CA10`) is two blobs off the descriptor tail:
`+0x08` while the actor is in the tail's attack state, `+0x04` otherwise. A
blob is a header shaped by the entering state plus a list of `s16[4]` motion
entries, walked through a cursor at `obj+0x1398` that the states **share** —
which is how state 34's walk hands state 35's maul a half-walked list.

`ZombieScriptEnded` (`FUN_0045C8D0`) flips the roles when a list runs out:
initial → attack, attack → `AttackRun`. That last transition is the first
moment one of these zombies turns on the player, and it is the whole shape of
a set piece. All 86 blobs decode and terminate.

### Two signals between the classes, both polled

Neither is a callback, and that is why both survive a snapshot untouched:

* `ZombieStateWalkToTarget` raises `0x800` — `CivilianWait.Free` — in the
  **civilian's own wait word** the frame it gets close enough. The civilian's
  script has been parked on that bit waiting to be grabbed.
* Class 0x10's op 0x1A writes a class-0x30 state id to `sub+0x2C` and a
  countdown to `sub+0x2E`, and `ZombieStateAwaitCivilianOrder` is the captor
  sitting on it. `0x31` means die.

**The port had op 0x1A wrong.** Last session it kept only the second operand,
called it `childCue2` and marked it `[open]` — throwing away the order itself.
Reading the state that consumes a field is what tells you what the field is;
reading only the writer gave a plausible-looking name for half of it.

The kill goes the other way: the maul raises `0x4000000` on the *civilian's*
`obj+0x34`, the same bit a killing shot raises, so `CivilianUpdate`'s killed
branch runs and charges both players 100. Failing to rescue costs exactly what
a bad shot does — and `civilians.mjs` now shows four civilians mauled inside
fifteen seconds, which is four that can no longer be rescued. The `rescued`
count in that harness went **down** from 25 to 21 because of it, which is the
change working rather than a regression.

### Wrong turns

* The first `civilians.mjs` measure was "did the captor get closer to its
  civilian than to the camera". It reported 41 and 38 out of 47 — both — which
  is nonsense until you notice the civilians are moving too, and that a
  distance to a point 5,000 units away barely changes. Replaced with the
  unambiguous question: **did this captor ever run a state that works on its
  civilian?** 45 of 47. Before the family was ported it was zero.
* `FUN_0045B7B0` and `FUN_0045C2E0` were not functions in the database at all —
  nothing referenced them except the state table, which Ghidra had not typed.
  `create_function` first, then decompile.

### Not done

* `ZombieStateCarryProp` (state 37, nine spawns) allocates a companion object
  running `FUN_00442740` and waits for the player to destroy it. That class is
  unread, so the exit cannot be modelled; the port runs the state's script
  half, which is what the engine does for as long as the prop lives.
* `ActorBoundsOnScreen` (`FUN_0045CA60`) pads the actor's view-space interval
  at `obj+0x10C`/`0x110` by its radius. Those two fields have not been read, so
  `ZombieStateRetireOffScreen` asks `ActorIsOnScreen` about the tracked point
  instead — the same question about a point rather than a box.
* `ZombieStatePounceOnTarget` aims at a point off the civilian's **bone
  matrix**; `game/` has no skeleton, so it aims at the same offsets from the
  actor's position and facing.

**Next actions:** the companion class behind state 37 (`FUN_00442740`), which
is the last unread piece of the captor family; or class 0x13, which is what the
seven carried civilians are riding.

---

## Session 2026-08-31g — the attack pacing, and what difficulty actually does

**Outcome:** the class-0x30 attack loop read end to end. Five functions and
three globals named. Two real divergences fixed, one wrong belief in the port
corrected, one deliberate non-fix recorded. New `web/tools/cadence.mjs`.

### The question: "what difficulty are we simulating?"

**2, and it does not pace anything.** `ResetDamageRank` (`FUN_00460770`) seeds
`g_damage_rank` from `g_initial_damage_rank[difficulty]`, and it **forces
index 2** whenever `FUN_00413280()` is non-zero, ignoring the menu. Index 2
gives `hp_delta = 0` and `initial_rank = 1`. `g_damage_rank` scales **per-shot
damage** through `DamageRankModifier`, and nothing else.

`ResetSceneCombatState` (`FUN_0045EEC0`) copies the three approach-ring radii
from `DAT_004C4CD0/D4/D8` — **one table, no difficulty index**. So the rings,
the queue depths and therefore the attack cadence are identical on every
setting. There is no difficulty-dependent timing anywhere in class 0x30.

The port hardcodes `g_difficulty = 2` and never offers it. The adaptive rank
(`UpdateDamageRank`, `g_damage_rank_pending`) is still unported, so the rank
stays at its seed — that changes damage, not timing.

### Where the pauses are, and where they are not

Read: `ZombieStateHoldAtRange`, `ZombieStateStrike`, `ZombieStateBackOff`,
`ZombieStateWaitTurn`, `ZombieStateAttackRun`, `TryClaimAttackSlot`,
`IsPlayerAttackable`, `CheckPlayerCanBeHit`, `ZombiePushOutOfWorldAndActors`,
`ZombieStateWaitForCameraFrame`, `EnemyZombieInitByCharType`.

* **There is no per-swing cooldown.** `obj+0x133C` is *forced to zero* by
  `ZombieStateHoldAtRange` unless `obj+0x1368` bit 0 is set, and the only
  thing in all 54 states that sets that bit is
  `ZombieStateWaitForCameraFrame` (state 19), which arms it from the
  descriptor tail's `+0x10`. Four spawns in the game start there.
* **The pause is the queue.** `rank < allowance && queueRank < 3` and one
  permit per player. A lone zombie has rank 0 and re-claims on the frame its
  retreat ends — so it really does swing, retreat, swing, with no idle. That
  is the engine, not a port bug.
* **The 90-frame invulnerability window is not a pause.**
  `IsPlayerAttackable` (`FUN_00409DC0`) tests the player *state word*
  (`g_player_state`, 0x009A5C62 — must be 5); the invulnerability lives in a
  separate byte array that only `PlayerTakeDamage` reads. An invulnerable
  player is still a legal target and the queue keeps turning.
* `obj+0x136C` bit `0x400` **is** a "stand through one whole idle before you
  may attack" latch — but `EnemyZombieInitByCharType` sets it once, for
  character type 2 only, and `ZombieStateHoldAtRange` clears it the first time
  the idle reaches `play_length - 2`. A one-shot, not a rhythm.
* `DAT_00566124` looked like a wait table. It is ten entries of 0 and 1 that
  `ZombieStateAttackRun` ORs into `obj+0x136C` at **bit 21** — which idle
  variant a waiting zombie plays. Not a duration.

Measured, over the real stage-2 spawns: **a lone zombie strikes every 3.22 s**
(1.63 s clip + 1.58 s retreat, 0.1 s in the hub); **six zombies give 5.85 s
each, one swinging at a time, 9.3 s of standing.** `web/tools/cadence.mjs` is
that measurement, with expectations, so a change to the loop moves a number.

### Fixed

* **`obj+0x1338` and `obj+0x133C` were conflated.** `ZombieStateBackOff` wrote
  the engine's `+0x1338` value (60) into the port's `cooldown`, which is
  `+0x133C`. They are different fields: `+0x1338` is the shove timer
  `ZombiePushOutOfWorldAndActors` counts down to flip the retreat's turn
  direction; `+0x133C` is the attack cooldown. Now `Actor.shoveTimer`.
* **`ZombieStateBackOff` was missing half its exit test.** The engine's is
  `(far enough || 240 frames) && (motion != 0x100 || frame > 0x43)` — a
  character whose back-away is motion 256 may not return to the hub until that
  clip has played. Three of the game's motion rows use it.
* **`ResetGameGlobals` did not reset `g_player_lives`.** A replay or a seek
  started with however many the last run ended on. The engine's scene reset
  re-arms the player.

### Corrected

`backoff.ts` asserted there is **no** actor-versus-actor separation pass
anywhere in the engine. That is wrong. `ZombiePushOutOfWorldAndActors`
(`FUN_00454900`) — the hook `EnemyZombieInit` installs at `obj+0x12F0` — runs
`ColiTestSphereAgainstActors` against `obj+0x12C` with radius `obj+0x128` and
pushes the actor out by a tenth of the penetration each frame, 1.8x while
airborne. It is not ported, and porting it would change how a crowd packs.

### Deliberately not fixed

The engine's `TryClaimAttackSlot` voids a permit it has just picked when
`IsPlayerAttackable` returns false. Wiring that up looked like a free fidelity
win and is not: the engine's version tests the player *state word*, which
losing your last life does **not** change, while the port's stand-in tests
`g_player_lives`. Adding the call made every enemy stop attacking after two
hits — the cadence harness went from 9 strikes to 2, which is how it was
caught. The call goes in when there is a player state to test. Recorded as
`[open]` at the call site.

**Next actions:** port `ZombiePushOutOfWorldAndActors` — it is the only thing
keeping a crowd from occupying one point, and it feeds directly back into how
often the actor holding the permit is actually in range. Then the adaptive
`UpdateDamageRank`.

---

## Session 2026-08-31h — the off-screen permit, and a collision overlay

**Outcome:** the reported "zsass walks into the camera and never leaves" traced
to one inverted test. Fixed, with the global latch it belongs to. New
`web/src/render/coli_debug.ts` and a `Collision` checkbox.

### The bug: being off screen does not refuse a permit

`TryClaimAttackSlot` (`FUN_00455DE0`) and `ThrowerTryClaimAttackSlot`
(`FUN_0044CA40`) both call `ActorIsOnScreen`, and the port read that as a
refusal:

```ts
if (host && !ActorIsOnScreen(obj, host)) return false;
```

The engine does the opposite. It grants the permit either way, and when the
claimer is **off screen** it additionally sets the actor's own bit —
`obj+0x136C` 0x20000 for class 0x30, 0x8000 for class 0x31 — and the global
`g_attack_committed` (0x009A34F0). Both claim functions *read* that global
first and give up before a player is even picked, so **one enemy may be
attacking unseen and while one is, nobody else may claim at all**. It is
cleared by `ReleaseAttackSlot` (`FUN_00456520`), `ThrowerReleaseAttackPermit`
(`FUN_0044CFB0`) and `ZombieStateHoldAtRange`, each gated on that same bit.

The consequence of the port's reading is exactly what was reported: an actor
the camera's rail has walked into is off screen, is refused a permit for ever,
sits in `ThrowerStateWaitForPermit` idling, and therefore never reaches
`ThrowerStatePounce` → `ThrowerStateLeapAside`, which is the *only* thing that
puts a thrower back to fifty units. `zsass` shows it worst because its whole
cycle is close in, pounce, leap back.

Measured before and after with a harness that walks the camera into eight
stage-2 `zsass`: before, none of the ones the camera reached ever left
`WaitForPermit`; after, they run `WaitForPermit → Pounce → LeapAside` and
recover from a minimum of 1.1 units back out to 35 and beyond.

`port.test.ts`'s `ActorIsOnScreen` block asserted the old behaviour and now
asserts the new one, including that the latch blocks a second claimant and that
releasing lifts it.

### The other half of the report: "misaligned to the walls"

That one is the engine. `ThrowerStateLeapAside` (`FUN_0044B880`) builds its
landing point in the **camera's own frame** — `MatrixTranslate(eye);
MatrixRotateY(g_camera_yaw_bams)` and a local `(±5, 0, 50)` — so the left/right
choice is five units either side of where the camera is looking and knows
nothing about the geometry. The only collision it consults is a **vertical**
segment through that point, from a thousand units below the actor's tracked
height to a thousand above, to find the floor to land on. So: aligned to the
camera, corrected in `y` by the mesh, and never in `x`/`z`.

### The overlay

`Collision` draws exactly what the port traces: the quads in
`G.g_coli_full_set` in amber, the ray-only ones in blue, a spike on each
normal, and nothing for a blob in neither list — because nothing tests those.
It rebuilds only when the script's own opcodes change the selection, which is a
handful of times a stage.

### Wrong turn

The first attempt at this session's fix also wired `IsPlayerAttackable` into
the claim, where the engine has it. That is the same trap as last session and
it was caught the same way: the port's stand-in tests `g_player_lives` while
the engine tests the player *state word*, so every enemy stopped attacking
after two hits. Left out again, with the reason at the call site.

**Next actions:** `ZombiePushOutOfWorldAndActors` (`FUN_00454900`), still the
only unported thing keeping a crowd from occupying one point — and now that
off-screen actors can hold permits again, how tightly they pack matters more.

---

## Session 2026-08-31i — nothing ever put a zombie on the floor

**Outcome:** the per-frame ground snap and the two placing entrances ported.
Four functions named, `class30/ground.ts`, `class30/emerge.ts` and
`class30/fall.ts` added.

### The question: "what logic are we missing for placing the zombies?"

`ActorSnapToGroundHeight` (`FUN_00454B10`). `EnemyZombieUpdate` runs a hook at
`obj+0x12F0` after the state and the velocity integration; that hook is
`ZombiePushOutOfWorldAndActors`, and it calls the snap every frame unless the
actor is airborne:

```c
ground = QueryGroundHeightAt(x, y + 6.0, z);
if (!(obj+0x136C & 0x4000000) || y <= ground || |y - ground| <= 10.0)
    y = ground;                       // snap
else if (state != 0xB) state = 0xB;   // or fall
```

The port had **none of it**. A class-0x30 actor's `y` was whatever its spawn
record said and stayed there. Stage 2's block 16 runs over ground that drops
from -25 to -34.5 over a few units, which is exactly where it was reported.

Measured on the eight block-16 spawns: every one now ends the run with `y`
equal to the collision height under it, where before they held their spawn `y`
of -15, -19 and -27.

Note the probe's reach: six units above the actor's own `y`, so an actor ten
units under the floor **cannot see it**. That is the engine's limit too, and it
is why the emerge clip is not decoration — the clip brings the actor up to
within range of its own snap.

### The water: state 27

`ZombieStateEmerge` (`FUN_004584E0`) is the missing animation. Sub 0 holds
motion 0xB9 with the clock frozen and **root motion off** (`obj+0x1F8 &= ~1`)
and arms `tail+0x04` as a delay; sub 1 counts it down, turns root motion back
on and plays `tail+0x08` — **178** for stage 2's water spawns and **183** for
the ground ones — whose own translation lifts the actor; sub 2 plays it out,
throwing effect 0x62 at frame 22 and 0x61 at frame 35 when the clip is 178, and
hands to `AttackRun`.

Those two clip ids are the same pair `ZombieStateTargetMotionScript` special-
cases with a dust effect, which is the corroboration that they are the two
"come up out of something" clips.

### The other one: state 26

`ZombieStateDelayedLeap` (`FUN_004581A0`) is a delayed ballistic entrance, and
it could not be folded into the existing `leap` export because **the offsets
differ**: state 24 keeps its destination at `tail+0x04` and a duration at
`+0x10`; state 26 keeps a delay at `+0x04`, the destination at `+0x08`..`+0x10`
and, at `+0x14`, a per-frame **acceleration** — 0.04 for both stage-2 spawns.
`ActorArcBeginFalling` (`FUN_0040A090`) counts the frame count out by
simulating `v -= a; y += v` until the height passes the destination's, which is
unlike every other arc in the port.

### Two things that fell out

* **`EnemyZombieUpdate` never integrated the velocity.** The engine does
  `obj+0x40 += obj+0x4C` straight after the state. Adding it also fixed
  `ZombieStatePounceOnTarget` from the captor family, which had been setting a
  velocity nothing applied.
* `ZombieEntryState` had to pass 26 and 27 through for the same reason as the
  captor states: they do not end by setting 1, they end by *moving the actor*.

### Wrong turn

The first test asserted that an actor eight units under the floor is snapped up
to it. It is not — the probe starts six above the actor, so eight is out of
reach. The test was wrong, not the port, and the corrected pair of assertions
now pins the reach as well as the snap.

### Not done

`ColiTestSphereAgainstActors`, the actor-versus-actor half of the same hook.
`game/coli.ts` has no entry point for it. It is still the only thing keeping a
crowd from occupying one point.

**Next actions:** that. Then class 0x51, the water enemy — stage 2 block 16
step 8 spawns three of them and they have no module at all.

---

## Session 2026-08-31j — the zombie had no size

**Outcome:** the wall-walking traced to two unwritten fields.
`ColiTestSphereAgainstActors` ported, which finishes
`ZombiePushOutOfWorldAndActors`.

### Why it came through the wall

`EnemyZombieInit` writes **two** radii and the port wrote neither:

* `obj+0x124` = `g_actor_radius_by_char[charType]` — the **shot** sphere, 10.0.
* `obj+0x128` = 3.5 — the **body** sphere, and the one every collision uses.

`ZombiePushOutOfWorldAndActors` tests `ColiTestSphereAgainstFullSet(obj+0x12C,
obj+0x128)`. With `obj+0x128` at zero the sphere had no radius, never
penetrated anything, and the push ported last session did nothing at all.
Driving the block-16 step-3 spawn at a camera on the far side of the wall it
was reported to cross: **0 frames step through a solid quad** now, where before
the radii it walked straight through.

Note this port had `radius` for `+0x124` and used *that* in the push — the
wrong one of the two. Both are named on `Actor` now, with the difference
written down.

### "Does it have a predefined path?" No.

`PATH_STATES` is `{0x31: (26,)}`: only class 0x31 follows a path.
`ZombieStateWalkDistance` (state 15, which that spawn starts in) records where
it started and walks until the 2D distance from it exceeds the float at
`tail+0x04` — 8.0 here. There is no destination and no route. The floats
further into that descriptor look like a point and are the **next spawn
record**: the adjacent-array trap, and the annotation now says so.

Nor is the push avoidance. It is extraction: a sphere test each frame that
shoves the actor back out along the surface normal. A zombie hugs a wall and
slides along it; nothing in class 0x30 routes around anything.

### `ColiTestSphereAgainstActors` (`FUN_00405B10`)

Centre-to-centre against the **sum** of the radii, nearest candidate wins, and
the actor it finds is **not moved**: the opposite push is written onto it at
`obj+0x138`/`+0x13C`/`+0x140`, and that actor applies it on its own next frame.
One test per actor, not one per pair.

The engine reads a per-frame list every actor registers into. The port walks
`g_object_list` and derives each candidate's sphere from its position, which
removes an ordering hazard the first version walked straight into: testing
against `camPoint` as stored gave a stale centre for any actor that had not
ticked yet, and the two test actors separated along **y** instead of x.
`ActorUpdateBoundingSphere` moved to `actor.ts` so the test can call it.

**Next actions:** class 0x51, the water enemy — stage 2 block 16 step 8 spawns
three and they still have no module.

## The wall, again: it was never the collision

The report came back — `stage=2 block=16 step=3 op=13 frame=350` still walks
through the wall after both radii were fixed, and so do some at
`stage=4 block=2 step=8 op=20 frame=860`. It did, and the previous session's
verification is why it was not caught: that harness invented a camera position
and put **every** blob into `g_coli_full_set`. Neither is what happens in play.

`web/tools/wall.mjs` is the harness that does not invent either. It `seek`s the
real `Walker` to the address, so the script's own `set_collision_set_full` has
run, and it reads the eye off the camera path the step is playing. Run at that
address it says: the full set is **one blob**, `coli2.bin:4656` — fourteen
quads of flat water at `y = -25` — and the ray set is empty. The building the
zombie crosses has no collision anywhere in `coli`, and
`EvtOpSetCollisionSetFull10` (`FUN_0045F130`) *replaces* the pending list
rather than appending to it, so nothing from an earlier step is still active.
**No sphere push could ever have stopped it.** Most of the walls this game
draws are not walls the engine can feel; what keeps an enemy out of them is the
entrance the script gave it.

And that entrance was missing. `ZombieStateWalkDistance` (`FUN_00457220`),
class 0x30 state 15, latches the `f32` at descriptor tail `+0x04`, records
where it started at `obj+0x13C0`, and plays its run clip on the yaw the spawn
record gave it until the 2D distance from that point reaches the latched
value — three to thirty units. Only then does it set state 1 and turn to the
camera. `ZombieEntryState` folded it into `AttackRun`, so all **fifty** of the
game's state-15 spawns turned on frame one and took the straight line. All four
spawns in the report are state 15; the user named `16/3/0 0x9DDC`, which is
40412, walk distance 8.

Two halves had to be fixed, and only one of them is in the port:
`WALK_DISTANCE_STATES` in `tools/hod2lib/characters.py` listed class 0x31
only, so the bundle never carried the distance at all. `verify_walk_distance.py`
is the check that could have failed: every one of the 58 records that names
either state reads as an **exact integer** at tail `+0x04`, and tail `+0x08`
reads as a plausible distance in **0** of the 58 — it is the next descriptor,
which is the adjacent-array trap stated as an assertion.

Measured on the reported spawn over the same four seconds, crossings of drawn
geometry fall from 11 to 4. The four that remain are two frames at the corner
of the building, and they are what the engine itself does: the actor faces the
camera, the camera is round the corner, and there is nothing in `coli` there.

### What was checked before believing any of it

The walk direction is the whole of the fix, so the chain was read rather than
assumed — this is the inverted-facing trap and it has cost this project before.
`MatrixRotateY` (`0x004A9AE0`) composes `x' = x·c + z·s`, `z' = −x·s + z·c`,
which is exactly `ApplyRootMotion`; `VecToAngles` (`FUN_004016B0`) is
`atan2(dx, dz)`; `TurnActorTowardCamera` (`FUN_00409ED0`) passes **actor minus
camera**; and `verify_spawn_facing.py` already had the art half — a character
faces `−Z` at yaw 0. Together those say an actor at yaw 0 walks along `−Z`,
which is forward. Stage 4's three spawns are the independent case: yaw `0x8000`,
28 units, and they walk `+Z` — straight at the camera, which is `+Z` of them.
Both cases walk *toward* the player, which is what a scripted walk-in is for.

`EnemyZombieInit` (`FUN_00452DA0`) was re-read to be sure nothing overwrites the
spawn yaw. It does not: the `VecToAngles` call in it writes `obj+0x1320/0x1324`,
not `obj+0x64/0x68`. Two things in it are worth recording for later, neither
ported:

* `obj+0x34 = spawn record's flags word | 1` (`ActorInitFlags`, `FUN_00408970`).
  Bit 27 picks between `row[2]` and `row[3]` — the run variant — and 141
  class-0x30 spawns set it. The port carries none of that word, which is the
  `[diverges]` both `ZombieStateAttackRun` and the new state 15 now name. It is
  not a free fix: bits 3, 8, 14 and 17 also appear in shipped records and the
  port reads those offsets as `Hit`, `ShotImmune`, `PoseFrozen` and `Airborne`.
* `obj+0x136C = (s16)obj+0x1316 | 0x60000000` — the class-0x30 flag word is
  **seeded from the spawn record** too, not just from the constant the port
  writes.

### Wrong turns

* The whole of the previous session's wall fix was aimed at collision. The
  radii were genuinely missing and the fix stands, but it was not this bug, and
  the harness that "confirmed" it had replaced both of the things that decide
  the answer. A harness that invents its inputs cannot fail.
* The first reading of this one was that the walk-in would route the zombie
  around the corner. It does not — it walks it *at* the camera, which is
  through the corner. The measurement said 4 crossings, not 0, and the
  difference between those two numbers is the part of the report that has no
  fix in the engine.

## The captors, the maul, and one clock counted in the wrong units

Reported: the stage 1 well captors "don't seem to work — are they stuck in the
wall?", and a zombie hitting a civilian does not kill it. Two separate faults,
and the wall was not either of them.

### The captor was being held off its own hostage

Driving stage 1's eight captors headless, 6376 sat in `ZombieStateWalkToTarget`
for forty seconds and never handed over. Its script wants to be within **6**
units; it oscillated around 8.7 and never closed. It was not stuck: it was
being pushed.

`CivilianInit` (`FUN_0048A3E0`) writes **two** radii, `obj+0x124` from
`g_actor_radius_by_char` and `obj+0x128 = 1.0`. The port wrote only the first,
so `ColiTestSphereAgainstActors`' own lazy default — `if (obj+0x128 == 0)
obj+0x128 = obj+0x124` — filled the body sphere from the *shot* sphere, ten
units. 3.5 + 10 = 13.5, and the crowd push shoved the captor back out of that
every frame at a tenth of the penetration. The walk and the push found an
equilibrium a couple of units outside the arrive radius, for ever.

Ported with it: `PoseHookGrowAndPushOutOfWorld` (`FUN_0048D070`), the class's
per-frame pose hook and one of only two in the program. It ramps `obj+0x128`
toward the target op 0x16 set, by that op's step, clamping from whichever side
it approaches; then pushes the civilian out of the full collision set by the
**whole** penetration, but only when the wait word carries `0x1000000`. The
port had op 0x16 decoded into `scaleTarget`/`scaleStep` and nothing that ever
read them.

### The maul was an animation with no consequence

`ZombieStateTargetMotionScript` kills on `obj+0x19C == obj+0x1354`, and
`obj+0x1354` is the script entry's fourth short. Stage 1's four cues are 24,
30, 62 and 64. Only the 24 ever fired.

`obj+0x19C` is the **play** clock. It ticks once per 60 Hz frame over data
authored at 30 Hz, so it counts to `g_motion_play_length[motion]` — and those
four clips are 41, 26, 43 and 46 frames, so three of the four cues are past the
authored frame count and unreachable if you count in authored frames, which the
port was doing. Across the whole game **30 of the 51 kill cues** are in that
range: `tools/verify_maul_cues.py` measures both readings and fails only if a
cue is past its clip's *play* length, which none is.

`mot.md` had `g_motion_play_length` as `[open]` — "about twice the frames, not
exactly `2n - 2`, has not been pinned down". It still is not exactly `2n - 2`:
across the 220 motions the bundles bake it is `2n - 2` for 91 and `2n - 3` for
129 and never anything else. Which of the two a motion gets is still `[open]`,
so the bundle now **carries the table** (`BakedMotion.play`) rather than
deriving it, and `MotionPlayFrame`/`MotionPlayLength` in `game/tables.ts` are
the only readers. That made class 0x24's `0x32` drift cue, `ZombieStateEmerge`'s
landing hold and `ZombieStateFallToGround`'s exit exact at the same time — all
three were counting authored frames too, and class 0x24's comment said outright
that the table "is not in the bundle" as the reason.

Corpus effect: civilians actually killed by their captors goes from 4 to 9 in
fifteen seconds, rescues from 21 to 18.

### `Wedged`, the overlay

`#show-stuck` marks in red every zombie the **world** push has moved for thirty
consecutive frames — an actor that cannot get where its state is taking it. It
pairs with `#show-coli`: that one says what the engine can feel, this one says
who is caught in it.

It could not be built on `ZombieFlag2.Shoved`, which is what it looks like it
should use. The engine raises that single bit from *either* half of
`ZombiePushOutOfWorldAndActors`, and the actor-versus-actor half fires
constantly in any crowd — the very first trace of captor 6376 showed
`shoved=true` on every frame with the collision set both full and empty, which
is what pointed at the radius rather than at a wall. So the port keeps
`Actor.worldPushDepth`, declared `[diverges]`, written only by the world half.

### Wrong turns

* The first reading of "stuck in the wall" was taken at face value and the
  collision sets were the first thing measured. They were irrelevant twice
  over: the trace was identical with every blob selected and with none.
* `web/test/port.test.ts` already had an assertion for the maul's kill cue and
  it passed throughout, because the fixture set `z.clock = 3 / 30` to reach cue
  3 — the same wrong unit the code used. Two halves of one mistake agreeing.
  The corpus check is what found it; the unit test could not have.

## The corpses that would not lie still

Reported straight after: a civilian killed by a zombie in a set piece replays
its dying animation instead of resting on it. Measured over the whole corpus —
drive every civilian *with its captors*, let the mauls finish, then watch the
last five seconds — **23 of 23** mauled civilians were still animating.

`CivilianUpdate`'s loop arm is the answer and it is four lines:

    if      (loops <  0)  model[0]++;                     // for ever
    else if (loops >  0) {
      if (model[2] < g_anim_frame_counts[model[8]]) model[0]++;
      else if (--loops != 0)                        model[0]++;
    }                                                     // ...and otherwise
                                                          // nothing at all

There is no "stop" flag. When the count runs out **nothing increments the
cursor again**, and the clip sits where it is for as long as the actor lives.
The port advanced `obj.clock` unconditionally in `ActorAdvanceMotion` and the
renderer wrapped it with `% frames`, so "stop incrementing" had to be said out
loud: `CivilianHoldLastFrame` pins the clock at the play length.

### The wrong turn, and what it taught

The first version compared the cursor against the play length and decremented
when it reached it — and the new unit test caught it immediately: a two-loop
clip spent **both** loops on the first play-through. The cursor was running
away, so every frame after the first was `>= play`.

`SkeletonAdvancePlayCursor` (`FUN_004111A0`) is what settles it, and it closes
the last `[open]` in the `g_motion_play_length` note at the same time:

    model[2] = model[0] % (g_motion_play_length[model[8]] + 1);   /* cursor */
    model[6] = model[2] / 2;                                      /* frame  */

* `model[0]` (`obj+0x194`) is the tick the owning class increments;
* `model[2]` (`obj+0x19C`) is the play cursor and it **wraps** at
  `play_length + 1`, so it visits 0..play_length and returns to zero;
* `model[6]` is the authored frame — the cursor halved — and an odd cursor
  blends the two neighbouring frames on tracks 1 and 2. That is the "odd values
  interpolated" that `mot.md` guessed at, stated by the code.

So `model[2] < play_length` is false on exactly one frame of each cycle, which
is what makes a loop cost one play. `MotionPlayFrame` wraps to match, and every
last-frame test went back to **equality**: `>=` against a wrapping cursor is
true on two frames of every cycle, which would spend two loops per play.

Making that exact moved the corpus again on its own — mauled 9 -> 10, rescued
18 -> 17 — because the loop counting in the maul was off by the same factor.

### One corpse that is *supposed* to keep moving

Stage 4's civilian `4484` still animates, and correctly: its death script is
`{op 0, motion 606, loops -1}`, and a negative count is the engine's own "play
for ever". `corpses.mjs` excludes negative counts by name rather than
tolerating a failure, so the check stays able to fail.


## `wait_scripted_actors` waits for the civilians — and the VM's yield flag

`EvtOpWaitScriptedActors46` (`FUN_0045FCD0`) is `EvtOpWaitEnemiesPresent43`
with **`g_civilians_alive`** (`0x009CA0E8`) where the enemy counter goes —
same latch, same two side conditions, same `pc += 8`. That closes the
`[open] which actor class` that has sat on this opcode: the scripted actors
are the **class-0x10 civilians**. All **68** sites in the shipped scripts pass
operand 0, so in practice it is always "wait until the last civilian has left
play".

### The counter's exits, and the one the port does not have

`g_civilians_alive` was annotated here as "`CivilianInit` raises it unless the
wait word carries `0x08000000`". **That was wrong.** The `INC word ptr` at
`0x0048A6FE` sits on the straight-line fall-through with no branch around it —
`get_xrefs_to` returns nothing for it or for the instruction after. The
`0x08000000` test three instructions later guards *two other* counters,
`0x009A21BA` and `word[0x009C9100 + stage*2]`. The two got conflated because
`FUN_0045EDD0` zeroes `g_civilians_alive` and `0x9C9100[stage]` back to back.
The port was already unconditional here, so the code was right and the note
was wrong — the reverse of the usual failure, and worth saying out loud.

There are three ways out, each decrementing once:

* op `0x2C` carrying `0x00080000` (`CivilianRunScript` `0x0048BA3C`), which
  also stamps sub+0x04 bit 0 so a later teardown will not double-count;
* `CivilianUpdate` `0x0048B003`, the remove-delay teardown;
* `CivilianUpdate` `0x0048B0AC`, the **off-camera** teardown — *not ported*.

Rather than guess whether the missing one matters, it is bounded:
`tools/verify_civilian_count.py` asserts that **every** stream carrying
`0x02000000` also carries `0x00080000`. It does — 90 of 90 — so a civilian
removed off camera has always left the count already, and the unported path
cannot strand `wait_scripted_actors` above zero. If that ever stops being
true the check fails instead of the player deadlocking.

### `DAT_009C8EA0` is the yield flag, not a wait latch

Reading the waits meant reading `EvtInterpreterLoop`, and the thing every one
of them touches is worth stating properly. `g_evt_yield` is **not cleared at
loop entry**:

    do { g_evt_opcode = *pc; dispatch[g_evt_opcode](); } while (g_evt_yield == 0);

so a wait handler reached with it clear sets it and returns **without testing
its condition** — every wait costs at least one frame, even one already
satisfied. On a later frame it tests; a satisfied wait clears the flag and
advances `pc`, and the loop then **keeps dispatching in the same frame** until
the next wait. That is the whole of the VM's frame pacing, and it explains two
things that looked odd: opcode `0x4E` `halt` is nothing but `g_evt_yield = 1`
with `pc` unchanged (`FUN_0045EFF0`, confirmed as dispatch slot `0x4E`), and
the unused slots `0x00/0x2A/0x34/0x3C/0x4C` point at a bare `RET`, which
leaves the flag clear and spins the loop forever — reaching one hangs.

`DAT_007DCCA4`, which nearly every wait also requires, is recomputed once per
frame at the top of the loop and read nowhere else: *may the script advance* —
a player in state 5 with lives left. So the script, `wait_frames`' countdown
included, **freezes on the continue screen** rather than running on while the
player is dead. The port has no such gate; it has no death.

**The port's waits pass a satisfied gate in zero frames**, where the engine
always spends one. That is a real divergence, left alone here rather than
folded into an unrelated change: it is one frame per wait, and changing it
touches every wait in the client at once.

## The first zombies in stage 1 were behind a gate nobody had opened

Nothing came round the first corner of stage 1. The block that ought to place
them — block 0, step 2 — is not short of spawn opcodes, and three of them run:
two `spawn_placed` (`09`) at the top of the step and a `spawn_obj` (`0B`) with
four descriptors right where the zombies should be. That last one is what made
this hard to see, because it *does* spawn four objects and they *are* placed —
they are just class `0x20`, which has no module in the port and does nothing.
The zombies are two instructions earlier:

    000554  07 spawn_if_mode2_c   00977BC4 00977BF4 00977C24 FFFFFFFF
    000568  03 spawn_if_mode1_c   00977BF4 00977C24 FFFFFFFF

Both were unimplemented, and they are the *only* thing that places those
zombies. Two failures had to line up: `hod2lib.evt.SPAWN_OPCODES` stopped at
the four ungated spawn opcodes, so the bundle carried `raw` operands and no
resolved descriptors for these; and `Walker.OPS` had no handler, so even a
resolved descriptor would have gone nowhere.

### `mode` was never a mode

`FUN_00408820` (opcodes `0x01`–`0x04`) and `FUN_00408860` (`0x05`–`0x08`) are
one routine written twice:

    if (g_max_attackers == N) jmp g_evt_spawn_gated_handlers[g_evt_opcode];
    else                      walk the operand list to its -1 and skip it;

`g_evt_spawn_gated_handlers` at `0x00577650` is indexed by the **opcode
itself** and holds `EvtOpSpawnPlaced09`, `EvtOpSpawnSimple0A`,
`EvtOpSpawnObj0B`, `EvtOpSpawnObjC0C` — twice, at 1–4 and again at 5–8. So
these eight opcodes are the ordinary four with a gate in front and *nothing
else changed*: same descriptors, same allocators, same tails.

`DAT_009C8E84` was already named `g_max_attackers` from the permit work. It is
raised in `FUN_00414770` when a player enters a state whose flags carry `0x20`
and lowered in `FUN_00414280` when one leaves, so it is the count of players
**currently in play** — which is exactly why the permit code reads it as "how
many enemies may attack at once". The old `spawn_if_mode1_*` name guessed at a
difficulty or game mode; there is none. Renamed to `spawn_placed_if_1p`,
`spawn_obj_if_1p`, `spawn_obj_if_2p` and so on, after the handler each
forwards to and the count it needs.

The two lists **overlap rather than replace**, which is the detail that decides
what a one-player game gets. `07` lists three descriptors and `03` lists the
last two of that same three, at `0x7F4` and `0x824`. So one player gets two
zombies and two players get three; a reading that treated the gates as
alternatives would have put three on screen in single player.

### What it cost elsewhere

Widening `SPAWN_OPCODES` is not a local change — `evt.spawns()` is what the
asset bundler, the rig writer and four verifiers walk. Eleven more class-0x30
captors and thirteen more captor scripts came into view, so
`verify_captor_scripts.py`'s baselines moved from 58/86 to 69/99. Those are
enemies the shipped scripts really do place; they had been invisible to every
tool in the repo, not only to the player. Stage 1's bundle went from 203 to 209
spawns.

### The citation check did not reach the file this landed in

`verify_port.py` only globbed `web/src/game/`, so the exe citations in
`web/src/script/` — the whole opcode-handler half of the port — went unchecked.
Widened to a `cited_files()` that covers both for the name and global checks,
while the boundary and coverage checks stay on `game/`: `script/` legitimately
touches the DOM, and the opcode handlers are not the gameplay call graph that
coverage measures. That immediately counted two more ports and no failures,
which says the existing citations there were already honest — but they were
honest by luck.

### Wrong turns

- Wrote the two gated opcodes as one TypeScript function taking the required
  player count as an argument. That is one TS function for two exe functions,
  and the em-dash citation form would have failed the check the moment it
  reached it. Split into `EvtOpSpawnIfOnePlayer` and `EvtOpSpawnIfTwoPlayers`,
  which is what the exe has.
- Listed `0x03/0x04/0x07/0x08` in `PARAM_OPCODES` *and* mapped through
  `effective_spawn_opcode` in `has_params`. Two sources of truth for one
  answer; `PARAM_OPCODES` is the set of allocators and the mapping does the
  rest.
- `./ghidra/run.sh export-annotations` cannot run while a Ghidra GUI holds the
  project lock — it aborts with `LockException` and the TSVs are left alone, so
  a `git diff` after it looks like a clean export when nothing ran. The rows
  here were appended by a script that reproduces the exporter's format exactly
  and is idempotent, and `verify_annotations.py` confirms them against the EXE.

### Still open in stage 1

`0x0A` `spawn_simple`, 10 sites. Its operands are **not** the 0x24-byte
placement descriptor: `EvtOpSpawnSimple0A` (`0x00408990`) reads a two-word
`{class, hp}` record and never writes a position, so whatever it makes places
itself. Class `0x20`, 4 of them in this step alone, still has no module.
`0x31` `goto_scene_state` runs 32 times and is inert here.

## The tutorial's axe man, who was never supposed to move

Reported: "the 'tutorial' zombie (the one with the axe — e.g. 8/4/4 0x2BF4)
has never behaved properly; he tries to move when he should be in place."

`0x2BF4` is 11252, and its placement is class 0x30, character type **19**,
body condition **7**, initial state **33**. State 33 was not in the port's
`ZombieState` at all, so `ZombieEntryState` sent it to `AttackRun`.

`g_class30_states[33]` is `0x00459080`. Read: it is the one class-0x30 state
that never writes a position. Sub 0 latches an idle delay by how many hands
still hold a weapon — `tail+0x04` for two, `tail+0x08` for one, and
`ZombieReleaseAndDespawn` for none; sub 1 plays `row[0]` and counts it down;
sub 2 waits on `TryClaimAttackSlot` and starts the throw clip; sub 3 waits for
`obj+0x19C` to reach the attack entry's hit frame and lets the weapon go; sub 4
plays the clip out and goes back to sub 0 while a hand is still armed; sub 5
idles `tail+0x0C` and leaves. Subs 0 to 2 are a **fallthrough** — `case 0` has
no `break` — so with zero delays a spawn arms, waits and claims on one frame,
and three of the nine have exactly that.

### The names came out of the asset slots, not out of the look of it

The identification is the satisfying part. `ZombiePickThrowingHand`
(`FUN_00458F00`) and `ZombieThrowHandWeapon` (`FUN_0045A240`) each switch on
the character type over three cases, comparing bone 5's and bone 8's **draw
slots** — `0x20C + bone * 0x90` — against literals. Resolved through
`asset_slots()`:

| type | file | bone 5 | bone 8 | projectile |
|---|---|---|---|---|
| 1 | `znassb.bin` | 0x1BA9 | 0x1BA5 | its own parts 3 and 2 |
| 0x13 | **`tutorial.bin`** | 0x1ECE | 0x1ECA | `0x249` = `znonoo.bin` 0 |
| 0x14 | `znonoopa.bin` | 0x1EF9 | 0x1EF5 | the same |

So the user's "tutorial zombie with the axe" is the game's own name for it
twice over: the character is `tutorial.bin` and what it throws is `znonoo.bin`
— *ono* is an axe. Neither was guessed from the model.

### What the descriptor tail says, and the check that could have failed

`tail+0x03` — the same byte the port already carries as `attack_state` — is
the exit: **0** walks away through state 15 with the distance at `tail+0x10`,
**26** leaps through state 26 to the point at `tail+0x10`..`+0x18` with the
gravity at `+0x20`. All seven spawns read at the time split cleanly: the five
with 0 have a small distance at `+0x10` and zeroes after it, and the two with
26 have a real world point and a plausible gravity. Reading the leap fields off
a walk spawn gives `(5.0, 0, 0)` and a gravity of 8.31 — the next descriptor.

Both exits are entered at **sub 1**, which is finally why states 15 and 26 have
a sub-1 arm that skips their own descriptor read: the fields are already on the
actor. And the walk arm raises `obj+0x34` bit `0x20000000` — the arm of
`ZombieStateWalkDistance` that retires the actor instead of attacking, which
the walk-in commit had annotated as reachable by no shipped spawn. **It is
reachable, and this is the only thing that reaches it.** Corrected.

### Wrong turns

* The first measurement said the tutorial zombie drifted 4.2 units while
  throwing, and the first guess was that `ActorSetMotionBlended` fails to reset
  the root-motion baseline the way `ZombieSetMotionIfIdle` does. It does reset
  it — checked before changing anything. The 4.2 units are the throw clip's own
  wind-up: `tutorial.bin`'s two throw clips have a net root translation of
  **exactly zero** and swing the actor forward and back in between. The
  harness now measures net displacement, which is the question actually being
  asked, and reports the swing beside it.
* `web/tools/civilians.mjs`' pinned corpus counts went from 47/47 to 53/57
  mid-session, and that was **not** this work: a peer session's reading of evt
  opcodes 0x01-0x0A decodes player-count-gated spawns the exporter had been
  dropping. Re-pinned, with a note saying the numbers are the corpus rather
  than a target.

### A note on committing

Three peer sessions were live and one had work staged in the index. This
commit was built with a temporary `GIT_INDEX_FILE` and `git commit-tree` so the
real index was never touched, and the two shared annotation files were
committed as `HEAD` plus this session's own rows rather than as the mixed
working tree. Two peer commits landed while it was in progress; the new commit
sits on top of them and nothing was lost.


## `goto_scene_state` is the end-of-room instruction

548 sites, and **every one passes minor 3**. It is not a general transition —
it has exactly one shape, and it sits between the wait that holds for the room
and `end_block`:

```
queue_event finish_sequence 4|6|7   ; a cam/ path camera -- scene state 2
wait_enemies_alive 0                ; the room
goto_scene_state 3                  ; hand the camera back, retire the action
end_block
```

`EvtOpGotoSceneState31` enters state (1, 3) — `CameraFromViewAngles`, which
builds the pose from the player's view angles at `0x009A60CC/D0/D4` instead of
from the `cam/` path — parks the action ring's handler slot on a bare `RET`,
which is what tears down the camera driver the `finish_sequence` installed, and
takes one off `g_queued_events_pending`.

That last one is the useful half. `EvtActionFinishSequence21` is **the one
action handler that never retires itself**: it installs a persistent camera
driver and pins the ring's dequeue mode at "still running". `goto_scene_state`
and `set_action_drain_mode` are its script-side retirement — which is why they
trail almost every room. Measured over the shipped scripts: all 316
`goto_scene_state` sites have exactly one outstanding unretired `0x21`, and all
128 `set_action_drain_mode` instructions carry delta −1.

So `wait_queued_events_done` (`0x40`) is now counted for real rather than
resolved on "the camera move ended". The two agree closely — the approximation
was chosen for the common shape and the common shape is most of the game — but
the counter is a few frames quicker in every stage, because a stashed or held
pose retires at once where `cam.done` does not. Stage 3 differs by 91 frames.

The check that matters is that the accounting cannot deadlock. `seek.test.ts`
now drives all six stages on the clock; dropping `goto_scene_state`'s
retirement parks every one of them on a `wait_queued_events_done` within the
first few blocks. A second, structural check: `FUN_0045EBC0` zeroes the count
when it loads a block, so the engine absorbs an imbalance silently — and if
every action is retired by the right instruction, that reset is a no-op. It is,
in all six stages.

### A wrong turn worth recording

The first version of that test asserted only "the ring is empty at each block
boundary", and I convinced myself it was the sharp check. It is not: the
per-block reset means a mis-retired action is absorbed rather than
accumulating. I then "proved it could fail" with a `sed` that silently did not
match, and read the resulting all-green as confirmation. It was confirmation of
nothing. The lesson is the one this log keeps relearning — **when you break
something to prove a check fails, verify the break landed** — and the honest
version of the check is the deadlock, with the block-boundary residue as a
complement rather than the headline.

### Two annotations corrected

`0x00402860` was named `CameraStartTurnOntoPathTarget`, "forces
`CameraTurnOntoPathTarget` back into its turning state". The bytes at
`0x00402867` are `C6 05 2D 6F 9C 00 01` — it writes **1**, the *path* branch,
and clears `0x009C6F2C`: it abandons the turn and hands the camera back after
one damped step. Renamed `CameraHandBackToPath`. It is unreachable anyway.

The port's `camera/track.ts` said `DAT_009C6F2E` was "read in two places and
written in none". It *is* written — once, to 0, at `0x0040322D`. The dead-code
conclusion stands; the reason was wrong.

### `DAT_009C6F2D` is `g_camera_free`, and the port does not have it

Every enemy wait — `0x43`, `0x44` and the new `0x46` — requires this byte, and
it means *no enemy is claiming the camera and the return-to-path swing has
finished*. `FUN_00402E00` recomputes it from `g_enemy_slots` every frame;
`FUN_00402650` clears it every frame the camera mode is not "return to path";
and inside that mode `CameraTurnOntoPathTarget` latches it when the eased
look-at catches the path target.

So in the real game a room-clear gate does **not** open the moment the last
enemy dies — it opens once the camera has swung back onto its rail. The port
has `g_enemy_slots`, `g_camera_settled` and `CameraTrackEnemiesTick` already,
so this is portable, and it is the most substantial piece of scripted-sequence
behaviour still missing. **[open]** — not attempted here.

## `end_block` was never a block terminator — renamed `advance_step`

Opcode `0x4F` was called `end_block`, and its handler `EvtAdvanceBlockOrRoute`.
Both read as "this is where a block ends", and the question that came out of
that reading was whether the port should retire live actors there — they
"shouldn't be coming with us to the next block". Reading `FUN_0045F000` says
neither half of that is right:

    step += 1;
    if (EvtGetStep(scene, block, step) == -1) {   /* steps ran out */
        ... follow the 8-byte route record ...
        step = 1;
    }
    pc = EvtGetStep(scene, block, step);
    branch_choice = 0;

It advances the **step**. Only an exhausted step list reaches the route table,
and blocks average 3.99 steps (479 steps over 120 blocks, one block of 18), so
the large majority of `0x4F` executions do not change block at all. Renamed the
opcode to `advance_step` and the handler to `EvtAdvanceStepOrRoute`, which is
what the port's own `advanceStepOrRoute` had been called all along — the exe
symbol and the opcode were the two places still carrying the old reading.

### Nothing retires actors at a block change, and nothing should

`EvtAdvanceStepOrRoute` touches no object state whatsoever. Nor does anything
else on the path: `EvtOpRegionEnter29` calls `RegionUnloadDelta`, which frees
*assets* for regions leaving the set; `FUN_0045EBC0` (block load) resets script
state — step cursor, pc, `g_queued_events_pending`, the skip flags — and
`FUN_00408D60`, which only restores the default approach steps `{2,3,4}`.

The scripts confirm this is deliberate. Counting enemy-class descriptors placed
with no intervening `wait_enemies_alive` / `wait_enemies_present` /
`wait_scripted_actors`, live enemies cross **71 step boundaries and 19 block
boundaries** across the six stages — a lower bound, since any gate is treated
here as clearing and `wait_enemies_alive 3` does not. Stage 2 is the clearest
case: block 0 step 3 ends `0B spawn_obj 00977DCC 00977E90` then `4F`, and block
1 step 0 opens with a region load and lighting and no gate at all. A sweep at
`0x4F` would delete stage 2's opening encounter.

The only wholesale sweep in the game is the **scene** change: `FUN_0040E860`
calls `FUN_004A7310`, which rebases the 16 MB bump arena every object is
allocated from by `FUN_004A6FA0`. Objects are not despawned one at a time; the
pool is thrown away. The port already matches that — `ResetGameGlobals` clears
`G.g_object_list` — so nothing needed changing.

`walker.ts` had already written down the principle in `retireGatedEnemies`:
enemies are dead on the far side of a gate *by construction*, because the
script cannot pass the gate until the player has killed them. The 71 ungated
crossings are the cases where the script deliberately does not gate.

### Left open: `g_evt_block_counter` counts steps, not blocks

**[proved]** and **not fixed here.** `DAT_009A2BB0` is named
`g_evt_block_counter`, and `globals.tsv` calls it "a monotonic count of block
transitions". It is neither monotonic nor a block count: it is the **step
index** — `EvtAdvanceStepOrRoute` increments it at the top and assigns it `1`
in the route branch, and `FUN_0045EBC0` seeds it with 0, 1 or 5 depending on
game mode. Every use of it as a step index in the same function confirms it.

That matters because `PropExpireByBlockLifetime` (`FUN_00466640`) ages a prop
by one tick every time this value *changes*:

    if (g_evt_block_counter != obj->+0x196) {
        if (obj->+0x11C < ++obj->+0x197) { ActorDespawn(obj); return; }
        obj->+0x196 = g_evt_block_counter;
    }

so `obj+0x11C` is a lifetime in **steps**, not blocks. The port increments
`G.g_evt_block_counter` only in `Walker.goToBlock`, once per block transition —
so with blocks averaging 3.99 steps, a prop carrying one of the common
lifetimes (0–5) lives roughly four times too long. The transcription of
`PropExpireByBlockLifetime` itself is faithful; the bug is entirely in what the
counter counts.

Left for its own change because it is a behavioural fix across all six stages
plus a second global rename — `g_evt_block_counter` → `g_evt_step_index`,
`PropExpireByBlockLifetime` → `PropExpireByStepLifetime`, and the
`spawnBlock` / `blocksElapsed` fields with them — and folding that into a
rename commit would hide it.

## The action ring leaked wherever nothing was ticking

Reported as "consistently getting stuck on `wait_queued_events_done` even when
nothing is happening", and it was mine — a regression from counting
`g_queued_events_pending` for real.

The engine runs the ring **one action at a time**: a `cam_play` queued behind
another does not start until the first retires. This port runs an action the
moment it is queued, and tracked the outstanding `cam_play` in a single
boolean. That is fine while a clock is running, because each camera reaches the
end of its path and retires as it goes — which is exactly why driving all six
stages from cold found nothing.

`seek` and `stepOnce` have no clock. They replay instructions to reproduce an
address, so a whole block's worth of `cam_play`s queue with none of them ever
finishing, and every retirement but the last is lost. The count never falls
back to zero and the next `wait_queued_events_done` parks for good. **138 of
the 308 block/step addresses a reload can land on were stuck.**

The fix follows the port's own model: an action ends when the next one starts,
so replacing `walker.cam` retires whatever was on it. The regression test is
the shape that actually breaks — seek to every reload address, *then* play —
because driving from cold cannot see it.

Worth naming the pattern, because this is the second time this session: a
check that exercises the healthy path and calls itself a regression test. The
first was asserting the ring balances at block boundaries, which the engine's
per-block reset makes almost unfalsifiable. Both times the missing question was
*what sequence of calls actually produces the bug* — and both times it was a
path the obvious test never takes.

## `g_camera_free`: a room hands over when the camera does

Now ported. `wait_enemies_present`, `wait_enemies_alive` and
`wait_scripted_actors` all require `0x009C6F2D` on top of their counter, so the
script does **not** advance on the frame the last enemy dies — it advances once
no enemy holds a camera slot and the eased look-at has caught the path target.
That beat is the difference between a room ending and a room cutting.

The engine spreads it over two per-frame camera drivers — `FUN_00402E00`
raises it from the slot array, `FUN_00402650` clears it on any frame the camera
is not in return-to-path mode, and `CameraTurnOntoPathTarget` latches it on
convergence. The port has one camera routine, so it writes out the conjunction
those compute between them: no slot claimed, nothing alive, aim converged.

Two things had to be fixed underneath it:

* **`g_camera_settled` was never cleared.** `FUN_004022B0` zeroes it at the top
  of the camera actor every frame and the convergence test raises it again — it
  is a *this frame* answer. The port only ever raised it, so after the first
  convergence it stayed 1 for the rest of the stage and anything gated on it
  was permanently open. That had been invisible because only class 0x10's
  `CameraSettled` wait read it.
* **The convergence test cannot answer for an unposed camera.** `FUN_00401DF0`
  divides by both lengths, and the port returns 0 rather than NaN when either
  is degenerate — a look-at sitting exactly on the eye, before any path has
  seated the block. Zero is never `> 0.99999`, so nothing would settle and, now
  that room-clear gates hang off it, the script would park for ever. Convergence
  is answered directly in that case: two coincident points are converged
  whatever the eye is doing. A numerical guard, not a change to the rule —
  and `port.test.ts` fails without it rather than trusting the reasoning.

Still not ported, and now the only known gap in this family: the extra frame of
hysteresis `wait_enemies_alive` alone carries (`g_evt_wait_alive_hysteresis`,
`0x007DCCA8`), which makes its condition hold two frames running.

## The axe man fell off his ledge, and the harness could not see it

Reported after the state-33 port landed: he "immediately falls to the ground
and then starts throwing axes behind the wall", and after both axes "he should
walk backwards and then die so the game can continue". Three separate faults,
and the third is the one worth keeping.

### He fell because the port threw the spawn record's flags away

Walking the real script to `8/4/26` and reading the trace: he is at `y = -15.5`
and his spawn record places him at `y = 47.0`. The collision the script has
selected there is one blob, `coli1.bin:4968` — **two quads, both `axis 2` with
a zero-Y normal**, a vertical panel. `QueryGroundHeightAt` finds nothing under
him and returns `g_camera_fixed_eye_y`, the ground plane op 21 had just set, so
the per-frame snap drops him sixty-two units off the ledge. From down there the
throws come out behind the wall he had been standing on.

The engine does not snap him, because `ZombiePushOutOfWorldAndActors` reads

    if ((obj[0x34] & 0x20000) == 0) ActorSnapToGroundHeight(obj);

and his spawn record's flags word is exactly `0x20000`. `ActorInitFlags`
(`FUN_00408970`) makes that word `obj+0x34` before the class `Init` runs, and
the port carried none of it — a `[diverges]` written down two commits earlier
when the run-variant bit turned up. This is what it cost. Ninety-five shipped
spawns set that bit.

The word is carried whole now, as the engine does, rather than bit by bit.

### He never walked backwards because the tail never reached him

`arrive=0` in the trace. `ZombieStandAndThrowLeave` reads the walk distance out
of `obj.standThrow`, and `render/characters.ts` never passed `stand_throw` —
so every stationary thrower in the player read zero, reached it on its first
frame and despawned on the spot instead of backing away five units.

### The part worth keeping: the harness could not have caught either

`web/tools/throwers.mjs` reported **nine of nine working** while every one of
them was broken in the player, because the harness built its own descriptor and
passed `stand_throw` — the field the player was missing. A harness that builds
its actor differently from the thing it is checking is testing the port and not
the player.

So the mapping from placement JSON to `Actor` fields is now one function,
`DescriptorFromPlacement` in `game/descriptor.ts`, and the player and all three
harnesses call it. Doing that immediately turned up a second drift in the other
direction: `replay.mjs` had been passing `grab`, `back_away_delay`, `cue` and
`leap_strike_frames` and the *player* had not, so class 0x31's grab, its cue
wait, its blink-in hold and its leap strike had been reading descriptors the
player never handed them. Two of those fields were not even declared on
`CharacterPlacement`.

The harness also selected **every** collision blob rather than the one the
script had chosen — the same mistake that produced the wrong answer about the
stage 2 wall. It seeks the walker to each thrower's own spawn address now.

### Wrong turns

* The first version of the height check demanded that all nine throwers hold
  their y. Only one of the nine has the `0x20000` flag; the other eight are
  meant to settle onto whatever is under them, so the check is conditional on
  the flag now and counts the two groups separately. A check that would fail on
  correct behaviour is worse than no check.
* Stage 3's two leaping throwers looked wrong — "left by AttackRun after 563
  units" — and they are not. `ZombieStateDelayedLeap` ends by handing to
  `AttackRun`, so they leap down sixty-five units off their ledge and then join
  the fight, which is what the state says and what the descriptor asks for.


## `wait_scripted_actors` hung because the camera frame was a float

Reported as sticking on `wait_scripted_actors 0` "even after they die", at
`stage=1&block=1&step=8`. The counter was innocent — a killed civilian leaves
`g_civilians_alive` correctly, and the death scripts carry `LeaveCountNow` in
59 of the 60 streams the game uses as one. What never happened was the
*removal*.

Stage 1's civilian `0x1828` leaves by a camera cue: `removePath 39`,
`removeFrame 280`. Class 0x10 tests that cue with `==`, and so does the engine
— safely, because `g_cam_path_frame` (`0x009A6110`) is written by both camera
drivers through **`__ftol`**. It is an integer that steps by exactly one, so it
cannot pass a cue without landing on it.

The port handed that global the walker's clock directly, and the walker's clock
is `dt * 60` — a float. At a fixed 1/60 it stays integral and every `==`
matches, which is why **every headless test passed and only the browser broke**:
under a real frame time the value goes fractional and a cue frame is simply
never equal to it. The civilian never started its removal countdown, never left
the count, and the wait sat there for ever.

Two changes: the global is truncated as `__ftol` does, and the one-shot cue
tests became crossing tests (`prev < cue <= now`) rather than equality, because
even an integer clock driven by elapsed time can advance by two on a slow frame
and step straight over. Classes 0x24 and 0x25 already ask `>=` and are fine;
class 0x31's `!==` at `scripted.ts:215` is a different shape — it gates a
per-frame action rather than latching once — and was left alone. `[open]`

The wider lesson is the one the fixed-timestep harness kept hiding: a test that
ticks at exactly 1/60 cannot see a bug whose cause is that the timestep is not
exactly 1/60. Both of this session's stuck-script bugs were invisible to the
headless drive for that family of reason — the first because `seek` has no
clock at all, this one because the test clock was too perfect.

## `g_camera_free`, corrected

The first cut of this ANDed three terms — no slot claimed, nothing alive, aim
converged — and that is stronger than anything the engine computes. They belong
to *two alternative drivers*, selected by the `finish_sequence` minor
(`DAT_00576B20`: 4 and 6 install `FUN_00402650`, 7 installs `FUN_00402E00`),
not to one. `FUN_00402E00` is four slot bytes and nothing else.

Worse, I had not implemented the engine's escape hatch: every enemy death site
frees the actor's slot and then forces the flag straight to 1 — `0x00480416`
then `0x0048042C`, and `0x00428B44` right after `g_enemies_present--`. The
engine deliberately refuses to make a room wait out the swing back. With the
conjunction and no force, a room-clear gate stayed shut for good.

Now it is `FUN_00402E00` transcribed, and the port's slot list is rebuilt from
the live actors each frame so a dead enemy leaves it on its own — one frame
later than the engine's explicit store.

## `g_evt_block_counter` was the step index all along, and props lived four times too long

Follow-up to the `advance_step` rename, and the substance behind it. The
counter at `0x009A2BB0` was named `g_evt_block_counter` and `globals.tsv`
called it "a monotonic count of block transitions". It is neither monotonic nor
a block count. `EvtAdvanceStepOrRoute` increments it at the top and assigns it
**1** in the route branch, `FUN_0045EBC0` seeds it with 0, 1 or 5 by game mode,
and every other use in that function indexes the step table with it. It is the
**step index**, running 1..k inside a block and dropping back to 1 on a block
change.

`PropExpireByStepLifetime` (`FUN_00466640`) ages a prop one tick every time the
value *changes*:

    if (g_evt_step_index != obj->+0x196) {
        if (obj->+0x11C < ++obj->+0x197) { ActorDespawn(obj); return; }
        obj->+0x196 = g_evt_step_index;
    }

so `obj+0x11C` is a lifetime in **event steps**. The port's transcription of
that function was faithful; the bug was entirely in what the counter counted.
`Walker.goToBlock` incremented `G.g_evt_block_counter` once per block
transition, and nothing incremented it per step — so with blocks averaging 3.99
steps, every class 0x41 and 0x44 prop lived about four times too long. Driving
the shipped scripts now shows 3.3× to 6.7× more index changes than block
changes, per stage.

### One field, because the engine has one global

The fix is not "also bump it on a step advance" — that is two counters that
have to agree, which is the shape the bug had. `Walker.step` is now an accessor
over `G.g_evt_step_index`: the walker's cursor and the prop clock are the same
field, as they are the same global in the engine.

That has a consequence worth writing down: the cursor is global, so two
`Walker`s alive at once share it. Nothing does — the app has one and the tests
build them one at a time — but a freshly constructed walker used to start at
`step = 0` and now inherits whatever the last one left. Two of `seek.test.ts`'s
gate tests build a walker and call `applyWait` without `reset`, and both failed
on the first run for exactly that reason. The constructor claims the cursor now.
That failure is the argument for the accessor rather than against it: with two
fields the same staleness would have sat in `G` unnoticed, because nothing was
reading it.

### The rename, and the bundle key with it

`g_evt_block_counter` → `g_evt_step_index`, `PropExpireByBlockLifetime` →
`PropExpireByStepLifetime`, and the two prop fields — `spawnBlock` →
`lastStepIndex`, `blocksElapsed` → `stepsElapsed`. The exported bundle key
`lifetime_evt_blocks` → `lifetime_evt_steps` went with them, which meant
re-exporting all twelve stage bundles: a stale bundle would leave
`pl.lifetime_evt_steps` undefined, `?? 0` would make it a zero lifetime, and
every prop would vanish on its first step change. That is a silent failure the
type system cannot catch, so the audit is per file and by hand:

    for f in extract/player/stage*/stage*.script.json; do
      grep -o 'lifetime_evt_[a-z]*' "$f" | sort -u; done

Worth knowing: the first `--all` came back with stages 3 and 4 still carrying
the old key. A peer session was exporting at the same time, from a process that
had imported `hod2lib.bundle` before the edit. Renaming a *serialised* key with
other sessions live needs the audit afterwards, not just the export.

### Not mine, but failing

`verify_port.py` fails at HEAD on `web/src/game/camera/track.ts`: it cites
`g_camera_free` — `FUN_00402E00`, and no such row is in `functions.tsv`. That
arrived with 2e6edda and the address is absent from HEAD's TSV too, so it is
not fallout from this rename. Left for whoever named it; it wants a real name
in Ghidra, and a `g_`-prefixed one for a function is suspect on its own.

## The captor's exit, and the two pieces that were left open

`ZombieScriptEnded` (`FUN_0045C8D0`) is where a captor turns on the player, and
the port had the role flip but not the three details around it.

**The `WalkPastPoint` shortcut.** The engine does not always walk the leg:

```c
case 0x28:
    if (ActorPointIsAhead(obj+0x64, obj+0x40, ZombieScriptForState(...)))
        { obj+0x1310 = 1; obj+0x1312 = 0; }      /* straight to AttackRun */
    else  obj+0x1312 = 1;
```

Stage 1's `0x18E8` is exactly that shape — `initial_state 34`,
`attack_state 40`, an attack script whose point is already in front of it and
no entries at all. The port only ever set sub 1, so it walked the whole leg
before turning. It reached `AttackRun` either way, one frame later, so this is
fidelity rather than the reported symptom — which I still have not reproduced,
because `replay.mjs` builds actors from *script* spawns and a captor is not
one: `CivilianInit` builds it from the civilian's own child array. Closing that
harness gap is what would let the maul be driven headlessly at all. `[open]`

**The camera cue, `tail+0x0C`/`+0x0E`.** The exporter was not carrying it, so
both the `WalkToPoint` flag and state 42 were unportable. It is now — gated on
the spawn actually having a captor script, which matters: read blind off class
0x30 those bytes yield **333** "cues", of which 330 are mantissa
(`path: 13107, frame: -16093`) because every other state uses them for a
destination, a waypoint, a pounce or a grab. Gated properly it is **three**,
all in stage 2 — `(66, 430)` twice and `(75, 660)` once — which is exactly the
count read independently out of the disassembly.

**State 42, `ZombieStateHoldForCameraCue` (`FUN_0045BFD0`).** Unnamed in Ghidra
until now. A captor whose script has ended and which would go to `AttackRun` is
being *staged for a shot*: it holds here until the camera reaches its cue. It
is not an idle — it runs the state it is holding (`obj+0x132C`, the delegate)
every frame and takes the state back afterwards, so the zombie really does run
at the player and hold at range. What it is forbidden is **landing the blow**:
an attempt to reach `Strike` is bounced to `HoldAtRange` and the permit handed
back, which makes this the only code in the captor family that touches
`g_attack_permits`.

One shape difference: the engine calls `g_class30_states[obj+0x132C]` straight
out of the table, where the port dispatches on `obj.state`. So the delegate is
handed in as a callback and the state field is set around the call — importing
the dispatcher back into `target.ts` would close a cycle. [diverges]

Also named the two finish-sequence camera drivers this turn's earlier
`g_camera_free` work leaned on: `CameraDriverFromDeferredPose` (`FUN_00402E00`,
minor 7) and `CameraDriverSelectMode` (`FUN_00402650`, minors 4 and 6). Having
them named is what makes "these are alternatives, not a conjunction" a citable
statement rather than a note in a comment.

## The hostage that cannot leave the count — verified, and still unexplained

Stage 1 block 1 step 8 op 12 is `wait_scripted_actors 0`. The only civilian in
play there is `0x1828`, the hostage, and I chased every link of how it leaves
`g_civilians_alive`. **Every one now checks out against the disassembly, and
the wait still cannot pass.** Writing that down rather than shipping a guess.

* `CivilianInit`'s `INC word ptr [0x009CA0E8]` at `0x0048A6FE` is
  **unconditional** — read myself this time, not delegated. The
  `TEST dword ptr [ECX],0x8000000` three instructions later guards two *other*
  counters, `0x009A21BA` and `word[0x009C9100 + stage*2]`.
* The op-`0x2C` decrement at `0x0048BA3C` is guarded by
  `TEST dword ptr [EAX],0x80000` — `0x00080000`, and nothing else in that
  handler decrements. This hostage's stream (index 1) is four commands:
  `Wait 0x8300000`, `SetMotion 399,-1`, `SetOnShot`, `End`. **No
  `LeaveCountNow`, no `Rescued`, no `RemoveOffCamera`.**
* So its only exit is the remove-delay teardown, whose cue `CivilianInit` seeds
  from the descriptor at `0x0048A481`/`0x0048A48F`: `sub+0x26 = tail+0x02`,
  `sub+0x28 = tail+0x04` — confirming the exporter's `removePath`/`removeFrame`
  decode. For this civilian that is **path 39, frame 280**, and the countdown
  length comes from `tail+0x06` at removal time.
* The cue test at `0x0048B02F`/`0x0048B03B` is exact equality against
  `g_active_cam_path` and `g_cam_path_frame`, which is what the port does.
* Camera path 39 runs frames 0..190 and 191..269 in step 8, and **270..365 in
  step 9**. Frame 280 is only reached *after* the wait.
* The wait's operand really is 0.

So the data says the script blocks on a civilian that cannot leave until the
step after the block. That is impossible in a shipping game, so one of these
readings is still wrong — most likely something about which frame counter
`0x009A6110` actually carries, since both camera drivers write it through
`__ftol` at the *end* of their work and one of them has just copied a deferred
rail pose. `[open]` — and the next thing to read.

Two things did come out of it.

**A gate the port does not have.** `CivilianUpdate` at `0x0048AF8E` skips the
whole removal path unless `[0x009A2230] == 0` or the wait word carries
`0x20000000`. The port removes unconditionally. `[open]`.

**`verify_civilian_count.py` was excusing exactly this case.** It treated
`UNCOUNTED` as a way out of `g_civilians_alive` — which I had *myself proved*
it is not, in the commit that introduced the file. With that removed, the
streams that depend entirely on the remove-delay teardown go from the 5 I
claimed to **11**, and stream 1 — this hostage — is the first of them. A check
built on a fact the same session disproved is worse than no check, because it
reads as coverage.

## `0x009A6110` answered, and what the hostage is actually for

`g_cam_path_frame` is `(int)` of the **float at `0x009C70BC`**. The decompiler
renders both camera drivers' last statement as `DAT_009A6110 = __ftol()` with
the argument dropped — the oldest trap in this project — and the disassembly
shows `FLD float ptr [0x009C70BC]` feeding it. It is also written directly by
`CamAdvancePathFrame` as `(&DAT_009A6110)[block * 0x69]`: the four 0x1A4-byte
camera/evt-action blocks, with the frame at `+0x04` and the running counter at
`+0x38`. So it **does** track an ordinary `cam_play`, and it was not the
culprit. `CameraStepRailTick` is clamped (`if (end <= cur) goto done`), so the
rail cannot overrun a queued range either.

The actual mechanism is in the civilian's own data. Stage 1's hostage `0x1828`
runs stream 1 — `Wait 0x8300000`, `SetMotion 399,-1`, `SetOnShot`, `End` — and
that wait word has **no bit inside `CivilianStepScript`'s `0x40003FFF` loop
mask**, so with the timer at -1 the script parks there for good, looping motion
399. That is the "I don't wanna die". It has no exit.

Its **on-shot script does**. Stream 0 re-points the removal cue with op `0x0D`
to `(39, 60)` — overriding the descriptor's `(39, 280)`, which is why the
descriptor cue looked unreachable — plays 378 then 377, waits on the play
cursor and the loop count, and ends on `Wait 0x80000`, `LeaveCountNow`.

**So the hostage is meant to be killed by its captor.** The chain is: captor
`0x1868` starts in state 35 (the maul) and kills on its cue frame → the
civilian's killed branch runs the on-shot script → `LeaveCountNow` → the count
reaches 0 → `wait_scripted_actors 0` passes.

Driven correctly in a harness the whole chain works: the captor mauls, kills at
frame 50, and goes to `AttackRun` — which also answers the "kills the civilian
then keeps moving" report — and the hostage leaves the count at frame 470.

Two wait bits read out of `CivilianStepScript` while doing it, both already
matching the port: `0x200` holds until the play cursor equals `sub+0x16`, and
`0x8000` is not a wait at all (outside the loop mask).

### Three harness bugs, and why they are worth recording

Every failed reading this turn was the probe, not the port: `charType` passed
as 1 so `MotionOf` missed and the cursor could not advance; the descriptor
assigned *after* `ActorSpawn` so `EnemyZombieInit` started the captor in
`AttackRun` instead of its maul; and `GameUpdate` called with an options object
when it takes positional arguments, which made `dt` undefined and turned the
whole clip clock to `NaN`. The second is the exact ordering `director.ts` and
`render/characters.ts` both carry a comment about. A harness that builds its
actor differently from the player is testing neither — which is the same lesson
`descriptor.ts` exists to enforce, learned again from the other side.

The port's units are all correct, then, and the stall is in integration.
`retireGatedEnemies` is a no-op outside a replay, every captor has a glTF node,
and the player does hand the descriptor over at spawn — so those are ruled out.
`[open]`: whether the captor is *visible*, and so clocked, at the moment it
should maul. And one testable consequence of the data: **if the captor is shot
before it kills the hostage, the hostage has no way out of the count until step
9** — which would be a deadlock the game's own data allows.

## Found it: a seek lands past a one-shot camera cue

`?stage=1&mode=play&block=1&step=8&op=12&frame=100` reproduces exactly, in an
integration harness driving the walker and the game together:

```
seeked to 1/8/12 cam frame 100
  STUCK at 1/8/12: wait=0x46 civilians  cam=39@190  civAlive=1
  hostage: dead=true  pc=4  wait=0x8100080  motion=378
```

The captor **does** kill the hostage, and its death script does start. It parks
at pc 4 on the camera cue its own script sets with op `0x0D` — **(39, 60)**.
The address restores the camera to frame **100**, already past it, and path 39
plays 0→190 exactly once and never returns. So the cue could not fire, the
script never reached its closing `LeaveCountNow`, `g_civilians_alive` stayed 1,
and `wait_scripted_actors 0` waited for ever.

Played from the start it works: op 12 is reached with the count at 1 and
releases 261 frames later — the death script's motion 377 playing out — which
is why every earlier check passed.

The fix is to stop pretending a cue is an event and let it be what it reads as:
**reached**. `CamPathCueReached` now asks `g_active_cam_path == path &&
g_cam_path_frame >= frame`, which is exactly how classes 0x24 and 0x25 already
ask the same question. In live play the first frame it is true is the frame the
engine's equality is true; the two differ only when something starts waiting
late, and there the engine would never answer at all.

Worth naming the shape, because it is the third variant of one bug this
session. The engine's cue tests are safe because its frame counter steps by
exactly one *and* whatever is waiting is polled on the frame it lands. This
port breaks both halves: the clock is elapsed time, so it can step over a cue;
and `seek` moves the camera without running the game, so a script can begin
waiting behind one. Equality, then crossing, then reached — each fix was
correct about the case in front of it and blind to the next.

### Four harness bugs, and the one that mattered

`charType` passed as 1; the descriptor assigned after `ActorSpawn` instead of
at spawn; `GameUpdate` called with an options object when it takes positional
arguments, which made `dt` undefined and `NaN`'d the clip clock; and hit points
never set, so every enemy sat at `hp = 0` and `dead = false` and no enemy gate
could ever open. Each one produced a confident wrong diagnosis before it was
caught. The harness only earned its answer once it built actors the way
`render/characters.ts` does — which is the argument `game/descriptor.ts` was
written to make, arriving from the other direction.

## The shutter's counter is a task field, and it is also the firing gate's

Read for the player's step 19, which wanted the shutter and the caption moved
out of the layer that draws them and into the script's own state.

`HudDrawShutterState` (`FUN_00413970`) is the nine-state machine, and the two
things it switches on are now named: `g_bHudShutterState` (`0x009CA0F4`), which
evt `0x1F` writes through `EvtOpSetHudShutterState1F`, and
`g_bHudShutterPrev` (`0x009C8E9C`). The second has two jobs, and both are worth
writing down. The routine compares it against the state to notice a change and
seed the slide counter — `0x28` entering state 3, `0` entering state 1 — and
state 7 assigns it back, which is what makes 7 "restore" rather than a state of
its own. It is written on every path **except** state 8, so a blackout never
becomes the state a later 7 restores. `[proved]`

**The counter is not a global.** It is `*(int *)(param_1 + 0x50)` — a field on
the draw task. The plan for step 19 said to "name `DAT_009CA0F4` and its
counter", and there was nothing to name: 26 xrefs on the state, none on any
adjacent counter, and the increment is against the task pointer. `[proved]`

The part that mattered for the port: **it is the same counter the firing gate
runs on.** State 3 counts it down to zero, draws the closed bars, moves to
state 4 and sets `g_nFiringGate` to 0 on that same path. The port had grown two
copies — `Walker.gateCloseLeft`, which was in the save state, and `Hud.counter`,
which was not — and nothing kept them equal. A seek reset one and restored the
other. One field in the exe, one field in the port now.

Also confirmed while here: `DrawDialogueSubtitleTask` (`FUN_00435AA0`) holds
its own three fields on the task — variant `+0x34`, frames remaining `+0x36`,
line index `+0x38`. The line index is a pure function of the countdown, because
the end frames are fixed and descending and the task only ever steps forward,
so the port derives it rather than storing it. That keeps the dialogue table
out of the save state without changing which line is on screen on any frame.

## Only the first zombie attacked, and it was a state nobody had ported

The report was "only the first enemy in the stage is attacking; when I kill him
none of the others do", with the sidebar saying `0 attacking · 1 live`. Two
class-0x30 actors were live in stage 2 block 3 — `0x1E00 char_adv00` and
`0x1E30 char_adv01`, the pair that comes out through the van's windscreen — and
both sat in `AttackRun` at 45 and 47 units, wanting a permit, playing motion
1022, for ever. Their distances were identical at 9 s and at 24 s.

**`ZombieStateMotionCue21` (`FUN_004577F0`) was not ported.** Their spawn
records name initial state 21, and `mapStartState`'s default arm sent state 21
to `AttackRun` — the right *final* state, so nothing looked wrong. What it
skipped is the only code in the game that clears three bits their record sets:

```
sub 1 -> 2 : obj+0x34 &= 0xffffbfff     clears 0x4000, the pose freeze
sub 2      : obj+0x1b4 == 0x39b && obj+0x19c == 0x26
             -> obj+0x34 &= 0xfffffeff  clears 0x100, the shot-immune window
exit       : obj+0x34 &= 0xffffdfff     clears 0x2000
```

`ZombieAdvanceMotion` (`FUN_00454860`) steps `obj+0x194` and `obj+0x198` only
`if ((obj+0x34 & 0x4000) == 0)`. So the freeze does not merely hold a pose: it
stops the clip, and because `SkeletonApplyRootMotion` works on the difference
between two frames — and a zombie is carried by its clips and by nothing else —
it stops the actor moving. Frozen clip, frozen actor, at whatever range the
record placed it. `[proved]`

All six shipped state-21 records, two in stage 2 and four in stage 5, carry
`0x4000 | 0x2000 | 0x100` and exit to state 1. They were also unshootable the
whole time, which nobody had noticed because they were also unreachable.

**What I got wrong on the way.** I spent the first pass on the wrong half. I
had `ZombieSetMotionIfIdle` refusing to interrupt a playing clip and
`FirstBakedOf` falling back to the in-place walk as the two suspects, and told
the user so. Both were wrong: motion 1022 *is* `row[2]`, the run, and its root
track carries 9.6 units over 31 frames. The clip was right and it was not
playing. The tell I had in hand and did not read was the flags word in my own
sidebar — `0x8016101`, with `0x4000` sitting in it — printed next to the state
on every one of those rows.

I also could not reproduce this headlessly at first and briefly took that as
information. It was not: `game/` actors are spawned from `render/characters.ts`
(the `render-drives-the-port` ratchet, 13), so a world with no renderer has no
zombies in it at all. The reproduction that worked was the screenshot harness
with `--dump '#panel-actors'`.

**Two smaller things read while here.** `ActorSetMotion` (`FUN_00411930`) is the
non-fading half of the pair with `ActorSetMotionBlended` — it zeroes the whole
track including both fade bytes — and is now ported, because state 21 uses it
and the blended one would have cross-faded a cue that is meant to cut. And the
exit test is against `g_motion_play_length`, not the authored frame count:
clip 923 is 41 frames against a play length of 79, so reading it in authored
frames would hand over at the halfway point of the jump.

One divergence declared: the engine tests `obj+0x19c == 0x26` against a counter
it steps by exactly one per frame, and this port's cursor comes off a clock the
player may advance by several frames at once. A missed equality there would
leave the actor shot-immune for life, so the port takes `>=`. At the engine's
own rate they are the same frame.

## Every civilian in the level was alive before its scene, and `Init` ran twice

`wait_scripted_actors` (0x46) never passed in stage 1 block 1: the sidebar said
`g_civilians_alive 13` against seven class-0x10 actors in the pool.

Two faults, one of them mine to own.

**The count was double.** `CharacterLayer.revive` — reached from
`Shooting.reset`, which `loadStageInto` calls two lines after `chars.build` —
walked every instance and called `g_class_handlers[cls].init(a, rng)` again.
`CivilianInit` (`FUN_0048A3E0`) raises `g_civilians_alive` unconditionally at
`0x0048A6FE`, so every stage load counted all seven twice, and every seek added
seven more. A stack trace on the increment is what found it; nothing about it
was visible in the source. `[proved]`

**And seven was already wrong.** The engine creates an object in
`SpawnFromDescriptor` (`FUN_00408A20`) when the script's spawn opcode runs, and
`CivilianInit` runs there. Stage 1 spawns its seven civilians from blocks 1, 4,
6, 8, 9 and 13 — at block 1 exactly **one** exists. This port built an `Actor`
for every placement in the stage's glTF at load time and gated it with
`visible`, so all seven were counted from frame one and a gate whose 68 sites
all want zero could never open. `[proved]`

**The wrong fix, and being told so.** My first move was to derive
`g_civilians_alive` from the pool each frame the way `g_enemies_alive` already
is. It works, the numbers agree, and it is a divergence I chose on my own
because the faithful fix looked like a refactor. The user's instruction was
blunt and correct: only spawn when the game would, and consult before diverging
at all. That rule is now non-negotiable 5 in the gameplay-port skill. The
derivation is reverted; `g_civilians_alive` is stepped where the engine steps
it.

`CharacterLayer` now adopts the hierarchies at build and holds them in
`pending`; `syncSpawns`, driven from the script phase beside
`SpawnPropContainers`, makes the game object when the instruction that spawns
it runs and unmakes it when it leaves. `revive` releases instead of re-initing,
so `Init` runs once per object as it does in the exe. `render-drives-the-port`
fell from 13 to 12.

The pool at that address went from 73 actors to 14.

**A third thing the same investigation turned up.** `CharacterLayer.update`
folded the `Characters` debug checkbox into `a.visible` — the port's stand-in
for object lifetime — so turning a *view* switch off emptied `g_enemies_alive`
and `g_civilians_alive` and unblocked every gate that reads them. And the
sidebar's list of actors holding a count gate open did not test `sub+0x04`
bit 0, so it named civilians that op 0x2C had already released: a gate held by
the **camera** (`g_camera_free`, and `EvtOpWaitScriptedActors46` at
`FUN_0045FCD0` does test it, along with `g_evt_gameplay_live`) read as one held
by an actor. Both fixed; the second is why the panel now says which half is
blocking.

## The permit the corpse never gave back

Reported as "they get close and then never attack": two enemies at the ring in
`HoldAtRange`, both saying *wants a permit*, and nobody holding one.

Both halves of that are readable now. The sidebar row said only "wants a
permit", which is the symptom and not the reason, so
`ZombieAttackRefusal` in `class30/hold.ts` is the gate and its explanation in
one function — the hub asks it and the panel prints the same answer, because a
second copy written for the panel is a copy that drifts. Five reasons: out of
rank, past the queue cap, cooling down, another enemy committed off screen, or
all permits held and by whom.

The bug it names: **`GameUpdate`'s dead-actor sweep cleared
`g_attack_permits` without lifting `g_attack_committed`.** That latch is raised
by a claim granted to an actor that was off screen, and `TryClaimAttackSlot`
(`FUN_00455DE0`) reads it on its first line and gives up before a player is
even picked. So a zombie killed while holding an off-screen permit refused
every remaining enemy in the scene, for ever.

The engine does not have this hole because the release is not a sweep: it is
`ZombieStateDeath6` (`FUN_00454D20`) sub 1 calling
`ZombieReleasePermitAndUntrack` (`FUN_004565A0`), whose first line is
`ReleaseAttackSlot` (`FUN_00456520`) and whose remainder drops the actor out of
camera tracking. `[proved]` — both now named in `functions.tsv`.

The port has no class-0x30 death state at all: `GameUpdate` skips dead actors
unless the handler sets `updatesWhenDead`, which class 0x31 does and class 0x30
does not, and the death clip is played by `ActorAdvanceMotion`'s `obj.death`
instead. The sweep is therefore where the release has to land for now, and it
calls `ReleaseAttackSlot` rather than reimplementing half of it. **Porting
state 6 properly is still open** and would put the release where the engine
keeps it.

The regression test drives it end to end and was checked against the old code
first: it fails `latch 1 permits [-1]`, which is the whole bug in one line.

## Three from one sitting: the pose, the gate's postcondition, and the last life

**Every civilian in the game stood in its spawn pose.** `CharacterLayer` built
the actor with `ActorSpawn` — which runs the class `Init` — and *then* assigned
the placement's own `motion`, `hp`, `yaw` and `pos` on top. `CivilianInit`
(`FUN_0048A3E0`) runs the civilian's script as its last act, and the hostage at
`0x4AE4` opens hers with `SetMotion 371`; the placement's motion is 660, which
is exactly what `CivilianInit` writes as its default, so the assignment put the
default straight back. She played 660 for ever while her script ran on
underneath. The engine has no such window: `SpawnFromDescriptor`
(`FUN_00408A20`) fills the object from the record and *then* calls `Init`, so
everything now goes in through the descriptor and the order is the engine's.
The regression test was checked against the old ordering first. `[proved]`

**A seek stepped over `wait_scripted_actors` and kept its civilians.** The
enemy gates retire what they count during a replay — the wait is only reached
in play once the count is zero, so a replay that walks past it has to establish
that. `wait_scripted_actors` (0x46) never did, so a seek carried the previous
scene's hostages into the block it landed in, where they were spawned, counted
in `g_civilians_alive`, and held the *next* gate open. The reason it was
missed: which waits retire lived in **two** places, a `retiresEnemies` flag on
the rule and a hard-coded `{0x43, 0x44}` beside `stepOverWait`. It is one field
on the rule now, `retires: "enemies" | "civilians"`, read by both paths.

**Lives floor at one.** `[diverges]`, and named as a stand-in rather than a
rule: reaching zero is the continue sequence, which this port does not have.
In the engine `g_player_state` (0x009A5C62) leaves 5, `IsPlayerAttackable`
(`FUN_00409DC0`) makes every enemy stand down and `g_evt_gameplay_live`
(0x007DCCA4) freezes the script. With none of that modelled, a run that hit
zero left the player alive, attacked by nobody, and the scene running on.

**And a checker sharp edge worth knowing.** `verify_port.py` de-duplicates a
citation that matches both its reference and its definition pattern by pairing
`(name, address)` **across the whole file**. So writing an ordinary
cross-reference — `` `IsPlayerAttackable` (`FUN_00409DC0`) `` — inside the very
file that defines it cancels the definition, and coverage drops by one with no
failure printed. It cost a while to find because nothing is wrong with either
line on its own. The comment now names the function without re-citing its
address, which is the right cross-reference for something ten lines up anyway,
but the dedupe would be better done on position than on the pair.

## The twelve entrance states, and a global whose name was a whole wrong idea

`ZombieEntryState` was a list of exceptions with `AttackRun` as the fallback,
and the comment on it said the quiet part: *"Seventeen of the 54 are ported.
Every entrance state that **is** read ends by setting state 1, so an unported
entrance resolves to `AttackRun` rather than being left to abort."* That
reasoning is true of some of them and it was never the point. The entrance is
what puts the actor where the level wants it *before* the attack run starts —
which is the same lesson state 15 and state 33 each taught separately, and it
had not been generalised.

Twelve of the 37 unported states have shipped spawns: **127 placements**, with
17 and 18 alone accounting for 75. All twelve are in, plus their descriptor
tails, which the exporter had no decoding for at all.

**Three of them named clips the bundle was not baking, and that is the failure
worth writing down.** Every one of the twelve measures its exit on the play
clock of a clip the descriptor names. If that clip is not baked,
`MotionPlayLength` returns 0, the cursor never reaches the last frame, and the
actor stands there for the rest of the stage. States 13, 24 and 30 all did:
motions 984, 1010 and 927, named by the descriptor and baked for nobody. It
does not throw, it does not look wrong in a unit test written against a
hand-made fixture, and the state machine is *correct* — the data underneath it
is not there. `web/tools/entrances.mjs` is what caught it, by driving all 127
shipped spawns against the real bundle with the real camera and asserting that
every wait ends. Nothing smaller would have.

**`g_two_player_game` is a count of players, not a flag.** The name had been
sitting in the TSV and in the port, and it is wrong in a way that matters:
`FUN_004147E0` does `INC word [009C8E80]` once per player as it enters, gated
on that player's own slot bit 0x10 at `0x579DE8 + slot*8`, right beside a
*separate* `INC` of `g_max_attackers` on bit 0x20; `FUN_00413F42` does the
matching `DEC` when a player drops out. `TryClaimAttackSlot`'s
`g_max_attackers == 2` branch then reads `== 1` to mean *one of the two is
out* — which is incoherent as a boolean and obvious as a count.

It is now `g_players_in_play`, and the port sets it to **1**, because 1 is what
a single-player game runs at. The old default of 0 is the attract screen.
States 24 and 32 both gate their strike on it being non-zero, so shipping them
against the old value would have parked all nine of those spawns — a bug I
would have written into the port *because* of the name, having read the state
correctly.

Two more things fell out of the rename, both pre-existing:

* `ZombieThrownWeaponAimAtCamera` in the port read this global to decide the
  per-player side offset. **The exe does not read it there at all** — it reads
  `obj+0x1360`, which `ZombieThrowHandWeapon` sets from `g_max_attackers` one
  line before it calls the aim. Right answer by accident while the global was
  stuck at 0; wrong the moment it became 1.
* Class 0x10's wait bit 0x40000000 was named `TwoPlayers` and tested `>= 1`.
  The test is right — `CivilianStepScript` keeps waiting while
  `g_players_in_play < 1` — but it had been dead code, because the global was
  never set. It is `InPlay` now, and it fires.

**A stale Ghidra label, at the address this project has already been bitten
by.** `0x004E07D0` carried *both* `g_motion_play_length` (the TSV's name, and
the right one) and an older `g_anim_frame_counts` label, and the decompiler
preferred the older. So every state read this session showed its exit as
`g_anim_frame_counts[motion] - 1 <= obj+0x19C` — the exact shape of the maul-cue
bug, where an authored-frame reading made 30 of 51 cues unreachable. It happens
to be the same table, so nothing was misread this time; the stale label is
deleted, because next time it might not be.

**Wrong turns.** The harness reported 164/164 stuck on its first run and it was
neither the port nor the data: `GameUpdate` skips an actor the renderer has not
turned on, and the harness never set `visible`. Then it reported two stage-2
state-23 spawns stuck — those are **class 0x31** spawns, whose state 23 is
`ThrowerStateDelayedPounce`, nothing to do with the scripted grab; filtering on
the state without the class pulled in two throwers that were fighting perfectly
well. And the unit assertions failed five ways at first because their loop
called `EnemyZombieUpdate` without `ActorAdvanceMotion` — the same "the clock
belongs to the port" trap from the other end, since four of the twelve measure
their exits on a clock nothing was advancing.

## Kill cleared the room and left the hostages standing

Asked for: make the debug `Kill` button take the civilians too. It already
walked every visible actor, so the missing part was not the loop — it was that
`dead = true` is not how a civilian dies.

`CivilianCheckShot` reads `ActorFlag.Dead`, not `dead`, and runs the civilian's
**killed script** off it; that script is what carries `LeaveCountNow` and takes
her out of `g_civilians_alive` — 59 of the 60 streams the shipped scripts use
as a death script do. `ActorKillAll` raised only `dead`, so she stayed in the
count with `wait_scripted_actors` open and nothing on screen to shoot. It
raises the flag now, exactly as `ResolveHit` does on a killing blow, and
returns its tally split into enemies and civilians so the feed can say which.

**And that turned up the real one.** With the flag set she ran her killed
script and then stopped dead on its `motion-loops` wait. `ResolveHit` was
handing *every* class the shared directional death, and `ActorAdvanceMotion`
returns on `obj.death` before it touches the base clock — so the clip her
script was waiting to see loop could never advance. She never reached
`LeaveCountNow`, on the debug path or on a real shot.

The engine does not do this: `ResolveHit` (`FUN_00409430`) drops hit points and
nothing else, and the clip comes from the class's own machine —
`ZombieStateDeath6` (`FUN_00454D20`) sub 0 calls `ChooseDeathMotion` for class
0x30, `CivilianCheckShot` runs the killed script for class 0x10, `ThrowerOnShot`
picks its own chain for 0x31. The port already had that set written down:
`updatesWhenDead`, the classes whose death keeps running. They no longer get
the shared clip. The `ownReaction` test that used to guard it named class 0x31
alone, which is why only the civilians were wrong.

**A test that passed for the wrong reason.** My first version of the assertion
checked `g_civilians_alive === 0` after the clear, and it passed with the fix
reverted — the fixture's own removal cue drains the count. It asserts the
killed *script* is what runs now. Worth remembering that reverting the fix and
re-running is the only thing that tells you which of a test's checks are load
bearing; two of the four here were not until they were rewritten.

## The leap that fell through the floor, and a clip read as a landing

Reported at `?stage=3&mode=play&block=4&step=6&op=10&frame=255`: the delayed-leap
zombies "fall through the ground, then get up from a seated position". Two
separate bugs in `ZombieStateDelayedLeap`, and both were things the port had
simplified away rather than misread.

**The pose freeze.** Sub 3 holds `obj+0x34` bit 0x4000 for the whole flight and
drops it only for the last `0x15` frames. That is not cosmetic: freezing the
clock freezes root motion, and root motion is the *only* other thing that moves
a class-0x30 actor. The engine is saying the parabola owns the position and the
jump clip may not contribute. The port never froze, so 0x3BB's own translation
ran under the arc and the actor arrived well below its destination — through
the floor, exactly as reported. Stage 3's pair now land at -1.9 and -1.8
against a named -1.0.

**`0x3F7` is a corpse.** The port called it `LEAP_LAND_MOTION` and played it
`if (obj.hp >= 1)`. The engine plays it `if (hp < 1)`, mid-flight, when the
player has shot the zombie out of the air — it goes limp for the rest of the
drop. A live actor plays no landing clip at all. Inverted, it was the slump
played on someone alive and then stood out of: the "seated position".

The name is the lesson. `LEAP_LAND_MOTION` was a guess from where the call sat
— it appeared near the end of the state, so it was read as a landing — and the
guess then justified the inverted test, because a landing clip *would* be for a
live actor. Naming a thing from where it sits is the failure mode the evidence
convention exists to stop, and it survived here because the constant looked
like documentation.

**A third thing, correctly weird.** Three stage-1 spawns set `obj+0x34` bit
0x1000000 and take the wind-up clip 0x399, whose sub 2 coasts to play-frame
0x1A and accelerates to 0x23 *before* sub 3 starts the arc's own frame
countdown — and `obj+0x1330` is never decremented in sub 2. So those three fall
about 0x23 frames further than the parabola solves for, and do not land on
their point. That is the engine's arithmetic. `web/tools/leaps.mjs` had to
learn the difference before it could tell the real overshoot from that one;
the first two versions of the harness also blamed the state for the ground snap
that runs *after* the landing, and for spawns that simply start below their
destination. Three wrong measurements before the right one, on a bug that was
already fixed.

## The actor that lived its life over and over

Reported as "0x4EE0 znebi2 keeps emerging repeatedly". The state machine was
not the problem — driven on its own, `ZombieStateEmerge` runs once and hands to
`AttackRun` at about frame 80, every time. So the repeat had to be *above* the
state machine, and it was: the object was being **built again**.

`SpawnFromDescriptor` builds an object when the spawn opcode runs and calls the
class `Init` there and once. `CharacterLayer.syncSpawns` released any instance
failing `want.has(at) && !a.despawned` back to `pending` — including one that
had called `ActorDespawn` on *itself* — and since `Walker.spawns` still listed
it, remade it on the next frame. `Init` ran again, the state went back to the
descriptor's entry state, and the entrance played again. A civilian on its
removal cue was rebuilt 1784 times in 90 seconds.

**Every harness in the tree missed it, and for one reason.** They all build the
actor by hand and drive `GameUpdate`. That is the state machine; it is not the
object lifetime, which in the player is `Walker.spawns` plus `syncSpawns`.
`web/tools/lifetime.mjs` closes that: the real walker, `syncSpawns`
transcribed, no renderer, and two invariants — each spawn's `Init` runs once,
and each entrance state is entered once. It found the rebuild immediately, and
115 block starts across the six stages are clean after the fix.

The wrong turn worth recording: the first suspicion was `retireGated`, then the
enemy counters, then `g_enemies_alive` being derived rather than incremented —
three plausible mechanisms reasoned about at length, none of them it. The
harness took twenty minutes to write and answered it in one run. Guessing at a
lifetime bug from the state machine's source is not a shortcut.

And a note on `SyncDerivedActorCounts`: `g_enemies_alive` and
`g_enemies_present` are **recomputed from the actor list every frame**, so
`ZombieStateWaitScriptFlagThenEnter`'s transcribed `++` on both is overwritten
immediately. The state's real effect — those four spawns are not counted until
their script flag comes up — is unmodelled, because the port derives the count
from `visible` and they are visible the whole time. `[open]`, and narrower than
it looks: four spawns, all in stage 2.

## Two zombies circled a hostage, and the cursor was half a pointer

Stage 3's `0x5294 hito_mario2` sat on `children-alive` for ever while her two
`znkage` captors walked in circles. Both were parked in state 35 sub 2 replaying
the same clip, loop counter cycling and never reaching the maul.

**`obj+0x1398` is a pointer, and a pointer says *which list* as well as how far
in.** The port had only the index and re-derived the blob from `obj.state` on
every read, through `ZombieScriptForState` (`FUN_0045CA10`). The engine calls
that function **only where it writes the pointer**:

```
ZombieScriptEnded          0x23/0x24 arm -> 0x1398 = blob            (start)
ZombieStateWalkToTarget    subs 0 and 1  -> 0x1398 = blob + 10       (past the head)
ZombieStateTargetMotionScript sub 0      -> 0x1398 = blob + 4        (past entry 0)
```

and every step in between reads it back. `ZombieStateTargetMotionScript` sub 1
is explicit about it — `psVar6 = *(short **)(param_1 + 0x1398)` — and never
re-selects. `[proved]`

The two answers are not the same, which is the whole bug. These captors have
initial state 0x23 and attack state 0x22, so the **walk** — which is the attack
state — leaves the cursor in the attack blob and then enters state 0x23, which
is *not* their attack state. Re-deriving there hands back the target blob, so
the captor replayed the approach clip it had already finished, ran off its end,
bounced back into the walk, arrived again, and went round. The maul entry —
motion 969 with mode 40, the frame the kill lands on — was never reached, so
the hostage never died and her script never left the gate.

`Actor` carries `scriptBlob` beside `scriptPc` now: the other half of the
pointer, written wherever the engine writes `0x1398` and read wherever it reads
it. The traced arc afterwards is the documented one, end to end — target script,
walk, maul, `AttackRun` — *deal with the civilian, then come for the camera*.

**What made it findable** was putting the captor's cursor in the sidebar: which
blob, which entry, the loop count, the cue frame and the play cursor against
its length. Before that a stuck captor and a looping one were the same row.
Two of the three sampled snapshots I took earlier were actively misleading —
the loop counter read 1, then 2, then 1, which looks like a stuck decrement and
is really a list being restarted. A per-transition trace is what settled it,
and it took four samples to notice that Shoot being off let the script run away
and drop the spawns underneath the scene I was watching.

## The enemy counters were derived, and derivation cannot express a corpse

Asked why the port derives the actor counts at all, which is the right
question: it should not. `SyncDerivedActorCounts` recounted
`g_object_list.filter(visible && isEnemy)` at the top of every `GameUpdate`,
and the engine keeps two real counters that each `Init` raises and each
teardown lowers.

The writers, read out of the binary: `EnemyZombieInit` (`FUN_00452DA0`) and
`EnemyThrowerInit` increment both; `ReleaseEnemyAliveCount` (`FUN_00456560`)
and `ReleaseEnemyPresentCount` (`FUN_00456580`) decrement, each latched on
`obj+0x38` bits 1 and 2; class 0x31 does the same through
`ThrowerRetireFromAliveCount` / `ThrowerRetireFromPresentCount` latched on
`obj+0x136C` bits 0x800000 and 0x1000000 — the same two facts in a different
word, which is this binary's habit. `ResetSceneOnEnter` (`FUN_0045EDD0`) is
the only non-incremental write: it zeroes both on entering a scene.

Two things the derived version could not express, and both are load-bearing:

**A zombie can be alive and uncounted.** `EnemyZombieInit` skips the increment
when the initial state is 0x1F. That is `ZombieStateWaitScriptFlagThenEnter`,
ported earlier this session, and the increment I transcribed into it was dead
code precisely *because* the count was derived — I noted that at the time and
did not draw the obvious conclusion, which was that the derivation was the bug.

**A corpse is present but not alive.** The alive count falls at death and the
present count when the death clip ends, and that gap is the only reason the
game has two counters at all. The port has no class-0x30 death state, so the
gap is zero-length; it is declared, and closing it means porting
`ZombieStateDeath6`.

**The wrong turn, and the harness that caught it.** My first mapping released
`present` on `!obj.visible` as well as on death. The engine never ties either
count to whether the actor is drawn, and because the release is latched, doing
so is permanent: an actor invisible for a single frame before the renderer
turns it on leaves both counts and never returns. `tools/civilians.mjs` caught
it — two rescues short — and I then spent three wrong hypotheses on *why*
before printing the counts, which answered it immediately. Same mistake as the
emerge bug earlier today: reasoning about a count instead of printing it.

The civilians harness's `moved` and `rescued` baselines moved from 40/23 to
37/21, and that is a real behaviour change rather than a check being loosened.
A civilian script advances *while* enemies are present, the harness kills every
captor by fiat at the halfway mark, and the derived `present` had no dead test
at all — so those corpses stayed counted for ever and the scripts kept
stepping. Neither the old number nor the new one is the engine's: the engine
would keep them counted for one death clip. The reason is written into the
harness beside the constants.

## A tool that plays a stage, and the two places stage 2 stops

`web/tools/playthrough.mjs` drives the player from a stage's entry block to an
end block and says where it hangs. It reads the walker's address out of the
HUD, and **an address that has not moved is the whole signal**: this is an
arcade game, no authored sequence in it is fifteen seconds long, so fifteen
seconds on one instruction is a hang and the tool prints the instruction, the
wait, and whatever is holding it.

It starts at the entry block and never deep-links to an address, because a seek
is its own rebuild path with its own bugs and a run that began mid-stage would
be testing that instead of the stage.

Shooting has to be **on** or the run is worthless: with it off
`WalkerHost.aliveEnemies` answers null, every live-enemy gate passes untested,
and the walker drops the spawns out from under the fight. So the tool fires
volleys through the real path — pointer events on `#viewport`, `Shooting.fire`,
the ray, the per-bone spheres, `ResolveHit`. A volley is a grid across the
frame because the projection carries no screen positions and inventing a seam
to publish them would be a seam only this tool used.

**It never shoots at a civilian gate and never clears one.** You are not meant
to shoot civilians in this game — they are mauled or you move past them — so a
`wait_scripted_actors` that does not come down on its own is a bug by
definition, and a tool that killed its way through it would hide the thing it
exists to find. That rule came from the user and it immediately paid: my first
version cleared civilian gates with the debug button and manufactured a hang
that no player could reach.

The bootstrap — vite on a free port, Chrome on the real GPU, the console and
404 listeners — moved to `tools/lib/player.mjs`, shared with `shot.mjs`.
Copying it would have been the third time this repository grew two harnesses
that drifted.

### What it found

**Block 3, `wait_enemies_alive`.** The two van zombies are alive at 23 and 25
units and twenty shots a volley never touch them: the camera is parked at
`cp_st2[4]` frame 205/205 staring at a flat wall, so they are not in frame at
all. A player could not clear this room either. `[open]`

**Block 30, `wait_scripted_actors`.** `0x138BC hito_oyajiaa` holds
`g_civilians_alive` at 1, parked on the `in-front` wait bit, 200 units away.
Her script sets a heading (op 7) and then waits to be in front of it; the
script cannot advance until she is done and she cannot finish until something
moves. `CivilianInFront` tests the *target point* against her facing, and
whether that is what `FUN_0048B1E0` does is not yet read. `[open]`

### And a fix the tool forced

`ActorKillAll` was killing civilians a shot could never touch. `CivilianCheckShot`'s
first branch is `if (sub.onShotScript < 0) { clear the hit bits; return; }` —
that is how the ones behind glass work — so such a civilian has no killed
script, and killing it left it dead, still counted, and unable to run the
`LeaveCountNow` that would take it out of the count. `ClassHandler.invulnerable`
is that question asked of the class, and the debug clear now asks it.

## Block 30's deadlock: one label, reached from three places

The playthrough stopped at stage 2 block 30 on `wait_scripted_actors`, held by
`0x138BC hito_oyajiaa` on the `in-front` wait bit, two hundred units out.

`CivilianStepScript` (`FUN_0048B1E0`) is one loop with a shared tail.
`LAB_0048B52E` holds the in-front test (bit 0x40), then the camera cue (0x80)
and the in-play gate (0x40000000), then the timer at `sub+0x14` — and all three
arrival arms fall into it:

* a word with neither `Reach` (0x10) nor `Face` (0x20) jumps straight there;
* the `Face` arm goes there when the heading error is not yet zero;
* the `Reach` arm goes there while the actor is outside `sub+0x3C`.

The port had that tail written out **twice**, once per arm, with the in-front
test in only one copy. So a word carrying `InFront` alone — hers is
`0x00100040` — ran no test at all and could be released by nothing but a timer
it did not have. The other copy dropped the cue and the timer instead, so an
actor that had not arrived skipped both of those. One label, two half-copies,
two different holes. `[proved]`

Two smaller things fell out of reading it. The in-front test reads
`sub+0x30..0x38` **raw** — the engine computes the mode-resolved point into
locals for the reach and turn tests and then transforms the raw fields here
regardless, which differs whenever `targetMode` is negative. And it builds the
full inverse orientation (`-ry`, `-rz`, `-rx`); the port rotates by yaw alone,
now declared, exact for anything standing upright and none of these is not.

### Still open

She advances past the in-front wait now and parks on the **`Face`** one at
cursor 7, and that is a different question. The numbers, which the sidebar now
prints: target `(-712,-824)`, heading error **-27341** BAMS, turn rate **10**.
Ten BAMS a frame against 27341 is 2734 frames — forty-five seconds to come
round, which no arcade game asks of you. The turn itself is faithful
(`ActorTurnTowardPoint`, one capped step a frame) and 10 is `CivilianInit`'s
own default at `sub+0x0E`, so the suspect is her facing rather than the rate:
she is walking *away* while she turns, her clip 675 carrying -11.76 over 26
frames, and her distance to her own target grew from 123 to 422 while I
watched. Either her spawn yaw is wrong or something sets a rate the port has
not read. `[open]`

Also unread: wait bit **0x100000**, which four of her six wait words carry. It
is not in `Any` (0x40003FFF) and not in the blocked mask (0x14000000), so it
does not gate the loop — something else reads it. `[open]`

## Stage 2 reaches its end block, and the last thing in the way was one literal

`CivilianStepTurnToTarget` (`FUN_0048C850`) ends on

```
ActorTurnTowardPoint(g_cur_actor_xform, &local_24, 0x100);
```

**a literal cap, and it never reads `sub+0x0E`.** That field is what op 3
writes and what `CivilianInit` seeds with 10, and the port had been passing it
as the cap — so every civilian in the game turned at ten BAMS a frame instead
of two hundred and fifty-six, twenty-five times too slowly.

Stage 2's `0x138BC hito_oyajiaa` is command 4 of stream 95: a `Face` wait
behind `SetTargetHeading 35328`, which is 194 degrees. At the engine's cap that
is 138 frames; at ten it is 3533, or fifty-nine seconds, and she is walking on
her clip's root motion the whole time so the bearing keeps moving. Block 30's
`wait_scripted_actors` waited behind her, and the whole stage stopped there.

Her stream ends the way the gate expects: command 24 is a wait word carrying
`LeaveCountNow` (0x80000) and `RemoveOffCamera` (0x02000000), so once she walks
her three points she takes herself out of `g_civilians_alive`. Nothing was
supposed to shoot her, and nothing does.

`sub+0x0E` is now `[open]` rather than named: op 3 writes it, the turn does not
read it, and what does is unread. It is kept because the sidebar shows it.

**`tools/playthrough.mjs` now takes stage 2 to block 35, `(end → 0)`,** in 260
seconds and 159 instructions. Seven enemy gates still needed the debug clear —
the shots cannot reach those rooms, which is the camera problem and the next
thing worth pulling on.

### Read while there, not yet ported

* `CivilianUpdate` has a **second removal path**: wait bit 0x02000000 with the
  actor off screen, not in mode 2 and holding no children frees its hit slot,
  decrements `g_civilians_alive` and despawns it on the spot. The port declares
  the bit and acts on none of it. `[open]`
* The removal cue is `==` on both halves — `g_active_cam_path == sub+0x26 &&
  g_cam_path_frame == sub+0x28` — where the port's `CamPathCueReached` takes
  `>=` on the frame. More forgiving rather than less, so it is not blocking
  anything, but it is not what the engine does. `[open]`
* `DAT_009a2230`, which `CivilianUpdate` reads at the top of its removal tail,
  is the **cutscene-skip flag** — written by `EvtOpSetSkippableRegion2C`,
  `CheckCutsceneSkipRequest` and `FinishCutsceneSkip`. While it is up, every
  civilian without wait bit 0x20000000 is given a one-frame countdown and
  leaves. That is how skipping a cutscene clears the people in it. `[open]`
* Wait bit **0x00100000**, which four of her six words carry, is in neither
  `Any` (0x40003FFF) nor the blocked mask (0x14000000), so it does not gate the
  loop. Still unread. `[open]`

## ResetSceneOnEnter: named is not ported, and the three blocks it zeroes

Asked whether `ResetSceneOnEnter` (`FUN_0045EDD0`) was actually ported after I
cited it in the counter work. It was not: I had named it in Ghidra and the TSV
and referenced it in prose, but no TypeScript declared it, and `verify_port.py`
said nothing because I had only ever used the parenthesised cross-reference
form. **The em-dash form is the one that asserts a port exists**, and a
citation that never uses it is invisible to the check. Worth remembering: the
coverage number does not notice functions you talked about.

Reading the three `[open]` blocks first, as asked:

* `DAT_009C9100` and `DAT_009C89C0` are `u16`-per-scene tallies of civilians
  **seen** and **rescued**, raised by `CivilianInit` and by `CivilianRunScript`
  op 0x2C beside their run totals at 0x009A21BA and 0x009CA0EC. The rescue one
  is used with a stride-10 index, `scene * 10 + rescues`, into a per-rescue
  table.
* The per-player triple at 0x009A5C82/84/86 is the shot statistics. The middle
  word was the only unnamed one, and `EvtOpAwardAccuracyBonus2B` gives it away
  in one line: `g_accuracy_bonus_table[(hits * 100 / it) / 10]` is an accuracy
  percentage, so it is shots. It is **not** `g_nPlayerFired` (0x009A5C78),
  which is a per-frame trigger flag; two things that would both be called
  "shots fired" and are not the same. `[open]` remains on where it is
  incremented — no instruction reaches it through that address, so the write
  is on a computed base the disassembler does not resolve.
* `DAT_009C88C0` was already `g_hit_slots`, and reading `ActorClaimHitSlot` /
  `ActorFreeHitSlot` / `ActorDespawn` confirmed the shape: 14 dwords, index at
  `obj+0x3C`, `obj+0x38` bit 6 as the held flag. That bit is in the same word
  as the two enemy-count latches from the previous commit, which is the third
  distinct use of `obj+0x38` this session.

The port zeroes six of the engine's thirteen effects, and the doc comment
itemises all thirteen with a tick or a cross. That shape is the lesson from
`LEAP_LAND_MOTION`: the danger is not a partial transcription, it is a partial
transcription that does not say so.

`ResetGameGlobals` keeps its own name and its own job. It is not an exe
function — the engine has no "empty the pool" call because its pool is a fixed
array — and now it calls `ResetSceneOnEnter` for the half that is one, which
mirrors `ResetGameOnStart` -> scene load -> `ResetSceneOnEnter`.

One self-inflicted slip: the edit that moved the two per-player tallies out of
`ResetGameGlobals` used a replace-first-occurrence, and the first occurrence
was in the `ResetSceneOnEnter` I had just written two hundred lines above. It
stripped the new copy and left the old. `tsc` was clean either way; only
reading the file back caught it.

## A scene is not quite a stage, and the demo seeks

Asked where `LoadSceneAndReset` (`FUN_00460030`) is called from, and whether
`ResetSceneOnEnter` is a *stage* enter or a *scene* enter. It is a scene enter,
and a scene is the broader thing.

`g_scene_index` names a loadable unit. Scenes 0..5 are the six playable stages
— proved rather than assumed: `g_attract_demo_playlist` (0x00589828) is three
0x14-byte entries terminated by a scene of -1, and they name scene 0 block 4,
scene 1 block 28 and scene 3 block 5, which are stages 1, 2 and 4. Scene 6 is
the entry `ResetGameOnStart` picks for `g_GameMode` 2, and scenes 10 and 11 are
the two attract screens at `FUN_0041F9B0` and `FUN_0041FB00`, which call
`ResetSceneOnEnter` directly rather than through the scene load.

`LoadSceneAndReset` has three callers, all of them the same act:

* `ResetGameOnStart` — the first scene of a run.
* `AdvanceToNextScene` (`FUN_0045FFF0`) — the stage-to-stage transition. It
  first walks the two players and puts any whose `g_player_state` is 5 back to
  2, so nobody is "in play" across the load; `IsPlayerAttackable` therefore
  refuses and no enemy commits an attack while a scene changes.
* `RunAttractDemo` (`FUN_00426800`) — the demo playlist.

**The demo enters a stage scene at an arbitrary block.** That is structurally
the same thing the browser port does when it seeks, and it is the closest the
engine comes to having a seek at all — worth knowing, because the port's seek
had been treated as a pure invention.

For the port this changes nothing in behaviour and one thing in accuracy: one
bundle is one stage is one scene, `w.script.scene` carries the index, and the
stage load is the scene enter. The gap that remains is `ResetGameOnStart`: the
port has no *run*, so every stage load is a fresh start, and the run totals
that reset owns are not in `G` either. Nothing is silently wrong; the run/scene
split simply only half exists, and a continue sequence would need the rest.

## IsPlayerAttackable is a scene-state gate, and the attract playlist

Two asks: document the attract demo playlist, and finish `IsPlayerAttackable`.

The playlist is `g_attract_demo_playlist` (0x00589828), walked by
`RunAttractDemo` (`FUN_00426800`) with a cursor in `DAT_009A3400` and
terminated by a scene of -1. Three 0x14-byte entries ship: scene 0 block 4,
scene 1 block 28, scene 3 block 5 — stages 1, 2 and 4, each entered at a block
chosen for the shot rather than from the top. Written up in `formats/evt.md`
beside the scene table, which already had scenes 10 and 11 as `advevtbl` and
`adv2evtbl`.

`IsPlayerAttackable` (`FUN_00409DC0`) turned out to be three clauses, none of
which the port had:

    if (g_scene_state_major_entered != 2) return false;
    if (g_app_state == 5) return true;
    return g_player_state[player * 0x98] == 5;

The first is the good one and it is script-driven, which is what the question
was really about. Major 2 is the `cam/` path camera row of
`g_scene_state_table`, so **nothing may attack while the follow camera or a
scripted view-angle turn is driving**. The walker already tracked the pair
`EvtEnterSceneState` records — with a thorough annotation behind it — so this
was a global away. Measured first, which is the only reason it was safe to
ship: major 2 is almost all of gameplay and major 1 minor 3 is a 3-to-8-second
spell in the blocks sampled.

The second is the attract override, and it explains itself once the playlist is
understood: the demo has no real player, `g_player_state` is never 5, and
without the override nothing would attack the demo.

The third is not portable. Every writer of `g_player_state = 5` is in the
game's shell, reached through the per-player hook the scene-state table
installs at `_DAT_009A5CDC` — an indirect call, which is also why searching for
the write by address finds nothing. `AdvanceToNextScene` is the one plainly
readable writer and it goes the other way, 5 -> 2 for the duration of a scene
load. So "in play" stays answered by "has a life left", declared.

**The regression the harnesses caught.** Gating on the scene state broke
`tools/entrances.mjs` immediately: the harness spawns actors directly and never
set `g_scene_state_major_entered`, so it was testing a scripted cutscene in
which nothing may attack, and states 24 and 32 stopped striking. Same class of
fix as `g_players_in_play = 1` — the harness has to supply what the walker
supplies in the player. `lifetime.mjs` drives a real walker, so it pushes
`walker.sceneState.major` instead, which is the faithful thing.

Worth recording that `test:port` did **not** catch it: the unit fixtures never
assert that an enemy attacks, so a gate that refuses everyone passes them. The
harnesses are what have caught the last four of these.

## The claim gate goes in, and the fixtures were not a running scene

Audited `IsPlayerAttackable`: which clauses are ported, and whether its call
sites are. Two of three clauses (scene state, attract override) with the third
a declared stand-in — and of the eight engine functions that call it, the port
has modules for four. Three of those four already called it. The fourth was
`TryClaimAttackSlot`, left out on purpose with a comment explaining why.

**The reason had expired.** It said the port's stand-in tested `g_player_lives`
alone, so wiring the gate would stop every enemy attacking once a player ran
out. But `PlayerTakeDamage` floors lives at one, so that clause can never fail;
and the function now tests the scene state, which is precisely the clause that
belongs at a claim. A comment explaining an omission is only as good as the
last time somebody checked it still applied.

Wiring it broke **ten unit assertions and the throwers harness** immediately,
and that is the system working: the fixtures build a scene by hand and never
set `g_scene_state_major_entered`, so they were all testing a scripted cutscene
in which nothing may claim a permit. Fixed the way the harnesses were fixed —
the fixture supplies what the walker supplies in the player — with one named
constant, `SCENE_MAJOR_PLAYING`, and a line after each `SetGameTables`.

Worth noting against my own complaint from earlier today that `test:port` never
asserts an enemy attacks: it does, in about ten places. What it had not done
was fail, because nothing had yet made attacking depend on state the fixture
did not set. The gap was narrower than I said.

## `ActorRetireFromWorld` was a name I invented, and it was the wrong shape

Asked to decomp it. It is not in the exe and never was — I wrote a port-only
helper and gave it an exe-style name, which in this repository reads as a claim
that a `FUN_` address is behind it. That is my mistake and the name is gone.

What the binary actually says, which is the useful half:

**`ActorDespawn` (`FUN_00409CC0`) has 171 call sites and every one of them is
inside a class's own state machine.** There is no site anywhere that removes an
object because a script stopped listing it, because the engine has no spawn
list to stop listing it — an object exists from `SpawnFromDescriptor` until its
own logic despawns it. So the port's seam is a real divergence, not a missing
port, and it is declared as one now.

The nearest thing the engine has is a per-class **leave the field** routine,
and there are two, both the same shape:

```
ZombieReleaseAndDespawn   FUN_00455490   ReleaseEnemyAliveCount
ThrowerLeave              FUN_0044AD60   ReleaseEnemyPresentCount
                                          ReleaseAttackSlot
                                          g_enemy_slots[obj+0x120] = 0
                                          (thrower also clears obj+0x34 bit 0)
                                          ActorDespawn
```

Class 0x10 has no such function: `CivilianUpdate` (`FUN_0048A920`) does it
inline at the bottom — free the hit slot, free the draw record at `model+0x45C`,
`if ((sub+0x04 & 1) == 0) g_civilians_alive--`, despawn. It is
`CivilianLeaveField` in the port, with the two frees `[open]` because neither
`g_hit_slots` nor that record is modelled at all.

Both engine routines were **already ported** by the concurrent workstream while
I was reading, so the work was not to write them but to stop having written
something else: `ClassHandler.leave` points class 0x30 at
`ZombieReleaseAndDespawn`, 0x31 at `ThrowerLeave`, 0x10 at
`CivilianLeaveField`, and `RetireUnlistedActor` in `director.ts` calls whichever
there is. A class with no entry gets a bare `ActorDespawn`, which is what the
engine gives it too.

One thing the reading ruled out rather than found. Both leave routines clear
`g_enemy_slots[obj+0x120]`, and `g_camera_free` is derived from that array —
which the room-clear gates test — so a stale entry looked like a good candidate
for the camera-gate hangs. It is not: the port rebuilds `g_enemy_slots` from
the pool every frame in `UpdateCameraEnemySlots`, so a despawned actor drops
out on its own. Different mechanism, same result, and the entry that would have
been stale cannot be.

I also put `RetireUnlistedActor` in `despawn.ts` first, which reintroduced the
exact import cycle that file exists to avoid — its own doc comment says so.
It lives in `director.ts` now, beside `ActorSpawn`, which is where the port's
unspawn belongs anyway.

---

## Session — the same stage four different ways, and it was never the gameplay

`docs/PLAYER_HANGS.md` item 8: stage 1 gave four different outcomes over five
runs on identical code and an identical route. Until that was gone no other
item on the list could be investigated honestly, because a fix and a coin
landing your way look the same.

**It was the clock, and the input timing, exactly as the item guessed.** Two
clocks: `Loop.advance` drains a 60 Hz accumulator and steps the *walker* once
per whole frame, while `Player.gameTick` returns `{ dt: wall * speed,
frames: dt * 60 }` off the rAF timestamp and hands *that* to `world.update` —
which is the whole of `game/`. So every motion clock, timer and state advance
in the port moved by a browser-dependent amount and `g_frame` was a float. On
top of it `playthrough.mjs` polled every 250 ms and started shooting after N
*milliseconds*, so the shots landed on a different game frame every run.

The fix is `?drive=1` and `web/src/app/harness.ts` — a drive seam `shot.mjs`'s
own docstring had nominated before it existed. Under the flag rAF keeps running
and the renderer keeps drawing, but game time advances only when a driver asks
and only in whole frames, walker and port together. It is inert without the
flag and does nothing a `UiCommand` cannot.

### What was watched failing

The rule here is that a test you have not seen fail is not evidence, so the
driven clock was temporarily replaced in `Player.frame` by the old pair — the
walker on the accumulator, the port on `gameTick(wall)` once per rAF — and
`tools/determinism.mjs` run against it. It exits **1 at trace index 0**:
`g_frame` 19 in one run and 18 in the other, with the RNG state already apart.
Put back, 2000 frames identical, and five full playthroughs of each of stages 1
and 2 byte-identical apart from the wall-clock column.

The "before" was captured rather than quoted, by running the pre-change
`playthrough.mjs` out of git against the same source tree — it never passes
`drive=1`, so every driven branch is inert and the behaviour is exactly as it
was.

### What was got wrong on the way

* **Three doc files were edited in the shared checkout instead of the
  worktree.** `cd /Users/llm-sandbox/hotd2-decomp && python3 …` is the whole
  mistake, and it is an easy one to make because every *other* command in the
  session was relative. Every edit happened to be an additive replacement
  against a unique anchor, so reversing new → old restored all three byte for
  byte — and `PLAYER_PROGRESS.md` had a peer's uncommitted hinge work in it at
  the time, which survived intact. Verified by diffing each restored file
  against its blob at `961ae67`. **Check the path before writing outside
  `web/`.**
* **`DriveTarget.stepOneFrame` was dead for the first two commits.** The pump
  was open-coded in `Player.frame` and the harness never called the target it
  had been handed, so the interface lied about what it needed. Moved into
  `Harness.pump` — take, step, trace, book, settle — which is also what made
  the seam drivable from `test:state` with no browser.
* **The first `advance` resolved too early.** It settled inside the rAF, and a
  driver that read the HUD the instant the promise came back was racing React's
  commit of that frame's projection. It settles from a `setTimeout(0)` now,
  which is the cheapest thing that is after it.
* **The stage-2 route changed and it looked like the fix had done it.** It had
  not: `Walker.takeBranch` with no argument picks `Math.min(...targets)` and
  block 3 offers `4, 30`, so 4 is the only answer it can give — and the commit
  that made the pick the lowest block is an ancestor of the commit that
  recorded the route as going to 30. The two disagreed before this started.
  Filed as item 16 rather than assumed either way.

### Found on the way, and filed rather than carried

* **Item 12** — `game/effects/rain.ts` ticks the pool with `t.wall * 60` and
  draws from **`ctx.rng`, the world's generator**. Every particle that
  respawns burns three `next()` calls, so a cosmetic layer shifts the stream
  position for every gameplay draw — the attack picks, the death directions,
  `ResolveHit`'s one-in-four headshot burst. Deterministic under the driven
  clock and not under the wall.
* **Item 13** — the `Math.random` ban covers `core/ bundle/ script/ game/` and
  not `render/`. Both hits there were checked and are genuinely sound-only
  (`shooting.ts`'s `pickOne`) and cosmetic (`breakables.ts`'s rattle), so
  nothing is broken; the hole is.
* **Item 14** — with pillarbox off, `camera.aspect = w / h` and `Shooting.fire`
  unprojects through that camera, so the window's shape changes what a click
  hits. Pillarbox defaults on and pins it to 4/3, but the toggle is persisted.
* **Item 15** — `void p.loadStage()` is fire-and-forget with no in-flight
  guard; two stage switches can interleave their rebuild halves.
* `game/class30/strike.ts` picks its fallback attack with
  `Number(Object.keys(list)[0])`, which is a silent dependency on V8 ordering
  integer-like keys ascending. Deterministic in practice; noted, not filed.

### The decision that is the user's

`?drive=1` makes a **driven** run whole-frame. Interactive play still takes the
fractional tick. Making it whole as well is very likely more faithful — the
engine's frame is fixed and both camera drivers end on
`g_cam_path_frame = __ftol(...)`, an integer that steps by exactly one, which
is why an `== cue` is safe there and is not automatically safe here — but it
changes what a human at the keyboard sees and it is a `[diverges]`-shaped call
either way. Item 4 depends on the answer.

**Next actions**

1. Put the interactive-clock question to the user; item 4 is blocked on it.
2. Sweep stages 3–6 (item 11) — now worth doing, because a result is a result.
3. Item 1, the camera parked facing a wall, is the next real one: stage 2 still
   cheats past blocks 3, 9 and 28, the same three every run.

---

## Session — the doors that spun at the end of their swing

Report: "door/window props sometimes spin uncontrollably at the end of their
swing." *Sometimes* was the whole clue. Four of the game's 56 hinges do it,
and the four are two pairs in stage 1.

`HingeUpdate` (`FUN_00473CF0`) is the hinge behaviour class 0x44's selectors
1, 2 and 4 share. Its pose block had been transcribed — into
`render/props.ts`, which is its own finding — as

```c
obj.rx  = base_rx + side * curve[f].rx;
obj.yaw = curve[f].ry * swing_scale * (side < 1 ? -1 : +1);
```

The yaw half is right. The X half is not. The disassembly at `0x00473EE0`:

```
00473ee0  MOV   EAX, dword ptr [ESI + 0x1dc]     ; "side"
00473ee6  TEST  EAX, EAX
00473ee8  MOV   dword ptr [ESI + 0x6c], EDX      ; rz = base_rz + curve.rz
00473eeb  JLE   0x00473f13
00473ef1  MOV   EAX, dword ptr [ESI + 0x1cc]
00473ef7  ADD   EAX, ECX                         ; rx = base_rx + curve.rx
...
00473f17  MOV   EDX, dword ptr [ESI + 0x1cc]
00473f1d  SUB   EDX, ECX                         ; rx = base_rx - curve.rx
00473f2d  NEG   EAX                              ; yaw = -ftol(...)
```

`ADD` against `SUB`. `obj+0x1DC` is read for its **sign** and nothing else on
this path. Its magnitude is used once, elsewhere: `IMUL EAX,[ESI+0x1DC]` at
`0x00473FB5`, the amplitude of the damped yaw wobble a prop does when it is
**shot** — a field the port had named `side` because `PropBuildVanDoors`
(`FUN_00472C90`) writes the van's two doors as a literal −1 and +1, and 52 of
the 56 hinges are that pair of values. The other four carry ±512 and ±416,
which are 2.8° and 2.3° of shot-wobble. Multiplied into `rx` they are 103
turns.

Why "at the end of the swing": in curves 0 and 3 the yaw is 95 % done by frame
12, and `rx`/`rz` are the slam judder that starts there and rings down over
the remaining 47 frames. The door opens correctly and *then* whirls.

**The lesson is the one CLAUDE.md already has, in a new shape.** "Object
fields are polymorphic" is usually about one field meaning different things to
different classes. This is one field meaning two things to *one* routine — a
sign to the pose and a magnitude to the wobble — and the shipped data hiding
it by making 52 of 56 instances ±1. A name taken from what a field is *used
for in the case in front of you* is still a name taken from where it sits.

Three things read and settled while in there, none of which had been:

* the frame stop is `CMP EDI,0x3C; JL` (`CMP EDI,0x82; JGE` on curve 4), and
  past it the routine stops writing the angles rather than clamping — the prop
  holds the last frame it posed, which is what the port's clamp reproduces;
* `obj+0x2C0`, the `FMUL` on the yaw, is seeded `1.0f` by all three
  constructors and never written again, so it is an identity `[proved]`;
* `obj+0x1CC`/`obj+0x1D4` (`base_rx`, `base_rz`) are written by none of the
  three, so they are the pool's zero `[proved]`.

Two latent divergences in the exporter, fixed although they change no exported
byte today. `hinge_curve` picked the XYZ table over the yaw-only one by asking
whether the XYZ pointer was populated; the exe switches on `AX == 0 / 2 / 3`
at `0x00473E8D`. The two agree only because slots 1 and 4 of that table happen
to be null — the adjacent-array trap with the trap not yet sprung. And the
yaw-only table is loaded `XOR EDX,EDX; MOV DX, word ptr [EAX + EDI*2]`, zero
extended; the exporter read it `<h`. Nothing shipped reaches 0x8000, so it is
a no-op on the data and a real difference in what the code claims.

The pose is now `HingePose` in `web/src/render/hinge.ts` — pure BAMS integer
arithmetic, no three.js — so `test/port.test.ts` can drive it, and does. It
was made to fail against the old expression before being trusted.

`HingeUpdate` (`FUN_00473CF0`) living in `render/` at all is the finding under
the finding. It writes no `G`, so `verify_layers.py`'s
`no-engine-writes-in-render` — the rule the stage-1 car bug produced — passes
it. But the swing counter is state the snapshot cannot reach, which is why
`PropLayer.resync` already carries a `[diverges]` shutting every door on a
seek. The move to `game/class44/` is written up in `docs/PLAYER_PROGRESS.md`;
it is not a line edit, because hinges reach the player as `props.json` plus
named glTF nodes rather than as evt spawns through `DescriptorFromPlacement`.

---

## Session — one clock, and a loop that is allowed to sleep

Follows the determinism session above. That one made a *driven* run
reproducible and left the interactive clock as a question for the user. The
answer came back as a design rather than a yes/no: **decouple render frames
from ticks — the simulation advances 1/60 s at a time and never skips; render
as fast as you like; when the tab loses focus stop simulating; when the game is
paused stop asking for frames at all.**

That is what is now in `app/loop.ts`, and most of it was deletion. The
accumulator already existed and was already right — it was simply that only the
walker used it, and `world.update` was handed the raw rAF delta beside it. The
previous session's `stepOneFrame` turned out to be the missing half: the whole
of one tick, walker and port together. Wiring it into `Loop.advance` and
deleting `gameTick` collapsed the two clocks into one, and made `?drive=1`
**the same loop with the accumulator fed by a driver instead of by the wall**
rather than a second path that has to be kept equivalent to the first. The
guard the previous session needed — `if (!this.drive && this.walker)`, there to
stop the port getting a second helping of time — is gone with it.

**The silent skip was not where it looked.** The `MAX_CATCHUP_FRAMES` cap in
`advance` never dropped anything: it stopped the drain and left the remainder
in the accumulator, so the next frame ran it. The actual discard was
`Math.min(0.1, ...)` in `wallDelta` — a 500 ms stall lost 400 ms of game time
and nothing said so. Worth writing down because the cap *looks* like the
dangerous one and is the safe one.

**Stopping the loop is the part that can rot.** A loop that sleeps must be
woken by everything that changes the screen, and a missing waker does not
throw, does not fail `tsc` and does not fail a headless test — it leaves a
panel showing something that is no longer true. So `tools/pacing.mjs` drives
the real page *undriven*, counts the page's own `requestAnimationFrame` calls
by wrapping the browser API before the app boots, and asserts that playing runs
the loop, pausing stops it dead, and an input wakes it for exactly one frame
without advancing any game time. It was watched failing: with the sleep removed
it reports 60 frames in a second where it wants 0.

It also pins the tick in one number — **61 drawn, 61 simulated** — which is the
thing that was not true before.

### Two assertions I got wrong before the code was wrong

Both worth keeping, because both looked like bugs.

1. My first attempt at breaking the determinism check made `Tick.frames`
   fractional and **nothing happened**. The port integrates `dt`, not `frames`.
   Had I stopped there I would have recorded a false pass for a check that does
   bite: jittering `dt` by 1% diverges at trace index 106.
2. `pacing.mjs` first pressed `Digit1` to test the wake and failed on "it did
   not start the loop again" — 27 frames. That is correct behaviour. `Digit1`
   is Step mode, where the script stands still but the **port keeps running**,
   which is what makes a zombie loop its walk while you read the tree. The test
   now presses an unbound key, which asks the narrower question it meant to.

### The wrong turn

`git checkout -- src/app/main.ts`, to undo a deliberate one-line perturbation,
discarded the whole of that file's uncommitted work with it. This is the second
time in this project that exact command has done exactly that. The perturbation
was three lines and reverting it by hand would have cost nothing; the file was
two hours of work. Rebuilding it was cheap only because the edits had been
applied by a script that was still on disk — which is now the habit worth
keeping: **apply structural edits from a saved script, and commit before
perturbing anything.**

## Session — the camera flickering between two look-at points

Report: "the camera is rapidly trying to switch between two different look-at
points between frames — looking one place, then a slightly different place on
the next frame." Stage 1, before the first zombies appear.

Not a decomp bug. `CameraTrackEnemiesTick` and `CamAdvancePathFrame` are both
faithful; what was wrong was **when the player runs them**.

A camera frame in the port is two systems either side of the game phase, and
`render/camera.ts` has said so since it was written:

```
script:  CameraSeat  -- CamAdvancePathFrame writes the block from the rail
game:    GameSystem  -- CameraTrackEnemiesTick eases the block's aim
render:  CameraDraw  -- the block becomes the three.js camera
```

`Player.frame` draws once per rAF and ticks at a fixed 60 Hz, so on a display
faster than 60 most frames owe no tick and take the `tickStopped` path — which
runs the **whole** tick order on `Loop.idle`, because the impact sprites ride
wall time and have to keep moving while the clock is stopped. `GameSystem`
refuses a tick with no time in it. `CameraSeatSystem` did not. So on those
frames the block went back on the rail, the ease was skipped, and the un-eased
aim was drawn: one frame eased, the next on the rail, at the refresh rate.

It is invisible at 60 Hz — there are no idle frames there at all — which is
why it survived. Driving the real loop against the shipped stage 1 bundle:

| display | idle frames | flickering frames | camera travel |
|---|---|---|---|
| 60 Hz | 0 of 600 | 0 | 626 deg |
| 75 Hz | 240 of 1200 | 144 | 2220 deg |
| 120 Hz | 600 of 1200 | 785 | 5733 deg |
| 144 Hz | 701 of 1200 | 499 | 3676 deg |

Nine tenths of the camera's movement at 120 Hz was the flicker, and the worst
frame swung 10.8 degrees and came straight back.

**The reproduction is the finding.** The first probe showed nothing, because
it ran with an empty object pool: with no enemy registered
`SelectCameraLookAtTarget` writes the path's own target, `TurnLookAtToward`
re-emits it along the same ray, and the eased aim and the rail aim are the
same direction. The two halves are indistinguishable until the camera *wants*
to look somewhere the rail does not. Spawning one tracked enemy turned zero
flickering frames into 785 of 1200 on the next run. A reduction that cannot
tell the two cases apart is not a reduction.

The fix is one line in `CameraSeatSystem.update` — `if (t.frozen || t.dt <= 0)
return;`, the same test `GameSystem` makes one system later — and at 60 Hz the
camera travel is unchanged to the digit, which is what says it is a no-op
where every frame owes a tick. The draw stays ungated on purpose: placing the
camera from an unchanged block is idempotent and a resize needs it. The seek,
the stage load and the frame slider never went through the system anyway; they
seat through `Player.syncCameraToWalker`.

The rest of the render layer was checked for the same shape. `PropLayer`
advances its swing counter by `t.dt * 60` and `BackdropLayer` guards its
`angle += spin` on `t.frozen`, so both already answer no. The camera was the
only half-frame writer.

Worth naming as a rule, because `verify_layers.py` cannot see it:
`no-engine-writes-in-render` is zero, and this system writes `G` on every
frame — through `CamAdvancePathFrame`, which lives in `game/`, so it counts
against the `render-drives-the-port` ratchet instead and is one of its twelve.
A renderer that calls into the port inherits the port's rules about *when*,
and nothing was checking that. `test/camera.test.ts` now does, for this one.

---

## Session — the camera was not facing a wall, it was aimed at NaN

`docs/PLAYER_HANGS.md` item 1 had a picture attached — stage 2 block 3, the
viewport a flat olive wall, two zombies alive at 23 and 25 units that twenty
shots a volley never touched — and a reading to go with it: the shot had run
to the end of its path and retired, so the camera stopped where the rail ran
out. That reading was wrong, and the picture is what made it plausible.

The sidebar's camera group says it in four lines:

```
eye        -837.9, 6.8, -572.2      <- fine
look at    NaN, NaN, NaN
yaw        NaN° 0x0NAN
tracking   locked on an actor
```

`g_cam_path_target` was fine too. So the rail was never the problem: the aim
was, and a camera aimed at NaN draws whatever is in front of it.

**The chain.** `SkeletonEmitNode` records bone 1's world position into
`obj+0x100`; `SelectCameraLookAtTarget` (`FUN_00403050`) reads it;
`TurnLookAtToward` (`FUN_00403C00`) eases onto it. One `undefined` read from a
motion array at the bottom is a NaN in the camera at the top, four layers away,
with nothing in between to complain. Every guard in `turn.ts` is a guard
against a *degenerate* vector — zero length, coincident points — and none of
them is a guard against NaN, which sails through `< 1e-4` and `Math.min`
alike.

**The fault.** `Poser.pose` had a second entrance path posing `obj.intro` —
the spawn descriptor's `+0x04`/`+0x08`, which names the clip the entrance
*will* play. Descriptor data. Permanent. `ZombieStateMotionCue21` reads it
every time it runs, so nothing clears it and nothing can. The renderer drew the
van jump-out for the actor's whole life, and the frame was clamped at the
bottom only — `Math.max(0, Math.floor(t))` — so past the clip's 41 frames it
indexed off the end of `root` and posed `undefined`:

```
apply at=0x1e00 state=3.2 f=45 frames=41 intro=923/0 motion=1022
```

Two states after the entrance handed over, the game walking it on clip 1022
and the renderer still drawing 923, forty frames past the end.

**The exe.** There is no second channel. `ZombieStateMotionCue21`
(`FUN_004577F0`) sub 0 calls `ActorSetMotion` (`FUN_00411930`), which writes
the clip to `obj+0x1B4` and zeroes the cursor at `obj+0x19C`; sub 2 hands over
on `g_motion_play_length[obj+0x1B4] - 1 <= obj+0x19C`. The motion block holds
the loop and the reaction and nothing else. `class30/play_cue.ts` had all of
this right already — the renderer was simply not reading `obj.motion`. So the
fix is a deletion.

**The entrance still plays**, which is the thing to be careful about when
deleting a branch called `intro`: it is real, it is `zom.bin` 923, and the
zombies really do come out through the van's windscreen. It plays because the
*state machine* puts it in `obj.motion`, which is where the engine puts it.
`replay.mjs` shows the whole arc — `MotionCue/0` at 956, sub 0 sets 923, sub 1
holds the delay, sub 2 plays it out, `AttackRun` at t=1.3s, which is 41 frames
at 30 Hz.

**What it bought.** Stage 2 goes from three unclearable rooms to two, and block
3 — the one with the picture — now clears by shooting. Blocks 9 and 28 have
finite aims and are a different fault.

### Two things worth keeping

**A picture is evidence of a symptom, not of a cause.** "The camera is parked
facing a wall" was written from a screenshot and a transport bar reading
`(static pose)`, and it sent the item's "where to start" at
`CamStartPathPlayback` and `CameraRig.seat` — neither of which had anything to
do with it. The number that mattered was three rows down in a panel that was
collapsed by default.

**Read the whole chain before instrumenting the middle of it.** The first
perturbation I tried, to prove the NaN's origin, was in the camera. The NaN
was four layers upstream in a renderer array index. What found it was a
`Number.isFinite` check at the *write* rather than at the read.

## Session — why the wall-crawlers stopped attacking

Three reports about class 0x31 in stage 2, and they turned out to be four
separate defects: they stop attacking after their first pounce and sit in
`WaitForPermit` wanting a permit; shooting one sometimes lets the script run
on while it is still alive and attacking; and their bodies stand well inside
walls, as though only the origin were tested.

**1. One word, two classes, two bits — again.** `ThrowerReleaseAttackPermit`
(`FUN_0044CFB0`) and `ReleaseAttackSlot` (`FUN_00456520`) are the same eleven
instructions except for one constant:

```
ThrowerReleaseAttackPermit   TEST  obj+0x136C, 0x8000
ReleaseAttackSlot            TEST  obj+0x136C, 0x20000
```

and `FUN_0044CA40`, the thrower's claim, sets `0x8000`. The bit is the
off-screen-permit latch, and clearing it is the **only** thing that lowers
`g_attack_committed` — which `TryClaimAttackSlot` reads on its first line. The
port called the class-0x30 release at eight class-0x31 sites and poked
`g_attack_permits[]` by hand at two more, so the first thrower to claim while
off screen latched the whole scene shut. Every enemy in it, not just the
throwers. `get_xrefs_to 0x0044CFB0` lists the eight sites the exe calls it
from, which is how the port's list was checked rather than guessed.

This is the same shape as `obj+0x11C` being hit points for one class and a
sub-type for another, and as the two enemy-count latches living in `obj+0x38`
for class 0x30 and `obj+0x136C` for class 0x31. **The rule to carry forward:
when two classes share an offset, they do not share the routine that reads it,
and a shared helper with a default argument is a trap.** The default is what
made this compile.

**2. A `[diverges]` that had stopped being true.** `ThrowerPushOutOfWorld`
(`FUN_00449D40`) is the per-frame collision hook `EnemyThrowerInit` installs
at `obj+0x12F0`. It pushes the body sphere out of other actors, then out of
the world, then — in states 7 and 8 only — snaps to the surface. Only the snap
was ported, under a note saying the engine's penetration depth had not been
read. It had: `ColiTestSphereAgainstFullSet` writes `g_coli_hit_depth` and
`g_coli_hit_normal`, and `ZombiePushOutOfWorldAndActors` has pushed by both
since class 0x30 was ported. The note was true when it was written and nobody
re-read it afterwards. **A `[diverges]` is a claim with a date on it.**

Two supporting facts came out of `EnemyThrowerInit` at the same time, both of
which the port had wrong rather than missing: `param_1[0x4db] = uVar4 |
0x180000` seeds **both** collision bits on every spawn, where the port wrote
`flags2 = 0`; and `param_1[0x4a]` is the body radius, 5.0 for character type
0x16 and 4.0 for 0x17 through 0x19, which the port never set at all. And the
sphere is not class 0x30's: `ThrowerPlaceCollisionSphere` (`FUN_00449E80`)
lifts it 1.4 radii and *lowers* it by the same on the ceiling.

**3. `ThrowerReleaseSlotOnDeath` (`FUN_0044D050`) had no port.** Every class
0x31 fall opens with it; it drops `g_enemies_alive` the frame the actor is
knocked off its feet rather than when the body settles, and lets the camera
slot go — `obj+0x120`, which is a different slot from the permit at
`obj+0x121`. Its guard is worth recording: the last enemy *present* keeps the
camera while it dies, so the shot that clears a room is not cut away from.

**4. The Kill button, and a gate counting the renderer.** The user's second
report was the debug clear, not shooting. `ActorKillAll` sets `dead` and
`ActorFlag.Dead`; class 0x31's death chain is entered by `ThrowerOnShot`
reading `pendingHit`, which only `ResolveHit` was writing. So the button left
a thrower flagged dead and still pouncing.

That it *also* let the script run on was a second bug underneath:
`wait_enemies_alive` was reading `chars.aliveCount` —
`instances.filter(visible && !dead && isEnemy)` recounted in the **renderer**
every time the gate asked. `game/combat/counts.ts` already carries a long note
explaining that the derived count is a different quantity from
`g_enemies_alive` and why deriving it was wrong; the counter was fixed and the
one caller that mattered was never moved onto it. The comment beside it on the
civilian gate even says "this is the engine's own counter, not a restatement
of it", which reads as a contrast nobody followed up. It reads
`G.g_enemies_alive` now.

**What the reduction cost.** Nothing, this time: the symptoms were specific
enough to read straight out of the disassembly, and the eleven new assertions
in `test/port.test.ts` reproduce all four before fixing any. Six of them fail
against the old code, and one of the failures is the report verbatim — the
thrower pounces, `g_attack_committed` stays at 1, and it never claims again.

### ...and the follow-up: they were still in the wall

Porting `ThrowerPushOutOfWorld` was not enough, and the two things left are
both worth keeping.

**The order.** The push went in where the old surface-snap call had been —
*before* the state dispatch — and every class-0x31 state writes `obj.pos`
outright, so it was overwritten before anything drew it. `EnemyThrowerUpdate`
does not call the hook at all; nothing in the program calls `obj+0x12F0`
directly, and `search_instructions` for that offset finds only the two inits
that write it and one routine that copies it. So the ordering had to come from
somewhere else, and two things give it: `FUN_00405160` — which copies the
sphere `ThrowerPlaceCollisionSphere` writes into the per-frame collision list
— is reached from the *end* of `EnemyThrowerUpdate` through `FUN_00409B70`, so
the sphere must already be placed by then; and the hook's own last act is the
surface snap that holds a wall-crawler on its wall, which a state running
afterwards would undo every frame. Class 0x30's port already had it after the
state, which is the third witness.

**The sphere test rejected the case that matters.** `ColiSphereVsMesh`
(`FUN_004AAF60`) compares `distance²` against `radius²` — `local_38 = fVar6² /
|n|²` — and never tests the sign of `fVar6`. The sign is read later, by the
caller:

```c
if (0.0 <= g_coli_hit_depth) g_coli_hit_depth = radius - sqrt(dist_sq);
else                         g_coli_hit_depth = sqrt(dist_sq) + radius;
```

so a body whose centre has got past a wall is pushed `radius + distance` and
lands exactly tangent on the outside. The port had `if (d < 0 || d >= r)
continue` — no push at all for a body far enough in, which is the report.
Selection changed with it: the engine keeps the **nearest** candidate, not the
deepest, and those agree only while every hit is in front, because behind the
surface a larger distance is a larger depth.

**One near miss worth writing down.** The store at the end of
`ColiSphereVsMesh` reads `g_coli_hit_normal_x = fVar1`, and `fVar1` is
`param_1 - local_44` — centre minus closest point. Read on its own that says
the normal flips with the side, and the first cut of this fix implemented
exactly that. It is wrong: `fVar1`, `param_5` and `local_48` are only assigned
the difference on the **edge and vertex** branches. On the face branch they
still hold `nx`, `ny`, `nz` as loaded at the top of the quad loop, so the
normal is the quad's own and unsigned. With the signed version a body behind a
wall is driven *deeper*. **A store several branches below where its inputs are
set is not read by looking at the store.**

`tools/body_push.mjs` is the measurement, and it is what turned this from an
argument into a fact: place each class-0x31 spawn's body sphere the way
`FUN_00449E80` does, test it, push once, test again. **Twelve of the game's 51
spawns start with the body inside the world**, four of them with the centre
behind the surface; the two the report named — `0x1F50` and `0x1F88`, stage 2
block 3 step 4, the same two addresses in the first message — are 2.67 units
in. All twelve are clear after one frame.

### ...and the second follow-up: on the wall it was a third routine

Still in the wall, and this time the word that mattered was **"on the wall"**.

`ThrowerSnapToSurface` (`FUN_0044C600`) calls `ThrowerFindSurfaceUnderfoot`
(`FUN_0044C640`). The port called `TraceActorSurfaceContactPoint`
(`FUN_0044C370`) — which is a real function, faithfully ported, with real
callers of its own, and simply not this one. They look alike: both quantise
the yaw to a cardinal, both build the same pitched probe, both branch the same
three ways on the stance bits. The differences are all in the tail:

```c
/* ThrowerFindSurfaceUnderfoot, the wall arm */
MatrixTranslate(hit.x, obj->y, hit.z);
MatrixRotateX(rx);
MatrixRotateY(ry + 0x8000);
point = (0, 0, 6.5);          /* <- the actor stands 6.5 units OFF the wall */
```

`TraceActorSurfaceContactPoint` returns the hit point itself. So the port
planted a clinging thrower's origin **in the wall plane**, and because
`ThrowerPlaceCollisionSphere` leaves y alone for a wall stance, the body
sphere is centred there too: half the actor inside the geometry, for as long
as it clings. The push-out cannot help, because the snap runs *after* the push
inside the same hook and puts it straight back. Against the old code the
assertion reads `0.000 off the wall` and the sphere is `depth 4` — the whole
radius.

Two smaller differences came with it: the underfoot probe reaches ten units
each side (fifteen on the ceiling) where the other reaches a thousand, and its
misses have answers — `(1000, y, 1000)` for a wall, `-1000` for a ceiling —
which are values chosen to fail the range test and route the actor to state 8
or state 11 rather than a bare `false`. And `TraceActorSurfaceContactPoint`'s
own overshoot is `0x40900000`, 4.5, where the port had 20.

**Three rounds on one symptom, and each round the reading was right and the
thing it was attached to was wrong.** The push was ported correctly and put in
the wrong place in the frame; the sphere test was corrected correctly for the
face case and the sign was read off the wrong branch; and the snap was a
faithful port of a function that was not the one being called. The lesson is
narrower than "read more carefully": **when a routine is reached through a
pointer or a wrapper, check which routine, not which shape.** Two functions
sixty bytes apart, with the same first forty lines, are exactly the pair a
name-based search will hand you the wrong one of.

### ...and a third: the bodies flew at the camera

Reported separately, once the walls were right: "when I kill them they seem to
be pulled towards me rather than away."

`ThrowerBeginKnockbackArc` (`FUN_0044D120`) takes the actor's **view-space**
tracked point, subtracts `t` from its z and transforms it back to world
through the view-to-world matrix. The port's note read that as "pulled `t`
units nearer" and approximated it with a lerp from the actor toward the eye,
under a `[diverges]` saying the camera's matrix could not be reached.

Both halves were wrong, and the second one settled the first. `GameHost` has
had `viewSpaceOf` and `viewPoint` — the view-space point and the inverse
transform — since `ThrowerPickLandingPoint` was ported; the seam existed the
whole time. And that same routine is what settles the sign: it unprojects its
landing point at a literal **`-15.5`**, so the engine's camera space has **−z
in front**, and `z - t` with `t >= 0` is *further in front* — away from the
viewer.

The approximation was wrong in shape as well as direction. Moving along the
camera's z keeps the body's screen x and y, so it recedes across the frame;
moving toward the eye converges on a point. And `k = min(1, t / d)` pinned the
destination **at the eye** whenever `t >= d`, which is inside about twelve
units alive and fifteen dead — and a thrower pounces to 15.5 units in front.
So every close kill put the corpse on the camera. That is the "pulled towards
me" exactly.

It was also two copies of one routine: `ThrowerBeginTumbleArc` had the formula
inlined again in `react.ts`, so it carried the same inversion. The exe has one
function with two callers.

**Same lesson as the wall, in the third variation:** the sign was not in the
routine being read, it was in a sibling the port had already transcribed
correctly and nobody cross-checked against. `-15.5` had been sitting in
`leap_down.ts` the entire time.

The first cut of this fix negated the depth back at the call site and left an
`[open]` saying `viewSpaceOf` refused an actor behind the camera where the
engine reads the field regardless. That was the wrong place to stop. The seam
was carrying a *judgement* neither of its readers had asked for:
`ActorIsOnScreen` (`FUN_00409C10`) divides by `obj+0x78` with no sign test and
compares against symmetric bounds, so an actor behind the camera projects to
the mirrored position and reads as on screen — a quirk, but the engine's, and
the routine only gates the off-screen latch. So the fix belongs in the seam:
`viewSpaceOf` is `obj+0x70/74/78` in the engine's own sign with no opinion
about it, false means only "there is no camera", and both readers now get what
the engine gets. **A seam that pre-digests a field for one caller is a seam
that will lie to the second one.**

## Session — working the review's open findings, and a throttle that was off

Continuing the transposition of GitHub issue #1 into
[`../REVIEW-2026-09-03.md`](../REVIEW-2026-09-03.md). The review had four
findings left open; this took the three the user named, F6, F14 and F15.

### F6 was filed as harmless and was the crowd throttle

The finding was a tidiness one: `RankEnemiesByDistance` ends with a sweep of
`G.g_object_list` writing `rank = -1, queueRank = 0` onto everything it had
not ranked, which puts class-0x30 offsets on every other class's struct.
"Harmless today because nothing else reads them."

`FUN_004090B0` says otherwise, and the reading is short enough to quote. Three
passes — write the raw rank and `0xE`, null the entries that are dead or
retreating, renumber the survivors — and **all three walk the registration
list**. There is no fourth pass. An actor that drops out of the set keeps its
last rank; one that never joins keeps what its spawn wrote.

Those two spawn values are not the same kind of default, and that is the whole
point:

| | value | what it does |
|---|---|---|
| `obj+0x131D` `rank` | `0xFF`, read as `-1` | passes every `rank < allowance` |
| `obj+0x131E` `queueRank` | `0xE` | fails `queueRank < 3` |

An unranked enemy may *walk in* and may not *swing*. Writing `queueRank = 0`
puts it at the front of the queue instead, so every enemy past the fourteenth
passed the cap the pass exists to enforce. The finding was right about the
line and wrong about the consequence, and reading the routine was the only
thing that could tell the two apart.

The same four lines carried a second divergence. `RegisterForDistanceRank`
(`FUN_00409010`) refuses its fifteenth caller *before* `SortEnemiesByDistance`
runs, so the queue is the first fourteen in object-update order and then
sorted. The port filtered the whole list, sorted it, and sliced fourteen off
the front — the nearest fourteen, which is a different set whenever more than
fourteen are alive. Capping before the sort is a one-line move and it had to
come with this fix rather than after it.

**One thing is left `[open]` on purpose.** Pass one also sets `DAT_009C7310`
when a registered actor of char type `0xB`, inside its own allowance, carries
`obj+0x136C & 0x2000000`. Its only reader is `0x004114C0`, a recursive walk of
a model's node tree that pushes and pops the matrix stack and, at one selected
node id, writes a transformed point onto the player object at `+0x100` and
`+0x10C` — so the flag picks *which bone* of the player a point is taken from.
That is as far as it was read. It is not named in `functions.tsv` and the
global is not named in `globals.tsv`, because what the captured point is for
has not been established and a name would assert that it had been. The port
records the omission in `combat/rank.ts` where a reader of that routine will
meet it.

### F16: the exporter's silence, and a tool that deleted what it was saving

Three parts, and the middle one turned out to be much worse than the review
said.

**Nineteen swallowed failures, not fifteen.** The shape of every one of them is
right — an install missing a `pol/` file should still export, and refusing a
stage because one prop model will not parse is worse than exporting without it.
What was wrong is that they said nothing, so a parser regression under
`hod2lib` produced a valid bundle with no characters, exit code 0, and an empty
stage in the player that looks exactly like a gameplay bug. They record through
`hod2lib/degraded.py` now; the count and the list reach `manifest.json`, and
`export_player.py` exits non-zero. There is no `--strict`, on purpose: a switch
nobody passes is the same finding one level up.

All six stages export with zero degradations, so the check went in at zero. It
was proved able to fire by making `load_asset` refuse every `char_*` asset —
stage 3 came back `degraded: 7` with the seven records naming each character,
and exit code 1.

**`ExportAnnotations.java` would have deleted 196 of 556 rows.** The review
said it re-sorts and drops body comments; both true, and not the half of it.
It built a fresh list from the database and overwrote the file, so every row
whose symbol is *still auto-named in the database* simply vanished. Measured
against the live database: 189 of those, plus 7 addresses it has no function
for. Globals were written as `address, name` with no third column at all, so
one run would have stripped the comment from **195 of the 282 global rows**.
`PLAN.md` says to run this after every session.

It merges now. The interesting design question was which side wins, and the
answer is not "the database": the database wins on **names**, because a rename
is the thing this script exists to capture, and the **file** wins on comments
the database has none of, because a Ghidra label carries no comment and the
file is the only place a global's prose exists.

**The tool had been reporting success for runs that never happened.** This is
how the above was found. `ghidra/run.sh` ran the headless analyzer under
`set -e` and grepped the log afterwards, so a run that died on the project lock
— every run made while the Ghidra GUI is open — printed *nothing*, exited 0,
and left a clean `git diff ghidra/annotations`. That is indistinguishable from
"there was nothing to export". It captures the exit code now and names the lock
case.

Which is also why the new Java was not executed: the project is locked by the
open GUI. It compiles against the real Ghidra API, and the merge algorithm was
run against the real files and the real symbol list — 2 rows updated, 20
appended, 196 kept, every `#` line intact. That is as far as it was taken, and
the first person to run it with the GUI closed should read the diff.

### ...and the citation that was wrong twice

`docs/formats/combat.md` called `FUN_004073B0` `SpawnImpactSprite`; the TSV
called it `SpriteEffectSlotRange`. **Both were wrong**, which is not what the
review's "docs↔TSV disagree" framing suggests and is the reason the fix was a
read rather than a copy.

The routine allocates the effect actor — `ActorAlloc(LAB_00407A70, 0x68)` —
positions it, takes its texture range `+0x60/+0x64` and base scale `+0x50` from
a switch on the kind byte, applies a distance scale law and calls
`PlayImpactSoundForMaterial`. So it is not a slot-range lookup; and impact is
one of fourteen kinds rather than what it is for — `0x53` is rain, and `0x5A`
recurses to spawn `0x5B` and `0x5C` beside itself.

Then the first rename attempt collided: `SpawnSpriteEffect` was **already** the
TSV's name for `FUN_00407340`, one address up, which is the wrapper 37 callers
use and which does nothing but marshal a position, a facing and a kind into the
12-float block and pass `-1.0` for "no scale override". `tools/annotate.py`
upserts by address and had nothing to say about a duplicate *name*; the
duplicate was caught by an `awk | sort | uniq -d` afterwards, which is luck
rather than process. `FUN_004073B0` is `SpawnSpriteEffectFromParams`: named for
the one thing that distinguishes it from its wrapper, which is what it takes.

`verify_port.py` holds the edge now, over `docs/` as well as `game/`. One
choice worth recording: an **arrow** between a name and an address is not
matched, because the docs use arrows for call chains — the prototype's first
finding was `ShotBuildSegment -> FUN_00405260`, which is a call and not a
claim about identity. `session-log.md` is exempt from the check entirely: it
records what was believed *when*, and a check demanding it be current would be
asking for exactly the rewrite `/decomp` forbids.

## 2026-09-03 — Phase 3 of the review, six items in parallel, and the one that hid

Steps 21, 23, 24, 25, 26 and 27 were run as six independent agents in six git
worktrees, merged one at a time with the whole check chain re-run between each.
The worktree isolation was the right call for a reason worth recording: three
of the six came up branched eighteen commits behind `main`, from a commit that
predated the review document itself, and were working without Phase 0 or Phase
1 under them. In a shared tree that would have surfaced as a typecheck failure
someone else caused; as separate branches it surfaced as a `git worktree list`
showing three different base commits, before any of them had written a line.
**Check the base, not the diff.**

The merges cost eight conflicts and every one was two agents being right about
their own half. The instructive one: step 27 moved the hand-rolled free-roam
tick into the new `beginFrame` pacing hook, and step 23 deleted it because
`FreeRoam` had become a `System`. Neither was wrong and the union of the two
patches was. Taking the hook and dropping the call left `beginFrame(wall)` with
an unused parameter, which is the honest residue: the hook exists now for a
reason that has gone away, and saying so in four lines is better than deleting
a `PacerHost` member someone will re-add.

### The thing that went in green and should not have

Step 25 added two refusals to the bundle loader — a `format` that must match
and a schema digest over `web/src/bundle/*.ts` that must match — and bumped
`BUNDLE_FORMAT` to 3. Both refusals are well argued and both were unreachable.
**Nothing in the check chain calls `loadManifest` or `loadStage`**: every suite
reads the bundle's JSON straight off disk. So the full chain ran green, ten for
ten, against an `extract/player` at format 2 that the client would refuse to
open. A bundle the player rejects was, to the checks, a passing bundle.

That is F7–F10 of this very review — *the checks measure proxies that have
drifted from the property* — reintroduced by the fix for F8, in the same pass
that closed it. It is worth being precise about why it was invisible: the
version constant finally caught something for the first time in the project's
life, and the reward for that was silence, because the only thing that could
have noticed was a code path no test exercises.

The fix follows `core/snapshot.ts`'s existing idiom rather than inventing one:
`snapshotRefusal` is already a pure `string | null` beside a loader that throws
on it, so `manifestRefusal` and `stageFormatRefusal` are now the same shape and
a bundle-free `test:bundle` drives them. Fifteen assertions, and neutering
`manifestRefusal` produces seven failures — the test was made to fail before it
was believed. One of the assertions is the live repo state: *the format-2 bundle
on disk is refused.*

**The general lesson, which is the third time this project has paid for it:** a
check added in the same commit as the thing it checks is asserted by its author
against the state that author just left. Ask separately whether anything can
*call* it. `ghidra/run.sh` printing nothing under `set -e`, three tests exiting
0 having asserted nothing, and now two refusals nothing invokes are one failure
mode wearing three hats.

### Left open

`S3` (step 22, the discriminated-union `Actor` tail) is deliberately not
started: it rewrites field access in every file steps 21 and 23 touch. Its
ground truth is measured — 116 field declarations, 24 exe offsets carrying more
than one TS name, `+0x1330` aliased five ways, 27 fields used by exactly one
class and 11 genuinely shared. `flags2` at `obj+0x136C` is the one that matters
most, because it is already class-polymorphic in the exe and a shared `number`
is actively lying about it.

Also open, and now marked as such in the review: `core/system.ts` still imports
`Walker`, so the framework names the one machine it hosts. No phase owns it.

## 2026-09-03 — the Kill button, and two bugs wearing one symptom

Reported as "the Kill button doesn't properly kill the zombies", with the
enemies row reading `1 attacking · 0 live · 1 scripted`, plus "the zombie death
animations are looping". Two separate defects; the second is most of the first.

### A one-shot clip cannot hold its last frame through a modulo

`authoredFrameOfTicks` ends in `f % frames`. That is right for a looping clip
and wrong for a one-shot, and **three call sites wrapped it in
`Math.min(frames - 1, ...)` believing the clamp would hold the last frame.**
It cannot: the wrap is inside, so past the clip's length the modulo restarts at
0 and the clamp is handed a small number every lap.

The death clip is where it showed, because it is the only one with no
terminator. `obj.action` has the same shape but ends itself, so it wrapped only
in the frames between its last authored frame and the state noticing — which is
why this survived so long.

The engine settles it: `ZombieStateDeath6` (`FUN_00454D20`) sub 2 waits for
`g_motion_play_length[obj+0x1B4] - 1 <= obj+0x19C` and then leaves. The clip
plays exactly once. `authoredFrameHeld` is the clamping conversion, next to the
wrapping one, for the reason `play_cursor.ts`'s own header already gives.

### "A routine that is not read" was read in ninety seconds

The port's comments said `ZombieEnterCorpseState` (`FUN_00456740`) hands the
body to something unread, so class 0x30 had no death chain at all: no
`updatesWhenDead`, no state 6, and `ZombieOnShot` (`FUN_00453EB0`) — which
`EnemyZombieUpdate` calls at `0x0045340E`, before the state dispatch — was
missing entirely, so **nothing in the port ever wrote state 6.** A killed
zombie sat in the pool at its last live state, dead and drawn, for ever.
`tools/killall.mjs` showed three of them still there 900 frames after the kill.

`FUN_00456740` decompiles cleanly and says exactly what a corpse is: clear
class 0x30's `CollideWorld`/`CollideActors`, clear `obj+0x34` bit 0 — the bit
`RankEnemiesByDistance` tests, so the corpse leaves the distance queue — raise
`PoseFrozen`, release the present count if not already latched, step the cursor
back one frame, and go to state 7 (or 8 for character types 0x12 and 3).

The lesson is not "read harder". It is that **"unread" was written down once
and then trusted as a fact for months**, in a project whose whole convention
exists to stop exactly that. `[open]` is a useful answer; `[open]` that nobody
re-tests becomes a wrong answer with a citation attached.

### Two things that looked like bugs and were not

* **`g_enemies_present` staying at 2 after a kill.** It drops fine — about 60
  frames later, because class 0x31 retires from inside its own four death
  states. Reading the counter one frame after the kill says nothing. Nearly
  reported as a leak.
* **The permit in `1 attacking`.** Not reproduced on any path the harness can
  reach. `IsPlayerAttackable` requires `g_scene_state_major_entered == 2`,
  which the walker sets in the real player and a stub host does not, so no
  enemy in the harness ever claims one. Still open.

### Open, and proved, and not acted on

`ReleaseAttackSlot` (`FUN_00456520`) **does not touch `obj+0x34`** — it frees
the permit slot and lifts the off-screen latch, nothing more. The port's
version raises `NoCameraTrack` unconditionally. The engine raises it in the
*caller*, `ZombieReleasePermitAndUntrack` (`FUN_004565A0`), and **guarded**:
`if (!(obj+0x34 & 0x800000) || g_enemies_alive != 1)`, so the last remaining
enemy of that kind keeps camera tracking. The port's version defeats that
guard for every class that releases a permit. Left alone because it changes
camera behaviour across two classes and that is the user's call.

Also open: class 0x30 state 9, `ZombieStateDeathKnockbackArc` (`FUN_004550E0`),
which `ZombieOnShot` picks for 44 shipped spawns with body condition 5 or 6.
The port routes them to state 6 instead, which gives the same clip pick, the
same teardown in the same order and the same corpse — they die where they stood
rather than where they were thrown. Declared `[diverges]` at the write site.

## 2026-09-03 — D1–D3, and two write-ups that were wrong about their own subject

Three fidelity decisions were put to the user as `D1`–`D3` and all three were
approved. All three landed. **Two of the three write-ups — mine — were wrong
about the thing they were describing**, and that is the part worth keeping.

### D1: the bit was never unportable, and nobody looked at the data

The entry said `obj+0x34 & 0x800000` "has no port — nothing the port models
reads or writes it", twice, in two `[diverges]` notes. The port has carried it
since the exporter started emitting `init_flags`: `descriptor.ts` puts the
spawn word straight onto `obj.flags`, and **six shipped spawns set the bit** —
three on stage 1, three on stage 3, all class 0x30, all initial state 18.

The claim was never checked against a single exported placement. It is the
same failure as `evt.py`'s "unused in every shipped file" comment about the
descriptor's `+0x20` word, which was also false whole-corpus, in the same
week. **A claim about what the shipped data contains is one grep from being
settled, and both times the claim was written instead.**

Two more corrections fell out. The port had split the flag from its
`g_enemy_slots` clear **twice**, not once — `ThrowerReleaseSlotOnDeath` already
had half a guard, on the slot but not the flag, which is the same fault
mirrored. And the two classes guard on **different counters**:
`g_enemies_alive` for class 0x30, `g_enemies_present` for 0x31. Reading class
0x31 rather than assuming symmetry also showed it has **no untracking wrapper
at all**, proved by scanning its whole range for `OR …, 0x10000`.

### D3: asserting a table from an address

The entry said the fix required exporting an `.rdata` table at `0x0044FD1C`.
`.rdata` starts at `0x004C4000`. The address is 475 KB below it, **inside
`ThrowerStateThrow`'s own function body**, and what is there is a
compiler-emitted dense switch: one xref in the whole program, from the `JMP`
a few instructions above, with the payload as `MOV` immediates in the arms.

Checking which section an address is in is **one tool call**. The write-up
asserted a table's existence, its section, and an entire exporter's worth of
work without making it. That is the adjacent-array trap arriving from the
other direction — not "where does this table end" but "is this a table at
all".

The agent stopped rather than substituting a different job, which was correct:
the stop condition in the brief is what caught it. The real fix was `game/`
constants beside a sibling literal table that had been one file away the whole
time, and `tools/hod2lib/class31.py` had **already classified those eight
motion ids as `.text` literals**, under a comment naming this very branch. The
project knew. The write-up did not ask it.

And the divergence was bigger than stated: a second type check diverts the
**clip** as well as the frame, so the port had been playing the wrong
animation for `zslman`, not merely throwing late.

### D2: the decompiler dropped both multiplies, again

`FUN_004550E0` overwrites **its own argument slot** with the scale, so Ghidra
renders the condition-dependent divisor as noise assigned to `float param_1`.
Both `FMUL`s were invisible — the `0.5` on the sway and the drop, and the
`3.0` — and `bcdf0123` turned out to be **−0.027222222**, the arc engine's own
half-gravity negated. Every constant had to be re-read from the disassembly,
which is the trap `CLAUDE.md` lists first and which still cost a pass.

One structural finding: state 9 fills the **shared** arc record through
`ActorArcBeginToAtSpeed` but rides it with its own stepper, and sub 2 then
abandons the arc entirely and integrates by hand, reusing `obj+0x1334` as a
fall counter. One word, two meanings, inside one state — the intra-class
aliasing S3 cannot fix, found in new code rather than old.

### What follows from all three

The reviews and write-ups in this repo are now good enough to be trusted, and
that is the hazard. Three separate documents asserted a fact about the binary
or the data that a single command would have refuted, and each survived
because the next reader treated a written claim as a finished one. `[open]`
that nobody re-tests becomes a wrong answer with a citation attached; so does
`[proved]` that was never proved.

## 2026-09-04 — the actor tail, all four arms, and what the union caught

`Actor` is a five-way discriminated union now: `ActorBase` plus `hum` (class
0x25, 13 words), `thr` (0x31, 14), `zom` (0x30, 15) and `prop` (0x24, **one**).
Four worktrees, merged one at a time; the last merge took eleven conflicts
across `game/actor.ts` and `test/port.test.ts`.

The item was proposed as a type-safety refactor. It paid for itself as a bug
hunt instead, which is worth recording because that is not what it was sold as.

### `holdFrames` was one field for two addresses

Class 0x24 counts its hold at `obj+0x1320`. Class 0x30 counts **every** hold at
`obj+0x1330` — `MOV dword ptr [ESI + 0x1330], EAX` (`899630130000`) at
`0x00458596` in `ZombieStateEmerge`, and again in `ZombieStateRunInPlaceTimed`
and `ActorArcBeginFalling` [proved]. One TypeScript name covered both, so two
assertions in `port.test.ts` had been reading the right name at the wrong
offset and passing. Nothing in the flat struct could have caught that: the two
classes never both ran in one test.

In the same pass, `slideTimer` — class 0x24's word — was being read off zombies
at six sites in `class30/death.ts`; and `throwHand`, tagged `[port-only]`, is
`obj+0x135C`, stored by `ZombieStateStandAndThrow` (`89865c130000`,
`0x00459270`) and read back by the next sub. A `[port-only]` tag is a claim
about the binary and decays like any other.

### Class 0x24's arm is one field, and that is the finding

The survey listed three. `holdFrames` has 43 uses in `class30/` against four
here; `slideTimer` has 22 in `class31/` against five. **A word only separates
when every class sharing it has an arm** — and taking a word from the class
that barely touches it would have made the union assert something false about
the engine. One field was the honest answer, and the arm's doc comment says so
at length rather than looking thin by accident.

### Two survey entries did not survive the read

`accX`/`accZ` are not class 0x30's: they are two thirds of one acceleration
triple whose middle word classes 0x10, 0x24 and 0x31 integrate, and
`ClearCurrentActorVelocityAndAccel` clears all three for any actor. And
`obj+0x1368`/`+0x136C` are zeroed by `ScriptedHumanoidInit` and read by nobody
— **an Init that zeroes a range is not evidence of ownership.**

### What four arms still do not protect, written down rather than implied

`h.slideTimer` compiles, and both 0x24 and 0x30 growing an arm did not change
it. The head aliases *itself* at `obj+0x1330`: `slideTimer` and `arcFrames` are
the same address, because the arc record belongs to no class and
`class31/arc.ts` drives it from a bare `Actor`. No `cls` discriminant separates
a word from itself. Intra-class aliasing is likewise untouched — `obj+0x1330`
is class 0x30's general-purpose per-state dword across 98 accesses.

The rule the four arms actually establish: **a word separates when every class
sharing it has an arm *and* no class-agnostic routine drives it.**

One blocker every arm hit independently and none worked around:
`DescriptorFromPlacement` returns a single `Partial<Actor>`, which *distributes*
over the union, so any descriptor-sourced field on an arm is an excess-property
error. Eight class-0x30 words are stuck in the head for that reason alone.
Splitting it is a job for all four arms at once, and it is `[open]`.

### The merge itself left two lies in the file that checks for lies

Closing the item, `port.test.ts` had two paragraphs explaining why
`h.backoffFrames` and `h.slideTimer` could not carry `@ts-expect-error`
directives. One sat directly above a line that now *has* one — TypeScript walks
a directive backwards past comment-only lines, so the build stayed green while
the prose beside it was false. The other still said class 0x24 "has no arm
yet". Both were merge residue from arms landing in sequence, and the checker
that catches an unused directive cannot catch a comment that describes the
wrong line. The real directive count is **30**; an earlier note in this session
said 33, which was a `grep` counting prose mentions of the string.
## 2026-09-04 — B4 and B8: the room-clear gate answered on its own frame

Two reports, and they turned out to be one mechanism seen twice. **B4**:
"camera doesn't seem to wait for zombies to die before advancing". **B8**: at
`?stage=1&mode=play&block=4&step=4&op=28`, "the two later (of three total)
zombies that drop from the high ledge don't seem to pause the camera... the
game advances while the two are dropping (maybe a race condition?)".

### What the exe does

`EvtOpWaitEnemiesPresent43` (`FUN_0045FBC0`) reads `g_enemies_present`
(`0x009C7006`); `EvtOpWaitEnemiesAlive44` (`FUN_0045FC10`) reads
`g_enemies_alive` (`0x009C904A`). [proved] Both then require
`g_evt_gameplay_live` and `g_camera_free`. Both — and `0x46`, and `0x41`,
`0x42`, `0x45` — open with

    if (g_evt_yield == 0) { g_evt_yield = 1; return; }

which ends `EvtInterpreterLoop`'s `do { … } while (g_evt_yield == 0)` for the
frame **before the condition is read at all**. `0x40` is the one wait without
it. `0x44` additionally requires `0 < g_evt_wait_alive_hysteresis`
(`0x007DCCA8`), incrementing it on every frame it does not pass and zeroing it
only when it does, so it costs a second frame. [proved]

Enemies are counted in at `Init`, not on entering a combat state:
`EnemyZombieInit` (`FUN_00452DA0`) does both `INC`s on its straight line,
declining only character type 9 and initial state 31, and `EnemyThrowerInit`
(`0x00449892`) has no guard at all. [proved] So the "the droppers are not
counted yet" hypothesis in the report is **wrong**, and ruling it out is what
turned the search towards the script.

The frame order also checks out: the evt VM is an `ActorAlloc`'d task created
at scene load, and `FUN_004A71A0` walks each parent's child list from `+0x28`
following `+0x1C` — creation order — so the VM runs before every enemy it
spawned. [proved] The port's `walker.tick()` → `syncCharacterSpawns` →
`GameUpdate()` matches.

### What the port did

Two faults, and the bug needed both.

1. **One `WaitRule` claimed `0x43` and `0x44` and answered both with
   `aliveEnemies()`.** The 54 present gates therefore opened at death rather
   than at the end of the death clip — the one distinction the game keeps two
   counters to make, collapsed.
2. **No yield.** `applyWait` read the counter on the frame the instruction ran
   and could return `passed` immediately. That mattered because the port builds
   the script's characters in `syncCharacterSpawns`, *between* ticks: for the
   whole of the tick that runs a spawn opcode, the counters are still zero.

Stage 1 block 4 step 5 is `spawn_obj` (two class-0x30 at y = 61),
`queue_event`, `wait_enemies_alive 0` with nothing in between. Traced with
`web/tools/enemy_gate.mjs` (new): frame 0 at `b4/s5/o0`, frame 1 already at
`b4/s6/o0` with the two zombies just created and falling from y = 61. Block 4
step 4's op 28 — the address in the report — and step 1's two gates have the
same shape.

With the yield transcribed, the same trace holds at `b4/s5/o4` for the whole
descent and releases two frames after the kill.

### What was got wrong, and what a doc said that was not true

* I read `g_evt_wait_alive_hysteresis`'s existing annotation as authoritative
  and it is not: it said "the `g_enemies_alive` condition must hold for two
  consecutive frames". The counter is never reset when the condition fails —
  only on a pass — so the handler requires *a previous refused evaluation*, not
  two good frames. The row is corrected, in the TSV and in the database.
* `script/waits/enemies.ts` and `script/walker.ts` both had the opcodes swapped
  in prose — "`wait_enemies_alive` (0x43) and `wait_enemies_present` (0x44)" —
  while `game/combat/counts.ts` had them the right way round. That is probably
  how one rule came to serve both.
* `PLAYER_PROGRESS.md` called `0x41` and `0x42` "exact". Neither models the
  yield, and `wait_frames` is `operand + 2` frames in the engine, not
  `operand`. Both rows now say so and carry a `[diverges]`.

### Left open

`0x41`, `0x42` and `0x45` still answer on their own frame. Fixing `0x42`
retimes every camera cue in six stages, so it is a change of its own rather
than a rider on this one. Nothing else in the VM is known to be missing the
yield.

## The body condition, and the two bug reports that were one missing call

Two reports, both about the axe throwers:

* **B9.** "znonoopa zombies get close to the player, then teleport back and
  start throwing. (`0x6784` znonoopa · Strike/2 · permit · d=99)."
* **B15.** "Throwing zombies don't seem to actually throw their axes, just play
  the animation."

The first thing found was that they are not two bugs, and that `0x6784` is not
the class the task assumed. Stage 2's spawn `0x6784` (26500) is **class 0x30**,
character type 0x14, `znonoopa`, `body_condition: 8` — not class 0x31. Both
reports are the same missing line in class 0x30.

### What the exe does

`ActorBodyConditionFromHands` (`FUN_00455920`) has **exactly one caller in the
whole binary**: `ZombieStateHoldAtRange` (`FUN_00455720`) runs it on its second
line, right after `TestApproachRing`. `get_xrefs_to 0x00455920` returns one row.

That single call site is the whole mechanism, because conditions 7 and 8 index
a different *kind* of row in `g_class30_attacks`. For character type 0x14:

```
attacks[8][0] = { strike 1005, lunge 783, distance 99.0, hit_frame 35, mask 2 }
attacks[1][0] = { strike  778, lunge 783, distance 19.0, hit_frame 46, mask 2 }
```

Ninety-nine units is a throw's reach, and `ZombieStateStandAndThrow`
(`FUN_00459080`) is the only state that reads it — `strike` is the throw clip
and `hit_frame` is the frame the weapon leaves the hand. So:

* a condition-8 walker keeps condition 8 all the way in, because
  `ZombieStateAttackRun` (`FUN_004554D0`) never recomputes — which is exactly
  the window `ZombieShouldStandAndThrow` (`FUN_00458E10`) reads, and why it
  throws on the approach;
* and it loses it on its first frame at the ring, so `ZombieStateStrike`
  (`FUN_00455A40`) can never read the throw row as a swing.

### What the port did

The port had no `ActorBodyConditionFromHands` at all. Driving stage 2's `0x6784`
headlessly reproduced the report exactly, and the trace names the mechanism:

```
f195 AttackRun/0    d=25.5           pos -824.4,-1064.6
f199 Strike/0       d=24.5
f200 Strike/2  atk=0 floor=99 motion=1005   pos -824.7,-1066.2
f202 JUMP 75.06 -> Strike/2  d=99.00        pos -817.5, -991.5
... d=99.00 for the next 3400 frames, 24 hits landed on the player
```

The condition stayed 8, so `ZombiePickAttack` drew the **throw** entry. Its
`distance` is 99, so the lunge test passed at once at twenty-four units and the
swing began. `ZombieStateStrike` then set `strikeFloor = distance - net`, and
`ApplyRootMotion`'s floor — which exists to stop a swing walking *inside* its
own reach — shoved the actor **out** to exactly ninety-nine units on the next
frame the clip carried any root translation. Seventy-five units in one frame.

So B9's teleport and B15's "plays the animation but never throws" are the same
event seen from two sides: the animation being played is the throw clip, and
`ZombieStateStrike` has no release in it — `ActorStrikeConnect` (`FUN_00456490`)
damages the player and nothing else. The two indirect calls in that state,
through `0x00592BCC` and `0x00592BD0`, were checked in case one was the
release: they are `FUN_00456C50` and `FUN_00456D10`, both water splashes for
body condition 6. Not the throw.

### The engine's own operand bug, kept

```
00455962  MOV EDI, dword ptr [EAX + 0x4dc]     ; bone 5, the right hand
00455968  CMP EDI, 0x1ece                      ; tutorial.bin  right held
00455970  CMP EDI, 0x1ef9                      ; znonoopa.bin  right held
00455990  CMP dword ptr [EAX + 0x68c], 0x1eca  ; tutorial.bin  LEFT held
0045599c  CMP EDI, 0x1ef5                      ; znonoopa.bin  left held -- EDI!
```

The last comparison still holds the **right** hand's slot; `[EAX+0x68C]` is
tested only against `tutorial.bin`'s value. A `znonoopa`'s right hand reads
`0x1EF9` armed or `0x1EF6` bare and neither is `0x1EF5`, so its left hand can
never count as armed. Every one of them lands on condition **1** with
`DamageZone.LeftArm` already set, which puts its attack pick in row 40..49 —
ten copies of attack 0, the right-arm swing. Transcribed rather than corrected:
it is what the shipped game does. `[proved]` from the disassembly, because the
decompiler renders it as a plain `obj+0x68C` test and hides it.

### The other half of B15: class 0x31's silent bail

Separately, and real: `SpawnThrownWeapon` (`FUN_004504E0`) in the port did

```ts
if (!host.boneWorld(obj.at, hand.bone, from)) return;
```

after `ThrowerStateThrow` had already advanced its sub-state to `Thrown`. The
engine has no such path — it reads the hand's own recorded translation at
`obj + 0x274 + bone*0x90` and transforms it by the camera matrix — so a host
that could not answer produced precisely the reported symptom: the clip plays,
the hand goes bare, the permit changes hands and no axe exists. Class 0x30's
`ZombieThrowHandWeapon` (`FUN_0045A240`) already had the fallback; class 0x31
did not. Now both do, tagged `[diverges]`.

### And what the projectile actually is, for the `[open]` about shooting it down

`SpawnThrownWeapon` allocates a **whole object**, not a pool record:
`FUN_004A6FA0(ThrownWeaponUpdate, 0x13F4)` links it into the same object list
every actor lives on, `ActorClaimHitSlot` (`FUN_00409270`) puts it in
`g_hit_slots` (`0x009C88C0`, fourteen slots), and it dispatches on its own
two-entry table `g_thrown_weapon_states` (`0x00592AE0`) — `ThrownWeaponFlyToTarget`
and `ThrownWeaponDeflected` (`FUN_00450050`), the latter entered the moment
`obj+0x34` bit `0x8` is set on it. It also inherits the thrower's attack permit
(`obj+0x121` copied across, the thrower's cleared) and only gives it back when
it lands or is deflected. So "you can shoot the axe out of the air" is not a
special case: it is the ordinary shot path finding an ordinary object, and the
port's pool-of-records shape is the reason it cannot. Unchanged, still `[open]`.

### What was got wrong on the way

* The task assigned both bugs to class 0x31 and named `class31/**` as the
  files. B9's actor is class 0x30 and the fix is in `class30/hold.ts`. Reading
  the placement out of the bundle before reading any code is what caught it —
  `0x6784` is `class: 48`.
* An early reading assumed the release must live inside `ZombieStateStrike`,
  since that is the state the actor was visibly stuck in. It does not; the
  state was the wrong one to be in at all.

## 2026-09-04 — the frame a camera shot ends on, and two zombies that never moved

Two bug reports, one root cause, and it was not in `game/` at all.

**B7.** Stage 1 `?block=2&step=2&op=15`: `0x2254`, a class-0x30 zombie in
`ZombieStateWaitCameraFrameThenBranch` (state 18), never comes through the
doors and stays in its entrance clip. **B11.** Stage 2 `0xFAF4`, the same state,
charges through the barrels for ever instead of playing the charge once and
turning on the player.

### What the placements say

`0x2254` waits on camera frame **179**. The instruction that spawns it is block
2 step 2 op 3, and op 4 — the very next camera instruction — is
`cam_play 115..179`. `0xFAF4` waits on **229**; block 22 step 2 op 10 is
`cam_play 100..229`. The cue *is the shot's own end frame*. That is how the
game times an entrance to the end of a shot, and 6 of the 44 camera-cue
entrances in the shipped scripts are written that way.

### The engine publishes that frame; the port did not

`CamAdvancePathFrame` (`FUN_004035E0`) [proved]:

```c
g_cam_path_frame = cur;            // publish -- BEFORE the end test
DAT_009C6F28 = end - cur;
if (end <= cur) { cur++; g_evt_action_advance = 1;
                  g_queued_events_pending--; return; }
cur++;
```

so the last frame of a range is published *and* the action retired in one call.
The retirement is invisible to the script until the next frame because the two
live in different tasks: the scene's task list at `0x00460710` creates
`EvtInterpreterLoop` first and `EvtRunQueuedActions` third, `ActorAlloc`
(`FUN_004A6FA0`) appends a task at its parent's tail (`+0x2C`), and
`TaskRunTree` (`FUN_004A71A0`) walks the `+0x28` child list from the head
through `+0x1C` — so creation order is execution order [proved]. The object
update therefore sees the end frame for one whole pass.

`Walker.tick` collapsed both tasks and ran the camera half **first**. So on the
tick the path reached 179 the camera advanced, `wait_queued_events_done`
settled the ring from inside its own `satisfied` and fell through, ops 6–13 ran
and the `cam_play` behind them took the camera — all before `syncPortGlobals`
read `w.cam.frame`. The port published 178 and then 180. Frame 179 was never a
value it held, and state 18's gate is an exact `CMP ECX,EAX; JZ` [proved at
`0x004575E7`].

The fix is the task order: instructions first, camera after. Two pieces went
with it. `CamCommand.started`, because `CamStartPathPlayback` (`FUN_00403510`)
calls `CamAdvancePathFrame` itself and the ring calls the handler once a frame
— so a shot that starts during a tick's instructions has already published its
first frame and must not be stepped again in the same tick. And
`wait_queued_events_done` no longer calls `settleCameraAction` from inside
itself: retiring the action is `EvtRunQueuedActions`' job, and a wait that does
it is a wait that cannot lag by the frame the engine lags by.

### The first attempt fixed 38 of 44 and looked done

Moving only the *settle* to the end of `tick` — leaving the advance at the top
— fixed both reported spawns and 36 others. It left six: stage 3's four on cue
1440 and stage 6's two on 685. Those are released by
`wait_camera_path_frame 0`, which the port models as a frames countdown rather
than as the engine's per-frame re-read of `end - cur`, so it came down on the
same tick the camera reached the end and the shot behind it published over the
top. Only the full reorder covers both gates. **A partial fix that clears the
two spawns in the bug report is not a fix**; `tools/cam_cues.mjs` is what said
so, and it exists because `tools/entrances.mjs` drives the entrances with a
camera of its own (`g_cam_path_frame += 1` for ever), which hits every equality
cue in the game by construction and is blind to this entire class of bug.

### B11's other half: the barrels are not supposed to smash

The props the stage-2 zombie walks through are breakable group 1 —
`PlaceBreakableGroup`, two stacked members at about `(-904, -1319)`, 33 units
from the spawn. `BreakablePropUpdate` (`FUN_00464620`) reacts to exactly two
things: the hit flags at `obj+0x34 & 8` with the shot count at `+0x47`, and the
family-4 global at `DAT_009C7265`. **There is no actor-contact test in it**
[proved]. Nothing in the engine smashes a breakable prop because an enemy
walked into it, and the port matching that is correct. The generic props beside
them are class 0x41 type 5, whose object routine `PropDrawOnlyType5`
(`FUN_00466820`) is a matrix push, a draw and a pop — scenery, and nothing
else. What was wrong was that the zombie was there at all: with the cue firing
it leaves for `AttackRun` at camera frame 229 and turns on the player, which is
what the report asked for.

Whether a class-0x41 prop is in the set `ColiTestSphereAgainstActors` separates
actors against — so that the zombie is pushed *around* the barrels rather than
through them — is `[open]` and was not read.

## Three class-0x30 bugs: a second motion track, a row that ignored the body condition, and a header shape read off the wrong state

### B5 — the swing outlives the actor because the port has two tracks

`ZombieStateStrike` (`FUN_00455A40`) plays both the lunge and the swing on the
actor's **ordinary** motion — `FUN_004119A0(obj+0x194, entry->strike, 0, 5)` at
0x00455B8A, exiting on `g_motion_play_length[obj+0x1B4] - 1 <= obj+0x19C`.
There is no second channel anywhere in the class. The port invented one
(`Actor.action`) because `render/characters/pose.ts` has to hold the swing at
full weight while the walk keeps its clock, and `pose()` gives it precedence
over `obj.motion`.

So `ZombieOnShot` (`FUN_00453EB0`) setting state 6 on the frame of the kill,
and `ZombieStateDeath6` calling `ChooseDeathMotion` on that same frame, did
everything right and changed nothing on screen: `obj.action` still held the
bite, the poser still drew it, and only when the clip ran out did the actor
fall. **"They finish their swing then immediately die" was one missing edge**,
not a state-machine fault — the whole death chain was already correct.

The fix is where the engine's own coincidence lives: `ActorSetMotion` and
`ActorSetMotionBlended` are the two routines that write that single track, so
in the port they end the one-shot on it, fading out of the swing rather than
out of the base clip. Every state that sets a motion inherits it.

Worth keeping in mind for the next one: **`obj.action` is the port's, and any
engine routine that writes `obj+0x1B4` must be assumed to end it.**

### B12a — `ActorPlayHitReaction` read row zero for every actor

```
004544e5  0fbf86f4010000    MOVSX EAX, word ptr [ESI + 0x1f4]     ; character
004544ec  8b8e0c130000      MOV   ECX, dword ptr [ESI + 0x130c]   ; condition
004544f9  8b98c82f5900      MOV   EBX, dword ptr [EAX + 0x592fc8]
0045450a  8b1c0b            MOV   EBX, dword ptr [EBX + ECX]      ; the row
```

The annotation on `FUN_004544C0` had said `g_pHitReactionMotions[char][obj+
0x130C][group]` since it was written; the port read `reactions["0"]`. Twenty-one
character types carry a second row at body condition 3 — motions 257–263, 43
frames against 29 — and nothing in the port could reach it. `[proved]`

It is **not** why a crawler stands up when it is shot: `znkager`'s condition-4
row is `0x00567850`, byte-identical to its condition-0 row, so the engine picks
the same standing stumble. Reading the table before believing the symptom is
what stopped a plausible fix being made to the wrong place.

### B12b — the crawler's own attack cannot land, in the engine

`znkager` is character type 12 and every one of its 20 spawns carries body
condition 4. Its cond-4 pick row is ten 2s then ten 3s, so an undamaged crawler
always draws attack **2**:

```
00566e70  e5 03  1b 04  00 00 d0 41  28 00  09 00  01 00  00 00
          ^997   ^1051  ^26.0f       ^40 hit frame
```

and `g_motion_play_length[997]` is `0x0014` = 20 at 0x004E0F9A. The hit lands on
`obj+0x19C == 40` and the state leaves at 19, so **clip 997 never reaches its
own hit frame**. `hod2lib/combat.py` rejects the entry for exactly that reason
and the port then falls back to attack 3, which is a different clip that *does*
connect — the port is currently more dangerous than the game here. Recorded as
a `[diverges]` in `class30/strike.ts` rather than fixed, because the faithful
version means baking a clip and keeping an entry the exporter is currently
right to call impossible.

The crawler also flip-flops `HoldAtRange` ↔ `BackOff` once per frame for about
ninety frames after it arrives, because condition 4's retreat exit is `ring *
0.7 < d` while the hub's entry is `d < ring - 1`, and 0.7·25 < 24. Both tests
were re-read against 0x004557AE and 0x00455D60 and **the port matches the exe on
both**, so this is the engine's own behaviour and was left alone.

### B6 — the header shape belongs to the state that reads the blob

`ZombieScriptForState` (`FUN_0045CA10`) is `state == tail[3] ? tail+0x08 :
tail+0x04`. The exporter decoded tail+0x04 with the header shape of
**tail[1]**, the descriptor's initial state — which is right for 63 of the 69
captors and wrong for the six whose initial state is 39,
`ZombieStateAwaitCivilianOrder`. Those are put into a state by their civilian's
op 0x1A (`0045BB4F: obj+0x1310 = sub+0x2C`, then the handler is called on the
spot), and it is *that* state's shape the blob is read under. 39 has no shape,
so the exporter emitted `target_script: null`, and
`ZombieStateWalkToTarget` took `arrive` and `motion` as zero: a radius nothing
satisfies, and two zombies walking at a hostage for ever.

Six for six, the ordered state is the one that decodes:

| spawn | ordered | tail+0x04 under that shape |
|---|---|---|
| 1 · 0x3D24 | 36 | one entry, motion 967, flag 34 |
| 1 · 0x4B74 | 34 | arrive 12.0, motion 1026 |
| 1 · 0x4BD0 | 34 | arrive 12.0, motion 1022 |
| 2 · 0x52AC | 35 | one entry, motion 968 |
| 2 · 0xA08C | 35 | one entry, motion 178 |
| 2 · 0xA0E0 | 35 | one entry, motion 183 |

and no other shape gives any of them a terminating, plausible list.
`verify_captor_scripts.py` went from 99 scripts to 105 and from 69 spawns to
70 — its docstring had claimed the odd one "reads the civilian's own block
rather than a script of its own", which was a guess standing in for a reading.

**A bundle re-export is needed before this reaches the player**; the change is
in `hod2lib`, not in the JSON that is already on disk.

## Class 0x20, and the two humanoids that stood still (B13, B14)

### The frozen humanoids were never a state-machine bug

Stage 2, block 9, step 5, spawns `0x55BC` and `0x56C8` — alive, drawn, on one
frame of one clip for the rest of the stage. Driving the real `Walker` and
`GameUpdate` headlessly (`web/tools/humanoids.mjs`) printed the answer on the
first run: `motion 180 NOT BAKED`. The VM was doing exactly what its program
said. `op 2` set motion 180 and the exporter had never baked it, because
`characters.py` added the command block's **header** motion to the bake list
and nothing the program went on to set.

That turns a data gap into a hang rather than a blank: `op 1` mode 2 is *hold
when the clip reaches its last frame*, and the port reads that as
`frame >= m.frames - 1` against a `BakedMotion` that does not exist. `frames`
is 0, the authored frame is pinned at 0, the wait can never be met and the
cursor never moves. **118 of the six stages' 263 (program, clip) pairs** were in
that state.

`tools/verify_scripted_clips.py` is the check, and it is deliberately asked of
the **exporter** and not of `charmotion.bake`: every one of the 118 clips was
perfectly bakeable, so a check that only asked whether the data decodes would
have passed for the whole time the bug was live. Backing the fix out takes it
from 445/445 to 327/445.

### `op 4` mode 4 was inverted, and the decompiler was right

Ported as `NearerThanBefore`, and it is the opposite. `0x004845AE` builds
`|pos - point|` and `|prevPos - point|`, `0x004845FD FCOMPP` compares the
*second* against the first, `0x00484601 TEST AH,0x1` reads C0 and
`0x00484604 JZ 0x00484A7B` jumps to the blocked path when it is clear — so the
command proceeds only while the previous distance was the smaller one. The two
`FXCH`es before the compare cancel and are what makes this easy to read
backwards; the operand order is what it turns on. Two shipped commands use it,
both in stage 1.

### "ported, but the class says nothing" was literally that

The other half of the same report. `actorsProjection` prints that string for
any actor whose handler has no `debug`, and class 0x25's had none — so a fully
ported class read exactly like an unread one. It is a `debug` now, and the
first thing it says about an actor is whether its clip has frames.

### Class 0x20 was filed as "not reached", from an address in another function

`spawns.md` had `0x20` in a row of unreached classes with the note *"has a call
to the HP scaler at `0x0044964A`, so it is `[likely]` a combat actor"*.
`0x0044964A` is inside `EnemyThrowerInit` (`0x00449620`) — class **0x31**'s
handler. Class 0x20's is `0x00448ED0`, and the only relationship between them
is that they are adjacent in the file. Both halves of the note were wrong: it
is reached, 36 times across four stages, and it has no hit points at all.

This is the adjacent-array trap in its function-pointer form.
`g_class_handler_pairs` (`0x00593358`) names the handler outright — `20 00 00
00 d0 8e 44 00` — and reading the index rather than the neighbourhood would
have cost one memory read.

### What class 0x20 is

A skinned actor that dies to any single hit. There is no hit-point subtraction
anywhere in the class: `obj+0x34` bit 3 is the entire damage model. It scores
like the combat classes (10 a bone, 120 + `g_head_combo_bonus` on bone 2, 80
for the kill), plays motion 988, holds its last frame, sinks 0.04 a frame for
120 frames and despawns. Un-shot it is removed on a camera cue.

Two of its fields are the polymorphism trap in miniature and both were checked
against the class rather than assumed:

* `obj+0x11C` — the descriptor's `+0x22`, which the bundle calls `hp` — is the
  **spin direction** for sub-type 1. Three of the four stage-2 spawns carry 0
  and the fourth carries 1.
* `obj+0x1330` is the sink countdown here, `bonePropMode` for class 0x25,
  `slideTimer` for class 0x24 and the shared arc record's elapsed frame for
  0x30 and 0x31. It stays on the head, per the rule the four arms established.

`FUN_004494D0` — the `g_GameMode 2` / block `0x0D` held state — is **not
ported**, and its two gate bytes `DAT_009C72F1`/`DAT_009C72F2` are `[open]`.
They are read by `ZombieAdvanceMotion`, `CivilianUpdate` and class 0x31 as
well, so they are a general pause of some kind and worth a session of their
own.

### `ActorInitHitPoints` was being run for every spawn

Found by asking what `obj+0x11C` is for class 0x20 rather than assuming.
`FUN_0040A8B0` has **two** callers in the whole image, and one of them is the
`0x0044964A` that `spawns.md` had attributed to class 0x20 — so the same wrong
address had produced two separate wrong beliefs. The port applied the routine
to every character placement in `SpawnScriptedCharacters`, which clamped
`obj+0x11C` to at least 1 for classes 0x10, 0x20, 0x24 and 0x25. For a
class-0x20 sub-type 1 that word is the spin direction and the clamp reversed
it; for class 0x24 it is an animation phase seed and the clamp shifted it. It
is gated on the class now, and the gate is a five-line `Set` with the two call
sites quoted beside it.

### One thing that cost twenty minutes

Inserting `class20_tail` with a text anchor put it *inside*
`resolve_for_stage`, which silently truncated that function to a `def` and made
it return `None`. `export_player.py` then failed with
`cannot unpack non-iterable NoneType object` five frames away from the cause.
Anchoring on a line that is unique in the file is not the same as anchoring on
a line that is unique in the *right scope*.

## 2026-09-04 — fifteen reported bugs, seven worktrees, and four breaks in the seams

The bug list in `docs/BUGS.md` went out to seven agents grouped so no two owned
the same files. Thirteen of the fifteen are fixed or explained; two turned out
not to be port bugs at all. The findings are in each fix's doc comments. What
belongs here is the process, because the process failed in a way none of the
agents could have caught.

### Every agent was green, and the merge was broken four times

Each of the seven ran its own full chain and each was clean. The damage was
entirely **between** them:

1. `port.test.ts`'s new camera-cue Walker host predated `WalkerHost` gaining
   `presentEnemies`. Merged textually with no conflict. `test:port` **passed**,
   because the runner strips types. Only `tsc` saw it.
2. The same method missing from three `.mjs` harnesses — `cam_cues`, `killall`,
   `zombies` — from three different worktrees off the same base. `.mjs` is not
   typechecked, so `tsc` was blind and only *running* each tool found it. One
   was found by running it; the other two by sweeping for the pattern.
3. `render/rigs.ts`: two agents independently diagnosed the same
   `RigLayer` over-adoption bug from opposite symptoms and wrote the same fix
   with different identifiers. Textual conflict, semantically a duplicate.
4. Self-inflicted: three conflicts in a row had been "keep main's block, then
   append this branch's", so the fourth got the same treatment — and it fell
   **inside an `import` statement**, producing two concatenated clauses and a
   syntax error. The union rule is right for append-only files and appended
   test blocks and wrong the moment a conflict is inside one statement.

The rule that follows: a fan-out is not merged until the *union* has been
typechecked and the harnesses have been **run**, and neither is implied by
every branch being green on its own.

### The base, not the diff — a third time

Five of the seven worktrees branched from a base **35 commits behind** `main`,
missing all four union arms, D1–D3 and the class-0x30 death chain: precisely
the code they were sent to edit. This has now cost this project three separate
sessions, and each time it was found by looking at a *result* rather than at
the setup. `git merge-base main <branch>` on every branch, before reading a
line of any report, is cheaper than any of the recoveries have been.

### Three of my own briefs were wrong, and the agents refused them

`0x6784 znonoopa` was filed as class 0x31; it is class 0x30 (`class: 48` in the
shipped placement). B8's "the droppers have not joined the counters yet" was a
plausible race that the code refutes on its straight line. B13's two candidate
causes were both in the VM, and the bug was in the exporter. In each case the
agent disproved the lead and said so, and in each case the write-up was better
for having had something specific to refute. **A brief's job is to be checkable,
not to be right** — but a lead stated confidently is still a lead that has to be
re-verified before it is repeated, and I repeated the class-0x31 one into two
different briefs.

### Two checks that would have found bugs years earlier

`verify_scripted_clips.py` asks the *exporter* whether every (program, clip)
pair got baked. All 118 missing clips were perfectly bakeable, so every
decode-side check passed for as long as the bug existed. The question a check
asks matters more than how thoroughly it asks it.

And `verify_captor_scripts.py` went 69/99 → 70/105 because a blob's header
shape belongs to *the state that reads it*, not to the descriptor's initial
state. Both bugs were invisible to anything that only read what was written.

### Two reported bugs that were the engine being itself

The barrels do not smash because `BreakablePropUpdate` has no actor-contact
test — nothing in the game smashes a breakable because an enemy walked into it.
And `znkager`'s undamaged attack is clip 997 at hit frame 40, where clip 997 is
20 frames long: in the real game an undamaged crawler swings and misses, every
time. The port falls back to an attack that connects, which makes it **more
dangerous than the original**. Both are recorded as findings rather than
counted as fixes, because "the port matches the engine" and "the bug is fixed"
are different claims and only one of them is true here.

## `g_app_state == 6` is *in play*, and the port's 0 was not inert

`DAT_009C8E98` had been `[open]` since `PROGRESS.md` item 20, read once as a
"scene id" and once as a "scene state", and the two readings disagreed. It is
neither. It is the game's top-level screen, and the two things that fix its
values are both in the routine that writes it:

* `CommitAppState` (`FUN_0040E860`) — the only writer, run at the end of the
  per-frame tick from the request left at `g_app_state_pending` (`0x007C17A0`)
  — ends with `if (pending < 6 || pending > 7) g_player_state = 9`. So 6 and 7
  are the only two states in which a live player survives the transition.
* `FUN_00414FC0`, the start press that spends a credit, requests exactly 6.

That makes 6 the in-play state, 5 the attract demo, 7 the game-over arm and
0x10 boot. 3, 4, 9, 0x0A, 0x0B, 0x0C and 0x0F are the shell's other screens and
stay `[open]` — they are requested from routines I did not read, and naming a
screen from the routine that leaves it is exactly the guess this project bans.

### What I got wrong on the way

**I called 0x10 "shutdown" and wrote it into the enum before checking.** It
looks like a shutdown: `FUN_0040E4A0` tears the data segment down through
`FUN_0040A920` and then stamps 0x10, and the main loop stops drawing while it
holds. It has exactly one xref, and that xref is `FUN_0049E4A0` — the startup
routine that reads `Hod2.ini`. It is the **boot** state. One `get_xrefs_to`
would have settled it and I did the reading in the wrong order.

### Why the value mattered more than the bits

The brief was three flag bits `ResolveHit` (`FUN_00409430`) raises on
`obj+0x34` — `0x200` no part swap, `0x400` no dismemberment, `0x800` no hit
result — under a guard that skips the OR when `g_app_state == 6`. The port kept
`g_app_state` at 0 and documented every clause reading it as inert. Transcribe
the OR literally against that and every enemy in the game gets all three bits
on its first hit, and the gore leaves the whole port. The bug you ship closing a
divergence can be much larger than the divergence.

The comment that made this possible is worth quoting, because it is the shape
of the failure rather than the failure itself:

> The port has no attract mode, so this stays 0 and the clause is inert.

"The port has no X" is a fact about the port. "So the global stays 0" is a
guess about the engine, wearing the fact's clothes. Nothing in the exe says 0
means "not attract"; `FUN_0040A920` writes 0 as part of a whole-segment reset
and `FUN_0040E4A0` stamps 0x10 over it a moment later, so 0 is not a state the
running game is ever in.

### `0x400` is not an out-of-play bit

The three bits looked like one mechanism — "suppress everything while the
attract demo shoots" — until I checked the shipped spawn records. `0x400`
appears in `init_flags` on **68 class-0x30 spawns** across stages 1 to 4, and
`ActorInitFlags` (`FUN_00408970`) is `obj+0x34 = spawn_flags | 1`, so those
actors carry it from birth. `ZombieStateWalkToTarget`, `ZombieApplyScriptMode`
and `EnemyThrowerInit` (character type 0x18 only) raise it too. Nothing clears
it. So it is an ordinary actor flag — *this one does not come apart* — that
`ResolveHit`'s out-of-play OR happens to set alongside two that really are
out-of-play only. `0x200` and `0x800` appear in no spawn record and have no
other writer I could find.

Had I named the three from the OR that sets them together, all three would have
been called something like "attract suppression" and the 68 spawns would have
gone on being severable for ever.

### A stale name found on the way

`docs/formats/civilians.md` called civilian script op `0x2B` `DebugOnly`, on
the strength of nothing but its `g_app_state == 6` gate, back when 6's meaning
was open. 6 is *in play*, so the op is the ordinary path and the name said the
opposite of the truth. Renamed to `InPlayOnly`, with what it actually writes
recorded and its meaning left `[open]`.
## The class-0x31 throw exits to the hub; it does not loop

`ThrowerStateThrow` (`FUN_0044FAF0`) had one thing missing from the port and it
was the ending. On the throw clip's last frame the engine plays `0x2916A9` and
writes `obj+0x1310 = 7`, `obj+0x1312 = 0` — `66c786101300000700` at 0x0044FCE1
— and does nothing else. The port instead looped inside the state, leaving only
when its own one-shot clip channel emptied, and re-armed one hand itself on the
way round. That re-arm carried a `[diverges]`; this closes it.

The half that made the shape obvious is in a state nobody was looking at.
`ThrowerStateStandAndDecide` offers 0x1D — 0x1E for character type 0x18 — to
`ThrowerTryEnterState` on **every** frame, before it asks `ThrowerPickNextState`
anything (`PUSH 0x1d / CALL 0x0044afb0` at 0x0044B375, `PUSH 0x1e` at
0x0044B390, both jumping past the `CALL 0x0044adb0` at 0x0044B3AA). So states 29
and 30 are not "unreachable because no pick band names them", which is what
`class31/standing.ts` said: the hub reaches them directly, and every throw runs
into one of them on the next frame. The pick bands were the wrong place to look.

Three more readings came out of it, all `[proved]`:

* The three sub-states **fall through** into each other — `SUB EAX, 0 / JZ`
  then `DEC EAX / JZ` twice at 0x0044FB16 — so a throw can start and release on
  the same frame.
* The clip **does not start at frame zero**. `ActorSetMotionBlended`'s third
  argument is the play cursor, not a blend length and not an authored frame:
  `FUN_004119A0` is `param_1[2] = param_3; param_1[6] = param_3 / 2`, writing
  `obj+0x19C` and its half at `obj+0x1AC`. The state passes `0x1A` for every
  character type but 0x18 and 0 for 0x18. A `zsass` throw is 22 cursor ticks of
  wind-up against its entry's release frame of 48.
* The state **releases no permit at all**. `ThrowerReleaseAttackPermit` has
  exactly eight call sites and this is not one; `SpawnThrownWeapon` copies
  `obj+0x121` to the projectile actor and leaves the thrower holding **0**, not
  −1 (`889f21010000` at 0x004506D5, `BL` zeroed at 0x0045050A), moving the
  `0x8000` commit latch with it, and `ThrownWeaponFlyToTarget` frees the slot in
  its sub-4 arm after 30 stick frames and 60 blink frames.

### What I got wrong on the way

The write-up in `thrower.ts` said the unreachable default arm of the `zslman`
switch "plays the clip passed in as the routine's *second argument*".
`ThrowerStateThrow` has no second argument: after `PUSH ESI` / `PUSH EDI`,
`[ESP + 0xc]` is the **first** one, the actor pointer, and Ghidra renders the
arm `iVar3 = param_1`. The arm plays a pointer as a motion id. Corrected in the
port and in `combat.md`.

And I ran `tools/annotate.py` once from the shared checkout instead of from the
worktree, which edited a peer-visible `functions.tsv`. The worktree's own copy
was still pristine, so restoring the one changed row from it was exact — but
the lesson is that every command in a worktree-isolated session has to `cd` to
the worktree, not to the repo root, and a read-only `grep` that does the wrong
thing is indistinguishable from a write that does.

### What is still open

The permit still goes back in `SpawnThrownWeapon` rather than with the weapon,
and that is now the `[diverges]` the re-arm used to be. The faithful fix is for
`G.g_thrown_weapons` to carry `obj+0x121` — but the pool is shared with class
0x30's thrown weapon, which is driven by `ZombieThrownWeaponUpdate`
(`FUN_0045A4F0`) through its own state table and has its own release site, so
releasing from the shared flight routine would free a class-0x30 actor's slot
through class 0x31's routine: exactly the wrong-bit mistake the note on
`ThrowerReleaseAttackPermit` warns about. Splitting the two projectiles is the
job, and it is not the throw's.

## 2026-09-04 — the first clean export since the Ghidra upgrade, and what it caught

With the GUI closed, `./ghidra/run.sh export-annotations` ran for the first
time in a while. It worked — and its output would have broken the build, for
four separate reasons, every one of them in `ExportAnnotations.java`'s filter
rather than in the database.

### `switchD` never matched `switchdataD_`

The filter's auto-label prefix list carried `"switchD"`. Ghidra 12 spells a
jump table's label `switchdataD_004330c4`, and that does not start with
`switchD` — the seventh character is `d`, not `D`. So **316 jump-table labels
went into `globals.tsv`**, and three of them *overwrote curated names*:
`g_class33_selector_targets`, `g_class33_selector_index` and
`g_class26_states` all became `switchdataD_...`. A silent downgrade of work,
in the file whose header calls itself the source of truth.

The prefix list is now matched case-insensitively and the comparison is
looser. But the real lesson is that a prefix list is a version-drift hazard,
so the merge also **refuses to replace a curated name with a generated one**
even if a future Ghidra invents a spelling nobody predicted. That guard cost
three lines and would have saved all three names on its own.

### `default` is a name, 148 times

The label on a jump table's default arm has no prefix at all, so nothing
matched it. 148 rows arrived, every one named `default` — the only thing that
has ever put duplicate *names* in `globals.tsv`, a file whose whole value is
that a name identifies one address.

### The TEB guard did not drop the TEB

```java
if (b == null || !b.isInitialized()) continue;   // drops TEB
```

Ghidra's synthetic thread-block *is* initialized, so 86 Windows fields —
`TlsSlots`, `LockCount`, `TxnScopeContext`, at addresses like `0xffdfffd4` —
were exported as program globals. `verify_annotations.py` rejects each with
"is in no section", which is exactly the question the exporter should have
been asking: it now checks section membership directly, the same four sections
the checker knows about.

**A comment saying what a line does is not evidence that it does it.** That
one had been sitting there being believed.

### Two labels on one address, and no rule for which wins

`0x009C8E58` carries both `g_camera_fixed_eye_y` and `g_ground_plane_y`. The
symbol iterator yields them in no guaranteed order, so which one reached the
file was luck, and this run it picked the one the port does not cite —
`verify_port.py` failed on two files. The file now decides: if the database
also carries the name the file already has at that address, the file's choice
stands, because that is where the canonical alias was chosen.

### After the fix

577 appended globals became 25, and all 25 are real: the `g_coli_*` family and
the six `CivilianHook*` labels. The 22 appended functions were always real —
`EvtRunQueuedActions`, `DrawBackdropDome`, `PlaySoundId`, `LzDecompress`, a
whole `Coli*` set — GUI work that had never reached the TSV. Five genuine
renames came with them and were propagated to every citation in the port,
the docs and `hod2lib`.

### Two things the export revealed that are not the exporter's fault

**The database is behind the TSV by 227 function names and 135 globals.**
`tools/annotate.py` writes the file; only an MCP rename or `apply-annotations`
writes the database. Every agent that annotated this month widened that gap.
The merge is what has been protecting those rows — against the database as it
stands, an exporter that *rewrote* would delete a third of `functions.tsv`.

**The database has one duplicate function name**: `ColiSphereVsMesh` on both
`0x004AAF60` (curated, with a comment) and `0x004AAFF0` (new, bare). Which is
which needs the two read side by side, and the GUI was closed, so the new row
is held out of the file rather than guessed at. It is still in the database and
the next export will re-propose it.

### Correction, same day: the `ColiSphereVsMesh` collision was a wrong address

The entry above says the database has a duplicate function name and that
telling the two apart needs them read side by side. With the GUI back up, they
were, and it is not a duplicate:

**`0x004AAF60` is not a function.** `get_function_by_address` there returns
`ColiSegmentVsMesh`, whose body is `0x004AAA40..0x004AAFEF` — so the address
is *inside* it, and not even on an instruction boundary: the instruction at
`0x004AAF5D` is `MOV EAX,[ESP+0x10]` (`8b442410`), four bytes, ending at
`0x004AAF61`. It has **zero xrefs**. The real `ColiSphereVsMesh` begins at
`0x004AAFF0`, immediately after the segment test ends.

So the curated row was mis-addressed by 0x90 and had been since it was
written, and the GUI rename the export picked up was right. The row keeps its
prose and moves to `0x004AAFF0` — the comment describes that code exactly:
`g_coli_hit_depth = fVar6`, the signed unnormalised plane distance, and
`local_38 <= fVar4` against `radius²` with no sign test.

**Nothing objected for as long as it was wrong.** `verify_port.py` lists an
address the TSV does not know under **unnamed citations** — a work list — not
as a failure, so `FUN_004AAF60` sat in `web/src/game/coli.ts` and
`PLAYER_PROGRESS.md` reading like a citation and pointing into the middle of
another function. The count went 85 to 84 when it was fixed. A work list is a
weaker signal than it looks: a wrong address and an unread one are the same
row in it.

This is also the adjacent-function form of the trap `CLAUDE.md` records for
tables. Two collision routines, back to back, and the wrong end of the
boundary was recorded.

## The two ways the engine plays a camera path, and the fix that only knew one

Reported: stage 2 block 16 never clears; the zombie that mauls the civilian
walks backwards out of the scene instead of turning on the player; the two
`znebi2` that should come up out of the water are visible the whole time.
And: *"this used to work and now doesn't."*

It used to work this morning. `f28c464` — *the last frame of a camera path
never reached the port* — added `CamCommand.started` so that a shot which
starts during a tick's instructions is not stepped again by the same tick's
camera advance. That is right, and it is right **for one of the two ways the
engine plays a path**, which is the way that commit read:

```
CamAdvancePathFrame (FUN_004035E0)      -- the queued-action rail
  g_cam_path_frame = cur;               -- publish, THEN
  g_cam_path_frames_left = end - cur;
  cur += 1;
```

`started: true` was put on both branches of `cam_play`. But a `cam_play` with
`flags & 2` does not play at all: `FUN_00403490` stashes the range, and the
`finish_sequence 6|7` behind it installs a rail hook that plays it. Both hooks
are the other order:

```
CameraStepRailTick   (FUN_0040C790)  -- scene state (2,6), `<=` on the end
CameraPlayStashedPath (FUN_0040C8A0) -- scene state (2,7), `<`  on the end
  if (end <op> cur) goto tail;
  cur += 1;                             -- increment, THEN
  DAT_009C70BC = (float)cur;            -- publish
tail:
  g_cam_path_frames_left = end - cur;
```

So a stashed `581..660` draws **582..660**. Carrying `started` across made the
port draw `581..659`, and **the last frame is exactly what the data times
entrances to**: block 16 step 6 stashes 581..660 on path 75, `0xA030`'s captor
cue is 660 and its civilian's killed script waits on 650. Both are equalities
the port could not satisfy from 659.

**The bug the commit fixed and the bug the commit caused are the same bug**,
one frame at each end of the same shot, and the harness that caught the first
could not see the second: `tools/cam_cues.mjs` drives all 44 camera-cue
entrances and every one of them is a class-0x30 state 18/19 spawn on a
non-deferred play. A captor's cue is state 42, and a civilian's is a
`CivilianWait.CameraCue` bit; neither is in that list. 44 of 44 stayed green
across the regression.

### ...and the address in the report was unplayable for a second reason

`?stage=2&mode=play&block=16&step=6&op=10` still deadlocked with that fixed.
`seekTo` replays instructions and **observes no waits**, so it stepped over
step 6's `wait_camera_path_frame 0` with the shot on frame 581 of 660 — and
then replayed the `finish_sequence` two instructions later, which is
`CameraSnapToPathEye` and froze it there. The seek's own doc already had the
principle: *"stepping past a gate retires what the gate was waiting on...
otherwise the next instruction runs against a world the script never
expected."* The camera is the other half of that world, and only the enemy
counters had it. `WaitRule.skipRunsCameraOn` is the camera's.

A wait's **postcondition is part of the address**. Two of them now say so.

### A captor waiting on its civilian is not drawn

Third symptom, and its own bug. `ZombieStateAwaitCivilianOrder`
(`FUN_0045BAD0`) sub 0 saves `obj+0x34` whole into `obj+0x1350`, raises
`0x18000`, clears `obj+0x1F8` bit 0 — the flag `FUN_0040A590` reads before the
ground decal — and writes a zero into the first part's draw byte through
`obj+0x1D4`:

```
0045bb31  8b86d4010000   MOV  EAX, [ESI + 0x1d4]      ; model+0x40, the parts
0045bb37  885001         MOV  byte ptr [EAX + 1], DL  ; DL = 0
```

That byte is the gate `SkeletonDrawWalk` (`FUN_004110D0`) reads before it emits
a part — `if (parts[i*8 + 1] != 0)` — and the same byte
`ActorSetPartVisibility` (`FUN_00409D10`) writes for every part at once, which
is how the corpse blink flickers a body. Taking the order puts all four back.

The port had none of it, and the field that models it — `Actor.alpha`, already
declared as the port's one-per-actor stand-in for the per-part byte — **was
written by the corpse blink and read by nothing at all.** `render/characters.ts`
gates on it now. Two states get their hide back for the price of one line.

The order arm also ends in `g_class30_states[obj+0x1310](obj)`, a tail call
through the table, so the ordered state runs on the same frame. `runState` is
handed in the way state 42 already takes it.

**And it is a count, not a countdown.** `sub+0x2E` is decremented by each
captor parked in state 39, so `op 0x1A(35, 1)` orders exactly one and the
civilian's killed script issues it twice to raise both `znebi2`. The comment in
`class10/state.ts` called it frames.

Not a bug, and worth recording because it looks like one: the civilian in that
set piece is **meant** to die if she is not rescued, and script 33 — her
on-shot script — waits on `children alive <= 2` before it issues either order.
The player has to kill a captor to bring the swimmers up.

## `authoredFrameHeld`'s own docstring named this bug a year before it happened

Class 0x20's death animation played twice. `OneHitTargetPlayDeathClip`
(`FUN_00449380`) steps `obj+0x194` at the top of every frame and, on the frame
the clip ends, writes the old value straight back (`004493e3 MOV [EDI], EAX`);
`OneHitTargetSinkAndDespawn` (`FUN_00449430`) never steps it at all. The
counter stops for good and the body sinks on the last pose.

The port's clock is `ActorAdvanceMotion`'s, shared, and it runs for every actor
before any class handler — so "does not step it" has to be written as an undo,
and was not written at all. The poser reads the **base** track with the
wrapping `authoredFrameOfTicks`, and `char_adv00`'s clip 988 is 82 authored
frames against a 120-frame sink: measured at once through and 38 frames into a
third.

`authoredFrameHeld`'s doc comment in `core/play_cursor.ts` already said what
this is: *"a killed zombie played its death animation and then played it again,
for ever."* Class 0x30 was given the held track (`obj.death`) and fixed. Class
0x20 puts its death clip on the **base** track, because that is what the engine
does — `FUN_004119A0(model, 0x3DC, 0, 5)` — and so it was never covered.

The file's own note said the port *could not* hold the counter, because one
clock serves every class, and that the visible result was the same. Both halves
were wrong, and the second one is why nobody looked.

## What was ruled out and not fixed

Stage 1 `0x16D8` `char_adv00` plays the wrong entrance — a ledge hang where a
chair push belongs. The whole data chain checks out: `FUN_004575A0` plays
`tail+0x04` and waits on `tail+0x08`, `placement.py:entry_tail` reads exactly
those offsets, the answer is `motion 1048, cue 150`, 1048 is a real 60-frame
`zom.bin` clip in `char_adv00`'s own table, and a trace has the port playing
1048 for the whole cue window. Two theories tested and both dead: it is not
floating (snapped to `y 6.20` and holding, so that is the floor), and 1047/1048
are not a swapped pair of door halves (`char_adv01` has 1048 and not 1047).
`[open]`, and it wants eyes on the render rather than another reading.

## One number missing from a hand-kept list, and a `zsass` never attacks again

Reported: at stage 2 block 17 step 7, `0xBA90 zsass` closes on the camera and
walks through it, and nothing forces an attack when it is in range.

The route to an attack at close range is one function.
`ThrowerStateStandAndDecide` (`FUN_0044B180`, state 7) ends:

```c
if (char == 0x18) { if (ThrowerTryEnterState(0x1E) == 1) goto done; }
else              { if (ThrowerTryEnterState(0x1D) == 1) goto done; }
if (obj+0x1310 != 0xB) ThrowerPickNextState(obj);
```

and `ThrowerPickNextState` (`FUN_0044ADB0`) is the *whole* of "attack when it
gets close": `d <= 30.0` writes state 8, which claims a permit and pounces.
**So a state-29 proposal that is always accepted pre-empts the router
entirely**, and the actor can be standing on the lens and never ask.

State 29 is `ThrowerStateRearm`, gated on `ThrowerHasBareHand`
(`FUN_0044F720`) — which reads the two hand **draw slots**, `obj+0x4DC` and
`obj+0x68C`. `ThrowerStateRearm` plays motion **5** and, at that clip's exact
**midpoint**, swaps each bare slot back to its armed one and clears the
matching `obj+0x1318` zone bit. The re-arm is the only thing that can make
`ThrowerHasBareHand` false again.

Motion 5 was not in `hod2lib.class31.CLASS31_LITERAL_MOTIONS`. So it was baked
for no character at all, `MotionOf` returned nothing, `playOnce` set no action,
`ActorClipFrame` returned **-1** — and `-1 >= trunc(len / 2)` is false, so the
midpoint the whole state exists for never arrived. The state ran to completion
in a single frame with no clip, the hands stayed bare, and state 7 proposed it
again immediately. Measured on the real camera: **7 ↔ 29, every frame, for
ever**, from the first throw onward, with the router never once reached while
the idle's root motion carried the actor forward.

`0x11B` — `ThrowerStateFallAndLand`'s get-up, `0044a788 681b010000` — was
missing from the same list. A sweep of the nine call sites of
`SetCurrentActorMotionBlended` (`FUN_0044D230`) plus the direct callers of
`FUN_004119A0`/`FUN_00411930` inside class 0x31's range found no third: states
2 and 29 were the two gaps, and states 1, 3, 17, 30 and 34 all check out.

### The list is the hazard, and it now has a checker

`CLASS31_LITERAL_MOTIONS` exists because most class-0x31 motion ids arrive
through `g_class31_motion_sets` and the attack tables — which the exporter
collects from the data — while a handful of states name a clip inline, where
nothing collects them. Its own comment already said *"Leaving these out is not
a subtle failure"*, and it had been wrong twice anyway. A hand-kept list whose
omissions are silent will go stale again.

The port names the same ids in its own `const`s, so the two halves can be
checked against each other, and `verify_port.py` does it now — plus the
bundle, because a listed id can still be refused by `bake`. The bundle arm's
claim is deliberately weak (*some* class-0x31 character carries each id):
which type may reach which clip is a per-state rule, and asserting one nobody
has read would be a guess. Baked for nobody is the failure that happened.

Both arms were watched failing before they were trusted.

### What the harness had to become

`tools/zombies.mjs` seats its eye on an enemy and leaves it there, which is
fine for a state trace and useless here: every threshold in this bug is a
distance to `g_camera_eye`. The repro drives the real `Walker` and the real
`GameSystem` the way `tools/cam_cues.mjs` does, and additionally evaluates the
camera path itself — `CamPaths` from the stage's `cam.json`, then
`CamSeatPathFrame` each tick before `syncPortGlobals`. `cam_cues.mjs` gets away
without that because its own question is about the *frame number*; anything
asking about **where the camera is** has to seat it, or every distance in the
trace is measured from the origin.

## Four documentation findings, closed by deleting the second source

`N17`–`N20` of the 2026-09-04 review are all one failure wearing four coats: a
fact written in two places, one of which is not checked. The previous round
answered that by correcting the numbers, and every one of them was wrong again
within the week. So this round removed the second source instead.

**What the drift actually measured, before it was removed.**
`PLAYER_ARCHITECTURE.md` claimed 38,999 lines against 44,715, "82 declared
`[diverges]`" against 99, a coverage ratio of "148 of 293" against the 156 of
256 its own checker printed on the same commit, and `PlayerCommands` at 46
members against 49. `PLAN.md` claimed 202 named functions against 614 and ten
verifiers against twenty-three. `hod2lib/__init__.py` announced `mot` as "the
last unsolved format" with `mot.py` beside it in the same directory, at
`0.6.0`, through a bundle format bump to 3, while nine modules it never
mentioned were added around it.

Two of those numbers had been *hand-corrected* in the previous round. That is
the finding: correcting a hand-maintained number is not a fix, it is a
postponement, and it is worth saying plainly because the correction feels like
one.

### `tools/status.py` and the friction it buys

`docs/STATUS.md` is generated: the tree by directory, coverage, class coverage,
the citation count, `[diverges]`, `[open]`, the two UI interface seams, the
ratchets, and the check table. `status.py --check` is a check in
`verify_all.py`, so a commit that moves a number and does not regenerate fails.

That friction was the deliberate call, and it is not free — a peer's
uncommitted edit under `web/src/` will fail the check on your tree too. The
alternative is the state the reviews found twice. The failure message names the
one command that fixes it.

The measurements come from the checker, not from a copy of its logic:
`verify_port.coverage_counts` and `class_counts` were split out of the two
`check_*` functions that printed them, and `verify_layers.build_rules` was
hoisted out of `main`. Both refactors leave their checkers' output byte
identical, which was the point of doing them that way round.

### `tools/verify_all.py`, and what a skip is

One authored table — name, command, the sentence saying what only that check
can see, what it needs — replacing five shell blocks of which four were stale
and three omitted suites that had existed for weeks. `status.py` imports
`CHECKS` and renders it, so the documentation of what is checked and the thing
that runs it are one source.

**Skips are counted separately from passes and named.** Exit 3 already meant
"asserted nothing" and `CLAUDE.md` deliberately let it break the shell chain;
what it could not do was distinguish, in a summary, between a green run of
twenty-one checks and a green run of eighteen with three that never fired. That
distinction is `N3`'s whole subject and four of the previous round's regression
tests lived on the wrong side of it.

The `sees` field is load-bearing rather than decorative: a check whose `sees`
duplicates another's is a check to delete, and they are only comparable written
next to each other.

### `docs/LESSONS.md`

Four traps lists became one, `L1`–`L20`, cited by id. Six lessons appeared in
more than one list in five wordings and the copies had already started losing
clauses — the polymorphic-field trap (`L3`) was in all four and only `/decomp`'s
still remembered `obj+0x1390`. The immediate cause of the finding was a new
lesson written into one list of four, which made three wrong the moment it
landed.

### The check that came out of it

`verify_exporters.py` now checks `hod2lib/__init__.py`'s module list against
the package on disk, in both directions. A list of files is checkable, and this
one had been wrong for weeks.

**Two wrong turns getting there, both about regexes over prose.** The first
pattern anchored module rows at "name, two spaces, text" and read the wrapped
continuation of `container`'s description — a line beginning `decompression` —
as a module. Loosening the anchor to any indent then read `is`, `which` and
`unimplemented` out of the surrounding paragraphs. The fix was not a cleverer
regex but a docstring with one unambiguous block: every module row at exactly
four spaces, prose in column 0, continuations indented past the name. The
lesson generalises — a checker over free-form prose wants the prose given a
shape, not the pattern given more cases. Watched failing with `mot` deleted
from the list before it was trusted.

### What is now canonical for what

`STATUS.md` every count · `verify_all.py` the checks · `LESSONS.md` the traps ·
`PLAYER_ARCHITECTURE.md`'s Order of work the single ordered plan, with both
review files contributing findings and neither carrying a competing one ·
`PROGRESS.md` phase and format status · `BUGS.md` reported bugs ·
`PLAYER_HANGS.md` what the automated playthrough trips on. `README.md` was
rewritten around that table; the Blender and glTF material it had accumulated
moved to `EXPORTING.md`.

`N17`'s sharpest instance is worth keeping: `PLAYER_ARCHITECTURE.md` said in
one section that step 23 had closed `layers-are-systems`, and three sections
later that it was still at 1 and step 23 would pay it. Both sentences were
written in the same commit series. Nothing was lying; the file simply had two
places to say the same thing.

## Eleven review findings, and what reading each one first changed

`N1`–`N3`, `N6`–`N8`, `N12`–`N16` of the 2026-09-04 review. Four of the eleven
turned out to be a different shape from the way the review described them, and
in each case the difference mattered.

### `N7`: the review named the wrong decoder, and the right hole

It says `Program.warnings` is "a fourth silent channel nothing reads". It is
not: `evt`'s warnings travel in `<stage>.script.json` and `stage_load.ts` has
put them in the feed from the beginning. The silent one is
**`CamFile.warnings`** — same idea, same shape, produced by the `cam/` decoder,
and read by `verify_phase6.py` alone, which runs over the *game directory* and
never over an export. So a stage whose `cam/` file had a bad descriptor
exported a bundle quietly missing those paths, and a camera that does not move
where it should reads as a gameplay bug.

Both decoders now feed one list in `stage_load.ts`, and `cam.json` carries
`warnings` from format 4.

The other half of `N7` was accurate and undercounted itself. Widening the
`except` regex from `Exception|BaseException` to **every** handler found 14
narrow ones; reading all 14 rather than trusting the count showed **three**
losing game data — a NaomiLib model that will not parse dropped from its
container, a `coli/` file parsed short going into the bundle short, and an
install with no `coli/` directory exporting a stage with **no collision at
all**, which turns every wall in it passable. The other eleven are answers
rather than failures: `classify()` failing to decompress a blob means the blob
is not compressed, and a `UnicodeDecodeError` while probing for a string is the
string test returning No.

The narrowness of an `except` was never the point — whether the handler *says*
something is — so the check now asks that of every handler, and a handler that
loses nothing says so with `# not-a-loss: <reason>` on the spot. Nine of those
were written this session and each one had to be read to be written, which is
the value of the marker.

### `N16`: exact by accident, and the accident is measurable

`dt * 60` is a float. `dt` is `frames * (1 / 60)`, and multiplying back is not
exact for **9 of the 241** tick counts a frame can carry — 31 comes out
30.999999999999996. The port is full of counters compared exactly because the
engine's own step by exactly one.

The fix needed no new API. `ticksOfSeconds` in `core/play_cursor.ts` already
rounds, already lives in `core/` so `render/` can reach it without a value
import across the layer line, and its own docstring already named this hazard.
`motion.ts` used it. Nineteen sites in `game/` and one in `render/` never
adopted it. A `verify_port` rule now says so, watched failing.

### `N12`: the cap bounded the leak and did nothing about the churn

The existing doc comment argued *for* the 256-entry cap and *against*
quantising the distance out of the label key. Both halves of that were right
about memory and wrong about cost: an actor crossing a metre boundary every
frame misses the cache every frame, so the cache ran at a 0% hit rate and
disposed 256 textures a second. A cache that never hits is an allocator with
extra steps. Five-unit buckets and `d≈` on the label; the cap stays, because it
is right whatever a future label puts in its text.

### `N6`: an explicit list has the opposite failure, so it is checked both ways

The digest globbed `web/src/bundle/*.ts`, so `stage.ts`'s loader was in it and
rewording a refusal string invalidated every bundle on disk. The loading half
moved to `load.ts` and `schema.SOURCES` names the seven declaration files.

But a named list can silently omit a new declaration file, which is a block of
the bundle **nothing checks** — worse than the glob and quieter. So
`verify_exporters.py` still reads the directory and fails both ways: a listed
file that grows runtime code, and a `.ts` that declares part of the bundle and
is not listed. Both watched failing.

`test/bundle.test.ts` asserted `names.length >= 8` — a count standing in for a
set, sized to the old glob. It failed on 7 and could not say what it wanted. It
names the seven now.

### Two defaults that were wrong, found by using them

**`export_player.py --all` built six of the twelve stage bundles.**
`--original` *added* Original Mode rather than selecting it, so the plain
`--all` everyone runs left the six Original stages carried forward from
whenever they were last built. The format bump then left them stale on disk,
indexed by a fresh manifest, and refused by the client — which is exactly the
failure the per-stage `format` exists to catch, arrived at by a default nobody
chose. Both modes now, unless `--arcade` or `--original` asks for one.

**And the export never said what it could not read.** The warnings travelled
and the player surfaced them, but the person who runs the export is the person
who can act on them, and they were only visible by opening the JSON afterwards.
There is a summary at the end now, printed **including the "none" case** —
"no warnings" and "I forgot to look" are the two readings of an absent summary
and only one of them is good news.

### `N1`, and a wrong assertion caught by running it

`Pacer`'s own doc comment lists its wakers and "a shot" is among them;
`onFire` pushed onto `g_shot_requests` and returned. The obligation was written
down and the call was missing, which is why nothing caught it — there is no
type for "this callback must wake the loop".

The first assertion written for it was wrong: it asserted the shot draws for
"a frame or two", copying the shape of the keypress case above it. A shot draws
for **17** frames, and correctly — `Player.wantsFrame` keeps asking while the
impact sprites and muzzle flash are in flight, because those ride wall time and
are a click's answer rather than a tick's. The property worth asserting is that
it *stops*. Watched failing with the wake removed.

### `N14`: read the field, and say what is still missing

`req.frame` was written on every request and consulted by nothing, so "an input
log for free" was half true. `ProcessShotRequests` resolves what is due and
leaves the rest queued. Live play never exercises the second half — a click is
stamped with the current `g_frame` and is always due — which is the point: the
line is inert now and load-bearing for a replayer that does not exist yet,
because that needs a `pickShot` a headless run can answer.

Which is also `N13`, now tagged: the hit spheres ride bones the *render* phase
poses, so a pick made at the head of tick *n* runs against tick *n-1*'s
matrices. Under `Harness.pump` nothing draws at all and the lag is every frame.
Both close the same way — the skeleton's forward kinematics in `game/`.

### `N3`, and why it was invisible

```ts
if (ran === 0) skipNoBundle("state");
process.exit(failures ? 1 : 0);
```

reads correctly and is not. Both files run checks *before* they need a bundle —
`state` has 29 — so a tree with no bundle and a real regression in those 29
printed the failure, then printed SKIP under it, and exited 3. Every machine
without game assets is that tree. `finishOrSkip` is one helper rather than the
same four lines twice, because the bug was that each copy looked right on its
own.

## Stage 1's rescue: a scale nobody applied, and a rotation with one sign wrong

Two bugs in one set piece, both `[proved]`, and the second is the trap this
repo's own skill warns about.

### The chase that could not be won

`?stage=1&mode=play&block=1&step=9&op=16` sits on `wait_enemies_alive <= 0`.
The civilian `0x18A8` (type 38) has one **child** in her descriptor tail — the
captor `0x18E8` (type 8, initial state 34 `WalkToTarget`, attack state 40
`WalkPastPoint`) — and nothing in the evt stream points at it, which is why the
script walker never sees these.

Neither state moves the actor. `ZombieStateWalkToTarget` (`FUN_0045A890`) turns
with `FUN_00409F90(obj, target.x, target.z, 0x1a0)` and tests the 2D distance
against `obj+0x1370`; the walking is the clip's, through
`SkeletonApplyRootMotion`. So the chase is decided entirely by two numbers in
the motion data:

    civilian  motion 386   21 frames @30   net -13.77   0.6885 / frame
    captor    motion 958   31 frames @30   net -24.00   0.8000 / frame

She flees at 0.6885 and he walks at 0.8000. The gap closes at 0.112 a frame,
and 14 units of it took **244 ticks**.

**The missing factor is the character's own size.** `ActorBuildSkinnedModel`
(`FUN_00410440`) writes `model+0x116C` from the character type and nothing
else, and `SkeletonApplyRootMotion` runs `MatrixScale(model+0x116C)` into the
same matrix it rotates the root delta through. A smaller character takes
smaller steps — the scale and the stride are one statement.

`[proved]` from the bytes at `0x00410451`: `MOVSX EAX,[ESI+0x60]` (the
character type), `ADD EAX,-0x1e`, `CMP EAX,0x1a`, `JA` to the 1.0 arm, then an
index table at `0x00410568` of `00 01 02 02 02 ...` over a jump table at
`0x0041055C` of `[0x410478, 0x410484, 0x41046c]` storing `0x3f19999a`,
`0x3f333333` and `0x3f666666`. So **type 30 → 0.6, type 31 → 0.7, types 32–56
→ 0.9, everything else → 1.0**.

The civilian is type 38 → 0.9; the captor type 8 → 1.0. The gap closes at
0.180 rather than 0.112, and the grab lands at **158 ticks instead of 244** —
inside its camera shot rather than four seconds after it.

**The ratio is the point, and it is not the ratio of the scales.** 0.9 looks
like an 11% correction; it is a 61% one, because the closing rate is the
*difference* of two nearly equal numbers and the correction lands entirely on
one of them. A first draft of the assertion said "exactly half" and was wrong
by that much; the check now names 1.6x and the comment shows the subtraction.

### `ActorPointIsAhead` had the forward rotation, not the inverse

After the maul, `ZombieStateWalkPastPoint` (state 40) walks to a point and
`ZombieScriptEnded` (`FUN_0045C8D0`) — the routine that **turns a captor on the
player** — fires when the point is behind. The captor entered state 40 already
past his point, walked away from it for ever, and `wait_enemies_alive` never
came down. "He just keeps on walking."

`ActorPointIsAhead` (`FUN_0045BC10`) builds `MatrixRotateY(-yaw)`, transforms
the world delta and returns whether the local z is positive. The port computed

    dz * cos(a) - dx * sin(a)          // wrong

`MatrixRotateY(t)` (`FUN_004A9AE0`) writes, on identity, `row0 = (cos, 0,
-sin)` and `row2 = (sin, 0, cos)`; the transform is D3D's row-vector form, so
`z' = dz*cos(t) - dx*sin(t)`. At `t = -yaw` that is

    dx * sin(yaw) + dz * cos(yaw)      // right

The port had written the **forward** rotation — the one `ApplyRootMotion`
correctly uses to take a delta from clip space to world — where the inverse was
wanted. The two differ only in the sign of the sideways term, so they agree
exactly for a point straight ahead or straight behind and disagree by the whole
of it otherwise.

**And `test/port.test.ts` asserted the mirror image.** Two checks encoded the
inverted predicate, one of them saying a captor "whose point is already ahead
turns on the player at once". They were not wrong about the code; they were
derived from it. The setups were fine and only the expectations were swapped,
and what comes out is the reading the state's own name asks for: a point you
have already walked past leaves nothing to walk.

`CivilianInFront` in `class10/step.ts` carried the same expression — the engine
inlines the same construction in `CivilianStepScript` — so it was wrong in the
same way and is now one shared `PointLocalZ`.

### What was checked and found faithful

Worth recording, because two hours went into ruling them out. The civilian VM's
wait conjunction in `CivilianStepScript` (`FUN_0048B1E0`) matches the port
**exactly**, including `0x40003fff` for "worth entering", `0x14000000` for
"blocked", and the absence of any test for bits `0x40000`, `0x100000` and
`0x200000` — which the shipped scripts use freely and which are genuinely not
waits. The port ignoring them is correct. `ZombieStateWalkToTarget` and
`ZombieStateWalkPastPoint` are otherwise transcribed correctly.

## WASD died in free roam because the *pacer* was asked the wrong question

`FreeRoam.update` flies on `t.wall` whether or not the transport is frozen, and
its own header says so — that was a deliberate change when it became a system.
But `Player.wantsFrame` tested `state.freeze` **before** `mode === "free"`, so a
frozen free-roam player was asked for no frames at all: a held W moved the
camera exactly one frame, the one the keydown waker bought, and then the loop
went back to sleep.

Measured at `?stage=1&mode=free`: 30 units of travel over 0.8s running, 0.3
units frozen. The same shape as `N1` — the obligation written down in a comment
and the call missing — and pausing to look around is the obvious way to use
free roam, so it was the common case that broke.

## The camera cut at block 3 step 3, and where that one actually stands

`store_six` (`queue_event` selector 0x60) stores three `(frame, path)` pairs
**and sets `g_evt_cam_override_valid`** (`0x009C6FD8`). Both row-5 camera hooks
open with

    if (g_cam_path_frames_left < 0 && g_evt_cam_override_valid)
        FUN_00403DB0(&g_camera_block);

and that routine re-seats `g_active_cam_path` and the path frame from the pair
`g_script_branch_var` selects, then evaluates the path into
`g_cam_path_eye` / `g_cam_path_target` — the **rail pose**, not the camera
block. The block reaches it by easing, which is the only way the block ever
moves.

The port had the pairs, as `branchPreview`, and neither the flag nor the
re-seat. So a shot that had run out held its own last frame instead of moving
to where the next one picks up. The shape shows in stage 1's slot 41:

    b3 s3 op34   501 -> 525   flags=2 (stashed)
    b3 s3 op35   555          store_six
    b3 s4 op 5   556 -> 655   live

and the same pattern one step earlier (265, store_six 270, then 271). Frames
526–554 are never played by anything; the override is what puts the camera
there to wait.

Implemented, and it turned a hard hold at 525 into an ease. **It did not close
the bug**, and the reason is worth writing down rather than leaving as a
half-claim: the aim eases at about a twelfth of the remaining angle a frame, so
22 degrees wants ~30 frames, and this join gets **three** — because
`g_enemies_alive` is **0** when `wait_enemies_alive 0` is reached. The
room-clear gate opens two frames after the shot ends, and the camera never gets
the fight it is supposed to ease through.

So the remaining cut is downstream of a liveness question, not a camera one,
and that is where the next session should start. Two further camera mechanisms
are named, `[proved]` and unimplemented, and may or may not matter once the
fight is real: `CameraEaseBlockEyeToPathPose` (`FUN_00402EF0`) eases the block
**eye** a sixteenth a frame while `g_camera_ease_eye` (`0x009C6F33`) is set, and
that flag is raised only by `EvtActionSetFlag15` — selector 0x15, which this
port lists as unmodelled.

**Two measurement mistakes made while finding this, both worth keeping.**
First: the look-at *point* is the wrong quantity. `TurnLookAtToward` turns a
direction and re-projects it, so the point slides tens of units along the ray
while the camera does not move — a "49-unit jump" that was 0 degrees. The
measure is the angle of `(target - eye)`, and `tools/lookat_live.mjs` uses it.
Second: both harnesses were skipping the fight. `player.mjs`'s own note says it
— with shooting off, `WalkerHost.aliveEnemies` answers null and every
live-enemy gate passes on the spot — and a camera measured across a fight that
did not happen measures nothing.

## The head that was documented as a blood spray

`ResolveHit`'s 1-in-4 headshot burst runs **three** routines at `0x00409790`
and this port had one of them:

    00409793  CALL 0x00407200   SpawnBoneHitSprite(obj, bone 2)
    004097a0  CALL 0x0040a130   <- this one
    004097aa  CALL 0x004098e0   ActorSwapDamagedPart(rec, 0, 2)

`docs/formats/combat.md` recorded the middle call as "a blood spray at
`obj+0x394`". It is not. `FUN_0040A130` is
`ActorAlloc(FUN_0040A230, 0x1A8)` — an **independent object with its own
per-frame routine**, seeded at the posed head point and carrying the head's own
asset slot out of `obj+0x32C`. So the port removed the head from the skeleton,
drew nothing in its place, and the doc said that was right.

`FUN_0040A230` is the whole of the physics, and every constant is in the
function: gravity `-0.0204167` (`0xBCA740DA`), an upward kick of
`(rand() % 20 + 1) * 0.01 + 0.3`, and a horizontal push of `0.2` along the
camera's own yaw — `MatrixRotateY(g_camera_block+0xD0)` applied to
`(0, 0, -0.2)` — so the head is always thrown **away from the viewer**,
whichever side the shot came from. Two spin rates, both `rand() % 0x800 +
0x800` BAMS a frame, and only the yaw takes a random sign. Then
`QueryGroundHeightAt` every frame, a bounce that keeps a quarter of the
vertical speed, a sound picked from the head model and the surface underneath
it, a settle once `|vy| <= 0.15`, and 120 frames of sinking at 0.04 before it
frees itself.

**The ground test is against the position the head is about to reach**
(`ground < y + vy`), not the one it is at — the difference between a head that
bounces and a head that falls through the floor on the frame it is moving
fastest.

Both routines are named now, `combat.md` carries the table, and the physics is
`game/effects/severed_head.ts` with `render/severed_heads.ts` drawing it on the
`ProjectileLayer` pattern: the port owns where the head is, the layer owns only
the node, and `update` and `resync` are one call.

Two port-shaped decisions, both declared. The heads are **plain records in
`G`** rather than allocations, because `game/` has a fixed pool and a snapshot
slice has to survive `clonePlain`; and they carry an `id` the engine has no
need for, because a head *is* its task pointer there and the draw happens
inside the routine that moves it. The launch point is the actor's origin raised
by a constant rather than the posed head bone — `[diverges]`, because the
skeleton is three.js's and `game/` cannot ask it for a bone position without
the host, and the head is moving within one frame anyway.

### What the sprite work needs, measured

The other half of the shooting effects is artwork the bundle does not carry,
and the `[open]` on it is now closed as a *question*: `DrawBloodSpray`'s 25
frames, slots `0x3A..0x52`, are `pol/common.bin` models **0–24**, which use
textures 1–25 — one per frame, a clean flipbook. Resolved through
`ExeTables.asset_slots()`, which the exporter already has.

`SpawnSpriteEffectFromParams` (`FUN_004073B0`) is the other sprite system, and
it is a slot **range** per kind rather than a model list. The whole table, read
out of the switch:

| kind | slots | frames | base scale | file |
|---|---|---|---|---|
| 1, 0x33 | `0x91A..0x92F` | 22 | 1.0 | common |
| 2, 0x34 | `0xDC3..0xDD1` | 15 | 1.0 | common |
| 3, 0x35, 0x52 | `0xE25..0xE33` | 15 | 1.0 | common |
| 5, 0x37 | `0x8F8..0x903` | 12 | 4.0 | common |
| 6, 0x38 | `0x904..0x919` | 22 | 1.0 | common |
| 0x41 | `0xDD7..0xE22` | 76 | 1.0 | water_hamon |
| 0x44 | `0xFD4..0x1031` | 94 | 1.0 | eff_dokan |
| 0x45 | `0x174A..0x1785` | 60 | 1.0 | eff_shop |
| 0x46, 0x4B | `0x94..0xA2` | 15 | 0.7 | common |
| 0x50 | `0x23A..0x248` | 15 | 1.0 | eff_2 |
| 0x51 | `0x54..0x62` | 15 | 1.0 | eff_2 |
| 0x53 | `0x125..0x13D` | 25 | 1.0 | eff_org5b |
| 0x5A, 0x5B | `0xAA4..0xAB6` | 19 | 2.0 | boss1q |
| 0x5C | `0xA87..0xAA3` | 29 | 2.0 | boss1q |
| 0x5D | `0xAB7..0xAD3` | 29 | 1.0 | boss1q |
| 0x61 | `0x1339..0x1356` | 30 | 1.0 | common |
| 0x62 | same | 30 | 1.5 | common |
| 0x63 | `0x91A..0x92F` | 22 | 5.0 | common |
| default | `0x904` | 1 | 0.1 | common |

Kinds 1/2/3/5/6 are the collision materials, `0x53` also seeds a random phase
(the rain variant), and `0x5A` recurses to spawn `0x5B` and `0x5C` alongside
itself. The distance law is two cases: kind `'S'` (`0x53`) scales by
`|z * -0.0285714|` out to -35, and everything except `'c'` (`0x63`) by
`z * -0.0667` out to -15 with a floor of 0.25. `params[6] != -1` overrides the
scale outright. Every range resolves to a real pol file, so none of it is
blocked on reading — it is blocked on **exporting the artwork**, which is a
bundle block, a `schema.SOURCES` entry and a `BUNDLE_FORMAT` bump.

## Every zombie in the game jogged, and half of them should sprint

`ZombieStateAttackRun` (`FUN_004554D0`) picks its clip with

    row[2 + ((obj+0x34 >> 0x1B) & 1)]

and states 14 and 15 index the same pair. The port had

    FirstBakedOf(obj, row, Run, RunAlt, Walk, WalkAlt)

— "the first of the pair this bundle carries" — which is **always** row 2,
because row 2 is always baked. The selector bit was never read.

The pair is not two takes of one gait. Measured on the shipped banks:

    char_adv02   row[2] motion 272   0.296 / frame     row[3] motion 264   1.289
    char_adv01   row[2] motion 1022  0.320 / frame     row[3] motion 968   1.000
    znebi2       row[2] motion 190   0.393 / frame     row[3] motion 179   0.731

Row 2 is a jog and row 3 is the sprint. Across all six stages the split is
**210 jog to 192 sprint**, and the sprinters close **2.06x faster** on average.
So 48% of the class-0x30 spawns in the game were running at less than half the
speed the placement data asks for, which is exactly "they only ever walk to the
player".

**Nothing in the image ORs that bit.** `search_instructions` over `+0x34` finds
four `TEST`s and no `OR`, and the four writers of the whole word are
`MOV [reg+0x34], 0x80000001` in the prop placers. It arrives from the **spawn
record's own flags word** through `ActorInitFlags` (`FUN_00408970`) — so which
gait a zombie uses is placement data, decided per spawn, not a runtime state.
That is also why "even when shot" made no difference: being shot was never
going to change it.

Two things worth keeping about how the fallback hid this. It was written for
"a skeleton that has no run clip of its own, which is `znchain` and the two
`znebi`" — and the measurement says **zero** of the 402 spawns lack a run
clip, so the fallback never fired for the reason it was added and only ever
served to discard the selector. And `FirstBakedOf` cannot tell "the bundle is
missing this" from "the data chose the other one", which is the shape of the
bug: a lookup that answers a different question from the one the engine asks
will agree with it most of the time.

`ZombieRunMotion` is that expression, named once and used by all three states,
`[port-only]` because it is one line out of `ZombieStateAttackRun` rather than
a routine of its own. It keeps a fallback for a row with nothing baked, which
is a property of the bundle and not of the engine.

Also read while there and folded into the annotation: `ZombieStateAttackRun`
starts its clip at a **random frame** (`rand() % g_motion_play_length[motion]`,
fade 10) so a crowd does not march in step, and rolls `rand() & 0xFF < 4` each
frame for a 1-in-64 shout when `obj+0x136C` carries both `0x2000000` and
`0x1000000`.

## 2026-09-04 — Fog: the right numbers pushed through the wrong colour space

Prompted by "are you SURE you've ported the fog settings correctly … especially
the colours - they seem really off". Yes to the numbers, no to the colours, and
the reason is one defaulted argument.

`Color.setRGB(r, g, b)` defaults its fourth parameter to
`ColorManagement.workingColorSpace`, which is **linear-sRGB**. The port handed
it the game's D3DCOLOR bytes over 255, so it recorded them as light-linear
values, and `outputColorSpace = SRGBColorSpace` then encoded them a second time
on the way to the screen. Stage 3's `RGB(10, 10, 20)` fog was displayed as
`RGB(56, 56, 79)`. The error is worst exactly where this game lives — the
scripts' fog colours are overwhelmingly dark blues, `(10,10,20)`, `(0,0,37)`,
`(12,10,8)`, `(0,25,52)` — because the sRGB curve is steepest near black:
four to five times too bright at the dark end, one time at the light end. It
also flattens the hue, a 2:1 blue-to-red ratio becoming 1.4:1, so the fog read
as grey haze rather than as night.

Three findings, in the order they were read out of the exe:

* **`SetFogColour` (`FUN_004ABDD0`)** — `D3DRENDERSTATE_FOGCOLOR`, found by
  searching for `PUSH 0x22` and noticing the hit sat immediately before
  `SetFogRange`, which had been read months ago. **`PushSceneFogColour`
  (`FUN_0040D5B0`)** packs it from three integer globals, now
  `g_scene_fog_r/g/b`. `FUN_00460250`'s seeding of those *and* of a mirrored
  float array at `0x009C89E4 + channel*0x10` is what independently confirms the
  light-block channel numbering the port had assumed.
* **The blend space.** DX7 fog is `f·C_pixel + (1 − f)·C_fog` on framebuffer
  bytes; there is no sRGB write path in the API. three.js mixes in linear and
  encodes afterwards, which is a different sum — about `10/255` too bright over
  a dark surface at half fog. The fog chunk now encodes, mixes and decodes.
* **Planar, and provably.** `InitD3DDeviceAndTextureStages` prefers
  `FOGTABLEMODE = D3DFOG_LINEAR` and only falls back to `FOGVERTEXMODE`, so it
  is per-pixel table fog; `RANGEFOGENABLE` is set nowhere in the binary and
  does not apply to table fog anyway. The port's default was `radial`, which is
  a **`[diverges]`**, and the UI already labelled the option it was not using
  "planar (as the game)" — the doc comment had even said D3D defaults to planar
  and then defaulted to the other thing.

**What this cost, and the shape of it.** The range doubling in `SetFogRange`
was read carefully and written up at length; the colour was three components
divided by 255 and never questioned, because dividing by 255 *looks* like the
whole job. The lesson is not "check colour spaces" but that the two halves of
one push got completely different amounts of attention, and the half that got
none is the half that had a silent default in it. `getHexString()` reports in
sRGB, so `SceneFog.describe` round-trips and the assertion is a one-liner —
available the whole time, never written.

**A wrong turn worth recording.** `annotate.py` accepted a comment containing
newlines and wrote them straight through, splitting two rows into 24 lines of
broken TSV, and it printed `added …` for both. Reverting with
`git checkout -- ghidra/annotations/functions.tsv` was the wrong instrument on
a file a peer session also writes; it happened to cost nothing only because
that peer had committed thirty seconds earlier. `annotate.py` now refuses a
name or comment containing a tab or a newline — this is `L?`-shaped: *a tool
that prints success has not necessarily written a valid file.*

## 2026-09-04 — Scene lighting, and a correction to the entry above

Same session, same question asked of the light instead of the fog. Three
findings, one of which corrects something written an hour earlier.

**`SetLightingDefaultSingle` had been transcribed wrong, and the port was built
from the transcription.** `docs/formats/materials.md` gave it as

```c
SetRenderState(D3DRENDERSTATE_AMBIENT, pack_argb(ambient));
light.diffuse = light_colour * 1.4;
```

and the disassembly says

```c
t = light_colour * ambient;
SetRenderState(D3DRENDERSTATE_AMBIENT, 0xFF000000 | pack(t * 255));
light.diffuse = t * 1.4;
light.ambient = light_colour * 0.3;      /* this one alone escapes `ambient` */
```

So **channel 10 is a master brightness, not a separate ambient term** — it
scales the directional light too — and the global ambient is **tinted by the
light colour**, never a neutral grey. The port had `diffuse = colour * 1.4`
(twice too bright at the engine's own default ambient of 0.5) and
`ambient = <scalar> + colour * 0.3`, which against the engine's `(1.0, 0.2,
0.1)` light gives `(0.80, 0.56, 0.53)` — near-white where the engine has a deep
orange `(0.60, 0.02, 0.01)`. That is not a subtle difference and it is now four
assertions in `test:render`.

Why it was wrong: the decompiler **drops every FPU argument** in this routine —
`__ftol()` appears with no arguments and the operands come through as
`unaff_EDI`/`unaff_ESI`/`unaff_EBX`. The earlier reading took the shape from
the decompiler and the two scalars from the only constants it *did* show. This
is the trap already in `LESSONS.md`, applied to a routine that looks harmless
because it is short.

**The colour space, again, and why a multiplier converts.** The light colour is
the same kind of framebuffer-encoded quantity the fog colour is; D3D multiplies
it against gamma-encoded texels. Matching `tex^γ · L' == (tex · L)^γ` gives
`L' = L^γ`, so the linear-space equivalent of a gamma-space multiply is the
multiplier put through sRGB→linear — the *whole* product `colour · ambient ·
1.4`, since the scalars are gamma-space scalars too. Exact for the
multiplicative part; `N·L` stays three.js's, which the module already declared.

**The correction.** The fog entry above says `FUN_00460250` seeds a mirrored
float array at `0x009C89E4 + channel*0x10` "which is what pins the channel
numbering". It does not, above channel 4. That array is `g_light_tween_block0`
and it has **nine** slots for eleven channel numbers, because the two alias
channels (5 = all fog components, 9 = all light components) have none — so its
index is a compacted one and coincides with the channel number only up to 4.
The fog conclusion is unaffected, because fog is channels 2/3/4, but the
*reasoning as stated* would have put every channel from 6 up one slot out.

`ApplyLightChannelOperand` (`FUN_0040B3F0`) is the thing that actually pins it:
a `switch` on the channel index writing named dword offsets into the block. It
confirms the map the port already had. **This is the "data is for verifying,
never for forming" rule catching me in the act** — a channel map was read off a
seeding function's addresses, it happened to be right where it was checked, and
it was asserted for the range where it was not.

## The head that came off but never flew: three bugs behind one symptom

Reported as "still no headshots causing head to go rolling", then "the head
just seems to fall off, not fly off". The physics was right the whole time;
nothing else was.

**1. `boneSlot` is empty until something swaps a part.** `ResolveHit` read the
head's model with `obj.boneSlot[bone] ?? 0` and skipped the spawn when that was
0 — which is the *common* case, because a clean headshot kill has swapped
nothing. The engine reads `obj+0x32C`, the bone's current model whether or not
anything has touched it, so the port needs the skeleton's own pristine slot as
the fallback. `CharacterBone.slot` is it.

**This is the one worth remembering.** The physics had four assertions and all
four passed, because they drove `SeveredHeadUpdate` directly. Not one of them
went through `ResolveHit`. **Testing the mechanism is not testing the trigger**,
and a mechanism with no caller is exactly as useful as no mechanism.

**2. The pristine head model was in no rig the client could clone from.**
`CharacterLayer.cloneSlot` looks only at `goreParts`, built from nodes tagged
`gore_`, and `gore_entry`'s `want` set is gore variants, held slots and thrown
weapons. A head that had never been shot draws its *undamaged* model, and that
slot is named by the skeleton as a bone rather than by slot — so `cloneSlot`
returned null, the render layer skipped it, and the head came off the body with
nothing drawn in its place. Char type 8's head is slot 8016 and the exported
gore set was `[8013, 8015, 8017, 8018, ...]`: every damaged variant and not the
original.

**3. And the gate above it enumerated a subset of what the body emitted.**

    if ct in chars and (chars[ct].gore or chars[ct].held_slots)

A character type with neither got no rig at all, so adding the head slot to
`want` still produced nothing for 108 of the type/stage pairs. The comment
directly above that line records the *previous* time this happened — "gating on
gore left every held item with nothing to clone from" — and adding
`held_slots` to the condition fixed that instance without fixing the shape. The
gate now calls `gore_entry` and lets it answer, since it already returns None
when it has no parts. A gate that lists what the body will want is a second
source for one fact, and it will be wrong again the next time the body grows.

Also closed while there: the launch point is now `GameHost.boneWorld` — the
posed head bone, which is what `obj+0x394` is in the engine — rather than the
actor's origin raised by a constant. `ResolveHit` already held the host, so the
`[diverges]` was never necessary; the constant survives only as the fallback
for a host with no scene.

And one gate that looked real and is not. `ResolveHit`'s head-pop condition
includes `CMP word ptr [EDI + 0x3b8], 1 / JG skip`. `obj+0x3B8` has **exactly
one reference in the whole image**, this read, and `FUN_004A73D0` zeroes every
actor from `obj+0x34` to the end of its block at allocation — so it is 0 for
the life of every actor and the jump can never be taken. Not modelled, and
deliberately not given a field: naming it would be naming where it sits. The
character-type exemption beside it (3, 0x12, 0x18) is real and is ported.

Trajectory, measured from the launch: apex 4.7 units above the head bone at
frame 20, first ground contact at frame 60, settled at 80, 15.6 units
travelled. It flies.

---

## Session — a branch is not a question, and it is cleared every step

**The task.** Port the branching logic the event tables drive, and keep a
1.5-second window for a viewer to override it. The player was pausing at every
branch point and asking, which was never what the game does.

### What the engine actually does

`g_script_branch_var` (`0x009C88A4`) is the whole mechanism.
`EvtAdvanceStepOrRoute` reads it as `next[g_script_branch_var]` for a `kind == 1`
route record, and **nothing in the script writes it** — all sixteen writers are
gameplay code. There is no pause, no countdown and no question: the value is
whatever gameplay left behind at the instant the step list ran out, and `0` is
the answer when nobody did anything.

**The reading that mattered was the reset.** This project had it, in four
places, as *"reset to 0 on every block change"* — `docs/formats/evt.md`,
`docs/re/addresses.md`, `web/README.md` and the walker's own doc comment. It is
wrong, and the annotation in `functions.tsv` had the right pseudocode all
along:

```c
if (EvtGetBlock(scene, block) == -1) { ...scene over...; return; }  /* no reset */
pc = EvtGetStep(scene, block, step);
branch_choice = 0;                     /* every STEP advance, not every block */
```

The store is on the normal return path, so it fires whether or not the step
list ran out. That is a much stronger claim, and it is what makes the shipped
data legible: **fourteen of the sixteen branch blocks that hold a trigger spawn
it in the block's last step**, because a write made any earlier would be wiped
by the next step boundary. The scene-over path returns before the store, so a
scene ends with the last value standing.

### Who writes it

Reachable in arcade: `CivilianRunScript`'s op `0x19`; `FUN_00451980`, class
0x21's live state, on the last part being shot off; `PlaceGenericProp` cases
`0x0E`/`0x13`/`0x19` at spawn time; `FUN_00468180`/`FUN_00468F00` on a prop's
first hit; `FUN_00469AE0` in block `0x17`.

Everything else — nine sites — writes **2**, and **every one of them is behind
`g_GameMode == 1`**. So the third road out of a three-way branch is an Original
Mode road and arcade only ever sees 0 or 1. That one fact explains a shape that
had looked arbitrary: route records whose live slots are 0 and 2 with a hole at
1 are the original-mode forks.

### Op 0x19 was two functions from being read

`docs/formats/civilians.md` had it as `SetGlobalA`, `DAT_009C88A4`, `[open] —
the reader has not been read`. The reader is `EvtAdvanceStepOrRoute`, which
this project named a long time ago. Ten instructions of disassembly settle it:

```
0048BECE  668b4e04        MOV CX, word ptr [ESI + 0x4]
0048BED2  83c608          ADD ESI, 0x8
0048BED5  66890da4889c00  MOV word ptr [0x009c88a4], CX
```

Two dwords, an **s16** store. Eleven of the 136 shipped civilian streams run
it, all eleven pass `1`, and every one of them puts it after the `SetOnShot 0`
that makes the civilian unshootable — that is, after she is safe. **Rescuing a
civilian is how the game branches**, and it is the only writer that works in
arcade whose class the port already runs. Renamed `SetRouteBranch`.

### The check

`tools/verify_branches.py`. For every branch block that spawns a trigger, every
value that trigger can write must name a **live** slot of that block's own
route record. Fourteen blocks, all clean, and it fails when made wrong:

* flip the class 0x52 subtype table (`{2:2, 3:1, 4:2}`) and stage 2 block 18
  writes a 1 into `next = [19, -1, 33]`;
* drop `CatBranchTriggerUpdate`'s `g_evt_block_index == 8` gate and stage 2
  block 5 writes a 2 into `next = [21, 6, -1]`.

Stage 4 block 10 is the case that carries the whole reading on its own:
`next = [12, 18, 19]`, three live slots, with one subtype-3 and one subtype-4
critter in it, writing 1 and 2. The two alternates and the two triggers line up
exactly.

### The port

* `G.g_script_branch_var`, with `Walker.branchChoice` an accessor over it — the
  same arrangement `g_evt_step_index` already had, and for the same reason: the
  engine has one global and both halves of the game touch it.
* `advanceStepOrRoute` clears it on the in-block step return, which it never did.
* `CivilianOp.SetRouteBranch` writes it, truncated to s16 because the store is
  `MOV word ptr`.
* `takeBranch()` with no argument takes `next[g_script_branch_var]`. It used to
  take `Math.min(...targets)`, and before that a seeded RNG draw.
* The choice is **latched** when the branch is raised. The pause is the port's,
  not the engine's, and gameplay keeps running during it; reading the global
  late would let 1.5 s of play change a decision the engine had already made.
  Marked `[diverges]` on the pause itself, which is what the user asked for.
* The bar marks the route the game is taking and labels the countdown
  `taking → N in 1.2 s`. The other buttons are an override.

### Two things this broke, and both were the check working

**`seek.ts` steered once per block.** It set `branchChoice` on block entry and
relied on it surviving to the route decision. With the reset in, three seek
assertions failed at once. The graph search stays per block; the assignment is
now per instruction.

**The unattended route through both stages moved**, because `Math.min` and
`next[0]` disagree at the first branch of each:

```
stage 1   0 -> 1 -> 10 -> 3 -> 4 -> 6 -> 11 -> 14 -> 15 -> 16 -> 17
stage 2   0 -> 11 -> 12 -> 13 -> 14 -> 15 -> 16 -> 35 -> ... -> 42
```

That is the **failure** road through both, and it is the right answer for a
harness that rescues nobody. It also closes `PLAYER_HANGS` item 16, which had
wondered how a recorded stage-2 route reached block 30: block 30 is slot 2 of
`next = [4, -1, 30]`, and no arcade writer produces a 2.

### What is not ported, and why

The other fifteen writers. `FUN_00451980` (class 0x21) is the one that costs
something real — it is stage 2 block 0's trigger, so the port cannot take that
branch at all today, and it is a whole enemy class rather than a branch
mechanism. `Class52BranchTriggerUpdate` and `CatBranchTriggerUpdate` are read
and named but Original-Mode-only. The class 0x41 prop writers are reached
through the constructor table rather than the spawn class and are mostly
original-mode too. All sixteen are listed under `g_script_branch_var` in
`globals.tsv`.

### A stale `[open]` closed on the way past

`docs/formats/spawns.md` still had class 0x53's species `[open]`, asking for
character type `0x1A` to be resolved through the model pipeline. That was done
long ago by a different route: `g_character_skeletons` puts all eighteen of
type `0x1A`'s nodes in `cat.bin`, and three other files in this repo already
call it the cat. Named `CatInit` and `CatBranchTriggerUpdate`; the section is
kept for its reasoning with the verdict noted on top.

### Next actions

1. **Port class 0x21** (`FUN_00451720` / `FUN_00451860` / `FUN_00451980`), the
   held-hostage enemy. One spawn, stage 2 block 0, and it is the only thing
   standing between the port and stage 2's first branch. It pays a rescue,
   +400, and both enemy counters.
2. `PlaceGenericProp`'s three spawn-time writes are cheap and class 0x41 is
   ported — cases `0x0E`, `0x13` and `0x19`. Worth checking which types the
   port's pool actually constructs before doing it.
3. `docs/formats/spawns.md`'s class 0x52 section still calls the species
   `[open]`; unlike the cat, that one really is.

---

## Session — all sixteen writers of the branch variable

**The task.** The previous session ported one writer of `g_script_branch_var`
and listed the other fifteen. This is the other fifteen: read, named,
annotated and ported.

### The shape, once they are read side by side

Sixteen writers, and they are one mechanism written sixteen ways. Nine are
class-0x41 props, one is a class-0x44 object, three are actor classes and one
is a civilian opcode; the last two are the resets.

**The pairing that makes it legible** is `PlaceGenericProp` cases `0x0E`,
`0x13` and `0x19` with `PropUpdateType14`, `19` and `25`. The constructor
**seeds** the variable with the descriptor's own `+0x11C` at spawn time and the
update writes `1 - +0x11C` on the first hit — so **the descriptor names the
default route and shooting the prop takes the other one.** The branch is
authored in the level, not in the code. Reading the constructor and the update
apart is why this looked like two unrelated writes to the same global for as
long as it did.

**Every write of `2` in the program is behind `g_GameMode == 1`.** Fourteen of
the game's thirty-three branch records fill slots 0 and 2 with a **hole at 1**,
and every one of those has an original-mode trigger standing in it. The other
nineteen have a live slot 1, which is what arcade's writers say. That one fact
turned a table that had looked arbitrary into a rule.

Two writers are unlike the rest. `PropUpdateType69` does not choose a route, it
**promotes** one — `flag 0x23 && var == 1 && already shot` turns a rescue's 1
into the story route's 2. `CatBranchTriggerUpdate` is the only writer that
tests the variable is still 0, so it will not overwrite an answer already
given.

### The check, and what it can and cannot see

`tools/verify_branches.py` grew a second half. For every prop write that lands
in a branch block, the value must name a **live** slot of that block's own
record: **31 of 31**, no exceptions. Watched failing three ways — flip the
class 0x52 subtype table, drop the cat's block gate, or turn
`PropUpdateType25`'s 1 into a 2.

Said plainly, what it does **not** discriminate: types 14 and 19 write
`1 - obj+0x11C` and both shipped spawns carry 0, so writing `+0x11C` instead
would give 0 — also a live slot in both their blocks. The subtraction is proved
by the disassembly and not by the data. That is in the file's docstring.

Three cases carry the whole reading on their own:

* **Stage 4 block 10**, `next = {12, 18, 19}` — three live slots, and exactly
  one class-0x52 sub-type 3 and one sub-type 4 standing in it, writing 1 and 2.
* **Stage 2 block 8** — of the four cats in the game, only the one in block 8
  carries a sub-type above 1, and block 8 is the only block the routine
  answers in. The gate and the data agree without being told to.
* **Stage 4 block 0** — one sub-kind-9 fragment placement, which
  `g_class41_fragment_counts[9]` says builds **two**, and the routine wants
  `g_branch_prop_shot_count` to reach exactly 2.

### Four things that were wrong and are now not

* **`obj+0x1F4` for a class-0x41 placer is the s8 at `desc+0x24`**, and
  `desc+0x25` beside it is the constructor type. A 16-bit read there returns
  both, which is how the first export gave chain groups of 6144 and sub-kinds
  of 10250. Caught because 6144 is 0x1800 and 0x18 is 24, the constructor.
* **`CHAR_TYPE_RULES` documented a `("desc24",)` form that `resolve_spawn` had
  no arm for.** Class 0x21 needed it — opcode 0x09 copies `(s8)desc+0x24`
  straight to `obj+0x1F4` — and without it the rescue target had no character
  type, so the exporter dropped it and the port could not build stage 2's first
  branch at all.
* **`PlaceStoryModeSwitch` writes `obj+0x11C` as the literal 1.** It is not a
  lifetime for that object, and `PropExpireByStepLifetime` would have retired
  every switch in the game one step boundary after it was placed — one step
  before any of them could answer. `obj+0x2A4` names the flag that removes it
  instead.
* A nested `/* ... */` inside a `/** ... */` block, **twice**, in two different
  new files. Same trap as the lighting session. It is now three.

### What is ported and what is not

Every one of the sixteen writes, with its gates. The routines they live in are
**not** ported past that: the forty fragments, the hinge curves, the flights,
the fall physics and the draws are all still absent, and each function's doc
comment lists what it still owes. That line is deliberate — `class41/
generic.ts` already declares the generic props inert, and this narrows that
divergence rather than inventing a new one. A prop that swings correctly while
sending the player down the wrong road is worth less than one that stands still
and routes right.

The counter increments of `PlaceGenericProp` cases `0x0E`, `0x13` and `0x19`
are deliberately left out. Their give-back is in the update routines, which are
ported only as far as the branch arm, and counting an enemy in with no way to
count it out is how a `wait_enemies_alive` gate deadlocks a stage. This project
has a file of those.

**Class 0x52 is ported and unreachable.** Its logic, its per-subtype table and
its mode gate are all here, but the class draws an asset slot rather than a
character, so the exporter has no geometry for it and `render/`'s shot test —
which walks character bones and prop nodes — can never reach one. That is a
renderer and exporter gap, not a branch gap, and it is the only one of the
sixteen the port cannot fire.

### Next actions

1. **Give class 0x52 a model.** It wants an asset-slot actor the exporter can
   place and the renderer can hit-test, which is a shape neither has. Three of
   the ten spawns are triggers, all Original Mode.
2. `g_original_item_slots` is never filled: the pickup path (`FUN_00475E40`)
   is unported, so the three key-gated routes are unreachable — correctly, for
   a player who never found the key, but not for one who did.
3. The routines these writers live in. `PropUpdateType40`'s forty fragments and
   `StoryModeSwitchUpdate`'s hinge curve are the two most visible.

---

## Session — the mouse, and an actor that is one sphere

**The task.** The previous session ported all sixteen writers of
`g_script_branch_var` and reported one of them unreachable: class 0x52's
trigger had its logic, its table and its mode gate, and no way to be shot. The
report called it a renderer gap. This closes it.

### The species was in the slot table all along

`MouseInit`'s draw slots are `0x1385 + rand() % 10`, and
`ExeTables.asset_slots()` maps `0x1385`..`0x138E` to **`mouse.bin` entries 0
to 9**. So the ten values that looked like a random model are the ten frames
of one animation strip, and the class is a **mouse** — settled by an asset
filename, which is one of the two name tables this project trusts, exactly as
`cat.bin` settled class 0x53 last time.

`docs/formats/spawns.md` had the species `[open]` "because the class plays no
sound". It does not need to make a sound; it needs to be drawn from a named
file, and it is. Renamed `MouseInit`, `MouseWanderUpdate` and
`MouseBranchTriggerUpdate`, and `SpawnClass.Critter` is `SpawnClass.Mouse`.

The strip also explains the class. `sub+0x24` and `sub+0x22` are the first and
last slots, `sub+0x20` the one being drawn, and every moving arm advances and
wraps it. A wanderer starts on `rand() % 10` so a row of them does not run in
step; the trigger pins it to frame 0 until it is shot and then runs it while
fleeing.

### An actor with no skeleton is one sphere

The gap was never really the model. It was that the port's shot test had one
arm and the engine has three:

```c
ProcessPlayerShots:  (obj+0x34 & 0x10) ? ShotTestMesh : ShotTestSphere

ShotTestSphere:
  if (RayTestSphere(player, obj+0x70, obj+0x74, obj+0x78, obj+0x124) > 0) {
      if ((obj+0x34 & 0x80) && g_character_skeletons[obj+0x1F4]->nodes > 0
          && !(obj+0x34 & 0x8000))
          ShotTestSkeleton(obj, player);        // bone by bone
      else
          ...the whole actor is one candidate...
  }
```

The **else-arm** is the whole hit test for a class with no skeleton, and
`MouseInit` sets `obj+0x124 = 2.0` and nothing else. `docs/formats/civilians.md`
had already written the fork down for class 0x10; nobody had noticed it meant a
class could be shot with no bones at all.

So: `Actor.hitRadius` (`+0x124`), a `render/slotmodels.ts` that clones the
model per live actor and offers exactly that sphere, and one more source in
`pickShot` beside the props. `render.test.ts` drives it against a hand-built
template rig: a ray through the mouse hits, one further off than the radius
misses, one already past it misses, and a radius of zero is not in the test at
all. Watched the radius check fail with the comparison widened.

**A bug found while wiring it.** `pickShot` did not update `bestT` after taking
a prop, so a third source compared against the *bone* distance rather than the
nearest hit so far. With two sources it could not show; with three it would
have let a slot actor behind a barrel take the shot.

[diverges] The port still does **not** test the bounding sphere first for a
skinned actor — it goes straight to the bones, where the engine rejects the
shot outright unless it is also inside `obj+0x124`. Changing that would alter
every zombie hit in the game and wants its own measurement. Recorded in
`render/slotmodels.ts` beside the routine that says otherwise.

### Three layers had to move, and none of them had to bend

* **exporter** — `actor_slot_entry` emits a hidden `slots_actor` rig, the same
  shape `breakable_slot_entry` has had for the props. And `resolve_for_stage`
  stopped dropping class 0x52: its `identified` gate is about **geometry**, not
  about the placement, and the port needs the descriptor tail whatever the
  renderer can do with it. The escape is one named frozenset, not a hole —
  reading `desc+0x24` as a character type for every class once "identified" 962
  of 1225 spawns, most of them as `char_adv02`.
* **`game/`** — `SpawnSlotActors`, beside `SpawnPropContainers` and for the
  same reason: the port's ordinary spawn path runs through the character pool,
  an actor appears when a skinned hierarchy is ready for it, and a class with
  no character type never gets one.
* **`render/`** — the new layer. Two lifetimes, as in `breakables.ts`:
  templates belong to the stage, nodes follow `G.g_object_list`.

No layer rule was bent to do it and none needed to be. `render/` reads engine
state and owns nothing, which is exactly what this layer does.

### `CHAR_TYPE_RULES` documented a form the code had no arm for

`spawnres.CHAR_TYPE_RULES`' docstring has named a `("desc24",)` form since it
was written — the opcode-0x09 path, where `FUN_004088A0` copies `(s8)desc+0x24`
straight to `obj+0x1F4`. `resolve_spawn` had `literal` and `tail` and no
`desc24`. That was found last session while porting class 0x21 and is written
down here because a documented form with no implementation is a lie a reader
cannot see through.

### What this does not do

The mouse is drawn as a static clone per frame rather than as one node whose
material changes, which is a clone per frame for a running mouse. It is ten
small models and there are at most four alive; if it ever matters, the fix is a
node per actor with ten children and a `visible` flip.

`verify_parity` — a peer's check, added to the working tree while this was in
progress — is **red**, and correctly: it compares the Python exporter against a
TypeScript one still being written, and this session changed the Python side.
Four more placements, one more rig, ten more meshes in stage 1. The TS mirror
has to catch up; that is a hand-off, not a failure.

### Next actions

1. `g_original_item_slots` is still never filled — `FUN_00475E40`, the pickup,
   is unported — so the three key-gated branch routes remain unreachable.
2. The sphere-first ordering above, measured rather than argued.
3. `MouseWanderUpdate`'s subtype 1 draws through
   `SubmitSlotWithSceneLightArray` where subtype 0 uses `AssetDrawSlot`: the
   same model, lit or not. `render/slotmodels.ts` draws both the same way.

---

## Session — a prop is a sphere, and never a model

**The task.** The port picked a prop by the **bounding box of its drawn node**.
That is not a small approximation of the engine's test; it is a different test
with a different precondition, and it left nine route-branch triggers
unreachable — three of them because their routine draws no static model at all.

### What the engine does

```c
ProcessPlayerShots:  (obj+0x34 & 0x10) ? ShotTestMesh : ShotTestSphere

RegisterForShotTest (FUN_00405160):
  if (!(obj+0x34 & 0x8000) && ((obj+0x34 & 0x10) || obj+0x78 <= 0.0))
      g_shot_test_list[n++] = ...

ShotTestSphere (FUN_00404630):
  if (RayTestSphere(player, obj+0x70..0x78, obj+0x124) > 0) {
      if ((obj+0x34 & 0x80) && skeleton[obj+0x1F4]->nodes > 0) ShotTestSkeleton;
      else  ...the whole object is one candidate...
  }
```

A prop has no skeleton, so it is always the else-arm. Geometry never enters it.

### Twenty-four routines, read by four agents in parallel

Each routine builds its own shot point at its own tail, and **they all differ**.
The findings that a single general rule would have got wrong:

* **Type 7 registers 57 units below its origin**, against a radius of 12.
* **Type 11's draw orbits its origin and the sphere does not.** Same for type
  75, whose model flies a camera path while the sphere stays at the spawn
  point, and for type 73, whose draw adds `+0x1C8` to z and whose shot point
  does not. Three separate places where the visible thing and the shootable
  thing are not in the same spot, in the engine, on purpose.
* **Type 74's rise is a function of its own radius**: `r · 0.5 − 2`.
* **Type 57 never reads its own position.** It draws at fixed world
  coordinates and registers one of them raised by 2.84.
* **Type 40's rise is picked from the draw slot, not the sub-kind** — a chain
  of four overrides. Sub-kind 9, the route-branch pair, lands on 8.0.
* **Type 25 draws nothing and has a radius of 12**, and one scoring hit sets
  `obj+0x34 |= 0x44000000` — bit 26 removes it from the shot test for good.
  That was the only branch in arcade mode the port could not reach.

And two placement facts the port had wrong. `PlaceFragmentProps` puts
sub-kind 9's pair at two table positions **41.683 apart**, not both at the
placer; `PlaceChainSegments`' twenty links each hang 1.5 below the last, so the
chain covers thirty units of drop rather than being twenty spheres in one spot.

### The thing that stayed shut, and why

**`StoryModeSwitchUpdate` never writes `obj+0x70..0x78` at all.** It captures
its draw matrix into `obj+0x150` and calls `RegisterForShotTest` anyway.
`PlaceStoryModeSwitch` then decides which consumer sees it from the
descriptor's `+0x08`: `-1` gives the sphere path with a centre nothing ever
wrote — which, because `RayTestSphere` is a perpendicular distance with no
divide, makes the switch answer **any shot fired anywhere on screen** — and
anything else sets bit 4 and sends it to `ShotTestMesh`.

**All nine shipped switches take the mesh path.** So the quirk is real and
unreachable, and the five branch records those switches answer are still shut:
they want a ray-versus-mesh test the port has not got. That is the next job and
it is a different one.

### What it bought, measured

| | before | after |
|---|---:|---:|
| Branch records fully reachable | 18 of 33 | **23 of 33** |
| ...in arcade | 28 of 33 | **29 of 33** |

Arcade is **complete**: the four records still short there are ones the engine
cannot reach in arcade either — one is a mouse, which is Original Mode's, and
three are stage 6's, which have no writer anywhere in the binary.

The ten still shut in Original Mode: five want `ShotTestMesh`, two want an
Original Mode key the port never fills because the pickup is unported, and
three are stage 6's `[open]`.

### Wrong turns

* I assumed the shot point was the prop's origin for every type and started
  writing it that way. Type 7 alone would have put the sphere 57 units off.
  Fanning out and reading all twenty-four was the only thing that would have
  found that; a spot check of two or three routines would have "confirmed" the
  wrong rule, because eight of the twenty really are a plain zero.
* I assumed the story switch would fall out of the same fix and said so in the
  file comment before checking the shipped data. It does not: every switch in
  the game takes the other path. The comment is corrected and the measurement
  is in `docs/formats/spawns.md`.

### Next actions

1. **`ShotTestMesh` (`FUN_00404A00`)** — the volume test at `obj+0x14C`. Five
   branch records and nine switches want it. The exporter would have to carry
   the mesh; `render/` already has `coli` geometry to test against.
2. `g_original_item_slots` is still never filled: `FUN_00475E40`, the pickup,
   is unported, so two more routes stay shut.
3. Stage 6's three branches have no writer among the eighteen. Either one was
   missed, or they are answered by something outside the cross-reference graph.

## Session — the shot effects, and what was never leaving the gun

*2026-09-06.* "Fully port and implement the shot effects... also when shooting
a zombie the shot effect snaps to the bone centre rather than where the shot
was... we're missing blood splatter/sprites, where are all these?"

### Where they were: `pol/common.bin`, all along

`ExeTables.asset_slots()` maps `0x3A..0x52` to `common.bin` entries 0 to 24.
That is the blood. `0x175..0x17D` and `0xB76..0xB7E` are the muzzle flash and
its second draw for player 0, `0x91A..0x92F` and four more runs are the
collision-material impacts, and every one of them is in the same file the
bundle was already opening for other reasons.

**There is no texture animation in this engine.** Every flipbook is a run of
models and `AssetDrawSlot(first + cel)` steps through them. So the answer to
"where are the sprites" is that they are not sprites, and the bundle carried
none of them because nothing had asked it to. `slots_effect` — a hidden rig
with the same shape as `slots_actor` and `slots_breakable` — carries 162 of
them now, and stage 2 grew from 69 MB to 71 MB.

### Where the blood goes, which is neither of the two obvious answers

`ShotTestBoneSphere` (`FUN_004047D0`) settles it: it tests
`obj + bone * 0x90 + 0x274/+0x278/+0x27C` as a sphere centre against the radius
at `+0x284`, and `DrawBloodSpray` (`FUN_00407230`) draws at those same fields
with `z + radius`. So:

* it is at the **bone**, not at the point the ray met the model — the engine
  never computes that point for an actor or for a prop, and a shot that clips
  the edge of an arm bleeds from the middle of the arm. The complaint is real
  and the game does it too.
* it is at the sphere's **near face**, not its centre. Camera space has `-z`
  in front, so adding the radius pulls it toward the viewer onto the surface of
  the limb. The port had the centre. That is the part that was wrong.
* it **tracks**: `SpawnBloodSpray` (`FUN_00407310`) stores the actor, the bone,
  a cel and a severity, and no position at all.

`SpawnPropHitSpark` (`FUN_00465860`) is the one effect that *is* at the
crosshair: the aim unprojected to the prop's own camera depth, with `z` then
overwritten by `obj+0x1A4`. Two `MOV [ESI+0x3C]` in a row at `0046592B` and
`00465936`, the second throwing the first away.

**`obj+0x1A4` is the prop's world z, `[proved]`.** `FUN_0046F350` writes
`0xC4044F9E` into it, which is `-529.244`, and that is the third component of
the fixed world point the same prop type registers for its shot test — a
number this project measured a session ago for a different reason. Six
class-0x41 routines write world-scale negative literals there and nothing else
does.

### The two thirds that did not exist

`PlayerShotEffectSpawn` (`FUN_00416F70`) fills three six-deep rings per player
on **every** trigger pull, hit or miss, and none of the three was ported: the
muzzle flash, the tracer, and an Original Mode record. The tracer's expiry is
the nice one — `g_shot_hit_something` (0x009C9010) is written by
`ProcessPlayerShots` as "the candidate list is not empty" and read by exactly
one line, which kills the tracer on its second frame. A round that hit is a
stub of streak; a round that missed flies for a full second.

Three smaller things fell out of the same routine: the ring cursor advances
*between* the tracer and the Original Mode record, so that record lands in the
slot the previous shot used; `g_original_weapon_kind` is `+0x09` of the
per-player block `g_original_item_slots` already names; and `+0x08` beside it
is the magazine size, which is why `PlayerRefillMagazine` (`FUN_00414B30`)
compares against a literal 6 in arcade.

### A closed `[open]`

`render/shooting.ts` had said a miss has no material, because it raycast the
drawn geometry and there was no collision to ask. There is now:
`game/coli.ts` has the game's own sets, so `ShotHitWorld` traces the shot
segment far-end-first the way `FUN_00404B80` does and hands
`SpawnWorldImpact` the engine's own point, normal and surface id.

### Where it all lives

In `game/`, as pools in `G` that go into a snapshot as plain records — the
same shape `g_severed_heads` has and for the same reason. `render/effects.ts`
owns only the nodes. The one thing it cannot rebuild is where a bone is, so
the blood asks `CharacterLayer.boneSphere` for the centre and radius
`pickShot` already tests with.

One new seam: `GameHost.viewSpaceOfPoint`, the inverse of `viewPoint`. Two
callers want it — the impact sprite's distance scale, which
`SpawnSpriteEffectFromParams` fixes at spawn and never recomputes, and the
muzzle point, which the engine reads out of `g_crosshair_x` in pixels and the
port has only as a ray.

### Wrong turns

* I wrote the ring tick as *test, then step*, which is the engine's order
  inside one routine — but the port's frame is *step, then draw*, so the test
  was guarding the wrong value and every record lived one frame too long. The
  flash drew ten frames of a nine-frame strip. `test/port.test.ts` caught it
  on the first run; the fix is to step first and test the stepped value, and
  that makes the two agree exactly on how many frames are seen.
* I assumed `ActorShotFeedback`'s severity table went 0.5, 0.75, 1.0 in result
  order. It does not: result 1 pays **0.75** and result 2 pays 0.5, which reads
  backwards until you notice that 1 means the bone's model changed.

### Not ported, and named

* `ActorUpdateBodyCondition` (`FUN_00454270`) runs inside `ActorShotFeedback`
  on results 1, 3 and 4 and derives `obj+0x130C` from which hands are armed
  and which zones are gone. The port has the sibling
  `ActorBodyConditionFromHands` (`FUN_00455920`) and not this one, so the
  death picker reads a condition that a hit no longer updates.
* `SpawnCivilianBloodPool` (`FUN_0048E080`) — the decal a shot civilian
  leaves. A different object type again, and unported.
* The Original Mode weapon kinds. Every arm is transcribed and none is
  reachable: `g_original_weapon_kind` is seeded 0 and the port has no pickup
  that changes it. Their artwork is in `eff_org9.bin`, `eff_org5b.bin` and
  `etc_1.bin`, and the bundle does not carry it.
* `ActorPlayHitVoice`'s fourth kind, the one the bursting head plays. The
  other three voices stay in `render/shooting.ts` with the seeded pick and the
  sound tables, so the burst is silent. `[open]`.

### Follow-up — the muzzle flash was ten times too big

The user pushed back on the answer above: *"There is 100% a muzzle flash or
something animation when ANY shot is fired... don't invent something for this
port."* They are right, it is the muzzle flash, and it lands **exactly** under
the crosshair by construction — `PlayerShotEffectSpawn` places it at
`(cx / proj, cy / proj, -1)` in camera space, which projects back to
`proj * (cx / proj) / 1 = cx`, the same pixel, for any field of view.

Checking that claim found a real bug in the commit above. `MatrixScale`
(`FUN_004A9CC0`) multiplies the top of the stack **in place** — twelve
`x = k * x` and no assignment — and `PlayerShotEffectsThink` scales, draws,
scales again and draws again inside one `MatrixStackPush`. The two compound:
the second draw is `0.1 * 0.5`, not 0.5. Slot `0xB76` is a quad 3.84 units
across, so at an absolute 0.5 one unit from the eye it covers two and a half
screen heights — every shot would have whited out the frame.

The lesson generalises past this routine: **a second `MatrixScale` inside one
push is a factor, not a value.** Every other draw in the effect path takes one
scale each and is unaffected, and `SpriteEffectDrawAndTick`'s kind-'S' arm
jumps over the second call rather than reaching it.

Also confirmed, by reading every reader of `g_crosshair_x` in the image: the
crosshair-aligned spark belongs to shootable **objects** — `SpawnPropHitSpark`
(`FUN_00465860`) and two near-identical copies at `FUN_004666B0` and
`FUN_0043E3D0`, each on its own object's update. `ActorShotFeedback` reads the
crosshair nowhere, so a flesh hit gets blood at the bone and no spark. The
remaining reader, `FUN_004169C0`, is the 2D reticle sprite itself.

## Session — an emerging zombie does not stagger, and the bit that says so

**The report.** *"Zombies in an emerge animation shouldn't play a stagger
animation when shot."*

### What the engine does

`ZombieOnShot` (`FUN_00453EB0`) has no state test in it at all, so the first
guess — that the suppression is a state check — is wrong. The refusal is two
flag bits, and it is inside the routine that picks the clip:

```
004544cc  85d2            TEST EDX, EDX                             ; the bone
004544ce  0f8482010000    JZ   0x00454656
004544d8  f7463400200010  TEST dword ptr [ESI + 0x34], 0x10002000
004544df  0f8571010000    JNZ  0x00454656          ; ActorPlayHitReaction
```

`0x10000000` is *mid-attack* — `ZombieStateStandAndThrow` and
`ZombieStateTargetMotionScript` raise it. `0x2000` is the latch that matters
here, and `ZombieStateEmerge` (`FUN_004584E0`) holds it across the whole state:

| where | instruction | effect |
|---|---|---|
| sub 0 | `00458532  80ce21  OR DH, 0x21` | `0x2000` and `0x100` up |
| sub 1 → 2 | `004585EC  81e2fffef6ff  AND EDX, 0xfff6feff` | `0x90100` down |
| exit → state 1 | `0045869F  80e6df  AND DH, 0xdf` | `0x2000` down |

`OR DH, 0x21` is one instruction and two bits, and both are about being shot.
`0x100` is `ShotImmune`, which `ZombieOnShot` tests at `00453EFB` *after* it
has already called `DispatchHit` — so damage lands while the actor is
submerged, but no death state is chosen. `0x2000` outlives it by the length of
the emerge clip. `[proved]`.

### What the port was doing

Neither half existed. `ActorPlayHitReaction` had no gate, `ZombieStateEmerge`
raised no flags, and the port calls `ActorReactToHit` from `ResolveHit` rather
than from `ZombieOnShot` — a declared `[diverges]` in `class30/on_shot.ts` —
so every shot on a climbing zombie cut its entrance clip with a stumble.

The fix is the engine's own: the two-bit test in `ActorPlayHitReaction`, and
the three flag writes in `ZombieStateEmerge`, each on the line with the address
that makes it. No new divergence; the existing one is narrower for it.

### The wrong name is why the raise was never ported

`obj+0x34` bit `0x2000` was `ActorFlag.ArcSpent` here — named after the one
consequence class 0x31's fall states get from it, that a second knockdown finds
it already up and launches no further arc. That is a *use*. The image reads the
bit in exactly two places — `ActorPlayHitReaction` at `004544D8` and
`ThrowerOnShot` at `00449A95 f6c420 TEST AH, 0x20` — and **both refuse a
reaction**. Every writer raises it while something else owns the body and
clears it on the way out: the emerge, the delayed leap, the scripted arc
entrance, `ZombieStateMotionCue21`'s exit, `ZombieApplyScriptMode`'s `0x2400`,
`ThrowerStateFallToSurface`, `ThrowerStateRearm`'s exit, and
`ActorPlayHitReaction`'s own alt arm at `004545F5`. It is `NoHitReaction` now,
renamed in `actor.ts`, the fifteen use sites, `port.test.ts` and
`docs/formats/combat.md`. This is `L20` in the small: the name said where the
bit sits rather than what it is, and a reader looking for "what stops the
stagger" would never have found `ArcSpent`.

### Found in passing, not fixed — the sprint bit is raised by being shot

`class30/states.ts` says of `ZOMBIE_SPRINTS` (`obj+0x34` bit `0x8000000`) that
"the bit is never `OR`ed anywhere in the image: it arrives on the actor from
the spawn record's own flags word". **That is false.** `ZombieOnShot` raises it
on every registered hit:

```
00453f03  8b4e34          MOV ECX, dword ptr [ESI + 0x34]
00453f17  81c900000008    OR  ECX, 0x8000000
00453f2a  894e34          MOV dword ptr [ESI + 0x34], ECX
```

So a zombie that has been shot and survived switches from `row[2]` to `row[3]`
— the jog to the sprint — for the rest of its life. The port does not do it,
and this is a second bug rather than a second half of this one, so it was left
alone rather than folded into a commit about the stagger. `[proved]`, and it
wants its own test.

### Two things noticed and deliberately not touched

* The port's `ZombieStateEmerge` models sub 0's hold with
  `ActorFlag.PoseFrozen`; the engine raises no `0x4000` there and instead turns
  root motion off through `FUN_00409D10(obj+0x194, 0)` and
  `obj+0x1F8 &= ~1`. Same visible effect, different mechanism, and changing it
  is `L8` waiting to happen. `[open]`.
* The port's `ActorReactToHit` carries `bone <= 0` and the exe's
  `FUN_004543F0` does not — the bone test is `TEST EDX, EDX` inside
  `ActorPlayHitReaction`, and the positive-bone test is in `ZombieOnShot`'s own
  loop. It is also missing `FUN_004543F0`'s two other arms: result 1 on bone 1
  for character type 10 (score `0x50`, state `0x19`) and result 4 routing to
  `ActorAbortAttackAndLeave`. Both `[open]`, neither touched here.

### The test

`web/test/port.test.ts` drives a zombie into state 27, shoots it submerged,
shoots it again mid-clip, runs a whole `ResolveHit` through it, then puts the
cursor on the clip's last frame and shoots it once more. Four assertions fail
without the fix — the first of them reporting `react` as motion 961, which is
the stagger — and the last one, after the hand-over to `AttackRun`, is what
stops the fix being "never stagger".

---

## Session — a stopped clock is not a frame, and it was firing shots

**Report:** "Shots still register when paused." Fixed. No binary was read this
session; nothing in `game/` changed and no annotation was added.

### How far a paused shot was getting: all the way

`GameSystem.update` (`app/systems.ts`) opened with

```ts
if (t.frozen || t.dt <= 0) {
  ProcessShotRequests(this.host, ctx.rng, ctx.events);
  return;
}
```

so a click made with the transport stopped resolved **completely** on the next
drawn frame — `pickShot`, `ResolveHit`, hit points off, `ScoreAddForPlayer`,
the head combo armed, `MarkActorShot`, `PlayerShotEffectSpawn`, and
`g_nPlayerFired` counted. The queue was not a queue on that path: it was
drained by the one branch that exists because there is no game time.

Watched failing in `web/test/port.test.ts` before anything was changed, on a
one-zombie fixture at hp 100 driven by one frozen tick: `hp 97`, `score 10`,
`g_nPlayerFired 1`, the pull gone from `g_shot_requests`, and the muzzle flash
and tracer lit. Six assertions, all red.

### The argument in the comment, and why it does not hold

The branch justified itself by step mode: "the feed row for a shot fired while
paused is half of what the step mode is for." **Step mode never reaches that
branch.** `Player.gameStopped` is free roam, or play mode with the transport
stopped; step mode is neither, so `stepOneFrame` hands the port `DRIVEN_TICK`
and a shot fired in step mode resolves down the ordinary `GameUpdate` path at
the head of the next tick. What the branch actually served was **paused, free
roam and `?freeze=1`** — precisely the three rows `PLAYER_PROGRESS.md`'s mode
table marks "port and render **stopped**".

That is what decided the reading. Both docs agree with each other and with the
engine, which has no pause at all; and the debug capability the task warned
against removing is the live path, not this one.

### The half that was not on paper

The shot's effects became engine state in `ff33131`, and `ShotEffectsTick`
steps them at the head of `GameUpdate` — on **game** time. So a flash and a
blood spray spawned by a paused shot could never expire, `Shooting.busy` stayed
true, `Player.wantsFrame` kept saying yes, and the loop that is supposed to
sleep while paused ran for ever. `web/tools/pacing.mjs` was already red on that
exact line before this session touched anything:

```
FAIL  ...and the loop went back to sleep after the feedback — 60 frames in ~1s
```

and is green now, twice in a row, on the real page. Nobody had connected the
two reports; they are one bug. The claim in `PLAYER_PROGRESS.md` that "the
impact sprites still play out on wall time" had been false since `ff33131` and
is corrected.

### The fix, in the two layers that own the two halves

1. **`app/systems.ts`** — `if (t.frozen || t.dt <= 0) return;`. A frame that
   owes no tick must not do part of one, which is the rule `CameraSeatSystem`
   was made to obey and this branch was the last exception to. The
   `g_camera_yaw_bams` write stays above it; its comment cited the drain as
   its reason and now cites what is left (the globals panel, and a snapshot
   taken in free roam).
2. **`app/main.ts`** — `onFire` queues only while the game clock is running:
   `if (this.gameRunning && !this.frozen) QueueShotRequest(0, ray)`.

**Why the second half is not over-reach.** With only the first, the pull stays
on `g_shot_requests` and `r.frame <= now` makes it due the instant the clock
restarts — so twenty clicks made while paused, or a free-roam session spent
clicking at scenery, arrive together on one frame along rays taken from
wherever the free camera was. That is a delayed version of the same report, and
it is a thing the engine cannot do. Whether a click is *input at all* is the
transport's question, and `app/main.ts` is where intent enters `G`
(`PLAYER_ARCHITECTURE.md`, "Input intent"), so it is answered there rather than
in `game/`, which must not learn that a player can be paused. The `wake` stays
unconditional — a click is still drawn, and `Shooting.fire` has already counted
it in the HUD's own tally.

A pull made in the sliver between a playing frame and a pause still survives on
the queue and resolves when the clock restarts. That one is input the clock
genuinely owed.

### Wrong turns

* The first version of the new fixture asserted "the muzzle flash is unlit" and
  passed **before** the fix as well as after. `CameraFrame` starts with both
  matrices all zero, so `viewSpaceOfPoint` returns NaN and
  `MuzzlePointInView` refuses — the fixture could not have lit a flash however
  broken the code was. Fixed by taking an identity pair and firing down the
  camera's own -Z; the two effect assertions then failed with the rest. **A
  fixture that cannot produce the symptom is not an assertion**, and it looked
  exactly like a pass.
* One `pacing.mjs` run with the fix in reported three failures with the
  transport readout at `frame -1` — the regex found no `frame N / M`, i.e. the
  page was not settled. Two clean runs after it, and the same run passes
  repeatedly; recorded because "it failed once" was nearly written down as a
  finding.

### Unsettled

* `[open]` **Free roam is in the stopped group, so a shot cannot land there
  either** — and a peer is concurrently teaching `Shooting.pointerAt` to
  survive pointer lock, which is only reachable from free roam. The docs put
  free roam and paused in one row and this followed them; if free roam is meant
  to be a place you can shoot, that is a change to the mode table first.
* `tools/verify_all.py`'s `status` check is red on line counts, from the whole
  dirty tree rather than from this work. `docs/STATUS.md` is generated against
  a commit's tree, not a working tree — `ff33131` says so — so it was left
  alone.

### Next actions

* Decide the free-roam question above, and if it changes, change the table in
  `PLAYER_PROGRESS.md` before the code.
* `web/tools/pacing.mjs` is the only check that can see any of this and it
  cannot run under `tools/run_test.mjs` (playwright, esbuild). It is worth a
  row in `verify_all.py`'s `CHECKS` that runs it directly, or it will rot.

### Follow-up — confirmed in the browser, and the blood is green on purpose

*2026-09-06.* "There's still no effects showing — can you confirm in the
browser that these are working?"

They are. `web/tools/effects.mjs` loads the real page, fires real shots and
reads the layer's own readout back: 162 templates adopted, the muzzle flash
and the tracer on every shot, a surface impact where the script has selected
collision, and blood on a hit that runs out on its own. Screenshots in
`web/shots/`.

Three things that cost a run each, all now handled in the harness and worth
knowing for the next browser check:

* the sidebar's groups start collapsed and a collapsed group renders no rows,
  so there is nothing to read;
* expanding one leaves a `<summary>` focused, and the player's shortcuts skip
  a key when something focusable has it — so the Space meant to start playback
  toggled the group shut instead. **The game never advanced, nothing spawned,
  and every shot was a miss into an empty scene**, which reads exactly like
  "the effects do not work";
* `SpawnWorldImpact` legitimately spawns nothing where the script has selected
  no collision. Stage 1 block 4 spends most of its time at `0 quads selected`,
  so a volley there produces no impact at all, in the engine as here. The
  harness reports that rather than failing on it.

**The blood renders green, and that is the shipped default.**
`tex/scr_blood_red.bin` and `tex/scr_blood_green.bin` hold 39 textures each at
the **same global slot ids** as `tex/common.bin` — 159 upward. Slot 159
decodes to the same 64x64 shape in all three with only the channel moved:
`common` and `scr_blood_green` are alpha-weighted `(0, 119, 0)` and
`scr_blood_red` is `(119, 0, 0)`. So they are one set of art and two palettes,
and the **Blood Color** option (`0x005971C4`, beside `"  Red"` and `"Green"`)
loads the override bank over the common one. The port binds `common.bin`,
because that is the bank the models' own `pol/` file names, and therefore shows
the default.

`G_ENABLE` in `Hod2.ini` is not this: `FUN_0049E4A0` reads it out of
`[Flush Setting]` beside `FLUSH_POWER` and `SCREEN_LIGHT`, so it is the screen
flash.

The layer's `describe` now names each pool separately — blood, sprites, flash,
tracer — because "0 drawn" has three different causes with three different
fixes, and one number could not tell them apart.

## Session — the window and the gate are one object, and it is an effect

Two reports, treated as one investigation on the ask, and they turned out to be
**literally the same pair of objects**: "the window is never rendered at
`block=1&step=5`" and "gate c68 does not render, play any sounds" are the
class-0x44 spawns at evt `0x1580` and `0x15CC`. `c68` is
`render/overlays.ts` labelling an unposed spawn `c${class}`; the absence of an
`hp` in the label is the other half of the identification, because those two
are the only **selector-0** class-0x44 spawns in the game and every other one
carries a non-zero `obj+0x11C`. Block 1 step 5 op 28 places them, block 10 step
0 op 30 places them again, and block 10 step 2 op 5 is the `set_script_flag 18`
that starts them moving.

### What the class actually is

`props.ts` had class 0x44 as a **hinge placer** — selectors 1, 2 and 4, which
share `HingeUpdate` (`FUN_00473CF0`) — and `resolveForStage` dropped every
other selector. Selector 0 is `PropBuildScriptFlagEffect` (`FUN_00472B30`) and
is not a hinge:

* it **never copies the spawn's position**. There is no `MatrixTranslate`
  anywhere in the family; `ScriptFlagEffectUpdate` (`FUN_00473B90`) hands the
  four-word state block at `obj+0x324` to `EffectDrawWithCapture`
  (`FUN_0040DFD0`) and the parts are placed by *motion 471*, in world
  coordinates. Frame 0 seats them at `(±13.762, 0, −361.5/−362.8)`, which is
  the two descriptors' own positions to three decimals — the check that turned
  a plausible reading into a proved one.
* the dword at `tail+0x04` picks the pair: `0x13F5` is effect 2 captured at
  bone 2, anything else effect 3 at bone 1. The *low half* of the same word
  goes to `obj+0x28C`, which this family never draws through — reading it as
  the asset slot, the way selector 1 does, gets a slot the tree does not name.
* `g_script_flags[0x12]` runs the clip and `[0x13]` despawns it, both literals
  in the routine rather than fields of the descriptor. Each frame in
  `g_script_flag_effect_cues_a` (0x005961F0) / `_b` (0x00596204) plays
  `PlaySoundId(0x1816A9)`, tested for **equality** against the play cursor, so
  a parked cursor never fires again. That is the "play any sounds" half.

### The effect stride is not the character stride

`docs/formats/spawns.md` already had the effect tables read; what it had not
been made to do is decode one. `EffectFrameTranslations` and
`EffectFrameRotations` derive the stride from `g_effect_bone_counts[effect]`
as `(n * 0x12 - 0xF) & ~3`, **truncating**, and the count includes the root,
which carries no animation — so a frame is `n-1` translations of three floats
then `n-1` rotations of three BAMS shorts, and the engine's `+4` on the
translation address cancels its `-8` on the rotation address against `n * 0xC`.
Motion 471 is 101 frames of 36 bytes, which is that expression at `n = 3`
exactly. `g_motion_play_length[471]` is 200 = `2n - 2`, and interp mode 1 means
the cursor is a play frame and the key is `cursor / 2`, blended half way on odd
cursors.

### Two wrong turns, both caught by a check rather than by reading

* **The tree walker capped a node's children at 0x40**, an arbitrary bound
  written for safety, and returned 65 of effect 8's 145 nodes and 65 of effect
  16's 73. Nothing about that is visible in stage 1, whose two trees are three
  nodes each. `tools/verify_effects.py` — written afterwards, to assert the
  node count against `g_effect_bone_counts` across all 29 — is what found it,
  and it is the reason the check exists in that shape rather than as a spot
  check on the two effects this bug needed.
* **The first version of the port fix made the bug worse and looked like it had
  done nothing.** `SpawnPropContainers` names `falling` and `story_switch` as
  class-0x44 containers and **falls through to class 0x41's arm** for anything
  else, so the two window halves were spawned as `PropContainerPlacer`s running
  `PlaceBreakableGroup` with group 0: six breakable props that do not belong to
  the stage, no window, and a sidebar reading "30 up (21 drawn)" that looked
  like progress. The selector table is a `Record` now, so a container with no
  entry is not built rather than built as something else. The tell was the
  harness digest printing `c65` for a descriptor the script calls class 68.

### Where it lives

`game/class44/script_flag_effect.ts`, with `PropFamily.ScriptFlagEffect` in the
container pool — the engine's own grouping, since selectors 0, 16 and 17 all
`ActorAlloc` a 0x378 object into the same family. That put the render for free:
`render/breakables.ts` already clones a model per asset slot and poses
`Rz · Ry · Rx` for the falling container, which is `EffectPoseNode`'s order
too, so the only change on that side is the family joining that arm and casting
no shadow.

Two `[port-only]` notes rather than divergences. The draw's residency gate,
`g_motion_slots[471].state == 2`, is always true here because the bundle bakes
the motion. And the object is not registered for the shot test: `obj+0x34`'s
bit `0x10` sends `RegisterForShotTest` to `ShotTestMesh`, which the port has
not got — the same standing gap the story-mode switch's volume has.

Evidence: `web/shots/props_panel2.png` is the gate standing closed across the
archway with the three zombies behind the bars, and `web/shots/gk70.png` is the
same gate thrown open with the zombie coming through, `set_script_flag 18` and
the script's own `DOORKICK1_22.WAV` in the event feed beside it.

## The Shoot toggle, and the fights nobody was having

Reported as a regression: "we're not waiting for enemies at all now". It was
not a regression. A pristine tree at `HEAD` with the pre-change bundle gave
frame-for-frame identical playthroughs on stages 1, 2 and 3, and an identical
46.75 s parked on `wait_enemies_present` in interactive play. Nothing had
moved. The player had always behaved that way, and the reason was a default.

`WalkerHost.aliveEnemies` and its three siblings answered **null** while the
Shoot toggle was off, which was off by default. A null count is not a condition
the walker can evaluate, so it paces the gate on a timeout instead — and that
is every room clear in the game passed without a fight. The reasoning behind
the null was correct on its own terms (with nothing able to kill an enemy the
count cannot fall) and it made one unlabelled checkbox the switch that decided
whether the port ran the game.

Two things worth keeping from it:

* **A default that disables the thing under test is not a default, it is a
  trap.** Every driver under `web/tools/` opened with `enableShooting(page)`,
  which is the shape of the problem: the harnesses all knew, and the person
  opening the page did not.
* **"You broke it" and "it has always been broken" feel identical from
  inside.** The only thing that separated them was building the old tree and
  running both. Do that before looking for the change that caused it — I spent
  the first half of this looking for a culprit that did not exist.

The toggle is gone. `render/shooting.ts` takes its camera at construction; it
used to get it from the toggle's command, so before that checkbox was found the
layer had no camera and a click did nothing whatever.

Second thing, from the same report: the remaining checkboxes did not say which
of them hide part of the game and which add drawing over it. `ToggleSpec.kind`
says now, and `ui/panels/DebugGroup.tsx` draws the two halves apart, each
labelled. `spawns` also gained the sentence it had never had — its `title` was
the empty string.

## Holes in the stage — the exporter was deleting geometry on purpose

Reported on stage 1 from the rooftops north of the piazza: triangles missing,
"in a few places, and this is one of the most egregious." The cause is not the
parser, not culling and not the region streaming. `drop_collapsed_uv_triangles`
was on by default in both halves of the exporter and takes 3–5% of every stage.

Its docstring said, in as many words, "why the game does not show them is still
unresolved — the hardware may reject zero-area-in-UV polygons, or they may be
hidden by other geometry along the camera rail. Either way they carry no
displayable texture information, so dropping them can only improve the result."
Both halves of that sentence are load-bearing and neither was checked.
`WalkMeshChainAndDraw` (`FUN_004A7EF0`) submits every strip whole and makes no
per-triangle test of any kind; the game draws all of them. `[proved]` And the
improvement is a hole: two of stage 1's 1,577 dropped triangles are paving in
the piazza, straight through the world, from any rooftop overlooking the
square. Lesson **L23**.

### What the investigation got wrong, and why

**The first hour was aimed at the wrong thing, on the reader's own numbers.**
The report came with an eye and a look-at read off the camera group. The eye is
`p.camera.position` — the live camera. The look-at was `p.cam.pose.target`,
the *script's* block target, which free roam never writes. In free roam they
are two different cameras printed under one heading, so every screenshot for
the first hour was taken from the right place pointing somewhere nobody had
been looking. The reader is the one who asked whether the shots were facing the
right way. The row is `block target` now with a `facing` row beside it, so the
readout cannot say that again.

**Three of my own measuring tools lied before any of them told the truth**, and
each failure is worth knowing:

* `WebGLRenderer.render` is an **instance** method in three, assigned in the
  constructor, not a prototype one. Patching the prototype silently did
  nothing, and a "forcing every material double-sided changes nothing" result
  stood for twenty minutes.
* Restoring `PerspectiveCamera.prototype.updateMatrixWorld` after pinning the
  camera hands it straight back to `FreeRoam`, which re-poses it on the next
  frame. A raycast taken after that is a raycast from somewhere else.
* Painting every back face magenta over-reports by exactly the double-sided
  meshes, whose back faces this port already draws. The marker has to skip
  them or it accuses the geometry that is on screen.

The control that made the rest trustworthy was shooting the same pose four
times in one page load — shipped, shipped, double-sided, shipped — and getting
0, 11.06%, 0. Two separate page loads are not a comparison.

### What was cleared on the way

* **The NL1 parser loses nothing.** Instrumented every `break` in `nl1.parse`:
  all 389 models across the six stages end on the chain terminator, and not one
  hits a truncation, a bad back-reference or an implausible mesh size.
* **Back-face culling is faithful**, which took measuring rather than
  arguing. Winding against the models' own stored normals, split by the cases
  the rule keys on: lists at `cull=2` 100.00%, strips at `cull=2` 99.94%,
  strips at `cull=3` 99.96%. The one population that disagrees is `cull=1` at
  88.45% — the strips the game does not cull at all, where winding cannot be
  seen. The doc's corpus-wide 97.81% had those folded in and reads worse than
  the rule is.
* **Strip control word bit 7** — inherit the previous strip's culling and
  shade mode — never changes an answer: 78,012 bit-7 strips, zero where the
  inherited culling differs from the strip's own. Confirms what
  `formats/nl1.md` marked `[measured]`.
* A free camera behind a one-sided wall sees through it, **and so would the
  game**. Much of what looks like missing geometry in free roam is that, and
  it is not a defect; on the authored rail, front-face and double-sided renders
  are identical.

### Two more, from the same investigation

* `counts.triangles` in the manifest subtracted `dropped_collapsed_uv` from a
  total that had already had them dropped. Stage 1 reported 32,485 for a file
  holding 34,062.
* `tools/verify_geometry.py` is new and is the only check in the tree that
  compares an export against the files it was made from — 216 scenery parts,
  each required to hold every triangle its `pol/` models declare. Watched
  failing first, against a bundle built the old way. `compare_bundles.py`
  compares two exporters with each other, which says they agree and nothing
  about whether either is complete; that is the gap this filter lived in.

### The fix was right and the page was showing something else

Two follow-ups, and the first one is a lesson about how a fix gets verified.

The report came back: rebuilt, holes unchanged. The fix *was* in
`extract/player/` -- rendering the reported view from it directly showed no
holes -- and what was on screen came out of the browser's OPFS cache instead.
`BundleIndex` prefers the cache per stage, deliberately, and the only version
checks were the manifest `format` and the schema digest. Turning off a filter
in `hod2lib/nl1.ts` moves neither. So a stage cached before the fix went on
winning over the rebuilt one for ever, and nothing on the page said so.

**I had written that gap down myself, one session earlier, as a known
unfixed item** -- "a future exporter fix that leaves the declarations alone
would let a stale cached stage win silently" -- and then verified this fix
against the source the gap does not apply to. A known hole in a contract is a
thing to check *first* when a fix does not appear to land, not a thing to
recall afterwards.

The contract has a fourth part now: a builder digest over the code in
`web/src/hod2lib/`, stamped on the manifest and on every stage entry, which
**warns rather than refuses**. Refusing is right for a schema mismatch, where
the bundle cannot be read correctly; it is wrong here, where the bundle reads
perfectly and is merely old, and where refusing would make every unrelated
exporter fix cost a full re-export before the page would open at all.

Then: rebuilding in the page needed a manual browser refresh to take effect.
The screen had two exits and neither adopted what it built. `Play stage N` was
`window.location.reload()` under a comment saying a stage was not hot-swappable
from there -- it always was, the top bar's picker is `state.stage = n;
loadStage()` -- and `Back`, the exit you take after rebuilding the stage you are
already looking at, did nothing whatever. Neither reloads the page now, and
`npm run bundle-flow` asserts both.

Writing that check found two more things I had not: the screen opened on stage
1 Arcade whatever was on screen, and my first attempt to assert the reload
raced the loading overlay -- `waitForStage` returns the instant `#loading` is
absent, which immediately after a click is *before* it appears, and reads as an
instant load of the stage that was already up.

### A picture of a stage is a picture of the stage two seconds in

Asked for, and worth the three failures it took. A stage the bundle screen
builds is now loaded, stepped 120 frames, and photographed; the load-time
capture stays only as a fallback for a stage that was never built here.

Every one of the three failures produced a *plausible* wrong answer, which is
the thing to take from it:

* `loadStageInto` stops the transport on its way in, so `playing = true` set
  before the load was gone by the time the frames ran. The walker still reached
  its first wait, the region still streamed, four models were still visible --
  everything looked live and the picture was a flat fill of the fog.
* Rendering and copying in one synchronous block, off the frame loop, draws and
  then copies the clear colour. 222 draw calls and 2,880 triangles went through
  the renderer and the copy was still uniform. The rule the code already stated
  -- "the same task as the draw" -- is not the rule; the rule is "the
  `requestAnimationFrame` callback".
* The loader's own thumbnail request had just become asynchronous, because it
  now checks whether a picture already exists. It landed a second after the
  good one, during the *next* stage's teardown, and overwrote it.

And the check I wrote for it passed on all three. "Is the picture mostly
non-black" is true of a flat brown field; counting distinct colours is the
measure that tells a photograph from a wash. **A green assertion over a wrong
picture is worse than no assertion**, and the only reason this was caught is
that the image was written to a file and looked at.

Two smaller things from the same pass. The staleness warning asked "is any
stage old", so rebuilding the one you were playing left it lit -- it asks about
the slot on screen now. And the screen has a **Build all**, because the
alternative to twelve minutes of waiting once was six separate visits.

### "None of the screenshots appeared"

The pictures were being taken when the bundle screen closed. That is one step
removed from what was asked for -- "when building the stage" -- and the
distance between the two is the whole bug: the tiles stay empty for the entire
run, so *Build all* looks like it did nothing, and reloading the page instead
of pressing Back drops the list of stages owing a picture on the floor. After
twelve minutes of building, reloading is what a person does.

Moving it earlier needed the worker to publish the manifest after every stage
rather than once at the end, because a stage the index does not name cannot be
loaded and loading it is how its picture gets taken. That turned out to fix
something else nobody had reported: **Stop** discarded every completed stage in
a run, because their files were in the cache and no manifest named them.

Then two of my own bugs, both found by looking at the screen rather than at the
check:

* `rescan` was not reentrant. Six stages finishing within seconds of each other
  start six overlapping scans, and each revoked the `blob:` URLs the one before
  it had just handed to React. The last tile was empty every time, with its
  picture sitting in the store -- which reads exactly like "the capture
  failed".
* Putting the picture read *before* the label install made every tile say "not
  built" for as long as six image reads take. The labels are what the screen is
  unreadable without; they go in first now, and the pictures follow.

### Two seconds became seven

Asked for after looking at what the six frames actually held. Two seconds is
still inside the opening swoop on half the stages. Seven puts stage 2 on the
overturned car with the civilians round it and stage 3 on the two of them in
the boat, and it costs stage 1, which at two seconds was the piazza from the
rooftops and at seven is a close-up of a police car's roof light. There is no
single number that is right for all six; this one is right for more of them.
`THUMB_FRAMES` is the whole of it, and 420 steps still take a fraction of a
second.


---

## 2026-09-06 — "No gunshot sound, impact sound etc"

### The chain was not broken, and that is the finding

The report reads as a dead audio system, and I started by assuming it was one.
It is not. `web/tools/audio.mjs` was written to find where the chain was
severed and found no break anywhere in it: it loads the real page, clicks the
sound button (which is both the unmute and the gesture that lifts the browser's
autoplay block), fires a volley into stage 1 block 4, and measures **decoded
samples** — every media element the page plays is routed through an
`AnalyserNode` and its peak amplitude read while it plays. Before any change:
seventeen distinct sources, fifteen of them audible, `ST1_AR` at 0.574,
`BLOOD01/04/06` and `BONE01` at ~0.52, `BULLET_MET1/MET3/OTH1` at ~0.51, three
zombie voices, a civilian's `200_C`, a prop breaking. Every one of them 206 from
the dev server, none silent.

`COMMON/GUN5_22.WAV` was the one thing missing, and it was missing because
nothing asked for it.

The measurement is the point. Both halves of it had to be real: it is not
enough to hook `play()` and count calls, because that is the page's own opinion
of itself, and it is not enough to count 200s, because a file that decodes to
silence answers 200. Peak sample on the graph is what tells one from the other,
and it is what the check asserts. (The 206 is normal, not a failure — the dev
server serves ranges. My first version of the check called every 206 a 404 and
failed the run it had just passed.)

### What the engine plays

`PlayerFireAndReloadUpdate` (`FUN_00414940`) ends a shot with three calls in a
row: `BuildShotRay` (`FUN_00406110`), `PlayerShotEffectSpawn` (`FUN_00416F70`),
`PlaySoundId(g_gunshot_sound_ids[player])`. `ResolveShotRequest` in
`game/combat/shot.ts` had transcribed the first two and stopped at the third —
its own comment even said the flash is spawned "between `BuildShotRay` and the
gunshot sound", which is as close as a port gets to writing down what it left
out.

`g_gunshot_sound_ids` (`0x004EC8BC`) is two dwords, `a9163400 a9163300`:
`0x003416A9` = `COMMON\GUN5_22.WAV` for player 0 and `0x003316A9` =
`COMMON\GUN4_22.WAV` for player 1. Top nibble 0, so both are SE and route to
`/se/`. Both files are in the install.

A dry trigger plays **nothing**: with the magazine empty the routine never
reaches the gunshot, it goes to `PlayerRefillMagazine` (`FUN_00414B30`) and its
`0x3E16A9` `COMMON\RELOAD1_44.WAV`, gated on `g_nFiringGate`. The port has
neither ammo nor the gate, so the reload has nowhere to be played from and was
not invented. `[open]`.

### Per weapon, and a table that turns out to be dead

`0x00413EE5` reads `g_GameMode`, decrements it, and calls
`PlayerFireOriginalModeWeapon` (`FUN_00414B90`, newly named) on zero and the
arcade routine otherwise — so Original Mode has its own trigger, with an
auto-fire latch and a `rand()` recoil spread the arcade one has not. Its
gunshot is `g_original_weapon_gunshot_ids[g_original_weapon_sound_kind]`, and
it falls back to `g_gunshot_sound_ids[player]` when that entry is zero.

The weapon table (`0x004EC9A0`) is eight dwords: 0, then `SHOT_GUN_22`,
`MCHN_GUN_22`, `GRENADE_22`, `MAGNUM_22`, `AIR_GUN_22`, `TOY_GUN1_44`,
`RULE3_22`. **Eight, not sixteen** — L6 nearly had me: the index is a signed
`char` and the next thirty-two bytes read as more of the same shape, but they
are `g_original_weapon_reload_ids` (`0x004EC9C0`), the reload sound for the
same eight weapons, of which only the grenade and the air gun have one. The
boundary is the second table's own reader, not a terminator, and 0x004EC9E0
after it is a u16 table.

The index, `g_original_weapon_sound_kind` (`0x009A224A`), is +0x0A of the
per-player Original Mode block. `ResetOriginalModeLoadout` (`FUN_0048A0D0`)
writes it 0 — it is the second byte of the dword `0x03000006` stored at +0x08 —
and no instruction in the image references `0x009A224A` except the two reads in
the two fire routines. So on the reading so far both weapon sound tables are
dead in the shipped build and *every* gunshot in the game is one of the two
arcade ids. `[likely]` rather than `[proved]`: a write through a computed
pointer into +0x0A would not necessarily show as a reference to that address,
and I did not read the item-pickup routines that write the rest of the block.

The order also agrees with `g_original_weapon_kind` at +0x09, which is a
different byte: kind 3 draws no muzzle flash and adds the `0x53` blast, which
is the grenade; 4 arms `g_shot_weapon_ring`, which is the magnum; 5 sends the
tracer down the object-path arm at half speed, which is the air gun. Two
parallel per-weapon selectors, both seeded 0.

### The impact sounds were already there, and `ActorShotFeedback` does not own them

The report bundles "impact sound" with the gunshot and it is worth stating
plainly where they live, because the obvious place is the wrong one.
`ActorShotFeedback` (`FUN_00454050`) owns the blood, the result-5 impact
sprite, and the result-5 ricochet — and nothing else. The **flesh impact and
the hurt/kill/headshot voices are `ActorPlayHitVoice` (`FUN_0040A6F0`)**,
called from `ZombieOnShot` (`FUN_00453EB0`), which is the class's own on-shot
drain and not the feedback routine. The port plays them from
`render/shooting.ts` off `shot.resolved`, with a seeded pick, and they were
audible before this change. The surface ricochets are the last line of
`SpawnSpriteEffectFromParams` (`FUN_004073B0`) —
`PlayImpactSoundForMaterial` — and the breakables carry their own crack and
break ids out on `prop.cracked`/`prop.broken`. Nothing of that was missing.

### Wrong turns

* **I assumed the disease and looked for it.** The brief said to establish
  whether the chain was live before writing port code, and that was the right
  order: an hour spent in `audio/bgm.ts` or the dev server's `/se/` mapping
  would have found nothing wrong with either.
* **The 206-is-a-failure check.** The first version of `audio.mjs` asserted
  every audio response was 200 and reported fifteen failures on a run where
  every file loaded and played. A check that fails a healthy run is worse than
  no check.
* **De-escaping the TSVs with a global replace.** `annotate.py` took my shell
  heredoc's `\\` literally, so six new rows spelled `COMMON\\GUN5_22.WAV`. The
  fix — replace `\\` with `\` across both files — also rewrote two rows I had
  not touched, `LiftUpdate` and `CivilianPlayDeathVoice`, which legitimately
  carry a double backslash. Restored from `HEAD` and only my own rows kept.
  The diff is what caught it; the edit looked fine.

## Session — the shutter was closed and the gun still worked

Reported as "shouldn't be able to shoot while the shutter is closed. Check the
game code to see how the real game handles this".

The port already had almost all of this. `HudDrawShutterState` (`0x00413970`)
was read, the nine states were transcribed in `script/state/shutter.ts`, the
gate the machine drives was a field on it, the walker exposed it, the save
slice carried it and `Walker.canSkip` read it. It had **two** readers in the
whole tree and one of them was an assertion in `test/state.test.ts`. The shot
path had never looked at it.

### What the binary says, and where the doubt was

The doubt worth naming first, because it was the thing I was told not to assume
either way: `SHUTTER_GATE` names state 0 *"close, and enable firing"*, which
reads backwards. It is not backwards. `HudDrawShutterState`'s case 0 draws the
two bars at ±0.35 — a closed letterbox — and then writes `g_nFiringGate = 1`.
Case 5 draws exactly the same two bars and writes 0. The gate is not "the
shutter is open"; it is a separate permission, and a letterboxed boss intro is
meant to be playable. The polarity in `hod2lib/script.ts` and in
`docs/formats/evt.md` was right all along.

The five writes inside the routine are states 0, 1 and 6 → 1, state 5 → 0, and
the tail of a state-3 close → 0. Not four, as `shutter.ts`'s own comment
claimed; and not "nowhere else in the whole game" either, which was the other
half of the same sentence. `ResetSceneOnEnter` (`0x0045EDD0`) clears it at
`0x0045EEAC`, and four more writers sit on the game's top-level screens
(`FUN_00425E90`, `FUN_00497360`, `FUN_00497760` → 0, `FUN_00480D90` → 1). None
of those is reachable from a stage script; `[likely]` menu and result screens,
not chased.

The rule, from `PlayerFireAndReloadUpdate` (`0x00414940`):

```c
if (trigger_latch) {
  if (magazine empty)          { auto-refill }
  else if (g_nFiringGate != 0) { ammo--; shots++; BuildShotRay();
                                 PlayerShotEffectSpawn(); gunshot(); }
}
```

`g_nFiringGate != 0` means **firing is allowed** (`0x004149BE`, and the same
test at `0x00414C2D` in the Original Mode twin at `0x00414B90`). The answer to
the question the task actually turned on — is it a gate on the trigger, on the
ammo, or on the resolution? — is: on the trigger, above all three. A blocked
pull returns before the ammo decrement, before `g_player_shot_count`, before
`BuildShotRay` and before `PlayerShotEffectSpawn`. **The engine does not spawn
the muzzle flash or the tracer for a blocked trigger.** That is the distinction
a "fix" applied one line lower would have got wrong, and it is what the new
assertions watch.

Three more findings from the same read:

* **Reload is not gated.** Both the auto-refill-when-empty path and the reload
  button run with the gate down; only the reload *sound* is held back
  (`0x00414B75`, `0x00414E88`, `0x0040E7B3`). So the gate is on shooting, not
  on the weapon.
* **The crosshair is gated.** `HudDrawCrosshair` (`0x004169C0`, previously
  unnamed) tests the same word at `0x00416A65` before it draws anything. The
  answer to "does the engine leave the crosshair up" is no.
* **The ammo readout is gated too**, one level up: `PlayerUpdateInPlay`
  (`0x00413E90`) calls `HudDrawAmmoAndReloadPrompt` (`0x004177D0`) only when
  the word is non-zero, and the RELOAD prompt inside it is gated again at
  `0x00418001`.

`PlayerUpdateInPlay` had no function in Ghidra at all — `0x00413DDF..0x00413FAF`
was orphaned instructions after `FUN_00413DB0`, so the `g_nFiringGate` read at
`0x00413F63` showed up in the xref list with no owning function. Creating the
function there is what made the ammo-HUD half readable.

### The shape of the fix, and the one design call

The engine has one word. The port had it as a field on `Shutter`, in `script/`,
with a comment explaining that a gate living outside the shutter would be a
second owner — which was good reasoning that had produced a value `game/` could
not see.

So `g_nFiringGate` is a field of `G` now, and `Shutter.firingGate` is an
accessor onto it. That keeps the one-owner property the comment was defending
(the shutter machine is still the only writer) and puts the word where the
routine that reads it lives. The port's `ResetSceneOnEnter` clears it, which
flips one more row of that function's transcription table from ❌ to ✅.

The test goes at the top of `ResolveShotRequest`, above `g_nPlayerFired` and
above `PlayerShotEffectSpawn`. The request is **dropped**, not held: the engine
polls the trigger once a frame, and a queue that saved the click would fire it
when the shutter opened, which the engine never does.

### The safety question, and how it was answered

Gating the trigger is only safe if the shipped scripts actually raise the gate.
BSS starts at zero and `ResetSceneOnEnter` puts it back there, so a stage that
never issues `hud_shutter_state` 0, 1 or 6 would be a stage you could not shoot
in at all — and that would be a far worse bug than the one being fixed.

Counting the opcode across all eleven `evt/` tables: 87 ones, 104 sixes, 79
fives, 69 threes, and **no zeros anywhere in shipped data**. Then walking each
of the six stages' scripts headlessly: the gate first comes up at instruction
147, 131, 134, 105, 102 and 69 respectively, and is up for 99.9 % of the
instruction stream. The 0.1 % is the reported bug.

### Wrong turns

* **I ran the whole first round of `tools/annotate.py` against the main
  checkout instead of my worktree.** Every command in this session began
  `cd /Users/llm-sandbox/hotd2-decomp && …` out of habit, and `annotate.py`
  resolves its paths from `__file__`, so four annotations landed in a tree that
  had a peer's uncommitted work in the same two files. Caught only because the
  next command in the same shape was a `git` call and the sandbox refused it.
  Reverting was surgical — three added rows removed, one row restored to its
  two-column form — and the batch was then re-applied through the worktree's
  own copy of the script, as `tools/annotate_firing_gate.sh` so it is
  re-runnable. **A tool that resolves paths from its own location does not care
  what your `cd` said**, and a worktree is not protection if you type the other
  path.
* **I tried to rename `FUN_00414B90` and `FUN_00414E40` and found them already
  named** — `PlayerFireOriginalModeWeapon` and `PlayerReloadOriginalModeWeapon`,
  by a peer working in the live database at the same time, and not yet in
  either tree's TSV. My `rename_symbol` call did not fail; it created a *label*
  beside the function, which is the sort of thing an export would later have to
  explain. Deleted. The lesson is the mechanical one: `rename_function` refuses
  a name it cannot find, `rename_symbol` obliges by making something new. And
  it is L21 again — the thing you are reading moves while you read it. I cite
  those two by address rather than by name, because a name that is only in
  somebody else's live database is not a citation `verify_port` can check.
* I first wrote the new test section with `new Walker()` and no script, which
  throws; and with `NULL_HOST`, which has no `viewPoint`, so
  `PlayerShotEffectSpawn` spawned nothing and *"the muzzle is lit"* failed on
  the allowed shot. The second of those is the more interesting failure: the
  assertion that a **blocked** trigger lights nothing would have passed for the
  wrong reason if I had not also asserted that an allowed one lights something.

### Left undone, deliberately

`Shutter.reset()` puts the state to 2 (open, nothing drawn); the engine's
`ResetSceneOnEnter` puts `g_bHudShutterState` and `g_bHudShutterPrev` to **5**
(draw closed, then hand over to 4 with the gate down). That is a real
difference at the first frame of a stage and it predates this session. It is
now marked `[diverges]` on the spot rather than fixed, because the port's
shutter machine also has no per-frame collapse of states 0, 5 and 6 into 4 and
2 — the exe does that in the draw routine — so setting the initial state to 5
without adding that would leave the bars shut for the rest of the session.

The port has no ammo, no magazine and no reload. `g_nPlayerFired` is the only
counter the gate can be shown to hold back, and the assertion uses it. When a
magazine arrives it belongs under the same test.

## Session — the hair is a separate model, and 97 spawns wear one

**Report:** *"Civilians hair doesn't render."* — `docs/BUGS.md`.

**Outcome:** the attachment list is ported. `g_actor_attachment_records`
(`0x004EC4C0`) and the per-spawn `s16[]` at `model+0x1170` now reach the
bundle, `ActorBindPartList` (`FUN_00412440`) runs in three classes' `Init`, and
`ActorDrawAttachedParts` (`FUN_004124F0`) is `CharacterLayer.syncAttachments`.

### The wrong turns, in order

The four shapes I was given to consider were: a model the exporter never
carried; a model carried but never attached; a model drawn but invisible; a
per-character variant picked wrongly. I spent most of the session eliminating
the wrong three, and two of the eliminations were wasted effort.

1. **`g_pCharacterExtraParts` (`0x0052ED08`) looked like the answer and is
   not.** It is the table the docs already called "the parts the skeleton does
   not name", and every civilian has one or two. Reading it properly turned out
   to be worth doing for its own sake — they are **vertex-blended** parts, not
   rigid ones, `BuildCharacterPart` (`FUN_00419520`) deforms each across four
   bone matrices every frame, and part 1's asset slot *is the pelvis model*,
   which is why `SkeletonNodeDrawSuppressed` (`FUN_004122E0`) exists — but the
   two parts are the waist and the skirt, and neither is on the head.
2. **I decoded the eight-vertex translucent mesh on every civilian head as
   hair.** Two quads, one on each side of the head, ARGB1555, alpha-blended,
   present on every one of the 25 civilian types. It is the **ears**: decoding
   `hito_gal` texture 6 and looking at it settles it in one second and I should
   have looked before theorising for twenty minutes. *A texture is faster to
   read than a table.*
3. **I checked the winding, the alpha modes, the base colours and the parse
   completeness, and all four were fine.** Worth recording as negatives: every
   civilian mesh's triangles agree with their stored normals except a handful;
   every material's `alphaMode` follows the PowerVR2 list type correctly; every
   base colour alpha is 1; and all 2,802 meshes in every character model
   consume exactly the bytes their header declares, with no silent short walk.
   The exporter carries every vertex and triangle of every civilian part —
   asserted against the `pol/` files, not against another export.

**What actually found it was looking at the picture.** I built
`web/tools/civ_faces.mjs`, which photographs one rig part of every civilian in
a real browser through the player's own `GLTFLoader`, and the back view of
`hito_gal`'s head was a hollow bowl. The zombie's head, rendered the same way,
is closed. That asymmetry is the whole bug, and no amount of table-reading was
going to produce it. L19 and L25, again.

### What it is

`hito_gal`'s head model has **four** vertex normals out of 149 pointing
backwards (`n.z < -0.5`) against 89 pointing forwards; every zombie head has
15 to 40. The civilians' heads are face shells. Three of the 25 types —
`hito_baba`, `hito_fem`, `deka_musume` — have extra hair meshes *inside* their
head model and those three are the only ones with a closed back.

The rest is `SkeletonDrawWalk`'s last line, which the annotation already
described and nothing had followed: *"then runs the actor's attachment list."*

* `model+0x1170` is an `s16[]` of record ids terminated by a negative.
* `g_actor_attachment_table` (`0x004EC748`) is 81 pointers into
  `g_actor_attachment_records` (`0x004EC4C0`), each `{s32 bone; s32 slot}`.
  81 is arithmetic — the record array ends where the pointer table begins — not
  a scan, which is L6.
* Ids `0x00..0x23` are all bone 2 and name a `hito_kao_*` or `etc_*_kao` head.
  *Kao* is **face**. `ActorBindPartList` writes the slot over the bone's own,
  so the head a civilian's skeleton names is a default and not the character:
  `hito_kao_gal.bin` holds 60 heads of identical geometry, three skins by
  twenty mouth positions.
* Ids `0x24..0x50` name an `etc_komono_*` model — *komono*, **small item** —
  and `ActorDrawAttachedParts` draws it in addition, on bone 2 (hair, hats),
  bone 1 (bags, aprons) or bones 12 and 15 (shoes).

**The tail offset is polymorphic and that is L3 in its usual form.**
`CivilianInit` and `ScriptedHumanoidInit` read `tail+0x08`; `SetPiecePropInit`
reads `tail+0x00`. Reading the wrong one does not fail loudly — small integers
come out either way. What says all three are right is that **every one of the
97 lists names its own character's family**, with no exceptions: `hito_man`
takes `etc_komono_man`, `hito_mario` takes `etc_komono_mario`, `hito_gal` takes
`hito_kao_gal` and `etc_komono_gal`. Three more callers of `ActorBindPartList`
— `FUN_004613C0`, `FUN_004617F0`, `FUN_0049A760` — are unread and their
offsets are `[open]`; they are deliberately not in `ATTACHMENT_TAIL_OFFSET`.

### The split, and where the line between the layers falls

`game/attachments.ts` holds `ActorBindPartList` and `obj.attachments`
(`model+0x1170`); the draw is `render/characters.ts`, because it is a draw. The
first cut put a `ActorDrawnAttachments(obj)` filter in `game/` and had the
renderer call it, which `verify_layers.py`'s `render-drives-the-port` rejects,
correctly: the renderer now reads the split constant off the bundle as data.

`ActorBindPartList` makes no `GameHost` call, unlike every other `boneSlot`
writer. It runs inside an `Init`, before `CharacterLayer.adopt` has an instance
to write through, so `adopt` replays `a.boneSlot` — the same path `resync`
already took. Adding that replay is what makes the face swap appear at all, and
it is a general fix: any `Init`-time bone slot was being dropped.

### `[open]`, left where they are

* The port draws both `g_pCharacterExtraParts` parts rigidly off the pelvis and
  does not apply `SkeletonNodeDrawSuppressed`, so the ten characters with a
  skirt draw their pelvis model twice. Nothing has been seen to go wrong; the
  vertex-blend deform is unported.
* `ActorDrawAttachedParts`' Original Mode scale — bone 2 by 1.5 in X and Z,
  bones 5/8/12/15 by 2.0, gated on `DAT_009C88AC` — is not ported. What that
  byte is has not been read.
* `obj+0x116C` is a per-actor scale `ActorBuildSkinnedModel` (`FUN_00410440`)
  sets to **0.9 for every character type `0x20`–`0x38`**, and op 0x27 writes.
  It reaches the draw only through `FUN_0041EBB0`, which is `ret`. So every
  civilian is authored 10% smaller than it is drawn, in a build where the
  scale does nothing. Not ported, deliberately.
* `CivilianInit` installs `UNK_0048D1F0` as the per-node draw hook in place of
  `SkeletonDrawNodeSlot`. Unread; it is a large switch and it is not what was
  missing here.

### Next actions

* The three unread `ActorBindPartList` callers, if anyone wants the last of the
  attachment lists.
* `UNK_0048D1F0` — what a civilian's node draw does that the default does not.
* The vertex-blend deform, if a skirt ever looks wrong.

## Two boats and a fade — stage 3's opening

Reported together: *"is the fog definitely using the cut scene camera location
for its near/far? at the stage of stage 3 we're starting completely in fog (and
the boat isn't moving with the characters)"*. Two defects that share a scene,
and the hypothesis in the first half turned out to describe the engine rather
than a bug.

### The fog is not measured from anywhere

`FUN_0040AD90` and `FUN_0040C2E0` are the only callers of
`PushSceneFogFromLightBlock` (`FUN_0040C320`), and that routine is one line:
`SetFogRange(param_3, param_4)` over the scene light block's `+0x30` and
`+0x34`, which is what evt channels 0 and 1 write. `SetFogRange`
(`FUN_004ABDF0`) doubles both and hands them to `D3DRENDERSTATE_FOGSTART` and
`FOGEND`. There is no camera anywhere on that path — no eye, no matrix, no
transform. `[proved]`.

Under `FOGTABLEMODE = D3DFOG_LINEAR`, which
`InitD3DDeviceAndTextureStages` picks whenever `D3DPRASTERCAPS_FOGTABLE` is
present, `FOGSTART`/`FOGEND` are **eye-space depths**. So the fog is relative
to whatever view matrix draws the frame, and during a cut scene that is the
cut-scene camera — in the engine and in the port alike. The port has the same
property structurally: `vFogDepth` is `-mvPosition.z` of the rendering camera,
and `app/main.ts`'s tick order puts `CameraDrawSystem` and free roam ahead of
`SceneFog`. The user's hypothesis is a correct description of the engine and
not a defect. Recorded in `render/fog.ts`'s header so the next person does not
have to re-derive it.

### ...but there was a defect in the same six lines

`SetFogRange`'s disassembly, re-read rather than taken from the decompiler
(L1 — the pseudocode passes `param_1` twice in both arms and it is wrong about
that):

```
004abdf0  FLD [esp+4]; FADD ST0,ST0; FST [esp+4]      ; near*2
004abdfa  FLD [esp+8]; FADD ST0,ST0; FSTP [esp+8]     ; far*2
004abe04  FCOMP [esp+8]; FNSTSW AX; TEST AH,1
004abe14  JZ 004abe34                                 ; near*2 >= far*2
          ordered:  FOGSTART=[esp+4]  FOGEND=[esp+8]
004abe34  swapped:  FOGSTART=[esp+8]  FOGEND=[esp+4]
```

A swap guard, and **no on/off test of any kind**. `render/fog.ts` had one:
`activeRange = active && far > near && ...`. Scanning all twelve stage bundles
for what the scripts actually set:

* **40 sites put `fog_near` and `fog_far` both on 1** with a black fog colour,
  either by `light0_set` at a block head or by a 30-frame `light0_tween_time`
  that lands there and holds. That is how every stage in the game fades in and
  out. A zero-width `D3DFOG_LINEAR` ramp is a step — everything past
  `FOGSTART` is 100% fog colour — so the engine's screen goes black. The port
  switched fog **off** at exactly the frame the fade completed, which snaps a
  fade-to-black back to a fully lit scene.
* **Stage 5 blocks 7 and 9 set `near 1472, far 614`.** The engine swaps them
  and fogs 1228..2944. The port fogged nothing at all, through a 5-frame tween
  in, a hold, and a 120-frame tween out.

`fogRangeFor` is now the whole of `SetFogRange`: `min*2`, `max*2`. The one
guard left is the port's own and is labelled as such — the pre-script default
of 65000/65001 stands in for the range `FUN_00460250` seeds and must not paint
the background. The zero-width case gets a 1e-4 nudge so the patched fragment's
`(d - near) / (far - near)` cannot be `0/0`; the result is still the step the
hardware produces.

### The "completely in fog" half is not reproducible at this commit

Measured rather than argued. Driving stage 3 from its entry on the driven clock
and counting distinct colours in the viewport (L25): frame 0 is 883 colours,
frame 5 drops to a mean of `(89, 87, 83)`, and by frame 10 it is back to 1,200
colours and a mean of `(118, 111, 104)`. That dip is the script's own
`fog_rgb (0,0,0) / near 1 / far 1` fading up to `(101,147,164) / 70 / 247` over
30 frames — about four frames of near-black, which is a fade and not a fault.
Nothing later is a wash either: the canal sits at ~900 colours and a mean of
`(32, 37, 34)`, which is night.

So either the report is about a build that is not this one, or — more likely —
it is the *boat* below. With no boat drawn, the pair sail the canal sitting in
open water with a hazy horizon behind them, and that reads as "there is nothing
out there but fog".

### The boat, which was two boats

`web/src/hod2lib/rigs_data.ts` had the answer written down and nothing was reading
it. `ScriptedHumanoidDraw` (`FUN_00484FF0`) — class 0x25's per-frame draw —
switches on the descriptor word `*(int16*)(obj+0x1390 + 6)`, i.e. `desc+0x2A`,
and draws a second model beside the skeleton:

```c
case 3:
  CamEvalObjectPath6(obj+0x135C, (float)g_cam_path_frame, &p);
  MatrixStackPush(0);
  MatrixTranslate(p.x, p.y, p.z);
  MatrixRotateZ(p.rz); MatrixRotateY(p.ry); MatrixRotateX(p.rx);
  AssetDrawSlot(0x1A37);
  MatrixStackPop(1);
  /* ...then a mirrored pair of wake sprites; see below */
```

`obj+0x135C` is the object path the actor is riding, and the frame is
`g_cam_path_frame` — **the same slot and the same clock the actor's own
position comes from**. So the engine does not parent anything to anything: the
boat is drawn from the same curve at the same time as its passengers, and they
coincide by construction. That answers the question the task posed — there is
no carrier field to find, and inventing one would have been a divergence.

Reading all six evt files for `desc+0x2A` over every class-0x25 spawn:
stage 2 has four variant-1 and one variant-2, stage 3 has two variant-3 and one
variant-4, and the other 129 are variant 0. Exactly what `rigs_data.ts`'s note
already claimed. Stage 3's variant-3 spawn is script address 4128, whose
program is `op 11 mode 1 a=340 b=4` — object path 340, offset record 4 — and
4252 beside it takes record 5. The two records are `(4.62, -8.0, 1.42)` and
`(-4.78, -8.0, 0.86)`: two seats.

Variants 1, 2 and 4 draw at points hardcoded in the routine, so the rig writer
already exports them as fixed parts of `obj_484ff0_props`. Variant 3 cannot be
placed statically, and the exporter had recorded that and shipped nothing:
*"the slot is runtime, so nothing is exported for this part"*. So the model was
not in the bundle. The exporter now carries `drawVariant` on every class-0x25
program and adds slot `0x1A37` to the hidden `slots_actor` rig for a stage that
has a variant-3 descriptor; `render/slotmodels.ts` gains the arm.

**And the boat that *was* on screen was a different object.**
`Class26Subtype2Update` (`FUN_0048EAD0`) draws the same asset slot, and its
`switch (g_active_cam_path)` names 0x7C, 0x7D, 0x7E, 0x7F, 0x82, 0x85, 0x86,
0x87 (124..135) and 0xF6..0xF8. Not 121, 122 or 123 — the entire opening. The
`default:` arm jumps past the whole pose block straight to `MatrixStackPush`,
so the object draws at whatever `obj+0x40`..`obj+0x6C` hold, which before the
first named shot is the spawn descriptor's — stage 3 block 0 step 2, script
address 3244, `(0, 0, 0)`, zero orientation. `RigLayer` placed it from `op_st3`
342 at frame 0 instead, about `(−884, −17, −2136)`: in the canal, off the shot,
parked. `Instance.posed` stops that; the root keeps the transform the exporter
baked, which for every rig in the six stages *is* the descriptor's, and
`resync` puts it back so a seek cannot carry a pose across.

The file's `[diverges]` note had said all along that the port "draws the
exporter's baked root pose". It did not. **A divergence note that describes the
intent rather than the code is a bug with an alibi**, and this one had a
visible object in the middle of a shot.

### Wrong turns

* **Named the wrong commit.** The task pointed at `8109636` as "fog is planar";
  that is the ambient-channel commit and the planar one is `8663480` before it.
  Reading both was necessary anyway.
* **The worktree was 82 commits behind `main`** and had no `tools/verify_all.py`
  at all, so the first baseline run failed on a missing file rather than on
  anything real. Reset to `main` before doing anything else. Worth checking
  first in any worktree.
* **`annotate.py` was run with a `cd` to the shared checkout**, so the two new
  rows landed in the user's tree instead of this one — invisible until
  `verify_port` failed on a citation whose TSV row "did not exist". Removed
  them from the shared file, confirmed it byte-identical to `HEAD` again, and
  re-added them here. **A worktree agent has to check where a repo tool wrote.**
* **The first screenshot was of a paused player**, and `#viewport.paused #view`
  carries `filter: grayscale(1) brightness(0.75)`. Ten minutes went into
  reading a washed-out grey room as a fog defect. `mode=play` in the URL is not
  the transport running; Space is.
* **Two collapsed sidebar groups render no rows**, so the first scrape of the
  camera and scene readouts came back empty and looked like a layer with
  nothing to say. Seeding `localStorage` before the first render is the fix;
  clicking the summary is not, because it leaves the disclosure focused and the
  next Space toggles it shut.
* **`render-drives-the-port` caught the first shape of the fix.**
  `render/slotmodels.ts` called `HumanoidProgramOf(a)`, which is a one-line
  table lookup and still a call from `render/` into `game/`. The rule is right
  — the mouse arm beside it reads `a.mouse.frame`, a field — so the descriptor
  word is cached onto the actor by `ScriptedHumanoidInit` and the renderer
  reads `a.hum.drawVariant`. The value is written once by the spawn and cannot
  change, so the cache is exact. **The checker was not touched.**
* **Exported the bundle before the last `gen_builder_hash.py` run**, so the
  manifest carried a stale builder digest and the page lit its own staleness
  warning. Caught by looking at the top bar in a screenshot, which is L24
  working as designed.

### What is left

* **The wake sprites are not drawn.** `[diverges]`, declared in
  `render/slotmodels.ts`. Variant 3's second half is
  `AssetDrawSlot(0x24A + g_frame_counter % 22)` twice, under an anchor at
  `(p.x, -25.0, p.z)` — water level — turned by a heading `MatrixToEulerBams`
  (`FUN_00401AE0`) takes off the composed rotation, at `x = ±1.7, z = 20.0`
  with the second mirrored by a `(-1, 1, 1)` scale. The heading is **not**
  `p.ry`: the decomposition undoes `rz` and `rx` from the left, and `op_st3`
  340's `rot_x` runs to 15,758 BAMS, so the two differ by a lot. Doing it
  faithfully means transcribing `MatrixToEulerBams` and `FUN_00401800` and
  carrying 22 more models (`char_adv06.bin` 0..21) in any bundle with a
  variant-3 spawn. Left undone rather than guessed at.
* **`Class26Subtype2Update` sets `g_carrier_object`.** `DAT_009A5C34 = obj` on
  its first call, which is the rideable class 0x30 state 29 adds itself to.
  Noticed, not chased.
* **Its `case 0xF6/0xF7/0xF8 -> slot 0x199` route is not in any rig table.**
  Camera paths 246..248 against object path 409; the exporter's transcription
  stops at the eight routes 124..135. Not in stage 3's bundle, so [open] which
  stage it belongs to.
* **The `[open]` alternating-frame flip** on the boat's NPCs, from the earlier
  report, is untouched by any of this.

**Next actions**

1. Ask the user about the wake pair — it is the only piece of a routine this
   session ported that is knowingly missing.
2. If "completely in fog" is still being seen, get the URL and the bundle age
   from the top bar; nothing in this commit reproduces it.

---

## Session — the civilians' root motion, and the switch the script owns

**Report:** *"civilians seem to be missing their root motion."* Branch
`fix/civilian-root-motion`.

**Outcome:** two broken links, one in each direction, and they were cancelling
each other out. `docs/BUGS.md` carries the full entry; `docs/formats/
civilians.md` now has the wait word's high bits and the gate.

### The answer to the question the report asks

**Yes, the engine's civilians use root motion**, through the same
`SkeletonApplyRootMotion` (`FUN_00410C50`) as class 0x30 and class 0x31. Its
only gate is `if ((*(byte *)(model + 100) & 2) != 0)`, `model+0x64` =
`obj+0x1F8`, and `ActorBuildSkinnedModel` (`FUN_00410440`) writes
`MOV dword ptr [ESI + 0x64], 0x3` at `0x004104C5` unconditionally. `[proved]`

**And class 0x10 is the one class that operates that switch.** Ops 0x00 and
0x01 of `CivilianRunScript` (`FUN_0048B9E0`), inside their "is this a different
clip" test, set or clear the bit from `*g_cur_civilian & 0x100000` — bit
`0x00100000` of the wait word that opened the block. 289 of the 596 shipped
wait commands carry it and 297 do not. `[proved]`

`root_motion.ts` had said, in as many words, that there is *"no per-state or
per-class switch, and nothing carries an actor but its clips"*. That was true
of the two classes that had been read and false of the third, and it is the
reason nobody went looking: the note read as settled. L26 again.

### The link that was actually broken

`class10/script.ts`'s opcode switch had `SetScale` (0x27) at the bottom of a
fall-through group headed *"Unread. Named so the stream stays legible ...
deliberately no behaviour"* — `SetGlobalB` (0x1B), `SetAttachMode` (0x23),
`SetAttachTarget` (0x24), `SetPairA` (0x25). All four ran `obj.scale =
AsFloat(a[0])`. Their operands are small integers; `AsFloat(2)` is `2.8e-45`;
`SkeletonApplyRootMotion` multiplies the root delta by that field. **125
commands across the shipped streams run one of those four, against one that
runs op 0x27** — and that one passes `0x42480000` = 50.0.

Eight of the six stages' 53 civilians carried a denormal scale. Stage 4's two
type-36 civilians on motion 594 (net root `-10.8`) covered exactly `0.000`
units over 30 s; with the case split out they cover `9.795`.

### The measurement order, and what it cost

Measure first, as asked. The order that worked:

1. Count the wait-word bits across the 136 shipped streams from
   `ExeTables.civilian_scripts()`. That is what put `0x00100000` (289) and
   `0x00020000` (16) on the table as *unenumerated*, before any TypeScript.
2. Bake every clip a civilian script can reach and look at the root track — 94
   of 140 carry net horizontal translation, so the clips are not the problem.
3. Drive all 53 shipped civilians headlessly for 30 s and print
   `scale`/`net`/`maxstep` per actor. **The denormals were visible in that
   first print** as `1.401298464324817e-45`, which is the bit pattern `1`.

### Wrong turns, in order

* **Read `CivilianApplyMotionPose` (`FUN_0048C310`) first**, because
  `class10/index.ts` names it as the not-ported drawing routine and its
  `0x20000` arm does translate the actor. It is a real second translation path
  and it is still `[open]` — but it is *sixteen* wait commands, and the gate
  that mattered was three lines inside `CivilianRunScript`'s op 0x00, which is
  ported. Reading the class's *update* before its *draw* would have been
  quicker.
* **The browser harness measured a paused game for four runs.**
  `?stage=1&block=1&step=8&mode=play&drive=1` picks the mode but does not start
  the clock: the walker sat on `1/8/0`, every actor on clip frame `0/59`, the
  camera path on frame 191 of 219, and `civ_walk.mjs` reported *"1 civilian,
  root on, moved 0.00 over 1170 frames"* — which is the exact shape of the bug
  under investigation. It took adding `frame f/len · loops n` to the civilian's
  debug row to see that *nothing* was advancing, and `playthrough.mjs` has
  `await page.keyboard.press("Space")` two lines after its load for this
  reason. The note is now on the line in `civ_walk.mjs`.
* **Deep-linked to block 1 step 7**, which is where the JSON says
  `spawn_obj_c 6184` is. Step 7 spawns the scenery; the civilian arrives at
  step 8. "No civilian rows" and "the civilians do not move" look the same from
  outside a harness, so the tool now says which it found.
* **Keyed the two panel samples by the row's first line**, which carries the
  script cursor and therefore changes — every match came back `NaN`, and a NaN
  compared with `>` is false, so it read as *moved*. Keyed on the actor address
  now, and the comparison is `!(d > 0.5)`.

### What the browser said, in the end

Stage 1 block 1 step 8, real Chrome on the real GPU (ANGLE Metal, M1 Pro), 600
driven frames: `0x1828 hito_fem` reads `root on · scale 0.9` and moves **20.87**
units. With the fall-through put back she reads `scale 1.4e-45` and still moves
**12.44** — because her captor is dragging her. **A position check alone would
have passed the bug**; `civ_walk.mjs` fails on the denormal instead, which is
a fact about the data rather than a threshold.

### What is left

* **`CivilianApplyMotionPose` (`FUN_0048C310`) is not ported**, and wait bits
  `0x8000`, `0x10000`, `0x20000` and `0x200000` are its. `0x20000` is a second
  way to translate the actor — from the frame's root plus the pol file's
  root-bone offset, both scaled by `model+0x116C` — and 16 of the 596 wait
  commands ask for it, six of them alongside `0x100000`. Those blocks stand
  where the script put them. Porting it needs the bone hierarchy, which lives
  in `render/`.
* **`MotionFlag.RootMotionY` (`model+0x64` bit `0x10`) has no writer** in
  anything read so far. `SkeletonApplyRootMotion`'s two arms differ only by
  whether `obj+0x44` is written, so with the bit set the clip's root moves the
  actor vertically too. `[open]`
* **Bit `0x00040000` is in 315 of the 596 wait words**, more than any other,
  and the draft of this entry called it unread. It is not: op 0x2C writes
  `obj+0x34`'s `NoCameraTrack` from it, *inverted*, and the port already did —
  as a bare `if (sub.wait & 0x40000) obj.flags &= ~0x10000`. Two raw literals
  and no name, which is why the census read it as a gap. It is
  `CivilianWait.CameraTrack` and `ActorFlag.NoCameraTrack` now. **A bit with no
  name in the enum is indistinguishable from a bit nobody has read.**

**Next actions**

1. Ask the user whether `CivilianApplyMotionPose`'s `0x20000` arm is worth the
   bone-hierarchy work for sixteen blocks, or whether naming it is enough.
2. If the civilians are worked on again, `0x00008000` / `0x00010000` /
   `0x00200000` are the remaining unread bits, and all three are
   `CivilianApplyMotionPose`'s.

## Session — the deform is a partition, not a blend, and glTF says it exactly

**Asked for:** the two things the last session left `[open]` — the
vertex-blended parts and the pelvis veto — plus `g_pCharacterExtraParts` and
`g_character_part_bones` carried into the bundle.

**Outcome:** both ported. The parts are a glTF `skin`; the veto is a decision
the port makes once a frame and the renderer applies with `layers`.

### The question that decided the whole shape

*Is a vertex blended across the four bones, or assigned to one of them?* The
answer changes everything: a blend needs a per-frame transform, a hard
assignment is ordinary skinning that glTF states directly.

It is a hard assignment, and three independent things say so. `[proved]`

1. **The writers do not accumulate.** `WriteCharacterPartVertexPos`
   (`FUN_0041A480`) is `*p = *src`, not `+=`, and it walks a `-1`-terminated
   list of *addresses* for one logical vertex.
2. **The assign arrays partition.** Each group has one **signed byte** per row;
   negative means "not mine". Over `hito_gal`'s waist and skirt and
   `hito_baba`'s skirt: no row claimed by two groups, none claimed by none.
3. **There are no weights in the record at all.** The descriptor is
   `{slot, mesh_info, (count, src_verts, assign) x4}` and that is all of it.

And it cannot be flattened to rigid sub-meshes, one per bone, because **every
triangle straddles two groups** — 20 of 20, 24 of 24, 36 of 56 on those three
parts. Splitting would tear all of them. So: skinning, one joint, weight 1.

### The fifth field, and why the inverse binds are identity

`g_character_part_bones` is five `s32`: four group bones, then **the bone the
part is drawn in**. `DeformCharacterPartGroup` composes
`inverse(draw bone) * (group bone)`; `DrawCharacterPartSlot` then sets the
matrix to the draw bone. The two cancel, so a vertex lands at
`group_bone_matrix * source` — the source vertices are in their own bone's
local space and the inverse bind is the identity.

Corroborated on the data rather than from the algebra alone: for `hito_gal`'s
waist, the group whose bone *is* the draw bone has source vertices equal to the
pol model's stored ones to 8e-4 — which is the low mantissa bit
`WriteCharacterPartVertexPos` ORs into x to keep the PowerVR2 vertex control
word set — while the group on bone 1 differs by 0.424 in y, the bind-pose gap
between bone 1 and bone 9. That also explains why the commonest drawer deforms
**one** group and leaves the other: the other is the draw bone's, so its
transform is the identity and the model already holds the answer.

### The veto, exactly

Read out of the disassembly, not the decompiler's switch: character type `0x17`
suppresses `bone >= 16`; otherwise it is bone 9 alone, and only when
`bone_records[9].slot` — *what bone 9 is currently drawing* — is one of ten
literals. Those ten come out of the jump table at `0x00412360` and its byte map
at `0x00412368`, and they are exactly the bone-9 slots of the ten types whose
part 1 draws that same slot, 1:1 with no stray either way. Because the input is
live state a gore swap can change, it cannot be baked into an export.

`0x17`'s arm is the same rule for a different replacement —
`BuildCharacterPartSubparts` (`FUN_00419EB0`) puts eight sub-parts on bones 16
and up. Those are unported, so the port **does not take that arm**: vetoing
eight bones with nothing to draw in their place deletes them. Declared
`[diverges]`.

### Where the line between the layers fell

The deform is skinning and the skeleton is three.js, so it could not go in
`game/`. It did not need to: the *decision* is which parts exist and which
draws are vetoed, and the *arithmetic* is what three.js already does. So

* the geometry and the skin are the **exporter's**, and the renderer needs no
  new code at all — `GLTFLoader` binds it;
* the veto is `game/parts.ts`, computed once a frame into
  `Actor.suppressedBones`, and `render/` only applies it. The first cut had the
  renderer call a predicate in `game/` and `verify_layers.py`'s
  `render-drives-the-port` rejected it, correctly.

Two three.js details worth writing down. **The joints are proxies**: a node a
skin names becomes a `Bone` and its mesh is re-parented under it, which would
change the class of every bone node in every character — and the gore swap, the
severed head and the attachments all classify on `Mesh` vs `Group`. An empty
child with no transform has its parent's `matrixWorld`, so the skin gets what it
needs and nothing else moves. And **the veto uses `layers`, not `visible`**:
`WebGLRenderer.projectObject` returns early on `visible === false` but only
skips the draw on a failed `layers.test`, recursing into children either way —
and bone 9's children are both legs.

### The wrong turns

* **My first `verify_parts.py` passed a bundle I had deliberately corrupted.**
  It indexed the skinned nodes by `(rig, part)` into a dict, so it only ever
  examined the last spawn instance of each; the tamper hit `spawn000`. It walks
  every instance now — 40,266 vertices instead of 7,384. A check that passes
  a corrupted input is worse than no check, and the only reason I found out is
  that I corrupted one on purpose.
* **The same check's `break` was in the wrong place** and it reported 150
  failures against a correct exporter: a group the drawer deforms may still not
  claim a given row, so stopping at the first non-null group makes every vertex
  look like it belongs to part 1's group 0. The exporter was right and the
  check was wrong, which is the correct way round to find out.
* **`git checkout main -- web/src` ate ten files of staged work.** See
  [L30](../LESSONS.md). It writes the index as well as the tree, so `git
  checkout -- <path>` afterwards restores *main's* content, and `git status`
  goes clean. Recovered from `git fsck --unreachable`, matching each dangling
  blob against a line only that file has.
* **The veto's own before-and-after is 0 pixels**, and that is the honest
  result rather than a failed picture. The rigid pelvis and the skinned one are
  the same model; where they coincide the depth test rejects the second draw
  entirely, so removing it changes nothing on screen. Ten frames across a block
  with a `hito_gal` in it, veto on and off, all identical to within 8/255. The
  veto is real and it fires — a probe in `applyBoneVeto` printed
  `hito_gal type=38 mask=512` — it just has nothing to show while the thighs
  are near bind. What *does* show is the deform, and that is the picture:
  4,093 pixels over the hips and thighs, comparing `main`'s player and bundle
  against this one at the same frame.

### Next actions

* Character type `0x17`'s eight sub-parts (`DrawCharacterPartSubparts`,
  `FUN_0041A020`) — the last unported part mechanism, and the reason one arm of
  the veto is a declared divergence.
* Type `0x4C`'s mirrored twin at `+0x82C0`. It reaches no bundle.
* The six `s16` at the head of each vertex-map row, which nothing in this build
  reads.

## A body on the ground is not a target — `DispatchHit`'s one gate

**Report:** *"the 14/8/2 `0x8094` `zsass` doesn't seem to die. shoot him
enough, he makes a dead sound, but then he keeps on player."*

### What the three numbers were

`14/8/2` is **block / step / op**, which is the triple the player writes into
its own URL (`app/main.ts`'s `` `${w.block}/${w.step}/${w.opIndex}` ``) and
into the drive trace's `a` field, on the default stage — 2. `0x8094` is the
actor's `at`, printed as `a.at.toString(16)` by the actors panel, and `at` is
the **evt address of the spawn descriptor**. Stage 2, block 14, step 8, op 2 is
a `spawn_obj` of one placement: `at 32916`, class 49, char type 22 (`zsass`),
`body_condition 1`, `hp 130`, `initial_state 20`, dropping from y 37.9 to
y −14.9. Op 18 of the same step is `wait_enemies_alive <= 0`. All of it
`[proved]` off the exported bundle rather than assumed.

### The answer

`DispatchHit` (`FUN_004092F0`) is the **only** caller of `ResolveHit`
(`FUN_00409430`) in the image, and it jumps past the call while `obj+0x34` bit
`0x100` is up (`00409339 f6c501 TEST CH,0x1` / `0040933c 750e JNZ 0040934c`).
So shot-immune means **no damage at all**, and the port had never implemented
that half — only the *reaction* half, which `ThrowerOnShot` (`FUN_004499A0`)
and `ZombieOnShot` (`FUN_00453EB0`) both test the same bit for.

That is the whole bug, and its shape is nastier than either half alone. The
window the bit covers is exactly the window nothing is listening in: a `zsass`
shot to death while lying on the ground or getting up reached zero hit points
with no reaction chosen, and `ThrowerStateFallAndLand`'s **sub 4 is a switch
arm**, reached from `obj+0x1312` rather than through sub 3's survive test — so
nothing on that path ever re-reads `dead`, and its own death state stood the
corpse back up. It then threw, pounced and leapt aside while dead, inside
`g_enemies_alive`, holding the step's gate open behind it. The death sound was
never wrong: `ResolveHit` really had killed it.

Three doc comments already said the rule out loud — `ThrowerOnShot`'s
*"Downed, so the shot only ricochets; the result was forced to 5"*,
`ActorShotFeedback`'s note that class 0x31 *"has its own copy in
`ThrowerShotFeedback` that forces result 5 while the thrower is down"*, and
`ThrowerStateGetUp`'s *"a real invulnerability window — shots ricochet off a
thrower that is getting up"*. **[L26](../LESSONS.md) three times in one class,
and not one of them was a check.**

### The wrong turns, in order

1. **Spent a long time trying to reproduce it as a hang, and it is not one.**
   Every route I tried first — the isolated state machine, the seeded sweep
   over firing rates and bones, a 30-clicks-a-frame volley in real Chrome at
   the spot, and the full stage-2 playthrough — killed the actor cleanly and
   cleared the gate. The report says *"doesn't **seem** to die"*, and the
   symptom is a **transient**: dead and acting until the next round happens to
   land somewhere the reaction is not vetoed. My first success criterion,
   "dead and still in the pool at the end of the run", could not see it. The
   criterion that could was **frames spent dead in a state that is not one of
   the four death states**, and it fired on 2,224 of 11,520 patterns
   immediately.
2. **Chased the survive-versus-die predicate first**, because it is the obvious
   suspect and the brief named it. It is right in the port:
   `if ((obj+0x34 & 0x4000000) == 0 && obj+0x1350 != 0x5a)` get up, else die.
   Not wasted — it produced one finding worth keeping (below) — but two hours
   of it were spent on a correct line.
3. **Suspected `obj+0x1F1` of being the answer.** The die arm of case 3 carries
   a second gate on that byte. It has **six reads and no writes anywhere in the
   image**, so it is always zero and the whole arm is unreachable — dead code
   of the same family as `obj+0x3B8` in `ResolveHit`. `[proved]`, and not
   ported. That reading also went the *wrong way* for the bug: a port that
   omits the gate dies more readily, not less.
4. **Read `render/shooting.ts` for the death sound before believing it.** The
   kill voice is played off `HitResult.killed`, which `ResolveHit` sets, so the
   sound proved the hit points really had reached zero and eliminated the
   "hurt voice mistaken for a kill" reading in one look.

### What landed

* `DispatchHit` named and documented in `functions.tsv` and renamed in the live
  database. It had a row with an empty comment.
* `DispatchHit` in `game/combat/resolve_hit.ts` — the gate and the call, which
  is the part that decides anything; `[diverges]` on the per-player loop, which
  the port's shot queue answers elsewhere.
* `ResolveShotRequest` goes through it, and a refusal is a **ricochet, not a
  miss**: `g_hit_result = 5`, `ActorShotFeedback` runs, no score and no head
  combo, because `ResolveHit` is what does both and it did not run.
* Ten assertions in `web/test/port.test.ts`. Five fail without the fix; the
  loudest is **601 frames dead in `LeapAside`**.
* `web/tools/downed.mjs` drives the page at `?stage=2&block=14&step=8` and
  measures hit points lost while the actor was in the immune states: **1 round
  and 35 hp at frame 353 in `FallAndLand` sub 4** before, **0** after.

### What is left

* **The port's `ThrowerStateFallAndLand` sub-4 tail omits two lines the engine
  has for character type 0x16**: `obj+0x133C = 0x1e` and a re-raise of
  `obj+0x34` bit `0x100` (`0044a7e8 80cc01` / `0044a7eb c7863c1300001e000000`),
  which give a thrower thirty more frames of invulnerability after it stands
  up. `EnemyThrowerUpdate` already has the countdown that would clear it. Seen
  while reading case 3; not ported, because it is a second behaviour change and
  this commit is one. `[open]` in the sense of unported, not undetermined.
* **`ThrowerStateHitReaction` can be re-entered indefinitely.** Shooting a
  `zsass` once every 45 frames held it in state 1 sub 1 for 400 frames in the
  fixture without it ever reaching the hub. Noticed while building the
  reproduction; not chased, and not obviously wrong — the engine may do the
  same.
* **The same gate covers class 0x30**, whose emerging and script-frozen
  zombies the port also let you damage. No report has been filed against that
  and no assertion was written for it; the fix is generic and covers it.

## Where a stage ends, and where the next one starts (2026-09-07)

Asked for two things: that choosing a stage offer the different starting points
stages 3 and 4 have, and that the stage-to-stage transition be ported at all.
Both turned out to be one reading.

### The reading

`EvtAdvanceStepOrRoute` (`FUN_0045F000`) was already transcribed, including the
part where a `kind == 2` record does `block + 1` rather than ending anything.
What had never been read is the arm below it, the one taken when the block it
lands on is a hole. At `0x0045F0DA`:

```
MOV EDX, dword ptr [EAX*0x4 + 0x597890]     ; g_scene_routes[scene]
MOV AX,  word ptr [EDX + ECX*0x8 + -0x6]    ; ECX = the hole's index
MOV [0x009a2bc0], AX                        ; -> g_evt_block_index
```

`block * 8 - 6` is record `block - 1` at `+0x02`, which is `next[0]` of the
record the walk just left. For a terminal record that is the record itself, and
the hole after it is what made the scene end. So **a terminal route record's
`next[0]` is the block the next scene opens at**, and every reachable terminal
record in the shipped tables is followed by an all-`-1` record, which is the
mechanism rather than a coincidence.

Nothing between there and `FUN_0045EBC0` writes `g_evt_block_index` again. The
chain is `MarkSceneOver` (`FUN_0045ED90`, newly named) hands `g_nRunPhase` to
5; `RunPhaseArmSceneAdvance` (`FUN_00460390`) steps it to 6;
`RunPhaseStepToNextScene` (`FUN_004603B0`) does `g_scene_index += 1` and hands
it to 1; phase 1 is `AdvanceToNextScene`, which loads. The phase machine is a
thirteen-entry table at `0x005679A8` with one caller, `RunPhaseDispatch`
(`FUN_0045FEE0`) -- all newly named.

The shipped answer, from a forward walk of the route graph: nineteen `kind == 2`
records exist, **nine are reachable**, and two name a block other than 0.
**Stage 3 opens at block 0 or block 7; stage 4 at block 0 or block 4.** Nothing
else in the game has a choice, which is exactly what was reported. Following
slot 2 -- Original Mode's road -- changes none of it: both modes reach the same
nine endings.

### What was wrong in the tree

* `docs/formats/evt.md` said `AdvanceToNextScene` sets `g_scene_index`. It does
  not; it only loads. Phase 6 had already incremented it a frame earlier.
* `Program.entry_block` was "the first block that is not a hole", with a doc
  comment saying the route table is "a forward graph with no separate entry
  record". That gives 0 for every scene, which is right for four of the six by
  accident and cannot express the other two at all.
* The walker set `finished = true` and stopped. Nothing had read what happens
  next, so the player had no transition.

### What was built

Bundle format 5: `entries` and `exits` on `<stage>.script.json`, from
`ExeTables.scene_exits` / `scene_entry_blocks` in both exporter halves.
`Walker.reset` takes the entry block, because in the engine it is an input --
`FUN_0045EBC0` reads the global as it finds it. `Walker.nextEntryBlock` carries
the handover. `Player.advanceScene` follows it in Play mode. `?entry=`
addresses one, and the top bar grows an **Entry** select on exactly the two
stages that have a choice.

`tools/verify_scene_exits.py` is the check, and it discriminates: reading
`next[1]` instead of `next[0]`, or the record after the hole instead of the one
before it, both fail it. `web/test/port` was not the right home -- the
assertion needs real scripts -- so it went in `test/seek.test.ts`, which drives
each stage from each of its own entries to an ending and gets `0->0`, `7->4`
for stage 3 and `0->0`, `4->0` for stage 4. `web/tools/transitions.mjs` drives
the page: the picker appears on 3 and 4 and nowhere else, `?entry=7` really
starts in block 7, and stage 1 played out of its terminal block reaches stage 2
without a reload.

### What I got wrong

**I spent a while convinced a restored file was still broken.** Mutation-testing
the new check, I flipped `nxt[0]` to `nxt[1]` in `exetab.py`, ran, and wrote the
original back -- same length, same second. CPython validates a `.pyc` on the
source's mtime-to-the-second and size, both of which now matched the mutant's,
so every later run imported the mutation while `git diff` was empty and `grep`
showed the right text. `find -name '*.pyc' -newer` finds nothing, because
nothing is newer. Recorded as **L31**.

**I also aimed the browser harness at the wrong button.** "Play" is a *mode*
button; the transport's is `▶`. Clicking the label that reads Play left the
page paused and the transition looked broken for one run.

### Left open

* `GameMode.ARCADE = 2` in the exporter looks like it should be 0, with 2 being
  training -- four independent arms of `g_GameMode` say so. Filed in
  `docs/BUGS.md`; not acted on, because the enum's value is in every shipped
  bundle and `g_GameMode`'s three writers have not been read.
* Run phases 2, 3 and 4 are the continue screen and phase 7 is the ending.
  Neither is ported; the player stops after stage 6.
* `FUN_00497440` and `FUN_004996C0` also write `g_scene_index` and have not
  been read.

## `op 10` is an `if`, and the player was on the wrong side of it

**The report.** *"James (the player controlled character) doesn't seem to
render in 3rd person in the cutscenes, e.g. at
`?stage=3&mode=play&block=2&step=5&op=22&frame=30`"*, `docs/BUGS.md` B21.

### What the data calls him

Not "James" — the shipped data has no name table for characters, so the
identification runs through the asset filenames, which is the closest thing to
one. Stage 3's block 2 step 5 places four class-0x25 humanoids in two
`spawn_obj` opcodes:

| descriptor | char type | skeleton resolves to | nodes |
|---|---|---|---|
| `0x3378` | `0x39` | `gameover_player.bin` | 15 |
| `0x345C` | `0x3A` | `char_adv05.bin` | 15 |
| `0x3508` | `0x3B` | `char_adv05.bin` | 15 |
| `0x3594` | `0x3C` | `char_adv05.bin` | 15 |

`gameover_player.bin` is the only asset file in the game whose name says
*player*, and step 4 of the same block loads `player1.bin`…`player4.bin` and
step 6 frees them again around this cut scene. The two spawns at the *same*
point — `0x3378` and `0x345C` — are the pair, and which of them stands there is
decided at run time. That is as far as the evidence goes: the model is
`[proved]` to be the one the game calls the player's; *James* is the user's
name for it and is not in the data.

Class **0x25**, character type **0x39**. Not class 0x10, not an attachment
list, not type 0x17's sub-part mechanism — three of the four shapes the brief
named, and none of them was it.

### He was placed. He was killed.

The sidebar answered the first question in one look, which is what it is for:
the **Actors** panel listed all four at `?stage=3&block=2&step=5&op=22`, so
nothing was unplaced and nothing was an unported class. Two of the four drew
and two did not, and the two that did not were the two at `d=16` — the pair.

`ScriptedHumanoidUpdate` (`FUN_004842A0`) case 10, at `0x0048478C`:

```
0048478C  MOV EAX,ESI                    ; the command
0048478E  MOV [EDI+0x1320],EBX           ; stallFrames = 0
00484794  ADD ESI,0x8                    ; and step one command by default
00484797  MOVSX EAX,word ptr [EAX+0x2]   ; the mode
0048479B  SUB EAX,EBX / JZ 00484809      ; 0
0048479F  DEC EAX     / JZ 004847D9      ; 1
004847A2  DEC EAX     / JNZ 0048435D     ; anything else -- nothing to do
004847A9  CMP dword ptr [0x009c7000],0x2 ; 2
004847B0  JZ 0048435D                    ; matches: fall into the arm
004847B6  MOV CX,word ptr [ESI+0x2]      ; else scan for the -2 marker,
004847BA  ADD ESI,0x8                    ;   eight bytes at a time,
004847BD  CMP CX,-0x2 / JZ 0048435D      ;   and resume after it
```

`0x009c7000` is **`g_active_player`**, not `g_players_in_play` (`0x009C8E80`).
`SelectAttackablePlayer` (`FUN_00414F40`) writes -1 for nobody, 0 or 1 for that
player alone, 2 for both — and for one player in play it picks 1 unless
`g_player_state` is 5 or 7, so an ordinary single-player game on slot 0 sits at
0. `[proved]`

The two programs, at `st3evtbl.bin` `0x33B4` and `0x3498`, are one shape:

```
op 0  mode -1        wait then play
op 9  mode 1 a 0|1   the hand model, one per character
op 10 mode 1|0       if the active player is the *other* one:
op 18                    ActorKill
op 10 mode -2        endif
op 10 mode 0|2       if it is this one:
  ...                    the performance
op -1                    end
op 10 mode -2        endif
  ...                the two-player arm
```

The port's `IfPlayerCount` — the name was the reading, and the reading was
wrong — always stepped one command, with a comment saying that one player is
the port's only configuration so "taking the matching arm is the same
decision". It is not the same decision when the arm is `ActorKill`: **both**
player characters ran the kill on the frame they spawned, and
`render/characters.ts` will not draw an actor whose `visible` is false. The
other two humanoids in the shot have no `op 10` and drew perfectly, which is
what made it look like a missing model rather than a missing branch.

It is not a stage-3 defect. Walking every exported program to its first
blocking wait, **110 of the twelve bundles' 274 class-0x25 spawns** reached an
`ActorKill` on the frame they were made; with the branch it is 42, and those 42
are the twins that are supposed to go. Per stage set: 4→2, 16→7, 16→8, 13→4,
3→0, 3→0.

### The exporter had the same hole one level down

`humanoidCommandOffsets` followed fall-through and `op 15`'s jump. `op 10` has
a second successor and it followed neither, so the walk stopped at the `op 18`
inside the first arm: the bundle carried a **four-command** program every path
of which ended in a kill, and the arm the actor actually runs — six more
commands, two more clips — was not in the file at all. Following the skip takes
the six stages' decoded stream from 2,770 commands to 4,940 and adds motion 845
and 883 to character type `0x39`'s bake.

The skip is emitted as an **index**, the way `op 15`'s pointer already is. The
scan that produces it is transcribed literally, stride 8 and all: it reads the
second `s16` of each eight-byte window and takes no notice of the sixteen-byte
commands, which is the engine's own arithmetic and would desync on an arm
containing an `op 7`, `op 8` or `op 4` mode 4. None does, and
`verify_scripted_clips.py` is what says so rather than a comment.

### What landed

* `web/src/hod2lib/charmotion.ts` + `tools/hod2lib/charmotion.py` —
  `humanoidSkipTarget`, and the walk follows it. Both halves, one commit.
* `web/src/hod2lib/bundle.ts` — `skip` on every `op 10` mode 0/1/2 command;
  `web/src/bundle/scene.ts` declares it.
* `web/src/game/class25/index.ts` — `IfPlayerCount` → **`IfActivePlayer`**, and
  it branches. A command with no `skip` (a bundle written before this) leaves
  the VM rather than running the arm, because on screen and wrong beats deleted.
* `tools/verify_scripted_clips.py` — the two structural properties the port's
  `pc += 1` depends on. Reverting the exporter half makes it report 74 faults.
* Four assertions in `port.test.ts` and seven in `render.test.ts`, the latter on
  the **scene graph**: the rig node is there, its bone is a `Mesh`, it is
  visible, and it is at `(-522.7, -14.9, -3883.2)`, which is what the descriptor
  says. Reverting the port half fails 2 of those and 4 of the port ones.

### Wrong turns

1. **Started from the brief's strongest hypothesis and it was wrong.** The
   brief pointed at `drawVariant`, at the three unread `ActorBindPartList`
   callers and at type `0x17`'s sub-part divergence, in that order. All four
   spawns have `drawVariant` 0; class 0x25's Init calls `ActorBindPartList`
   itself, so none of the three unread callers is involved; the character type
   is `0x39` and not `0x17`. Checking the bundle first — the placement is
   there, the type is there, the motion is baked, the `chr_gameover_player`
   rig is in the glTF with eight instances — closed all three in about ten
   minutes and pointed at the runtime instead. **The bundle was never the
   thing that was missing**, which is the opposite of the last two stage-3
   bugs and is why the assumption in the brief was so plausible.
2. **Assumed `g_active_player` was 0 for a single player before reading
   `SelectAttackablePlayer`.** It happens to be right, but only through
   `g_player_state == 5`; the routine's *other* arm writes 1 for one player in
   play, which reads backwards until you notice the state test is on player 0.
   Had the guess gone the other way the fix would have killed the wrong twin
   and looked correct in the screenshot, because there is exactly one character
   on screen either way.
3. **Read the decompiler's `pfVar10 + 4` and `+ 10` as a command shape.**
   Ghidra types the command cursor `float *`, so every offset in case 10 comes
   out in units of four bytes and the `-2` looked as though it lived in a
   command's second field for no reason. It does live there — the marker is an
   `op 10` whose *mode* is `-2` — but that only became legible from the
   disassembly. L1's cousin: the pseudocode was not wrong, it was unreadable.

### What is left `[open]`

* **`op 9`, `op 16` and `op 17` are still stepped over**, with the existing
  `[diverges]`. `op 9` is the hand model, and both player-character programs
  carry one (`a 0` and `a 1`, the two entries of `DAT_004EC9E0`'s row) — so the
  character is drawn without whatever it is meant to be holding. Reading
  `0x004EC9E0` and `PTR_DAT_004C7160` is its own job.
* **Boss Mode remaps character types `0x39` and `0x3A`** through the two
  selected-player bytes at `0x009A2242`/`0x009A2256`, per the existing
  `[diverges]` on `ScriptedHumanoidInit`. Nothing in the port chooses a player
  character, so the descriptor's own type stands; with `g_active_player` fixed
  at 0 the port always shows type `0x39`.
* **`g_active_player` is a constant in the port.** Nothing calls
  `SelectAttackablePlayer`, so it is 0 for ever. That is the right value for
  the one configuration the port has, and it is not the routine.

---

## The frame a shot ends on — stage 3's camera jump

**Report:** *"the camera seems to jump quite a bit just shortly after
`?stage=3&mode=play&block=2&step=4&op=24&frame=1551`"*. One of the five filed
against stage 3 block 2 on 2026-09-07.

**Outcome:** `[fixed]`, and it was **the port's own advance** — not the
authored path, not the tracking layer, and not a region or slot change. The
engine does not do it.

### The measurement, before any of the reading

The report's "shortly after" was an estimate; the jump is at **camera frame
1660**, 109 driven frames after the address in the URL. Measured in real
Chrome off the Camera panel's own `eye` and `block target` rows — the pair the
draw writes, so it is the transform on screen and not a layer's account of
itself — one driven frame at a time:

```
i108  cf 1659   eye -495.5, -10.1, -3480.0   move 1.21   turn 0.00
i109  cf 1660   eye -495.5, -10.1, -3480.0   move 0.00   turn 9.58
i110  cf 1662   eye -493.8, -10.1, -3483.2   move 3.62   turn 9.46
i111  cf 1663   eye -493.2, -10.1, -3484.3   move 1.25   turn 0.17
```

**The eye holds still for the frame that says 1660 and then moves 3.62 units,
where the shot travels 1.25 a frame; the aim swings 9.58 degrees off and 9.46
back.** `eye(i109)` is `pose(1659)`, exactly — the block was never written for
1660.

Two things were ruled out before the binary was opened:

* **The authored `cam/` path is smooth.** Evaluating `cp_st3` slot 127 through
  the port's own `CamPath.pose` over 1430..2040 gives a largest per-frame eye
  step of 1.28 units and a largest turn of 4.0 degrees (at 1943, a deliberate
  sweep). There is no discontinuity in the data anywhere near 1660. `[proved]`
* **No region, slot or shot change lands on 1660.** Slot 127 plays 1320..2035
  across the whole of block 2 step 4; the shot boundaries are inside one path.

### The wrong turn, and it is worth knowing about

The brief's first experiment was the sidebar's **Track** toggle: *"if the jump
vanishes with tracking off, it is the tracking layer."* It vanishes with
tracking off. **It is not the tracking layer.**

`trackEnemies` has exactly one consumer in the tree — `seatCamera`'s
`|| !rig.trackEnabled` — and that term is in the same disjunction as the
condition that was wrong, so turning it off forces the block to be seated and
masks the defect. It does not stop `CameraTrackEnemiesTick`: with Track off the
aim is still eased and still sits about 10 degrees off the rail, at
`LOOKAT_RADIUS` from the eye. So the toggle's tooltip — *"Off restores the
authored cam/ path exactly"* — overclaims, and the experiment it invites is a
false positive. It was still useful: it produced the same numbers the fix
later did (1.17 then 2.46, no flick), which is what identified the missing
block write rather than the ease.

### `CamAdvancePathFrame` (`FUN_004035E0`), off the instruction stream

```
00403605  MOV  EAX,[ESI + 0x9a6144]   ; cur = g_cam_path_cursor
00403615  MOV  [ESI + 0x9a6110],EAX   ; g_cam_path_frame = cur      PUBLISH
00403632  CALL 0x004041e0             ; CamEvalPath7 -> block eye + target
0040363e  CALL 0x00403ac0             ; CamBlockSetAnglesFromLookAt
00403658  MOV  [0x009c6f28],EDX       ; g_cam_path_frames_left = end - cur
0040365e  JL   0x00403698             ; cur >= end ?
00403664  ...                         ; g_queued_events_pending--   (slot 0)
```

**The publish, the curve evaluation and the block write all happen before the
end test.** So the block holds the pose of every frame from `start` to `end`
**inclusive**, and it is the frame *after* the end that is never written.
`[proved]` — `globals.tsv`'s `g_cam_path_cursor` row already said this about
the publish; what had not been carried across is that the *pose* is on the same
side of the test.

The port seated the block on `!cam.done`, and `done` is set on the tick the
path reaches its end. One tick short, on every non-static `cam_play` in the
game. What made it visible here rather than everywhere is the compounding:

1. the eye keeps `pose(1659)` for the frame that reads 1660;
2. the shot's aim is **not** reseated to the path's own target that frame, so
   `CameraTrackEnemiesTick`'s ease takes one unopposed step towards the enemy
   — 9.58 degrees — and snaps back the next frame when the reseat resumes;
3. the shot that follows is a deferred one, `queue_event cam_play 1661..1754
   flags 2` then `finish_sequence 7`, and `CameraPlayStashedPath`
   (`FUN_0040C8A0`) increments before it evaluates, so its first drawn frame is
   **1662**. Eye 1659 to eye 1662 in one frame is the 3.62 units.

### What was changed

`CamCommand` gains **`retired`** — the action handler has been dequeued and
nothing writes the block from this shot again — which is `done` plus one tick,
and that tick is the shot's last frame. `advanceCameraPath` sets it on the
first tick that finds `done`; `seatCamera` seats on `!retired` instead of
`!done`. The branch-override arm keeps `advance` false, as its own comment
requires. Static poses and `finish_sequence 4` are `retired` from the start,
because nothing publishes for them.

### `[not-a-bug]`, and stated so the next reader does not chase them

* **Frame 1661 is never drawn, by the engine too.** The stash holds 1661 and
  `CameraPlayStashedPath` increments first, so 1662 is the first frame it
  evaluates. The residual 2.46-unit step at the boundary — 1.9x the shot's own
  1.25 — is the engine's own and is one sixtieth of a second. `[proved]` from
  `FUN_0040C8A0` against `FUN_004035E0`.
* **The aim snaps about 10 degrees back onto the rail on the frame the last
  enemy deregisters**, mid-shot (measured: 9.97 degrees at camera frame 1692,
  and it is there before and after this fix). That is structural:
  `CamAdvancePathFrame` rewrites `g_camera_block_target` from the path every
  frame, so when `SelectCameraLookAtTarget` falls back to the path's own target
  the ease has nowhere to go and the aim is the path's within one frame.
  `select_target.ts`'s "swings back over about thirty frames" describes the
  *other* case — a shot that has already retired and left the block frozen.
  `[proved]` structurally; not smoothed, per L27.
* The 35.7 and 18.3 degree turns on the **first three frames** of the run are
  the deep link settling: arriving at `frame=1551` draws one frame from an
  unplaced camera before the tracking layer has an actor.

### The checks

* `web/test/camera.test.ts` grew a second stage. **Stage 1's opening could not
  carry this**: it reaches exactly one shot boundary in six hundred frames and
  slot 32's curve is flat there — frames 229 and 230 are the same point — so
  the assertion passes on it whatever the seat does. That is how the first cut
  of the check came back green against the unfixed code, which is L14 in a new
  costume: a check that cannot fail is not a check. Stage 3 block 2 step 4
  plays five `cam_play`s back to back with the eye moving 1.25 units a frame,
  so it crosses five boundaries in seven hundred frames.
  * *every drawn eye is its shot's own pose, last frame included* — the drawn
    `camera.position` against `CamPath.pose` recomputed from the bundle, an
    equality rather than a tolerance. **5 of 700 frames fail without the fix,
    worst 1.242 units.**
  * *no shot boundary swings the aim out and straight back* — **1 flick
    without the fix, 10.23 degrees.**
  * a coverage assertion beside each, stated without reference to `retired`.
* `web/tools/cam_jump.mjs`, a sibling of `stage3.mjs` — `stage3.mjs` itself is
  untouched, three other agents are in it. It drives the reported URL in real
  Chrome a frame at a time and asserts on the Camera panel's own readouts: no
  bracketed stall, and no aim flick. **2 of its 3 checks fail before the fix**
  (`i109 cf=1660 (0.00 between 1.21 and 3.62)`, and 9.46 degrees at frame 110);
  0 after. `npm run cam-jump`.

### Named in `functions.tsv`

* `CamBlockSetAnglesFromLookAt` (`0x00403AC0`) — was `FUN_`. Writes the camera
  block's pitch/yaw/roll from `eye - target` through `VecToAngles`, immediately
  after `CamEvalPath7` and before the end test.
* A body comment on `CamAdvancePathFrame` (`0x004035E0`), which had a bare row.

`VecToAngles` (`0x004016B0`) is named in the TSV and **not** in the live
database — the decompiler still calls it `FUN_004016b0`. Expected, per the
merge behaviour of `export-annotations`, but worth knowing when grepping.

### Next actions

* The **Track** toggle's tooltip is wrong and its one consumer is a term in
  `seatCamera`'s disjunction. Either make it mean what it says — skip
  `CameraTrackEnemiesTick` — or reword it. `[open]`, `ui/panels/Toggles.tsx`
  and `render/camera.ts`; not touched here because it is a behaviour question
  and the report was not about it.
* `web/tools/lookat_live.mjs` is **stale and silently measures nothing**: its
  regex wants a `look at` row and a `slot N frame X / Y` line, and the Camera
  panel has had `slot`, `frame`, `eye`, `facing` and `block target` for some
  time. `npm run lookat` therefore reports 0 frames with a camera. Not fixed
  here; `cam_jump.mjs` covers the same ground on the driven clock.
* **One decision for the user.** `seatCamera`'s branch-override arm is
  gated on `cam.done`, and its own `[diverges]` note says the engine tests
  `g_cam_path_frames_left < 0` — strictly past the end. `retired` is now
  exactly that test, so closing the divergence is one token. Not taken:
  it moves the frame a branch's preview shot arms on, at every
  `store_six` in the game, and nothing has reported that. The cost of
  leaving it is that a shot whose end lands while `camOverrideValid` is
  up still loses its last frame — the same one-tick error, in the one
  place this commit does not fix it. Named on the spot in
  `app/systems.ts`.
* `FUN_00402EF0`, the ease of the block **eye** toward the deferred-rail pose
  at 0x009C70C0, is still unported and still `[open]` — noted in
  `game/camera/track.ts`. It is the remaining reason a port eye can differ
  from an engine eye while a shot is retired.

## `wait_script_flag` is a gameplay gate — the hostage the boat sailed past

*2026-09-07. Report: "the civilian/enemy are jumped over" at
`?stage=3&mode=play&block=2&step=4&op=0".*

### What "jumped over" turned out to mean

None of the three readings offered. The actors were **placed and running**;
the camera did pass them; but the reason it passed them is that **the script
never stopped**. Stage 3 block 2 step 3 ends

```
27  0C spawn_obj_c        0097A608     the hostage, class 0x10 at 12808
...
35  45 wait_script_flag   0000001E     flag 30
36  31 goto_scene_state   00000003
```

and in the port that wait passed on the frame it was reached. Measured from
`?stage=3&mode=play&block=2&step=3&op=27&drive=1`, driven clock, `now().o`
read every frame: the hostage and her captor enter the pool at f≈4, the walker
reaches op 28 and then **op 31, and is in step 4 by f56** — 52 frames after the
spawn, with `v1` and `e1` still live and the captor's maul (class 0x30 states
34 → 35) still running. Step 4's `cam_play 1320..1389` then sails down the
canal and leaves them behind the camera, which is what a viewer sees.

### The defect: one array kept in two places, one of them clobbered

`g_script_flags` — 0x009C7200, 0x100 bytes, cleared only by
`ResetSceneOnEnter` (`FUN_0045EDD0`). `EvtOpSetScriptFlag48` (`FUN_0045FD70`)
is the whole of the script's write, `EvtOpWaitScriptFlag45` (`FUN_0045FC80`)
is the whole of the read, and **six actor routines write the same array**:
`CivilianRunScript`'s op 0x1C (`0x0048BF2A`),
`ZombieStateTargetScriptWithFlag` (`0x0045B1DF`, class 0x30 state 36),
`FUN_00433f40` (`0x00433FC1`, a class-0x33 cue prop), `FUN_00473cf0`
(`0x00473D76`) and the class-0x44 constructor at `0x0047314A`/`0x00473156`.

The port had **two** stores:

* `Walker.flags`, a `Set<number>` written by opcode 0x48 and read by 0x45;
* `G.g_script_flags`, written and read by the classes.

…and `app/systems.ts`'s `syncPortGlobals` did

```ts
G.g_script_flags = [];
for (const flag of w.flags) G.g_script_flags[flag] = 1;
```

**once a frame**. So a flag an actor raised survived until the next tick and no
further, and `wait_script_flag` could only ever see the script's own writes.

The kicker, and the thing that says how big this is: across all six shipped
scripts, **every one of the forty-odd `wait_script_flag` gates names a flag
that script's own `set_script_flag` never sets.**

```
stage 1  waits 3, 35, 36, 248, 254      none of them set by the script
stage 2  waits 3..7, 10..17, 248, 254   none
stage 3  waits 21, 30, 248, 254         21 is set (block 1); 30, 248, 254 not
stage 4  waits 19, 20, 29, 31, 32, ...  19 is set; the rest not
stage 5  waits 0, 30, 31, 248           none
stage 6  waits 248                      none
```

The opcode is *only* ever "hold until an actor is finished". The port was
walking past every rescue in the game, not just this one.

### Who raises flag 30

The hostage herself. `civilians.spawns["12808"].script` is **27**, and that is
an index into `g_civilian_scripts` (`entries`), not into `scripts`:
`entries[27] = 64`. Stream 64 command 17 is `SetScriptFlag 30`, reached after
the block whose wait word is `0x00080000` (leave `g_civilians_alive` now) —
i.e. **once she has been rescued**. Her on-shot stream 63, which the killed
branch of `CivilianCheckShot` also runs when the captor mauls her, raises the
same flag at command 12. So the gate opens whichever way the encounter ends,
which is why the real game never hangs on it.

### The fix

One array. `set_script_flag` writes `G.g_script_flags`; `wait_script_flag`
reads it through a new `WalkerHost.scriptFlagRaised`, the fourth of the
"questions about the world" beside `aliveEnemies`, `presentEnemies` and
`aliveCivilians` and with the same `null` contract for hosts that have no
object pool. `Walker.flags` is gone, `syncPortGlobals` no longer rebuilds the
array, `Walker.reset()` clears it (which is `ResetSceneOnEnter`'s job and was
what `this.flags.clear()` stood for), and `render/props.ts`'s hinge flags read
the same array.

New: `WaitRule.raisesScriptFlag`, the third wait postcondition beside
`retires` and `skipRunsCameraOn` — a seek that steps over a `wait_script_flag`
raises the flag, because in play the gate is only ever passed with the byte
already up.

### The wrong turns, in order

1. **Read `civilians.scripts[27]` instead of `scripts[entries[27]]`** and
   concluded the hostage's stream had no `SetScriptFlag` at all. That sent an
   hour into the binary looking for another writer, which is how
   `FUN_00480470` (class 0x32 state 4, `g_class32_states[4]`) got read and
   named — it raises flag 30 too, at `0x00480590`, but class 0x32 has two
   spawns in the whole game and neither is in stage 3. The annotation is worth
   keeping; the detour was not. **The indirection is documented in
   `bundle/scene.ts` and I did not read it.**
2. **Assumed the reported URL was where the bug was.** It is a *seek*, and a
   seek observes no waits by construction, so the step-3 encounter is left
   half-run there whatever this opcode does. The bug is only visible as a bug
   when the script is *played* from step 3. The URL is where the user was
   watching, not where the defect lives.
3. **Hand-listed the exception as `{248, 254}` and only then checked.** The
   list came from tracing the two flags every stage waits on; the sweep written
   to back it up found eleven more gates with no writer the port has, four of
   them in stages a player reaches long before the results screen. **The check
   that would have caught the first list is the one that was written to defend
   it** — L27 in its own words, one step later than it should have been.
4. **Built the test fixture's civilian stream with the flag in a block whose
   wait word was `Free`.** `CivilianStepScript` walks past a block whose own
   word is already satisfied and runs only `CivilianReapplyWaitCommand` over
   it, so the flag command was skipped and the assertion failed for a reason
   that had nothing to do with the fix. A word of `0` is what parks the VM on
   a block so its actions run.

### What is left

* **`[diverges]`, and it wants a call.** A gate whose flag *nothing this port
  runs can raise* passes instead of parking. The boundary is **derived from the
  bundle**, not listed: the stage's own `set_script_flag` ops, every civilian
  stream reachable from a class-0x10 spawn, and every captor script entry's
  fifth short. It was hand-listed as `{248, 254}` first, and the static sweep
  that was written to justify the list is what showed the list was wrong —
  honouring every gate unconditionally parks **stage 5 at block 1**, **stage 1
  at blocks 14 and 16**, stage 2 at blocks 35–41, stage 4 at 23–29, and all six
  on the chapter card. Fourteen of the forty-odd gates have a writer the port
  runs; the rest belong to `FUN_00433f40` (a class-0x33 cue prop, `[likely]`
  stage 5's 0/30/31 and stage 1's 3), the class-0x44 prop family
  (`FUN_00473cf0` / `0x0047314A`, `[open]` which owns which), and the banner
  actors `EvtOpSpawnSimple0A` places — flag 248 `[proved]`
  (`MOV byte ptr [0x009C72F8], 0x1` at `0x004348C1`) and 254 `[likely]`, since
  nothing in the image names `0x009C72FE`. Porting opcode `0x0A` and the two
  class-0x33/0x44 cue props is what deletes the escape.
* **`g_evt_gameplay_live` (`0x007DCCA4`) is still not modelled.** Every wait
  opcode but 0x41 requires it, and it is the engine's "a player is in state 5
  with lives left" — the script freezes on the continue screen. The port has
  no continue screen. `[open]`.
* **`verify_port.py`'s divergence list covers `web/src/game/` only.**
  `check_divergences` walks `game_files()`, so the **ten** `[diverges]` tags in
  `web/src/script/` — seven of them older than this session — are declared and
  never counted, and STATUS's "116 declared" is short by that much.
  `game_and_script_files()` is already in the file, three lines up, and is what
  the citation checks use. Not changed here: it moves a generated number three
  concurrent workstreams also regenerate. The one added by this commit is
  pinned by an assertion in `port.test.ts` instead, which is what L26 asks for;
  the count is the part that is still wrong.
* **A seek still lands with the previous step's actors alive.** `retires`
  answers that for the two enemy gates because their condition *is* a statement
  about actors; a flag gate's condition is a statement about a byte, and
  raising the byte is the whole of its postcondition. Which actors a flag gate
  was holding is not something the walker can know. `[open]`, and general to
  the seek rather than to this opcode.

---

## The axe thrower is class 0x30, and his retreat is a spawn bit

Two reports from stage 3 block 2, `?stage=3&mode=play&block=2&step=4&op=0`:
*"the axe throwing zombie retreats into the wall — in the real game if there's
nowhere for the axe thrower to retreat to, the game just continues"*, and
*"he doesn't throw any axes"*. They looked like one bug and they are two, in
two different halves of the tree.

### The premise was wrong, and checking it took one query

Both reports, and `BUGS.md`'s write-up of them, name the actor **class 0x31,
behaviour set 1 (`zsass`)** — the set `spawns.md` describes as the one that
"stands out of reach and throws". It is not.

```
st3evtbl.bin  {16, 19, 24, 32, 37, 38, 48, 65, 67, 68, 69, 70, 81}
```

**Stage 3 contains no class-0x31 spawn at all.** The actor at step 4 op 8 is
class **0x30**, character type `0x13` — asset file `tutorial.bin` — body
condition 7, initial state **33**, `ZombieStateStandAndThrow`. Its 2P twin at
op 9 is the same. The axe is `znonoo.bin` part 0, slot `0x249`, which is
exactly the polfile step 4 op 2 loads and op 28 frees. That is the same
mistake `BUGS.md` already records once — *"`0x6784` is class 0x30, not
0x31"* — and the same fix: read the descriptor rather than the description.
Half an hour went into class 0x31's router and pick tables before that query
was run, and none of it was needed.

### The retreat: `obj+0x38` bit 0x10, and two spawn records in the game

`ZombieStateWalkDistance` (`FUN_00457220`) was the obvious suspect and it is
**verbatim in the port**: it latches a distance, remembers a start point,
plays `row[4]`, and measures. There is no test in it of any kind, so the "is
there room behind me" the report describes cannot live there. Nor in the push:
the collision the script has selected at that point is `coli3.bin+0x2EA0`,
thirty-one quads of flat water at `y = -25`, twenty-four units below the
actor's feet, so `ZombiePushOutOfWorldAndActors` has nothing to push against.
Read that way, the engine walks into the building too — which is where this
sat for a while, and it was wrong.

The answer is one branch earlier. `ZombieStateStandAndThrow`'s ending is a
two-way switch at `0045945C` on **`obj+0x38` bit 0x10**, and the bit is put
there by `EnemyZombieInitByCharType` (`FUN_00452FD0`), which the port did not
have at all:

```
0045300B  if (obj+0x34 & 2) { obj+0x34 &= ~2; obj+0x38 |= 0x10; }
```

It **moves** the bit and clears it at the source, and it has to: bits 1 and 2
of `obj+0x34` are the two `MarkActorShot` writes to name the player who fired.
`ZombieStateStandAndThrow` is the only reader of `obj+0x38` bit 0x10 in the
image, and **exactly two spawn records in the shipped game set the `obj+0x34`
bit it comes from** — `st3evtbl.bin` `0x3078` and `0x30BC`, `init_flags
0x20002`, the two axe men. With it set the actor gives both enemy counters and
its permit back where it stands, goes shot-immune and camera-untracked, and
waits out `tail+0x1C` before despawning. It never moves.

So "if there's nowhere to retreat to, the game just continues" is exactly
right about what happens and not about why: it is not a query about the level,
it is a byte in the descriptor, and the level design is downstream of it.

Measured in Chrome at the reported URL, on the driven clock:

| | before | after |
|---|---|---|
| the actor at f430..f520 | `WalkDistance/2`, `z −3339.3 → −3361.7` | `StandAndThrow/6`, `z −3337.66`, unmoved |
| `g_enemies_alive` reaches 0 | f530 | **f430** |
| walker address at f440 | still `2/4/13` on `wait_enemies_alive` | `2/4/18` |
| despawn | f530, twenty-five units inside `st3_08` | f550, where it stood |

The wall is real, and it is not collision: `st3_08` runs a diagonal from
`(-643.3, -3340.4)` to `(-626.2, -3357.4)`, six units behind the actor, and
the old retreat ended about eleven units the far side of it.

### The axes: the throw was never the problem

The simulation threw all along — `throwers.mjs` reported "threw 2" for every
one of stage 3's six state-33 spawns before any change. What was missing was
every model involved. `charbuild.goreEntry` builds the hidden per-type rig the
client clones from, and it walks `char.throw_` — **class 0x31's** hand table —
and not `char.zombieThrow`, which is the one `ZombieThrowHandWeapon`
(`FUN_0045A240`) actually switches on. So slot `0x249` (the axe), `0x1ECE` /
`0x1ECB` and `0x1ECA` / `0x1EC7` (the two hands, held and bare) were in no rig
at all, `CharacterLayer.cloneSlot` answered null for the projectile, and
`swapGore` returned false for the hand — which leaves the axe in the fist.
The weapon flew, on time, and hit; there was nothing on screen to see it.

This is the civilians' hair again, one table over: *a model an exe table names
and no rig carries*. The assertion that catches it now lives beside that one,
in `verify_attachments.py` — 72 throwing-hand slots across the six stages, all
of which fail without the exporter fix.

### One wrong reading corrected on the way past

`ZombieThrowHandWeapon` also writes `*(bone * 0x90 + 0x284 + obj) = 0`. That
address was read as `0x20C + bone * 0x90` and **rounded** — `0x554` is bone
5.83 — giving the bundle a `weapon_bone` of 6 for the *right* hand, which is
the left upper arm. It is the same bone's record at `+0x78`, and
`SkeletonWalkNode` (`FUN_004107E0`) fills that field each frame with the hit
sphere's radius: emptying a hand makes it unshootable. The wrong write is gone
and the reading is in `combat.md`; the port does not clear the sphere, because
it tests the static table, and that is now a declared `[diverges]`.

`SkeletonWalkNode` turned out to say something wider while it was open: it
copies the sphere in **only when the table entry's own slot equals the slot it
has just written**, and writes zeroes otherwise. So in the engine a bone
showing a gore variant has no hit sphere either. Not chased, not ported,
`[open]`.

### Wrong turns, in order

1. **Believed the report's class.** See above.
2. **Reproduced the retreat and concluded the port was faithful**, because
   `ZombieStateWalkDistance` is verbatim and the collision is water. Both
   halves of that were true and the conclusion was still wrong; the test was
   in the routine that *hands over* to it, which I had read and skimmed —
   `case 6 is the despawn arm, reached only when obj+0x38 bit 0x10 is set.
   [open] Nothing read so far sets that bit`. That comment was in the port,
   in the file I was editing, and it was L17 in miniature: "nothing read so
   far sets it" had hardened into "nothing sets it".
3. **Went looking for the wall in `coli3.bin` and in the glTF** before looking
   for the branch. The geometry was worth having in the end — it is what says
   how far inside the building the old retreat ended — but it was an answer to
   the wrong question, and it cost more than the spawn-flag histogram that
   settled it in one line.
4. **Ran `npm run export` from the shared checkout** on the first try, because
   the command carried an absolute `cd`. It wrote 40 MB into the user's
   `extract/player`. L28, and the fix is the same: check where the tool wrote.

## The chapter card is an actor — `spawn_simple`, and the gates it opens

*2026-09-07, the follow-up to "`wait_script_flag` is a gameplay gate". The
call was: port the missing writers and delete the escape entirely.*

### It is not deleted. It is 50 gates down to 35, and the reason is worth more

The previous session's report said the escape needed "one spawn opcode and two
cue props". **That estimate was wrong**, and the sweep written to justify it is
what said so — the same shape of mistake as its own wrong turn 3, one level up.
What it had actually enumerated was the *register-indexed* writers of
`g_script_flags`; the flags that matter are written with **literal addresses**,
which `MOV byte ptr [ECX + 0x9c7200]` does not match. A whole-image search for
the string `9c72` in any operand finds 155 references and settles it.

The 61 `wait_script_flag` gates in the six shipped scripts, by what raises them:

| | before | after |
|---|---:|---:|
| honoured | 11 | **26** |
| excused `[diverges]` | 50 | **35** |
| stages with none excused | 0 | **2** (3 and 6) |

The fifteen newly honoured are every stage's opening chapter card (flag 248,
7 gates) and every result screen (flag 254, 5 gates), plus three more that were
only excused because those two were.

### What was ported

* **`EvtOpSpawnSimple0A`** (`FUN_00408990`), opcode `0x0A` — and 0x02/0x06,
  its player-count-gated forms, which the same `g_evt_spawn_gated_handlers`
  forward reaches. Its operands are **not** placement descriptors: each points
  at a two-word `{class, hp}` record, and the object places itself.
* **Class 0x60**, `ChapterCardInstall` (`FUN_004342E0`) — 180 frames, then
  `g_script_flags[0xF8] = 1` at `0x004348C1`, then `ActorKill`.
* **Class 0x61**, `ResultCardInstall` (`FUN_00434EF0`) — drops `g_nFiringGate`,
  420 frames, then `g_script_flags[0xFE] = 1` at `0x0043567C`, then
  `ActorKill`. That instruction is **the only reference to `0x009C72FE` in the
  image**: a byte search for the address finds one match.
* Classes **0x62** (`ResultCardTally`) and **0x63**
  (`InitCutsceneSkipWatcher`, already named) get a `SpawnClass` member and no
  module — they raise no flag, and a class with no module gets no behaviour.

The cards themselves are screen furniture — eight text slots at `0x007DCBA0`,
a light block, a score tally, two texbanks — and **none of that is ported**.
What is ported is the lifetime, which is the whole of the gate.

### The exporter had to change, in both halves

`spawn_simple`'s operands point into **`comevtbl.bin`**, the 0x200-byte buffer
loaded at `0x00977200` immediately below the stage table — offsets `0x34`,
`0x3C`, `0x44`, `0x4C`, the same four addresses in every stage. A stage
`EvtFile` resolved them to a negative offset and dropped them. `EvtFile.resolve`
now follows a below-base pointer into a com companion the stage loader attaches,
`read_simple_spawn` / `readSimpleSpawn` decode the record with the engine's own
**signed 16-bit** truncation of the second word (the shipped `0xFFFF0000` is a
zero, not four billion hit points), and `OpJson.simple` carries them.
`builder_hash` and `schema_hash` moved with it; all twelve bundles re-exported.

### What is still excused, and exactly what each one needs

Not props. **Four unported enemy classes and one prop update**, and the list is
in `script/waits/flag.ts` beside the code:

| gates | flag(s) | writer |
|---:|---|---|
| 20 | 10–17, 31 | class **0x14** (`FUN_00475E90`) — stage 2's blocks 35–41, stage 4's 23–29, stage 5's block 3. Writes spread over `0x00478350`..`0x0047BA6E` |
| 8 | 31, 32 | class **0x19** (`FUN_004917E0`) — `0x0049390C`, `0x004958C7` |
| 3 | 0, 3 | class **0x22** (`FUN_0049B0D0`), the stage-1 and stage-5 boss — `0x0049CC85`/`95` |
| 2 | 30 | class **0x32** (`FUN_0047F5F0`) state 4 — `0x00480590` |
| 1 | 20 | `FUN_004710C0` at `0x004710D7`, a class-0x41 prop that raises the flag and despawns on its first frame outside Original Mode. **The only remaining gate that is not an enemy class**, and the cheapest thing left |

### The two "cue props" open no gate at all

`FUN_00433F40` (a class-0x33 timer prop) and `FUN_00473CF0` (`HingeUpdate`)
both write `g_script_flags`, and both take the index from a **descriptor
field**. Cross-referenced against every `wait_script_flag` operand in the six
scripts: **neither opens one**. The previous session named them as the thing to
port; porting them would have changed nothing measurable. `[proved]` by the
sweep, which is in `tools/`-adjacent form in the session scratch and reproduced
by `docs/formats/evt.md`'s writer list.

### Wrong turns

1. **Estimating the remaining work from an instruction search that could not
   see half the writers.** `search_instructions` with the operand pattern
   `0x9c7200` matches the register-indexed form and misses `[0x009c72f8]`
   entirely, because that operand renders as `0x009c72f8` and does not contain
   the substring. Every literal writer — including both banner cards, the boss
   and class 0x14 — was invisible. Searching for the bare `9c72` found 155
   references where the first search found 15.
2. **Regenerating `schema_hash.ts` after exporting.** The bundle then carries
   the old stamp and the page refuses to load with *"this bundle was exported
   against a different `web/src/bundle/` schema"* — a blank loading overlay in
   every headless run, with no console error, which reads exactly like a hang.
   The order is: change the exporter, regenerate the hashes, **then** export.
3. **Setting `visible = false` on the cards, because they are screen space and
   nothing draws them.** `GameUpdate`'s loop is
   `if (obj.dead || !obj.visible) { … continue; }` — `visible` is this port's
   stand-in for "the character layer has built its hierarchy", not a statement
   about drawing — so both cards sat in the pool at sub 0 with their dwell
   never counted, and all six stages parked on the gate the port had just made
   real. `SpawnSlotActors` had the answer already: class 0x52's mouse has no
   character type either and is `visible = true`. The engine has no such test
   at all.

### Also in this commit

`verify_port.py`'s divergence list walked `web/src/game/` only, so the ten
`[diverges]` in `web/src/script/` — the whole of this escape among them — were
declared and never counted. It walks `cited_files()` now, which is the set its
citation checks already use, and STATUS's count goes 116 → 127. Recorded here
because the number is a measurement and the change to what it measures should
be findable from the number.

## Two of the three hangs were the harness, and the third was the Kill button

Three stages did not reach an end block: 2 at block 14 `9 / 20`, 3 at block 6
`1 / 13`, 6 at block 0 `4 / 8`. They were handed over as one family — "a count
or a slot that an actor did not release when it went" — and two of the three
turned out not to be in `web/src/game/` at all.

### What was actually standing in each room

Measured, not inferred: the page was driven to the hang under `?drive=1` and
`G` plus the whole actor pool dumped through a throwaway `probe()` on the drive
seam (removed again — the seam is a metronome and a tap, and `probe` was
neither).

* **Stage 2 block 14.** `g_civilians_alive` was already 0. Standing in the
  room: `char_adv02` at **220** hit points in `BackOff` and `char_adv00` at
  **100** in `HoldAtRange`, both class 0x30, both alive, both in
  `g_enemy_slots`, so `g_camera_free` was 0.
* **Stage 3 block 6.** `hito_mario2` dead and still counted, her killed script
  parked on wait bit 0 — `enemies-present` — and her two `znkage` captors alive
  at 90 hit points each.
* **Stage 6 block 0.** One class-0x31 `zslman`, `dead`, 0 hit points,
  `ActorFlag.Dead` up, `ThrowerFlag.LeftAlive` and `LeftPresent` both **clear**,
  cycling `RestoreBothHands` → `Throw` → `WaitForPermit` → `Pounce` as a
  corpse. `hits` and `latched` empty: it had never been shot.

### Stages 2 and 3: `wait_scripted_actors` needs the room clear

`EvtOpWaitScriptedActors46` (`FUN_0045FCD0`) is
`g_civilians_alive <= arg && g_evt_gameplay_live && g_camera_free`, and
`g_camera_free` (`0x009C6F2D`) is recomputed by `CameraDriverFromDeferredPose`
(`FUN_00402E00`) from the four slots at `0x009A5EC0..0x009A5EE0`. `[proved]`
So a 0x46 gate in a room with live zombies is held by the zombies, and the
civilian VM's own wait bits (`CivilianStepScript`, `FUN_0048B1E0`) read
`g_enemies_present` and `g_enemies_alive` besides.

`playthrough.mjs` refused to fire at a civilian gate on the reasoning that "you
do not shoot civilians, so a `wait_scripted_actors` that does not come down on
its own is a bug by definition". The premise is about *civilians*; the
conclusion is about the *gate*, and the gate is mostly about zombies. Letting
the tool fire at a civilian gate — unless the gate's own named blocker is a
civilian who is still alive, which is the one case the rule was written for —
takes both stages to an end block with the port untouched.

**Confirmed before writing anything:** a `--shoot-civ` flag on a throwaway copy
of the tool, on the unmodified port, and both stages reached an end. That
experiment is the whole reason this is a two-line policy change and not a week
in `combat/counts.ts`.

### Stage 6: the debug clear killed what a shot could not

`DispatchHit` (`FUN_004092F0`) refuses `ResolveHit` outright on `obj+0x34` bit
`0x100`, so **no actor can reach zero hit points inside `ActorFlag.ShotImmune`**
— and both enemy classes lean on that. `ThrowerOnShot` (`FUN_004499A0`) gates
its whole response on the bit at `004499f5 f6c401 TEST AH,0x1` /
`004499f8 0f85f8000000 JNZ 0x00449af6`, which is the routine's own tail, so the
dead arm at `00449a3e TEST EAX,0x4000000` is past it; `ZombieOnShot`
(`FUN_00453EB0`) is the same pair at `00453ec7`/`00453eca`. `[proved]`

`ActorKillAll` — the port's Kill button, which has no engine counterpart —
ignored that. The harness pressed it at 480 stalled frames, it caught a
`zslman` inside `ThrowerStateKnockedTumbling` (`FUN_00450E40`) sub 4, and the
actor was left dead and never told: its death chain never opened, so neither
`ThrowerReleaseSlotOnDeath` (`FUN_0044D050`) nor
`ZombieReleasePermitAndUntrack` (`FUN_004565A0`) ever ran and `g_enemies_alive`
sat at 1 for ever. One line, beside the `ClassHandler.invulnerable` test that
already carried the rule.

The tool also stops giving up: it keeps shooting after the clear, because the
clear now legitimately leaves that actor standing and the shots a second later
kill it in the ordinary way.

### What went wrong on the way

1. **`ActorRegisterCameraPoint` looked like it did not register anything.**
   `get_xrefs_to 0x00408ec0` returns eleven callers and not one of them is an
   enemy class, which for half an hour looked like proof that the port's whole
   camera-slot model was invented. It is not: `FUN_00409B70` ends
   `PUSH ESI / CALL 0x00408ec0` at `0x00409bec`–`0x00409c03`, and Ghidra has
   `MatrixStackPop` marked no-return, so the function body — and the xref —
   stop at the tail call. `disassemble_bytes` past the end found it. A close
   cousin of **L32**: a search over Ghidra's own view is a search over what
   Ghidra has disassembled.
2. **Believing the sidebar.** It printed *"Nothing alive is holding it — the
   camera gate (g_camera_free 1) is"* — naming the camera while showing the
   *free* value. `waitBlockers` filters `!a.dead`, so the dead-but-counted
   thrower was invisible to it and the empty list was reported as "the camera".
   Fixed to say which of the counter and the flag is above the line.
3. **Editing `web/src/` while a playthrough was running.** Three stages died
   with *"Execution context was destroyed, most likely because of a
   navigation"* and one with `__hotd2Drive` undefined, which reads exactly like
   a page that cannot start. It was Vite's HMR reloading the page under the
   driver. The runs were fine when re-run alone — **L29 again, and the other
   agent holding the device was me.**
4. **Deleting the debug clear.** With the tool shooting for the whole stall it
   looked redundant, and stage 5 promptly hung: four `znnick` at `d≈2880`,
   which nothing was ever going to hit. Put back, with the report kept.

## Class 0x41 type 75 opens stage 4's gate — and class 0x32 is not a flag writer

Picked up as "the two smallest remaining writers, 3 gates between them" out of
`ScriptFlagsThisBundleCanRaise`'s table. One of the two was small. The other is
a whole enemy, and saying so is most of what this session produced.

### Where the three gates actually are

Decoded all six shipped scripts (`tools/dump_stage_script.py --json`) and
cross-referenced every `wait_script_flag` operand against every
`set_script_flag` in the same stage:

| flag | gate | raised by `set_script_flag` in that stage? |
|---|---|---|
| 20 | **stage 4**, block 2 step 7 op 0 (`at` 7484) | no — stage 4 sets 0,1,3,7,9,10,11,17,18,19,21,30,33,34,224 |
| 30 | **stage 5**, block 7 step 4 op 23 and block 9 step 4 op 21 | no — stage 5 sets 1..13,16,21,22,23,224 |

Stage 3's block 2 step 3 also gates on 30 and is **not** one of these two: that
one is the hostage's own class-0x10 stream, which the port already runs.
`[proved]`

### `PropUpdateType75` — `FUN_004710C0`, `g_class41_updates[75]`

`0x005936BC + 75*4 = 0x005937E8`, which is the routine's only xref. Ghidra had
no function here at all; created one, and the decompilation then agreed with
the hand reading instruction for instruction.

Stage 4 block 2 step 5 spawns it at script address 9580, a `generic` container
of type 75 with `+0x11C` = 2 — both a two-step lifetime and asset slot 2. The
gate is two steps later in the same block.

**It raises flag 20 on three instructions, not the one the table named.** L32
again, from the other side: the previous session's sweep found `0x004710D7`
because it was looking for writers, not for *this routine's* writers. Reading
the whole routine found `0x00471120` and `0x00471263` as well:

* `0x004710D7` — the head, `if (g_GameMode != 1)`. Arcade Mode raises the flag
  **and then** despawns.
* `0x00471120` — on the **second** change of `g_evt_step_index`, if the prop
  has not been shot. `INC` then `CMP EAX, 0x2`: an equality, so it is that one
  change and no other.
* `0x00471263` — 290 frames after it is shot, when `obj+0x2C0` reaches
  `[0x0056914C]` = 290.0 at 1.0 a frame.

So the gate opens on its own in every configuration; shooting the prop only
changes how long it takes and what it drops.

The head matters more than it looks. Types 70, 71, 72 and 77 open with a bare
`if (g_GameMode != 1) { ActorDespawn(obj); return; }` and `generic.ts` gathers
them into `GENERIC_ORIGINAL_MODE_ONLY` — with an `[open]` note guessing that
74, 75 and 76 "are probably the same family". They are not. Adding 75 to that
set would have compiled, passed every existing test, and held stage 4's block-2
gate shut for the whole of Arcade Mode, which is the mode the player runs in.
The note is now answered for 75 and left `[open]` for 74 and 76.

Two more things the routine does that the shared prologue does not:

* It **does not call `PropExpireByStepLifetime`** (`FUN_00466640`). It inlines
  a variant of it with the `g_scene_index == 1 && g_script_flags[0x77]` sweep
  left out and the `obj+0x2A4` tick folded into the middle of the step-change
  arm. So it gets its own `PropFamily`, the way the lift and the story-mode
  switch do, rather than a `GENERIC_UPDATE` row.
* It **never clears `obj+0x34` bits 1..3**. There is no `AND` on that word
  anywhere in its 617 bytes, unlike the thirty routines that share the
  prologue. `pool.ts`'s arm for it therefore does not clear them either.

`CMP g_GameMode, EDI / JNZ` at `0x00471161` is dead — the head has already
returned for every mode but 1 — and is transcribed as the fall-through it is.

Named and annotated: `PropUpdateType75`, and `g_original_item_pickup_blocked`
(`0x007DCD14`), the byte this routine clears on the shot and sets again at the
end of the ride. Twelve writers across classes 0x41 and 0x44 and exactly one
reader — `OriginalItemPropUpdate` at `0x0046769E` jumps past its whole pick-up
arm while it is non-zero. Not modelled: the port transcribes nothing that reads
it.

### The escape's shape had to change, and here is why

`ScriptFlagsThisBundleCanRaise` asked `g_class_handlers[rec.class].
raisesScriptFlag`, a number per **class**. Class 0x41 has 441 spawns across the
six stages and `PropContainerPlacerUpdate` (`FUN_00461CD0`) dispatches each of
them through `g_class41_constructors[obj+0x130C]` to one of 79 constructors.
Exactly **one** shipped spawn builds the object that writes flag 20. A
class-wide number would have told every stage with any prop in it that flag 20
was coming, which is the same failure as the blanket escape it replaced, one
level down.

So `raisesScriptFlag` now accepts `number | ((rec: SpawnRecord) => number |
undefined)`. The cards keep their number; class 0x41 answers from the record's
own script address against `T.breakables`, which is the same lookup
`PlaceGenericPropFor` makes — the exporter has already resolved which
constructor a placement is, so that lookup *is* the engine's dispatch done
ahead of time. `flag.ts` grew four lines and a cache key.

### Class 0x32 is not a flag writer; it is stage 5's enemy

`Class32StateRaiseFlagAndLeave` (`FUN_00480470`, `g_class32_states[4]`) was
already named. What was not read is **how an actor gets there**, and that is
the whole of the estimate:

```
Class32OnShot (FUN_0047CC20)      obj+0x34 bit 26 up  ->  state 2
Class32StateDeathSequence (2)     death clip, 60 + n frames  ->  state 3
Class32StateDeathRetire (3)       give back the counters      ->  state 4
Class32StateRaiseFlagAndLeave (4) five subs, ~300 frames      ->  flag 30
```

`0x0047CC61` is the **only** write of state 2 in the image. Bit 26 is the dead
bit. So the chain begins on the frame the actor's hit points run out, and stage
5's two spawns carry 450 of them. Before that it has to have got through state
0 (waits for `g_cam_path_frame` past 0x256 **and** `g_script_flags[22]` **and**
`[23]`), state 1 (145 frames of interpolation to a fixed point), and the combat
loop at states 5..11 — six more routines, `0x0047CA50` through `0x0047DD50`,
none of them read. Class 0x32's code runs from `0x0047C960` to about
`0x00480800`.

That is a full enemy port on the scale of class 0x30 or 0x31, not a flag write,
and **it is not in this commit**. Declaring `raisesScriptFlag: 30` without it
would be strictly worse than the status quo: stage 5 currently reaches an end
block *because* the gate is excused, and an honest declaration with no actor
behind it would turn a completing stage into a hang at block 7 step 4. Put to
the user in `docs/PLAYER_HANGS.md` rather than decided here.

Corrected while reading: `g_class32_states` (`0x00596738`) had **thirteen**
entries, not eleven, and the row's list started at index 2 — the base address
was right and the entries were off by two, which is why
`Class32StateRaiseFlagAndLeave`'s own row cites `0x00596748`, the entry, rather
than the base. Named `Class32Update`, `Class32OnShot`,
`Class32StateWaitCamAndFlags`, `Class32StateMoveToFixedPoint`,
`Class32StateDeathSequence` and `Class32StateDeathRetire`; Ghidra had defined
functions for only two of the six.

`Class32Init`'s `DAT_009C7216 = 1` — `g_script_flags[22]` — is inside
`if (g_GameMode == 3)`, boss rush, which no shipped stage script is entered in.
Not reachable in play. `[proved]`

### Wrong turns

1. **`cd <the shared checkout> && <edit>` from inside a worktree.** L28 says a
   worktree agent has to check where a *repo tool* wrote. This is the same
   mistake with my own hands: I prefixed six `python3 - <<'PY'` edit scripts
   with a `cd` to the shared tree so their relative paths would resolve, and
   every one of them resolved against the wrong tree. Nothing failed — each
   script printed `ok`, because the anchor text it was replacing exists in both
   copies. The tell came from `tsc`, on a symbol I had "just added" and which
   was not there. Two `annotate.py` calls went the same way for the same
   reason, one address argument earlier: an absolute path to the script.

   The shared tree had six source files and both TSVs modified out from under
   three live peers. Repaired by reverse-applying each replacement rather than
   by `git checkout`, so that any concurrent peer edit elsewhere in those files
   would have survived, and verified byte-identical against `git archive HEAD`
   afterwards. **The rule that would have caught it: never `cd` out of your own
   worktree, pin the absolute path of the file you are writing instead.**

2. **Picking flag 30 as the escape hatch's "nothing can raise this" example.**
   The existing assertion used flag 20 and its comment said flag 20 was
   unraisable because `FUN_004710C0` had no module. Porting it made the comment
   wrong, so I swapped the example to class 0x32's flag 30 — which is
   `RESCUE_FLAG` in that same fixture, and the civilian raises it two
   assertions earlier. Flag 20 is still the right example and the reason is now
   a better one: this bundle places no type-75 prop, which is exactly what the
   per-record declaration exists to say.

3. **Assuming "playthrough gets further" was a measurable outcome here.** It is
   not, for either stage. Stage 4's flag-20 gate is in **block 2**, and the
   default route is 0 → 1 → 3 → 10 → …, so the playthrough has never visited
   the block the gate is in. Stage 5 already reaches an end block. Recorded in
   `PLAYER_HANGS.md` with the before-and-after runs; the port change is pinned
   by `port.test.ts` instead, nine of whose twenty-two new assertions fail with
   the work backed out.


## Class 0x19 is the stage-4 boss, and its gate has three links, not one

*2026-09-08. The brief: port class 0x19, eight `wait_script_flag` gates, flags
31 and 32 written at `0x0049390C` and `0x004958C7`.*

### What it is

`Boss4Init` (`FUN_004917E0`), character type **`0x4A` = `boss4.bin`**, fifteen
nodes, 300 hit points. **Four spawns in the game**, all in stage 4 — blocks 23,
25, 27 and 29, one `spawn_obj_c` each — and the descriptor tail's byte `+0x01`
is 0, 1, 2 and 3 respectively, so every one of the four is a different
entrance. The tail after that is fifteen model pointers written into
`char + i*0x90 + 0x100` for `i = 1..15`, which is `spawns.md`'s "~15 per-bone
model slots straight from its tail" read exactly.

The class is a **24-state machine** (`g_class19_states`, `0x00597298`, dispatched
on the byte at `state+0x04` of a 0xA4-byte block at `obj+0x1310`) over a
**nine-phase arena**. All twenty-four states, ten per-frame helpers and the two
tables behind them were read and named this session; thirty-two rows went into
`functions.tsv` and seven into `globals.tsv`.

### Three writes of `g_script_flags`, and the brief named two

The sweep for the bare `9c72` over `0x00491000`..`0x00496000` (L32, again)
finds **three** writes and two reads:

| | |
|---|---|
| `0x0049390C` | `Boss4StateEntranceCarried`, `g_script_flags[31] = BL` |
| `0x00493B99` | `Boss4StateEntranceDropped`, `g_script_flags[31] = 1` |
| `0x004958C7` | `Boss4StateDeath`, `g_script_flags[32] = 1` |
| `0x0049397B`, `0x00493C09` | both entrances **read** `g_script_flags[30]` |

The third write is the same flag, so the gate count does not move — but a sweep
that had missed it would have concluded that blocks 25 and 29 (entrances 1 and
3) had no writer at all, because those two blocks run the *other* routine.

### The gate is three links long and the middle one is not a spawn

```
set_script_flag 30                    evt 0x48, block 23 step 1 op 51
  -> BossIntroBannerUpdate            300 frames, then g_bHudShutterState = 1
     -> the boss's entrance sub 2     which raises g_script_flags[31]
wait_script_flag 31                   evt 0x45, block 23 step 1 op 53
```

`BossIntroBannerUpdate` (`FUN_00437AC0`) is the boss-name banner. It is **not a
spawn class**: the boss's own entrance allocates it with `BossIntroBannerSpawn`
(`FUN_00437A70`), which hands `FUN_004A6FA0` the update function directly. Its
`MOV byte ptr [0x009ca0f4], 0x1` at `0x00437F1E` is **the only instruction in
the image that puts the shutter into state 1 from inside a stage** — 77 of the
shipped scripts' `hud_shutter_state 1`s exist and not one is in a class-0x19
block — and the boss's `CMP AL, BL` at `0x004938FD` is waiting for exactly
that. Miss the banner and the fight can never start.

### The exporter had the character type wrong, and had had it wrong all along

`CHAR_TYPE_RULES[0x19]` read `("literal", 0x7C)`, "FUN_004917E0 stores 0x7C".
It does — two instructions after the one that matters:

```
0049182e  MOVZX DX, byte ptr [EDI]          ; EDI = obj+0x130C, the tail
00491832  MOV word ptr [EAX + 0x60], DX     ; char+0x60 == obj+0x1F4, the type
0049183e  MOV dword ptr [ECX + 0x20], 0x7C  ; char+0x20 == obj+0x1B4, the CLIP
```

Type `0x7C` has no skeleton, so every class-0x19 spawn resolved to "no
skeleton", never became a placement, and **no bundle in the project's history
has contained the stage-4 boss**. Three more exporter changes followed from
reading the routine: a motion rule (the clip is the literal `0x7C`), the
entrance byte (`tail+0x01`, emitted as `initial_state` — for this class that
byte is a state index and not the body condition class 0x30 reads there), and
`BOSS4_CLIPS`, the nineteen clips the class names as literals. That last one is
not cosmetic: `Boss4StateDeath` writes flag 32 on frame `0x46` of clip `0x69`,
and an unbaked clip has `MotionPlayLength` 0, so the cursor never reaches any
frame at all. All four landed in **both** halves of `hod2lib`.

### What was ported, and what was not

Init, the update's dispatch and despawn test, the four entrance states, the
banner, `Boss4ResolveShot`, the flinch, `Boss4ResumeAfterHit` and the death —
the spine of the two gates. **Seventeen of the twenty-four states are not
ported**, and the dispatch table routes them to an inert `Boss4StateNotPorted`
rather than to a hole.

So the module declares `raisesScriptFlag` for **31 and not 32**, which is the
honest half. The reason is one test in `Boss4ResolveShot`: `state+0x24` is this
phase's share of `g_boss4_phase_hp_fraction`, and the frame the hit points
reach it `obj+0x34` bit `0x100` goes up and **every later shot is refused**.
Only `Boss4AdvanceArenaWaypoint` (`FUN_004928D0`) and
`Boss4AdvancePhaseWhenWalkDone` (`FUN_00492350`) lift it, and those two are the
arena — seventeen `g_cam_path_frame` thresholds and a teleport per phase. With
them unported the boss cannot be taken below 8/9 of its bar, so it cannot die,
so flag 32 cannot be claimed. Stage 4's four flag-31 gates are honoured and its
four flag-32 gates stay excused: 35 excused gates become 31.

### `g_bHudShutterState` moved into `G`

`0x009CA0F4` was a field on `script/state/shutter.ts`'s machine. `game/` now
both writes it (the banner) and reads it (the entrance), so it is in `G` and
`Shutter.state` is an accessor — exactly the argument that put `g_nFiringGate`
there, and that file already stated it. `Shutter.step` picked up
`HudDrawShutterState`'s own head at the same time: the *draw* routine is where
the engine seeds the slide on a state change and copies the state into
`g_bHudShutterPrev`, and the port had both only in `set`, so a state written by
anything but evt 0x1F would have reset its own counter every frame for ever.

### Wrong turns

1. **Believed the playthrough.** `node tools/playthrough.mjs --stage 4` reported
   the identical 7125 frames before the port, after the port, and with the
   port's flag-31 write deleted. That is not three passes; it is the tool
   stopping the instant the walker steps into a block whose route is `end`, and
   stage 4's boss blocks **are** its end blocks. It has never executed one
   instruction of that fight. `docs/PLAYER_HANGS.md` item 17.
2. **Read `char+0x18` as the character type** from the decompiler's
   `*(ushort *)(DAT_007dd0a8 + 0x18)`, which with Ghidra's `undefined4 *` on
   that global is byte offset **0x60**. The disassembly says `MOV word ptr [EAX
   + 0x60], DX`. Ghidra retypes that same global differently in nearly every
   routine of this class — `byte *` in one, `undefined4 *` in the next — so
   every offset in this session was taken from the instruction stream.
3. **Wrote a scratch file into the shared scratchpad** twice under a name a
   sibling agent was also using, and had it overwritten mid-read. Session
   scratch is shared; prefix it.

## Class 0x14 is the stage-2 boss, and the harness cannot shoot a flag gate

The `wait_script_flag` escape in `script/waits/flag.ts` named class 0x14 as its
largest remaining hole -- "20 gates, stage 2's blocks 35-41 and stage 4's
23-29". Half of that was wrong and the count was low.

**What the class is.** `Class14Init` (`FUN_00475E90`) is the **stage-2 boss**:
character type `0x47`, `boss2.bin`, spawned in a block that loads `sanbasi.bin`
(the pier), `komono_boss2.bin`, `fish.bin` and `water_hamon.bin`. It allocates
a 0xBC-byte behaviour block, increments both enemy counters and installs
`Class14Update` (`FUN_00476150`), which dispatches a **21-entry** state table
at `g_class14_states` (`0x00596218`) and steers the boss inside a quad of water
the descriptor gives it.

**Where the gates really are.** Five spawns, and `tail+0x01` -- the state the
boss starts in -- is the only thing that tells them apart:

| stage | block | `tail+0x01` | the block then waits on |
|---|---|---|---|
| 2 | 35 | 0 | 10, 17 |
| 2 | 37 | 1 | 10, 11, 12, 13, 14, 15, 16, 17 |
| 2 | 39 | 3 | 10, 17 |
| 2 | 41 | 4 | 10, 11, 12, 13, 14, 15, 16, 17 |
| 5 | 3 | 2 | 31 |

That is **21 gates and two stages**, not 20 and three. **Stage 4 has no
class-0x14 spawn anywhere**; its blocks 23, 25, 27 and 29 gate on flags 31 and
32, and flag 31 has a second writer -- class 0x19, `0x0049390C`. A flag with
two writers does not tell you which one is in the room, and the row in
`flag.ts` that said otherwise had been carried forward unchecked. The four
stage-2 blocks are **alternative endings**, one per route, so only one of them
runs and the flags never need clearing between them.

**How a flag is raised.** Three things in sequence:

1. an entrance runs until `g_bHudShutterState == 1` -- entrances 0, 1, 3 and 4
   raise flag 10 on the way through and entrance 2 does not, which is exactly
   why stage 5 waits on 31 alone;
2. `Class14AdvancePhase` (`FUN_00477E60`) walks `state+0x08` each time the hit
   points fall past `g_class14_phase_hp_frac` (`0x00596670`), and flags 11..16
   come off `Class14StateSummonRoundB` and `Class14StateScriptedBreak` along
   the long ladder;
3. the **death**. `Class14ApplyBoneDamage` (`FUN_004763E0`) puts the boss into
   `Class14StateCuedMotion` or `Class14StateKnockedDown` on every hit, and
   those two carry the fork that reads the phase and raises 17 or 31.

Three ladders start from the three entrances and none of them meet: `0->1->2`,
`3->4->5->6->7`, `8->9`.

### What went wrong on the way

**Ghidra had `MatrixStackPop` (`0x004A9840`) flagged as non-returning.** It is
sixteen instructions with two `RET`s. The flag truncated the body of every
routine in this class that pops the matrix stack, and the decompiler simply
stopped there -- so `Class14ResolveShotBone` read as "finds a bone, transforms
a point, ends", and the call at `0x00476391` to the routine that **does the
damage, kills the boss and starts the reaction** was past the cut. Without it
there is no route into states 0x10 and 0x11, therefore none into the three
deaths, therefore no flag: the class read as one that raises nothing at its own
death. Clearing the flag and re-decompiling is what found it. This is the same
shape as L1 and L2 -- the decompiler's own model of the program, wrong in a way
that produces something readable.

**`obj+0x124` is the shot sphere, not the camera rise.** `Class14Init` writes
`30.0` there and `Class14Update` passes `state+0x0C` to
`ActorRegisterCameraPoint`; the port had the first written into the second.
Nothing failed -- the boss simply could not be broad-phased by a shot.

**The route quad is eight floats, not four vec3s.** `Class14Init` copies
`tail+0x10` and `tail+0x14` into `state+0x28` and `state+0x30` -- the x and the
z of one corner with the y between them left alone -- and repeats that at a
stride of 8. Read as vec3s the first exported quad came out as
`[660, -4900, 660]`, a corner carrying the next corner's x in its y, and the
fourth read past the record into the despawn cue.

**One point of damage is not the damage.** The FPU expression the decompiler
drops (L1) is `g_class14_bone_damage[rank][g_players_in_play - 1]`, doubled in
Arcade Mode and then capped at `g_class14_damage_cap` = 33.0. At rank 0 that is
33 a shot against 200 hit points; the port's placeholder of 1 made the boss
take two hundred separate frames to kill, and the harness gets one hit an actor
per frame.

### The exporter

Two changes, both in `web/src/hod2lib/` and `tools/hod2lib/`:

* `MOTION_RULES[0x14] = ("literal", 33)`. Without a motion rule `resolveForStage`
  builds no `Character` at all, so **stage 5 had no character type 71 in its
  bundle** -- the boss had no skeleton, no hit spheres and no clips. 33 is
  `g_class14_anim_slots[0xB]`, which is what `Class14Init` seats.
* The class's motion set, `boss2.bin`'s own bank **21..58**, offered whole to
  `bake`. Every one of the 21 states measures its exit on the play clock of a
  clip it names, so an unbaked clip is not cosmetic: `MotionPlayLength` is 0,
  the cursor never reaches the last frame, and the boss stands in the water for
  ever with its gate shut.

...and `g_bHudShutterState` moved from `script/state/shutter.ts` into `G`, on
the same argument that file already makes for `g_nFiringGate`: the routine that
reads it is now in `game/`, and one word in the exe must be one field here.

### The harness cannot clear a boss gate, and that is the honest result

`tools/playthrough.mjs` shoots only when the walker is parked on an **enemy**
gate. A boss's gate is `0x45`, not `0x44`, so with the class ported and the
gate honoured stage 5 stops at block 3 under the default policy -- further from
an end block than it was when the gate was excused.

`--shoot-flag-gates` is the opt-in, and with it stage 5 reaches its end block in
7995 frames and 79 instructions against 7875 and 78 with the gate excused, this
time having actually killed the boss. It is **not** the default because the
grid spray cannot aim: stage 3 block 2's `wait_script_flag 0x1E` is the
hostage's, flag 30 comes off *either* of her streams, and a tool that sprayed
that gate would open it by shooting her -- which is the exact thing the
civilian rule refuses -- and then report the stage as playable. Whether that
rule should be narrowed instead is a decision for the user.

Two smaller things went with it: a volley at a flag gate is 13x10 rather than
5x4, because a boss is one actor with a handful of bone spheres eighty units
out; and the debug clear is now run only for an enemy gate, since killing an
actor from outside its own death states opens no flag.

## The five rooms the debug clear was walking past

All six stages reached an end block already; five rooms only got there because
`playthrough.mjs` gave up and used its debug clear. For a player those five are
hangs. This session read all five in the exe. They are **three different
faults**, and the previous session's three `[open]` notes each guessed a
different one of them wrongly.

Before: stage 1 block 1, stage 5 block 2, stage 6 blocks 0, 1 and 3 — five
cheated rooms. After: stage 1 block 1 and stage 5 block 2 — two, both with a
proved mechanism and one with a named remaining port job.

### Stage 6, three rooms — the harness was measuring shots, not damage

`zslman` is class 0x31 character type 0x18, and its whole shot response is
`ThrowerStateKnockedTumbling` (`FUN_00450E40`), which holds
`ActorFlag.ShotImmune` from its landing through its get-up and hands out twenty
more frames of it in `obj+0x133C` on the way to state 7. `DispatchHit`
(`FUN_004092F0`) refuses `ResolveHit` for all of it. **One shot lands per
knockdown**, so a room of them is bounded by elapsed frames and not by rate of
fire — 130 hit points at 35 a hit is four cycles of about 120 frames.

Measured under the driven clock, the three rooms clear in 420, 435 and 285
frames of shooting with the hit points falling `130 → 95 → 60 → 15 → dead`. The
tool gave up at 300. The port is right and always was; the previous note's
guess — "probably just slow for a grid spray" — was the right shape and had not
been checked, and the brief was explicit that it should not be accepted on
that basis.

The fix is in the tool and it is **not** a longer window. `--shoot-for` now
counts frames in which nothing in the room took damage, read off the drive
seam's own row: `g_enemies_alive`, plus the hit points of every live class-0x30
and class-0x31 actor. Elapsed time cannot tell a room being won slowly from a
room that cannot be won; damage can. Raising the window would have excused
stage 6 *and* hidden stage 1, which is the reason it was refused.

### Stage 5 block 2 — a declared divergence that nobody had costed

The previous note asked why four `znnick` sit at `d=2843..2898`, "nearly three
thousand units from the camera… and not where the script put them". They are
where the script put them: block 2 step 2 op 38 spawns them at `(±4.6, 0..10,
-16.5..7)`, `FUN_00408a20` copies a descriptor position verbatim, and
`ZombieStateDelayedStrikeInPlace` (`FUN_0045E830`) never moves an actor. The
distance is not a bug and the position is not the question.

The question is the way out, and there is exactly one: `g_carrier_object`
(`0x009A5C34`) raising `obj+0x34` bit `0x40000000`, read at `0x0045EAFE`, after
which `obj+0x1334` counts to `0x14` and the actor takes state 10. The writer is
class 0x33 selector 1 — named `ScriptedCarrierUpdate33` (`0x004331D0`) this
session, `obj+0x11C` being a sub-type selector there rather than hit points
(L3), and spawned by this very step at op 37. Class 0x33 is unported, so the
global stays `-1`.

That divergence was already written down twice, in `class30/scripted.ts` and in
`globals.ts`, carefully and accurately. **What nobody had done was ask which
shipped rooms depend on it**, and the answer is one, and it had been surfacing
as an unexplained `d≈2880` for two sessions. L26 with the polarity reversed: a
note can be perfectly true and still be the reason nothing was looked at.

Two real port bugs fell out of reading it, both in the give-up:

* it tested `obj+0x136C` bit `0x40000000` instead of `obj+0x34`'s — the right
  bit in the wrong word. `0x40000000` in `obj+0x136C` is
  `ZombieFlag2.CollideActors`, half of the `|= 0x60000000` `EnemyZombieInit`
  seeds on **every** class-0x30 spawn, so the test answered yes for every
  zombie in the game and no for the carrier.
* the sub machine returned early on each of its waits, so the give-up did not
  run on any frame the actor was counting a timer down. In the exe every arm of
  the switch reaches `switchD_0045e899_default`, by `break` or by `goto`, and
  the idle and the carrier watch are what sits there. The state is two
  functions now: the switch may return, the frame may not. It cost four frames
  of the twenty in the test, which is how it was found.

Both are fixed and asserted. The room is **still unclearable** until class 0x33
selector 1 is ported, which is a vehicle — `0x004331D0` runs to at least
`0x00433830` and would need `tail+0x14/0x18/0x1C/0x20/0x21/0x24` in both halves
of `hod2lib`. Not attempted.

### Stage 1 block 1 — the gun is switched off, and why is `[open]`

The odd one, and it stayed odd. The blocker is `0x1868`, a class-0x30 captor of
the class-0x10 civilian `0x1828 hito_fem`. It sits at `140/140` for 3,000
frames across a hundred volleys with `flags 0x8040001` — **`ShotImmune` is not
set**. Nothing is refusing the shots. Nothing is firing them:
`g_nFiringGate` (`0x009C8E00`) is down, because block 1 step 6 op 3 issues
`hud_shutter_state 3` and `HudDrawShutterState` (`FUN_00413970`) drops the gate
at `0x00413B06` when that close finishes, and nothing raises it again until
step 9 op 1. The gate at step 8 op 6 is inside that window.

Four things were checked against the exe and all four say the port is faithful:
the captor is alive-counted (`FUN_00452DA0` counts every class-0x30 spawn whose
character type is not 9 and whose initial state is not `0x1F`); it is meant to
turn on the player when its civilian dies (`ZombieTargetIsDead`,
`FUN_0045C8A0`, itself calls `ZombieScriptEnded`, and `attack_state 1` is the
commonest of the 114 captors in the game); the gate's own handler
`EvtOpWaitEnemiesAlive44` (`FUN_0045FC10`) has only terms that make it harder;
and it is not the cutscene skip, measured with `Enter` suppressed.

So the engine reaches the same instruction, with the same live enemy, with the
gun off — and the shipped game does not stop there. **What removes that captor
from `g_enemies_alive` is `[open]`**, with three leads listed in
`PLAYER_HANGS.md` item 19.

### What went wrong on the way

1. **`HudDrawShutterState`'s decompilation has no `g_nFiringGate = 0` in it.**
   Ghidra's pseudocode for `FUN_00413970` shows cases 0, 3 and 5 drawing a
   closed shutter and returning, with no gate write anywhere in the function —
   which read as proof that the port had invented the closed-shutter gate and
   that stage 1 was a port bug. It had not. The three arms' tails are in gaps
   the listing skips: `0x00413A0B` writes `1`, `0x00413A74` and `0x00413B06`
   write `0`, all of them after the block Ghidra shows. **L1's sibling** — the
   decompiler drops the tail, not just the FPU arguments — and the jump table
   at `0x00413C80` is what says which arm is which state.
2. **Reading a room by watching the wrong gate.** The first probe of stage 6
   block 0 stopped at the first stalled gate in the block and reported three
   healthy class-0x30 zombies cycling their attack loop — nothing like the
   `zslman` the playthrough had named. Two different rooms, one block. A probe
   that targets a block has to target the step too.
3. **Reading "the gate opened" off the block number.** The probe broke when the
   *block* changed, which for stage 6 block 0 is three rooms later; the first
   clear times measured were 750, 1200 and 555 frames and none of them was the
   room under test. The real figures are 420, 435 and 285, and the tool
   threshold was set from those.
4. **Assuming the exe's `ZombieTargetIsDead` is a predicate.** The port calls
   `ZombieScriptEnded` from inside a function named "is dead", which looks
   exactly like L11 — a test moved across a function boundary — and half an
   hour went into it before `FUN_0045C8A0` turned out to do precisely the same
   thing. A negative result about the port is not a fact either.

## 2026-09-08 — class 0x33 selector 1, and the state 10 that was never a state 10

Task: make stage 5 block 2 clearable by shooting. It was `[proved]` going in
that the room is held by `ZombieStateDelayedStrikeInPlace` (`FUN_0045E830`)
waiting on a bit only class 0x33 writes. That turned out to be half the story.

### What class 0x33 selector 1 is

`ScriptedSceneryDispatch33` (`FUN_00432FF0`) is a switch on `obj+0x11C` —
`MOVSX ECX, word ptr [EAX + 0x11C]` / `DEC ECX` / `CMP ECX, 0x62` at
`0x00432FF4`, through the byte table at `0x004330F8` and the jump table at
`0x004330C4` — with twelve reachable arms: selectors 1 to 11 and 99. It
installs one update pointer and calls `ActorClaimHitSlot` (`FUN_00409270`).
`obj+0x11C` is the raw `s16` at `desc+0x22`, so it is `L3` again: the field the
exporter calls `hp`.

Selector 1 is `ScriptedCarrierUpdate33` (`FUN_004331D0`), which was already
named, plus a mover that was not: `FUN_00433860`, named here
**`ScriptedCarrierStepPath33`**.

`[proved] it is a vehicle that drives in and burns`, and not from the model.
The four sound ids it plays resolve through `g_se_name_list` to
`STAGE5_SE\DRIVE_DEAD2_22.wav` (seated), `DRIVE_DEAD2_22_OFF.wav` (the effect
frame), `CAR_FIRE_22.wav` (twenty frames later) and `CAR_FIRE_22_OFF.wav` (as
it leaves). Two looped sounds, each with its off half, the second starting
where the first stops. That is also what settles `tools/hod2lib/rigs.py`'s
`[likely] fire or smoke` on the `0x1AAB`..`0x1AD2` strip: it is fire, and
`obj+0x34` bit `0x200000` is the latch that says the fire is running.

Its clock is the part worth writing down. `obj+0x1370` is seeded to
`(float)(g_cam_path_frame - 1)` on the object's **first** frame — `FILD` at
`0x004338F7` off a `DEC EDX` — and then gains a literal `1.0` (`0x004C4380`)
every frame. So it agrees with the camera only by coincidence, and the two
cues that read it (`tail+0x14` and `tail+0x18`) are **not** camera cues, while
`tail+0x1C` is: that one is compared against `g_cam_path_frame` and
`g_cam_path_frame_2` directly. Three shipped spawns, all `spawn_obj`: stage 2's
`0x4FD0` (slot `0x1A36`, path 336) and `0x12590` (`0x1A35`, path 338), stage
5's `0x1CE4` (`0x1B0E`, path 382, effect at cursor 580, spawned at camera frame
231).

### The half nobody had looked at

Porting the carrier alone would not have cleared the room, and the reason is a
citation that was wrong in three places.

`ZombieState.Leave` is 10. `class30/states.ts` cited
`ActorAbortAttackAndLeave` (`FUN_0045D9F0`) for it, `class30/leave.ts` had
already noticed that address "does not do this — it is three calls that take no
actor and assign no state", and `PLAYER_HANGS.md` repeated the name. Nobody
read the table. `g_class30_states` (`0x00592AE8`) index 10 is the dword
`90 54 45 00` — `ZombieReleaseAndDespawn` (`FUN_00455490`), which releases both
enemy counters, releases the attack slot, clears `g_attack_permits[obj+0x120]`
and `ActorDespawn`s. Indices 11 and 12 are `0x00454B90` and `0x00456DF0`, which
match the port's enum either side, so the indexing is not adrift.

The port had no `case` for state 10, so it fell to the dispatch's `default` and
`ZombieGiveUpAttack`, which routes to `WaitTurn` and keeps the actor alive.
Everything the port sent to state 10 stayed in `g_enemies_alive`: the four
`znnick` once the carrier released them, and — already, before any of this —
the fourth of them, `0x1DD4`, whose descriptor names `attack_state 10` behind a
state-18 camera cue. It was in the playthrough's own dump as
`0x1DD4 znnick · WaitTurn/1 · d=2898` and had been read as noise.

Census across the twelve bundles: `attack_state == 10` is **one** spawn per
stage-5 bundle and nothing else in the game, so the blast radius of the fix is
that spawn plus whatever a state routes there.

### What was wrong on the way

1. **The decompiler's `return` was not in the code.** Ghidra's pseudocode for
   `ScriptedCarrierUpdate33` ends at `0x0043345E` with `MatrixStackPop(1);
   return;`. The function does not return there: `0x00433463` is another
   `MatrixStackPush(0)` and the body runs to `0x00433854`. Nine hundred and
   seventy bytes — the camera-space position write, `RegisterForShotTest`, the
   two sprite loops and the five sub-models — are invisible in the
   decompilation. That is `L37` in its own right, and the only reason it cost
   nothing here is that `tools/hod2lib/rigs.py` had read the same bytes by
   hand for `obj_4331d0` and its notes agreed instruction for instruction.
2. **Two off-by-ones in the test, both from the read/step order.** The update
   tests its cues at the top of the frame against the cursor the *previous*
   frame's ride left, and the frame that raises `0x40000000` also runs
   `obj+0x1334` once. Neither is a port bug — the assertions were wrong and the
   code was right — but both are the kind of thing that would have been written
   into a comment as fact if the test had not been made to fail first.
3. **`tail+0x18` is an int and `tail+0x14` is a float**, in adjacent dwords of
   the same descriptor. `FILD dword ptr [EBX + 0x18]` against `FCOMP float ptr
   [EBX + 0x14]`; reading either as the other's type gives a plausible number.

### What is not ported, named

The other ten sub-handlers (their addresses are in `class33/state.ts`);
`ActorClaimHitSlot` (`FUN_00409270`), because `g_hit_slots` is not ported at
all; `RegisterForShotTest` (`FUN_00405160`) at `0x004334D0`, which is what
makes the carrier shootable — stage 2's two are on the **mesh** test
(`obj+0x34 |= 0x50`, `tail+0x04 != -1`) which the port has not got; and the
drawing from `0x00433463` to `0x0043382F`, which the renderer already does from
the exported rig. `obj+0x6C` (roll) and `obj+0x118` (uniform scale) are written
by the engine and read only by its own draw, so the port leaves them out rather
than adding two head fields nothing in `game/` reads.


## The noise a standing zombie makes

The brief was two `[open]` items left over from the attack-cry work: what calls
`ActorPlayHitVoice` (`FUN_0040A6F0`) with kind 4, and what a standing zombie
groans. Both are answered, and neither answer was where the question pointed.

**Kind 4 is dead.** Disassembling the window before each of the twenty-three
call sites gives the complete census: kinds 0, 1, 2 and 3 only, thirteen of
them kind 3. Two sites push the kind in a register rather than as an immediate
— `0x00451A03` and `0x00451AF0`, both inside `RescueTargetHeldState` — and the
decompilation of that function is what says they are 0 and 1. Its two ids at
`0x005A4EA8` are zero in the shipped `.data` and nothing in the image writes
them; the only two references anywhere are the reads inside the routine itself.

The interesting part of that was the near-miss. A byte search for the
little-endian address finds one instruction, but `search_instructions` for the
bare `5a4e` turns up `MOV [EAX*8 + 0x5A4E38]` in two functions — and
`0x5A4E38 + 14*8 = 0x5A4EA8` exactly, so a fifteenth entry in that radix-sort
scratch would land on kind 4's first id. That had to be closed rather than
waved away: `FUN_00408D90`'s clear loop bounds `g_camera_candidates` at 14
pairs, `RegisterForDistanceRank` refuses its fifteenth caller with `CMP ESI,
0xE`, and the scratch is the same 14. **L6 asked from the other side** — not
"is my table longer than I think" but "is the thing one past the end of a
table, and can that table overflow into it".

**The groan is not a voice at all.** It is `PlaySoundId(0x1917A9)` —
`COMMON2\ZOMBIE_041_16.wav` — at `0x004558D6` in `ZombieStateHoldAtRange`
(`FUN_00455720`), inside the same `CMP EAX, EDI` that starts the in-range idle
clip, so it fires once per entry into that clip and not again while it runs.
The `PUSH` at `0x004558D2` is the only occurrence of the id in `.text`.

What found it was taking `get_xrefs_to PlaySoundId` — 500 references — and
reading only the ones inside class 0x30's address range. That is about twenty
functions and half an hour. Nothing about the voice routine could have led
there, which is the lesson the brief already stated and which turned out to be
exactly right.

### The wrong turn: `g_zombie_voice_holders`

The first lead looked like the answer and was not. `globals.tsv` already had
`0x009C8A74` as *"how many class-0x30 actors currently hold a groan voice"* and
`FUN_00456600` as `ZombiePlayDeathVoice`, *"the death scream"*. A refcounted
per-scene voice with an init and a release is exactly the shape an idle groan
would have, and I spent a while convinced that was it.

It is the **chainsaw**. `EnemyZombieInitByCharType` plays `0x4D17A9` for
character type 2 and `0x1F25A9` for type 3, and `g_se_name_list` resolves those
to `COMMON2\CHAIN_SAW_22.wav` and `STAGE6_SE\LASER_SWORD_22.wav`; the release
plays their `_OFF` twins. Both are entries of `g_looping_se_ids`, so
`PlaySoundId` plays the first looped and turns the second into a
`SoundStopAllLoopingSe`. The refcount exists because the engine has **no handle
for a playing loop** — `SoundStopAllLoopingSe` takes no argument — so a loop
two objects can want has to be opened by the first and closed by the last.

The confirmation came from the other caller of the release:
`ActorUpdateBodyCondition` (`FUN_00454270`) calls it for a type-2 actor the
moment neither hand still holds its prop. Shoot the chainsaw out of its hands
and the noise stops while the zombie is still alive. A voice would not do that.

Both rows are corrected — `g_weapon_loop_holders` and
`ZombieReleaseWeaponLoopSe` — and the correction is the reason to write this
down: **the old name was not a guess, it was an inference that had hardened
into a fact**, and the thing that dissolved it was reading the four ids through
the name table, which costs one command.

### Two things that fell out

`ZombiePlayMotionFrameSe` (`FUN_00452A10`) is now named: a per-frame switch over
the actor's current motion, each arm naming exact frames of that clip and one
of `ENE_WALK3`, `ENE_WALK6` or `SWORD11`, latched against repeats by
`obj+0x1314`. That is the footstep hook, and it is the noise a *walking* zombie
makes.

And `PlaySoundId`'s looping branch had never been written into
[`formats/sound.md`](../formats/sound.md), though the class-0x31 work had found
the two tables. `tools/verify_looping_se.py` now proves the pairing rather than
observing it: every one of the 44 pairs is `X.wav` against `X_OFF.wav`, and no
`_OFF` file is shipped, which is what makes a stop id a control word. It also
catches the eight duplicated play ids and asserts that each repeat names the
same stopper, so the first-match walk order is not load-bearing.
