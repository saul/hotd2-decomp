# The options screen (app state `0x0C`)

A transcription-grade reading of the screen the title menu's OPTION row opens,
of the profile it edits, and of how that profile is kept between runs. Every
address was read from the instruction stream: the screen's routines are full
of `PlaySoundId` calls, which Ghidra marks no-return (L72), so **almost every
decompile below stops at its first sound** and the rest of each routine is in
no pseudocode.

Markers follow the project convention: `[proved]` the code says so,
`[likely]` inference with the evidence named, `[open]` undetermined.

The port is `web/src/game/options/` (the screen), `game/profile.ts` (the
resets, the load, the save, the apply), `game/options_data.ts` (the `.data`
the resets copy and the sprite ids the screen pushes), `game/screen_idle.ts`
and the bundle's `options` block (the `.rdata` the screen reads).
`tools/verify_options.py` holds the reading to the image.

## How it is reached, and left

`AppStateDispatch` (`0x004608A0`) calls `OptionsRunPhase` (`0x004869E0`) in
app state `0x0C` and then `CreditBlinkTick`, as for every screen `[proved]`.
The only request for `0x0C` is `TitleMenuUpdateAndSelect`'s cursor 5 -- the
`option_` row `TitleMenuRegisterSprites` registers `[proved]`.
`CommitAppState` puts both players out on the way in (0x0C is not 6 or 7).

`OptionsRunPhase` is three phases on `g_nRunPhase` `[proved]`:

| phase | what |
|---|---|
| 0 | the arm, below; phase 1 |
| 1 | `JMP [g_options_frame]` (`0x009CA0F0`) |
| 2 | `CreditsClear`; `FUN_00413CB0` (a jump to `FUN_0049DFD0`: the render frame closed early before a load -- `0x007DEBAC = 1` makes every quad submit skip `[likely]`); `ScreenLeaveReset` (`0x0040AC10`); `RequestAppState(4)`, the title |

The arm (`0x00486A00`..`0x00486B43`):

* `SoundStopAll`; `NoOpStub(0x10, 0x10)`; `FUN_004A7310`, `FUN_0041D510`
  (every pol slot back to the resident set, every cam file out -- the stage
  released), `FUN_0041D540`, `NoOpStub`;
* six `TexBankQueueLoad` (`0x0041D6D0`): `0x1B7` `scr_dc_option`, `0x150`
  `scr_dc_common`, `0x15E` `scr_opt_moji05`, `0x14A` `scr_back2`, `0x14B`
  `scr_back3`, `0x14C` `scr_back4`; `AssetDrainAllJobs`;
* `g_options_task_list = TaskListBuild(OptionsTaskListCreate)`;
* `g_options_input_seen[p] = g_player_input_is_gun[p]`;
* the working copies: `0x009C8E20` cursor = 0, `0x009C8E21` = blood,
  `0x009C8E22` = difficulty, `0x009C8E23` = life, `0x009C8E24` = credits
  **with -1 stored as 0**, `0x009C8E25/26` = each player's sight graphic,
  `0x009C8E35` = `g_option_unused_9F28`, the two sound tests at 0;
* `FUN_0041D4A0(&0x009C8E30)` -- on the PC only `OutputDebugStringA
  ("SS_GetAudioVal")`: nothing is written;
* `MatrixLoadIdentity`; `0x007DD02C = 0` (never read);
  `g_options_blood_row_shown = 0`; `g_options_row_shift = -1`;
* `ScreenIdleReset`; `0x009C6EF4 = 0`; `g_options_frame = OptionsFrameList`.

## The list

`OptionsFrameList` (`0x00486B80`): if either player's `g_player_input_is_gun`
differs from `g_options_input_seen`, `PlaySoundId` `0x80000000`, `0x80000002`,
`0x80000001` (music, voice, SE stopped) and the cursor to 10; then take both
again and `TaskListWalk` the two tasks `OptionsTaskListCreate` (`0x00486BF0`)
allocated, in that order `[proved]`:

1. `OptionsMoveCursorTask` (`0x00486C10`)
2. `OptionsDrawListTask` (`0x00486DA0`), which also runs each row's handler.

### The rows

`g_options_rows` (`0x005696E0`): eleven `{row record *, handler}` pairs; a
record is `{s8 col, s8 row, pad[2], char *label}` `[proved]`. Columns are
16 pixels and lines 24 (`OptionsDrawText`). The `"OPTIONS"` record at
`0x00569680`, just before the table, is referenced by no instruction and is
not drawn -- the title is sprite `0xB31` instead `[proved]`.

| # | label | at | handler | edits | range |
|---|---|---|---|---|---|
| 0 | Difficulty | (2, 3) | `OptionsRowDifficulty` `0x00487320` | `g_option_difficulty` `0x009C9F20` | 0..4, wraps both ways; "Very Easy" "     Easy" "   Normal" "     Hard" "Very Hard" at column 29 |
| 1 | Life | (2, 4) | `OptionsRowLife` `0x004873E0` | `g_option_lives` `0x009C9F21` | 0..4, wraps; drawn +1 ("1".."5") at column 37 |
| 2 | Continue | (2, 5) | `OptionsRowContinue` `0x004874A0` | `g_option_credits` `0x009C9F25` | 1..9 wrapping; **0..9 with 0 = free play (-1) only when `g_option_unlocks & 7 == 7`**; "Free Play" at column 29, a digit at 37 |
| 3 | Blood Color | (2, 6) | `OptionsRowBloodColor` `0x00487250` | `g_option_blood_color` `0x009C9F22` | 0..1 "  Red"/"Green" at 33 -- **never shown** |
| 4 | Sight Graphic | (2, 7) | `OptionsRowSightGraphic` `0x004875D0` | each record's `+0x00` | 0..3 per player, wraps |
| 5 | Sight Speed | (2, 8) | `OptionsRowSightSpeed` `0x004878E0` | opens a sub-screen | -- |
| 6 | Sound Test Special Effects | (2, 9) | `OptionsRowSoundTestSe` `0x00487910` | plays | 0..`0x2EE` |
| 7 | Sound Test Music | (2, 10) | `OptionsRowSoundTestMusic` `0x00487A50` | plays | 0..`0x12` |
| 8 | Gun Calibration | (2, 11) | `OptionsRowGunCalibration` `0x00487B50` | opens a sub-screen | -- |
| 9 | Default | (2, 12) | `OptionsRowDefault` `0x00487B80` | the factory settings | -- |
| 10 | EXIT | (15, 18) | `OptionsRowExit` `0x00487C00` | saves and leaves | -- |

Every edit writes the profile **at once**, not at EXIT `[proved]`: each value
row stores its setting in the same arm that wraps its copy.

**The Blood Color row never appears.** `g_options_blood_row_shown`
(`0x007DD030`) has exactly one store in `.text`, the arm's 0 at `0x00486B14`,
and `g_options_row_shift` (`0x007DD028`) exactly one, the arm's -1 at
`0x00486B1A` `[proved]`: the row is skipped by the cursor, not drawn, and every
row below it is drawn one line up. And `g_option_blood_color` has **no reader
but the arm's copy** -- every direct, indexed and based operand covering
`0x009C9F22` was searched, and the pointer dwords of every section -- while
`FUN_0040A920` writes 1 over it at every boot, after the load (`0x0040A99B`)
`[proved]`. So in this build it is 1 ("Green") and changes nothing.
`render/bloodcolour.ts`'s claim that the option "loads one bank over the
other" is therefore not this exe's: nothing here loads `scr_blood_red.bin`
by it `[open]` who does.

### The cursor

`OptionsMoveCursorTask` `[proved]`:

```
calibration = (gun[0]==1 && mode[0]!=6) || (gun[1]==1 && mode[1]!=6)
sightSpeed  = gun[0]==0 || gun[1]==0
if OptionsPadPressed(0x100010):          # up, either player
  PlaySoundId(0xA9); cursor--
  3 -> 2 unless the blood row shows; 8 -> 7 unless calibration;
  5 -> 4 unless sightSpeed; <0 -> 10
if OptionsPadPressed(0x200020):          # down
  PlaySoundId(0xA9); cursor++
  3 -> 4 unless shown; 8 -> 9 unless calibration; 5 -> 6 unless sightSpeed;
  >10 -> 0
if cursor moved and the old row was 6 or 7:
  PlaySoundId 0x80000000, 0x80000002, 0x80000001, then 0xA9
```

`gun` is `g_player_input_is_gun`, `mode` the PC input mode
(`GetPlayerInputModes`). Up and down are both tested in one frame.

### The input

`OptionsPadPressed` (`0x00488200`, 18 callers, all here) is 1 if any
direction in its mask was **pressed this frame**: up `0x10`, down `0x20`,
right `0x80`, left `0x40` in `g_pad_state`, player 2's shifted 16 -- or the
same directions in the low byte of `g_pad_aux_state` (`0x009A37A8`) as 1, 2,
8, 4 (player 2's 0x10, 0x20, 0x80, 0x40) `[proved]`. On the PC keyboard those
pad bits are the arrows (player 1) and W S A D (player 2)
(`KeyboardReadAsPad`).

The value rows use the either-player masks `0x800080` (right) and
`0x400040` (left). Sight Graphic uses each player's own. The confirm tests
read `g_pad_state` directly: `0xC000C` (A or START, either player) for Sight
Speed, Gun Calibration and EXIT; `0x40004` (A) for the sound tests; `0x40004`
or player 1's `8` for Default `[proved]`.

`OptionsHoldRepeatTick` (`0x00487C40`): a count at `0x009C8E36` climbs to 30
while right is **held** (`g_pad_held & 0x80` or `0x800000`, or `0x009A37A0 &
0x88`), falls to -30 while left is, and is 0 otherwise; the two sound-test rows
step once a frame while it sits at either end `[proved]`.

### The rows' handlers, in the order they run

* **Difficulty / Life / Blood Color**: draw, and when highlighted: right
  `++`, left `--` (each `PlaySoundId(0xA9)`), then wrap and store
  (`> 4 -> 0`, `< 0 -> 4`; Life's test is `>= 5`; Blood's `> 1 -> 0`,
  `< 0 -> 1`) `[proved]`.
* **Continue** (`0x004874A0`): `unlocked = (g_option_unlocks & 7) == 7`.
  Draw "Free Play" at column 29 when the copy is 0, else its digit at 37.
  Highlighted: right `++`, left `--`, then with `unlocked`:
  `> 9 -> 0, credits = -1`; `< 0 -> 9`; `0 -> credits = -1`; else
  `credits = v`. Without: `> 9 -> 1`; `< 1 -> 9`; else `credits = v`
  `[proved]`. So **free play cannot be chosen until all three unlock bits
  are set**, and a step away from it cannot come back.
* **Sight Graphic** (`0x004875D0`): for each player, "editable" is `(gun ==
  0 && pad_kind != -1) || mode == 6`. Draws via `OptionsDrawSprite` "1P"
  `0x5B9` at `(464, y + 10)` with `sy` 0.7, player 1's crosshair
  `g_crosshair_sprites[copy]` at `(506, y + 7)`, "2P" `0x5BA` at 544 and
  player 2's `g_crosshair_sprites[copy + 4]` at 584 -- alpha 0.5 for a player
  who is not editable. Highlighted, each editable player's **own** right
  (`0x80` / `0x800000`) and left (`0x40` / `0x400000`) step their copy; both
  wrap 0..3 and both are stored (`0x009C9F60`, `0x009C9FDC`) `[proved]`.
* **Sight Speed / Gun Calibration**: nothing drawn; highlighted and
  `0xC000C`, `PlaySoundId(0x3016A9)` and the frame pointer to the sub-screen
  `[proved]`.
* **SE test** (`0x00487910`): "No." at column 32, `OptionsDrawNumber(35, ...)`.
  Highlighted: `OptionsHoldRepeatTick`; right or the count at 30 `++`, left
  or -30 `--`; `> 0x2EE -> 0`, `< 0 -> 0x2EE`; and A (`0x40004`):
  `SndLoadPackStubbedOut(pack, 0, 3)` when the entry's pack is not -1 (an empty
  function on the PC), `PlaySoundId(0x80000002)`, `(0x80000001)`, then
  `g_options_se_test_table[n].id` `[proved]`.
* **Music test** (`0x00487A50`): the same over 0..`0x12`, and A plays
  `g_options_music_test_table[n]` with **no** stop first; entry 0 is
  `0x80000000` itself `[proved]`.
* **Default** (`0x00487B80`): `OptionsFactoryReset`, then the working copies
  again -- difficulty, life, credits (-1 as 0), `0x009C8E35`, and per player
  the sight graphic and `0x009C8E28` (a sight-speed copy nothing reads).
  Blood Color's copy and the sound tests are **not** retaken. No sound
  `[proved]`.
* **EXIT** (`0x00487C00`): `PlaySoundId(0x121A9)`, `ProfileSaveAndApply`,
  `g_nRunPhase = 2` `[proved]`.

### The draw

`OptionsDrawListTask` (`0x00486DA0`) `[proved]`:

1. `ScreenIdleDim` (`0x00413CC0`).
2. `OptionsDrawBackground(0)` (`0x00488090`): twenty 128x128 tiles `0x7A`..`0x8D`
   (`scr_back2.bin`), five across and four down from the top-left, depth 200.
   Argument 1 is `0xA7D`.. (`scr_back4`), 2 is `0x8E`.. (`scr_back3`).
3. `DrawScreenSprite(0xB31, 344, 16, 1.0, 1, 1, 0, 6)` -- "OPTIONS", 256x64,
   anchor 6: centred across, the top edge at 16.
4. For rows 0..9 the label, `OptionsDrawText(col, line, label, flags)`:
   * highlighted: flags `0x111` -- red (`0x10`), depth 0.9 (`0x100`);
   * otherwise 1; Sight Speed 9 (alpha 0.5) while no player may use it;
   * Blood Color only while shown, at its **unshifted** line;
   * Gun Calibration only while offered; Default at **row 8's** line when it
     is not (`[0x00569720]`) -- so the rows close up;
   * every row from 4 on at `line + g_options_row_shift`.
5. Row 10: `SetRenderLightColour(1, 0, 0)` when highlighted, then
   `DrawScreenSprite(0x803, 320, 18*24 - 4, 1.0, 1, 1, 0, 0x200A)` -- "EXIT",
   boxed, 128x64, centred -- and `SetRenderLightColour(1, 1, 1)`.
6. After each label, that row's handler.

**Bit `0x2000` of a sprite's flags lights it.** `SubmitScreenSpriteQuad`
(`0x004ACD20`) tests `DH & 0x20` at `0x004ACE27`: set, the quad's vertex
colour is `alpha << 24 | r << 16 | g << 8 | b` from `g_render_light_colour_r`
.. `b` (`0x007E7998`, what `SetRenderLightColour` writes), each times 255;
clear, it is white `[proved]`. That is how the highlighted row and EXIT come
out red. No sprite the port drew before this screen sets the bit.

`OptionsDrawText` (`0x00487CA0`) `[proved]`:

```
x = flags & 2 ? 320 - len*8 : col*16         y = row*24
flags & 4:     x = col, y = row, both scales 0.8
flags & 8:     alpha 0.5
flags & 0x10:  SetRenderLightColour(1, 0, 0)
flags & 0x40:  SetRenderLightColour(0.6, 0.6, 0.6)
flags & 0x100: depth 0.9
each character, through OptionsDrawSprite(id, x, y', depth, s, s, 1, alpha, 0x2000):
  a..z   g_options_glyphs[c] at y + 7
  A..Z   at y; C and G at x - 3 unless flags & 0x80
  '~'    0x7F2 (scr_opt_moji01)
  other  g_options_glyphs[c] if non-zero
  x += 16
SetRenderLightColour(1, 1, 1)
```

Bit 0 of the flags, which every caller sets, is tested nowhere. The rotation
word passed is 1 for glyphs and 0 elsewhere; the port does not carry it
`[open]` what `+0x28` does to a quad.

`g_options_glyphs` is `[char*2 + 0x0056AED0]`, but the table is only the 96
entries from `0x0056AF10` (characters `0x20`..`0x7F`): below that the address
falls inside `g_options_se_test_table`, which ends exactly at `0x0056AF10`,
and no character below `0x20` reaches the routine. Digits are `0x76C`..,
`A`..`S` `0x776`.., `T`..`Z` `0x7A3`.., `a`..`z` `0x789`..; every other entry,
the space and `.` included, is 0 and draws nothing `[proved]`. All are
`scr_opt_moji05.bin`, white, 16x32 -- but `W` (`0x7A6`), which is 32x32 and,
advancing 16 like every character, runs into the next.

`OptionsDrawNumber` (`0x00487EE0`): hundreds at `col*16` if > 0, tens at `+16`
if > 0 or `n >= 100`, units at `+32` -- the glyphs of `'0' + d`, depth 1,
flags 0 (unlit) `[proved]`.

`OptionsDrawSprite` (`0x00488000`): `DrawScreenSprite`'s record with every
field the caller's -- depth, both scales, rotation word, alpha, flags -- and
nothing drawn for a negative id `[proved]`.

### The idle dimmer

`ScreenIdleDim` (`0x00413CC0`), called by the title, this list, both
sub-screens and three more screens: any bit of `g_pad_held` or
`g_pad_aux_held` zeroes `g_screen_idle_frames` (`0x007C1EB0`); otherwise it
counts up, and past 18000 frames (five minutes) asset slot `0x93E`
(`pol/common.bin` 129) is drawn translated `(0, 0, -0.2)`, scaled `(1, 2, 1)`,
at alpha `(n - 18000) * 0.01` capped at 0.6; the count is held at `0x468C`
`[proved]`. `ScreenIdleReset` (`0x00413DA0`) zeroes it.

## The sub-screens

Both are the frame pointer's, not new app states.

**Sight Speed** (row 5): `OptionsSightSpeedArm` (`0x004882D0`) takes each
player's pad kind, zeroes `0x009A34DC`, and for each player on a **standard
controller** -- `g_player_input_is_gun` 0 with a pad kind -- opens a slot:
the crosshair at `(-160, -120)` or `(160, -120)` in the device and aim records
and the slot's speed from the option record `[proved]`.
`OptionsSightSpeedFrame` (`0x00488430`) **first** returns to the list with the
cursor on EXIT if either pad kind changed or both are -1; then `ScreenIdleDim`,
background 1, `0xB32` "OPTIONS/" at (116, 16) and `0xB33` "Sight Speed" at
(348, 20) at depth 2, each open slot's crosshair moved by `PadMoveCrosshair`
(`OptionsSightSpeedMoveCrosshairs`, `0x00488520`), the slider
(`OptionsSightSpeedAdjust`, `0x004885B0`: B held raises the speed 0.025 a
frame, A lowers it, once A has been seen up; clamped 0..1; knob `0xA91`/`0xA92`
at `(speed*280 + 206, p*160 + 164)`, slider `0xA93`/`0xA94` at
`(320, (p+1)*160)`), then `0xA7B` "(A) ...... SLOW", `0xA7C` "(B) ......
FAST" and `0x829` "PRESS START TO ENTER YOUR SELECTION/ RETURN TO OPTIONS";
START stores each open slot's speed and returns `[proved]`.

**Gun Calibration** (row 8): `OptionsCalibrationEntry` (`0x00485F90`) takes
player 1 if a gun outside input mode 6, else player 2 if one; neither goes
back to the list with the cursor on EXIT `[proved]`. The screen behind it --
`OptionsCalibrationArm` `0x00486020`, `OptionsCalibrationFrame` `0x00486160`,
the nine-state `OptionsCalibrationStep` `0x00486450` (jump table
`0x004867F0`), `OptionsCalibrationDrawCheck` `0x00486820`,
`OptionsCalibrationDrawHints` `0x004868D0` -- has the player shoot three
targets, (56, 48), (584, 432) and (320, 240) on screen, writing the raw aim of
each into the aim record's calibration words; START copies them into the
option record at `+0x68` (the PC's slot: `0x009C911C` is always 1). Only
`PlaySoundId(0x3016A9)` sounds, at the confirm `[proved]` (read by a
sub-agent in full, spot-checked here: the table and the frame's head).
**Mode 6 never reads the calibration**: `PollPlayerAimInput` maps a mode-6
mouse through a fixed table `[proved]`.

## The profile

### The block

One block, `g_profile_block` `0x009C9120`..`0x009CA06C` (`0xF4C` bytes)
`[proved]`:

| offset | what |
|---|---|
| `0x009C97A0`..`0x009C9F1F` | twelve ranking tables (`FUN_0041C490`) |
| `0x009C9F20` | `g_option_difficulty` |
| `0x009C9F21` | `g_option_lives` |
| `0x009C9F22` | `g_option_blood_color` |
| `0x009C9F23/24/26/27` | written by `ProfileFactoryReset` only; read nowhere `[open]` |
| `0x009C9F25` | `g_option_credits` |
| `0x009C9F28` | `g_option_unused_9F28` -- written only by `OptionsFactoryReset`, read only into a copy nothing reads `[open]` |
| `0x009C9F29`..`0x009C9F3B` | the Training and Boss Mode grades |
| `0x009C9F3D`..`0x009C9F5D` | `g_profile_original_items` |
| `0x009C9F5E` | `g_option_unlocks` |
| `0x009C9F5F` | set by the stage-6 boss's Original kill; no reader |
| `0x009C9F60 + p*0x7C` | each player's options record (below) |
| `0x009CA058..5E` | written by `ProfileFactoryReset`; `[open]` |
| `0x009CA05F` | `g_profile_version`, 7 |
| `0x009CA068` | `g_profile_checksum` |

Each player's record: `+0x00` the Sight Graphic, `+0x04` f32 the Sight Speed,
`+0x08` four binding sets of five pad masks, `+0x58` and `+0x68` two
calibration slots, `+0x78` `g_player_no_damage`, `+0x79`
`g_player_infinite_ammo`, `+0x7A` `[open]` `[proved]`.

### The factory settings

`OptionsFactoryReset` (`0x00401130`) copies from `.data`
`g_options_factory` (`0x004C42A0`: difficulty 2, life 2, credits **5**, sight
graphic 0), `0x004C4368` (0) into `0x009C9F28`, and per player the sight speed
0.5 (`0x004C42A4`), all forty binding masks of `g_input_bindings_default`
(`0x004C42A8`) and the eight calibration dwords of `g_gun_calibration_factory`
(`0x004C4348`) `[proved]`. Its callers: `ProfileFactoryReset`'s tail,
`ProfileLoad`'s failure arm (so it runs twice there), and Default.

`ProfileFactoryReset` (`0x00401060`) resets the rest of the block (see its
row) and then calls `OptionsFactoryReset`; only `ProfileLoad`'s failure arm
calls it `[proved]`.

### Load, save and apply

The boot is `WinMain`'s init callback `0x0049E4A0` (annotated
`ReadIniFlushSettings` for its last job): `FUN_004ABE80`, then
`FUN_0040E4A0` -- `ProfileLoad`, then the data-segment reset `FUN_0040A920`,
which runs `ProfileApplyToRun` (`0x0040A931`) and writes
`g_option_blood_color = 1` (`0x0040A99B`), then `g_app_state = 0x10` -- then
Hod2.ini `[proved]`.

`ProfileLoad` (`0x004A0B60`): `ProfileReadFiles` (four `0x3DB`-byte files,
`g_profile_file_names` `0x005985C4`: `pol/bg_adv19.bin`,
`tex/scr_tod_itm_itamidome2.bin`, `pol/komono_0.bin`, `pol/tv2.bin`),
`ProfileCipher` over `0xF4C`, and the block is taken only if
`ProfileChecksum` over `0xF48` equals `g_profile_checksum` and the version is
7 -- then `FUN_0041C490(1)` copies the rankings out of it. Otherwise
`ProfileFactoryReset`, `OptionsFactoryReset`, version 7 `[proved]`.

`ProfileCipher` (`0x004A06F0`): `buf[i] ^= (key[i % 176] * (i & 0xFF) - 0x24)`
with a 176-byte key built on the stack; its own inverse. `ProfileChecksum`
(`0x004A06C0`) is 0 minus the byte sum `[proved]`. **The install's own four
files decipher to a block whose sum matches and whose version is 7** --
`tools/verify_options.py` does it every run. The files are disguised as game
data and `ProfileWriteFiles` stamps each with `pol/st_adver07.bin`'s file
times.

`ProfileSave` (`0x004A0BD0`): checksum, cipher, `ProfileWriteFiles`, cipher
back. Only `ProfileSaveAndApply` (`0x004011F0`) calls it, which is
`FUN_004A0C10` (returns 1, ignored), `ProfileSave`, `ProfileApplyToRun`
`[proved]`. It runs at: the options' EXIT; the program's exit; the Original
Mode game over at fly-over frame `0xC6`, after copying
`g_original_items_taken` into the block; run phase 8 after the ending;
the Boss Mode step; the Training result; and the end of name entry `[proved]`.

`ProfileApplyToRun` (`0x0040AB50`): `g_start_lives =
g_start_lives_by_option[g_option_lives]`; `g_difficulty =
(s16)g_option_difficulty`; the grades into their live copies;
`g_original_items_taken` from the block; `0x009A2440 = 5`; and
`AimRecordsReset` (`0x0040CB10`) -- aim positions and triggers zeroed, the
calibration copied into the aim records `[proved]`.

## Who reads each setting

| setting | readers `[proved]` |
|---|---|
| difficulty | `ProfileApplyToRun` -> `g_difficulty` -> spawn hit points (`g_difficulty_hp_delta`) and `ResetDamageRank`'s starting rank; netplay's sync |
| life | `ProfileApplyToRun` -> `g_start_lives` -> `PlayerEnterPlay` |
| credits | `ModeStartCounterValue` (an Arcade start's credits, `+1`, or free play) |
| blood colour | none |
| `0x009C9F28` | none |
| unlocks | only the Continue row |
| sight graphic | `HudDrawCrosshair` (`MOVSX EDX, byte ptr [EDX]` at `0x00416AC8`: `g_crosshair_sprites[setting + p*4]`) |
| sight speed | `PadMoveCrosshair` (a keyboard or pad crosshair) |
| bindings | `PollPlayerAimInput`, `PlayerFireAndReloadUpdate`, `PadMoveCrosshair` |
| calibration | `AimRecordsReset` -> `PollPlayerAimInput`'s gun arm, modes other than 6 |

**Free Play's three unlock bits** (`g_option_unlocks`): `1` from
`Class2DState5`'s kill arm in Original Mode (the stage-6 boss, class `0x2D`);
`2` from `FUN_00498ED0` once all ten Training grades are at least 1; `4` from
`BossModeRecordGrade` once all ten Boss Mode grades are `[proved]`.

## In the port

* **The page's players are mouse guns in PC input mode 6** -- the mouse with
  the keyboard ORed into its pad word (`InputMapDevicesToMaple`, whose case 6
  ORs and falls into case 5 `[proved]`). The page's Enter is START and, on
  this screen, its arrows are the directions -- player 1's keys in
  `KeyboardReadAsPad` -- and a click is A (the mouse's left button,
  `MouseReadButtons`). `g_input_mode` was 5 until this screen; 6 is what
  lets a player change their Sight Graphic and what takes Gun Calibration off
  the list.
* **Neither sub-screen is reachable.** Sight Speed needs a player on a
  standard controller and Gun Calibration a gun outside mode 6; the port has
  neither, the cursor steps over both rows, and each sub-screen's first test
  sends it back. The port has those tests (`OptionsSightSpeedFrame`'s,
  `OptionsCalibrationEntry`'s) and not the screens behind them, which need an
  aim-record model -- a keyboard crosshair, a raw gun position -- that the
  port's pointer does not have.
* **Free play is the boot's, by the user's choice** (`ProfileBoot`'s
  `[diverges]`): a profile with nothing saved starts at -1. Default still
  writes 5, and the Continue row -- faithfully -- will not go back to free
  play without the three unlock bits, none of which the port can set (no
  Training or Boss Mode stage exists in any bundle).
* The profile the port keeps is the options, the unlocks, each player's
  record and the saved Original items -- what `G` has. The rankings and the
  grades are not.
* **Reaching it.** The page has no title screen: the menu's Options asks
  for `0x0C` from the game, and the title EXIT asks for is the page starting
  the stage again -- the same "game started from the title" every load is.
* **Drawing it.** The screen's sprites are recorded in
  `G.g_screen_sprite_draws`; the HUD canvas draws those at depth 1 and nearer
  (the text, the title, EXIT), multiplying a lit one by its tint, and the deep
  layer the background at 200. The idle dimmer's slot `0x93E` is exported and
  drawn by `render/screen_idle_dim.ts`; how it layers against the 2D quads is
  `[open]`.
