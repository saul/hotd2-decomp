# Browser stage player — progress

Running state of the web player. The plan and its rationale are in
[`PLAYER_PLAN.md`](PLAYER_PLAN.md); how the source is laid out and why is in
[`PLAYER_ARCHITECTURE.md`](PLAYER_ARCHITECTURE.md); how to run it is in
[`../web/README.md`](../web/README.md). This file is the checklist and, more
usefully, the record of **what was got wrong and how it was caught** — the
player is a consumer of the RE, so it is where reading errors surface as
visible misbehaviour.

**Status:** R0–W5 shipped and working. W6 (visual regression) deferred, as
planned.

The gameplay code is now a **port** rather than an interpretation: `web/src/game/`
is one TS function per exe function, under the name `functions.tsv` gives it,
with the address in the doc comment. It imports neither three.js nor
`Math.random`, so the whole of it runs headlessly — `npm run test:port` — and
`world.save()` returns plain JSON that fully determines the next frame.
`tools/verify_port.py` checks the citations, the coverage and the three ways
state can escape a snapshot.

**Class 0x41, the item containers, is ported** (`game/class41/`). The placer
dispatches through `g_class41_constructors` and kills itself; type 0 builds a
group of breakable props from the exe's own member records, which travel in the
bundle's new `breakables` block along with the 96-point collision hull. Each
prop takes two shots — the first cracks it and pays nothing, the second breaks
it for ten and charges its item set — and a prop whose supports are destroyed
falls, spins and settles on a hull corner. When a set's countdown empties the
item comes out: an **extra life** for set 1, the **golden frog** for set 3, a
score pickup for the rest. The countdown is seeded `rand() % n + 1`, so which
break pays out is random, and `port.test.ts` asserts that over 40 seeds it is
not always the same one.

**And they have a size.** `EnemyZombieInit` writes two radii — `obj+0x124`
from `g_actor_radius_by_char`, which is the shot sphere, and `obj+0x128` = 3.5,
which is the **body** sphere every collision uses — and the port wrote neither.
So every zombie collided as a point of radius zero, and the world push in
`ZombiePushOutOfWorldAndActors` could never find a wall to be pushed out of.
That is why one walked through a wall in stage 2's block 16 rather than sliding
along it.

Worth being clear about what that push is and is not: **class 0x30 has no path
following and no steering.** `PATH_STATES` is class 0x31 only, and
`ZombieStateWalkDistance` records where it started and walks until the 2D
distance from that point exceeds the float at the descriptor's `+0x04` — no
destination, no route. The wall interaction is extraction, not avoidance: a
sphere test each frame that shoves the actor back out. A zombie will hug a wall
and slide along it; it will never route around one.

**And the push was never what shaped that path.** The report was that the
stage 2 block 16 step 3 zombie still walked through a wall after both radii
were fixed, and it did. Walking the *real* script to that address — which is
what `web/tools/wall.mjs` is for — the collision the engine has selected there
is one blob: `coli2.bin:4656`, fourteen quads of flat water at `y = -25`. The
building whose corner the zombie crosses has **no collision anywhere in
`coli`**, and `EvtOpSetCollisionSetFull10` *replaces* the set rather than
adding to it, so nothing else is active either. No sphere push could ever have
helped.

What shapes an enemy's path in this game is the **entrance the script gave
it**, and class 0x30 state 15 — `ZombieStateWalkDistance`, the walk-in — was
not ported at all: `ZombieEntryState` folded it into `AttackRun`. Fifty spawns
across the game start in it, including all four the report names, and every one
of them turned to face the camera on its first frame and took the straight line
instead of walking three to thirty units of its own entrance first. The
exporter never emitted the distance either — `WALK_DISTANCE_STATES` listed
class 0x31 only. Both are fixed, and for that spawn the number of drawn-mesh
crossings over the same four seconds falls from 11 to 4.

The four that remain are two frames at the building's corner, and they are the
engine's own: the actor faces the camera, the camera is behind the corner, and
there is nothing in `coli` to feel. Routing around drawn geometry would be an
addition to the game, not a fidelity fix.

**Two faults kept the set pieces from working, and neither was where it
looked.** The report was that the stage 1 well captors were stuck in a wall and
that a mauled civilian just carried on.

*The captors were not in a wall — they were being held off their own hostage.*
`CivilianInit` writes `obj+0x128 = 1.0`, the body sphere; the port wrote only
`obj+0x124`, the shot sphere, so `ColiTestSphereAgainstActors`' lazy default
filled the body radius from it — ten units. A captor walking at its civilian
was shoved back from 13.5 units away by the crowd push while its script wanted
to be within six, and it chased for ever, a few units short. Setting the radius
fixes it, and `PoseHookGrowAndPushOutOfWorld` (`FUN_0048D070`) is now ported
with it: the per-frame hook that ramps that radius toward whatever op 0x16 set
and pushes the civilian out of the world when its wait word asks.

*The maul was an animation with no consequence.* `obj+0x19C` — the frame every
script cue is counted in — is the **play** clock: it ticks once per 60 Hz frame
over 30 Hz data, so it runs to `g_motion_play_length[motion]`, about twice the
authored frames. The port was counting authored frames, so every cue past
halfway was never reached. **30 of the game's 51 kill cues are in that range**
(`tools/verify_maul_cues.py`), which is why the civilians got up and walked
away. The bundle now carries the exe's own table as `BakedMotion.play` — it is
`2n - 2` for some motions and `2n - 3` for others with no rule saying which —
and `MotionPlayFrame` / `MotionPlayLength` are the one pair of readers, so
class 0x24's drift cue and the emerge and fall states are exact too.

**And a corpse now rests.** `CivilianUpdate` advances the play cursor only
while the loop count allows; when it runs out nothing touches it again and the
clip sits on its last frame. The port advanced the clock unconditionally and
the renderer wrapped it, so a civilian killed in a set piece played its dying
animation over and over — 23 of 23 mauled civilians did. `web/tools/corpses.mjs`
is the check, and it is 25 of 25 resting now.

That needed the sampler read properly. `SkeletonAdvancePlayCursor`
(`FUN_004111A0`) is `model[2] = model[0] % (play_length + 1)` — the cursor
**wraps**, taking every value from 0 to the play length inclusive — and
`model[6] = model[2] / 2` is the authored frame, with odd cursors blending two.
Two things follow: a class holds a clip by simply not incrementing its tick,
and a cue compared for equality comes round once per play-through, which is
what makes a loop count cost one play rather than one frame. The last-frame
tests are equalities again for the same reason; `>=` against a wrapping cursor
is true on two frames of every cycle.

Across the shipped corpus that takes the civilians the captors actually kill
from **4 to 10** in fifteen seconds, and rescues from 21 to 17.

**A new overlay, `Wedged`**, answers the question the collision one leaves open.
`#show-coli` says what the engine can feel; this marks in red every zombie the
world push has been shoving for half a second or more — an actor that cannot
get where its state is taking it. It counts only the world half of
`ZombiePushOutOfWorldAndActors`, because the engine's single `Shoved` bit
cannot tell a wall from another zombie's shoulder and the second happens
constantly.

**`ColiTestSphereAgainstActors` is in** — the actor-versus-actor half of the
same hook, and the last unported piece of it. It is **mutual and deferred**: an
actor pushes itself out by a tenth of the penetration and *records* the
opposite push on whoever it found, who applies it on its own next frame. One
test per actor separates a whole crowd. `ActorUpdateBoundingSphere` moved to
`actor.ts` for it, because the test has to be able to ask about an actor that
has not ticked yet.

**Zombies are on the floor now.** `EnemyZombieUpdate` runs a hook at
`obj+0x12F0` — `ZombiePushOutOfWorldAndActors` (`FUN_00454900`) — and half of
what it does is `ActorSnapToGroundHeight` (`FUN_00454B10`): **every class-0x30
actor is snapped to the collision height every frame**, from a probe six units
above its own `y`. The port had none of it, so an actor's height was whatever
its spawn record said, for ever. Stage 2's block 16 runs over ground that drops
from -25 to -34.5 in a few units, which is why the zombies there were in it.
More than ten units of air, on an actor allowed to leave the floor, is
`ZombieStateFallToGround` (state 11) instead — also ported.

**And two entrances that place the actor.** A spawn's `y` is where its entrance
*starts*, not where it stands:

* `ZombieStateEmerge` (27, eighteen spawns) holds a submerged pose with the
  clock frozen and root motion off, waits the descriptor's delay, then plays
  the clip the descriptor names — 178 for the water ones, 183 for the ground —
  whose own translation lifts the actor out, throwing a splash at frames 22 and
  35. That is the missing "get out of the water" animation.
* `ZombieStateDelayedLeap` (26, eleven spawns) waits, then rides an arc to a
  point the descriptor gives. Its `ActorArcBeginFalling` is unlike every other
  arc in the port: the descriptor gives a per-frame **acceleration**, and the
  frame count is counted out by simulating the drop.

`EnemyZombieUpdate` also integrates `obj+0x4C` into the position now, which it
never did — so the class-0x30 pounce, which was setting a velocity nothing
applied, moves at last.

**An off-screen enemy still takes its permit** — and the port used to say
otherwise, which is why an enemy the camera's rail had walked into stood in
your face for good. `TryClaimAttackSlot` calls `ActorIsOnScreen`, but **not to
refuse the claim**: the engine grants it and raises a global latch,
`g_attack_committed`, so exactly one enemy may attack from off screen and while
one does nobody else may claim at all. Reading it as a refusal meant such an
actor never got a permit, so never pounced, so never ran the state that
retreats. `zsass` showed it most because its whole cycle is *close in, pounce,
leap back to fifty*.

**There is a collision overlay now** — the `Collision` checkbox. It draws the
`coli/` quads the port actually traces: amber for the blobs the script has
selected into the sphere-and-segment set, blue for the ray-only ones, with a
spike on each quad's normal so the one-sided winding is visible, and nothing at
all for a blob in neither set, because nothing tests those. It answers the
question it was built for: a thrower's leap-aside lands on collision in **y**
only — the sideways choice is five units either side of the camera's forward at
fifty, in the camera's frame, and knows nothing about walls.

**The attack pacing is measured, not guessed.** `web/tools/cadence.mjs` drives
real spawns and prints the cycle: a lone zombie strikes every **3.22 s** — a
1.63 s clip and a 1.58 s retreat, with 0.1 s of standing — and six zombies give
5.85 s each with one swinging at a time and 9.3 s of waiting. That is the
engine's own pacing: there is no per-swing cooldown in class 0x30 (`obj+0x133C`
is forced to zero unless state 19 arms it, and four spawns in the game start
there), the 90-frame invulnerability window does not gate the attack queue, and
the approach rings come from one table with **no difficulty index**. The port
runs difficulty 2, which changes hit points and per-shot damage and nothing
about timing.

Two timing bugs came out of reading it: `ZombieStateBackOff` was writing the
engine's `obj+0x1338` into the port's `obj+0x133C` — two different fields — and
its exit was missing the clause that holds a retreat until the back-away clip
has played. `ResetGameGlobals` also did not re-arm `g_player_lives`, so a seek
started with whatever the last run ended on.

**Class 0x10, the civilians, is ported** (`game/class10/`) — and with it the
game's **rescue mechanic**, which the player had no part of. It is a second
bytecode VM, but unlike class 0x25's the scripts are compiled into
`Hod2.exe`: 67 entry points, 136 streams and 1,967 commands, now decoded into
the bundle by `ExeTables.civilian_scripts`.

The find that mattered is that a civilian's **captors were not in the game at
all**. `CivilianInit` builds them from descriptors at the spawn tail's `+0x10`,
and nothing in the evt's instruction stream points there — so the script walker
never returned them, the exporter never placed them and 47 class-0x30 zombies
across four stages simply did not exist. They do now, they follow their
civilian on and off stage, and killing the last of them pays the **+400** the
rescue is worth. Shooting the civilian instead costs a **life** and 100 points
twice, and a killing shot charges 100 to both players.

Two pieces of the wait machinery are worth stating because they read
backwards: a wait word **leads** its block and governs the wait that follows
it, and a block whose own wait is already satisfied is **skipped** — with
`CivilianReapplyWaitCommand` re-applying the clip, target and cues the skipped
block would have set. `port.test.ts` pins both, along with the timer's `n + 1`
frames and the two score paths.

**And they are on screen.** `CivilianInit` writes motion **660** before it runs
a line of script, and without a `MOTION_RULES` entry for the class the exporter
resolved all 47 to a character with no motion and the client drew none of
them — the whole class was ported and invisible. It now bakes the transitive
closure of every clip the spawn's script can reach, and a civilian stands,
walks and cowers.

The rest of the class's own render half came with it:

* **They can be shot.** A civilian has no hit table, and `ShotTestSphere` is
  the fork the engine uses: an actor with `obj+0x34` bit 0x80 clear — which
  every civilian is — is a ten-unit sphere and the shot ends at
  `MarkActorShot`, not at `ResolveHit`. `ClassHandler.ownsShotResult` is that
  fork in the port, and `Shooting` takes it the same way it takes a breakable
  prop: mark it, and let the class score it.
* **They hold things.** Ops 0x13-0x15 hang an `etc_1.bin` model off bone 5 with
  a rotation and an offset picked by a six-way attach set the character type
  chooses, and op 0x15 draws its record from a weighted table — through
  `ctx.rng`, so which bottle a civilian is carrying survives a save. The models
  ride the same hidden template the gore swap clones from.
* **They speak.** Op 0x1D is `EvtOpPlayDialogue2D` and all 36 of its operands
  are real message groups, so a civilian's line goes through the player's own
  subtitles and voice.
* **They leave.** `ActorDespawn` is now the port's own removal, and it outranks
  the walker's spawn list.

One gap is named rather than approximated: 7 of the 47 ride a carrier object
(`g_civilian_carrier`), and the carrier is written by class 0x13, which is not
read. Those seven stand where the script put them.

While wiring the dialogue it turned out **nothing was listening to
`sound.play`** at all — class 0x31's laser sword and its footsteps had been
raising it into the void since they were ported. The bus is connected now.

**And the zombies holding them now behave.** Eleven of class 0x30's 54 states
never look at the camera: they work on `obj+0x1394`, the object the actor was
built for, which for 47 of the 59 spawns that reach one is the civilian.
`class30/target.ts` ports them — the walk, the maul, the drag, the pounce, the
off-screen retire and the wait — and `ZombieEntryState` no longer folds them
into `AttackRun`, which is what had every captor in the game abandoning its
hostage on frame one and charging the player.

Two signals run between the classes, both polled rather than called: the captor
raises `CivilianWait.Free` in the civilian's own wait word the frame it gets
close enough to grab, and the civilian's op 0x1A writes a state id and a
countdown that `ZombieStateAwaitCivilianOrder` obeys — `0x31` means die. The
maul kills by raising the same `obj+0x34` bit a killing shot raises, so a
civilian mauled by its captors costs both players a hundred points exactly as
a stray bullet would.

`web/tools/civilians.mjs` measures it over the shipped data: **45 of the 47
captors run a state that works on their own civilian**, and four civilians are
mauled inside fifteen seconds — four that can no longer be rescued, which is
why the rescue count in that harness went down.

**Class 0x25, the scripted humanoid, is ported** (`game/class25/`) — the
second-largest class in the game and a **bytecode VM**. The spawn's tail points
at a command block; the Init installs the interpreter and it walks 8-byte
commands until one blocks, so a run of setup commands all take effect in one
frame and only a wait costs one. 137 blocks and 1,385 commands are decoded into
the bundle. This is the game's cutscene system, not an enemy.

**Class 0x24, the set-pieces, is ported** (`game/class24/`) — a skinned actor
choreographed against the camera rather than the clock: all six state routines,
the freeze/unfreeze cues, both gravity drops and the slide. They render because
`MOTION_RULES` gained a rule for the class; without one the exporter resolved
them to a character with no motion and the client skipped anything it cannot
pose.

That port turned up two counting bugs that had been latent since the pool held
only enemies. `g_enemies_alive` and `RegisterForCameraTracking` both took
**every visible actor**, where the engine has each class's own handler decide —
so 21 set-pieces in stage 2 inflated the count `wait_enemies_alive` blocks on,
and made the camera swing to look at the world origin, which rendered a black
screen. Both now ask `ActorIsEnemy`.

**Class 0x41 type 32 — the lift — is ported** (`game/class41/lift.ts`). It is
the one class-0x41 prop that moves: while the script holds flag 0x37 up the car
floor rides at `g_camera_block_eye.y - 15`, and stage 2's block 18 sends it up
89 units on `cp_st2` path 28. Flags 0x6B and 0x6C fold two pairs of lattice
cage leaves 0x200 BAMS a frame; `obj+0x2A0` counts frames flag 0x6B has been up
and releases an overhead panel after 40 of them. The renderer composes five
draws down the matrix stack — the car, four leaves and the panel — which is the
first prop in the player with hinged sub-parts.

**The generic props draw the right models now.** `PlaceGenericProp` writes the
spawn descriptor's `+0x11C` into `obj+0x28C` *and* `obj+0x11C`, so the same
number is an asset slot and a lifetime in event blocks, and only three of the
44 types ever draw the slot. The player had been treating all of them as slots,
which put `char_adv03.bin` and `eff_boss4.bin` where 46 of stage 2's 67 generic
props should be. All 25 routines that share the lifetime prologue were read for
what they draw; `GENERIC_DRAW_SLOT` carries the answer and the exporter emits
those templates. `PropExpireByBlockLifetime` now runs for the whole family, so
a prop the script placed for one block no longer stands there all stage, and
Original Mode's collectibles (types 70–72, 77) leave on their first Arcade
frame the way the engine sends them.

Seven of the eleven **kinded** object kinds still show nothing, and that is the
engine's own behaviour: `PlaceKindedProp` leaves `obj+0x28C` at `0xFFFF` for
every kind but 2, 3, 8 and 9, and the update draws an animated effect
(`FUN_0040DD90`) instead. The player has no renderer for that system at all,
which is the next real gap in the props.

**All three container families are ported**: the group placer (class 0x41
type 0), `KindedPropUpdate` (type 4 — 70 spawns, the most-placed constructor in
the game, 37 of them hiding an item) and `FallingContainerUpdate` (class 0x44
selector 16, which is knocked loose by the first shot and tumbles onto its own
floor). They had to go in together: all three decrement the same
`g_item_set_countdown`, so porting one of them leaves the others' sets paying
out at the wrong break. `game/class44/` is new, and `PropFamily` stands in for
the update routine the engine installs — all three are 0x378 objects in one
pool and differ only by the function pointer in their first word.

**They are drawn, and they can be shot.** `render/breakables.ts` follows
`G.g_breakable_props` the way the projectile layer follows the thrown weapons:
one cloned node per live prop, re-cloned when the first shot swaps the model to
`0x19E6`, plus the ground shadow at `0x10D0`. The models come from a hidden
`slots_breakable` rig the exporter now emits — the props are built at run time,
so there is no node per placement to emit, only a template per asset slot. They
live in `komono_2.bin`; *komono* is Japanese for "small items".

The gun picks the nearer of the character and the prop, so a barrel in front of
a zombie stops the bullet, and a hit only sets the hit bits: the port's own
`BreakablePropUpdate` is what cracks the prop, pays the ten points and releases
the item on its next frame. Scoring it from the renderer would be a second copy
of the rule.

Two things had to move for any of it to happen. `ActorSpawn` is otherwise
reached only from the character layer, and only for spawns with a skeleton, so
a placer never got to the registry — `SpawnPropContainers` is the bridge, and it
runs **inside the spawn opcode** rather than once a frame, because the placer
lives and dies on the frame it is spawned and because a seek replays
instructions with no frames in between. `g_evt_block_counter` and
`g_camera_fixed_eye_y` moved into `G`, written by the block transition and the
camera opcode that write them in the engine, so a group placed during a replay
gets the right floor and the right lifetime clock.

**A reload resumes where you were.** The player writes its script address into
the URL as it plays (`?stage=2&block=11&step=8&op=2&frame=1011`, throttled to
one `replaceState` every 500 ms), and on load `Walker.seek` replays from the
entry block to that address with every wait stepped over. That is what makes a
refresh — or a Vite HMR reload — land in the same place instead of restarting
the stage.

`seek` had never worked past the first wait: `executeOne` refuses to run while
one is raised, so the loop stopped dead and *every* seek in stage 2 landed on
block 0 step 1 op 29. It now steps over waits, resolves a branch by taking the
route the goal is actually behind, and returns whether it arrived — so a stale
link says so rather than silently showing somewhere else.
`npm run test:seek` samples addresses across all six stages, seeks back to each
from cold, and compares the region, the streamed slots, the camera, the flags,
**the live spawns** and the rest: 137 addresses, all exact.

A replay also has to honour what a wait *leaves behind*, not only what it
blocks on. `wait_enemies_alive` and `wait_enemies_present` open only when the
counters fall, and the counters fall only when the actors die — so past one of
those gates every enemy placed before it is dead by construction. The replay
shoots nothing, so nothing retired them, and a seek to block 17 step 8 of
stage 2 arrived with six zombies from earlier steps still standing behind the
camera. Every path that releases a wait without testing it now goes through one
`stepOverWait`, which applies the postcondition.

Three debug views hang off that same property — if all the state is in one
enumerable place, it can be shown:

* **Globals** (right rail, collapsed) — every `g_*` the port touches with its
  exe address, and the object pool a row per actor: class, state, permit, hit
  points. Read-only on purpose; a writable panel would be a fourth way for
  state to enter the game and nothing done in it would survive a save. The
  addresses are parsed out of `game/globals.ts` at build time by the same
  regex `verify_port.py` uses, so there is no second copy of them.
* **Unported** — an empty box wherever the script has spawned an actor whose
  class has no module in `g_class_handlers`. 1046 of the 1383 placements
  `spawns.md` counts are in that state, and the box is the honest picture of
  it: something is there, and this player is not simulating it.
* **Props** — with the Props checkbox on, a bounding box and an origin cross
  on every prop the bundle names, coloured by why it is or is not on screen:
  green drawn, amber hidden, magenta bound to a node with no geometry, red
  named in `props.json` with no glTF node at all. Unbound props used to be
  dropped from the layer's list entirely, which made "never exported" and
  "hidden by something" look identical. The status line reports the same four
  counts, and it now measures them when asked rather than caching them — the
  cached version read `0/44 no node` for a set of props that were all bound and
  fine, because `refreshUi` only runs during playback and so only ever saw the
  state from before the first frame.
* **Boxes** — the actor holding an attack permit, which is both the one about
  to swing and the one `SelectCameraLookAtTarget` is aiming at, plus every
  enemy keeping `wait_enemies_alive` blocked while it is blocking.

| Check | Command | What it holds |
|---|---|---|
| opcode statuses | `tools/verify_player_ops.py` | `script/ops/` against the table below |
| the port | `tools/verify_port.py` | `FUN_` citations, coverage, `[diverges]`, snapshot rules |
| the state machines | `npm run test:port` | permits, turn-taking, spacing, damage, save/restore |
| the markup | `tools/verify_player_dom.py` | every `#id` the player looks up exists |
| reload-and-resume | `npm run test:seek` | `Walker.seek` replays to an address and reproduces its state, over the shipped bundle |

---

## Phases

| # | Deliverable | State |
|---|---|---|
| **R0** | Library refactor — `hod2lib/{stage,script,campaths,bundle}.py`, CLI tools reduced to argparse shells | ✅ glTF, `.bin`, region sidecars and `dump_stage_script` text all **byte-identical** across 6 stages × 2 game modes; `verify_*` all pass |
| **E1** | `tools/export_player.py`, `hod2lib/bundle.py`, cam + script serialisers | ✅ 12 stage bundles, 166 MB; `manifest.json` carries a `format` the client checks and the SHA-256 of every source file |
| **E2** | GLB packaging in `gltf.py` | ✅ one 24 MB `stage2.glb` replaces `.gltf` + `.bin` + 1241 PNGs |
| **W1** | Vite + TS + Three scaffold, bundle loader, static render, URL state | ✅ typechecks and builds clean; all state URL-addressable including `freeze=1` |
| **W2** | Hermite eval, rails, free-roam camera | ✅ curves evaluated client-side; rails per path with the active sub-range highlighted |
| **W3** | Script walker, region visibility, step mode | ✅ every op reachable and seekable; only the current region drawn |
| **W4** | Play mode, branching, enemy simulation | ✅ route graph walked; branch points pause with a seeded countdown; with Shoot on the live-enemy waits are the real gate, otherwise a tunable per-enemy timer |
| **W5** | Audio, fog, route minimap, Arcade/Original toggle, event feed, inspector | ✅ BGM, SE and voice all play, dispatched by namespace; scene fog rendered radially |
| **W6** | Visual regression harness | deferred — `freeze=1` and the URL state it needs are already in place |

---

## What the player consumes, and what it exposed

The player turned out to be a good oracle for the RE. Five readings that
looked right on paper produced visibly wrong behaviour, and the binary settled
each one.

| Symptom | Cause | Fix |
|---|---|---|
| Most of a stage never ran; regions and camera barely changed | **A block's steps are sequential.** `end_block` advances to the next *step*; only an exhausted step table reaches the route table. Treating every `end_block` as a block exit ran one step per block | read `EvtAdvanceBlockOrRoute` |
| Scene ended early | Route **kind 2 is not "end"** — it falls through to `block + 1`. The scene ends when that block is a hole | same |
| Branch buttons picked the wrong route | A branch takes `next[branch_choice]`, not "a target"; `branch_choice` resets to 0 on every block change and every writer of it is gameplay code | same |
| Clicking a branch button did nothing | The countdown re-announced the branch every frame, so the UI rebuilt the buttons 60×/s and the click never landed between `pointerdown` and `pointerup` | notify on *change*, not on tick |
| Branch preview showed an unrelated shot | The `store_six` preview was carried across block changes. All four in stage 2 sit *inside* branch blocks | discard on block change, same lifetime as `branch_choice` |
| Whole view tilted down | `eye.y = path.y - 15` was applied **before** the look-at, but the game derives pitch and yaw from the *unshifted* `eye - target` and only then overwrites `eye.y` | translate after orienting |
| Camera still too low | The `-15` should not be applied at all — see below | reverted, with the measurement |
| Fog far too thick | `SetFogRange` **doubles** near and far before the device sees them, and three.js's fog factor is `smoothstep` where D3D's is a straight ramp | double the range, patch the fragment chunk |
| Op 0 of every step never ran — a region entered a step late, a `cam_play` skipped, the camera's position jumping 41 units in stage 2's block 17 doorway | `end_block` (0x4F) moves the program counter itself, and `executeOne` then incremented it again. `EvtAdvanceBlockOrRoute` assigns `DAT_009C7108` the address of the new step's *first* instruction; this VM has no shared post-increment | increment only when the handler left the pc alone; `test/seek.test.ts` asserts every step entered runs its op 0 |
| The camera rewound to before the start of its path once, then carried on (stage 1 block 8 step 4) | `start == -1` means **resume** in the deferred branch too: `FUN_00403490` stashes `g_cam_path_frame + 1`, not the literal -1. The port stashed -1, so `finish_sequence 7` set the clock to frame -1 and replayed all 686 frames | transcribe `FUN_00403490`; `test/seek.test.ts` asserts no play starts before frame 0 |
| The camera's aim jerked 20 degrees the frame the last enemy died | `SelectCameraLookAtTarget`'s "nothing registered" case is a **fallback to the path's own target**, not an exit, and `CameraTrackEnemiesTick` eases onto it unconditionally — `g_camera_is_tracking` picks only the *rate* | `game/camera/track.ts`, with `g_camera_block_target` as real state in `G` |

## Findings the player produced

Things established while building it, now folded back into the format docs.

- **Opcodes `01`–`08` are the spawn opcodes behind a player-count gate.**
  `[proved]` — `EvtOpSpawnIfOnePlayer` (`0x00408820`) and
  `EvtOpSpawnIfTwoPlayers` (`0x00408860`) test `g_max_attackers` against 1 or 2
  and either tail-jump into `g_evt_spawn_gated_handlers` (`0x00577650`) —
  indexed by the opcode, holding `09`/`0A`/`0B`/`0C` twice — or walk the
  operand list to its `-1` and skip it. Same descriptors, same allocators, so
  the old `spawn_if_mode*` naming was a guess at a difficulty setting that does
  not exist. The lists **overlap** rather than replace: stage 1 block 0 step 2
  gives `07` three class-0x30 descriptors and `03` the last two of that same
  three, so a second player adds one zombie rather than swapping the set. Only
  `03`/`04` and `07`/`08` are ever encoded, 63 sites across the six stages.
  **This was why stage 1's first zombies never arrived** — the two opcodes that
  place them were the only thing that places them, `hod2lib.evt` did not resolve
  their descriptors, and the walker had no handler.

- **`store_six` (`0x60`) is the arcade branch preview.** `[proved]` — three
  `(frame, slot)` camera poses indexed by `branch_choice`, from reading the
  scatter in `EvtActionStoreSixOperands60` against the gather in
  `FUN_00403DB0`. Note the order: frame first. Recorded in
  [`formats/evt.md`](formats/evt.md).
- **`queue_event` sel `0x21` is a camera *state selector***, not "hand control
  back from a path", and `cam_play` with `flags & 2` **stashes rather than
  plays** — a later `0x21, 6|7` runs the stashed range. 208/208 follow that
  idiom.
- **The BGM tables.** `[proved]` — one sound id space split by the top nibble,
  two contiguous BGM filename tables whose lengths are fixed by their
  adjacency. Recorded in [`formats/sound.md`](formats/sound.md), and as a
  plate comment on `PlaySoundId` in the Ghidra database.
- **Four `cam/` files have individual bytes smashed to `0xFF`.** 120 destroy a
  float's exponent and decode to NaN or ~1e38; others hit a mantissa byte and
  decode to an ordinary-looking number no finiteness test can catch — `cp_st1`
  path 1's `target_y` holds `da 2c 40 41` = 12.011 seventeen times and
  `da 2c ff 41` = 31.897 three times. `st1evtbl` plays the affected paths, and
  the format reading is confirmed instruction by instruction through the
  loader, `CamBindPathSlots`, `CamEvalPath7` and `CamEvalHermiteCurve`, so the
  shipped executable evaluates them too. The files over-determine themselves —
  channels of a path share a time base, keys sharing a time are duplicates, and
  `st1evtbl`'s own `cam_play` extents state each path's duration — and
  `hod2lib.cam` restores **90 fields, 81 of them exactly**, recording the
  evidence for each. Stage 1's opening cameras now chain end to end (path 2
  ends at eye = (−37.88, 15.20, 133.74) and path 3 starts there) where before
  they jerked. See [`re/anomalies.md`](re/anomalies.md).
- **The cutscene skip works in the retail game, and the player transcribes it.**
  `2C` opens the window, both player-update routines poll Start while the
  shutter's firing gate is down, and the standing task
  `CheckCutsceneSkipRequest` raises the flag — ending the current camera move
  where it stands and draining the asset queue. Every consumer is honoured
  here: `30` drops its action, `40`/`41`/`42` fall through, `0D`/`3A`/`3B`
  suppress, `2D` says nothing and cuts a subtitle already on screen, `2E`
  restarts the BGM. Two earlier notes called this dead code; the task is only
  ever reached through a function pointer, so it appeared in no xref list.
  See [`re/session-log.md`](re/session-log.md).
- **Fog is per-mesh, and its values were in the data all along.** TSP bit 23
  is `FOGENABLE` **inverted**, so fog is on when the bit is clear — which is
  what `ModelForceFogControlNone` exploits. 2197/2219 stage-2 materials are
  fogged. The client renders it **radially** (fog factor from true distance)
  rather than reproducing D3D's default view-space-Z falloff, which fogs the
  screen corners less than the centre; `planar` is a toggle for comparison.
- **The sound tables.** `[proved]` — one id space split by the top nibble, and
  all four name tables read out. Three of the four store no count and are
  bounded only by the table that follows them. `se_play` is **not** restricted
  to SE: across the six stage scripts its operand names 9 BGM tracks, 6 voice
  lines and a stop as well. [`formats/sound.md`](formats/sound.md).
- **Light and fog values are readable.** The `0x20`–`0x27` operands are
  pointers to float constants in the evt file; dereferencing them turns 1,888
  bytes of "unattributed residue" into real values — stage 2 block 3 opens with
  fog near 21, far 507, light RGB (1.0, 0.9, 0.77), ambient 0.5.

## Open, and what each costs

Ranked by what they would actually change on screen.

| Open | Effect | Where the work is |
|---|---|---|
| What starts a stage's own BGM | the player names the stage track by convention and says so | decomp — the scene-entry path, not an xref sweep over 496 callers |
| `path.y - 15` compensation | nothing today; the player is correct without it | decomp — `0x009A60C0` is the camera block's eye at block+0x80, and `CameraFromViewAngles` reads a **4x4 matrix** at the block base (0x009A6040) instead, offsetting `(0, -15, 0)` in its own frame. Which of the two the shipped hooks agree on is the remaining question |
| `CameraEaseBlockEyeToPathPose` (`FUN_00402EF0`) | the block eye is taken straight off the curve; the engine can ease it a sixteenth a frame toward a *second* pose block at 0x009C70C0 | decomp — what writes 0x009C70C0 outside the deferred-rail hooks |
| `0x40C790` | whether deferred (state 6/7) shots are yaw-only | decomp, small |
| Spawn class → model | enemies stay markers | decomp, large — the class table holds handler addresses |
| W6 harness | no regression safety net | client |

### Object rigs

`op_` paths move *things*, and those things are rigs assembled in code — 168
functions call `AssetDrawSlot` and there is no rig format to parse, so
`hod2lib.rigs` transcribes the draw routines by hand. Nine of the 31
`CamEvalObjectPath6` callers are done.

The player renders them, and adds the motion. Rig roots ship **unparented**,
tagged `hod2_path_slot`, because the bundle carries no baked animation — so
the client evaluates the `op_` curve itself. That is what lets it honour three
things exactly rather than approximately:

- **the frame clamp**, `min(frame, CAM_PATH_LENGTH[slot])` — the object stops
  at the end of its path instead of extrapolating along the last segment;
- **the position bias**, added *before* the pose rotations, which a child node
  cannot express (`T(p+b)·R` is not `T(p)·R·T(b)`);
- **the camera gate** — routines dispatch on `g_active_cam_path`, so an
  instance is present only while the camera is on a shot that selects it. The
  object and the shot run on one clock, which is the point.

Parts whose rotation is driven at runtime are **not** baked: `rigs.py` records
the rule, the bundle carries it, and the inspector shows it. Stage 1's vehicle
has nine such parts — wheels, occupants, a swing arm, and four trail effects
that cycle their model every frame.

- **a route is not always ridden.** A route may carry `hold_frame`, the literal
  evaluation time the routine passes instead of the camera frame; the object is
  parked at a point on the path rather than following it. Stage 1's vehicle does
  this on `cp_st1` 2. Driving it with the camera frame instead extrapolated
  `op_st1` 2's `rot_y` to eleven and a half turns and walked the car through the
  camera.

`obj_484ff0_props` is transcribed but deliberately **not placed**: the variant
that selects which prop is drawn comes from a pointer that is not the spawn
descriptor, so there is nothing to place it against yet. The bundle carries
the reason and the player shows it rather than guessing.

## Which instructions the UI strikes through

The script tree and the event feed **strike through any instruction the player
does not act on**, and dot-underline the ones it approximates, so it is
obvious at a glance how much of a stage is really being honoured. The map
lives in `web/src/script/opstatus.ts` — in TypeScript rather than the bundle, because
it describes the *client*, and only the client knows what it has implemented.

Ranked by how often they occur across the six arcade stages, what is still
struck through:

| Op | Name | Uses | Worth doing? |
|---|---|---|---|
| `52`/`53`/`54`/`55`/`56`/`57` | `asset_*` file traffic | 2717 | No — the bundle already holds every model and texture |
| `31` | `goto_scene_state` | 274 | Only with a scene state machine |
| `28` | `region_load` | 262 | No — preloads what is already resident |
| `59`/`58`/`5A` | asset job drains | 188 | No — nothing is ever pending |
| `2C` | `set_skippable_region` | 126 | **Done** — drives the Skip bar; the feature is live in the retail game |
| `33` | `set_action_drain_mode` | 125 | Only with the action ring |
| `10`/`11` | collision sets | 113 | Only with collision |
| `0A` | `spawn_simple` | 98 | Maybe — its descriptors are not resolved to markers |
| `49`/`4A`/`4B` | `variant_*` | — | **Worth checking** — a global picks which operand list runs, so some spawns may never appear |

With rain in, the remaining struck-through opcodes are all either moot in a
bundle that already holds every asset, dead in this build, or gated on
machinery the player does not have (a scene state machine, the action ring,
collision). The one genuine unknown left is `variant_*`.

## Deliberate non-goals

- **It is a script walker, not the event VM.** The blocking opcodes gate on
  live state that is still being decompiled. Everything the data determines is
  executed; everything else is *reported* in the feed with the condition it
  would have blocked on. A guess dressed as an interpreter would be worse than
  an honest walker.
- **Opcodes without a meaning show raw operands**, never an invented label.
- **Enemies are markers.** The class → model mapping is unsolved, so there is
  nothing to look a model up by.
- **The bundle is never committed.** It is game-derived data;
  `extract/player/` is gitignored, and BGM streams from the user's own install
  rather than being copied.

---

## Spawned characters

**Done, for the classes whose handler names a motion.** A spawn descriptor names
a class, the class names a character type, the type names a skeleton in the EXE,
and the skeleton's nodes name asset slots that resolve to a `pol/` file. The
exporter puts that skeleton through the **ordinary rig writer** — a tree of
named parts, each with a translation and an asset slot, is exactly a rig — once
per spawn descriptor, so the stage glTF arrives with a full hierarchy standing
at every one.

The client adopts those hierarchies and takes over the pose, transcribing
`FUN_00410590`: the motion root translation and bone 0's rotation go on a group
*between* the object transform and the bones (putting them on the instance root
would apply the translation in world space and slide every character sideways),
then each bone gets `qZ * qY * qX` from its BAMS triple. Motions loop at the
30 Hz the data is authored at.

**Which motion is the hard part, and it is deliberately conservative.**
`obj+0x1B4` is the motion id — `FUN_00410590` calls the sampler as
`FUN_00412F50(obj+0x1F4, obj+0x1B4, frame)` — and only a class handler writes
it. So a class earns a motion rule the way it earns a character-type rule: by
having its handler read.

| Class | Rule | From |
|---|---|---|
| `0x30` the zombie | motion **956** (`zom.bin`) | `FUN_00452DA0` stores `0x3BC`, or `0x41E` on a branch not taken here |
| `0x53` the cat | `u16[0x00589A64 + variant*10]`, variant from the parameter tail | `FUN_00431250`; the table is a five-entry playlist, all inside `nya.bin`'s 762–773 |

A tempting general rule was tried and rejected: deriving the bank from the
character's bone count. The stride `(bones*6+15) & ~3` must divide every block
in a bank exactly, which uniquely picks `nya.bin` for the cat's 19 bones,
`frog.bin` for 15 and `kame.bin` for 24 — but **30 of the 49 banks are 16-bone**,
so every humanoid would get an arbitrary one of thirty. A character posed from
another character's animation looks like a decoding bug, not a missing feature.

Two things went wrong on the first pass and are worth recording, because one of
them was mine and one of them was a fair reading of the data:

* **The bones came apart.** 863 of 1632 character bone nodes carry more than one
  glTF primitive, and `GLTFLoader` loads such a node as a group whose children
  are named `<node>_0`, `_1`, … A loose `/_bone(\d+)_/` match therefore landed on
  a *primitive* rather than its bone, so the bone stayed at bind while one piece
  of it span about the joint. Matching the exporter's part name as a suffix
  fixes it; the glTF hierarchy itself was correct all along.
* **The characters looked backwards, and the first fix was wrong.** A half turn
  was added to the spawn yaw on the strength of a measurement — comparing every
  class-0x30 spawn's yaw against the direction to the nearest camera eye seemed
  to leave 149 of 203 zombies facing away. That measurement was unsound: the
  nearest sample on a rail the camera travels *past* is frequently behind the
  spawn. The chain is correct at every step, and each step was checked:
  `FUN_004088A0` copies `desc+0x14/18/1C` straight to `obj+0x64/68/6C`;
  `FUN_00410590` feeds them to `RotX; RotY; RotZ`; `MatrixRotateY` builds
  `x' = c·x + s·z`, `z' = −s·x + c·z`, which is three.js's Y rotation exactly;
  `FUN_004016B0` — the source of every angle in the game — is
  `yaw = atan2(dx, dz)`; and the camera's own matrix is
  `T(eye); RotZ(roll); RotY(yaw); RotX(pitch)` built from `eye − target`, so the
  game's camera looks down its local **−Z** on a right-handed basis, exactly as
  three.js does. **The scene is not mirrored.**

  What settles the facing is geometry, not an angle. Posed at motion 956 frame
  0, `char_adv00`'s toe reaches world `z = −2.47` against a heel at `+0.88`, and
  the head's face juts to `z = −1.48`: a posed character faces **−Z**, and
  `RotY(θ)` maps −Z to `θ + 180`. So the authored yaw already aims a character
  where the designer pointed it. The half turn is gone.

  **Verified afterwards.** Re-running the comparison properly — against the
  camera that is actually playing when each spawn instruction executes, rather
  than the nearest sample on any rail — puts **131 of 191 zombies facing the
  camera** within 60°, and only **4** facing away, on a histogram that peaks at
  0° and falls off symmetrically. The biased version of the same test gave 54
  against 149 and was *bimodal at ±180*, which is the shape a broken
  measurement makes: a correct one is unimodal about zero. That shape should
  have been the warning.

* **The humanoids had no waist, and now they do.** Assembled from the skeleton
  alone, `char_adv00`'s torso occupied `y 0.25…4.25` and its pelvis
  `−3.55…−0.96`, leaving a 1.2-unit hole between chest and belt. The skeleton
  was not at fault — `FUN_004107E0` writes one slot per bone and `FUN_00411050`
  draws that one slot, so 15 parts is genuinely what the game draws *from the
  skeleton*.

  It draws more than that. `PTR_DAT_0052ED08[char_type]` is
  `{u32 count; u32 *descriptors[]}`, each descriptor's first word an asset slot,
  and those are parts the skeleton never names. **68 of the 76 character types
  with a skeleton carry one or two; the cat carries none** — which is the same
  split as the gap, and is what identified it. `char_adv00`'s single extra is
  slot `0x1F02`, model 99, `y −0.09…1.69`.

  It hangs off the **second root**. Every character has exactly two root nodes,
  an upper body at bone 1 and a lower body at bone 9 for the 15-bone humanoids
  but 4, 10, 12 or 20 for the wings, `curien` and the HOD1 bosses — so the rule
  is structural, not the number. Rendered both ways: on the second root the
  waist closes and the result matches the game; on the first the gap is still
  there.

  A dead end worth recording so it is not re-walked: `PTR_DAT_004D032C` is the
  per-bone **hit-sphere** table, `{slot, centre x/y/z, radius}` in bone order
  (2.55 torso, 1.3 head, 0.8 hand, 1.75 pelvis) — damage volumes, not geometry.

  **`[open]`** how the game attaches it. The descriptor carries four more
  fields: two pointers to blocks `0x2D8` bytes apart, a count, and a byte array
  reading `ff ff ff ff ff ff ff ff 0a 0b 0c 0d 0e 0f 16 17`, which look like
  per-vertex skinning against several bones. The part is attached **rigidly**
  here, which matches the game at rest; a deforming waist would show up in
  extreme poses.

**287 of 562 identified spawns are posed**, 25 distinct character types across
the six stages. The rest keep their spawn marker, and the marker layer skips any
spawn that has a real character so the two never draw on top of each other.

| Stage | Character types | Posed spawns |
|---|---|---|
| 1 | 5 | 29 |
| 2 | 11 | 108 (including the four cats) |
| 3 | 9 | 55 |
| 4 | 4 | 50 |
| 5 | 4 | 25 |
| 6 | 2 | 20 |

## The gameplay loop

**Done.** Enemies advance by the game's own **advance rings**, compete for an
**attack permit**, and the camera follows whoever holds one. Full account in
[`formats/combat.md`](formats/combat.md) §10; the short version:

* Every enemy measures its distance **to the camera** — the camera is the
  player here — and the ring it starts in sets how many steps it walks before
  it may attack: `{25, 38, 51}` radii, 2 / +3 / +4 steps, from `DAT_004C4CD0`
  and `FUN_00408D60`. No stage uses evt `0x0E`, so those constants are what
  every encounter runs on.
* `TryClaimAttackSlot` grants **one permit per player**. Only the holder enters
  its attack state; everyone else keeps walking. That one byte (`obj+0x121`)
  also decides the camera's focus.
* `RegisterForCameraTracking` skips any actor with flag `0x10000`, which the
  approach state sets while walking and clears when the actor wins a permit —
  so the camera only ever considers enemies that have committed. Candidates are
  keyed `|actor − eye| × 10` and radix-sorted nearest-first; permit holders take
  slots 0 and 1, the rest from 2.
* `SelectCameraLookAtTarget` aims at the lone attacker, the midpoint of two, or
  — with none registered — the `cam/` path's own target, so with no enemies the
  authored camera is reproduced exactly.
* `TurnLookAtToward` eases onto it by `1/(1+rate)` per frame, rate from a
  64-entry curve: **64 below ~18° of error, 16 past ~23°**. That curve is the
  camera's feel — it holds for small offsets and swings for wide ones.

The **Track** checkbox turns it off, restoring the authored path exactly.

**Zombies do not aim their torso or head** — that was asked and is now a
settled negative, not an omission. The per-frame pose hook has exactly two
implementations in the whole program, a no-op and a collision push-out, and
`SkeletonWalkNode` reads every bone rotation straight from the motion bank.
The aiming you see is the whole body turning plus directionally selected
motion variants. See [`formats/combat.md`](formats/combat.md) §10.

**The strike and player damage are in.** An attack entry names its lunge
distance, its strike clip and the exact frame the hit lands on; a **cancel
mask** of destroyed zones makes it whiff if the limb it swings with is gone,
and the same mask picks *which* attack the zombie reaches for. A strike costs
exactly **one life**, 100 points and 90 frames of invulnerability, and drops
the adaptive rank by 2 — being hit makes the game easier. Lives show in the
status bar.

**Thrown weapons are in.** Two of class 0x31's four character types —
`zsass.bin` and `zslman.bin`, spawned out of walking reach — compete for the same attack permit
as the zombies, play the throw clip and release on the frame the table names.
The weapon flies in a straight line at 1.2 units/frame to a point 4 units in
front of the camera, tumbling, and costs a life on arrival: the hit is timed,
not tested. Throwing leaves the hand bare and sets the arm's destroyed-zone
bit, so the cancel mask treats a thrown arm and a shot-off one alike.

**Class 0x31's wall-crawler is in.** `zstin.bin` — stage 2's knife zombie, the
one at `17/5` — does not walk at you and swing. It walks in the distance its
descriptor names, and from then on it is driven by a **pick table**: at 40–50
units it leaps onto the wall beside it or the ceiling above it nine times in
ten, and its whole motion set and attack row change with the surface it is on;
inside thirty units it waits for the attack permit and then **arcs onto the
camera**, stabbing on a numbered frame of the leap clip, and leaps back out to
one side. The leap back is the pause between attacks — there is no cooldown.

Two things about it are worth knowing because they are the opposite of what you
would write. `ThrowerStrikeConnect` **tests no range at all**: the aiming is the
arc, which lands the actor on a point unprojected from a fixed screen offset,
so the stab connects because the flight put it there on that frame. And the
difference between the four character types that share this machine is
*data* — the behaviour set is a byte in the spawn descriptor, and `zsass`'s
picks contain only the throw where `zstin`'s contain the climb.

**And it now dies its own death.** Class 0x31 does not use the shared stagger
or the shared *directional* death clip — it has a four-state chain of its own,
and until this it was borrowing `zom.bin`'s, a different creature's animation.
A shot is read by `ThrowerOnShot` on the actor's next tick and turns into a
state: `zslman` is bounced along whichever axis its stance names, anything else
standing in the hub stumbles, and anything else falls over. **A knockdown is
survivable** — it lies there for a random half-second, gets up and carries on
with its hit points intact — and the get-up clip plays only after a
decapitation, because the head-model swap is the one thing that raises the bit
that routes it there. A kill instead rides a ballistic arc *at the camera*,
harder the nearer it already was, bounces, plays the character's own death clip
and rots for two seconds before despawning.

All thirty-five states are ported. Seven of them are entrances the shipped data
uses, and stage 5's four `zslman` (a camera-relative grab that names which
player it takes) and stage 6's eight (a three-hop blinking materialisation)
were among the ones that previously did nothing at all. Two — 21 and 22 — are
unreachable from anywhere and are ported because the state table names them.

State 27, the grab, now plays its sounds. Two of the four are a **looping
pair**: `PlaySoundId` walks two parallel tables — the looping ids at
`0x005887FC` and their stoppers at `0x005888B0` — and all 44 pairs in them are
`X.wav` against `X_OFF.wav`, so `LASER_SWORD_22` ignites on the landing and
`LASER_SWORD_22_OFF` kills it before the strike. The off cue fires on *every*
non-blinking frame of the hold, not once; the engine has no edge test there and
`PlaySoundId` does not de-duplicate.

**The player runs the game's own collision.** The bundle carries every `coli/`
blob a scene loads and `game/coli.ts` is a transcription of
`ColiSegmentVsMesh` and its callers, so the wall search, the ground height and
the surface material are answered against the quads the engine tests — with the
material ids that only `coli/` has, and headlessly, with no renderer involved.
An earlier pass raycast the *drawn* mesh through a host seam, which could only
ever see the resident region and had to report 0 for every surface; that seam
is gone. Where the search genuinely finds nothing the actor does not climb,
which is what the engine does when there is no wall — and against the real data
**38 of the game's 49 class-0x31 spawns stand on the collision mesh, 22 have a
wall in reach and 11 a ceiling**, 9 and 2 of them in stage 2.

`web/tools/coli_walls.mjs` runs that query through the port and asserts those
four numbers against `tools/verify_thrower_walls.py`, which answers the same
question in independent Python off the `coli/` files. The grounded count agrees
exactly, and the two remaining gaps are the reference being deliberately
looser — it is two-sided, so it counts the floor a spawn stands 0.05 units
inside as a ceiling, and it measures nearest from the wrong end of the segment.
Both are written up at the top of that file. The cross-check is what found the
winding test's per-axis sign parity: the sign factor is the dominant normal
component **negated on Y**, and one global polarity passes every floor in the
game while rejecting every wall, or the reverse.

Two evt opcodes came with it: `0x10` and `0x11` fill the full and the ray-only
collision sets, and the difference between them is that the sphere test
consults only the first.

**Turn-taking, retreat and spacing are in.** After a strike an actor enters
`ZombieStateBackOff`, plays its back-away clip and retreats while **still
holding the attack permit**, releasing only once it is outside the inner ring
or after 240 frames — so the next enemy cannot start until this one has moved
away. There is no cooldown timer; the retreat is the pause. And nothing walks
inside the inner ring, which is what keeps the 161 spawns with no attack state
from closing on the camera for ever.

Still `[open]`, and marked in `enemies.ts`: the walk speed — derived from the
ring table rather than found, and now known *not* to be root motion.

## Shooting

**Done, for the parts that are exact.** Full account in
[`formats/combat.md`](formats/combat.md); the short version:

* A shot is a **ray from the camera through the crosshair**. `FUN_00406110`
  unprojects with the game's own projection distance — `640.21 = 240 / tan(41.1°
  / 2)` — so the client uses the camera it already renders through and gets the
  identical ray. Range 1000 units, as `FUN_00404AD0` builds it.
* The test walks **the same skeleton tree the renderer uses** and intersects a
  **per-bone sphere** from `PTR_DAT_004D032C` — `{slot, centre, radius}` indexed
  `bone − 1`, copied into the bone's draw record each frame so it follows the
  animation. A zombie's radii read as anatomy: torso 2.55, head 1.3, upper arm
  1.4, hand 0.8, pelvis 1.75, thigh 2.15. Nearest along the ray wins, as
  `FUN_00404DB0` sorts.
* Damage escalates **per bone, per hit on that bone**: `g_pBoneDamage` indexed
  `bone*6 + hits_already_taken`. `char_adv02`'s head runs **100, 120, 140, 160**
  and its torso 30/40/50/60/70, plus `DamageRankModifier` — `g_pBoneDamageByRank`
  indexed by the **adaptive rank**, not the menu difficulty. Hit points are the
  descriptor's `+0x22` through `ActorInitHitPoints`: plus
  `g_difficulty_hp_delta[difficulty]` = `{−30, −15, 0, 0, 0}`, clamped to
  `[1, 300]`. A stage-2 zombie is **220**, and on Normal (rank 1) two headshots
  — 100 + 120 — kill exactly.
* **The `[i + 1]` entry of the effect table is a control code, not a slot**:
  0 last step, **1 sever**, 2 no effect at all, anything larger escalate. That
  was read wrong once, which is what left a forearm animating below a destroyed
  upper arm. On a sever, `SeverBoneChildren` → `RemoveBoneSubtree` zeroes the
  draw slot of **every bone below** the severed one, recursively, and a zero
  draw slot is unshootable as well as invisible. Severing bone 3 takes 4 and 5;
  a fatal torso hit severs bone 1 and takes the head and both arms.
* **Getting shot makes them stumble.** `ActorPlayHitReaction` picks the clip
  from a two-level table: the actor's body condition, then the **reaction
  group** of the bone hit — `DAT_004C84A8` maps the bones to head, torso, each
  arm, pelvis, each leg. For the common zombie that is motions 977/982/981/
  979/974 at 29 frames and 961/960 at 39, so a leg shot staggers for longer.
  It plays on a **second motion track** cross-faded over the walk, 10 frames or
  20 when the hit severed something, and bones 9 and up snap in with no fade at
  all. Only results 1 and 3 interrupt: a plain body hit on a zombie does not
  break its stride, which is why they keep coming.
* **Sounds are the game's own tables.** A ricochet per surface material
  (`BULLET_SND/MET/OTH/WAT/WOD`), one of five flesh impacts plus a two-set
  zombie voice on a hit, `BULLET_MET3` when the shot has no effect. The impact
  sprite's position, timing and scale law are transcribed; the artwork is asset
  slots the bundle does not carry, so a splat stands in.
* Score is `FUN_00409430`'s: **10** a hit, **120 + a combo** on the head where
  the combo grows by 10 per consecutive headshot and **any non-head hit resets
  it**, and **80** on the kill.

**Dying is directional.** `FUN_00409430` only drops HP; the actor's own machine
moves it to **state 6** (`FUN_00454D20`), which calls `FUN_004560B0` →
`FUN_00456220`: `camera_yaw − actor_yaw` against four ±45° arcs, picking motion
992, 991, or a random entry from a table of 4 or 6. The clip plays once and the
body stays, because what follows it is `FUN_00456740` and that is unread.

The arcs are named by **angle** rather than front/back — which is which depends
on the camera yaw being target-to-eye *and* a model facing its local −Z, two
conventions at once. The data settles what they do: every motion in both tables
ends with the root on the ground (y ≈ 12 → 1.5), the `0x0000` table carries z by
−8.7/−9.5/−9.3 and the `0x8000` table by +7.4/+8.2 — one falls the way it faces,
the other falls back over. That cluster was found by scanning `zom.bin` for
motions whose root ends lowest **before** the tables were read, so the two are
independent.

**The gore swap is drawn.** `FUN_004099A0` resolves the damaged part's own hit
sphere from the **tail of the same `PTR_DAT_004D032C` table** the bone spheres
come from — past `bone_count − 1` entries, terminated by slot −1 — so a
half-destroyed limb keeps a sensible hit volume: `char_adv00`'s head stage 1
carries the head's 1.3 radius and stage 2 drops to 1.0. 23 entries for
`char_adv00`, **none for the cat**, which is the same split as the damage
escalation. The parts ship as one hidden template per character type and are
cloned onto the bone when hit, rather than duplicated across all 108 instances.

Not implemented, each for a stated reason: the per-bone **collision-mesh**
refinement (the sphere alone picks the same bone except at grazing angles), the
**difficulty modifier** at `PTR_DAT_004D0D84` (needs a rank), **ammo and
reload**, **civilians**, and `FUN_004560B0`'s **special deaths** for a
particular destroyed part (`obj+0x1368` bits → motions 428, 421, 633, 553), so
a character whose arm has come off still plays a directional death.

## Scripted scenery: doors, shutters and vans

**Done for the hinge family.** The zombies that lunge out of a van in stage 2
are not standing in the open — they are inside it, and the doors swing apart on
a script cue. Two spawn classes make that set piece, and they sit at the same
position because they are two halves of one thing:

* **class 0x33 selector 2** (`FUN_00433A10`) is a **static scripted prop**: one
  model at the spawn's pose, drawn until a script flag is set or the camera path
  reaches a given frame. The van body is one of these.
* **class 0x44** (`FUN_00472B10`) is a **prop placer** dispatching on
  `obj+0x11C` through 18 builders at `0x00595AB8`. Selectors **1, 2 and 4 share
  one child behaviour**, `FUN_00473CF0` — 53 of the 123 class-0x44 spawns — and
  that behaviour is a hinge.

The hinge, per frame:

```c
if (remove_flag >= 0 && g_script_flags[remove_flag]) despawn();
if (g_script_flags[open_flag]) {
    f = frame++;                       /* clamped at 59, or 129 on curve 4 */
    obj.rz = base_rz + curve[f].rz;
    obj.rx = base_rx + side * curve[f].rx;
    obj.yaw = curve[f].ry * swing_scale * (side < 1 ? -1 : +1);
}
Translate(pos); RotY(base_yaw); RotZ(rz); RotY(swing); RotX(rx);
```

Two Y rotations with a Z between them: the **mounting** angle and the **swing**
are separate, which is what lets four baked curves serve doors hung at any angle,
and `side` mirrors the swing so one curve opens a pair outward.

| Curve | Frames | Shape |
|---|---|---|
| 0 | 60 | flung to 111.9°, rebounding to 85.9 |
| 1 | 60 | smooth ease to 122.6°, held |
| 2 | 60 | **the van doors** — 179.1° by frame 12, settling to 137.0 |
| 3 | 60 | flung to 91.3°, rebounding to 64.4 |
| 4 | 130 | curve 1 stretched |

**56 hinges and 10 statics** across the six stages: `etc_door`, `komono_shop`,
`komono_barmae` (bar front), `komono_souko` (warehouse), `komono_suimon` (sluice
gate), `komono_tokeidai` (clock tower) — the room-to-room doors among them. The
trigger is an ordinary `set_script_flag` (0x48), and for the room doors it does
land right before a `region_load` / `region_enter`, exactly as you would expect
of a door you walk through; the others are followed by `se_play`, the door sound.

**The entrance motion.** `FUN_00452DA0` copies the spawn's `params[2]` to
`obj+0x1310`, the index `FUN_004533F0` dispatches through the 54-state table at
`0x00592AE8`. State **21** (`FUN_004577F0`) is a one-shot motion cue: it plays
`params[+0x04]`, holds for `params[+0x08]` frames, waits for the clip to end and
then falls to `params[3]`. The two van zombies are exactly that — motion **923**
from `zom.bin`, delays **0 and 10** so they come out one after the other, then
state 1. Motion 923's root translation runs z 0 → −15.7 while y arcs 8.2 → 17.4
and back: a body leaving a van and landing. Six spawns in the game use it.

`[open]` whether the delay also freezes the animation — it gates the state
transition and clears bit 0x4000 of `obj+0x34`, which reads like an
animation-paused bit but is not established. Holding the first frame reproduces
the stagger, and that is what the player does.

Not decoded: the other fifteen class-0x44 builders have their own child
behaviours, and `FUN_00473CF0`'s impact wobble (one damped sine over 16 frames
when a prop is shot) has nothing to drive it here.

## Every opcode, and what the player does with it

> The status column is a copy. The original lives on `Walker.OPS` in
> `web/src/script/walker.ts`, where each opcode's `status` sits on the same object as
> the `run` that justifies it — so the interpreter cannot disagree with the
> script tree about what it honours. `tools/verify_player_ops.py` checks this
> table against that one; it is what caught `enable_rain` being struck through
> while it was implemented, and `set_backdrop_mode` being listed as missing
> after the dome was built.


All 96 dispatch slots, generated against `hod2lib.evt.OPCODES` so none can be
missed. Meanings and confidence marks live in
[`formats/evt.md`](formats/evt.md); this table is only about the **client**.


- **done** — the client acts on it — you can see or hear the result
- ~approx~ — acted on, but by a rule the client can evaluate rather than the game's
- *tracked* — state is kept and shown in the HUD or inspector; nothing is drawn from it yet
- shown — decoded into the event feed with its operands; no state, no effect
- n/a — a proved no-op, a dead opcode, or a dispatch slot no shipped file encodes

| Op | Name | Category | Status | Notes |
|---|---|---|---|---|
| `00` | `nop_stub` | unused | n/a | dispatch slots that map to the empty stub; no shipped file encodes one |
| `01` | `spawn_placed_if_1p` | spawn | n/a | spawn lists gated on the live player count (`g_max_attackers`), forwarding through `g_evt_spawn_gated_handlers` to `09`. No shipped script encodes it |
| `02` | `spawn_simple_if_1p` | spawn | n/a | spawn lists gated on the live player count (`g_max_attackers`), forwarding through `g_evt_spawn_gated_handlers` to `0A`. No shipped script encodes it |
| `03` | `spawn_obj_if_1p` | spawn | **done** | spawn lists gated on the live player count (`g_max_attackers`), forwarding through `g_evt_spawn_gated_handlers` to `0B` — 12 sites. Stage 1's first zombies are here |
| `04` | `spawn_obj_c_if_1p` | spawn | **done** | spawn lists gated on the live player count (`g_max_attackers`), forwarding through `g_evt_spawn_gated_handlers` to `0C` — 3 sites |
| `05` | `spawn_placed_if_2p` | spawn | n/a | spawn lists gated on the live player count (`g_max_attackers`), forwarding through `g_evt_spawn_gated_handlers` to `09`. No shipped script encodes it |
| `06` | `spawn_simple_if_2p` | spawn | n/a | spawn lists gated on the live player count (`g_max_attackers`), forwarding through `g_evt_spawn_gated_handlers` to `0A`. No shipped script encodes it |
| `07` | `spawn_obj_if_2p` | spawn | **done** | spawn lists gated on the live player count (`g_max_attackers`), forwarding through `g_evt_spawn_gated_handlers` to `0B` — 45 sites; the extra enemies a second player brings |
| `08` | `spawn_obj_c_if_2p` | spawn | **done** | spawn lists gated on the live player count (`g_max_attackers`), forwarding through `g_evt_spawn_gated_handlers` to `0C` — 3 sites |
| `09` | `spawn_placed` | spawn | **done** | spawn markers: position, BAMS yaw, class, hit points |
| `0A` | `spawn_simple` | spawn | shown | same descriptor family; not resolved to markers |
| `0B` | `spawn_obj` | spawn | **done** | spawn markers: position, BAMS yaw, class, hit points |
| `0C` | `spawn_obj_c` | spawn | **done** | spawn markers: position, BAMS yaw, class, hit points |
| `0D` | `spawn_obj_unless_skip` | spawn | **done** | spawn markers: position, BAMS yaw, class, hit points |
| `0E` | `set_approach_rings` | spawn | shown | enemy approach pacing; operands decoded as floats |
| `0F` | `set_approach_steps` | spawn | **done** | **writes `g_enemy_approach_steps`/`_mid`/`_outer`** — how deep in the distance queue an enemy may be and still come at you. Operands are a `-1`-terminated list of **ints**, not floats. Stage 2 sets 2/3/4, 2/2/2 and 1/1/1 in different blocks |
| `10` | `set_collision_set_full` | collision | done | fills `g_coli_full_set`, which the segment **and** the sphere test consult |
| `11` | `set_collision_set_ray_only` | collision | done | fills `g_coli_ray_set`, which only the segment test consults |
| `12` | `set_approach_steps_2p_bias` | spawn | shown | enemy approach pacing; operands decoded as floats |
| `13` | `set_scene_lighting_override` | light | *tracked* | lighting override; values decoded, not applied to the render |
| `14` | `set_scene_lighting` | light | **done** | gates `15` and `16`, as the game does |
| `15` | `enable_entity_spotlights` | light | **done** | **the two players' gun lights** — not one per enemy; the array is two entries wide |
| `16` | `set_ambient_light_rgb` | light | *tracked* | lighting override; values decoded, not applied to the render |
| `17` | `slerp_light0_direction` | light | ~approx~ | the slerp target is taken immediately rather than stepped |
| `18` | `set_light0_direction` | light | **done** | **drives the directional light** in `+ scene light` mode |
| `19` | `set_light1_direction` | light | none | light block 1 — pushed only at scene init, so it never reaches the renderer |
| `1A` | `set_ground_plane_y` | camera | *tracked* | ground plane / g_camera_fixed_eye_y; see the eye-height note |
| `1B` | `set_backdrop_preset` | scenery | **done** | **the backdrop dome is drawn**, following the camera |
| `1C` | `set_backdrop_mode` | scenery | **done** | dome mode: 0 off, 2 frozen, anything else spins at the preset's rate |
| `1D` | `enable_rain` | scenery | **done** | **50 particles**, transcribed from `DrawRainParticles` — only stage 1 ever turns it on |
| `1E` | `set_unread_global` | nop | n/a | dead: the global it writes has no readers anywhere in the binary |
| `1F` | `set_hud_shutter_state` | hud | **done** | **the letterbox shutter**, all 9 states with the 40-frame slide, sized from asset `0x93E`'s own quad; the UI names each state and says what it does to the firing gate |
| `20` | `light0_set` | light | **done** | light block 0: **fog near/far and colour, light colour and ambient all applied** |
| `21` | `light0_tween_rate` | light | ~approx~ | jumps to the target; the per-frame step is not modelled |
| `22` | `light0_stop` | light | shown | clears a channel tween |
| `23` | `light0_tween_time` | light | ~approx~ | jumps to the target; the per-frame step is not modelled |
| `24` | `light1_set` | light | none | light block 1 — pushed only at scene init, so it never reaches the renderer |
| `25` | `light1_tween_rate` | light | none | light block 1 — pushed only at scene init, so it never reaches the renderer |
| `26` | `light1_stop` | light | shown | clears a channel tween |
| `27` | `light1_tween_time` | light | none | light block 1 — pushed only at scene init, so it never reaches the renderer |
| `28` | `region_load` | region | shown | preloads a region's assets; everything is already resident here |
| `29` | `region_enter` | region | **done** | **switches the drawn region** — the core of the streaming model |
| `2A` | `unused_2a` | unused | n/a | dispatch slots that map to the empty stub; no shipped file encodes one |
| `2B` | `award_accuracy_bonus` | flow | shown | end-of-stage accuracy bonus |
| `2C` | `set_skippable_region` | flow | **done** | opens/closes the skippable window (`DAT_009A2D7C`); raises the Skip bar once the shutter's firing gate is also down, which is exactly when the game polls Start |
| `0D` | `spawn_obj_unless_skip` | spawn | **done** | spawns, unless a skip is in progress — `FUN_00408B70` walks the list either way |
| `2D` | `play_dialogue` | hud | **done** | **plays the voice and shows the subtitles** — the real script text, centred on a 384 baseline, advancing line by line on the game's countdown |
| `2E` | `resume_bgm_if_skipped` | audio | **done** | restarts BGM `0x80000002` when a skip actually happened; inert otherwise, as in the game |
| `2F` | `suppress_accuracy_stats` | flow | shown | suppresses the counters 0x2B grades |
| `30` | `queue_event` | camera | **done** | the scripted-action ring — see the selector table below |
| `31` | `goto_scene_state` | flow | shown | scene state transition; the player has no state machine |
| `32` | `goto_scene_state_when_alive` | flow | shown | scene state transition; the player has no state machine |
| `33` | `set_action_drain_mode` | flow | shown | action-ring drain mode |
| `34` | `unused_34` | unused | n/a | dispatch slots that map to the empty stub; no shipped file encodes one |
| `35` | `enable_camera_path_roll` | camera | **done** | **gates the camera roll channel**, exactly as CamEvalPath7 does |
| `36` | `pin_view_to_ground_plane` | camera | *tracked* | selects the fixed camera eye height; see the eye-height note |
| `37` | `force_camera_path_advance` | camera | *tracked* | forces camera path advance past the room-cleared gate |
| `38` | `se_play` | audio | **done** | **sound effects, voice and BGM play** — dispatched by namespace like PlaySoundId |
| `39` | `se_play_3d` | audio | **done** | **sound effects, voice and BGM play** — dispatched by namespace like PlaySoundId |
| `3A` | `se_play_unless_skip` | audio | **done** | **sound effects, voice and BGM play** — dispatched by namespace like PlaySoundId |
| `3B` | `se_play_3d_unless_skip` | audio | **done** | **sound effects, voice and BGM play** — dispatched by namespace like PlaySoundId |
| `3C` | `unused_3c` | unused | n/a | dispatch slots that map to the empty stub; no shipped file encodes one |
| `3D` | `nop3` | nop | n/a | proved no-ops |
| `3E` | `nop1` | nop | n/a | proved no-ops |
| `3F` | `nop0` | nop | n/a | proved no-ops |
| `40` | `wait_queued_events_done` | wait | ~approx~ | resolves when the current camera move ends |
| `41` | `wait_camera_path_frame` | wait | **done** | **exact** camera-frame gate; operand 0 waits for the end of the path |
| `42` | `wait_frames` | wait | **done** | **exact** frame countdown |
| `43` | `wait_enemies_present` | wait | ~approx~ | the combat gate. **Real while Shoot is on** — the script holds until they are dead; with Shoot off nothing can make the count fall, so it passes and the feed says so |
| `44` | `wait_enemies_alive` | wait | ~approx~ | the combat gate, gated with `0x43` |
| `45` | `wait_script_flag` | wait | ~approx~ | honoured when the script itself set the flag; otherwise passed |
| `46` | `wait_scripted_actors` | wait | ~approx~ | the civilian gate — `g_civilians_alive`, the same handler as `0x43` on a different counter. **Real while Shoot is on**; with Shoot off nothing can rescue a civilian, so it passes rather than deadlocking. All 68 sites pass operand 0 |
| `47` | `wait_targets_clear` | wait | shown | runtime counter; passed, with the condition reported |
| `48` | `set_script_flag` | flow | *tracked* | writes the script flag array 0x45 reads |
| `49` | `variant_call_a` | flow | shown | a global picks which operand list runs; the client does not evaluate it |
| `4A` | `variant_call_b` | flow | shown | a global picks which operand list runs; the client does not evaluate it |
| `4B` | `variant_spawn` | spawn | shown | a global picks which operand list runs; the client does not evaluate it |
| `4C` | `unused_4c` | unused | n/a | dispatch slots that map to the empty stub; no shipped file encodes one |
| `4D` | `checkpoint` | flow | *tracked* | records the checkpoint block |
| `4E` | `halt` | flow | **done** | **parks playback** — it does not end the scene |
| `4F` | `end_block` | flow | **done** | **next step, or the route table** when the step list is exhausted |
| `50` | `asset_load_slot` | assets | **done** | **streams a model in / out** of the drawn set |
| `51` | `asset_unload_slot` | assets | **done** | **streams a model in / out** of the drawn set |
| `52` | `asset_load_polfile` | assets | shown | whole-file asset traffic; the bundle already holds every model |
| `53` | `asset_free_polfile` | assets | shown | whole-file asset traffic; the bundle already holds every model |
| `54` | `asset_load_texbank` | assets | shown | whole-file asset traffic; the bundle already holds every model |
| `55` | `asset_free_texbank` | assets | shown | whole-file asset traffic; the bundle already holds every model |
| `56` | `asset_job_8` | assets | shown | whole-file asset traffic; the bundle already holds every model |
| `57` | `asset_job_9` | assets | shown | whole-file asset traffic; the bundle already holds every model |
| `58` | `asset_wait_all_jobs` | assets | shown | drains the asset job ring; instant here, nothing is pending |
| `59` | `asset_wait_tex_pol_jobs` | assets | shown | drains the asset job ring; instant here, nothing is pending |
| `5A` | `asset_wait_motion_jobs` | assets | shown | drains the asset job ring; instant here, nothing is pending |
| `5B` | `nop0_b` | nop | n/a | proved no-ops |
| `5C` | `nop0_c` | nop | n/a | proved no-ops |
| `5D` | `snd_load_pack_stub` | audio | n/a | OutputDebugStringA stubs — the PC port streams .wav instead |
| `5E` | `snd_free_pack_stub` | audio | n/a | OutputDebugStringA stubs — the PC port streams .wav instead |
| `5F` | `bgm_entry_play` | audio | **done** | **plays a BGM track** |

### `queue_event` (`0x30`) selectors

| Sel | Action | Status | Notes |
|---|---|---|---|
| `10` | `set_player_flag` | shown |  |
| `11` | `scene_state` | shown |  |
| `12` | `set_update_routine` | shown |  |
| `13` | `set_continuation` | n/a | defined, never used in shipped data |
| `14` | `set_global` | shown |  |
| `15` | `set_flag` | shown |  |
| `20` | `hold_camera_preset` | shown | the preset table at 0x00576CF0 is not read |
| `21` | `finish_sequence` | **done** | camera state: 4 snaps to the path eye, 6/7 play the stashed range |
| `40` | `cam_play` | **done** | start..end at 60 Hz; `-1` resumes, `start == end` holds, `flags & 2` stashes |
| `60` | `store_six` | **done** | the branch preview shots, offered on hover at a branch |

### The eye-height note

`0x1A` and `0x36` are marked *tracked* rather than **done** on purpose. Every
camera hook applies `eye.y = use_fixed_y ? fixed_eye_y : path.y - 15`, but
applying that to the `cp_` curve puts 173 of 201 paths looking upward at their
own aim point, so the client records both values and applies neither. The
measurement and a switch to re-enable it are in `web/src/render/campath.ts`.

