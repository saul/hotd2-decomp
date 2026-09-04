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
 *   retreat itself — and it only counts down for an actor that has already
 *   swung, because the countdown is gated on `obj+0x136C & 0x40000` as well.
 */
import type { Rng } from "../../core/rng";
import { ZombieFlag2, type ZombieActor } from "../actor";
import { G } from "../globals";
import { TurnActorTowardCameraEye } from "../actor_turn";
import { TryClaimAttackSlot } from "../combat/permits";
import { CharacterTypeOf, FirstBakedOf, MotionPlayFrame, MotionPlayLength,
         MotionRowOf } from "../tables";
import type { GameHost } from "../host";
import { dist2d, type Vec3 } from "../vec";
import { ActorBodyConditionFromHands } from "./condition";
import { ZombieSetMotionIfIdle } from "./motion_cue";
import { ApproachInnerRadius, TestApproachRing } from "./ring";
import { MotionFade, MotionRow, QUEUE_CAP, ZombieState } from "./states";

/** `FUN_00409E80`'s turn rate here is a literal 0x40 BAMS. */
const HOLD_TURN_RATE = 0x40;

export function ZombieStateHoldAtRange(obj: ZombieActor, eye: Vec3, rng: Rng,
                                       host: GameHost): void {
  // Called for its side effect: it refreshes `obj+0x1358`, the queue depth
  // this actor is allowed to sit at.
  TestApproachRing(obj, eye);
  // And immediately after it, in the engine's own order: the body condition is
  // re-derived from the hands. This is the **only** call site of it in the
  // binary, and leaving it out is not a missing detail — it is what let a
  // `znonoopa` reach `ZombieStateStrike` still on body condition 8, whose
  // attack row is the *throw*: `distance` 99, clip 1005. The lunge test passed
  // at once, the strike began ninety-nine units out, `strikeFloor` shoved the
  // actor back to exactly that range on the next frame, and it stood there
  // playing the throw animation and landing the hit without ever letting go of
  // the axe.
  ActorBodyConditionFromHands(obj);

  const charType = CharacterTypeOf(obj)?.type ?? -1;
  // **The retreat has an escape, and it is two bits of `obj+0x136C`:**
  //
  // ```
  // 0045577c  f7866c13000000040400   TEST dword ptr [ESI+0x136c], 0x40400
  // 00455786  754e                   JNZ  0x004557d6
  // ```
  //
  // `0x40000` is {@link ZombieFlag2.StrikeAnchor} — this actor has swung at
  // least once — and nothing on the melee path ever clears it again, so the
  // exemption is permanent from the first swing on. That is the point: an
  // attack's own `distance` is *inside* the ring (`char_adv00`'s two name 26
  // and 25 against a ring of 25), so a swing always ends too close, and
  // without this the actor is bounced straight back into the retreat on its
  // first frame in the hub instead of taking its next turn.
  //
  // `0x400` is {@link ZombieFlag2.EntryClipPlaying}, which exempts a spawn
  // that is still playing the clip it was authored with.
  const exempt = (obj.flags2
    & (ZombieFlag2.StrikeAnchor | ZombieFlag2.EntryClipPlaying)) !== 0;
  const tooClose = charType !== 0 && !exempt
    && dist2d(obj.pos, eye) < ApproachInnerRadius(obj) - 1.0;
  if (tooClose) {
    obj.state = ZombieState.BackOff;
    obj.sub = 0;
    return;
  }

  // `004557dc a801` — `if (!(obj+0x1368 & 1)) obj+0x133C = 0`: no cooldown for
  // an ordinary zombie. `ZombieStateWaitForCameraFrame` (state 19) is the only
  // thing that sets the bit, and its four spawns are the only ones that pause
  // between swings; everyone else swings again as soon as the retreat is done.
  //
  // The countdown itself has a second gate and a latch-clear:
  //
  // ```
  // 004557e0  f7866c13000000000400   TEST dword ptr [ESI+0x136c], 0x40000
  // 004557ea  7423                   JZ   0x0045580f
  // 004557ec  8b963c130000           MOV  EDX, dword ptr [ESI + 0x133c]
  // 004557f2  4a                     DEC  EDX
  // 004557fb  3bcb                   CMP  ECX, EBX      ; EBX = 0
  // 004557fd  7f10                   JG   0x0045580f
  // 004557ff  24fe                   AND  AL, 0xfe      ; obj+0x1368 &= ~1
  // ```
  //
  // so an actor that has never swung does not tick down at all, and the latch
  // disarms itself when the counter runs out — the cooldown arms **once**.
  //
  // And there is no `RET` anywhere on that path: the exe falls through, the
  // claim gate below tests `obj+0x133C` again, and the idle and the turn at
  // the bottom of this state run on every frame of the wait. An early return
  // here is why a cooling zombie played no idle and never turned to face you.
  if (!obj.zom.hasCooldown) {
    obj.cooldown = 0;
  } else if (obj.flags2 & ZombieFlag2.StrikeAnchor) {
    obj.cooldown -= 1;
    if (obj.cooldown < 1) obj.zom.hasCooldown = false;
  }

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
  // ...and, between the two, the entry clip lets go of itself:
  //
  // ```
  // 004558e4  f6c404       TEST AH, 0x4               ; flags2 & 0x400
  // 004558ef  0fbf144d…    MOVSX EDX, word ptr [ECX*0x2 + 0x4e07d0]
  // 004558fd  83ea02       SUB  EDX, 0x2              ; play_length - 2
  // 00455902  7c09         JL   0x0045590d            ; obj+0x19C < that
  // 00455904  80e4fb       AND  AH, 0xfb
  // ```
  //
  // measured on the **play** clock of whatever is running now, which is why it
  // reads `obj+0x1B4`/`obj+0x19C` after the idle above may have changed them.
  if ((obj.flags2 & ZombieFlag2.EntryClipPlaying)
      && MotionPlayFrame(obj) >= MotionPlayLength(obj) - 2) {
    obj.flags2 &= ~ZombieFlag2.EntryClipPlaying;
  }
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
 * The first four are `ZombieStateHoldAtRange`'s own gate, in the order it asks
 * them. The last two are what `TryClaimAttackSlot` (`FUN_00455DE0`) refuses
 * on, read rather than called so that asking does not take the permit.
 */
export function ZombieAttackRefusal(obj: ZombieActor): string | null {
  // `00455815 f6c404` / `00455818 7535` — the first thing the exe asks, and it
  // jumps past the whole claim. A spawn still playing its authored entry clip
  // does not queue for a permit at all.
  if (obj.flags2 & ZombieFlag2.EntryClipPlaying) {
    return "still playing its entry clip";
  }
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
