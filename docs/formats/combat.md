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

## 7. Reacting — the stumble

A shot that hurts a zombie without killing it makes it **flinch**, and which
flinch is a two-level table. `ZombieOnShot` (`FUN_00453EB0`) is the routing:

```c
if (obj->flags & 8) {                       /* was shot this frame */
    DispatchHit();                          /* -> ResolveHit, sets g_hit_result */
    for each player that hit:
        ActorShotFeedback(player);          /* the blood or the ricochet */
        if (!(obj->flags & 0x4000000)) {    /* still alive */
            ActorReactToHit(player);        /* <- the stumble */
            if (g_hit_result[player] != 5) ActorPlayHitVoice(obj, 0);
        } else {
            ActorPlayHitVoice(obj, bone == 2 ? 2 : 1);
            state = 6;                      /* the death */
        }
}
```

### Which hits interrupt — `ActorReactToHit`

Not all of them. `FUN_004543F0` first records the **last-hit zone** in
`obj+0x1319` — 2 for the head, 1 for the torso, otherwise left alone — and then
decides:

| `g_hit_result` | Reacts? |
|---|---|
| 1 damaged and swapped | **yes** |
| 3 severed | **yes** |
| 4 | `FUN_0045D9F0` instead, for bones 1 and 9 |
| 2 damaged only | only character types 3 and 0x12 |
| 5 no effect | only character types 3 and 0x12 |

So a shot that merely takes hit points off an ordinary zombie's pelvis — which
has no gore slot at all, so it always resolves as result 2 — does **not**
interrupt its walk. That is why a zombie can be shot repeatedly in the body and
keep coming.

### Which clip — `ActorPlayHitReaction`

```c
motion = g_pHitReactionMotions[char_type][obj+0x130C][g_bone_reaction_group[bone]];

if (bone < 9 && !(obj+0x136C & 0x800)) {
    MotionCrossFadeTo(obj+0x194, 1, motion, 0, 1,
                      (obj+0x1364 == 3) ? 20 : 10);     /* result 3 = severed */
} else {
    ActorSetMotion(obj+0x194, motion);                  /* legs: no fade */
}
```

Two indices. `obj+0x130C` is the actor's **body condition**;
`g_bone_reaction_group` (`DAT_004C84A8`, `u16[16]`) turns the bone into one of
eight **reaction groups**, and they partition the body exactly as you would
draw it:

| Group | Bones | Region |
|---|---|---|
| 1 | 2 | head |
| 2 | 1 | torso |
| 3 | 3, 4, 5 | right arm |
| 4 | 6, 7, 8 | left arm |
| 5 | 9 | pelvis |
| 6 | 10, 11, 12 | right leg |
| 7 | 13, 14, 15 | left leg |

Only **two distinct rows** exist for the humanoids. The ordinary one:

| Region | Motion | Frames |
|---|---|---|
| head | 977 | 29 |
| torso | 982 | 29 |
| right arm | 981 | 29 |
| left arm | 979 | 29 |
| pelvis | 974 | 29 |
| right leg | 961 | **39** |
| left leg | 960 | **39** |

The second (motions 257–263, 43 frames) is reached only at body condition 3.
Twenty-one character types have a stumble set; the cat has none, which is
consistent with everything else about it.

Three independent things say these are stumbles rather than something else
mistaken for them, and none of them is "the numbers look right":

* **Length.** Every reaction is 29–43 frames; every death is 74–161. The two
  sets do not overlap, and `verify_combat.py` asserts they never will.
* **Violence.** Summing the unwrapped per-bone rotation across each clip, the
  reactions travel 326–377° against the walk's 137° over twice as many frames.
  A flinch is a lurch and a recovery; a walk is not.
* **They return.** Every clip's last frame is bit-identical to its first on
  every bone, so a reaction hands back to the walk without a pop — which is
  what a one-shot laid over a loop has to do.

The **legs are hard-set**: bone 9 and above skip the cross-fade entirely and
snap into the stagger. Bones 1–8 fade in over 10 frames, or 20 when the hit
severed something. Both go on to **track 1** of the actor's motion block —
`MotionStartOnTrack`'s last argument — while the walk keeps running on track 0.
That is what the cross-fade is between.

### Body condition — `ActorUpdateBodyCondition`

`obj+0x130C` is derived by `FUN_00454270` from which parts are gone, and it
feeds the death pick as well as the stumble: with `obj+0x136C & 0x40` set and
**both arm zones destroyed** (`obj+0x1318` bits 1 and 2, from
`RemoveBoneSubtree`) it becomes 5 — and `ChooseDeathMotion` gives condition 5
its own death, motion 0x3DB. So the destroyed-zone mask does reach the death
after all, just not through `obj+0x1368`.

The rest of `FUN_00454270` reads `obj+0x4DC` and `obj+0x68C` against literal
asset slots, and what those two fields are is `[open]`. The player holds the
body condition at 0, which for every character in its stages selects the same
row as conditions 1, 2 and 4.

## 8. The gore swap — `ResolveDamagedPartSphere`

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

## 9. Feedback — the sounds and the impact sprite

Every shot makes a noise and leaves a mark, and both are plain switch
statements, so this half is fully determined. The sound ids resolve through
`g_se_name_list`, which is what makes the material codes readable at all.

### Missing — `ShotBuildSegment` -> `SpawnWorldImpact` -> `SpawnSpriteEffect`

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

`SpawnWorldImpact` (`FUN_00405260`) calls `SpawnSpriteEffect`
(`FUN_00407340`), a wrapper that marshals the point, the facing and the
material into a 12-float block and hands it to
`SpawnSpriteEffectFromParams` (`FUN_004073B0`). **That** is where the second
switch on the same material lives, giving `(first asset slot, last asset slot,
scale)` — an animated sprite that runs the range and dies. Material 1 is slots
`0x091A..0x092F` at 1.0; water is `0x08F8..0x0903` at **4.0**, a big splash;
and the default arm is a single frame at 0.1, so a shot into untagged geometry
barely shows.

This paragraph called `FUN_004073B0` `SpawnImpactSprite` until 2026-09-03,
against a TSV that called it `SpriteEffectSlotRange` — and *both* were wrong.
The routine allocates the effect actor and plays its sound, so it is not a
slot-range lookup; and impact is one of its fourteen kinds, not what it is
for: `0x53` is rain and `0x5A` spawns two more effects beside itself. Worse,
`SpawnImpactSprite` would have collided with the wrapper's own name one
address up. See `docs/re/session-log.md`.

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
| 5 no effect | `SpawnSpriteEffect` material 3 (0x51 for type 3) and `COMMON\BULLET_MET3_22.WAV` — the shot bounced off |

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

## 10. Approaching — the advance rings

`ZombieStateApproach` (`FUN_004579A0`) is how an enemy closes the distance, and
the measurement in it settles something about this game's camera:

```c
d = hypot(obj.z - g_camera_eye_z, obj.x - g_camera_eye_x);   /* to the CAMERA */
set = (s8) obj+0x131F;                       /* which ring set this actor uses */
if (d >  outer[set])                 steps = base + mid_add + outer_add;
if (d <= outer[set] && d > mid[set]) steps = base + mid_add;
if (d <= mid[set])                   steps = base;
obj+0x1358 = steps;
```

Three concentric radii per ring set — but the number they yield is **not a step
count**, which is what an earlier revision of this section said. `FUN_004090B0`
sorts every live enemy by distance to the camera once a frame and writes each
actor's **rank** in that queue to `obj+0x131D`. Sub-state 1's test is:

```c
if ((s8) obj[0x131D] < obj[0x1358] && obj[0x131E] < 3)
    if (TryClaimAttackSlot(obj)) -> the state named by descriptor tail byte 3
```

"If I am among the nearest N, and among the nearest 3 overall, I may press an
attack." So the ring table is a **crowd throttle**: far from the camera, a
deeper slice of the queue is let through (9); close in, only the nearest 2.
Nothing counts walking steps anywhere in the class-0x30 code.

evt opcode `0x0E` writes a ring set:

```c
i = ip[1];
g_enemy_approach_rings[i].inner = ip[2];
g_enemy_approach_rings[i].mid   = ip[3];
g_enemy_approach_rings[i].outer = ip[4];
```

so the script tunes the approach distances per encounter.

### The camera does follow the enemies

**Correction.** An earlier revision of this section said it did not, on the
strength of an xref sweep: nothing that writes `g_camera_yaw_bams` reads an
actor. That is true and it is not the question, because **the tracking never
writes a yaw**. It writes a *point*, and a separate damped step turns the
camera toward it. The same trap as the skip flag earlier in this project —
absence in one narrow query taken for absence in the program.

There are three pieces.

**1. What to look at — `SelectCameraLookAtTarget` (`FUN_00403050`).**
`g_enemy_slots` is a 16-entry `{u8 occupied; void *actor}` table of enemies
registered with the camera. Each actor remembers its slot in `obj+0x120`
(`0xFF` = none) and its *attack permit* in `obj+0x121`.

```c
if      (slot0 && slot1 && slot0->obj[0x121] != -1 && slot1->obj[0x121] == -1)
                                   look = slot0->pos;          /* the attacker, alone */
else if (slot0 && slot1)           look = midpoint(slot0, slot1);
else if (slot0)                    look = slot0->pos;
...
else                               look = g_cam_path_target;   /* no enemies: the path */
```

So the camera aims at a live enemy, or splits the difference between two, and
falls back to the authored path target only when there are none registered.

**2. Which enemy is "about to attack" — `TryClaimAttackSlot` (`FUN_00455DE0`).**
`ZombieStateApproach` finishes its walk and calls this. There is one
**attack permit per player** in `g_attack_permits`, `g_max_attackers` of them;
claiming one stores its index in `obj+0x121` and returns 1, which is what lets
the approach state hand over to the attack state named by the descriptor tail.
Fail, and the enemy keeps walking.

That single byte does double duty: it gates the attack *and* it is what
`SelectCameraLookAtTarget` tests. **The camera focuses on the enemy that holds
the attack permit** — the one about to attack — and otherwise frames the pair.

**3. Turning — `StepCameraLookAtDamped` (`FUN_00402F80`).** The desired point
is not applied directly. Each frame the camera block's own look-at
(`g_camera_block_target`, block `+0xD8`) is eased toward it, at a rate that
`ComputeLookAtAngleError` takes from the angle between current and desired,
clamped to `0x1FFF` (45°) and used to index `PTR_DAT_00576C04`. That easing is
the smooth pan.

### Why the eye can sit still through all of this

The camera *modes* only ever write the eye and, on a rail, a yaw. Two of them
in particular:

* `CameraHoldEyeTick` (`0x0040C470`) writes **only** `g_camera_eye_*` and never
  touches an angle;
* on a rail, `CamEvalPath7` gives **eye and look-at as independent channels**,
  so a path can pin the eye and sweep the aim on its own. Stage 2's paths 108
  and 109 do exactly that: measured over their 160 frames the eye travels
  **0.00 units** while the target travels 150 and the yaw sweeps **110°**.

Both are worth knowing because they are the shape the player has to reproduce:
position and aim are separate, and the aim has a mind of its own.

A note on finding these at all: `CameraSnapToPathEye`,
`CameraStepDeferredRailWithFrameExport`, `CameraPathWithImpulseShake` and
`CameraPlayStashedPath` each **re-point `g_camera_update_hook` at an address
inside themselves** (`0x40C470`, `0x40C790`, `0x40C5C0`, `0x40C8B0`), so the
named function is the *first frame* and the steady state is a separate entry
Ghidra had not split out. Decompiling the name alone shows setup code and hides
the loop.

### Registering, and the slot table

`RegisterForCameraTracking` (`FUN_00408EC0`) is where an enemy joins the
candidate list, and its first line is the important one:

```c
if (obj->flags & 0x10000) return;                 /* not a candidate at all */
key = (int)(|actor.pos - camera_eye| * 10.0f);    /* 0x004C43A4 */
candidates[n++] = {key, obj};                     /* at most 14 */
```

`ZombieStateApproach` **sets** `0x10000` while it walks and **clears** it the
instant the actor wins a permit, so the camera never considers an enemy that
has not committed. `SortCameraCandidates` is an LSD radix sort, two 8-bit
passes over that 16-bit key — nearest first — and `UpdateCameraEnemySlots`
then deals them out: permit holders into slots **0 and 1**, everyone else from
slot 2 (`ClaimCameraEnemySlot` fills 2..13).

### The turn rate

`ComputeLookAtAngleError` clamps the angle between where the camera looks and
where it wants to look to `0x1FFF` (45°), shifts right 7, and indexes one of
four 64-byte curves. The scene reset picks **curve 1**:

| Angle error | Rate | Step per frame |
|---|---|---|
| 0° – ~18° | **64** | 1/65 |
| ~18° – ~23° | 63 → 22 | ramp |
| ~23° – 45° | **16** | 1/17 |

A larger rate is a *slower* turn, so the camera nearly holds still while the
target is close to centre and swings briskly once it is wide. That curve is the
feel of the thing. With nothing registered the rate is a flat **12**.

### The whole loop

```
state 22  ZombieStateApproach     walk in; the ring you start in sets the
                                  queue depth allowed to press an attack
          TryClaimAttackSlot      one permit per player; win it or keep walking
state 1   ZombieStateAttackRun    close until TestApproachRing returns 1
state 2   ZombieStateHoldAtRange  hold, then ask for the permit again
state 3   ZombieStateStrike       lunge, swing, land the hit on its own frame
state 4   ZombieStateBackOff      retreat, still holding the permit
```

### The freeze bit, and the one state that clears it

`obj+0x34` bit **`0x4000`** stops `ZombieAdvanceMotion` (`FUN_00454860`)
stepping `obj+0x194` and `obj+0x198`:

```c
if ((obj[0x34] & 0x4000) == 0) { obj[0x194]++; obj[0x198]++; }
```

The model is still drawn — the gate is on the counters — but root motion is the
difference between two frames of the clip, and a zombie is carried by its clips
and by nothing else. So the bit freezes the pose *and* pins the actor where it
stands. `ThrowerAdvanceMotion` (`FUN_00449EF0`) is class 0x31's copy of the
same gate.

Six spawn records set it at spawn time, through `ActorInitFlags`, and every one
of them names **initial state 21**:

```
state 21  ZombieStateMotionCue21  sub 0  play descriptor +0x04, arm +0x08
                                  sub 1  count it down, then clear 0x4000
                                  sub 2  play out; clear 0x100 at the landing
                                         frame, 0x2000 on the way out, and
                                         hand to descriptor byte 3
```

This is the **only** routine in the game that clears any of those three bits.
It is the entrance for the two zombies that come out through the van's
windscreen in stage 2 and the four in stage 5, all six playing clip `0x39B`
(923) — 41 authored frames against a play length of 79. The exit test is
`g_motion_play_length[motion] - 1 <= obj+0x19C`, so it is in the play clock;
read in authored frames it fires at the halfway point of the jump. `[proved]`

The shot-immunity drop names the clip as well as the frame —
`obj+0x1B4 == 0x39B && obj+0x19C == 0x26` — which is authored frame 19 of 41,
the moment the actor is through the glass. Until then it only ricochets.

### The pause between attacks is the retreat

There is no cooldown timer for an ordinary zombie:
`ZombieStateHoldAtRange` forces `obj+0x133C` to zero unless `obj+0x1368` bit 0
is set. What separates one attack from the next is **state 4**:

```c
motion = g_class30_motion_rows[char][cond][4];      /* the back-away walk */
TurnActorAwayFromPoint(obj, strike_anchor_x, strike_anchor_z, ±0x40);
if (++obj[0x1334] > 0xF0 || d > rings[set].inner) {
    obj[0x133C] = 0;
    ReleaseAttackSlot(obj);                          /* only now */
    state = 2;
}
```

The actor **keeps the permit through the whole retreat** and only gives it up
once it is back outside the inner ring, or after 240 frames. So the next enemy
cannot begin until this one has actually backed away — the turn-taking and the
spacing are the same mechanism.

`g_class30_motion_rows` is `PTR_PTR_00592CBC`, which is not an alternate
reaction table as an earlier revision of this file called it: it is the
character's general motion row, indexed by body condition. 0 and 1 are the walk
variants `ZombieStateApproach` picks between on `obj+0x136C` bit 21, 2 and 3
the attack run, and **4 the back-away** — 256 for `char_adv02`, 1008 for
`char_adv00`, both about 70 frames.

### Nothing walks inside the inner ring

`ZombieStateAttackRun` stops when `TestApproachRing` returns 1 and hands to the
hold; no state closes further. That is what keeps an actor out of the camera,
and it matters for the 161 class-0x30 spawns whose `attack_state` is 0 or −1:
they approach, are refused a permit, and simply stand at the ring.

with `SelectCameraLookAtTarget` reading the slot table every frame, so the
camera swings onto whoever just took a permit and follows them in.

### Enemies that never walk to you

Not every enemy closes. Stage 2 block 5 spawns two class-`0x31` subtype-`0x16`
actors at **y = 87** with 130 hit points — above the street, out of walking
reach. `EnemyThrowerInit` gives that subtype its identity: it replaces bone 5
and bone 8's draw slots (`obj+0x4DC` / `obj+0x68C`, the hands) with asset slots
`0x1FA2` and `0x1F9E` in place of the bare-hand parts `0x1F9F` and `0x1F9B`.
The character is `zsass.bin`, and it spawns holding something in each hand.

### The throw

`ThrowerStateThrow` (`FUN_0044FAF0`) takes **the same attack permit the
zombies compete for**, picks a hand with `ThrowerPickThrowingHand`
(`FUN_0044F630`), reads its entry from `g_class31_throws[set]` — indexed by
`obj+0x130C`, the behaviour set (`MOV EAX, dword ptr [ESI + 0x130c]`,
`8b860c130000`), *not* the body condition, and the identical 0x10-byte layout
as the melee table — and calls `SpawnThrownWeapon` on the frame `+0x08` names:
**48** for sets 0, 1 and 3, 35 for set 2. Right hand plays motion 9, left
motion 8.

**Character type 0x18 reads neither of those numbers.** It is diverted out of
the shared path twice, by two copies of `CMP word ptr [ESI+0x1f4], 0x18`
(`6683bef401000018`):

* at **0x0044FB7A**, for the **clip**. Every other type takes it from the
  entry's `+0x00` (`MOVSX EDX, word ptr [EDI]` — `0fbf17` at 0x0044FB84);
  0x18 jumps to 0x0044FB98 and picks by hand and stance instead —
  `handIdx + 10*stance`, where `handIdx` is `obj+0x131A` (0 for bone 5, 1 for
  bone 8) and `stance` is `3*bit8 + 2*bit7 + bit6` of `obj+0x136C`:

  | stance | bone 5 | bone 8 |
  | --- | --- | --- |
  | 0 ground | `0x1F7` | `0x1F6` |
  | 1 WallA | `0x1FC` | `0x1FB` |
  | 2 WallB | `0x1F2` | `0x1F1` |
  | 3 ceiling | `0x204` | `0x203` |

* at **0x0044FC83**, for the **release frame**. Every other type compares
  `obj+0x19C` against the entry's `+0x08` at 0x0044FC8D (`0fbf4708` then
  `39869c010000`); 0x18 compares it against `obj+0x1350`, into which all eight
  arms of the switch above have written the constant `0x19` = **25** (the same
  ten bytes each time, `c7865013000019000000`). Uniform across every arm, so
  the release frame does not depend on which clip was picked.

`[proved]`. `obj+0x1350` is the **same word** states 2 and 33 use for the
landing surface — one address, two readings, both inside class 0x31, and no
`cls` test separates them.

**That mapping is `.text`, and does not travel in the bundle.** The 32-byte
table at `0x0044FD1C` it indexes is a compiler-emitted dense switch, not a
data table: `.rdata` starts at 0x004C4000, the table sits inside
`ThrowerStateThrow`'s own body, it has exactly one xref in the program (the
`MOV CL, byte ptr [EAX + 0x44fd1c]` — `8a881cfd4400` — at 0x0044FBCF), its
nine jump targets through `0x0044FCF8` are all addresses inside that one
function, and the clip ids are `MOV` immediates in its arms
(`b8f7010000` = `MOV EAX, 0x1F7`). Only eight of its 32 bytes are reachable —
`handIdx` is 0 or 1 and `stance` is 0..3, so the indices that can occur are
0, 1, 10, 11, 20, 21, 30 and 31; the other 24 all hold `0x08`, the default
arm's selector, because a dense switch has to be dense. Under
`docs/formats/bundle.md`'s rule it is transcribed in
`web/src/game/class31/thrower.ts`, where `THROW_BY_STANCE_ZSLMAN` and
`ZSLMAN_RELEASE_FRAME` carry the citation.

`[open]` — the exe's stance is a **sum**, not a selector. If two surface bits
were ever set at once it would exceed 3, the index would leave the table, and
the default arm would run: it plays the clip passed in as the routine's second
argument and **does not write `obj+0x1350` at all**, so the compare would then
read a landing surface as a frame number. Whether the engine can set two at
once is undetermined.

`SpawnThrownWeapon` (`FUN_004504E0`) does five things worth stating:

* spawns the projectile at the **throwing bone's world position**;
* leaves that hand bare — `0x1FA2` → `0x1F9F` for the right, `0x1F9E` →
  `0x1F9B` for the left — and clears its hit sphere;
* marks that arm's **destroyed-zone bit**, which is what the cancel mask reads,
  so an armed hand and a thrown one are the same state as a shot-off one;
* gives the weapon the thrower's **attack permit**, so the projectile damages
  the player the thrower had claimed;
* picks the flying model: `0x1F91` right, `0x1F90` left.

`ThrowerStateRearm` (state 29) later puts the weapon back and clears the bit.

### The flight — `ThrownWeaponFlyToTarget`

```c
ttl      = |target - pos| * 0.8333333;      /* = distance / 1.2 */
velocity = (target - pos) / ttl;            /* constant 1.2 units per frame */
...each frame:
yaw += spin;  pos += velocity;
if (--ttl <= 0) PlayerTakeDamage(permit, 1, 6);
```

A **straight line at a constant speed, and a timed hit** — there is no
collision test at all, exactly like the melee strike landing on a frame number.
`AimThrownWeapon` puts the target 4 units in front of the camera (offset
sideways by 0.6 per player in two-player), so the weapon is aimed at where you
are, not where you will be.

Afterwards it sticks facing the camera for 30 frames and blinks for 60 —
`obj+0x1F8` bit 0 toggled on alternate frames — before despawning.

It is **shootable in flight**: `ThrownWeaponUpdate` registers it for the shot
test, and a hit sends it to `ThrownWeaponDeflected`, which sprays an impact,
plays `BULLET_MET3` and throws it off in a random direction.

## 11. What the player implements

Exact: the hit spheres, hit points through `ActorInitHitPoints`, the per-bone
damage escalation with the `DamageRankModifier` applied, the control codes,
**the sever and its cascade**, the final-stage latch, the withheld torso stage,
the headshot burst, the nearest-first resolution, the score including the
result-5 rule, **the stumble** — the right clip per body region, cross-faded
over the walk on a second track, faded for the upper body and hard-set for the
legs, and skipped entirely for the hits that do not interrupt — the directional
death, the gore swap, and every sound in §9.

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
  law are transcribed, but the frames are asset slots `0x3A..0x52` and `0x091A..` which the bundle does not carry, so a radial splat stands in.
  `[open]`;
* the **special deaths** — `ChooseDeathMotion`'s `obj+0x1368` arms. What sets
  those bits is `[open]`; see §6;
* **civilians, bosses and the ammo/reload cycle**;
* the **body condition** `obj+0x130C`, held at 0. `ActorUpdateBodyCondition`
  derives it partly from `obj+0x4DC` / `obj+0x68C`, which are `[open]`. It only
  changes the stumble at condition 3, and conditions 0, 1, 2 and 4 share a row;
* the **alternate reaction table** `g_pHitReactionMotionsAlt`, reached only
  when `obj+0x136C & 0x100`, which is `[open]`;
* the **fade back out** of a reaction. `MotionCrossFadeTo` states the fade *in*;
  the player fades out over the same length, which is `[likely]`, not proved;
* the **adaptive rank** itself. `UpdateDamageRank` needs lives lost and elapsed
  play time; the player holds the rank at `g_initial_damage_rank[difficulty]`,
  which is what a fresh game starts on.

The gameplay loop **is** implemented end to end: the advance rings, the
per-band step counts, the attack permit, the attack run, the hold at range, the
**strike** with its per-attack lunge distance and exact hit frame, the cancel
mask and the destroyed-zone attack pick, **player lives and invulnerability**,
actors turning to face the camera, and the tracking camera with its slot table,
nearest-first ordering and turn-rate curve. One thing in it is not transcribed
and is marked as such in `enemies.ts`:

* **how an enemy closes the distance** is `[open]`, and genuinely so. Three
  candidates are ruled out: the zombie's own code never writes a velocity
  (no `fstp [reg+0x4c]` anywhere in `0x455000..0x459000`); it is not root
  motion (the clips the approach actually uses — 270, 975, 1000 — each net
  between +0.00 and +0.04 over a full cycle, while the death clips net −8.7
  and −15.7, so root motion is real but carries falling bodies); and it is not
  a step count, per the queue-rank reading above. The player uses an
  **invented** closing speed, flagged as such in `enemies.ts`, because the
  game's own states plainly do close — `ZombieStateAttackRun` runs until
  `TestApproachRing` returns 1, and the strike lunges until inside the attack's
  distance.

### The strike — `ZombieStateHoldAtRange` and `ZombieStateStrike`

Once an enemy is inside the inner ring, state 2 holds it there playing an idle
until the attack cooldown clears, then asks `TryClaimAttackSlot` again. Success
moves it to **state 3**, which is the swing:

```c
sub 0:  idx = picks[(rand % 10) + (destroyed_zones & 7) * 10];
        atk = attacks[body_condition][idx];
sub 1:  if (distance > atk.distance)  { play atk.lunge, keep closing; }
        else { play atk.strike; ActorPlayHitVoice(obj, 3); sub = 2; }
sub 2:  if (play_position == atk.hit_frame) ActorStrikeConnect(obj);
        if (play_position >= length - 1) -> state 4, re-approach
```

The entry is 0x10 bytes:

| Offset | Field |
|---|---|
| `+0x00` | s16 strike motion |
| `+0x02` | s16 lunge motion, played while still beyond *distance* |
| `+0x04` | f32 distance inside which the strike starts |
| `+0x08` | s16 the frame of the clip on which the hit lands |
| `+0x0A` | s16 the motion the **player** plays when hit |
| `+0x0C` | u16 cancel mask |

### Shooting a limb off changes the attack, twice over

The **cancel mask** names destroyed zones — 1 head, 2 right arm, 4 left arm —
and `ActorStrikeConnect` whiffs when every zone it names is gone:

```c
if ((destroyed_zones & 7 & atk.cancel_mask) != atk.cancel_mask)
    PlayerTakeDamage(permit_holder, kind, atk.player_motion);
```

`znchain` shows the design cleanly: a right-arm swing cancelled by `0x2`, a
longer-reach left-arm swing cancelled by `0x4`, a two-armed attack cancelled by
`0x6`, and a fallback with mask `0x8` — which is outside the three-bit mask, so
it can never be cancelled at all. Shoot the arm it swings with and that attack
stops connecting.

And the **pick table** is indexed by the same mask, so a damaged zombie reaches
for a different attack in the first place: `char_adv00` with an intact head
always draws attack 2 (strike 1013, cancelled by a destroyed head) and with the
head gone always draws attack 3 (strike 983, mask `0x8`, uncancellable).

### Three ways the player's version of this went wrong

Recorded because each is a different kind of mistake and the first two are
invisible from the code alone.

**Facing.** `TurnActorTowardCamera` eases the actor's yaw toward
`VecToAngles(obj.x - p.x, 0, obj.z - p.z)` — the angle of **actor minus
camera**. Written the other way round it is a clean 180 degrees, and because
the turn is eased the result is a zombie rotating slowly *away* from you rather
than snapping backwards. Easy to write, hard to spot.

**Permits held by actors that cannot attack.** There are only
`g_max_attackers` permits — one in single player — and an actor that takes one
and then sits in a state with no handler blocks every other enemy permanently.
Two ways in: an `attack_state` of 0 is `g_class30_states[0]`, the engine's
no-op, and **161 of the game's class-0x30 spawns carry 0 or −1**; and the
states that are not 1, 2 or 3 (10, 15, 26, 30, 38 — 51 more spawns) are
approach variants that a client not modelling them will sit in for ever. Both
must be refused a permit or mapped onto a state that terminates.

**Actors that are not class 0x30 at all.** `g_class30_states` belongs to class
0x30. The cat is class 0x53, civilians 0x10, scripted humanoids 0x25 — 279
placements across the game — and running the zombie's approach on them walks
scenery at the camera.

### Damage to the player — `PlayerTakeDamage`

```c
if (invuln_frames[player] || app_state == 5) return;
if (!shielded) {
    g_player_lives[player] -= 1;
    g_damage_rank_pending -= 2;          /* UpdateDamageRank consumes this */
    ScoreAddForPlayer(player, -100);
}
if (kind) { g_player_was_hit[player] = 1; g_player_hit_motion[player] = motion; }
invuln_frames[player] = 0x5A;            /* 90 frames, 1.5 s */
```

**One strike costs exactly one life.** There is no variable damage against the
player — the attack entry's `+0x0A` is a *motion*, not an amount. And the
`g_damage_rank_pending -= 2` closes a loop from §4: being hit lowers the
adaptive rank, which raises the per-bone damage modifier, so the game gets
easier the worse you do. The continue screen restores 1 or 2 lives.

### Do zombies aim their torso and head at the player? No.

Worth stating as a result rather than a shrug, because it is a reasonable thing
to expect and the answer is a clean negative:

* **The bone pose is pure motion.** `SkeletonWalkNode` takes every bone's
  rotation from `g_frame_bone_rotations`, which points straight into the loaded
  motion bank, and adds nothing derived from the actor.
* **The per-frame pose hook is empty.** `SkeletonApplyRootMotion` ends by
  calling a hook stored in the motion block at `+0x115C`. Across the whole
  197,671-instruction program **exactly two** writes to that field exist:
  `FUN_00410440` installs `PoseHookNone` — a bare `return`, and the one every
  skeletal actor including the zombie gets — and one special class installs
  `PoseHookGrowAndPushOutOfWorld`, which ramps a radius and pushes the actor
  out of world collision. Neither rotates a bone.
* **The angles that exist are never read.** `EnemyZombieInit` computes a pitch
  and yaw toward the camera into `obj+0x1320`/`+0x1324`, and nothing in the
  class-0x30 range reads them back.

So the aiming you see is the **whole actor turning** — `TurnActorTowardCamera`
eases `obj+0x68` toward a point 1.5 units in front of the camera — plus the
motion variants the game selects directionally: two walks chosen by
`obj+0x136C` bit 21, the attack by bit 27, the per-region stumbles, and the
four-arc deaths. Body yaw and authored clips, not a bone-level aim.

That took a hook search rather than an xref sweep to establish, because the
pose is reached through a stored function pointer — the same shape that made
the camera tracking invisible earlier in this file. The difference is that here
the hook was found and read, and it is empty.

### Locomotion is still open, but narrower

`SkeletonApplyRootMotion` **does** turn motion root translation into world
movement when `obj+0x64` bit 1 is set. That is not what walks a zombie in,
though: measured over the baked clips, the walk loop's root nets **+0.00** in
both x and z — it only bobs, ±0.22 — while the deaths net **−8.7** and
**−15.7**. So root motion carries a falling body and nothing else, and the
approach velocity is still `[open]`. No `fstp [reg+0x4c]` exists anywhere in
`0x455000..0x459000`, so it is not written in the zombie's own code.

`tools/verify_combat.py` is the check: it re-derives the step tables from raw
bytes, asserts the control-code/slot gap across all 86 character types,
asserts every slot resolves through the asset slot table, asserts every sever
step has a subtree to remove, walks all 2810 spawn/difficulty hit-point pairs
through the clamp, asserts the bone-to-reaction-group map and that every
stumble is shorter than every death (43 against 74), and asserts all 30 combat
sound ids name a file.

---

## 12. Class 0x31 — the wall-crawler

Class 0x30 is a crowd. Class 0x31 is an **animal**: it circles the walls at
middle range, leaps at you when you let it close, stabs on a numbered frame of
the leap, and jumps back out to one side. Four character types share the
machinery — 0x16 `zsass.bin`, 0x17 `zskamere.bin`, 0x18 `zslman.bin`, 0x19
`zstin.bin` — and the one that moves is `zstin`.

### The behaviour set is a byte in the descriptor, not the model

Every table in this class is indexed by `obj+0x130C`, which `EnemyThrowerInit`
takes straight from the spawn descriptor's byte **+1**. It is **not** the body
condition: `ActorBodyConditionFromHands` (`FUN_00455920`) has exactly one
caller in the program and it is class 0x30's state 2. `[proved]`

Stage 2 gives the `zstin` spawns set 0 and the `zsass` spawns set 1; the motion
sets identify the other two, because set 2's first entry is `0x1BA` — the
motion `EnemyThrowerInit` starts character type 0x17 in — and set 3's clips are
the `0x208` family the code hard-codes for 0x18.

**Measured across all six stages**, the `{character, set}` pairs the shipped
descriptors actually use are:

| Set | Characters that take it | Spawns | How it fights |
|---|---|---|---|
| 0 | `zstin` (14), **`zslman` (4)** | 18 | climbs walls and ceilings, then pounces |
| 1 | `zsass` | 8 | stands out of reach and throws |
| 2 | `zskamere` | 15 | stands. Its picks are `7` in every slot of every band |
| 3 | `zslman` | 8 | stands and throws |

Note the second row: **character type 0x18 appears under two different sets**,
which is the clearest evidence that the set is descriptor data and not a
property of the model. The same `zslman` climbs in stage 5 and stands in
stage 6.

### The 35-state table — `g_class31_states`, 0x00592960

`EnemyThrowerUpdate` (`FUN_00449910`) ticks a cooldown, runs the shot drain,
dispatches on `obj+0x1310`, and *then* integrates `vel += acc; pos += vel` —
class 0x31 integrates acceleration where class 0x30 does not, which is what
makes its fall and its knock-back physical.

| # | Routine | What it is |
|---|---|---|
| 0 | `0x0041EBB0` | the engine's shared no-op |
| 1 | `ThrowerStateHitReaction` | the stumble, from `g_class31_hit_reactions` |
| 2 | `ThrowerStateFallAndLand` | knocked off its feet: an arc **at the camera**, then a bounce |
| 3 | `ThrowerStateDeathClip` | character 0x16's own death clip |
| 4, 5 | `ThrowerStateCorpseSink` / `ThrowerStateCorpseBlink` | two seconds of corpse, sinking or flickering |
| 6 | `ThrowerLeave` | release everything and despawn — **never entered as a state** |
| **7** | `ThrowerStateStandAndDecide` | **the hub** |
| **8** | `ThrowerStateWaitForPermit` | idle until a permit frees, then split by character |
| **9, 12, 13** | `ThrowerStateLeapDown` | **the pounce**, one handler for three ids |
| **10** | `ThrowerStateLeapAside` | the leap back out of your face |
| 11 | `ThrowerStateFallToSurface` | fall until the ground catches — how a wall-crawler comes down |
| **14, 15, 16** | `ThrowerStateLeapToSurface` | **onto the far wall, the near wall, the ceiling** |
| 17 | `ThrowerStateGetUp` | motion `0x127`, and **only after a decapitation** |
### The spawn record's flags word

`ActorInitFlags` (`FUN_00408970`) is two lines and it matters more than its
size suggests:

```c
obj[0x34] = spawn_flags | 1;
obj[0x38] = 0;
```

`SpawnFromDescriptor` runs it **before** the class's own `Init`, which then ORs
its own bits on top. Everything the shipped records set:

| bit | spawns | what reads it |
|---|---|---|
| `0x8` | 4 | `Hit` — a shot the update has not drained |
| `0x10` | 5 | skipped by `ColiTestSphereAgainstActors` |
| `0x100` | 6 | `ShotImmune` |
| `0x2000` | 9 | `ArcSpent` |
| `0x4000` | 6 | `PoseFrozen` — the motion clock does not advance |
| `0x8000` | 167 | `RegisterForShotTest` refuses it, and so does the crowd push |
| `0x10000` | 4 | `NoCameraTrack` |
| **`0x20000`** | **95** | **`ZombiePushOutOfWorldAndActors` skips the ground snap** |
| `0x40000` | 22 | `EnemyZombieInit` skips the aim-angle setup |
| `0x8000000` | 155 | picks between `row[2]` and `row[3]` |

`0x20000` is the one that shows. Stage 1's axe man stands on a ledge whose
collision is **two vertical quads** — `coli1.bin:4968`, both `axis 2` with a
zero-Y normal — so `QueryGroundHeightAt` finds nothing under him and falls back
to the script's ground plane sixty-two units below. The flag is what keeps him
on the ledge, and without it he dropped through it and threw from behind the
wall he had been standing on.

### Class 0x30 state 33 — the stationary thrower

`ZombieStateStandAndThrow` (`FUN_00459080`) is the **only class-0x30 state
that never moves the actor**. Seven spawns start in it, every one of them body
condition 7, and three character types have the hands for it:

| type | asset file | bone 5 held / bare | bone 8 held / bare | projectile |
|---|---|---|---|---|
| 1 | `znassb.bin` | `0x1BA9` / `0x1BAC` | `0x1BA5` / `0x1BA8` | `znassb.bin` 3 and 2, **arced** |
| 0x13 | **`tutorial.bin`** | `0x1ECE` / `0x1ECB` | `0x1ECA` / `0x1EC7` | `0x249` — `znonoo.bin` 0, the **axe**, flat |
| 0x14 | `znonoopa.bin` | `0x1EF9` / `0x1EF6` | `0x1EF5` / `0x1EF3` | the same axe |

There is no table for any of that: a switch on the character type inside
`ZombiePickThrowingHand` (`FUN_00458F00`) and `ZombieThrowHandWeapon`
(`FUN_0045A240`) is the whole list. `ZombieArmedHands` is a comparison of each
hand's live **draw slot** — `0x20C + bone * 0x90` — against the one the
skeleton gave it, so shooting a weapon out of a hand, or severing the arm,
disarms it.

The sub-states are `Arm → Wait → Claim → Release → Recover → Leave`, and the
first three are a fallthrough: with zero delays a spawn arms, waits and claims
on one frame, and three of the seven have exactly that. The permit is
`TryClaimAttackSlot`, the same one every other enemy queues for, so a thrower
behind a crowd waits its turn.

Body condition 7 is **sticky**: `ActorBodyConditionFromHands` (`FUN_00455920`)
recomputes the condition from the hands for every type in 0x13..0x14 *except*
when it is already 7 or 5, and the state itself sets 5 as it leaves.

The way out is the descriptor's `tail+0x03` — the same byte the port carries as
`attack_state`. **0** walks away through state 15 with the distance at
`tail+0x10`; **26** leaps through state 26 to the point at `tail+0x10`..`+0x18`
with the gravity at `tail+0x20`. Both are entered at **sub 1**, which is why
those two states have a sub-1 arm that skips their own descriptor read. The
walk arm raises `obj+0x34` bit `0x20000000`, and this is the one place in the
game that reaches `ZombieStateWalkDistance`'s retire-instead-of-attack branch.

A second path reaches the same state: `ZombieShouldStandAndThrow`
(`FUN_00458E10`) lets a **condition 8** walker stop and throw when the camera
is already within `0x400` BAMS of the way it is facing. Fourteen spawns are
condition 8, and they never turn to line the shot up.

#### Where the recompute happens, and why it is the whole of condition 8

`ActorBodyConditionFromHands` has **exactly one caller in the binary**:
`ZombieStateHoldAtRange` (`FUN_00455720`) runs it on its second line, right
after `TestApproachRing`. Nothing else in the program calls it. Two things
follow, and neither is obvious from the routine on its own:

* **A walker keeps its descriptor's condition all the way in.**
  `ZombieStateAttackRun` never recomputes, so a condition-8 spawn is still
  condition 8 for the whole approach — which is exactly the window
  `ZombieShouldStandAndThrow` reads. It throws while it is closing on you.
* **It loses it the moment it arrives.** The first frame at the ring rewrites
  the condition from the hands, so it is 0, 1 or 2 from then on and can never
  be 8 again. That is the "sometimes it throws, sometimes it comes for your
  face" — the throw is the approach and the face is the arrival, in that order.

That matters because conditions **7 and 8 index a different kind of row**.
`g_class30_attacks[0x14][8]` is not a swing:

| index | strike clip | lunge | `distance` | `hit_frame` | cancel |
|---|---|---|---|---|---|
| 0 | 1005 | 783 | **99.0** | 35 | `0x2` |
| 1 | 1004 | 783 | **99.0** | 35 | `0x4` |

Ninety-nine units is a throw's reach, and `ZombieStateStandAndThrow` is the
only state that reads that row — it uses `strike` as the throw clip and
`hit_frame` as the frame the weapon leaves the hand. `ZombieStateStrike`
reading the same row would start its swing ninety-nine units out and land the
hit from across the room. The engine never gets there because the recompute
runs first, on the way into the strike.

#### The operand `0x0045599C` reads wrong

```
00455962  MOV EDI, dword ptr [EAX + 0x4dc]     ; bone 5, the right hand
00455968  CMP EDI, 0x1ece                      ; tutorial.bin  right held
00455970  CMP EDI, 0x1ef9                      ; znonoopa.bin  right held
00455990  CMP dword ptr [EAX + 0x68c], 0x1eca  ; tutorial.bin  LEFT held
0045599c  CMP EDI, 0x1ef5                      ; znonoopa.bin  left held -- EDI!
```

The last comparison still holds the **right** hand's slot. `znonoopa`'s right
hand reads `0x1EF9` armed or `0x1EF6` bare and neither is `0x1EF5`, so its left
hand can never count as armed. Every `znonoopa` that reaches the ring therefore
lands on **condition 1** with `DamageZone.LeftArm` already set, which puts its
attack pick in row 40..49 — ten copies of attack 0, the right-arm swing at
nineteen units. `[proved]`, and the port keeps it.

| **18** | `ThrowerStateWalkDistance` | walk the descriptor's own distance — class 0x30's state 15 is the same routine on the same `f32` at tail `+0x04` |
| **19** | `ThrowerStateEntranceClip` | play the descriptor's own clip |
| 20 | `ThrowerStateLeapToPoint` | the scripted drop |
| 21 | `ThrowerStateRideObjectPath` | object path `0x14F` for 0xC4 frames — **cut content** |
| 22 | `ThrowerStateLeapStrike` | a pounce off the descriptor — **dead code** |
| **23** | `ThrowerStateDelayedPounce` | wait, then leap at the camera's own height |
| 24 | `ThrowerStateCloseAndStrike` | `zskamere`'s standing swing |
| **25** | `ThrowerStateWithdraw` | back off, then stand |
| 26 | `ThrowerStatePathFollow` | a route walked before fighting |
| 27 | `ThrowerStateGrabPlayer` | a camera-relative grab — stage 5's four `zslman` |
| 28 | `ThrowerStateWaitForCue` | wait on a timer, a path frame or a flag |
| 29, 30 | `ThrowerStateRearm` / `ThrowerStateRestoreBothHands` | the weapon goes back |
| 31 | `ThrowerStateThrow` | see §10 |
| 32 | `ThrowerStateStrikeOnTheSpot` | `zskamere` perched on surface `0x35`, swinging for ever |
| 33 | `ThrowerStateKnockedTumbling` | `zslman`'s shot reaction: bounced along its stance's axis |
| 34 | `ThrowerStateBlinkInThreeHops` | stage 6's blinking materialisation |

### What a spawn can actually be placed in

Measured over every shipped `evt/` file, the initial-state byte takes seven
values and no more:

| state | spawns | where |
|---|---|---|
| 18 | 9 | |
| 19 | 10 | |
| 20 | 17 | |
| 23 | 2 | stage 2 block 21 |
| 26 | 2 | |
| 27 | 4 | stage 5, all `zslman` |
| 28 | 6 | the training stage |
| 34 | 8 | stage 6, all `zslman` |

...and the rest are reached, or not, like this:

* **From the router**: 7, 9, 12, 13, 14, 15, 16 and 31 — those are the only
  values in any reachable pick band.
* **From `ThrowerOnShot`**: 1, 2 and 33 — a shot is the *only* way into the
  reaction and death chain.
* **From another state**: 3, 4, 5, 10, 11, 17, 25.
* **Never**: 6 is a subroutine occupying a state slot, and nothing anywhere
  writes 6 to `obj+0x1310`. 21 and 22 are unreachable from anywhere — cut
  content. 24 and 32 are `zskamere`'s and come only from state 8. 29 and 30
  can be reached only by a descriptor byte, and no descriptor names them.

### The repertoire is data — `g_class31_action_picks`, 0x00592A60

`ThrowerStateStandAndDecide` does not choose an action. It hands the job to
`ThrowerPickNextState` (`FUN_0044ADB0`), which measures **one number** — the
ground distance to the camera — and turns it into a band:

```
d <= 30                 -> state 8 outright: wait for a permit, then pounce
40 < d <= 50            -> band 1
everything else         -> band 2
```

then draws a **state id** out of
`g_class31_action_picks[set][band][(rand()>>4) % 10 + (destroyed_zones & 7) * 10]`
and offers it to `ThrowerTryEnterState` (`FUN_0044AFB0`), which refuses it if
the actor cannot do that right now. On a refusal the actor goes back to state 7
and tries again. **Band 0 exists in the table and is unreachable** — the router
starts the band at 2 and only ever lowers it to 1. `[proved]`

`zstin`'s two reachable bands, per ten slots:

```
band 1 (40..50):  14 14 14 15 15 15 16 16 16 12
band 2 (else):     7  7  7  7  7  7  7  7  7 13
```

So at middle range it climbs nine times in ten, and everywhere else it stands
and pounces one time in ten. Sets 1 and 3 offer only `7` and the throw; set 2
offers only `7`. That table **is** the behaviour, and it is why the difference
between the four types is data rather than code.

`ThrowerTryEnterState`'s gates, all `[proved]`:

| State | Accepted when |
|---|---|
| 7 | always |
| 8 | the permit claim **fails** — state 8 is what an actor with no permit does |
| 9 | ...and the claim **succeeds** |
| 0x0C, 0x0D | a permit, and the character is not 0x18 |
| 0x0E, 0x0F | on the ground, and `ThrowerFindWallBeside(∓1.0)` finds a wall |
| 0x10 | on the ground, and `ThrowerFindCeilingAbove` finds a ceiling |
| 0x1D, 0x1E | only from state 7, and only when a hand is bare |
| 0x1F | a hand is still armed, and a permit |
| 0x20 | a permit, and the ground surface under the actor is `0x35` |
| anything else | never |

`ThrowerBothHandsArmed` and `ThrowerHasBareHand` both test character types 0x16
and 0x18 only, so **`zstin` can never throw and never re-arm** — the two states
its picks would allow are refused by identity.

### The stance is which surface it is standing on

`obj+0x136C` bits 6, 7 and 8, as `bit6 + 2*bit7 + 3*bit8`:

| Stance | Bit | Set by |
|---|---|---|
| 0 ground | — | the spawn, from the descriptor's `+0x20` (see [evt.md](evt.md#0x20--the-class-flag-word-and-the-reading-that-was-wrong)) |
| 1 | `0x40` | state 15 arriving |
| 2 | `0x80` | state 14 arriving |
| 3 ceiling | `0x100` | state 16 arriving |

...plus `0x20`, "off the ground", which is what stops a clinging actor turning
to track you and what refuses a second climb. Bit 17 (`0x20000`), set while a
pounce is in flight, adds **4**, which is how `g_class31_melee_attacks` gets
eight rows out of four surfaces. `SelectActorGravityAxis` (`FUN_00450CF0`)
reads the same three bits to pick which axis gravity pulls along, and
`TraceActorSurfaceContactPoint` (`FUN_0044C370`) to pick which way to probe —
three independent consumers of one reading. `[proved]`

The stance re-points **everything**: the idle clip in state 7, the wait clip in
state 8, the attack row, and the arc script the leap back plays.

### Finding a wall — `ThrowerFindWallBeside`, `FUN_0044BEF0`

The gate on states 14 and 15, and it is a question about the *level*:

```
refuse unless |camera_yaw - obj_yaw| <= 0x2000 and !(obj+0x136C & 2)
y    = QueryGroundHeightAt(x, y + 4.5, z) + rand() % 20 + 9.0
hit  = ColiTraceSegmentAllSets(local(±60, 0, 0) at y  ->  the actor at y)
dest = local(∓4.5, 0, 0) from the hit point
```

— sixty units to its own left or right, at head height, and it lands **4.5
units short of the face**. `ThrowerFindCeilingAbove` (`FUN_0044C0B0`) is the
same question straight up, over a thousand units.

`tools/verify_thrower_walls.py` runs those two queries against the game's own
`coli/` sets at every class-0x31 spawn in the game: **24 of the 49 can reach a
wall and 14 have something overhead**, 9 and 4 of them in stage 2. The climb is
level design, not unreachable data.

### The pounce — `ThrowerStateLeapDown`, `FUN_0044B670`

States 9, 12 and 13 share it, and it is the attack. What it is *not* is a swing
at a range:

```
dest  = ThrowerPickLandingPoint()       /* a place on the SCREEN */
yaw   = g_camera_yaw_bams
ActorArcBeginToWaypoint(dest, <null script>, 1)
obj+0x1364 = the stance, latched before the surface bits are cleared
...every frame: ThrowerStrikeConnect()
```

Three things worth naming.

* **The attack is chosen by the null script.** `ActorArcBeginToWaypoint`
  (`FUN_0044D780`) takes a pointer to an arc motion script, and passing the
  `&DAT_007DCC70` sentinel — sixty-four zero bytes — means "roll one instead":
  it draws an index out of `g_class31_attack_picks` and installs *that
  attack's* script. So the swing and the flight are one clip.
* **The stance is latched, then cleared.** `obj+0x1364` is written from the
  surface bits and the bits are cleared immediately after, so a thrower that
  pounces off a wall swings the wall's attack and arrives on the ground.
* **`ThrowerStrikeConnect` (`FUN_0044CE60`) tests no range at all.** It fires
  when the clip reaches the attack entry's `hit_frame`, and the only other
  condition is the cancel mask. The aiming *is* the arc: the landing point is a
  pixel offset unprojected at a fixed depth, so the actor is where the swing
  will reach on the frame it lands. Same design as the melee strike and the
  thrown weapon — this engine times its hits, it does not test them.

Then state 10, `ThrowerStateLeapAside`: a point five units to one side of the
camera and fifty in front **in the camera's yaw-only frame**, vertical-traced
between ±1000 to find whatever floor is there — falling back to
`g_camera_fixed_eye_y` when the trace misses — and arced to. It stands there
for ninety frames or until it is fifty units clear. That wait **is** the
cooldown; there is no timer.

### The arc, and the three-stage script

Nothing in this class walks except state 18 and the hub. Every other move is a
ballistic arc to a named point:

```
ActorArcInterpolate(n):      /* FUN_0044DD00, an absolute position */
  x = src.x + (dst.x - src.x)/T * n
  z = src.z + (dst.z - src.z)/T * n
  y = src.y + (T*T*g2 + 2*dy)*n / (2T)  -  g2*n*n*0.5      g2 = 0.027222222
```

with the duration from `ActorArcBeginToAtSpeed` (`FUN_0044DB50`) for character
type 0x19 — the horizontal distance at a fixed **30 units per `minFrames`**,
so 2.0 units a frame — and from `ActorArcBeginTo` for the rest.

Over it runs a **three-stage arc motion script**, twelve dwords that
`InstallArcMotionScript` (`FUN_0044DA60`) copies into `g_arc_scripts`:

```
{ s32 motion, s32 start frame, s32 fade, s32 threshold } x 3
```

Every script in the program names the **same motion** in all three stages, so a
script is one clip cut into windup, flight and landing. `ActorArcStep`
(`FUN_0044D860`) plays stage 0 on the spot, stage 1 once the clip frame passes
stage 0's threshold, stage 2 once it passes stage 1's, and reports the arc over
past stage 2's. `zstin`'s attack 0 is `{303,0,5,22}{303,23,5,46}{303,47,0,47}`
and connects on frame **62** of the same clip.

> ⚠️ **Every one of those thresholds is in engine frames, at 60 Hz.** `mot/` is
> authored at 30 Hz, so the baked clip's own index is half of it: clip 303
> bakes to 34 keys and the hit frame is 62. Reading the baked index is why the
> port's pounce landed and never connected.

### The tables

| Address | Name | Shape |
|---|---|---|
| `0x005929F0` | `g_class31_motion_sets` | `[set]` → `s32[6]`: idle, idle, walk, walk, landing, airborne |
| `0x00592A00` | `g_class31_throws` | `[set]` → eight `0x10`-byte entries, the class-0x30 attack layout |
| `0x00592A10` | `g_class31_melee_attacks` | `[set]` → `[stance][4]` of `{script*, s32 hit frame, s32 player motion, u32 cancel mask}` |
| `0x00592A20` | `g_class31_attack_picks` | `[set]` → `s32[8][10]`, which attack by destroyed zones |
| `0x00592A60` | `g_class31_action_picks` | `[set]` → three bands → `s32[8][10]` of state ids |
| `0x00592A70` | `g_class31_hit_reactions` | `[set]` → `s32[8]` by reaction group |

Two of those rows are shared and it matters: `g_class31_melee_attacks` gives
set 0 and set 3 five stances and sets 1 and 2 a single one, packed end to end
with no count, so reading a fixed eight walks into the neighbour's entries.
That is the adjacent-array trap, and the exporter bounds each row by the start
of the next.

### Being shot — `ThrowerOnShot`, `FUN_004499A0`

Class 0x31 does not use the shared stagger or the shared *directional* death.
The damage is shared — `DispatchHit` → `ResolveHit` charges the hit points,
swaps the gore and awards the points, exactly as for a zombie — and then this
routine reads the result and picks a **state**:

```
if (obj+0x34 & 0x100)               nothing: the shot ricochets
if (result == 5)                    nothing
if (obj+0x136C & 0x200000)          nothing: the death is already latched
release the permit, clear the pounce and band bits
if (dead)                           state 2,  latch 0x200000, voice 2 on a head shot
else if (obj+0x34 & 0x2000)         nothing: two knockback arcs are spent
else if (char == 0x18)              state 33, the tumble
else if (state == 7 && on ground)   state 1,  the stumble
else                                state 2,  the knockdown
```

Two consequences worth naming. **A knockdown is survivable** — state 2 lies
still for `(rand()%10+1)*3` frames, plays a get-up and returns to the hub with
its hit points intact — so being knocked over is not the same as dying. And
`obj+0x1368` is the **bone index** here, where class 0x30 keeps a bitfield of
special-death arms in the same word: one offset, two meanings, and conflating
them is a stumble that plays the wrong clip.

`ThrowerShotFeedback` (`FUN_00449B20`) is the other half, and one thing in it
is load-bearing: a result-1 hit on **bone 2** that swaps the head model to
`0x2015` raises `obj+0x136C` bits `0x6000000`, and `0x4000000` of that pair is
the only thing in the class that routes states 1 and 2 into **state 17**. So a
thrower plays its get-up exactly when you have taken its head off and it has
survived it.

### The two motion banks, and why every table has two rows

Character types 0x16, 0x18 and 0x19 are sixteen-bone **`szom.bin`** skeletons
(motion bank 47); 0x17 alone is a twenty-four-bone **`kame.bin`** one (bank
20). Every per-set table in this class resolves to exactly two distinct rows
along that line — `g_class31_hit_reactions` rows A and B, `g_class31_throws`
rows A and B, `g_class31_melee_attacks`' five-stance rows against its
one-stance one. The "four behaviour sets" are really two skeletons and two
variations. `[proved]` by the banks: row A's reactions are `0x3A1`–`0x3AB`,
all bank 47, and row B's are `0x1BD`–`0x1BF`, all bank 20.

One consequence is an engine bug, left as it is: `ThrowerStateGetUp` plays
motion `0x127` with no character-type branch, and `0x127` is a `szom.bin` clip.
`zskamere` can reach that state and has no such clip on its rig.
