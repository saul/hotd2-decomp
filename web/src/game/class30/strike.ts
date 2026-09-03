/**
 * `ZombieStateStrike` — `FUN_00455A40`, and the hit it lands.
 *
 * Sub 0 draws which attack to use, sub 1 lunges until it is inside that
 * attack's own distance and starts the clip, sub 2 plays it out and lands the
 * hit on the exact frame the table names.
 *
 * ## Why shooting an arm off matters twice
 *
 * An attack entry names a **cancel mask** of destroyed zones — 1 head, 2 right
 * arm, 4 left arm — and the hit whiffs if every zone in it is gone. `znchain`
 * has a right-arm swing cancelled by `0x2`, a longer left-arm one by `0x4`, a
 * two-armed one by `0x6`, and a fallback with `0x8`, which is outside the
 * three-bit mask and so never cancels.
 *
 * The same mask indexes the **pick** table, so a damaged zombie reaches for a
 * different attack in the first place: `char_adv00` with a head draws attack 2,
 * and with the head shot off draws attack 3.
 */
import type { Events } from "../../core/events";
import type { Rng } from "../../core/rng";
import type { AttackJson } from "../../bundle";
import { ticksOfAuthoredFrame } from "../../core/play_cursor";
import { DamageZone, ZombieFlag2, type ZombieActor } from "../actor";
import { PlayerTakeDamage } from "../combat/player";
import { AttackListOf, AttackPicksOf, MotionOf } from "../tables";
import { dist2d, type Vec3 } from "../vec";
import { ZombieGiveUpAttack } from "./leave";
import { ActorFacePlayerTarget } from "../actor_turn";
import { ActorStartFade } from "./motion_cue";
import { MotionFade, StrikeSub, ZombieState } from "./states";

/**
 * `ZombieStateStrike` sub 0: `picks[(rand % 10) + (zones & 7) * 10]`.
 *
 * The zone term is the point — a zombie that has lost its head or an arm draws
 * from a different ten, so shooting a limb off changes which attack it reaches
 * for as well as whether that attack can connect.
 */
export function ZombiePickAttack(obj: ZombieActor, rng: Rng): number {
  const list = AttackListOf(obj);
  const picks = AttackPicksOf(obj);
  const v = picks[rng.int(10) + (obj.zones & DamageZone.All) * 10];
  if (v !== undefined && list[String(v)]) return v;
  // The pick named an entry the exporter filtered out -- those are the
  // destroyed-zone rows the game itself would read as a zero motion. Fall back
  // to any usable attack rather than freezing mid-swing.
  const keys = Object.keys(list);
  return keys.length ? Number(keys[0]) : -1;
}

/**
 * `ActorStrikeConnect` — `FUN_00456490`. The hit whiffs if **every** zone the
 * attack needs has been shot off. Mask 8 is outside the three-bit zone mask,
 * so those attacks can never be cancelled.
 */
export function ActorStrikeConnect(obj: ZombieActor, atk: AttackJson,
                                   events?: Events): boolean {
  if ((obj.zones & DamageZone.All & atk.cancel_mask) === atk.cancel_mask) return false;
  return PlayerTakeDamage(0, obj, atk.player_motion, events, "strike",
                          obj.attack);
}

/**
 * The clip is over. `ZombieStateStrike` hands to state 4, which keeps the
 * permit through the retreat — so the next enemy cannot start until this one
 * has actually backed away.
 */
function endStrike(obj: ZombieActor): void {
  // The swing is what is on screen, so it is what the retreat fades out of.
  // `ActorAdvanceMotion` cannot do it here: this ends the clip a frame early,
  // before its own end-of-clip branch would fire.
  if (obj.action) {
    ActorStartFade(obj, obj.action.motion, obj.action.ticks,
                   MotionFade.Normal);
  }
  obj.action = null;
  obj.strikeFloor = 0;
  obj.state = ZombieState.BackOff;
  obj.sub = 0;
}

export function ZombieStateStrike(obj: ZombieActor, eye: Vec3, rng: Rng,
                                  events?: Events): void {
  // Every frame of the strike, before anything else: face the player and
  // record where they are.
  ActorFacePlayerTarget(obj, eye);
  const list = AttackListOf(obj);
  if (obj.sub === StrikeSub.Pick) {
    obj.attack = ZombiePickAttack(obj, rng);
    obj.struck = false;
    obj.sub = StrikeSub.Lunge;
  }
  const atk = list[String(obj.attack)] ?? null;
  if (!atk) { ZombieGiveUpAttack(obj); return; }

  if (obj.sub === StrikeSub.Lunge) {
    // Distance is to the point `ActorFacePlayerTarget` remembered, not to the
    // camera: with two players those are different places.
    //
    // And the lunge is skipped outright while the cooldown latch is armed:
    //
    // ```
    // 00455b1a  d85f04           FCOMP float ptr [EDI + 0x4]   ; entry.distance
    // 00455b22  7530             JNZ   0x00455b54              ; already inside
    // 00455b24  f6866813000001   TEST  byte ptr [ESI+0x1368], 0x1
    // 00455b2b  7527             JNZ   0x00455b54
    // ```
    //
    // so a camera-cued (state-19) attacker swings from wherever the cue left
    // it standing, at whatever range that is, instead of walking in first.
    if (dist2d(obj.pos, obj.target) > atk.distance && !obj.zom.hasCooldown) {
      // Still short: play the lunge. Its own root motion is what closes the
      // gap -- the state writes no velocity.
      if (obj.action?.motion !== atk.lunge) {
        obj.action = { motion: atk.lunge, ticks: 0, loop: true };
        obj.rootActionFrame = -1;
      }
      return;
    }
    obj.action = { motion: atk.strike, ticks: 0, loop: false };
    obj.rootActionFrame = -1;
    // Where the clip finishes, not where it peaks: the attack's own distance
    // less the clip's net travel.
    const m0 = MotionOf(obj, atk.strike);
    const net = m0 && m0.frames > 1
      ? Math.abs(m0.root[(m0.frames - 1) * 3 + 2] - m0.root[2]) : 0;
    obj.strikeFloor = Math.max(0, atk.distance - net);
    // `ZombieStateStrike` remembers where the swing began; the retreat walks
    // back out along that line.
    // `00455b98 a900000400` / `00455ba5 0d00000400` / `00455bb0` — tested and
    // raised in one read-modify-write of `obj+0x136C`, which is why it is a
    // bit and not a field of its own.
    if (!(obj.flags2 & ZombieFlag2.StrikeAnchor)) {
      obj.strikeStart.x = obj.pos.x;
      obj.strikeStart.y = obj.pos.y;
      obj.strikeStart.z = obj.pos.z;
      obj.flags2 |= ZombieFlag2.StrikeAnchor;
    }
    obj.sub = StrikeSub.Swinging;
    return;
  }

  // Swinging: the clip is running. `hit_frame` counts the engine's own frame
  // counter at `obj+0x19C`, which advances once per 60 Hz update.
  const m = MotionOf(obj, atk.strike);
  if (!obj.action || !m) { endStrike(obj); return; }
  const frame = obj.action.ticks;
  if (!obj.struck && frame >= atk.hit_frame) {
    obj.struck = true;
    ActorStrikeConnect(obj, atk, events);
  }
  if (obj.action.ticks >= ticksOfAuthoredFrame(m.frames - 1, m.fps)) {
    endStrike(obj);
  }
}
