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

## 4. Resolving the hit — `FUN_004092F0` → `FUN_00409430`

Each actor, in its own update, checks whether it was shot. `FUN_004093C0`
decides which players resolve and in **which order** — in two-player it is
randomised, so simultaneous hits do not systematically favour player 1.

`FUN_00409430(player)` reads three tables, all indexed the same way:

```c
bone = obj[0x190 + player];
n    = obj[0x298 + bone*0x90];        /* hits already taken on THIS bone */
i    = bone * 6 + n;

effect_slot = u16 PTR_DAT_004C7160[char_type][i];
next        = u16 PTR_DAT_004C7160[char_type][i + 1];
damage      = u16 PTR_DAT_004C8350[char_type][i];
damage     += (s8) PTR_DAT_004D0D84[char_type][bone*0x10 + rank];
```

So every bone has a **six-step escalation**: each successive hit on the same
bone does more damage and swaps in a gorier model. `next` is the *following*
step, which is how the code knows whether this hit is the last one that bone
can take.

`char_adv00`, the common stage-1/2 zombie:

| Bone | Damage per successive hit |
|---|---|
| 2 — head | **100, 120, 140, 160** |
| 1 — torso | 50, 60, 70 |
| 9 — pelvis | 35 |
| 3, 6 — upper arm | 25, 35 |
| 4, 7 — forearm | 25, 30 |
| 5, 8 — hand | 25, 30, 35 |
| 10, 13 — thigh | 20, 30 |
| 11, 14 — shin | 20, 25 |
| 12, 15 — foot | 20 |

The cat is a flat 10 everywhere and has no escalation, which is what you would
expect of something that is not meant to be fought.

Damage is applied by `FUN_004098C0`: `obj+0x11C -= damage`, unless flag `0x1000`
(invulnerable) is set. `obj+0x11C` is current HP and `obj+0x11E` is max, both
seeded from the spawn descriptor's `+0x22` and adjusted by difficulty through
the table at `0x005776B0` (`{−30, −15, 0, 0, 0}`), clamped to `[1, 300]`.

### The gore swap — `FUN_004098E0`

```c
record[0] = effect_slot;        /* record[0] IS the slot the bone draws */
FUN_004099A0(record, slot, char_type);   /* resolve it for this character */
```

The bone's **draw slot is replaced**, which is why a zombie visibly comes apart
where you shoot it. `FUN_004099A0` falls back to character type 7 (or 0x0B) when
a character has no variant of its own, so there is a shared gore set behind the
per-character ones.

## 5. Score — `ScoreAddForPlayer`

| Event | Points |
|---|---|
| any hit that is not on bone 2 | **10** |
| a hit on bone 2, the head | **120**, plus a per-player combo counter |
| HP reaching 0 | **80** |

The head combo (`DAT_009A5C82 + player*0x98`) is added *and then incremented by
10*, so consecutive headshots pay 120, 130, 140 … and any non-head hit resets it
to zero. The hit counter at `DAT_009A5C86` feeds the end-of-stage accuracy grade
that evt `0x2B` reads.

Shooting a **civilian** (class 0x10) costs a life and −100 twice; rescuing one
awards +400.

## 6. What the player implements

Everything above except:

* the **collision-mesh** refinement — the sphere pass alone decides the bone,
  which is the same answer except at grazing angles;
* the **difficulty modifier** from `PTR_DAT_004D0D84`, which needs a rank;
* the **death animation** — which motion a dying actor plays is chosen by its
  class's state machine, and only two of the 54 zombie states are read
  (see [`mot.md`](mot.md) and `hod2lib/characters.py`);
* **civilians, bosses and the ammo/reload cycle**.

The hit spheres, the bone-indexed damage escalation, the nearest-first
resolution and the score are all exact.
