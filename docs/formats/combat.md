# Shooting — the shot, the hit, the damage

How a trigger pull becomes a dead zombie. Read out of the binary; every address
here is a call site or a table, and the tables are dumped from the shipped EXE.

The short version: a shot is a **ray from the camera through the crosshair**,
tested against a **per-bone sphere** on every registered actor, resolved
**nearest-first**, and charged against a **per-bone, per-hit-count damage
table**. Which bone you hit decides the damage, the score, and which piece of
the body is swapped for a gorier one.

---

## 1. Firing

Both player-update routines (`FUN_00414940`, `FUN_00414B90`) end a frame in
which the trigger is down and ammunition remains with:

```c
g_player_fired[player] = 1;                    /* DAT_009A5C78 + player*0x4C */
ammo[player]--;                                /* DAT_009A5C7C + player*0x98 */
FUN_00406110(player, crosshair_x, crosshair_y);
PlaySoundId(g_gunshot_sound[player]);          /* DAT_004EC8BC + player*4 */
```

Ammo reaching 0 sets a reload flag and zeroes the shot counter. There is no
spread and no recoil: the crosshair position **is** the shot.

## 2. The ray — `FUN_00406110`

```c
dir_view = normalize(crosshair_x, crosshair_y, -g_projection_distance_px);
shot[player].origin_world    = camera_matrix * muzzle_offset_view;
shot[player].direction_world = camera_rotation * dir_view;
FUN_004016B0(dir_view, &pitch, &yaw);          /* the ray as BAMS angles */
shot[player].sin_pitch, .cos_pitch = sin/cos(-pitch);
shot[player].sin_yaw,   .cos_yaw   = sin/cos(-yaw);
```

`g_projection_distance_px` is **640.21**, the same constant the projection is
built from: `240.0 / tan(41.100° / 2)`. So the unprojection is exactly the
game's own camera, and a crosshair at the screen centre shoots down the view
axis.

The per-player shot record is 0x68 bytes at `0x009A2CB8`:

| Offset | Field |
|---|---|
| `+0x00` | ray origin, world |
| `+0x0C` | ray direction, world |
| `+0x18` | −pitch, −yaw in BAMS |
| `+0x20` | `sin(−pitch)`, `cos(−pitch)`, `sin(−yaw)`, `cos(−yaw)` |
| `+0x30` | muzzle offset, view space |
| `+0x3C` | direction, view space |

## 3. The hit test — `FUN_00404570`

Once per frame, for each player that fired:

```
for every registered actor (DAT_0059D8E8, count DAT_005A4C80):
    FUN_00404630  -- broad phase, then per bone
FUN_00404B80      -- the world: ColiSegmentVsMesh against the collision meshes
if (hits) FUN_00404DB0  -- sort and commit
```

The segment is **origin → origin + direction × 1000**.

### Broad phase — `FUN_00404630`

One sphere per actor: centre `obj+0x70`, radius `obj+0x124`. Miss and the actor
is skipped entirely. Hit, and if the actor has a skeleton (`obj+0x34 & 0x80`,
node count > 0, and not `& 0x8000`) it descends into the bones; otherwise the
whole actor is recorded as a single hit.

### Per bone — `FUN_00404700` → `FUN_00404750` → `FUN_004047D0`

`FUN_00404700` walks **the same skeleton tree the renderer uses** —
`PTR_DAT_004E0430[char_type]`, node count at `+0x16`, children at `+0x18` — and
tests each bone in turn, recursing into children.

Each bone carries a hit sphere, from `PTR_DAT_004D032C[char_type]`, stride
`0x14`, indexed `bone − 1`:

```
+0x00  u32  asset slot this entry belongs to
+0x04  f32  centre x, y, z   (bone local)
+0x10  f32  radius
```

`FUN_004107E0` copies it into the bone's draw record each frame (record base
`obj+0x20C`, stride `0x90`), scaling the radius by the actor's own scale at
`obj+0x1300`, so the sphere follows the animation. A zombie's radii read as
anatomy: **torso 2.55, head 1.3, upper arm 1.4, hand 0.8, pelvis 1.75, thigh
2.15**.

The intersection, `FUN_004062A0`, is the sphere centre rotated into the shot's
frame with the precomputed sines and cosines, then a perpendicular distance:

```c
u = -(cx * cos_yaw) - cz * sin_yaw;
v = cz * cos_yaw * sin_pitch - (cy * cos_pitch + cx * sin_yaw * sin_pitch);
hit = sqrt(u*u + v*v) <= radius;
```

An **infinite ray**, not a segment: the test has no near or far bound, because
the broad phase and the 1000-unit world segment already bound it.

A bone that also has a collision mesh (`record+0x88 != -1`, flag `0x10`) gets a
precise second test, `FUN_004048A0`, against that mesh in the bone's own space —
the bone's world matrix is kept at `record+0x28`.

### Commit — `FUN_00404DB0`

Hits are collected with their distance into a list at `0x0059F4D0` (stride
`0x3C`) with sort keys at `0x0059ECD8`. `FUN_00405080` sorts, and the **nearest**
wins:

```c
actor->flags   |= (1 << (player + 1)) | 8;
actor[400 + player] = node.bone_index;     /* obj+0x190+player: the bone hit */
```

A whole-actor hit records bone **1**, the torso.

## 4. Resolving the hit — `DispatchHit` -> `ResolveHit`

Each actor, in its own update, checks whether it was shot. `ChooseHitPlayerOrder`
decides which players resolve and in **which order** — in two-player it is
randomised, so simultaneous hits do not systematically favour player 1.
`DispatchHit` (`FUN_004092F0`) copies `(s8)obj+0x190+player` into
`g_shot_bone[player]` and calls `ResolveHit`.

`ResolveHit` (`FUN_00409430`) reads three tables, all indexed the same way:

```c
bone = g_shot_bone[player];
n    = obj[0x298 + bone*0x90];        /* hits already taken on THIS bone */
i    = bone * 6 + n;

slot   = u16 g_pBoneEffectSlots[char_type][i];        /* what the bone redraws as */
code   = u16 g_pBoneEffectSlots[char_type][i + 1];    /* NOT a slot -- see below */
damage = u16 g_pBoneDamage[char_type][i];
damage += (s8) g_pBoneDamageByRank[char_type][bone*0x10 + rank];
if ((s16) damage < 0) damage = 0;
```

### `[i + 1]` is a control code, not the next slot

This is the whole shape of the system and it was read wrong once. `ResolveHit`
does not treat `code` as a slot — it **branches** on it:

| `code` | What the hit does |
|---|---|
| **0** | Last step. Damage; swap the model once and latch; nothing comes off. |
| **1** | **Sever.** Damage, swap this bone for its stump, and remove every bone below it. |
| **2** | Nothing at all — no damage, no score. `g_hit_result` becomes 5. |
| **> 2** | Escalate: damage, swap, and advance to the next step. |

The values are unambiguous in the data. Across all 86 character types with a
skeleton the effect tables carry **442 slot references, the lowest of which is
`0xB91`**, and the only values below that are 0, 1 and 2 — a gap of nearly
three thousand with nothing in it. `tools/verify_combat.py` asserts exactly
that, and it would fail if `[i + 1]` were an ordinary slot.

Two more details `ResolveHit` folds in:

* **The final-stage latch.** `rec+0x74 |= 0x80000000` when a bone reaches its
  code-0 or code-1 step. After that the bone still costs hit points on every
  hit but never swaps again and never advances, so `n` — and therefore the
  damage — stops rising.
* **The torso's last stage is the death wound.** In the escalate branch, if the
  bone is 1 and the actor is still alive, `ResolveHit` counts the torso's real
  stages inline (walk the table forward from bone 1 step 0 while the entries
  exceed 2) and **withholds the final swap**. A zombie only shows its worst
  torso wound once it is dead.

`char_adv02` (the common stage-1/2 zombie, 220 hit points):

| Bone | Damage per successive hit | Ends with |
|---|---|---|
| 2 — head | **100, 120, 140, 160** | code 0 |
| 1 — torso | 30, 40, 50, 60, 70 | code 0 |
| 3, 6 — upper arm | 20, 25, 30, 35, 40 | **code 1 — severs** |
| 4, 7 — forearm | 20, 25, 30, 35, 40 | **code 1 — severs** |
| 5, 8 — hand | 15, 20, 25, 30 | code 0 |
| 9 — pelvis | 20, then 20 forever | no slot at all |
| 10, 13 — thigh | 20, 25, 30, 35, 40, 45 | **code 1 — severs** |
| 11, 14 — shin | 20, 25, 30, 35, 40, 45 | **code 1 — severs** |
| 12, 15 — foot | 15, 20 | code 0 |

`char_adv00` is the same anatomy with a much shorter fuse: its upper arms and
forearms carry **code 1 at step 0**, so a single shot takes the arm off. That
is the game, not a bug — and it is why the cascade matters, because without it
the forearm stays behind and keeps animating.

The cat is a flat 10 everywhere with no escalation and no sever, which is what
you would expect of something that is not meant to be fought.

### Damage rank — `DamageRankModifier`

The per-hit modifier is indexed by `g_damage_rank`, the game's **adaptive
difficulty**, and *not* by the menu difficulty:

```c
rank = g_damage_rank;                                   /* GetDamageRank */
damage += (s8) g_pBoneDamageByRank[char][bone*0x10 + rank];
```

`ResetDamageRank` seeds it from `g_initial_damage_rank[difficulty]` =
`{-3, -1, 1, 4, 8}`, and `UpdateDamageRank` moves it with lives lost and
elapsed time, clamped to `[0, 15]`. Rank 0 is the *most* generous: for
`char_adv02`'s torso the row is `{25, 20, 15, 10, 5, 0, 0, -5, ...}` — +25 at
rank 0, −15 at rank 15. Normal difficulty starts at rank 1, so the torso does
50/60/70/80/90 rather than 30/40/50/60/70, and **two headshots (100 + 120 =
220) kill exactly**.

### Hit points — `ActorInitHitPoints`

`obj+0x11C` is current, `obj+0x11E` is maximum, both from the descriptor's
`+0x22`. `FUN_0040A8B0` then applies difficulty and clamps:

```c
rank = (g_app_state == 5) ? 2 : g_difficulty;
max += (s16) g_difficulty_hp_delta[rank];       /* {-30, -15, 0, 0, 0} */
max = clamp(max, 1, 300);
hp  = max;
```

So the menu difficulty only ever moves the *starting* hit points, and only
downwards; everything else is the rank.

Damage is applied by `ActorApplyDamage`: `obj+0x11C -= damage`, unless flag
`0x1000` (invulnerable) is set.

### Dismemberment — `SeverBoneChildren` -> `RemoveBoneSubtree`

On the sever paths — code 1, or a torso hit that kills — `ResolveHit` calls
`ActorSwapDamagedPart` for the bone itself and then:

```c
SeverBoneChildren(bone):
    node = FindSkeletonNodeForBone(bone);
    for each child of node: RemoveBoneSubtree(child);

RemoveBoneSubtree(node):
    obj[0x1318] |= 1 << g_bone_damage_zone[node->bone];
    obj->rec[node->bone].slot = 0;          /* +0x20C + bone*0x90 */
    obj->rec[node->bone].f78  = 0;          /* +0x284 */
    for each child: RemoveBoneSubtree(child);
```

**The severed bone keeps its stump model; everything below it is deleted.**
A zero draw slot is both invisible and unshootable — `ShotTestBoneTree` tests
`rec[0] != 0` before descending — so a blown-off arm cannot be shot again.

Resolved across the skeleton, severing bone 3 removes bones 4 and 5, severing
bone 10 removes 11 and 12, and the fatal torso hit calls `SeverBoneChildren(1)`,
which removes the head and both arms at once.

`g_bone_damage_zone` (`DAT_004C4D18`) is `u8[16]` and names only three zones:
bone 2 (head) -> 0, bones 3-5 (right arm) -> 1, bones 6-8 (left arm) -> 2.
Everything else is `0xFF`, and since the shift is masked with `0x1F` those
land harmlessly on bit 31.

### The gore swap — `ActorSwapDamagedPart`

```c
record[0] = slot;                            /* record[0] IS the slot the bone draws */
ResolveDamagedPartSphere(record, slot, char_type);
```

The bone's **draw slot is replaced**, which is why a zombie visibly comes apart
where you shoot it. The slots are ordinary asset slots and resolve through the
slot table like anything else — `char_adv02`'s gore lives in `harold.bin`,
`char_adv00`'s in `char_adv07.bin`, so there really is a shared gore set behind
the per-character ones. `ResolveDamagedPartSphere` falls back to character type
7 (or `0x0B`) when a character has no variant of its own.

### Result codes

`g_hit_result[player]` is what the rest of the frame reads:

| Value | Meaning |
|---|---|
| 0 | nothing happened |
| 1 | damaged, part swapped |
| 2 | damaged only |
| 3 | severed |
| 5 | no effect — the `2` sentinel. **Scores nothing.** |

## 5. Score — `ScoreAddForPlayer`

| Event | Points |
|---|---|
| any hit that is not on bone 2 | **10** |
| a hit on bone 2, the head | **120**, plus a per-player combo counter |
| HP reaching 0 | **80** |

The head combo (`g_head_combo_bonus`, `+player*0x98`) is added *and then
incremented by 10*, so consecutive headshots pay 120, 130, 140 … and any
non-head hit resets it to zero. The hit counter at `g_player_hit_count` feeds
the end-of-stage accuracy grade that evt `0x2B` reads. A **result-5** hit scores
nothing at all and does not count towards accuracy.

**The headshot burst.** When a head hit is the one that kills, `ResolveHit`
rolls `rand() % 4` and on a zero runs `FUN_00407200`, `FUN_0040A130` (a blood
spray at `obj+0x394`) and `ActorSwapDamagedPart(rec, 0, 2)` — slot **0**, which
is `RemoveBoneSubtree`'s "gone". One headshot kill in four takes the head off.
Gated on app state 6, character type not 3/0x12/0x18, and `obj+0x3B8 < 2`.

Shooting a **civilian** (class 0x10) costs a life and −100 twice; rescuing one
awards +400.

## 6. Dying — state 6

`FUN_00409430` does not change state; it drops HP and sets `obj+0x34 | 0x4000000`.
The actor's own machine moves it to **state 6** (`FUN_00454D20`), which is the
death:

```c
if (sub == 0) { FUN_004560B0(obj); sub++; }      /* choose and start */
...
if (obj[0x19C] >= play_length[obj[0x1B4]] - 1)   /* clip finished */
    FUN_00456740(obj);                            /* or -> state 0xC */
```

`FUN_004560B0` picks the motion. Ignoring the special cases, it falls through to
`FUN_00456220`, which is **directional**: `camera_yaw − actor_yaw` against four
±45° arcs (`FUN_0040A040(angle, centre, 0x2000)`).

| Arc | Motion |
|---|---|
| `0x0000` | random from `DAT_0059309C` = **985, 986, 988, 990** |
| `0x4000` | **992** |
| `0x8000` | random from `DAT_00593084` = **985, 989, 987, 988, 989, 990** |
| `0xC000` | **991** |

The arcs are named by angle rather than "front" and "back" because which is
which depends on two conventions at once — the camera yaw is the direction from
target to eye, and a model faces its local −Z.

The **data** settles what they do, though. Every motion in both tables is in the
cluster whose root ends on the ground (y ≈ 12 → 1.5), and the `0x0000` table
carries the root −8.7, −9.5, −9.3 in z while the `0x8000` table carries it
+7.4, +8.2, +2.5. A model faces −Z, so one set falls the way it is facing and the
other falls back over: a body falls away from whatever shot it. That was found by
scanning `zom.bin` for motions whose root ends lowest, *before* the tables were
read, so the two are independent.

`ChooseDeathMotion`'s full switch, for the record — the directional pick is the
*last* arm, not the only one:

| Condition | Motion |
|---|---|
| `obj+0x130C == 4` | 0x404 or 0x41A at random, or 0x3DA |
| `obj+0x130C` 5 or 6, and `!(obj+0x136C & 7)` | 0x3DB |
| `obj->flags & 0x1000000` | 0x3F9 |
| `obj+0x1368 & 0x08` | 428 |
| `obj+0x1368 & 0x10` | 421 |
| `obj+0x1368 & 0x40` | 633 |
| `obj+0x1368 & 0x80` | 553 |
| otherwise | the directional pick above |

`obj+0x1368` is **not** the destroyed-zone mask — that is `obj+0x1318`, a
different field 0x50 bytes earlier. What sets `obj+0x1368`'s bits 3, 4, 6 and 7
is `[open]`, so these four are not implemented and a character whose arm has
come off still plays a directional death.

## 7. The gore swap — `FUN_004099A0`

`FUN_004098E0` writes the effect slot into `record[0]`, the slot the bone draws.
`FUN_004099A0` then gives that new part its **own hit sphere**, searching the
*tail* of the same `PTR_DAT_004D032C` table the bone spheres come from:

```
PTR_DAT_004D032C[char_type] + (bone_count - 1) * 0x14
  ... {u32 slot; f32 centre[3]; f32 radius} entries ...
  ... terminated by slot == -1
```

So a half-destroyed arm keeps a sensible hit volume — `char_adv00`'s head stage
1 (`0x1F28`) has the head's own 1.3 radius, and stage 2 (`0x1F29`) drops to 1.0
as more of it is gone. There are 23 such entries for `char_adv00` and **none for
the cat**, which is also the split between characters that escalate damage and
characters that do not.

`FUN_004098E0` calls it twice — once for the character's own type and, if that
finds nothing, once for type 7 (or 0x0B) — so type 7's table is a shared set
behind the per-character ones.

## 8. Feedback — the sounds and the impact sprite

Every shot makes a noise and leaves a mark, and both are plain switch
statements, so this half is fully determined. The sound ids resolve through
`g_se_name_list`, which is what makes the material codes readable at all.

### Missing — `ShotBuildSegment` -> `FUN_00405260` -> `SpawnImpactSprite`

A shot that reaches the world takes the **surface material** from the collision
triangle it hit (`ColiSegmentVsMesh`, the hit record's `+0x30`), and that
material picks both the sound and the sprite:

| Material | `PlaySoundId` | File |
|---|---|---|
| 1, 0x33 | `0x1316A9` | `COMMON\BULLET_SND1_16.WAV` — sand |
| 2, 0x34 | `0x0E16A9` | `COMMON\BULLET_MET1_16.WAV` — metal |
| 3, 0x35 | `0x1216A9` | `COMMON\BULLET_OTH1_16.WAV` — other |
| 5, 0x37 | `0x1416A9` | `COMMON\BULLET_WAT1_16.WAV` — water |
| 6, 0x38 | `0x1516A9` | `COMMON\BULLET_WOD1_16.WAV` — wood |
| 0x44, 0x53, 0x45 | `0x0B16A9` | `COMMON\BOMB1_11.WAV` |
| 0x61, 0x62 | `0x0C16A9` | `COMMON\BOMB2_16.WAV` |
| anything else | — | silent |

The filenames are the proof: `SND`, `MET`, `OTH`, `WAT`, `WOD` sitting under
materials 1, 2, 3, 5 and 6 is what establishes that those codes are sand,
metal, other, water and wood. `coli.py` already observed the surface palette
`(0, 2, 3, 0x32, 0x34, 0x35, 0x38, 0x3C, 0x3D, 0x5A, 0x63)` in the collision
files independently, and it lands inside this table.

`SpawnImpactSprite` (`FUN_004073B0`) is a second switch on the same material
giving `(first texture, last texture, scale)` — an animated sprite that runs
the range and dies. Material 1 is `0x091A..0x092F` at 1.0; water is
`0x08F8..0x0903` at **4.0**, a big splash; and the default arm is a single
frame at 0.1, so a shot into untagged geometry barely shows.

### Hitting — `ActorShotFeedback` and `ActorPlayHitVoice`

`ZombieOnShot` (`FUN_00453EB0`) runs the reaction once `ResolveHit` has set
`g_hit_result`:

```c
ActorShotFeedback(player);                      /* FUN_00454050 -- blood or ricochet */
if (still alive)  { hit reaction motion; if (result != 5) voice(obj, 0); }
else              { voice(obj, bone == 2 ? 2 : 1); state = 6; }
```

`ActorPlayHitVoice` (`FUN_0040A6F0`) plays **two** sounds — a flesh impact and
a voice:

| Event | Impact, one at random | Voice |
|---|---|---|
| hurt (kind 0) | `BLOOD02`, `BLOOD03`, `BLOOD04`, `BLOOD06`, `BONE01` | `ZOMBIE_010` / `ZOMBIE_012` |
| killed (kind 1) | the same five | `ZOMBIE_019` / `ZOMBIE_018` |
| headshot kill (kind 2) | `BLOOD01` or `BLOOD05` | `ZOMBIE_019` / `ZOMBIE_018` |

The two voice columns are **set A** and **set B**. `ActorPlayHitVoice` switches
on `obj+0x1F4`: character types 0, 2, 5, 6, 9, 0x0E, 0x0F, 0x10 and 0x11 take
set A, everything else set B.

`ActorShotFeedback` then draws it, keyed on the result:

| Result | What is drawn |
|---|---|
| 1 damaged + swapped | blood at the bone, scale **0.75** |
| 2 damaged only | blood at the bone, scale **0.5** |
| 3, 4 severed | blood at the bone, scale **1.0** |
| 5 no effect | `SpawnImpactSprite` material 3 (0x51 for type 3) and `COMMON\BULLET_MET3_22.WAV` — the shot bounced off |

The blood itself, `FUN_00407230`, is a 25-frame flipbook over asset slots
`0x3A..0x52`, drawn in **view space** at the bone with an explicit scale:

```c
z     = rec[0x284] + rec[0x27C];               /* the bone's view-space depth */
scale = (z < -20) ? 1.0 : (-z * 0.0375 + 0.25);
scale *= (g_wCaptionMode == 1) ? 0.15 : 0.3;
scale *= severity;                              /* the 0.5 / 0.75 / 1.0 above */
```

so it is near-constant on screen out to twenty units and fixed in the world
beyond that.

## 9. What the player implements

Exact: the hit spheres, hit points through `ActorInitHitPoints`, the per-bone
damage escalation with the `DamageRankModifier` applied, the control codes,
**the sever and its cascade**, the final-stage latch, the withheld torso stage,
the headshot burst, the nearest-first resolution, the score including the
result-5 rule, the directional death, the gore swap, and every sound in §8.

The live-enemy waits (evt `0x43` / `0x44`) become **real** when shooting is on:
the script holds until the enemies are dead, which is the game's own condition.
With shooting off there is nothing that can kill them, so a stopwatch paces
them instead and the feed says so. `g_enemies_present` is approximated by the
alive count, because the player never despawns a corpse.

Not implemented, and why:

* the **collision-mesh** refinement of the bone pick — the sphere pass alone
  gives the same answer except at grazing angles;
* the **miss material**. `FUN_00405260` takes it from the collision triangle,
  and the collision meshes are not in the bundle. The visible geometry gives
  the impact point and material 3 — the game's own "other" — gives the sound.
  `[open]`, and the fix is to carry `coli.py`'s per-triangle `surface` into the
  bundle;
* the **impact artwork**. The sprite's position, timing, frame count and scale
  law are transcribed, but the frames are asset slots `0x3A..0x52` and
  `0x091A..` which the bundle does not carry, so a radial splat stands in.
  `[open]`;
* the **special deaths** — `ChooseDeathMotion`'s `obj+0x1368` arms. What sets
  those bits is `[open]`; see §6;
* **civilians, bosses and the ammo/reload cycle**;
* the **adaptive rank** itself. `UpdateDamageRank` needs lives lost and elapsed
  play time; the player holds the rank at `g_initial_damage_rank[difficulty]`,
  which is what a fresh game starts on.

`tools/verify_combat.py` is the check: it re-derives the step tables from raw
bytes, asserts the control-code/slot gap across all 86 character types,
asserts every slot resolves through the asset slot table, asserts every sever
step has a subtree to remove, walks all 2810 spawn/difficulty hit-point pairs
through the clamp, and asserts all 30 combat sound ids name a file.
