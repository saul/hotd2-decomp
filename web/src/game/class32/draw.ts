/**
 * Class 0x32's draw: `Class32DrawAndAdvance` (`FUN_0047FE40`), which poses the
 * boss through the engine's own model block (`game/skeleton.ts`), and the
 * node hook `Class32Init` installs at `model+0x1158`,
 * `Class32DrawBonePart` (`FUN_0047F780`), with its one callee,
 * `Class32DrawNodeSlot` (`FUN_0047FC50`).
 *
 * The boss carries the model block for the reason class 0x14 does: its
 * routines read the pose the frame's draw made -- the hands effect and the
 * projectiles sit on bones 5 and 8, the death bursts on any bone, the exit
 * effect on the tracked bone -- and its model sets `model+0x64` bit 3, which
 * blends an odd cursor by swing-twist, which only the block's walk does.
 *
 * What the hook decides is state: which models each node draws, and under
 * what light. It leaves them on `Boss5Tail.nodeDraws` for the renderer, and
 * it steps `obj+0x1334`, the hit flash, which `Class32OnShot` loads.
 */
import { ActorFlag, type Actor, type Boss5Actor } from "../actor";
import { G } from "../globals";
import { FtolS16 } from "../matrix";
import { SetRenderLightColour } from "../screen_sprite";
import { DrawSkinnedModelAndShadow, RegisterSkeletonNodeHook } from "../skeleton";
import { SpawnClass } from "../spawn_class";
import { VecToAngles } from "../vec";
import { CLASS32_BONE_PART_ARMS, CLASS32_BONE_PART_CELS } from "./bone_parts";
import { Class32State } from "./state";

/** `MOV dword ptr [ESI + 0x12ec], 0x47f780` at `0x0047F64A` -- the hook, `model+0x1158`. */
export const CLASS32_NODE_HOOK = 0x0047f780;

/** The node the light is aimed at: node record `+0x6F4`, bone 8. */
const LIGHT_TARGET_BONE = 8;
/** `SetRenderLightColour(0x3F800000, 0x3F47EF9E, 0x3F10A3D7)`. */
const LIGHT_WARM: [number, number, number] = [
  1.0, Math.fround(0.781), Math.fround(0.565),
];
/** The flash: `SetRenderLightColour(0 or 0x3F800000, 0, 0)` by the count's parity. */
const FLASH_ON = 1.0;
/** State 10 lights the model past sub 3: `CMP word ptr [ESI+0x1312], 3; JLE`. */
const BARRAGE_LIT_SUB = 3;

/**
 * `Class32DrawAndAdvance` — `FUN_0047FE40`.
 *
 * ```
 * LightsUseSecondarySet()
 * DrawSkinnedModelAndShadow(obj+0x194, obj+0x40, obj+0x20C)
 * LightsRestoreScene()
 * if (!(obj+0x34 & 0x4000)) { obj+0x194++; obj+0x198++ }
 * ```
 *
 * The two light calls are `game/light_sets.ts`'s; the colour the first
 * installs is the one a node draw keeps as `null`, and the one the walk's
 * part loop draws under is whatever the last node left (`partLight`).
 * `obj+0x194` is the block's counter (`model+0x00`), which the next draw
 * turns into the cursor the states read; `obj+0x198` is a second word the
 * block does not read.
 */
export function Class32DrawAndAdvance(obj: Boss5Actor): void {
  const t = obj.boss5;
  t.nodeDraws = {};
  t.drawLight = null;
  DrawSkinnedModelAndShadow(obj);
  t.partLight = t.drawLight;
  t.drawLight = null;
  const skel = obj.skel;
  if (skel && (obj.flags & ActorFlag.PoseFrozen) === 0) skel.counter += 1;
}

/**
 * `Class32DrawBonePart` — `FUN_0047F780`. The node hook: one call per node
 * the walk draws.
 *
 * ```
 * rec = g_skeleton_node_out + node*0x90; 0x007DCF28 = rec; 0x007DCF2C = node
 * push
 * switch (rec[0]):
 *   0x44A 0x49B 0x4C6 0x5B8 0x636 0x65F 0x689 0x6B2:
 *            Class32DrawNodeSlot(s); Class32DrawNodeSlot(s + 1 + g_frame_counter % 40)
 *   0x53F:   if (--obj+0x1334 < 0) obj+0x1334 = 0; then as above
 *   0x4EF 0x568 0x5E6 0x6DB:
 *            n = g_frame_counter % 40
 *            Class32DrawNodeSlot(s + n); Class32DrawNodeSlot(second + n)
 *   default: Class32DrawNodeSlot(s)
 * pop
 * ```
 *
 * The arms are `bone_parts.ts`'s table. `obj` is `g_cur_actor`.
 */
export function Class32DrawBonePart(obj: Actor, bone: number,
                                    slot: number): void {
  if (obj.cls !== SpawnClass.Boss5) return;
  const arm = CLASS32_BONE_PART_ARMS[slot];
  if (!arm) {
    Class32DrawNodeSlot(obj, bone, slot);
    return;
  }
  if (arm.flashStep) {
    obj.boss5.flash -= 1;
    if (obj.boss5.flash < 0) obj.boss5.flash = 0;
  }
  const n = G.g_frame_counter % CLASS32_BONE_PART_CELS;
  Class32DrawNodeSlot(obj, bone, arm.firstCycles ? slot + n : slot);
  Class32DrawNodeSlot(obj, bone, arm.second + n);
}

/**
 * `Class32DrawNodeSlot` — `FUN_0047FC50`. One model on the node the hook is
 * drawing.
 *
 * ```
 * if (state == 9 || (state == 10 && sub > 3)) {
 *     a = g_camera_blocks[cam] * rec(node)+0x68      ; this node's point
 *     b = g_camera_blocks[cam] * rec(8)+0x68         ; bone 8's
 *     VecToAngles(b - a, &p, &y)
 *     g_scene_light_pitch_bams = p; g_scene_light_yaw_bams = y
 *     BuildSceneLightDirection(p, y, &g_scene_light_block0, &g_scene_light_dir_view)
 *     0x009A59F8 = p; 0x009A59FC = y
 *     BuildSceneLightDirection(p, y, &g_scene_light_block1, &0x009A59EC)
 *     SetRenderLightColour(1.0, 0.781, 0.565)
 * }
 * if (obj+0x1334 > 0) SetRenderLightColour(obj+0x1334 odd ? 1.0 : 0, 0, 0)
 * (obj+0x38 & 8) && g_scene_lighting ? SubmitSlotWithSceneLightArray(slot)
 *                                    : AssetDrawSlot(slot)
 * ```
 *
 * The light is aimed from each node toward bone 8's hand, where the lunge
 * holds its projectile and the barrage gathers its own.
 *
 * **The scene-light write is not made.** The port keeps both light blocks'
 * direction on the script's `Walker` (`script/state/channels.ts`), which
 * `game/` cannot reach; the angles are computed and left on the tail
 * (`Boss5Tail.lightAngles`) and go no further. The colour is made: it is the
 * draw's own state, and the record keeps it per draw.
 *
 * Both submits draw the slot; `obj+0x38` bit 3 is written by nothing in the
 * class, so the boss is always the plain `AssetDrawSlot`.
 */
export function Class32DrawNodeSlot(obj: Boss5Actor, bone: number,
                                    slot: number): void {
  const t = obj.boss5;
  if (obj.state === Class32State.LungeAtCamera
      || (obj.state === Class32State.FinalBarrage
          && obj.sub > BARRAGE_LIT_SUB)) {
    const a = obj.skel?.bones[bone]?.hit ?? [0, 0, 0];
    const b = obj.skel?.bones[LIGHT_TARGET_BONE]?.hit ?? [0, 0, 0];
    const ang = VecToAngles(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    t.lightAngles = [FtolS16(ang.pitch), FtolS16(ang.yaw)];
    SetRenderLightColour(LIGHT_WARM[0], LIGHT_WARM[1], LIGHT_WARM[2]);
    t.drawLight = [...LIGHT_WARM];
  }
  if (t.flash > 0) {
    const r = t.flash % 2 === 0 ? 0 : FLASH_ON;
    SetRenderLightColour(r, 0, 0);
    t.drawLight = [r, 0, 0];
  }
  (t.nodeDraws[String(bone)] ??= []).push({ slot, light: t.drawLight });
}

RegisterSkeletonNodeHook(CLASS32_NODE_HOOK, Class32DrawBonePart);
