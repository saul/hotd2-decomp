# Browser player: architecture

The player has grown from a camera-path viewer into a partial reimplementation
of the game's runtime, and the decomp still has roughly thirty spawn classes
unread, each a self-contained state machine. This document is the shape that
absorbs them, the rules that keep it one shape, and the checks that make the
rules real.

It is written to be executed in order. Each step leaves the tree green.

**If a rule here cannot be satisfied by the work in front of you, that is a
finding, not an obstacle.** Say so, and change the plan. The one thing that is
never acceptable is a violation smuggled in to get a commit out: the boundaries
below are load-bearing, and every one of them was written after something
expensive went wrong.

## The three layers

```
engine    core/ bundle/ script/ game/   no three.js, no DOM, deterministic,
                                        snapshotable, runs headless
render    render/                       three.js. reads engine state, owns nothing
ui        hud/ -> ui/                   reads one projection, emits commands
app       app/                          the composition root. sees everything;
                                        nothing sees it
```

Dependencies point **down and never up**. `app` may import anything; `render`
and `ui` may import `engine`; `engine` imports nothing above itself. `render`
and `ui` may not import each other.

Each layer earns its boundary by what it makes possible, not by tidiness:

* **engine runs headless.** That is what lets `npm run test:port` drive the
  state machines in under a second, and it is the only reason the gameplay bugs
  in this project get caught before a play-test.
* **render owns nothing.** A snapshot contains nothing from `render/`; loading
  one calls `resync` and the renderers rebuild. A renderer that cannot rebuild
  itself from engine state is a bug in the split, and the snapshot is the test
  that finds it.
* **ui reads a projection.** Not the walker, not `G`. One plain, serialisable
  value per frame, and typed commands back. That keeps the UI replaceable and,
  more importantly, keeps gameplay rules from accumulating in click handlers --
  which is exactly how `main.ts` became a god object the first time.

## Where it is now

Measured at the commit that landed this document:

| Directory | Lines | Files | Layer | What it owns |
|---|---|---|---|---|
| `game/` | 15267 | 79 | engine | **the port.** No three.js, no DOM, no `Math.random` |
| `render/` | 5142 | 17 | render | three.js. Observes engine state |
| `script/` | 2407 | 13 | engine | `walker.ts` — the machine; `ops/` — the 65 opcodes |
| `app/` | 1951 | 5 | app | `main.ts` (1531), the loop, the system adapters |
| `hud/` | 1422 | 6 | ui | hud, ui, bgm, splitter, debug panels, globals view |
| `bundle/` | 1246 | 8 | engine | one module per exporter block |
| `core/` | 337 | 5 | engine | `System`, `World`, `Context`, `Events`, `Rng`, `Snapshot` |

27,772 lines. The four largest files are `script/walker.ts` (1714),
`app/main.ts` (1531), `game/class10/index.ts` (1378) and
`render/characters.ts` (895).

### The honest gaps

`game/` is clean: no three.js, no DOM, no `Math.random`. That boundary holds
and it is the one that has paid for itself. The rest are open, and
`tools/verify_layers.py` reports each of them against a baseline that may not
grow:

| Gap | Count | Cleared by |
|---|---|---|
| Layers ticked by hand from `main.ts` instead of registered with `World` | 14 | step 8 |
| `three` imported by `core/` — `Context` holds a `Scene` and a camera | 1 | step 9 |
| Transcribed exe routines living in `render/` | 32 | step 9 |
| UI modules importing the engine directly | 17 | step 11 |
| Transcribed exe routines living in `hud/` | 7 | step 11 |
| `BAMS_TO_RAD` definitions | 9 | step 12 |

Two of those are correctness, not tidiness. Only 2 of 17 render layers
implement `System`, so most of the renderer is outside `save`/`load`/`resync`:
`RigLayer` keeps `actor.showing` and `Instance.frozen` across a seek, and
nothing rebuilds them, so rewinding can leave a rig held in a pose continuous
play would never produce. And the 32 transcribed routines in `render/` are
unreachable by `test:port` and `verify_port.py` — which is precisely where the
stage-1 car spin lived for as long as it did.

## The gameplay code is a **port**, not an interpretation

This is the load-bearing decision, and it changes the shape of everything else.
The operating procedure that falls out of it is the `/gameplay-port` skill
(`.claude/skills/gameplay-port/`); this section is the *why*.

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

**3b. Closed sets are enums, not loose numbers.** The port is a
transcription, not a transliteration: where the exe enumerates something — a
state table, a class id, a control code, a flag bit — TypeScript gets an
`enum` whose *values* are the exe's own numbers and whose *members* are named
for what the exe calls them.

```ts
export enum ZombieState {
  /** `ZombieStateAttackRun` (`FUN_004554D0`). */
  AttackRun = 1,
  /** `ZombieStateStrike` (`FUN_00455A40`). */
  Strike = 2,
}
```

`obj.state = 4` and `case 0x53:` are how the cat ended up running the zombie's
state machine. The rule is not "no numbers" — a radius, a rate, a frame count
and a threshold stay named constants, because they are scalars rather than
members of a set. It is: **if the exe would switch on it, it is an enum.**

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

`game/` must not import `three`, touch the DOM, or call `Math.random`. It reads
and writes its own globals and actor structs, and the renderer observes them.
That is not architectural purity for its own sake: it is what lets the port be
exercised headlessly, which is the only way these bugs get caught before you
see them.

All three are checked — the first two by `tools/verify_layers.py`, all three by
`tools/verify_port.py`.

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
## `script/`: four machines wearing one class

`walker.ts` is 1714 lines and the target in this document has been "the machine
only, ~300" since it was written. Extracting `ops/` did not move it, because
the opcodes were never the bulk. What is actually in there is four separable
things:

| Concern | Today | Target |
|---|---|---|
| **The VM** — program counter over block/step/op, the dispatch table, `executeOne`, `apply` | fused | `script/vm.ts`, ~250 lines |
| **Resumption** — what makes the VM *stop*: wait policies, the enemy gates, the skip request, the firing gate | `SKIPPABLE_WAITS`, `ENEMY_GATE_WAITS`, `waitSatisfied`, `WAIT_NOTES` | `script/waits/*.ts`, one file per policy kind, registered the way `ops/` register |
| **Script-driven state** — channel tweens, scene state, queued events, the camera action lifecycle | seven methods and the `CH_*` constants | `script/state/{channels,scene,queued,camera}.ts`, each owning its own save slice |
| **Seek** — `seek`, `seekInner`, `reaches`, `takeBranchToward` | inside the VM | `script/seek.ts`, a planner that drives the VM's public surface |

**Seek is the one worth arguing about.** It is not part of the machine: it is a
tool that drives the machine to a target, the way a debugger does. Keeping it
inside is why `fix(gameplay): a camera cue the seek landed past could never
fire` was a walker bug rather than a planner bug. Outside, a seek defect cannot
break playback.

`WalkerHost` has **23 methods**, which is the same smell measured from the
other side: the machine reaching into everything. It collapses to about six.
Outward notifications (`onFeed`, `onBranch`) become events on the bus, because
they are notifications and not host services. Script-driven state is mutated
directly by the ops that own it. What is genuinely left is a small read-only
port for the questions the script asks about the world — `aliveEnemies`,
`aliveCivilians`, `cameraFree`.

## The UI layer

The UI is ~1900 lines of imperative DOM: `index.html` (196 lines, 51
elements), `hud/` (1422), and `wireUi`/`refreshUi` in `main.ts` (~300), wired
with 67 `addEventListener` calls. Four debug surfaces landed in a single day —
the sidebar, the globals view, the collision and stuck overlays — and each one
hand-rolled `createElement`, listeners and `textContent` updates.

**React, on two seams and no more.**

**1. One read model.** A `UiProjection` system in the `hud` phase emits a
plain, serialisable `UiState` once per frame: numbers, strings and arrays. No
three.js objects, no walker reference, no actor references. This *is* the UI
boundary, and because it is plain data it is snapshot-testable like everything
else.

**2. One command model.** The UI never calls the engine. It dispatches typed
`UiCommand`s — `play`, `pause`, `step`, `seek`, `setStage`, `toggleLayer` —
onto a queue the app drains at a tick boundary. That deletes the 67 ad-hoc
listeners and makes an interaction reproducible: a sequence of commands is a
test.

React subscribes with `useSyncExternalStore` and panels select slices, so a
changed score re-renders the score and nothing else. The canvas stays out of
React entirely: three.js owns it, a `<Viewport>` holds a ref and never
re-renders. `hud/bgm.ts` is audio rather than UI and does not move.

**The risk, named so it can be watched:** `UiState` must stay a *projection*.
The moment a panel writes to it instead of dispatching a command, the layer is
gone — which is exactly how `render/` accumulated 32 transcribed exe routines.

### Why React rather than keeping the hand-rolled DOM

Not for its own sake. The panel count is growing weekly and every panel is the
same three chores; the projection and command seams are worth having whatever
renders them, and React is the smallest thing that consumes them well.
`useSyncExternalStore` maps onto the existing snapshot model exactly, so no
state library is wanted or allowed.

## The shape to move to

```
web/src/
  app/          bootstrap and the loop, nothing else. Target: under 400 lines.
    main.ts       build the World, mount the UI, run
    loop.ts       the 60 Hz accumulator, freeze and speed — in one place
  core/
    system.ts     System { id; attach; update; detach; save?; load?; resync? }
    scope.ts      the disposal tree: child / defer / own / dispose
    bams.ts       BAMS_TO_RAD and the angle helpers. One definition.
    world.ts      the registry, the tick order, save() and load()
    context.ts    engine-only: { walker, scope, events, rng, stage, frame }
    events.ts     a typed bus
    rng.ts        seeded, state exposed — snapshots need it
    snapshot.ts   the Snapshot type and the round-trip check
    bams.ts       BAMS_TO_RAD and bamsEuler. One definition.
  game/         the port. The only rules that matter live here.
    ...           one module per class, behind a registry
    stagecast/    rig route selection, frame rules, part rules — pose authority
  bundle/       one module per exporter block, re-exported by index.ts
  script/
    vm.ts         the machine only
    ops/          the 65 opcodes, one module per group
    waits/        one module per wait policy
    state/        channels, scene, queued events, camera action
    seek.ts       the planner
  render/       context.ts -- RenderContext, which adds { scene, camera }
                stagescene, rigs, props, backdrop, rain, fog, lighting,
                campath, characters. Every one a System.
    scope3d.ts    attachTo / ownGeometry / ownMaterial / clone
  ui/           React. projection.ts, commands.ts, and one file per panel
  hud/          bgm.ts — audio, not UI
```

### The three rules that hold the rest together

**1. One `System` interface and one tick order.** Every layer implements
`attach / update / detach`, and `World` ticks them in an order that mirrors the
engine's frame:

```
script -> game -> render -> hud
```

`app/loop.ts` owns the accumulator, `speed` and `freeze`; systems receive an
already-scaled `dt` and the count of 60 Hz frames advanced. Adding a system is
one `world.add(...)` and never touches the loop. **A layer ticked by hand is a
layer outside `save`/`load`/`resync`** — that is not a style point, it is the
rig seek bug.

**2. A typed event bus instead of callbacks.** The port raises them where the
exe would set a flag; the HUD and the feed subscribe. Events are
fire-and-forget notifications **out** of the engine: no system may put state
there, because a snapshot does not contain the queue.

**3. One module per game class, behind a registry** that mirrors
`g_class_handlers`. A class with no module gets no behaviour — the rule that
fixed the cat, made structural instead of an `if`.

## Scopes: every lifetime has an owner

The player has a lifetime problem the exe does not. It owns GPU resources, DOM
nodes, event listeners and audio, and it can switch stage, seek, and restore a
snapshot — none of which the game can do. Today that is managed by hand:

| | count |
|---|---|
| hand-written `detach()` methods in `render/` and `hud/` | 9 |
| manual `.dispose()` / `removeFromParent()` calls | 37 |
| `addEventListener` | 67 |
| `removeEventListener` | **6** |

That last row is the argument. Three leaks found while writing step 8, all the
same shape: `SpawnLayer.labels` is a `Map<string, CanvasTexture>` that `detach`
never touches; `SceneLighting.lit` holds cloned `Material`s and is `.clear()`ed
without disposing them; `props.ts` has a module-level `LABELS` cache with no
owner at all.

A **scope** is a named node in a disposal tree. Things register with it; when it
dies they are undone, children first, in reverse order of registration.

### The one rule

> **A scope holds only what is *not* in the snapshot.**

Which is the same sentence as: **a scope is exactly the set of things `resync`
must be able to throw away and rebuild.** Two consequences, and both are the
point:

* **`game/` never gets a scope.** The port is a transcription, and the exe's
  object lifetime is a fixed pool plus `ActorDespawn` clearing fields in a
  reused slot — no hierarchy, no arena. A scope there would be structure with no
  counterpart in the binary, which is what `verify_port.py` exists to catch.
* **Nothing a scope owns can be game state.** `World.save()` puts every slice
  through `clonePlain`; a scope is a live graph of disposal closures and cannot
  survive that. If something needs to be in a snapshot, it does not belong to a
  scope.

### The hierarchy

```
app                          process lifetime
└── stage                    one loadStage; dies on stage switch
    ├── assets               geometry, textures, templates -- survives a seek
    └── session              everything a seek or a snapshot load rebuilds
        ├── actor:<at>       per-actor render state
        ├── effect:<id>      impacts, projectiles, gore parts
        └── region:<n>       streamed slots (loadSlot / unloadSlot)
```

The `assets` / `session` split is the one that earns its keep. `RigLayer` holds
`actor.showing` and `Instance.frozen` — *how the object got where it is*, not
where it is. That is session state, and carrying it across a seek posed a rig in
a way play could never produce. Step 8 fixed it with a hand-written `resync`
that resets three fields; get the next layer wrong and nothing catches you.
Owned by `session`, a seek drops it because a seek drops the scope.

`region:<n>` is the one level with a counterpart in the game: the asset
opcodes already load and unload a region's slots, which the walker surfaces as
`loadSlot`/`unloadSlot`. `[likely]` — the port's side is read, the exe's side is
not re-read at the time of writing.

### The API

```ts
// core/scope.ts -- no three.js, no DOM. Built.
export class Scope {
  readonly name: string;
  /** The clock's value when this scope was opened. The panel reads it. */
  readonly openedAt: number;
  child(name: string): Scope;
  /** Undo something. Runs LIFO on dispose. */
  defer(undo: () => void): void;
  /** Anything with a `dispose()`: geometry, material, texture, render target. */
  own<T extends Disposable>(t: T): T;
  dispose(): void;                 // children first, then own undos, LIFO
  get alive(): boolean;
  snapshot(): ScopeNode;           // the plain projection the panel renders
  walk(): Generator<Scope>;        // for the leak check
}
```

**`Scope` has no `listen`.** Typing one would mean `core/` naming a DOM event
type, and the engine is meant to run headless — a structural `EventTargetLike`
was tried and is not worth it: TypeScript will not accept `HTMLElement` against
a listener parameter the engine can describe without DOM types. So `Scope`
knows only how to undo a closure, and *what* needs undoing is the calling
layer's business:

```ts
// render/scope3d.ts                                              built
attachTo(scope, parent, node)     // add now, removeFromParent on dispose
ownResources(scope, root)         // every unique geometry/material/texture
cloneInto(scope, parent, tmpl)    // clone, attach, own

// app/dom.ts                                                     built
on(scope, el, type, fn)           // typed via HTMLElementEventMap
onWindow(scope, type, fn)
every(scope, ms, fn)              // setInterval, cleared on dispose
eachFrame(scope, fn)              // rAF loop that stops with the scope
```

`ownResources` de-duplicates through three `Set`s before disposing anything,
because three.js shares geometry and materials freely and disposing one that
two meshes point at is how a stage switch empties half the next stage.

The test of whether the helpers are good enough: **`detach()` should disappear**
from all nine layers. If a layer still needs a hand-written teardown after this,
a helper is missing.

Two are converted as the proof it works. `StuckDebugLayer` lost its `detach`
entirely — the stage scope owns the group, and one child scope per marker means
retiring a marker is `m.scope.dispose()` instead of four hand-written
`dispose()` calls that were also duplicated in the teardown. `SpawnLayer`'s
label textures were a real leak: nothing disposed them and a stage switch built
a fresh set beside the old one. Seven to go.

### Seeing it: the scope panel

A leak is invisible until it is counted, so the debug sidebar grows a **Scopes**
panel showing the live tree:

```
app                                    opened f0      3 owned
└ stage                                opened f0    412 owned
  ├ assets                             opened f0    380 owned
  └ session                            opened f0     32 owned
    ├ actor:0x1a40        ×7           opened f214     6 owned
    ├ effect:impact       ×3           opened f981     2 owned
    └ effect:thrown       ×112  ⚠      opened f88      1 owned
```

Three things, and each of them makes a different leak legible:

* **`openedAt`** — the frame the scope was opened. A child of `stage` whose
  frame predates the current stage load is a scope that survived a teardown.
  Nothing else in the player can tell you that.
* **The sibling count** (`×112`) — repeated names collapse into one row with a
  tally. A hundred and twelve thrown-weapon scopes is a leak you can see from
  across the room; a hundred and twelve rows is a wall of text you scroll past.
* **The owned count and its high-water mark** — growth with a flat scope tree
  means something is registering into a scope that never closes.

The panel reads a **plain projection**, not the tree:

```ts
interface ScopeNode {
  name: string; openedAt: number; owned: number;
  children: ScopeNode[];
}
```

`app/` builds it from the root and hands it over, so `hud/` needs no import from
`core/` — the same seam step 11 generalises, arriving early and for a reason.
This is the first real `UiProjection`, and it is a good one to design against
because it is read-only, plain, and cheap to diff. It works:
`hud/scope_view.ts` added **zero** to `ui-reads-projection-only`.

One wrinkle worth knowing. `openedAt` is stamped from a **monotonic** frame
counter, not `ctx.frame`, because `ctx.frame` restarts at zero on every stage
load — and "was this opened before the current stage loaded" is the one
question the panel exists to answer.

### The check that could fail

Instrument `Scope` in the test build and assert that after ten load / seek
cycles:

* every scope opened during stage *N* is disposed by the time stage *N+1* has
  loaded, and
* the live registration count returns to its first-load value.

That runs headless — it counts registrations, not GPU objects, so no WebGL is
needed. It is `npm run test:scope`, and it is written so that the last case
*fails* the assertion deliberately: a check that has never been seen to fail is
not yet a check.

## Enforcement: `tools/verify_layers.py`

A boundary nobody measures is a preference. Every rule above is checked, and
the check runs in the same suite as the rest:

```sh
python3 tools/verify_layers.py          # summary
python3 tools/verify_layers.py --list   # every violation
```

Two severities, and the difference is the whole design:

* **error** — must be zero. A new one fails immediately. Today: the layer
  direction rule, and `three` / DOM / `Math.random` inside the engine. All four
  are at zero and stay there.
* **ratchet** — a violation the architecture has not reached yet. The current
  count is recorded against the step that clears it, and the build fails if it
  **grows**.

There is deliberately **no suppression comment and no per-file opt-out.** The
escape hatch is to fix the layering or to change the plan.

**Lowering a baseline is the point. Raising one is a decision, and it belongs
in this document, not in the checker.** If a piece of work genuinely cannot be
done without adding a violation, that means the refactor it depends on has to
come first — say so and stop, rather than raising the number. Every ratchet
here is a debt with a named creditor: step 5, 9 or 11.

### `RenderContext` lives in `render/`, not `core/`

The shape above used to put it in `core/render_context.ts`. That would have
kept three.js in `core/` — the same violation, relocated — so it is declared in
`render/context.ts` instead, and `System` is generic over which context a layer
takes:

```ts
export interface System<C extends Context = Context> { … }
export class World<C extends Context = Context> { … }
```

There is still exactly **one** context object at run time. `app/` builds it and
names `RenderContext` as its type; a system that declares plain `Context` is
accepted by the same `World`, because a function taking the narrow one takes
the wide one too. The split is entirely about what each layer is *allowed to
see*, which is the only thing a boundary can usefully be.

A ratchet that reaches zero and can never come back should become an **error**,
which is what happened to `one-bams-constant`. There is no longer a reason to
write that constant anywhere but `core/bams.ts`, so the rule no longer records
a count — it refuses.

### What step 12 actually found

Nine files defined `BAMS_TO_RAD`. Seven spelled it `(Math.PI * 2) / 65536` and
two spelled it `9.58738e-5` — **they disagree in the sixth significant figure**,
which is small enough never to be noticed and large enough that two layers did
not agree about where the same object was pointing.

Neither was right. The exe holds the constant as a **float32**; `9.58738e-05`
is Ghidra's six-digit rendering of it, recorded in `docs/re/session-log.md` as
2π/65536. So `core/bams.ts` says `Math.fround((Math.PI * 2) / 65536)`, which is
the float the binary actually contains. All three agree to about one part in
10^8, so nothing on screen moves; the point is having one answer.

The step also claimed there were duplicate `bamsEuler`s to merge. There were
not — there is exactly one, in `render/rigs.ts`, and it stays there. The
quaternion chains in `characters.ts` and `props.ts` look similar but compose
different rotation orders, so folding them together would be a bug wearing a
refactor's clothes. `bamsEuler` could not live in `core/` anyway: it returns a
three.js `Euler`.

### The rules must keep asking the real question

`layers-are-systems` used to search `main.ts` for `drawLayers` and count what
that method ticked. Step 8 deleted `drawLayers` — and the rule went to zero not
because it was satisfied but because it had nothing left to look at. A rule
that cannot fire is worse than no rule, because the row still reads `ok`.

It now asks the question it was always about: **an exported class in `render/`
with an `update` is a layer, and a layer `app/` never hands to `world.add` is
outside the tick order.** That found `FreeRoam`, which is real — free roam is
mode-gated and main still drives it by hand — so the baseline is 1, owned by
step 5.

When a step clears a ratchet, check whether the rule still has teeth before
dropping the baseline.

## Order of work

Steps 1–4 and 6 are done. Each step compiles, keeps `verify_layers.py` green,
and passes `verify_player_ops.py` and `npm run test:port` on its own.

| # | Step | State |
|---|---|---|
| 1 | `core/` + `app/loop.ts` — `System`/`World`/`Context`/`Events`/`Rng`/`Snapshot`, one scaled `Tick` | ✅ |
| 2 | `game/globals.ts` + `game/actor.ts` — `G` and the actor struct at its offsets | ✅ |
| 3 | `game/class30/`, `class31/`, `class41/` behind the registry | ✅ |
| 4 | `render/`, `hud/`, `script/`, `bundle/` split out; `bundle.ts` split by exporter block | ✅ |
| 5 | **Thin `main.ts`.** 1379 lines against a target of 400. `FreeRoam` is the last layer outside `World`, because it is mode-gated | ◐ — falls out of 11 |
| 6 | `script/ops/` — nine modules, each registering its own entries | ✅ |
| 7 | **`characters.ts`.** The damage half is out; assembly, posing and blending remain | ◐ |
| 8 | **Every layer is a `System`.** All 14 hand-ticked layers registered with `World`; `drawLayers` deleted; `resync` on each. Fixes the rig seek divergence | ✅ |
| 9 | **The engine/render boundary, and who owns what.** `Context` loses three.js and `RenderContext` is added; the remaining seven `detach()` methods go, and `session` scopes take over from the hand-written `resync` bodies; the 32 transcribed routines move to `game/`, rig pose authority first | ◐ — `core/scope.ts`, the helpers, `Context.scope` and two converted layers are in |
| 9b | **The scope panel.** The live tree in the sidebar, with `openedAt`, sibling tallies, warn flags and a high-water mark | ✅ |
| 10 | **`script/` decomposition.** `vm.ts`, `waits/`, `state/`, `seek.ts`; `WalkerHost` down to ~6 methods | ☐ |
| 11 | **The UI layer.** `UiProjection` + `UiCommand` + React; `wireUi`/`refreshUi` deleted; `index.html` becomes a mount point | ☐ |
| 12 | **`core/bams.ts`.** One `BAMS_TO_RAD`, and the rule is now an **error** at zero | ✅ |

### Proving a step did not change behaviour

Before starting, capture the baseline — the headless harnesses are the oracle:

```sh
cd web
for t in replay cadence civilians throwers wall corpses coli_walls; do
  node --experimental-strip-types --no-warnings tools/run_test.mjs \
      tools/$t.mjs > /tmp/base.$t.txt
done
npm run test:port && npm run test:seek
```

Everything goes through `tools/run_test.mjs`, which bundles with esbuild first.
Running a harness with node's bare `--experimental-strip-types` fails on the
first `enum` it meets and tells you so in a way that looks like a real failure.

`coli_walls` **fails at HEAD**, and has since before this work: it reports 51
class-0x31 spawns where the Python reference says 49. Capture it anyway — the
test is that the output does not change, not that it passes.

After the step, every one of those must be **byte-identical**, and
`verify_layers.py`, `verify_port.py`, `verify_player_ops.py` and
`verify_objects.py` must still pass. A step is not done until that holds.


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
* **Globals too.** Every `` `g_name` — `0x00…` `` citation must exist in
  `globals.tsv` under that name, so a global renamed in Ghidra and not renamed
  here fails rather than quietly documenting a symbol that no longer exists.
* **Every `game/class<NN>/` has a `SpawnClass` member**, so no registry key is
  ever a bare number, and every member has a row in `spawns.md`.
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
* a hit takes hit points off, swaps the bone's model, stumbles, severs on the
  step the effect table says, takes the **whole subtree** with it, sets the
  destroyed-zone bit, and does none of it twice;
* a snapshot replays identically — through `structuredClone` *and* through
  `JSON.stringify`, which is the form the button hands out;
* and two runs from the same seed agree, which is what guards the whole of the
  save-state section above.

It runs in well under a second, which is the point: these are the bugs that
otherwise cost a play-test and a bug report each.
