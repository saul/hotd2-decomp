/**
 * Class 0x45's two random sources and its sound helper.
 *
 * * CRT `rand()` (`0x004ABE60`) -- the attack delay, the "both players fired"
 *   coin flips and the Original-Mode weapon pick, each a separate draw. The
 *   port's `rand()` is the world's `Rng` (`ClassFrame.rng`), which a
 *   snapshot carries; the arithmetic on its result is the engine's.
 * * `Boss3NextRand` -- a counter, not a generator, seeded per fight by the
 *   class handler and stored in `G`.
 */
import type { Events } from "../../core/events";
import type { Rng } from "../../core/rng";
import { G } from "../globals";
import { BOSS3_SOUNDS_ST3, BOSS3_SOUNDS_ST6 } from "./tables";

/** `RAND_MAX + 1` -- the MSVC CRT's `rand()` returns 15 bits. */
const CRT_RAND_RANGE = 0x8000;

/**
 * CRT `rand()` (`0x004ABE60`), drawn from the world's generator: a value in
 * `0..0x7FFF`, which every caller here then reduces itself.
 * `[port-only]` as a function.
 */
export function CrtRand(rng: Rng): number {
  return rng.int(CRT_RAND_RANGE);
}

/**
 * `Boss3NextRand` — `FUN_00421910`. `++g_boss3_rand_counter; return counter
 * % (n + 1)`, the division unsigned (`DIV ECX`) on the 32-bit counter.
 */
export function Boss3NextRand(n: number): number {
  G.g_boss3_rand_counter = (G.g_boss3_rand_counter + 1) >>> 0;
  const d = (n + 1) >>> 0;
  return d === 0 ? 0 : G.g_boss3_rand_counter % d;
}

/**
 * `Boss3PlayStageSound` — `FUN_004207D0`. `PlaySoundId` of entry `n` of
 * `g_boss3_sounds_st3` (`0x00588EA4`) when `g_scene_index` is 2, and of
 * `g_boss3_sounds_st6` (`0x00588EC0`) otherwise: `STAGE3_SE\BOSS3_n` or
 * `STAGE6_SE\BOSS3_n`.
 */
export function Boss3PlayStageSound(n: number, events?: Events): void {
  const table = G.g_scene_index === 2 ? BOSS3_SOUNDS_ST3 : BOSS3_SOUNDS_ST6;
  PlaySoundId(table[n] ?? 0, events);
}

/**
 * `PlaySoundId` (`FUN_0041CFD0`) -- the port raises `sound.play` wherever a
 * class makes the call, and the host plays it. `[port-only]` as a function.
 */
export function PlaySoundId(id: number, events?: Events): void {
  if (id) events?.emit("sound.play", { id });
}
