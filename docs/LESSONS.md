# Lessons — the traps this project has already paid for

**This is the only list.** Every entry here cost this project real time. Each
has a stable id so a commit message or a code comment can cite one — `L7` —
instead of restating it. **Add new ones here and nowhere else**: under the
group it belongs to, with the next unused id. Never renumber.

Read it before your first edit. The four groups bite at different moments:
reading the binary, transcribing behaviour, running the tools, and believing
what you are looking at. Each entry's evidence is what happened when the trap
was sprung; the rule in its first sentence is what holds now.

**A lesson nobody needs to heed any more** -- because a fix or a check has made
the trap impossible -- is cut to one line naming what superseded it. Its id
stays, so a citation still resolves, and the file stays short enough to read
before every change.

---

## Reading the binary

**L1 — Superseded by L89.** (The decompiler dropped x87 arguments at the calls of an unprototyped callee.)

**L2 — Superseded by L89.** (`CamEvalObjectPath6`'s three integer rotations decompiled as floats.)

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

**L35 — Superseded by L89.** (A wrong no-return flag ended bodies and xref lists at `MatrixStackPop`.)

**L37 — Superseded by L89.** (`HudDrawShutterState`'s arms lost their firing-gate writes to the same cut.)

**L38 — A dispatch table entry is settled by reading the table, and a name in
a doc comment is not a reading.** `ZombieState.Leave = 10` carried
`ActorAbortAttackAndLeave` (`FUN_0045D9F0`, since renamed `ZombieSplitInTwo`) as its citation in `states.ts` and
in `leave.ts`. `g_class30_states[10]` is `0x00455490`,
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

**L55 — Superseded by L89.** (The cut was a `CALL_RETURN` flow override on the call.)

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

**L71 -- A register read is named by the instruction that loaded the register,
not by the constant it is compared with.** `ZombieOnShot`'s dead arm is `MOV
EAX, [EBP]` / `CMP EAX, 0x2` at `0x00453F6E`, and a session annotated it "on
`g_hit_result`, read back": 2 is `HitResultCode.Plain`, and the loop reads
`g_hit_result` a few lines earlier. `EBP` had been loaded at `0x00453EEE` with
`LEA EBP, [EDI*4 + 0x9A2D88]` -- `g_shot_bone` -- and the loop keeps the result
pointer in `EBX`. So "is it the head?" was recorded as "was the result 2?",
tagged `[proved]`, written into three docs and an annotation row, and pinned by
five checks that passed because they encoded the reading rather than tested it.
`ThrowerOnShot` "agreed" because it was read the same way, at the same kind of
`[EBP]`.

Two things made it stick. It was a **correction**: `combat.md` had said `bone
== 2` since the routine was first read, and the reversal was believed because
it came later and was more emphatic. And the port could not hear the
difference: kinds 1 and 2 share a voice pair, so the only change was an
impact sample. **When a disassembly note names what a register holds, cite the
instruction that put it there** -- the `LEA` or the `MOV` -- and when a note
overturns an earlier reading, it owes the earlier one the same trace, not a
louder adjective. `web/tools/checks/combat.ts` check 15 reads the `LEA`'s
operand out of the image in both routines.

**L72 -- `ActorDespawn` really does not return.** It ends in a call to
`ActorKill` (`FUN_004A7040`), which longjmps out of the task walk whenever
the current task is an actor's (it returns only on the root task's path), so
a routine that calls `PropExpireByStepLifetime` and ignores its result
**does** stop when it despawns -- and `class41/type35.ts` had built "a retired
door runs its rattle once more before the pool drops it" on a return that
never happens. **Read the callee before believing a caller carries on.** (Its
other half, `PlaySoundId` wrongly flagged no-return, is superseded by L89.)

**L73 -- A load through initialised data comes out of the decompiler as a
literal.** `ThrowerStateRearm` (`FUN_0044F7A0`) decompiles to eight float
constants written into two hands' bone records -- `obj+0x554 = 0x3fe00000`,
`obj+0x558 = 0xbdcccccd`, and so on -- and I had them typed up as the
routine's own literals before disassembling. The instructions are
`MOV ECX,[0x004D0384]; MOV EDX,[ECX+0x60]`: a pointer in `.data`, which is
`g_character_part_tables[0x16]`, and an offset into the table it points at.
Ghidra treats an initialised word as a constant, follows it, and prints what
the table holds on disk. The numbers were right; the reading was not -- the
routine reads rows 4 and 7 of a table, the same table
`ThrowerStateRestoreBothHands` reads by the actor's type, and a port that
wrote literals would have been a second copy of that table with nothing tying
the two together. **When the pseudocode stores a float literal into a field a
table also feeds, disassemble the store** -- and if a literal matches a
table's value exactly, that is the tell, not a coincidence to note and move
past. The check that holds it now reads the instruction bytes and the table
together (`web/tools/checks/combat.ts`, check 17). It is `L1`'s family: the
decompiler presents the instruction stream as something it is not, and nothing
marks the substitution.

**L86 -- A helper that merges two inline copies is a claim that they are the
same, and it is checked one instruction at a time.** Class 0x10 resolves its
target twice, in `CivilianStepTurnToTarget` and in `CivilianStepScript`, and
the port wrote one `CivilianTargetPoint` for both: "the same three rules. One
copy, because two is how they drift." The rules were the same. The fourth
arm, for a civilian on a carrier, was in neither port -- the turn's row in
`functions.tsv` described it and the step's pseudocode stopped at its
`MatrixStackPop` (L35) -- and **the copies of that arm differ**: the turn
loads the identity before composing the carrier and the step does not, so
one gets the camera in her frame and the other a point that is in no frame
at all. The helper's own comment was the reason nobody diffed them. **Before
merging inline copies into one function, disassemble both and compare them
call for call**, arms the pseudocode hides included; where they differ, the
difference is the helper's argument, named for the instruction.


---

**L89 -- A trap every session reads around is a defect in the database, and
it is fixed once, for every caller.** L1, L2, L35, L37, L55 and half of L72
were six lessons about one database, and L86's missing arm was the same cut. Ghidra's "Non-Returning Functions -
Discovered" analyzer -- run by the GUI's incremental analysis long after the
import, which flags nothing of the kind -- decided `MatrixStackPop` and
`PlaySoundId` never return, and its "Repair Flow Damage" option wrote a
`CALL_RETURN` override on 1,085 call sites. A later session cleared
`MatrixStackPop`'s flag and none of the overrides, so 517 functions went on
decompiling short, **silently** -- an override prints as a clean `return;`
with no warning -- and 59,534 bytes of code sat outside the body they belong
to: `HudDrawShutterState`'s firing-gate writes, `RegionDrawResidentSet`'s
loop, `ActorRegisterCameraPoint`'s shot-test registration. Beside it, 2,553 of
2,735 functions still had Ghidra's placeholder `undefined f()`, so `__ftol`,
which takes its argument in ST0, printed 271 times as `__ftol()` and
`MatrixTranslate(0,0x3eb33333,0xbf800000)` hid `(0.0, 0.35, -1.0)`. Each
session learned to disassemble past the end; nobody asked why the end was
there. `ghidra/scripts/RepairFlowDamage.java` and
`ghidra/annotations/prototypes.tsv` fix both at the source, `rebuild` replays
them, and the `ghidra_db` check fails when the database drifts from
them. **When the pseudocode is wrong the same way twice, the callee is what
is wrong: give it a prototype or a flag, prove it, commit it as a row, and
every caller inherits it.** Choose rows, do not bulk-commit the decompiler's
own guesses: committing all 2,520 of them took `extraout_` markers from 184 to
880, because it guesses `void` for functions whose callers read EAX.

**L91 -- An argument is named by the instruction that finally uses it, and
that can be three calls down.** `MotionCrossFadeTo(obj+0x194, 1, clip, 0, 1,
10)` was read as "track 1, fade in 10": the routine's own body stores the
last argument at `track+0x33` and passes the second to `MotionStartOnTrack`,
and both readings stopped there. `track+0x33` is read by
`SkeletonAdvanceOverlayCursor` when the clip ends -- it is the fade **back
out** -- and the `1` goes on through `MotionStartOnTrack` into
`SkeletonAssignSubtreeTrack` as a **bone**: the track drives bone 1's subtree,
the upper body, and nothing else. The port blended the whole skeleton, root
height included, onto a standing flinch, and every crawler in stage 2 stood up
when it was shot. The annotation on the subtree routine had carried `[likely]`
with its recursive helper "unread" the whole time, and the doc said "track 1
while the walk keeps running on track 0" -- true, and the reason nobody asked
which bones.

**Follow each argument of a primitive to the instruction that consumes it**,
through every callee it is passed to, before naming it; a store into a
structure is not a use until something reads that field back. And a
`[likely]` on a routine a renderer depends on is an unread routine the
renderer is guessing about.

**L98 -- An exhaustive search of the image is an exhaustive search of the
image; the scripts are the other half of the program.** Slot `0x10AE`
(`st1_1.bin[2]`) was classified as drawn by nothing found: no instruction
names it, and the only other copy of the word in `Hod2.exe` is its pol file's
slot list. Both true. L39 says to ask what computes a slot, and names "a
descriptor tail word" among the answers -- but the search that ruled that out
was run over the image, and descriptor tails live in `evt/`. A byte search of
the eleven `evt/*.bin` files found the word five times more than the `0x50`
and `0x51` operands account for, each at `desc+0x28` of a class-0x44 spawn
with selector 14: tail `+0x04`, the slot `PropBuildDrawOnlySelector14`
(`FUN_004736D0`) copies to `obj+0x28C`. The selector had no builder in the
port, so its twelve spawns -- four other models besides -- had never existed
(`L83`). **When a slot, a motion or a flag has no reader in the image, search
every `evt/` table for it before calling it unread**, and subtract the
occurrences the opcodes explain: what is left is a descriptor, and the
descriptor's class says who reads it.

**L101 -- A character type is its nodes' slots, and a slot names its own
file.** The exporter asked for *the* pol file of a character type
(`ExeTables.characterAssetFile`), which answers only when every node's slot
names the same one, and the rig builder indexed each node's slot into that
file's models. Character type `0x4B`, the stage-5 boss, has fifteen nodes
over **two** files -- eleven in `boss5.bin`, four in `boss5b.bin` -- so it had
no file, its spawn resolved to nothing and the boss was never in any bundle;
and had it been given the first file, four nodes would have been built from
whatever that file held at their indices. `AssetDrawSlot` resolves each slot
through the slot table on its own, and so must anything that builds what it
draws (`ExeTables.characterAssetFiles`, `charbuild.rigEntry`). **Resolve a
model by its slot, never by the file its neighbour came from.**

**L102 -- An absolute address can be an element of an array named somewhere
else; check the ranges before naming it.** `Class2DState5`'s kill arm writes
`0x009C90D8` and `0x009C9F55` as bare operands, and the first reading named
them `g_original_boss6_kills` and `g_profile_original_boss6_kills` -- two new
globals, with a port field each. They are entry 24 of
`g_original_items_taken` (`0x009C90C0`, 33 bytes) and of
`g_profile_original_items` (`0x009C9F3D`), which the item pickups, the save
and the profile copy already read and write as arrays: the port would have
kept the boss's kill count where nothing that saves the tally could see it.
The same mistake was already in the port the other way round --
`ProfileFactoryReset`'s `0x009C9F40`, `44` and `4D` had been read as "three
bytes set to 1" when they are items 3, 7 and 16 of the array it had just
zeroed, and the port zeroed them. **Before giving an absolute operand a name
of its own, look for a named table whose extent covers it** (the TSVs are
sorted by address, so the row above says), and write the element.

**L103 -- A store through a block's base is a DATA reference, not a WRITE; a
list of writers built from WRITE xrefs is a list of some writers.** Original
Mode's per-player block (`0x009A2240`, stride `0x14`) is written as
`(&field)[p * 0x14]`: the field's address is the displacement of an indexed
store, and Ghidra types that reference DATA. A note in `class22/shot.ts`
counted "exactly three writers" of the damage scale from the WRITE xrefs,
found all three storing 1.0, and made the scale a constant -- so JUDGMENT
ignored every item for as long as the note stood, while `OriginalItemsApply`
wrote the scale at `0x0041602A`, `39` and `55`, all DATA. The same search had
the sound kind "written by no instruction". **Before recording who writes a
field, take every reference to it, DATA included, and read each
instruction.**

**LXX -- An update routine runs for every `ActorAlloc` handed its address,
not for the table that names it.** `PropDrawOnlyType31` (`FUN_0046A1C0`)'s
scene-2 block-11 strip was written up `[proved]` unreachable: every class-0x41
type-31 spawn in stage 3 is placed in block 4, which never routes to 11. True
of `g_class41_updates[31]`, and beside the point -- class 0x44 selector 10's
`PropBuildSlotStripLoop` (`FUN_00473370`) does `PUSH 0x46A1C0` into
`ActorAlloc` too, and all five of its stage-3 spawns are placed in block 11.
The same shape hid which routine selector 5's hinge runs: its update allocates
the object inline, and the shot-test table called it `[open]` until the
`PUSH 0x473CF0` was read. **Before saying who reaches an arm, search the
image for the routine's address as an immediate** (`68 <addr>`), and follow
every allocation that pushes it.


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
and release on every path out. (This used to end "`ActorAbortAttackAndLeave`
exists for that"; that routine is `ZombieSplitInTwo`, which cuts an actor in
two, and nothing the shipped game runs calls it -- `L38`, `L92`.)

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

**L21 -- Anything you copy has moved by the time you finish copying it.**
`web/src/hod2lib/` was written against `tools/hod2lib/` over one long session,
and a concurrent workstream committed a new character-type rule to
`spawnres.py` in the middle of it. The port reproduced the version that had
been read, exactly and wrongly: stage 2 came out with 291 placements against
the reference's 292, and nothing but the output comparison could have said so.
Re-diff the source against `HEAD` before you call a transcription finished --
`git diff <the commit you started from>..HEAD -- <the source>` -- and make the
check that compares the two outputs, not the two texts.

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

**L41 — A marker something counts is not a word you may also use in prose.**
Consolidating `ActorPlayHitVoice` into one copy closed a real open question in
`combat/feedback.ts` — the bursting head had been silent because the voice
tables were on the other side of the layer line — and the status report's
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

**L64 -- A word the port "keeps instead" is a divergence at every reader, and
the question it rests on is usually one read away.** `g_camera_block_yaw_bams`
(`0x009A60D0`) and `g_camera_yaw_bams` (`0x009C71F0`) are two camera yaws, and
for as long as the port had only the second, each routine the exe points at
the first was transcribed onto the second with a note: "the port keeps one
heading, and reads it for this as `PropUpdateType43` and the bat do; whether
the two ever differ is the `[open]` on that row of `globals.tsv`". Four notes
cited each other and a helper was written to return it. They differ by half a
turn: the scene state's hooks write the second as a camera heading plus or
minus `0x8000`, which is in the five instructions of each hook. So a
condition-8 walker's facing window sat behind it and no blade or axe walker in
the game ever threw, severed heads and owl corpses flew at the camera, and
deaths fell the wrong way -- one substitution, wrong at every reader. **When a
routine reads a word the port does not have, the substitute is the
divergence, not the missing word**: tag it `[diverges]`, and settle the
`[open]` by reading the substitute's writers before a second reader copies the
choice. `L20`'s "never name a thing from what it resembles" applies to globals
that resemble each other.

**L67 -- A bit's name is its hardware's meaning, and the port decides what it
does.** TSP bit 19 is `IgnoreTexAlpha` in the PowerVR2 documentation, and the
exporter did what the name says: an alpha-stripped copy of every texture a
mesh with the bit drew. The PC port is a Direct3D translation of those words,
and in it the bit is only half of the pass selector -- the texture is
uploaded once, alpha and all, and stage 0's alpha op takes it. 101 meshes
that blend by their texture's alpha drew as solid cards for as long as the
export existed, and the blood recolour quietly came to depend on the stripped
images. **Before implementing a field by its spec name, find the instruction
that reads it in this binary**; a search for its mask and its bit number that
comes back with only the readers you know is the evidence, and "the spec
says" is not.

**L68 -- A cache keyed on less than it stores hands one entry's value to the
next.** The exporter deduplicated materials on the part, the texture and the
four PVR2 words, and wrote the base colour and the culling into what it
cached. A fifth of the game's meshes drew with an earlier mesh's colour --
baked lighting, base alpha -- and the stage-2 car's door took the black of
the body's inner shells, which a session then spent time taking for a
draw-order fault. Nothing looked wrong locally: every material was a real
material of that part. **A dedup key must cover every field the cached value
carries**; the check that finds the gap compares each output against its own
input, not the output against itself.

**L70 -- A list with two readers cannot be gated for one of them.**
`RegisterForShotTest` appends to one list, and the engine reads it twice: the
shot pick, and -- copied a frame later by `ColiPublishDynamicList` -- the crowd
push, `ColiTestSphereAgainstActors`. The port migrates the pick a class at a
time, and put the migration's gate on the *writer*: `ActorRegisterCameraPoint`
filed an actor only if its class had moved across. That starved the second
reader of every zombie, thrower, civilian and frog, and nothing showed it,
because the crowd push had been given a substitute -- it walked the pool,
re-deriving every sphere, under a comment that the pool "is the same set". It
is not the same set (the list holds only what registered, in front of the eye,
without `0x8000`) and not the same time (the list is last frame's spheres, as
each class left them). Two notes elsewhere then built on the gap: the frog got
`ownsSphereCentre` to stop the substitute overwriting its published point, and
`backoff.ts`'s note that the whole hook was unported -- written half an hour
before it was ported -- outlived the port by four weeks. **When a port stands something in for a structure the exe shares
between two routines, find every reader of the structure before gating any
writer of it**, and put a migration's boundary at the reader it is migrating.
The same session tripped `L56` with its own hands: a new `import` from
`coli.ts` into `thrown_weapon.ts` put a top-level `ActorFlag.Hit` inside
`actor.ts`'s cycle, `tsc` and `test:port` passed, and the page threw at
startup -- found only because the next driven playthrough measured nothing.

**L74 -- A proved fact about what a routine writes is not a proved fact about
what the frame shows; the draw is a reader, and it reads through an index.**
The boss-name banner writes camera block 0's eye and look-at and no angle, and
the view is built from angles: both `[proved]`, and the port concluded the
banner's flight "keeps the heading it found". The camera had turned in the
port before the view became angle-built, and a player reported it had
stopped. What the argument skipped was the reader -- *which* block
`UpdateSceneViewAndLight` leaves on the matrix stack -- and that is
`g_camera_index`, which the port had pinned at 0 with "every shipped write is
0 -- the only block the port has" and then collapsed the four blocks into
one on the strength of it. Scene state (1, 3)'s installer writes it **2**,
with `MOV dword ptr [0x009c6f00], 0x2`: a store of an immediate, which the
register-form writes the author found do not include (L32's shape), and
which `functions.tsv`'s row for `CameraInstallViewAngles` had recorded as
`[proved]` the whole time. Block 2 is block 0's eye aimed at block 0's
look-at, so every cutscene is drawn by look-at after all. **Before collapsing
an indexed structure because its index "is always N", enumerate the index's
writers by byte pattern in every `MOV` form and grep the annotations for the
index's address** -- and when a proof about a writer ends in a claim about the
picture, follow the value to the instruction that draws it.

**L79 -- A fix that splits one engine word into two port fields has to find
every writer of the word, not every reader.** `obj+0x1398`, the captor
script's cursor, is a **pointer**, and d82271fb fixed a hang by carrying the
blob it points into beside the index -- `aimCursor(obj, blob, pc)` -- and by
making every *reader* use it. It changed the writers it was reading beside,
and left two it was not: states 40 and 41 each store `blob + 0x10` in their
subs 0/1, and the port went on writing the index alone. So stage 1's bin
captor walked past its point and handed state 35 a cursor that still named
the burst it had just finished, replayed it, and bounced between the two for
the rest of the stage. Nothing failed: the readers were right and the tests
were about the readers. **When a port's representation stops being the
engine's one word, sweep the image for every store to that offset** (`search
_instructions` with the operand, and the byte pattern -- L32) and make each
store write every field. It is L63's cousin: there a port encoding leaked
into a reader's constant; here it silently kept a writer's old meaning.

**L81 -- A caller that converts the exe's value before handing it to a port
primitive is the primitive's divergence, documented in the wrong place.**
`ActorSetMotionBlended` (`FUN_004119A0`) writes its start into the play
cursor as it stands; the port's took an authored frame and doubled it. Six
callers were fixed against that, one at a time: the frog, class 0x21, class
0x25 and Strength's arena halved the exe's word on the way in, and class 0x10
and the thrower called with 0 and wrote the cursor afterwards -- each with a
comment saying the port's primitive takes an authored frame. Every caller
that passed the exe's word unconverted stayed wrong, and they were the ones
nobody was looking at: every class-0x30 script start, every `rand() % n`
spread, class 0x23's table words. Stage 1's bin captor began its burst past
its own flag cue. **When a fix has to convert an argument for a port routine,
fix the routine and sweep its callers instead** -- enumerate every call site
in the image (a byte scan for the `E8`, not the xref list: L35) and walk each
argument `PUSH` back to its source, and grep the port for the compensations
(`/ 2` at the call, a write straight after it) so they come out in the same
commit. A comment that explains a workaround at a call site is the tell.

**L83 -- A class with no module is in no list of what is unported.** Stage
1's bin scene was missing the boards the captor bursts through. The agent
that fixed the scene's captor listed what the step placed and the port did
not build, and named class 0x41's constructor 66 -- a type in a class that
*has* a module, whose `g_class41_constructors` gap every class-0x41 audit
enumerates. The boards were `0x3D88`, **class 0x12**: no `SpawnClass` member,
no handler, no placement, so `SpawnSlotActor` built nothing and nothing
anywhere reported an unported type, because every "unported" list in the tree
is a list of arms inside a class somebody had already opened. Constructor 66
turned out to place `komono_kanban.bin` models (signs, `[likely]` from the
file name) 340 units and more from the bin. **When something the
game draws is missing, list every spawn record in that step by class id and
ask of each whether the pool holds an object for it** -- `G.g_object_list`
against the step's spawn ops -- before reading any class's sub-types; a
class id with no handler is the one gap no sub-type audit can see.

**L84 -- A three.js node's `position` is applied outside its rotation; a
`MatrixTranslate` after the turns on the engine's stack is inside them.**
`CivilianDrawHeldItems` pushes `RotX RotZ RotY T(set) Scale`, and every call
post-multiplies, so the item's origin is `Rx Rz Ry t` in the bone's frame. The
renderer wrote `position = t` and an Euler in the right order, which three.js
composes as `T R S` -- the orientation was right and the point was not, and a
hand prop "nearly right" hid it for as long as it was drawn: the extra life
sat 2.2 units from where the exe puts it. **When a draw has a translate after
a turn, build the local matrix with `game/matrix.ts`'s routines in call order
and hand the node the matrix**, rather than decomposing it into three.js's
fields by eye; and test the node's frame in its parent's, at a non-zero
offset under a non-trivial turn, against numbers worked from the record.

**L85 -- A class-0x10 wait word is loaded only by the block the step parks
on.** `CivilianStepScript`'s loop walks past every block whose conditions
already fail to hold, re-applying only their condition ops, and
`CivilianRunScript` loads the word of the block it lands on. A fixture that
copies a shipped word whose conditions pass at once -- `0x940100`'s `0x100`
with no clip playing -- never has its word loaded, and a test of anything the
word triggers (the held item's give) sees nothing happen. **Give a hand-written
fixture's block a condition that holds, or drop the one that cannot**, and
check the word arrived (`sub.wait`) before asserting what it does.

**L87 -- A class that counts nothing in its `Init` can count through what its
first update makes, and a count held before the room has anyone in it
belongs to the seek.** Item 32 recorded that class 0x22 "counts after its
entrance, not in its `Init`, so a gate stepped over between its spawn and its
entrance says nothing about it". Of the flier alone that is true. But the
flier's first update spawns the walker, class 0x23, and the walker counts in
*its* `Init`, so every gate after the spawn is held from that frame. A reload
past stage 5's JUDGMENT then rebuilt the pair, and block 4's room stayed shut
on a `1` with its five zombies dead. The session that reported it spent its
reading on the room, the Kill button and the class-0x41 props that count.
The page had said something else from the first frame after the landing: `e1`,
250 frames before the room spawned anyone. **Before reading why a room will
not open, read the counters on the landing frame.** A nonzero count there is
something the replay rebuilt, and `G.g_object_list` names it. And when a
note says a class's gate "says nothing" about it, follow each thing the class
spawns into its own `Init` before believing it (L83's list-every-spawn, one
level down).

**L92 -- A proof about a routine is not a proof about the actor until the edge
into it has been checked against the data.** The crawlers were closed as "in
the engine an undamaged crawler swings and misses, every time", from a reading
of `ZombieStateStrike` that was right in every step: their condition-4 attack
has hit frame 40, clip 997 plays for 20, the test is an exact equality, so the
strike can never fire. A minute-long assertion of zero damage was written to
hold it. **No crawler runs that state.** `ZombieStateHoldAtRange` hands a
successful claim to one of two states, and the choice is one `CMP` on the body
condition at `0x0045585E`: condition 4 goes to state 0x34,
`ZombieStateLeapStrike`, which lands the same entry through
`ActorStrikeConnect` on touching down and reads no hit frame at all. Every
`znkager` is condition 4.

The comment that should have stopped it was sitting at the branch: "body
condition 4 goes to state 0x34 instead; that state is unread, and no stage-2
spawn carries condition 4 into this state." The first half was true and the
second was a claim about the data nobody had counted -- all twenty `znkager`
carry it, from their descriptors. It is `L34`'s shape from the caller's side:
that lesson collapsed a branch because its outcome looked predetermined, this
one ignored a branch because its data looked absent. The same week, the
routine at `0x0045D9F0` was described in two files as one that "assigns no
state", from its three call instructions; its second callee writes state
0x32. Reading the calls of a routine is not reading the routine.

So: before a proof about a state becomes a claim about an actor, **find every
write of that actor's state number, and count the spawns that take each arm of
the branch that chooses it.** Search the image for the state's literal store
-- the bytes `10 13 00 00 xx 00` of `MOV word [reg + 0x1310], xx` -- and read
the `CMP` in front of each one; `web/tools/checks/split_unreachable.ts` does it
for 0x32, 0x34 and 0x35. A one-line census of the field the branch tests would
have turned "no stage-2 spawn" into "twenty".

**L95 -- A faithful transcription beside an approximate one of the same
routine means the approximation is the port's, not the engine's.**
`game/skeleton.ts` has carried `SkeletonAdvancePlayCursor` and
`SkeletonApplyRootMotion` instruction for instruction since class 0x14 needed
the engine's model block: an odd play cursor posed between two authored
frames at one half, the wrap damped by `(baseline - root) / play_length`.
Every other actor's root motion went through `game/motion.ts`, which rounded
the cursor down to a whole frame, so a 30 Hz clip moved its actor a whole
frame on every other tick and not at all on the rest, and a loop's wrap took
no step. Nobody compared the two, because the faithful one was "only class
0x14's". **When a routine is ported twice -- once in full for one caller,
once in brief for everyone else -- diff the two on the same input before
trusting the brief one**; the full one is usually the reading, and the brief
one the shortcut nobody wrote down. It is `L86` from the other side: there two
inline copies were merged without comparing them, here two ports of one
routine were kept apart without comparing them.

**L99 -- A bit a state writes and never reads is read by whatever interrupts
the state, and the state's own tests never interrupt it.**
`ThrowerStateGrabPlayer` was ported down to its sounds and its camera ride,
and its four writes to `obj+0x34` -- `0x4100` at spawn, `0x4000` off on the
cue, `0x2000` on landing, `0x100` toggled through the hold -- were left out,
because nothing in the state tests them. `ThrowerOnShot` does, before the
state runs: `0x100` refuses the shot and `0x2000` the reaction. Without them
stage 5's riders took a shot as a `zslman`'s tumble, whose way out is the hub,
and a hub on a moving car never ends -- the car stopped on the bridge behind
`wait_enemies_alive`. Every existing test of the state played it unshot, so
all of them passed. The pseudocode showed the writes plainly; they read as
bookkeeping. **When you transcribe a state, every store to a flag word is
behaviour: find the reader of each bit** (a `TEST` of its mask, L32's two
forms) **before leaving one out, and test the state with the thing that reads
it happening** -- here a shot on every sub.

**L100 -- The one-shot channel ends itself; the engine's track wraps. A clip a
state holds longer than its play length belongs on the base track.** The
engine has one motion track, and `ActorSetMotionBlended` puts every clip on it;
`obj.action`, the port's one-shot channel, is a port construct that empties
when its clip's authored frames run out and hands the body back to whatever
the base track holds. Two fixes of `ThrowerStateGrabPlayer` were written in
parallel, one moving its clips onto the one-shot channel and one onto the base
track, and both passed their tests -- because neither test looked at the clip
past the ride clip's end. The shipped holds are 45 and 75 frames and
`zslman`'s ride clip `0x1E9` has a play length of 39: on the one-shot channel
the rider dropped back into its spawn clip for the rest of the long hold. The
same shape as `L94`'s stumble, from the other end: there the channel held a
clip too long, here it lets one go too soon. **Before putting a clip on the
one-shot channel, find what ends it in the exe -- a state change, or nothing,
in which case the track wraps -- and test for as long as the shipped data
holds it.**

**L104 -- An `Init` runs where the walk reaches its object, not where the
opcode that made it ran.** `SpawnFromDescriptor` (`FUN_00408A20`) is
`ActorAlloc(g_class_handlers[class])` and a copy of the descriptor: the
handler it stores at `obj+0x00` *is* the `Init`, and `TaskRunTree` calls it
when the walk gets there -- for a script's spawn, the tail of the scene list,
after the camera actor and the scene state's hook. The port ran every `Init`
inside the script phase, before those tasks, and the note beside the call
even said "exactly as `SpawnFromDescriptor`'s does". Nothing showed until a
spawn landed in the frame the script handed the camera from one path to
another: stage 2's canal zombies (block 16 step 7) seeded their heads at the
cut-scene's eye, 34 up and to one side, and turned them round at `0xC0` a
frame for two and a half seconds -- a head 140 degrees off its body, reported
as "facing the wrong way", in a head aim that had been transcribed
instruction for instruction. The same order put every slot actor's
`visible`, and the mouse's and class 0x33's `pos`, on *after* their `Init`s. **When an `Init` reads a global,
find which task writes it and whether that task runs before or after the
object's first call**, and a test of what an `Init` does is a test of the
frame, not of the spawn.

**L105 -- An action the port only retires is behaviour it does not have.**
"The player isn't rendered in the car at the start of stage 1, maybe render
order" sent the reading to the stage-1 vehicle's rig, whose two seat-height
parts were noted "[likely] an occupant" -- from their shape and where they
sit. They are the car's doors: 52 vertices each, swung about Y only once the
car is parked, the passenger's only with two players. The occupant is the
player's own body, which no rig draws: stage 1's `queue_event` with selector
0x12 (`EvtActionSetUpdateRoutine12`) installs a `+0x80` player hook that seats
it on the car's route every frame and raises the flag `PlayerHookDrawBody`
draws by. The port dispatched selectors 0x10 and 0x12 to one handler that
retired the action, under a comment saying the body "is not drawn" -- true of
the port, and so the reason the bug existed rather than a fact about the game.
**When the script queues an action, a selector or an opcode the port handles
by retiring it, read the exe's handler before believing it does nothing**;
and a part named for what it looks like is a guess about what draws the rest.

**L106 -- A program turned into a list keeps its edges and can lose its
start.** The exporter turns each class-0x25 program into an address-sorted
command list with its jumps as indices, so that "the next command" stays
`pc + 1`. The port then started every program at index 0, and for 13 of the
137 that is not where it starts: a player-2 figure whose `op 15` jumps back
into player 1's commands, stored before its own block, lists those first. So
the figure ran player 1's tail, never reached the `op 10` that should have
removed it, and both player characters stood in the same spot. The `op 10`
fix before it (B21) was right and was tested at index 0 only. **When code
becomes data with its addresses replaced, carry the entry point as data too**,
and test a program whose entry is not its first element.

**L107 -- A join key that reaches the bundle by two routes is lost when one
route moves.** The Arcade bullet, sprite `0xA74`, came into every bundle as
row 0 of the Original Mode ammo table, which `HUD_READOUT_SPRITES` spread in.
When that table moved to `.rdata` read only for Original stages, the row went
with it, and every Arcade stage shipped no bullet for a week: the readout drew
an id with no image, which the HUD skips without a word, and Original Mode --
where the row still arrived -- looked fine. **When a list of what to export
is split, check every id each reader can draw is still in every bundle that
reader runs in** (`tools/checks/original_mode.ts` now does, per stage), not
just the bundle the change was about.

**L108 -- When the exe's arithmetic is on framebuffer bytes, do it on bytes;
converting its inputs into three.js's light model fixes only the inputs
someone thought to convert.** The fog and the scene light were each "fixed"
by putting the engine's numbers through sRGB->linear so three.js's linear
pipeline would land near the device's byte sum. The fog came out right. The
light kept three other faults the conversion could not see: three.js's
`BRDF_Lambert` divides by pi, so the light and ambient were drawn at a third of
their strength (`render/gunlights.ts` had already found that and fed its own
lights in times pi); `GLTFLoader` adopts glTF's `baseColorFactor` as linear,
so the baked shading of a fifth of the meshes was washed out; and D3D7 sums
the light per vertex and clamps it, with a material ambient and a highlight
three.js's Lambert does not have. **Write the device's equation in the shader,
on the bytes -- encode the texel, compute, decode -- and hand it the engine's
numbers unconverted.** Each of `D3DMATERIAL7`'s terms is then one uniform with
one exe address behind it, and there is no model left to disagree with.

**L110 -- A material that lives in a hook is lost by every clone, and the
clone fails silently.** `Material.clone` copies a material's properties and
neither its `onBeforeCompile` nor its `customProgramCacheKey`, and the
scene light's twins (`render/lighting.ts`) keep the whole device equation in
those two. Five layers clone a mesh's material to change it -- the canal
water's bilinear filter, class 0x41 type 3's alpha, the warehouse water, the
rain, the dome -- and the water layer's first clone happened after the swap
had put the twin on: a stock Lambert, in a scene with no three.js lights,
drew stage 3's canal black from the change that moved the light into the
hook until a player reported it. **When state moves into a hook, find every
`clone()` of the materials that carry it** (`rg '\.clone\(\)' src/render`);
here each one now clones `unlitMaterial(worn)`, and the swap twins the copy.
`render/draw_order.ts`'s `fadedCopy` is the other answer, copying the two
across, and was already right. **Chaining is the same trap from the other
side**: `render/gunlights.ts` built its own twin over the scene twin and called
the scene twin's hook first, which had already stripped the chunk the gun
light's patch rewrites -- the torch and its shadows drew nothing until a player
reported it. A layer that builds its own twin builds it from
`unlitMaterial(worn)` too.

**L109 -- A transpose standing in for an inverse is a claim that nothing
scales, and it holds only for the callers it was written for.** `coli.ts`
took a world point into an object's space as `R^T (p - t)`, under a comment
saying the matrix is rigid -- true of every shipped object it had, class
0x12's door, class 0x15's planks and stage 3's boat (class 0x12 can scale,
and none of its doors with a blob does). The engine inverts `obj+0x150` with
`MatrixInvert` (`FUN_004A8D20`), the general cofactor inverse, and the first
prop shot through its mesh, the story-mode switch, draws with
`MatrixScale(obj+0x1A8..)` before its `MatrixStore`: stage 2's keyed doors at
(0.8878, 0.8197, 1) and (0.77, 0.7154, 1). Through the transpose a shot
squarely on one of those doors came back 1.25 units off the face, and the
test that pinned it was a hit point checked against the door's own scaled
matrix, at a scale that is not one (`L48`'s rule with the scale in place of
the turn). **When a port routine replaces the engine's general primitive with
a cheaper special case, the special case is a divergence whose inputs must be
named** -- here, every `MatrixScale` before a `MatrixStore(obj+0x150)` -- and
a new caller is the moment to check them, not the moment to inherit them.

**L112 -- Three angles are a pose only together with their order, and a
routine that copies a triple between two orders converts it or is wrong.**
Class 0x25 copies an object path's `rx, ry, rz` onto the actor, and the draw
turns the body `RotX; RotZ; RotY` while the path means `RotZ; RotY; RotX`.
`op_st3` 340 is `(~0x3C00, -0x4000, -0x4000)`: an upright boat in its own
order, a body on its side in the draw's. The port's note read the `rot_x` as
the deck's pitch ("the riders pitch with the deck they stand on"), and stage
3's passengers lay through the hull until the path's angles fell near zero at
frame 1020, where every order agrees, and appeared to roll in. The tail had
the conversion all along -- `MatrixRotateZ; RotateY; RotateX` then
`MatrixToEulerBams` at `0x00484C32` -- behind the offset record's yaw test,
and the port had transcribed the add after it without the call before it.
**A large angle in a triple is not a tilt until you know the order it is
in**, and a test of a copied triple has to be at angles where the orders
disagree (two non-zero), which `L48` says of identity inputs.

---

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
`npm run verify` counts skips separately from passes. Four regression
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
and 412 named functions before anyone noticed. Countable facts are printed
by `npm run status`, which measures them from the tree; nothing else quotes
them.

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
it failed.** `web/tools/props43.mjs` was written as
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
`web/tools/cam_cues.mjs` does. Silence from one that does not is not evidence about
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

**L69 -- Under `?drive=1`, `advance(0)` redraws the picture the last tick
posed, not the state you just wrote.** Measuring how opaque the damage overlay
is, I shot a driven frame, lowered the record's `active` through `G`, called
`advance(0)` to redraw, and shot again: the two images were byte-identical,
the harness reported the overlay covering **0 pixels**, and its own sanity
check -- "the redraw reproduces the frame" -- passed, because nothing had been
redrawn from the new state. The render layers pose their nodes in
`world.update`, which runs inside `stepOneFrame` (and, undriven, in
`idleTick`); under the drive flag a zero-frame pump calls neither, so
`endFrame` renders the scene graph exactly as the last tick left it. A `G`
edit between two driven frames reaches no picture until the next frame runs.
**To compare one frame with and without something, run twice on one seed and
make the change before the frame is stepped**, choosing a change nothing in
the game reads back (here the record's kind, pointed past the slot table), and
check that the pixels it should not touch are identical -- which is also what
tells you the runs stayed in step. It is `L44`'s "a harness that prints its
arguments as its result" one layer down: a redraw that repeats the frame
agrees with any claim about it.

**L76 -- A fuzzer whose generator cannot make the real data's shape proves
nothing about it.** Netplay's codec (`core/net/codec.ts`) passed ninety
thousand fuzzed checks while the one array it was designed around -- the actor
pool, diffed by identity so a filtered list does not re-send every actor after
the gap -- was never treated as a pool at all. The port numbers the actors it
makes itself below zero (`at` -4545), `poolAts` refused negative `at`s, and
the fuzzer only ever minted positive ones. Nothing failed: indexed diffing is
correct, merely slow and blind to identity, so every equality and every hash
still agreed. A measurement on a real stage found it -- `g_object_list` was a
pool on 22 of 2,400 ticks. **Run a generator's assumptions past the real data
before trusting what it generated, and measure the property the design is
for** (here: which arrays are pools), not only the one the test asserts.

**L77 -- Playwright's `browser.newPage()` is a new browser context.** Two
pages opened that way share nothing -- not a `BroadcastChannel`, not
`localStorage`, not a cookie -- exactly as two browser profiles would not. The
first two-tab netplay run (`web/tools/net_pair.mjs`) paired with nobody and
reported every figure at zero, which read as a transport that did not work.
Pages that must see each other take one `browser.newContext()` and call
`context.newPage()` twice.

**L104 -- A driven page's wall time is its vsyncs, and the installed Chrome
takes five seconds to leave.** `tools/boss5_page.mjs` took 56 s alone and
572 s in a loaded verify for an 8,000-frame fight the page simulates in about
four: it booked two frames per `advance` and read the state back after each,
2,523 rAFs, and a driven rAF is a vsync the page cannot hurry
(`--disable-frame-rate-limit` and `--disable-gpu-vsync` change nothing
headless). Booking the whole run with a stop condition (`advance(n, until)`,
`app/harness.ts`) and stopping only where the driver has to act -- a pull, or
a thing first drawn, read back after its render -- made it 66 stops and 4 s,
and the per-frame watcher sees more than the sampling did. Separately,
`Browser.close` on the installed Chrome returns after 5.2 to 5.4 s even for a
blank page, so every browser check paid that on the way out;
`closeBrowser` (`tools/lib/player.mjs`) gives it half a second and lets
`process.exit` kill the rest. **Count a harness's round trips and vsyncs, and
time its teardown, before blaming the machine.**

---

**L90 -- A merge that lets one side win is only as good as the writer that
keeps that side current.** `ExportAnnotations` let the database win on a
function's comment whenever it had one, and `ApplyAnnotations` wrote a comment
only when it first named a function. So a comment improved with
`tools/annotate.py` never reached the database, and the next export put the
database's copy back over it: 19 rows in one run, `RegisterForShotTest`'s 1,415
characters replaced by the 455 it had in August, reported as a clean
"19 updated". Each rule was reasonable alone; together they made the older
copy the authority. Comments are now the file's in both scripts, names stay
the database's, and an export prints every rename it takes and lists every
comment it disagrees on rather than settling it. The same run showed the other
direction is no safer to assume: the 20 names and 2 renames the database had
"never exported" were committed, with comments, on three branches that never
reached main, and `CameraTrackEnemiesTick`'s longer database comment called a
byte "written nowhere in the image" that `CameraResetForPathShot` writes at
`0x0040322D`. **Before trusting a sync rule, ask who writes each side and
when. The longer copy is not necessarily the newer one, and a name nobody
exported may be one nobody merged.**

**L111 -- A seek that misses must stop where it can prove the miss, and a
second replay is not a seek.** `?stage=1&block=2&step=0` opened stage 2: the
engine enters a routed block at step 1 and never runs step 0 in Arcade or
Original play, so the replay looked for 2/0/0 to the end of the scene, returned
`false` with the walker `finished`, and the first frame of play loaded the next
stage. `L44`'s "silent and total" again, from a well-formed address. The first
fix replayed a second time to the block's entry from inside `seekTo` -- on the
`G` the first pass had left, flags and route history from the rest of the stage
included, because `Walker.reset` clears none of it. **A seek's precondition is
the caller's whole reset, so a re-seek goes back through the caller.**

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

**L65 -- A count a check was calibrated on is a reading, and it can be the
bug.** The combat check's check 16 asserted that exactly nine arc-script
stage changes switch clips, and its docstring named two of them: "zslman's
aside in stances 1 and 3". Those two were not leap-aside scripts at all. The
exporter read `zslman`'s four at `0x30` apart -- one script's width -- where
`ThrowerStateLeapAside` names them `0x60` apart with four `MOV ESI, imm32`,
and the extra `0x30` between each pair is that stance's *pounce* script,
which ends on a different clip. The check was written by counting what the
export produced, so it passed the misread and would have failed the fix. The
comment beside the address said "+0x60 a stance"; the code beside it said
`0x30`; the annotation said "stride 0x30" and listed four motions that sit
`0x60` apart. **When a check's expected number was measured rather than
derived, say what it was measured from, and prefer asserting the thing the
engine names** -- here the immediates in `.text` -- to asserting a total
that includes whatever the reader got wrong. It is `L6` seen from the
checker's side: the adjacent-array trap, calibrated into the test.

**L66 -- In the frustum is not on screen, and a diff of the whole page is a
diff of its clock.** Showing stage 2's four tilted class-0x13 props before and
after, a harness chose "the nearest frame with all four in view" by projecting
their origins through the camera, and chose a frame where all four were inside
a window jamb: the before and after crops came back byte for byte the same,
which reads as "the renderer ignores the fix". Widening the comparison to the
whole screenshot then called every frame different, because the page's header
prints the bundle's age in minutes. Neither result was about the props. **A
projection cannot see occlusion, so pick the frame by the pixels: shoot before
and after, diff them inside the viewport only, and look where they differ** --
and when nothing differs, make the object impossible to miss (scale it up in
the live page through `G`, debug only) before concluding it is not drawn. It is
`L19` from the other side: the render is not the game, and the frustum is not
the render.

**L75 -- A bug that only shows from a deep link is a bug the user plays into,
because every source change reloads the page onto its own URL.** Stage 2's
civilian after the burnt-out car was reported sobbing in front of her dead
captors, and played from the stage's entry she never did: driven runs killed
her captors early, mid-maul and after she had died, and every one released
her. From the address the page writes into its URL she hung every time --
the replay had rebuilt the class-0x21 rescue target, whose ways out all come
before any room gate, and it held `g_enemies_alive` with nothing on screen. The
same session's sweep harness then died with *"Execution context was
destroyed"* the moment a file under `web/src/` was saved: Vite reloads the
page on a change to a module nothing hot-accepts, and the page reloads to the
URL it last wrote, which is a seek. With a coordinator merging into the
checkout the user plays in every few minutes, **a seek is the ordinary way into
a stage mid-session**, not a debug path. So a report that does not reproduce
from the entry block is not a report that does not reproduce: take the URL
the page would have written at that point and run it. And the rebuild has two
lists to keep true -- `registry.ts`'s `ENEMY_CLASSES`, the classes the game
counts, and the walker's `ENEMY_GATE_CLASSES`, the ones a replay retires at a
room gate -- which had drifted apart by two classes (`L24`'s shape: "I fixed
it" was true of one copy); `web/test/port/` drives every member of the
first through a gate and fails on any the second forgets.

**L78 -- A hash of what was handed over says nothing about what was made of
it.** Netplay's replica hashes the tree the deltas land in every tick, and it
agreed with the host's on every tick of every run. But every slice of that
tree except `G` is then handed to its system's `load`, and the page plays what
the systems hold, not the tree. Hashing the systems' own `save()` as well
(`DEEP_EVERY` in `app/net/replica.ts`) disagreed on half its checks the first
time it ran: the replica wrote the RNG word back as `state >>> 0`, and the
host's is signed whenever `Rng.next` last ran. The same bits draw the same
numbers, so nothing played wrong -- this time. **Check state where it is used,
not where it was delivered.**

**L80 -- A flag that makes the test environment work can be the bug the user
hits.** Netplay's browser harness launched Chrome with
`--disable-features=WebRtcHideLocalIpsWithMdns`, so two tabs would find each
other by plain address "whether or not mDNS resolves", and its WebRTC run
passed for days. The first person to try two tabs sat on "Finding a way
through both networks" for good: every real Chrome hides host addresses
behind `.local` names, this Mac does not resolve them, and its router does not
route its own public address back in. The flag was written down, with its
reason, and the reason was the failure. **When a harness needs a flag the
user's environment does not have, the flag is the finding**: here it meant a
TURN relay was not optional even for two tabs, and `web/tools/net_pair.mjs` now
runs Chrome with no such flag, through the relay the dev server runs.

**L82 -- A user agent names a browser, not a device, and an address names a
network, not a machine.** Netplay's perf log had two sessions' rows, one from
a user agent saying `Macintosh` and one saying `iPhone`, both from the same
LAN address. That read as Safari on a Mac and the iOS Simulator beside it on
one overloaded machine, and the analysis told the user the numbers were
contention, not Safari. They were an iPad and an iPhone: iPadOS Safari asks
for desktop sites and says `Macintosh`, and the two sat behind one address.
The numbers were real, and the thing to fix -- a walk of the whole state
costing a phone thirty times what it costs a Mac -- was nearly argued away.
**Ask what the device is before explaining its numbers away**, and treat
`ua`, `from` and `view` in a report as clues rather than identification: a
`dpr` of 2 at 2048×1536 is an iPad as much as it is a Retina Mac.

**L88 -- A report names what the player saw, and the class is found from
the address.** "Civilians that start in a dead pose can be shot" sent a
session into class 0x10 -- its stream table, its shot gate, the root height
of every spawn's first clip -- because that is the class the port calls
civilians. The body the user meant was class 0x24, a set-piece; in this game
people are drawn by at least classes 0x10, 0x20, 0x24 and 0x25, and only the
first is "civilian" in the code. The reading on the way was not wasted (it
found a real gap in class 0x10 too), but it answered the wrong report until
the user sent `?stage=1&block=1&step=3&op=9`. **Ask for the address, or
take the page's own URL, before choosing a class**, then read
`G.g_object_list` there for what is actually on screen (L83's list-every-spawn
pointed at a report).

**L93 -- A thing drawn in the wrong place may be a second copy, and the first
question is which layer draws it.** "A huge door in the complete wrong
position" at the start of stage 5 read as a transform bug, and the step's
three door-like objects were each checked in turn: the hinge's remove flag
raised, the roller shutter's remove flag raised, the rigs, props and
breakables layers switched off one at a time in a driven page. The door stayed
through all five. It was `StageScene`'s: the shutter's model, slot `0x189A`,
which the port drew correctly in its garage three hundred units away *and*
again at the world's origin, because the script had loaded it with opcode
`0x50` and the stage draws every unregioned loaded slot where the model's own
coordinates put it -- `L54`'s stand-in, still in the tree. The same rule had
been the only thing drawing the gate behind JUDGMENT (slot `0x1892`), whose
builder was unported, fourteen hundred units from the fight. **Before reading
any routine's matrix, find the layer: switch each one off in a driven frame
and see which takes the object with it**; a model with no layer left is a
drawer the port does not have, and a model two layers draw is a stand-in that
outlived the port it stood in for.

**L94 -- A report that the port plays wrong is a claim about the exe too, and
the exe's own number comes before the fix.** Stage 2 block 5's two `zsass`
were reported "pushed back much too far by being shot -- I can basically push
them off the stage". Read in full, most of that push is the engine's:
`ThrowerStateFallAndLand` throws the body `150 / d` units along the camera's
depth and then plays `0x11B`, a back handspring whose root runs 21.4 units
backwards with root motion on -- about 24 units a knockdown, faithfully. What
the port had wrong was around it, and every fault pushed the same way: the
stumble on its one-shot channel instead of on track 1 (so it carried the
stumble clip's root, and held the state a second shot turns into a knockdown
for the whole clip instead of until track 0's loop came round), the baked clip
length where the engine reads `g_motion_play_length`, and no thirty frames of
immunity and no router at the hand-back. Under a held trigger that was 288
units of drift in fifteen seconds where the faithful port gives 168 -- still a
long way, because the game does it. A clamp on the push would have closed the
report and made a game that is not this one. **Work out what the exe does with
the reported input first, measure before and after at the reported address,
and say which part of the complaint is the engine's own.** And a port channel
standing in for a motion track is a claim about which track: `obj.action` is
not track 1, and a state's cursor test reads track 0 whatever else is playing.

**L96 -- "Drawn at the origin" means drawn at the model's own coordinates, and
a model authored in world space lands where it belongs.** Retiring
`StageScene`'s "loaded, so drawn" rule, the before-and-after hunt looked where
the world's origin is on screen, found no change, and nearly called the
deletion invisible. Five of the 130 slots the rule drew are authored in world
space -- stage 4's `st4_09.bin[0]` and `[2]` span x -657..685, z -2261..-1567
-- so the rule had been drawing them in place, in the right shape, as the only
thing on screen standing in for class 0x13 carrier selectors 4, 5, 7 and 8,
which the port had not read -- delete the rule alone and those two models
are gone from stage 4's blocks 23 to 29, walls and all, so the routines were
ported in the same change. **Judge a stand-in's reach from each model's
bounding box, not from where it is "put"**, and take the before picture where
that box is on screen.

**L97 -- A seek replays a block's ops, not its frames, so an object whose
state is built over frames arrives in its first one.** Stage 4's set model
(`CarrierPropRoutine4`) rises along `op_` path `0x176` while camera path 180
plays and parks at the origin; driven from its spawn it sits there for the rest
of block 23. Seeked to op 55, 67 or 80 of the same block, the replay spawned it
and ran no frames, so its first update was state 1 at *that* camera path's
frame -- the model sunk 120 to 180 units into the floor under its
camera-facing strip, on a shot that never shows it so. A picture taken at a seek address is a picture
of the seek unless every object in it is stateless or was spawned after the
address; **to see a state machine's later state, drive frames from its
spawn**, and read the pool (`G.g_object_list`) before trusting the frame.

**L111 -- A replay that stands in for a wait's frames has to run every task
those frames run, not the ones it was written for.** The seek steps over each
wait by running the camera's tasks (3 and 5) for the frames the wait spans,
and that was the whole of it: task 2, `PushSceneLightStateToDevice`, which
steps the light blocks' tweens, never ran. A set on a channel leaves its tween
armed (`ApplyLightChannelOperand`), so every tween a replay met stayed live
past every later set, and the first frames after the landing walked the light
back to wherever the tween had been going. Stage 1's opening fades its fog to
black at `1..1`, waits twenty frames and sets it back; every seek past it --
`?stage=1&block=2&step=1&op=0` among them -- drew a field of fog with no world,
and every stage had its own. It read as a missing region or a camera facing
nothing; the sidebar's `fog planar 2..2` said it from the first look. **When a
port runs some of a frame's tasks to stand in for frames it skips, list the
scene's task list (`camera/actor.ts`) beside it and say why each one left out
holds no state across the gap** -- `L97` is the same shape for an object's
own frames.
