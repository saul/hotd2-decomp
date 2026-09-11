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

**A driven run takes one arm of every branch**, and which arm is the game's own
answer: `g_script_branch_var` as `advanceStepOrRoute` latched it, which with
nobody rescued is 0. (It used to be the lowest block number, a stand-in from
before the selector was read; see items 9 and 16.) So "the stage reached an end
block" means *one* road through it was played.

`--route` names the arm to take at a branch, and it is how stage 2's blocks
1-10 and 21-32 came to be executed for the first time — see item 25:

```sh
node tools/playthrough.mjs --stage 2 --route 0:1,1:2,3:4,5:6,6:7,7:8,8:10
```

Each rule is `<block>:<target>`. For each one the tool **plays for the arm
first**: while the walker is inside that block it fires the same volley the
gates get, because every writer of `g_script_branch_var` in the image is actor
code and shooting is how an arcade player writes it. On stage 2's block 0 that
kills the class-0x21 rescue target and the branch bar comes up with the other
route already marked as the game's own. The volley is refused while
`g_civilians_alive` is anything but zero — the same refusal `shootable` makes,
read from the counter because inside a block there is no gate to read.

Only if the game still has not written the arm does it **click** the player's
own override on the branch bar, and then it says so: an override can leave the
world in a state the engine cannot reach, and a hang behind one is not evidence
about the port until that state has been checked. Item 25 has the case that
proves it. Every branch prints the arms, the arm the game chose, and the arm
taken; the run ends with one `route:` line for the whole road.

### All six stages, as of items 17 and 18

`node tools/playthrough.mjs --stage N --headless`, one after another on an
otherwise idle machine. **All six reach an end block.** The two sections
below this one predate the branch rule and describe routes the tree no longer
takes — see item 16.

| stage | end block | frames | instr | rooms the shots did not clear |
|---|---|---:|---:|---|
| 1 | 14 `(end → 0)` | 8280 | 94 | block 1 `8 / 6` |
| 2 | 35 `(end → 0)` | 12120 | 146 | — |
| 3 | 13 `(end → 4)` | 6210 | 59 | — |
| 4 | 25 `(end → 0)` | 7125 | 83 | — |
| 5 | 7 `(end → 0)` | 7500 | 79 | — |
| 6 | 12 `(end → 0)` | 7245 | 63 | — |

Stage 5's row was `7875 / 78 / block 2 2 / 50` until class 0x33 was ported;
that room is the second section below. **Stage 1 block 1 is the one left**, and
it is the only room in the game a player cannot clear by shooting.

**Re-measured after items 26 to 30**, because the strict camera wait of item 30
costs a frame at every `wait_camera_path_frame <n>` in the game and so moves
every stage's count. All six still reach an end block, and none reports a room
the shots could not clear. Stage 1's block 1 is no longer among them — its room
clears and the block branches to 10 — but that is somebody else's commit and
not this measurement's to explain:

| stage | frames | instr | against the row above |
|---|---:|---:|---|
| 1 | 8190 | 97 | −90 |
| 2 | 12495 | 148 | +375 |
| 3 | 6615 | 61 | +405 |
| 4 | 7065 | 84 | −60 |
| 5 | 7560 | 79 | +60 |
| 6 | 7260 | 63 | +15 |

**That table is one route per stage, not one stage per row.** Stage 3 has two
entry blocks and stage 4 has two, and until item 21 the harness had no way to
name the second: `--entry` did not exist. Ten of the twelve routes above were
never played. Stage 3's block 2 is not on the entry-0 route at all — block 0
branches to block 3 under the lowest-block rule — so a whole block of shipped
script had never been executed by anything, and it held two hangs:

```sh
node tools/playthrough.mjs --stage 3 --entry 7 --headless
```

| route | reaches | note |
|---|---|---|
| stage 3 entry 0 | block 13 `(end → 4)`, 6480 frames | 0 → 3 → 4 → 5 → 6 → 13 |
| stage 3 entry 7 | block 13 `(end → 4)`, 6390 frames, 66 instr | 7 → 8 → 2 → 11 → ... Items 21 and 22, **both fixed** |
| stage 4 entry 4 | block 25 `(end → 0)`, 6090 frames, 72 instr | 4 → 9 → 11 → 10 → 12 → 13 → 6 → 25. Item 23, **fixed** |

**Both second entries reach an end block now.** Stage 3's was items 21 and
22 — the flag-21 switch, then the death clip no bundle baked. Stage 4's was
item 23: state 43's tail, which the port did not have. So every route the
`entries` tables name plays through, and every stage has exactly one entry
except these two, so there are no more routes hiding — but the four entry-0
rows above have never been re-run per *branch*, and a branch is not an entry.

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

Off screen, not in mode 2 (Training), holding no children: it leaves on the spot and takes
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

### Stage 5 block 2 — **fixed**: the carrier exists, and state 10 is a despawn

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
counts to `0x14` and the actor takes state 10 (`0x0045EB20` writes
`obj+0x1310 = 10`). The
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

**It clears now.** Two things had to be true and only one of them was known.

**One — class 0x33 selector 1 is ported** (`game/class33/`), which is
`ScriptedSceneryDispatch33` (`FUN_00432FF0`), `ScriptedCarrierUpdate33`
(`FUN_004331D0`) and `ScriptedCarrierStepPath33` (`FUN_00433860`), the last of
which had no name until this session. `[proved]` it is a **vehicle that drives
in and burns**, from the four sounds resolved through `g_se_name_list`:
`DRIVE_DEAD2_22.wav` when it is seated, `DRIVE_DEAD2_22_OFF.wav` at its effect
frame, `CAR_FIRE_22.wav` twenty frames after that and `CAR_FIRE_22_OFF.wav` as
it leaves. Two loops with their off halves. That also settles `rigs.py`'s
`[likely] fire or smoke` on the `0x1AAB`..`0x1AD2` strip it swaps to.

Its clock is the piece worth writing down: `obj+0x1370` is seeded to
`g_cam_path_frame - 1` on the object's **first** frame and stepped by a literal
`1.0` per frame after that, so it is not the camera's frame and the two cues
that read it are not camera cues. Stage 5's descriptor (evt `0x1CE4`) fires the
effect — and bit `0x40000000` — at cursor 580, having been spawned at camera
frame 231. Three hundred and forty-nine frames of ride, then twenty-one of
counting.

**Two — `g_class30_states[10]` is `ZombieReleaseAndDespawn` (`FUN_00455490`)**,
which releases both counters, releases the permit and despawns. The port had no
`case` for state 10 and sent it through the dispatch's `default` to
`ZombieGiveUpAttack`, which routes to `WaitTurn` and keeps the actor alive.
`class30/states.ts` cited `ActorAbortAttackAndLeave` (`FUN_0045D9F0`) for that
index, and that address is not in the table at all — it takes no argument and
assigns no state. The dword at `0x00592AE8 + 0x28` is `90 54 45 00`, and its
neighbours agree with the enum either side, so the indexing is not adrift.

Without the second half the first would have released nothing: all four
`znnick` would have gone to state 10 and stood in `WaitTurn` for ever, which
is what the fourth (`0x1DD4`, `attack_state 10`) was already doing before any
of this. **Two causes, one symptom** — reverting either half leaves the room
shut, and `web/test/port.test.ts` has both counterfactuals.

Measured, `node tools/playthrough.mjs --stage 5 --headless`:

```
before   f 3435 block 2 ... 2 / 50 took 66 volleys over 480 frames without one
                            point of damage landing anywhere in the room
         1 rooms could NOT be cleared by shooting
after    f 3435 block 2 (goto → 3)   f 4365 block 3 ...
         reached an end block after 7500 game frames, no room reported
```

Not ported, and named rather than left implicit: the other ten class-0x33
sub-handlers; `RegisterForShotTest` (`FUN_00405160`) at `0x004334D0`, which is
what makes the carrier shootable; and the whole draw from `0x00433463` to
`0x0043382F`. That draw is `L37` in the raw — Ghidra's pseudocode for
`ScriptedCarrierUpdate33` **ends at `0x0043345E` with a `return` the code does
not have**, and nine hundred and seventy bytes of the routine are invisible in
it. `tools/hod2lib/rigs.py` had already read them by hand as `obj_4331d0`.

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

## 21. Stage 3's block 2 waits on an actor the port did not run — **fixed**

```sh
cd web && node tools/playthrough.mjs --stage 3 --entry 7 --headless
```

`--entry` is new, and that is half the item: the harness could only ever run a
stage's **first** entry block, so of stage 3's two routes and stage 4's two it
had played one each. Stage 3's block 2 is on both of stage 3's routes and
**neither entry-0 run ever reached it** — block 0 branches to block 3 under the
lowest-block rule — so this block had never been executed by anything.

```
HUNG at block 2  (goto → 11) step/op 3 / 4
  1110 game frames (18.5s) on one instruction
    0x45 wait_script_flag        script flag arg set      policy: flag
```

5/5 before, 5/5 after — deterministic under the driven clock.

**What holds it.** The instruction is `45 wait_script_flag 0x15` at evt
`0x0029E8`: flag **21**. Step 3's op 1 is `48 set_script_flag 0x18`, flag 24,
which is a different flag and a red herring — it belongs to the *other* writer
of flag 21, below.

The room is empty when it parks: 0 enemies alive, 0 hit points, 66 volleys over
480 frames with no damage anywhere. The screenshot
(`web/shots/hang-stage3.png`) renders correctly — the canal, the boat's prow,
the steps, the camera parked at `cp_st3[5] 590/590` — so this is not item 1's
fault class. Nothing in the room was ever going to open it.

**Where flag 21 comes from.** The premise this was reported under — *every one
of the ~40 gates names a flag that stage's own script never sets* — is not true
here. Stage 3 **does** set flag 21, in **block 1 step 5** (evt `0x001D00`), and
block 1 is on the entry-0 route only. On the entry-7 route (7 → 8 → 2) the
script never sets it, and the flag comes from an **actor**:
`StoryModeSwitchUpdate` (`FUN_00474F30`), the class-0x44 selector-17 object
`PlaceStoryModeSwitch` (`FUN_00473A70`) builds. `[proved]`

```c
if (obj->+0x2A4 >= 0 && g_script_flags[obj->+0x2A4] == 1) { ActorDespawn; return; }
if (g_scene_index == 1) {
    if (g_script_flags[0x77] != 0) { ActorDespawn; return; }
} else if (g_scene_index == 2 && g_evt_block_index == 2
           && obj->+0x192 == 0) {
    g_script_flags[0x15] = 1;                      // 0x00474FA6
}
if (g_GameMode != 1) goto draw;                    // 0x00474FB4
```

**The write is above the mode gate.** `0x00474FA6` writes the flag and the
`CMP dword [0x009CA08C], 1 / JNZ` that gates everything else is at
`0x00474FB4`, seven bytes later — confirmed by disassembling the head, not
only by the pseudocode. So the switch raises flag 21 every frame in Arcade as
well as Original, while it stands in scene 2 block 2 and has not been thrown.
Stage 3's switch is the one **block 7 step 8** spawns (evt `0x3630`); its
`obj+0x2A4` removal flag is 22, which block 2 step 3 raises at its own end, so
the same step that the switch opens also takes it away.

**Why the port did not.** `class41/branch.ts`'s `StoryModeSwitchUpdate` opens
with `if (G.g_GameMode !== GameMode.Original) return;` — correct for the
routine's body and wrong for its head — and its doc comment listed *"the
`g_script_flags[0x15]` it raises there"* among the things not transcribed. That
is **L26** exactly: a divergence described in prose, never pinned by an
assertion, and therefore never looked at. The whole of the head that sits above
the mode gate now lives in `StoryModeSwitchPoolUpdate`, where the two despawn
tests already were, and the scene-2 arm is written as the `else` of the scene-1
one because in the engine it is.

**The checks, and there are two halves.**

* `web/test/port.test.ts` — the switch raises `g_script_flags[0x15]` in scene 2
  block 2, **in Arcade and in Original**, does nothing in another block, does
  nothing in scene 1, stops once thrown, and loses to its own removal flag.
  Backed the write out and watched two of them go red.
* `web/tools/flag_gates.ts` grew a **route pass**: `entries` → `route.next`,
  and every gate no `set_script_flag` on the route to it can open. It asserts
  that stage 3's block-2 flag-21 gate is one of those on entry 7 and **not** on
  entry 0, and that the switch which raises it is placed in a block that entry
  can reach and which can reach block 2 (`{7}` of the stage's `{3,7,9}`). It is
  now a row in `verify_all.py`. The work-list it prints for the other eleven
  bundles is worth reading: every `0xF8`, every `0xFE`, stage 4's `0x1F`/`0x20`
  and stage 5's `0x00`/`0x1E` are gates an actor holds.

**What is still out.** The *second* write of flag 21, at `0x004751B1`: in
Original Mode, once the switch has been thrown and `SpawnStoryModeItem`
(`FUN_00467B90`) has run, the routine waits for `g_script_flags[0x18]` — which
is what block 2 step 3 op 1 sets — and then counts `obj+0x2B0` past `0x4C`
before raising the flag. Not ported, because the item spawn is not. It is
reachable only by a player who throws that switch, which for stage 3's needs
`PlayerHoldsOriginalItem` of item 0 or 6 (`obj+0x1FC` is 0, not -1), so the
harness cannot reach it — but a player in Original Mode carrying one can, and
they would hang. `[open]`

**And the class does not declare the flag** to
`ScriptFlagsThisBundleCanRaise`. It could not honestly: the answer depends on
`g_scene_index`, and `ClassHandler.raisesScriptFlag` is handed a spawn record,
so a class-wide or per-record `0x15` would claim it for stage 1's, 2's and 5's
switches too, which cannot raise it. Nothing observable turns on it — stage 3
is the only stage that gates on 21 and its script sets it — so the honest
answer is to leave it undeclared and say why. `[open]`

## 22. Stage 3 block 2 step 6: two zombies parked in state 12, and `g_enemies_present` never falls — **fixed**, by baking the clip

Found **behind item 21**: with the flag gate open, the entry-7 route advances
four instructions and stops again, 5/5.

```
HUNG at block 2  (goto → 11) step/op 6 / 8
  0x46 wait_scripted_actors    scripted actor count <= arg   policy: civilians
  g_civilians_alive 1 · need <= 0
  0x32A4 hito_mario2 · dead · enemies-present · d=22
```

It looks exactly like item 17, and it is not item 17. The counters at the hang,
off the drive seam: **`e0 p2 v1`** — `g_enemies_alive` 0, `g_enemies_present`
**2**, `g_civilians_alive` 1.

The chain, all of it measured:

1. The dead civilian's killed script is parked on `CivilianWait.EnemiesPresent`,
   which holds while `enemiesGoal < g_enemies_present`. With two present it
   holds for ever, so she never leaves `g_civilians_alive`, so
   `wait_scripted_actors 0` never comes down.
2. `g_enemies_present` only falls in `ZombieEnterCorpseState` (`FUN_00456740`),
   when the death clip finishes — `ReleaseEnemyPresentCount` (`FUN_00456580`).
   The two enemies still counted are `0x3078` and `0x6544`, class 0x30, dead
   with negative hit points, both parked in **state 12 sub 1**.
3. State 12 is `ZombieStateDeathFallAndBounce` (`FUN_00456DF0`) — `[proved]`
   from `g_class30_states` (`0x00592AE8`) index 12 being `0x00456DF0`, with 11
   and 13 either side agreeing with the port's enum. Its sub 1 is
   `if (obj->+0x19C < 0x3C) return;`, and `obj+0x19C` is the play cursor.
4. In the exe that cursor reaches 60 on the first pass, because
   `g_motion_play_length[0x3F9]` is **85** (read at
   `0x004E07D0 + 0x3F9*2 = 0x004E0FC2`, value `0x0055`).
5. In the port it never moves. `MotionPlayFrame` returns `0` when
   `MotionOf(actor, clip)` is null, and **no character type in any of the
   twelve shipped bundles has motion 1017 baked** — checked across all six
   stages and both modes. `ChooseDeathMotion` (`FUN_004560B0`) gives clip
   `0x3F9` to any class-0x30 actor with `obj+0x34` bit `0x1000000`, with no
   character-type guard, so the port is right to send them there and then has
   no clip for them when they arrive.

So no actor in the port can ever leave state 12, anywhere, and every one that
enters it holds `g_enemies_present` for the rest of the stage. Stage 3's
block 2 is the first room where that blocks a gate, because it is the first
room where a `wait_scripted_actors` sits behind two stand-and-throw zombies.

### The fix: bake the clip, and it did not need a divergence

**It decodes, 19 of 19.** The refusal in `bake()` is the measurement, and it
refuses nothing: motion 1017 lives in `zom.bin`, its block implies **16 bones**
and declares **44 frames**, and `g_motion_play_length[0x3F9]` is **85**. Every
one of the nineteen class-0x30 character types in the twelve bundles is
16-bone, so `bake` accepts 1017 for all nineteen — and the same is true of
`0x3F8`, the landing clip state 12 cuts to, and of the four other arms below.

**Why it was not baked: by omission, and the omission has a name.** The bake
set is a hand-enumerated list per class and per state in
`hod2lib/characters`'s `entry_clips`, and the death half of it was
`death_motions(tables)` — the two directional tables — plus the two `.text`
immediates 991 and 992. That is `ChooseDeathMotionDirectional`
(`FUN_00456220`) and nothing else. `ChooseDeathMotion` (`FUN_004560B0`) has
**ten** arms, and `combat.py`'s own docstring had said for months that the
other six were "**not** implemented" — which was true of the port's *branches*
and had never been true of the exporter's *bake list*, because the port does
take four of them.

`CLASS30_DEATH_CLIPS` in both halves of `hod2lib/charmotion` is now the six:

| clip | the arm that names it | what it was costing |
|---|---|---|
| `0x3F9` | `obj+0x34` bit `0x1000000`, tested at `0x004560DD`, no character-type guard | the hang |
| `0x3F8` | `ZombieStateDeathFallAndBounce`'s landing cut | the pose after it |
| `0x404` / `0x41A` | body condition 4's coin toss, `0x004561EA` | stage 2's `znkager` crawlers had **no death animation at all** — `play_length` 0 makes `cursor >= play - 1` true on the first frame, so they snapped to a corpse. A second bug, found by the check rather than by a report. |
| `0x3DA` / `0x3DB` | condition 4's special arm, conditions 5–6 | already there through the directional tables; offered so the set is what the routine can reach |

**Baked per character type, not per spawn**, and that distinction is the whole
of why the reproduced hang would have survived a narrower fix — see the next
item.

**The four destroyed-part arms are deliberately still out** — `obj+0x1368`
bits `0x8`/`0x10`/`0x40`/`0x80` giving `0x1AC`, `0x1A5`, `0x279`, `0x229`. All
four decode at 16 bones; nothing in the ported call graph raises any of those
bits. Written down in `verify_death_clips.py` as the check's blind spot rather
than left implicit, because that is the shape of gap that hid stage 5's van
from `verify_prop_slots.py`.

**Where the bit actually comes from, which nothing had read.** `obj+0x34` bit
`0x1000000` is **seeded from the spawn record**: `ActorInitFlags`
(`FUN_00408970`) ORs the record's `+0x04` word with 1 into `obj+0x34`, and
**22 placements across the twelve bundles carry it, every one of them class
0x30** — stage 1's three state-26 leapers plus one state-37, and stage 3's two
state-33 axe men plus five state-37. State 37 is `ZombieStateCarryProp`
(`FUN_0045B380`), which is the corroboration that the bit means *this actor has
hold of something*: every record that sets it is an actor carrying, leaping
with, or standing holding a thing. So the engine's route into state 12 is real
and shipped, and the clip belongs in the bundle whatever else is true.

**The checks, and both halves failed without the fix.**

* `tools/verify_death_clips.py`, new and a row in `verify_all.py`: **14,472 of
  14,472 (spawn, death clip) pairs baked** over 804 class-0x30 spawns and 68
  (bundle, character type) pairs, read out of the **real bundles** rather than
  out of the exporter — `verify_scripted_clips.py` asks the Python half and
  that is right there; here it would be `L24`, since the TypeScript half is the
  only writer of a bundle and the two have drifted before (`FROG_CLIPS` is in
  one and not the other). Mutated the `cls === 0x30` guard to `&& false`,
  re-exported stage 3 and watched **672** pairs go red in that one bundle.
* `web/test/port.test.ts` gained the other half. The existing state-12 block
  now also asserts that `g_enemies_present` is **held for the whole fall** and
  given back at the corpse; a new block gives a character type every clip
  *except* `0x3F9` and asserts that its actor is still in sub 1 after 600
  frames with the count leaked — so a future attempt to clear this by
  short-circuiting the wait, by special-casing a missing clip, or by making
  `MotionPlayFrame` answer for a clip it has not got, fails there rather than
  looking like a fix. And the fixture's `0x3F9` now pins `play: 85` rather
  than deriving it: setting it to 40 reproduces the shipped bug inside the
  test, three assertions red.

**And it renders.** Character type 19 posed from motion 1017 at frames 0, 12,
24 and 40 — `extract/compare/death12/t19_1017_f*.png`, by
`tools/export_character.py 19 --motion 1017 --frame N` through
`tools/blender_nodeview.py`. Frame 0 is the axe man standing with an axe in
each hand; frame 40 has him doubled forward with both weapons still held, which
is what a death clip for an actor that has hold of something should look like.
Fifteen bones, fifteen meshes, no exploded parts and no denormals: the clip
belongs on this rig.

**5/5 before, 5/5 after.** All five runs now reach block 11 `(end → 0)` over
66 instructions, at the same frame count every time, so this route is
deterministic under the driven clock. It was **6,300** game frames on the
branch and **6,390** after merging `main`, which moved the hit voice and three
prop poses: the count is a property of the tree and not of the route, exactly
as it was for entry 0 at `0953161`. Re-measure it rather than quoting it.

**Is the leak game-wide? No, and here is the measurement.** The clip is needed
only by an actor that enters state 12, and state 12 is reached only from
`ZombieStateDeath6` on that bit. The 22 records that carry it are in **stage 1
and stage 3 only**; stages 2, 4, 5 and 6 have none, which is why four stages
completed with the clip missing. The port widens that population by one bug and
not by six — see the next item — and stages 4, 5 and 6 have neither a
bit-carrying record nor a body-condition-7 spawn, so no route in them can leak
this way at all. `verify_death_clips.py` prints the count, so nothing here
states it twice (`L16`).

**One thing to keep from this even though it is fixed.**
`MotionPlayFrame` answering `0` for a clip that is not there turns a missing
asset into either an instant state or an eternal one, depending only on whether
the wait is `>= play - 1` or `>= <literal>`. It is the port's own fallback,
nothing declares it, and the hang it produces looks exactly like a state
transcribed wrongly — which is how item 21 hid this one for a session. The
table in `docs/formats/mot.md` under *"a clip nothing names is a clip nothing
carries"* is that fallback written down.

## 23. Stage 4's second entry: one `znkage` in `DragTarget` that shots cannot touch — **fixed**, and the state had no exit at all

```sh
cd web && node tools/playthrough.mjs --stage 4 --entry 4 --headless
```

The other route `--entry` made addressable, and it hung on its second block,
**5/5**:

```
HUNG at block 9  (branch → 11,17) step/op 1 / 50
  0x44 wait_enemies_alive      g_enemies_alive 1 · g_enemies_present 1 · need <= 0
    0x35B4 znkage · DragTarget/3 · d=4
```

70 volleys over 480 frames, 90 hit points before and after, and the debug clear
did not take it either.

Now **5/5 reaching an end block**, 6090 game frames and 72 instructions to
block 25 `(end → 0)`, identical every run — measured after merging `main` and
re-exporting; it was 6015 on the tree the fix was written on, and every other
route's frame count moved by a similar amount over the same merge.

### What the screenshot and the panel said

`web/shots/hang-stage4.png`: the room renders correctly — stage 4's stone
corridor, the arch, the paving, nothing flat and nothing black. Camera
`cp_st4[11] slot 174 frame 100 / 100 (static pose)`, actors panel `characters
2 of 7 up, 5 types` and `enemies 0 attacking · 1 live`. So this was never the
fourth fault class: a player standing here can see the room. The captor is at
`d=4`, on top of the camera, and invisible because of it — but the reason the
shots did nothing is the flag bit, not the framing.

### The mechanism, `[proved]`

`ZombieStateDragTarget` is class 0x30 state **43** — `g_class30_states[43]` is
`0x0045C080`, with `[42]` `0x0045BFD0` and `[44]` `0x0045C2E0` either side and
both agreeing with the port's enum (`L38`). Five sub-states off the jump table
at `0x0045C2C0`, and `JA` at `0x0045C0A4` sends anything above 4 to the tail:

| sub | at | what it does |
|---|---|---|
| 0 | `0x0045C0B1` | clip `0x1A4`, `obj+0x34 \|= 0x2400` and `0x10000000`, `obj+0x1F8 &= ~2`, loops/cue off the script head — then **falls into sub 1 on the same frame** |
| 1 | `0x0045C113` | copies the civilian's position **and all three rotations** every frame; on `loops == 0 && cursor == cue` plays `0x1A8`, raises `0x4000000` on the *civilian* and `0x10100` on **itself**; if she is already dead, plays `0x1AA` instead |
| 2 | `0x0045C212` | keeps copying; at cursor `0x2D` calls `ActorShiftToHoldBone1Position` (`FUN_0045CE70`), clip `0x1B0`, `obj+0x1F8 \|= 2` |
| 3 | `0x0045C27E` | `obj+0x68 = TurnAngleToward(obj+0x68, 0x2000, 0x1A0)`, and **never increments the sub-state** |
| 4 | `0x0045C29C` | `g_hit_slots[obj+0x3C] = 0`, `ActorDespawn` — the only arm that does not run the tail |

**The tail at `0x0045C1AD` is the state's only exit**, and every sub but 4
falls into it:

```c
if (g_script_flags[0x1D] != 0 && g_players_in_play != 0) {
    obj+0x34 |= 0x4000000;                 // Dead
    ReleaseEnemyAliveCount(obj);           // FUN_00456560
    ReleaseEnemyPresentCount(obj);         // FUN_00456580
    obj+0x1312 = 4;
}
```

**The port had no tail at all.** It had the sub-4 arm and nothing that could
ever assign sub 4, and no sub-3 arm either. So the captor sat in sub 3 for
ever holding `g_enemies_alive` at 1 — and the `0x10100` sub 1 raised on itself
is `ActorFlag.ShotImmune` (`0x100`), which `DispatchHit` (`FUN_004092F0`) jumps
past `ResolveHit` on, so no volley could take it out of the count either. Both
of the two leads in the old note were right, and they were one fault: the
immunity is the state's own doing and the flag is what lifts it.

**The debug clear refusing it was a true signal and stays true.** `ActorKillAll`
declines an actor a shot could not touch, exactly as before; nothing about the
fix goes near it.

### The partner, which does exist

Flag 29 is **not** in stage 4's script. `0x0045C1AE` is the only instruction in
the whole image that names `0x009C721D` — a byte-pattern sweep of `.text` for
`1d729c00` returns one hit (`L32`) — so every writer of flag 29 is an indexed
one, and in stage 4 it is the dragged civilian:

* block 4 step 7 op 5 is `spawn_obj_c` on the class-0x10 record `0x3578`
  (charType 48, script entry 36);
* that record's **one child** is `at 13748 = 0x35B4`, class 0x30, charType 11,
  **hp 90** — the actor in the hang report;
* her entry resolves to stream 85, and stream 85 op 11, plus both of its
  branches (op 14 → stream 83, op 15 → stream 84) at their op 5, are
  `CivilianRunScript` op `0x1C` with argument **29**.

So all three of rescued, shot and resumed raise it. The script's own
`wait_script_flag 29` at block 4 step 7 op 8 comes down off the same write,
which is how the run reached block 9 in the first place — the flag was up and
the captor ignored it.

### The second bug behind it

The port's sub 2 fell through into sub 1's loop-and-cue block, which the
engine's `case 2` never reaches. With the civilian dead and the loop count
spent, that block's second arm fired on the first frame of sub 2 and bumped
straight to sub 3, so the settle never ran at all. Sub 2 is its own arm now.
And the pose copy was `yaw` alone where the engine copies `obj+0x64`, `0x68`
**and** `0x6C` in both arms that do it.

### The checks

* `web/test/port.test.ts` — a block of assertions driving state 43 from sub 0
  to the despawn. Mutation-tested three ways, each watched failing: the tail
  removed fails three of them, the sub-2 fall-through restored fails one, and
  the yaw-only pose copy fails one. (The commit message that landed this says
  "seven"; the block has eleven. `L16` — do not put a count in prose.)
* `web/tools/flag_gates.ts` — a second pass over all twelve bundles: every
  state-43 captor must be named as a child of a class-0x10 spawn, and that
  civilian's reachable streams must raise flag 29. Two placements across the
  corpus (stage 4 in each mode) and a guard against the population being
  empty, because a vacuous loop reads as green (`L14`). Fails on a dropped
  `children` link and on the wrong flag index.

### Left `[open]` here

* `ActorShiftToHoldBone1Position` (`FUN_0045CE70`) is **not** ported. Sub 2
  calls it to difference bone 1's drawn world position against the pose the
  new clip would put it in, and `game/` has no skeleton — that is the
  `GameHost` seam. The captor lands a bone-offset from where the engine puts
  it. Its four callers are `0x0045C25A`, `0x0047BD95`, `0x0047C3A9` and
  `0x004955E7`, and whether its two positions are in the same frame of
  reference is itself `[open]`: one goes through a camera-block matrix and the
  other starts from identity.
* Sub 0's `obj+0x1368 |= 0x10` at `0x0045C0ED` is a kill-move death-clip
  selector and the port models only bit 0 of that word — the standing gap in
  `ZombieSubState.hasCooldown`. `ChooseDeathMotion` reads bit `0x10` for
  motion `0x1A5`, so a captor killed while dragging plays the wrong death.

## 24. `ZombieStateStandAndThrow` raises a bit the engine only tests — `[open]`, and it is the reason *these* two zombies were in state 12

Found while fixing item 22, and **it is a second defect with the same
symptom**, so it is filed separately rather than folded in. Nothing is changed
for it yet: the reading is not corroborated (see the last paragraph) and the
fix is a behaviour change the user should take.

**The two zombies that hung block 2 should never have been in state 12.**
They are evt records `0x3078` and `0x6544`, both character type 19
(`tutorial`), body condition 7, initial state 33 — and their spawn flag words
are `0x00020002` and `0x00020000`. **Bit `0x1000000` is not set in either.**
In the engine `ChooseDeathMotion` gives them a directional death and
`ZombieStateDeath6` hands straight to `ZombieEnterCorpseState`. The two records
in stage 3 that *do* carry the bit are `0x3DE8` and `0x3E30`, character type 20
(`znonoopa`) — a different pair, in the same room.

**What the engine writes there.** `ZombieStateStandAndThrow`'s sub-0 arm, from
the jump table at `0x004595C8`:

```
004590da  83f907           CMP  ECX, 7              ; ECX = obj+0x130C
004590dd  0f85ba000000     JNE  0045919d
004590e3  8b4e34           MOV  ECX, [ESI + 0x34]
004590e6  f7c100000001     TEST ECX, 0x1000000
004590ec  7521             JNE  0045910f            ; already holding: skip
004590ee  8b866c130000     MOV  EAX, [ESI + 0x136c]
004590f4  0c01             OR   AL, 1               ; obj+0x136C |= 1
004590f6  f7c100000200     TEST ECX, 0x20000        ; ActorFlag.Airborne
004590fc  89866c130000     MOV  [ESI + 0x136c], EAX
00459102  740b             JE   0045910f
00459104  0d00001000       OR   EAX, 0x100000       ; obj+0x136C |= 0x100000
00459109  89866c130000     MOV  [ESI + 0x136c], EAX
0045910f  4a               DEC  EDX                 ; ...then the armed-hands count
```

So the arm **tests** `obj+0x34` bit `0x1000000` and, when it is clear, writes
`obj+0x136C` bits `1` and `0x100000`. `class30/stand_throw.ts` has
`obj.flags |= ActorFlag.HoldingWeapon` there instead, and neither `obj+0x136C`
write at all. That is the port's only writer of the bit, and it is what routed
character type 19 into state 12.

**Where the wrong write came from**, because it was not careless: the
`functions.tsv` comment for `0x00459080` ended *"obj+0x34 bit 0x1000000, which
sub 0 tests and the walk arm clears, is written by NOTHING in the image — the
test is always true and the clear is a no-op."* Both halves of that were wrong
— the bit is seeded from the spawn record, and the test is therefore usually
**false** — and a port written to make a "always true" test true is the
predictable consequence. The row is corrected.

**What fixing it would cost, which is why it is a decision and not a tidy-up.**
`obj+0x136C` bit `0x100000` is `ZombieFlag2.Carried`, and the port **reads**
it: `ZombieOnShot` takes `ZombieState.DeathKnockbackArc` instead of
`ZombieState.Death` for a carried actor, and `ChooseDeathMotion` gives clip
`0x3DB` to character types `0xF`..`0x11` while it is set. All four of stage 3's
condition-7 records have `obj+0x34` bit `0x20000` set, so all four would take
the `0x100000` write — the two that do not carry `0x1000000` would start dying
through state 9. Faithful, and a real change to two rooms.

**The population.** Nine body-condition-7 spawns per mode set — stage 1's one,
stage 2's two, stage 3's six — of which two carry the bit honestly. So the
port's own leak is **seven spawns per mode set, in stages 1, 2 and 3**, on top
of the 22 bundle placements that reach state 12 legitimately. Stages 4, 5 and 6
have no condition-7 spawn and no bit-carrying record, which is the other half
of item 22's answer to "is it game-wide".

**`[open]`, and this is the limit on the reading.** The Ghidra MCP connection
was down for this whole session, so every address above is from a `capstone`
disassembly of `Hod2.exe` at `_v2r`-resolved offsets and from byte-pattern
sweeps of `.text` — not from the database, and not corroborated by
`get_xrefs_to`. Two of the references the sweeps nearly missed say how thin
that ice is: `ZombieStateDeath6`'s test takes its mask from
`MOV EAX, 0x1000000` and `CivilianReleaseCaptors` clears the bit through
`MOV EDX, 0xfeffffff` and a register `AND`, so **a raise built the same way is
invisible to the sweep that concluded there is none** (`L32`). Re-run
`get_xrefs_to 0x00459080` and a proper writer search when Ghidra is back,
before changing the write.

## 25. Stage 2's blocks 1-10 and 21-32 have now been played — and two of them stop

Twenty-two blocks of a shipped stage that no automated run and no session had
ever entered. They were unreachable until the class-0x21 rescue target was
exported, and then merely unvisited: a driven run takes **one** arm of every
branch, and with nobody rescued `g_script_branch_var` stays 0 for the whole
stage, so every run went `0 → 11 → 12 → 13 → 14 → 15 → 16 → 35`.

### How the driver reaches them

`--route <block>:<target>`, in `tools/playthrough.mjs`, and it **plays for the
arm before it clicks one** — see that file's header for the whole of it. Every
writer of `g_script_branch_var` in the image is actor code, so the tool fires
the same volley the gates get while the walker is inside a rule's block, under
the same refusal `shootable` makes (read from `g_civilians_alive`, because
inside a block there is no gate to read). On block 0 that kills the rescue
target, and the branch bar comes up with `→ 1` already marked as the game's
own route. The override is the fallback and is reported as one.

**Why playing for it matters, measured.** The first cut of this only clicked
the bar. That reaches block 1 with the rescue target still in
`RescueTargetHeldState`, holding `g_enemies_alive` and `g_enemies_present` —
its only ways out are the rescue and camera path `0x39` frame `0x121`, and
neither can happen again once block 1 is running. Measured: `e1 p1` with the
actor frozen at one hit point for the rest of the run, and **blocks 3 and 5
both reported as unclearable rooms**. The engine cannot be in that state: the
only writer of arm 1 here *is* the rescue. Both "hangs" evaporated when the
run played for the arm instead. A hang behind an override is not evidence about
the port.

### What the six runs played

Same seed, same driven clock, one at a time (two browsers at once lose the
renderer — `L29`). Route A gave the same frame numbers on three separate runs.
The counts are **sampled every `--poll` frames**, 15 by default, so a shift of
a frame or two rounds away and only a shift that crosses a poll boundary shows
at all — which is why two of the routes read identically before and after.

| route | blocks first executed | before items 26-30 | after |
|---|---|---|---|
| `0:1,1:2,3:4,5:6,6:7,7:8,8:10` | 1 2 3 4 5 6 7 8 10 9 | hung, block 9 | **end 37**, 10860 |
| `0:1,1:29,3:30,5:21` | 29 30 21 | end 35, 11145 | **end 35**, 11145 |
| `14:22,22:23,23:24` | 22 23 24 | hung, block 24 | **hangs, block 24** |
| `12:31,14:22,22:34,23:26` | 31 34 26 27 28 | end 37, 12060 | **end 37**, 12270 |
| `0:1,1:2,3:4,5:6,6:7,7:25` | 25 | end 37, 9045 | **end 37**, 9045 |
| `0:1,1:2,3:4,5:6,6:7,7:8,8:32` | 32 | hung, block 9 | **end 37**, 11025 |

So **all twenty-two play, and five of the six routes reach an end block**. One
block stops: **24**, item 29, which is `[open]`. Block 9's two roads — `8→10→9`
and `8→32→9` — both play now; it hung on both before item 30, which is what
says that stop was not the branch mechanism either.

The unrouted run is unchanged in outcome and 90 frames longer (12495 against
12405), which is the strict camera wait of item 30 costing a frame at each of
the sites it corrects. No route reports a room the shots could not clear.

### Two structural facts that came out of it

**Six of stage 2's blocks are not on any arcade road.** A route record has
three slots, and every write of `2` into `g_script_branch_var` in the image is
behind `g_GameMode == 1`. Stage 2's slot-2 targets are blocks **29, 30, 31,
32, 33 and 34** — off blocks 1, 3, 12, 8, 18 and 22 — so no arcade run,
driven or played, can reach one. `--original` plays the Original Mode bundle,
where the actors that write a 2 live — measured, the flag loads
`stage2_original` (`118 models · 106,973 tris`) against arcade's `stage2`
(`106,949`), and a run under it plays. The rows above reach those six blocks by
override in **arcade**, which is coverage and not a road that mode has; playing
them the way the game does is an Original Mode run and is not done here.

**Nothing was rescued in the old runs because nothing had to be.** Once the
rooms are cleared the game itself takes arm 1 at every fork that has a
civilian in it: blocks 5, 6, 7 and 23 each wrote `g_script_branch_var = 1`
off their own civilians' rescues, unprompted. Blocks 7 to 10 are the road for a player who **fails** a
rescue, which is why they need an override from a driven run that kills
everything.

## 26. `CivilianStepScript`'s camera bit read one of three conditions — **fixed**

Found while reading why stage 2's block 9 stopped, and **it was not the
reason** — item 30 is. Recorded as its own item because it is its own defect:
the fix is proved by the disassembly and by two assertions, and it changed
nothing measurable in the six stages. The first reading of block 9 got this far
and stopped here, which is the wrong turn worth keeping: `replay.mjs 2 9 2`
shows the civilian who raises flag 3 parked in state 0 on motion 413 for ten
seconds, and the wait word she is parked on *there* is `0x04109000`. In the
real run she is dead and on a different stream with a different word, so this
bit was never what held her.

`0x04000000` is masked off as op 0x2C loads the word (`operand & 0xFBFFFFFF`),
`0x00100000` is the root-motion switch and `0x00008000` is read nowhere in the
routine, so the one live condition in `0x04109000` is **`0x00001000`** — and
the port had a third of it. `[proved]`, from `0x0048B2F8`:

```
0048b2f8  f6c710          TEST BH,0x10                   ; bit 0x1000
0048b2fb  7423            JZ  0048b320                   ; clear: no arm
0048b2fd  833d086f9c0002  CMP dword ptr [0x009c6f08],0x2  ; ..._major_entered
0048b304  751a            JNZ 0048b320                   ; not row 2: no hold
0048b306  a02f6f9c00      MOV AL,byte ptr [0x009c6f2f]    ; g_camera_settled
0048b30b  84c0            TEST AL,AL
0048b30d  0f850e030000    JNZ 0048b621                    ; -> resume
0048b313  a02d6f9c00      MOV AL,byte ptr [0x009c6f2d]    ; g_camera_free
0048b318  84c0            TEST AL,AL
0048b31a  0f8501030000    JNZ 0048b621                    ; -> resume
```

So the bit releases the script on `g_camera_settled` **or** `g_camera_free` —
the same pair `EvtOpWaitTargetsClear47` accepts, which is what makes it a rule
rather than one routine's habit — and the whole arm only applies while
`g_scene_state_major_entered` is 2. `game/class10/step.ts` tested
`g_camera_settled` alone, which is wrong twice over: it released a civilian
during a scripted view-angle turn (major 1), and it could not release one whose
room was clear but whose camera had not finished easing.
`CameraTrackEnemiesTick` only ever raises `settled` while nothing is tracked,
so one enemy still holding a `g_enemy_slots` entry made the port's single test
unsatisfiable.

Fixed as the three conditions the disassembly has. Two new assertions in
`test/port.test.ts` — `g_camera_free` alone releases the wait, and off row 2
the arm releases nothing — and both were **watched failing** with the fix
backed out (`rate 10` and `rate 77`, the two directions).

## 27. Class 0x42 is unported, and each of its objects is counted as an enemy — `[open]`

Found while reading what blocks 21 and 26 hold.
`PlaceFallingBreakableBatch` (`FUN_0042F9B0`) builds 6 to 15 objects in one
loop — how many is `obj+0x130C` and the player count — and inside that
loop, at `0x0042FBBF` and `0x0042FBC6`:

```
0042fbb2  e8c992fdff      CALL 0x00408e80
0042fbbf  66ff0506709c00  INC  word ptr [0x009c7006]   ; g_enemies_present
0042fbc6  66ff054a909c00  INC  word ptr [0x009c904a]   ; g_enemies_alive
```

`[proved]`. The port has no module for class 0x42, so `ActorSpawn` makes an
inert actor and **nothing increments either counter** — the gate that waits for
them comes down before they have been shot. Where, exactly:

| block | step | the batch | the gate in the same step |
|---|---|---|---|
| 21 | 4 | two class-0x42 spawns at op 29 | `wait_enemies_alive 0` at op 34 |
| 26 | 2 | one class-0x42 spawn at op 12 | `wait_enemies_alive 0` at op 19 |

This is the opposite fault to a hang and the more dangerous one to leave: the
room opens early, so nothing looks wrong. It is a port of `FUN_0042F9B0` and
its update, not an adjustment; `docs/formats/spawns.md` already has the
mechanism.

## 28. No hang report has ever carried an actor row for a gate with no named blocker — **fixed**, in the harness

Not a bug in the game, and it is why item 26 took three runs to read. **Two
faults, stacked**, and the first one hid the second.

**The gate's own opcode was read as a holder.** The report gathers holders with
`/0x[0-9A-F]+/` over the wait panel's text — and every gate's `<summary>` is
`0x45 wait_script_flag` or `0x44 wait_enemies_alive`, so `holders` was
**never** empty. The arm for "no holder was named, so dump the field" was
unreachable, and the arm that ran went looking for an actor row containing
`0x45` and printed nothing. `blockerRows` is the reader that can tell a
blocker (`0x5294 hito_mario2 · dead · … · d=23`) from the summary, it already
existed, and the holders list is built from it now.

**And the panel could not have answered anyway.** A panel is a `<details>`
whose effect *demands* its projection slice when it opens, and a demanded slice
is built by the next publish — which under `?drive=1` is a driven frame. Click
and `sleep` and no frame ever runs; click and `advance` at once and the frame
runs before React has committed the open state, so the publish has no claim on
the slice and nothing publishes again. Either way the panel's switches and
readouts **are** there — `4 of 5 up, 3 types`, `0 attacking · 0 live · 6
scripted` — so it read as a panel with nothing to say rather than one that had
not been asked. The order that works is click, let React commit, run one frame,
let React commit; measured, it then prints `0x21 RankScaledEnemy · 1` and
eleven actors in six classes.

Two more things went with it, both for the same reason — a report has to be
readable by the person who did not run it. The panel lists by class in document
order, so the first ten lines on stage 2's block 9 are three civilians and the
question was which *enemy* was alive: it takes twenty now. And the report
prints the drive row's counters with every actor still standing, which is game
state, needs no React, and cannot come back empty.

## 29. Stage 2 block 24: a state-19 `znkage` waits for a camera frame the port overwrites — `[open]`

```
HUNG at block 24  (goto → 9) step/op 3 / 18
  0x44 wait_enemies_alive · g_enemies_alive 1 · g_enemies_present 1 · need <= 0
  0x10948 znkage · WaitForCameraFrame/1 · d=23
    hp 90/90 · motion 431 · flags 0x8090101
  e1 p1 ...  67912 c48 s19.1 h90 @-1747353,-20398,-5275648 y32768
```

The screenshot shows it filling the middle of the frame, twenty-three units
out, and the shots do nothing because state 19's freeze arm holds
`ActorFlag.ShotImmune`. Its placement is `initial_state 19`,
`entry { motion 431, cue_frame 430, freeze true, claim true, delay 0,
cooldown 30 }`, and the transport reads `cp_st2[39] slot 94 frame 470/470`.

**What the script does**, block 24 step 3, in order:

```
queue_event 0x40  336  430  path 0x5E  flags 0      ; play 336..430
wait_queued_events_done                             ; ...to the end of it
set_script_flag 0x2F
spawn_obj 0x00987D48                                ; the znkage, cue 430
queue_event 0x40  431  470  path 0x5E  flags 2      ; STASH 431..470
queue_event 0x21  7                                 ; scene state (2,7)
wait_camera_path_frame 448
```

**Three readings, all `[proved]` from the disassembly:**

1. Class 0x30 state 19's cue test is **two** globals, at `0x004576A2`:
   `CMP dword ptr [0x009a6110], EAX` / `JE`, then
   `CMP dword ptr [0x009a6458], EAX` / `JNE` — `g_cam_path_frame` **or**
   `g_cam_path_frame_2`, camera blocks 0 and 2. The port tests the first only,
   which is the `[diverges]` `CamCueHit` already declares for states 18 and
   23; state 19 does not even go through that helper.
2. `CamAdvancePathFrame` (`FUN_004035E0`) publishes the cursor to
   `g_cam_path_frame` **before** the end test and increments the cursor
   afterwards, so a play that ends at 430 leaves `g_cam_path_frame == 430`
   standing and the *cursor* at 431. Nothing else writes that global.
3. `CameraPlayStashedPath` (`FUN_0040C8A0`), which is what scene state (2,7)
   installs, steps `g_stashed_path_frame` (`0x009C70AC`), publishes its float
   copy to `0x009C70BC`, writes the camera pose and
   `g_cam_path_frames_left` (`0x009C6F28`) — and **never touches
   `0x009A6110`**. A stashed range does not move `g_cam_path_frame`.

So in the engine the cue frame 430 is *standing* when the actor spawns and for
the whole of the stashed 431..470 play, and the actor fires on its first
update. The port has one `w.cam` for both kinds of play and publishes its frame
to `g_cam_path_frame`, so `finish_sequence 7` replaces 430 with 431 — in the
**same** `runInstructions` pass as the spawn, because nothing between them
blocks. 430 is never a value the port holds while the actor exists.

**Not fixed here, and it is a `[diverges]` decision.** The faithful model is a
second camera cursor: `g_cam_path_frame` written only by the rail play, the
stashed play writing its own globals, and `wait_camera_path_frame 0` reading
whichever is playing. That is a change to `script/state/camera_action.ts`,
`walker.ts` and `syncPortGlobals` that moves the frame every camera cue in the
corpus sees. And it contradicts a fix already in the tree: the note on
`finish_sequence`'s `started: false` records stage 2 block 16's stashed
`581..660` being needed to publish **660**, because `0xA030`'s captor cue is
that frame — which on reading 3 the engine cannot meet from block 0 either. So
something else carries a stashed range's frame to a cue-waiting actor, and
what that is is **`[open]`**: `g_cam_path_frame_2` is read at seven sites and
written only by `CamAdvancePathFrame` with block index 2, and what drives block
2 is unread.

`tools/cam_cues.mjs` reports this spawn as `ok ... left after 551 frames`,
which is worth knowing about the check: leaving 551 frames late, when a later
unrelated path happens to pass through frame 430, is not the cue being
honoured. The harness measures "does it ever leave", and for an equality cue
that is a weaker question than it looks.

## 30. Stage 2 block 9: a stashed shot was one frame short, and a dead civilian's flag went with it — **fixed**

```
HUNG at block 9  (goto → 28) step/op 2 / 14
  0x45 wait_script_flag        (flag 3)
  0x51AC hito_galjk · d=17 · dead · camera-cue push-out
    script 18 · pc 7 · cursor 7 · motion 370 frame 80/80
    wait 0x1000080 · camera-cue push-out
    on cue (66,385) now (66,384)
  e1 p1 v1 ...  21164 c48 s39.1 h100
```

Reached on two different roads (`8→10→9` and `8→32→9`) and hung on both, so
it is not the branch mechanism. The gate is `wait_script_flag 3`; flag 3 is
raised by the class-0x10 civilian block 9 step 2 places at op 7 — spawn
`20908`, character type 42, entry 8 — and **both** of her streams raise it:
stream 19 (rescued) at its op 0x1C, and stream 18, the one she runs when she
is killed, at its own. Her captors mauled her, which is a thing the game
allows; the flag should still have come.

**One frame short.** She is parked on wait word `0x01000080` — `PushOutOfWorld
| CameraCue` — with the cue her stream's op 0x0D set: **path 66, frame 385**.
The script stashes `351..384` on path 66 (`queue_event 0x40 351 384 66
flags 2`) and hands it to scene state **7**. The port played `352..384`; the
engine plays `352..385`, because the two rail hooks increment *before* they
publish and their guards differ by one byte:

```
CameraStepRailTick    (FUN_0040C790) state (2,6):  0040c79e CMP ECX,EAX
                                                   0040c7a0 JGE  -> stops at end
CameraPlayStashedPath (FUN_0040C8A0) state (2,7):  0040c8be CMP ECX,EAX
                                                   0040c8c0 JG   -> one past end
```

`[proved]`. `functions.tsv` has said "this one runs one frame past the end and
that one stops on it" since `CameraPlayStashedPath` was read; the port modelled
both as the `JGE` twin, and the annotation's own worked example (`581..660`
draws `582..660`) was the `JGE` answer too. **A note is not a check** (`L26`).

Fixed as `CamCommand.pastEnd`, one frame, set for minor 7 and for nothing
else, and deliberately not folded into `endFrame` — the range's own end is
what `wait_camera_path_frame 0` and `g_cam_path_frames_left` read. Two new
assertions in `test/port.test.ts`: state 7 publishes `1..11` for a stashed
`0..10`, state 6 publishes `1..10`. The first was **watched failing**
(`1,2,...,10,10,10,10`) with the fix backed out; the second passes either way
and is there so the pair cannot be "fixed" by making both go one further.

The `21164 c48 s39.1` row beside her is the same story one step on: a captor in
`ZombieStateAwaitCivilianOrder` (state 39) waits for an order her stream issues
with op 0x1A, four commands past the cue that was out of reach.

**And it needed both halves.** Either fix alone leaves the block shut, from
opposite sides: with only the strict wait the walker parks on
`wait_camera_path_frame 384` for ever, because nothing publishes 385; with only
`pastEnd` the wait releases *on* 384 and the `finish_sequence 4` behind it
freezes the camera before 385 is ever drawn. Measured both ways. Together,
block 9 plays in 3,510 frames and the two routes that reach it — `8→10→9` and
`8→32→9` — both reach block 37.

`tools/verify_cam_waits.py` is the corpus guard, and it discriminates: model
scene state 7 as stopping on its range's end and **eighteen**
`wait_camera_path_frame` sites in stage 2 alone become gates nothing can open.
That count is also the strongest evidence for the reading — the shipped scripts
require the `JG`.

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
