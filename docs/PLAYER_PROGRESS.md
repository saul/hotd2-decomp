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

[open] You are meant to be able to shoot the axe out of the air — the weapon
registers for the shot test every frame, and in the tutorial that is the whole
lesson. The port's projectile pool is plain records and its shot test walks
actors, so `ZombieThrownWeaponStateShotDown` is named rather than half-done.

The shape of what that costs is now read rather than guessed. In the engine a
thrown weapon is **not a record in a pool at all** — it is a whole object.
`SpawnThrownWeapon` (`FUN_004504E0`) allocates `0x13F4` bytes with its own
update `ThrownWeaponUpdate` (`FUN_00450780`), links it into the same object
list every actor lives on, and calls `ActorClaimHitSlot` (`FUN_00409270`),
which is what puts it in `g_hit_slots` — `0x009C88C0`, fourteen slots — and
raises `obj+0x38` bit `0x40`. It dispatches on its own two-entry state table
`g_thrown_weapon_states` — `0x00592AE0`: state 0 `ThrownWeaponFlyToTarget`
(`FUN_0044FD40`) and state 1 `ThrownWeaponDeflected` (`FUN_00450050`), which
`ThrownWeaponUpdate` routes into the moment `obj+0x34` bit `0x8` — the
pending-shot bit — is set on it. It also
**inherits the thrower's attack permit** (`obj+0x121` is copied across and the
thrower's is cleared), and only gives it back when it lands or is deflected. So
"shoot the axe down" is not a special case bolted onto a projectile: it is the
ordinary shot path finding an ordinary object. Making the port able to do it
means the pool becoming actors, which is a change to the shot path and to the
snapshot, not to the projectile.

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
its last frame*, measured against `BakedMotion.frames` — so a clip with no
frames pins the authored frame at 0, the wait can never fire, and the VM parks
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
| **W4** | Play mode, branching, enemy simulation | ✅ route graph walked; branch points pause with a seeded countdown; the live-enemy waits are the real gate |
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
| The branch was the viewer's choice, not the game's | `branch_choice` resets on every **step** advance, not every block change, and the writer the port reaches is a rescued civilian's `SetRouteBranch` (`CivilianRunScript` op `0x19`). An unanswered branch used to take the lowest block number; it takes `next[g_script_branch_var]` now, and the bar is a 1.5 s override of a decision the game has already made | read `EvtAdvanceStepOrRoute`'s tail; `tools/verify_branches.py` |
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
| `0x53` the cat | `u16[0x00589A64 + variant*10]`, variant from the parameter tail | `FUN_00431250`; the table is a five-entry playlist, all inside `nya.bin`'s 762–773 |
| `0x19` the stage-4 boss | motion **124** (`0x7C`), `boss4.bin` | `Boss4Init` (`FUN_004917E0`) stores it as a literal: `MOV dword ptr [ECX + 0x20], 0x7C` at `0x0049183E` |

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
| when it leaves | despawns after a landed leap, **without dying** | never: dive and orbit for ever | falls back and despawns |

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
  and no other sub-type has that guard.

**What is not ported**, and each is declared where it lives: the owl's body
chain (sixteen slots in one matrix chain against `render/slotmodels.ts`'s one
per actor) and the four per-sub-type landings its corpse has; the frog's
head-look fix-up and its actor-versus-actor push, whose transformed point is
`[open]` between view and world space; and the fish's three cosmetic tasks,
whose sounds are ported and whose sprites are not because none of the three
engine routines has a termination to copy.

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
  the projectile actor and leaves the thrower holding **0** — not −1 — and the
  weapon frees the slot at the end of its stick-and-blink life, in
  `ThrownWeaponFlyToTarget`. The port's weapon is a plain pool record shared
  with class 0x30's, which has its own state table and its own release site, so
  a record cannot carry a permit and releasing from the shared flight routine
  would free a class-0x30 slot through class 0x31's routine — the exact
  wrong-bit mistake `ThrowerReleaseAttackPermit`'s note warns about. The slot
  therefore goes back in `SpawnThrownWeapon`, where the engine hands it over,
  about 90 frames early, and that is now the `[diverges]` the re-arm one used to
  be. Making `G.g_thrown_weapons` carry a permit is the fix, and it is a change
  to both classes' projectiles.

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

`[diverges]` **The third clause is still a stand-in.** `g_player_state`
(0x009A5C62) must be 5, and *nothing in the port ever writes 5*: every writer
is the game's shell — attract, continue, name entry, game over — reached
through the per-player hook the scene-state table installs at `_DAT_009A5CDC`,
an indirect call with no port equivalent. `AdvanceToNextScene` (`FUN_0045FFF0`)
is the one writer that is plainly readable, and it goes the other way: it puts
a player at 5 back to **2** for the duration of a scene load, which is why no
enemy attacks across a stage change. Until the shell exists, "in play" is
answered by "has a life left", and `g_player_lives` floors at one for the same
reason.

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

`[diverges]` **The corpse window is zero-length for class 0x30.** The port has
no class-0x30 death state, so both of its releases land on the same frame
instead of a death clip apart. Class 0x31 keeps the window, because it has its
death states and calls the two retires where the exe does. Porting
`ZombieStateDeath6` (`FUN_00454D20`) — three subs, and the motion choice is
already ported — is what closes it, and it would also change how every zombie
death looks in the player, which is why it is called out here rather than done
quietly. The old derived behaviour had that window at *infinity*: a shot zombie
stayed `present` for ever, so none of the 54 present gates could ever open.

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

Both are now transcribed. The three counter gates — `0x43`, `0x44`, `0x46` —
model the yield by blocking from `WaitRule.enter` unconditionally and testing
only in `WaitRule.satisfied`, and `0x44` carries the hysteresis in
`G.g_evt_wait_alive_hysteresis`. `0x41`, `0x42` and `0x45` have the same yield
in the engine and still do not model it `[diverges]`: `0x42`'s countdown would
become `operand + 2` frames, and every camera cue in six stages is timed
against that clock.

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
* **The trigger is dead while the shutter's firing gate is down.**
  `PlayerFireAndReloadUpdate` (`FUN_00414940`) runs its whole fire block under
  `else if (g_nFiringGate != 0)`, which is one test above the ammo decrement,
  the shot counter, `BuildShotRay` *and* `PlayerShotEffectSpawn` — so a pull
  under a closed shutter is not a shot that misses, it is not a shot, and it
  makes no muzzle flash and no tracer either. `ResolveShotRequest` asks the
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
**difficulty modifier** at `PTR_DAT_004D0D84` (needs a rank), **ammo and
reload** — which is also why the firing gate above is asserted against
`g_nPlayerFired` rather than a magazine — **civilians**, and `FUN_004560B0`'s
**special deaths** for a
particular destroyed part (`obj+0x1368` bits → motions 428, 421, 633, 553), so
a character whose arm has come off still plays a directional death.

## Scripted scenery: doors, shutters and vans

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
| `31` | `goto_scene_state` | flow | *tracked* | the end-of-room instruction: enters scene state (1, 3) and retires the outstanding `queue_event 0x21`. The camera hook it installs reads the player view angles, which this client does not have — it draws the `cam/` path. [diverges] |
| `32` | `goto_scene_state_when_alive` | flow | *tracked* | as `0x31`, minus two clears, plus a park until a player is out of the death → continue → revive chain. No player death here, so the gate is always open [diverges] |
| `33` | `set_action_drain_mode` | flow | *tracked* | `pending += delta`, the second script-side retirement — all 128 in the game carry −1. The dequeue mode itself is not modelled |
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
| `40` | `wait_queued_events_done` | wait | ~approx~ | **`g_queued_events_pending == 0`, counted for real** — `queue_event` adds one, each handler takes one back, `finish_sequence` never does and `0x31`/`0x33` do it for it. Still `approx` because the ring's *ordering* is not modelled: the port runs an action when it is queued, not one at a time |
| `41` | `wait_camera_path_frame` | wait | **done** | **exact** camera-frame gate; operand 0 waits for the end of the path. It does **not** carry `EvtOpWaitCameraPathFrame41`'s first-visit `g_evt_yield` yield [diverges] — see `0x43` |
| `42` | `wait_frames` | wait | **done** | **exact** frame countdown — of `operand` frames. `EvtOpWaitFrames42` loads the counter on its `g_evt_yield` frame and decrements *before* testing, so the engine's is `operand + 2` [diverges]: retiming it moves every camera cue in six stages and wants its own change |
| `43` | `wait_enemies_present` | wait | ~approx~ | the **corpse-clear** gate, on `g_enemies_present` — not a synonym for `0x44`, and answered with the alive count until B4/B8. **Real** — the script holds until they are dead **and the camera has swung back** (`g_camera_free`). Yields the frame it is reached, as `g_evt_yield` makes it |
| `44` | `wait_enemies_alive` | wait | ~approx~ | the **live-enemy** gate, on `g_enemies_alive`, and 434 of the 488 enemy gates. Same side conditions as `0x43` plus `g_evt_wait_alive_hysteresis`, so it costs one frame more — both are now ported |
| `45` | `wait_script_flag` | wait | ~approx~ | the **script-flag gate**, on `g_script_flags` (0x009C7200) — and that array is one array: every one of the forty-odd gates in the six shipped scripts names a flag that script's own `set_script_flag` never sets, so this opcode is *only* ever a wait on an actor. **Real** now; it used to read a `Set` beside `G` that held the script's own writes only, and passed on sight. **`[diverges]`**: a gate whose flag *nothing this port runs can raise* passes instead of parking, and the boundary is derived from the bundle rather than listed — the stage's own `set_script_flag` ops, the civilians' streams and the captors' state 36. Honouring every gate unconditionally parks stage 5 at block 1, stage 1 at blocks 14 and 16, stage 2 at 35-41, stage 4 at 23-29 and all six on the chapter card |
| `46` | `wait_scripted_actors` | wait | ~approx~ | the civilian gate — `g_civilians_alive`, the same handler as `0x43` on a different counter. **Real**: it holds until the captors are dead. All 68 sites pass operand 0 |
| `47` | `wait_targets_clear` | wait | shown | runtime counter; passed, with the condition reported |
| `48` | `set_script_flag` | flow | **done** | `g_script_flags[operand] = 1` and nothing else — the whole of `EvtOpSetScriptFlag48`. It writes `G.g_script_flags`, the same array the civilians' op 0x1C and the captors' state 36 write |
| `49` | `variant_call_a` | flow | shown | a global picks which operand list runs; the client does not evaluate it |
| `4A` | `variant_call_b` | flow | shown | a global picks which operand list runs; the client does not evaluate it |
| `4B` | `variant_spawn` | spawn | shown | a global picks which operand list runs; the client does not evaluate it |
| `4C` | `unused_4c` | unused | n/a | dispatch slots that map to the empty stub; no shipped file encodes one |
| `4D` | `checkpoint` | flow | *tracked* | records the checkpoint block |
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

