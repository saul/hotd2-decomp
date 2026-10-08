/**
 * Class 0x33 sub-handlers **8, 9 and 99** -- the three that draw.
 *
 * ```
 * ScriptedBridgeCrashStrip33   FUN_00433FE0   8: eff_shop.bin, one model a frame
 * ScriptedFireLoopUntilCue33   FUN_00434100   9: the fire loop until a cue
 * ScriptedStaticSlotDraw33     FUN_00433160   99: one slot, for good
 * ```
 *
 * Installed by `ScriptedSceneryDispatch33` (`FUN_00432FF0`) from jump-table
 * entries 7, 8 and 11 (`0x0043307B`, `0x00433089`, `0x004330B3`); selector
 * 99 reaches entry 11 through byte 98 of the map at `0x004330F8`, and its arm
 * falls into the default's `ActorClaimHitSlot`.
 *
 * Each `AssetDrawSlot` (`FUN_00418560`) is recorded on `obj.scenery.draws`
 * with the world matrix the stack held, as selector 1's are, and
 * `render/slotmodels.ts` places them.
 *
 * ## What is spawned
 *
 * `[proved]` by a census of every spawn opcode in the eleven `evt/` files:
 * selectors 8 and 9 once each, both stage 5 block 7 step 2 (`0x3D10` and
 * `0x3D34`, ops 17 and 18), at the same point `(580, 2200, -9149)` and pitch
 * `0x3800`. Selector 99 nowhere.
 *
 * Selector 8 plays `STAGE5_SE\BRIDGE_CRASH1_22.wav` and twenty frames later
 * `COMMON\GRASS7_16.WAV`, and draws `eff_shop.bin`'s sixty models
 * `0x174A..0x1785` at ten times their size, 300 units below the object, one a
 * frame, and is gone. That it is the bridge coming down is `[likely]`, from
 * the first sound's name; what the models are is not read here. Selector 9
 * plays `STAGE5_SE\CAR_FIRE_22.wav` -- a looped SE, `g_looping_se_ids` --
 * draws the same fire loop `0x1AAB..0x1AD2` (`eff_1.bin`) selector 1's
 * carrier draws, at ten times its size, and on its cue -- 360 frames on the
 * one spawn -- plays `CAR_FIRE_22_OFF.wav` and is gone.
 */
import { ActorDespawn } from "../despawn";
import { PlaySoundId } from "../class45/rand";
import { G } from "../globals";
import type { ScriptedSceneryActor } from "../actor";
import type { ClassFrame } from "../registry";
import {
  MatIdentity, type Mat, MatrixRotateX, MatrixRotateY, MatrixRotateZ,
  MatrixScale, MatrixTranslate,
} from "../matrix";
import { Class33CueMode } from "./cues";

/** `PUSH 0x1523a9` at `0x00433FF6` -- `STAGE5_SE\BRIDGE_CRASH1_22.wav`. */
const SND_BRIDGE_CRASH = 0x1523a9;
/** `PUSH 0x2f16a9` at `0x0043403B` -- `COMMON\GRASS7_16.WAV`. */
const SND_GRASS = 0x2f16a9;
/** `PUSH 0x723a9` at `0x004341AD` -- `STAGE5_SE\CAR_FIRE_22.wav`. */
const SND_FIRE = 0x723a9;
/** `PUSH 0x823a9` at `0x0043423D` -- `STAGE5_SE\CAR_FIRE_22_OFF.wav`. */
const SND_FIRE_OFF = 0x823a9;

/** `MOV dword [ESI+0x1330], 0x14` at `0x0043400A` -- frames to the second sound. */
const CRASH_SECOND_SOUND_FRAMES = 0x14;

/** `MOV dword [ESI+0x118], 0x41200000` at `0x00434014` and `0x004341CB`. */
const STRIP_SCALE = 10.0;

/**
 * `MOV dword [ESI+0x13F0], 0x1749` at `0x0043401E`, stepped before each draw
 * (`INC ECX` at `0x00434055`), so `0x174A` is the first drawn; past
 * `0x1785` (`CMP EAX, 0x1785` / `JLE`) the routine writes `0x174A` and
 * despawns instead of drawing.
 */
const CRASH_SLOT_SEED = 0x1749;
const CRASH_SLOT_LAST = 0x1785;
const CRASH_SLOT_FIRST = 0x174a;

/** `FSUB float ptr [0x0055DD4C]` at `0x0043408A` -- the raw is `0x43960000`. */
const CRASH_DROP = 300.0;

/**
 * `MOV dword [ESI+0x13F0], 0x1aaa` at `0x004341D5`, then the loop
 * `0x1AAB..0x1AD2` (`CMP EAX, 0x1ad2` / `MOV ..., 0x1aab` at `0x00434132`).
 */
const FIRE_SLOT_SEED = 0x1aaa;
const FIRE_SLOT_FIRST = 0x1aab;
const FIRE_SLOT_LAST = 0x1ad2;

/** `FADD float ptr [0x004E3100]` at `0x004341E5` -- the raw is `0x3CA3D70A`. */
const FIRE_SCALE_STEP = Math.fround(0.02);

/**
 * `FCOMP float ptr [0x004C43A4]` at `0x004341F1` -- `10.0`, the literal
 * `g_camera_track_key_scale` names, read here as a ceiling.
 */
const FIRE_SCALE_CEILING = 10.0;

/** `PUSH 0x3f800000` three times at `0x0043319F` -- selector 99's scale. */
const STATIC_SCALE = 1.0;

/**
 * `MatrixStackPush; MatrixTranslate(x, y, z); RotY(obj+0x68);
 * RotX(obj+0x64); RotZ(obj+0x6C); MatrixScale(obj+0x118 x3)` -- the head
 * selectors 8 and 9 share, `0x0043407A`..`0x004340C8` and
 * `0x00434143`..`0x00434183`. **Y, X, Z**, which is not selector 1's or 99's
 * order. `NoOpStub(obj+0x118)` follows and does nothing.
 *
 * `[port-only]` as a function: the two routines have it inline, the same
 * calls in the same order with only the translate's Y differing, which is
 * the argument here.
 */
function Class33StripMatrix(obj: ScriptedSceneryActor, y: number): Mat {
  const m = MatIdentity();
  MatrixTranslate(m, obj.pos.x, y, obj.pos.z);
  MatrixRotateY(m, obj.yaw);
  MatrixRotateX(m, obj.pitch);
  MatrixRotateZ(m, obj.roll);
  const k = obj.scenery.drawScale;
  MatrixScale(m, k, k, k);
  return m;
}

/**
 * `ScriptedBridgeCrashStrip33` — `FUN_00433FE0`. Selector 8.
 *
 * ```
 * sub 0: BRIDGE_CRASH1_22; sub 1; obj+0x1330 = 0x14; obj+0x118 = 10.0;
 *        obj+0x13F0 = 0x1749                         -- falls into sub 1
 * sub 1: if (--obj+0x1330 <= 0) { GRASS7_16; sub 2 }  -- falls into the draw
 * all:   if (++obj+0x13F0 > 0x1785) { obj+0x13F0 = 0x174A; ActorDespawn }
 *        else draw obj+0x13F0 at (x, y - 300, z)
 * ```
 *
 * `JG` at `0x00434039` is signed, so the second sound is the frame the count
 * reaches 0: the twentieth, counting the seed's. The strip has sixty models
 * and so runs sixty frames; the routine has no other way out.
 */
export function ScriptedBridgeCrashStrip33(obj: ScriptedSceneryActor,
                                           f: ClassFrame): void {
  const s = obj.scenery;
  s.draws.length = 0;
  if (obj.sub === 0) {
    PlaySoundId(SND_BRIDGE_CRASH, f.events);
    obj.sub += 1;
    s.frames = CRASH_SECOND_SOUND_FRAMES;
    s.drawScale = STRIP_SCALE;
    s.slot = CRASH_SLOT_SEED;
  }
  if (obj.sub === 1) {
    s.frames -= 1;
    if (s.frames <= 0) {
      PlaySoundId(SND_GRASS, f.events);
      obj.sub += 1;
    }
  }
  s.slot += 1;
  if (s.slot > CRASH_SLOT_LAST) {
    s.slot = CRASH_SLOT_FIRST;
    ActorDespawn(obj);
    return;
  }
  // `FLD [ESI+0x44]; FSUB [0x0055DD4C]; FSTP float [ESP]` -- rounded to a
  // float on the way onto the stack.
  const m = Class33StripMatrix(obj, Math.fround(obj.pos.y - CRASH_DROP));
  s.draws.push({ slot: s.slot, m: m.slice(0, 16) });
}

/**
 * `ScriptedFireLoopUntilCue33` — `FUN_00434100`. Selector 9.
 *
 * ```
 * sub 0: CAR_FIRE_22; sub 1; obj+0x1330 = 0; obj+0x118 = 10.0;
 *        obj+0x13F0 = 0x1AAA                         -- falls into sub 1
 * sub 1: obj+0x118 += 0.02, back to 10.0 when above it
 *        on the tail record's cue: CAR_FIRE_22_OFF; ActorDespawn
 * all:   ++obj+0x13F0 (0x1AAB..0x1AD2); draw it at (x, y, z)
 * ```
 *
 * The scale step is `FLD; FADD; FST [ESI+0x118]; FCOMP [10.0]`: the store is
 * rounded, the compare is on the unrounded sum, and `TEST AH, 0x41` / `JNZ`
 * skips the reset on "below" or "equal". `10.0 + 0.02` is above 10.0 every
 * time, so the scale is back at 10.0 on every frame it is drawn --
 * transcribed as written all the same. The cue is the class's record test
 * (`class33/cues.ts`), inline at `0x00434208`, on the record at `tail+0x00`,
 * which this routine never moves on. Sub 2 and up never occurs: nothing here
 * stores 2.
 */
export function ScriptedFireLoopUntilCue33(obj: ScriptedSceneryActor,
                                           f: ClassFrame): void {
  const t = obj.class33Sub;
  if (t?.selector !== 9) return;
  const s = obj.scenery;
  s.draws.length = 0;
  if (obj.sub === 0) {
    PlaySoundId(SND_FIRE, f.events);
    obj.sub += 1;
    s.frames = 0;
    s.drawScale = STRIP_SCALE;
    s.slot = FIRE_SLOT_SEED;
  }
  if (obj.sub === 1) {
    const sum = s.drawScale + FIRE_SCALE_STEP;
    s.drawScale = Math.fround(sum);
    if (sum > FIRE_SCALE_CEILING) s.drawScale = STRIP_SCALE;
    let hit = false;
    if (t.mode === Class33CueMode.FrameCount) {
      s.frames += 1;
      hit = s.frames === t.frame;
    }
    if (hit || (t.mode === Class33CueMode.CameraFrame
                && G.g_cam_path_frame === t.frame)) {
      PlaySoundId(SND_FIRE_OFF, f.events);
      ActorDespawn(obj);
      return;
    }
  }
  s.slot += 1;
  if (s.slot > FIRE_SLOT_LAST) s.slot = FIRE_SLOT_FIRST;
  const m = Class33StripMatrix(obj, obj.pos.y);
  s.draws.push({ slot: s.slot, m: m.slice(0, 16) });
}

/**
 * `ScriptedStaticSlotDraw33` — `FUN_00433160`. Selector 99: `tail+0x00`
 * under `T(obj+0x40..0x48) RotZ(obj+0x6C) RotY(obj+0x68) RotX(obj+0x64)
 * Scale(1, 1, 1)`, every frame, and nothing else -- no state, no sound, no
 * sphere, no way out.
 */
export function ScriptedStaticSlotDraw33(obj: ScriptedSceneryActor): void {
  const t = obj.class33Sub;
  if (t?.selector !== 99) return;
  const s = obj.scenery;
  s.draws.length = 0;
  const m = MatIdentity();
  MatrixTranslate(m, obj.pos.x, obj.pos.y, obj.pos.z);
  MatrixRotateZ(m, obj.roll);
  MatrixRotateY(m, obj.yaw);
  MatrixRotateX(m, obj.pitch);
  MatrixScale(m, STATIC_SCALE, STATIC_SCALE, STATIC_SCALE);
  s.draws.push({ slot: t.slot, m: m.slice(0, 16) });
}
