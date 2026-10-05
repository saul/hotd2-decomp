/**
 * Class 0x2B -- **a scripted light**: one entry of `g_entity_lights` held for
 * a stretch of a scene and given back on a cue.
 *
 * ```
 * DynamicLightInit (FUN_00438060), g_class_handler_pairs' class-0x2B entry
 *   switch ((s16)obj+0x11C) {              // desc+0x22, a selector (L3)
 *   case 0: FUN_004380B0(obj); obj+0x00 = FUN_004380B0; break;
 *   case 1: FUN_00438230(obj); obj+0x00 = FUN_00438230; break;
 *   case 2: FUN_004383C0(obj); obj+0x00 = FUN_004383C0; break;
 *   }                                      // anything else: runs again next frame
 * ```
 *
 * Each routine claims an entry with `EntityLightAcquireSlot` on its first
 * call (`obj+0x1312` 0 -> 1), rewrites the whole light every frame while
 * `g_scene_lighting` is 1 and only switches it off otherwise, and on its own
 * stop condition switches it off, releases it (both only for an entry from 3
 * up, which is every entry the acquire can hand out) and `ActorKill`s itself.
 * No draw, no shot, no counter: the light is the object. Three spawns, one
 * per selector, each placed with no position because each routine carries its
 * own:
 *
 * | selector | where | the light | stops on |
 * |---|---|---|---|
 * | 0 | stage 2 evt 27716, blocks 11 step 7 and 12 step 0 | point at (-896.8, 4.1, -1071.4), diffuse (0.2, 0.6, 8.0), range 100, a flickering quadratic term | `g_script_flags[225]` (block 12 step 1) |
 * | 1 | stage 4 evt 25684, block 10 step 3 | spot at (-125, -25, -670) straight down, diffuse 10, cone pi/8 | camera path 0xAF from frame 0x6E, or 0xB2 from 0x82 |
 * | 2 | stage 5 evt 3900, block 0 step 1 | spot at (762.2, 2616, -9778.5), diffuse 4, cone pi/16 | camera path 0xCC |
 *
 * Every spawn follows an evt `0x14` that raises `g_scene_lighting` in the same
 * step. The entries reach the screen as the class-0x41 lamp's does:
 * `SceneLightArrayUpdate` submits every enabled entry and `render/gunlights.ts`
 * draws them.
 */
import type { Rng } from "../../core/rng";
import { EntityLightAcquireSlot, EntityLightReleaseSlot } from "../class41/type48";
import { RenderLightType } from "../entity_light";
import { G } from "../globals";
import {
  MatIdentity, MatrixLoadIdentity, MatrixRotateX, MatrixRotateY,
  MatrixRotateZ, MatrixTransformPoint,
} from "../matrix";
import {
  registerClass, type ActorDebug, type ClassFrame, type ClassHandler,
} from "../registry";
import { SpawnClass } from "../spawn_class";
import type { Actor } from "../actor";
import {
  DynamicLightRoutine, DynamicLightSelector, type DynamicLightTail,
} from "./state";

type DynamicLightActor = Extract<Actor, { cls: SpawnClass.DynamicLight }>;

/** `CMP AL, 3; JL` -- the release arms give back only an entry from 3 up. */
const FIRST_CLAIMABLE_ENTRY = 3;
/** `g_scene_lighting == 1` -- `CMP ECX, 1`, an equality, in all three. */
const SCENE_LIGHTING_ON = 1;

// -- selector 0's literals, all `MOV dword` immediates (L73 does not apply:
// they are in the instruction, not behind a pointer) -------------------------

/** `0xC4603333`, `0x40833333`, `0xC485ECCD` at `+0x34..+0x3C`. */
const FLICKER_POS: readonly [number, number, number] =
  [Math.fround(-896.8), Math.fround(4.1), Math.fround(-1071.4)];
/** `0x3E4CCCCD`, `0x3F19999A`, `0x41000000` at `+0x04..+0x0C`. */
const FLICKER_DIFFUSE: readonly [number, number, number] =
  [Math.fround(0.2), Math.fround(0.6), 8];
/** `0x3DCCCCCD` at `+0x54`. */
const FLICKER_ATT0 = Math.fround(0.1);
/** `0x42C80000` at `+0x4C`. */
const FLICKER_RANGE = 100;
/** `FMUL float ptr [0x0055E1C4]` -- `1e-4`, the step `obj+0x1320` scales. */
const FLICKER_ATT2_UNIT = Math.fround(1e-4);
/** `rand() & 0x80000007` with the sign fix-up -- `rand() % 8`. */
const FLICKER_ATT2_STEPS = 8;
/** `rand() & 0x8000000F` ... `ADD EAX, 3` -- `rand() % 16 + 3` frames. */
const FLICKER_HOLD_SPREAD = 16;
const FLICKER_HOLD_MIN = 3;
/** `MOV AL, [0x009C72E1]; CMP AL, 1` -- `g_script_flags[0xE1]` (L102). */
const FLICKER_STOP_FLAG = 0xe1;

// -- selectors 1 and 2 --------------------------------------------------------

/** `0x47800000` at `+0x4C` in both: 65536. */
const SPOT_RANGE = 65536;

/** Selector 1: `0xC2FA0000`, `0xC1C80000`, `0xC4278000`. */
const SPOT_DOWN_POS: readonly [number, number, number] = [-125, -25, -670];
/** `PUSH 0`, `PUSH 0`, `PUSH 0x4000` into `RotZ`, `RotY`, `RotX`. */
const SPOT_DOWN_TURN: readonly [number, number, number] = [0, 0, 0x4000];
/** `MOV EAX, 0x41200000` into `+0x04`, `+0x08`, `+0x0C`. */
const SPOT_DOWN_DIFFUSE = 10;
/** `0x3DCCCCCD` at `+0x54`. */
const SPOT_DOWN_ATT0 = Math.fround(0.1);
/** `0x3EC90FDB` at `+0x60` -- pi/8. */
const SPOT_DOWN_THETA = Math.fround(Math.PI / 8);
/** `CMP EAX, 0xAF` / `CMP [0x009A6110], 0x6E`; `0xB2` / `0x82`. */
const SPOT_DOWN_STOP_PATH_A = 0xaf;
const SPOT_DOWN_STOP_FRAME_A = 0x6e;
const SPOT_DOWN_STOP_PATH_B = 0xb2;
const SPOT_DOWN_STOP_FRAME_B = 0x82;

/** Selector 2: `0x443E8CCD`, `0x45238000`, `0xC618CA00`. */
const SPOT_TILTED_POS: readonly [number, number, number] =
  [Math.fround(762.2), 2616, -9778.5];
/** `PUSH EBX` (0), `PUSH 0x400`, `PUSH 0x6F00` into `RotZ`, `RotY`, `RotX`. */
const SPOT_TILTED_TURN: readonly [number, number, number] = [0, 0x400, 0x6f00];
/** `MOV EAX, 0x40800000` into `+0x04`, `+0x08`, `+0x0C`. */
const SPOT_TILTED_DIFFUSE = 4;
/** `0x3F000000` at `+0x54`. */
const SPOT_TILTED_ATT0 = 0.5;
/** `0x3E490FDB` at `+0x60` -- pi/16. */
const SPOT_TILTED_THETA = Math.fround(Math.PI / 16);
/** `CMP EAX, 0xCC` / `CMP [0x009A6110], EBX; JL` -- any frame from 0. */
const SPOT_TILTED_STOP_PATH = 0xcc;

/**
 * `ActorKill` (`FUN_004A7040`) as this class takes it: a `CALL` straight to
 * the unlink, no `ActorDespawn` in front and no hit slot, which the class
 * never claims. `[port-only]` as a name, as `PathRidingPropKill` in
 * `class28/index.ts` is.
 */
function DynamicLightKill(obj: Actor): void {
  obj.despawned = true;
  obj.visible = false;
}

/**
 * The stop arm all three share, written out in each (`0x004380BA`,
 * `0x00438274`, `0x004383DB`): the entry off and given back when it is one
 * the acquire could have handed out, then the kill. `[port-only]` as a
 * function -- the engine has three copies, and they are instruction for
 * instruction the same.
 */
function DynamicLightStop(obj: DynamicLightActor): void {
  const t = obj.light2b;
  if (t.slot >= FIRST_CLAIMABLE_ENTRY) {
    G.g_entity_lights[t.slot].enabled = false;
    EntityLightReleaseSlot(t.slot);
  }
  DynamicLightKill(obj);
}

/**
 * `MatrixStackPush(0); MatrixLoadIdentity(); MatrixRotateZ(z);
 * MatrixRotateY(y); MatrixRotateX(x); MatrixTransformPoint((0, 0, 1));
 * MatrixStackPop(1)` -- selectors 1 and 2 aim their spot this way, into
 * `+0x40..+0x48`. `[port-only]` as a function, for the same reason.
 */
function DynamicLightAim(turn: readonly [number, number, number],
                         out: { x: number; y: number; z: number }): void {
  const m = MatIdentity();
  MatrixLoadIdentity(m);
  MatrixRotateZ(m, turn[0]);
  MatrixRotateY(m, turn[1]);
  MatrixRotateX(m, turn[2]);
  MatrixTransformPoint(m, { x: 0, y: 0, z: 1 }, out);
  out.x = Math.fround(out.x);
  out.y = Math.fround(out.y);
  out.z = Math.fround(out.z);
}

/**
 * `DynamicLightFlickerPoint` — `FUN_004380B0`. Selector 0: stage 2's
 * flickering blue point light, blocks 11 and 12.
 *
 * ```
 * 004380B0  MOV AL, [0x009C72E1]; CMP AL, 1; JNZ live    ; flag 225
 * 004380C4  CMP AL, 3; JL kill; entry.enabled = 0; EntityLightReleaseSlot
 * 004380F2  kill: CALL ActorKill
 * 004380FD  switch ((s16)obj+0x1312) { 0: claim; 1: light; default: RET }
 * 0043810E  claim: obj+0x131B = EntityLightAcquireSlot()
 *           obj+0x1320 = rand() % 8; obj+0x1312++; obj+0x1324 = rand() % 16 + 3
 * 00438151  light: e = &g_entity_lights[(s8)obj+0x131B]
 * 00438167  if (g_scene_lighting != 1) { e.enabled = 0; RET }
 * 0043817A  e.enabled = 1; type 1; pos; diffuse; att0 0.1; att1 0
 *           range 100; att2 = obj+0x1320 * 1e-4
 * 004381D5  if (--obj+0x1324 <= 0) { obj+0x1320 = rand() % 8;
 *                                     obj+0x1324 = rand() % 16 + 3 }
 * ```
 *
 * `[proved]`. The claim falls into the light in the same call. Falloff,
 * `theta` and `phi` are not written; nor is the diffuse's alpha, which the
 * port's entry does not keep. With lighting off the countdown holds: it is
 * stepped only inside the lit arm.
 */
export function DynamicLightFlickerPoint(obj: DynamicLightActor, rng?: Rng):
    void {
  const t = obj.light2b;
  if (G.g_script_flags[FLICKER_STOP_FLAG] === 1) {
    DynamicLightStop(obj);
    return;
  }
  if (obj.sub === 0) {
    t.slot = EntityLightAcquireSlot();
    t.att2Step = rng?.int(FLICKER_ATT2_STEPS) ?? 0;
    obj.sub += 1;
    t.countdown = (rng?.int(FLICKER_HOLD_SPREAD) ?? 0) + FLICKER_HOLD_MIN;
  } else if (obj.sub !== 1) {
    return;
  }
  const e = G.g_entity_lights[t.slot];
  if (G.g_scene_lighting !== SCENE_LIGHTING_ON) {
    e.enabled = false;
    return;
  }
  e.enabled = true;
  e.type = RenderLightType.Point;
  e.pos.x = FLICKER_POS[0];
  e.pos.y = FLICKER_POS[1];
  e.pos.z = FLICKER_POS[2];
  e.diffuse = [FLICKER_DIFFUSE[0], FLICKER_DIFFUSE[1], FLICKER_DIFFUSE[2]];
  e.att0 = FLICKER_ATT0;
  e.att1 = 0;
  e.range = FLICKER_RANGE;
  e.att2 = Math.fround(t.att2Step * FLICKER_ATT2_UNIT);
  t.countdown -= 1;
  if (t.countdown < 1) {
    t.att2Step = rng?.int(FLICKER_ATT2_STEPS) ?? 0;
    t.countdown = (rng?.int(FLICKER_HOLD_SPREAD) ?? 0) + FLICKER_HOLD_MIN;
  }
}

/**
 * The lit arm selectors 1 and 2 share the shape of (`0x004382F0`,
 * `0x0043846C`): a spot, its position and aim, a grey diffuse, `att0`, no
 * `att1`/`att2`, range 65536 and `theta`. `[port-only]` as a function; the
 * engine has two copies with different immediates, which are its arguments.
 */
function DynamicLightWriteSpot(e: typeof G.g_entity_lights[number],
                               pos: readonly [number, number, number],
                               turn: readonly [number, number, number],
                               diffuse: number, att0: number,
                               theta: number): void {
  e.enabled = true;
  e.type = RenderLightType.Spot;
  e.pos.x = pos[0];
  e.pos.y = pos[1];
  e.pos.z = pos[2];
  DynamicLightAim(turn, e.dir);
  e.diffuse = [diffuse, diffuse, diffuse];
  e.att0 = att0;
  e.att1 = 0;
  e.att2 = 0;
  e.range = SPOT_RANGE;
  e.theta = theta;
}

/**
 * The claim both spot selectors open with (`0x004382B6`, `0x00438432`):
 * on `obj+0x1312 == 0` take an entry and step the word -- the `INC` comes
 * before the store here, the other way round from selector 0 -- and fall into
 * the light; on anything but 1, return. False for the return.
 * `[port-only]` as a function.
 */
function DynamicLightClaimOnce(obj: DynamicLightActor): boolean {
  if (obj.sub === 0) {
    const slot = EntityLightAcquireSlot();
    obj.sub += 1;
    obj.light2b.slot = slot;
    return true;
  }
  return obj.sub === 1;
}

/**
 * `DynamicLightSpotDown` — `FUN_00438230`. Selector 1: stage 4 block 10's
 * spot, straight down at `(-125, -25, -670)`.
 *
 * ```
 * 00438230  if (g_active_cam_path == 0xAF) { if (g_cam_path_frame >= 0x6E) stop }
 *           else if (g_active_cam_path == 0xB2 && g_cam_path_frame >= 0x82) stop
 * 0043824D  switch ((s16)obj+0x1312) { 0: claim; 1: light; default: RET }
 * 004382E7  if (g_scene_lighting != 1) { e.enabled = 0; RET }
 * 004382F0  e.enabled = 1; type 2; pos; dir = RotZ(0) RotY(0) RotX(0x4000) (0,0,1)
 *           diffuse 10; att0 0.1; att1 = att2 = 0; range 65536; theta pi/8
 * ```
 *
 * `[proved]`. `phi` and the falloff are not written.
 */
export function DynamicLightSpotDown(obj: DynamicLightActor): void {
  if (G.g_active_cam_path === SPOT_DOWN_STOP_PATH_A) {
    if (G.g_cam_path_frame >= SPOT_DOWN_STOP_FRAME_A) {
      DynamicLightStop(obj);
      return;
    }
  } else if (G.g_active_cam_path === SPOT_DOWN_STOP_PATH_B
             && G.g_cam_path_frame >= SPOT_DOWN_STOP_FRAME_B) {
    DynamicLightStop(obj);
    return;
  }
  if (!DynamicLightClaimOnce(obj)) return;
  const e = G.g_entity_lights[obj.light2b.slot];
  if (G.g_scene_lighting !== SCENE_LIGHTING_ON) {
    e.enabled = false;
    return;
  }
  DynamicLightWriteSpot(e, SPOT_DOWN_POS, SPOT_DOWN_TURN, SPOT_DOWN_DIFFUSE,
                        SPOT_DOWN_ATT0, SPOT_DOWN_THETA);
}

/**
 * `DynamicLightSpotTilted` — `FUN_004383C0`. Selector 2: stage 5's opening
 * spot at `(762.2, 2616, -9778.5)`, turned `RotY(0x400) RotX(0x6F00)`.
 *
 * ```
 * 004383C0  if (g_active_cam_path == 0xCC && g_cam_path_frame >= 0) stop
 * 0043841E  switch ((s16)obj+0x1312) { 0: claim; 1: light; default: RET }
 * 00438463  if (g_scene_lighting != 1) { e.enabled = 0; RET }
 * 0043846C  e.enabled = 1; type 2; pos; dir = RotZ(0) RotY(0x400) RotX(0x6F00) (0,0,1)
 *           diffuse 4; att0 0.5; att1 = att2 = 0; range 65536; theta pi/16
 * ```
 *
 * `[proved]`. `phi` and the falloff are not written.
 */
export function DynamicLightSpotTilted(obj: DynamicLightActor): void {
  if (G.g_active_cam_path === SPOT_TILTED_STOP_PATH
      && G.g_cam_path_frame >= 0) {
    DynamicLightStop(obj);
    return;
  }
  if (!DynamicLightClaimOnce(obj)) return;
  const e = G.g_entity_lights[obj.light2b.slot];
  if (G.g_scene_lighting !== SCENE_LIGHTING_ON) {
    e.enabled = false;
    return;
  }
  DynamicLightWriteSpot(e, SPOT_TILTED_POS, SPOT_TILTED_TURN,
                        SPOT_TILTED_DIFFUSE, SPOT_TILTED_ATT0,
                        SPOT_TILTED_THETA);
}

/**
 * `DynamicLightInit` — `FUN_00438060`. Class 0x2B's handler.
 *
 * ```
 * 00438065  MOVSX EAX, word ptr [ESI + 0x11C]
 * 0043806C  SUB EAX, 0; JZ sel0;  DEC EAX; JZ sel1;  DEC EAX; JNZ out
 * 00438077  CALL 0x004383C0; MOV [ESI], 0x4383C0; RET
 * 00438088  CALL 0x00438230; MOV [ESI], 0x438230; RET
 * 00438099  CALL 0x004380B0; MOV [ESI], 0x4380B0
 * 004380A8  out: RET
 * ```
 *
 * `[proved]`. Each routine runs once here, which is its claim, and is then
 * what the walk calls every frame. A selector past 2 leaves the Init
 * installed and it runs again each frame, doing nothing; none ships.
 */
export function DynamicLightInit(obj: Actor, rng?: Rng): void {
  if (obj.cls !== SpawnClass.DynamicLight) return;
  switch (obj.hp << 16 >> 16) {
    case DynamicLightSelector.FlickerPoint:
      DynamicLightFlickerPoint(obj, rng);
      obj.light2b.routine = DynamicLightRoutine.FlickerPoint;
      break;
    case DynamicLightSelector.SpotDown:
      DynamicLightSpotDown(obj);
      obj.light2b.routine = DynamicLightRoutine.SpotDown;
      break;
    case DynamicLightSelector.SpotTilted:
      DynamicLightSpotTilted(obj);
      obj.light2b.routine = DynamicLightRoutine.SpotTilted;
      break;
  }
}

/**
 * `CALL dword ptr [obj+0x00]` for this class: whichever routine the Init
 * installed, or the Init again. `[port-only]` as a function -- the walk
 * makes the call in the engine.
 */
function DynamicLightRun(obj: Actor, f: ClassFrame): void {
  if (obj.cls !== SpawnClass.DynamicLight) return;
  switch (obj.light2b.routine) {
    case DynamicLightRoutine.Init: DynamicLightInit(obj, f.rng); break;
    case DynamicLightRoutine.FlickerPoint:
      DynamicLightFlickerPoint(obj, f.rng);
      break;
    case DynamicLightRoutine.SpotDown: DynamicLightSpotDown(obj); break;
    case DynamicLightRoutine.SpotTilted: DynamicLightSpotTilted(obj); break;
  }
}

function DynamicLightDebug(obj: Actor): ActorDebug {
  if (obj.cls !== SpawnClass.DynamicLight) return { summary: "light" };
  const t: DynamicLightTail = obj.light2b;
  const e = G.g_entity_lights[t.slot];
  return {
    summary: `light ${DynamicLightSelector[obj.hp] ?? obj.hp} · entry ${t.slot}`
      + ` ${e?.enabled ? "on" : "off"}`,
    detail: obj.hp === DynamicLightSelector.FlickerPoint
      ? [`att2 step ${t.att2Step} for ${t.countdown} more`] : undefined,
  };
}

const handler: ClassHandler = {
  // Nothing here: the walk's first call of `obj+0x00` is `DynamicLightInit`,
  // and `update` makes it -- the port's walk runs `init` and then `update` on
  // an object's first frame, and the engine calls the handler once.
  init: () => {},
  update: DynamicLightRun,
  debug: DynamicLightDebug,
};

registerClass(SpawnClass.DynamicLight, handler);
