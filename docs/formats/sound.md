# Sound: ids, tables and BGM

**Status:** the id space, the BGM tables, the **looping-SE pairs**, the
**music stream and its loop**, and the three control words are solved. SE and
voice use the same dispatcher and their name tables are read by
`ExeTables.se_names()` / `.voice_names()`. Each stage's own music is started by
its script -- see [what starts a stage's own music](#what-starts-a-stages-own-music).

Audio ships as plain `.wav` under `sound/` — `bgm/` (38 files, 270 MB),
`SE/` and `voice/`. There is no container and no compression; the NAOMI sound
driver was replaced wholesale for the PC port (see the `0x5D`/`0x5E` stubs in
[`evt.md`](evt.md)).

Implemented in `ExeTables.bgm_names()` / `.bgm_file()`; consumed by the browser
player, which streams tracks straight out of the install.

---

## One id space, split by the top nibble

**[proved]** `PlaySoundId` (`0x0041CFD0`) is the single entry point for every
sound in the game. It switches on `id >> 28`:

| Nibble | Kind | Lookup |
|---|---|---|
| `0` | SE | linked list at `0x005845F8`, stride `0x34` = `{u32 id; char name[0x30]}`, walked comparing `id`, terminated by `id == 0xFFFF`. Prefix `Sound\SE\` |
| `1` | **BGM** | `id & 0xFFF` indexes a table of `char *` filenames. Prefix from `0x00588B58`. Streamed on channel `0xF` -- see [the music stream](#the-music-stream-no-loop-points) |
| `2` | voice | `(id & 0xFFF) * 0x24` into the records at `0x0058044A`; a `s16` of `-1` marks an empty slot, name at `+2`. Prefix `Sound\Voice\`. Channel `0x10`, unlooped |
| `8` | control | `PlaySoundControl` (`0x0041D3E0`): stops one group -- see [control words](#control-words) |

`id == 0` early-outs. That is how a script says *no sound* — it is not track 0.

Three ids are special-cased in the SE path: `0x000100A0` is
`SS_SND_ALL_SOUND_OFF`, which goes to `SoundCommand(0, 0x100A0)`
(`0x004ABF80`) -- and **that does nothing**: the command switch has no arm for
it and falls to `return 0` (`0x004ABFAC`-`0x004ABFC1`, by disassembly).
`0x21A9` / `0x121A9` go to channel `0x11`, unlooped, skipping the loop walk.

## Control words

**[proved]** `PlaySoundControl` (`FUN_0041D3E0`) tells three apart, and
`PlaySoundId` then zeroes `g_current_bgm_id` for exactly `0x80000000`:

| Id | Stops | How |
|---|---|---|
| `0x80000001` | every SE channel, 0-14, loops included | `SoundCommand(1..3, 0x1100A0)` → `SoundChannelsRelease(0, 14, 1)` |
| `0x80000002` | **the voice**, channel `0x10` | `SoundStopGroup(g_voice_stop_group)` |
| anything else, `0x80000000` included | the music, channel `0xF` | `SoundStopGroup(g_bgm_stop_group)` |

`g_bgm_stop_group` (`0x009C90A8`) and `g_voice_stop_group` (`0x009C90AC`) are
0 and 1, written by `SoundStopGroupsInit` (`FUN_0040AD70`) and nothing else.
`SoundStopAll` (`FUN_0041D350`) is all three plus `g_current_bgm_id = 0`, and is
what `MarkSceneOver` and `ResetGameOnStart` call.

**`0x80000002` is not a music word.** It is what evt `0x2E` plays after a
cutscene skip, and that instruction was named `resume_bgm_if_skipped`: it is
`stop_voice_if_skipped`. The player's mixer took every namespace-8 id as a
music stop, so a skip silenced the stage's track for the rest of the scene.

## Looping SE — two tables, and no handle anywhere

**[proved]** Whether a sound effect loops is not a property of the file. Before
`PlaySoundId` hands a name to `SoundPlayOnFreeChannel` it walks two parallel
dword tables in step:

```
0x005887FC   u32[44]   g_looping_se_ids        play this one LOOPED
0x005888B0   u32[44]   g_looping_se_stop_ids   ...and this one stops every loop
```

```c
if (g_looping_se_ids != 0xFFFFFFFF) {
    i = 0; id = g_looping_se_ids;
    do {
        if (param_1 == id)                       { loop = 1; break; }
        if (param_1 == g_looping_se_stop_ids[i]) { SoundStopAllLoopingSe(); break; }
        id = g_looping_se_ids[i + 1]; i++;
    } while (id != 0xFFFFFFFF);
}
SoundPlayOnFreeChannel(name, loop, 0xFFFFFFFF, param_1);
```

`0x21A9` and `0x121A9` skip the walk entirely, on the same early branch that
gives them their own argument set.

**There is no handle for a playing loop, anywhere in the engine.**
`SoundStopAllLoopingSe` takes no argument; a stop id names which loop it was
*authored* for and stops the lot. Everything about how the game uses looping
sound follows from that — a loop is started by one call from wherever the thing
that makes the noise comes into existence, and stopped by another call from
wherever it stops existing, with a refcount in between if more than one object
can want it. See `g_weapon_loop_holders` (`0x009C8A74`) for the worked example.

**Neither table stores a count and neither bounds the other.** Both walk to a
`0xFFFFFFFF` terminator, and the two bases are `0xB4` = 45 dwords apart, so 44
entries plus the terminator exactly fill the gap. That is the *shape* of
[L6](../LESSONS.md), so the reading is checked rather than asserted:
`tools/verify_looping_se.py` proves the pairing four ways —

* both walks give the same 44 and fill the gap between the bases exactly;
* all 88 ids resolve through `g_se_name_list`;
* **every pair is `X.wav` against `X_OFF.wav`**, which is the assertion that
  could not pass by accident and is what makes the pairing a fact rather than
  an observation about two neighbouring arrays;
* and no `_OFF` file is shipped, while the play files are — so a stop id is a
  control word and not a sound.

Eight of the 44 rows repeat a play id already listed; the table's own tail is a
duplicate block. The engine breaks out of the walk on the **first** match, so
that is harmless only while both copies name the same stopper, and the verifier
asserts they do.

| Entry | Play | Stop | Used by |
|---|---|---|---|
| 4 | `0x004D17A9` `COMMON2\CHAIN_SAW_22` | `0x004E17A9` | `EnemyZombieInitByCharType`, character type 2 |
| 34 | `0x001F25A9` `STAGE6_SE\LASER_SWORD_22` | `0x002025A9` | ...and character type 3 |

and the rest are the game's ambiences — `UFO_44`, `RAIN3ST_44`, `QUAKE_22`,
`CAR_FIRE`, `BOAT_SLOW`, `HELI1_44`, `EREVATOR_16`, `WIND2_44`.

Exposed as `ExeTables.looping_se()` in both halves of the library and carried
into the bundle as `sound.looping`; `web/src/audio/bgm.ts` is the transcription
of the branch above.

**A looping SE is not streamed**, unlike the music: `SoundPlayOnFreeChannel`
opens every channel but `0xF` with `SoundChannelOpenWav(ch, name, 0, 0)`, a
static buffer filled once from the `data` chunk's own size, and plays it with
`DSBPLAY_LOOPING` (`SoundChannelStartBuffer`). So an SE loop is the data chunk
exactly -- no tail bytes, no shift -- and gapless. `[likely]` for the buffer
being exactly the data size: `FUN_004A4500`, which creates it, is passed that
size and has not been read. The player still loops SE on an `<audio loop>`
element, which is the same points with the element's seam at the join.

## BGM — two tables, chosen at runtime

**[proved]**

```
0x00580354   char *[41]   g_bgm_names_ar      the "_AR" mix
0x005803F8   char *[20]   g_bgm_names_plain   the plain mix
```

```c
if (g_app_state == 6 && g_GameMode == 0) name = plain[id & 0xFFF];   /* 6 == in play */
else                                     name = ar   [id & 0xFFF];
```

`g_app_state == 6` is **in play** — see `docs/re/addresses.md`. The other half
is settled now, and it was an enumeration error rather than a missing path:
**`g_GameMode == 0` is Arcade Mode.** So the plain table is the *arcade* mix
and the `_AR` one is what Original, Training and Boss get — which is the way
round the filenames do not suggest and the code does.

This used to read as `[open]` here, on the grounds that the only writers of
**0** were `RunAttractDemo` and the two attract screens, and that the attract
demo runs at state 5. Two things were missing from that list. The first is
`TitleMenuRunPhase` (`FUN_00496200`) at app state 4, which sets `g_GameMode =
0` on entry and is the screen the mode is *chosen* on:
`TitleMenuUpdateAndSelect` (`FUN_00496960`) writes rows 1, 2 and 3 over it and
row **0 — `tex\arcade00.bin` — leaves it there**, after which
`ResetGameOnStart` runs and the app state becomes 6. The second is
`NetworkModeRunPhase` (`FUN_0049F380`) state 7, which sets `g_app_state = 6`
and `g_GameMode = 0` in the same block. Both are ordinary in-play Arcade, and
all twenty plain tracks play. See the note on `GameMode` in
`web/src/game/game_mode.ts` for what fixes the four values.

**The two tables are contiguous, and that is what fixes their lengths.**
Neither is terminated and neither count is stored anywhere:
`0x005803F8 − 0x00580354 = 0xA4 = 41 entries`. The plain table's 20 entries are
bounded the same way by whatever follows it. Reading either with a guessed
count silently invents tracks.

| Idx | AR | plain | | Idx | AR | plain |
|---|---|---|---|---|---|---|
| 0 | `ST2_AR` | `ST2` | | 12 | `ENDL_AR` | `ENDL` |
| 1 | `ST1_AR` | `ST1` | | 13 | `ENDS_AR` | `ENDS` |
| 2 | — | — | | 14 | `ST5_BOS2_AR` | `ST5BOS2` |
| 3 | `CLR_AR` | `CLR` | | 15 | `ST6_BOS2_AR` | `ST6BOS2` |
| 4 | — | — | | 16 | `ST4_AR` | `ST4` |
| 5 | `BOS_AR` | `BOSS` | | 17 | `ST3_AR` | `ST3` |
| 6 | `NAM_AR` | `NAME` | | 18 | `ST5_AR` | `ST5` |
| 7 | — | — | | 19 | `ST6_AR` | `ST6` |
| 8 | `ADV_AR` | `ADV_AR` | | 20–39 | `HOD1_ADV`, `BOSS`, `CLR`, … `TRA_MOD` | *(AR table only)* |
| 9 | `OVR_AR` | `OVR_AR` | | 40 | `ITEM_SELECT.wav` | *(AR table only)* |
| 10 | `ST5_BOS1_AR` | `ST5BOS1` | | | | |
| 11 | `ST6_BOS1_AR` | `ST6BOS1` | | | | |

Indices 2, 4 and 7 are null in **both** tables and no shipped script names
them. Indices ≥ 20 exist only in the AR table.

**[measured]** Every non-null name resolves to a real file in `sound/bgm/`,
all 38 of them. Match case-insensitively: the tables spell `.WAV`, the files
are `.wav`, and `ITEM_SELECT.wav` is lowercase in the table too.


## The music stream: no loop points

**[proved]** There are no loop points in this game's music -- not in the
files, not in a table. A track is its file from the first sample to **end of
file**, played end to end for as long as it loops.

`PlaySoundId` hands every BGM id to `SoundPlayOnFreeChannel(name, loop, 0xF,
-1)` (`FUN_004AC020`). That releases channel `0xF`, and channel `0xF` alone is
opened **streamed**: `SoundChannelOpenWav(0xF, name, 1, 3000)` (`FUN_004A3EF0`;
the `PUSH 0xBB8; PUSH 1` at `0x004AC131`). The loop flag is `PUSH 1` at
`0x0041D21D` for every id except three -- see below.

`SoundChannelOpenWav` walks the RIFF chunks **counting bytes into the channel's
`+0x3C`**: `RIFF`'s tag and size, `WAVE` as a bare tag, `fmt `'s tag, size and
body (reading at most `0x12`), any other chunk skipped by its size **with no
word-alignment pad**, and at `data` the tag and size -- where it stops. So
`+0x3C` is the file offset of the first sample, **44 for every shipped track**.
It reads the data chunk's size and, streaming, never uses it. The ring is
`nAvgBytesPerSec * 3000 / 1000` rounded up to 64 bytes -- 264,640 for 22,050 Hz
16-bit stereo -- filled whole by `SoundStreamFill` (`FUN_004A3C70`), with
notifications at the half and at the end.

`SoundStreamThread` (`FUN_004A4640`) refills the half the play cursor has just
left with a raw `ReadFile`. A short read is **end of file**, and the thread
tests the loop bit that `SoundChannelStartBuffer` (`FUN_004A34B0`) set from
`PlaySoundId`'s flag:

```c
if (read != want) {
    if (ch->flags & 0x08000000) {                  /* 0x004A4991, 0x004A4AAF */
        SetFilePointer(ch->file, ch->dataStart /* +0x3C */, 0, FILE_BEGIN);
        ReadFile(ch->file, buf + read, want - read, &read, 0);
    } else {
        fill(buf + read, silence, want - read);    /* then stop, a half later */
    }
}
```

The wrap is made inside one refill, so it is **gapless**, and three things
follow from where it is made:

1. **The loop goes back to the very first sample.** Nothing plays once and
   then loops a later section. Most tracks are written to wrap -- `ST1_AR`
   ends at the same level it starts -- and a few (`ST2`, the endings) fade out
   and so audibly start over.
2. **The chunk after `data` is played as PCM.** Every shipped track ends in a
   `LIST` chunk of 12, 38, 40 or 62 bytes, and `ReadFile` does not know it is
   not audio: 3 to 15½ stereo frames of `"LIST"`, a size and `"INFO"...` reach the
   speaker between the last sample and the first -- a click, once a pass.
3. **A pass that is not a whole number of frames shifts the next.** The byte
   after end of file is the first sample's, written wherever the read stopped.
   A 38- or 62-byte tail leaves a pass `2 mod 4` bytes long, so every second
   pass starts one 16-bit sample late: **left and right exchanged**, until the
   pass after puts them back.

The initial fill is made before the loop bit is set, so a *looping* file
shorter than the ring would play once, then silence to the end of the ring,
and only then wrap. No shipped looping track is that short -- the shortest is
`ST6_BOS1_AR`, 8.3 rings -- and `tools/verify_bgm_stream.py` asserts it.

**[measured]** Before this was read, the player looped each track on an
`<audio loop>` element: the same points, since the element also returns to
the first sample, but it stopped at the end of the `data` chunk and it put
**8.4 ms of digital silence** at the seam of `ST1.WAV` (Chrome, headless). The
player now builds one period of the stream -- one pass, or two where a pass is
half a frame over -- and loops it in Web Audio; `tools/bgm_loop.mjs` renders
the wrap and finds every sample the stream's own.

### The three one-shots

**[proved]** `CMP EBX, imm32` at `0x0041D1FB`, `0x0041D205` and `0x0041D20D`
send exactly three ids to the `PUSH 0` at `0x0041D241`:

| Id | Name | Notes |
|---|---|---|
| `0x10000009` | `OVR_AR` (both tables) | `GameOverRunPhase` plays it |
| `0x10000025` | `CLR2` (`_AR` only) | 4.35 s |
| `0x10000014` | `HOD1_ADV` (`_AR` only) | |

A one-shot plays `[first sample, EOF)` once; the thread fills silence and
stops the buffer a half-ring later. Every other name in either table loops.

### Per track

`python3 tools/verify_bgm_stream.py --game-dir ...` prints this from the files
and the exe's own walk. Start is the file offset of the first sample; the loop
is always `[start, EOF)`.

| Track | Mode | Start | Data | Tail | Pass | Passes per period |
|---|---|---|---|---|---|---|
| `ADV_AR` | loop | 44 | 5,573,776 | 62 | 5,573,838 | 2 |
| `BOS_AR` | loop | 44 | 5,591,880 | 12 | 5,591,892 | 1 |
| `BOSS` | loop | 44 | 5,585,000 | 12 | 5,585,012 | 1 |
| `BOSS_MOD` | loop | 44 | 1,448,824 | 12 | 1,448,836 | 1 |
| `CLR` | loop | 44 | 1,659,832 | 38 | 1,659,870 | 2 |
| `CLR2` | **once** | 44 | 383,232 | 12 | 383,244 | -- |
| `CLR_AR` | loop | 44 | 1,751,408 | 38 | 1,751,446 | 2 |
| `ENDL` | loop | 44 | 9,468,804 | 12 | 9,468,816 | 1 |
| `ENDL_AR` | loop | 44 | 9,429,864 | 38 | 9,429,902 | 2 |
| `ENDS` | loop | 44 | 8,139,520 | 12 | 8,139,532 | 1 |
| `ENDS_AR` | loop | 44 | 8,232,800 | 38 | 8,232,838 | 2 |
| `HOD1_ADV` | **once** | 44 | 5,467,136 | 12 | 5,467,148 | -- |
| `ITEM_SELECT` | loop | 44 | 3,529,944 | 12 | 3,529,956 | 1 |
| `NAM_AR` | loop | 44 | 8,458,376 | 12 | 8,458,388 | 1 |
| `NAME` | loop | 44 | 7,528,844 | 12 | 7,528,856 | 1 |
| `OVR_AR` | **once** | 44 | 654,420 | 62 | 654,482 | -- |
| `RANK_MOD` | loop | 44 | 8,228,188 | 38 | 8,228,226 | 2 |
| `ST1` | loop | 44 | 13,350,028 | 38 | 13,350,066 | 2 |
| `ST1_AR` | loop | 44 | 12,941,772 | 38 | 12,941,810 | 2 |
| `ST2` | loop | 44 | 13,930,028 | 38 | 13,930,066 | 2 |
| `ST2_AR` | loop | 44 | 14,068,992 | 40 | 14,069,032 | 1 |
| `ST3` | loop | 44 | 8,024,252 | 12 | 8,024,264 | 1 |
| `ST3_AR` | loop | 44 | 6,774,632 | 12 | 6,774,644 | 1 |
| `ST4` | loop | 44 | 6,882,460 | 12 | 6,882,472 | 1 |
| `ST4_AR` | loop | 44 | 6,898,796 | 12 | 6,898,808 | 1 |
| `ST5` | loop | 44 | 11,582,072 | 12 | 11,582,084 | 1 |
| `ST5_AR` | loop | 44 | 11,628,700 | 12 | 11,628,712 | 1 |
| `ST5_BOS1_AR` | loop | 44 | 11,187,744 | 38 | 11,187,782 | 2 |
| `ST5_BOS2_AR` | loop | 44 | 7,372,740 | 38 | 7,372,778 | 2 |
| `ST5BOS1` | loop | 44 | 15,136,840 | 38 | 15,136,878 | 2 |
| `ST5BOS2` | loop | 44 | 9,322,932 | 62 | 9,322,994 | 2 |
| `ST6` | loop | 44 | 6,498,168 | 12 | 6,498,180 | 1 |
| `ST6_AR` | loop | 44 | 6,513,048 | 12 | 6,513,060 | 1 |
| `ST6_BOS1_AR` | loop | 44 | 2,205,284 | 38 | 2,205,322 | 2 |
| `ST6_BOS2_AR` | loop | 44 | 11,171,036 | 62 | 11,171,098 | 2 |
| `ST6BOS1` | loop | 44 | 2,554,020 | 38 | 2,554,058 | 2 |
| `ST6BOS2` | loop | 44 | 10,660,656 | 38 | 10,660,694 | 2 |
| `TRA_MOD` | loop | 44 | 2,894,156 | 12 | 2,894,168 | 1 |

All 22,050 Hz, 16-bit, stereo: a frame is 4 bytes, so a pass is `pass / 4`
frames, fractional where there are two passes per period.

### Every request reopens the file

**[proved]** `SoundPlayOnFreeChannel` with channel `0xF` stops and releases
whatever is on the channel and opens the file again from its first byte --
there is no "already playing" test. So playing the track that is already
playing **restarts** it. Stage 4 plays `ST4_AR` again with `bgm_entry_play`
at blocks 2, 6 and 14 -- a stop and then the same track, from the top each
time. `FUN_0040E500` behaves the same way: it toggles `DAT_009A1A00`, stops the
music and voice groups when it sets it and plays `g_current_bgm_id` when it
clears it -- so the track comes back from its first sample. `[likely]` that is
the in-game pause: it draws one of two screen sprites while set and releases
the SE channels every frame, but the sprite and the toggle's condition
(`FUN_0040E9C0`) have not been read.

## `bgm_entry_play` (`0x5F`)

**[proved]** `EvtOpBgmEntryPlay5F` → `BgmStopThenPlay` (`0x0041D450`) is:

```c
OutputDebugStringA("SS_Event_ENTRYBGM_BG_core");
PlaySoundId(0x80000000);      /* stop */
PlaySoundId(operand[2]);      /* play */
```

The instruction is 5 dwords — four operands — and **only the third is used**.
`bgm_entry_play 0` is therefore a stop: the play is `PlaySoundId`'s own nothing.

**[measured]** Every `bgm_entry_play` across the six stage scripts:

| Track id | Index | AR name | Stages |
|---|---|---|---|
| `0x10000005` | 5 | `BOS_AR` | 1, 2, 3, 4, 5, 6 |
| `0x1000000E` | 14 | `ST5_BOS2_AR` | 5 |
| `0x1000000F` | 15 | `ST6_BOS2_AR` | 6 |
| `0x10000010` | 16 | `ST4_AR` | 4 |
| `0x10000012` | 18 | `ST5_AR` | 5 |
| `0x10000013` | 19 | `ST6_AR` | 6 |
| `0x00000000` | — | *(none)* | 2, 3, 4, 5, 6 — a stop |

## What starts a stage's own music

**[measured]** **The script does, with `se_play`.** `se_play` (`0x38`-`0x3B`)
hands its operand to `PlaySoundId` like `bgm_entry_play` does, and every stage
script plays its own track at step 2 of each entry block:

| Stage | Where | Instruction | Track |
|---|---|---|---|
| 1 | block 0 step 2 op 34 | `se_play 0x10000001` | `ST1` / `ST1_AR` |
| 2 | block 0 step 2 op 0 | `se_play 0x10000000` | `ST2` / `ST2_AR` |
| 3 | block 0 step 2 op 39; block 7 step 2 op 41 | `se_play 0x10000011` | `ST3` / `ST3_AR` |
| 4 | block 0 step 2 op 0; block 4 step 2 op 0 | `se_play 0x10000010` | `ST4` / `ST4_AR` |
| 5 | block 0 step 2 op 0 | `bgm_entry_play 0x10000012` | `ST5` / `ST5_AR` |
| 6 | block 0 step 2 op 0 | `se_play 0x10000013` | `ST6` / `ST6_AR` |

Stages 2, 3, 4 and 6 open step 1 with `bgm_entry_play 0` -- a stop -- so the
previous music is silenced a step before the new track begins.

This section used to be an open question headed "no stage script starts its
own stage track", written from the `bgm_entry_play` table above alone -- while
this same document said `se_play` names nine BGM tracks. The browser player
started the track at load "by convention" on the strength of it, a step early,
and then ignored the script's own `se_play` of the same track because it was
already playing. `test:seek` now checks the table above against every bundle.

## Addresses

| Address | Symbol | Role |
|---|---|---|
| `0x0041CFD0` | `PlaySoundId` | the dispatcher |
| `0x0041D450` | `BgmStopThenPlay` | evt `0x5F`'s target |
| `0x0041D3E0` | `PlaySoundControl` | the namespace-8 arm: SE, voice or music |
| `0x0041D350` | `SoundStopAll` | all three groups and `g_current_bgm_id = 0` |
| `0x00401000` | `SoundStopGroup` | 0 music (channel `0xF`), 1 voice (`0x10`) |
| `0x004ABF80` | `SoundCommand` | `0x2A0` pause music, `0x3A0` resume it looped, `0x1100A0` release SE; `0x100A0` nothing |
| `0x004AC020` | `SoundPlayOnFreeChannel` | channel `0xF` streamed with a 3000 ms ring |
| `0x004A3EF0` | `SoundChannelOpenWav` | the header walk; `+0x3C` = first sample |
| `0x004A34B0` | `SoundChannelStartBuffer` | sets the stream's loop bit `0x08000000` |
| `0x004A4640` | `SoundStreamThread` | the refill, and the wrap at end of file |
| `0x004A3C70` | `SoundStreamFill` | the first fill (loop bit still clear) |
| `0x004A3B90` | `SoundStreamRewind` | seek to `+0x3C`, refill, position 0 |
| `0x007DE5A8` | `g_sound_channels` | `0x44`-byte channel records |
| `0x00580354` | `g_bgm_names_ar` | `char *[41]` |
| `0x005803F8` | `g_bgm_names_plain` | `char *[20]` |
| `0x005845F8` | `g_se_name_list` | `{u32 id; char[0x30]}`, `0xFFFF`-terminated |
| `0x0058044A` | `g_voice_records` | `0x24`-byte records |
| `0x00588B58` | `s_sound_bgm_prefix` | the `Sound\BGM\` path prefix |
| `0x009C8FB8` | `g_current_bgm_id` | id last opened on channel `0xF`; zeroed by `0x80000000` and `SoundStopAll`; the game's unpause replays it |
| `0x009C90A8` | `g_bgm_stop_group` | 0 |
| `0x009C90AC` | `g_voice_stop_group` | 1 |
| `0x009C8E98` | `g_app_state` | the top-level screen; **6 is in play**, so the plain table is the one a stage being played uses. See `docs/re/addresses.md` |
