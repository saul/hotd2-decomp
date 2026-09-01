/**
 * Lifetimes with an owner.
 *
 * The player has a lifetime problem the game does not: it holds GPU
 * resources, DOM nodes, listeners and audio, and it can switch stage, seek,
 * and restore a snapshot — none of which the exe can do. Before this, all of
 * it was managed by hand, and the count told the story: 67 `addEventListener`
 * against six `removeEventListener`.
 *
 * A scope is a named node in a disposal tree. Things register with it; when it
 * dies they are undone, children first, in reverse order of registration.
 *
 * It knows only how to undo a closure. **What** needs undoing is the calling
 * layer's business: `render/scope3d.ts` for the scene graph. That split is why
 * there is no `addEventListener` here to type around — the engine does not
 * have to know what a DOM event is. There was an `app/dom.ts` beside it for
 * listeners and timers; React owns every listener the page has since step 26
 * and undoes them on unmount, so it had no callers left and step 28 deleted
 * it.
 *
 * ## The one rule
 *
 * **A scope holds only what is *not* in the snapshot** — which is the same
 * sentence as "a scope holds exactly what `resync` must be able to throw away
 * and rebuild". Two consequences:
 *
 * * **`game/` never gets a scope.** The port transcribes a fixed object pool
 *   and `ActorDespawn`; there is no hierarchy and no arena in the binary, and
 *   inventing one is what `verify_port.py` exists to catch.
 * * **Nothing a scope owns can be game state.** `World.save()` puts every
 *   slice through `clonePlain`, and a graph of disposal closures cannot
 *   survive that.
 *
 * See `docs/PLAYER_ARCHITECTURE.md`, "Scopes: every lifetime has an owner".
 */

/** Anything a scope can own outright. */
export interface Disposable {
  dispose(): void;
}

/** What the debug panel reads. Plain data, so `hud/` needs no import. */
export interface ScopeNode {
  name: string;
  /** The frame this scope was opened at. */
  openedAt: number;
  /** Registrations held directly by this scope, not counting children. */
  owned: number;
  children: ScopeNode[];
}

export class Scope {
  readonly name: string;
  /**
   * `ctx.frame` when this scope was opened.
   *
   * The single most useful number in the panel: a child of `stage` whose frame
   * predates the current stage load is a scope that survived a teardown, and
   * nothing else in the player can tell you that.
   */
  readonly openedAt: number;

  private readonly clock: () => number;
  private readonly kids: Scope[] = [];
  private readonly undo: (() => void)[] = [];
  private parent: Scope | null = null;
  private dead = false;

  /**
   * The root. Every other scope comes from `child`.
   *
   * `clock` is read at open time rather than stored, so the tree records the
   * game's own frame count and not a wall clock — a scope opened during a seek
   * replay is stamped with the frame the replay had reached.
   */
  constructor(name: string, clock: () => number = () => 0) {
    this.name = name;
    this.clock = clock;
    this.openedAt = clock();
  }

  get alive(): boolean {
    return !this.dead;
  }

  /** Registrations held directly, not counting children. */
  get owned(): number {
    return this.undo.length;
  }

  child(name: string): Scope {
    if (this.dead) {
      throw new Error(`scope "${this.name}" is disposed; cannot open "${name}"`);
    }
    const c = new Scope(name, this.clock);
    c.parent = this;
    this.kids.push(c);
    return c;
  }

  /**
   * Undo something when this scope dies.
   *
   * Runs LIFO, so a registration can rely on everything registered before it
   * still being there.
   */
  defer(undo: () => void): void {
    if (this.dead) {
      // Disposing immediately rather than throwing: the caller has already
      // done the thing, and leaking it is worse than an out-of-order undo.
      undo();
      return;
    }
    this.undo.push(undo);
  }

  /** Take ownership of anything with a `dispose()`. Returns it, for chaining. */
  own<T extends Disposable>(t: T): T {
    this.defer(() => t.dispose());
    return t;
  }

  /**
   * Dispose this scope and everything under it.
   *
   * Children first, then this scope's own registrations LIFO. Idempotent: a
   * second call is a no-op, because a teardown path that runs twice is much
   * commoner than one that runs never.
   */
  dispose(): void {
    if (this.dead) return;
    this.dead = true;
    // Snapshot both lists: an undo that opens or closes something would
    // otherwise mutate what is being walked.
    for (const c of this.kids.splice(0)) c.dispose();
    for (const u of this.undo.splice(0).reverse()) {
      // One failing undo must not strand the rest -- a half-disposed scope is
      // exactly the leak this class exists to prevent.
      try {
        u();
      } catch (e) {
        console.error(`scope "${this.name}": undo threw`, e);
      }
    }
    if (this.parent) {
      const i = this.parent.kids.indexOf(this);
      if (i >= 0) this.parent.kids.splice(i, 1);
      this.parent = null;
    }
  }

  /** The live tree as plain data, for the debug panel. */
  snapshot(): ScopeNode {
    return {
      name: this.name,
      openedAt: this.openedAt,
      owned: this.undo.length,
      children: this.kids.map((c) => c.snapshot()),
    };
  }

  /** Every live scope under and including this one. For the leak check. */
  *walk(): Generator<Scope> {
    yield this;
    for (const c of this.kids) yield* c.walk();
  }
}
