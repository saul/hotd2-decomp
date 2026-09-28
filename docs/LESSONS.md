# Lessons — the traps this project has already paid for

**This is the only list.** It used to be four: `CLAUDE.md`, and one in each of
`/decomp`, `/gameplay-port` and `/hang-investigation`. Six lessons appeared in
more than one of them, in five different wordings, and the copies had already
started losing clauses — the polymorphic-field trap is in all four lists and
only one of them still remembers `obj+0x1390`. Then a new lesson was written
into one list of four, which means three were wrong the moment it landed.

Every entry here cost this project real time. Each has a stable id so a commit
message, a session-log entry or a code comment can cite one — `L7` — instead of
restating it and starting the drift again. **Add new ones here and nowhere
else**; append, and do not renumber.

Read it before your first edit. The four groups below bite at different
moments: reading the binary, transcribing behaviour, running the tools, and
believing what you are looking at.

---

## Reading the binary

**L1 — The decompiler silently drops FPU arguments** to the matrix calls.
The pseudocode shows a call with fewer arguments than the instruction stream
passes, and nothing marks the omission. Re-read every constant with
`disassemble_bytes` and quote the raw hex in the annotation.

**L2 — `CamEvalObjectPath6` returns `{float x,y,z; int rx,ry,rz}`.** Ghidra
types all six as float. It is wrong, and the rotations come out as garbage
floats that look plausible enough to build on.

**L3 — Object fields are polymorphic.** `obj+0x11C` is hit points for combat
classes and a sub-type selector for others; `obj+0x1390` is a descriptor tail
for most classes and a parent actor pointer for one. **Check the class before
you name a field**, and name it for what that class uses it as.

**L4 — Match brace depth on the matrix stack.** `MatrixStackPush(0)`
duplicates the top, so parts come out siblings — unless a routine holds a push
open, which makes a real parent/child chain. Count pushes against pops.

**L5 — Two consecutive `MatrixTranslate` calls compose by addition**, not by
replacement.

**L6 — The adjacent-array trap.** Export and read only what the *index source*
names. Hunting for the end of a table finds the start of the next one, and the
result is a table with a plausible tail of wrong rows.

## Transcribing behaviour into the port

**L7 — Clocks belong to the port.** `action.t` was advanced by the renderer,
so a strike's hit frame could only arrive if something was drawing it, and a
restored save sat on a half-played swing for ever. `ActorAdvanceMotion` is in
`game/`.

**L8 — A clamp added for one state applies to all of them.** The inner-ring
stop that keeps actors out of the camera also made the lunge unable to reach an
attack whose own distance is *inside* that ring, so zombies swung for ever at a
range they could not close. Give the state its own floor.

**L9 — A permit held by an actor that cannot attack blocks everyone.** 161 of
stage 2's class-0x30 spawns have `attack_state <= 0`. Check before claiming,
and release on every path out; `ActorAbortAttackAndLeave` exists for that.

**L10 — `Math.random()` silently breaks the save state.** Two loads of one
snapshot diverge on the first swing, and nothing fails until someone notices
the game played out differently. Draw from `ctx.rng` or the `Rng` passed in.

**L11 — Do not move a test across a function boundary.**
`ZombieStateApproach` tests the queue rank *before* calling
`TryClaimAttackSlot`, and `ThrowerTryClaimAttackSlot` has no such test. Folding
the test into the claim is why the elevated throwers never threw.

**L12 — Two clocks, and they are not the same clock.** `Loop.advance` drains
the accumulator into **whole** frames and steps the walker once each;
`Player.gameTick` hands the game phase `frames: dt * 60`, which is fractional
and can be several frames at once. Establish which clock the thing you are
debugging is on before blaming it: an exact-frame cue is safe in the engine,
where `obj+0x19C` counts up by one, and is not automatically safe here.

## Running the tools

**L13 — A tool that prints nothing has not necessarily succeeded.**
`ghidra/run.sh` ran the headless analyzer under `set -e` and grepped the log
*afterwards*, so a run that died on the project lock — which is every run made
while the Ghidra GUI is open — printed nothing, exited 0, and left
`git diff ghidra/annotations` clean. That is indistinguishable from "there was
nothing to export", and a session's renames stay uncommitted while you believe
they are saved. **Check for the assertion, not for the absence of an error.**

**L14 — A check that asserted nothing is not a check that passed.** The
bundle-gated suites exit **3** for exactly this reason, and
`tools/verify_all.py` counts skips separately from passes. Four regression
tests were described in the record as passing while asserting nothing on any
machine without game assets.

**L15 — A green build is not a working page.**
`document.querySelector("#x") as T` is a lie the type system cannot catch: a
missing element is `null`, the cast hides it, and the first `addEventListener`
throws at startup behind a clean `tsc` *and* a clean `vite build`. That has
happened here — a shell `cd` failed, the markup edit never ran, and nothing
noticed. `verify_player_dom.py` is the guard; run it whenever you add a
control.

**L16 — A number written in prose is a second source for a fact a checker
already computes, and it will rot.** Hand-maintained counts in
`PLAYER_ARCHITECTURE.md` and `PLAN.md` drifted by 5,716 lines, 17 divergences
and 412 named functions before anyone noticed. Countable facts live in
[`STATUS.md`](STATUS.md), which is generated; nothing else quotes them.

## Believing what you are looking at

**L17 — A negative result from one agent is not a fact.** Two agents reported
the sound ids unresolvable; a third found the table. "I could not find it" and
"it is not there" are different claims and only one of them needs evidence.

**L18 — Verify against the disc, not against another copy of your install.**
Four `cam/` files were rotted in the local extract, and a whole restoration
engine plus a documented "NaN padding convention" were built to explain the
damage before anyone compared against `hotd2.iso`.

**L19 — The screenshot is evidence and the render is not the game.** Stage 1's
block 4 renders perfectly and the enemies are simply outside the frame; stage
2's block 3 is a flat wall. Same fault class, and only one of them looks
broken.

**L20 — `[open]` is a useful answer and a guess is not.** Every claim about the
binary is marked `[proved]`, `[likely]` or `[open]`, and a thing is never named
for where it sits or what it resembles. This is the rule the other nineteen
lessons are downstream of.

**L21 -- Anything you copy has moved by the time you finish copying it.**
`web/src/hod2lib/` was written against `tools/hod2lib/` over one long session,
and a concurrent workstream committed a new character-type rule to
`spawnres.py` in the middle of it. The port reproduced the version that had
been read, exactly and wrongly: stage 2 came out with 291 placements against
the reference's 292, and nothing but the output comparison could have said so.
Re-diff the source against `HEAD` before you call a transcription finished --
`git diff <the commit you started from>..HEAD -- <the source>` -- and make the
check that compares the two outputs, not the two texts.

**L22 -- A trial parse must bound itself by its input, not by what its input
claims.** `container.classify` decides whether a blob is compressed by trying
to decompress it, and the LZ port preallocated its output from the file's own
u32 size header. 865 of the game's files have a first dword that merely looks
like a size, up to 4.03 GB of it in `tex/st5_01b.bin`. Node hands over a 4 GB
buffer and the decode then fails, so the CLI never noticed for a moment; a
browser refuses, and a `RangeError` is not the `LZError` the trial was catching,
so it escaped and killed the export at the first raw texture bank. The grammar
cannot exceed 78.8 bytes out per byte in, which makes that header refusable by
arithmetic rather than by attempt. **And: the same code on two runtimes is two
implementations.** Everything about this bug was present in the CLI, passing.

**L23 -- A filter that makes the output look better is a claim about the game,
and it needs the same evidence as any other.** 5.1% of this game's triangles
are collinear in UV space, which smears one row of texels across a whole face:
a hard streak, or a solid black panel. The exporter deleted them by default and
recorded that "why the game does not show them is still unresolved -- either
way they carry no displayable texture information, so dropping them can only
improve the result." It could not: two of stage 1's are paving in the piazza,
and the bundle had a pair of triangular holes straight through the world. The
premise was never checked against the binary, and when it finally was,
`WalkMeshChainAndDraw` turned out to make no per-triangle test of any kind --
the game draws every one of them. **An unresolved question in the docstring of
a filter that is on by default is a divergence nobody declared.** The check
that catches this class is one that compares the export against the files it
was made from; comparing two exports with each other cannot.

**L24 -- Two live copies of the same data means "I fixed it" is only ever true
of one of them.** The player reads a stage from the dev server's
`extract/player/` or from the browser's OPFS cache, whichever holds it, cache
first. An exporter fix was verified against the server copy, reported as done,
and the reader was still looking at the cache -- which had been built before
the fix and which no version check could tell was old, because the only checks
were the bundle format and a digest of the *declarations*, and the fix changed
neither. **A version stamp has to cover whatever decides the bytes**, which for
a bundle is the exporter's code and not its interfaces. And the stamp for
"stale" must warn where the stamp for "unreadable" refuses: refusing on an
exporter change makes every unrelated fix cost a full re-export before the page
will open at all, which is how a check gets deleted. The gap had been written
down as a known unfixed item one session earlier, which is worth less than
nothing if it is not the first thing consulted when a fix does not appear to
land.

**L25 -- A wrong picture passes a weak check three times in a row.** The
thumbnail a stage is built with is meant to be a frame some seconds in. Three
separate faults each produced a flat fill of the fog colour -- a transport the
loader had stopped, a capture taken off the frame callback, and a second
request landing during the next stage's teardown -- and every one of them left
the surrounding state looking healthy: the walker at its first wait, the region
streamed, four models visible, 222 draw calls and 2,880 triangles through the
renderer. The assertion written for it, "the picture is mostly not black", was
true of all three. **Counting distinct colours is what tells a photograph from
a wash**, and the only reason any of it was caught is that the image was
written to a file and looked at. When a check is about something visual, the
first version of it should be your own eyes on the artifact; the automated one
comes second, and has to be able to fail the thing you just saw.


**L26 -- A `[diverges]` note describes what somebody meant, and only a check
says what the code does.** `render/rigs.ts` carried a careful paragraph saying
that before the first shot selects a route the port "draws the exporter's baked
root pose", with the measurement showing that pose and the descriptor's agree
for every rig in the six stages. The code placed the fallback instance from its
`op_` path at frame 0 instead, which is a pose the object never holds: stage 3's
boat stood parked in the canal, a hundred units off the shot, for the whole
opening. The note was the *reason it was never looked at* -- it read as though
the case had been thought about and settled. A divergence declared in prose and
not pinned by an assertion is a claim with an alibi; the fix here was one line
of code and three new checks, and the checks are the half that will still be
true next year.

**L27 -- An on/off test the engine does not have is a divergence nobody
declared.** `SetFogRange` (`FUN_004ABDF0`) doubles its two arguments, swaps them
when `near*2 >= far*2`, and pushes them. That is the whole routine: there is no
"is fog enabled" anywhere in it. `render/fog.ts` had invented one -- `far >
near` -- and it was invisible because the *ordinary* case passes it. What it
broke was the two cases that look degenerate and are not: `near == far` is the
zero-width ramp every stage's fade to black is made of (40 sites), and `near >
far` is a real band drawn between `far*2` and `near*2` (stage 5, blocks 7 and
9). **A guard added because a value pair "looks wrong" is a claim about the
data**, and this one was wrong about 40 sites in the shipped scripts. Scan the
shipped data for the values the guard would reject before writing it.

**L28 -- A worktree agent has to check where a repo tool wrote.** Two
`annotate.py` calls were made with a `cd` to the shared checkout in front of
them, so the rows landed in the user's tree and not in the branch that cited
them. Nothing said so: `annotate.py` printed `added`, `verify_annotations`
passed against the file it had just written, and the mistake only surfaced when
`verify_port` failed on a citation whose TSV row "did not exist". The shared
tree then had two uncommitted rows in a file two workstreams write. Check the
diff in *your* tree after any tool that writes one, and check that the shared
one is unchanged.

**L29 -- Two headless browsers on one machine make a measurement read zero.**
`npm run audio` taps every media element through an `AnalyserNode` and asserts
on the peak sample, which is the right shape of check: it fails a file that
200s and decodes to silence. Run while another agent's Playwright Chrome was
open, it reported all sixteen sources playing, every one at *exactly* `0.000`,
and failed three assertions. Nothing was wrong with the tree -- the audio path
was byte-identical to the branch where the same tool had measured `0.512`, and
it passed on a re-run once the other browser closed. **A whole population
reading exactly zero is contention or a disconnected graph, not evidence about
the thing under test**; a real regression takes some sources down, not all of
them including the music. Before believing a silent measurement, check what
else on the machine is holding the device, and re-run alone -- L20's "a
negative result from one agent is not a fact" applies to your own tools too.

**L30 -- `git checkout <ref> -- <path>` writes the index too, so staging first
protects nothing.** Wanting a before-and-after screenshot of a renderer change,
I staged the whole change, checked `web/src` out from `main`, exported and shot
the old bundle, and then ran `git checkout -- web/src` expecting the index to
give my work back. It gave main's back: the first checkout had already replaced
those paths *in the index*, and the second restored from that. Ten files of
uncommitted work vanished, and `git status` was clean, which is the worst way
for it to look.

It is recoverable, because `git add` had written every blob: `git fsck
--unreachable --dangling` lists them, and matching each against a line only
that file has -- not against its size -- puts them back. Doing it by size would
have been a coin flip between two 500-line files.

**Commit before you swap the tree**, or use a second worktree of the old ref.
A stash is not the answer either: a `stash pop` that conflicts leaves the same
problem with more steps.

**L31 -- A same-length edit undone within the same second leaves the mutant
running.** Mutation-testing `tools/verify_scene_exits.py`, I changed `nxt[0]`
to `nxt[1]` in `hod2lib/exetab.py`, ran the check, and wrote the original text
back -- all inside one Python process and so inside one second. The check kept
failing on the restored tree. `git diff` was empty and `grep` showed `nxt[0]`,
which is the same shape as L30's clean `git status`: the file was right and the
program was wrong.

CPython validates a `__pycache__/*.pyc` against the source's **mtime truncated
to the second and its size**. The mutation was the same length as the original
and both writes landed in the same second, so the restored file matched the
header the mutated bytecode was compiled with, and every later run imported the
mutation. `find . -name '*.pyc' -newer <source>` finds nothing, because nothing
is newer.

So: **`find tools -name __pycache__ -type d -exec rm -rf {} +` after any
scripted edit-run-restore cycle**, or run the mutants with
`PYTHONDONTWRITEBYTECODE=1`. And when a tool disagrees with the file in front
of you, suspect a cache before you suspect the reading -- this had me most of
the way through rewriting a check that was already correct.

**L32 -- A search over decoded operands is a search over one addressing mode.**
Estimating what was left to port before `wait_script_flag` could be honoured, I
swept the image for writers of `g_script_flags` with an operand pattern of
`0x9c7200` and got fifteen hits, all of the `MOV byte ptr [ECX + 0x9c7200]`
form. The literal form is rendered `[0x009c72f8]`, which **does not contain the
substring `0x9c7200`**, so every writer that names a flag by its own address
was invisible: both banner cards, the boss, class 0x14's eight, class 0x32's
two. The estimate that went into the last report -- "one spawn opcode and two
cue props" -- was built on that, and the two cue props turned out to open no
gate at all while four unported enemy classes did. Searching for the bare
`9c72` found 155. **Search for the address without the `0x`, and cross-check
with a byte-pattern search for the little-endian bytes** (`fe729c00` found the
one instruction in the image that names `g_script_flags[254]`, which the
operand search and `get_xrefs_to` had both missed as a *write*).

**L33 -- Regenerate the bundle hashes before you export, not after.**
`schema_hash.ts` and `builder_hash.ts` are baked into each bundle as it is
written, and the loader refuses a bundle whose stamp does not match the tree.
Change the exporter, export, *then* regenerate, and every bundle on disk
carries the old stamp: the page stops at the loading overlay with the message
inside it and **nothing on the console but a 404**, which under a headless
harness is indistinguishable from a hang -- six stages timing out on
`waitForSelector('#loading')`. The order is exporter, hashes, export. L24's
"a version stamp has to cover whatever decides the bytes" is the same rule
seen from the other side.

**L34 -- "Only one arm can be taken" is a claim about the data, and it does not
tell you *which* arm.** Class 0x25's `op 10` is `if (g_active_player == mode)`,
and the port implemented it as an unconditional step with a comment saying that
one player is the port's only configuration, so "taking the matching arm is the
same decision". It is the same decision only if the arms are interchangeable,
and they are not: the arm an `op 10` guards is very often `op 18`, `ActorKill`.
The two spawns at one point in stage 3's block 2 are the player's own character
and the second player's, each with a kill behind the test that says *the active
player is the other one* -- so falling through killed both, and every
third-person cut scene in the game lost its foreground. Across the twelve
bundles, 110 of 274 class-0x25 spawns ran a kill on the frame they were made.

It is L27's shape one step further on. L27 is a test the engine does not have;
this is a test the engine **does** have, deleted because its outcome looked
predetermined. Neither survives contact with the shipped data, and the way to
find out is the same in both cases: enumerate what the branch actually guards
across every stage before collapsing it. A collapse also hides upstream --
nothing had followed `op 10`'s second edge in the exporter either, so the arm
the actor really runs was not in the bundle at all and no amount of reading the
port would have shown it.

**L35 — A Ghidra xref list stops at a no-return tail call, and so does the
decompilation.** `get_xrefs_to 0x00408ec0` returns eleven callers of
`RegisterForCameraTracking` and not one of them is an enemy class, which reads
as proof that class 0x30 and 0x31 never become camera candidates — and that
would make the port's whole `g_enemy_slots` model invented. They do.
`ActorRegisterCameraPoint` (`FUN_00409B70`) ends `PUSH ESI / CALL 0x00408ec0`
at `0x00409bec`–`0x00409c03`, **after** the `JMP` to `MatrixStackPop` that
Ghidra has marked no-return: the function body ends there, the pseudocode ends
there with a `WARNING: Subroutine does not return`, and the call past it is in
no xref list. `disassemble_bytes` from the last address the body claims is what
finds it. The same thing hides a **loop**: `RegionDrawResidentSet`'s body ends
at `0x0040143E` and its loop tail, `0x00401443..0x0040145F`, lies outside it,
so the decompile of a list walk draws one entry and stops.

It is **L32** one level down — that lesson is about a search over decoded
operands seeing one addressing mode; this is about a search over Ghidra's
graph seeing only what Ghidra has decided is code. Both have the same tell: a
negative result that would make a large, working piece of the port impossible.
When a cross-reference search says a routine nothing could work without is
never called, disassemble past the end of every function that ought to call it
before believing the search.

**L36 — A `cd` out of your own worktree is L28 with your own hands on it.**
L28 is about a *repo tool* writing somewhere else. This is the same failure
one step earlier: six `python3 - <<'PY'` edit scripts were written with
relative paths and prefixed with `cd <the shared checkout>` so those paths
would resolve, and every one of them edited the shared tree that three peers
were live in. **Nothing failed.** Each script printed `ok`, because the anchor
text it was matching exists in both copies of the file, and `git status` in the
worktree was clean because nothing had happened there. The tell arrived from
`tsc`, on a symbol that had "just been added" and was not there — the same
shape as L30's clean `git status` and L31's `grep` that agrees with you while
the program does not.

Repairing it is not `git checkout`: the shared tree had uncommitted peer work
in other files and possibly in the same ones. Reverse-apply each replacement
you made, then prove it with `git archive HEAD <paths> | tar -x -C /tmp/x` and
`diff`, which is the only thing that says the tree is back where it was.

**Never `cd` out of your worktree. Put the absolute path of the file you are
writing in the script**, so that a script which lands in the wrong tree fails
loudly instead of succeeding quietly. The same goes for invoking a repo tool by
absolute path — `python3 /repo/tools/annotate.py` resolves its data files
relative to *itself*, not to your cwd, which is how two annotation rows went to
the wrong tree in the same session.

**L37 — The decompiler folds arms that look alike and drops the tails that
make them different.** `HudDrawShutterState` (`FUN_00413970`) is a nine-arm
switch that drives `g_nFiringGate`, and Ghidra's pseudocode for it contains
**no write to that global at all** in three of the arms: cases 0, 3-at-zero and
5 each draw an identical closed shutter and `return`. Read literally that says
the engine never lowers the firing gate, which would make a shipped room the
player cannot shoot in a port bug rather than the script's own doing — and that
is exactly the conclusion it was about to be used for.

The three arms are not identical. Their tails sit in bytes the listing walks
past: `00413A0B` writes `1`, `00413A74` and `00413B06` write `0`, and each also
sets the state to 4. `disassemble_bytes` over the gaps between the arms is what
finds them, and the jump table — here `0x00413C80` — is what says which arm
belongs to which case, because the pseudocode's `case N:` labels are the one
part you can still trust.

It is **L35** one step over: that lesson is a cross-reference list stopping at a
no-return tail call, this is a *decompilation* stopping at the end of the block
it chose to show. Same tell in both, and it is the useful one: a negative result
that would make a working piece of the shipped game impossible. When the
pseudocode of a state machine has no writer for the global the state machine
exists to drive, disassemble every arm before believing it.

**L38 — A dispatch table entry is settled by reading the table, and a name in
a doc comment is not a reading.** `ZombieState.Leave = 10` carried
`ActorAbortAttackAndLeave` (`FUN_0045D9F0`) as its citation in `states.ts`, in
`leave.ts` and in `PLAYER_HANGS.md`. `g_class30_states[10]` is `0x00455490`,
`ZombieReleaseAndDespawn` — a **despawn**, not a rejoin. `FUN_0045D9F0` is not
in the table at all: it takes no argument and assigns no state, and
`leave.ts` had already said so in prose while the port went on relying on the
name.

The cost was not the wrong comment. It was that the port had **no `case` for
state 10**, so every actor that reached it fell to the dispatch's `default` and
went to `WaitTurn` alive — and `wait_enemies_alive` in stage 5's block 2 could
then never come down, whatever else was fixed. The tell was in the
playthrough's own dump for two sessions (`0x1DD4 znnick · WaitTurn/1`) and read
as noise, because a state the port does not implement looks the same as a state
it implements wrongly.

The table is four bytes and a multiply: `read_memory(0x00592AE8, 4*n)`, then
check the entries **either side** against what the port already believes, which
is what says the indexing is not adrift. Do that before writing a `case`, and
before believing one that is missing. It is `L20` pointed at the port rather
than at the binary: a citation is a claim, and the address is the evidence.

**L39 — An exhaustive scan that finds no table is a fact about tables, and the
engine is not obliged to use one.** `char_adv02` loses the band between a
damaged chest and its pelvis, and the hunt for what fills it got as far as
"`harold.bin` carries five lower-torso models of exactly the missing extent
that **no table in the EXE references** — an exhaustive scan finds the run only
in the `pol/` slot lists themselves", and stopped, correctly refusing to guess
which of the five. Every word of that is true. The join was not guessable from
a table because there is no table: `ZombieDrawBonePart` (`FUN_004534A0`) forms
the slot with `MOV ECX,0x1E; CDQ; IDIV ECX; ADD EDX,0x1B52` and the run is
**thirty** models, of which those five are the last five. A count that looked
meaningful — "exactly as many as bone 1 has damage stages" — was an artefact of
reading the tail of a longer run.

What let the search settle there was a true premise carrying a false
inference. `AssetDrawSlot` (`FUN_00418560`) does draw exactly one model per
slot, and a bone's draw record does name exactly one; the note concluded "so a
bone cannot draw two". It does not follow, because `SkeletonEmitNode`
(`FUN_004114C0`) does not call the one-slot draw for a class-0x30 actor at all
— it calls the **per-bone hook** at `model+0x1158`, and a hook calls the draw
as many times as it likes. Three of the four classes that install one were
already named in `functions.tsv`; nobody had read class 0x30's.

So: when a scan for the data comes back empty on something the shipped game
visibly does, the next question is not "which of these candidates is it" but
**"what computes it"** — and the place to look is the indirect call the walk
makes instead of the draw you were reading. `L17`'s "a negative result is not a
fact" has a sibling: a negative result can be a fact *and* be about the wrong
question.

**L40 — A `git stash` during an unresolved merge throws the merge away, and a
scripted "keep both sides" resolution drops the code on the conflict
boundary.** Two mistakes in one merge, both mechanical, both silent, and the
tell arrived from a compiler rather than from git.

`git stash -u` mid-merge clears `MERGE_HEAD`. The pop put the *content* back,
so `git status` and `git diff` looked right and every file held the merged
text — but the merge's second parent was gone, and committing there would have
recorded main's work as if this branch had authored it. Recoverable only
because the branch's own work was already committed: `git reset --hard HEAD`
and merge again. This is `L30`'s rule — **commit before you swap the tree** —
with the tree being swapped by a command that does not look like a checkout.

Then the resolution itself. Where both branches append a block before one
shared anchor, "keep both sides, main's first" is the right call and a regex
that concatenates the two halves of the hunk is the wrong way to make it: the
closing `}` of main's block sat *inside* main's side of the hunk in one file
and *after* the hunk in another, so one file came out with a brace missing.
`docs/re/session-log.md` and `docs/PLAYER_PROGRESS.md` survived it and
`web/test/port.test.ts` did not, and nothing about the diff said so —
`tsc` did, 380 lines later, as `'}' expected` at the end of the file.

So: after any scripted conflict resolution, **check that every heading of both
parents survived** (`comm -23` on the two `grep "^## "` outputs is enough for
prose) and run the type checker before staging for code. A resolution that
loses a line is indistinguishable from a resolution that was correct, right up
until something parses it.


**L41 — A marker something counts is not a word you may also use in prose.**
Consolidating `ActorPlayHitVoice` into one copy closed a real open question in
`combat/feedback.ts` — the bursting head had been silent because the voice
tables were on the other side of the layer line — and `STATUS.md`'s
`[open]` markers went **158 to 159**. Two narrative sentences saying *"that
used to be an `[open]`"* and *"it had been an `[open]`"* each put the literal
token back, and the counter counts tokens. So the number moved the wrong way
across a change that answered one of the things it counts, and it would have
gone into a report as evidence of the opposite.

The same hazard is on `[diverges]`: a cross-reference reading *"see the
`[diverges]` above"* is counted as a second declaration, which is what kept
the divergence total flat over a commit that removed one. Both are cheap to
hit, because writing about closing a marker is the natural thing to do in the
comment where the marker was.

**Write about a marker without spelling it** — "an open question", "this
routine's declared divergence" — and check the generated count *after* the
edit rather than assuming the direction. It is `L16` from the other side:
that lesson is a number in prose rotting against a checker, this is prose
*creating* the number the checker reports.

**L42 — A cross-reference to a function in the file that ports it silently
deletes the port.** `verify_port.py` reads two citation forms: the em-dash
`` `Name` — `FUN_00…` `` asserts *this file ports it*, and the parenthesised
`` `Name` (`FUN_00…`) `` is a mere reference. Because the reference pattern
also matches inside the dash form, `check_names` skips any `(name, fun)` pair
it has already seen as a reference:

```python
refs = {(n, f) for n, f in REF.findall(text)}
for name, fun in DEF.findall(text):
    if (name, fun) in refs:
        continue        # the reference form also matches the dash one
```

So writing `` `ZombieStatePounceOnTarget` (`FUN_0045C2E0`) `` in a comment in
`class30/target.ts` — the file that *defines* `ZombieStatePounceOnTarget` —
took that function out of the ported set. Coverage went 163 → 162 and
"citations checked" 317 → 316, nothing failed, and the only visible trace was
two numbers moving in a generated doc while the diff showed no citation had
changed at all. `git diff | grep '— `FUN_00'` came back empty, which is L31's
tell again: the file is right and the program disagrees.

**Inside a file that ports something, refer to that same routine by its bare
address** — "state 44's routine at `0x0045C2E0`" — or by name with no address
beside it. The parenthesised form is for functions ported *somewhere else*. And
when a generated count moves in a direction your change does not explain, diff
the checker's own answer rather than the source: dumping `check_names`'s dict
against the same dict from `git archive HEAD` named the one lost address in a
second, after twenty minutes of grepping for a citation that was never missing.

**L43 — A backup taken before a merge is a copy of the pre-merge file, and
restoring it reverts the merge.** Mutation-testing the class-0x41 exporter
meant editing `web/src/hod2lib/bundle.ts`, so I copied it aside first, mutated
it, and copied the backup back. Between those two steps I merged `main`. The
restore put the pre-merge file back and silently deleted main's
`bodyCreatureDrawSlots` — a whole exported function, three call sites, another
session's work — and both halves of that were invisible: the mutation test
passed, `tsc` passed, the check under test passed, and `git status` showed one
modified file that was *supposed* to be modified.

**`git checkout -- <path>` is the restore that cannot do this**, because it
restores from the index and HEAD, which already have both sides of the merge. A
file copy has no idea a merge happened.

What caught it was reading `git diff` on the file before staging and seeing 66
deletions where the edit was five lines. No check would have: the deleted
function had no test of its own, and a check that asserts what the exporter
*writes* cannot see a slot list that is no longer asked for. So this is L30's
family — `git checkout <ref> -- <path>` writing the index, a stash that
conflicts — with the same moral one step further out: **inspect the diff of
every file you restored, not just of every file you edited.** A restore is an
edit whose content you did not choose.

**L44 — A harness that prints its arguments as its result cannot report that
it failed.** `tools/props43.mjs` was written as
`seekTo(walker, { block: Number(block), step: Number(step) }, rng)` against a
positional `seekTo(w, block, step, opIndex, maxOps, entryBlock)`. `arrived()`
compares `w.block === block`, an object equals nothing, `maxOps` fell back to
500,000 — so it never seeked at all: it replayed **the whole of stage 3** to its
end at block 11 and returned `false`, which the call site discarded. It then
printed `stage 3, seeked to block 0 step 3` from its own `argv` and reported two
props there. The props are at block 0 step 3 **op 10**, behind
`wait_enemies_alive <= 0` at op 8 — a room the player has to clear — and the
browser showing `breakables: none placed` at op 0 was right the whole time. A
session went looking for a bug in the player's deep links on the strength of
that line.

Three things had to line up, and each is worth its own guard:

* **`.mjs` harnesses are outside `tsc`.** `allowJs` is off, so
  `include: ["tools"]` sees only the `.ts` files there, and
  `--experimental-strip-types` and esbuild check nothing. The 30-odd `.mjs`
  drivers call `src/` freely with no signature check at all, while
  `verify_all`'s `tsc` row says "`test/` and `tools/` included" — for those
  files it is not true. Turning `checkJs` on reports 764 errors, so closing
  that gap is a piece of work and not a line edit.
* **A silent degradation with a total effect.** The fix is in `seek.ts`: a
  target that is not a whole number throws and names the argument. Same trade
  as `L15`'s `querySelector(...) as T` — fail at the call, not three
  conclusions later.
* **Print the state, never the request.** `arrived` is returned for exactly
  this reason and nine of the ten call sites test it. Report
  `w.block/w.step/w.opIndex`, and a seek that went somewhere else says so.

A second thing the harness could not have seen, which is why it is not only a
typo: **a walker-only harness runs past every `wait_enemies_alive` gate.**
`spawn_obj` pushes descriptors and nothing more — `SpawnScriptedCharacters` is
called from `app/systems.ts`'s `syncCharacterSpawns`, by the character layer —
so with no renderer no enemy enters the pool, `g_enemies_alive` never leaves 0,
and the 434 shipped gates that read it all open on the first frame. A harness
that means to honour one has to stand in for that layer the way
`tools/cam_cues.mjs` does. Silence from one that does not is not evidence about
the room.

And the measurement that settled it is worth copying: drive the page with
`?drive=1` and assert the **frame count moved** before reading anything off it.
Watching a panel while the run has not advanced is not a negative result, it is
no result — `L20` pointed at your own instrument.

There is a smaller version of the same fault in the panel it was all about.
`render/breakables.ts` said `none placed` both for "the script places none
here" and for "the placers are in the pool and the transport is paused, so
`PropContainerPlacerUpdate` has not run" — `spawn_placed` makes a *placer*, and
the constructor that makes the prop is a class handler that needs a frame of
`GameUpdate`. **One sentence for two situations is a readout that cannot be
acted on**, and it is what made a correct page read as a broken one.

**L45 — A tool that overrides a decision the game makes puts the world in a
state the game cannot be in, and then every hang behind it is a lie.**
`playthrough.mjs` gained `--route`, which takes a chosen arm at a branch by
clicking the branch bar's override — the player's own feature, built for a
viewer who wants to see the other road. Driven with `--route 0:1` on stage 2 it
reached block 1 and reported **two unclearable rooms**, at blocks 3 and 5, with
`g_enemies_alive 1` and no actor the panel could name.

Neither was real. The only writer of that branch's arm 1 is
`RescueTargetHeldState` (`FUN_00451980`), the class-0x21 actor's own rescue,
which returns both enemy counters as it writes it. Clicking the arm instead
left that actor alive in `Held`, holding `g_enemies_present` and
`g_enemies_alive`, and its two ways out — the rescue, and camera path `0x39`
frame `0x121` — are both behind it once block 1 is running. So the run carried
a permanent `+1` on the counter every room gate in the stage reads. **The
engine has no path to that state**: arm 1 *is* the rescue.

The fix was not to the port. It was to make the tool **play for the arm before
it takes one** — fire at the block the way a player would, and let gameplay
write the variable — and to report an arm it had to click as an override, so
that a hang behind one is quarantined until the state it leaves has been shown
to be reachable. Both hangs evaporated.

It is `L34` from the other end. That lesson is about deleting a branch because
its outcome looked predetermined; this is about *forcing* one because the
outcome was inconvenient. In both cases the arm is a fact about the world and
not a free parameter, and the way to find out what it costs is to enumerate
what writes it before overriding it. A coverage tool may cheat — this one also
kills rooms with a debug button — but every cheat has to be printed in the run,
because the next person to read the output will otherwise spend a session
reading the port for a bug the harness invented.

**L46 — `Rng.next()` returns a float, so a bitwise operator on it is silently
zero.** `MouseWanderUpdate`'s turn is `(rand() & 0xFFF) - (rand() & 0xFFF)`, and
the port transcribed it as `(rng.next() & 0xfff) - (rng.next() & 0xfff)`.
`Rng.next()` is in `[0, 1)`; JavaScript's `&` converts to a 32-bit integer
first, so both terms were `0`. The mouse paused on its own cue every hundred
frames, turned by exactly nothing, and ran in a straight line until its six
hundred frames were up.

Nothing caught it for as long as it existed, and the reasons are worth knowing
because they generalise:

* **The generator stayed in step.** Both draws were still taken, so every later
  draw in the shared stream landed where it would have. A save state restored
  perfectly and the determinism check passed. A wrong *use* of a draw is
  invisible to every test that only asks whether the stream is reproducible.
* **The unit test drove it with a fresh `Rng` per frame**, so two draws in one
  frame were two draws from seed *n* either way, and the assertion — that the
  mouse moved — held with a turn of zero.
* **Zero is a legal turn.** There is no crash, no `NaN`, no clamp; the actor
  does something plausible, in a straight line, off camera, in Original Mode
  only.

It was found by eye, reading the class for something else. The guards now are a
named constant — `MOUSE_TURN_SPREAD`, a *count* rather than a mask, because
`Rng.int` is the port's `% n` — and four assertions that check the turn happens,
goes both ways, stays inside twelve bits, and reaches the velocity on the same
frame. Three of the four fail on the old line and a fifth mutation, a single
draw instead of the difference, fails the "both ways" one.

The rule: **`Rng.int(n)` is the only way to spell `rand() % n` or `rand() & (n-1)`
in this port.** `next()` is the raw float and belongs in a multiply. When the exe
masks rather than divides, check the mask is uniform over `rand()`'s range
before calling it a count — `0x8000` is exactly eight times `0x1000`, so
`& 0xFFF` is, and a mask that is not would need saying so.

**L47 — A count that falls is not proof a shot landed.** Class 0x46's bats were
reported unshootable, and the session that ported them had "checked" it by
clicking at one in the running player and watching `g_enemies_alive` drop from
three to two. It did drop. A bat also gives both counters back when it reaches
the camera, which it does every hundred frames or so whether or not anybody
fires, and the two are indistinguishable from the count alone. The shot had
never worked: nothing in the class descends into a bone, so the character
layer's bone-sphere pick had nothing to test.

**Pick a signal only the thing you are testing can produce.** `g_player_score`
moves by 80 on a kill and by nothing on an arrival, and re-running the same
click with the score as the assertion said 0 → 0 immediately. The same goes for
`g_enemies_present` on any class that leaves under its own state machine, for
`despawned` on anything with a lifetime, and for "the block advanced" on any
gate that also times out.

The second half is that the check belonged in a file, not in a shell loop.
`pickShot` had no test at all — the whole of `render/characters.ts`'s shot path
was exercised only by playing — and the four assertions added with the fix fail
on the code as it was.

**L48 — A transform tested only at the identity cannot fail on units.** The
carrier test rode a boat at yaw 0, and `CarrierTransformPoint` multiplied BAMS
by BAMS-per-radian: zero times anything is zero, so the test passed and every
rider in the game was spun around its boat. Give a rotation test a quarter
turn, where `sin` and `cos` swap and a wrong factor, a wrong sign or a wrong
axis all show.

**L49 — A test that sets a gate by hand proves only what is behind it.** The
bat's strike and the horde's bite both test `g_player_state == 5`, and both
had passing tests that wrote `G.g_player_state = [5, 0]` in their setup. The
page never wrote 5 -- the port seeded 0 and had no writer -- so in the game
neither ever hurt anyone, for as long as the tests stayed green. When a setup
line writes a global, ask what writes it in the page; if the answer is
"nothing", the test has found the bug and hidden it in the same line. Drive at
least one check from the reset the page runs (`ResetGameGlobals`), not from a
state assembled for the test.

**L50 — A driven volley is not a trigger.** `playthrough.mjs` fires its whole
grid between two driven frames, so the port's shot queue hands **one frame** a
hundred and thirty pulls; the engine polls the trigger once a frame and has
never seen two. A class that resolves its own mark on its next update -- class
0x14 reads back the bone byte and the shot record -- sees only the last pull
that crossed it, and stage 2's boss took **zero** damage in 33 dense volleys
while one pull every three frames at the same point killed it. Before calling
a fight unwinnable from a harness, fire at it one pull a frame; and a class
that reads the shot record back must read the pull that marked it
(`Actor.shotRays`), not the frame's last.

**L51 — A subagent's scratch directory is its parent session's, and the
siblings share it.** Every agent a coordinator launches is handed the same
`scratchpad/` path, so a helper named `mutate.py` or `test_block.ts` is one
file for all of them. Two of mine were overwritten by a sibling working on a
different class between my writing them and my running them again, and the
only tell was a harness notice that the file had changed on disk -- the
insertion script had already consumed my copy, so nothing broke, which is
luck and not a guarantee. A test block pasted into `port.test.ts` from a file
another agent had just rewritten would have committed their assertions under
my name. **Make a subdirectory named for your task and keep every scratch
file in it**, and treat a name at the scratch root as something another agent
may already own. It is L28 and L36 pointed at the one directory that is
outside every worktree by design.

**L52 — A Ghidra rename by address overwrites whatever a peer named there,
and says so only in its result.** Porting the ring a class-0x30 corpse leaves,
I found three routines with no Ghidra function, created them, and named them
over MCP. `rename_function` succeeded every time. Its message read *"Renamed
function at 0x00407e30 from 'RingEffectSpread' to ..."* -- a peer porting the
fish had created and named the same three an hour earlier, uncommitted in its
own worktree, and the shared database is the one place both of us wrote. The
peer's TSV and TypeScript used its names, the database now used mine, and the
task had two ports in two trees.

Before naming anything in the shared database, **grep every live worktree's
`ghidra/annotations/*.tsv` for the address** -- a peer's uncommitted row is
there before it is anywhere else -- and read the `from` in every rename
result, which is the only report that the name replaced was not `FUN_...`.
It is `L17` pointed at a write: "I did not see a name" and "there was no
name" are different claims.

**L53 -- An arm that bumps the substate and does not return runs the next arm
in the same frame.** Class 0x11's two launch substates end `INC byte ptr
[EAX+5]` and then carry straight on into the code the jump table gives the
next substate -- `0x0043B03E` into `0x0043B044`, `0x0043B6F2` into
`0x0043B6F7` -- so the launch frame also halves the turn still owed. The port
had each arm end in `return`, which is what a `switch` in TypeScript wants and
what reading the arms one at a time suggests, and every hop turned one halving
short for as long as it existed. The tell is in the addresses: an arm whose
last instruction is not a `RET`, a `JMP` to the epilogue or a `JMP` elsewhere
falls through, and the jump table says where to. Check each arm's last
instruction against the next arm's first address before writing its `return`.

**L54 -- "The script loaded it" is not "something draws it".** Opcode 0x50 and
`asset_load_polfile` make a slot resident and nothing more; the model is on
screen only if a region lists it or some routine calls `AssetDrawSlot` on it.
The player's `StageScene` stood in for the second case with "loaded and in no
region, so drawn", which looked right for as long as the stand-in happened to
agree with the drawer -- and made stage 2's block 16 canal, loaded but listed
by other regions, simply absent, while nothing said a drawer was missing. The
drawer was class 0x41 type 1, a task no port had read. When a loaded model is
missing or wrong, search `.text` for its slot as an immediate (and as bytes,
for the ones in unfunctioned code): what draws it is whatever names it.

**L55 — A body Ghidra cut short at a call may be one flow override, and it
can be cleared.** `ActorAimHeadAtCamera` (`FUN_00453BE0`) decompiled as a
transform and a `MatrixStackPop` and nothing else, which is L35's shape --
and `MatrixStackPop` is not marked no-return: `ActorHeadAimAngles` flows past
its own pop. What cut this body was a `CALL_RETURN` flow override on the one
`CALL` instruction at `0x00453C78`, and class 0x25's twin had the same on its
pop at `0x00485C38`. `clear_instruction_flow_override` with `dry_run: true`
names it without touching anything; clearing it, disassembling the tail and
re-creating the function gave both routines their whole pseudocode -- the
stepping, the tolerance test and the three rotations the listing had been
hiding for as long as the head aim was believed not to exist. So when a
decompilation stops at a call that does return, **ask the instruction before
the function**: L35 says read past the end, and this says the end may be
movable. The override lives in the database and not in `ghidra/annotations/`,
so a rebuild can bring it back; say so in the row.

**L56 -- A value computed at module load through an import cycle is a page
that does not start, behind a green `test:port`.** `game/globals.ts` imports
`game/hud_shutter.ts` for `HudShutterTaskCreate`, and `hud_shutter.ts` imports
`G` and the `ScreenFurniture` enum back. Calls across that cycle are fine; a
top-level `const MASK = ScreenFurniture.ChapterCard | ...` is not. Which module
of a cycle evaluates first depends on which one the program enters by, and the
page enters through `app/`, so there `hud_shutter.ts` ran first, found
`ScreenFurniture` undefined and threw "reading 'ChapterCard'". `tsc` passed,
and so did `test:port`, which enters the graph elsewhere; only `loops`, a check
that loads the real page, failed -- as a timeout waiting for a button, with the
throw two lines above it. **In `game/`, derive anything that touches another
module's export inside the function that uses it**, and when a page check fails
after a merge, read its `threw:` line before its timeout.

**L57 -- A divergence parked "until something needs it" is blind if the
input that would need it is dropped upstream.** `ApplyRootMotion` turned the
root delta by yaw alone, and the note on it said that was wrong only for a
class-0x31 actor on a wall, and could wait until something needed it, "because
the clips those stances play carry no root translation". The premise was true
of the stance clips and missed the case that needed it. Stage 2 block 21's two
`zstin` are not put on the wall by a stance at all: their **spawn record**
places them there, orient `(0, 0xC000, 0xC000)`, and the exporter kept only the
yaw. With pitch and roll dropped before the port ever saw them, no run of the
port could have shown the divergence mattering. The actors stood upright a
hundred units up and walked out into the air, and it went in as "they jump
from way above the player". **When you park a divergence, name the inputs that
would make it matter, and check that every one of them reaches the port** --
here, `grep` the placements for a nonzero pitch or roll. It is `L27` and
`L34`'s "scan the shipped data" applied one step further upstream: the scan has
to cover the fields the exporter throws away, not only the ones it keeps.

**L58 -- A dispatcher has more than one caller, and "nothing plays X" was
asked of one of them.** `sound.md` carried "no stage script starts its own
track" as an open question, `bundle.ts` wrote it into every bundle's
`stage_track.note`, and the player started each stage's music at load "by
convention" to make up for it -- all from a table of every `bgm_entry_play` in
the six scripts. Every one of those names a boss or transition track. But
`se_play` hands its operand to the same `PlaySoundId`, and **the same document
said so**: its operand names nine BGM tracks. Five of them are the stage
tracks, each at step 2 of its entry block. The convention start opened the
music a step early, and because the port ignored a request for the track
already playing, the script's own start -- which in the engine reopens the file
from its first sample -- was swallowed. The same afternoon found evt `0x2E`
named `resume_bgm_if_skipped` from the word it plays, `0x80000002`, when
`PlaySoundControl` sends that word to the **voice**; the mixer had taken every
namespace-8 id as a music stop, so a cutscene skip silenced the stage. **Before
recording that nothing reaches a routine, enumerate every instruction and
every call site that can reach it, and read the routine a word is handed to
before naming the word.** It is `L17` pointed at a dispatcher: the negative was
true of the caller that was looked at.

**L59 -- The URL is the walker's address as of the last throttled write, and
a driven harness outruns the throttle.** Checking that the script stood still
under the continue screen, a harness read `block/step/op` out of
`location.search` and saw `11/2/26` become `11/2/34` during the countdown --
"the gate is broken". It was not: the walker had been at `34` since before
the player died. `syncUrlToWalker` writes through `Pacer.mayWriteUrl`, a
wall-clock throttle (the history API is rate-limited), and under `?drive=1`
hundreds of frames go by between two writes, so the URL answered for a frame
long past. **Read the walker's own address**, `__hotd2Drive.now().a`, which is
`L44`'s "print the state, never the request" with the request being the page's
own bookkeeping.

The same session had the other half of that shape in the port itself: the
gameplay gate was first transcribed as a term of each wait's condition, where
it is right for the wait -- and `G.g_evt_gameplay_live` then only moved on the
frames a wait's earlier terms let the `&&` reach it, so it sat at 1 through the
whole continue screen. The engine computes that global once, before the frame's
first instruction. **A value the engine computes once a frame is computed once
a frame**, not wherever a condition happens to evaluate it.

**L60 -- "The engine leaves it uninitialised" is a claim about the caller,
not the allocator.** Every thrown weapon in the port tumbled at a rate of its
own, eighteen times too slow for the knives, behind a divergence that said
the engine has no value to copy: nothing writes the projectile's `obj+0x135C`,
and `ActorAlloc` (`FUN_004A6FA0`) hands back its block uncleared, so the rate
is whatever the arena's previous occupant left. The allocator half was true
and beside the point -- both launchers call `ActorClearGameFields` on the very
next line -- and the other half was L35: `SpawnThrownWeapon`'s pseudocode ends
at a `MatrixStackPop` Ghidra marks no-return, and the rate (`0x2400`), the
flags, the permit hand-off and the aim are all in the listing after it. A
divergence whose justification is garbage memory should send you to the
listing past every no-return call in each writer, and to the line after the
allocation, before it is written: an engine that really read garbage there
would spin its knives differently from throw to throw, which is itself a claim
about the game that nobody had checked.

**L61 -- A loader's default is a claim about the game, and so is the sign of
an axis.** `GLTFLoader` turns `alphaMode: BLEND` into `depthWrite: false` and a
normal blend, and three.js sorts transparent primitives farthest first. The
player took both for as long as it existed, and they were three wrong claims
about this engine at once: every one of its 82,494 meshes writes depth, 5,408
of them add rather than blend, and its translucent pass orders whole models,
nearest first. What made it visible was a car whose interior -- a black shell
just inside the paint -- was drawn over the paint. The "farthest first,
painter's order" in the docs came from reading `RenderCommandCompare`
correctly (descending) and assuming the depth it compares was D3D's +z; it is
the matrix stack's, and `RenderInitStates` flips z into D3D's view with
`diag(1, 1, -1, 1)`. **When you port an order, find the matrix that defines
the axis before you say which end comes first**, and treat any default a
library supplies for state the exe sets explicitly as a divergence until it is
shown to agree.

**L62 -- A port state reads the play cursor a tick ahead of the engine's,
and a clip frozen on one cursor while its state waits for the next never
arrives.** The engine's states read `part+0x08`, which the class's draw
computes from the frame counter *before* the class steps the counter after
the draw; the port's director steps the counter before the update, so
`MotionPlayFrame` in a state is the cursor the engine's state reads on the
next frame. Mostly that is a frame early and nobody sees it. The frog's
death freezes its clip (`obj+0x34 |= 0x4000`) on the frame it reads
`len - 1` and waits to read `len`: in the engine the draw after the freeze
computes `len` off the counter already stepped, and the state reads it next
frame; in the port the freeze stopped the counter on `len - 1` and the
corpse held `g_enemies_present` for ever -- stage 1's frog room, which read
as the playthrough's failure to hit a frog. **When a state raises the freeze
on cursor N, find the cursor it then waits for**; if it is N + 1, the class
has to read the cursor its own draw left (`FrogTail.playCursor`), not the
counter.

**L63 -- A literal the engine compares against belongs to the engine's
representation, and the port need not share it.** `g_attack_permits` holds 1
or 0 in the exe and the holder's `at` or -1 in the port, a choice written down
on the global. Two scripted attackers' player picks were transcribed
instruction by instruction -- `CMP [g_attack_permits + p*4], 1` became
`=== 1` and `TEST EAX, EAX` became `=== 0` -- so neither ever saw a permit a
claim held, nor a free one: a scripted zombie took a player's permit from under
the zombie that had it and never fell back to the other player. Every test
passed, because those two routines' own writes to the table also used the
exe's `1`, so they agreed with themselves and with nobody else. **When the port
represents a value differently from the exe, transcribe the question the
comparison asks ("is it taken"), not its constant** -- and before calling any
reader of such a value faithful, grep every reader for the exe's literals.
It is a cousin of `L3`: there one field means two things in two classes, here
one table means one thing in two encodings.
