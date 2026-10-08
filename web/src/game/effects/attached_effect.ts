/**
 * The wake a class-0x30 actor leaves in the water: two tasks that follow it,
 * one for each way it can be moving.
 *
 * `ActorCheckWaterEntry` (`FUN_00456920`, `g_class30_states[0x36]`) makes the
 * pair once, the frame the actor is first below a water surface with its
 * hips above it -- or, for body condition 6, the frame it is first below it
 * at all -- through `SpawnBothAttachedEffects` (`FUN_00408740`), which is
 * `SpawnAttachedEffect` (`FUN_00408770`) twice, kinds 0 and 1. Each is a
 * 0x13F4-byte task running `AttachedEffectThink` (`FUN_004083D0`), the only
 * routine that allocates, reads or draws one: `ActorCheckWaterEntry` is the
 * only caller of the pair routine and the pair routine of the spawn (every
 * `E8` to either address in `.text`), and `0x004083D0` is pushed once, by the
 * spawn. The model is `water.bin` 13..62 -- slots `0x1A78 + n % 0x32` -- a
 * fifty-cel cycle drawn 2.0 ahead of the point it stands on, stretched along
 * its own z.
 *
 * Kind 0 draws while the actor's `obj+0x34` bit `0x20000000`
 * ({@link ActorFlag.BackingOff}) is down, facing the actor's yaw turned half
 * round; kind 1 while the bit is up, facing the yaw itself. The one that is
 * not drawing stays where the actor last was and fades, so a wake that
 * changes direction leaves the old one behind it. Both grow in while the
 * actor moves and fade while it stands, and both end the frame the actor is
 * a corpse, is despawned or is in state 9.
 *
 * Like every task this runs on the frame it is made, after its maker, so the
 * pool is stepped after the actors (`game/director.ts`) and the draw --
 * `render/slotmodels.ts` -- is of what the step recorded.
 */
import type { Events } from "../../core/events";
import { ActorFlag, type ZombieActor } from "../actor";
import { ActorByAt, G, HIT_SLOT_NONE } from "../globals";
import { ActorClaimHitSlot } from "../hit_slots";
import {
  MatIdentity, MatrixRotateY, MatrixTransformPoint, MatrixTranslate,
} from "../matrix";
import { SpawnClass } from "../spawn_class";
import { vec3 } from "../vec";

/** `ADD EDI, 0x1A78` at `0x004086F5` -- `water.bin` 13. */
export const ATTACHED_EFFECT_FIRST_SLOT = 0x1a78;
/** `MOV ECX, 0x32` / `IDIV ECX` at `0x00408687`: fifty cels. */
export const ATTACHED_EFFECT_CELS = 0x32;
/** `MOV [ESP+0x20], 0x40000000` at `0x00408641`: 2.0 ahead, on the local z. */
export const ATTACHED_EFFECT_AHEAD = 2.0;
/** `MOV [ESI+0x138C], 0x3D4CCCCD` at `0x004087B7`: the first alpha, 0.05. */
const ALPHA_START = Math.fround(0.05);
/** `FADD [0x004C4C88]` -- 0.05 a frame while the actor moves. */
const ALPHA_GROW = Math.fround(0.05);
/** `FSUB [0x004C4CC4]` -- 0.015 a frame while it does not. */
const ALPHA_FADE = Math.fround(0.015);
/** `FADD`/`FSUB [0x004C4CC0]` -- 0.01, the stretch and the rate's step. */
const STRETCH_STEP = Math.fround(0.01);
/** `FCOMP [0x004C4CC8]` -- 0.1, the travel below which the actor is still. */
const STILL_TRAVEL = Math.fround(0.1);
/** `FMUL [0x004C4CBC]` -- 2.5, the z stretch for character type 0. */
const Z_STRETCH_TYPE0 = 2.5;
/** `FMUL [0x004C4CB8]` -- 1.5, for an actor in body condition 6. */
const Z_STRETCH_WADING = 1.5;
/** `CMP dword ptr [EDI+0x130C], 0x6` at `0x004085C6`. */
const COND_WADING = 6;
/** `CMP word ptr [EDI+0x1310], 0x9` at `0x00408422`: `ZombieStateDeathKnockbackArc`. */
const STATE_KNOCKBACK_ARC = 9;
/** `PUSH 0x4616A9` at `0x00408443` -- `COMMON\SIBUKI8_16.WAV`. */
export const SND_ATTACHED_EFFECT_SPLASH = 0x4616a9;
/**
 * `obj+0x34` bit 4 on the task, raised when `SpawnAttachedEffect`'s last
 * argument is 1 (`OR AL, 0x4` at `0x00408797`): which of the pair it is.
 */
export const ATTACHED_EFFECT_KIND1 = 0x4;
/**
 * `[port-only]` -- the number the task holds `g_hit_slots` by. The engine
 * stores the task's pointer; the table holds actors' `at`s here, and a task
 * that is not an actor needs a number no actor carries. Nothing reads an
 * entry but the claim and the release, which compare it with "none".
 */
const HOLDER_BASE = -0x40000000;

/** One task. Plain data, so it goes into a snapshot as it is. */
export interface AttachedEffect {
  /** `[port-only]` -- the engine's identity is the task pointer. */
  id: number;
  /** `[port-only]` -- see {@link HOLDER_BASE}. */
  at: number;
  /** `obj+0x3C` -- the `g_hit_slots` index `ActorClaimHitSlot` gave it. */
  hitSlot: number;
  /** `obj+0x38` -- the claim's bit `0x40`, and nothing else. */
  flags38: number;
  /** `obj+0x34` -- {@link ATTACHED_EFFECT_KIND1}, and nothing else. */
  flags: number;
  /** `obj+0x1390` -- the actor, by its `at`. */
  parent: number;
  /** `obj+0x1F4` -- the actor's character type, copied at the spawn. */
  charType: number;
  /** `obj+0x1312` -- 0 while it follows the actor, 1 once it has let go. */
  mode: number;
  /** `obj+0x40`, `obj+0x48` -- where it let go. */
  x: number;
  z: number;
  /** `obj+0x68` -- the draw's `RotY`. */
  yaw: number;
  /** `obj+0x137C` -- the water surface's height, the draw's `y`. */
  height: number;
  /** `obj+0x1350` -- the actor's yaw at the spawn. Nothing reads it. */
  spawnYaw: number;
  /** `obj+0x1358` -- the actor's `obj+0x34` as of the last frame. */
  parentFlags: number;
  /** `obj+0x1380..0x1388` -- the actor's position as of the last frame. */
  lastX: number;
  lastY: number;
  lastZ: number;
  /** `obj+0x1370` -- the cel counter, a float. */
  cel: number;
  /** `obj+0x1374` -- what the counter steps by. */
  rate: number;
  /** `obj+0x1378` -- the x stretch, and what the z stretch is made from. */
  stretch: number;
  /** `obj+0x138C` -- the alpha. */
  alpha: number;
  /**
   * `[port-only]` -- what this frame's step drew, for `render/slotmodels.ts`:
   * `T(x, y, z) RotY(yaw) Scale(sx, 1, sz)` and the slot at `alpha`. `null`
   * when it drew nothing.
   */
  drawn: { x: number; y: number; z: number; yaw: number; sx: number;
           sz: number; slot: number; alpha: number } | null;
}

/**
 * `SpawnAttachedEffect` — `FUN_00408770`.
 *
 * ```
 * obj = ActorAlloc(AttachedEffectThink, 0x13F4); ActorClearGameFields(obj)
 * if (kind == 1) obj+0x34 |= 4
 * obj+0x1390 = parent; obj+0x1374 = obj+0x1378 = 1.0; obj+0x138C = 0.05
 * obj+0x1380..0x1388 = parent+0x40..0x48; obj+0x137C = height
 * obj+0x1350 = yaw; obj+0x1358 = parent+0x34; obj+0x1F4 = parent+0x1F4
 * ActorClaimHitSlot(obj)
 * ```
 *
 * `[proved]` from the disassembly, `0x00408770`..`0x00408811`.
 */
export function SpawnAttachedEffect(parent: ZombieActor, height: number,
                                    yaw: number, kind: number): void {
  const id = G.g_attached_effect_seq++;
  const e: AttachedEffect = {
    id, at: HOLDER_BASE - id, hitSlot: HIT_SLOT_NONE, flags38: 0,
    flags: kind === 1 ? ATTACHED_EFFECT_KIND1 : 0,
    parent: parent.at, charType: parent.charType, mode: 0, x: 0, z: 0,
    yaw: 0, height, spawnYaw: yaw, parentFlags: parent.flags,
    lastX: parent.pos.x, lastY: parent.pos.y, lastZ: parent.pos.z,
    cel: 0, rate: 1.0, stretch: 1.0, alpha: ALPHA_START, drawn: null,
  };
  ActorClaimHitSlot(e);
  G.g_attached_effects.push(e);
}

/**
 * `SpawnBothAttachedEffects` — `FUN_00408740`. `SpawnAttachedEffect(parent,
 * height, yaw, 0)` and then `(..., 1)`; nothing else. `[proved]`
 */
export function SpawnBothAttachedEffects(parent: ZombieActor, height: number,
                                         yaw: number): void {
  SpawnAttachedEffect(parent, height, yaw, 0);
  SpawnAttachedEffect(parent, height, yaw, 1);
}

const _p = vec3();
const _q = vec3();

/**
 * `AttachedEffectThink` — `FUN_004083D0`. One frame of one task; `false`
 * when it has killed itself.
 *
 * ```
 * d = |parent+0x40 - obj+0x1380|                          ; before anything
 * if (!(parent+0x34 & 1) || parent+0x1310 == 9) {
 *     if (obj+0x3C != -1) g_hit_slots[obj+0x3C] = 0;  ActorKill()
 * }
 * if (!(obj+0x1358 & 0x10000000) && (parent+0x34 & 0x10000000))
 *     PlaySoundId(0x4616A9)
 * obj+0x1358 = parent+0x34
 * if (kind 0 ? !(parent+0x34 & 0x20000000) : (parent+0x34 & 0x20000000)) {
 *     obj+0x1312 = 0; obj+0x68 = parent+0x68 - kind*0x8000 + 0x8000
 * } else {
 *     if (obj+0x1312 != 1) { obj+0x40 = parent+0x40; obj+0x48 = parent+0x48 }
 *     obj+0x1312 = 1
 * }
 * obj+0x1380..0x1388 = parent+0x40..0x48
 * if (obj+0x1312 == 1 || d < 0.1) {
 *     alpha -= 0.015; stretch += 0.01; rate -= 0.01
 * } else { alpha += 0.05; stretch = rate = 1.0 }
 * alpha clamped to [0, 1]; rate to [0, ..)
 * sz = obj+0x1F4 == 0 ? stretch * 2.5 : stretch * 2
 * if (parent+0x130C == 6) sz = stretch * 1.5
 * Push; Identity; Translate(mode 0 ? parent x/z : obj x/z at obj+0x137C)
 * RotY(obj+0x68); p = TransformPoint((0, 0, 2)); Pop
 * if (alpha != 0) {
 *     n = ftol(obj+0x1370 += rate)
 *     Push; Translate(p); RotY(obj+0x68); Scale(stretch, 1, sz)
 *     NoOpStub(MaxOfThreeFloats(stretch, 1, sz))
 *     AssetDrawSlotWithAlpha(0x1A78 + n % 0x32, alpha); Pop
 * }
 * ```
 *
 * `[proved]` from the disassembly, `0x004083D0`..`0x00408731`. The kill test
 * is on the actor's `obj+0x34` bit 0, which `ActorInitFlags` raises and
 * `ZombieEnterCorpseState` and `ActorDespawn` lower -- the port's actor is
 * gone from the pool a frame after its despawn, so a parent it cannot find
 * reads as one whose bit is down, which is what the engine's stale read of a
 * despawned block finds. The kill arm clears the slot **without** the flag
 * test `ActorDespawn`'s own release makes. `NoOpStub` is a bare `RET`.
 */
export function AttachedEffectThink(e: AttachedEffect, events?: Events):
    boolean {
  e.drawn = null;
  const p = ActorByAt(e.parent);
  const parent = p && (p.cls === SpawnClass.Zombie
                       || p.cls === SpawnClass.CarriedZombie) ? p : undefined;
  if (!parent || !(parent.flags & ActorFlag.Live)
      || parent.state === STATE_KNOCKBACK_ARC) {
    if (e.hitSlot !== HIT_SLOT_NONE) G.g_hit_slots[e.hitSlot] = HIT_SLOT_NONE;
    return false;
  }
  const dx = parent.pos.x - e.lastX;
  const dy = parent.pos.y - e.lastY;
  const dz = parent.pos.z - e.lastZ;
  const travel = Math.sqrt(dx * dx + dy * dy + dz * dz);

  if (!(e.parentFlags & ActorFlag.Committed)
      && (parent.flags & ActorFlag.Committed)) {
    events?.emit("sound.play", { id: SND_ATTACHED_EFFECT_SPLASH });
  }
  e.parentFlags = parent.flags;
  const kind1 = (e.flags & ATTACHED_EFFECT_KIND1) !== 0;
  const back = (parent.flags & ActorFlag.BackingOff) !== 0;
  if (kind1 === back) {
    e.mode = 0;
    e.yaw = (parent.yaw - (kind1 ? 0x8000 : 0) + 0x8000) | 0;
  } else {
    if (e.mode !== 1) { e.x = parent.pos.x; e.z = parent.pos.z; }
    e.mode = 1;
  }
  e.lastX = parent.pos.x;
  e.lastY = parent.pos.y;
  e.lastZ = parent.pos.z;
  if (e.mode === 1 || travel < STILL_TRAVEL) {
    e.alpha = Math.fround(e.alpha - ALPHA_FADE);
    e.stretch = Math.fround(e.stretch + STRETCH_STEP);
    e.rate = Math.fround(e.rate - STRETCH_STEP);
  } else {
    e.alpha = Math.fround(e.alpha + ALPHA_GROW);
    e.stretch = 1.0;
    e.rate = 1.0;
  }
  if (!(e.alpha <= 1.0)) e.alpha = 1.0;
  if (e.alpha < 0.0) e.alpha = 0;
  if (e.rate < 0.0) e.rate = 0;
  let sz = e.charType === 0 ? e.stretch * Z_STRETCH_TYPE0 : e.stretch * 2;
  if (parent.condition === COND_WADING) sz = e.stretch * Z_STRETCH_WADING;
  sz = Math.fround(sz);

  const m = MatIdentity();
  if (e.mode === 0) MatrixTranslate(m, parent.pos.x, e.height, parent.pos.z);
  else MatrixTranslate(m, e.x, e.height, e.z);
  MatrixRotateY(m, e.yaw);
  _p.x = 0; _p.y = 0; _p.z = ATTACHED_EFFECT_AHEAD;
  MatrixTransformPoint(m, _p, _q);
  if (e.alpha === 0) return true;
  // `FLD [0x1370]; FADD [0x1374]; FST [0x1370]; CALL __ftol`: the counter is
  // stored as a float and truncated from the unrounded sum.
  const sum = e.cel + e.rate;
  e.cel = Math.fround(sum);
  const n = Math.trunc(sum);
  e.drawn = {
    x: _q.x, y: _q.y, z: _q.z, yaw: e.yaw, sx: e.stretch, sz,
    slot: ATTACHED_EFFECT_FIRST_SLOT + (n % ATTACHED_EFFECT_CELS),
    alpha: e.alpha,
  };
  return true;
}

/** `[port-only]` -- the pool, stepped after the actors that made its tasks. */
export function AttachedEffectsTick(events?: Events): void {
  if (!G.g_attached_effects.length) return;
  G.g_attached_effects =
    G.g_attached_effects.filter((e) => AttachedEffectThink(e, events));
}
