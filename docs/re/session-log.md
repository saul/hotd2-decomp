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
