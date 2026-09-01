/**
 * The two UI rules that need an AST, and that fail quietly.
 *
 * Most of what the UI layer promises is already held by something stronger.
 * The layer boundaries are `tools/verify_layers.py`'s job. "The projection is
 * plain data" is a runtime property and `test:state` and `test:projection`
 * prove it better than any static check could. The command union is
 * exhaustive because it is a closed union in an exhaustive switch — the
 * strongest rule in this layer is a type, not a linter, and that is worth
 * saying before adding tooling.
 *
 * Two rules are left over. Both need to look at the shape of the code, and
 * both fail **silently** — the page still renders, the app still works, it
 * just costs more for ever:
 *
 * * a panel that is not `memo`-wrapped re-renders on every publish, which
 *   throws away the reference stability step 18 bought;
 * * `store.demand` called during render is taken twice by strict mode and
 *   released once, so the count never returns to zero and `app/` builds an
 *   expensive slice for a panel nobody has open, for the rest of the session.
 *
 * **Why not ESLint.** There is no lint config in this repo, it would be about
 * eight dependencies and a config file, and it would cost something concrete:
 * ESLint has no equivalent of `verify_layers.py`'s ratchet baselines, and the
 * ratchet is the mechanism that let steps 8 to 12 land at all. Error and warn
 * are not "this count may fall but never rise". So: the same two-severity
 * shape as every other `verify_*`, over the `typescript` already in
 * devDependencies, and no new package.
 *
 * The standing rule for this file is that it must not grow. Do not add a
 * check for anything the types, the layer checker or a runtime test already
 * hold — three overlapping mechanisms for one property is how a rule ends up
 * satisfied in the checker rather than in the code, which this project has
 * already caught happening once.
 *
 * Run with `npm run verify:ui`.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const WEB = dirname(fileURLToPath(import.meta.url)).replace(/\/tools$/, "");
const PANELS = join(WEB, "src", "ui", "panels");
const UI = join(WEB, "src", "ui");

const rules = {
  "panels-are-memoised": {
    why: "a panel that is not memoised re-renders on every publish, which "
       + "spends the reference stability the projection is built to have",
    severity: "error",
    hits: [],
  },
  "demand-in-effect": {
    why: "`store.demand` during render is taken twice by strict mode and "
       + "released once, so the slice is built for ever for a panel nobody "
       + "has open",
    severity: "error",
    hits: [],
  },
};

const parse = (file) =>
  ts.createSourceFile(file, readFileSync(file, "utf8"),
                      ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

const at = (node, src) =>
  `${relative(WEB, src.fileName)}:`
  + `${src.getLineAndCharacterOfPosition(node.getStart(src)).line + 1}`;

/**
 * Is this a component the rule applies to?
 *
 * Two exemptions, both principled rather than a list of names. A component
 * with **no props** never re-renders from props, so `memo` would compare
 * nothing. A component that takes **`children`** is handed fresh elements by
 * its caller on every render, so the shallow compare could never bail — the
 * memoisation that matters is on the panel bodies below it. Neither is a
 * suppression: a component that grows real props stops being exempt.
 */
function wantsMemo(fn) {
  const [props] = fn.parameters;
  if (!props) return false;
  const t = props.name;
  if (ts.isObjectBindingPattern(t)) {
    return !t.elements.some((e) => e.name.getText() === "children");
  }
  // A named props parameter: fall back to its type literal, if it has one.
  const lit = props.type;
  if (lit && ts.isTypeLiteralNode(lit)) {
    return !lit.members.some((m) => m.name?.getText() === "children");
  }
  return true;
}

/** `export function Foo(...)` in a panel file that is not wrapped. */
function checkMemo(src) {
  for (const node of src.statements) {
    if (!ts.isFunctionDeclaration(node) || !node.name) continue;
    const exported = node.modifiers?.some(
      (m) => m.kind === ts.SyntaxKind.ExportKeyword);
    if (!exported) continue;
    if (!/^[A-Z]/.test(node.name.text)) continue;
    if (!wantsMemo(node)) continue;
    rules["panels-are-memoised"].hits.push(
      `${at(node, src)}: ${node.name.text} is exported unwrapped`);
  }
}

/** Every `x.demand(...)` must sit inside a `useEffect` callback. */
function checkDemand(src) {
  const visit = (node, inEffect) => {
    let effect = inEffect;
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (ts.isIdentifier(callee) && callee.text === "useEffect") effect = true;
      if (ts.isPropertyAccessExpression(callee)
          && callee.name.text === "demand" && !inEffect) {
        rules["demand-in-effect"].hits.push(
          `${at(node, src)}: ${callee.getText(src)} outside an effect`);
      }
    }
    node.forEachChild((c) => visit(c, effect));
  };
  visit(src, false);
}

const tsxUnder = (dir) =>
  readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".tsx"))
    .map((e) => join(dir, e.name));

for (const file of tsxUnder(PANELS)) checkMemo(parse(file));
for (const file of [...tsxUnder(UI), ...tsxUnder(PANELS)]) {
  checkDemand(parse(file));
}

console.log("browser player -- the two UI rules that need an AST\n");
console.log("  rule                  sev       count  baseline   status");
let failed = 0;
for (const [name, r] of Object.entries(rules)) {
  const n = r.hits.length;
  const base = r.baseline ?? 0;
  const ok = r.severity === "error" ? n === 0 : n <= base;
  if (!ok) failed++;
  console.log(`  ${name.padEnd(22)}${r.severity.padEnd(10)}${String(n).padStart(5)}`
              + `${String(base).padStart(10)}   ${ok ? "ok" : "FAIL"}`);
}
console.log();
for (const [name, r] of Object.entries(rules)) {
  if (!r.hits.length) continue;
  console.log(`${name} -- ${r.why}`);
  for (const h of r.hits) console.log(`    ${h}`);
  console.log();
}
console.log(failed ? `${failed} rule(s) failed` : "clean");
process.exit(failed ? 1 : 0);
