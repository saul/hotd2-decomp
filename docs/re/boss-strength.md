# Class 0x19 — the stage-4 boss: a transcription-grade reading

Read 2026-09-27 from `Hod2.exe` over the Ghidra MCP, for the port into
`web/src/game/class19/`. Every function in `0x004917E0..0x00495EAF` was
disassembled end to end (`disassemble_bytes`, not the pseudocode — Ghidra
truncates `Boss4ResolveShot`, `Boss4DrawAndAgeBoneHitMark` and
`ShotTestBoneMesh` at a `MatrixStackPop`, L35), every jump table was read out
of memory (L38), and every float immediate is quoted as raw hex (L1).

Evidence marks: `[proved]` read in the code; `[likely]` inference with the
evidence stated; `[open]` undetermined.

## 0. What this boss is, and where it appears

**Identity.** Character type `0x4A` = `boss4.bin`, fifteen skeleton nodes
(bones 1..15) `[proved]` (`g_character_skeletons`, `ExeTables.character_skeleton(0x4A)`).
The code never names the boss. What it does name: `COMMON2\CHAIN_SAW_22.wav` and
`CHAIN_SAW_22_OFF.wav` (`Boss4ChainsawOn`/`Off`), `STAGE4_SE\BOSS4_HASHIRI1.wav`,
`BOSS4_YARARE3/4.wav`, `BOSS4_TAORE_A.wav`, `BOS_WALK1_44.wav` and
`AXE_44K.wav` `[proved]` (sound records). "A chainsaw-wielding giant" is
consistent with the sounds; "Strength" is the user's name and the code has no
opinion on it.

**Where it spawns** `[proved]`, from every spawn descriptor reachable in all
twelve evt files (`hod2lib.evt.spawns` over scenes 0..11):

| stage 4 block | tail `+0x01` (entrance) | how it is reached | camera path of the fight | despawn pair `tail+0x40/+0x42` |
|---|---|---|---|---|
| 23 | 0 (carried) | route of blocks 2 and 15 | 185 (`0xB9`) | (182, 0) |
| 25 | 1 (carried) | route of block 6 | 193 (`0xC1`) | (190, 0) |
| 27 | 2 (standing) | no route leads here | 185 | (182, 0) |
| 29 | 3 (standing) | no route leads here | 193 | (190, 0) |

`stage.routes` for scene 3 names 23 and 25 as the only exits; 27 and 29 are
reached by nothing in the stage's own route table `[proved]` and skip the intro
cut (`queue_event 0x40 0 0 0xB5/0xBD` then `set_script_flag 30` straight away)
— `[likely]` the Boss Mode entry points (`g_GameMode == 3`), `[open]` which
routine jumps there.

**It does not re-appear in stage 5 or stage 6 as class 0x19** `[proved]`: no
class-0x19 descriptor exists outside stage 4, and the only other descriptors
with character type `0x4A` in a tail are stage 3's blocks 11 and 13, a
class-0x25 scripted-character spawn (a cut-scene appearance). What the final
stages do have:

* stage 5 (`st5evtbl.bin`): class 0x2D (type `0x4C` = `boss6.bin`, hp 0) in
  block 0, class 0x22 (type `0x45` = `char_adv04.bin`, hp 300) in block 1,
  class 0x14 (type `0x47` = `boss2.bin`, hp 200) in block 3, class 0x32 (type
  `0x4B` = `boss5.bin`/`boss5b.bin`, hp 450) in blocks 7 and 9;
* stage 6 (`st6evtbl.bin`): class 0x45 in block 2, class 0x2D (`boss6.bin`, hp
  400) in blocks 12 and 14;
* **a Strength-shaped figure exists only as class 0x2D's child**:
  `Class2DState4` (`0x00427D40`) allocates four child kinds, and kind 3's init
  at `0x0042D490` seats character type **`0x51` = `b6boss4.bin`**
  (`MOV word ptr [EDI+0x60], 0x51` at `0x0042D4CE`) on clip `0x79`, with its own
  update `Class2DChildKind3Update` (`0x0042D530`). None of class 0x19's code
  runs for it. It belongs to whoever ports class 0x2D.

## 1. Globals the class publishes

`Boss4Init` and `Boss4Update` write four globals at the top of every call and
every other routine reads them instead of taking arguments `[proved]`:

| global | value |
|---|---|
| `0x009A26A0` `g_cur_actor` | `obj` |
| `0x007DD0A8` | `obj+0x194` — the model record ("char" below) |
| `0x007DD0B0` | `obj+0x40` — the transform block (pos `+0x00`, rot `+0x24/+0x28/+0x2C`) |
| `0x007DD0AC` | `obj+0x1310` — the 0xA4-byte state block ("st" below) |

The port keeps the block on the actor (`obj.boss4`) and passes it; that is the
existing, declared shape (`state.ts`).

## 2. The state block (`st`, 0xA4 bytes at `obj+0x1310`)

Every offset below is read or written by a routine in the range; offsets not
listed (`+0x0F`, `+0x7C..+0x83`, `+0x8C..+0x93`, `+0x98..+0xA3`) are touched by
nothing in the class `[proved]`.

| off | type | meaning | written by |
|---|---|---|---|
| `+0x00` | u32 | flags, see §3 | many |
| `+0x04` | u8 | state (index into `g_class19_states`) | many |
| `+0x05` | u8 | sub-state | many |
| `+0x06` | u8 | saved state (a reaction's return) | `Boss4ResolveShot` |
| `+0x07` | u8 | saved sub | `Boss4ResolveShot` |
| `+0x08` | u8 | phase 0..17 (`0xFF` until the entrance) | Init, entrance, `Boss4AdvancePhaseAtFloor`, ChooseAction, Withdraw |
| `+0x09` | u8 | carried props left (2) | Init, `Boss4StateThrowHeldProp` |
| `+0x0A` | u8 | carried props used, bit per record | Init, `Boss4StateThrowHeldProp` |
| `+0x0B` | s8 | rank 0..15 | Init (`GetDamageRank`), `Boss4AdjustRank` |
| `+0x0C` | u8 | head hits since the last rank step | Init, `Boss4ResolveShot`, `Boss4AdjustRank` |
| `+0x0D`,`+0x0E` | u8 | lives snapshot, players 0/1 | Init, `Boss4AdjustRank` |
| `+0x10` | ptr | the carrier (`g_civilian_carrier` at spawn) | Init |
| `+0x14` | f32 | camera cue: current frame | `Boss4PlayCameraCue` |
| `+0x18` | f32 | camera cue: end frame | `Boss4PlayCameraCue` |
| `+0x1C` | f32 | camera cue: step per frame; **0.0 = no cue running** | Init, `Boss4PlayCameraCue` |
| `+0x20` | s16 | camera cue: path | `Boss4PlayCameraCue` |
| `+0x22` | s16 | queued cue, -1 none | Init, `Boss4QueueCameraCue`, `Boss4PlayCameraCue` |
| `+0x24` | f32 | this phase's hit-point floor | Init, entrance, `Boss4ArmPhaseWhenInsideArena` |
| `+0x28..+0x6F` | vec3[6] | P0..P5, the phase's arena (y = pos.y at load) | `Boss4LoadPhaseArena` |
| `+0x70` | f32 | `ActorRegisterCameraPoint`'s rise: 6.0; -15.0 in the charge | Init, charge, flinch, knockdown |
| `+0x74` | s32 | one slot, many uses: next state (approach, turn), countdown (hold), charge start frame, carried-prop index, saved clip (flinch), death dwell | several |
| `+0x78` | s32 | charge: the camera frame the boss becomes tracked | arena |
| `+0x84` | f32 | approach range, **or** the turn point's x | `Boss4PickApproachAttack`, arena, ChooseAction |
| `+0x88` | f32 | the turn point's z | arena, ChooseAction |
| `+0x94` | ptr | the carried prop being thrown | `Boss4SpawnHeldProp` |

**Correction to `state.ts`:** `+0x70` is not a walk speed; it is the float
`ActorRegisterCameraPoint` (`FUN_00409B70`) is handed every frame at
`0x00491A49` (`index.ts` already feeds it to `cameraRise`, under the wrong
field name). `+0x10` is the carrier and `+0x10..+0x1B` is **not** a path (the
TSV said so before; it was wrong).

## 3. Flags

### State flags (`st+0x00`) `[proved]`

| bit | meaning | set | cleared |
|---|---|---|---|
| `0x01` | riding the carrier | Init (entrances 0,1) | entrance sub 1 |
| `0x02` | fenced: the arena quad is enforced in `Boss4Update` | entrance (`|= 0x12`), `Boss4ArmPhaseWhenInsideArena` | death, ChooseAction phase 3, Withdraw, every arena tail |
| `0x04` | would cycle bone 5's slot `0x444..0x447` | **nothing** (image-wide `OR ..., 0x4` sweep) | — |
| `0x08` | arena transition pending | `Boss4AdvancePhaseAtFloor`, WalkToPoint, Withdraw | every arena tail |
| `0x10` | footfalls armed (`Boss4FootfallShake`) | `Boss4ChainsawOn` (`0x410`), entrance (`0x12`), WalkToPoint | `Boss4ChainsawOff`, entrance states 2/3, WalkToPoint sub 0, death at 0x46 |
| `0x20` | untracked-until-inside pending | `Boss4LoadPhaseArena` | `Boss4TrackWhenInsideArena` |
| `0x40` | arm-when-inside pending | `Boss4LoadPhaseArena` | `Boss4ArmPhaseWhenInsideArena` |
| `0x80` | camera cue queued | `Boss4QueueCameraCue` | `Boss4PlayCameraCue` (not for cues 5, 7, 11, 16) |
| `0x100` | foot on bone 15 raised | `Boss4FootfallShake` | `Boss4FootfallShake` |
| `0x200` | foot on bone 12 raised | `Boss4FootfallShake` | `Boss4FootfallShake` |
| `0x400` | chainsaw loop running | `Boss4ChainsawOn` | `Boss4ChainsawOff` |

### Actor flags (`obj+0x34`) this class uses

`0x08` shot (with `0x02`/`0x04` the shooter), `0x100` refuses damage (phase
floor or transition), `0x2000` strike armed, `0x4000` pose frozen (the frame
counter stops), `0x8000` out of the shot test (Init; the entrance clears it),
`0x10000` off camera tracking, `0x10000000` (cleared with `0x2000` at a
strike's end; raised with it by the throw), `0x40000000` reacting,
`0x4000000` dead.

## 4. `Boss4Init` — `FUN_004917E0` `[proved]`

Verified against `index.ts`; what the port lacks is marked **new**.

```
st = ActorAllocSub(0xA4); obj+0x1310 = st
obj+0x34 |= 0x8000                                       004917e0..826
char+0x60 = (u16)tail[0]    (0x4A)                       0049182e
char+0x20 = 0x7C; char+0x00 = 0; char+0x08 = 0           0049183e..852
ActorBuildSkinnedModel(char, obj+0x40, char+0x78)        00491866
char+0x68 = 1                                            00491871
char+0x348 = 0x444   -- bone 5's slot (record 5 +0x00)   0049187b  **new**
obj+0x124 = 30.0f (0x41F00000)                           00491885
g_enemies_present++; g_enemies_alive++                   0049188f, 00491896
obj+0x121 = obj+0x120 = 0xFF                             0049189d, 004918a4
RegisterEnemySlot(obj)                                   004918ab  **new**
st+0x04 = tail[1]
st+0x04 <= 1 ? (st+0x00 = 1, st+0x10 = g_civilian_carrier) : st+0x00 = 0
st+0x05 = 0
st+0x0B = GetDamageRank()        -- g_damage_rank         004918eb  **new** (the port leaves 0)
st+0x0C = 0
st+0x0D = (u8)g_player_lives[0]; st+0x0E = (u8)g_player_lives[1]   0049190e, 0049191c  **new**
for i in 1..15:                                          0049192d..97b
    char[i*0x90 + 0x100] = tail dword +4+4*(i-1)         -- bone record i +0x88
    if != -1: char[i*0x90+0xEC] |= 0x51; char[i*0x90+0xF0] = 0   -- +0x74 flags, +0x78 sphere radius
st+0x08 = 0xFF; st+0x24 = 0.0; st+0x09 = 2; st+0x0A = 0
st+0x1C = 0.0; st+0x22 = -1 (0xFFFF); st+0x70 = 6.0 (0x40C00000)
obj[0] = Boss4Update
```

**The fifteen tail dwords are per-bone collision meshes, not model pointers**
`[proved]`. They are identical in all four descriptors:
`0CED4DB0 FFFFFFFF 0CED0C60 0CED8FB0 0CED4400 0CED1C40 0CED8330 FFFFFFFF
FFFFFFFF 0CED2C20 0CECF000 FFFFFFFF 0CED3810 0CECFE30 FFFFFFFF`. The evt
loader relocates every dword in `0x0CE80000..0x0CEFFFFF` by `-0x0C53E600`
(`hod2lib/coli.py`, `resolve_pointer`), which lands **all ten** on blob starts
of `coli4.bin` (loaded at `BUF_SCENE` `0x00990A00`):

| bone | blob offset | quads | surfaces |
|---|---|---|---|
| 1 | 23984 | 74 | 61×51, 60×23 |
| 3 | 7264 | 56 | 61×39, 60×17 |
| 4 | 40880 | 44 | 61×32, 60×12 |
| 5 | 21504 | 34 | 53×34 |
| 6 | 11328 | 56 | 61×39, 60×17 |
| 7 | 37680 | 44 | 61×32, 60×12 |
| 10 | 15392 | 42 | 61×25, 60×17 |
| 11 | 0 | 50 | 61×39, 60×11 |
| 13 | 18448 | 42 | 61×25, 60×17 |
| 14 | 3632 | 50 | 61×39, 60×11 |

Bones 2, 8, 9, 12, 15 have `-1` and keep their hit spheres. The consumer is
`ShotTestBoneTree` (`0x00404750`): a record whose `+0x74` has bit `0x10` and
whose `+0x88` is not -1 goes to `ShotTestBoneMesh` (`0x004048A0`), which loads
`g_coli_dynamic_matrix` = camera × bone matrix and `[0x005A4C88]` = the blob and
runs `ShotBuildSegment` against it; the sphere test is skipped because Init
zeroed the radius. So **surface 61 = `0x3D` is flesh (one hit point), 60 =
`0x3C` a spark, 53 = `0x35` silence** — see §6.

## 5. `Boss4Update` — `FUN_004919D0` `[proved]`

```
publish the four globals
Boss4ResolveShot(obj)                                  00491a03
Boss4AdvanceArenaWaypoint(obj)                         00491a09
Boss4ArmPhaseWhenInsideArena(obj)                     00491a0f
Boss4TrackWhenInsideArena(obj)                             00491a15
g_class19_states[st+0x04](obj)                         00491a26
Boss4FootfallShake(obj)                                00491a2e
Boss4AdvanceMotionAndDrawHeldProps(obj)                00491a34
Boss4AdvancePhaseAtFloor(obj)                          00491a3a
ActorRegisterCameraPoint(st+0x70)                      00491a49
Boss4PlayCameraCue()                                   00491a51
if (st.flags & 2) {                                    00491a5b
    if (Boss4KeepInsideEdge(pos, P2, P3, 5.0, 1))      00491a7a
        Boss4KeepInsideEdge(pos, P4, P5, 5.0, 1)       00491aa1
    if (Boss4KeepInsideEdge(pos, P3, P4, 5.0, 1))      00491ac4
        Boss4KeepInsideEdge(pos, P5, P2, 0.0, 1)       00491ae8
}
Boss4AdjustRank()                                      00491af0
Boss4ChainsawCueByCameraFrame()                        00491af5
if (g_active_cam_path == (s16)tail+0x40 && g_cam_path_frame == (s16)tail+0x42) {
    if (obj+0x3C != -1) g_hit_slots[obj+0x3C] = 0
    ActorDespawn(obj)                                  00491b26
}
```

`5.0` is `PUSH 0x40A00000`; the last fence call pushes `0` (a float 0.0). The
despawn pairs are (182, 0) and (190, 0) — the outro cut's camera path at frame
0, `queue_event 0x40 0 0x190 0xB6` in block 23.

## 6. The damage model

### 6.1 `Boss4ResolveShot` — `FUN_00491B40` `[proved]`

Ghidra ends the body at `0x00491D52`; the routine runs to `0x004920B8`.

```
if (!(obj.flags & 8)) return
order = g_hit_player_order (0x009C8908, two ints):
    flags&6 == 2 -> {0, -1};  == 4 -> {1, -1};  else r = rand() & 1 -> {r, r^1}
obj.flags &= ~0x0E                                               00491ba6
surface = 0      -- a local, NOT reset per shooter (ESP+0x10, zeroed once at 00491b4d)
for p in order (stop at 0x009C8910):
    if p == -1 continue;  bone = (s8)obj[0x190 + p];  if bone <= 0 continue
    if (char + bone*0x90 + 0x100 != -1)            -- the bone has a coli blob   00491bdd
        point = hit record 0x009A2C40 + p*0x1C (x,y,z);  surface = +0x0C
    else
        LineSphereIntersect(radius char+bone*0x90+0xF0, centre +0xE0,
                            0x009A2CE8 + p*0x68, 0x009A2CF4 + p*0x68, &a, &b)
        result 1 (a tangent): a.  result 2 with a.z < 0 and b.z < 0: b when
        a.z < b.z, else a -- the LARGER view z, the crossing nearer the camera
        (0x00491C89..0x00491CCE).  Anything else: the sphere centre.  Then
        through the camera block (view -> world).  surface is left as it was.
    -- effects                                                           00491d5e
    surface == 0x3D: Boss4SpawnBoneHitMark(p, bone, obj); SpawnBloodSpray(obj, bone, 0.8 (0x3F4CCCCD));
                     PlaySoundId(0x216A9) COMMON\BLOOD02_16
    surface == 0x35: nothing
    bone == 2 && !(obj.flags & 0x100): SpawnBloodSpray(obj, 2, 2.0 (0x40000000)); PlaySoundId(0x316A9) BLOOD03_16
    else: SpawnSpriteEffect(&point, 0x33, 1, p)
    -- damage                                                            00491dc5
    if (obj.flags & 0x100) continue
    if (bone != 2 && surface != 0x3D) continue
    if (!(obj.flags & 0x4000000)) {
        if (bone == 2) { d = (s8)g_boss4_head_damage[g_players_in_play + st.rank*2]; st+0x0C++; ScoreAddForPlayer(p, 10) }
        else d = 1.0 ([0x004C4380])
        if (g_GameMode == 1)                    -- 0x009CA08C, Original Mode
            [0x009A224C + p*0x14] == -1.0f ? d += d : d *= [0x009A224C + p*0x14]
        if (!(d <= 33.0)) d = 33.0              -- g_boss_shot_damage_cap 0x0055E1B4
        hp = (s16)__ftol((float)hp - d)         -- obj+0x11C
        if (hp <= 0) {
            [0x009C8E10] = 0.0                                       00491e94
            obj.flags = obj.flags & ~0x2000 | 0x4000100
            g_enemies_alive--; ScoreAddForPlayer(p, 0x5DC); BossModeRecordGrade()
        } else {
            [0x009C8E10] = (float)hp / (float)maxhp                  00491ee9
            if ((float)hp <= st+0x24) {
                obj.flags |= 0x100
                if (st.state != 0x12 && st.state != 0x13) obj.flags &= ~0x2000
            }
        }
        if ([0x009C8E10] < 1.0)                                          00491f2f
            char+0x198 = g_boss4_head_slot_by_bar[trunc([0x009C8E10] * 9)]   -- bone 2's slot, 00491f42
    }
    if (obj.flags & 0x4000000) { st.state = 0x16; st.sub = 0; continue }   00491f6e
    if (obj.flags & 0x40002000) continue
    if (bone != 2) continue
    obj.flags = obj.flags & 0xEFFFBFFF | 0x40000000
    st+0x06 = st.state; st+0x07 = st.sub
    yA = world Y of bone 15 (camera block × char+0x910); yB = bone 12 (char+0x760)
    st.state = (yA < G || yB < G) ? 0x14 : 0x15,  G = g_camera_fixed_eye_y + 10.0 (0x004C43A4)
    st.sub = 0
```

`g_camera_fixed_eye_y` is the same word as `g_ground_plane_y` (the evt
`set_ground_plane_y`). Bones 12 and 15 are the leaf nodes of the two leg
chains under bone 9 (offsets `-10.54`, `-11.89` down), so **the knock-down is a
head shot while both feet are 10 or more above the ground** — the boss in the
air — and everything else is the flinch.

`g_boss4_head_slot_by_bar` (`0x005709A0`) is `3D6 3D5 3D4 3D3 3D2 3D1 3D0 3CF
3CE` — `boss4.bin[16]` down to `[8]`, indexed by `trunc(bar*9)`, computed as
`0x005709A0 - ftol(bar * -9.0)*2` with `-9.0` at `0x00570A44`. Bone 2's
skeleton slot is `0x3CE`, so above 8/9 of the bar the head is its own; each
ninth lost moves it one model further.

**Damage per head hit** (`g_boss4_head_damage`, s8 from `0x005704D7`, index
`players + rank*2`, 33 entries): one player / two players per rank 0..15 =
26/22, 24/20, 23/19, 22/18, 21/17, 20/16, 19/15, 18/14, 17/13, 16/12, 15/11,
15/11, 14/10, 14/10, 13/9, 13/9. Index 0 (no player) reads the last byte of the
float before it, 0. **The port's `BOSS4_HEAD_DAMAGE` has 32 entries and drops
index 32 (= 9)**, and `state.ts`/the TSV had the last pair as "9/13"; it is 13
for one player and 9 for two.

### 6.2 `Boss4SpawnBoneHitMark` — `FUN_004920C0`; `Boss4DrawAndAgeBoneHitMark` — `FUN_00492210` `[proved]`

`Boss4SpawnBoneHitMark(p, bone, obj)`: `ActorAlloc(Boss4DrawAndAgeBoneHitMark,
0x19C)`, `ActorClearGameFields`, a 12-byte sub (`ActorAllocRaw(0xC)`, linked by
`FUN_004A7260`) at `+0x198` = {`char+0xA0+bone*0x90` (the bone's matrix), 0x78,
obj}. With the camera block × bone matrix inverted (`MatrixInvert(0)`), the hit
point `0x009A2C40+p*0x1C` goes to `+0x40..+0x48` and the hit normal
(`+0x10..+0x18` of the record) through `MatrixTransformVector` and `VecToAngles`
to `+0x64`, `+0x68`.

The update: `SetTop(*sub)`, `Translate(+0x40)`, `RotY(+0x68)`, `RotX(+0x64)`;
life < 0x3C → `s = life * [0x0055CB80]` (1/60), `MatrixScale(s,s,s)` and
`NoOpStub(s)`; `AssetDrawSlot(0x3CD)` (`boss4.bin[7]`); pop; if the boss is not
dead: `--life == 0` → `ActorKill`. Render-side in the port (a decal on a bone),
but the lifetime is game state.

### 6.3 `Boss4AdjustRank` — `FUN_004934D0` `[proved]`

```
if (g_players_in_play == 1) {
    if (st+0x0C >= 2) { st.rank++; st+0x0C = 0 }
    p = g_active_player (0x009C7000)
    if ((s8)st[0x0D+p] != g_player_lives[p]) {          -- s16 at 0x009A5C66 + p*0x130
        if ((s8)st[0x0D+p] > lives) { st.rank -= 3; st+0x0C = 0 }
        st[0x0D+p] = (u8)lives
    }
} else {
    if (st+0x0C >= 3) { st.rank++; st+0x0C = 0 }
    for p in 0,1: same test and snapshot for each
}
clamp st.rank to 0..15
```

The rank starts at `GetDamageRank()` (`g_damage_rank`, `G.g_damage_rank`) and
indexes the head damage and the attack picks.

### 6.4 How the boss hurts the player

Every connecting attack is `PlayerTakeDamage(player, 1, motion)` (`FUN_00415300`,
ported in `combat/player.ts`): **one life each**, -100 score, 90 frames of
invulnerability. `player` is `(s8)obj+0x121`, written by `ActorPickTargetPlayer`
(`FUN_00426170`) when an attack is committed.

| attack | state | clip | connects | motion | gate |
|---|---|---|---|---|---|
| strike | 0xF | `0x65` | cursor `0x37` | 8 | not while st flag 8 |
| strike | 0x10 | `0x7A` | cursor `0x30` | 8 | not while st flag 8 |
| strike | 0x11 | `0x7B` | cursor `0x26` | 8 | not while st flag 8 — **unreachable**, §7.2 |
| charge | 0x13 | `0x70` | cursor `0x47` | 8 | none |
| thrown prop | 0x12 → `CarriedPropThrowAtCamera` | `0x67`/`0x68` | the prop reaching view z >= -15.0 | **1** (type 2; the drums pass 7) | the prop not shot down (1 hp) |

## 7. The arena: how the fight progresses

The fight is nine **phases** per arena — 0..8 for entrances 0/2 (camera path
185), 9..17 for entrances 1/3 (path 193). A phase ends when the hit points
reach its floor; then **the boss plays a camera move itself** and, when the
camera frame passes the phase's threshold, is seated at the next spot.

### 7.1 Floors — `g_boss4_phase_hp_fraction` (`0x00570490`)

`frac[phase]` = 8/9, 7/9 … 1/9, 0 for phases 0..8 and again for 9..17.
`st+0x24 = maxhp * frac[phase]`. The frame the hit points reach it,
`Boss4ResolveShot` raises `obj+0x34` bit `0x100` and every later shot does
nothing until `Boss4ArmPhaseWhenInsideArena` clears it. Damage is not clamped
to the floor: a hit that crosses it keeps its excess.

### 7.2 `Boss4AdvancePhaseAtFloor` — `FUN_00492790` `[proved]`

```
if (g_screen_shake_frames != 0) return
if (st+0x1C != 0.0) return          -- a cue is running
if (st.flags & 0x80) return         -- a cue is queued
switch (table 0x004928B4[phase+1], jumps 0x004928A8) -- phase > 17 or 0xFF -> default
  phases 3, 8, 13, 17 (and -1): return
  phase 16: if (hp > maxhp*frac[16]) return
            if (ftol(st+0x14) != [0x00570636]) return      -- 1220, cue 21's end frame
            phase++; Boss4QueueCameraCue(phase); st.flags |= 8
  others:   if (hp > maxhp*frac[phase]) return
            obj.flags |= 0x10000
            phase++; Boss4QueueCameraCue(phase); st.flags |= 8
```

(The hp test is `FILD hp; FILD maxhp; FMUL frac; FCOMPP; TEST AH,1; JNZ
return` — it returns when `floor < hp`.)

Phases 3 and 13 advance through ChooseAction (the throw phases, §8.5); 8 and
17 are the last (floor 0: the boss dies).

### 7.3 Camera cues — `Boss4QueueCameraCue` `FUN_004932A0`, `Boss4PlayCameraCue` `FUN_00493090` `[proved]`

`Boss4QueueCameraCue(cue)`: `st+0x22 = (s16)cue; st.flags |= 0x80`.

`g_boss4_camera_cues` (`0x00570538`, 22 × 12 bytes: s16 start, s16 end, f32
step, s16 path, s16 pad):

| cue | start | end | step | path | | cue | start | end | step | path |
|---|---|---|---|---|---|---|---|---|---|---|
| 0 | 0 | 220 | 0.70 | 185 | | 11 | 211 | 388 | 0.60 | 193 |
| 1 | 231 | 350 | 0.55 | 185 | | 12 | 451 | 590 | 0.50 | 193 |
| 2 | 361 | 560 | 0.73 | 185 | | 13 | 601 | 670 | 0.40 | 193 |
| 3 | 571 | 680 | 0.55 | 185 | | 14 | 681 | 850 | 0.75 | 193 |
| 4 | 721 | 750 | 0.40 | 185 | | 15 | 861 | 1030 | 0.60 | 193 |
| 5 | 751 | 860 | 0.40 | 185 | | 16 | 1041 | 1180 | 0.60 | 193 |
| 6 | 881 | 1020 | 0.50 | 185 | | 17 | 1221 | 1310 | 0.50 | 193 |
| 7 | 1031 | 1175 | 0.60 | 185 | | 18 | 861 | 880 | 0.50 | 185 |
| 8 | 1211 | 1310 | 0.60 | 185 | | 19 | 1176 | 1210 | 0.60 | 185 |
| 9 | 0 | 100 | 0.50 | 193 | | 20 | 389 | 440 | 0.45 | 193 |
| 10 | 111 | 200 | 0.50 | 193 | | 21 | 1181 | 1220 | 0.45 | 193 |

(steps are the f32s `0x3F333333` 0.7, `0x3F0CCCCD` 0.55, `0x3F3AE148` 0.73,
`0x3ECCCCCD` 0.4, `0x3F000000` 0.5, `0x3F19999A` 0.6, `0x3F400000` 0.75,
`0x3EE66666` 0.45.)

`Boss4PlayCameraCue()`:

```
if (st+0x1C == 0.0 && (s16)st+0x22 >= 0) {             -- start
    rec = &cues[st+0x22]
    unless st+0x22 in {5, 7, 11, 16}: st.flags &= ~0x80     -- bytes 0x0049328C[cue-5], jumps 0x00493284
    st+0x22 = -1
    st+0x14 = (float)rec.start; st+0x18 = (float)rec.end; st+0x1C = rec.step; st+0x20 = rec.path
    g_stashed_path_frame (0x009C70AC) = rec.start                        00493138
    g_stashed_path_end_frame (0x009C70B0) = rec.end                      00493148
    [0x009CA094] = 1                                                     0049314e
}
if (st+0x1C != 0.0) {                                   -- run
    [0x009C70BC] = st+0x14
    CamEvalPath7((s16)st+0x20, st+0x14, &g_camera_block_eye, &target, ...)   -- 0x009A60C0
    g_stashed_path_frame = ftol(st+0x14)
    if (st+0x14 >= st+0x18) { st+0x1C = 0.0; [0x009CA094] = 0 } else st+0x14 += st+0x1C
    SelectCameraLookAtTarget()
    TurnLookAtToward(&eye, &g_camera_block_target, &g_camera_lookat_target, 1, 0x10) -> g_camera_block_target
    CamBlockSetAnglesFromLookAt(&g_camera_block_eye, &g_camera_block_target, 0)
}
```

Cues 5, 7, 11 and 16 keep flag `0x80` up **after** they start, so
`Boss4AdvancePhaseAtFloor` stays blocked through the next phase's cue as well
(`[likely]` deliberate: those are the phases that end in a charge).

**This is the frame the arena reads, and the boss drives it through the
script's own camera.** The script's camera for the fight is `cam_play 185
0..0` (static: it stashes path 185, or 193 in block 25, with a zero-length
range) followed by `finish_sequence 6` — scene state (2,6) `[proved]` (stage 4
block 23 step 1). That installs two things, and both run for the whole fight:

* the **camera update hook** `CameraStepDeferredRailWithFrameExport`
  (`g_scene_state_table[2][6]` = `CameraInstallDeferredRail`), whose body
  `CameraStepRailTick` (`FUN_0040C790`) is `[proved]`:
  ```
  if (g_stashed_path_frame < g_stashed_path_end_frame) {             0040c79e
      if ([0x009CA098] == 1 || IsDemoRun() || (g_screen_shake_frames == 0 && g_players_in_play != 0))
          g_stashed_path_frame++                                      0040c7cb
      [0x009C70BC] = (float)g_stashed_path_frame                      0040c7e5
      CamEvalPath7(g_active_cam_path, [0x009C70BC], &[0x009C70C0], &g_cam_path_target, ...)
      CamBlockSetAnglesFromLookAt(&[0x009C70C0], &g_cam_path_target, roll)
      g_camera_eye_x/_y/_z = the evaluated eye (y = g_camera_fixed_eye_y when g_camera_use_fixed_y == 1,
                             else eye.y - [0x004C4398]); g_camera_yaw_bams = yaw + 0x8000; pitch = roll = 0
  }
  g_cam_path_frames_left = g_stashed_path_end_frame - g_stashed_path_frame   0040c88f
  ```
* the **evt action handler** `CameraDriverSelectMode` (`FUN_00402650`,
  `g_camera_action_starters[6]`), which forces camera mode 6 (`PoseHookNone`)
  while `[0x009CA094] == 1` (`0x004026AB`) and, after the mode hook, stores
  `g_cam_path_frame = ftol([0x009C70BC])` (`0x004026F7..0x00402705`) every
  frame.

So `Boss4PlayCameraCue` sets the stashed range to the cue's `[start, end]` and
then re-seats `g_stashed_path_frame` at its own fractional frame every frame;
the rail tick adds at most one frame and publishes; `CameraDriverSelectMode`
turns `[0x009C70BC]` into `g_cam_path_frame`. With every step at or below 1.0
no integer frame is skipped, so the exact-equality cues (the chainsaw, the
charge, the despawn) all fire. **The rail tick writes `g_camera_eye_x/_z`**,
the eye every distance and turn-to-camera test in this class reads; the
boss's own `CamEvalPath7` writes `g_camera_block_eye` and, through
`TurnLookAtToward`, `g_camera_block_target` (the rendered view). Between
cues the stashed frame sits at the last cue's end, the rail tick does nothing
and both eyes stay where the cue left them. `g_active_cam_path` stays 185 or
193 throughout.

**In the port** the (2,6) install is the walker's (`finish_sequence` in
`script/state/camera_action.ts`), and it had refused to install over no stash;
the boss blocks' `cam_play 185 0..0` is a static pose, not a stash
(`EvtActionCamPlay40` tests `start == end` first), so the rail never ran and
`g_cam_path_frame` stayed 0. Fixed in phase 2: with nothing stashed the
install rides the current shot's path over the stash words as they stand.

`[open]` whether `[0x009C70BC]` is last written by the boss or by the rail
tick in a given frame — the task order of the camera tick, the evt task and the
boss (which the evt task spawned, so runs after it) was not read. The
difference is one frame of `g_cam_path_frame`; the transcription does not
depend on it, but a frame-exact comparison would.

### 7.4 `Boss4AdvanceArenaWaypoint` — `FUN_004928D0` `[proved]`

Runs only while st flag 8 is up. Switch on `phase - 1` (jump table
`0x0049304C`, 17 entries; phase 0 and 0xFF fall out). `f` is
`g_cam_path_frame`; "ahead(x, z)" is `ActorPointIsAhead(obj+0x64, obj+0x40,
&{x, pos.y, z})`; "below: state 7 or 4 → 5 when ahead(x, z)" means: when
`f` is under the threshold and the state is 7 or 4, set state 5 sub 0 if the
point is ahead, otherwise do nothing (**no turn happens here**; the existing
TSV said it turned).

| phase | at `f >=` | seat (pos.x, pos.z), yaw `obj+0x68` | clip | next state | tail | below |
|---|---|---|---|---|---|---|
| 1 | `0x104` 260 | if ahead(205, -1620): keep pos, blend `0x6B` (0, 10) unless playing; else pos = (205, -1620), yaw `0xC000`, `ActorSetMotion(0x6B)` | | 7 | A | — |
| 2 | `0x1CC` 460 | (255, -1700), `0xC000` | | 8 | B | — |
| 3 | `0x258` 600 | (420, -1685), `0xC000` | blend `0x6B` (0, **2**) unless playing | 7 | A | ahead(420, -1685) |
| 4 | `0x2A9` 681 | (555, -1860), `0x400` | `ActorSetMotion(0x6B)` | 7 | A | — |
| 5 | `0x316` 790 | (425, -1970), `0x2000` | | 0x13; `st+0x74` = 820, `st+0x78` = 810 | A | ahead(470, -1925) |
| 6 | `0x3CA` 970 | (350, -1990), `0x2800` | | 8 | B | ahead(370, -2065) |
| 7 | `0x42E` 1070 | (175, -1918), `0x4000` | | 0x13; 1130, 1110 | A | ahead(240, -2035) |
| 8 | `0x4E2` 1250 | (65, -1930), `0x5000` | blend `0x6D` (0, 5) unless playing | 7 | A | ahead(60, -1920) |
| 9 | — | nothing | | | | |
| 10 | `0x8C` 140 | as phase 1 with (-390, -1605), yaw `0x4000` | | 7 | A | — |
| 11 | `0xFA` 250 | (-440, -1730), `0xBB00` | | 0x13; 340, 310 | A | ahead(-460, -1760) |
| 12 | `0x212` 530 | (-270, -1785), `0xDC00` | | 8 | B | — |
| 13 | `0x26C` 620 | no seat | blend `0x6B` (0, 5) unless playing | 9; `st+0x74` = 0xA, `st+0x84` = pos.x, `st+0x88` = -1930.0 | A | ahead(-195, -1915) |
| 14 | `0x30C` 780 | (-270, -2080), `0x4000` | `ActorSetMotionBlended(0x6B, 10, 0)` — start frame 10, no fade | 7 | E | — |
| 15 | `0x3D4` 980 | (-360, -2080), `0x3800` | | 8 | B | ahead(-450, -2095) |
| 16 | `0x442` 1090 | (-485, -1948), `0x5800` | | 0x13; 1140, 1120 | A | ahead(-450, -2095) |
| 17 | always | if state < 0xF: blend `0x6D` (0, 10) | | 7 | A | — |

Seating writes `pos.x`/`pos.z` only (y is untouched) and always `sub = 0`.
The floats are the immediates `434D0000` 205, `C4CA8000` -1620, `437F0000` 255,
`C4D48000` -1700, `43D20000` 420, `C4D2A000` -1685, `440AC000` 555, `C4E88000`
-1860, `43D48000` 425, `C4F64000` -1970, `43EB0000` 470, `C4F0A000` -1925,
`43AF0000` 350, `C4F8C000` -1990, `43B90000` 370, `C5011000` -2065, `432F0000`
175, `C4EFC000` -1918, `43700000` 240, `C4FE6000` -2035, `42820000` 65,
`C4F14000` -1930, `42700000` 60, `C4F00000` -1920, `C3C30000` -390, `C4C8A000`
-1605, `C3DC0000` -440, `C4D84000` -1730, `C3E60000` -460, `C4DC0000` -1760,
`C3870000` -270, `C4DF2000` -1785, `C3430000` -195, `C4EF6000` -1915,
`C5020000` -2080, `C3B40000` -360, `C3E10000` -450, `C502F000` -2095,
`C3F28000` -485, `C4F38000` -1948.

Tails: **A** (`0x00492CC4`, and the same code at `0x00492F86`/`0x0049301D`):
`st.flags &= ~8; st.flags &= ~2; obj.flags &= 0xBFFFDFFF;
Boss4LoadPhaseArena()`. **B** (`0x00492EF0`): A, then `obj.flags &= ~0x10000`.
**E** (phase 14, `0x00492E7F`): A, then `obj.flags &= 0xFFFEBFFF`.

### 7.5 `Boss4LoadPhaseArena` — `FUN_004932C0` `[proved]`

For i in 0..5: `st+0x28+i*0xC = g_boss4_phase_arenas[phase*6+i].x`,
`st+0x2C+i*0xC = obj+0x44`, `st+0x30+i*0xC = .z`; then `st.flags |= 0x60`.
`g_boss4_phase_arenas` (`0x00570640`, 18 × 6 × (f32 x, f32 z)):

| ph | P0 | P1 | P2 | P3 | P4 | P5 |
|---|---|---|---|---|---|---|
| 0 | -300,-1625 | 190,-1625 | 230,-1650 | -195,-1650 | -195,-1600 | 230,-1600 |
| 1 | 265,-1550 | 265,-1750 | 240,-1775 | 240,-1600 | 290,-1600 | 290,-1775 |
| 2 | 200,-1700 | 410,-1700 | 430,-1725 | 310,-1725 | 310,-1675 | 430,-1675 |
| 3 | 475,-1600 | 475,-1740 | 450,-1900 | 450,-1675 | 500,-1675 | 500,-1900 |
| 4 | 750,-1925 | 490,-1925 | 465,-1900 | 680,-1900 | 680,-1950 | 465,-1950 |
| 5 | 370,-1900 | 370,-2040 | 330,-2070 | 330,-1955 | 410,-1955 | 410,-2070 |
| 6 | 400,-2035 | 250,-2035 | 230,-2010 | 310,-2010 | 310,-2060 | 230,-2060 |
| 7 | 200,-1922.5 | 80,-1922.5 | 60,-1897.5 | 155,-1897.5 | 155,-1947.5 | 60,-1947.5 |
| 8 | -100,-1820 | 120,-1820 | 145,-1845 | -25,-1845 | -25,-1795 | 145,-1795 |
| 9 | -100,-1625 | -395,-1625 | -410,-1600 | -185,-1600 | -185,-1650 | -410,-1650 |
| 10 | -460,-1600 | -460,-1745 | -480,-1765 | -480,-1600 | -440,-1600 | -440,-1765 |
| 11 | -500,-1720 | -300,-1720 | -280,-1740 | -420,-1740 | -420,-1700 | -280,-1700 |
| 12 | -195,-1600 | -195,-1885 | -215,-1905 | -215,-1700 | -175,-1700 | -175,-1905 |
| 13 | -100,-1940 | -185,-1940 | -300,-1920 | -170,-1920 | -170,-1960 | -300,-1960 |
| 14 | -345,-1900 | -345,-2160 | -365,-2180 | -365,-1920 | -325,-1920 | -325,-2180 |
| 15 | -300,-2095 | -435,-2095 | -460,-2075 | -380,-2075 | -380,-2115 | -460,-2115 |
| 16 | -515,-2100 | -515,-1870 | -495,-1850 | -495,-2050 | -535,-2050 | -535,-1850 |
| 17 | -515,-2100 | -515,-1680 | -495,-1650 | -495,-2050 | -535,-2050 | -535,-1650 |

P0 is a facing point (ChooseAction, Withdraw and the flinch turn by
`P0 - pos`), P1 the point `Boss4StateFaceCamera` tests, P2..P5 the quad.

### 7.6 `Boss4KeepInsideEdge` — `FUN_00493330` `[proved]`

`Boss4KeepInsideEdge(pos, a, b, margin, push)`, all in x/z:

```
px = pos.x - a.x; pz = pos.z - a.z; bx = b.x - a.x; bz = b.z - a.z
t = (bx*px + bz*pz) / (bx*bx + bz*bz)
ex = t*bx - px; ez = t*bz - pz; d = sqrt(ex*ex + ez*ez)     -- to the foot on the line
if (d == 0.0) {
    if (margin == 0.0) return 1
    if (!push) return 0
    if (bz != 0) pos.x += sign(bz)*margin     -- FLD bz; *-1.0 when negative; bz/|bz|*margin
    if (bx != 0) pos.z -= sign(bx)*margin     -- FSUBR
    return 0
}
if (bz*px - bx*pz < 0.0) {                    -- outside
    if (push) { pos.x += ex*(d+margin)/d; pos.z += ez*(d+margin)/d }
    return 0
}
if (d < margin) {                             -- inside, but too close
    if (push) { pos.x += ex*(d-margin)/d; pos.z += ez*(d-margin)/d }
    return 0
}
return 1
```

Constants: `0.0` at `0x004C436C`, `-1.0` at `0x004C4C64`. It is
`Class14FollowSegment`'s algorithm with a push flag (class 14's port has it
without one); the port should give class 0x19 its own copy under this name,
because the exe has two functions.

### 7.7 The two arm-when-inside checks `[proved]`

`Boss4ArmPhaseWhenInsideArena` (`FUN_00492350`):

```
if (!(st.flags & 0x40)) return
if (!(st.flags & 2)) {
    if (!Boss4KeepInsideEdge(pos, P2, P3, 5.0, 0)) return
    if (!Boss4KeepInsideEdge(pos, P3, P4, 5.0, 0)) return
    if (!Boss4KeepInsideEdge(pos, P4, P5, 5.0, 0)) return
    obj.flags &= ~0x100; st+0x24 = maxhp * frac[phase]; st.flags |= 2; st.flags &= ~0x40; return
}
obj.flags &= ~0x100; st+0x24 = maxhp * frac[phase]; st.flags &= ~0x40
```

`Boss4TrackWhenInsideArena` (`FUN_004922C0`):

```
if (!(st.flags & 0x20)) return
if (!(obj.flags & 0x10000)) { st.flags &= ~0x20; return }
if (st.flags & 8) return
if (st.state == 0x13) return
if (!Boss4KeepInsideEdge(pos, P2, P3, 0.0, 0)) return
if (!Boss4KeepInsideEdge(pos, P4, P5, 0.0, 0)) return
obj.flags &= ~0x10000; st.flags &= ~0x20
```

So after a seat: the boss is **damageable again** once he is 5 inside three of
the new quad's edges, **tracked by the camera again** once he is inside two of
them, and **fenced** from then on.

### 7.8 Chainsaw and footfalls `[proved]`

`Boss4ChainsawCueByCameraFrame` (`FUN_004935E0`) on exact `g_cam_path_frame`
values, only on paths 185/193:

* path 185: **off** at 395, 785, 930, 1075, 1235; **on** at 460, 810, 960,
  1110, 1280 (the last four through byte table `0x00493798` from 1075, jumps
  `0x0049378C`);
* path 193: off at 240, 500, 700, 900, 1070; on at 310, 520, 760, 960, 1120
  (byte table `0x004936AC` from 900, jumps `0x004936A0`).

`Boss4ChainsawOn` (`FUN_00493870`): unless flag `0x400`, `flags |= 0x410`,
`PlaySoundId(0x4D17A9)`. `Boss4ChainsawOff` (`FUN_00493890`): if `0x400`,
`flags &= ~0x410`, `PlaySoundId(0x4E17A9)`.

`Boss4FootfallShake` (`FUN_00492460`), on flag `0x10`:

```
shake = 0
yA = world Y of bone 15 (camera block × char+0x910); yB = bone 12 (char+0x760)
if (flags & 0x100) { if (yA < 45.0 [0x005308DC]) { flags &= ~0x100; shake = 5 } }
else if (yA > 47.0 [0x00570A4C]) flags |= 0x100
same for yB with 0x200
if (shake) {
    d = |pos - (g_camera_eye_x, g_camera_eye_z)|
    if (d <= 50.0 [0x0055D2AC]) shake = 15
    else if (d < 150.0 [0x00570A48]) shake = ftol((150.0 - d) * 0.1 [0x0055D230] + 5)
    if (g_screen_shake_frames < shake) g_screen_shake_frames = shake
    PlaySoundId(0x151BA9)
}
```

### 7.9 `Boss4AdvanceMotionAndDrawHeldProps` — `FUN_00492620` `[proved]`

```
LightsUseSecondarySet()
if (st.flags & 1) { Push; Translate(carrier+0x40); RotX(c+0x64); RotZ(c+0x6C); RotY(c+0x68);
                    DrawSkinnedModelAndShadow(char, obj+0x40, char+0x78); Pop }
else DrawSkinnedModelAndShadow(char, obj+0x40, char+0x78)
if (!(obj.flags & 0x4000)) char+0x00++                  -- the frame counter
if (st.flags & 4) { char+0x348++; if > 0x447 -> 0x444 } -- never: nothing sets 4
Push
for i in 0,1 (records at 0x005704F8 + i*0x20):
    if (st+0x0A & (1<<i)) continue
    SetTop(char + rec.bone*0x90 + 0xA0); Translate(rec.x, rec.y, rec.z)
    RotZ(rec.rz); RotY(rec.ry); RotX(rec.rx); AssetDrawSlot(0x396)
Pop; LightsRestoreScene()
```

Root motion happens inside the draw (`SkeletonApplyRootMotion` from
`SkeletonDrawWalk`, `model+0x64` bit 1 set by `ActorBuildSkinnedModel`), so the
boss's walking is the clips' root motion — no state writes a velocity except
the knock-down. The port's generic `ActorAdvanceMotion` stands in for the
motion half; the carrier transform while riding and the two held props are
the class's own.

The held-prop records (`g_boss4_held_props`, `0x005704F8`), 0x20 bytes each:

| rec | offset (f32) | rx, ry, rz | bone | clip | take | throw |
|---|---|---|---|---|---|---|
| 0 | 4.46897, -7.17477, 1.97047 | 30229, 53341, 38188 | 13 | `0x67` | 20 | 68 |
| 1 | -4.05353, 6.64823, 3.68815 | 40704, 62912, 32411 | 1 | `0x68` | 20 | 68 |

## 8. The states

`g_class19_states` (`0x00597298`) read from memory `[proved]`:
`004938B0 00493B40 004938B0 00493B40 00493DC0 00494010 004943B0 004944A0
004945A0 00494610 00494730 004958F0 00495A20 00495D30 00495D90 00494A80
00494B80 00494C70 00494D60 00495070 00495340 00495570 00495770 00495E20` —
all 24 agree with `Boss4State`; the next dword is `g_boss4_intro_banners`.

"blend(c, s, f)" is `ActorSetMotionBlended(char, c, s, f)` (`FUN_004119A0`);
"set(c)" is `ActorSetMotion(char, c)` (`FUN_00411930`); "last frame" is
`char+0x08 == g_motion_play_length[char+0x20] - 1`; "unless playing" is
`char+0x20 != c`. `eye` is `(g_camera_eye_x, g_camera_eye_z)` (`0x009C71E0`,
`0x009C71E8`); "turn(off, 0x200)" is
`ActorTurnTowardXZ(obj+0x40, off.x, off.z, 0x200)` (`FUN_00426120`) and
`err(off)` is `ActorHeadingErrorTo(obj+0x40, off.x, off.z)` (`FUN_00426090`).

**Sign convention, read not guessed:** `ActorHeadingErrorTo` returns
`atan2(local.x, local.z)` of the offset after `RotY(-yaw) RotZ(-roll)
RotX(-pitch)`, and `ActorTurnTowardXZ` adds it (clamped to the step) to the
yaw, so the turn drives the offset onto local **+z**. Every call in this class
passes `pos - target` **except** ChooseAction, Withdraw sub 2 and the flinch's
non-camera arm, which pass `P0 - pos`. That is the exe; the port must keep both
signs. `ActorPointIsAhead` tests local z > 0 in the same frame.

### 8.1 States 0–3: the entrances — **ported; verified**

`Boss4StateEntranceCarried` (`FUN_004938B0`, 0 and 2) and
`Boss4StateEntranceDropped` (`FUN_00493B40`, 1 and 3) differ in exactly three
constants (banner `0x005972F8`/`0x00597338`, phase 0/9, "standing" state 2/3)
`[proved]`. Against `entrance.ts`:

* sub 0 — as ported. The port's `Boss4EntranceHold` is **`Boss4ChainsawOn`**
  (`0x00493AF5`, `0x00493D81`): flags `|= 0x410` and the chainsaw sound; the
  standing arm then clears `0x10` (`0x00493B01`).
* sub 1 — also calls `Boss4ChainsawOn` first (`0x00493989`), then `flags &=
  ~1`, then the carrier compose. **The rotation order is X, Z, Y**
  (`MatrixRotateX`, `MatrixRotateZ` `0x004A9BD0`, `MatrixRotateY`), for the
  carrier and then the boss, after `MatrixLoadIdentity`; the translation is
  read back with `MatrixGetTranslation` into `obj+0x40` and the angles with
  `MatrixToEulerBams` (`FUN_00401AE0`) into `+0x64/+0x68/+0x6C`. Then blend
  `0x75` (0, 10) and `PlaySoundId(0x231BA9)` (`BOSS4_HASHIRI1`).
* sub 2 — as ported, plus the five calls the port skips, in order after the
  flag write: `Boss4QueueCameraCue(phase)` (`0x00493916`), `obj.flags &=
  ~0x8000`, `Boss4LoadPhaseArena()` (`0x00493928`), **`BossHpBarSpawn(320.0,
  35.0)`** (`0x00493937`: `PUSH 0x420C0000; PUSH 0x43A00000`, so x = 320.0,
  y = 35.0; `0x00493BC5` in the twin), `flags |= 0x12`, state 7, blend `0x6B`
  (0, `0x16`), `[0x009CA0EA] = 1`.

`[0x009CA0EA]` has seventeen writes across the boss code (classes 0x14, 0x22,
0x2D, 0x32, the `Boss3*` routines and this class's entrances and death) and two
reads, both in `BossModeChapterCardUpdate` `[proved]` (xrefs). `[likely]` a
"boss fight in progress" byte; unnamed, and not this class's to name.

**The carrier.** In blocks 23 and 25 the boss is spawned in the same
`spawn_obj_c` as a class-0x13 prop at evt `0x8C10` (slot 2383 =
`st1_1b.bin[1]`, behaviour 8, selector 2) that `CarrierPropSelectRoutine` makes
`g_civilian_carrier`; the boss's spawn position `(-5, -27.5, -5)` / `(5, -27.5,
-10)` is relative to it. Selector 2's routine is `FUN_004408A0` `[proved]`: it
rides `op_` path `0x175` by `PropSeatOnObjectPath` over camera frames 190..360
(sound `0xB16A9` at 350), then on paths `0xB4`/`0xBC` at frame >= 250 plays
`0x2316A9` (`DOORKICK3_22K`) and swings two door angles over 59 frames from the
table at `0x005926D0`; selector 9 (blocks 27/29) seats it at frame 360 already
open. Ported in phase 2 as `CarrierPropRoutine2`
(`web/src/game/class13/routine2.ts`) for selectors 2 and 9, doors drawn by
`render/slotmodels.ts`.

### 8.2 State 4 — `Boss4StateApproachCamera` `FUN_00493DC0` `[proved]`

```
sub 0: Boss4PickApproachAttack(obj)
       switch (table 0x00493F20[phase-2], jumps 0x00493F10; phase < 2 or > 17 -> default)
         phase 2:        unless playing 0x78: blend(0x78, 0, 10)
         phases 3, 13:   unless playing 0x6B: blend(0x6B, 0, 10)
         phases 8, 17:   unless playing 0x6D: blend(0x6D, 0, 3)
         default:        (rand() & 1) ? (unless 0x78: blend(0x78,0,10)) : (unless 0x6B: blend(0x6B,0,10))
       sub = 1   -- and falls into sub 1
sub 1: if (!(st.flags & 8)) turn(pos - eye, 0x200)
       if (|pos - eye| < st+0x84) { st.state = (u8)st+0x74; st.sub = 0; ActorPickTargetPlayer(obj) }
```

### 8.3 `Boss4PickApproachAttack` `FUN_00493F30` `[proved]`

```
if (phase == 3 || phase == 13) { st+0x74 = 0x12; st+0x84 = 180.0 (0x43340000); return }
if (obj.flags & 0x100)          { st+0x74 = 0xF;  st+0x84 = 50.0 (0x42480000); return }
k = (s8)g_boss4_approach_picks[st.rank*9 + rand() % 9]
if (st.state == 7 && k == 0) k = 1
k == 0: (0xF, 50.0);  k == 1: (0x10, 70.0 0x428C0000);  k == 2: (0x11, 70.0);  else nothing
```

`g_boss4_approach_picks` (`0x005709B4`), per rank the count of 0s then 1s:
ranks 0–1: 7/2; 2: 6/3; 3–4: 5/4; 5–6: 4/5; 7: 3/6; 8–9: 2/7; 10–11: 1/8;
12–15: 0/9. **No entry is 2**, so state 0x11 (clip `0x7B`) is never chosen
`[proved]`; the port should still carry it, since the table is data.

### 8.4 State 5 — `Boss4StateChooseAction` `FUN_00494010` `[proved]`

```
sub 0: phases 8, 17: unless 0x6E: blend(0x6E, 0, 3);  else unless 0x6C: blend(0x6C, 0, 10);  sub = 1 (falls in)
sub 1: turn(P0 - pos, 0x200)                               -- the opposite sign
       d = |pos - eye|
       switch (table 0x0049439C[phase-3], jumps 0x0049438C; else default)
       phase 3:  if (hp > floor && st+0x09 != 0) { if (d > 180.0 [0x00570A5C]) { state 4; sub 0 } return }
                 if (d <= 210.0 [0x005691C4]) return
                 if (players == 0 || (players == 1 && g_attack_permits[g_active_player] != 0
                                      && g_player_lives[g_active_player] == 1)) { state 0xE; sub 0; return }
                 state 9; sub 0; st+0x74 = 0xB; st+0x84 = 530.0 (0x44048000); st+0x88 = -1720.0 (0xC4D70000)
                 phase++; st.flags &= ~2; obj.flags |= 0x100
       phase 13: if (hp > floor && st+0x09 != 0) { if (d > 155.0 [0x00570A54]) { state 4; sub 0 } return }
                 (no distance test)  the same players test -> state 0xE;  else state 0xC; sub 0
       phases 8, 17: if (d > 120.0 [0x00570A58]) { state 6; sub 0; st+0x74 = 1 }
       default:  if (st.flags & 8) return;  if (d > 90.0 [0x00570A50]) { state 6; sub 0; st+0x74 = 1 }
```

"floor" is `maxhp * frac[phase]`; "players" is `g_players_in_play`.

### 8.5 State 6 — `Boss4StateHoldThenApproach` `FUN_004943B0` `[proved]`

```
sub 0: phases 8, 17: unless 0x7D blend(0x7D, 0, 3); unless flag 8 PlaySoundId(0x271BA9) BOSS4_YARARE3
       else:         unless 0x7C blend(0x7C, 0, 10); unless flag 8 PlaySoundId(0x231BA9) BOSS4_HASHIRI1
       st+0x74--; sub = 1; return
sub 1: if (cursor != len-1) return
       if (st+0x74 != 0) { st+0x74--; return }
       if (g_players_in_play <= 0) return;  if (st.flags & 8) return
       state 4; sub 0
```

### 8.6 State 7 — `Boss4StateFaceCamera` `FUN_004944A0` `[proved]` (a facing test, not a range)

```
if (!(st.flags & 8) && !(char+0x37 & 1)) turn(pos - eye, 0x100)
if (obj.flags & 0x10000) return
if (|err(pos - eye)| >= 0x800) return
if (!ActorPointIsAhead(obj+0x64, obj+0x40, P1)) return        -- st+0x34
Boss4PickApproachAttack(obj); state 4; sub 1
```

### 8.7 State 8 — `Boss4StatePlayArrivalClip` `FUN_004945A0` `[proved]`

`sub 0: set(0x72); sub 1.` `sub 1: if (cursor == len) — exactly the length, not
len-1 — { blend(0x78, 0, 10); state 7; sub 0 }`. (Class 14's port reaches
`cursor == len` too, `AtClipEnd(obj, 0)`.)

### 8.8 State 9 — `Boss4StateTurnToStoredPoint` `FUN_00494610` `[proved]`

```
sub 0: unless 0x78 blend(0x78, 0, 10); sub 1 (falls in)
sub 1: q = (st+0x84, pos.y, st+0x88)
       turn(pos - q, 0x200)
       if (|err(pos - q)| > 0x7000 && ActorPointIsAhead(obj+0x64, obj+0x40, &q))
           { state = (u8)st+0x74; sub 0 }
```

`[open]` how often the exit fires: the turn drives `err` towards 0, so it
passes only while the boss still has the point nearly behind him (by the
convention above). Transcribe it as it is.

### 8.9 State 0xA — `Boss4StateTurnClipThenApproach` `FUN_00494730` `[proved]`

```
sub 0: unless 0x76 blend(0x76, 0, 10); sub 1
sub 1: if (cursor != len-1) return
       char+0x20 = 0x6B; char+0x08 = 0                 -- written directly, no ActorSetMotion
       f  = MotionFrameAddress(char type, 0x6B, 0)     -- FUN_00412F50(type, motion, cursor/2)
       vC = (RotZ(f[+0x10]) RotY(f[+0x0E]) RotX(f[+0x0C]) RotZ(f[+0x16]) RotY(f[+0x14]) RotX(f[+0x12])) * (0,0,1)
       vP = (RotZ(char+0x84) RotY(+0x80) RotX(+0x7C) RotZ(+0x114) RotY(+0x110) RotX(+0x10C)) * (0,0,1)
       A = ftol(atan2(vP.x, vP.z) * k);  B = ftol(atan2(vC.x, vC.z) * k)     -- k = [0x004C4378] BAMS/rad
       obj+0x68 += A - B
       M = Identity; RotX(-r0x) RotY(-r0y) RotZ(-r0z) RotY(-(A-B)) RotZ(r0z) RotY(r0y) RotX(r0x)   -- r0 = char+0x7C..0x84
       record 1 (char+0x10C..0x114) = MatrixToEulerZYX(M * RotZ RotY RotX(record 1))
       record 9 (char+0x58C..0x594) = MatrixToEulerZYX(M * RotZ RotY RotX(record 9))
       blend(char+0x20 = 0x6B, 0, 10)
       Boss4PickApproachAttack(obj); state 4; sub 1
```

Record 0 is the model's own root record; records 1 and 9 are the skeleton's
two depth-0 nodes (bone 1 carries the head and both arm chains, bone 9 both leg
chains — `g_character_skeletons` for `0x4A`). The effect `[likely]`: the
heading the turn clip `0x76` ended on is folded into the actor's yaw, and the
two sub-trees are counter-rotated by the same amount so the pose does not jump.

### 8.10 States 0xF, 0x10, 0x11 — the strikes `[proved]`

| state | routine | clip | turn window | turn | arm | hit |
|---|---|---|---|---|---|---|
| 0xF | `FUN_00494A80` | `0x65` | cursor 0x28..0x32 | `g_max_attackers != 2`: yaw += 0x60; `== 2`: yaw += 0xC0 only when the target is player 1 | 0x32 | 0x37 |
| 0x10 | `FUN_00494B80` | `0x7A` | 0x1E..0x28, two players only | target 0: -0x60, else +0x60 | 0x2B | 0x30 |
| 0x11 | `FUN_00494C70` | `0x7B` | 0x14..0x1E, two players only | as 0x10 | 0x21 | 0x26 |

```
sub 0: blend(clip, 0, 10); sub 1 (falls in)
sub 1: the turn window
       cursor == arm:  obj.flags |= 0x2000; return
       cursor == hit:  if (!(st.flags & 8)) { PlayerTakeDamage((s8)obj+0x121, 1, 8); obj.flags &= ~0x2000 }; return
       cursor == len-1: state 5; sub 0; obj.flags &= 0xEFFFDFFF
```

**Corrected in phase 2** `[proved]` (`0x00494B43`, `0x00494C39`, `0x00494D29`):
the `&= ~0x2000` is **inside** the flag-8 test -- `TEST byte [EDX], 8; JNZ`
jumps past both the damage and the clear -- so a strike landing during an arena
transition leaves bit `0x2000` up until the clip's last frame. Sub 0's blend is
unguarded (no "unless playing"), and the turn window tests `g_max_attackers`
(`0x009C8E84`), not `g_players_in_play`.

### 8.11 State 0x12 — `Boss4StateThrowHeldProp` `FUN_00494D60` `[proved]`

```
sub 0: if (players <= 0 || (players == 1 && g_attack_permits[g_active_player] != 0))
           { state 6; sub 0; st+0x74 = 1; return }
       st+0x74 = -1; n = rand() % st+0x09 + 1
       do { st+0x74++; if (!(st+0x0A & (1 << st+0x74))) n-- } while (n)
       rec = 0x005704F8 + st+0x74 * 0x20
       blend(rec.clip, 0, 10); sub 1 (falls in)
sub 1: c = cursor
       c == rec.take (20):   Boss4SpawnHeldProp(obj); obj.flags |= 0x10002000
                             char+0x4F8 = 0x442       -- bone 8's slot (hand)
                             st+0x0A |= 1 << st+0x74; st+0x09--
       c == rec.throw-5 (63): PlaySoundId(0x1BA9) STAGE4_SE\AXE_44K.wav
       c == rec.throw (68):  prop = st+0x94; prop.sub+0x10 = 4; ActorPickTargetPlayer(prop)
                             obj.flags &= 0xEFFFDFFF; char+0x4F8 = 0x441
                             g_attack_permits[prop+0x121] = 1
       c == len-1:           state 5; sub 0
       if (rec.take < c && c < rec.throw) turn(pos - eye, 0x200)
```

(The `else if` chain is take, throw-5, throw, len-1; the turn runs after it.)

`Boss4SpawnHeldProp` (`FUN_00494F70`) `[proved]`:

```
prop = ActorAlloc(g_prop_behaviours[2] (0x00443200), 0x19C); st+0x94 = prop
ActorClearGameFields(prop); sub = ActorAllocRaw(0xE0); FUN_004A7260(prop, sub)
prop.flags |= 0x100; prop+0x198 = sub
sub+0x00 = obj; +0x04 = 0; +0x08 = 2; +0x10 = 0x0A
type = g_carried_prop_types[2] (0x005644B0)
sub+0x0C = (s16)type[+0x20 + (s16)type[+0x20]*2]   -- hp 1 -> 0x396, boss4.bin[2]
prop+0x40..0x48 = (0, 0, 2.8 0x40333333); +0x64 = 0x4000; +0x68 = +0x6C = 0
prop+0x4C = 50.0 (flight frames); +0x50 = phase 3 ? -0.055 (0xBD6147AE) : -0.04 (0xBD23D70A)
prop+0x5C = -0.0272 (0xBCDF0123); sub+0x2C = 0x1C00; sub+0x30 = sub+0x34 = 0
prop+0x124 = type[+4] (5.5); prop+0x128 = type[+8] (0.0); prop+0x11C = (s16)type[+0x20] (1)
prop+0x121 = -1; prop+0x3C = -1
```

`g_prop_behaviours[2]` (`0x00443200`, **unnamed, shared carried-prop code**)
`[proved]`: `SetTop(parent char + 0x520)` (bone 8's matrix);
`Translate(-0.5, -2.0, 0)` (`0xBF000000`, `0xC0000000`); `Translate(+0x40)`;
`RotX(+0x64) RotZ(+0x6C) RotY(+0x68)`; `AssetDrawSlot(sub+0x0C)`; if `sub+0x10
!= 0x0A` → `CarriedPropRelease(prop)`; view-space point to `+0x70`,
`RegisterForShotTest`, `CarriedPropCheckShot`. Its only direct reader is
`Boss4SpawnHeldProp`. Release in mode 4 then hands it to
`CarriedPropThrowAtCamera` (ported), which does `PlayerTakeDamage(+0x121, 1,
7)` on arrival; type 2's hit and break sounds are `BULLET_MET1/2` (metal), and
the throw sound is `AXE_44K.wav` — `[likely]` the two props are axes.

### 8.12 State 0x13 — `Boss4StateChargePastCamera` `FUN_00495070` `[proved]`

```
sub 0: set(0x70); obj.flags |= 0x4000; sub 1 (falls in)
sub 1: if (g_cam_path_frame >= st+0x74) { obj.flags &= ~0x4000; ActorPickTargetPlayer(obj); sub 2; return }
       if (g_cam_path_frame == st+0x78) obj.flags &= ~0x10000
       return
sub 2: c = cursor
       if (c == len-1) { Boss4ResumeAfterHit(); return }
       if (0x1E <= c <= 0x46) {
           q = camera block (view -> world) * (g_max_attackers == 1 ? (5.0,0,0)          -- 0x40A00000
                                            : obj+0x121 == 0 ? (2.5,0,0) : (7.5,0,0))  -- 0x40200000, 0x40F00000
           turn(pos - q, 0x200)
       }
       if (c == 0x23) st+0x70 = -15.0 (0xC1700000)
       else if (c == 0x47) { st+0x70 = 6.0; PlayerTakeDamage((s8)obj+0x121, 1, 8) }
```

### 8.13 `Boss4ResumeAfterHit` `FUN_004952A0` — **ported; add the cue** `[proved]`

No arguments. `g_players_in_play <= 0` → state 0xD sub 0. Else
`Boss4QueueCameraCue(0x12)` in phase 5, `0x13` in 7, `0x14` in 11, `0x15` in 16
(bytes `0x00495334[phase-5]`, jumps `0x00495320`), then blend `0x6B` (0, 10),
state 7, sub 0.

### 8.14 State 0x14 — `Boss4StateFlinch` `FUN_00495340` — **ported; add the turn** `[proved]`

The port's switch matches the exe (`0x00495463`, tables `0x0049553C` and
`0x0049555C` = `0 1 2 3 4 7 7 7 7 5 5 5 5 6`). What it lacks is sub 1's turn,
which runs every frame before the clip-end test:

```
if (st+0x06 != 0x13) {
    if (char+0x20 == 0x6F) turn(pos - eye, 0x200)
    else                   turn(P0 - pos, 0x200)
}
```

and `PlaySoundId(0x281BA9)` (`BOSS4_YARARE4`) in sub 0.

### 8.15 State 0x15 — `Boss4StateKnockDown` `FUN_00495570` `[proved]`

```
sub 0: st+0x70 = 6.0
       char+0x20 = 0x71; char+0x08 = 0
       ActorShiftToHoldBone1Position(obj)
       blend(0x71, 0, 10)
       d = pos - (g_camera_eye_x, _y, _z)
       pitch = ftol(atan2(d.y, sqrt(d.x²+d.z²)) * k); yaw = ftol(atan2(d.x, d.z) * k)
       obj+0x4C = sin(yaw)*cos(pitch)*0.3        (0.3 = [0x004C4D10] 0x3E99999A)
       obj+0x50 = sin(pitch)*0.3 - 2.0           ([0x004E30F0] 0x40000000)
       obj+0x54 = cos(yaw)*cos(pitch)*0.3
       obj+0x5C = -0.0544444 (0xBD5F0123)
       PlaySoundId(0x281BA9); sub 1 (falls in)
sub 1: pos += (+0x4C, +0x50, +0x54); obj+0x50 += obj+0x5C
       if (cursor == 0x19) obj.flags |= 0x4000
       if (pos.y < g_camera_fixed_eye_y) { obj.flags &= ~0x4000; pos.y = g_camera_fixed_eye_y; sub 2 }
sub 2: if (cursor == len-1) { Boss4ResumeAfterHit(); obj.flags &= ~0x40000000 }
```

`k` is the double at `0x004C4378` (BAMS per radian); the angles go back
through `[0x004C4370]` (radians per BAMS) before `FSIN`/`FCOS`.

### 8.16 State 0x16 — `Boss4StateDeath` `FUN_00495770` — **ported; verified** `[proved]`

As `death.ts` has it, with the missing pieces: sub 0 `PlaySoundId(0x241BA9)`
and `[0x009CA0EA] = 0`; frame `0x46`'s placement — phase 8: `(270.0, 42.6,
-1789.4)` (`43870000 422A6666 C4DFACCD`) yaw 0; otherwise `(-515.1, 42.6,
-1718.4)` (`C400C666 422A6666 C4D6CCCD`) yaw `0x8000`, all three components;
frame `0x82`: `PlaySoundId(0xB16A9)`, `Boss4ChainsawOff`,
`g_screen_shake_frames = 0x32`. (`death.ts` quotes 42.65; the word is 42.6.)

### 8.17 State 0xB — `Boss4StateWalkToPoint` `FUN_004958F0` `[proved]`

```
sub 0: obj.flags |= 0x10000; unless 0x6B blend(0x6B, 0, 10); st.flags &= ~0x10; Boss4ChainsawOff(); sub 1 (falls in)
sub 1: turn(pos - (535.0, -1900.0), 0x200)                -- [0x00570A60], [0x00570A64]
       if (|pos - (535, -1900)| < 20.0 [0x004C4C8C]) { Boss4QueueCameraCue(phase); st.flags |= 8 }
       if (!(st.flags & 0x10) && |pos - eye| < 150.0) { st.flags |= 0x10; Boss4ChainsawOn() }
```

### 8.18 State 0xC — `Boss4StateWithdrawAndAdvancePhase` `FUN_00495A20` `[proved]`

Jump table `0x00495D20` (subs 0..3; above 3 nothing).

```
advance := st.flags &= ~2; obj.flags |= 0x100; phase++; Boss4QueueCameraCue(phase); st.flags |= 8
sub 0: d = |pos - eye|
       d < 95.0 [0x00570A74]:  unless 0x6C blend(0x6C,0,10); sub 2
       d > 105.0 [0x00570A70]: unless 0x6B blend(0x6B,0,10); sub 1
       else:                   unless 0x6B blend(0x6B,0,10); sub 3; advance
sub 1: turn(pos - eye, 0x200); if (d < 100.0 [0x004C43B0]) { sub 3; advance }
sub 2: turn(P0 - pos, 0x200);  if (d > 100.0) { unless 0x6B blend(0x6B,0,10); sub 3; advance }
sub 3: if (!(obj.flags & 0x10000) && !Boss4KeepInsideEdge(pos, P4, P5, 0.0, 0)) obj.flags |= 0x10000
       q = (-260.0, pos.y, -1990.0)                       -- [0x00570A68], [0x00570A6C]
       turn(pos - q, 0x200)
       if (ActorPointIsAhead(obj+0x64, obj+0x40, &q)) { obj.flags |= 0x4000; sub 4 }
```

### 8.19 States 0xD, 0xE, 0x17 `[proved]`

* 0xD `Boss4StateWaitForPlayer` (`FUN_00495D30`): sub 0 unless `0x7C` blend
  (`0x7C`, 0, 10), `PlaySoundId(0x231BA9)`, sub 1; sub 1 with a player in play
  tail-jumps to `Boss4ResumeAfterHit`.
* 0xE `Boss4StateHoldUntilPlayerFree` (`FUN_00495D90`): sub 0 as 0xD; sub 1
  waits while no player is in play, or one player holds a taken attack permit
  on the last life; then state 5.
* 0x17 `Boss4StateDebugFreeMove` (`FUN_00495E20`): blend `0x7C`; with
  `g_pad_held` bit 8 held, `0x10`/`0x20` move z by ±0.2 and `0x40`/`0x80` x by
  ∓/±0.2 (`[0x004D1D24]`). Nothing enters it.

**`FUN_00495EB0` is not class 0x19** `[proved]`: its only caller is
`AppStateDispatch` and it switches on `g_nRunPhase`. Left unnamed.

## 9. How a fight reaches `g_script_flags[32]`

Arena 1 (block 23), from the entrance:

1. `set_script_flag 30` → banner 300 frames → shutter 1 → entrance sub 2:
   flag 31, `Boss4QueueCameraCue(0)`, `Boss4LoadPhaseArena`, hp bar, state 7,
   fenced. Next frame `Boss4PlayCameraCue` starts cue 0 (path 185, 0 → 220 at
   0.7, ≈315 frames), `[0x009CA094] = 1`.
2. Phase 0: states 7 → 4 → strike → 5 → 6 → 4 …; head hits take
   `g_boss4_head_damage`, flesh hits 1. At hp ≤ 266.67 bit `0x100` refuses
   damage.
3. When no cue runs, none is queued and the screen is not shaking,
   `Boss4AdvancePhaseAtFloor`: phase 1, cue 1 (231 → 350), untracked, flag 8.
4. `Boss4AdvanceArenaWaypoint` phase 1: at `g_cam_path_frame` ≥ 260 the boss is
   seated (or kept) and made state 7; `Boss4LoadPhaseArena` loads phase 1's
   quad and raises `0x60`; the fence is off (flag 2 down).
5. `Boss4ArmPhaseWhenInsideArena`: 5 inside the new quad → damageable, floor
   7/9, fenced. `Boss4TrackWhenInsideArena`: inside → tracked.
6. Phases 2, 4, 6 → state 8 on arrival; 5 and 7 → the charge (frozen until the
   cue passes 820 / 1130, tracked from 810 / 1110, hits at clip frame 0x47).
7. Phase 3 is the throw phase: approach at 180, throw both carried props; then
   (hp at floor or no props, eye beyond 210) state 9 → 0xB, walk to
   (535, -1900) → cue 4 (721 → 750) → phase 4 seats at 681.
8. Phase 8 (floor 0): the last ninth kills him → state 0x16 → clip `0x69`
   frame `0x46` writes **`g_script_flags[32]`**, and 240 frames after the fall
   ends `g_enemies_present` drops, which opens the block's `wait_enemies_present 0`.

Arena 2 (block 25) is the same over phases 9..17 with the throw at 13
(→ Withdraw → 14) and the last phase 17 (no threshold: it goes straight to
state 7).

## 10. The health bar (the coordinator's) — the sites

* `BossHpBarSpawn(320.0, 35.0)` at `0x00493937` and `0x00493BC5`
  (`PUSH 0x420C0000; PUSH 0x43A00000; CALL 0x00435E50`); the spawn itself
  writes `0x009C8E10 = 1.0` (`0x00435E7C`).
* `Boss4ResolveShot` writes `0x009C8E10`: `0.0` on the kill (`0x00491E94`),
  `(float)hp / (float)maxhp` otherwise (`0x00491EE9`, `FILD hp; FIDIV maxhp;
  FSTP`), and reads it back at `0x00491F2F`/`0x00491F42` for the head model.
  Nothing else in the class touches it.

## 11. What phase 2 did

Phase 2 (branch `boss/strength`) ported every routine in §4..§8 into
`web/src/game/class19/` and the pieces around it. What each item of the old
"needs" list became:

* **The bundle** (format 13, both `hod2lib` halves): the seven `.rdata` tables
  travel in `script.json` as `boss4` (`exetab.ts` `boss4Tables()`), with
  `carrier_door_yaw` (`0x005926D0`); the placements carry `class19` (the
  entrance, the fifteen per-bone mesh words as `coli.blobs` keys, the despawn
  pair); `BOSS4_CLIPS` bakes all twenty-one clips; the swap and effect slots
  ride the character's gore rig and the effect set.
* **The shot test.** Class 0x19 registers the engine's way (main's
  `combat/shot_test.ts`): `Boss4Update` calls `ActorRegisterCameraPoint`
  itself, and `ShotTestBoneTree` takes `ShotTestBoneMesh` for the ten mesh
  bones, in `game/` over `GameHost.boneMatrix` and `ColiSegmentVsMesh`, so a
  candidate carries its surface and normal to `MarkActorShot` and
  `SpawnWorldImpact` fills `g_shot_hit_records`.
* **The camera** was the coordinator's refactor on main (the stashed rail in
  `G`); `Boss4PlayCameraCue` writes it as the exe does.
* **The carrier** is `CarrierPropRoutine2`; **the carried prop** is
  `CarriedPropHeldInBone8Update` and `CarriedPropDeflectedFlight` in
  `carried_prop.ts`, seeded directly by `Boss4SpawnHeldProp`.
* **Shared helpers**: `ActorTurnTowardXZ`/`ActorHeadingErrorTo` (main),
  `ActorPointIsAhead` (moved to `actor_turn.ts`), `ActorPickTargetPlayer`
  (`actor_target.ts`), `ActorShiftToHoldBone1Position` and `MotionFrameOf`
  (`actor_pose.ts`), `MatrixScale`.
* **State 0xA's pose** is computed in `game/` from the baked clips and handed
  to the renderer as the fade snapshot's `records` (`Actor.fadeFrom`).
* Every correction of §11.4 (as it stood) is in: 33 head-damage entries from
  the bundle, the full Init, the two-shooter loop, `Boss4ChainsawOn`, the
  camera rise, the flag names, `42.6`.

## 12. Renames (applied in phase 2, in one commit)

| address | was | now | why |
|---|---|---|---|
| `0x004922C0` | `Boss4EndPlacementWalk` | `Boss4TrackWhenInsideArena` | no walk; clears `0x10000` when inside |
| `0x00492350` | `Boss4AdvancePhaseWhenWalkDone` | `Boss4ArmPhaseWhenInsideArena` | no walk, no phase change |
| `0x00494D60` | `Boss4StatePinPlayer` | `Boss4StateThrowHeldProp` | it throws a carried prop |
| `0x004944A0` | `Boss4StateWaitForCameraInRange` | `Boss4StateFaceCamera` | a facing test, not a range |
| `0x00494730` | `Boss4StateLookAtCamera` | `Boss4StateTurnClipThenApproach` | bakes clip `0x76`'s turn into the yaw |
| `0x004945A0` | `Boss4StateRiseThenIdle` | `Boss4StatePlayArrivalClip` | clip content is unknown; entered on arrival |
| `0x00570510` | `g_boss4_pin_picks` | `g_boss4_held_props` at `0x005704F8` | the label sits at the record's `+0x18` |

Each was cited in `web/src/game/class19/*.ts` and in this document, so each
rename landed in one commit across Ghidra, the TSVs, the TypeScript and the
docs. The enum members moved with them: `Boss4State.FaceCamera`,
`PlayArrivalClip`, `TurnClipThenApproach`, `ThrowHeldProp`, and
`Boss4Flag.TrackPending` / `ArmPending` for the two gates.

## 13. Open questions

1. `[open]` Which routine enters blocks 27 and 29 (`[likely]` Boss Mode).
2. `[open]` Whether state 9's exit (`|err| > 0x7000` after a turn that shrinks
   `err`) is reached in play; the transcription does not depend on it.
3. Named on main since: `g_boss_engaged` (`0x009CA0EA`),
   `g_camera_driver_held` (`0x009CA094`), `g_rail_frame` (`0x009C70BC`).
4. `[open]` What `boss4.bin[2]`, `[7]`, `[23]..[26]` look like. The throw sound
   says axe; the rest is for a render to settle.
5. Resolved: `g_carrier2_door_yaw` (`0x005926D0`, 59 s16) and the two door
   offsets are read and ported (`CarrierPropRoutine2`).
