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
 * * a `useSlice` selector that builds a value instead of naming a field is a
 *   new object on every read, so the subscription can never settle;
 * * `store.demand` called during render is taken twice by strict mode and
 *   released once, so the count never returns to zero and `app/` builds an
 *   expensive slice for a panel nobody has open, for the rest of the session.
 *
 * **What used to be here, and why it is gone.** The first rule was
 * `panels-are-memoised`, and step 24 deleted it rather than making it
 * cleverer. It counted exported components in `panels/` that were not wrapped
 * in `memo`, and it reported `0 ok` for months while two of them —
 * `StagePicker` and `ViewSettings` — took the *entire* projection as a prop
 * and so could never bail on any frame. That is the outcome the standing rule
 * at the foot of this header warns about: a rule satisfied in the checker rather than in the
 * code. Per-slice subscription makes the mistake it was aimed at impossible
 * rather than merely detectable — a component that reads the projection now
 * subscribes to the field it draws, and re-renders when that field moves
 * whatever its parent did — so there is nothing left for a memo rule to
 * protect. **A rule that can be deleted because the design no longer permits
 * the mistake is the best end a rule can have**, and it is a better end than a
 * tighter version of the same rule would have been.
 *
 * **Why not ESLint.** There is no lint config in this repo, it would be about
 * eight dependencies and a config file, and it would cost something concrete:
 * ESLint has no equivalent of `verify_layers.py`'s ratchet baselines, and the
 * ratchet is the mechanism that let steps 8 to 12 land at all. Error and warn
 * are not "this count may fall but never rise". So: the same two-severity
 * shape as every other `verify_*`, over the `typescript` already in
 * devDependencies, and no new package.
 *
 * The standing rule for this file is that it must not grow — which is why
 * step 24 replaced a rule rather than adding one, and the count is still two.
 * Do not add a check for anything the types, the layer checker or a runtime
 * test already hold — three overlapping mechanisms for one property is how a
 * rule ends up satisfied in the checker rather than in the code, which this
 * project has already caught happening once.
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
  "selectors-return-fields": {
    why: "a `useSlice` selector names a field of the projection -- a path, "
       + "indexed or not, optionally with a literal fallback. One that "
       + "*builds* a value returns a new object on every read, and the "
       + "subscription never settles",
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
 * The grammar a selector is allowed to be.
 *
 * Identifiers, property accesses (optional chaining included), non-null
 * assertions, parentheses, and `??` / `||` against a literal. That is exactly
 * the set of expressions that can only ever *reach into* the projection, and
 * `app/projection/stable.ts` guarantees every such value is referentially
 * stable while its content has not moved. Anything else — an object or array
 * literal, a call, a template string, arithmetic, a comparison — builds a new
 * value on each read, and `useSyncExternalStore` compares reads with
 * `Object.is`, so it never settles and React throws "The result of getSnapshot
 * should be cached to avoid an infinite loop" on the first render.
 *
 * A unary minus is not in the set on purpose, so `?? -1` is a violation rather
 * than a special case: the component that wants a sentinel can apply one to
 * what it was handed, and keeping the grammar to "a path, or a path with a
 * literal fallback" is what makes it explainable in one sentence.
 */
function isLiteral(n) {
  return ts.isStringLiteral(n) || ts.isNumericLiteral(n)
      || n.kind === ts.SyntaxKind.TrueKeyword
      || n.kind === ts.SyntaxKind.FalseKeyword
      || n.kind === ts.SyntaxKind.NullKeyword;
}

function isFieldPath(n) {
  if (ts.isIdentifier(n)) return true;
  if (ts.isParenthesizedExpression(n) || ts.isNonNullExpression(n)) {
    return isFieldPath(n.expression);
  }
  if (ts.isPropertyAccessExpression(n)) return isFieldPath(n.expression);
  // `s.groups[group]` is a read of a field, exactly as `s.groups.camera` is,
  // and `stabilise` has settled what comes back either way. What must not be
  // in the subscript is a **call**: that is a value computed per read, and the
  // reference it produces would be new every time. So the index may be a
  // literal or a path, and nothing else.
  if (ts.isElementAccessExpression(n)) {
    const i = n.argumentExpression;
    return isFieldPath(n.expression) && (isLiteral(i) || isFieldPath(i));
  }
  if (ts.isBinaryExpression(n)) {
    const op = n.operatorToken.kind;
    if (op === ts.SyntaxKind.QuestionQuestionToken
        || op === ts.SyntaxKind.BarBarToken) {
      return isFieldPath(n.left) && isLiteral(n.right);
    }
  }
  return false;
}

/** What is wrong with this argument to `useSlice`, if anything. */
function badSelector(arg, src) {
  if (!arg) return "no selector at all";
  if (!ts.isArrowFunction(arg)) {
    return `the selector is \`${arg.getText(src)}\`, not an arrow function, `
         + "so what it returns cannot be read here";
  }
  if (ts.isBlock(arg.body)) {
    return "the selector has a block body; a field is an expression";
  }
  if (!isFieldPath(arg.body)) {
    return `\`${arg.body.getText(src)}\` builds a value rather than naming a `
         + "field";
  }
  return "";
}

/** Every `useSlice(...)` argument must be a path into the projection. */
function checkSelectors(src) {
  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const name = ts.isIdentifier(callee) ? callee.text
        : ts.isPropertyAccessExpression(callee) ? callee.name.text : "";
      if (name === "useSlice") {
        const why = badSelector(node.arguments[0], src);
        if (why) {
          rules["selectors-return-fields"].hits.push(`${at(node, src)}: ${why}`);
        }
      }
    }
    node.forEachChild(visit);
  };
  visit(src);
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

const under = (dir, ext) =>
  readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && ext.some((x) => e.name.endsWith(x)))
    .map((e) => join(dir, e.name));

const tsxUnder = (dir) => under(dir, [".tsx"]);

// The selector rule reads `.ts` as well: `useSlice` is called from components,
// which are `.tsx`, but a helper hook that wraps it need not be, and a rule
// that could only see one extension is how three `error` rules here came to
// report zero over files they had never opened.
for (const file of [...under(UI, [".ts", ".tsx"]),
                    ...under(PANELS, [".ts", ".tsx"])]) {
  checkSelectors(parse(file));
}
for (const file of [...tsxUnder(UI), ...tsxUnder(PANELS)]) {
  checkDemand(parse(file));
}

console.log("browser player -- the two UI rules that need an AST\n");
console.log("  rule                       sev       count  baseline   status");
let failed = 0;
for (const [name, r] of Object.entries(rules)) {
  const n = r.hits.length;
  const base = r.baseline ?? 0;
  const ok = r.severity === "error" ? n === 0 : n <= base;
  if (!ok) failed++;
  console.log(`  ${name.padEnd(27)}${r.severity.padEnd(10)}${String(n).padStart(5)}`
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
