# Reported bugs — status

**Scope, against the other bug list:** this file is one entry per *reported*
symptom and whether it is fixed. Defects the automated playthrough finds by
driving the player end to end are in [`PLAYER_HANGS.md`](PLAYER_HANGS.md).
The divergence count is generated into [`STATUS.md`](STATUS.md); do not
restate it here.

Fifty-three reports: **thirty-seven fixed, three half-done, twelve open, and
two `[not-a-bug]`, each of which carried a real defect underneath it** (one of
those two is counted in the thirty-seven, its bullet carrying both markers).
The five reported on 2026-09-07 from stage 3's block 2 are all fixed, and
four of the five were far wider than the place they were seen from. **Nine
arrived on 2026-09-09 and none has been looked at**, which is most of the open
column and the reason it grew.
The arithmetic is the report bullets themselves -- one `- ` bullet per
report, opening with its marker -- so `grep -cE '^- +.\[' BUGS.md` is the
total and the same grep per marker is the split. It used to be quoted as
`grep -c '\[fixed\]'`, which counts the legend and this paragraph as reports
and had drifted three out by 2026-09-06; the summary bullets under *What is
left* point at the body entries rather than adding to them. Every fix
carries its evidence in the port's doc comments; the reasoning is in
`docs/re/session-log.md`.

`[fixed]` verified against the shipped data · `[part]` one half done, the other
named · `[not-a-bug]` the port already matches the engine · `[open]` unsolved ·
`[decide]` waiting on a divergence call.

---

## What is left

* **Nine reports arrived on 2026-09-09 and none is started.** The axe's spin
  axis, a missing roller shutter in stage 3, silent zombies, sound settings
  that do not survive a reload, an undrawn van and a lift that rises too early
  in stages 5 and 6, `znjoe`'s missing chest worm, and two cars whose zombies
  are not on them. They are one section of their own below, with the
  reporter's locators. **The stage 2 one is reported as making a branch
  unplayable** and is the first of the nine to take. Three carry a lead
  already in the tree: the axe has been changed once for this exact symptom
  and is still wrong, the two car reports both land on the port's declared
  guard around `g_carrier_object`, and the stage 5 one **contradicts a doc
  comment written from the same URL** that says the distance is correct.
* `[open]` **Stage 1 `0x16D8` `char_adv00` plays the wrong entrance** — it
  hangs from a ledge where it should push a chair aside. Every link of the data
  chain checks out and two theories are dead; it wants eyes on the render
  rather than another reading. Detail below.


### Three reports are half-done, and each remaining half is named

* `[open]` **the stage-3 alternating-frame flip** on the boat's NPCs — the
  last third of the "boat is invisible" report. The camera was disproved as the
  cause over 3000 frames and four runs; the remaining lead is
  `ActorAdvanceMotion` applying root motion to `obj.pos` for class 0x25 once
  its VM parks.
* `[open]` **`char_adv02`'s midriff gap.** ~1.75 units are drawn by nothing
  between the damaged torso `0x1B70` and the pelvis. `harold.bin` carries five
  lower-torso models of exactly that extent that **no table in the EXE
  references**, so the join is not guessable from the binary and was not
  guessed at.
* `[decide]` **the crawlers hit where the engine whiffs** — a decision rather
  than a mystery. It is divergence 2 below.

### One `[open]` that no report raised

* **The `sound.md` BGM rule is suspicious.** `g_GameMode = 0` is only ever
  written at app state 5, which the doc's rule does not account for. Found
  while closing the `g_app_state` work, not chased.

### Four divergences want a call from you

See the last section. The port's total divergence and `[open]` counts — the
two numbers that say how finished the transcription is — are generated into
[`STATUS.md`](STATUS.md).

### Known red, and not caused by any of this

* `web/tools/civilians.mjs` — rescued 20 of an expected 21, mauled 12 of an
  expected 10. Confirmed identical before and after every change here.
* `web/tools/cadence.mjs` — 0 strikes in 30 s, permit queue not throttling.
  Likewise pre-existing.
* `web/tools/pacing.mjs` and `playthrough.mjs` cannot run under
  `tools/run_test.mjs` at all: they pull in playwright and esbuild refuses it.
  A tooling shape, not a port defect.

---

## The first fifteen — the 2026-09-04 fan-out

Seven agents, one per group. Two of the fifteen turned out not to
be port bugs at all, and they are marked as such rather than "fixed".

- `[fixed]` Civilians' hair doesn't render — **the hair is a separate model
  the exporter never carried.** A civilian's head model is a shell open at the
  back: `hito_gal`'s bone 2 is 149 vertices spanning `z 0.18..1.38`, with four
  vertex normals pointing backwards where every zombie head in the game has
  fifteen to forty, so on its own it renders as a face on a neck. What closes
  it is `model+0x1170`, the **attachment list**: `CivilianInit`
  (`FUN_0048A3E0`) takes it from the spawn tail's `+0x08`, `ActorBindPartList`
  (`FUN_00412440`) binds it and `ActorDrawAttachedParts` (`FUN_004124F0`) draws
  it after every skeleton node. Ids below `0x24` replace bone 2's model with one
  of the sixty interchangeable `hito_kao_*` faces; ids at or above it draw an
  `etc_komono_*` accessory — *komono*, small item: hair and hats on bone 2, bags
  on bone 1, shoes on bones 12 and 15. 97 spawns across classes `0x10`, `0x24`
  and `0x25` carry a list and the port had none of it; the divergence was
  declared in `class10/init.ts` ("binds the part list … `[diverges]` here") and
  what it cost was not. `docs/formats/civilians.md` has the table.

- `[fixed]` Backdrop is in the wrong position/should not be visible in Stage 3
  — `DrawBackdropDome` (`0x004132D0`) draws **twice**: the preset's `slot_a`
  spun and scaled, then `slot_b` at `0x0041345E` with the translate alone,
  outside that matrix push. The port implemented the first draw only, so the
  second model sat in the stage tree at its authored position for the whole
  stage. `docs/formats/evt.md` had stopped reading at the first
  `AssetDrawSlot`, and the player believed the doc.

- `[part]` Start of Stage 3 the boat is not visible for a while. While the boat
  is invisible the NPCs in the front seats of the boat are in the wrong
  orientation and flipping between two positions on alternating frames
  — three causes, all fixed: `FUN_0048EAD0`'s `default:` arm draws at the held
  pose rather than hiding (the boat was hidden for 1239 frames ≈ 20.6 s);
  `RigLayer` claimed all 154 rig-tagged nodes in stage 3 against the 9 it owns
  and wrote `visible` over `CharacterLayer` once a frame; and
  `GameHost.objectPath` declared `yaw?` while the backend returned only
  `{x,y,z}`, so `p.yaw` was **always** `undefined` and every path rider sat at
  yaw 0. **`[open]`: the alternating-frames flip specifically.** The camera was
  disproved as the cause (steady over 3000 frames, four runs). The remaining
  lead is `ActorAdvanceMotion` applying root motion to `obj.pos` for class 0x25
  once its VM parks — unverified, and in a file that agent did not own.

- `[fixed]` Civilians and enemies sometimes appear rendered (but not
  simulating) before they should spawn — same `RigLayer` over-adoption as
  above, found independently from the opposite symptom. `hod2_kind: "rig"` is
  the exporter's tag for *every* transcribed hierarchy; four layers own
  different subsets. Now bound by the names `rigs.rigs[].name` gives, which is
  the index source: stage 2 goes 335 adopted → 6.

- `[fixed]` Camera doesn't seem to wait for zombies to die before advancing
  — three causes. `EvtInterpreterLoop` never clears `g_evt_yield` at entry, so
  every wait but `0x40` burns the frame it is *reached* on with its condition
  unread; the port could pass on its own frame. The port also materialises
  spawns after `walker.tick()` returns, so the counters read zero for the whole
  tick that ran the spawn. And ops `0x43`/`0x44` were one rule answered with
  the alive count — they read different globals on purpose: `g_enemies_alive`
  falls as the death *state* opens, `g_enemies_present` when the death *clip*
  ends. 54 present-gates had been opening at the moment of death.

- `[fixed]` Headshotting an actor midswing, they finish their swing then
  immediately die — the death chain was already correct. `ZombieStateStrike`
  plays lunge and swing on the actor's **ordinary** motion track; there is no
  second animation channel anywhere in class 0x30. The port invented one
  (`Actor.action`), gave it render precedence, and never ended it — so the
  poser kept drawing the bite after the actor was dead. See `[decide] 3`.

- `[fixed]` After shooting the first zombie that tries to maul a civilian
  around `?stage=1&mode=play&block=9&step=2&op=8`, the other two are stuck not
  moving — **an exporter bug.** `ZombieScriptForState` is
  `state == tail[3] ? tail+0x08 : tail+0x04`, and the blob's header shape
  belongs to *the state that reads it*; `characters.py` keyed it on the
  descriptor's **initial** state. Right for 63 of 69 captors, wrong for the six
  that start in state 39 and are put into a state by their civilian's order op.
  Those six exported `target_script: null`, and `class30/target.ts` reads
  `s?.head.arrive ?? 0` — a radius nothing can satisfy. All six now decode
  under the ordered state and under no other. Needed a re-export.

- `[fixed]` Around `?stage=1&mode=play&block=2&step=2&op=15&frame=185`, zombie
  never seems to 'break through' the doors — see the next entry; one cause.

- `[fixed]` The two later (of three total) zombies that drop from the high
  ledge at `?stage=1&mode=play&block=4&step=4&op=28` don't seem to pause the
  camera — the reported spawns are at block 4 **step 5**. Same mechanism as
  "camera doesn't wait": the gate could answer on its own frame. The
  "they haven't joined the counters yet" theory was **disproved** — both Inits
  increment on their straight line, so a dropper is counted for the whole
  descent.

- `[fixed]` znonoopa zombies get close to the player, then teleport back and
  start throwing — `0x6784` is **class 0x30**, not 0x31.
  `ActorBodyConditionFromHands` (`FUN_00455920`) has exactly one caller in the
  binary and the port had no such function, so the actor kept condition 8 into
  `ZombieStateStrike`. Conditions 7 and 8 index the **throw** row
  (`distance 99.0`), so the lunge test passed at 24 units, `strikeFloor` became
  99, and root motion shoved the body out to exactly 99 the next frame.

- `[part]` char_adv02 zombies seem to lose their midriff on one shot
  — `swapGore`'s single-primitive fast path took only the *first* mesh of a
  chain, and all 57 of `char_adv02`'s damaged variants are multi-primitive, so
  every arm and leg swap drew a fraction of the part. Fixed. **`[open]`: the
  midriff itself.** The damaged torso `0x1B70` spans `y 1.3..5.5` where the
  undamaged `0x1B3D` spans `y -2.0..5.5`, and the pelvis tops out at `-0.45`,
  so ~1.75 units is drawn by nothing. `harold.bin` carries five lower-torso
  models of exactly that extent that **no table in the EXE references**. Not
  guessed at.

- `[not-a-bug]` + `[fixed]` char_adv02 barges through the barrels (which don't
  smash as they should) and then continues repeating the charging animation
  — **the barrels are correct.** `BreakablePropUpdate` (`FUN_00464620`) reacts
  to exactly two things, a shot count and one global; there is no actor-contact
  test in it, and nothing in the engine smashes a breakable because an enemy
  walked into it. The repeating charge was the entrance-cue bug, fixed: the
  actor was stuck in state 18 sub 0 with its clip's root motion carrying it
  forward for ever.

- `[part]` `[decide]` The crawling zombies have a few bugs — three findings,
  one fixed. `ActorPlayHitReaction` read `reactions["0"]` for every actor; the
  engine indexes by body condition (`obj+0x130C`), and 21 character types carry
  a second row nothing could reach. Fixed. **The stand-up is the engine's own**
  — `znkager`'s condition-4 reaction row is the *same pointer* as its
  condition-0 row. And **it never hits because in the real game it misses**:
  the undamaged crawler's attack is clip 997 at hit frame 40, and clip 997 is
  20 frames long. The port falls back to an attack that connects, so it is
  currently **more dangerous than the original**. See `[decide] 2`.

- `[fixed]` Some scripted humanoids seem to be missing their animations
  — **an exporter gap, not the VM.** `characters.py` baked only a command
  block's *header* motion, never one a program went on to set with `op 2`.
  **118 of the six stages' 263 (program, clip) pairs had no frames at all**,
  and `op 1` mode 2 holds until the clip reaches its last frame — measured
  against `frames`, which was 0, so the wait could never be met. Now 445/445,
  with `tools/verify_scripted_clips.py` asking the question of the *exporter*
  rather than of the baker: every one of the 118 was perfectly bakeable, so a
  decode-only check would have passed the whole time the bug was live.
  Also fixed alongside: `op 4` mode 4 was inverted (`FCOMPP` reads the second
  operand against the first — it proceeds while the actor **recedes**), and
  "the class says nothing" was literal, so class 0x25 has a `debug.ts` now.

- `[fixed]` 0x52EC 0x20 c32 (unread class) needs fully porting — class 0x20 is
  **`OneHitTargetInit`** (`FUN_00448ED0`, confirmed at `g_class_handler_pairs`
  + 0x60): a skinned actor that dies to any single hit, scores 80 for the kill,
  and is not an enemy — its Init increments no counter. `obj+0x130C` is a
  sub-type: 0 stands, 1 spins, 2 is box-clamped. `docs/formats/spawns.md` had
  it as `[likely]` a combat actor on the strength of a call at `0x0044964A` —
  which is inside `EnemyThrowerInit`, class **0x31**'s handler. The two are
  merely adjacent in the file. That same address hid a real port bug:
  `ActorInitHitPoints` has exactly two callers, and the port ran it for every
  character placement, its floor of 1 turning an honest zero into a one.

- `[fixed]` Throwing zombies don't seem to actually throw their axes, just play
  the animation — same cause as the znonoopa teleport: the "throw animation"
  *was* the throw clip, playing in a strike state that has no release. Class
  0x31 had a second, real bug alongside — `SpawnThrownWeapon` returned early on
  a missing bone *after* `ThrowerStateThrow` had already set `Thrown`, where
  the exe reads `obj + 0x274 + bone*0x90` and has no failing path.

---

## The four reported after it

- `[fixed]` **Stage 2 block 16 never clears, and the water set piece plays
  wrong** — `?stage=2&mode=play&block=16&step=6&op=10`, three enemies alive on
  `enemies alive <= 0`. **Two bugs, one shot.** Step 6 queues
  `cam_play 581..660` on path 75 with `flags & 2` and plays it through
  `finish_sequence` scene state (2,7), and *both* cues that shot exists to fire
  are timed to its tail: `0xA030`'s captor cue is frame **660** and its
  civilian's killed script waits on **650**.

  1. **The deferred play lost its last frame.** `started: true` was added to
     both `cam_play` branches this morning (`f28c464`). It is right for the
     non-deferred one — `CamStartPathPlayback` publishes the cursor through
     `CamAdvancePathFrame` and *then* increments — and wrong for the stashed
     one: `CameraStepRailTick` (`FUN_0040C790`) and `CameraPlayStashedPath`
     (`FUN_0040C8A0`) increment *before* they evaluate, so `581..660` draws
     **582..660**. The port drew 581..659, the captor never turned on the
     player, and this is the "used to work" the report names.
  2. **A seek over `wait_camera_path_frame` left the shot mid-flight**, and the
     `finish_sequence` two instructions later froze it at 581 — so the reported
     *address* deadlocked even with (1) fixed. A wait's postcondition is part
     of an address; `WaitRule.skipRunsCameraOn` applies it, the same way
     `retires` already applied the enemy gates'.

  And the third half of the report, which was its own bug:
  **`ZombieStateAwaitCivilianOrder` (`FUN_0045BAD0`) sub 0 hides the actor** —
  `obj+0x1F8 &= ~1` and a 0 into the first part's draw byte through
  `obj+0x1D4`, which is the gate `SkeletonDrawWalk` (`FUN_004110D0`) reads —
  and the order puts it back. The port had neither write, and nothing in
  `render/` read `Actor.alpha`, the flag that models them. So the two `znebi2`
  stood in the water in plain sight instead of coming up out of it. The order
  arm also **tail-calls the state it hands over to**, which the port lost a
  frame to.

  Not a bug, and worth writing down: the civilian is *meant* to die here if she
  is not rescued, and her killed script (33) waits on `children alive <= 2`
  before it issues the two `op 0x1A` orders. The set piece needs the player to
  kill one captor; with one killed, `znebi2` `0xA08C` emerges on clip 178 and
  is in `AttackRun` 79 frames later.

- `[fixed]` **Class 0x20 `OneHitTarget` plays its death animation twice.**
  `OneHitTargetPlayDeathClip` (`FUN_00449380`) steps `obj+0x194` and, on the
  frame the clip ends, writes the old value straight back
  (`004493e3 MOV [EDI], EAX`); `OneHitTargetSinkAndDespawn` (`FUN_00449430`)
  never steps it at all. The port's clock is shared and runs for every actor
  before any class handler, and the poser reads the base track with the
  **wrapping** `authoredFrameOfTicks` — so the clip restarted under the sink.
  `char_adv00`'s clip 988 is 82 authored frames against a 120-frame sink:
  measured at once through and 38 frames into a third. The file's own
  `[port-only]` note claimed the port could not hold the counter and that the
  visible result was the same; both halves were wrong.

- `[open]` **Stage 1 `0x16D8` `char_adv00` plays the wrong entrance** — hangs
  from a ledge, should be pushing a chair aside. **The whole data chain checks
  out and the lead is elsewhere.** The descriptor's state is 18, and
  `ZombieStateWaitCameraFrameThenBranch` (`FUN_004575A0`) plays `tail+0x04` and
  waits on `tail+0x08`; the exporter reads exactly those two offsets
  (`placement.py:entry_tail`) and gets `motion 1048, cue 150`; 1048 is a real
  clip in `char_adv00`'s own table (`zom.bin`, 60 frames, no net root motion);
  and a trace of block 1 step 3 shows the port playing **1048** for the whole
  cue window and leaving on the cue. `verify_mot.py` says all 1058 blocks
  decode at a real stride, and `bake()` refuses a clip whose implied bone count
  is not the character's — so the id → bank → block → skeleton mapping is not
  obviously wrong either.

  Two theories tested and **both dead**. "It is floating, and hanging is its
  height": no — it is snapped from the descriptor's `y 6.5` to **6.20** and
  holds that for its whole life, so 6.20 is the floor there. "1047 and 1048 are
  a swapped pair of door halves": unlikely — `char_adv01` (type 8) has 1048 and
  **not** 1047, so they are not two halves of one thing, and 1048 is shared by
  five spawns to 1047's two.

  What is left is what the clip *looks like*, which is not checkable from here
  and wants eyes on the render. The next thing to try is `export_character.py`
  on `char_adv00` clip 1048 and simply watching it.

- `[fixed]` **`zsass` walks through the camera and never attacks** —
  `?stage=2&mode=play&block=17&step=7&op=0`, `0xBA90`. **An exporter bug, and
  one missing number.**

  `ThrowerStateStandAndDecide` (`FUN_0044B180`) ends by offering state 29 to
  `ThrowerTryEnterState` and only asks `ThrowerPickNextState` (`FUN_0044ADB0`)
  — the router — if that is refused. The router is the *whole* of "attack when
  it gets close": `d <= 30` sends the actor to state 8, which claims a permit
  and pounces. State 29 is `ThrowerStateRearm` (`FUN_0044F7A0`), gated on
  `ThrowerHasBareHand` (`FUN_0044F720`).

  `ThrowerStateRearm` plays motion **5** and re-arms both hands at that clip's
  **midpoint**. `5` was not in the exporter's `CLASS31_LITERAL_MOTIONS`, so it
  was baked for nobody; `MotionOf` returned nothing, `ActorClipFrame` returned
  `-1`, the midpoint never arrived, the hands stayed bare — and state 7
  proposed `Rearm` again the very next frame. Measured: **7 ↔ 29 every frame
  for ever** from the first throw onward, with the router never once reached,
  while the idle's root motion carried the actor into the camera.

  `0x11B` — `ThrowerStateFallAndLand`'s get-up — was missing from the same
  list. Both are confirmed in the exe (`0044f7b9 6a05`, `0044a788 681b010000`)
  and both now export for the four character types that can reach them.
  `zskamere` (0x17) gets neither, which is right: the get-up excludes it and
  `bake` refuses cross-skeleton clips.

  After the re-export the actor throws, re-arms, throws, re-arms, closes — and
  at `d = 29.5` enters state 8 and then state 9, the pounce, with a permit.

  **A guard, because this is the second time.** The list is hand-kept and a
  missing entry is silent — `MotionOf` returning nothing is not an error
  anywhere. `verify_port.py` now checks the port's own class-0x31 clip
  constants against it, and against the exported bundle. Both arms watched
  failing before they were trusted.

---

## And one about the entrances

- `[fixed]` **Zombies in an emerge animation played a stagger when shot.**
  **Two halves, both missing, and the engine's answer is a flag rather than a
  state test.**

  `ActorPlayHitReaction` (`FUN_004544C0`) refuses before it looks a clip up:

  ```
  004544d8  f7463400200010  TEST dword ptr [ESI + 0x34], 0x10002000
  004544df  0f8571010000    JNZ  0x00454656          ; no reaction at all
  ```

  `0x10000000` is *mid-attack*; `0x2000` is the **no-hit-reaction latch**, and
  `ZombieStateEmerge` (`FUN_004584E0`) holds it for the whole entrance —
  `00458532 OR DH, 0x21` in sub 0, and `0045869F AND DH, 0xdf` on the same
  instruction pair that writes state 1. The `0x21` is one instruction and two
  bits: `0x100` is `ShotImmune`, which `ZombieOnShot` (`FUN_00453EB0`) tests
  before it may pick a death state, and `004585EC AND EDX, 0xfff6feff` drops it
  as the emerge clip starts — so the submerged half takes no death state either
  and the whole entrance takes no stagger.

  The port had **neither** half: no gate in `ActorPlayHitReaction` and no raise
  in the emerge, so `ResolveHit` handed every shot on a climbing zombie a
  stumble that cut the entrance clip.

  **The bit had the wrong name**, which is why the raise was never ported. It
  was `ArcSpent`, after the one thing class 0x31's fall states get from it —
  a second knockdown finds it up and launches no further arc. That is a use,
  not the bit: the image reads it in exactly two places, `ActorPlayHitReaction`
  and `ThrowerOnShot` (`00449A95 TEST AH, 0x20`), and both refuse a reaction.
  It is `ActorFlag.NoHitReaction` now, renamed everywhere.

## And one about the transport

- `[fixed]` **Shots still register when paused** — a click with the clock
  stopped landed the hit, took hit points off, paid the score, armed the head
  combo and spawned the muzzle flash, the tracer and the blood. `GameSystem`
  drained `g_shot_requests` inside its own `t.frozen` early return, on the
  argument that a trigger pull is input rather than elapsed time.

  **The argument does not survive the case it was made for.** It named step
  mode, and step mode never reaches that branch: stepping stops the *script*
  and runs the port at full rate, so its ticks carry time and resolve a shot
  down the ordinary `GameUpdate` path. What the branch actually served was
  paused, free roam and `?freeze=1` — the three rows `docs/PLAYER_PROGRESS.md`
  marks "port and render **stopped**". So the fix costs no debug capability:
  fire a shot in step mode and walk it forward a frame at a time exactly as
  before.

  It was also not only wrong on paper. The shot's effects became engine state
  in `ff33131` and `ShotEffectsTick` steps them on **game** time, so a flash
  and a blood spray spawned with the clock stopped could never expire;
  `Shooting.busy` stayed true, `Player.wantsFrame` kept saying yes, and the
  loop that is supposed to sleep while paused ran at 60 fps for ever.
  `web/tools/pacing.mjs` was already red on exactly that line — "the loop went
  back to sleep after the feedback", 60 frames in a second — and is green now.

  Two halves, in the two layers that own them. `GameSystem.update` returns on a
  frozen tick and drains nothing, which is the same answer every other half of
  a game-time job in that order already gives. And the composition root does
  not make a click into input the clock can never consume: `app/main.ts`'s
  `onFire` queues only while the game clock is running, so twenty clicks made
  while paused no longer bank and arrive together on the frame it restarts —
  which is what fixing only the first half would have produced. The `wake`
  stays unconditional; a click is still drawn.

  `web/test/port.test.ts`, "the shot queue, with the clock stopped", is the
  guard: six of its eleven assertions were watched failing first.


## And one about a switch that should never have been one

- `[fixed]` **"we're not waiting for enemies at all"** — reported against the
  player, and it was true of every fight in the game. **Shooting was a
  checkbox, and it defaulted to off.**

  The live-enemy gates ask the host for a count. `WalkerHost.aliveEnemies`,
  `presentEnemies`, `aliveCivilians` and `cameraFree` all answered **null**
  while the Shoot toggle was off, on the reasoning that with nothing able to
  kill an enemy the count could never fall — and a null count is not a
  condition, so `wait_enemies_alive`, `wait_enemies_present` and
  `wait_scripted_actors` passed on their timeouts. The script walked straight
  through every room clear.

  The reasoning was sound and the default made it a trap: the switch that
  decided whether the port ran the game was one unlabelled checkbox, and a
  script sailing through `wait_enemies_alive` looks like a broken port rather
  than a switched-off one. It was reported as a regression, and every
  measurement against a pristine tree said nothing had regressed — because
  nothing had. It had always been like that.

  **So the toggle is gone.** Shooting is what the game is. The camera reaches
  `render/shooting.ts` at construction rather than from the toggle's command
  (until somebody found that checkbox, this layer had no camera and a click did
  nothing at all), the counts are always the real ones, and the crosshair is up
  whenever there is a projection. `enableShooting` and the five drivers that
  called it first are gone with it.

  The null answer stays in the host *contract*: a host with no combat, such as
  the stubs in `test/`, may still give one, and the walker still paces those
  gates off the timeout. The player's host never does.

## And one about the controls

- `[fixed]` **Free roam ignored WASD, and the pointer was never captured.**
  Not a focus thief and not the camera being overwritten: the player's own key
  guard, `isTyping` in `render/freeroam.ts`, counted **any focused `<button>`
  as typing**. Free roam is entered by clicking the **Free roam** button, the
  button keeps focus, so every keystroke after it had a `BUTTON` as its target
  and both `FreeRoam.onKeyDown` and the global handler in `app/main.ts`
  returned before looking at the key. Entering free roam with the `3` key
  instead worked perfectly, which is why it survived: the two ways in did not
  behave the same.

  `BUTTON` was in that list for a real reason — a focused button is activated
  by Space, and the transport's play button dispatches `pause`/`play`, so Space
  used to toggle playback twice. The cure was wider than the disease, and it
  caught every checkbox in the sidebar too (`INPUT` was matched with the type
  ignored). The guard asks about the **key** as well as the element now: a
  button or a link claims Space and Enter, a range input also claims the arrows
  and Home/End, a text box claims everything, and nothing else claims anything.

  **The pointer locks to the canvas**, requested from the `pointerdown` in the
  viewport because that is the user gesture the API insists on. A refusal is
  not an error: Chrome refuses for about a second after an Escape, so the drag
  path is kept and `movementX`/`movementY` drive the look either way. Leaving
  free roam releases the lock, the held keys and the drag, which is why
  `enabled` is an accessor rather than a field. `render/shooting.ts` aims at the
  centre of the viewport while the pointer is locked, since a locked pointer
  has no position and the crosshair would otherwise freeze at the click.

  `npm run freeroam` is the check, in real Chrome, and it was watched failing
  on the keyboard assertions the fix is for. **Asking for a lock and getting
  one are two different claims**, and only the first is about this code: the
  request is hooked and asserted everywhere, and the two assertions that need a
  *granted* lock are skipped by name, with the browser's refusal quoted, when
  there is none. Chrome refuses on an unfocused window, which made them fail on
  a clean tree — and a check that does that is a check people learn to ignore.

## And two that were one bug: the window and the gate

- `[fixed]` **"the window is never rendered" (`block=1&step=5`) and "gate c68
  does not render, play any sounds" (`block=10&step=2`) are the same two
  objects** — the class-0x44 spawns at evt `0x1580` and `0x15CC`, placed
  together by block 1 step 5 op 28, block 2 step 0, block 9, block 10 step 0
  and block 3, and kicked open on `set_script_flag 18` at block 2 step 2 op 6
  and block 10 step 2 op 5. `c68` is `render/overlays.ts` labelling an unposed
  spawn `c${class}`, and hp 0 is the selector: they are the only two
  **selector-0** class-0x44 spawns in the game.

  **An exporter gap, and then a second one in the port's placer.**
  `web/src/hod2lib/props.ts` knew class 0x44 as a hinge placer — selectors 1, 2
  and 4, all of which share `HingeUpdate` (`FUN_00473CF0`) — and every other
  selector fell out of `resolveForStage` unemitted. Selector 0 is not a hinge
  and has no pose of its own to emit:

  * `PropBuildScriptFlagEffect` (`FUN_00472B30`) allocates an object running
    `ScriptFlagEffectUpdate` (`FUN_00473B90`) and **never copies the spawn's
    position**. There is no `MatrixTranslate` anywhere in the family. The parts
    are placed by *motion 471*, in world coordinates: frame 0 seats them at
    `(±13.762, 0, −361.5/−362.8)`, which is those two descriptors' positions to
    three decimals.
  * What it draws is an **effect tree** — `g_effect_trees[2]` and `[3]`,
    three nodes each, one of which carries `komono_st1.bin` entries 6 and 7 —
    posed from that motion at `(nodes * 0x12 - 0xF) & ~3` bytes a frame, which
    is not the character stride `mot.md` documents.
  * `g_script_flags[0x12]` runs the clip, `[0x13]` despawns it, and each frame
    in `g_script_flag_effect_cues_a`/`_b` plays `PlaySoundId(0x1816A9)` —
    which is the "play any sounds" half of the report, and it is a cue list in
    the exe rather than anything the script says.

  The port half: `SpawnPropContainers` (`game/director.ts`) named `falling` and
  `story_switch` as class-0x44 containers and **fell through to class 0x41's
  arm for everything else**, so the first version of the fix spawned the two
  window halves as `PropContainerPlacer`s running `PlaceBreakableGroup` with
  group 0 — six breakable props that do not exist, and still no window. The
  selector table is a `Record` now, so a container with no entry is not built
  rather than built as something else.

  `game/class44/script_flag_effect.ts` is the transcription;
  `PropFamily.ScriptFlagEffect` puts it in the container pool, which is where
  `render/breakables.ts` already clones a model per asset slot and poses it
  `Rz · Ry · Rx` — `EffectPoseNode`'s own order. `tools/verify_effects.py` is
  the new corpus check: 29 of 29 trees walk to their `g_effect_bone_counts`
  entry and 13 of 13 `(effect, motion)` pairs divide by the effect stride. It
  caught a real bug in the first draft of the tree walker, which capped a
  node's children at 0x40 and returned 65 of effect 8's 145 nodes.

  Needed a re-export. Watched failing first: nine of the twelve new assertions
  in `web/test/port.test.ts` fail with the `effects` block absent from the
  bundle, which is what the exporter used to produce.

---

## And one about holes in the stage

- `[fixed]` **"triangles are missing in some places on the stage"** — reported
  on stage 1 from the rooftops north of the piazza, eye
  `(-1130.3, 125.2, -390.1)`. The cause is not culling, not the parser and not
  the region streaming: **the exporter was deleting 3–5% of every stage on
  purpose.**

  `nl1.drop_collapsed_uv_triangles` removes triangles whose three vertices are
  collinear in UV space, which is 5.1% of the game and which does look wrong on
  screen — one row of texels smeared across a whole face, a hard streak or a
  solid black panel. It ran by default in both halves of the exporter. On
  stage 1 that is 1,577 of 35,637 triangles, median 3 square units and up to
  3,849, and two of them are paving in the piazza: a pair of triangular holes
  straight through the world, visible from any rooftop overlooking the square.

  The premise was never checked against the binary. `WalkMeshChainAndDraw`
  (`FUN_004A7EF0`) submits every strip whole —
  `DrawPrimitive(D3DPT_TRIANGLESTRIP|LIST, FVF 0x112, verts, count, 0)` — and
  makes no per-triangle test of any kind; the records are copied eight dwords
  at a time with the UVs verbatim at dwords 6–7. **The game draws them.**
  `[proved]` The filter is now `--drop-collapsed-uv` / `dropCollapsedUv`, off
  by default, in both halves, and no bundle asks for it. Needed a re-export of
  all twelve.

  Three things were checked and cleared on the way, and each is worth not
  re-checking:

  * **The NL1 parser loses nothing.** Every one of the 389 models across the
    six stages ends on its chain terminator; not one hits a truncation, a
    bad back-reference or an implausible mesh size.
  * **Back-face culling is faithful.** Winding was re-measured against the
    models' own stored normals, split by the cases the rule keys on:
    triangle lists at `cull=2` agree 100.0%, strips at `cull=2` 99.94%, strips
    at `cull=3` 99.96%. The only population that disagrees is `cull=1`
    (88.45%), and those are the strips the game does not cull at all. A free
    camera behind a one-sided wall sees through it, and so would the game.
  * **Bit 7 of the strip control word** — "reuse the previous strip's culling
    and shade mode" — never changes an answer: across all 78,012 bit-7 strips
    in the stage geometry, the inherited culling equals the strip's own.

  Two things came out of the same investigation:

  * `counts.triangles` in the manifest subtracted the dropped count from a
    total that had already had them dropped, so stage 1 reported 32,485 for a
    file holding 34,062. Fixed; the number is now whatever the writer left.
  * The camera group's `look at` row printed the **script's** block target
    beside the live camera position, which are two different cameras the moment
    free roam takes over. It is `block target` now, with a `facing` row beside
    it carrying the direction the frame was actually drawn along. This is what
    sent the first hour of the investigation off aiming at a point nobody was
    looking at.

  `tools/verify_geometry.py` is the new check, and the only one that compares
  an export against the files it was made from: 216 scenery parts, each
  required to hold every triangle its `pol/` models declare. Watched failing
  first, against a bundle built the old way. Lesson `L23`.

---

## And two about the bundle you are actually looking at

Both reported while the fix above was being verified, and together they are why
that fix looked like it had not worked.

- `[fixed]` **"I rebuilt but the holes look the same"** — the browser's OPFS
  cache wins over the served bundle, per stage, and the only version checks
  were the manifest `format` and the schema digest. Turning off the
  collapsed-UV filter moved neither, so a stage cached before the fix went on
  winning over the rebuilt one indefinitely, with the holes still in it, and
  nothing on the page said so.

  `manifest.json` and every stage entry now carry a **builder digest** — a
  SHA-256 over the code in `web/src/hod2lib/`, generated into
  `web/src/bundle/builder_hash.ts` by `tools/gen_builder_hash.py` in the same
  shape as the schema digest. It **warns rather than refuses**: an exporter
  change usually leaves a bundle readable and merely out of date, and refusing
  would make every unrelated fix cost a full re-export before anything could be
  opened. The Bundle button turns amber and says *Bundle needs rebuilding*, and
  the screen behind it marks the stale tiles and names the exporter files that
  moved. `docs/formats/bundle.md` has the reasoning.

- `[fixed]` **"I rebuilt and *refreshed* and that worked — I shouldn't have to
  refresh"** — the bundle screen had two exits and neither adopted what it had
  just built. `Play stage N` was `window.location.reload()`, on a comment
  claiming a stage was not hot-swappable from there; it always was, because the
  top bar's stage picker has always been `state.stage = n; loadStage()`. And
  `Back`, which is the exit you take after rebuilding the stage you are already
  on, did nothing at all: the page went on drawing the geometry it had.

  The screen now tells the player what it built, and closing it by any route
  reloads the stage if it was the one replaced. No page reload on either path.
  Two more things came with it: the screen opens on the stage that is playing
  rather than on stage 1 Arcade, which is the commonest reason to be there, and
  `npm run bundle-flow` asserts both — that the play button switches without a
  reload, and that `Back` picks up a rebuild underneath it. Both assertions
  were watched failing first, and the second of them is the reported bug.

---

## And two about the bundle screen itself

- `[fixed]` **"the warning should only show if the stage I'm playing is out of
  date, not if ANY are"** — the first version asked whether any stage either
  bundle held was stale, which meant rebuilding the one you were playing left
  the button amber because five others in the served bundle were still old. A
  warning that stays on after you have done what it asked is one people learn
  to ignore. `Player.bundleStale` is a getter over the slot the player is
  actually on now. The bundle screen still lists every stale stage, because
  that is the screen you go to in order to do something about them — and it
  gained a **Build all** button, which builds all six in the selected mode.

- `[fixed]` **"when building the stage, it should render a screenshot 2 secs of
  simulated wallclock time into the stage and use that as the screenshot"** —
  `Player.captureThumb`. Every stage the bundle screen builds is loaded,
  stepped through `stepOneFrame`, and photographed. Simulated rather than
  waited out, so it costs a fraction of a second and lands on the same frame
  every time: the port is deterministic given the stage and the seed, so the
  picture is a property of the stage rather than of whoever was watching.

  **Seven seconds, not the two first asked for**, on a second look at what the
  frames hold: two is early enough that three of the six are still in the swoop
  of an opening cutscene. Seven puts stage 2 on the overturned car with the
  civilians round it and stage 3 on the two of them in the boat. It is not free
  either way -- stage 1 at seven seconds is a close-up of a police car's roof
  light, where at two it was the piazza from the rooftops. `THUMB_FRAMES`. Audio is
  muted across it, and the address bar is left alone.

  The load-time capture stays as a fallback for a stage that was only ever
  served, gated on the stage having no picture yet — so it can no longer
  overwrite the deliberate one.

  **Three things had to be found before it produced a picture at all**, and
  each is in a comment where it bit:

  * `loadStageInto` stops the transport on its way in, so `playing = true` set
    before the load was cleared by the time the frames ran. The walker still
    reached its first wait and the region still streamed, so it looked like it
    worked — the picture was a flat fill of the fog colour.
  * Rendering and copying inline, in one synchronous block off the frame loop,
    draws and then copies the clear colour. 222 draw calls and 2,880 triangles,
    measured, and a flat image. The picture has to be taken from the
    `requestAnimationFrame` callback, so `captureThumb` asks the loop for one
    and waits.
  * The loader's own thumbnail request, now asynchronous because it checks
    whether a picture exists first, landed a second later — during the teardown
    of the next stage — and overwrote the good one with an empty frame. It is
    suppressed during a capture, dropped if the stage moved on, and never taken
    while a load is running.

  `npm run bundle-flow` reads the stored picture back and requires more than
  200 distinct colours in it. Counting non-black pixels was the first version
  of that assertion and it passed on the flat fill.

---

## And one about when the picture is taken

- `[fixed]` **"just built all and none of the screenshots appeared, even after
  refreshing"** — the pictures were taken when the bundle screen *closed*, not
  when a stage was built. Two consequences, and the report hit both: the tiles
  stayed empty for the whole run, so a *Build all* looked like it had done
  nothing; and reloading the page instead of pressing Back — the natural thing
  after a long build — threw the list of stages owing a picture away, so none
  was ever taken.

  Each stage is photographed as it lands now, while the screen is still up, and
  the tile it sits in fills in behind the run. Three things had to change
  together:

  * **The worker writes the manifest after every stage**, not once at the end.
    A stage the index does not name cannot be loaded, and loading it is how its
    picture is taken. This also fixes **Stop**, which used to throw away every
    completed stage in the run: the files were in the cache and no manifest
    named them.
  * `Player.stageBuilt` queues the captures and runs them one at a time, and
    `closeBundles` waits on that queue before its own load, so the last picture
    cannot be torn down half-taken.
  * `ExportScreen.rescan` re-reads the pictures, not just the labels, and is
    **reentrant**. Six stages finishing seconds apart start six overlapping
    scans, and each one was revoking the `blob:` URLs the one before it had
    just put on screen — the last tile came out empty every time with its
    picture sitting in the store. Only the newest scan installs anything.

  `npm run bundle-flow` asserts the tile has its picture **without the screen
  being closed**, which is the reported bug stated as a check.

---

## And one about the gun making no noise

- `[fixed]` **"No gunshot sound, impact sound etc"** — the gunshot, and only
  the gunshot. Everything else in that sentence was already playing, and the
  first thing this cost was the assumption that the audio chain was broken:
  `web/tools/audio.mjs` was written to find out where, and found nothing wrong
  with it. Unmuted, stage 1 block 4, a volley of shots: `ST1_AR`, five flesh
  impacts and bone hits, three surface ricochets, three zombie voices, a
  civilian cry and a prop breaking all reached the output. `COMMON\GUN5_22.WAV`
  did not, because nothing in the port ever asked for it.

  `PlayerFireAndReloadUpdate` (`FUN_00414940`) ends a shot with three calls in
  a row — `BuildShotRay`, `PlayerShotEffectSpawn`,
  `PlaySoundId(g_gunshot_sound_ids[player])` — and `ResolveShotRequest` had
  transcribed the first two and stopped. `g_gunshot_sound_ids` (`0x004EC8BC`)
  is two dwords, `a9163400 a9163300`: player 0 fires `COMMON\GUN5_22.WAV` and
  player 1 `COMMON\GUN4_22.WAV`, which is the only difference between the two
  guns. The port now emits it on the line after the muzzle flash, so a shot
  that hits nothing is as loud as one that lands — which is what the engine
  does, because the sound is at the trigger and the hit test comes after.

  Three things deliberately *not* added, each because inventing them would be
  a sound the engine does not play:

  * **the dry trigger is silent.** With the magazine empty the engine never
    reaches the gunshot; it goes to `PlayerRefillMagazine` (`FUN_00414B30`)
    and its `0x3E16A9` `COMMON\RELOAD1_44.WAV` instead. The port has no ammo
    and no `g_nFiringGate`, so it has nowhere to play a reload from. `[open]`
    until the magazine is ported.
  * **Original Mode's per-weapon gunshots are not ported.** `g_GameMode == 1`
    fires through `PlayerFireOriginalModeWeapon` (`FUN_00414B90`), which
    prefers `g_original_weapon_gunshot_ids` (`0x004EC9A0`) — eight entries,
    `SHOT_GUN`, `MCHN_GUN`, `GRENADE`, `MAGNUM`, `AIR_GUN`, `TOY_GUN1`,
    `RULE3` — indexed by `g_original_weapon_sound_kind` (`0x009A224A`).
    `ResetOriginalModeLoadout` writes that index 0, entry 0 of the table is 0,
    and no instruction in the image writes `0x009A224A`, so on the reading so
    far every gunshot in the shipped game falls back to the two ids above.
  * **`ActorPlayHitVoice` stays where it was.** The flesh impact and the hurt,
    kill and headshot voices are `FUN_0040A6F0`, called from `ZombieOnShot`
    (`FUN_00453EB0`) and *not* from `ActorShotFeedback` (`FUN_00454050`) —
    which owns the blood, the result-5 impact sprite and its ricochet, and
    nothing else. The port already plays them from `render/shooting.ts` off
    `shot.resolved`, and they were audible before this change and after it.

  `npm run audio` is the check, and it is the only one in the tree that can
  see this: it routes every media element the page plays through an
  `AnalyserNode` and asserts on the **peak sample**, so a file that 200s and
  decodes to silence fails it and so does one the page never asked for. Under
  it `COMMON/GUN5_22.WAV` reads 0.589. `test/port.test.ts` asserts the ids and
  their order in the frame; it fails on three lines with the emit removed.

---

## And one about the shutter

- `[fixed]` **"Shouldn't be able to shoot while the shutter is closed. Check
  the game code to see how the real game handles this"** — the port had every
  piece of this except the one that mattered. `HudDrawShutterState`
  (`0x00413970`) drove `g_nFiringGate` (`0x009C8E00`) in `script/state/
  shutter.ts`; the walker exposed it; the save slice carried it; `Walker.canSkip`
  read it. **Nothing on the shot path had ever looked at it.** It had exactly
  two readers in the whole tree, and one of them was an assertion.

  The engine's rule, and the polarity, from `PlayerFireAndReloadUpdate`
  (`0x00414940`):

  ```c
  if (trigger_latch) {
    if (magazine empty)          { auto-refill }
    else if (g_nFiringGate != 0) { ammo--; shots++; BuildShotRay();
                                   PlayerShotEffectSpawn(); gunshot(); }
  }
  ```

  So **non-zero means firing is allowed**, and the test sits above
  *everything*: a trigger pulled with the gate down is not a shot that misses,
  it is not a shot. No ammo comes off, the accuracy denominator does not move,
  no ray is built, and — the part that is visible — `PlayerShotEffectSpawn`
  never runs, so there is no muzzle flash and no tracer either. `0x00414C2D` is
  the same test in the Original Mode routine at `0x00414B90`.

  The polarity was **already right** in `hod2lib/script.ts`'s `SHUTTER_GATE`
  and in [`formats/evt.md`](formats/evt.md), and it reads backwards for a
  reason worth keeping: state 0 is *"close, and enable firing"* because it
  draws the closed bars **and** writes 1, so a letterboxed boss intro is still
  playable. State 5 draws the same bars and writes 0.

  What changed:

  * `g_nFiringGate` is a field of `G` now, cleared by the port's
    `ResetSceneOnEnter` the way the engine's clears it at `0x0045EEAC`.
    `script/state/shutter.ts` is still its only writer and reaches it through
    an accessor, so there is one word and not two — the thing that file was
    written to avoid. It moved because the routine that reads it is in
    `game/`, not `script/`.
  * `ResolveShotRequest` returns at the top while the gate is down, above the
    shot counter and above the effect spawn. The request is **dropped**, not
    held: the engine polls the trigger once a frame, and a queue that saved the
    click would fire it when the shutter opened.
  * The crosshair follows it, because the engine's does — `HudDrawCrosshair`
    (`0x004169C0`) will not draw the reticle while the word is zero, and
    `PlayerUpdateInPlay` (`0x00413E90`) will not draw the ammo readout either.
    The system cursor comes back while it is hidden, which is a port decision
    and marked as one: the cabinet has a physical gun, and `cursor: none` with
    no crosshair leaves the viewer nothing to point with.

  Reload is deliberately **not** gated, because the engine does not gate it —
  only the reload *sound* is (`0x00414B75`). The port has no ammo and no
  magazine, so there is nothing there to exempt yet.

  The safety question this raised, and the answer: gating the trigger is only
  safe if the shipped scripts raise the gate, and raise it early. Walking all
  six stages' scripts says they do — the first `hud_shutter_state` of 1 or 6
  lands within the first 150 instructions of every stage, and the gate is up
  for 99.9 % of the instruction stream. The 0.1 % is the bug.

  `test:port`'s firing-gate section drives it: the same shot blocked and then
  allowed, the muzzle dark and then lit, and the five states that write the
  word each asserted in the direction they write it. Without the fix, eight of
  its assertions fail.

---

## And two more about stage 3's opening

- `[fixed]` **"the boat isn't moving with the characters"** — and it was two
  boats, not one. The pair sail the canal on `op_st3` path 340; the boat that
  stood still beside them was a *different* object, and the boat that should
  have been under them was not in the bundle at all.

  * **The one under them.** `ScriptedHumanoidDraw` (`FUN_00484FF0`) switches on
    the descriptor word `desc + 0x2A` and draws a second model beside the
    skeleton. Case 3 is
    `CamEvalObjectPath6(obj+0x135C, g_cam_path_frame)` followed by
    `AssetDrawSlot(0x1A37)` — the **same path slot and the same frame the
    actor itself is riding**, so the boat is under its passenger by
    construction and the engine needs no parenting of any kind. Stage 3's
    spawn 4128 is the only variant-3 actor in the six stages that reaches a
    shot; `rigs_data.ts` had already recorded the arm as *"the slot is
    runtime, so nothing is exported for this part"*, which is exactly what the
    scene was missing. The exporter now carries `drawVariant` on every
    class-0x25 program and ships slot `0x1A37` in the hidden `slots_actor`
    rig when a stage has a variant-3 descriptor; `render/slotmodels.ts` places
    it. The model is a motorboat, which the render settles — `asset_slots()`
    resolves `0x1A37` to `etc_1_05.bin` entry 0 and that name says nothing.
  * **The one that stood still.** `Class26Subtype2Update` (`FUN_0048EAD0`,
    class 0x26 subtype 2) draws the same model, and its `g_active_cam_path`
    switch names 124, 125, 126, 127, 130, 133, 134 and 135 — not 121, 122 or
    123, which is the whole opening. Its `default:` arm jumps past the pose
    block to the draw, so the engine holds whatever `obj+0x40`..`obj+0x6C`
    contain, which before the first named shot is the spawn descriptor's:
    stage 3 block 0 step 2, script address 3244, `(0, 0, 0)`. `RigLayer`
    placed it from `op_st3` 342 at frame 0 instead — about
    `(−884, −17, −2136)`, in the canal and a hundred units off the shot. The
    file's own `[diverges]` note had said it drew the baked root pose all
    along; `Instance.posed` makes the code do what the note claimed.

  `node web/tools/stage3.mjs` drives the page and compares the **boat node's
  own world position** against the two passengers' — 8.1 units apart at every
  mark, which is `g_class25_path_offsets` records 4 and 5 and nothing else —
  and asserts the class-0x26 rig is still at its spawn pose. It fails on nine
  of its thirty checks without the two fixes.

- `[not-a-bug]`, with a real defect underneath it — **"is the fog definitely
  using the cut scene camera location for its near/far?"** It is, and so is
  the game. `FUN_0040AD90` and `FUN_0040C2E0` hand the scene light block's
  `+0x30`/`+0x34` straight to `PushSceneFogFromLightBlock` (`FUN_0040C320`),
  which is one `SetFogRange` (`FUN_004ABDF0`) call and nothing else — no
  camera, no eye, no transform anywhere on the path. Under
  `D3DRENDERSTATE_FOGTABLEMODE = D3DFOG_LINEAR` those are **eye-space depths**,
  so they are relative to whichever view matrix draws the frame, which during
  a cut scene is the cut-scene camera. The port has the same property for the
  same reason, and the tick order puts `CameraDrawSystem` ahead of `SceneFog`.

  What *is* wrong is one line of the port. `SetFogRange` doubles both values
  and, when `near*2 >= far*2`, **swaps them**; it has no on/off test at all.
  `render/fog.ts` had an invented one — `far > near` — and it cost two things
  the shipped scripts do forty-odd times between them:

  * **Every stage's opening and closing fade is fog.** 40 sites set or tween
    `fog_near = fog_far = 1` against a black fog colour; a zero-width
    `D3DFOG_LINEAR` ramp is a step, so everything past it is 100% fog. The
    port switched fog **off** at exactly the frame the fade completed, so a
    fade to black ended by snapping back to a fully lit scene.
  * **Stage 5 blocks 7 and 9 set `near 1472, far 614`.** The engine fogs
    1228..2944; the port fogged nothing for the whole span.

  `test:render` asserts on `scene.fog` itself for the ordered, reversed,
  zero-width, negative-near and never-set cases, and `web/tools/stage3.mjs`
  watches stage 3 block 11's fade land on `planar 2..2 #000000` and stay
  there.

  As for "starting completely in fog": the first four frames of stage 3 really
  are near-black, and that is the script's own fade-in — `fog_rgb (0,0,0)`,
  `near 1`, `far 1`, then a 30-frame tween to `(101,147,164)`, `70`, `247`.
  Measured over the opening the frame is back to a full 1,200 distinct colours
  by frame 10. Nothing later in the opening is a wash: the canal runs at 900
  distinct colours and a mean of `(32, 37, 34)`, which is night. If what was
  being seen was a *longer* stretch of fog than that, it is not reproducible
  at this commit and wants a fresh look with the two fixes above in place —
  the missing boat left the pair sitting in open water, which is its own way
  of reading as "nothing but haze out there".

## And one about a zombie that made its death sound and carried on

- `[fixed]` **"the 14/8/2 `0x8094` `zsass` doesn't seem to die. shoot him
  enough, he makes a dead sound, but then he keeps on [the] player"** — the
  locator is the player's own: **stage 2, block 14, step 8, op 2**, the
  `spawn_obj` whose descriptor sits at evt `0x8094` (32916), and the sidebar's
  actor rows print that address in hex. It is `class 49` / character type 0x16
  / behaviour set 1 with 130 hit points, entering on state 20, and its step
  ends on `wait_enemies_alive <= 0` at op 18.

  The death sound was real and so was the death: `ResolveHit` (`FUN_00409430`)
  took the hit points below one and `render/shooting.ts` played the kill voice
  off exactly that. What was wrong is that **the round should never have
  reached the damage tables at all.**

  `DispatchHit` (`FUN_004092F0`) is the **only** caller of `ResolveHit` in the
  image — one xref — and it jumps past the call while `obj+0x34` bit `0x100`
  is set:

  ```
  00409336  8b4834      MOV  ECX, dword ptr [EAX + 0x34]
  00409339  f6c501      TEST CH, 0x1
  0040933c  750e        JNZ  0x0040934c        ; past the CALL
  0040933f  e8ec000000  CALL 0x00409430        ; ResolveHit
  ```

  So an actor whose class has made itself shot-immune takes **no damage**: not
  reduced damage, and not a hit that is resolved and then thrown away. The port
  had the *reaction* half of that rule in three places and the damage half in
  none. `ThrowerOnShot` (`FUN_004499A0`) refuses to react on the same bit,
  `ZombieOnShot` (`FUN_00453EB0`) likewise, and `ThrowerStateGetUp`'s own doc
  comment said in so many words that *"shots ricochet off a thrower that is
  getting up"* — while `ResolveShotRequest` charged the damage anyway. That is
  [L26](LESSONS.md) twice over: three notes describing a rule, no check saying
  the code obeyed it.

  The window the bit covers is precisely the window nothing is listening in.
  `ThrowerStateFallAndLand` (`FUN_0044A450`) raises `0x100` when the body
  settles, and its **sub 4 is a switch arm** — reached from `obj+0x1312`, not
  through sub 3's survive test — so nothing on that path re-reads the actor's
  death. A `zsass` killed lying on the ground or mid-get-up was therefore stood
  back up by its own death state, into `ThrowerStateGetUp` when the head-shot
  latch was up and into the hub otherwise. It then stood, threw, pounced and
  leapt aside as a corpse, still inside `g_enemies_alive`, holding
  `wait_enemies_alive` open behind it.

  **Measured, before and after.** A sweep of 11,520 firing patterns against
  that spawn — both hosts, twelve rates, eight phases, sixty seeds, a random
  bone per round — left it acting while dead in **2,224** of them, for up to
  106 frames at a stretch; after the fix, in **none**. In real Chrome at
  `?stage=2&block=14&step=8`, `web/tools/downed.mjs` counts one round charged
  while the actor was shot-immune (35 hp, frame 353, `FallAndLand` sub 4)
  before and **zero** after.

  The survive-versus-die rule itself was never wrong, and is worth writing
  down because it was the first suspect: `ThrowerStateFallAndLand`'s case 3 is
  `if ((obj+0x34 & 0x4000000) == 0 && obj+0x1350 != 0x5a)` — alive and not
  landed on the killing surface — get up; otherwise die. The port matches it.
  Its `else` arm carries one further gate, `obj+0x1F1 != 0`, and that byte has
  **six reads and no writes anywhere in the image**, so it is dead code of the
  same family as `obj+0x3B8` in `ResolveHit`. `[proved]`, and not ported.

  What a refused round still does is what the player sees: the shot marked the
  actor, so the feedback runs. `ThrowerShotFeedback` (`FUN_00449B20`) opens
  `if (obj+0x34 & 0x100) g_hit_result[p] = 5;`, which is the ricochet sprite
  and clink and no blood, no score and no head combo. `web/test/port.test.ts`
  asserts all of it on the actor's own state and on both enemy counters — five
  of its ten checks fail without the fix, the loudest being 601 frames dead in
  `LeapAside`.

---

## And one about the civilians standing still

- `[fixed]` **"civilians seem to be missing their root motion"** — two broken
  links, one in each direction, and the second is the answer to the question
  the report asks.

  **Yes, the engine's civilians use root motion, and it is the same routine
  everyone else's goes through.** `SkeletonApplyRootMotion` (`FUN_00410C50`)
  tests one thing before it moves an actor —
  `if ((*(byte *)(model + 100) & 2) != 0)` — and `model + 100` is `model+0x64`,
  which is `obj+0x1F8`. `ActorBuildSkinnedModel` (`FUN_00410440`) writes
  `MOV dword ptr [ESI + 0x64], 0x3` at `0x004104C5`, unconditionally, so every
  skeletal actor in the game is built with it on. `[proved]`

  ### The link that was broken: `obj.scale` was a denormal

  `CivilianRunScript`'s (`FUN_0048B9E0`) op 0x27 writes the character size:
  `*(int *)(g_cur_actor_model + 0x116c) = param_2[1]`, the operand stored
  verbatim into a float field. `SkeletonApplyRootMotion` runs
  `MatrixScale(model+0x116C)` into the same matrix it rotates the root delta
  through, so that field scales the ground a clip covers.

  The port's opcode switch had `SetScale` at the bottom of a fall-through group
  with four opcodes the comment above it calls *"unread ... deliberately no
  behaviour"* — `SetGlobalB` (0x1B), `SetAttachMode` (0x23), `SetAttachTarget`
  (0x24) and `SetPairA` (0x25). All four therefore ran `SetScale`'s body. Their
  operands are small integers, `AsFloat` reinterprets a dword's bits, and
  `AsFloat(2)` is `2.8e-45`: the civilian's every authored step was multiplied
  to nothing while her legs kept walking. **125 commands across the shipped
  streams run one of those four**, against **one** that runs op 0x27 — and that
  one passes `0x42480000`, which is 50.0.

  Measured over all six stages' 53 civilians, 30 s each: eight carried a
  denormal scale, and stage 4's two `char_adv`-type civilians on motion 594
  (net root translation `-10.8`) covered exactly `0.000` units. With the case
  split out they cover `9.795`.

  ### The link that was missing: the script owns the gate, block by block

  Ops 0x00 and 0x01 write that gate on every clip **change**:

  ```c
  if (*(int *)(g_cur_actor_model + 0x20) != param_2[1]) {   // a different clip
    *(int *)(g_cur_actor_model + 0x20) = param_2[1];
    if ((*g_cur_civilian & 0x100000) == 0)
      uVar7 = *(uint *)(g_cur_actor_model + 100) & 0xfffffffd;   // clear
    else
      uVar7 = *(uint *)(g_cur_actor_model + 100) | 2;            // set
    *(uint *)(g_cur_actor_model + 100) = uVar7;
  ```

  `*g_cur_civilian` is the wait word. So bit `0x00100000` of the word that
  opened the block is *"this block's clip carries her"*, and **289 of the 596
  shipped wait commands set it while 297 do not** — the second group animate in
  place. The port had no gate at all and carried every civilian in every block,
  which is the same defect as the first one with the sign reversed, and it was
  invisible because the two cancel: an actor dragged by her captor still moves.

  `CivilianReapplyWaitCommand` (`FUN_0048B760`) deliberately does **not** write
  it — it touches neither `model+0x20` nor `model+0x64` — so a skipped block
  leaves the gate where the last real clip change put it. The port's
  `obj.rootFrame = -1` is the engine's baseline reset (`model+0x1160`) and sits
  in the same place, which is why re-opening the gate cannot lurch: the only
  thing that can change it is the only thing that clears the baseline.

  ### What changed

  * `Actor.motionFlags` (`obj+0x1F8`) and `MotionFlag`, built at
    `MOTION_FLAGS_INIT = 3`. Classes 0x30 and 0x31 never write it, so nothing
    about the zombies moves.
  * `ApplyRootMotion` tests `MotionFlag.RootMotion` first, which is the whole
    of `FUN_00410C50`'s `if`.
  * `CivilianSetMotion` writes it from `sub.wait & CivilianWait.RootMotion`,
    inside the same "is this a different clip" test the engine keeps it in.
  * `CivilianWait.RootMotion = 0x00100000`, with the decompiled arm on it.
  * `class10/script.ts`'s fall-through split: the four unread opcodes `break`,
    and `SetScale` has its own case.

  Four assertions in `test:port` drive it on the actor's own position across
  frames: a block *with* the bit walks `-Z`, the same clip in a block *without*
  it does not move at all, the four unread opcodes leave the scale at 1 and she
  still walks, and op 0x27 does write it. Reverting the gate fails the second,
  reverting the fall-through fails the third, and dropping the wait-word read
  fails three of the four.

  `web/tools/civ_walk.mjs` (`npm run civ-walk`) is the eyes half — L25, because
  this is a report about something you can see. It deep-links to stage 1 block
  1 step 8, drives whole game frames through `?drive=1`, and reads the position
  and gate straight off the Actors panel. Stage 1's `0x1828 hito_fem` reads
  `root on · scale 0.9` and moves **20.87** units over 590 frames; with the
  fall-through put back she reads `scale 1.4e-45` and moves 12.44 — because her
  captor is dragging her, which is exactly why a check on position alone would
  have passed the bug and the tool fails on the denormal instead.

  Still `[open]`: the **other** root-translation path. `CivilianApplyMotionPose`
  (`FUN_0048C310`) has an arm under wait bit `0x20000` that walks the actor
  from the pol file's root bone rather than from the clip, and bits `0x8000`,
  `0x10000` and `0x200000` steer the rest of that routine. Sixteen of the 596
  wait commands set `0x20000`, six of them alongside `0x100000`. It is not
  ported and those blocks stand where the script put them.

---

## And five from stage 3's block 2

Reported together on 2026-09-07, all five at the same place in the script.
**Four of the five were much wider than the place they were seen from**, and
none of the five was the thing the report named.

- `[fixed]` **"the civilian/enemy are jumped over"** at
  `?stage=3&mode=play&block=2&step=4&op=0`. Literally that: the script never
  stopped for them. `g_script_flags` (`0x009C7200`) is **one** array in the
  engine -- `EvtOpSetScriptFlag48` (`FUN_0045FD70`) is the script's only write
  and six actor routines write the same array -- and the port kept two,
  rebuilding the shared one from the walker's copy once a frame. Every flag an
  actor raised was wiped on the next tick, so `wait_script_flag` could only
  ever open on a flag the script itself set. **Across all six shipped scripts
  every one of the forty-odd such gates names a flag that stage's own script
  never sets**: the opcode only ever means *hold until an actor is finished*,
  and the port was walking past every rescue in the game. The gate now holds
  230 frames while the hostage is alive, and she raises it whether she is
  rescued or killed, so it cannot hang.

- `[fixed]` **The axe thrower retreats into the wall.**

  **The actor is not what this file said it was.** `[proved]` stage 3 contains
  no class-0x31 spawn at all; the axe man is **class 0x30, character type
  0x13**, body condition 7, initial state 33. This file had it as "class 0x31,
  behaviour set 1" and that was wrong for both halves -- the same mistake
  recorded once already above, where `0x6784` is class 0x30 and not 0x31.

  The engine's ending is a two-way switch on a **spawn-record
  bit**, not a query about the room: set, and the actor releases its counts and
  its slot and never moves again; clear, and it walks or leaps.
  `EnemyZombieInitByCharType` (`FUN_00452FD0`) *moves* that bit out of
  `obj+0x34` bit 1, because bits 1 and 2 there are what `MarkActorShot` writes
  to name the player who fired. **Exactly two records in the shipped game set
  it, and both are these axe men.** The port had no `EnemyZombieInitByCharType`
  at all, so both took the walk arm. The retreat itself was faithful, which is
  what made this slow: the walk has no test of any kind, and the collision the
  script selects there is 31 quads of flat water 24 units below the actor's
  feet, so nothing pushed back. The wall is scenery, six units behind him.

- `[fixed]` **The axe thrower throws no axes.** A second, independent defect on
  the same actor, in a different layer -- the two only look like one report's
  two halves because they share a spawn.

  The simulation always threw, on time, for damage. **Nothing was drawn.** The exporter's gore rig walked class 0x31's hand table rather than
  the one `ZombieThrowHandWeapon` (`FUN_0045A240`) switches on, so the axe and
  both hands' models were in no rig: the projectile cloned to null and the hand
  swap failed, which leaves the axe in a fist that has just thrown it. The same
  shape as the civilians' hair, one table over.

- `[fixed]` **The camera jumps** shortly after
  `?stage=3&mode=play&block=2&step=4&op=24&frame=1551` -- at camera frame
  **1660**, 3.62 world units of eye in a frame where the shot travels 1.25,
  with a 9.58 degree aim swing out and 9.46 back.

  `CamAdvancePathFrame` (`FUN_004035E0`) publishes the frame, evaluates the
  path and sets the angles **before** the test that retires the action, so the
  camera block holds the pose of every frame from start to end inclusive. The
  port seated on *done*, one tick short, and so **every non-static `cam_play`
  in the game lost its last frame.** Two neighbours were checked and left
  alone: the engine does not draw frame 1661 either, and the ~10 degree snap
  back onto the rail when the last enemy deregisters mid-shot is structural
  (`[not-a-bug]`, both `[proved]`). Neither was smoothed -- see L27.

- `[fixed]` **James does not render in the third-person cutscenes** at
  `?stage=3&mode=play&block=2&step=5&op=22&frame=30`. Nothing in the data calls
  him James; he is class 0x25, character type `0x39`, identified through
  `gameover_player.bin`, the only asset filename in the game that says *player*.

  He was killing himself on spawn, and so were 109 others.
  `ScriptedHumanoidUpdate` (`FUN_004842A0`) case 10 is `if (g_active_player ==
  mode)`, else scan forward for the marker that ends the branch. Three
  readings were wrong: `0x009C7000` is `g_active_player` and not a player
  count, mode `-2` is the `endif` marker and not a fourth comparison, and the
  skip stride is a literal 8 taking no notice of the 16-byte commands. The port
  always fell through, justified by *one player is the port's only
  configuration* -- and the arm an `op 10` guards is very often the kill. The
  exporter followed only the fall-through edge, stopped at that kill, and
  shipped a four-command program whose every path ended in death: the arm the
  actor really runs was never in the bundle. **110 of the twelve bundles' 274
  class-0x25 spawns ran a kill on the frame they were made; it is 42 now, and
  those 42 are the twins that are meant to go.** Not stage-3-specific: stage 1's
  opening has its over-shoulder shot back.

## Nine reported on 2026-09-09

All `[open]` at the time of writing, all with the reporter's own locators,
which are the player's URL parameters and are reproducible as given. Four of
them are `?stage=5` and `?stage=6`, which no report had reached before.

**Two of the nine may be one defect**, and both are cars carrying zombies: the
stage 2 rider that never appears and the stage 5 zombies that stand too far
away. `g_carrier_object` and the port's guard on it are on both leads.

- `[open]` **The thrown axe spins about the wrong axis, and *which* zombie
  threw it decides whether it is wrong.** That last part is the reporter's,
  added after the first write-up, and it is the useful half: it rules out the
  render being uniformly wrong and points at the per-thrower data.

  Two things in the tree to weigh it against. **The spin is already per
  character type and per hand.** `hod2lib/combat.ts` gives `THROWER_SLOTS`
  two class-0x31 types — `0x16` (`zsass`) with `spin: 0x600` and `0x18` with
  `spin: 0`, which does not tumble at all — and `class31/thrower.ts` negates it
  for one of the two hands (`hand.bone === 5 ? cfg.spin : -cfg.spin`, commented
  "which hand it left decides which way it tumbles"). Class 0x30's throwers are
  a **separate family** with no spin table at all: `class30/throw.ts` makes one
  up, `(hand.bone === 5 ? 1 : -1) * (0x100 + rng.int(0x200))`, over three
  character types `0x01`, `0x13` and `0x14`. A randomised spin the engine may
  not have is the first thing to check against the binary.

  **And the axis has been changed once already for this exact symptom.**
  `render/projectiles.ts` says the span used to rotate about Z, that Z
  "cartwheels the weapon sideways", and that the tumble is the Y term of
  `ThrownWeaponUpdate`'s `Rz(obj+0x6C) * Ry(obj+0x68) * Rx(obj+0x1364 +
  obj+0x64)`. It is on Y today and is still reported wrong.

  So: establish which thrower was throwing. If it is a class 0x30 one, the
  invented spin is the lead; if class 0x31, the axis reading or `Rx` being
  non-zero in flight is. Naming the zombie narrows this to one of two files.

- `[open]` **A roller shutter is missing from stage 3**, at
  `?stage=3&mode=play&entry=7&block=8&step=2&op=23`. **A physical door**: a
  real roller shutter over a doorway, which should roll up, after which the
  zombies come out through it. At the moment there is no shutter there at all.

  **This is not the port's `shutter`, and the two must not be confused.**
  `script/state/shutter.ts` is the **HUD letterbox** — `g_bHudShutterState`,
  the two black bars that close over the frame — and has nothing whatever to do
  with a door. A search for the word finds it first and it is the wrong thing
  every time. The door is scenery: a prop or a class-0x33 scripted hinge, and
  `docs/formats/spawns.md` is where its class is named.

  Whether it is never placed, placed and never drawn, or placed and never
  animated is the first thing to establish, and the answer decides which half
  of the tree it lives in.

- `[open]` **Zombies are silent, both idle and attacking.** Consistent with the
  tree rather than surprising in it: `game/class30/` emits one `sound.play` in
  the whole directory, from `target.ts`, and `entrance.ts` already carries a
  declared `[diverges]` saying the engine's landing plays `0x2A16A9` (or
  `0x1C16A9`) and the port plays nothing. So this is not one missing call, it
  is the class's sound arm never having been ported. `docs/formats/sound.md`
  and `PlaySoundId` are where it starts.

- `[open]` **Sound settings do not survive a reload, and the two controls are
  in the wrong places.** A change request rather than a defect, recorded here
  because it was reported here. Three parts: (1) whether sound is on should be
  stored state like everything else in `PlayerState` — it is neither in the URL
  nor in `localStorage` today, so every reload comes back with audio in its
  default state; (2) the volume slider, `#volume` in `ui/panels/Transport.tsx`,
  belongs in the debug sidebar; (3) the mute button, the `.sound` button beside
  it, belongs in the top bar. Both are singletons in the transport bar today
  and the stylesheet holds them by id, which is the thing to be careful of when
  moving them.

- `[open]` **The van at `?stage=5&mode=play&block=0&step=4&op=9&frame=352` is
  not drawn — only its rear doors are.** A prop whose parts are drawn in part
  is the shape of a missing model rather than a missing placement: something is
  building the hierarchy and finding one child of it. `verify_attachments.py`
  is the check that covers the equivalent failure on characters and would be
  the model for one here.

- `[open]` **`0x0A68 znjoe` and the rest of its character type should have a
  worm that bursts from the chest, and do not.** `znjoe` is one of the class
  0x30 character variants, `0x01`–`0x14` in `docs/formats/spawns.md`. One piece
  of corroboration already in the tree: the sound records name a **worm**,
  `WORM_TUBU`, and the sound table is how several of this game's objects were
  identified in the first place. The reporter asked for the whole of the
  class's missing behaviour, not only the worm, so this wants the character
  type's arms read end to end rather than one effect added.

- `[open]` **The three zombies that should travel with the car at
  `?stage=5&mode=play&block=2&step=2&op=50&frame=599` stand far away instead.**
  The reporter's dump is the useful part:

      0x1D44 znnick  · d=2890 · DelayedStrikeInPlace/4 · hp 130/130 · motion 696
      0x1D74 znnickb · d=2808 · DelayedStrikeInPlace/4 · hp 150/150 · motion 696
      0x1DA4 znnickb · d=2824 · DelayedStrikeInPlace/5 · hp 150/150 · motion 690 · permit

  `ZombieStateDelayedStrikeInPlace` (`FUN_0045E830`) is annotated as having
  exactly **three spawns, all in stage 5**, and as never approaching and never
  leaving — so these are those three, in the state the data puts them in.

  **The sharp part: the port already claims this distance is correct.**
  `class30/scripted.ts` carries a doc comment naming *this exact locator* —
  "`wait_enemies_alive <= 0` at step 2 op 50 with four state-32 `znnick` alive
  at `d≈2870`, which is where the descriptor puts them and where this state
  leaves them" — and concludes **"the distance was never the bug"**. The bug
  chased from that locator before was a despawn: `ZombieState.Leave` had no
  `case` and the actors stayed alive.

  The reporter says they should be riding the car. That comment says standing
  at d≈2870 is right. **One of the two is wrong, and settling which is the
  whole of this report.** Do not read past the comment on the way in; it was
  written from the same URL.

  The lead if the reporter is right: state 32 **reads the carrier**. The engine
  dereferences `g_carrier_object` (`0x009A5C34`) in it with no null test, at
  `0x0045EAFE`, and the port guards that dereference instead — a declared
  divergence, written up on `ZombieStateRideCarrier` in `class30/entrance.ts`.
  With no carrier live, the port's guard takes the no-carrier arm and the
  actors never get a carrier offset. That is the same guard the stage 2 car
  rider below trips, which is why the two reports may be one.

- `[open]` **The zombie that should ride the front of the stage 2 car never
  appears, and it makes a branch of the game unplayable.** At
  `?stage=2&original=1&mode=play&entry=0&block=0&step=3&op=31&frame=150`. Two
  other zombies are flung off the car and **that part works**; the one riding
  the front is simply absent. Reported as unplayable, so it is the most
  expensive of these nine.

  The state is named and ported. `ZombieStateRideCarrier` (`FUN_00458960`,
  class 0x30 state **29**) is a passenger: it records its spawn position once
  and every frame sets its position to that offset plus `g_carrier_object`'s.
  `class30/entrance.ts` says it has **six spawns, all in stage 2**, split by
  descriptor tail byte 3 — three carrying a `ZombieStateDelayedLeap` tail and
  three a `ZombieStateArcScriptedEntrance` one. **That split looks like the
  reporter's two behaviours**: the ones that get flung off, and the one that
  should stay on.

  And the port has a **declared divergence sitting exactly here**. The engine
  dereferences `g_carrier_object` with no null test; the port guards it, and
  with the global at `-1` the state "hands over **immediately** rather than
  parking six spawns for ever". The reason given is that a stage may reach one
  of these spawns without the class-0x33 object that belongs to it. Stage 2's
  carriers are the two class-0x33 selector-1 spawns `0x4FD0` and `0x12590`,
  which raise `obj+0x34` bit `0x10000000` at path cursor frames 260 and 360.

  So the first thing to establish is whether a carrier is live at frame 150 of
  this block **in Original Mode** — the reporter's locator is `original=1`, and
  the divergence's own stated trigger is a spawn reached without its carrier.
  If it is not, the port takes the no-carrier arm, the rider hands over at once
  and is never seen on the car. The same guard is the lead on the stage 5 car
  zombies above; treat the two together before treating either alone.

- `[open]` **The stage 6 lift rises immediately; it should wait for the player
  to be on it.** At `?stage=6&mode=play&entry=0&block=0&step=2&op=20&frame=0`.
  The port starts the animation as soon as the prop is placed, so whatever gate
  the engine has between placing the lift and driving it is not ported.

## And one about a check that is not reliable

- `[open]` **`bundle_flow.mjs`'s first thumbnail assertion fails about one run
  in three, still.** "the stage that has been open has a picture" waits up to
  ten seconds for `.export-tile img` and gives up. Measured over four runs on
  2026-09-07 while re-exporting for bundle format 5: pass, fail, pass, fail --
  and on one of the failing runs "and it has its picture without the screen
  being closed" went with it. Nothing in that run's tree touches the thumbnail
  path; the check already carries a comment saying it "lost about one run in
  three" before the wait was raised to ten seconds, so the wait was not the
  whole of it.

  A check that fails a third of the time is worse than no check, because the
  next person to see it red will assume it is red for them too. What it is
  waiting on -- `requestThumb`'s eight-frame delay, the OPFS write, or the
  screen's asynchronous read-back -- has not been established, and guessing at
  a longer timeout is what produced the current one. Not touched here: it is a
  peer check and this session had no business widening it.

## And one about `GameMode`, found while reading the run phases

- `[open]` **`GameMode.ARCADE = 2` in `web/src/hod2lib/stage.ts` looks like the
  wrong number, and the port survives it by luck.** Reading
  `RunPhaseStepToNextScene` and `FUN_0045EBC0` for the stage transition put
  `g_GameMode`'s arms side by side, and they do not fit the enum the port
  declares. `FUN_0045EBC0` gives mode 2 an entry **step of 0** and reaches the
  ordinary step 1 only by falling through every arm, which is mode **0**;
  `LoadSceneAndReset` takes the caption path at mode 0 and the Original-item
  path at mode 1; `ResetGameOnStart` sends mode 2 to scene 6, which is
  `trnevtbl.bin`; and `FUN_00412FD0` indexes `g_training_lesson` for mode 2. So
  on this reading **0 is Arcade and 2 is training**, and the enum's
  `ARCADE = 2` names the training mode.

  Nothing is visibly wrong today: `entryStep()` tests `ORIGINAL && scene === 0`
  first and returns 1 for everything else, so the wrong constant produces the
  right step by falling out of the same clause the engine falls out of. But
  every stage bundle carries `game_mode: 2` for Arcade, and `game/game_mode.ts`
  is the other half of the same enumeration.

  Not acted on: `g_GameMode`'s writers (`FUN_0049F380`, `FUN_00496200`,
  `FUN_00496960`) have not been read, and correcting the enum would renumber a
  field in every shipped bundle -- a format bump and a full re-export for a
  change that alters no behaviour. It wants the reading first.

## Divergences awaiting a call

Four, and each is a refactor rather than a line edit — which is why they are
here rather than done.

1. **`wait_frames N` is really N+2 frames.** Ops `0x41`/`0x42`/`0x45` yield on
   first visit and `EvtOpWaitFrames42` decrements before testing. Every camera
   cue in six stages is timed against that clock, so making it faithful is a
   retiming job of its own.
2. **The crawlers hit where the engine whiffs.** The undamaged crawler's attack
   is clip 997 at hit frame 40 and clip 997 is 20 frames long, so in the real
   game it misses; the port falls back to an attack that connects and is
   therefore **more dangerous than the original**. Faithful means baking clip
   997 and keeping an entry `attack_tables` is currently right to reject.
3. **`Actor.action` is a second animation track the exe does not have.**
   Removing it touches `class30/strike.ts`, `game/motion.ts`,
   `render/characters/pose.ts` and ~40 sites in `class31/`.
4. **The thrown weapon does not carry the permit.** The exe releases no permit
   in `ThrowerStateThrow` — `SpawnThrownWeapon` *hands* it to the projectile,
   which frees it mid-flight. The port cannot, because `G.g_thrown_weapons` is
   shared with class 0x30's weapon, which has its own state table and its own
   release site; releasing from the shared flight routine would free a
   class-0x30 slot through class 0x31's code. The release sits in
   `SpawnThrownWeapon` instead. **Splitting the two projectile pools is the
   real fix**, and it is a change to both classes.

### Closed

- ~~`ResolveHit` sets three flag bits the port ignores.~~ The read that
  mattered was the guard, not the bits: `g_app_state == 6` is the **in-play**
  state and the port had been sitting at 0, so transcribing `OR AH,0xE`
  literally would have set all three on every hit and removed gore from the
  whole game. The port sits at `InPlay` now. `0x400` (no dismemberment) fires
  in ordinary play as a **spawn flag** — 68 shipped class-0x30 spawns carry it,
  and every `zslman` is born with it from `EnemyThrowerInit`. `0x200` and
  `0x800` have no in-play writer and are modelled inert. Closing this also
  closed `PROGRESS.md` item 20 and renamed civilian op `0x2B` from `DebugOnly`
  to `InPlayOnly` — it had been named from the same gate, and so said the
  opposite of the truth.
- ~~`ThrowerStateThrow` never returns to the hub on clip end.~~ The state is
  the exe's three fall-through sub-states on the base track now,
  `ThrowerRearmHand` is gone, and `ThrowerStateRearm` carries the re-arm —
  reachable because `ThrowerStateStandAndDecide` offers state 29 to
  `ThrowerTryEnterState` *before* it asks the router (`PUSH 0x1d` at
  `0x0044B375`), which the port's comment had denied. Four further readings
  came out of it, including that the throw clip does not start at frame 0:
  `FUN_004119A0`'s third argument is the play *cursor*, and every type but
  0x18 is passed `0x1A`, so a `zsass` throw is 22 ticks of wind-up, not 48.
  Replaced by divergence 4 above.
