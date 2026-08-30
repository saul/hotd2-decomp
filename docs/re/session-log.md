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
