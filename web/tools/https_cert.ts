/**
 * HTTPS for the dev server, so a phone on the LAN gets a secure context --
 * and with it the service worker that keeps the game for when there is no
 * network (`public/sw.js`), which no browser offers over plain `http://`.
 *
 *     npm run https-cert        # once, and again when this machine's address changes
 *     npm run dev-https         # the dev server on https://<this machine>:5443
 *
 * Makes a certificate authority of its own, once, and a server certificate
 * it signs for every address this machine has now, into `extract/https/` --
 * under `extract/`, which is gitignored, because a CA's key is nobody else's
 * business. A phone trusts the server by trusting the CA, once: the dev
 * server hands its certificate (never its key) out at `/__ca.crt`.
 *
 * iOS insists on two things of a server certificate a user-installed CA
 * signs, and this meets both: its names are in `subjectAltName`, IP addresses
 * included, and it is valid for no more than 825 days.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { hostname, networkInterfaces } from "node:os";
import { join } from "node:path";
import { repoRoot } from "./lib/bundle_root";

const DIR = join(repoRoot(), "extract", "https");

function openssl(args: string[]): void {
  const r = spawnSync("openssl", args, { cwd: DIR, encoding: "utf8" });
  if (r.error) throw new Error(`could not run openssl: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`openssl ${args[0]} failed:\n${r.stderr}`);
}

/** Every IPv4 address this machine has on a network, loopback included. */
function addresses(): string[] {
  const out = new Set(["127.0.0.1"]);
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) if (a.family === "IPv4") out.add(a.address);
  }
  return [...out];
}

mkdirSync(DIR, { recursive: true });
const host = hostname().replace(/\.local$/, "");
if (!existsSync(join(DIR, "ca.key")) || !existsSync(join(DIR, "ca.pem"))) {
  openssl(["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-sha256",
           "-keyout", "ca.key", "-out", "ca.pem", "-days", "3650",
           "-subj", `/CN=HOTD2 dev CA (${host})`,
           "-addext", "basicConstraints=critical,CA:TRUE",
           "-addext", "keyUsage=critical,keyCertSign,cRLSign"]);
  console.log("made a certificate authority: extract/https/ca.pem");
}
const ips = addresses();
const names = ["localhost", `${host}.local`];
writeFileSync(join(DIR, "server.ext"), [
  `subjectAltName=${[...names.map((n) => `DNS:${n}`), ...ips.map((i) => `IP:${i}`)].join(",")}`,
  "basicConstraints=CA:FALSE",
  "keyUsage=critical,digitalSignature,keyEncipherment",
  "extendedKeyUsage=serverAuth",
].join("\n") + "\n");
openssl(["req", "-newkey", "rsa:2048", "-nodes", "-sha256", "-keyout", "server.key",
         "-out", "server.csr", "-subj", "/CN=HOTD2 dev server"]);
openssl(["x509", "-req", "-in", "server.csr", "-CA", "ca.pem", "-CAkey", "ca.key",
         "-CAcreateserial", "-out", "server.pem", "-days", "800", "-sha256",
         "-extfile", "server.ext"]);
const lan = ips.filter((i) => i !== "127.0.0.1");
console.log(`signed a server certificate for ${[...names, ...ips].join(", ")}`);
console.log(`
On each iPhone or iPad, once:
  1. In Safari, open http://${lan[0] ?? "<this machine>"}:5174/__ca.crt (the dev server over
     plain http) and allow the download.
  2. Settings -> Profile Downloaded -> Install.
  3. Settings -> General -> About -> Certificate Trust Settings -> turn on
     "HOTD2 dev CA (${host})".
Then run \`npm run dev-https\` and open https://${lan[0] ?? "<this machine>"}:5443/ -- and add
that to the Home Screen, for full screen.`);
