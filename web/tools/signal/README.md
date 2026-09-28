# The netplay rendezvous

Two players' pages find each other here: the host makes a room and gets a
six-character code, player 2 joins with it, and the two pass WebRTC's offer,
answer and ICE candidates through the room until they can talk directly. After
that the room carries nothing but an ICE restart, and it never sees game
state. The protocol is at the top of `rooms.ts`; the design is in
`docs/NETPLAY.md` under "Transport, and getting through NAT".

| file | what it is |
| --- | --- |
| `rooms.ts` | the rooms, the protocol and the TURN credentials. No HTTP |
| `node.ts` | `rooms.ts` over Node's `http`, for the two servers below |
| `serve.ts` | the standalone Node server |
| `worker.ts`, `wrangler.toml` | the Cloudflare Worker, one Durable Object per room |

`test/signal.test.ts` drives the protocol against `node.ts` over real HTTP and
against `worker.ts` in-process:
`node tools/run_test.mjs test/signal.test.ts`, from `web/`.

## Three ways to run it

**The dev server.** `npm run dev` serves the rendezvous at `/net/signal` on
the dev server itself, and the page finds it there with no setting at all.
Two tabs work at once. For a phone on the LAN, start it with
`npm run dev -- --host` and open the address Vite prints for the network.
TURN settings are read from the environment when the server starts.

**The standalone server**, for a machine that does not run the dev server: a
small VPS, a Raspberry Pi, a laptop at a LAN party.

    npm run signal -- --port 8787 --base /net/signal

`npm run signal` runs `node tools/run_ts.mjs tools/signal/serve.ts`, which
needs `npm install` done in `web/` (esbuild comes with Vite). The flags shown
are the defaults. Put it behind TLS -- a page served over https may not call
an http rendezvous -- with a proxy that does not buffer responses (the stream
sends `X-Accel-Buffering: no` for nginx) and whose read timeout is longer than
the 15-second ping.

**The Cloudflare Worker**, for a deployed site: no server to patch, and it
runs on the Workers Free plan.

## Deploying the Worker

`wrangler` is not a dependency of `web/`; `npx` fetches it.

    cd web/tools/signal
    npx wrangler login
    # edit [vars] in wrangler.toml: HOTD2_TURN_URLS, and anything else below
    npx wrangler secret put HOTD2_TURN_SECRET      # if there is a TURN server
    npx wrangler deploy

It is then at `https://hotd2-signal.<your-subdomain>.workers.dev/net/signal`.
`npx wrangler dev` runs the same thing locally on port 8787. To check a
deployment, make a room:

    curl -s -X POST https://hotd2-signal.<your-subdomain>.workers.dev/net/signal/rooms

The answer has a `code`, a `token`, and the `iceServers` a page would get.

How the Worker differs from the Node servers:

* **A room lives in its object's memory.** An open event stream keeps the
  object up; with nobody listening it is evicted within a minute or two and
  the room goes with it, well before `HOTD2_ROOM_IDLE_MS`. A host whose phone
  sleeps in the lobby for longer than that comes back to a room that has gone,
  and has to make a new one.
* **A deploy ends every room.** Deploy between sessions.
* **`HOTD2_MAX_ROOMS` is not enforced.** Each room is its own object.
* **An object with an open stream is billed for the time it is up**, and both
  players' streams stay open for the whole session. Only WebSockets can
  hibernate, and the protocol is server-sent events. Weigh Cloudflare's
  Durable Object duration pricing against how long sessions run.

## TURN

STUN is enough for two ordinary home routers. It is not enough for a phone on
cellular: carrier-grade NAT often maps each destination to a different port,
hole-punching fails, and only a relay gets through. Offices, hotels and some
campuses block UDP outright, and only TURN over TLS on port 443 gets out of
those. The player is meant to be played on a phone, so plan on a TURN server.

The rendezvous mints a credential per peer, the way coturn's `use-auth-secret`
expects: the username is `<expiry>:<room code>` and the password
`base64(HMAC-SHA1(secret, username))`. The secret stays on the server. A
managed TURN service that issues credentials through its own API (Cloudflare's,
Twilio's) is not this scheme and would need its own minting; eturnal and coturn
both implement it.

A coturn configuration (`/etc/turnserver.conf`) for a VM with a public
address and a certificate for `turn.example.com`:

    listening-port=3478
    tls-listening-port=443
    cert=/etc/letsencrypt/live/turn.example.com/fullchain.pem
    pkey=/etc/letsencrypt/live/turn.example.com/privkey.pem
    use-auth-secret
    static-auth-secret=<the same value as HOTD2_TURN_SECRET>
    realm=turn.example.com
    min-port=49152
    max-port=65535
    fingerprint
    no-cli
    # Browsers relay over UDP only, even when they reach the server over TCP.
    no-tcp-relay
    # Keep the relay off the VM's own network and the cloud metadata service.
    denied-peer-ip=10.0.0.0-10.255.255.255
    denied-peer-ip=172.16.0.0-172.31.255.255
    denied-peer-ip=192.168.0.0-192.168.255.255
    denied-peer-ip=169.254.0.0-169.254.255.255
    # On a cloud VM behind 1:1 NAT (EC2, GCE), name both addresses:
    # external-ip=<public address>/<private address>

Open these, in the firewall and the cloud's security group:

| port | protocol | for |
| --- | --- | --- |
| 3478 | UDP and TCP | TURN |
| 443 | TCP | TURN over TLS (`turns:`) |
| 49152-65535 | UDP | the relayed traffic itself |

443 is a privileged port, so coturn needs `CAP_NET_BIND_SERVICE` (for
instance `AmbientCapabilities=CAP_NET_BIND_SERVICE` in a systemd drop-in), the
certificate's key has to be readable by the user it runs as, and nothing else
on that address may be listening on 443. Then:

    HOTD2_TURN_URLS=turn:turn.example.com:3478?transport=udp,turn:turn.example.com:3478?transport=tcp,turns:turn.example.com:443?transport=tcp
    HOTD2_TURN_SECRET=<the same value as static-auth-secret>

To see the relay work, take the TURN entry from a `curl` room as above and
give its URL, username and credential to WebRTC's "Trickle ICE" sample page:
candidates of type `relay` mean it does.

## Settings

The same names everywhere: the Node servers read them from the environment,
the Worker from `[vars]` and its secret. TURN is handed out only when both
`HOTD2_TURN_URLS` and `HOTD2_TURN_SECRET` are set.

| variable | default | meaning |
| --- | --- | --- |
| `HOTD2_STUN` | Cloudflare's and Google's | STUN URLs, comma-separated |
| `HOTD2_TURN_URLS` | none | TURN URLs, comma-separated |
| `HOTD2_TURN_SECRET` | none | coturn's `static-auth-secret`. A secret: never in a file that is committed |
| `HOTD2_TURN_TTL` | `21600` (6 h) | seconds a credential lives. Longer than any session: coturn checks it on every refresh |
| `HOTD2_MAX_ROOMS` | `500` | rooms at once. Node only |
| `HOTD2_ROOM_IDLE_MS` | `1800000` (30 min) | how long a room with nobody listening lives |

## Pointing the page at it

In order of precedence:

* **`?signal=<url>`** on the page's address, for one visit:
  `…/index.html?signal=https://hotd2-signal.example.workers.dev/net/signal`.
* **`VITE_HOTD2_SIGNAL`** when the page is built, for every visit:
  `VITE_HOTD2_SIGNAL=https://… npm run site`, or `npm run build`, or a line in
  `web/.env.production`.
* Otherwise `net/signal` relative to the page, which is where the dev server
  serves it.

The URL is the base, the part before `/rooms`, with or without a trailing
slash. A page served over https needs an https rendezvous.
