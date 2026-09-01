/**
 * The page has the shape the stylesheet expects.
 *
 * A green `tsc` and a green `vite build` say nothing about whether the chrome
 * renders — that lesson is already written into `verify_player_dom.py`, and
 * it applied again the moment `index.html` became a mount point: moving the
 * sidebar out of a portal dropped its `<aside id="right">`, and `#stagearea`
 * is a four-column grid whose columns land by **source order**. Types cannot
 * see that. A build cannot see it. It is a blank right-hand column.
 *
 * So this renders `App` to a string, twice — once with no projection, which
 * is the state the page is in before `Player` exists, and once with one — and
 * asserts the structure both times. It is deliberately about *structure* and
 * not about content: a test that pinned the markup would fail on every honest
 * edit and be deleted within the month.
 *
 * Since step 24 it also lists the ids each render must carry. That is not a
 * duplicate of `verify_player_dom.py`: that tool reads `id="..."` out of the
 * source, so it goes on passing when a component that carries one stops being
 * *rendered* — and step 24 moved eight ids into components that did not exist
 * before, which is exactly the edit that loses one silently. Here they have to
 * come out of a render.
 *
 * Since step 26 it also covers the five elements inside `#viewport` that used
 * to be appended there by `hud/` and `render/`. None of them carries an id, so
 * `verify_player_dom.py` is structurally unable to see them: this is the only
 * check that they are rendered, that they are rendered *inside* the viewport,
 * and that `hidden` on the two React now owns follows the toggle rather than
 * the layer.
 *
 * Since step 22 it also covers the error boundaries, and covers them with a
 * hole in the middle that is stated where it bites: `renderToStaticMarkup`
 * does not run a boundary at all, so the one assertion worth having — the page
 * survives while a panel is throwing — cannot be made from here. What is here
 * instead is the fallback driven through the two methods React itself calls,
 * and the nesting the boundaries must have, read from the source because a
 * healthy boundary renders no markup to read.
 *
 * Run with `npm run test:ui`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { App } from "../src/ui/App";
import { ErrorBoundary } from "../src/ui/ErrorBoundary";
import { UiStore } from "../src/ui/store";
import { Transport } from "../src/ui/panels/Transport";
import { TOGGLE_DEFAULTS } from "../src/ui/panels/Toggles";
import type { UiProjection } from "../src/ui/projection";

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  if (ok) console.log(`  ok    ${name}`);
  else { failures++; console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`); }
}

/** Enough of a projection to render every branch of the chrome. */
function projection(): UiProjection {
  return {
    stage: 2,
    stages: [1, 2],
    original: false,
    loading: null,
    status: { text: "stage2 · 12 models", note: " · bundle 1 min old",
              noteTitle: "built" },
    paused: true,
    toggles: TOGGLE_DEFAULTS,
    transport: { playing: false, mode: "play", speed: 1, frozen: false,
                 hasPath: true, camFrame: 10, camFrameLo: 0, camFrameHi: 100,
                 camLabel: "cp_st2 · 10" },
    sound: { muted: false, volume: 70, label: "bgm", blocked: false,
             text: "stage" },
    lightMode: "auto",
    fogMode: "auto",
    pillarbox: false,
    wait: { sub: "0x3B wait_enemies_alive", lines: [{ text: "3 alive" }] },
    waitBoxed: true,
    actorPanel: { sub: "12 actors", groups: [] },
    globals: { rows: [{ name: "g_frame", value: "10", address: "009C7108" }],
               actors: [], liveActors: 0, thrown: [] },
    rigs: { sub: "1/2 showing", rows: [
      { name: "obj_432840", slot: 12, visible: true, frozen: false,
        note: "", routes: 2, boxed: true },
      { name: "obj_484ff0_props", slot: null, visible: false, frozen: true,
        note: "held", routes: 1, boxed: false },
    ] },
    tree: { blocks: [{ index: 0, kind: "next", targets: [1], stepCount: 2,
                       title: "block 0", steps: [] }] },
    minimap: { entry: 0, nodes: [{ index: 0, kind: "next", next: [1] }] },
    current: { block: 0, step: 1, op: 0 },
    // Two rows, with `seq` deliberately not 0 and 1: `Player.onFeed` mints
    // from a counter that never resets, so by the time the window is full the
    // numbers bear no relation to the array indices.
    feed: [{ seq: 412, block: 0, step: 1, opIndex: 0, at: "0.1.0",
             name: "cam_play", summary: "", note: "", cat: "camera",
             status: "ported", title: "" },
           { seq: 413, block: 0, step: 1, opIndex: 1, at: "0.1.1",
             name: "wait_frames", summary: "", note: "", cat: "wait",
             status: "ported", title: "" }],
    inspector: "cam_play",
    hudRows: [["mode", "play"]],
    groups: {
      camera: [["slot", "57"], ["yaw", "180.0°  0x8000"]],
      scene: [["region", "2", true]],
      actors: [["characters", "6 of 267 up"]],
      props: [["props", "44/44 up"]],
      collision: [["coli", "0 quads selected"]],
      shooting: [["shooting", "off"]],
    },
    skip: { canSkip: true, sub: "region 3", stacked: false },
    branch: { sub: "two routes", options: [], countdown: "5s",
              paused: false },
    scopes: null,
    scopeContext: { frame: 10, stageLoadedAt: 0 },
    hasSaved: false,
  };
}

function render(p: UiProjection | null): string {
  const store = new UiStore();
  if (p) store.publish(p);
  return renderToStaticMarkup(createElement(App, { store, onHost: () => {} }));
}

/**
 * Everything between `#viewport` and the sidebar column, which is its subtree.
 *
 * `#stagearea` renders the tree, the resizer, the viewport and `<aside
 * id="right">` in that order, so the span between the last two is exactly what
 * `#viewport` contains. That is how the elements React took over from `hud/`
 * and `render/` in step 26 can be checked for *containment* and not merely for
 * presence: appending them to the wrong parent is the failure, and a
 * whole-document `includes` would pass either way.
 */
function viewportOf(html: string): string {
  const a = html.indexOf('id="viewport"');
  const b = html.indexOf('id="right"');
  return a >= 0 && b > a ? html.slice(a, b) : "";
}

/** The same source-order test as `inOrder`, over substrings rather than ids. */
function inSourceOrder(html: string, parts: string[]): string {
  let at = -1;
  for (const s of parts) {
    const next = html.indexOf(s);
    if (next < 0) return `${s} is not rendered`;
    if (next < at) return `${s} is out of source order`;
    at = next;
  }
  return "";
}

/** The opening tag of the one div with this class, `hidden` included. */
function tagOf(html: string, cls: string): string {
  return html.match(new RegExp(`<div class="${cls}"[^>]*>`))?.[0] ?? "";
}

/** `#stagearea`'s four columns land by source order, so the order is the test. */
function inOrder(html: string, ids: string[]): string {
  let at = -1;
  for (const id of ids) {
    const next = html.indexOf(`id="${id}"`);
    if (next < 0) return `#${id} is not rendered`;
    if (next < at) return `#${id} is out of source order`;
    at = next;
  }
  return "";
}

const GRID = ["topbar", "stagearea", "left", "left-resize", "viewport", "view",
              "right", "transport"];

/** What the page carries before `Player` exists, ids the sheet styles included. */
const COLD_IDS = ["topbar", "status", "stagearea", "left", "tree-filter",
                  "tree", "left-resize", "viewport", "view", "loading",
                  "loading-text", "right", "transport"];

/**
 * And with a projection, at the default folds.
 *
 * `#feed` is in the list because its panel opens by default; `#minimap`,
 * `#inspector`, `#scopes` and `#globals` are not, because theirs do not, and a
 * panel that is folded renders no body at all -- which is the same fact
 * `store.demand` is counting.
 */
const WARM_IDS = ["topbar", "stage-picker", "modes", "toggles", "view-settings",
                  "status", "stagearea", "left", "tree-filter", "tree",
                  "left-resize", "viewport", "view", "paused-overlay",
                  "skipbar", "branchbar", "right", "hud", "panel-wait",
                  "panel-actors", "panel-route", "panel-feed", "feed",
                  "inspector-panel", "scope-panel", "globals-panel",
                  "transport", "volume", "bgm-label", "frame-label"];

const missing = (html: string, ids: string[]): string[] =>
  ids.filter((id) => !html.includes(`id="${id}"`));

console.log("\nThe chrome renders before there is a projection:\n");

const cold = render(null);
check("every element the grid places is there, in source order",
      !inOrder(cold, GRID), inOrder(cold, GRID));
check("and the loading overlay is up",
      cold.includes('id="loading"') && cold.includes("loading bundle"));
check("and the panels that need a projection are not",
      !cold.includes('id="panel-wait"') && !cold.includes('id="hud"'));
check("and every id the stylesheet hangs off this state is emitted",
      missing(cold, COLD_IDS).length === 0,
      `missing: ${missing(cold, COLD_IDS).join(", ")}`);

console.log("\nAnd again with one:\n");

const warm = render(projection());
check("every element the grid places is there, in source order",
      !inOrder(warm, GRID), inOrder(warm, GRID));
check("the sidebar is inside #right", (() => {
  const right = warm.indexOf('id="right"');
  const hud = warm.indexOf('id="hud"');
  const globals = warm.indexOf('id="globals-panel"');
  return right >= 0 && hud > right && globals > hud;
})(), "a panel rendered outside the column the stylesheet gives it");
check("the loading overlay is gone", !warm.includes('id="loading"'));
check("the paused overlay is up", warm.includes('id="paused-overlay"'));
check("the viewport carries the classes both layers used to fight over",
      /id="viewport" class="[^"]*paused/.test(warm)
      || /class="[^"]*paused[^"]*"[^>]*id="viewport"/.test(warm),
      "the `paused` class is not on #viewport");
// The bug this replaces: React wrote `mode on`, the stylesheet only knew
// `.mode.active`, and a `classList.toggle` loop in `app/` put `active` back
// for about a frame.
check("the active mode button carries the class the stylesheet knows",
      warm.includes("mode active"),
      "`.mode.active` is what style.css styles");
check("the script filter is the panel's own control",
      warm.includes('id="tree-filter"'));
check("every id the stylesheet hangs off is emitted",
      missing(warm, WARM_IDS).length === 0,
      `missing: ${missing(warm, WARM_IDS).join(", ")}`);
// The fold is what decides whether a body exists, and the body existing is
// what `store.demand` counts. A panel that rendered its children while shut
// would claim its slice for ever, and `app/` would build the expensive one for
// a panel nobody has open.
check("a folded panel renders no body, which is what makes demand honest",
      !warm.includes('id="globals"') && !warm.includes('id="scopes"')
      && !warm.includes('id="minimap"'),
      "a shut panel rendered its children");
check("and an open one does", warm.includes('id="feed"'));

// Step 28. The feed keyed on the array index over a `slice(-400)` window, so
// past the cap every push shifted every index by one and React rewrote all
// four hundred rows' text to add one at the bottom.
//
// **React does not render keys**, so the markup cannot show which one is used
// and this cannot be asserted the way the ids above are. What the markup does
// show is that both rows in the fixture reach the page -- the failure a wrong
// key would eventually produce is rows with the wrong text in them, not rows
// missing -- and the key itself is read from the source, the way the boundary
// nesting below is, for the same reason: it is a fact about the source that
// the output does not carry.
const feedBody = warm.slice(warm.indexOf('id="feed"'),
                            warm.indexOf('id="inspector-panel"'));
check("every feed row reaches the page",
      (feedBody.match(/class="fe /g) ?? []).length === 2
      && feedBody.includes("cam_play") && feedBody.includes("wait_frames"),
      "a row in the projection did not render");
const FEED = join(process.cwd(), "src", "ui", "panels", "Feed.tsx");
let feedSrc = "";
try { feedSrc = readFileSync(FEED, "utf8"); }
catch { check("Feed.tsx is readable", false, `not found at ${FEED}`); }
check("and is keyed on its own seq, not on where it happens to sit",
      feedSrc.includes("key={e.seq}") && !/key=\{i\}/.test(feedSrc),
      "an index key over a capped window renames every row on every push");

// The boundaries render no element of their own while the region under them
// is healthy, which is the property that keeps them out of `#stagearea`'s
// grid: the four columns land by source order, so a `<div>` wrapped round
// `#left` or `#right` would move the column it was added to protect. The GRID
// check above is what proves it, and these two say it about the two places a
// wrapper would be easiest to add by accident.
check("nothing stands between #viewport and its canvas",
      /id="viewport"[^>]*>\s*<canvas id="view"/.test(warm),
      "a boundary that wraps the canvas in an element of its own would also "
      + "be a boundary that can unmount it");
check("nothing stands between #right and the first panel in it",
      /id="right"[^>]*>\s*<details id="panel-hud"/.test(warm));
// The strip folds like every other panel. It is the tallest thing in the
// column, and `panel-feed` below it has `flex: 1` -- so while the strip was a
// bare div with no scroller and no fold, a long row could squeeze the feed to
// zero height, summary included, and the panel simply was not on the page.
check("the player strip is a panel, and it scrolls",
      /<details id="panel-hud"[^>]*open/.test(warm)
      && /<div id="hud" class="scroll"/.test(warm),
      "an unscrollable strip pushes the panels below it off the column");

console.log("\nEverything inside #viewport is React's:\n");

// Step 26. `hud/` built `.hud-layer` and its three divs with
// `document.createElement` and appended them here, and `render/` did the same
// with `.crosshair`, so the element React renders held five children React had
// never heard of -- and where they landed in the paint order was decided by
// which of React's conditional overlays had mounted first. They are rendered
// here now and handed to the layers through `UiHost`. None of them carries an
// id, so `verify_player_dom.py` cannot see them and this is the only check
// there is that they exist at all.
const HUD_NODES = ['class="hud-layer"', 'class="shutter shutter-top"',
                   'class="shutter shutter-bottom"',
                   'class="screen-message"'];

for (const [when, html] of [["before a projection", cold],
                            ["and with one", warm]] as const) {
  const vp = viewportOf(html);
  check(`the hud layer and the crosshair are inside #viewport, ${when}`,
        HUD_NODES.every((n) => vp.includes(n)) && vp.includes('class="crosshair"'),
        "a node the layers are handed is outside the element they draw over");
  // The canvas stays first because `#view` is absolutely positioned and the
  // rest of the viewport paints over it; the crosshair is last because it
  // stands in for the pointer `#viewport.shooting { cursor: none }` removed,
  // and a pointer under the branch bar reads as the mode having broken.
  check(`the canvas is first and the crosshair last, ${when}`,
        !inSourceOrder(vp, ['<canvas id="view"', 'class="hud-layer"',
                            'class="crosshair"']),
        inSourceOrder(vp, ['<canvas id="view"', 'class="hud-layer"',
                           'class="crosshair"']));
  const layer = vp.slice(vp.indexOf('class="hud-layer"'),
                         vp.indexOf('class="crosshair"'));
  check(`the two bars and the caption are inside the layer, ${when}`,
        HUD_NODES.slice(1).every((n) => layer.includes(n)),
        "the shutter writes `style.height` on a node outside the container "
        + "the stylesheet gives it `container-type` on");
}

// `hidden` on these two was `Hud.setEnabled` and `Shooting.setEnabled`, and on
// both it was purely a function of a toggle already in the projection. So it
// is rendered, and the layers stopped writing it: one writer, and it is the
// one that renders the element. The caption is the exception and is
// deliberately not asserted here -- whether there is a caption is a countdown
// on the walker, so `hud/` still owns that one.
check("with no projection there are no toggles, so both are hidden",
      tagOf(cold, "hud-layer").includes("hidden")
      && tagOf(cold, "crosshair").includes("hidden"));
check("and with one, each follows its toggle rather than its layer",
      TOGGLE_DEFAULTS.hud && !TOGGLE_DEFAULTS.shoot
      && !tagOf(warm, "hud-layer").includes("hidden")
      && tagOf(warm, "crosshair").includes("hidden"),
      `hud-layer=${tagOf(warm, "hud-layer")} crosshair=${tagOf(warm, "crosshair")}`);

console.log("\nThe store reaches the panels by context:\n");

// Step 24 took the `store` prop off `Panel` and the `dispatch` prop off most
// of the panels; both come from `StoreContext` now. The failure mode that
// replaces a missing prop is a component that subscribes to a store nothing
// publishes to and sits there permanently empty, with nothing anywhere saying
// why -- so the context has no working default and this is what it does
// instead.
let outside: unknown = null;
try { renderToStaticMarkup(createElement(Transport)); }
catch (e) { outside = e; }
check("a panel rendered outside <App> says so rather than rendering empty",
      outside instanceof Error && outside.message.includes("StoreContext"),
      `threw ${String(outside)}`);

console.log("\nA region that throws:\n");

// The scenario the boundaries exist for: one slice whose shape a panel cannot
// read. `HudStrip` destructures every row, so a null row throws out of the
// sidebar — and, without a boundary, out of `world.update` and the whole
// frame with it.
const badHud = { ...projection(),
                 hudRows: [null as unknown as [string, string]] };
let thrown: unknown = null;
try { render(badHud); } catch (e) { thrown = e; }
check("a slice a panel cannot read does throw out of that panel",
      thrown !== null,
      "the rest of this section is only meaningful if this still throws");

// **This file cannot see the recovery, and must not pretend to.**
// `renderToStaticMarkup` does not invoke error boundaries: React only runs
// `getDerivedStateFromError` in a client render, and a throw during server
// rendering propagates to the caller — which is what the check above just
// measured. So the assertion that would have caught a blank page — "#viewport,
// #view, #topbar and #transport are all still in the output while one panel is
// throwing" — cannot be written here at all. Writing it against a hand-built
// fallback would assert this test's own imitation of React and nothing else.
//
// What it needs is a client render, which needs a DOM: jsdom or happy-dom plus
// `act`, and a new devDependency this repo has consistently refused for less —
// or the headless-Chromium harness `docs/PLAYER_ARCHITECTURE.md` has deferred,
// which would see it in the real browser and is the better answer. Until one of
// those exists, what is testable is below: the pieces React drives, driven
// directly, and the shape of the tree they sit in.

console.log("\nThe fallback, through the two methods React calls:\n");

/** React's own contract: derive the state, then render. Nothing is stubbed. */
function fallback(label: string, error: unknown): string {
  const b = new ErrorBoundary({ label, children: null });
  b.state = ErrorBoundary.getDerivedStateFromError(error);
  return renderToStaticMarkup(b.render());
}

const fb = fallback("The sidebar", new Error("rows is not iterable"));
check("it names the region, so you know which part died",
      fb.includes("The sidebar"));
check("and carries the message, so you know what the bad value was",
      fb.includes("rows is not iterable"));
check("and offers Retry, which is the only way out of it",
      fb.includes("Retry"),
      "recovery is explicit: a boundary that cleared itself on the next "
      + "projection would re-render the throwing panel at 60 Hz");
check("and wears the class the stylesheet styles", fb.includes('class="errbox"'));

// `throw null` is legal, and a boundary that stored the caught value bare and
// compared it against null would read it back as healthy, render the children,
// and catch it again -- for ever. The value is boxed for exactly this.
check("a thrown null is still a failure, not a healthy region",
      fallback("The sidebar", null).includes("errbox"),
      "throw null read back as healthy");

let reported: unknown[] = [];
const boundary = new ErrorBoundary({
  label: "The transport", children: null,
  onError: (...args) => { reported = args; },
});
boundary.componentDidCatch(new Error("nope"), { componentStack: "" });
check("and componentDidCatch reports the label with the error",
      reported[0] === "The transport"
      && (reported[1] as Error).message === "nope",
      "app/main.ts routes this to console.error and to the event feed, so "
      + "the region that died is named beside what the script was doing");

console.log("\nAnd the two elements no boundary may unmount:\n");

// `app/` is handed `#viewport` and `#view` through `onHost` and the
// `WebGLRenderer` and the `ResizeObserver` are built on them for the session.
// A boundary above either one can replace it with a fallback, and then WebGL
// draws into a detached canvas: a dead page that looks like a graphics bug.
// The markup cannot show this — a healthy boundary renders nothing — so the
// nesting is read from the source. The root backstop is the one boundary that
// is allowed to contain them, because a page whose root has thrown is already
// gone.
// `npm run test:ui` runs with `web/` as the working directory, and the bundle
// this file becomes lives in a temp dir, so `import.meta.url` cannot find the
// source.
const APP = join(process.cwd(), "src", "ui", "App.tsx");
let src: string[] = [];
try { src = readFileSync(APP, "utf8").split("\n"); }
catch { check("App.tsx is readable", false, `not found at ${APP}; run from web/`); }
const canvasAt = src.findIndex((l) => l.includes('<canvas id="view"'));
let depth = 0;
for (const line of src.slice(0, canvasAt)) {
  if (/^\s*<ErrorBoundary\b/.test(line)) depth++;
  if (/^\s*<\/ErrorBoundary>/.test(line)) depth--;
}
check("only the root backstop encloses the canvas", canvasAt > 0 && depth === 1,
      `#view sits inside ${depth} boundaries; only the root may hold it`);
check("every region of the page is inside one",
      src.filter((l) => /^\s*<ErrorBoundary\b/.test(l)).length === 6,
      "the root, the top bar, the script tree, the viewport overlays, the "
      + "sidebar and the transport");

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
