# The end of a stage: the result card, its figures, the life bonus

Every one of the first four stages ends the same way: a seven-second camera
flight through a part of the level, seen through a window in a framed card,
with the civilians the player rescued in that stage standing in the scene;
the card counts the rescues up, awards lives for them, and shows each
player's score and accuracy. This is that sequence as the exe runs it.

Everything is `[proved]` from the instruction stream unless it says
otherwise; floats are quoted with the hex `.rdata` or the instruction holds.
Four routines here are cut short by the decompiler -- `ResultCardInstall` at
`PlaySoundId` (`L72`) and at its first `MatrixStackPop` (`L35`),
`ResultCardDrawScore` and `ResultCardDrawAccuracy` after their first digit
(`L35`) -- and every tail below was read with `disassemble_bytes`.

## 1. The script: one step, the same in every stage

The result is the **last step of a block whose route ends the scene**. Seven
such steps, two per stage where the stage has two endings:

| stage | scene | block/step | region | camera path | next stage opens at |
|---|---|---|---|---|---|
| 1 | 0 | 14/2 | `0x0B` | `0x33` | block 0 |
| 2 | 1 | 35/2, 37/2 | `0x3A` | `0x72` | block 0 / block 7 |
| 3 | 2 | 11/2, 13/2 | `0x19` | `0xA1` | block 0 / block 4 |
| 4 | 3 | 23/2, 25/2 | `0x26` | `0xC3` | block 0 |

Stages 5 and 6 have none. Each step is, in order (`dump_stage_script.py
--full`):

```
set_hud_shutter_state 6
region_enter R                      ; the part of the level the camera flies
(lights: set_light0/1_direction, light0/1_tween_time -- the fade in)
spawn_simple 0x00977244             ; {class 0x62, 0} -- ResultCardTally
asset_wait_tex_pol_jobs             ; waits for what 0x62 queued
spawn_simple 0x0097723C             ; {class 0x61, 0} -- ResultCardInstall
queue_event 0x40 (0, 0x1A4, P, 0)   ; cam_play: path P, frames 0..420
wait_camera_path_frame 0x186
(light tweens over 0x1E frames -- the fade out)
wait_queued_events_done             ; the path's frame 420
set_hud_shutter_state 8
wait_frames 1
wait_script_flag 0xFE               ; raised by class 0x61 as it dies
advance_step                        ; the step list ends: the scene is over
```

The camera flight is an ordinary `cam_play` of a path that runs exactly as
long as the card's dwell, `0x1A4` frames. Nothing on the card moves the
camera.

The step before it (step 1 of the same block, the boss's step) ends with
`award_accuracy_bonus` (opcode `0x2B`), after the boss block raised
`suppress_accuracy_stats 1` (opcode `0x2F`) before the fight. See section 6.

After `wait_script_flag 0xFE` the step list is exhausted, the route record is
the scene's last, and `EvtAdvanceStepOrRoute` (`FUN_0045F000`) calls
`MarkSceneOver` (`FUN_0045ED90`) -- which also clears
`g_accuracy_stats_suppressed` -- and the run phase machine takes the next
scene (`AdvanceToNextScene`, `FUN_0045FFF0`). The figures the card made are
still in the task list at that point; they go with the scene's teardown.

## 2. Class 0x62, `ResultCardTally` (`FUN_00435930`) -- the loader

Placed first, runs once:

```
TexBankQueueLoad(0x16A)                 ; scr_result -- the card's tiles
PolFileQueueLoad(0x7C)                  ; result.bin -- the glyphs
n = g_civilians_rescued_by_scene[scene]
if n == 0:
    for rec in g_result_figure_lists[scene] until rec.type == -1:
        PolFileQueueLoad(rec.type + 0x85)
        AttachmentListQueueLoad(g_result_figure_attachments[rec.type - 0x20])
else:
    for i in 0 .. n-1:
        t = g_rescued_char_types[scene*10 + i]
        PolFileQueueLoad(t + 0x85)
        AttachmentListQueueLoad(g_result_figure_attachments[t - 0x20])
AssetDrainTexAndPolJobs(); ActorKill()
```

`PolFileQueueLoad` (`FUN_0041D650`) is asset job kind 3 with a pol **file**
index; evt opcode `0x52` (`asset_load_polfile`, `FUN_0045F500`) is the same
call on its operand. Type `+ 0x85` is the civilian's own model file:
`0x20 + 0x85` is pol 165, `hitoc.bin`, through `0x37 + 0x85`,
`hito_oyajisagyo.bin`. It writes no script flag.

## 3. Class 0x61, `ResultCardInstall` (`FUN_00434EF0`) -- the card

### Every frame, first: the life bonus

```
n = g_civilians_rescued_by_scene[scene]
b = g_result_life_bonus[scene*8 + (n < 8 ? n : 7)]      ; CMP CX, 8 / JL
```

`g_result_life_bonus` (`0x0055E044`), u8, by scene then rescues:

| scene | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7+ |
|---|---|---|---|---|---|---|---|---|
| 0 (stage 1) | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 |
| 1 (stage 2) | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 2 |
| 2 (stage 3) | 0 | 0 | 0 | 1 | 1 | 1 | 1 | **0** |
| 3 (stage 4) | 0 | 0 | 0 | 1 | 1 | 1 | 1 | 1 |
| 4, 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

Stage 3's last column is 0 in the shipped table; that is what the card
awards for seven or more rescues there.

### Sub 0 (`0x00434FB1`), the first frame

```
SndLoadPackStubbedOut(0, 0, -1)
PlaySoundId(0x10000003)                  ; bgm 3: CLR.WAV / CLR_AR.WAV
g_nFiringGate = 0
g_screen_furniture_flags |= 0x10         ; the card has the screen
obj+0x11C = 0x1A4                        ; the dwell, 420 frames
list = g_result_figure_lists[scene]
if n == 0:
    i = 0
    for rec in list until rec.type == -1:            ; CMP [EDI], -1
        f = ActorAlloc(ResultCardFigureInit, 0x13F4); ActorClearGameFields(f)
        f+0x131B = i; f+0x40..0x48 = rec.pos; f+0x68 = rec.yaw
        f+0x1F4 = rec.type
        f+0x1B4 = rand() % 3 + 0x18B
        i++
else:
    for i in 0 .. n-1:                   ; no test against the list's length
        rec = list[i]
        f = ActorAlloc(ResultCardFigureInit, 0x13F4); ActorClearGameFields(f)
        f+0x131B = i; f+0x40..0x48 = rec.pos; f+0x68 = rec.yaw
        f+0x1F4 = g_rescued_char_types[scene*10 + i]
        f+0x1B4 = rec.motion
        if (b > 0) f+0x1350 = 1
sub = 1, and on into sub 1's test
```

So with no rescue the scene's own figure list stands in the scene (the
stage's rescuable civilians, in one of three motions `0x18B..0x18D` chosen at
random), and with rescues **the rescued civilians' own character types**
stand in the list's places, in the list's motions `0x17C`, `0x17D`,
`0x17F`. What the motions depict is not in the code; `[likely]` from the
render (section 7).

A scene with more rescues than list records reads the terminator record
(type -1, all zero: the origin, motion 0) and then whatever follows it in
`.rdata` -- scene 0's sixth figure stands at the origin and its seventh at
scene 1's first place. The exe does it, so the port does.

### Sub 1 (`0x00435107`) and sub 2 (`0x00434F4D`): the award

Sub 1 steps to 2 once the dwell is at or below `0x78`. Sub 2 runs **once**:

```
for p in 0, 1:                           ; both, in play or not
    g_player_lives[p] += b
    if g_GameMode == 1:  if lives >= g_original_life_cap[p]: lives = cap   ; signed
    else:                if (u32)lives >= g_max_lives:        lives = cap   ; unsigned
sub = 3
```

`g_max_lives` (`0x009A2440`) is 5, written by `ProfileApplyToRun`;
`g_original_life_cap` (`0x009A2245 + p*0x14`) is 5, written by
`ResetOriginalModeLoadout` and by two Original items. Counting frames from
the card's first update as 1, the dwell at the test is `421 - k`, so sub 2 is
frame **302**. There is no sound and no other trace of the award than the
figure below.

### Every frame: the draw (`0x00435118`), then the countdown

All of it after the sub, including frame 1:

1. **The frame.** Seventeen `scr_result` tiles, `DrawScreenSprite(0xA2A + k,
   col*128, row*128, depth 1.1, 1, 1, 0, 0)` for rows 0..3 and columns
   0..4, skipping row 1's columns 1..3. That leaves a 384x128 window at
   `(128..512, 128..256)`; at depth 1.1 the tiles sit behind the glyphs
   (depth 1) and in front of the level, so the flight is seen through the
   window.
2. **Glyphs**: `result.bin` models under `MatrixLoadIdentity` -- camera
   space -- at `z = -1`, each `MatrixTranslate(x, y, -1); MatrixScale(s);
   AssetDrawSlot(slot)`:

   | what | slots | x | y | scale | when (dwell) |
   |---|---|---|---|---|---|
   | `g_result_glyphs_rescued`, 9 | `0x0055DFF8` | `i*0.05 - 0.25` | 0.22 | 0.07 | always |
   | the count | `0x165F + min((0x186 - dwell)/20, n)` | 0.25 | 0.22 | 0.07 | `<= 0x186` |
   | `g_result_glyphs_life_bonus`, 12 | `0x0055E00C` | `i*0.036 - 0.234` | 0.05 | 0.05 | `<= 0xB4` |
   | the bonus | `0x165F + b` | 0.234 | 0.05 | 0.05 | `<= 0x96` |
   | `g_result_glyphs_accuracy`, 8 | `0x0055E034` | `(i+5)*0.0275 - 0.233` | -0.24 | 0.03 | always |

   A zero slot in a string draws nothing. The count therefore climbs one a
   third of a second from frame 31. Then, for each player whose
   `g_player_state` is 5 (`0x009A5C62`, `0x009A5D92`):

   | what | player 0 | player 1 | y | scale |
   |---|---|---|---|---|
   | `0x1660 + p` (the digit 1 or 2) | x -0.351 | x 0.149 | -0.11 | 0.04 |
   | `g_result_glyphs_score`, 7 | `i*0.0288 - 0.322` | `i*0.0288 + 0.178` | -0.11 | 0.04 |
   | `ResultCardDrawScore(p, -0.293, -0.17, 0.5)` | | | | |
   | `ResultCardDrawAccuracy(p, -0.243, -0.24, s)`, only with `g_player_shot_count[p] >= 0x14` | s 0.5 | s 0.3744 | | |

3. **The countdown** (`0x00435663`): `obj+0x11C -= 1`; at 0,
   `g_script_flags[0xFE] = 1` (`0x0043567C` -- the only instruction in the
   image that writes `0x009C72FE`), bit `0x10` of
   `g_screen_furniture_flags` down, `ActorKill`. That is frame 420, the same
   frame the camera path ends.

`result.bin` entries 0..9 are the digits `ResultCardDrawScore` indexes by
value, `[proved]`. Entries 10 on read `A`..`P`, then one glyph, then
`Q`..`Z` `[likely]`: under that reading the four strings are `RESCUED X`,
`LIFE BONUS X`, `P SCORE` and `ACCURACY`, and `0x1679`, the glyph
`ResultCardDrawAccuracy` puts after the number, is `%`. The render in
section 7 settles it.

### `ResultCardDrawScore` (`FUN_004362E0`), `ResultCardDrawAccuracy` (`FUN_00436620`)

Both draw with `MatrixTranslate(p*stride + x + column, y, -1)` and scale
0.04. The score: the 100000s digit only when the score is above 99999 at
column 0, 10000s above 9999 at `0.0288`, 1000s above 999 at `0.0576`,
100s above 99 at `0.0864`, 10s above 9 at `0.1152`, and the units always at
`0.144` -- right-aligned, leading zeros dropped. The accuracy:
`g_player_shot_count[p]` set to 1 if it is 0 (a write, on a display path),
`pct = hits*100/shots`, anything above 100 or below 0 drawn as 0; hundreds
at 0 when above 99, tens at `0.0288` when above 9, units at `0.0576`, `0x1679`
at `0.0864`.

## 4. The figures

`ResultCardFigureInit` (`FUN_004356A0`), the first update of each:

```
g_cur_actor = obj; obj+0x3C = -1; obj+0x120 = -1
ActorBuildSkinnedModel(obj+0x194, obj+0x40, model+0x78)   ; type +0x1F4, motion +0x1B4
model+0x68 = 1                               ; rotation order
model+0 = rand()                             ; the play counter: a random phase
model+0x1158 = ResultCardFigureDrawNode
obj+0x34 |= 0x8000                           ; never shot
if g_result_figure_attachments[type - 0x20][0] != -1:
    model+0x1170 = that list; ActorBindPartList(model)
if type == 0x20 && motion in {0x17C, 0x17D, 0x17F}: pos.y -= 2.4   ; [0x0055E174]
ResultCardFigureUpdate(obj); obj+0x00 = ResultCardFigureUpdate
```

`g_result_figure_attachments` gives each civilian type its hair or hat (the
`etc_komono_*` records of `g_actor_attachment_table`); the rescued civilian's
spawn-time list is not used. The lookup has no bound; every type a shipped
script can record is inside `0x20..0x37` (section 5), `[likely]` -- a scan
of the scripts, not a proof that no other writer exists.

`ResultCardFigureUpdate` (`FUN_00435760`), every frame after:

```
g_cur_actor = obj
if obj+0x131B == 0 && obj+0x1350:                 ; figure 0, and a bonus
    if g_cam_path_frame == 0x104: ActorSetMotionBlended(model, 0x180, 0, 0x14)
    if model+0x20 == 0x180 && model+0x08 == 0x80: obj+0x1324 = 1
LightsUseSecondarySet(); DrawSkinnedModelAndShadow(model, pos, recs); LightsRestoreScene()
if obj+0x1324 == 0: model+0 += 1
```

`ResultCardFigureDrawNode` (`FUN_004357F0`), the node hook: the node's own
slot, scaled in Original Mode while `g_original_item_part_scale` is set (bone
2 by `(1.5, 1, 1.5)`, bones 5, 8, 12, 15 by `(2, 1, 2)`), and then, for
figure 0 on bone 5 while its motion is `0x180` and its cursor is
`0x1E..0x57`:

```
Push; MatrixTranslate(1.0, -1.0, 0); MatrixRotateX(0x4000); MatrixRotateZ(0);
MatrixRotateY(0); AssetDrawSlot(0x10C3); Pop            ; common.bin[199]
```

`0x10C3` is also the first record of the civilians' held items
(`civilians.items[0]`, bone 5). So **the life bonus is shown, and only
shown, by the first rescued civilian**: at camera frame 260 of the flight
figure 0 changes to motion `0x180`, holds `common.bin[199]` up on bone 5
from cursor 30 to 87, and freezes one frame after cursor 128. Nothing else
about the award is visible.

A figure never kills itself; it lasts until the scene is torn down.

## 5. The rescue bookkeeping

Three words, written together at every rescue:

| writer | `g_civilians_rescued_total` | `g_civilians_rescued_by_scene[s]` | `g_rescued_char_types[s*10 + n]` |
|---|---|---|---|
| `CivilianRunScript` op `0x2C`, the rescue arm (`0x0048BA8C`) | `+= 1` | `n = old; old + 1` | `model+0x60` -- the civilian's character type |
| `RescueTargetHeldState` (`0x00451AFF`), stage 2's car | `+= 1` | the same | literal `0x36` |

Both write the type at the **pre-increment** count, before the 400 points.
`ResetSceneOnEnter` zeroes this scene's count; `ResetGameOnStart` zeroes six
scenes' counts, the run total, and the first twelve bytes of each scene's
twenty in `g_rescued_char_types` -- which no reader can see, because index
`n` is always written in the scene before it is read.

Which civilians can reach the rescue arm: the ones whose script -- through
`civilians.entries` and every sub-script an op names -- contains an op
`0x2C` with bit `0x10000000`. Stage 1 has five (types 0x26, 0x20, 0x27,
0x31, 0x2E -- exactly its figure list), stage 2 nineteen plus the car, stage
3 ten, stage 4 seven. All their types are in `0x20..0x37`.

## 6. The accuracy bonus the card's score already includes

`EvtOpAwardAccuracyBonus2B` (`FUN_0045FE40`), the boss step's last scoring
act before the result step:

```
for p in 0, 1:
    if g_player_state[p] == 5 && g_player_shot_count[p] >= 0x14:
        ScoreAddForPlayer(p, g_accuracy_bonus_table[(hits*100/shots) / 10])
```

`g_accuracy_bonus_table` (`0x00567990`): `0 0 0 0 500 1000 1500 2000 2500
3000 4000`. `EvtOpSuppressAccuracyStats2F` (`FUN_0045FE20`) writes the
opcode's operand into `g_accuracy_stats_suppressed` (`0x009A5C48`), and
while it is non-zero `PlayerFireAndReloadUpdate` does not count shots
(`0x00414A15`) -- so a boss fight's shots do not count against the grade.
`MarkSceneOver` and the checkpoint opcode (`ResetSceneCombatState`, `FUN_0045EEC0`) put it back to 0.

`PlayerFireAndReloadUpdate` (`FUN_00414940`), at a trigger pull that fires:
`g_nPlayerFired[p] = 1` (`0x009A5C78`, a flag) and, unless suppressed,
`g_player_shot_count[p] += 1` (`0x009A5C84`, the count). They are two words.

## 7. The port, and what the render showed

Ported: `game/class61/` (the card, its figures, the two number draws, the
`.rdata` read by address), `game/class62/`, `game/rescue.ts` (both writers'
three stores), `game/combat/accuracy.ts` (opcodes `0x2B`, `0x2F`), the shot
count and its guard in `combat/shot.ts`, `ResolveHit`'s two hit counts, and
`g_view_slot_draws` for the glyphs. The bundle's `result_card` block and the
figure templates are `docs/formats/bundle.md`'s.

Rendered in the page (`web/tools/result_card.mjs`), stage 1 with five
rescues: the frame's window shows the flight through region `0x0B`; the
figures stand in the alley and on the steps, **waving** on `0x17C`, `0x17D`
and `0x17F` `[likely]`, from the render; figure 0 (type `0x31`, `hito_mario.bin`) holds up
the white box marked with a red cross and LIFE -- `common.bin[199]` -- on
`0x180`; and with no rescue the scene's own list **lies dead** on its three
single-frame poses `0x18B..0x18D` `[likely]`, from the render. The glyphs read
`RESCUED X n`, `LIFE BONUS X n`, `1P SCORE` and `ACCURACY` -- the font reading
of section 3, confirmed by the picture.

## 8. What is still open

* What the motions depict is `[likely]` only, from the render (section 7):
  the code names numbers.
* Which callers read `g_accuracy_stats_suppressed` at `0x0046513C` and
  `0x0048FBB1`, and why a prop's hit counts in Training while it is up, is
  `[open]` -- nothing on the result card depends on it.
