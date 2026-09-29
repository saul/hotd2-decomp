/**
 * The browser player's layer boundaries.
 *
 *     node tools/run_ts.mjs tools/repo/layers.ts [--list] [--root <dir>]
 *
 * `docs/PLAYER.md` names the layers and the direction they may depend in,
 * and this measures it, because a boundary nobody measures is a preference:
 *
 *     engine   core/ bundle/ script/ game/ hod2lib/   no three.js, no DOM, deterministic
 *     render   render/ audio/                         reads engine state, owns nothing
 *     ui       hud/ ui/                               reads a projection, emits commands
 *     app      app/                                   the composition root; sees everything
 *
 * Every rule has one of two severities:
 *
 * * **error** -- must be zero. A new one fails.
 * * **ratchet** -- a violation the architecture has not reached yet. The
 *   current count is recorded here as the rule's baseline, and the check
 *   fails if it **grows**. Lowering a baseline is the point; raising one is
 *   the repository owner's decision, not a line edit here.
 *
 * There is no suppression comment and no per-file opt-out: the way out of a
 * violation is to fix the layering or to change the plan.
 *
 * What is read, and how: imports, exported classes, and calls into `game/`
 * from the TypeScript compiler's parse of each file (`tree.ts`); the token
 * rules -- the DOM, `Math.random`, writes to `G` or to an actor, DOM
 * insertion, `BAMS_TO_RAD` -- by pattern over the file's code with its
 * comments taken out, so a rule named in a doc comment is not a violation of
 * itself, and a name in a string still counts.
 *
 * `--list` prints every hit of every rule rather than the first eight of
 * each error rule. Exit 0 when every rule holds, 1 when one fails, 2 when
 * there is no `web/src/`.
 */
import { resolve } from "node:path";

import {
  basename, dirname, filesUnder, isDir, isSource, join, lineAt, matches,
  parseArgs, relative, scan, strip,
} from "./tree";

export type Layer = "engine" | "render" | "ui" | "app";

/** The layer of each top-level directory of `web/src/`. */
export const LAYER_OF: Readonly<Record<string, Layer>> = {
  core: "engine", bundle: "engine", script: "engine", game: "engine",
  // The asset library -- the game-format parsers and the bundle writer, so a
  // bundle can be built in the browser -- needs exactly the engine's
  // constraints and for the same reason: a parser that reads the wall clock
  // cannot be replayed, and one that touches the document cannot run in the
  // worker it was written for. Its bytes arrive through an interface;
  // `app/install/` and `web/tools/lib/` are the two implementations of it.
  hod2lib: "engine",
  // An output device that reads engine state and owns nothing, which is the
  // renderer's contract; and a track list is bundle data an output device has
  // to read, which the UI rule would refuse.
  render: "render", audio: "render",
  hud: "ui", ui: "ui",
  app: "app",
};

/** Who may import whom. The composition root sees everything; nothing sees it. */
export const MAY_IMPORT: Readonly<Record<Layer, ReadonlySet<Layer>>> = {
  engine: new Set(["engine"]),
  render: new Set(["engine", "render"]),
  ui: new Set(["ui"]),
  app: new Set(["engine", "render", "ui", "app"]),
};

/**
 * The DOM, and the two values the engine cannot get twice: `performance`
 * and `Date` read the wall clock, and a port that reads it cannot be
 * replayed from a snapshot any more than one that reads `Math.random()` can.
 */
const DOM_RE = /\b(document|window|HTMLElement|localStorage|performance|Date)\b/g;
const RANDOM_RE = /Math\.random\s*\(/g;
/** `G.x = `, `G.x[i] = `, `G.x.y = ` -- an assignment, not a comparison. */
const G_WRITE_RE = /\bG\.\w+(?:\[[^\]]*\]|\.\w+)*\s*(?:[-+*/|&^]|\+\+|--)?=(?!=)/g;
/**
 * `inst.a.visible = `, `inst.a.lookAt.x = `, `inst.a.boneSlot[b] = ` -- a
 * write to a game object's fields from outside the engine. An actor field is
 * engine state whether it is reached through `G` or through a renderer's own
 * handle on the object.
 */
const ACTOR_WRITE_RE = /\.a\.\w+(?:\[[^\]]*\]|\.\w+)*\s*(?:[-+*/|&^]|\+\+|--)?=(?!=)/g;
/**
 * Every way there is of putting a node into the document. Building an
 * element is not here: a canvas made to be a texture never enters the
 * document, so it is not a second writer of anything. The insertion is the
 * violation.
 */
const DOM_INSERT_RE = /\.(?:appendChild|insertBefore|replaceChildren|insertAdjacentElement|insertAdjacentHTML|prepend|append)\s*\(/g;
const BAMS_RE = /\bBAMS_TO_RAD\s*=/g;
/** An import path from anywhere under `render/` into `game/`, at any depth. */
const INTO_GAME = /^(?:\.\.\/)+game\/./;

/** One rule: what it is, why, how severe, and what it found. */
export class Rule {
  readonly hits: string[] = [];
  constructor(readonly name: string, readonly why: string,
              readonly severity: "error" | "ratchet",
              readonly baseline = 0, readonly step: string | null = null) {}
  hit(where: string): void { this.hits.push(where); }
}

/** Every rule, fresh, with no hits: the table the status report renders. */
export function buildRules(): Map<string, Rule> {
  const rules = [
    new Rule("layer-direction",
      "a layer may only import from itself and the layers below it",
      "error"),
    new Rule("no-three-in-engine",
      "the port and the machine must run headless; three.js in either is "
      + "state the snapshot cannot carry",
      "error"),
    new Rule("no-three-in-core",
      "the framework every System depends on must not be renderer-bound -- "
      + "`RenderContext` lives in render/, and `System` is generic over which "
      + "context a layer takes",
      "error"),
    new Rule("no-dom-in-engine",
      "engine code that touches the DOM cannot be exercised headlessly",
      "error"),
    new Rule("no-math-random-in-engine",
      "a draw from the ambient generator is state a snapshot cannot restore; "
      + "use the seeded Rng",
      "error"),
    // Nothing in `render/` is snapshotted, so this is the other half of why
    // the engine's generator is seeded: a driven run has to replay, and an
    // ambient draw is the one thing a replay cannot reproduce.
    new Rule("no-math-random-in-render",
      "a renderer that draws from the ambient generator cannot be replayed; "
      + "a layer's own seeded Rng, reseeded per stage, can -- and must not be "
      + "`ctx.rng`, which the port draws from",
      "error"),
    new Rule("no-engine-writes-in-render",
      "render may read engine state and must never write it -- a renderer "
      + "that changes `G` is gameplay that test:port cannot reach",
      "error"),
    // What only three.js can work out -- a bone's world position, whether a
    // model is built -- goes across the declared `GameHost` seam: `boneWorld`
    // answers where a bone is and `ActorRegisterCameraPoint`
    // (`FUN_00409B70`) writes `obj+0x100` from it, and `a.visible` is
    // `ActorDespawn`'s alone.
    new Rule("no-actor-writes-in-render",
      "an actor's fields are engine state whether they are reached through "
      + "`G` or through a renderer's handle on the object -- what only "
      + "three.js can work out goes across `GameHost` and the port writes it; "
      + "`a.visible` in particular is the port's, and a renderer that sets it "
      + "draws set-pieces the script has removed",
      "error"),
    // The renderer answers questions -- `pickShot` for the hit spheres the
    // skeleton carries, `readySpawns` for the hierarchies the glTF has -- and
    // the port makes every decision that follows. A debug action is a
    // command through `app/`, not an engine call from a renderer. `game/vec`
    // and `game/matrix` are pure maths over plain numbers with no state, and
    // a draw that takes a matrix apart the way the engine does calls the one
    // transcription rather than writing a second.
    new Rule("render-drives-the-port",
      "an engine function *called* from render/ is a decision the port "
      + "should be making; the renderer answers questions across `GameHost` "
      + "and `app/` composes -- types, enums and pure maths are fine",
      "error"),
    new Rule("no-engine-writes-in-ui",
      "the UI reads a projection and emits commands; a panel that writes `G` "
      + "is a fourth way for state to enter the game",
      "error"),
    new Rule("ui-reads-projection-only",
      "the UI reads one plain projection and emits commands; an import from "
      + "game/, script/ or bundle/ -- type-only included -- makes it a second "
      + "reader of engine state with its own idea of when to look",
      "error"),
    new Rule("no-dom-insertion",
      "React renders every element on the page; a layer that inserts one "
      + "into the document is a second owner of what is inside an element "
      + "React renders, and the paint order it ends up with is an accident of "
      + "which mounted first -- the layers are handed the nodes they write "
      + "to, through UiHost",
      "error"),
    new Rule("layers-are-systems",
      "every layer with an update() is in World, so every one of them is "
      + "inside save/load/resync -- a layer ticked by hand from Player.frame "
      + "is not asked to rebuild, and a seek then leaves it holding a pose "
      + "play would never produce",
      "error"),
    new Rule("one-bams-constant",
      "BAMS_TO_RAD belongs to core/bams.ts and nowhere else -- per-file "
      + "copies drift apart in the last significant figures",
      "error"),
  ];
  return new Map(rules.map((r) => [r.name, r]));
}

/** The layer a path under `src` is in, if it is in one. */
function layerOf(src: string, path: string): Layer | null {
  const rel = relative(src, path);
  if (!rel || rel.startsWith("..") || rel.startsWith("/")) return null;
  return LAYER_OF[rel.split("/")[0]] ?? null;
}

/** Measure every rule over the tree at `root`. */
export function runLayers(root: string): Map<string, Rule> {
  const src = join(root, "web", "src");
  const rules = buildRules();
  const hit = (name: string, where: string) => rules.get(name)!.hit(where);
  // `.tsx` too: the UI layer is written in it.
  const files = filesUnder(src, isSource);

  for (const f of files) {
    const lay = layerOf(src, f);
    if (lay === null) continue;
    const rel = relative(root, f);
    const s = scan(f);
    const code = s.code;

    for (const { spec } of s.modules) {
      if (spec === "three" || spec.startsWith("three/")) {
        if (lay === "engine") {
          hit(basename(dirname(f)) === "core" ? "no-three-in-core"
                                              : "no-three-in-engine",
              `${rel}: imports three`);
        }
        continue;
      }
      if (!spec.startsWith(".")) continue;
      const tgt = layerOf(src, resolve(dirname(f), spec));
      if (tgt === null) continue;
      if (!MAY_IMPORT[lay].has(tgt)) {
        hit("layer-direction", `${rel}: ${lay} imports ${tgt} (${spec})`);
      } else if (lay === "ui" && tgt === "engine") {
        hit("ui-reads-projection-only", `${rel}: ${spec}`);
      }
    }

    if (lay === "engine") {
      for (const m of matches(DOM_RE, code)) hit("no-dom-in-engine", `${rel}: ${m[0]}`);
      for (let n = matches(RANDOM_RE, code).length; n > 0; n--) {
        hit("no-math-random-in-engine", `${rel}: Math.random(`);
      }
    }
    if (lay === "render") {
      for (let n = matches(RANDOM_RE, code).length; n > 0; n--) {
        hit("no-math-random-in-render", `${rel}: Math.random(`);
      }
      for (const m of matches(G_WRITE_RE, code)) {
        hit("no-engine-writes-in-render", `${rel}: ${strip(m[0])}`);
      }
      for (const m of matches(ACTOR_WRITE_RE, code)) {
        hit("no-actor-writes-in-render", `${rel}:${lineAt(code, m.index)}: ${strip(m[0])}`);
      }
      // A value import from `game/` -- a default, a namespace or a named
      // import not marked `type` -- that the file calls, `new`s or tags a
      // template with. `game/vec` and `game/matrix` are pure maths.
      for (const { spec, values } of s.modules) {
        if (!INTO_GAME.test(spec) || spec.endsWith("/vec")
            || spec.endsWith("/matrix")) continue;
        for (const { local, namespace } of values) {
          if (!namespace) {
            if (s.calls.has(local)) hit("render-drives-the-port", `${rel}: ${local}()`);
            continue;
          }
          for (const c of s.calls) {
            if (c.startsWith(`${local}.`)) hit("render-drives-the-port", `${rel}: ${c}()`);
          }
        }
      }
    }
    if (lay === "ui") {
      for (const m of matches(G_WRITE_RE, code)) {
        hit("no-engine-writes-in-ui", `${rel}: ${strip(m[0])}`);
      }
    }
    // Every layer, `ui/` included: React is the one writer, and a component
    // that built its own children imperatively would be as wrong as a layer
    // that did.
    for (const m of matches(DOM_INSERT_RE, code)) {
      hit("no-dom-insertion", `${rel}:${lineAt(code, m.index)}: ${strip(m[0])}`);
    }
    // `core/bams.ts` is the one definition, so it is not a violation of
    // itself. Everywhere else, importing it is the only option.
    if (matches(BAMS_RE, code).length && basename(f) !== "bams.ts") {
      hit("one-bams-constant", rel);
    }
  }

  // Every drawable layer is in the tick order: an exported class in
  // `render/`, at any depth, with an `update` is a layer, and a layer `app/`
  // never hands to `world.add` is ticked by hand or not at all.
  const layers = new Map<string, string>();                 // class -> file
  for (const f of files) {
    if (layerOf(src, f) !== "render") continue;
    for (const { name } of scan(f).updateClasses) layers.set(name, relative(root, f));
  }
  // `world.add("render", new CameraDrawSystem(...))` names the class; the
  // commoner `world.add("render", this.rigs)` names a field, and the field's
  // own `= new RigLayer(` -- in any file of `app/` -- resolves it.
  const app = files.filter((f) => basename(dirname(f)) === "app")
    .map((f) => scan(f).code).join("\n");
  const fields = new Map<string, string>();
  for (const m of matches(/(\w+)(?:\s*:\s*[\w<>[\]| ]+)?\s*=\s*new (\w+)\(/g, app)) {
    fields.set(m[1], m[2]);
  }
  const registered = new Set(
    matches(/world\.add\(\s*"\w+"\s*,\s*new (\w+)\(/g, app).map((m) => m[1]));
  for (const m of matches(/world\.add\(\s*"\w+"\s*,\s*this\.(\w+)\b/g, app)) {
    const cls = fields.get(m[1]);
    if (cls !== undefined) registered.add(cls);
  }
  for (const [cls, where] of [...layers].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (!registered.has(cls)) hit("layers-are-systems", `${where}: ${cls} is never world.add()ed`);
  }
  return rules;
}

export function main(argv: string[]): number {
  const { root, flags } = parseArgs(
    argv, "usage: layers.ts [--list] [--root <dir>]\n"
      + "  --list  print every violation, not just the first few", ["--list"]);
  const src = join(root, "web", "src");
  if (!isDir(src)) {
    console.error(`error: ${src} not found`);
    return 2;
  }
  const rules = runLayers(root);
  const shown = flags.has("--list");

  console.log("browser player -- layer boundaries\n");
  console.log(`  ${"rule".padEnd(28)}${"sev".padEnd(9)}${"count".padStart(6)}`
    + `${"baseline".padStart(10)}   status`);
  const failed: Rule[] = [];
  for (const r of rules.values()) {
    const n = r.hits.length;
    const ok = r.severity === "error" ? n === 0 : n <= r.baseline;
    const base = r.severity === "error" ? "0" : String(r.baseline);
    let mark = ok ? "ok" : "FAIL";
    if (ok && r.severity === "ratchet") {
      mark = n < r.baseline ? `ok  (baseline can drop to ${n})` : `held (step ${r.step})`;
    }
    if (!ok) failed.push(r);
    console.log(`  ${r.name.padEnd(28)}${r.severity.padEnd(9)}${String(n).padStart(6)}`
      + `${base.padStart(10)}   ${mark}`);
  }

  for (const r of rules.values()) {
    if (!r.hits.length) continue;
    if (r.severity === "error" || failed.includes(r) || shown) {
      console.log(`\n${r.name} -- ${r.why}`);
      for (const h of shown ? r.hits : r.hits.slice(0, 8)) console.log(`    ${h}`);
      if (!shown && r.hits.length > 8) {
        console.log(`    ... ${r.hits.length - 8} more (--list)`);
      }
    }
  }

  console.log();
  if (failed.length) {
    console.log(`${failed.length} rule(s) failed:`);
    for (const r of failed) {
      if (r.severity === "ratchet") {
        console.log(`  ${r.name}: ${r.hits.length} > baseline ${r.baseline}. `
          + `Step ${r.step} clears it -- do not raise the baseline.`);
      } else {
        console.log(`  ${r.name}: must be zero.`);
      }
    }
    return 1;
  }
  console.log("clean");
  return 0;
}

if (/(^|[\\/])repo[\\/]layers\.ts$/.test(process.argv[1] ?? "")) {
  process.exitCode = main(process.argv.slice(2));
}
