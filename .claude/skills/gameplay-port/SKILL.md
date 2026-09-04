---
name: gameplay-port
description: Workflow for porting The House of the Dead 2's gameplay code out of the EXE and into the browser player's web/src/game/ — read the binary with the decomp skill first, transcribe the call graph one function at a time under its Ghidra name, keep state where the engine keeps it so it can be snapshotted, use enums for the sets the exe enumerates, then verify with tools/verify_port.py and npm run test:port. Use for any task that adds or changes enemy behaviour, damage, scoring, spawn classes, the camera director, or player state in the player.
---

# Gameplay port workflow

The reasoning is in `docs/PLAYER_ARCHITECTURE.md`. This is the operating
procedure for turning decompiled gameplay code into `web/src/game/`.

The player is a **reference implementation you can read next to Ghidra**. Every
gameplay bug this project has shipped came from reinterpreting rather than
transcribing — an inverted facing rewritten "in my own words", a permit
deadlock invented out of a state fallthrough the engine does not have, a cat
running the zombie's state machine, a rank test moved across a function
boundary the engine keeps. All four are impossible if the call graph and the
globals match.

## The seven non-negotiables

1. **Decompile with `/decomp` first.** You may not port what you have not read.
   Any reading of the binary done for a port — a new state, a table, a field —
   follows the decomp skill in full: EXE first, name it, verify it, annotate
   it, in the same session. Porting from a doc, from memory, or from another
   port is how a wrong reading gets a second life.
2. **One exe function, one TS function, same name — and cite both names.** The
   remapped name from `ghidra/annotations/functions.tsv` *and* the raw
   `FUN_00xxxxxx` address, in the doc comment. Never one without the other:
   the name is how a human finds it, the address is how the check finds it.
3. **State lives where the engine keeps it.** Globals in `G`, object fields on
   `Actor` at their offsets. That is what makes the whole game snapshottable,
   and the snapshot is what proves nothing is hiding in a closure.
4. **Enums for the sets the exe enumerates, constants for scalars.** Idiomatic
   TypeScript is not in tension with a faithful port — see below.
5. **Divergence is declared** with a greppable `[diverges]` and a reason —
   and **it is the user's decision, not yours.** Correctness comes before a
   working commit, every time. If the faithful thing is a refactor and the
   quick thing is a `[diverges]`, you MUST NOT pick the quick thing.
   Say what the engine does, say what the faithful fix would cost, and **ask**.
6. **Stay inside your layer.** `game/` is the engine: no `three`, no DOM, no
   `Math.random`, and no import from `render/`, `hud/` or `app/`.
   `tools/verify_layers.py` enforces it, and the rule is *never* satisfied by
   weakening the checker — see **When a rule blocks the work** below.

   **And no `Scope` in `game/`.** Scopes are the player's answer to a lifetime
   problem the exe does not have; the port's answer is the object pool and
   `ActorDespawn`, because that is what the binary does. A scope also cannot go
   in a snapshot — `World.save()` puts every slice through `clonePlain`. If you
   reach for one in `game/`, either the thing is render state and belongs in
   `render/`, or you are inventing a lifetime the exe never had.
7. **Commit only your own hunks.** Same rule as `/decomp`; peers run in this
   repo concurrently. `git add -A` is banned.

## The loop

### 0. Check what is mid-flight, before touching anything

The port is being restructured incrementally and you may be walking into a
half-done move. Restructuring is *allowed and expected* — but find out what
state it is in first, or you will fight it.

```sh
git log --oneline -10
git status --porcelain      # what is dirty that is NOT yours?
```

Then read the **Order of work** in `docs/PLAYER_ARCHITECTURE.md`: steps marked
`◐` are half-done and say exactly what is left, `☐` are untouched. If you
restructure, update that table and the tree above it **in the same commit** —
a plan that describes a layout the tree no longer has is worse than no plan.

Run `ListAgents` if a peer session may be live.

### 0b. When a rule blocks the work

It will happen: the faithful transcription of a routine wants something the
layer it belongs in is not allowed to have. A pose that needs the camera, a
panel that needs an actor, a class whose state the renderer already holds.

**Do not weaken the rule to get the commit out.** Not a `three` import "just
for this one", not a raised ratchet baseline, not a helper in `app/` that
launders the dependency. Every boundary in this project was written after
something expensive went wrong, and the stage-1 car spin lived for as long as
it did precisely because transcribed exe behaviour had drifted into `render/`
where no check could reach it.

Instead:

1. **Finish everything that is not blocked.** Most of the task usually is.
2. **Name the rule, and what satisfying it would take.** Which step of
   `docs/PLAYER_ARCHITECTURE.md`'s order of work clears it — every ratchet has
   one — and roughly what that step costs.
3. **Put the call to the user**: do the enabling refactor first, or change the
   plan. Both are legitimate; quietly violating the boundary is not.

A wider refactor being necessary is a finding worth having, not a failure.

### 1. Orient

```
docs/PLAYER_ARCHITECTURE.md   the rules, the tree, and what is left
docs/PLAYER_PROGRESS.md       what the player does, and what it got wrong
docs/formats/combat.md        the gameplay tables, field by field
docs/formats/spawns.md        the class table — what each class id is
ghidra/annotations/*.tsv      the names. The source of truth for both.
```

Then get the baseline green before you change anything:

```sh
python3 tools/verify_all.py
```

### 2. Read the binary — with `/decomp`

Start at the dispatch table, not at a random function: `g_class_handlers`
(0x009A2280) for a spawn class, `g_class30_states` (0x00592AE8) for a zombie
state. Read the **whole** state or routine, including the calls it makes; the
call graph is part of what you are porting.

Everything you understand gets a name in `ghidra/annotations/functions.tsv` and
`globals.tsv` **before** it appears in TypeScript. `verify_port.py` will refuse
a citation that is not in the annotations, which is the rule made mechanical.

### 3. Transcribe

One file per state or concern under `web/src/game/`, named for what it holds.

```ts
/** `ZombieStateBackOff` — `FUN_00455C30`. After a strike the actor keeps the
 * permit and retreats until it is outside the inner ring or 240 frames pass. */
export function ZombieStateBackOff(obj: Actor, eye: Vec3, dt: number): void {
```

* **Nothing gets inlined "because it is only three lines".** If the exe has
  `ActorSwapDamagedPart`, so does the port, and `ResolveHit` calls it.
* **Do not move a test across a function boundary.** `ZombieStateApproach`
  tests the queue rank *before* calling `TryClaimAttackSlot`, and
  `ThrowerTryClaimAttackSlot` has no such test. Folding the test into the claim
  is why the elevated throwers never threw.
* **Fields carry their offsets** in a comment: `attackPermit: number; // +0x121`.
* **A class with no module gets no behaviour.** Add it to
  `g_class_handlers` in `game/registry.ts` or the actor does nothing. That is
  structural on purpose — an `if` is what had the cat walking at the player.

### 4. Name and enumerate

**Enums where the exe enumerates.** Values are the exe's own numbers; members
are named for what the exe calls them; the doc comment cites the routine:

```ts
export enum ZombieState {
  /** `ZombieStateAttackRun` (`FUN_004554D0`). */
  AttackRun = 1,
  /** `ZombieStateStrike` (`FUN_00455A40`). */
  Strike = 2,
}
```

The line is: **if the exe would switch on it, it is an enum.** State tables,
class ids, control codes, result codes, flag bits and zone masks are enums.
Radii, rates, frame counts, thresholds and speeds are named `const`s — they are
scalars, not members of a set. `obj.state = 4` and `case 0x53:` are how bugs
get in; `CLOSING_SPEED = 6` is fine and does not want an enum.

`const enum` is banned (`isolatedModules`); a plain `enum` is right. Key a
`Record` on the enum — `Partial<Record<SpawnClass, ClassHandler>>` — so a bare
number cannot be a key.

### 5. Verify

Three checks, all of which can fail:

```sh
python3 tools/verify_all.py         # all of them, ~10s, skips counted separately
```

`verify_all.py` is the canonical list — `--list` prints what each check
uniquely sees, `--only <name>` runs one while iterating. **A skip is not a
pass:** three suites need an exported bundle and exit 3 without one.

`verify_layers.py` holds the boundaries in `docs/PLAYER_ARCHITECTURE.md`. Its
**error** rules must be zero — the layer direction, and `three` / DOM /
`Math.random` inside the engine. Its **ratchet** rules carry a count that may
fall but never rise, each one attributed to the step of the order of work that
clears it.

`verify_port.py` holds:

* every `FUN_` citation against `functions.tsv`, **under the same name**;
* every `` `g_name` — `0x00…` `` citation against `globals.tsv`;
* coverage — *"40 of 101 annotated gameplay functions have a port"*;
* every `[diverges]`, gathered into one list;
* every `game/class<NN>/` has a `SpawnClass` member and a row in `spawns.md`;
* no `three` import, no `Math.random(`, no `export let` in `globals.ts`.

Its **unnamed citations** line is a work list: addresses the port points at
that Ghidra has not named. Clearing one is a `/decomp` job.

**Add an assertion for what you ported.** `web/test/port.test.ts` drives the
state machines with a hand-written stage's worth of tables and no renderer.
This is where the port earns its keep: the lunge clamp and the misplaced
motion clock were both first failures of this file, not bug reports.

### 6. Document

* `docs/PLAYER_ARCHITECTURE.md` — the tree and the order of work, if either moved
* `docs/PLAYER_PROGRESS.md` — what the player now does
* `docs/formats/*.md` — anything newly read out of the binary
* `docs/re/session-log.md` — **including what you got wrong**

## Citing exe symbols: two forms, and the difference matters

```ts
/** `ResolveHit` — `FUN_00409430`. Charges one shot against one bone. */
export function ResolveHit(...)          // definition: this file ports it

/** ...as `ZombieStateStrike` (`FUN_00455A40`) does. */
                                          // reference: this is where it lives
```

Both are checked against `functions.tsv`. Only the **em-dash form** asserts a
port exists here, and `verify_port.py` fails it if no function of that name is
declared in the file. Use the parenthesised form for cross-references — enum
members, comments pointing at the routine that owns a field.

Globals take the same shape, against `globals.tsv`:

```ts
/** `g_attack_permits` — `0x009A2BA0`, one per player. */
```

## Renaming a decomp symbol afterwards

Names get better as more is read, and renaming is encouraged. **A rename is
global or it is a bug.** The failure mode is a name that is right in Ghidra,
right in the TSV, and stale in three docs and a comment.

```sh
rg -n --hidden -g '!node_modules' -g '!extract' 'OldName'
```

Every hit gets updated, in **one commit**:

1. `ghidra/annotations/functions.tsv` / `globals.tsv` — edit the row in place.
   The files are sorted by address and a rename does not move a row.
2. The live Ghidra database, over MCP (`rename_function` / `rename_symbol`).
   MCP renames leave no trail, so export and diff:
   `./ghidra/run.sh export-annotations && git diff ghidra/annotations` — that
   diff is the only thing that tells you the database and the TSV agree.
3. `web/src/game/**` — the function or enum member, **and** every doc comment
   that cites it in either form.
4. `docs/formats/*.md`, `docs/PROGRESS.md`, `docs/re/addresses.md`, `tools/*.py`.
5. **Not** `docs/re/session-log.md` and not past commit messages. The log is a
   historical record of what was believed when; rewriting it destroys the thing
   it is for. Append the rename and the reason instead.

Then let the checks confirm it. `verify_port.py` fails on any citation whose
name no longer matches the TSV — that is the whole TypeScript half, done for
you. The TSV itself is checked against the EXE by

```sh
python3 tools/verify_annotations.py --game-dir ~/"THE HOUSE OF THE DEAD 2"
```

and a clean `git diff ghidra/annotations` after `export-annotations` is what
says the database matches. Docs are the half nothing checks, which is why the
`rg` sweep above is a step and not a suggestion.

## The boundary, and why it is not decoration

`web/src/game/` **may not import `three`, touch the DOM, or call
`Math.random()`.**

That is not purity. It is what lets the whole port run headlessly in under a
second, and what lets `world.save()` return plain JSON that fully determines
the next frame. Two consequences worth knowing before you write code:

* **What the port cannot compute, it asks for.** Bone world positions and the
  camera's aim point come through `GameHost` (`game/host.ts`), because the
  skeleton lives in three.js. That seam is declared; three.js leaking across
  it is not.
* **Render state is derived, never saved.** A snapshot contains nothing from
  `render/`; loading one calls `resync` and the renderers rebuild from the
  actors. If a renderer cannot rebuild itself from game state, the split is
  wrong and the snapshot is the test that found it.

## Traps that have already cost this project

**[`docs/LESSONS.md`](../../../docs/LESSONS.md) is the list.** The ones that
bite hardest in a port:

* **L7** — clocks belong to the port. `ActorAdvanceMotion` is in `game/`.
* **L8** — a clamp added for one state applies to all of them.
* **L9** — a permit held by an actor that cannot attack blocks everyone.
* **L10** — `Math.random()` silently breaks the save state.
* **L11** — do not move a test across a function boundary.
* **L6** — the adjacent-array trap.
* **L3** — object fields are polymorphic; check the class.
* **L15** — a green build is not a working page. `verify_player_dom.py` is the
  guard; run it whenever you add a control.

A new trap found here goes in `LESSONS.md`, not in this file.

## Committing: only ever your own hunks

Identical to `/decomp` — peers edit this tree concurrently. `git add -A` and
`git add .` are banned. Check `git status --porcelain` first, stage explicit
paths, confirm with `git diff --cached --stat`. `ghidra/annotations/*.tsv` is
sorted by address and `tools/annotate.py` keeps it that way; do not reorder or
reformat it by anything else.

One repo quirk: `web/src/game/` is re-included by an explicit `!web/src/game/`
in `.gitignore`, because the root `game/` rule exists to stop game assets ever
being committed. Do not narrow that rule to make the port fit — the exception
is the right shape.

## Done means

- [ ] Everything you read is named in `ghidra/annotations/`, per `/decomp`
- [ ] Every ported function carries **both** its remapped name and its `FUN_`
      address, and `verify_port.py` agrees with the TSV on every one
- [ ] Every global the port writes is in `G`, cited with its address
- [ ] Sets the exe enumerates are enums; scalars are named constants
- [ ] `game/` imports no `three`, touches no DOM, calls no `Math.random`
- [ ] A new assertion in `web/test/port.test.ts` for what you ported
- [ ] `tsc --noEmit`, `npm run test:port`, `verify_port.py` all green
- [ ] Any rename applied **everywhere** — TSV, database, port, docs, tools
- [ ] `PLAYER_ARCHITECTURE.md` updated if the tree or the order of work moved
- [ ] Wrong turns in the session log, not quietly dropped
- [ ] **Only your own hunks staged** — explicit paths, no `git add -A`
