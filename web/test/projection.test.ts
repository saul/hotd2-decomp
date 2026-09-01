/**
 * The projection keeps the references it can.
 *
 * This is what makes `memo` the diff. Every panel in `ui/` is memoised on a
 * slice of the projection, so a slice that comes back as a *new object* with
 * identical contents re-renders a panel for nothing — and the whole of step 18
 * is the claim that it does not.
 *
 * It is a property no other check here can see. `tsc` cannot: the types are
 * the same either way. `test:ui` cannot: the markup is the same either way.
 * The only symptom is that the player gets slower, sixty times a second, in a
 * way nobody attributes to the field that was added six weeks earlier without
 * a stable reference behind it. That is exactly the shape of the bug this
 * replaced — `projectionKey`'s `JSON.stringify` was one string compare
 * standing in for a diff, and one field moving re-rendered everything.
 *
 * Run with `npm run test:projection`.
 */
import { equal, stabilise } from "../src/app/projection/stable";

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  if (ok) console.log(`  ok    ${name}`);
  else { failures++; console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`); }
}

// -- what `equal` has to get right -----------------------------------------

console.log("\nStructural equality over plain data:\n");

check("primitives", equal(1, 1) && equal("a", "a") && equal(null, null)
      && !equal(1, 2) && !equal(null, undefined));
// `Object.is` splits from `===` on exactly two values, and this wants its
// answer on both. A `NaN` that stayed `NaN` is not a change, which `===`
// would have called one. `0` becoming `-0` *is* reported as a change, which
// `===` would have missed -- no panel can see the difference, so the cost is
// one needless re-render of whichever slice holds it, and the alternative is
// a leaf comparison that disagrees with the one the sharing walk uses. Both
// are pinned here because both are load-bearing and neither is obvious.
check("NaN is equal to itself", equal(NaN, NaN));
check("and -0 is a change, because Object.is says so", !equal(0, -0));
check("arrays, by length then by element",
      equal([1, [2, 3]], [1, [2, 3]]) && !equal([1, 2], [1, 2, 3]));
check("objects, by key set then by value",
      equal({ a: 1, b: { c: 2 } }, { b: { c: 2 }, a: 1 })
      && !equal({ a: 1 }, { a: 1, b: 2 })
      && !equal({ a: 1, b: 2 }, { a: 1 }));
check("an object is not an array", !equal({ 0: 1, length: 1 }, [1]));
// `equal` is now `share` asked whether it handed `prev` straight back, and the
// leaves are settled with `Object.is` all the way down rather than only at the
// top. A `NaN` nested inside a structure has to survive that.
check("NaN is equal to itself at depth",
      equal({ a: [NaN] }, { a: [NaN] }));

// -- what `stabilise` has to get right -------------------------------------

console.log("\nAnd the sharing built on it:\n");

const prev = {
  stage: 2,
  wait: { sub: "0x3B", lines: [{ text: "3 alive" }] },
  hudRows: [["mode", "play"]],
  tree: { blocks: [] },
};
type Shape = typeof prev;

const same = stabilise<Shape>(prev, {
  stage: 2,
  wait: { sub: "0x3B", lines: [{ text: "3 alive" }] },
  hudRows: [["mode", "play"]],
  tree: prev.tree,
});
check("an identical projection is the previous object", same === prev,
      "the store's `publish` decides on this identity alone");

const moved = stabilise<Shape>(prev, {
  stage: 2,
  wait: { sub: "0x3C", lines: [{ text: "1 alive" }] },
  hudRows: [["mode", "play"]],
  tree: prev.tree,
});
check("one slice moving gives a new root", moved !== prev);
check("...and only that slice is new", moved.wait !== prev.wait);
check("...while every other slice is the object it was",
      moved.hudRows === prev.hudRows && moved.tree === prev.tree,
      "a panel whose slice did not change would re-render for nothing");

// The tree is thousands of rows held by reference. If `stabilise` ever walks
// it on an unchanged frame the cost of the old `JSON.stringify` is back.
let walked = 0;
const counting = { get blocks() { walked++; return []; } };
stabilise({ ...prev, tree: counting } as unknown as Shape,
          { ...prev, tree: counting } as unknown as Shape);
check("an unmoved reference is settled without a walk", walked === 0,
      `the tree was read ${walked} times on a frame it did not change`);

check("no previous value is the new value", stabilise(null, prev) === prev);

// -- sharing below the top level -------------------------------------------

// This is the half that a slice-granular version got wrong. One actor of forty
// moving made `actorPanel` new, and every group inside it new with it, so a
// `memo` on a group or a row had nothing to bail on. Sharing has to survive a
// parent that genuinely changed.

console.log("\nAnd below the top level, which is where `memo` lives:\n");

const group = (cls: number, count: number, alive: number) => ({
  cls,
  name: `0x${cls.toString(16)}`,
  count,
  lines: [{ text: `${alive} alive` }],
});

const deepPrev = {
  stage: 2,
  actorPanel: {
    sub: "4 classes",
    groups: [group(0x30, 3, 3), group(0x31, 1, 1),
             group(0x32, 2, 2), group(0x33, 5, 4)],
  },
  tree: { blocks: [] },
};
type Deep = typeof deepPrev;

// Every group below is a freshly allocated object, as the real builder makes
// them; only the last one differs in content, and only in `count`.
const oneMoved = stabilise<Deep>(deepPrev, {
  stage: 2,
  actorPanel: {
    sub: "4 classes",
    groups: [group(0x30, 3, 3), group(0x31, 1, 1),
             group(0x32, 2, 2), group(0x33, 6, 4)],
  },
  tree: deepPrev.tree,
});

check("a slice that did change is a new object",
      oneMoved !== deepPrev && oneMoved.actorPanel !== deepPrev.actorPanel
      && oneMoved.actorPanel.groups !== deepPrev.actorPanel.groups);
check("...but its unchanged children keep their identity",
      oneMoved.actorPanel.groups[0] === deepPrev.actorPanel.groups[0]
      && oneMoved.actorPanel.groups[1] === deepPrev.actorPanel.groups[1]
      && oneMoved.actorPanel.groups[2] === deepPrev.actorPanel.groups[2],
      "three groups out of four would re-render for nothing");
check("...and only the one that moved is new",
      oneMoved.actorPanel.groups[3] !== deepPrev.actorPanel.groups[3]);
check("...while inside it, what did not move is shared too",
      oneMoved.actorPanel.groups[3].lines
        === deepPrev.actorPanel.groups[3].lines,
      "sharing has to keep working under a parent that changed");

// The root moved, so nothing below it can be settled by the caller's `===`.
// The subtree still has to collapse on its own.
const rootMoved = stabilise<Deep>(deepPrev, {
  stage: 3,
  actorPanel: {
    sub: "4 classes",
    groups: [group(0x30, 3, 3), group(0x31, 1, 1),
             group(0x32, 2, 2), group(0x33, 5, 4)],
  },
  tree: deepPrev.tree,
});
check("an equal subtree collapses to the previous object, not just at the root",
      rootMoved !== deepPrev
      && rootMoved.actorPanel === deepPrev.actorPanel);

// -- arrays share element-wise ---------------------------------------------

console.log("\nArrays, element by element:\n");

const rows = [["mode", "play"], ["frame", "120"], ["fps", "60"]];
type Rows = { hudRows: string[][] };
const rowMoved = stabilise<Rows>({ hudRows: rows }, {
  hudRows: [["mode", "play"], ["frame", "121"], ["fps", "60"]],
});
check("one changed element makes a new array", rowMoved.hudRows !== rows);
check("...and every other element is the array it was",
      rowMoved.hudRows[0] === rows[0] && rowMoved.hudRows[2] === rows[2]);
check("...and the changed one is not", rowMoved.hudRows[1] !== rows[1]);

const shorter = stabilise<Rows>({ hudRows: rows }, {
  hudRows: [["mode", "play"], ["frame", "120"]],
});
check("a shorter array is a new array", shorter.hudRows !== rows);
check("...and still keeps the elements it kept",
      shorter.hudRows[0] === rows[0] && shorter.hudRows[1] === rows[1],
      "one row leaving must not re-render the rows that stayed");

// -- and none of it walks what it does not have to -------------------------

console.log("\nAnd still no walk of what was handed over by reference:\n");

// Same property as the root case above, one level down. The tree hangs off a
// slice that is rebuilt every frame, so `share` reaches it on every frame the
// slice's siblings move; it must still stop at the reference.
let deepWalked = 0;
const countingTree = { get blocks() { deepWalked++; return []; } };
type Held = { stage: number; panel: { sub: string; tree: unknown } };
const heldPrev: Held = { stage: 2, panel: { sub: "0x3B", tree: countingTree } };
const held = stabilise<Held>(heldPrev, {
  stage: 3,
  panel: { sub: "0x3B", tree: countingTree },
});
check("a nested unmoved reference is settled without a walk", deepWalked === 0,
      `the tree was read ${deepWalked} times on a frame it did not change`);
check("...and the slice holding it is the object it was",
      held !== heldPrev && held.panel === heldPrev.panel);

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
