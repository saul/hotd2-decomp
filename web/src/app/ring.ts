/**
 * The history a `rewind` walks back through.
 *
 * `world.save()` already returns a plain value that fully determines the next
 * frame — that is the property `docs/PLAYER_ARCHITECTURE.md` calls "snapshot
 * as proof", and it is what the whole `game/` boundary is paid for. Until this
 * file there was exactly **one** slot for it, the Save button's, so the only
 * way back to a moment was to have known in advance that it mattered. The
 * awkward bug is the one that does not announce itself: *it only happens after
 * the second zombie dies.*
 *
 * A fixed ring of those same values is the whole feature. It adds no new kind
 * of state, and — this is the part worth insisting on — **a rewind is a
 * `World.load`**, the identical path a Load and a seek take, so it cannot
 * leave a rig in a pose play would never produce. `test:scope` and
 * `test:state` already guard that path; this reuses it rather than growing a
 * second one beside it.
 *
 * ## The cadence, and what it costs
 *
 * Measured, not assumed, on the shipped bundle: a snapshot of stage 1 at frame
 * 1860 with 24 actors in the pool is **51.6 KiB of JSON** and `world.save()`
 * costs **0.30 ms** — the `structuredClone` of `G` plus the actor list. An
 * empty pool is 6.9 KiB and 0.05 ms.
 *
 * So a snapshot every tick is affordable in CPU (1.8% of a 16.7 ms frame) and
 * useless in reach: sixty of them is one second of history. The cadence is
 * what buys the window.
 *
 * | every | 60 slots reach | cost |
 * |---|---|---|
 * | 1 tick | 1 s | 18 ms/s |
 * | 30 ticks | **30 s** | **0.6 ms/s, ~3 MiB** |
 * | 120 ticks | 2 min | 0.15 ms/s |
 *
 * Half a second, sixty deep: **thirty seconds of history for about 3 MiB and
 * 0.6 ms of work a second**, which is 0.04% of the frame budget and one
 * 0.30 ms hitch every thirtieth frame. Half a second is also about the finest
 * granularity a person can aim a rewind at, so a finer cadence would be paying
 * memory for a distinction nobody can use.
 *
 * ## It is memory, so it is bounded
 *
 * By slot count, in one place ({@link SnapshotRing.SLOTS}), and the oldest is
 * dropped rather than the newest refused. A stage load clears it: a snapshot
 * from another stage is refused by `snapshotRefusal` anyway, so holding one is
 * three megabytes of guaranteed waste.
 *
 * ## One timeline
 *
 * The ring holds a strictly increasing history of *the run you are on*. Both
 * entry points therefore drop every slot at or after the frame they are
 * handed: after a rewind, a seek or a load, the frames the ring was holding
 * are the future of a timeline that no longer exists, and offering them back
 * would be offering a state this run never passed through.
 */
import type { Snapshot } from "../core/snapshot";

/** How much history the ring is holding, for the transport's label. */
export interface HistoryView {
  /** Slots held. */
  readonly depth: number;
  /** Game frames from the oldest slot to the newest. */
  readonly frames: number;
}

export class SnapshotRing {
  /**
   * Ticks between slots. See the table above — this is the cadence that turns
   * sixty slots into thirty seconds.
   */
  static readonly EVERY = 30;

  /** The bound. Sixty of them, at the measured 51.6 KiB, is about 3 MiB. */
  static readonly SLOTS = 60;

  /** Oldest first. Never longer than {@link SLOTS}. */
  private readonly slots: Snapshot[] = [];

  /**
   * Offer this frame's state; a snapshot is taken only when one is due.
   *
   * The callback rather than the value, so that the cost of `world.save()` is
   * paid on the thirtieth frame and not on the other twenty-nine.
   */
  offer(frame: number, take: () => Snapshot): void {
    this.dropFrom(frame);
    const last = this.slots[this.slots.length - 1];
    if (last && frame - last.frame < SnapshotRing.EVERY) return;
    this.slots.push(take());
    if (this.slots.length > SnapshotRing.SLOTS) this.slots.shift();
  }

  /**
   * The newest state strictly older than `frame`, removed from the ring.
   *
   * Removed, because after it is loaded it *is* the present, and a ring that
   * kept it would answer the next rewind with the frame you are standing on.
   * Pressing rewind repeatedly therefore walks back a cadence at a time.
   *
   * The first press of a burst can be a short hop — up to `EVERY` ticks have
   * passed since the newest slot was taken — which is the honest answer to
   * "the most recent state before now" rather than a rounded one.
   */
  take(frame: number): Snapshot | null {
    this.dropFrom(frame);
    return this.slots.pop() ?? null;
  }

  /** Forget everything. A stage load is the caller. */
  clear(): void {
    this.slots.length = 0;
  }

  /** What the transport's label reads. */
  get view(): HistoryView {
    const first = this.slots[0];
    const last = this.slots[this.slots.length - 1];
    return {
      depth: this.slots.length,
      frames: first && last ? last.frame - first.frame : 0,
    };
  }

  /** Everything at or after `frame` is another timeline's. See the header. */
  private dropFrom(frame: number): void {
    while (this.slots.length
           && this.slots[this.slots.length - 1].frame >= frame) {
      this.slots.pop();
    }
  }
}
