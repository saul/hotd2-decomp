/**
 * The typed bus.
 *
 * Events travel **out** of the port: the game raises them where the engine
 * would set a flag, and the HUD, the feed and the audio subscribe. Nothing may
 * park state here — the queue is not part of a snapshot, so anything that
 * lives only in a pending event would not survive a save.
 */

/** Every event in the player, with its payload. */
export interface EventMap {
  /** `PlayerTakeDamage` ran: one life gone, and why. */
  "player.damaged": {
    /** What delivered it. `PlayerTakeDamage` does not care, but the feed does. */
    source: "strike" | "thrown";
    /** The attacker's spawn address, or -1. */
    at: number;
    /** The attacker's display name. */
    who: string;
    /** The attack index for a strike, else -1. */
    attack: number;
    lives: number;
    score: number;
  };
  /** An enemy's HP reached zero. */
  "enemy.killed": { at: number; head: boolean };
  /** A weapon left a hand. */
  "enemy.threw": { at: number; who: string };
  /** Anything worth a line in the event feed. */
  "feed.note": { name: string; cat: string; note: string };
  /** A sound id the port asked for; the host owns the audio element. */
  "sound.play": { id: number };
}

type Handler<K extends keyof EventMap> = (payload: EventMap[K]) => void;

export class Events {
  private readonly subs = new Map<string, Set<(p: never) => void>>();

  on<K extends keyof EventMap>(key: K, fn: Handler<K>): () => void {
    let set = this.subs.get(key as string);
    if (!set) this.subs.set(key as string, (set = new Set()));
    set.add(fn as (p: never) => void);
    return () => { set!.delete(fn as (p: never) => void); };
  }

  emit<K extends keyof EventMap>(key: K, payload: EventMap[K]): void {
    const set = this.subs.get(key as string);
    if (!set) return;
    for (const fn of set) (fn as Handler<K>)(payload);
  }

  /** Drop every subscriber — a stage change rebuilds them all. */
  clear(): void {
    this.subs.clear();
  }
}
