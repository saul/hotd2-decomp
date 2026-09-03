/**
 * `render/`, headless.
 *
 * The render layer had no test of its own — `pose.test.ts` covers the poser's
 * arithmetic and nothing covered the layer's *resources*, which is where its
 * bugs actually are: a texture nobody frees looks exactly like a texture
 * somebody frees, right up until the tab is using a gigabyte.
 *
 * three.js core runs under node perfectly well. What it does not have is a
 * DOM, so the one thing that needs one — `labelTexture`'s canvas — is stubbed
 * here, minimally and only for the calls it actually makes. Everything else,
 * including the `CanvasTexture` objects and their real `dispose()`, is the
 * shipping code.
 *
 * Run with `npm run test:render`.
 */

/** Just enough `<canvas>` for `labelTexture`. */
function stubCanvas(): void {
  const ctx2d = {
    font: "", fillStyle: "", textBaseline: "",
    measureText: (t: string) => ({ width: t.length * 14 }),
    fillRect: () => undefined,
    fillText: () => undefined,
  };
  const doc = {
    createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d }),
  };
  (globalThis as unknown as { document: unknown }).document = doc;
}
stubCanvas();

export {};

const { LabelCache } = await import("../src/render/overlays");

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  if (ok) {
    console.log(`  ok    ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`);
  }
}

console.log("\nlabel textures: owned, and bounded");

{
  // **The leak this exists to stop.** `render/debug.ts` keyed its label cache
  // on text that contains `d=${d.toFixed(0)}` — the actor's whole-unit
  // distance from the eye. So every metre every boxed actor moved minted a
  // `CanvasTexture`, in a module-level `Map` that nothing ever disposed, for
  // the life of the page. `render/props.ts` had the same unowned cache.
  // `SpawnLayer` had already fixed the ownership half and neither followed.
  const cache = new LabelCache(8);
  for (let d = 0; d < 500; d++) cache.get(`k${d}`, `zombie d=${d}`, "#fff");
  check("a moving label cannot grow the cache past its cap",
        cache.size === 8, `${cache.size} textures for 500 distinct labels`);

  // Eviction has to dispose, or the cap moves the leak rather than fixing it.
  // three's `Texture.dispose()` dispatches a `dispose` event -- that is what
  // releases the GPU handle -- rather than clearing the object, so the event
  // is the thing to watch.
  const c2 = new LabelCache(2);
  const first = c2.get("a", "a", "#fff");
  let freed = 0;
  first.addEventListener("dispose", () => { freed++; });
  c2.get("b", "b", "#fff");
  c2.get("c", "c", "#fff");           // evicts "a"
  check("...and what it evicts is disposed, not just dropped",
        freed === 1, `${freed} dispose events`);

  // Insertion order is close enough to least-recently-used *if* a hit
  // re-inserts. Without that, the label being drawn every frame is the one
  // evicted, and the cache thrashes at exactly the size it is meant to help.
  const c3 = new LabelCache(2);
  c3.get("x", "x", "#fff");
  c3.get("y", "y", "#fff");
  let xFreed = 0;
  c3.get("x", "x", "#fff").addEventListener("dispose", () => { xFreed++; });
  c3.get("z", "z", "#fff");           // so this evicts y, not x
  check("a label still in use is not the one evicted",
        xFreed === 0 && c3.size === 2, `x freed ${xFreed}, ${c3.size} live`);

  // And the stage scope's half: everything goes back at once.
  const c4 = new LabelCache();
  let keptFreed = 0;
  c4.get("q", "q", "#fff").addEventListener("dispose", () => { keptFreed++; });
  c4.get("r", "r", "#fff");
  c4.dispose();
  check("dispose frees every texture and empties the cache",
        c4.size === 0 && keptFreed === 1,
        `${c4.size} left, ${keptFreed} freed`);
}

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
