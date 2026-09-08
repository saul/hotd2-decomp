# Where the player still stops

**Scope, against the other bug list:** this file is what the *automated
playthrough* trips on — defects found by driving the player end to end, each
with the command that reproduces it. Bugs someone *reported from playing*, and
whether each is fixed, are in [`BUGS.md`](BUGS.md). Neither file states a
count that [`STATUS.md`](STATUS.md) generates.

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

It shoots at room-clear gates through the real path — pointer events on
`#viewport`, `Shooting.fire`, the ray, the per-bone spheres, `ResolveHit` — and
reaches for the Kill button after 480 frames, saying so and naming who was
left. Under the driven clock the game is stopped between two `advance` calls,
so a whole volley lands on one exact frame instead of smeared across however
many the browser ran.

**It shoots at a civilian gate too, and that changed** — see item 17. It used
to refuse, on the reasoning that you are not meant to shoot civilians and so a
`wait_scripted_actors` that does not come down on its own is a bug by
definition. The engine says otherwise: `EvtOpWaitScriptedActors46`
(`FUN_0045FCD0`) is `g_civilians_alive <= arg && g_evt_gameplay_live &&
g_camera_free`, and `g_camera_free` comes from the enemies in
`g_enemy_slots` — so a 0x46 gate standing in a room with live zombies is held
by the **zombies**, and shooting them is not shooting civilians. The one case
it still refuses is a gate whose named blocker is a civilian who is **alive**;
that one is the bug this tool exists to find, and killing her would hide it.

**And the shooting does not stop when the Kill button is pressed.** Stopping
there is how stage 6 came to be read as a hang: the clear killed a thrower
inside `ActorFlag.ShotImmune`, where a shot would have been refused, and an
actor killed without being told never runs its death chain. See item 18.

**Reaching an end block is not the same as the stage being playable.** The tool
is allowed to cheat — it falls back to the Kill button on a gate the shots
cannot clear — so it prints, at the end, every room it had to cheat past.
Those rooms are the ones a player is stuck in. It exits non-zero if there are
any.

The branch countdown answers itself with the **lowest block number** so that one
run takes the same route as the next; see item 9.

### All six stages, as of items 17 and 18

`node tools/playthrough.mjs --stage N --headless`, one after another on an
otherwise idle machine. **All six reach an end block.** The two sections
below this one predate the branch rule and describe routes the tree no longer
takes — see item 16.

| stage | end block | frames | instr | rooms the shots did not clear |
|---|---|---:|---:|---|
| 1 | 14 `(end → 0)` | 7965 | 94 | block 1 `8 / 6` |
| 2 | 35 `(end → 0)` | 12120 | 146 | — |
| 3 | 13 `(end → 4)` | 6210 | 59 | — |
| 4 | 25 `(end → 0)` | 7125 | 83 | — |
| 5 | 7 `(end → 0)` | 7875 | 78 | block 2 `2 / 50` |
| 6 | 12 `(end → 0)` | 7110 | 63 | blocks 0 `4 / 8`, 1 `3 / 17`, 3 `2 / 13` |

Before this branch, on the same tree and the same seeds: stages **2, 3 and 6
hung** — block 14 `9 / 20`, block 6 `1 / 13` and block 0 `4 / 8` — and 1 and 5
reached an end block with one cheated room each. Item 19 names who is left in
the five rooms above.

**Every stage still exits non-zero**, and for two reasons. The cheated rooms
above are one. The other is one console error in every stage, on `main` as
well, and it is a **missing music file**, not the gameplay: stage 4 says
`404 /bgm/ST4_AR.WAV`, `net::ERR_ABORTED`. Every stage has its own. Nothing to
do with the walker; recorded so the next reader does not chase it. `[open]`

### Stage 2 — reaches block 37 `(end → 7)`, 13860 frames, 156 instructions

Route: 0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 10 → 9 → 28 → 37.

**Five runs, and the printout is byte-identical apart from the wall-clock
column** — every block is entered on the same frame in every one. Item 8 is
fixed; see it.

Rooms that had to be cheated past — the same two every run. The wall-clock
tool cheated past **seven** on the same route (block 3 three times, then 5, 6,
9 and 28) in 153 instructions. Landing a whole volley on one exact frame,
rather than smeared across however many the browser happened to run, cleared
four of them; **block 3 was the fifth, and item 1 is why** — the camera was
aimed at a NaN, so nothing was in frame to shoot:

| block | step/op | wait |
|---|---|---|
| 9 | 6 / 5 | `0x44 wait_enemies_alive` |
| 28 | 5 / 7 | `0x44 wait_enemies_alive` |

Both of these have a **finite** camera aim, so they are not item 1 over again.
They are the next thing to read. `[open]`

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

## 1. The camera aimed at NaN — **fixed**, and block 3 clears

The tell was in the sidebar's camera group, and it is the whole answer:

```
eye        -837.9, 6.8, -572.2
look at    NaN, NaN, NaN
yaw        NaN° 0x0NAN
tracking   locked on an actor
```

The eye is fine and the path's own target is fine (`-763.3, 6.8, -581.6`).
What is NaN is `g_camera_lookat_target`, which is the point the fight is
supposed to be framed around — so the shot was never "parked facing a wall" in
the sense of a path that ran out. **It was aimed at nothing**, and a camera
aimed at nothing draws whatever happens to be in front of it. The flat olive
wall was the symptom, not the fault.

### Where it came from

`SkeletonEmitNode` records bone 1's world position into `obj+0x100`;
`SelectCameraLookAtTarget` (`FUN_00403050`) reads it; `TurnLookAtToward`
(`FUN_00403C00`) eases the aim onto it. One `undefined` read at the bottom of
that chain is a NaN in the camera at the top of it, and nothing in between
says a word.

The `undefined` was in `Poser.pose`. It had a **second entrance path**:

```ts
if (inst.a.intro) {
  const im = inst.type.motions[String(inst.a.intro.motion)];
  const t = inst.a.clock * im.fps - inst.a.intro.delay;
  this.apply(inst, im, Math.max(0, Math.floor(t)), false);   // no upper clamp
  return;
}
```

`obj.intro` is not a play state. It is the spawn **descriptor's** `+0x04` and
`+0x08` — which clip the entrance will play and how long it holds first — read
by `ZombieStateMotionCue21` every time it runs, and therefore kept for the
actor's whole life. Nothing clears it because nothing can. So the renderer drew
the van jump-out for ever, and `Math.max(0, ...)` clamps only the bottom: past
the clip's 41 frames it indexed off the end of `root` and posed `undefined`.

Caught in the act, forty frames past the end and two states after the
entrance had handed over:

```
apply at=0x1e00 state=3.2 f=45 frames=41 intro=923/0 motion=1022
```

The game had it walking on clip 1022 while the renderer drew clip 923.

### What the engine does

**There is no second channel.** The entrance is real — the van jump-out is
`zom.bin` 923 and the two stage-2 zombies do come out through the windscreen —
but the engine plays it by putting it in the ordinary motion.
`ZombieStateMotionCue21` (`FUN_004577F0`) sub 0 calls `ActorSetMotion`
(`FUN_00411930`), which writes the clip id to `obj+0x1B4` and zeroes the play
cursor at `obj+0x19C`; sub 2 hands over when
`g_motion_play_length[obj+0x1B4] - 1 <= obj+0x19C`. The motion block holds the
loop and the reaction, and that is all it holds.

`class30/play_cue.ts` already ported every line of that correctly. The renderer
simply was not reading it — so the fix is to delete the invented path, not to
add anything. `replay.mjs` shows the entrance running exactly as it should
once it does:

```
t=0.0s  MotionCue/0   motion=956     <- the spawn's clip, before sub 0 runs
t=0.2s  MotionCue/1   motion=923     <- ActorSetMotion put the cue in
t=0.5s  MotionCue/2   motion=923     <- playing it out
t=1.3s  AttackRun/0   motion=923     <- handed over at the end of the clip
```

### The check

`web/test/pose.test.ts` (`npm run test:pose`) drives every path through the
poser 600 frames past the end of every clip and asserts the arithmetic stays
finite, then asserts the two halves of this bug directly: an actor whose
descriptor names a cue clip poses `obj.motion` and not the descriptor's, **and
the entrance is still drawn** when the state machine has put it in
`obj.motion`. Watched failing on the old code: the first two go red, the third
stays green, which is the shape a fix that removes an invention should have.

### What is left

Stage 2 goes from **three** rooms that could not be cleared to **two**, and
block 3 — the one with the picture — now clears by shooting. Blocks 9 and 28
still do not, and they are **not** this fault: their aim is finite
(`slot 68 frame 51 / 260` and `slot 98 frame 766 / 870`, both with real
look-at points). Something else puts those enemies where the shots cannot
reach, and it wants its own investigation. `[open]`

Stage 1's block 4, the other case this item used to carry, now clears on its
own — see item 8.

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

`Walker.takeBranch` with no argument used to pick the **lowest** block number,
and before that to draw from `ctx.rng`. The engine's own selector is
`g_script_branch_var` (`0x009C88A4`) and had not been read.

**Closed.** It has been read, and the answer is that the engine does not have a
countdown at all: it reads the global at the instant the step list runs out and
goes. The global is written only by gameplay, and the writer the port reaches
is `CivilianRunScript`'s op `0x19` — `SetRouteBranch` — which eleven of the 136
shipped civilian streams run once the civilian is safe. So the branch is now
`next[g_script_branch_var]`, the pick is `0` when nobody was rescued, and the
1.5-second bar is declared as what it is: a port-only override window, with the
value **latched** when the branch is reached so gameplay during the pause
cannot change a decision the engine had already made. See
[`docs/formats/evt.md`](formats/evt.md#how-a-branch-is-decided) and
`tools/verify_branches.py`.

## 10. Class 0x30 has no death state

`GameUpdate` skips dead actors unless the handler sets `updatesWhenDead`, which
class 0x31 does and class 0x30 does not, so the zombie's death clip is played by
`ActorAdvanceMotion`'s `obj.death` instead of by a state. The consequence today
is that the permit release lands in `GameUpdate`'s dead-actor sweep rather than
where the engine keeps it — `ZombieStateDeath6` (`FUN_00454D20`) sub 1 calling
`ZombieReleasePermitAndUntrack` (`FUN_004565A0`). It is correct as it stands;
porting state 6 would move it home. `[open]`

## 11. Stages 3 to 6 have never been swept — **done**, and three stages hang

All six are in **All six stages, in one sweep** at the top of this file, with
the route, the instruction and the wait for each. Three of the six do not
finish: stage 2 at block 14, stage 3 at block 6 and stage 6 at its very first
gate. Two more need the debug clear on a room shots cannot reach.

None of the three is a `wait_script_flag`. Two are a counter at or below its
bound with the camera still holding, and one is a civilian counted alive after
it is dead.

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
a *render-only* one, not `ctx.rng`, or it becomes item 12 again.

**Closed**, 2026-09-03, as part of F14 in
[`REVIEW-2026-09-03.md`](REVIEW-2026-09-03.md). Both layers own an `Rng`
reseeded on stage load — `Shooting` in `reset`, `BreakableLayer` in `adopt` —
and `verify_layers.py` gained `no-math-random-in-render` at zero, watched
firing before it was believed. It is a separate generator from `ctx.rng`
exactly as this entry required, so item 12 is untouched and still `[open]`.

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
it is very probably the first.

**Closed**, in favour of the first explanation. Stage 2 block 3's record is
`next = [4, -1, 30]`: block 30 is **slot 2**, and every writer of a 2 in the
binary is behind `g_GameMode == 1`. Block 3's own trigger is a cat
(`CatBranchTriggerUpdate`), which writes 2 only in block 8. So in arcade
nothing can answer block 3 with 30, and the recorded 3 → 30 describes a route
the game does not have in the mode the harness runs.

**The unattended route has moved, and moved a long way.** `Math.min` and
`next[0]` disagree at the very first branch of both stages, so a harness run
that rescues nobody now takes:

```
stage 1   0 -> 1 -> 10 -> 3 -> 4 -> 6 -> 11 -> 14 -> 15 -> 16 -> 17
stage 2   0 -> 11 -> 12 -> 13 -> 14 -> 15 -> 16 -> 35 -> 36 -> ... -> 42
```

That is the **failure** road through both stages, and it is the right answer:
nothing was rescued, so nothing asked for the other one. Stage 1's block 1 is
reachable the other way today — its trigger is a class 0x10 civilian and the
port runs her script — but stage 2's block 0 is not: its trigger is class
0x21, which is unported. Any recorded route in this file or in
`docs/PLAYER_PROGRESS.md` from before this change describes the old rule.

## 17. Stage 2 block 14 and stage 3 block 6 — **not hangs**, the harness would not shoot

Both were reported as hangs on `wait_scripted_actors` and neither is one.

```
stage 2  block 14  step/op 9 / 20   g_civilians_alive 0 · need <= 0
                                    "Nothing alive is holding it —
                                     the camera gate (g_camera_free 0) is."
stage 3  block 6   step/op 1 / 13   g_civilians_alive 1 · need <= 0
                                    0x5294 hito_mario2 · dead · enemies-present
```

**What was actually there.** Stage 2: two live class-0x30 zombies,
`char_adv02` at 220 hit points in `BackOff` and `char_adv00` at 100 in
`HoldAtRange`, plus two civilians already out of the count (`sub+0x04` bit 0
set). Stage 3: `hito_mario2` dead but still counted, her killed script parked
on wait bit 0 (`enemies-present`), and her two `znkage` captors alive at 90 hit
points each. In both, the blocker is **live enemies**, and the harness's rule
was *never shoot at a civilian gate*.

**The opcode says so.** `EvtOpWaitScriptedActors46` (`FUN_0045FCD0`) is
`[proved]`:

```c
if (g_evt_yield == 0) { g_evt_yield = 1; return; }
if (g_civilians_alive <= operand && g_evt_gameplay_live && g_camera_free) {
    g_evt_yield = 0; pc += 8; return;
}
```

and `g_camera_free` (`0x009C6F2D`) is recomputed every frame by
`CameraDriverFromDeferredPose` (`FUN_00402E00`) from the **four** slots at
`0x009A5EC0..0x009A5EE0`. Those are filled by `UpdateCameraEnemySlots`
(`FUN_00408DD0`) from the candidate list, and the candidates are the actors
whose class called `ActorRegisterCameraPoint` (`FUN_00409B70`) — which ends
`PUSH ESI / CALL 0x00408ec0` at `0x00409bec`–`0x00409c03`, past the tail call
Ghidra's decompiler stops at, so the xref list at `RegisterForCameraTracking`
does not show it. `EnemyZombieUpdate` (`FUN_004533F0`) makes that call with a
4.0 lift on every frame of every live zombie.

So a 0x46 gate in a room with live zombies is held by the **zombies**. The
civilian's own VM says it twice over: `CivilianStepScript` (`FUN_0048B1E0`)
has wait bits for `g_enemies_present` and `g_enemies_alive`, and stage 3's
blocker is parked on the first of them.

**Fixed in the tool.** `playthrough.mjs` fires at a civilian gate too, and
refuses only when the gate's named blocker is a civilian who is still **alive**
— which is the case the old rule was written for and the only one where
shooting would hide something. Both stages reach an end block with no room
needing the debug clear.

The port needed no change for either. Recorded because "the tool will not do
the thing the engine requires" looked exactly like two count leaks, and two
sessions could easily be spent on `combat/counts.ts` before anyone measured the
hit points of the actors standing in the room.

## 18. `ActorKillAll` killed what a shot could not — **fixed**, and it was stage 6

Stage 6 block 0 `4 / 8`, `0x44 wait_enemies_alive`: `g_enemies_alive 1`,
`g_enemies_present 1`, `g_camera_free 1`, and the sidebar naming nobody.

The holder was `0x099C` — a class-0x31 `zslman`, `dead` with 0 hit points and
`ActorFlag.Dead` up, cycling `RestoreBothHands` → `Throw` → `WaitForPermit` →
`Pounce` as a corpse, with `ThrowerFlag.LeftAlive` and `LeftPresent` both
clear. It had never been shot: `hits` and `latched` were empty. It was killed
by the harness's **debug clear** while it sat in `ThrowerStateKnockedTumbling`
(`FUN_00450E40`) sub 4, where `ActorFlag.ShotImmune` is up.

`DispatchHit` (`FUN_004092F0`) refuses `ResolveHit` outright on that bit, so in
the engine an actor cannot reach zero hit points inside the window — and both
enemy classes lean on that. `ThrowerOnShot` (`FUN_004499A0`) gates its whole
response on it (`004499f5 f6c401 TEST AH,0x1` / `004499f8 JNZ 0x00449af6`, the
routine's tail, so the dead arm at `00449a3e` is past it); `ZombieOnShot`
(`FUN_00453EB0`) is the same pair at `00453ec7`/`00453eca`. An actor killed
from outside while shot-immune is therefore **dead and never told**: its death
chain never opens, and the chain is the only thing that runs
`ThrowerReleaseSlotOnDeath` (`FUN_0044D050`) or
`ZombieReleasePermitAndUntrack` (`FUN_004565A0`) — the two routines that take
it out of `g_enemies_alive` and out of `g_enemy_slots`.

One line in `ActorKillAll`, beside the `ClassHandler.invulnerable` test that
already carried the rule: refuse `ActorFlag.ShotImmune`. Nine assertions in
`web/test/port.test.ts`, six of which fail with the line backed out.

**Two diagnostics that were wrong, and cost time — both fixed.** The sidebar
printed *"Nothing alive is holding it — the camera gate (g_camera_free N) is"*
whenever `waitBlockers` was empty, **including when the camera was free** and
the counter was what held the gate: it named the camera as the blocker while
showing `1`, the free value. It now says which of the two is above the line,
and on the third case — counter satisfied, camera free — says the gate should
pass next frame. And the tool's *"the enemies are somewhere the shots cannot
reach"* was an inference, not a measurement; it prints the blocker rows now,
and they say who and how far. See item 19 for what they say.

## 19. Rooms the shots do not clear — **all five read**, three retired

The five gates the playthrough tool had to use its debug clear on. Item 19 left
all of them `[open]` with a measurement and no reading; every one has now been
read in the exe, and they are **three different faults**, not one.

| stage | block | step/op | who is left | verdict |
|---|---|---|---|---|
| 6 | 0 | 4 / 8 | 3 × `zslman` at `d=49..101` | **slow** — `[not-a-bug]`, the tool |
| 6 | 1 | 3 / 17 | 2 × `zslman` at `d=56..90` | **slow** — `[not-a-bug]`, the tool |
| 6 | 3 | 2 / 13 | 3 × `zslman` at `d=74..101` | **slow** — `[not-a-bug]`, the tool |
| 5 | 2 | 2 / 50 | 3 × `znnick` in `DelayedStrikeInPlace` at `d≈2870` | **unkillable** — an undeclared consequence of a declared `[diverges]` |
| 1 | 1 | 8 / 6 | `0x1868`, a class-0x10 captor, `140/140` | **unkillable** — the script has firing off. Cause `[open]` |

### Stage 6, three rooms — slow, and the tool was measuring the wrong thing

`[proved]`, and it is not "probably just slow for a grid spray" as the previous
note guessed. `zslman` is class 0x31 character type 0x18, and `ThrowerOnShot`
(`FUN_004499A0`) sends it to `ThrowerStateKnockedTumbling` (`FUN_00450E40`) for
every hit. That state raises `ActorFlag.ShotImmune` at its landing
(`LAB_004512E2`) and again on the way out, where it also writes
`obj+0x133C = 0x14`; `DispatchHit` (`FUN_004092F0`) refuses `ResolveHit` while
the bit is up, and `EnemyThrowerUpdate` (`FUN_00449910`) is the only thing that
takes it down. **One shot lands per knockdown cycle**, so the clear time is set
by elapsed frames and not by rate of fire.

## 20. Stage 5's two flag-30 gates cost a whole enemy, not a flag write

`script/waits/flag.ts` excuses four flags now, and every one of them belongs to
an unported **enemy** class. The last prop went with `class41/flag_prop.ts`,
which raises flag 20 and lets stage 4's block-2 gate be honoured.

Class 0x32 was picked up as one of "the two smallest remaining writers" because
`Class32StateRaiseFlagAndLeave` (`FUN_00480470`) is short and was already
named. Reading how an actor *reaches* it says otherwise:

```
Class32StateWaitCamAndFlags   [0]  g_cam_path_frame > 0x256, then flags 22 and 23
Class32StateMoveToFixedPoint  [1]  145 frames of interpolation to (579, -65, -8832)
                              [5..11]  the combat loop -- 0x0047CA50, 0x0047D220,
                                       0x0047D410, 0x0047D5E0, 0x0047D890,
                                       0x0047DD50.  None of them read.
Class32OnShot (FUN_0047CC20)       obj+0x34 bit 26 up      ->  state 2
Class32StateDeathSequence     [2]  the death clip           ->  state 3
Class32StateDeathRetire       [3]  give back the counters   ->  state 4
Class32StateRaiseFlagAndLeave [4]  five subs, ~300 frames   ->  g_script_flags[30]
```

`0x0047CC61` is the **only** write of state 2 in the image and bit 26 is the
dead bit, so the chain starts on the frame the actor's hit points run out.
Stage 5's two spawns carry **450** of them. Class 0x32's code runs from
`0x0047C960` to about `0x00480800` and its state table has thirteen entries.
That is a full enemy port on the scale of class 0x30 or 0x31. `[proved]`

**It is deliberately not started, and declaring the flag without it would make
things worse.** Stage 5 reaches an end block today *because* the two gates are
excused; an honest `raisesScriptFlag: 30` with no actor behind it turns a
completing stage into a hang at block 7 step 4. That is the choice, and it is
the user's:

1. port class 0x32 as an enemy, on the class-0x30 pattern, and the two gates
   become real; or
2. leave the escape in place and let stage 5 keep finishing on it.

Everything read on the way is named in `ghidra/annotations/functions.tsv`
(`Class32Update`, `Class32OnShot`, `Class32StateWaitCamAndFlags`,
`Class32StateMoveToFixedPoint`, `Class32StateDeathSequence`,
`Class32StateDeathRetire`) so whoever takes option 1 starts from the state
machine rather than from the table.

### Stage 4's gate is on a route the playthrough has never taken

Worth knowing before anyone measures the flag-20 work by running stage 4: the
gate is in **block 2**, and block 1's branch record is `{3, 2, -1}` with the
port answering 0. The playthrough goes 0 → 1 → 3 → 10 → … and block 2 is not
on it. The port change is pinned by `web/test/port.test.ts` — nine assertions
fail with it backed out — and by
`node tools/run_ts.mjs tools/flag_gates.ts`, which reads the shipped bundles
and says stage 4's held set goes `{19,29,248,254}` → `{19,20,29,248,254}`.
What answers block 1's branch is `[open]`; no class-0x41 branch trigger is
placed in it.

---

---

## 17. `playthrough.mjs` stops on **entering** an end block, so stage 4's boss fight has never been run

The success test is one line, `web/tools/playthrough.mjs`:

```js
if (/\(end/.test(s.block)) { ...  "reached an end block"; break; }
```

`s.block` is the *route* of the block the walker is standing in, and stage 4's
boss blocks — 23, 25, 27 and 29 — **are** its end blocks. So the tool declares
stage 4 complete on the first poll after the walker steps into block 25, which
is step 1 op 8, and stops. The boss's own gates are at ops 53 and 61 of that
same step:

```
      @7095 6  (goto → 25) step 2 / 25 :: wait_queued_events_done
      @7125 25 (end → 0)   step 1 / 8  :: wait_camera_path_frame — 77 left
reached an end block after 7125 game frames
```

Consequences, all measured on 2026-09-08:

* Stage 4 reports the **same 7125 frames** before and after class 0x19 was
  ported, and the same 7125 with the port's `g_script_flags[31]` write deleted.
  Three runs that should have differed and could not.
* Every instruction of stage 4's boss fight — 147 ops of block 25's step 1,
  including both of the gates this tool exists to catch — has never been
  executed under it. The same is true of block 23, 27 and 29, and of any other
  stage whose last block is also a fight.

This is not a hang. It is the opposite: **a stage the tool cannot fail.** The
fix is a decision about the tool's contract rather than a bug to patch — "the
stage reached an end block" and "the stage ran to the end of its script" are
different claims, and only the second is what a playthrough is for — so it is
recorded here rather than changed under three concurrent workstreams.

Until it is, the evidence for anything inside a terminal block has to come from
`web/test/port.test.ts`, which is where class 0x19's gate chain is asserted.
## 17. A boss gate is a room clear the harness will not shoot at

**Open, and it is a decision rather than a bug.**

Class 0x14 -- the stage-2 boss -- is ported, so stage 5 block 3's
`wait_script_flag 31` is now a gate the port can evaluate and therefore one it
honours. The only thing that opens it is the boss **dying**:
`Class14ApplyBoneDamage` (`FUN_004763E0`) takes the last of its 200 hit points,
puts it into `Class14StateCuedMotion`, and that state's own frame cue reads the
phase and raises 31.

`tools/playthrough.mjs` fires only when the walker is parked on a
`wait_enemies_alive`/`wait_enemies_present` gate -- `policy === "enemies"`. A
boss's gate is `0x45`, so the tool sits and watches:

```
node tools/playthrough.mjs --stage 5 --headless
  ...
  f  4845  block 3  (goto -> 4)
  HUNG at block 3 step/op 1 / 22   0x45 wait_script_flag   policy: flag
```

That is **further from the end than the same stage was** when the gate was
excused, and it is not a fault in the port: the boss is on the field, posed,
swimming its route and running its state machine (the hang screenshot shows it
filling the frame), and the shots simply never come.

`--shoot-flag-gates` is the opt-in, and with it the stage plays through:

```
node tools/playthrough.mjs --stage 5 --headless --shoot-flag-gates
  reached an end block after 7995 game frames, 79 instructions
```

**Why it is not the default.** The grid spray cannot aim. Stage 3 block 2's
`wait_script_flag 0x1E` is the hostage's, and flag 30 comes off *either* of her
streams -- `entries[27]` -> stream 64 when she is rescued, stream 63 when she is
shot. A tool that sprayed that gate would open it by killing her, which is the
one thing the civilian rule exists to refuse, and would then report the stage as
playable. Narrowing the rule -- "shoot a flag gate only when the actors holding
it are enemies" -- needs a seam that says which they are, and the port has none.

Two changes went in beside the flag: a volley at a flag gate is 13x10 rather
than 5x4, because a boss is one actor with a handful of bone spheres eighty
units out and the coarse grid walked straight past it; and the **debug clear is
now run only for an enemy gate**, since it takes actors out of the counts a
`wait_enemies_alive` reads and killing one from outside its own death states
opens no flag at all.

---

Measured on the driven clock, hit points falling all the way:

```
f+ 60  2372 c49 s33.3 h95      ← 130 - 35, then straight into KnockedTumbling
f+210  2372 c49 s33.3 h60
f+330  2372 c49 s33.3 h15
f+720  e0 p0                   ← all three dead, the gate opens
```

420, 435 and 285 frames of shooting for the three rooms. The tool gave up at
**300**. It was not cheating harder that was wanted, and raising the window
would have excused stage 1 as well — so `--shoot-for` now counts frames in
which **nothing in the room took damage**, read off the drive seam's own row
(`g_enemies_alive` plus the hit points of every live class-0x30 and class-0x31
actor). A room being won slowly no longer looks like a room that cannot be won.
The same clock guards the hang deadline, so a long fight is not reported as
fifteen seconds on one instruction. See `docs/formats/combat.md`.

The port needed no change for these three. **Three of the five cheated rooms
were a measurement fault in the harness.**

### Stage 5 block 2 — unkillable, and the distance is not the bug

`[proved]`. The previous note asked why four `znnick` are at `d=2843..2898`
"and not where the script put them". They are exactly where the script put
them: block 2 step 2 op 38 spawns them at `(±4.6, 0..10, -16.5..7)`,
`FUN_00408a20` copies a descriptor's position verbatim with no transform, and
`ZombieStateDelayedStrikeInPlace` (`FUN_0045E830`) **never moves an actor** —
it is a stationary swing loop that never approaches and never leaves. Three of
the four have `initial_state 32`; the fourth is `initial_state 18` with
`attack_state 10` and retires on camera path frame 590 on its own.

The state has exactly one way out, at `0x0045EAFE`: `g_carrier_object`
(`0x009A5C34`) raising `obj+0x34` bit `0x40000000`, after which `obj+0x1334`
counts to `0x14` and the actor takes state 10, `ActorAbortAttackAndLeave`. The
object that raises it is `ScriptedCarrierUpdate33` (`0x004331D0`) — class 0x33
selector 1, which stage 5 block 2 step 2 op 37 spawns at evt `7396` — at
`0x00433280`. **Class 0x33 is unported**, so `g_carrier_object` is `-1` and
nothing can ever end the ride.

That divergence was already declared in `class30/scripted.ts` and in
`globals.ts`. What was not declared is that it makes a shipped room
unclearable, which is L26 exactly: a `[diverges]` note is what somebody meant,
and only a check says what the code does. Two things landed for it:

* the give-up tested `obj+0x136C` bit `0x40000000` — the right bit in the
  wrong word, where `ZombieFlag2.CollideActors` lives and where
  `EnemyZombieInit` seeds `0x60000000` on **every** class-0x30 spawn. It would
  have fired for any zombie that became the carrier and never for the class-
  0x33 one that is. Now `obj+0x34`, with both halves asserted.
* the sub machine returned early on its waits, so the give-up did not run on
  any frame the actor was counting a timer down — the exe's arms all reach
  `switchD_0045e899_default`. The state is split in two now: the switch may
  return, the frame may not.

**Still unclearable** until class 0x33 selector 1 is ported. That is the whole
remaining work for this room, and it is a vehicle: `0x004331D0` runs to at
least `0x00433830`, reads `tail+0x14/0x18/0x1C/0x20/0x21/0x24`, and would need
the descriptor tail in both halves of `hod2lib`.

### Stage 1 block 1 — unkillable, because the script has switched the gun off

`[proved]` for the mechanism, `[open]` for the cause.

The blocker is `0x1868`, a class-0x30 **captor** of the class-0x10 civilian
`0x1828 hito_fem`, built by `CivilianInit` (`FUN_0048A3E0`) from a descriptor
nothing in the evt points at. It sits at `140/140` for 3,000 frames across a
hundred volleys, with `flags 0x8040001` — **`ActorFlag.ShotImmune` is not
set**. The shots are not being refused by the actor. They are not being fired.

`g_nFiringGate` (`0x009C8E00`) is down. Block 1 step 6 op 3 issues
`hud_shutter_state 3`, and `HudDrawShutterState` (`FUN_00413970`) drops the
gate at `0x00413B06` when that close finishes counting; nothing raises it again
until step 9 op 1. The gate at **step 8 op 6** is inside that window, and
`ResolveShotRequest` returns before the ray exactly as
`PlayerFireAndReloadUpdate` does at `0x004149BE`. The screenshot says
`shutter closed` and the sidebar says `hp 140/140`; those two facts are the
whole of it.

Everything else about the room checks out against the exe:

* the captor **is** alive-counted — `FUN_00452DA0` increments both counters for
  any class-0x30 spawn whose character type is not 9 and whose initial state is
  not `0x1F`; this one is type 19, state 35.
* it **is** meant to turn on the player once its civilian dies.
  `ZombieTargetIsDead` (`FUN_0045C8A0`) itself calls `ZombieScriptEnded`
  (`FUN_0045C8D0`), which takes the descriptor's attack state — `1`,
  `AttackRun`, which is the commonest of the 114 captors in the game (54 of
  them). `ZombieStateTargetLostPause` (state 45) is a 10–20 frame pause that
  restores the stashed state, not a retirement.
* the gate itself is only `g_enemies_alive <= 0 && g_evt_gameplay_live &&
  g_camera_free && hysteresis > 0` — `EvtOpWaitEnemiesAlive44` (`FUN_0045FC10`).
  Every extra term makes it harder, never easier.
* it is not the cutscene skip. Measured with `Enter` suppressed: identical
  state, identical hit points.

So the engine reaches the same instruction with the same live enemy and the
same gate down, and the shipped game plainly does not stop there. **What
removes that captor from `g_enemies_alive` before step 8 op 6 is `[open]`.**
Leads not yet followed, in the order they look worth following:

1. the class-0x25 actor at evt `7340` (step 6 op 0) and the class-0x20 at
   `8088` (step 7 op 8), either of which may kill it — class 0x25's `op 18` is
   `ActorKill` and L34 is about exactly that arm being collapsed;
2. the civilian's own script, which is parked at pc 4 on
   `wait 0x8100080` — `CameraCue`, path 39 frame 60, a path the walker does not
   queue until step 8 op 9, *after* the gate;
3. `CivilianInit`'s child count for this spawn (tail `+0x0C`), against the exe
   rather than against the exporter — L6.

## 20. What the five rooms cost, and the two traps in measuring them

Written down because both cost time in the session that read items 17–19.

**A room's clear time is not a number of shots.** Under the driven clock a
volley of twenty clicks lands on one game frame, and against an enemy whose
shot response raises `ActorFlag.ShotImmune` exactly one of the twenty resolves.
Every measurement of "how hard is this room" has to be in frames of *damage*,
and the tool now is.

**A `[diverges]` can be true and still be the bug.** Stage 5's carrier note was
accurate, careful, and in two files. What nobody had done was ask which shipped
rooms depend on the thing it declares missing; the answer was one, and it had
been showing up as an unexplained `d≈2880` for two sessions.

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
