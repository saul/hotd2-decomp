# Ghidra environment

The project database is **not** committed — it is derived data and rebuilds in
a few minutes. The scripts that produce it are committed, because
reproducibility is the point.

## Prerequisites

- Ghidra 12.1.3 PUBLIC (or compatible) — default `~/ghidra_12.1.3_PUBLIC`
- A JDK (tested on Temurin 25)
- Your own copy of the game — default `~/THE HOUSE OF THE DEAD 2`

Override with `GHIDRA_HOME` and `GAME_DIR`.

## Rebuild from scratch

```sh
./ghidra/run.sh rebuild
```

That is the whole thing. It imports the EXE, runs auto-analysis, applies every
dispatch table the project has recovered, and then replays every function name,
label and comment from `annotations/`. The result is the annotated database.

The steps individually, if you want them:

```sh
./ghidra/run.sh import                        # import + auto-analysis, ~2 min
HOTD2_APPLY=1 ./ghidra/run.sh script ApplyKnownTables.java
HOTD2_APPLY=1 ./ghidra/run.sh apply-annotations
./ghidra/run.sh script ExportInventory.java   # regenerate ghidra/out/
```

## Annotations are the source of truth

The database is derived data and is not committed. **`annotations/*.tsv` is
what is committed**, and it is the project's record of every symbol recovered
(the counts are in `docs/STATUS.md`):

| File | Contents |
|---|---|
| `annotations/functions.tsv` | `address`, `name`, optional comment — sorted by address |
| `annotations/globals.tsv` | `address`, `name`, optional comment — sorted by address |

Add or rename a row with `python3 tools/annotate.py`, which upserts and keeps
the address order.

`ApplyAnnotations` only renames a symbol whose current name is still a Ghidra
default, so it is idempotent, it never clobbers a name chosen in the GUI, and
it can run before or after `ApplyKnownTables` without ordering trouble. It
*creates* functions that do not exist yet, because most of the interesting ones
are only reachable through a dispatch table auto-analysis did not recognise.

The `game:annotations` check (`web/tools/checks/annotations.ts`) holds every
row against the EXE's own PE section table — that each address resolves, that
functions land in `.text`, that nothing is listed twice. Run it before
committing an annotation change:

```sh
python3 tools/verify_all.py --only game:annotations --game-dir ~/"THE HOUSE OF THE DEAD 2"
```

### After exploring over MCP, export

Renaming things over the Ghidra MCP bridge changes the live database and
**leaves no reproducible trail**. That is the one way this project loses work.
So when a session has renamed anything:

```sh
./ghidra/run.sh export-annotations   # DB -> annotations/*.tsv
git diff ghidra/annotations          # review, then commit
```

`ExportAnnotations` **merges** into the TSVs: it keeps body comments and any
row the database has no symbol for, and refuses a generated name over a curated
one. It skips anything a fresh import would recreate — default names,
`Catch@`/`Unwind@`, PE resources, Windows TEB fields, and the CRT/D3DX names
the function ID analyser finds — so the committed file stays a record of
*this project's* findings. Its filter is a prefix list, so read the diff: a
Ghidra release that renames an auto-label prefix lets those labels through.
The export fails while a Ghidra GUI holds the project lock.

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

Interactive exploration goes through a Ghidra MCP bridge against the live
database. Use it to *explore*; capture anything that is a *result* in
`annotations/` (then `export-annotations`), as a committed script here, or as
documentation in `docs/re/` — MCP calls leave no reproducible trail.
