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

Current result for stage 2: **reaches block 35 `(end → 0)` in ~260s and 159
instructions, with seven enemy gates needing the debug clear.** Those seven are
item 1.

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

**The biggest one, and the reason seven gates needed the debug clear.**

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

## 2. `RemoveOffCamera` is declared and acted on by nothing

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

## 3. The removal cue takes `>=` where the engine takes `==`

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

## 4. Skipping a cutscene does not clear its civilians

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

## 5. Wait bit `0x00100000` is unread

Four of the six wait words in stage 2's stream 95 carry it. It is in neither
`Any` (`0x40003FFF`) nor the blocked mask (`0x14000000`), so it does not gate
`CivilianStepScript`'s loop — something else reads it. Find the reader.
`[open]`

## 6. `sub+0x0E`: op 3 writes it and the turn does not read it

`CivilianStepTurnToTarget` passes a literal `0x100` to `ActorTurnTowardPoint`.
The port had been passing `sub+0x0E` — which is what op 3 writes and what
`CivilianInit` seeds with 10 — and every civilian turned twenty-five times too
slowly; that is fixed. What now needs finding is **what actually reads
`sub+0x0E`**, because op 3 sets it deliberately. The field is kept and the
sidebar shows it. `[open]`

## 7. Class 0x30 has no death state

`GameUpdate` skips dead actors unless the handler sets `updatesWhenDead`, which
class 0x31 does and class 0x30 does not, so the zombie's death clip is played by
`ActorAdvanceMotion`'s `obj.death` instead of by a state. The consequence today
is that the permit release lands in `GameUpdate`'s dead-actor sweep rather than
where the engine keeps it — `ZombieStateDeath6` (`FUN_00454D20`) sub 1 calling
`ZombieReleasePermitAndUntrack` (`FUN_004565A0`). It is correct as it stands;
porting state 6 would move it home. `[open]`

## 8. Only stage 2 has ever been swept

`--stage 1` through `--stage 6` have not been run to an end block. Expect more
of the same shape. Stage 1's opening is nearly a minute of cathedral, so the
tool takes every skip the script offers.

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
