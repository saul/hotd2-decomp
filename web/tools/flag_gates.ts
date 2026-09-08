/**
 * Which `wait_script_flag` gates each shipped bundle can open, and which it
 * still has to excuse.
 *
 *     cd web && node tools/run_ts.mjs tools/flag_gates.ts
 *     HOTD2_BUNDLE=../extract/player node tools/run_ts.mjs tools/flag_gates.ts
 *
 * `script/waits/flag.ts` declares a standing `[diverges]`: a gate on a flag
 * nothing this port runs can raise passes instead of parking the stage for
 * ever. The set it passes on is *derived*, so the only way to know how big the
 * divergence is — and whether it has quietly grown — is to run the derivation
 * over the twelve real bundles. That is this.
 *
 * It exits non-zero on the one thing that would make the derivation a lie
 * rather than merely incomplete: a stage claiming it can raise a flag when
 * nothing it places actually can. The case that matters today is class 0x41,
 * because `raisesScriptFlag` used to be a number per *class* and 441 of the six
 * stages' spawns are class 0x41 — so a class-wide answer would put flag 20 in
 * every stage's set, and stage 4's gate would be right by accident while the
 * rest were wrong on purpose. Stage 5 places 44 class-0x41 props and **none**
 * of them is the type-75 object, so stage 5 is the control: flag 20 must not
 * appear in its set.
 *
 * `[port-only]`. The engine needs none of this; every writer of
 * `g_script_flags` is code it is running.
 */
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import type { ScriptJson } from "../src/bundle";
import { SetGameTables } from "../src/game/tables";
import { ScriptFlagsThisBundleCanRaise } from "../src/script/waits/flag";
import { PROP75_SCRIPT_FLAG } from "../src/game/class41";
import "../src/game/classes";

/** The stage whose class-0x41 spawns include the one type-75 placement. */
const STAGE_WITH_TYPE_75 = "stage4";
/** A stage with plenty of class-0x41 spawns and no type-75 among them. */
const STAGE_WITHOUT_TYPE_75 = "stage5";

const root = resolve(process.env.HOTD2_BUNDLE ?? "extract/player");
const names = readdirSync(root).filter((n) => n.startsWith("stage")).sort();
if (names.length === 0) {
  console.error(`no bundles under ${root} -- run \`npm run export\``);
  process.exit(3);
}

let failed = 0;
const raisesFlag20 = new Map<string, boolean>();

for (const name of names) {
  const raw = JSON.parse(
    readFileSync(resolve(root, name, `${name}.script.json`), "utf8"));
  const script = raw as ScriptJson;
  // The same tables the player installs, so class 0x41's per-record answer has
  // the placements to resolve against.
  SetGameTables(raw.characters, raw.breakables, undefined, undefined,
                undefined, raw.civilians);
  const canRaise = ScriptFlagsThisBundleCanRaise(script);
  raisesFlag20.set(name, canRaise.has(PROP75_SCRIPT_FLAG));

  const gates = new Set<number>();
  for (const b of script.blocks ?? []) {
    for (const st of b.steps ?? []) {
      for (const op of st.ops ?? []) {
        if (op.op === 0x45) gates.add(op.arg ?? 0);
      }
    }
  }
  const asc = (a: number, b: number) => a - b;
  const held = [...gates].filter((g) => canRaise.has(g)).sort(asc);
  const excused = [...gates].filter((g) => !canRaise.has(g)).sort(asc);
  console.log(`${name.padEnd(17)} ${gates.size} gates: `
    + `held {${held.join(",")}}  excused {${excused.join(",")}}`);
}

const check = (what: string, ok: boolean, detail = ""): void => {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${what}${detail ? ` -- ${detail}` : ""}`);
  if (!ok) failed++;
};

console.log("");
for (const suffix of ["", "_original"]) {
  const yes = STAGE_WITH_TYPE_75 + suffix;
  const no = STAGE_WITHOUT_TYPE_75 + suffix;
  if (raisesFlag20.has(yes)) {
    check(`${yes} can raise flag ${PROP75_SCRIPT_FLAG}: it places the type-75 `
      + "prop", raisesFlag20.get(yes) === true);
  }
  if (raisesFlag20.has(no)) {
    check(`${no} cannot: its class-0x41 spawns are all something else`,
          raisesFlag20.get(no) === false);
  }
}

process.exit(failed === 0 ? 0 : 1);
