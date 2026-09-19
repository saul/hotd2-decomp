/**
 * Where a horde member dies: a splash, then a ripple that fades.
 *
 * `SpawnHordeDeathSplash` (`FUN_0043E4C0`) is called by the kill with the
 * point and a size, and plays `BOBBLE1_22.wav` from the stage's own bank.
 * The object it builds is a full `0x13F4`-byte actor that draws and nothing
 * else — no shot test, no counter, no camera — for 120 frames under
 * `HordeDeathSplashUpdate` (`FUN_0043E540`) and 60 more under
 * `HordeDeathRippleFade` (`FUN_0043E650`).
 *
 * The drawing is `render/`'s; what is here is the clock that decides it.
 */
import type { Events } from "../../core/events";
import type { Actor } from "../actor";
import { ActorDespawn } from "../despawn";
import { G } from "../globals";
import { ActorSpawn } from "../spawn";
import { SpawnClass } from "../spawn_class";
import { HordeKind, type HordeTail } from "./state";

/** `obj+0x1330 = 0x78` — the splash's frames. */
export const HORDE_SPLASH_FRAMES = 0x78;
/** `HordeDeathRippleFade` holds for 30 frames, then fades over 30. */
export const HORDE_RIPPLE_HOLD = 0x1d;
export const HORDE_RIPPLE_FADE = 0x1d;
/** `STAGE1_SE\BOBBLE1_22.wav` in scene 0, `STAGE2_SE\BOBBLE1_22.wav` else. */
export const SND_HORDE_SPLASH_S1 = 0x118a9;
export const SND_HORDE_SPLASH_S2 = 0x119a9;

function Tail(obj: Actor): HordeTail | null {
  return (obj as Actor & { horde?: HordeTail }).horde ?? null;
}

/**
 * `[port-only]` — the next class-0x40 effect object's spawn address. The
 * engine's splash is a task with no descriptor; the port's pool is keyed on
 * `at`, and two splashes from one member must not share one. The counter is
 * in `G` so a snapshot restores it.
 */
export function HordeEffectAt(): number {
  const at = 0x18000000 | (G.g_horde_effect_seq & 0xffffff);
  G.g_horde_effect_seq += 1;
  return at;
}

/**
 * `SpawnHordeDeathSplash` — `FUN_0043E4C0`. `(member, x, y, z, size)`.
 *
 * The member's yaw, 120 frames, the size at `+0x1340`, and the sound.
 */
export function SpawnHordeDeathSplash(member: Actor, x: number, y: number,
                                      z: number, size: number,
                                      events?: Events): void {
  const obj = ActorSpawn(HordeEffectAt(), SpawnClass.HordeSpawner, -1,
                         "horde splash", { visible: true });
  const t = Tail(obj);
  if (!t) return;
  t.kind = HordeKind.Splash;
  obj.pos.x = x;
  obj.pos.y = y;
  obj.pos.z = z;
  obj.yaw = member.yaw;
  t.frame = HORDE_SPLASH_FRAMES;
  t.size = size;
  events?.emit("sound.play", {
    id: G.g_scene_index === 0 ? SND_HORDE_SPLASH_S1 : SND_HORDE_SPLASH_S2 });
}

/**
 * `HordeDeathSplashUpdate` — `FUN_0043E540`.
 *
 * Counts `+0x1330` down from 120 and draws two things from it, both about
 * `a = ftol(n * 136.533)` BAMS — a quarter turn at 120, nothing at 0: the
 * ripple, `common.bin` 371 (slot `0x1A38`), flat and `cos a * size * 3`
 * across, **growing**; and the splash, `common.bin` 338..367
 * (`0x15E4 + g_frame_counter % 30`), `sin a * size`, **shrinking**. On the
 * frame the count reaches 0 it installs the fade — and still draws.
 */
export function HordeDeathSplashUpdate(obj: Actor): void {
  const t = Tail(obj);
  if (!t) return;
  t.frame -= 1;
  if (t.frame === 0) t.kind = HordeKind.Ripple;
}

/**
 * `HordeDeathRippleFade` — `FUN_0043E650`.
 *
 * The ripple at its full `3 * size`, opaque for thirty frames, then
 * `AssetDrawSlotWithAlpha` at `(40 - n) * 0.025` while `+0x1320` counts
 * thirty more, and gone.
 */
export function HordeDeathRippleFade(obj: Actor): void {
  const t = Tail(obj);
  if (!t) return;
  t.frame += 1;
  if (t.frame > HORDE_RIPPLE_HOLD) {
    t.fade += 1;
    if (t.fade > HORDE_RIPPLE_FADE) {
      ActorDespawn(obj);
    }
  }
}
