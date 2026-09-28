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
import { ActorRegisterCameraPoint } from "../camera/track";
import { CarrierPublishWorld } from "../carrier";
import { ActorDespawn } from "../despawn";
import { ActorByAt, G } from "../globals";
import type { ClassFrame } from "../registry";
import { T, SecondsToTicks } from "../tables";
import { CivilianPruneDeadChildren } from "./children";
import { CivilianRunFrameHook, PoseHookGrowAndPushOutOfWorld } from "./hooks";
import { CivilianCountMotionLoops } from "./loops";
import { CivilianSphereMode, CivilianTarget, CivilianWait } from "./ops";
import { ActorBoundsOnScreen } from "../combat/permits";
import type { GameHost } from "../host";
import { CivilianRunScript } from "./script";
import { CivilianCheckShot } from "./shot";
import { CivilianStepScript } from "./step";
import { CivilianStepTurnToTarget } from "./turn";

/**
 * `CivilianUpdate` — `FUN_0048A920`. One frame of a civilian.
 *
 * The order is the engine's: prune, hook, turn, interpolate, draw, advance
 * the clip, step the script, then the shot branch, the sound queue, the
 * camera point, the sphere switch and the removal. The shot branch runs
 * **after** the script step on purpose — a shot taken this frame switches the
 * script the step just resumed.
 */
export function CivilianUpdate(obj: Actor, f: ClassFrame): void {
  const sub = obj.civ;
  if (!sub) return;
  // `CivilianUpdateOnCarrier` (`FUN_0048B140`) is this routine with the
  // carrier's matrix pushed around it. The push is `game/carrier.ts`'s and
  // the world point it produces is published for the renderer; everything
  // below runs on the carrier-relative position, which is where the engine's
  // matrix stack leaves it too.
  if (obj.carrierAt >= 0) {
    CarrierPublishWorld(obj, ActorByAt(obj.carrierAt));
  }
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

  // `DrawSkinnedModelAndShadow` (`FUN_00411090`) at `0x0048AA02`. The pose is
  // the renderer's; what the draw runs that is the game's is the pose hook at
  // `model+0x115C`, which reads the sphere the switch below left last frame.
  PoseHookGrowAndPushOutOfWorld(obj);

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

  // `PUSH 0x40800000; CALL 0x00409B70`, bytes `6800008040` at `0x0048ADAB`,
  // on every path through the routine: the camera point lifted by **4.0** and
  // the civilian filed as a camera candidate. Her script's wait word drives
  // `obj+0x34` bit `0x10000` (`class10/script.ts`), which is what decides
  // whether `RegisterForCameraTracking` takes her -- the whole of bug 18.
  ActorRegisterCameraPoint(obj, f.host, CIVILIAN_CAMERA_RISE);
  CivilianWriteSphereCentre(obj, f.host);
  CivilianCheckRemoval(obj, f.host);
  // `LAB_0048B0CE`, the tail every path out of `CivilianUpdate` falls into
  // except the two that despawn.
  if (!obj.despawned) CivilianReleaseCaptors(obj);
}

/** `PUSH 0x40800000` at `0x0048ADAB`: `ActorRegisterCameraPoint`'s 4.0. */
export const CIVILIAN_CAMERA_RISE = 4.0;

/**
 * Where a bone's draw-record matrix sits off `g_cur_actor_model`
 * (`0x007DD09C`, `obj+0x194`): `model+0xA0 + bone*0x90`. That is
 * `SkeletonEmitNode`'s `g_skeleton_node_out + bone*0x90 + 0x28`, with the
 * record base `DrawSkinnedModelAndShadow` is handed as `model+0x78`
 * (`obj+0x20C`); the same stride `LEA ECX,[EAX+EAX*8]; SHL ECX,4` builds at
 * `0x0048ABD2` for the shot branch's `model + 0xA0 + bone*0x90`.
 */
const RECORD_MATRIX = 0xa0;
const RECORD_STRIDE = 0x90;

/** The bone whose record sits at `model + off`. */
function RecordBone(off: number): number {
  return (off - RECORD_MATRIX) / RECORD_STRIDE;
}

/**
 * The bones the switch reads, from the offsets it adds: `ADD ECX, 0x1C0` at
 * `0x0048AE24`, `ADD EDX, 0x130` at `0x0048AE88`, `ADD EAX, 0x910` at
 * `0x0048AEEB` and `ADD ECX, 0x760` at `0x0048AF28`. Bone 1 is the root node
 * of every civilian skeleton (its offset is zero), bone 2 its child five-odd
 * units above it, and 12 and 15 the children of 11 and 14, 4.76 below them
 * — `[likely]` the two legs' lower joints, from the tree and not from any
 * name the engine gives them.
 */
export const CIVILIAN_SPHERE_BONE_MODE1 = RecordBone(0x1c0);   // 2
export const CIVILIAN_SPHERE_BONE_MODE2 = RecordBone(0x130);   // 1
export const CIVILIAN_SPHERE_BONE_MODE3_A = RecordBone(0x910); // 15
export const CIVILIAN_SPHERE_BONE_MODE3_B = RecordBone(0x760); // 12

/** `FMUL float ptr [0x004C43AC]`, `0x3F000000`: mode 3's midpoint. */
const HALF = 0.5;

const _a = { x: 0, y: 0, z: 0 };
const _b = { x: 0, y: 0, z: 0 };

/**
 * The collision-sphere switch at the tail of `CivilianUpdate`,
 * `0x0048ADB5`..`0x0048AF83`: `sub+0x80` (op 0x17) picks which point goes to
 * `obj+0x12C`, the centre `RegisterForShotTest` (`FUN_00405160`) publishes
 * and `ColiTestSphereAgainstActors` (`FUN_00405B10`) and
 * `PoseHookGrowAndPushOutOfWorld` read. It is class 0x10's
 * `ActorUpdateBoundingSphere`, not a camera point; the camera's is
 * `obj+0x100`. See {@link CivilianSphereMode} for the four arms. `[proved]`
 *
 * ```
 * MatrixStackPush(0)
 * switch ((s8)sub+0x80) {
 * case 0: obj+0x12C = obj+0x40                                   ; position
 * case 1: MatrixStackSetTopFromArray(g_camera_blocks[g_camera_index])
 *         MatrixMultiply(model+0x1C0); obj+0x12C = translation   ; bone 2
 * case 2: ...           MatrixMultiply(model+0x130) ...          ; bone 1
 * case 3: ... model+0x910 -> a;  ... model+0x760 -> b
 *         obj+0x12C = (a + b) * 0.5                               ; 15 and 12
 * }
 * MatrixStackPop(1)
 * ```
 *
 * `MatrixMultiply` (`FUN_004A92A0`) post-multiplies (`top = top * arg`, in
 * the element layout `Matrix4` shares), so each arm is
 * `viewToWorld * record`, and its translation is the bone's origin in the
 * world — the product `SkeletonEmitNode` itself takes for `obj+0x100` when it
 * emits the tracked node, through the pre-multiplying twin
 * `MatrixPremultiplyTop` (`FUN_004A9570`) at `0x004115F7`.
 * `GameHost.boneWorld` is that point.
 *
 * Mode 0 copies `obj+0x40`, which on a carrier is the carrier-relative
 * position — the engine does exactly that, and so does this. The bone arms
 * are drawn under the carrier's matrix and come out in the world.
 *
 * **What was wrong before.** Only mode 0 was ported, on a note that the other
 * arms read "matrices the pose leaves behind" at `model+0x70`, `+0x4C`,
 * `+0x244` and `+0x1D8`, and are not bone records. Those were Ghidra's
 * `int *` indices, not byte offsets — times four they are `0x1C0`, `0x130`,
 * `0x910` and `0x760`, four draw records exactly. And `CivilianInit` writes
 * mode 2, so the arm left out was the one nearly every civilian runs: only
 * the one stream that selects mode 0 (stage 2's `0xA134`) ever wrote the
 * sphere, and both readers re-derived class 0x30's feet-plus-radius-plus-one
 * over whatever was there.
 *
 * [diverges] The engine reads the pose it drew **this** frame, a few lines
 * up in the same routine, after the move step and the pose hook's push; the
 * port's pose is the renderer's and so the one it last drew, a tick behind
 * for a civilian that is moving. That is the reading `ActorRegisterCameraPoint`
 * and the frog's bone 1 take too. Closing it is giving the civilian the
 * engine's model block (`Actor.skel`, `game/skeleton.ts`) and calling
 * `DrawSkinnedModelAndShadow` where `CivilianUpdate` does, as class 0x14
 * already does -- which moves the class's clip clock, its root motion and
 * its draw off the director and the renderer's own posing, and on a carrier
 * needs the carrier's matrix under the walk.
 *
 * `[port-only]` With no posed skeleton — a headless host, or the tick before
 * the renderer adopts a new spawn — a bone arm has no record to read, which
 * the engine never lacks: its draw is on the lines above. The arm then takes
 * mode 0's point, the position, and mode 3 does so unless both of its bones
 * answer. Keeping what the field held instead would leave a sphere at the
 * world origin for every civilian a headless run makes — the pool clears it —
 * and `ColiTestSphereAgainstActors` measures it there, which is a collision
 * the game cannot have.
 */
export function CivilianWriteSphereCentre(obj: Actor, host: GameHost): void {
  const sub = obj.civ;
  if (!sub) return;
  const c = obj.sphereCentre;
  switch (sub.sphereCentreMode as CivilianSphereMode) {
    case CivilianSphereMode.Position:
      break;
    case CivilianSphereMode.Bone2:
      if (!host.boneWorld(obj.at, CIVILIAN_SPHERE_BONE_MODE1, _a)) break;
      c.x = _a.x; c.y = _a.y; c.z = _a.z;
      return;
    case CivilianSphereMode.Bone1:
      if (!host.boneWorld(obj.at, CIVILIAN_SPHERE_BONE_MODE2, _a)) break;
      c.x = _a.x; c.y = _a.y; c.z = _a.z;
      return;
    case CivilianSphereMode.Bones12And15:
      if (!host.boneWorld(obj.at, CIVILIAN_SPHERE_BONE_MODE3_A, _a)) break;
      if (!host.boneWorld(obj.at, CIVILIAN_SPHERE_BONE_MODE3_B, _b)) break;
      c.x = (_b.x + _a.x) * HALF;
      c.y = (_b.y + _a.y) * HALF;
      c.z = (_b.z + _a.z) * HALF;
      return;
    default:
      // `JA 0x0048AF7D`: any other byte writes nothing.
      return;
  }
  // Mode 0, `0x0048ADDB`: `obj+0x40..0x48` -- and the fallback above.
  c.x = obj.pos.x;
  c.y = obj.pos.y;
  c.z = obj.pos.z;
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
 * The removal arms at the tail of `CivilianUpdate` (`FUN_0048A920`,
 * `0x0048AF8E..0x0048B0C8`), in the engine's order. `[proved]`
 *
 * ```
 * if (g_cutscene_skipping && !(word & 0x20000000)) sub+0x2A = 1;   // skip
 * else if (sub+0x2A) {                                             // countdown
 *   if (--sub+0x2A == 0) { if (children) sub+0x2A = 1; else leave; }
 * } else if (g_active_cam_path == sub+0x26 && g_cam_path_frame == sub+0x28)
 *   sub+0x2A = tail+0x06;                                          // the cue
 * else if (word & 0x2000000                                        // off camera
 *          && !ActorBoundsOnScreen(obj)
 *          && g_scene_state_major_entered != 2
 *          && !children)
 *   leave;
 * ```
 *
 * The off-camera arm is how most civilians go: of the 126 streams that end in
 * themselves (the other ten hand over with op 0x1E/0x1F), 87 end on a word
 * carrying `0x2000000`, and `goto_scene_state` taking the major to 1 after a
 * room is when it can fire. The port had the cue and the countdown
 * only, so a rescued civilian stood where her script left her for the rest of
 * the stage.
 *
 * [open] The skip arm: `g_cutscene_skipping` (`0x009A2230`) has no field in
 * `G` -- see `class41/type13.ts` for the same gap.
 */
function CivilianCheckRemoval(obj: Actor, host: GameHost): void {
  const sub = obj.civ;
  if (!sub) return;
  if (sub.removeDelay !== 0) {
    sub.removeDelay -= 1;
    if (sub.removeDelay !== 0) return;
    // A civilian still holding children does not leave: the engine restarts
    // the countdown instead, which is what keeps a hostage on stage until
    // rescued.
    if (sub.childCount !== 0) { sub.removeDelay = 1; return; }
    CivilianLeaveField(obj);
    return;
  }
  if (CamPathCueReached(sub.removePath, sub.removeFrame)) {
    sub.removeDelay = Math.max(1, T.civilians?.spawns?.[String(obj.at)]
      ?.removeDelay ?? 0);
    return;
  }
  if (!(sub.wait & CivilianWait.RemoveOffCamera)) return;
  if (ActorBoundsOnScreen(obj, host)) return;
  if (G.g_scene_state_major_entered === SCENE_MAJOR_PATH_CAMERA) return;
  if (sub.childCount !== 0) return;
  CivilianLeaveField(obj);
}

/** `g_scene_state_major_entered`'s `cam/` path row -- `CMP [0x009C6F08], 2`
 * at `0x0048B068`. */
const SCENE_MAJOR_PATH_CAMERA = 2;

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
