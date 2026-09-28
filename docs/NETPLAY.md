# Two players over WebRTC: plan

**Status: proposal, 2026-09-28. Nothing here is built.** Read
[`PLAYER_ARCHITECTURE.md`](PLAYER_ARCHITECTURE.md) first; this plan is written
against its rules and names the places it has to change.

## The shape

One browser is the **host**, and it runs the player exactly as it does today:
the walker, the port, the renderer, the HUD, the audio. The other is a
**replica**. It runs the render, HUD and audio layers over a copy of the host's
state and **never ticks the script or the port**.

Player 2's gun is a **second input device**. Its aim, its trigger, its
off-screen pull and its START cross to the host, and the host feeds them into
player index 1's slots. The exe already has those slots for its second maple
port, and the port already has them too. The host fires the shot. Nothing on the replica
decides anything.

Every tick, the host sends the replica what changed in the snapshot since the
last tick the replica acknowledged, and the events the port raised in between.

```
 replica (player 2)                                  host (player 1, authoritative)

 pointer, tilt, Enter                                 pointer, tilt, Enter
   │                                                    │
   ▼                                                    ▼
 LocalGun(1) ── input: aim + presses ──(unreliable)──► RemoteGun(1)   LocalGun(0)
                                                            │            │
                                                            ▼            ▼
                                                      applyGunInput(player, …)   app/, the one
                                                        SetPlayerAimFromPointer  place intent
                                                        QueueShotRequest         enters G
                                                        QueueOffscreenPull
                                                        padLatch |= Start1
                                                            │
                                                     stepOneFrame: walker + port + render
                                                            │
 ReplicaSystem ◄── Δ(state) + events ──(unreliable)─── NetHost: world.save(), diff, bus tap
   apply Δ into G and walker, in place
   world.update: render + hud only
   events → bgm, captions, feed

 ◄──────────── control: hello, load, ready, keyframe, pause, leave (reliable) ────────────►
```

**`game/` learns nothing about the network.** It sees a second player's input
arrive in the slots it already reads. Everything below lives in `app/`,
`core/`, `ui/` and one small server.

## What is already there

The architecture's rules were written for snapshots, determinism and headless
testing, and those same rules are what netplay needs. These already exist:

* **The port is two-player already.** Every per-player word has room for two:
  `g_crosshair_x` / `g_crosshair_y` (`+player * 0x130`), `g_aim_on_screen`,
  `g_trigger_down`, `g_input_mode_p2`, `g_gun_trigger_pull` per maple port, and
  `PadStartPressed` (`FUN_00413230`) testing `0x80000` for player 2
  (annotated `[proved]` in `ghidra/annotations/`). In the port, `PadBit.Start1`
  and `PadBit.Continue1`, `QueueShotRequest(player, …)`,
  `SetPlayerAimFromPointer(player, …)`, per-player lives, and the credit line
  drawn in the out player's corner all exist. `PLAYER_PROGRESS.md`: *"Player 2
  can join by the same route, but the page has no second START key yet."*
  Netplay supplies that second key.
* **The state is complete and plain.** `world.save()` returns JSON that fully
  determines the next frame, and `render/` owns nothing it cannot rebuild from
  that (`resync`). The host sends this, and nothing more.
* **Intent enters `G` in one place.** `app/main.ts` wires `Shooting.onFire` to
  `QueueShotRequest`. A remote gun uses that same seam.
* **A tick is a whole, numbered 60 Hz step that is never skipped.** `g_frame`
  is a clock both ends can name, so it works as a sequence number.
* **The accumulator can be fed by something other than the wall.** The drive
  seam (`app/harness.ts`) already shows this. The replica feeds it from a
  buffer of received ticks.

## What is in the way: the refactors

Five changes, in the order they unblock each other. None of them needs a layer
rule relaxed. Rule 1 is already a named item in the architecture's own "What
is left".

### R1. Every tick has two outputs: state, and events

The replica runs no port, so it learns what happened in only two ways: from
state in the snapshot, and from events on the bus. Today the engine also has
a third way out, which is direct calls:

* `WalkerHost`'s output devices: `playSound`, `showMessage` (which plays the
  voice), `startCamera`, `onFeed`, and the streaming calls `enterRegion`,
  `loadSlot` and `unloadSlot`. The architecture already says the
  notifications "become events on the bus next".
* `GameHost.setBoneSlot`, the port pushing a gore or hand swap into the
  character layer.
* The event handlers in `app/main.ts` that **write state**. `playDialogue`
  sets `walker.captionGroup` and `captionFrames` inside a `civilian.dialogue`
  handler. This already breaks the bus's own rule ("no system may put state
  there"). On a replica that replays events it would write the caption twice,
  in an order that depends on packet timing.

The rule this sets, and the one to add to the architecture: **an event
subscriber is an output. It plays, draws or logs, and it writes no state.** A
state write in a handler moves to where the event is raised. The walker's
output calls become events. Streaming stays walker state (`region` and
`loadedSlots` are already in its slice) and is re-announced only when it
changes.

`Events` gets one addition: `tap(fn)`, which sees every `emit`. The host
records each tick's events through it, and the replica injects the recorded
events into its own bus, where the same subscribers in `app/main.ts` play the
same sounds.

### R2. Render layers have to look, not wait to be called

A layer that changes only when the port **calls** it never changes on a
replica. The known cases:

* **`CharacterLayer`.** Adoption happens through `syncSpawns` (after
  `SpawnScriptedCharacters`), and gore and hand swaps through
  `setBoneSlot`. `bindToPool` already reconciles the layer against the pool,
  including every `boneSlot`, but it runs only on `resync`. On a replica,
  `CharacterBindSystem` binds every applied tick, and `update` reconciles
  `boneSlot` the way it already reconciles `removed` (`inst.hidden !==
  a.removed.length`).
* **`StageScene` streaming.** `Walker.loadState` re-announces the region and
  every slot. It has to announce them only when they change, or the replica
  refreshes region visibility sixty times a second.
* **`Walker.loadState`'s other side effects.** `onBranch(null)` and
  `startCamera(cam)` run on every call. Split it into *restore* and *announce*.

Reading the code found these. The rest are `[open]`, and a test finds them
rather than a read: **applying ticks one at a time must leave the scene graph
exactly as `load` + `resync` would** (see "Verification"). `resync` is already
the oracle for "rebuilds from state". This test checks that the per-tick path
agrees with it.

### R3. `Player` gets a role

`Player` (`app/main.ts`) is currently the simulation driver and the presenter
in one class. The role becomes a construction-time choice:

| role | the tick (`stepOneFrame`) | systems registered |
|---|---|---|
| `solo` | walker + `world.update` (today) | all |
| `host` | as `solo`, then `NetHost.afterTick` | all |
| `replica` | take the next buffered tick, apply it, `world.update` | `ReplicaSystem` at the head of `game`; no `GameSystem.update`, no walker tick, no ring |

`Loop` and `Pacer` do not change. `stepOneFrame` is already "the one unit of
simulated work". On a replica, that unit is applying one tick instead of
running one. The pacer gets one new waker, *a tick packet arrived*, which its
own rule requires: everything that changes what is on screen has to wake it.

**Commands.** `PlayerCommands` is the declared write surface, and it is
exactly the right thing to switch on. On a replica, `runCommand` forwards
`pressStart` (as player 2's START) and a pause request to the host. It refuses
`setStage`, `seek`, `killAll`, `restart` and `rewind`, and the projection
carries `net.role` so the UI hides them rather than letting them fail. On a
replica, the snapshot ring, `syncUrlToWalker` and `resumeMark` are off, because
the timeline belongs to the host.

**The branch prompt is not state.** `Walker.loadState` drops it on purpose,
because "it is a prompt rather than a state". The host picks the route, and
the prompt crosses as a control message so the replica can show that a route
is being chosen.

### R4. Guns are devices, and a device has a player

Player 1 is hard-coded as `0` in five places in `app/main.ts`:

* `QueueShotRequest(0, ray)` in `onFire`
* `QueueOffscreenPull(0)`
* `SetPlayerAimFromPointer(0, …)` in `onAim`
* `PadBit.Start0` in `pressStart`
* `padLatch |= 2` on the game-over screen

These become one `applyGunInput(player, input)`. Two kinds of device call it:
`LocalGun`, which is the pointer, the tilt, the second finger and Enter, and
`RemoteGun`, which is the network. The host has `LocalGun(0)` and
`RemoteGun(1)`. The replica has `LocalGun(1)`, which sends to the host instead
of calling `applyGunInput` itself.

This is the exe's own shape (`[likely]`, from the annotations rather than a
read of the routine). `InputMapDevicesToMaple` (`FUN_0041E530`) maps each
player's input mode onto an emulated maple device, and everything downstream
reads per port. The network is simply what is plugged into port 2.

### R5. `BuildShotRay` moves into the port

The host has to turn player 2's aim into a segment. Today the renderer builds
a local shot with `Raycaster.setFromCamera`, which gives the same ray the exe
would but needs a three.js camera and the *current* one. `BuildShotRay`
(`FUN_00406110`) is an exe function: it unprojects the crosshair at
`g_projection_distance_px` and transforms it by the camera matrix. Transcribed
into `game/combat/`, it takes pixels and a view matrix, and it gives the host
three things:

* **Aim in the exe's own units.** Pixels from the frame's centre, `+y` up, the
  units `onAim` already produces. They do not depend on the aspect ratio, so a
  phone in portrait and a wide monitor send the same numbers for the same
  target.
* **A ray from any tick's camera**, which is what makes the lag compensation
  below possible.
* **One ray builder for both players.** Local shots move onto it in a separate
  commit, with the harness outputs compared. A refactor has to produce
  byte-identical output. If the last bits differ, that tells us which of the
  two builders matches the exe.

## Transport, and getting through NAT

### Signaling

WebRTC needs a rendezvous point to exchange offers, answers and ICE
candidates. The site is static (S3 behind CloudFront, `HOSTING.md`), so that
point has to be a small service of its own:

* **A WebSocket room server.** A room code maps to two sockets. It relays
  `offer`, `answer` and `candidate` (trickle ICE), mints short-lived TURN
  credentials, and stores nothing else. **It stays connected for the whole
  session**, because an ICE restart renegotiates through it.
* **Recommended: a Cloudflare Worker with one Durable Object per room.** You
  get WebSockets with hibernation, no server to patch, and about 150 lines.
  The AWS-only alternative, API Gateway WebSocket plus Lambda plus DynamoDB,
  is three services for the same thing. Either way it is `tools/signal/`,
  deployed separately from the site.
* **In development, a Vite plugin** serves the same protocol at `/net/signal`
  on the dev server. Two tabs, or a laptop and a phone on the LAN, then need
  no cloud, and the harnesses use it.

Room codes are six characters from an alphabet without look-alikes, one room
per host, and expire when the host leaves. A join link is
`…/#join=CODE`. It goes in the fragment so it never reaches CloudFront's logs,
and a replica that reloads (Vite reloads the page on every edit) rejoins from
it.

### ICE: STUN for most connections, TURN for the rest

```ts
new RTCPeerConnection({
  iceServers: [
    { urls: "stun:stun.cloudflare.com:3478" },
    { urls: ["turn:turn.example:3478?transport=udp",
             "turn:turn.example:3478?transport=tcp",
             "turns:turn.example:443?transport=tcp"],
      username, credential },            // minted by the room server
  ],
  iceTransportPolicy: relayOnly ? "relay" : "all",
});
```

* **STUN** finds each peer's public mapping. Two home routers with ordinary
  NAT connect directly this way.
* **TURN is not optional for this player.** It is built to be played on a phone
  (`app/device.ts`, `HOSTING.md`). A phone on cellular sits behind
  carrier-grade NAT, which often uses endpoint-dependent mapping, and there
  hole-punching fails and only a relay works. TURN over **TLS on 443** also
  covers the networks that block UDP outright: offices, hotels, some
  campuses.
* **Credentials.** Use the TURN REST scheme that coturn implements
  (`use-auth-secret`): the username is `<expiry>:<room>` and the password is
  `base64(HMAC-SHA1(secret, username))`, minted by the room server with the
  session's lifetime. No long-lived secret ever reaches the page.
* **Provider.** Either self-host coturn on a small VM, or use a managed TURN
  service (Cloudflare's, Twilio's, Metered's). Relayed traffic is the state
  stream (see "Bandwidth"), so the bill is per relayed session-hour. **This is
  the one decision here that is yours rather than the code's.**
* **`?relay=1` forces `iceTransportPolicy: "relay"`.** A TURN server that
  nobody's connection happens to need is a path that fails silently the day
  somebody does need it. This flag makes that path testable at will.
* **Network changes.** On `iceconnectionstatechange` to `disconnected` for more
  than two seconds, or to `failed`, call `pc.restartIce()` and renegotiate
  through the room server. A phone that walks out of Wi-Fi range then
  continues on cellular instead of dropping.
* **What connected.** `getStats()` reports the selected candidate pair: direct
  (`host`/`srflx`) or `relay`, and `currentRoundTripTime`. The debug sidebar
  shows it. When "it feels laggy" comes up, knowing whether the traffic is
  going through a relay answers half the question.

Data channels are DTLS end to end, through a relay too. The relay carries
ciphertext.

### Channels

Two channels, created with `negotiated: true` and fixed ids, which saves a
round trip:

| id | name | options | carries |
|---|---|---|---|
| 0 | `ctrl` | ordered, reliable | handshake, load and ready, keyframes (chunked to 16 KiB), pause, branch prompt, leave |
| 1 | `tick` | `ordered: false, maxRetransmits: 0` | host→replica: tick packets. replica→host: input packets |

**Unreliable on purpose.** A retransmitted tick arrives after the next one
has already superseded it, and on a reliable channel it holds up everything
behind it. Reliability comes from the protocol instead: every packet carries
everything the other end has not acknowledged yet.

Keep `tick` messages small. Past about 1,100 bytes a message is split into
several SCTP chunks, and with `maxRetransmits: 0` losing any one chunk loses
the whole message, so the loss rate goes up with size. The measured median
delta is about 1 KB and the p95 about 1.5 KB (see "Bandwidth"), so most tick
packets fit in one chunk and nearly all fit in two.

## The protocol

### Handshake and the load barrier

1. **`hello`**, both ways, carries: the protocol version, `SNAPSHOT_VERSION`,
   the build id, the bundle's `BUILDER_HASH`, schema hash and stage identity,
   and whether Original Mode is on. **A mismatch is refused with a sentence**,
   the way `snapshotRefusal` refuses. The replica applies deltas to state whose
   shape comes from its own build, so a different build crashes in a way that
   looks like a render bug.
2. **Each player brings their own bundle.** It comes from the same private
   hosted site or from their own install through the first-visit flow.
   **Game data never crosses the connection**: it is derived from a
   copyrighted install (`site.ts`, `tests/README.md`), and a stage's GLB is
   73 MB anyway. Only state crosses, which is numbers.
3. **`load {stage, original, entry, epoch}`** comes from the host. Both load.
   The replica answers **`ready`**. The host sends a keyframe and only then
   starts its clock. The same barrier runs on every stage advance
   (`advanceScene`) and every restart.
4. **Every discontinuity bumps `epoch`**: a load, a seek, a rewind, a snapshot
   load, a stage advance. The replica drops anything buffered from an older
   epoch, and the host sends a keyframe. This is `ring.ts`'s "one timeline"
   rule applied across the connection.

**Joining.** A replica can connect mid-stage: it loads the host's stage, gets
a keyframe, and is then watching. Player 2 enters play by pressing START with
a credit, which is `PadStartPressed` on `0x80000`, the arcade's own flow. There
is nothing to invent: the credit line is already drawn in player 2's corner
until they do.

**Pausing.** The host's transport is the session's. A replica's pause is a
request. A **hidden host tab pauses the session**, because the pacer stops a
hidden tab's loop, and the port cannot tick without its renderer: `pickShot`
and `boneWorld` are answered by three.js. The replica says the host is away.

**Host debug tools stay enabled** (seek, rewind, free roam, kill). Each one is
a discontinuity, which the epoch already handles. Free roam stops the game
clock, so it pauses the session as well.

### Input: replica to host

Sent once per replica frame on `tick`:

```ts
interface InputPacket {
  seq: number;
  ack: number;        // newest tick the replica has applied
  view: number;       // the tick on screen when this was sent
  aim: { x: number; y: number; on: 0 | 1 };   // exe pixels, latest wins
  presses: Press[];   // every press the host has not acknowledged yet
}
interface Press {
  id: number;                         // increasing per replica
  kind: "pull" | "offscreen" | "start";
  view: number;                       // the tick on screen at the press
  x: number; y: number;               // the aim at the press
}
```

The host applies `aim` through `SetPlayerAimFromPointer(1, …)` on each tick.
That keeps player 2's gun light and reticle live on both screens, and those
are drawn from `G`, so they replicate like everything else. It applies each
press once, on the tick it arrives, and acknowledges the highest id applied in
its next tick packet. Because a press is repeated in every input packet until
it is acknowledged, a trigger pull survives packet loss without waiting for a
retransmission.

### State: host to replica

```ts
interface TickPacket {
  epoch: number;
  tick: number;       // g_frame after this tick
  base: number;       // the replica-acknowledged tick this delta is against
  pressAck: number;
  delta: Uint8Array;  // snapshot(base) -> snapshot(tick)
  events: [tick: number, key: string, payload: unknown][];  // for ticks in (base, tick]
}
```

This is the delta scheme Quake 3 made standard. Each packet is a delta
against the newest tick the replica has acknowledged, so a lost packet costs
nothing: the next packet covers it. The host builds these deltas from a shadow
and per-tick change lists rather than stored snapshots; "Bandwidth" gives the
reason. Events travel the same way: each packet carries every event since
`base`, and the replica dedups them by tick. If the acknowledgement falls more
than 32 ticks behind, the host sends a **keyframe** on `ctrl`. A delta larger
than 16 KiB also goes on `ctrl`.

### The delta encoding

**Generic, with no schema.** A hand-written schema for the snapshot would be a
second description of `G`, and it would rot the first time somebody added a
global, which is the same argument that made `G` one object and not a file of
`export let`s. The encoder walks the two trees and emits changed leaves:

* **Pools are diffed by identity, not index.** The sweep in `GameUpdate`
  *filters* `g_object_list`, so indices shift whenever an actor goes. Diffing
  by index would re-send every actor after the gap. Worse, patching in place,
  which is the next rule, would write one actor's fields onto another actor's
  object, and the character layer holds a reference to that object. Key
  actors by `at`. It is `[likely]` unique among live entries, because
  `ActorByAt` refuses a second. The encoder asserts that, and if it fails,
  sends a keyframe rather than guessing. The same applies to any other pool
  the measurement shows churning.
* **Keys are interned per connection**, like HPACK: a key string is sent once
  and then referred to by index.
* **Values are typed.** Integers are zigzag varints. Non-integers are **f64**.
  Strings are short, and there are booleans and null.
* **Lossless on purpose.** A bit-identical replica can be *checked*: every 60
  ticks the host sends a hash of its snapshot, and the replica compares its
  own. A replication bug then shows up as a line in the feed, where a lossy
  encoding would make it a zombie that looks slightly wrong. f32 is a later
  optimisation, taken only if the bandwidth numbers call for it.

**Apply in place.** The replica patches the live `G`, and the walker through
its restore half (R2), so objects that did not change keep their identity. The
per-tick path cannot afford `World.load`, which replaces everything and then
runs `resync`. That is the right tool for a keyframe and the wrong one for
every tick. Putting the delta into `G` is a job for `app/`, the same way
`GameSystem.load` writing `RestoreGameGlobals` is today.

## Timing on the replica

* **A jitter buffer of ticks**, played out one per 1/60 s through the same
  `Loop` accumulator, with a step that applies instead of simulating. The
  target depth adapts to the jitter it observes, between 2 and 6 ticks (33 to
  100 ms).
* **Clock drift.** The two 60 Hz clocks are different crystals. When the buffer
  sits above its target, one frame applies two ticks; when it sits below, one
  frame applies none.
* **Running dry: hold, don't guess.** Keep showing the last tick. The engine
  has no interpolation or extrapolation by design, and the replica should not
  invent motion the host never simulated.
* **Too far behind: jump.** Deltas are cumulative, so catching up is a single
  apply. Events from skipped ticks still play if they are younger than about
  150 ms and are dropped otherwise, because a gunshot a second late is worse
  than none.

## Latency and aiming

The replica sees the world late by `D`: one-way latency plus buffer depth,
typically 50 to 120 ms (3 to 7 ticks). A shot resolved against the host's
*present* misses by however far the picture moved in that time. **In this game
the camera's movement is most of that.** It rides rails and pans across every
fight, while a zombie closes slowly.

* **v1, camera compensation.** Each press carries `view`, the tick player 2 was
  looking at. The host keeps a ring of `g_camera_view_to_world` by tick (64 ×
  16 numbers). It builds the ray with `BuildShotRay` from *that* tick's camera
  and tests it against the present actors. That removes the camera's share of
  the error for almost no cost. It lives in `app/net/`, and it is
  `[port-only]` where it hands the port a ray the exe's own frame would not
  have built.
* **Full rewind, actors included, is blocked.** It needs `pickShot` against a
  past pose, and poses are three.js's. That is the same missing piece that
  blocks the input replay harness: skeleton forward kinematics in `game/`
  (architecture step 21, row 37). It is not part of this plan.
* **Cosmetic immediacy on player 2** is deliberately not in v1, because the
  replica is meant to be passive. The reticle already follows the local
  pointer. Later options, render-only and overwritten by the next apply:
  seat player 2's own `g_crosshair_x[1]` before `GunLightBuildSystem`, so their
  torch has no lag; and echo their gunshot locally. The echo needs
  `sound.play` to carry the player who caused it, which it does not today.

## Bandwidth

**Measured, 2026-09-28.** Stages 1 and 2 ran headless from their entry blocks,
with no renderer, for about 6,500 in-play ticks each. Room gates fell back to
their timeouts, and START was pressed on each continue until the continues ran
out, so both runs end in a long, crowded fight (up to 38 and 55 actors). The
run is deterministic: two passes gave identical output. No shots were fired.
A second run that fired and hit with a stub `pickShot` gave *smaller* deltas,
because the pool thinned, so these are the busy case.

| | Stage 1 | Stage 2 |
|---|---|---|
| Full snapshot, JSON (median / max) | 132 / 153 KB | 166 / 183 KB |
| Full snapshot, gzip (median / max) | 12.8 / 14.0 KB | 14.9 / 16.7 KB |
| `world.save` time (median / p95) | 1.1 / 5.2 ms | 1.4 / 8.9 ms |
| Leaves changed per tick (median / p95) | 143 / 197 | 163 / 254 |
| **Binary delta per tick (median / p95 / max)** | **682 / 979 / 18,771 B** | **808 / 1,332 / 9,301 B** |
| Binary delta against the tick 8 back (median) | 964 B | 1,183 B |
| Mean rate at 60 Hz: binary delta / per-tick gzip JSON delta / full gzip | 39 / 72 / 679 KB/s | 47 / 85 / 798 KB/s |

The binary figure is an estimate built on the measured changes. It charges
2 bytes for a path index, a zigzag varint for an integer, and 4 bytes for a
non-integer. The lossless f64 chosen above costs 4 bytes more for each
non-integer, which is 39% of changed numbers on stage 1 and 45% on stage 2.
That puts the median at roughly **0.9 KB and 1.1 KB**, and the mean near
**50–65 KB/s**.

What this decides:

* **A delta against the last acknowledged tick is the right unit.** It is a
  tenth of the gzipped JSON delta and a sixtieth of the full snapshot. A
  replica that acknowledges late costs little: 8 ticks back is only 40% bigger
  than 1 tick back.
* **It fits one SCTP chunk at the median and two at p95.** Spikes come from
  spawn bursts; the stage 1 maximum is 11 actors appearing in one tick. Only
  14 and 18 ticks in a run went over 2 KB. A packet over 16 KiB goes on
  `ctrl` instead.
* **A keyframe is about 15 KB gzipped**, which is one or two chunks on `ctrl`.
* **Relayed through TURN, a session is about 0.5 Mbit/s**, including input and
  per-packet overhead, or roughly **200 MB per hour**. That is the number to
  price a TURN provider on.
* **The host cannot call `world.save()` every tick.** Its p95 is 5–9 ms, which
  is half a frame. Instead the host keeps a **shadow** of the last state it
  sent. Each tick it walks the live state against the shadow, records the
  changes as that tick's change list, and updates the shadow in place: one
  pass, with nothing cloned. A delta against `base` is the change lists after
  `base` merged, last write wins. Keeping 64 of those lists is a few hundred
  entries each, not 64 snapshots.
* **Pools keyed by `at` cost nothing extra.** Keyed diffing gave the same size
  as index diffing (651.7 vs 650.9 B mean), because actors are rarely removed
  from the middle of the list. The reason to key by `at` is the object
  identity argument above, and it turns out to be free.
* **About a third of each tick's changes are counters stepping by exactly
  one.** That is nine frame clocks, the 12 flash-ring and 12 tracer-ring
  records' `frame` (live or not), and each animated actor's `playTicks`. An
  "incremented by one" opcode is the first optimisation, if one is ever
  needed.

**The codec has to carry what JSON drops.** The snapshot holds array holes
(`g_script_flags` has about 234), `undefined` values (`standThrow`,
`class33`), and `-0` (both camera matrices, `pushNormal`, the pitch words).
JSON turns all of these into `null` or `0`. The codec gives hole, `undefined`
and `null` their own tags, and sends `-0` as f64, because
`Number.isInteger(-0)` is true and a zigzag varint would lose the sign.
Otherwise the replica check would report a mismatch on the first tick. None
were found of NaN, Infinity, typed arrays, `Map`, class instances or integers
above 2³¹.

**`ring.ts`'s cost figures are out of date.** They say 51.6 KiB and 0.30 ms
for stage 1 at frame 1860. The same frame now measures 126.7 KiB, with
`g_breakable_props` alone 38.7 KB and each actor about 2.5 KB, so sixty slots
are nearer 8 MB than 3 MB.

## Where the code goes

```
core/net/codec.ts        diff, encode, decode, apply over plain trees. No DOM, no three
core/net/protocol.ts     the message types above
core/net/hash.ts         the replica check's snapshot hash
app/input/gun.ts         GunDevice, LocalGun, applyGunInput
app/net/transport.ts     RTCPeerConnection, the two channels, stats, ICE restart
app/net/signal.ts        the room server client
app/net/host.ts          NetHost: bus tap, baselines, tick packets, RemoteGun, camera ring
app/net/replica.ts       ReplicaSystem, jitter buffer, ReplicaCommands
app/net/loopback.ts      an in-process transport with latency, loss and reordering, for tests
game/combat/shot_ray.ts  BuildShotRay (FUN_00406110), transcribed
ui/panels/Netplay.tsx    host / join / leave, room code, ping, direct or relay
tools/signal/            the room server, and the Vite plugin for development
```

`verify_layers.py` needs no new baseline. `core/net` is pure, `app/net` is the
composition root doing its job, and `ui/` reads a `net` slice of the
projection and emits `hostGame`, `joinGame` and `leaveGame` commands. If a
step turns out to need a violation, it stops and asks, as the architecture
requires.

## Verification

1. **`test:net`, headless, with no browser and no WebRTC.** Host and replica
   run in one node process over `LoopbackTransport`, with 100 ms latency, 20 ms
   jitter, 5% loss and reordering, over a whole stage with a scripted player 2
   shooting. It asserts:
   * the replica's snapshot hash equals the host's at every tick it applies
     (lossless makes this exact);
   * every event arrives exactly once, in tick order;
   * a one-second blackout recovers through a keyframe;
   * an epoch change drops the stale ticks;
   * player 2's pulls reach `G.g_shot_requests` as `player: 1`, exactly once
     each.
2. **Replica equivalence for `render/`.** For every tick, the scene graph after
   applying ticks one at a time must match the scene graph after `World.load`
   + `resync` at that tick. The comparison is a digest of visible nodes, world
   matrices and swapped parts, and three.js core runs under node
   (`test/render.test.ts` already relies on that). This test finds R2's
   `[open]` cases. Following the architecture's own habit, it is written so
   that one case fails deliberately first.
3. **`tools/net_pair.mjs`.** Two headless Chromes connect through the dev
   signaling plugin. The replica's drive seam fires at an enemy, and the
   host's feed has to log the kill against player 2. It must **not** assert
   audio: two headless Chromes on this machine make the audio checks read
   exactly zero (L29).
4. **The real network, by hand.** A phone on cellular against a desktop on home
   Wi-Fi, once with `?relay=1` and once without, each playing a whole stage. No
   harness covers carrier NAT.

`test:net` and the equivalence test get rows in `tools/verify_all.py`'s
`CHECKS`, each with the sentence saying what only that check can see.

## Order of work

Each step ends with something that runs, so the network is the last thing
added, not the first.

| Step | What | Done when |
|---|---|---|
| N0 | Measure the deltas (done: "Bandwidth"). Choose the signaling and TURN providers | the providers are decided |
| N1 | **R4 + R5.** `applyGunInput(player, …)`; `BuildShotRay` in `game/` | the existing harnesses are byte-identical; a port test drives player 1's slots, player 2 joins on `Start1` and kills something |
| N2 | **R1.** Walker outputs become events; subscribers write no state; `Events.tap` | `test:port` and `test:state` unchanged; the caption write has moved to where the event is raised |
| N3 | **R2 + R3 + codec**, with no network: roles, `ReplicaSystem`, `LoopbackTransport` | `test:net` and the equivalence test are green over a whole stage under simulated loss |
| N4 | WebRTC transport and the development signaling plugin | two tabs, then a laptop and a phone on the LAN; `net_pair.mjs` green |
| N5 | NAT: the room server deployed, TURN with minted credentials, ICE restart, the stats readout, `?relay=1` | a phone on cellular and a desktop on Wi-Fi play a stage, both direct and forced through the relay |
| N6 | Feel: camera compensation, jitter buffer tuning | a scripted player 2 at 100 ms hits moving targets at the same rate as at 0 ms |
| N7 | The lobby UI, disconnect and rejoin, the load barrier's screen | a replica reload rejoins without the host doing anything |

N1 and N2 are worth doing even if netplay stops there. N1 lets two players
share one machine, which the port supports and the page does not. N2 finishes
the `WalkerHost` item in the architecture's "What is left".

## Considered and not taken

* **Lockstep, where both ends simulate and only inputs cross.** It uses far
  less bandwidth, but it contradicts the passive client this plan is for, and
  it is blocked anyway. The simulation asks the renderer questions (`pickShot`,
  `boneWorld`, `objectPath`), so both ends would need bit-identical three.js
  poses, and one float of disagreement desyncs the session for good. The state
  hash would make it checkable, so it could come back later as a bandwidth
  optimisation layered on this design.
* **Streaming the host's video.** It gives the most passive replica possible,
  but player 2 would be aiming at a compressed, late picture, and a 60 fps
  stream needs several Mbit/s against the state stream's 0.5.
* **Full snapshots at 20 Hz.** It is the simplest option, but it needs about
  250 KB/s gzipped, five times the delta stream at a third of the rate, and it
  stutters visibly, because nothing interpolates between ticks, by design.
