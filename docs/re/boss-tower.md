# Class 0x45 — the stage-3 boss ("the Tower")

A transcription-grade reading of spawn class `0x45`, written before any of it
is ported. Every address below was read from the instruction stream, not from
the pseudocode: this class is the worst case for L35 in the image — Ghidra
treats `MatrixStackPop` (`0x004A9840`) as no-return, so **most of this
class's function bodies stop in the middle** and the code after each pop (a whole state machine
in one case, the camera-tracking publish in another) appears in no
decompilation and no xref list. The tails are listed in
[Ghidra hazards](#ghidra-hazards-l35-and-l1).

Markers follow the project convention: `[proved]` the code says so,
`[likely]` inference with the evidence named, `[open]` undetermined.

## What it is

**Boss 3.** Not a guess from where it appears: the class builds character type
`0x49` = `boss3.bin` (20 nodes) and `0x48` = `boss3l.bin` (27 nodes), and every
class sound goes through `Boss3PlayStageSound`, whose two tables resolve to
`STAGE3_SE\BOSS3_n.wav` and `STAGE6_SE\BOSS3_n.wav` `[proved]`. The user's name
for it is "the Tower"; nothing in the binary names it, so the code is named
`Boss3*` (as class `0x19`'s is `Boss4*`).

It is **five heads and a body**, not one actor:

| subtype (`desc+0x25` → `obj+0x130C`) | init / update | what it is |
|---|---|---|
| 0 | `Boss3OpeningHeadInit` / `Boss3OpeningHeadUpdate` | a `boss3.bin` head in the opening vignette that takes the first bystander |
| 1 | `Boss3OpeningBystanderInit` / `Boss3OpeningBystanderUpdate` | that bystander (`hito_oyaji.bin`) |
| 2 | `Boss3FightHeadInit` / `Boss3FightHeadUpdate` | **the five fighting heads**, index `0..4` in `desc+0x22`; index 2 is the big `boss3l.bin` head |
| 3 | `Boss3HeldBystanderInit` / `Boss3HeldBystanderUpdate` | two civilians held in the mouths of heads 0 and 4 |
| 4 | `NoOpStub` (`0x0041EBB0`) | nothing — no shipped spawn |
| 5 | `Boss3BodyInit` / `Boss3BodyUpdate` | **the body**: a `boss3l.bin` that swims the canal along a path, drives the camera itself, surfaces and lunges |

`[proved]` — the subtype table is the jump table at `0x0041FD8C` (below), and
the character types are literals in each init.

`obj+0x130C` is the opcode-0x09 descriptor's `+0x25` byte, sign-extended:
`MOVSX ECX, byte ptr [EDI + 0x25]; MOV dword ptr [ESI + 0x130c], ECX` at
`0x004088F7` in `EvtOpSpawnPlaced09` `[proved]`. `desc+0x24` goes to
`obj+0x1F4` (the character type) the same way.

### `desc+0x22` (`obj+0x11C`/`obj+0x11E`) for this class — L3

* **subtype 2**: the head **index 0..4**. `Boss3FightHeadInit` reads
  `MOVSX EAX, word ptr [ESI + 0x11c]` at `0x0041FE3E`, stores the head in
  `g_boss3_heads[idx]` and the index in `obj+0x131B`, then **overwrites
  `obj+0x11C` with the head's hit points** (`MOV word ptr [ESI + 0x11c], DX` at
  `0x0041FE79`). `[proved]`
* **subtype 3**: the bystander index 0/1 → `g_boss3_bystanders[idx]`,
  `obj+0x131B`; then `obj+0x11C = 1`. `[proved]`
* **subtype 5**: ignored; `obj+0x11C = 0x78` (120 hit points). `[proved]`
* subtypes 0 and 1: not read. `[proved]`
* `obj+0x11E` is read by no instruction of this class (an operand search for
  `+ 0x11e]` over the image, plus a manual read of every undefined tail below).
  `[proved]`

## Where it appears

37 spawns, all `spawn_placed` (op `0x09`) `[proved]` from the dumps:

| stage (repo numbering) | block | spawns (descriptor address: subtype, idx, char byte) | `g_boss3_variant` |
|---|---|---|---|
| 3 (`st3evtbl.bin`, scene 2) | 11 | `0x009803AC` 0; `0x009803D4` 1 (`0x34`); heads `0x0098044C..0x009804EC` 2 ×5 (idx 0..4); `0x009803FC` 3 idx 0 (`0x34`); `0x00980424` 3 idx 1 (`0x2E`); later `0x00980514` 5 | 0 |
| 3 | 13 | `0x00981348` 0; `0x00981370` 1 (`0x34`); heads `0x009813E8..0x00981488` 2 ×5; `0x00981398` 3 idx 0 (`0x34`); `0x009813C0` 3 idx 1 (`0x2E`); later `0x009814B0` 5 | 1 |
| 3 | 15 (Boss Mode) | heads `0x0098044C..0x009804EC` (the block-11 descriptors); later `0x00980514` 5 | 0 |
| 3 | 17 (Boss Mode) | heads `0x009813E8..0x00981488` (block 13's); later `0x009814B0` 5 | 1 |
| 6 (`st6evtbl.bin`, scene 5) | 2 | heads `0x00979320..0x009793C0` 2 ×5, `y ≈ 2498.8` | 2 |

The variant is `Boss3ClassHandler`'s choice from `g_evt_block_index`
(`0x009A2BC0`): in Boss Mode `(block != 0xF)`, otherwise block 2 → 2, 11 → 0,
13 → 1, and any other block keeps the previous value `[proved]`. So blocks 15
and 17 are the Boss-Mode replays of 11 and 13, with no opening vignette and no
held bystanders — the descriptor lists above confirm it `[proved]`.

Stage 6's block 2 has only the five heads and no body: the late-game
re-appearance is the head fight alone, with all five heads killable
`[proved]` (variant 2; see the damage model).

### The script around the fight, and the gates this class opens

**This class writes no script flag.** A byte search for `72 9c 00` — the
little-endian tail of `0x009C72xx` — finds nine hits in `0x0041FC00..0x00425010`
and every one is a read (`0x004205F9` flag 3, `0x00420EAE` 0, `0x00420F3E` 1,
`0x00420F86` 2, `0x00422D7F` 1, `0x00422DBE` 2, `0x00422FEE` 0, `0x00423D16` 4,
`0x00424C14` 4) `[proved]` (L32: the operand search misses `0x004205F9`,
which Ghidra has never disassembled).

It **reads** flags 0–4, and the scripts raise all five themselves
`[proved]` (dumps):

| flag | read by | block 11 | block 13 | block 15 | block 17 | st6 block 2 |
|---|---|---|---|---|---|---|
| 3 | opening bystander starts | `0x008698` | `0x00979C` | — | — | — |
| 0 | heads 0/4 grab; **variant 2: the fight starts** | `0x008894` | `0x0098B4` | — | — | `0x001E9C` |
| 1 | head 0 spawns `Boss3IntroCardUpdate` | `0x0088C0` | `0x0098E8` | `0x00A4BC` | `0x00A988` | — |
| 2 | **the fight starts** (variants 0/1) | `0x008904` | `0x009934` | `0x00A500` | `0x00A9D4` | — |
| 4 | the body despawns | `0x008AD0` | `0x009A9C` | `0x00A6AC` | `0x00AB28` | — |

The gates are **`wait_enemies_present 0`** (op `0x43`, which reads
`g_enemies_present` `0x009C7006` and additionally needs `g_camera_free` in
this port's walker), two per stage-3 block and one in stage 6 `[proved]`:

| block | gate at | opened by |
|---|---|---|
| 11 | `0x008948` | head idx 2, `Boss3FightHeadUpdate` phase 2: `DEC word ptr [0x009c7006]` at `0x00421623` (and `g_enemies_alive` at `0x0042162A`), 180 frames after the last head fell |
| 11 | `0x008A6C` | the body's death, `Boss3BodyUpdate`: `DEC` at `0x0042340C` / `0x00423413`, and `g_camera_free = 1` at `0x00423420` |
| 13 | `0x009974`, `0x009A38` | same two |
| 15 | `0x00A544`, `0x00A650` | same two |
| 17 | `0x00AA08`, `0x00AACC` | same two |
| st6 2 | `0x001EB4` | head idx 2's phase-2 decrement |

Only two actors of the class count: head idx 2 (`INC` at `0x00420082`/
`0x00420089`) and the body (`0x00420522`/`0x00420529`). The byte searches for
`06 70 9c 00` and `4a 90 9c 00` find exactly these eight sites in the class
range `[proved]`.

Around the first gate the script runs `queue_event 0x21 4 0` (the enemy-tracking
camera, `CameraDriverSelectMode`); the heads are in `g_enemy_slots`
(`RegisterEnemySlot` at init, cleared on death), so the hand-back that raises
`g_camera_free` is the ordinary one `[likely]` — nothing in the class writes
`g_camera_free` except the body's death. During the body phase the class sets
`0x009CA094` (being named `g_camera_driver_held` on main) to 1, which forces
camera mode 6 and leaves the camera to the body `[proved]`
(`CameraDriverSelectMode` at `0x004026AB`).

`goto_scene_state_when_alive 3` (op `0x32`) and `wait_script_flag 0xFE` in the
same blocks are not this class's.

## Class-wide state (the globals)

One fight at a time, so the class keeps its shared state in globals, all in
`.bss` at `0x007DC6F0..0x007DC80F` plus one counter `[proved]` (every
reference is inside the class range, per `get_xrefs_to`, except the
`NetworkModeRunPhase` store noted below):

| address | name | type | meaning |
|---|---|---|---|
| `0x007DC6F0` | `g_boss3_heads_attacking` | s8 | heads with an armed or running attack; the scheduler arms another only while `< 2` |
| `0x007DC6F1` | `g_boss3_variant` | s8 | 0 / 1 / 2, above |
| `0x007DC6F4` | `g_boss3_heads` | actor*[5] | the fighting heads by index; slot 0 is also written by the opening head and by the body |
| `0x007DC71C` | `g_boss3_last_head` | s8 | the head that last bit or was hit; tracked by the camera while nobody attacks. Seeded 2 |
| `0x007DC71E` | `g_boss3_attack_delay` | s16 | frames to the next armed attack |
| `0x007DC720` | `g_boss3_head_hp_pool` | s16 | the heads' shared bar: 180 or 150 |
| `0x007DC724` | `g_boss3_pose_bone` | s32 | `Boss3ComposeBonePose`'s loop index, stored and never read |
| `0x007DC728` | `g_boss3_heads_left` | s8 | 5 at the start |
| `0x007DC72C` | `g_boss3_bystanders` | actor*[2] | the civilians |
| `0x007DC738` | `g_boss3_phase` | s8 | the head fight: 0 intro, 1 fight, 2 all down, 3 despawn |
| `0x007DC740` | `g_boss3_card_pieces` | 8 × 0x14 | `{x, y, z, s32 yaw, scale}` of the intro card |
| `0x007DC7E0` | `g_boss3_track_point` | vec3 | smoothed weak-bone world point the camera tracks |
| `0x007DC7F0` | `g_boss3_opening_bystander_pos` | vec3 | |
| `0x007DC800` | `g_boss3_opening_bystander_yaw` | s32 | written, not read |
| `0x007DC80C` | `g_boss3_rank` | s8 0..15 | the heads' own adaptive rank |
| `0x00811200` | `g_boss3_rand_counter` | u32 | `Boss3NextRand`'s state (also zeroed by `NetworkModeRunPhase` at `0x0049F55D`) |

`.rdata` tables `[proved]` (`read_memory`; values decoded):

| address | name | content |
|---|---|---|
| `0x00588EA4` | `g_boss3_sounds_st3` | u32[8]; `[n]` = `STAGE3_SE\BOSS3_n.wav`: 1 `0x241AA9`, 2 `0x251AA9` (`_22`), 3 `0x261AA9` (`_22`), 4 `0x271AA9` (`_22`), 5 `0x281AA9`, 6 `0x281AA9`, 7 `0x2A1AA9`. `[0]` is the tail of a `"GHT GUN"` string and never indexed |
| `0x00588EC0` | `g_boss3_sounds_st6` | u32[8]; `STAGE6_SE\BOSS3_n`: 1 `0x3E25A9` … 5 `0x4225A9` (`_16`), 6 `0x4225A9`, 7 `0x4425A9` (`_16`) at `0x00588EDC` |
| `0x00588EE0` | `g_boss3_idle_motions_a` | s16[12] `93 94 95 96 97 93 94 95 96 97 98 0` |
| `0x00588EF8` | `g_boss3_idle_motions_b` | s16[12] `80 81 82 83 83 80 81 82 83 83 84 0` |
| `0x00588F10` | `g_boss3l_idle_motions` | s16[6] `67 68 69 70 71 72` |
| `0x00588F1C` | `g_boss3_attacks_a` | {motion, hit frame}[4] `(74,68) (75,61) (74,68) (75,61)` |
| `0x00588F2C` | `g_boss3_attacks_b` | `(77,70) (77,70) (78,61) (78,61)` |
| `0x00588F3C` | `g_boss3l_attacks` | `(64,50) ×3` |
| `0x00588F48` | `g_boss3_hurt_motions` | s16[4] `99 100 85 86` |
| `0x00588F50` | `g_boss3_swap_motions` | s16[2] `92 79` |
| `0x00588F54` | `g_boss3_body_obj_paths_a` | {s16 op_ slot, from, to}[8]: 354 −245..0, 355 0..180, 356 40..500, 357 330..619, 358 530..870, 359 750..1000, 360 859..1150, 361 1050..1300 |
| `0x00588F84` | `g_boss3_body_obj_paths_b` | [9]: 362 0..180, 363 180..460, 364 200..480, 365 320..619, 366 410..739, 367 600..880, 368 679..1000, 369 829..1100, 370 900..1000 |
| `0x00588FBC` | `g_boss3_body_cam_paths_a` | {cp_ slot, from, to}[8]: 137 0..245, 138 0..180, 139 40..500, 140 330..619, 141 530..870, 142 750..1000, 143 859..1150, 144 1050..1300 |
| `0x00588FEC` | `g_boss3_body_cam_paths_b` | [9]: 150..158, same frame ranges as the obj table |
| `0x00589024` | `g_boss3_body_events_a` | {s16 unread, start, end}[7]: 210/331, 687/775, 1027/1057, 1327/1402, 1554/1636, 1884/1965, 2240/336 (`+0` holds 354..360 and is never read) |
| `0x00589050` | `g_boss3_body_events_b` | 320/365, 540/632, 868/965, 1210/1280, 1472/1550, 1825/1886, 2019/2117 |
| `0x0058907C` | `g_boss3_body_attack_motions_b` | s16[7] `62 59 62 62 59 59 62` |
| `0x00589090` | `g_boss3_path_effects` | 4 × `{s16 start, s16 end, u8 skip-first-lap, pad[3], f32 x, y, z}`: (320,367,0,(−1602,−12.4,−4006)), (594,633,1,(−1619.5,−12,−3914.3)), (955,964,1,(−1826.3,−12,−4006.7)), (1246,1278,0,(−1662.9,−12,−3975.7)) |
| `0x005890E0` | `g_boss3_attack_delay_by_rank` | {base, spread}[16]: (160,50) (160,40) (160,30) (150,40) (150,30) (140,30) (130,30) (120,30) (110,30) (100,30) (90,30) (80,30) (70,30) (60,30) (50,30) (50,20) |
| `0x00589120` | `g_boss3_card_piece_slots` | u32[8] `0x7ED 0x7EE 0x7EE 0x7EE 0x7EE 0x7EE 0x1851 0x7EE` (= `etc_2.bin[2]`, `etc_2.bin[3]`, `boss3.bin[5]`) |

All object and camera path slots exist in stage 3's `op_st3`/`cp_st3` with
start frames equal to the tables' (`op_st3` slot 354 starts at −245)
`[proved]` (`hod2lib.stage.Stage(stage=3).campaths()`).

### The class's two RNGs

* **CRT `rand()`** (`0x004ABE60`): the attack delay, the "both players fired"
  tie-breaks, the Original-Mode weapon pick. Each is a separate draw.
* **`Boss3NextRand(n)`** (`0x00421910`): `++g_boss3_rand_counter; return
  counter % (n + 1)` with an unsigned `DIV` `[proved]` — a deterministic
  counter, seeded per variant by the class handler (`0x086DEB2C`,
  `0x01084A3C`, `0x01553267` for variants 0, 1, 2) and bumped by
  `motion frame % 10` (signed `IDIV`) on every processed head shot at
  `0x00420E06`. Idle, attack, hurt, target and jaw-sway choices use it.

## The actor fields and the state block

`obj` is a `0x13F4`-byte op-0x09 actor. Fields this class uses `[proved]`:

| offset | use |
|---|---|
| `+0x00` | the update function (handler → subtype init → subtype update) |
| `+0x34` | flags: bit 1 (`0x2`) player 0 hit it this frame, bit 2 (`0x4`) player 1, bit 3 (`0x8`) hit this frame; `0x8000` skip `RegisterForShotTest`; `0x80000` and `0x80000000` set by some inits `[open]` meaning |
| `+0x3C` | hit slot; `ActorFreeHitSlot` when `0 <= x < 0xE` before every kill/despawn |
| `+0x40..+0x48` | position; `+0x4C..+0x54` velocity (held bystander) |
| `+0x64/+0x68/+0x6C` | rotation X/Y/Z (BAMS); `+0x68` yaw |
| `+0x70..+0x78` | view-space position (`MatrixTransformPoint` of `+0x100`) |
| `+0x100..+0x108` | the camera/shot point (position, then the weak bone) |
| `+0x11C` | s16 hit points (heads, body) |
| `+0x120` | s8 enemy slot (`RegisterEnemySlot`); `g_enemy_slots[slot*8] = 0` on death |
| `+0x121` | s8 the player an attack is aimed at |
| `+0x124` | f32 shot radius, `g_actor_radius_by_char[type]` (`0x004C4D28`) |
| `+0x130C` | subtype |
| `+0x1310` | s16 state |
| `+0x131B` | s8 index (heads 0..4, bystanders 0..1, the body 8) |
| `+0x1330` | s32 timer / "card spawned" latch; the body's **camera segment** |
| `+0x1334` | s32 the body's path-point count (state 8) then **camera frame** |
| `+0x1338` | s32 the body's camera frame count; written, not read `[proved]` |
| `+0x133C` | s32 zeroed at the body's death, not read `[proved]` |
| `+0x1340` | f32 heads: flinch blend counter; opening head: 15.0 offset; body: lunge fraction |
| `+0x1344` | f32 the body's death-bob amplitude (1.25) |
| `+0x1348`, `+0x134C` | zeroed by the handler, not read by the class `[proved]` |
| `+0x12F4..+0x12FC` | previous root translation (composer smoothing) |
| `+0x1390` | → the 0x77C4-byte state block (heads and body only) |
| `+0x190`, `+0x191` | the bone player 0 / player 1 hit |

The skeletal model record at `obj+0x194` ("model") `[proved]` from its users:
`+0x00` frame counter, `+0x08` (`obj+0x19C`) play cursor, `+0x20`
(`obj+0x1B4`) clip, `+0x37` bit 0 (`obj+0x1CB`) cross-fade running, `+0x5D`
(`obj+0x1F1`) clip ended, `+0x60` (`obj+0x1F4`) character type, `+0x64`
(`obj+0x1F8`) flags, `+0x68` (`obj+0x1FC`) draw byte (5 in every init),
`+0x6C..+0x74` (`obj+0x200..0x208`) root translation, `+0x78`
(`obj+0x20C`) bone records of `0x90`: `+0x00` asset slot, `+0x04/+0x08/+0x0C`
rotation X/Y/Z, `+0x28` matrix (view space), `+0x68..+0x70` bone point (view
space), `+0x7C..+0x84` its local offset; `+0x1158` (`obj+0x12EC`) pose hook.
`SkeletonAdvancePlayCursor` (`0x004111A0`) derives the cursor and the two end
flags from the frame counter each draw, and holds the cursor while a cross-fade
is up.

The **state block** (`ActorAllocSub(0x77C4)`, zeroed by `REP STOSD` of
`0x1DF1` dwords) `[proved]`:

| offset | use |
|---|---|
| `+0x000` s32[27] | extra rotation X per bone |
| `+0x06C` s32[27] | extra rotation Y |
| `+0x0D8` s32[27] | extra rotation Z |
| `+0x144..+0x2F3` | not referenced by the class `[proved by search of the listings]` |
| `+0x2F4/+0x360/+0x3CC` f32[27] | the body's chain anchor x/y/z per bone (yaw) |
| `+0x438/+0x4A4/+0x510` f32[27] | second anchor set (pitch) |
| `+0x597` u8 | bone count (20 / 27) |
| `+0x598` u8 | **weak bone** (`0x11` boss3, `0x18` boss3l) |
| `+0x599`, `+0x59A` u8 | the two **jaw bones** (`0x12`/`0x13`, `0x19`/`0x1A`) |
| `+0x59B` u8 | idle count (`0xB` / 6) |
| `+0x59C` u8 | attack count (4 / 3) |
| `+0x59D` u8 | idle set 0 (A) / 1 (B) |
| `+0x59E` u8 | the body's event index 0..6 |
| `+0x59F` u8 | the body's hits this surfacing |
| `+0x5A0` u8 | splash latch |
| `+0x5A1` u8 | the body's last path segment (7 / 8) |
| `+0x5A4` s32 | neck Z-rotation sum to the weak bone (heads, state 5) |
| `+0x5A8` f32[N][3] | the body's path points |
| `+0x7628` ptr | attack table |
| `+0x762C` s16 | path cursor |
| `+0x762E` s16 | path cursor at the weak bone (composer output, not read) |
| `+0x7630` s16 | path point count |
| `+0x7634` ptr | idle table |
| `+0x7638` s16 | hurt clip |
| `+0x763A` s16 | death clip |
| `+0x763C` s16 | current attack's hit frame |
| `+0x763E` s16 | frames before the path cursor may advance (0 always in shipped paths `[proved]`: only init writes it, to 0) |
| `+0x7640` s16 | the bite-flash clock (incremented by the **draw**, see below) |
| `+0x7642` s16 | camera freeze countdown |
| `+0x7644`, `+0x7646` s16 | frozen camera segment / frame |
| `+0x7648` s16 | head idx 2's intro clock (sound cues) |
| `+0x764A` s16 | attack armed: −1 no, 0 yes (no positive value is ever written `[proved]`) |
| `+0x764C` s16 | laps of the path |
| `+0x7650` s32[27] | composer pitch per bone |
| `+0x76BC` s32[27] | composer yaw per bone; `+0x76C0` (entry 1) the camera-facing yaw |
| `+0x7728` s32[27] | zeroed by `Boss3BodyInit`, otherwise unreferenced `[proved]` |
| `+0x7794`, `+0x779C` f32 | the lunge's start x / z |
| `+0x77AC`, `+0x77B0` s32 | death-bob phase / rate |
| `+0x77B4` s32 | jaw-sway phase (variant-2 big head) |
| `+0x77B8/+0x77BC/+0x77C0` ptr | object-path, camera-path and event tables |

## Dispatch tables (read from memory, L38)

| table | index | entries |
|---|---|---|
| `g_class_handler_pairs` at `0x00593470` | class | `{0x45, 0x0041FC00}`, neighbours `{0x44, 0x00472B10}` and `{0x46, 0x0042D9C0}` |
| `0x0041FD8C` | subtype (`JA` past 5) | `0x41FD54` → `0x41FDB0`, `0x41FD5D` → `0x4200F0`, `0x41FD66` → `0x41FE30`, `0x41FD6F` → `0x420180`, `0x41FD78` → `0x41EBB0`, `0x41FD81` → `0x420360` |
| `0x004207B8` | opening bystander state 0..3 | `0x4205F6`, `0x42062F`, `0x42069A`, `0x42073B` |
| `0x004218EC` | `g_boss3_phase` 0..3 | `0x420EA2`, `0x421033`, `0x4215D6`, `0x421704` |
| `0x004218FC` | head state − 4 (4..7) | `0x42104C`, `0x4211B6`, `0x421334`, `0x4213C4` |
| `0x00422C38` | composer state − 4 (4..14) | `0x422017`, `0x42204E`, `0x42219A`, `0x42219A`, `0x4229CA`, `0x4229CA`, `0x422200` ×3, `0x4227B9`, `0x422983` |
| `0x00424170` | body state − 8 (8..14) | `0x42349E`, `0x42351E`, `0x423536`, `0x42385E`, `0x423A97`, `0x423C9A`, `0x423D09` |
| `0x00420988` + byte table `0x00420994` | pose-hook node − 2 (0..13) | bytes `0 2 2 1 2 2 1 2 2 2 1 2 2 1`; arms `0x42093C` (scale 1.5,1,1.5), `0x420957` (scale 2), `0x420978` (none) |

A subtype above 5 leaves `obj+0x00` on the handler, so the handler runs again
every frame `[proved]` — no shipped spawn has one.

## Timing: three functions, three frames

The handler replaces `obj+0x00` with the subtype's init and returns; the init
replaces it with the update and returns. `[likely]`: each runs on its own
frame (the task walker calls `obj+0x00` once per actor per frame; no re-dispatch
of a replaced handler has been seen) — so a spawn's first update is two frames
after the spawn op.

**Every handler run with subtype ≠ 5 re-seeds the class globals and draws one
`rand()`** (for `g_boss3_attack_delay`). Block 11 spawns ten class-0x45 actors;
the nine non-body ones each run it, in task order, and the last one's values
stand `[proved]` (the handler has no guard).

---

## `Boss3ClassHandler` — `0x0041FC00`

Callers: `g_class_handlers[0x45]` (via `EvtOpSpawnPlaced09`'s allocation).
Ghidra had no function here; created this session.

```
// 0x0041FC00
if (g_GameMode == 3)                                   // 0x009CA08C
    g_boss3_variant = (g_evt_block_index != 0xF);      // 0x0041FC3F SETNZ
else switch (g_evt_block_index) {                      // s16 0x009A2BC0
    case 2:  g_boss3_variant = 2;                      // 0x0041FC36
    case 11: g_boss3_variant = 0;                      // 0x0041FC2D
    case 13: g_boss3_variant = 1;                      // 0x0041FC24
    default: (keep)                                    // 0x0041FC51
}
if (obj+0x130C != 5) {                                 // 0x0041FC5A
    g_boss3_phase = 0;                                 // 0x0041FC6E
    g_boss3_heads_left = 5;                            // 0x0041FC77
    g_boss3_head_hp_pool = variant == 2 ? 0x96 : 0xB4; // NEG/SBB/AND 0x1E/ADD 0x96
    g_boss3_rank = GetDamageRank();                    // 0x0040A8A0 -> 0x0041FC91
    g_boss3_attack_delay = rand() % (delay[rank].spread + 1) + delay[rank].base;
    g_boss3_heads_attacking = 0;                       // 0x0041FCA7
    g_boss3_last_head = 2;                             // 0x0041FCB6
    switch (variant) { 0: counter = 0x086DEB2C; 1: 0x01084A3C; 2: 0x01553267; }
}
obj+0x34 = 1;  obj+0x3C = -1;  obj+0x120 = 0xFF;       // 0x0041FCFB..0x0041FD05
obj+0x1330..+0x134C = 0 (8 dwords);  (s16)obj+0x1310 = 0;
obj+0x00 = subtypeInit[obj+0x130C];                    // table 0x0041FD8C
```

Note `obj+0x34 = 1` **replaces** the flags `EvtOpSpawnPlaced09` set.

## Subtype 0 and 1 — the opening vignette (blocks 11 and 13 only)

### `Boss3OpeningHeadInit` — `0x0041FDB0`

```
g_cur_actor = obj;  g_boss3_heads[0] = obj;
model.type = 0x49;                                     // 0x0041FDCB
model.clip = (g_evt_block_index == 0xB) ? 0x5A : 0x5B; // 0x0041FDDB / 0x0041FDE4
ActorBuildSkinnedModel(model, obj+0x40, obj+0x20C);
model.draw = 5;  obj+0x34 |= 0x88000;  model.frame = 0;
obj+0x1340 = 15.0 (0x41700000);                        // 0x0041FE0E
obj+0x00 = Boss3OpeningHeadUpdate;
```

### `Boss3OpeningHeadUpdate` — `0x00423050`

Body ends in Ghidra at the `MatrixStackPop` at `0x0042316B`; `0x00423170..`
is the rest (L35).

```
g_cur_actor = obj;  g_boss3_heads[0] = obj;
LightsUseSecondarySet(); DrawSkinnedModelAndShadow(model, obj+0x40, obj+0x20C); LightsRestoreScene();
switch (g_boss3_bystanders[0].state) {
case 2:
    if (variant == 0) {                                // 0x0042311F
        p = RotY(0x6400) * (0, 3.0, 55.5);             // identity, RotateY, TransformPoint of (0, 0x40400000, 0x425E0000)
        obj+0x1340 *= 0.95;                            // [0x0055CB40] 0x3F733333
        obj.x = p.x + obj+0x1340 + g_boss3_opening_bystander_pos.x;
        obj.y = p.y + pos.y;  obj.z = p.z + pos.z;
        obj.yaw = 0x5400;
    }
    model.frame++;                                     // 0x004231B6, both variants
    break;
case 3:
    if (variant == 0) { x += sin(2.0617)*3.0; z += cos(2.0617)*3.0 - 2.0; }   // doubles 0x0055CB08/00/0x0055CAF8; 2.0617 rad = BAMS 0x5400
    else x -= 3.0;                                     // 0x004C49C0
    t = obj+0x1330++;  if (t > 0x27) { free hit slot; ActorKill(); }
}
```

No frame advance in state 3 or any other state.

### `Boss3OpeningBystanderInit` — `0x004200F0`

```
g_cur_actor = obj;  g_boss3_bystanders[0] = obj;
model.clip = 0x23D;  ActorBuildSkinnedModel(...);  model.draw = 5;  model.flags |= 4;
obj+0x34 |= 0x8000;  model.frame = 0;  model.poseHook = Boss3BystanderPoseHook;
g_boss3_opening_bystander_pos = obj.pos;  g_boss3_opening_bystander_yaw = obj+0x68;
obj+0x00 = Boss3OpeningBystanderUpdate;
```

Character type: whatever `desc+0x24` put in `obj+0x1F4` — `0x34`
(`hito_oyaji.bin`) in both spawns.

### `Boss3OpeningBystanderUpdate` — `0x00420550`

Ghidra's body ends at `0x004205DB`; **the whole state machine is
`0x004205E0..0x004207B5`**.

```
g_cur_actor = obj;  g_boss3_bystanders[0] = obj;
if (state > 0) { LightsUseSecondarySet(); DrawSkinnedModelAndShadow(...); LightsRestoreScene(); }
MatrixStackPush(0); MatrixTranslate(x, y + 0.3 /*0x004C4D10*/, z); MatrixScale(10, 1, 10);
NoOpStub(10.0); AssetDrawSlot(0x10D0 /* common.bin[200] */); MatrixStackPop(1);
switch (state) {                                       // table 0x004207B8
case 0: if (g_script_flags[3] == 1) state = 1;  obj+0x1330 = 0;           // 0x004205F6
case 1: model.frame++;
        if (variant == 0) { t = obj+0x1330++; if (t >= 0x6D) { Boss3PlayStageSound(4); state = 2; obj+0x1330 = 0; } obj.yaw += 0x75; }
        else { t = obj+0x1330++; if (t >= 0x46) { Boss3PlayStageSound(4); state = 2; obj+0x1330 = 0; } }
case 2: model.frame++;
        if (variant == 0) { t = obj+0x1330++; if (t == 0x36) {
              ActorSetMotion(model, 0x24F); PlaySoundId(0x20000015 /* COM\214_OM_B1 */);
              state = 3; obj.yaw = 0x5400; NoOpStub-at-0x00420810(4, 0x14); obj+0x1330 = 0; } }
        else { t = obj+0x1330++; if (t == 0x1D) {
              ActorSetMotionBlended(model, 0x264, 0x11, 8); PlaySoundId(0x20000015);
              state = 3; PoseHookNone(4, 0x14); obj+0x1330 = 0; } }
case 3: if (variant == 0) { x += sin(2.0617)*3.0; z += cos(2.0617)*3.0 - 2.0; } else x -= 3.0;
        t = obj+0x1330++; if (t > 0x27) { free hit slot; ActorKill(); return; }
}
g_boss3_opening_bystander_pos = obj.pos;               // 0x00420612
```

`PoseHookNone` (`0x00420810`) is a bare `RET`; the `(4, 0x14)` / `(6, 0x1E)` /
`(6, 0x28)` calls throughout the class do nothing on PC `[proved]`. What they
were on the original hardware is `[open]`.

### `Boss3BystanderPoseHook` — `0x004208F0` (render-only)

Both bystander subtypes' per-node draw: while `g_app_state == 6`,
`g_GameMode == 1` and the byte at `0x009C88AC` is set `[open: what that byte
is]`, node 2 is scaled (1.5, 1, 1.5) and nodes 5, 8, 12, 15 by 2; then
`AssetDrawSlot` of the node's slot. Tables above.

## Subtype 3 — the held bystanders

### `Boss3HeldBystanderInit` — `0x00420180`

```
g_cur_actor = obj;  idx = (s16)obj+0x11C;  g_boss3_bystanders[idx] = obj;  obj+0x131B = idx;
obj+0x11C = 1;  model.clip = 0x21E;  ActorBuildSkinnedModel(...);
model.draw = 5;  model.poseHook = Boss3BystanderPoseHook;  model.flags &= ~2;  obj+0x34 |= 0x88000;
if (idx == 0) {
    if (variant == 0) { x -= 2.2; y += 1.8; z += 4.3; }                           // 0x0055CAF0 f, 0x0055CAE8 d, 0x0055CAE0 d
    else pos = (T(pos) * RotY(0x1200) * T(-2.2, 1.8, 4.3)).translation;           // 0xC00CCCCD 0x3FE66666 0x4089999A
} else {
    if (variant == 0) { x += 0.3; y += 2.2; z += 4.4; }                           // 0x004C4D10, 0x0055CAF0, 0x0055CADC
    else pos = (T(pos) * RotY(0x1200) * T(0.3, 2.2, 4.4)).translation;            // 0x3E99999A 0x400CCCCD 0x408CCCCD
    model.frame = 0x1E;
}
obj+0x00 = Boss3HeldBystanderUpdate;
```

The rotated arms continue past `MatrixStackPop` (`0x00420294`, `0x0042033C`);
the pseudocode drops the frame and update stores (L35).

### `Boss3HeldBystanderUpdate` — `0x00420820`

```
g_cur_actor = obj;  g_boss3_bystanders[obj+0x131B] = obj;
LightsUseSecondarySet(); DrawSkinnedModelAndShadow(...); LightsRestoreScene();
switch (state) {
case 0, 1: model.frame++;
case 2: t = ++obj+0x1330;  if (t > 0xF0) { free hit slot; ActorKill(); return; }
        vx += 0.005;  vy -= 0.02722;  vz -= 0.05;      // 0x004E30E0, 0x0055CB10, 0x004C4C88
        x += vx;  y += vy;                              // z velocity is decremented and never applied [proved]
}
```

States are driven from outside, by `Boss3FightHeadIntroGrab`.

## Subtype 2 — the five heads

### `Boss3FightHeadInit` — `0x0041FE30`

```
g_cur_actor = obj;  idx = (s16)obj+0x11C;  g_boss3_heads[idx] = obj;  obj+0x131B = idx;
obj+0x11C = variant == 2 ? 0x1E : 0x2D;                // 30 / 45 hit points
sub = obj+0x1390 = ActorAllocSub(0x77C4), zeroed;
if (idx == 2) {
    model.type = 0x48;  model.clip = g_boss3l_idle_motions[0] (67);  sub+0x77B4 = -300;
    g_boss3_track_point = (x, y + 22.0 /*0x0055CAD8*/, z);
} else {
    model.type = 0x49;  sub+0x59D = idx & 1 (signed mod);
    set A: model.clip = g_boss3_idle_motions_a[idx]; +0x7634 = idle A; +0x7628 = attacks A
    set B: model.clip = g_boss3_idle_motions_b[idx]; +0x7634 = idle B; +0x7628 = attacks B
}
ActorBuildSkinnedModel(model, obj+0x40, obj+0x20C);  model.draw = 5;
obj+0x34 |= 0x8000;  model.frame = 0;
obj+0x124 = g_actor_radius_by_char[model.type];  model.poseHook = PoseHookNone;
if (idx == 2) { +0x597=0x1B; +0x598=0x18; +0x599=0x19; +0x59A=0x1A; +0x59B=6; +0x59C=3;
                +0x7634 = g_boss3l_idle_motions; +0x7628 = g_boss3l_attacks; +0x7638 = 0x49; +0x763A = 0x41; }
else          { +0x597=0x14; +0x598=0x11; +0x599=0x12; +0x59A=0x13; +0x59B=0xB; +0x59C=4;
                +0x7638 = g_boss3_hurt_motions[+0x59D*2 /* word index */]; +0x763A = 0x4C; }
zero extra rotation X/Y/Z for every bone;  +0x7640 = 0;  +0x7648 = 0;  +0x764A = -1;
if (idx == 2) { g_enemies_present++; g_enemies_alive++; }                        // 0x00420082, 0x00420089
if (g_GameMode != 3) {
    if (idx == 0) { model.clip = 0x58; model.frame = 0; }
    if (idx == 4) { model.clip = 0x58; model.frame = 0x1E; }
}
RegisterEnemySlot(obj);  obj+0x00 = Boss3FightHeadUpdate;
```

`+0x7638` for idx ≠ 2 is `MOV CX, word ptr [EAX*0x4 + 0x588F48]` with
`EAX = +0x59D` — **dword** stride, so set A → 99, set B → 85 `[proved]`.

### `Boss3FightHeadUpdate` — `0x004209B0`

Callers: the task walker. Ghidra's body stops at `0x004217EE`; the tail
`0x004217F3..0x00421878` is the tracking publish.

**1. The shot** (`0x004209E1..0x00420E19`) — only when
`g_boss3_phase == 1 && state != 7 && state != 6 && (obj+0x34 & 8)`. **Outside
that window the hit bits are not cleared**, so a shot during a flinch is
latched and processed on the first frame back in state 4 or 5 `[proved]`.

```
obj+0x34 &= ~8;
p = (bit 0x2 && bit 0x4) ? (rand() & 1 /* signed mod */) : (bit 0x2 == 0);   // shooter: player 0 if bit 0x2
weak = sub+0x598;
if (!((bit 0x2 && obj+0x190 == weak) || (bit 0x4 && obj+0x191 == weak))) goto miss;
a = bone[+0x599].rotZ + extraZ[+0x599];  b = bone[+0x59A].rotZ + extraZ[+0x59A];
if (|a - b| <= 0x1700) goto miss;                     // the mouth must be open
if (variant != 2 && idx == 2) goto miss;              // stage 3's big head cannot be hurt
if ((u16)sub+0x5A4 > 0x1700 && (u16)sub+0x5A4 < 0xC000) goto miss;
ScoreAddForPlayer(p, 10);  SpawnBoneHitSprite(obj, obj+0x190[p]);
flags = obj+0x34 & ~8;
div = (g_players_in_play == 2) ? 5 : 3;               // SUB/NEG/SBB/AND -2/ADD 5
if (g_GameMode == 1) {                                 // Original Mode weapon multiplier
    q = (bit 0x2 && bit 0x4) ? rand() & 1 : (bit 0x2 ? 0 : 1);
    m = [0x009A224C + q*0x14];  if (m == -1.0) m = 2.0;   // 0x004C4C64, 0x004E30F0
} else m = 1.0;
d = ftol((45 / div) * m);                             // integer 45/div first: 15 or 9
obj+0x11C -= d;  g_boss3_head_hp_pool -= d;
if (obj+0x11C < 0) g_boss3_head_hp_pool -= obj+0x11C;   // overkill is given back
g_boss_hp_fraction = pool * (variant == 2 ? 1/150 : 1/180);   // 0x00420C22; [0x0055CB18] / [0x0055CB14]
if (g_boss_hp_fraction < 0.0) g_boss_hp_fraction = 0.0;      // read 0x00420C28, write 0x00420C3B
if (g_boss3_rank < 15) g_boss3_rank++;
if (obj+0x11C <= 0) {
    PlaySoundId(0x1C17A9 /* COMMON2\ZOMBIE_046_16 */);  state = 7;  g_boss3_heads_left--;
    obj+0x1330 = 0;  free g_enemy_slots[obj+0x120];
    ActorSetMotionBlended(model, sub+0x763A, 8, 8);
    if (g_boss3_heads_left == 0) {
        obj+0x1330 = 0;  g_boss3_phase = 2;  g_boss_hp_fraction = 0.0;        // 0x00420CE3
        ScoreAddForPlayer((bit 0x2 && bit 0x4) ? rand() & 1 : (bit 0x2 ? 0 : 1), 0x5DC);
    }
} else {
    Boss3PlayStageSound(1);  state = 6;
    if (idx != 2) sub+0x7638 = g_boss3_hurt_motions[Boss3NextRand(1) + sub+0x59D*2];
    ActorSetMotionBlended(model, sub+0x7638, 8, 8);
    g_boss3_last_head = idx;  obj+0x1340 = 0;
}
if (sub+0x764A > -1) { if (g_boss3_heads_attacking > 0) g_boss3_heads_attacking--; sub+0x764A = -1; }
goto bump;
miss:  PlaySoundId(0x1216A9 /* COMMON\BULLET_OTH1_16 */);  Boss3SpawnBoneSpark(obj, obj+0x190[p]);
bump:  g_boss3_rand_counter += model.frame % 10;  obj+0x34 &= ~6;
```

**2. Draw and pose** (`0x00420E1C..0x00420E5D`):
`DrawSkinnedModelAndShadow`; `Boss3ComposeBonePose(obj)` when state is 4, 5
or 6; `LightsUseSecondarySet(); Boss3DrawBoneParts(obj); LightsRestoreScene()`.
Then `if (phase == 1 && state == 0) { state = 4; obj+0x34 &= ~0x8000; }`.

**3. `switch (g_boss3_phase)`** (table `0x004218EC`):

*Phase 0 — intro* (`0x00420EA2`):

```
if (variant == 2) {
    if (g_script_flags[0] == 1) { BossHpBarSpawn(320.0, 35.0) /*0x00420EBE*/; g_boss_hp_fraction = 1.0 /*0x00420EC6*/; g_boss3_phase = 1; }
    if (sub+0x7648++ == 0x4B) Boss3PlayStageSound(3);
    model.frame++;
} else {
    if (g_GameMode != 3) {
        if (idx == 0 || idx == 4) Boss3FightHeadIntroGrab(obj); else model.frame++;
    } else {                                           // Boss Mode, 0x00420F35
        model.frame++;
        if (g_script_flags[1] == 1 && idx == 0 && obj+0x1330 == 0) { ActorAlloc(Boss3IntroCardUpdate, 0x13F4).state = 0; obj+0x1330 = 1; }
        if (g_script_flags[2] == 1) {
            g_boss3_phase = 1; obj+0x1330 = 0; state = 4; obj+0x34 &= ~0x8000;
            if (g_GameMode == 3) [0x009CA0EA] = 1;
            if (idx == 0) { BossHpBarSpawn(320.0, 35.0) /*0x00420FD2*/; g_boss_hp_fraction = 1.0 /*0x00420FDA*/; }
        }
    }
    if (idx == 2) { v = ++sub+0x7648;  if (v == 0x3C || v == 0x226) Boss3PlayStageSound(3);  if (v == 0x122) Boss3PlayStageSound(5); }
}
```

*Phase 1 — the fight* (`0x00421033`, `switch (state − 4)` via `0x004218FC`):

```
state 4, idle (0x0042104C):
    model.frame++;  if (sub+0x764A > 0) sub+0x764A--;
    started = 0;
    if (clipEnded) {
        if (Boss3NextRand(1) != 0 && idx != 2 && sub+0x764A == -1) Boss3FightHeadSwapIdleSet(obj);
        else { ActorSetMotion(model, idleTbl[Boss3NextRand(sub+0x59B - 1)]); model.frame = 0; started = 1; }
    }
    if (variant != 2 && idx == 2) goto scheduler;
    if (sub+0x764A == 0 && started && g_scene_state_major_entered == 2
        && (g_player_state[0] == 5 || g_player_state[1] == 5)) {
        r = Boss3NextRand(sub+0x59C - 1);  state = 5;
        ActorSetMotion(model, attackTbl[r].motion);  model.frame = 0;
        sub+0x7640 = 0;  sub+0x763C = attackTbl[r].hitFrame;
        if (g_players_in_play == 2) obj+0x121 = Boss3NextRand(1);
        else { if (g_active_player == 0) obj+0x121 = 0; if (g_active_player == 1) obj+0x121 = 1; }
    }
state 5, attack (0x004211B6):
    if (sub+0x7640 == 3) Boss3PlayStageSound(4);
    if (sub+0x7640 == 0xF) Boss3PlayStageSound(2);
    if (model.frame++ == sub+0x763C) {                 // the bite
        if (g_scene_state_major_entered == 2 && g_players_in_play > 0 && g_player_state[obj+0x121] == 5) {
            PlayerTakeDamage(obj+0x121, 1, 9);  g_boss3_rank -= 3;
        }
        if (g_boss3_heads_attacking > 0) g_boss3_heads_attacking--;
        sub+0x764A = -1;  if (g_boss3_rank < 0) g_boss3_rank = 0;
        g_boss3_attack_delay = rand() % (delay[rank].spread + 1) + delay[rank].base;
        g_boss3_last_head = idx;
    }
    if (clipEnded) {
        if (Boss3NextRand(1) != 0 && idx != 2) Boss3FightHeadSwapIdleSet(obj);
        else { ActorSetMotion(model, idleTbl[Boss3NextRand(sub+0x59B - 1)]); model.frame = 0; }
        state = 4;  zero extra rotation X/Y/Z for every bone;
    }
state 6, flinch (0x00421334):
    if (model+0x37 & 1) { model.frame++; obj+0x1340 += 1.0; }        // cross-fade still up
    else { model.frame++;
           if (clipEnded) { ActorSetMotion(model, idleTbl[Boss3NextRand(sub+0x59B - 1)]); model.frame = 0; }
           state = 4;  zero extra rotation X/Y/Z; }
state 7, dead (0x004213C4):
    if (!clipEnded) model.frame++;
    if ((idx != 2 && cursor == 0x4B) || (idx == 2 && cursor == 0x70))
        if (!(model+0x37 & 1)) { PlaySoundId(0xB16A9 /* COMMON\BOMB1_11 */); PoseHookNone(4, 0x14); g_screen_shake_frames = 0x18; }
then:  if (idx != 2) goto tail;
scheduler (0x0042141B), head idx 2 only:
    if (g_scene_state_major_entered == 2 && (g_player_state[0] == 5 || g_player_state[1] == 5)
        && --g_boss3_attack_delay <= 0 && g_boss3_heads_attacking < 2) {
        k = Boss3NextRand(4);  h = g_boss3_heads[k];
        if ((variant == 2 || k != 2) && h.state != 7 && h.sub+0x764A != 0) {
            blocked = any i != k with heads[i].sub+0x764A == 0 and |i - k| > 2;
            if (!blocked) {
                h.sub+0x764A = 0;                      // armed: h attacks at its next new idle
                g_boss3_attack_delay = rand() % (delay[rank].spread + 1) + delay[rank].base;
                g_boss3_heads_attacking++;
            }
        }
    }
```

(`g_player_state` is `0x009A5C62`, player 1's `0x009A5D92`, stride `0x130`.)
The `CMP word ptr [g_players_in_play], 2` after `PlayerTakeDamage` at
`0x00421239` sets flags that the following `ADD AL, 0xFD` destroys — the rank
always drops by 3, and the delay in state 5 is computed from the clamped rank
(`0x00421260..0x00421270`) `[proved]`.

*Phase 2 — all heads down* (`0x004215D6`):

```
if (idx == 2) {
    if (cursor == 0x70) { PlaySoundId(0xB16A9); g_screen_shake_frames = 0x18; PoseHookNone(6, 0x1E); }
    if (++obj+0x1330 == 0xB4) {
        g_enemies_present--; g_enemies_alive--;        // 0x00421623, 0x0042162A: THE GATE
        g_boss3_phase = 3;  free g_enemy_slots[obj+0x120];  obj+0x1330 = 0;
        if (variant != 2) { free hit slot; ActorDespawn(obj); return; }
    }
} else if (state == 7 && cursor == 0x38 && !(model+0x37 & 1)) {
    PlaySoundId(0xB16A9); PoseHookNone(4, 0x14); g_screen_shake_frames = 0x18;
}
if (state != 7) { state = 7; obj+0x1330 = 0; ActorSetMotionBlended(model, sub+0x763A, 8, 8); }
if (!clipEnded) model.frame++;
```

*Phase 3* (`0x00421704`): variant 2 → `if (++obj+0x1330 < 0xF0) goto tail;`
then free hit slot and `ActorDespawn`; other variants despawn at once.

**4. Tail** (`0x00421542`):

```
obj+0x100 = obj.pos;  obj+0x70 = MatrixTransformPoint(obj+0x100);   // current top: the view [likely]
if (state != 7) RegisterForShotTest(obj);
track = (phase == 0 && idx == 2) || (phase == 1 && sub+0x764A > -1)
     || (g_boss3_heads_attacking == 0 && idx == g_boss3_last_head && state != 7);
if (track) {                                            // 0x00421785 .. 0x00421876 (L35 tail)
    w = viewToWorld(g_camera_blocks[g_camera_index]) * bone[weak].point;   // bone +0x68, block +0x40 matrix
    g_boss3_track_point += (w - g_boss3_track_point) * 0.15;               // [0x004C4D08]
    obj+0x100 = g_boss3_track_point;
    if (state != 7) RegisterForCameraTracking(obj);                         // 0x00421871
}
if (variant != 2 && g_boss3_heads_left == 1 && idx == 2) {                 // 0x00421879
    state = 7;  g_boss3_heads_left--;  obj+0x1330 = 0;  free g_enemy_slots[obj+0x120];
    ActorSetMotionBlended(model, sub+0x763A, 8, 8);  g_boss3_phase = 2;
}
```

### `Boss3FightHeadIntroGrab` — `0x00422D30`

Heads 0 and 4 in phase 0 outside Boss Mode. `c = (idx != 0)`, the bystander
it holds.

```
switch (state) {
case 0: bys = g_boss3_bystanders[c];
  switch (bys.state) {
  case 0: model.frame++;
          if (g_script_flags[0] == 1 && clipEnded) {
              if (c == 0) { ActorSetMotion(model, 0x57); ActorSetMotion(bys.model, 0x21D); }
              else        { ActorSetMotion(model, 0x59); ActorSetMotion(bys.model, 0x21F); }
              bys.state = 1;
          }
  case 1: if (c == 0) { if (cursor == 0x17) PlaySoundId(0x3D16A9 /* COMMON\SWORD11_22_1 */); if (cursor < 0x21) { model.frame++; return; } }
          else        { if (cursor == 0x3F) PlaySoundId(0x3D16A9); if (cursor < 0x49) { model.frame++; return; } }
          bys.state = 2;  state = 2;  obj+0x1330 = 0;
          if (c == 0) { bys.v = (-2.4, 1.4, -0.2); PlaySoundId(0x20000012 /* COM\209_M */); }
          else        { bys.v = (-1.4, 1.8, -0.2); PlaySoundId(0x1DA9 /* DAMEGE_GA\188_2_GA */); }
  }
case 2: model.frame++;
        if (clipEnded) {
            sub+0x59D = idx & 1;
            set A: ActorSetMotionBlended(model, g_boss3_idle_motions_a[idx], 0, 4); tables A
            set B: ActorSetMotionBlended(model, g_boss3_idle_motions_b[idx], 0, 4); tables B
            obj+0x1330 = 0;  state = 3;
        }
case 3: model.frame++;
        if (g_script_flags[1] != 0 && idx == 0 && obj+0x1330 == 0) { ActorAlloc(Boss3IntroCardUpdate, 0x13F4).state = 0; obj+0x1330 = 1; }
        if (g_script_flags[2] == 1) {
            obj+0x34 &= ~0x8000;  obj+0x1330 = 0;  state = 4;
            if (idx == 0) { BossHpBarSpawn(320.0, 35.0) /*0x00422DFA*/; g_boss_hp_fraction = 1.0 /*0x00422E02*/; }
            if (g_boss3_heads[0].state == 4 && g_boss3_heads[4].state == 4) g_boss3_phase = 1;   // 0x00422E34
        }
}
```

The phase flips when the second of heads 0 and 4 reaches state 4, and the
other three heads then leave state 0 on their own next update.

### `Boss3FightHeadSwapIdleSet` — `0x00421930`

```
ActorSetMotion(model, g_boss3_swap_motions[sub+0x59D]);
sub+0x59D = 1 - sub+0x59D;
if (sub+0x59D == 0) { +0x7634 = idle A; +0x7628 = attacks A; +0x7638 = hurt[Boss3NextRand(1)]; }
else                { +0x7634 = idle B; +0x7628 = attacks B; +0x7638 = hurt[Boss3NextRand(1) + 1]; }
model.frame = 0;
```

The set-B window is `0x00588F4A` — `{100, 85}` — not the hit path's `{85, 86}`
`[proved]`; transcribe, do not "fix".

### `Boss3BigHeadJawSway` — `0x00422C70`

From `Boss3ComposeBonePose` state 4, variant 2, head idx 2, bone `+0x599`:

```
if (sub+0x77B4 < 0) sub+0x77B4++;
if (sub+0x77B4 >= 0) {
    v = sub+0x77B4 += 0x200;
    extraZ[+0x599] = ftol(sin(v * BAMS2RAD) * 6400.0 - 1536.0);   // 0x0055CB3C, 0x0055CB38
    extraZ[+0x59A] = ftol(1536.0 - sin(v * BAMS2RAD) * 6400.0);
    if (v >= 0x8000) sub+0x77B4 = -300 - Boss3NextRand(0x96);
}
```

## Subtype 5 — the body

### `Boss3BodyInit` — `0x00420360`

```
g_cur_actor = obj;  g_boss3_heads[0] = obj;  obj+0x131B = 8;  obj+0x11C = 0x78;
model.type = 0x48;  model.clip = 0x42;  ActorBuildSkinnedModel(...);
y += 3.0;  model.draw = 5;  obj+0x124 = g_actor_radius_by_char[0x48] ([0x004C4E48]);
model.poseHook = PoseHookNone;  state = 8;  obj+0x34 |= 0x80080000;
sub = ActorAllocSub(0x77C4), zeroed;
+0x597=0x1B; +0x598=0x18; +0x599=0x19; +0x59A=0x1A;  +0x762C = 0; +0x762E = 0;
variant 0: +0x77B8 = obj_paths_a; +0x77BC = cam_paths_a; +0x77C0 = events_a; +0x5A1 = 7
else:      +0x77B8 = obj_paths_b; +0x77BC = cam_paths_b; +0x77C0 = events_b; +0x5A1 = 8; Boss3SpawnPathEffects();
+0x59E = 0; +0x763E = 0; +0x59F = 0; +0x7642 = 0; +0x7640 = 0; +0x5A0 = 0; +0x764C = 0;
for 27 bones: extra XYZ = 0; anchor x/y/z (+0x2F4/+0x360/+0x3CC) = obj.pos;
              +0x7650[i] = +0x76BC[i] = +0x7728[i] = 0; bone[i].rot XYZ = 0;
g_enemies_present++; g_enemies_alive++;                // 0x00420522, 0x00420529
RegisterEnemySlot(obj);  obj+0x00 = Boss3BodyUpdate;
```

### `Boss3BodyUpdate` — `0x004231C0`

Ghidra's body stops at five `MatrixStackPop`s; the tails at `0x0042365B`,
`0x004236F9`, `0x00423DFA`, `0x00423F0A` and `0x00424062` are part of it.

**1. The shot** (any state; runs whenever `obj+0x34 & 8`):

```
p = both bits ? rand() & 1 : (bit 0x2 == 0);
if ((state == 11 || state == 12)
    && ((bit 0x2 && obj+0x190 == 0x18) || (bit 0x4 && obj+0x191 == 0x18))
    && |bone[+0x599].rotZ - bone[+0x59A].rotZ| > 0x1700) {                 // no extra rotation here
    ScoreAddForPlayer(p, 10);  SpawnBoneHitSprite(obj, obj+0x190[p]);  sub+0x59F++;
    m = g_GameMode == 1 ? weapon[p] (−1.0 → 2.0) : 1.0;
    obj+0x11C += ftol(m * (g_players_in_play == 2 ? -6.0 : -10.0));        // 0x0055CB4C / 0x0055CB48
    g_boss_hp_fraction = obj+0x11C * (1/120);          // 0x00423329 FST, [0x0055CB44]
    if (< 0.0) g_boss_hp_fraction = 0.0;               // 0x0042333C
    if (obj+0x11C <= 0) {
        ScoreAddForPlayer(both ? rand() & 1 : (bit 0x2 ? 0 : 1), 0x5DC);
        g_boss_hp_fraction = 0.0;                      // 0x00423392
        state = 14;  obj+0x133C = 0;  ActorSetMotion(model, 0x41);
        pos = variant == 0 ? (-849.7, -5.0, -4252.0) : (-1604.1, -12.0, -3927.6);
        obj+0x68 = -0x311C;  sub+0x77AC = 0;  sub+0x77B0 = 0x400;  obj+0x1344 = 1.25;
        g_enemies_present--; g_enemies_alive--;        // 0x0042340C, 0x00423413: THE SECOND GATE
        g_camera_driver_held (0x009CA094) = 0;  g_camera_free = 1;  g_camera_hand_back_started = 0;
        free g_enemy_slots[obj+0x120];  Boss3PlayStageSound(7);
        if (g_GameMode == 3) [0x009CA0EA] = 0;
    }
} else { PlaySoundId(0x1216A9); Boss3SpawnBoneSpark(obj, obj+0x190[p]); }
obj+0x34 &= 0xFFFFFFF1;
```

**2. `switch (state)`** (table `0x00424170`), then the tail. The switch runs
**before** the draw, so it reads last frame's play cursor — the heads' runs
after it `[proved]`.

```
state 8, build the path (0x0042349E):
    Boss3BodyBuildPathSegment(obj+0x1330, obj);
    if (++obj+0x1330 > sub+0x5A1) {
        obj+0x1330 = 0;  sub+0x7630 = obj+0x1334;  obj+0x1334 = 0;
        obj.x = pts[+0x762C].x;  obj.z = pts[+0x762C].z;  state = 9;
    }
state 9 (0x0042351E):  state = 10;  g_camera_driver_held = 1;
state 10, swim (0x00423536):
    if (variant == 0) { if (+0x762C == 0x5F) { PlaySoundId(0x4116A9 /* SIBUKI2 */); PoseHookNone(4, 0x1E); } }
    else if (variant == 1 && +0x762C == 10) Boss3SpawnMeshBulge();
    if (+0x762C == 0x3C) { EvtOpPlayDialogue2D(0x83); g_bHudShutterState = 5; }       // 0x0042358E
    if (+0x762C == 0xB4) g_bHudShutterState = 1;                                     // 0x004235A3
    if (variant == 0) {
        if ((clip == 0x3D && cursor == 0x36 && +0x59E != 3) || ((clip == 0x3B || clip == 0x3C) && cursor == +0x763C + 4 && +0x59E != 3)) {
            w = world(bone[+0x59A]);  PlaySoundId(0x4116A9);  PoseHookNone(6, 0x1E);
            Boss3SpawnSplashAt(w.x, -15.0, w.z, 0);
        }
        if (obj+0x1330 == 4 && obj+0x1334 == 0x2B2 && +0x762C != 0x523) +0x762C = 0x523;
    } else {
        if (clip == 0x3D && cursor == 0x36) {
            w = world(bone[+0x598]);  PlaySoundId(0xB16A9);  PoseHookNone(6, 0x1E);
            g_screen_shake_frames = 0x30;  Boss3SpawnSplashAt(w.x, -13.5, w.z, 1);
        }
        if (obj+0x1330 == 6 && obj+0x1334 == 0x325 && +0x762C != 0x6F4) +0x762C = 0x6B8;
    }
    Boss3BodyMoveAndDriveCamera(obj);
    if (+0x762C == 0xB4) { BossHpBarSpawn(320.0, 35.0) /*0x004237B2*/; g_boss_hp_fraction = 1.0 /*0x004237BA*/; }
    if (events[+0x59E].start == +0x762C) { state = 11; +0x59F = 0; ActorSetMotion(model, 0x42); Boss3PlayStageSound(3); }
    if (variant != 0 || +0x59E > 0) {
        if (cursor == playLength[clip] - 1 && clip != 0x42) { ActorSetMotion(model, 0x42); model.frame = 0; }
        if (clip != 0x42 || cursor != 0) model.frame++;
    }
state 11, surfaced (0x0042385E):
    Boss3BodyMoveAndDriveCamera(obj);
    if (enough hits: players == 2 ? +0x59F >= 3 : players < 2 ? +0x59F >= 2 : never) {
        Boss3PlayStageSound(1);  +0x59E++ (variant 0: > 6 -> 1; else > 6 -> 0);
        state = 10;  +0x7794 = x;  +0x779C = z;  obj+0x1340 = 0;  ActorSetMotion(model, 0x3D);  break;
    }
    if (variant == 0) {
        e = +0x59E;
        go = e == 6 ? (+0x762C < tbl[6].start && tbl[6].end == +0x762C) : (tbl[e].end == +0x762C);
        if (go) { state = 12;
                  even e: ActorSetMotionBlended(model, 0x3C, 0, 4); +0x763C = 0x26;
                  odd e:  ActorSetMotionBlended(model, 0x3B, 0, 4); +0x763C = 0x2F;
                  +0x7794 = x; +0x779C = z; obj+0x1340 = 0; PlaySoundId(0x4216A9 /* SIBUKI3 */); Boss3PlayStageSound(4); }
    } else if (tbl[+0x59E].end == +0x762C) {
        state = 12;  ActorSetMotion(model, g_boss3_body_attack_motions_b[+0x59E]);
        +0x763C = motion == 0x3B ? 0x2F : 0x2D;
        +0x7794 = x; +0x779C = z; obj+0x1340 = 0; Boss3PlayStageSound(4); obj.y = -13.5;
    }
    if (cursor != 0x1E) model.frame++;
state 12, lunge (0x00423A97):
    Boss3BodyMoveAndDriveCamera(obj);
    if (enough hits, as above) {
        PlaySoundId(0x241AA9 /* STAGE3_SE\BOSS3_1 */);  +0x59E++ (wrap as above);  state = 10;
        ActorSetMotionBlended(model, 0x3D, 8, 0xC);  +0x7794 = x; +0x779C = z;  obj+0x1340 = 0;
        +0x7644 = obj+0x1330;  +0x7646 = obj+0x1334;  break;
    }
    if (cursor == +0x763C) {
        +0x7642 = 0x1E;
        if (g_scene_state_major_entered == 2 && g_players_in_play > 0 && (g_player_state[0] == 5 || g_player_state[1] == 5)) {
            if (g_players_in_play == 2) { PlayerTakeDamage(0, 1, 9); PlayerTakeDamage(1, 1, 9); }
            else { if (g_active_player == 0) obj+0x121 = 0; if (g_active_player == 1) obj+0x121 = 1;
                   PlayerTakeDamage(obj+0x121, 1, 9); }
        }
        +0x59E++ (wrap);  +0x7794 = x; +0x779C = z;  state = 10;  obj+0x1340 = 0;
        +0x7644 = obj+0x1330;  +0x7646 = obj+0x1334;
    }
    model.frame++;
state 13 (0x00423C9A): Boss3BodyMoveAndDriveCamera(obj);
    if (variant == 0 && cursor == +0x763C + 4 && +0x59E != 3) PlaySoundId(0x4116A9);
    if (obj+0x1340 >= 1.0) state = 10;  obj+0x1340 += 0.05;  model.frame++;
    -- no instruction writes 0x0D to +0x1310 (byte search `10 13 00 00 0d 00` finds nothing): unreached [likely]
state 14, dead (0x00423D09):
    if (!clipEnded) model.frame++;
    if (g_script_flags[4] == 1) { free hit slot; BossModeRecordGrade(); ActorDespawn(obj); return; }
    if (variant == 0) {
        if (0x46 <= cursor && cursor <= 0x6E) obj.y = (0x6E - cursor) * 0.25 - 15.0;
        if (cursor == 0x6E) { PlaySoundId(0x4116A9); PoseHookNone(6, 0x1E); w = world(bone[+0x59A]); Boss3SpawnSplashAt(w.x, -15.0, w.z, 0); }
        if (cursor >= 0x6E) {
            obj.y = sin(sub+0x77AC * BAMS2RAD) * obj+0x1344 - 15.0;
            sub+0x77AC += sub+0x77B0;
            if ((sub+0x77AC % 0x10000) == 0) obj+0x1344 *= 0.35;          // 0x004E30F8
        }
    } else if (cursor == 0x6E) {
        PlaySoundId(0xB16A9); g_screen_shake_frames = 0x30; PoseHookNone(6, 0x1E);
        w = world(bone[+0x59A]); Boss3SpawnSplashAt(w.x, -12.0, w.z, 1);
    }
```

`world(bone)` is `inverse(g_camera_world_to_view[g_camera_index]) * bone.matrix`,
translation (`MatrixStackSetTopFromArray(0x009A6000 + cam*0x1A4)`,
`MatrixInvert(0)`, `MatrixMultiply(model + bone*0x90 + 0xA0)`,
`MatrixGetTranslation`). "Enough hits" is `CMP AX, 2; JNZ` then `JGE` back to
the no-retreat path — with more than two players in play (impossible) it never
retreats `[proved]`.

**3. Tail** (`0x00423F2C`):

```
DrawSkinnedModelAndShadow(model, obj+0x40, obj+0x20C);
if (state != 14) obj+0x68 = 0x8000;
Boss3ComposeBonePose(obj);
if (state != 8 && state != 9) { LightsUseSecondarySet(); Boss3DrawBoneParts(obj); LightsRestoreScene(); }
obj+0x100 = pos;  obj+0x70 = MatrixTransformPoint(obj+0x100);
obj+0x100 = viewToWorld * bone[0x598].point;           // g_camera_blocks + cam*0x1A4
if (state in 10..13) {                                  // 0x00424062 .. (L35 tail)
    VecToAngles(eye - obj+0x100 -> pitch, yaw);        // eye = g_camera_block_eye 0x009A60C0
    if (+0x7642 <= 0) {
        g_camera_block_yaw_bams += wrap16(yaw - (u16)g_camera_block_yaw_bams) / 8;     // arithmetic, toward zero
        if (clip in {0x3B, 0x3C, 0x3E, 0x3F, 0x3D}) {
            g_camera_block_pitch_bams += (pitch - g_camera_block_pitch_bams) / 4;
            if (g_camera_block_pitch_bams < 0) g_camera_block_pitch_bams = 0;
        } else g_camera_block_pitch_bams = 0;
    } else g_camera_block_pitch_bams = 0;
    RegisterForShotTest(obj);
}
```

The yaw and pitch written are camera block **0**'s (`0x009A60CC`/`0x009A60D0`),
not `g_camera_index`'s `[proved]`. The body is never registered for camera
tracking; it moves the camera itself.

### `Boss3BodyBuildPathSegment` — `0x00424190`

```
seg = (*(sub+0x77B8))[k];                              // {path, from, to}
for (f = seg.from; f <= seg.to; f++) {
    CamEvalObjectPath6(seg.path, (float)f, &out);      // 0x004042D0, only x,y,z used
    pts[obj+0x1334++] = out.xyz;                       // sub+0x5A8 + i*0xC
}
```

Point counts `[proved]` from the tables: variant 0 = 246+181+461+290+341+251+292+251
= **2313**, variant 1 = 181+281+281+300+330+281+322+272+101 = **2349**; the block
has room for `(0x7628 − 0x5A8) / 0xC` = 2400.

### `Boss3BodyMoveAndDriveCamera` — `0x00424250`

```
f = 1.0;
switch (state) {
case 12:                                               // 0x0042449D
    c = +0x763C;
    if (c != 0) {
        if (variant == 1) { if (+0x59E == 0) f = 1.5; if (+0x59E == 4) f = 0.5; }
        x = (eye.x - +0x7794) * obj+0x1340 / c * f + +0x7794;
        z = (eye.z - +0x779C) * obj+0x1340 / c * f + +0x779C;
    }
    obj+0x1340 += 0.3;
case 13:                                               // 0x00424453
    x = (pts[+0x762C].x - +0x7794) * obj+0x1340 + +0x7794;  z likewise;
default:
    x = pts[+0x762C].x;  z = pts[+0x762C].z;
    if (variant == 1) {
        if (0x2F3 <= +0x762C <= 0x334) blend x,z toward (-1818.88, -3982.87) by (+0x762C - 0x2F3) * 0.015384615;
        if (0x335 <= +0x762C <= 0x398) blend toward (-1949.44, -3927.83) by (+0x762C - 0x335) * 0.009615385;
    }
    if (variant == 0) { y = -15.0; if (+0x762C <= 0x41) z += (0x41 - +0x762C) * 0.30769232; }
    else if (+0x59E == 0 && ((+0x762C > 0x840 && clip != 0x3D) || (0xC8 < +0x762C < 0x140)))
        y += (-16.5 - y) * 0.08;
    else y = -12.5;
}
if (+0x763E > 0) +0x763E--;
if (+0x763E <= 0 && +++0x762C >= +0x7630) { +0x764C++; +0x762C = variant ? 0xDD : 0x11E; }
if (+0x7642 > 0) { +0x7642--; CamEvalPath7(camTbl[+0x7644].path, (float)+0x7646, &g_camera_block_eye, ...); }
else             CamEvalPath7(camTbl[obj+0x1330].path, (float)obj+0x1334, &g_camera_block_eye, ...);
if (variant == 0) g_camera_block_eye.y += 2.0;
if (state != 9) {
    obj+0x1338++;
    if (++obj+0x1334 > camTbl[obj+0x1330].to) {
        if (++obj+0x1330 > sub+0x5A1) {
            obj+0x1330 = 1;
            variant 0: obj+0x1334 = 0x29; obj+0x1338 = 0x11E;
            else:      obj+0x1334 = obj+0x1338 = 0xDD;
        } else obj+0x1334 = camTbl[obj+0x1330].from;
    }
}
```

The case-12 and case-13 arms are exclusive (`JMP 0x00424537` after each)
`[proved]`; the pseudocode's fall-through above is shorthand. The camera
target and roll `CamEvalPath7` produces go to locals and are discarded — the
aim is the tail's `VecToAngles` of the boss.

### `Boss3ComposeBonePose` — `0x00421F20`

The class poses its own skeletons. Prologue: `A = ftol(516 − idx*258)`,
`B = ftol(288 − idx*144)` (`0x0055CB30`, `0x0055CB34`, `0x0055CB2C`,
`0x005308E8`); the matrix is `T(pos) RotZ(+0x6C) RotY(+0x68) RotX(+0x64)`.
Then per bone `i`, per state (table `0x00422C38`) `[proved]`:

* **4**: variant 2, head idx 2, bone `+0x599` → `Boss3BigHeadJawSway`.
* **5**: heads idx ≠ 2 compute a fraction `t`: idx 1/3 — cursor / hit frame
  before the hit frame, `(len − cursor)/(len − hit)` after; idx 0/4 — likewise
  but starting at cursor 0x28, and **skip** while `cursor <= 0x28 && cursor <
  hit`; then `extraX[i] = ftol(B*t)`, `extraY[i] = ftol(A*t)`,
  `extraZ[i] = ftol(0*t)` (the third factor is the frame local `F+0x24`, zero
  on this path). For `i <= weak` the bone Z rotations are summed and
  `sub+0x5A4` = the sum at the weak bone. `len` is `g_motion_play_length`
  (`0x004E07D0`).
* **6, 7**: `extra*[i] = ftol(extra*[i] * (8.0 − obj+0x1340) * 0.125)`
  (`0x004C43A0` = 8.0, `0x0055CB28` = 0.125).
* **10, 11, 12**: the body's chain along the path (transcribed in full
  [below](#the-bodys-chain-states-10-13)). Bone 1: rotX = rotZ = 0,
  anchors reset to the current point; in state 12 bone 1's yaw eases `/6`
  (`IMUL 0x2AAAAAAB`) through `+0x76C0` toward
  `0xC000 − ftol(atan2(x − eye.x, z − eye.z) × −10430.378)` (`FMUL double
  [0x0055CB20]`, the negated radians-to-BAMS factor), with a snap to
  `ftol(atan2 × 10430.378) − 0x4000` at variant-0 event 4. Bones `1 < i <= weak` walk 3 (or 4 at variant-0 event 2) path
  points ahead and set yaw `= atan2 + 0x4000 − Σyaw` and (variant 0, cursor
  0x440..0x579) pitch, easing through `+0x76BC` / `+0x7650`; bone at weak
  writes `+0x762E`. Full arithmetic is at `0x00422200..0x004227B4`.
* **13**: like 10–12 with `/32` easing.
* **14**: bones `0 < i <= weak`: `rotY += ftol(sin(ftol(i*65536/weak) * BAMS2RAD) * 512)`.

Then every bone: idx 2 re-parents bone 26 to bone 24's matrix
(`obj+0xFB4`); other heads re-parent the second jaw bone to the weak bone's
(`obj+0x234 + weak*0x90`); bone 0 of every actor but the body translates by
the root motion, halved against the previous frame's on odd frames
(`obj+0x12F4`, 0.5 at `0x004C43AC`); `T(node offset)`; the body's chain bones
`i < weak` rotate X,Y,Z by their own `+4/+8/+0xC`; every other bone rotates
`Z,Y,X` by the extra then `Z,Y,X` by the animated rotation; `MatrixStore` to
`bone+0x28`; `bone+0x68 = T(bone+0x7C)`. The skeleton walk follows the first
child down the neck and branches at the weak bone. Render-side except for the
outputs gameplay reads: `extra*`, `+0x5A4`, and the body's bone rotations
(which the next frame's jaw test reads).

#### The body's chain, states 10–13

Frame locals (`F` = `ESP` after the prologue's pushes; the loop runs at
`F − 4`): `c1 = F+0x10` and `c2 = F+0x20` both start at `+0x762C`,
`yawSum = F+0x18 = 0`, `pitchSum = F+0x44 = 0`; `F+0x28` is scratch that is
**not initialised** before bone 1 reads it (below). `anchor*` is the set at
`+0x2F4/+0x360/+0x3CC`, `anchor2*` the set at `+0x438/+0x4A4/+0x510`, each
indexed `[i]`; `pts[c]` is `+0x5A8 + c*0xC`. `wrap(c)` is
`c >= +0x7630 ? (variant ? 0xDD : 0x11E) : c`.

```
bone i == 1 (0x00422200), states 10/11/12:
    bone.rotX = 0; bone.rotZ = 0;
    anchor[1] = anchor2[1] = pts[+0x762C];
    state 12: bone.rotY = (+0x76C0 eased /6 toward the camera, above)   else bone.rotY = 0;
state 12, 1 < i <= weak (0x0042233C):
    d = wrap16(-+0x76BC[i]);
    if (variant == 1 && +0x59E == 4) +0x76BC[i] = ftol(d / (float)(i/2 + 4) + +0x76BC[i]);
    else                             +0x76BC[i] += d / 10;          // IMUL 0x66666667; SAR 2
    bone.rotY = +0x76BC[i];
    if (variant == 0 && +0x59E == 4) { +0x76BC[i] = 0; bone.rotY = 0; }
state 12, variant 0, 0 < i <= weak, +0x59E == 3, +0x762C >= 0x57A (0x00422414):
    +0x7650[i] += wrap16(bone.rotZ - +0x7650[i]) / 16;  bone.rotZ = +0x7650[i];
states 10/11, 0 < i <= weak (0x00422486), skipped when variant 0, clip 0x3D, i > 0xF
and obj+0x1330 is neither 2 nor 6:
    n = (variant == 0 && +0x59E == 2) ? 4 : 3;
    walk c1 forward n points (c1 = wrap(c1 + 1) each), P = pts[c1];
    yawRaw = ftol(atan2(P.x - anchorX[i], P.z - anchorZ[i]) * 10430.378);   // FPATAN, [0x004C4378]
    anchorX[i+1] = P.x;  anchorY[i+1] = F+0x28;  anchorZ[i+1] = P.z;       // anchorY is never read
    yawNew = (yawRaw + 0x4000) & 0xFFFF;
    Q = pts[c2];  dist = |Q - anchor2[i]|;
    3 times: c2 = wrap(c2 + 1); dist += |pts[c2] - previous|;              // dist is never used
    P2 = pts[c2];  F+0x28 = P2.y;
    pitchRaw = (s16)ftol(atan2(-(P2.y - anchor2Y[i]), hypot(P2.x - anchor2X[i], P2.z - anchor2Z[i])) * 10430.378);
    anchor2[i+1] = P2;
    bone.rotY = yawNew - yawSum;
    if (variant == 0 && 0x43F < +0x762C && +0x762C < 0x57A) bone.rotZ = pitchRaw - pitchSum;
    if (+0x762C == 0x57A) +0x5A0 = 0;
    pitchSum += bone.rotZ;  +0x76BC[i] = bone.rotY;  yawSum += bone.rotY;  +0x7650[i] = bone.rotZ;
    if (i == weak) +0x762E = c1;
state 13, 0 < i <= weak (0x004227B9), skipped as above (variant 1: i > 0xF and clip 0x3D):
    walk c1 forward n points as above (a distance is accumulated and dropped), P = pts[c1];
    yawNew = (ftol(atan2(P.x - anchorX[i], P.z - anchorZ[i]) * 10430.378) + 0x4000) & 0xFFFF;
    bone.rotY = +0x76BC[i] + wrap16(yawNew - yawSum - +0x76BC[i]) / 32;
    +0x76BC[i] = bone.rotY;  yawSum += bone.rotY;  anchorX[i+1] = P.x;  anchorZ[i+1] = P.z;
    if (i == weak) +0x762E = c1;
```

The chain runs from the tail (bone 0 at `pts[+0x762C]`, the actor's
position) **forward** along the path, three points per bone: the head (bone 24)
leads the body by about 72 path points `[proved]` from the arithmetic.

### The skeletons — and a decoder that truncates them

Walked from `g_character_skeletons` (`0x004E0430`) with no depth limit
`[proved]`:

* `boss3.bin` (`0x49`): root block (node 0), a single chain of nodes 1..17
  (offsets `(3, 0, 0)`, slot 914; node 17 slot 913), node 17 — **the weak
  bone** — has two children, 18 (slot 911) and 19 (slot 912), **both at
  offset `(3.662, −0.189, 0)`**: the jaws. 20 bones
  (`character_bone_count` 20).
* `boss3l.bin` (`0x48`): chain 1..24 (offsets `(4, 0, 0)`), node 24 the weak
  bone with jaws 25 (slot 898) and 26 (slot 899) at `(4.881, −0.252, 0)`.
  27 bones.

`Boss3ComposeBonePose`'s own walk follows the first child down and, at the
weak bone, keeps `child0.children[1]` for the second jaw — which for these
skeletons is past the end of a childless node and is never used, because the
jaw it would serve takes the first jaw's node and **both jaws have the same
offset** `[proved]`.

**Both `hod2lib` halves stop the skeleton walk at depth 12**
(`tools/hod2lib/exetab.py` `character_skeleton`, `depth > 12`;
`web/src/hod2lib/exetab.ts:1112`), so they return **13 of boss3's 19 nodes
and 13 of boss3l's 26** — no weak bone and no jaws `[proved]` (run above).
`b6boss3.bin` (`0x50`) is truncated the same way. A bundle built today would
give these heads nothing to shoot. Raising the bound (the `seen` set already
guards cycles) is a format change and lands in both halves together.

### `Boss3DrawBoneParts` — `0x004219E0` (render, with one clock in it)

For bones 1..n−1: `SetTop(bone.matrix)`, `AssetDrawSlot(bone.slot)`; then
per bone `[proved]`:

* **state 5, bone `+0x59A`, `+0x7640 < 0x25`**: `+0x7640++` and draw the
  bite flash `eff_boss3.bin` cels `0x97A + n%0x27` and `0x199C + n%32` at
  `T(7, −0.5, 0) RotY(0x4000)` (idx 2: `T(7, −4.5, 0) RotY(0x4000) RotX(0x2000)
  Scale 1.5`). **`+0x7640` is the clock `Boss3FightHeadUpdate`'s state 5 reads
  for its two sound cues (3 and 0xF)** — it advances once per frame because
  this routine runs every frame from the update, but it is a gameplay clock in
  a draw routine (L7).
* body state 11 at the weak bone: the same flash, `+0x7640++` uncapped.
* variant 0, body states 10..13, `i < weak`, **path** cursor (`+0x762C`, not
  the play cursor) in `(0x5E, 0x519]` or
  `>= 0x57A`, and not (clip 0x3D before cursor 0x37) nor (clips 0x3B/0x3C and
  `i > 0xF`): two `car_pl.bin` wake cels `0x8CE + g_frame_counter % 24` at
  `(4, −1.5, ∓3.2)`.
* `+0x59E == 3`, cursor `>= 0x43F`, bone `+0x59A`: world position of the jaw;
  in variant 0, state ≠ 14, with the latch `+0x5A0` down and the jaw below
  y −15: `PlaySoundId(0x4116A9)`, `Boss3SpawnSplashAt(x, −15, z, 0)`,
  `PoseHookNone(6, 0x28)`, latch up; the latch drops when the jaw is above −15.

The bodies continue past `MatrixStackPop` at `0x00421D6F` and `0x00421E56`.

### Small helpers

* `Boss3PlayStageSound` — `0x004207D0`: `PlaySoundId((g_scene_index == 2 ?
  g_boss3_sounds_st3 : g_boss3_sounds_st6)[n])` (`CMP word ptr [0x009a1a08], 2`).
* `Boss3SpawnBoneSpark` — `0x004247D0` / `Boss3SparkUpdate` — `0x004246F0`:
  15 cels of `common.bin[183..197]` at the bone's view point, sized by depth.
* `Boss3SpawnSplashAt` — `0x004248B0` / `Boss3SplashUpdate` — `0x00424800`:
  kind 0 cels `0x1339..0x1355` (scale 3), kind 1 `0x94..0xA1`.
* `Boss3SpawnMeshBulge` — `0x00424D90` / `Boss3MeshBulgeUpdate` —
  `0x00424C10`: variant 1 only; **raises** (phase 1 said "pushes down": the
  store is skipped by `FCOMPP; TEST AH,0x41` unless the arc is higher) the
  vertices of slot `0x1850`'s own model -- the asset record at `0x009BEBA4` is
  `0x009A66A4 + 0x1850*0x10`, the table the horde's sheet reads at
  `0x009B7394` -- near the body up to
  `sin(..)*5.5 − 13.475` within 10 units, draws `st1_1.bin[35]` and
  `st3_tika_bos.bin[0..9]`; stops at body state 14, dies on flag 4.
* `Boss3SpawnPathEffects` — `0x00424FE0` / `Boss3PathEffectUpdate` —
  `0x00424E10`: variant 1's four path-window effects
  (`eff_boss3.bin[40+cel]`, `COMMON\ENE_WALK6_22` every 8 cursor steps).

## `Boss3IntroCardUpdate` — `0x00424900`

The class's **own** intro — not `BossIntroBannerSpawn` (`0x00437A70`), which
this class never calls `[proved]` (no call to `0x00437A70`/`0x00437AC0` in the
range). A task (`ActorAlloc(…, 0x13F4)`, step at `+0x1310`, frame at
`+0x1320`), spawned by head 0 when `g_script_flags[1]` rises:

```
step 0: frame = 0; for i < 8: piece[i] = {0.18, -0.07, -1.0 - i*0.01, 0, 0.03}; step++;
step 1: if (frame == 0x50) step = 2 (and fall into step 2);
        else for i < 8:
            if (i < 6 && frame >= 5*i + 0xF) {
                piece[i].yaw += (i == 0) ? -0x300 : -0x200;  clamp at -0x8000;
                if (piece[i].yaw == -0x4200) piece[i].z = -1.0 - (8 - i)*0.01;
            }
            CurlModelSlot7EEByYaw(piece[i].yaw);                 // bends slot 0x7EE, see below
            identity; T(piece.xyz); RotY(yaw); Scale(scale); AssetDrawSlot(g_boss3_card_piece_slots[i]);
step 2: if (frame == 300) ActorKill();
        for i < 8: if (i != 6) { scale -= 0.005; if (scale <= 0) scale = 0; }
                   else if (scale < 0.06) { scale += 0.001; x -= 0.004; y += 0.002; }
                   draw as above (no CurlModelSlot7EEByYaw);
2 <= step <= 3 && frame >= 0x50:
        a = min((frame - 0x50) / 60, 1.0);
        SpriteDrawCheckedBank({0xBC, 344.0, 96.0, 1.0, 1,1, …, alpha a, -1, 0});
        SpriteDrawCheckedBank({0xCA, 492.0, 96.0, …});
frame++;
```

It writes **no** flag and **no** shutter. The two sprites are
`scr_bosmater_st3` entries 0 and 1, 256×64 each (the texbank the blocks load at
`0x008710`/`0x00977C`); that they are the boss's name is `[likely]` (a
512×64 banner across the top of the screen, in the stage-3 boss bank), and
not yet looked at.

## Damage model

| | heads (subtype 2) | body (subtype 5) |
|---|---|---|
| hit points | 45 (variants 0/1), 30 (variant 2) | 120 |
| weak point | bone `+0x598` (17 boss3, 24 boss3l) | bone 24 (literal `0x18`) |
| other gates | jaw open `|Δ(rotZ+extraZ)| > 0x1700`; neck sum `+0x5A4` outside `(0x1700, 0xC000)`; phase 1; state not 6/7; **idx 2 immune in variants 0/1** | state 11 or 12; jaw open `|ΔrotZ| > 0x1700` |
| damage | `ftol((45 / (P==2 ? 5 : 3)) * m)` = 15 / 9 | `ftol(m * (P==2 ? 6 : 10))` |
| `m` | Original Mode: `[0x009A224C + q*0x14]`, `−1.0` → 2.0; else 1.0 | same, with the shooter |
| points | 10 per damaging hit; 0x5DC on the last head (variant 2 only in practice) | 10 per hit; 0x5DC on the kill |
| miss | `BULLET_OTH1` + `Boss3SpawnBoneSpark` | same |
| bar | `pool/180` or `pool/150` | `hp/120` |
| retreat | flinch (state 6) | 2 hits (1P) / 3 hits (2P) in one surfacing → state 10 |

Both arms of the two-player code are real: `P` is `g_players_in_play`
(`0x009C8E80`); both bits set means a coin flip from `rand()`; a head bites
`obj+0x121` (a class-RNG pick with two players, else `g_active_player`); the
body's lunge hurts **both** players with two in play. `PlayerTakeDamage(p, 1,
9)` in every case.

**Stage 3 cannot be won by killing the big head**: variants 0/1 put idx 2
behind the immunity test, and it dies on its own when the other four are down
(`0x00421879`). No 0x5DC is awarded for the heads there, because
`g_boss3_heads_left` reaches 0 in that path and not in the hit path
`[proved]`.

## Health bar and banner

`BossHpBarSpawn` (`0x00435E50`) is called four times, always with
`(320.0, 35.0)` (`PUSH 0x420C0000; PUSH 0x43A00000`) `[proved]`:

| call | when |
|---|---|
| `0x00420EBE` | variant 2, the first head to see `g_script_flags[0] == 1` in phase 0 (the others see phase 1 already) |
| `0x00420FD2` | Boss Mode, head 0, `g_script_flags[2] == 1` |
| `0x00422DFA` | arcade, head 0 in `Boss3FightHeadIntroGrab` state 3, `g_script_flags[2] == 1` |
| `0x004237B2` | the body, path cursor `0xB4` after the move |

Every `g_boss_hp_fraction` (`0x009C8E10`) access in the class `[proved]` (byte
search `10 8e 9c 00`):

| address | write |
|---|---|
| `0x00420C22` | head hit: `pool * (1/150 or 1/180)` |
| `0x00420C28` | read back for the clamp |
| `0x00420C3B` | 0.0 when negative |
| `0x00420CE3` | 0.0 when the last head dies in the hit path |
| `0x00420EC6`, `0x00420FDA`, `0x00422E02`, `0x004237BA` | 1.0, after each spawn (redundant: the spawn writes 1.0 itself) |
| `0x00423329` | body hit: `hp * (1/120)` (`FST`) |
| `0x0042333C` | 0.0 when negative |
| `0x00423392` | 0.0 at the body's death |

Nothing in the class writes `−1.0`; each bar ends by `BossHpBarUpdate`'s own
120 frames after the fraction reaches 0.0. In stage 3 there are **two bars**:
the heads' (from flag 2) and the body's (from cursor 0xB4) `[proved]`.

The class's intro title is its own (`Boss3IntroCardUpdate`); it does not use
the shared banner.

## How the siblings talk

Through the globals and through each other's actors, never through a parent
`[proved]`:

* `g_boss3_heads[5]` / `g_boss3_bystanders[2]`: the scheduler (head idx 2)
  writes other heads' `+0x764A`; heads 0/4 drive their bystander's state and
  velocity; the opening head reads the opening bystander's state; the body and
  the three effect tasks read `g_boss3_heads[0]` (the body overwrites slot 0
  on init and every frame).
* `g_boss3_phase`, `g_boss3_heads_left`, `g_boss3_heads_attacking`,
  `g_boss3_last_head`, `g_boss3_attack_delay`, `g_boss3_rank`,
  `g_boss3_head_hp_pool`, `g_boss3_track_point`: the head fight's shared
  state. Head idx 2 is the director: it schedules attacks, counts for the
  enemy gate, and (variants 0/1) ends the fight.
* The body shares nothing with the heads but `g_boss3_variant` and the
  scripts' flags; it is spawned after the first gate.

## What the exporter must carry

1. **A character-type rule for class 0x45** (`CHAR_TYPE_RULES` in
   `web/src/hod2lib/spawnres.ts`, and its twin in
   `tools/hod2lib/spawnres.py`). None of the existing rule kinds fits, because
   the type depends on the subtype byte and, for subtype 2, on the index word
   `[proved]`:

   | `desc+0x25` | type |
   |---|---|
   | 0 | `0x49` (literal) |
   | 1, 3 | `desc+0x24` (s8) — `0x34`, `0x2E` in the shipped data |
   | 2 | `(u16)desc+0x22 == 2 ? 0x48 : 0x49` |
   | 4 | none |
   | 5 | `0x48` |

   It does not vary by stage: stage 6 uses the same two types (and loads
   `boss3.bin`/`boss3l.bin`). **`0x50` (`b6boss3.bin`) and `0x54`
   (`boss3_hod1.bin`) are not this class's** — no instruction in the class
   writes either `[proved]`; who uses them is `[open]`.
2. **A motion rule** (the clip each opens in) and the clip lists to bake:
   * opening head: `0x5A` (block 11) or `0x5B` — the rule has to know the
     block;
   * bystanders: `0x23D` (subtype 1), `0x21E` (subtype 3);
   * heads: idx 2 → 67; others → `g_boss3_idle_motions_a/b[idx]` (A for even,
     B for odd), **except** outside Boss Mode idx 0/4 open in `0x58`;
   * body: `0x42`.
   Clips reachable: `boss3.bin` 74–100 (74, 75, 76 `0x4C`, 77, 78, 79, 80–84,
   85, 86, 87 `0x57`, 88 `0x58`, 89 `0x59`, 90 `0x5A`, 91 `0x5B`, 92, 93–98, 99,
   100); `boss3l.bin` 59–62, 64–73 (`0x3B`–`0x3E`, 64, 65 `0x41`, 66 `0x42`,
   67–72, 73 `0x49`); bystanders `0x21D`, `0x21E`, `0x21F`, `0x23D`, `0x24F`,
   `0x264`. `g_motion_play_length` of each is load-bearing (the heads' and
   body's timings read the cursor and clip end).
   **And the skeletons themselves must be whole**: both `hod2lib` halves cut
   the node walk at depth 12, which drops the weak bone and both jaws of
   `boss3.bin` and `boss3l.bin` (see [the skeletons](#the-skeletons--and-a-decoder-that-truncates-them)).
3. **The two index words and the subtype** on each placement (`desc+0x22`,
   `desc+0x25`), and `desc+0x24` for the bystanders.
4. Object paths `op_st3` 354–370 and camera paths `cp_st3` 137–144, 150–158:
   already in every stage-3 bundle's `cam.json` (it exports every slot)
   `[likely]` — check in phase 2.
5. The asset slots the effects draw (render only): `etc_2.bin[2..3]`,
   `boss3.bin[5]`, `eff_boss3.bin[0..54]`, `common.bin[25..38, 183..197,
   200, 307..335]`, `car_pl.bin[16..39]`, `st1_1.bin[35]`,
   `st3_tika_bos.bin[0..9]`, and screen sprites `0xBC`, `0xCA`.

No per-instance model overrides: the op-0x09 descriptor has a two-byte tail.

## What the port needs that `game/` cannot compute headlessly

* **Animated bone rotations.** Both hit tests read the jaw bones' Z rotation
  as the motion posed it (`bone+0x0C`), and the heads' state 5 sums the neck's
  Z rotations into `+0x5A4`. The port's skeleton is three.js's; `GameHost`
  has `boneWorld` and `boneMatrix` but no local-rotation query. Needs a new
  seam (`boneLocalRotation(at, bone)`) or a motion sampler in `game/`.
* **The class's own pose.** The render layer must apply `extra*` to the heads
  and build the body's chain from the path points; otherwise `boneWorld` of the
  weak bone — which feeds `g_boss3_track_point`, the body's `obj+0x100`, the
  camera aim and the shot pick — is the wrong point.
* `CamEvalObjectPath6` (`host.objectPath`) for 2313/2349 path points, and
  `CamEvalPath7` (`host.camPath`) for the camera the body drives. Both seams
  exist.
* The shot pick (`host.pickShot`) must return this skeleton's node numbering
  (weak bones 17/24).
* Camera-space transforms for `obj+0x70` (`host.cameraMatrices`).

## Phase-2 notes (layering and shared files)

* **`g_camera_driver_held` (`0x009CA094`)** forces camera mode 6 and the body
  then writes camera block 0's eye (via `CamEvalPath7`), yaw and pitch. The
  port's `game/camera/mode.ts` records the override as unmodelled; the port
  needs it, and the body's writes must reach the same camera state the
  director uses. Shared file.
* **`script/walker.ts`'s `ENEMY_GATE_CLASSES`** must include `0x45`, or the
  walker's own view of which classes a `wait_enemies_present` waits on is
  wrong. Shared file, `script/` layer.
* `g_bHudShutterState` 5/1 and `EvtOpPlayDialogue2D(0x83)` from the body.
* The path points (2400 × 3 floats) live in the state block. If the block is
  an actor field they go through `clonePlain` on every save; they are a pure
  function of the variant and the paths, so recomputing them on load is the
  alternative. A design decision, not a divergence to pick silently.
* `+0x7640` is a gameplay clock advanced by a draw routine (L7): in the port
  the increment belongs in `game/`, with `Boss3DrawBoneParts` split as the exe
  splits nothing — keep the function, move nothing across its boundary, and
  let the render layer draw from the state it leaves.
* Sounds are all known by id (table above); `PoseHookNone(n, m)` calls are
  no-ops and can be ported as calls to a no-op.

## Ghidra hazards (L35 and L1)

`MatrixStackPop` is treated as no-return in the live database, so these
bodies stop early and their pseudocode ends in a false `return`:

| function | stops at | real code after |
|---|---|---|
| `Boss3OpeningBystanderUpdate` | `0x004205DB` | `0x004205E0..0x004207B5` (the whole state machine) |
| `Boss3HeldBystanderInit` | `0x00420294`, `0x0042033C` | frame and update stores |
| `Boss3FightHeadUpdate` | `0x004217EE` | `0x004217F3..0x00421878` (tracking publish) |
| `Boss3DrawBoneParts` | `0x00421D6F`, `0x00421E56` | the second wake cel; the splash cue and the loop |
| `Boss3ComposeBonePose` | `0x00422C27` | epilogue only |
| `Boss3OpeningHeadUpdate` | `0x0042316B` | `0x00423170..0x004231BE` (the placement) |
| `Boss3BodyUpdate` | `0x00423656`, `0x004236F4`, `0x00423DF5`, `0x00423F05`, `0x0042405D` | the splashes, the death splash, the camera aim and `RegisterForShotTest` |
| `Boss3SparkUpdate`, `Boss3SplashUpdate`, `Boss3IntroCardUpdate`, `Boss3PathEffectUpdate`, `Boss3MeshBulgeUpdate` | at their pops | cel advance and `ActorKill` |

Pre-comments mark four of these in the live database. The decompiler also
drops the `__ftol` operands (L1): every damage, sway and bar value above was
read from the FPU instructions.

The **Boss Mode stage-select** routines after the class
(`0x00425010` class `0x6C`'s handler, `0x00425780`, `0x00425BD0`,
`0x00425DF0`, `0x00425E90`) are not this class: `g_class_handler_pairs` maps
`0x6C → 0x00425010` (the pair at `0x00593500`) and nothing in class 0x45 calls them
`[proved]`. They are left unnamed. `RunAttractScene10/11` before the class and
`BossModeRecordGrade` after it are not this class either; the body calls
`BossModeRecordGrade` once, on its despawn.

## Open questions

* What `obj+0x34` bits `0x80000` and `0x80000000` do for this class. `[open]`
  The port carries both as the Inits write them.
* Whether any stage-6 actor raises `g_script_flags[0]` before block 2's
  `set_script_flag 0` at `0x001E9C` — it would start the stage-6 fight at
  once. Flags are zeroed only per scene. `[open]`; the port runs the same
  actors, and its stage-6 playthrough reaches the fight on the script's own
  write.

Answered since phase 1:

* `0x009CA0EA` is `g_boss_engaged` (named on main). `[proved]`
* `FUN_004759C0` is `CurlModelSlot7EEByYaw`: it bends the loaded model of
  asset slot `0x7EE` -- `etc_2.bin[3]`, the card back this card draws as
  pieces 1..5 and 7 -- by the yaw it is handed, every full vertex's z from its
  x, so each back turns over like a page. Step 1 calls it per piece just
  before the piece's draw; step 2 does not, so there the pieces keep piece 7's
  bend (yaw 0, the model as loaded). It was named `CurlModelSlot3F7ByYaw` and
  called inert (`405c17c`) off a slot-record stride of 0x20; `AssetDrawSlot`'s
  is 0x10. `render/card_curl.ts` ports it. `[proved]`
* The byte at `0x009C88AC` is an **Original Mode item effect**:
  `FUN_00416240` (called only from `FUN_004163D0`) walks the player's two item
  slots and, through the byte table at `0x00416314`, sets it for item `0x0C`
  (arm `0x00416284`, which also resets the weapon block) or `0x14` (arm
  `0x0041629A`); `ResetOriginalModeLoadout` clears it. The port fills no item
  slot (`FUN_00475E40` is unported), so the byte is never set there and the
  bystanders' scaling never applies -- as in the engine without the item.
  `[proved]`
* Handler → init → update is three frames: the handler stores the init in
  `obj+0x00` and returns (`0x0041FD54`..`0x0041FD89`), each init stores the
  update and returns, and the task walk calls `obj+0x00` once a frame.
  `[proved]`
* Screen sprites `0xBC`/`0xCA`, exported and looked at: the gold-on-black
  **"TOWER"** plate and the **"Type 8000"** line. `[proved]`
* Draw byte 5 and what is drawn: `SkeletonEmitNode` (`FUN_004114C0`) draws a
  node **only through the pose hook** at `model+0x1158` (then computes the
  bone point unless `obj+0x34 & 0x8000`). `ActorBuildSkinnedModel` installs
  `SkeletonDrawNodeSlot` (`FUN_00411050`) there -- `NoOpStub(model scale);
  AssetDrawSlot(node slot)` -- and `PoseHookNone` at `+0x115C`. The opening
  head keeps the build's draw hook; the civilians install
  `Boss3BystanderPoseHook`; the heads and the body install `PoseHookNone` at
  `+0x1158`, so their `DrawSkinnedModelAndShadow` draws **nothing**, and
  `Boss3DrawBoneParts` draws bones `1..n-1` from the (possibly composed)
  matrices. The body skips `Boss3DrawBoneParts` in states 8 and 9, so it is
  not drawn at all while it builds its path. Draw byte 5 is the object
  matrix's form, `T(pos) Rz Ry Rx S(scale) T(root)`. `[proved]`
