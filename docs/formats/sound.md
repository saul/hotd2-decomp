# Sound: ids, tables and BGM

**Status:** the id space and the BGM tables are solved. SE and voice use the
same dispatcher and their tables are located but not yet transcribed. What
starts a stage's own music is **open**.

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
| `1` | **BGM** | `id & 0xFFF` indexes a table of `char *` filenames. Prefix from `0x00588B58` |
| `2` | voice | `(id & 0xFFF) * 0x24` into the records at `0x0058044A`; a `s16` of `-1` marks an empty slot, name at `+2`. Prefix `Sound\Voice\` |
| `8` | control | `0x80000000` stops playback and clears `g_current_bgm_id` |

`id == 0` early-outs. That is how a script says *no sound* — it is not track 0.

Three ids are special-cased in the SE path: `0x000100A0` is
`SS_SND_ALL_SOUND_OFF`, and `0x21A9` / `0x121A9` take a different argument set.

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

`g_app_state == 6` is **in play** — see `docs/re/addresses.md`. What is not
settled is the other half: the only writers of `g_GameMode` (`0x009CA08C`) that
write **0** are `RunAttractDemo` and the two attract screens `FUN_0041F9B0` and
`FUN_0041FB00`, and the attract demo runs at `g_app_state` 5, not 6. So on the
reading above the plain table would never be selected at all. Either
`g_GameMode` is left at 0 on some path into play that has not been read, or the
plain table is dead in the shipped build. **[open]**, and worth an hour: it
decides whether twenty tracks ever play.

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

## `bgm_entry_play` (`0x5F`)

**[proved]** `EvtOpBgmEntryPlay5F` → `BgmStopThenPlay` (`0x0041D450`) is:

```c
OutputDebugStringA("SS_Event_ENTRYBGM_BG_core");
PlaySoundId(0x80000000);      /* stop */
PlaySoundId(operand[2]);      /* play */
```

The instruction is 5 dwords — four operands — and **only the third is used**.

**[measured]** Every `bgm_entry_play` across the six stage scripts:

| Track id | Index | AR name | Stages |
|---|---|---|---|
| `0x10000005` | 5 | `BOS_AR` | 1, 2, 3, 4, 5, 6 |
| `0x1000000E` | 14 | `ST5_BOS2_AR` | 5 |
| `0x1000000F` | 15 | `ST6_BOS2_AR` | 6 |
| `0x10000010` | 16 | `ST4_AR` | 4 |
| `0x10000012` | 18 | `ST5_AR` | 5 |
| `0x10000013` | 19 | `ST6_AR` | 6 |
| `0x00000000` | — | *(none)* | 2, 3, 4, 5, 6 — the `id == 0` early-out |

## Open: what starts a stage's own music

**[open]** Note what is missing from that table: **no stage script starts its
own stage track.** Stage 2's script only ever plays `BOS_AR`; stage 1's only
`BOS_AR`. The tracks named `ST1_AR`…`ST6_AR` are started somewhere else.

`PlaySoundId` has 496 callers, overwhelmingly SE, so finding it by xref is not
practical — it wants the scene-entry path instead. Candidates not yet checked:
the scene state table at `0x00576C14` (row 1 installs camera hooks, and may
install more), and `FUN_0040A6F0` / `FUN_00407950`, which each make long runs
of consecutive `PlaySoundId` calls in the event-system address range.

Until that is traced the browser player names the stage track by convention —
index `{1: 1, 2: 0, 3: 17, 4: 16, 5: 18, 6: 19}` — and labels it as *not*
script-driven so the inference is visible rather than assumed.

## Addresses

| Address | Symbol | Role |
|---|---|---|
| `0x0041CFD0` | `PlaySoundId` | the dispatcher |
| `0x0041D450` | `BgmStopThenPlay` | evt `0x5F`'s target |
| `0x0041D3E0` | — | stop, reached through nibble 8 |
| `0x00580354` | `g_bgm_names_ar` | `char *[41]` |
| `0x005803F8` | `g_bgm_names_plain` | `char *[20]` |
| `0x005845F8` | `g_se_name_list` | `{u32 id; char[0x30]}`, `0xFFFF`-terminated |
| `0x0058044A` | `g_voice_records` | `0x24`-byte records |
| `0x00588B58` | `s_sound_bgm_prefix` | the `Sound\BGM\` path prefix |
| `0x009C8FB8` | `g_current_bgm_id` | id currently playing; cleared by the stop |
| `0x009C8E98` | `g_app_state` | the top-level screen; **6 is in play**, so the plain table is the one a stage being played uses. See `docs/re/addresses.md` |
