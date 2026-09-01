/**
 * The disposal tree, and the leak check that gives it teeth.
 *
 * Runs headless with no three.js and no DOM, which is the whole reason `Scope`
 * lives in `core/` and the listener helpers do not.
 *
 * Run with `npm run test:scope`.
 */
import { Scope } from "../src/core/scope";

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  if (ok) {
    console.log(`  ok    ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`);
  }
}

console.log("\nscope: order, ownership, idempotence");

{
  const log: string[] = [];
  const root = new Scope("app");
  const stage = root.child("stage");
  const session = stage.child("session");
  stage.defer(() => log.push("stage.a"));
  stage.defer(() => log.push("stage.b"));
  session.defer(() => log.push("session"));

  stage.dispose();
  check("children go before the parent's own registrations",
        log[0] === "session", log.join(","));
  check("a scope's own undos run last-in-first-out",
        log[1] === "stage.b" && log[2] === "stage.a", log.join(","));
  check("the parent survives its child", root.alive && !stage.alive);
  check("a disposed child is off its parent's tree",
        root.snapshot().children.length === 0,
        JSON.stringify(root.snapshot()));
}

{
  let disposed = 0;
  const root = new Scope("app");
  root.own({ dispose: () => { disposed++; } });
  root.dispose();
  root.dispose();
  check("dispose is idempotent", disposed === 1, `disposed ${disposed}`);
}

{
  let ran = 0;
  const root = new Scope("app");
  root.dispose();
  // The caller has already done the thing; refusing the undo would leak it.
  root.defer(() => { ran++; });
  check("defer on a dead scope runs the undo immediately", ran === 1);
  let threw = false;
  try {
    root.child("late");
  } catch {
    threw = true;
  }
  check("but opening a child on a dead scope is an error", threw);
}

{
  const log: string[] = [];
  const root = new Scope("app");
  root.defer(() => log.push("first"));
  root.defer(() => { throw new Error("boom"); });
  root.defer(() => log.push("last"));
  root.dispose();
  check("one undo throwing does not strand the others",
        log.length === 2 && log[0] === "last" && log[1] === "first",
        log.join(","));
}

console.log("\nscope: openedAt, which is what the panel reads");

{
  let frame = 0;
  const root = new Scope("app", () => frame);
  frame = 214;
  const actor = root.child("actor:0x1a40");
  frame = 981;
  const effect = actor.child("effect:impact");
  check("a scope is stamped with the frame it was opened at",
        root.openedAt === 0 && actor.openedAt === 214 && effect.openedAt === 981,
        `${root.openedAt}/${actor.openedAt}/${effect.openedAt}`);

  const tree = root.snapshot();
  check("the projection is plain data the panel can render",
        tree.children[0].name === "actor:0x1a40"
        && tree.children[0].children[0].openedAt === 981,
        JSON.stringify(tree));
}

console.log("\nscope: the leak check");

/**
 * Ten load/seek cycles.
 *
 * The assertion is the one that matters in the player: **every scope opened
 * during stage N is gone by the time stage N+1 has loaded, and the live
 * registration count comes back to where it started.** It counts registrations
 * rather than GPU objects, which is why it runs here and not in a browser.
 */
{
  let frame = 0;
  const app = new Scope("app", () => frame);
  app.own({ dispose: () => {} });                    // the shell's own, kept
  const before = [...app.walk()].length;
  const ownedBefore = [...app.walk()].reduce((n, s) => n + s.owned, 0);

  for (let cycle = 0; cycle < 10; cycle++) {
    const stage = app.child(`stage:${cycle}`);
    const assets = stage.child("assets");
    for (let i = 0; i < 40; i++) assets.own({ dispose: () => {} });
    for (let seek = 0; seek < 3; seek++) {
      const session = stage.child("session");
      for (let a = 0; a < 12; a++) {
        const actor = session.child(`actor:${a}`);
        actor.own({ dispose: () => {} });
        actor.child("effect:impact").own({ dispose: () => {} });
      }
      frame += 100;
      session.dispose();
    }
    stage.dispose();
    frame += 1;
  }

  const after = [...app.walk()].length;
  const ownedAfter = [...app.walk()].reduce((n, s) => n + s.owned, 0);
  check("ten load/seek cycles leave no scope behind",
        after === before, `${before} -> ${after}`);
  check("and no registration behind",
        ownedAfter === ownedBefore, `${ownedBefore} -> ${ownedAfter}`);
}

/** The same check, against a scope that is deliberately never closed. */
{
  let frame = 0;
  const app = new Scope("app", () => frame);
  const before = [...app.walk()].length;
  for (let cycle = 0; cycle < 10; cycle++) {
    const stage = app.child(`stage:${cycle}`);
    stage.child("session").own({ dispose: () => {} });
    frame += 1;
    // stage.dispose() deliberately omitted
  }
  check("and the check fails when something is not closed",
        [...app.walk()].length > before,
        `${before} -> ${[...app.walk()].length}`);
}

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
