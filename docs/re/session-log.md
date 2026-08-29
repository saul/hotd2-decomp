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
