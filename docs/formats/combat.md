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

`ProcessPlayerShots` is a **task**, and where it sits in the task list is half
of how the shot test behaves. `ProcessPlayerShotsTaskCreate` (`FUN_00404480`)
makes it last in the scene's list (`0x00460751`), after the two player tasks,
and tasks run in creation order, so every actor, being allocated later, runs
after it. So each frame goes: the player task reads the trigger and
`BuildShotRay` writes the shot record, then `ProcessPlayerShots` tests the list
the actors registered **on the previous frame**, against the draw records that
frame drew. Then it empties the list, and the actors read their hit bit and
register again. `[proved]`

```
per player (shot records 0x009A5C78, stride 0x130):
    g_coli_candidate_count = 0;  g_shot_hit_something[p] = 0
    if (!fired) continue;   fired = 0
    for each g_shot_test_list entry (0x0059D8E8, count g_shot_test_count 0x005A4C80):
        obj+0x34 & 0x10 ? ShotTestMesh (FUN_00404A00) : ShotTestSphere (FUN_00404630)
    ShotTestWorld (FUN_00404B80)            -- every time, not only on a miss
    if (g_coli_candidate_count) { MarkActorShot(p); g_shot_hit_something[p] = 1 }
ColiPublishDynamicList(); g_shot_test_count = 0     -- 0x0040461E
```

### Registration — `RegisterForShotTest`, `FUN_00405160`

An object is a candidate for exactly one frame: the one after its own update
called this. The caller writes `obj+0x70..0x78` (a point **in view space**)
first, then:

```
if (obj+0x34 & 0x8000) return;                             ; never
if (!(obj+0x34 & 0x10) && !(obj+0x78 <= 0.0)) return;       ; behind the eye
list[n++] = {obj, obj+0x34, obj+0x12C, obj+0x130, obj+0x134}
```

The depth test is `FCOMP [0x004C436C]` (`0.0`) / `TEST AH,0x41`, which passes
on less, equal and unordered. A mesh object (`0x10`) is taken at any depth.

**Who calls it.** `get_xrefs_to 0x00405160` lists 53 callers. A scan of the
image for `E8`/`E9` rel32 whose target is `0x00405160` finds **95**, and there
is no absolute pointer to it anywhere, so the 95 are the set. The 42 Ghidra
misses are in bytes it has not disassembled, most past a `MatrixStackPop` it
calls no-return (`L35`). The one that matters is `ActorRegisterCameraPoint`
(`FUN_00409B70`):

```
00409BA3  obj+0x70..0x78 = g_camera_world_to_view * obj+0x100..0x108
00409BE7  CALL MatrixStackPop               ; Ghidra: no-return
00409BEC  PUSH ESI                          ; ESI = g_cur_actor
00409BED  CALL RegisterForShotTest
00409BF2  obj+0x104 += rise;  RegisterForCameraTracking(obj)
```

Its seventeen call sites are the registration of classes 0x10, 0x11, 0x14,
0x19, 0x2D and 0x32, and one of the routes of 0x22, 0x23, 0x30 and 0x31. None
of those classes' updates shows up as a caller of `0x00405160`, which is the
whole reason this was hard to see.

### Broad phase and fork — `ShotTestSphere`, `FUN_00404630`

```
if (RayTestSphere(p, obj+0x70, obj+0x74, obj+0x78, obj+0x124) <= 0) return;
if ((obj+0x34 & 0x80) && g_character_skeletons[obj+0x1F4]->+0x16 > 0
    && !(obj+0x34 & 0x8000))
    ShotTestSkeleton(obj, p);
else
    push {key __ftol(-obj+0x78 * 10.0), point obj+0x70.., obj, flags obj+0x34}
```

**The sphere at `obj+0x124` is the broad phase for everything**, per-bone or
not: a shot that would clip a bone lying outside it never reaches the bone
walk. The fork re-reads `obj+0x34` live, so `0x8000` raised after the object
registered sends a per-bone actor to the whole arm.

**Bit `0x80` is set by the skeleton build and by nothing else.**
`SkeletonBuildAndPose` (`FUN_00410590`), called only from
`ActorBuildSkinnedModel` (`FUN_00410440`), does `OR CL,0x80` on `g_cur_actor`'s
`+0x34` when the character's skeleton has root nodes (`0x004105CC`..
`0x004105E2`). A linear sweep of `.text` finds no other instruction that sets
the bit. Every skinned class's `Init` points `g_cur_actor` at itself before it
builds, so civilians, zombies, throwers and every boss carry it. Six builders
clear it again with `AND 0x7F` straight after: `PlaceBats`, `SpawnBatWings`,
`CatInit`, `SpawnGoldenFrog`, and `0x00463E50` / `0x004641F0` (class 0x41). This
file used to say that no civilian ever has the bit; the build gives it to
every one of them.

### Per bone — `FUN_00404700` → `FUN_00404750` → `FUN_004047D0`

`ShotTestSkeleton` sets `g_cur_actor` and walks **the same skeleton tree the
renderer uses**, `g_character_skeletons[char_type]`: the root count at `+0x16`,
the roots at `+0x18`. `ShotTestBoneTree` tests a node only if its draw record's
slot (`rec+0x00`) is non-zero. A severed bone and its subtree have zero, from
`RemoveBoneSubtree`. If the node is tested, `rec+0x74 & 0x10` picks the mesh
test over the sphere. Then it recurses into the node's children **whether or
not the node was tested**.

Each bone's hit sphere comes from `PTR_DAT_004D032C[char_type]`, stride `0x14`,
indexed `bone − 1`:

```
+0x00  u32  asset slot this entry belongs to
+0x04  f32  centre x, y, z   (bone local)
+0x10  f32  radius
```

`SkeletonWalkNode` (`FUN_004107E0`) copies it into the bone's draw record
(base `obj+0x20C`, stride `0x90`) **once, when the skeleton is built**. Its only
caller is `SkeletonBuildAndPose`. (This said "each frame" until the callers
were counted.) It scales the radius by `obj+0x1300` and zeroes the sphere
unless the entry's slot equals the node's. It writes `rec+0x74 = 0x21`, so the
mesh arm is never taken for a built skeleton. The view-space centre at
`rec+0x68..0x70` is what `SkeletonEmitNode` (`FUN_004114C0`) writes every
frame as it draws the bone, and only while `obj+0x34 & 0x8000` is clear
(`0x00411682`..`0x004116C9`, past a pop the decompiler stops at). A zombie's
radii read as anatomy: **torso 2.55, head 1.3, upper arm 1.4, hand 0.8,
pelvis 1.75, thigh 2.15**.

`ShotTestBoneSphere` skips a radius of exactly `0.0` (`TEST AH,0x40`), tests
with `RayTestSphere`, and pushes `{key __ftol(-rec+0x70 * 10.0), node, obj,
flags rec+0x74}`.

The intersection, `RayTestSphere` (`FUN_004062A0`), rotates the centre into
the shot's frame with the four numbers `BuildShotRay` left in the record:
`+0x38/+0x3C` = sin/cos(−pitch), `+0x40/+0x44` = sin/cos(−yaw), the angles
being `VecToAngles` of the view-space crosshair vector, as BAMS. The pitch is
the **first** output: only that order measures a shot along +x from the x
axis. Then:

```c
u = -(cx * cos_yaw) - cz * sin_yaw;
v = cz * cos_yaw * sin_pitch - (cx * sin_yaw * sin_pitch + cy * cos_pitch);
return sqrt(u*u + v*v) <= radius ? 1 : -1;      // TEST AH,0x41: NaN hits
```

A **line** through the eye, not a ray and not a segment: nothing asks whether
the point is in front. `RegisterForShotTest`'s depth test is what keeps an
object behind the camera out.

### The world is in the same sort — `FUN_00404B80`

`ShotTestWorld` traces the segment (**origin → origin + direction × 1000**)
against each blob of the two script-selected sets. Each blob that
`ColiSegmentVsMesh` hits pushes its nearest-to-eye hit through
`ShotPushWorldCandidate` (`FUN_00404C80`): flags `0`, no object, then
`ShotPushColiHitCandidate` (`FUN_00404CB0`) — key `__ftol(-z * 10.0)` of the
hit point in view space, flags `|= 0x10`. `ShotTestMesh` pushes a mesh object
the same way with flags `obj+0x34 | 0x40` (`0x00404B50`). **A wall nearer than
the zombie behind it wins the shot.**

### Commit — `FUN_00404DB0`

`ColiSortHitCandidatesByDistance` (`FUN_00405080`) sorts the keys: an LSD
radix sort on **`key & 0xFFFF`**, two 8-bit passes, each placing entries from
the last one back, so it is **stable**. Equal low-16 keys keep push order,
which is registration order across objects, tree order within one, and the
world last. A key past 6553.5 units wraps, and so does a negative key from a
point behind the eye. `MarkActorShot` takes element 0 and forks on its flags
word (`+0x2C`):

```c
if (flags & 0x20) {                       /* a bone */
    obj->+0x34 |= (1 << (player + 1)) | 8;  rec->+0x74 |= the same;
    obj[0x190 + player] = node->+0x14;      /* the bone's own index */
} else if (!(flags & 0x10) || (flags & 0x40)) {   /* whole, or a mesh object */
    obj->+0x34 |= (1 << (player + 1)) | 8;
    obj[0x190 + player] = 1;                /* a literal 1, not a bone */
}
if (flags & 0x10) SpawnWorldImpact(player);   /* the world, a mesh, a bone mesh */
```

Then, in Original Mode with weapon kind 3, sprite effect `0x53` at the hit.

### The port

`web/src/game/combat/shot_test.ts` ports `RegisterForShotTest`,
`ShotTestSphere`, the three bone routines, `RayTestSphere` (with
`BuildShotRay`'s angle quantisation) and `ColiSortHitCandidatesByDistance`, for
the classes that set `ClassHandler.registersForShotTest`. Such a class calls
`RegisterForShotTest`, or `ActorRegisterCameraPoint` (`camera/track.ts`, which
now carries the tail call), from its own update at the exe's site. The
director stops calling the camera point for it, and `render/`'s pick passes it
by. **Every class that calls `ActorRegisterCameraPoint` is filed**, flag or
no flag, as `0x00409BED` files it, because the list's second reader is the
crowd push (see section 10); the pick is what migrates, and
`ShotTestPickedHere` is where it passes over the entries of a class
`render/` still picks. `ColiPublishDynamicList` and then `ShotTestListReset`
run where `ProcessPlayerShots` ends, straight after the player tasks.
`ActorSpawn` runs `ActorBuildSkinnedModel`, which raises
`0x80` on a type with bones, and `CatInit` clears it. The port holds
`obj+0x70..0x78` in world space (`Actor.shotCentre`) and takes the depth
through the camera its frame reads.

**The mesh arm.** `ShotTestBoneTree` takes `ShotTestBoneMesh` (`FUN_004048A0`)
for a record whose `+0x74` has bit `0x10` and whose `+0x88` names a blob; the
skeleton build writes `0x21`, and the only `Init` that raises the bit is
`Boss4Init`, for the ten bones its descriptor gives a `coli4.bin` mesh
(`Actor.boneColi`). The port tests the shot segment (`ShotBuildSegment`, a
thousand units) against the blob in the bone's frame, over
`GameHost.boneMatrix` and `ColiSegmentVsMesh`, and the candidate
(`ShotPushColiHitCandidate`, `FUN_00404CB0`) carries the point, the normal and
the quad's surface; `MarkActorShot` hands them to `SpawnWorldImpact`, which
fills `g_shot_hit_records` for the boss's own `Boss4ResolveShot` to read.

**Several pulls in one frame.** `[port-only]` The engine reads the trigger once
a frame, so the shot record a class reads back on its update is always the
pull that marked it. The port's queue lets one frame take several pulls per
player -- a driver's volley arrives whole between two driven frames (`L50`) --
so `MarkActorShot` also keeps each marking pull's ray beside the bone byte,
per player, in `Actor.shotRays`. Class 0x14's weak-point gates read that
instead of `G.g_crosshair_ray`; with one pull a frame they are the same object.

JUDGMENT's two classes set the flag (`game/class22/`, `game/class23/`), and
so does Strength (`game/class19/`: `Boss4Update` calls
`ActorRegisterCameraPoint(state+0x70)` at its `0x00491A49` line, and the mesh
arm above is its alone), at the sites below; the other bosses are being ported
in other workstreams and each will set it with its own module. The sites:

| class | registers at | through | gate | `obj+0x124` | `0x80` | `0x8000` |
|---|---|---|---|---|---|---|
| `0x14` | `Class14Update` `0x0047621E` | `ActorRegisterCameraPoint(state+0x0C)` | none | 30.0, `Class14Init` `0x00475F4F` | build `0x00475F2E` | set `0x00475ECF`; cleared by the entrances `0x00478349`, `0x004785D2`, `0x0047880F` |
| `0x19` | `Boss4Update` `0x00491A49` | `ActorRegisterCameraPoint(state+0x70)` | none | 30.0, `Boss4Init` `0x00491885` | build `0x00491866` | set `0x00491820`; cleared by the entrances `0x00493922`, `0x00493BB0` |
| `0x22` | `Class22FightPhase1` `0x0049C145` | `RegisterForShotTest`, after writing `obj+0x70 = view(obj+0x100)` inline and clearing bits 1-3 | tail of the phase | `g_actor_radius_by_char[0x45]`, `Class22Init` `0x0049B15A` | build `0x0049B126` | — |
| `0x22` | `Class22FightPhase2` `0x0049C8CE` | `ActorRegisterCameraPoint(2.0)` | `obj+0x34 & 0x100` clear | | | |
| `0x22` rider | — | a plain `FUN_004A74E0` allocation at `obj+0x13B0`, not a task | never updates | — | build `0x0049B1B0` | set `0x0049B1BC` (`|= 0x88000`) |
| `0x23` | state 1 (`0x00490150`) `0x004901E9` | `RegisterForShotTest`, `obj+0x70` left from last frame | companion's HP ≤ own | `g_actor_radius_by_char[0x44]`, `Class23Init` `0x0048FE04` | build `0x0048FDE6` | set by `0x00490B00` at `0x00490B92` |
| `0x23` | state 1 `0x00490917`; subtype-2 state 1 (`0x00490FD0`) `0x004912EA` | `ActorRegisterCameraPoint(6.0)` | none | | | |
| `0x23` | state 2 (`0x00490B00`) `0x00490C3B` | `RegisterForShotTest`, after `obj+0x70 = view(obj+0x100)` inline | after its own `0x8000` | | | |
| `0x45` head | `Boss3FightHeadUpdate` `0x004215AF` | `RegisterForShotTest`, after `obj+0x100 = obj+0x40` and `obj+0x70 = view(obj+0x100)` | `obj+0x1310 != 7` | `g_actor_radius_by_char`, `Boss3FightHeadInit` `0x0041FF81` | build `0x0041FF5C` | set `0x0041FF68`; cleared at `0x00420E81`, `0x00420F96`, `0x00422DD5` |
| `0x45` body | `Boss3BodyUpdate` `0x00424160` | `RegisterForShotTest`, `obj+0x70 = view(obj+0x40..0x48)` at `0x00423FD1` | none at the call | `[0x004C4E48]`, `Boss3BodyInit` `0x004203C0` | build `0x004203A0` | — (`|= 0x80080000`) |

Ghidra's live database has other workstreams' newer names for some class-0x23
routines (`Class23FightBesideCompanion` at `0x00490150`, `Class23Collapse` at
`0x00490B00`, `Class23TrainingFightAlone` at `0x00490FD0`). The addresses are
the reading.

**What converting the rest takes.** Each class below is picked by `render/`
with no registration and no broad phase, which is that file's declared
divergence. Converting one means setting the flag and calling the routine at
these sites. The pools that already model their own registration (class
0x41's props, the carried props, the body creatures) would move into the one
list instead:

* `0x10` `CivilianUpdate` `0x0048ADB0` (camera point, 4.0); `0x11` `FrogUpdate`
  `0x0043A2C7` (1.0); `0x30` `EnemyZombieUpdate` `0x0045347A` (4.0),
  `ZombieTwinFollowHost` `0x004533CB`, the thrown weapon `0x0045A612`; `0x31`
  `EnemyThrowerUpdate` `0x00449991` (0.0), its projectile
  (`ThrownWeaponUpdate`) `0x004508AA`; `0x18` through `EnemyZombieUpdate`.
* `0x13` `0x0043FFA4`; `0x20` `0x00449366`, `0x00449519`; `0x21` `0x00451D08`,
  `0x0045283A`; `0x26`'s boat `0x0048EE9C` (a mesh); `0x33` `0x004334D0`,
  `0x00433CC7`; `0x40` `0x0043C42A`, `0x0043D425`, `0x0043D7DD`, `0x0043D9DB`,
  `0x0043E330`; `0x43` `0x00446488`; `0x44` eight sites `0x00473CDF`..
  `0x004758C7`; `0x46` `0x0042E9B7`, `0x0042ED16`, `0x0042F401`, `0x0042F5B3`;
  `0x51` `FishProjectToScreen` `0x00439BE3`; the class-0x53 trigger through
  `ActorRegisterOriginInViewSpace` (`FUN_0043F950`, the call at `0x0043F9C2`).
  That routine has **one** caller, `CatBranchTriggerUpdate` (`get_xrefs_to`),
  so this line used to be wrong to say both branch triggers call it; the
  other site it listed, `0x0043FB76`, lies outside it, in the unfunctioned
  code from `0x0043F9D0`. Whose routine that is, and where `0x52`
  registers, is `[open]`.
* Class `0x25`: `[likely]` none. No site lies in its routines, and every shared
  routine that registers is accounted for above. The exception is
  `FUN_004825B0` (`0x00482991`), a task `FUN_00482070` allocates, whose owner
  is `[open]`. Class `0x42`'s falling breakables register through
  `FUN_0042FCA0` (`0x00430AF6`), which `PlaceFallingBreakableBatch` installs.
* And `ShotTestWorld` into the same sort, which `combat/shot.ts`'s
  `ShotHitWorld` declares it does not yet do.

## 4. Resolving the hit — `DispatchHit` -> `ResolveHit`

Each actor, in its own update, checks whether it was shot. `ChooseHitPlayerOrder`
decides which players resolve and in **which order** — in two-player it is
randomised, so simultaneous hits do not systematically favour player 1.
`DispatchHit` (`FUN_004092F0`) copies `(s8)obj+0x190+player` into
`g_shot_bone[player]` and calls `ResolveHit`.

### `obj+0x34` bit `0x100` is a hole in the world, not a damage modifier

`DispatchHit` is the **only** caller of `ResolveHit` in the image — one xref —
and it jumps over the call when that bit is set:

```
00409336  8b4834      MOV  ECX, dword ptr [EAX + 0x34]
00409339  f6c501      TEST CH, 0x1                  ; obj+0x34 & 0x100
0040933c  750e        JNZ  0x0040934c               ; past everything below
0040933e  56          PUSH ESI
0040933f  e8ec000000  CALL 0x00409430               ; ResolveHit
```

**[proved]**, and it settles what "shot-immune" means: **no damage at all** —
not reduced damage, and not a hit resolved and then discarded. Every window a
class raises the bit in is a window in which the damage tables are never
opened: `ThrowerStateFallAndLand` (`FUN_0044A450`) from the moment the body
settles until the get-up ends, `ThrowerStateGetUp` (`FUN_0044C2E0`) for the
length of its clip, `ZombieStateEmergeFromWater` for the submerged half, and
the scripted freezes.

The bone is still written and the actor is still marked, so **the shot still
gets feedback** — which is where `ThrowerShotFeedback`'s (`FUN_00449B20`) own
opening line comes from:

```c
if (obj+0x34 & 0x100) g_hit_result[player] = 5;
```

Result 5 is the ricochet: sprite 3 (or 0x51 for character type 0x18), one of
the metal clinks, no blood, and `ResolveHit` never ran so there is no score and
no head combo either. Class 0x30 reaches the shared `ActorShotFeedback`
(`FUN_00454050`) with `g_hit_result` **left over from the last resolved hit**,
because `DispatchHit` writes the bone and not the result; that is an
uninitialised read and the port does not reproduce it.

The two halves of this rule are easy to separate and expensive to separate:
`ThrowerOnShot` (`FUN_004499A0`) and `ZombieOnShot` (`FUN_00453EB0`) test the
same bit and refuse to pick a *reaction*, so a port that gates the reaction and
not the damage kills actors in the one window where nothing is listening for a
kill. See `docs/BUGS.md`, the `zsass` at stage 2 `0x8094`.

### The bone records those indices address

`obj + 0x20C + bone * 0x90` is bone *bone*'s record and `obj + 0x298 +
bone * 0x90` its hit count -- the `n` above -- so for **bone 1** the record's
draw slot is `obj+0x29C` and its count `obj+0x328`. `[proved]` from
`ActorSwapDamagedPart` (`FUN_004098E0`), which takes the record's address as
its first argument and reads `param_1[0x23]` (`+0x8C`, the count) to index the
effect table.

One routine writes that pair **without** going through the swap:
`ZombieStateReleaseBodyCreature` (`FUN_00457FB0`) sets `obj+0x328 = 1` and
`obj+0x29C = g_pBoneEffectSlots[type][7]` directly, which is the torso's first
damage step at the index a first hit would have used. Because it skips
`ActorSwapDamagedPart` it sets no `obj+0x1318` zone bit and severs nothing, so
the body condition `ActorUpdateBodyCondition` derives is untouched and the
actor still dies its ordinary death.

### `ActorReactToHit`'s first arm, and where it has to be called from

`ActorReactToHit` (`FUN_004543F0`) is **the one place in the image that tests
a character type against `0x0A`** -- `znjoe`, seven spawns, all in stage 5.
Result 1 on bone 1 of such an actor, with `obj+0x34` bit `0x400` still clear,
raises `0x4000400`, scores `0x50`, records the shooter at `obj+0x131C` and
sets state `0x19` sub 0 **instead of** playing a reaction.

`0x4000000` is the same bit `ZombieOnShot` (`FUN_00453EB0`) tests to decide an
actor is dead:

```
00453F46  f7463400000004  TEST dword ptr [ESI + 0x34], 0x4000000
00453F4D  0f84c7000000    JZ   0045401A          ; alive -> the reaction
0045401A  57              PUSH EDI
0045401B  e8d0030000      CALL 0x004543F0        ; ActorReactToHit(player)
```

The call site is five instructions past the test, which is the only reason the
arm can raise that bit at all: by the next frame state `0x19`'s sub 0 has
latched `obj+0x136C` bit `0x80000000` and `ZombieOnShot` returns at `00453F40`
before reaching the test. Anything that calls `ActorReactToHit` earlier in the
frame sets the state and then has it overwritten with a death state. `L11`.

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

### Three bits on `obj+0x34` that can switch the whole thing off

**[proved]**, and they are the first thing `ResolveHit` does. Before it looks
at a table it raises three bits on the actor it is charging, unless
`g_app_state` (`0x009C8E98`) is **6, the in-play state**:

```
00409495  a1988e9c00  MOV EAX, [0x009c8e98]        ; g_app_state
0040949A  83f806      CMP EAX, 0x6
0040949D  7409        JZ  0x004094a8               ; in play -- skip
0040949F  8b4734      MOV EAX, dword ptr [EDI + 0x34]
004094A2  80cc0e      OR  AH, 0xe                  ; |= 0x0E00
004094A5  894734      MOV dword ptr [EDI + 0x34], EAX
```

`80cc0e` occurs exactly once in the whole of `.text`. The three bits have four
readers between them, all in `ResolveHit` and `ActorSwapDamagedPart`:

| Bit | Reader | Effect |
|---|---|---|
| `0x200` | `00409916  f6c502  TEST CH, 0x2` | `ActorSwapDamagedPart` returns before it does anything — no model swap, no `obj+0x78` clear, no `obj+0x1318` zone bit |
| `0x400` | `004095BD  f6c604  TEST DH, 0x4` | the effect table's **sever** code takes the damage-only arm |
| `0x400` | `004096C0  f6c404  TEST AH, 0x4` | the torso's **death wound** on bone 1 is skipped |
| `0x800` | `004096F9  f6c508  TEST CH, 0x8` | `g_hit_result` is written back to 0 after the dispatch has run |

So out of play a shot still lands and still charges damage; nothing comes off,
nothing is reskinned and nothing is reported. That is the **attract demo**,
which is `g_app_state` 5: it plays a stage and shoots at it without ever gibbing
anything. `ResolveHit`'s **second** read of `g_app_state` says the same thing
about the head — `00409741 833d988e9c0006` / `00409748 756c` gates the 1-in-4
headshot burst on being in play.

`0x400` is **not** only an out-of-play bit. It is a real actor flag with three
other writers:

* `ActorInitFlags` (`FUN_00408970`) from the spawn record — **68 shipped
  class-0x30 spawns** carry it (7 in stage 1, 27 in stage 2, 22 in stage 3, 12
  in stage 4, none in 5 or 6). No shipped spawn carries `0x200` or `0x800`;
* `ZombieStateWalkToTarget` (`FUN_0045A890`), `0045A96E 80cc04`;
* `ZombieApplyScriptMode` (`FUN_0045CA30`), mode `-2`;
* `EnemyThrowerInit` (`FUN_00449620`), but only for character type `0x18`
  (`00449810 6683f918 CMP CX,0x18` / `JNZ`).

Nothing clears it on `obj+0x34`: the four `AND ..H, 0xfb` sites in `.text` all
write `obj+0x136C` or are CRT code.

The sever arm carries one more condition beside the bit, and it is one
creature's exception:

```c
if (!(obj[0x34] & 0x400)
    && (char_type != 0x0C || (obj[0x136C] & 0x80) || bone < 9)) { /* sever */ }
else                                                            { /* damage only */ }
```

What is special about character type `0x0C` here is **[open]**.

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

`ResetDamageRank` (`FUN_00460770`, run phase 0) seeds it from
`g_initial_damage_rank[difficulty]` = `{-3, -1, 1, 4, 8}` -- index 2 in a demo
run -- **unclamped**, and turns the rank clock on at 1. Rank 0 is the *most*
generous: for `char_adv02`'s torso the row is `{25, 20, 15, 10, 5, 0, 0, -5,
...}` — +25 at rank 0, −15 at rank 15.

`UpdateDamageRank` (`FUN_004607B0`) runs once a frame from
`RunSceneTasksAndTimers`, after the task walk and before the clock ticks
`[proved]`:

```c
r = rank + (g_players_in_play - players_seen) * 4;  /* a join +4, a drop -4 */
if (clock % 0x708 == 0) {                            /* every 30 s of clock  */
    r += 1;
    if (lone player with lives >= 4 || both with lives >= 7 between them) r += 1;
}
r += g_damage_rank_pending; g_damage_rank_pending = 0;   /* a hit queues -2 */
r = clamp(r, 0, 15);
if (r < rank) clock = 0;                             /* a fall restarts it   */
rank = r; players_seen = g_players_in_play; attackers_seen = g_max_attackers;
```

`players_seen` (`0x009C8E82`) is zeroed by `CommitAppState`, so **the first
frame of a game adds 4 for each player in it**: a one-player game on Normal
plays at rank 5, not 1, and on Very Easy at 1, not 0. `[likely]` that this is
the design rather than an accident: the table's negative entries only make
sense with that +4 coming, and nothing clamps the seed. The clock
(`0x009C8A7C`) counts while `0x009A2C30` is set, so rank rises by 1 every 30
seconds without a hit, 2 while the player is healthy. The earlier reading
here -- "Normal starts at rank 1, so two headshots kill a stage-2 zombie
exactly" -- was computed at rank 1, and is `[open]` again at rank 5.

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
where you shoot it. What the bone then *draws* is not necessarily that slot —
see [§8b](#8b-what-a-bone-actually-draws--zombiedrawbonepart), where nine arms
of class 0x30's own draw hook substitute a cel or add a second model. The slots
are ordinary asset slots and resolve through the slot table like anything else — `char_adv02`'s gore lives in `harold.bin`,
`char_adv00`'s in `char_adv07.bin`, so there really is a shared gore set behind
the per-character ones. `ResolveDamagedPartSphere` falls back to character type
7 (or `0x0B`) when a character has no variant of its own.

### Result codes

`g_hit_result[player]` is what the rest of the frame reads:

| Value | Meaning |
|---|---|
| 0 | nothing happened — also what `obj+0x34` bit `0x800` forces |
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
rolls `rand() % 4` and on a zero runs three routines: `SpawnBoneHitSprite`
(`FUN_00407200`), `SpawnSeveredHead` (`FUN_0040A130`), and
`ActorSwapDamagedPart(rec, 0, 2)` — slot **0**, which is `RemoveBoneSubtree`'s
"gone". One headshot kill in four takes the head off. Gated on app state 6,
character type not 3/0x12/0x18, and `obj+0x3B8 < 2`.

**`FUN_0040A130` is not a blood spray**, which is what this page said until
2026-09-04 and why the port removed the head and drew nothing in its place. It
is `ActorAlloc(SeveredHeadUpdate, 0x1A8)` — an independent object with its own
per-frame routine, seeded at `obj+0x394` and carrying the head's own asset slot
from `obj+0x32C`. The head is *thrown*:

| | |
|---|---|
| gravity | `-0.0204167` (`0xBCA740DA`) a frame, into `+0x50` |
| launch up | `(rand() % 20 + 1) * 0.01 + 0.3`, so 0.31 to 0.50 |
| launch out | `MatrixRotateY(g_camera_block_yaw_bams)` over `(0, 0, -0.2)` (`0x0040A2A6`) — the camera's own −z, always **away from the viewer** |
| spin | yaw `±(rand() % 0x800 + 0x800)`, pitch the same without the sign, BAMS a frame |
| bounce | on `QueryGroundHeightAt`, `y` snaps to the ground and the vertical speed is negated and scaled by **0.25** |
| bounce sound | `0x1116A9` for head slots `0x2015`/`0x1DC1`; else `0x4416A9` on a wet surface (`g_coli_hit_surface` `0x37` or 5) and `0x2616A9` otherwise |
| settle | once `|vy| <= 0.15`: velocities zeroed, `0x78` frames on the clock |
| settled | sinks `0.04` a frame, both spins decay by a tenth, then it frees itself |
| draw | `AssetDrawSlot(+0x1A4)` under translate · `Ry(yaw)` · `Rx(pitch)` · scale `+0x118` |

The scale is 1.0, or 2.0 in Original Mode with the big-head item
(`DAT_009C88A8`) unless the character type is `0xE`, which takes 1.8.

The ground test is against the position the head is **about to reach** —
`ground < y + vy` — so a head falling faster than its own height above the
floor cannot pass through it.

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
`FUN_00456220`, which is **directional**: `g_camera_block_yaw_bams − actor_yaw`
(the camera **block's** yaw, `0x009A60D0`, read at `0x00456248`) against four
±45° arcs (`FUN_0040A040(angle, centre, 0x2000)`). The four are tested **in a
row**, each setting the motion, so a heading exactly on a boundary passes two
and the later one wins, drawing its `rand()` if it has one. The camera block's
yaw is `VecToAngles(eye − target)`, pointing back at the viewer, so an actor
facing the camera sits at `0x8000` and falls back. `[proved]`

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
            /* The kind is the RESULT CODE. Nothing here tests the bone --
               this line read `bone == 2 ? 2 : 1` until 0x00453F6E was
               disassembled; see the voice section below. */
            ActorPlayHitVoice(obj, g_hit_result[player] == 2 ? 2 : 1);
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

**It can refuse before it looks anything up**, and this is the second gate on a
stagger — a flag test rather than a state test:

```
004544cc  85d2            TEST EDX, EDX                             ; the bone
004544ce  0f8482010000    JZ   0x00454656
004544d8  f7463400200010  TEST dword ptr [ESI + 0x34], 0x10002000
004544df  0f8571010000    JNZ  0x00454656                           ; no reaction
```

`0x10000000` is *mid-attack*, raised by `ZombieStateStandAndThrow` and
`ZombieStateTargetMotionScript` for the length of a throw or a maul. `0x2000`
is the **no-hit-reaction latch**: every routine that raises it does so while
something else owns the body, and each clears it on the way out —
`ZombieStateEmerge` (`00458532 OR DH, 0x21` → `0045869F AND DH, 0xdf`),
`ZombieStateDelayedLeap`, `ZombieStateArcScriptedEntrance`,
`ZombieStateMotionCue21`'s exit, `ZombieApplyScriptMode`'s `0x2400`,
`ThrowerStateFallToSurface`, `ThrowerStateRearm`'s exit, and this routine's own
alt arm at `004545F5`, which `ZombieTickAltHitReaction` (`FUN_004547C0`) takes
back down.

`ThrowerOnShot` (`00449A95 f6c420 TEST AH, 0x20`) is the only other reader, and
it skips the stumble, the knockdown and the tumble. **Two readers, both
refusing a reaction** — which is what the bit is, and the reason a zombie
climbing out of the water plays its entrance through and does not stagger.
`[proved]`

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

## 8b. What a bone actually draws — `ZombieDrawBonePart`

A bone's draw record names **one** slot and `AssetDrawSlot` (`FUN_00418560`)
draws **one** model for it. Both of those are true, and together they do not
say what a bone draws, because for class 0x30 `SkeletonEmitNode`
(`FUN_004114C0`) does not call `SkeletonDrawNodeSlot` (`FUN_00411050`) at all.
It calls the **per-bone draw callback** at `model+0x1158`:

```c
if (record[0] == 0 || !(model[0x64] & 1))          goto children;
if (SkeletonNodeDrawSuppressed(node))              goto children;
(*(void (**)(int))(model + 0x1158))(node);
```

`EnemyZombieInit` (`FUN_00452DA0`) writes `ZombieDrawBonePart`
(`FUN_004534A0`) into `obj+0x12EC` — the same word, the actor being
`model - 0x194` — at `0x00452E40`. Class 0x31's is `ThrowerDrawBonePart`,
class 0x25's is `ScriptedHumanoidBoneDrawHook` (`FUN_00485260`) and class
0x20's is `OneHitTargetBoneDrawHook`; the default hook is the one-slot draw.

`ZombieDrawBonePart` switches on `record[0]` — the slot the bone is *currently*
drawing, so a gore swap changes the answer — and sixteen arms of that switch do
something other than draw it. Nine are a **cel** out of a run of models, and
four of those draw the bone's own slot as well. The index is arithmetic:

```
seed = g_blink_frame_counter + obj+0x3C * 10        ; 0x004534AE-0x004534D1
```

`obj+0x3C` is the actor's `g_hit_slots` index, so a crowd runs the same
animation ten frames apart. Each `(base, count)` pair is an immediate inside
the routine, `MOV ECX,count; CDQ; IDIV ECX; ADD EDX,base`:

| drawing | at | draws |
|---|---|---|
| `0x1B3D` | `0x00453542`, `0x0045355B` | `0x1B3E + seed%20` **and** `0x1B52 + seed%30`, and **not itself** |
| `0x1B70`, `0x1B71` | `0x0045355B` | itself **and** `0x1B52 + seed%30` |
| `0x1BCC` | `0x00453583` | `0x1BCD + seed%5` |
| `0x1BD2` | `0x00453598` | `0x1BD3 + seed%5` |
| `0x1C96` | `0x00453798` | itself **and** `0x1CB9 + seed%120` |
| `0x1C97` | `0x004537C0` | `0x1C97 + seed%18` |
| `0x1DCD` | `0x00453927` | `0x1DCE + seed%50` |
| `0x1E00` | `0x00453915` | `0x1E01 + seed%50` |
| `0x1BEB`, `0x1BED` | count at `0x004535F5` | itself, then `0x161B + seed%25` under `T(0,-4.1,0)·S(0.5,0.5,1)` |
| `0x1D99` | — | itself, then `0xB66` at `T(0.343, 0.4530, 1.0333)` |
| `0x1CA9` | `0x004537E3` | `0x1CA9 + n`, `n` a latch in `obj+0x1328` that counts to 14 and stops |
| `0x1F09` | — | a 60-cel ping-pong off the same word, restarted by `obj+0x136C` bit `0x80000` |
| `0x1C71`–`0x1C7B` (not `0x1C73`), `0x1C7D`–`0x1C80` | — | `AssetSlotUVsFromViewNormals(slot)` (`FUN_00418660`: the model's UVs rewritten from its normals through the matrix), then itself |
| `0x1C7C` | `0x00453708` | the twin's fade-out: `obj+0x134C -= 1.0` each draw, and once that is below 0, `obj+0x138C -= obj+0x1388` clamped at 0; then itself |
| `0x1C6C` | `0x00453665` | `znele`'s fade-in, only while `obj+0x1368` bit `0x20` is up: `obj+0x134C -= 1.0`, and once below 0, `obj+0x138C += obj+0x1388`; past 1.0 -- or at once under `obj+0x34` `0x10000000` -- the bit drops, the alpha is pinned at 1.0, `obj+0x136C |= 0x60000000`, `obj+0x34 &= ~0x8100`, `PlaySoundId(0x2225A9)`; then itself |
| anything else | — | itself |

The two fade arms are the whole of what moves a class-0x30 actor's alpha;
`EnemyZombieInitByCharType` (`FUN_00452FD0`) sets them up -- type 9 at 0.25
stepping `1/60`, type 0x12 at 0 stepping `1/30`, both with a hundred-draw wait
and `obj+0x1368` bit `0x20` up -- and type 0x12's arm allocates the type-9
twin, which `ZombieTwinFollowHost` (`FUN_00453290`) keeps on the host's pose.
Ported in `game/class30/draw.ts`, `init_char.ts` and `twin.ts`; see
`docs/PLAYER_PROGRESS.md`, "Character fades".

Two arms are not draws at all and wrap this one: `ZombieDrawBoneSlotOnly`
(`0x00453B30`) is the plain one-slot hook `ZombieAdvanceMotion` installs in
**Boss Mode only**, and `ZombieDrawWithEnlargedHead` (`0x00453B50`) is the
Original Mode big-head item — bone 2 at `MatrixScale(2,2,2)`, or
`(1.8,1.8,1.0)` for character type `0x0E`.

Every arm draws through `ZombieSubmitSlotByLighting` (`FUN_00453AE0`), which
picks `SubmitSlotWithSceneLightArray`, `AssetDrawSlotWithAlpha` or
`AssetDrawSlot` on `obj+0x136C` bit `0x20` and `obj+0x1368` bit `0x20` — so a
cel keeps whatever lighting the spawn asked for. The light array is tested
first: a zombie drawn through it is never faded, whatever `obj+0x1368` says.

**Each trigger slot belongs to exactly one character type**, and every run
resolves to that type's own `pol/` file, which is the check on the reading:

| type | file | triggers |
|---|---|---|
| `0x00` | `char_adv02.bin` | `0x1B3D`, `0x1B70`, `0x1B71` |
| `0x02` | `znchain.bin` | `0x1BCC`, `0x1BD2` |
| `0x03` | `zndina.bin` | `0x1BEB`, `0x1BED` |
| `0x07` | `char_adv00.bin` | `0x1F09` |
| `0x09` | `znjikken1.bin` | `0x1C71`–`0x1C80` |
| `0x0A` | `znjoe.bin` | `0x1C96`, `0x1C97`, `0x1CA9` |
| `0x0C` | `znkager.bin` | `0x1D99` |
| `0x0D` | `znkagex.bin` | `0x1DCD`, `0x1E00` |
| `0x12` | `znele.bin` | `0x1C6C` |

### Why this took so long to find

`char_adv02`'s midriff. Bone 1 escalates to `0x1B70` on the first torso hit and
that model is chest-only — `y 1.35..5.53` against the undamaged `0x1B3D`'s
`y -2.02..5.53` — while the pelvis tops out at `y -0.45`. Type 0 is one of the
21 with a **null** `g_pCharacterExtraParts` descriptor, so the soft waist 68
other types carry gives it nothing, and the band had nothing drawing it.

The search that stalled had ruled out the right things and drawn the wrong
conclusion from them: "`AssetDrawSlot` draws one model per slot, so a bone
cannot draw two" — true premise, false inference, because the hook calls the
draw as many times as it likes. It then went looking for a table, found that
`0x1B6B..0x1B6F` are referenced by **no table in the image**, and stopped
there. That scan was correct. What it proves is that the selection is not
data: the run is `0x1B52..0x1B6F`, **thirty** models, and the five were its
last five.

The models say the same thing. All twenty of `0x1B3E..0x1B51` carry 3 meshes
and 138 vertices with textures `[8, 9, 1]`, and 98 of the 138 vertices differ
between consecutive entries; all thirty of `0x1B52..0x1B6F` carry 2 meshes and
39 vertices with `[8, 9]`, and 19 of the 39 differ. Same topology, same
materials, moving vertices — a flipbook, not a set of variants. And stages
`0x1B72`, `0x1B73` and `0x1B74`, the three the switch does *not* name, are
exactly the three whose own geometry already reaches `y -2.02`.

`tools/verify_bone_cels.py` holds all of it: the byte pattern for every
`(base, count)`, the pelvis split measured from `pol/`, and the presence of
every cel in every bundle that carries a trigger character.

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

### Firing — `g_gunshot_sound_ids`

**[proved]** The gun is heard at the trigger, not at the hit.
`PlayerFireAndReloadUpdate` (`FUN_00414940`) ends a shot with three calls in a
row — `BuildShotRay` (`FUN_00406110`), `PlayerShotEffectSpawn`
(`FUN_00416F70`), `PlaySoundId(g_gunshot_sound_ids[player])` — so a round that
meets nothing is as loud as one that lands.

`g_gunshot_sound_ids` (`0x004EC8BC`) is two dwords, `a9163400 a9163300`:

| Player | Id | File |
|---|---|---|
| 0 | `0x003416A9` | `COMMON\GUN5_22.WAV` |
| 1 | `0x003316A9` | `COMMON\GUN4_22.WAV` |

Both are namespace 0, so they route through the SE list like any other effect.
**A dry trigger is silent**: with `g_player_ammo` at zero the routine never
reaches that line and goes to `PlayerRefillMagazine` (`FUN_00414B30`) instead,
whose `0x3E16A9` `COMMON\RELOAD1_44.WAV` is itself gated on `g_nFiringGate`.

`0x00413EE5` reads `g_GameMode`, decrements it, and dispatches: zero — Original
Mode — goes to `PlayerFireOriginalModeWeapon` (`FUN_00414B90`) instead, which
prefers `g_original_weapon_gunshot_ids` (`0x004EC9A0`) and falls back to the
table above when that entry is 0.

```
0x004EC9A0  u32[8]  g_original_weapon_gunshot_ids
  0 —                       4 DC_SE\MAGNUM_22.WAV
  1 DC_SE\SHOT_GUN_22.wav   5 DC_SE\AIR_GUN_22.wav
  2 DC_SE\MCHN_GUN_22.wav   6 DC_SE\TOY_GUN1_44.wav
  3 DC_SE\GRENADE_22.wav    7 DC_SE\RULE3_22.wav

0x004EC9C0  u32[8]  g_original_weapon_reload_ids
  3 DC_SE\GR_REL_22.wav     5 DC_SE\AIR_G_REL_22.wav   — the other six are 0
```

**Eight entries, not sixteen.** Nothing terminates either table and the index
is a signed `char`; what bounds the first is the second's own reader, and what
bounds the second is the `u16` table at `0x004EC9E0`. Read either one long and
it grows a plausible tail of the next.

Their index is `g_original_weapon_sound_kind` (`0x009A224A`), `+0x0A` of the
per-player Original Mode block — a *different* byte from `g_original_weapon_kind`
at `+0x09`, though the two orders agree (kind 3 draws no muzzle flash and adds
the `0x53` blast, which is the grenade; 4 arms `g_shot_weapon_ring`, the
magnum; 5 halves the tracer, the air gun). `ResetOriginalModeLoadout`
(`FUN_0048A0D0`) writes `+0x0A` to 0 as the second byte of the dword
`0x03000006` it stores at `+0x08`, and no instruction in the image references
`0x009A224A` other than the two reads above. So **[likely]** both weapon tables
are dead in the shipped build and every gunshot in the game is one of the two
arcade ids — `[likely]` and not `[proved]` because a write through a computed
pointer into `+0x0A` need not show as a reference to that address.

### Hitting — `ActorShotFeedback` and `ActorPlayHitVoice`

`ZombieOnShot` (`FUN_00453EB0`) runs the reaction once `ResolveHit` has set
`g_hit_result`:

```c
ActorShotFeedback(player);                      /* FUN_00454050 -- blood or ricochet */
if (still alive)  { hit reaction motion; if (result != 5) voice(obj, 0); }
else              { voice(obj, result == 2 ? 2 : 1); state = 6; }
```

**The kind is the hit-result code and nothing else.** `[proved]`, from the
instruction stream and from a second routine that agrees:

```
00453f46  f7463400000004   TEST dword ptr [ESI + 0x34], 0x4000000   ; Dead?
00453f4d  0f84c7000000     JZ   0x0045401a                         ; ...alive
00453f6e  83f802           CMP  EAX, 0x2       ; g_hit_result, read back
00453f73  6a02             PUSH 0x2            ; dead, result 2 -> kind 2
00453f77  6a01             PUSH 0x1            ; dead, otherwise -> kind 1
00454025  83f805           CMP  EAX, 0x5
0045402a  6a00             PUSH 0x0            ; alive, result != 5 -> kind 0
```

`ThrowerOnShot` (`FUN_004499A0`) is the same two instructions with the same two
constants at `0x00449A76`, `0x00449A7B` and `0x00449A88`. **Neither tests the
bone and neither tests whether the actor died of *this* shot.** This page said
`bone == 2 ? 2 : 1` for a long time, the browser player's shot path was written
from it, and the correction is small only because of the table below: kind 2's
voice pair *is* kind 1's, so what changes is the impact and not the line.

`ActorPlayHitVoice` (`FUN_0040A6F0`) plays **two** sounds — a flesh impact and
a voice:

| Event | Impact, one at random | Voice |
|---|---|---|
| hurt (kind 0) | `BLOOD02`, `BLOOD03`, `BLOOD04`, `BLOOD06`, `BONE01` | `ZOMBIE_010` / `ZOMBIE_012` |
| dead, result != 2 (kind 1) | the same five | `ZOMBIE_019` / `ZOMBIE_018` |
| dead, result == 2 (kind 2) | `BLOOD01` or `BLOOD05` | `ZOMBIE_019` / `ZOMBIE_018` |
| attack cry (kind 3) | *none* | a coin flip **within** the set's own pair |

Kinds 1 and 2 carry the **same voice pair**, which is checked against every
shipped bundle rather than taken on trust: the exporter writes `voice.kill` and
`voice.head` and they come out identical. So the only audible difference
between them is the impact table — five body impacts against two head ones —
and *that* is what a headshot kill sounds like in this game, not a different
cry.

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

### The blood is glued to the bone, and it is twenty-five models

`SpawnBloodSpray` (`FUN_00407310`) allocates an object holding **four** fields
and no position at all: the actor, the bone index, a cel counter and the
severity. `DrawBloodSpray` (`FUN_00407230`) then reads the bone's hit sphere
out of the actor every frame it draws:

```c
z     = rec[0x284] + rec[0x27C];      /* the sphere's radius plus its centre z */
scale = (z < -20) ? 1.0 : (-z * 0.0375 + 0.25);
scale *= (g_wCaptionMode == 1) ? 0.15 : 0.3;
scale *= severity;                              /* the 0.5 / 0.75 / 1.0 above */
MatrixLoadIdentity();
MatrixTranslate(rec[0x274], rec[0x278], z);
AssetDrawSlot(cel + 0x3A);
```

Four things follow, and three of them were wrong in this document until
2026-09-06.

* **It is twenty-five different models, not one texture animated.** Slots
  `0x3A..0x52` are `pol/common.bin` entries 0 to 24. There is no texture
  animation anywhere in this engine; every flipbook in it is a run of models.
  Their **colour** is not in the models: they carry no vertex colours and a
  white base, so it is entirely the texture's, and the game ships two banks
  for it. See [`texbank.md`](texbank.md) — the default is green and
  `tex/scr_blood_red.bin` is what the **Blood Color** option loads over it.
* **The position is the hit bone's sphere, not the point the ray met the
  model.** `ShotTestBoneSphere` (`FUN_004047D0`) proves the fields: it tests
  `obj + bone * 0x90 + 0x274/+0x278/+0x27C` as a centre against the radius at
  `+0x284`. Nothing in the engine ever computes a ray-versus-surface point,
  for an actor or for a prop. **A shot that clips the edge of an arm bleeds
  from the middle of the arm.**
* **`+0x284` is added to `z`, which is the sphere's near face.** Camera space
  has `-z` in front, so adding the radius pulls the sprite toward the viewer
  onto the surface of the limb rather than leaving it inside. The **centre**,
  without the radius, is what `MarkActorShot` (`FUN_00404DB0`) copies into the
  candidate record and what the result-5 ricochet sprite is placed at.
* **It tracks.** The bone is re-read on each of the twenty-five frames, so the
  spray follows a running zombie's shoulder.

`SpawnBoneHitSprite` (`FUN_00407200`) and `BoneHitSpriteDrawAndTick`
(`FUN_00407120`) are a second copy of the same pair with the severity multiply
left out. `ResolveHit` fires one beside the severed head, and
`OneHitTargetUpdate` fires one per hit bone.

### What leaves the gun — `PlayerShotEffectSpawn`

Every trigger pull, hit or miss, fills one slot of **three** six-deep rings per
player. `PlayerFireAndReloadUpdate` (`FUN_00414940`) calls
`PlayerShotEffectSpawn` (`FUN_00416F70`) between `BuildShotRay` and the gunshot
sound; `PlayerShotEffectsThink` (`FUN_00416B00`) draws and steps all eighteen
records every frame.

| Ring | Address | Space | Frames | Slots |
|---|---|---|---|---|
| muzzle flash | `g_shot_flash_ring` 0x009A2960 | camera | 9 | `g_muzzle_flash_slots[player] + frame` at scale 0.1, then `g_muzzle_smoke_slots[player] + frame` at **0.05** — see below |
| tracer | `g_shot_tracer_ring` 0x009A2460 | world | 60 | `g_muzzle_smoke_slots[player] + 2`, one billboarded quad; Original Mode weapon kind 5: `0x109D` at the record plus `op_` `0x194` at `frame % 24`, no spin — see below |
| Original Mode | `g_shot_weapon_ring` 0x009A2700 | camera | 24 | `0xA6F + frame` at scale 0.05, weapon kind 4 only |

`g_muzzle_flash_slots` (0x00579F78) is `{0x175, 0x17F}` and
`g_muzzle_smoke_slots` (0x00579F7C) is `{0xB76, 0xB84}`, both `pol/common.bin`.

**The flash's two scales compound, and reading them as absolute is a
white-out.** `MatrixScale` (`FUN_004A9CC0`) multiplies the top of the matrix
stack in place — twelve `x = k * x` and no assignment — and the routine scales,
draws, scales again and draws again inside **one** `MatrixStackPush`. So the
second draw is at `0.1 * 0.5`, or `0.1 * 0.75` for Original Mode's weapon kind
4. Slot `0xB76` is a quad 3.84 units across; at an absolute 0.5, one unit from
the eye, it covers two and a half screen heights.

The muzzle point is the crosshair at camera-space `z = -1`:
`(g_crosshair_x / g_projection_distance_px, g_crosshair_y / …, -1.0)`, with the
flash's angles from `FUN_004016B0` and then `yaw += 0x8000` and the pitch
negated. The tracer takes that point through the camera matrix into the world
and flies `normalize(point - eye) * 20.0` a frame, spinning `0x1000` BAMS.

**The tracer dies on its second frame when the shot hit something.**
`ProcessPlayerShots` (`FUN_00404570`) writes `g_shot_hit_something`
(0x009C9010) as "the candidate list is not empty", and that is its only reader.
So a round that hit is a stub of streak leaving the barrel and a round that
missed flies for a full second.

**Both tracer arms are camera-facing** `[proved]`. Each one
`MatrixTranslate`s onto the record and then calls `MatrixClearRotation`
(`FUN_004A9F70`), which writes the top 3x3 to the identity -- the view's
rotation with it -- so the roll, and the kind-5 arm's `RotZ RotY RotX`, turn in
the camera's axes. The kind-5 arm (`CMP EAX, 0x5` at `0x00416CBE`) also
`MatrixTranslate`s by `CamEvalObjectPath6(0x194, frame % 0x18)` first -- two
translations, summed (L5) -- and draws `0x109D` (`etc_1.bin` entry 41), the
only draw of that slot in the program. `op_` `0x194` is `op_org` 0, so only an
Original Mode stage has the path. The exporter once placed that arm as the rig
`obj_416b00` at the path's own pose, which stood in front of Goldman's desk in
stage 2's opening; it is not a placeable rig.

Two smaller findings from the same routine:

* the ring cursor `g_shot_effect_cursor` (0x009CA09C) advances **between** the
  tracer and the Original Mode record, so that record lands in the next slot —
  the one the previous shot used;
* `g_original_weapon_kind` (0x009A2249) is `+0x09` of the per-player Original
  Mode block at `g_original_item_slots`, and `+0x08` beside it is the magazine
  size `PlayerRefillMagazine` (`FUN_00414B30`) refills to. `ResetOriginalModeLoadout`
  (`FUN_0048A0D0`) seeds them with 0 and 6, and every arm behind the kind is
  gated on `g_GameMode == 1`.

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

**[proved]** How it claims, from `0x00455DE0` (and `ThrowerTryClaimAttackSlot`,
`0x0044CA40`, instruction for instruction):

* its **first** store is `obj+0x121 = 0xFF`, before any test — a refused claim
  always leaves the actor holding no index, whatever it held;
* `g_attack_committed` set refuses at once;
* it offers **one** player's permit, not the first free one, and nothing ever
  falls back to the other player:

  | `g_max_attackers` | condition | offered | draws |
  |---|---|---|---|
  | 1 | — | `g_active_player`'s, if free (0 or 1; `2` offers nothing) | none |
  | 2 | `g_players_in_play == 1` (s16) | `rand() % 2`'s, if free | one `rand()` |
  | 2 | `g_enemies_present == 1` (s16) | `rand() % 2`'s; if taken, `~pick` — -1 or -2 (`0x00455E69`) | one `rand()` |
  | 2 | otherwise | player 0's if `ActorScreenHalfSign` (`0x00409C90`) is -1, player 1's if 1, if free | none |
  | other | — | nothing | none |

  `ActorScreenHalfSign` is `P * obj+0x70 / obj+0x78` against 0.0: below (or
  unordered) is 1, else -1 — the right of the frame for player 2 and the left
  for player 1 `[likely]`, the halves following from the `-Z`-in-front view;
* `IsPlayerAttackable((s8)obj+0x121)` then voids the pick (`0x00455ED5`), and
  only `0xFF` fails (`0x00455EF0`): a `-2` it passes — attract mode, where it
  answers true for any index — claims "permit -2", a 1 written to
  `0x009A2B98`;
* the grant raises the latch bit and `g_attack_committed` when
  `ActorIsOnScreen` says no, and writes `g_attack_permits[obj+0x121] = 1`;
* the permit table holds **0 or 1** — whether a permit is out, not who has it
  (the port stores the holder's id and `-1` for free, for its debug panel —
  and every reader in the port, the scripted attackers' own picks included,
  has to test against `-1`, not against the engine's literals);
* it does **not** write `obj+0x34`. Where a claimant lowers `NoCameraTrack`
  (`0x10000`) is its own business, and only three do: `ZombieStateApproach`
  after a grant (`0x00457A4E`), `ZombieStateWaitForCameraFrame` before its
  claim and only for its hidden kind (`0x004576E5`), and
  `ZombieStateHoldForCameraCue` at its cue (`0x0045C00C`). The hub, both
  stand-and-throw routines, the scripted grab and state 28 have no clear, and
  class 0x31 has none anywhere — it raises the bit only on its way to a corpse.

The nine class-0x30 call sites are `0x0045583B` (hub), `0x004576FB` (state
19), `0x00457A39` (state 22), `0x00457C18` (state 23), `0x004587C4` (state 28,
`0x004586E0`, unported), `0x00458EB0`/`0x00458EC3` (`ZombieShouldStandAndThrow`
— type 1 claims *before* its hand test, 0x13/0x14 after) and
`0x0045920C`/`0x004592EE` (state 33). Class 0x31's twelve are listed in
`functions.tsv`'s `ThrowerTryClaimAttackSlot` row; five of them are
`ThrowerTryEnterState`'s, and the one for state 0x20 claims before its surface
test and keeps the permit on a refusal.

Two things free a permit other than its holder. `ZombieStateHoldForCameraCue`
(`0x0045BFD0`) zeroes `g_attack_permits[obj+0x121]` when its delegate reaches
`Strike` — the table entry only, leaving `obj+0x121` and the off-screen latch —
and **every `finish_sequence`** (`EvtActionFinishSequence21`, `0x00403710`)
zeroes both. That second one is load-bearing: the hold tests its camera cue
*before* its `Strike` bounce, so a captor already at the ring claims on the cue
frame and graduates into `ZombieStateHoldAtRange` still owning the permit, and
its own permit refuses its every claim after that until the script's next
`finish_sequence` — queued right after the cue for all three held spawns in the
game — lets it go. The hub itself (`0x00455748`) gives `g_attack_committed` back
when the actor holding it is back at the ring and still off screen.

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
TurnActorAwayFromPoint(obj, strike_anchor_x, strike_anchor_z,
                       (obj[0x136C] & 0x400000) ? 0x40 : -0x40);
                    /* -0x40 turns the long way: away from the anchor */
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

### The crowd keeps itself apart — `ZombiePushOutOfWorldAndActors`, `FUN_00454900`

`EnemyZombieInit` puts it at `obj+0x12F0` (`0x00452E4A`, for every character
type), and nothing in `EnemyZombieUpdate` calls it by name: it is `model+0x115C`
of the skinned model at `obj+0x194`, which `SkeletonApplyRootMotion` calls at
`0x00410E93` inside `ZombieAdvanceMotion`'s draw — after the state, the
velocity and the frame's root motion, before any node, and before
`ActorRegisterCameraPoint` files the sphere it leaves. Once per update, every
state; the states that stop a zombie being pushed drop its bits instead.
`[proved]`

```
obj+0x136C &= ~0x800000;  sphere()
if (obj+0x136C & 0x40000000) {                      ; collide with actors
    if (obj+0x138) {                                ; a push someone recorded
        f = obj+0x13C * 0.1;  if (pusher+0x34 & 0x18000000) f *= 1.8
        obj+0x40..0x48 += f * obj+0x140..0x148;  sphere();  obj+0x138 = 0
    }
    if (ColiTestSphereAgainstActors(obj+0x12C, obj+0x128)) {
        f = g_coli_hit_depth * 0.1;  if (obj+0x34 & 0x18000000) f *= 1.8
        obj+0x40 += nx * f;  obj+0x48 += nz * f     ; x and z only
        obj+0x136C |= 0x800000;  sphere()
    }
}
if (obj+0x136C & 0x20000000 && ColiTestSphereAgainstFullSet(...)) {
    obj+0x40..0x48 += n * depth;  obj+0x136C |= 0x800000;  sphere()
}
if (!(obj+0x34 & 0x20000)) ActorSnapToGroundHeight(obj)
sphere()
if (--obj+0x1338 < 0 && obj+0x136C & 0x800000) { obj+0x1338 = 0x3C; obj+0x136C ^= 0x400000 }
```

`0.1` is `[0x004C4CC8]` and `1.8` is `[0x0055DD48]`. **The 1.8x bits are
`0x10000000`, the strike's commit, and `0x8000000`, the spawn's sprint bit** —
not the airborne bit `0x20000`, which is only the ground snap's gate. So a
sprinter shoves and is shoved harder all its life, and a walker only while it
swings. The normal is not renormalised for the x/z push: a neighbour above or
below pushes less.

**`ColiTestSphereAgainstActors` (`FUN_00405B10`) tests last frame's
registrations.** It walks `g_coli_dynamic_list` (`0x005A3098`), which
`ColiPublishDynamicList` (`FUN_00405360`) copies out of `g_shot_test_list` at
the end of `ProcessPlayerShots` — a task that runs before every actor — and
`g_coli_dynamic_count` is the copied count (`0x00404626`). So the candidates are
the objects that called `RegisterForShotTest` on the previous frame (in front
of the eye or a mesh, `0x8000` clear), each measured at the `obj+0x12C` its
class had left when it registered, and refused on its **live** `obj+0x34` for
`0x80008000` or `0x10`. A body behind the camera pushes nobody.

For each candidate inside `r + obj+0x128` (a zero `obj+0x128` is filled from
`obj+0x124` and stored back), the routine takes two surface points —
`VecToAngles` and a translate/rotate of `(0, 0, radius)`, once from each centre
toward the other — and files a candidate with the near point as the hit,
`far point - near point` as the normal, `|centre - far point|` and
`|near point - far point|`, keyed on `__ftol(distance * 10)`. The stable radix
sort picks the nearest, and then:

```
depth = (|near - far| <= R) ? r - |centre - far| : |centre - far| + r
if (nx + ny + nz == 0.0) return 0                   ; a sum, not a length
normalise;  other+0x138 = me;  other+0x13C = depth;  other+0x140.. = -n
```

which is `r + R - d` when the radii are equal and something else when they are
not: a thrower's two-thirds sphere against a zombie's gets less than the
overlap whenever the centres are between the two radii apart, and a small
sphere well inside a big one is pulled further in.
`ThrowerPushOutOfWorld` reads `g_coli_hit_object` after the same test: unless
it is `zslman`, a found object carrying `obj+0x34` `0x200000` knocks an
off-ground thrower into state 2 rather than pushing it. `[proved]`

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
the default arm would run: it plays **the actor pointer itself** as a motion id
(`MOV EAX, dword ptr [ESP + 0xc]` at 0x0044FC64, which after `PUSH ESI` /
`PUSH EDI` is the routine's one and only argument — Ghidra renders it
`iVar3 = param_1`) and **does not write `obj+0x1350` at all**, so the compare
would then read a landing surface as a frame number. Whether the engine can set
two at once is undetermined. An earlier note here called it "the routine's
second argument"; `ThrowerStateThrow` has no second argument.

**The clip does not start at frame zero.** `ActorSetMotionBlended`
(`FUN_004119A0`) is `param_1[2] = param_3; param_1[6] = param_3 / 2` — so its
third argument is written straight into the play **cursor** `obj+0x19C` and its
half into `obj+0x1AC`, in cursor ticks, not authored frames. This state passes
`0x1A` for every character type but 0x18 and `0` for 0x18 — `PUSH 0x4 /
PUSH 0x1a` (`6a04 6a1a`) at 0x0044FB87 against `PUSH 0x4 / PUSH 0x0`
(`6a04 6a00`) at 0x0044FC68, both falling into the one `CALL 0x004119a0` at
0x0044FC74, over a fade of 4. So a `zsass` throw is **22 cursor ticks of
wind-up**, not 48. `[proved]`

**And the three sub-states fall through into each other.** The dispatch at the
top is `SUB EAX, 0 / JZ` then `DEC EAX / JZ` twice (0x0044FB16..0x0044FB23),
and each arm ends by *incrementing* `obj+0x1312` and running on into the next —
so a throw can start and release on the same frame, and a sub-state above 2
falls out of the routine doing nothing at all.

`SpawnThrownWeapon` (`FUN_004504E0`) does five things worth stating:

* spawns the projectile at the **throwing bone's world position**;
* leaves that hand bare — `0x1FA2` → `0x1F9F` for the right, `0x1F9E` →
  `0x1F9B` for the left — and clears its hit sphere;
* marks that arm's **destroyed-zone bit**, which is what the cancel mask reads,
  so an armed hand and a thrown one are the same state as a shot-off one;
* gives the weapon the thrower's **attack permit**, so the projectile damages
  the player the thrower had claimed;
* picks the flying model: `0x1F91` right, `0x1F90` left.

The permit hand-off is literal, and it is the reason a throw looks like it
holds a slot for ever: `MOV AL, [EDI+0x121]` (`8a8721010000`, 0x004506BB),
`MOV [ESI+0x121], AL` (`888621010000`, 0x004506C4), then
`MOV [EDI+0x121], BL` (`889f21010000`, 0x004506D5) with `BL` zeroed at
0x0045050A — so the **thrower is left holding 0, not −1** — and the off-screen
commit latch `obj+0x136C` bit `0x8000` moves across with it. The slot goes back
to the pool only at the very end of the weapon's life, in
`ThrownWeaponFlyToTarget`'s sub-4 arm (`CALL 0x0044cfb0` — `e88ccfffff` —
at 0x0045001F), in the same breath as the despawn. `[proved]`

#### The exit, and what it does not do

```
0044fcbb  MOV   EDX, dword ptr [ESI + 0x1b4]           8b96b4010000
0044fcc1  MOV   ECX, dword ptr [ESI + 0x19c]           8b8e9c010000
0044fcc7  MOVSX EAX, word ptr [EDX*0x2 + 0x4e07d0]     0fbf0455d0074e00
0044fccf  DEC   EAX                                    48
0044fcd0  CMP   ECX, EAX                               3bc8
0044fcd2  JL    0x0044fcf3                             7c1f
0044fcd4  PUSH  0x2916a9                               68a9162900
0044fcd9  CALL  0x0041cfd0            PlaySoundId      e8f2d2fcff
0044fce1  MOV   word ptr [ESI + 0x1310], 0x7           66c786101300000700
0044fcea  MOV   word ptr [ESI + 0x1312], 0x0           66c786121300000000
```

On the throw clip's last frame — `g_motion_play_length` of the base track's own
motion against the base track's own cursor — it plays `0x2916A9` and **hands
back to the hub**. That is the whole of the state's ending: it puts no weapon
back and it releases no permit. `ThrowerReleaseAttackPermit` has exactly eight
call sites in the program and `ThrowerStateThrow` is not one of them.

The re-arm is state 7's job, not the throw's, and it is offered **before** the
router is asked: `ThrowerStateStandAndDecide` calls
`ThrowerTryEnterState(0x1D)` — `0x1E` for character type 0x18 — on every one of
its frames (`PUSH 0x1d / CALL 0x0044afb0`, `6a1d e834fcffff`, at 0x0044B375;
`PUSH 0x1e`, `6a1e e819fcffff`, at 0x0044B390) and only reaches
`ThrowerPickNextState` at 0x0044B3AA when that is refused. So the loop is
**hub → throw → hub → re-arm → hub**, each leg a state that owns one thing.
`[proved]`

`ThrowerStateRearm` (state 29) is what puts the weapon back and clears the bit;
`ThrowerStateRestoreBothHands` (state 30) is character type 0x18's version.

### The flight — `ThrownWeaponFlyToTarget`

```c
ttl      = |target - pos| * 0.8333333;      /* = distance / 1.2 */
velocity = (target - pos) / ttl;            /* constant 1.2 units per frame */
...each frame:
yaw += hand == 5 ? spin : -spin;  pos += velocity;
if (--ttl <= 0) PlayerTakeDamage(permit, 1, 6);
```

A **straight line at a constant speed, and a timed hit** — there is no
collision test at all, exactly like the melee strike landing on a frame number.
`AimThrownWeapon` (`FUN_004503D0`) puts the target 4 units down the camera's
own -Z (offset sideways by 0.6 per player in a two-permit game), through the
camera block's `+0x40` matrix, so the weapon is aimed at where you are, not
where you will be. It is the **weapon's** routine — it reads the permit the
weapon inherited — and the stuck arms call it every frame.

**The spin is `0x2400` BAMS a frame**, fifty degrees: `MOV dword ptr
[ESI+0x135C], 0x2400` (`c7865c13000000240000`) at `0x0045072C`, the last thing
`SpawnThrownWeapon` writes, and it goes into `obj+0x68` — the Y term of the
draw `Rz(obj+0x6C) · Ry(obj+0x68) · Rx(obj+0x1364 + obj+0x64)` — negated
unless the throwing hand is bone 5. `obj+0x64` and `obj+0x6C` are zero through
the flight (`ActorClearGameFields` cleared them), so a knife starts square to
the world, leans by its type's `obj+0x1364` (`0x600` for `zsass`, 0 for
`zslman`) and spins flat about the vertical. `[proved]` The write is past a
`MatrixStackPop` the decompiler has marked no-return (`L35`); an earlier
reading of the pseudocode alone concluded that nothing writes the rate.

On arrival it faces the **eye** — `VecToAngles(g_camera_eye - pos)` into the
yaw, pitch zeroed — with a random pitch kick of `±(rand()&2)*0x100` and a yaw
kick of `(rand()&5)*0x100`, negative for bone 5 (`zslman`'s blades instead
take a half turn for the other player's blade in a two-permit game and the yaw
kick alone). It sticks to the screen for 30 frames, re-aimed every frame, and
blinks for 60 — `obj+0x1F8` bit 0 on the counter's parity — then gives the
permit back and despawns.

### Shooting one down

Every frame it draws, `ThrownWeaponUpdate` (`FUN_00450780`) writes the
view-space position to `obj+0x70..0x78` and calls `RegisterForShotTest`
(`0x00450864`..`0x004508AA`, past the draw's `MatrixStackPop`). With
`obj+0x34 = 0x80000001` and `obj+0x124 = 2.0`, `ShotTestSphere` takes it
**whole**, as a two-unit sphere. The next frame's `ThrownWeaponUpdate` finds
`obj+0x34` bit 8 without `0x4000000`, bumps `g_player_hit_count` — always
player 0's, since it reads bit `0x10` for the player and `MarkActorShot` writes
`0x2` or `0x4` — and enters state 1, `ThrownWeaponDeflected` (`FUN_00450050`):

```c
SpawnSpriteEffect(pos, zsass's 0x1F90/0x1F91 ? 3 : 0x51, 1, -1);
obj+0x34 |= 0x4008000;  ThrowerReleaseAttackPermit(obj);    /* at once */
target = view(obj+0x70) + ((rand()%10+1)*10*(±1), (rand()%10+1)*10*(±1), 0)
spin   = ftol(spin * 1.3 * (±1));  KNIFE2_OFF;  BULLET_MET3;
wait 5 frames; then each frame: pos += normalize(target - pos) * 1.2;
         obj+0x64 -= spin (bone 5) or += spin;   /* now about X */
gone after 180 frames, or once within 1.2 of the target on every axis
```

It scores nothing. The landing raises `0x400C000` — `0x4000000` and `0x8000`
among it — so a weapon that has landed is out of the shot test and cannot be
deflected. `[proved]`

### Class 0x30's weapon

`ZombieThrowHandWeapon` (`FUN_0045A240`) allocates the same `0x13F4` object
with its own task, `ZombieThrownWeaponUpdate` (`FUN_0045A4F0`), and its own
four-state table at `0x00593170`: 0 a bare `RET`, 1 the straight flight (the
axe `0x249`), 2 the arc (everything else — `znassb`'s two blades), 3 shot
down. It hands the permit over the same way (thrower left on 0; no latch moves
here), latches `g_max_attackers` into `obj+0x1360`, points the weapon at its
target with `VecToAngles` and rolls it `0x800`.

| state | spin (`obj+0x135C`) | into | hit kind | speed |
|---|---|---|---|---|
| 1, straight | `0xB00` | `obj+0x64`, **X** | 4 | `obj+0x1370`: 1.5 in body condition 7, else 1.0 |
| 2, arc | `0x1600` | `obj+0x68`, **Y** | 6 | a literal 1.0 |

Neither is signed by the hand, and the draw has **no** `obj+0x1364` term.
`ZombieThrownWeaponBeginArc` (`FUN_00459B70`) takes the heading from the
**thrower** to the target: within `0x2000` of 0 or `0x8000` (down Z) the lob
bends along X with `t = |(dy, dz)| / speed`, otherwise along Z with
`t = |(dx, dy)| / speed`; the acceleration is `+0.009` for bone 5 and `-0.009`
otherwise. The aim (`ZombieThrownWeaponAimAtCamera`, `FUN_0045A070`) is
`(side, axe ? -1.5 : 0, -4)` in camera space. Landing faces back along the
flight (`VecToAngles(target - pos)` plus `0x8000`) with the pitch kick; shot
down (`FUN_00459D20`) is class 0x31's deflect with sprite `0x52`, `KNIFE1_OFF`,
the throw's own `obj+0x1370` for both the speed away and the arrival box, and
no hand test on the spin.

`znassb` throws **both** blades on one release frame: `ZombieStateStandAndThrow`
calls `ZombieThrowHandWeapon` a second time for character type 1 after a
`TryClaimAttackSlot` it does not look at (`0x004592E4`..`0x00459301`).

## 11. What the player implements

Exact: the hit spheres, hit points through `ActorInitHitPoints`, the per-bone
damage escalation with the `DamageRankModifier` applied, the control codes,
**the sever and its cascade**, the final-stage latch, the withheld torso stage,
the headshot burst, the nearest-first resolution, the score including the
result-5 rule, **the stumble** — the right clip per body region, cross-faded
over the walk on a second track, faded for the upper body and hard-set for the
legs, and skipped entirely for the hits that do not interrupt — the directional
death, the gore swap, and every sound in §9.

The live-enemy waits (evt `0x43` / `0x44`) are **real**: the script holds
until the enemies are dead, which is the game's own condition. It used to
depend on a Shoot toggle, which defaulted to off — and off, the counts read
null, the gates were paced by a stopwatch, and the player walked through every
fight in the game. `g_enemies_present` is approximated by the alive count,
because the player never despawns a corpse.

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
* the **alternate reactions** at `+0x10` of each `g_class30_motion_rows`
  row, reached only when `obj+0x136C & 0x100`, which is `[open]`. The table
  itself is the general motion row -- sixteen readers, fourteen of them
  states picking a walk, run, idle or back-away clip;
* the **fade back out** of a reaction. `MotionCrossFadeTo` states the fade *in*;
  the player fades out over the same length, which is `[likely]`, not proved;

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
sub 1:  if (distance > atk.distance && !cooldown_latch) {
            if (obj+0x1B4 != atk.lunge)            // the track's own motion
                SetCurrentActorMotionBlended(obj+0x194, atk.lunge, 0, 10);
            return;                                // keep closing
        }
        ActorSetMotionBlended(obj+0x194, atk.strike, 0, 5);
        ActorPlayHitVoice(obj, 3); sub = 2;
sub 2:  if (play_position == atk.hit_frame) ActorStrikeConnect(obj);
        if (play_position >= length - 1) -> state 4, re-approach
```

**Both motion calls fade, and the fade holds the cursor.** `ActorSetMotionBlended`
(`FUN_004119A0`) writes `obj+0x19C` = the start frame and raises
`track+0x37` bit 0, and `SkeletonAdvancePlayCursor` (`FUN_004111A0`) does not
recompute the cursor from the clock while that bit is up. It lets go once
`clock - track+0x28` reaches `fade + 2`. `EnemyZombieUpdate` runs the
state at `0x00453434` and `ZombieAdvanceMotion` at `0x00453457`. That routine
draws first (`SkeletonDrawWalk` calls the sampler at `0x004110F3`) and steps the
clock only after. So the swing's frame 0 is drawn `fade + 1` = 6 times, sub 2
reads it on `fade + 2` = 7 consecutive frames, and the hit lands
`6 + hit_frame` frames after the swing starts, not `hit_frame`. The
lunge's clip is held 11 draws the same way. `[proved]`

**The lunge's test is against the track, not against a lunge the state set.**
`00455b31 CMP [ESI+0x1b4], EAX` / `00455b37 JZ` skips the call whenever the
track is already playing that clip. In 155 of the 311 shipped entries the lunge
*is* the actor's run clip (`row[2]` or `row[3]`). `ZombieStateHoldAtRange`
tries its claim before it sets its idle: `TryClaimAttackSlot` at `0x0045583B`
hands to state 3 and returns at `0x0045587B`, and the idle's
`ActorSetMotionBlended` at `0x004558CC` is only on the path where the claim
failed. So an actor whose claim succeeds on its first frame at the ring is
still on its run, and keeps playing it as the lunge, with no restart and no
fade. `[proved]`

The entry is 0x10 bytes:

| Offset | Field |
|---|---|
| `+0x00` | s16 strike motion |
| `+0x02` | s16 lunge motion, played while still beyond *distance* |
| `+0x04` | f32 distance inside which the strike starts |
| `+0x08` | s16 the frame of the clip on which the hit lands |
| `+0x0A` | s16 the motion the **player** plays when hit |
| `+0x0C` | u16 cancel mask |

Both operators in sub 2 are load-bearing, and together they make some attacks
**miss by construction**. The strike is an exact equality —
`00455bdf CMP ECX,EAX` / `00455be1 JNZ` over the `CALL 0x00456490` — and the
exit is `00455c02 MOVSX EDX,[ECX*2 + 0x4e07d0]` / `DEC` / `CMP EAX,EDX` / `JL`,
so the cursor only ever takes the values `0 .. g_motion_play_length[clip] - 1`
before the state hands over. `+0x08` is **not** bounded by the clip it names,
and three shipped entries sit outside it: character types `0x07`, `0x0B` and
`0x0C` share a body-condition-4 entry 2 at `0x00566E70`,
`{997, 1051, 26.0f, 40, 9, 1}`, against `g_motion_play_length[997]` = 20. Those
are the crawlers, their condition-4 pick row is ten 2s then ten 3s per zone
combo, and so **an undamaged crawler swings and misses every time** while one
with its head shot off draws entry 3 (clip 1018, hit frame 3) and connects.
Nothing is aborted and nothing is retried: the strike simply never fires, the
clip plays out and the actor retreats. `[proved]`

The exporter therefore keeps such an entry rather than rejecting it —
`hod2lib.combat.attack_hit_lands` carries the reading, and `verify_combat.py`
asserts that exact set of three instead of imposing the bound, because a row
misread out of the *next* character's attacks looks the same from the outside.
The bound was right for as long as the reader scanned a fixed number of
entries; it has been indexed by the pick table for longer than that.

### Shooting a limb off changes the attack, twice over

The **cancel mask** names destroyed zones — 1 head, 2 right arm, 4 left arm —
and `ActorStrikeConnect` whiffs when every zone it names is gone:

```c
if ((destroyed_zones & 7 & atk.cancel_mask) != atk.cancel_mask)
    PlayerTakeDamage(permit_holder, show, atk.overlay_kind);
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

**Facing.** `TurnActorTowardCamera` turns the actor's yaw toward
`VecToAngles(obj.x - p.x, 0, obj.z - p.z)` — the angle of **actor minus
camera**. Written the other way round it is a clean 180 degrees, and because
the turn is gradual the result is a zombie rotating slowly *away* from you
rather than snapping backwards. Easy to write, hard to spot. (The port also
had the turn itself wrong for a long time -- an ease of a fifteenth of the
remaining angle a frame, where `TurnAngleToward` (`FUN_00409E00`) is a flat
`0x1A0`/`0x410` a frame -- and a negative rate faked with a 0x8000 flip of the
target. See `web/src/game/actor_turn.ts`.)

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
if (player == -1) return;
if (CheckPlayerCanBeHit(player) != 0            /* -1 bad index; -3 in app 6 at a state not 1, 4 or 5 */
    || invuln_frames[player] || app_state == 5) return;
if (!g_player_no_damage[player]) {             /* 0x009C9FD8 + player*0x7C */
    g_player_lives[player] -= 1;
    g_damage_rank_pending -= 2;                /* UpdateDamageRank consumes this */
    ScoreAddForPlayer(player, -100);           /* floored at 0 */
}
if (latch) { g_player_was_hit[player] = 1; g_player_damage_overlay_kind[player] = kind; }
invuln_frames[player] = 0x5A;                  /* 90 frames, 1.5 s, one dword per player */
if (major_entered != 2 && major != 2 && g_player_lives[player] < 1)
    g_player_lives[player] = 1;                /* off the path camera the last life cannot go */
```

`[proved]`, `FUN_00415300`. **One strike costs exactly one life.** There is no
variable damage against the player -- the attack entry's `+0x0A` is a
not an amount. It is the **damage overlay kind** (`overlay_kind` in the
bundle, `g_player_damage_overlay_kind` in the exe's names -- both were called
the "player motion" until format 10, and nothing reads it as a motion): its
one reader is the damage overlay, below. The `latch` argument is 1 at every call site but the
`obj+0x34 & 0x2000000` arms of `ActorStrikeConnect` and `ThrowerStrikeConnect`,
which pass 0. `g_damage_rank_pending -= 2` closes a loop from section 4: being
hit lowers the adaptive rank, which raises the per-bone damage modifier, so the
game gets easier the worse you do. **The damage sprite is not spawned here**:
the per-player `+0x7C` hook turns `g_player_was_hit` and the kind into it
(`0x00415180` -> `FUN_00417440`); see `game/player_shell.ts`.

**On the path camera the last life goes.** `PlayerUpdateInPlay`
(`FUN_00413E90`) then takes the player out of play on its next turn --
`g_players_in_play -= 1`, state 4 -- and the player shell runs the continue:

| state | handler | what it does |
|---:|---|---|
| 4 | `PlayerStateArmContinue` then `PlayerContinueCountdown` | `0x9FFF`, -`0x2D` a frame, the digit is `>> 12` (about 910 frames); the trigger knocks it to the bottom of its digit; START with a credit is state 1 |
| 1 | `PlayerStateEnterContinue` | `ScoreAddForPlayer(p, 1)`, `g_damage_rank -= 1`, `PlayerEnterPlay(1)`: `g_start_lives`, 180 frames' grace |
| 6 | `PlayerStateArmGameOver`, `PlayerGameOverWait` | the countdown ran out: `g_max_attackers -= 1`, 120 frames, then 9 |

With every player out (states 4 and 9 carry flag 1 at `+0x04` of
`g_player_state_handlers`) `RunPhaseInPlay` hands the run to its own CONTINUE?
screen, phases 3 and 4 (`RunPhaseContinueArm`, `RunPhaseContinueCountdown`) --
or, with no credit, phase 11 -- and if nobody takes one the game-over screen,
app state 7. The scene keeps running under the continue screen. Credits: the
title seeds `ModeStartCounterValue(mode)` -- six in Arcade at the factory
options, six in Original, one in Training and Boss -- and the start takes one.
Lives: `g_start_lives = g_start_lives_by_option[0x009C9F21]`, **three** at the
factory setting.

### What being hit looks like — the damage overlay

`[proved]` The third argument is the **overlay kind**, 0..10. Nothing in
`PlayerTakeDamage` draws: the player's own update, `PlayerUpdateInPlay`
(`0x00413E90`), calls `PlayerRunCameraHook` (`FUN_00415100`), which calls
whatever the scene state's installer put in `g_player_camera_hook`
(`0x009A5CDC + p*0x130`). Under the four `cam/` path cameras (scene states
2/4..2/7) that is `PlayerHookSpawnDamageOverlay` (`FUN_00415180`); under the
follow and no-op cameras (1/1, 1/2) it is `PlayerHookDrawBody`, which draws the
player's body and never reads the latch. The spawn:

```c
DamageOverlaySpawn(task, kind):                    /* FUN_00417440 */
  if (g_damage_overlays[p].active) return;         /* no restart, no sound */
  rec = { active 1, frames 60, count g_max_attackers,
          x g_damage_overlay_x_by_players[count-1][p], kind };
  PlaySoundId(g_damage_overlay_sounds[kind]);
```

and every frame, from the same update, `DamageOverlayUpdateAndDraw`
(`FUN_00417300`) counts it down and draws it **unchanged** -- no fade, no
flash, no animation -- for 59 frames: identity matrix, translate
`(offsets[kind].x + rec.x, offsets[kind].y, -1.02)`, scale `0.02`,
`AssetDrawSlot(g_damage_overlay_slots[kind][count-1])`, draw layer 0xA --
which the translucent sort (`RenderCommandCompare`, layer ascending) puts
under the shot effects' 0xC and 0xE. On the
fifth update (`frames == 0x37`) it plays the hurt voice, `rand() % 2` of
James's `DAMEGE_JMS\184/185` or Gary's `DAMEGE_GA\187/188`. The latch is
cleared by `UpdateScreenShake` (`FUN_00415270`), which also starts a 48-frame
vertical camera nod: `UpdateSceneViewAndLight` re-aims the camera at
`(0, g_screen_shake_pitch, -1000)` in its own un-rolled frame, where
`g_screen_shake_pitch = ftol(cos(frames * 0x1800 BAMS) * frames)`.

| kind | slot | `common.bin` | picture | sound |
|---|---|---|---|---|
| 0 | 0x93B | 126 | diagonal swipe, mirrored | DAMAGE1 |
| 1 | 0x93A | 125 | diagonal swipe | DAMAGE1 |
| 2 | 0x938 | 123 | three claw marks, U-flipped | DAMAGE2 |
| 3 | 0x932 | 117 | three claw marks | DAMAGE2 |
| 4 | 0x939 | 124 | one slash, U-flipped | BLOOD03 |
| 5 | 0x933 | 118 | one slash | BLOOD03 |
| 6 | 0x937 (2P 0x936) | 122 (121) | wide gash | BLOOD03 |
| 7 | 0x934 | 119 | splat | DAMAGE4 |
| 8 | 0x935 | 120 | vertical streak | BLOOD05 |
| 9, 10 | 0x931 | 116 | ring of teeth marks | BONE01 |

**How opaque it is: solid where the mark is, clear round it** `[proved]`.
The draw is the plain `AssetDrawSlot` (`FUN_00418560`; the `CALL` is at
`0x004173B5`), never `AssetDrawSlotWithAlpha` (`FUN_004185A0`), so it hands
the model no alpha and nothing fades it: `RenderSubmitModelDefaultLight`
(`FUN_004AA2B0`) queues an unfaded command and `WalkMeshChainAndDraw`
(`FUN_004A7EF0`) draws each mesh by its own header. All eleven models are one
mesh each with the same state:

| field | value | what `TranslatePvr2StateToD3D` / `WalkMeshChainAndDraw` make of it |
|---|---|---|
| TSP | `0x9400041B` (`0x9404041B` on 123/124, U flip) | `SRCALPHA` / `INVSRCALPHA`; bits 20-19 clear, so the translucent pass with the alpha test on (ref 1); shading mode 0, so `ALPHAOP MODULATE` (texel x diffuse); `POINT` filtering; fog on |
| base colour, `+0x2C..+0x38` | ARGB `(1, 1, 1, 1)` | `SetMaterial`'s diffuse -- alpha 1.0 |
| `+0x28`, `+0x24` | 0.75, -1 | material ambient 0.75 x diffuse; no specular |
| texture | 26..33, ARGB4444 VQ 128x128 | alpha 0 over 55-84% of each; of the texels the mark covers, 31-82% are 255 (the thin claw marks, texture 27, are mostly edge) and the rest a 4-bit soft edge |

So what reaches the screen is the texel's alpha: a solid mark with feathered
edges, not a translucent one, and the same on all 59 frames. The port draws
exactly that -- `tools/hurt_alpha.mjs` measures it off the page's pixels
(stage 2's kind 4: 66.5% of the covered pixels at alpha exactly 1.0 against
texture 28's 65.4% of covered texels at 255; stage 1's kind 0: 74.2% against
texture 33's 75.9%), and `tools/verify_texture_alpha.py` holds the call, the
words, the base alpha, the textures and the bundle's images to it.

`[likely]` **Its colour is lit.** `AssetDrawSlot` draws under
`SetLightingDefaultSingle`'s light, and no immediate `PUSH 0x89`
(`D3DRENDERSTATE_LIGHTING`) is in the D3D module, so the device's default --
lighting on -- stands and the vertex colour the texel is
multiplied by is D3D's lighting of material ambient 0.75 and diffuse 1.0 --
with the model's normals `(0, 0, 1)` put through a modelview scaled by 0.02
and `NORMALIZENORMALS` never set. That can tint the mark with the scene's
light and darken it where the light is behind it. Alpha is untouched by it
(the lit diffuse alpha is the material's, 1.0). `[open]` how far: that turns
on how the device transforms an unnormalised normal. The port draws every
effect model unlit (`render/lighting.ts`), so it shows the texture's own
orange.

The zombie attack tables' `+0x0A` values span 0, 1, 2, 3 (type 0x0D only), 4,
5, 7, 8 and 9; the literals at the other call sites are 0/1 (the thrower's
grab), 4 (the axe), 6 (arcing throws, the stage-2 boss), 7 (leaps, rolled
props), 8 (boss 4), 9 (bats, fish, frog, owl, body creature) and 10 (the
horde). With two players the overlays sit at x = -0.22 and +0.22. The port is
`web/src/game/effects/damage_overlay.ts`.

**The second argument decides whether there is an overlay at all.** It gates
the latch, and it is 1 at every call site but three: `ActorStrikeConnect` and
`ThrowerStrikeConnect` pass **0** when the striker has `obj+0x34` bit
`0x2000000` set (and then despawn it -- `ZombieReleaseAndDespawn` /
`ThrowerLeave`), and `ThrowerStrikeConnect`'s first site at `0x0044CEE6`
passes 0 as well. A life is still taken; no overlay and no shake.

### Do zombies aim their torso and head at the player? The body, and the head.

This section answered "no" for a long time, on three bullets. The first is
still true, the second was about the wrong hook, and the third was wrong: the
head **is** aimed, by the per-node draw hook rather than the pose hook, which
is why the search that settled it looked in the wrong place (L39: a negative
result about the wrong question). The routine that does it had no function in
Ghidra, so its callers were in no xref list either (L35).

* **The bone pose is pure motion.** `SkeletonWalkNode` takes every bone's
  rotation from `g_frame_bone_rotations`, which points straight into the loaded
  motion bank, and adds nothing derived from the actor.
* **The pose hook rotates nothing.** `SkeletonApplyRootMotion` calls the hook
  at `model+0x115C` -- `obj+0x12F0` -- and for these two classes that is their
  push-out: `EnemyZombieInit` writes `ZombiePushOutOfWorldAndActors` there and
  `EnemyThrowerInit` `ThrowerPushOutOfWorld`, both as `obj+0x12F0`, which is
  why a count of writes to `+0x115C` found only `PoseHookNone` and
  `PoseHookGrowAndPushOutOfWorld` and called the zombie's hook empty. None of
  the four rotates a bone. `[proved]`
* **The node draw hook aims bone 2.** `ZombieDrawBonePart` (`FUN_004534A0`)
  pushes the matrix, and for bone 2 while `obj+0x34` lacks `0x40000` calls
  `ActorAimHeadAtCamera` (`FUN_00453BE0`) at `0x004534EA`, before its switch;
  `ThrowerDrawBonePart` (`FUN_00449F90`) does the same at `0x00449FD9`, but
  only while `obj+0x136C` has `0x100` or lacks `0x20` -- on the ground or the
  ceiling, never on a wall. An `E8` scan of `.text` finds no third caller.
  `[proved]`

`ActorAimHeadAtCamera`, from its listing (`0x00453BE0..0x00453D67`):

```
centre = (obj+0x68 - 0x8000) & 0xFFFF         ; straight ahead for the head
pt     = g_camera_blocks[cam] (view to world) * record[bone] + 0x68
{pitch, yaw} = ActorHeadAimAngles(&pt)        ; FUN_00453D70
t = TurnAngleToward(obj+0x1320, pitch & 0xFFFF, 0xC0)
obj+0x1320 = AngleWithinTolerance(t, 0, 0x4000) ? t
           : TurnAngleToward(obj+0x1320, 0, 0xC0)
t = TurnAngleToward(obj+0x1324, yaw & 0xFFFF, 0xC0)
obj+0x1324 = AngleWithinTolerance(t, centre, 0x4000) ? t
           : TurnAngleToward(obj+0x1324, centre, 0xC0)
MatrixRotateY(-centre); MatrixRotateY(obj+0x1324); MatrixRotateX(obj+0x1320)
```

`ActorHeadAimAngles` is `VecToAngles(target - pt)`, and the target is the
camera eye raised **15.0** (`FADD double [0x00565DD8]`) -- unless
`g_max_attackers == 2` and the actor holds a permit, when it is
`T(eye) Ry(g_camera_block_yaw_bams)` applied to `((1 - 2*permit) * -1.2, 15,
-1.5)`: 1.2 to the side of the player whose permit it holds. `[proved]`

What follows from it, each `[proved]` from the same listings:

* **A quarter turn each way, at `0xC0` a drawn frame.** A step that would
  leave the window is thrown away and the head steps back toward the centre
  instead, so a head whose player has gone behind it walks out to the edge and
  alternates across its last `0xC0`, a frame each way.
* **Only bone 2's own draw turns.** The rotations land on the matrix the hook
  pushed. The stored node matrix at `+0x28`, which `ActorDrawAttachedParts`
  hangs hair and hats from, and the hit-sphere centre and camera point
  `SkeletonEmitNode` takes, all keep the pose's. Bone 2 is a leaf under bone 1
  in every skeleton from type 0 to 0x19.
* **It aims from the previous draw.** `pt` is the bone's view-space hit-sphere
  centre, which `SkeletonEmitNode` writes at `0x004116C3` **after** it has
  called the hook, and not at all while `obj+0x34` has `0x8000`. Every
  class-0x30 corpse does (`ZombieEnterCorpseState` raises `0xC000` at
  `0x0045675E`), and nothing in the hook tests death, so a corpse's head keeps
  turning toward the camera from the point where it died, re-projected through
  wherever the camera is now.
* **The angles start aimed.** `EnemyZombieInit` (`0x00452EAB`) and
  `EnemyThrowerInit` (`0x004496FE`) both seed `obj+0x1320`/`+0x1324` with
  `VecToAngles(eye + (0, 15, 0) - pos)` under the same `0x40000` test.
* **`0x40000` is a spawn-record bit, and it is what keeps the head apart from
  the captor script.** Nothing in `.text` writes it -- no dword, byte or
  register form of an `OR`/`AND` names that bit of `+0x34` -- and eleven
  class-0x30 states (34-38, 40, 41, 43-46) use `obj+0x1320` for something
  else, the motion id among them. Across the twelve bundles, 160 of 608
  class-0x30 spawn rows carry the bit, and they include **all 138** whose
  start or attack state is one of those eleven, all 114 civilian captors and
  all twelve class-0x18 rows; none of the 42 class-0x31 rows carries it.
* **Class 0x25 has a twin** at `0x00485BA0`,
  `ScriptedHumanoidAimHeadAtCamera`, called by `ScriptedHumanoidBoneDrawHook`
  for bone 2 while `obj+0x1364 != 0`. The same stepping on other words --
  pitch `obj+0x1368`, yaw `obj+0x136C` -- toward the eye raised 15 with the yaw
  offset by `-0x8000`, and an **absolute** turn: `MatrixClearRotation`
  (`FUN_004A9F70`) wipes the bone's 3x3 before the two rotations. Its seed is
  `ScriptedHumanoidSeedHeadAim` (`FUN_00485D70`), which op 12 mode 1 calls as
  it raises `obj+0x1364`; op 12 is in none of the 274 class-0x25 programs the
  twelve bundles carry, so in the exported data this twin never runs.

**Ported** for classes 0x30 and 0x31: `game/class30/head_aim.ts` steps the
angles, which live on both arms as `HeadAimWords`, from the two hooks the node
walk runs in each class's update; `render/characters/head_aim.ts` draws the
turn around each mesh the hook draws, as the engine's push and pop.
`web/test/port.test.ts` asserts the seed, the rate, the window and its edge,
the quarter-turned centre, the stale record, both gates and the two-attacker
target. Class 0x25's twin is not ported.

So the aiming you see is the **whole actor turning**, plus the head. The body
turn is `TurnActorTowardCamera` (`FUN_00409ED0`), a rate limit of `0x1A0`
BAMS a frame jogging and `0x410` sprinting toward a point 1.5 units from the
eye -- along world +Z turned by `__ftol(g_camera_eye_y)`, the eye's *height*,
which at the stages' heights is a few dozen BAMS, not "in front of the
camera" as this said. Then the motion variants the game selects: two walks
chosen by `obj+0x136C` bit 21, the attack run by bit 27, the per-region
stumbles, and the four-arc deaths.

The pose-hook half took a hook search rather than an xref sweep to establish,
because the pose is reached through a stored function pointer -- the same
shape that made the camera tracking invisible earlier in this file. That hook
was found and read, and it rotates nothing; the head's aim is in the draw hook
beside it.

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
| `0x2000` | 9 | `NoHitReaction` — `ActorPlayHitReaction` and `ThrowerOnShot` both refuse |
| `0x4000` | 6 | `PoseFrozen` — the motion clock does not advance |
| `0x8000` | 167 | `RegisterForShotTest` refuses it, and so does the crowd push |
| `0x10000` | 4 | `NoCameraTrack` |
| **`0x20000`** | **95** | **`ZombiePushOutOfWorldAndActors` skips the ground snap** |
| `0x40000` | 22 | `EnemyZombieInit` skips the aim-angle setup |
| `0x8000000` | 155 | picks between `row[2]` and `row[3]`, and makes the crowd push 1.8x |

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

`ZombieThrowHandWeapon` writes **two** fields of that same bone record as the
weapon goes: the draw slot at `+0x00`, and `+0x78` to zero — `899f54050000` at
`0x0045A2B2` for bone 5 and `899f04070000` at `0x0045A2DB` for bone 8, with
`EBX` zeroed. `0x554` is `0x20C + 5*0x90 + 0x78`, **inside bone 5's own
record**, not the base of another one, and `+0x78` is what `SkeletonWalkNode`
(`FUN_004107E0`) fills at build with `obj+0x1300 * hit_sphere.radius` — so
the hand that has just been emptied stops being shootable.
`SpawnThrownWeapon` (`0x00450540`) does the identical write for class 0x31,
where Ghidra renders the same address as `bone * 0x90 + 0x284`. **[proved]**

`SkeletonWalkNode` only copies the sphere in when the table entry's own slot
equals the slot it has just written, and writes four zeroes otherwise — so the
general rule is that **a bone drawing anything but the model
`PTR_DAT_004D032C` names for it has no hit sphere**, which covers every gore
variant as well as a bare hand. `render/characters.ts` tests the static table
instead; that is `[diverges]`, declared in `game/class30/throw.ts`.

The sub-states are `Arm → Wait → Claim → Release → Recover → Leave`, and the
first three are a fallthrough: with zero delays a spawn arms, waits and claims
on one frame, and three of the seven have exactly that. The permit is
`TryClaimAttackSlot`, the same one every other enemy queues for, so a thrower
behind a crowd waits its turn.

Body condition 7 is **sticky**: `ActorBodyConditionFromHands` (`FUN_00455920`)
recomputes the condition from the hands for every type in 0x13..0x14 *except*
when it is already 7 or 5, and the state itself sets 5 as it leaves.

#### The way out is chosen twice, and the first choice is a spawn bit

**`obj+0x38` bit `0x10` decides whether the actor leaves at all.** At
`0045945C` — `TEST byte ptr [ESI + 0x38], 0x10`, `f6463810` — the state splits:

* **bit clear** — it walks or leaps away, on the descriptor's `tail+0x03`;
* **bit set** — **it never moves again.** `ReleaseEnemyAliveCount`,
  `ReleaseEnemyPresentCount` and `ReleaseAttackSlot` run on the spot,
  `g_enemy_slots[obj+0x120 * 8]` and the hit slot are cleared, `obj+0x1330`
  takes `tail+0x1C`, `obj+0x34` gets `0x10100` (`NoCameraTrack | ShotImmune`)
  and the sub becomes **6**, which the arm falls into on the same frame. Sub 6
  (`LAB_00459562`) plays `row[0]` and despawns once
  `g_enemies_present < 1 && g_players_in_play != 0 && --obj+0x1330 < 1`.

That bit is not a fact about the room. `EnemyZombieInitByCharType`
(`FUN_00452FD0`) **moves** it there out of the spawn record's `obj+0x34` bit 1
at `0045300B`, clearing it at the source — it has to, because bits 1 and 2 of
`obj+0x34` are the two `MarkActorShot` later uses to name the player who fired.
`ZombieStateStandAndThrow` is its only reader in the whole image, and **exactly
two records in the shipped game set the source bit**: stage 3 block 2 step 4's
two axe men, evt offsets `0x3078` and `0x30BC`, `init_flags 0x20002`. They
stand on a walkway with a building at their backs — a diagonal wall running
`(-643.3, -3340.4)` to `(-626.2, -3357.4)` in `st3_08`, six units behind them —
and there is nothing in `ZombieStateWalkDistance` or in the world push that
could have stopped a retreat: the collision the script has selected there is
`coli3.bin+0x2EA0`, thirty-one quads of flat water at `y = -25`, twenty-four
units below their feet. The bit is how the game says *this one does not back
away*, and both counters going back at once is why the block it was holding
carries on rather than waiting out a walk. `[proved]`

With the bit clear, the descriptor's `tail+0x03` — the same byte the port
carries as `attack_state` — chooses between the two moving endings. **0** walks
away through state 15 with the distance at `tail+0x10`; **26** leaps through
state 26 to the point at `tail+0x10`..`+0x18` with the gravity at `tail+0x20`.
Both are entered at **sub 1**, which is why those two states have a sub-1 arm
that skips their own descriptor read. The walk arm raises `obj+0x34` bit
`0x20000000`, and this is the one place in the game that reaches
`ZombieStateWalkDistance`'s retire-instead-of-attack branch.

> ⚠️ `obj+0x34` bit `0x1000000`, which sub 0 tests and the walk arm clears, is
> written by **nothing in the image** — an exhaustive scan of every `OR`
> encoding that can raise it finds no site. The test is always true and the
> clear is a no-op.

A second path reaches the same state: `ZombieShouldStandAndThrow`
(`FUN_00458E10`) lets a **condition 8** walker stop and throw when
`(g_camera_block_yaw_bams - 0x8000) & 0xFFFF` -- the camera block's yaw turned
half round, which is the heading of an actor facing the camera -- is within
`0x400` BAMS of the way it is facing (`0x00458E48`). Fourteen spawns are
condition 8, and they never turn to line the shot up. **The claim and the
hands come in the character type's order**: `znassb` (type 1) takes the permit
first and then looks for a blade, so one with both shot away still holds the
permit and answers no; the axe types 0x13 and 0x14 look first; any other type
answers no without claiming. The port read `g_camera_yaw_bams` (`0x009C71F0`)
here, half a turn from the block, and none of the fourteen ever threw.
`[proved]`

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
at a range. `[proved]` from the listing: four arms off the jump table at
`0x0044B868`, each of the first three ending `INC obj+0x1312` and running on
into the next, and `JA` returning for a sub past 3.

```
sub 0  p = ThrowerPickLandingPoint()          /* a place on the SCREEN */
       obj+0x68   = g_camera_yaw_bams
       ActorArcBeginToWaypoint(p, &DAT_007DCC70, 1)  /* draws the attack */
       obj+0x1364 = bit6 + 2*(bit7 + 2*bit17) + 3*bit8 of obj+0x136C
       obj+0x34  |= 0x10000000                /* 0x0044B6F0 */
       if (obj+0x32C == 0x2002) ActorPlayHitVoice(obj, 3)
       type != 0x18: obj+0x136C &= 0xfffff61f /* 0x800, surface, off-ground */
       type == 0x18: obj+0x136C &= ~0x800; obj+0x13D8.. = obj+0x40..
sub 1  if (!(obj+0x136C & 0x800) && type != 0x18) ThrowerStrikeConnect()
       if (ActorArcStep(obj, 1) == 1) return
       obj+0x136C &= 0xffe7ffff               /* both collision bits down */
sub 2  if (!(obj+0x136C & 0x800)) ThrowerStrikeConnect()
       unless g_GameMode == 2 && g_script_flags[0xF2]: obj+0x40.. = p again
       if (obj+0x19C < g_motion_play_length[obj+0x1B4] - 2) return
sub 3  obj+0x136C &= ~0x800; obj+0x34 &= ~0x10000000; state 10
```

Things worth naming.

* **The attack is chosen by the sentinel.** `ActorArcBeginToWaypoint`
  (`FUN_0044D780`) takes a pointer to an arc motion script, and
  `&DAT_007DCC70` (`g_arc_script_draw_attack`, zero, referenced by that one
  `PUSH` and that one `CMP`) sends it to its own draw instead:
  `g_class31_attack_picks[(rand() >> 4) % 10 + (obj+0x1318 & 7) * 10]`, then
  `ThrowerLoadAttackArcScript`. So the swing and the flight are one clip.
  Character type 0x18 takes the draw **and then** has 3 written over it.
* **The stance is latched, then cleared** -- after the arc begins, before the
  surface bits go -- so a thrower that pounces off a wall swings the wall's
  attack and arrives on the ground. `zslman` does not come off its surface at
  all: it keeps every bit but `0x800`, and records where it left from.
* **The bit is `0x10000000`**, not `0x20000000`. `ThrowerEmitGroundDust`'s
  landing column answers `0x20000000` with `0x10000000` down, so the pounce's
  landing raises none and the leap back's does.
* **Down, it collides with nothing**, and the re-snap to the landing point
  holds it on a camera that may still be moving until the clip is two frames
  from its end. The one gate on the re-snap is Training Mode with
  `g_script_flags[0xF2]` up; `FUN_00497760` raises that byte (`0x004979B6`),
  and what it stands for there is `[open]`.

### `ThrowerStrikeConnect`, `FUN_0044CE60`

**It tests no range at all.** `[proved]` from the listing:

```
if (obj+0x136C & 0x400) {                       /* the throw table */
  e = g_class31_throws[set] + (s8)obj+0x131A * 0x10
  if (obj+0x19C != (s16)e+8) return
  if (((obj+0x1318 & 7) & (s16)e+0xC) == (s16)e+0xC) return
  PlayerTakeDamage((s8)obj+0x121, kind, (s16)e+0xA)       /* no 0x800 */
} else {                                        /* the melee table */
  e = g_class31_melee_attacks[set] + ((s8)obj+0x131A + obj+0x1364*4) * 0x10
  if (obj+0x19C != e.hit_frame && !(e.hit_frame == -1 && obj+0x1360 == 4))
    return
  if ((obj+0x1318 & e.mask & 7) == e.mask) return         /* mask 0 whiffs */
  PlayerTakeDamage((s8)obj+0x121, kind, e.overlay); obj+0x136C |= 0x800
}
kind = obj+0x34 & 0x2000000 ? 0 : 1, and with 0 ThrowerLeave follows
```

The hit is **`==` the frame**, not "at or past it": a clip that jumps past
its hit frame -- a fit that skips into the middle of a clip, a connect first
called after the frame has gone -- does not hit. And **the connect latch is
the callers'**: `ThrowerStateLeapDown` tests `0x800` before calling,
`ThrowerStateDelayedPounce` and `ThrowerStateStrikeOnTheSpot` do not,
`ThrowerStateCloseAndStrike` calls only on its throw entry's own frame.
`ThrowerStateWaitForPermit` raises `0x400` for character type 0x17 alone, so
the throw-table arm is `zskamere`'s. The aiming is the arc: the landing point
is a pixel offset unprojected at a fixed depth, so the actor is where the
swing will reach on the frame it lands. Same design as the melee strike and
the thrown weapon -- this engine times its hits, it does not test them.

### The leap back — `ThrowerStateLeapAside`, `FUN_0044B880`

State 10. `[proved]` from the listing; Ghidra cuts sub 0 at the
`MatrixStackPop` at `0x0044BA37` (`L35`), and the body runs on into the
script choice and the arc.

```
sub 0  obj+0x34 |= 0x20000000; obj+0x136C |= 0x180000
       type 0x17: obj+0x34 |= 0x2000
       type != 0x18:
         x = obj+0x136C & 0x10 ? 5.0 : (1 - 2*(rand() % 2)) * 5.0
         p = eye + RotY(g_camera_yaw_bams) * (x, 0, 50.0)
         trace (p.x, obj+0x104 -/+ 1000, p.z): hit -> obj+0x13D8 = the hit
                                               miss -> (p.x, g_camera_fixed_eye_y, p.z)
       ActorArcBeginToWaypoint(obj+0x13D8, script, 1)
sub 1  unless obj+0x136C & 0x20: TurnActorAwayFromPoint(obj+0x13D8, -0x100)
       if (ActorArcStep(obj, 1) == 1) return
       obj+0x34 &= ~0x20000000; obj+0x1338 = 0; ThrowerReleaseAttackPermit
       type != 0x18: SetCurrentActorMotionBlended(set[4], 0, 1)
       type == 0x18: ActorSetMotionBlended(0x211 / 0x20E / 0x214 / 0x20B, 0, 5)
sub 2  if (++obj+0x1338 < 0x5A && |obj - eye|xz < 50.0) return
       if (obj+0x19C < g_motion_play_length[obj+0x1B4] - 2) return
       state 7
```

| script | when |
| --- | --- |
| `0x00564AF8` `aside_attack3` | `obj+0x131A == 3` and type != 0x18 |
| `0x005649A8` `aside_zsass` | type 0x16 |
| none | type 0x17: `JZ 0x0044BAE7` skips the copy, so the local is uninitialised stack |
| `0x00564D08` + `0x60` * row `aside_zslman_<row>` | type 0x18, row = `3*bit8 + 2*bit7 + bit6`, 1..3, else 0 |
| `0x00564AC8` `aside` | every other type |

`zslman`'s four sit **`0x60` apart**, each after the pounce script set 3
names for attack 3 in that stance; the exporter read them at `0x30` until
this was read, which gave rows 1 and 3 a pounce and row 2 row 1's leap.
`verify_combat.py` check 16 holds the export to the four `MOV ESI, imm32` the
state picks them with.

So the ordinary thrower lands five units to one side of the camera and fifty
in front, **in the camera's yaw-only frame**, and stands there for ninety
frames or until it is fifty units clear -- and until its landing clip is two
frames from its end. That wait **is** the cooldown; there is no timer.
`zslman` instead leaps back to where its pounce began, on its own surface's
script, so a wall-crawler goes back up its wall.

### The delayed pounce — `ThrowerStateDelayedPounce`, `FUN_0044E830`

State 23, stage 2 block 21's pair of `zstin` (motion 310 over 45 and 60
frames). A wait, then the same pounce with three differences. `[proved]` from
the listing; the three subs fall into each other.

```
sub 0  obj+0x1F8 |= 0x10                    /* root motion carries y too */
       ActorSetMotionBlended(desc+4, 0, 5)  /* the ordinary track: it loops */
       obj+0x34  |= 0x100                   /* shots ricochet */
       obj+0x1330 = desc+8
sub 1  if (--obj+0x1330 > 0) return
       clear both bits; claim (0xFF on failure)
       obj+0x34 |= 0x10000000; obj+0x136C |= 0x20000
       draw the attack; ThrowerLoadAttackArcScript
       ActorArcBegin(pos -> (landing.x, g_camera_eye_y, landing.z), desc+8)
sub 2  roll -> 0 at 0xCCC a frame; ThrowerStrikeConnect if a permit is held
       obj+0x34 |= 0x2000 once obj+0x19C > the LIVE row's hit frame
       arc over: clear 0x10000000 and 0x20000, state 25
```

* **The landing point depends on the state.** `ThrowerPickLandingPoint`
  (`FUN_0044CBA0`) switches on `obj+0x1310`: states 22 and 23 take a
  vertical offset of **-350 px**, and 23 unprojects at **-6.0** instead of
  -15.5 — six units in front of the eye rather than fifteen and a half. Every
  other state takes 390 px (type 0x16) or 320 px at -15.5. The sideways offset
  is ±160 px by the permit held, and zero with one attacker.
* **Three stances in one state.** The script comes from the live stance, which
  the pounce bit has just moved to rows 4..7. `ThrowerStrikeConnect` reads its
  row through `obj+0x1364`, which `ThrowerLoadAttackArcScript` does **not**
  write — only `ThrowerStateLeapDown` does (`0x0044B6FB`) — so for a spawn that
  has never leapt down it is row 0. The `0x2000` test reads the live stance
  again. Stage 2's pair therefore swing row 4's clip 289, connect on row 0's
  frame 62 or 64, and stop flinching past row 4's 66.
* **The wait is shot-proof, and it is a climb down a wall.** `ShotImmune` is
  up for all of it -- sub 1 drops it and `ActorArcStep`'s phase 0 raises it
  again on the same frame (`0x0044D8BB`), so it stays up until the takeoff --
  and the clip is the ordinary motion, so it loops and its root carries the
  actor. Both spawns are placed **on their sides against the clock face**:
  their records carry orient `(0, 0xC000, 0xC000)`, which
  `SpawnFromDescriptor` (`FUN_00408A20`) copies whole to `obj+0x64..0x6C`, and
  `SkeletonApplyRootMotion` (`FUN_00410C50`) turns every root delta by
  `T · Rz(roll) · Ry(yaw) · Rx(pitch) · S` before it stores it
  (`0x00410D56`..`0x00410DDE`). Motion 310 walks 7.19 units a cycle along its
  own -Z; that rotation takes -Z to world -Y, and bit `0x10` of `obj+0x1F8` is
  the store that lets the height through (`0x00410E48`). So the wait walks the
  pair straight down the wall -- 8.7 units in 45 frames and 12.6 in 60,
  measured in the page, the fade holding the first six still -- and sub 2
  rolls each one level (`0xCCC` a frame, six frames from `0xC000`) as it
  leaps. `EnemyThrowerInit` sets the draw's rotation order to 1
  (`obj+0x1FC`, `0x004496A2`): `RotX; RotZ; RotY`.
* **Where the stab lands.** The arc is 45 (or 60) frames and the connect
  waits for row 0's frame 62 or 64 on clip 289's flight stage (cut 34..66), so
  the stab lands thirteen frames before the landing (measured in the page),
  with the body some thirty units above the eye and closing -- the swing, not
  the arrival, is what hurts.

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
so 2.0 units a frame — and from `ActorArcBeginTo` (`FUN_0044DC70`) for the
rest: `n = (int)(dist2d * step)`, `T = n - n % step`, x and z only.

**`n` advances by `step` a call, not by one.** `ActorArcStep(obj, step)` hands
its step to `ActorArcInterpolate`, which adds it to `obj+0x1330` (`ADD EDX,
ESI` at `0x0044DD85`), and every caller that begins with `ActorArcBeginTo`
passes the same step to both. So a leg lasts `T / step` frames -- about **one
unit of ground a frame whatever the step** -- and what the step changes is the
arc's height, since the parabola is solved over `T = dist * step` parameter
frames. `ThrowerStatePathFollow`'s waypoints carry step 1 or 3; the pounce, the
leap aside and the surface leaps pass 1. `[proved]`

Over it runs a **three-stage arc motion script**, twelve dwords that
`InstallArcMotionScript` (`FUN_0044DA60`) copies into `g_arc_scripts`:

```
{ s32 motion, s32 start frame, s32 fade, s32 threshold } x 3
```

A script is nearly always one clip cut into windup, flight and landing. Some
of the ones classes 0x30 and 0x31 can install switch clips — `zslman`'s leap
aside in stances 1 and 3 (504 then 506, 494 then 496) and set 3's attack 3 in
all five stances end on a different clip, and `ThrowerStatePathFollow`'s
style-2 script flies on 300 between two stages of 301 — and every start and
threshold of every one lies inside the play length of its own stage's clip,
which `tools/verify_combat.py` check 16 asserts and counts.

`ThrowerStatePathFollow` (`FUN_0044EE00`) picks its leg's script from the
waypoint's style word, the `s16` at `+0x02`, and the bundle carries all four
under `class31.scripts`:

| style | address | name | bundle key | stages |
|---|---|---|---|---|
| 1 | `0x00565E58` | `g_class31_arc_path_style1` | `path_style1` | `{301,12,1,12}` three times |
| 2 | `0x00565E88` | `g_class31_arc_path_style2` | `path_style2` | `{301,7,0,11}{300,48,1,65}{301,17,1,22}` |
| other | `0x00565EB8` | `g_class31_arc_path_style0` | `path_style0` | `{301,0,0,8}{301,9,0,17}{301,18,0,23}` |
| (type 0x17) | `0x00565E28` | `g_class31_arc_path_c17` | `drop_zskamere` | `{439,0,0,19}{439,20,0,31}{439,32,0,42}` |

Style 1 is a pose, not a clip: 301 held on frame 12 by three stages whose
thresholds are their own start frames, so the fit grows the fades over the
whole leg and the actor flies it in one frame of the hop. `ActorArcStep` (`FUN_0044D860`) plays stage 0 on the spot,
stage 1 once the clip frame reaches stage 0's threshold, stage 2 once it
reaches stage 1's, and reports the arc over once the landing clip reaches
stage 2's — **not** when the arc lands: its flight phase ignores
`ActorArcInterpolate`'s result, so an arc that comes down early waits for the
clip. `zstin`'s attack 0 is `{303,0,5,22}{303,23,5,46}{303,47,0,47}` and
connects on frame **62** of the same clip.

**The fade is a hold.** Each stage is played by a direct `CALL 0x004119a0` —
`ActorSetMotionBlended(obj+0x194, motion, start, fade)`, at `0x0044D901`,
`0x0044D94D` and `0x0044D9C9` — which writes `start` into the cursor at
`obj+0x19C` outright and raises `track+0x37` bit 0. While that bit is up
`SkeletonAdvancePlayCursor` (`FUN_004111A0`) does not recompute the cursor, so
it sits on `start` until the counter has run `fade + 2` past the call, then
plays on from `start + 1`. Every threshold the script and the attack entry
name is compared against that held cursor, and it is what the fit is fitting:
`FitArcScriptByFadeLength` (`FUN_0044D5F0`) grows stages 1 and 2's fades to
take up the slack of a long arc, so a long leap holds the flight clip's first
frame through the air rather than playing it slowly. `[proved]`

The two fits are different routines with different slacks, chosen by
`CMP CX, 0x19` at `0x0044D8C1`:

```
FitArcScriptByFadeLength   (every type but 0x19)
  slack = s1.start - s1.until + T                     ; no fades in it
  > 0:  while (s1.fade + s2.fade < slack) both++
        if (slack < s1.fade + s2.fade) s1.fade--      ; the odd frame is stage 2's
        both clamped at 0x7F
  < 0:  s1.fade = s2.fade = 1
        until (fades + s1.until - s1.start <= T and s1.until - s1.start <= 1):
          s1.start++, s1.until--
        if (s1.until - s1.start < 1) s1.start--

FitArcScriptByStartFrame   (0x19, zstin)
  slack = T - s2.fade - s1.fade - s1.until + s1.start
  k     = __ftol(|slack * 0.5|)
  > 0:  both fades += k; the rest onto s1.fade; NO clamp
  <= 0: both starts += k, each clamped at its own until; the rest onto s1.start
```

The port had one function for both, with the second's slack and `k`, until
the rooftop route of NEW-BUGS-2 was read.

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
else if (obj+0x34 & 0x2000)         nothing: the no-hit-reaction latch is up
                                    (00449A95 TEST AH,0x20) -- here that is
                                    two knockback arcs already spent
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

### `zslman`'s damage rate is bounded by its stagger, not by your trigger

A room of class-0x31 character type 0x18 cannot be cleared faster than its
knockdowns allow, and the reason is one bit.

`ThrowerOnShot` (`FUN_004499A0`) sends character type 0x18 to
`ThrowerStateKnockedTumbling` (`FUN_00450E40`) rather than to the stumble.
Inside that state `ActorFlag.ShotImmune` — `obj+0x34` bit `0x100` — goes up at
the landing (`LAB_004512E2`, `OR DH, 0x1` on `obj+0x34` in the same breath as
the velocity clear) and again on the way out at `switchD_00450e59_caseD_4`,
which also writes `obj+0x133C = 0x14` and enters state 7. `EnemyThrowerUpdate`
(`FUN_00449910`) is what takes the bit down, and only when that cooldown
reaches zero.

While it is up, `DispatchHit` (`FUN_004092F0`) refuses `ResolveHit`
(`FUN_00409430`) outright, and both enemy classes gate their whole shot
response on the same bit besides — `ThrowerOnShot` at `0x004499F5`
(`f6c401 TEST AH,0x1` / `JNZ 0x00449AF6`, the routine's tail) and
`ZombieOnShot` (`FUN_00453EB0`) at `0x00453EC7`.

**So one shot lands per knockdown cycle.** The cycle is the knockback arc, the
bounce down to `0.15` on the gravity axis or `obj+0x1338` reaching `0x78`, a
settle of `(rand() % 10 + 1) * 3` frames, the get-up clip, and then the twenty
frames of `obj+0x133C`. Measured in the port on stage 6's three rooms: 130 hit
points, 35 a hit, so `130 → 95 → 60 → 15 → dead`, with about 120 frames between
one landed hit and the next whatever the rate of fire. Three of them together
cleared in 420, 435 and 285 frames.

This is the designed behaviour and not a bug in either the engine or the port,
but it is a **trap for any harness that measures a room in shots**: firing
twenty rounds into one frame lands exactly one of them. `tools/playthrough.mjs`
therefore gives up on frames in which nothing took damage rather than on frames
elapsed — see its header.

### The carrier's two bits, and which word they are in

`ScriptedCarrierUpdate33` (`0x004331D0`) is the update
`ScriptedSceneryDispatch33` (`FUN_00432FF0`) installs for class 0x33 **selector
1**, where `obj+0x11C` is the sub-type selector rather than hit points — L3, and
the evt's `hp` field is what picks it. It writes itself into `g_carrier_object`
(`0x009A5C34`) every frame at `0x004331E1`, and raises two bits on its **own
`obj+0x34`**:

| bit | raised at | read by |
|---|---|---|
| `0x10000000` | `0x00433203`, when `g_script_flags[tail+0x20] == 1` or `(s32)tail+0x18 == obj+0x1370` | `ZombieStateRideCarrier` (class 0x30 state 29) — the ride is over |
| `0x40000000` | `0x00433280`, once `tail+0x14` is not `-1.0f` and `obj+0x1370` has passed it | `ZombieStateDelayedStrikeInPlace` (state 32) at `0x0045EAFE` — give up to state 10 after `0x14` frames |

Both reads are `[EAX + 0x34]`. **Not `obj+0x136C`**: `0x40000000` there is
`ZombieFlag2.CollideActors`, half of the `|= 0x60000000` that `EnemyZombieInit`
(`FUN_00452DA0`) seeds on every class-0x30 spawn, so a test against that word
answers yes for every zombie in the game and no for the carrier. The port had
exactly that mistake in `ZombieDelayedStrikeGiveUp`; see `class30/scripted.ts`.
