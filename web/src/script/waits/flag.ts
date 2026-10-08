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
 * **One array, and gameplay writes it too.** `g_script_flags` (0x009C7200) is
 * written from all over the image, and only one of those writers is the
 * script's own `EvtOpSetScriptFlag48` (`FUN_0045FD70`). The rest are actors:
 * `CivilianRunScript`'s op 0x1C, `ZombieStateTargetScriptWithFlag` (class 0x30
 * state 36), `FUN_00433f40` (a class-0x33 cue prop), `FUN_00473cf0`, the
 * class-0x44 constructor at `0x0047314A`, the two banner cards, classes 0x14,
 * 0x19, 0x22 and 0x32, and `PropUpdateType75` (`FUN_004710C0`) — which alone
 * writes flag 20 from three different instructions. So this opcode is the
 * script's one way to **wait on an actor finishing**, and a rule that can only
 * see the script's own writes cannot evaluate it at all.
 *
 * That count was quoted here as "seven" for a while, from a search over one
 * addressing mode. It is not seven; see `L32`.
 *
 * That is what this file used to be. It read a `Set<number>` the walker kept
 * beside `G`, so a flag no `set_script_flag` in the stage ever names — and
 * that is every one of the forty-odd shipped gates bar two — passed on the
 * frame it was reached. Stage 3 block 2 step 3's `wait_script_flag 0x1E` is
 * the shape: flag 30 is raised by the hostage's own stream (`entries[27]` ->
 * stream 64 command 17 when she is rescued; stream 63 command 12 when she is
 * shot or mauled), and with the wait passing on sight the script left the
 * rescue behind and step 4's boat shot sailed straight past her and her
 * captor.
 *
 * `g_evt_gameplay_live` (`0x007DCCA4`) is the engine's "may the script
 * advance" -- a player in state 5 with lives left -- and it is what holds the
 * script on the continue screen. `WaitContext.gameplayLive` answers it.
 *
 * The first-visit yield is modelled: the wait is never passed on the frame it
 * is reached, raised flag or not.
 */
import type { CiviliansJson, OpJson, ScriptJson } from "../../bundle";
import { g_class_handlers, type SpawnRecord } from "../../game/registry";
import type { SpawnClass } from "../../game/spawn_class";
import { T } from "../../game/tables";
import type { WaitPolicy } from "../walker";
import { YieldBecause, type WaitContext, type WaitRule } from "./types";

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
  // `T.breakables` is in the key because a class may answer
  // `raisesScriptFlag` out of it — class 0x41 does — so a bundle swapped
  // under a cached answer would keep the previous stage's props' verdict.
  breakables: typeof T.breakables;
  flags: ReadonlySet<number>;
} | null = null;

/**
 * The flags **something this port runs can actually raise**, for one bundle.
 * `[port-only]`: a measurement, not a rule the walker applies.
 *
 * The engine needs no such set: every writer of `g_script_flags` is code it is
 * running. The port runs a writer once its routine is ported, and a
 * `wait_script_flag` on a flag whose writer is not ported is a gate the stage
 * would park on for ever. So `web/tools/flag_gates.ts` runs this over the
 * twelve bundles and fails on any gate outside it. It is **derived**, not
 * hand-listed, and there is not a single flag number in this file.
 *
 * ## What it is derived from
 *
 * * `EvtOpSetScriptFlag48` — any `set_script_flag` in this stage's script.
 * * `CivilianRunScript` op 0x1C — every stream reachable from a class-0x10
 *   spawn's own entry, following the `SetOnShot`/`SetResume` operands, because
 *   the rescued and the killed paths of one encounter raise the flag from
 *   different streams.
 * * `ZombieStateTargetScriptWithFlag` — a captor script entry's fifth short.
 * * {@link ClassHandler.raisesScriptFlag} — a class whose flag is a **literal
 *   in its own routine**, for every spawn of that class in this stage. A class
 *   may answer per **record** rather than per class, and class 0x41 does: its
 *   flag belongs to one of its 79 constructors, so a class-wide answer would
 *   claim it for all 441 of the six stages' class-0x41 spawns.
 *
 * ## Nothing is excused
 *
 * `waitScriptFlag` used to pass, under a declared divergence of its own, on
 * any gate outside this set, so that a stage whose flag writer had no module
 * went on rather than parking. The last such gate was stage 5's
 * `wait_script_flag 30` at step 4 of blocks 7 and 9, whose writer is class
 * 0x32's state 4 (`Class32StateRaiseFlagAndLeave`, `FUN_00480470`, the write
 * at `0x00480590`); with the class ported every shipped gate has a writer the
 * port runs, and the wait blocks as the engine's does. Every other gate --
 * the two cards', classes 0x14, 0x19, 0x22 and 0x32's, class 0x41's type 75,
 * the civilians' op 0x1C and the captors' state 36 -- was honoured already.
 *
 * The row this file's table once carried for class 0x14 said "stage 2's
 * blocks 35-41 **and stage 4's 23-29**", and the second half was wrong: stage
 * 4 has no class-0x14 spawn at all, and its four blocks gate on 31 and 32,
 * both of which class 0x19 writes. Flag 31 has two writers and the stage
 * decides which one is in the room.
 *
 * The five reports that opened this line of work asked for "one spawn opcode
 * and two cue props"; the sweep that was written to check it says otherwise,
 * and that estimate is wrong. The two
 * cue props — `FUN_00433F40` (class 0x33) and `FUN_00473CF0` (`HingeUpdate`) —
 * turn out to open **no gate in any shipped script**: every flag they write
 * comes off a descriptor, and no `wait_script_flag` in the game names one.
 *
 * ## Class 0x19's writes
 *
 * The stage-4 boss (`game/class19/`) declares `raisesScriptFlag` for both of
 * its flags, **31** and **32**. The survey this file used to carry named
 * `0x0049390C` and `0x004958C7` as class 0x19's two writes. There are
 * **three**: `0x00493B99` is the second entrance routine's own copy of the
 * flag-31 write, and without it blocks 25 and 29 would have had no writer at
 * all. Found by searching the bare `9c72` over the class's range (L32), which
 * is the same search that produced this table in the first place.
 */
export function ScriptFlagsThisBundleCanRaise(
    script: ScriptJson): ReadonlySet<number> {
  const civ = T.civilians;
  const chars = T.chars;
  const breakables = T.breakables;
  if (cache && cache.script === script && cache.civ === civ
      && cache.chars === chars && cache.breakables === breakables) {
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

  // ...and the classes whose flag is a **literal in their own routine** rather
  // than a field of a descriptor, declared by the class module that ports it
  // — `ClassHandler.raisesScriptFlag`. Both spawn opcodes are walked, because
  // the two the port has from `spawn_simple` are the cards, and the placed
  // ones are the bosses and a class-0x41 prop.
  const declared = (r: SpawnRecord): void => {
    for (const f of DeclaredScriptFlags(r)) flags.add(f);
  };
  for (const b of script.blocks ?? []) {
    for (const st of b.steps ?? []) {
      for (const op of st.ops ?? []) {
        for (const r of op.simple ?? []) declared(r);
        for (const r of op.spawns ?? []) declared(r);
      }
    }
  }

  cache = { script, civ, chars, breakables, flags };
  return flags;
}

/**
 * The `g_script_flags` bytes a spawn record's class declares it raises --
 * {@link ClassHandler.raisesScriptFlag}, in whichever of its three shapes.
 *
 * [port-only] The engine has no such question; the bundle's own walk and a
 * replay's retirement of a flag's raisers both ask it.
 */
export function DeclaredScriptFlags(r: SpawnRecord): readonly number[] {
  const decl = g_class_handlers[r.class as SpawnClass]?.raisesScriptFlag;
  // A class may answer per record rather than per class: class 0x41's flag
  // belongs to one of its 79 constructors and not to the class. And it may
  // answer with several: class 0x14 writes nine. See
  // `ClassHandler.raisesScriptFlag`.
  const f = typeof decl === "function" ? decl(r) : decl;
  if (f === undefined) return [];
  return typeof f === "number" ? [f] : f;
}

/**
 * Whether the class-0x10 spawn at `at` runs op 0x1C `SetScriptFlag flag` in
 * any stream its entry can reach — the same walk
 * {@link ScriptFlagsThisBundleCanRaise} makes, for one spawn.
 *
 * [port-only] The engine has no such question: it is what a **replay** needs
 * to apply a `wait_script_flag`'s postcondition to the actor that answers it.
 * See `Walker.retireFlagRaisers`.
 */
export function CivilianRaisesScriptFlag(civ: CiviliansJson | undefined,
                                         at: number, flag: number): boolean {
  const sp = civ?.spawns?.[String(at)];
  if (!civ || !sp) return false;
  const seen = new Set<number>();
  const pending = [civ.entries?.[sp.script] ?? -1];
  while (pending.length) {
    const id = pending.pop() as number;
    const stream = civ.scripts?.[id];
    if (!stream || seen.has(id)) continue;
    seen.add(id);
    for (const c of stream) {
      if (c.op === CIVILIAN_OP_SET_SCRIPT_FLAG && c.args[0] === flag) {
        return true;
      }
      for (const s of c.scripts ?? []) pending.push(s);
    }
  }
  return false;
}

export const waitScriptFlag: WaitRule = {
  ops: [0x45],
  raisesScriptFlag: true,
  enter(op: OpJson, ctx: WaitContext): WaitPolicy {
    const index = op.arg ?? 0;
    // A host with no object pool cannot raise any of these — see
    // `WalkerHost.scriptFlagRaised`.
    const raised = ctx.host.scriptFlagRaised(index);
    // `if (g_evt_yield == 0) { g_evt_yield = 1; return; }`: the flag is not
    // read on the frame the wait is reached, raised already or not.
    if (raised === null) return YieldBecause(op);
    // The engine blocks here until the byte comes up. Every shipped gate's
    // writer is ported -- `tools/flag_gates.ts` holds the twelve bundles to
    // {@link ScriptFlagsThisBundleCanRaise} -- so the port blocks too.
    return { kind: "flag", index };
  },
  satisfied(policy: WaitPolicy, op: OpJson, ctx: WaitContext): boolean {
    return ctx.host.scriptFlagRaised(
      policy.kind === "flag" ? policy.index : (op.arg ?? 0)) === true
      && ctx.gameplayLive();
  },
};
