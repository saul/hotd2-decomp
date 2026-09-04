/**
 * `CivilianUpdate` — `FUN_0048A920` — and the four tails it runs inline.
 *
 * The collision-sphere switch, the removal countdown, the captor release and
 * the leave have no addresses of their own: the engine writes them out at the
 * bottom of the update. They are here with it rather than in files of their
 * own for exactly that reason.
 */
import { ActorFlag, ThrowerFlag, type Actor } from "../actor";
import { CamPathCueReached } from "../camera/path";
import { ActorDespawn } from "../despawn";
import { ActorByAt, G } from "../globals";
import type { ClassFrame } from "../registry";
import { T, SecondsToTicks } from "../tables";
import { CivilianPruneDeadChildren } from "./children";
import { CivilianRunFrameHook, PoseHookGrowAndPushOutOfWorld } from "./hooks";
import { CivilianCountMotionLoops } from "./loops";
import { CivilianTarget } from "./ops";
import { CivilianRunScript } from "./script";
import { CivilianCheckShot } from "./shot";
import { CivilianStepScript } from "./step";
import { CivilianStepTurnToTarget } from "./turn";

/**
 * `CivilianUpdate` — `FUN_0048A920`. One frame of a civilian.
 *
 * The order is the engine's: prune, hook, turn, interpolate, advance the clip,
 * step the script, then the shot branch, the sound queue and the removal. The
 * shot branch runs **after** the script step on purpose — a shot taken this
 * frame switches the script the step just resumed.
 */
export function CivilianUpdate(obj: Actor, f: ClassFrame): void {
  const sub = obj.civ;
  if (!sub) return;
  const frames = SecondsToTicks(f.dt);

  CivilianPruneDeadChildren(obj);
  CivilianRunFrameHook(obj, frames);
  if (sub.targetMode !== CivilianTarget.None) CivilianStepTurnToTarget(obj, f);

  // Op 0x26's move, which the engine steps by a per-frame delta and then snaps.
  if (sub.moveFrames !== 0) {
    sub.moveFrames -= 1;
    if (sub.moveFrames === 0) {
      obj.pos = { ...sub.moveTo };
    } else {
      obj.pos.x += obj.vel.x;
      obj.pos.y += obj.vel.y;
      obj.pos.z += obj.vel.z;
    }
  }

  // The loop counter. The clip clock itself is `ActorAdvanceMotion`'s; this is
  // the part class 0x10 owns — how many more times it may come round.
  CivilianCountMotionLoops(obj);

  if (CivilianStepScript(obj, f)) {
    CivilianRunScript(obj, sub.script, sub.cursor, f);
  }

  CivilianCheckShot(obj, f);

  // The queued sound, and the list op 0x22 left behind it.
  if (sub.soundDelay !== 0) {
    sub.soundDelay -= 1;
    if (sub.soundDelay === 0) {
      f.events?.emit("sound.play", { id: sub.soundId });
      const next = sub.sounds.shift();
      if (next) { sub.soundId = next[0]; sub.soundDelay = next[1]; }
    }
  }

  // `ActorRegisterCameraPoint` (`FUN_00409B70`) goes here in the engine —
  // `PUSH 0x40800000; CALL 0x00409B70`, bytes `6800008040` at 0x0048ADAB, so
  // class 0x10's lift is **4.0**. It transforms `obj+0x100` into view space,
  // appends the actor to the per-frame gunshot list and raises `obj+0x104` by
  // that argument.
  //
  // The port runs it from `director.ts`, once per visible actor, with the
  // per-class lift from `camera/track.ts`'s `CAMERA_POINT_RISE` — so class
  // 0x10 gets its 4.0 from the same table the other two classes get theirs
  // from. What stays here is the *radius*, `obj+0x124`, which `CivilianInit`
  // sets, and the sphere-centre switch below.
  CivilianWriteSphereCentre(obj);
  PoseHookGrowAndPushOutOfWorld(obj);
  CivilianCheckRemoval(obj);
  // `LAB_0048B0CE`, the tail every path out of `CivilianUpdate` falls into
  // except the two that despawn.
  if (!obj.despawned) CivilianReleaseCaptors(obj);
}

/**
 * The collision-sphere switch at the tail of `CivilianUpdate`: `sub+0x80` (op
 * 0x17) picks which point goes to `obj+0x12C` — the centre
 * `RegisterForShotTest` (`FUN_00405160`) publishes and both the gunshot test
 * and `ColiTestSphereAgainstActors` (`FUN_00405B10`) read. It is class 0x10's
 * `ActorUpdateBoundingSphere`, not a camera point; the camera's is `obj+0x100`.
 *
 * [open] Only mode 0 is ported. Modes 1, 2 and 3 multiply the camera matrix by
 * a matrix inside the model block (`model+0x70`, `model+0x4C`, and the
 * midpoint of `model+0x244` and `model+0x1D8`) and those are not bone records
 * — they are matrices the pose leaves behind, which `game/` cannot reach.
 * Eight of the shipped streams ask for mode 1, four for mode 2, two for mode 3.
 */
function CivilianWriteSphereCentre(obj: Actor): void {
  if (obj.civ?.cameraPointMode !== 0) return;
  obj.sphereCentre.x = obj.pos.x;
  obj.sphereCentre.y = obj.pos.y;
  obj.sphereCentre.z = obj.pos.z;
}

/**
 * `obj+0x136C` bit `0x1` — **draw this actor with the scene light array**.
 *
 * `[proved]`, and it closes an `[open]` the survey left. The only readers in
 * the binary are class 0x31's two part-draw wrappers, `ThrowerDrawPart`
 * (`FUN_0044A200`) and `ThrowerDrawPartWithAlpha` (`FUN_0044A240`): each does
 * `MOV EAX, [g_cur_actor]; TEST byte ptr [EAX + 0x136C], 0x1` — bytes
 * `f6806c13000001`, at 0x0044A205 and 0x0044A245 — and, when the bit is set
 * *and* the scene light array at 0x009A2BB4 (written by
 * `EvtOpSetSceneLighting14`) is non-null, calls
 * `SubmitSlotWithSceneLightArray` (`FUN_004185E0`) instead of `AssetDrawSlot`
 * (`FUN_00418560`). Those two are the whole reader set: a byte-pattern sweep
 * for `TEST byte ptr [r + 0x136C], 1` over the image returns exactly those two
 * addresses, and the dword form returns none. Twelve call sites, all inside
 * `ThrowerDrawBonePart` and its two neighbours.
 *
 * **The enum member belongs in `ThrowerFlag`** — the readers are class 0x31's
 * draw — and that enum is another agent's this wave, so this is a named
 * constant here rather than a member there.
 *
 * `[open]`, and it is the honest half: **the actors this is written onto have
 * no reader for it.** A civilian's captors are the 47 class-0x30 spawns
 * `CivilianInit` builds (`docs/formats/civilians.md`), plus three class-0x18
 * that resolve to no character — and the two `TEST`s above are every read of
 * this bit in the image, both inside class 0x31's draw. So the write is real
 * and transcribed, and in the shipped game it changes nothing. Whether that is
 * a leftover or a path the data never takes is undetermined; the port keeps
 * the write because the engine makes it, not because it can point at an effect.
 */
// The bit is `ThrowerFlag.SceneLit`. It lives on that enum because its only
// two *readers* are class 0x31's draw; this class is one of its two writers.

/**
 * The captor release at the tail of `CivilianUpdate` — `LAB_0048B0CE`.
 *
 * [port-only] name: the engine writes it inline, so it has no address of its
 * own. `[proved]` from 0x0048B0CE–0x0048B121:
 *
 * ```
 * 0048b0ce  TEST  dword ptr [ESI + 0x34], 0x4000000   ; f7463400000004
 * 0048b0d5  JZ    return
 * 0048b0d7  MOV   DX, word ptr [ECX + 0x1e]           ; the surviving-child count
 * 0048b0db  CMP   DX, BX  /  JZ return                ; BX = 0
 * 0048b0e5  JLE   return
 * 0048b0e7  MOV   EDX, 0xfeffffff                     ; ~0x1000000
 * 0048b0ec  MOV   ECX, [ECX + 0x60]                   ; the child array
 * 0048b0ef  MOV   ECX, [ECX + EAX*0x4]                ; child = arr[i]
 * 0048b0f2  MOV   EBX, [ECX + 0x34] / AND EBX, EDX / MOV [ECX + 0x34], EBX
 * 0048b106  MOV   ESI, [ECX + 0x136c] / OR ESI, EDI / MOV [ECX + 0x136c], ESI
 * 0048b121  JL    0048b0ec                            ; EDI = 1, from 0x0048AF7D
 * ```
 *
 * So: once this civilian is **dead** — `obj+0x34` bit `0x4000000`, which the
 * shot branch sets — every surviving captor has `obj+0x34` bit `0x1000000`
 * cleared and `obj+0x136C` bit `0x1` set, every frame for as long as the
 * civilian is still in play. It is not a one-shot: the gate is a flag, not an
 * edge, and both writes are idempotent, so running it every frame is what the
 * engine does and costs nothing. The port had neither write.
 *
 * `ActorFlag.HoldingWeapon` is `obj+0x34` bit `0x1000000`, and the name is
 * narrower than the bit: it was taken from `ZombieStateStandAndThrow`, one
 * writer. The other reader is class 0x30's **death-motion picker**,
 * `ChooseDeathMotion` (`FUN_004560B0`), at 0x004560DD —
 * `TEST dword ptr [ESI + 0x34], 0x1000000`, bytes `f7463400000001` — which
 * takes motion 0x3F9 ahead of every other branch while it is set. So this
 * clear is what gives a released captor its ordinary death clip back instead
 * of the one for an actor that still has hold of something. (A sweep for
 * `TEST r/m32, 0x1000000` finds that site and 0x00430C88 and no more; the
 * `OR`/`AND` forms were not swept, so this is the *reader* set, not every
 * reference.)
 *
 * `ECX` is reloaded from `g_cur_civilian` (0x007DD0A0) on every iteration and
 * the count is re-read each time round, so a child list that shortens mid-loop
 * is honoured. Here the list is `sub.children` and
 * `CivilianPruneDeadChildren` (`FUN_0048CA60`) has already shortened it this
 * frame.
 */
export function CivilianReleaseCaptors(obj: Actor): void {
  const sub = obj.civ;
  if (!sub) return;
  if (!(obj.flags & ActorFlag.Dead)) return;
  for (let i = 0; i < sub.children.length; i++) {
    const kid = ActorByAt(sub.children[i]);
    if (!kid) continue;
    kid.flags &= ~ActorFlag.HoldingWeapon;
    kid.flags2 |= ThrowerFlag.SceneLit;
  }
}

/**
 * The removal cue: camera path `removePath` reaching frame `removeFrame`
 * starts a countdown, and the actor leaves when it runs out.
 */
function CivilianCheckRemoval(obj: Actor): void {
  const sub = obj.civ;
  if (!sub) return;
  if (sub.removeDelay === 0) {
    if (CamPathCueReached(sub.removePath, sub.removeFrame)) {
      sub.removeDelay = Math.max(1, T.civilians?.spawns?.[String(obj.at)]
        ?.removeDelay ?? 0);
    }
    return;
  }
  sub.removeDelay -= 1;
  if (sub.removeDelay !== 0) return;
  // A civilian still holding children does not leave: the engine restarts the
  // countdown instead, which is what keeps a hostage on stage until rescued.
  if (sub.childCount !== 0) { sub.removeDelay = 1; return; }
  CivilianLeaveField(obj);
}

/**
 * Class 0x10's leave: the tail `CivilianUpdate` (`FUN_0048A920`) runs inline
 * rather than in a routine of its own, which is why this has no address.
 *
 * [port-only] For that reason and no other — the code is the engine's, the
 * function is the port's, and `ClassHandler.leave` needs something to name.
 *
 * `if ((sub+0x04 & 1) == 0) g_civilians_alive--;` and then the despawn. Bit 0
 * is the "already left the count" stamp op 0x2C's `LeaveCountNow` sets, so a
 * civilian that took itself out early is not taken out twice.
 *
 * [open] The engine also frees the actor's hit slot —
 * `g_hit_slots[obj+0x3C] = 0` — and the draw record at `model+0x45C`. Neither
 * is modelled by this port at all, so neither is here.
 */
export function CivilianLeaveField(obj: Actor): void {
  const sub = obj.civ;
  if (sub && !(sub.subFlags & 1)) G.g_civilians_alive -= 1;
  ActorDespawn(obj);
}
