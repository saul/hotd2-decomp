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

**Class 0x30 state 37 carries and throws** (`class30/carry_prop.ts`,
`game/carried_prop.ts`). Stage 3 block 3 step 6's two fat zombies spawn on
the bridge holding drums over their heads: `ZombieStateCarryProp` allocates the
drum as a classless object (`CarriedPropInit`), turns to the camera through the
carry clip's loops, claims the player's attack permit, and lets go on frame 24
of the throw. The drum flies a ballistic arc to fifteen units in front of the
camera; three hits break it in the air (and give the permit back), and one that
arrives costs a life and sits on the lens for ninety frames. The state used to
run as the maul, which played the throw with nothing in the hands, ended the
script a second later and retired both zombies off screen while the camera was
still on its way -- so the bridge was empty. Stage 1's barrel man over the
civilian (block 6, bug 11) is the same state releasing into behaviour 3,
`CarriedPropThrowAtTarget`: two loops of 271 and one of 265 before 266 lets go
on frame 15, and the barrel dropped on the civilian's head kills her unless it
or its carrier is shot first. `op 0x47`, `wait_targets_clear`, is real now and
counts carried props as camera candidates. Stage 2 block 28's pair release
into behaviour 5, `CarriedPropRollAtCamera`: the barrels roll down the steps at
the player on `CarriedPropGroundContact`'s friction-and-bounce ground model. A
carrier killed holding its prop drops it (`CarriedPropDrop`,
`CarriedPropFallFree`), and a prop shot to pieces draws its break effect -- the
drum splits in two -- through the effect tree the class-0x44 props use.

**A rescued civilian holds the room while she speaks** (bug 18). There is no
"wait for the dialogue" opcode: `CivilianUpdate` (`FUN_0048A920`) calls
`ActorRegisterCameraPoint` every frame (`0x0048ADB0`), which tail-calls
`RegisterForCameraTracking`, so a civilian is a camera candidate whenever her
wait word carries `0x40000`. While she holds a `g_enemy_slots` entry the
camera tracks her, `g_camera_free` stays down and `wait_enemies_alive` holds;
her script drops the bit in the block that reopens the shutter. The port kept
every non-enemy out of the candidate list, so stage 4 (Original) block 1 handed
the room back the frame her captor died and the two throwers walked in 180
frames into her line with the shutter still closed. `ClassHandler.tracksCamera`
is how a non-enemy class says its routine makes the call; `web/tools/civ_speech.mjs`
times rescue, lines, shutter, gate and next spawn on stage 4 (Original) block 1
and stage 2 block 6. Stage 1 block 1's script untracks her for the two turn
clips before her line, so there the gate can still open before she speaks --
the same rule, applied to that script.

**A deep link lands with the civilians play would have.** A seek replays the
script with every wait stepped over and no actor running, so a civilian from
an earlier block was rebuilt at her first command wherever the link landed --
captors, camera slot and rescue all ahead of her again, which since bug 18
holds the room's gate for good (stage 3 past block 0, stage 4 past block 1).
The replay now applies her own ways out (`script/civilian_life.ts`): her
removal cue when its camera plays it, and the off-camera arm at the first
`goto_scene_state` after her room. The game itself now has that arm too
(`CivilianUpdate`'s `0x2000000` test, with `ActorBoundsOnScreen` ported), so a
rescued civilian leaves once she is off screen. All fourteen bug links in
`NEW-BUGS.md` load and play to the stage's end (`playthrough.mjs --link`).
The two ported bosses are camera candidates as the exe makes them
(`Class14Update`, `Boss4Update`), with their per-actor lifts -- and the stage-2
boss's three deaths now take it off the camera's list as the exe's do, which
the port's shared death body had left out.

**A civilian's captors are made again.** `CivilianInit` spawns its children
itself, so the walker's spawn list names only the civilian; 6da5fab walked
that list to keep the script's order and every captor in the game went
unmade. `syncCharacterSpawns` now makes them straight after their civilian.

**Stage 1's bin civilian falls onto the bin and climbs off it** (block 6,
`0x3C38`, stream 13). Three faults, one scene. Op 0x18's pose was exported as
six floats where the exe copies three floats and three BAMS integers, so her
`0xC000` yaw arrived as 6.9e-41 and the fall carried her along -Z instead of
+X, off the bin. `CivilianApplyMotionPose` (`FUN_0048C310`), which every
civilian clip change runs, was unported: its `0x20000` arm is what moves her
down to the ground after the climb-off clip, so she walked the rest of the scene
at the height of the lid; it also turns her by the heading her drawn pose has
and the new clip lacks, and starts the clip over op 0x03's fade -- op 0x03 was
`SetTurnRate` and is the blend length. And the bin captor (`0x3D34`) bursts
into state 36 and walks past its point in state 40, whose subs 0/1 write the
script cursor's **blob** as well as its index; the port wrote the index alone
(d82271fb made the cursor a pointer and missed this writer and state 41's), so
state 35 replayed the burst -- the target blob's entry -- and bounced back to
40 for ever. It now plays its attack list once and turns on the player. Tests:
"class 0x10's clip change" and "the bin captor's walk" in `port.test.ts`, and
`tools/verify_civilian_scripts.py`'s pose check.

**...and that port made stage 1's first civilian spin.** The fountain man
(`0x1828`, block 1, stream 1's on-shot stream 0) plays 378 once, holds its
last frame, and changes to 377 under `0x8200`. `CivilianStepScript` runs
`CivilianReapplyWaitCommand` (`FUN_0048B760`) over that block before
`CivilianRunScript` does, and the walk's op 0x00 is `MOV dword ptr [ECX +
0x8], 0x0` (`0x0048B794`): the **cursor**, `model+0x08`, which the next draw
recomputes from the counter at `model+0x00`. The port has one clock and wrote
it, so 378 was back on frame 0 when `CivilianApplyMotionPose` -- which reads
the draw records, never `model+0x08` -- took the drawn heading: `yaw` jumped
+26345 BAMS (145 degrees) in one frame, the body's drawn heading 28120, and the
fade from 378's first frame swung it back over ten. Harmless while the clip
change was a cut; 16ba4b4e made it turn and fade from the drawn pose. The
store now reaches the port's clock only while a fade holds the cursor
(`ActorStorePlayCursor`), and otherwise waits in `Actor.cursorStore` for its
one reader, the step's own `0x200` test. Measured in the page from
`?stage=1&block=1&step=7&op=0&drive=1&seed=1`, captors shot: the fountain
man's yaw changes 0 in 513 frames (it was 51.4 BAMS a frame on average, one
step of 26345), and the change to 377 draws no step at all. Every civilian's
fade had the same fault -- 22 of the 32 clip changes the civilians harness
checks started from frame 0 of their clip, now none; the bin girl's climb-off
popped 77 degrees at the fade's start and her `0x8000` turn read 669's first
frame for 8143 BAMS where her drawn cursor gives 6875. Tests: "class 0x10's
resume stores the cursor, not the clock" (four assertions, three failing on
the base) and the civilians harness's fade check.

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

*And the sphere is where she is drawn.* The centre of that body sphere,
`obj+0x12C`, is `CivilianUpdate`'s to write, from a switch on op 0x17's mode:
the position, bone 2, bone 1 -- every civilian's until a script says
otherwise -- or halfway between bones 12 and 15, the fallen body's. Each bone
is its draw record taken back to the world. Only the position had been
ported, so the push measured every civilian at class 0x30's feet-plus-radius
point and the pose hook traced that same point; both read the switch's
centre now (`class10/update.ts`, `docs/formats/civilians.md`).

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

**The stationary thrower is in** — class 0x30 state 33,
`ZombieStateStandAndThrow` (`FUN_00459080`), the **only** state in the class
that never moves the actor. It stands where the script put it, plays `row[0]`,
takes an attack permit, throws the weapon out of one hand and then the other,
and only when both are empty does it walk away or leap out. Nine spawns start
in it, and the port had none of it: `ZombieEntryState` folded them all into
`AttackRun`, so stage 1's `0x2BF4` — character type 0x13, whose asset file is
the game's own **`tutorial.bin`** — charged the camera instead of standing
across the room throwing axes at you.

There is no table behind any of it. A switch on the character type inside
`ZombiePickThrowingHand` and `ZombieThrowHandWeapon` is the whole list, and
resolving the asset slots names the parts: `0x13` is `tutorial.bin`, `0x14` is
`znonoopa.bin`, and what both throw is `znonoo.bin` part 0 — the axe. Char
type 1 (`znassb.bin`) lobs parts of its own model on an arc. A hand counts as
armed exactly while its bone's **draw slot** is still the one the skeleton gave
it, so shooting the axe out of a hand disarms it and the pick falls to the
other.

**And what it throws is now drawn.** The whole visual half of that was missing
for as long as the state has been ported: `charbuild.goreEntry` builds the
hidden per-type rig the client clones models out of, and it walked class
0x31's hand table rather than class 0x30's — so the axe (`0x249`), and both
hands in both their held and bare forms, were in no rig at all.
`cloneSlot` answered null for the projectile and `swapGore` returned false for
the hand, which leaves the axe in a fist that has just thrown it. The weapon
flew on time and dealt its damage the whole while; nothing on screen said so,
which reads exactly as *"he doesn't throw any axes"*. This is the civilians'
hair one table over, and the check that catches it is beside that one:
`verify_attachments.py` now resolves every held, bare and projectile slot a
throwing zombie's kit names against the stage's glTF — 72 of them.

**The ending is chosen by a spawn bit, not by the room.**
`EnemyZombieInitByCharType` (`FUN_00452FD0`) moves `obj+0x34` bit 1 into
`obj+0x38` bit `0x10` and clears it at the source, and that bit is the whole of
`ZombieStateStandAndThrow`'s two-way ending: with it set the actor gives both
enemy counters and its permit back **where it stands**, goes shot-immune and
untracked, and waits out `tail+0x1C` before despawning. Two spawn records in
the shipped game set it — stage 3 block 2's two axe men — and without it both
took the *other* arm and walked their descriptor's twenty-five units backwards
through the building they are standing against, holding `wait_enemies_alive`
for the hundred frames it took. `ZombieStateWalkDistance` has no test that
could have stopped them and the collision selected there is thirty-one quads of
water twenty-four units below their feet, so nothing in the level was going to.

The flight reuses the pool class 0x31's projectile already lives in, extended
with the acceleration the arc needs and the damage kind (4 flat, 6 arced).
`ZombieShouldStandAndThrow` is wired in too: a body-condition-8 walker already
facing the camera stops and throws rather than closing, and fourteen spawns are
condition 8.

**The body condition is recomputed now, and that is what fixed the throwers.**
`ActorBodyConditionFromHands` (`FUN_00455920`) has exactly one caller —
`ZombieStateHoldAtRange` (`FUN_00455720`) runs it on its second line — and the
port did not have the call at all. Conditions 7 and 8 index the **throw** row
rather than a swing (reach 99, clip 1005/1004, hit frame 35), so a condition-8
`znonoopa` that closed on the camera kept condition 8 into `ZombieStateStrike`,
which read the throw as a melee: the lunge test passed at once at twenty-four
units, the swing began, and `ApplyRootMotion`'s strike floor — set from the
attack's own `distance` — shoved the actor back out to exactly ninety-nine
units on the next frame. It then stood there for the rest of the stage playing
the throw animation and landing the hit from across the room without ever
letting go of the axe. Seventy-five units of teleport, in one frame, and it is
both halves of the bug report: "gets close, then teleports back and starts
throwing", and "plays the animation but never throws".

With the call in, the walker keeps condition 8 through the whole approach —
which is the window `ZombieShouldStandAndThrow` reads, so it still throws on
the way in — and loses it on its first frame at the ring, after which it swings
the nineteen-unit melee at your face. The engine's own operand bug at
`0x0045599C` is transcribed with it: `znonoopa`'s left hand can never count as
armed, so it always lands on condition 1 with the left-arm zone bit set, which
pins its pick to the right-arm swing.

**And the crawler's swing misses now, because the engine's does.** Character
types `0x07`, `0x0B` and `0x0C` share a body-condition-4 attack entry at
`0x00566E70` — `{997, 1051, 26.0f, 40, 9, 1}` — whose hit frame is 40 against
`g_motion_play_length[997]` of 20. `ZombieStateStrike` fires the hit on
`obj+0x19C == entry+0x08` *exactly* (`00455bdf CMP ECX,EAX` / `JNZ`) and leaves
the state at `play_length - 1` (`00455c02..0d`), so the equality is never
reached: the strike never fires, nothing is aborted and nothing is retried, the
clip plays out and the actor retreats. The condition-4 pick row is ten 2s then
ten 3s per zone combo, so an **undamaged** crawler always draws that entry and
always misses; one with its head shot off draws entry 3 — clip 1018, hit frame
3 — and connects. `[proved]`

The port had it the other way round, and this was divergence 2. The exporter
dropped the entry as an impossible row, which left the draw naming an index the
bundle had no attack for, and `ZombiePickAttack` reached for another one — so
the crawlers landed the swing the engine whiffs, and **the port was more
dangerous than the game**. The bundle carries the entry and bakes clip 997 now,
the draw is blind again as the engine's is, and measured against the real
stage-2 bundle over one minute against a live player: **29 hits landed before,
0 after**, with the head-shot arm still landing its 29. `verify_port.py` asks
the bundle for the entry and the clip; `verify_combat.py` asserts the *exact
set* of three entries the engine can never land, rather than the bound it used
to impose, because a row misread out of the next character's attacks looks the
same from the outside and that is what the bound was really for.

`web/tools/throwers.mjs` measures it: nine throwers, all nine net under 0.2
units of movement against the 4.2-unit swing their throw clips carry and
return, all nine throw both hands, all nine leave — seven by state 15 and two
by state 26. That walk exit is the one place in the game that reaches
`ZombieStateWalkDistance`'s retire branch, which the walk-in commit had marked
unreachable.

**The spawn record's flags word reaches the actor now.** `ActorInitFlags`
(`FUN_00408970`) makes it `obj+0x34` before the class's `Init` ORs its own bits
on, and the port had been dropping it. The bit that showed is `0x20000`, which
exempts an actor from the per-frame ground snap: stage 1's axe man stands on a
ledge whose collision is two *vertical* quads, so the ground query finds nothing
under him and the snap dropped him sixty-two units, from where he threw from
behind the wall he had been standing on. Ninety-five spawns set that bit.

**And the placement-to-`Actor` mapping is one function.** `render/characters.ts`
built it inline and each headless harness built its own copy, and the copies
drifted: `throwers.mjs` reported nine working throwers while every one of them
in the player read a walk distance of zero — the harness passed `stand_throw`
and the player did not. `DescriptorFromPlacement` in `game/descriptor.ts` is
the single builder now, and folding the harnesses into it turned up the same
drift the other way: `replay.mjs` had been passing four class-0x31 descriptor
fields the player never did.

**You can shoot a thrown weapon out of the air** — the axe, and every knife
and blade in the game. Both weapon routines end their frame with the draw, the
view point at `obj+0x70` and `RegisterForShotTest` (`FUN_00405160`), so a
weapon is an ordinary object to the shot test: a whole two-unit sphere
(`obj+0x124 = 2.0`, `obj+0x34 = 0x80000001`, no per-bone bit), marked by
`MarkActorShot` like anything else. Its own routine reads the mark on its next
frame, counts a hit in `g_player_hit_count`, gives its thrower's permit back
on the spot and goes to its shot-down state — `ThrownWeaponDeflected`
(`FUN_00450050`) for class 0x31, `ZombieThrownWeaponStateShotDown`
(`FUN_00459D20`) for class 0x30: a spark, `KNIFE*_OFF` and `BULLET_MET3`, five
frames hanging where it was hit, and off to a random point up to a hundred
units away in view space, cartwheeling about X at 1.3 times its old spin. It
scores nothing. `game/thrown_weapon.ts` has the whole path.

It did not need the pool to become actors, which is what this paragraph used
to say it would cost. The pool keeps the engine's fields at their offsets,
each record runs the routine its launcher installed, and a shot-test entry can
name a weapon as well as an actor; `ProcessPlayerShotsTestList` tests both in
one pass and one sort. What the engine's weapon also does and the record does
not: it claims a `g_hit_slots` entry (read only for a class-0x30 bone's cel
phase), registers for camera tracking, and draws a 5-by-5 ground shadow. Each
is declared where the call is not made. `zslman`'s blades' fading afterimages
(`ZslmanBladeEmitAfterimage`, `FUN_00450930`) used to be the fourth; they are
ported, in the same list — see *zslman's blades trail afterimages* below.

**The spin was the port's own, and slow.** Every thrown weapon tumbled at
`0x200` BAMS a frame, declared as the port's invention on a reading that
nothing writes `obj+0x135C` and the allocator leaves it uninitialised. Both
launchers write it, past a `MatrixStackPop` the decompiler stops at (`L35`),
and `ActorClearGameFields` clears the block on the line after `ActorAlloc`
anyway:

| weapon | rate | axis | from |
|---|---|---|---|
| `zsass`'s knives, `zslman`'s blades (class 0x31) | `0x2400`, signed by the hand | Y, with a fixed `0x600` lean on X for `zsass` | `SpawnThrownWeapon`, `0x0045072C` |
| the axe (class 0x30, straight) | `0xB00` | X | `ZombieThrowHandWeapon`, `0x0045A427` |
| `znassb`'s blades (class 0x30, arc) | `0x1600` | Y | `ZombieThrowHandWeapon`, `0x0045A43C` |

Class 0x30's weapon also leaves the hand pointed at its target and rolled
`0x800`, and both families land in the engine's own pose — class 0x31's faces
the eye with two random kicks and keeps its lean, class 0x30's faces back the
way it came — rather than a look-at the renderer used to do for them. The
renderer now draws each weapon under the modelview its own routine built, so
there is no second copy of the rotation order to drift.

**And the permit rides the weapon.** Both launchers copy `obj+0x121` onto the
projectile and leave the thrower holding **0**; the weapon gives it back when
it has blinked out, or at once when it is shot down. The port freed it at the
throw — class 0x31 — or at the end of the throw clip — class 0x30's
`ZombieStateStandAndThrow`, whose clip end in fact drops only the off-screen
latch. So a knife in the air now holds the room's permit for its flight, its
thirty frames on the screen and its sixty blinking, and **shooting it down is
what lets the next enemy in**: in stage 2 block 5 the second `zsass` used to
throw twenty-seven frames after the first, with both knives in the air at
once.

**`znassb` throws both blades at once.** `ZombieStateStandAndThrow`'s release
arm throws a second weapon for character type 1 — `TryClaimAttackSlot`, whose
answer it ignores, `ZombiePickThrowingHand` and a second
`ZombieThrowHandWeapon` (`0x004592E4`..`0x00459301`) — so in a two-permit game
each player gets a blade. Then `ZombieRetireThrowConditionIfUnarmed`
(`FUN_004595F0`) takes a condition-8 walker with nothing left in its hands to
condition 0 and raises its sprint bit.

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

**Characters spawn when the script spawns them.** `CharacterLayer.build`
adopted the stage glTF's hierarchies *and* made an `Actor` for every one of
them, gating presence with `visible` afterwards. The engine makes an object in
`SpawnFromDescriptor` (`FUN_00408A20`) when opcode 0x0B/0x0C/0x0D runs, and
runs its class `Init` there — so every `Init` in the level had already run
before the first frame, and `CharacterLayer.revive` ran all of them a second
time on top. `CivilianInit` raises `g_civilians_alive` unconditionally, so
stage 1 reported thirteen live civilians against seven actors and
`wait_scripted_actors` — 68 sites, all wanting zero — could never pass at block
1, where exactly one of the seven has been spawned.

`syncSpawns` is that lifetime now, driven from the script phase beside
`SpawnPropContainers` so an actor ticks on the frame its instruction ran. At
stage 1 block 1 the pool holds 14 actors rather than 73.
`render-drives-the-port` fell from 13 to 12.

**A debug toggle no longer changes what the game does.** `Characters` was
folded into `a.visible`, which is the port's stand-in for object lifetime — so
unticking it emptied `g_enemies_alive` and `g_civilians_alive` and released
every gate that reads them. The switch is the renderer's now and the lifetime
is the port's. The prop overlay also has its own switch, `Prop boxes`, instead
of riding on `Props`: a box, a cross and a label on every prop is not what
anyone wants to look at the scene through.

**A third entrance: the one that arrives on a clip.** `ZombieStateMotionCue21`
(state 21, `FUN_004577F0`) is ported — the two zombies that come out through
the van's windscreen in stage 2 and four more in stage 5. It plays the
descriptor's clip after the descriptor's delay and hands to the descriptor's
exit at `g_motion_play_length - 1`, the play clock rather than the authored
frame count.

The reason it matters out of proportion to six spawns: **it is the only thing
in the game that clears the three flag bits their spawn record sets.** The
record parks the actor inside the vehicle with `obj+0x34` bit `0x4000`, and
`ZombieAdvanceMotion` (`FUN_00454860`) then refuses to step `obj+0x194` and
`obj+0x198` at all. `mapStartState` had been routing state 21 to `AttackRun`
through its default arm, so the bit was never cleared: the clip never
advanced, and because a zombie is carried by its clip's own root translation
and by nothing else, it could not close either. Both van zombies stood at 45
units wanting a permit, for ever — which read on screen as *only the first
enemy in the stage attacks*, since they are the pair the script holds
`wait_enemies_alive` open for. They now close to the ring and fight. The other
two bits are the shot-immunity window (`0x100`, dropped on the landing frame
of clip 923) and `0x2000`; both were also stuck on, so neither could be shot.

Its descriptor pair went into `DescriptorFromPlacement` with everything else.
The port had been faking this state with an ad-hoc `intro` field on `Actor`
that `render/characters.ts` set and `ActorAdvanceMotion` played out — a
mechanism the engine does not have, which is now gone.

**And two entrances that place the actor.** A spawn's `y` is where its entrance
*starts*, not where it stands:

* `ZombieStateEmerge` (27, eighteen spawns) cuts to the submerged clip 0xB9
  and lets it play -- this said "with the clock frozen and root motion off",
  and nothing in the routine writes the freeze bit -- waits the descriptor's
  delay (the first frame of it counted on the spawn frame, and a spawn whose
  `tail+0x03` is 1 not drawn until it is over), then cuts to the clip the
  descriptor names — 178 for the water ones, 183 for the ground —
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

**Class 0x20, the one-hit target, is ported** (`game/class20/`) — 36 spawns
across stages 1, 2, 3 and 5, every one of them character type 7,
`char_adv00.bin`. It is a skinned actor that **dies to any single hit**:
nothing in the class subtracts from `obj+0x11C`, so the branch on `obj+0x34`
bit 3 is the whole damage model. It scores like the combat classes — 10 a bone,
120 plus `g_head_combo_bonus` on the head, 80 for the kill — then plays motion
988, holds its last frame and sinks for two seconds. `obj+0x130C` chooses
between standing still, spinning on the spot and being clamped inside a box
its own descriptor carries.

**"Holds its last frame" is a write, not a description.**
`OneHitTargetPlayDeathClip` (`FUN_00449380`) steps `obj+0x194` every frame and,
on the frame the clip ends, puts the old value straight back
(`004493e3 MOV [EDI], EAX`); `OneHitTargetSinkAndDespawn` (`FUN_00449430`)
never steps it at all. The port's clock is `ActorAdvanceMotion`'s and runs for
every actor before any handler, so both routines undo that step by hand — and
until they did, the base track ran on under the sink and the poser, which reads
it with the **wrapping** `authoredFrameOfTicks`, restarted the clip. Clip 988
is 82 authored frames against a 120-frame sink: the death animation played
once, then again, and got 38 frames into a third. This file used to claim the
port could not hold the counter and that the visible result was the same.

It had been recorded in `spawns.md` as *"not reached … `[likely]` a combat
actor"*, on the strength of an HP-scaler call at `0x0044964A`. That address is
inside `EnemyThrowerInit` (`0x00449620`), which is class **0x31**'s handler;
class 0x20's is `0x00448ED0`, and the two are merely adjacent in the file. The
dispatch table `g_class_handler_pairs` names it outright, which is the lesson:
read the index, not the neighbourhood.

Porting it needed the exporter as well as the port. Class 0x20 had no
character-type rule, no motion rule and no descriptor of its own, so no
placement was emitted for any of its 36 spawns and the player drew none of
them. It has all three now, and its tail travels under its **own** `class20`
key rather than in the shared placement fields — because `OneHitTargetInit`
reads `tail+0x00`/`+0x01` as the character type and a sub-type, where
`EnemyZombieInit` reads the same two bytes as the body condition and the
initial state.

**Two scripted humanoids that stood frozen were a bundle gap, not a state
machine.** The report was stage 2, block 9 step 5, spawns `0x55BC` and
`0x56C8`: alive, on one frame of one clip, for ever. The VM was running
correctly; their `op 2` had set motion **180**, and the exporter had never
baked it. A class-0x25 program's `op 1` mode 2 is *hold when the clip reaches
its last frame*, measured then against `BakedMotion.frames` (it is the engine's
cursor against the play length now -- see *Class 0x25's `op 17`* below) — so a
clip with no frames pins the authored frame at 0, the wait can never fire, and the VM parks
on that command with the skeleton stuck where it was. **118 of the six stages'
263 (program, clip) pairs had no frames at all**: `characters.py` baked the
command block's *header* motion and nothing the program went on to set.
`tools/verify_scripted_clips.py` is the corpus check, and it reports 327 of 445
with the fix backed out.

Reading class 0x25's VM again for that turned up one inverted test.
`op 4` mode 4 was ported as *the actor is nearer the point than it was last
frame*; `0x004845AE`-`0x00484604` compares `|prevPos - point|` against
`|pos - point|` and blocks unless the **previous** distance was the smaller
one, so the command waits for the actor to **recede**. Two shipped commands use
it, both in stage 1. The enum member is `FartherThanBefore` now.

Class 0x25 also has a `debug` at last. The sidebar's answer for it was the
literal string *"ported, but the class says nothing"* — `actorsProjection`
prints that for any handler with no `debug` — which is indistinguishable from a
class nobody has read, and was reported as a bug twice. It now names the
command the VM is parked on, the condition it is waiting for, and, by name, a
clip with no baked frames.

Porting class 0x20 also found that **`ActorInitHitPoints` was being run for
every character spawn**, where the engine runs it from two `Init`s.
`FUN_0040A8B0` has exactly two callers in the image — `EnemyZombieInit` at
`0x00452DF2` and `EnemyThrowerInit` at `0x0044964A` — and every other class
gets `obj+0x11C` as `SpawnFromDescriptor` left it, with no difficulty delta and
no clamp. The clamp's floor of 1 turns an honest zero into a one, and for a
class-0x20 sub-type 1 that zero **is** the direction the actor spins. The port
gates it on the class now.

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

**A reload no longer brings back an enemy the room already got rid of.** A
seek rebuilds every spawn still listed at its `Init`, and two classes whose
`Init` counts into both enemy counters were never taken off the list: stage 2's
class-0x21 rescue target, whose ways out -- rescue, the crash shot, flag 0 --
all come before any room gate, and class 0x18's boat riders, which the replay's
list of gate-counted classes (`ENEMY_GATE_CLASSES`) had never been told about
although the game's own list had. Rebuilt, either held `g_enemies_alive` with
nothing on screen to shoot, and every civilian whose rescue waits on that count
or on a camera cue behind a room gate sat sobbing in front of her dead
captors: stage 2's `0x6830` after the burnt-out car (block 11 step 2),
`0x8598` at block 14, stage 3's boat hostage `0x3208`. The rider and the
target are in the gate list now, class 0x46's bats answer per record (their
dive and swarm flights count, the scatter does not), and class 0x21 answers
`ClassHandler.outlivedByReplay` -- flag 0, camera path `0x39` at frame
`0x181`, route slot 1 out of its own block -- so the landing is the world the
exe is in at that address. The held target's abandon arm also frees its camera
and hit slots, which the port's had kept.

**A captor counts as gone only when it dies.** `CivilianPruneDeadChildren`
tests the child's `obj+0x34` bit `0x4000000` and nothing else; the port also
dropped a child that was merely missing from the pool, so a captor that left
by `ActorDespawn` — which never raises the bit — released its civilian as
though she had been rescued. Every ordinary exit (a kill,
`ZombieRetireAndCredit`, the drag's flag-29 exit) raises the bit first, so the
faithful test changes nothing in play that the engine does not also do.

**A deep link no longer replays a finished rescue.** Stepping over a
`wait_script_flag` in a replay raised the flag and left the civilian who raises
it listed, so she was rebuilt at the landing address with a fresh script and
ran her rescue again there. At `?stage=4&entry=4&block=12` that was stage 4's
block-4 hostage `0x3578`: her captor saw flag 29 already up, died on the first
frame, and her `SetRouteBranch 1` decided block 12's branch — `next[1]`, block
14, whether or not the player saved block 12's own civilian. The replay now
retires a class-0x10 spawn whose streams raise the flag it steps over
(`Walker.retireFlagRaisers`), so the landing state is one the engine can be in:
block 12 routes to 13 unless `0x63CC` is rescued, and to 14 when she is.

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
* **They have a waist and a skirt, and both bend.**
  `g_pCharacterExtraParts` (`0x0052ED08`) gives a character up to two parts its
  skeleton does not name, and they are **skinned**: `DeformCharacterPartGroup`
  (`FUN_00419980`) gives every vertex exactly one bone and no weight, so the
  waist stretches between the chest and the pelvis and the skirt between the
  pelvis and both thighs. The port hung them off the pelvis as rigid children,
  which is why a walking civilian's waist rode her hips. They are a glTF `skin`
  now — one joint per vertex, weight 1, identity inverse binds, which is what
  the exe does said exactly — and the geometry is the **exe's**, because the
  deform overwrites every position and normal in the model every frame.
  45 of the 54 character types a bundle poses have one, so this is nearly every
  character in the game. Ten of them draw their pelvis model twice, once rigid
  and once as the skirt, and `SkeletonNodeDrawSuppressed` (`FUN_004122E0`)
  vetoes the rigid one; the port computes that once a frame from
  `bone_records[9].slot`, which a gore swap can change, and the renderer clears
  the node's render layer rather than its `visible` — hiding the node would
  take both legs with it.
* **They have faces and hair.** A civilian's head model is a shell open at the
  back — `hito_gal`'s bone 2 has four backward-facing vertex normals out of
  149, where every zombie head has fifteen to forty — so drawn on its own it is
  a face on a neck, which is what the player drew and what the "civilians' hair
  doesn't render" report was. The rest is `model+0x1170`, the **attachment
  list**: `CivilianInit` takes it from the spawn tail's `+0x08` and
  `ActorBindPartList` (`FUN_00412440`) binds it. An id below `0x24` replaces
  bone 2's model with one of the sixty interchangeable `hito_kao_*` faces — so
  the head the skeleton names is a default, not the character — and an id at or
  above it has `ActorDrawAttachedParts` (`FUN_004124F0`) draw an `etc_komono_*`
  accessory on top: hair and hats on bone 2, bags on bone 1, shoes on bones 12
  and 15. Classes 0x24 and 0x25 read the same list, at `tail+0x00` and
  `tail+0x08`; 97 of the game's spawns carry one. The models ride the same
  hidden template as the held items and the gore.
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
**count** that `ZombieStateAwaitCivilianOrder` obeys — `0x31` means die. It is
a count of captors and not a countdown in frames: each one parked in state 39
consumes one, so `op 0x1A(35, 1)` raises exactly one and a script that wants
two issues it twice, as stage 2's block-16 hostage does for her two swimmers.

A captor waiting there is also **not drawn**. Sub 0 clears `obj+0x1F8` bit 0
and writes a zero into the first part's draw byte through `obj+0x1D4` — the
gate `SkeletonDrawWalk` (`FUN_004110D0`) reads before it emits a part, and the
same byte `ActorSetPartVisibility` (`FUN_00409D10`) writes for every part at
once — and taking the order puts both back, then tail-calls the ordered state
through `g_class30_states` so it runs on the same frame. The port has all of
it now, and `Actor.alpha`, which models the per-part byte one-per-actor, is
read by `render/characters.ts` at last: it was written by the corpse blink and
by nothing that drew. The
maul kills by raising the same `obj+0x34` bit a killing shot raises, so a
civilian mauled by its captors costs both players a hundred points exactly as
a stray bullet would.

`web/tools/civilians.mjs` measures it over the shipped data: **45 of the 47
captors run a state that works on their own civilian**, and four civilians are
mauled inside fifteen seconds — four that can no longer be rescued, which is
why the rescue count in that harness went down.

**2026-09-29: the rescue pays the shooter, and the harness is a check.** The
harness had been failing since 919bcae4 and read `0 rescued` from a41baa08 on,
both stale driving rather than the port; see `docs/re/session-log.md` for the
bisect. It now kills through `DispatchHit` and runs in `verify_all.py`: 58 of
60 captors (57 class 0x30, three class 0x18) work on their civilian, 12
civilians are mauled, 19 are rescued. Driving the page showed the defect the
harness then pinned: `ResolveHit`'s kill arm writes the shooter into
`obj+0x131C` (`0x004097D1`) and the port did not, so `sub+0x6C` read -1 and
every rescue paid 400 to **both** players — player 2 scored with nobody
holding the gun. Played from their block starts with real pulls, stage 1's
`0x18A8`, stage 2's `0x2C38` and stage 3's `0x3208` are each rescued, and
each pays player 0 alone.

**Class 0x25, the scripted humanoid, is ported** (`game/class25/`) — the
second-largest class in the game and a **bytecode VM**. The spawn's tail points
at a command block; the Init installs the interpreter and it walks 8-byte
commands until one blocks, so a run of setup commands all take effect in one
frame and only a wait costs one. 137 blocks are decoded into the bundle. This
is the game's cutscene system, not an enemy.

**And it is where the player's own character comes from.** `op 10` is the VM's
only branch that is not a jump — `if (g_active_player == mode)`, else skip past
the `mode == -2` marker that closes the arm — and it is how a cut scene puts
*one* of the two player characters on screen. The port read the opcode as a
player *count*, decided that one player was its only configuration, and always
fell through; the arm an `op 10` guards is very often `op 18` (`ActorKill`), so
it killed the character it exists to keep. Stage 3's block 2 spawns character
types `0x39` (`gameover_player.bin`) and `0x3A` (`char_adv05.bin`) at one point
and the port deleted both, which is why the third-person cut scenes had no
foreground. Across the twelve bundles it was **110 of the 274 class-0x25
programs** that ran an `ActorKill` before reaching their first blocking wait;
it is 42 now, and those 42 are the twins that are meant to go.

The exporter had the same hole one level down: its command walk followed
fall-through and `op 15`'s jump and nothing else, so it stopped at the first
`op 18` and emitted a four-command program every path of which ended in a kill.
Following the skip roughly doubles the decoded stream — 4,940 commands across
the twelve bundles against 2,770 — and brings the clips those arms name into
the bake with it. `verify_scripted_clips.py` checks both edges: that every
command's fall-through is the next one emitted, and that every `op 10`'s
`-2` scan lands on a command boundary.

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
those templates. `PropExpireByStepLifetime` now runs for the whole family, so
a prop the script placed for one block no longer stands there all stage, and
Original Mode's collectibles (types 70–72, 77) leave on their first Arcade
frame the way the engine sends them.

**Forty-three of the family's fifty routines are transcribed whole**, every
type from 5 to 69, 73 and 78 (`game/class41/typeNN.ts`, registered in
`generic_routines.ts`). Each has its own head -- the shared step lifetime, an
inline variant with a literal limit or an `ActorKill`, or none -- its hit arms
and sounds, its shot sphere where it registers one, and its constructor arm.
**The draw is transcribed with the routine**: each `AssetDrawSlot` a routine
makes lands in `BreakableProp.draws` with the matrix it was made under
(`game/class41/prop_draw.ts`, built with `game/matrix.ts`), and
`render/breakables.ts` sets those matrices and decides nothing -- which is
what shows a routine that draws and then steps its model (types 6, 10, 31,
33) on the right frame, a draw layer (21), a fade (the Original Mode items of
types 7 and 43), an effect tree (9, 18, 25, 27, 28, 43, 62) and a
camera-facing billboard (53) without a per-type arm in the renderer. The
renderer's own lift, door-leaf and clock-tower arms are gone with it. What
moves now: type 8's rocking boat and its three shootable parts, 11's orbit
and fall, 14's and 19's swings and give-backs of the enemy count their arms
raise, 20's spin, 30's fall, 36's three rising strips, 41's two panels, 45's
table of banners and the wave it bends into them, 49's tumble on its hull, 56's hinge curve and fall, 57's
shudder, 58's and 60's flights, 62's eight camera-facing water effects, 63's
twelve items, 64's swaying part, 67's boats (Training only), 69's fall and
Original Mode item, 73's ride along its object path. Class 0x41 type 34 is
built by `PlaceGenericProp` as the engine builds it, and keeps its pitch.
The other seven, 70 to 77, are the Original Mode half, ported separately.

**Class 0x41 type 75 is ported** (`game/class41/flag_prop.ts`), and it is the
one class-0x41 object whose routine opens a `wait_script_flag` gate.
`PropUpdateType75` (`FUN_004710C0`) raises `g_script_flags[20]` from **three**
instructions — `0x004710D7`, `0x00471120` and `0x00471263` — and stage 4's
block 2 step 7 is the only gate on flag 20 in the game. Nothing in stage 4's
script sets it.

It gets its own `PropFamily` rather than a `GENERIC_UPDATE` row, because it
does not call `PropExpireByStepLifetime` at all: it inlines a variant of that
routine with the scene-1 sweep left out and its own step tick folded into the
middle, and it never clears the hit bits the other thirty routines clear. The
one that mattered most was the head. Types 70, 71, 72 and 77 open with a plain
`if (g_GameMode != 1) { ActorDespawn(obj); return; }` and `generic.ts` had an
`[open]` note guessing that 74, 75 and 76 were the same family — 75 is not: its
Arcade arm **raises the flag and then** despawns, and treating it as one of the
others would have held stage 4's gate shut for the whole of the mode the player
runs in.

The three arms are all one prop's life. In Arcade the gate opens on the frame
the prop is placed. In Original Mode it opens on the second change of
`g_evt_step_index` if nothing shoots the prop, and 290 frames after the shot if
something does — the shot also drops a story-mode item at the routine's own
literal `(142.0, -59.8, -888.7)`, which it reaches by overwriting its own
position for the duration of the call and putting it straight back.

**`ClassHandler.raisesScriptFlag` can now answer per spawn record.** The
declaration used to be one number per class, which is true of the two banner
cards and false of this one: class 0x41 has 441 spawns across the six stages,
`PropContainerPlacerUpdate` dispatches each through one of 79 constructors, and
exactly one of them builds this object. A class-wide answer would have told
every stage with any prop in it that flag 20 was coming — the same failure as
the blanket escape it replaced, one level down. `node tools/run_ts.mjs
tools/flag_gates.ts` reads the twelve shipped bundles and asserts it: stage 4
can raise flag 20, stage 5 — 44 class-0x41 props and no type 75 — cannot.

The flags `wait_script_flag` still has to excuse now belong to **four enemy
classes and nothing else**: 0x14, 0x19, 0x22 and 0x32. Stage 4's held set went
`{19,29,248,254}` to `{19,20,29,248,254}` and stages 3 and 6 have nothing left
to excuse at all. Class 0x32's flag 30 was picked up as a small writer and is
not one — see `PLAYER_HANGS.md` item 17.

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
instructions with no frames in between. `g_evt_step_index` and
`g_camera_fixed_eye_y` moved into `G`, written by the step advance and the
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

**Stage 3's boat carries its passengers, and the carrier is a matrix.** Class
0x13 is a script-driven prop — one asset slot, a behaviour out of a ten-entry
table, and a camera cue that removes it — and the eighteen spawns that take
behaviour 8 install a routine that makes the object a *carrier*. Stage 3's
block 0 boat is selector 1: it rides two object paths and forks on whether a
civilian is still alive, mooring if one is and running past if none is. Class
0x18 is an ordinary class-0x30 zombie whose descriptor position is relative to
that boat, and the seven civilians whose `obj+0x11C` is non-zero ride the same
way. The engine pushes the carrier's transform around the whole update; the
port runs the state machine on the same relative position and publishes the
composed world point for the renderer, which is the one thing a port with no
matrix stack in `game/` has to add.

**...and the boat the player rides is a floor.** Class 0x26 subtype 2
(`game/class26/`) is an actor now, not only a rig: its first frame seats a
collision blob of its own — `coli3.bin`'s foredeck, in the boat's own space —
and the first pass of both collision queries tests every such object through
the inverse of its world matrix. The zombie that leaps onto the bow at block 0
step 4 lands on the deck instead of standing in the canal inside the hull. The
arriving boat's riders were three faults deep: class 0x18 had no motion rule,
so no rider was ever built; the player made character spawns before slot
actors, so the civilian copied `g_civilian_carrier` before the boat had set it;
and the carrier transform converted BAMS the wrong way. Spawns are now made in
the script's order. Stage 3's second arriving boat (block 7, carrier routine 6) rides
its paths too, and the player's boat is drawn from its actor rather than from
a second copy of its routine in the renderer.

**A room-clear gate waits for the camera as well as the counter, and how long
it waits is the camera's business.** `wait_enemies_alive` and its two siblings
need `g_camera_free`, and `EvtActionFinishSequence21` installs one of two
drivers to produce it, out of `g_camera_action_starters` by the scene-state
minor a shot enters. 267 of the shipped scripts' 278 gates run under
`CameraDriverSelectMode`, which holds the flag down until
`CameraTurnOntoPathTarget` has eased the aim back onto the rail — 25 to 55
frames a room on stage 1, scaled to how far the last enemy had pulled it. The
other 5 run under `CameraDriverFromDeferredPose`, which frees the room as soon
as the slot table empties. The player had that second rule on every shot, so
every room handed over two frames after the last zombie died; `npm run
handback` is what measures it. With the camera now running as the exe's own
tasks (below), stage 1 block 1's four fought rooms hand back in 50 to 76
frames from a 7 to 14 degree swing, and an empty one in 2.

**A room also waits for its last corpse when the spawn says so.** Six shipped
class-0x30 spawns carry `KeepCameraWhenLast` (`0x800000` in the record's init
flags: stage 1's three are its opening room's, stage 3's three are block 2
step 4's). `ZombieReleasePermitAndUntrack` skips its untrack
arm for the last enemy alive that carries it, so that actor keeps registering
as a camera candidate through its death clip, keeps a slot, and the mode
machine stays on `TrackEnemies` until `ZombieStateCorpseSink` raises
`NoCameraTrack` unconditionally. Stage 1's opening room therefore holds its
gate for the corpse and then the turn, about 180 frames longer than the port
used to, because the port's slot table used to be rebuilt from a list that
dropped the dead.

### The camera is the exe's two tasks, in the exe's order

The camera used to be seated from outside the game: `Walker.tick` advanced a
shot, retired it and released `wait_queued_events_done` inside one call, and an
`app/` system then wrote the camera block from the walker's shot before the
actors ran. Everything that followed from that was a task out of place, and
several things could not be done at all -- the rail could not pause, because
the seat put the block back on it every frame.

The scene's task list (`0x00460710`, `[proved]`) runs, in creation order: the
interpreter, the light push, **`CameraActorTick`**, the backdrop,
**`CameraUpdateTick`** (the scene state's hook, then the player bodies), the
two player tasks, `SelectAttackablePlayer`, the shutter, the scene lights, the
region draw, the rain, `UpdateCameraEnemySlots`, `RankEnemiesByDistance`, the
shot resolution -- and then every actor. `SceneTaskWalk` (`game/director.ts`)
is that list now, and the camera lives entirely inside it:

* `queue_event` pushes onto the action ring (`EvtQueueAction`), and
  `EvtRunQueuedActions` inside `CameraActorTick` calls the current handler and
  dequeues at most one action a frame. A `cam_play` starts the frame after it is
  queued, a `wait_queued_events_done` passes on the frame the ring is empty, and
  a skip ends a play where it stands.
* `UpdateSceneViewAndLight` builds each block's view from its **angles**, with
  the shake's nod on the block `g_camera_index` names, and stamps the scene
  state as entered. The renderer draws that block's matrix, and the host's
  view seams read it: **block 2 under scene state (1, 3)**, whose installer
  `CameraInstallViewAngles` writes the index 2, block 0 once a starter's
  `CameraResetForPathShot` puts 0 back. Block 2 is block 0's eye aimed at
  block 0's look-at, refilled every frame (`EvtRunQueuedActionsSyncViewBlock`),
  so a cutscene is drawn looking where the look-at says. `[proved]`
* The scene state's hook writes the **gameplay eye** `g_camera_eye` -- the
  `-15` is its, not the drawn camera's -- and, on a stashed rail, the deferred
  pose block. The rail pauses while the screen shakes or nobody is in play.
* The drivers read what the hook left the frame before: the deferred-pose
  driver copies the pose block whole; the mode machine eases the block eye a
  sixteenth a frame onto the pose (`CameraEaseBlockEyeToPathPose`) or onto the
  path (`CameraEaseEyeToPath`), and turns the aim in whole BAMS.
* Every tracked class files itself as a candidate from its own update
  (`ActorRegisterCameraPoint` / `RegisterForCameraTracking`), the next frame's
  `UpdateCameraEnemySlots` deals the slots, and the camera reads them the frame
  after that. The camera is two frames behind the room, as the exe's is.

**What flies the camera has to write angles, or say why it does not.** The
view is a block's angles, so a routine that moves block 0's eye and target and
stops there moves block 0 without turning it. The exe's routines that aim by
look-at all call `CamBlockSetAnglesFromLookAt` (its eleven callers include
Strength's cues and Judgment's death orbit, and the port's now do too). Two
fly the camera without it, and the port keeps that: the boss-name banner and
class 0x14's cut write eye and target through `CamEvalPath7`, which writes
nothing else. **What that looks like depends on the drawn block.** Drawn from
block 0 the flight carries the eye and keeps the heading; under scene state
(1, 3) it is drawn from block 2, which is aimed at block 0's look-at every
frame, so the camera turns with the flight. Stage 1's banner -- JUDGMENT's,
on block 14's `wait_frames 300` after its last `cam_play` -- runs under
(1, 3), and at `?stage=1&block=14&step=1&op=52&frame=830` the drawn camera
now swings about 77 degrees of yaw across the 300 frames, onto the boss,
where it had held one heading since the camera became two tasks
(`3a28137a`, merged as `6706e323`). The Tower writes the yaw and pitch
itself. `[proved]`

A block change leaves the ring alone. `EvtAdvanceStepOrRoute` moves the block
and the program pointer; only a scene's task list runs `EvtLoadBlockProgram`,
which empties the ring and zeroes the count. So an action still running when a
block ends -- a `cam_play` a skip cut short -- retires in the next block and
takes its own count with it. `[proved]`

Waits yield on their first visit, as every wait opcode but `0x40` does, and
`wait_frames n` passes after `n + 1` frames. A seek walks the script without
running frames, so every wait it steps over runs the camera's two tasks to the
state the wait claims (`CameraReplayUntil`, `CameraReplayFor`,
`CameraReplaySettle` in `game/camera/actor.ts`).

Three questions this table used to list as open are answered by the same
reading. The `path.y - 15` is the gameplay eye's: the path hooks write
`g_camera_eye` fifteen units below the pose (or at `g_camera_fixed_eye_y`), and
the drawn camera is the block's eye unchanged. `0x009C70C0` is the deferred pose
block: the (2,6)/(2,7) hooks evaluate the rail into it, and the two drivers
read it -- `CameraDriverFromDeferredPose` copies it whole,
`CameraEaseBlockEyeToPathPose` eases the block eye toward it. And
`CameraStepRailTick` (`0x0040C790`) makes the gameplay eye yaw-only (pitch and
roll zeroed, the yaw turned half round) while the drawn camera takes the pose's
full angles through the driver. `[proved]`

**Two yaws, and which one each reader takes.** The camera block's yaw,
`g_camera_block_yaw_bams` (`0x009A60D0`), is `VecToAngles(eye - target)` --
the camera's own +z, pointing back at the viewer -- and it is what the view is
built from. `g_camera_yaw_bams` (`0x009C71F0`) is the gameplay eye's heading,
which the scene state's hooks write half a turn round from a camera heading:
the rail pose's yaw `+ 0x8000`, or the block's `- 0x8000`. Before the camera
was two tasks the port had only the second, and every routine the exe points at
the first read the second in its place -- **half a turn out**. With the block
kept current each frame they read the block now, as the exe does, and a sweep
of the image's 63 references to `0x009A60D0` (operand search and the bytes
agree) found every ported one:

* **`ZombieShouldStandAndThrow`** (`FUN_00458E10`). The facing window is the
  block's yaw turned half round, which is the heading of an actor facing the
  camera; reading `g_camera_yaw_bams` put it behind the actor, so no
  condition-8 walker ever threw -- none of stage 4's ten `znassb` or stage 5's
  one, nor the axe walkers in stages 2 and 3. Measured in the headless player
  with `tools/blade_throw.mjs`: stage 4's first `znassb` (evt 3740) closes to a
  facing error of 297 BAMS against the block (20544 against the old word), and
  now stands at frame 70 and throws both blades; stage 5's (2948), stage 3's
  axe walker (8312, two axes) and stage 2's (26500) do the same. Before,
  stage 4's and stage 5's never entered state 33 in 1500 frames. The claim
  and the hands come in the character type's order: `znassb` claims first,
  the axe types look first, and any other type answers no.
* **`ChooseDeathMotionDirectional`** (`FUN_00456220`) reads the block itself;
  its callers used to hand in `g_camera_yaw_bams`, which swapped the falls
  front for back. Its four arcs are tested in a row, as the exe does, so a
  boundary heading takes the later one.
* **`SeveredHeadUpdate`** and **`OwlUpdateAndResolveShot`** threw the head and
  the owl's corpse *at* the camera; they go away from it now.
* **`Class26Subtype2Update`**'s face-camera latch, the **bat**'s wobble, the
  **fish** splash, class 0x14's six splash strips, the carrier's bow strip and
  its drawn wake strip, and **`PropUpdateType43`**'s crack all turn by the
  block; **`KindedPropUpdate`**'s crack now makes the write at all.
* **`OwlPickTargetPlayerAndAimOffset`**'s two-player offset takes the block's
  yaw and the owl's distance from the block eye, not the sway rate.
* **The frog** reads camera block **2**'s yaw (`0x009A6418`) by address:
  `EvtRunQueuedActionsSyncViewBlock` copies block 0's pose into it only
  during a (1, 3) view-angle turn, and outside one it holds the last turn's
  heading. Block 2 is also the drawn block during that turn (above), so the
  port keeps it whole -- the sync, the reset, the nod and both matrices.

The readers above take block 0's words, and the exe indexes most of them by
`g_camera_index` (`[ECX*4 + 0x9a60d0]` with `ECX` the index times `0x69`).
Under (1, 3) block 2's eye is block 0's, and its yaw is block 0's whenever
block 0's angles came from its own look-at -- every `cam_play` -- so they
agree there too, and differ only under the banner's flight or
`hold_camera_preset`. Moving each onto the block the index names, as the
view seams now read it (`CameraBlockViewToWorld` in `game/camera/view.ts`), is
a sweep of its own, with each reader's addressing read first. `[open]` which
of them run while the two differ.

What the class-0x31 leaps, the grab and class 0x22 read is `g_camera_yaw_bams`
itself, and those were right. `[proved]`

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
| **W4** | Play mode, branching, enemy simulation | ✅ route graph walked; a branch goes on the frame its steps run out, as the engine's does (the sidebar's *Pause at branches* debug aid holds it for an override); the live-enemy waits are the real gate |
| **W5** | Audio, fog, route minimap, Arcade/Original toggle, event feed, inspector | ✅ BGM, SE and voice all play, dispatched by namespace; scene fog rendered radially |
| **W6** | Visual regression harness | deferred — `freeze=1` and the URL state it needs are already in place |

---

## What the player consumes, and what it exposed

The player turned out to be a good oracle for the RE. Five readings that
looked right on paper produced visibly wrong behaviour, and the binary settled
each one.

| Symptom | Cause | Fix |
|---|---|---|
| Most of a stage never ran; regions and camera barely changed | **A block's steps are sequential.** `advance_step` advances to the next *step*; only an exhausted step table reaches the route table. Treating every `advance_step` as a block exit ran one step per block | read `EvtAdvanceStepOrRoute` |
| Scene ended early | Route **kind 2 is not "end"** — it falls through to `block + 1`. The scene ends when that block is a hole | same |
| Branch buttons picked the wrong route | A branch takes `next[branch_choice]`, not "a target"; every writer of `branch_choice` is gameplay code | same |
| The branch was the viewer's choice, not the game's | `branch_choice` resets on every **step** advance, not every block change, and the writer the port reaches is a rescued civilian's `SetRouteBranch` (`CivilianRunScript` op `0x19`). An unanswered branch used to take the lowest block number; it takes `next[g_script_branch_var]` now. The bar was a 1.5 s override of a decision the game has already made, held at every branch; it is a debug aid now, off by default, because the engine has no window at all | read `EvtAdvanceStepOrRoute`'s tail; `tools/verify_branches.py` |
| Clicking a branch button did nothing | The countdown re-announced the branch every frame, so the UI rebuilt the buttons 60×/s and the click never landed between `pointerdown` and `pointerup` | notify on *change*, not on tick |
| Branch preview showed an unrelated shot | The `store_six` preview was carried across block changes. All four in stage 2 sit *inside* branch blocks | discard on block change, same lifetime as `branch_choice` |
| Whole view tilted down | `eye.y = path.y - 15` was applied **before** the look-at, but the game derives pitch and yaw from the *unshifted* `eye - target` and only then overwrites `eye.y` | translate after orienting |
| Camera still too low | The `-15` should not be applied at all — see below | reverted, with the measurement |
| Fog far too thick | `SetFogRange` **doubles** near and far before the device sees them, and three.js's fog factor is `smoothstep` where D3D's is a straight ramp | double the range, patch the fragment chunk |
| Op 0 of every step never ran — a region entered a step late, a `cam_play` skipped, the camera's position jumping 41 units in stage 2's block 17 doorway | `advance_step` (0x4F) moves the program counter itself, and `executeOne` then incremented it again. `EvtAdvanceStepOrRoute` assigns `DAT_009C7108` the address of the new step's *first* instruction; this VM has no shared post-increment | increment only when the handler left the pc alone; `test/seek.test.ts` asserts every step entered runs its op 0 |
| The camera rewound to before the start of its path once, then carried on (stage 1 block 8 step 4) | `start == -1` means **resume** in the deferred branch too: `FUN_00403490` stashes `g_cam_path_frame + 1`, not the literal -1. The port stashed -1, so `finish_sequence 7` set the clock to frame -1 and replayed all 686 frames | transcribe `FUN_00403490`; `test/seek.test.ts` asserts no play starts before frame 0 |
| The camera's aim jerked 20 degrees the frame the last enemy died | `SelectCameraLookAtTarget`'s "nothing registered" case is a **fallback to the path's own target**, not an exit, and `CameraTrackEnemiesTick` eases onto it unconditionally — `g_camera_is_tracking` picks only the *rate* | `game/camera/track.ts`, with `g_camera_block_target` as real state in `G` |
| The camera stalled a frame and then jumped, at the end of every shot (reported on stage 3 block 2 step 4, camera frame 1660: the eye held still, then moved 3.62 units where the shot travels 1.25, and the aim flicked 9.6 degrees out and back) | `CamAdvancePathFrame` (`FUN_004035E0`) publishes the cursor, evaluates the curve into the camera block **and** writes the block's angles, all before the `cur >= end` test that retires the action — so the frame a shot ends on is drawn like any other. The port seated on `!cam.done`, which is one tick short: the block kept frame `end - 1`'s pose, and losing the reseat also let `CameraTrackEnemiesTick`'s ease take one unopposed step towards the enemy | `CamCommand.retired` — `done` plus one tick — and `seatCamera` on `!retired`; `test:camera` compares the drawn eye against the rail recomputed from the bundle, five frames of seven hundred failing without it |
| Nothing left the gun | Two thirds of what a shot looks like was never ported. `PlayerShotEffectSpawn` (`FUN_00416F70`) fills **three** six-deep rings per player on every trigger pull, hit or miss: a nine-frame muzzle flash and a second draw beside it, a tracer thrown down the aim at twenty units a frame, and an Original Mode record. The tracer dies on its second frame when the shot hit something, which is the only reader of `g_shot_hit_something` | `game/effects/shot_effects.ts`; `render/effects.ts` draws the two camera-space rings under the camera's own matrix |
| The blood was a fading circle | The engine's spray is **twenty-five models**, `pol/common.bin` 0 to 24, one a frame — there is no texture animation anywhere in this engine. The bundle carried none of the artwork, so a canvas gradient stood in for all of it | `slots_effect`, a hidden rig of 162 asset slots, and `game/effects/blood.ts` |
| The blood sat inside the limb, at its middle | Half right and half not. `DrawBloodSpray` (`FUN_00407230`) does put it at the hit **bone**, and re-reads the bone every one of its twenty-five frames so it tracks — but at the sphere's centre **plus its radius on camera-space z**, which is the near face, the side the shot came from. The port had the centre and left it there | `render/effects.ts` works in camera space, which is what the routine does |
| A miss had no material | `SpawnWorldImpact` (`FUN_00405260`) takes the sprite kind *and* the sound from the collision triangle, and `render/shooting.ts` had no collision to trace, so it raycast the drawn geometry and called every surface "other". The bundle carries the game's own `coli/` sets now | `ShotHitWorld` in `game/combat/shot.ts`, tracing far-end-first the way `FUN_00404B80` does |
| The gun made no noise | `PlayerFireAndReloadUpdate` (`FUN_00414940`) ends a shot with `BuildShotRay`, `PlayerShotEffectSpawn` and `PlaySoundId(g_gunshot_sound_ids[player])`, and `ResolveShotRequest` had the first two. Nothing else in the shot path was silent — the flesh impacts, the ricochets, the surfaces and the breakables all played, which is why this reads as "no sound" rather than as one missing file | the emit on the line after the muzzle flash in `game/combat/shot.ts`; `npm run audio` measures the peak sample the page decodes |
| A full-screen white flash on every shot (NEW-BUGS 15: "triggering for epilepsy"), mean frame luminance 58 → 142 for one frame | Not the light gun, and not the muzzle flash (that toggle is off by default). It was the **tracer**: `PlayerShotEffectSpawn` puts the round at the muzzle point, one unit in front of the eye, and the port drew it there on the spawn frame, where its scale-1 quad fills the view. `PlayerShotEffectsThink` (`FUN_00416B00`) moves a tracer *before* it draws it, so the engine never draws one at the muzzle whichever order its two tasks run in. The port's spawn lands after the frame's tick, and a declared one-frame divergence said so — it was the flash | the spawn makes the first pass's move itself (`TracerAdvance` in `game/effects/shot_effects.ts`), so every tracer is first drawn one move out, as in the exe, and the divergence is gone; `test:port` asserts the first drawn position, and a canvas-luminance probe reads no spike across three shots |
| A three-second dead pause at the top of every stage (NEW-BUGS 13) | Block 0 step 1 of every stage waits on `wait_script_flag 248`, and flag 248 is raised by the chapter card, class 0x60, after its 180-frame dwell. The player draws no card, so the dwell was a frozen scene | **by the user's decision the port skips title sequences**: `ChapterCardSkipRequested` hands the card's skip test the pad's unconditional skip bit (`0x20000`), so the engine's own skip arm cuts it on its first update — installer, latch, flag and kill all still run. Declared as a divergence in `game/class60/`; `test:port` asserts one update to the flag and the gate open behind it. The card's `g_screen_furniture_flags` bit `0x20` rides the same skip: sub 0 raises it and the countdown drops it inside that one update, so the shutter's state-4 bars and class 0x22's cameo never stand aside for a chapter card |
| `breakables: none placed` where the port had props | Neither half of that was a port bug. `render/breakables.ts` reads `G.g_breakable_props`, and `spawn_placed` does not fill it: it puts a class-0x41 **placer** in the object pool, and `PropContainerPlacerUpdate` (`FUN_00461CD0`) is the class handler that calls the constructor and then `ActorKill`s itself. A paused transport hands `world.update` a `STOPPED_TICK`, so `GameUpdate` never runs and a seek that arrived correctly shows nothing. The address in the report was also before the placer -- stage 3 block 0 step 3 places its props at ops 10 and 11, behind `wait_enemies_alive <= 0` at op 8, so there is a room to clear first -- and the harness that contradicted the page had never seeked at all (`L44`) | the describe line now names the placers waiting for a frame; `npm run props43` pins the two addresses headlessly and `npm run props-panel` reads the panel itself in Chrome |

**Where the effects live, and why it is not `render/`.** All of it is engine
state: `g_sprite_effects`, `g_blood_sprays` and the three rings are pools in
`G`, they go into a snapshot as plain records, and `ShotEffectsTick` steps them
at the head of `GameUpdate`. `render/effects.ts` owns only the nodes and
rebuilds them from the pools, which is the split `SeveredHeadLayer` already
had. The one thing it cannot rebuild is where a bone is, so the blood asks
`CharacterLayer.boneSphere` for the same centre and radius `pickShot` tests
with.

## Findings the player produced

Things established while building it, now folded back into the format docs.

- **An actor can park on a script flag too, and then the gate in front of it
  is a gate the walker cannot see.** `[proved]` —
  `ZombieStateDragTarget` (`FUN_0045C080`, class 0x30 state 43) has no exit of
  its own. Its sub 3 turns on the spot and never advances, and the tail at
  `0x0045C1AD` that every other sub falls into is the whole way out:
  `g_script_flags[0x1D]` and `g_players_in_play`, then
  `ReleaseEnemyAliveCount`, `ReleaseEnemyPresentCount` and the despawn arm. Sub
  1 has already raised `obj+0x34 |= 0x10100` on itself, and `0x100` is the
  `ShotImmune` `DispatchHit` (`FUN_004092F0`) jumps past `ResolveHit` on — so
  the actor cannot be shot out of the count either.

  `0x0045C1AE` is the only instruction in the image that names `0x009C721D`,
  so flag 29 has no literal-address writer anywhere: in stage 4 the release is
  the dragged **civilian's** own `CivilianRunScript` op `0x1C`, off all three
  of her reachable streams. The captor is her spawn record's only child. So
  `wait_enemies_alive` in a later block is held by a class-0x30 actor waiting
  on a class-0x10 actor's script, with nothing in the walker's own view of
  either. `tools/flag_gates.ts` asserts that link over all twelve bundles —
  the same file's route pass, asked of an actor instead of the walker.

  Found because `--entry` made stage 4's second route runnable; it was
  `PLAYER_HANGS` item 23, and the port had transcribed the state without its
  tail.

- **A `wait_script_flag` gate is held per *route*, not per stage.** `[proved]`
  — `StoryModeSwitchUpdate` (`FUN_00474F30`), the class-0x44 selector-17
  object, raises `g_script_flags[0x15]` at `0x00474FA6` while it stands in
  scene 2 block 2 unthrown, and that write is **above** the routine's
  `CMP g_GameMode, 1` at `0x00474FB4` — so it happens in Arcade as well as in
  Original Mode, which is the opposite of what the rest of the routine does.

  Stage 3's block 2 step 3 is `wait_script_flag 0x15`, and the stage's own
  `set_script_flag 0x15` is in block 1 step 5 — a block only the entry-0 route
  reaches. On the entry-7 route (7 → 8 → 2) the switch spawned by block 7 step
  8 is the only thing that opens it, and with that write unported the stage
  parked on the instruction for good. The port now runs the whole head of the
  routine, above the mode gate, in `StoryModeSwitchPoolUpdate`.

  The player learned this because `tools/playthrough.mjs` grew `--entry`:
  before that it could only run each stage's first entry block, and stage 3's
  block 2 had never been executed by anything. `tools/flag_gates.ts` now walks
  `entries` → `route.next` and names every gate no `set_script_flag` on the
  route to it can open — the gates an actor holds, one routine each.

- **Arcade is `g_GameMode` 0 and 2 is Training, which the bundle had the wrong
  way round for as long as it carried the field.** `[proved]` — the values are
  the title menu's row order, and the menu names its own rows:
  `TitleMenuRegisterSprites` (`FUN_004962C0`) registers each label by texture
  (`tex\arcade00`, `tex\original_00`, `tex\traning_00`, `tex\boss_00`) into
  consecutive `ScreenSpriteRegister` slots and `TitleMenuUpdateAndSelect`
  (`FUN_00496960`) writes the highlighted row into the global. The other five
  writers all store 0.

  Nothing was visibly wrong, which is the interesting part: `entryStep()`
  tested `ORIGINAL && scene === 0` first and returned 1 for everything else,
  so a bundle labelled Training got the Arcade step by falling out of the same
  clause the engine falls out of. What the wrong number *was* doing: it put
  `g_prop_target_set`'s four member sets — Training's four lessons — under the
  name "arcade", and it made `PlaySoundId`'s plain BGM table look unreachable,
  which is how the exporter came to emit a `default_table: "ar"` that made
  every stage play the `_AR` mix. **Arcade plays `ST<n>.wav` now** and Original
  plays `ST<n>_AR.wav`, which is what the routine does.

  Bundle format **6**, because no declaration moved and so no digest could see
  it: a format-5 bundle says `game_mode: 2` for Arcade and this client would
  read that as Training. `verify_exporters.check_game_mode` holds all three
  enums to one table.

- **The bundle screen showed no picture of the stage you had just been
  looking at, about one time in three.** `Player.requestThumb` takes the
  fallback picture nine frames after a load and writes it to OPFS;
  `ExportScreen` read the store once, when it mounted. Measured eight frames
  between `#loading` going away and the screen opening, so the two orders were
  a photo finish — and losing it was permanent, because nothing read the store
  again. `writeThumb` announces itself now (`onThumbWritten`) and the screen
  re-reads on every write. `bundle_flow.mjs` had been failing on this and
  reading as a flaky check.

- **A stage does not choose where it starts; the stage before it does.**
  `[proved]` — a `kind == 2` route record ends a scene by doing `block + 1`
  onto the hole that follows it, and on that path `EvtAdvanceStepOrRoute`
  (`FUN_0045F000`) reads at `0x0045F0DA`
  `g_evt_block_index = *(s16 *)(g_scene_routes[scene] + block * 8 - 6)`, which
  is `next[0]` of the terminal record. Nothing between there and `FUN_0045EBC0`
  writes the global again, so **the terminal record's `next[0]` is the block
  the next scene opens at**. The scene index itself merely increments, in
  `RunPhaseStepToNextScene` (`FUN_004603B0`).

  Nine endings are reachable across the six stages and two of them name a
  block other than 0: **stage 3 opens at block 0 or block 7, and stage 4 at
  block 0 or block 4.** The player had none of this — `entry_block` was
  computed as "the first block that is not a hole", which gives 0 for every
  scene and so was right about the number, wrong about the reason, and unable
  to produce the second entry at all. Stages also simply stopped when they ran
  out, because nothing had read what happens next.

  The bundle carries `entries` and `exits` on `<stage>.script.json` at format
  5, the top bar offers an **Entry** picker on exactly the two stages that have
  a choice, `?entry=` addresses one, and a stage that runs out in Play mode
  loads the next at the block its ending named.
  `tools/verify_scene_exits.py` and `npm run transitions` are the two checks.

- **`g_evt_step_index` (`0x009A2BB0`) is the step index, not a block count.**
  `[proved]` — `EvtAdvanceStepOrRoute` increments it at the top and assigns it
  `1` in the route branch, and `FUN_0045EBC0` seeds it with 0, 1 or 5 by game
  mode. It is neither monotonic nor per-block. `PropExpireByStepLifetime` ages
  a prop one tick every time it **changes**, so `obj+0x11C` is a lifetime in
  event *steps*. The port kept a separate monotonic counter bumped once per
  block, and with blocks averaging 3.99 steps every class 0x41 and 0x44 prop
  lived about four times too long. It is now the same field as the walker's
  step cursor, because the engine has one global and two that must agree is
  the shape the bug had.

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
  stops the voice line (it was read as "restarts the BGM", and the mixer
  stopped the music instead -- see [the music](#the-music-loops-where-the-engines-does)).
  Two earlier notes called this dead code; the task is only
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
  lines and a stop as well -- and it is how each stage starts its own track.
  [`formats/sound.md`](formats/sound.md).
- **Light and fog values are readable.** The `0x20`–`0x27` operands are
  pointers to float constants in the evt file; dereferencing them turns 1,888
  bytes of "unattributed residue" into real values — stage 2 block 3 opens with
  fog near 21, far 507, light RGB (1.0, 0.9, 0.77), ambient 0.5.

## Open, and what each costs

Ranked by what they would actually change on screen.

| Open | Effect | Where the work is |
|---|---|---|
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

`obj_484ff0_props` is transcribed but its **path-driven variant is not a rig
at all.** The variant is `desc + 0x2A`, and `ScriptedHumanoidDraw`
(`FUN_00484FF0`) draws four different things by it: three at points the
routine hardcodes, which the rig writer exports as fixed parts, and one —
variant 3 — at `CamEvalObjectPath6(obj+0x135C, g_cam_path_frame)`, the object
path the class-0x25 actor is *itself* riding. No static placement can express
that, so it goes through `slots_actor` and `render/slotmodels.ts` places it per
live actor instead. Stage 3's opening is what it is for: the boat under the two
passengers, on the same curve at the same frame as they are, which is how the
engine keeps a rider on a vehicle without any parent field anywhere.

**A rig no shot has selected yet is at its spawn pose, not at path frame 0.**
`Class26Subtype2Update` (`FUN_0048EAD0`) reaches its draw through `default:`
on every camera path its switch does not name, and that arm writes no pose —
the object stays wherever the spawn descriptor put it, which for every rig the
six stages carry is the origin. `RigLayer` used to evaluate the path at frame 0
for the fallback instance, which put stage 3's boat in the canal, parked, for
the whole opening while a second boat sailed past it.

**A rig whose object is a task exists only while the task does.** Stage 2's
car (`obj_452320`, drawn by `St2CarDraw`, `FUN_00452320`) is a task that
`St2CarSpawn` (`FUN_00452120`) allocates, and its only caller is
`RescueTargetInit` (`FUN_00451720`) -- class 0x21's one spawn, block 0 step 2.
`RigLayer` drew it from stage load at its exported root, the origin, which is
Goldman's desk: the car stood in the office through the whole of step 1's
cutscene (NEW-BUGS-2). The task is ported now, in `game/class21/car.ts` --
the camera-path switch that picks its route, the park at the end of shot
`0x39` or `0x3A`, and the `g_script_flags[0]` kill -- as plain records in
`G.g_st2_cars`, and `RigLayer` draws one root per task that drew this frame at
the pose it wrote (`TASK_POSED_ROUTINES`). Its routes in the rig data now only
name the roots.

**...and it draws what `St2CarDraw` draws, not the parts it was exported
with.** The draw takes four slots from a row of `g_st2car_asset_variants`
(`0x00565F2C`): row 0 until shot `0x39` runs out, row 1 -- the car after the
crash -- from then on. It turns its nested second push `RotY(obj+0x1334)` once
parked (`[likely]` the driver's door), and its two spun pushes
`RotX(obj+0x1330)` while `obj+0x1320` is set, on a second frame that re-applies
the body's `MatrixGetAngles` with the roll through a dead zone. The port's
`St2CarDraw` computes all of it into `car.draw`; the exporter ships both rows as
parts; `RigLayer.applyTaskDraw` shows the four parts the draw named and poses
them. So the unshot branch's car is the crashed one from shot `0x39` frame 370,
the wheels turn a sixteenth a frame while it drives and stop at no rotation at
`0x3A` frame `0x50`, and the door swings out over 39 frames once it is parked.
The door's outer skin renders black -- its translucent `char_adv04` texture-33
material carries a zero base colour in the bundle -- which is a material
question and not this rig's.

**Original Mode's green mound in front of Goldman's desk was a shot effect.**
`obj_416b00` is `PlayerShotEffectsThink` (`FUN_00416B00`), whose one literal
slot, `0x109D`, it draws only for a live kind-5 tracer record, at the record
plus `op_` `0x194`. The rig carried that path as an ungated route, so the
player drew it from stage load at the path's own pose, `(0.5, 0, 0)`. It is not
placed now; `render/effects.ts` draws the kind-5 arm from
`G.g_shot_tracer_ring`, and an Original Mode bundle carries the slot in its
effect templates. Both tracer arms now also face the camera, as
`MatrixClearRotation` makes them: the ordinary tracer was a quad turned in
world axes.

**Stage 1's two burning cars are class 0x28's, and are thrown once.** The
cars the JUDGMENT walker knocks aside when it lands are `obj_432840`, drawn by
`PathRidingPropDraw` (`FUN_00432840`); the object is `PathRidingPropUpdate`
(`FUN_00432610`), class 0x28's handler, and six `spawn_placed` records place
two of them (`obj+0x11C` 0 and 1) in blocks 5, 11 and 14. The routine seats
each **once** on its route, `g_class28_route_table` (`0x00589AE0`): `op_st1`
72 at frame 671 and 73 at 667, which are the paths' first keys -- a car at
`(-1021.6, -8.0, -497.5)` and one on its side at `(-1021.9, 1.2, -460.2)`,
blocking the street, each under a fire and a smoke sprite. It throws them the
frame **camera path `0x2F`** -- the boss block's -- reaches that frame, lets
the pose follow `g_cam_path_frame` from then on, and **kills** them when the
frame reaches `g_cam_path_length[slot]`, 725 and 765, with no camera test. The
port had no class 0x28: `RigLayer` drew the first route root from stage load
at `path(min(len, camera frame))` of every camera, so before the throw the car
was hundreds of thousands of units away on the extrapolated path (2.2 million
at `cp_st1` 47 frame 120) and came in through the sky, and the post-fight
cutscene's `cp_st1` 50, which runs through frames 671..725, threw it again in
front of the players. The second car was never drawn at all. Now
`game/class28/` is the routine, `SpawnSlotActor` builds it from the spawn
record (opcode 9 reads no tail), and `RigLayer` draws the rig's spawn roots
from the live actor, one root per actor, the route roots never
(`ACTOR_POSED_ROUTINES`) -- including the two phantom `obj_432840` roots stages
2 and 5 carried and drew with no class 0x28 in them. The sprites stand on the
object's position with the camera-facing yaw alone, as the draw's tail has
them, and stop at the throw. Measured on seed 1 through the whole fight: the
old root moved on 1562 of 4401 frames and threw on two cameras (`cp` 47 and
50); the class-0x28 car moves on 53 frames, all on `cp` 47, and is gone at
frame 725. A seek past the throw leaves the cars seated, because the replay
does not run the game; in play they are gone by then.

**Their fire and smoke play.** Each sprite is a cel loop on `g_frame_counter`
(`0x009A32A0`) -- `0x135F + g_frame_counter % 15` (an unsigned `DIV` at
`0x00432938`) and `0xB67 + (g_frame_counter & 7)` (`0x004329AD`) -- not on
`g_scene_tick_counter`, which class 0x41 type 53 reads for the same two
loops. The rig carried only each loop's first cel, so both stood on it. Now
`obj_432840` exports every cel as a part of its own, 15 fire and 8 smoke, the
way the stage-2 car's rig carries both of its rows, and `PathRidingPropDraw`
in `render/rigs.ts` shows the one the counter names and hides the rest.
Measured from the scene graph over 30 driven frames of `cp_st1` 47 on seed 1:
the drawn cels matched the exe's on 0 of 30 frames before (always
`0x135F`/`0xB67`) and on 30 of 30 after, with all 15 and all 8 seen. Stage
1's glb grows by 0.3 MB.

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
| `31` | `goto_scene_state` | 274 | **Done** — the scene state is real, and this retires the `finish_sequence` behind it |
| `28` | `region_load` | 262 | No — preloads what is already resident |
| `59`/`58`/`5A` | asset job drains | 188 | No — nothing is ever pending |
| `2C` | `set_skippable_region` | 126 | **Done** — drives the Skip bar; the feature is live in the retail game |
| `33` | `set_action_drain_mode` | 125 | **Done** — the `pending` half; the ring's dequeue *mode* is still not modelled |
| `10`/`11` | collision sets | 113 | Only with collision |
| `0A` | `spawn_simple` | 98 | No — its records carry no position, so there is nothing to mark. See the opcode table |
| `49`/`4A`/`4B` | `variant_*` | — | **Worth checking** — a global picks which operand list runs, so some spawns may never appear |

With rain in, the remaining struck-through opcodes are all either moot in a
bundle that already holds every asset, dead in this build, or gated on
machinery the player does not have (a scene state machine, the action ring,
collision). The one genuine unknown left is `variant_*`.

## Wall time, game time, and what stops when

There were three clocks and there are now two: **game time**, which is the
fixed 60 Hz tick below, and **wall time**, which is what the feedback for a
click rides. The script's own accumulator used to be a third; it is the one the
port runs on now. Which of the two a thing rides decides what happens when you
stop.

| mode | script | port and render | wall-time effects |
|---|---|---|---|
| **Play** | runs | runs | run |
| **Paused** | stopped | **stopped** | run |
| **Step** | one instruction at a time | **runs** | run |
| **Free roam** | stopped | **stopped** | run |
| `?freeze=1` | stopped | stopped | stopped |

Paused and free roam used to advance the port and the render layers: an enemy
went on looping its walk clip and sliding along its root motion with the
transport stopped, so opening any of the debugging URLs put the scene in motion
before the script had run an instruction. `Loop.idle` had carried the comment
"for the frozen and free-roam paths" since it was written; free roam simply
never took it.

**Step is deliberately not in that group.** Stepping is for advancing the
script an instruction at a time while the port keeps running underneath — that
is what makes a zombie loop its walk while you read the tree — and it has its
own mode button rather than a paused transport.

Paused says so on screen: the rendered frame drains to grey and the word sits
in the middle of it. The filter is on the canvas rather than on `#viewport`, so
the debug overlays, the crosshair and the message keep their colour. Free roam
stops the same clock and shows nothing, because it is a mode you chose with its
own lit button.

`Tick.frozen` and `Tick.dt` are what every layer already keyed off, so they all
hold correctly: a half-open door stays half open and the rain stops.

**The last column is smaller than it was, and the shot is the thing that left
it.** The impact sprites used to ride wall time — feedback for a click rather
than script state — and the sentence here used to say so. `ff33131` made every
one of them engine state: the muzzle flash, the tracer and the blood are pools
in `G` and `ShotEffectsTick` steps them at the head of `GameUpdate`, on **game**
time. What still rides the wall is the crosshair and the drawing itself.

**So a shot fired with the clock stopped is not fired.** `GameSystem` used to
drain `g_shot_requests` inside its own frozen early return, and the result was
a hit that took hit points off, paid a score and left a flash and a blood spray
that nothing could ever step, so `Shooting.busy` stayed true and the loop that
is meant to sleep while paused ran at 60 fps for ever. Both halves are shut
now: the frozen tick drains nothing, and `app/main.ts` does not turn a click
into input while the game clock is stopped, so paused clicks do not bank and
arrive together on the frame it restarts. **Step mode is untouched**, because
step mode is not a stopped clock — its ticks carry time and resolve a shot down
the ordinary path, which is what makes "fire, then walk it forward a frame at a
time" still work.

### The clock: one fixed tick, and who feeds it

**The simulation advances in whole 60 Hz ticks and never skips one.** A
*frame* is a different thing — one `requestAnimationFrame`, one drawing of the
scene — and a drawn frame runs however many whole ticks the accumulator owes:
usually one on a 60 Hz display, usually none on 144 Hz, several after a stall.

It was not always one clock. The script's accumulator handed the **walker**
whole frames while `Player.gameTick` handed the **port**
`frames: wall * speed * 60` straight off the rAF timestamp — fractional, and
different on every frame. So a stage played twice integrated a different amount
of time between the same two instructions, `g_frame` was a float, and every
`===` against a frame cursor was a coin toss. Stage 1 gave four different
outcomes over five runs on identical code and an identical route.

The engine's frame is fixed: `obj+0x19C` counts up by one per game frame, and
both camera drivers end on `g_cam_path_frame = __ftol(...)`, an integer that
steps by one. That is why an exact-frame cue is safe there, and why a port
integrating a fraction of a frame was not running the same game.

**Nothing is dropped.** A burst bigger than the per-frame cap leaves the
remainder in the accumulator for the next frame — the catch-up is spread, not
discarded — and the `Math.min(0.1, ...)` that used to sit in `wallDelta`, which
lost 400 ms of game time in a 500 ms stall and said nothing, is gone. That is
affordable because a debt worth dropping is never allowed to form: **a hidden
tab stops the clock** and resumes without banking the gap, and **a paused
player stops asking for frames at all.**

The loop genuinely sleeps, so anything that changes what is on screen has to
wake it. The wakers are chokepoints — `runCommand`, the keydown handler,
`popstate`, `setLoading`, `fail`, a shot, the harness, the tab becoming
visible — and `tools/pacing.mjs` proves the whole arrangement on the real page,
counting the page's own rAF calls from outside the module graph.

Interpolation between ticks is deliberately not done: it needs the previous and
current pose in `render/`, which is a second copy of state above the engine
line, and at 60 Hz simulated it buys nothing until the display is faster.

#### A frame that owes no tick must not do part of one

The corollary, and it cost the camera. `Player.tickStopped` runs the **whole**
tick order on `Loop.idle` — it has to, because the impact sprites and the
crosshair are feedback for a click and keep moving while the clock is stopped
— so every system in that order decides for itself whether a tick with no time
in it is any of its business. `GameSystem` answers no. A system that is *half*
of a game-time job has to answer no as well.

`CameraSeatSystem` did not, and the report was **"the camera rapidly switches
between two look-at points between frames"**. A camera frame is two systems
either side of the game phase: the seat writes the block from the rail, and
`CameraTrackEnemiesTick` eases that block's aim onto whatever the fight wants.
On a frame that owed no tick the seat ran, put the block back on the rail, the
ease did not run, and the draw put the un-eased aim on screen. One frame eased,
the next on the rail, at the display's refresh rate.

**It is invisible at 60 Hz**, which is why it lasted: there, every drawn frame
owes a tick and there is no idle frame to draw the wrong half. Driving the real
loop against the shipped stage 1 bundle with one enemy registered:

| display | idle frames | flickering frames | camera travel |
|---|---|---|---|
| 60 Hz | 0 of 600 | **0** | 626° |
| 75 Hz | 240 of 1200 | 144 | 2220° |
| 120 Hz | 600 of 1200 | **785** | 5733° |
| 144 Hz | 701 of 1200 | 499 | 3676° |

At 120 Hz nine tenths of the camera's movement was the flicker, and the worst
single frame swung **10.8°** and came straight back. With the seat gated on
`t.frozen || t.dt <= 0` — the same test `GameSystem` makes, one system later —
the count is zero at every rate and the 60 Hz travel is unchanged to the digit,
which is what says the fix is a no-op on a display that owes every frame a tick.

Nothing else wanted the ungated seat: the seek, the stage load and the frame
slider all seat through `Player.syncCameraToWalker`, which calls
`CameraRig.sync` directly. The **draw** is deliberately still ungated — placing
the three.js camera from a block that has not changed is idempotent, and a
resize needs it.

Since then the seat has gone altogether. The camera's two tasks run inside the
game tick (`game/camera/actor.ts`), so a frame that owes no tick runs none of
the camera, and the draw places the three.js camera from the matrix the last
tick built.

`test/camera.test.ts` is the guard: it plays stage 1 at 60 and 120 Hz through
the real `Loop`, `Walker`, `CameraRig` and `CameraTrackEnemiesTick`, and
asserts that a frame owing no tick draws the pose the last tick left. It was
made to fail against the old code first — 785 flickering frames of 1200.

#### `?drive=1` is the same loop with a different time source

| | script | port | who feeds the accumulator |
|---|---|---|---|
| Play | whole ticks | whole ticks | the wall clock |
| `?drive=1` | whole ticks | whole ticks | the driver |

Under the flag rAF keeps running and the renderer keeps drawing — it is the
real page, the real UI, the real shot path — but game time advances only when
`advance(n)` asks for it. A driver schedules its input by **frame number**: the
game is stopped between two calls, so a pointer event dispatched there lands on
an exact frame.

The seam is inert without the flag and may do nothing a `UiCommand` cannot:
stepping frames is Step mode with the count made explicit, reading state is the
projection plus the globals the sidebar already shows. `tools/playthrough.mjs`
and `tools/determinism.mjs` are the two drivers.

---

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
| `0x53` the cat | `u16[0x00589A64 + variant*10]`, variant from the parameter tail — **plus every clip of the table** (`CAT_CLIPS`) | `FUN_00431250`; the table is a five-entry playlist per set (`g_cat_motions`), all inside `nya.bin`'s 762–773, and `CatMotionListUpdate` steps through it — see below |
| `0x19` the stage-4 boss | motion **124** (`0x7C`), `boss4.bin` | `Boss4Init` (`FUN_004917E0`) stores it as a literal: `MOV dword ptr [ECX + 0x20], 0x7C` at `0x0049183E` |
| `0x21` the rescue target | motion **998** (`0x3E6`), `zom.bin`, plus the freed clip **972** (`0x3CC`) | `RescueTargetInit` (`FUN_00451720`) stores it as a literal: `MOV dword ptr [EDI + 0x20], 0x3E6` (`c74720e6030000`) at `0x00451747`. See below — the missing row cost half of stage 2 |

**And a character-type rule that was wrong for as long as it existed.** Class
0x19's row read `("literal", 0x7C)` — the right instruction from the wrong pair.
`Boss4Init` writes the **type** two instructions earlier, from the descriptor
tail, and `0x7C` is the clip:

```
0049182e  MOVZX DX, byte ptr [EDI]          ; EDI = obj+0x130C, the tail
00491832  MOV word ptr [EAX + 0x60], DX     ; char+0x60 == obj+0x1F4, the type
0049183e  MOV dword ptr [ECX + 0x20], 0x7C  ; char+0x20 == obj+0x1B4, the clip
```

Type `0x7C` has no skeleton, so all four class-0x19 spawns resolved to "no
skeleton", never became placements, and **the stage-4 boss had never appeared in
a bundle**. The tail carries `0x4A` — `boss4.bin`, fifteen nodes — and with the
rule fixed the four placements arrive with entrance states 0, 1, 2 and 3, the
nineteen clips the class names, and a rig the ordinary writer builds.
| `0x14` the stage-2 boss | motion **33** (`boss2.bin`), and the whole of that bank's **21–58** offered to `bake` | `Class14Init` (`FUN_00475E90`) seats anim slot `0xB`, and `g_class14_anim_slots[0xB]` names 33. The bank goes in whole because each of the 21 states measures its exit on the **play clock** of a clip it names, so an unbaked one is an actor that waits for ever rather than one that is posed wrongly. Before this rule existed **stage 5 had no character type 71 at all** — the boss it spawns had no skeleton, no hit spheres and no clips |

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

### A missing motion rule made half of stage 2 unreachable

Class `0x21` is the **rescue target**, and there is one spawn of it in the whole
game: stage 2, block 0, step 2, script address `0x07D0`. Block 0's route record
is `{branch, next = 11, 1}`; `RescueTargetHeldState` (`FUN_00451980`) writes
`g_script_branch_var = 1` when the last of its sixteen parts is hit, and only
then does the stage take block 1. The class had been read, named and ported —
and the actor had never once existed in the player.

The whole of it was the absent `MOTION_RULES` row above. `motionFor` answered
null, so `resolveForStage` recorded the placement as a *marker* and `continue`d
before building a character; no skeleton was built, no clip was baked, no `chr_`
hierarchy reached the glTF, and `render/characters.ts` had nothing to adopt. The
port's own spawn path is gated on that adoption — `readySpawns` lists only an
`at` that `pending` holds — so `SpawnScriptedCharacters` never made the object,
`RescueTargetInit` never ran, and the branch could only ever answer 0. Measured
from the stage entry under the driven clock: block 0 forks to **block 11** on
every run, and blocks 1 through 10 and 21 through 32 — the whole rescued branch
— are unreachable.

It is the third time this exact row has been the bug: class `0x19` (the stage-4
boss, "never appeared in a bundle"), class `0x14` (the stage-2 boss, "stage 5
had no character type 71") and now class `0x21`. The failure is silent by
construction, because "placed as a marker" is what the exporter does for every
class whose handler has not been read, and a class that *has* been read looks
exactly the same from the outside.

**And the actor is on the car.** `RescueTargetPoseFromRoute` (`FUN_00451E50`)
and `RescueTargetPoseFromRouteWithVelocity` (`FUN_00451EB0`) set its position
*and* its orientation from
`CamEvalObjectPath6(g_st2car_path_table[obj+0x1350], g_cam_path_frame)` — the
same table, row and frame the stage-2 car's own poser reads, `op_st2` `0x148`
under camera `0x38` and `0x14E` under `0x39`. Those two were recorded as "draw
and pose helpers, the renderer's" and left out, so the ported ride-in built an
absolute position out of the spawn yaw alone and parked the actor 40 units from
the world origin, 1,600 from the car. Sub-state 0's `(0, 50 − frame, 50 −
frame)` is a **drop-in on top of that pose**, not a position: it is rotated by
the route's own yaw, added to the route point, and reaches zero exactly as the
camera frame reaches 50.

**And it sat 11.94 units behind where the engine draws it, until the port's
root-motion model was settled.** Clip 998's root translation is a constant
`(0, 15.692, 11.943)` — it is what puts the body over the bonnet — and
`render/characters/pose.ts` applied only the **y** of a clip root, on the rule
that the port had already taken the horizontal part as world movement through
`ApplyRootMotion`. For a clip whose root never changes the per-frame delta is
zero, so nothing ever took it. The rule is true of *one arm* of a test the
engine has and the port had collapsed.

`SkeletonApplyRootMotion` (`FUN_00410C50`) is handed a **pointer** to the
current frame's three root floats and tests `model+0x64` bit 1 **twice**:

```
00410d2f  TEST byte ptr [ECX + 0x64],0x2    ; does the delta move the object?
          delta = root - baseline, through T(obj+0x40) Rz Ry Rx S(model+0x116C)
          written back to obj+0x40 / obj+0x48, and baseline = root
00410e93  CALL dword ptr [ECX + 0x115c]     ; the gated arm does NOT return
          T(obj+0x40); the actor's rotation; S(model+0x116C)
00411005  TEST byte ptr [ECX + 0x64],0x2    ; ...and which part of it is posed?
0041100b  MatrixTranslate(0, root.y, 0)     ;   bit set
00411020  MatrixTranslate(root.x, root.y, root.z)   ; bit clear
```

So **neither is relative to the other: they are two consumers of one absolute
track, and the bit picks exactly one of them.** A clip's root translation moves
the object or offsets the pose, never both and never neither. `[proved]` — and
from the bytes, because Ghidra shows the gated arm returning at its
`MatrixStackPop` where in fact it writes the baseline at `0x00410E5F`–`0x00410E93`
and falls into the shared tail (`L37`).

The baseline is a field, `model+0x1160..0x1168`, not a remembered frame index,
and nothing ever lets it turn a clip's *absolute* root into a step:
`ActorSetMotion` seeds it from the new clip's frame 0, `ActorSetMotionBlended`
leaves the flag pair that makes the routine reset it to the current root, and a
loop wrap is damped rather than taken. So the port's frame-to-frame delta was
right; the missing half was the pose.

`RescueTargetInit` is one of exactly two things in the game that clear the bit
— `MOV EDX,[EDI+0x64]; AND EDX,0xFFFFFFFD; MOV [EDI+0x64],EDX` at
`0x00451753`–`0x00451760`, one instruction after `ActorBuildSkinnedModel` set
the word to 3 — and the other is `CivilianRunScript`, per block. The port was
missing that line too.

**The blast radius is four actors, and it was measured rather than hoped for.**
`tools/verify_root_pose.py` decodes every motion block in the game and counts
the ones with a non-zero *absolute* horizontal root on frame 0: **992 of 1058
are exactly zero**, which is why the collapsed arm was invisible. Then it pairs
every clip the shipped class-0x10 scripts set against the wait word governing
it, and the clips that can be posed with a horizontal root and the gate clear
are `people.bin` 596, 598 and 600 — one root, 2.882 units, one use each. Plus
`zom.bin` 998 at 11.943, which is this actor. Nothing else in six stages can
move: `civ_walk.mjs` reports the stage-1 rescue civilian walking the identical
`20.87 over 590 frames (56,-194) -> (37,-186)` either side of the change,
because the second arm is a pose and moves no world position at all.

**Two things about it are `[diverges]`, not `[open]`**, and both are declared
in `game/` rather than in `render/` so that `verify_port.py` counts them — the
divergence count went 167 to 169 and that is the point of it. A departure
described only in prose reads as settled, which is how a doc comment with no
assertion behind it kept a hang alive for two sessions.

1. **The death clip keeps its whole root whatever the gate says.**
   `ActorAdvanceMotion` returns early on `obj.death`, so nothing steps the
   actor, and `pose.ts` overrides the gate at that one call site because
   otherwise a falling body's travel would come from nowhere. The engine has no
   death track at all: a death clip is the ordinary motion and the gate decides
   it like any other. The two land in the same place wherever the clip's frame-0
   horizontal root is zero — the pose offset is `root[f]` where the accumulated
   deltas would be `root[f] - root[0]`, both inside the actor's own rotation —
   which is 992 blocks of 1058. **That is why it is invisible, not why it is
   right.** Faithful means running root motion through a death in `game/`, for
   the classes with no death machine. Tagged on the `obj.death` branch in
   `game/motion.ts`.
2. **The pose offset was unscaled, because the model was.** The engine's
   translate sits *inside* `MatrixScale(model+0x116C)`, so a character drawn at
   0.9 offsets by 0.9 of what its clip authored, and this port drew every
   character at 1.0. Three of the four clips that reach the pose at all belong
   to a `scale 0.9` type (stage 4's type-48 civilian at spawn `0x3578`), where
   the engine's offset is **2.593 units and the port's was 2.882**; the fourth is
   class 0x21 at character type 7, scale 1.0. **Closed** by drawing every
   skinned actor at its size — see *The model's size* below.

`MotionFlag.RootMotionY`, bit `0x10` of the same word, was `[open]` here with
no writer read. It has one: `ThrowerStateDelayedPounce` raises it for its wait
clip (`0x0044E863`), and `ApplyRootMotion` now honours it — the height store at
`0x00410E48`. What it stores is the height of the delta *after* the actor's
rotation, and `ApplyRootMotion` now turns the delta by all three angles,
`T · Rz(roll) · Ry(yaw) · Rx(pitch) · S`, as the gated arm does
(`0x00410D56`..`0x00410D9B`); it used to turn by yaw alone. The one place that
shows is stage 2 block 21, whose pair are spawned rolled onto a wall: their
wait clip's flat root height is beside the point, because the roll turns the
clip's -Z into world -Y. See class 0x31's state 23 below. And the engine's
wrap damper makes the applied delta `(baseline_old - root)/play_length` where
`rootDelta` computes `(root - root[0])/frames`; both are small, neither was
touched, they are not the same number and nothing asserts either.

**15 further `[diverges]` tags live outside `game/` and `script/`** — eight
files under `render/` — and `verify_port.py` does not count them, because
`cited_files()` is `game/` plus `script/` by an explicit earlier decision.
Recorded here rather than acted on: widening the count is a change to what the
honest measure measures, and it would move it by fifteen at once.

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

### ...and then they were played, which took a branch chooser and found four bugs

Exporting the actor turned those twenty-two blocks from unreachable into
**live code no run had visited**, which is a different problem: a driven run
takes one arm of every branch, and with nobody rescued `g_script_branch_var`
stays 0 for the whole stage. `tools/playthrough.mjs --route <block>:<target>`
is the answer and it **plays for the arm before it clicks one** — every writer
of that global in the image is actor code, so the tool fires the same volley
the gates get while the walker is inside a rule's block, and on block 0 that
kills the rescue target and the game takes block 1 itself. The override on the
branch bar is the fallback, reported as one, because it can leave the world in
a state the engine cannot be in: clicked rather than played, block 0's arm 1
leaves the rescue target in `RescueTargetHeldState` holding both enemy
counters for ever, and blocks 3 and 5 then report as unclearable rooms.

Six routes cover the twenty-two. **All of them now play, and three of the six
reach an end block** — `docs/PLAYER_HANGS.md` item 25 has the table. What it
found, items 26 to 30:

* `CivilianStepScript`'s wait bit `0x1000` is **three** conditions and the port
  had one: the arm only applies while `g_scene_state_major_entered == 2` and it
  releases on `g_camera_settled` **or** `g_camera_free`. Fixed — and it was
  *not* what stopped block 9, which is why it is its own item.
* A stashed camera range played by scene state **7** publishes one frame *past*
  its end — `JG` where state 6 has `JGE`, both incrementing before they
  publish. The port gave state 6's answer to both, and stage 2's block 9 waited
  for ever on a civilian whose cue was that frame. Fixed.
* Class **0x42** has no module, and each of the 6 to 15 objects
  `PlaceFallingBreakableBatch` (`FUN_0042F9B0`) builds increments *both* enemy
  counters — so blocks 21 and 26 open their `wait_enemies_alive 0` early.
  `[open]`.
* Class 0x30 **state 19** waits on a camera frame the port overwrites with the
  stashed range's own, and the engine accepts the cue from either of two camera
  blocks where the port models one. Block 24 stops on it; `[open]`, because the
  faithful fix is a second camera cursor.

## Three enemies that had no module: the frog, the owl and the fish

Classes `0x11`, `0x43` and `0x51`. All three increment **both** enemy counters,
so every `wait_enemies_alive` behind one used to be a gate the port opened for
the wrong reason. All three are now in `game/class11/`, `game/class43/` and
`game/class51/`.

**Each species is settled by a name table, not by shape.** Class 0x11's
descriptor tail carries character type `0x1B`, which `g_character_skeletons`
resolves to `frog.bin`, and its one voice is `COMMON\KAERU4_22.WAV` — *kaeru*.
Class 0x43 draws sixteen slots and every one lies in `owl.bin`, and it dies
playing `COMMON2\FUKUROU1_22.wav` — *fukurō*. Class 0x51's twenty-frame swim
strip is `fish.bin` entries 3 to 22. The bat records (`KOUMORI`) exist and the
owl does not play them, which is what rules out the other reading.

**None of the three has hit points.** `obj+0x11C` is written once in each and
never compared: `obj+0x34` bit 3 is the whole damage model, and one bullet kills.
Each pays 80.

| | frog `0x11` | owl `0x43` | fish `0x51` |
|---|---|---|---|
| spawns | 4, stage 1 block 3 | 14, stages 2 and 3 | 28, stages 2 and 3 |
| drawn as | a skeleton, `frog.bin` | a hand-built slot chain | one slot of `fish.bin` |
| how it attacks | a 30-frame ballistic leap; the hit is **timed**, on motion frame 60 | a dive; the hit is a **distance**, five units from the eye | a lunge to one of four points in camera space |
| what limits it | `g_attack_permits`, the same array class 0x30 uses | `g_class43_attack_token`, one per flock | `g_water_attack_slots`, four |
| when it leaves | despawns after a landed leap, **without dying**; shot, it tumbles, leaves the ground ring as it settles and sinks | never: dive and orbit for ever | falls back and despawns |

Three readings from these that are worth keeping:

* **The engine's free value for `g_attack_permits` is zero, not -1.**
  `ReleaseAttackSlot` (`FUN_00456520`) opens with `XOR EDX, EDX` and writes
  that, and the frog tests `!= 0` for "taken". The port's array holds `-1` for
  free and the holder's `at` otherwise, which is a `[port-only]` choice made
  because a pointer is not an `at`; `game/class11/` spells its tests in the
  port's sentinel and says so on the spot.
* **A class-0x51 descriptor whose sub-type is 6 is not a fish.** It is the
  water: `FishInit` clears the four attack slots, copies the tail's first float
  into `g_water_level` and kills the actor. Seven of the twenty-eight shipped
  records are these, which is why they sit at the world origin with no
  orientation.
* **A sub-type-0 owl cannot be shot until the camera's path frame passes 682**,
  and no other sub-type has that guard -- but nothing in the class clears the
  hit bit, so a bullet that lands early is kept and kills it the frame the
  guard lifts.
* **The owl's corpse lands on literals, not on the stage.**
  `OwlCorpseFallAndSettle` (`FUN_00448210`) has one ground per sub-type: a
  stairwell for 0 -- two rails at `g_class43_corpse_rails` that turn it back, a
  wall at `x = -739`, thirteen steps and a landing at `35.91906`; a line
  between a flat at `49.16` and a sloped plane for 1; an eight-step stair in a
  box and a floor at `-36` for 2; water at `-25` for 3. The spin the death
  gives it keeps 0.95 of itself a frame, so the body stops turning over.
  The owl registers for the shot test the engine's way now, at its own tail,
  and the corpse never does, so a falling body no longer takes the shots meant
  for the owl behind it.

The owl's body chain (sixteen slots in one matrix chain) is `render/owl.ts`.

**Their effects are.** The owl sheds forty feathers when it dies and eight
on every strike, and leaves blood at its camera-space point; the fish leaves a
blood cloud, splashes on every surface crossing, and its corpse leaves the ring
task on the water and two widening rings as it sinks (`game/effects/owl.ts`,
`fish.ts`, `ring_effect.ts`; drawn by `render/creature_effects.ts`). The notes
used to say the fish's three had no termination to copy. They have one each --
twenty-five, thirty and sixty frames -- in bytes past the `MatrixStackPop` the
decompiler stops at (`L35`). And the deaths that meet the water never made the
surface ring the port had them make: all three call `SpawnRingEffectAtPose`
(`FUN_00408370`), the ring task `SpawnGroundRingEffect` makes too. The owl's
ground impact ring and water splash come from the corpse's landings, which are
their only callers: a ring where sub-types 0, 1 and 2 come to rest, and the
splash where sub-type 3 goes into the water.

The frog's two gaps, which this list used to name, are closed. Its **turn fix-up** — not a
head look: after each 45° pass the engine turns bone 1, the node the whole of
`frog.bin` hangs from, back by the turn it just put into the yaw, so the
blend out of the turn clip starts from the pose on screen — rides the fade's
snapshot as `Actor.fadeFrom.records`, the mechanism class 0x19's turn already
uses. Its **actor-versus-actor push** is ported, and its point was never in
doubt: `g_camera_blocks` is the view-to-world matrix and `part+0x130` a
view-space draw record, so the product is bone 1 in the world. The push is
scaled by bone 1's travel between two readings of that record through one
camera block — relative to the camera — and the pushed point is the sphere
the frog publishes, which `ColiTestSphereAgainstActors` now reads out of the
published registration list (see "The crowd push tests what registered").
Reading the two states whole also found four wrong ports inside them: the
wedge clamp is `acos`, not `asin` (`CrtAcos`); state 1's middle heading band
was inverted; both launch frames run on into the flight and halve the turn
that frame too; and the leap's recovery resumes the clip at cursor `0x3D`
over a fade of 2, where the port had played it from the start over 61.

**The frog's death is ported, and a shot one no longer stands for ever.**
`FrogStateDieTumbleAndSink` freezes the death clip on the frame it reads
`len - 1` and waits to read `len`; the engine's states read the cursor the
last draw computed, one tick behind the counter the port's director has
already stepped, so in the port the freeze stopped the clip one short and
the corpse held `g_enemies_present` for ever. With the corpses stopping
bullets too -- the kill raised `0x100` where the engine raises `0x8000`, out
of the shot test -- stage 1's frog room could not be cleared by shooting.
The class now reads `part+0x08` as the engine's states do
(`FrogTail.playCursor`), which also puts every hop, leap and turn on the
engine's frame rather than one early. The death blends into its clip rather
than cutting, runs its first substate on into the bounce (`L53`), opens
`SpawnGroundRingEffect` under bone 1 as the corpse settles, and sinks for 181
frames before it goes. The kill keeps bone 3's model on the corpse -- its
third write zeroes bone 2's **hit radius** (`Actor.boneRadius`) -- and calls
`ChooseHitPlayerOrder`, which is a draw with two players in. `FrogInit`
raises the trace-the-floor bit the ring and shadow read. The real-bundle
check is `tools/animals.mjs`'s `frog death` row.

## A fourth: the bat, class 0x46, and a flight path that is not in the script

Reported as "bat zombies that fly out" in stage 4 block 0 step 6, with the
class guessed at as 70. The guess was right, and both of the binary's name
tables agree with it: character type `0x1E` is `zabat.bin` and the wing
actor's `0x1F` is `zabat_wing.bin`, and every death plays
`COMMON2\KOUMORI1_22.wav` or `KOUMORI2_22.wav` — *kōmori*. Those are the
records the owl section above notes as existing and unplayed; this is the class
that plays them. `game/class46/`.

**The descriptors say almost nothing, which is the interesting part.** All
twenty-four sub-type-0 spawns sit at `(0, 0, 0)` with a yaw of `0x8000`. Two
bytes tell them apart — `+0x11C` is the member index plus one and `desc+0x24`
is the flight group — and the pair indexes `g_bat_spline_points`
(`0x00589944`), twelve rows of four control points walked as a **uniform
quadratic B-spline**. `BatSplineWeights` (`FUN_0042DFD0`) is the same basis the
owl's approach uses, which is why a bat starts at the *midpoint* of its first
two control points and not at the first.

| Group | Where | Spline slots |
|---|---|---|
| 0 | stage 4 block 0 step 6 | 0, 1, 2 |
| 1 | stage 3 block 4 step 5 | 3, 4, 5 |
| 2 | stage 4 block 2 step 6 | 6, 7, 8 |
| 3 | stage 4 block 10 step 1 | 9, 10, 11 |

Three sub-types, and they disagree about more than their trajectory:

| | dive `0` | scatter `1` | swarm `2` |
|---|---|---|---|
| descriptors | 24 | 1 | 2 |
| members each | 1 | 25 | 6, or 8 with two players |
| enemy counters | both | **neither** | both |
| killable while waiting | no, but a hit then is kept and kills it at launch | cannot be hit | **yes** |
| how it ends | reaches the eye, takes a life | passes `z = -3500` | reaches the eye, takes a life |
| corpse gravity | `0.02722`, 80 frames | `0.04083`, to `y = -25` | `0.02722`, to `y = -25` |

**Nothing stops a bat reaching you.** There is no range test, no attack permit
and no `g_attack_permits` anywhere in the class: a bat flies its path, homes on
`g_camera_block_eye`, calls `PlayerTakeDamage` and despawns. That is also why
the `wait_enemies_present 0` behind each flight cannot deadlock — the flight
ends itself whether or not anybody shoots.

**...and until 2026-09-19 it arrived and did nothing** (NEW-BUGS 19). The
strike's one gate is `g_player_state == 5` for either player, read bare at
`0x0042E88A` (dive) and `0x0042F1B5` (swarm), and the port seeded that word 0.
The routines were transcribed right; the state they test had never been
written. See the `IsPlayerAttackable` section for `PlayerEnterPlay` and the
player shell that now writes it. `tools/bats.mjs` now runs all six bat steps through the real bundles
without touching the state word, and `tools/bats_page.mjs` drives the page
under `?drive=1` and watches the score fall by exactly 100 — a strike's charge,
which no kill can produce (`L47`). Only one life per flight: members arrive
twenty frames apart and the 90-frame invulnerability window swallows the rest,
as `PlayerTakeDamage` (`FUN_00415300`) does in the exe.

Four readings from this that are worth keeping:

* **The bat is deliberately not a skeleton to shoot at.** `PlaceBats` writes
  `obj+0x34 = (obj+0x34 & ~0x80) | 0x80000`, and bit `0x80` is the one
  `ShotTestSphere` (`FUN_00404630`) tests before it descends into the bones.
  Clearing it makes the bat one sphere of radius 4.0, whole, with one bone in
  the skeleton it could have used.
* **The bob is the clip's own root translation.** `obj+0x204` is
  `model+0x70`, which `SkeletonPoseRootFrame` (`FUN_00410920`) rewrites every
  time the model is drawn, and both flying sub-types add a multiple of it to
  their height. The flight path is smooth; the up-and-down is the wing clip.
  On the spline it is added **twice**, once inside the assignment and once
  after it, and the latch at the end of the spline stores one of the two.
* **The swarm is six with one player and eight with two**, and the expression
  reads like the other way round:
  `((1 < g_players_in_play) - 1 & 0xFFFFFFFE) + 8`. The first annotation of
  `PlaceBats` had it as eight-and-ten, and `tools/verify_bats.py` asserts the
  arithmetic now.
* **Two objects collapsed into one, and the order of reads survived it.** The
  engine's placer seeds the new object's previous position from `sin`/`cos` of
  *its own* yaw, which is still zero, and only then copies the placer's pitch
  and yaw over it. The port's sub-type-0 member *is* the placement's actor, so
  the seed is taken at an explicit zero and the member keeps the descriptor's
  `0x8000`. (The first cut zeroed the yaw itself as well, and every waiting bat
  faced the wrong way until its spline turned it.)

### The wings, and the bundle's first synthetic placement

`SpawnBatWings` (`FUN_0042E060`) builds a **second skinned actor** per bat:
character type `0x1F`, six nodes in two three-segment chains, clip `0x406` run
off its body's own motion clock. It finds its body in `g_bat_members` every
frame and despawns the frame that slot goes empty.

The port builds it in the placer, where the engine does. What it needed on top
is a **placement**, because `render/characters.ts` binds a drawable hierarchy
to a placement by spawn address and a placer's child has no descriptor. So the
exporter emits one synthetic row per sub-type-0 bat: parented to the body's
row, at the address the port gives the wing, and flagged `synthetic` so
`SpawnScriptedCharacters` refuses to build from it. The layer adopts the object
the placer already made.

That is a new shape for the bundle and it is worth naming: **a placement is no
longer always an evt descriptor.** Two rules keep it honest, and both have
their own assertions in `test:render` — nothing spawns from a synthetic row,
and an actor the port made outside `readySpawns` is still adopted.

### Two bugs the first cut shipped

**The bats could not be shot, and the check that said they could was reading
the wrong number.** `PlaceBats` clears `obj+0x34` bit `0x80`, and
`g_character_bone_spheres` (`0x004D032C`) holds **radius 0** for character type
`0x1E`'s one bone — so `ShotTestSkeleton` can resolve nothing on a bat and the
engine measures `obj+0x124` = 4.0 around `obj+0x70` instead. The port drew the
bat through the character path, whose pick walks bone spheres only, so a bat
had no hit test at all. `pickShot` now takes the engine's own `else` arm for an
instance whose bones carry no sphere, and the actor publishes `obj+0x70` as
`(x, y + 1, z)` the way its update does. See `L47` for how the false
verification happened.

### Every bat drawn, the wing where the exe seats it, and the splash

**The scatter's twenty-five and the swarm's six are drawn**, bodies and wings.
All three sub-types draw the same way in the exe — character type `0x1E` or
`0x1F` through the skinned draw, keyed on the type alone — and the port's
character layer binds geometry by spawn address, so the exporter now emits a
synthetic row at the address the port's `PlaceBats` gives each runtime child,
parented to the placer: 25 bodies and 25 wings behind the scatter's
descriptor, 8 and 8 behind each swarm's. `BatChildAt` had given the member four
bits and the scatter has twenty-five, so members 16..24 shared 0..8's
addresses and wings rode the wrong bodies; it has five now.
`tools/bats_look.mjs` drives stage 3 block 2 in the page, screenshots both
flights and a splash, and checks every live body has a live wing on every
frame.

**The wing sits on the body.** `BatWingUpdate` seats it at node 1's matrix
times `(0, 1, 2)`; the port had `(0, 1, 2)` in the body's yaw alone, which,
against a clip whose root record is a half turn tipped 21°, put the wings four
units off the body on the far side. The matrix is built in `game/` the way the
draw builds it (`BatBodyNodeMatrix`), and `test:render` checks it against the
pose the character layer makes. `render/characters/bat.ts` draws both roots in
order 5 with their pitch and roll — a corpse tumbles, a wing is pitched
`0xE800` — and at their model's own size, 0.6 and 0.7. That size was the bat's
alone when this was written; it is now every skinned actor's (*The model's
size*, below).

**The splash** is `BatSplashUpdate`'s thirty models of `common.bin` 307..336 on
the water plane, `game/class46/splash.ts` and `render/bat_splash.ts`.

**And the shot is the engine's.** The bat registers for the shot test from its
own routines (`registersForShotTest`): the dive and the swarm in every state,
the scatter only at the end of its flying arm, and **the wing never** — the
character layer's pick had walked every drawn bone, and the wing's bone 3
carries a 0.3 sphere, so a wing could take a bullet meant for the bat behind
it. The hit bit is cleared only by the arm that takes it, so a diving bat hit
during its launch delay dies when it launches; the scatter's kill frame is a
flying frame; the swarm's dive bobs by 5.0, not the orbit's 8.0; and every
member and wing claims its hit slot.

## A fifth: the horde, class 0x40 — worms that come up out of the street

Reported as "the 0x40 horde spawner (worms) hasn't been implemented". It had
no module, so every class-0x40 spawn placed nothing, counted nothing, and the
`wait_enemies_alive` behind each of the five hordes opened on its first frame.
**Ported** (`game/class40/`), drawn (`render/characters/horde.ts`,
`render/horde.ts`), checked from a real bundle (`npm run horde`) and in the
page (`tools/horde_look.mjs`).

* **What it is.** Character type `0x1D`, `mol.bin`: nine nodes, a chain of six
  ring segments 1.3 apart with a two-bone toothed jaw. `[likely]` a worm — the
  model is a limbless, banded, segmented body tapering to a spike (rendered to
  `scratchpad/horde/mol_m53*.png` and in the page); no name table says so.
* **Two classes of object behind one id.** `PlaceHorde` (`FUN_0043BD30`)
  switches on the descriptor's `+0x25`: **1** builds four to ten members, **2**
  is not a horde at all but the prop they push aside
  (`SpawnHordeEmergeProp`, `FUN_0043DC30`). Seven descriptors, nine spawn
  instructions: five hordes (stage 1 blocks 3 and 8, stage 2 blocks 0x0E, 0x12
  and 0x19) and four props (stage 1 blocks 3, 7, 8 and 12). The first
  annotation said all nine were hordes.
* **The member** (`HordeMemberInit`, `FUN_0043BEF0`; `HordeMemberUpdate`,
  `FUN_0043C440`): a hold of `idx * 20` frames out of the shot test, a walk in
  along six segments of `g_horde_formation`, then wandering a grid until it is
  its turn (`g_horde_diver`, one at a time, ninety frames apart, and only on
  screen): wind up toward the eye, leap, hang in front of the camera and
  **bite** — `PlayerTakeDamage(player, 1, 10)` — pull out and wander again.
  One bullet, 80 points, both counters, a `PDMG_MORR` from the stage's bank
  and a splash-and-ripple (`SpawnHordeDeathSplash`, `FUN_0043E4C0`); the
  corpse sinks and flattens for sixty frames (`HordeCorpseSinkUpdate`,
  `FUN_0043DA20`). Where the horde is decides its formation, its skin (row 1 of
  `g_submodel_bone_slots` in stage 1 block 8 and stage 2 block 0x19 — green
  scales rather than purple bands) and its size (0.55 in block 0x19, where
  members 3+ drop from the ceiling and nobody is counted until
  `g_script_flags[94]`).
* **The sub-model.** The member is not drawn by the ordinary skeleton code but
  by a second, smaller copy of it that lives in the member's side block
  (`SubModelInit` .. `SubModelBlendToMotion`, `FUN_0040EAE0`..`FUN_0040F900`),
  with its own clock stepped only on the frames the member draws, all three
  object rotations and its own scale. The clock is `game/class40/submodel.ts`;
  the pose is the character layer's, fed the same half-frame cursor. The jaw
  opens during the dive (`SubModelPoseBoneHalfRate`'s type-0x1D arm).
* **The prop** is shootable, rings, tumbles onto a corner and rocks flat, and
  can be shot again; it scores nothing and counts for nothing.
* **Two routines Ghidra truncates** (`L35` again): `HordeMemberUpdate`
  "returns" after the shadow's `MatrixStackPop`, and `HordeEmergePropUpdate`
  after its fall's. The bytes carry on in both — into the shot-sphere publish,
  the camera registration and the `g_horde_members` stamp for the member, and
  into the draw and `RegisterForShotTest` for the prop. Transcribed from the
  pseudocode neither could be shot once drawn.

Verified: `npm run test:port` drives every state against the real play
lengths; `npm run horde` builds all five hordes from the exported bundle,
sees them walk in, dive and bite, shoots them all (a printed override: no pick
without a page) and watches both counters return to zero and the walker leave
the gate; `tools/horde_look.mjs` does it in the page through the real shot
path — stage 1 block 3: eight members, `e8 p8`, 640 points, walker 3/3 → 3/4.

**The rug.** Stage 2 block 0x19's first member lays a sheet --
`komono_room.bin` part 2, a patterned rug -- and the first three crawl under
it, bulging it as they go (`SpawnHordeDeformedProp`, `FUN_0043EF70`;
`HordeDeformedPropUpdate`, `FUN_0043F010`; the normal passes
`VertexMapRebuildFaceNormals`, `FUN_0043F2E0`, and
`VertexMapAverageFaceNormalsXZ4`, `FUN_0043F3E0`). Its lifetime and when it
may move are `game/class40/sheet.ts`; the per-vertex half-sine and the
normals are `render/horde.ts`, reading the members the port already keeps.
Screenshot `web/shots/horde-sheet-00780.png` (`tools/horde_sheet_look.mjs`):
three ridges across the rug while the members are under it. Not ported:
class 0x47 (`PlaceLoneHordeMember47`), which no shipped descriptor uses. The
secondary light set the member and the rug draw under
(`LightsUseSecondarySet`) is not modelled.

## Coming through the window, and the ambience that goes with it

Two reports from the same afternoon, and they meet in the same place: a
**seek** and a **state** each have to leave the world where play would have
left it, and neither did.

**`ThrowerStateLeapToPoint` (class 0x31 state 20) had no animation.** The state
is how a class-0x31 actor arrives from somewhere it could not have walked from
— stage 2 block 11 plays the glass and then spawns two `zstin` in it. The
engine installs a three-stage **arc motion script** and steps it, cutting motion
300 into a windup, a flight and a landing; the port integrated a velocity and
played no clip, so the actor slid through in whatever pose it had. It also
missed the three things that travel with the script: the actor is
**unshootable** while it is coming through (`obj+0x34` bit `0x100`), the camera
tracks bone 2 from the landing frame, and there is a footfall on the frame the
arc settles.

An arc stage measures its exit against the clip's **own frame**, so a stage
whose clip is not baked never advances at all. Stage 4's nine `zskamere` needed
motion 439, which no bundle had because nothing had ever asked for it. Bundle
format 8 carries the three scripts and the clips they name.

**The looping sound effects did not survive a seek.** `Walker.playSe` is silent
during a replay, which is right for a gunshot and wrong for an ambient bed: one
`se_play` starts a noise lasting minutes and another stops it, so a stage
reached by a deep link had no rain, no wind and no machinery for the rest of the
scene while the same stage played from the top had all three. The music never
had the problem because `bgm_entry_play` records its track on the walker before
the quiet check; the loops now have the same record, and `Bgm.syncLoopingSe`
puts the mixer where the script left it without restarting a loop that is
already correct.

`npm run loops` is the check, and it is the only one in the tree that measures
the mixer rather than the intent: it taps `window.Audio` before the app boots
and watches the cursor wrap.

## The music loops where the engine's does

The report was that the port's music "seems to start from scratch on loop",
and the question whether the game does that. **It does** `[proved]`: there are
no loop points in the files or the exe. Channel `0xF` is streamed, and
`SoundStreamThread` (`FUN_004A4640`) seeks back to the first sample when a
refill reads past **end of file** -- so a track is its file from sample 0 to
EOF, end to end, for ever. What the game does not do is stop between passes:
the wrap is made inside one ring refill. The port's `<audio loop>` element put
**8.4 ms of digital silence** at the seam of `ST1.WAV` `[measured]`, which is
the join made audible. Every detail is in
[`formats/sound.md`](formats/sound.md#the-music-stream-no-loop-points),
including the per-track table.

Six things were wrong, and all six were in the same two files:

* **The seam.** `audio/stream.ts` transcribes the stream -- `SoundChannelOpenWav`'s
  header walk and the thread's wrap -- and `audio/bgm.ts` plays one period of it
  as a Web Audio buffer looped whole. That period includes what the engine
  plays and an element never would: the file's `LIST` chunk, a few frames of
  `"LIST"…"INFO"` read as PCM between the last sample and the first, and, for a
  track whose pass is `2 mod 4` bytes, the next pass half a frame late -- the
  channels exchanged every other time round.
* **Three tracks do not loop.** `PlaySoundId` passes `loop = 0` for exactly
  `0x10000009` (`OVR_AR`, the game-over track), `0x10000025` (`CLR2`) and
  `0x10000014` (`HOD1_ADV`). The port looped everything, so the game-over sting
  went round again.
* **Playing a track restarts it.** `SoundPlayOnFreeChannel` reopens the file
  on every call; the port ignored a request for the track already playing. A
  seek, which has no engine counterpart, still leaves a correct track alone
  (`Bgm.syncTrack`, port-only).
* **`bgm_entry_play` is a stop and then a play.** The port played only, so
  `bgm_entry_play 0` -- which stages 2, 3, 4 and 6 open step 1 with -- did
  nothing.
* **Each stage's track is started by its script**, with a `se_play` at step 2
  of each entry block (stage 5: `bgm_entry_play`). The record said no script
  did, having looked only at `bgm_entry_play`, and the player started the
  track at load "by convention" -- a step early -- and then ignored the
  script's own `se_play` of it. The walker's `bgmTrack` now follows both
  instructions, as `g_current_bgm_id` does, and a stage load is `SoundStopAll`.
* **`0x80000002` stops the voice.** The mixer took every namespace-8 id as a
  music stop; `PlaySoundControl` (`FUN_0041D3E0`) has three arms. evt `0x2E`,
  which plays it after a cutscene skip, was named `resume_bgm_if_skipped`, and
  it is `stop_voice_if_skipped` -- so every skip used to silence the music. The
  host no longer cuts the voice itself at the moment of the skip; the script's
  `0x2E` does, as in the game.

Checks: `npm run test:audio` (the dispatch and the stream, with no browser),
`test:seek` (each stage's first track, across a seek), `npm run bgm-loop` (the
page: the buffer the script's track reaches Web Audio as is compared frame by
frame with the file, rendered across the wrap, and heard), and
`tools/verify_bgm_stream.py` (the exe's own bytes, and every track).

## The gameplay loop

**Done.** Enemies advance by the game's own **advance rings**, compete for an
**attack permit**, and the camera follows whoever holds one. Full account in
[`formats/combat.md`](formats/combat.md) §10; the short version:

* Every enemy measures its distance **to the camera** — the camera is the
  player here — and the ring it starts in sets how many steps it walks before
  it may attack: `{25, 38, 51}` radii, 2 / +3 / +4 steps, from `DAT_004C4CD0`
  and `FUN_00408D60`. No stage uses evt `0x0E`, so those constants are what
  every encounter runs on.
* `TryClaimAttackSlot` grants **one permit per player**, and offers each
  claimant exactly one of them — see *The claim offers one player* below.
  Only the holder enters its attack state; everyone else keeps walking. That
  one byte (`obj+0x121`) also decides the camera's focus.
* `RegisterForCameraTracking` skips any actor with flag `0x10000`, which the
  approach state sets while walking and clears itself when the actor wins a
  permit — the claim does not — so the camera only ever considers enemies
  that have committed. Candidates are
  keyed `|actor − eye| × 10` and radix-sorted nearest-first; permit holders take
  slots 0 and 1, the rest from 2.
* `SelectCameraLookAtTarget` aims at the lone attacker, the midpoint of two, or
  — with none registered — the `cam/` path's own target, so with no enemies the
  authored camera is reproduced exactly.
* `TurnLookAtToward` eases onto it by `1/(1+rate)` per frame, rate from a
  64-entry curve: **64 below ~18° of error, 16 past ~23°**. That curve is the
  camera's feel — it holds for small offsets and swings for wide ones.

The **Track** checkbox turns it off, restoring the authored path exactly.

**The body turns at the exe's rate, and the head is not yet aimed.** Every
turn goes through `TurnAngleToward` (`FUN_00409E00`) as the exe has it: a flat
rate a frame -- `0x1A0` for a jogging zombie's run and `0x410` for a sprinting
one's, `0x40` in the hold and the wait -- the short way round, with a negative
rate turning the long way and dithering about the opposite heading, which is
how the retreat faces away from where its swing began. The run used to ease a
fifteenth of the angle a frame instead, and a zombie half a turn off came round
in about half a second where the game's takes 79 frames. The torso is not
aimed. **The head is, and the port does not do it**: the class-0x30 and
class-0x31 per-bone draw hooks step `obj+0x1320`/`+0x1324` toward the camera
at `0xC0` a draw and rotate bone 2 by them, up to a quarter turn either way of
the body. That had been recorded here as a settled negative, from a search of
the pose hook, which is empty; the aim is in the draw hook beside it. See
[`formats/combat.md`](formats/combat.md) §10.

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
front of the camera, spinning `0x2400` BAMS a frame, and costs a life on
arrival: the hit is timed, not tested — unless it is shot out of the air
first. Throwing leaves the hand bare and sets the arm's destroyed-zone
bit, so the cancel mask treats a thrown arm and a shot-off one alike.

**And it re-arms, which turns out to hold the whole state machine up.**
`ThrowerStateStandAndDecide` (`FUN_0044B180`) offers state 29 to
`ThrowerTryEnterState` and asks `ThrowerPickNextState` (`FUN_0044ADB0`) only if
that is refused — and the router is the *whole* of "attack when it gets
close": `d <= 30` writes state 8, which claims a permit and pounces. So a
state-29 proposal that is always accepted pre-empts the router entirely, and
the actor can be standing on the lens without ever asking.

That is what happened. `ThrowerStateRearm` (`FUN_0044F7A0`) plays motion **5**
and swaps each bare hand slot back to its armed one at that clip's exact
**midpoint**; `ThrowerHasBareHand` (`FUN_0044F720`) reads those same slots, so
the re-arm is the only thing that can make the gate false again. Motion 5 was
missing from the exporter's `CLASS31_LITERAL_MOTIONS`, so it was baked for
nobody, `ActorClipFrame` returned `-1`, the midpoint never arrived — and the
hub proposed the re-arm again the very next frame. **7 ↔ 29, every frame, for
ever**, from the first throw on, while the idle's root motion walked the actor
into the camera. `0x11B`, `ThrowerStateFallAndLand`'s get-up, was missing from
the same list.

The list is hand-kept because most class-0x31 clip ids arrive through the
motion sets and the attack tables, which the exporter collects from the data,
while a handful of states name one inline. Its omissions are silent —
`MotionOf` returning nothing is not an error anywhere — so `verify_port.py`
now checks the port's own class-0x31 clip constants against the list, and
against the exported bundle.

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

**State 23, the delayed pounce, is transcribed whole** (`class31/entrance.ts`,
stage 2 block 21's pair). The port had the shape and little else: it played
the wait as a one-shot that ran out after one cycle, left the actor shootable,
raised `BackingOff` (`0x20000000`) where the exe raises `0x10000000`, aimed at
the actor's own tracked height for `g_camera_eye_y`, and never raised the
flinch veto. Now the wait loops on the ordinary track and walks, every shot in
it ricochets, the flight ends six units in front of the eye at the eye's own
height — `ThrowerPickLandingPoint` switches on the *state*, and nothing in the
port had read that — and past the pounce row's hit frame the actor stops
reacting to shots. `ThrowerLoadAttackArcScript` no longer latches the stance
the connect reads: the exe's does not, so the swing connects on row 0's frame.

**...and the wait is a climb down the clock face** (NEW-BUGS-2: "they should
climb down the wall, then jump onto the player"). The pair's spawn records
carry orient `(0, 0xC000, 0xC000)` -- on their sides against the wall -- and
the port kept only the yaw: the placement had no `pitch` or `roll`, so the
actors stood upright a hundred units up in mid-air, drawn upright, and
`ApplyRootMotion` turned motion 310's forward walk by the yaw alone, which
walked them 8.7 units out from the wall along +X. Three things changed, all
from the exe: the exporter emits the record's other two orientation words
(`SpawnFromDescriptor`, `FUN_00408A20`, copies all three) and
`SpawnScriptedCharacters` puts them on the actor; `ApplyRootMotion` turns the
delta by roll, yaw and pitch (`SkeletonApplyRootMotion`, `FUN_00410C50`); and
`render/characters/thrower.ts` draws class 0x31 in `EnemyThrowerInit`'s order
1, `RotX; RotZ; RotY`. Measured in the page at
`?stage=2&mode=play&entry=0&block=21&step=2&op=7&frame=64`, before and after:

| | before (main at `2e6de214`) | after |
|---|---|---|
| height over the 45-frame wait | 163.9 -> 163.9 | 163.9 -> 155.2 (8.7 down) |
| height over the 60-frame wait | 153.2 -> 153.2 | 153.2 -> 140.6 (12.6 down) |
| x over the 45-frame wait (the wall is at -830.3) | -830.3 -> -821.6 | -830.3 throughout |
| roll | 0 throughout, drawn upright | `0xC000` on the wall, level six frames into the leap |
| leap starts at | 163.9 | 155.2 |

The leap itself was fixed with the rest of the state above: it lands six
units in front of the eye at `g_camera_eye_y` (51) instead of at the actor's
own height, and the stab connects on row 0's frame 62, thirteen frames before
the landing, with the body about thirty units above the eye and closing.

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

### The claim offers one player, and leaves the camera bit to its callers

`TryClaimAttackSlot` (`FUN_00455DE0`) and `ThrowerTryClaimAttackSlot`
(`FUN_0044CA40`) are transcribed whole now; both used to carry a declared
divergence.

* **The pick.** The port took the first free permit. The engine picks one
  player and offers only that player's: `g_active_player`'s with one attacker,
  a `rand() % 2` with two attackers when one player is in play or one enemy is
  present, and otherwise the player on the actor's own half of the screen
  (`ActorScreenHalfSign`, `FUN_00409C90`, ported alongside). Nothing falls back
  to the other player. For player 1 alone the answers were the same; **player
  2 alone** was being offered player 1's permit, and in a two-player game
  every enemy went for player 1 first. The two `rand()` arms draw from the
  frame's `Rng` at the exact point each caller claims, so all twenty claim
  sites in the two classes carry one — `ZombieShouldStandAndThrow`,
  `ZombieStateWaitForCameraFrame`, `ZombieStateScriptedGrabAndDespawn`,
  `ThrowerStatePathFollow` and `ThrowerStateRideObjectPath` gained the
  parameter. One-player play draws nothing new, so its random stream is
  unchanged.
* **`NoCameraTrack`.** The port's claim lowered `obj+0x34` bit `0x10000` on
  every grant; neither exe routine writes `obj+0x34` at all. Only
  `ZombieStateApproach` (after its grant), `ZombieStateWaitForCameraFrame`
  (before its claim, hidden kind only) and `ZombieStateHoldForCameraCue` (at
  its cue) lower it, and the port already had all three. So a captor held for
  a camera cue now stays off the camera's list until the cue, as it does in
  the game, instead of from its first claim in the hub.
* **The callers, read with it.** `ZombieShouldStandAndThrow` claims *before*
  its hand test for `znassb` and after it for types 0x13/0x14, so an unarmed
  `znassb` walker takes the permit and is answered no. `ThrowerTryEnterState`'s
  state 0x20 claims and then asks for surface `0x35` (the router called it an
  open question; `QueryGroundSurfaceAt` answers it), keeping the permit on a
  refusal. `ThrowerStateRideObjectPath` is shot-immune for its ride. The
  three-hop blink-in raised `NoCameraTrack` where the exe raises `ShotImmune`
  (`0x100`), so stage 6's `zslman` could be shot while materialising and were
  hidden from the camera. The scripted attackers' own player picks
  (`ZombieScriptedPickPlayer`, `ThrowerGrabTakePermit`) compared the permit
  table against the engine's literals, `=== 1` and `=== 0`, which the port's
  holder-id/`-1` representation never matches for a claimed entry.
* **Still open.** Class 0x30 state 28 (`0x004586E0`, claim at `0x004587C4`)
  is the one claimant of the twenty-one that is not ported. A `-2` pick that `IsPlayerAttackable` passes — attract mode only
  — is refused rather than claimed; the port runs no attract mode.

### The noise a standing zombie makes, and the chainsaw

Both were silent, and both had been looked for in the wrong routine. There is
exactly **one** voice routine in this game — `ActorPlayHitVoice`
(`FUN_0040A6F0`), five kinds across twenty-three call sites — and **none of the
five is an idle**: they are the three shot reactions, the attack cry, and one
that turns out to be dead. So no amount of reading it could have found either
of these.

**The groan is a bare `PlaySoundId` in the hub state.**
`ZombieStateHoldAtRange` (`FUN_00455720`) plays `0x1917A9`,
`COMMON2\ZOMBIE_041_16.wav`, at `0x004558D6` — inside the same one-instruction
gate (`CMP EAX, EDI` at `0x004558B0`) that starts the in-range idle clip. So it
is one shot per *entry* into the idle: on arrival at the ring, and again after
every swing and retreat. Not periodic, not random, not on a timer. A byte
search for the id over the whole image finds that one `PUSH` and the SE name
record, and nothing else.

It is **rarer in play than "whenever a zombie stands still"**, and the same
`CMP` is why: `ZombieStateApproach` plays `row[(obj+0x136C >> 0x15) & 1]`, so
for the `row[0]` half of that pair the walk in *is* the clip the hub wants and
the hub changes nothing. Measured in the page on stage 1 block 4, where the
walkers reach the ring silently and only the attack cries sound. What does
groan is an actor that comes back on a clip the hub does not want — `row[4]`
after the retreat, `row[2]`/`row[3]` after an attack run, or the strike clip
itself — which is every zombie that has swung at you once. Both arrivals are
asserted in `web/test/port.test.ts`.

**The chainsaw and the laser sword are a refcounted loop, not a voice.** For
character types 2 and 3, `EnemyZombieInitByCharType` (`FUN_00452FD0`) plays
`CHAIN_SAW_22` or `LASER_SWORD_22` — but only while `g_weapon_loop_holders`
(`0x009C8A74`) is zero — then increments it and latches `obj+0x131B`.
`FUN_00456600` plays the paired `_OFF` id only from the *last* holder. Both
play ids are in `g_looping_se_ids` and both stop ids in
`g_looping_se_stop_ids`, so the engine plays the first looped and turns the
second into a `SoundStopAllLoopingSe`. One shared loop per scene, opened by the
first such actor and closed by the last to die — or the moment a type-2 actor
loses both hand props, which `ActorUpdateBodyCondition` (`FUN_00454270`) is
what does. Shoot the chainsaw out of its hands and the noise stops while the
actor is still alive, which is the second thing that proves it is the weapon
rather than the actor.

Two annotations were wrong and are fixed: `0x009C8A74` was recorded as a count
of "groan voices" and `FUN_00456600` as the death scream. The filenames settle
both.

**And nothing in the player looped anything.** `audio/bgm.ts` played every SE
as a one-shot, so class 0x31's laser sword — ported earlier, and correctly —
had been igniting for 0.4 seconds and never sustaining, and its `_OFF` cue was
a 404 for a file the game does not ship. The loop branch is transcribed now,
and the bundle carries `sound.looping`, the 44 pairs out of the EXE.

### The hit voice exists once, and a kill's kind is the head bone

`ActorPlayHitVoice` (`FUN_0040A6F0`) was implemented **twice**: kinds 0, 1 and
2 in `render/shooting.ts`, because the shot path needed them before there was
anywhere else to put them, and kind 3 in `game/combat/voice.ts`. Both copies
carried a comment saying so, and the renderer's carried the standing
`[diverges]` that said consolidating it was four decisions rather than a move.
All four are made.

**The layer.** `verify_layers.py`'s `render-drives-the-port` refuses `render/`
to call an engine function, and it is right: the engine plays the three shot
kinds from `ZombieOnShot` (`FUN_00453EB0`) and `ThrowerOnShot`
(`FUN_004499A0`), which are `game/` code. They are raised from
`game/combat/feedback.ts` now — beside the blood, and in the engine's order,
which is the blood first. The renderer has no `playSound` and no sound of its
own left at all; `app/stage_load.ts` lost the wiring with it.

**The determinism.** The pick was a generator private to `render/`, reseeded
per stage, on the argument that which grunt plays is feedback rather than
state. It is the world's seeded `rand()` now, like every other draw in the
port, and therefore in the snapshot — which is what a save has to be able to
reproduce (`L10`).

`[proved]` **And on a kill the kind is the shot bone, on a hurt the result.**
Two routines agree, which is what makes it a rule and not one function's
habit. `ZombieOnShot` holds two pointers across its per-player loop, `EBP` =
`&g_shot_bone[p]` (`LEA` at `0x00453EEE`) and `EBX` = `&g_hit_result[p]` (at
`0x00453F0D`):

```
00453f3b  TEST EAX, 0x80000000        ; latched -> neither arm, no voice
00453f46  TEST dword ptr [ESI + 0x34], 0x4000000   ; Dead?
00453f68  MOV  EAX, [EBP] / CMP EAX, 0x2   ; the head -> kind 2, else kind 1
00454020  MOV  EAX, [EBX] / CMP EAX, 0x5   ; alive and not 5 -> kind 0
```

and `ThrowerOnShot` reads the same `[EBP]` at `0x00449A70` for its `CMP` at
`0x00449A76`. **This section said the opposite when it was written** — that
the `CMP` at `0x00453F6E` was on `g_hit_result`, so a head kill whose result
was 1 played kind 1 and a body kill whose result was 2 played kind 2 — and the
port's voice and five of its checks were rewritten from that. The register is
the bone pointer; the render-side `head` rule, and `docs/formats/combat.md`'s
original `bone == 2 ? 2 : 1`, were right. Corrected with the register trace,
and `verify_combat.py` check 15 now reads both routines' operands out of the
image.

**What a player hears is the impact, and almost nothing else.** Kind 2's two
voice ids in `g_hit_voice_table` are the *same pair* as kind 1's —
`ZOMBIE_019` for set A, `ZOMBIE_018` for set B — so the difference between
those two kinds is two head impacts (`BLOOD01`, `BLOOD05`) against the five
body ones (`BLOOD02/03/04/06`, `BONE01`):

* a **killing head shot** plays a head impact;
* a **killing body shot** plays a body one, whatever its result;
* a shot that finds an actor **already dead** says the kill line — but only
  until the actor's own on-shot routine has latched the death. The latch test
  comes before both arms (`0x00453F3B` for class 0x30, `0x00449A12` for class
  0x31), so every later shot into the corpse is silent; the port replayed the
  death line on each of them until the latch was read.

That equality is a claim small enough to be tempting to leave in a doc comment,
which is how `L26` happens, so it is a check: `verify_combat.py`'s check 15
reads `g_hit_voice_table` out of the EXE and asserts that kinds 1 and 2 share
one pair, that the two impact tables are five and two ids with nothing in
common, and that kind 3's entry is a *pair per set* where the others are one id
per set. Four mutations of the parser fail it. The five kinds, the bone and
result tests and the latch are asserted in `web/test/port.test.ts`; putting
back the result test fails three of them and dropping the latch two.

**And the bursting head shouts.** `ActorShotFeedback` holds one of the routine's
twenty-three call sites and it is **kind 3**, not a shot kind: `0x00454133 PUSH
0x3` on the one head model (`0x1DC2`) that comes off on a damaging hit, before
the `0x1DC1` stump is swapped in. That had been an open question in
`combat/feedback.ts` saying the burst was silent because the voice tables lived
in `render/`. It is the same cry a strike plays.

One drift was found on the way. `web/src/hod2lib/combat.ts` had been given the
attack pair when the silent swing was reported; `tools/hod2lib/combat.py` had
not, so the Python half read all fifteen dwords of the table and emitted eleven
of them for longer than the rule allows. `tools/verify_exporters.py` cannot see
that class of gap — it compares the two halves' **modules and version**, not
the fields they emit — and the new check 15 is what caught it.

`[proved]` **Kind 4 of the voice routine is dead.** No call site in the image
passes 4 — all twenty-three pass 0, 1, 2 or 3, and the census is in
`combat/voice.ts` — and its two ids at `g_actor_voice_kind4` (`0x005A4EA8`) are
zero in the shipped `.data` with nothing in the image writing them. The nearest
thing that could is the 14-entry radix-sort scratch at `0x005A4E38`, which ends
one dword short of them and whose two feeders are both capped at 14. So the arm
reaches `PlaySoundId(0)`, the dispatcher's own "no sound" early-out. Porting it
is porting silence, and the enum member stays only to say so.

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

### The throw is a state, not a loop — and the re-arm belongs to state 29

`ThrowerStateThrow` (`FUN_0044FAF0`) ends on the throw clip's last frame and
writes state **7**, the hub, and nothing else:

```
0044fcbb  MOV   EDX, dword ptr [ESI + 0x1b4]           8b96b4010000
0044fcc7  MOVSX EAX, word ptr [EDX*0x2 + 0x4e07d0]     0fbf0455d0074e00
0044fcd0  CMP   ECX, EAX / JL                          3bc8 7c1f
0044fcd4  PUSH  0x2916a9 / CALL PlaySoundId            68a9162900
0044fce1  MOV   word ptr [ESI + 0x1310], 0x7           66c786101300000700
```

The port instead **looped inside the throw**: it left only when its own one-shot
clip channel emptied, swapped one hand's weapon back itself, reset its own
sub-state and went round again — so a `zsass` threw both weapons in one visit,
never reached the hub, and `ThrowerStateRearm` (`FUN_0044F7A0`, state 29) never
ran at all. The one-hand swap carried a `[diverges]` saying as much.

The re-arm is the hub's, and it is offered **before** the router is asked:
`ThrowerStateStandAndDecide` calls `ThrowerTryEnterState(0x1D)` — `0x1E` for
character type 0x18 — on every one of its frames (0x0044B375 and 0x0044B390)
and only reaches `ThrowerPickNextState` when that is refused. So the shape is
**hub → throw → hub → re-arm → hub**, and `class31/standing.ts`'s claim that
"neither [state 29 nor 30] is reachable through the router — no pick band names
them" was true of the pick bands and wrong about the engine.

Three more things came out of reading the state properly, all `[proved]`:

* **The three sub-states fall through into each other** (`SUB EAX, 0 / JZ` then
  `DEC EAX / JZ` twice at 0x0044FB16), so a throw can start and release on the
  same frame.
* **The clip does not start at frame zero.** `ActorSetMotionBlended`'s third
  argument is written straight into the play cursor (`param_1[2] = param_3`),
  and this state passes `0x1A` for every type but 0x18, which passes 0. A
  `zsass` throw is 22 cursor ticks of wind-up against its entry's release frame
  of 48, not 48.
* **The state releases no permit.** `SpawnThrownWeapon` hands `obj+0x121` to
  the projectile and leaves the thrower holding **0** — not −1 — and the
  weapon frees the slot at the end of its stick-and-blink life, in
  `ThrownWeaponFlyToTarget`, or when it is shot down. The port used to free it
  in `SpawnThrownWeapon` instead, about ninety frames early, because its weapon
  record could not hold one; the record carries the permit now, and each
  family's weapon gives it back through its own family's release.

### Four things that stopped the throwers working

**Reported:** "after their first attack they stop attacking and just wait" —
`WaitForPermit/0 · wants a permit`; "sometimes when I shoot them once the game
continues past them but they're still alive and trying to attack me"; "their
bbox goes quite far into the wall — it looks like only their origin is
measured against the coli". Four separate defects, and the first one alone
stalls every enemy in the scene.

**1. The permit was released with the wrong function.** `obj+0x136C` carries
the off-screen-permit latch in bit **`0x8000`** for a thrower and
**`0x20000`** for a zombie — one word, two classes, two bits, the same
polymorphism the counters have. So `ReleaseAttackSlot` (`FUN_00456520`) called
on a thrower frees the permit *array* and leaves `g_attack_committed` raised,
and `TryClaimAttackSlot` reads that latch on its **first line**. One thrower
that claimed while off screen — which a wall-crawler at forty-five units off
to one side does routinely — and nothing in the scene could ever attack again.
Every class-0x31 release site in the exe calls `ThrowerReleaseAttackPermit`
(`FUN_0044CFB0`); the port called the class-0x30 one at **eight** of them, and
two more cleared `g_attack_permits[]` by hand, which does not lift the latch
either.

**2. `ThrowerPushOutOfWorld` (`FUN_00449D40`) was two thirds unported.** It is
the hook `EnemyThrowerInit` installs at `obj+0x12F0` — class 0x30's slot holds
`ZombiePushOutOfWorldAndActors` — and it does three things: push the body
sphere out of other actors at two thirds of the radius and a tenth of the
depth, push it out of the world at the full radius and the full depth, and, in
states 7 and 8 only, snap back onto the surface it is clinging to. Only the
snap ran. The `[diverges]` that said so claimed the engine's penetration depth
had never been read; it had — `ColiTestSphereAgainstFullSet` writes
`g_coli_hit_depth` and `g_coli_hit_normal`, and class 0x30 has pushed by both
since it was ported. So a thrower was tested against the world **at its origin
and nowhere else**, which is the bbox in the wall.

Two things had to come with it. `EnemyThrowerInit` seeds `obj+0x136C |=
0x180000` — every thrower is born colliding, against the world and against
actors both — and the port set `flags2 = 0`; and `obj+0x128`, the radius the
push tests with, is **5.0 for character type 0x16 and 4.0 for 0x17–0x19** and
the port never set it at all. The sphere is also not class 0x30's:
`ThrowerPlaceCollisionSphere` (`FUN_00449E80`) lifts it **1.4 radii**, and
*lowers* it by the same for an actor on the ceiling, because a hanging
thrower's body is below the point it holds on by.

**3. `ThrowerReleaseSlotOnDeath` (`FUN_0044D050`) had no port.** Every one of
class 0x31's falls opens with it, and it is what drops `g_enemies_alive` on
the frame the actor is knocked off its feet rather than three seconds later
when the body stops bouncing. It also lets the **camera** slot go —
`obj+0x120`, which is not the permit — with a deliberate exception: the *last*
enemy present keeps the camera while it dies, so the shot that clears a room
is not cut away from.

**4. The Kill button did not kill a thrower, and the gate was counting the
wrong thing.** Class 0x31's death is a four-state chain entered by
`ThrowerOnShot` reading `pendingHit`, which `ResolveHit` writes and
`ActorKillAll` did not — so the button left a thrower flagged dead and still
pouncing at you. Meanwhile `wait_enemies_alive` read **`chars.aliveCount`**, a
recount of `instances.filter(visible && !dead && isEnemy)` in the *renderer* —
the derived count `game/combat/counts.ts` exists to explain is a different
quantity. Three things followed: an actor hidden for one frame left the gate's
count, a class-0x31 corpse left it on the first frame of the fall while it was
still on screen, and an enemy class the port cannot run at all (0x43 and 0x51
are both in `ENEMY_CLASSES`) was counted and could never die. It reads
`G.g_enemies_alive` now, which is what the exe's gate reads and what the
civilian gate beside it has always read.

**2b. And two more things wrong underneath it, which is why the first fix was
not enough.** With the push ported, the bodies were still in the wall.

The **order** was wrong. `ThrowerPushOutOfWorld` went in where the old
surface-snap call sat — *before* the state — and every class-0x31 state writes
`obj.pos` outright, so the push was overwritten before anything drew it. It
runs after the state now, the same place `EnemyZombieUpdate` runs its own. Two
things say that is right: `FUN_00405160`, which copies the sphere
`ThrowerPlaceCollisionSphere` writes into the per-frame collision list, is
reached from the *end* of `EnemyThrowerUpdate`, so the sphere must already be
placed; and the hook's own last act is the surface snap, which would be undone
every frame by the state if it ran first.

And `ColiTestSphereAgainstFullSet` **rejected the case that matters**.
`ColiSphereVsMesh` (`FUN_004AAFF0`) compares `distance²` against `radius²` and
never asks which side of the quad the centre is on; the caller reads the sign
afterwards:

```c
if (0.0 <= g_coli_hit_depth) g_coli_hit_depth = radius - sqrt(dist_sq);
else                         g_coli_hit_depth = sqrt(dist_sq) + radius;
```

so a body whose centre has got **past** a wall is pushed `radius + distance`
along that wall's outward normal — back out the front, exactly tangent. The
port had `if (d < 0 || d >= r) continue`, which is *no push at all* for a body
far enough in. That is "quite far into the wall" precisely. Selection changed
with it: the engine keeps the **nearest** candidate, not the deepest, and the
two only agree while every hit is in front.

Worth recording because it was nearly written the other way round: the store
in `ColiSphereVsMesh` reads `g_coli_hit_normal_x = fVar1`, and `fVar1` is
`centre − closest` — but **only on the edge branches**. On the face branch it
still holds the quad's `nx` from the top of the loop. Taking the store at face
value gives a normal that flips with the side, and a body behind a wall is
then driven deeper rather than out.

`tools/body_push.mjs` measures it against the shipped data: **twelve of the
game's 51 class-0x31 spawns have their body sphere inside the world at their
own spawn point**, four of them with the centre behind the surface. The two
the report named — `0x1F50` and `0x1F88`, stage 2 block 3 step 4 — are 2.67
units in. Every one of the twelve is clear after a single frame's push.

**2c. And on the wall it was a third thing again — the one that made the bbox
"intersect massively".** `ThrowerSnapToSurface` (`FUN_0044C600`) calls
`ThrowerFindSurfaceUnderfoot` (`FUN_0044C640`). The port called
`TraceActorSurfaceContactPoint` (`FUN_0044C370`) instead, which is a real
function with real callers — `react.ts` uses it for the surface a knockdown
bounces off — but a **different** one, and the differences are exactly the
thing being reported:

* it probes ten units each side of the actor, not a thousand;
* on a **wall** it re-places the actor **6.5 units off** the surface it found,
  where the other returns the hit point itself;
* missing has answers rather than a bare `false` — a wall that is not there
  returns `(1000, y, 1000)` and a ceiling `-1000`, both of which fail the range
  test and route the actor to state 8 or state 11.

The middle one is it. A wall stance leaves the sphere's y alone
(`ThrowerPlaceCollisionSphere` again), so an origin planted **in** the wall
plane centres a four-unit body sphere on the surface: half the actor inside
the geometry, permanently. And the push cannot save it, because the snap runs
*after* the push inside the same hook and puts it straight back. Measured
against the old code the assertion reads `0.000 off the wall`, with the sphere
`depth 4` — the entire radius.

One constant went with it: `TraceActorSurfaceContactPoint`'s own overshoot is
`0x40900000`, **4.5**, and the port had 20.

**5. And the corpses flew the wrong way.** `ThrowerBeginKnockbackArc`
(`FUN_0044D120`) moves the actor's **view-space** point along the camera's own
z and transforms it back:

```c
t = 15.0 / |obj+0x70..0x78| * 10.0;   // the view-space tracked point
if (t < 0.0) t = 0.0;
if (obj+0x34 & 0x4000000) t *= 1.5;   // already dead: half again
p = (obj+0x70, obj+0x74, obj+0x78 - t);
MatrixTransformPoint(&p, &dest);      // through the view-to-world matrix
```

That space has **−z in front** — `ThrowerPickLandingPoint` (`FUN_0044CBA0`)
unprojects its landing point at a literal `-15.5`, and the port has carried
that number, negative, since it was written. So `z - t` is *more* negative:
further in front of the camera, which is **away from the viewer**.

The port read the store as "pulled `t` units nearer" and approximated it with
a lerp from the actor toward the eye, under a `[diverges]` saying the camera's
matrix was out of reach. It is not — `GameHost.viewSpaceOf` is the view-space
point and `GameHost.viewPoint` the inverse transform, and both have been on
the seam since the landing point was ported. The lerp was wrong twice: the
direction, and the shape. Moving along the camera's z keeps the body's screen
x and y so it recedes; moving toward the eye converges on a point, and `k =
min(1, t / d)` pinned the destination **on the camera** for anything inside
about fifteen units. A thrower pounces to 15.5 units in front, so that was
every close kill.

**And the seam was the thing to fix, not the caller.** `GameHost.viewSpaceOf`
used to hand the depth over *positive* and refuse an actor behind the camera —
a judgement neither of its two readers asked for. `ActorIsOnScreen`
(`FUN_00409C10`) divides by `obj+0x78` with **no sign test at all** and
compares against symmetric bounds, so an actor directly behind the camera
projects to the mirrored position and reads as on screen; that is the engine's
own behaviour and it is transcribed rather than tidied, because the routine
only gates the off-screen latch. And the knockback subtracts from the depth,
where a flipped sign is the difference between a body thrown away and a body
thrown at you. The seam now carries `obj+0x70/74/78` as the engine holds it,
with no opinion, and false means only "there is no camera" — which the engine
never has and a headless run always does.

It was also a second copy: `ThrowerBeginTumbleArc` in `react.ts` had the same
formula inlined, and the exe has one routine with two callers — `FUN_0044A450`
and `ThrowerStateKnockedTumbling`. There is one now.

Twenty-four assertions in `test/port.test.ts` cover all of it, and the ones
that matter were made to fail against the old code first — including the
reported symptom end to end: *pounced true, latch 1, permit −1.*

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

### The twelve entrance states

**Every entrance state the game ships is now ported.** `ZombieEntryState` used
to be a list of exceptions with an `AttackRun` fallback: seventeen of the 54
states were read and the other 37 fell through, on the reasoning that every
entrance ends by setting state 1 anyway. That is true of some of them and it
was never the point — the entrance is what puts the actor *where the level
wants it* before the attack run starts. Twelve of those 37 have shipped spawns,
**127 of the game's 356 class-0x30 placements**, and states 17 and 18 alone are
75 of them.

| state | name | spawns | what it waits for |
|---|---|---:|---|
| 13 | `ZombieStateSurfaceOnCameraCue` | 16 | the camera path frame, `>=` |
| 14 | `ZombieStateRunInPlaceTimed` | 2 | a frame count |
| 17 | `ZombieStateHoldClipThenBranch` | 38 | a frame count |
| 18 | `ZombieStateWaitCameraFrameThenBranch` | 37 | the camera path frame, `==` |
| 19 | `ZombieStateWaitForCameraFrame` | 4 | ...then claims and strikes |
| 20 | `ZombieStateWaitScriptFlagThenBranch` | 2 | a script flag |
| 23 | `ZombieStateScriptedGrabAndDespawn` | 6 | a cue, then kills and despawns |
| 24 | `ZombieStateLeapToPoint` | 6 | flies to a point and never leaves |
| 29 | `ZombieStateRideCarrier` | 6 | rides `g_carrier_object` |
| 30 | `ZombieStateArcScriptedEntrance` | 3 | a scripted ballistic arc |
| 31 | `ZombieStateWaitScriptFlagThenEnter` | 4 | a script flag — and counts itself in |
| 32 | `ZombieStateDelayedStrikeInPlace` | 3 | a timer, then swings for ever — **on the car**, see below |

Four things worth carrying forward from reading them:

* **The exits are expressed in the play clock**, and three of the twelve name a
  clip the bundle was not baking. `MotionPlayLength` is then 0, the cursor
  never reaches the last frame, and the actor waits for the rest of the stage.
  That is not a cosmetic gap and it is invisible to a unit test with a
  hand-written fixture — `web/tools/entrances.mjs` is what caught it, by
  driving all 127 shipped spawns against the real bundle.
* **`g_two_player_game` was misnamed.** `FUN_004147E0` does
  `INC word [009C8E80]` once per player as it enters — beside a *separate*
  `INC` of `g_max_attackers` on a different slot bit — and `FUN_00413F42` does
  the matching `DEC`. It is a **count of players in play**, renamed
  `g_players_in_play`, and it is 1 in an ordinary single-player game. The port
  had it at 0, which is the attract screen; states 24 and 32 both refuse to
  strike there, so leaving it would have parked all nine of those spawns. The
  thrown weapon, which the port had reading this global, actually reads
  `g_max_attackers` — `ZombieThrowHandWeapon` latches that onto the projectile
  at `+0x1360` one line before it aims.
* **State 19 is the only thing in class 0x30 that arms an attack cooldown.**
  It sets `obj+0x1368` bit 0 and `obj+0x133C`; every other zombie has that bit
  clear, so `ZombieStateHoldAtRange` forces the cooldown to zero and there is
  no wait between swings beyond the strike clip and the retreat.
* **State 29 reads nothing from its descriptor tail** but byte 3 — the tail
  belongs to the state it hands over to. The shipped data proves it cleanly:
  the three spawns whose byte 3 is 26 carry a `ZombieStateDelayedLeap` tail and
  the three whose byte 3 is 30 carry a `ZombieStateArcScriptedEntrance` one.

#### A camera cue is the end of a shot, and the port used to step over it

Six of the 44 spawns whose entrance waits on an **exact** camera frame — states
18, 19 and 23 — name the *last frame of the `cam_play` in front of them*. Stage
1's `0x2254` waits on 179 and op 4 of its own step is `cam_play 115..179`;
stage 2's `0xFAF4` waits on 229 behind `cam_play 100..229`. That is how the
game says "come through the door as this shot ends".

`CamAdvancePathFrame` (`FUN_004035E0`) publishes the camera block's `+0xD0`
*before* it tests the end of the range, and it runs in `EvtRunQueuedActions`,
a task the scene creates **after** `EvtInterpreterLoop` — so the frame a shot
ends on is live for one whole object update before the script can even see the
action retire. `Walker.tick` collapsed both tasks and ran the camera half
first, so the gate fell through on the same tick and the next `cam_play` took
the camera before `syncPortGlobals` read it: 178, then 180. Those six zombies
stood in their entrance clip for the rest of the stage.

The instructions now run first and the camera after, which is the task order.
**`web/tools/entrances.mjs` could never have found this**: it drives the
entrances with a camera of its own that steps by one for ever, so every
equality cue in the game is hit by construction. `npm run cam-cues`
(`web/tools/cam_cues.mjs`) drives the real walker and the real `GameSystem`
over the real script instead, seeking to each spawn's own instruction — 44
entrances, 6 stuck before, 0 now.

#### ...and the *other* way the engine plays a path is the opposite order

`CamAdvancePathFrame` publishes and then increments. Both hooks that play a
**stashed** range do the reverse — `CameraStepRailTick` (`FUN_0040C790`) for
scene state (2,6) and `CameraPlayStashedPath` (`FUN_0040C8A0`) for (2,7)
increment `g_stashed_path_frame` and *then* evaluate, differing from each other
only in `<=` against `<` on the end. So a `cam_play` with `flags & 2`, which
stashes rather than plays, draws `start + 1 .. end`: the start frame is stepped
past and the end frame is reached.

The port modelled both as `CamAdvancePathFrame` and lost the last frame of
every deferred shot. Stage 2 block 16 step 6 stashes `581..660` on path 75 and
**both** cues timed to it are equalities on its tail — `0xA030`'s captor cue at
660 and its civilian's killed-script cue at 650 — so the captor never turned on
the player, the two `znebi2` were never called up out of the water, and
`wait_enemies_alive 0` held the block for ever. None of the 44 entrances above
could see it: every one is a state 18/19 spawn on a non-deferred play.

And a **wait's postcondition is part of an address**. `seekTo` replays
instructions and observes no waits, so it stepped over that step's
`wait_camera_path_frame 0` with the shot on frame 581 and then replayed the
`finish_sequence` behind it, which is `CameraSnapToPathEye` and froze it there
— the reported address was unplayable even with the frame count fixed.
`WaitRule.skipRunsCameraOn` runs the shot on to where the wait would have left
it, the same way `WaitRule.retires` already settled the enemy gates.

**And then it reached the cue holding the only permit** (NEW-BUGS-2: "if the
first zombie mauls the civilian, the zombie then never attacks the player").
With the cue reachable, `0xA030` graduated on frame 660 and stood in
`ZombieStateHoldAtRange` for the rest of the stage with `g_attack_permits[0]`
naming itself. That is the engine's shape, not a port slip:
`ZombieStateHoldForCameraCue` (`FUN_0045BFD0`) runs its delegate first and tests
the cue before its `Strike` bounce, so a captor already at the ring claims on
the cue frame too and graduates into the hub still owning the permit, and its
own permit refuses every claim after it. Nothing in class 0x30 lets it go; the
**script** does. `EvtActionFinishSequence21` (`FUN_00403710`) opens by zeroing
both permits, and queueing a `finish_sequence` clears `g_attack_committed`
(`EvtOpQueueEvent30`, `FUN_0045F7F0`) — and block 16 step 6 queues one right
after the cue, as block 9 step 3 does for the other two held spawns. The port
had neither, and now has both (`script/state/camera_action.ts`,
`Walker.applyQueueEvent`). Three smaller transcriptions came with it, all on
the same path: the bounce frees the table entry only and not the whole
`ReleaseAttackSlot`; `TryClaimAttackSlot` voids `obj+0x121` before it tests
anything; and the hub calls the claim itself behind its own four tests instead
of predicting its refusal — which kept a stale index, and refused a two-player
claim whenever either permit was out — and drops an off-screen latch while the
actor is still off screen (`0x00455748`). Driven under `?drive=1`
(`web/tools/maul_then_attack.mjs`): the civilian dies on frame 200, the captor
graduates on 321 and strikes on 322, and shot dead it releases the two
`znebi2`, who both strike in turn.

### `IsPlayerAttackable`: two of three clauses

The engine's gate is three tests and the port had none of them, standing in
with "the player has a life left". Two are ported now:

1. **`g_scene_state_major_entered` must be 2** — the `cam/` path camera row of
   `g_scene_state_table`. So nothing commits an attack while the follow camera
   or a scripted view-angle turn is driving; being hit during a camera move is
   simply not possible. Measured across the port's own walker, major 2 is
   almost all of gameplay (minors 4, 6, 7) and major 1 minor 3
   (`CameraFromViewAngles`) is the brief scripted-turn spell — 3 to 8 seconds
   in the blocks sampled. The walker already tracked the pair; `syncPortGlobals`
   pushes the half the combat code reads.
2. **`g_app_state == 5` returns true whatever the player state** — the
   attract-mode override. The demo has no real player, so its `g_player_state`
   is never 5 and without this nothing would ever attack it. Inert in the port
   and transcribed because the clause is real — but inert for a reason that is
   now *stated*: **the port sits at `g_app_state = 6`, which is in play.** It
   used to sit at 0 on the strength of "the port has no attract mode", which
   was a guess about what 0 meant, and it was wrong. See
   **`g_app_state` and `ResolveHit`'s three suppression bits** below.

**The third clause is ported too, as of 2026-09-19** (NEW-BUGS 19).
`g_player_state` (0x009A5C62) must be 5, and the writer of 5 is now read:
`PlayerEnterPlay` (`FUN_00414770`), whose four rows in
`g_player_enter_play_modes` (`0x00579DE8`) all carry state 5. The per-player
shell reaches it from states 0..3 — each of `g_player_state_handlers`
(`0x00579CD0`) entries 0..3 is `PlayerEnterPlay(obj, n)` — and
`AdvanceToNextScene` (`FUN_0045FFF0`) parks an in-play player at **2** for a
scene load, whose handler `PlayerStateReenterAfterScene` (`FUN_00413E40`)
enters play again. Boot (`FUN_0040A920`) leaves both players at **9**.

**The port runs that shell now** (`game/player_shell.ts`, the same day).
Every page load and every seek is a game started from the title: boot puts
both players at 9, the title's confirm arms it and seeds the credits
(`SetBothPlayerCounters(ModeStartCounterValue(mode))`), player 0's START spends
one and asks for app state 6, `CommitAppState` applies it, and the scene's
`PlayerTasksCreate` gives player 0 the state-0 handler, whose first turn is
`PlayerEnterPlay(0)`: three lives (the factory options), one player, one
attacker, 90 frames' grace. A stage step carries the player block across and
`AdvanceToNextScene` parks them at 2, so they come back by row 2 with their
lives and score. `g_players_in_play` and `g_max_attackers` start at 0 and are
counted by the routine that counts them; `g_player_lives` has no default. The
`[diverges]` on `g_player_state` and the "has a life left" stand-ins are gone.

**Lives now drain, and a game can end.** `PlayerTakeDamage` is exact: on the
path camera the last life goes, the player drops out of play, and the
continue screen comes up (below). **Press S** -- START -- to continue on a
credit; otherwise the run's own continue screen counts down and asks for the
game-over screen (below). Player 2 can join by the same route, but the page
has no second START key yet.

**Free play by default** (2026-09-29, at the user's request). The options'
credit setting is `g_option_credits` (`0x009C9F25`, a signed byte) in `G`
now, not a constant, and it starts at **-1**: free play, which
`ModeStartCounterValue` (`CMP AL,0xff` at `0x00496B8B`) turns into
`SetBothPlayerCounters(-1)`. Every start and continue succeeds and the credit
line reads free play. The factory reset writes 5 (six credits);
`OPTION_CREDITS_FACTORY` keeps that number, and the tests that count credits
set it. Declared `[diverges]` on the field until the options screen and
saved options exist to hold the choice.

**The continue screen is drawn, and the script waits under it** (2026-09-28,
`NEW-BUGS-2`). It used to be state with nothing on screen: the countdown ran
and the reticle stayed up over a scene that played on, script and all. Now,
all of it read from the exe and recorded as screen sprites for the HUD layer:

* **The run's CONTINUE?** -- `RunPhaseContinueCountdown` (`FUN_00460530`)
  draws `0x22C` at (128, 200) and the 64x128 digit `0x4F + (timer >> 12)` at
  (482, 188) every frame of run phase 4, from `0x9FFF` down `0x2D` a frame:
  each digit 91 or 92 frames, the whole count about fifteen seconds. The
  continue buttons (pad `0x4`) knock it to the bottom of its digit from the 7
  down; the port's mouse is input mode 5, which `[likely]` never raises that
  bit, so a click does not hurry it -- START does not either, it takes it.
* **The credit line** -- `CreditPromptDraw` (`FUN_00406CE0`) and its drawer:
  "PRESS START BUTTON" over "CREDIT(S) n", blinking 64 frames on and 32 off,
  in the continuing player's corner; and the same line in the corner of a
  player who is out, which is player 2's for the whole of a one-player game.
  "INSERT COIN(S)" when the count is 0, "FREE PLAY" in free play.
* **The two-player share** -- a player continuing while the other plays
  draws a small CONTINUE? and digit in their own half through the layered
  queue (`HudDrawContinuePrompt`, `HudDrawContinueDigit`), and a small GAME
  OVER for 119 frames when it runs out (`HudDrawPlayerGameOver`).
* **No crosshair.** `HudDrawCrosshair` (`FUN_004169C0`) is called only from
  the in-play task; its decision is recorded in `G` and the page's reticle
  follows it, where it used to follow the firing gate alone.
* **The script stands still.** `g_evt_gameplay_live` (`0x007DCCA4`) is
  recomputed at the top of `EvtInterpreterLoop` and every wait opcode,
  `0x40..0x47`, tests it, so the walker holds at the wait it had reached while
  the enemies and the camera run on. It used to walk on through the stage
  with nobody playing it.

The sprites are new in the bundle: **re-export** for the continue screen to
show (`screen_sprites` in `script.json`). `tools/continue_page.mjs` drives it
in the real page and shoots `continue-9.png`, `continue-6.png`,
`continue-3.png` and `continue-taken.png`; `tools/verify_continue.py` holds
every position, id and table against the EXE.

**Ammo, the reload and the HUD readouts.** A gun holds six, and **R**
reloads. The whole of it is below, under *The magazine, the reload and the
HUD readouts*.

**The adaptive rank moves.** `UpdateDamageRank` (`FUN_004607B0`) and
`ResetDamageRank` (`FUN_00460770`) are ported exactly and the `[diverges]` that
had `PlayerTakeDamage` write the rank directly is gone: a hit queues -2 in
`g_damage_rank_pending` and the frame's `RunSceneTasksAndTimers` folds it in.
The first frame of a game adds 4 per player, so a one-player Normal game plays
at rank 5 -- see `docs/formats/combat.md`, "Damage rank". Run phase 0,
`ResetGameOnStart`, is where the seed happens; the rest of that routine is the
app's stage load (`[diverges]`, `run_phase.ts`).

**The game-over screen.** App state 7 is `GameOverRunPhase` (`FUN_00460960`),
now `game/game_over.ts`: with both players at state 4 it puts them at 6,
starts `OVR_AR.WAV` (`0x10000009`) and runs 200 frames of fly-over with the
player tasks still walking; then `GameOverLogoTask` (`FUN_00460CD0`), 0xB4
frames of screen sprites -- the GAME OVER plate `0x43A` fading in, five
flashes from frame 0x78, and the plate again at 0x91 squeezed flat and
stretched tall as it fades (`ScreenSpriteAnimTick` scale mode 1: `sx -=
1/frames`, `sy += 1` a frame); then the route map; then `CreditsClear` and the
next app state, 3. The trigger or START cuts the fly-over short below frame
0xA5 and the logo below 0xAF, and ends the route map at once; Training and the
boss's own run return to play instead.

**The fly-over is ported, and it is not the stage.** Phase 0 releases the
stage (`CamSlotsReset` and the pol-slot reset `LoadSceneAndReset` also runs)
and replaces the scene's task list, so nothing of the level runs or draws;
`G.g_stage_unloaded` says so and `render/game_over_scene.ts` hides every node
but the bodies, with no fog on black (`LightBlockInit`'s fog colour 0).
`GameOverCameraFlyTick` flies global path `0x1F`, the one path in
`cp_gmovr.bin`, from frame 10. The bodies are `PlayerBodiesCreate`'s
(`FUN_00416450`) -- character types `0x39`/`0x3A`, James and Gary, from
`0x00579F50` in both modes, because Original Mode's character byte is only ever
the player index -- placed by `GameOverPlaceBody` (`FUN_00415A80`) at the
origin for one player, and drawn by `PlayerHookDrawBodyUntilMotionEnd`: motion
`0x338`, stepping from path frame `0x3C`, gone after its last frame. Every
player at 6 falls on `0x338`: the fly-over list's `PlayerTasksCreate` re-arms
a player whose own countdown put them at 6 in play. The bundle is format 11 for
it: every stage's `cam.json` carries `cp_gmovr`, and its `characters` two
synthetic `player_body` rows. `DrawSkinnedModelAndShadow` does draw a shadow
after all -- `ActorDrawShadow(g_cur_actor)` past the no-return pop (`L35`),
which this paragraph once denied -- and it is `g_cur_actor`'s, not the body's.

**The logo and the route map are the game's own pictures now** (format 12).
Every screen sprite goes through `DrawScreenSprite`'s record in
`G.g_screen_sprite_draws`; `ScreenSpriteDraw` (`FUN_00499F00`, the logo's)
is the same record with an alpha and flags 10, which is the **anchor** nibble --
the sprite's centre -- not a draw layer. The logo's `0x43A..0x43D` come from
`scr_gameover.bin`. The route map (`game/route_map.ts`) is `GameOverRouteMapArm`,
`RouteMapDrawTask` and two figure tasks: a figure -- James, or Gary for
player 2 alone, with Gary beside James for two -- walks the blocks this run
entered (`g_route_history`, which the `checkpoint` opcode now records; an empty
one gets the exe's default route) over the 300 `scr_bunki.bin` tiles, 4 map
pixels a frame, leaving footprints, scrolling the map; when the history runs
out it blends into its end pose, holds 0x78 frames and the screen hands on by
itself. The figures, their ground discs and the footprints are 3D in camera
space; the tiles are drawn at depth 120 behind them, so a screen sprite deeper
than 1.0 is drawn in the 3D (`render/screen_sprites_deep.ts`) rather than on
the HUD canvas, which sits over the view. The text stand-ins are gone;
`ui/panels/GameOver.tsx` is the two buttons and the phase's name.

**Two buttons on it, the page's own** (`[port-only]`, not a gameplay
divergence): **Restart this stage** and **Start from stage 1**. The engine
hands on to a screen the port does not have, so these stand in for the coin
slot. Both go through `restartRun` and the stage load a page load takes --
boot, title confirm, START, `PlayerEnterPlay` -- so credits, lives and score
are fresh. `web/tools/game_over_page.mjs` plays stage 2 to a game over by a
real strike on the path camera, reads the plate and the flashes out of `G` and
the DOM, and presses both buttons (screenshots in `web/shots/gameover-*.png`).
The damage splat no longer hangs over the screen: the renderer draws an
overlay only while the player's task is one that runs
`DamageOverlayUpdateAndDraw`.

**`--no-damage`** on `tools/playthrough.mjs` sets `g_player_no_damage[0]`
(`0x009C9FD8`, the engine's own byte, which `PlayerTakeDamage` reads) and says
so as a cheat on the first line (`L45`).

Note what the gate does **not** test: `g_player_invuln_frames`. The 90-frame
window after a hit stops the damage and nothing else, so the enemies keep
taking their turns through it. That is the engine's answer to "why is there no
pause after I am hit".

### `g_app_state` and `ResolveHit`'s three suppression bits

`g_app_state` (`0x009C8E98`) was `[open]` in `PROGRESS.md` and the port sat at
**0** with a comment saying every clause that read it was inert "because the
port has no attract mode". The comment was a guess about what 0 meant, and it
was wrong twice over.

**6 is the in-play state.** Two proofs:

* `FUN_00414FC0`, the start press that spends a credit, calls
  `RequestAppState(6)` (`FUN_0040E850`) and puts the player into play.
  Pressing Start *is* the transition into 6.
* `CommitAppState` (`FUN_0040E860`), the only writer, ends with
  `if (pending < 6 || pending > 7) g_player_state = 9` for both players — so 6
  and 7 are the only two states it leaves a live player in, and 7 is the arm
  `FUN_00460530` requests when the continue countdown expires.

That matters because `ResolveHit` (`FUN_00409430`) raises
`obj+0x34 |= 0xE00` on whatever it hits whenever `g_app_state` is **not** 6,
and the three bits stop the model swap, the dismemberment and the hit result
respectively. Transcribed literally against a `g_app_state` of 0, that would
have set all three on every enemy on its first hit and taken the gore out of
the entire game — a far worse bug than the one being closed. So the port now
sits at `AppState.InPlay`, and the OR is inert here exactly as it is in the
engine while a stage runs.

**One of the three fires in play anyway**, which is why they are modelled and
not just written down. `ActorFlag.NoDismember` (`0x400`) has four other
writers, and 68 shipped class-0x30 spawns carry it in `init_flags` — 7 in
stage 1, 27 in stage 2, 22 in stage 3, 12 in stage 4. Those actors take damage
and die normally and **do not come apart**, which the port did not do before.
`NoPartSwap` (`0x200`) and `NoHitResult` (`0x800`) have no in-play writer at
all: no shipped spawn record carries either.

`docs/formats/combat.md` §4 has the bytes.

**And it is wired into the claim now.** `TryClaimAttackSlot` used to leave the
gate out on purpose, and the reason was good at the time: the port's
`IsPlayerAttackable` tested `g_player_lives` alone, so calling it there would
have stopped every enemy attacking once a player was out of lives. Two things
changed. `g_player_lives` floors at one, so that clause can no longer fail; and
the function now tests the scene state, which is exactly the clause that
belongs there. The engine's shape is kept — pick a player, void the pick if the
gate refuses, and claim only if it survived, with no retry on the other player.

Of the eight engine functions that call it, the port has modules for four and
all four now do: `TryClaimAttackSlot`, `ThrowerTryClaimAttackSlot` (which
delegates), the two scripted attackers through `ZombieScriptedPickPlayer`, and
`ThrowerStateGrabPlayer`. The rest are `ThrowerStateLeapStrike`, which no
shipped spawn can reach, and three calls in classes with no module.

### Being hit shows the game's damage overlay

A hit used to take a life and a hundred points and put nothing on the screen.
The exe draws one of eleven full-screen sprites out of `pol/common.bin` --
claw marks, a slash, a swipe, a gash, a splat, a bite ring -- chosen by
`PlayerTakeDamage`'s third argument, which the port had been storing -- as
the "hit motion", its name then -- and never reading. It is
`g_player_damage_overlay_kind` now, and the bundle's attack field
`overlay_kind` (format 10). It is ported as the engine has it,
in `game/effects/damage_overlay.ts`:

* the player's update calls `PlayerRunCameraHook`, whose hook the scene
  state's installer chose -- the overlay spawner under every `cam/` path camera
  (2/4..2/7), the body draw under the follow and no-op cameras (1/1, 1/2) --
  and the spawner reads the latch and calls `DamageOverlaySpawn` with the kind;
* `DamageOverlayUpdateAndDraw` keeps it up, **unchanged, for 59 frames** --
  there is no fade, flash or animation anywhere in the chain -- and plays the
  hurt voice on the fifth; a hit while one is up shows nothing new;
* `UpdateScreenShake` clears the latch and computes the 48-frame nod.

`render/effects.ts` draws it in camera space at `z = -1.02`, scale 0.02, from
the record alone, so a load or a seek shows whatever the restored state says.

**It is opaque, and that is the game** (checked 2026-09-28 against a report
that the marks should be translucent). The exe draws it with the plain
`AssetDrawSlot`, which hands the model no alpha; each of the eleven is one
translucent-pass `SRCALPHA / INVSRCALPHA` mesh at base alpha 1.0, so the
alpha on screen is the texture's -- 0 round each mark, 255 over most of it,
a 4-bit feathered edge between. The port's node keeps the template's
material untouched and draws exactly that: `tools/hurt_alpha.mjs` measures
the on-screen alpha off two in-step driven runs (one with the overlay left
out of the shot frames), and reads 66.5% of stage 2's slash pixels at alpha
exactly 1.0 against 65.4% of texture 28's covered texels at 255, identical at
57 and 30 frames left. `render.test.ts` pins the draw (template material,
the pass, opacity 1, the same draw on all 59 frames) and
`verify_texture_alpha.py` pins the exe side and the bundle's images. What
does differ is the **colour**: the exe lights the model under the scene's
default light and the port draws every effect unlit, so the port shows the
texture's own orange where the game may tint or darken it
(`docs/formats/combat.md`, *How opaque it is*).
The eleven models ride the `slots_effect` rig (slots 0x931..0x93B), so
**a bundle exported before this has none -- re-export.**

Checked in the page with `tools/damage_fx.mjs`: a zombie's swipe (kinds 0 and
1, stage 2's `znkage`), the bats' bite (kind 9, stage 4 block 0) and the stage-3
axe (kind 4), each screenshotted with the overlay up, held through a pause,
and gone after loading a snapshot taken before the hit.

**The nod** is applied too (`game/camera/shake.ts`): `UpdateSceneViewAndLight`
re-aims the active camera block at `(0, g_screen_shake_pitch, -1000)` in its
own un-rolled frame before the view is built. The port does the same at the
end of `GameUpdate`, into `g_camera_block_view_target` beside the block, and
`render/camera.ts` only reads it -- so a no-tick frame draws what the tick
before it drew, and a reset, which zeroes the pitch, falls back to the block. It does not accumulate: every camera routine that runs in play
re-derives the block's angles from its eye and target each frame, and the nod
never touches either. In the page a hit swings the view about 4.4 degrees peak
to peak in its first six frames (`tools/damage_fx.mjs`'s `-nod-*.png`).

**Draw order.** The exe sorts its translucent queue by draw layer, ascending
(`RenderCommandCompare`), so the overlay (layer 0xA) is drawn *under* the
muzzle flash and tracer (0xC) and the sprite effects (0xE). The renderer
does the same with `renderOrder` 899 against their 900.

`PlayerTakeDamage`'s second argument -- 0 at the strike sites whose striker
has `obj+0x34` bit `0x2000000`, meaning no overlay and no shake -- is not yet
in the port's signature; that is the exact `PlayerTakeDamage` port's.

### `ResetSceneOnEnter`, and the three blocks it zeroes

`ResetSceneOnEnter` (`FUN_0045EDD0`) is what a scene starts clean, called from
the scene load (`FUN_00460030`) which `ResetGameOnStart` (`FUN_0045FEF0`)
reaches at the start of a run. **The nesting is the point**: the run totals are
zeroed there and the per-scene ones here, which is what makes
`g_civilians_rescued_total` a run figure and `g_civilians_rescued_by_scene` a
stage one. The port's `ResetGameGlobals` now calls it, in that same shape.

Three blocks of it were `[open]` and are not any more:

* **`g_civilians_seen_by_scene`** (0x009C9100) and
  **`g_civilians_rescued_by_scene`** (0x009C89C0) — `u16` per scene.
  `CivilianInit` raises the first beside `g_civilians_alive` and the run total
  `g_civilians_seen_total` (0x009A21BA); `CivilianRunScript`'s op 0x2C raises
  the second as it pays the 400-point rescue, beside
  `g_civilians_rescued_total` (0x009CA0EC), and uses the pre-increment value
  with a stride-10 index — `scene * 10 + rescues` — into a per-rescue table.
* **The per-player triple** at `g_head_combo_bonus` (0x009A5C82),
  **`g_player_shot_count`** (0x009A5C84) and `g_player_hit_count` (0x009A5C86),
  stride 0x130. The middle one was unnamed;
  `EvtOpAwardAccuracyBonus2B` (`FUN_0045FE40`) pays
  `g_accuracy_bonus_table[(hits * 100 / shots) / 10]` to any player in state 5
  with more than 0x13 shots, so it is the accuracy **denominator** — and
  distinct from `g_nPlayerFired` (0x009A5C78), which is a per-frame "the
  trigger is down" flag rather than a tally. Zeroing all three per scene is
  what makes the accuracy grade a per-stage one.
* **`g_hit_slots`** (0x009C88C0) — already named: the 14-slot table
  `ActorClaimHitSlot` (`FUN_00409270`) claims and `ActorFreeHitSlot`
  (`FUN_004092D0`) releases, with the slot index at `obj+0x3C` and `obj+0x38`
  bit 6 saying it holds one. `ActorDespawn` frees it on the way out.

The port zeroes **seven of the thirteen** things the engine's body does, and
the doc comment on `ResetSceneOnEnter` lists all thirteen with a tick or a
cross against each. That is deliberate: a partial transcription that says which part
is a work list, and one that does not is a lie waiting to be believed — which
is exactly how `LEAP_LAND_MOTION` got its name. The six crosses are the
shutter, the backdrop and rain flags, the scene light block, the loader calls,
`g_hit_slots`, and the two per-scene civilian tallies; none has a counterpart
in `G` yet. The firing gate was the seventh until the trigger started honouring
it — `g_nFiringGate` is in `G` now, and this is where it goes back down.

`ResetGameGlobals` keeps its own name and its own job — emptying the object
pools and the camera, which the engine never needs because its pool is a fixed
array it walks. It is not an exe function and no longer pretends to cover one.

### The two enemy counters are stepped, not derived

`g_enemies_alive` and `g_enemies_present` are what 488 enemy gates wait on —
434 of `wait_enemies_alive` (0x44) and 54 of `wait_enemies_present` (0x43) —
and the port used to **recount them from the pool every frame**
(`SyncDerivedActorCounts`, now gone). That is a different quantity from the
one the engine keeps, and the differences are the whole point of the counters:

* **An actor can be alive and deliberately uncounted.** `EnemyZombieInit`
  (`FUN_00452DA0`) counts a zombie into both — but only when its character type
  is not 9 *and* its initial state is not 31. State 31,
  `ZombieStateWaitScriptFlagThenEnter`, counts itself in when its script flag
  comes up, which is exactly what makes those four stage-2 spawns invisible to
  the gates until the script lets them in. Derived from `visible`, they were
  counted from frame one and the state had no effect at all.
* **A corpse is present but not alive.** The alive count falls at death, in
  `ZombieReleasePermitAndUntrack` (`FUN_004565A0`); the present count falls
  when the death clip ends, in `ZombieEnterCorpseState` (`FUN_00456740`).
* **...so a death clip the bundle does not carry holds the present count for
  ever.** `ZombieStateDeathFallAndBounce` (`FUN_00456DF0`) — state 12, where an
  actor that dies still holding something goes instead of straight to the
  corpse — waits out `obj+0x19C >= 0x3C` on clip `0x3F9`, whose real play
  length is 85. `0x3F9` was baked for no character type in any of the twelve
  bundles, so *nothing in the port could leave state 12 anywhere in the game*.
  All six of the clips `ChooseDeathMotion` (`FUN_004560B0`) can reach above the
  directional pick now travel — `CLASS30_DEATH_CLIPS` — and
  `tools/verify_death_clips.py` reads them back out of the real bundles, 14,472
  of 14,472 (spawn, death clip) pairs. The condition-4 pair in that set,
  `0x404` and `0x41A`, is why stage 2's twenty `znkager` crawlers had no death
  animation at all: a clip with no frames has play length 0, and
  `cursor >= play - 1` is true on the actor's first dead frame.
* **Each release is latched, once per actor.** `ReleaseEnemyAliveCount`
  (`FUN_00456560`) tests `obj+0x38` bit 1, `ReleaseEnemyPresentCount`
  (`FUN_00456580`) bit 2 — and class 0x31 latches the same two facts in
  `obj+0x136C` bits 0x800000 and 0x1000000 instead
  (`ThrowerRetireFromAliveCount`, `ThrowerRetireFromPresentCount`). Six
  routines call the class-0x30 pair and more than one can reach the same
  actor; without the latch the count goes negative and a gate opens early.

All of that is in `game/combat/counts.ts` now, and
`web/tools/lifetime.mjs` asserts the two things that can go wrong: no counter
ever goes negative, and killing every enemy in a block drives the alive count
to zero and lets the walker advance. Across 115 block starts in the six stages,
both hold; the room clears in one frame every time.

**The corpse window is a death clip long again, and this divergence is
closed.** It said the port had no class-0x30 death state and that both of its
releases therefore landed on the same frame. That stopped being true when
`ZombieStateDeath6` (`FUN_00454D20`) was ported: it and
`ZombieEnterCorpseState` (`FUN_00456740`) are both in `class30/death.ts`, so
`ZombieReleasePermitAndUntrack` drops the alive count as the death state opens
and the present count comes back when the clip ends, which is a clip apart and
is what the exe does.

The tag outlived the work it described, which is the failure mode of a
divergence recorded in prose: nothing checks that a declared departure is
still a departure. It was found by a session reading this file for something
else. The old derived behaviour had that window at *infinity* — a shot zombie
stayed `present` for ever, so none of the 54 present gates could ever open —
and that history is why the entry is rewritten rather than deleted.

### The room-clear gate answered on the frame the spawn ran

Two reports, one mechanism. **B4**: "camera doesn't seem to wait for zombies to
die before advancing". **B8**: at stage 1 block 4 step 4 op 28, "the two later
of three zombies that drop from the high ledge don't seem to pause the camera —
the game advances while the two are dropping (maybe a race condition?)".

It was a race, and the two halves of it are these.

**The engine's wait opcodes never answer on their first frame.**
`EvtInterpreterLoop` runs `do { dispatch[*pc](); } while (g_evt_yield == 0)`
and does not clear the flag at entry, so every wait handler but `0x40` opens
`if (g_evt_yield == 0) { g_evt_yield = 1; return; }` — the frame the
instruction is *reached* ends there, with the condition unread.
`EvtOpWaitEnemiesAlive44` (`FUN_0045FC10`) costs one frame more again, for
`g_evt_wait_alive_hysteresis` (`0x007DCCA8`), which it requires above zero and
only ever zeroes on a pass. The port had no yield: `applyWait` read the counter
and could walk straight through on its own frame.

**And the port's actors are made one tick later than the instruction that
spawns them.** `EvtOpSpawnObj0B` reaches `EnemyZombieInit` (`FUN_00452DA0`)
inside the opcode, and the two `INC`s are on its straight line — the count is
up before the interpreter takes another instruction. The port pushes the spawn
onto `Walker.spawns` and builds the actor in `syncCharacterSpawns`, which
`app/main.ts` calls *after* `walker.tick()` returns. So for the whole of the
tick that ran the spawn, the counters still say zero.

Stage 1 block 4 step 5 puts the two together: `spawn_placed`,
`set_script_flag`, `spawn_obj` — two class-0x30 on the ledge at y = 61 —
`queue_event`, `wait_enemies_alive 0`, with nothing between the spawn and the
gate. Every one of those ran in a single tick, the gate read zero, and the
block advanced while the pair were still falling. Block 4 step 4's op 28 (the
address in the report) and step 1's two gates have the same shape. What made it
look like the enemies were at fault is that they are not: a dropper is in both
counters from its `Init`, throughout its descent — `test/port.test.ts` asserts
that, because ruling it out is what turned the search towards the script.

Both are now transcribed. Every wait rule models the yield by never passing
from `WaitRule.enter` -- a condition the client cannot hold on is a `yield`
policy that spends the frame and passes on the next visit -- and `0x44`
carries the hysteresis in `G.g_evt_wait_alive_hysteresis`. `0x41`, `0x42`,
`0x45` and `0x47` were the last to take it, with the camera's action ring: a
wait that passed on sight let the `goto_scene_state` behind it park the slot
before the camera actor had run the `finish_sequence` in front of it.

**And they are two counters.** `EvtOpWaitEnemiesPresent43` (`FUN_0045FBC0`)
reads `g_enemies_present`; `EvtOpWaitEnemiesAlive44` reads `g_enemies_alive`.
One `WaitRule` claimed both opcodes and answered both with the alive count, so
the 54 present gates opened as soon as the last enemy died rather than when the
last corpse finished — collapsing the single distinction the game keeps two
counters in order to make. `WalkerHost` now has `presentEnemies()` beside
`aliveEnemies()`.

### An actor that removes itself was rebuilt on the next frame

`SpawnFromDescriptor` (`FUN_00408A20`) builds an object when the spawn opcode
runs and calls its class `Init` there and **once**. `ActorDespawn` frees it,
and nothing recreates it — the opcode has already run.

`CharacterLayer.syncSpawns` did recreate it. An actor that despawns itself
fails its `!despawned` test, is released back to `pending`, is still listed in
`Walker.spawns`, and is therefore made again on the very next frame — running
`Init` again and restarting its state machine from its descriptor's entry
state. So it lived its whole life over and over: a civilian on its removal cue
was rebuilt **1784 times in 90 seconds**, and stage 2's stationary thrower
threw its axes nineteen times. Every self-despawning actor was affected —
the captor states, `ZombieReleaseAndDespawn`, class 0x10's removal, and class
0x30's state 23.

The layer now remembers which spawns are *spent*, and clears that only when the
script stops listing the `at` — so a route that re-enters a region still places
it a second time, which is what the release path is for.

`web/tools/lifetime.mjs` is the harness this needed and the other five did not
have: it drives the real `Walker` and mirrors `syncSpawns`' own bookkeeping
with no renderer attached, and asserts that each spawn's `Init` runs once and
each entrance state is entered once. Every other harness builds its actor by
hand, which is the state machine and **not the object lifetime** — the gap both
of these bugs lived in. 115 block starts across the six stages now drive clean.

### The burst-out leap, and the clip that is not a landing

`ZombieStateDelayedLeap` (state 26, fourteen spawns) rides a ballistic arc to a
point its record names, and **the arc is the only thing allowed to move the
actor**. The engine enforces that: `obj+0x34` bit 0x4000, the pose freeze, is
up for the whole flight and comes off only for the last `0x15` frames, so the
jump clip contributes no root motion while the parabola owns the position. The
port had no freeze, so 0x3BB's translation was applied *on top of* the arc
every frame and the actor sank past its destination and through the floor.

And **`0x3F7` is the limp of a corpse shot out of the air, not a landing.** The
engine plays it only on `hp < 1`, mid-flight. The port had the test inverted
and played it for a live actor as it touched down — which is the "gets up from
a seated position" in the report: the slump, played on someone who is not dead,
and then stood out of. A live actor plays **no** landing clip; it keeps the
jump clip and holds on its tail for `play_length - rand() % 30 - 1` frames.

`web/tools/leaps.mjs` measures all fourteen against their named point. Three of
them — stage 1's, the ones whose record sets `obj+0x34` bit 0x1000000 — take
the wind-up clip 0x399 and land well below the point *by construction*:
`ActorArcBeginFalling` solves the parabola from where the actor stands, but sub
2 then coasts to play-frame `0x1A` and accelerates to `0x23` before sub 3 even
starts the frame countdown, and `obj+0x1330` is never decremented in sub 2. So
the fall runs about `0x23` frames longer than the solution. That is the
engine's arithmetic, not a port bug, and the harness checks that arm for
landing at all rather than for landing on the point.

`[diverges]` **The port guards `g_carrier_object` where the engine does not.**
This used to say the port had no rideable object at all; class 0x33 selector 1
is ported now and `g_carrier_object` is live in the three stages that have one.
What is left is the guard itself: the engine dereferences the global with no
null test — `0x0045E781` in `ZombieAttachToCarrier` and `0x0045EAFE` in
`ZombieStateDelayedStrikeInPlace` — and the port cannot, because `ActorByAt`
returns `undefined` and there is no pointer to follow. Three sites take a
no-carrier arm: state 29 hands over immediately rather than parking six spawns
for ever, state 32 never takes its give-up branch, and the seat below is
skipped so the actor keeps its descriptor offset. All three are unreachable in
the shipped data, because every spawn that reads the global is in a step that
has already made the carrier; each is pinned by an assertion in
`web/test/port.test.ts` rather than only by this paragraph (`L26`).
`Class26Subtype2Update` (`FUN_0048EAD0`), stage 3's boat, is the one remaining
unported writer.

### The entrance a shot may not interrupt

**A stagger is refused by a flag, not by a state.** `ActorPlayHitReaction`
(`FUN_004544C0`) opens with `004544D8 TEST dword ptr [ESI+0x34], 0x10002000`
and returns on either bit: `0x10000000` is *mid-attack* — the throw and the
maul raise it — and `0x2000` is the **no-hit-reaction latch**, held by every
routine that owns the actor's body for a stretch and cleared by each of them on
the way out.

`ZombieStateEmerge` is one of them, and the whole entrance is inside its span:
`00458532 OR DH, 0x21` in sub 0, `0045869F AND DH, 0xdf` on the hand-over to
`AttackRun`. The `0x21` is one instruction and two bits — `0x100` is
`ShotImmune`, dropped by `004585EC AND EDX, 0xfff6feff` as the emerge clip
starts, so the submerged half of the entrance also chooses no death state,
while `ZombieOnShot` still lets `DispatchHit` charge the damage first.

The port had neither the gate nor the raise, so a zombie climbing out of the
water or the ground stumbled out of its own entrance clip on the first shot.
Both halves are transcribed now, each on the line with the address that writes
it. **The bit had been named `ArcSpent`** after the one thing class 0x31's fall
states get from it; it is `ActorFlag.NoHitReaction` now, which is what its two
readers — `ActorPlayHitReaction` and `ThrowerOnShot` — actually do with it.

### A zombie cannot be staggered out of its own attack

The other half of that mask is raised by the **strike itself**, and the port
had never raised it. `ZombieStateStrike`'s sub 0 opens with one
read-modify-write of `obj+0x34`, before it draws an attack —
`00455a93 AND CH, 0xfe` / `00455a96 OR ECX, 0x10000000` — and nothing on the
melee path lowers the bit again until `ZombieStateBackOff`'s first frame
(`00455ca1 AND ECX, 0xefffffff`, in the same write that raises `BackingOff`).
So from the pick, through the lunge and the whole swing, **a shot takes its hit
points but plays no stumble**; the ways to stop an attack are to kill the
zombie or to shoot off every limb its entry's cancel mask names, which whiffs
it in `ActorStrikeConnect`. In the port, every strike could be cut short by a
stagger. The same bit is half of `ZombiePushOutOfWorldAndActors`' `0x18000000`
test, which the port had transcribed as "the airborne bits" — a zombie in its
strike is shoved out of a crowd, and shoves a chair, 1.8× as hard.

`ActorPlayHitReaction` also carries a `state 3 && sub 2 → BackOff` arm behind
the gate — a shot ending the swing — which the gate makes unreachable for
class 0x30: every entry to state 3 writes sub 0, and sub 0 raises the bit.

### What a death throws up, what a corpse leaves, and what a landing sounds like

Five `[diverges]` notes said class 0x30 drew none of this; it draws all of it
now, from the exe's own routines (`game/class30/death_effects.ts`):

* **The death clip's cue frames.** `ChooseDeathMotion`'s tail,
  `ZombieInstallDeathEffectCues` (`FUN_004563F0`), points `obj+0x13A0` into
  `g_zombie_death_effect_cues` (`0x005930AC`) -- one list per directional
  death `0x3D9..0x3E0`, an empty one for every other clip -- and
  `ZombieDeathEffectCueTick` (`FUN_004569B0`), `g_class30_states[0x37]`, runs
  every frame of state 6 and fires when `obj+0x19C` equals the next cue. Dry
  and no rain: sprite kind 0x46 (`common.bin` 25..39) on the traced floor,
  stretched `(0.5, 1.5, 1.5)` through `SpawnSpriteEffectFromParamsThunk`
  (`FUN_004073A0`). Wet (surfaces 5, 0x37) or raining: kind 0x61, the
  `SIBUKI` splash strip, and on water two `SpawnWaterRing`s (`FUN_004567C0`)
  once per death.
* **The landing.** `ZombieDeathLandingEffect` (`FUN_00456B70`),
  `g_class30_states[0x38]`, is called by states 9, 12, 26 and 30: once per
  latch (`obj+0x136C` bit 0x10000), a splash and two rings on water, a splash
  in the rain, dust otherwise. Its trace moves `g_coli_hit_surface`, which
  state 9 reads again straight after.
* **The ring task under the corpse.** `SpawnGroundRingEffect`
  (`FUN_00407DA0`) is the first call of both corpse states and of class 0x20's
  hand-over into its sink. It allocates the ring task `game/effects/
  ring_effect.ts` already ran for the fish -- a red pool that opens over 120
  frames, holds 30 and fades over 39 -- at the **tracked bone's** `x`/`z`
  (`obj+0x100`), and at the traced floor only when `obj+0x1F8` bit 4 is up:
  `EnemyZombieInit` raises it (`MotionFlag.TraceGround`), class 0x20 does not.
* **The landings' sound and shake.** `ZombieStateArcScriptedEntrance` and
  `ZombieStateDelayedLeap` land with `COMMON\ENE_WALK7_22.WAV` after the landing
  hook, or -- body condition 5 -- `COMMON\DAMAGE3_22.WAV` and
  `g_screen_shake_frames = 0x20` in its place; the leap then plays the attack
  cry. The shake is the one global the engine writes; `UpdateScreenShake`
  already turns it into the camera's nod.
* **`g_rain_enabled`** (`0x009C8E50`) is a `G` global now: `EvtOpEnableRain1D`
  stores its operand, `ResetSceneOnEnter` zeroes it.

Three wrong ports inside the same routines went with it: the arc entrance's
crouch is **blended** in (fade 5) where the port cut to it; its sub 3 and its
exit clear the landing latch, `0xfffeffff`, where the port cleared the carried
bit one hex digit over; and `ZombieStateDelayedLeap` landed in silence.
`web/tools/death_fx.mjs` kills what is on screen and photographs each effect;
`--staged` puts one of each in front of the camera.

### What the ground does under a thrower

Class 0x31 had none of its ground effects; `ThrowerEmitGroundDust`
(`FUN_0044D260`, `game/class31/ground_dust.ts`) is ported and called from all
three of the exe's call sites, which took `ActorArcStep`'s last `[diverges]`
with it:

* **The bounce** (`ThrowerStateFallAndLand`, code 0x46). Once per landing --
  `obj+0x136C` bit 0x4000, which the port cleared as the body settled but
  nothing set -- a kind-0x46 dust sprite at the body, or the 0x61 splash in the
  rain or on surfaces 5 and 0x37. It works out the floor's tilt with
  `VecAimYAxisZThenX` (`FUN_00401870`, newly named) and then has the sprite
  face the camera, which throws the tilt away. The bounce also thumps now:
  `COMMON\ENE_WALK4_16.WAV` (`0x2716A9`) on **every** bounce, which the port
  never played.
* **The arc's landing** (`ActorArcStep`, code 0x50). A thrower of type
  0x16..0x19 landing with `obj+0x34` bit 0x20000000 up and 0x10000000 down
  raises a narrow column of dust, kind 0x4B stretched `(0.4, 2.0, 0.2)`, or a
  splash in the rain. Then it **falls into** the trail.
* **`zsass`'s trail** (`ThrowerStateStandAndDecide`, code 0x5A, and every
  0x50). For character type 0x16 while the track holds behaviour set 1's walk
  (read by address, `PTR_DAT_005929F4` = `g_class31_motion_sets[1]`): on the
  walk's footfalls, cursor 0x19 and 0x32, or on any frame out of state 7, it
  lays two scuffs across the step since `obj+0x13E4` -- a quarter-turn each
  side of the line walked, as wide as the step is long times 0.0598 -- and
  moves `obj+0x13E4` up to the actor. They are splashes on water.

The stand's port returned early from two of its three exits, the re-arm and
the fall; the exe runs all three -- those two and the router -- on to
`0x0044B3B2`, which is where the trail call is, so the port does too.

## A cross-fade dissolves from a still, and holds the new clip

Emerging zombies in stage 2's block 16 finished their climb out of the water,
sank back into it for a few frames, and stood up again. Nothing in the game
state moved -- `y` was the same on every frame of the hand-over -- and the
cause was the one thing every blended clip change in the port shared.

`ActorSetMotionBlended` (`FUN_004119A0`) does not keep the outgoing clip
running. `MotionStartOnTrack` snapshots the pose **last drawn** into slot A
(`MotionLoadPoseSlot`, `FUN_00411C20`, mode 0xC), loads the incoming clip's
**start frame** into slot B, and raises `track+0x37` bit 0. While that bit is
up `SkeletonAdvancePlayCursor` (`FUN_004111A0`) does not recompute the cursor,
`SkeletonPoseRootFrame` draws A lerped to B by `(counter - track+0x28) /
track+0x30` (`fade + 1`), and `SkeletonApplyRootMotion` resets its baseline
each frame so nothing walks the actor. When the counter passes the fade the
cursor is rewritten to `start + 1` and the clip plays on. `[proved]`

The port ran the outgoing clip's clock through the fade and started the new
clip moving at once. For a looping clip the difference is a few frames of
timing; for a one-shot on its last frame it is the whole bug, because the
poser's `% frames` wrapped the still-running clock back to the clip's **first**
pose -- and frame 0 of an emerge clip is the crouch under the surface. Now:

* the outgoing clip is a still -- `fadeFrom.ticks` is not advanced;
* the incoming clip is held on its start frame for `fade + 1` frames, with no
  root motion, and moves on from the frame after it;
* the weight runs `1/(fade+1) .. 1`, as the engine's does.

**That is a timing change for every blended clip in the game**, and it is the
engine's: a state that waits on a cursor frame of a faded-in clip now waits the
fade out first. Two port tests had bounds tuned to the old clock -- the
stationary thrower's release inside 12 frames and a death clip's 58 ticks --
and both now carry the fade in front, with the routine cited. `ZombieStateEmerge`
itself also moved closer: both its clip changes are `ActorSetMotion` cuts, its
sub 0 falls into sub 1 on the same frame, it never froze the pose, and a
`tail+0x03 == 1` spawn is undrawn (`ActorSetPartVisibility` 0, the port's
`alpha`) until its clip starts.

## What a bone draws, which is not its draw slot

**Done for nine of sixteen arms**, and the reason a shot `char_adv02` had a
hole where its midriff should be. A bone's draw record names one slot and
`AssetDrawSlot` draws one model for it — and for class 0x30 neither of those
decides what appears, because `SkeletonEmitNode` (`FUN_004114C0`) calls the
per-bone hook at `model+0x1158` instead of the one-slot draw, and
`EnemyZombieInit` (`FUN_00452DA0`) puts `ZombieDrawBonePart` (`FUN_004534A0`)
there. That routine switches on the slot the bone is *currently* drawing and,
for sixteen of its arms, draws something else or something more.

* `game/class30/bonecels.ts` carries the nine arms that are nothing but a
  **phase** — `g_blink_frame_counter + obj+0x3C * 10`, indexed into runs of 5,
  18, 20, 30, 50 and 120 models — with the instruction address of every base
  and count, and lists the seven that are not with what each needs.
* `render/characters/cels.ts` draws them: one node per run per bone, refilled
  from the cel's template each frame rather than re-cloned, since every cel in
  a run is the same topology with the same materials.
* `hod2lib/charbuild.ts` exports the runs a character's own trigger slots
  reach, so a bundle carries no cel it cannot draw.
* `game/hit_slots.ts` is `obj+0x3C`, which had been recorded as not ported:
  `ActorClaimHitSlot` (`FUN_00409270`) and `ActorDespawn`'s release, for the
  eleven classes whose `Init` is a proved caller of `ActorBuildSkinnedModel`
  (`FUN_00410440`). Without it every zombie in a crowd animates in lockstep.

`char_adv02`'s bone 1 is the visible case: the undamaged `0x1B3D` draws a
20-cel chest and a 30-cel lower torso and **never itself**, the two chest-only
damage stages draw themselves plus the lower run, and the three later stages
draw alone because their own geometry already reaches the pelvis.

`tools/verify_bone_cels.py` is the check, and it is the only thing that can
see any of it — no table in the image names these models.

**`[open]`** The seven stateful and extra-matrix arms: `zndina`'s scaled
25-cel run, `znkager`'s fixed second model, the `obj+0x1328` latch three types
share, `char_adv00`'s 60-cel ping-pong, `znjikken1`'s `FUN_00418660` prepass,
and `znele`'s sound transition. `znjoe`'s 120-cel run at `0x1C96` is ported and
is very likely the "missing chest worm" of a separate report. Class 0x31's
`ThrowerDrawBonePart` has arms of the same shape and none of them is read.

### The creature `znjoe` releases, and the frame the arm has to fire on

Shoot a `znjoe` in the chest and something comes out of it. Seven spawns in the
whole game have character type `0x0A` and every one of them is in stage 5 —
evt `0x0A68`, `0x0AF8`, `0x0B24`, `0x2E20`, `0x2E50`, `0x2F58`, `0x2F8C` — and
`ActorReactToHit` (`FUN_004543F0`) is the one place in the image that tests for
it. A **first** hit on bone 1 with result 1 does not stagger the actor: it
scores `0x50`, marks it dead, and drops it into class 0x30 state **25**,
`ZombieStateReleaseBodyCreature` (`FUN_00457FB0`), which no spawn record
reaches.

That state backs the zombie out to its **inner** approach ring, plays clip
`0x1DF` for `rand() % 10 + 0x5F` frames — 95 to 104 — and then, on one frame,
applies the torso's first damage step by hand and calls `SpawnBodyCreature`
(`FUN_0043E720`). What comes out is an object with **no class id**, like the
thrown weapon and the severed head, and it is a **countable enemy**:
`BodyCreatureInit` raises `g_enemies_present` *and* `g_enemies_alive`, so a
room gate has to account for it. It rides the host's bone for a frame, then
flies at the eye along a one-unit half-sine in about twenty-four frames. Shoot
it for `0x50` and it falls one way; miss it and thirty frames after it arrives
it **takes a life**, then falls the other. Either way it drops both counters
below `y = -3` and leaves.

**Its position is in camera space**, which is the whole shape of the routine —
the flight's end is the origin of that space, and in a two-player game it is
`x = ∓0.6`, one gun each. `render/effects.ts` draws it in the same view group
the blood and the muzzle flash hang off.

**The arm fires from `ZombieOnShot`, not from `ResolveHit`, and that is not a
detail.** The bit the arm raises is the one `ZombieOnShot` tests to decide the
actor is dead, and the engine's call site is five instructions *past* that
test. Called at the head of the frame instead, the arm set state 25 and
`ZombieOnShot` overwrote it with the death state on the same frame — every
znjoe died with its chest shut. `L11`.

The exporter had to learn two things for any of it to be visible: the forty
sprite slots `0x1D31..0x1D58`, which are `znjoe.bin`'s own entries 176..215 and
which no skeleton node names, and clips `0x1DF` and `0x1E3`, which reached no
bundle because nothing had named them.

`[open]` A live creature is a **camera candidate** in the engine —
`BodyCreatureUpdate` ends in `RegisterForCameraTracking` — and the port's
candidate list is over `Actor`s, so a record in `g_body_creatures` cannot enter
it and `g_camera_free` does not see one. The point the engine registers,
`obj+0x100`, is written as `g_camera_blocks[cur]+0x00 · obj+0x40` with
`obj+0x40` already in camera space, and that matrix is the world-to-camera one
everywhere else in the image — so what space the registered point is in is
itself `[open]`, and the port writes none rather than guessing.

## Shooting

**Done, for the parts that are exact.** Full account in
[`formats/combat.md`](formats/combat.md); the short version:

* A shot is a **ray from the camera through the crosshair**. `FUN_00406110`
  unprojects with the game's own projection distance — `640.21 = 240 / tan(41.1°
  / 2)` — so the client uses the camera it already renders through and gets the
  identical ray. Range 1000 units, as `FUN_00404AD0` builds it.
* The test walks **the same skeleton tree the renderer uses** and intersects a
  **per-bone sphere** from `PTR_DAT_004D032C` — `{slot, centre, radius}` indexed
  `bone − 1`, copied into the bone's draw record when the skeleton is built and
  moved into view space by the draw each frame, so it follows the animation. A
  zombie's radii read as anatomy: torso 2.55, head 1.3, upper arm 1.4, hand 0.8,
  pelvis 1.75, thigh 2.15.
* **Who is a candidate, and the sphere first — for the classes that register
  the engine's way.** `game/combat/shot_test.ts` ports `RegisterForShotTest`
  (`FUN_00405160`), `ShotTestSphere` (`FUN_00404630`)'s broad phase and its
  fork into the bones, and `MarkActorShot`'s stable 16-bit depth sort. A class
  opts in with `ClassHandler.registersForShotTest` and calls the routine at the
  exe's sites. `ActorRegisterCameraPoint` now carries the call it ends in, at
  `0x00409BED`, which no xref list shows (`L35`). **No class has opted in on
  `main` yet**: the four bosses will, from their own modules, and
  `formats/combat.md` §3 has their sites. Every other class is still picked by
  `render/` the old way: every visible, living actor, no broad phase, nearest
  along the ray. That section lists what converting each one takes.
* Bit `0x80`, the per-bone bit the fork tests, is raised by the skeleton build
  in every skinned `Init` (`SkeletonBuildAndPose`, `0x004105DF`), and the port
  now raises it in `ActorSpawn`. This file used to say no civilian ever had it.
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
* **The trigger is dead while the shutter's firing gate is down.**
  `PlayerFireAndReloadUpdate` (`FUN_00414940`) runs its whole fire block under
  `else if (g_nFiringGate != 0)`, which is one test above the ammo decrement,
  the shot counter, `BuildShotRay` *and* `PlayerShotEffectSpawn` — so a pull
  under a closed shutter is not a shot that misses, it is not a shot, and it
  makes no muzzle flash and no tracer either. The port's `PlayerFireAndReloadUpdate` asks the
  same question in the same place and drops the request rather than holding it.
  Non-zero means *allowed*: state 0 draws the closed bars **and** raises the
  gate, so a letterboxed intro is playable, and state 5 draws the same bars and
  drops it. The **crosshair** follows it, because `HudDrawCrosshair`
  (`FUN_004169C0`) tests the same word before it draws, and so does the ammo
  readout one level up in `PlayerUpdateInPlay` (`FUN_00413E90`). Reload is
  **not** gated — only its sound is. Every shipped stage raises the gate inside
  its first 150 instructions and holds it up for 99.9 % of the script, so this
  costs the player nothing but the cutscenes.

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
**difficulty modifier** at `PTR_DAT_004D0D84` (needs a rank),
**civilians**, and `FUN_004560B0`'s
**special deaths** for a
particular destroyed part (`obj+0x1368` bits → motions 428, 421, 633, 553), so
a character whose arm has come off still plays a directional death.

### The magazine, the reload and the HUD readouts

**Done.** `game/player_gun.ts` transcribes the trigger:
`PlayerUpdateInPlay` (`FUN_00413E90`) polls it once a frame through
`PlayerFireAndReloadUpdate` (`FUN_00414940`), or in Original Mode
`PlayerFireOriginalModeWeapon` (`FUN_00414B90`). What the exe does, all
`[proved]` from the decompile:

* **A shot takes a round**, unless the app state is the attract demo, the
  player has infinite ammo, or an Original weapon's magazine is -1. The shot
  that takes the last one raises the empty latch (`+0x1E`) and zeroes the
  prompt timer (`+0x20`).
* **An empty gun pointed at the screen does nothing** -- no round, no shot
  counter, no ray, no flash, no gunshot, and no reload.
* **A gun reloads by a pull off the screen**, and only that way; a standard
  controller (on PC the keyboard, Right Ctrl) reloads with its binding set's
  reload bit, which the gun's set does not have. The refill,
  `PlayerRefillMagazine` (`FUN_00414B30`), fills to 6 (or the Original
  magazine), drops the latch, and plays `COMMON\RELOAD1_44.WAV` (`0x003E16A9`)
  -- the sound, and only the sound, behind the firing gate. A pull off the
  screen on a full gun does nothing.
* **The page's mouse is a gun**, because `InputMapDevicesToMaple`
  (`FUN_0041E530`) makes the PC mouse one, and its right button is a pull off
  the screen (`MouseGunResolvePull`, `FUN_0041EB30`). So the right button
  reloads, and **R is the port's key for the same pull** -- a key binding at
  the input seam, like S for START, not a change to the game.

`game/hud_readout.ts` transcribes the two draw routines `PlayerUpdateInPlay`
calls for a player with a life outside the attract states, and
`game/screen_sprite.ts` records every `DrawScreenSprite` (`FUN_0041C6D0`)
call into `G.g_screen_sprite_draws` for the HUD layer's 640x480 canvas to draw
from the bundle's images (`script.json`'s `hud_sprites`, textures of
`tex/scr_common.bin`, see `formats/texbank.md`):

* `HudDrawAmmoAndReloadPrompt` (`FUN_004177D0`), only with the firing gate up:
  one bullet (`0xA74`) per round, 24 px apart from (24, 364) for player 1 and
  leftwards from 592 for player 2; in shutter state 1 (opening) scaled
  `(40 - slide) * 0.0125 + 1`, the slide counting up a frame; nothing in any
  other state. Original Mode draws seven or more as one sprite, `x` and two
  digits, and an unlimited magazine as `x` and `0x63`. With the latch up,
  **RELOAD** (`0xA27`, 1.5 wide at (24, 260)) blinks on 45 of every 60 frames of
  the prompt timer, and from frame 120 a second line joins it: "SHOOT OUTSIDE
  OF THE SCREEN!" (`0xA29`) for a gun, "PRESS THE RELOAD BUTTON" (`0xA28`) for a
  controller. **The voice**: on a frame the timer is non-zero, the trigger is
  down and the aim is on the screen -- that is, a dry pull, once per pull --
  `ETC\vo_RELOAD_16.wav` (`0x000115A9`), or for a gun past 120 frames
  `ETC\vo_SHOOT_16.wav` (`0x000215A9`). The same ids for both players. The
  timer steps once a call and folds back to 120 past 600; the shot that
  empties the gun is never nagged, because the timer is 0 on that frame.
* `HudDrawLives` (`FUN_004174A0`), in shutter state 2 only: the "1P"/"2P" tag
  at (28, 412) / (584, 412) and one lamp a life 32 px apart from x = 60 (548
  leftwards for player 2), each a seven-cel flame on `g_frame_counter`, three
  frames a cel and four frames out of step with its neighbour. Original Mode
  with more than five lives draws one lamp, `x` and the count. In state 4 --
  the letterbox shut -- it blinks "HOLD YOUR FIRE!" (`0x5B8`) instead, unless
  a result card has the screen (`g_screen_furniture_flags & 0x10`, which
  `ResultCardInstall` raises for its whole 420-frame dwell).

**What it took elsewhere.** The shutter machine had no per-frame collapse of
its one-frame states 0, 5 and 6 into 4 and 2 (`0x00413A04`..`0x00413A96`,
read off the disassembly the pseudocode walks past); the bars could not show
that, but the readouts could, and a stage that opened with a 6 had no bullets
for the rest of the scene. A **seek** runs no frame, so it now runs the next
frame's player turn on a copy of `G` and keeps only the sprites
(`PlayerTasksDrawWithoutAFrame`) -- a deep link into a fight shows its
readouts while paused. Every harness that clicks at the page pulls through
`tools/lib/player.mjs`'s `pull`, which presses R before every seventh pull.

Verified by `web/test/port.test.ts` ("the gun: the magazine, the reload, and
the HUD readouts"), and in the page: six live shots each play
`COMMON/GUN5_22.WAV`, a dry pull `vo_RELOAD_16.wav`, a dry pull past 120
frames `vo_SHOOT_16.wav`, R and the right button `RELOAD1_44.WAV`, R on a full
gun nothing.

## The letterbox is a task of the scene's, not a part of the script

`HudDrawShutterState` (`FUN_00413970`) is ported whole in
`game/hud_shutter.ts`, and it runs where the engine's task list runs it:
`HudShutterTaskCreate` (`FUN_00413950`) is the eighth call of the scene's
task-list builder, after both player tasks, so `SceneTaskWalk` calls it after
`PlayerTasksRun` and before any actor. evt `0x1F` is one store into
`g_bHudShutterState` and nothing else. See `formats/evt.md` for the frame by
frame.

What that fixed, all inside the one routine:

* **The reset.** `ResetSceneOnEnter` stores 5 in the state and in
  `g_bHudShutterPrev`; the port stored 2, so a freshly loaded stage drew no
  bars on the frame the engine draws them shut. The picture this was held back
  for -- the bars shut on every freshly loaded stage until its script opens
  them -- is the engine's, and every stage's own script writes a 5 before its
  first wait anyway, so the only frame it moves is the first.
* **The order.** The machine used to step at the top of the walker's next
  tick, and the opcode raised the firing gate itself. So a shot on the frame
  of a `hud_shutter_state 6` fired, where the engine's player task has already
  run against the old gate; the slide drew one counter behind; a close dropped
  the gate a frame early.
* **The picture.** `hud/hud.ts` turned a state and a counter into bars, and
  drew the shut states 0, 4 and 5 from the slide counter, which a finished
  open leaves at 40: a 5 after a 1 with no close between drew **no bars at
  all**, where the engine draws them shut at 0.35 whatever the counter says.
  The six stages have thirteen such 5s inside a block alone. It draws what the
  routine recorded now (`G.g_hud_shutter_bars`), so a shut state is shut, a 7
  draws nothing on its frame, and the chapter and result cards'
  `g_screen_furniture_flags & 0x30` hide the held bars (classes 0x60 and 0x61
  write those bits).
* **A seek or a paused load** runs no frame, so the next frame's bars are drawn
  on a copy with the readouts (`PlayerTasksDrawWithoutAFrame`).
* **The frame the bars are a tenth of** is the rendered view. Pillarboxed in a
  window taller than 4:3, the canvas is a centred 4:3 box shorter than the
  viewport, and the bars were measured off the viewport: they covered the
  box's black margin and a sliver of the picture. They sit in a `.hud-frame`
  that is that box now (`ui/panels/Viewport.tsx`), and in the whole viewport
  unboxed, where the fixed vertical FOV spans it.

Pinned by `test:port`'s "the shutter frame by frame" section, driven from
`ResetGameGlobals`: each of the reset, the order, the slide's timing, the card
flags, the 7 and the no-frame draw fails its own assertions when reverted.

## Scripted scenery: doors, shutters and vans

### Class 0x33 selector 4 — the scenery an actor shoves aside

**Ported** (`game/class33/pushable.ts`), and it is the answer to a bug report
that looked like an animation fault.

Stage 1's `0x16D8` `char_adv00` was reported as "playing the wrong entrance — a
ledge hang where a chair push belongs". The clip id was right and so was every
link of the data chain: `ZombieStateWaitCameraFrameThenBranch` plays `tail+0x04`
and waits on `tail+0x08`, which for that spawn is motion 1048 and camera frame
150, and 1048 is a sixty-frame clip in `char_adv00`'s own table whose root
translation wanders at most 0.45 and returns to zero and whose bones sway at
most 27 degrees. It is a **hold**: the pose the state stands in while it waits.
What it was authored to depict is `[open]`.

The chair push was a different class, and the port had three of its four
pieces already. `ColiTestSphereAgainstActors` (`FUN_00405B10`) does not move
the object it finds — it writes the pusher into `obj+0x138`, the penetration
into `+0x13C` and the reversed normal into `+0x140`, and the object applies
that on its own next frame. `game/coli.ts` has written those three since the
crowd separation landed, and `ZombiePushOutOfWorldAndActors` was the only
reader.

```
ScriptedPushableUpdate33      FUN_00433B70   the two flags, the seed, the gate
ScriptedPushableApplyPush33   FUN_00433CE0   the move
ScriptedPushableSyncSphere33  FUN_00433E00   the sphere, re-seated each move
```

`[proved]` Two spawns in the whole game, both stage 1 block 1 step 2: `0x1A40`
at `(22.83, 6.5, -16.74)` and `0x1A74` at `(16.83, 6.5, -20.74)`, each drawing
asset slot 4196 — `komono_7.bin` part 0, which renders as **a chair**. `0x16D8`
stands at `(24, 6.5, -20)` facing `-x`, 7.2 units from the second of them, and
block 1 step 3's `set_script_flag 32` is one instruction before the `spawn_obj`
that makes him.

Script flag 32 is the arming flag. `obj+0x34` bit `0x8000` arrives on the
descriptor and `AND AH, 0x7f` at `0x00433C00` is the only thing in the image
that clears it — and that is also the bit `ColiTestSphereAgainstActors` skips a
candidate on, so **one bit both holds the chair still and keeps it out of the
list the push is found from**. Flag 33 despawns it, and its test is the first
instruction of the routine: a raised flag leaves before the seed, so a chair
that goes never publishes a draw slot.

The move is class 0x30's own arithmetic on furniture — a tenth of the
penetration along the reversed normal, times 1.8 when the **pusher** carries
either bit of `0x18000000` — its strike's commit or the sprint bit, not an
airborne bit — followed by a re-resolve against the actors in x and z
and one against the full collision set at the full depth, with the sphere
re-seated after every move. The sphere convention is this class's own:
`obj+0x130 = obj+0x44 + obj+0x128`, the position plus exactly the body radius,
where `ActorUpdateBoundingSphere` adds the radius plus one.

Measured in the running player at `?stage=1&mode=play&block=1&step=3&op=16`,
camera path 36 frame 159: `0x1A40` has moved from its descriptor position to
`(21.66, 6.72, -16.94)` and `0x1A74` to `(16.31, 6.55, -21.14)`. Both are
drawn, both are armed, and the zombie shoves the near one out of its way as it
charges.

Four things were missing and none of them was the clip id: the exporter emitted
a class-0x33 placement only for selector 1, so the bundle had the two spawn
descriptors and no placement, no props entry and no geometry; `SpawnSlotActors`
then refused them; nothing drew them; and nothing read the three push fields
for anything but a zombie. The bundle carries `class33_push` now, mutually
exclusive with `class33` because the two are two sub-handlers' readings of the
same bytes — `verify_port.py` asserts the exclusivity, that every selector the
script spawns has a placement, and that the draw slot reached the glTF.

**`L35`, and it was load-bearing.** Ghidra ends `FUN_00433B70`'s body at
`0x00433C5C`, on the `MatrixStackPop` call, and the pseudocode ends there too.
The real tail runs to `0x00433CD3` and holds `CALL 0x00405160` at `0x00433CC6`
— `RegisterForShotTest`, the call that puts the object in the per-frame dynamic
list the push is found from. `get_function_callers` on that routine does not
name this function, so the reading available from the decompiler alone is
"nothing can ever find the chair", which would have made the whole set piece
impossible.

Not ported: the mesh shot test on the `tail+0x04 != -1` arm (`obj+0x34 |= 0x50`
and a mesh id on `obj+0x14C`; neither shipped spawn takes it),
`ActorClaimHitSlot`, and the draw itself, which is `render/slotmodels.ts`' —
the same arrangement class 0x52's mouse has, and it is `T · Rz · Ry · Rx` there
rather than the mouse's yaw alone.

### Class 0x33 selector 1 — the carrier, and the two states it ends

**Ported** (`game/class33/`). `ScriptedSceneryDispatch33` (`FUN_00432FF0`) is
eleven objects behind one class id — a switch on `obj+0x11C`, which for this
class is a sub-handler selector and not hit points — and selector 1 is the one
that matters to the gameplay loop, because it is **the** `g_carrier_object`
(`0x009A5C34`). Three spawns in the whole game: stage 2's `0x4FD0` and
`0x12590`, stage 5's `0x1CE4`.

`[proved]` it is a vehicle that drives in on an `op_` path and burns, from its
four sounds: `DRIVE_DEAD2_22.wav`, `DRIVE_DEAD2_22_OFF.wav`,
`CAR_FIRE_22.wav`, `CAR_FIRE_22_OFF.wav` — two loops with their off halves.

The whole of what other classes read is two bits on its own `obj+0x34`:

* `0x10000000` ends `ZombieStateRideCarrier` (class 0x30 state 29), on the
  descriptor's `commit_flag` or `commit_frame`. Stage 2's six passengers ride
  on this, and they now ride rather than handing over on their first frame.
* `0x40000000` ends `ZombieStateDelayedStrikeInPlace` (state 32) `0x14` frames
  later. Stage 5 block 2's four `znnick` leave on this, and that room is the
  one a player could not clear by shooting.

`ScriptedCarrierStepPath33` (`FUN_00433860`) is the ride: `obj+0x1370` is
seeded to `g_cam_path_frame - 1` on the object's first frame and then stepped
by `1.0` per frame, so **it is the object's clock and not the camera's**, and
the two frame cues above are read against it. The pose comes back through
`GameHost.objectPath`, the same seam class 0x25's riders use; a host with no
`op_` paths leaves the object where it is and the counter still runs, which is
what lets a headless run reach the release.

The drawing is not ported and does not need to be — `tools/hod2lib/rigs.py`
already carries it as `obj_4331d0` and the renderer places it. Nor is
`RegisterForShotTest` at `0x004334D0`: stage 2's two are on the mesh shot test
the port has not got, and stage 5's sphere is 0.1 units.

#### The other way of riding it, which is not a state at all

**Three bits of that section were not the whole story.** Class 0x30 has a
*second* carrier mechanism and it sits one level above the state machine:
`ZombieAttachToCarrier` (`FUN_0045E770`), called from
`EnemyZombieInitByCharType` (`FUN_00452FD0`) at `0x00453053` and from
`EnemyZombieUpdate` (`FUN_004533F0`) at `0x00453424` — **before** the state
dispatch, every frame. A spawn whose descriptor sets `obj+0x34` bit 3 has its
position and yaw re-read as **carrier-local**, stashed at `obj+0x13D8` and
`obj+0x135C`, and the seat puts the actor back on the carrier through the
carrier's translate, its yaw and a half turn. It is rigid, where state 29 adds
only the translation, and it applies in whatever state the actor is in.

`[proved]` Exactly four shipped descriptors set that bit, all class 0x30, all
in stage 5 block 2 step 2 op 38 — one op after the car itself:

| evt | descriptor position | state |
|---|---|---|
| `0x1D44` | `(-4.6, 10.0, -16.5)` | 32 |
| `0x1D74` | `(-4.6, 5.0, -2.6)` | 32 |
| `0x1DA4` | `(-4.6, 5.0, 7.0)` | 32 |
| `0x1DD4` | `(4.6, 0.0, 0.0)` | 18 |

Those are offsets up the bed of the car, not world positions, and they are why
this took two reports to find: `ZombieStateDelayedStrikeInPlace` really does
never move an actor, and `SpawnFromDescriptor` really does copy the position
verbatim, so a note in `class30/scripted.ts` concluded from both that standing
at `d≈2870` was correct and "the distance was never the bug". Both premises are
true; the conclusion is not, and `d≈2870` was the distance from the player to
the world origin. **A state that moves nothing is not the same thing as an
actor that does not move.**

Two port names went with it, both `L20`: `ZombieFlag2.SpawnedInAir` was this
bit's flag named for what an offset with `y = 5` looks like from outside and is
`AttachedToCarrier`; `ZombieAux.CarrierOffset` was `obj+0x38` bit `0x20`, which
gates `TurnActorTowardCameraEye(obj, 0x1A0)` in both carrier states and has
nothing to do with the offset, and is `TurnTowardCameraEye`. Neither was
written or read by the port, which is the tell worth keeping: a named flag with
no writer and no reader is a reading nobody finished.


**Done for the hinge family.** The zombies that lunge out of a van in stage 2
are not standing in the open — they are inside it, and the doors swing apart on
a script cue. Two spawn classes make that set piece, and they sit at the same
position because they are two halves of one thing:

* **class 0x33 selector 2** (`FUN_00433A10`) is a **static scripted prop**: one
  model at the spawn's pose, drawn until a script flag is set or the camera path
  reaches a given frame. The van body is one of these.
* **class 0x44** (`FUN_00472B10`) is a **prop placer** dispatching on
  `obj+0x11C` through 18 builders at `0x00595AB8`. Selectors **1, 2 and 4 share
  one child behaviour**, `HingeUpdate` (`FUN_00473CF0`) — 53 of the 123
  class-0x44 spawns — and that behaviour is a hinge.

The hinge, per frame:

```c
if (remove_flag >= 0 && g_script_flags[remove_flag]) despawn();
if (g_script_flags[open_flag]) {
    f = frame++;                       /* stops at 60, or 130 on curve 4 */
    obj.rz = base_rz + curve[f].rz;                    /* never mirrored */
    if (side > 0) { obj.rx = base_rx + curve[f].rx; obj.yaw = +ftol(ry * s); }
    else          { obj.rx = base_rx - curve[f].rx; obj.yaw = -ftol(ry * s); }
}
Translate(pos); RotY(base_yaw); RotZ(rz); RotY(swing); RotX(rx);
```

Two Y rotations with a Z between them: the **mounting** angle and the **swing**
are separate, which is what lets four baked curves serve doors hung at any angle,
and `side` mirrors the swing so one curve opens a pair outward.

### `side` is a sign, and the doors that spun proved it

**This was wrong for as long as the layer existed, and it is worth the space.**
The pseudocode above used to read `obj.rx = base_rx + side * curve[f].rx`, and
`render/props.ts` transcribed that faithfully. It is not what the exe does.
`side` is `obj+0x1DC`, and `HingeUpdate` (`FUN_00473CF0`) reads it in exactly
two places:

* `TEST EAX,EAX; JLE` at `0x00473EE6`. The two arms differ only in `ADD ECX`
  vs `SUB ECX` on the X angle and a `NEG EAX` on the yaw — a **sign test**.
  Neither magnitude nor scale reaches an angle.
* `IMUL EAX,[ESI+0x1DC]` at `0x00473FB5` — the amplitude, in BAMS, of the
  damped yaw wobble a prop does when it is **shot**.

So the field is a wobble amplitude whose sign doubles as the mirror.
`PropBuildVanDoors` (`FUN_00472C90`) hands the van's two doors a literal −1
and +1, which is exactly why it looked like nothing else; selectors 1 and 4
read an authored `i32`, and
**four of the game's 56 hinges carry ±512 and ±416** — `prop_06dc_0`,
`prop_0724_0` (curve 0, 512) and `prop_3758_0`, `prop_37a0_0` (curve 3, 416),
all in stage 1, all pairs.

Multiplying by those put up to **6,765,568 BAMS — 103 turns — on the X axis of
a door**. And it read as *"spins at the end of the swing"* rather than *"opens
to the wrong angle"* because of the shape of the curves: the yaw does 95 % of
its travel by frame 12, and `rx`/`rz` are the **slam judder** that starts at
that frame and rings down over the remaining 47. So the door swings open
correctly, and then, having arrived, whirls. The other 52 hinges were fine,
which is what made it *sometimes*.

`HingePose` in `render/hinge.ts` is now the only place the three angles are
computed, and `test/port.test.ts` asserts a magnitude never reaches one.

Two things the exe does that the port deliberately does not carry, both now
`[proved]` rather than assumed: the `FMUL float ptr [ESI+0x2C0]` on the yaw is
an identity — `PropBuildHinge` (`FUN_00472BD0`), `PropBuildVanDoors`
(`FUN_00472C90`) and `PropBuildHingeScaled` (`FUN_00472EB0`) all seed
`obj+0x2C0` with `1.0f` and nothing writes it again — and `base_rx`/`base_rz`
(`obj+0x1CC`, `obj+0x1D4`) are never written by any of the three, so they are
the pool's zero.

**Where this belongs.** `HingeUpdate` is a script-flag-driven state machine
with a frame counter, which is engine behaviour living in `render/`. It passes
`no-engine-writes-in-render` because it writes no `G` — but the counter is
state a snapshot cannot reach, which is why `PropLayer.resync` carries a
`[diverges]` that shuts every door on a seek. Moving it to `game/class44/`
would fix that and put it where `test:port` can drive it; it is not a line
edit, because the hinges reach the player as `props.json` and named glTF nodes
rather than as evt spawns through `DescriptorFromPlacement`, so the renderer
would have to learn to read hinge state back out of the pool.

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

### Selector 0 is not a hinge, and its two spawns are stage 1's window

**Done.** `PropBuildScriptFlagEffect` (`FUN_00472B30`) builds the one child of
this class that draws an **animated effect tree** rather than a model at a
pose, and the one that copies **no position at all**: the parts are placed by
motion 471, in world coordinates. Two spawns, both in stage 1 — evt `0x1580`
and `0x15CC`, the window the zombies come through and the gate they kick open
later, which the reports named separately and which are the same pair.

`ScriptFlagEffectUpdate` (`FUN_00473B90`) is three script-flag rules and a
draw: `g_script_flags[0x13]` despawns it, `[0x12]` steps the play cursor while
it is below `g_motion_play_length[471] - 2`, and each frame in
`g_script_flag_effect_cues_a`/`_b` plays `PlaySoundId(0x1816A9)`. The pose is
`EffectPoseNode` (`FUN_0040D9D0`) at interp mode 1 — key `cursor / 2`, blended
half way on an odd cursor, the BAMS terms taking the short way round.

It lives in the **container pool** (`PropFamily.ScriptFlagEffect`) rather than
in `props.json`, because that is the engine's own grouping: selectors 0, 16 and
17 all `ActorAlloc` a 0x378 object into the same family, and
`render/breakables.ts` already clones a model per asset slot and poses it
`Rz · Ry · Rx`, which is this routine's order.

Two `[port-only]` gaps, both declared on the spot: the draw's residency gate
(`g_motion_slots[471].state == 2`, always true once the bundle bakes the
motion) and the shot test, which `obj+0x34` bit `0x10` sends to `ShotTestMesh`
— the same one the story-mode switch's volume wants.

Not decoded: the other **fourteen** class-0x44 builders have their own child
behaviours, and `HingeUpdate`'s impact wobble (one damped sine over 16 frames
when a prop is shot) has nothing to drive it here. A *general* effect-tree
renderer is also still missing — the two trees this class places are flat, so
the port draws one prop per drawable node and never has to compose a chain.

### Selector 11 slides straight up, and it is stage 3's roller shutter

**Done.** Two reports found one gap from opposite ends: a roller shutter
missing from stage 3, and a stage 5 van drawn as two rear doors in mid-air.
Neither was the placement path, which is why the first report's own
measurement — stage 3 carries no hinges, no statics, no class-0x24 set pieces
and no shutter rig — was right and pointed nowhere.

**The shutter is class 0x44 selector 11**, `PropBuildRisingDoor`
(`FUN_00473410`) and `RisingDoorUpdate` (`FUN_004753F0`), and it was in no
table anywhere: not the `props` block, not `containerPlacements`, not
`g_class44_subtypes`. It is not a hinge — one `MatrixRotateY` and no curve —
and it is emphatically not the port's `shutter`, which is the HUD letterbox.
It translates **Y upward** while a script flag is up: `speed` is seeded 0.5 on
the frame the flag is first seen and gains `step` a frame until `y` passes a
ceiling, at which point the routine stops writing `y` and the door holds one
frame's worth above it rather than clamping.

Both numbers come from a **slot test**, `CMP word ptr [ESI+0x28C], 0xA58`, not
from anything measured about the model. Stage 3's door is that slot
(`etc_door.bin[2]`): it climbs 36.1 at a tenth a frame and is clear on frame
22, and while it waits it **rattles**, `(rand() % 0x191 - 200) * amp * 0.01` in
X and `(rand() % 0x65 - 50) * amp * 0.01` in Z with the amplitude decaying 0.95
a frame and reseeding itself whenever it falls below 0.001 — so it judders in
~135-frame bursts rather than once. Stage 5's door is `st5.bin[9]`, takes the
35.0 / 0.01 arm, and never rattles at all. Two spawns in the game and that is
both of them.

It lives in the **container pool** (`PropFamily.RisingDoor`) for the same
reason selector 0 does: the engine `ActorAlloc`s a 0x378 object, the rise is
real per-frame state that has to go in a snapshot, and `render/breakables.ts`
already draws a model per asset slot at `p.x/p.y/p.z`. The amplitude decays in
`game/`; the displacement it produces is a draw offset the engine recomputes
every frame and never writes back, so that half is the renderer's — the same
split `BreakablePropUpdate` already had. The rattle needed its own arm there:
the two axes have different moduli, and reusing the square 0x97/75 draw would
have been a guess.

**The van's body was never a missing placement.** It is a class-0x41 **type
51** generic prop at the doors' own position and yaw, drawing slot `0x1793` =
`char_adv04.bin[94]` — three models before the `[95]`/`[96]` pair
`PropBuildVanDoors` hands its hinges. `PlaceGenericProp` built it all along and
`DrawSlotFor` asked for `0x1793` every frame; type 51 was missing from
`GENERIC_DESCRIPTOR_SLOT`, the one list that decides which descriptor slots'
geometry travels in a bundle, so there was nothing to clone. **A placement with
no model and a placement that was never exported look exactly the same from the
level**, which is the whole reason both of these lasted. Eleven type-51 spawns,
all in stage 5: four vans, two ground quads and five other pieces of street
furniture from the same file.

**And four types take their lifetime from a different field.** Types 12, 31, 51
and 53 have a switch arm that writes the placer's `+0x1F4` — the signed byte at
`desc+0x24` — over `obj+0x11C`, so for those the slot and the lifetime are two
separate descriptor fields and both are real. The port read the slot as both,
which gave all 55 of those spawns a lifetime of their own asset slot: 6035
event steps for the van in a nine-block stage, so `PropExpireByStepLifetime`
never retired one. All 55 carry 0..7 in `desc+0x24`. That was invisible for
exactly as long as the props were.

`tools/verify_prop_slots.py` is the check, and it is `verify_attachments.py`'s
shape for the same failure one class over: every slot a placed prop will pass
to `AssetDrawSlot` has a model in its own bundle. Mutating the fix away makes
it fail on both rising doors.

### The descriptor-slot set is seven types, and the last three are drawn now

`PropDrawOnlyType31` (`FUN_0046A1C0`, 6 spawns), `PropDrawOnlyType53`
(`FUN_0046EBD0`, 2) and `PropDrawOnlyType54` (`FUN_0046EDC0`, 2) draw
`obj+0x28C` too, and were held out because adding a type makes its model travel
*and* draw — a type whose own arm is unported would arrive wearing the right
geometry and doing the wrong thing. Their arms are ported now, in
`game/class41/draw_only.ts`, and what each of them is came out of reading them:

* **Type 31 is an effect strip, not scenery.** It draws
  `obj+0x28C + obj+0x2A0` and the cursor is stepped every frame and **wrapped**
  at `obj+0x2A4`, which `PlaceGenericProp` case 0x1F fills from the placer's
  `+0x6C` — the spawn descriptor's *third orientation word*. So that word is a
  frame count and a roll at the same time, and both readings are real: stage
  1's 0x26 is 39 frames of `eff_1.bin`, stage 3's 9 is ten of `eff_taki.bin`
  (`taki` is a waterfall, and the model renders as a sheet of spray) and stage
  4's 0x1D is thirty more. **None of that is in the decompilation.**
  `MatrixStackPop` is marked no-return, so Ghidra ends the function body at
  that `CALL` and the pseudocode shows a bare draw with nothing stepping the
  cursor — `L37`, and `0x0046A334` is where the tail really is. Type 33 has the
  identical tail with `ActorKill` where 31 has the wrap, so it plays its 60
  frames of `eff_shop.bin` once and dies. The port drew frame 0 and held it
  until 2026-09-28 — see *Stage 2 block 11: the fire strip ends* below.
* **Type 53 is a car.** `char_adv04.bin[0]`, charred black, with wheels and a
  shadow quad. Its head is an inline variant of `PropExpireByStepLifetime`
  with the scene-1 sweep left out and `ActorKill` in place of `ActorDespawn`.
  `[likely] a burning car`: the same hidden-tail trap covers a second half at
  `0x0046EC6D` that draws **two more camera-facing animated strips** whenever
  `g_evt_block_index` is 4 or 5 — `char_adv04.bin[79..93]` at 15 frames scaled
  1.5/2.0/1.0, and `char_adv00.bin[1..8]` at 8 frames scaled 7.0 and pushed
  10.0 out, both on a yaw computed from `g_camera_pose[0]`. Block 4 is where
  one of its two spawns is placed, so that is live in the shipped game and
  `[open]` in the port: a camera-facing billboard is a render primitive there
  is nowhere to put yet, and its slots are kept out of the bundle rather than
  travelling unused.
* **Type 54 drifts, and the flag it drifts on is not a global.** Ghidra carries
  `DAT_009C720C` as its own symbol, which hides that `0x009C7200` is
  `g_script_flags` and this is **element 12**. Stage 5's script raises flag 12
  in block 5 step 2 and every branch out of block 4 — where the prop is placed
  — reaches block 5, so the drift is always taken: 5.0 in X, 1.5 up and -4.0
  in Z a frame, pitching `0x300` and yawing `-0x400`, for the 301 frames that
  read 0..300 and then `ActorKill`. The training scene's copy never sees flag
  12 raised and so stands where it was put, which is the engine's behaviour and
  not a gap. The same flag is the stage-2 boss's summon gate
  (`Class14StateSummonRoundB` writes it) and is raised in seven of stage 6's
  blocks: a flag number means whatever its scene means by it.

### The renderer posed all fifty generic props in one order, and it was type 51's

`render/breakables.ts` composed `Ry · Rz · Rx` for every prop in the family.
That is `PropDrawOnlyType51`'s order and **only** its order — twenty-two of the
fifty routines compose `Rz · Ry · Rx`, five `Ry · Rz · Rx`, twelve rotate about
Y alone, one about Z alone, one `Rz · Rx` with no yaw, six apply none of the
three words and three are `[open]`. It reads `GENERIC_POSE_ORDER` now, which
`tools/verify_prop_pose.py` derives from the EXE per type, matching each
`MatrixRotate*` to the field the instruction before it pushed.

**Matching the argument and not just the axis is what makes it readable.**
`PropUpdateType19` rotates Y by the literal `0xC000`, then Z, then Y again,
then X; counted by axis that is a fourth distinct order, and read with its
arguments it is the same `Rz · Ry · Rx` as its neighbours plus a constant
quarter turn. It also poses from `obj+0x64/68/6C` rather than
`obj+0x1CC/1D0/1D4`, because its object is an enemy — `L3` again.

The count that went with the old `[open]` note was fifteen, and it was the
wrong measure twice. **The order only matters when yaw and roll are both
non-zero**: `Rx` is last in every one of these compositions, so all an order
can disagree about is whether `Ry` or `Rz` comes first, and with either angle
at zero the two matrices are equal — which is why type 5's four stage-2 spawns,
a pitch and a yaw with no roll, were never misplaced at all. And it was counted
over six stages rather than the twelve bundles. What the check measures is
**20 spawns posed differently, four of them by more than a degree**, and all
four are `PropDrawOnlyType12` — stage 4's blocks 4, 7, 12 and 13, the worst by
19.65°, a handcart tipped onto the wrong corner. The other sixteen move by
fifths of a degree, because for types 31 and 33 the "roll" is a strip length.

`tools/verify_prop_pose.py` is the check, and it holds three things the tables
could not hold on their own: the pose order per type, against the routines; the
strip set and the descriptor-slot set, against the routines, in **both** the
port's copy and the exporter's — which is the check the van needed and the one
`verify_prop_slots.py` cannot have, since it reads the same table it would be
checking; and that `render/breakables.ts` composes a pose in exactly one place.
The code the bug was in fails all four: two `rotateZ(p.roll)` sites, two
`rotateY(p.yaw)`, two `rotateX(p.pitch)`, and no table.

### Fourteen routines draw `obj+0x28C` and seven of them mean the descriptor

`verify_prop_pose.py` asserts the set now instead of listing candidates, and
what closed it was **`PlaceGenericProp`'s switch, read as a table**:

```
00461da2  MOV EAX,[EBP+0x130c]              ; the descriptor's type
00461da8  ADD EAX,-6                        ; index = type - 6
00461dab  CMP EAX,0x47 / JA default
00461db6  MOV DL, byte ptr [EAX + 0x462978] ; g_place_generic_prop_arm_index
00461dbc  JMP dword ptr [EDX*4 + 0x4628d4]  ; g_place_generic_prop_arms
```

Types 6..77 have an arm and types 5 and 78 fall to the default — which is why
`PropDrawOnlyType5` has no per-type setup at all. 72 index entries select 41
distinct arms, so most arms serve several types, and with the mapping in hand
every write to `obj+0x28C` in that routine belongs to a named type. Four
clauses then cut fourteen down to seven, and each excluded type is excluded for
a reason rather than for want of reading:

* **13, 34 and 67** — their arm writes an immediate over `obj+0x28C`
  (`0x1A4A`, `0x0A50`, and `0x1A36`/`0x1A35`/`0x1A0F`).
* **43** — its arm takes the field away too, and **not with an immediate**,
  which is why a detector looking only for one had called it a descriptor
  slot: `SBB EDX,EDX / AND EDX,0xFFFFE617 / ADD EDX,0x19E8` leaves either
  `0x19E8`, the ordinary breakable model, or `0xFFFF`, the engine's
  draw-nothing. It also ages `obj+0x11C` as a lifetime, and its seven spawns
  carry 1, 2 or 3 there. And it turns out to be **the third object built from
  `g_prop_kind_params`** — `PropUpdateType43` (`FUN_0046CEA0`) takes the kind
  from the descriptor's third orientation word, the radius, effect and variant
  from the kind's row, plays that row's sound on the first hit, pays for it,
  swaps `0x19E8` to `0x19E6` and turns the broken model to face the camera.
  So stage 3's seven "undrawn props" are **breakables the port does not place
  as breakables**, not scenery with a missing model; the stage still carries no
  hinges, no statics and no set pieces. That is the other side of the
  no-scenery measurement, and it is a bigger job than a table row: the type
  wants `PropFamily.Kinded`'s neighbour rather than an entry in this set.
* **70 and 71** — `OriginalItemPropUpdate` ages `obj+0x11C` too, so the word in
  it is a lifetime and the model comes from `g_original_item_records` through
  `PickOriginalModeItem`.

`[open]` **Type 72 passes every code clause and fails the data one.**
`PropUpdateType72` (`FUN_00470750`) is an Original Mode collectible with its
own routine, and for its first 25 frames it draws `AssetDrawSlot((s16)
obj+0x28C)` at the spawn's pose scaled by `obj+0x2C4`. Its arm never overwrites
that field and it never ages `obj+0x11C` — and its one shipped spawn, stage 2
block 16, carries `+0x11C == 1`. So the engine really does hand
`AssetDrawSlot` a 1. Whether anything is resident at slot 1 in that region has
not been read, so whether that draw shows `bg_adv10.bin[0]` or nothing is
undetermined, and it stays out: carrying that model would be the same mistake
that once put characters and effects where stage 2's scenery should be.

**The fourth clause is the shipped data, and the gap it rests on is measured.**
Across the class-0x41 spawns of all twelve scenes a generic descriptor's
`+0x11C` is one of **0, 1, 2, 3, 4, 5, 7** — 54 words — or one of
**`0x2B`..`0x18BF`** — 43 words — with **nothing in between**. Below the band it
is a lifetime in event steps; above it, an asset slot. The check asserts the
band is still empty every run, because the rule is unsound the moment it is
not, and it measures the band against the routines rather than against either
table: deriving the threshold from the set being checked makes a removed type
read as the gap closing instead of as a missing prop, which is
`verify_prop_slots.py`'s own circularity one layer in and was caught here by
the mutation test twice.

### Three stage-2 set pieces that drew at the wrong origin or never moved

Three reports, one pattern: a routine the port had read for **what** it draws
but not for **where** or **when**. All three are now transcribed whole.

**The door the block-5 civilian is behind — class 0x41 type 35.**
`PropUpdateType35` (`FUN_0046B320`) is placed at the **origin** (stage 2 block 3
step 4 op 5, evt `0x2504`) and never reads its own position: both leaves are
drawn at literal world coordinates, `0x1812` at `(-620.55, 66.294, -997.98)`
and `0x1813` at `(-620.55, 66.294, -980.82)` (`komono_uemiti.bin[3]`/`[4]`).
The renderer drew `0x1812` at `p.x/p.y/p.z` — the origin — so the doorway the
two captors come out of was empty grey. The second leaf is past the
`MatrixStackPop` Ghidra ends the body on (`L37`). While script flag `0x68` is
up and `0x69` down the door **rattles**: a knock (`DAMAGE3_22.WAV`) on counted
frame 20 and again on 50, each a seven-frame swing of `ftol(sin(phase) *
1536)` BAMS, the leaves mirrored. Stage 2 block 5 step 2 raises `0x68` one
frame before it spawns the civilian and `0x69` at camera path 5 frame 365.
`game/class41/type35.ts`.

**The ladder in the clock-tower cut scene — class 0x41 type 13.**
`PropUpdateType13` (`FUN_00467F50`), one spawn (block 21 step 4, evt
`0xEC94`), placed at `(-925, 180, -1297)`. Two draws: `AssetDrawSlot(obj+0x28C)`
with **no matrix of its own** — `komono_tokeidai.bin[1]`/`[2]` are modelled in
world space, a panel beside where the cut scene's two player bodies stand,
blinking every 40 scene ticks until the first step change — and `0x1A43`
(`komono_tokeidai.bin[0]`, 191 units tall) at `Translate(x, y, z + judder)`.
Flag `0x6D`, raised by block 21 step 7 op 4, drops it: `0.02` of gravity a
frame from rest, 186 units in 136 frames to `y = -6.0`, then a `0.4` judder
across Z decaying by `-0.925` for 27 frames. The camera of path 34 is aimed at
exactly its X and Z. The port had it as a drawn-only generic prop: `0x1A4A`
at `p.x/p.y/p.z` (world space added to world space, a kilometre off) and no
`0x1A43` at all. It is its own `PropFamily.Type13` because it **inlines** its
lifetime — the step count before the scene-1 sweep, `ActorKill` rather than
`ActorDespawn` — and registers no shot sphere. `game/class41/type13.ts`.
The skip arm (flag `0x6D` with `g_cutscene_skipping` snaps it to the floor) is
not transcribed: `g_cutscene_skipping` has no port, the gap classes 0x21 and
0x25 already name.

**The boat that runs into the wall — class 0x13 selector 0.**
`CarrierPropRoutine0` (`FUN_00440210`), stage 2 block 16 step 11 (evt
`0xA3E8`), slot `0x1A36` (`komono_boat.bin[1]`) at scale 2.5. It rides object
path `0x151` (`op_st2` 9) from the camera's frame; at ride frame `0x276` (630)
`SIBUKI2_16.WAV` plays and a 94-frame `eff_dokan.bin` strip starts at a fixed
point by the wall, and it coasts on to `g_carrier_routine0_ride_end` (710).
Two things were missing, and either alone hid the boat: the routine (the class
dispatched selector 1 only, so the boat stood at its descriptor for ever) and
**its model** — `actorSlotEntry` carried no class-0x13 slot at all, and stage
3's boat had geometry only because `0x1A37` is also class 0x25's variant-3
model. `scriptedPropDrawSlots` now carries each class-0x13 descriptor's own
slot **when the port runs its behaviour** — `NoOpStub` statics, and carriers
on selectors in `CARRIER_SELECTORS_PORTED` — which also brings stage 2's five
static class-0x13 props (`0x1237`, `0x1383`) into its bundles. Stage 4's seven
carriers take selectors 2..9 and stay out: drawn, they would stand at their
descriptors while the game drives them. **Ghidra's pseudocode would have frozen
the boat**: it ends the ride state at the `MatrixStackPop` and shows no
`frame++`; the increment is at `0x00440323` and the whole tail past it.
`game/class13/routine0.ts`.

**...and the five static ones lean the way their records say.** Those five
(`komono_st1.bin[3]` x4 at block 17 step 1, `etc_1.bin[63]` at 15x in blocks
16, 20, 35 and 39) are the only class-0x13 records with a pitch, and
`SpawnSlotActor` took the yaw alone -- the placement had carried `pitch` since
the wall-climbers, and the arm read `yaw` by name. `SpawnFromDescriptorSmall`
(`FUN_00408BC0`) copies all three words, behaviour 0 is a bare `RET`, and
`ScriptedPropUpdate13` draws `T·Rx·Rz·Ry·S`, which `render/slotmodels.ts`
already did; so the four wooden models on the far wall of the block-17 room
stood upright where the game tips them `+22.5°`, `+56°`, `-22.5°` and `-28°`
about x, and `etc_1.bin[63]` -- the moon, `[likely]` by its texture -- stood
on edge to the ground where the game turns its face `56°` down toward it. Every spawn site now takes the three angles
through one helper, `PlacementOrientation` (`game/descriptor.ts`) --
`SpawnScriptedCharacters`, every arm of `SpawnSlotActor` and
`SpawnHordePlacers`. What a player sees: at block 17's hold (camera 81 frame
425, the civilian and the `znkage`) two of the four are in frame and lean
left; the other two are off the right edge, and from the street at the start
of the step all four sit behind the window jamb (at most ten pixels change).
`etc_1.bin[63]` is in the frustum on camera 86 frames 5..240 and behind the
tower's roof there: at most five pixels of a scripted frame change. `web/tools/props13_look.mjs`
reads the three angles back off the page's own `G` and shoots the hold.

**The draws are ported too.** Selector 0's wake (`char_adv06.bin[0..21]`
under the boat's own pose, `Translate(0, 0, 27.5); Scale(1, 0.15, 1)`) and its
splash (`eff_dokan.bin[0..93]` at the fixed point by the wall) are drawn by
`render/slotmodels.ts` from `wakeDrawn`/`splashDrawn`, which the routine sets
on exactly the frames it draws — a cel is drawn and *then* stepped, so reading
the cursor itself would put every strip a frame ahead. The same machinery
carries **selector 1's**, which were a `[diverges]` only for want of their
slots: `CarrierDrawGroundWake` (`FUN_00440770`) lays two wake slots flat on
the ground under the boat (`QueryGroundHeightAt(x, y + 100, z)`, headed along
the keel by `VecToAngles` of the rotated forward axis — both computed in
`game/`, since a collision query is the port's), states 5/6 draw their strip
at the bow, and at path frame `0x550` the bow throws `SpawnPropStripEffect`
(`FUN_0043FCA0`) kind 3 — a small effect object, `PropStripEffectUpdate`
(`FUN_0043FBC0`), now `game/effects/prop_strip.ts` — with `0x000B16A9`.
`CarrierDrawSlots` is what the exporter carries for each ported selector.

**The zombie in the boat was a regression in the spawn order**, not the
class-0x18 motion row. After the stage-3 boat work, `syncCharacterSpawns`
walked the walker's spawn list to keep script order — and a civilian's
children are not in it: `CivilianInit` builds them from descriptors nothing in
the script points at, so they reach `readySpawns` through their parent. No
civilian child was built anywhere; block 5's two captors never came through
the door and this boat carried nobody. They are now built straight after their
parent (`CharacterSpawnRequest.parentAt`), which is when `CivilianInit` builds
them in the engine, and the zombie rides the boat into the wall.
**And it walks the boat.** `[proved]` `ZombieStateWalkToTarget`
(`FUN_0045A890`) measures `obj+0x40/+0x48` against the civilian's own, both
carrier-relative while both ride, turns toward it at `0x1A0` and lets the
target script's clip carry it; at the script's arrival distance it goes to
state 35 and mauls. The rider stood still because it **had no script**: the
exporter decoded the two blobs for class 0x30 only, and `CarriedZombieInit18`
(`FUN_0045CD60`) is `EnemyZombieInit` plus two stores, so class 0x18's tail is
class 0x30's byte for byte. With them (clip 1056, arrival 10) it walks from
the stern to the civilian and, unshot, kills him on the way to the wall.
Stage 3's five riders take their scripts the same way. `verify_captor_scripts`
now counts class 0x18 (76 spawns, 113 scripts) and `test:seek` asserts every
rider in the bundle carries one.

**Selector 6** (`CarrierPropRoutine6`, stage 3 block 7's boat) is on the same
machinery: at path frame `0x6A4` it throws the bow strip — `+8.0` along its z
where routine 1's is `-5.0` — with `0x000B16A9`; its state-5/6 strip sits at
`-2.0`; and its wake at 32.5 along the heading. That `PUSH 0x42020000` is
`CarrierDrawGroundWake`'s distance argument, not the scale it had been read
as. `CARRIER_GROUND_WAKE_DRAW` holds the three literals per routine.

### The gun lights are real spotlights now, placed by the port

**Built off the camera the frame draws, and aimed out of that camera's own
origin.** The first version ran `SceneLightArrayUpdate` inside the port's
frame, against `ctx.view` -- the camera as the *last* draw left it, a frame
behind the block by design (`CameraTakeSystem`) -- and aimed it at
`pos - g_camera_block_eye`, an eye seated a frame later. On a display faster
than 60 Hz only every other rAF owes a tick, so whenever the camera
*translated* the torch swung between two aims at the refresh rate; a camera
that only turned was fine, because turning moves no eye. Now
`GunLightBuildSystem` (`app/systems.ts`) builds the lights in the render
phase straight after `CameraDrawSystem`, from that camera's matrices, and
`BuildEntitySpotlightArray` takes the eye as the same matrix's origin -- which
in the engine it is: both of the block's matrices are built from the block's
own position (`UpdateSceneViewAndLight`, `FUN_00401F40`), so `pos - eye` is
the crosshair offset rotated. Measured at 120 Hz rAF on the bug-14 link, the
torch pool's frame-to-frame second difference fell from 4.1 px to 0.9 px on
a 160x100 probe, and 261 of 438 frames are now pixel-still (the no-tick
frames) against 88 of 493 before.

Bug 14: "the flashlight … is a bit naff". It was two `SpotLight`s in
`render/lighting.ts`, one unit ahead of the camera and pointing straight
ahead whatever the aim, visible only in the "+ scene light" view, on every
surface, at a third of the engine's brightness and with no shadow. In the
default view there was no torch at all.

What the engine does, read for it (`docs/formats/evt.md` rows 14–16,
`game/scene_lights.ts`): evt `0x14` raises `g_scene_lighting`, `0x15`
`g_entity_spotlights_on`, `0x16` sets `g_light_array_ambient`. Each frame
`SceneLightArrayUpdate` (`FUN_00480970`) runs `BuildEntitySpotlightArray`
(`FUN_00480AC0`), which puts one D3D spot per player at the crosshair's
eye-space point at depth 1, aimed along eye→point, `attenuation0 = 0.5`
(twice white), `theta = phi = π/8`. Only the things that ask for the array are
lit by it — `draw_mode` 1 region models, actors with `obj+0x38` bit 3, throwers
with `obj+0x136C` bit 0 — and they get the evt-0x16 ambient in place of the
default light, so in stage 4 the room goes moonlit blue and the torch is where
the mouse is.

The port now: `g_entity_lights` and the three globals are in `G`; the walker's
two gates are accessors over them and `0x16` is ported (the exporter resolves
its three pointers into `rgb`); the pointer is written to `g_crosshair_x/y` as
input by `app/`; `GameSystem` runs `SceneLightArrayUpdate` every frame, paused
or not. `render/gunlights.ts` reads that and nothing else: a `SpotLight` per
live entry with a 1024² PCF shadow map, and the lit set swapped to a Lambert
twin that reproduces `clamp(ambient + 2·N·L) × texel` in gamma space.
`EnemyZombieInit` now seeds `obj+0x136C`'s low half from the descriptor, so
stage 4's 35 flagged zombies are lit (they could not be before);
`CivilianInit` raises bit 3 when spawned under the lights.

Three `[diverges]`, all presentation, all the user's request: shadows (D3D7 had
none), the lamp moved 2.5 units right and down of the engine's point so its
shadows can be seen at all (the engine's lamp is on the eye ray), and a 0.3
penumbra in place of per-vertex smearing. Cost, GPU-synced frame time on an
M1 Pro headless: +0.2–0.6 ms a frame in stage 4 and +0.5 ms in stage 2's
mansion while a torch is live (the shadow pass is most of it), nothing
elsewhere.

**Class 0x41 type 48, the lamp that owns a light.** `PlaceFlickerLightProp48`
(`FUN_00463B20`) and `PropUpdateType48FlickerLight` (`FUN_0046DDE0`), ported
in `game/class41/type48.ts`. It is its own constructor rather than a
`PlaceGenericProp` type, so it was in no bundle until now: the exporter emits a
`flicker_light` placement carrying its 32 models. One spawn, stage 2 block 26
step 1, in the stretch where the scene light array is on. It claims a
`g_entity_lights` entry (`EntityLightAcquireSlot`, from entry 3 up): a point
light with a colour of (20, 20, 15), `att2` flickering between 0.01 and 0.03.
Shot, it bursts into thirty pieces for ninety frames while the light fades,
then shows the broken lamp. `render/gunlights.ts` draws the light as a
three.js `PointLight` on the same lit set; `[diverges]`: the `att0` near field
is dropped, which only matters inside two units, where both saturate.


### Stage 1's church is furnished, and stage 4's desk has no lift in it

Three reports, two causes.

**The church (new bugs 8 and 9).** Class 0x41 types 38, 39 and 44 had no
constructor in `g_class41_constructors`, and type 40 had only its branch arm:
every one of its objects stood at the placer's origin with draw slot 0. All
four are ported whole now, each in its own file under `game/class41/` —
`PlaceTable38Props`/`PropUpdateType38` (nine objects that hop and land
pivoting on a hull corner), `PlaceTable39Stacks`/`PropUpdateType39` (eight
stacks that topple item by item, blink and go), `PlaceFragmentProps`/
`PropUpdateType40` (all twenty sub-kinds' tables, the forty-piece burst and
the per-game `g_fragment_subkind1_intact` latch) and
`PlaceTable44Props`/`PropUpdateType44` (seven chairs: two drawn as effect 0x13
that a shot blows apart, five whole). They draw through `render/prop_parts.ts`,
which writes each routine's `AssetDrawSlot` blocks out as a list of parts. Row
6 of type 44 is the chair the step-5 humanoid lies against. The bundles carry
the new slots, `verify_prop_slots` now checks them, and `verify_prop_tables`
compares every table the port carries as a literal with the EXE.

Every other type-40 placement in stages 1, 2 and 4 moves with it: objects that
had been drawn nowhere are now at their table points with their own models.

**Stage 4 (new bug 12).** `obj_48f050` — class 0x26 subtype 3, installed by
`Class26InstallSubtypeUpdate` (`FUN_0048E290`) — was drawn from stage load at
its baked origin pose, which is inside the desk of block 0's opening shot. Its
one spawn is in block 12. Rigs whose routine a spawn installs now carry
`spawn_ats` in the bundle and are drawn only once the walker has run one of
those spawns, which closes the timing half of `render/rigs.ts`'s declared
divergence for all five class-0x26 rigs.

Both of what was left over is ported now: `SpawnPropHitEffectScaled`
(`FUN_004666B0`), the hit effect types 38, 39 and 44 — and 43 — call, at the
point the shot was aimed (the generic spark no longer fires for 38/39/40/44,
none of whose routines calls it); and `EffectPoseNode`'s matrix arm,
`MatrixInterpolateSwingTwist` (`FUN_00412750`), which effect 0x13 reaches on
12 node-frames of its break (`class44/swing_twist.ts`).

### Light block 1 is the characters' light

`LightsUseSecondarySet` (`FUN_0041DC70`) swaps the device's ambient,
direction and colour to **light block 1** (`0x009A59E0`) and
`LightsRestoreScene` (`FUN_0041DCC0`) swaps block 0's back. Forty-four
routines make the pair of calls around their draw, unconditionally — among
them `ZombieAdvanceMotion` and `ThrowerAdvanceMotion` as their first
instruction, `CivilianUpdate`, the frog, class 0x14, the one-hit targets, class
0x22, the set pieces, the humanoids, the horde members and the horde's rug, the
owl's corpse, the bats, the fish and the cat. So the world is lit by block 0
and **every character by block 1**. The port had block 1's opcodes (`0x19`,
`0x24`, `0x25`, `0x27` -- 91 + 112 + 0 + 94 = 297 instructions across the six stages) as no-ops on
the belief that block 1 "never reaches the renderer", and the exporter decoded
only block 0's tweens, so every `0x25`/`0x27` came out as an immediate set.

Now: the walker keeps both blocks (`lightBlock1`, in the snapshot), stepped
together; both start at `LightBlockInit` (`FUN_0041DBA0`)'s ambient 0.7, which
was 0.5 from nothing; `game/light_sets.ts` says which classes draw under block
1; and `render/lighting.ts` gives those actors' meshes a Lambert twin lit by
block 1's uniforms alone. **Only the "+ scene light" view shows it**, because
the default view is unlit for everything. `[open]`: twenty-one of the callers
are unnamed routines whose class has not been read, plus `BodyCreatureUpdate`
and `ScorePickupUpdate`, which are not actors in the port's pool.

### The rider after its maul, and the room it held open

Stage 2 original block 16 step 12's `wait_enemies_alive` never released: the
boat's class-0x18 rider (evt `0xA174`) was about 1,660 units from the camera
in `AttackRun` and could not be killed. Three faults, all `[proved]` from the
exe:

* **States 46, 47 and 48 had no port.** A rider's script ends in its attack
  state (`tail[3]`, 47 here), and the default arm sent it to `AttackRun` —
  in the carrier's frame, so it walked off across the canal in boat-relative
  coordinates. Ported in `game/class30/carrier_rider.ts`:
  `ZombieStateHoldOnCarrier` (46, aboard, turning to face the camera through
  the inverse carrier matrix -- and, since 2026-09-28, leaving for the attack
  state on the cue frame itself; "no exit" was the pseudocode stopping at a
  `MatrixStackPop`), `ZombieStateLeapOffCarrierForward`
  (47) and `ZombieStateLeapOffCarrierAtMark` (48), which bake the carrier into
  the rider with `CarrierBakeWorldPose` (`FUN_0045D920`, position *and*
  angles, through a transcription of `MatrixToEulerBams`), fly, splash through
  water, land and turn on the player. The attack blobs' headers for 47 and 48
  are now decoded (`actorscript.ts`, both halves).
* **The cue test was inverted.** `CarriedZombieUpdate18` fires
  `state = 0x2E` while `g_cam_path_frame < tail+0x0E` (`JGE` skips it at
  `0x0045CE0D`), and only a whole-dword `-1` at `tail+0x0C` means "no cue".
  The port had `>=` — so a rider whose maul ends mid-ride, as this one's
  does, holds on the boat; the port would have leapt it.
* **A shot rider never died.** `ResolveHit` handed `pendingHit` — what
  `ZombieOnShot` reads — to classes 0x30 and 0x31 only, but class 0x18 runs
  `EnemyZombieUpdate` and so `ZombieOnShot`. It reached zero hit points, was
  flagged dead and stayed in its state for ever.

With all three the rider rides into the wall facing the camera and dies to a
volley; stage 2 and stage 2 Original play to their end blocks along the
default road, the 1-2-3-4-5-6-7-8-10 road and the 5→21→16 road with no
debug clear. The corpse step-off (`state 7 sub 1`, `obj+0x1330 == 2`) now
bakes the angles too. `[open]`: `RegisterForDistanceRank` still admits class
0x30 only; whether a rider registers, and with which position, is unread.

### Stage 3's boat riders can be shot, and go with the boat

Reported: at the start of stage 3 the zombies on the boat with the first
civilian did not die when shot, and were still standing when the boat blew up.
Three faults, none of them a regression -- the first dates from the class-0x13
port (`902de88a`), and a build from before the class-0x30 pick moved into the
engine (`51b0f657`) answers the same pulls identically.

* **The boat took the shots.** `SpawnFromDescriptorSmall` hands the record's
  flags word to `ActorInitFlags`, and every class-0x13 record carries `0x8000`
  -- out of `RegisterForShotTest` for life. The port's spawn arm dropped the
  word, so the 40-unit radius `CarrierPropRoutine1` seats round the boat's
  origin was a live sphere in `render/`'s pick, nearer along the ray than any
  rider standing behind the origin. Measured on one seed, the same pulls
  replayed one every two frames at the riders' own shot points: before, the
  first ten took nothing from either (220 and 130 hit points); after, the
  captor was dead on the ninth (220 to -60) and the rider on the eighteenth.
* **A captor aboard retires with its boat.** `ZombieStateRetireOffScreen`
  (state 38) ends with an arm the port had not got: a class-0x18 rider whose
  carrier has `obj+0x34 & 0x400000` -- raised by routines 1 and 6 as the boat
  runs past its mooring into the wall -- is retired and credited
  (`ZombieRetireAndCredit`, now transcribed whole: the one-player credit, both
  counts on the spot, the hit slot). Stage 3's `0xC00` and `0x71D0`. The
  mode-0/1 test is `ActorBoundsOnScreen` now, as the engine's is.
* **A holding rider leaps on its cue.** `ZombieStateHoldOnCarrier` sends the
  rider to its attack state when the camera reaches `tail+0x0E`; the three
  `znnick` riders (attack state 48, camera path 124 frame 1080/1075) leap to
  the player's boat instead of standing on theirs through the crash.

### Hiding a character is two gates and a hook, not an alpha

The port hid a class-0x30 actor by setting one alpha for the whole actor,
and the renderer hid the root on it. The engine has no such thing `[proved]`:

* **`model+0x64` bit 0** (`MotionFlag.Drawn`) is `SkeletonEmitNode`'s gate:
  with it down no node of the skeleton is drawn, hook and all, and
  `ActorDrawShadow` draws no shadow.
* **`model+0x40`'s part bytes** (`Actor.partVisible`) gate the vertex-blended
  parts -- `g_pCharacterExtraParts`' waist and skirt, the exporter's
  `part<i>_<slot>` nodes, **not bones**. `ActorSetPartVisibility`
  (`FUN_00409D10`) writes all of them; `ZombieStateAwaitCivilianOrder` and
  class 0x14's entrances write part 0 alone, so a captor held off screen
  would still draw a skirt.
* **The attachment list is not gated at all.**

The corpse blink, the emerge, the captor's hold and state 19's wait now write
the two gates as the exe does, and `render/characters/draw_gates.ts` applies
them node by node (layers for the skeleton, so the child bones stay, and
`visible` on the part nodes). Class 0x31's blink is a third mechanism: an
alpha at `obj+0x138C` that `ThrowerDrawBonePart` draws each bone at while
`obj+0x136C` bit 2 is up and `DrawCharacterPartSlot` draws type 0x18's waist
at unconditionally -- the port's hook records the alpha per bone and the
renderer hides a bone drawn at 0.

State 19's `tail+0x0C == 0` arm was ported as a **freeze** (the clock held,
"root motion off"); it is a hide, and the clip plays. And `zslman`'s hands grow
back in the draw now, not in the state: `ThrowerDrawBonePart` adds 0.025f per
regrowing **node** drawn, so a hidden skeleton does not re-arm, two bare hands
grow twice as fast, and the latch drops on the 41st node, not the 40th, because
the sum is an f32. One divergence is declared for it: the hook is always
`ThrowerDrawBonePart` -- Training's swap and the big-head item's hook are not
modelled.
`DrawSkinnedModelAndShadow` does draw the shadow (`ActorDrawShadow`, past the
no-return pop); the port does not draw a character's shadow yet, and
`ActorDrawShadow`'s gate is ported for when it does.

### A stacked prop shatters, and a falling container breaks in two

Both were written off as "render-only effects nothing in `game/` observes" and
let go with an event. Both draw `rand()`s — 75 for a shatter, 10 for the
container's pieces — so the port ran the rest of any stage in which one broke
on a different random stream from the game. They are objects now, stepped
where the engine steps them:

* **The shatter** is one `0x2B4` object with fifteen pieces
  (`game/class41/shatter.ts`, `G.g_prop_shatters`, drawn by
  `render/prop_shatter.ts`). The pieces start off `obj+0x2E4`, the matrix the
  prop's last draw stored — so `BreakablePropUpdate`'s draw composition moved
  into the port (`drawMatrix`, with the view it was drawn under in
  `drawView`), and the renderer now places a group prop with it. That fixed a
  second thing: a falling or settled prop is drawn under
  `Translate(0, -3.770148, 0)`, which the renderer had left out, so a toppling
  prop jumped up by half a level the frame it started to fall.
* **The container's pieces** are two, not three (the loop runs for 1 and -1),
  0x378 objects in the prop pool (`PropFamily.ContainerFragment`,
  `game/class44/container_fragment.ts`) that tumble, land, blink and go after
  181 frames. `FallingContainerGroundContact` takes the hull as an argument
  now, as the engine's does, and has the scene-1 block-0x12 wall it was
  missing.

Around them, in the same two routines: the rattle's two `rand()`s a frame are
drawn by the port rather than by the renderer's own generator; group 4 breaks
on `g_script_flags[0x65]` and never on a shot; the hit gate's scene-1 block
0x11 hold (flag 0x28) and the scene-1 `0x77` sweep are in; a crack or a knock
turns the prop to `g_camera_block_yaw_bams`; the ground-level destroy no longer
zeroes `+0x324` and does hand `+0x11C` the lifetime byte; the container
despawns on camera path `0x2F` frame `0x96`, its knock throws the
one-and-a-half-size impact instead of a spark, and its story item comes out
half a unit above the floor. The bundle carries both slot tables, the offsets
and angles, and the 55-point piece hull.

### A leap's stages hold their start frame through the fade

`ActorArcStep` (`FUN_0044D860`) plays each of an arc script's three stages with
a direct `ActorSetMotionBlended` call, and that call writes the stage's start
frame into the cursor at `obj+0x19C` and holds it there until the fade is over.
The port's one-shot channel started each stage running at once, so every
threshold the arc and the attack entries compare against that cursor came up
early, by the whole of every fade before it -- and
`ThrowerStateDelayedPounce`'s `cursor > 66` first fired at 68, because stage 2
started at 67 on the frame the cursor reached 66 and nothing ever saw 67. It
matters more than a fade usually does: the fit that stretches a script onto a
long arc does it **by growing the fades**, so on a long leap the hold is most
of the flight, and a pounce's hit frame and its landing are timed against it.

`ActorSetOneShotBlended` (`class30/motion_cue.ts`) is the channel's
`ActorSetMotionBlended` now: it fades out of whatever is on screen and marks
the clip `held`, and `ActorAdvanceMotion` holds a held clip -- not the base
clip underneath it -- for the fade, `fade + 1` frames, as it already did for
the base track. The renderer was already fading into a one-shot; it now fades
into each stage as well, where it used to cut.

`ActorArcStep` itself is transcribed whole with it. Its phases fall into each
other; its flight phase ignores whether the arc has landed and waits for the
clip, where the port used to skip straight to the end and drop the landing
clip; `obj+0x1330` gives back the frame the flight flew twice; the four
thrower types cannot be shot in a leap's windup (outside the leap aside) and
land colliding; and the arc no longer zeroes a velocity the engine leaves
alone. The landing dust (`ThrowerEmitGroundDust`) is the one thing left out,
declared.

Two test fixtures had to change with it, and the reason is the engine's: the
wall leaps played a generic script whose last two thresholds, 46 and 47, lie
past the 44-frame play length of the 23-frame clips under them. The engine's
cursor wraps there, so an actor on that data would wait out its landing for
ever; the old port only finished because it bailed out when the arc landed.
The fixture carries the exe's own wall script now, and `verify_combat.py`
check 16 asserts that none of the shipped scripts does that.

### The rooftop route is flown at the waypoint's own step (NEW-BUGS-2)

**Reported:** "the zombie that jumps across the rooftops at
`?stage=2&original=1&mode=play&block=14&step=2&op=9&frame=372` moves quite
slowly compared to the real game." It is spawn `0x7EA4`, a class-0x31 `zsass`
in `ThrowerStatePathFollow` (`FUN_0044EE00`, state 26): a 45-frame wait, then
five leaps -- one at step 1, four at step 3 -- and a pounce at the player.

The waypoint's `step` goes to **both** `ActorArcBeginTo`, which makes the leg
`dist2d * step` parameter frames long, and `ActorArcStep`, whose
`ActorArcInterpolate` flies `step` of them a frame. The port handed it only to
the first and flew one a frame, so every step-3 leg took three times as long:

| leg | T | before | after (and the engine's arithmetic) |
|---|---:|---:|---:|
| 2, 8.2 units | 24 | 25 frames | 10 |
| 3, 16.0 units | 48 | 49 | 18 |
| 4, 15.3 units | 45 | 46 | 17 |
| 5, 12.0 units | 36 | 37 | 14 |

Measured in the running player at the report's URL: the route took frames
45-220 and now takes 45-135; ground speed over the step-3 legs went from
0.33-0.35 units a frame to 0.92-0.96. The parabola was already the engine's --
it is solved over the same `T` -- so the hops are no higher, only three times
quicker.

The state was a sketch in the port and is a transcription now: the leg
installs the style's arc motion script (`g_class31_arc_path_style0/1/2`, or
`_c17` for character type 0x17) through `ActorArcBeginToWaypoint` and is
flown by `ActorArcStep`, so the actor hops in clip 301 held on frame 12 where
it used to slide in its idle; the route raises `obj+0x34` bit `0x100` for its
whole length; every leg ends on `ENE_WALK6_22.WAV`. None of the three
scripts was in the bundle -- no table the exporter read names them -- and
nor was clip 301; `CLASS31_ARC_SCRIPTS` carries them now, and the bake list
follows.

`FitArcScriptByFadeLength` (`FUN_0044D5F0`), which every arc but `zstin`'s
runs through, was also wrong: the port had one function for it and
`FitArcScriptByStartFrame` (`FUN_0044E140`), with the latter's slack -- net of
both fades -- and its halved `k` applied to every type. The engine's slack has
no fades in it, grows both fades a frame at a time, gives the odd frame to
stage 2, and resets both fades to 1 in the tight case. Both are transcribed now,
under their own names, and the `zstin` one no longer clamps its fades at
`0x7F`, because the engine's does not.

### The pounce and the leap back, as the listing has them (NEW-BUGS-2)

The rooftop route ends in states 9 and 10, `ThrowerStateLeapDown`
(`FUN_0044B670`) and `ThrowerStateLeapAside` (`FUN_0044B880`), and the agent
that fixed the route left a list of what they got wrong. Both are
transcriptions of the disassembly now, and so are the two routines the pounce
runs every frame, `ActorArcBeginToWaypoint` (`FUN_0044D780`) and
`ThrowerStrikeConnect` (`FUN_0044CE60`). What changed, in the running player:

* **The pounce raises `0x10000000`, not `BackingOff`**, and takes it down on
  the way to state 10; **the leap back raises `BackingOff`** and both
  collision bits on its first frame, and takes `BackingOff` down when it
  lands. So the leap back's landing puts up `ThrowerEmitGroundDust`'s column
  and the pounce's does not -- the other way round from before.
* **The landing clip plays.** The leap back used class 0x30's conditional
  setter, which refused while the arc's own clip was still on, so the actor
  stood in its flight pose and waited out the whole ninety frames. It goes
  through `SetCurrentActorMotionBlended` now: at the report's URL the rooftop
  `zsass` lands into clip 4, walks itself clear on that clip's root, and is
  back at the hub 38 frames after landing where it used to take 90.
* **Both states leave on the cursor**, two frames short of the clip's end,
  not when the port's one-shot channel happens to empty; the pounce is five
  frames shorter for it, and the pause counts ninety with `>=`.
* **Down, the pounce collides with nothing** (`0xffe7ffff` on landing), and a
  head still on its 0x2002 model cries out as it leaves.
* **`zslman` goes back where it came from.** It keeps its surface, records the
  point it pounced from and leaps back to it on its own surface's script,
  where the port sent it to a point beside the camera. Stage 6's first
  `zslman` now lands its pounce and returns to (484.4, -51.2, -9556.2), the
  spot it left, instead of (475.3, -51.2, -9574.3). Its four scripts were
  also exported at the wrong stride -- `0x30` where the engine names them
  `0x60` apart -- so on a wall it would have leapt back on a pounce clip.
* **`zskamere`'s standing attacks land.** `ThrowerStrikeConnect`'s throw-table
  arm, which `ThrowerStateWaitForPermit` sends type 0x17 to, was a `return`.
  Stage 4 block 2's first `zskamere`, perched in state 32, took a life at
  frames 327 and 528 of a driven run; before, it swung six times in 1200
  frames and never hit.
* **The hit frame is `==`**, and the connect latch is the callers' to test --
  the port tested it inside the connect, which was what stood in for the
  `==`. `ActorArcBeginToWaypoint` takes the attack draw itself, for `zslman`
  too, so a `zslman` pounce moves the `rand()` stream as the engine's does.

One divergence is declared: `zskamere` in state 10 is given no arc script,
because the engine's arm for it skips the copy and hands the arc twelve dwords
of uninitialised stack. No shipped run has been shown to reach it.

**The other three strikes had the same wrong bit, and now raise `0x10000000`
too.** `ThrowerStateCloseAndStrike` (state 24, `0x0044EB5F`/`0x0044EC52`),
`ThrowerStateStrikeOnTheSpot` (state 32, `0x00450BD2`/`0x00450C6D`) and
`ThrowerStateLeapStrike` (state 22, `0x0044E72B`/`0x0044E7F0`) raised and
cleared `BackingOff`. A linear sweep of `.text` for every 32-bit
`TEST`/`OR`/`AND` touching either bit says class 0x31 raises `0x20000000` in
the two retreats alone (states 10 and 25). What moved: a `zskamere` mid-swing
now shoves a zombie it bumps 1.8x as hard, because
`ZombiePushOutOfWorldAndActors` reads the shover's `0x18000000`
(`00454944`), and the dead-code state 22 no longer puts up the leap back's
dust column when it lands. No class-0x31 actor is distance-ranked, so
`RankEnemiesByDistance`'s `0x20000000` test never saw the wrong bit.

**`zskamere`'s standing swing is the listing, top to bottom.**
`ThrowerStateCloseAndStrike` (`FUN_0044EA50`) was re-read against the port.
Four departures went. The hit test is `obj+0x19C == entry+8` on every frame
behind no latch (`0x0044EC15`), in the play cursor's own unit. The swing cries
out with `ActorPlayHitVoice(obj, 3)` (`0x0044EC02`). Sub 0 writes
`g_players_in_play` into `obj+0x1360` (`0x0044EA93`). And a row the bundle
omits is the zero row the engine reads, not a port-only exit to state 25.
`obj+0x1360` is the thrower's arc phase, and nothing reads the value state 24
writes. Its connect takes the throw-table arm, and every `ActorArcStep` caller
zeroes the phase before its first step. Both clips now go through
`ActorSetMotionBlended(.., 0, 5)`, where the port cut to them. The swing's
cursor holds on 0 for the fade, and the clip ends on `g_motion_play_length`
rather than its authored length.

The same reading fixed the state on either side of it. `ThrowerStateWaitForPermit`
(`FUN_0044B3E0`) plays `0x2416A9` on every claim that leads to state 9 or
0x18 (`0x0044B526`, `0x0044B5A5`), which the port never played. A waiting
`zskamere` stands in its set's first idle with no draw (`0x0044B458`).
`ThrowerStateStrikeOnTheSpot` (`FUN_00450B20`) had the missing cry too
(`0x00450C30`). It also released the permit only when one was held, where
`FUN_0044CFB0` drops the off-screen latch either way. It now ends each clip on
`g_motion_play_length` and idles on the one track. `ThrowerStateLeapStrike`
connects while `IsPlayerAttackable` allows (`0x0044E7C1`), not while
`obj+0x121 >= 0`, which its own sub 0 guarantees. `ThrowerStateDelayedPounce`
already matched.

What moved, measured by `web/tools/close_strike.mjs` at stage 4 block 1 on
seed 1: the first `zskamere` claims at frame 69 and now plays `0x2416A9`, and
its swing starts at frame 70 with the cry `0x1617A9`. It takes a life at
frame 110, cursor 35, 40 frames into the swing. Before, the hit came at frame
105, 35 frames in, because the swing did not hold its first frame. State 25
follows on cursor 48, `g_motion_play_length(441) - 1`, where the port waited
for 51.

### A zombie's swing holds its first frame, and its run becomes its lunge

`ZombieStateStrike` (`FUN_00455A40`) sets both of its clips on the one track
with a fade: the lunge through `SetCurrentActorMotionBlended(obj+0x194, lunge,
0, 10)` at `0x00455B49`, and the swing through `ActorSetMotionBlended(obj+0x194,
strike, 0, 5)` at `0x00455B63`. Each call holds the cursor on frame 0 for the
fade. The port started both on its one-shot channel with no fade, so the arm
snapped up. Worse, the swing's cursor left 0 on the next frame, so every hit
landed six frames before the engine's. The swing now goes through
`ActorSetOneShotBlended`. Its cursor holds 0 for six frames and the hit lands
five frames later than it did, one frame short of the engine's. That last frame
is the port's clocks-before-states phase, which the arc work above found and
which covers every cursor test in the port.

The lunge moved to the ordinary track, where the engine has it. That is what
makes the engine's own test work: `00455b31 CMP [ESI+0x1b4], EAX` skips the
call while **the track** is playing the lunge. In 155 of the 311 shipped
attack entries the lunge is the same clip as the actor's run (`row[2]` or
`row[3]`), and `ZombieStateHoldAtRange` claims before it sets its idle. So an
actor that runs straight into its attack just keeps running into it, and the
run *is* its lunge. The port tested only its one-shot channel, so it cut back to
the lunge's frame 0 every time. On the base track the lunge also gets its
11-frame hold, stands still for it, and wraps as the engine's clip does; the
lunge was the one looping one-shot, and nothing sets `loop` any more.

### The canal is drawn by a task: class 0x41 type 1

Stage 2's block 16 stood on a dock over **no water at all** --
`?stage=2&mode=play&entry=0&block=16&step=14&op=1` showed a black void under
the boards and between the pilings. `docs/formats/water.md` said the surface
is region geometry and there is no water renderer, and for most of the canal
that is true. It is not true here.

Fifteen class-0x41 spawns in the game -- five in stage 2, seven in stage 3,
three in training -- carry constructor byte **1**, `PlaceWaterSurface`
(`FUN_00462F70`), which the port had never read: its entry in
`g_class41_constructors` fell to the generic fallback, found no placement and
did nothing. What it builds is a 0x44-byte task, `WaterSurfaceUpdate`
(`FUN_0046E3A0`, not even a Ghidra function until now), that **draws a water
tile every frame** -- `g_water_surface_slots[obj+0x1F4]` (`0x00593DA4`), ten
flat tiles in `st2_07`, `st1_1`, `komono_boss2` and `komono_venis` -- and
ripples its texture as it does. The script loads those tiles with opcode 0x50
or `asset_load_polfile`, and a slot that is only *loaded* is drawn by nothing:
`RegionDrawResidentSet` walks the current region's list and no other. Region
29, where the report stands, names four models and no water.

**What the task does**, all of it now in `game/class41/water.ts`:

* a lifetime in changes of `g_evt_step_index`, and five kill arms -- the
  canal tile at step 0xF, block 0x23 step 2 on stage 2, `flags[index + 0x0B]`
  and `flags[4]` on stage 3, `flags[0x77]` on stage 2 -- none of them in
  Boss mode;
* **the ripple**: while the tile is resident and a gate is open (flag 8 for
  the arena tile, camera path 0x6E for the death water, not flag 0x6A, not
  path 0x7E at frame 0x163, and in Training flags 0xF1/0xF2), every vertex's
  `u` gains `sin(phase(x)) * 0.00075` and `v` gains `cos(phase(z)) * 0.00075`,
  the phase being `tick * 0x180 + ftol(coordinate) * 600` in BAMS; with index
  0 only vertices at `z <= -1870` move. It is cumulative -- the model's UVs
  are rewritten in place -- so it is state, and it lives in `G` as two sums
  per tile (`G.g_water_surface_uv`): `sin(a + b)` factors, so the per-vertex
  term comes out of the sum and `render/water_surfaces.ts` applies it;
* every mesh header's TSP word gains `0x2000`, filter mode 1: a rippled tile
  samples **bilinearly**, where the exporter had turned its filter mode 0
  into `NEAREST`. Only the rippled tile -- `0x13A5`, drawn beside the arena
  water but never walked, keeps its point sampling;
* the draws: the tile, `0x13A5` beside `0x13A7`, `0x13AC` beside `0x13A9`;
  then flag 9 swaps `0x13A7 -> 0x13A9` and `0x13A0 -> 0x13A2`, and
  `0x13A2` turns back to `0x13A0` on path 0x6E -- in the same frame as the
  swap, since that line reads the slot the swap just wrote.

**How it is drawn.** A tile the stage glTF already holds is drawn as that
node, because in the engine the task and `RegionDrawResidentSet` draw one
model and the ripple shows in both; `StageScene.setWaterSlots` makes it
visible while the player has it resident (0x50-loaded, or in the current
region). The `komono_*` tiles are nobody's region, so they now travel in the
`slots_actor` rig and are cloned from it. The tiles the task owns are taken
**out** of `StageScene`'s "loaded and unregioned, so drawn" rule: that rule
was standing in for this task, and left in it drew stage 2's two death-water
tiles over each other and stage 3's before their task existed. A class-0x41
type-12 prop draws `0x13B5` in the boss's blocks too, and it gets the same
rippled model -- the layer rewrites every node drawing a tile, keyed by
geometry.

The bundle carries a `water_surface` placement per spawn with the slot
already resolved through the table, so this is a schema change and every
bundle needs re-exporting. `tools/verify_water.py` asserts the constructor
chain, that the table is ten flat water tiles, the fifteen spawns, and every
constant in the port against the immediate at its instruction.

What it does not do: the engine's ripple state lives as long as the model
and resets when a tile is unloaded and loaded again; the port keeps it for
the scene (`[diverges]`, and the one shipped reload is at most 0.02 of a
texture repeat out of phase). The walk's residency test is not modelled
either -- the port has no asset residency (opcodes 0x52..0x58 are "shown") --
so block 16 step 10's arena tile ripples three steps before `komono_boss2.bin`
arrives, while it is not drawn. And a seek replays every placer and runs
their constructors on the first live frame, so after a seek a task starts its
lifetime where the seek lands -- the same thing every class-0x41 prop does,
which is why the canal tile is still there after a seek into block 35.

### Zombies and throwers look at you

The head follows the camera now. Bone 2 of every class-0x30 and class-0x31
actor turns toward the eye raised 15 units -- up to a quarter turn from its
body's facing and its level, at `0xC0` BAMS a drawn frame -- and a thrower does
it on the ground and on the ceiling but not on a wall. The routine is
`ActorAimHeadAtCamera` (`FUN_00453BE0`), which the two node draw hooks call
for bone 2 and which Ghidra had no function for, so `combat.md` had recorded
the opposite as a settled result.

* **Where it is.** The two angles, `obj+0x1320`/`+0x1324`, are state on both
  arms (`HeadAimWords`) and are stepped by `class30/head_aim.ts` from the node
  walk each class's update runs where the engine draws. The turn is drawn by
  `render/characters/head_aim.ts` around each mesh the hook draws on bone 2 --
  its own model, a gore swap, a cel -- and not around the hair or hat hung on
  it, nor the hit sphere, which keep the pose's matrix in the engine too.
* **It starts aimed.** Both `Init`s seed the angles toward the camera, which
  is why the port now carries `g_camera_eye` in `G` for the spawn to read.
* **It aims from the last draw.** The point is the bone's hit-sphere centre as
  the previous frame left it, and a corpse stops refreshing it, so a dead
  zombie's head goes on turning from where it fell.
* **Captors do not look.** Every spawn that can reach one of the eleven states
  that use `obj+0x1320` for a motion id carries `obj+0x34` bit `0x40000`
  (`ActorFlag.NoHeadAim`), which gates the seed and the aim; so do all of class
  0x18's.

What is not done: class 0x25's twin (`ScriptedHumanoidAimHeadAtCamera`, an
absolute turn on two other words, switched by an op no exported program
uses), and Training's hook swap, which is declared on both updates.

**Into the lens, not above it** (2026-09-28, evening). Until then every aimed
head in the game craned up -- about 35 degrees on average over stage 1 block
1, 58 at arm's length. `ActorHeadAimAngles` (`FUN_00453D70`) aims at
`g_camera_eye` raised 15, and `g_camera_eye` is the *gameplay* eye, which the
path hooks put 15 below the pose; the port added the 15 to the lens, the
camera the renderer drew, and so aimed at a point 15 above the camera. It
reads `g_camera_eye` now, as the exe does, and a head at the camera's height
looks level into it. The record the aim starts from is also taken in the view
of the frame that drew it (`HeadAimWords.headRecordView`) rather than the next
frame's, so a moving camera displaces it for one frame as the engine's does.
Measured on `?stage=1&block=1&mode=play&drive=1&seed=1`, 104 aimed samples
over 900 frames: mean head pitch -6323 BAMS (-34.7 degrees, up) before and
+415 (+2.3, the head sitting a unit above the lens) after; the pitch the head
should have to look into the lens is missed by 37.0 degrees on average before
and 0.3 after.

**And every other reader of the eye** (2026-09-28, night). The head aim was
one reader of a wrong eye; there were about fifty. `GameUpdate` was handed
`ctx.view.eye` -- the drawn camera, as the last draw left it -- and every class
update read it as `ClassFrame.eye`, where the engine names one of three points
by address: `g_camera_eye` (`0x009C71E0`), the gameplay eye, fifteen under the
rail's pose; camera block 0's eye (`0x009A60C0`); or the block
`g_camera_index` names, which is block 2 under scene state (1, 3). The frame
carries no eye now, so a reader has to spell the one its instruction names;
the per-routine table, with the address of every read, is
`docs/formats/cam.md` § *Which eye*. Ground distances and turns could not
show the error. Heights, 3D distances and aims did, and each moved to the
exe's, measured in the page (`?drive=1&seed=1`), before -> after:

| | before | after |
|---|---|---|
| stage 2 block 21, the delayed pounce's target height | 51.0 (the lens) | 36.0 (`g_camera_eye_y`) |
| stage 5 block 2, `zslman` hanging off the camera, over `g_camera_eye` | 45.0 | 30.0, dropping onto the gameplay eye |
| stage 6 block 0, the first `zslman` pounce: from `g_camera_eye`, ground / up | 12.98 / 3.52 (the screen point) | 10.00 / 4.50 |
| stage 1 block 1, the first strike's remembered point, y | 8.28 (the lens) | -6.72 (`g_camera_eye_y`) |

(The stage 2 block 21 note above reads "at `g_camera_eye_y` (51)": the 51 was
the lens.) Three changes are more than the eye. The **distance rank** is the
engine's list now: `RegisterForDistanceRank` files the **ground** distance to
`g_camera_eye` from `EnemyZombieUpdate`'s own frame, and the next frame's rank
task sorts it -- it had sorted the pool on the 3D distance to the lens.
`ThrowerStateCloseAndStrike` called `ActorFacePlayerTarget`, which stored the
eye over the landing point it had just picked, so the strike's range test
measured to the camera; it turns its yaw alone now, as the exe does.
`ThrowerPickLandingPoint` had no `zslman` arm at all -- it lay past a
`MatrixStackPop` Ghidra marks no-return -- and `zslman` lands ten units in
front of `g_camera_eye` at a stance's height. Class 0x10's op `0x26` with no
point walks to `g_camera_eye`, not the world origin. The drawn block's yaw is
read through the index by the twenty-odd routines that index it
(`CameraBlockYaw`), and the owl, the fish, the bats, the horde and five
class-0x41 props read the drawn block's eye (`CameraBlockEye`).

Playthroughs (`playthrough.mjs --headless --continue`, stages 1-6) against the
tree before: stages 1, 2, 3, 5 and 6 end where they did (1 reaches its end
240 frames sooner; 5 and 6 still hang at block 1 1/69 and block 2 1/77);
**stage 4 now spends its sixth credit at block 6 where it used to reach the
end on five.** It is chaos rather than one bug: putting back either the old
rank or the old eye in `TurnActorTowardCamera` alone -- whose point turns by
`ftol(eye.y)` BAMS, 49 against 34 -- restores the old run.

### Stage 2 block 11: the fire strip ends

Reported at `?stage=2&original=1&mode=play&block=11&step=1&op=28&frame=0`:
"the fire sprites that appear after the car crashes into the wall don't
disappear". They were one object, the game's **only** class-0x41 type-33
spawn (evt `0x6A14`, block 11 step 1 op 20, in both stage-2 scripts): slot
`0x174A` = `eff_shop.bin[0]` with a roll word of `0x3B`. The port placed it as
`Generic`, which has no update for type 33, so `obj+0x2A0` never moved and the
renderer drew `eff_shop.bin[0]` -- three fireballs -- for the rest of the
stage. Its only other exit was the shared lifetime prologue counting 5962 step
changes against a slot number.

`PropDrawOnlyType33` (`FUN_00472950`) is a draw, a step and a kill, and
**nothing else** -- no `PropExpireByStepLifetime`, no shot test. The tail is
past the `MatrixStackPop` Ghidra ends the body at (`L37`): `obj+0x2A0++`, and
`JMP ActorKill` once the *post-increment* value passes `obj+0x2A4`. So a roll
word of `0x3B` draws cursors `0..0x3B` -- sixty frames, `0x174A..0x1785` --
and dies on the frame that drew the last. It is now its own
`PropFamily.DrawOnlyType33` in `game/class41/draw_only.ts`.

**Where in the frame it steps is part of the port.** The engine draws, then
steps. `ActorAlloc` puts the object after its placer and `TaskRunTree` reaches
it that same frame (the placer's `ActorKill` leaves its own next pointer
intact), so the engine draws cursor 0 on the frame it is made. The port's draw
is the renderer's, after the whole frame, so the step runs where the sprite
effects' and water rings' do -- at the head of the next frame, from
`ShotEffectsTick` -- and the pool's walk skips it. Stepped in the pool walk
instead it would show cursors 1..59 and never 0; `web/test/port.test.ts` drives
a placer through `GameUpdate` and asserts the sixty slots in order, and fails
both that mutation and the old `Generic` family.

Measured in the headless player, driven frame by frame (`?drive=1`) from op 18:
before, the prop sat at cursor 0 through the end of `cp_st2[2]` and into
`cp_st2[14]`; after, it reaches cursor 58 at `cp_st2[2]` frame 399 and is gone
by frame 3 of path 14. At the report's own URL a seek places the prop on the
first live frame (as it does every class-0x41 prop, see above), so it plays its
sixty frames over `cp_st2[14]` 0..59 and is gone at 60 -- where before it was
still frame 0 at the end of the path.

### The cat runs: class 0x53's playlist, and the clip that was never baked

`?stage=2&original=1&mode=play&block=11&step=7&op=32&frame=1012` showed the
cat in the corner of the room **not moving**, where the game has it run off
screen. Two faults, one in each half, and either alone would have kept it
still.

**The port had no routine for it.** Class 0x53's module ported the trigger
(sub-type 2, block 8) and nothing else; sub-types 0 and 1 -- three of the four
spawns, block 11's among them -- had an empty update and looped whatever clip
the spawn gave them. Their routine is `CatMotionListUpdate` (`FUN_00431340`,
unnamed until now): a playlist of up to five clips per animation set in
`g_cat_motions` (`0x00589A64`), each played the number of passes
`g_cat_motion_repeats` (`0x00589AA0`) gives it, the next one **written straight
into `obj+0x1B4`** when the counter reaches `play_length - 1`, and an
`ActorDespawn` once the cat has lived 1000 frames. Nothing in it moves the cat:
the last clip of four of the six sets is `0x2FD`, 12.7 units of root motion a
pass, and `SkeletonApplyRootMotion` does the rest from the draw. Block 11's cat
is set 5: `0x305` twice (it stands, 114 frames), `0x2FC` once (it creeps 2.6
units, 78 frames), then `0x2FD` until it is taken away -- about 230 units,
out through the bottom-left of the shot and past the camera.

**And the bundle had no clip to run with.** The exporter's rule for class
0x53 baked entry 0 of each spawn's set, so character type `0x1A` carried
`0x2FC`, `0x2FF`, `0x301` and `0x305` and no `0x2FD` in any stage. The
exporter now offers the whole table (`CAT_CLIPS`, data-only in
`game/class53/records.ts`, the `class22/records.ts` arrangement), and all
nine clips reach both stage-2 bundles. With the port fixed and the old bundle
the cat steps on to `0x2FD`, finds no frames and no play length, and stops
after 2.7 units -- which is exactly what `tools/animals.mjs`'s new travel
assertion measures on the old export.

**The rest of the class, read in the same pass and transcribed with it:**

* `CatInit` raises `obj+0x38` bit 3 for sub-type 1 -- block 11's cat is drawn
  through the scene light array, three instructions after the block turns the
  scene lighting on -- writes the trigger's `obj+0x124 = 4.0`, and despawns an
  arcade trigger with `ActorDespawn` rather than marking it dead.
* `CatBranchTriggerUpdate` was the branch write and nothing else; it now cues
  `0x2FA` after 200 frames, blends to `0x2FD` on the shot and runs until
  `x < -478`, where it settles on `0x305`, and despawns on
  `g_script_flags[0x83]`, which stage 2 raises in block 8 right after it frees
  `cat.bin`. The port used to set `dead` on the shot, which dropped the cat
  from the scene where the game shows it bolting. It also stops clearing
  `obj+0x34` bit 3: the engine never does.
* **The shot test is the engine's now** (`registersForShotTest`). The trigger
  ends in `ActorRegisterOriginInViewSpace` (`FUN_0043F950`), whose
  `RegisterForShotTest` call Ghidra's pseudocode drops after a `MatrixStackPop`
  it believes does not return (`L35`), so it is hit as one 4.0 sphere about its
  feet. The list cat never registers at all, and so cannot be shot -- the
  renderer's bone-sphere pick used to let it be.

Measured in the headless player (`HOTD2_BUNDLE` at a fresh export): at the
report's URL the cat stands on `0x305` for 114 frames, creeps on `0x2FC`, runs
on `0x2FD` from frame 192, and is gone at life 1001; before, it stood at
`(-890, -1015)` on `0x305` for twenty seconds and never left. Played from its
spawn (`op=8`), it runs out of the frame-1010 shot 2.5 seconds after the camera
settles on the room.

What is still not the engine's: `obj+0x1FC`, the rotation order, has no field
on an actor without the model block, and every shipped cat turns about y alone.
And the shared root-motion step (`rootDelta`) gives a looping clip's wrap frame
zero travel where `SkeletonApplyRootMotion`'s damped reset gives it one average
step -- about 2% of `0x2FD`'s distance, and not the cat's alone, so it is left
for its own change.

### Translucent meshes are drawn the engine's way: two passes, depth written, nearest first

The report was a car: `?stage=2&mode=free&entry=0&block=1&step=1&op=17`, the
two parked cars in the opening street (`char_adv04`, class 0x33's
`prop_0668_s`), "translucent windows, not rendering properly at all". Black
slabs lay across the doors and the roof. The car's body is three translucent
shells, and inside them, just smaller and sharing no vertex, three black
copies that are the interior; the player drew the far side's interior over
the near side's paint.

The player had never used the engine's composite state. `GLTFLoader` turned
every `alphaMode: BLEND` material into `transparent: true, depthWrite: false`
with three.js's normal blend, and three.js sorted each glTF *primitive* on its
own bounding sphere, farthest first. The engine does none of that
(`render/draw_order.ts`, from `TranslatePvr2StateToD3D` `FUN_004A7780`,
`WalkMeshChainAndDraw` `FUN_004A7EF0`, `RenderFlushCommandList` `FUN_004A88E0`
and `RenderCommandCompare` `FUN_004A8A20`):

* **The pass is the TSP's**, `(tsp & 0x180000) != 0x80000`, not the list type:
  translucent-pass meshes blend and alpha-test at ALPHAREF 1, opaque-pass ones
  do neither.
* **Every mesh writes depth, translucent ones included**: ISP bit 26 is clear
  and the compare is `LESSEQUAL` in all 82,494 meshes in `pol/`.
* **The blend factors are the mesh's own.** 5,408 meshes are additive
  (`SRCALPHA`/`ONE`) and 54 in `boss6` are `INVDESTCOLOR`/`ZERO`; all of them
  had been ordinary blends. Stage 6's enemies' blades glow now.
* **The translucent pass sorts whole models, nearest first**, each drawn in
  chain order. The key is the least eye z of the model's origin and every mesh
  pass 0 skipped, and the eye space looks down -z (`RenderInitStates` installs
  `VIEW = diag(1, 1, -1, 1)`), so the sort is by the farthest point, nearest
  first. The docs had it as "farthest first, painter's order".
* **Layer 7** -- `RegionDrawResidentSet`'s draw mode 2, two stage-1 models --
  sorts before the world's layer 8.
* **A fading draw** (`AssetDrawSlotWithAlpha`, `DrawModelWithForcedAlphaBlend`
  `FUN_004A8440`) is one path now for the effect layers, the slot models and
  the rain: every mesh deferred, blended `SRCALPHA`/`INVSRCALPHA`, at the
  mesh's own base alpha times the draw's (it had replaced the base alpha), and
  still writing depth -- the rain had turned its depth write off "or the drops
  occlude each other", which is what the engine lets them do.

The exporter gives every primitive `hod2_model` (the rare rig part that draws
two slots is two commands -- stage 1's car body) and `hod2_sphere`, the mesh
header's own sphere, which is not the bounding box's centre for one mesh in
ten. **Re-export every bundle**; an older one sorts on the geometry's sphere
and treats a two-slot part as one command. `tools/verify_draw_order.py` checks
the tables, the pushes and the sign of the sort against the EXE, and the
corpus premise.

What is not done: the opaque pass keeps three.js's front-to-back order rather
than the engine's submission order, which differs only for coplanar opaque
surfaces; the player's own transparent meshes (labels, debug overlays, the
deep screen sprites) sort after the NL1 commands of their layer rather than by
any exe rule, and the queued sprite quads' own layer (`0x007E78B8`, 0) is not
modelled. (The exporter's alpha stripping that was listed here is done: see
the next section.)

**The water at block 16 step 14** (the report's second item) was already
drawn by the time this was read -- main's class 0x41 type 1 port, above --
and its four tiles are opaque-pass meshes, so none of this changes them.

### A texture keeps its alpha, and a mesh keeps its own material

Two exporter faults in `gltf.ts`/`gltf.py`'s material writer, both read
against the EXE (`docs/formats/materials.md`, *Texture alpha on the D3D path*
and *One material per mesh*):

* **Texture alpha is the bank's.** The exporter wrote an alpha-stripped
  `_opaque` image for every mesh with `IgnoreTexAlpha` (TSP bit 19) -- the
  PowerVR2 meaning. On the PC the texture is decoded once per bank slot with
  no mesh word as input, uploaded in a format that keeps the alpha
  (`A1R5G5B5` for ARGB1555, `DDPF_ALPHAPIXELS` tested), and stage 0's alpha op
  takes the texel's alpha; bit 19 is read only as half of the pass selector.
  So the opaque pass ignores texture alpha by its state and the translucent
  pass blends by it. 101 translucent-pass meshes set the bit on a texture with
  alpha below 255: `zslman`'s and `zndina`'s additive blade glows drew as
  solid cards and are shaped now (stage 6 block 0, 3-4% of a close crop
  changes, all on the glows). Opaque-pass meshes on textures with transparent
  texels come out byte-identical (stage 2's clock-tower shot: 0 pixels of
  588,800 differ). The glTF `alphaMode` is the pass.
* **One material per mesh.** The material cache left the base colour and the
  culling out of its key, so about a fifth of the game's meshes drew with an
  earlier mesh's colour -- baked lighting and base alpha. The stage-2 car's
  driver's door drew black in the rescue branch (the inner copies' black, same
  texture 33 and TSP) and is red now; stage geometry shifts by up to ~60
  levels where two segments shared a texture at different lighting.

Two render paths leaned on the stripped images:

* `setAssetDrawAlpha` (`render/draw_order.ts`) is the one fading draw for the
  effect layers and the slot models, and takes `null` for `AssetDrawSlot` and
  a number for `AssetDrawSlotWithAlpha` -- **1 included**: the engine does not
  test the argument, so a draw at 1.0 is still
  `DrawModelWithForcedAlphaBlend`'s, which blends an opaque-pass mesh's
  texture alpha. The layers used to keep the plain draw at 1. Records that
  encoded "plain" as 1 (the ring effect's spread and hold, the boss-3 path
  effects inside their window, the owl ring's pulse, the horde's plain parts)
  say `null` now; every slot drawn at exactly 1 today is translucent
  `SRCALPHA`/`INVSRCALPHA` at base alpha 1, so no picture moved.
* The blood-colour transpose read the map through a 2D canvas, which is
  premultiplied: the colour under a texel at alpha 0 came back black, and 904
  opaque-pass gore meshes have such texels. It reads the map back through
  WebGL with premultiplication off.

**Re-export every bundle.** `tools/verify_texture_alpha.py` checks the EXE
bytes, the bit-19 scan, the corpus premises, and -- on a bundle this tree's
`gltf.ts` wrote -- that no image is `_opaque`, that the `IgnoreTexAlpha`
ARGB images carry the bank's alpha, and that every model primitive holds its
own mesh's colour and culling.

Not done, and not this change's: the character layer draws a bone or part at
any alpha above 0 solid (`render/characters/draw_gates.ts`), where the exe's
`AssetDrawSlotWithAlpha` draws blend -- the class-0x30 twin of type 9 at 0.25
(`EnemyZombieInitByCharType`), `ZombieSubmitSlotByLighting`'s fade-in while
`obj+0x1368` bit `0x20` is up, and `ThrowerDrawBonePart`'s triangular fade on
slot `0x1FB9`. With the alpha now in the images, drawing them through
`setAssetDrawAlpha` would be faithful as it stands. (Done since: see the next
section.)

## Original Mode's collectibles, and the four routines beside them: class 0x41 types 70 to 77

Types 70, 71, 72, 74, 75, 76 and 77 were placed and drawn with whatever
`obj+0x28C` held and did nothing, or -- 70, 71 and 76 -- ran their route
write and nothing else. Each is now its `g_class41_updates` row
(`class41/generic_routines.ts`), its routine transcribed from the listing with
its draws recorded where it makes them (`PlaySoundId` is marked no-return in
the database, so every one of these pseudocodes stops at its first sound;
`L35`). With them every one of the fifty generic routines is transcribed whole,
and the family-wide declared divergence, the pool's older generic arm and
`shot_test.ts`'s per-type offset table are gone:

* **70 and 71, `OriginalItemPropUpdate` (`FUN_004675A0`)** -- the collectible.
  Its model is **not** the descriptor's word: the constructor's arm calls
  `PickOriginalModeItem` (`FUN_004629C0`), which draws an item id out of the
  scene's `g_original_item_tables` row by weight and copies the item's model,
  its camera-facing second model and its scale from `g_original_item_records`.
  A 70 turns in place (item 29's model faces the camera); a 71 bobs and
  tumbles. Shot, it pays a hit, counts into `g_original_items_taken`, raises
  `SpawnOriginalItemBanner` (`FUN_00475E40`) -- the item's picture and a frame
  at the bottom of the screen for 150 frames -- and plays a 49-frame pickup
  strip while the item fades. Its scene rules (the stage-3 route write, the
  removals, `g_original_item_pickup_blocked`) are the routine's.
* **72, `PropUpdateType72` (`FUN_00470750`)** -- the same collectible, thrown
  up out of stage 2's canal at camera path `0x4E` frame `0x276` if
  `g_script_flags[0x12]` is up. Stage 2's script never raises that flag.
* **74, `PropUpdateType74` (`FUN_00470E20`)** -- three shots, and it drops a
  story item and falls away tipping forward; its Arcade exit raises
  `g_script_flags[0x13]`.
* **75, `PropUpdateType75`** -- now drawn: `0xA6B` at `op_` path `0x178`'s pose,
  riding it when shot, with its sounds and the blocked byte.
* **76, `PropUpdateType76` (`FUN_00471330`)** -- stage 4's door (block 14) and
  pair of leaves (block 5), drawn, swung open on hinge curve 0, with the route.
  The block-14 door stood missing from the level until now.
* **77, `PropUpdateType77` (`FUN_004717A0`)** -- a UFO (item 31's own model)
  flying `op_` path `0x195` while item 0x1F is held, worth 2000 points.

**`SpawnStoryModeItem` (`FUN_00467B90`) makes a collectible** -- the same
object, run by type 70's routine -- where the port used to emit an event and
nothing else, so a group member's, a falling container's, and types 58's,
69's, 74's and 75's story items now appear, turn and can be taken.

**One `PickOriginalModeItem`.** The item tables are `.rdata` and travel in the
bundle (`breakables.original_items`: the rows the stage's spawns can name --
now type 7's drop and type 43's break too -- and the records they name), and
every caller goes through the one function in `class41/original_item.ts`; the
TS copy of both tables `type07.ts` carried is gone, and with it the literal
item models in the exporter's rows for 7 and 43. `g_original_items_taken` and
`g_original_item_pickup_blocked` are in `G`, so the pickups of 7's drop and
43's wreck count the item and raise its banner, and 58 and 69 clear the byte
after their story item: five declared divergences fewer. The item release's
story arm is three copies in the engine and one in the port
(`ReleaseHiddenItem`), and it now knows which it is running: each writes the
blocked byte its own way, the kinded copy lifts a kind-2 prop's item 1.0 (it
had the set's rise), and the falling container's story item inherits the
container's `+0x199` lifetime (it had its shot count, 1, and left at the next
step). The bundle also
carries every model an item can wear and both pickup strips, and the banner's
pictures, which needed `TexBankPaletteIndex`'s palette `0x14` for banks
`0x156` and `0x193..0x1B4`. `MatrixClearRotation` is one function now
(`PropMatrixClearRotation`, `class41/prop_draw.ts`), where 7's drop and 43
each had a copy. `web/tools/collectibles_look.mjs` looks at the collectibles in
the page.

**One declared divergence**: on an odd blink frame a shot type 77 registers
three stack locals only its draw block writes; the port keeps the point its
last draw computed.

## Character fades: every node drawn the way its hook draws it

`render/characters/draw_gates.ts` drew a bone or a part at any alpha above 0
solid and hid it at 0, and said that 0 and 1 were every alpha the game gives a
character. They are not, and at 0 and 1 the faded draw is not the plain one
either: `AssetDrawSlotWithAlpha` (`FUN_004185A0`) hands its alpha on untested,
and `DrawModelWithForcedAlphaBlend` (`FUN_004A8440`) makes each mesh's
material alpha its base alpha times it with no test of its own -- so at 1 an
opaque-pass mesh's texture alpha shows, and at 0 the model is drawn invisible
and still writes depth (bits 19-20 are kept, so an opaque-pass mesh is not
alpha-tested). What the player does now:

* **Each node's draw is state.** The hooks the port runs write, per bone, the
  draw they chose into `Actor.nodeDrawAlpha` -- `null` for `AssetDrawSlot`, the
  alpha for `AssetDrawSlotWithAlpha` -- and `draw_gates.ts` fades every mesh
  that node's draw covers (its own model, a gore piece, a cel) through the new
  per-mesh `setMeshDrawAlpha`. `DrawCharacterPartSlot` (`FUN_00419B40`)'s four
  types (9, 0x12, 0x17, 0x18) have their parts drawn at `obj+0x138C` always,
  1 and 0 included. Attachments stay plain: `ActorDrawAttachedParts` draws
  them through `AssetDrawSlot`.
* **Class 0x30** (`game/class30/draw.ts`, `init_char.ts`, `twin.ts`).
  `ZombieSubmitSlotByLighting` (`FUN_00453AE0`) is ported: the light array
  first (`obj+0x136C` bit `0x20` under `g_scene_lighting`, never faded), then
  `obj+0x1368` bit `0x20` for the fade. `EnemyZombieInitByCharType`
  (`FUN_00452FD0`) sets up the two fades -- `znele` (type 0x12) at 0 stepping
  1/30, the twin (type 9) at 0.25 stepping 1/60, both after a hundred draws --
  and `ZombieDrawBonePart` (`FUN_004534A0`)'s `0x1C6C` and `0x1C7C` arms run
  the clocks: `znele` fades in over thirty frames, and at the end gets its
  pushes and its shot test back (its head aim stays off) with
  `PlaySoundId(0x2225A9)`; the twin fades
  out over sixteen. **The twin exists now**: the type-0x12 arm allocates it
  unless `obj+0x34` has `0x10000000` (two of stage 6's thirteen do), and
  `ZombieTwinFollowHost` (`FUN_00453290`) is its whole update -- it wears the
  host's transform and clip, runs no state, is counted into neither enemy
  count, has the minimum hit points (`ActorInitHitPoints` overwrites the 999),
  and despawns the frame after its alpha reaches 0 or when the host dies. The
  exporter writes it a synthetic row (`zombieTwinPlacements`,
  `hod2lib/characters.ts`) with `znjikken1.bin` and every clip its host's type
  has; re-export the bundles.
* **Class 0x31.** `ThrowerDrawBonePart` (`FUN_00449F90`) records `null` or the
  alpha through `ThrowerDrawPartAlphaIfBlinking` (`FUN_0044A280`); the
  blinking states' 0 and 1 are faded draws, not "hidden" and "solid".
  `EnemyThrowerInit` writes `obj+0x138C` per type as the exe does -- a
  `zslman` starting in state 34 is born at 0, blinking and shadowless -- and
  the blink states read `g_blink_frame_counter`'s low bit
  (`0x0044F0C2`, `0x0045149C`), not the port's fractional `g_frame`. The
  `0x1FB9` ramp is `zskamere`'s bone 9 and is `[likely]` never reached by a
  shipped spawn (see `class31/draw.ts`); a debug write of bit 2 shows it.
* **The fade composes with the lighting layers.** A fade is over whatever the
  mesh draws: the lighting view's twin and the gun light's are swapped in
  underneath it (`setUnfadedMaterial`), a gore swap or a cel write is read
  back as the new unfaded material, and a clone a layer saved is seen through.
  The clones keep `onBeforeCompile` (fog, and the lit twins' shaders), which
  the old per-node clones lost.

What that looks like, in `?stage=6&mode=play&block=0&step=2&op=19`: for the
first hundred frames each `znele` is a quarter-alpha twin with nothing under it
but its depth, then the twin fades and `znele` fades in. The depth is visible:
an invisible actor in front of translucent geometry keeps that geometry off
its silhouette, as the engine's would if its sort puts the actor first -- the
port's sort is the engine's (`RenderCommandOrder`). The same is true of a
blinking `zslman` on its odd frames (`?stage=6&mode=play&block=0&step=4&op=2`).

Not done: the twin's parts and cels are drawn with the exporter's UVs, where
`AssetSlotUVsFromViewNormals` (`FUN_00418660`) rewrites them from the normals
each frame (`[diverges]`, `class30/twin.ts`). Three more characters fade in the
exe and are not ported at all, so they are not drawn solid either -- they are
not drawn: class 0x25's `0xE24` flash (`ScriptedHumanoidBoneDrawHook`), the
golden frog (`GoldenFrogDrawBonePart`) and class 0x2D's node hook at
`0x00429040`. Class 0x40's `SubModelDrawBoneHook` fade is unreachable:
`HordeMemberInit` writes `obj+0x1338` = 0 and nothing else writes it.

### Every caller of the ring effects, where the exe calls it

`SpawnGroundRingEffect` (`FUN_00407DA0`), `SpawnRingEffectAtPose`
(`FUN_00408370`) and `SpawnWaterRing` (`FUN_004567C0`) have twenty-six call
sites -- every `E8` rel32 in `.text` aimed at one of the three, which is the
same list Ghidra's cross-references give. All of them are wired now but the
frog's (class 0x11, another session's):

* **Class 0x31's corpses** open the ground ring on their first frame, as class
  0x30's do. `EnemyThrowerInit` raises `obj+0x1F8` bit 4 as `EnemyZombieInit`
  does, so the ring sits on the traced floor; a body frozen on clip 0x3A6 is
  lifted 5.5 for the call. `ThrowerStateCorpseSink` and
  `ThrowerStateCorpseBlink` are two functions again, the pose pin draws its
  `rand()` every frame (a corpse can twitch between its two frames), and the
  way out is the exe's -- no `ThrowerLeave`, the camera slot only for
  `KeepCameraWhenLast`.
* **The rescue target's freed body** leaves the car:
  `RescueTargetFreedDrift` (`FUN_00451F40`) carries the car's last frame of
  travel and bleeds it out over frames 11..20, eases the body to the ground
  plane and levels its roll. The freed clip is blended in at cursor 15; when
  `RescueTargetDraw` reports it over, the ring opens and
  `RescueTargetSinkAndDespawnState` (`FUN_00451DF0`, a function Ghidra did not
  have) sinks the body for 120 frames on the clip's last frame and despawns
  it. The class steps its own clock now (`advancesOwnMotion`), which is what
  lets the freed state stop it. The abandoned state rides the route on.
* **A severed head** leaves a 0.25 ring every time a soft head bounces and a
  0.5 one as any head settles; it is thrown along the camera **block's** yaw,
  which is forward, not `g_camera_yaw_bams`, which the scene hooks keep half a
  turn round.
* **The wading splashes** (`class30/splash.ts`): `ZombieStrikeStartSplash`
  and `ZombieStrikeFrameSplash`, `g_class30_states[0x39]` and `[0x3A]`, as the
  swing starts and 0x14 play frames before it ends, for body condition 6 on
  water; state 23's grab takes the first as sprite 0x62 and ends in another.
  The wading clip 0xB8 throws its splash at play frames 0x15 and 0x1B, and its
  two water rings at 0x1B, in `ZombieStateSurfaceOnCameraCue` and the captor
  script; the captor script's clip 0xB2 throws its prop strip at 0x16.

Three sub-state fall-throughs went with it (states 13 and 23, and both corpse
states), and `obj.frozen` -- class 0x24's `obj+0x1324` -- is no longer written
by two class-0x30 entrances.


### zslman's blades trail afterimages, and a zombie that has been shot runs

Two exe behaviours that were known and declared away.

**The afterimages.** `ThrownWeaponUpdate` (`FUN_00450780`) ends, drawn or
not, by calling `ZslmanBladeEmitAfterimage` (`FUN_00450930`) for a character
type 0x18 weapon that is launching or flying (state 0, sub < 2) or has been
shot out of the air (state 1). Every fifth frame — `DEC` then `JNS` on the
launcher's 4 — while fewer than ten are out, it allocates a task running
`ZslmanBladeAfterimageFade` (`FUN_00450A30`) with a copy of the blade's pose,
its tilt and its spin, and swaps the model: `0x1FE1` → `0x1FE4`, `0x1FE2` →
`0x1FE5`, `zslman.bin` parts 13 and 14, single additive meshes, at a light of
0.75. The fade stands where it was made and draws for fifteen frames under
`SetRenderLightColour(l, l, l)` with `l` a fifteenth less each frame, so it is
below zero — black, and additive black adds nothing — for its last four. It
goes at once when its blade lands, and gives its place in the blade's count
back unless the blade is spent, which a blade that has been shot down is — so
a deflected blade trails until its count reaches ten and then stops.

In the port the afterimage is a third routine in `G.g_thrown_weapons`
(`ThrownWeaponRoutine.ZslmanAfterimage`), appended to the list the pool is
walking so it runs on the frame it is made, as `ActorAlloc`'s tail link has
it. The record carries the light colour its draw set, and
`render/projectiles.ts` multiplies the node's own material colour by it, out
of gamma space. The exporter puts `0x1FE4` and `0x1FE5` in zslman's hidden
rig (`THROWER_AFTERIMAGE_SLOTS`), which no hand kit names.

Found on the way: **nothing after `ActorDespawn` runs.** `ActorKill`
(`FUN_004A7040`) `_longjmp`s back into `TaskRunTree`, so a weapon whose state
routine despawned it is not drawn that frame and trails nothing. Both weapon
routines drew it anyway; both return on the despawn now.

**The sprint.** `ZombieOnShot` (`FUN_00453EB0`)'s per-player loop opens, for
every landed shot that `ShotImmune` has not refused, with `obj+0x136C &=
~0x400` (`AND DH, 0xFB` at `0x00453F14`) and `obj+0x34 |= 0x8000000` (`OR ECX,
0x8000000` at `0x00453F17`), stored at `0x00453F24`/`0x00453F2A` — before the
death latch and before the test for dead. `0x8000000` is the bit
`ZombieStateAttackRun` takes the second of its run pair with and turns 2.5
times as fast on (`0x410` BAMS a frame against `0x1A0`), so **a zombie you
have shot and not killed comes on at a run**, whatever its spawn record said.
`0x400` is `EntryClipPlaying`, the entrance-clip exemption from
`ZombieStateHoldAtRange`'s too-close retreat and attack refusal, which a shot
ends. The latch test moved ahead of the live/dead split with it, where the
exe has it.

And reading that loop whole turned up **the voice misreading** above: the dead
arm's `CMP EAX, 2` is on the shot bone.

Observed in the running player (`web/tools/afterimages.mjs`, headless, stage
6): see the session log for the numbers.


## The bosses' shared furniture: the health bar, the name banner, the shot test

Four bosses end stages 1-4 -- Judgment (class 0x22 with its companion 0x23),
the Hierophant (0x14), the Tower (0x45) and Strength (0x19) -- and three things
every one of them leans on belong to none of them. They are ported once, in
`game/`, and each boss calls into them where its exe routine does.

**The health bar** -- `game/boss_hp_bar.ts`. `BossHpBarSpawn` (`FUN_00435E50`)
is called from every boss's entrance with a screen point (`(320, 35)` for all
the ones read), and from then on the boss only writes a float,
`g_boss_hp_fraction` (`0x009C8E10`), hit points over maximum. The bar is a task
of its own (`BossHpBarUpdate`, `FUN_00435C80`): the shown fill climbs 0.01 a
frame to meet the fraction -- the fill-up at the start of a fight, which in
single precision takes 101 frames, not 100 -- an amber trail drains 0.001 a
frame behind damage, `-1.0` kills it and `0.0` blinks it out over 120 frames.
Four sprites from `tex/scr_bosmater.bin`: blue fill, amber trail, red empty
track, and the metal frame. They go through `DrawScreenSpriteLayered`
(`FUN_0041C800`), a layered queue flushed after the task walk, which the port
now has too (`screen_sprite.ts`). The class-0x14 port had listed `0x00435E50`
as "the screen shake".

**The name banner** -- `game/boss_banner.ts`. `BossIntroBannerUpdate`
(`FUN_00437AC0`) had been ported inside class 0x19 as its lifetime and one
shutter write. It is the tarot intro. On its script flag it stashes the camera
block, holds the camera driver off (`g_camera_driver_held`, `0x009CA094`, which
now makes `CameraDriverSelectMode` run mode 6, the hook that does nothing) and
flies the camera along its own `cp_` path for 300 frames. Eight pages of a file
turn over in camera space and the boss's own page grows beside its name --
"JUDGMENT / Type 28", "STRENGTH / Type 205", from `scr_bosmater_stN.bin` on
palette 10 of `TexBankPaletteIndex`. On the last frame it puts the camera back
and sets the shutter to 1, the gate every entrance waits on. Seven records,
one per call site (`boss_banner_records.ts`); the Tower has its own intro card
instead.

**The shot test**:

* `RegisterForShotTest` (`FUN_00405160`) never lists an actor whose `obj+0x34`
  has bit `0x8000`. The port's picks shot everything visible; they honour the
  bit now (`ActorFlag.NoShotTest`), which is what makes a boss unshootable
  through its entrance.
* The registration itself is ported now (`game/combat/shot_test.ts`), with
  `ShotTestSphere`'s `obj+0x124` broad phase and the bit-`0x80` fork. A boss
  opts in with `ClassHandler.registersForShotTest` and calls
  `ActorRegisterCameraPoint` or `RegisterForShotTest` where its routine does.
  Every boss's site, gate, `obj+0x124` and `0x8000` writers are tabulated in
  `formats/combat.md` §3.
* `MarkActorShot` keeps one hit byte per shooter at `obj+0x190 + player`, which
  the port had merged into one `pendingHit`; `Actor.shotBones` is the engine's
  shape, for the bosses' own shot routines.
* A skeleton walk capped at depth 12 in both `hod2lib` halves had cut the
  stage-3 boss's heads to 13 of their 19/26 nodes -- no jaws, no weak bones --
  and `tools/verify_skeletons.py` now holds every skeleton to the EXE's bone
  count.

## The Hierophant, class 0x14: the stage-2 boss, whole

Stage 2's four endings and stage 5's cameo are one class, and it opens 21 of
the game's `wait_script_flag` gates. The first port had the state machine and
the flags and none of what makes the fight a fight; phase 2 transcribed the
rest, and the reading is `docs/re/boss-hierophant.md`.

**The gate chain on stage 2 is the banner's.** No stage-2 boss block sets the
shutter; the entrance spawns the boss-name banner (records `0x005966B8`,
`0x005966F8`) and raises flag 9, the banner flies the camera for 300 frames and
opens the shutter, and the entrance hands over on it -- flag 10, the health
bar at (320, 35), `g_boss_engaged`. The old test set the shutter by hand (L49).

**The engine's own model block, in `game/`.** The boss's weak point is a
sphere and a cone on bone 1, its feet pull its `y` onto the pier, its legs are
solved against the ground and its deaths wait for bones 1 and 2 to reach the
water -- all gameplay, all reading the pose the same frame's draw wrote. So
`game/skeleton.ts` carries the engine's skeletal model block
(`SkeletonDrawWalk` and everything under it, `ActorBuildSkinnedModel`,
the model-block arm of `ActorShiftToHoldBone1Position`), and `Class14Update`
poses and clocks it after the state, where the exe does -- the class says
`advancesOwnMotion`, so the director's clip advance before the state is not
made for it. `render/` draws it
from those matrices (`render/characters/model_block.ts`): the y-follow step
along the camera's up, the legs composed from the eased IK angles, the two
flipbooks on bone 1.

**Shot through a window.** Only bone 1 damages it, through a 3.5 sphere four
units up the bone (`RayTestSphere`, in view space, the shot record's angles),
with flipbook B at least 19 frames open and the entry point inside that
frame's cone. The flipbook's close is always at -1.0 whatever the timing row
says: the exe's own rate clamp takes anything below -1.0 up to it. Damage is
`g_class14_bone_damage[rank][players-1]` as it stands in Arcade -- the port had
doubled it everywhere -- and multiplied by the weapon factor only in Original
Mode (the factor is 1.0 for every weapon the game hands out). The boss joins
the faithful shot test through `ActorRegisterCameraPoint` at `0x0047621E`.

**The summons are paced by three things at once**: `SpawnWaterEnemyAt`
refuses while a water slot is held, the placement waits for fewer than four
enemies alive and for the screen shake to stop, and a round ends only with the
boss alone. The fish are sub-types 1 (round A, one under the surface) and 2
(round B, ten under, three `rand()`s a fish), seated on the wave field of
classes 0x16/0x17, ported for this. A refused spawn still spends the round's
count -- the exe decrements after the call whatever it returned.

**What changed for a player, plainly**: the stage-2 fight now starts (it could
not before); the boss can no longer be shot during its entrance, nor anywhere
but its weak point, nor through a phase change; Arcade damage is halved back to
the exe's; losing a life always costs 3 rank with one player; a round's rank-up
needs no life lost; summons wait for the shake; the boss's `y` follows the
pier; Reposition and the side leap land at the latched target's z; the camera
sees the boss again at Reposition's frame 10; Strike turns the boss; round B
swims away the right way round; the scripted breaks fly the camera along
`cp_` 0x6C/0x6D for 161 frames; the deaths teleport, sink, splash and float
the body on the wave field before it leaves `g_enemies_present`; the sounds and
the partner's "Left."/"Right." play.

**A volley is not a trigger** (`L50`). Driven by `playthrough.mjs --boss`,
stage 2's end block first measured zero damage in 33 dense volleys: the
harness fires its whole grid between two driven frames, the port's queue hands
that one frame every pull, and the boss resolves its mark on its next update
against the one shot record -- which was the grid's last pull, not the one
that crossed the weak point. Two changes: `MarkActorShot` keeps each marking
pull's ray (`Actor.shotRays`, `[port-only]`) and the gates read it, and
`--aim`'s pulls get a frame of their own before the grid.

**Measured** (`node tools/playthrough.mjs --headless --continue --boss --watch
0x14`, against this branch's bundle): **stage 5** plays through with no cheat
-- the cameo at block 3 goes 200 → -9 in 2155 frames, flag 31 opens block 4,
and the end block 7 is played through to the next stage. **Stage 2** needs
`--no-damage` to reach its boss at all (the harness spends its five credits by
block 14, before any class-0x14 code runs); with it, end block 35 goes 300 →
-10 in 3825 frames through the banner, a summoning round and the phase
ladder, and the script leaves the block for stage 3.

## JUDGMENT: stage 1's boss, and its return in stage 5

Classes 0x22 and 0x23, `game/class22/` and `game/class23/`, read in
[`re/boss-judgment.md`](re/boss-judgment.md). Two actors and a third riding
one of them: the **flier** (class 0x22, character type 0x45) takes the damage,
carries the health bar and the banner; the **walker** (class 0x23, type 0x44)
cannot be hurt, strikes with its axe and hands every hit it takes to the
flier, one hit point at a time; and the flier's **sub-actor** (type 0x46, its
wings) is a second skinned actor seated on the flier's node 1 every frame.

**Where they come from.** The flier is an opcode-0x0B spawn: stage 1 block 0
(variant 0, the cameo over the cathedral), blocks 14 and 16 (variant 1, the
fight), stage 5 block 1 (variant 2, the return). The walker is not a script
spawn at all: it is the class-0x23 descriptor nested at the flier's
`tail+0x10`, spawned from the flier's own entrance. The exporter follows the
pointer and emits it as a synthetic placement parented to the flier, the
sub-actor likewise, as the bat's wings are.

**The fight.** 300 hit points. Phase 1 rides `op_st1` paths `0x104..0x13F` in
the walker's frame while the walker walks at the camera and swings; a hit is
30 (25 with both players attackable), 10 points (120 for part 2), and a
flinch. At 90 the flier leaves the walker's shoulder -- the walker falls the
same frame, out of the alive count, and out of the present count when it
lands -- and phase 2 flies camera-relative paths `0x140..0x144` until the
last 90 go. The death is a fall, a bounce, an impact flipbook and a
300-frame orbit the class drives by writing the camera block itself under
`g_camera_driver_held`; it raises `g_script_flags[3]` in stage 1 and
`g_script_flags[0]` in stage 5, which is what the blocks wait on. Driven end
to end through block 14 (`--no-damage`, the grid volley): 300 → 97, the
walker's fall, 90 → 0 in phase 2, 1510 for the kill, the orbit, and the
script walks off the end of the block.

**What is drawn, and how.** `render/characters/judgment.ts`:

* each root with **all three angles, in its own order** -- the order is
  `model+0x68` (`obj+0x1FC`), which `SkeletonApplyRootMotion` switches on;
  the flier's is `T · Rz · Ry · Rx`, the walker's `T · Rx · Rz · Ry`. The
  ordinary path draws yaw alone, and the cameo's path `0x100` banks;
* the sub-actor **seated on the flier's posed node 1**, after every instance
  is posed, through `MatrixGetTranslation` and `MatrixToEulerZYX` as the
  engine does it;
* node 1's **two extra models**, `0x2B5` and `0x2B4`, turned by the angles
  nodes 3 and 6 were drawn with (`Poser.drawnAngles`);
* node 2's slot cycling through `0x2A5 + cycle[n]` while the flier swoops.

The walker's landing ring is `render/slotmodels.ts`'s: `boss1q.bin` 94 spread
and faded along `CamEvalPath7(0x147)`, read in the ring's own update.

**The models are the stage's own.** The exe lists slots `0x28F..0x2C8` under
`char_adv04.bin` first, and that is what the exporter drew -- but stages 1
and 5 never load it; they load `boss1q.bin`, `boss1z.bin` and
`boss1z_wing.bin`, and a whole-file load is what makes a slot resident. The
flier's and the wings' data are the same in both; the walker's arm (slot
`0x29D`) and one texture are not. The exporter now builds the three types
from the file the stage loads.

**The shot test is the engine's.** Both classes register at the exe's sites
(`formats/combat.md` §3): phase 1's `RegisterForShotTest`, phase 2's
`ActorRegisterCameraPoint(2.0)` while the flinch bit is down, the walker's
`ActorRegisterCameraPoint(6.0)`, its falling frame and its collapse. The
sub-actor never registers.

**Behaviour that changed outside the two classes:**

* `ActorSpawn` pushes to `g_object_list` **before** the class's `Init`, as
  `SpawnFromDescriptor` links the task before the handler runs. An object an
  `Init` makes is now updated after its maker.
* A bone whose draw record is slot 0 draws nothing (`AssetDrawSlot(0)`
  returns at once). That is the walker's node 2 -- and the frog corpse's
  bone 2, which was drawn before. (This said bones 2 and 3: the kill's third
  write, `part+0x210`, is bone 2's hit radius, not bone 3's slot.)
* Every scene's cam files come from the exe's per-scene list
  (`0x004C4990`): stage 5 gains `op_st1` (JUDGMENT's paths `0xFD..0x147`),
  and every Original Mode bundle gains `op_org`.
* `game/matrix.ts` is pure maths a render layer may call, beside
  `game/vec.ts` (`tools/verify_layers.py`).

Not ported: Training's subtype 2 (`trnevtbl.bin` block 9), which no bundle
carries. Stage 1 blocks 14 and 16 are the same descriptor.

## Strength, the stage-4 boss (class 0x19), is ported whole

Every routine of class 0x19 is in `game/class19/` -- the four entrances, the
fourteen fight states, the three attacks, the reactions and the death -- and
`web/tools/boss4_fight.mjs` plays both routed arenas (stage 4 blocks 23 and 25)
from their first step to `g_script_flags[32]` and past the script's wait on it.
`docs/re/boss-strength.md` is the reading.

**How the fight moves.** Nine phases per arena, each a share of the 300 hit
points (`g_boss4_phase_hp_fraction`). A head shot costs
`g_boss4_head_damage[players + rank*2]` -- 26 down to 13 for one player as his
own rank climbs with every two head hits and falls three with every life the
player loses -- and a shot on a collision-mesh bone only bleeds when it lands
on a flesh quad. At the floor he refuses damage; once the camera is still he
plays the next phase's camera move himself (`Boss4PlayCameraCue`, on the
(2,6) rail), and when the rail passes the phase's frame he is seated at the
next spot with the next phase's arena, damageable again once he is five units
inside it. Phases 5, 7, 11 and 16 end in a charge past the camera; 3 and 13 in
a throw of one of the two props he carries (`g_prop_behaviours[2]`, a type-2
carried prop in his hand, which a shot knocks aside rather than breaks); the
rest in chainsaw strikes, one life each.

**What it took outside the class.** The seven `.rdata` tables travel in the
bundle (format 13); the descriptor tail's fifteen words are per-bone
`coli4.bin` meshes, which the shot test (`ShotTestBoneMesh`) now takes for the
boss, carrying the quad's surface to `SpawnWorldImpact` and the per-player
`g_shot_hit_records`; the transport he rides is `CarrierPropRoutine2`
(selectors 2 and 9, with its two doors); and the four boss blocks' camera --
`cam_play 185 0..0`, a static pose, then `finish_sequence 6` over no stash --
now installs the rail the fight's frame comes from, which the walker used to
refuse. That last one had held every arena threshold, charge and chainsaw cue
at camera frame 0.

**What is still not measured in a browser.** `tools/playthrough.mjs` stops on
entering an end block (`PLAYER_HANGS.md` item 17), and the boss blocks are
stage 4's end blocks; the headless harness plays the fight with the player's
head shots delivered as `MarkActorShot` leaves them. The same step spawns eight
bats that nothing in it shoots, so the post-fight `wait_enemies_present 0` and
the outro camera that despawns him are asserted by `port.test.ts`, not played.

## The Tower: class 0x45, stage 3's boss and stage 6's return

Five heads rise out of a canal and a sixth thing is under it. Class 0x45 is
all of them -- the opening head and the civilian it takes, the two civilians
heads 0 and 4 hold, the five fighting heads, the body -- plus its own intro
card, and it is `game/class45/`. Every routine is transcribed under its exe
name; `docs/re/boss-tower.md` has the reading.

* **Three frames to start.** `Boss3ClassHandler` (`FUN_0041FC00`) picks the
  variant from the block (11 and 13 on stage 3, 2 on stage 6, 15/17 in Boss
  Mode), re-seeds the fight's globals and installs the sub-type's Init, which
  installs its update: handler, init and update on three consecutive frames.
* **Its own clock.** The class steps `model[0]` itself, behind state tests --
  a dead head holds its last frame by not stepping -- so it declares
  `ClassHandler.advancesOwnMotion` (JUDGMENT's flag, the same rule) and
  the director leaves its motion alone. The
  cursor, the cross-fade (swing-twist, as `MatrixInterpolateSwingTwist`), the
  half-frame lerp and the root damper are the class's own, which is what makes
  the jaw test read the pose the engine reads.
* **The heads.** Shootable only in the fight, on the weak bone, with the jaws
  open by more than `0x1700`, and not while the neck is turned away; 45 over 3
  (or 5 with two players) off the head and the shared pool, the bar reading
  pool/180. Head 2 cannot be hurt on stage 3 and dies with the fourth small
  one; 180 frames later it drops both enemy counters -- the first gate. Head 2
  schedules the bites: at most two heads armed, never itself on stage 3.
* **The body.** Builds its path from eight or nine `op_` curves (2313 points),
  holds the camera (mode 6, `g_camera_driver_held`) and drives the eye along
  `cp_` curves, aiming by the camera block's yaw and pitch at its weak bone.
  It can be shot only surfaced or lunging, 10 a hit (6 with two players) of
  120; its death opens the second gate and hands the camera back.
* **The shot test.** Registered the engine's way (`registersForShotTest`): a
  head unless dead, the body in states 10..13 only, the opening head and the
  civilians never. The body's broad sphere is 95 units.
* **Drawn from its own matrices.** The heads and the body are drawn by
  `Boss3DrawBoneParts`, not by the skeleton walk, from
  `Boss3ComposeBonePose`'s matrices -- extra rotations for the bite, the body's
  spine in `Rx Ry Rz` along its path. `render/characters/boss3.ts` places those;
  `render/boss3_effects.ts` draws the intro card (the "TOWER" / "Type 8000"
  plates fade in beside it), the bite flash, the wake, sparks, splashes, the
  path effects, the civilian's shadow and variant 1's water mound, which the
  body raises as it swims under it.

**Played**, with `playthrough.mjs --boss` (JUDGMENT's `--play-end`,
`--meter-all` and `--aim`; `--meter-all` reads the Tower's hit points, which
are `obj+0x11C` like everyone's). The debug clear refuses this class, so
nothing but shooting opens its gates.

* Stage 6 `--boss --continue` passes block 2's five heads by shooting (the
  gate opens at frame 7350) and runs out of credits in block 3, which main's
  default run does too (frame 7125).
* Stage 3 `--boss --continue` kills two heads and then runs out of credits in
  the fight (frames 10920 and 11085 on the two routes): the zombies before it
  spend five of the six. The bites are the heads' own schedule, and the grid
  rarely finds a radius-3 weak bone in an open mouth.
* With `--no-damage`, block 13's fight plays through (6285 frames in the
  block), and block 11's body is still hittable but hangs the harness: a hit
  counts only surfaced or lunging, on the weak bone with the jaws open, so
  a dive plus a surfacing the grid misses runs past `--hang`'s 900
  fruitless frames. `--hang 12000 --shoot-for 1500` plays it through (frame
  17865). `--aim` does not help here: it aims at `obj+0x70`, which the class
  publishes as the actor's position -- the body's tail on its path and the
  heads' necks -- not at the weak bone the shot must hit.
* Default stage 6 now hangs at block 2's gate, because the boss exists: the
  default meter cannot see its damage and 900 frames is shorter than the
  fight.

## The crowd push tests what registered, a frame late

`ZombiePushOutOfWorldAndActors` (`FUN_00454900`) has been ported since the
crowd separation landed; what it tested against had not been.
`ColiTestSphereAgainstActors` (`FUN_00405B10`) walked the object pool and
re-derived each actor's sphere where it stood. The engine walks
`g_coli_dynamic_list`, the copy `ColiPublishDynamicList` (`FUN_00405360`)
makes of `g_shot_test_list` before any actor runs -- so the candidates are
what registered **last frame**, each at the sphere its own class published,
and a body behind the camera, which never registers, pushes nobody. Both are
ported, with the rest of the routine: the two surface points, the stable
radix pick of the nearest, the depth re-derived from them (which differs from
`r + R - d` when the radii do), the `nx + ny + nz == 0` miss, and
`g_coli_hit_object` and `g_coli_hit_dist_sq` among its outputs.

For the list to hold anything, `ActorRegisterCameraPoint` now files every
caller, as `0x00409BED` does; the shot test's class-at-a-time migration is a
filter at the pick (`ShotTestPickedHere`) instead of a gate on the
registration, which had kept every zombie, thrower, civilian and frog out of
the list. Class 0x33's chair registers from its own tail (`0x00433CC6`), and
the `ownsSphereCentre` flag the frog and the civilian carried is gone -- the
list carries each one's point. The
thrower's special case on `g_coli_hit_object` is in: an off-ground thrower
shouldered by an object with `obj+0x34` `0x200000` falls instead of sliding.
The hook's shove timer counts calls, and its 1.8x is the strike's commit and
the sprint bit, which `docs/formats/combat.md` section 10 now sets out.

Measured over the eight entry routes with `--no-damage`: see the session log.

## The model's size: every skinned actor is drawn at `model+0x116C`

`ActorBuildSkinnedModel` (`FUN_00410440`) sizes a character from its type
alone -- 0.6 for type 30 (the bat), 0.7 for 31 (its wing), 0.9 for every type
from 32 to 56, and 1.0 for everything else -- and the draw tail of
`SkeletonApplyRootMotion` (`FUN_00410C50`) pushes that size as
`MatrixScale(model+0x116C)` between the actor's rotation and the pose
translate (`0x00410FEA`..`0x00410FF7`). Every bone hangs from that matrix. So
one number decides the drawn size, the pose offset, where every bone is -- the
attachments, the held items, the gore and the camera point ride the bones --
and where every hit centre is. `[proved]`

Types 32..56 are the people, whichever class runs them (0x10, 0x24, 0x25 and
0x45 in the shipped placements), and the port drew all of them at 1.0: the
root motion was already scaled, the drawing was not. `render/characters.ts`
now puts `Actor.scale` on the root of every actor it places (`placeRoot`), in
the engine's place on the matrix, which is also the bat's special case folded
into the rule it was an instance of. Nothing at 1.0 changes: a zombie, a
thrower and the stage-1 boss screenshot byte for byte the same before and
after.

**The spheres.** The radius is the one part of a sphere the bone matrix does
not reach, and `SkeletonWalkNode` (`FUN_004107E0`) scales it at build
instead: `FLD [ECX+0x1300]; FMUL [EAX-4]; FSTP [ESI+0x78]` at `0x00410837`.
The port's build now writes every bone's record radius (`Actor.boneRadius`)
as the table's times the size, so a civilian is shot through spheres 0.9 as
wide at bones 0.9 as far apart -- both shot tests, the blood spray and the
dropped-prop test read that record. The same routine gates each row on its
own slot matching the node's; that is ported now, with every other writer of
the record's sphere -- see the next section.

**What it looks like.** Stage 1's rescue civilian stands a head shorter; stage
4's crawling civilian (block 4, type 48, posing clip 596's root) sits 2.593
units out of his clip's 2.882 rather than all of it. And **stage 4 block 23's
jumbotron was empty**: the one `SetScale` in the game's scripts (class 0x10 op
0x27, `0x42480000` = 50.0) is how the engine puts `player_gold` -- Goldman --
on the arena's big screen, and at 1.0 the port drew him fist-sized somewhere
behind it while the speech played over a blank panel.

Checked by `test:port` (the build writes the size for every actor and each
radius from it), `test:render` (a civilian's root, bone, sphere centre, radius
and a shot 1.30 in and 1.40 out of her 1.35 head), and
`tools/verify_root_pose.py`, which decodes the size switch from its jump table
against `ActorModelScale` and finds, in the six stages' spawns, every
character that poses a clip's root.

## A bone's hit sphere is the record's, from every routine that writes it

A bone is shot through the sphere its **draw record** holds -- `+0x78` the
radius, `+0x7C..+0x84` the centre, of `obj + 0x20C + bone*0x90` -- and the
port held only the radius, from the build alone, and took every centre from the
bundle. So a gore-swapped part kept the pristine part's sphere, an emptied hand
could still be shot, and the table's rows reached actors the engine's build
refuses them to. Every writer a sweep of `.text` finds is on
`Actor.boneRadius` / `Actor.boneCentre` now (`docs/formats/combat.md` §8a has
the table):

* **The build's slot test.** `SkeletonWalkNode` (`FUN_004107E0`) takes row
  `bone - 1` only when the row's own slot is the node's (`0x00410830`), and
  zeroes radius and centre otherwise. The bundle carries each row's slot as
  `hit_slot`. The one case a player meets is `zsass`: its rows name the armed
  hands `EnemyThrowerInit` (`FUN_00449620`) puts in and its skeleton the bare
  ones, so **a `zsass` holding its weapons cannot be shot in either hand** until
  it has thrown and re-armed. `EnemyThrowerInit`'s arming itself was missing
  too (`0x00449877`/`0x00449881`), so a `zsass` walked in bare-handed.
* **The gore swap.** `ActorSwapDamagedPart` (`FUN_004098E0`) zeroes the radius
  for slot 0 or 1 and otherwise runs `ResolveDamagedPartSphere`
  (`FUN_004099A0`) twice, on the actor's type and then on type 7 (0xB for
  0xD), **both always** -- the first returns 0 whatever it finds. A found row
  is copied unscaled; a missing one leaves the record alone. The rows travel
  as `characters.part_spheres`. The swap also reads its own zone-bit code off
  the record's step counter now, and the headshot's `(rec, 0, 2)` is that swap
  rather than `RemoveBoneSubtree`, which the port had called: the head goes
  alone, and its zone bit only on its last step. `RemoveBoneSubtree` zeroes
  the radius with the slot.
* **The weapon hands.** `SpawnThrownWeapon` and `ZombieThrowHandWeapon` zero
  the emptied hand's radius -- two declared divergences lose that half.
  `ThrowerStateRearm` copies type 0x16's rows 4 and 7 back and
  `ThrowerStateRestoreBothHands` the actor's own, unscaled and untested.
* **The mesh hands.** `EnemyZombieInitByCharType` (`FUN_00452FD0`) gives
  `znchain`'s and `zndina`'s bones 5 and 8, and `znken`'s bone 5, the collision
  mesh at the descriptor tail's `+0x10` and a zero radius -- the "held prop"
  the port's notes had it loading -- and the same arm makes 2 and 3
  undismemberable and raises 2's entry latch, whose readers and whose
  clearer in `ZombieOnShot` were already ported. All 34 shipped spawns
  name a blob (`bone_mesh_coli`). Only `ShotTestBoneTree`'s walk tests a
  mesh, so **class 0x30 (and 0x18) is picked through the shot-test list
  now**, the engine's way: it registered every frame already, and the pick
  was the renderer's. A mesh hit sparks with the quad's surface and reaches
  `ResolveHit` on the bone; every other zombie shot takes `ShotTestSphere`'s
  broad phase at `obj+0x124` round the tracked point before the bones.

Not ported, and said where it lives: Original Mode's big-head item doubles
bone 2's radius in both enemy `Init`s, which goes with the item; and
`ZombieHideBoneSubtree` (`0x0045DD70`) is the halved crawler's, another
workstream's.

Checked by `test:port` (the build's test; each search, both running, type
0xB for 0xD, a slot-0 and a slot-1 swap, the headshot's zone bit, the sever;
every hand writer; the three mesh arms; a zombie's hand met through the
list and a queued shot through it), `test:render` (a written centre is where
the pick meets the sphere and not the row's) -- each
failing on a mutant of the change it covers -- and `tools/verify_combat.py`
check 17: the gate's bytes
and every row it refuses (`GATED`), the two restore states' loads, **type
0x16's rows 4 and 7 against `EnemyThrowerInit`'s immediates** -- a table and an
instruction stream agreeing -- every reachable tail ending in `-1`, both
searches agreeing wherever both find a slot, `part_sphere_rows` against a raw
first match, and every mesh-hand spawn naming a blob.

## Class 0x25's `op 17`: the jetty zombies fall back once, into the canal

At the end of stage 2 (block 16 step 15, and block 20 step 2 on the other
route) the two player characters shoot two zombies off the jetty from the boat.
Both zombies (character type 15, evt `43584`/`43740`, and `55372`/`55536` on
block 20) are class-0x25 scripted humanoids, and their programs end
`op 3 972` -- the fall back, with a fade of 5 -- then **`op 17` mode 0** and
`op -1`. The port had stepped over `op 17` since the class was ported
(`77e235af`), so the actor ran on into `op -1`, sat in the idle routine on clip
972 with the freeze flag clear, and **played its fall on a loop** on the jetty
until camera path 100 removed it. It never worked; no regression.

`op 17` is five things by mode (`0x004849CE`, table `0x00484D20`), and every one
ships `[proved]`:

* **0** installs `ScriptedHumanoidFallAndSplash` (`FUN_00484DF0`, a routine
  Ghidra had no function for): `vel.y -= 0.02` from rest, the freeze raised when
  the cursor its last draw showed is `g_motion_play_length - 1`, and at
  `y <= -27.9998` a kind-0x61 splash at `(x, -24.9998, z)`, the hit slot back,
  and `ActorKill`. The zombies fall 5 units and are gone **22 frames** after the
  hand-off, before the 59-tick clip could loop.
* **1** installs `ScriptedHumanoidLaunchAndDrop` (`FUN_00484EA0`): stage 2
  block 37's five bystanders thrown up at 20 a frame and out along x from 231.5
  under a gravity that grows 0.0272 a frame, dead below y = 0.
* **2** calls `ScriptedHumanoidSpawnFixedImpact` (`FUN_00484F50`): a kind-0x34
  sprite at a fixed point, and the VM runs on.
* **3** spawns kind 0x41 at one of two fixed points (block 9 or not), and runs
  on.
* **4** sets `vel.y = -0.408` and installs `ScriptedHumanoidFallTimed`
  (`FUN_00484F90`): the same gravity step and death past 200 frames (stage 6).

Which routine runs is `HumanoidTail.routine` now, the code pointer at
`obj+0x00` with the exe's own values; `pc = -1` is gone, and a finished program
leaves the cursor on its `op -1` as the engine does.

**The VM's motion waits count the engine's cursor.** `op 0/1/4` mode 2 compare
`obj+0x19C` -- the cursor the class's last draw sampled, which the port keeps
as `HumanoidTail.playCursor` (`L62`) -- for **equality** with `a`, or with the
play length minus one. The port read the authored frame with `>=`, and 24 of
the 40 shipped literal cursors name one past a clip's end in authored frames
(`a=66` and `a=68` on stage 2's 35-frame 805, `a=73` on the 41-frame 855 in this
same cut scene), so those actors parked until their removal triggers. The same
belief sat under `op 2` and the Init: both write the counter directly, `b` or
`rand() % 10` for -1, where the port doubled `b` and took -1 as 0. `op 2`'s
mode also raises or clears `obj+0x1F8` bit 4, as the Init does for `blk+2 == 2`.
`op 3` goes through `ActorSetMotionBlended` with its start cursor and fade
(`mode`) instead of cutting to frame 0. The per-opcode condition sets are the
exe's: `op 0/1` have no mode 4, `op 0` never proceeds on mode 2, `op 4` has no
-1, and an out-of-range opcode parks the VM. The removal test and the idle
routine free the hit slot (`ActorFreeHitSlot`, `FUN_004092D0`), which they had
left claimed for the rest of the stage.

Measured in the page (`?stage=2&block=16&step=15&op=0&drive=1&seed=1`, driven
frame by frame): before, zombie 43584 is handed over at driven frame 210 and is
still at y -23 on clip 972 at frame 457, the cursor running 0..58 and wrapping
(40 at frame 250, 30 at 300, 20 at 350); after, it is handed over at frame 214
(the fades now cost their frames), falls 0.02 a frame², and dies at frame 236
with a splash at y -25; 43740 at 263 and 285. Checked by `test:port`'s five
class-0x25 `op 17` blocks, 17 assertions failing on the base.

`op 9` and `op 16`, the zombies' shot wounds in this same scene, followed --
see the next section.

## Class 0x25's `op 9` and `op 16`: the wounds and the hands

The jetty zombies were shot on cue and nothing showed it: no blood and no
wound, because the port stepped over both slot-writing commands with a
declared divergence ("routines this port has not read"). There was nothing
else to read -- both are arms of `ScriptedHumanoidUpdate` -- and both are now
transcribed `[proved]`:

* **`op 16`** (`0x00484972`): `SpawnBloodSpray(obj, a, 0.75)` -- the port's
  own `effects/blood.ts` -- and then the character's effect-table entry
  `6*a + b` into bone `a`'s draw record, when it is above 2. Only the slot:
  it is **not** `ActorSwapDamagedPart`, and the hit sphere, the step counter
  and the zone mask are left alone. Stage 2's four jetty zombies are the only
  users: 43584 and 55372 lose the top of the head (`0x1BFA`, then `0x1BFB`),
  43740 and 55536 take a wound on bone 3 (`0x1C00`) and then the head.
* **`op 9`** (`0x00484739`): bone 5's slot from `g_player_hand_slots[3*row +
  mode]` (`0x004EC9E0`), unconditionally, with `row` the command's `a` -- or in
  Original Mode, for `a` 0 or 1, `g_original_character[a]`, now in `G` and
  seeded as `ResetOriginalModeLoadout` leaves it. 117 commands in 114 programs
  across all six stages; stage 3 block 11's James takes row 0's variant 2 for
  the closing scene.

The bundle carries the hand table as `characters.player_hand_slots`, and every
slot either command can write rides the character's hidden template, where
before only the jetty zombies' wounds happened to (they have hit-sphere rows).
Both exporters read the table (`playerHandSlots` / `player_hand_slots`);
`tools/verify_attachments.py` check 6 holds the bundle's copy to the exe's
words and every written slot to a model in the glTF, reading the table address
and both strides out of the instructions.

Measured in the page on one seed, with and without the two arms
(`?stage=2&block=16&step=15&op=0&drive=1&seed=1`): identical to driven frame
150; at 166, 277 pixels differ, all on 43584's head -- the blood and the open
skull; at 214, 43584's head and 43740's bone-3 wound. Stage 3 block 11 step 1:
James's right hand differs at frame 170. `test:port`'s four `op 9`/`op 16`
blocks, 15 assertions, 12 failing with the step-over put back.

Still declared, in the same file: the Init's Original Mode remap of types 0x39
and 0x3A, which the engine makes before the model is built and the port builds
in `ActorSpawn`. It was described as Boss Mode; it is `g_GameMode == 1`, and
with `g_original_character` as its one writer leaves it, the identity.

## `ActorSetMotionBlended`'s start is a play cursor, at every caller

`ActorSetMotionBlended` (`FUN_004119A0`) writes its third argument into the
play cursor (`MOV [ECX+0x8], EAX` at `0x004119AD`, `obj+0x19C`) and only its
half, truncated toward zero, into the authored frame. The port's took an
authored frame and doubled it, so every nonzero start that reached it
unconverted began twice as far into its clip. `[proved]` for the routine and
for every caller: a byte scan finds 367 call sites (352 direct -- Ghidra's
xref list stops at 332 -- and 15 through `SetCurrentActorMotionBlended` and
`ZombieSetMotionIfIdle`), and each start `PUSH`, walked back to its source,
is a value in cursor units: 288 literal zeros; literals 5, 8, 10, 12, 15, 17,
25, 26, 30, 35 and 61; `rand() % 5`, `rand() % 10` and
`rand() % g_motion_play_length[m]`; a script's start word; the drifted
clip's `g_motion_play_length - 1`; class 0x23's table words; a counter
difference (class 0x14); the arc script's stage starts.

The routine takes the cursor as it stands now, and `ZombieSetMotionIfIdle`'s
spreads are cursors (`"clip"` is `rand() % g_motion_play_length`, not a
doubled authored frame). **Changes behaviour**: every class-0x30 captor-script
start (the bin captor's burst, 967 from 33, used to begin at 66, past its
flag-34 cue at 63, so the flag never came up -- and with it the boards the
captor bursts through, class 0x12's, below; 28 nonzero script starts ship), every class-0x30 random spread
(`rand() % 5/10/play_length`: the walks, idles, retreats, landings), the fall's
landing (15, not 30) and body condition 4's special death (25, not 50),
class 0x31's stand-and-decide and wait-for-cue starts, and class 0x23's walk
and after-strike clips (175/141, 28/23 and 60/49, not doubled past their own
lengths). **Unchanged, the compensation removed**: the frog, class 0x21's
freed clip, class 0x25's `op 3`, Strength's arena idle (10), class 0x10's
`CivilianApplyMotionPose` and the thrower's throw had each halved the word or
written the cursor after the call. Class 0x14 and class 0x45 already kept the
engine's cursor. Class 0x25's `op 3` passes `-1` in eighteen shipped
commands, which is held through the fade and plays the clip from 0; the
authored frame of a negative cursor truncates toward zero, as the routine's
`SAR` does, instead of indexing off the front of the clip.

**Found on the way**: the drift tail -- blend back to the script's clip when
`obj+0x1B4 != obj+0x1320` -- is two tails in the exe, and the port ran one
for all eight states. The four list-stepping states (35, 36, 37, 38) blend
hard from `g_motion_play_length[drifted] - 1` on their last loop and spend a
loop on the soft blend; the four walking states (34, 40, 41, and the lost
pause) only ever blend soft from 0 and read no loop count -- the pause's
count is its timer, which the shared tail spent.

Checked by `test:port`: "the bin captor's burst starts on the cursor its
entry names" (clip 967 at cursor 33, flag 34 on cursor 63), "the script
states' drift tails", and class 0x23's walk at cursor 175 in the JUDGMENT
block -- six assertions, all failing on the base. In the page
(`?stage=1&block=6&step=1&op=0&drive=1&seed=1`, the bridge captor shot so
the civilian takes the rescue path): the burst's first frame was cursor 66,
running to 83 in 18 frames with flag 34 never raised; it is cursor 33 now,
and flag 34 comes up 30 frames later on cursor 63. Playthroughs (seed 1,
`--continue`): stages 1, 2 and 3 end as they did (the end block; GAME OVER
at block 16; GAME OVER at block 2) at different frames, stage 4 now reaches
its end block where it ran out of credits at block 6 -- the fights diverge,
nothing in stage 4 was fixed -- and stages 5 and 6 hang where they hung.

## Class 0x12: the boards the bin captor bursts through

Stage 1 block 6 step 1 -- the civilian off the bridge, onto the bin -- places
evt `0x3D88` at camera frame 640, and it is **class 0x12**, a class the port had
no enum member, no handler and no placement for: the spawn built nothing, and
the captor (`0x3D24`) walked out of an empty doorway. `g_class_handler_pairs`
names `{0x12, 0x0043F9D0}`; Ghidra had no function at either address, and both
are named now.

* `ScriptedPropInit12` (`FUN_0043F9D0`) fills a 0x1C-byte block from the
  opcode-0x0C tail: the slot it waits on, a delay, a shot-mesh `coli` pointer
  into `obj+0x14C`, the behaviour, the despawn camera path and frame, the
  strip's first and last slots, a script flag, the cursor's step and a scale.
  It does not call the behaviour (class 0x13's Init does).
* `ScriptedPropUpdate12` (`FUN_0043FA60`) draws `AssetDrawSlot(__ftol(cursor))`
  under class 0x13's `T; RotX; RotZ; RotY` and registers for the shot test
  until the flag is up; then counts the delay down, jumps to the first slot,
  installs `NoOpStub` and raises `0x8000`; then steps the cursor a frame at a
  time and despawns, undrawn, once it is strictly past the last slot. The
  camera cue despawns it too. `[proved]` from the disassembly: the pseudocode
  drops both `__ftol` operands (`L1`).

Stage 1's record: `door_1.bin[41]` (`0x11FD`), a 14 x 23 panel modelled in
world space across the doorway at `x -675..-661, z -551..-545`; flag 34, which
the captor's `ZombieStateTargetScriptWithFlag` raises on cursor 63 of its burst
(967 from 33); delay 1; then `door_1.bin[42..95]` a slot a frame, the boards
flying apart over 90 units of the alley; gone on camera path 47 frame 130. So
flag 34's reader in stage 1 is this door -- the mouse arm that tests flag 34
(`MouseBranchTriggerUpdate`, subtype 4) is stage 4 block 10's. Two more records
ship, both `sanbasi.bin[12..90]` at half a slot a frame: stage 2 block 37 on
flag 95 and stage 5 block 3 on flag 11. All three name behaviour 0.

What changed: `game/class12/` (both routines, the tail in `state.ts`),
`SpawnSlotActor`'s arm, `render/slotmodels.ts`'s draw (the truncation is the
draw's), and the exporter: `class12Tail` (and `class12_tail` in the Python
half), class 0x12 in `SLOT_DRAWN_CLASSES` for behaviour 0 only, and the strip's
slots in the `slots_actor` rig -- **a fresh bundle is needed**.

Not here: `ShotTestMesh` (`FUN_00404A00`) for an actor. The door's record
carries `0x10`, so in the engine a shot at the boarded doorway is tested
against `coli1.bin:5144` and stops on the boards until the strip starts; the
port files the door and its pick passes a mesh entry by, as it did before any
class raised the bit. Its `0x40` bit is clear, so neither collision pass takes
the blob in either.

Checked by `test:port` ("class 0x12, the door the bin captor bursts out of":
the spawn, the Init, the wait, the flag frame, 54 frames of strip, the despawn,
the camera cue, a negative delay, stage 2's half step and its equality arm;
six fail with the registration and the spawn arm taken out), `test:render`
(the waiting slot, `T * Rx * Rz * Ry * S` at three unequal angles and scale
2, the truncated cursor; three fail without the draw arm), and
`tools/verify_flag_strips.py`: the exporter's tail offsets against the eleven
instructions that read them, every shipped spawn placed with the fields the
evt holds, and every strip slot in its bundle (fails on the old bundle, and
on moving `cam_frame` to `+0x0E`). In the page at
`?stage=1&block=6&step=1&op=0&drive=1&seed=1`, the bridge captor shot: the
doorway is boarded from the spawn (camera frame 640) on, the boards burst on
the frame flag 34 rises, and 54 frames later they are gone.

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
| `01` | `spawn_placed_if_1p` | spawn | **done** | spawn lists gated on the live player count (`g_max_attackers`), forwarding through `g_evt_spawn_gated_handlers` to `09`. No shipped script encodes it, but the forward is the engine's and is wired rather than declared dead |
| `02` | `spawn_simple_if_1p` | spawn | **done** | as `01`, forwarding to `0A` instead |
| `03` | `spawn_obj_if_1p` | spawn | **done** | spawn lists gated on the live player count (`g_max_attackers`), forwarding through `g_evt_spawn_gated_handlers` to `0B` — 12 sites. Stage 1's first zombies are here |
| `04` | `spawn_obj_c_if_1p` | spawn | **done** | spawn lists gated on the live player count (`g_max_attackers`), forwarding through `g_evt_spawn_gated_handlers` to `0C` — 3 sites |
| `05` | `spawn_placed_if_2p` | spawn | **done** | as `01`, on `g_max_attackers == 2` |
| `06` | `spawn_simple_if_2p` | spawn | **done** | as `02`, on `g_max_attackers == 2` |
| `07` | `spawn_obj_if_2p` | spawn | **done** | spawn lists gated on the live player count (`g_max_attackers`), forwarding through `g_evt_spawn_gated_handlers` to `0B` — 45 sites; the extra enemies a second player brings |
| `08` | `spawn_obj_c_if_2p` | spawn | **done** | spawn lists gated on the live player count (`g_max_attackers`), forwarding through `g_evt_spawn_gated_handlers` to `0C` — 3 sites |
| `09` | `spawn_placed` | spawn | **done** | spawn markers: position, BAMS yaw, class, hit points |
| `0A` | `spawn_simple` | spawn | **done** | **not** the descriptor family: `EvtOpSpawnSimple0A` (`FUN_00408990`) takes a two-word `{class, hp}` record and the object places itself. All four the shipped scripts name live in `comevtbl.bin` — classes 0x60, 0x61, 0x62, 0x63 — and two of them raise a `g_script_flags` byte the script then waits on, which is why twelve `wait_script_flag` gates could not be honoured until this landed. The exporter resolves the records through `EvtFile.resolve`, which follows a stage pointer below its own base into the com buffer |
| `0B` | `spawn_obj` | spawn | **done** | spawn markers: position, BAMS yaw, class, hit points |
| `0C` | `spawn_obj_c` | spawn | **done** | spawn markers: position, BAMS yaw, class, hit points |
| `0D` | `spawn_obj_unless_skip` | spawn | **done** | spawn markers: position, BAMS yaw, class, hit points |
| `0E` | `set_approach_rings` | spawn | shown | enemy approach pacing; operands decoded as floats |
| `0F` | `set_approach_steps` | spawn | **done** | **writes `g_enemy_approach_steps`/`_mid`/`_outer`** — how deep in the distance queue an enemy may be and still come at you. Operands are a `-1`-terminated list of **ints**, not floats. Stage 2 sets 2/3/4, 2/2/2 and 1/1/1 in different blocks |
| `10` | `set_collision_set_full` | collision | done | fills `g_coli_full_set`, which the segment **and** the sphere test consult |
| `11` | `set_collision_set_ray_only` | collision | done | fills `g_coli_ray_set`, which only the segment test consults |
| `12` | `set_approach_steps_2p_bias` | spawn | shown | enemy approach pacing; operands decoded as floats |
| `13` | `set_scene_lighting_override` | light | *tracked* | lighting override; values decoded, not applied to the render |
| `14` | `set_scene_lighting` | light | **done** | `g_scene_lighting`: gates the gun lights, and picks the scene-light-array draw for `draw_mode` 1 regions and `obj+0x38` bit 3 actors |
| `15` | `enable_entity_spotlights` | light | **done** | **the two players' gun lights** — not one per enemy; the array is two entries wide |
| `16` | `set_ambient_light_rgb` | light | **done** | `g_light_array_ambient` r, g, b — the scene-light-array path's ambient; the exporter resolves the three pointers into `rgb` |
| `17` | `slerp_light0_direction` | light | ~approx~ | the slerp target is taken immediately rather than stepped |
| `18` | `set_light0_direction` | light | **done** | **drives the directional light** in `+ scene light` mode |
| `19` | `set_light1_direction` | light | **done** | light block 1 — **every character's light** (`LightsUseSecondarySet`); drawn in the "+ scene light" view |
| `1A` | `set_ground_plane_y` | camera | *tracked* | ground plane / g_camera_fixed_eye_y; see the eye-height note |
| `1B` | `set_backdrop_preset` | scenery | **done** | **the backdrop dome is drawn**, following the camera |
| `1C` | `set_backdrop_mode` | scenery | **done** | dome mode: 0 off, 2 frozen, anything else spins at the preset's rate |
| `1D` | `enable_rain` | scenery | **done** | **50 particles**, transcribed from `DrawRainParticles` — only stage 1 ever turns it on |
| `1E` | `set_unread_global` | nop | n/a | dead: the global it writes has no readers anywhere in the binary |
| `1F` | `set_hud_shutter_state` | hud | **done** | **the letterbox shutter**: the opcode's one store, and `HudDrawShutterState`'s 9 states with the 40-frame slide run as the scene's own task after the players (`game/hud_shutter.ts`), drawn from the bars it records and sized from asset `0x93E`'s own quad; the UI names each state and says what it does to the firing gate |
| `20` | `light0_set` | light | **done** | light block 0: **fog near/far and colour, light colour and ambient all applied** |
| `21` | `light0_tween_rate` | light | ~approx~ | jumps to the target; the per-frame step is not modelled |
| `22` | `light0_stop` | light | shown | clears a channel tween |
| `23` | `light0_tween_time` | light | ~approx~ | jumps to the target; the per-frame step is not modelled |
| `24` | `light1_set` | light | **done** | light block 1 — **every character's light** (`LightsUseSecondarySet`); drawn in the "+ scene light" view |
| `25` | `light1_tween_rate` | light | **done** | light block 1 — **every character's light** (`LightsUseSecondarySet`); drawn in the "+ scene light" view |
| `26` | `light1_stop` | light | shown | clears a channel tween |
| `27` | `light1_tween_time` | light | **done** | light block 1 — **every character's light** (`LightsUseSecondarySet`); drawn in the "+ scene light" view |
| `28` | `region_load` | region | shown | preloads a region's assets; everything is already resident here |
| `29` | `region_enter` | region | **done** | **switches the drawn region** — the core of the streaming model |
| `2A` | `unused_2a` | unused | n/a | dispatch slots that map to the empty stub; no shipped file encodes one |
| `2B` | `award_accuracy_bonus` | flow | shown | end-of-stage accuracy bonus |
| `2C` | `set_skippable_region` | flow | **done** | opens/closes the skippable window (`DAT_009A2D7C`); raises the Skip bar once the shutter's firing gate is also down, which is exactly when the game polls Start |
| `0D` | `spawn_obj_unless_skip` | spawn | **done** | spawns, unless a skip is in progress — `FUN_00408B70` walks the list either way |
| `2D` | `play_dialogue` | hud | **done** | **plays the voice and shows the subtitles** — the real script text, centred on a 384 baseline, advancing line by line on the game's countdown |
| `2E` | `stop_voice_if_skipped` | audio | **done** | `PlaySoundId(0x80000002)`, the voice channel's stop, when a skip actually happened; inert otherwise, as in the game |
| `2F` | `suppress_accuracy_stats` | flow | shown | suppresses the counters 0x2B grades |
| `30` | `queue_event` | camera | **done** | pushes onto the action ring and nothing more; the actions run in `CameraActorTick`'s `EvtRunQueuedActions`, one at a time, behind whatever handler holds the slot (`game/camera/actions.ts`) — see the selector table below |
| `31` | `goto_scene_state` | flow | **done** | the end-of-room instruction: enters scene state (1, minor) and stamps it, drops the camera mode, the override latch and the eye ease, parks the action slot and retires the `queue_event 0x21` whose driver never retires itself. (1,3)'s hook, `CameraFromViewAngles`, puts the gameplay eye fifteen down the view's own axis |
| `32` | `goto_scene_state_when_alive` | flow | done | as `0x31`, minus two clears, behind a gate: while either player is in state 4, 5 or 6 (`g_player_state_handlers` `+0x10` is 0) with no lives, it re-runs every frame (`Walker.holdHere`). The nineteen sites are the boss rooms |
| `33` | `set_action_drain_mode` | flow | **done** | `g_evt_action_advance = mode; pending += delta` — all 128 in the game carry `2, −1`: the `finish_sequence` in the slot taken back, what is queued behind it dequeued now and first called next frame |
| `34` | `unused_34` | unused | n/a | dispatch slots that map to the empty stub; no shipped file encodes one |
| `35` | `enable_camera_path_roll` | camera | **done** | **gates the camera roll channel**, exactly as CamEvalPath7 does |
| `36` | `pin_view_to_ground_plane` | camera | **done** | `g_camera_use_fixed_y`: the **gameplay** eye at `g_camera_fixed_eye_y` instead of fifteen below the pose; see the eye-height note |
| `37` | `force_camera_path_advance` | camera | done | `EvtOpForceCameraPathAdvance37` writes `g_force_rail_advance` (`0x009CA098`): at 1 the stashed rail steps through a screen shake or with nobody in play, which the rail's gate (`RailMayAdvance`, `game/camera/rail.ts`) otherwise holds it for |
| `38` | `se_play` | audio | **done** | **sound effects, voice and BGM play** — dispatched by namespace like PlaySoundId |
| `39` | `se_play_3d` | audio | **done** | **sound effects, voice and BGM play** — dispatched by namespace like PlaySoundId |
| `3A` | `se_play_unless_skip` | audio | **done** | **sound effects, voice and BGM play** — dispatched by namespace like PlaySoundId |
| `3B` | `se_play_3d_unless_skip` | audio | **done** | **sound effects, voice and BGM play** — dispatched by namespace like PlaySoundId |
| `3C` | `unused_3c` | unused | n/a | dispatch slots that map to the empty stub; no shipped file encodes one |
| `3D` | `nop3` | nop | n/a | proved no-ops |
| `3E` | `nop1` | nop | n/a | proved no-ops |
| `3F` | `nop0` | nop | n/a | proved no-ops |
| `40` | `wait_queued_events_done` | wait | ~approx~ | **`g_queued_events_pending == 0`, counted for real** — `queue_event` adds one, each handler takes one back, `finish_sequence` never does and `0x31`/`0x33` do it for it. The ring is the engine's now, one action at a time; `approx` only for `g_evt_gameplay_live`, as every wait |
| `41` | `wait_camera_path_frame` | wait | **done** | **exact** camera-frame gate on `G`'s words, polled every frame: operand 0 waits for `g_cam_path_frames_left < 1`, any other for `g_cam_path_frame > operand`. It yields the frame it is reached, as `g_evt_yield` makes it |
| `42` | `wait_frames` | wait | **done** | **exact** frame countdown: `EvtOpWaitFrames42` loads the counter on its `g_evt_yield` frame and decrements *before* testing, so the instruction behind it runs `operand + 1` frames after the one that reached it |
| `43` | `wait_enemies_present` | wait | ~approx~ | the **corpse-clear** gate, on `g_enemies_present` — not a synonym for `0x44`, and answered with the alive count until B4/B8. **Real** — the script holds until they are dead **and the camera has swung back** (`g_camera_free`). Yields the frame it is reached, as `g_evt_yield` makes it |
| `44` | `wait_enemies_alive` | wait | ~approx~ | the **live-enemy** gate, on `g_enemies_alive`, and 434 of the 488 enemy gates. Same side conditions as `0x43` plus `g_evt_wait_alive_hysteresis`, so it costs one frame more — both are now ported |
| `45` | `wait_script_flag` | wait | ~approx~ | the **script-flag gate**, on `g_script_flags` (0x009C7200), never passed on the frame it is reached (`g_evt_yield`) — and that array is one array: every one of the forty-odd gates in the six shipped scripts names a flag that script's own `set_script_flag` never sets, so this opcode is *only* ever a wait on an actor. **Real** now; it used to read a `Set` beside `G` that held the script's own writes only, and passed on sight. **`[diverges]`**: a gate whose flag *nothing this port runs can raise* passes instead of parking, and the boundary is derived from the bundle rather than listed — the stage's own `set_script_flag` ops, the civilians' streams and the captors' state 36. Honouring every gate unconditionally parks stage 5 at block 1, stage 1 at blocks 14 and 16, stage 2 at 35-41, stage 4 at 23-29 and all six on the chapter card |
| `46` | `wait_scripted_actors` | wait | ~approx~ | the civilian gate — `g_civilians_alive`, the same handler as `0x43` on a different counter. **Real**: it holds until the captors are dead. All 68 sites pass operand 0 |
| `47` | `wait_targets_clear` | wait | ~approx~ | **Real**, after the frame it yields on: `(g_camera_settled \|\| g_camera_free) && g_camera_candidate_count == 0`, the candidate count including carried props. It passed on sight until stage 3's bridge, where it let the script leave with a drum-thrower still standing there. `g_evt_gameplay_live` is not modelled, as for `0x45` |
| `48` | `set_script_flag` | flow | **done** | `g_script_flags[operand] = 1` and nothing else — the whole of `EvtOpSetScriptFlag48`. It writes `G.g_script_flags`, the same array the civilians' op 0x1C and the captors' state 36 write |
| `49` | `variant_call_a` | flow | shown | a global picks which operand list runs; the client does not evaluate it |
| `4A` | `variant_call_b` | flow | shown | a global picks which operand list runs; the client does not evaluate it |
| `4B` | `variant_spawn` | spawn | shown | a global picks which operand list runs; the client does not evaluate it |
| `4C` | `unused_4c` | unused | n/a | dispatch slots that map to the empty stub; no shipped file encodes one |
| `4D` | `checkpoint` | flow | *tracked* | records the checkpoint block, and the camera half of `ResetSceneCombatState`: scene state (1,3), the published frame to 0, the override latch, the eye ease, the held driver, the roll channel and the fixed eye cleared |
| `4E` | `halt` | flow | **done** | **parks playback** — it does not end the scene |
| `4F` | `advance_step` | flow | **done** | **next step, or the route table** when the step list is exhausted. Retires nothing: actors cross both step and block boundaries by design |
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
| `5F` | `bgm_entry_play` | audio | **done** | **stops the music, then plays a BGM track** -- `BgmStopThenPlay`; with a track of 0 it is a stop |

### `queue_event` (`0x30`) selectors

| Sel | Action | Status | Notes |
|---|---|---|---|
| `10` | `set_player_flag` | shown | both players' flag bit 0, the on-screen body the client does not draw; retires |
| `11` | `scene_state` | **done** | `EvtEnterSceneState(live major, operand)`, stamped; retires |
| `12` | `set_update_routine` | shown | both players' update routine out of `0x00579E90`; retires |
| `13` | `set_continuation` | n/a | defined, never used in shipped data |
| `14` | `set_global` | **done** | `g_camera_index` — the block the view is built from; both shipped sites pass 0 (scene state (1, 3)'s installer writes the other value, 2) |
| `15` | `set_flag` | **done** | `g_camera_ease_eye = 1`: the tracking tick eases the eye onto the pose a sixteenth a frame instead of snapping |
| `20` | `hold_camera_preset` | **done** | persistent: the block's eye and angles from the preset table at `0x00576CF0` every frame, and `g_camera_free = 1`; operand 0 counts down, and 0 never does |
| `21` | `finish_sequence` | **done** | the permits dropped, scene state (2, minor) entered unstamped, the minor's starter installed and the ring held (`advance = 0`); the starter runs next frame and installs `CameraDriverSelectMode` (4, 6) or `CameraDriverFromDeferredPose` (7) |
| `40` | `cam_play` | **done** | `start == end` a held pose, `flags & 2` the stash, else `CamStartPathPlayback`; `-1` resumes; the handler publishes every frame start..end inclusive |
| `60` | `store_six` | **done** | the three `(frame, path)` pairs and `g_evt_cam_override_valid`, which `CameraArmStashedPath` reads; the branch preview shots offered on hover |

### The eye-height note

Every path hook applies `eye.y = use_fixed_y ? fixed_eye_y : pose.y - 15`, and
the `eye` it writes is `g_camera_eye` (`0x009C71E0`) — the **gameplay** eye the
enemies measure to — never the camera block the view is built from. That is
why applying it to the drawn camera put 173 of 201 paths looking up at their
own aim point: it is the height of the player's body below the lens. `0x36` is
**done** on that reading (`g_camera_use_fixed_y`); `0x1A` stays *tracked* for
its other reader, the ground plane a missed downward ray falls back to. See
`web/src/render/campath.ts`.

