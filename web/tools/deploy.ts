/**
 * The player, deployed: the built page, the bundle and the sounds, uploaded
 * to a Cloudflare R2 bucket that `r2site/worker.ts` serves over HTTPS at the
 * root of its address -- a secure context on any phone, so the Home Screen
 * and the service worker's offline copy work there without a certificate
 * installed.
 *
 *     npm run deploy                 # stage the site, upload what changed
 *     npm run deploy -- --dry-run    # say what would go, send nothing
 *     npm run deploy -- --no-stage   # upload what extract/site/ already holds
 *     npm run deploy -- --worker     # deploy the Worker even if it has not changed
 *
 * `npm run export` runs this after every rebundle into the default bundle
 * directory, when a deploy is set up (`r2site/.deploy.env`); `--no-deploy`
 * there skips it.
 *
 * **The site is public, and so may the bucket be.** What is uploaded is the
 * game's data, served by the Worker to anyone with its address; a bucket
 * whose `r2.dev` address is on, or that has a custom domain, serves it there
 * too. The owner has said that is fine for theirs, so the deploy says which
 * addresses and goes on. `docs/PLAYER.md`, "Hosting".
 *
 * The Worker is deployed when its source is not the one deployed: the deploy
 * gives it the hash of `r2site/`'s `worker.ts` and `wrangler.toml` as a plain
 * variable, `SOURCE`, and reads it back from the Worker's settings.
 *
 * Staging is `tools/site.ts --gzip`, unchanged. Uploading is incremental: an
 * object whose ETag is the staged file's MD5 is left alone, so a rebundle
 * that changed one stage uploads that stage. `index.html` goes last, so a new
 * page never names an asset still on its way, and whatever the bucket holds
 * that the site no longer does is deleted after.
 */
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { R2, r2CredentialsFromToken } from "./lib/r2";
import { repoRoot } from "./lib/bundle_root";

const ROOT = repoRoot();
const WEB = join(ROOT, "web");
const SITE_DIR = join(ROOT, "r2site");
/** The deploy's settings and secrets. Gitignored. */
export const DEPLOY_ENV = join(SITE_DIR, ".deploy.env");
const OUT = join(ROOT, "extract", "site");
const WORKER = "hotd2-site";

function readEnv(file: string): Record<string, string> {
  if (!existsSync(file)) return {};
  return Object.fromEntries(readFileSync(file, "utf8").split("\n")
    .map((l) => /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(l))
    .filter((m): m is RegExpExecArray => !!m).map((m) => [m[1], m[2]]));
}

function fail(msg: string): never {
  console.error(`deploy: ${msg}`);
  process.exit(1);
}

const args = new Set(process.argv.slice(2));
const dry = args.has("--dry-run");
if (!existsSync(DEPLOY_ENV)) {
  fail(`no ${relative(ROOT, DEPLOY_ENV)}. Make one with CLOUDFLARE_ACCOUNT_ID `
    + "and R2_BUCKET -- see docs/PLAYER.md, \"Hosting\"");
}
const env = readEnv(DEPLOY_ENV);
const account = env.CLOUDFLARE_ACCOUNT_ID;
const bucket = env.R2_BUCKET;
if (!account || !bucket) {
  fail(`${relative(ROOT, DEPLOY_ENV)} needs CLOUDFLARE_ACCOUNT_ID and R2_BUCKET`);
}
// The API token: this file's, the environment's, or the matchmaker's deploy token.
const token = env.CLOUDFLARE_API_TOKEN || process.env.CLOUDFLARE_API_TOKEN
  || readEnv(join(ROOT, "matchmaker", ".cloudflare.env")).CLOUDFLARE_API_TOKEN;
if (!token) fail("no Cloudflare API token (CLOUDFLARE_API_TOKEN in .deploy.env or the environment)");

async function api<T>(path: string): Promise<{ success: boolean; result: T | undefined }> {
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}${path}`,
                        { headers: { authorization: `Bearer ${token}` } });
  return r.json() as Promise<{ success: boolean; result: T }>;
}

// -- is the bucket public? -------------------------------------------------------------

const pub = await api<{ enabled?: boolean; domain?: string }>(`/r2/buckets/${bucket}/domains/managed`);
if (!pub.success) fail(`cannot read bucket ${bucket}'s settings: does it exist, and may the token read R2?`);
const custom = await api<{ domains?: { domain: string }[] }>(`/r2/buckets/${bucket}/domains/custom`);
const open = [
  ...(pub.result?.enabled && pub.result.domain ? [pub.result.domain] : []),
  ...(custom.result?.domains ?? []).map((d) => d.domain),
];
if (open.length) {
  console.log(`deploy: note -- bucket ${bucket} is also served at ${open.join(", ")}`);
}

// -- stage ------------------------------------------------------------------------

if (!args.has("--no-stage")) {
  const r = spawnSync("node", ["tools/run_ts.mjs", "tools/site.ts", "--gzip", "--out", OUT],
                      { cwd: WEB, stdio: "inherit" });
  if (r.status !== 0) fail("staging failed");
}
const record = JSON.parse(readFileSync(join(OUT, "site.json"), "utf8")) as
  { gzip: boolean; voiceGzip?: boolean; bundle: string };

function walk(dir: string, base = dir, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, base, out);
    else out.push(relative(base, p).split("\\").join("/"));
  }
  return out;
}
const files = walk(OUT).filter((f) => f !== "site.json");

const TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8", js: "text/javascript", css: "text/css",
  json: "application/json", webmanifest: "application/manifest+json", map: "application/json",
  glb: "model/gltf-binary", png: "image/png", svg: "image/svg+xml", wav: "audio/wav",
  m4a: "audio/mp4",
  bin: "application/octet-stream", woff2: "font/woff2", ico: "image/x-icon",
};

/** What each kind of file is served with. */
function headersFor(rel: string) {
  const ext = rel.split(".").pop() ?? "";
  const contentType = TYPES[ext] ?? "application/octet-stream";
  const top = rel.split("/")[0];
  if (top === "assets") return { contentType, cacheControl: "public, max-age=31536000, immutable" };
  if (top === "voice" && record.voiceGzip) {
    // Fetched whole and decoded (`audio/bgm.ts`'s clips), so compressed is safe.
    return { contentType, cacheControl: "public, max-age=604800", contentEncoding: "gzip" };
  }
  if (top === "bgm" || top === "se" || top === "voice") {
    return { contentType, cacheControl: "public, max-age=604800" };
  }
  if (top === "bundle" && record.gzip) {
    const source = join(record.bundle, rel.slice("bundle/".length));
    return { contentType, cacheControl: "no-cache", contentEncoding: "gzip",
             meta: { "decoded-length": String(statSync(source).size) } };
  }
  return { contentType, cacheControl: "no-cache" };
}

// -- upload what changed -----------------------------------------------------------

const creds = env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY
  ? { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY }
  : await r2CredentialsFromToken(token);
const r2 = new R2({ accountId: account, bucket, ...creds });
const held = new Map((await r2.list()).map((o) => [o.key, o.etag]));
const md5 = (p: string) => createHash("md5").update(readFileSync(p)).digest("hex");
const changed = files.filter((f) => held.get(f) !== md5(join(OUT, f)));
const stale = [...held.keys()].filter((k) => !files.includes(k));
const bytes = changed.reduce((a, f) => a + statSync(join(OUT, f)).size, 0);
console.log(`deploy: ${files.length} files staged, ${changed.length} to upload `
  + `(${(bytes / 1e6).toFixed(1)} MB), ${stale.length} to delete, into ${bucket}`);

if (!dry) {
  const last = changed.filter((f) => f === "index.html");
  const first = changed.filter((f) => f !== "index.html");
  let done = 0;
  const put = async (f: string) => {
    await r2.put(f, readFileSync(join(OUT, f)), headersFor(f));
    done++;
    if (done % 25 === 0 || done === changed.length) console.log(`  ${done}/${changed.length}`);
  };
  // A few at a time: a stage's GLB is tens of megabytes, held while it goes.
  for (let i = 0; i < first.length; i += 4) await Promise.all(first.slice(i, i + 4).map(put));
  for (const f of last) await put(f);
  for (const k of stale) await r2.delete(k);
}

// -- the Worker ------------------------------------------------------------------------

function wrangler(argv: string[]): Promise<number> {
  return new Promise((ok) => {
    const child = spawn("npx", ["--yes", "wrangler@4", ...argv], {
      cwd: SITE_DIR,
      env: { ...process.env, CLOUDFLARE_API_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: account,
             WRANGLER_SEND_METRICS: "false", CI: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const scrub = (s: string) => s.split(token!).join("<token>");
    child.stdout?.on("data", (d) => process.stdout.write(scrub(String(d))));
    child.stderr?.on("data", (d) => process.stderr.write(scrub(String(d))));
    child.on("exit", (code) => ok(code ?? 1));
  });
}

const toml = readFileSync(join(SITE_DIR, "wrangler.toml"), "utf8");
const source = createHash("sha256").update(readFileSync(join(SITE_DIR, "worker.ts")))
  .update(toml).digest("hex").slice(0, 16);
const settings = await api<{ bindings?: { type: string; name: string; text?: string }[] }>(
  `/workers/scripts/${WORKER}/settings`);
const deployed = settings.result?.bindings?.find((b) => b.name === "SOURCE")?.text;
if (args.has("--worker") || deployed !== source) {
  console.log(`deploy: the Worker ${settings.result ? "has changed" : "is not deployed yet"}`
    + (dry ? ", and would be deployed" : ""));
  if (!dry) {
    if (!toml.includes(`bucket_name = "${bucket}"`)) {
      fail(`r2site/wrangler.toml binds another bucket than R2_BUCKET (${bucket})`);
    }
    if (await wrangler(["deploy", "--var", `SOURCE:${source}`]) !== 0) fail("wrangler deploy failed");
  }
}

const sub = await api<{ subdomain: string }>("/workers/subdomain");
console.log(`deploy: ${dry ? "would be" : "live"} at https://${WORKER}.${sub.result?.subdomain ?? "<subdomain>"}.workers.dev/`);
