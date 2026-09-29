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

/**
 * Timing each system's update, from outside.
 *
 * The engine reads no clock (`web/tools/repo/layers.ts`: a clock cannot be
 * replayed from a snapshot), so the clock is the caller's: `app/perf.ts`
 * installs one of these while the perf meter is on, and the world only hands
 * it each system as it runs. Nothing the systems do depends on it, and with
 * none installed the loop is the plain one.
 */
export interface SystemProbe {
  now(): number;
  took(id: string, phase: Phase, ms: number): void;
}

/**
 * `C` is the context this world's systems are handed. `app/` builds one
 * concrete object and names its widest type here; an engine system that only
 * declares `Context` is still accepted, because a function that takes the
 * narrow one takes the wide one too.
 */
export class World<C extends Context = Context> {
  private readonly byPhase = new Map<Phase, System<C>[]>(
    ORDER.map((p) => [p, [] as System<C>[]]));

  add<T extends System<C>>(phase: Phase, system: T): T {
    this.byPhase.get(phase)!.push(system);
    return system;
  }

  /** Every system, in tick order. */
  *systems(): Generator<System<C>> {
    for (const p of ORDER) yield* this.byPhase.get(p)!;
  }

  attach(ctx: C): void {
    for (const s of this.systems()) s.attach?.(ctx);
  }

  detach(ctx: C): void {
    for (const s of this.systems()) s.detach?.(ctx);
  }

  /** See {@link SystemProbe}. Null unless something is measuring. */
  probe: SystemProbe | null = null;

  /**
   * Systems that do not run: neither `update` nor `resync` reaches them.
   *
   * A netplay replica's world holds the port's simulation this way -- the
   * game update, the rain, anything that writes the state -- because its
   * state is the host's, applied a tick at a time, and a system of its own
   * writing into it would be a second author the host never hears from. They
   * stay registered, so `save`/`load` still see their slices and a keyframe
   * still loads through them. Empty in every other role.
   */
  private dormant: ReadonlySet<System<C>> = new Set();

  setDormant(systems: Iterable<System<C>>): void {
    this.dormant = new Set(systems);
  }

  update(ctx: C, t: Tick): void {
    const probe = this.probe;
    const dormant = this.dormant;
    if (!probe) {
      for (const s of this.systems()) {
        if (s.update && !dormant.has(s)) s.update(ctx, t);
      }
      return;
    }
    for (const p of ORDER) {
      for (const s of this.byPhase.get(p)!) {
        if (!s.update || dormant.has(s)) continue;
        const t0 = probe.now();
        s.update(ctx, t);
        probe.took(s.id, p, probe.now() - t0);
      }
    }
  }

  /**
   * The whole game state as plain JSON.
   *
   * A system that implements `save` contributes a slice under its id; every
   * other system is expected to rebuild itself from those in `resync`.
   */
  save(ctx: C): Snapshot {
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
   *
   * `adopt` hands each system its slice as it is, uncloned. Only for a
   * snapshot nobody else holds -- a netplay keyframe, just decoded -- whose
   * objects are meant to *become* the live state, so that the deltas after it
   * can be applied to them in place. Everything else takes the clone.
   */
  load(snap: Snapshot, ctx: C, opts: { adopt?: boolean } = {}): string | null {
    const refusal = snapshotRefusal(snap, ctx.stage);
    if (refusal) return refusal;
    // **Refuse before restoring anything.** A system that saves a slice and
    // does not get one back keeps whatever the running game had, which is the
    // definition of half-applied -- and the docstring above has been promising
    // to refuse outright since the day it was written while this loop
    // `continue`d past exactly that case. A stale bundle lost collision and
    // civilians this way, silently, because `SNAPSHOT_VERSION` had never moved
    // and so the version check could not catch it either.
    //
    // Only systems that *save* are required to load: a system with `load` and
    // no `save` has nothing to be missing.
    const missing: string[] = [];
    for (const s of this.systems()) {
      if (s.save && s.load && snap.parts[s.id] === undefined) missing.push(s.id);
    }
    if (missing.length > 0) {
      return `snapshot has no slice for ${missing.join(", ")}`;
    }
    ctx.rng.state = snap.rng >>> 0;
    ctx.frame = snap.frame;
    for (const s of this.systems()) {
      if (!s.load) continue;
      const slice = snap.parts[s.id];
      if (slice === undefined) continue;
      s.load(opts.adopt ? slice : clonePlain(slice), ctx);
    }
    // Second pass: the renderers rebuild from the state the first pass put
    // back. Split in two because a renderer's resync may read another
    // system's restored slice, and a single pass would race the order.
    this.resync(ctx);
    return null;
  }

  /**
   * Rebuild everything derived, in tick order.
   *
   * Public because a **seek** needs it as much as a load does: both replace
   * the game state underneath the renderer, and the two going through
   * different rebuild paths is how they came to disagree. A seek has no
   * snapshot to apply, so it calls this on its own.
   */
  resync(ctx: C): void {
    for (const s of this.systems()) {
      if (s.resync && !this.dormant.has(s)) s.resync(ctx);
    }
  }
}
