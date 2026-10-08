/**
 * The attack permit — `g_attack_permits`, one per player.
 *
 * Winning one is what lets an actor attack *and* what puts it on camera: the
 * permit index lives in `obj+0x121`, and `RegisterForCameraTracking` keys off
 * the same commitment. One byte doing two jobs is the whole trick.
 */
import type { Rng } from "../../core/rng";
import { ThrowerFlag, ZombieFlag2, type Actor } from "../actor";
import { G } from "../globals";
import { IsPlayerAttackable } from "./player";
import type { GameHost } from "../host";
import { vec3, type Vec3 } from "../vec";

/**
 * `g_projection_distance_px` — 0x009A2D70, and a 640x480 frame.
 *
 * `ActorIsOnScreen` tests against `+/-g_projection_distance_px * 0.5`
 * horizontally and `+/-240` vertically, which is how the half-height is known
 * to be 240; the same constant appears in the frustum test at `FUN_0045CA60`
 * with a literal 320 for the half-width.
 *
 * `[proved]` from its one writer, `SetupSceneProjection` (`FUN_004184C0`):
 *
 * ```
 * 00418528  FLD   double ptr [0x004ed1d0]   ; 0.35866388296751145, 20.55 deg
 * 0041852e  FPTAN
 * 00418533  FSTP  ST0
 * 00418535  FDIVR float ptr [0x004c49c8]    ; 240.0 / tan
 * 0041853b  FSTP  float ptr [0x009a2d70]
 * ```
 *
 * so `240 / tan(20.55 deg)` = 640.2079 -- half of the 41.1-degree vertical
 * field over the half-height. It was written 640.2, derived from the field of
 * view rather than read.
 */
const SCREEN_HALF_H = 240;
export const PROJECTION_DISTANCE_PX = 240 / Math.tan(0.35866388296751145);

const _view = vec3();

/**
 * What a release reads and writes: `obj+0x121` and the latch word `obj+0x136C`.
 *
 * An `Actor` is one, and so is a thrown weapon — both launchers hand the
 * thrower's permit to the projectile, which gives it back through the same two
 * routines, `ThrownWeaponFlyToTarget` (`FUN_0044FD40`) at `0x0045001F` and
 * `ZombieThrownWeaponStateStraight` (`FUN_00459690`) at `0x004598C0`. Nothing
 * else of the object is touched, which is why the type asks for nothing else.
 */
export type PermitHolder = Pick<Actor, "attackPermit" | "flags2">;

/**
 * `ActorIsOnScreen` — `FUN_00409C10`.
 *
 * Projects the actor's tracked point and asks whether it lands inside the
 * frame. Both claim functions call it — but **not to refuse the claim**: only
 * after a pick has survived, to decide whether the grant also raises the
 * off-screen latch. See {@link TryClaimAttackSlot}.
 *
 * There is **no sign test**, because the engine has none: it divides by
 * `obj+0x78` whatever its sign and compares against symmetric bounds, so an
 * actor directly behind the camera projects to the mirrored position and
 * reads as on screen. That is a quirk rather than a mistake — the routine
 * only gates the off-screen *latch* — and it is transcribed rather than
 * tidied. A zero depth divides to an infinity, which fails the bounds.
 */
export function ActorIsOnScreen(obj: Actor, host: GameHost): boolean {
  if (!host.viewSpaceOf(obj.at, _view)) return true;   // not posed: no opinion
  if (_view.z === 0) return false;
  const x = (PROJECTION_DISTANCE_PX * _view.x) / _view.z;
  const y = (PROJECTION_DISTANCE_PX * _view.y) / _view.z;
  const halfW = PROJECTION_DISTANCE_PX * 0.5;
  return x >= -halfW && x <= halfW && y >= -SCREEN_HALF_H && y <= SCREEN_HALF_H;
}

/** `ActorBoundsOnScreen`'s half-width: a literal `320.0`, not
 * `g_projection_distance_px * 0.5` as `ActorIsOnScreen` has it. */
const BOUNDS_HALF_W = 320;
/**
 * The skeleton node whose view-space translation `SkeletonEmitNode`
 * (`FUN_004114C0`) stores into `obj+0x10C/0x110/0x114` -- `MOV ECX, 0x1` at
 * `0x00411539`, the default; the store is `FSTP [EDX + 0x10C]` at
 * `0x004115B5` and its two neighbours. Nodes 9 and 2 replace it only on arms
 * gated by `DAT_009C7310` and fields this port has not read. `[likely]` node
 * 1 for every actor the port asks about.
 */
const BOUNDS_NODE = 1;
const _node = vec3();

/**
 * `ActorBoundsOnScreen` — `FUN_0045CA60`. The looser on-screen test: the
 * view-space point `obj+0x10C/0x110/0x114`, padded by the radius `obj+0x124`
 * toward the eye, projected and tested against a 640x480 frame.
 *
 * ```c
 * if (0.0 <= z) return 0;                         // behind the eye
 * nx = x <= 0 ? -x - r : r - x;  ny = y <= 0 ? -y - r : r - y;
 * k  = g_projection_distance_px / z;
 * a = k*nx; b = k*ny; c = -(P*x)/z; d = -(P*y)/z;
 * if ((a < 320 || c < 320) && (-320 < a || -320 < c) && (b < 240 || d < 240))
 *     return !(b <= -240 && d <= -240);
 * return 0;
 * ```
 *
 * Unlike {@link ActorIsOnScreen} it **does** test the sign: a point behind the
 * eye is off screen. Transcribed as read, asymmetries included. With no pose
 * or no camera it answers "on screen", the same "no opinion" the other test
 * gives, so a headless run removes nothing on it.
 */
export function ActorBoundsOnScreen(obj: Actor, host: GameHost): boolean {
  if (!host.boneWorld(obj.at, BOUNDS_NODE, _node)) return true;
  if (!host.viewSpaceOfPoint?.(_node, _view)) return true;
  const { x, y, z } = _view;
  if (0 <= z) return false;
  const r = obj.radius;
  const nx = x <= 0 ? -x - r : r - x;
  const ny = y <= 0 ? -y - r : r - y;
  const k = PROJECTION_DISTANCE_PX / z;
  const a = k * nx;
  const b = k * ny;
  const c = -((PROJECTION_DISTANCE_PX * x) / z);
  const d = -((PROJECTION_DISTANCE_PX * y) / z);
  if ((a < BOUNDS_HALF_W || c < BOUNDS_HALF_W)
      && (-BOUNDS_HALF_W < a || -BOUNDS_HALF_W < c)
      && (b < SCREEN_HALF_H || d < SCREEN_HALF_H)) {
    return !(b <= -SCREEN_HALF_H && d <= -SCREEN_HALF_H);
  }
  return false;
}

/**
 * `CarriedPropIsOnScreen` — `FUN_004459C0`. Is the sphere at the view-space
 * point `obj+0x70..0x78`, radius `obj+0x124`, anywhere on a 640x480 frame?
 *
 * {@link ActorBoundsOnScreen}'s arithmetic on another point: off at or
 * behind the eye (`0.0 <= z`), else the near edge of the sphere on each axis
 * and the centre, both projected at `g_projection_distance_px`, against the
 * literals `320.0`, `-320.0`, `240.0` and `-240.0`
 * (`0x004C49CC`, `0x004D1D10`, `0x004C49C8`, `0x004C4D00`).
 *
 * The name is its first caller's and the routine knows nothing of props: its
 * five callers are three carried-prop routines (`game/carried_prop.ts`), which
 * hand it the point their own draw took under the camera, and the state-6
 * exits of `CarrierPropRoutine1` (`FUN_004403D0`) and `CarrierPropRoutine6`
 * (`FUN_004413C0`), whose point is the one `ScriptedPropUpdate13`
 * (`FUN_0043FE90`) took on the frame before. It lives here, beside the other
 * two screen tests, so that both callers' modules can reach it without an
 * import cycle (`L56`). `p.shotPoint` is in the camera's own space, `-z` in
 * front.
 */
export function CarriedPropIsOnScreen(
  p: { readonly shotPoint: Vec3; readonly radius: number },
): boolean {
  const { x, y, z } = p.shotPoint;
  if (0 <= z) return false;
  const r = p.radius;
  const ex = x <= 0 ? -x - r : r - x;
  const ey = y <= 0 ? -y - r : r - y;
  const k = PROJECTION_DISTANCE_PX / z;
  const sx = k * ex, sy = k * ey;
  const cx = -((PROJECTION_DISTANCE_PX * x) / z);
  const cy = -((PROJECTION_DISTANCE_PX * y) / z);
  if (((sx < BOUNDS_HALF_W || cx < BOUNDS_HALF_W)
       && (-BOUNDS_HALF_W < sx || -BOUNDS_HALF_W < cx))
      && (sy < SCREEN_HALF_H || cy < SCREEN_HALF_H)) {
    return !(sy <= -SCREEN_HALF_H && cy <= -SCREEN_HALF_H);
  }
  return false;
}

/**
 * `ActorScreenHalfSign` — `FUN_00409C90`. Which half of the frame the actor's
 * tracked view-space point projects to: `-1` for the left, `1` for the right.
 *
 * Twelve instructions, and this is the whole of it `[proved]`:
 *
 * ```
 * 00409c94  FLD    float ptr [0x009a2d70]   ; g_projection_distance_px
 * 00409c9a  FMUL   float ptr [EAX + 0x70]   ; view-space x
 * 00409c9d  FDIV   float ptr [EAX + 0x78]   ; view-space z -- no sign test
 * 00409ca0  FCOMP  float ptr [0x004c436c]   ; 0.0
 * 00409ca8  TEST   AH, 0x1                  ; C0: below, or unordered
 * 00409cad  OR     EAX, 0xffffffff          ; not below: -1
 * 00409cb1  MOV    EAX, 0x1                 ; below: 1
 * ```
 *
 * With `-z` in front, a point on the **right** gives `P*x/z < 0` and returns
 * 1, a point on the left returns -1 — so in a two-player game the claim
 * offers player 1 the enemies on the left of the screen and player 2 those on
 * the right `[likely]`: the halves follow from the port's view convention,
 * the rest is read.
 *
 * `[port-only]` A host that cannot place the point — a headless run, or no
 * host at all — gets the arithmetic on a zero point, `0/0`, which is
 * unordered and answers 1. The engine always has a value there: it is the
 * same `obj+0x70/0x78` that `ActorIsOnScreen` and `ShotTestSphere` read.
 */
export function ActorScreenHalfSign(obj: Actor, host?: GameHost): number {
  const placed = host?.viewSpaceOf(obj.at, _view) ?? false;
  const s = placed ? (PROJECTION_DISTANCE_PX * _view.x) / _view.z : NaN;
  return s < 0 || Number.isNaN(s) ? 1 : -1;
}

/**
 * Is `g_attack_permits[p]` free? The engine stores 1 in a claimed entry and
 * tests it against 0; the port stores the holder's `at` and frees with `-1`
 * (see `globals.ts`), so "free" is `-1` here. `[port-only]` as a function.
 */
function PermitIsFree(p: number): boolean {
  return G.g_attack_permits[p] === -1;
}

/**
 * `TryClaimAttackSlot` — `FUN_00455DE0`. Pick **one** player, offer that
 * player's permit, and take it or fail.
 *
 * The whole routine, from the listing `[proved]` (`0x00455DE0`..`0x00455F39`):
 *
 * ```c
 * obj+0x121 = 0xFF;                                  // 00455de5
 * if (g_attack_committed) return 0;                  // 00455dec
 * switch (g_max_attackers) {                         // 00455df9, a word
 * case 1:                                            // 00455ea3
 *     if (g_active_player == 0) {
 *         if (g_attack_permits[0]) goto test;        // no fall-back
 *         obj+0x121 = 0;
 *     }
 *     if (g_active_player == 1 && !g_attack_permits[1]) obj+0x121 = 1;
 *     break;
 * case 2:
 *     if (g_players_in_play == 1) {                  // 00455e0e, a word
 *         p = rand() % 2;                            // 00455e18
 *         if (!g_attack_permits[p]) obj+0x121 = p;
 *     } else if (g_enemies_present == 1) {           // 00455e43, a word
 *         p = rand() % 2;                            // 00455e4d
 *         obj+0x121 = g_attack_permits[p] ? ~p : p;  // 00455e69 NOT
 *     } else {
 *         s = ActorScreenHalfSign(obj);              // 00455e74
 *         if (s == -1 && !g_attack_permits[0]) obj+0x121 = 0;
 *         if (s ==  1 && !g_attack_permits[1]) obj+0x121 = 1;
 *     }
 * }
 * test:                                              // 00455ed5
 * if (!IsPlayerAttackable((s8)obj+0x121)) obj+0x121 = 0xFF;
 * if (obj+0x121 == 0xFF) return 0;                   // 00455ef0
 * if (!ActorIsOnScreen(obj)) { obj+0x136C |= 0x20000; g_attack_committed = 1; }
 * g_attack_permits[obj+0x121] = 1;                   // 00455f32
 * return 1;
 * ```
 *
 * So **nothing falls back to the other player.** One player alone is offered
 * only `g_active_player`'s permit — player 2 alone included, which the port's
 * old first-free loop gave player 1's — and with two players in play the
 * enemy comes for the player on its own half of the screen. The two
 * `rand() % 2` arms are one `Rng.int(2)` each, drawn from the frame's `rng`
 * **at this point in the caller** and nowhere else, which is why every
 * claimant carries one. The one-attacker and screen-half arms draw nothing.
 *
 * `IsPlayerAttackable` (`FUN_00409DC0`) runs **after** the pick and voids it,
 * so a player who cannot be attacked refuses the claim rather than passing it
 * to the other one. It also runs on a pick of `-1`: the engine reads 0x130
 * bytes below `g_player_state` for it, and the port's `player >= 0` guard
 * says no.
 *
 * **Being off screen does not refuse the claim**: it grants it and raises the
 * global latch, `g_attack_committed`, which the next claim anywhere reads on
 * its second instruction. A port that refused off-screen claims left enemies
 * the rail had carried the camera into standing in your face for ever.
 *
 * It writes **nothing else**. Not `obj+0x34`: there is no store to the word
 * anywhere in either claim routine, so whether the camera may track the actor
 * is decided by each caller -- `ZombieStateApproach` clears `NoCameraTrack`
 * itself on a successful claim (`0x00457A4E`), `ZombieStateWaitForCameraFrame`
 * before it claims (`0x004576E5`), `ZombieStateHoldForCameraCue` at its cue
 * (`0x0045C00C`) -- and class 0x31 clears it nowhere. There is no queue-rank
 * test either; that lives in `ZombieStateApproach` and the hub, before their
 * calls (`L11`).
 */
export function TryClaimAttackSlot(obj: Actor, rng: Rng, host?: GameHost,
                                   offScreenBit: number =
                                     ZombieFlag2.OffScreenPermit): boolean {
  // **The first write is `obj+0x121 = 0xFF`, before anything is tested** —
  // `MOV byte ptr [ESI + 0x121], 0xff` (`c68621010000ff`) at `0x00455DE5`
  // here and at `0x0044CA45` in `ThrowerTryClaimAttackSlot`, straight after
  // the argument load in both. So a claim that fails leaves the
  // actor holding *no* index, whatever it held before. It matters because
  // `ZombieStateHoldForCameraCue` (`FUN_0045BFD0`) frees the permit table's
  // entry and leaves `obj+0x121` pointing at it; without this, a later refusal
  // kept that stale index and the actor's own release would free whichever
  // actor had claimed the slot since. `[proved]`
  obj.attackPermit = -1;
  // The latch is read first and gives up before a player is even picked.
  if (G.g_attack_committed !== 0) return false;

  if (G.g_max_attackers === 1) {
    // `0x00455EA3`. Player 1's arm falls into player 2's test, which cannot
    // match on the same `g_active_player`; a taken permit jumps past both.
    if (G.g_active_player === 0 && PermitIsFree(0)) obj.attackPermit = 0;
    else if (G.g_active_player === 1 && PermitIsFree(1)) obj.attackPermit = 1;
  } else if (G.g_max_attackers === 2) {
    if (G.g_players_in_play === 1) {
      // `rand() & 0x80000001`, sign-corrected: the compiler's `rand() % 2`.
      const p = rng.int(2);
      if (PermitIsFree(p)) obj.attackPermit = p;
    } else if (G.g_enemies_present === 1) {
      // A taken permit is **NOT**-ed (`0x00455E69`), not swapped: `~0` is -1,
      // which fails below, and `~1` is -2 -- see the check after the gate.
      const p = rng.int(2);
      obj.attackPermit = PermitIsFree(p) ? p : ~p;
    } else {
      const s = ActorScreenHalfSign(obj, host);
      if (s === -1 && PermitIsFree(0)) obj.attackPermit = 0;
      else if (s === 1 && PermitIsFree(1)) obj.attackPermit = 1;
    }
  }

  // `if (!IsPlayerAttackable((s8)obj+0x121)) obj+0x121 = 0xFF` — no enemy may
  // claim while the follow camera or a scripted view-angle turn is driving,
  // or while the picked player is out of play.
  if (!IsPlayerAttackable(obj.attackPermit)) obj.attackPermit = -1;
  if (obj.attackPermit === -1) return false;
  // [diverges] A pick of `-2` survives only when `IsPlayerAttackable(-2)` is
  // true, which in the engine is attract mode (`g_app_state == 5` answers
  // true for any index) or whatever lies 0x260 bytes below `g_player_state`.
  // The engine then claims "permit -2": it writes 1 to `0x009A2B98`, eight
  // bytes below `g_attack_permits`, and the actor attacks holding `0xFE`. The
  // port runs no attract mode and its `IsPlayerAttackable` refuses a negative
  // player outside it, so this is unreachable here; it refuses rather than
  // scribble on an array index the port does not have.
  if (obj.attackPermit < 0) { obj.attackPermit = -1; return false; }

  // Granted either way; off screen it also latches, so this actor is the only
  // one that may be attacking unseen. No host means no camera to measure
  // against, and the port reads that as on screen.
  if (host && !ActorIsOnScreen(obj, host)) {
    obj.flags2 |= offScreenBit;
    G.g_attack_committed = 1;
  }
  // The engine stores 1; the port stores the holder, which every reader
  // tests against -1 and the debug panels print.
  G.g_attack_permits[obj.attackPermit] = obj.at;
  return true;
}

/**
 * `ThrowerTryClaimAttackSlot` — `FUN_0044CA40`.
 *
 * Class 0x31's copy of `TryClaimAttackSlot`, instruction for instruction
 * (`0x0044CA40`..`0x0044CB97` against `0x00455DE0`..`0x00455F39`) — the same
 * void, the same latch read, the same pick and the same two `rand()` calls —
 * except the off-screen latch bit: `OR AH, 0x80` at `0x0044CB70`, `obj+0x136C`
 * bit `0x8000`, where the zombie's copy has `OR EAX, 0x20000`. Kept separate
 * for the reason the exe has two: gating the thrower on the zombie's rank test
 * is why the elevated ones never threw — they are far away by design, so
 * their distance rank is always high. `[proved]`
 */
export function ThrowerTryClaimAttackSlot(obj: Actor, rng: Rng,
                                          host?: GameHost): boolean {
  return TryClaimAttackSlot(obj, rng, host, ThrowerFlag.OffScreenPermit);
}

/**
 * Why a claim would be refused right now, in the order the claim asks — or
 * `null` when it may succeed. For the debug panels.
 *
 * `[port-only]` It **reads** what `TryClaimAttackSlot` tests rather than
 * calling it, so asking neither takes a permit nor draws from the `Rng`; the
 * two-player arms whose pick is a coin toss or a screen half are reported only
 * when neither permit could be offered.
 */
export function AttackClaimRefusal(): string | null {
  if (G.g_attack_committed !== 0) {
    return "another enemy is committed off screen";
  }
  const holder = (p: number) => `0x${(G.g_attack_permits[p] ?? 0)
    .toString(16).toUpperCase()} has it`;
  if (G.g_max_attackers === 1) {
    const p = G.g_active_player;
    if (p !== 0 && p !== 1) return `no permit is offered to g_active_player ${p}`;
    if (!PermitIsFree(p)) return `player ${p + 1}'s permit is held — ${holder(p)}`;
    if (!IsPlayerAttackable(p)) return `player ${p + 1} is not attackable`;
    return null;
  }
  if (G.g_max_attackers === 2) {
    if (!PermitIsFree(0) && !PermitIsFree(1)) {
      return `both permits held — ${holder(0)}, ${holder(1)}`;
    }
    return null;
  }
  return `g_max_attackers is ${G.g_max_attackers}: no permit is offered`;
}

/**
 * `ReleaseAttackSlot` — `FUN_00456520`, and `ThrowerReleaseAttackPermit`
 * (`FUN_0044CFB0`) is the same function with the other bit.
 *
 * Fifteen instructions, and this is all of them:
 *
 * ```
 * 00456526  MOV  AL, byte [ECX + 0x121]        ; 8a8121010000
 * 0045652c  CMP  AL, 0xff                      ; 3cff
 * 00456533  MOV  [EAX*0x4 + 0x9a2ba0], EDX     ; 891485a02b9a00   g_attack_permits
 * 0045653a  MOV  byte [ECX + 0x121], 0xff      ; c68121010000ff
 * 00456547  TEST EAX, 0x20000                  ; a900000200       obj+0x136C
 * 0045654e  AND  EAX, 0xfffdffff               ; 25fffffdff
 * 00456559  MOV  [0x009a34f0], EDX             ; 8915f0349a00     g_attack_committed
 * ```
 *
 * **It never touches `obj+0x34`.** The permit is one thing and camera tracking
 * is another, and the routine that joins them is the *caller* —
 * `ZombieReleasePermitAndUntrack` (`FUN_004565A0`) for class 0x30 — where the
 * `NoCameraTrack` raise travels together with the `g_enemy_slots` clear and
 * both are guarded by {@link ActorFlag.KeepCameraWhenLast}. This used to raise
 * the bit here, unconditionally, which defeated that guard on every release
 * path in both ported enemy classes,
 * and the decision was to match the engine.
 *
 * Releasing an off-screen permit is the **only** thing that lifts
 * `g_attack_committed`, so forgetting *that* here would stall every enemy in
 * the scene rather than just this one.
 */
export function ReleaseAttackSlot(obj: PermitHolder,
                                  offScreenBit: number =
                                    ZombieFlag2.OffScreenPermit): void {
  if (obj.attackPermit >= 0) G.g_attack_permits[obj.attackPermit] = -1;
  obj.attackPermit = -1;
  if (obj.flags2 & offScreenBit) {
    obj.flags2 &= ~offScreenBit;
    G.g_attack_committed = 0;
  }
}

/** `ThrowerReleaseAttackPermit` — `FUN_0044CFB0`. */
export function ThrowerReleaseAttackPermit(obj: PermitHolder): void {
  ReleaseAttackSlot(obj, ThrowerFlag.OffScreenPermit);
}
