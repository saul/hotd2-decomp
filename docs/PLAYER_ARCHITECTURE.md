# Browser player: architecture

The player has grown from a camera-path viewer into a partial reimplementation
of the game's runtime, and the decomp still has roughly thirty spawn classes
unread, each a self-contained state machine. This document is the shape that
absorbs them, the rules that keep it one shape, and the checks that make the
rules real.

This describes what the player **is**. How it came to be is in the commit
history and in `docs/re/session-log.md`, which is where the wrong turns live;
nothing here is kept for the story.

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
ui        ui/ hud/ audio/               reads one projection, emits commands
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
  more importantly, keeps gameplay rules out of click handlers, which is where
  they accumulate unnoticed. `hud/hud.ts` holds the rule in its strongest
  form: it has no import statement at all.

## Where it is now

| Directory | Lines | Files | Layer | What it owns |
|---|---|---|---|---|
| `game/` | 15423 | 80 | engine | **the port.** No three.js, no DOM, no `Math.random` |
| `render/` | 5761 | 23 | render | three.js. Observes engine state, owns nothing |
| `app/` | 3232 | 17 | app | `main.ts` (1123), the loop, the adapters, the projection |
| `script/` | 2883 | 22 | engine | `walker.ts` — the machine; `ops/`, `waits/`, `state/` |
| `ui/` | 2456 | 24 | ui | React: one projection in, one command union out |
| `bundle/` | 1246 | 8 | engine | one module per exporter block |
| `core/` | 724 | 8 | engine | `System`, `World`, `Scope`, `CameraFrame`, `Snapshot` |
| `hud/` | 349 | 1 | ui | the shutter and the caption, drawn |
| `audio/` | 248 | 1 | ui | `bgm.ts` |

32,322 lines. The largest files are `script/walker.ts` (1525), `app/main.ts`
(1123) and `game/actor.ts` (842); `game/class10/index.ts` was one of them and
is now the class's assembly point, with the civilian split across thirteen
modules on the exe's own function boundaries.

### The two open ratchets

Every layer rule in `tools/verify_layers.py` is an **error** at zero except
three, which are ratchets: a count that may fall and may never rise, tied to
the step that clears it. All three are real rather than accounting.

**`render-drives-the-port`, at 12.** The camera shot calls
`CamAdvancePathFrame` and `CamSetPathTarget`; the character layer spawns
actors; the shooting layer takes a shot at a breakable and scores it. Every one
is the *renderer* deciding something the port should decide, because the input
that triggers it — a pointer, a curve evaluation — lives on this side of the
seam. Closing it means the port owning a shot queue rather than the layer that
noticed the click: gameplay work, not a refactor. **Step 21** is where it
happens; assigning that was a decision for this document, never a line edit in
the checker.

It came down from 13 when the character layer stopped calling each class's
`Init`. That call was the one that mattered most, because it was not only in
the wrong layer — it ran at the **wrong time**. `CharacterLayer.build` made an
actor for every placement in the stage's glTF the moment the stage loaded, so
every `Init` in the level had run before the first frame, and
`CharacterLayer.revive` then ran all of them a second time. The engine makes an
object in `SpawnFromDescriptor` (`FUN_00408A20`) when opcode 0x0B/0x0C/0x0D
runs, and once. `CharacterLayer.syncSpawns`, driven from the script phase
beside `SpawnPropContainers`, is that lifetime: the hierarchies are still
adopted at build, but nothing is a game object until the instruction that makes
one has run. What is left of the rule here is `ActorSpawn` and `ActorDespawn`
themselves — the layer still *performs* the spawn, it no longer *decides* it.

**`no-actor-writes-in-render`, at 6.** `render/characters.ts` writes
`inst.a.visible` twice, `inst.a.lookAt` three times, and
`render/characters/gore.ts` writes `inst.a.boneSlot`. All six are the same
shape: the renderer computing something only three.js can compute — a bone's
world position, whether a model has been built — and writing it *straight onto
the actor* instead of handing it across the `GameHost` seam that exists for
exactly this. They are engine writes; `no-engine-writes-in-render` reported
`ok` over them for months because its regex only ever matched `G.…=`, and an
actor field is engine state whichever handle reaches it. `a.visible` is the
sharp one: it gates alive-counting, and the comment at
`render/characters.ts:414` records that folding the view switch into it once
unblocked every wait gate in the game. **Step 21**, with the other one — the
seam has to exist before the writes can go through it.

**`layers-are-systems` is closed.** It was at 1 — `FreeRoam` was never
`world.add`ed — and step 23 cleared it. The argument that it was harmless was
that free roam is mode-gated, so the script is not playing and there is nothing
for a snapshot to be wrong about; that is true of the *game* state and not of
the camera, which free roam owns outright while it is enabled. A layer outside
`World` is not asked to `resync`, so a seek or a load left the camera wherever
the previous state's last frame had put it. It is a render-phase system now,
after `CameraDrawSystem`, and the rule is an **error** at zero.

A ratchet is only meaningful with its baseline written down, so both numbers
stay here even though the reason they are non-zero is current rather than
historical. Lowering one is the point. Raising one is a change to this
document first.

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

`walker.ts` is 1525 lines and the target is "the machine only, ~300". The
opcodes are not the bulk — they are already out, in `ops/`, and it barely
moved. What is in there is four separable things:

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

The UI is React over two seams and no more. `index.html` is a mount point and
a `<div id="app">`; every element of the page is rendered by `ui/App.tsx`, the
canvas included.

**One read model.** A `UiProjection` is built once a frame by `app/` and
published to a store. It is plain data: numbers, strings, booleans and arrays
of them. No three.js objects, no walker reference, no actor references. The
test is whether `structuredClone` would round-trip it — the same test a
snapshot slice has to pass, for the same reason.

**One command model.** The UI never calls the engine. It dispatches a
`UiCommand` — a closed union — and `app/commands.ts` is the one exhaustive
switch that decides what each one means. A command added without a case there
fails to compile.

**One write seam, declared.** `app/projection/player.ts` declares `PlayerView`,
readonly throughout, and `app/commands.ts` declares `PlayerCommands`; `Player`
implements both. So what the UI may *read* and what a click may *move* are each
written down, and neither can grow without a line appearing in the open. The
length of `PlayerCommands` — 46 members against `PlayerView`'s 30 — is a
standing measurement of how much of the player a click can reach.

### How a frame reaches the screen

```
Player.frame                 end of every frame, unconditionally
  buildProjection(...)       app/ assembles the whole value
    share(prev, next)        every unmoved part keeps its old identity
  store.publish(next)        notifies only if `next !== prev`
    useSlice selectors       each re-reads its own field; Object.is decides
      React                  re-renders only the components whose field moved
```

Three properties fall out of that, and each is load-bearing:

**Nothing changed costs nothing.** `publish` compares by identity, so a frame
in which the projection did not move notifies no listener and renders nothing.

**Something changed costs only itself.** `app/projection/stable.ts` is one
recursive `share` pass: it returns the previous object wherever the two are
deeply equal, at every depth, so a selector naming a field returns the object it
returned last frame. Components subscribe individually with `useSlice`, so the
number of React renders per frame is proportional to the number of slices that
actually changed, not to the size of the page.

**A selector names a field and never builds a value.** `p => p?.wait ?? null`
is right; `p => ({ a: p.x, b: p.y })` is wrong, and wrong loudly — React throws
*"The result of getSnapshot should be cached"* on the first render. A component
wanting three scalars calls the hook three times. This is why `UiProjection`'s
scalars stay loose rather than being grouped to suit components.

There is deliberately **no cadence cap**. The projection is rebuilt at 60 Hz
because the panels are then live while the clock is stopped, which is when they
are most useful, and because the diff is microseconds against a 16.6 ms budget.

### The seven rules

**1. `ui/` reads one projection and emits commands.** No import from `game/`,
`script/`, `bundle/` or `core/`, type-only included. A panel that reads engine
state directly is a second reader with its own idea of *when* to look, which is
how a sidebar comes to disagree with the boxes drawn round the actors it lists.
`ui-reads-projection-only` and `layer-direction` are the checks, over `.ts` and
`.tsx` alike.

**2. The projection is plain data.** If `structuredClone` would not round-trip
it, it does not belong.

**3. A command is the UI asking the *world* to change.** Anything that changes
nothing outside `ui/` — a fold, a filter, a scroll position, a panel width — is
component state, kept in `useState` and remembered by `usePersisted`. It is not
a command, it is not in the projection, and it does not reach `app/`.

**4. A component subscribes to the slice it reads.** Reference stability makes
the selector safe; the subscription is the diff. `memo` survives only where a
component is handed props by a parent mapping a list — `Block` in the script
tree, `Lines` in the sidebar — which is exactly where depth-wise sharing lets
it bail.

**5. Cost is demand, and demand is expressed by mounting.** An open panel
registers a claim on the slice it shows; `app/` asks `wants(slice)` and never
asks the DOM anything. "Is this panel open" and "is this component mounted" are
one fact. The claim is taken in an effect and never during render: strict mode
double-invokes a render, so a claim taken there is taken twice and released
once, and the slice is then built for ever for a panel nobody has open.

**6. One writer per pixel.** React renders every element on the page. Where a
layer needs to write geometry — the shutter's bar heights, the caption's text,
the crosshair's position — React renders the node and hands it across through
`UiHost`, and the layer writes only the properties the handover names.
`no-dom-insertion` is an error at zero: nothing under `web/src/` calls
`appendChild` or its siblings. A component reaching for a node **it rendered
itself** is a different matter and is allowed where React's model is the wrong
tool — the script tree's highlight and the minimap's canvas both do it.

**7. State the script drives belongs to the script**, not to the layer that
draws it. The shutter's state and slide counter and the caption's countdown all
live on `Walker` and go in the snapshot; `hud/` reads them every tick and holds
nothing.

### One region dies instead of the page

`publishUi` runs inside the `requestAnimationFrame` callback, which has already
re-scheduled itself. Without a boundary, a panel that throws on one bad value
takes the whole tree with it and repeats sixty times a second.

Six `ErrorBoundary`s: the top bar, the script tree, the viewport overlays, the
sidebar, the transport, and a root backstop. Three constraints on them:

* **A healthy boundary renders no element of its own.** `#stagearea` places its
  four columns by source order, so a wrapper `<div>` would move the column it
  was meant to protect.
* **None may enclose the canvas.** `app/` holds the canvas and `#viewport` for
  the life of the session through `onHost`; a boundary able to unmount one
  would leave WebGL drawing into a detached node, which looks like a graphics
  bug and is not. The viewport's boundary sits *inside* `#viewport`, after the
  canvas.
* **Recovery is a button.** A boundary that cleared itself on the next
  projection would re-render the throwing panel at 60 Hz. The caught value is
  boxed rather than compared against null, so `throw null` cannot reach the
  same loop from the other side.

`createRoot`'s `onUncaughtError` covers what no boundary caught; a boundary
that catches reports through its own `componentDidCatch`, under the name of the
region that died, and both land in the event feed.

## The tree

What is on disk. Where a line is still a plan it says so.

```
web/src/
  app/          the composition root: the only layer that sees all the others
    main.ts       `Player` — 1123 lines. See "why main.ts is this size" below
    loop.ts       the pacer: one fixed 60 Hz tick, never skipped, the
                  catch-up spread rather than dropped. freeze and speed too
    harness.ts    the drive seam: under `?drive=1` the accumulator is fed by
                  a driver instead of by the wall, and nothing else changes.
                  Inert without the flag; may do nothing a `UiCommand` cannot
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
                  one module per class. Each calls `registerClass` itself
    registry.ts   the handler contracts and an empty table. Imports no class
    classes.ts    the manifest: the side-effect imports that fill the table
    despawn.ts    `ActorDespawn`, and the sweep that asks the class what it holds
    globals.ts    `G`, the data segment      actor.ts   the struct at its offsets
    camera/ combat/ effects/                 coli.ts, motion.ts, tables.ts, ...
  bundle/       one module per exporter block, re-exported by index.ts
  script/
    walker.ts     the machine, and the script's own state
    ops/          the opcodes, one module per group
    waits/        one module per wait policy
    state/        channels, scene, queued events, camera action
    seek.ts       the planner
    (`vm.ts` is not split out yet: the machine shares a file with the state)
  render/       three.js. Reads engine state, owns nothing.
    context.ts    RenderContext, which adds { scene, camera, paths }
    camera.ts     the shot, the take and the draw — three systems, in order
    stagescene, rigs, props, backdrop, rain, fog, lighting, campath,
    characters, shooting, breakables, projectiles, overlays, debug
    scope3d.ts    attachTo / ownGeometry / ownMaterial / clone
  ui/           React. One projection in, one command union out.
    App.tsx       the page, canvas included; App provides, Page renders
    store.ts      UiStore: publish, subscribe, dispatch, demand
    store_context.ts  useStore / useDispatch — the store by position, not prop
    useSlice.ts   one subscription per slice; a selector names a field
    ErrorBoundary.tsx  one region dies instead of the page
    projection.ts what the UI is allowed to know
    commands.ts   what the UI is allowed to ask for
    persist.ts    usePersisted — folds and widths, and nothing else
    panels/       one file per panel, each subscribing to what it reads;
                  Viewport.tsx renders the canvas, hud nodes and crosshair
  hud/          hud.ts — the shutter and the caption, drawn. Holds no state
                and imports nothing; React renders its nodes and hands them
                over through `UiHost`
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

**1a. One clock, one fixed tick, and it is never skipped.** The simulation
advances in whole 60 Hz ticks — the walker and the port together, by exactly
one — and a **frame** is something else: one `requestAnimationFrame`, one
drawing of the scene. A drawn frame runs however many whole ticks the
accumulator owes. Usually one on a 60 Hz display, usually none on 144 Hz,
several after a stall.

This is what the engine does. `obj+0x19C` counts up one per game frame and
both camera drivers end on `g_cam_path_frame = __ftol(...)`, an integer that
steps by one, which is why an exact-frame cue is safe there. It is why a port
that advanced by a *fraction* of a frame was not running the same game — and
that is what it did: `Player.gameTick` handed `game/` `frames: wall * 60`
taken straight off the rAF timestamp, so the same stage on the same seed
played four different ways over five runs (`PLAYER_HANGS.md` item 8).

**Owed time is spread, never dropped.** A burst larger than the per-frame cap
leaves the remainder in the accumulator for the next frame; the cap exists so
that one callback cannot block the tab while it simulates a minute, not to
discard anything. The clamp that used to sit in `wallDelta` —
`Math.min(0.1, ...)` — *was* a discard, and a silent one.

**A debt worth dropping is never allowed to form**, which is what makes the
line above affordable. The clock stops rather than accruing:

* **the tab is hidden** — the loop stops, and `Loop.resume` moves the clock up
  without banking the gap. A backgrounded tab does not simulate its minute in
  one lurch, because it never owed one.
* **paused, or free roam** — there is no game time to owe, and `Player` stops
  asking for frames at all. `Player.rafId` is null and the loop is genuinely
  asleep.

The sleep is the part that can rot. A loop that sleeps must be **woken** by
everything that changes what is on screen, and a missing waker does not throw,
does not fail a type check, and does not fail a headless test — it leaves a
panel showing something that is no longer true. So the wakers are few and all
of them are chokepoints (`runCommand`, the keydown handler, `popstate`,
`setLoading`, `fail`, a shot, the harness, the tab becoming visible), and
`tools/pacing.mjs` proves it on the real page: it counts the page's own rAF
calls by wrapping the browser API before the app boots, and asserts that
playing runs the loop, pausing stops it, and an input wakes it for one frame
without advancing any game time.

**Interpolation between ticks is deliberately not done.** A fast display
redraws the same simulated state more than once. Doing better needs the
previous *and* current pose in `render/` — a second copy of state above the
engine line, which `resync` would then have to rebuild — and at 60 Hz
simulated it buys nothing until the display is faster. It is a visual nicety
and it is not what correctness needed.

`speed` scales what goes **into** the accumulator, never the size of a tick.
Half speed is half as many ticks a second, each still exactly 1/60 s. There is
no such thing as a short tick.

`app/harness.ts` and `?drive=1` are the same loop with the **wall replaced by
a driver** as the thing the accumulator is fed from. Nothing else changes: the
same `stepOneFrame`, the same rAF, the same draw and publish. That is the
point — a harness that stepped the world down a path of its own would be
proving that path, and the player does not have it.

**1b. One owner per fact, and the context is where a shared one lives.**
Anything more than one layer reads goes on the `Context` — the walker, the
camera paths — under the name `app/` already uses for it, and `Player` reaches
it through a getter onto `ctx` so the two cannot drift. A layer that keeps its
own copy is a second owner, and the second owner is the one nobody remembers
to assign: `CameraRig` held a `paths` field that nothing ever set, so both
halves of the camera returned early on every frame and the shot sat at the
world origin for as long as it did.

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

That last row is the argument, and three leaks of the same shape are what it
predicts: `SpawnLayer.labels` is a `Map<string, CanvasTexture>` that `detach`
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

The DOM half of that pair does **not exist**, and its absence is a result
rather than an omission. React owns every listener on the page and undoes them
on unmount without being told to, so a scope-bound `addEventListener` has no
caller: `main.ts` holds two listeners, the keyboard and the back button, and
both live as long as the session does. A helper with no users is a claim about
the design that nothing checks, so there isn't one. `render/scope3d.ts` is the
opposite case and is fully populated — three.js has no unmount, so the scene
graph needs every one of its three.

`ownResources` de-duplicates through three `Set`s before disposing anything,
because three.js shares geometry and materials freely and disposing one that
two meshes point at is how a stage switch empties half the next stage.

The test of whether the helpers are good enough: **no layer has a `detach()`.**
None does. If one ever needs a hand-written teardown, a helper is missing.

That test is worth keeping because writing a teardown by hand is where two
lifetimes get conflated. `BreakableLayer` is the example: its templates are
adopted out of the stage's glTF and belong to `stage`, while its nodes follow
`G.g_breakable_props` and belong to `session`, because a **seek** replaces
them. Clearing both together leaves the node map indexed on props that no
longer exist. A scope per lifetime cannot make that mistake; a `detachAll`
cannot avoid it.

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

`app/` builds it from the root and hands it over, so `ui/` needs no import
from `core/`. It is an ordinary slice of the `UiProjection` and obeys the same
rules as the rest: read-only, plain, and cheap to diff.

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

* **error** — must be zero, and a new one fails immediately. Ten of the twelve
  rules: the layer direction; `three`, DOM and `Math.random` inside the engine;
  `three` in `core/` specifically, because `System` must not be renderer-bound;
  the engine written from `render/` or from `ui/`; `ui/` reading anything but
  the projection; one `BAMS_TO_RAD`; and no DOM insertion anywhere under
  `web/src/`.
* **ratchet** — a violation the architecture has not reached yet. The count is
  recorded here against the step that clears it, and the build fails if it
  **grows**. Two of them; see "The two open ratchets" above.

Several of these rules are worded to measure the thing they are *about* rather
than a proxy for it, and the distinction has bitten. `render-drives-the-port`
counts engine functions **called** from `render/`, not `FUN_00…` strings —
a doc comment citing an address is the evidence `CLAUDE.md` requires, so
counting citations would have meant deleting the evidence trail to reach zero.
`no-dom-insertion` bans `appendChild` and its siblings but explicitly not
`document.createElement`, because two canvases are created as three.js textures
and never enter the document.

There is deliberately **no suppression comment and no per-file opt-out.** The
escape hatch is to fix the layering or to change the plan.

**Lowering a baseline is the point. Raising one is a decision, and it belongs
in this document, not in the checker.** If a piece of work genuinely cannot be
done without adding a violation, that means the refactor it depends on has to
come first — say so and stop, rather than raising the number. Every ratchet
here is a debt, and one of them currently has no named creditor — which is
itself recorded above rather than quietly tolerated.

### `RenderContext` lives in `render/`, not `core/`

Putting it in `core/render_context.ts` would keep three.js in `core/` — the
same violation, relocated. So it is declared in `render/context.ts`, and
`System` is generic over which context a layer takes:

```ts
export interface System<C extends Context = Context> { … }
export class World<C extends Context = Context> { … }
```

There is still exactly **one** context object at run time. `app/` builds it and
names `RenderContext` as its type; a system that declares plain `Context` is
accepted by the same `World`, because a function taking the narrow one takes
the wide one too. The split is entirely about what each layer is *allowed to
see*, which is the only thing a boundary can usefully be.

**A ratchet that reaches zero and can never come back becomes an `error`.**
`one-bams-constant` is the worked example: there is no reason to write that
constant anywhere but `core/bams.ts`, so the rule does not record a count, it
refuses.

### Why `main.ts` is 1123 lines

Because the composition root **is** the largest thing in `app/`, and splitting
it would trade one file for four plus a new seam, with the coupling unchanged.
What is in it is measured, not estimated: the constructor's wiring, the
imports, the frame, and about thirty methods of 15 to 35 lines. Twenty systems
constructed and registered, the context built, the scope tree opened.

Two ratios say more than the line count, and both are what to watch:
`main.ts` holds **two** `addEventListener` calls, neither of them a control —
the keyboard and the browser's back button — and every one of the player's
commands is a case in one exhaustive switch.

The extractions that were worth making are the ones that named a seam rather
than moved lines: `stage_load.ts`, `commands.ts`, `walker_host.ts`,
`projection/{player,hud,chrome,sidebar,globals,script,stable}.ts`, and the two
interfaces `PlayerView` and `PlayerCommands`. A line count is not a design
goal; a declared surface is.

### The rules must keep asking the real question

**A rule that cannot fire is worse than no rule, because the row still reads
`ok`.** A checker measures a proxy for the property it cares about, and the
proxy can stop existing while the property does not.

So a rule is written to ask its real question. `layers-are-systems` asks
whether **an exported class in `render/` with an `update` is one `app/` hands
to `world.add`** — not whether some particular method still exists to be
searched for. `verify_player_dom.py` asks whether the stylesheet and the markup
agree in both directions, which is a question that survives the markup moving
from `index.html` into React; the narrower version it replaced went silently
vacuous when it did, and reported one id.

Two habits follow, and both are cheap:

* When a step clears a ratchet, check the rule still has teeth **before**
  dropping the baseline.
* When a rule reports zero, confirm it is looking at something. Three `error`
  rules once reported zero over 790 lines they had never opened, because they
  globbed `.ts` and the UI is `.tsx`.

### Why there is no ESLint

Most of what this layer promises is held by something stronger than a linter.
The layer boundaries are `verify_layers.py`'s. "The projection is plain data"
is a runtime property, and `test:state` and `test:projection` prove it better
than a static check could. The command union is exhaustive because it is a
closed union in an exhaustive switch — **the strongest rule in this layer is a
type, not a linter**, and that is worth saying before adding tooling.

Two rules need an AST, and both fail **quietly** — the page still renders, it
just costs more for ever. `web/tools/verify_ui.mjs` (`npm run verify:ui`) holds
them, walking `ts.createSourceFile` from the `typescript` already in
`devDependencies`, and reporting in `verify_layers.py`'s two-severity format:

* **`selectors-return-fields`** — a `useSlice` selector is a path into the
  projection, optionally with a literal fallback. Anything that constructs a
  value defeats the reference stability the whole read model is built on.
* **`demand-in-effect`** — `store.demand(…)` is called from inside a
  `useEffect` and nowhere else.

ESLint is the wrong size for this repo: eight dependencies and a config file,
and it has no equivalent of the ratchet baseline, which is the mechanism that
lets a boundary be introduced before it can be satisfied.

**The standing rule for that file is that it must not grow.** A rule for
anything the type system, the layer checker or a runtime test already holds is
worse than no rule: three overlapping mechanisms for one property is how a rule
ends up satisfied in the checker rather than in the code. The best end a rule
can have is deletion — when the design makes its mistake impossible rather than
detectable, as per-slice subscription did to the rule that used to police
`memo`.

## Proving a change did not change behaviour

The headless harnesses are the oracle. Capture the baseline before starting:

```sh
cd web
for h in replay cadence civilians throwers wall corpses coli_walls; do
  node --experimental-strip-types --no-warnings tools/run_test.mjs \
      tools/$h.mjs > /tmp/base.$h.txt
done
```

Everything goes through `tools/run_test.mjs`, which bundles with esbuild first.
Running a harness with node's bare `--experimental-strip-types` fails on the
first `enum` it meets, in a way that looks like a real failure.

`coli_walls` **fails**, and has for a long time: it reports 51 class-0x31
spawns where the Python reference says 49. Capture it anyway — the test is that
the output does not change, not that it passes.

Afterwards every one of those must be **byte-identical**, and the full check
block in `CLAUDE.md` must pass. Each check sees something none of the others
can:

| check | what only it can see |
|---|---|
| `test:port` | the state machines, driven headless against hand-written tables |
| `test:seek` | that a seek reaches the address it was asked for |
| `test:scope` | that lifetimes are given back |
| `test:state` | that a save/load and a seek reach the *same world* as play did |
| `test:projection` | that unchanged slices keep their identity |
| `test:ui` | that the page has the shape the stylesheet expects |
| `verify:ui` | the two rules that need an AST |
| `verify_layers` | the layer boundaries, and the two ratchets |
| `verify_port` | that every citation matches `functions.tsv` |
| `verify_player_dom` | that the stylesheet and the markup agree, both ways |
| `verify_player_ops` | that the op table matches the implementation |

`test:state` is the strictest of them, because the others only prove that
*playing forward* did not change. It plays two different histories to one
address and compares the resulting worlds, which is how it finds state that
survived because nothing reset it.

**"Byte-identical" is the rule for a refactor, not for a fix.** A fix
legitimately moves an output; what it owes instead is the failing assertion
that named it.

**A green build is not a working page.** `tsc` and `vite build` both pass over
a page with a blank column, and have. `test:ui` renders the chrome to a string
and `verify_player_dom` compares the stylesheet against the markup, but neither
loads the page in a browser: interactive behaviour — pointer drags, the demand
effects firing on fold, the error boundaries actually catching — is reasoned
about rather than exercised. A headless-browser harness is the missing check.
It is deferred rather than rejected, and two constraints already decide its
shape: `tests/README.md`'s policy that no game asset is committed, with
`.gitignore`'s ruling that **a screenshot of a stage is derived game art**,
rules out golden images; and it needs a bundle, so it needs the install, so it
is a developer tool and not a CI gate.

## What is left

Two things, and they are different in kind.

**`script/` decomposition.** `script/walker.ts` is 1525 lines holding four
machines in one class — the instruction pump, the opcodes' state, the wait
policies and the seek planner — and `WalkerHost` is 14 methods. The split is
`vm.ts`, `waits/`, `state/`, `seek.ts`, with `WalkerHost` down to about six.
"four machines wearing one class" above is the reasoning.

**The three ratchets.** Steps 21 and 23 below close all three. Closing
`render-drives-the-port` and `no-actor-writes-in-render` means the port owning
a shot queue rather than the layer that noticed the click — gameplay work
rather than a refactor, and a `/gameplay-port` job rather than a restructuring
one.

Everything else here is built. Work that changes the shape of the player
updates this document in the same commit; a plan that describes a layout the
tree no longer has is worse than no plan.

## Order of work

**This is the table `CLAUDE.md` and the `/gameplay-port` skill send you to when
a rule blocks the work in front of you, and the one `verify_layers.py` names in
`step N`.** It went missing in an edit and stayed missing: for a while every
escalation path in the repo pointed at a section that did not exist, and the
checker printed step numbers against nothing. A rule you cannot escalate is a
rule people route around.

The steps are the phases of [`REVIEW-2026-09-03.md`](REVIEW-2026-09-03.md),
numbered as that plan numbers them, so there is one list and not two.
`☐` untouched · `◐` in progress · `☑` done.

| Step | What | State |
|---|---|---|
| 1–7 | **Phase 0 — make the checks tell the truth.** The test skip, the bundle path, `verify_port`'s coverage and duplicate-address rules, `verify_layers`' widened regexes, the two version constants, this table, the install manifest | ◐ |
| 8–14 | **Phase 1 — the gameplay bugs and the leaks.** Integer motion clock, seek reseed, the duplicate `ThrowerLeave`, `stepOnce`, the count latches, the unowned GPU caches, the UI defects | ◐ |
| 15–20 | **Phase 2 — fixtures, golden output, CI.** A bundle-free `mini_stage` so `seek`/`state`/`camera` run everywhere; a determinism test; the export hash suite | ☐ |
| 21 | **`g_shot_requests` + `host.pickShot` + the camera curve into `game/`.** Clears `render-drives-the-port` **and** `no-actor-writes-in-render`, and the shot queue is an input replay log for free | ☐ |
| 22 | Discriminated-union `Actor` tail; the ~25 offset aliases go | ☐ |
| 23 | Self-registering class modules, `ClassFrame` everywhere, `onDeadSweep`, `class10` split. Cleared `layers-are-systems` | ☑ |
| 24 | `script/` decomposition: `state/shutter.ts`, `state/camera_action.ts` as a registry | ☐ |
| 25–27 | Bundle schema hash, `app/pacer.ts`, the snapshot ring and `rewind` | ☐ |
| 28–32 | **Phase 4 — docs that describe the tree.** `README`, a generated `STATUS.md`, `PLAN.md`, `LESSONS.md` | ☐ |

**If a rule here cannot be satisfied by the work in front of you, say so, name
the step above that clears it, and ask whether to do that step first or change
the plan.** Raising a baseline is a change to this document. There is no
suppression comment, on purpose.

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
