/**
 * The player's service worker: the page and every stage played, kept on the
 * device for when the server cannot be reached -- and never in the way when
 * it can.
 *
 * **A load is online or offline, decided once, by the page's own request.**
 * That request always goes to the server. If the server answers within
 * `NAVIGATE_TIMEOUT_MS`, the whole load is online, and every request it makes
 * goes to the server first, conditional on the copy kept here: a file that
 * has not changed is a 304 and the kept copy is used, and one that has -- a
 * re-exported stage, an edited module -- is downloaded, handed to the page as
 * it arrives, and kept in place of the old. Nothing kept is ever shown while
 * the server can say whether it is current. Only a load whose page request
 * the server did not answer is offline, and then everything comes from here.
 * Deciding per load and not per request is what keeps a slow server from
 * mixing yesterday's modules with today's.
 *
 * Plain JavaScript, served as it is from `public/`, so that it has one URL in
 * the dev server and in a build. `app/offline.ts` registers it, and only in a
 * secure context, which is the only place a browser offers one: `localhost`,
 * or the dev server over HTTPS (`npm run https-cert`).
 */
const CACHE = "hod2-v1";

/**
 * How long the page's own request waits for the server before the load is
 * called offline. On the LAN the server answers in milliseconds; a phone that
 * has left it can wait a long time for a connection that will never come.
 */
const NAVIGATE_TIMEOUT_MS = 4000;

/**
 * Requests that are not files, by their path under the scope: the matchmaker,
 * the perf log, the CA. Never kept. A prefix of the path, never anywhere in
 * it: `src/app/net/` is the netplay code, and a load offline without it is
 * no load at all.
 */
const PASS = ["net/", "__perf", "__ca"];

/** Client id -> this load is offline. Absent is online. */
const offline = new Map();
/** The last navigation's verdict, for a client this worker has not seen (it restarted). */
let lastOffline = { at: 0, offline: false };

self.addEventListener("install", () => { self.skipWaiting(); });
self.addEventListener("activate", (e) => { e.waitUntil(self.clients.claim()); });

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const rel = url.pathname.slice(new URL(self.registration.scope).pathname.length);
  if (PASS.some((p) => rel.startsWith(p))) return;
  // Vite's client asking whether the dev server is back.
  if ((req.headers.get("accept") ?? "").includes("text/x-vite-ping")) return;
  if (req.mode === "navigate") {
    event.respondWith(navigate(event));
    return;
  }
  const known = offline.get(event.clientId);
  const off = known ?? (Date.now() - lastOffline.at < 60_000 && lastOffline.offline);
  event.respondWith(off ? fromDevice(event) : fromServer(event));
});

/** The page, from the server if it answers in time; and the load's verdict. */
async function navigate(event) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), NAVIGATE_TIMEOUT_MS);
  try {
    if (self.navigator && self.navigator.onLine === false) throw new Error("offline");
    const res = await revalidate(event, pageKey(), ctl.signal);
    clearTimeout(timer);
    verdict(event, false);
    return res;
  } catch {
    clearTimeout(timer);
    const kept = await (await caches.open(CACHE)).match(pageKey());
    if (!kept) return Response.error();
    verdict(event, true);
    return kept;
  }
}

function verdict(event, isOffline) {
  const id = event.resultingClientId || event.clientId;
  if (id) offline.set(id, isOffline);
  lastOffline = { at: Date.now(), offline: isOffline };
}

/**
 * The page is one file whatever its address says -- the stage, the entry,
 * `#join=` -- so it is kept under the scope's own URL.
 */
function pageKey() {
  return new Request(self.registration.scope);
}

/** Online: the server, conditionally; the kept copy only if the server has gone. */
async function fromServer(event) {
  const req = event.request;
  if (req.headers.has("range")) return ranged(event);
  try {
    return await revalidate(event, req);
  } catch (e) {
    const kept = await (await caches.open(CACHE)).match(req);
    if (kept) return kept;
    throw e;
  }
}

/** Offline: the kept copy; the network only for what was never kept. */
async function fromDevice(event) {
  const req = event.request;
  const kept = await (await caches.open(CACHE)).match(req, { ignoreVary: true });
  if (kept) return req.headers.has("range") ? slice(kept, req.headers.get("range")) : kept;
  return fetch(req);
}

/**
 * `req` from the server, with the validators of the copy kept under `key`:
 * the copy if the server says it is current, the server's answer -- kept, as
 * it streams to the page -- if it is not.
 */
async function revalidate(event, key, signal) {
  const req = event.request;
  const cache = await caches.open(CACHE);
  const kept = await cache.match(key);
  const headers = new Headers(req.headers);
  const etag = kept && kept.headers.get("etag");
  const modified = kept && kept.headers.get("last-modified");
  if (etag) headers.set("If-None-Match", etag);
  else if (modified) headers.set("If-Modified-Since", modified);
  // `no-store`: this cache is the one; the browser's would be a second copy
  // of every stage.
  const res = await fetch(req.url, {
    headers, cache: "no-store", credentials: "same-origin", redirect: "follow", signal,
  });
  if (res.status === 304 && kept) return kept;
  if (res.status === 200) {
    // Kept as it arrives: the page reads one copy and the cache the other,
    // so the loading screen's byte count is the download's, not the store's.
    event.waitUntil(cache.put(key, res.clone()).catch(() => { /* no room: still served */ }));
  }
  return res;
}

/**
 * A ranged request -- an `<audio>` element's -- online: the server's answer,
 * and the whole file fetched once, beside it, so the device has it for later.
 */
async function ranged(event) {
  const req = event.request;
  const cache = await caches.open(CACHE);
  if (!(await cache.match(req.url))) {
    event.waitUntil(fetch(req.url, { cache: "no-store" })
      .then((r) => (r.status === 200 ? cache.put(req.url, r) : undefined))
      .catch(() => {}));
  }
  try {
    return await fetch(req);
  } catch (e) {
    const kept = await cache.match(req.url);
    if (kept) return slice(kept, req.headers.get("range"));
    throw e;
  }
}

/** A 206 out of a whole kept file. */
async function slice(res, range) {
  const blob = await res.blob();
  const m = /^bytes=(\d*)-(\d*)$/.exec(range || "");
  if (!m) return new Response(blob, { status: 200, headers: res.headers });
  const start = m[1] ? Number(m[1]) : 0;
  const end = m[2] ? Math.min(Number(m[2]), blob.size - 1) : blob.size - 1;
  const headers = new Headers(res.headers);
  headers.set("Content-Range", `bytes ${start}-${end}/${blob.size}`);
  headers.set("Content-Length", String(end - start + 1));
  return new Response(blob.slice(start, end + 1), { status: 206, headers });
}
