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
dispatch table the project has recovered, replays every function name, label,
comment, prototype and no-return flag from `annotations/`, and repairs the call
sites a wrong no-return flag cut short (below). The result is the annotated
database.

The steps individually, if you want them:

```sh
./ghidra/run.sh import                        # import + auto-analysis, ~2 min
HOTD2_APPLY=1 ./ghidra/run.sh script ApplyKnownTables.java
HOTD2_APPLY=1 ./ghidra/run.sh apply-annotations
HOTD2_APPLY=1 ./ghidra/run.sh repair-flow
./ghidra/run.sh script ExportInventory.java   # regenerate ghidra/out/
```

`HOTD2_PROJECT_DIR` points any of these at a scratch database instead of
`project/`.

## Annotations are the source of truth

The database is derived data and is not committed. **`annotations/*.tsv` is
what is committed**, and it is the project's record of every symbol recovered
(the counts are in `docs/STATUS.md`):

| File | Contents |
|---|---|
| `annotations/functions.tsv` | `address`, `name`, optional comment — sorted by address |
| `annotations/globals.tsv` | `address`, `name`, optional comment — sorted by address |
| `annotations/prototypes.tsv` | `address`, C prototype, attributes (`noreturn`, `returns`, custom storage), optional comment — sorted by address |

Add or rename a row with `python3 tools/annotate.py`, which upserts and keeps
the address order.

`ApplyAnnotations` only renames a symbol whose current name is still one
Ghidra generated (the same prefixes `ExportAnnotations` refuses to export), so
it is idempotent, it never clobbers a name chosen in the GUI, and it can run
before or after `ApplyKnownTables` without ordering trouble. A curated name
that differs from its row is reported as `renamed` and left alone. It
*creates* functions that do not exist yet, because most of the interesting ones
are only reachable through a dispatch table auto-analysis did not recognise.

**Names and comments go opposite ways** (`L90`):

| | `apply-annotations` | `export-annotations` |
|---|---|---|
| name | written only over a generated one | the database's wins, and each rename is printed |
| comment | the file's is written whenever it differs | the file's wins; the database's fills only an empty row |

So a comment is edited with `tools/annotate.py`, never over MCP: an export
keeps the file's, lists every disagreement (`conflicts=`, and in full in
`ghidra/out/export_comment_conflicts.tsv`), and the next apply writes the
file's over the database's. Every comment an apply replaces is logged with its
old text in `ghidra/out/apply_annotations.txt`.

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

`ExportAnnotations` **merges** into the TSVs: it keeps body comments, any row
the database has no symbol for and any comment the file already has, and
refuses a generated name over a curated one. It skips anything a fresh import
would recreate — default names, `Catch@`/`Unwind@`, PE resources, Windows TEB
fields, and the CRT/D3DX names
the function ID analyser finds — so the committed file stays a record of
*this project's* findings. Its filter is a prefix list, so read the diff: a
Ghidra release that renames an auto-label prefix lets those labels through.
The export fails while a Ghidra GUI holds the project lock.

## Prototypes and no-return flags

The decompiler reads a callee's prototype at every call site, so a wrong or
missing one is wrong at every caller at once -- which is why the dropped x87
arguments and the code missing after `MatrixStackPop` kept recurring (`L89`).
Two things fix it at the source:

* **`annotations/prototypes.tsv`**, applied by `ApplyAnnotations`. A row's
  flags always win; its prototype replaces one Ghidra made up but never one
  set by hand, which is reported as `kept` until `export-annotations` brings
  it into the file. Write a row for a callee whose calls decompile wrong --
  an x87 argument (`__ftol` takes ST0), a float return, an output struct --
  with the instruction that proves it. Do not bulk-commit the decompiler's own
  guesses: doing that for every function made the output worse.
* **`scripts/RepairFlowDamage.java`** (`repair-flow`). Ghidra's
  "Non-Returning Functions - Discovered" analyzer, run by the GUI's
  incremental analysis, once flagged `MatrixStackPop` and `PlaySoundId`
  no-return and wrote a `CALL_RETURN` override on every call site; each one
  prints as a clean `return;`. The script turns that analyzer off in the
  program's options, clears every `CALL_RETURN` on a `CALL` to a function that
  returns, and regrows the bodies. A no-return flag `prototypes.tsv` does not
  declare is reported, not changed.

`python3 tools/verify_ghidra_db.py --game-dir ...` (in `verify_all`) runs
both in report mode over a copy of the saved database -- so it works with the
GUI open -- and fails unless they have nothing to do. It also runs the export
into a copy of the annotations and fails on the one name disagreement that
loses work: a database name the file's history shows it renamed away from.
Names and comments on their way in either direction -- rows not applied yet,
MCP renames not exported yet -- are printed as `note` lines and do not fail,
because they are usually someone else's work in progress.

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
