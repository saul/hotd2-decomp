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

**2. Globals are globals.** `game/globals.ts` holds real mutable module state
named exactly as `ghidra/annotations/globals.tsv` names it:

```ts
/** `g_enemies_alive` — `0x009C904A`. */
export let g_enemies_alive = 0;
/** `g_attack_permits` — `0x009A2BA0`, one per player. */
export const g_attack_permits: number[] = [0, 0];
```

If the exe writes a global, the port writes that global. No passing it as an
argument because that would be tidier, and no hiding it in a class because
that would be more idiomatic. `TryClaimAttackSlot` sets `g_attack_permits[i]`
and `PlayerTakeDamage` decrements `g_player_lives[p]`, exactly as they do.

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
  globals.ts      every g_* the port touches
  actor.ts        the object struct, offsets in comments
  class30/        approach.ts attack.ts strike.ts backoff.ts death.ts
  class31/        thrower.ts projectile.ts
  combat/         resolve_hit.ts damage.ts score.ts player.ts
  camera/         select_target.ts turn.ts slots.ts
  tables.ts       the exported data, typed
render/         three.js. observes game state, owns nothing.
```

## The shape to move to

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
`main.ts` and means the next damage source wires itself.

**3. One module per game class, behind a registry** that mirrors
`g_class_handlers`. A class with no module gets no behaviour — the rule that
fixed the cat, made structural instead of an `if`.

## Order of work

Each step compiles and passes `verify_player_ops.py` on its own.

1. **`core/` + `app/loop.ts`.** Introduce `System`/`World`/`Context`/`events`
   and register the existing layers behind thin adapters. No behaviour change,
   no file splits. This is the one that unblocks the rest.
2. **`game/globals.ts` + `game/actor.ts`.** Stand up the globals and the actor
   struct, and move `combat/player.ts`'s lives, score and invulnerability onto
   them as `PlayerTakeDamage` (`FUN_00415300`). Smallest slice that proves the
   porting discipline, and it deletes duplication that already exists.
3. **`bundle/`.** Split the types by exporter block. Mechanical, and it stops
   the file growing with every new table.
4. **`script/ops/`.** `walker.ts` keeps the machine; each op category
   registers its own entries. `verify_player_ops.py` already checks the opcode
   table against the docs, so this step is guarded.
5. **`actors/`.** Split `characters.ts` five ways. The seams are already there
   — posing, damage, death, reaction are separate concerns sharing an
   `Instance`.
6. **`game/class30/` and `game/class31/`.** Re-derive `enemies.ts` **against
   the decomp rather than by moving code** — one file per state, named for the
   exe function, calling the real call graph. This is a rewrite, not a split,
   and it is where the four rules earn their keep. Introduce the class
   registry here.
7. **Thin `main.ts`** to bootstrap plus UI wiring, target under 300 lines.

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
