/**
 * The service worker, `public/sw.js`: the page and every stage played, kept
 * on the device so the game plays with no network -- and, whenever the server
 * can be reached, every load checks it first and never shows a stale copy.
 * The worker's own comment is the design.
 *
 * Registered only where a browser offers one at all, which is a secure
 * context: `localhost`, or the dev server over HTTPS (`npm run https-cert`,
 * then `npm run dev-https`). Over plain `http://` to a LAN address -- a phone
 * on the dev server -- there is no worker and nothing changes.
 *
 * `?sw=0` takes it off again, and everything it kept: the escape hatch when a
 * worker is the thing in question. A harness's browser is new every run and
 * runs against a new server each time, so under automation the worker is left
 * out unless the address asks for it (`?sw=1`) -- a harness that wanted to
 * measure a download would otherwise be measuring a cache.
 */
export function registerServiceWorker(search: string): void {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  const asked = new URLSearchParams(search).get("sw");
  const sw = navigator.serviceWorker;
  if (asked === "0") {
    void sw.getRegistrations().then((rs) => rs.forEach((r) => void r.unregister()));
    if (typeof caches !== "undefined") {
      void caches.keys().then((ks) => ks.forEach((k) => void caches.delete(k)));
    }
    return;
  }
  if (navigator.webdriver && asked !== "1") return;
  sw.register("./sw.js").catch((e: unknown) => {
    console.warn("service worker not registered:", e);
  });
}
