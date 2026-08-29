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
