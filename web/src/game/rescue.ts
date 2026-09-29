/**
 * A rescue, as the engine records it for the end of the stage.
 *
 * Two routines rescue: `CivilianRunScript` (`FUN_0048B9E0`) op 0x2C, the
 * civilians', and `RescueTargetHeldState` (`FUN_00451980`), stage 2's car.
 * Both make the same three stores before a point is paid, and those stores
 * are what `ResultCardInstall` (`FUN_00434EF0`) reads at the end of the scene
 * -- how many were rescued here, and who. See `docs/re/stage-end.md`,
 * section 5.
 */
import { G } from "./globals";
import { RESCUE_TARGET_CHAR_TYPE } from "./class61/state";

export { RESCUE_TARGET_CHAR_TYPE };

/** `g_rescued_char_types`' stride: `LEA EBX, [ECX + ECX*0x4]` then `*2`. */
export const RESCUES_PER_SCENE = 10;

/**
 * The three stores both rescue writers make, in their order:
 * `g_civilians_rescued_total += 1`, then `n = g_civilians_rescued_by_scene
 * [scene]`, the count back as `n + 1`, and `g_rescued_char_types[scene*10 +
 * n] = type` -- `CivilianRunScript` op 0x2C at `0x0048BA93`..`0x0048BAC4`
 * with `model+0x60`, `RescueTargetHeldState` at `0x00451AFF`..`0x00451B21`
 * with {@link RESCUE_TARGET_CHAR_TYPE}. Neither bounds `n`. All three words
 * are s16.
 *
 * `[port-only]` as a function: both routines write the stores inline.
 */
export function RecordRescue(type: number): void {
  const s16 = (v: number) => (v << 16) >> 16;
  const scene = G.g_scene_index;
  G.g_civilians_rescued_total = s16(G.g_civilians_rescued_total + 1);
  const n = G.g_civilians_rescued_by_scene[scene] ?? 0;
  G.g_civilians_rescued_by_scene[scene] = s16(n + 1);
  G.g_rescued_char_types[scene * RESCUES_PER_SCENE + n] = s16(type);
}
