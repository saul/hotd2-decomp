/**
 * Class 0x28 -- an object that holds a pose on an `op_` path until camera path
 * `0x2F` reaches a frame, then rides the rest of the path and is killed.
 *
 * ```
 * PathRidingPropUpdate           FUN_00432610   the handler: seat, launch, ride, kill
 * PathRidingPropFixedPoseUpdate  FUN_00432810   the g_app_state 10 handler
 * PathRidingPropDraw             FUN_00432840   the draw -- render/rigs.ts'
 * ```
 *
 * `[proved]` Six shipped spawns, all stage 1 and all the same two descriptors
 * (`24472` with `obj+0x11C` 0, `24512` with 1), placed by `spawn_placed` in
 * blocks 5, 11 and 14 -- the three blocks the route runs through into the
 * JUDGMENT fight. Route 0 is `op_st1` 72 (slot `0x145`), route 1 `op_st1` 73
 * (`0x146`); both begin at the frame the table freezes them on, 671 and 667,
 * and camera path `0x2F` is the boss block's own. So they wait where the
 * path's first key puts them through the whole of the boss's arrival, and the
 * frame the walker lands they are thrown along the rest of their path. The
 * draw is asset slot `0x33` under the pose, and -- until the throw -- two
 * sprite loops above it (`PathRidingPropDraw`'s tail). What the model depicts
 * is not this module's business; the user's report calls them cars.
 *
 * ## What the port used to do instead
 *
 * Nothing in `game/`. `render/rigs.ts` drew the object from the rig table's
 * two routes with no gate at all, as one "actor" of whichever route came first
 * in the glTF, at `path(min(len, camera frame))` of **whatever camera was
 * playing**: so before the throw it slid along the path's first segment
 * extrapolated backwards from frame 671 (a pose the engine never evaluates),
 * and every later camera move whose frame passed 671 threw it again --
 * `cp_st1` 50 after the fight runs 0..680 and 681..950. It was drawn from
 * stage load in every block, never killed, and it drew in stages 2 and 5 as
 * well, which place no class 0x28 at all. `docs/re/rig-survey.md` recorded it
 * `[open]` as "the player still sweeps those four routes from frame 0".
 */
import type { Actor } from "../actor";
import { G } from "../globals";
import type { GameHost } from "../host";
import {
  registerClass, type ActorDebug, type ClassFrame, type ClassHandler,
} from "../registry";
import { SpawnClass } from "../spawn_class";
import type { PathRidingPropTail } from "./state";

export { makePathRidingPropTail, type PathRidingPropTail } from "./state";

/**
 * `g_class28_route_table` -- `0x00589AE0`, `{s16 op_ slot, s16 freeze frame}`,
 * indexed by `obj+0x11C`. Read out of the image; `web/tools/checks/prop_tables.ts`
 * compares it word for word.
 */
export const CLASS28_ROUTES: ReadonlyArray<readonly [number, number]> = [
  [0x145, 0x29f], [0x146, 0x29b], [0x149, 0], [0x14a, 0],
];

/**
 * `g_cam_path_length` (`0x00576D38`) at the four route slots --
 * `[0x0057724C]`, `[0x00577250]`, `[0x00577264]`, `[0x00577268]` -- the
 * frame the handler kills the object on (`CMP EDX, [ECX*4 + 0x576D38]` at
 * `0x00432647`).
 */
export const CLASS28_ROUTE_LENGTH: Readonly<Record<number, number>> = {
  0x145: 725, 0x146: 765, 0x149: 200, 0x14a: 210,
};

/**
 * `g_class28_fixed_poses` -- `0x0055DD18`, `{f32 x, y, z; i32 rx, ry, rz}`
 * at a stride of `0x18`, indexed by `obj+0x11C`, and read only in
 * `g_app_state` 10. Carried as the words the image holds: rows 0 and 1 are
 * `op_st1` 72's and 73's first keys, and rows 2 and 3 are whatever the next
 * table holds (`L6`) -- no shipped spawn indexes them, and a transcription
 * that "corrected" them would be a claim about data the engine never reads.
 */
export const CLASS28_FIXED_POSE_WORDS: ReadonlyArray<readonly number[]> = [
  [0xc47f67be, 0xc100972b, 0xc3f8c1de, 0x00000000, 0x00001ca6, 0x00000000],
  [0xc47f7937, 0x3f9740f6, 0xc3e61c67, 0xfffff5d1, 0x00008000, 0xffffc000],
  [0x3fe66666, 0x43960000, 0x09a2098e, 0x09ca09b6, 0x09f209de, 0x1e010902],
  [0x00003216, 0x048c0441, 0x052204d7, 0x0000056d, 0x048c056d, 0x056d0522],
];

/** `MOV dword ptr [ESI + 0x13f0], 0x33` at `0x0043265E` -- the draw slot. */
export const PATH_PROP_DRAW_SLOT = 0x33;

/** `CMP dword ptr [0x009a2d78], 0x2f` at `0x00432767` -- the launch camera. */
export const PATH_PROP_LAUNCH_CAM_PATH = 0x2f;

/** `CMP dword ptr [0x009c8e98], 0xa` at `0x00432672` -- the fixed-pose screen. */
const APP_STATE_FIXED_POSE = 10;

/** `CMP dword ptr [0x009a2d78], 0x8` at `0x00432810` -- its kill camera. */
const FIXED_POSE_KILL_CAM_PATH = 8;

/** A class-0x28 actor, narrowed. */
export type PathRidingPropActor = Extract<Actor,
  { cls: SpawnClass.PathRidingProp }>;

/** The four words of one row, as the `f32` and `i32` the engine loads. */
const _word = new DataView(new ArrayBuffer(4));
function f32OfWord(w: number): number {
  _word.setUint32(0, w >>> 0, true);
  return _word.getFloat32(0, true);
}
function i32OfWord(w: number): number {
  return w | 0;
}

/**
 * `CamEvalObjectPath6` (`FUN_004042D0`) onto `obj+0x40..0x48` and
 * `obj+0x64..0x6C` -- the six stores both of the handler's evaluations end
 * with (`0x0043273F`..`0x0043275D`, `0x004327E1`..`0x004327FF`). A host
 * with no `op_` paths is a valid host; the object then keeps the pose it has,
 * which is what a missing path should look like.
 */
function PathRidingPropPose(obj: PathRidingPropActor, host: GameHost,
                            slot: number, frame: number): void {
  const p = host.objectPath?.(slot, frame);
  if (!p) return;
  obj.pos.x = p.x;
  obj.pos.y = p.y;
  obj.pos.z = p.z;
  obj.pitch = p.pitch ?? obj.pitch;
  obj.yaw = p.yaw ?? obj.yaw;
  obj.roll = p.roll ?? obj.roll;
}

/**
 * `ActorKill` (`FUN_004A7040`) as this class takes it: `JMP`/`CALL` straight
 * to the unlink, with no `ActorDespawn` in front -- so no hit slot is given
 * back, and the class never claimed one.
 *
 * `[port-only]` as a *name*: the engine's routine operates on the pool's
 * current object and longjmps. This is the class-shaped wrapper, the same
 * shape and reason as `ActorKillPlacer` in `class41/index.ts`.
 */
function PathRidingPropKill(obj: PathRidingPropActor): void {
  obj.despawned = true;
  obj.visible = false;
}

/**
 * `PathRidingPropFixedPoseUpdate` -- `FUN_00432810`. The handler the first
 * frame installs in `g_app_state` 10:
 *
 * ```
 * 00432810  CMP  dword ptr [0x009a2d78], 0x8     ; g_active_cam_path
 * 00432817  JNZ  0x00432827
 * 00432819  MOV  EAX, [0x009a6110]               ; g_cam_path_frame
 * 0043281E  TEST EAX, EAX
 * 00432820  JL   0x00432827
 * 00432822  JMP  0x004a7040                      ; ActorKill
 * 00432827  ... CALL PathRidingPropDraw
 * ```
 *
 * The draw is `render/`'s.
 */
export function PathRidingPropFixedPoseUpdate(obj: PathRidingPropActor): void {
  if (G.g_active_cam_path === FIXED_POSE_KILL_CAM_PATH
      && G.g_cam_path_frame >= 0) {
    PathRidingPropKill(obj);
  }
}

/**
 * `PathRidingPropUpdate` -- `FUN_00432610`. Class 0x28's handler, one frame.
 *
 * ```
 * switch (obj+0x1312) {
 * case 0:  obj+0x13F0 = 0x33;  obj+0x1320 = 0;
 *          if (g_app_state == 10) { pose = g_class28_fixed_poses[obj+0x11C];
 *                                   obj[0] = FixedPoseUpdate; FixedPoseUpdate(obj);
 *                                   return; }
 *          pose = CamEvalObjectPath6(route.slot, (float)route.freeze);
 *          obj+0x1312++;                                      // and on into 1
 * case 1:  if (g_active_cam_path == 0x2F && route.freeze <= g_cam_path_frame)
 *              { obj+0x1312++;  obj+0x1320 = 1; }
 *          break;
 * case 2:  if (g_cam_path_length[route.slot] <= g_cam_path_frame)
 *              { ActorKill(); }                               // does not return
 *          break;
 * }
 * if (obj+0x1320) pose = CamEvalObjectPath6(route.slot, (float)g_cam_path_frame);
 * PathRidingPropDraw(obj);
 * ```
 *
 * `[proved]` from the listing, `0x00432610`..`0x0043280F`. Three things in it
 * are the fix to the report, and each is a line:
 *
 * * **the seat is evaluated once**, at the table's frame and not at the
 *   camera's, so until the throw the object stands on the path's first key;
 * * **the launch is gated on camera path `0x2F`**, the boss block's -- no
 *   other camera move can start it;
 * * **the kill has no camera test**, and it is the only way out: once the
 *   frame counter reaches the path's length the object is gone, so no later
 *   camera move can play the throw again.
 *
 * The launch compare is `FILD g_cam_path_frame; FILD freeze; FCOMPP; TEST AH,
 * 0x41; JZ` at `0x00432777`..`0x00432794` -- taken when the freeze frame is
 * below or equal to the camera's, i.e. `freeze <= g_cam_path_frame`.
 *
 * `obj+0x11C` indexes both tables with no bound (`MOVSX` and a scale), as the
 * engine does; the six shipped spawns carry 0 and 1.
 */
export function PathRidingPropUpdate(obj: PathRidingPropActor,
                                     f: ClassFrame): void {
  const t: PathRidingPropTail = obj.pathProp;
  const [slot, freeze] = CLASS28_ROUTES[obj.hp];

  if (obj.sub === 0) {
    t.drawSlot = PATH_PROP_DRAW_SLOT;
    t.launched = 0;
    if (G.g_app_state === APP_STATE_FIXED_POSE) {
      const w = CLASS28_FIXED_POSE_WORDS[obj.hp];
      obj.pos.x = f32OfWord(w[0]);
      obj.pos.y = f32OfWord(w[1]);
      obj.pos.z = f32OfWord(w[2]);
      obj.pitch = i32OfWord(w[3]);
      obj.yaw = i32OfWord(w[4]);
      obj.roll = i32OfWord(w[5]);
      // `MOV dword ptr [ESI], 0x432810` at `0x004326F8`, then the call.
      t.fixedPose = true;
      PathRidingPropFixedPoseUpdate(obj);
      return;
    }
    // `FILD` of the freeze frame at `0x00432725` -- a whole frame, as a float.
    PathRidingPropPose(obj, f.host, slot, freeze);
    obj.sub += 1;
  }

  if (obj.sub === 1) {
    if (G.g_active_cam_path === PATH_PROP_LAUNCH_CAM_PATH
        && freeze <= G.g_cam_path_frame) {
      obj.sub += 1;
      t.launched = 1;
    }
  } else if (obj.sub === 2) {
    if (CLASS28_ROUTE_LENGTH[slot] <= G.g_cam_path_frame) {
      PathRidingPropKill(obj);
      return;
    }
  }

  if (t.launched) PathRidingPropPose(obj, f.host, slot, G.g_cam_path_frame);
  // `PathRidingPropDraw` (`0x00432840`) is `render/rigs.ts`': the body under
  // `T . Rz . Ry . Rx` of the pose above, and the two sprites while
  // `obj+0x1320` is still 0.
}

function PathRidingPropUpdateDispatch(obj: Actor, f: ClassFrame): void {
  if (obj.cls !== SpawnClass.PathRidingProp) return;
  // `[port-only]` The engine calls whatever `obj+0x00` holds; a snapshot
  // cannot hold a function, so the tail holds which of the two it is.
  if (obj.pathProp.fixedPose) PathRidingPropFixedPoseUpdate(obj);
  else PathRidingPropUpdate(obj, f);
}

function PathRidingPropDebug(obj: Actor): ActorDebug {
  if (obj.cls !== SpawnClass.PathRidingProp) return { summary: "not 0x28" };
  const t = obj.pathProp;
  const route = CLASS28_ROUTES[obj.hp];
  const where = `(${obj.pos.x.toFixed(1)}, ${obj.pos.y.toFixed(1)},`
    + ` ${obj.pos.z.toFixed(1)})`;
  return {
    summary: `route 0x${(route?.[0] ?? 0).toString(16)} · `
      + (t.fixedPose ? "fixed pose"
        : t.launched ? "thrown" : `held for cp 0x2f frame ${route?.[1]}`),
    detail: [`at ${where} · sub ${obj.sub}`],
    hot: t.launched === 1,
  };
}

export const PathRidingPropHandler: ClassHandler = {
  // Nothing at spawn: `EvtOpSpawnPlaced09` (`FUN_004088A0`) allocates the
  // object with the handler and calls no `Init`. The handler's own first
  // frame is where the object is seated.
  init: () => {},
  update: PathRidingPropUpdateDispatch,
  // No hit points and no damage: `obj+0x11C` is the route.
  ownsShotResult: true,
  debug: PathRidingPropDebug,
};

registerClass(SpawnClass.PathRidingProp, PathRidingPropHandler);
