# `evt/` event tables

**Status:** solved structurally. The relocation scheme, the container, the
routing graph and the bytecode are all recovered; 16,991 instructions across all
13 files decode with zero errors. What remains is *semantics* — most opcodes are
identified only by which global they touch.

Implemented in [`tools/hod2lib/evt.py`](../../tools/hod2lib/evt.py); checked by
`tools/verify_phase6.py`.

The files are raw Dreamcast RAM images. They are not serialised: they contain
absolute SH-4 pointers, and the PC port patches them at load.

## The fixup — solved

`FUN_00413120` at `0x00413120`, called on the whole buffer right after
`ReadFile`:

```c
void evt_relocate(u32 *p, int n_dwords) {
    for (; n_dwords; n_dwords--, p++)
        if ((*p & 0xFFF80000) == 0x0CE80000)
            *p += 0xF3AC1A00;            /* i.e. -= 0x0C53E600 */
}
```

That is the entire scheme. **Any dword in the 512 KB window
`0x0CE80000..0x0CEFFFFF` is a pointer; everything else is payload.** There is no
relocation table and no tagging — the format simply relies on no genuine
non-pointer ever landing in that window.

This is what the earlier analysis could not have guessed from the data: the
`0x0Cxxxxxx` heuristic in the old notes was far too wide. The exact mask cuts
the candidate set down to something that is **99.95 % dword-aligned** (6619 of
6622 across all files) — a coincidence rate that confirms the mask is right.

Two buffers receive event data at fixed PC addresses:

| Buffer | PC address | Dreamcast address |
|---|---|---|
| `comevtbl.bin` | `0x00977200` | `0x0CEB5800` |
| the current scene's table | `0x00977400` | `0x0CEB5A00` |

So a pointer maps to a file offset by subtracting the DC base of its buffer.
`comevtbl` gets 0x200 bytes immediately before the scene table, and scene tables
**do** point back into it (offsets as low as −460), which answers the old
question about whether the two link: they do.

### The "span problem" was an artefact

The old note recorded pointer spans of 4× and 160× the file size. Those were
computed over all `0x0Cxxxxxx`-looking dwords. Under the real mask every
in-range dword in every file resolves to a sane offset, and the walk closes.

## Loader

| Address | Role |
|---|---|
| `0x00413070` | loads `comevtbl.bin` into `0x00977200`, relocates, then loads the scene table |
| `0x00413160` | loads `evt\<scene table>` into `0x00977400`, relocates; early-outs if already loaded |
| `0x00413120` | the relocation pass |

Filenames come from the table at `0x004D1C7C`, indexed through a
scene → file-index table at `0x00579928`.

## Scenes

Everything is keyed by a small **scene id** in `DAT_009A1A08`:

| Scene | evt file | Blocks |
|---|---|---|
| 0 | `st1evtbl.bin` | 17 |
| 1 | `st2evtbl.bin` | 42 |
| 2 | `st3evtbl.bin` | 18 |
| 3 | `st4evtbl.bin` | 30 |
| 4 | `st5evtbl.bin` | 10 |
| 5 | `st6evtbl.bin` | 15 |
| 6 | `trnevtbl.bin` | 20 |
| 7 | — (inline stub inside `comevtbl`) | — |
| 8 | — | 1 |
| 9 | `endevtbl.bin` | 8 |
| 10 | `advevtbl.bin` | 1 |
| 11 | `adv2evtbl.bin` | 1 |

`st1evtbl - Copy.bin` is a stray duplicate and is not referenced.

## Container

Three levels of indirection, read by `FUN_0045EB60/70/90`:

```
comevtbl[scene]            -> block table for that scene   (FUN_0045EB60)
block_table[block]         -> step table                   (FUN_0045EB70)
step_table[step]           -> bytecode stream              (FUN_0045EB90)
```

The first 12 dwords of `comevtbl.bin` are the per-scene roots. For a scene with
its own file the entry is `0x0CEB5A00` — the start of the scene buffer — so the
scene table *begins* with its block-pointer array.

**`-1` in the root array is a hole, not a terminator.** A scene whose route
graph never visits block *i* stores `-1` there. Sizing the array by stopping at
the first `-1` loses blocks (17 → 15 for stage 1). Two independent ways to get
the real count, which agree on all 10 files:

- scan while entries are pointer-or-hole (what `hod2lib` does by default);
- read the length of the scene's route table out of `Hod2.exe`.

## Stage routing

`0x00597890` is a scene-indexed pointer to a **route table** — the flow graph
between blocks, and the mechanism behind the game's branching paths. Read by
`FUN_0045F000` when a block's step list runs out. Records are 8 bytes:

```
+0x00  s16 kind      0 = go to next[0]
                     1 = branch, take next[branch_choice]
                     2 = end of scene
+0x02  s16 next[0]
+0x04  s16 next[1]
+0x06  s16 next[2]
```

`branch_choice` is `DAT_009C88A4`, reset to 0 on every block change. Stage 2 has
42 route nodes with 15 branch points — comfortably the most branch-heavy stage,
which matches the game.

Exposed as `ExeTables.scene_routes(scene)`.

## Bytecode

`FUN_0045ECC0` is the interpreter:

```c
do {
    op = *pc;
    dispatch[op]();          /* 96 handlers at 0x005931D8 */
} while (!yield);
```

Everything is dword-granular: an instruction is one opcode dword followed by
operands. Each handler advances `pc` itself, so operand length is per-opcode.
The full table is transcribed in `evt.OPCODES`; the length classes are:

| Class | Encoding |
|---|---|
| `fix` | fixed number of dwords |
| `list` | `[op][arg …][-1]` |
| `var` | several `-1`-separated lists, whole run closed by `-2`; a global picks which list runs |
| `queue` | `[op][selector][args]`, length `2 + (selector >> 4)` dwords |
| `set` / `tween` | `[op][sub-op][…]`, length depends on the sub-opcode |
| `halt` / `next` | terminators |

Five dispatch slots (`0x00`, `0x2A`, `0x34`, `0x3C`, `0x4C`) point at an empty
stub. **No shipped file ever encodes one** — a useful integrity check, since a
mis-sized instruction would land on a stub or an out-of-range opcode almost
immediately. 76 distinct opcodes are actually used.

### The VM's own machinery

**[proved]**

| Global | Role |
|---|---|
| `DAT_009C7108` | program counter; every token is a dword |
| `DAT_009C8EA0` | yield flag. **Not cleared at loop entry**, so a handler that leaves it set *and does not advance `pc`* means "still waiting" |
| `DAT_009A1A04` | current opcode, stored before dispatch. Handlers take **no arguments** |
| `DAT_007DCCA4` | "script may advance" gate, recomputed every call: gameplay is live (a player in state 5 with credits, or `FUN_00413280()`). Nearly every wait opcode requires it |

There is a hardcoded special case at `0x0045ED45`: in scene 5 with
`DAT_009A3400 == 2`, a `wait_script_flag 0x13` immediately ahead of `pc` is
skipped outright.

### Opcode reference

Confidence is marked per row. **[proved]** = the code was read end to end;
**[likely]** = the mechanism is proved but the human-readable name is an
inference; **[open]** = undetermined.

| Op | Name | Meaning |
|---|---|---|
| `01`–`08` | `spawn_*_if_1p` / `_if_2p` | **[proved]** the four spawn opcodes behind a player-count gate and nothing else. `EvtOpSpawnIfOnePlayer` (`0x00408820`) and `EvtOpSpawnIfTwoPlayers` (`0x00408860`) test `g_max_attackers` against 1 or 2 and either tail-jump into `g_evt_spawn_gated_handlers` (`0x00577650`) — indexed by the opcode, holding `09`/`0A`/`0B`/`0C` twice — or walk the operand list to its `-1` and skip it. Same descriptors, same allocators. The two lists **overlap** rather than replace: stage 1 block 0 step 2 gives `07` three class-0x30 zombies and `03` the last two of that same three, so the second player adds one. Only `03`/`04` and `07`/`08` are ever encoded. ⚠️ the old name `spawn_if_mode*` guessed at a difficulty or game mode; the gate is the live player count |
| `09` | `spawn_placed` | the main enemy placement opcode |
| `0A`–`0D` | `spawn_*` | same descriptor, different object base class |
| `0E` | `set_approach_rings` | **[proved]** `g_enemy_approach_rings[op0][0..2] = op1..op3` as **floats** — three XZ distances from the camera. 6 dwords; a 4th ring operand is read and discarded. ROM defaults `{25,38,51}` ×3 and `{37,48,51}` |
| `0F` | `set_approach_steps` | **[proved]** `-1`-terminated list of small ints into `g_enemy_approach_steps`; defaults `{2,3,4}` |
| `10` | `set_collision_set_full` | **[proved]** `-1`-terminated list of **relocated absolute pointers** to collision-mesh blobs. Consulted by both the ray and the sphere queries |
| `11` | `set_collision_set_ray_only` | **[proved]** same, but consulted by the ray queries only — **[likely]** shoot-through scenery that does not block movement |
| `12` | `set_approach_steps_2p_bias` | **[proved]** as `0F`, plus `+1` when two players are in play |
| `13` | `set_scene_lighting_override` | **[proved]** 5-entry list → `(enable, light r, g, b, ambient)`, feeding one lighting-override call |
| `14` | `set_scene_lighting` | `DAT_009A2BB4`; also gates `15` and `16` |
| `15` | `enable_entity_spotlights` | **[proved]** one `D3DLIGHT7` **spotlight per entity** (theta = phi = π/8, falloff 1, attenuation0 0.5) into the 16-entry array at `0x009A1A20`. Only effective when `14` is on |
| `16` | `set_ambient_light_rgb` | **[proved]** 4 dwords: three float refs → the D3D ambient colour. ⚠️ the old name `set_fog_or_clear3` was wrong — nothing on this path touches fog |
| `17` | `slerp_light0_direction` | **[proved]** `(target_pitch, target_yaw, frames)`; spawns a task that **slerps** light 0's direction. Fire-and-forget — the VM does not wait |
| `18` / `19` | `set_light0/1_direction` | **[proved]** `(pitch, yaw)` in BAMS on scene light block 0 / 1 |
| `1A` | `set_ground_plane_y` | **[proved]** `g_ground_plane_y`. `QueryGroundHeightAt` returns it when a downward ray misses, and it is the plane blob shadows project onto. Also the value opcode `36` pins the view pose to |
| `1B` | `set_backdrop_preset` | **[likely]** index 0–11 into a 12 × 16-byte table at `0x00579968` `{s16 assetA, s16 assetB, f32 dy, s32 spin, s32 angle0}` — a camera-following dome at dy 0…−3000. Presets 8, 10, 11 also scroll V by −0.005/frame. "sky" is inference |
| `1C` | `set_backdrop_mode` | **[proved]** 0 = off, 2 = drawn but frozen, else drawn and animating. The mode selector for `1B` |
| `1D` | `enable_rain` | **[proved]** `FUN_004136A0`: 50 particles falling 2.0/frame in a camera-attached volume, drawn as asset `0x53` at alpha 0.5 in draw layer `0xE`. See below. Also swaps the impact effect to a wet variant. "rain" is still inference from the fall speed and the 3.5× vertical stretch |
| `1E` | *(dead)* | **[proved]** `DAT_009C8A78` has **no readers anywhere in the binary**. Vestigial; its intent is unrecoverable |
| `1F` | `set_hud_shutter_state` | **[proved]** 9 states. Draws asset `0x93E` at view-space `y = ±0.35, z = −1.0` — and that positions the quad's **origin**: `0x93E` is `common.bin` model 129, a four-vertex quad 1.03 × 0.10, so a closed bar spans 0.30–0.40 and its inner edge is at 80 % of the 0.3748 frustum half-height, a 10 % letterbox. Also drives `DAT_009C8E00`, the gate on firing and ammo decrement: 1 in states 0/1/6, 0 in state 5 and when a state-3 close completes. State 8 scales the bar `(1, 8, 1)` for a full blackout |
| `20`–`27` | **fog / light tweens** | see the correction below |
| `28` / `29` | `region_load` / `region_enter` | stage geometry streaming; see [`pipeline.md`](pipeline.md) |
| `2B` | `award_accuracy_bonus` | **[proved]** `pct = hits*100/shots` (needs shots > 0x13), bonus = `g_accuracy_bonus_table[pct/10]` = `{0,0,0,0,500,1000,1500,2000,2500,3000,4000}` |
| `2C` | `set_skippable_region` | **[proved]** `arg != 0` → `DAT_009A2230 = 0; DAT_009A2D7C = 1`; `arg == 0` → `DAT_009A2D7C = 0` and the skip flag is cleared. `DAT_009A2D7C` is live and read; the flag it would eventually raise is not — see below |
| `2D` | `play_dialogue` | **[proved]** u16 group → variant by player configuration (0 = 1P/P1, 1 = 1P/P2, 2 = 2P), then a voice line **and up to four timed subtitle lines**. See below |
| `2E` | `resume_bgm_if_skipped` | **[proved]** `if (skip) PlaySoundId(0x80000002)` — restart the BGM a skipped cutscene interrupted. Unreachable in this build; see below |
| `2F` | `suppress_accuracy_stats` | **[proved]** non-zero stops the shots/hits counters that `2B` grades |
| `30` | `queue_event` | the scripted-action ring — see below |
| `31` | `goto_scene_state` | **[proved]** the end-of-room instruction. Enters `(1, op0)` — and **all 548 sites pass 3**, `CameraFromViewAngles` — parks `g_evt_action_handler` on a bare `RET`, tearing down the driver the `finish_sequence` installed, and **decrements `g_queued_events_pending`**, which is how selector `0x21` gets retired. Also clears `g_evt_cam_override_valid`, `g_camera_ease_eye` and bit 0 of both players' flags |
| `32` | `goto_scene_state_when_alive` | **[proved]** as `31` but **minus the `g_evt_cam_override_valid` and `g_camera_ease_eye` clears**, and it parks on the instruction — setting `g_evt_yield` and re-running each frame — until a player is outside the death → continue → revive chain (`g_player_state_table[state] + 0x10`) or still has lives |
| `33` | `set_action_drain_mode` | **[proved]** `g_evt_action_advance = op0; g_queued_events_pending += op1`, a signed add. Mode 1 = dequeue and run in the same frame, 2 = dequeue but defer a frame. **All 128 in the game carry delta −1**, cutting a running `cam_play` short so the `finish_sequence` queued behind it can start |
| `35` | `enable_camera_path_roll` | **[proved]** `CamEvalPath7` evaluates curve channel 6 (roll/bank) **only when this is set**; otherwise roll is forced to 0 |
| `36` | `pin_view_to_ground_plane` | **[proved]** makes all four camera hooks take `eye.y` from `g_ground_plane_y` (opcode `1A`) instead of `path.y − 15` |
| `37` | `force_camera_path_advance` | **[proved]** advances the camera path every frame, bypassing the "room cleared" gate |
| `38`–`3B` | `se_play*` | sound effects |
| `3D` / `3E` | `nop` | **[proved]** pure no-ops, `pc += 0x10` / `0x08` |
| `3F` / `5B` / `5C` | `nop` | **[proved]** all three share **one** handler that is opcode-blind (`ADD [pc],4; RET`) — identical retired 0-operand opcodes |
| `40` | `wait_queued_events_done` | **[proved]** `g_queued_events_pending == 0`. `queue_event` adds one per action and every handler takes one back on completion **except `EvtActionFinishSequence21`**, which never retires itself — `31`/`32`/`33` do it for it |
| `41` | `wait_camera_path_frame` | **[proved]** operand 0 = wait for the end of the path; otherwise wait until the path frame passes the operand |
| `42` | `wait_frames` | **[proved]** countdown; only decrements while the gate is open, and `FUN_00499530` can clamp it downward to shorten a wait in progress |
| `43` | `wait_enemies_present` | **[proved]** `g_enemies_present <= op`, and the camera has settled |
| `44` | `wait_enemies_alive` | **[likely]** `g_enemies_alive <= op`, plus one frame of hysteresis. The two counters differ because `alive` drops at kill time and `present` at death-animation end, so `present >= alive` |
| `45` | `wait_script_flag` | **[proved]** `g_script_flags[op]` — a 256-byte array at `0x009C7200` |
| `46` | `wait_scripted_actors` | **[proved]** `g_civilians_alive <= op` — the **class-0x10 civilians**. Byte for byte the `43` handler on a different counter, and all 68 sites in the game pass operand 0, so it is always "wait for the last civilian to leave play" |
| `47` | `wait_targets_clear` | **[likely]** camera settled and no live targetable entity registered. Depends on intra-frame task ordering that was not resolved |
| `48` | `set_script_flag` | **[proved]** the writer half of `45` |
| `49`–`4B` | `variant_*` | pick an operand list by a global |
| `4D` | `checkpoint` | **[proved]** appends the current room id to the per-stage route history consumed by the stage-clear route map; reseeds the CRT RNG with **0** during gameplay (so runs are deterministic); restores the default per-class enemy approach rings |
| `4E` / `4F` | `halt` / `end_block` | |
| `50`–`57` | `asset_*` | streaming vocabulary; see [`pipeline.md`](pipeline.md) |
| `58` | `asset_wait_all_jobs` | **[proved]** run every queued asset job to completion |
| `59` | `asset_wait_tex_pol_jobs` | **[proved]** drain only job types < 8 (`tex\` and `pol\`); motion jobs are compacted and left pending |
| `5A` | `asset_wait_motion_jobs` | **[proved]** drain only job types 8–10 (`mot\`) |
| `5D` / `5E` | `snd_load/free_pack` **(stub)** | **[proved]** `OutputDebugStringA("SS_SndLoadPack")` and nothing else — NAOMI sound-driver calls stubbed out for the PC port, which streams individual `.wav` files |
| `5F` | `bgm_entry_play` | **[proved]** consumes 4 operands but uses **only the third**: stop the current BGM, then play that track id |

### The skip feature

**[proved]** "Press Start to skip a cutscene" is complete and working in the
retail build.

1. `set_skippable_region` (`2C`) opens the window: `DAT_009A2D7C = 1`, and
   `DAT_009A2230 = 0`.
2. Both player-update routines, `FUN_00414940` and `FUN_00414B90`, end with the
   same block:

   ```c
   if (DAT_009C8E00 == 0 && DAT_009A2D7C != 0) {   // gate down, region open
       mask[0] = 0x2; mask[1] = 0x20000;           // Start, player 1 / player 2
       if (mask[player] & _DAT_009C9028) DAT_009A1A18 = 1;
   }
   ```

   The gate `DAT_009C8E00` is the one `1F`'s shutter machine drives, so a skip
   is only offered while the letterbox is closed — which is the definition of
   "not currently playable".
3. `CheckCutsceneSkipRequest` (`0x00435F40`), a standing task installed from the
   table at `0x005934E4`, turns the request into the flag:

   ```c
   if (g_skippable_region == 0) { task_end(); return; }
   if (g_skip_requested) {
       if (cam_end != cam_frame) cam_end = cam_frame;   // end the move here
       g_skip_requested = 0;
       g_skip_flag      = 1;
       DAT_009A2230     = 1;
       AssetDrainAllJobs();
       *task = FinishCutsceneSkip;                      // clears 2230, ends
   }
   ```

   The camera line is worth reading carefully: `DAT_009A6148` is the end frame
   and `DAT_009A6144` the current one (`CamAdvancePathFrame`), so the skip
   **ends the current camera move where it stands** rather than fast-forwarding
   it to the end of the path. That retires the queued event, which is what lets
   `40` fall through. `AssetDrainAllJobs` is there because the waits that would
   have covered the streaming are about to be skipped past.
4. With the flag up, every consumer opens by testing it:

   | Opcode | With the flag raised |
   |---|---|
   | `30` `queue_event` | drops the action and advances past its operands |
   | `40` / `41` / `42` | fall straight through |
   | `0D` `spawn_obj_unless_skip` | consumes its `-1`-terminated list, spawns nothing |
   | `3A` / `3B` `se_play*_unless_skip` | do not play |
   | `2D` `play_dialogue` | no voice, no subtitle task — and `DrawDialogueSubtitleTask` ends a line already on screen |
   | `2E` `resume_bgm_if_skipped` | `PlaySoundId(0x80000002)` |

   With nothing queued and every wait passing through, the interpreter races to
   the end of the region.
5. `set_skippable_region(0)` clears the flag. It is *not* cleared by the waits,
   so one press skips the whole region rather than a single wait.

> ⚠️ **Correction.** Earlier revisions of this document recorded the feature as
> "entirely dead code", then as "complete except for one assignment", on the
> grounds that `DAT_009A2D74`'s only two xrefs both store 0 and `DAT_009A1A18`
> had no readers. Both conclusions came from the same mistake:
> `CheckCutsceneSkipRequest` is reached only through a function pointer, so
> Ghidra had never disassembled it and it appeared in no xref list. Scanning
> the raw image for the little-endian address of `DAT_009A1A18` finds **five**
> occurrences where the xref search found two. An absent xref is evidence about
> the disassembly, not about the program.

### `1F` — the shutter's nine states

| State | What it does | `DAT_009C8E00` |
|---|---|---|
| 0 | close, and enable firing | 1 |
| 1 | open over 40 frames | 1 |
| 2 | open — nothing drawn | — |
| 3 | close over 40 frames, then disable firing | 0 on completion |
| 4 | hold closed (unless `DAT_009A5900 & 0x30`) | — |
| 5 | close, and disable firing | 0 |
| 6 | open at once, and enable firing | 1 |
| 7 | restore the previous state (`DAT_009C8E9C`) | — |
| 8 | full blackout — the bar scaled `(1, 8, 1)` | — |

States 0 and 5 both draw a closed shutter and set the gate to 1 and 0
respectively, which is the whole reason the gate is a separate global: a
letterboxed moment can still be playable.

`hod2lib.script` attaches these readings to the instruction as `means` and
`firing_gate`, so the player shows "5 — close, and disable firing" rather than
"5".

### `1D` — the rain, read out

**[proved]** `FUN_004136A0`, in full:

```c
if (rain_enabled == 1) {
  SetDrawLayerNibble(0xE);
  for (p = 0x007C1EB8; p < 0x007C2114; p += 3 floats) {   /* 50 particles */
    p.y -= 2.0;
    if (p.y <= -7.0) {                       /* respawn */
      p.x = rand() % 0x14 - 10.0;            /* [-10,  9] */
      p.y = rand() % 0x32 - 25.0;            /* [-25, 24] */
      p.z = rand() % 0x19 - 35.0;            /* [-35,-11] */
    }
    world = RotY(g_camera_pose[player].yaw) * p + g_camera_pose[player].eye;
    yaw   = angle_of(world - eye, with dy passed as a literal 0);
    Translate(world); RotateY(yaw); RotateZ(0x100); Scale(1.5, 3.5, 1.0);
    AssetDrawSlotAlpha(0x53, 0.5);
  }
  SetDrawLayerNibble(8);
}
```

The particle count is **not stored**: the array runs `0x007C1EB8` to
`0x007C2114` at 12 bytes each, which is 50.

Three details are worth stating because they are not what a from-scratch
particle system would do:

- The volume is rotated by the camera's **yaw only** before the eye is added,
  so it follows where the camera looks horizontally while staying
  world-vertical. Rain never tilts when the camera pitches.
- The spawn box is 20 × 50 × 25 sitting **in front of** the camera — `z` runs
  −35 to −11 — so drops are only ever created ahead of the view.
- The per-drop yaw is computed with the vertical component passed as a literal
  `0`, so a drop's facing does not change as it falls.

Asset slot `0x53` is `stage1.bin[0]`. **No region draws it and no asset opcode
loads it** — the effect routine names the slot as a literal, so anything
reconstructing the scene has to pull it in explicitly or the effect has no
model.

**[measured]** Only stage 1 ever turns rain on: 18 `enable_rain 1` in
`st1evtbl`, and every other stage's uses are all `0`.

### `1B` / `1C` — the backdrop dome, read out

**[proved]** The draw lives at `0x004132D0`, in a block Ghidra leaves
undefined (no function is created there, so it does not appear in any xref
listing by name). Transcribed:

```c
esi = &g_camera_pose[player];                  /* 0x009A60C0 + player*0x69 */
if (preset != last_preset) { angle = table[preset].angle0; last = preset; }
if (backdrop_mode == 0) return;                /* 0x1C == 0 is off */

MatrixStackPush(0);
MatrixTranslate(esi->x, esi->y + table[preset].dy, esi->z);
if (backdrop_mode != 2) angle += table[preset].spin;   /* 2 = drawn, frozen */
if (preset == 5) { MatrixRotateZ(0x8000); MatrixRotateY(-angle); }
else               MatrixRotateY(angle);
MatrixScale(1.2f, 1.2f, -1.2f);
AssetDrawSlot(table[preset].slot_a);
```

Two details are easy to miss and both matter:

- **It follows the camera in all three axes**, not just horizontally, so it
  can never be approached.
- **The Z scale is negative.** The dome is turned inside out — it is modelled
  to be seen from within.

`angle` and `spin` are BAMS; the shipped spins are 0, 1, 2, 4 and 12 per
frame, so the fastest dome turns about 4°/s.

| Preset | slot A | dy | spin | Resolves to |
|---|---|---|---|---|
| 0 | 6048 | 0 | 12 | `st1_1[20]` |
| 1 | 6048 | −200 | 4 | `st1_1[20]` |
| 2 | 6049 | −300 | 2 | `st1_1[21]` |
| 3 | 6047 | −300 | 0 | `etc_1[65]` |
| 4 | 6048 | 0 | 4 | `st1_1[20]` |
| 5 | 6048 | 0 | 4 | `st1_1[20]` — the flipped one |
| 6 | 6049 | 0 | 2 | `st1_1[21]` |
| 7 | 6307 | −450 | 1 | `st5_01b[0]` |
| 8 | 6312 | −1050 | 1 | `st5_01b[5]` |
| 9 | 6309 | −2400 | 2 | `st5_01b[2]` |
| 10 | 6310 | −3000 | 0 | `st5_01b[3]` |
| 11 | 6311 | −3000 | 0 | `st5_01b[4]` |

Note every dome lives in `st1_1`, `etc_1` or `st5_01b` regardless of which
stage uses it — the sky is shared geometry. No region draws these slots; the
script pulls them in with opcode `0x50` like any other prop.

### `20`–`27` — the tween block, read out

**[proved]** `FUN_0040B650` (`0x21`, by rate) and `FUN_0040BA90` (`0x23`, over
a duration) both fill the same 4-dword-per-channel record
`{enabled, from, to, rate}`:

- `from` is read from the light block, so a tween always starts where the
  channel currently is;
- `to` comes from the first operand — **dereferenced as a float pointer**,
  except on the fog *colour* channels (2, 3, 4 and the 5 that sets all three),
  which read it inline and convert int → float;
- `rate` is a per-frame step. `0x21` takes it from a second float pointer;
  `0x23` takes a frame count and **pre-divides**, `rate = |to − from| / frames`,
  falling through to an immediate set when the count is 0.

This independently confirms the channel map, because each case reads `from`
from the exact block offset the channel table claims: case 0 from `+0x30`,
case 2 from `+0x24`, case 6 from `+0x240`, case 10 from `+0x24C`, and so on.

**[measured]** `st2evtbl` alone runs **247** `0x23` tweens, every one of them
over 30 frames. Fog and scene light are *ramped* throughout the game, never
switched — a consumer that jumps to the target looks visibly wrong.

### Correction: `0x20`–`0x27` are fog and light tweens, not view tweens

An earlier revision of this document said the `0x20`–`0x27` family targets
"two **view structs**, one per player". That is wrong. `DAT_009A3540` and
`DAT_009A59E0` are the two **scene light / fog environment blocks**.

The decisive link is the renderer end, confirmed directly:
`FUN_0040E160(&g_scene_light_block0)` runs once per frame from the view setup,
builds a direction vector from the block's pitch/yaw, and hands it to
`FUN_004AA0E0`, which writes `g_render_light_dir_*` — and *those* globals are
read by `SetLightingDefaultSingle`, `RenderSubmitModelDefaultLight` and
`RenderSubmitModelSceneLights`. Alongside it, `FUN_004AA0A0` writes the light
colour and `FUN_004AA070` the ambient.

| Offset in the block | Field |
|---|---|
| `+0x00` | world-space light direction (3 × f32) |
| `+0x0C` | view-space light direction (3 × f32) |
| `+0x18` / `+0x1C` | light pitch / yaw (BAMS) |
| `+0x24`…`+0x2C` | fog colour R/G/B (ints) |
| `+0x30` / `+0x34` | fog near / far |
| `+0x240`…`+0x248` | light colour R/G/B (f32) |
| `+0x24C` | ambient |

So the `0x24`-dword `{enabled, from, to, rate}` tween block animates *these*:

| Channel | Target |
|---|---|
| 0 / 1 | fog near / far |
| 2, 3, 4 | fog colour R / G / B |
| 5 | fog colour, all three at once |
| 6, 7, 8 | light colour R / G / B |
| 9 | light colour, all three at once |
| 10 | ambient |

`0x20`/`0x21`/`0x22`/`0x23` target light block 0 and `0x24`–`0x27` block 1;
block 0 is pushed to the renderer every frame, block 1 only at scene init.

## `queue_event` — the scripted-action table, SOLVED

**[proved]** `EvtRunQueuedActions` copies an action's operands into the scratch
block at `0x009A6184` and fetches its handler from

```c
handler = table[selector >> 4][selector & 0xF];      /* table = 0x005776EC */
```

The high nibble is *both* the group index and the operand count — the groups
are organised by arity, which is why the instruction length is
`2 + (selector >> 4)` dwords. The index table has seven slots, four of them
null, and the sub-tables are laid out immediately **before** it:

| Group | Sub-table | Handlers | Selectors |
|---|---|---|---|
| 1 | `0x005776C4` | 6 | `0x10`–`0x15` |
| 2 | `0x005776DC` | 2 | `0x20`–`0x21` |
| 4 | `0x005776E4` | 1 | `0x40` |
| 6 | `0x005776E8` | 1 | `0x60` |

> ⚠️ **Correction.** An earlier revision of this document said the table "names
> 100+ scripted actions". It names **ten**. The estimate came from the size of
> the surrounding region, not from reading the table.

| Sel | Name | Effect |
|---|---|---|
| `0x10` | `set_player_flag` | `DAT_009A5EBC` bit 0 = op0, mirrored to `DAT_009A5D8C` |
| `0x11` | `scene_state` | `EvtEnterSceneState(current_major, op0)` — a transition in the 2-D state table at `0x00576C14` |
| `0x12` | `set_update_routine` | `DAT_009A5CE0 = PTR_FUN_00579E90[op0]` (two routines exist) |
| `0x13` | `set_continuation` | per-player continuation = `op0 ? LAB_00403290 : FUN_00420810`. **Defined but never used in shipped data** |
| `0x14` | `set_global` | `DAT_009C6F00 = op0` |
| `0x15` | `set_flag` | `DAT_009C6F33 = 1`; the operand is ignored |
| `0x20` | `hold_camera_preset` | op0 is a frame countdown; each frame copies 6 dwords from `0x00576CF0 + op1 * 0x18` into the player's camera block |
| `0x21` | `finish_sequence` | `EvtEnterSceneState(2, op0)`; sets `DAT_009A5900 \| 1` |
| `0x40` | **`cam_play`** | **plays a `cam/` path** — see below |
| `0x60` | `store_branch_previews` | **[proved]** the arcade **branch-preview shots** — one camera pose per route the next branch can take. See below |

**[measured]** Across stages 1–6 the only selectors that occur are exactly
those ten, minus `0x13`:

```
0x10 x3   0x11 x4   0x12 x2   0x14 x2   0x15 x6
0x20 x1   0x21 x418   0x40 x751   0x60 x13
```

### `0x60` — the branch-preview shots

**[proved]** by reading both halves. `EvtActionStoreSixOperands60` sets a
validity flag at `0x009C6FD8` and then scatters the six operands:

```
009C6FE0 = args[0]      009C6FDC = args[1]
009C6FE8 = args[2]      009C6FE4 = args[3]
009C6FF0 = args[4]      009C6FEC = args[5]
```

`FUN_00403DB0` reads them back indexed by the branch choice:

```c
frame = *(&DAT_009C6FE0 + branch_choice * 8);
path  = *(&DAT_009C6FDC + branch_choice * 8);       /* -> g_active_cam_path */
CamEvalPath7(path, (float)frame, &eye, &lookat, &roll, &_);
```

So the six operands are **three `(frame, slot)` pairs indexed by
`branch_choice`** — the shot the arcade shows for each route a branch can
take. Note the order: **frame first, then the global camera path slot**. The
scatter is what makes it look otherwise; reading only the store, the pairs
appear to be `(slot, frame)`.

`branch_choice` is `DAT_009C88A4`, the same global `EvtAdvanceBlockOrRoute`
indexes `next[]` with — so the preview and the route it previews are keyed
identically, which is the check that this reading is right.

### `0x40` — this is the `evt` → `cam` link

```
queue_event 0x40, start_frame, end_frame, path_index, flags
```

`EvtActionCamPlay40` (`0x00403360`) → `CamStartPathPlayback` (`0x00403510`) →
`CamAdvancePathFrame` (`0x004035E0`), which each frame calls

```c
CamEvalPath7(g_active_cam_path, (float)frame, &eye, &lookat, &roll, &_);
```

and increments the frame counter until it passes `end_frame`.

| Operand | Meaning |
|---|---|
| 0 | start frame; **`-1` means resume from the current frame** rather than seek |
| 1 | end frame |
| 2 | **path index** — written to `g_active_cam_path` (`0x009A2D78`) |
| 3 | flags: bit 1 defer (stash into `DAT_009C70AC/B0` for a later `0x40`), bit 2 consume the stashed values |

When `start_frame == end_frame` the handler calls `CamEvalStaticPose` instead —
a held camera rather than a moving one.

#### The path index is global across every `cam/` file

`CamEvalPath7` indexes `DAT_0059C9F8 + path * 8` for the descriptor and
`DAT_004C479C[path]` for which loaded file it belongs to. `DAT_004C479C` is one
byte per global path, exactly as long as the total path count and with no
terminator.

**[measured]** 23 `cam/` files, 418 paths, and the table resolves to **23 file
ids with no id occurring twice** — one contiguous run per file, `cp_*` first
then `op_*`:

| Global range | File | Paths |
|---|---|---|
| 0–17 | `cp_demo` | 18 |
| 18–28 | `cp_demo2` | 11 |
| 29, 30, 31 | single-path files | 1 each |
| **32–54** | **`cp_st1`** | 23 |
| **55–120** | **`cp_st2`** | 66 |
| **121–162** | **`cp_st3`** | 42 |
| **163–202** | **`cp_st4`** | 40 |
| **203–216** | **`cp_st5`** | 14 |
| **217–232** | **`cp_st6`** | 16 |
| 233+ | `cp_end`, `cp_train`, … then every `op_*` | |

**[proved by measurement]** All **751 / 751** selector-`0x40` instructions in
stages 1–6 name a path inside their own stage's range. A wrong operand order
would scatter those indices across the whole 418-path space, so this is a
metric that collapses. `tools/verify_evt_cam.py`.

## The scene state machine — SOLVED

**[proved]** Selectors `0x11` and `0x21` both call `EvtEnterSceneState(major,
minor)` (`0x00403BD0`), which records the state and jumps straight into a cell
of a 6 × 9 table at `0x00576C14`:

```c
g_scene_state_minor = minor;
g_scene_state_major = major;
goto g_scene_state_table[major * 9 + minor];
```

The `* 9` is from the disassembly (`LEA ECX,[ECX+EAX*8]; ADD EAX,ECX`), not
from the decompiler. `0x21` always passes `major = 2`; `0x11` passes the
*current* major.

A cell does no work of its own — it **installs the hooks for that phase**:

| Global | Role |
|---|---|
| `g_camera_update_hook` (`0x009C7080`) | camera update, run every frame by `CameraUpdateTick` |
| `_DAT_009A5CDC` / `_DAT_009A5E0C` | per-player update (P1 / P2, 0x130 apart) |
| `_DAT_009A5CE0` / `_DAT_009A5E10` | per-player sub-routine — **also writable from script**, via `queue_event` selector `0x12` |

> **Unused cells point at `SceneStateInvalidHang` (`0x00402710`), which is
> `while(1);`.** An invalid transition deliberately locks the game up, so the
> live cells are an exact statement of which states exist — not a guess.

| major | live minors | what it installs |
|---|---|---|
| 0 | 0 | no camera hook |
| 1 | 1, 2, 3 | player-relative cameras |
| 2 | 4, 5, 6, 7 | `cam/` path cameras |
| 3 | *none* | every cell hangs — major 3 does not exist |
| 4 | 0–5 (no-op), 8 | |
| 5 | 0, 3, 4, 6, 7, 8 | |

### The camera modes

All of them write the same six globals — `g_camera_eye_x/y/z` and
`g_camera_pitch/yaw/roll_bams` (`0x009C71E0`…`0x009C71F4`):

| State | Routine | Behaviour |
|---|---|---|
| (0,0) | — | no camera hook |
| (1,1) | `CameraFollowPlayerMidpoint` | midpoint of the two players, or player `DAT_009C7000` alone when `DAT_009C8E80 == 1` |
| (1,2) | — | no camera hook; installs the player-B sub-routine |
| (1,3) | `CameraFromViewAngles` | pose built from the view struct: `RotateY(yaw-0x8000)`, `RotateX(-pitch)`, roll, then a `(0,-15,0)` translate |
| (2,4) | `CameraSnapToPathEye` | snap to the path eye, then re-install itself as `0x0040C470` |
| (2,5) | `CameraPathWithImpulseShake` | path pose plus a 30-frame decaying impulse, gated on `_DAT_009C9028 & 0x20000` |
| (2,6) | `CameraStepDeferredRailWithFrameExport` | plays the stashed path, publishing the current frame |
| (2,7) | `CameraPlayStashedPath` | same, `<` instead of `<=` on the end frame |

### How `0x40` and the state machine fit together

(2,6) and (2,7) call `CamEvalPath7(g_active_cam_path, frame, …)` themselves,
stepping `g_stashed_path_frame` toward `g_stashed_path_end_frame` — and those
are exactly the globals `EvtActionCamPlay40`'s `flags & 2` branch stashes. So a
deferred camera play is a two-instruction idiom:

```
queue_event 0x40, start, end, path, 2     ; stash the range
queue_event 0x21, 6 (or 7)                ; enter the state that plays it
```

**[measured]** All **208 / 208** deferred (`flags & 2`) camera plays in the
game are followed within three queued actions by a `0x21` to state 6 or 7.
Zero exceptions. Flags are only ever 0 (677 uses) or 2 (208).

### Two script opcodes fixed by this

Three camera hooks share this line:

```c
if (g_camera_use_fixed_y == 1) eye.y = g_camera_fixed_eye_y;
else                           eye.y = path.y - 15.0f;
```

`g_camera_fixed_eye_y` (`0x009C8E58`) is written by opcode **`0x1A`** and
`g_camera_use_fixed_y` (`0x009C70F4`) by opcode **`0x36`**. So `0x1A` sets a
fixed camera eye height and `0x36` selects it over the default
"path height minus 15".

### Validation

**[measured]** Every state transition in the shipped scripts lands on a live
cell. Selector `0x21`'s 444 operands across all stages are only 4, 6 and 7 —
inside row 2's live set `{4,5,6,7}`. Selector `0x11`'s are 1 and 3 — inside
row 1's `{1,2,3}`. A wrong row width would drop these onto the hang loop.

## Spawn descriptor

Header is 0x24 bytes, identical for opcodes `0x09`, `0x0B`, `0x0C`, `0x0D`
(`FUN_004088A0`, `FUN_00408A20`, `FUN_00408BC0`):

```
+0x00  u32  class index   selects the handler from the class table (below)
+0x04  u32  init flags    OR'd with 1 into object +0x34   (always 0 in shipped data)
+0x08  f32  position x    -> object +0x40
+0x0C  f32  position y    -> object +0x44
+0x10  f32  position z    -> object +0x48
+0x14  s32  orientation a -> object +0x64
+0x18  s32  orientation b -> object +0x68
+0x1C  s32  orientation c -> object +0x6C
+0x20  u16  (always 0)
+0x22  u16  see below      -> object +0x11C *and* +0x11E
+0x24  ...  variable behaviour tail
```

### The parameter tail — SOLVED

**[proved]** `obj+0x1390` **is the descriptor + 0x24** — the tail itself, not a
pointer to some other record. There are two allocators:

| Opcode | Function | Sets `obj+0x1390`? |
|---|---|---|
| `0x09` | `FUN_004088A0` | alloc **0x13F4**; **no** tail pointer — it reads two tail bytes inline (+0x24 → object +0x1F4, +0x25 → object +0x130C) |
| `0x0B`/`0x0D` | `FUN_00408A20` | alloc **0x13F4**; `obj+0x1390 = descriptor + 0x24`. Also sets `obj+0x1316` from the u16 at `desc+0x20` |
| `0x0C` | `FUN_00408BC0` | alloc **0x1314**; `obj+0x130C = descriptor + 0x24` — a *different object field*, so a class-0x0C object has no `obj+0x1390` at all |

So a class handler that reads `obj+0x1390 + k` is reading this file at
`descriptor + 0x24 + k`. `hod2lib.evt.Spawn.param(k, kind)` does exactly that,
taking the same `k` the handler uses so the two can be compared without
arithmetic.

Two worked examples, both `[proved]` in the code and then confirmed against the
data:

* **Class 0x25** — `FUN_00484FF0` switches on `*(int16*)(obj+0x1390 + 6)`, i.e.
  descriptor `+0x2A`, as a prop-variant selector with cases 1–4 (0 and >4 draw
  nothing). Reading there gives variants 1 and 2 in stage 2 and 3 and 4 in
  stage 3 — and the variant-4 descriptor sits at `(-635.1, 43.0, -955.9)`,
  which is where the routine hardcodes that prop's world position.
* **Class 0x33** — `FUN_00433860` reads its object path slot from
  `obj+0x1390 + 0x0C`, i.e. descriptor `+0x30`. That resolves to op_st2 336 and
  338 and op_st5 382, all inside the correct per-stage ranges. Its main asset
  is `obj+0x1390 + 0x00` → `obj+0x13F0`: `komono_boat.bin` on the stage-2
  routes and `car_2.bin` on the stage-5 one.

> ⚠️ Both were previously read at `descriptor + 6` and `descriptor + 0x0C` —
> off by exactly `0x24`. That gave the high half of `init_flags` (always 0) and
> float data respectively, and the conclusion drawn was that `obj+0x1390` must
> point somewhere else entirely. It does not. Note though that `obj+0x1390`
> **is** polymorphic across the codebase: `FUN_00408770` stores a pointer to a
> *parent actor* there for objects it spawns itself rather than from a
> descriptor.

Tails are still **not** self-terminating and their length is **not** a function
of the class: the gap between consecutive descriptors of the same class varies
(class 48 appears with 40, 44, 48, 52, 56 and 60 byte spacing). Tails also
contain further relocated pointers, so there is a second layer below them.
Sizing a tail still requires the consuming class handler. `0x09` records are
laid out contiguously at a **0x28** stride in every shipped file, i.e. a
two-byte tail.

## Class table

Spawn objects are allocated by `FUN_004A6FA0(handler, size)`, which stores
*handler* at object +0x00 — a vtable-less virtual. The size is a literal at the
call site (`0x13F4` for `0x09`/`0x0B`, `0x1314` for `0x0C`); the **handler**
comes from a 112-entry table at `0x009A2280`, indexed by the descriptor's class
field.

`FUN_0040AC90` builds it: fill all 112 slots with the empty stub
`FUN_0041EBB0`, then apply a `{class_id, handler}` pair list terminated by a
negative id. The shipped list lives at `0x00593358` — immediately after the
opcode dispatch table — and has 56 entries:

| Class | Handler | Class | Handler | Class | Handler |
|---|---|---|---|---|---|
| 16 | `0x0048A3E0` | 38 | `0x0048E290` | 70 | `0x0042D9C0` |
| 17 | `0x0043A080` | 39 | `0x004329D0` | 71 | `0x0043BE60` |
| 18 | `0x0043F9D0` | 40 | `0x00432610` | 72 | `0x0042E0F0` |
| 19 | `0x0043FE10` | 41 | `0x00432C80` | 80 | `0x004997E0` |
| 20 | `0x00475E90` | 42 | `0x00432D40` | 81 | `0x00438540` |
| 21 | `0x00441750` | 43 | `0x00438060` | 82 | `0x0043F4C0` |
| 22 | `0x00442290` | 44 | `0x00432D50` | 83 | `0x00431250` |
| 23 | `0x004422D0` | 45 | `0x00426A70` | 84 | `0x00431780` |
| 24 | `0x0045CD60` | 48 | `0x00452DA0` | 85 | `0x00431C90` |
| 25 | `0x004917E0` | 49 | `0x00449620` | 86 | `0x00431BF0` |
| 26 | `0x00498FF0` | 50 | `0x0047F5F0` | 96 | `0x004342E0` |
| 27 | `0x00499420` | 51 | `0x00432FF0` | 97 | `0x00434EF0` |
| 32 | `0x00448ED0` | 64 | `0x0043BD30` | 98 | `0x00435930` |
| 33 | `0x00451720` | 65 | `0x00461CD0` | 99 | `0x00435F20` |
| 34 | `0x0049B0D0` | 66 | `0x0042F9B0` | 100 | `0x00435FB0` |
| 35 | `0x0048FD90` | 67 | `0x00445DB0` | 101 | `0x00436140` |
| 36 | `0x00482CE0` | 68 | `0x00472B10` | 102 | `0x00435A10` |
| 37 | `0x004840D0` | 69 | `0x0041FC00` | 108 | `0x00425010` |
| | | | | 109 | `0x00496BA0` |
| | | | | 110 | `0x00488820` |

### `+0x22` is not simply hit points

The u16 at `+0x22` reaches **both** `obj+0x11C` and `obj+0x11E`, and several
classes use `obj+0x11C` as a **sub-type selector** rather than a health count:
class `0x28` indexes a four-entry route table with it, class `0x33` picks one
of eleven handlers, class `0x26` one of eight states. The field is still spelled
`hp` in `hod2lib.evt.Spawn`; treat that as a historical name, not a claim. A
`+0x11C` current / `+0x11E` maximum pair would also fit the duplication, and
which classes read it which way is being resolved handler by handler.

**This is the route to the remaining 20 % of the bytes.** Each handler reads its
descriptor tail through object +0x1390 (`0x0B`/`0x0D`) or +0x130C (`0x0C`), so
the tail layout is recoverable one class at a time. Ten classes account for most of the
data: 65 (347 descriptors), 48 (283), 37 (169), 68 (132).

**Confirmed:**

- Position is float and in level space. Sampled against the bounding box of
  each stage's own geometry set, **1546 of 1546** spawns across all six stages
  fall inside their own stage — `tools/verify_objects.py`. That is the
  strongest available check that the offsets are right. (An earlier revision
  reported 1216/1216 over five stages.)
- **35 distinct class ids are used and every one is defined** in the handler
  table at `0x00593358`; an undefined id would dispatch to the empty stub, so
  this is a real check rather than a tautology.
- `+0x22` is hit points: it is written to *both* a current and a maximum field,
  and takes values 0–18 across 1410 descriptors.
- `+0x18` is a BAMS yaw — its range covers ±65536 (`0x4000` = 90°), while the
  other two orientation words are almost always 0 with a small integer tail.

**Not confirmed:** the exact meaning of `+0x14` and `+0x1C`. They reach object
+0x64 and +0x6C, and are plausibly the other two Euler angles, but their value
distributions (mostly 0, otherwise 1–10) do not look like angles. Do not export
them as rotations without checking.

1410 descriptors are reachable; class ids fall in the bands 16–27, 32–51, 64–70,
80–86 and 109, with class 65 accounting for 347 of them.

## Coverage

79.4 % of `evt/` bytes are reached by walking root → blocks → steps → bytecode →
spawn descriptor headers. The uncovered 20.6 % (60,296 bytes) attributes as:

| Source | Bytes | Share of residue |
|---|---|---|
| `0x0B` `spawn_obj` behaviour tails | 43,178 | 71.6 % |
| `0x0C` `spawn_obj_c` behaviour tails | 11,464 | 19.0 % |
| `0x20`/`0x24` `view_set` float constants | 1,888 | 3.1 % |
| `0x23` `view_tween_time` float constants | 916 | 1.5 % |
| `0x0D`, `0x03`, `0x04`, `0x07`, `0x09`, `0x0A` descriptors | 1,522 | 2.5 % |
| `0x1A` `set_g_8e58` operands | 532 | 0.9 % |
| no pointer within 1 KB — unexplained | 796 | 1.3 % |

So **90.6 % of the residue is spawn behaviour tails**, and the class table above
is the way in. The float-constant pools are trivially markable; the 796
unexplained bytes are the only part with no identified owner.

### A trap worth knowing

A step-table entry that resolves *outside* the file is an external reference,
not a terminator. `st1evtbl.bin` block 0 hands control to a stream in the shared
`comevtbl` buffer, and stopping at it silently drops the four steps that follow
— 159 instructions and 9 spawn descriptors, about 7 % of that file. Only one
block in the corpus does this, which is exactly why it is easy to miss.

## Open questions

1. What loads a stage's geometry segments? The event script references only 2
   of stage 2's 18 `st2_*` files, so it is not the main path. See
   [`pipeline.md`](pipeline.md).
2. ~~What do the `queue_event` selectors mean?~~ **SOLVED** — there are ten
   handlers, not 100+, and they are tabulated above.
3. ~~Which opcode selects a `cam/` path slot?~~ **SOLVED** — `queue_event`
   selector `0x40`, operand 2, a global path index. 751/751 verified.
4. ~~Semantics of the ~30 opcodes still named only by the global they write.~~
   **Largely SOLVED** — see the opcode reference above. What remains open:
   the identity of the actor class counted by `0x46`; the numeric scale of
   `0x16`'s ambient floats; the mode flag that selects `0x2D`'s sprite vs text
   draw path; `0x33`'s second operand; and `0x1E`, which is unrecoverable
   because nothing reads it.
5. `+0x14` / `+0x1C` of the spawn descriptor.
6. What are the two "no file" scenes (7 and 8)? Scene 7 runs an inline stub
   inside `comevtbl` and is used as the fallback when a scene's route table
   ends (`FUN_0045F000` calls `EvtGetEntry(7, 0, 0)`).
