# Object rigs: survey of the 31 `CamEvalObjectPath6` callers

An object that follows an `op_` path is almost never one model. Its draw
routine walks the matrix stack, pushing a transform and calling
`AssetDrawSlot` per part. **There is no rig data in the asset files** — the
hierarchy exists only as instructions, so every rig has to be transcribed by
hand. See `tools/hod2lib/rigs.py` for the transcriptions and the proof that
this is not a parser problem.

`CamEvalObjectPath6` (`0x004042D0`) has 31 callers. They split by whether they
also call `AssetDrawSlot`:

* **9 draw as well as evaluate** — self-contained rigs.
* **22 evaluate but never draw** — they *position* an object that some other
  routine draws. The drawer is normally the object's `obj[0]` think pointer.

## The trap in that split

The split is a useful filter but **not** a definition of "rig". The stage-2
opening vehicle is a counter-example: its poser `FUN_004521B0` evaluates the
path and never draws, while its rig lives in `FUN_00452320`. Reading only the
9 direct drawers misses it entirely. When looking for a rig, follow the poser
to its `obj[0]`.

## How a rig is bound to a stage

Routines dispatch on `g_active_cam_path` (`0x009A2D78`) through a jump table
and select a different `op_` slot per camera shot. **[proved]** those camera
ids and the object-path slots live in the same 418-slot global space: of the
ids recovered so far, all 28 used as gates resolve to `cp_` files and all 21
used as routes resolve to `op_` files, and each gate sits in the same stage
file as the route it selects.

That gives the per-stage gate the exporter uses: **a stage owns a rig iff it
owns the camera path that selects it.** `tools/verify_objects.py` enforces
both halves plus the same-stage-file rule, because a cross-stage gate could
never fire.

## Shared idioms

| Idiom | Meaning |
|---|---|
| `byte [0x009C72E0] == 1` → `0x004A7040` | `ActorKill` — unlink and `longjmp`. Does not return, draws nothing. |
| `min(g_frame, [0x00576D38 + slot*4])` | path frame, clamped to the end of the path |
| `MatrixStackPush(0)` … `MatrixStackPop(1)` | duplicates the top, so parts are **siblings** by default |
| a push held open across several parts | a genuine parent/child chain — the inner parts are children |
| two consecutive `MatrixTranslate` | compose by **addition** into one offset |
| `0x0041EBB0` | a `RET` stub: the engine's uniform-scale hint, does nothing in this build |
| `0x004185E0` vs `AssetDrawSlot` | a **lighting** variant of the same slot, not a transform variant |
| `Translate(p.x, p.y + k, p.z)` before the rotations | a pose **bias**: `T(p+b).R`, which a child node cannot express |

## Transcribed (9)

| routine | rig | routes | notes |
|---|---|---|---|
| `0x0048E600` | `st1_vehicle` | `0xFD`–`0xFF` | stage-1 opening vehicle, 11 parts |
| `0x0048EAD0` | `obj_48ead0` | `0x156`–`0x15D`, `0x199` | [likely] a speedboat — renders as one, with an outboard motor. `+2.0` Y pose bias. |
| `0x0048F050` | `obj_48f050` | `0x173`, `0x174` | one part |
| `0x0048F190` | `obj_48f190` | `0x17A`–`0x17D` | [likely] a convertible car — renders as one. 8 parts, nesting depth 2. |
| `0x0048F560` | `obj_48f560` | `0x182` | two 2-digit readouts on opposite faces, counting 36→50 |
| `0x00484FF0` | `obj_484ff0_props` | — | world space; **not placed**, see below |
| `0x00470B70` | `obj_470b70` | `0x179` | actor state 412 |
| `0x00470080` | `obj_470080` | `0x196`–`0x198` | actor state 406; slot is runtime, nothing to place |
| `0x00416B00` | `obj_416b00` | `0x194` | [likely] per-shot gunfire effects; a 6-record ring, all runtime |

### Why `obj_484ff0_props` is not placed

Its prop is chosen by `*(int16*)(*(int*)(obj+0x1390) + 6)`, and `obj+0x1390`
does **not** point at the evt spawn descriptor: reading `+6` there (the high
half of `init_flags`) gives `0` for all 142 class-`0x25` descriptors across all
six stages, and variant `0` draws nothing. Gating by stage bounding box was
tried and rejected — levels span thousands of units, so the box accepts the
props in every stage. Six wrong placements are worse than none. `[open]`: what
record `obj+0x1390` actually points at.

## The 22 positioners

Every slot below is a literal verified in the disassembly (`68 xx xx xx xx`)
unless the source column says otherwise.

| routine | path slot(s) | source | drawn by | rig? |
|---|---|---|---|---|
| `0x00415BD0` | `0xFD`/`0xFE` | branch on cam `0x20`/`0x21` | per-part cb `FUN_00416570` | **yes** |
| `0x00424190` | `0x162`–`0x171` | `{slot,tStart,tEnd}` table at `0x00588F54` (1P) / `0x00588F84` (2P) | — | not a poser: bakes a position polyline into parent `+0x5A8` |
| `0x00426A70` | `0x185` | literal, `g_GameMode == 3` | `FUN_00428F70` → `FUN_00411090` | no — class `0x2D` |
| `0x00429530` | `0x188`–`0x18F` | `obj+0x1350 + 0x188` | same object as above | no |
| `0x0042C490` | `0x192`/`0x193` | `obj+0x1350 = rand() & 1` | `FUN_0042C5A0` | no |
| `0x00432610` | `0x145`,`0x146`,`0x149`,`0x14A` | table `0x00589AE0` | `0x00432840` | **yes** — 3 slots |
| `0x00433860` | spawn param | `spawnParams[3]` | `SUB_004331D0` | **yes** — 9 slots, the largest found |
| `0x00440130` | `0x151`,`0x15E`–`0x161`,`0x175`–`0x177` | pure setter; callers pass literals | each caller draws | small |
| `0x0044E5D0` | `0x14F` | literal | `FUN_00449EF0` | no — class `0x31` |
| `0x00451E50` / `0x00451EB0` | `0x148`,`0x14D`,`0x14E`,`0x19A`–`0x1A1` | table `0x00565EF4` | `FUN_00451FF0` | no — near-identical pair |
| `0x004521B0` | `0x148`/`0x14E`/`0x14D` | cam `0x38`/`0x39`/`0x3A` = cp_st2 1/2/3 | `FUN_00452320` | **yes** — 4 slots, table `0x00565F2C` stride `0x10` |
| `0x004522A0` | `0x153` | literal | `FUN_00452320` | **yes** (same rig) |
| `0x004525C0` | `0x00565EF4[obj+0x4D4]` | table | `FUN_00451FF0` | no |
| `0x00452930` | same table | table | `FUN_00452320` | **yes** (same rig) |
| `0x004659D0` / `0x00465BC0` | `0xFD`/`0xFE`/`0xFF` | literals | **nothing** | n/a — a 0x88-byte invisible controller that uses the path only to derive a texture/material scroll rate |
| `0x0047F5F0` | `0x180` | literal, `g_GameMode == 3` | `FUN_0047FE40` | no — class `0x32` |
| `0x00480050` | `0x180` | state 0 of `0x00596738` | same object | no |
| `0x004842A0` | `0x156`–`0x15C` | script opcode `0x0B` → `obj+0x135C` | `FUN_00484FF0` | small — class `0x25` |
| `0x0049DB40` | `0x103` | pure setter | `FUN_0049D770` | no — class `0x22`; body identical to `0x00440130` |
| `0x0049DBE0` | `0x140`–`0x143` | `0x140 + word[0x00570E24][idx]` | same object | no |

### Notes on the survey

* **Latent bug in `0x004521B0`** `[proved]`: if `g_active_cam_path` is not
  `0x38`/`0x39`/`0x3A`, `ECX` still holds the *object pointer* and is
  sign-extended as the slot id. Unreachable only because the object spawns
  solely on those three paths. `0x0048F560` has the same shape of bug in its
  digit dispatch.
* **Don't transcribe twice**: `0x00440130` ≡ `0x0049DB40`;
  `0x0042C490` ≈ `0x0049DBE0`; `0x00451E50` ≈ `0x00451EB0`.
* `0x00429530` also calls `CamEvalPath7(0xDF)`. `0xDF` is a *camera* path, but
  it goes to the camera evaluator, not `CamEvalObjectPath6` — not an anomaly.
* Every object-path slot lands inside an `op_*` range: op_st1 253–255 / 259 /
  320–323; op_st2 325–339; op_st3 342–369; op_st4 373–375; op_st5 384;
  op_st6 389–403; op_train 410–417.

## Ghidra hazards hit while doing this

* The decompiler **silently drops FPU arguments** to the matrix calls. Every
  constant in `rigs.py` was re-read from raw bytes with `disassemble_bytes`,
  and the raw hex is kept in each part's `note`.
* `CamEvalObjectPath6` writes `{float x,y,z; int rx,ry,rz}` — elements 3–5 are
  `__ftol` results, BAMS integers in float-typed slots. Ghidra shows all six as
  `float`. It is wrong.
* On `0x0048F560` the decompiler renders a jump table as an indirect call and
  leaves `0x48F796`–`0x48F80F` undisassembled. Those tables were recovered by
  hand from `0x0048F918`.
