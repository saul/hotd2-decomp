# The chapter card

The title at the top of every stage -- "The First Chapter / A Prelude" -- and
the actor `wait_script_flag 0xF8` waits for. Class `0x60`, placed by
`spawn_simple 0x00977234` (`{class 0x60, hp 0}` in `comevtbl.bin`). Ported in
`web/src/game/class60/`; held to the exe by `web/tools/checks/chapter_card.ts`.
Everything here is `[proved]` from the disassembly unless marked.

## The installer -- `ChapterCardInstall` (`0x004342E0`)

```
if (g_GameMode == 3)        { furniture |= 0x20; BossModeChapterCardUpdate(obj);       obj[0] = 0x434920; return; }
if (g_app_state == 0x0B)    { furniture |= 0x20; AttractScene11ChapterCardUpdate(obj); obj[0] = 0x434DA0; return; }
switch (obj+0x1312) { case 0: sub 0, then sub 1; case 1: sub 1; default: countdown only }
```

`g_screen_furniture_flags` is `0x009A5900`; bit `0x20` is the card's
(`ScreenFurniture.ChapterCard`). App state `0x0B` is `RunAttractScene11`
(`0x0041FB00`), the second attract scene.

**Sub 0** (`0x00434360`): the bit up; `LightBlockSetDirection(&g_scene_light_block0,
camera block g_camera_index's pitch, yaw)`; `SetSceneAmbient(0.7)`; for scenes 0..5
(table `0x004348D8`) `ChapterTitleReset` and eight `MOV word ptr` into
`g_chapter_title_sprites` (`0x007DCBA0`):

| scene | s0..s7 | anchor points (sub-1 table `0x004348F0`) |
|---|---|---|
| 0 | `0x1FB..0x202` | (190, 80), (400, 350) |
| 1 | `0x203 0x204 0x205 0x22A 0x206..0x209` | (320, 80), (320, 350) |
| 2 | `0x20A..0x211` | (350, 80), (190, 350) |
| 3 | `0x212..0x219` | (190, 80), (400, 350) |
| 4 | `0x21A..0x221` | (320, 80), (320, 350) |
| 5 | `0x222..0x229` | (350, 80), (222, 350) |

The ids resolve through `g_screen_sprite_bank` to `scr_chapter_st1..6`
(texbanks `0x18C..0x191`), PAL4 images bound to palette `0xB`
(`TexBankPaletteIndex`, byte table `0x0041CB90` -> jump entry 16 -> `MOV EAX,
0xB` at `0x0041CA20`). Then `INC` the sub, `obj+0x11C = 0xB4`, and on into
sub 1.

**Sub 1** (`0x004345B4`): scene 5 first draws slot `0x1730` -- a white
32x32 quad, `etc_2.bin[2]` -- under `MatrixLoadIdentity; MatrixTranslate(0, 0,
-30); MatrixRotateY(0x8000); MatrixScale(2, 2, 2)`: the stage-6 card's white
background. Every scene then calls `ChapterTitleDraw(x0, y0, x1, y1)`, and
with `g_wCaptionMode == 1` draws caption sprite `0x42B + scene` at (610, 86).
`g_wCaptionMode`'s one writer stores 2 (`0x0040AC71`), so the caption never
draws in this build.

**Countdown** (`0x00434802`): `if ((sub >= 1 && dwell < 0xA0 && pad & 2) ||
pad & 0x20000) dwell = 1; if (--dwell > 0) return;` -- player 0's B (the
reload: the mouse's right button, Right Ctrl) after the first 20 frames,
player 1's B at any time. At zero: `AssetQueueFreeTexbank(0x18C + scene)`
(scene 5 also `AssetQueueUnloadSlot(0x1730)`), `AssetDrainAllJobs`,
`g_script_flags[0xF8] = 1`, the bit down, `ActorKill`. The routine plays no
sound (an earlier annotation read the texbank ids as sounds).

## The title -- `ChapterTitleReset` (`0x00436A30`), `ChapterTitleDraw` (`0x00436AD0`)

`g_chapter_title_parts` (`0x007DCAA0`) is eight 0x20-byte records: `+0x08`
and `+0x0C` a scale, `+0x18` an alpha; record 0's `+0x10` is the frame
counter and its `+0x1C` the phase. The reset sets every scale and alpha to 1,
then records 0..3's scales to 1.5, 4.5, 2 and 6 and records 4 and 5's alphas
to 0. A scan of `.text` for every dword in `0x007DCAA0..0x007DCBB0` finds only
these two routines and the installer.

`ChapterTitleDraw` switches on the phase (table `0x00437A54`) and steps the
counter on every path. Every draw is `ScreenSpriteDraw` (centre-anchored,
depth 1). Frame numbers are the counter's, from 0 on the card's first update:

| phase | frames | draws |
|---|---|---|
| 0 | 0..14 | s0 at (x0, y0) and (x0+10, y0+10), s1 at (x1, y1) and (x1+10, y1+10), the four scales shrinking to 1 by 1/30, 0.2333, 1/15, 1/3 a frame |
| 1 | 15..45 | the same four; the `+10` echoes grow and fade by 1/30 (alpha forced 0 at 45); s7 at (x0+40, y0+40) and s4 at (x1+50, y1-30) fade in by 0.025 from 25 |
| 2 | 46..85 | six five-frame cuts among s5/s2, s6/s3, s0/s1 and s7/s4; then 76..85 s0, s1, s7, s4 fade out from 1 by 0.1 |
| 3 | 86..115 | nothing |
| 4 | 116..170 | s6/s3 grow by 1/15 and fade by 0.0222 while s7/s4 fade in, s0/s1 solid from 150; 161..165 s7/s4 squash (x -0.12, y +1.6); 166..170 s0/s1 (x -0.198, y +3.2) |

In the first cut (frames 46..50) s4 is placed at `(x1 + 50, y0 - 30)` -- the
**first** point's y: `FLD float ptr [ESP + 0x1C]` at `0x00436FCC` loads the
second argument, where every other s4 uses the fourth. The port keeps it.

## Boss Mode -- `BossModeChapterCardUpdate` (`0x00434920`)

Six subs (table `0x00434D88`). 0: `TexBankQueueLoad(scene + 0x160)`
(`scr_rank_bos01..06`), `AssetDrainAllJobs`, the damage rank seeded
`g_initial_damage_rank[g_boss_mode_difficulty] + 4 * g_players_in_play`, on
into 1. 1: twenty 128x128 backdrop sprites from `g_boss_mode_backdrop_sprites
[scene]` (`0x0055DD50`), depth 2, until `g_script_flags[g_boss_mode_backdrop_flags
[scene]]` (`0x0055DD5C`: 2, 9, 1, 0x1E, 0x16, 0x32) is 1. 2: the chapter bank
freed, the bit down. 3: waits for `g_boss_engaged`, then `BossModeClockStart`
(and `BossModeClockSet(g_boss_mode_time)` for `g_mode_select_word == 1` past
the first entry), falling into 4. 4: `g_boss_mode_time =
BossModeClockRead()` while the boss is engaged; when it falls, 5. 5: 121
frames of blink. From 3 on the tail draws `g_boss_mode_time % 216000` as
`mm:ss:hh` in `scr_trn_byo` digits `0xACF + d` at y 420, with `0x63B`/`0x643`
between, depth 0.8. The clock is **wall time**: `GetTickCount()` milliseconds
times 0.06, plus 0.5, truncated -- sixtieths, rounded. It never raises flag
248 and never kills itself; Boss Mode's blocks wait on `wait_frames` instead.
No bundle is a Boss Mode stage, so the port runs none of this in play.

## App state 0x0B -- `AttractScene11ChapterCardUpdate` (`0x00434DA0`)

200 frames; sub 1 draws 5 x 15 tiles of 128x32 from frame
`g_attract11_card_frames[(g_frame_counter % 10) >> 1]` (`0x0055DD64`: `0x441`,
`0x48C`, `0x4D7`, `0x522`, `0x56D`, `scr_hinichi`) -- the flash table
`0x0055DD70`'s while the dwell is 60..72 -- depth 2; at zero flag 248,
texbank `0x192` freed, the bit down, `ActorKill`. The port never enters app
state 0x0B.

## Who reads the bit

`RegionDrawResidentSet` (`0x00401260`) returns before drawing any region
(`TEST AL, 0x20; JNZ 0x00401460`) -- the card is drawn over no level, on the
fog colour the script left (black in stage 1, blue in stages 2 and 3), or
stage 6's white quad. `ScriptedHumanoidDraw` (`0x00484FF8`),
`SetPiecePropDrawAndTick` (`0x004834FB`), `St1VehicleUpdate`,
`Class22CutsceneHoldUntilChapterCard` and `HudDrawShutterState` (state 4,
`& 0x30`) stand aside too; `HudDrawLives` tests only `0x10`, so "HOLD YOUR
FIRE!" shows over the chapter card. In the port: `render/stagescene.ts`
(regions), `game/class22/entrance.ts`, `game/hud_shutter.ts` and
`game/camera/view.ts`. The renderer does not yet hide class 0x25's body
(`ScriptedHumanoidDraw`'s arm, which stages 2 and 3 show: the partner
standing on the blue) or class 0x24's skeleton under the bit; the bit both
read is `G.g_screen_furniture_flags`, up for the whole dwell.

## What the port does not transcribe

* Sub 0's `LightBlockSetDirection` and `SetSceneAmbient(0.7)`. Light block 0
  lives in the walker (`script/state/channels.ts`), which `game/` sits below.
  Every story script but stage 5's sets the direction again after the card,
  and stage 1's ambient is already 0.7 when the card is placed; stage 5's
  block 0 keeps the card's direction until its next block in the exe, and not
  in the port.
* The asset jobs: the port keeps no texbank residency, and slot `0x1730`'s
  only drawer is the card, which dies the frame the job would free it.
