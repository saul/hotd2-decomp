---
name: decomp
description: Workflow for reverse-engineering The House of the Dead 2 in this repo — decompile from the EXE first, name functions in Ghidra, verify against the corpus and with renders, then persist annotations and update the docs. Use for any task that reads the binary, adds a format, identifies game objects, or extends the exporter or player.
---

# Decomp workflow

The reasoning behind these rules is in `docs/re/method.md`. This is the
operating procedure. Read `docs/PLAN.md` for what is currently worth doing.

## The five non-negotiables

1. **The EXE decides, always.** Decompile the code that consumes a structure
   before looking at a single byte of the structure. Data is for *verifying* a
   reading, never for forming one. A layout inferred from data and then
   "confirmed" by more data is circular.
2. **Name everything you understand.** The goal is a Ghidra database where
   every function that matters to gameplay, rendering, loading, audio or
   scripting has a real name. An unnamed `FUN_` you understood and moved past
   is work thrown away.
3. **Verify, and prefer verification that can fail.** Whole-corpus checks and
   rendered images, not spot checks and not plausibility.
4. **Persist it.** Annotations to `ghidra/annotations/`, findings to
   `docs/`, the story to the session log. MCP renames leave no trail; an
   un-exported session is a lost session.
5. **Commit only your own hunks.** Other workstreams run in this repo
   concurrently. `git add -A` is banned — see *Committing* below.

## The loop

### 1. Orient

```
docs/PLAN.md            what is worth doing, and why
docs/PROGRESS.md        what is done
docs/re/session-log.md  what was tried, including what failed
docs/formats/*.md       the formats already solved
docs/re/addresses.md    the named tables
```

Check `git log --oneline -10` and `ListAgents` — a peer session may be editing
the same files.

### 2. Decompile

Start at a **dispatch table** or an **entry point**, not at a random function.
Tables are free function inventories: `g_class_handlers`, `g_evt_action_table`,
`g_class30_states`, the asset job kinds. `docs/re/addresses.md` lists them.

Use the Ghidra MCP tools. `run_script_inline` and `run_ghidra_script` are
gated off, and headless is locked out while the GUI holds the project — so
exploration is MCP reads, and anything that must persist goes in the
annotations files.

**Fan out with agents when a job is wide** — one class handler per agent, one
routine per agent. Give every agent the engine API table, the `[proved]` /
`[likely]` / `[open]` convention, and the traps below. Tell them explicitly
that `[open]` is a useful answer and a guess is not.

### 3. Annotate

Every function and global you understood goes into the committed annotations,
in the same commit as the finding:

```
ghidra/annotations/functions.tsv    address <TAB> name <TAB> comment
ghidra/annotations/globals.tsv      address <TAB> name <TAB> comment
```

Then check them:

```sh
python3 tools/verify_annotations.py --game-dir ~/"THE HOUSE OF THE DEAD 2"
```

If you renamed anything in the live database over MCP, export it:

```sh
./ghidra/run.sh export-annotations && git diff ghidra/annotations
```

A fresh checkout must rebuild to the same database:
`./ghidra/run.sh rebuild`.

### 4. Verify

Pick the check that could actually fail:

* **Whole corpus.** Add a `tools/verify_*.py`. Aim for a structural invariant —
  "1058 of 1058 motion blocks divide exactly by a stride the formula can
  produce" is a real test; "the header looks like a count" is not.
* **Render it.** For anything geometric, export and look:
  ```sh
  python3 tools/export_level.py --game-dir ~/"THE HOUSE OF THE DEAD 2" --stage N --unlit
  python3 tools/export_character.py 0x1A --motion 762
  /Applications/Blender.app/Contents/MacOS/Blender -b -P tools/blender_nodeview.py -- \
      <gltf> <node-prefix> extract/compare/<session>/<name>.png
  ```
  Then **read the PNG back** and say what you see. A cat that renders as a cat
  proves the skeleton, stride, bone indexing and rotation order at once.
  **Log the path** — the user looks at these.
* **Use EEVEE, never Workbench.** Workbench fakes wrap modes and lighting and
  has produced false conclusions here twice.
* Run the full suite before committing: `for v in tools/verify_*.py; do ...`

### 5. Document

Every session updates, in the same commit or the next:

* `docs/formats/<fmt>.md` — the format, with the function that proves each field
* `docs/PROGRESS.md` — tick what is done, add what is newly known
* `docs/PLAN.md` — if the shape of the remaining work changed
* `docs/re/session-log.md` — **including what you got wrong.** The log is a
  deliverable, not a diary; a recorded wrong turn stops the next session
  repeating it.
* `docs/PLAYER_PLAN.md` — if it affects what the browser player can render

If the finding is going **into** the player's gameplay port —
`web/src/game/` — follow `/gameplay-port` for that half. It is downstream of
this skill, not a substitute for it: nothing may be ported that has not been
read, named and annotated here first.

## Evidence convention

Mark every claim:

* `[proved]` — the code says so, and you read the code
* `[likely]` — inference, with the evidence stated
* `[open]` — undetermined. **Say this rather than guessing.**

Never name a thing from where it sits or what it resembles. "front wheel",
"health pack", "zombie" are guesses unless the code, a filename or a sound
record supports them.

## This binary's two name tables

There is no single asset name table, which is why identification is indirect.
Both of these are the difference between naming a thing and guessing at it:

* **Character skeletons → pol filenames.** `g_character_skeletons`
  (`0x004E0430`) per character type; its nodes name asset slots; slots resolve
  through `ExeTables.asset_slots()` to a filename — `cat.bin`,
  `hito_manbest.bin`, `zabat.bin`.
* **Sound records** at `g_se_name_list` (`0x005845F8`), 324 `{id, filename}`
  entries. `PlaySoundId` ids resolve to paths like
  `STAGE2_SE\CAR_SRIP_22.wav` — which is how the stage-2 car was proved a car.

## Traps that have already cost this project

* **The decompiler silently drops FPU arguments** to the matrix calls.
  Re-read every constant with `disassemble_bytes` and quote the raw hex.
* **`CamEvalObjectPath6` returns `{float x,y,z; int rx,ry,rz}`.** Ghidra types
  all six as float. It is wrong.
* **Match brace depth on the matrix stack.** `MatrixStackPush(0)` duplicates
  the top, so parts are siblings — unless a routine holds a push open, which
  makes a real parent/child chain. Count pushes and pops.
* **Two consecutive `MatrixTranslate` calls compose by addition.**
* **Object fields are polymorphic.** `obj+0x11C` is hit points for combat
  classes and a sub-type selector for others; `obj+0x1390` is a descriptor tail
  for most classes and a parent actor pointer for one. Check the class.
* **A negative result from one agent is not a fact.** Two agents reported the
  sound ids unresolvable; a third found the table.

## Committing: only ever your own hunks

**Other workstreams run in this repo at the same time.** A peer session is
often editing the same tree, sometimes the same file, and its work is
uncommitted while it works. Sweeping it into your commit misattributes it and
can commit something half-finished.

`git add -A` and `git add .` are banned here. This has gone wrong repeatedly.

Before you commit:

```sh
ListAgents                 # is a peer session live?
git status --porcelain     # what is dirty that is NOT yours?
```

Then stage **explicit paths**, never a wildcard:

```sh
git add tools/hod2lib/mot.py docs/formats/mot.md
git diff --cached --stat   # confirm before committing
```

**If a peer has edited a file you also changed**, paths are not enough — filter
to your own hunks:

```sh
git diff -- path/to/shared.py > /tmp/mine.patch
# keep only the hunks that are yours, then:
git apply --cached /tmp/mine.patch
git diff --cached --stat
```

If you have already committed someone else's work, undo it rather than leaving
it: `git reset --soft HEAD~1` then `git restore --staged <their paths>`.

Leave their uncommitted changes exactly as you found them. Do not "tidy" or
reformat a shared file. `ghidra/annotations/*.tsv` is **sorted by address** and
`tools/annotate.py` inserts in order — so adding a row is a one-line diff in
the middle of the file, not a change to its last line, and two agents adding
unrelated rows no longer collide. Do not reorder it by anything else.

## Done means

- [ ] Every function you understood is named in `ghidra/annotations/`
- [ ] `verify_annotations.py` passes and the other verifiers still pass
- [ ] A check exists that would fail if the reading were wrong
- [ ] Renders logged with paths, if anything geometric changed
- [ ] `PROGRESS.md`, the session log, and `PLAN.md` if the plan moved
- [ ] Wrong turns written down, not quietly dropped
- [ ] **Only your own hunks staged** — `git status` checked first, explicit paths, no `git add -A`
