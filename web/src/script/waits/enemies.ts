/**
 * The two enemy counters' gates: `wait_enemies_alive` (0x43) and
 * `wait_enemies_present` (0x44), and the civilian gate `wait_scripted_actors`
 * (0x46) that is byte for byte the same handler.
 *
 * With shooting on, the gate is the gate: it opens when they are dead. With it
 * off, nothing can make the count fall, so the gate is not a condition this
 * client can evaluate and it passes. It used to be paced on a stopwatch
 * instead — a stand-in from before the player could shoot, which only ever
 * produced a wait of an invented length.
 */
import type { OpJson } from "../../bundle";
import type { WaitPolicy } from "../walker";
import { passedBecause, type WaitContext, type WaitRule } from "./types";

export const waitEnemiesAlive: WaitRule = {
  ops: [0x43, 0x44],
  retires: "enemies",
  enter(op: OpJson, ctx: WaitContext): WaitPolicy {
    const alive = ctx.host.aliveEnemies();
    if (alive === null) return passedBecause(op);
    return alive <= (op.arg ?? 0) && ctx.cameraHasHandedBack()
      ? { kind: "passed", why: "no live enemies, and the camera is back" }
      : { kind: "enemies" };
  },
  satisfied(_policy, op: OpJson, ctx: WaitContext): boolean {
    return (ctx.host.aliveEnemies() ?? 0) <= (op.arg ?? 0)
      && ctx.cameraHasHandedBack();
  },
};

/**
 * `EvtOpWaitScriptedActors46` (`FUN_0045FCD0`) — byte for byte the
 * `wait_enemies_present` handler with `g_civilians_alive` (`0x009CA0E8`) in
 * place of `g_enemies_present`, so it is paced the same way.
 *
 * Every one of the 68 sites in the shipped scripts passes operand 0, so in
 * practice this is always "wait until the last civilian has left play" — but
 * the comparison is transcribed, not folded to `=== 0`.
 */
export const waitScriptedActors: WaitRule = {
  ops: [0x46],
  // Same reason as its enemy twin above, and it was missing: a seek that
  // stepped over this one kept the previous scene's civilians, so they were
  // spawned into the block it landed in, counted in `g_civilians_alive`, and
  // held the *next* one of these open for ever.
  retires: "civilians",
  enter(op: OpJson, ctx: WaitContext): WaitPolicy {
    const civilians = ctx.host.aliveCivilians();
    if (civilians === null) return passedBecause(op);
    return civilians <= (op.arg ?? 0) && ctx.cameraHasHandedBack()
      ? { kind: "passed", why: "no civilians in play, and the camera is back" }
      : { kind: "civilians" };
  },
  satisfied(_policy, op: OpJson, ctx: WaitContext): boolean {
    return (ctx.host.aliveCivilians() ?? 0) <= (op.arg ?? 0)
      && ctx.cameraHasHandedBack();
  },
};
