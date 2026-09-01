/**
 * `ZombieStateHoldAtRange` — `FUN_00455720`. **The hub of the attack loop.**
 *
 * An earlier revision of this port did not have this state at all — it went
 * approach, then straight to a "strike" it had numbered 2, which is this
 * state's index. The result was zombies that walked up and stood there. Three
 * things live here and nowhere else:
 *
 * * **the spacing.** Inside `inner - 1` the actor is too close and is sent to
 *   `ZombieStateBackOff`. That is the only thing keeping a crowd off the
 *   camera, and it runs every frame, not just after a swing.
 * * **the decision to swing.** The permit is claimed *here*, gated on the
 *   distance queue and the cooldown — and **not** on the descriptor's
 *   `attack_state`. That byte is only read by `ZombieStateApproach`. Gating
 *   this on it, as the old port did, is why the 32 stage-2 zombies whose
 *   descriptor says `attack_state = -1` or `0` never attacked: in the game
 *   they attack perfectly well.
 * * **the cooldown.** `obj+0x133C` is forced to zero unless `obj+0x1368` bit 0
 *   is set, so an ordinary zombie has no wait between swings beyond the
 *   retreat itself.
 */
import type { Rng } from "../../core/rng";
import type { Actor } from "../actor";
import { G } from "../globals";
import { TurnActorTowardCameraEye } from "../actor_turn";
import { TryClaimAttackSlot } from "../combat/permits";
import { CharacterTypeOf, FirstBakedOf, MotionRowOf } from "../tables";
import type { GameHost } from "../host";
import { dist2d, type Vec3 } from "../vec";
import { ZombieSetMotionIfIdle } from "./motion_cue";
import { ApproachInnerRadius, TestApproachRing } from "./ring";
import { MotionFade, MotionRow, QUEUE_CAP, ZombieState } from "./states";

/** `FUN_00409E80`'s turn rate here is a literal 0x40 BAMS. */
const HOLD_TURN_RATE = 0x40;

export function ZombieStateHoldAtRange(obj: Actor, eye: Vec3, rng: Rng,
                                       host: GameHost): void {
  // Called for its side effect: it refreshes `obj+0x1358`, the queue depth
  // this actor is allowed to sit at.
  TestApproachRing(obj, eye);

  const charType = CharacterTypeOf(obj)?.type ?? -1;
  const tooClose = charType !== 0
    && dist2d(obj.pos, eye) < ApproachInnerRadius(obj) - 1.0;
  if (tooClose) {
    obj.state = ZombieState.BackOff;
    obj.sub = 0;
    return;
  }

  // `if (!(obj+0x1368 & 1)) obj+0x133C = 0` — no cooldown for an ordinary
  // zombie. `ZombieStateWaitForCameraFrame` (state 19) is the only thing that
  // sets the bit, and its four spawns are the only ones that pause between
  // swings; everyone else swings again as soon as the retreat is done.
  if (!obj.hasCooldown) obj.cooldown = 0;
  else if (obj.cooldown >= 1) { obj.cooldown -= 1; return; }

  if (ZombieAttackRefusal(obj) === null && TryClaimAttackSlot(obj, host)) {
    // Body condition 4 goes to state 0x34 instead; that state is unread, and
    // no stage-2 spawn carries condition 4 into this state.
    obj.state = ZombieState.Strike;
    obj.sub = 0;
    return;
  }

  // Waiting its turn: the idle from the motion row, and a slow turn to keep
  // facing you.
  ZombieSetMotionIfIdle(obj,
    FirstBakedOf(obj, MotionRowOf(obj), MotionRow.Walk, MotionRow.WalkAlt),
    rng, 5, MotionFade.Normal);
  TurnActorTowardCameraEye(obj, eye, HOLD_TURN_RATE);
}

/**
 * Why this actor may not swing, in the order the hub asks — or `null`.
 *
 * **The condition and the explanation are one function on purpose.** A crowd
 * standing at the ring looks identical whichever of the five reasons it is,
 * and the sidebar could only say "wants a permit", which is the symptom. A
 * second copy of the test written for the panel would be a copy that drifts,
 * so the state machine asks this and the panel prints the same answer.
 *
 * The first three are `ZombieStateHoldAtRange`'s own gate. The last two are
 * what `TryClaimAttackSlot` (`FUN_00455DE0`) refuses on, read rather than
 * called so that asking does not take the permit.
 */
export function ZombieAttackRefusal(obj: Actor): string | null {
  if (obj.rank >= obj.allowance) {
    return `out of rank — ${obj.rank} in the queue, ${obj.allowance} allowed`;
  }
  if (obj.queueRank >= QUEUE_CAP) {
    return `queued ${obj.queueRank}, past the cap of ${QUEUE_CAP}`;
  }
  if (obj.cooldown >= 1) return `cooling down, ${obj.cooldown} left`;
  // The global latch. One enemy may attack unseen, and while one is, nobody
  // may claim at all — including the ones you can see, which is what makes
  // this so hard to read off the screen.
  if (G.g_attack_committed !== 0) {
    return "another enemy is committed off screen";
  }
  const held = G.g_attack_permits.findIndex((p) => p !== -1);
  if (held !== -1) {
    return `all ${G.g_max_attackers} permits held — 0x`
      + `${(G.g_attack_permits[held] ?? 0).toString(16).toUpperCase()} has it`;
  }
  return null;
}
