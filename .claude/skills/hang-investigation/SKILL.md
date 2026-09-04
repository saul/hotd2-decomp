---
name: hang-investigation
description: Workflow for finding out why the browser player stops — a walker parked on a wait that never comes true, a room a player could not clear, or a stage that plays differently every run. Reproduce it, capture it, distil it into a headless harness, read the routine in the exe with /decomp before writing a line of TypeScript, fix it with /gameplay-port, and prove the fix by watching the check fail without it. Use for anything in docs/PLAYER_HANGS.md and for any report that the player "gets stuck", "never continues", or "only sometimes finishes".
---

# Hang investigation

The work list is `docs/PLAYER_HANGS.md`. This is the operating procedure for
taking one item off it. `/decomp` is how you read the binary and `/gameplay-port`
is how you write the TypeScript; this skill is what goes **between** them — how
to turn "it stops here" into a named routine, and how to know the fix is real.

**One hang at a time, start to finish.** Two half-investigations produce a
commit whose two halves each explain the other's symptom, and nothing is
proved. Finish an item — read, fix, check, record — before opening the next.

## What a hang actually is

Almost every one is the same sentence: **the walker is parked on an
instruction, and the condition it is waiting on is never made true.** The value
of that sentence is that it has exactly four possible faults, and they want
different reading:

| fault | where it lives | example |
|---|---|---|
| **the rule** reads the wrong condition | `web/src/script/waits/` | a wait word's mask tested against the wrong bits |
| **the count** is wrong | whoever maintains it in `game/` | item 2 — an actor left the world still counted |
| **the actor** cannot finish | the state routine in `game/` | an entrance whose cue never arrives |
| **the room is unclearable** | `render/`, the camera | item 1 — the camera faces a wall, so the enemies cannot be shot |

The fourth is not a walker bug at all and presents identically to the first
three. Separate it early — it is the difference between reading
`script/waits/` for an afternoon and reading `CamStartPathPlayback`.

There is a fifth shape that is not a stop: **the same stage does not play the
same way twice** (item 8). Treat non-determinism as its own investigation, and
do it *before* any intermittent hang, because until a hang reproduces you
cannot tell a fix from a coin landing your way.

## The non-negotiables

1. **Reproduce before you read, read before you write.** A hang you have seen
   once is a report. A hang you can produce on demand is a bug. Do not open
   Ghidra on a symptom you cannot summon back.
2. **The exe decides.** Every `[open]` in `docs/PLAYER_HANGS.md` means the
   routine has not been read. Read it in full, name it in
   `ghidra/annotations/`, *then* write TypeScript — `/decomp` in full, not a
   glance at a decompilation someone pasted in a doc.
3. **No guessing, and no bodges.** Correctness before a green run, every time.
   If you cannot say which line of which routine is wrong, you are not ready to
   change anything. `[open]` is a finished piece of work; a plausible patch is
   not.
4. **A divergence is the user's decision.** If the faithful fix is a refactor
   and the quick fix is a `[diverges]`, state what the engine does, state what
   the faithful fix costs, and **ask**. The tell that you are about to get this
   wrong is having just written *this matches the engine in practice*. It does
   not; it matches what you have thought of.
5. **Revert the fix and watch the check fail.** A test you have not seen fail
   is not evidence. This has already caught assertions here that passed with
   the fix backed out.
6. **Never make the tool pass instead of the game.** See *Things that are not
   fixes*, below. That list is the whole point of this skill.
7. **Commit only your own hunks.** Peers run in this repo concurrently.
   `git add -A` is banned — `git status --porcelain` first, explicit paths,
   confirm with `git diff --cached --stat`.

## The loop

### 0. Orient

```sh
git log --oneline -10
git status --porcelain          # what is dirty that is NOT yours?
```

Read the item in `docs/PLAYER_HANGS.md` and its evidence, `docs/PLAYER_PROGRESS.md`
for what the player is supposed to do, and `docs/re/session-log.md` for whether
this was tried before. Run `ListAgents` if a peer session may be live.

Get the baseline green before changing anything, so a failure later is yours:

```sh
cd web && npx tsc --noEmit && npm run test:port && npm run test:seek \
  && npm run test:scope && npm run test:state && npm run test:ui \
  && npm run test:projection && npm run verify:ui
cd .. && python3 tools/verify_port.py && python3 tools/verify_layers.py
```

### 1. Reproduce, and count

```sh
cd web
node tools/playthrough.mjs --stage N --headless
```

Run it **five times** and write down the outcome of each. This is not
ceremony: stage 1 gave four different outcomes over five runs, and a
one-in-five hang investigated as though it were reliable will "fix" itself.

Record the hit rate in the item. `5/5` and `1/5` are different bugs and want
different next steps — a `1/5` sends you to the determinism question first.

For a hang the playthrough reaches slowly, pin it with a URL instead. The
player is addressable by `stage`, `block`, `step`, `op`, `mode`, `slot`,
`frame`, `seed`, `freeze`, `all`, `original`:

```sh
node tools/shot.mjs --url '?stage=2&block=3&step=1&op=0' --out hang \
  --click 'label[title^="Click to shoot"] input' --press Space --settle 8000
```

**But a URL is a seek, and a seek is its own rebuild path with its own bugs.**
If the hang appears from the entry block and not from the deep link — or the
other way round — you have found a *second* bug, and the seek is now the
subject. Say which of the two you are investigating.

### 2. Capture it, before it goes away

Two items in the list say "was not captured in detail" and are stalled on
exactly that. When the hang is on screen, take everything:

* the harness's own hang report — instruction, wait word, the actors holding
  it and their debug rows;
* `web/shots/hang-stage<N>.png`, and **look at it and say what you see**. A
  scene that renders correctly rules out half the causes; a flat olive wall
  is itself the finding;
* the three sidebar readouts, which exist because each turned a row that said
  nothing into a number — a zombie in `HoldAtRange` prints **why** a permit was
  refused, a captor prints its script cursor, a civilian on a reach/face wait
  prints target, distance against radius, heading error and turn rate;
* the transport bar — camera path, slot, frame against length, and whether it
  says `(static pose)`.

Paste it into the item in `docs/PLAYER_HANGS.md` as you go, not at the end.

### 3. Triage: which of the four faults

Ask the panel, in this order:

| what the panel says | the fault is probably | read first |
|---|---|---|
| a gate with a nonzero count and **no actor listed holding it** | the count — something left the world without paying | every `++`/`--` of that counter, against the engine's |
| actors listed, all parked in one state | that state's exit condition | the state routine, **whole**, including its calls |
| the scene is wrong in the screenshot, or `(static pose)` | not the gate — the camera or the placement | the camera routines; a player could not clear it either |
| it comes down on some runs | timing — an exact-frame cue stepped over | every `===` against a frame counter |
| the wait word carries a bit nothing reads | the rule | the engine's reader for that bit, then `script/waits/` |

Then state the hypothesis as a sentence naming a routine and a line. If you
cannot, go back to step 2 — you are missing a number, not an idea.

### 4. Distil it into a headless harness

**This is the step that turns a hang into work you can iterate on.** A
260-second browser playthrough is not a debug loop. Every harness in
`web/tools/` was born this way, and each one now guards the whole corpus
against the class of bug that produced it:

* `entrances.mjs` — do the twelve entrance states actually *end*? (a wait
  transcribed slightly wrong never comes true and never looks wrong)
* `lifetime.mjs` — how many times does one spawn's `Init` run? (object
  lifetime, not the state machine)
* `civilians.mjs` — drive all 136 shipped class-0x10 streams
* `corpses.mjs`, `leaps.mjs`, `throwers.mjs`, `cadence.mjs` — one behaviour each
* `replay.mjs` — `npm run replay -- 2 3 1`, one block/step's spawns through
  `GameUpdate`
* `wall.mjs` — seeks the walker so the script's own state has run, and reads
  the camera off the path the step is playing, rather than inventing either

Reach for an existing one first; `replay.mjs` answers "what is this actor
doing" in a second. Write a new one when the question is about a **class** of
thing rather than one address — that is what makes it worth keeping, and the
whole-corpus form ("133 of 133 entrance spawns leave their entrance state") is
a check that can fail rather than a spot check that cannot.

Run harnesses through the esbuild wrapper, never bare:

```sh
node --experimental-strip-types --no-warnings tools/run_test.mjs tools/<name>.mjs
```

### 5. Read the binary — `/decomp`, in full

Start at the dispatch table, not at the function you think is guilty:
`g_class_handlers` (`0x009A2280`), `g_class30_states` (`0x00592AE8`),
`g_evt_action_table`. Read the whole routine including its calls, and mark
every claim `[proved]` / `[likely]` / `[open]`.

Two questions decide the shape of the fix:

* **absent or wrong?** Item 3 is a removal path the port simply does not have;
  item 4 is a comparison the port has backwards. Absent means transcribe a
  routine; wrong means find why the port's version differs, because somebody
  wrote it deliberately once.
* **is this one function reached from several places?** *A shared label is one
  function.* Three bugs in the list came from the same shape — a piece of the
  engine reached from several callers, written out once per caller, and the
  copies not identical. Check `get_xrefs_to` before transcribing.

Everything you understood gets named in `ghidra/annotations/functions.tsv` and
`globals.tsv` via `python3 tools/annotate.py` — **in the same commit as the
finding**. It inserts in address order, which is the order those files are
kept in; do not reorder them by anything else.

### 6. Fix it — `/gameplay-port`

Follow that skill in full: one exe function to one TS function under the same
name, both the remapped name and the `FUN_` address in the doc comment, state
where the engine keeps it, enums where the exe enumerates, and no rule
weakened to get the commit out.

Two hang-specific ones:

* **Every counter and every latch an actor can hold needs a hand in `retire`.**
  The port has a lifetime the engine does not have — "the script stopped
  listing you". In the exe an object leaves through its own state machine and
  its bookkeeping leaves with it. Item 2 is this, and it will recur.
* **Do not move a test across a function boundary** to make a gate come down.
  That is how the elevated throwers stopped throwing.

### 7. Prove it

Three things, in this order:

1. **The new assertion fails without the fix.** Back the fix out, run the
   check, watch it go red, put the fix back. Say in the commit message that you
   did.
2. **The corpus check passes.** The harness from step 4 over all the shipped
   data, not the one address.
3. **The playthrough, five times again.** Compare against the hit rate you
   wrote down in step 1. For a `1/5` hang, five clean runs is weak evidence —
   say so rather than claiming it fixed.

Then the full suite, and a worktree build so the commit stands alone:

```sh
cd web && npx tsc --noEmit && npm run test:port && npm run test:seek \
  && npm run test:scope && npm run test:state && npm run test:ui \
  && npm run test:projection && npm run verify:ui
cd .. && python3 tools/verify_port.py && python3 tools/verify_layers.py \
  && python3 tools/verify_annotations.py --game-dir ~/"THE HOUSE OF THE DEAD 2"
git worktree add --detach /tmp/standalone HEAD && cd /tmp/standalone/web \
  && npm ci && npx tsc --noEmit        # a commit here was already broken by
                                       # staging a hunk that needed a peer's file
```

### 8. Record it

* `docs/PLAYER_HANGS.md` — **mark the item fixed with the mechanism, do not
  delete it.** Item 2's four lines of "recorded because the shape will recur"
  are worth more than the fix. Add anything new you found on the way as a new
  `[open]` item rather than carrying it in your head.
* `docs/PLAYER_PROGRESS.md` — what the player now does.
* `docs/formats/*.md` — anything newly read out of the binary.
* `docs/re/session-log.md` — **including what you got wrong.** A recorded wrong
  turn stops the next session repeating it.

## Things that are not fixes

Each of these makes the run green and the game no better. None of them may be
committed, and reaching for one is the signal to stop and ask the user.

* **Raising `--hang`, `--patience` or `--shoot-for`.** The fifteen seconds is a
  claim about the game — no authored sequence in an arcade game is that long.
* **Clearing the gate.** The debug clear is the harness's declared cheat and it
  is *reported* for a reason: the rooms it had to cheat past are the rooms a
  player is stuck in.
* **Teaching the harness to shoot civilians.** You are not meant to shoot
  civilians. A `wait_scripted_actors` that does not come down on its own is a
  bug by definition, and killing through it hides exactly what the tool exists
  to find.
* **Deep-linking past the hang** so the playthrough completes.
* **Decrementing a counter where the symptom is**, rather than where the engine
  decrements it.
* **Loosening a comparison** — `===` to `>=`, a mask to a truthiness test —
  without reading the engine's own. Item 4 is `>=` where the engine has `==`
  and is currently harmless; that is a *known divergence with a note*, not a
  precedent.
* **Special-casing a block, step or op number.** The engine has no such test.

## Traps this list has already paid for

* **A negative result from one agent is not a fact.** Two agents called the
  sound ids unresolvable; a third found the table.
* **Two clocks.** `Loop.advance` drains the accumulator into **whole** frames
  and steps the walker once each; `Player.gameTick` hands the game phase
  `frames: dt * 60`, which is fractional and can be several frames at once.
  Establish which clock the thing you are debugging is on before blaming it —
  an exact-frame cue is safe in the engine, where `obj+0x19C` counts up by one,
  and is not automatically safe here.
* **The screenshot is evidence and the render is not the game.** Stage 1's
  block 4 renders perfectly and the enemies are simply outside the frame; stage
  2's block 3 is a flat wall. Same fault class, and only one of them looks
  broken.
* **Object fields are polymorphic.** `obj+0x11C` is hit points for combat
  classes and a sub-type selector for others. Check the class.
* **The decompiler silently drops FPU arguments** to the matrix calls. Re-read
  every constant with `disassemble_bytes` and quote the raw hex.
* **A green build is not a working page.** `tsc` and `vite build` both pass on
  a `querySelector` that returned null.

## Done means

- [ ] The hang reproduces on demand, and its hit rate over five runs is written
      down — before and after
- [ ] The screenshot and the panel are in the item, and you said what you saw
- [ ] The faulty routine is **named** in `ghidra/annotations/`, and every claim
      about it is marked `[proved]` / `[likely]` / `[open]`
- [ ] The fix is a transcription of a routine you read, not an adjustment that
      made the number come out
- [ ] Any `[diverges]` was **asked about first**, and carries its reason
- [ ] A check exists that fails without the fix, and you watched it fail
- [ ] The corpus harness passes over the shipped data, not one address
- [ ] Full suite green, and the commit builds standalone in a fresh worktree
- [ ] `PLAYER_HANGS.md` item marked fixed **with the mechanism**, new findings
      filed as new `[open]` items
- [ ] Wrong turns in the session log, not quietly dropped
- [ ] **Only your own hunks staged** — explicit paths, no `git add -A`
