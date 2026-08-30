# Browser player: architecture, and the plan to keep it one

The player has grown from a camera-path viewer into a partial reimplementation
of the game's runtime. Combat alone added ~700 lines in one session, and the
decomp has **roughly thirty spawn classes still unread**, each of which is a
self-contained state machine. The current shape will not absorb that.

This is the plan to make it absorb it. It is written to be executed in order,
each step leaving the tree green.

## Where it is now

| File | Lines | What it owns |
|---|---|---|
| `walker.ts` | 1447 | the evt machine **and** all 65 opcode implementations |
| `main.ts` | 1152 | three.js, the loop, every layer, all UI wiring, **and gameplay rules** |
| `characters.ts` | 945 | assembly, posing, blending, damage, gore, death, reactions |
| `enemies.ts` | 768 | slots, permits, ranking, approach, strike, throw, projectiles, camera aim |
| `bundle.ts` | 657 | every JSON type in the bundle, in one flat file |
| 14 others | ~3800 | one concern each — these are fine |

Four specific problems, all of which get worse linearly with the decomp:

1. **`main.ts` is a god object.** 21 imports, and it owns the render loop, the
   layer wiring, the UI, *and* gameplay rules. Lives and score are decremented
   in two hand-written callbacks (`onStrike`, `onThrowHit`) that already
   duplicate each other.
2. **There is no notion of a system.** Every layer has a bespoke `update`
   signature and `main.ts` calls each by hand, applying its own `dt * speed`
   and freeze rules at each call site. Adding a system means editing the loop.
3. **`enemies.ts` is becoming the whole actor runtime.** It is one file for
   class 0x30 and 0x31. There are ~30 more classes.
4. **Callbacks instead of events.** Seven `onX = ...` assignments in `main.ts`.
   Every new interaction adds another and another place to forget to wire it.

## The shape to move to

Mirror the engine, because the engine's own structure is the thing we are
transcribing and it is a good one: a fixed tick, a table of classes, and
ordered draw layers.

```
web/src/
  app/          bootstrap and the loop, nothing else
    main.ts       build the World, wire the UI, run
    loop.ts       the 60 Hz accumulator, freeze and speed — in one place
  core/
    system.ts     interface System { attach(ctx); update(ctx, dt); detach() }
    world.ts      the registry and the tick order
    context.ts    { scene, camera, bundle, walker, events, rng }
    events.ts     a typed bus
  bundle/       one module per exporter block, re-exported by index.ts
  script/
    walker.ts     the machine only (~300 lines)
    ops/          camera.ts flow.ts region.ts sound.ts hud.ts combat.ts
  scene/        stagescene, rigs, props, backdrop, rain, fog, lighting, campath
  actors/
    layer.ts      instances, assembly, placement
    motion.ts     the two-track blender
    damage.ts     ResolveHit, gore, sever, zones
    death.ts      ChooseDeathMotion
    reaction.ts   the stumble
  ai/
    registry.ts   class id -> behaviour, mirroring g_class_handlers
    director.ts   camera slots, attack permits, distance ranking, look-at
    class30.ts    the zombie
    class31.ts    the thrower and its projectiles
    rings.ts      TestApproachRing and the approach tables
  combat/
    shooting.ts   the ray, the score, the crosshair
    player.ts     lives, invulnerability, score — one owner
    effects.ts    impact sprites, blood, the sound tables
  hud/          hud, overlays, ui
```

### The four rules that make it hold

**1. One `System` interface and one tick order.** Every layer implements
`attach / update / detach`, and `World` ticks them in an explicit order that
mirrors the engine's frame:

```
script → actors → ai → camera → effects → hud
```

`app/loop.ts` owns the accumulator, `speed` and `freeze`; systems receive a
already-scaled `dt` and the count of 60 Hz frames advanced. Adding a system
becomes one `world.add(new Thing())` and never touches the loop.

**2. A typed event bus instead of callbacks.** `events.emit("player.damaged",
{ source, lives })`. `combat/player.ts` is the only subscriber that mutates
lives and score; the feed and the HUD subscribe to display. That deletes the
duplicated damage logic that already exists in `main.ts` and means the next
damage source — a boss, a trap, a fall — wires itself.

**3. One file per game class, behind a registry.** `ai/registry.ts` maps a
spawn class to a behaviour module exactly as `g_class_handlers` does. A class
with no module gets no behaviour, which is already the rule that fixed the cat
walking at the player — it just becomes structural instead of an `if`.

**4. Ports, not reach-through.** `EnemyDirector` currently holds a `chars`
reference and a camera matrix pushed in from `main.ts`. Consumers declare the
narrow interface they need (`ActorQuery`, `CameraView`) and `World` supplies
it. The AI then has no three.js dependency and can be exercised headlessly —
which matters, because AI bugs are the ones this session kept shipping.

### What must survive the move

Every module keeps the doc comment naming the binary functions it transcribes.
That commentary is the point of this codebase, not decoration: it is how a
reader knows `1.2` is `ThrownWeaponFlyToTarget`'s speed and not a tuning knob.
A refactor that loses it has cost more than it gained.

## Order of work

Each step compiles and passes `verify_player_ops.py` on its own.

1. **`core/` + `app/loop.ts`.** Introduce `System`/`World`/`Context`/`events`
   and register the existing layers behind thin adapters. No behaviour change,
   no file splits. This is the one that unblocks the rest.
2. **`combat/player.ts`.** Move lives, score and invulnerability out of
   `main.ts` and switch both damage paths to `player.damaged`. Deletes existing
   duplication; smallest change with visible benefit.
3. **`bundle/`.** Split the types by exporter block. Mechanical, and it stops
   the file growing with every new table.
4. **`script/ops/`.** `walker.ts` keeps the machine; each op category
   registers its own entries. `verify_player_ops.py` already checks the opcode
   table against the docs, so this step is guarded.
5. **`actors/`.** Split `characters.ts` five ways. The seams are already there
   — posing, damage, death, reaction are separate concerns sharing an
   `Instance`.
6. **`ai/`.** Split `enemies.ts` and introduce the class registry. Do this last
   of the splits, because it is the one that changes most as the decomp
   continues.
7. **Thin `main.ts`** to bootstrap plus UI wiring, target under 300 lines.

## A check to add

`tools/verify_player_ops.py` already ties opcode status to the implementation.
Add the same idea for classes: enumerate `ai/*.ts`, cross-check against the
class table in `docs/formats/spawns.md`, and report which classes have
behaviour, which are deliberately inert, and which are simply unread. The
doc and the code then cannot drift, which is the failure mode that let 279
non-zombie placements run the zombie's AI.
