# HOTD2 decompilation and browser player

Two halves that must not drift apart:

* **The decomp** — `ghidra/` (every recovered symbol as TSV, and a headless
  driver that replays them onto a fresh database), `docs/formats/` and
  `docs/re/`. Workflow: **`/decomp`**.
* **The player** — `web/`, a browser client that renders a stage and runs the
  gameplay as a transcription of the exe. `web/src/hod2lib/` reads every game
  format and writes the bundle the player loads, from the command line or
  inside the page. Workflow: **`/gameplay-port`** for anything under
  `web/src/game/`, **`/hang-investigation`** for a player that stops.

The repository is TypeScript apart from its checkers and generators under
`tools/`, which are Python with no third-party packages.

Read `README.md` for the layout, and `docs/PLAYER.md` before changing the
player's shape.

## The rules that are checked

Run these before you commit:

```sh
python3 tools/verify_all.py --game-dir ~/"THE HOUSE OF THE DEAD 2"
```

**`tools/verify_all.py` is the canonical list of checks** — one authored
table, rendered into `docs/STATUS.md` and printed by `--list`. Do not copy it
anywhere; add a row to `CHECKS` instead, with the one sentence saying what
only that check can see. The checks run in parallel, except the ones that
drive Chrome, which take turns in a lane of their own. **`--quick`** leaves
that lane and the game-dir checks out -- counted as skipped, never as passed --
and is the inner loop. The run prints its own wall time.

**Exit 0 means a check ran and asserted things; 1 means it found them wrong;
3 means it asserted nothing.** `verify_all.py` counts skips separately from
passes and names them. Some checks need an exported bundle (`cd web && npm run
export -- --game-dir ... --all`, or point `HOTD2_BUNDLE` at one) and some need
`--game-dir`; `docs/STATUS.md` says which.

A check against the installed game lives in `web/tools/checks/`, reads the game
through `web/src/hod2lib/`, and uses the frame in `web/tools/lib/exe_check.ts`.

### Layers, and the direction dependencies point

```
engine    core/ bundle/ script/ game/ hod2lib/   no three.js, no DOM, no Math.random
render    render/ audio/                         reads engine state, owns nothing
ui        hud/ ui/                               reads one projection, emits commands
app       app/                                   the composition root. sees everything
```

Down only. `engine` imports nothing above itself; `render` and `ui` never
import each other.

Lifetimes above the engine line belong to a **scope** — the disposal tree in
`core/scope.ts`. A scope holds only what is *not* in the snapshot, which is the
same thing as saying it holds exactly what `resync` must be able to rebuild.
**`game/` never gets one**: the port transcribes a fixed object pool, and a
snapshot slice has to survive `clonePlain`.

`tools/verify_layers.py` and `tools/verify_port.py` enforce the boundaries with
two severities: **error** rules must be zero, **ratchet** rules record a count
that may fall but never rise.

**Never add a violation to get work done.** If the task in front of you cannot
be finished without one:

1. Say so, and name the rule and the refactor that would satisfy it.
2. **Ask the user whether to do that refactor first, or to change the plan.**

Raising a ratchet baseline is the user's decision, never a line edit in the
checker. There is no suppression comment on purpose.

## Evidence convention

Mark every claim about the binary: `[proved]` — you read the code that says so;
`[likely]` — inference, with the evidence stated; `[open]` — undetermined.
**`[open]` is a useful answer and a guess is not.** Never name a thing from
where it sits or what it resembles.

In the port, `[diverges]` tags a place the port knowingly departs from the exe,
with the reason on the spot. The count of them is the honest measure of how
finished it is.

## Committing

**Other workstreams run in this repo at the same time**, often in the same
files, with their work uncommitted while they work.

`git add -A` and `git add .` are banned. Before committing:

```sh
git status --porcelain     # what is dirty that is NOT yours?
git add <explicit paths>
git diff --cached --stat   # confirm before committing
```

If a peer has edited a file you also changed, stage only your own hunks — see
the `/decomp` skill for the patch-filtering recipe. Leave their uncommitted
work exactly as you found it, and never rewrite history.

`ghidra/annotations/*.tsv` is written by both workstreams and is **sorted by
address**. Add rows with `python3 tools/annotate.py`, which upserts rather than
duplicating and inserts in address order, so two branches adding unrelated
rows touch different parts of the file.

`./ghidra/run.sh export-annotations` **merges** the live database into those
files: it keeps body comments, any row the database has no symbol for and any
comment the file already has (the database wins on names, the file on
comments -- `L90`), and refuses a generated name over a curated one. Its
filter of auto-generated names is a prefix list, so a Ghidra release that
renames a prefix lets its labels through. Read an export's diff rather than
trusting it.

## Things that have cost this project real time

**Read [`docs/LESSONS.md`](docs/LESSONS.md) before your first edit.** Every
entry is paid for, and each has a stable id so a commit message or a code
comment can cite `L7` rather than restating it. **Add new lessons there and
nowhere else**, at the end, with the next id.

The four groups, so you know when you need it: reading the binary (the
decompiler drops FPU arguments; Ghidra mistypes `CamEvalObjectPath6`; object
fields are polymorphic), transcribing behaviour, running the tools (**a tool
that prints nothing has not necessarily succeeded**), and believing what you
are looking at (**a negative result from one agent is not a fact**).
