# What is left to port

The spawn classes the exe has and the port does not run, and the pieces of
registered classes that their own code says are still missing. The exe's
list is `g_class_handler_pairs` (`0x00593358`, `{class, handler}` pairs ended
by a negative id), read out of the image; the port's is `game/classes.ts`.
"Spawned in" is every spawn opcode, `spawn_simple` record included, of all
eleven `evt/` files -- the six stages, training (`trnevtbl`, scene 6), the
ending (`endevtbl`, scene 9), and the two Original Mode scripts (`advevtbl`,
scene 10; `adv2evtbl`, scene 11).

Evidence tags as in `CLAUDE.md`: `[proved]` read in the exe, `[likely]` with
the evidence given, `[open]` undetermined. A one-line description here is a
first reading of the handler and its first callees, not a port's reading: the
port of each starts by reading it in full (`/gameplay-port`).

This file goes stale as classes land. When you port one, delete its row in
the same commit.

## Classes with no port at all

### Shipped -- a script spawns them

| class | handler | spawned in | what it is |
|---|---|---|---|
| `0x64` | `FUN_00435FB0` | stage 6 blocks 3, 5, 9 (`spawn_simple`, `hp` 0, 1, 2) | **A route selector**: a writer of `g_script_branch_var`, switching `obj+0x11C`. 0 picks 1 when every civilian seen was rescued (`g_civilians_rescued_total == g_civilians_seen_total`), else 2 in Original Mode at a score of 70000; 1 picks 1 at 100000 and 2 at 70000 (Original Mode); 2 picks 1 under 100000. Then `ActorKill`. The two-player arms add both scores. Until it is ported stage 6's routes at those blocks are always 0. `[proved]` |
| `0x65` | `FUN_00436140` | the ending (`spawn_simple`) | **The ending's route selector**: `g_script_branch_var` = 1 when a player's `ScoreRankForPlayer` is 0, 2 when the score ends in 0, else 0; `ActorKill`. `[proved]` |
| `0x27` | `FUN_004329D0` | stage 2 block 0 (two, `hp` 0 and 1) | Rides an `op_` path (`CamEvalObjectPath6` on the table at `0x00589AE8`, indexed by `obj+0x11C`) at `g_cam_path_frame`, switches motion `0x2B` to `0x33` past frame `0xBD`, and jumps to frame 190 on a skip. `SpawnClass.PathRidingVehicle`. `[proved]` for the routine, `[open]` what it draws |
| `0x2A` | `FUN_00432D40` | stage 2 blocks 8, 11, 12, 25 (`hp` 18, 20, 30) | The handler **is `ActorKill`** (`0x00432D40` is its body): the object dies the frame it is made. Porting it is one `registerClass` whose Init despawns. `[proved]` |
| `0x1A` | `FUN_00498FF0` | training | Training's course setup: shuffles two descriptor lists with `rand()`, queues their `pol/` files, sets `g_damage_rank` from the lesson's table (`0x00597BCC[g_training_lesson]`) and installs `FUN_004991B0`. `[likely]` the lesson director, from what it reads |
| `0x1B` | `FUN_00499420` | training (`hp` 90..440) | A training wave: picks one of the tail's descriptor sets at random, spawns them (`SpawnFromDescriptor`, `SpawnFromDescriptorSmall`), shuffles their positions among themselves, and installs `FUN_00499530`. Dies at once when `g_training_out == 1`. `[proved]` |
| `0x6D` | `FUN_00496BA0` | training (`hp` 1, and `spawn_simple`) | Training's screen: loads its textures and model `0x158F`, lays out ten course entries from `g_training_course`, and installs `FUN_00496DE0` (subtype 0, which counts as an enemy present) or `FUN_00497360` (subtype 1). `[likely]` the course menu and its result |
| `0x50` | `FUN_004997E0` | `advevtbl` (`hp` 120) | Switches its tail's first word `0xC`..`0x10` into two updates (`FUN_004998A0`, `0x00499A80`) with a per-case `0x20`..`0x2C`. `[open]` |
| `0x54` | `FUN_00431780` | the ending (`hp` 1040, 1240) | Dies under caption mode 5; otherwise picks one of two target points by its `x` against `0x004C436C` and installs `FUN_00431810`. `[open]` |
| `0x55` | `FUN_00431C90` | the ending (`hp` 240) | Counts the players in state 7 and takes each one's `ScoreRankForPlayer`; installs `0x00431D50`. `[likely]` the ending's rank display |
| `0x56` | `FUN_00431BF0` | the ending (`hp` 240) | Two zeroed words and `0x00431C10` installed. `[open]` |

### Not spawned by any script

| class | handler | what it is |
|---|---|---|
| `0x2C` | `Class2CBranchToggleInit` (`FUN_00432D50`) | A branch toggle, a writer of `g_script_branch_var`. `[proved]` unreachable |
| `0x47` | `PlaceLoneHordeMember47` (`FUN_0043BE60`) | One horde member alone, class 0x40's sibling. `[proved]` unreachable |
| `0x48` | `FUN_0042E0F0` | A skinned enemy (character type `0x1E`) drawn through `BatDrawBoneSlot`, counted present and alive. `[likely]` a lone bat |
| `0x66` | `FUN_00435A10` | Draws a row of slots from `0x0055E074` at screen-space positions. `[open]` |
| `0x6C` | `FUN_00425010` | Boss Mode's controller: `g_boss_mode_entry`, `g_boss_mode_grades`, the screen furniture. `[likely]`, from the globals it writes; it may be spawned by code rather than a script |

## Registered classes with pieces missing

What each class's own module or its `docs/formats/spawns.md` row says it
does not have yet. A class not listed has no such note.

* **`0x10` civilian** -- `CivilianUpdateOnCarrier`'s hand-back arm
  (`0x0048B160`); `SpawnCivilianBloodPool` (`FUN_0048E080`, its object's
  update unread); VM ops `0x23`, `0x24`,
  `0x25` and `0x2B`'s two words (`[open]`); op `0x1F`'s second stream.
* **`0x13` scripted prop** -- `g_prop_behaviours` entries 3
  (`CarriedPropThrowAtTarget`, `FUN_004432D0`), 5 (`CarriedPropRollAtCamera`,
  `FUN_00443DC0`), and the three the module calls unread -- `0x0043FFC0`,
  `0x004400D0`, `0x00445050`, which by elimination are entries 6, 7 and 9;
  carrier routine 3 (`0x00440AD0`); routine 1's
  and 6's screen-test exit (`FUN_004459C0`).
* **`0x20` one-hit target** -- `OneHitTargetHoldDrawn` (`FUN_004494D0`) and
  Training's block-`0x0D` arm; the damaged-part swap.
* **`0x21` rescue target** -- the sixteen body parts; `RescueTargetTrainingWaitState`
  (`FUN_00452540`); the stage-2 car's two Training updates
  (`FUN_004528B0`, `FUN_00452930`).
* **`0x23`** -- Training's subtype 2.
* **`0x25` scripted humanoid** -- `ScriptedHumanoidAimHeadAtCamera`
  (`FUN_00485BA0`) and `ScriptedHumanoidSeedHeadAim` (`FUN_00485D70`, no
  shipped program uses them); Original Mode's
  character remap (`[diverges]`).
* **`0x26` vehicle family** -- subtypes 0, 1, 3, 4 and 5 (1, 3, 4, 5 are
  drawn by `render/rigs.ts` with no actor behind them).
* **`0x30` zombie** -- states 16 (`0x00457360`), 28, `0x32`, `0x33`, `0x35`
  and `ZombieSplitInTwo` (`FUN_0045D9F0`, which `game:split_unreachable`
  holds unreachable); `ZombieCorpsePoseFrame` (`FUN_00454E00`); five bone-cel
  arms.
* **`0x31` thrower** -- the thrown weapon's ground shadow and camera
  tracking; character type `0x17`'s pounce.
* **`0x33` scripted scenery** -- every selector runs; the carrier's
  (selector 1's) `RegisterForShotTest` at `0x004334D0` and the
  `MatrixStore(obj+0x150)` the mesh shot test would read. `[open]`: what
  takes selector 7's object away, since its own despawn test never passes.
* **`0x2B` scripted light** -- selectors 1 and 2 fill their entity-light
  entries correctly, but `render/gunlights.ts` draws an entry from 3 up only
  when it is a point light, so the two spot lights (stage 4 block 10, stage 5
  block 0) are not seen.
* **`0x41` prop placer** -- constructors 26 (`PlaceType26RippleTask`), 42,
  52, 55, 61, 65 and 68 (the golden frog); the story-mode switch's hinge and
  item spawns; `SpawnScorePickup`'s object.
* **`0x60` chapter card** -- `BossModeChapterCardUpdate` (`FUN_00434920`) and
  `FUN_00434DA0`.
* **`0x61` result card** -- the one writer of `g_original_item_part_scale`.

## Gaps several classes share

* **A descriptor spawned twice is built once.** The director's slot-actor
  builder (`SpawnSlotActors`, `game/director.ts`) makes one object per spawn
  address while the script lists it, where the engine allocates one per
  spawn instruction. Stage 1 block 14 re-spawns block 5's and 11's class-0x33
  selector-2 cars, stage 2 block 9 op 23 re-spawns op 10's, stage 2 block 12
  re-spawns block 11's class-0x2B light while it is still on, and block 35
  re-spawns the class-0x15 plank row -- each is one object in the port and
  two in the game.
