# Ghidra environment

Phase 1. The project database is **not** committed — it is 17 MB of derived
data and rebuilds in about two minutes. The scripts that produce it are
committed, because reproducibility is the point.

## Prerequisites

- Ghidra 12.1.3 PUBLIC (or compatible) — default `~/ghidra_12.1.3_PUBLIC`
- A JDK (tested on Temurin 25)
- Your own copy of the game — default `~/THE HOUSE OF THE DEAD 2`

Override with `GHIDRA_HOME` and `GAME_DIR`.

## Rebuild from scratch

```sh
./ghidra/run.sh import                        # import + auto-analysis, ~2 min
./ghidra/run.sh script ExportInventory.java   # regenerate ghidra/out/
```

## Layout

| Path | Tracked | Purpose |
|---|---|---|
| `run.sh` | yes | headless driver |
| `scripts/` | yes | GhidraScripts, **written in Java** |
| `project/` | no | the `.gpr` / `.rep` database |
| `out/` | no | logs and exported CSV/TXT |

## Write scripts in Java, not Python

This Ghidra is not launched with PyGhidra, so `.py` GhidraScripts fail with
`Ghidra was not started with PyGhidra. Python is not available`.

Use Java. `scripts/ExportInventory.java` is a working template: extend
`GhidraScript`, override `run()`, read the output directory from the `HOTD2_OUT`
environment variable, and print a line prefixed `[hotd2]` so `run.sh` surfaces it.

## Ghidra MCP

An MCP bridge runs at `http://127.0.0.1:8089` for interactive exploration and is
registered in `~/.config/opencode/opencode.jsonc`. It requires an opencode
restart to take effect, and only `/mcp/health` is reachable over plain HTTP.

Use MCP to *explore*. Capture anything that is a *result* as a committed script
here or as documentation in `docs/re/` — MCP calls leave no reproducible trail,
and this project spans many sessions.

## Current baseline

See `docs/re/session-log.md` for the analysis state, known gaps and the ordered
list of next actions.
