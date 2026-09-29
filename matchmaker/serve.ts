/**
 * The netplay matchmaker on its own, for a machine that is not running the
 * dev server: a small VPS, a Raspberry Pi, a laptop on a LAN party.
 *
 *     cd web && npm run matchmaker -- --port 8787
 *
 * Then open the player with `?matchmaker=https://that-host/net/matchmaker`,
 * or build it with `VITE_HOTD2_MATCHMAKER` set to the same. TURN, if there is one, comes
 * from the environment -- `HOTD2_TURN_URLS`, `HOTD2_TURN_SECRET`,
 * `HOTD2_TURN_TTL`, or Cloudflare's `HOTD2_CF_TURN_KEY_ID` and
 * `HOTD2_CF_TURN_TOKEN` -- as `rooms.ts` reads it. Put it behind TLS: a page
 * served over https may not call an http matchmaker.
 *
 * `--turn` runs the relay in `turn.ts` beside it, on UDP 3478 (`--turn-port`),
 * advertising relays at `--turn-ip` -- the address peers reach this machine
 * at: its public address on a server, the default LAN address otherwise. The
 * UDP port and the relays' ephemeral ports have to be open to the peers.
 */
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { configFromEnv } from "./rooms";
import { handle, nodeMatchmaker } from "./node";
import { startTurn } from "./turn";

const args = process.argv.slice(2);
const flag = (name: string, fallback: string): string => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const port = Number(flag("port", "8787"));
const base = flag("base", "/net/matchmaker");
const cfg = configFromEnv(process.env);
if (args.includes("--turn")) {
  const secret = cfg.turn?.secret ?? randomBytes(16).toString("hex");
  const ip = args.includes("--turn-ip") ? flag("turn-ip", "") : undefined;
  const turn = await startTurn({ secret, port: Number(flag("turn-port", "3478")), relayIp: ip,
                                 log: (line) => console.log(line) });
  // Written with the address peers were given for relays when there is one;
  // otherwise with whatever host the page reached this server at.
  cfg.turn = { urls: [`turn:${ip ?? "{host}"}:${turn.port}?transport=udp`], secret,
               ttlSeconds: cfg.turn?.ttlSeconds ?? 6 * 3600 };
  console.log(`TURN relay on udp/${turn.port}, relays at ${turn.relayIp}`);
}
const mm = nodeMatchmaker(cfg);

createServer((req, res) => {
  if (!handle(mm, base, req, res)) {
    res.statusCode = 404;
    res.end("not found");
  }
}).listen(port, () => {
  console.log(`netplay matchmaker on :${port}${base} -- `
    + `${cfg.turn ? `TURN ${cfg.turn.urls.join(", ")}`
      : cfg.cloudflareTurn ? "Cloudflare TURN" : "no TURN configured (STUN only)"}`);
});
