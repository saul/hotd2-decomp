/**
 * The three room-clear gates: `wait_enemies_present` (0x43),
 * `wait_enemies_alive` (0x44), and the civilian gate `wait_scripted_actors`
 * (0x46) that is byte for byte the same handler on a third counter.
 *
 * **They are three counters, not one.** `EvtOpWaitEnemiesPresent43`
 * (`FUN_0045FBC0`) reads `g_enemies_present` (`0x009C7006`),
 * `EvtOpWaitEnemiesAlive44` (`FUN_0045FC10`) reads `g_enemies_alive`
 * (`0x009C904A`), and `EvtOpWaitScriptedActors46` (`FUN_0045FCD0`) reads
 * `g_civilians_alive` (`0x009CA0E8`). The port used to answer 0x43 with the
 * alive count as well, which collapsed the one distinction the game keeps two
 * counters to make: **a corpse is present and not alive**, so a 0x43 gate is
 * supposed to hold for the length of the death clip after a 0x44 gate would
 * have opened.
 *
 * **None of the three may pass on the frame it is reached.** All three open
 * with `if (g_evt_yield == 0) { g_evt_yield = 1; return; }` — the first-visit
 * yield of `EvtInterpreterLoop`'s `do { … } while (g_evt_yield == 0)`, which
 * ends the VM's frame *before* the condition is ever tested. That is
 * transcribed here as `enter` never returning `passed` for a condition it can
 * evaluate: {@link WaitRule.enter} is the first visit, {@link
 * WaitRule.satisfied} is every later one.
 *
 * That yield is the whole of both **B4** and **B8**. The port materialises the
 * script's character spawns in `app/systems.ts`'s `syncCharacterSpawns`, which
 * runs *between* `walker.tick()` and `GameUpdate()` — so an actor spawned by
 * an instruction does not exist, and is not in either counter, until the tick
 * that ran the instruction is over. The engine has no such gap:
 * `EvtOpSpawnObj0B` calls `SpawnFromDescriptor` and `EnemyZombieInit`
 * (`FUN_00452DA0`) does the two `INC`s inside that call. Stage 1 block 4 step
 * 5 is the shape that exposed it — `spawn_obj` (two zombies on the high
 * ledge), `queue_event`, `wait_enemies_alive 0`, with nothing between them —
 * and with the gate free to answer on its own frame it read the count as 0,
 * passed, and the block advanced while the two were still falling.
 *
 * With shooting off, nothing can make a count fall, so the gate is not a
 * condition this client can evaluate and it passes — see `WAIT_NOTES`. It used
 * to be paced on a stopwatch instead, a stand-in from before the player could
 * shoot, which only ever produced a wait of an invented length.
 */
import type { OpJson } from "../../bundle";
import { G } from "../../game/globals";
import type { WaitPolicy } from "../walker";
import { passedBecause, type WaitContext, type WaitRule } from "./types";

/**
 * `EvtOpWaitEnemiesPresent43` (`FUN_0045FBC0`) — `g_enemies_present <= operand`
 * with the camera back on its rail.
 *
 * The looser counter of the two: `ZombieEnterCorpseState` (`FUN_00456740`)
 * drops it when the death clip ends, where `ZombieReleasePermitAndUntrack`
 * (`FUN_004565A0`) drops the alive count as the death state opens. 54 of the
 * 488 enemy gates in the shipped scripts are this opcode.
 */
export const waitEnemiesPresent: WaitRule = {
  ops: [0x43],
  retires: "enemies",
  enter(op: OpJson, ctx: WaitContext): WaitPolicy {
    if (ctx.host.presentEnemies() === null) return passedBecause(op);
    // `if (g_evt_yield == 0) { g_evt_yield = 1; return; }` — the condition is
    // not read on this frame at all.
    return { kind: "enemies" };
  },
  satisfied(_policy, op: OpJson, ctx: WaitContext): boolean {
    return (ctx.host.presentEnemies() ?? 0) <= (op.arg ?? 0)
      && ctx.cameraHasHandedBack();
  },
};

/**
 * `EvtOpWaitEnemiesAlive44` (`FUN_0045FC10`) — the same handler on
 * `g_enemies_alive`, and **one extra frame** on top of the yield.
 *
 * ```c
 * if (g_evt_yield == 0) { g_evt_yield = 1; return; }
 * if (g_enemies_alive <= operand && g_evt_gameplay_live
 *     && g_camera_free && 0 < g_evt_wait_alive_hysteresis) {
 *     g_evt_wait_alive_hysteresis = 0; g_evt_yield = 0; pc += 8; return;
 * }
 * g_evt_wait_alive_hysteresis++;
 * ```
 *
 * The counter is zeroed only on the pass, never when the condition fails, so
 * this is not "the count must be low two frames running" — it is "this
 * instruction must have been evaluated and refused at least once". 434 of the
 * 488 enemy gates are this opcode, which is why it is the one both bug reports
 * landed on.
 */
export const waitEnemiesAlive: WaitRule = {
  ops: [0x44],
  retires: "enemies",
  enter(op: OpJson, ctx: WaitContext): WaitPolicy {
    if (ctx.host.aliveEnemies() === null) return passedBecause(op);
    return { kind: "enemies" };
  },
  satisfied(_policy, op: OpJson, ctx: WaitContext): boolean {
    const pass = (ctx.host.aliveEnemies() ?? 0) <= (op.arg ?? 0)
      && ctx.cameraHasHandedBack()
      && G.g_evt_wait_alive_hysteresis > 0;
    if (pass) G.g_evt_wait_alive_hysteresis = 0;
    else G.g_evt_wait_alive_hysteresis += 1;
    return pass;
  },
};

/**
 * `EvtOpWaitScriptedActors46` (`FUN_0045FCD0`) — byte for byte the
 * `wait_enemies_present` handler with `g_civilians_alive` (`0x009CA0E8`) in
 * place of `g_enemies_present`, so it is paced the same way, yield and all.
 *
 * Every one of the 68 sites in the shipped scripts passes operand 0, so in
 * practice this is always "wait until the last civilian has left play" — but
 * the comparison is transcribed, not folded to `=== 0`.
 */
export const waitScriptedActors: WaitRule = {
  ops: [0x46],
  // Same reason as its enemy twins above, and it was missing: a seek that
  // stepped over this one kept the previous scene's civilians, so they were
  // spawned into the block it landed in, counted in `g_civilians_alive`, and
  // held the *next* one of these open for ever.
  retires: "civilians",
  enter(op: OpJson, ctx: WaitContext): WaitPolicy {
    if (ctx.host.aliveCivilians() === null) return passedBecause(op);
    return { kind: "civilians" };
  },
  satisfied(_policy, op: OpJson, ctx: WaitContext): boolean {
    return (ctx.host.aliveCivilians() ?? 0) <= (op.arg ?? 0)
      && ctx.cameraHasHandedBack();
  },
};
