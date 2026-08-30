# Browser player: architecture, and the plan to keep it one

The player has grown from a camera-path viewer into a partial reimplementation
of the game's runtime. Combat alone added ~700 lines in one session, and the
decomp has **roughly thirty spawn classes still unread**, each of which is a
self-contained state machine. The current shape will not absorb that.

This is the plan to make it absorb it. It is written to be executed in order,
each step leaving the tree green.

## Where it is now

The tree below is the one this document asked for; steps 1 to 5 of the order of
work are done. Line counts as of the commit that landed them:

| Directory | Lines | Files | What it owns |
|---|---|---|---|
| `game/` | 1631 | 26 | **the port.** No three.js, no DOM, no `Math.random` |
| `render/` | 3643 | 13 | three.js. Observes game state, owns nothing |
| `script/` | 1543 | 2 | `walker.ts` — the machine **and** all 65 opcodes |
| `app/` | 1530 | 5 | `main.ts` (1164), the loop, the system adapters |
| `hud/` | 1031 | 4 | hud, ui, bgm, splitter |
| `bundle/` | 715 | 8 | one module per exporter block |
| `core/` | 297 | 5 | `System`, `World`, `Context`, `Events`, `Rng`, `Snapshot` |

Two files are still too big and both have a step of their own below:
`script/walker.ts` at 1506 (step 6) and `app/main.ts` at 1164 (step 5 is only
half done — the layer wiring came out, the UI wiring did not).

### What it was, and the four problems this was written against

| File | Lines | What it owned |
|---|---|---|
| `walker.ts` | 1447 | the evt machine **and** all 65 opcode implementations |
| `main.ts` | 1152 | three.js, the loop, every layer, all UI wiring, **and gameplay rules** |
| `characters.ts` | 945 | assembly, posing, blending, damage, gore, death, reactions |
| `enemies.ts` | 828 | slots, permits, ranking, approach, strike, throw, projectiles, camera aim |
| `bundle.ts` | 663 | every JSON type in the bundle, in one flat file |
| 14 others | ~3800 | one concern each — these were fine |

1. **`main.ts` was a god object.** 21 imports, and it owned the render loop,
   the layer wiring, the UI, *and* gameplay rules. Lives and score were
   decremented in two hand-written callbacks (`onStrike`, `onThrowHit`) that
   already duplicated each other. **Fixed:** both are one
   `PlayerTakeDamage`, and the HUD hears about it on the event bus.
2. **There was no notion of a system.** Every layer had a bespoke `update`
   signature and `main.ts` called each by hand, applying its own `dt * speed`
   and freeze rules at each call site. **Fixed:** `app/loop.ts` owns the
   accumulator and hands out one `Tick`.
3. **`enemies.ts` was becoming the whole actor runtime.** One file for class
   0x30 and 0x31, with ~30 more classes to come. **Fixed:** it is gone,
   re-derived as `game/class30/` and `game/class31/` behind a registry.
4. **Callbacks instead of events.** Seven `onX = ...` assignments in `main.ts`.
   **Fixed** for damage; the walker's host interface is still callbacks, and
   deliberately so — it is a host, not a notification.

## The gameplay code is a **port**, not an interpretation

This is the load-bearing decision, and it changes the shape of everything else.

Gameplay logic — enemy behaviour, damage, scoring, permits, the camera
director — is not "informed by" the decomp. It **is** the decomp, transcribed.
The player becomes a reference implementation you can read next to Ghidra, and
any divergence becomes a thing you can grep for rather than a thing you have to
remember.

Four rules, and they are not negotiable inside `game/`:

**1. One exe function, one TS function, same name.** The TS function takes the
remapped name from `ghidra/annotations/functions.tsv` verbatim, and its doc
comment carries the raw address so both directions are searchable:

```ts
/** `ResolveHit` — `FUN_00409430`. Charges one shot against one bone. */
export function ResolveHit(obj: Actor, player: number): void {
```

Nothing gets inlined "because it is only three lines". If the exe has
`ActorApplyDamage` (`FUN_004098C0`), so does the port, and `ResolveHit` calls
it — because the call graph is part of what was decompiled.

**2. Globals are globals.** `game/globals.ts` holds real mutable state named
exactly as `ghidra/annotations/globals.tsv` names it, as fields of one object
that stands in for the data segment:

```ts
export const G = {
  /** `g_enemies_alive` — `0x009C904A`. */
  g_enemies_alive: 0,
  /** `g_attack_permits` — `0x009A2BA0`, one per player. */
  g_attack_permits: [-1, -1] as number[],
};
```

If the exe writes a global, the port writes that global. No passing it as an
argument because that would be tidier, and no hiding it in a class because that
would be more idiomatic. `TryClaimAttackSlot` sets `G.g_attack_permits[i]` and
`PlayerTakeDamage` decrements `G.g_player_lives[p]`, exactly as they do.

The single `G` object rather than a file of `export let` is deliberate and it
is the *save state* talking: a `let` binding cannot be enumerated, so a
snapshot of one would be a hand-maintained list that rots the first time
somebody adds a global. `G.g_enemies_alive` still reads as the exe reads, still
greps as `g_enemies_alive`, and is reachable.

**3. Actor fields carry their offsets.** The object is one struct with the
offsets in comments, because the offsets are how you check the port:

```ts
export interface Actor {
  flags: number;          // +0x34
  pos: Vec3;              // +0x40
  hp: number;             // +0x11C
  attackPermit: number;   // +0x121   -1 when it holds none
  zones: number;          // +0x1318  destroyed-zone mask
  state: number;          // +0x1310
  sub: number;            // +0x1312
}
```

**4. Divergence is declared.** Where the port cannot follow — no collision
meshes in the bundle, three.js quaternions instead of the matrix stack, a
constant we never found — it is tagged and explained on the spot:

```ts
// [diverges] CLOSING_SPEED is invented. The velocity source in the class-0x30
// update was not found: no `fstp [reg+0x4c]` in 0x455000..0x459000, the walk
// clips are in place, and the ring table counts queue depth rather than steps.
```

`[diverges]` is greppable, and the count of them is the honest measure of how
finished this is.

### What that buys

Every gameplay bug this session came from *reinterpreting* rather than
transcribing: the facing was inverted because I rewrote `VecToAngles(obj − p)`
in my own words; the permits deadlocked because I invented a state fallthrough
the engine does not have; the cat walked because I applied class 0x30's machine
to every class; the throwers never threw because I moved a rank test across a
function boundary the engine keeps. **All four are impossible if the call graph
and the globals match.**

### And a boundary that makes it enforceable

`game/` must not import `three`. It reads and writes its own globals and actor
structs, and the renderer observes them. That is not architectural purity for
its own sake: it is what lets the port be exercised headlessly, which is the
only way these bugs get caught before you see them.

```
game/           the port. no three.js, no DOM.
  globals.ts      every g_* the port touches, in one enumerable object
  actor.ts        the object struct, offsets in comments
  class30/        approach.ts attack_run.ts strike.ts backoff.ts
  class31/        thrower.ts projectile.ts
  combat/         permits.ts rank.ts player.ts
  camera/         select_target.ts turn.ts
  tables.ts       the exported data, typed
render/         three.js. observes game state, owns nothing.
```

## Saving and restoring the whole game state

A snapshot is not a feature bolted on the side; it is the property that falls
out of the port being written correctly, and it is worth naming because it is
what *proves* the port is written correctly. If the state of the game cannot be
written to a file and read back, then some of that state is hiding in a closure
or in a three.js node, and the next bug will be in the part that is hiding.

So: **`world.save()` returns a plain JSON value that fully determines the next
frame, and `world.load(snap)` makes the running player identical to the moment
it was taken.** Six rules make that true, and each of them is also just good
porting discipline.

**1. All mutable port state is in two places.** `G` in `game/globals.ts`, and
the actor list. Nothing else in `game/` survives a frame — no module-level
`let` outside `G`, no `Map` keyed on object identity, no state parked in a
closure. The engine's own state is a data segment and a pool of objects; so is
this one.

**2. State is plain data.** `game/` holds no three.js objects, no DOM nodes, no
functions and no class instances in anything reachable from `G` or an actor.
It uses its own `Vec3` — `{x, y, z}` — for the same reason it does not import
three: a snapshot is `structuredClone`, not a serializer with a case for every
type. This is the "no three.js" boundary restated in terms of data, and it is
the one that has teeth.

**3. Randomness is state.** One seeded `Rng` per world, its `state` word in the
snapshot. `Math.random()` is **banned inside `game/`** — an attack pick or a
gore roll drawn from the ambient generator is a state you cannot restore, and
two loads of the same snapshot would diverge on the first swing.
`verify_port.py` greps for it.

**4. Render state is derived, never saved.** A snapshot contains nothing from
`render/`. Loading one calls `resync(ctx)` on every system, and the renderers
rebuild their nodes, poses and visibility from game state. If a renderer cannot
rebuild itself from game state, that is a bug in the split, and the snapshot is
the test that finds it.

**5. Every system declares its own slice.** `save?()` / `load?()` on the
`System` interface, keyed by the system's `id`. A system that does not
implement them contributes nothing and restores by resync. The walker's slice
is its program counter, flags and channels; the game's slice is `G` plus the
actors; the HUD's is nothing at all.

**6. The snapshot says what it was taken against.** A stage index and a version
number, both checked on load, because restoring stage 2's actor list into stage
5's geometry is a crash that would otherwise look like a physics bug.

```ts
interface Snapshot {
  version: number;                  // bumped when any slice changes shape
  stage: number;                    // refuses to load into a different stage
  frame: number;                    // 60 Hz frames since the stage loaded
  rng: number;                      // the world RNG's state word
  parts: Record<string, unknown>;   // system id -> its slice
}
```

What it is for, in rough order of value:

* **Regression tests without a renderer.** Drive the port headlessly to block
  N, snapshot, run 600 frames, and assert on the result. Every gameplay bug in
  this session's list would have been caught by one of these.
* **Determinism as an assertion.** Load the same snapshot twice, run both, and
  compare — a divergence means state escaped the two places it is allowed to
  be. That check is three lines and it guards rules 1 through 3 permanently.
* **Rewind in the debugger.** A ring of snapshots, one a second, and the
  awkward "it only happens after the second zombie dies" bug becomes
  reproducible.
* **Resume.** The deep link already carries a stage, a block and a seed; a
  snapshot carries the rest.

## The shape to move to

```
web/src/
  app/          bootstrap and the loop, nothing else
    main.ts       build the World, wire the UI, run
    loop.ts       the 60 Hz accumulator, freeze and speed — in one place
  core/
    system.ts     interface System { id; attach; update; detach; save?; load?; resync? }
    world.ts      the registry, the tick order, save() and load()
    context.ts    { scene, camera, bundle, walker, events, rng }
    events.ts     a typed bus
    rng.ts        seeded, with its state exposed — snapshots need it
    snapshot.ts   the Snapshot type and the round-trip check
  game/         the port — see above. The only rules that matter live here.
  bundle/       one module per exporter block, re-exported by index.ts
  script/
    walker.ts     the machine only (~300 lines)
    ops/          camera.ts flow.ts region.ts sound.ts hud.ts combat.ts
  render/       stagescene, rigs, props, backdrop, rain, fog, lighting,
                campath, actors (assembly, posing, blending)
  hud/          hud, overlays, ui
```

### The three rules that hold the rest together

**1. One `System` interface and one tick order.** Every layer implements
`attach / update / detach`, and `World` ticks them in an explicit order that
mirrors the engine's frame:

```
script → game → render → hud
```

`app/loop.ts` owns the accumulator, `speed` and `freeze`; systems receive an
already-scaled `dt` and the count of 60 Hz frames advanced. Adding a system
becomes one `world.add(...)` and never touches the loop.

**2. A typed event bus instead of callbacks.** `events.emit("player.damaged",
{...})`. The port raises them where the exe would set a flag; the HUD and the
feed subscribe. That deletes the duplicated damage handling already in
`main.ts` and means the next damage source wires itself. Events are
fire-and-forget notifications **out** of the port: no system may put state
there, because a snapshot does not contain the queue.

**3. One module per game class, behind a registry** that mirrors
`g_class_handlers`. A class with no module gets no behaviour — the rule that
fixed the cat, made structural instead of an `if`.

## Order of work

Each step compiles and passes `verify_player_ops.py` on its own.

1. ✅ **`core/` + `app/loop.ts`.** `System`/`World`/`Context`/`Events`/`Rng`/
   `Snapshot`, and one `Tick` that is already scaled and gated.
2. ✅ **`game/globals.ts` + `game/actor.ts`.** `G` and the actor struct, with
   lives, score, invulnerability and the damage rank on them as
   `PlayerTakeDamage` (`FUN_00415300`).
3. ✅ **`game/class30/` and `game/class31/`.** `enemies.ts` re-derived against
   the decomp — one file per state, named for the exe function, calling the
   real call graph. The class registry mirrors `g_class_handlers`, so a class
   with no module gets no behaviour.
4. ✅ **`render/`, `hud/`, `script/`, `bundle/`.** Moved, and `bundle.ts` split
   by exporter block.
5. ◐ **Thin `main.ts`.** The gameplay rules, the loop, the layer clocks and the
   splitter are out; it is 1164 lines and the target is under 400. What is left
   is the UI wiring (~500 lines) and the stage load (~150), and both want the
   remaining layers to be `System`s first — `drawLayers` is the seam.
6. ☐ **`script/ops/`.** `walker.ts` keeps the machine; each op category
   registers its own entries. `verify_player_ops.py` already checks the opcode
   table against the docs, so this step is guarded.
7. ☐ **`render/actors/`.** Split `characters.ts` (928 lines) five ways. The
   seams are already there — posing, damage, death, reaction — and the damage
   half belongs in `game/` once it is separated. `ResolveHit` is the last
   gameplay function still living in `render/`.

### What the port found on its first headless run

The rewrite in step 3 was not a code move, and two bugs fell out of it that
were live in the player before:

* **The lunge could never reach its attack.** `ZombieStateStrike` closes to the
  attack entry's own distance, and those are *inside* the 25-unit inner ring —
  but the advance clamped every state at the ring. So an actor lunged forever,
  swinging at a range it could not reach. It matches the report of zombies that
  "swing but don't hit, and then repeatedly do the swing anim".
* **The clip clock was owned by the renderer.** `action.t` was advanced in
  `CharacterLayer.update`, so the port could not be run without a screen and a
  save state restored while paused would sit on a half-played swing for ever.
  It is `ActorAdvanceMotion` now, in `game/`, where the engine keeps it.

Neither was findable by reading. Both were the first two failures of
`npm run test:port`.

## The check that makes it real: `tools/verify_port.py`

The porting rules are only worth having if they are enforced, and they are
cheaply checkable because both sides are text.

* **Every `FUN_` address named in a `game/` doc comment must exist in
  `ghidra/annotations/functions.tsv`, with the same name.** A renamed symbol or
  a typo'd address fails the build rather than rotting.
* **Report the coverage.** Count annotated functions in the gameplay address
  ranges against those with a port. That number — "148 of 293 gameplay
  functions ported" — is the most honest progress metric this project could
  have, and it is free.
* **List the divergences.** Every `[diverges]` tag, gathered into the report,
  so the places the port is knowingly wrong are one command away instead of
  spread through the tree.
* **Classes:** enumerate `game/class*/`, cross-check against the class table in
  `docs/formats/spawns.md`, and report which have behaviour, which are
  deliberately inert, and which are simply unread — the drift that let 279
  non-zombie placements run the zombie's AI.
* **The snapshot rules, which are grep-checkable too:** no `from "three"` under
  `game/`, no `Math.random(` under `game/`, and no `export let` in
  `game/globals.ts`. Each of the three is a way for state to escape the
  snapshot, and each has exactly one honest spelling.

## The other check: `npm run test:port`

`web/test/port.test.ts` imports `game/` and nothing else — no three.js, no
DOM — and runs the state machines against a hand-written stage's worth of
tables. It asserts the things that actually went wrong:

* never more than `g_max_attackers` permits held at once;
* someone reaches the player and swings, and lives are spent;
* the retreat happens, so the enemies take turns;
* nothing **walking** crosses the inner ring, and the lunge stops at the
  attack's own distance;
* a class with no module (0x53, the cat) does not move and takes no permit;
* a spawn whose descriptor names no attack never takes a permit, and does not
  block the one that can;
* a snapshot replays identically — through `structuredClone` *and* through
  `JSON.stringify`, which is the form the button hands out;
* and two runs from the same seed agree, which is what guards the whole of the
  save-state section above.

It runs in well under a second, which is the point: these are the bugs that
otherwise cost a play-test and a bug report each.
