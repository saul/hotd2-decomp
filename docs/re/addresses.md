# Address map — `Hod2.exe`

All addresses are virtual (imagebase `0x400000`). Everything here was found by
static inspection; nothing has been confirmed by execution.

## Image layout

| Section | VSize | VAddr | RSize | RAddr | Notes |
|---|---|---|---|---|---|
| `.text` | `0x0C2520` | `0x001000` | `0x0C3000` | `0x001000` | ~795 KB, ~16.5k call sites |
| `.rdata` | `0x0B0DDA` | `0x0C4000` | `0x0B1000` | `0x0C4000` | strings, COM GUIDs, import tables |
| `.data` | `0x457000` | `0x175000` | `0x028000` | `0x175000` | vsize ≫ rsize — ~4.4 MB BSS, likely emulated VRAM / framebuffers |
| `.rsrc` | `0x0012F8` | `0x5CC000` | `0x002000` | `0x19D000` | |

Entry point `0x4AD3B5`. Linker 6.0, subsystem 2 (GUI), timestamp `0x3AF8F851`
= 2001-05-09 07:10:09 UTC.

## Asset loaders

Each follows the same shape: `sprintf` a path from a directory template and a
filename table entry, `CreateFileA`, `GetFileSize`, allocate `size + 0x20`,
align the result up to 32, then `ReadFile`.

| Address | Directory | Notes |
|---|---|---|
| `0x403F1B` | `cam\%s` | open + allocate only; the `ReadFile` is at `0x403FB0` (deferred/streamed) |
| `0x412CBC` | `mot\%s` | |
| `0x41C8DA` | `tex\%s` | early-outs if the slot's byte at `+0x08` is non-zero (already-loaded check) |
| `0x41CDC2` | `tex\%s` | second call site |
| `0x48A326` | `coli\%s` | |
| `0x4A7400` | — | shared allocator, called with `size + 0x20` |

The `pol\%s` template is reached through the pointer table at `0x57A008`. Its
consumers are `0x00418205` (inside `LoadCommonPolTexBanks`), `0x0041887D` and
`0x00418C80` — the last two are not yet inside recognised functions.

## String constants

| Address | Value |
|---|---|
| `0x57A008` | pointer table: `→ 0x57A2C0` (`pol\%s`), `→ 0x57A2B8` (`tex\%s`) |
| `0x57A2C0` | `pol\%s` |
| `0x57A2B8` | `tex\%s` |
| `0x579920` | `mot\%s` |
| `0x5773D0` | `cam\%s` |
| `0x57995C` | `evt\%s` (referenced via the table at `0x579958`) |
| `0x597260` | `coli\%s` |
| `0x5773CC` | passed to the same function as the formatted path — probably a base/root path prefix |

## `.data` tables

Indexed by asset ID to produce a filename pointer. The tables immediately
adjacent to these very likely hold per-bank texture counts, which Phase 4 needs
in order to size unreferenced texture slots.

| Address | Indexed by | Contents |
|---|---|---|
| `0x4D1410` | `ecx * 4` | `tex/` filename pointers |
| `0x4D1B00` | `eax * 4` | `mot/` filename pointers |
| `0x4D1BC8` | `edi * 4` | `cam/` filename pointers |
| `0x4C476C` | `edi * 2` | `u16` count, parallel to the `cam` table (**u16 stride, not u32**) |
| `0x4E2BDC` | `eax * 2` | `u16` count, parallel to the `mot` table |
| `0x4E2B14` | `eax * 4` | pointer table, parallel to the `mot` table |
| `0x9C7320` | `(ecx * 3) * 4` | 12-byte-stride `tex/` slot records; byte at `+0x08` is a load-state flag |
| `0x9A37E0` | `ecx * 8` | 8-byte-stride records touched by the `mot` loader |
| `0x59C9F8` | `eax * 8` | 8-byte-stride records touched by the `cam` loader |

## Imports of interest

| IAT slot | Function |
|---|---|
| `0x4C4074` | `CreateFileA` |
| `0x4C4078` | `GetFileSize` |
| `0x4C409C` | `ReadFile` |
| `0x4C4098` | `SetFilePointer` |
| `0x4C40A0` | `CloseHandle` |
| `0x4C40A4` | `OutputDebugStringA` — resolved; debug logging, not path processing |
| `0x4C4208` | `sprintf` (or equivalent) |
| `0x4C4000` | `DirectDrawCreateEx` |
| `0x4C400C` | `DirectInputCreateEx` |

`ddraw.dll` exposes only `DirectDrawCreateEx` and `DirectDrawEnumerateExA`;
Direct3D 7 is reached by `QueryInterface`.

## COM GUIDs present (`.rdata`)

| Raw offset | GUID |
|---|---|
| `0x171120` | `IID_IDirectInputDevice7A` |
| `0x171140` | `IID_IDirect3DTnLHalDevice` |
| `0x171170` | `IID_IDirect3DHALDevice` |
| `0x171180` | `IID_IDirect3DRGBDevice` |
| `0x171190` | `IID_IDirect3D7` |
| `0x1711A0` | `IID_IDirectDraw7` |

Notably absent: `IID_IDirect3DDevice7` and `IID_IDirectDrawSurface7`. The device
is created via `IDirect3D7::CreateDevice` with one of the three device GUIDs
above rather than by `QueryInterface`, which is the normal `d3du` pattern.

## Library vs game code

`.text` splits cleanly. Everything from roughly `0x004ACF50` upward is library
code that can be ignored; game code lives below it.

| Range | Contents | How identified |
|---|---|---|
| `0x00401000` – `~0x004AC000` | **game code** | everything else |
| `~0x004ACF50` – `0x004B74xx` | statically linked MSVC 6.0 CRT | Ghidra Function ID (`vsOlder_x86`) |
| `0x004B74FC` – `0x004BC063` | DX7 SDK `d3du`/D3DX utility library | diagnostic strings, see below |
| `0x004C31xx` – `0x004C3FFF` | CRT tail, exception unwind helpers | Function ID + PE exception analyser |

The `d3du`/D3DX block is stock Microsoft sample code. Its diagnostic strings
carry literal `Class::Method - message` text, so `TagLibraryFunctions.java`
names the owning functions exactly rather than guessing, and tags each with
**`D3DX_LIB`**. 30 functions were recovered this way, listed in
`ghidra/out/d3dx_lib.txt`.

Filter `D3DX_LIB` out of any function listing before looking for game logic.

## Identified functions

| Address | Name | Notes |
|---|---|---|
| `0x0040ACD0` | `LzDecompress` | **The compression codec.** `int LzDecompress(u8 *src, u8 *dst)`, returns bytes written. LZSS, 8 KB window, LSB-first interleaved flag bits. Spec in [`../formats/lz.md`](../formats/lz.md) |
| `0x00418200` | `LoadCommonPolTexBanks` | Loads `pol/common.bin` + `tex/common.bin`. The clearest example of the asset load path; every other loader is a variation. Calls `LzDecompress` twice |
| `0x004C40A4` | `OutputDebugStringA` | Import. Called on the path buffer before every `CreateFileA` — it is debug logging, not path processing |

## Superseded: decompressor candidates

Kept as a record of what did **not** work.

The sweep below looked for a 4 KB sliding window (`& 0xFFF`). **None of these
was the decompressor.** The real window is 8 KB and its size never appears as a
constant: the offset is produced by sign-extending a 13-bit field, so there is
no mask to find.

What worked instead was following the data path from the loader — see
[`../formats/lz.md`](../formats/lz.md).

### Original candidate list

Sites masking with `0xFFF`, consistent with a 4 KB sliding window. Unverified —
some are certainly unrelated.

| Address | Register |
|---|---|
| `0x40D733` | `ecx` |
| `0x40D74A` | `eax` |
| `0x4143E2` | `edx` |
| `0x41D15D` | `eax` |
| `0x41D176` | `ecx` |
| `0x41D187` | `edx` |
| `0x41D25D` | `ebx` |
| `0x438E4D` | `eax` |
| `0x438E6B` | `eax` |
| `0x43F5FF` | `ebp` |
| `0x43F60A` | `eax` |
| `0x460629` | `edx` |
| `0x482B51` | `eax` |
| `0x4B2C45` | `ecx` |

`0x41D15D` – `0x41D25D` is the strongest lead: four masks clustered in one
function, close to the `tex` loaders at `0x41C8DA` / `0x41CDC2`.

No `0xFEE` constant is present, so this is **not** stock Okumura LZSS with the
classic ring-buffer initialisation.

## Event system (`evt/`) — Phase 6

| Address | Role |
|---|---|
| `0x00413070` | loads `comevtbl.bin` into `0x00977200`, then the scene table |
| `0x00413160` | loads `evt\<scene table>` into `0x00977400`; early-outs if already loaded |
| `0x00413120` | **pointer fixup**: `if ((w & 0xFFF80000) == 0x0CE80000) w += 0xF3AC1A00` |
| `0x0045EB60` | `SceneRoot(scene)` — `*(u32 *)(0x00977200 + scene * 4)` |
| `0x0045EB70` | `BlockTable(scene, block)` |
| `0x0045EB90` | `Step(scene, block, step)` — the bytecode stream pointer |
| `0x0045EBC0` | block entry: initialises interpreter state |
| `0x0045ECC0` | **the interpreter loop** — `dispatch[*pc]()` until yield |
| `0x0045F000` | end of block: consults the route table, advances or ends the scene |
| `0x004088A0` | opcode `0x09` handler — spawn from placed descriptors |
| `0x00408A20` | opcode `0x0B` object constructor from a descriptor |
| `0x00408BC0` | opcode `0x0C` object constructor (smaller base class) |
| `0x0040B3F0` | `view_set` (opcodes `0x20`/`0x24`) |
| `0x0040B650` | `view_tween_rate` (`0x21`/`0x25`) |
| `0x0040BA90` | `view_tween_time` (`0x23`/`0x27`) |
| `0x0040C1F0` | `view_stop` (`0x22`/`0x26`) |
| `0x00402320` | dispatches queued scripted actions pushed by opcode `0x30` |
| `0x0041EBB0` | the empty stub five unused dispatch slots point at |

| Data | Contents |
|---|---|
| `0x005931D8` | **opcode dispatch table**, 96 entries (`0x00`–`0x5F`) |
| `0x005776EC` | two-level table of queued scripted actions, indexed by `sel>>4`, `sel&0xF` |
| `0x00597890` | scene → route table pointer (8-byte records: `kind`, `next[3]`) |
| `0x00579928` | scene → index into the `evt/` filename table (`-1` = no file) |
| `0x004D1C7C` | `evt/` filename pointer table |
| `0x00977200` | `comevtbl.bin` load buffer (DC `0x0CEB5800`), 0x200 bytes |
| `0x00977400` | scene event table load buffer (DC `0x0CEB5A00`) |
| `0x009C7108` | interpreter `pc` |
| `0x009A1A08` | current scene id |
| `0x009A2BC0` | current block index |
| `0x009A2BB0` | current step index |
| `0x009C88A4` | branch choice for route `kind == 1` |
| `0x009C8EA0` | yield flag — set by the `wait_*` opcodes |
| `0x009A3540` | view struct, player 1 |
| `0x009A59E0` | view struct, player 2 |
| `0x009A2280` | class index → per-class handler fn (112 slots, built by `FUN_0040AC90`) |
| `0x00593358` | `{class_id, handler}` pair list, 56 entries, terminated by a negative id |
| `0x004A6FA0` | object allocator: `alloc(size)`, zero, link, store *handler* at +0x00 |

## Asset streaming — Phase 6

| Address | Role |
|---|---|
| `0x0041D5A0` | run asset job `i & 0x3F` — `handler[kind](job)` |
| `0x0041D5D0` | enqueue **load slot** (evt opcode `0x50`) |
| `0x0041D610` | enqueue **unload slot** (`0x51`) |
| `0x0041D650` | enqueue **load pol file** (`0x52`) |
| `0x0041D690` | enqueue **free pol file** (`0x53`) |
| `0x0041D6D0` / `0x0041D710` | enqueue tex bank load / free (`0x54`/`0x55`) |
| `0x0041D750` / `0x0041D790` | enqueue job kinds 8 / 9 (`0x56`/`0x57`) |
| `0x00418820` | load ONE slot: read offset table, seek, read just that model |
| `0x00418BA0` | unload one slot: unlink, free, clear state |
| `0x00418C20` | read a whole pol file into staging |
| `0x00418D20` | LZ-decompress staging into a fresh buffer |
| `0x00419020` | release a whole pol file, mark its slots absent |
| `0x0041CD00` | texture bank teardown |
| `0x004A6FA0` | object allocator: `alloc(size)`, zero, link, handler at +0x00 |

| Data | Contents |
|---|---|
| `0x007DA220` | asset job ring, 64 x 16 bytes `{kind, _, arg, state}` |
| `0x007D9E1C` | job ring write cursor (`& 0x3F`) |
| `0x00588C20` | job kind -> handler (8 entries) |
| `0x0057A29C` | sub-handler table for kinds 0/1 (7 entries) |
| `0x009A66A0` | asset slot state, 16-byte records |
| `0x004D0EF4` | pol file index -> filename |
| `0x004E803C` | pol file index -> entry count |
| `0x004E794C` | pol file index -> `s16[count]` slot ids, container order |
| `0x004E83B4` | slot id -> owning pol file index |
| `0x004E7C90` | 20 pointers to grouped slot-id runs (one model file each) |

## Camera / object paths (`cam/`) — Phase 6

| Address | Role |
|---|---|
| `0x00403EC0` | opens `cam\%s`, allocates `size + 0x20`, aligns to 32, stores base at `0x0059C9EC` |
| `0x00403FB0` | the deferred `ReadFile` |
| `0x00404000` | binds each table entry to its global slot: `slot[i].ptr = base + offset[i]` |
| `0x004040F0` | **cubic Hermite curve evaluator** |
| `0x004041E0` | 7-channel consumer — eye, look-at, roll. Used for `cp_*` |
| `0x004042D0` | 6-channel consumer — position + BAMS Euler triple. Used for `op_*` |
| `0x00401F40` | per-frame camera update; calls `FUN_0040E0B0(DAT_009A3558, DAT_009A355C, ...)` |

| Data | Contents |
|---|---|
| `0x004D1BC8` | `cam/` filename pointer table — `u32`, `+ file * 4` |
| `0x004C476C` | path count per cam file — **`u16`, `+ file * 2`** (a `u32` read returns garbage, not an error) |
| `0x004C470C` | pointer to `s16[count]` slot ids — `u32`, `+ file * 4` |
| `0x004C479C` | slot → owning cam file index — **`s8`, `+ slot * 1`** |
| `0x0059C9EC` | aligned load buffer base for the current cam file |
| `0x0059C9F8` | slot → `{u32 ptr; u16 state}`, 8-byte records |

## Crash sites (from `exception.log`)

Three `c0000005` access violations recorded by the game's own handler. Useful as
free anchors into real code paths.

| `Eip` | Context |
|---|---|
| `0x413133` | Stack contains the ASCII `\evt\st1evtbl.bin` — inside `evt` loading |
| `0x4C2E5E` | Return addresses `0x4C2D4E`, `0x4B034C`, `0x4AFBB0` on the stack |
| `0x4041FC` | Return addresses `0x40344E`, `0x40338E`, `0x402329` on the stack |

The first is the most valuable: it places `evt` loading near `0x413133` and
confirms paths are built at runtime rather than stored whole.

## Model load, walk and draw — Phase 3/5

| Address | Name | Notes |
|---|---|---|
| `0x00418A00` | `AssetLoadTexBankStep` | `tex\%s` load step (entry 1 of the job sub-step table at `0x0057A29C`); binds the bank and, for four slots, applies the two model patches below |
| `0x00419270` | `ModelFlipStripCullingParity` | XORs bit 0 of every **strip** control word — flips culling 2↔3. The canonical statement of the NL1 chain walk |
| `0x00419300` | `ModelForceFogControlNone` | forces every mesh's `tsp` fog control (bits 22–23) to 2 = none |
| `0x004AC980` | `BindModelTextureHandles` | rewrites each mesh's `texture_id` to a global texture handle \| `0x40000000`; skips `-1` and already-bound |
| `0x004A7EF0` | `WalkMeshChainAndDraw` | the mesh-chain renderer; two passes, opaque then translucent |
| `0x004A7780` | `TranslatePvr2StateToD3D` | the PowerVR2 → D3D7 state translation |
| `0x004A59C0` | `DrawStripPrimitive` | `DrawPrimitive(D3DPT_TRIANGLESTRIP, 0x112, …)` |
| `0x004A5A40` | `DrawTriangleListPrimitive` | `DrawPrimitive(D3DPT_TRIANGLELIST, 0x112, …)` |
| `0x004A7AB0` | `DrawSpriteQuadCommand` | 2D/billboard quad path — four corners, BAMS rotation |
| `0x004A7630` | `RenderInitStates` | one-time device render state |
| `0x004A4DA0` | `InitD3DDeviceAndTextureStages` | device creation; the only other `SetTextureStageState` site |
| `0x004AA2B0` | `RenderSubmitModelDefaultLight` | builds a 0x1D-dword draw command |
| `0x004AA500` | `RenderSubmitModelSceneLights` | same, with flag `0x04000000` |
| `0x004A7E50` | `RenderEnqueueCommand` | opaque pass + copy into the sort list |
| `0x004A88E0` | `RenderFlushCommandList` | sorts and replays; translucent pass |
| `0x004A9880` | `MatrixStackPush` | 16 dwords per level at `0x007E7990` |
| `0x004A9840` | `MatrixStackPop` | |

### Matrix stack and projection

| Address | Name | Notes |
|---|---|---|
| `0x004A9250` | `SetMatrixMode` | 3 = PROJECTION, 1 = WORLD; the 3→1 transition is the only `SetTransform(PROJECTION)` in the program |
| `0x004A9E10` | `MatrixLoadIdentity` | copies `g_identity_matrix` at `0x00571210` |
| `0x004A9D80` | `MatrixTranslate` | |
| `0x004A99F0` | `MatrixRotateX` | BAMS |
| `0x004A9AE0` | `MatrixRotateY` | BAMS |
| `0x004A92A0` | `MatrixMultiply` | top = top × M |
| `0x004ABD40` | `BuildPerspectiveProjection` | `(fov_bams, aspect, znear, zfar)`, left-handed |
| `0x004184C0` | `SetupSceneProjection` | the game's one 3D projection: `0x1D3B`, 4:3, 0.8, 8000 |
| `0x004194C0` | `SetProjectionNearPlane` | same but a caller-supplied near plane, for HUD layers |
| `0x004A8440` | `DrawModelWithForcedAlphaBlend` | mesh walker variant: forces `SRC_ALPHA`/`INV_SRC_ALPHA` and scales alpha by the command's `+0x10` |
| `0x004B73CC` | `D3duBuildPerspectiveMatrix` | **dead** — stock d3du scaffolding, its output is never used |

Constants: `0x004C4C98` = 0.5 (the FOV halving), `0x004C4370` = 2π/65536.

### Scripted actions and the `evt` → `cam` link

| Address | Name | Notes |
|---|---|---|
| `0x00402320` | `EvtRunQueuedActions` | drains the opcode-`0x30` ring; two-level dispatch through `0x005776EC` |
| `0x00403360` | `EvtActionCamPlay40` | selector `0x40` — plays a `cam/` path |
| `0x00403510` | `CamStartPathPlayback` | |
| `0x004035E0` | `CamAdvancePathFrame` | calls `CamEvalPath7` once per frame |
| `0x00403830` | `EvtActionSetPlayerFlag10` | selector `0x10` |
| `0x004036B0` | `EvtActionSceneState11` | `0x11` |
| `0x00403780` | `EvtActionSetUpdateRoutine12` | `0x12` |
| `0x00403250` | `EvtActionSetContinuation13` | `0x13`, never used in shipped data |
| `0x004037E0` | `EvtActionSetGlobal14` | `0x14` |
| `0x00403930` | `EvtActionSetFlag15` | `0x15` |
| `0x004032E0` | `EvtActionHoldCameraPreset20` | `0x20` |
| `0x00403710` | `EvtActionFinishSequence21` | `0x21`, 418 uses |
| `0x004038A0` | `EvtActionStoreSixOperands60` | `0x60` |
| `0x00403BD0` | `EvtEnterSceneState` | jumps through the 2-D state table at `0x00576C14` (9 columns) |

### `evt/` opcode handlers

The 96-entry dispatch table is at `0x005931D8`; handler `N` is entry `N`.
Slots `00`, `2A`, `34`, `3C`, `4C` point at `FUN_0041EBB0`, a bare `RET`.
All the handlers named this session carry their opcode as a name suffix, e.g.
`EvtOpWaitScriptFlag45`. The full semantic table is in
[`../formats/evt.md`](../formats/evt.md); a condensed copy is the plate comment
on `EvtInterpreterLoop` (`0x0045ECC0`).

Supporting routines identified along the way:

| Address | Name |
|---|---|
| `0x0041D970` / `0x0041D9D0` / `0x0041DA70` | `AssetDrainAllJobs` / `AssetDrainTexAndPolJobs` / `AssetDrainMotionJobs` |
| `0x0041D3A0` / `0x0041D3B0` | `SndLoadPackStubbedOut` / `SndFreePackStubbedOut` |
| `0x0041D450` | `BgmStopThenPlay` |
| `0x004156C0` | `ScoreAddForPlayer` |
| `0x004ABE70` | `CrtSrand` |
| `0x00480AC0` | `BuildEntitySpotlightArray` (one `D3DLIGHT7` spot per entity) |
| `0x00409D40` | `QueryGroundHeightAt` |
| `0x004159A0` | `PlacePlayerEntityFromViewPose` |
| `0x004AA070` / `0x004AA0A0` / `0x004AA0E0` | set render ambient / light colour / light direction |

| Table | Contents |
|---|---|
| `0x00567990` | accuracy bonus, 11 × s16 `{0,0,0,0,500,1000,1500,2000,2500,3000,4000}` |
| `0x00579968` | 12 × 16-byte backdrop presets |
| `0x00589DA8` | 0x10-byte screen-message records |
| `0x009C7200` | 256-byte script flag array |
| `0x009A2BE0` | 4 × 3 f32 enemy approach rings; defaults at `0x004C4CD0` |

### The scene state machine

| Address | Name | Notes |
|---|---|---|
| `0x00403BD0` | `EvtEnterSceneState` | `goto g_scene_state_table[major*9 + minor]` |
| `0x00402710` | `SceneStateInvalidHang` | `while(1);` — every unused cell points here |
| `0x0040C370` | `CameraUpdateTick` | calls `g_camera_update_hook` each frame |
| `0x0040C340` | `CameraClearHookAndPose` | |
| `0x0040C9C0` | `CameraFollowPlayerMidpoint` | state (1,1) |
| `0x0040C380` | `CameraFromViewAngles` | state (1,3) |
| `0x0040C430` | `CameraSnapToPathEye` | state (2,4) |
| `0x0040C4C0` | `CameraPathWithImpulseShake` | state (2,5) |
| `0x0040C770` | `CameraStepDeferredRailWithFrameExport` | state (2,6) |
| `0x0040C8A0` | `CameraPlayStashedPath` | state (2,7) |

| Table | Entries | Contents |
|---|---|---|
| `0x00576C14` | 6 × 9 | scene state machine; unused cells are a hang loop |
| `0x005776EC` | 7 (4 null) | scripted-action index table, grouped by operand count |
| `0x005776C4` / `0x5776DC` / `0x5776E4` / `0x5776E8` | 6 / 2 / 1 / 1 | the sub-tables, laid out before the index |
| `0x004C479C` | 418 bytes | global cam path index → cam file id, one run per file |
| `0x00576C14` | 2-D | scene state machine, 9 columns |
| `0x00576CF0` | 0x18 each | camera presets for selector `0x20` |

### Lookup tables used by the translation

| Address | Entries | Contents | Meaning |
|---|---|---|---|
| `0x00598AB0` | 8 | `1,2,9,10,5,6,7,8` | `SRCBLEND` |
| `0x00598AD0` | 8 | `1,2,3,4,5,6,7,8` | `DESTBLEND` |
| `0x00598AF0` | 4 | `1,2,3,2` | texture address: `WRAP, MIRROR, CLAMP, MIRROR` |
| `0x00598B00` | 8 | `1,7,3,5,4,6,2,8` | `ZFUNC` |
| `0x00598B20` | 4 | `1,1,3,2` | `CULLMODE`: `NONE, NONE, CCW, CW` |
| `0x0057A280` | 4 + `-1` | `0x17A0, 0x17A1, 0x18A3, 0x18A5` | `g_model_fixup_slot_list` — the only slots that get the two model patches |

### Globals

| Address | Name | Notes |
|---|---|---|
| `0x009CA08C` | `g_game_mode` | mode-select index; **1 = Original Mode** |
| `0x007E7994` | `g_matrix_mode` | 3 = PROJECTION, 1 = WORLD |
| `0x007E7948` | `g_projection_matrix_cache` | the installed projection |
| `0x00571210` | `g_identity_matrix` | |
| `0x009A2D70` | `g_projection_distance_px` | 640.21 = 240/tan(fovY/2) |
| `0x009C7300` / `0x009C7304` | `g_screen_offset_x` / `_y` | both 0 |
| `0x009A2D78` | `g_active_cam_path` | global cam path index |
| `0x009A6184` | `g_evt_action_operands` | 8-dword scratch for a queued action |
| `0x009C71E0`…`0x009C71F4` | `g_camera_eye_x/y/z`, `g_camera_pitch/yaw/roll_bams` | the resolved camera pose |
| `0x009C7080` | `g_camera_update_hook` | installed by a scene state cell |
| `0x009C6F0C` / `0x009C6F14` | `g_scene_state_major` / `_minor` | |
| `0x009C8E58` / `0x009C70F4` | `g_camera_fixed_eye_y` / `g_camera_use_fixed_y` | written by evt opcodes `0x1A` and `0x36` |
| `0x009C70AC` / `0x009C70B0` | `g_stashed_path_frame` / `_end_frame` | stashed by `queue_event 0x40` with `flags & 2` |
| `0x009A2224` | current region id | written by evt opcode `0x29` |
| `0x009A1A08` | current scene id | |
| `0x007E7990` | `g_matrix_stack_top` | 16 dwords per level |
| `0x007DEB74` | `IDirect3DDevice7 *` | |
| `0x00576A8C` / `0x00576ABC` | mode-1 region / id table pointers | |

## Direct3D 7 interface

Device object at `0x007DEB74`. Vtable offsets, confirmed against the DX7 SDK
`IDirect3DDevice7` declaration order:

| Offset | Method |
|---|---|
| `+0x2C` | `SetTransform` |
| `+0x40` | `SetMaterial` |
| `+0x48` | `SetLight` |
| `+0x50` | `SetRenderState` |
| `+0x64` | `DrawPrimitive` |
| `+0x84` | `ComputeSphereVisibility` |
| `+0x94` | `SetTextureStageState` |
| `+0xB0` | `LightEnable` |

`SetTextureStageState` has exactly **three** call sites in the binary
(`InitD3DDeviceAndTextureStages`, `TranslatePvr2StateToD3D`,
`DrawSpriteQuadCommand`) and between them they touch only `COLOROP`,
`COLORARG1/2`, `ALPHAOP`, `ALPHAARG1/2`, `ADDRESSU`, `ADDRESSV`, `MAGFILTER`,
`MINFILTER` and `MIPFILTER`. `TEXCOORDINDEX` and `TEXTURETRANSFORMFLAGS` are
never set — which is what proves the port implements no environment mapping.

GUIDs present in `.rdata` (checked against the SDK's `DEFINE_GUID` list):
`IID_IDirectDraw7`, `IID_IDirect3D7`, `IID_IDirect3DHALDevice`,
`IID_IDirect3DTnLHalDevice`, `IID_IDirect3DRGBDevice`,
`IID_IDirect3DRefDevice`, `IID_IDirect3DNullDevice`.

`IID_IDirect3DDevice7` is **not** present — normal DX7 usage, since the device
is obtained by passing a device-*type* GUID to `CreateDevice`.

## Diagnostic strings worth pivoting on

`CD3duContext::Resize`, `CD3duContext::_CreateZBuffer`,
`CD3duGlobals::FindBestMatchForHWLevel`, `CHelInfo::Initialize`,
`CHelInfo::GenerateSurfaceFormatList`, `D3DXInitialize`, `D3DXGetDeviceDescription`,
`_ChooseZBuffer`, `Texture Skipped.`

All except `Texture Skipped.` belong to the stock DX7 SDK utility library and can
be excised. **`Texture Skipped.`** is game code and sits in the texture upload
path — a direct route to the Phase 4/5 oracle.
