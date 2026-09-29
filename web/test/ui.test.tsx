/**
 * The page has the shape the stylesheet expects.
 *
 * A green `tsc` and a green `vite build` say nothing about whether the chrome
 * renders — that lesson is already written into `web/tools/repo/player_dom.ts`, and
 * it applied again the moment `index.html` became a mount point: moving the
 * sidebar out of a portal once dropped the element the stylesheet placed it
 * by, and the page lost a column with nothing anywhere failing. Types cannot
 * see that. A build cannot see it.
 *
 * So this renders `App` to a string, twice — once with no projection, which
 * is the state the page is in before `Player` exists, and once with one — and
 * asserts the structure both times. It is deliberately about *structure* and
 * not about content: a test that pinned the markup would fail on every honest
 * edit and be deleted within the month.
 *
 * **The page is the game**, so most of what used to be checked here is no
 * longer on it by default: the breadcrumb menu is shut until it is pressed and
 * the debug sidebar is closed until it is opened. `renderToStaticMarkup` cannot
 * press anything, so both are rendered directly, inside the same store, and
 * held to the ids the stylesheet and the harnesses reach them by.
 *
 * It also lists the ids each render must carry. That is not a duplicate of
 * `web/tools/repo/player_dom.ts`: that tool reads `id="..."` out of the source, so it
 * goes on passing when a component that carries one stops being *rendered*.
 * Here they have to come out of a render.
 *
 * It covers the elements inside `#viewport` that `hud/` and `render/` are
 * handed. None of them carries an id, so `web/tools/repo/player_dom.ts` is
 * structurally unable to see them: this is the only check that they are
 * rendered, that they are rendered *inside* the viewport, and that `hidden`
 * on the two React owns follows the projection rather than the layer.
 *
 * And it covers the error boundaries, with a hole in the middle that is stated
 * where it bites: `renderToStaticMarkup` does not run a boundary at all, so
 * the one assertion worth having — the page survives while a panel is
 * throwing — cannot be made from here. What is here instead is the fallback
 * driven through the two methods React itself calls, and the nesting the
 * boundaries must have, read from the source because a healthy boundary
 * renders no markup to read.
 *
 * Run with `npm run test:ui`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { App } from "../src/ui/App";
import { ErrorBoundary } from "../src/ui/ErrorBoundary";
import { UiStore } from "../src/ui/store";
import { StoreContext } from "../src/ui/store_context";
import { CrumbMenu } from "../src/ui/panels/Crumbs";
import { DebugSidebar } from "../src/ui/panels/DebugSidebar";
import { Feed } from "../src/ui/panels/Feed";
import { PauseScreen, SoundButton } from "../src/ui/panels/Overlays";
import { SkipBar } from "../src/ui/panels/SkipBar";
import { PerfHud } from "../src/ui/panels/PerfHud";
import { Tree } from "../src/ui/panels/Tree";
import { TOGGLE_DEFAULTS, TOGGLES } from "../src/ui/panels/Toggles";
import { DebugGroup } from "../src/ui/panels/DebugGroup";
import { ShortcutsDialog } from "../src/ui/panels/Shortcuts";
import { SHORTCUT_GROUPS, keyCap } from "../src/ui/shortcuts";
import { shutterCover } from "../src/hud/hud";
import { readPersisted, writePersisted } from "../src/ui/persist";
import { readViewPrefs, writeViewPrefs } from "../src/app/viewprefs";
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
    // Two, so the entry picker renders. Stage 2 has one in the shipped data;
    // the fixture is for the control, not for the stage.
    entries: [0, 7],
    entry: 0,
    original: false,
    loading: null,
    status: { text: "stage2 · 12 models", note: " · bundle 1 min old",
              noteTitle: "built" },
    bundleStale: false,
    paused: true,
    started: false,
    homeScreenHint: false,
    // The game drew the crosshair: the fixture renders the chrome as it is in
    // play, and `Viewport` hangs the reticle off this.
    crosshair: true,
    crosshairSprite: null,
    toggles: TOGGLE_DEFAULTS,
    transport: { playing: false, mode: "play",
                 camLabel: "cp_st2[0] slot 57  frame 10 / 100" },
    sound: { muted: false, volume: 70, label: "bgm", blocked: false,
             text: "Sound on" },
    lightMode: "auto",
    fogMode: "auto",
    filterMode: "asset",
    anisotropyLimit: 16,
    pillarbox: false,
    pixelRatio: 1,
    pixelRatioOptions: [1, 1.5, 2],
    wait: { sub: "0x3B wait_enemies_alive", lines: [{ text: "3 alive" }] },
    waitBoxed: true,
    actorPanel: { sub: "12 actors", groups: [] },
    tree: { blocks: [{ index: 0, kind: "next", targets: [1], stepCount: 2,
                       title: "block 0", steps: [] }] },
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
    hudRows: [["mode", "play"]],
    groups: {
      camera: [["slot", "57"], ["yaw", "180.0°  0x8000"]],
      scene: [["region", "2", true]],
      actors: [["characters", "6 of 267 up"]],
      props: [["props", "44/44 up"]],
      collision: [["coli", "0 quads selected"]],
      shooting: [["shooting", "off"]],
      route: [["g_script_branch_var", "0"]],
      net: [["session", "none"]],
    },
    skip: { canSkip: true, sub: "region 3", stacked: false },
    continueOffer: null,
    joinOffer: null,
    fps: null,
    perf: null,
    branch: { sub: "two routes", options: [], countdown: "5s",
              paused: false },
    gameOver: { phase: 3, label: "GAME OVER" },
    net: null,
    netPeer: null,
  };
}

function storeWith(p: UiProjection | null): UiStore {
  const store = new UiStore();
  if (p) store.publish(p);
  return store;
}

function render(p: UiProjection | null): string {
  return renderToStaticMarkup(createElement(App, { store: storeWith(p),
                                                   onHost: () => {} }));
}

/** One component, inside a store, the way `App` would have placed it. */
function renderIn(p: UiProjection | null, el: ReactElement): string {
  return renderToStaticMarkup(
    createElement(StoreContext, { value: storeWith(p) }, el));
}

/**
 * Everything in `#viewport`, which is its subtree.
 *
 * `#stagearea` renders the viewport and then `#overlay`, so the span between
 * the two is exactly what `#viewport` contains. That is how the elements the
 * layers are handed can be checked for *containment* and not merely for
 * presence: appending them to the wrong parent is the failure, and a
 * whole-document `includes` would pass either way.
 */
function viewportOf(html: string): string {
  const a = html.indexOf('id="viewport"');
  const b = html.indexOf('id="overlay"');
  return a >= 0 && b > a ? html.slice(a, b) : "";
}

/** Everything in `#overlay`: from its tag to the end of the stage area. */
function overlayOf(html: string): string {
  const a = html.indexOf('id="overlay"');
  return a >= 0 ? html.slice(a) : "";
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

/** The nesting the stylesheet and the input layering need, as source order. */
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

/**
 * The page's skeleton. `#viewport` before `#overlay`, because the overlay is
 * painted over it and is where every control lives: a press on a control
 * must never reach the viewport, which is the gun.
 */
const PAGE = ["shell", "stagearea", "viewport", "view", "overlay"];

/** What the page carries before `Player` exists. */
const COLD_IDS = ["shell", "stagearea", "viewport", "view", "loading",
                  "loading-text", "overlay", "crumbs", "rotate-hint"];

/** And with a projection, sidebar closed: the game, and what sits over it. */
const WARM_IDS = ["shell", "stagearea", "viewport", "view", "overlay",
                  "crumbs", "sound", "paused-overlay", "skipbar", "branchbar",
                  "gameover", "gameover-restart", "gameover-first",
                  "rotate-hint"];

/**
 * The debug sidebar at its default tab and folds.
 *
 * `#panel-scene`'s body -- `#view-settings` -- is not in the list, because its
 * panel is shut by default, and a panel that is folded renders no body at
 * all: the same fact `store.demand` is counting.
 */
const SIDEBAR_IDS = ["status", "controls", "modes", "play-pause", "skip-go",
                     "cam-label", "inspect", "panel-hud", "hud", "panel-wait",
                     "panel-camera", "panel-scene", "panel-actors",
                     "panel-props", "panel-collision", "panel-shooting",
                     "panel-sound", "volume", "bgm-label"];

/**
 * What the old chrome had and the game-first page does not. A panel that came
 * back by accident would be a slice built every frame for nothing.
 */
const GONE_IDS = ["topbar", "transport", "left", "right", "left-resize",
                  "panel-route", "minimap", "inspector-panel", "inspector",
                  "scope-panel", "scopes", "globals-panel", "globals",
                  "panel-rigs", "frame-label"];

const missing = (html: string, ids: string[]): string[] =>
  ids.filter((id) => !html.includes(`id="${id}"`));

console.log("\nThe page renders before there is a projection:\n");

const cold = render(null);
check("the skeleton is there, in source order",
      !inOrder(cold, PAGE), inOrder(cold, PAGE));
check("and the loading overlay is up",
      cold.includes('id="loading"') && cold.includes("loading bundle"));
check("and nothing that needs a projection is",
      !cold.includes('id="paused-overlay"') && !cold.includes('id="sound"'));
check("and every id the stylesheet hangs off this state is emitted",
      missing(cold, COLD_IDS).length === 0,
      `missing: ${missing(cold, COLD_IDS).join(", ")}`);
// The whole of `app/install/` hangs off the menu, and it is the one piece of
// chrome drawn whether or not a bundle loaded. The export screen shipped
// reachable only from the failure path once, so on every machine that had a
// bundle none of it existed.
check("and the menu's trail, which does not wait for a bundle",
      cold.includes('class="crumb-trail"'),
      "nothing renders `.crumb-trail`");
const coldMenu = renderIn(null, createElement(CrumbMenu, {
  debugOpen: false, onToggleDebug: () => {}, onClose: () => {} }));
check("and the menu, opened with no projection, still offers the bundle screen",
      coldMenu.includes('class="bundle-open"'),
      "nothing renders `.bundle-open`");

console.log("\nAnd again with one:\n");

const warm = render(projection());
check("the skeleton is there, in source order",
      !inOrder(warm, PAGE), inOrder(warm, PAGE));
check("the loading overlay is gone", !warm.includes('id="loading"'));
check("the start screen is up, and says Start before the first play",
      warm.includes('id="paused-overlay"') && warm.includes("is-start")
      && warm.includes("Start"));
check("the viewport carries the classes both layers used to fight over",
      /id="viewport" class="[^"]*paused/.test(warm)
      || /class="[^"]*paused[^"]*"[^>]*id="viewport"/.test(warm),
      "the `paused` class is not on #viewport");
check("every id the stylesheet hangs off is emitted",
      missing(warm, WARM_IDS).length === 0,
      `missing: ${missing(warm, WARM_IDS).join(", ")}`);
check("the debug sidebar is closed by default: the page is the game",
      !warm.includes('id="debug"') && !warm.includes('class="debug-open"'));
check("nothing from the old chrome came back",
      GONE_IDS.every((id) => !warm.includes(`id="${id}"`)),
      GONE_IDS.filter((id) => warm.includes(`id="${id}"`)).join(", "));
// Every control sits in `#overlay`, which is painted over the viewport and is
// not inside it: `render/shooting.ts` hears presses on `#viewport` natively,
// before React does, so a button inside it would fire a shot as well.
check("every control is in #overlay and none is in #viewport",
      !/<button/.test(viewportOf(warm))
      && ["crumbs", "sound", "paused-overlay", "skipbar", "branchbar",
          "gameover"].every((id) => overlayOf(warm).includes(`id="${id}"`)),
      "a control inside the viewport is also a trigger pull");
check("the sound button says what it is, for the harnesses and for a reader",
      /id="sound"[^>]*aria-pressed="true"/.test(warm)
      || /aria-pressed="true"[^>]*id="sound"/.test(warm));
// The trail is a burger and nothing else: the stage is the game's own title
// card's to say, the menu marks which one is open, and the name went too.
const trail = warm.slice(warm.indexOf('class="crumb-trail"'),
                         warm.indexOf("</button>", warm.indexOf('class="crumb-trail"')));
check("the menu button is the burger alone: no name, no stage",
      trail.includes('class="burger"') && !trail.includes("HOTD2")
      && !trail.includes("Stage") && !trail.includes("Block"), trail);
{
  // The hold is the menu's own: read from its source, because a static
  // render cannot open it. Opening pauses only a running game; closing lets
  // go only of a hold it took; the two items that open something over the
  // game close it without letting go.
  let src = "";
  try {
    src = readFileSync(join(process.cwd(), "src", "ui", "panels", "Crumbs.tsx"),
                       "utf8");
  } catch { /* fails below */ }
  check("the menu holds the game while it is open, and lets go of its own hold",
        /transport\.playing === true[^]*kind: "pause"/.test(src)
        && /held\.current = false;\s*if \(resume\) store\.dispatch\(\{ kind: "play" \}\)/.test(src));
  check("...but not when it opens the bundle screen or the list of keys",
        /kind: "openBundles" \}\), false\)/.test(src)
        && /act\(onShowKeys, false\)/.test(src));
}
// Filling the window is the default. The bars over the picture follow the
// frame, so `#overlay` carries whether it is boxed.
check("the frame fills the window by default, and #overlay knows",
      /<div id="overlay">/.test(warm)
      && /<div id="overlay" class="boxed">/.test(render({ ...projection(),
                                                          pillarbox: true })));

const paused = renderIn({ ...projection(), started: true },
                        createElement(PauseScreen));
check("once started, the same screen says PAUSED and Resume",
      paused.includes("is-paused") && paused.includes("PAUSED")
      && paused.includes("Resume"));
const muted = renderIn({ ...projection(),
                         sound: { ...projection().sound, muted: true } },
                       createElement(SoundButton));
check("and a muted game's speaker says so",
      muted.includes('aria-pressed="false"'));

console.log("\nThe menu:\n");

const menu = renderIn(projection(), createElement(CrumbMenu, {
  debugOpen: true, onToggleDebug: () => {}, onClose: () => {} }));
check("every stage is a button, and the current one is marked",
      (menu.match(/data-stage="/g) ?? []).length === 2
      && /class="current"[^>]*>2</.test(menu),
      "`[data-stage]` is the harnesses' hold on the stage picker");
check("the entry picker is there when the stage has two entries",
      menu.includes('id="entry-picker"')
      && (menu.match(/data-entry="/g) ?? []).length === 2);
check("rebuild, restart and the debug toggle are all there",
      menu.includes('class="bundle-open"') && menu.includes("Restart stage")
      && menu.includes('class="debug-toggle"'));
const oneEntry = renderIn({ ...projection(), entries: [0] },
                          createElement(CrumbMenu, {
                            debugOpen: false, onToggleDebug: () => {},
                            onClose: () => {} }));
check("and a stage with one entry offers no choice of entry",
      !oneEntry.includes('id="entry-picker"'));

// The corner button is START, and says which of its two jobs the moment
// wants. On a phone it is the only START there is -- without the Continue
// label a phone could only watch the CONTINUE? digit run out.
console.log("\nThe corner button:\n");
{
  const skipOnly = renderIn(projection(), createElement(SkipBar));
  check("in a skippable region it says Skip",
        skipOnly.includes('id="skipbar"') && skipOnly.includes("Skip")
        && !skipOnly.includes("Continue"), skipOnly);
  const counting = renderIn({ ...projection(), skip: null,
                              continueOffer: { canContinue: true, digit: 7,
                                               sub: "a credit" } },
                            createElement(SkipBar));
  check("on the continue countdown it says Continue, with the game's digit",
        /id="skipbar" class="continue"/.test(counting)
        && /Continue <span class="continue-digit">7<\/span>/.test(counting)
        && !/<button[^>]*disabled/.test(counting), counting);
  const both = renderIn({ ...projection(),
                          continueOffer: { canContinue: true, digit: 3,
                                           sub: "a credit" } },
                        createElement(SkipBar));
  check("...and Continue is the label if both are ever live at once",
        both.includes("Continue") && !both.includes("Skip"));
  const broke = renderIn({ ...projection(), skip: null,
                           continueOffer: { canContinue: false, digit: 2,
                                            sub: "no credit" } },
                         createElement(SkipBar));
  check("a continue START would not take is shown, and cannot be pressed",
        /<button[^>]*disabled/.test(broke) && broke.includes("Continue"));
  const neither = renderIn({ ...projection(), skip: null },
                           createElement(SkipBar));
  check("with neither, there is no button", !neither.includes("skipbar"));
  // Player 2 out, PRESS START BUTTON up: a phone's only way into the game.
  const joining = renderIn({ ...projection(), skip: null,
                             joinOffer: { label: "Join", canJoin: true, sub: "a credit" } },
                           createElement(SkipBar));
  check("with player 2 out and a credit there, it says Join",
        joining.includes("skipbar") && />Join</.test(joining)
        && !/<button[^>]*disabled/.test(joining), joining);
  const joinOverSkip = renderIn({ ...projection(),
                                  joinOffer: { label: "Join", canJoin: true, sub: "a credit" } },
                                createElement(SkipBar));
  check("...and Join is the label over Skip: getting in is what player 2 is after",
        joinOverSkip.includes("Join") && !joinOverSkip.includes("Skip"));
  const noCredit = renderIn({ ...projection(), skip: null,
                              joinOffer: { label: "Join", canJoin: false, sub: "no credit" } },
                            createElement(SkipBar));
  check("...shown but not pressable with no credit", /<button[^>]*disabled/.test(noCredit));
  // Both labels are one press: the command Enter's own handler makes.
  let src = "";
  try {
    src = readFileSync(join(process.cwd(), "src", "ui", "panels", "SkipBar.tsx"),
                       "utf8");
  } catch { /* the check below fails on an empty source */ }
  check("both labels dispatch pressStart, and nothing else",
        /kind: "pressStart"/.test(src) && !/requestSkip/.test(src));
}

// The perf meter is read off a phone, over the game, and is the evidence a
// slow frame is diagnosed from -- so it has to render what it is given, and
// nothing when it is off.
console.log("\nThe perf meter:\n");
{
  const off = renderIn(projection(), createElement(PerfHud));
  check("off, there is no readout", off === "", off);
  const on = renderIn({ ...projection(), perf: {
    fps: 42, frame: [16.7, 33.4, 81], long: 3, busy: [4.2, 9.9], ticks: 1.4,
    sections: [["script", 0.2, 1], ["game", 1.9, 4], ["render", 0.9, 2],
               ["hud", 0, 0], ["matrices", 0.3, 1], ["draw", 0.8, 2],
               ["publish", 0.1, 1], ["other", 0.05, 0.2]],
    systems: [["render.characters", 0.8], ["game.world", 0.4]],
    gpu: 6.3, uploads: [12, 1], worst: "38 ms, draw 31 · +12 tex",
    gl: [164, 2718, 29, 290, 999], view: "520×390 @1× · dpr 3",
    experiments: "blur=0" } }, createElement(PerfHud));
  check("on, it says the frame rate and the frame times",
        on.includes('id="perf-hud"') && /<b>42<\/b> fps · 16.7\/33.4\/81 ms/.test(on)
        && on.includes("3 long"), on);
  check("...where the time went, leaving out what cost nothing",
        on.includes("game</span> 1.9") && !/>hud<\/span>/.test(on)
        && on.includes("characters 0.8"), on);
  check("...the GPU sample, the GL counts, the canvas and the A/B switches",
        on.includes("gpu≈ 6.3") && on.includes("164 calls")
        && on.includes("520×390 @1× · dpr 3 · blur=0"), on);
  check("...the worst frame and what the window uploaded",
        on.includes("worst 38 ms, draw 31 · +12 tex")
        && on.includes("new: +12 tex · +1 prog"), on);
  check("the meter is an overlay with a key, in the Scene panel",
        TOGGLES.some((t) => t.name === "perf" && t.kind === "debug"
                            && t.group === "scene" && !t.on && !!t.key));
}

console.log("\nThe debug sidebar:\n");

const side = renderIn(projection(), createElement(DebugSidebar,
                                                  { onClose: () => {} }));
check("every id the stylesheet and the harnesses hang off is emitted",
      missing(side, SIDEBAR_IDS).length === 0,
      `missing: ${missing(side, SIDEBAR_IDS).join(", ")}`);
// The bug this replaces: React wrote `mode on`, the stylesheet only knew
// `.mode.active`, and a `classList.toggle` loop in `app/` put `active` back
// for about a frame.
check("the active mode button carries the class the stylesheet knows",
      side.includes("mode active"),
      "`.mode.active` is what style.css styles");
check("there are two modes, and neither is Step",
      (side.match(/class="mode/g) ?? []).length === 2 && !side.includes(">Step<"));
check("the controls come before the tabs, so they stay on screen",
      !inOrder(side, ["controls", "inspect"]), inOrder(side, ["controls", "inspect"]));
// The fold is what decides whether a body exists, and the body existing is
// what `store.demand` counts. A panel that rendered its children while shut
// would claim its slice for ever, and `app/` would build it for a panel
// nobody has open.
check("a folded panel renders no body, which is what makes demand honest",
      !side.includes('id="view-settings"'),
      "a shut panel rendered its children");
check("the player strip is a panel, open by default",
      /<details id="panel-hud"[^>]*open/.test(side)
      && /<div id="hud" class="kv"/.test(side));
check("the Track switch is gone: the gameplay camera is always on",
      !side.includes(">Track<") && !(("trackEnemies" as string) in TOGGLE_DEFAULTS));
// The page is the game: nothing drawn over it that it did not ask for. The
// rails and the spawn labels were on by default once.
check("every debug overlay starts off",
      TOGGLES.filter((t) => t.kind === "debug").every((t) => !t.on),
      TOGGLES.filter((t) => t.kind === "debug" && t.on).map((t) => t.name).join(", "));
check("...and so does every debug aid",
      TOGGLES.filter((t) => t.kind === "aid").every((t) => !t.on));

// The script and the feed are tabs, and a tab that is not showing renders
// nothing -- so they are rendered here the way the tab would.
const tree = renderIn(projection(), createElement(Tree));
check("the script tab has its filter and its tree",
      tree.includes('id="tree-filter"') && tree.includes('id="tree"'));

// Step 28. The feed keyed on the array index over a `slice(-400)` window, so
// past the cap every push shifted every index by one and React rewrote all
// four hundred rows' text to add one at the bottom.
//
// **React does not render keys**, so the markup cannot show which one is used.
// What the markup does show is that both rows reach the page, and the key
// itself is read from the source, for the same reason the boundary nesting
// below is: it is a fact about the source that the output does not carry.
const feed = renderIn(projection(), createElement(Feed));
check("every feed row reaches the page",
      (feed.match(/class="fe /g) ?? []).length === 2
      && feed.includes("cam_play") && feed.includes("wait_frames"),
      "a row in the projection did not render");
const FEED = join(process.cwd(), "src", "ui", "panels", "Feed.tsx");
let feedSrc = "";
try { feedSrc = readFileSync(FEED, "utf8"); }
catch { check("Feed.tsx is readable", false, `not found at ${FEED}`); }
check("and is keyed on its own seq, not on where it happens to sit",
      feedSrc.includes("key={e.seq}") && !/key=\{i\}/.test(feedSrc),
      "an index key over a capped window renames every row on every push");

// A boundary renders no element of its own while the region under it is
// healthy, and nothing may come between `#viewport` and the canvas: a wrapper
// there would also be a boundary able to unmount it.
check("nothing stands between #viewport and its canvas",
      /id="viewport"[^>]*>\s*<canvas id="view"/.test(warm),
      "a boundary that wraps the canvas in an element of its own would also "
      + "be a boundary that can unmount it");

console.log("\nEverything inside #viewport is React's:\n");

// `hud/` built `.hud-layer` and its three divs with `document.createElement`
// and appended them here once, and `render/` did the same with `.crosshair`,
// so the element React renders held five children React had never heard of.
// They are rendered here now and handed to the layers through `UiHost`. None
// of them carries an id, so `web/tools/repo/player_dom.ts` cannot see them and this
// is the only check there is that they exist at all.
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
  // rest of the viewport paints over it; the crosshair is last.
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
// is rendered, and the layers stopped writing it.
check("with no projection there are no toggles, so both are hidden",
      tagOf(cold, "hud-layer").includes("hidden")
      && tagOf(cold, "crosshair").includes("hidden"));
check("and with one, the hud layer follows its toggle and the crosshair is up",
      TOGGLE_DEFAULTS.hud
      && !tagOf(warm, "hud-layer").includes("hidden")
      && !tagOf(warm, "crosshair").includes("hidden"),
      `hud-layer=${tagOf(warm, "hud-layer")} crosshair=${tagOf(warm, "crosshair")}`);
// There is no Shoot toggle: shooting is what the game is. It was off by
// default once, and off it took the live-enemy gates with it -- see the note
// at the top of `render/shooting.ts`.
check("...and no toggle named shoot survives anywhere in the table",
      !(("shoot" as string) in TOGGLE_DEFAULTS));

console.log("\nThe store reaches the panels by context:\n");

// The failure mode that replaces a missing prop is a component that
// subscribes to a store nothing publishes to and sits there permanently
// empty, with nothing anywhere saying why -- so the context has no working
// default and this is what it does instead.
let outside: unknown = null;
try { renderToStaticMarkup(createElement(SoundButton)); }
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
try {
  renderIn(badHud, createElement(DebugSidebar, { onClose: () => {} }));
} catch (e) { thrown = e; }
check("a slice a panel cannot read does throw out of that panel",
      thrown !== null,
      "the rest of this section is only meaningful if this still throws");

// **This file cannot see the recovery, and must not pretend to.**
// `renderToStaticMarkup` does not invoke error boundaries: React only runs
// `getDerivedStateFromError` in a client render, and a throw during server
// rendering propagates to the caller — which is what the check above just
// measured. What it needs is a client render, which needs a DOM; until one
// exists, what is testable is below: the pieces React drives, driven
// directly, and the shape of the tree they sit in.

console.log("\nThe fallback, through the two methods React calls:\n");

/** React's own contract: derive the state, then render. Nothing is stubbed. */
function fallback(label: string, error: unknown): string {
  const b = new ErrorBoundary({ label, children: null });
  b.state = ErrorBoundary.getDerivedStateFromError(error);
  return renderToStaticMarkup(b.render());
}

const fb = fallback("The debug sidebar", new Error("rows is not iterable"));
check("it names the region, so you know which part died",
      fb.includes("The debug sidebar"));
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
      fallback("The debug sidebar", null).includes("errbox"),
      "throw null read back as healthy");

let reported: unknown[] = [];
const boundary = new ErrorBoundary({
  label: "The game overlay", children: null,
  onError: (...args) => { reported = args; },
});
boundary.componentDidCatch(new Error("nope"), { componentStack: "" });
check("and componentDidCatch reports the label with the error",
      reported[0] === "The game overlay"
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
      src.filter((l) => /^\s*<ErrorBoundary\b/.test(l)).length === 4,
      "the root, the loading screen, the game overlay and the debug sidebar");

// Every debug group must be rendered by exactly one panel.
//
// The names live in `ui/projection.ts` and the panels in
// `ui/panels/DebugSidebar.tsx`, and nothing but this ties the two together:
// routing a toggle to a group that no panel draws compiles, renders, and
// silently removes the control from the page. That happened to `actors` --
// four toggles and two readouts, `boxes` among them, unreachable -- and no
// check in this repository could see it.
console.log("\nEvery debug group has a panel:\n");
{
  const src = readFileSync(join(process.cwd(), "src", "ui", "panels",
                                "DebugSidebar.tsx"), "utf8");
  const declared = readFileSync(join(process.cwd(), "src", "ui", "projection.ts"), "utf8")
    .match(/export type DebugGroupName =([^;]*);/)?.[1] ?? "";
  const names = [...declared.matchAll(/"([a-z]+)"/g)].map((m) => m[1]);
  check("the group names were found at all", names.length > 0, declared);
  for (const g of names) {
    const n = [...src.matchAll(new RegExp(`<DebugGroup group="${g}"`, "g"))].length;
    check(`${g} is rendered by exactly one panel`, n === 1, `found ${n}`);
  }
}

// Every preference gets its own `localStorage` key, and the reason is a
// property a round-trip test would miss: the old scheme read one blob, spread
// it, and wrote it back, so a write from *another tab* between the read and
// the write was undone. What makes that impossible is that a write touches
// exactly one key and reads none -- which is what is asserted here, by
// watching the stub rather than by reading a value back.
console.log("\nOne key per preference:\n");
{
  const writes: [string, string][] = [];
  const store = new Map<string, string>();
  (globalThis as unknown as { localStorage: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { writes.push([k, v]); store.set(k, v); },
  };

  writePersisted("panel-a", true);
  writePersisted("panel-b", false);
  check("a write touches one key, named for the preference",
        writes.length === 2 && writes[0][0] === "hod2.ui.panel-a"
        && writes[1][0] === "hod2.ui.panel-b",
        writes.map(([k]) => k).join(", "));
  check("...and no key is written twice, so no write can undo another",
        new Set(writes.map(([k]) => k)).size === writes.length);
  check("what went in comes back",
        readPersisted("panel-a") === true
        && readPersisted("panel-b") === false);
  check("and an unset one is undefined, not a default guessed here",
        readPersisted("panel-c") === undefined);

  // Folds saved under the single blob keep working until each one next moves.
  store.set("hod2.ui", JSON.stringify({ "panel-d": true }));
  check("the old single blob is still read as a fallback",
        readPersisted("panel-d") === true);

  // The debug sidebar's open state is one of these keys, and it is how a
  // harness opens the sidebar before the page has loaded -- see
  // `tools/lib/player.mjs`. With it set, the page renders the sidebar.
  store.set("hod2.ui.debug", "true");
  const opened = render(projection());
  check("with `hod2.ui.debug` set the page opens with the debug sidebar",
        opened.includes('id="debug"') && opened.includes('class="debug-open"')
        && !inOrder(opened, ["stagearea", "debug"]),
        "the harnesses read the panels, and open the sidebar through this key");

  // The 4:3 switch is in the Scene panel with the light, fog and filter --
  // rendered once the panel's fold is open, which is the same key scheme.
  store.set("hod2.ui.panel-scene", "true");
  const scene = renderIn({ ...projection(), pillarbox: true },
                         createElement(DebugSidebar, { onClose: () => {} }));
  check("the Scene panel has the 4:3 switch, and it follows the projection",
        /<input type="checkbox" checked=""\/>\s*4:3 frame/.test(scene),
        scene.slice(scene.indexOf("view-settings"), scene.indexOf("view-settings") + 400));
  const ratioSel = /<label class="view-ratio"[^]*?<\/label>/.exec(scene)?.[0] ?? "";
  check("...and the Resolution select, offering the projection's steps",
        (ratioSel.match(/<option /g) ?? []).length === 3
        && /<option value="1" selected="">1×/.test(ratioSel), ratioSel);

  // An old save held every overlay's default as if chosen: every setting was
  // written whenever one moved. Read back as a choice, `rails: true` would put
  // the camera line straight back over the game. So a save from before
  // version 2 keeps its game switches and forgets its overlay ones.
  (globalThis as unknown as { window: unknown }).window = globalThis;
  store.set("hod2.viewPrefs",
            JSON.stringify({ toggles: { rails: true, spawns: true, sky: false } }));
  const old = readViewPrefs().toggles;
  check("an old save's overlays are forgotten and its game switches kept",
        !("rails" in old) && !("spawns" in old) && old.sky === false,
        JSON.stringify(old));
  store.set("hod2.viewPrefs",
            JSON.stringify({ v: 2, toggles: { rails: true } }));
  check("...and a new save's overlays are a choice, and kept",
        readViewPrefs().toggles.rails === true);
  // The 4:3 switch's default is the device's since version 3, so a pre-3
  // `false` -- written whenever anything moved -- is not a choice and must not
  // keep a phone filling the screen. A pre-3 `true` could only be chosen.
  store.set("hod2.viewPrefs",
            JSON.stringify({ v: 2, toggles: {}, fourByThree: false }));
  check("a pre-3 save's 4:3 false is dropped, so the device decides",
        readViewPrefs().fourByThree === undefined);
  store.set("hod2.viewPrefs",
            JSON.stringify({ v: 2, toggles: {}, fourByThree: true }));
  check("...and its true is kept, being a choice",
        readViewPrefs().fourByThree === true);
  store.set("hod2.viewPrefs",
            JSON.stringify({ v: 3, toggles: {}, fourByThree: false,
                             pixelRatio: 1.5 }));
  const v3 = readViewPrefs();
  // The lighting's default is "+ scene light" since version 4; a pre-4 "unlit"
  // is the old default, written whenever anything moved.
  store.set("hod2.viewPrefs",
            JSON.stringify({ v: 3, toggles: {}, lightMode: "unlit" }));
  check("a pre-4 save's unlit is dropped, so scene light is the default",
        readViewPrefs().lightMode === undefined);
  store.set("hod2.viewPrefs",
            JSON.stringify({ v: 3, toggles: {}, lightMode: "scene" }));
  check("...and its scene light is kept, being a choice",
        readViewPrefs().lightMode === "scene");
  // Anisotropic is the default since version 5; a pre-5 "asset" is the old one.
  store.set("hod2.viewPrefs",
            JSON.stringify({ v: 4, toggles: {}, filterMode: "asset" }));
  check("a pre-5 save's filter as the game is dropped, so anisotropic is the default",
        readViewPrefs().filterMode === undefined);
  store.set("hod2.viewPrefs",
            JSON.stringify({ v: 4, toggles: {}, filterMode: "nearest" }));
  check("...and any other filter is kept, being a choice",
        readViewPrefs().filterMode === "nearest");
  // The muzzle flash is on by default since version 6, and a switch at its
  // default is not written at all -- so no default is pinned by a save again.
  store.set("hod2.viewPrefs",
            JSON.stringify({ v: 5, toggles: { muzzle: false, sky: false } }));
  const pre6 = readViewPrefs().toggles;
  check("a pre-6 save's muzzle off is dropped, and its other switches kept",
        !("muzzle" in pre6) && pre6.sky === false, JSON.stringify(pre6));
  writeViewPrefs({ toggles: { ...TOGGLE_DEFAULTS, sky: false } });
  const written = JSON.parse(store.get("hod2.viewPrefs") as string);
  check("...and a save writes only the switches away from their defaults",
        JSON.stringify(written.toggles) === JSON.stringify({ sky: false }),
        JSON.stringify(written.toggles));
  check("...and a version-3 choice either way is kept, the resolution too",
        v3.fourByThree === false && v3.pixelRatio === 1.5, JSON.stringify(v3));

  // A browser set to block site data throws on the accessor. A layout
  // preference is not worth a blank page.
  (globalThis as unknown as { localStorage: unknown }).localStorage = {
    getItem: () => { throw new Error("blocked"); },
    setItem: () => { throw new Error("blocked"); },
  };
  let threw = false;
  try {
    writePersisted("panel-a", true);
    check("a blocked store reads as unset rather than throwing",
          readPersisted("panel-a") === undefined);
  } catch {
    threw = true;
  }
  check("...and neither call escapes", !threw);
}

// The branch pause is a debug aid: the engine goes the moment the steps run
// out, so the switch that holds there has to start off, has to say what it
// is, and has to be where the other switches are -- the route panel's group,
// drawn from the one table.
console.log("\nThe branch pause is a debug aid, off by default:\n");
{
  const spec = TOGGLES.find((t) => t.name === "branchPause");
  check("it is a row of the toggle table, in the route group, as an aid",
        spec?.kind === "aid" && spec.group === "route", JSON.stringify(spec));
  check("...and it starts off, which is the engine",
        TOGGLE_DEFAULTS.branchPause === false);
  const store = new UiStore();
  store.publish(projection());
  const html = renderToStaticMarkup(createElement(
    StoreContext.Provider, { value: store },
    createElement(DebugGroup, { group: "route" })));
  const box = /<label[^>]*>\s*<input type="checkbox"([^>]*)\/>\s*Pause at branches/
    .exec(html);
  check("the route group draws it as a checkbox", box !== null, html);
  check("...unchecked", box !== null && !/checked/.test(box[1]), box?.[1]);
  check("...under its own heading, apart from the game and the overlays",
        html.includes("grp-aid") && html.includes("debug aids"));
}

// Three handlers answer keys -- `app/main.ts`, `render/freeroam.ts` and
// `ui/App.tsx` -- and `ui/shortcuts.ts` is the one list of what they do, which
// the `?` dialog draws. A list of keys drifts the moment a handler grows a
// branch nobody added a row for, so the handlers' own source is read here and
// held to the table in both directions.
console.log("\nThe keys:\n");
{
  const src = (...p: string[]) => {
    try { return readFileSync(join(process.cwd(), "src", ...p), "utf8"); }
    catch { return ""; }
  };
  const codesIn = (text: string, re: RegExp) =>
    new Set([...text.matchAll(re)].map((m) => m[1]));
  const rows = SHORTCUT_GROUPS.flatMap((g) => g.rows);
  const listed = (by: string) =>
    new Set(rows.filter((r) => r.by === by).flatMap((r) => r.codes));
  const same = (a: Set<string>, b: Set<string>) =>
    a.size === b.size && [...a].every((x) => b.has(x));
  const show = (a: Set<string>, b: Set<string>) =>
    `bound ${[...a].sort().join(" ")} / listed ${[...b].sort().join(" ")}`;

  const main = src("app", "main.ts");
  const app = codesIn(main, /e\.code === "(\w+)"/g);
  check("app/main.ts binds exactly the keys the table gives it",
        main !== "" && same(app, listed("app")), show(app, listed("app")));

  const fly = src("render", "freeroam.ts");
  const moveBlock = /const MOVE_KEYS[^{]*\{([^}]*)\}/.exec(fly)?.[1] ?? "";
  const roam = new Set([...codesIn(moveBlock, /(Key[A-Z]):/g),
                        ...codesIn(fly, /keys\.has\("(\w+)"\)/g)]);
  check("free roam flies on exactly the keys the table gives it",
        roam.size > 0 && same(roam, listed("freeRoam")),
        show(roam, listed("freeRoam")));

  const page = src("ui", "App.tsx");
  const ui = new Set([...codesIn(page, /e\.code === "(\w+)"/g),
                      ...TOGGLES.flatMap((t) => (t.key ? [t.key] : []))]);
  check("ui/App.tsx answers exactly the keys the table gives it",
        page !== "" && same(ui, listed("ui")), show(ui, listed("ui")));

  // One owner a key, with no exception. There was one: S was the pad's Start
  // to the game and back to free roam. START is Enter now, which is the key
  // the skip already had -- the exe reads the one button for both.
  const owners = new Map<string, Set<string>>();
  for (const r of rows) {
    for (const c of r.codes) owners.set(c, (owners.get(c) ?? new Set()).add(r.by));
  }
  const shared = [...owners].filter(([, o]) => o.size > 1);
  check("no key has two owners", shared.length === 0,
        shared.map(([c, o]) => `${c}: ${[...o].join("+")}`).join(", "));
  const twice = [...new Set(rows.flatMap((r) => r.codes)
    .filter((c, i, all) => all.indexOf(c) !== i))];
  check("...and no key is listed twice", twice.length === 0, twice.join(", "));
  const start = rows.find((r) => r.codes.includes("Enter"));
  check("Enter is START: it continues as well as skipping",
        start?.by === "app" && /continue/i.test(start.what)
        && /skip/i.test(start.what), JSON.stringify(start));
  const sOwners = [...(owners.get("KeyS") ?? [])];
  check("...and S is free roam's alone again",
        sOwners.length === 1 && sOwners[0] === "freeRoam", sOwners.join("+"));
  check("Z is bound by nothing: tools/pacing.mjs presses it for that",
        !owners.has("KeyZ"));
  check("only overlays have keys",
        TOGGLES.every((t) => !t.key || t.kind === "debug"),
        TOGGLES.filter((t) => t.key && t.kind !== "debug").map((t) => t.name).join(", "));
  check("the actor bounding boxes have one",
        TOGGLES.find((t) => t.name === "boxes")?.key === "KeyB");

  const keyed = TOGGLES.filter((t) => t.key);
  const dialog = renderIn(projection(), createElement(ShortcutsDialog,
                                                      { onClose: () => {} }));
  check("the ? dialog is a dialog, under the id the harnesses reach it by",
        dialog.includes('id="shortcuts"') && dialog.includes('role="dialog"'));
  check("...and lists every overlay key with its label",
        keyed.every((t) => dialog.includes(`<kbd>${keyCap(t.key as string)}</kbd>`)
                           && dialog.includes(t.label)));
  check("...each one saying it is off, as they all start",
        (dialog.match(/class="state"/g) ?? []).length === keyed.length
        && !dialog.includes('class="state on"'));
  const boxesOn = renderIn({ ...projection(),
                             toggles: { ...TOGGLE_DEFAULTS, boxes: true } },
                           createElement(ShortcutsDialog, { onClose: () => {} }));
  check("...and one that is on saying so",
        (boxesOn.match(/class="state on"/g) ?? []).length === 1);

  const withKeys = renderIn(projection(), createElement(CrumbMenu, {
    debugOpen: false, onToggleDebug: () => {}, onShowKeys: () => {},
    onClose: () => {} }));
  check("the menu offers the list, to a mouse",
        withKeys.includes('class="keys-open only-fine"'));
  const actorsGroup = renderIn(projection(),
                               createElement(DebugGroup, { group: "actors" }));
  check("an overlay's switch shows its key",
        actorsGroup.includes('<kbd class="key-hint">B</kbd>'));
}

// The letterbox is drawn from the bars the engine's routine recorded, not
// from a state. These are the numbers `HudDrawShutterState` draws: shut at
// +-0.35, a slide at 0.35 + counter * 0.0025, and the blackout's one bar
// scaled 8 -- against a 41.1 degree frustum's half-height of 0.3748.
console.log("\nThe shutter bars, as the HUD layer covers the frame:\n");
{
  const near = (a: number, b: number) => Math.abs(a - b) < 0.05;
  const shut = shutterCover([{ y: 0.35, sy: 1 }, { y: -0.35, sy: 1 }]);
  check("shut bars cover a 10% band top and bottom",
        near(shut.top, 9.98) && near(shut.bottom, 9.98), JSON.stringify(shut));
  const none = shutterCover([]);
  check("no bars cover nothing", none.top === 0 && none.bottom === 0);
  const past = shutterCover([{ y: 0.35 + 30 * 0.0025, sy: 1 },
                             { y: -0.35 - 30 * 0.0025, sy: 1 }]);
  check("thirty frames into an open the bars have cleared the frame",
        past.top === 0 && past.bottom === 0, JSON.stringify(past));
  const half = shutterCover([{ y: 0.35 + 15 * 0.0025, sy: 1 },
                             { y: -0.35 - 15 * 0.0025, sy: 1 }]);
  check("...and fifteen in they are part-way, the same both sides",
        half.top > 0 && half.top < shut.top && half.top === half.bottom,
        JSON.stringify(half));
  const black = shutterCover([{ y: 0, sy: 8 }]);
  check("the blackout covers all of it", black.top === 100
        && black.bottom === 100, JSON.stringify(black));

  // ...and "the frame" is the rendered view. Pillarboxed in a window taller
  // than 4:3 the canvas is a centred 4:3 box shorter than the viewport, and
  // bars measured off the viewport covered its black margin instead.
  const frameOf = (boxed: boolean) => {
    const html = render({ ...projection(), pillarbox: boxed });
    const layer = html.slice(html.indexOf('class="hud-layer"'));
    const m = /<div class="(hud-frame[^"]*)">\s*<div class="shutter shutter-top"/
      .exec(layer);
    return m?.[1] ?? null;
  };
  check("pillarboxed, the bars sit in the 4:3 frame box",
        frameOf(true) === "hud-frame boxed", String(frameOf(true)));
  check("...and unboxed, in a frame that is the whole viewport",
        frameOf(false) === "hud-frame", String(frameOf(false)));
}

// The FPS badge: the pacer's frame times, summarised, and the one line that
// shows them.
console.log("\nThe FPS badge:\n");
{
  const { FrameStats } = await import("../src/app/framestats");
  const { FpsBadge } = await import("../src/ui/panels/FpsBadge");
  const steady = new FrameStats();
  for (let i = 0; i <= 60; i++) steady.add(1000 + i * (1000 / 60), 3);
  const a = steady.read(1000 + 60 * (1000 / 60), null);
  check("sixty even frames: 60 fps, 16.7 ms low, mean and high, work 3",
        a?.fps === 60 && a.frame.every((v) => v === 16.7) && a.work[0] === 3
        && a.level === "ok", JSON.stringify(a));
  const hitch = new FrameStats();
  let t = 0;
  for (let i = 0; i <= 60; i++) { t += i === 30 ? 60 : 1000 / 60; hitch.add(t, 4); }
  const b = hitch.read(t, 1.25);
  check("...one 60 ms frame among them: the high says so, and the badge is bad",
        b?.frame[2] === 60 && b.level === "bad" && b.net === 1.25, JSON.stringify(b));
  const slept = new FrameStats();
  slept.add(0, 1);
  slept.add(16, 1);
  slept.add(5000, 1);
  slept.add(5016, 1);
  const c = slept.read(5016, null);
  check("...and a gap the loop slept through is not a slow frame",
        c?.frame[2] === 16, JSON.stringify(c));
  const html = renderIn({ ...projection(), fps: a }, createElement(FpsBadge));
  check("the badge shows fps and the low/mean/high line",
        html.includes('id="fps-badge"') && />60</.test(html) && html.includes("16.7/16.7/16.7"), html);
  check("...and nothing while it is off",
        !renderIn(projection(), createElement(FpsBadge)).includes("fps-badge"));
}

// The join offer is read off the player's shell, as the game's own credit
// line is: player out, on the play screen, furniture bit 2 up.
console.log("\nThe join offer, from the shell:\n");
{
  const { joinProjection } = await import("../src/app/projection/chrome");
  const { G, AppState, PlayerState } = await import("../src/game/globals");
  const was = { app: G.g_app_state, p: [...G.g_player_state], f: G.g_screen_furniture_flags,
                free: G.g_free_play, credits: [...G.g_credits] };
  G.g_app_state = AppState.InPlay;
  G.g_player_state[1] = PlayerState.Out;
  G.g_screen_furniture_flags = 2;
  G.g_free_play = 1;
  const offer = joinProjection(1);
  check("player 2 out on the play screen, credit line up: Join, pressable",
        offer?.label === "Join" && offer.canJoin, JSON.stringify(offer));
  G.g_player_state[1] = PlayerState.InPlay;
  check("...and none once player 2 is in", joinProjection(1) === null);
  G.g_player_state[1] = PlayerState.Out;
  G.g_screen_furniture_flags = 0;
  check("...nor while the game is not drawing PRESS START", joinProjection(1) === null);
  G.g_app_state = was.app;
  G.g_player_state.splice(0, was.p.length, ...was.p);
  G.g_screen_furniture_flags = was.f;
  G.g_free_play = was.free;
  G.g_credits.splice(0, was.credits.length, ...was.credits);
}

// Two tabs on a Mac without Local Network access sat on "Finding a way
// through both networks" for good: ICE had one pair to try and it never
// answered. The lobby card now says what the search found, and once it has
// run long enough to be stuck, why.
console.log("\nnetplay: a connect that is not finishing says why");
{
  const { describePath, PATH_HINT_MS } = await import("../src/app/net/transport");
  const base: import("../src/app/net/transport").IcePath = {
    since: 0, local: { host: 1, srflx: 1 }, remote: { host: 1, srflx: 1 },
    localMdns: 1, remoteMdns: 1, pairs: 1, failed: 0, turn: 0, relayOnly: false,
  };
  const early = describePath(base, "checking", 2000);
  check("early on: what each end offered, and no verdict yet",
        /this end offered 1 host \(1 hidden as \.local\), 1 srflx/.test(early.line)
        && /1 pair tried/.test(early.line) && early.hint === null, early.line);
  const stuck = describePath(base, "checking", PATH_HINT_MS + 1).hint ?? "";
  check("stuck with both ends' addresses in hand: mDNS, Local Network, and no TURN",
        /\.local/.test(stuck) && /Local Network/.test(stuck) && /has none/.test(stuck), stuck);
  const why = (p: typeof base, ice = "checking") => describePath(p, ice, 9000).hint ?? "";
  check("nothing from the other end: the rendezvous",
        /Nothing has arrived/.test(why({ ...base, remote: {}, remoteMdns: 0 })));
  check("?relay=1 with no TURN server: says so",
        /\?relay=1/.test(why({ ...base, relayOnly: true, local: {} })));
  check("no STUN answer: outgoing UDP",
        /STUN/.test(why({ ...base, local: { host: 1 } })));
  check("connected, or not yet searching: no verdict",
        why(base, "connected") === "" && why({ ...base, since: NaN }, "new") === "");
}

// A stage load's progress: the meter's figures, the bar on the loading
// screen, and the same bar on the "turn your phone" screen, which covers the
// loading screen while a phone is upright and the stage loads under it.
console.log("\nThe loading bar:\n");
{
  const { LoadMeter } = await import("../src/app/load_meter");
  const { LoadingOverlay } = await import("../src/ui/panels/Viewport");
  const { RotateHint } = await import("../src/ui/panels/Overlays");
  type Shown = NonNullable<UiProjection["loading"]>;
  const seen: Shown[] = [];
  const meter = new LoadMeter("Loading stage 1", (s) => seen.push(s));
  meter.begin("download");
  meter.bytes(1e6, 0);
  const unsized = seen[seen.length - 1];
  meter.bytes(25.6e6, 51.2e6);
  const half = seen[seen.length - 1];
  check("the download counts megabytes, and of how many once every file has said",
        unsized.detail === "Downloading · 1.0 MB" && half.detail === "Downloading · 25.6 of 51.2 MB"
        && half.progress === 0.25, JSON.stringify([unsized, half]));
  meter.begin("unpack");
  const unpack = seen[seen.length - 1];
  meter.begin("build");
  meter.begin("shaders");
  check("...then the parse, the build and the shaders, in order, never backwards",
        unpack.progress === 0.5 && unpack.detail === "Unpacking the stage"
        && seen.every((x, i) => i === 0 || (x.progress ?? 0) >= (seen[i - 1].progress ?? 0)),
        JSON.stringify(seen.map((x) => x.progress)));
  const html = renderIn({ ...projection(), loading: half }, createElement(LoadingOverlay));
  check("the loading screen shows the title, a bar at 25% and the figures, and no spinner",
        html.includes('id="loading-text"') && html.includes("Loading stage 1")
        && html.includes('aria-valuenow="25"') && html.includes("25.6 of 51.2 MB · 25%")
        && !html.includes("spinner"), html);
  const boot = renderIn(null, createElement(LoadingOverlay));
  check("...and before there is a projection, the spinner and no bar",
        boot.includes("spinner") && !boot.includes("progressbar"), boot);
  const upright = renderIn({ ...projection(), loading: half }, createElement(RotateHint));
  check("the turn-your-phone screen shows the same bar while the stage loads under it",
        upright.includes("Turn your phone sideways") && upright.includes('aria-valuenow="25"'),
        upright);
  const ready = renderIn(projection(), createElement(RotateHint));
  check("...and says it is ready once it has",
        ready.includes("Ready when you are") && !ready.includes("progressbar"), ready);
}

// Fullscreen on Apple's devices is the Home Screen's, never the browser's:
// WebKit's anti-phishing check in element fullscreen reads rapid taps as
// typing and stops the page with a modal (`app/device.ts`, `appleTouch`).
console.log("\nThe Home Screen, not fullscreen, on an iPhone or an iPad:\n");
{
  const { appleTouch } = await import("../src/app/device");
  const was = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const as = (userAgent: string, maxTouchPoints: number): boolean => {
    Object.defineProperty(globalThis, "navigator",
                          { value: { userAgent, maxTouchPoints }, configurable: true });
    return appleTouch();
  };
  const IPAD = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 "
    + "(KHTML, like Gecko) Version/27.0 Safari/605.1.15";
  const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 "
    + "(KHTML, like Gecko) Version/27.0 Mobile/15E148 Safari/604.1";
  const ANDROID = "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) "
    + "Chrome/140.0 Mobile Safari/537.36";
  const found = { ipad: as(IPAD, 5), iphone: as(IPHONE, 5), mac: as(IPAD, 0),
                  android: as(ANDROID, 5) };
  if (was) Object.defineProperty(globalThis, "navigator", was);
  check("an iPad saying it is a Mac, and an iPhone, are Apple touch; a Mac and Android are not",
        found.ipad && found.iphone && !found.mac && !found.android, JSON.stringify(found));
  const hint = renderIn({ ...projection(), homeScreenHint: true }, createElement(PauseScreen));
  check("the start screen tells an iPhone or an iPad how to have it full screen",
        hint.includes("Add to Home Screen"), hint);
  check("...and nothing else",
        !renderIn(projection(), createElement(PauseScreen)).includes("Home Screen"));
}

// The reticles are the game's crosshair sprites, and whether each is there
// is the game's `HudDrawCrosshair` for that player's device: a mouse has one,
// a finger -- the light gun -- none (`app/device.ts`).
console.log("\nThe crosshairs are the game's sprites, and a finger has none:\n");
{
  const { pointerInputMode, initialInputMode } = await import("../src/app/device");
  const { InputMode } = await import("../src/game/input_mode");
  check("a mouse is the mouse and keyboard (6), a finger the light gun (0xD), "
        + "a pen neither",
        pointerInputMode("mouse") === InputMode.MouseKeyboard
        && pointerInputMode("touch") === InputMode.LightGun1
        && pointerInputMode("pen") === null,
        `${pointerInputMode("mouse")} ${pointerInputMode("touch")} ${pointerInputMode("pen")}`);
  const was = Object.getOwnPropertyDescriptor(globalThis, "window");
  const withPointer = (fine: boolean) => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { matchMedia: (q: string) => ({ matches: q === "(any-pointer: fine)" && fine }) },
    });
    return initialInputMode();
  };
  const desk = withPointer(true);
  const phone = withPointer(false);
  if (was) Object.defineProperty(globalThis, "window", was);
  else delete (globalThis as { window?: unknown }).window;
  check("before any press: the mouse where there is a fine pointer, the "
        + "light gun on a device with none -- a phone never shows a reticle",
        desk === InputMode.MouseKeyboard && phone === InputMode.LightGun1,
        `${desk} ${phone}`);

  const SPRITE = { url: "data:image/png;base64,QUFB", w: 53, h: 53 };
  const drawn = viewportOf(render({ ...projection(), crosshairSprite: SPRITE }));
  const tag = tagOf(drawn, "crosshair sprite");
  check("the game drew it: the reticle is the Sight Graphic's sprite, at the "
        + "size the exe's quad has on the frame, centred on the pointer",
        tag !== "" && !tag.includes("hidden") && tag.includes(SPRITE.url)
        && tag.includes("width:53px") && tag.includes("height:53px")
        && tag.includes("margin-left:-26.5px") && tag.includes("margin-top:-26.5px"),
        tag);
  const gone = viewportOf(render({ ...projection(), crosshair: false,
                                   crosshairSprite: SPRITE }));
  check("the game drew none (a finger, the light gun): the reticle is hidden",
        tagOf(gone, "crosshair sprite").includes("hidden"),
        tagOf(gone, "crosshair sprite"));
  check("...and with no sprite in the bundle the ring stands in",
        tagOf(viewportOf(render(projection())), "crosshair") !== "");

  const P2 = { url: "data:image/png;base64,QkJC", w: 40, h: 40 };
  const peer = viewportOf(render({ ...projection(),
    netPeer: { x: 300, y: 200, player: 2, sprite: P2 } }));
  const peerTag = tagOf(peer, "crosshair peer sprite p2");
  check("the other player's reticle is their sprite -- player 2's, the blue "
        + "set -- where the game says they aim, and no ring's label",
        peerTag.includes(P2.url) && peerTag.includes("left:300px")
        && peerTag.includes("top:200px") && peerTag.includes("width:40px")
        && !peer.includes("<span>P2</span>"),
        peerTag);
  check("...and none at all when the game drew theirs none -- a peer on a "
        + "finger", !viewportOf(render({ ...projection(), netPeer: null }))
          .includes("crosshair peer"));
  const ring = viewportOf(render({ ...projection(),
    netPeer: { x: 10, y: 20, player: 1, sprite: null } }));
  check("...the ring and its label only for a bundle without the sprites",
        tagOf(ring, "crosshair peer p1") !== "" && ring.includes("<span>P1</span>"),
        tagOf(ring, "crosshair peer p1"));
}

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
