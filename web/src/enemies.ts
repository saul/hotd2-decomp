/**
 * The gameplay loop: approach, attack permits, and the camera that follows
 * whoever is about to swing.
 *
 * Read out of the binary; the account is docs/formats/combat.md §10. Three
 * routines matter and they are separate on purpose, because conflating them is
 * what made this hard to find in the first place:
 *
 * ```
 * ZombieStateApproach     walk in band by band, then ask permission to attack
 * TryClaimAttackSlot      one permit per player -- the "about to attack" flag
 * ZombieStateHoldAtRange  hold inside the inner ring until the cooldown clears
 * ZombieStateStrike       lunge, swing, land the hit on the frame it names
 * PlayerTakeDamage        one life, -100, and 90 frames of invulnerability
 * SelectCameraLookAtTarget + TurnLookAtToward   where the camera aims, eased
 * ```
 *
 * ## The strike, and why shooting an arm off matters twice
 *
 * An attack entry names its own lunge distance, its strike clip, and the exact
 * frame of that clip on which the hit lands. It also names a **cancel mask**
 * of destroyed zones — 1 head, 2 right arm, 4 left arm — and the hit whiffs if
 * every zone in it is gone. `znchain` has a right-arm swing cancelled by `0x2`,
 * a longer left-arm one by `0x4`, a two-armed one by `0x6`, and a fallback
 * with `0x8`, which is outside the three-bit mask and so never cancels.
 *
 * The same mask indexes the **pick** table, so a damaged zombie reaches for a
 * different attack in the first place: `char_adv00` with a head draws attack 2,
 * and with the head shot off draws attack 3.
 *
 * A strike costs exactly **one life** — the entry's `+0x0A` is the motion the
 * player plays, not a damage amount — plus 100 points and 90 frames of
 * invulnerability. It also drops the adaptive rank by 2, which is how being
 * hit makes the game easier.
 *
 * ## Approaching — `FUN_004579A0` and `TestApproachRing`
 *
 * Every enemy measures its distance **to the camera** — not to a player, the
 * camera *is* the player here — and the ring it falls in yields a number:
 *
 * ```
 * d >  outer        base + mid_add + outer_add     (2 + 3 + 4 = 9)
 * mid  < d <= outer base + mid_add                 (2 + 3     = 5)
 * d <= mid          base                           (2)
 * d <= inner        in strike range
 * ```
 *
 * That number is **not a step count**, which is what an earlier revision of
 * this file assumed. `FUN_004090B0` sorts every live enemy by distance to the
 * camera once a frame and writes each actor's *rank* in that queue to
 * `obj+0x131D`; the approach state's test is
 *
 * ```c
 * if ((s8)obj[0x131D] < obj[0x1358] && obj[0x131E] < 3) TryClaimAttackSlot();
 * ```
 *
 * — "if I am among the nearest N, and among the nearest 3 overall, I may press
 * an attack". So the ring table is a **crowd throttle**: far from the camera a
 * deeper slice of the queue is allowed to come at you (9), close in only the
 * nearest 2. Nothing counts walking steps anywhere.
 *
 * The radii are `{25, 38, 51}` for most characters and `{37, 48, 51}` for
 * character type 0, copied from `DAT_004C4CD0` by the scene reset. No stage
 * script uses evt `0x0E`, the opcode that would override them.
 *
 * ## The permit — `FUN_00455DE0`
 *
 * Once it is near enough the front of the queue an enemy asks for one of
 * `g_attack_permits` — **one per player**. Only the holder enters its attack state; everyone else keeps
 * walking. The permit index lives in `obj+0x121`, and that one byte also
 * decides the camera's focus, which is the whole trick.
 *
 * ## The camera
 *
 * `RegisterForCameraTracking` skips any actor with flag `0x10000`, which
 * `ZombieStateApproach` **sets while walking and clears the moment the actor
 * wins a permit** — so the camera only ever considers enemies that have
 * committed. Candidates are keyed on `|actor − eye| × 10` and radix-sorted
 * ascending, so nearest first; permit holders take slots 0 and 1 and everyone
 * else 2 upward. Then:
 *
 * ```
 * slot0 attacking, slot1 not  -> look at slot0 alone
 * slot0 and slot1 both        -> look at their midpoint
 * slot0 only                  -> look at slot0
 * nothing registered          -> look where the cam/ path says
 * ```
 *
 * and `TurnLookAtToward` eases the current look-at onto that by
 * `1 / (1 + rate)` of the remaining angle per frame, re-emitting it 100 units
 * from the eye. The rate comes from a 64-entry curve indexed by the angle
 * error clamped to 45°: **64 below about 18°, ramping to 16 past 23°**. A
 * larger rate is a slower turn, so the camera holds almost still for small
 * offsets and swings briskly for wide ones. That curve is the feel of it.
 *
 * ## What is assumed, and marked
 *
 * Everything above is transcribed. The one thing that is not is **how an
 * enemy closes the distance**, and it is a real `[open]`, not a shortcut:
 *
 *   * there is no `fstp [reg+0x4c]` anywhere in `0x455000..0x459000`, so the
 *     zombie's own code never writes a velocity;
 *   * it is not root motion — measured over the clips the approach actually
 *     uses (270, 975, 1000), each nets between +0.00 and +0.04 over a full
 *     cycle. They are in-place walks. The death clips, by contrast, net −8.7
 *     and −15.7, so root motion is real and carries a falling body;
 *   * and it is not a step count, per the note above.
 *
 * So `CLOSING_SPEED` below is an **invented constant**, not a derived one. It
 * exists because the game's own states plainly do close the distance —
 * `ZombieStateAttackRun` runs until `TestApproachRing` returns 1, and the
 * strike lunges until it is inside the attack's distance — and without it
 * nothing ever reaches striking range. Flagged rather than dressed up.
 *
 * Actors turn their **whole body** toward the camera and nothing aims a bone:
 * the per-frame pose hook has exactly two implementations in the program, a
 * no-op and a collision push-out, and `SkeletonWalkNode` reads every rotation
 * straight from the motion bank. See docs/formats/combat.md §10.
 */

import { Group, Matrix4, Object3D, Vector3 } from "three";
import type {
  ApproachJson, AttackJson, CharacterType, PlayerDamageJson, ThrowHandJson,
  TrackingJson,
} from "./bundle";

const BAMS = 65536 / (Math.PI * 2);
/** The engine's frame clock; attack hit frames are counted in it. */
const GAME_HZ = 60;
/** `obj+0x131E < 3` — only the nearest three may press an attack at all. */
const QUEUE_CAP = 3;
/**
 * The only class whose state machine this models. `g_class30_states` belongs
 * to class 0x30; the cat is class 0x53, the civilians 0x10, the scripted
 * humanoids 0x25 — all with their own handlers, none of them read. They keep
 * their looping motion and stay where the script put them.
 */
const CLASS_ZOMBIE = 0x30;
/**
 * The thrower. `EnemyThrowerInit` gives subtype 0x16 (`zsass.bin`) an item in
 * each hand and puts it somewhere you cannot walk to — stage 2 block 5 spawns
 * two at y = 87, above the street. Its own 30-state machine is unread, but the
 * throw is not: it competes for the **same attack permit** as the zombies, and
 * when it holds one it plays the throw clip and lets go on an exact frame.
 */
const CLASS_THROWER = 0x31;
/**
 * Units per second an enemy closes at. **`[open]` — invented, not derived.**
 * See the module note: the zombie's code writes no velocity, its walk clips
 * are in place, and the ring table counts queue depth rather than steps. This
 * exists so the states that plainly do close the distance can.
 */
const CLOSING_SPEED = 6;

/** Class-0x30 state indices, from `g_class30_states`. */
export const STATE_NOOP = 0;
export const STATE_ATTACK_RUN = 1;
export const STATE_STRIKE = 2;
/**
 * `ZombieStateBackOff` (`FUN_00455C30`). After a strike the actor **keeps the
 * permit** and retreats, playing its back-away walk, until it is back outside
 * the inner ring or 240 frames have passed — and only then releases it and
 * returns to holding. That retreat *is* the pause between attacks: there is no
 * cooldown timer for an ordinary zombie, `ZombieStateHoldAtRange` forces
 * `obj+0x133C` to zero unless `obj+0x1368` bit 0 is set.
 */
export const STATE_BACKOFF = 4;
/** `obj+0x1334 > 0xF0` — the retreat gives up after 240 frames. */
const BACKOFF_MAX_FRAMES = 240;
export const STATE_LEAVE = 10;
export const STATE_APPROACH = 22;

/** One actor as the director sees it. `pos` and `yaw` are live. */
export interface EnemyActor {
  at: number;
  charType: number;
  ringSet: number;
  attackState: number;
  /** World position; the director reads and writes it. */
  pos: Vector3;
  /** BAMS yaw; the director turns it and the character layer applies it. */
  yaw: number;
  dead: boolean;
  visible: boolean;
  /** Seconds one walk cycle takes — a "step". */
  stepSeconds: number;
  /** `obj+0x1318 & 7` — 1 head gone, 2 right arm, 4 left arm. */
  zones: number;
  /**
   * A one-shot the director asked the character layer to play at full weight:
   * the lunge (looping) or the strike (once). `t` is seconds played, which is
   * what `ActorStrikeConnect` compares against the attack's hit frame.
   */
  action: { motion: number; t: number; loop: boolean } | null;
  /** The character type, so the director can read its attack tables. */
  type: CharacterType;
  /** `obj+0x130C` — the body condition, which indexes the attack tables. */
  condition: number;
  /** The spawn class. Only 0x30 and 0x31 have behaviour here. */
  cls: number;
}

interface Ai {
  state: number;
  sub: number;
  /** `obj+0x1358` — how deep in the distance queue this actor may be. */
  allowance: number;
  /** `obj+0x131D` — its rank in that queue, nearest first. */
  rank: number;
  /** Used only to pace the hold-at-range cooldown. */
  walkClock: number;
  /** `obj+0x121` — the attack permit, or −1. */
  permit: number;
  /** `obj+0x34 & 0x10000` — set while approaching; excluded from the camera. */
  untracked: boolean;
  /** The band `TestApproachRing` last returned: 1 strike, 2–4 outward. */
  band: number;
  /** The attack index this strike drew, and whether its hit has fired. */
  attack: number;
  fired: boolean;
}

/**
 * One weapon in flight — `ThrownWeaponFlyToTarget`.
 *
 * A straight line at a constant `speed` units per frame with
 * `ttl = distance / speed`, tumbling on its yaw, and on expiry it calls
 * `PlayerTakeDamage` outright: **the hit is timed, not tested**, exactly like
 * the melee strike's hit frame. Afterwards it sticks facing the camera for 30
 * frames and blinks for 60 before going away.
 */
interface Projectile {
  node: Object3D;
  vel: Vector3;
  ttl: number;
  spin: number;
  yaw: number;
  /** Frames spent in the stick/blink tail once the flight is done. */
  after: number;
  hit: boolean;
  cfg: { stick_frames: number; blink_frames: number };
}

export class EnemyDirector {
  private approach: ApproachJson | null = null;
  private track: TrackingJson | null = null;
  private dmg: PlayerDamageJson | null = null;
  /**
   * `PlayerTakeDamage`: a strike costs one life, −100, and 90 frames of
   * invulnerability. Reported rather than applied here — the host owns the HUD.
   */
  onStrike: (a: EnemyActor, attack: AttackJson) => void = () => {};
  /** `DAT_009C8E08` — invulnerability frames left. */
  private invuln = 0;
  /** Weapons in flight, and the group they live in. */
  private readonly flying: Projectile[] = [];
  readonly projectiles = new Group();
  /** Set by the host so a thrown weapon can be built and placed. */
  chars: {
    cloneSlot(slot: number): Object3D | null;
    boneWorld(at: number, bone: number, out: Vector3): boolean;
    setBoneSlot(at: number, bone: number, slot: number): void;
  } | null = null;
  private readonly ai = new Map<number, Ai>();
  /**
   * `g_attack_permits`. `TryClaimAttackSlot` offers `g_max_attackers` of them,
   * one per player, and with a single player it only ever offers slot 0 — so
   * exactly one enemy is committed at a time, which is the game's feel.
   */
  private permits: (number | null)[] = [null];
  private readonly _a = new Vector3();
  private readonly _b = new Vector3();
  private readonly _fwd = new Vector3();

  /** Whether anything is currently being tracked — `DAT_0059C988`. */
  tracking = false;
  /** The enemy the camera is focused on, for the UI. */
  focus: EnemyActor | null = null;

  setTables(approach: ApproachJson | undefined,
            track: TrackingJson | undefined,
            player: PlayerDamageJson | undefined): void {
    this.approach = approach ?? null;
    this.track = track ?? null;
    this.dmg = player ?? null;
  }

  /** Frames of player invulnerability still running. */
  get invulnFrames(): number { return this.invuln; }

  reset(): void {
    this.ai.clear();
    this.permits = [null];
    this.tracking = false;
    this.focus = null;
    this.invuln = 0;
    for (const p of this.flying) p.node.removeFromParent();
    this.flying.length = 0;
  }

  private state(a: EnemyActor): Ai {
    let s = this.ai.get(a.at);
    if (!s) {
      s = { state: STATE_APPROACH, sub: 0, allowance: 0, rank: 99,
            walkClock: 0,
            permit: -1, untracked: true, band: 4, attack: -1,
            fired: false };
      this.ai.set(a.at, s);
    }
    return s;
  }

  /** `TestApproachRing` (`FUN_00456650`): the band, and the step count. */
  private ring(a: EnemyActor, eye: Vector3): { band: number; allow: number } {
    const r = this.approach?.rings[a.ringSet] ?? this.approach?.rings[0];
    const st = this.approach?.steps;
    if (!r || !st) return { band: 1, allow: 0 };
    // The game measures on the ground plane only — x and z.
    const d = Math.hypot(a.pos.x - eye.x, a.pos.z - eye.z);
    if (d <= r.inner) return { band: 1, allow: st.base };
    if (d <= r.mid) return { band: 2, allow: st.base };
    if (d <= r.outer) return { band: 3, allow: st.base + st.mid_add };
    return { band: 4, allow: st.base + st.mid_add + st.outer_add };
  }

  /**
   * `TryClaimAttackSlot` (`FUN_00455DE0`): one permit per player. Winning it
   * is what lets an actor attack *and* what puts it on camera.
   */
  private claim(s: Ai): boolean {
    for (let i = 0; i < this.permits.length; i++) {
      if (this.permits[i] === null) {
        this.permits[i] = 1;
        s.permit = i;
        s.untracked = false;          // `flags &= ~0x10000`
        return true;
      }
    }
    return false;
  }

  private release(s: Ai): void {
    if (s.permit >= 0) this.permits[s.permit] = null;
    s.permit = -1;
    s.untracked = true;
  }

  /**
   * Advance every enemy and decide where the camera should look.
   *
   * Returns the desired look-at point, or null when nothing is registered —
   * which is `SelectCameraLookAtTarget`'s own fallback to the path's target.
   */
  update(actors: readonly EnemyActor[], eye: Vector3, dt: number,
         out: Vector3): boolean {
    this.invuln = Math.max(0, this.invuln - dt * 60);
    const live: { a: EnemyActor; s: Ai; d: number }[] = [];
    for (const a of actors) {
      const s = this.state(a);
      if (a.dead || !a.visible
          || (a.cls !== CLASS_ZOMBIE && a.cls !== CLASS_THROWER)) {
        if (s.permit >= 0) this.release(s);
        if (a.action) a.action = null;
        continue;
      }
      live.push({ a, s, d: a.pos.distanceTo(eye) });
    }
    // `FUN_004090B0`: sort every live enemy by distance to the camera and give
    // each its rank, nearest first. That rank is what the approach state tests
    // against the ring table's allowance.
    live.sort((p, q) => p.d - q.d);
    live.forEach((x, i) => { x.s.rank = i; });
    for (const x of live) {
      if (x.a.cls === CLASS_THROWER) this.stepThrower(x.a, x.s, eye, dt);
      else this.step(x.a, x.s, eye, dt);
    }
    this.stepProjectiles(eye, dt);
    return this.aim(live, eye, out);
  }

  /** One actor's state machine — states 22, 1 and 2. */
  /** `TurnActorTowardCamera`, shared by both classes. */
  private face(a: EnemyActor, eye: Vector3, dt: number): void {
    const f = Math.atan2(a.pos.x - eye.x, a.pos.z - eye.z) * BAMS;
    const d = ((f - a.yaw) % 65536 + 98304) % 65536 - 32768;
    a.yaw = (a.yaw + d * Math.min(1, dt * 4) + 65536) % 65536;
  }

  private step(a: EnemyActor, s: Ai, eye: Vector3, dt: number): void {
    // `TurnActorTowardCamera` takes `VecToAngles(obj.x - p.x, 0, obj.z - p.z)`
    // — the angle of **actor minus camera**, not camera minus actor. Writing it
    // the other way round is a clean 180 degrees, and since the turn is eased
    // it reads as the zombie slowly rotating *away* from you.
    const face = Math.atan2(a.pos.x - eye.x, a.pos.z - eye.z) * BAMS;
    let d = ((face - a.yaw) % 65536 + 98304) % 65536 - 32768;
    a.yaw = (a.yaw + d * Math.min(1, dt * 4) + 65536) % 65536;

    if (s.state === STATE_APPROACH) {
      if (s.sub === 0) {
        const r = this.ring(a, eye);
        s.allowance = r.allow;
        s.band = r.band;
        s.untracked = true;                 // `flags |= 0x10000`
        s.sub = 1;
        return;
      }
      // `if (rank < allowance && rank < 3) TryClaimAttackSlot()`. The rank is
      // recomputed for every actor once a frame in `update`; the band is
      // recomputed here too, because the actor is walking and `TestApproachRing`
      // is called every frame by the states that follow this one.
      this.advance(a, eye, dt);
      const rr = this.ring(a, eye);
      s.allowance = rr.allow;
      s.band = rr.band;
      // An actor whose descriptor names no attack state must never take a
      // permit: there are only `g_max_attackers` of them, and one held by an
      // actor that cannot attack blocks every other enemy for good.
      if (!this.canAttack(a)) return;
      if (s.rank < s.allowance && s.rank < QUEUE_CAP && this.claim(s)) {
        s.state = this.attackStateFor(a);
        s.sub = 0;
      }
      return;
    }

    if (s.state === STATE_ATTACK_RUN) {
      // `FUN_004554D0`: close on the camera until the inner ring, then strike.
      const r = this.ring(a, eye);
      s.band = r.band;
      if (r.band === 1) { s.state = STATE_STRIKE; s.sub = 0; s.walkClock = 0; }
      else this.advance(a, eye, dt);
      return;
    }

    if (s.state === STATE_STRIKE) {
      // `ZombieStateStrike` (`FUN_00455A40`). Sub 0 draws which attack to use,
      // sub 1 lunges until it is inside the attack's own distance and then
      // starts the strike, sub 2 plays it out and lands the hit on the exact
      // frame the table names.
      const list = this.attackList(a);
      if (s.sub === 0) {
        s.attack = this.pickAttack(a, list);
        s.fired = false;
        s.sub = 1;
      }
      const atk = list[String(s.attack)] ?? null;
      if (!atk) { this.giveUp(a, s); return; }

      if (s.sub === 1) {
        const d = Math.hypot(a.pos.x - eye.x, a.pos.z - eye.z);
        if (d > atk.distance) {
          // Still short: play the lunge and keep closing.
          if (a.action?.motion !== atk.lunge) {
            a.action = { motion: atk.lunge, t: 0, loop: true };
          }
          this.advance(a, eye, dt);
          return;
        }
        a.action = { motion: atk.strike, t: 0, loop: false };
        s.sub = 2;
        return;
      }

      // Sub 2: the clip is running. `hit_frame` is in 60 Hz game frames.
      const m = a.type.motions[String(atk.strike)];
      if (!a.action || !m) { this.endStrike(a, s); return; }
      const gameFrame = a.action.t * GAME_HZ;
      if (!s.fired && gameFrame >= atk.hit_frame) {
        s.fired = true;
        // `ActorStrikeConnect`: the hit whiffs if every zone the attack needs
        // has been shot off. Mask 8 is outside the 3-bit zone mask, so those
        // attacks can never be cancelled.
        const cancelled = (a.zones & 7 & atk.cancel_mask) === atk.cancel_mask;
        if (!cancelled && this.invuln <= 0) {
          this.invuln = this.dmg?.invuln_frames ?? 90;
          this.onStrike(a, atk);
        }
      }
      if (a.action.t * m.fps >= m.frames - 1) this.endStrike(a, s);
      return;
    }

    if (s.state === STATE_BACKOFF) {
      // `ZombieStateBackOff`. Play the back-away walk from the motion row and
      // retreat until outside the inner ring, or give up after 240 frames.
      if (s.sub === 0) {
        const row = a.type.motion_row?.[String(a.condition)]
          ?? a.type.motion_row?.["0"];
        const m = row?.[a.type.backoff_index ?? 4];
        if (m && a.type.motions[String(m)]) {
          a.action = { motion: m, t: 0, loop: true };
        }
        s.walkClock = 0;
        s.sub = 1;
      }
      this.advance(a, eye, dt, true);
      s.walkClock += dt * GAME_HZ;
      const d = Math.hypot(a.pos.x - eye.x, a.pos.z - eye.z);
      const inner = (this.approach?.rings[a.ringSet]
                     ?? this.approach?.rings[0])?.inner ?? 0;
      if (d > inner || s.walkClock > BACKOFF_MAX_FRAMES) {
        a.action = null;
        this.release(s);              // only now is the next enemy free
        s.state = STATE_APPROACH;
        s.sub = 0;
      }
      return;
    }

    // Anything else is a state this client does not model. Never sit in one
    // holding a permit.
    this.giveUp(a, s);
  }

  /**
   * The thrower. It never walks — its spawn is out of reach on purpose — so it
   * only ever turns to face you, waits for the attack permit, and throws.
   */
  private stepThrower(a: EnemyActor, s: Ai, eye: Vector3, dt: number): void {
    this.face(a, eye, dt);
    const hands = a.type.throw?.hands?.[String(a.condition)]
      ?? a.type.throw?.hands?.["0"] ?? [];
    // `ThrowerStateThrow` refuses a hand whose arm has been shot off.
    const usable = hands.filter((h) => (a.zones & 7 & h.cancel_mask)
                                       !== h.cancel_mask);
    if (!usable.length) { if (s.permit >= 0) this.release(s); return; }

    if (s.permit < 0) {
      // `FUN_0044CA40` is byte-for-byte `TryClaimAttackSlot` and, like it,
      // tests **no queue rank** — that test lives in `ZombieStateApproach`,
      // before the call, and class 0x31's throw state does not have it. Gating
      // the thrower on rank is why the elevated ones never threw: they are far
      // away by design, so their distance rank is always high.
      if (this.claim(s)) { s.sub = 0; s.fired = false; }
      else return;
    }
    const hand = usable[Math.min(s.attack < 0 ? 0 : s.attack, usable.length - 1)];
    if (s.sub === 0) {
      s.attack = usable.indexOf(hand);
      s.fired = false;
      a.action = { motion: hand.motion, t: 0, loop: false };
      s.sub = 1;
      return;
    }
    const m = a.type.motions[String(hand.motion)];
    if (!a.action || !m) {
      // The clip finished: re-arm the hand and give the permit up so the next
      // enemy — or this one — can take a turn.
      if (s.fired) this.rearm(a, hand);
      this.release(s);
      s.sub = 0;
      s.attack = (s.attack + 1) % usable.length;
      return;
    }
    if (!s.fired && a.action.t * GAME_HZ >= hand.release_frame) {
      s.fired = true;
      this.throwWeapon(a, hand, eye);
    }
  }

  /** `SpawnThrownWeapon`: the hand goes bare and the weapon takes the permit. */
  private throwWeapon(a: EnemyActor, hand: ThrowHandJson, eye: Vector3): void {
    const cfg = a.type.throw;
    if (!cfg || !this.chars) return;
    const from = new Vector3();
    if (!this.chars.boneWorld(a.at, hand.bone, from)) return;
    const node = this.chars.cloneSlot(hand.projectile);
    if (!node) return;

    this.chars.setBoneSlot(a.at, hand.bone, hand.bare);
    a.zones |= hand.cancel_mask & 7;

    // `AimThrownWeapon`: a point `aim_ahead` in front of the camera. The
    // camera looks down its own local −Z, which is where the player is.
    const target = new Vector3(0, 0, -cfg.aim_ahead)
      .applyMatrix4(this._camMat).setY(eye.y);
    const d = target.distanceTo(from);
    const ttl = Math.max(1, d / cfg.speed);
    node.position.copy(from);
    this.projectiles.add(node);
    this.flying.push({
      node,
      vel: target.clone().sub(from).divideScalar(ttl),
      ttl, spin: hand.bone === 5 ? cfg.spin : -cfg.spin,
      yaw: 0, after: 0, hit: false,
      cfg: { stick_frames: cfg.stick_frames, blink_frames: cfg.blink_frames },
    });
  }

  /** `ZombieStateRearm`: the hand gets its weapon back. */
  private rearm(a: EnemyActor, hand: ThrowHandJson): void {
    if (hand.held && this.chars) {
      this.chars.setBoneSlot(a.at, hand.bone, hand.held);
    }
    a.zones &= ~(hand.cancel_mask & 7);
  }

  /** The camera's world matrix, so the aim point can be built in view space. */
  private readonly _camMat = new Matrix4();
  setCameraMatrix(m: Matrix4): void { this._camMat.copy(m); }

  private stepProjectiles(eye: Vector3, dt: number): void {
    const frames = dt * GAME_HZ;
    for (let i = this.flying.length - 1; i >= 0; i--) {
      const p = this.flying[i];
      if (p.ttl > 0) {
        p.node.position.addScaledVector(p.vel, frames);
        p.yaw += p.spin * frames;
        p.node.rotation.set(0, 0, p.yaw * (Math.PI * 2) / 65536);
        p.ttl -= frames;
        if (p.ttl <= 0 && !p.hit) {
          p.hit = true;
          if (this.invuln <= 0) {
            this.invuln = this.dmg?.invuln_frames ?? 90;
            this.onThrowHit();
          }
        }
        continue;
      }
      // Stuck in view, then blinking, then gone.
      p.after += frames;
      p.node.lookAt(eye);
      const blinkFrom = p.cfg.stick_frames;
      if (p.after > blinkFrom) {
        p.node.visible = Math.floor(p.after - blinkFrom) % 2 === 0;
      }
      if (p.after >= blinkFrom + p.cfg.blink_frames) {
        p.node.removeFromParent();
        this.flying.splice(i, 1);
      }
    }
  }

  /** Reported like a melee strike: one life, −100, and the invulnerability. */
  onThrowHit: () => void = () => {};

  /** Attacks this actor can actually perform, for its body condition. */
  private attackList(a: EnemyActor): Record<string, AttackJson> {
    return a.type.attacks?.[String(a.condition)]
      ?? a.type.attacks?.["0"] ?? {};
  }

  /**
   * Whether taking a permit could lead anywhere.
   *
   * `attack_state` 0 is `g_class30_states[0]`, which is the engine's no-op —
   * 123 of stage 2's class-0x30 spawns carry it, and −1 another 38. Those
   * actors are scenery that happens to walk. They must not compete for a
   * permit, and neither must a type with no usable attack entry.
   */
  private canAttack(a: EnemyActor): boolean {
    return a.attackState > 0 && Object.keys(this.attackList(a)).length > 0;
  }

  /**
   * Which state a permit-holder enters. Only 1, 2 and 3 are modelled here;
   * the others in the descriptor (10, 15, 26, 30, 38) are approach variants —
   * state 15 walks a set distance and then hands to state 1 — so they are
   * mapped onto the attack run rather than left to hang. An unmodelled state
   * with no handler would hold its permit for ever, which is what stopped
   * every other zombie attacking.
   */
  private attackStateFor(a: EnemyActor): number {
    return a.attackState === STATE_STRIKE ? STATE_STRIKE : STATE_ATTACK_RUN;
  }

  /** Release the permit and go back to approaching, without striking. */
  private giveUp(a: EnemyActor, s: Ai): void {
    a.action = null;
    this.release(s);
    s.state = STATE_APPROACH;
    s.sub = 0;
    s.fired = false;
  }

  /**
   * `ZombieStateStrike` sub 0: `picks[(rand % 10) + (zones & 7) * 10]`.
   *
   * The zone term is the point — a zombie that has lost its head or an arm
   * draws from a different ten, so shooting a limb off changes which attack it
   * reaches for as well as whether that attack can connect.
   */
  private pickAttack(a: EnemyActor,
                     list: Record<string, AttackJson>): number {
    const picks = a.type.attack_picks?.[String(a.condition)]
      ?? a.type.attack_picks?.["0"] ?? [];
    const zone = a.zones & 7;
    const v = picks[Math.floor(Math.random() * 10) + zone * 10];
    if (v !== undefined && list[String(v)]) return v;
    // The pick named an entry the exporter filtered out — those are the
    // destroyed-zone rows the game itself would read as a zero motion. Fall
    // back to any usable attack rather than freezing mid-swing.
    const keys = Object.keys(list);
    return keys.length ? Number(keys[0]) : -1;
  }

  /**
   * The strike clip is over. `ZombieStateStrike` hands to state 4, which keeps
   * the permit through the retreat — so the next enemy cannot start until this
   * one has actually backed away.
   */
  private endStrike(a: EnemyActor, s: Ai): void {
    a.action = null;
    s.state = STATE_BACKOFF;
    s.sub = 0;
    s.fired = false;
  }

  /**
   * Move on the ground plane, toward the camera or away from it.
   *
   * **Never closer than the inner ring.** Band 1 is strike range and no state
   * in the game walks past it — `ZombieStateAttackRun` stops there and hands
   * to the hold. Without this an actor with no attack state, of which the game
   * has 161, walks straight through the camera.
   */
  private advance(a: EnemyActor, eye: Vector3, dt: number,
                  away = false): void {
    const v = CLOSING_SPEED * dt;
    if (v <= 0) return;
    const inner = (this.approach?.rings[a.ringSet]
                   ?? this.approach?.rings[0])?.inner ?? 0;
    this._fwd.set(eye.x - a.pos.x, 0, eye.z - a.pos.z);
    const len = this._fwd.length();
    if (len < 1e-3) return;
    this._fwd.divideScalar(len);
    const room = away ? v : Math.max(0, len - inner);
    if (room <= 0) return;
    a.pos.addScaledVector(this._fwd, (away ? -1 : 1) * Math.min(v, room));
  }

  /**
   * `UpdateCameraEnemySlots` + `SelectCameraLookAtTarget`.
   *
   * Candidates are the actors the approach state has *stopped* excluding —
   * permit holders — nearest first. Slots 0 and 1 take those; the rest fill
   * from 2. Then the look-at is the lone attacker, the midpoint of two, or
   * nothing at all.
   */
  private aim(live: { a: EnemyActor; s: Ai; d: number }[], _eye: Vector3,
              out: Vector3): boolean {
    const cand = live.filter((x) => !x.s.untracked)
      .sort((p, q) => Math.round(p.d * (this.track?.distance_scale ?? 10))
                    - Math.round(q.d * (this.track?.distance_scale ?? 10)))
      .slice(0, this.track?.max_candidates ?? 14);

    const slots: (typeof cand[number] | null)[] = [null, null];
    const rest: typeof cand = [];
    for (const c of cand) {
      if (c.s.permit >= 0) {
        const i = slots[0] ? 1 : 0;
        if (!slots[i]) { slots[i] = c; continue; }
      }
      rest.push(c);
    }
    if (!slots[0] && rest.length) slots[0] = rest.shift()!;
    if (!slots[1] && rest.length) slots[1] = rest.shift()!;

    const s0 = slots[0];
    const s1 = slots[1];
    this.tracking = !!s0;
    this.focus = null;
    if (!s0) return false;                          // -> the path's own target
    if (s1 && !(s0.s.permit >= 0 && s1.s.permit < 0)) {
      out.copy(s0.a.pos).add(s1.a.pos).multiplyScalar(0.5);
      this.focus = s0.s.permit >= 0 ? s0.a : null;
    } else {
      out.copy(s0.a.pos);
      this.focus = s0.a;
    }
    // Actors are placed at the feet; the game looks at obj+0x100, which the
    // pose puts at the body. Half the approach ring's inner radius is a poor
    // substitute, so the eye height offset the camera already uses is reused.
    out.y += 12;
    return true;
  }

  /**
   * `TurnLookAtToward` (`FUN_00403C00`): ease *current* onto *desired* by
   * `1 / (1 + rate)` of the angle between them, re-emitted at a fixed radius.
   *
   * The rate is the curve lookup when tracking, and a flat 12 when not.
   */
  turn(eye: Vector3, current: Vector3, desired: Vector3, out: Vector3): void {
    const t = this.track;
    this._a.copy(current).sub(eye);
    this._b.copy(desired).sub(eye);
    const la = this._a.length();
    const lb = this._b.length();
    const radius = t?.lookat_radius ?? 100;
    if (la < 1e-4 || lb < 1e-4) {
      out.copy(desired);
      return;
    }
    this._a.divideScalar(la);
    this._b.divideScalar(lb);
    const angle = Math.acos(Math.min(1, Math.max(-1, this._a.dot(this._b))));

    let rate = t?.rate_untracked ?? 12;
    if (this.tracking && t?.curves?.length) {
      const clamp = t.error_clamp ?? 0x1fff;
      const bams = Math.min(clamp, Math.round(angle * BAMS));
      const curve = t.curves[t.curve ?? 1] ?? [];
      rate = curve[Math.min(curve.length - 1, bams >> 7)] ?? rate;
    }
    const f = 1 / (1 + rate);
    // Slerp the direction by that fraction, then re-emit at the radius.
    if (angle < 1e-5) {
      out.copy(eye).addScaledVector(this._b, radius);
      return;
    }
    const s = Math.sin(angle);
    const w0 = Math.sin((1 - f) * angle) / s;
    const w1 = Math.sin(f * angle) / s;
    out.set(this._a.x * w0 + this._b.x * w1,
            this._a.y * w0 + this._b.y * w1,
            this._a.z * w0 + this._b.z * w1)
       .normalize().multiplyScalar(radius).add(eye);
  }

  get describe(): string {
    if (!this.approach) return "—";
    const held = this.permits.filter((p) => p !== null).length;
    const n = this.ai.size;
    if (!n) return "idle";
    return `${held} attacking${this.focus ? " · camera locked" : ""} · ${n} live`;
  }
}
