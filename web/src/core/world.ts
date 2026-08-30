/**
 * The registry and the tick order.
 *
 * Systems run in the order the engine's own frame does:
 *
 * ```
 * script -> game -> render -> hud
 * ```
 *
 * The script decides what exists, the port decides where it is and what it is
 * doing, the renderer reads that, and the HUD reads the lot. Adding a system
 * is one `world.add(...)` and never touches the loop.
 */
import type { Context, System, Tick } from "./system";
import { SNAPSHOT_VERSION, clonePlain, snapshotRefusal, type Snapshot }
  from "./snapshot";

export type Phase = "script" | "game" | "render" | "hud";

const ORDER: Phase[] = ["script", "game", "render", "hud"];

export class World {
  private readonly byPhase = new Map<Phase, System[]>(
    ORDER.map((p) => [p, [] as System[]]));

  add<T extends System>(phase: Phase, system: T): T {
    this.byPhase.get(phase)!.push(system);
    return system;
  }

  /** Every system, in tick order. */
  *systems(): Generator<System> {
    for (const p of ORDER) yield* this.byPhase.get(p)!;
  }

  attach(ctx: Context): void {
    for (const s of this.systems()) s.attach?.(ctx);
  }

  detach(ctx: Context): void {
    for (const s of this.systems()) s.detach?.(ctx);
  }

  update(ctx: Context, t: Tick): void {
    for (const s of this.systems()) s.update?.(ctx, t);
  }

  /**
   * The whole game state as plain JSON.
   *
   * A system that implements `save` contributes a slice under its id; every
   * other system is expected to rebuild itself from those in `resync`.
   */
  save(ctx: Context): Snapshot {
    const parts: Record<string, unknown> = {};
    for (const s of this.systems()) {
      if (!s.save) continue;
      if (parts[s.id] !== undefined) {
        throw new Error(`two systems share the id "${s.id}"`);
      }
      // structuredClone here rather than at the call site, so a system that
      // hands back a live reference to its own state fails now instead of
      // producing a snapshot that quietly aliases the running game.
      parts[s.id] = clonePlain(s.save());
    }
    return {
      version: SNAPSHOT_VERSION,
      stage: ctx.stage,
      frame: ctx.frame,
      rng: ctx.rng.state,
      parts,
    };
  }

  /**
   * Restore one. Returns null on success, or the reason it was refused —
   * refusing outright, because a half-applied snapshot is indistinguishable
   * from a gameplay bug.
   */
  load(snap: Snapshot, ctx: Context): string | null {
    const refusal = snapshotRefusal(snap, ctx.stage);
    if (refusal) return refusal;
    ctx.rng.state = snap.rng >>> 0;
    ctx.frame = snap.frame;
    for (const s of this.systems()) {
      if (!s.load) continue;
      const slice = snap.parts[s.id];
      if (slice === undefined) continue;
      s.load(clonePlain(slice), ctx);
    }
    // Second pass: the renderers rebuild from the state the first pass put
    // back. Split in two because a renderer's resync may read another
    // system's restored slice, and a single pass would race the order.
    for (const s of this.systems()) s.resync?.(ctx);
    return null;
  }
}
