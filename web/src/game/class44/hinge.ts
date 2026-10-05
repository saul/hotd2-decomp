/**
 * Class 0x44 selectors 1, 2 and 4 — the hinges: the doors, shutters and van
 * doors the script swings open — and `HingeUpdate`, the one routine all three
 * builders hand `ActorAlloc`.
 *
 * Fifty-three spawns over stages 1, 2, 4, 5 and 6. Each builder reads the
 * spawn's position and yaw and its parameter tail into a 0x378-byte object;
 * `HingeUpdate` swings it through a baked curve once its script flag is up,
 * wobbles it when it is shot, and draws its one model. Until this file the
 * hinges were posed by the renderer from a copy of the curve (`L16`); the
 * routine is here now and `render/` draws what it recorded.
 *
 * ## The three builders `[proved]`
 *
 * ```c
 * PropBuildHinge (0x00472BD0), selector 1:          tail = desc->+0x1390
 *   obj = ActorAlloc(HingeUpdate, 0x378); ActorClearGameFields(obj);
 *   obj->+0x19C..0x1A4 = desc->+0x40..0x48;  obj->+0x1D0 = desc->+0x68;  obj->+0x68 = 0;
 *   obj->+0x34 |= 0x51;
 *   obj->+0x28C = (u16)tail->+0x04;  obj->+0x14C = tail->+0x08;
 *   obj->+0x1DC = tail->+0x10;       obj->+0x1E8 = tail->+0x14;
 *   obj->+0x290 = (u16)tail->+0x00;
 *   obj->+0x2A0 = (s8)tail->+0x20;   obj->+0x2A4 = (s8)tail->+0x21;
 *   obj->+0x2A8 = 0;  obj->+0x2C0 = 1.0f;  obj->+0x1A8 = obj->+0x1AC = obj->+0x1B0 = 1.0f;
 *
 * PropBuildHingeScaled (0x00472EB0), selector 4: the same, except
 *   obj->+0x1DC = tail->+0x0C;  no +0x1E8;
 *   obj->+0x2A0 = (s8)tail->+0x10;  obj->+0x2A4 = (s8)tail->+0x11;  obj->+0x2AC = 0;
 *   obj->+0x1A8..0x1B0 = tail->+0x14..0x1C   (f32, the scale)
 *
 * PropBuildVanDoors (0x00472C90), selector 2: two objects,
 *   Push(0); LoadIdentity; Translate(desc pos); RotY(desc->+0x68);
 *   for (i = 0, side = -1; side < 3; i++, side += 2):
 *     local = ((float)side * 9.29f, 11.5, 22.68);  MatrixTransformPoint(local) -> +0x19C..
 *     obj->+0x68 = 0;  obj->+0x1D0 = i * 0x8000 + desc->+0x68;  obj->+0x34 |= 0x51;
 *     obj->+0x28C = 0x1794 + i;  obj->+0x14C = tail->+0x08;  obj->+0x1DC = side;
 *     obj->+0x290 = 2;  obj->+0x1E8 = tail->+0x14;
 *     obj->+0x2A0 = (s8)tail->+0x20;  obj->+0x2A4 = (s8)tail->+0x21;
 *     obj->+0x2A8 = 0;  obj->+0x2C0 = 1.0f;  obj->+0x1A8..0x1B0 = 1.0f;
 *   Pop;
 * ```
 *
 * `obj+0x1CC` and `obj+0x1D4`, the swing's X and Z bases, are written by none
 * of the three and so stay `ActorClearGameFields`' zero. `obj+0x1E8` is the
 * wobble's phase and the wobble zeroes it before its first read, so the value
 * a builder gives it is never seen.
 *
 * ## `obj+0x1DC` is a sign to the swing and a magnitude to the wobble
 *
 * `TEST EAX,EAX; JLE` at `0x00473EE6` reads it for its sign only -- `ADD` or
 * `SUB` on the X angle and a `NEG` on the yaw -- and `IMUL EAX,[ESI+0x1DC]` at
 * `0x00473FB5` multiplies the shot wobble by it. Stage 1 carries ±512 and
 * ±416; the van's two doors carry the literal ±1.
 *
 * ## What the port does not carry
 *
 * * **The mesh shot test.** Every builder sets `obj+0x34 |= 0x51`, so a hinge
 *   with a collision blob (`obj+0x14C != -1`) is filed for the shot test with
 *   bit 4 up and goes to `ShotTestMesh` (`FUN_00404A00`) -- the volume test on
 *   `obj+0x14C` and the matrix `MatrixStore` leaves at `obj+0x150`. The prop
 *   pool has no mesh shot test (`class41/shot_test.ts`; the story-mode switch
 *   and selectors 12 and 13 wait on the same one), so the registration is
 *   transcribed and files a sphere of radius 0, which nothing hits, and the
 *   wobble a shot starts is transcribed and never started.
 * * **The draw's lighting.** `SubmitSlotWithSceneLightArray` or
 *   `AssetDrawSlot`, on `g_GameMode`, `g_scene_lighting` and camera path 0x46;
 *   both are the one recorded draw (`class41/prop_draw.ts`).
 * * **`PoseHookNone`** (`FUN_00420810`), called with `(3, 0x14)` and
 *   `(4, 0x14)`: a bare `RET`, so the calls do nothing.
 */
import type { Events } from "../../core/events";
import type { BreakablePlacement } from "../../bundle";
import { G } from "../globals";
import {
  MatIdentity, MatrixRotateX, MatrixRotateY, MatrixRotateZ, MatrixScale,
  MatrixTransformPoint, MatrixTranslate,
} from "../matrix";
import { T } from "../tables";
import { ActorDespawnProp, ActorKillProp } from "../class41/prop";
import { PropDrawBegin, PropDrawSlot, PropMatrixPush }
  from "../class41/prop_draw";
import {
  BreakableState, makeBreakableProp, PropFamily, type BreakableProp,
} from "../class41/prop_state";
import { PropRegisterForShotTest } from "../class41/shot_test";
import { PropWords } from "../class41/words";

/**
 * The words of the 0x378-byte object `HingeUpdate` keeps that no shared
 * {@link BreakableProp} field names (`L3`). `x`/`y`/`z` are `+0x19C..`,
 * `yaw`/`pitch`/`roll` the base angles `+0x1D0`/`+0x1CC`/`+0x1D4`,
 * `restX..restZ` the scale `+0x1A8..`, `storyItem` and `removeFlag` the two
 * script flags `+0x2A0`/`+0x2A4`.
 */
export interface HingeWords {
  /** `obj+0x64` -- the swing's X angle, `+0x1CC` plus or minus the curve's. */
  o64: number;
  /** `obj+0x68` -- the swing's yaw, the curve's times `+0x2C0`. */
  o68: number;
  /** `obj+0x6C` -- the swing's Z angle, `+0x1D4` plus the curve's. */
  o6c: number;
  /** `obj+0x14C` -- the collision blob, or -1. */
  o14c: number;
  /** `obj+0x1DC` -- see the file comment. */
  o1dc: number;
  /** `obj+0x1E8` -- the wobble's phase, BAMS, `0x1000` a frame. */
  o1e8: number;
  /** `obj+0x1F4` -- the yaw the wobble swings about. */
  o1f4: number;
  /** `obj+0x290` -- which curve (s16): 0, 2, 3 the XYZ table, else yaw-only. */
  o290: number;
  /** `obj+0x2A8` -- the curve frame. */
  o2a8: number;
  /** `obj+0x2AC` -- the one-shot latch on the stage-4 sound. */
  o2ac: number;
  /** `obj+0x2C0` -- the `FMUL` on the curve's yaw, 1.0f from every builder. */
  o2c0: number;
}

export const HINGE_WORDS: HingeWords = {
  o64: 0, o68: 0, o6c: 0, o14c: 0, o1dc: 0, o1e8: 0, o1f4: 0, o290: 0,
  o2a8: 0, o2ac: 0, o2c0: 0,
};

/** `obj+0x34 \|= 0x51`, every builder's. */
export const HINGE_FLAGS = 0x51;
/** `obj+0x34` bit 30 -- the shot wobble is running. */
export const HINGE_WOBBLE = 0x40000000;
/** `obj+0x34` bit 3 -- a shot landed; `AND AL,0xF1` clears it with 1 and 2. */
const HINGE_HIT = 0x8;
const HINGE_HIT_CLEARS = 0xe;

/**
 * `PUSH 0x3F866666` -- the X scale these two slots are drawn at, in place of
 * the object's own.
 */
const HINGE_WIDE_SCALE_X = Math.fround(1.05);
const HINGE_WIDE_SLOTS = [0x1817, 0x1816];

/** `CMP EDI,0x3C; JL` -- a curve's frames; `CMP EDI,0x82; JGE` on curve 4. */
export const HINGE_FRAMES = 0x3c;
export const HINGE_FRAMES_CURVE4 = 0x82;
const HINGE_LONG_CURVE = 4;
/** The curves `HingeUpdate` reads from `g_pHingeCurvesXYZ` (`0x00473E8D`). */
export const HINGE_XYZ_CURVES = [0, 2, 3];

/** `ADD ECX,0x1000` -- the wobble's step, and `CMP EBX,0xFFFF` its end. */
const HINGE_WOBBLE_STEP = 0x1000;
const HINGE_WOBBLE_END = 0xffff;
/** `FMUL double [0x004C4370]` -- BAMS to radians. */
const BAMS_TO_RADIANS = 9.587379924285257e-05;
/**
 * `FMUL double [0x00569178]` (1024.0) for slot `0x1A46`,
 * `[0x00569170]` (-1024.0) for every other.
 */
const HINGE_WOBBLE_GAIN = 1024.0;
const HINGE_WOBBLE_GAIN_SLOT = 0x1a46;

/** The slot whose two cues `HingeUpdate` tests (`CMP word [ESI+0x28C],0xA60`). */
export const HINGE_A60_SLOT = 0xa60;
/** `g_script_flags[0x36]` opens it, `[0x23]` knocks it. */
export const HINGE_A60_OPEN_CUE = 0x36;
export const HINGE_A60_KNOCK_CUE = 0x23;
/** `CMP dword [ESI+0x68],0x4000; JLE` -- past this yaw it stops swinging. */
const HINGE_A60_STOP_YAW = 0x4000;
export const SFX_HINGE_A60_OPEN = 0x1f16a9;
export const SFX_HINGE_A60_KNOCK = 0x2116a9;
/** The sound on slot `0x1866` in `g_scene_index` 3, blocks 1 and 7. */
export const HINGE_1866_SLOT = 0x1866;
const HINGE_1866_SCENE = 3;
const HINGE_1866_BLOCKS = [1, 7];
const HINGE_1866_FLAGS = [2, 4];
export const SFX_HINGE_1866 = 0x361ba9;
/** `g_scene_index == 1 && g_script_flags[0x77]` -- stage 2's sweep. */
export const PROP_SWEEP_SCENE = 1;
export const PROP_SWEEP_FLAG = 0x77;

/** The van's two doors: `0x1794 + i`, `(±9.29f, 11.5, 22.68)`. */
export const VAN_DOOR_SLOT = 0x1794;
const VAN_DOOR_X = Math.fround(9.29);
const VAN_DOOR_Y = 11.5;
const VAN_DOOR_Z = Math.fround(22.68);
/** `ADD ECX,0x8000` -- the second door is turned half round. */
const VAN_DOOR_TURN = 0x8000;
/** `MOV word [ESI+0x290],2`. */
const VAN_DOOR_CURVE = 2;

/**
 * `[port-only]` The head all three builders share: the object at the
 * descriptor's pose with the words they all write. The engine writes each
 * builder out whole; one helper here so that three copies of fourteen lines
 * cannot drift, and each builder below writes what is its own.
 */
function HingeAlloc(pl: BreakablePlacement): BreakableProp {
  const p = makeBreakableProp(G.g_breakable_next_id++, 0, 0);
  p.family = PropFamily.Hinge;
  p.at = pl.at;
  p.state = BreakableState.Standing;
  p.flags = HINGE_FLAGS;
  p.x = Math.fround(pl.pos?.[0] ?? 0);
  p.y = Math.fround(pl.pos?.[1] ?? 0);
  p.z = Math.fround(pl.pos?.[2] ?? 0);
  p.yaw = pl.yaw ?? 0;
  p.restX = 1.0;
  p.restY = 1.0;
  p.restZ = 1.0;
  p.storyItem = pl.open_flag ?? 0;
  p.removeFlag = pl.remove_flag ?? -1;
  p.hitRadius = 0;
  const w = PropWords(p, HINGE_WORDS);
  w.o68 = 0;
  w.o14c = pl.coli ?? -1;
  w.o2a8 = 0;
  w.o2c0 = 1.0;
  return p;
}

/** `PropBuildHinge` — `FUN_00472BD0`. `g_class44_subtypes[1]`. */
export function PropBuildHinge(pl: BreakablePlacement): BreakableProp {
  const p = HingeAlloc(pl);
  const w = PropWords(p, HINGE_WORDS);
  p.slot = pl.slot ?? 0;
  w.o1dc = pl.side ?? 0;
  w.o1e8 = pl.wobble_phase ?? 0;
  w.o290 = pl.curve ?? 0;
  return p;
}

/** `PropBuildHingeScaled` — `FUN_00472EB0`. `g_class44_subtypes[4]`. */
export function PropBuildHingeScaled(pl: BreakablePlacement): BreakableProp {
  const p = HingeAlloc(pl);
  const w = PropWords(p, HINGE_WORDS);
  p.slot = pl.slot ?? 0;
  w.o1dc = pl.side ?? 0;
  w.o290 = pl.curve ?? 0;
  w.o2ac = 0;
  p.restX = Math.fround(pl.scale?.[0] ?? 0);
  p.restY = Math.fround(pl.scale?.[1] ?? 0);
  p.restZ = Math.fround(pl.scale?.[2] ?? 0);
  return p;
}

/**
 * `PropBuildVanDoors` — `FUN_00472C90`. `g_class44_subtypes[2]`: two doors
 * at literal offsets in the descriptor's frame.
 */
export function PropBuildVanDoors(pl: BreakablePlacement): BreakableProp[] {
  const m = MatIdentity();
  MatrixTranslate(m, Math.fround(pl.pos?.[0] ?? 0),
                  Math.fround(pl.pos?.[1] ?? 0), Math.fround(pl.pos?.[2] ?? 0));
  MatrixRotateY(m, pl.yaw ?? 0);
  const out: BreakableProp[] = [];
  for (let i = 0, side = -1; side < 3; i++, side += 2) {
    const p = HingeAlloc(pl);
    const w = PropWords(p, HINGE_WORDS);
    // `FILD side; FMUL float [0x00569018]; FSTP float` -- the x is stored
    // single before `MatrixTransformPoint` (`0x004A8A80`) reads it, and the
    // result goes to `obj+0x19C` as three `FSTP float`s.
    const at = { x: 0, y: 0, z: 0 };
    MatrixTransformPoint(m, { x: Math.fround(side * VAN_DOOR_X),
                              y: VAN_DOOR_Y, z: VAN_DOOR_Z }, at);
    p.x = Math.fround(at.x);
    p.y = Math.fround(at.y);
    p.z = Math.fround(at.z);
    p.yaw = (i * VAN_DOOR_TURN + (pl.yaw ?? 0)) | 0;
    p.slot = VAN_DOOR_SLOT + i;
    w.o1dc = side;
    w.o290 = VAN_DOOR_CURVE;
    w.o1e8 = pl.wobble_phase ?? 0;
    out.push(p);
  }
  return out;
}

/**
 * The curve's key at *frame*: `[rx, ry, rz]` from `g_pHingeCurvesXYZ`
 * (`0x005960B4`) for curves 0, 2 and 3, `[0, ry, 0]` from the yaw-only
 * `g_pHingeCurvesYaw` (`0x005960C8`) for the rest -- `XOR EDX,EDX; MOV DX` at
 * `0x00473EAA`, so the yaw is zero-extended.
 *
 * `[port-only]` as a function: the two table reads are `HingeUpdate`'s
 * (`0x00473E8D`..`0x00473ED4`), out of the bundle's copies of the tables.
 */
export function HingeCurveKey(curve: number, frame: number):
    [number, number, number] {
  if (HINGE_XYZ_CURVES.includes(curve)) {
    const k = T.breakables?.hinge_curves_xyz?.[String(curve)]?.[frame];
    return k ? [k[0], k[1], k[2]] : [0, 0, 0];
  }
  const ry = T.breakables?.hinge_curves_yaw?.[String(curve)]?.[frame] ?? 0;
  return [0, ry & 0xffff, 0];
}

/**
 * `HingeUpdate` — `FUN_00473CF0`. One hinge, one 60 Hz frame.
 *
 * ```c
 * if (obj->+0x2A4 >= 0 && g_script_flags[obj->+0x2A4] == 1)
 *     { obj->+0x14C == -1 ? ActorKill() : ActorDespawn(obj); return; }
 * if (g_scene_index == 1 && g_script_flags[0x77]) { ActorDespawn(obj); return; }
 * if ((s16)obj->+0x28C == 0xA60) {
 *     if (g_script_flags[0x36] && obj->+0x2A8 == 0)
 *         { g_script_flags[obj->+0x2A0] = 1; obj->+0x290 = 1; PlaySoundId(0x1F16A9); }
 *     if (g_script_flags[0x23] && obj->+0x2A8 == 0 && obj->+0x290 == 0)
 *         { PlaySoundId(0x2116A9); PoseHookNone(3, 0x14); obj->+0x14C = -1; }
 *     if (obj->+0x68 > 0x4000) obj->+0x2A8 = 0x3C;
 * }
 * if (g_scene_index == 3 && (block == 1 || block == 7) && (s16)slot == 0x1866
 *     && (g_script_flags[2] == 1 || g_script_flags[4] == 1)
 *     && obj->+0x2A8 == 0 && obj->+0x2AC == 0)
 *     { PlaySoundId(0x361BA9); PoseHookNone(4, 0x14); obj->+0x2AC = 1; }
 * if (g_script_flags[obj->+0x2A0] == 1 && obj->+0x2A8 < (curve == 4 ? 0x82 : 0x3C)) {
 *     key = curve in {0, 2, 3} ? XYZ[curve][f] : (0, (u16)Yaw[curve][f], 0);
 *     obj->+0x6C = obj->+0x1D4 + key.rz;
 *     if (obj->+0x1DC > 0) { obj->+0x64 = obj->+0x1CC + key.rx;  obj->+0x68 =  ftol(key.ry * obj->+0x2C0); }
 *     else                 { obj->+0x64 = obj->+0x1CC - key.rx;  obj->+0x68 = -ftol(key.ry * obj->+0x2C0); }
 *     obj->+0x2A8++;
 * } else if (!(obj->+0x34 & 0x40000000) && (obj->+0x34 & 8)) {
 *     obj->+0x1E8 = 0;  obj->+0x34 = obj->+0x34 & ~0xE | 0x40000000;  obj->+0x1F4 = obj->+0x68;
 * }
 * if (obj->+0x34 & 0x40000000) {
 *     obj->+0x1E8 += 0x1000;
 *     obj->+0x68 = obj->+0x1F4
 *         - ftol(sin(obj->+0x1E8 * 2pi/65536) * (slot == 0x1A46 ? 1024 : -1024)) * obj->+0x1DC;
 *     if (obj->+0x1E8 > 0xFFFF) { obj->+0x68 = obj->+0x1F4; obj->+0x34 &= ~0x40000000; }
 * }
 * Push; Translate(pos); RotY(+0x1D0); RotZ(+0x6C); RotY(+0x68); RotX(+0x64);
 * slot == 0x1817 || slot == 0x1816 ? Scale(1.05, 1, 1) : Scale(+0x1A8, +0x1AC, +0x1B0);
 * AssetDrawSlot(slot) (or the lit twin); MatrixStore(+0x150); Pop;
 * if (obj->+0x14C != -1) RegisterForShotTest(obj);
 * ```
 *
 * `[proved]`, `0x00473CF0`..`0x00474115`. The flag tests on `0x36`, `0x23`
 * and `0x77` are `TEST AL,AL` (any non-zero); every other is `CMP ..., 1`.
 * The `else` arm is taken both when the flag is down and when the curve has
 * run out, so a door that has finished swinging can be shot into a wobble and
 * one still swinging cannot.
 */
export function HingeUpdate(p: BreakableProp, events?: Events): void {
  const w = PropWords(p, HINGE_WORDS);
  PropDrawBegin(p);
  const flag = (i: number): number => G.g_script_flags[i] ?? 0;
  if (p.removeFlag >= 0 && flag(p.removeFlag) === 1) {
    if (w.o14c === -1) ActorKillProp(p);
    else ActorDespawnProp(p);
    return;
  }
  if (G.g_scene_index === PROP_SWEEP_SCENE && flag(PROP_SWEEP_FLAG) !== 0) {
    ActorDespawnProp(p);
    return;
  }
  const slot = (p.slot << 16) >> 16;
  if (slot === HINGE_A60_SLOT) {
    if (flag(HINGE_A60_OPEN_CUE) !== 0 && w.o2a8 === 0) {
      G.g_script_flags[p.storyItem] = 1;
      w.o290 = 1;
      events?.emit("sound.play", { id: SFX_HINGE_A60_OPEN });
    }
    if (flag(HINGE_A60_KNOCK_CUE) !== 0 && w.o2a8 === 0
        && ((w.o290 << 16) >> 16) === 0) {
      events?.emit("sound.play", { id: SFX_HINGE_A60_KNOCK });
      w.o14c = -1;
    }
    if (w.o68 > HINGE_A60_STOP_YAW) w.o2a8 = HINGE_FRAMES;
  }
  if (G.g_scene_index === HINGE_1866_SCENE
      && HINGE_1866_BLOCKS.includes((G.g_evt_block_index << 16) >> 16)
      && slot === HINGE_1866_SLOT
      && HINGE_1866_FLAGS.some((i) => flag(i) === 1)
      && w.o2a8 === 0 && w.o2ac === 0) {
    events?.emit("sound.play", { id: SFX_HINGE_1866 });
    w.o2ac = 1;
  }
  const curve = (w.o290 << 16) >> 16;
  const limit = curve === HINGE_LONG_CURVE ? HINGE_FRAMES_CURVE4 : HINGE_FRAMES;
  if (flag(p.storyItem) === 1 && w.o2a8 < limit) {
    const [rx, ry, rz] = HingeCurveKey(curve, w.o2a8);
    w.o6c = (p.roll + rz) | 0;
    // `FILD; FMUL float [ESI+0x2C0]; CALL __ftol` -- truncation.
    if (w.o1dc > 0) {
      w.o64 = (p.pitch + rx) | 0;
      w.o68 = Math.trunc(ry * w.o2c0) | 0;
    } else {
      w.o64 = (p.pitch - rx) | 0;
      w.o68 = -Math.trunc(ry * w.o2c0) | 0;
    }
    w.o2a8 += 1;
  } else if ((p.flags & HINGE_WOBBLE) === 0 && (p.flags & HINGE_HIT) !== 0) {
    w.o1e8 = 0;
    p.flags = ((p.flags & ~HINGE_HIT_CLEARS) | HINGE_WOBBLE) >>> 0;
    w.o1f4 = w.o68;
  }
  if ((p.flags & HINGE_WOBBLE) !== 0) {
    const phase = (w.o1e8 + HINGE_WOBBLE_STEP) | 0;
    w.o1e8 = phase;
    const s = Math.sin(phase * BAMS_TO_RADIANS);
    const gain = slot === HINGE_WOBBLE_GAIN_SLOT ? HINGE_WOBBLE_GAIN
                                                 : -HINGE_WOBBLE_GAIN;
    w.o68 = (w.o1f4 - Math.imul(Math.trunc(s * gain), w.o1dc)) | 0;
    if (phase > HINGE_WOBBLE_END) {
      w.o68 = w.o1f4;
      p.flags = (p.flags & ~HINGE_WOBBLE) >>> 0;
    }
  }
  const m = PropMatrixPush();
  MatrixTranslate(m, p.x, p.y, p.z);
  MatrixRotateY(m, p.yaw);
  MatrixRotateZ(m, w.o6c);
  MatrixRotateY(m, w.o68);
  MatrixRotateX(m, w.o64);
  if (HINGE_WIDE_SLOTS.includes(slot)) {
    MatrixScale(m, HINGE_WIDE_SCALE_X, 1.0, 1.0);
  } else {
    MatrixScale(m, p.restX, p.restY, p.restZ);
  }
  PropDrawSlot(p, m, p.slot);
  // `MatrixStore(obj+0x150)` is the mesh shot test's; see the file comment.
  // The routine never writes `obj+0x70..0x78`, so the point it files is the
  // one the object was cleared with.
  if (w.o14c !== -1) PropRegisterForShotTest(p, p.shotX, p.shotY, p.shotZ);
}
