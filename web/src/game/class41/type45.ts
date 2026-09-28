/**
 * Class 0x41 type 45 — stage 1's two rows of banners, which **wave**: the
 * routine bends the banner models' own vertices every frame.
 *
 * One shipped descriptor (`0x2D74`), placed by stage 1 block 3 step 4, block
 * 4 step 0 and block 8 step 4, at the origin with a seven-step lifetime. The routine never reads its position:
 * every model is drawn at a world literal out of two tables in the image.
 *
 * What it draws, all `komono_st1b.bin`: four banner models `0x1731..0x1734`
 * (entries 7..10) placed eleven times, and `0x1735` (entry 11) twice.
 * "Banner" is `[likely]` and from one fact only — the routine displaces each
 * vertex in Z by an amount proportional to its own Y, phase-lagged down Y,
 * which is how a cloth hung from its top edge is waved. `[open]` what
 * `0x1735` is; it stands at the positions of rows 2 and 7.
 *
 * The whole routine, `0x0046DAB0`..`0x0046DD36`. Ghidra's pseudocode has the
 * table walk inside out and stops at the first `MatrixStackPop` it meets
 * (`L37`), so everything below is the disassembly:
 *
 * ```c
 * s16 wave[4] = { 0x1731, 0x1732, 0x1733, 0x1734 };      // [ESP+0x8..0x14]
 * if ((s16)g_evt_step_index != (s8)obj->+0x196) {         // inline lifetime
 *     if ((s16)obj->+0x11C < (s8)++obj->+0x197) { ActorKill(); return; }
 *     obj->+0x196 = g_evt_step_index;
 * }
 * if (g_evt_block_index == 0xE) { ActorKill(); return; }  // CMP word, 0x0046DB1A
 * if (g_active_cam_path == 0x2A && g_cam_path_frame == 500)
 *     obj->+0x2A0 = 1;                                    // 0x0046DB43
 * for (row = 0; row < 11; row++) {                        // ESI 0x5949F8.., EDI 0x594A50..
 *     if (row < 5 && obj->+0x2A0 == 0) continue;          // CMP ESI, 0x594A20
 *     MatrixStackPush(0);
 *     MatrixTranslate(pos[row].x, 65.0, pos[row].z);      // PUSH 0x42820000
 *     MatrixRotateY(row < 5 ? 0x145E : 0x3C4D);
 *     AssetDrawSlot(slot[row]);
 *     MatrixStackPop(1);
 * }
 * MatrixStackPush(0); MatrixTranslate(-515.822, 65.0, -454.822);   // 0xC400F49C 0xC3E36937
 * MatrixRotateY(0x3C4D); AssetDrawSlot(0x1735); MatrixStackPop(1);
 * MatrixStackPush(0); MatrixTranslate(-654.798, 65.0, -504.367);   // 0xC423B312 0xC3FC2EFA
 * MatrixRotateY(0x145E); AssetDrawSlot(0x1735); MatrixStackPop(1);
 * for (k = 0; k < 4; k++) {                               // EDI = 5k, 0x0046DC37
 *     rec = 0x009A66A0 + wave[k] * 0x10;                  // the slot's record
 *     if (rec->flags & 0x8000)                            // TEST byte [rec+0xD], 0x80
 *         for each strip vertex v of rec->model:          // bit 0 of its first dword
 *             if ((lag = ftol(v.y)) != 0)
 *                 v.z = v.y * -0.1f                       // [0x0056470C]
 *                     * sin((((5k - lag) << 9) + obj->+0x1D0) & 0xFFFF);
 *     obj->+0x1D0 = (obj->+0x1D0 + 0x200) & 0xFFFF;       // 0x0046DD0C
 * }
 * ```
 *
 * `pos` is `{f32 x, z}[11]` at `0x005949F8` and `slot` is `s16[11]` at
 * `0x00594A50`, back to back, both read out of the image into
 * {@link TYPE45_ROWS}. The first five rows — one line of banners at yaw
 * `0x145E` — are hidden until **camera path `0x2A` reaches frame 500**, and
 * the other six, a second line at `0x3C4D`, stand from the start. Block
 * `0xE` takes them all away, and so does the lifetime.
 *
 * The wave walks each resident model's strips, from `model + 0x18`, much as
 * `WalkMeshChainAndDraw` (`FUN_004A7EF0`) does (`docs/formats/nl1.md`) but
 * without the triangle-list `* 3` or the mesh size: a negative dword is a
 * 0x50-byte mesh header, zero
 * ends the model, a positive one is a strip header whose second dword is the
 * record count, and a record is 32 bytes when bit 0 of its first dword is
 * set and 8 otherwise — only the 32-byte ones are touched. `+0x1D0` — the
 * prologue's yaw, which no draw here reads — is the wave's clock: `0x200`
 * per model and so `0x800` a frame, one cycle every 32 frames.
 *
 * **The bend is the model's, not the draw's.** It rewrites the four models'
 * vertex data in place, so every draw of them anywhere shows it and it stays
 * after the object has gone. The port steps the clock here exactly as the
 * engine steps it and keeps, per model, the clock it was last bent at
 * (`G.g_prop45_wave_clock`) and the one it had when this frame's draws were
 * submitted (`G.g_prop45_wave_clock_drawn`) — the model's state, which is the
 * engine's, reduced to the one number the walk writes it from.
 * `render/banner_wave.ts` walks the vertices, as `render/water_surfaces.ts`
 * walks the canal's for `WaterSurfaceUpdate`.
 *
 * **Which frame's bend a draw shows depends on the mesh's pass.** The draws
 * are submitted before the bend. `RenderEnqueueCommand` (`FUN_004A7E50`)
 * walks a model's opaque-pass meshes at submission and queues the rest for
 * `RenderFlushCommandList` (`FUN_004A88E0`) at the frame's end
 * (`render/draw_order.ts`), so an opaque mesh is drawn with the vertices the
 * previous frame bent and a translucent one with this frame's `[likely]` —
 * from where the two passes read the vertex data, not from a capture. The two
 * clocks are those two states.
 *
 * No hit arm, no `AND` on `obj+0x34`, no `RegisterForShotTest`: they cannot
 * be shot.
 *
 * `[proved]` all of it from `disassemble_bytes 0x0046DAB0..0x0046DD40` and
 * the two tables; the switch sends type 45 to its default (`0x004628CD`), so
 * `PlaceGenericProp` has no arm for it.
 */
import type { Events } from "../../core/events";
import type { Rng } from "../../core/rng";
import { G } from "../globals";
import { MatrixRotateY, MatrixTranslate } from "../matrix";
import { ActorKillProp } from "./prop";
import { PropDrawBegin, PropDrawSlot, PropMatrixPush } from "./prop_draw";
import type { BreakableProp } from "./prop_state";

/** `CMP word [0x009A2BC0], 0xE` — the block that takes them away. */
export const TYPE45_REMOVE_BLOCK = 0xe;
/** `g_active_cam_path` and `g_cam_path_frame` that raise the first row. */
export const TYPE45_SHOW_CAM_PATH = 0x2a;
export const TYPE45_SHOW_CAM_FRAME = 500;

/** `PUSH 0x42820000` — every model's height. */
export const TYPE45_Y = 65.0;
/** The first row's yaw, and the second's (`PUSH 0x145E` / `PUSH 0x3C4D`). */
export const TYPE45_ROW_A_YAW = 0x145e;
export const TYPE45_ROW_B_YAW = 0x3c4d;
/** `CMP ESI, 0x594A20` — the rows before this are the hidden line. */
export const TYPE45_HIDDEN_ROWS = 5;

/**
 * `0x005949F8` `{f32 x, z}[11]` and `0x00594A50` `s16[11]`, read as the
 * image holds them: each value is the float32 the bytes decode to.
 */
export const TYPE45_ROWS: ReadonlyArray<readonly [number, number, number]> = [
  [-668.6859741210938, -496.7829895019531, 0x1731],   // e72b27c4 3964f8c3
  [-661.010986328125, -500.97198486328125, 0x1732],   // b44025c4 6a7cfac3
  [-654.7979736328125, -504.36700439453125, 0x1733],  // 12b323c4 fa2efcc3
  [-645.0750122070312, -509.67999267578125, 0x1734],  // cd4421c4 0ad7fec3
  [-633.7160034179688, -515.8820190429688, 0x1731],   // d36d1ec4 73f800c4
  [-515.2570190429688, -439.0610046386719, 0x1732],   // 73d000c4 cf87dbc3
  [-514.4639892578125, -447.76800537109375, 0x1731],  // b29d00c4 4ee2dfc3
  [-515.822021484375, -454.8219909667969, 0x1733],    // 9cf400c4 3769e3c3
  [-515.8179931640625, -465.8489990234375, 0x1734],   // 5af400c4 acece8c3
  [-511.6440124511719, -478.739013671875, 0x1731],    // 6fd2ffc3 985eefc3
  [-510.8900146484375, -487.02801513671875, 0x1732],  // ec71ffc3 9683f3c3
];

/** `0x1735` — `komono_st1b.bin[11]`, drawn twice after the rows. */
export const TYPE45_POST_SLOT = 0x1735;
/**
 * The two `0x1735` draws' `PUSH imm32` positions and yaws: row 7's position
 * at the second line's yaw, then row 2's at the first's.
 */
export const TYPE45_POSTS: ReadonlyArray<readonly [number, number, number]> = [
  [-515.822021484375, -454.8219909667969, TYPE45_ROW_B_YAW],    // c400f49c c3e36937
  [-654.7979736328125, -504.36700439453125, TYPE45_ROW_A_YAW],  // c423b312 c3fc2efa
];

/** The four models the wave bends, the routine's own stack array. */
export const TYPE45_WAVE_SLOTS: readonly number[] =
  [0x1731, 0x1732, 0x1733, 0x1734];
/** `ADD EAX, 0x200` — the clock's step per model walked. */
export const TYPE45_WAVE_CLOCK_STEP = 0x200;
/** `ADD EDI, 5` — model `k`'s phase lead, in units of `1 << 9`. */
export const TYPE45_WAVE_MODEL_LEAD = 5;
/** `SHL ECX, 9` — BAMS per unit of lead and per unit of vertex Y. */
export const TYPE45_WAVE_SHIFT = 9;
/** `FMUL [0x0056470C]` — `0xBDCCCCCD`, the displacement per unit of Y. */
export const TYPE45_WAVE_AMPLITUDE = Math.fround(-0.1);

/** The clock of a model no bend has touched: its vertices are as authored. */
export const TYPE45_WAVE_UNBENT = -1;

/**
 * `PropUpdateType45` — `FUN_0046DAB0`. One prop, one 60 Hz frame.
 *
 * `+0x2A0` is {@link BreakableProp.storyItem} — to this routine, "the first
 * line is up" — and `+0x1D0` {@link BreakableProp.yaw}, the wave's clock.
 */
export function PropUpdateType45(p: BreakableProp, _rng: Rng,
                                 _events?: Events): void {
  PropDrawBegin(p);
  // The inline lifetime, `ActorKill` (`FUN_004A7040`) and no scene-1 sweep.
  if (G.g_evt_step_index !== p.lastStepIndex) {
    p.stepsElapsed += 1;
    if (p.lifetime < p.stepsElapsed) {
      ActorKillProp(p);
      return;
    }
    p.lastStepIndex = G.g_evt_step_index;
  }
  if (G.g_evt_block_index === TYPE45_REMOVE_BLOCK) {
    ActorKillProp(p);
    return;
  }
  if (G.g_active_cam_path === TYPE45_SHOW_CAM_PATH
      && G.g_cam_path_frame === TYPE45_SHOW_CAM_FRAME) {
    p.storyItem = 1;
  }

  for (let row = 0; row < TYPE45_ROWS.length; row++) {
    const hidden = row < TYPE45_HIDDEN_ROWS;
    if (hidden && p.storyItem === 0) continue;
    const [x, z, slot] = TYPE45_ROWS[row];
    const m = PropMatrixPush();
    MatrixTranslate(m, x, TYPE45_Y, z);
    MatrixRotateY(m, hidden ? TYPE45_ROW_A_YAW : TYPE45_ROW_B_YAW);
    PropDrawSlot(p, m, slot);
  }
  for (const [x, z, yaw] of TYPE45_POSTS) {
    const m = PropMatrixPush();
    MatrixTranslate(m, x, TYPE45_Y, z);
    MatrixRotateY(m, yaw);
    PropDrawSlot(p, m, TYPE45_POST_SLOT);
  }

  // The wave's clock steps once per model whether or not the model is
  // resident -- the not-resident jump lands on the step (`0x0046DD02`).
  for (let k = 0; k < TYPE45_WAVE_SLOTS.length; k++) {
    // The vertex rewrite of `TYPE45_WAVE_SLOTS[k]` at this clock: the model's
    // state, walked by `render/banner_wave.ts`. The draws above were
    // submitted against the bend before it.
    G.g_prop45_wave_clock_drawn[k] = G.g_prop45_wave_clock[k];
    G.g_prop45_wave_clock[k] = p.yaw;
    p.yaw = (p.yaw + TYPE45_WAVE_CLOCK_STEP) & 0xffff;
  }
}
