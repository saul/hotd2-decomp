# Two players over WebRTC

**Status: built, 2026-09-28; on `main` since 2026-09-29.** This began as a
plan and now describes what is in the tree. Where the build departs from the
plan, the section *Where it departs from the plan* says so and why. Read
[`PLAYER_ARCHITECTURE.md`](PLAYER_ARCHITECTURE.md) first: netplay is written
against its rules, and its *Netplay* section holds the rules netplay added.

## The shape

One browser is the **host**, and it runs the player exactly as it does alone:
the walker, the port, the renderer, the HUD, the audio. The other is a
**replica**. It runs the render, HUD and audio layers over a copy of the host's
state and **never ticks the script or the port**. Nothing on the replica
decides anything about the game.

Player 2's gun is a **second input device**. Its aim, its trigger, its
off-screen pull and its START cross to the host, and the host feeds them into
player index 1's slots. Those slots already exist, in the exe for its second
maple port and in the port too.

Every tick, the host sends the replica every path of the state that changed
since the last tick the replica acknowledged, with that path's value now, plus
the events the port raised in between. The replica applies them into its own
live `G`, hashes the result, and compares it with the hash the host sent.

```
 replica (player 2)                                  host (player 1, authoritative)

 pointer, tilt, Enter                                 pointer, tilt, Enter
   │                                                    │
   ▼                                                    ▼
 NetReplica.press ── input: aim + presses ──(tick)──► NetHost.takeInput   gunInput(0, …)
                                                            │
                                                            ▼
                                                      gunInput(1, …)   app/main.ts, the one
                                                        SetPlayerAimFromPointer(1)  place intent
                                                        QueueShotRequest(1)         enters G
                                                        QueueOffscreenPull(1)
                                                        padLatch |= Start1
                                                            │
                                                     stepOneFrame: walker + port + render
                                                            │
 NetReplica.step ◄── Δ(state) + events + hash ─(tick)── NetHost.endTick: diff, hash, bus tap
   apply Δ into G in place, verify the hash
   world.update: render + hud (port dormant)
   events → the same subscribers: bgm, captions, feed

 ◄──── ctrl: hello, load/ready, keyframes, session, desync reports, stats (reliable) ────►
```

**`game/` learns nothing about the network.** Not one file under `web/src/game/`
changed. Player 2's input arrives in the slots the port already reads.

## Using it

**Online.** Open the menu (`≡ HOTD2`), then *Two players* → *Host a two-player
game*. A card shows the room code and a *Copy the join link* button. Player 2
opens the link, or chooses *Join* in the same menu and types the code. Both
players need the same build of the page and the same bundle for the stage.
Each brings their own bundle, from the same hosted site or built from their
own install. **No game data ever crosses the connection.** Player 2 presses
START (Enter, or the corner button) to join the game with a credit, as at the
cabinet.

**The host's game waits for player 2.** From the moment the room is made
until player 2's page answers, and again after a drop while player 2 finds
their way back, the host's clock is held, as it is while player 2 loads a
stage: nothing attacks a player who is still reading out the code. The card
says so; *Cancel* plays on alone.

**Every session is WebRTC**, two machines and two tabs of one browser alike.
Two tabs are the hardest case for it, not the easiest. Chrome hides every
host address behind an mDNS `.local` name, and on the machine this was
written on those names do not resolve (not even the Mac's own
`Sauls-MacBook-Pro.local`); the other address each tab has, the router's
public one, needs a router that routes to itself. With neither, the first two
tabs anyone tried sat on "Finding a way through both networks" for good. What
always gets through is a relay, so:

**The dev server runs a TURN relay** (`web/tools/signal/turn.ts`) beside its
rendezvous, on a free UDP port, and the rooms hand it out with credentials.
Where a direct path works, ICE takes it and the overlay's route says
`srflx→srflx` or `host→host`; where none does, it says `relay→relay … via
TURN`. `HOTD2_DEV_TURN=0` turns it off.

**The rendezvous.** The dev server has one at `/net/signal`, so two tabs, or a
laptop and a phone on the LAN, need no cloud. For a hosted copy, run one: see
[`web/tools/signal/README.md`](../web/tools/signal/README.md) for the
Cloudflare Worker, the standalone Node server (`npm run signal`), and TURN.
The page finds it through `?signal=<url>`, a build's `VITE_HOTD2_SIGNAL`, or
`net/signal` beside the page, in that order.

**Development and testing:**

| in the address | does |
|---|---|
| `?net=host` | make a room as the page opens |
| `#join=CODE` | join that room (what the link is) |
| `&netsim=lat:80,jit:20,loss:5` | make this end's outgoing link that bad: ms, ms, percent |
| `&relay=1` | force WebRTC through TURN (`iceTransportPolicy: "relay"`) |

The address keeps these, and the join hash, through every rewrite the player
makes of it (`urlstate.ts`), so a reload finds them.

## Debugging

**The badge** sits beside the speaker whenever a session is up. It shows who
this page is, the round trip, the loss when there is any, and whether the
traffic is relayed. It turns amber when play will feel worse than it should,
and red, with a pulsing dot, when the game on this screen may not be the
host's: a desync, a link silent while the host's clock runs, a refused
handshake. Press it, or `I`, for the overlay.

**The lobby card, while WebRTC searches**, shows what it has to work with:
the ICE state and how long it has been searching, the addresses each end
offered by type (`host`, with how many are hidden as `.local`; `srflx`, the
public address STUN reported; `relay`), and the candidate pairs tried and
failed. After 8 s without a connection it adds the likeliest reason, in order:
nothing arrived from the other end (the two pages are not on the same
rendezvous); `?relay=1` with no TURN server; no STUN answer (outgoing UDP
blocked); or no pair works (mDNS names that do not resolve, and a NAT or
router that needs a TURN relay). Both ends show it (`describePath` in
`app/net/transport.ts`).

**The overlay** (`netStats`, key `I`; `app/projection/net.ts` judges every
figure):

* **Link:** the phase, the transport, the ICE candidate pair in use
  (`host`, `srflx` or `relay`, and the protocol), ICE's state, the round trip
  from pings (smoothed, min and max) beside ICE's own measure, loss each way
  (in: counted here by sequence gaps; out: what the other end reports),
  **time since the last packet** (red past 500 ms while the host's clock
  runs), and bandwidth and packets each way.
* **Sending** (host): epoch and tick, how far behind player 2 is (the base of
  every delta), mean delta size, keyframes, the per-tick cost of tracking,
  presses taken, and **player 2's aim**: the last shot's segment against the
  host's own record of the camera at the tick player 2 saw, in degrees. It is
  zero to rounding when replication is right.
* **Receiving** (replica): epoch and tick, lag, the jitter buffer's depth and
  target, the arrival jitter, underruns and skips, keyframes, and the per-tick
  cost of applying and hashing.
* **Is it the same game?:** whether the replica's state matches the host's
  now, ticks verified, **hash mismatches**, **apply errors**, and **systems
  disagree**; on the host, desync reports. The per-tick hash is of the tree
  the deltas land in. Every slice of it but `G` is then handed to its
  system's `load`, and twice a second the replica also hashes what the
  systems hold (`save()`, as the host reads it) against the host's hash. A
  `load` that drops or changes what it is handed shows there and nowhere
  else, with the local diff in the log. It found one on its first run: the
  RNG word written back unsigned where the host's was signed.
* **Log:** every desync, apply error, keyframe problem and aim disagreement,
  newest first, with its tick. On a mismatch or an apply error the replica
  sends its section hashes, the host compares them with its own for that
  tick, and the log names **which global or which actor** differed, for
  example `parts.game.g_entity_lights` or `parts.game.g_object_list[@6720]`,
  before a keyframe repairs it. One line an episode: the ticks after the first
  fail the same way and are counted, not logged. If the keyframe does not
  come, or installs wrong, the replica asks again after 1 s, then 2, 4 and 8.
* **Resync** (replica) asks for a keyframe. **Copy report** puts every figure
  and the log on the clipboard as JSON, for a bug report.

The sidebar's *Two players* panel carries the few figures that say whether a
session is well, and the `netStats` switch.

## What is where

```
core/net/bytes.ts        a growable writer, a bounds-checked reader, varints to 2^53
core/net/hash.ts         murmur-style mixing; the leaf and segment tags
core/net/codec.ts        StateTracker (host), StateMirror (replica), TreeHasher
core/net/protocol.ts     message types, the two channels, the binary layouts
app/net/peer.ts          what both ends share: handshake, pings, link report, stats
app/net/host.ts          NetHost: acks pick the base, keyframes, player 2's gun, the aim check
app/net/replica.ts       NetReplica: jitter buffer, apply, verify, desync report, the gun
app/net/session.ts       roles, the lobby, rebuild and rejoin, the page's hooks
app/net/player_hooks.ts  the player as netplay sees it: live root, install, afterApply
app/net/transport.ts     the transport seam, MemoryLink (tests), SimLink (?netsim)
app/net/rtc.ts           WebRTC: two negotiated channels, ICE restart, candidate stats
app/net/signal.ts        the rendezvous client (HTTP + server-sent events)
app/net/stats.ts         rates, loss by sequence, round trips, jitter, NetStats
app/projection/net.ts    the badge, the overlay, the sidebar rows, judged
ui/panels/Net.tsx        the badge, the overlay, the lobby card, the menu section, P2's crosshair
tools/signal/            rooms.ts (the rendezvous), node.ts, serve.ts, worker.ts, README.md
```

`verify_layers.py` needed no new baseline. `core/net` is pure; `app/net` is the
composition root doing its job; `ui/` reads a `net` slice of the projection
and sends four `net*` commands.

## The state codec

**One property is load-bearing: a delta is absolute over its window.** A
packet for tick `t` against base `b` carries, for *every* path that changed
at any tick in `(b, t]`, that path's value **at `t`**. Applied to the
replica's state at any tick `c` in `[b, t]`, it therefore produces the state
at `t` exactly. That matters because the host builds each delta against the
newest tick the replica has acknowledged, and by the time the packet lands
the replica has usually moved past it.

The obvious alternative, a diff of `state(b)` against `state(t)`, does not
have this property. A value that changed after `b` and back again by `t`
would be missing from it, and a replica at `c` would keep the intermediate
value. The fuzz test's purpose is to try to break exactly this.

* **The host keeps a shadow**, a deep copy of the state as of the last tick.
  `StateTracker.update` walks the live state against it once a tick, records
  every path whose value, length or pool order moved, and updates the shadow
  **in place**, so nothing is cloned per tick except what is new. Deltas are
  read from the shadow, never the live objects. The ring holds 256 ticks of
  change lists. A delta is the union of the lists after its base, sorted so an
  ancestor precedes its descendants and one op settles a whole subtree.
* **Pools are keyed by identity.** A pool is an array whose elements are all
  plain objects with a distinct integer `at`, negatives included (the port
  numbers the actors it makes itself below zero). The actor pool is filtered
  by the sweep in `GameUpdate`, so an index diff would re-send every actor
  after the gap. Worse, patching in place would write one actor's fields onto
  the object the character layer holds for another. So a pool is diffed as an
  ordered set of `(at, serial)`: survivors keep their object on the replica,
  and a respawn at an old `at` is a new element sent whole. Some pools are
  rebuilt from fresh objects every tick (`g_shot_test_list`, the walker's
  `spawns`); the tick itself tells those apart. A pool in which any surviving
  `at` kept its object persists; one in which two or more survived and none
  did was rebuilt. **One survivor proves nothing** (the only actor
  respawning looks exactly like a one-element list rebuilt), so that tick goes
  by what the pool last proved. What stays unprovable is two or more
  survivors of a persistent pool all respawning in one tick; it is patched in
  place, with the values and the hash still right, and the character layer
  looks for a life starting again in the values as well (`removed` or
  `boneSlot` shrinking).
* **An element is sent whole for as long as it is younger than the base**,
  so an actor spawned within the ack lag rides whole in every delta. A
  replica already past its spawn keeps its own object and takes the value
  into it. Without that, a new actor was a new object on the replica every
  tick of its first few. The fuzz asserts identity both ways over every
  window in which the list stayed a pool; until the review it computed the
  identity map and asserted nothing (L14).
* **An indexed array's length** travels as the shortest the window saw and the
  final length. The replica cuts, then grows, so an element cut off and grown
  back as a hole stays a hole. The fuzz found the version without this.
* **Lossless.** Integers go as zigzag varints, everything else as f64, `-0`
  included. `undefined`, `null` and an array hole are three different tags.
  Keys are interned per epoch; a key's string rides in every packet whose base
  predates it.
* **The hash** is the sum of per-leaf hashes, each over the leaf's path and
  value, so key insertion order does not matter and array length and pool
  order are hashed explicitly. Both ends run the one `TreeHasher`, so there is
  no second copy of the leaf rules to drift. With sections on, it also hashes
  every three-deep path (`parts.game.<global>`) and every pool element under
  one. The host keeps 240 ticks of those, which is what names the part of the
  state a desync is in.

## The protocol

Two channels: `ctrl`, ordered and reliable; `tick`, `ordered: false,
maxRetransmits: 0`. Nothing on `tick` is ever resent, because every packet
carries whatever the other end has not acknowledged yet.

* **Handshake.** `Hello` both ways carries the protocol version,
  `SNAPSHOT_VERSION`, the build id (the commit, plus a nonce if the tree was
  dirty) and `SCHEMA_HASH`. A mismatch is refused with a sentence. The bundle
  is checked per stage at `Load`, because a page holds stages from two bundles
  at once.
* **Epochs.** Every timeline jump on the host (a stage load, a seek, a
  rewind, a snapshot load) starts a new epoch. The host tells the replica to
  `Load` the stage, which is a no-op if it already has it. The host **holds
  its clock** until the replica says `Ready` (45 s at most), then sends a
  keyframe. Anything from an older epoch is dropped, and presses made in the
  old timeline are discarded.
* **Ticks.** A `Tick` packet has the epoch, a sequence number, the tick, the
  base, the press ack, the host's state hash and send time, then the delta,
  then the events of the window (the last 30 ticks at most). A delta over
  12 KiB goes on `ctrl` instead. A keyframe (about 35–50 KiB in practice)
  goes on `ctrl` in 16 KiB chunks, and says which stage the host has
  *loaded*: a failed load leaves the last one, and a replica on another stage
  refuses it rather than installing it where it would hash the same and draw
  nonsense.
* **No delta spans more than 90 ticks.** Past that a keyframe is cheaper: a
  replica that has not acknowledged in a second and a half is not applying,
  and every delta from its base would carry the whole window again, sixty a
  second.
* **While the host's clock is held** (paused, hidden, free roam), a keyframe
  that is due goes at once, and a tick goes every 250 ms anyway. A held
  replica applies what lands at once, so it stands on the host's exact frame
  through a pause and sees what changes during it. A branch is not a hold:
  its countdown runs on the script's clock and the port runs through it, so
  it travels as a label.
* **A hidden replica** gets no frames, so no steps and no flushes, and its
  timers are throttled. It applies each tick as it lands and acknowledges
  it, as a held one does, so the host's deltas stay narrow (the headless
  test hides player 2 for five seconds on a 100 ms, 20 %-loss link: 33 ticks
  at the widest, no keyframe) and the tab comes back current. Arrivals are
  timed with the page's clock read on receipt, not the last frame's.
* **Input.** An input packet, sent every frame and at once on a press, has the
  replica's newest applied tick (the host's next base), the tick on screen,
  the aim in the exe's pixels, and every press not yet acknowledged. The host
  takes each press once by id. A pull that lands while the host's game is
  stopped goes nowhere, as player 1's does; START is latched for either. A
  new epoch drops whatever was waiting.

## Player 2's gun

`gunInput(player, kind, ray?)` in `app/main.ts` is the one place a press
becomes intent in `G`, for this page's own gun and for player 2's alike. The
exe keeps player 2's pad bits sixteen above player 1's: `PadStartPressed`
(`FUN_00413230`) tests `0x8` or `0x80000` `[proved]` in the annotations, and
the game-over screen's cut tests `0x2` or `0x20000`. Everything else takes
the player's index. On the host, `applyRemoteInput` feeds player 2's aim and
presses in at the head of each tick, the same moment a local press made
between frames is in `G`. At a pull, the aim is set to where it was at the
press.

**A shot is the segment player 2's own renderer built** (`Raycaster
.setFromCamera` through its camera, which is placed from the replicated
`g_camera_view_to_world`). It is therefore where player 2 was looking, and
the camera's movement over the latency is compensated for free. The host
checks each one against its own record of the camera at the tick player 2
saw (240 ticks kept), and the overlay says by how much they disagree. In the
harness it reads 0.0000°.

## Where it departs from the plan

* **R5, `BuildShotRay` into `game/`, was not done.** The plan had the host
  build player 2's segment from pixels and a past camera. Taking the segment
  player 2's own renderer built is exact by construction: it is literally
  what was on their screen, through the same code path as player 1's. The
  host's camera ring then checks it rather than builds it. No file in `game/`
  changed.
* **The codec is not Quake 3's baseline diff.** A baseline diff needs the
  replica to keep every base the host might pick, which for a 130–180 KB
  state is either many copies or undo logs. The window-absolute delta above
  gives the same loss tolerance with one live state and no rollback. The cost
  is that a delta over `n` ticks carries every path touched in them: measured,
  about 1.2 KB against the previous tick and 1.7–2.5 KB against a base 3–9
  ticks back.
* **The rendezvous speaks HTTP and server-sent events, not WebSockets.** No
  WebSocket library is installed and none was added, and the dev server, a
  plain Node server and a Worker can all serve SSE with nothing added. It
  passes any proxy.
* **Sessions survive drops** (the plan's N7). The host keeps its room and goes
  back to waiting, with player 2's gun put down (`g_aim_on_screen[1] = 0`).
  Player 2 rejoins by itself, with backoff, using the token it had; the
  rendezvous numbers each join, so the host can tell player 2 coming back
  from its own stream reconnecting. A closing tab leaves its room but keeps
  its token, so a reload rejoins even if the leave never landed.
* **Rules the plan implied, made explicit.** An event subscriber is an output
  (the dialogue handler no longer writes the caption on a replica), and a
  replica's world holds dormant every system that writes state. See
  `PLAYER_ARCHITECTURE.md`, *Netplay*.

## Measured

Two runs are behind these numbers: a headless run of stages 1 and 2
(`test:net`, three link profiles), and the page in headless Chrome
(`net_pair`). Before the build, a headless run measured the plain state: a
median of 132 KB (stage 1) and 166 KB (stage 2) of JSON per snapshot, and
`world.save` at 1.1–1.4 ms median, 5–9 ms p95. That is too slow to call
every tick, which is why the host diffs against a shadow instead.

| | stage 1 | stage 2 |
|---|---|---|
| delta against the previous tick (median) | 1.2 KB | — |
| delta against a base ~3–6 ticks back (median, headless) | 1.7 KB | 1.9–2.0 KB |
| delta in the page, with player 2 shooting (mean) | 1.8–2.7 KB | — |
| keyframe | 36–50 KiB | 37–38 KiB |
| host: diff + hash + sections + encode, per tick | ~1.0 ms median, headless; 1.6–2.1 ms in the page | 1.6–1.9 ms |
| replica: apply + verify, per tick | 0.5–0.7 ms median | 0.6 ms |
| bandwidth, host to replica | 107–168 KB/s | |

About 1 Mbit/s, or roughly 400–600 MB per hour of play through a TURN
relay: that is the figure to price a TURN provider on. The obvious next
saving, if one is ever wanted, is an "incremented by one" op, since about a
third of each tick's changes are counters stepping by exactly one.

## NAT traversal

ICE with the servers the rendezvous hands out: STUN always (Cloudflare's and
Google's by default), and TURN when the rendezvous has a secret. TURN
credentials are minted per peer and short-lived (the coturn
`use-auth-secret` scheme: `<expiry>:<room>` and
`base64(HMAC-SHA1(secret, username))`), so the secret never reaches a page.
TURN is not optional for this player. It is built for phones, and a phone on
cellular sits behind carrier-grade NAT, where hole-punching often fails;
TURN over TLS on 443 also covers networks that block UDP. And, as it turned
out, two tabs on one machine can need it too (*Using it*). When ICE drops
(`disconnected` for 2.5 s, or `failed`), the host restarts it through the
rendezvous (the replica asks it to), up to four times in a row; a restart
that reconnects gives the budget back. Both ends usually see a drop together,
so a replica's request that lands while the host's own restart is in flight,
or within 2.5 s of it, is ignored: a second offer over the first would leave
each end holding the other's wrong credentials. Signalling goes out in order
and is handled in order, and a candidate for an ICE generation whose offer or
answer has not been applied yet (its username fragment says which) is held
for it. The overlay's route row says whether a session is direct or relayed.

## Verification

| check | what only it sees |
|---|---|
| `test:net-codec` | fuzzed trees, lossy, reordered and duplicated delivery, acks up to 60 ticks late: every applied tick deep-equal and hash-equal to the host's; pool identity kept and a respawn a new object, asserted over every window, the only survivor's respawn included; a rebuilt list free; a `Map` refused by name. No bundle, about 20 s |
| `test:net` | a real stage, host and replica sessions on a `MemoryLink` at clean, lossy and bad settings: every tick hash-verified, a whole-tree comparison every 30th, player 2's tab hidden for five seconds with the host's deltas staying narrow, a seek's epoch followed, every press of the final epoch taken once and none twice, player 2 scoring, the aim check exact for a true shot and catching a false one. Sabotaged once: a changed value and a removed actor caught and named, a lost desync report recovered by the replica's own retry. Needs a bundle |
| `test:signal` | the rendezvous over real HTTP in its Node binding and its Worker: codes, TURN credentials, 404/409/403, queues, reconnects, rejoins, the sweep. It found three bugs, now fixed |
| `test:turn` | the relay over real UDP on loopback, driven by a client written from the RFC: the 401 challenge, the minted credentials accepted and a wrong or expired one refused, response integrity and fingerprint, nothing crossing before both ends have a permission, Send and Data indications, ChannelData both ways, a Refresh freeing the relay. No bundle, about a second |
| `net_pair` | the page, in a Chrome as users have it (mDNS on): a room whose link is opened in a second tab, over WebRTC, with the host's game held until player 2 is in; again with player 2's link at 60±30 ms and 10% loss; and again through the relay alone (`?relay=1`), whose route must say `relay`. Each plays stage 1 with player 2 joining and shooting through its own camera, and the replica's systems re-hashed against the host's. The first also takes a pause (player 2 on the host's exact frame), a reload of player 2 (rejoined, matching) and a stage change (player 2 follows, matching). No console error anywhere |

All five are rows in `tools/verify_all.py`.

## Not yet exercised

* **A relay on the public internet, and carrier NAT.** Sessions go through
  the dev server's relay (`net_pair`, `?relay=1`), but no session has gone
  through a relay across the internet, nor through Cloudflare's TURN, whose
  credential minting is written from its documentation and untested without
  a key. The first real test is a phone on cellular against a desktop on
  Wi-Fi.
* **Two machines.** Every WebRTC session so far ran two pages of one Chrome
  on one machine.
* **A long session.** The runs are tens of seconds per stage. A whole
  playthrough with stage advances is the next soak.

## What playing over the internet takes

What is built runs on one machine or one network with nothing else. For two
people on two networks:

1. **The page, hosted**, over https: `npm run site` stages the build
   (`VITE_HOTD2_SIGNAL` pointing at the rendezvous below). No game data goes
   with it: each player's page decodes its own bundle from their own copy of
   the game, and both must be the same build, which the handshake enforces.
2. **The rendezvous, hosted**: the Cloudflare Worker (`npx wrangler deploy`
   in `web/tools/signal`), on the Workers Free plan, or `npm run signal`
   behind TLS on any server.
3. **A TURN relay reachable from the internet, with TCP and TLS on 443.**
   Needed by a phone on carrier-grade NAT, strict NATs, networks that block
   UDP, and -- as this machine shows -- sometimes by two devices on one
   network. Either:
   * **Cloudflare's TURN service**: make a TURN key in the dashboard and give
     the Worker `HOTD2_CF_TURN_KEY_ID` and `HOTD2_CF_TURN_TOKEN` as secrets;
     it mints credentials per player. Nothing to run. Billed by traffic
     relayed, about 400–600 MB per hour of play.
   * **coturn** on a server with a public address, sharing
     `HOTD2_TURN_SECRET` with the rendezvous (`web/tools/signal/README.md`
     has the configuration).
   * The relay here (`npm run signal -- --turn --turn-ip <public address>`)
     on a small server works for UDP but has no TCP or TLS, so it does not
     reach networks that block UDP. It is for people you know, not the open
     internet.
4. **The test that has not been run**: a phone on cellular against a desktop
   on Wi-Fi, through the deployed Worker and relay.

## Known limits

* **The host reloading ends the session.** A reload makes a new room with a
  new code; player 2 has to join again.
* **Two players.** A third page could replicate (the host would need a
  `NetHost` per peer), but the game has two guns.
* **No cosmetic prediction on player 2.** Player 2's reticle follows the
  pointer at once. Their gun light, gunshot and ammo come back from the host a
  round trip later, as the brief asked: the replica decides nothing.
* **Full lag compensation is blocked**, as the plan said. It needs `pickShot`
  against a past pose, and poses are three.js's; the skeleton's forward
  kinematics would have to move into `game/` (architecture step 21, row 37).
* **Player 2's page keeps its own view settings** (4:3, lighting, fog,
  filtering, volume) but not the transport, the stage or the debug actions,
  which are the host's.

## Considered and not taken

* **Lockstep, where both ends simulate and only inputs cross.** It uses far
  less bandwidth, but the simulation asks the renderer questions (`pickShot`,
  `boneWorld`, `objectPath`), so both ends would need bit-identical three.js
  poses, and one float of disagreement desyncs for good. The hash would make
  it checkable, so it could come back later as a bandwidth optimisation.
* **Streaming the host's video.** It gives the most passive replica possible,
  but player 2 would be aiming at a compressed, late picture, and a 60 fps
  stream needs several Mbit/s.
* **Full snapshots at 20 Hz.** About 250 KB/s gzipped, and it stutters
  visibly, because nothing interpolates between ticks, by design.
