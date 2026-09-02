# Where the player still stops

A work list, written from a full playthrough of stage 2 rather than from
reading. Everything here is reproducible with one command and has its evidence
attached. `[open]` items have **not** been read in the binary yet; do not
"fix" one without reading it first — see **Rules** at the bottom.

## Seeing it for yourself

```sh
cd web
node tools/playthrough.mjs --stage 2            # add --headless to run it blind
```

It drives the player from a stage's **entry block** — never a deep link, a seek
is its own rebuild path with its own bugs — to an end block, and exits non-zero
if it does not get there. An address that has not moved for fifteen seconds is a
hang: this is an arcade game and no authored sequence in it is that long. On a
hang it prints the instruction, the wait, the actors holding it and their own
debug rows, and writes `web/shots/hang-stage<N>.png`.

It shoots at **enemy** gates through the real path — pointer events on
`#viewport`, `Shooting.fire`, the ray, the per-bone spheres, `ResolveHit` — and
falls back to the Kill button after eight seconds, saying so. It never shoots at
or clears a **civilian** gate: you are not meant to shoot civilians in this
game, so a `wait_scripted_actors` that does not come down on its own is a bug by
definition and clearing it would hide the thing the tool exists to find.

**Reaching an end block is not the same as the stage being playable.** The tool
is allowed to cheat — it falls back to the Kill button on an enemy gate the
shots cannot clear — so it prints, at the end, every room it had to cheat past.
Those rooms are the ones a player is stuck in. It exits non-zero if there are
any.

The branch countdown answers itself with the **lowest block number** so that one
run takes the same route as the next; see item 9.

### Stage 2 — reaches block 35 `(end → 0)`, ~260s, ~157 instructions

Route: 0 → 1 → 2 → 3 → 30 → 5 → 6 → 17 → 18 → 19 → 20 → 35.

Rooms that had to be cheated past, from one run (the set varies between runs —
see item 8):

| block | step/op | wait |
|---|---|---|
| 3 | 1 / 26 | `0x44 wait_enemies_alive` |
| 3 | 4 / 18 | `0x44 wait_enemies_alive` |
| 6 | 3 / 9 | `0x44 wait_enemies_alive` |
| 18 | 7 / 10 | `0x44 wait_enemies_alive` |

Block 3's is the one with a picture: the viewport is a flat wall. See item 1.

### Stage 1 — completes **intermittently**, ~137s, ~101 instructions

Route: 0 → 1 → 9 → 2 → 3 → 4 → 6 → 5 → 14, the same every run.

Five runs gave four different outcomes, which is itself the most interesting
thing about this stage:

| outcome | seen |
|---|---|
| reached block 14 `(end → 0)` clean | twice |
| reached the end, but block 4 step/op 3 / 19 `wait_enemies_alive` needed the clear | twice |
| hung at block 5 step/op 1 / 10, `wait_scripted_actors` | once |
| hung at block 1 step/op 5 / 56 | once |
| hung at block 3 step/op 5 / 13 | once |

**Block 4 step 3 op 19** is `wait_enemies_alive` held by two `zstin` — class
0x31 — in `WaitForPermit` at 30 and 6 units, off screen, with the camera parked
at `cp_st1[10] slot 42 frame 429 / 429 (static pose)`. Unlike stage 2's the
scene renders perfectly; the two enemies are simply not in the frame. The
thrower row now prints why a permit was refused, which is the next thing to
read off it. `[open]`

**Block 5 step 1 op 10** is `wait_scripted_actors` with `g_civilians_alive 1`
and **no actor listed as holding it** — the count and the pool disagree. Item 2
was one way that happened and is fixed; whether it was *this* one is
unestablished. `[open]`

**Blocks 1 and 3** were not captured in detail. Re-run until they recur and
read the wait panel. `[open]`

Three sidebar readouts were added while finding these and are worth knowing
about, because each turns a row that said nothing into a number:

* a zombie in `HoldAtRange` prints **why** a permit was refused — out of rank,
  past the queue cap, cooling down, another enemy committed off screen, or all
  permits held and by whom;
* a captor prints its script cursor — which of the two blobs, which entry, the
  loop count, the cue frame, and the play cursor against its length;
* a civilian on a reach/face/in-front wait prints its target, distance against
  radius, heading error and turn rate.

---

## 1. The camera is parked facing a wall, so the enemies cannot be shot

**The biggest one, and the reason every cheated room above is cheated.**

Both stages show it and the tell is the same: the transport bar says
`(static pose)` and the frame the shots go into is not the frame the fight is
in. It is intermittent on stage 1 and reliable on stage 2, which fits a camera
that stops where its path ran out rather than one that is aimed wrongly.

At stage 2 block 3 step 1 op 26 the two van zombies are alive at 23 and 25
units, and twenty shots a volley never touch them. The transport bar reads
`cp_st2[4] slot 59 frame 205 / 205 (static pose)` and the viewport is a flat
olive wall. They are not in frame at all, so **a player could not clear this
room either**. This is not the harness failing to aim.

Reproduce:

```sh
node tools/shot.mjs --url '?stage=2&block=3&step=1&op=0' --out wall \
  --click 'label[title^="Click to shoot"] input' --press Space --settle 8000
```

Where to start: the shot has run to the end of its path and retired, and
`CameraRig.seat` then stops advancing the block (`force || !cam.done ||
!trackEnabled`). Whether the engine leaves a retired shot where it is, or hands
over to something the port does not have, is `[open]` — read
`CamStartPathPlayback` and `CameraTrackEnemiesTick` before changing anything.
`docs/PLAYER_ARCHITECTURE.md` has the camera's two halves and why they sit
either side of the game phase.

Stage 1's block 4 is the same shape with a different picture — the street
renders perfectly and the two `zstin` are simply outside it, one of them six
units from the camera. Worth doing that one first: it is smaller, and a scene
that draws correctly rules out half the possible causes.

## 2. An actor the script stopped placing kept its bookkeeping — **fixed**

`CharacterLayer` materialises actors from the walker's spawn list and unmakes
them when an entry goes. That unmaking was a *hide*: the actor stayed in
`g_object_list`, invisible — so `GameUpdate` never ran it again — and still
counted, so `wait_scripted_actors` could hold on a number nothing could bring
down with nobody on screen to explain it. `ActorRetireFromWorld` in
`game/despawn.ts` is the removal now, driven from `app/` rather than from the
layer that noticed, and `ClassHandler.retire` is each class's share of it.

Recorded because the shape will recur: **the port has a lifetime the engine
does not have.** In the exe an object leaves through its own state machine and
its bookkeeping leaves with it; there is no "the script stopped listing you".
Every counter and every latch an actor can hold needs a hand in `retire`.

## 3. `RemoveOffCamera` is declared and acted on by nothing

`CivilianUpdate` (`FUN_0048A920`) has a **second removal path**, and the port
has the enum member and no behaviour:

```c
if ((civ[0] & 0x2000000) != 0 && !ActorBoundsOnScreen(obj)
    && DAT_009c6f08 != 2 && civ+0x1E == 0) {
    /* free the hit slot */
    if ((civ[1] & 1) == 0) g_civilians_alive--;
    /* despawn */
}
```

Off screen, not in mode 2, holding no children: it leaves on the spot and takes
itself out of the count. Stage 2's stream 95 ends on a wait word carrying this
bit *and* `LeaveCountNow`, so it matters for exactly the gates this list is
about. `web/src/game/class10/index.ts`, `CivilianCheckRemoval`. `[proved]` that
the engine does it; the port simply does not.

## 4. The removal cue takes `>=` where the engine takes `==`

`CamPathCueReached` is `g_active_cam_path === path && g_cam_path_frame >= frame`.
`CivilianUpdate`'s removal cue and `CivilianStepScript`'s camera-cue wait are
both **equality** on the frame:

```c
g_active_cam_path == civ+0x26 && g_cam_path_frame == civ+0x28
```

`>=` is the more forgiving of the two, so it is not blocking anything today —
which is exactly why it will be a nuisance to find later. Note the frame is an
integer that steps by one (`g_cam_path_frame = __ftol(...)`), so equality is
safe in the engine and is only unsafe here if the walker's clock is ever handed
a variable step. Check that before changing it. `[open]`

## 5. Skipping a cutscene does not clear its civilians

`DAT_009a2230` — written by `EvtOpSetSkippableRegion2C`,
`CheckCutsceneSkipRequest` and `FinishCutsceneSkip`, so it is the
**skip-in-progress flag** — is read at the top of `CivilianUpdate`'s removal
tail:

```c
if (DAT_009a2230 != 0 && (civ[0] & 0x20000000) == 0) { civ+0x2A = 1; ... }
```

Every civilian without bit `0x20000000` gets a one-frame countdown and leaves.
That is how skipping a cutscene clears the people in it, and the port does none
of it. Name the global first — it is not in `globals.tsv`. `[open]`

## 6. Wait bit `0x00100000` is unread

Four of the six wait words in stage 2's stream 95 carry it. It is in neither
`Any` (`0x40003FFF`) nor the blocked mask (`0x14000000`), so it does not gate
`CivilianStepScript`'s loop — something else reads it. Find the reader.
`[open]`

## 7. `sub+0x0E`: op 3 writes it and the turn does not read it

`CivilianStepTurnToTarget` passes a literal `0x100` to `ActorTurnTowardPoint`.
The port had been passing `sub+0x0E` — which is what op 3 writes and what
`CivilianInit` seeds with 10 — and every civilian turned twenty-five times too
slowly; that is fixed. What now needs finding is **what actually reads
`sub+0x0E`**, because op 3 sets it deliberately. The field is kept and the
sidebar shows it. `[open]`

## 8. The same stage does not play the same way twice

Stage 1 gave four different outcomes over five runs on identical code and an
identical route. That is not the harness being flaky in an uninteresting way —
it means something in the port is sensitive to *when* frames land.

The suspect worth reading first is the family of **exact-frame cues**. The
engine counts `obj+0x19C` up by one per game frame, so `== some frame` is safe
there; this port derives the cursor from a clock the player may advance by
several frames at once (`Tick.dt` is `frames * TICK`), and a cue that is
compared with `===` can be stepped straight over. Three of them are already
known: `atLastFrame` in `class30/target.ts` (equality, and deliberately so —
`>=` would double-count loops), the kill cue in
`ZombieStateTargetMotionScript`, and `CivilianStepScript`'s motion-frame wait.
`ZombieStateMotionCue21`'s shot-immunity cue was changed to `>=` for exactly
this reason and carries the note.

A cheap experiment before reading anything: pin the player to one game frame
per tick and see whether stage 1 becomes deterministic. If it does, that is the
whole answer. `[open]`

## 9. The branch countdown is a port decision, not the engine's

`Walker.takeBranch` with no argument now picks the **lowest** block number. It
used to draw from `ctx.rng`, which made a stage take a different route each
run. The engine's own selector is `g_script_branch_var` (`0x009C88A4`) and is
not read yet; until it is, this is `[diverges]` and deliberate, because a
harness that cannot compare one playthrough with the previous one is not worth
much. Reading that global would replace it.

## 10. Class 0x30 has no death state

`GameUpdate` skips dead actors unless the handler sets `updatesWhenDead`, which
class 0x31 does and class 0x30 does not, so the zombie's death clip is played by
`ActorAdvanceMotion`'s `obj.death` instead of by a state. The consequence today
is that the permit release lands in `GameUpdate`'s dead-actor sweep rather than
where the engine keeps it — `ZombieStateDeath6` (`FUN_00454D20`) sub 1 calling
`ZombieReleasePermitAndUntrack` (`FUN_004565A0`). It is correct as it stands;
porting state 6 would move it home. `[open]`

## 11. Stages 3 to 6 have never been swept

Stages 1 and 2 are above. `--stage 3` through `--stage 6` have not been run at
all. Expect more of the same shape. Stage 1's opening is nearly a minute of
cathedral, so the tool takes every skip the script offers.

---

## Rules for whoever picks this up

These are not style preferences; each one was paid for.

1. **`/decomp` first.** You may not port what you have not read. Every item
   above marked `[open]` means exactly that: read the routine, name it in
   `ghidra/annotations/`, then write TypeScript.
2. **A divergence is the user's decision, not yours.** If the faithful fix is a
   refactor and the quick fix is a `[diverges]`, say what the engine does, say
   what the faithful fix costs, and **ask**. The tell that you are about to get
   this wrong is having just written *this reproduces the engine's behaviour in
   practice*. It does not; it reproduces what you have thought of.
3. **Revert your fix and re-run the test.** Two of four assertions in one batch
   here passed with the fix backed out, and one of them passed for a reason
   that had nothing to do with what it claimed to check. A test you have not
   watched fail is not evidence.
4. **A shared label is one function.** Three bugs in this file came from the
   same shape: a piece of the engine that is reached from several places was
   written out once per caller, and the copies were not identical.
   `LAB_0048B52E`, `obj+0x1398`, and the permit release are all this.
5. **Peers run in this repo concurrently.** `git add -A` is banned; split by
   hunk, leave their work exactly as you found it, and check the commit
   compiles **on its own** — `git worktree add --detach /tmp/x HEAD` and run
   `tsc` there. A commit here was already broken by staging a hunk that
   depended on a file the peer had not committed.
