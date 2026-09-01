/**
 * The script, turned into rows the UI can draw.
 *
 * `opSummary` moved here verbatim from `hud/ui.ts`. It reads `OpJson` — the
 * exporter's shape — and the one rule it follows throughout is the reason it
 * has to live on this side of the seam: **an opcode whose meaning is still
 * only "the global it writes" shows its raw operands, never a guessed label.**
 * A plausible wrong name is worse than a hex dword, and deciding which is
 * which needs the bundle.
 *
 * The tree is built **once per stage**, not once per frame. It is thousands of
 * rows and none of them change; only which one is current does. `app/` keeps
 * the same object across frames so React can skip the whole subtree, and the
 * projection's change key is computed without it.
 */
import type { BlockJson, OpJson, ScriptJson } from "../../bundle";
import type { FeedEntry } from "../../script/walker";
import { opStatus } from "../../script/walker";
import { STATUS_TITLE } from "../../script/opstatus";
import type { FeedRow, MinimapGraph, TreeBlock, TreeProjection, TreeStep }
  from "../../ui/projection";

/** A one-line operand summary for the tree and the feed. */
export function opSummary(op: OpJson): string {
  // `means` is the exporter's plain-English reading of an operand whose space
  // is small, closed and fully read out of the handler -- shutter states,
  // backdrop modes, rain, skippable regions. It outranks the bare number,
  // because "5" tells a reader nothing and "close, and disable firing" is the
  // whole content of the instruction.
  if (op.means) {
    return op.value !== undefined ? `${op.value} — ${op.means}` : op.means;
  }
  if (op.action === "cam_play") {
    const where = op.cam ? `${op.cam.file}[${op.cam.path}]` : `slot ${op.slot}`;
    if (op.static) return `${where} hold @${op.start}`;
    if (op.resume) return `${where} resume -> ${op.end}`;
    return `${where} ${op.start}..${op.end}`;
  }
  if (op.action) return `${op.action} ${(op.args ?? []).join(" ")}`.trim();
  if (op.region !== undefined) return `region ${op.region}`;
  if (op.slot !== undefined) {
    return `slot ${op.slot}${op.file ? ` = ${op.file}[${op.entry}]` : ""}`;
  }
  if (op.file) return op.file;
  if (op.spawns) {
    const cls = [...new Set(op.spawns.map((s) => s.class))].join(",");
    return `${op.spawns.length} x class ${cls}`;
  }
  if (op.blocks_on) return `${op.arg ?? 0} — ${op.blocks_on}`;
  if (op.channel_name !== undefined) {
    const v = op.components ? op.components.join(",") : op.value;
    return `${op.channel_name} = ${v ?? "?"}`;
  }
  if (op.track !== undefined) return `track ${op.track}`;
  if (op.sound !== undefined) return `sound ${op.sound}`;
  if (op.ground_y !== undefined) return `y = ${op.ground_y.toFixed(3)}`;
  if (op.pitch_deg !== undefined) {
    return `pitch ${op.pitch_deg.toFixed(1)}° yaw ${(op.yaw_deg ?? 0).toFixed(1)}°`;
  }
  if (op.flag !== undefined) return `flag ${op.flag}`;
  if (op.value !== undefined) return String(op.value);
  if (op.raw) return op.raw.join(" ");
  return "";
}

function stepRows(blk: BlockJson): TreeStep[] {
  return (blk.steps ?? []).map((step) => ({
    index: step.index,
    // EvtAdvanceStepOrRoute sets the step index to 1 on every block change,
    // so step 0 is only reached through the checkpoint path.
    label: step.index === 0
      ? "step 0  (checkpoint state — a block change enters at step 1)"
      : `step ${step.index}`,
    ops: step.ops.map((op) => {
      const summary = opSummary(op);
      const status = opStatus(op.op);
      return {
        i: op.i,
        name: op.name,
        summary,
        cat: op.cat,
        status,
        // The panel is narrow and the operand summary ellipsizes, so the whole
        // row is also its own tooltip -- and it says whether the player acts
        // on the instruction at all.
        title: `${op.i}  ${op.name}${summary ? "  " + summary : ""}`
             + `\n${STATUS_TITLE[status]}`,
        query: `${op.name} ${op.cat} ${summary}`.toLowerCase(),
      };
    }),
  }));
}

export function treeProjection(script: ScriptJson): TreeProjection {
  const blocks: TreeBlock[] = [];
  for (const blk of script.blocks) {
    if (blk.hole) continue;
    const targets = blk.route.next.filter((n) => n >= 0);
    blocks.push({
      index: blk.index,
      kind: blk.route.kind,
      targets,
      stepCount: blk.steps?.length ?? 0,
      title: `block ${blk.index} — ${blk.route.kind}`
        + `${targets.length ? " → " + targets.join(", ") : ""}, `
        + `${blk.steps?.length ?? 0} steps`,
      steps: stepRows(blk),
    });
  }
  return { blocks };
}

/** One feed entry, flattened. The feed is append-only and capped by `ui/`. */
export function feedRow(e: FeedEntry): FeedRow {
  const status = opStatus(e.op.op);
  return {
    block: e.block, step: e.step, opIndex: e.opIndex,
    at: `${e.block}.${e.step}.${e.opIndex}`,
    name: e.op.name,
    summary: opSummary(e.op),
    note: e.note ?? "",
    cat: e.op.cat,
    status,
    title: STATUS_TITLE[status],
  };
}

/** The inspector's body: the opcode as pretty JSON. */
export function inspectorText(op: OpJson | null,
                              extra?: Record<string, unknown>): string {
  if (!op) return "";
  const body: Record<string, unknown> = {
    opcode: `0x${op.op.toString(16).toUpperCase().padStart(2, "0")}`,
    name: op.name,
    category: op.cat,
    file_offset: `0x${op.at.toString(16).toUpperCase()}`,
  };
  for (const [k, v] of Object.entries(op)) {
    if (["i", "at", "op", "name", "cat"].includes(k)) continue;
    body[k] = v;
  }
  if (extra) Object.assign(body, extra);
  return JSON.stringify(body, null, 1);
}

/** The route table, flattened for the minimap. */
export function minimapGraph(script: ScriptJson): MinimapGraph {
  return {
    entry: script.entry_block,
    nodes: script.blocks.filter((b) => !b.hole).map((b) => ({
      index: b.index,
      kind: script.routes[b.index]?.kind ?? "end",
      next: script.routes[b.index]?.next ?? [],
    })),
  };
}
