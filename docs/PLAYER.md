# The browser player

`web/` is a browser client that loads a stage of The House of the Dead 2 and
plays it: the game's own event script walks its route graph, streams its
regions and plays its camera paths, and the gameplay — every enemy's state
machine, damage and gore, scoring, the shot test, the camera director, the
HUD — is a **transcription of the exe**, one TypeScript function per exe
function under the name Ghidra gives it.

This document is the player's shape: the layers, the rules that keep it one
shape, the checks that make the rules real, the bundle it loads, netplay and
hosting. How to run it and play it is in the [README](../README.md). Every
count — lines, coverage, divergences, ratchets — is in
`npm run status`, which measures it from the tree; nothing here quotes one.

**If a rule here cannot be satisfied by the work in front of you, that is a
finding, not an obstacle.** Say so, name the refactor that would satisfy it,
and ask. A violation smuggled in to get a commit out is never acceptable: the
boundaries below are load-bearing.

- [Layers](#layers)
- [Where things are](#where-things-are)
- [The gameplay port](#the-gameplay-port)
- [Saving and restoring the whole game state](#saving-and-restoring-the-whole-game-state)
- [The frame](#the-frame)
- [Input intent](#input-intent)
- [`script/`: the machine and the state it drives](#script-the-machine-and-the-state-it-drives)
- [The UI layer](#the-ui-layer)
- [Scopes: every lifetime has an owner](#scopes-every-lifetime-has-an-owner)
- [The bundle](#the-bundle)
- [Netplay](#netplay)
- [Hosting](#hosting)
- [Checks and harnesses](#checks-and-harnesses)

---

## Layers

```
engine    core/ bundle/ script/ game/ hod2lib/   no three.js, no DOM, no Math.random;
                                                 deterministic, snapshotable, runs headless
render    render/ audio/                         three.js and Web Audio. reads engine state,
                                                 owns nothing
ui        hud/ ui/                               reads one projection, emits commands
app       app/                                   the composition root. sees everything;
                                                 nothing sees it
```

Dependencies point **down and never up**. `app` may import anything; `render`
and `ui` may import `engine`; `engine` imports nothing above itself. `render`
and `ui` may not import each other. `web/tools/repo/layers.ts` holds all of it.

Each boundary earns its place by what it makes possible:

* **engine runs headless.** `npm run test:port` drives the state machines in
  under a second, and every headless harness under `web/tools/` runs the real
  port with no browser.
* **render owns nothing.** A snapshot contains nothing from `render/`; loading
  one calls `resync` and the renderers rebuild. A renderer that cannot rebuild
  itself from engine state is a bug in the split, and the snapshot is the test
  that finds it.
* **ui reads a projection.** Not the walker, not `G`: one plain, serialisable
  value per frame, and typed commands back. That keeps gameplay rules out of
  click handlers. `hud/hud.ts` holds the rule in its strongest form: it has no
  import statement at all.

`hod2lib/` is engine for the same reasons as the rest: a parser that reads the
wall clock cannot be replayed, and one that touches the document cannot run in
the worker the in-page export runs it in. Its bytes arrive through an
interface; `app/install/` and `web/tools/lib/node_io.ts` are the two
implementations.

## Where things are

```
web/src/
  app/          the composition root
    main.ts       `Player`: the systems, the context, the scope tree, the keys
    loop.ts       how much game time a frame owes: one fixed 60 Hz tick
    pacer.ts      whether there is a frame at all: rAF, sleep, waking, hidden tab
    harness.ts    the drive seam: under `?drive=1` a driver feeds the clock
    systems.ts    the adapters (GameSystem, ScriptSystem, the draws) and the
                  places the layers meet: syncCharacterSpawns, seatCamera,
                  reseatCamera, syncPortGlobals
    commands.ts   the one exhaustive switch over `UiCommand`
    projection/   what the UI is told: player, sidebar, script, chrome, hud,
                  message, net, and `stable.ts`
    ring.ts       the rewind history
    stage_load.ts, bundles.ts, walker_host.ts, urlstate.ts, viewprefs.ts,
    profile_store.ts, device.ts (the phone as a gun), perf.ts, offline.ts
    install/      choosing an install, the export worker, OPFS, the zip
    net/          netplay's page half (see Netplay)
  core/         the framework: System and Context, World (tick order, save,
                load, resync), Scope, CameraFrame, Snapshot, the event bus,
                the seeded Rng, the one BAMS constant; net/ is netplay's pure
                half (codec, protocol, hash, bytes)
  bundle/       one module per bundle block, the loader, and the two generated
                digests (`schema_hash.ts`, `builder_hash.ts`)
  script/       walker.ts (the machine), ops/ (the opcodes), waits/ (the wait
                policies), state/ (channels, the shutter's accessors),
                registry.ts, seek.ts (the planner)
  game/         the port
    globals.ts    `G`, the data segment
    actor.ts      the object struct, at its offsets
    registry.ts   the class handler contracts; classes.ts fills the table
    class10/ … class62/   one module per spawn class, each registering itself
    camera/       the camera's two tasks, the action ring, the rail, the slots
    combat/       the shot queue, ResolveHit, permits, counts
    effects/      the effect tasks, recorded for render/ to draw
    director.ts   the scene task walk; spawn.ts, despawn.ts, run_phase.ts,
                  player_shell.ts, hud_shutter.ts, hud_readout.ts, ...
  hod2lib/      the game-format library and the bundle writer
  render/       three.js: the stage, rigs, props, characters, effects, camera,
                shooting, lighting, fog, draw order, free roam, debug overlays
  audio/        bgm.ts (`PlaySoundId`'s dispatch and the mixer), stream.ts
                (what channel 0xF plays, byte for byte)
  hud/          hud.ts: the shutter bars, the caption, the screen sprites
  ui/           React: App.tsx, the store, useSlice, ErrorBoundary, shortcuts,
                panels/
```

## The gameplay port

Gameplay logic is not "informed by" the decomp. It **is** the decomp,
transcribed, readable line for line beside Ghidra, so any divergence is a
thing you can grep for rather than a thing you have to remember. The
operating procedure is the `/gameplay-port` skill; this is the why.

**1. One exe function, one TS function, same name.** The TS function takes the
name from `ghidra/annotations/functions.tsv` verbatim, and its doc comment
carries the address so both directions are searchable:

```ts
/** `ResolveHit` — `FUN_00409430`. Charges one shot against one bone. */
export function ResolveHit(obj: Actor, player: number): void {
```

Nothing is inlined "because it is only three lines". The call graph is part of
what was decompiled.

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

If the exe writes a global, the port writes that global: not an argument
because that would be tidier, not a class field because that would be more
idiomatic. One `G` object rather than a file of `export let` because a `let`
binding cannot be enumerated, and a snapshot of it would be a hand-maintained
list.

**3. Actor fields carry their offsets.** The object is one struct with the
offsets in comments, because the offsets are how you check the port:

```ts
export interface Actor {
  hp: number;             // +0x11C
  attackPermit: number;   // +0x121   -1 when it holds none
  state: number;          // +0x1310
}
```

**3b. Closed sets are enums.** Where the exe enumerates something — a state
table, a class id, a control code, a flag bit — TypeScript gets an `enum`
whose values are the exe's own numbers and whose members are named for what
the exe calls them. A radius, a rate or a frame count stays a named constant.
The rule: **if the exe would switch on it, it is an enum.**

**4. Divergence is declared.** Where the port cannot follow, it says so on the
spot with a greppable tag and its reason:

```ts
// [diverges] CLOSING_SPEED is invented. The velocity source in the class-0x30
// update was not found: no `fstp [reg+0x4c]` in 0x455000..0x459000.
```

The count of them is the honest measure of how finished the port is.

**5. Tables from `.rdata` go in the bundle; immediates from `.text` go in
`game/`.** A number the exporter reads out of the exe — a damage row, the
turn-rate curves, the approach radii — travels in `<stage>.script.json`. A
number the compiler put inside a routine is a named constant in `game/`, with
its citation, and never a `?? 90` fallback beside exported data. An immediate
that is a **join key** into exported data (an asset slot, a motion id the
exporter bakes) stays in the bundle. `docs/formats/bundle.md` has the rule in
full.

### One departure, one tag

The count is only honest if every tag is one departure and every departure is
one tag:

* **The tag goes where the port's code departs** — on the routine or branch
  that does something other than the exe, or, for a departure in
  representation, on the declaration of that field. `web/tools/repo/port.ts` fails a
  tag with no reason.
* **Two routines that depart for one reason are two departures**, each with
  its tag: each is a transcription someone will compare against Ghidra, and
  fixing one does not fix the other (`L64`).
* **Everything else names it in words** — a file header summarising a
  departure its body makes, a cross-reference, a note on a departure since
  fixed — without writing the token (`L41`).

`[open]` follows the same rule: it marks an unanswered question about the
binary, once, where it is asked. Both markers are counted by `npm run status`
in every `.ts`/`.tsx` file under `web/src/`, in comments only.

### The boundary that makes it enforceable

`game/` does not import `three`, touch the DOM, or call `Math.random`, and it
never holds a `Scope`. It reads and writes its own globals and actor structs,
and the renderer observes them. Every gameplay bug this rule set exists to
prevent came from reinterpreting rather than transcribing — a facing inverted
by a vector rewritten in other words, permits deadlocked by an invented state
fall-through, one class's state machine applied to every class, a rank test
moved across a function boundary — and each is impossible when the call graph
and the globals match.

## Saving and restoring the whole game state

`world.save()` returns a plain value that fully determines the next frame, and
`world.load(snap)` makes the running player identical to the moment it was
taken. That is not a feature beside the port: it is the property that proves
the port is written correctly. If state cannot round-trip, some of it is
hiding in a closure or a three.js node, and the next bug is in the part that
is hiding. Six rules make it true:

**1. All mutable port state is in two places:** `G` and the actor list.
Nothing else in `game/` survives a frame — no module-level `let` outside `G`,
no `Map` keyed on object identity, no state in a closure.

**2. State is plain data.** Nothing reachable from `G` or an actor is a
three.js object, a DOM node, a function or a class instance. `game/` has its
own `Vec3` — `{x, y, z}` — so a snapshot is `structuredClone`, not a
serializer with a case for every type.

**3. Randomness is state.** One seeded `Rng` per world, its state word in the
snapshot. `Math.random()` is banned in `game/` (`L10`); `Rng.int(n)` is the
spelling of `rand() % n` (`L46`).

**4. Render state is derived, never saved.** Loading calls `resync(ctx)` on
every system and the renderers rebuild their nodes, poses and visibility from
game state.

**5. Every system declares its own slice** with `save?()` / `load?()`, keyed
by its `id`. The walker's slice is its program counter, flags and channels
(`WALKER_RESTORED_KEYS`); the game's is `G` plus the actors; the HUD's is
nothing.

**6. The snapshot says what it was taken against** — a stage and a version,
both checked on load.

```ts
interface Snapshot {
  version: number;                  // bumped when any slice changes shape
  stage: number;                    // refuses to load into a different stage
  frame: number;                    // 60 Hz ticks since the stage loaded
  rng: number;                      // the world RNG's state word
  parts: Record<string, unknown>;   // system id -> its slice
}
```

What it is used for:

* **Headless regression tests.** Drive the port to a block, snapshot, run, and
  assert on the result.
* **Determinism as an assertion.** Load one snapshot twice, run both, compare.
  `test:state` goes further and plays two different histories to one address,
  which finds state that survived because nothing reset it.
* **Rewind.** `app/ring.ts` keeps a snapshot every 30 ticks, sixty deep —
  thirty seconds of history in a few megabytes. `←` rewinds through
  `World.load` → `resync`, the same path a seek takes.
* **Netplay.** A replica holds the host's state and proves it by hash
  ([Netplay](#netplay)).

## The frame

**One `System` interface and one tick order.** Every layer implements
`attach / update / detach` (and optionally `save / load / resync`), and
`World` ticks them in the engine's order: script → game → render → hud. Adding
a system is one `world.add(...)`. A layer ticked by hand is a layer outside
`save`/`load`/`resync`.

**One clock, one fixed tick, never skipped.** The simulation advances in whole
60 Hz ticks — the walker and the port together, by exactly one. A drawn frame
runs however many ticks the accumulator owes: one on a 60 Hz display, often
none on 144 Hz, several after a stall. The engine's clocks are integers that
step by one (`obj+0x19C`, `g_cam_path_frame`), which is why an exact-frame cue
is safe, and a port that advanced by a fraction of a frame would play a
different game every run (`L12`).

**Owed time is spread, never dropped**, and a debt worth dropping never forms:
a hidden tab stops the loop and `Loop.resume` moves the clock up without
banking the gap; paused or in free roam there is no game time to owe and the
loop sleeps. A sleeping loop must be woken by everything that changes what is
on screen, so the wakers are few chokepoints (`runCommand`, the keys,
`popstate`, loading, a shot, the harness, the tab becoming visible), and
`web/tools/pacing.mjs` proves them on the real page.

**No interpolation between ticks.** It would need the previous and the
current pose in `render/` — a second copy of state above the engine line.

**The drive seam.** `app/harness.ts` and `?drive=1` are the same loop with the
wall replaced by a driver as what feeds the accumulator. Nothing else changes,
which is the point: a harness that stepped the world down a path of its own
would be proving that path.

**One owner per fact.** Anything more than one layer reads goes on the
`Context` — the walker, the camera paths — and `Player` reaches it through a
getter onto `ctx`. A layer that keeps its own copy is a second owner, and the
second owner is the one nobody remembers to assign.

**A typed event bus.** The port raises events where the exe would set a flag;
the HUD, the audio and the feed subscribe. Events are notifications **out** of
the engine — a subscriber plays, draws or logs, and writes no state, because a
snapshot does not contain the queue.

**One module per game class, behind a registry** that mirrors
`g_class_handlers`. A class with no module gets no behaviour (`L83`).

## Input intent

The renderer owns the pointer, the camera a ray is unprojected through and the
skeleton the hit spheres ride, so the input to a gameplay decision arrives on
its side of the seam. It never makes the decision:

* **The renderer answers questions.** `GameHost.pickShot` returns the nearest
  actor-and-bone or prop along a segment for the classes whose shot test the
  port has not taken over; for those it has (`registersForShotTest`), every
  class's update calls `RegisterForShotTest` into `G.g_shot_test_list` where
  the exe does, and `game/combat/shot_test.ts` picks from it, asking the host
  only what a pose knows (`boneSphere`, `viewSpaceOfPoint`). `MergeShotPicks`
  joins the two answers. `boneWorld` and `readySpawns` are the same shape:
  facts only three.js can produce, crossing the seam as plain numbers.
* **The port decides, and writes.** `ProcessShotRequests` dispatches to
  `MarkActorShot` / `BreakablePropTakeShot` / `ResolveHit` and pays through
  `ScoreAddForPlayer`. Nothing in `render/` assigns an actor field.
* **`app/` composes.** A click becomes a segment in `render/shooting.ts`,
  which hands it to `app/main.ts`'s `gunInput`, which calls `QueueShotRequest`
  onto `G.g_shot_requests`. The rule is about **who decides**, not the
  spelling: pushing from the renderer would slip past the checker's regex and
  still be the violation.

**The camera is the exe's own two tasks**, run by `SceneTaskWalk` in the order
the scene's task list builds them `[proved]`: `queue_event` only pushes onto
`G.g_evt_action_ring`; `CameraActorTick` runs the queued action and builds the
view (`G.g_camera_view_to_world`, from the block's angles, with the shake);
`CameraUpdateTick` runs the scene state's hook, which writes the gameplay eye
`g_camera_eye` and steps a stashed rail (`game/camera/rail.ts`). The players
and actors run after both, so they read this frame's view. `render/camera.ts`
places the three.js camera from `G.g_camera_view_to_world` and decides
nothing. The one port-only composition is `reseatCamera` in `app/systems.ts`,
for the places the player moves the script without running the frames that
would have written the block: a seek, a reset, a deep link.

`g_shot_requests` is plain data, so a snapshot carries any pull not yet
drained and a per-frame record of it is an input log. Replaying one headlessly
needs a `pickShot` a run with no renderer can answer — the skeleton's forward
kinematics in `game/` — so that harness is not built; `web/test/port/`
drives the queue with a stubbed `pickShot`.

## `script/`: the machine and the state it drives

| Concern | Where |
|---|---|
| **The VM** — program counter over block/step/op, dispatch, `executeOne`, `advanceStepOrRoute`, `goToBlock`, the branch | `walker.ts` |
| **The opcodes**, each with its `status` (what the script panel shows) | `ops/*.ts`, one module per group, merged by `ops/index.ts` |
| **Resumption** — the wait policies, the enemy gates, the skip request | `waits/*.ts`, one file per policy |
| **Script-driven state** — channel tweens, the shutter's accessors | `state/channels.ts`, `state/shutter.ts` |
| **Seek** — a planner that drives the VM to a target, as a debugger does | `seek.ts` |

The queued events and the camera actions are the engine's and live in `G`
(`game/camera/actions.ts`). The shutter's nine-state machine, its slide and
every write of the firing gate are `HudDrawShutterState`'s, a scene task that
runs after the player tasks and before every actor, in `game/hud_shutter.ts`;
`state/shutter.ts` holds accessors onto its words so the walker's names still
read. The bars it draws are recorded into `G.g_hud_shutter_bars` for `hud/`.

**The tables refuse a duplicate.** `ops/`, `waits/` and the camera actions are
assembled by `script/registry.ts`, which throws at module load if two modules
claim one opcode or one action.

The walker's save slice is one flat list of keys held against the save by
`WALKER_RESTORED_KEYS`; the modules own the logic and the fields stay
accessors onto them. Seek is outside the machine so that a seek defect cannot
break playback.

## The UI layer

React over two seams. `index.html` is a mount point; every element of the
page, the canvas included, is rendered by `ui/App.tsx`.

**One read model.** A `UiProjection` is built once a frame by `app/` and
published to a store. It is plain data — the test is whether `structuredClone`
would round-trip it.

**One command model.** The UI never calls the engine. It dispatches a
`UiCommand`, a closed union, and `app/commands.ts` is the one exhaustive switch
that decides what each means; a command without a case fails to compile.

**One write seam, declared.** `app/projection/player.ts` declares `PlayerView`
(readonly) and `app/commands.ts` declares `PlayerCommands`; `Player`
implements both. What the UI may read and what a click may move are each
written down.

### The page is the game

The rendered frame fills the window, and all chrome is either **over** it or
in a **debug sidebar** closed until asked for:

* **Over the game** (`#overlay`): the `≡` menu (which holds the game while
  open), the speaker, the start and pause screen, the corner button (player
  1's START: **Skip**, **Continue** with the countdown's digit, **Join**), the
  branch bar, the game-over buttons and netplay's badge and cards.
* **In the sidebar** (`#debug`): Play or free roam, pause, skip, kill; then
  three tabs — Inspect (the panels), Script, Feed. A tab that is not showing
  renders nothing.

**Everything that is not the game is off by default.** On a desktop the frame
fills the window at the game's vertical FOV; on a touch screen it is boxed to
4:3 (`pillarbox`), because a phone held sideways would otherwise show far more
than the game's 53 degrees across. Every overlay and debug aid starts off.

**A reload is not a new visit.** Vite reloads the page on every edit, so the
tab keeps the sidebar, its tab and its folds (`ui/persist.ts`), the game's own
profile (`app/profile_store.ts`), the stage and address in the URL, and
whether the game was running (`resumeMark`) — a saved file comes back to the
game running where it was.

**`#overlay` is a sibling of `#viewport`, not a child, and that is the input
rule.** `render/shooting.ts` hears a press on `#viewport` natively, before
React, so a button inside the viewport could not keep its press from also
being a shot. `#overlay` is `pointer-events: none` wherever it is empty.
`test:ui` asserts there is no `<button>` inside `#viewport`. A shot is aimed
through the canvas's rectangle; a press in the bars beside a boxed canvas is a
pull off the screen, the gun's reload.

**Keys have one list.** `app/main.ts` handles the game's keys,
`render/freeroam.ts` flying, and `ui/App.tsx` the page's; `ui/shortcuts.ts`
is the table all three are described by, the `?` dialog is drawn from it, and
`test:ui` holds the table to the handlers' source in both directions.

### How a frame reaches the screen

```
Player.frame                 end of every frame, unconditionally
  buildProjection(...)       app/ assembles the whole value
    stabilise(prev, next)    every unmoved part keeps its old identity
  store.publish(next)        notifies only if `next !== prev`
    useSlice selectors       each re-reads its own field; Object.is decides
      React                  re-renders only the components whose field moved
```

Nothing changed costs nothing; something changed costs only itself. A
selector names a field and never builds a value — `p => ({ a: p.x })` makes
React throw on the first render — so a component wanting three scalars calls
the hook three times.

### The rules

1. **`ui/` reads one projection and emits commands**, with no import from
   `game/`, `script/`, `bundle/` or `core/`, type-only included.
2. **The projection is plain data.**
3. **A command is the UI asking the world to change.** A fold, a filter, a
   panel width is component state (`useState`, remembered by `usePersisted`).
4. **A component subscribes to the slice it reads.**
5. **Cost is demand, and demand is expressed by mounting.** An open panel
   registers a claim on its slice in an effect (never during render, which
   strict mode runs twice); `app/` asks `wants(slice)`.
6. **One writer per pixel.** React renders every element. Where a layer writes
   geometry — the shutter bars, the caption, the crosshair — React renders the
   node and hands it across through `UiHost`. Nothing under `web/src/` calls
   `appendChild` or its siblings.
7. **State the script drives belongs to the script**, not the layer that
   draws it: the caption's countdown is on `Walker`, the shutter's words are in
   `G`, and `hud/` holds nothing.

Two rules need an AST, and `web/tools/verify_ui.mjs` (`npm run verify:ui`)
holds them: `useSlice` selectors return fields, and `store.demand` is called
only inside `useEffect`. The rest is held by `web/tools/repo/layers.ts`, the type
system and the runtime tests; a rule for something another mechanism already
holds is worse than none.

**One region dies instead of the page.** Error boundaries wrap the loading
screen, the game overlay and the sidebar, with a root backstop. A healthy one
renders no element of its own, none encloses the canvas (which `app/` holds
for the session), and recovery is a button — a boundary that cleared itself
would re-render the throwing panel at 60 Hz. `createRoot`'s `onUncaughtError`
covers the rest; both land in the event feed.

## Scopes: every lifetime has an owner

The player owns GPU resources, listeners and audio, and it can switch stage,
seek and restore a snapshot — none of which the game can do. A **scope** is a
named node in a disposal tree: things register with it, and when it dies they
are undone, children first, in reverse order.

> **A scope holds only what is *not* in the snapshot** — exactly the set of
> things `resync` must be able to throw away and rebuild.

So `game/` never gets a scope (the exe's lifetime is a fixed pool and
`ActorDespawn`), and nothing a scope owns can be game state: `World.save()`
puts every slice through `clonePlain`, which a graph of closures cannot
survive.

```
app                          process lifetime
└── stage                    one loadStage; dies on stage switch
    ├── assets               geometry, textures, templates -- survives a seek
    └── session              everything a seek or a snapshot load rebuilds
        ├── actor:<at>       per-actor render state
        ├── effect:<id>      impacts, projectiles, gore parts
        └── region:<n>       streamed slots
```

The `assets` / `session` split is the one that earns its keep: a rig's "how it
got where it is" is session state, and a seek drops it because a seek drops
the scope. `core/scope.ts` has no three.js and no DOM — `child`, `defer`,
`own`, `dispose`, `snapshot`, `walk`. `render/scope3d.ts` binds the scene
graph to it (attach, own resources — de-duplicated, because three.js shares
geometry and materials freely — and clone). React owns every DOM listener and
undoes them on unmount, so there is no DOM helper. **No layer has a
`detach()`**; one that needs a hand-written teardown is missing a helper.

A seek and a load are the same rebuild: `app/` recycles `ctx.session`, then
`World.resync(ctx)` runs over every system. `Scope.snapshot()` describes a
subtree (name, `openedAt` from a monotonic frame counter, owned count,
children), and `test:scope` asserts over ten load/seek cycles that every scope
opened during one stage is disposed by the next and the live registration
count returns to its first value.

## The bundle

The player does not parse `pol/`, `tex/`, `cam/`, `evt/` or `Hod2.exe` while
it plays. `web/src/hod2lib/` parses them once into a **bundle** the page can
`fetch` — parsing is minutes of work per stage, and the bundle is a cache with
a format number on it. The same library runs from the command line and inside
the page. `docs/formats/bundle.md` specifies the contents; `docs/formats/`
specifies everything it reads.

```
extract/player/
  manifest.json                 format, digests, projection, stages
  stage2/
    stage2.glb                  geometry, materials, every texture, rigs, characters
    stage2.cam.json             camera and object paths as Hermite curves, by slot
    stage2.script.json          the resolved event script, route graph, spawns,
                                characters, props, sound, and the exe's tables
  stage2_original/              game mode 1, same shape
```

Camera paths ship as **curves, not baked samples**: the player evaluates at
any frame and highlights the range one `queue_event` covers, which a baked
glTF animation cannot express.

**What the manifest says.** `format` (`BUNDLE_FORMAT` in
`hod2lib/bundle.ts`), and per stage its own `format`, `game_mode`, counts, a
`degraded` list, and the SHA-256 of every source file it consumed — so a
bundle built from a different game build is detectable rather than
mysteriously wrong, the same principle as `manifest.csv`.

**Two digests.** `schema.hash` is a hash of the declarations in
`web/src/bundle/` (generated into `bundle/schema_hash.ts` by
`web/tools/gen/schema_hash.ts`); a bundle that does not match is **refused**,
naming the files that drifted. `builder.hash` is a hash of the exporter's own
code — every `.ts` under `hod2lib/` and every module it imports values from,
comments stripped (`bundle/builder_hash.ts`, by `web/tools/gen/builder_hash.ts`);
a stage that does not match is **stale**: it loads, the `≡` button shows `!`,
and the bundle screen lists what drifted. Regenerate both before you export,
not after (`npm run gen:hashes`, `L33`); `web/tools/repo/exporters.ts` fails
when either is stale.

**No silent losses.** A `catch` in the exporter that gives something up
records it through `degraded.note`, and the count reaches the manifest and the
exporter's exit code (1, with the files still written).

### From the command line

```sh
cd web
npm run export -- --game-dir "/path/to/THE HOUSE OF THE DEAD 2" --all
```

`--all` is stages 1–6; `--stage N` (repeatable) builds one and carries every
other stage already on disk forward in the manifest. Both game modes by
default; `--arcade` or `--original` builds only that one. `--out DIR` writes
elsewhere (default `extract/player`, or `HOTD2_BUNDLE`). An export into the
default directory also deploys the site when `r2site/.deploy.env` exists
(`--no-deploy` skips it). The export prints its decoder warnings at the end
every time, including when there are none.

### Inside the page

With nothing served and no install remembered, the page opens on a welcome
with one button: choose the folder that holds `Hod2.exe`, and it builds all
six stages in both modes in a worker and drops into stage 1 without a reload.
**Rebuild bundle…** in the menu opens the full screen: one stage or all, one
mode, Play, Stop, **Download as .zip** (which unpacks into `extract/player/`)
and **Clear cache**.

* The folder handle is kept in IndexedDB; the bundle and each stage's tile
  thumbnail go in the Origin Private File System, and the manifest is
  rewritten after every stage so a Stop keeps what finished.
* A page holds two bundles: the served one and the one it built. **The one
  built here wins, per stage** — it is the more recent statement about that
  stage and the only one the page can rebuild. A source whose format or schema
  does not match contributes nothing. **Clear cache** hands control back to
  the served bundle.
* A stage neither holds is built on demand when the menu picks it, if an
  install is remembered.
* **Sounds are fetched from the server** (`bgm/`, `se/`, `voice/` beside the
  page), which finds them through the game directory a served manifest names.
  A bundle built only in the browser therefore plays silently unless a server
  supplies the sounds; `web/tools/first_visit.mjs` counts those requests.

`npm run bundle-flow -- --game-dir ...` drives the whole flow in Chrome — the
screen, an export, a stage built on demand, and the second visit out of the
cache. It takes minutes, so it is not in `npm run verify`; run it when you
touch `app/install/`, `app/bundles.ts` or the loader.

## Netplay

Two players over WebRTC. One browser is the **host** and runs the player
exactly as it does alone. The other is a **replica**: it runs the render, HUD
and audio layers over a copy of the host's state and never ticks the script or
the port. Player 2's gun is a second input device whose aim, trigger,
off-screen pull and START cross to the host, which feeds them into player
index 1's slots — slots the exe has for its second port and the port already
reads. **`game/` knows nothing about the network.**

Every tick the host sends every path of its state that changed since the last
tick the replica acknowledged, the events raised in between, and its state's
hash. The replica applies them into its own live `G` and compares hashes, so
every tick is verified, at a cost that follows the size of the change.

### Playing

**`≡` → Two players → Host a two-player game** shows a room code and **Copy
the join link**. Player 2 opens the link (`#join=CODE`) or types the code
under **Join**. Both need the same build of the page and their own bundle for
the stage; no game data crosses the connection. The host's clock is held until
player 2's page answers. Player 2 joins the game with a credit as soon as the
game would take their START (after a skippable cutscene, not during it); after
that the corner button says **Join** whenever the game draws PRESS START for
player 2. A session that drops is over; hosting again makes a new room.

**The badge** beside the speaker shows the role, round trip, loss and whether
traffic is relayed, and turns amber or red when play will suffer or the replica
may not match. Press it or `I` for the overlay: the link (ICE pair, round
trip, loss, time since the last packet, bandwidth), what a tick costs by phase
on each end, player 2's aim checked against the host's record of the camera,
and **Is it the same game?** — hash mismatches, apply errors, the audit's
finds — with **Resync** and **Copy report**. `K` (or `?fps=1`) is the FPS
counter.

| In the address | Does |
|---|---|
| `?net=host` | make a room as the page opens |
| `#join=CODE` | join that room |
| `&matchmaker=local` | the dev server's own matchmaker and TURN relay, instead of the deployed Worker |
| `&matchmaker=URL` | that matchmaker |
| `&netsim=lat:80,jit:20,loss:5` | make this end's outgoing link that bad (ms, ms, percent) |
| `&relay` | force WebRTC through TURN |

### The rules it adds

Each is enforced by the per-tick hash: anything that breaks one shows up as a
mismatch naming the section of the state it was in.

1. **An event subscriber is an output.** The host records every event per tick
   (`Events.tap`) and the replica replays them onto its own bus, so the same
   subscribers run on both ends; one that wrote state would write it twice.
2. **On a replica, nothing writes the state but the codec.** The systems that
   write state are dormant (`World.setDormant`), the script phase is skipped,
   and the gun goes to the host. The role decides this.
3. **A keyframe is adopted, not copied** (`World.load(snap, ctx, { adopt:
   true })`), so every later delta lands on the objects the render layers are
   bound to.
4. **One gun entry point.** `gunInput(player, kind, ray?)` in `app/main.ts` is
   where a press becomes intent in `G`, for this page's gun and for player 2's.
   A shot is the segment player 2's own renderer built through a camera placed
   from the replicated view, so it is exactly what was on their screen.

### The codec and the protocol

**A delta is absolute over its window**: a packet for tick `t` against base
`b` carries, for every path that changed in `(b, t]`, its value **at `t`**, so
it lands correctly on a replica at any tick in `[b, t]`. The host keeps a
shadow of the state, diffs it once a tick in place, and keeps 256 ticks of
change lists. **Pools are keyed by identity** (`at`, and a serial), so an
actor keeps its object on the replica across the sweep that filters the pool,
and a respawn is a new element. Values are lossless (zigzag varints, f64,
`-0`, three distinct empties). **The hash** is a sum of per-leaf hashes, so
both ends keep it as changes land instead of walking for it; the replica also
audits the tree a slice a tick against the shares its ops left, which catches
the page's own systems writing state they should only read.

Two data channels: `ctrl`, ordered and reliable (handshake, loads, keyframes,
reports), and `tick`, unordered with no retransmits, because every packet
carries whatever has not been acknowledged. The handshake checks protocol,
snapshot version, build id and schema digest. Every timeline jump on the host
— a stage load, a seek, a rewind — starts an **epoch**: the host holds its
clock until the replica says `Ready`, then sends a keyframe. No delta spans
more than 90 ticks. Player 2's input packet carries its newest applied tick,
its aim in the exe's pixels, its input mode (the mouse, 6, or a finger's light
gun, `0xD`, which decides the crosshair as the exe's own network game does)
and every unacknowledged press.

```
core/net/     bytes.ts, hash.ts, codec.ts (StateTracker, StateMirror, TreeHasher),
              protocol.ts
app/net/      peer.ts, host.ts, replica.ts, session.ts, player_hooks.ts,
              transport.ts (MemoryLink for tests, SimLink for ?netsim), rtc.ts,
              matchmaker.ts, stats.ts
app/projection/net.ts, ui/panels/Net.tsx
matchmaker/   rooms.ts, node.ts, serve.ts, worker.ts + wrangler.toml, turn.ts
```

### The matchmaker

How two pages find each other: the host `POST`s a room and gets a six-letter
code, a token and TURN credentials; player 2 joins with the code; the host
posts its WebRTC **offer** and player 2 its **answer**, each carrying every
address its browser gathered (no trickle ICE), and the browsers connect
directly or through TURN. The matchmaker holds those two messages and nothing
else; the protocol is at the top of `matchmaker/rooms.ts`.

A page uses `?matchmaker=<url>`, else a build's `VITE_HOTD2_MATCHMAKER`, else
`DEFAULT_MATCHMAKER` in `app/net/matchmaker.ts` — the deployed Cloudflare
Worker, with Cloudflare's TURN as the relay. `?matchmaker=local` uses the dev
server's own at `/net/matchmaker`, which also runs a UDP TURN relay
(`matchmaker/turn.ts`) so two tabs or a LAN phone connect with no internet;
`HOTD2_DEV_TURN=0` turns the relay off. The browser harness uses `local`.

**Deploying the Worker** (one Durable Object per room code, so the host's and
player 2's requests reach the same state): create a TURN key in the Cloudflare
dashboard (Realtime → TURN Server), then

```sh
cd matchmaker
npx wrangler login
npx wrangler deploy
npx wrangler secret put HOTD2_CF_TURN_KEY_ID
npx wrangler secret put HOTD2_CF_TURN_TOKEN
curl -s -X POST https://hotd2-matchmaker.<subdomain>.workers.dev/net/matchmaker/rooms
```

The last line's answer should hold a `turn:` server with credentials; only
`stun:` servers means the key was refused, and `npx wrangler tail` says why.
Point `DEFAULT_MATCHMAKER` at the Worker. A relayed session uses roughly
400–600 MB an hour against the account's monthly TURN allowance.

**Elsewhere:** `npm run matchmaker -- --port 8787 [--turn --turn-ip IP]` is a
standalone Node server (put it behind TLS; its relay is UDP only). A coturn of
your own works with `HOTD2_TURN_URLS` and `HOTD2_TURN_SECRET`.

| Setting | Default | Meaning |
|---|---|---|
| `HOTD2_CF_TURN_KEY_ID`, `HOTD2_CF_TURN_TOKEN` | none | a Cloudflare TURN key and its token (secrets) |
| `HOTD2_TURN_URLS`, `HOTD2_TURN_SECRET` | none | a coturn server of your own |
| `HOTD2_TURN_TTL` | 21600 | seconds a TURN credential lives |
| `HOTD2_STUN` | Cloudflare's and Google's | STUN URLs, comma-separated |
| `HOTD2_DEV_TURN`, `HOTD2_DEV_TURN_PORT` | on, any port | the dev server's relay |

The Node servers read these from the environment, the Worker from `[vars]`
and its secrets (`matchmaker/.dev.vars` and `.cloudflare.env` are gitignored).

## Hosting

A phone cannot build a bundle — no mobile browser can open a folder — so it has
to be served one, with the sounds beside it.

**On the LAN:** `npm run dev -- --host` and open the network address. All of
it works except the flick-to-reload, which needs the motion sensors and so
HTTPS. **Over HTTPS from the dev server:** `npm run https-cert` makes a
certificate authority of this machine's own and a certificate for every
address it has (into `extract/https/`), and prints how to install the CA on a
phone (the dev server hands it out at `/__ca.crt`); then `npm run dev-https`
serves `https://<this machine>:5443`. **Or Tailscale:** `tailscale serve` (never
`funnel`) gives the dev server a real certificate at
`<machine>.<tailnet>.ts.net`, which the dev server accepts as a host.

**As a site on Cloudflare:** `npm run deploy` stages the site and uploads what
changed to an R2 bucket served by a Worker (`r2site/`):

```sh
cd web
npm run deploy                 # stage (tools/site.ts --gzip), upload what changed
npm run deploy -- --dry-run    # stage, and say what would go
npm run deploy -- --no-stage   # upload what extract/site/ already holds
npm run deploy -- --worker     # redeploy the Worker even if unchanged
```

* **Staging** (`npm run site`, into `extract/site/`): the `vite build` (with
  `base: "./"`, so every URL is relative), the bundle, and `bgm/`, `se/`,
  `voice/` from the install **lowercased**, since the exe's tables and the
  install spell names differently and an object key cannot resolve that. It
  refuses a bundle the page would refuse, or a stale stage (`--allow-stale`).
  `npm run site:check` serves the staged site case-sensitively and plays
  stage 1 in Chrome.
* **Uploading** is incremental: an object whose ETag is the file's MD5 is left
  alone, `index.html` goes last, and objects the site no longer has are
  deleted. The Worker is redeployed only when `worker.ts` or `wrangler.toml`
  changed. It serves the bucket at the root, with 304s, ranges and
  stored-gzip files sent as stored.
* **Settings** go in `r2site/.deploy.env` (gitignored): `CLOUDFLARE_ACCOUNT_ID`,
  `R2_BUCKET` (matching `wrangler.toml`), `CLOUDFLARE_API_TOKEN` (Workers
  Scripts: Edit, Workers R2 Storage: Edit). The token doubles as R2's S3
  credentials; `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` override that.
* **What is public: all of it.** The Worker serves the page, the bundle and
  the sounds — derived from a copyrighted install — to anyone with its
  address. That is the owner's decision for this deployment. Nothing
  game-derived is ever committed to this repository or put in `web/public/`.

**Offline.** In a secure context the page registers a service worker
(`web/public/sw.js`). Each load asks the server for the page first; if it
answers within four seconds, every request of that load is revalidated against
the kept copy (a 304 uses it, anything else replaces it), so a re-exported
stage is the new one on the next reload. Only a load the server did not answer
plays from the device, and then wholly from it. `?sw=0` removes the worker and
its caches. `npm run offline-check` holds both promises.

## Checks and harnesses

`npm run verify` (`web/tools/verify_all.ts`) is the canonical list and runs
everything; `npm run verify -- --list` prints it with the sentence saying what
only each check can see, and `npm run status` prints every count the checks
measure. The ones that hold this document's rules:

* **`layers`** (`web/tools/repo/layers.ts`) — the layer direction; three.js, DOM and
  `Math.random` in the engine; engine or actor writes and engine calls from
  `render/`; `ui/` reading anything but the projection; one BAMS constant; no
  DOM insertion; every exported `render/` class with an `update` handed to
  `world.add`. Every rule is an error at zero. Each is worded to measure the
  thing it is about rather than a proxy (`render-drives-the-port` counts
  engine functions *called*, not addresses cited), and a rule that reports
  zero must be seen to be looking at something.
* **`port`** (`web/tools/repo/port.ts`) — every exe citation in `game/` matches
  `functions.tsv` and `globals.tsv` under the same name; coverage of the
  gameplay address ranges; every `[diverges]` has a reason; every
  `game/class<NN>/` has a `SpawnClass` member and a row in
  `docs/formats/spawns.md`; no `three`, `Math.random` or `export let` in the
  port. `uncited-exports` is the repository's one ratchet: every exported
  function in `game/` cites the exe function it ports or declares itself
  `[port-only]`, and the count may only fall.
* **`npm run test:port`** — `web/test/port/`, one file per area run in order
  by `index.ts`, imports `game/` and nothing else and runs the state machines
  against hand-written tables: permits,
  swings and lives, the retreat, the rings, inert classes, hits, severs and
  zones, snapshot round-trips through `structuredClone` and JSON, and two runs
  from one seed agreeing.
* **`test:state`, `test:seek`, `test:scope`, `test:projection`,
  `test:render`, `test:ui`** — the save state, the seek, the scopes, the
  projection's identity, the renderers' rebuild, the page's shape.

**Checks against the installed game** (`game:*`) live in `web/tools/checks/`,
read the game through `web/src/hod2lib/` with the frame in
`web/tools/lib/exe_check.ts`, and hold the port's literals and the exporter's
readings to the exe's own bytes, and the corpus figures the format docs state
to the disc. The `bundle:*` checks there read an exported bundle.
**Repository checks** (`layers`, `port`, `player_dom`, `exporters`,
`ghidra_db`) live in `web/tools/repo/`; the source ones read the TypeScript
through the compiler API. **Browser checks** (`net_pair`, `loops`, `keys`, `continue_page`,
`result_card`, `options_page`, `crosshair_page`, ...) drive the real page in
headless Chrome through `web/tools/lib/player.mjs`, one at a time.

**Headless harnesses** in `web/tools/` drive the real port against a real
bundle with no browser, through `node tools/run_test.mjs tools/<name>.mjs` —
never node's bare `--experimental-strip-types`, which fails on the first
`enum`. Some are in `npm run verify` (`horde`, `dives`, `civilians`, `bats`,
`handback`, ...); the rest are diagnostics kept for the class of bug that
produced them: `replay.mjs` (`npm run replay -- 2 3 1`: one block/step's
spawns through `GameUpdate`), `entrances.mjs`, `lifetime.mjs`, `leaps.mjs`,
`cam_cues.mjs`, and more. `playthrough.mjs` walks a stage from its entry block
to an end block in Chrome and fails on a hang
(`node tools/playthrough.mjs --stage N --headless`, or `--link '<query>'`);
`shot.mjs` takes a screenshot of any deep link into `web/shots/`.

**A refactor is byte-identical.** Capture the headless harnesses' output
before, compare after, and run `npm run verify`. A fix legitimately moves an
output; what it owes instead is the failing assertion that named it. **A green
build is not a working page** (`L15`): `tsc` and `vite build` pass over a page
with a blank column, which is what the browser checks and `shot.mjs` are for.
