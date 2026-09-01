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
// `Object.is` treats these apart from `===`, and both answers are the ones
// wanted: a NaN that stayed NaN is not a change, and 0 becoming -0 is not one
// anybody can see.
check("NaN is equal to itself", equal(NaN, NaN));
check("arrays, by length then by element",
      equal([1, [2, 3]], [1, [2, 3]]) && !equal([1, 2], [1, 2, 3]));
check("objects, by key set then by value",
      equal({ a: 1, b: { c: 2 } }, { b: { c: 2 }, a: 1 })
      && !equal({ a: 1 }, { a: 1, b: 2 })
      && !equal({ a: 1, b: 2 }, { a: 1 }));
check("an object is not an array", !equal({ 0: 1, length: 1 }, [1]));

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

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
