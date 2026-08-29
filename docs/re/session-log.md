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
