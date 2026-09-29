/**
 * `ThrowerStrikeConnect` — `FUN_0044CE60`. The stab.
 *
 * Worth stating plainly because it is the opposite of what you would write:
 * **it tests no range at all.** The hit lands when the clip reaches the frame
 * the attack entry names, and the only other condition is the cancel mask --
 * if every zone the attack needs has been shot off, the swing whiffs. That is
 * the same design as the zombie's strike and as the thrown weapon's expiry:
 * this engine *times* its hits, it does not test them.
 *
 * Which makes the leap the aiming: `ThrowerStateLeapDown` arcs the actor onto
 * a point in front of the camera and runs this every frame of the flight, so
 * the stab connects because the arc put the actor there on that frame.
 */
import type { Events } from "../../core/events";
import { ActorFlag, ThrowerFlag, type ThrowerActor } from "../actor";
import { ThrowerLeave } from "./death";
import { PlayerTakeDamage } from "../combat/player";
import { ActorPlayCursor, ArcPhase } from "./arc";
import { ThrowerAttackOf, ThrowerThrowEntryOf } from "./tables";

/**
 * `CMP ECX, -0x1` at `0x0044CEA3`: a melee hit frame of `-1` means "when the
 * arc reaches its landing phase", `obj+0x1360 == 4`, rather than a numbered
 * frame.
 */
const HIT_ON_LANDING = -1;

/**
 * `ThrowerStrikeConnect` — `FUN_0044CE60`. Run the connect for this frame.
 *
 * `[proved]` from the listing, the whole routine:
 *
 * ```
 * 0044ce6b  if (obj+0x136C & 0x400) goto throw
 *           e = g_class31_melee_attacks[obj+0x130C]
 *                 + ((s8)obj+0x131A + obj+0x1364*4) * 0x10
 * 0044ce9f  if (obj+0x19C != e.hit_frame
 *               && !(e.hit_frame == -1 && obj+0x1360 == 4)) return
 * 0044cec7  if ((obj+0x1318 & e.mask & 7) == e.mask) return      ; whiffs
 * 0044cecf  if (obj+0x34 & 0x2000000) {
 *             PlayerTakeDamage((s8)obj+0x121, 0, e.overlay)
 *             obj+0x136C |= 0x800; ThrowerLeave(obj); return }
 * 0044cf13  PlayerTakeDamage((s8)obj+0x121, 1, e.overlay); obj+0x136C |= 0x800
 * throw:
 * 0044cf2c  e = g_class31_throws[obj+0x130C] + (s8)obj+0x131A * 0x10
 * 0044cf50  if (obj+0x19C != (s16)e+8) return
 * 0044cf67  if (((obj+0x1318 & 7) & (s16)e+0xC) == (s16)e+0xC) return
 * 0044cf6c  if (obj+0x34 & 0x2000000) {
 *             PlayerTakeDamage((s8)obj+0x121, 0, (s16)e+0xA)
 *             ThrowerLeave(obj); return }                   ; no 0x800
 * 0044cfa3  PlayerTakeDamage((s8)obj+0x121, 1, (s16)e+0xA)
 * ```
 *
 * Three things here are easy to get wrong, and the port had all three:
 *
 * * **The frame test is `==`.** A clip that jumps past the hit frame -- an
 *   arc script whose fit skips into the middle of its clip, or a connect
 *   first called after the frame has gone by -- does not hit at all. The port
 *   tested `>=`, which hit late in every one of those cases.
 * * **It does not test `obj+0x136C` bit `0x800` itself.** It raises it on a
 *   melee hit, and the *callers* that want one hit per swing test it before
 *   calling -- `ThrowerStateLeapDown` does, `ThrowerStateDelayedPounce` and
 *   `ThrowerStateStrikeOnTheSpot` do not. The port tested it in here, which
 *   was what stood in for the `==` above.
 * * **The throw-table arm is real.** `ThrowerStateWaitForPermit` raises
 *   `0x400` for character type 0x17 on its way to states 0x18 and 0x20, so
 *   `zskamere`'s two attacks resolve against `g_class31_throws`' own hit
 *   frame, overlay and mask -- and raise no `0x800`. The port returned at the
 *   bit, so no `zskamere` attack ever landed.
 *
 * The player index is passed as it stands: `PlayerTakeDamage` refuses `-1`
 * itself (`FUN_00415300`), and the despawning arm still runs `ThrowerLeave`
 * without one. The port used to return before either.
 *
 * Returns whether the damage call landed, which is the port's: the engine's
 * routine returns nothing.
 */
export function ThrowerStrikeConnect(obj: ThrowerActor,
                                     events?: Events): boolean {
  const cursor = ActorPlayCursor(obj);                     // obj+0x19C
  if (obj.flags2 & ThrowerFlag.UseThrowTable) {
    // The row as the engine reads it, the zero row where the bundle omits one
    // -- see `ThrowerThrowEntryOf`. A zero row's mask of 0 whiffs on frame 0.
    const t = ThrowerThrowEntryOf(obj, obj.attack);
    if (cursor !== t.hit_frame) return false;
    if ((obj.zones & 7 & t.cancel_mask) === t.cancel_mask) return false;
    if (obj.flags & ActorFlag.StrikeAndLeave) {
      const hit = PlayerTakeDamage(obj.attackPermit, 0, t.overlay_kind,
                                   events, obj, "strike", obj.attack);
      ThrowerLeave(obj);
      return hit;
    }
    return PlayerTakeDamage(obj.attackPermit, 1, t.overlay_kind, events, obj,
                            "strike", obj.attack);
  }

  // `[port-only]` The engine reads whatever the row holds; the bundle omits
  // entries the table does not fill.
  const e = ThrowerAttackOf(obj, obj.thr.stance, obj.attack);
  if (!e) return false;
  if (cursor !== e.hit_frame
      && !(e.hit_frame === HIT_ON_LANDING
           && obj.arcPhase === ArcPhase.Settled)) {
    return false;
  }
  // "If every zone this attack names is destroyed it whiffs." 1 head, 2 right
  // arm, 4 left arm; mask 8 is outside the three-bit zone mask, so it never
  // cancels -- and mask 0 always does.
  const mask = e.cancel_mask;
  if ((obj.zones & mask & 7) === mask) return false;

  if (obj.flags & ActorFlag.StrikeAndLeave) {
    const hit = PlayerTakeDamage(obj.attackPermit, 0, e.overlay_kind, events,
                                 obj, "strike", obj.attack);
    obj.flags2 |= ThrowerFlag.Struck;
    ThrowerLeave(obj);
    return hit;
  }
  const hit = PlayerTakeDamage(obj.attackPermit, 1, e.overlay_kind, events,
                               obj, "strike", obj.attack);
  obj.flags2 |= ThrowerFlag.Struck;
  return hit;
}
