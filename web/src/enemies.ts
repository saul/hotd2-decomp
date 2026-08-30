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
 * camera *is* the player here — and the ring it falls in decides how many
 * steps it walks before it may attack:
 *
 * ```
 * d >  outer        base + mid_add + outer_add     (2 + 3 + 4 = 9)
 * mid  < d <= outer base + mid_add                 (2 + 3     = 5)
 * d <= mid          base                           (2)
 * d <= inner        in strike range
 * ```
 *
 * The radii are `{25, 38, 51}` for most characters and `{37, 48, 51}` for
 * character type 0, copied from `DAT_004C4CD0` by the scene reset. No stage
 * script uses evt `0x0E`, the opcode that would override them.
 *
 * ## The permit — `FUN_00455DE0`
 *
 * When the steps run out an enemy asks for one of `g_attack_permits` — **one
 * per player**. Only the holder enters its attack state; everyone else keeps
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
 * Everything above is transcribed. The one thing that is not is **how fast an
 * enemy walks**: the velocity source in the class-0x30 update is `[open]`, so
 * the speed here is derived from the game's own tables instead — an actor
 * crosses a band in the number of steps the ring table allots it, one step
 * being one cycle of its walk motion. Stated rather than tuned, and it falls
 * out at roughly 6 units/second for the default rings.
 *
 * It is *not* root motion, which was the obvious candidate: measured over the
 * baked clips the walk loop's root nets +0.00 in x and z and only bobs, while
 * the death clips net −8.7 and −15.7. Root motion carries a falling body.
 *
 * Actors turn their **whole body** toward the camera and nothing aims a bone:
 * the per-frame pose hook has exactly two implementations in the program, a
 * no-op and a collision push-out, and `SkeletonWalkNode` reads every rotation
 * straight from the motion bank. See docs/formats/combat.md §10.
 */

import { Vector3 } from "three";
import type {
  ApproachJson, AttackJson, CharacterType, PlayerDamageJson, TrackingJson,
} from "./bundle";

const BAMS = 65536 / (Math.PI * 2);
/** The engine's frame clock; attack hit frames are counted in it. */
const GAME_HZ = 60;

/** Class-0x30 state indices, from `g_class30_states`. */
export const STATE_NOOP = 0;
export const STATE_ATTACK_RUN = 1;
export const STATE_STRIKE = 2;
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
}

interface Ai {
  state: number;
  sub: number;
  /** `obj+0x1358` — how many steps this actor must walk. */
  steps: number;
  /** `obj+0x131D` — how many it has walked. */
  walked: number;
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
  private readonly ai = new Map<number, Ai>();
  /** `g_attack_permits` — one per player; the player is player 0. */
  private permits: (number | null)[] = [null, null];
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
    this.permits = [null, null];
    this.tracking = false;
    this.focus = null;
    this.invuln = 0;
  }

  private state(a: EnemyActor): Ai {
    let s = this.ai.get(a.at);
    if (!s) {
      s = { state: STATE_APPROACH, sub: 0, steps: 0, walked: 0, walkClock: 0,
            permit: -1, untracked: true, band: 4, attack: -1,
            fired: false };
      this.ai.set(a.at, s);
    }
    return s;
  }

  /** `TestApproachRing` (`FUN_00456650`): the band, and the step count. */
  private ring(a: EnemyActor, eye: Vector3): { band: number; steps: number } {
    const r = this.approach?.rings[a.ringSet] ?? this.approach?.rings[0];
    const st = this.approach?.steps;
    if (!r || !st) return { band: 1, steps: 0 };
    // The game measures on the ground plane only — x and z.
    const d = Math.hypot(a.pos.x - eye.x, a.pos.z - eye.z);
    if (d <= r.inner) return { band: 1, steps: st.base };
    if (d <= r.mid) return { band: 2, steps: st.base };
    if (d <= r.outer) return { band: 3, steps: st.base + st.mid_add };
    return { band: 4, steps: st.base + st.mid_add + st.outer_add };
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
   * How far an actor moves in a second. `[likely]` — see the module note: the
   * ring table says an actor crosses a band in *n* steps, and a step is one
   * walk cycle, so the speed follows from the game's own numbers.
   */
  private speed(a: EnemyActor): number {
    const r = this.approach?.rings[a.ringSet];
    const st = this.approach?.steps;
    if (!r || !st || st.base <= 0 || a.stepSeconds <= 0) return 0;
    return (r.mid - r.inner) / (st.base * a.stepSeconds);
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
      if (a.dead || !a.visible) {
        if (s.permit >= 0) this.release(s);
        if (a.action) a.action = null;
        continue;
      }
      this.step(a, s, eye, dt);
      live.push({ a, s, d: a.pos.distanceTo(eye) });
    }
    return this.aim(live, eye, out);
  }

  /** One actor's state machine — states 22, 1 and 2. */
  private step(a: EnemyActor, s: Ai, eye: Vector3, dt: number): void {
    // `TurnActorTowardCamera`: face a point just in front of the camera.
    const face = Math.atan2(eye.x - a.pos.x, eye.z - a.pos.z) * BAMS;
    let d = ((face - a.yaw) % 65536 + 98304) % 65536 - 32768;
    a.yaw = (a.yaw + d * Math.min(1, dt * 4) + 65536) % 65536;

    if (s.state === STATE_APPROACH) {
      if (s.sub === 0) {
        const r = this.ring(a, eye);
        s.steps = r.steps;
        s.band = r.band;
        s.walked = 0;
        s.walkClock = 0;
        s.untracked = true;                 // `flags |= 0x10000`
        s.sub = 1;
        return;
      }
      // Walk. A step is one cycle of the walk motion.
      this.advance(a, eye, dt);
      s.walkClock += dt;
      if (s.walkClock >= a.stepSeconds) {
        s.walkClock -= a.stepSeconds;
        s.walked++;
      }
      if (s.walked >= s.steps && this.claim(s)) {
        s.state = a.attackState > 0 ? a.attackState : STATE_NOOP;
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
      const list = a.type.attacks?.[String(a.condition)]
        ?? a.type.attacks?.["0"] ?? {};
      if (s.sub === 0) {
        s.attack = this.pickAttack(a, list);
        s.fired = false;
        s.sub = 1;
      }
      const atk = list[String(s.attack)] ?? null;
      if (!atk) { this.endStrike(a, s); return; }

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
    }
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

  private endStrike(a: EnemyActor, s: Ai): void {
    a.action = null;
    this.release(s);
    s.state = STATE_APPROACH;
    s.sub = 0;
    s.fired = false;
  }

  /** Move an actor along its facing, on the ground plane. */
  private advance(a: EnemyActor, eye: Vector3, dt: number): void {
    const v = this.speed(a) * dt;
    if (v <= 0) return;
    this._fwd.set(eye.x - a.pos.x, 0, eye.z - a.pos.z);
    const len = this._fwd.length();
    if (len < 1e-3) return;
    a.pos.addScaledVector(this._fwd.divideScalar(len), Math.min(v, len));
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
