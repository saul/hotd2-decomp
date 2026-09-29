/**
 * Every shader program the page compiles, kept until it closes.
 *
 * `WebGLRenderer` counts a program's users and deletes it when the last
 * material using it is disposed. A layer that makes a material for each
 * effect it spawns and disposes it when the effect ends therefore has its
 * program deleted between spawns, and compiled again at the next -- in a
 * frame, synchronously. A burst of stage 1's blood linked the same program
 * ("common_tex39_constant") fourteen times in 0.2 s, deleting it fourteen
 * times, and a phone pays several times a desktop's 3.5 ms for each.
 *
 * So each program, the first frame it exists, gets one more user that never
 * goes: `usedTimes` never reaches zero and nothing is deleted. There are a
 * few dozen distinct programs in a stage -- a program is a material *kind*,
 * not a material -- and a stage switch mostly reuses them, so keeping them all
 * is cheap. `usedTimes` is three.js's own count (`WebGLPrograms`
 * `acquireProgram` / `releaseProgram`), and `renderer.info.programs` is that
 * module's list of live programs.
 */
import type { WebGLRenderer } from "three";

export class ProgramPins {
  private readonly pinned = new WeakSet<object>();
  private seen = -1;

  /** Pin whatever is new since the last call. Cheap when nothing is. */
  pin(renderer: WebGLRenderer): void {
    const programs = renderer.info.programs;
    // Pinned programs never go, so the list only grows: its length says
    // whether there is anything new.
    if (!programs || programs.length === this.seen) return;
    for (const p of programs) {
      if (this.pinned.has(p)) continue;
      this.pinned.add(p);
      p.usedTimes++;
    }
    this.seen = programs.length;
  }
}
