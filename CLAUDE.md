# HOTD2 decompilation and browser player

Two halves that must not drift apart:

* **`ghidra/`, `tools/`, `docs/re/`, `docs/formats/`** — reverse-engineering
  The House of the Dead 2 (PC, 2001) and the exporters built on what it finds.
  Workflow: **`/decomp`**.
* **`web/`** — a browser player that renders a stage and runs the gameplay as a
  transcription of the exe. Workflow: **`/gameplay-port`** for anything under
  `web/src/game/`.

**`web/src/hod2lib/` writes the bundle, and it is the only thing that does.**
It began as a port of `tools/hod2lib/` so that a bundle could be built inside
the page; the two were compared byte for byte across all twelve stage bundles,
and the Python writer was then removed. What is left of the Python package is
the parsers -- twenty `verify_*` checks read the game through them and
`export_level.py` writes glTF with them -- so the same formats are still
implemented twice and `tools/verify_exporters.py` checks the two halves hold
the same modules and claim the same version. A format change lands in both in
the same commit. See `docs/TS_PORT.md`.

Read `docs/PLAN.md` for what is worth doing, `docs/PLAYER_ARCHITECTURE.md`
before changing the player's shape.

## The rules that are checked

Run these before you commit. They are fast and they are the reason the
boundaries still exist.

```sh
python3 tools/verify_all.py --game-dir ~/"THE HOUSE OF THE DEAD 2"
```

That is the whole thing, and it takes about ten seconds. **`tools/verify_all.py`
is the canonical list of checks** — one authored table, rendered into
`docs/STATUS.md` and printed by `--list`. It used to be a shell block copied
into this file and three skills; four of the five copies were stale and three
omitted suites that had existed for weeks. Do not write a new copy; add a row
to `CHECKS` instead, with the one sentence saying what only that check can see.

**Exit 0 means a check ran and asserted things; 1 means it found them wrong;
3 means it asserted nothing.** `verify_all.py` counts skips separately from
passes and names them, because a skip that reads as green is how four
regression tests came to be described as passing on machines that never ran
them. Three suites need an exported bundle (`cd web && npm run export`, or
point `HOTD2_BUNDLE` at one) and three need `--game-dir`.

### Layers, and the direction dependencies point

```
engine    core/ bundle/ script/ game/   no three.js, no DOM, no Math.random
render    render/                       three.js. reads engine state, owns nothing
ui        hud/ -> ui/                   reads one projection, emits commands
app       app/                          the composition root. sees everything
```

Down only. `engine` imports nothing above itself; `render` and `ui` never
import each other.

Lifetimes above the engine line belong to a **scope** — the disposal tree in
`core/scope.ts`. A scope holds only what is *not* in the snapshot, which is the
same thing as saying it holds exactly what `resync` must be able to rebuild.
**`game/` never gets one**: the port transcribes a fixed object pool, and a
snapshot slice has to survive `clonePlain`. `tools/verify_layers.py` enforces this with two severities:
**error** rules must be zero, **ratchet** rules record a count that may fall
but never rise.

**Never add a violation to get work done.** If the task in front of you cannot
be finished without one:

1. Say so, name the rule and what it would take to satisfy it.
2. Point at the step in `docs/PLAYER_ARCHITECTURE.md`'s order of work that
   clears it — every ratchet has one.
3. **Ask the user whether to do that refactor first, or to change the plan.**

Raising a ratchet baseline is a decision that belongs in the architecture doc,
never a line edit in the checker. There is no suppression comment on purpose.

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

`ghidra/annotations/*.tsv` is written by both workstreams. Add rows with
`python3 tools/annotate.py`, which upserts rather than duplicating and
**inserts in address order**. The files are **sorted by address**, and every
writer keeps them that way — `annotate.py` on insert, `ExportAnnotations.java`
on write.

They used to be append-only and grouped into topical sections, and that is
where every merge conflict in them came from: two branches adding unrelated
rows to the same last line. Sorted insertion puts them in different parts of
the file. The sections went with the change — each spanned nearly the whole
segment, so address order broke twelve of them into 149 fragments.

`./ghidra/run.sh export-annotations` **merges** into those files rather than
rewriting them — it keeps the body comments and any row the live database has
no symbol for. It used to rewrite, and against the database as it stands that
would delete 196 of `functions.tsv`'s 556 rows. Its filter is a prefix list
and therefore a version-drift hazard: `switchD` silently stopped matching
Ghidra 12's `switchdataD_`, so 316 auto-labels landed in `globals.tsv` and
three of them overwrote curated names. It refuses a generated name over a
curated one now, but check an export's diff rather than trusting it.

## Things that have cost this project real time

**Read [`docs/LESSONS.md`](docs/LESSONS.md) before your first edit.** Every
entry is paid for, and each has a stable id so a commit message or a code
comment can cite `L7` rather than restating it. (It said "twenty" for as long
as there were twenty-five, which is L16 about its own front door: a count in
prose rots. Nothing counts them, so nothing states a number.)

It is one file because it used to be four — this one and three skills — with
six entries duplicated across them in five wordings, already losing clauses.
Then a new lesson was written into one list of four, which made three of them
wrong the moment it landed. **Add new lessons there and nowhere else.**

The four groups, so you know when you need it: reading the binary (the
decompiler drops FPU arguments; Ghidra mistypes `CamEvalObjectPath6`; object
fields are polymorphic), transcribing behaviour, running the tools (**a tool
that prints nothing has not necessarily succeeded**), and believing what you
are looking at (**a negative result from one agent is not a fact**).
