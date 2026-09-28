/**
 * The netplay rendezvous on its own, for a machine that is not running the
 * dev server: a small VPS, a Raspberry Pi, a laptop on a LAN party.
 *
 *     npm run signal -- --port 8787
 *
 * Then open the player with `?signal=https://that-host/net/signal`, or build
 * it with `VITE_HOTD2_SIGNAL` set to the same. TURN, if there is one, comes
 * from the environment -- `HOTD2_TURN_URLS`, `HOTD2_TURN_SECRET`,
 * `HOTD2_TURN_TTL` -- as `rooms.ts` reads it. Put it behind TLS: a page
 * served over https may not call an http rendezvous.
 */
import { createServer } from "node:http";
import { configFromEnv } from "./rooms";
import { handle, nodeRooms } from "./node";

const args = process.argv.slice(2);
const flag = (name: string, fallback: string): string => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const port = Number(flag("port", "8787"));
const base = flag("base", "/net/signal");
const cfg = configFromEnv(process.env);
const rooms = nodeRooms(cfg);
setInterval(() => rooms.sweep(), 15_000).unref();

createServer((req, res) => {
  if (!handle(rooms, base, req, res)) {
    res.statusCode = 404;
    res.end("not found");
  }
}).listen(port, () => {
  console.log(`netplay rendezvous on :${port}${base} -- `
    + `${cfg.turn ? `TURN ${cfg.turn.urls.join(", ")}` : "no TURN configured (STUN only)"}`);
});
