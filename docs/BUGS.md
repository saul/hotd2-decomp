# Reported bugs — status

**Scope, against the other bug list:** this file is one entry per *reported*
symptom and whether it is fixed. Defects the automated playthrough finds by
driving the player end to end are in [`PLAYER_HANGS.md`](PLAYER_HANGS.md).
The divergence count is generated into [`STATUS.md`](STATUS.md); do not
restate it here.

Nineteen reports: **fifteen fixed, three half-done, one open.** Every fix
carries its evidence in the port's doc comments; the reasoning is in
`docs/re/session-log.md`.

`[fixed]` verified against the shipped data · `[part]` one half done, the other
named · `[not-a-bug]` the port already matches the engine · `[open]` unsolved ·
`[decide]` waiting on a divergence call.

---

## What is left

### One report is unsolved

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
