# Sound: ids, tables and BGM

**Status:** the id space, the BGM tables and the **looping-SE pairs** are
solved. SE and voice use the same dispatcher and their name tables are read by
`ExeTables.se_names()` / `.voice_names()`. What starts a stage's own music is
**open**.

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
