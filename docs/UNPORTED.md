# What is left to port

The spawn classes the exe has and the port does not run, and the pieces of
registered classes that their own code says are still missing, **split by the
game mode that reaches them**. The exe's class list is `g_class_handler_pairs`
(`0x00593358`, `{class, handler}` pairs ended by a negative id), read out of
the image; the port's is `game/classes.ts`. "Spawned in" is every spawn opcode,
`spawn_simple` record included, of all eleven `evt/` files: the six stages
(scenes 0..5), training (`trnevtbl`, scene 6), the ending (`endevtbl`, scene
9) and the two attract demos (`advevtbl` and `adv2evtbl`, scenes 10 and 11,
which play `cp_demo` and `cp_demo2`).

The port plays **Arcade and Original Mode**, stages 1 to 6. It has no
Training, no Boss Mode, no ending scene and no attract demo, so those sections
are context for the day one of them is started rather than work that changes
anything a player sees now.

Evidence tags as in `CLAUDE.md`: `[proved]` read in the exe, `[likely]` with
the evidence given, `[open]` undetermined. A one-line description here is a
first reading of the handler and its first callees, not a port's reading: the
port of each starts by reading it in full (`/gameplay-port`).

This file goes stale as classes land. When you port one, delete its row in
the same commit.

## Arcade and Original Mode

### Classes with no port

| class | handler | spawned in | what it is |
|---|---|---|---|
| `0x65` | `EndingRouteSelect65` (`FUN_00436140`) | the ending (`spawn_simple`) | **The ending's route selector**: route 1 when a player's `ScoreRankForPlayer` is 0, else 2 when the score is a multiple of 10, else 0; `ActorKill`. Waits on the port having an ending scene. `[proved]` |
| `0x54` | `FUN_00431780` | the ending (`hp` 1040, 1240) | Dies under caption mode 5; otherwise picks one of two target points by its `x` against `0x004C436C` and installs `FUN_00431810`. `[open]` |
| `0x55` | `FUN_00431C90` | the ending (`hp` 240) | Counts the players in state 7 and takes each one's `ScoreRankForPlayer`; installs `0x00431D50`. `[likely]` the ending's rank display |
| `0x56` | `FUN_00431BF0` | the ending (`hp` 240) | Two zeroed words and `0x00431C10` installed. `[open]` |

### Registered classes with pieces missing

* **`0x10` civilian** -- `CivilianUpdateOnCarrier`'s hand-back arm
  (`0x0048B160`); `SpawnCivilianBloodPool` (`FUN_0048E080`, its object's
  update unread); VM ops `0x23`, `0x24`, `0x25` and `0x2B`'s two words
  (`[open]`); op `0x1F`'s second stream.
* **`0x20` one-hit target** -- the damaged-part swap.
* **`0x21` rescue target** -- the sixteen body parts.
* **`0x25` scripted humanoid** -- `ScriptedHumanoidAimHeadAtCamera`
  (`FUN_00485BA0`) and `ScriptedHumanoidSeedHeadAim` (`FUN_00485D70`, no
  shipped program uses them); Original Mode's character remap
  (`[diverges]`).
* **`0x26` vehicle family** -- subtypes 0, 1, 3, 4 and 5 (1, 3, 4, 5 are
  drawn by `render/rigs.ts` with no actor behind them).
* **`0x30` zombie** -- states 16 (`0x00457360`), 28, `0x32`, `0x33`, `0x35`
  and `ZombieSplitInTwo` (`FUN_0045D9F0`, which `game:split_unreachable`
  holds unreachable); `ZombieCorpsePoseFrame` (`FUN_00454E00`); five bone-cel
  arms; the `0x10000000` bit `class30/emerge.ts` clears.
* **`0x41` prop placer** -- the score pickup's light set is recorded with
  its draw and not yet lit by: `render/breakables.ts`'s group is no lighting
  root, for any prop. Constructor 26's and the canal water's slots are
  treated as resident whatever loads their `pol/` files, beyond opcodes
  0x52/0x53's whole-file loads.
* **`0x44` prop placer** -- stage 2's hinge `0xFFD0` and selector-5 handoff
  `0x10018` carry stage 1's
  door pointer, which in stage 2 lands inside a quad of `coli2.bin`: they
  register, `[open]` what the engine's traces do with it, and the port's
  resolve to no blob. The story-mode switch's scene-4 count and blink read
  `g_script_flags[-1]` once its route is written, and `[likely]` never run.
* **`0x61` result card** -- the one writer of `g_original_item_part_scale`
  (Original Mode).
* **`0x60` chapter card** -- `FUN_00434DA0`, the arm `ChapterCardInstall`
  takes at `g_app_state == 0x0B`, a screen the port never reaches. `[open]`
  which screen that is.

### Gaps several classes share

* **The body creature's shot-test registration.** `BodyCreatureInit`
  (`0x0043E860`) and every unshot flying frame (`0x0043EE1C`) call
  `RegisterForShotTest`; the port files nothing, and `render/effects.ts`
  picks every creature in the pool -- a falling one too, which the engine's
  list never holds -- and none is in the list the crowd push reads.

## Training

Scene 6 (`trnevtbl.bin`, `g_GameMode` 2). The port has no Training.

### Classes with no port

| class | handler | spawned in | what it is |
|---|---|---|---|
| `0x1A` | `FUN_00498FF0` | training | Training's course setup: shuffles two descriptor lists with `rand()`, queues their `pol/` files, sets `g_damage_rank` from the lesson's table (`0x00597BCC[g_training_lesson]`) and installs `FUN_004991B0`. `[likely]` the lesson director, from what it reads |
| `0x1B` | `FUN_00499420` | training (`hp` 90..440) | A training wave: picks one of the tail's descriptor sets at random, spawns them (`SpawnFromDescriptor`, `SpawnFromDescriptorSmall`), shuffles their positions among themselves, and installs `FUN_00499530`. Dies at once when `g_training_out == 1`. `[proved]` |
| `0x6D` | `FUN_00496BA0` | training (`hp` 1, and `spawn_simple`) | Training's screen: loads its textures and model `0x158F`, lays out ten course entries from `g_training_course`, and installs `FUN_00496DE0` (subtype 0, which counts as an enemy present) or `FUN_00497360` (subtype 1). `[likely]` the course menu and its result |

### Registered classes' Training arms

* **`0x20` one-hit target** -- `OneHitTargetHoldDrawn` (`FUN_004494D0`) and
  the block-`0x0D` arm that reaches it.
* **`0x21` rescue target** -- `RescueTargetTrainingWaitState`
  (`FUN_00452540`); the stage-2 car's two Training updates (`FUN_004528B0`,
  `FUN_00452930`).
* **`0x13` scripted prop** -- `g_prop_behaviours[9]`,
  `TrainingPropKeepAloft` (`FUN_00445050`), and `DrawSecondsLeftReadout`
  (`FUN_00498C10`) with it: `trnevtbl.bin`'s descriptor `0x5400` is the only
  selector of entry 9 in any `evt/` file.
* **`0x23`** -- subtype 2.
* **`0x30` zombie** -- the replay arm in `class30/carry_prop.ts`.
* **`0x31` thrower** -- the `ThrowerDrawNodePart` swap.

## Boss Mode

`g_GameMode` 3, entered from the title menu; no script spawns its controller.
The port has no Boss Mode.

| class / routine | what it is |
|---|---|
| class `0x6C`, `FUN_00425010` | Boss Mode's controller: `g_boss_mode_entry`, `g_boss_mode_grades`, the screen furniture. `[likely]`, from the globals it writes; it may be spawned by code rather than a script |
| class `0x60`, `BossModeChapterCardUpdate` (`FUN_00434920`) | The chapter card's Boss Mode arm, which `ChapterCardInstall` takes at `g_GameMode == 3`. |

## Reached by no mode the port plays

The attract demos, and classes nothing spawns.

| class | handler | what it is |
|---|---|---|
| `0x50` | `FUN_004997E0` | `advevtbl` only (`hp` 120), the attract demo. Switches its tail's first word `0xC`..`0x10` into two updates (`FUN_004998A0`, `0x00499A80`) with a per-case `0x20`..`0x2C`. `[open]` |
| `0x2C` | `Class2CBranchToggleInit` (`FUN_00432D50`) | A branch toggle, a writer of `g_script_branch_var`. Nothing spawns it. `[proved]` |
| `0x47` | `PlaceLoneHordeMember47` (`FUN_0043BE60`) | One horde member alone, class 0x40's sibling. Nothing spawns it. `[proved]` |
| `0x48` | `FUN_0042E0F0` | A skinned enemy (character type `0x1E`) drawn through `BatDrawBoneSlot`, counted present and alive. Nothing spawns it. `[likely]` a lone bat |
| `0x66` | `FUN_00435A10` | Draws a row of slots from `0x0055E074` at screen-space positions. Nothing spawns it. `[open]` |

Class `0x2A` (`Class2AHandlerKill`, `FUN_00432D40`) is not listed anywhere:
its handler is `JMP ActorKill`, stage 2's four spawns die on their first walk
having done nothing, and the port building no object for them is the same
thing.
