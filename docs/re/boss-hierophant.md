# Class 0x14 — the stage-2 boss (the Hierophant): a transcription-grade reading

This reading covers every routine class 0x14 runs, every branch, every
constant with the instruction it comes from, and every field and global it
touches. The port is `web/src/game/class14/`.

Evidence convention as everywhere: `[proved]` read in the instruction stream or
the decompilation of that routine; `[likely]` inference, evidence stated;
`[open]` undetermined.

**Name.** "Hierophant" is the user's name for the boss. The exe calls it
nothing: character type `0x47` is `boss2.bin` `[proved]` (skeleton slots
resolve there). The banner records carry message id `0x1821` (see §9); what it
says is `[open]`.

---

## 0. Map of the code

| address | name | role |
|---|---|---|
| `0x00475E90` | `Class14Init` | constructor (§3) |
| `0x00476150` | `Class14Update` | per-frame entry (§4) |
| `0x00476270` | `Class14ResolveShotBone` | shot resolution (§5.1) |
| `0x004763E0` | `Class14ApplyBoneDamage` | weak-point gates + damage (§5.2) |
| `0x00476A30` | `Class14SpawnNoDamageHitEffect` | no-damage hit feedback (§5.3) |
| `0x00476AD0` | `Class14AdvanceMotionAndPublishPoints` | clock, feet, y-follow, IK, flipbooks, draw (§6); body runs to `0x00477BC7` |
| `0x00477BF0` | `Class14IkJointAngle` | law-of-cosines angle (§6.6) |
| `0x00477C90` | `Class14EaseAngleToward` | angle ease (§6.6) |
| `0x00477CD0` | `Class14FollowSegment` | route steering (§7.1) |
| `0x00477E60` | `Class14AdvancePhase` | phase ladder (§7.2) |
| `0x00477FF0` | `Class14TrackAdaptiveRank` | adaptive rank (§7.3) |
| `0x00478160`.. `0x0047C5F0` | the 21 states | §8 |

`g_class14_states` (`0x00596218`) read from memory `[proved]` (L38): 21 dwords,
`[0]=0x478160 [1]=0x4783B0 [2]=0x478640 [3]=0x478160 [4]=0x4783B0
[5]=0x478870 [6]=0x478C00 [7]=0x478E30 [8]=0x478EE0 [9]=0x479030
[10]=0x479530 [11]=0x479BE0 [12]=0x47A2E0 [13]=0x47A7C0 [14]=0x47A990
[15]=0x47AF60 [16]=0x47B280 [17]=0x47B4C0 [18]=0x47BAD0 [19]=0x47BFE0
[20]=0x47C5F0`, followed immediately by `g_class14_anim_cues` (`0x0059626C`).

Singletons, re-seated at the top of Init and Update:
`g_class14_char` (`0x007DCF1C`) = `obj+0x194`, `g_class14_state`
(`0x007DCF20`) = the block, `g_class14_xform` (`0x007DCF24`) = `obj+0x40`,
`g_cur_actor` (`0x009A26A0`) = obj.

**Decompiler traps met in this class** (all `[proved]`):
* `g_class14_char` is typed `int*` in most routines, so `g_class14_char + 0x244`
  in the pseudocode is byte offset `0x910`. Read offsets off the disassembly.
* Six routines end the pseudocode on `MatrixStackPop` while the instruction
  stream goes on (L35): `Class14ResolveShotBone` (`0x0047637E..0x004763C6`),
  `Class14AdvanceMotionAndPublishPoints` (to `0x00477BC7`),
  `Class14StateLungeAtCamera`/`LeapAttack`/`LeapFromSide` (their two-attacker
  arms), `Class14StateDeathA` sub 2, and `ActorPointIsAhead` (its return value).
* `__ftol()` with no argument (L1) in `WaveEvalTravelling`/`WaveEvalCircular`
  and the KnockedDown launch; read from the stream below.

## 1. The five spawns and their gates

Descriptors decoded by `web/src/hod2lib/evt.ts`, as the bundle's
`<stage>.script.json` carries them `[proved]`:

| stage/block | step/op | pos | yaw | hp | `tail+0x01` (state) | entrance |
|---|---|---|---|---|---|---|
| 2 / 35 | 1 / 54 | (-1340, -23.0007, -1980) | 0x8000 | 300 | 0 | A |
| 2 / 37 | 1 / 38 | (230, 23, -2150) | 0x8000 | 300 | 1 | B |
| 2 / 39 | 1 / 49 | (-1345, -24.9, -1952) | 0x8000 | 300 | 3 | A |
| 2 / 41 | 1 / 44 | (230, 23, -2129.5) | 0x8000 | 300 | 4 | B |
| 5 / 3 | 1 / 14 | (580, -70.5, -5010) | 0x8000 | 200 | 2 | C |

The same blocks place the **wave field** the summons need (§11.3): blocks 35
and 39 a class-0x16 at y = -25.5007 plus two class-0x17 sources; blocks 37 and
41 a class-0x16 at y = -25.0 and no sources; stage 5 block 3 none (its phases
never summon).

Gate sequences `[proved]` (script offsets in the evt file):

* **Block 35** (and 39 identically from its step 1): `wait_script_flag 0x0A`
  (0x014370), `queue_event 0x21 4` (camera driver = `CameraDriverSelectMode`),
  `wait_script_flag 0x11` (0x014388), `goto_scene_state 3`, … `wait_enemies_present 0`.
* **Block 37**: `set_script_flag 0x5F` at **0x014F60** (the flag EntranceB's sub
  1 waits on), spawn, then `wait_script_flag 0x0A, 0x0B, 0x0C, 0x0D, 0x0E, 0x0F,
  0x10, 0x11` interleaved with `queue_event 0x40 … 0x6A` (cp path 0x6A frames
  0..0x5F) before flag 12 and `queue_event 0x40 … 0x6B` (0..100) before flag 13,
  then `wait_enemies_present 0`. Block 41 is the same list without the 0x5F raise
  (entrance state 4 skips that wait).
* **Stage 5 block 3**: `set_hud_shutter_state 3`, `set_script_flag 0x0B` at
  0x0021F4 (before the spawn at 0x002214), `play_dialogue 0xA6`, **`set_hud_shutter_state 1` at 0x002268**,
  `wait_script_flag 0x1F`, `goto_scene_state 3`, `wait_enemies_present 0`.

**No stage-2 boss block ever sets the shutter to 1** (35: 5,5,6,8; 37: 6,3,5,6,8;
39: 5,5,8; 41: 5,5,8) `[proved]`. On stage 2 the only thing that does is the
boss's own intro banner, 300 frames after the entrance raises flag 9 (§9). That
is the first link of every stage-2 gate.

## 2. The 0xBC-byte block

`ActorAllocSub(0xBC)` zeroes it (`0x004A74E0`: two `rep stos`-style loops)
`[proved]`, so the phase at `+0x08` starts 0 — Init never writes it.

| off | type | meaning | writers / readers |
|---|---|---|---|
| +0x00 | u32 | flags: bit 0 = route steering off; bit 1 = foot contacts frozen; bit 2 = leap integration off | Init (=1); entrances (&~1); AdvancePhase (\|1); Reposition, LeapFromSide (&~1); deaths (\|1); DeathA sub 2 (\|2). Bit 2 has no writer in this class: no `OR …, 0x4` in `0x00475E90..0x0047C960` and Init's `MOV [state], 1` is the only whole-word store `[proved]`, so the leaps always integrate |
| +0x04 | u8 | state (index into `g_class14_states`) | |
| +0x05 | u8 | sub-state | |
| +0x06/+0x07 | u8 | state/sub saved by `Class14ApplyBoneDamage` | CuedMotion/KnockedDown return |
| +0x08 | u8 | phase (0..9) | entrances, AdvancePhase, SummonA/B exits |
| +0x0C | f32 | camera-point rise for `ActorRegisterCameraPoint` | Init **6.0** (`0x00475F98`), ApplyBoneDamage 6.0 on a CuedMotion reaction |
| +0x10..+0x18 | vec3 | latched target (pos at hand-over) | |
| +0x1C..+0x24 | vec3 | route direction (tail+4..+0xC) | |
| +0x28/+0x30 | f32 x,z | route corner 0 (tail+0x10/+0x14) | |
| +0x34/+0x3C | f32 x,z | route corner 1 (tail+0x18/+0x1C) | |
| +0x40/+0x48 | f32 x,z | route corner 2 (tail+0x20/+0x24) | |
| +0x4C/+0x54 | f32 x,z | route corner 3 (tail+0x28/+0x2C) | (y words +0x2C/+0x38/+0x44/+0x50 stay 0) |
| +0x58/+0x5C | s32 | death bob phase / rate (BAMS) | DeathA/B |
| +0x60 | s16 | roars left | Close, Roar, CuedMotion |
| +0x62 | s16 | anim slot | selects the foot-contact code (§6.3) as well as the motion |
| +0x64..+0x78 | s32×6 | leg IK angles | §6.6 |
| +0x7C | s16 | flipbook A frame (asset slot) | §6.7 |
| +0x7E/+0x80 | s16 | A low 0x2CB / high 0x2ED | Init |
| +0x82 | s16 | A hold | |
| +0x84 | f32 | A rate (1.0 at Init) | |
| +0x88 | s16 | flipbook B frame (asset slot) — **the damage window** | |
| +0x8A/+0x8C | s16 | B low 0x2EE / high 0x315 | Init |
| +0x8E | s16 | B hold (-1 / 0xFFFF = "held") | many states (§6.7) |
| +0x90 | f32 | B rate | Init, AdvanceMotion, CuedMotion, KnockedDown |
| +0x94 | s16 | window index 0..7 into `g_class14_window_timing` | ApplyBoneDamage +2 (cap 7); Strike/Lunge/Leap/LeapFromSide landing -1 (floor 0), then leaps set 7 |
| +0x96 | s8 | adaptive rank 0..15 | |
| +0x97 | s8 | pending rank bump | ApplyBoneDamage ++ |
| +0x98/+0x99 | s8 | player 0/1 lives as last seen | Init, TrackAdaptiveRank |
| +0x9C | s32 | polymorphic: rounds left / Close mode / frame countdown / cp path slot / side coin | |
| +0xA0 | s32 | fish left this round / cp path frame / countdown reset | |
| +0xA4 | s32 | frames to next fish / countdown | |
| +0xA8 | s32 | side coin / countdown | |
| +0xAC | s32 | "no life lost this round" | SummonA/B |

Actor fields used: `+0x34` flags (bits below), `+0x3C` hit slot, `+0x40..+0x48`
pos, `+0x4C..+0x54` vel, `+0x5C` gravity, `+0x64/+0x68/+0x6C` pitch/yaw/roll
(BAMS in dwords), `+0x11C/+0x11E` hp/maxhp (s16), `+0x120/+0x121` enemy slot /
target player, `+0x124` shot radius, `+0x190/+0x191` bone hit per player,
`+0x194..` the character (`char+0x00` frame counter, `+0x08` play cursor,
`+0x20` motion, `+0x34` char flags, `+0x40` a pointer whose byte `+1` is part
0's draw byte (`ActorBuildSkinnedModel` seeds every part's to 1; boss2's part 0
is the vertex-blended waist, slot `0x316`) -- the entrances toggle it, `+0x64`
draw flag bit 0, `+0x68` byte = 1, `+0x78 + i*0x90`
bone record i: `+0x00` slot, `+0x28` view matrix, `+0x68` hit centre, `+0x78`
hit radius; `+0x1158` per-bone hook).

`obj+0x34` bits this class reads or writes: `0x2` `0x4` `0x8` (shot),
`0x100` (shot-immune: ResolveShotBone refuses damage), `0x2000` (no reaction),
`0x4000` (pose frozen), `0x8000` (**out of the shot test**, Init → hand-over),
`0x10000` (off the camera list), `0x20000` (no ground-follow; also CuedMotion's
ground snap), `0x80000`, `0x4000000` (dead), `0x10000000`, `0x40000000`
(reacting). `0x80000`/`0x10000000` are raised and cleared here with no reader
found in this class `[open]` what reads them.

## 3. `Class14Init` — `0x00475E90`

Straight-line, `[proved]` from the stream:

```
EDI = obj+0x130C (tail)
g_cur_actor = obj; g_class14_char = obj+0x194; g_class14_xform = obj+0x40
g_class14_state = obj+0x1310 = ActorAllocSub(0xBC)
obj+0x34 |= 0x8000                                  ; 0x00475ECF  (OR BH,0x80)
char+0x60 (u16) = tail[0]                            ; char type 0x47
state+0x62 = 0xB; char+0x20 = anim_slots[0xB][0]    ; motion 33
char+0x00 = 0; char+0x08 = 0
ActorBuildSkinnedModel(char, xform, char+0x78)
char+0x1158 = NoOpStub (0x41EBB0); char+0x68 (u8) = 1
obj+0x124 = 30.0f (0x41F00000)                      ; 0x00475F4F
g_enemies_present++ ; g_enemies_alive++
obj+0x121 = 0xFF; obj+0x120 = 0xFF; RegisterEnemySlot(obj)
state+0x04 = tail[1]; state+0x05 = 0
state+0x0C = 6.0f (0x40C00000)                      ; 0x00475F98
state+0x1C..0x24 = tail+4..+0xC
state+0x00 = 1
route x/z as §2
state+0x64..+0x78 = 0
+0x7E = +0x7C = 0x2CB; +0x80 = 0x2ED; +0x84 = 1.0f; +0x82 = 0
+0x8A = +0x88 = 0x2EE; +0x8C = 0x315; +0x8E = 0
+0x94 = 0; +0x90 = g_class14_window_timing[0].open_rate (= 2.0f)
+0x96 = GetDamageRank(); +0x97 = 0
+0x98 = (u8)lives[0] (0x009A5C66); +0x99 = (u8)lives[1] (0x009A5D96)
*obj = Class14Update
```

## 4. `Class14Update` — `0x00476150`

```
tail = obj+0x130C; re-seat the four singletons
Class14ResolveShotBone(obj)
g_class14_states[state+0x04](obj)                   ; CALL [ECX*4+0x596218] at 0x0047618F
Class14AdvanceMotionAndPublishPoints(obj)           ; clock AFTER the state
if !(state+0x00 & 1):
    if Class14FollowSegment(xform, route0, route1, 5.0): Class14FollowSegment(xform, route2, route3, 5.0)
    Class14FollowSegment(xform, route1, route2, 10.0)
Class14AdvancePhase(obj)
ActorRegisterCameraPoint(state+0x0C)                ; float arg
Class14TrackAdaptiveRank()
if g_active_cam_path == (s16)tail+0x30 && g_cam_path_frame == (s16)tail+0x32:
    if obj+0x3C != -1: g_hit_slots[obj+0x3C] = 0
    ActorDespawn(obj)
```

## 5. Being shot

### 5.1 `Class14ResolveShotBone` — `0x00476270`

```
if !(obj+0x34 & 8) return
bits = obj+0x34 & 6
if bits == 2:   order = {0, -1}
elif bits == 4: order = {1, -1}
else:           r = rand() signed-mod 2; order = {r, r^1}   ; g_hit_player_order / DAT_009C890C
obj+0x34 &= ~0xE
for p in order (both entries, loop to 0x009C8910):          ; 0x004762E0..0x004763C6
    if p == -1 continue
    bone = (s8) obj[0x190 + p]; if bone <= 0 continue
    world = g_camera_blocks[g_camera_index] * (char + 0xE0 + bone*0x90)   ; the bone's hit centre
    if !(obj+0x34 & 0x100) && bone == 1:                     ; 0x00476384..0x0047638C
        Class14ApplyBoneDamage(obj, bone, p)                 ; 0x00476391
        if obj+0x34 & 0x4000000: obj+0x34 |= 0x100
    else:
        SpawnSpriteEffect(&{world, …}, 2, 1, p)              ; 0x004763B5
```

**Only bone 1 can damage the boss**, and never while `0x100` is up. boss2's
per-bone pick spheres (`combat.hitSphere(tables, 0x47, b)` `[proved]`): bone 1
centre (0, 2.25, 0) r 5.55; bone 2 (0, 0.2, 2.4) r 2.4; bones 3..15 limbs.

### 5.2 `Class14ApplyBoneDamage(obj, bone, player)` — `0x004763E0`

Gate 1, the weak-point sphere:
```
M = char+0x130 (bone 1's VIEW matrix: record 1 = char+0x78+0x90, +0x28)
P = translation of M * Translate(0, 4.0f (0x40800000), 1.0f (0x3F800000))
if RayTestSphere(player, P.x, P.y, P.z, 3.5f (0x40600000)) < 0:     ; 0x0047643B
    Class14SpawnNoDamageHitEffect(bone, player); return
```
Gate 2, the window cone (`0x00476463..0x00476728`):
```
i = (s16)state+0x88 - (s16)state+0x8A          ; 0..39
C = g_class14_damage_cones[i]                   ; {s16 maxYaw, rotX, minPitch, maxPitch}
if C.maxYaw == 0: goto no_damage                ; entries 0..18 are all zero
W = g_camera_blocks[cam] * M * Translate(0, 3.0f, 0)       ; world
S = g_ShotRecords[player].origin (0x009A2CB8 + p*0x68)
E = S + g_ShotRecords[player].dir (+0x0C)
LineSphereIntersect(5.5f (0x40B00000), W, S, E, A, B)
Q = |S-B| < |S-A| ? B : A
L = inverse(g_camera_blocks[cam] * M * Translate(0,3,0) * RotX(C.rotX)) * Q
pitch = ftol(atan2(-L.y, L.z) * 10430.378)     ; 0x00476652..0x0047667F
yaw   = ftol(atan2( L.x, L.z) * 10430.378)     ; 0x00476684..0x004766FD
if |yaw| > C.maxYaw or pitch < C.minPitch or pitch > C.maxPitch: goto no_damage
```
Damage (`0x00476735..0x0047689B`):
```
if !(obj+0x34 & 0x4000000):
    f = (float) g_class14_bone_damage[rank][g_players_in_play-1]   ; [EAX+EDX*2+0x596697]
    if g_GameMode == 1:                                  ; 0x00476772 CMP EAX,1 / JNZ 0x00476798
        w = g_original_item_slots[player] (0x009A2240 + p*0x14)
        if w+0x0C == 0xBF800000 (-1.0): f += f           ; FADD ST0,ST0
        else: f *= w+0x0C
    if f > g_boss_shot_damage_cap (33.0): f = 33.0
    hp = ftol(hp - f); state+0x97++
    PlaySoundId(0x316A9)                                 ; COMMON\BLOOD03_16.WAV
    if hp < 1:
        DAT_009C8E10 = 0.0                               ; 0x004767F8  (boss bar fill)
        obj+0x34 = (obj+0x34 & ~0x2000) | 0x4000000
        g_enemies_alive--; ScoreAddForPlayer(player, 0x5DC); BossModeRecordGrade()
    else:
        DAT_009C8E10 = (float)hp / (int)maxhp            ; 0x0047684E  FILD/FIDIV/FSTP
        if (float)hp <= (float)maxhp * g_class14_phase_hp_frac[phase]: obj+0x34 |= 0x100
    ScoreAddForPlayer(player, 10)
SpawnBloodSpray(obj, bone, 2.0f)
if obj+0x34 & 0x40000000: return
if !(obj+0x34 & 0x2000):
    g = QueryGroundHeightAt(x, y + 100.0 (0x004C43B0), z)
    airborne = (state in {12,14} and g < y) or (state == 9 and g + 5.0 (0x0055D2B4) < y)
    obj+0x34 = (obj+0x34 & ~0x4000) | 0x40000000
    state+0x06 = state; state+0x07 = sub; sub = 0
    state = airborne ? 0x11 : 0x10;  if !airborne: state+0x0C = 6.0
    PlaySoundId(0x1117A9)                                ; COMMON2\ZOMBIE_022_16.wav
state+0x94 = min(7, state+0x94 + 2)                      ; runs even with 0x2000 up
return
no_damage: Class14SpawnNoDamageHitEffect(bone, player); MatrixStackPop
```
`g_class14_bone_damage` (`0x00596698`) runs from 30/28 (one player / two) at
rank 0 down to 16/13 at rank 15, and only Original Mode (`0x00476772`) scales
it: Arcade takes the table as it stands.

### 5.3 `Class14SpawnNoDamageHitEffect(bone, player)` — `0x00476A30`

World point of the bone's hit centre (as §5.1) → `SpawnSpriteEffect(pt, 2, 1, player)`.
No damage, score or sound.

## 6. `Class14AdvanceMotionAndPublishPoints` — `0x00476AD0..0x00477BC7`

Ghidra's body stops at `0x00476F6F`; the switch at `0x00476D21` jumps through
`0x00477BC8` (7 entries) and everything to `0x00477BC7` is this routine
`[proved]` (disassembled in full). In order:

### 6.1 Draw and clock
```
LightsUseSecondarySet()                               ; 0x0041DC70
DrawSkinnedModelAndShadow(char, xform, char+0x78)     ; 0x00411090 (poses the bones, then ActorDrawShadow: it does draw the shadow)
if !(obj+0x34 & 0x4000): char+0x00++
```

### 6.2 Foot points (skipped when `state+0x00 & 2`)
For bone 15 (`char+0x910` view matrix) and bone 12 (`char+0x760`):
```
foot = cam * bone * Translate(0, -1.25f (0xBFA00000), 0)   ; kept as locals p15, p12
toe  = foot-frame * Translate(0, 0, 2.5f (0x40200000))     ; -> g_class14_foot_contacts[0].pt (bone 15), [1].pt (bone 12)
heel = toe-frame  * Translate(0, 0, -5.0f (0xC0A00000))    ; -> [2].pt (bone 15), [3].pt (bone 12)
```
Records are `{f32 strength; f32 x,y,z}` at `0x009A3500 + i*0x10`.

### 6.3 Contact code → strengths (same branch)
```
p = anim_slots[state+0x62] + 2
while *p != -1 and *p < char+0x08: p += 2 shorts     ; first cue frame >= play cursor
code = p[1]
switch code:                                          ; table 0x00477BC8
 0: all four strengths = 75.0  (0x42960000)
 1: all four = 150.0 (0x43160000)
 2: [0],[2] = 150; [1],[3] = 0
 3: [0],[2] = 0;   [1],[3] = 150
 4: [0],[2] = 300 (0x43960000); [1],[3] = 0
 5: [0],[2] = 0;   [1],[3] = 300
 6: all four = 0
```
The decoded cue records (motion; frame→code …; end code) `[proved]`:

| slot | motion | cues |
|---|---|---|
| 0 | 21 | ≤11:0, ≤45:2, ≤60:0, else 3 |
| 1 | 22 | ≤30:0, ≤53:2, ≤82:0, else 3 |
| 2 | 23 | ≤30:0, ≤53:2, ≤82:0, else 3 |
| 3 | 24 | ≤25:0, ≤50:2, ≤75:0, else 3 |
| 4 | 25 | ≤30:2, else 3 |
| 5 | 26 | ≤40:2, else 3 |
| 6 | 27 | 6 |
| 7 | 28 | 0 |
| 8 | 29 | 0 |
| 9 | 30 | ≤2:0, ≤13:6, ≤20:4, ≤50:2, else 0 |
| 10 | 31 | ≤1:0, ≤10:6, ≤20:4, ≤40:2, else 0 |
| 11 | 33 | 0 |
| 12 | 34 | 0 |
| 13 | 37 | ≤32:6, ≤55:3, else 0 |
| 14 | 38 | 0 |
| 15 | 39 | 0 |
| 16 | 40 | 6 |
| 17 | 43 | ≤30:0, ≤50:2, ≤93:0, ≤110:3, else 6 |
| 18 | 44 | 6 |
| 19 | 45 | ≤32:6, ≤45:1, else 0 |
| 20 | 47 | 6 |
| 21 | 49 | ≤25:0, ≤47:2, else 0 |
| 22 | 50 | ≤20:0, ≤105:3, else 0 |
| 23 | 51 | ≤35:2, ≤45:1, ≤100:6, ≤130:1, else 0 |
| 24 | 52 | ≤35:3, else 2 |
| 25 | 53 | ≤12:3, else 2 |
| 26 | 54 | ≤25:3, else 2 |
| 27 | 55 | 0 |
| 28 | 58 | ≤7:2, ≤41:3, else 2 |
| 29 | 46 | 0 |

(`≤F:c` = "while the play cursor is at most F, code c".) States that play a
literal motion without writing `+0x62` (EntranceB/C, SummonB, LeapAttack,
Reposition, LeapFromSide, ScriptedBreak, CuedMotion's 0x29, DeathB/C) keep the
previous slot's codes.

### 6.4 Two knee angles (always, `0x00476E55..0x00476F6B`)
```
v     = inverse(bone13 * Translate(0, -8.432 (0xC106E979), 0)) * bone14 * (0, 1, 0)    ; char+0x7F0, +0x880
kneeA = ftol(atan2(v.z, v.y) * K)                                                      ; FLD [ESP+0x78] (z), FLD [ESP+0x74] (y), FPATAN at 0x00476EC4
kneeB = the same for bone 10 / bone 11 (char+0x640, +0x6D0)                             ; 0x00476F52
```
(`0x004A8D20` is `MatrixInvert(0)`, `0x004A92A0` `MatrixMultiply`.) `[likely]`
the animated knee bend — bone 14's +y seen from the knee; only the draw (§6.8)
adds it to the eased knee angles.

### 6.5 Ground-follow y (skipped when `obj+0x34 & 0x20000` or `char+0x37 & 1`, the model block's cross-fade flag) — `0x00476F91..0x004770AF`
```
h15 = QueryGroundHeightAt(p15.x, p15.y + 100.0, p15.z)
h12 = QueryGroundHeightAt(p12.x, p12.y + 100.0, p12.z)
if contacts[0].strength != 0:  d = h15 - p15.y
elif contacts[1].strength != 0: d = h12 - p12.y
else: d = QueryGroundHeightAt(x, y + 100.0, z) - y
d = clamp(d, -0.3f (0xBE99999A), 0.3f (0x3E99999A))
obj.y += d
if contacts[0].strength != 0 or d + p15.y < h15: p15.y = h15
if contacts[1].strength != 0 or d + p12.y < h12: p12.y = h12
```
**This is gameplay** — the boss's own `y` follows the pier/sea floor under its
planted foot every frame it is not suppressed.

### 6.6 Leg IK (same guard; only when `p15.y == h15 || p12.y == h12`) — `0x00477101..0x00477655`
For each planted foot, two-bone IK from the hip (bones 13 and 10) to the
ankle point `foot + (0,1.25,0)` with `Class14IkJointAngle(d², 90.52, 71.10,
9.514, 8.432)` (`0x42B5084B`, `0x428E327F`, `0x41183958`, `0x4106E979`), giving
three angles per leg (hip yaw, hip pitch, knee). A foot not planted targets 0.
Then `Class14EaseAngleToward(&state+0x64.., target, 0.5)` for the six:
`+0x64 ← legA hip pitch (EBX)`, `+0x68 ← legB hip pitch (EDI)`, `+0x6C ← legA hip
yaw`, `+0x70 ← legB hip yaw`, `+0x74 ← legA knee (EBP)`, `+0x78 ← legB knee (ESI)`.
The per-angle expressions, `[proved]` (read from the bytes):
```
q = translation of T(0, 1.25, 0) * (V15 * cam with row 3 = p15)     ; the ankle above the sole
H = V13 * cam * T(0, dy, 0)                                          ; dy = the step just taken
r = q * inverse(H);  yaw = (|r.x| < 1 || |r.z| < 1) ? 0 : (s16)ftol(atan2(-r.x, -r.z) * K)
s = q * inverse(RotY(yaw) * H);  d2 = s.y^2 + s.z^2                  ; x unused
a = IkJointAngle(9.514^2, d2, 8.432^2, sqrt(d2), 8.432)             ; leg A: sqrt of the 80-bit d2
pitch = (s16)ftol(atan2(-s.z, -s.y) * K) - a                         ; 32-bit
k = IkJointAngle(d2, 9.514^2, 8.432^2, 9.514, 8.432);  knee = 0x8000 - kneeRest - k
```
Leg B is the same over bones 10..12 with the float `d2` under the root. A
foot not planted targets 0 on all three; the IK skipped entirely eases all six
toward 0 and draws with `dy = 0`. The draw applies `dy` in **view** space
(`V(i) * T(dy)`), the IK in world space.

`Class14IkJointAngle(d2, a2, b2, a, b)` — `0x00477BF0`: `c = (a2 + b2 - d2) /
(2ab)`; `c ≥ 1 → 0`, `c ≤ -1 → 0x8000`, `c == 0 → 0x4000`, else
`ftol(atan(sqrt(1-c²)/c) * K)`, `+0x8000` when `c < 0`.
`Class14EaseAngleToward(p, t, k)` — `0x00477C90`: `d = (t - *p) & 0xFFFF; if d >
0x8000: d -= 0x10000; *p += ftol(d * k)`.

### 6.7 The two flipbooks on bone 1 — `0x0047765F..0x00477919`

Track A (heartbeat `[likely]`: the entrances play `COMMON\HERTBEAT_22.WAV` exactly when it sits at its low end):
```
if A.hold (+0x82) != 0: A.hold--
else:
    A.frame = ftol(A.frame + A.rate)
    if A.rate > 0 and A.frame >= A.high: A.frame = A.high; A.hold = ftol(30.0/A.rate); A.rate *= -1.0
    elif A.rate < 0 and A.frame <= A.low: A.frame = A.low; A.rate *= -1.0; A.hold = ftol(30.0/A.rate)
```
Track B (the damage window; `+0x94` = window index):
```
if B.hold != 0:
    if obj+0x34 & 0x100:
        if B.frame == B.low: goto clamp        ; stays held shut
        B.hold = 0; goto done
    if 0 <= B.hold <= 0x78: B.hold--; goto done
    if state == 5 or 8 <= state <= 12: B.hold = 10; goto done
    goto clamp
else:
    if obj+0x34 & 0x100 and B.frame == B.low: B.hold = -1; goto done
    B.frame = ftol(B.frame + B.rate)
    if B.frame >= B.high: B.frame = B.high; B.hold = T[+0x94].openHold;  B.rate = T[+0x94].closeRate
    elif B.frame <= B.low: B.frame = B.low; B.hold = T[+0x94].shutHold; B.rate = T[+0x94].openRate
done:
clamp:
    if 0 <= B.rate < 1.0: B.rate = 1.0
    elif B.rate < -1.0: B.rate = -1.0          ; 0x004778EA..0x00477910
```
The second arm is `FCOMP [-1.0]; TEST AH,1; JZ end` then
`FCOMP [0.0]; TEST AH,0x41; JZ end; MOV rate, -1.0`: it takes a rate **below**
-1.0 up to -1.0, so every close runs at -1.0 whatever the timing row says. The
row's close rate lives only until the same frame's clamp.
`g_class14_window_timing` (`0x005965C0`), `{s16 openHold, s16 shutHold, f32 openRate, f32 closeRate}`:

| +0x94 | open hold | shut hold | open rate | close rate |
|---|---|---|---|---|
| 0 | 100 | 30 | 2.0 | -1.0 |
| 1 | 50 | 25 | 2.0 | -1.0 |
| 2 | 30 | 20 | 2.5 | -1.25 |
| 3 | 15 | 10 | 2.5 | -1.25 |
| 4 | 10 | 5 | 3.0 | -1.5 |
| 5 | 2 | 1 | 4.0 | -2.0 |
| 6 | 1 | 0 | 5.0 | -2.5 |
| 7 | 0 | 0 | 6.0 | -3.0 |

`g_class14_damage_cones` (`0x00596480`), indexed by `B.frame - 0x2EE`: entries
0..18 zero; 19 `{0xA00, 0xB000, 0x1800, 0x4000}`, 20 `{0x1000, 0xB800, 0x1000,
0x4000}`, 21 `{0x1000, 0xC000, 0x800, 0x4000}`, 22 `{0x1100, 0xD000, -0x800,
0x4000}`, 23 `{0x1100, 0xE000, -0x1800, 0x4000}`, 24 `{0x1100, 0xE800, -0x2000,
0x4000}`, 25..39 `{0x1400 + (i-25)*0x100 capped 0x2000, 0xF000, -0x2800, 0x4000}`
(25:0x1400, 26:0x1500 … 36:0x1F00, 37..39: 0x2000).

The asset slots resolve to `boss2.bin` entries 2..36 (A) and 37..76 (B)
`[proved]` via `ExeTables.assetSlots()`. What they look like is `[open]` —
render them before naming them.

Writers of `B.hold` elsewhere, all `[proved]`: Hunt tail (§8.6), Lunge/Leap sub 2,
LeapFromSide sub 1, SummonA approach, SummonB sub 2, Reposition exit,
CuedMotion (entry, while shut, exit), KnockedDown (entry, while shut, exit).

### 6.8 Draw (when `char+0x64 & 1`) — `0x0047791A..0x00477BB5`
Bones 1..9: `SetTop(char+0xA0+i*0x90); AssetDrawSlot(char+0x78+i*0x90)`; for
i == 1 also `AssetDrawSlot(A.frame)` and `AssetDrawSlot(B.frame)` under the
same matrix. Leg A: `SetTop(bone13) RotY(+0x6C) RotX(+0x64)` draw bone 13's
slot; `Translate(0,-8.432,0) RotX(+0x74 + kneeA)` draw bone 14; `Translate(0,
-9.514,0)`, take the translation into bone 15's matrix, draw bone 15. Leg B the
same over bones 10/11/12 with `+0x70`, `+0x68`, `+0x78 + kneeB`. Then
`FUN_0041DCC0` (lights back).

## 7. Steering, phase and rank

### 7.1 `Class14FollowSegment(p, a, b, step)` — `0x00477CD0`
`Boss4KeepInsideEdge`'s algorithm (`boss-strength.md` §7.6) with the push always
on, all in x/z:
```
px = p.x - a.x; pz = p.z - a.z; bx = b.x - a.x; bz = b.z - a.z
t = (bx*px + bz*pz) / (bx*bx + bz*bz)          ; no guard: the exe divides
nx = t*bx - px; nz = t*bz - pz; d = sqrt(nx*nx + nz*nz)
if d == 0:
    if step == 0: return 1
    if bz != 0: p.x += sign(bz)*step
    if bx != 0: p.z -= sign(bx)*step
    return 0
if bz*px - bx*pz >= 0:                          ; inside
    if step <= d: return 1
    p.x += nx*(d-step)/d; p.z += nz*(d-step)/d
else: p.x += nx*(d+step)/d; p.z += nz*(d+step)/d
return 0
```

### 7.2 `Class14AdvancePhase` — `0x00477E60`
`[proved]`: only when `hp <= maxhp * frac[phase]` and `4 < state
< 8`; 0→state 10/phase 1; 3→6/4 (+flag bit 0, +0x9C=1); 5→6/6 (same); 6→6/7
(same); 8→6/9 (+0x9C=0, no flag bit).

### 7.3 `Class14TrackAdaptiveRank` — `0x00477FF0`
```
if g_players_in_play == 1:
    if +0x97 > 0: +0x96++; +0x97 = 0
    s = +0x98[active]; now = lives[active] (0x009A5C66 + active*0x130)
    if s != now:
        if now < s: +0x96 -= 3; +0x97 = 0            ; ALWAYS 3
        +0x98[active] = now
else:
    if +0x97 > 0: +0x96++; +0x97 = 0
    for p in 0,1:
        if +0x98[p] != lives[p]:
            if lives[p] < +0x98[p]: +0x96 -= (state in {10,11}) ? 2 : 3; +0x97 = 0
            +0x98[p] = lives[p]
clamp +0x96 to 0..15
```

## 8. The 21 states

Notation: `F` = play cursor `char+0x08`; `len` = `g_motion_play_length[char+0x20]`
(`0x004E07D0`); `blend(m, f0, n)` = `ActorSetMotionBlended(char, m, f0, n)`;
`set(m)` = `ActorSetMotion(char, m)`; `anim(s)` = `+0x62 = s; motion =
anim_slots[s][0]`. Every `PlaySoundId` is listed with its filename.

### 8.1 EntranceA (states 0, 3) — `0x00478160`
```
sub 0: BossIntroBannerSpawn(0x005966B8)                       ; 0x00478181
       phase = 0
       if state == 3: anim(0xE) via set(); g_script_flags[9] = 1; obj+0x34 &= ~0x20000;
                      PlaySoundId(0xC16A9 COMMON\BOMB2_16.WAV); sub = 3
       else:          anim(0x13) via set(); sub++
sub 1: if F == 0x1E: obj+0x34 &= ~0x20000; PlaySoundId(0xC16A9); sub++
sub 2: if F == len: anim(0xE) via blend(.,0,10); g_script_flags[9] = 1; sub++
sub 3: if F == 0x37: PlaySoundId(0x417A9 COMMON2\ZOMBIE_007_16.wav)
       elif F == 0x5A: anim(0xF) via blend(.,0,10); sub++
       (falls into sub 4)
sub 4: if char+0x00 == 0x4B: PlaySoundId(0x17A9 COMMON2\ZOMBIE_002_16.wav)
       if g_bHudShutterState == 1:                            ; set by the banner
           state = 5; sub = 0; target = pos; obj+0x34 &= ~0x8000; state+0x00 &= ~1
           g_script_flags[10] = 1                              ; 0x0047835B
           BossHpBarSpawn(320.0f, 35.0f)                       ; 0x00478361, PUSH 0x420C0000 then 0x43A00000
           g_boss_engaged (0x009CA0EA) = 1                     ; 0x00478369
every frame: if +0x7C == +0x7E and +0x82 == 0: PlaySoundId(0x3516A9 COMMON\HERTBEAT_22.WAV)
```
Switch has 5 cases (table `0x00478398`); sub 3 falls into sub 4 `[proved]`.

### 8.2 EntranceB (states 1, 4) — `0x004783B0`
```
sub 0: BossIntroBannerSpawn(0x005966F8)                       ; 0x004783D6
       phase = 3
       if state == 4: set(0x26); g_script_flags[9] = 1; PlaySoundId(0x417A9); sub = 4
       else: set(0x20); obj+0x34 |= 0x8C000; char+0x64 &= ~1; *(u8*)(*(char+0x40)+1) = 0; sub++
sub 1: if g_script_flags[0x5F]: g_screen_shake_frames = 0x30; +0x9C = 0x1E; sub++    ; 0x00478478
sub 2: v = +0x9C; +0x9C = v - 1; if v == 0: obj+0x34 &= ~0xC000; char+0x64 |= 1; *(…+1) = 1; sub++
sub 3: if F == len: blend(0x26,0,10); obj+0x34 &= ~0x80000; g_script_flags[9] = 1; PlaySoundId(0x417A9); sub++
sub 4: if F == 0x37: PlaySoundId(0x417A9) elif F == 0x5A: blend(0x27,0,10); sub++   (falls into 5)
sub 5: as EntranceA sub 4; hand-over calls BossHpBarSpawn(320.0, 35.0) at 0x004785EA, g_boss_engaged = 1 at 0x004785F2
every frame: if sub > 2 and +0x7C == +0x7E and +0x82 == 1: PlaySoundId(0x3516A9)
```
`g_script_flags[0x5F]` is raised by **block 37's own `set_script_flag 0x5F`**
(0x014F60) and cleared at `0x00468EE4` by a routine that runs 0x6C frames on
stage index 1 `[proved]` (`MOV byte ptr [0x009c725f], 0x0`).

### 8.3 EntranceC (state 2) — `0x00478640`
```
sub 0: set(0x20); obj+0x34 |= 0x8C000; hide model (as B); phase = 8; sub++; (falls into 1)
sub 1: if g_script_flags[11]: g_screen_shake_frames = 0x30; +0x9C = 0x1E; sub++
sub 2: as B
sub 3: if F == len: blend(0x26,0,10); obj+0x34 &= ~0x80000; PlaySoundId(0x417A9); sub++   (no flag 9)
sub 4/5: as B, but the hand-over raises no flag and writes no g_boss_engaged;
         BossHpBarSpawn(320.0, 35.0) at 0x0047881D
every frame: heartbeat as B
```
No banner: stage 5 block 3's script sets the shutter to 1 at 0x002268.

### 8.4 Hunt (5) — `0x00478870`
```
sub 0: if phase in {0,3,8}:
           if (frac[phase] + 1.0) * maxhp * 0.5 < hp: anim(2)
           elif rank == 15: anim(4) elif rank == 0: anim(0) elif rank < 3: anim(3) else: anim(5)
       else anim(5)
       blend(motion, 0, 10); obj+0x34 &= ~0x100; sub++
sub 1 (and sub 0 falling through):
       ActorTurnTowardXZ(xform, x - eye.x, z - eye.z, 0x200)
       d = hypot(x - eye.x, z - eye.z)
       phase 0/3/8: if d < 55.0 (0x005691A0): state 8; sub 0; ActorPickTargetPlayer(obj)
       phase 2/9:   if d < 135.0 and |ActorHeadingErrorTo(...)| <= 0x1FFF: state 9; sub 0; ActorPickTargetPlayer
       phase 5/6/7: same test -> state 12; sub 0; ActorPickTargetPlayer
tail (every frame, any sub): if char+0x20 == 0x19 or 0x1A:
       if state == 5: if B.frame == B.low: B.hold = 0 elif B.frame == B.high: B.hold = -1
       elif B.frame == B.high: B.hold = 10
```

### 8.5 Close (6) — `0x00478C00`
`MatrixLoadIdentity; MatrixRotateY(-yaw); MatrixRotateZ(-roll); MatrixRotateX(+pitch)`
-- the pitch pushed as it is -- then `local = (target - pos)` through it; `local.z < 5.0`
hands over to Roar with `+0x60 = 2`, else the swim toward `target - dir * 50`.
Mode `+0x9C == 1` swims along the middle route edge (`FollowSegment(route1,
route2, 10)`) and, past it, goes to ScriptedBreak. Sub 0 picks slot 0x19 for
phases 2,4,5,6,7,9 else 0x1A (jump table `0x00478E04`).

### 8.6 Roar (7) — `0x00478E30`
```
sub 0: anim(8) via blend; +0x60--; PlaySoundId(0xD17A9 COMMON2\ZOMBIE_018_16.wav); sub++   (falls into 1)
sub 1: if F == len-1 and a player is in play:
           if +0x60 == 0: state 5; sub 0
           else: PlaySoundId(0xD17A9); +0x60--       ; the clip loops, one roar a pass
```
The two sounds are at `0x00478E70` and `0x00478EC9`.

### 8.7 Strike (8) — `0x00478EE0`
```
sub 0: anim(0x15) via blend(.,0,10); obj+0x34 &= ~0x100; sub++
sub 1: if 0x1D < F < 0x38:
           if g_max_attackers == 2: yaw += (obj+0x121 == 0 ? -0x1C : obj+0x121 == 1 ? +4 : 0)
           else: yaw -= 0xC                                  ; obj+0x68, the BOSS turns
       if F == 0x37: obj+0x34 |= 0x2000
       elif F == 0x3C: PlayerTakeDamage(obj+0x121, 1, 6); obj+0x34 &= ~0x2000; +0x94 = max(0, +0x94-1)
       elif F == len-1: state 6; sub 0; +0x9C = 0; obj+0x34 &= ~0x10002000
```

### 8.8 LungeAtCamera (9) — `0x00479030`, LeapAttack (12) — `0x0047A2E0`
```
sub 0: Lunge: anim(0x17) via blend; obj+0x34 = (&~0x2100) | 0x10000000
       Leap:  blend(0x33,0,10);     obj+0x34 |= 0x10000000; obj+0x34 &= ~0x100
       vel = 0; gravity = 0; sub++; (falls into 1)
sub 1: if g_max_attackers != 2:
           ActorTurnTowardXZ(xform, x-eye.x, z-eye.z, 0x200)
       else:
           T = cam * Translate(obj+0x121==0 ? -k : +k, 0, 0)     ; Lunge k = 2.0, Leap k = 3.0
           ActorTurnTowardXZ(xform, x - T.x, z - T.z, 0x200)       ; past the pop, 0x00479120..0x00479164
       if F == 0x23:
           s = hypot(x-eye.x, z-eye.z) * (Lunge && phase == 9 ? -0.0074074073 (0x005691A8) : -0.0076923077 (0x0055D2A4))
           vel = (sin(yaw)*s, 4.0, cos(yaw)*s); gravity = -0.068055555
           PlaySoundId(0x2A16A9 COMMON\ENE_WALK7_22.WAV); sub++
sub 2: if F == 0x41: obj+0x34 |= 0x4000
       if vel.y < 0: obj+0x34 &= ~0x4000; B.hold = (rand() signed-mod 4)*8 + 1; sub++
       B.hold = (B.frame == B.low) ? 1 : 0                          ; overwrites the line above
sub 3: if F == 0x55: obj+0x34 |= 0x4000
       if y < QueryGroundHeightAt(x, y+100, z) + 22.0:
           PlayerTakeDamage(obj+0x121, 1, 6); vel *= 0.1; gravity = 0; +0x9C = 10; +0x94 = max(0,+0x94-1); sub++
       +0x94 = 7
sub 4: v = +0x9C--; if v == 0: obj+0x34 &= ~0x4000; vel.x *= -2.5; vel.y = 0.1; vel.z *= -2.5; gravity = -0.068055555; sub++
sub 5: if y < ground: vel = 0; gravity = 0; y = ground
       if F == len-1: state 6; sub 0; +0x9C = 0; obj+0x34 &= ~0x10002000
all subs: if !(state+0x00 & 4): pos += vel; vel.y += gravity
```

### 8.9 SummonRoundA (10) — `0x00479530`
```
sub 0 or 1 (approach):
    if sub == 0: g_water_attack_slots[0..3] = 0; +0xA8 = rand() signed-mod 2; +0xAC = 0
    L = RotX(pitch)·RotZ(-roll)·RotY(-yaw)·(target - pos)
    if (sub == 0 and L.z < 15.0) or (sub == 1 and L.z < 5.0):
        anim(0x1B) via blend; obj+0x34 = (&~0x100) | 0x2000; B.hold = 0; +0x9C = 3; sub = 2
    else ActorTurnTowardXZ(xform, (target - dir*50) - pos, 0x200)
sub 2: if F == len-1:
           if +0xAC: rank = min(15, rank+1)
           anim(0xC) via blend; obj+0x34 &= ~0x2000; +0x9C--
           +0xA0 = g_class14_summon_counts[rank*3 + +0x9C]; +0xA4 = 0; +0xAC = 1; sub = 4
       elif F == 0x2D: PlaySoundId(0x1617A9 COMMON2\ZOMBIE_035_16.wav)
sub 3: if hp > maxhp*frac[phase] and +0x9C > 0: anim(0x1B); obj+0x34 |= 0x2000; sub = 2
       else anim(0xC); sub = 6
sub 4: if g_players_in_play > 0:
           if +0xA0 == 0:
               if g_enemies_alive == 1: sub = (+0x9C < 1) ? 6 : (anim(0x1B), obj+0x34 |= 0x2000, 2)
           elif +0xA4 == 0:
               if g_enemies_alive < 4 and g_screen_shake_frames == 0:
                   r = rand() % 3
                   if +0xA8 < r: +0xA8 = 1; X = x + dir.z*30 - dir.x*40; t = dir.x*30
                   else:         +0xA8 = 0; X = x - dir.z*40 - dir.x*40; t = dir.x*-40
                   Z = z - t - dir.z*40
                   Y = WaterFieldSampleHeight(&{X, ?, Z}) - 1.0
                   SpawnWaterEnemyAt(X, Y, Z, 100, 1)
                   +0xA0--; +0xA4 = g_class14_summon_delays_a[rank]
           else +0xA4--
       if hp <= maxhp*frac[phase]: sub = 6
       if (players == 1 and lives[active] < +0x98[active]) or lives[0] < +0x98 or lives[1] < +0x99:
           +0xAC = 0; return
sub 5: anim(0xC); sub = 6; (falls into 6)
sub 6: if +0xAC: rank = min(15, rank+1); +0xAC = 0
       if g_enemies_present == 1 and players > 0: state 5; sub 0; phase 2; obj+0x34 |= 0x10000000
```
The dispatch is not what the pseudocode shows: subs 0 and 1
run the approach **and then** the switch (`0x004796FB` through `0x00479BC4`,
case 1 a bare return), so on every frame the boss is still far off, sub 0 also
takes case 0 -- anim 0x1A, sub 1 -- and a frame that enters sub 2 runs case 2 at
once. The placement's `SpawnWaterEnemyAt` result is not tested: `+0xA0--` and
the delay follow the call whatever it did, so **a refused spawn spends a
fish** (round B the same).

### 8.10 SummonRoundB (11) — `0x00479BE0`
```
sub 0: blend(0x23,0,10); obj+0x34 &= ~0x4000; +0x9C = 3; g_water_attack_slots[0..3] = 0; +0xAC = 0; sub++
sub 1: if g_camera_settled or g_camera_free: g_script_flags[11] = 1; sub++       ; 0x00479C78
sub 2: if g_active_cam_path == 0x6A and g_cam_path_frame == 0x5F:
           obj+0x34 &= ~0x10100; B.hold = 0; +0xA8 = 0x1E; sub = 4
sub 3: if F == len:
           if +0xAC: rank++ (cap 15); blend(0x23,0,10); obj+0x34 &= ~0x2000; +0x9C--
           +0xA0 = counts[rank*3 + +0x9C]; +0xA4 = 0; +0xAC = 1; sub = 6
sub 4: v = +0xA8--; if v == 0: +0xA8 = rand() signed-mod 2; goto sub 5
sub 5: if hp > maxhp*frac and +0x9C > 0: blend(0x30,0,10); obj+0x34 |= 0x2000; PlaySoundId(0x1617A9); sub = 3
       else blend(0x23,0,10); sub = 8
sub 6: as SummonA sub 4, with the placement:
           a = (float)(rand() % 11) + 15.0; b = (float)(rand() signed-mod 16) + 15.0; r = rand() % 3
           if +0xA8 < r: +0xA8 = 1; X = b*dir.x + a*dir.z + x; Z = (b*dir.z - a*dir.x) + z
           else:         +0xA8 = 0; X = b*dir.x + (x - a*dir.z); Z = b*dir.z + (z + a*dir.x)
           Y = WaterFieldSampleHeight(&{X,?,Z}) - 10.0
           SpawnWaterEnemyAt(X, Y, Z, 0x50, 2); +0xA0--; +0xA4 = delays_b[rank]
       and the two tails (hp -> sub 8; lost life -> +0xAC = 0, return); the "round spent" arm
       plays blend(0x30), obj+0x34 |= 0x2000, PlaySoundId(0x1617A9), sub 3
sub 7: blend(0x23,0,10); sub = 8; (falls into 8)
sub 8: if +0xAC: rank++ (cap 15); +0xAC = 0
       if present == 1 and players > 0: blend(0x2A,0,10); sub = 9; +0x9C = rand() signed-mod 2; obj+0x34 |= 0x100
sub 9: T = (+0x9C == 0 ? 190.0 : 270.0, y, -2150.0)
       if !ActorPointIsAhead(xform+0x24, xform, &T): ActorTurnTowardXZ(xform, x - T.x, z - T.z, 0x200)
       else: obj+0x34 |= 0x10000; sub++
sub 10: if settled or free: g_script_flags[12] = 1; sub++                         ; 0x0047A264
sub 11: if g_active_cam_path == 0x6B and g_cam_path_frame == 100: state 13; sub 0; phase 5
```
`ActorPointIsAhead` (`0x0045BC10`) returns 1 iff `RotX(-pitch)·RotZ(-roll)·RotY(-yaw)·(T - pos)` has `z > 0`
(`0x0045BC7E..0x0045BC93`) `[proved]`.

### 8.11 Reposition (13) — `0x0047A7C0`
```
sub 0: m = (route2.x + route1.x) * 0.5
       if +0x9C == 0: set(0x38); x = m - 65.0 else set(0x39); x = m + 65.0
       yaw = ftol(atan2(-dir.x, -dir.z) * K); z = target.z (state+0x18)
       y = QueryGroundHeightAt(x, y+100, z); obj+0x34 &= ~0x84000; sub++
sub 1: if F == len-1: state 5; sub 0; obj+0x34 &= ~0x2100; state+0x00 &= ~1; B.hold = 0
       elif F == 10: obj+0x34 &= ~0x10000
                     SpawnPropStripEffect(&{x,y,z, 0, g_camera_block_yaw_bams[g_camera_index], 0}, 0, 4.5f (0x40900000))
```

### 8.12 LeapFromSide (14) — `0x0047A990`
```
sub 0: m as above; x = (+0x9C == 0) ? m - 60.0 : m + 60.0; blend(0x33, 0x23, 0); z = target.z
       y = QueryGroundHeightAt(x, y+100, z)
       if g_max_attackers != 2:
           yaw = ftol(atan2(x - eye.x, z - eye.z) * K)
           s = hypot(...) * -0.0076923077; vel = (sin(yaw)*s, 4.0, cos(yaw)*s); gravity = -0.068055555
           obj+0x34 = (&~0x84000) | 0x10000000; sub++
       else: T = cam * Translate(obj+0x121 == 0 ? (+0x9C==0 ? -3 : -5) : (+0x9C==0 ? +5 : +3), 0, 0)
             yaw = ftol(atan2(x - T.x, z - T.z) * K)      ; past the pop, 0x0047AAC2..0x0047AAF9
             then the same launch, its speed from the EYE's distance, not T's
sub 1: if F == 0x41: obj+0x34 |= 0x4000
       elif F == 0x28: SpawnPropStripEffect(&{pos, 0, camyaw, 0}, 0, 4.5)
       elif F == 0x2D: EvtOpPlayDialogue2D(+0x9C == 0 ? 0x56 : 0x55); obj+0x34 &= ~0x10000
       if vel.y < 0: obj+0x34 &= ~0x6100; B.hold = (rand() signed-mod 4)*8 + 1; sub++
sub 2: if B.hold == 0 and B.frame == B.low: state+0x00 &= ~1; sub++
       (falls into 3 **whether or not** it advanced -- no break)
sub 3: landing as §8.8 sub 3 but sets sub = 4 directly; +0x94 = 7 always
sub 4/5: as §8.8, exit to state 6 with +0x9C = 0 and obj+0x34 &= ~0x10000000
all subs: integrate unless state+0x00 & 4
```
Message groups `[proved]` (`ExeTables.screenMessages`): **0x55 = "Right."**
(`ST2\117_J.WAV`/`117_GA.WAV`), **0x56 = "Left."** (`ST2\118_J.WAV`/`118_GA.WAV`) —
the partner calls the side: `+0x9C == 0` is `x - 60`, "Left.".

### 8.13 ScriptedBreak (15) — `0x0047AF60`
```
sub 0: blend(0x24,0,10); PlaySoundId(0x2A16A9); sub++
sub 1: if F == len-1: +0xA4 = 10; obj+0x34 |= 0x14000; sub++ elif F == 10: obj+0x34 |= 0x80000
sub 2: v = +0xA4--; if v == 0:
           y = WaterFieldSampleHeight(&pos); x -= dir.x*40; z -= dir.z*40
           yaw = (s16)(-0x8000 - g_camera_block_yaw_bams[g_camera_index])
           SpawnPropStripEffect(&{x,y,z, 0, camyaw, 0}, 0, 8.0f (0x41000000)); +0xA4 = 0x14; sub++
sub 3: v = +0xA4--; if v == 0: if phase == 4: state 11; sub 0 else sub++
sub 4: if settled or free:
           DAT_009CA094 = 1                                         ; 0x0047B138
           phase 6: g_script_flags[13] = 1 / phase 7: g_script_flags[15] = 1
           +0x9C = (rand() signed-mod 2 == 0) ? 0x6D : 0x6C; +0xA0 = 0; sub++
sub 5: if +0xA0 == 0xA1:
           DAT_009CA094 = 0                                         ; 0x0047B1B7
           phase 6: flag 14 / phase 7: flag 16
           +0x9C = rand() signed-mod 2; state 14; sub 0; ActorPickTargetPlayer(obj)
       else:
           CamEvalPath7(+0x9C, (float)+0xA0, &g_camera_block_eye (0x009A60C0), &g_camera_block_target (0x009A60D8), &tmp, &tmp)
           +0xA0++                                                  ; 0x0047B21F..0x0047B251
```
`DAT_009CA094 == 1` makes `CameraDriverSelectMode` (`0x004026AB`) force
`g_camera_mode = 6`, the empty `PoseHookNone` hook `[proved]` — so for those
161 frames nothing else moves the camera block and the boss's writes stand.
The global is `g_camera_driver_held`; the banner, class 0x22's death and others
write it too.

### 8.14 CuedMotion (16) — `0x0047B280`
```
sub 0: if +0x06 == 11: blend(0x29,0,10)
       else: anim(10) via blend; if obj+0x34 & 0x20000: y = QueryGroundHeightAt(x, y+100, z)
       B.rate = -1.0; B.hold = 0; sub++
sub 1: ActorTurnTowardXZ(xform, (target - dir*100) - pos, 0x200)
       if F == len-1:
           switch +0x06: 7 -> state 5, +0x60 = 0, sub 0; 8/9/12/14 -> state 6, sub 0, +0x9C = 0;
                         10/11 -> state = +0x06, sub = +0x07 - 1; else state = +0x06, sub 0
           obj+0x34 &= ~0x40000000; B.hold = ((rand() % 7) + 4) * 5; return
       if F == 0x14 and obj+0x34 & 0x4000000:
           phase 2: state 0x12; g_script_flags[17] = 1
           phase 7: state 0x13; g_script_flags[17] = 1              ; 0x0047B46B
           phase 9: state 0x14; g_script_flags[31] = 1              ; 0x0047B458
           sub = 0
       if B.frame == B.low: B.hold = -1
```

### 8.15 KnockedDown (17) — `0x0047B4C0`
```
sub 0: +0xA0 = 10; +0x9C = 10; anim(0x14); v = +0x9C--; blend(motion, +0xA0 - +0x9C, v)   ; frame 1, blend 10
       dx,dy,dz = pos - eye
       pitch = (s16)ftol(atan2(dy, hypot(dx,dz)) * K); yaw = (s16)ftol(atan2(dx, dz) * K)   ; 0x0047B54E..0x0047B5A1
       phase 2: vel.x = cos(pitch)*dir.x*-2.5 (0x005691A4); vel.z = cos(pitch)*dir.z*-2.5
       else:    vel.x = sin(yaw)*cos(pitch)*2.5 (0x004C4CBC); vel.z = cos(yaw)*cos(pitch)*2.5
       vel.y = sin(pitch)*2.5; gravity = -0.08166666; B.rate = -1.0; B.hold = 0; sub++
sub 1: if +0x9C != 0: anim(0x14); v = +0x9C--; blend(motion, +0xA0 - +0x9C, v)   ; blend length = OLD counter
       if B.frame == B.low: B.hold = -1
       g = ground; if y < g:
           vel.x *= 0.1; vel.z *= 0.1; gravity = 0; vel.y = 0; y = ground
           if obj+0x34 & 0x4000:
               +0xA0 = 10; +0x9C = 10; anim(0x10); v = +0x9C--; blend(., 1, v); obj+0x34 &= ~0x4000
               PlaySoundId(phase == 2 ? 0xC16A9 BOMB2 : 0x1D16A9 COMMON\DAMAGE4_22.WAV); sub = 3; break
           sub = 2
       (falls into 2)
sub 2: if F == len-1: if sub == 1: obj+0x34 |= 0x4000 else: (the same roll entry as above, sub = 3)
       if B.frame == B.low: B.hold = -1
sub 3: if +0x9C != 0: anim(0x1D); v = +0x9C--; blend(., +0xA0 - +0x9C, v)
       if F == len: vel.x = vel.z = 0; anim(0xD) via blend(.,0,10); sub = 4
       if B.frame == B.low: B.hold = -1
sub 4: if F == len-1: state 6; +0x9C = 0; sub 0; obj+0x34 &= ~0x40000000; B.hold = ((rand()%7)+4)*5
       elif F == 0x3C and dead: death fork as CuedMotion (0x0047BA6E flag 17, 0x0047BA5B flag 31); sub = 0
all subs: pos += vel; vel.y += gravity                     ; unconditional
```

### 8.16 DeathA (18) — `0x0047BAD0` (phase 2; stage 2 blocks 35/39)
```
sub 0: anim(0x1C) via blend(.,0,10); state+0x00 |= 1
       pos = (-1338.2 (0xC4A74666), -23.0 (0xC1B80000), -1931.1 (0xC4F16333)); pitch = 0; yaw = 0x8000; roll = 0
       +0x9C = 0x78; FUN_0041D650(0x2B) (asset job: load pol 43 = eff_2.bin); g_boss_engaged = 0; sub++; (falls into 1)
sub 1: if !Class14FollowSegment(pos, route1, route2, 10.0): anim(6) via blend(.,0,10); PlaySoundId(0x1417A9 COMMON2\ZOMBIE_032_16.wav); sub++
       else ActorTurnTowardXZ(xform, (target - dir*50.0 (0x0055D2AC)) - pos, 0x200)
sub 2: if F == 0xF: obj+0x34 |= 0x80000
       B1 = world point of bone 1 (cam * char+0x130)
       if WaterFieldSampleHeight(&B1) >= B1.y:                     ; past the pop, 0x0047BCA6..0x0047BD56
           obj+0x34 |= 0x20000; state+0x00 |= 2; the four foot-contact strengths = 0
           SpawnPropStripEffect(&{B1, 0, camyaw, 0}, 0, 3.0f); SpawnPropStripEffect(&{B1, 0, 0, 0}, 2, 3.0f)
           ; the second is the same block with the yaw word zeroed (`MOV [ESP+0x40], EBX` at 0x0047BD45)
           sub++
sub 3: if F == len: anim(0x12); char+0x20 = 0x2C; char+0x08 = 0; ActorShiftToHoldBone1Position(obj)
       blend(0x2C,0,10); vel = (-0.03 (0xBCF5C28F), 0, -0.005 (0xBBA3D70A)); gravity = 0.0006805556 (0x3A326750); yaw = 0x4000; sub++
sub 4: x += vel.x; z += vel.z; vel.y += gravity; y += vel.y
       if WaterFieldSampleHeight(&pos) <= y: +0x58 = 0; +0x5C = 0x200; vel.y /= sin(0x200 BAMS); obj+0x34 |= 0x4000; sub++
sub 5: x += vel.x; z += vel.z; old = +0x58; +0x58 += +0x5C
       if (+0x58 ^ old) & 0x8000: vel.y *= 0.8 (0x004C43A8); if +0x5C > 0x80: +0x5C -= 0x40; if vel.y < 0.3: +0x58 = 0; sub++
       y = WaterFieldSampleHeight(&pos) + sin(+0x58)*vel.y; +0x9C--
sub 6: x += vel.x; z += vel.z; y = WaterFieldSampleHeight(&pos); +0x9C--
every frame: if +0x9C == 0: obj+0x34 |= 0x10000; g_enemies_present--; FUN_0041D690(0x2B) (free pol 43)
```

### 8.17 DeathB (19) — `0x0047BFE0` (phase 7; blocks 37/41)
Sub 0: `blend(0x3A,0,0)`, bit 0, pos (227.3, 23.0, -2121.9), yaw 0x8000, vel/gravity 0,
`+0x9C = 0x78`, load pol 43, `PlaySoundId(0x1717A9 COMMON2\ZOMBIE_036_16.wav)`,
`g_boss_engaged = 0`. Sub 1 as DeathA's but `blend(0x1B,0,5)`. Sub 2: `F == 0x2D` →
`obj+0x34 |= 0x4000`, vel `(sin(yaw)*0.7, -1.0, cos(yaw)*0.7)`, gravity -0.08166666,
sub++; `F == 0xF` → `|= 0x80000`. Sub 3: integrate; bone 2 world point
(`cam * char+0x1C0`); when its `y <= WaterFieldSampleHeight(&pos)`: splashes
(`kind 0, 8.0` then `kind 2, 3.0` with the yaw word zeroed), `vel *= 0.5`,
gravity 0.013611111, `obj+0x34 &= ~0x4000`, sub++. Subs 4..7 = DeathA's 3..6;
`+0x9C` counts in 6/7; at 0 the same three writes.

### 8.18 DeathC (20) — `0x0047C5F0` (phase 9; stage 5 block 3)
Sub 0: `blend(0x3A,0,0)`, `obj+0x34 |= 0x10000`, bit 0, pos (583.2, -71.3, -4979.7),
yaw 0x8000, vel 0, load pol 43, ZOMBIE_036. Sub 1 as DeathB. Sub 2: `F == 0x2D` → the
dive and `+0x9C = 0x1E`; `F == 0xF` → 0x80000. Sub 3: integrate, `+0x9C--`, at 0 a
splash at bone 2 (`kind 0, 8.0`) and `+0x9C = 0x5A`. Sub 4: `+0x9C--`, at 0
`g_enemies_present--` and free pol 43. No surface ride, no `g_boss_engaged`,
and sub 4 does not integrate.

## 9. Banner and health bar

Banner records `[proved]` (read from `.rdata`, stride 0x40):

| record | passed by | flag | cam path | end frame | message | sprite rows |
|---|---|---|---|---|---|---|
| `0x005966B8` | EntranceA `0x00478181` | **9** | 0x65 | 300 | 0x1821 | {0xBB, 14.0, 104.0, 1.0}, {0xC9, 264.0, 104.0, 1.0} |
| `0x005966F8` | EntranceB `0x004783D6` | **9** | 0x69 | 300 | 0x1821 | same |
| (class 0x19's) `0x005972F8` | — | 30 | 181 | 300 | 0x1873 | {0xBD, …}, {0xCB, 224.0, …} |

So the stage-2 chain is: entrance raises `g_script_flags[9]` → banner waits on it
→ 300 frames → `g_bHudShutterState = 1` (`0x00437F1E`) → entrance hand-over →
flag 10 + `BossHpBarSpawn(320.0, 35.0)`.

Health bar `[proved]`: spawned at `0x00478361` (A), `0x004785EA` (B),
`0x0047881D` (C), all `(320.0f, 35.0f)`. Fill `DAT_009C8E10` written by this class
only at `0x004767F8` (0.0 on the killing shot) and `0x0047684E` (`hp/maxhp` after
every damaging shot); nothing else in class 0x14 touches it.

## 10. Sounds and lines

31 `PlaySoundId` sites (xref list filtered to `0x00475E90..0x0047C960`, plus
the unreferenced body of §6 disassembled in full — none there) `[proved]`:

| id | file | where |
|---|---|---|
| 0x316A9 | COMMON\BLOOD03_16.WAV | damaging hit |
| 0x1117A9 | COMMON2\ZOMBIE_022_16.wav | reaction |
| 0xC16A9 | COMMON\BOMB2_16.WAV | EntranceA sub 0/1; KnockedDown land/roll (phase 2) |
| 0x1D16A9 | COMMON\DAMAGE4_22.WAV | KnockedDown land/roll (other phases) |
| 0x417A9 | COMMON2\ZOMBIE_007_16.wav | entrances, F 0x37 and clip changes |
| 0x17A9 | COMMON2\ZOMBIE_002_16.wav | entrances, char+0x00 == 0x4B |
| 0x3516A9 | COMMON\HERTBEAT_22.WAV | entrances, flipbook A at low end |
| 0xD17A9 | COMMON2\ZOMBIE_018_16.wav | Roar |
| 0x2A16A9 | COMMON\ENE_WALK7_22.WAV | Lunge/Leap launch, ScriptedBreak sub 0 |
| 0x1617A9 | COMMON2\ZOMBIE_035_16.wav | SummonA F 0x2D; SummonB round start |
| 0x1417A9 | COMMON2\ZOMBIE_032_16.wav | deaths, sub 1 end |
| 0x1717A9 | COMMON2\ZOMBIE_036_16.wav | DeathB/C sub 0 |
| 0x4116A9 | COMMON\SIBUKI2_16.WAV | inside `SpawnPropStripEffect` kind 0 (the splashes) |

Dialogue: one site, `EvtOpPlayDialogue2D(0x55 | 0x56)` in LeapFromSide (§8.12).

## 11. The summons

### 11.1 `SpawnWaterEnemyAt(x, y, z, lifetime, subtype)` — `0x00438640`
`[proved]`: refuse if `g_players_in_play == 0`, or (1..2 players) if any
`g_water_attack_slots` entry is set; `g_water_level = -24.9f (0xC1C73333)`;
`ActorAlloc(FishUpdate, 0x1314)`, `ActorClearGameFields`, `obj+0x3C = -1`,
`obj+0x124 = 2.1f (0x40066666)`, sub = `ActorAllocSub(0x84)`, pos, `sub+0x6C =
subtype`, `sub+0x7E = lifetime ? lifetime : 0x50`, home = pos, alive++,
present++, `+0x120 = +0x121 = 0xFF`, `RegisterEnemySlot`, `FishClaimSlotAndLunge`.

Callers: SummonRoundA `(…, 100, 1)`, SummonRoundB `(…, 0x50, 2)` — the only two.

### 11.2 What sub-types 1 and 2 do (class 0x51)
Verified against the exe `[proved]`: straight into the lunge (no rise, no bob);
`FishStateLunge` sub-type 1 adds `sin(b)*6.0 (0x0055E1C8)` to y, sub-type 2 swings x
by `±2` and steps y/z linearly (`0x00439190..0x004392A9`); `FishCheckShot` counts
accuracy only for sub-type 0 (`0x00438C77/0x00438CA6/0x00438CBF`); `FishStateFlung`
tests a floor only for sub-type 1 (`0x004394BE`). Life cycle and counters: bite
within 8.0 (`PlayerTakeDamage(permit, 1, 9)`) or abandon past 200 or time out at
`2*lifetime` → FallBack → slot back at 0x20 → both counters and despawn at 0x40;
shot → alive-- at once, present-- when it reaches the water (Flung) or at once
(submerged) → Sink 300 frames → despawn. The pacing the boss relies on:
`SpawnWaterEnemyAt` refuses while a slot is held, and the round's
`g_enemies_alive == 1` / `g_enemies_present == 1` tests wait for every fish.

### 11.3 The height source: the wave field (classes 0x16/0x17) `[proved]`
* `WaterFieldCreate` (`0x00442290`, class 0x16): `g_water_wave_field =
  ActorAllocRaw(0x2C)`; `[1] = 0` (mask), `[0] = 0` (count), `[2] = obj+0x44`
  (plane y); `ActorKill`.
* `WaterWaveSourceAdd` (`0x004422D0`, class 0x17): first free bit i of `[1]`
  (0..7): `src = ActorAlloc(g_wave_source_kinds[obj+0x11C].fn, .size)`
  (`0x005644E4`: kind 0 `0x004420C0` travelling, kind 1 `0x004421B0` circular,
  both 0x68); `src+0x3C/+0x40/+0x44 = obj pos`, `+0x48/+0x4C/+0x50 = obj
  +0x64/+0x68/+0x6C`, `+0x38 = 0`, `+0x54 = i`, mask |= bit i, `+0x58 = tail
  ptr`; `ActorKill`.
* Tick, first frame (`+0x38 == 0`): `+0x34 = eval fn`, `{+0x5C amp, +0x60
  wavelength, +0x64 speed} = tail[0..2]`, field count++, `+0x38 = 1`. Every frame:
  travelling `+0x3C += speed`; circular `a = +0x4C (BAMS)`: `+0x3C += sin(a)*speed;
  +0x44 += cos(a)*speed`.
* `WaveEvalTravelling(src, p)` (`0x00442110`): `a = +0x4C`; `c = cos(a)`; if
  `|c| > 0.5` (`0x004C43AC`): `u = c*p.z + src+0x3C` else `u = sin(a)*p.x +
  src+0x3C`; `h = cos(ftol(u*65536.0 (0x004E1FDC)/wavelength) BAMS) * amp`.
* `WaveEvalCircular(src, p)` (`0x00442210`): `r = hypot(p.x - src.x(+0x3C),
  p.z - src.z(+0x44))`; `f = max(0, 1 - r*0.01 (0x004D5464))`; `h = cos(ftol(r
  * 65536/wavelength) BAMS) * amp * f`.
* `WaterFieldSampleHeight(p)` (`0x00442390`): `h = plane_y`; for bit i in 0..7
  while `seen < count`: if `mask & (1<<i)`: `h += sources[i]->eval(src, p)`,
  seen++. Returns `h` in ST0.

Blocks 35/39 therefore sample `-25.5007 + two waves`; 37/41 `-25.0` flat.

### 11.4 The foot contacts' only consumer (`0x00441D1C`, class 0x15)
The floating-prop routine at `0x00441CC0..` walks the four `g_class14_foot_contacts`;
for a live one within its test window it pushes the prop by `strength *
[0x0056451C]` along the offset and accumulates `strength * [0x00564518]`.

## 12. Two-player arms (all `[proved]`, none reachable with one player)
* `Class14ResolveShotBone` walks both order entries (§5.1).
* `g_class14_bone_damage` column `players-1`; `Class14TrackAdaptiveRank`'s second arm (§7.3).
* Strike's turn `-0x1C`/`+4` by `obj+0x121` (§8.7).
* Lunge/Leap/LeapFromSide aim at camera-space `±2` / `±3` / `±3,±5` (§8.8, §8.12).
* SummonA/B's lives test covers both players.
* `ActorPickTargetPlayer` (`0x00426170`) at every attack start.

## 13. Open questions
* What `obj+0x34` bits `0x80000` and `0x10000000` do for this class (set and
  cleared here, no reader found in the class).
* The banner message `0x1821` text and the flipbook models' appearance
  (render them before naming them).
