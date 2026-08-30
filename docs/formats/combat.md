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
giving `(first asset slot, last asset slot, scale)` — an animated sprite that runs
the range and dies. Material 1 is slots `0x091A..0x092F` at 1.0; water is
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

Three concentric radii per ring set, and the ring the enemy starts in decides
**how many steps it walks before it may attack**. Sub-state 1 then plays the
walk and counts down, and on the last step calls `TryClaimAttackSlot`; only if
that succeeds does it hand control to the state named by the spawn descriptor
tail's byte 3, which is where the attack lives. Fail and it keeps walking.

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
state 22  ZombieStateApproach   walk in; the ring you start in sets the steps
          TryClaimAttackSlot    one permit per player; win it or keep walking
state 1   ZombieStateAttackRun  close until TestApproachRing returns 1
state 2                         the strike
```

with `SelectCameraLookAtTarget` reading the slot table every frame, so the
camera swings onto whoever just took a permit and follows them in.

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

The gameplay loop **is** implemented: the advance rings, the per-band step
counts, the attack permit, the attack run and the strike, actors turning to
face the camera, and the tracking camera with its slot table, nearest-first
ordering and turn-rate curve. Two things in it are not transcribed and are
marked as such in `enemies.ts`:

* **how fast an enemy walks** is `[open]` — the velocity source in the
  class-0x30 update was not found, so the speed is derived from the game's own
  ring table instead: an actor crosses a band in the number of steps that band
  allots, one step being one cycle of its walk motion. That falls out at about
  6 units/second on the default rings;
* **the strike itself** is `[open]`; the player holds the pose for one step and
  then releases the permit so the next enemy can commit.

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
