---
name: gameplay-port
description: Workflow for porting The House of the Dead 2's gameplay out of the EXE into the browser player's web/src/game/ as a faithful transcription — the exe is the spec and the current port is a draft, rewritten wherever a reading contradicts it. Read with the decomp skill first, one exe function to one TS function under its Ghidra name, state where the engine keeps it, no port-only gameplay logic, every change leaves fewer divergences, then verify with tools/verify_port.py and npm run test:port. Use for any task that adds or changes enemy behaviour, damage, scoring, spawn classes, the camera director, or player state in the player.
---

# Gameplay port

`web/src/game/` **is the exe, transcribed.** Not a game that plays like
HOTD2: the same routines, the same state in the same places, the same
branches, readable line for line beside Ghidra. The why is
`docs/PLAYER_ARCHITECTURE.md` § *The gameplay code is a port*. The traps are
[`docs/LESSONS.md`](../../../docs/LESSONS.md), cited here by id and not
restated — read it before the first edit.

## The four rules

**1. The exe is the spec. The port is a draft.**
Every line in `game/` answers to a routine you read yourself, in full, with
`/decomp`, and named in `ghidra/annotations/` before it appears in
TypeScript. Not to a doc, a comment's citation (L38), memory, another port or
the existing TS. Where the port and the exe disagree the port is wrong, however
well it plays and however green its tests.

**2. Faithful needs no permission. Diverging does.**
Making the port match the exe, in the area you are working on, is the job and
not a proposal: do it without asking, even when it is a refactor, even when it
changes how every stage plays. Guard it with a test and report what moved.
Don't start a repo-wide sweep of unrelated divergences unprompted.

A **new** `[diverges]` is the exception, and it is the user's call. It is
legitimate only where the port *cannot* follow: the data is not in the bundle
yet, the mechanism is the platform's (D3D state, the matrix stack,
DirectSound), or the routine was read and the answer is still `[open]`. It is
never legitimate because the faithful fix is a refactor, or because a shortcut
"matches the engine in practice" — writing that sentence is the tell. One that
is declared carries its reason on the spot, names the inputs that would make it
matter and shows each reaches the port (L57), and has an assertion pinning
what the code actually does (L26).

**Every change leaves `verify_port.py`'s `divergences:` and `uncited exports:`
no higher, and lower where it can.** A divergence you can resolve in code you
are already in is part of the task.

**3. No port-only logic in gameplay.**
Every branch, guard, clamp, counter and default in `game/` has an exe
instruction behind it. Each of these had none, and each cost a session: a
guard the engine lacks (L27); a branch collapsed because its outcome looked
settled (L34), or forced because it was inconvenient (L45); one clamp for
states that each have their own (L8); a counter derived from the pool instead
of stepped where the engine steps it; a start "by convention" (L58); a
stand-in for a drawer nobody read (L54); a `default:` for a state nobody
ported (L38); a word substituted for one the port lacks (L64); a library
default for state the exe sets (L61). **Reaching for one means a routine is
unread** — go and read it.

Port-only code belongs at the seams and nowhere else — `GameHost` (what only
three.js can compute), the `G`/snapshot plumbing, types — tagged
`[port-only]`. `uncited exports` is a ratchet: it only falls, and port-only
code in a file you are already in is a candidate to go.

**4. New information reopens old code.**
We are not married to the current implementation: its files, helpers, `Actor`
fields, enum values, tests and state-machine shapes are all provisional. When a
reading changes what you believe — a field's meaning, a global's writer, an
arm's fall-through, a table's stride — the new code being right is half the
job. Find **everything built on the old belief** (every reader of the value,
L63 and L64; every test calibrated on it, L65; every comment and doc citing
it) and rewrite it. Restructure rather than adapt: split what the exe keeps
apart, merge what it shares (a shared label is one function), move state into
`G` or onto `Actor`, delete helpers and their tests. No shim that preserves the
old shape. Remove the divergence and open-question notes the reading settles.

## Reading: the pseudocode is not the routine

`/decomp` owns the procedure. What bites a port:

* **The decompiler drops code.** FPU arguments (L1), arms folded together
  (L37), everything after a call it believes never returns (L35, L60), bodies
  cut by a flow override (L55), arms that fall through into the next (L53).
  When the pseudocode says something the shipped game contradicts — no writer,
  no caller, a body that just stops — disassemble before believing it.
* **A dispatch table is read, not recalled**: `read_memory` the entries and
  check the neighbours against what the port believes (L38).
* **A negative is a claim.** Enumerate every caller, addressing mode and
  dispatcher before recording that nothing does X (L17, L32, L39, L58).
* **A field or a bit means what this class in this binary does with it** (L3,
  L67).

## Transcribing

* **One exe function, one TS function, same name.** Nothing inlined because it
  is three lines. No test moved across a function boundary (L11). Every arm the
  exe has.
* **State where the engine keeps it**: globals in `G`, object fields on `Actor`
  with their offsets (`attackPermit: number; // +0x121`). That is what makes the
  game snapshottable. A value the engine computes once a frame is computed once
  a frame (L59).
* **Clocks are stepped in `game/`** (L7), on the right one of the two (L12),
  and read at the cursor the engine's state reads (L62).
* **Randomness from `ctx.rng`.** `Rng.int(n)` is the only spelling of
  `rand() % n` and `rand() & (n-1)` (L10, L46).
* **Where the port encodes a value differently, transcribe the question the
  comparison asks, not its constant** (L63).
* **Release on every path out** whatever the actor holds — permits, counters,
  latches (L9).
* **Enums where the exe would switch** (states, class ids, control codes, flag
  bits) with the exe's own values; named `const`s for scalars. Plain `enum` —
  `const enum` breaks `isolatedModules` — and `Record`s keyed on it.
* **Tables from `.rdata` travel in the bundle; immediates from `.text` stay in
  `game/`.** A format change lands in `web/src/hod2lib/` and `tools/hod2lib/`
  in the same commit.
* **A class gets behaviour by registering** in `g_class_handlers`
  (`game/registry.ts`), never by an `if` elsewhere.
* **Nothing at module load reads another module's export**; derive it inside
  the function that uses it (L56).

## Layers

`game/` imports no `three` and nothing above the engine line, touches no DOM,
calls no `Math.random`, and holds **no `Scope`**: the exe's answer to lifetime
is the object pool and `ActorDespawn`, and a scope cannot survive
`clonePlain`. What the port cannot compute it asks `GameHost` for; render state
is derived and never saved.

When a faithful transcription needs something its layer forbids, **never
weaken the rule or the checker.** Finish what is not blocked, name the rule and
the step of `PLAYER_ARCHITECTURE.md`'s *Order of work* that clears it, and ask
whether to do that refactor first (CLAUDE.md).

## Citing

```ts
/** `ResolveHit` — `FUN_00409430`. Charges one shot against one bone. */  // ported here
/** ...as `ZombieStateStrike` (`FUN_00455A40`) does. */                   // ported elsewhere
/** `g_attack_permits` — `0x009A2BA0`, one per player. */                // a global
```

Always both names: the name is for people, the address for `verify_port.py`,
which checks both against the TSVs and fails a dash citation with no function
of that name in the file. **Inside the file that ports a routine, refer to it
by bare address** — the parenthesised form there removes it from coverage
(L42). Write about a marker without spelling it (L41).

## The loop

0. **Orient.** `git log --oneline -10`, `git status --porcelain`, `ListAgents`;
   *Order of work* in `PLAYER_ARCHITECTURE.md` (`◐` is half-done). Run
   `python3 tools/verify_all.py` for a green baseline and note `verify_port.py`'s
   `divergences:` and `uncited exports:`.
1. **Read** the whole routine and every call it makes, starting from its
   dispatch table (`g_class_handlers` `0x009A2280`, `g_class30_states`
   `0x00592AE8`). Name everything with `tools/annotate.py` first.
2. **Reconcile.** Read the port's existing version and what surrounds it. List
   every difference from what you just read, and everything built on a belief
   the reading overturns (rule 4). That list is the scope of the change.
3. **Transcribe**, and rewrite what step 2 found.
4. **Test** in `web/test/port.test.ts`, and watch the assertion fail without
   the change. It asserts the exe, not the old port: driven from
   `ResetGameGlobals` rather than a gate set by hand (L49), at a non-identity
   input (L48), on a signal only this code can produce (L47), against numbers
   derived from the exe rather than measured from the output (L65). If it is
   visible, look at it in the page (L19, L25).
5. **Verify.** `python3 tools/verify_all.py`; a skip is not a pass (L14). The
   two counts from step 0 are no higher.
6. **Document**: `PLAYER_PROGRESS.md`, `docs/formats/*.md`,
   `PLAYER_ARCHITECTURE.md` if the tree or order of work moved, and
   `docs/re/session-log.md` **including what you got wrong**. A new trap goes
   in `LESSONS.md` and nowhere else.
7. **Commit** only your own hunks, per CLAUDE.md. (`web/src/game/` is
   re-included by `!web/src/game/` in `.gitignore`; leave that rule alone.)

## Renaming

Encouraged, and **global or a bug**, in one commit. Sweep with
`rg -n --hidden -g '!node_modules' -g '!extract' 'OldName'`, then: the TSV row
in place (sorted by address; a rename does not move it); the database over MCP,
reading the `from` in each result (L52), then `./ghidra/run.sh
export-annotations` and its diff (L13); `game/**` and every comment in either
citation form; docs and tools. Never rewrite `docs/re/session-log.md` — append
the rename. `verify_port.py` and `verify_annotations.py --game-dir` check the
TS and the TSV; only the sweep checks the docs.

## Done means

- [ ] Every routine touched was read in full and is named in `ghidra/annotations/`
- [ ] The port matches it — call graph, branches, where state lives — and what
      the reading overturned elsewhere was rewritten, not left
- [ ] No new port-only logic in `game/`; any new `[diverges]` was asked about
      and carries its reason, its inputs and an assertion
- [ ] `divergences:` and `uncited exports:` no higher than at the start
- [ ] A new assertion, seen failing without the change
- [ ] `verify_all.py` green, skips named
- [ ] Wrong turns in the session log; only your own hunks staged
