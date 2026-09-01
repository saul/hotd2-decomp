/**
 * `wait_script_flag` (0x45).
 *
 * The flag array is written by gameplay, so a flag the script has not already
 * set is not something this client can wait for. One that *is* set passes with
 * a reason that says which — a wait that resolves for a knowable cause reads
 * differently in the feed from one that was never evaluated.
 */
import type { OpJson } from "../../bundle";
import type { WaitPolicy } from "../walker";
import { passedBecause, type WaitContext, type WaitRule } from "./types";

export const waitScriptFlag: WaitRule = {
  ops: [0x45],
  enter(op: OpJson, ctx: WaitContext): WaitPolicy {
    return ctx.flags.has(op.arg ?? 0)
      ? { kind: "passed", why: "flag already set by the script" }
      : passedBecause(op);
  },
};
