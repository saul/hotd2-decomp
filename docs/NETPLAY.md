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
the events the port raised in between, and its state's hash. The replica
applies them into its own live `G` and compares its own hash with the host's.
Neither end walks its state to hash it: the host keeps its hash as it diffs,
the replica as it applies, each change subtracting the share of what it
overwrote and adding its own. So every tick is checked, at a cost that
follows the size of the change rather than the size of the state.

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
 NetReplica.step ◄── Δ(state) + events + hash ─(tick)── NetHost.endTick: diff (keeps the hash), bus tap
   apply Δ into G in place (keeps the hash), verify it, audit a slice
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
own install. **No game data ever crosses the connection.**

**Player 2 joins the game on joining the session**, with a credit, as at the
cabinet: their START is sent for them as soon as the game would take it --
player 2 out, PRESS START BUTTON up, a credit there -- except during a
skippable cutscene, where the same START would skip it (the exe reads either
player's START there), so it waits for the cutscene to end. After that, and
after a game over, the corner button says **Join** whenever the game is
drawing PRESS START for player 2 (and **Start** for player 1 once a continue
has run out): on a phone it is the only START there is. Enter does the same.

**The join link** copies on any page -- `navigator.clipboard` where the page
is secure, a selected field where it is not (the dev server reached from a
phone is `http://192.168.x.x`, which is not) -- and says so if it could not;
the link is shown under the button to press and hold, and a secure page on a
phone offers the share sheet too.

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

**The dev server runs a TURN relay** (`matchmaker/turn.ts`) beside its own
matchmaker, on a free UDP port, and those rooms hand it out with credentials;
the deployed matchmaker hands out Cloudflare's.
Where a direct path works, ICE takes it and the overlay's route says
`srflx→srflx` or `host→host`; where none does, it says `relay→relay … via
TURN`. `HOTD2_DEV_TURN=0` turns it off.

**The matchmaker** (`matchmaker/` at the repository's root) is how the two
browsers find each other. The host makes a room and gets a code and TURN
credentials; player 2 joins with the code and gets credentials too. Then the
host posts its **offer** and player 2 its **answer**, each carrying every
address its browser gathered (its LAN address, its public address as STUN saw
it, its relay address), and the two connect. That is all the matchmaker does:
one message each way, no stream, and nothing after the connection is made. The
deployed one is the Cloudflare Worker in the same directory
([`matchmaker/README.md`](../matchmaker/README.md)), with Cloudflare's TURN
service as the relay, and **every page uses it by default**, the dev server's
included: the account's allowance is 1 TB of relayed traffic a month, and a
relayed session uses 400–600 MB an hour. `?matchmaker=local` uses the dev
server's own at `/net/matchmaker` instead, with its own relay: no internet
needed, and what the tests use. The page takes `?matchmaker=<url>` first, then
`local`, then a build's `VITE_HOTD2_MATCHMAKER`, then the deployed Worker.

**A session that drops is over.** There is no reconnecting: the card says why,
each page goes back to playing alone, and hosting again makes a new room.

**Development and testing:**

| in the address | does |
|---|---|
| `?net=host` | make a room as the page opens |
| `&matchmaker=local` | the dev server's own matchmaker and TURN relay, instead of the deployed Worker |
| `&matchmaker=URL` | that matchmaker |
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
matchmaker); `?relay=1` with no TURN server; no STUN answer (outgoing UDP
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
  every delta), mean delta size, keyframes, **what a tick costs** -- the mean
  over the last second, the worst, and the mean by phase (`state` reading
  the live state, `diff` finding what changed and keeping the hash,
  `encode`, `send`) --
  presses taken, and **player 2's aim**: the last shot's segment against the
  host's own record of the camera at the tick player 2 saw, in degrees. It is
  zero to rounding when replication is right.
* **Receiving** (replica): epoch and tick, lag, the jitter buffer's depth and
  target, the arrival jitter, underruns and skips, keyframes, and what a tick
  costs here, by phase (`apply` keeping the hash as it goes, `load` handing
  slices to the systems, `audit`, and `live` once a second).

**The FPS badge** (`fps`, key `K`, or `?fps=1`) sits beside the menu: frames
per second, the time between frames over the last second (lowest / mean /
highest), the page's own work per frame, and in a session what a netplay tick
costs. With the perf meter on (`?perf=1`), a dev build sends its readouts to
the dev server, `extract/perf.jsonl` -- and in a session, the netplay costs by
phase with them -- so a phone's numbers can be read without the phone.
* **Is it the same game?:** whether the replica's state matches the host's
  now, ticks verified, **hash mismatches**, **apply errors**, **page wrote
  the state** and **systems disagree**; on the host, desync reports. The
  per-tick hash is of the tree the deltas land in, kept as they land -- which
  means it is right about what the host sent even when something on this page
  has since written the tree, because it never looks at the tree. So the
  replica also **audits** the tree, a slice a tick: the kept shares are kept
  by section (`parts.game.<global>`, and each actor of a pool that deep), and
  each tick about a hundred leaves' worth of sections are hashed as they
  stand and compared with the share the ops left them. A pass takes about a
  second, and a difference is this page's own systems writing a state they
  should only read, named by section. Every slice but `G` is then handed to
  its system's `load`, and once a second the replica compares what the
  systems hold (`save()`, as the host reads it) with what was applied. A
  `load` that drops or changes what it is handed shows there and nowhere
  else, with the local diff in the log. It found one on its first run: the
  RNG word written back unsigned where the host's was signed.
* **Log:** every desync, apply error, keyframe problem and aim disagreement,
  newest first, with its tick. On a mismatch, an apply error or a write the
  audit found, the replica asks for a keyframe. The host sends it with that
  tick's delta beside it; the replica applies the delta, so its own state is
  of the keyframe's tick, and compares the two value by value -- the log then
  names **the values that differed**, `parts.game.g_credits[0]: 4 vs 81`,
  on both ends, before the keyframe repairs it. (A hash mismatch also
  compares the replica's kept hash with a walk of its state, which tells a
  write the audit had not reached yet from ops that went wrong; the host, on
  hearing of a desync, checks its own kept hash against a walk.) One line an
  episode: the ticks after the first fail the same way and are counted, not
  logged. If the keyframe does not
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
app/net/session.ts       roles, the lobby, the page's hooks
app/net/player_hooks.ts  the player as netplay sees it: live root, install, afterApply
app/net/transport.ts     the transport seam, MemoryLink (tests), SimLink (?netsim)
app/net/rtc.ts           WebRTC: two negotiated channels, one offer and one answer, candidate stats
app/net/matchmaker.ts    the matchmaker's client: create or join, post and wait for the SDP
app/net/stats.ts         rates, loss by sequence, round trips, jitter, NetStats
app/projection/net.ts    the badge, the overlay, the sidebar rows, judged
ui/panels/Net.tsx        the badge, the overlay, the lobby card, the menu section, P2's crosshair
matchmaker/              (the repository's root) rooms.ts, node.ts, serve.ts, worker.ts,
                         turn.ts (the dev relay), wrangler.toml, README.md
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
  order are hashed explicitly. Both ends run the one `TreeHasher` and the one
  definition of each leaf, so there is no second copy of the rules to drift.
  Because it is a sum, a subtree's share can be taken out and put back:
  **both ends keep it** instead of walking for it. The host's diff subtracts
  what each change overwrote and adds what it wrote; the replica's ops do the
  same as they land, and keep the shares by section as well, for the audit.
  A pool's elements hash at their `at`, so one that moves only changes the
  order leaves. The codec fuzz checks both kept hashes against a walk on
  every tick, and the audit against every tick it can see.

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
  the aim in the exe's pixels, **the device player 2 is aiming with** (their
  PC input mode, a byte: 6 the mouse, `0xD` a finger's light gun), and every
  press not yet acknowledged. The host takes each press once by id. A pull
  that lands while the host's game is stopped goes nowhere, as player 1's
  does; START is latched for either. A new epoch drops whatever was waiting.
  The device byte made it protocol 5.

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

**And player 2's device, which decides their crosshair.** The exe's own
network game (the title's NETWORK row) sends each machine's input mode as
byte `+0x14` of every packet (`NetBuildInputPacket`, `FUN_004A02F0`), and
`NetApplyPeerInput` (`FUN_0049EE10`) writes it into the peer's slot every
network frame with `SetPlayerInputModes` `[proved]`, so each machine's
`HudDrawCrosshair` decides the peer's crosshair from the peer's own device.
The port does the same: the replica sends the mode its pointer last was --
the mouse (6), or a finger, which is the light gun (`0xD`) and has no
crosshair -- and `stepOneFrame` writes both players' modes at the head of
each tick. The reticle each page draws for the other player is exactly the
host's `g_crosshair_drawn` for them, with the sprite `g_crosshair_sprite`
names: that player's Sight Graphic, player 2's from the blue set. When
player 2's page goes, their gun is put down -- a light gun (`0xE`) off the
screen -- and when the session ends, player 2's mode goes back to what it was
before hosting, as `NetSessionClose` (`FUN_0049F040`) restores both.

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
* **The matchmaker is a mailbox, not a relay of signals.** No candidates
  are trickled: each side waits for its browser to gather every address (up
  to 5 s) and sends them all in one SDP, so the matchmaker holds two messages
  and is asked for them with plain requests, repeated once a second. An
  earlier version streamed every candidate over server-sent events and
  supported rejoining; it was several times the size, for a second of
  connect time.
* **Sessions do not survive drops** (the plan's N7 is not built). A drop ends
  the session on both pages. Rejoining would need a new offer and answer
  through the matchmaker, a round of its own.
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
| host: a tick, headless (median / p95) | 0.53–0.71 / 1.5–2.0 ms, every tick hashed | 0.64–0.79 / 1.3–1.8 ms |
| host: a tick, in headless Chrome | 1.04 ms, before the kept hash: diff 0.60, hash 0.17, encode 0.18 | |
| replica: apply + verify + audit, headless (median / p95) | 0.15–0.22 / 0.6–1.2 ms, every tick verified | 0.17–0.25 / 0.4–0.8 ms |
| replica: a tick, Safari on a Mac, before the kept hash | 0.26 ms: apply 0.12, load 0.08, hash 0.06 | |
| bandwidth, host to replica | 107–168 KB/s | |
| bandwidth, host to replica | 107–168 KB/s | |

**On iOS it is another machine.** An iPad hosting and an iPhone as player 2
(Safari, as a player has them) reported, before the kept hash: a netplay tick
of 4.3 ms mean on the iPad and 3.4 ms on the iPhone, worst ticks of 20–47 ms,
and 33–36 fps on both. Most of what the page runs was three to seven times
its cost in Safari on a Mac -- but a walk of the whole state was thirty to
forty: 10–11 ms a walk on either device against 0.36 ms on the Mac, and the
worst ticks were the walks. JavaScriptCore run by hand with its optimising
tiers switched off shows the same shape (below), which is what the kept
hash was built against: nothing walks the state per tick any more, and what
each tick does is small enough to stay hot.

| JavaScriptCore, 240 recorded ticks | host mean / p95 / worst | replica mean / p95 / worst |
|---|---|---|
| all tiers, walking to hash | 0.30 / 0.82 / 10.7 ms | 0.06 / 0.28 / 2.0 ms |
| all tiers, kept hash | 0.26 / 0.60 / 1.7 ms | 0.09 / 0.22 / 1.9 ms |
| baseline JIT only, walking | 0.83 / 2.7 / 11.4 ms | 0.49 / 2.8 / 19.6 ms |
| baseline JIT only, kept | 0.45 / 0.92 / 2.1 ms | 0.22 / 0.42 / 1.6 ms |
| interpreter, walking | 1.66 / 5.7 / 12.2 ms | 1.02 / 5.1 / 11.2 ms |
| interpreter, kept | 0.91 / 1.4 / 1.9 ms (and one 10 ms GC pause) | 0.53 / 0.84 / 1.5 ms |

What is left on the host is the diff itself, which has to read every value
to know which changed; on the iPad it was 1.45 ms of the 4.3.

About 1 Mbit/s, or roughly 400–600 MB per hour of play through a TURN
relay: that is the figure to price a TURN provider on. The obvious next
saving, if one is ever wanted, is an "incremented by one" op, since about a
third of each tick's changes are counters stepping by exactly one.

## NAT traversal

ICE with the servers the matchmaker hands out: STUN always (Cloudflare's and
Google's by default), and TURN when it has one -- the dev server's own relay,
Cloudflare's TURN service, or coturn. TURN
credentials are minted per peer and short-lived (the coturn
`use-auth-secret` scheme: `<expiry>:<room>` and
`base64(HMAC-SHA1(secret, username))`), so the secret never reaches a page.
TURN is not optional for this player. It is built for phones, and a phone on
cellular sits behind carrier-grade NAT, where hole-punching often fails;
TURN over TLS on 443 also covers networks that block UDP. And, as it turned
out, two tabs on one machine can need it too (*Using it*). When ICE fails the
link is closed, and the session with it. The overlay's route row says whether
a session is direct or relayed.

## Verification

| check | what only it sees |
|---|---|
| `test:net-codec` | fuzzed trees, lossy, reordered and duplicated delivery, acks up to 60 ticks late: every applied tick deep-equal and hash-equal to the host's; both ends' kept hashes equal to a walk on every tick; the audit silent over every tick a slice at a time, and naming each of six writes made behind its back; pool identity kept and a respawn a new object, asserted over every window, the only survivor's respawn included; a rebuilt list free; a `Map` refused by name. No bundle, about 30 s |
| `test:net` | a real stage, host and replica sessions on a `MemoryLink` at clean, lossy and bad settings: every tick verified, a whole-tree comparison every 30th, player 2's tab hidden for five seconds with the host's deltas staying narrow, a seek's epoch followed, every press of the final epoch taken once and none twice, player 2 scoring, the aim check exact for a true shot and catching a false one, player 2's device switched between the mouse and a finger every two seconds and the host drawing them a crosshair on every in-play frame of the first and none of the second. Sabotaged once: a value changed behind the codec's back found by the audit and named value by value on both ends against the keyframe, a removed actor caught, a lost desync report recovered by the replica's own retry. Needs a bundle |
| `test:matchmaker` | the matchmaker over real HTTP in its Node binding and in-process in its Worker (a fake Durable Object namespace): codes, TURN credentials minted from the secret, the offer and the answer each behind its own token, 404/409/403/400, the host's delete, a room's hour, a Worker's second draw on a live code, and Cloudflare's credential answer in both shapes with port 53 dropped. No bundle |
| `test:turn` | the relay over real UDP on loopback, driven by a client written from the RFC: the 401 challenge, the minted credentials accepted and a wrong or expired one refused, response integrity and fingerprint, nothing crossing before both ends have a permission, Send and Data indications, ChannelData both ways, a Refresh freeing the relay. No bundle, about a second |
| `net_pair` | the page, in a Chrome as users have it (mDNS on): a room whose link is opened in a second tab, over WebRTC, with the host's game held until player 2 is in; again with player 2's link at 60±30 ms and 10% loss; and again through the relay alone (`?relay=1`), whose route must say `relay`. Each plays stage 1 with player 2 joining and shooting through its own camera, the audit finding nothing written on player 2's page, and the replica's systems' slices compared with what was applied. The first also takes a pause (player 2 on the host's exact frame) and a stage change (player 2 follows, matching), and ends with player 2 closing the tab, which the host's card must report. No console error anywhere |

| `crosshair_page --net` | two tabs: each page draws the other player's reticle with that player's sprite, and a tap on either page takes that player's reticle off both. Real time, so run by hand; the rest of the harness is the `crosshair` row |

All five of the first are rows in `tools/verify_all.py`.

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

1. **The matchmaker, deployed**: the Cloudflare Worker in `matchmaker/`, on
   the Workers Free plan. `matchmaker/README.md` is the whole procedure.
2. **Cloudflare's TURN service**, for the players with no direct path (a
   phone on carrier-grade NAT, strict NATs, networks that block UDP, and
   sometimes two devices on one network): a TURN key, given to the Worker as
   two secrets. It relays over UDP, TCP and TLS on 443, and is billed by the
   traffic it relays, about 400–600 MB per hour of relayed play.
3. **The page, hosted**, over https, built with `VITE_HOTD2_MATCHMAKER`
   pointing at the Worker (`docs/HOSTING.md`). No game data goes through the
   matchmaker or the relay; each page loads its own bundle, and both must be
   the same build, which the handshake enforces.
4. **The test that has not been run**: a phone on cellular against a desktop
   on Wi-Fi, through the deployed Worker and Cloudflare's relay.

## Known limits

* **No reconnecting.** A dropped link, or either page reloading, ends the
  session; hosting again makes a new room with a new code.
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
