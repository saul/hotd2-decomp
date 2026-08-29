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

The `pol\%s` template is **not** referenced directly from code — it is reached
through the table at `0x57A008`. Finding that table's consumer is the first
Phase 1 task, since it is the entry point for the largest asset set.

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
| `0x4C476C` | `edi * 2` | `u16` count, parallel to the `cam` table |
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
| `0x4C40A4` | called on the path buffer immediately before `CreateFileA` — resolve this early |
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

## Decompressor candidates ⚠️ Phase 2

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

## Diagnostic strings worth pivoting on

`CD3duContext::Resize`, `CD3duContext::_CreateZBuffer`,
`CD3duGlobals::FindBestMatchForHWLevel`, `CHelInfo::Initialize`,
`CHelInfo::GenerateSurfaceFormatList`, `D3DXInitialize`, `D3DXGetDeviceDescription`,
`_ChooseZBuffer`, `Texture Skipped.`

All except `Texture Skipped.` belong to the stock DX7 SDK utility library and can
be excised. **`Texture Skipped.`** is game code and sits in the texture upload
path — a direct route to the Phase 4/5 oracle.
