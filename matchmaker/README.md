# The netplay matchmaker

How two players' pages find each other. The host makes a **room** and gets a
six-letter code and TURN credentials; player 2 joins with the code and gets
credentials too. The host then posts its WebRTC **offer** and player 2 its
**answer** -- each carrying every network address its browser found -- and
the two browsers connect, directly or through the TURN relay. The matchmaker
holds those two messages and nothing else, and no game data ever passes
through it. The protocol is at the top of `rooms.ts`.

| file | what it is |
| --- | --- |
| `rooms.ts` | the rooms, the protocol and the TURN credentials. No HTTP |
| `node.ts` | `rooms.ts` over Node's `http`, rooms in a `Map`: the dev server and `serve.ts` |
| `serve.ts` | the standalone Node server |
| `worker.ts`, `wrangler.toml` | the Cloudflare Worker: one Durable Object per room |
| `turn.ts` | a TURN relay over UDP, which the dev server runs so two tabs on one machine connect |

Tests, from `web/`: `npm run test:matchmaker` (the protocol, against both the
Node server and the Worker) and `npm run test:turn` (the relay).

## On your machine

`npm run dev` in `web/` serves the matchmaker at `/net/matchmaker`, and the
page finds it there with no setting. It also starts the TURN relay on a free
UDP port and hands it out, so two tabs, or a laptop and a phone on the LAN
(`npm run dev -- --host`), connect even where no direct path works. The log
says where: `netplay: TURN relay on udp/…`. `HOTD2_DEV_TURN=0` turns it off.

## On Cloudflare

The Worker is the matchmaker; Cloudflare's TURN service is the relay. Both
run on Cloudflare, and there is no server of your own.

**Why a Durable Object:** a Worker keeps nothing between requests, and the
host's request and player 2's can run in different cities. One Durable Object
per room code is the one place both reach: it stores that room (two tokens,
the offer, the answer) and answers each request. Nothing stays open, so an
object is up only while it answers.

### 1. An account and a TURN key

Make a Cloudflare account (the free plan is enough). In the dashboard, open
**Realtime → TURN Server** and create a TURN key. Keep two values from it:
the **key ID** and its **API token**. The token is a secret.

### 2. Deploy the Worker

`wrangler`, Cloudflare's tool, is fetched by `npx`; nothing to install.

```sh
cd matchmaker
npx wrangler login      # opens a browser to authorise
npx wrangler deploy
```

It prints the Worker's address:
`https://hotd2-matchmaker.<your-subdomain>.workers.dev`.

### 3. Give it the TURN key

Each command asks for the value, then redeploys:

```sh
npx wrangler secret put HOTD2_CF_TURN_KEY_ID
npx wrangler secret put HOTD2_CF_TURN_TOKEN
```

### 4. Check it

```sh
curl -s -X POST https://hotd2-matchmaker.<your-subdomain>.workers.dev/net/matchmaker/rooms
```

The answer has a `code`, a `token`, and `iceServers`. Among them should be a
`turn:` entry on Cloudflare with a `username` and a `credential`. Only the
`stun:` servers means the credentials were refused: `npx wrangler tail` shows
the Worker's log, where the reason is (`Cloudflare TURN credentials failed:
…`). The room made by the check lapses on its own within the hour.

### 5. Try it from this machine

A local page can use the deployed matchmaker. Open two tabs (the second with
the code the first shows, as `#join=CODE`):

```
http://localhost:5173/?stage=1&net=host&relay=1&matchmaker=https://hotd2-matchmaker.<your-subdomain>.workers.dev/net/matchmaker
```

`relay=1` allows only the relay. The overlay (`I`) should say
`relay→relay … via TURN`: the traffic is going through Cloudflare.

### 6. Point the hosted page at it

Build the page with the address, and host it (`docs/HOSTING.md`):

```sh
cd web
VITE_HOTD2_MATCHMAKER=https://hotd2-matchmaker.<your-subdomain>.workers.dev/net/matchmaker npm run site -- --gzip --check
```

Or, for one visit, add `?matchmaker=<that address>` to the page's address.

### What it costs

The Worker makes a handful of short requests per session (create, join, two
posts, a few polls a second while someone waits) -- far inside the free plan.
TURN is billed by the traffic relayed, and only sessions that need the relay
use it: about 400–600 MB per hour of relayed play. Check Cloudflare's
current TURN pricing.

### Not yet run against Cloudflare

The request for TURN credentials (`cloudflareIce` in `rooms.ts`) is written
from Cloudflare's documentation, tested against both shapes of answer it
describes, but not against a real key. If it fails, the room still works, on
STUN alone; steps 4 and 5 are where that shows.

## Elsewhere

**The standalone server**, for a machine that is not running the dev server:

```sh
cd web
npm run matchmaker -- --port 8787
npm run matchmaker -- --port 8787 --turn --turn-ip 203.0.113.7   # with the relay
```

Put it behind TLS: a page served over https may not call an http matchmaker.
With `--turn`, UDP 3478 and the relay's ephemeral UDP ports must be open to the
players, and `--turn-ip` is the address they reach the machine at. The relay
here is UDP only -- no TCP, no TLS -- so it does not get out of networks that
block UDP; for strangers on the internet, use Cloudflare's service or coturn.

**coturn** of your own, instead of Cloudflare: set `HOTD2_TURN_URLS` and
`HOTD2_TURN_SECRET` (coturn's `static-auth-secret`, with `use-auth-secret`).
The matchmaker mints its credentials as coturn expects: username
`<expiry>:<room>`, password `base64(HMAC-SHA1(secret, username))`.

## Settings

The same names everywhere: the Node servers read them from the environment,
the Worker from `[vars]` and its secrets.

| variable | default | meaning |
| --- | --- | --- |
| `HOTD2_CF_TURN_KEY_ID`, `HOTD2_CF_TURN_TOKEN` | none | a Cloudflare TURN key and its API token. Secrets |
| `HOTD2_TURN_URLS`, `HOTD2_TURN_SECRET` | none | a coturn server of your own. The secret is a secret |
| `HOTD2_TURN_TTL` | `21600` (6 h) | seconds a TURN credential lives |
| `HOTD2_STUN` | Cloudflare's and Google's | STUN URLs, comma-separated |
| `HOTD2_DEV_TURN` | on | `0` stops the dev server running its relay |
| `HOTD2_DEV_TURN_PORT` | any free port | the dev server's relay's UDP port |

The page finds the matchmaker through `?matchmaker=<url>`, then a build's
`VITE_HOTD2_MATCHMAKER`, then `net/matchmaker` beside the page (the dev
server). The URL is the part before `/rooms`.
