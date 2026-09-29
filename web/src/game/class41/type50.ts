/**
 * Class 0x41 constructor 50 — `PlaceTable50Props`: scenery out of one of six
 * tables in the image, every object a `PropDrawOnlyType12`.
 *
 * Six shipped descriptors, one per table, each standing at the origin because
 * the constructor never reads the spawn's position:
 *
 * | table | where | what it draws |
 * |---|---|---|
 * | 0 | stage 2 block 25 step 1 (evt `0x116C0`) | seven `komono_room.bin` models |
 * | 1 | stage 2 block 8 step 2 (`0x43DC`) | eleven `komono_room.bin` models |
 * | 2 | stage 2 block 17 step 1 (`0xBE60`) | `komono_suimonie.bin[5]`, `[6]`, `[7]` twice |
 * | 3 | stage 1 block 4 step 3 (`0x3B14`); training block 1 | `komono_st1b.bin[0]`, `[5]`, `[6]`, `[1]`, `[2]` |
 * | 4 | stage 2 block 7 step 1 (`0x3580`) | six `komono_bar.bin` models |
 * | 5 | stage 1 blocks 3 and 8, step 3 (`0x2D9C`) | `komono_st1b.bin[15]` five times |
 *
 * Table 2 is what the four class-0x13 `komono_st1.bin[3]` models of stage 2
 * block 17 stand on; table 3's five models sit on the crate the civilian of
 * stage 1's bin scene (block 6 step 1) lands on, placed at block 4 step 3 with
 * a four-step lifetime that the direct route reaches block 6 step 1 inside.
 * `[open]` what any of them depict: the names above are the files'.
 *
 * `[proved]` from `0x00463BA0`..`0x00463D14`, read in the disassembly:
 *
 * ```c
 * t = (s16)placer->+0x1F4;
 * for (i = 0, zs = g_prop_table50_scale_z; i < (s8)g_prop_table50_counts[t];
 *      i++, zs++) {                                      // count re-read each pass
 *     obj = ActorAlloc(PropDrawOnlyType12, 0x378);        // 0x00463BCE
 *     ActorClearGameFields(obj);
 *     obj->+0x11C = placer->+0x11C;                       // the step lifetime
 *     obj->+0x196 = g_evt_step_index;  obj->+0x197 = 0;
 *     obj->+0x290 = t;
 *     row = g_prop_table50_ptrs[t] + i * 0x1C;
 *     obj->+0x19C/1A0/1A4 = row.x, row.y, row.z;          // f32, copied
 *     obj->+0x1CC/1D0/1D4 = row.rx, row.ry, row.rz;       // s32 BAMS, copied
 *     obj->+0x1A8 = obj->+0x1AC = obj->+0x1B0 = 1.0f;     // MOV EAX,0x3F800000
 *     if (obj->+0x290 == 5) obj->+0x1B0 = *zs;            // 0x00463C12 CMP ..,5
 *     obj->+0x2A0 = i;
 *     obj->+0x28C = row.slot;
 * }
 * ```
 *
 * **The routine is handed to `ActorAlloc` directly**: `g_class41_updates[50]`
 * is `NoOpStub` (`0x0041EBB0`), so these objects are not a generic type 12 and
 * nothing of `PlaceGenericProp` runs for them — no radius, no `+0x34` write
 * (`ActorClearGameFields` leaves it 0), no `+0x1F4` lifetime. What they share
 * with generic type 12 is the routine, and it is the same one.
 */
import { G } from "../globals";
import { makeBreakableProp, PropFamily, type BreakableProp }
  from "./prop_state";

/**
 * The six tables `g_prop_table50_ptrs` (`0x00594F08`) points at:
 * `g_prop_table50_0` .. `g_prop_table50_5` (`0x00594AA0`, `0x00594B68`,
 * `0x00594CA0`, `0x00594D10`, `0x00594DA0`, `0x00594E48`), each as many rows
 * as `g_prop_table50_counts` (`0x00594F20`) says — 7, 11, 4, 5, 6 and 5.
 *
 * A row is 28 bytes, `{u16 slot; u16 pad; f32 x, y, z; s32 rx, ry, rz}`, the
 * angles already in BAMS. Carried here as `[slot, x, y, z, rx, ry, rz]`.
 *
 * Checked word for word against the image by `tools/verify_prop_tables.py`.
 */
export const PROP_TABLE50: ReadonlyArray<ReadonlyArray<readonly number[]>> = [
  // table 0, 0x00594AA0
  [
    [0x169e, -496.34, 41.444, -1332.726, 0x0, -0x38a2, 0x0],  // komono_room.bin[8]
    [0x169b, -495.142, 38.285, -1350.099, -0x8a3, 0x0, 0x0],  // komono_room.bin[6]
    [0x169a, -469.174, 54.337, -1324.23, 0x0, 0xc000, 0x0],  // komono_room.bin[5]
    [0x1699, -469.174, 54.339, -1334.963, 0x0, 0xc000, 0x0],  // komono_room.bin[4]
    [0x169c, -480.7, 54.998, -1350.873, 0x0, 0x0, 0x0],  // komono_room.bin[7]
    [0x169f, -493, 40.444, -1321, 0x0, 0x0, 0x0],  // komono_room.bin[9]
    [0x1698, -492, 50.444, -1303, 0x0, 0x0, 0x0],  // komono_room.bin[3]
  ],
  // table 1, 0x00594B68
  [
    [0x16a3, -461.471, 48.717, -1217.86, 0x0, 0x4000, 0x0],  // komono_room.bin[12]
    [0x16a2, -469.611, 53.022, -1261.001, 0x0, 0x0, 0x0],  // komono_room.bin[11]
    [0x16b5, -456.633, 40.585, -1249.894, 0xa59, -0x3d1d, 0x0],  // komono_room.bin[20]
    [0x16a1, -508.9, 40.8, -1213.4, 0x0, -0x864, 0x0],  // komono_room.bin[10]
    [0x16b4, -498.98, 38.933, -1253.177, 0x0, 0xdbaf, 0x0],  // komono_room.bin[19]
    [0x16a4, -502.896, 39.664, -1253.817, 0x0, 0x75bf, 0x0],  // komono_room.bin[13]
    [0x16aa, -510.961, 42.21, -1209.154, 0x5114, 0x0, 0x6231],  // komono_room.bin[18]
    [0x16a8, -503.901, 42.21, -1217.305, 0x0, 0x0, 0x86dc],  // komono_room.bin[16]
    [0x16a7, -516.875, 42.21, -1219.228, 0x0, -0x35c8, 0x2100],  // komono_room.bin[15]
    [0xfd2, -501.6, 41.826, -1205.041, -0x1a28, -0x5e9b, -0x4e3],  // komono_room.bin[0]
    [0x16a8, -516.242, 42.21, -1212.758, 0x433a, 0x0, 0x50ac],  // komono_room.bin[16]
  ],
  // table 2, 0x00594CA0
  [
    [0x1980, -668, 45, -1580.5, 0x0, 0x6000, 0x0],  // komono_suimonie.bin[5]
    [0x1982, -684.4, 45, -1560.6, 0x0, 0x0, 0x0],  // komono_suimonie.bin[6]
    [0x1983, -602.5, 38.5, -1532.5, 0x0, 0x8000, 0x0],  // komono_suimonie.bin[7]
    [0x1983, -602.5, 38.5, -1548.5, 0x0, 0x8000, 0x0],  // komono_suimonie.bin[7]
  ],
  // table 3, 0x00594D10
  [
    [0xd40, -693.816, -3.525, -536.116, -0xca1, 0x4885, 0x684],  // komono_st1b.bin[0]
    [0xd45, -695.296, -1.914, -543.362, 0x0, -0xb00, 0x0],  // komono_st1b.bin[5]
    [0xd46, -691.896, -3.394, -542.744, 0x0, -0xb00, 0x0],  // komono_st1b.bin[6]
    [0xd41, -687.737, -4.139, -542.593, 0x0, -0xb00, 0x0],  // komono_st1b.bin[1]
    [0xd42, -696.189, -2.518, -542.659, 0x0, -0xb00, 0x0],  // komono_st1b.bin[2]
  ],
  // table 4, 0x00594DA0
  [
    [0x1d7, -599.306, 43.629, -1244.179, 0x0, 0x0, 0x0],  // komono_bar.bin[7]
    [0x1d6, -599.306, 43.653, -1244.458, 0x0, 0x3839, 0x0],  // komono_bar.bin[6]
    [0x1d8, -599.306, 43.451, -1261.926, 0x0, 0x0, 0x0],  // komono_bar.bin[8]
    [0x1d9, -602.398, 44.817, -1313.727, 0x0, -0xd72, 0x0],  // komono_bar.bin[9]
    [0x1d3, -594.367, 48.125, -1316.866, 0x0, 0x937e, 0x0],  // komono_bar.bin[3]
    [0x1da, -685.022, 53.109, -1315.731, 0x0, 0x8000, 0x0],  // komono_bar.bin[10]
  ],
  // table 5, 0x00594E48
  [
    [0x17d6, -212, 20.93, -533.27, 0x0, 0x0, 0x0],  // komono_st1b.bin[15]
    [0x17d6, -363.43, 20.93, -990, 0x0, 0x11ed, 0x0],  // komono_st1b.bin[15]
    [0x17d6, -421.14, 20.93, -477.9, 0x0, 0x6ed, 0x0],  // komono_st1b.bin[15]
    [0x17d6, -556.27, 20.83, -493.46, 0x0, -0x683, 0x0],  // komono_st1b.bin[15]
    [0x17d6, -588.03, 20.83, -499.58, 0x0, -0x7bc, 0x0],  // komono_st1b.bin[15]
  ],
];

/**
 * `g_prop_table50_scale_z` — `0x00594EF0`, one f32 per row, which the
 * constructor steps through for every table and reads only for table 5: its
 * five rows' Z scale. The sixth float in the image (0.67) is never read —
 * table 5 has five rows (`L6`).
 */
export const PROP_TABLE50_SCALE_Z: readonly number[] =
  [0.6, 1, 0.5, 0.715, 0.715];

/** `CMP word ptr [ESI+0x290],0x5` at `0x00463C12` — the table that scales. */
export const TABLE50_SCALED_TABLE = 5;
/** `MOV EAX,0x3F800000` at `0x00463C9C` — every other scale. */
export const TABLE50_SCALE = 1.0;

/**
 * `PlaceTable50Props` — `FUN_00463BA0`. `g_class41_constructors[50]`.
 *
 * `table` is the placer's `+0x1F4` and `lifetime` its `+0x11C`. A table the
 * image has no row count for builds nothing, which is where the engine's
 * `(s8)` count would read the next table's bytes; the exporter refuses such a
 * placement before it reaches here.
 */
export function PlaceTable50Props(at: number, table: number,
                                  lifetime: number): BreakableProp[] {
  const rows = PROP_TABLE50[table] ?? [];
  return rows.map((row, i) => {
    const p = makeBreakableProp(G.g_breakable_next_id++, 0, 0);
    p.family = PropFamily.DrawOnlyType12;
    p.at = at;
    p.lifetime = lifetime;
    p.lastStepIndex = G.g_evt_step_index;
    p.stepsElapsed = 0;
    p.kind = table;                                  // +0x290
    p.x = Math.fround(row[1]);
    p.y = Math.fround(row[2]);
    p.z = Math.fround(row[3]);
    p.pitch = row[4];
    p.yaw = row[5];
    p.roll = row[6];
    p.restX = TABLE50_SCALE;                         // +0x1A8
    p.restY = TABLE50_SCALE;                         // +0x1AC
    p.restZ = table === TABLE50_SCALED_TABLE         // +0x1B0
      ? Math.fround(PROP_TABLE50_SCALE_Z[i]) : TABLE50_SCALE;
    p.storyItem = i;                                 // +0x2A0
    p.slot = row[0];                                 // +0x28C
    // `ActorClearGameFields` (`FUN_004A73D0`) zeroes from `+0x34` up and
    // nothing here writes it back: no live bit, no radius.
    p.flags = 0;
    p.removeFlag = 0;
    return p;
  });
}
