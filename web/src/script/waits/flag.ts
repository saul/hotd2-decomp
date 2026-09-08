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
import { g_class_handlers } from "../../game/registry";
import type { SpawnClass } from "../../game/spawn_class";
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
 * for good. So this is the rule `WAIT_NOTES` already states for every other
 * opcode — *a wait this client cannot evaluate does not block* — made precise
 * instead of blanket. It is **derived**, not hand-listed, so it shrinks by
 * itself as writers are ported and there is not a single flag number in this
 * file.
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
 *   in its own routine**, for every spawn of that class in this stage.
 *
 * ## What is still excused, and what each one needs
 *
 * Stages 3 and 6 have none left; the rest are four unported classes and one
 * prop, and every one of the four is an enemy or a boss:
 *
 * | gates | flag(s) | writer |
 * |---|---|---|
 * | 20 | 10..17, 31 | **class 0x14** (`FUN_00475E90`), stage 2's blocks 35-41 and stage 4's 23-29. Its writes are spread over `0x00478350`..`0x0047BA6E`; flag 10's two are `0x0047835B` and `0x004785E4` |
 * | 4 | 32 | **class 0x19**'s death, `Boss4StateDeath` (`FUN_00495770`) at `0x004958C7`. The class **is** ported — see below |
 * | 3 | 0, 3 | **class 0x22** (`FUN_0049B0D0`) — the stage-1 and stage-5 boss, `0x0049CC85` and `0x0049CC95` |
 * | 2 | 30 | **class 0x32** (`FUN_0047F5F0`), state 4 at `0x00480590` |
 * | 1 | 20 | a class-0x41 prop update, `FUN_004710C0` at `0x004710D7` — the one small one left, and the only remaining gate that is not an enemy class |
 *
 * The five reports that opened this line of work asked for "one spawn opcode
 * and two cue props"; the sweep that was written to check it says otherwise,
 * and that estimate is recorded as wrong in `docs/re/session-log.md`. The two
 * cue props — `FUN_00433F40` (class 0x33) and `FUN_00473CF0` (`HingeUpdate`) —
 * turn out to open **no gate in any shipped script**: every flag they write
 * comes off a descriptor, and no `wait_script_flag` in the game names one.
 *
 * ## Class 0x19 is half in and half out, on purpose
 *
 * The stage-4 boss (`game/class19/`) declares `raisesScriptFlag` for **31** and
 * not for 32, so stage 4's four `wait_script_flag 31` gates are honoured and
 * its four `wait_script_flag 32` gates are still excused. That is not a gap
 * left by accident: the port runs the whole of the first chain —
 * `set_script_flag 30` -> the boss's intro banner -> `g_bHudShutterState = 1`
 * -> `g_script_flags[31]` — and cannot yet reach the second, because
 * `Boss4ResolveShot` refuses every shot once the hit points reach the phase
 * floor and only the unported arena progression lifts it. A class that raises
 * two flags and can reach one of them declares one.
 *
 * The survey this file used to carry named `0x0049390C` and `0x004958C7` as
 * class 0x19's two writes. There are **three**: `0x00493B99` is the second
 * entrance routine's own copy of the flag-31 write, and without it blocks 25
 * and 29 would have had no writer at all. Same flag, so the count above does
 * not move; found by searching the bare `9c72` over the class's range (L32),
 * which is the same search that produced this table in the first place.
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

  // ...and the classes whose flag is a **literal in their own routine** rather
  // than a field of a descriptor, declared by the class module that ports it
  // — `ClassHandler.raisesScriptFlag`. Both spawn opcodes are walked, because
  // the two the port has are `spawn_simple`'s and the four it has not are
  // ordinary placements.
  for (const b of script.blocks ?? []) {
    for (const st of b.steps ?? []) {
      for (const op of st.ops ?? []) {
        for (const r of op.simple ?? []) {
          const f = g_class_handlers[r.class as SpawnClass]?.raisesScriptFlag;
          if (f !== undefined) flags.add(f);
        }
        for (const r of op.spawns ?? []) {
          const f = g_class_handlers[r.class as SpawnClass]?.raisesScriptFlag;
          if (f !== undefined) flags.add(f);
        }
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
    // The engine blocks here until the byte comes up, and it always does,
    // because every writer of `g_script_flags` is code the engine is running.
    // This port runs some of those writers and not others, so a gate whose
    // writer has no module is one it could only park on for ever; it passes
    // instead, and says so in the feed. See
    // {@link ScriptFlagsThisBundleCanRaise} for the derivation and for the
    // five classes that would retire it. [diverges]
    if (!ScriptFlagsThisBundleCanRaise(ctx.script).has(index)) {
      return { kind: "passed",
               why: "nothing this port runs raises "
                  + `g_script_flags[${index}]` };
    }
    return { kind: "flag", index };
  },
  satisfied(policy: WaitPolicy, op: OpJson, ctx: WaitContext): boolean {
    return ctx.host.scriptFlagRaised(
      policy.kind === "flag" ? policy.index : (op.arg ?? 0)) === true;
  },
};
