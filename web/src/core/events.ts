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
  /** `ScoreAddForPlayer` ran. Negative `points` is a penalty. */
  "player.score": { player: number; points: number; score: number };
  /**
   * `ProcessShotRequests` resolved one queued trigger pull.
   *
   * This is how the *feedback* for a shot gets back to the layer that can draw
   * it. The port decides what a shot did; the blood sprite, the impact sound
   * and the feed row are the renderer's, and they arrive here rather than
   * being computed twice. The ray comes back with it so a miss can be traced
   * against the drawn geometry, which is the only place an impact point for a
   * miss exists at all.
   */
  "shot.resolved": {
    player: number;
    /** `marked` is an actor whose own class scores it — see `combat/shot.ts`. */
    kind: "miss" | "actor" | "marked" | "prop";
    ray: {
      origin: { x: number; y: number; z: number };
      dir: { x: number; y: number; z: number };
    };
    /** Where it landed. Absent on a miss: the port has no world geometry. */
    point?: { x: number; y: number; z: number };
    /** The actor, for `actor` and `marked`. */
    at?: number;
    bone?: number;
    who?: string;
    /** The character type, which picks the voice set. */
    charType?: number;
    head?: boolean;
    killed?: boolean;
    damage?: number;
    hp?: number;
    /** `g_hit_result`. */
    result?: number;
    severed?: boolean;
    gore?: boolean;
    react?: number;
    death?: number;
    /** The prop, for `prop`. */
    propGroup?: number;
    propMember?: number;
    propHp?: number;
    points: number;
  };

  // -- class 0x10, the civilians -----------------------------------------
  /** A civilian's captors are all dead: +400, and it walks off. */
  "civilian.rescued": { at: number; player: number; score: number };
  /** A civilian was shot: a life, and -100 twice. */
  "civilian.shot": { at: number; player: number };
  /**
   * Op 0x1D — `EvtOpPlayDialogue2D`. The same message groups evt op 0x2D
   * plays, so the host routes it to the subtitle and voice path rather than
   * treating it as a bare sound.
   */
  "civilian.dialogue": { at: number; group: number };

  // -- class 0x41, the breakable props -----------------------------------
  /** First shot: the prop swapped to its broken model and shook. */
  "prop.cracked": { id: number; sound: number };
  /** Second shot: the prop is gone, and its item set has been charged. */
  "prop.broken": { id: number; sound: number };
  /** A stacked prop burst into fragments instead of toppling. */
  "prop.shattered": { id: number; x: number; y: number; z: number };
  /** A class-0x24 set-piece hit its removal trigger and left. */
  "setpiece.removed": { at: number };
  /** A toppled prop reached the floor. */
  "prop.settled": { id: number; sound: number };
  /**
   * The item a set of props was hiding came out. `set` is the item-set id, or
   * -1 for the `g_GameMode == 1` substitute, whose kind is in `kind`.
   */
  "item.released": {
    set: number;
    from: number;
    x: number;
    y: number;
    z: number;
    kind?: number;
    charType?: number;
    sound?: number;
  };
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
