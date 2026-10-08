# Original Mode: the items, the trunk, the weapons

Original Mode is Arcade Mode with an inventory. A run opens on a trunk
holding every item the profile has collected; each player takes up to two,
the items change the gun, the lives, the credits and the rules, and shooting
certain props during the stages collects more for the next run. This page
is that machinery as the exe runs it. Everything is `[proved]` from the
instruction stream unless it says otherwise.

The port is `web/src/game/original_mode.ts` (the block and the two item
routines), `web/src/game/class6e/` (the trunk), `web/src/game/player_gun.ts`
(the weapons) and the readers named below in their own class files.

## 1. The per-player block

`g_original_item_slots`, `0x009A2240`, stride `0x14`, one per player.
`ResetOriginalModeLoadout` (`FUN_0048A0D0`) fills both at the start of every
run, from the title's new-game arm (`CALL` at `0x0045FF48`).

| offset | global | reset | what writes it |
|---|---|---|---|
| `+0x00`, `+0x01` | `g_original_item_slots` | -1, -1 | the trunk |
| `+0x02` | `g_original_character` | the player index | a costume |
| `+0x03` | `g_original_score_multiplier` | 1 | DOUBLE SCORE: 2 |
| `+0x04` | `g_original_start_lives` | 3 | LIFE +2: 5, +5: 8 |
| `+0x05` | `g_original_life_cap` | 5 | LIFE +5: 8 |
| `+0x06` | `g_original_bonus_credits` | 0 | CREDIT: 2, 5, 10, -1 (∞) |
| `+0x07` | `g_original_fire_mode` | 0 | the guns |
| `+0x08` | `g_player_magazine_size` | 6 | the guns and CHAMBERs |
| `+0x09` | `g_original_weapon_kind` | 0 | BULLET BLOW 4, BASS LURE 5, the records |
| `+0x0A` | `g_original_weapon_sound_kind` | 0 | 4..7 |
| `+0x0B` | (flags) | 3 | POWER UPs, BULLET BLOW -- `[open]`: no reader found |
| `+0x0C` | `g_original_weapon_damage_scale`, f32 | 1.0 | the records; BULLET BLOW -1.0 |

`+0x08..+0x0B` are reset as one dword, `0x03000006`. Several of these are
written **only through the block base** (`(&g_original_fire_mode)[p*0x14]`
with the constant in an index register), so a search for `WRITE` xrefs to
the field's own address finds only the reset: that is how the port once
concluded the damage scale was always 1.0 (`L103`).

Five more bytes are global, not per player: `g_original_item_big_head`
(`0x009C88A8`, ROTTEN MEAT), `g_original_quarter_life` (`0x009C88A9`, LIFE
1/4), `g_original_first_aid` (`0x009C88AA`), `g_original_ufo_item`
(`0x009C88AB`, set and never read) and `g_original_item_part_scale`
(`0x009C88AC`, PRIMITIVE MEAT and TOY GUN).

## 2. The items

33 ids. `OriginalItemsApply` (`FUN_00415FE0`) turns a player's two slots
into the block at the hand-over; `OriginalItemsApplyOnJoin`
(`FUN_00416240`) is the join's weaker pass, which gives the gun back. The
weapon numbers come from `g_original_weapon_records` (15 records of 8
bytes at `0x004EC928`), exported as the bundle's `original_mode` block and
held to the install by `web/tools/checks/original_mode.ts`.

| id | item | effect | read by |
|---|---|---|---|
| 0-2 | SHOTGUN, MACHINE GUN, GRENADE | fire mode 1/2/3, magazine and damage from the record | `PlayerFireOriginalModeWeapon`; `ResolveHit`; GRENADE's kind 3 in `MarkActorShot` |
| 3-5 | POWER UP 1.2, 1.5, 2.0 | damage scale and `+0x0B` from the record | `ResolveHit` and the bosses' own damage routines |
| 6 | BULLET BLOW | kind 4, scale -1.0, sound 4 | `ResolveHit`: the actor's own hit points; bosses: double |
| 7-10 | CHAMBER +2, +4, +8, ∞ | the magazine from the record; ∞ is `0xFF`, -1, unlimited | `PlayerRefillMagazine` |
| 0x0B | AIR GUN | fire mode 0xC, 12 rounds (+ each CHAMBER over 6), sound 5 | the gun |
| 0x0C | TOY GUN | fire mode 0xD, sound 6, credits 5 (+ each CREDIT), part scale | the gun; the draws |
| 0x0D | BASS LURE | kind 5, sound 7 | the tracer's path arm, slot `0x109D` |
| 0x0E, 0x0F | LIFE +2, +5 | start lives 5 / 8, +5 also the cap 8 | the hand-over, continue, join; `GrantExtraLife` |
| 0x10-0x13 | CREDIT +2, +5, +10, ∞ | bonus credits; ∞ is free play | `ItemSelectApplyToPlayers` |
| 0x14 | PRIMITIVE MEAT | part scale | draws only |
| 0x15 | ROTTEN MEAT | big heads | four enemy inits (hit radius) and their hooks (draw) |
| 0x16-0x1B | AMY, HARRY, GOLDMAN, G, ROGAN, BRUNO | the character, `id - 0x14` | the player body, the figures |
| 0x1C | CIVILIAN | character 8 or 9, `rand() % 2` | as above |
| 0x1D | LIFE 1/4 | `g_original_quarter_life` | `ResolveHit`: damage ×4 |
| 0x1E | FIRST AID KIT | `g_original_first_aid` | five breakable-prop routines |
| 0x1F | UFO | `g_original_ufo_item` (unread) | `PropUpdateType77` asks `PlayerHoldsOriginalItem(0x1F)` |
| 0x20 | DOUBLE SCORE | multiplier 2 | `ScoreAddForPlayer` |

A fresh profile holds POWER UP 1.2, CHAMBER +2 and CREDIT +2, one each
(`ProfileFactoryReset`, stores at `0x004010C7/CD/D3`).

### What each reader does

* **Damage.** `ResolveHit` (`0x004094C8`..`0x00409527`): in Original Mode a
  scale of exactly -1.0 (`CMP [..], 0xBF800000`) makes the damage the
  actor's own `obj+0x11C`; any other multiplies the table's damage
  (`FILD`/`FMUL`), by 4.0 again under LIFE 1/4, and `__ftol` truncates. The
  bosses have their own copies -- `Class14ApplyBoneDamage`, Boss 3's head
  and body, `Boss4ResolveShot`, `Class22ChargeShots`, `Class23TakeShots`,
  `Class32ChargeShotBone` -- and every one takes -1.0 as *double*, which is
  why BULLET BLOW kills a zombie outright and only doubles on a boss.
* **The grenade's blast.** `MarkActorShot`'s last arm (`0x00404E87`): with
  weapon kind 3, sprite effect `0x53` (slots `0x125..0x13D`) at the hit
  point of a collision-mesh candidate, or on the near side of a sphere
  candidate, `radius - 1.0` towards the eye from its view-space centre.
  Every hit, a wall's included. The blast is a sprite; it hurts nothing.
* **Score.** `ScoreAddForPlayer` (`FUN_004156C0`) doubles every award and
  every penalty while the player's multiplier is 2.
* **Big heads.** `EnemyZombieInit`, `EnemyThrowerInit`, `OneHitTargetInit`
  and class 0x21's double bone 2's hit radius (`obj+0x3A4`; class 0x30's
  character type 0xE by 1.8), and install hooks that draw bone 2 under
  `MatrixScale(2, 2, 2)` -- `(1.8, 1.8, 1.0)` for type 0xE.
* **First aid.** In each of `BreakablePropUpdate` (`0x004648C3`),
  `KindedPropUpdate` (`0x00466120`, not models 0x13 and 0x16),
  `FallingContainerUpdate` (`0x0046A963`) and `PropUpdateType37`, the test
  sits in front of the destroy path's item-set release and replaces it with
  `SpawnExtraLifePickup`; `PlaceGenericProp`'s type-43 arm instead gives the
  prop item set 1 at placement.
* **Weapon-gated routes.** `PlayerHoldsOriginalItem` (`FUN_00461C70`) has
  four callers, `PropUpdateType73`, `76`, `77` and `StoryModeSwitchUpdate`:
  a door that opens only for a SHOTGUN, a GRENADE, a POWER UP 2.0 and so on
  asks for the item, not the weapon kind.

## 3. The trunk, class 0x6E

One `spawn_simple` record, `stage1_original` block 0 step 5, after
`asset_load_polfile 0x49` (`car_org.bin`: the trunk and its lid) and before
`wait_enemies_present 0`. The entry step is 5: the steps before it are the
script's `-1`-terminated prologue (`EvtGetStep`), which the exporter now
walks by the exe's index rather than by the stream.

`ItemSelectUpdate` (`FUN_00488820`), per frame:

1. First frame: `ITEM_SELECT.wav` (`0x10000028`), `g_enemies_present = 1`
   (holding the wait), the profile's items copied into
   `g_original_items_taken`, the list built.
2. The lid, under camera path `0x36`: `0x100` a frame to frame `0x5A`, with
   `TRUNK_16.wav` at 90. A skips it.
3. The menu, per player in play: the list (7 rows, scroll to `0x1A`) and the
   player's two slots with END, driven by the pad word -- A `0x4`, START
   `0x8`, up/down/left/right `0x10..0x80`, player 2's in the high half. A
   takes the row's item out (count down one) or puts a held one back; a pair
   `g_original_item_compat` forbids is refused with THESE ITEMS CAN NOT BE
   COMBINED for `0x3C` frames. START on END ends the player's turn.
4. Both done: `ItemSelectFinish` (`FUN_004895C0`) calls
   `ItemSelectApplyToPlayers` (`FUN_0048A140`), stops the music, writes
   `g_evt_step_index = 1` and `g_evt_ip = 0`, and kills itself -- the script
   resumes at step 1, instruction 0.

The port adds two things, `[port-only]`. `ItemSelectTap` turns a tap or a
click on a row, a held item, END or a scroll mark into the pad bits the
engine reads, because a phone has no d-pad and a mouse is a gun. And a trunk
the port reaches **past** -- a seek or a deep link into stage 1 beyond step 5
replays the script over the trunk's spawn and steps over its wait, which the
game itself can never do -- is closed on its first frame with the items each
player last left a trunk with (`ItemSelectPassedBySeek`; the page keeps that
choice as `hod2.originalChoice`), and the script stays where the seek put
it. Until 2026-10-05 such a trunk opened over the stage-1 opening and, when
its menu was done, `ItemSelectFinish` sent the script back to step 1. The
menu's Original mode switch is a new run from the top of stage 1 for the
same reason: it used to keep the Arcade address and seek there. A new run the
port starts on a stage with no trunk at all -- a link, the picker, a restart
or a seek into stages 2 to 6, none of which the game can do -- gets the same
remembered items (`OriginalRunStartWithLastChoice`), where it used to start
with none; a stage step carries its run's own.

## 4. Collecting and saving

Items come from props (`OriginalItemPropUpdate`, `PropUpdateType72`,
`OriginalItemDropUpdate`, `PropUpdateType43`'s wreck) and civilians
(`CivilianHeldItemGrantOriginalItem`), each counting one into
`g_original_items_taken` (`0x009C90C0`, capped at `0x63`). Two places copy
the counts into the profile and save it: the game over's fly-over at frame
`0xC6` (`GameOverRunPhase`, `0x00460B64`), and the ending
(`RunPhaseEnding`, run phase 8, when `FUN_004157F0` returns -1 for both
players -- `[likely]` neither has a ranking to enter).
Training Mode's completion (`FUN_00498ED0`) also grants items 6, 0x0A and
0x1E and saves. The profile is `ProfileSave`'s block; the port keeps it in
the browser.

## 5. What the port does not have yet

* **`PropUpdateType37`'s** FIRST AID arm: the prop type itself is not
  ported. The other four are, and so is the extra life they release
  (`ExtraLifePickupUpdate`, `FUN_00471CC0`), which Arcade's hidden lives
  use too.
* **The ending's save.** The port has no run phase 8.
* **The costumes' bodies** and PRIMITIVE MEAT's draws.
* **Training's reward**: the port exports no Training bundle.
