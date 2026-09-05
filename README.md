# hotd2-decomp

Reverse-engineering **The House of the Dead 2** (Windows PC port, 2001) — its
asset formats, its render pipeline and the gameplay code that drives them — and
a browser client that plays a stage back from what has been recovered.

Two halves, and each is the other's check:

* **The decomp.** `ghidra/` holds every recovered symbol as TSV and a headless
  driver that replays them onto a fresh database; `tools/hod2lib/` is a pure
  Python library that parses every on-disk format; `docs/formats/` specifies
  them. Workflow: the **`/decomp`** skill.
* **The player.** `web/` renders a stage and runs its gameplay as a
  *transcription* of the exe — one TypeScript function per exe function, under
  the name Ghidra gives it, with the address in the doc comment. Workflow: the
  **`/gameplay-port`** skill.

The second half is what stops the first from being a story about the binary.
A misread table is an argument; a misread table that walks a zombie through a
wall is a bug report, and this project has fixed more of the first kind by
hitting the second than by re-reading.

## Where it actually stands

**The formats are solved.** Every directory the game ships is parsed:
compression, containers, NaomiLib models, PowerVR2 textures, camera paths,
event scripts, collision and motion. `docs/PROGRESS.md` is the phase record.

**All six stages load in the browser**, in both Arcade and Original Mode, and
run from the game's own event script — its branching route graph, region
streaming, camera paths and enemy placements. The gameplay is a port rather
than an interpretation: the enemy state machines, the damage and gore model,
the scoring, the shot test and the camera director are transcribed from the
routines that implement them.

**Stages 1 and 2 are the ones that have been driven end to end.**
`web/tools/playthrough.mjs` walks a stage from its entry block to an end block
and fails on a hang; it has been run over those two and their defects are
itemised in [`docs/PLAYER_HANGS.md`](docs/PLAYER_HANGS.md). Stages 3 to 6 have
never been swept, so expect more of the same shape there — that is a gap in the
testing, not a claim that they work.

**It is not finished, and the ways it is unfinished are counted rather than
described.** Coverage of the gameplay address ranges, the number of spawn
classes with a module, every declared `[diverges]` and every `[open]` marker
are in [`docs/STATUS.md`](docs/STATUS.md), which is generated — no other
document quotes those numbers, because a number written twice will disagree
with itself.

## Scope, and how claims are marked

**Not** a byte-matching decompilation of `Hod2.exe`. The target is a
*documented reimplementation*: every on-disk format specified, the PowerVR2 →
Direct3D 7 material translation recovered exactly, and enough of the gameplay
code transcribed that a stage plays.

There is **no C reference implementation** and there is not going to be. It was
planned early and dropped: `tools/hod2lib/` already reads as the specification,
and a second implementation of each format would be a second thing to keep
true.

Every claim about the binary is marked **`[proved]`** (the code was read),
**`[likely]`** (inference, with the evidence stated) or **`[open]`**
(undetermined). `[open]` is a useful answer and a guess is not, and nothing is
ever named for where it sits or what it resembles. Where the player knowingly
departs from the exe it says so with a greppable `[diverges]` and a reason.

## Getting started

You supply your own copy of the game — see **Legal**. Nothing else is unusual:
the export and every check need **Python 3 and no third-party packages**, and
the client needs **Node 20+**. Only the optional `tools/blender_*.py` helpers
want anything else, and those run inside Blender.

```sh
# 1. build the bundle
python3 tools/export_player.py --game-dir "/path/to/THE HOUSE OF THE DEAD 2" --all

# 2. run the client
cd web && npm install && npm run dev        # http://localhost:5173
```

`--all` builds all six stages in **both** game modes. Add `--stage 2` for one
stage, or `--arcade` / `--original` for one mode. The export prints what it
could not read at the end, including when that is nothing.

**There are two exporters and they write the same bundle.** `web/src/hod2lib/`
is the Python library ported to TypeScript, so the same code runs from a CLI
and inside the page:

```sh
cd web && npm run export -- --game-dir "/path/to/THE HOUSE OF THE DEAD 2" --all
```

That is the faster of the two — about nine times — and it takes the same flags.
Or skip step 1 entirely: open the client with no bundle and it offers to build
one from your install, in a worker, into a cache that survives a reload and can
be downloaded as a zip. The Python remains the reference implementation and
`tools/verify_parity.py` proves the two agree, byte for byte through the
geometry. See [`docs/TS_PORT.md`](docs/TS_PORT.md).

Every bit of player state is in the URL, so a bug report is a link:
`?stage=2&mode=play&block=3&step=1&op=14`, or `?stage=2&slot=59&frame=170` to
pose straight off a camera path.

### The other two things you can do

```sh
# export a stage to glTF, for Blender
python3 tools/export_level.py --game-dir "..." --stage 2 --unlit

# turn a fresh checkout into the fully annotated Ghidra database
./ghidra/run.sh rebuild
```

`rebuild` replays every committed annotation onto a new project. It needs
Ghidra — `GHIDRA_HOME` defaults to `~/ghidra_12.1.3_PUBLIC` — and the project
database itself is never committed, only the TSVs that rebuild it.

### Checking it

```sh
python3 tools/verify_all.py --game-dir "/path/to/THE HOUSE OF THE DEAD 2"
```

One command, about ten seconds, and it is the canonical list of checks — there
is no shell block to copy. It reports pass, fail and **skip** separately: a
check that asserted nothing exits 3 and is never counted as green. Without a
bundle three suites skip; without `--game-dir` two more do, and it says so
rather than printing a green line over nothing.

## Where everything is written down

One fact, one home. **No document quotes a number another one computes.**

| Read this | When you want |
|---|---|
| [`docs/STATUS.md`](docs/STATUS.md) | **every number.** Coverage, line counts, divergences, ratchets, the check list. Generated by `tools/status.py`. |
| [`docs/LESSONS.md`](docs/LESSONS.md) | **the traps this project has already paid for.** Twenty of them, cited by id. Read before your first edit. |
| [`docs/re/session-log.md`](docs/re/session-log.md) | **where the last session stopped**, what was tried, and what failed. Append-only; the wrong turns are the point. |
| [`docs/PLAN.md`](docs/PLAN.md) | what is worth doing next, and what "complete" should mean. |
| [`docs/PROGRESS.md`](docs/PROGRESS.md) | which phases and formats count as solved. |
| [`docs/formats/`](docs/formats/) | byte-exact specifications, one per format. |
| [`docs/re/addresses.md`](docs/re/addresses.md) | the addresses that matter, by subsystem. |
| `ghidra/annotations/*.tsv` | **the names.** The source of truth for both halves; sorted by address, written only by `tools/annotate.py`. |
| [`docs/EXPORTING.md`](docs/EXPORTING.md) | exporting to glTF and opening it in Blender, and how to tell an exporter bug from a viewer setting. |
| [`docs/TS_PORT.md`](docs/TS_PORT.md) | **the two exporters** — what "identical output" means precisely, and how the browser builds a bundle for itself. |
| [`web/README.md`](web/README.md) | running the player, and an explicit account of what is faithful and what is approximated. |
| [`docs/PLAYER_ARCHITECTURE.md`](docs/PLAYER_ARCHITECTURE.md) | **the player's shape** — the layers, the rules, the checks that enforce them, and the order of work. |
| [`docs/PLAYER_PROGRESS.md`](docs/PLAYER_PROGRESS.md) | what the player does, and the reading errors it surfaced. |
| [`docs/BUGS.md`](docs/BUGS.md) | reported bugs and whether each is fixed. |
| [`docs/PLAYER_HANGS.md`](docs/PLAYER_HANGS.md) | defects the automated playthrough still trips on. |
| [`CLAUDE.md`](CLAUDE.md) | the rules that are checked, and how to commit in a repo with concurrent workstreams. |

Reviews are transposed from their GitHub issues into `docs/REVIEW-<date>.md`:
the issue records **what was found**, the file records **what is being done
about it**, and the file is the one that gets updated.

## What the game is

The PC release is a direct port of the NAOMI / Dreamcast build. It ships native
PowerVR2 data — NaomiLib models, twiddled/VQ textures, and event tables still
full of absolute Dreamcast SH-4 RAM pointers — and translates it to Direct3D 7
at runtime.

That translation layer is the Rosetta stone for this project: because the port
had to convert every PowerVR2 ISP/TSP register word into a D3D7 render state,
the binary contains an authoritative, complete mapping. Material behaviour can
be recovered exactly rather than inferred.

| Component | Detail |
|---|---|
| `Hod2.exe` | PE32 i386, MSVC 6.0, linked 2001-05-09, imagebase `0x400000` |
| `.text` | `0xC2520` (~795 KB) |
| Renderer | Direct3D 7 via `DirectDrawCreateEx` + QI, using the DX7 SDK `d3du`/D3DX utility library |
| Input | DirectInput 7, plus `SEGAJOY.VXD` for arcade gun hardware |
| Audio | DirectSound; BGM/SE/voice ship as plain `.wav` |

The camera runs at a compile-time **41.1° vertical FOV**, 4:3, near 0.8, far
8000, recovered from `SetupSceneProjection`. There is no zoom and no per-camera
field of view.

## Legal

No game assets are included or redistributed here, and none ever may be —
`.gitignore` blocks every asset type and rules that **a screenshot of a stage
is derived game art**. You must supply your own copy of the game.
`manifest.csv` records SHA-256 hashes so tooling can be validated against a
known-good input set; it contains no asset content.

## Layout

```
docs/           specifications, plans, and the generated status table
docs/formats/   byte-exact format specs
docs/re/        session log, annotated addresses, anomalies, build provenance,
                rig survey (the 31 object-path followers)
ghidra/         headless driver + GhidraScripts; annotations/ holds every
                recovered symbol as TSV. The project database is not committed
tools/hod2lib/  the format library -- pure Python, no third-party packages
tools/emu/      Unicorn-based function harness
tools/verify_*  the checkers; verify_all.py runs them all
web/            the browser player, and the gameplay port under web/src/game/
tests/          golden-file regression suite
extract/        gitignored scratch space; extract/player/ is the bundle
```
