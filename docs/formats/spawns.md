# Spawns: enemies, items and props

What the event script puts in a stage, and what each thing *is*. Everything
here was read out of the code first; the data was then used to check it, never
to guess from. Where a class could not be identified from code, it is marked
`[open]` rather than named.

The descriptor format itself is in [`evt.md`](evt.md). This document is about
the **classes** — what the handler behind each class id actually does.

## The three spawn allocators

| Opcode | Function | Object size | Tail pointer |
|---|---|---|---|
| `0x09` | `FUN_004088A0` | `0x13F4` | none — reads `+0x24`/`+0x25` inline into `obj+0x1F4` / `obj+0x130C` |
| `0x0B`, `0x0D` | `FUN_00408A20` | `0x13F4` | `obj+0x1390 = descriptor + 0x24`; also `obj+0x1316` from `desc+0x20` |
| `0x0C` | `FUN_00408BC0` | `0x1314` | `obj+0x130C = descriptor + 0x24` |

All three end with `= descriptor + 9` on an `int *`, so the **parameter tail is
at `descriptor + 0x24`** in every case; only the object field and the
allocation size differ. `hod2lib.evt.Spawn.param(k, kind)` reads it with the
same `k` a handler writes as `obj+0x1390 + k`.

The handler itself comes from the 112-slot array at `0x009A2280`, built by
`FUN_0040AC90` from the `{class_id, handler}` pairs at `0x00593358` — 56
entries, of which **35 are used** by the shipped stages.

## `+0x11C` and `+0x11E` are polymorphic

Both receive the u16 at `desc+0x22`. What that means depends entirely on the
class:

* **Combat actors** run `FUN_0040A8B0`, which adds a difficulty delta from
  `0x005776B0` (`{-30, -15, 0, 0, 0}`) to `+0x11E`, clamps to `[1, 300]`, then
  copies it to `+0x11C`. Damage (`FUN_004098C0`) decrements **only `+0x11C`**.
  So `+0x11E` = max HP after difficulty, `+0x11C` = current HP. `[proved]`
* **Class 0x44** uses it as a sub-type index into the 18-entry table at
  `0x00595AB8`. `[proved]`
* **Class 0x41** uses it as an *asset slot id*, or a group id for type 0.
  `[proved]`
* **Class 0x10** uses it as a mode flag: 0 = free-standing, non-zero =
  parented. `[proved]`
* **Class 0x24** uses it as an animation phase seed, `-1` meaning random.
  `[proved]`

Treat the name `hp` in `hod2lib.evt.Spawn` as historical.

> ⚠️ The three orientation words are the same story. All three allocators copy
> them to `obj+0x64/+0x68/+0x6C`, so *angles* is the right default — but class
> 0x41 type 4 (`FUN_00462E10`) reads `obj+0x6C` as an object **kind** and
> `obj+0x64` as a **group size**. Check the class before trusting the outer two.

## What the classes are

Identification is by code, and where possible by sound-effect filename — this
binary has no name table for assets, but `PlaySoundId` ids resolve to records
holding paths like `COM\220_Y_M.WAV`, which is decisive.

| Class | Handler | Spawns | What it is | Confidence |
|---|---|---|---|---|
| `0x41` | `FUN_00461CD0` | 441 | **Breakable-prop / item-container placer.** A transient stub: dispatches on `obj+0x130C` through a 79-entry table at `0x00593580`, builds child actors, then `ActorKill`s itself. Never drawn, never damaged. | `[proved]` |
| `0x30` | `FUN_00452DA0` | 288 | **The zombie.** HP, per-body-part damage zones, 80 points on kill / 10 per hit / 120 + combo on a head hit, a 54-state machine at `0x00592AE8`. Increments `g_enemies_alive`. State 2 (`FUN_00455720`) plays `COMMON2\ZOMBIE_041_16.wav`; the type-2 setup plays `CHAIN_SAW_22.wav` and a later state `KNIFE1_44.wav`. | `[proved]`, by the game's own sound record |
| `0x44` | `FUN_00472B10` | 204 | **Prop placer.** Same shape as 0x41: dispatches on `obj+0x11C` through 18 entries at `0x00595AB8`, builds a child, `ActorKill`s. Some children are shootable score pickups. | `[proved]` |
| `0x25` | `FUN_004840D0` | 142 | **Script-driven humanoid actor.** A bytecode VM (`FUN_004842A0`) drives a skinned character. Not an enemy, not damageable, awards nothing — shots land in its hit slot and nothing consumes them. | `[proved]` |
| `0x10` | `FUN_0048A3E0` | 51 | **Civilian / rescuable victim.** Proved by voice records: `COM\220_Y_M.WAV`, `COM\209_M.WAV`, `COM\190_Y_W.WAV`, `COM\207_OLD_W.WAV`, `COM\200_C.WAV` — young man, man, young woman, old woman, child. Shooting one costs a **life** and −100 twice; rescuing awards **+400**. | `[proved]` |
| `0x31` | `0x00449620` | 49 | **Humanoid enemy, four subtypes** (`0x16`–`0x19`). Damageable, increments `g_enemies_alive`. Ricochet SFX by subtype: `BULLET_WOD1_16.WAV` (wood) for `0x17`, `BULLET_MET2_16.WAV` (metal) for `0x19`. | `[proved]` enemy; species `[open]` |
| `0x24` | `FUN_00482CE0` | 48 | **Scripted non-combat set-piece prop.** Not damageable, awards nothing, plays no sound at all (all 496 `PlaySoundId` xrefs checked). Six state selectors covering idle, freeze/unfreeze cues, gravity drops and a slide. | `[proved]` negatively |
| `0x33` | `FUN_00432FF0` | 44 | **Generic scripted scenery**, eleven sub-handlers on `obj+0x11C`. Selector 1 is a path-driven vehicle (`STAGE5_SE\DRIVE_DEAD2_22.wav`), 8 the bridge collapse (`BRIDGE_CRASH1_22.wav`), 9 a car fire (`CAR_FIRE_22.wav`), 11 the **ending-branch selector** — it picks `ENDL.WAV` or `ENDS.WAV` from the player's score rank. Selector 4 is a *kickable* prop: shootable, but a hit only imparts an impulse. | `[proved]` |
| `0x51` | `FUN_00438540` | 28 | **Water enemy.** Rises from the water plane, bobs on the surface, claims one of four attack slots and lunges to bite for 1 damage inside 8.0 units. Dies to a single hit, worth 80 points. Splashes play `COMMON\SIBUKI2_16.WAV` / `SIBUKI3` (*shibuki*, "splash"); death plays `BLOOD07_16.WAV`, so it is organic. | `[proved]` |
| `0x26` | `FUN_0048E290` | 25 | **Vehicle-and-scenery family**, 8 states, no combat role at all. Only state 2 is shootable, and it is indestructible — it sparks and nothing decrements. States 0/1/4 draw a four-wheeled vehicle with hinged doors, a steering wheel, axles that spin only while moving, and a shattering windscreen. | `[proved]` mechanically; *which* vehicle `[open]` |
| `0x43` | `FUN_00445DB0` | 14 | **Flying enemy.** Plays `COMMON2\HABATAKI6_16.wav` (*habataki*, "wing-flap"); increments both enemy counters and picks a target player. | `[proved]` flying enemy; species `[open]` |
| `0x2D` | `FUN_00426A70` | 3 | **Large multi-part creature**, boss-shaped: spawns 8 sub-part actors each carrying `+0x131B = i`. In Boss Mode it puts itself on object path `0x185`. | `[proved]` |
| `0x42` | `FUN_0042F9B0` | 3 | **Batch of falling shootable breakables** — 6–15 depending on player count, one flagged special at random. They fall under gravity and break into halves. | `[proved]` mechanism; what they *are* `[open]` |
| `0x21` | `FUN_00451720` | 1 | Enemy with **rank-scaled HP** — `obj+0x11C` is overwritten from the table at `0x00565F0C`, giving 1 or 2 hit points by difficulty rank. | `[proved]` |
| `0x2B` | `FUN_00438060` | 4 | **Scripted dynamic light source.** Claims a slot in the entity-light array (stride `0x1D` dwords at `0x009A1A88`) and releases it on a stop condition chosen by `obj+0x11C`. | `[proved]` |
| `0x29` | `FUN_00432C80` | 3 | **Static scenery batch** — draws a fixed list of instances, `{int slot; float x,y,z; int rotY; float scale}` at stride `0x18`, from one of three lists chosen by `obj+0x11C`. | `[proved]` |
| `0x16`/`0x17` | `00442290`/`004422D0` | 6/8 | **The water-wave field.** `0x16` creates the manager and records the water plane Y; `0x17` adds one wave source, `obj+0x11C` selecting travelling or circular, with `{amplitude, wavelength, speed}` from its tail. | `[proved]` |
| `0x15` | `FUN_00441750` | 4 | **Row spawner for floating props** — N copies spaced by a delta vector, each sampling the wave field. | `[proved]` |
| `0x52` | `FUN_0043F4C0` | 10 | **Small wandering critter.** Subtypes 0–1 wander and self-despawn; 2–4 are **shootable route-branch triggers** that set the script branch variable and flee. Plays no sound, so the species is `[open]`. | `[proved]` function |
| `0x53` | `FUN_00431250` | 4 | **Skinned NPC**; subtype ≥2 is a shootable branch trigger that reacts and runs away. | `[proved]` |
| `0x40` | `FUN_0043BD30` | 9 | **Horde spawner** — 1, 4, 6, 8 or 10 copies of an enemy actor depending on player count and scene. | `[proved]` mechanism |
| `0x11`, `0x14`, `0x19`, `0x32` | — | 4/5/4/2 | **Enemies**, all incrementing both enemy counters. `0x19` takes ~15 per-bone model slots straight from its tail. | `[proved]` |
| `0x12`, `0x13` | `0043F9D0`/`0043FE10` | 3/23 | **Script-driven animated props**, sharing a 10-entry behaviour table at `0x005926A8`. | `[proved]` |
| `0x22` | `FUN_0049B0D0` | 4 | Enemy with four behaviour variants plus a companion actor. | `[proved]` |
| `0x27`, `0x28` | `004329D0`/`00432610` | 2/6 | **Path-riding vehicles/props**; `0x27` swaps model and lights a flame at path frame `0xBE`. | `[proved]` |
| `0x2A` | `FUN_00432D40` | 4 | **Dead class** — the whole handler is `JMP ActorKill`. | `[proved]` |
| `0x20`, `0x45`, `0x46` | — | 36/37/27 | Not reached. `0x20` has a call to the HP scaler at `0x0044964A`, so it is `[likely]` a combat actor. | `[open]` |

## Two name tables, not none

> ⚠️ An earlier revision of this document said flatly that the binary has no
> asset name table and that sound records were the only naming evidence. That
> was wrong, and it cost real time: three of the four class-survey agents
> reported identities as `[open]` on that basis. There are **two** name tables.

### 1. Character skeletons → pol filenames

`FUN_00410590` reads `PTR_DAT_004E0430[type]` for a character type. The block
holds a node count at `+0x16` and that many node pointers at `+0x18`; each node
is `{u32 asset_slot; …; u16 index @+0x14; u16 child_count @+0x16; u32 children[]}`
and recurses. Every slot resolves through the asset slot table to a **pol
filename**, and for 85 of the types all of a skeleton's slots agree on one file.

That is a complete character bestiary, and it names things the sound records
never could:

| Types | Files |
|---|---|
| `0x01`–`0x14` | the zombie variants — `znassb`, `znchain`, `zndina`, `zngold`, `znnick`, `znjoe`, `znkage`, `znken`, `znebi2/3/4`, `znele`, `znonoopa`, `znjikken1` |
| `0x1A`–`0x1F` | the small creatures — **`cat.bin`**, `frog.bin`, `frog_gold.bin`, `mol.bin`, `zabat.bin`, `zabat_wing.bin` |
| `0x20`–`0x38` | the civilians — `hito_baba`, `hito_gal`, `hito_man`, `hito_oyaji`, `hito_manbest`, `deka_musume`, … (*hito* = person) |
| `0x3E`–`0x43` | named characters — `hou`, `logan`, `curien`, and their HOD1 variants |
| `0x47`–`0x55` | the bosses — `boss2`–`boss6`, `b6boss1z`–`b6boss5` |

`ExeTables.character_skeleton()` and `character_asset_file()` decode it.

**The cat is `[proved]`.** Class `0x53` stores character type `0x1A`, whose
eighteen skeleton nodes all land in `cat.bin`. It spawns four times, in stage 2
only, at evt `0x21F4`, `0x221C`, `0x44A4` and `0x6E98` — and `0x21F4`/`0x221C`
sit immediately after the flying-creature block, which is `zabat.bin`, the
bats. Rendering the eighteen parts corroborates it: each is about two units
across, and they read as head, torso, hips, limb segments and tail.

### 2. Sound records

The sound records at **`0x005845F8`**:
`{u32 id; char name[48]}`, stride `0x34`, terminated by `id == 0xFFFF` —
**324 records**. `PlaySoundId` (`0x0041CFD0`) switches on `id >> 28` through
the 9-entry table at `0x0041D324`; category 0 resolves here, category 1 through
a string-pointer table at `0x00580354`.

`ExeTables.sound_records()` decodes it. It identifies *behaviour* where the
skeleton table identifies *models*: a `PlaySoundId` id is very often the only evidence for
what an object is. It is how the stage-2 vehicle was proved to be a car, how
class 0x51 was proved to live in water, and how class 0x30 was proved to be a
zombie rather than assumed to be one.

Records by directory: `COMMON` 61, `STAGE6_SE` 46, `COMMON2` 36, `STAGE5_SE`
32, `STAGE3_SE` 31, `STAGE1_SE` 28, `DC_SE` 27, `STAGE2_SE` 27, `STAGE4_SE` 22,
plus `COMM3`, `ETC`, `DAMEGE_GA`, `DAMEGE_JMS`, `START_COIN`.

### On animals

The creatures the sound records name are a **frog** (`KAERU`), an **owl**
(`FUKUROU`), a **bat** (`KOUMORI`), a **worm** (`WORM_TUBU`) and wing-flap
(`HABATAKI`). There is no cat sound in any of the 324 records — which is
consistent with the report that the cat is silent, and is exactly why the
sound table alone could not identify it. The skeleton table could.

### Hunting the cat

A user report gave two sightings in stage 2: near the start after the car on
the non-crash branch, and around the flying creatures. It moves and makes no
sound. That is a locality question, so it can be chased in the data without
guessing at names.

Ruled out by position: class `0x52` (the wandering critter) spawns twice in
stage 2, but at evt `0xDBCC`/`0xDBF4` — deep in the script, near neither place.
Classes `0x12`/`0x13` (the animated props) resolve to `komono_boat`,
`komono_st1`, `etc_1` and `sanbasi`, also elsewhere.

**The lead is class `0x53`** (`FUN_00431250`), and it fits on every axis the
report gives:

* **Stage 2 only**, four instances — evt `0x21F4`, `0x221C`, `0x44A4`, `0x6E98`
  — each with a different animation set (2, 4, 0, 5) and mode (0, 0, 2, 1).
* **`0x21F4` and `0x221C` sit immediately after the flying-creature block**
  (`0x1FF8`–`0x20C0`), which is one of the two reported sightings.
* **It moves**: `FUN_00431430` runs motion `0x2FD`, then swaps to `0x305` once
  `x < -478` — it runs away along X.
* **It makes no sound** — no `PlaySoundId` in its range.
* **It is branch machinery**, which is what "non-crash branch" points at:
  `if ((obj+0x34 & 8) && g_script_branch_var == 0 && DAT_009A2BC0 == 8)
  g_script_branch_var = 2;` — shooting it sets the route branch variable.
* It is a **skinned character of type `0x1A`**, so a small animated creature
  rather than a prop.

`[open]`, and deliberately so — nothing in the binary names it. What would
settle it is resolving character type `0x1A` through the skinned-model part
pipeline (`FUN_00410590` / `FUN_00412440`) to its actual models and rendering
them. The obvious shortcut does not work: the first int of
`PTR_DAT_0052ED08[type]` is 1 or 2 for **every** character type, so it is a
variant count, not a bone count, and cannot separate a quadruped from a human.

Class `0x52` remains a second candidate on shape alone — it wanders, it is
small, its model is `0x1385 + rand() % 10` — but its stage-2 positions do not
match either sighting.

## Item placement — SOLVED

**The items are not placed; the containers are.** Spawn class `0x41` type 0
(`FUN_00462A80`) places a *group* of shootable props. The spawn's `+0x11C` is
the group id. When the last prop of an item-set is broken, the item that was
hidden in the set is released.

Two tables in the EXE, not in the evt:

* `0x00593D14` — nine member counts: `{4, 2, 3, 9, 5, 3, 3, 6, 7}` = **42 props**.
* `0x00593CF0` — nine pointers to the member records.

Each member record is **10 bytes**:

```
+0x00  s16  x * 0.1
+0x02  s16  z * 0.1
+0x04  u8   item-set id
+0x05  u8   asset variant (0xFF = the default, slot 0x19E8)
+0x06  s8   stack level; y = level * 7.540296 above the floor
+0x07  u8   number of supporting members
+0x08  u8   supporting member index a
+0x09  u8   supporting member index b
```

The support list is what makes a stack topple when a prop beneath it breaks.
**[proved] by self-consistency**: across all 42 members of all nine groups,
every member at level *n* names supports that are all at level *n−1*, and every
ground-level member names none — 42/42, no exceptions. That is a real check,
because a wrong field offset would not produce a consistent height ordering.

The floor is `g_camera_fixed_eye_y - 0.1`, added by the constructor, so the
`y` in the record is relative.

Per prop: `+0x11C` = 2, i.e. **two shots** — the first plays `PlaySoundId(0x1D16A9)`
and cracks the linked members, the second destroys it. In `g_GameMode == 2`
selected members instead get `+0x11C = 1` and asset `0x1A0F`.

**Lifetime is measured in event-script blocks, not frames.** Each prop keeps
`obj+0x199` from `desc+0x24`, and despawns once the evt block counter
`0x009A2BB0` has advanced that many times past the one it spawned in.

Which stage uses which group, `[proved]` from the descriptors:

| Stage | Groups |
|---|---|
| 1 | 0 |
| 2 | 1, 2, 3, 4, 5, 6, 7 |
| 3–6 | none |

Group **8 is defined but never spawned** by any shipped stage. `[open]` whether
it is cut content or reached by a path not walked here.

`ExeTables.breakable_groups()` decodes all of this, and `export_level.py` emits
the groups a stage actually places into `<stage>_objects.json`.

### The items themselves

The pickup actor is `FUN_004724A0`. On being shot it plays `PlaySoundId(0x416A9)`
or `0x3B17A9`, awards `ScoreAddForPlayer(p, *(s16*)(0x0059505A + kind*0xC))` from
a per-kind score table of stride `0xC`, swaps its model to a floating score
sprite (`0x116A` / `0x119C`), fades over `0x31` frames and despawns. It draws
itself with `AssetDrawSlot(obj+0x28C)` plus a ground shadow `AssetDrawSlot(0x10D0)`.
`[proved]`

## Getting spawns into a renderer

`hod2lib.spawnres` resolves a spawn to its character type and asset file, and
`export_level.py` emits one glTF node per spawn under a `spawns` root, carrying
class, character type, node count and asset filename in `extras`. The browser
player consumes the same glTF, so it gets them without a bundle change.

**562 of 1225 spawns are identified**, across 52 distinct characters. Only
classes whose handler has actually been read get a rule; there is deliberately
**no** guess-from-the-descriptor fallback. Adding one looked attractive —
opcode `0x09` really does copy `desc+0x24` into `obj+0x1F4` — and it "resolved"
962 of 1225, but most of the extra hits were `char_adv02` purely because class
`0x41` uses that field as a prop lifetime and a lifetime of 0 is character type
0. Fewer, correct identifications beat more, wrong ones.

**The nodes carry no geometry, and cannot yet.** Every part model in `cat.bin`
and `hito_manbest.bin` is authored about its own origin — the per-part
centroids are all within a unit of zero — so the rest pose is not in the
models. It lives in the motion data, and `mot/` is the last undecoded format.
Until then a consumer can place and label a character but not assemble it. The
single-model prop classes are unaffected and draw exactly.

## Open questions

* The sound-id encoding looks like `(record << 8) | 0xA9`. Several records were
  resolved to filenames (`COM\…`, `COMMON\…`, `STAGE2_SE\…`) via the tables at
  `0x005845F8` and `0x00584834`; the general index has not been written down
  here yet.
* Class 0x30's state slots `0x16`–`0x35` are enumerated but mostly unread, and
  whether any of them touches a tail offset above `+0x20` is unknown — so its
  descriptor size is a **lower** bound of `0x48`, not a ceiling.
* No descriptor size is encoded anywhere: the opcode handlers read a
  `-1`-terminated list of absolute descriptor *addresses*, so a packed-list
  walk is not something the engine ever does. The only bound available per
  class is the highest tail offset its handler dereferences.
