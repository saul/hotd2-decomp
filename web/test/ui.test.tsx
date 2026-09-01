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
 * Run with `npm run test:ui`.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { App } from "../src/ui/App";
import { UiStore } from "../src/ui/store";
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
    tree: { blocks: [{ index: 0, kind: "next", targets: [1], stepCount: 2,
                       title: "block 0", steps: [] }] },
    minimap: { entry: 0, nodes: [{ index: 0, kind: "next", next: [1] }] },
    current: { block: 0, step: 1, op: 0 },
    feed: [{ block: 0, step: 1, opIndex: 0, at: "0.1.0", name: "cam_play",
             summary: "", note: "", cat: "camera", status: "ported",
             title: "" }],
    inspector: "cam_play",
    hudRows: [["mode", "play"]],
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

console.log("\nThe chrome renders before there is a projection:\n");

const cold = render(null);
check("every element the grid places is there, in source order",
      !inOrder(cold, GRID), inOrder(cold, GRID));
check("and the loading overlay is up",
      cold.includes('id="loading"') && cold.includes("loading bundle"));
check("and the panels that need a projection are not",
      !cold.includes('id="panel-wait"') && !cold.includes('id="hud"'));

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

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
