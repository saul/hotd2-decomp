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

| Directory | Lines | Files | Layer | What it owns |
|---|---|---|---|---|
| `game/` | 15423 | 80 | engine | **the port.** No three.js, no DOM, no `Math.random` |
| `render/` | 5752 | 23 | render | three.js. Observes engine state, owns nothing |
| `app/` | 2984 | 18 | app | `main.ts` (1060), the loop, the adapters, the projection |
| `script/` | 2873 | 22 | engine | `walker.ts` — the machine; `ops/`, `waits/`, `state/` |
| `ui/` | 1883 | 20 | ui | React: one projection in, one command union out |
| `bundle/` | 1246 | 8 | engine | one module per exporter block |
| `core/` | 721 | 8 | engine | `System`, `World`, `Scope`, `CameraFrame`, `Snapshot` |
| `hud/` | 309 | 1 | ui | the shutter and the caption, drawn |
| `audio/` | 248 | 1 | ui | `bgm.ts` |

31,439 lines. The four largest files are `script/walker.ts` (1525),
`game/class10/index.ts` (1378), `app/main.ts` (1060) and `game/actor.ts` (842).

### The gaps, and what closed them

`game/` has been clean throughout: no three.js, no DOM, no `Math.random`. That
boundary is the one that paid for itself first. The others were open when this
document was written, each measured by `tools/verify_layers.py` against a
baseline that could fall but never rise — and the order of work below is what
drove each to zero.

| Gap | Was | Cleared by |
|---|---|---|
| Layers ticked by hand instead of registered with `World` | 14 | step 8 |
| `three` imported by `core/` — `Context` held a `Scene` and a camera | 1 | step 9 |
| Transcribed exe routines living in `render/` | 32 | step 9 |
| UI modules importing the engine directly | 17 | step 11 |
| Transcribed exe routines living in `hud/` | 7 | step 11 |
| `BAMS_TO_RAD` definitions | 9 | step 12 |
| Checks that could not read `.tsx` at all | 3 rules | step 13 |
| Attributes with two writers | 3 | steps 15-16 |
| Script state kept outside the snapshot | 2 | steps 14, 19 |

Two of those were correctness rather than tidiness, and both bit. Only 2 of 17
render layers implemented `System`, so most of the renderer was outside
`save`/`load`/`resync`: `RigLayer` kept `actor.showing` and `Instance.frozen`
across a seek and nothing rebuilt them, so rewinding could leave a rig held in
a pose continuous play would never produce. And the 32 transcribed routines in
`render/` were unreachable by `test:port` and `verify_port.py` — which is
precisely where the stage-1 car spin lived for as long as it did.

Two ratchets are still above zero, and both are real rather than accounting.

**`render-drives-the-port`, at 13.** The camera shot calls
`CamAdvancePathFrame` and `CamSetPathTarget`; the character layer spawns
actors and resolves hits; the shooting layer takes a shot at a breakable and
scores it. Every one is the *renderer* deciding something the port should
decide, because the input that triggers it — a pointer, a curve evaluation —
lives on this side of the seam. Closing it means the port owning a shot queue
rather than the layer that noticed the click, which is a piece of gameplay
work and not a refactor. It has no step yet; adding one is the next thing to
decide, not a line edit in the checker.

**`layers-are-systems`, at 1.** `FreeRoam` is never `world.add`ed, and it is
mode-gated: it only runs in free roam, where the script is not playing and
there is nothing for a snapshot to be wrong about. Step 5's row says so.

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
| **Script-driven state** — channel tweens, scene state, queued events, the camera action lifecycle | seven methods and the `CH_*` constants | `script/state/{channels,queued}.ts` — **two**, not four; see below |
| **Seek** — `seek`, `seekInner`, `reaches`, `takeBranchToward` | inside the VM | `script/seek.ts`, a planner that drives the VM's public surface |

**Two state modules, not four.** `channels.ts` is arithmetic over eleven
numbers with no host, no camera and no cursor, so it comes out whole.
`queued.ts` is the action ring *and* the outstanding `cam_play`, which the
plan had as two files and which are one mechanism: the engine runs the ring
one action at a time, so a shot being replaced **is** the previous action
completing. Splitting them is what would let the count and the flag be written
down inconsistently, which is the bug that used to park a reload for ever.

`scene.ts` was not worth making. `enterSceneState` is one assignment and
`retireSceneSequence` is two calls; a file for them would be indirection with
nothing inside it.

Neither module owns a save *slice*, either. The plan said each should, but the
walker's `saveState` is a flat list of forty keys and `loadState` a loop over
their names — a shape whose whole virtue is that it is one list. The modules
own the **logic**; the fields stay accessors onto them, so forty call sites and
the round-trip test go on speaking the same language.

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

The UI is React over two seams and no more. `index.html` is nine lines and a
`<div id="app">`; everything the page has is rendered by `ui/App.tsx`, the
canvas included.

**One read model.** A `UiProjection` is built once a frame by `app/` and
published to a store React subscribes to with `useSyncExternalStore`. It is
plain data: numbers, strings, booleans and arrays of them. No three.js
objects, no walker reference, no actor references.

**One command model.** The UI never calls the engine. It dispatches a
`UiCommand` — a closed union — and `app/commands.ts` is the one exhaustive
switch that decides what each one means. A command added without a case there
fails to compile, which is the property the twenty-odd anonymous
`addEventListener` callbacks it replaced could not have: there was no list of
what the UI could do, and no way to be told one had been missed.

### The seven rules

Written once, because the review that produced steps 13 to 19 found the same
mistake in seven different costumes: **a fact with two owners**. Each rule
below is one of them, and the fix in every case was to delete an owner rather
than to keep two in step.

**1. `ui/` reads one projection and emits commands.** No import from `game/`,
`script/`, `bundle/` or `core/`, type-only included. A panel that reads engine
state directly is a second reader with its own idea of *when* to look, which
is how a sidebar comes to disagree with the boxes drawn round the actors it is
listing. `ui-reads-projection-only` and `layer-direction` are the checks, and
they have read `.tsx` since step 13 — for the eleven months before that they
printed `error 0 ok` having never opened the files.

**2. The projection is plain data.** If `structuredClone` would not round-trip
it, it does not belong — the same test a snapshot slice has to pass, for the
same reason.

**3. A command is the UI asking the *world* to change.** Anything that changes
nothing outside `ui/` — a fold, a filter, a scroll position, a panel width —
is component state. It is not a command, it is not in the projection, and it
does not reach `app/`. Putting it there drags UI-local state up into the
composition root and grows the union with things the game has no opinion
about.

**4. Slices are referentially stable when their content has not changed, and
a component subscribes to the slice it reads.** The stability comes from one
generic recursive `share` pass — see `app/projection/stable.ts` — which
returns the previous object for every part that did not move, at every depth;
`publish` then decides whether to notify at all with a single `===`.

The subscription is what turns that into a diff. Each component calls
`useSlice` with a selector that **names a field and never builds a value**, so
the selector's result is already `Object.is`-stable and React re-renders
exactly those components whose field moved. A selector that constructs
something is wrong loudly — React throws *"The result of getSnapshot should be
cached"* on the first render — and `selectors-return-fields` catches it before
it runs. `memo` survives only where a component is still handed props by a
parent that maps over a list, which is `Block` in the script tree and `Lines`
in the sidebar; everywhere else per-slice subscription made it moot, and the
rule that used to police it was deleted rather than tightened.

**5. Cost is demand, and demand is expressed by mounting.** An open panel
registers a claim on the slice it shows; `app/` asks `wants(slice)` and never
asks the DOM anything. "Is this panel open" and "is this component mounted"
are one fact, not two.

**6. One writer per pixel.** No imperative DOM write to anything React
renders. A component reaching for a node **it rendered itself** is a different
matter and is allowed where React's model is the wrong tool — the script
tree's highlight and the minimap's canvas both do it, inside the component
that owns the node.

**7. State the script drives belongs to the script**, not to the layer that
draws it. The shutter and the caption are the case that proved it: their state
lived in `hud/`, so a snapshot restored the shutter's *state* without the
slide phase behind it.

### What each rule cost when it was missing

| rule | what it looked like |
|---|---|
| 1 | three `error` rules reporting zero over 790 lines they had never opened |
| 2 | — held throughout; the one rule nothing has yet broken |
| 3 | the projection builder reading `<details>.open` out of the document, once a frame, to decide what to build |
| 4 | `JSON.stringify` of the whole projection every frame, because every slice was a fresh object and `memo` could never bail. Then, after `stabilise`: one root subscription, so any change re-rendered `App`, the sidebar and all seven panels before the leaf `memo`s could bail — and two panels took the whole projection as a prop, so theirs could not bail at all while the checker reported zero |
| 5 | `rememberFolds` persisting a fold that `app/` then read back through a `querySelector` |
| 6 | the active mode button lit for about a frame; `#viewport` carrying a class from `app/` and another from `render/` while React rendered neither; sixteen portals that silently rendered nothing if an id was renamed |
| 7 | a save taken mid-shutter-close coming back frozen part-way shut |

None of those was a typo. Each was a reasonable local decision that became
wrong once something else moved, which is why they are rules and not a style
guide.

## The tree

What is on disk. Where a line is still a plan it says so.

```
web/src/
  app/          the composition root: the only layer that sees all the others
    main.ts       `Player` — 1060 lines, and step 5 closed at that size
                  deliberately: see "400 was the wrong number" below
    loop.ts       the 60 Hz accumulator, freeze and speed — in one place
    systems.ts    the adapters: GameSystem, ScriptSystem, drawSystem
    commands.ts   the one exhaustive switch over `UiCommand`
    ui_root.ts    createRoot on #app, and the canvas coming back
    projection/   what the UI is told, assembled — player, sidebar, script,
                  globals, hud, message, and `stable.ts`
    stage_load.ts, walker_host.ts, urlstate.ts, viewprefs.ts
  core/         the framework. No three.js, no DOM.
    system.ts     System { id; attach; update; detach; save?; load?; resync? }
                  and Context { walker, scope, session, view, stage, frame }
    world.ts      the registry, the tick order, save() and load()
    scope.ts      the disposal tree: child / defer / own / dispose
    camera.ts     CameraFrame — the camera as plain numbers, for the port
    snapshot.ts   the Snapshot type and the round-trip check
    events.ts     a typed bus
    rng.ts        seeded, state exposed — snapshots need it
    bams.ts       BAMS_TO_RAD and the angle helpers. One definition.
  game/         the port. The only rules that matter live here.
    class10/ class24/ class25/ class30/ class31/ class41/ class44/
                  one module per class, behind `registry.ts`
    globals.ts    `G`, the data segment      actor.ts   the struct at its offsets
    camera/ combat/ effects/                 coli.ts, motion.ts, tables.ts, ...
  bundle/       one module per exporter block, re-exported by index.ts
  script/
    walker.ts     the machine, and the script's own state
    ops/          the opcodes, one module per group
    waits/        one module per wait policy
    state/        channels, scene, queued events, camera action
    seek.ts       the planner
    (`vm.ts` is step 10: the machine still shares a file with the state)
  render/       three.js. Reads engine state, owns nothing.
    context.ts    RenderContext, which adds { scene, camera }
    camera.ts     the shot, the take and the draw — three systems, in order
    stagescene, rigs, props, backdrop, rain, fog, lighting, campath,
    characters, shooting, breakables, projectiles, overlays, debug
    scope3d.ts    attachTo / ownGeometry / ownMaterial / clone
  ui/           React. One projection in, one command union out.
    App.tsx       the page, including the canvas; App provides, Page renders
    store.ts      UiStore: publish, subscribe, dispatch, demand
    store_context.ts  useStore / useDispatch — the store by position, not prop
    useSlice.ts   one subscription per slice; a selector names a field
    ErrorBoundary.tsx  one region dies instead of the page
    projection.ts what the UI is allowed to know
    commands.ts   what the UI is allowed to ask for
    persist.ts    usePersisted — folds and widths, and nothing else
    panels/       one file per panel, each subscribing to what it reads
  hud/          hud.ts — the shutter and the caption, drawn. Holds no state,
                and no longer builds its own nodes: React renders them and
                hands them over through `UiHost`
  audio/        bgm.ts — audio, not UI
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

// app/dom.ts                                          built, then deleted
on(scope, el, type, fn)           // typed via HTMLElementEventMap
onWindow(scope, type, fn)
every(scope, ms, fn)              // setInterval, cleared on dispose
eachFrame(scope, fn)              // rAF loop that stops with the scope
```

The DOM half of that pair is **gone**, and how it went is the interesting
part. It was written for the 67 hand-wired listeners, and steps 15 to 26 gave
every one of them to React, which undoes its own listeners on unmount and
needs no scope to be told to. By step 28 the file had fifty-five lines and
zero importers, and it was deleted rather than kept for a caller that might
come back: a helper with no users is a claim about the design that nothing
checks. It is in the history if the browser shell ever grows a listener React
cannot own. `render/scope3d.ts` is untouched — three.js has no unmount, so the
scene graph still needs every one of its three.

`ownResources` de-duplicates through three `Set`s before disposing anything,
because three.js shares geometry and materials freely and disposing one that
two meshes point at is how a stage switch empties half the next stage.

The test of whether the helpers are good enough: **`detach()` should disappear**
from all nine layers. If a layer still needs a hand-written teardown after this,
a helper is missing.

**All nine are gone.** The interesting part was that converting them showed
two lifetimes had been conflated. `BreakableLayer.detachAll` cleared its
templates *and* its nodes together — but the templates are adopted out of the
stage's glTF and the nodes follow `G.g_breakable_props`, which a **seek**
replaces. One belongs to `stage`, the other to `session`, and clearing both
together is why a seek left the node map indexed on props that no longer
existed.

`SpawnLayer`'s label textures were a plain leak: nothing disposed them, so a
stage switch built a fresh set beside the old one.

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

### A seek and a load are the same rebuild

`World.load` ended with a `resync` pass over every system. A **seek** had no
such pass: it called `chars.resync()` and `syncCameraToWalker()` by hand and
left everything else to notice on its own. Two rebuild paths that nearly agree
is how they came to disagree.

`World.resync(ctx)` is now public and both take it. `app/` recycles
`ctx.session` immediately before either, so a layer's `resync` claims the *new*
session — which is what makes "a seek cannot leave a layer holding state play
would never produce" structural instead of something each `resync` has to
remember.

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

### `no-engine-truth-in-render` was measuring the wrong thing

It grepped `render/` for `FUN_00xxxxxx` and `0x00xxxxxx`, and reported 32.
**All 32 were citations in doc comments** — the evidence this project requires
wherever a reading of the binary informs the code — and several said outright
that the routine itself is in `game/`:

> `ResolveHit` (`FUN_00409430`) is in `game/combat/`, where it belongs

Driving that number to zero would have meant deleting the evidence trail. So
the measurement was re-aimed at what the rule always meant — *the renderer
must not be the port* — and split in two:

* **`no-engine-writes-in-render`** (error, 0): a render file assigning to `G`.
  There was exactly one, `Shooting`'s score setter, and chasing it found the
  renderer doing the engine's scoring arithmetic (`this.score += points`)
  instead of calling `ScoreAddForPlayer`, which is the one routine every award
  and penalty in the game goes through.
* **`render-drives-the-port`** (ratchet 13, step 11): an engine function
  *called* from `render/`. Types, enums and pure maths do not count, and
  `game/vec.ts` is exempt by module because it holds no state.

The second one immediately earned its keep. Moving the rain simulation into
`game/effects/rain.ts` pushed the count to 15, because `render/rain.ts` was
still the thing *asking* for each frame's fall. Advancing the pool is a
decision about the world, not about the picture, so it became `RainSystem` in
the game phase and the count came back to 13.

### What moving the rain was worth

`DrawRainParticles` (`FUN_004136A0`) interleaves its simulation with its
drawing, as most of this engine's per-frame code does. The simulation half —
fifty positions, `p.y -= 2.0`, the respawn box — is now `game/effects/rain.ts`
against `G.g_rain_particles` (`0x007C1EB8`), which is where the engine keeps
it. Two things fall out:

* **The rain is in the snapshot.** A save used to restore the whole world
  except where the rain was, and every drop jumped on a load.
* **It is reachable by `test:port`**, which is the entire point. Writing those
  assertions found that the obvious invariant is false: the routine falls
  *then* tests once, so a respawn may itself land below the line — the box runs
  to -25 and the line is at -7 — and that drop falls again next frame. The
  real invariant is that a drop never leaves the spawn box's vertical range.
  The port had it right; the first draft of the test did not.

### `no-engine-truth-in-ui` had the same defect, and took the same fix

Its description was literally "same, for the UI layer", and so was the
problem: all seven hits were citations in doc comments — the sound name
table's address in `bgm.ts`, the routine `hud.ts` draws from. `hud/` never
wrote engine state at all, and the *reading* it does wrong is already counted
in full by `ui-reads-projection-only`. So it became
**`no-engine-writes-in-ui`** (error, 0), and the debt that matters stays where
it was: 17, paid down by step 11.

### What the UI boundary cost, and what it caught

`ui-reads-projection-only` went 17 → 0 and is now an **error**; `MAY_IMPORT`
for `ui` is `{"ui"}`, so the direction rule catches it first and more sharply.
Six panels moved, and the interesting part was what each one turned out to
need:

* **The globals panel and the sidebar** were reading `G` and the walker
  directly — a second reader of engine state with its own idea of when to
  look, which is how a sidebar comes to disagree with the boxes drawn round
  the actors it lists. `DebugBoxLayer.highlight` had grown a structural
  interface and a documented one-frame lag to avoid `render` importing `ui`;
  with a projection there is nothing to reach for and the lag is gone.
* **`bgm.ts` was never UI.** It moved to `audio/`, which the layer map puts
  with `render/`: an output device that reads engine state and owns nothing is
  the same contract as a renderer. The doc had already said as much — "bgm.ts
  — audio, not UI" — while leaving it somewhere it could not comply.
* **Type-only imports count.** `hud/hud.ts` took `MessageVariant` straight
  from the exporter. No code crosses at run time, but the UI still tracks a
  schema it does not own; it takes four fields now and `app/` maps the record.

Two things the projection had to be shaped around, both about cost:

* **The script tree is built once per stage, not once per frame.** Thousands
  of rows, none of which change; only which one is *current* does. It is kept
  by reference with a `treeVersion` beside it, and the change key is computed
  without it — the one shape of this that would have been too slow was
  stringifying it sixty times a second to discover it had not moved. The feed
  and the minimap graph are the same.
* **The tree's highlight and filter are applied to committed DOM.** Threading
  either through props would reconcile every block in the stage to move one
  outline.

### `main.ts` is 1054 lines, and 400 was the wrong number

The target in this document was 400 from the day it was written, and it was a
guess made before the projection layer and the command union existed — both of
which live in `app/` by construction.

Six things came out: `stage_load.ts`, `commands.ts`, `walker_host.ts`, and
`projection/{player,hud,chrome}.ts`, 1649 down to 1054. What is left is
measured, not estimated:

```
 166  the constructor -- the wiring
 104  imports
  67  the frame
  58  wireUi
 ~30 small methods, 15-35 lines each
```

The largest item **is** the composition root: twenty systems constructed and
registered, the context built, the scope tree opened. Getting to 400 from here
means splitting `Player` into four objects that each own part of the wiring,
plus the plumbing to let them see each other — one 1054-line file traded for
four files and a new seam, with the coupling unchanged. That is worse.

The extraction that was worth doing anyway was `PlayerView`: a **read-only**
interface that `Player` implements, so what the UI depends on is written down
and nothing in a projection builder can write back. `implements` is what keeps
the answer true. Two members had to be renamed before it would compile, and
both were genuine confusions — `stage` was the number *and* the loaded scene,
`minimap` the route graph *and* the canvas widget.

Two ratios are worth more than the line count, and both moved: `main.ts` holds
**two** `addEventListener` calls, neither of them a control, and every one of
the player's twenty-five commands is a case in one exhaustive switch.

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

## What the review found, and what was rejected

The findings themselves are the seven rules above and the table under them;
listing them twice would make one copy the stale one. What is worth keeping
here is the reasoning that does **not** survive as a rule — the alternatives
that were considered and turned down, because those are what a future reader
is most likely to re-propose.

**A `foldPanel` command, with a `PanelName` union and a `ViewPrefs` key.** The
obvious fix for the projection builder reading `<details>.open` was to send the
fold *up* instead: make it a command, keep it in the projection, persist it
with the other view preferences. It is the wrong direction. A fold changes
nothing outside `ui/`, so the command union would grow a member describing
something the world has no opinion about, and the composition root would carry
state that exists only to be handed straight back. The right fix was to notice
that the `<details>` was doing two jobs — keeping the fold, and answering
"is this worth building" — and to separate them: the fold stays local, and the
cost becomes demand expressed by mounting.

**A cleverer regex for the sixteen portal mounts.** `verify_player_dom.py`
could not see `into("#globals", …)`, so it could not tell you that a renamed id
had silently stopped a panel rendering. Teaching it to recognise that one
helper would have made the tool understand one call site in one file. The
selectors were built at run time and no static check could see them in
general; that was an argument for deleting the portals, not for a smarter
tool. Step 16 deleted them, and in the meantime `into` threw.

**`useSyncExternalStoreWithSelector`.** The React-shaped answer to "panels
should select slices". It is a separate shim to depend on, and it re-runs
every selector on every publish anyway — so the work it avoids is the render,
not the comparison, and the comparison is what was expensive. Structural
sharing gets the same result with no dependency and makes the *store* cheaper
too: `publish` compares once, by identity.

**A hand-listed set of fields to compare.** The obvious cheap version of
`stabilise`. It goes stale the first time a field is added, silently, and in
the direction of doing more work — which is the same failure the old change
key had and the reason it was written as a `JSON.stringify` of everything in
the first place. Generic, or not at all.

**Two more mechanisms for rules the types already hold.** See
`web/tools/verify_ui.mjs`: the projection being plain data is a runtime
property that `test:state` and `test:projection` prove better than any static
check, and the command union is exhaustive because it is a closed union in an
exhaustive switch. The strongest rule in this layer is a type.

## Order of work

Steps 1 to 27 are done. What is left is **step 10** — `script/walker.ts` is
still 1525 lines holding the machine, the opcodes' state, the waits and the
seek planner in one class, and `WalkerHost` is 14 methods — and **step 28**,
the last of the second UI review's, described below the table.

Each step compiles, keeps `verify_layers.py` green, and passes
`verify_player_ops.py` and `npm run test:port` on its own.

| # | Step | State |
|---|---|---|
| 1 | `core/` + `app/loop.ts` — `System`/`World`/`Context`/`Events`/`Rng`/`Snapshot`, one scaled `Tick` | ✅ |
| 2 | `game/globals.ts` + `game/actor.ts` — `G` and the actor struct at its offsets | ✅ |
| 3 | `game/class30/`, `class31/`, `class41/` behind the registry | ✅ |
| 4 | `render/`, `hud/`, `script/`, `bundle/` split out; `bundle.ts` split by exporter block | ✅ |
| 5 | **Thin `main.ts`.** 1054 lines. The 400 target was wrong — see below. `FreeRoam` is the last layer outside `World`, because it is mode-gated | ✅ |
| 6 | `script/ops/` — nine modules, each registering its own entries | ✅ |
| 7 | **`characters.ts`.** 898 → 647, with `characters/{instance,pose,gore}.ts` beside it | ✅ |
| 8 | **Every layer is a `System`.** All 14 hand-ticked layers registered with `World`; `drawLayers` deleted; `resync` on each. Fixes the rig seek divergence | ✅ |
| 9 | **The engine/render boundary, and who owns what.** `Context`/`RenderContext` split, `core/scope.ts` and the helpers, all nine `detach()` gone, `session` scopes, and the render/port boundary re-measured | ✅ |
| 9b | **The scope panel.** The live tree in the sidebar, with `openedAt`, sibling tallies, warn flags and a high-water mark | ✅ |
| 10 | **`script/` decomposition.** `vm.ts`, `waits/`, `state/`, `seek.ts`; `WalkerHost` down to ~6 methods | ☐ |
| 11 | **The UI layer.** `UiProjection` + `UiCommand` + React; `ui-reads-projection-only` is an **error** at zero, `ui` may no longer import `engine` at all, and `wireUi` is two listeners neither of which is a control. The inversion was finished by steps 15-18: `index.html` is a mount point and the portals are gone | ✅ |
| 12 | **`core/bams.ts`.** One `BAMS_TO_RAD`, and the rule is now an **error** at zero | ✅ |
| 13 | **The checks read the UI layer.** `verify_layers.py` and `verify_player_dom.py` glob `.tsx` too; the DOM selector accepts a type parameter; `into()` throws on a missing host instead of rendering nothing | ✅ |
| 14 | **The snapshot oracle.** `CameraFrame` extracted so `GameSystem` is three-free and `System<Context>`; `web/test/state.test.ts` drives the real `World` headless and asserts save/load and seek equivalence frame by frame. Found two real bugs on its first run — see below | ✅ |
| 15 | **Panels own themselves.** Fold is `ui/` state, not a DOM read; cost becomes demand expressed by mounting; `rememberFolds` deleted and `app/projection/player.ts` loses its `$`. The whole right sidebar is React's, the minimap included | ✅ |
| 16 | **`index.html` becomes a mount point.** The chrome is React's, canvas included; `createPortal` and the sixteen mount ids go; the loading overlay, the paused overlay and `#status` become projection state, the filter and the splitter become component state; the `.mode` and `.shooting` collisions go with their imperative writers. `web/test/ui.test.tsx` renders the page | ✅ |
| 17 | **`refreshUi` dies.** `hudRows` computed where it is read, the minimap paint into its component, all 19 call sites and `setPlayButton`/`refreshPausedOverlay` gone. `markAddress` keeps the half that was state. One update path | ✅ |
| 18 | **Structural sharing replaces the change key.** One generic `stabilise` pass, panels `memo()`, `publish` decides on identity; `projectionKey`, `revision`, `treeVersion` and `feedVersion` deleted; `web/test/projection.test.ts` guards the reference identity | ✅ |
| 19 | **The shutter and the caption become engine state.** `g_bHudShutterState` and `g_bHudShutterPrev` named; the slide counter turned out to be a task field and to *be* `gateCloseLeft`, so the two became one; `Hud` holds no state and `app/` adapts it with `drawSystem` | ✅ |
| 20 | **This document describes what is.** `## The UI layer` is the UI's seven stated rules; the tree matches the tree; the findings collapse into the rules and into what was *rejected*; `web/tools/verify_ui.mjs` holds the two that need an AST | ✅ |
| 21 | **The stylesheet has one owner.** `verify_player_dom.py` re-aimed at the two questions that are still load-bearing; the seven rules step 16 orphaned restored, as ids where the control is a singleton and as structural selectors where it is a role | ✅ |
| 22 | **The error boundary.** Six: the top bar, the script tree, the viewport overlays, the sidebar, the transport and a root backstop, so one bad value in one panel cannot blank the page. A healthy one renders no element, because the grid places by source order; none may enclose the canvas. Recovery is explicit — a boundary that reset on the next projection would re-render the throwing panel at 60 Hz — and the caught value is boxed so `throw null` cannot reach the same loop from the other side. `onUncaughtError`, because a boundary that catches already reports under the name of the region that died; routing into the feed waits for step 28 | ✅ |
| 23 | **`stabilise` goes recursive.** One `share()` pass instead of compare-then-copy, and sharing at every depth rather than only at the projection's top-level keys — which is what lets a per-group `memo` bail when a sibling moved | ✅ |
| 24 | **One subscription per slice.** `useSlice` over `useSyncExternalStore`; store and dispatch from context; `panels-are-memoised` **deleted** and replaced by `selectors-return-fields` | ✅ |
| 25 | **The publish path has one owner.** Published at the end of every frame rather than from a system inside `if (this.walker)`; the hand-publishes in `setLoading`/`fail` and `panelSystem` go with it | ✅ |
| 26 | **React owns every pixel inside `#viewport`.** The hud layer and the crosshair rendered by React and handed across through `UiHost`; `hud/` and `render/` write geometry onto nodes they were given. New **error** rule: no DOM insertion outside `ui/` | ✅ |
| 27 | **The write seam.** `PlayerCommands`, so the half of the seam that mutates is as declared as `PlayerView` made the half that reads | ✅ |
| 28 | **The small ones.** `app/dom.ts` deleted; one owner each for `SHUTTER_LABEL` and `SubtitleLine`; `FeedRow.seq` and the feed keyed on it; step 22’s `onError` routed into the feed. The shutter label cascaded further than the list did: `Hud.describe` moved to `app/projection/hud.ts`, which took `Hud.enabled` and `setEnabled` with it, which emptied `applyToggle`’s `case "hud"` and dropped `hudLayer` from `PlayerCommands` | ✅ |

### The second UI review, and the eight steps it produced

Steps 13 to 20 were driven by one review; steps 21 to 28 are driven by a
second, taken once the whole layer was in place and could be read as a layer
rather than as a migration. It found one live bug, four places where the
design is weaker than this document claimed, and three pieces of residue.

**The live bug: seven orphaned rules.** Step 16 moved every element of the
chrome out of `index.html` and into React, and seven `#id` selectors in
`style.css` were left styling ids that nothing renders any more — the branch
routes' buttons and subtitle, the skip button and its subtitle, the volume
slider, the camera-frame label, and `#bgm-label.blocked`, which is the *only*
indication that the browser is holding audio until the page is clicked. Every
check in the repo was green over it. That is the same failure the whole
project keeps meeting from a new direction: **an id is a fact with two
owners**, the stylesheet and the markup, and step 16 deleted one of them
without telling the other.

`verify_player_dom.py` could not have caught it. Its question — "is every id
the player looks up present in `index.html`?" — went vacuous the moment
`index.html` shrank to a mount point; it reports **one id**. Step 21 re-aims
it at the two questions that are still load-bearing, in both directions.

**Where the document over-claimed.** Rule 4 says slices are referentially
stable so that `memo` is the diff. That is true, but only at *slice*
granularity: `stabilise` shares at the projection's top-level keys and nowhere
deeper, so one actor moving out of forty makes the whole `actorPanel` new and
every group re-renders. And the root subscribes to the whole projection, so
any change re-renders `App`, `Sidebar` and seven `Panel`s before the leaf
`memo`s can bail. Two components — `StagePicker` and `ViewSettings` — take the
entire projection as a prop, so their `memo` can never bail at all, while
`verify_ui.mjs` reports `panels-are-memoised: 0 ok`. That is precisely the
outcome that file's own header warns about: a rule satisfied in the checker
rather than in the code.

Steps 23 and 24 fix the cause rather than the symptom, and step 24 **deletes**
`panels-are-memoised` rather than making it cleverer. Per-slice subscription
makes the memo unnecessary, which is the best end a lint rule can have.

**On cadence, and why nothing is throttled.** The obvious reading of the above
is that the UI should be published less often than 60 Hz. It should not, and
the measurement says why. `publish` already bails on identity, so on a frame
where nothing changed React does *nothing* — no render, no reconciliation, not
even a listener call. What is paid every frame is ours: building the slices
and diffing them, on the order of six hundred leaf comparisons and a hundred
and fifty string allocations for an open-everything frame, against a 16.6 ms
budget. Capping the rate would trade a real property — the panels are live
while the clock is stopped, which is when they are most useful — for a saving
of under one percent. After steps 23 and 24 the property that matters is
structural: **the number of React renders per frame is proportional to the
number of slices that actually changed, not to the size of the page.**

**The residue.** `app/dom.ts` has fifty-five lines and zero importers, and is
still listed in the tree above. `SHUTTER_LABEL` is duplicated verbatim in
`script/ops/hud.ts` and `hud/hud.ts` — a nine-row table with two owners, in
the two files step 19 wrote to give the shutter one. `SubtitleLine` is
declared in `ui/projection.ts`, whose stated contract is "what the UI is
allowed to know", and is not a field of `UiProjection`: only `hud/` uses it.
And the event feed keys on the array index over a `slice(-400)` window, so
past the cap every push shifts every index and React rewrites four hundred
rows to add one. Step 28.

**What the fourth of those cost to fix, which is the interesting part.** The
duplicate label table could not be resolved by sharing a module: `script/` is
engine and `hud/` is ui, and rule 1 forbids the import in the direction that
would have helped. So the *reader* moved instead — `Hud.describe` became
`describeShutter` in `app/projection/hud.ts`, where the composition root may
read `script/`'s one table and the walker together — and pulling that one
sentence out emptied three more things behind it. `Hud.enabled` existed only
to make `describe` say `"off"`, React having taken `.hud-layer`'s `hidden`
from `toggles.hud` in step 26, so `enabled` and `setEnabled` went; with those
gone `applyToggle`'s `case "hud"` had nothing to do, because the toggle
already reaches both its readers through `p.toggles`; and with that case empty
nothing in `commands.ts` named `hudLayer` any more, so it left `PlayerCommands`
and the declared write surface got one member shorter. The case itself stays,
as a documented no-op, because the switch is exhaustive over `ToggleName` and
a missing case and a deliberately empty one must not look alike.

Two of the five admitted an assertion and got one. `test:projection` asserts
all nine of the strip's shutter labels against `SHUTTER_LABEL` itself, so the
table that was copied is now the table that is checked, and `test:state`
asserts the same row against a real mid-close `Walker`. `test:ui` cannot see a
React key — keys are not rendered — so the feed's is read out of `Feed.tsx`'s
source beside a markup check that every row in the projection reaches the
page.

**What was deferred, and why it is worth naming.** A screenshot harness —
headless Chromium against `?freeze=1`, driving the page through a declared
`?harness=1` seam that can only do what a `UiCommand` can do — would have
shown the seven orphaned rules instantly, and is the only kind of check that
sees them. It is deferred rather than rejected. Two things decided its shape
before its schedule: `tests/README.md`'s policy that no game asset is ever
committed, together with the ruling in `.gitignore` that **a screenshot of a
stage is derived game art**, rules out golden images and pixel regression
outright and leaves screenshots as local, uncommitted evidence; and the
harness needs a bundle, so it needs the install, so it is a developer tool and
not a CI gate. `.gitignore` has reserved `web/playwright-report/`,
`web/test-results/` and `web/test/visual/screenshots/` since long before this
review, which is a fair measure of how long the idea has been waiting.

### What the snapshot oracle found on its first run

Two bugs, both of the shape step 14 was written to catch: state that decides
the next frame and is not in the snapshot. Neither is visible to any harness
that only plays forward, which is why both had survived every other check
here.

**The wait was not saved.** `Walker.loadState` dropped `this.wait` on purpose,
on the reasoning that it is *"mid-instruction bookkeeping that the next tick
rebuilds"*. The next tick does rebuild it — as a **fresh** wait. `WaitPolicy`
carries `framesLeft`, so a save taken three seconds into a five-second
`wait_frames` came back as a full five-second one, and re-emitted the wait's
feed row on the way past. Every timed gate in a restored save started again
from the top. The wait is state and is now in the slice; the **branch** is
still dropped, and that one is a real decision rather than an oversight — a
prompt is not a state, and a restored one with nothing driving its countdown
parks the script for good.

**A seek did not clear the data segment.** `Player.seekTo` recycled the
session, reset the prop placers and replayed the script — and left the whole of
`G` exactly as the run before it had left it. The actor pool, the enemy ring
tables, `g_frame`, and the one that bites: `g_coli_full_set`, which a
`collision` op sets and no op ever clears. Seeking **backwards** past one
arrived with the future's collision world still loaded, so the walls an actor
tested against were the walls of a room the script had not reached yet.

That is the same claim step 8 made and only half kept: a seek and a load are
the same rebuild. A load restores the segment wholesale, so it was fine; a
seek has to clear it and let the replay write it again. One line, next to the
`ResetPropContainers` that was already there for the same reason.

The oracle is stricter than `test:seek` because it compares **two histories**,
not two replays. Its second group builds a world, plays 1500 frames down a
different path, and only then loads the snapshot or seeks to the address — so
anything that survived because nobody reset it is present in one world and
absent from the other, and the futures part company. Both bugs above were
found by that pass and neither by the first.

One thing it deliberately does not assert: `hud/` is not in the `World`, so
the shutter's slide phase and the caption countdown are outside every
assertion. Step 19 puts them on `Walker`, and assertion C covers them the
moment it does.

### What step 19 found in the binary

Two of the plan's own assumptions were wrong, and the decompile is what said
so.

**The slide counter is not a global.** `HudDrawShutterState` (`FUN_00413970`)
keeps it at `+0x50` on its own draw task, so there was nothing to name in
`globals.tsv` beside the two states — `g_bHudShutterState` (`0x009CA0F4`) and
`g_bHudShutterPrev` (`0x009C8E9C`), the second being both the change detector
that seeds the counter and the thing state 7 restores.

**And it is the same counter as `gateCloseLeft`.** The exe has one field doing
both jobs: state 1 counts it up to `0x28` and hands over to state 2, state 3
counts it down to 0, draws the closed bars, hands over to state 4 and drops
`g_nFiringGate` on the way. The port had two copies — `Walker.gateCloseLeft`,
which was in the snapshot, and `Hud.counter`, which was not — and they could
disagree, because a seek reset one and restored the other. They are one field
now, and the firing gate reads it.

That is the same shape as everything else this review found: a fact with two
owners. The fix is not a synchronisation, it is deleting one of them.

### Why step 20 was a step and not a tidy-up

`## The UI layer` used to open *"The UI is ~1900 lines of imperative DOM …
wired with 67 `addEventListener` calls"*, in the present tense, and close with
a tree whose last line was `hud/ bgm.ts — audio, not UI` for a file that had
moved to `audio/`. It was written as a proposal, step 11 built most of it, and
nobody went back. A document that describes a layout the tree no longer has is
worse than no document, which is the same rule this file already states about
restructuring — so making it true again is a step with a checklist, not a
tidy-up to be done when convenient.

It is also where the rules came from. Seven findings, seven costumes, one
mistake: a fact with two owners. That is only visible once they are written
down together.

### The linting question, and what was built

Partly, and not by adopting ESLint.

Rules 1 and 6 are file-level and `verify_layers.py` measures them — it has
read `.tsx` since step 13. Rule 2 is a runtime property and
`test/state.test.ts` and `test/projection.test.ts` prove it better than any
static check could. Rule 3 is enforced by TypeScript: the union is closed and
the switch is exhaustive, so a command with no case fails to compile. **The
strongest rule in this layer is a type, not a linter**, and that is worth
saying before adding tooling.

Two rules genuinely need an AST, and both fail **quietly** — the page still
renders, the app still works, it just costs more for ever:

* **every exported component in `ui/panels/` is wrapped in `memo`**, which is
  what spends the reference stability rule 4 buys;
* **`store.demand(…)` is called from inside a `useEffect` and nowhere else**,
  because during render strict mode takes the claim twice and releases it
  once, and `app/` then builds an expensive slice for a panel nobody has open.

Neither is worth eight new dependencies and a config file. **ESLint is the
wrong size for this repo**, and it would cost something real: `verify_layers.py`'s
two severities and its ratchet baselines have no ESLint equivalent, and the
ratchet is the mechanism that let steps 8-12 land at all.

So: **`web/tools/verify_ui.mjs`** (`npm run verify:ui`), walking
`ts.createSourceFile` from the `typescript` already in `devDependencies` — no
new package — and reporting in `verify_layers.py`'s two-severity format.

Its two exemptions are principled rather than a list of names, which is what
keeps it from becoming a suppression file: a component with **no props** never
re-renders from props, so `memo` would compare nothing, and a component taking
**`children`** is handed fresh elements by its caller every render, so the
shallow compare could never bail. `Panel` and `Resizer` are exempt today for
those reasons and stop being exempt the moment either grows real props.

Worth resisting: a rule for anything the type system, the layer checker or a
runtime test already holds. Three overlapping mechanisms for one property is
how a rule ends up satisfied in the checker rather than in the code — which
this document has already caught happening once, with `layers-are-systems`
going green because it had nothing left to look at. That warning is in the
file's own header.

### Proving a step did not change behaviour

Before starting, capture the baseline — the headless harnesses are the oracle:

```sh
cd web
for t in replay cadence civilians throwers wall corpses coli_walls; do
  node --experimental-strip-types --no-warnings tools/run_test.mjs \
      tools/$t.mjs > /tmp/base.$t.txt
done
npm run test:port && npm run test:seek && npm run test:scope
```

Everything goes through `tools/run_test.mjs`, which bundles with esbuild first.
Running a harness with node's bare `--experimental-strip-types` fails on the
first `enum` it meets and tells you so in a way that looks like a real failure.

`coli_walls` **fails at HEAD**, and has since before this work: it reports 51
class-0x31 spawns where the Python reference says 49. Capture it anyway — the
test is that the output does not change, not that it passes.

After the step, every one of those must be **byte-identical**, and
`verify_layers.py`, `verify_port.py`, `verify_player_ops.py`,
`verify_player_dom.py`, `verify_objects.py` and `npm run verify:ui` must still
pass. A step is not done until that holds.

`npm run test:projection` is on it from step 18. It guards a property nothing
else can see: `tsc` cannot, because the types are the same either way, and
`test:ui` cannot, because the markup is. The only symptom of losing it is that
the player gets slower sixty times a second, and nobody attributes that to the
field added six weeks earlier without a stable reference behind it.

`npm run test:ui` is on that list from step 16 — the only check that the page
has the shape the stylesheet expects, which neither `tsc` nor `vite build` can
see. It caught nothing on the way in because the bug it exists for was found by
reading first: moving the sidebar out of its portal dropped the
`<aside id="right">` that `#stagearea`'s four-column grid places by source
order, and the symptom would have been a blank right-hand column.

`npm run test:state` is on that list from step 14 — and it is the stricter
oracle, because the harnesses above only prove that *playing forward* did not
change. Steps 15-18 are UI-only and must not move a byte of any of them; step
19 is the one that legitimately changes an output, and assertion C is what says
it changed in the right direction.

Note that step 14 itself **did** move two of these outputs, and correctly: a
restored save no longer restarts its wait, and a backwards seek no longer
carries the future's collision set. Those are the bugs the oracle was written
to find. "Byte-identical" is the rule for a refactor, not for a fix — what a
fix owes instead is the failing assertion that named it.


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
