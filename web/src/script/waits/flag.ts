/**
 * `wait_script_flag` (0x45).
 *
 * `EvtOpWaitScriptFlag45` (`FUN_0045FC80`) is four lines:
 *
 * ```c
 * if (g_evt_yield == 0) { g_evt_yield = 1; return; }
 * if (g_script_flags[pc[1]] != 0 && g_evt_gameplay_live != 0) {
 *     g_evt_yield = 0; pc += 8;
 * }
 * ```
 *
 * **One array, and gameplay writes it too.** `g_script_flags` (0x009C7200) has
 * seven writers in the image and only one of them is the script's own
 * `EvtOpSetScriptFlag48` (`FUN_0045FD70`). The others are actors:
 * `CivilianRunScript`'s op 0x1C, `ZombieStateTargetScriptWithFlag` (class 0x30
 * state 36), `FUN_00433f40` (a class-0x33 cue prop), `FUN_00473cf0` and the
 * class-0x44 constructor at `0x0047314A`. So this opcode is the script's one
 * way to **wait on an actor finishing**, and a rule that can only see the
 * script's own writes cannot evaluate it at all.
 *
 * That is what this file used to be. It read a `Set<number>` the walker kept
 * beside `G`, so a flag no `set_script_flag` in the stage ever names — and
 * that is every one of the forty-odd shipped gates bar two — passed on the
 * frame it was reached. Stage 3 block 2 step 3's `wait_script_flag 0x1E` is
 * the shape: flag 30 is raised by the hostage's own stream (`entries[27]` ->
 * stream 64 command 17 when she is rescued; stream 63 command 12 when she is
 * shot or mauled), and with the wait passing on sight the script left the
 * rescue behind and step 4's boat shot sailed straight past her and her
 * captor. See `docs/BUGS.md`, "the civilian/enemy are jumped over".
 *
 * `g_evt_gameplay_live` (`0x007DCCA4`) is **not** modelled: it is the engine's
 * "may the script advance" — a player in state 5 with lives left — and the
 * port has no continue screen to freeze for. `[open]`.
 *
 * The first-visit yield is not modelled either; that is the standing
 * `[diverges]` on `0x41`/`0x42`/`0x45` described in {@link WaitRule.enter}.
 */
import type { OpJson, ScriptJson } from "../../bundle";
import { T } from "../../game/tables";
import type { WaitPolicy } from "../walker";
import { passedBecause, type WaitContext, type WaitRule } from "./types";

/**
 * `CivilianOp.SetScriptFlag` as a bare number.
 *
 * Deliberately not imported from `game/class10/ops.ts`: this module is on the
 * walker's construction path and that one pulls the whole class-0x10 VM in
 * behind it. The value is the engine's opcode and `class10/ops.ts`'s enum is
 * where it is documented.
 */
const CIVILIAN_OP_SET_SCRIPT_FLAG = 0x1c;

let cache: {
  script: ScriptJson;
  civ: typeof T.civilians;
  chars: typeof T.chars;
  flags: ReadonlySet<number>;
} | null = null;

/**
 * The flags **something this port runs can actually raise**, for one bundle.
 * `[diverges]`
 *
 * The engine needs no such set: every writer of `g_script_flags` is code it is
 * running. This port runs some of them and not others, and that difference is
 * the whole of this divergence — a gate on a flag whose writer is not ported
 * is a gate nothing can ever open, and a faithful `0x45` parks the stage on it
 * for good. Measured over the six shipped scripts, honouring every gate
 * unconditionally parks **stage 5 at block 1**, **stage 1 at blocks 14 and
 * 16**, stage 2 at blocks 35–41, stage 4 at blocks 23–29, and all six on
 * their opening chapter card.
 *
 * So this is the rule `WAIT_NOTES` already states for every other opcode —
 * *a wait this client cannot evaluate does not block* — made precise instead
 * of blanket. It is **derived from the bundle**, not hand-listed, so it
 * shrinks by itself as writers are ported and there is not a single flag
 * number in this file.
 *
 * The three writers the port has:
 *
 * * `EvtOpSetScriptFlag48` — any `set_script_flag` in this stage's script.
 * * `CivilianRunScript` op 0x1C — every stream reachable from a class-0x10
 *   spawn's own entry, following the `SetOnShot`/`SetResume` operands, because
 *   the rescued and the killed paths of one encounter raise the flag from
 *   different streams.
 * * `ZombieStateTargetScriptWithFlag` — a captor script entry's fifth short.
 *
 * The ones it has not, and what each costs today:
 *
 * * `FUN_00433f40`, a class-0x33 cue prop that plays a sound, raises a flag
 *   from its descriptor and despawns — `[likely]` stage 5's flags 0, 30 and 31
 *   and stage 1's flag 3.
 * * `FUN_00473cf0` and the class-0x44 constructor at `0x0047314A` — the prop
 *   family; `[open]` which owns which flag. Stage 2's flags 10–17 and stage
 *   4's 20, 31 and 32 are theirs or the banner's.
 * * whatever places the **banner** actors, which is `EvtOpSpawnSimple0A` —
 *   opcode `0x0A`, whose operand is a two-word `{class, hp}` record rather
 *   than a placement descriptor and which this port does not implement at all.
 *   Flag **248** is the chapter card (`[proved]`:
 *   `MOV byte ptr [0x009C72F8], 0x1` at `0x004348C1`) and **254** the
 *   stage-clear card (`[likely]`, from the data: each of its five waits sits
 *   in a step that opens with a pair of `spawn_simple` calls). Twelve gates
 *   between them, one per stage opening and one per result screen.
 */
export function ScriptFlagsThisBundleCanRaise(
    script: ScriptJson): ReadonlySet<number> {
  const civ = T.civilians;
  const chars = T.chars;
  if (cache && cache.script === script && cache.civ === civ
      && cache.chars === chars) {
    return cache.flags;
  }
  const flags = new Set<number>();

  // `set_script_flag`, wherever it appears in this stage.
  for (const b of script.blocks ?? []) {
    for (const st of b.steps ?? []) {
      for (const op of st.ops ?? []) {
        if (op.op === 0x48 && op.flag !== undefined) flags.add(op.flag);
      }
    }
  }

  // The civilians' op 0x1C, over every stream a spawn can reach.
  const seen = new Set<number>();
  const walk = (id: number): void => {
    const stream = civ?.scripts?.[id];
    if (!stream || seen.has(id)) return;
    seen.add(id);
    for (const c of stream) {
      if (c.op === CIVILIAN_OP_SET_SCRIPT_FLAG && c.args[0] !== undefined) {
        flags.add(c.args[0]);
      }
      for (const s of c.scripts ?? []) walk(s);
    }
  };
  for (const sp of Object.values(civ?.spawns ?? {})) {
    walk(civ?.entries?.[sp.script] ?? -1);
  }

  // The captors' state 36, whose script entries carry a fifth short.
  for (const p of chars?.placements ?? []) {
    for (const s of [p.target_script, p.attack_script]) {
      for (const e of s?.entries ?? []) {
        if (e.flag !== undefined) flags.add(e.flag);
      }
    }
  }

  cache = { script, civ, chars, flags };
  return flags;
}

export const waitScriptFlag: WaitRule = {
  ops: [0x45],
  raisesScriptFlag: true,
  enter(op: OpJson, ctx: WaitContext): WaitPolicy {
    const index = op.arg ?? 0;
    // A host with no object pool cannot raise any of these — see
    // `WalkerHost.scriptFlagRaised`.
    const raised = ctx.host.scriptFlagRaised(index);
    if (raised === null) return passedBecause(op);
    if (raised) {
      return { kind: "passed",
               why: `g_script_flags[${index}] is already raised` };
    }
    if (!ScriptFlagsThisBundleCanRaise(ctx.script).has(index)) {
      return { kind: "passed",
               why: "[diverges] nothing this port runs raises "
                  + `g_script_flags[${index}]` };
    }
    return { kind: "flag", index };
  },
  satisfied(policy: WaitPolicy, op: OpJson, ctx: WaitContext): boolean {
    return ctx.host.scriptFlagRaised(
      policy.kind === "flag" ? policy.index : (op.arg ?? 0)) === true;
  },
};
