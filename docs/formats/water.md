# Water

Three separate things share the name, and keeping them apart is most of the
answer to "why is the water missing here".

1. **Most of the canal is level geometry.** It is streamed per region like
   every other mesh, and no code displaces it.
2. **The rest is drawn by a task**, class 0x41 type 1: tiles the script loads
   and no region names, drawn every frame and rippled as they are.
3. **The wave field is a height *query*.** The script spawns it; floating
   objects sample it. It never touches either surface.

---

## 1. Most of the surface is geometry

`g_water_level` — the one global that sounds like a water plane — is written
by the class-0x51 water enemy's own init (`FUN_00438640`) and read only by
that enemy's eighteen call sites. It is the height that thing bobs at, not a
surface.

**This section used to open "There is no water renderer. Nothing in the
engine draws a water plane."** That was a negative result, and it was wrong:
see §2. What is true is that most of the visible water is ordinary meshes at
the plane height, tagged in the collision data. `coli<scene+1>.bin` marks them with surfaces 5 and 55
(`WET_SURFACES`), and they agree with the script:

| Stage | Wet quads | Plane y | Footprint |
|---|---|---|---|
| 2 (`coli2`) | 18 | **−25.0** | x −1470..24, z −2407..−1238 |
| 3 (`coli3`) | 259 | **−25.0** | x −1293..47, z −3607..−2406 |
| 4 (`coli4`) | 3 | −125.7 | — |

Stage 2's script sets its wave-field plane to **−25.5 / −25.0**, matching the
collision plane exactly — two independent tables agreeing on the same number.
The two stages' footprints also abut at z ≈ −2406: one canal running through
both.

### Why it comes and goes

In stage 2 the surface is **twelve separate model entries across five `pol/`
files** — `st2_07` entries 1, 2, 3, 4, 5, 8, 9, 11, 13; `st2_09` entry 0;
`st2_13` entry 3; `st2_14` entry 0 — and each is named by only a handful of
regions. Entry 3 is named by exactly **one** region.

That is not a bug, it is the streaming model. `RegionDrawResidentSet`
(`0x00401260`) walks **only the current region's** slot list, frustum-culls
each entry and draws it; nothing else is ever drawn. So water is present in 27
of stage 2's 58 non-empty regions and absent from the other 31, and the browser
player reproduces that rule exactly.

**If water looks missing where it should not be, check two things**: which
region the walker is in — the tile that covers a given stretch of canal is only
drawn in the regions that name it — and whether a class-0x41 type-1 task
should be drawing it (§2). Stage 2's block 16 was the second.

`RegionDrawResidentSet`'s loop tail (`0x00401443..0x0040145F`, the next index
and the branch back to `0x0040129B`) lies outside Ghidra's function body, so
its decompile shows one entry and no loop `[proved]`; the disassembly is the
reading.

## 2. The water a task draws — class `0x41` type 1

`PlaceWaterSurface` (`FUN_00462F70`) is `g_class41_constructors[1]`. It
allocates a 0x44-byte task running `WaterSurfaceUpdate` (`FUN_0046E3A0`) and
fills its tail from the placer `[proved]`:

```
+0x34 u8    index      (u8)placer+0x1F4, i.e. desc+0x24
+0x35 u8    lifetime   (u8)placer+0x11C, changes of g_evt_step_index
+0x36 u8    last step  (u8)g_evt_step_index
+0x37 u8    changes    0
+0x38 u8    kill flag  index + 0x0B, only when g_scene_index == 2 (stage 3)
+0x40 s32   slot       g_water_surface_slots[(s16)placer+0x1F4]
```

`g_water_surface_slots` (`0x00593DA4`) is ten `s16`, ending where
`g_prop_kind_params` (`0x00593DB8`) begins:

| index | slot | tile | spawns |
|---|---|---|---|
| 0 | `0x13A7` | `komono_boss2[0]`, the stage-2 boss arena | stage 2 |
| 1 | `0x13A0` | `st2_07[0]`, blocks 37/41 | stage 2 |
| 2 | `0x13B5` | `st2_07[3]`, block 16's canal | stage 2 |
| 3 | `0x13B7` | `komono_venis[4]` | stage 2, training |
| 4–7 | `0x13AD`, `0x13AE`, `0x13B0`, `0x13B2` | `st1_1[9/10/12/14]` | stage 3, training |
| 8 | `0x183C` | `st1_1[34]` (at y −15) | stage 3 |
| 9 | `0x13A4` | `komono_venis[3]` | stage 2 |

Fifteen spawns: five in stage 2, seven in stage 3, three in training, every
one at the origin with no angle. The script loads each tile (opcode 0x50 or
`asset_load_polfile`) just before placing its task; loading alone draws
nothing.

Each frame the task `[proved]`:

* **despawns** when stage 2's `g_script_flags[0x77]` is up, or when it has
  seen more than `+0x35` step changes; and outside Boss mode **is killed** by
  `flags[+0x38] == 1` or `flags[4]` on stage 3, block 0x23 step 2 on stage 2,
  or step 0xF when its slot is `0x13B5`;
* **ripples** the tile, when it is resident (slot table `+0xD` bit 0x80) and
  none of these holds: slot `0x13A7` without flag 8, slot `0x13A0` off camera
  path 0x6E, flag 0x6A, camera path 0x7E at frame 0x163, Training without
  flag 0xF1 or with 0xF2. The ripple walks the slot's model in place: every
  mesh header's TSP `|= 0x2000` (filter mode 1, bilinear), and every full
  vertex (bit 0 of x set)

  ```c
  u += sin(((tick * 0x180 + ftol(x) * 600) & 0xFFFF) * 2pi/65536) * 0.00075;
  v  = (float)(v + cos(((tick * 0x180 + ftol(z) * 600) & 0xFFFF) * ...) * 0.00075) | 1;
  ```

  with index 0 skipping every vertex above `z = -1870`
  (`g_water_surface_z_limit`, `0x00569110`). `tick` is
  `g_scene_tick_counter`; `0.00075` is `g_water_surface_uv_step`
  (`0x00569108`, f64). The sum over frames is bounded — about ±0.02 of a
  texture repeat — so the texture sways rather than drifts;
* **draws** its slot, `0x13A5` beside `0x13A7`, and `0x13AC` beside `0x13A9`,
  at no matrix of its own: the tiles are authored in world space;
* then, on flag 9, swaps `0x13A7 -> 0x13A9` and `0x13A0 -> 0x13A2`, and on
  camera path 0x6E turns `0x13A2` back to `0x13A0` — reading the slot the
  swap may just have written.

The code at `0x004086F5` that draws `0x1A78 + n` is `water.bin`'s fifty-frame
splash, not a surface; `water.bin` holds effects only `[proved]` (its 63
models are droplets, splash sheets and that strip).

## 3. The wave field — classes `0x16` and `0x17`

`WaterFieldCreate` (class `0x16`) allocates a 0x2C-byte manager and takes the
plane height from the spawn descriptor's **y** alone; x and z are ignored, so
this is a global plane, not a placed object.

```
+0x00 u32   active source count
+0x04 u32   slot occupancy mask
+0x08 f32   plane y
+0x0C ..    void *sources[8]
```

`WaterWaveSourceAdd` (class `0x17`) claims one of the eight slots. The spawn's
position becomes the source's position, its **three orientation words** become
the source's parameters, and `obj+0x11C` picks the kind from
`g_wave_source_kinds`. `{amplitude, wavelength, speed}` come from the
descriptor tail on the source's first tick.

### The two kinds

**Travelling** (`WaveEvalTravelling`). The source's `x` is a phase
accumulator, advanced by `speed` every frame:

```c
phase = (fabs(cos(yaw)) > 0.5 ? cos(yaw) * p.z : sin(yaw) * p.x) + src.phase;
height = cos(2*pi * phase / wavelength) * amplitude;
```

The engine writes that as `(int)(phase * 65536 / wavelength)` fed to a BAMS
cosine, which is the same sinusoid truncated to BAMS resolution. The
`|cos| > 0.5` test picks whichever axis the wave mostly runs along — an
axis-aligned approximation rather than a true projection.

**Circular** (`WaveEvalCircular`). No phase term; the source itself walks along
its yaw at `speed`.

```c
r = hypot(p.x - src.x, p.z - src.z);
height = cos(2*pi * r / wavelength) * amplitude * max(0, 1 - r * 0.01);
```

so a ripple dies at exactly **100 units**.

`WaterFieldSampleHeight` (`FUN_00442390`) sums every active source at a point.

### What samples it

Eleven call sites, and **none of them is a renderer**: four in the floating-prop
row (class `0x15`, `FloatingPropRowSpawn`) and seven in the prop block at
`0x0047xxxx`. It is a query — "how high is the water here" — for things that
float. No surface vertex moves: the ripple in §2 moves texture coordinates,
and reads nothing of the field.

Stage 2 is the only stage that spawns a field at all: two of them (planes
−25.5 and −25.0), two wave sources, and two floating-prop rows. Stage 3 has
sixteen water enemies and **no field**, so its water is geometry, its seven
type-1 tiles, and the enemy's own `g_water_level`.

## What the player does

Draws the region geometry with the same region rule as the game, and runs the
type-1 task (`game/class41/water.ts`, drawn by `render/water_surfaces.ts`):
the ripple, the bilinear switch, the pairs and swaps. The wave field is ported
too (`game/class16/`, `game/class17/`) for the stage-2 boss that samples it;
the floating-prop rows are not. See `docs/PLAYER_PROGRESS.md`, *The canal is
drawn by a task*.
