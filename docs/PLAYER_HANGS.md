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
if it does not get there. An address that has not moved for **nine hundred game
frames** is a hang: this is an arcade game, no authored sequence in it is
fifteen seconds long, and fifteen seconds is nine hundred frames. On a hang it
prints the instruction, the wait, the actors holding it and their own debug
rows, and writes `web/shots/hang-stage<N>.png`.

**Every deadline in it is counted in frames, not milliseconds.** It runs the
page under `?drive=1` — the seam in `web/src/app/harness.ts` — which hands it
the game clock: rAF keeps running and the renderer keeps drawing, so this is
the real page, the real UI and the real shot path, but game time advances only
when the tool asks and only in whole 60 Hz frames. That is what makes one run
comparable with the next, and it is what item 8 was about. It also makes a
stage about six times faster in wall clock, because a driven frame does not
have to wait for the next vsync.

The check that this stays true is its own tool:

```sh
node tools/determinism.mjs --stage 1 --headless
```

Two runs of the same stage on the same seed with the same **frame-scheduled**
inputs, traced frame by frame and diffed. The trace is game state only — the
frame, the walker's address, `ctx.rng`'s whole state, `g_frame`, the gate
counters and one digest per live actor. It exits non-zero on the first frame
that differs and prints both sides.

It shoots at **enemy** gates through the real path — pointer events on
`#viewport`, `Shooting.fire`, the ray, the per-bone spheres, `ResolveHit` — and
falls back to the Kill button after 480 frames, saying so. Under the driven
clock the game is stopped between two `advance` calls, so a whole volley lands
on one exact frame instead of smeared across however many the browser ran. It never shoots at
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

### Stage 2 — reaches block 37 `(end → 7)`, 14145 frames, 157 instructions

Route: 0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 10 → 9 → 28 → 37.

**Five runs, and the printout is byte-identical apart from the wall-clock
column** — every block is entered on the same frame in every one. Item 8 is
fixed; see it.

Rooms that had to be cheated past — the same three every run. The wall-clock
tool cheated past **seven** on the same route (block 3 three times, then 5, 6,
9 and 28) in 153 instructions against 157. Landing a whole volley on one exact
frame, rather than smeared across however many the browser happened to run, is
why four of them now clear:

| block | step/op | wait |
|---|---|---|
| 3 | 1 / 26 | `0x44 wait_enemies_alive` |
| 9 | 6 / 5 | `0x44 wait_enemies_alive` |
| 28 | 5 / 7 | `0x44 wait_enemies_alive` |

Block 3's is the one with a picture: the viewport is a flat wall. See item 1.

The route above is **not** the one this file recorded before (0 → 1 → 2 → 3 →
30 → 5 → 6 → 17 → 18 → 19 → 20 → 35), and the difference is not the driven
clock: `Walker.takeBranch` with no argument picks `Math.min(...targets)` and
block 3's targets are `4, 30`, so 4 is the only answer it can give. Either the
earlier route was recorded before that rule landed, or the branch was answered
some other way; the run above is what the current tree does, five times out of
five. See item 16.

### Stage 1 — reaches block 14 `(end → 0)`, 7725 frames, 98 instructions

Route: 0 → 1 → 9 → 2 → 3 → 4 → 6 → 5 → 14.

**Five runs, byte-identical apart from the wall-clock column, and no room
needed the debug clear.** Every block is entered on the same frame every time:

```
  f     0  block 0  (goto → 1)    3 placed  lives 2
  f   435  block 1  (branch → 10,9)
  f  3420  block 9  (branch → 2,7,12)
  f  3870  block 2  (goto → 3)
  f  4530  block 3  (goto → 4)    5 placed, 4 the enemy gate waits on
  f  5925  block 4  (branch → 6,13)   lives 1 · invulnerable 68f
  f  7380  block 6  (branch → 11,5)
  f  7605  block 5  (goto → 14)
  f  7725  block 14 (end → 0)
```

Before the clock was fixed, five runs gave four different outcomes — which was
the most interesting thing about the stage, and is now item 8's evidence:

| outcome | seen |
|---|---|
| reached block 14 `(end → 0)` clean | twice |
| reached the end, but block 4 step/op 3 / 19 `wait_enemies_alive` needed the clear | twice |
| hung at block 5 step/op 1 / 10, `wait_scripted_actors` | once |
| hung at block 1 step/op 5 / 56 | once |
| hung at block 3 step/op 5 / 13 | once |

That was re-measured rather than quoted, by running the pre-change
`playthrough.mjs` out of git against the same tree — it never passes `drive=1`,
so every driven branch is inert and the behaviour is exactly as it was. **Five
runs, five different outcomes:**

| run | outcome |
|---|---|
| 1 | hung at block 3 step/op 2 / 12 — `The script is not blocked`, lives 1 → 2, block 3 entered three times |
| 2 | reached the end, **102** instructions, block 4 step/op 3 / 19 needed the clear |
| 3 | reached the end, **100** instructions, block 4 step/op 3 / 19 needed the clear |
| 4 | reached the end, **98** instructions, block **1** step/op 9 / 16 needed the clear |
| 5 | hung at block 2 step/op 1 / 8 |

Against 5/5 identical afterwards, at 98 instructions with nothing cheated.

None of those recurs on the driven clock. **That does not mean the underlying
faults are gone** — the two `zstin` below are still off screen where a player
could not shoot them, and the run above simply never reaches the state that
exposed it. What it means is that the four outcomes were one route sampled at
four different sets of frames, and that a hang found from here on is a fact
rather than a coin.

**Block 4 step 3 op 19** is `wait_enemies_alive` held by two `zstin` — class
0x31 — in `WaitForPermit` at 30 and 6 units, off screen, with the camera parked
at `cp_st1[10] slot 42 frame 429 / 429 (static pose)`. Unlike stage 2's the
scene renders perfectly; the two enemies are simply not in the frame. The
thrower row now prints why a permit was refused, which is the next thing to
read off it. On the driven clock this room now clears by shooting, so it is
**not** reproducible from the entry block any more — pin it with a URL.
`[open]`

**Block 5 step 1 op 10** is `wait_scripted_actors` with `g_civilians_alive 1`
and **no actor listed as holding it** — the count and the pool disagree. Item 2
was one way that happened and is fixed; whether it was *this* one is
unestablished, and it no longer reproduces from the entry block. `[open]`

**Blocks 1 and 3** were not captured in detail and do not recur. One of the two
*was* captured on the way to fixing item 8, from the old wall-clock tool: block
3 step/op 2 / 12, fifteen seconds on one instruction with the wait panel saying
**"The script is not blocked"** and the lives counter having gone 1 → 2 with
block 3 re-entered twice. An instruction that is not a wait and does not
advance is a different fault from the four in the table at the top of this
file. `[open]`

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

## 8. The same stage does not play the same way twice — **fixed**

Stage 1 gave four different outcomes over five runs on identical code and an
identical route. The gameplay was never the problem: **the clock and the input
timing were.**

**The mechanism.** There were two clocks and they disagreed about what a frame
is.

* `Loop.advance` (`web/src/app/loop.ts`) drained a 60 Hz accumulator and
  stepped the **walker** once per *whole* frame.
* `Player.gameTick` (`web/src/app/main.ts`) returned
  `{ dt: wall * speed, frames: dt * 60 }` — taken straight off the rAF
  timestamp, so **fractional and different on every frame** — and that tick
  drove `world.update`, which is the whole of `game/` and every render layer.
  Every motion clock, timer and state advance in the port therefore moved by a
  browser-dependent amount, and `g_frame` was a float.

And the harness scheduled on wall time on top of that: `playthrough.mjs` polled
every 250 ms and fired a volley after N *milliseconds* of no address movement,
so the shots landed on a different game frame in every run.

The cheap experiment this item asked for was the right one, and the answer is
yes.

**The fix, in two parts.**

*One clock, everywhere.* `Loop` is the pacer and `Player.stepOneFrame` is the
tick; a drawn frame runs however many whole 60 Hz ticks the accumulator owes,
and `gameTick` is gone. **This is interactive play too, not only a driven
run** — the user's call, and the reason is that the engine's frame is fixed:
`obj+0x19C` counts up by one per game frame and `g_cam_path_frame` is
`__ftol`'d, so an `== cue` is safe there and a port integrating a fraction of a
frame was not running the same game.

Nothing is skipped, either. The catch-up is *spread* — a burst larger than the
per-frame cap stays in the accumulator for the next frame — and the
`Math.min(0.1, ...)` clamp in `wallDelta`, which silently lost 400 ms of game
time in a 500 ms stall, is gone. That is affordable because a debt worth
dropping is no longer allowed to form: a hidden tab stops the clock and resumes
without banking the gap, and a paused player stops asking for frames at all.
`tools/pacing.mjs` proves that arrangement on the real page.

*A different time source for a driver.* `?drive=1` and
`web/src/app/harness.ts` feed the same accumulator from the driver instead of
from the wall, and change nothing else — the same `stepOneFrame`, the same
rAF, the same draw and publish. Inputs are scheduled by **frame number**; the
game is stopped between two `advance` calls, so a pointer event dispatched
there lands on an exact frame and cannot interleave with a tick. The seam is
inert without the flag and may do nothing a `UiCommand` cannot.

**The proof, and it was watched failing.** `tools/determinism.mjs` runs the
same stage on the same seed with the same frame-scheduled inputs twice and
diffs the traces. With the driven clock temporarily replaced by the old pair —
walker on the accumulator, port on `wall * 60` once per rAF — it exits 1 on
**trace index 0**, with `g_frame` at 19 in one run and 18 in the other and the
RNG state already apart. With the fix it is identical over 2000 frames, and
five full playthroughs of each of stages 1 and 2 are byte-identical apart from
the wall-clock column.

**Item 4 is now unblocked.** `>=` where the engine has `==` was only needed
*because* the clock could hand over a variable step. It no longer can, so the
port can take the engine's own comparison — read the routine first.

**Interpolation between ticks is deliberately not done.** A fast display
redraws the same simulated state more than once. Doing better needs the
previous and current pose in `render/`, which is a second copy of state above
the engine line that `resync` would have to rebuild, and at 60 Hz simulated it
buys nothing until the display is faster.

The family of **exact-frame cues** is the reason all of this matters. `atLastFrame` in
`class30/target.ts` (equality, and deliberately so — `>=` would double-count
loops), the kill cue in `ZombieStateTargetMotionScript`, and
`CivilianStepScript`'s motion-frame wait are all `===` against a cursor derived
from that clock. `ZombieStateMotionCue21`'s shot-immunity cue was already
changed to `>=` for this reason and carries the note. `test:state` now asserts
both halves: six hundred whole ticks leave `g_frame` integral at every step,
and six hundred jittered ones step over integers.


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

## 12. The rain draws from the **shared gameplay RNG**, a variable number of times

`web/src/game/effects/rain.ts` ticks the pool with
`RainAdvanceParticles(this.rules, t.frozen ? 0 : t.wall * 60, ctx.rng)`.

Two things wrong with that line, and only one of them is the clock:

* it is `t.wall`, not `t.dt` — so the rain runs on the wall clock even where
  everything else runs on the game's;
* `ctx.rng` is the **world's** generator, the one every gameplay draw comes
  from. Each particle that crosses `respawnBelow` burns three `next()` calls,
  and how many cross depends on how much time was handed over. So a cosmetic
  layer **shifts the RNG stream position for every draw in `game/`** — the
  attack picks, the death directions, `ResolveHit`'s one-in-four headshot
  burst.

Under `?drive=1` this is deterministic, because `t.wall` is `TICK`. In ordinary
interactive play it is not, and it is aliasing gameplay onto the weather either
way. Whether the engine's rain uses the same `rand()` as combat is `[open]` —
`checkpoint` reseeding it with 0 during gameplay is noted in that file and is
where to start reading.

## 13. The `Math.random` ban has a hole, and both current hits are harmless

`tools/verify_port.py` greps only `game/`; `tools/verify_layers.py`'s
`no-math-random-in-engine` covers `core/ bundle/ script/ game/`. Neither sees
`render/`, which has two:

* `web/src/render/shooting.ts:303` — `pickOne`, choosing which impact and which
  hurt/kill voice to play. **Sound only.** Checked: the return feeds
  `playSound(...)` and nothing else, and the caller's game-state writes
  (`ScoreAddForPlayer`, `chars.hit` → `ResolveHit`) are all upstream of it.
* `web/src/render/breakables.ts:379` — a draw-time rattle the engine recomputes
  from `rand()` every frame and never writes back. **Cosmetic.**

So nothing is broken today. But `render/` is where the stage-1 car spin lived
precisely because transcribed behaviour drifted there where no check could
reach it, and a rule with a hole in it is how the next one gets in. Widening
the layer rule to `render/` would need both hits routed through a generator —
a *render-only* one, not `ctx.rng`, or it becomes item 12 again. `[open]`

## 14. With pillarbox off, the window size changes what you hit

`Player.resize` sets `camera.aspect = w / h` when `pillarbox` is false
(`web/src/app/main.ts`), and `Shooting.fire` unprojects through that same
camera with `Raycaster.setFromCamera`. So the ray a click produces depends on
the shape of the browser window.

`pillarbox` defaults to true, where the aspect is pinned to 4/3 and the shot is
safe — but it is a toggle and it is persisted to `localStorage` by
`app/viewprefs.ts`, so a player who turned it off once is aiming through a
different frustum for ever. The game is 4:3 with a fixed vertical FOV
(`SetupSceneProjection`), which says the picture may be widened but the *shot*
may not. `[open]` — what the engine does with a non-4:3 window is the question,
and it very likely never had one.

## 15. Two stage loads can interleave

`void p.loadStage()` in `app/commands.ts` (twice) and `app/main.ts` is
fire-and-forget with no in-flight guard, and `loadStage` awaits twice in the
middle of tearing one stage down and building the next. Two stage switches
issued while the first is still awaiting will interleave their rebuild halves
over one `Player`, and which one wins depends on how fast the fetches came
back. Not a hang and not reachable from the harness, which loads one stage;
reachable from the stage select. `[open]`

## 16. Stage 2's recorded route is not the route it takes

This file recorded 0 → 1 → 2 → 3 → **30** → 5 → 6 → 17 → 18 → 19 → 20 → 35.
The current tree takes 0 → 1 → 2 → 3 → **4** → 5 → 6 → 7 → 8 → 10 → 9 → 28 →
37, five times out of five, and it is not the driven clock that changed it:
`Walker.takeBranch` with no argument picks `Math.min(...targets)` and block 3
offers `4, 30`. The commit that made the pick the lowest block is an ancestor
of the commit that recorded the route, so the two disagreed before this work
started.

Either the route line was written from an older run, or something answered
block 3's branch with 30. **The pre-change `playthrough.mjs`, run out of git
against this same tree, also takes 3 → 4** — so it is not the driven clock and
it is very probably the first. Left `[open]` only because nothing has been read
that says what `g_script_branch_var` (`0x009C88A4`) would have answered; see
item 9. Not worth chasing on its own.

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
