# Water

Two separate things share the name, and keeping them apart is most of the
answer to "why is the water missing here".

1. **The surface you see is level geometry.** It is streamed per region like
   every other mesh, and no code displaces it.
2. **The wave field is a height *query*.** The script spawns it; floating
   objects sample it. It never touches the surface mesh.

---

## 1. The surface is geometry

There is no water renderer. Nothing in the engine draws a water plane, and
`g_water_level` — the one global that sounds like it should — is written by the
class-0x51 water enemy's own init (`FUN_00438640`) and read only by that
enemy's eighteen call sites. It is the height that thing bobs at, not a
surface.

The visible water is ordinary meshes at the plane height, tagged in the
collision data. `coli<scene+1>.bin` marks them with surfaces 5 and 55
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

**If water looks missing where it should not be, the thing to check is which
region the walker is in**, not the water itself — the tile that covers a given
stretch of canal is only resident in the regions that name it.

## 2. The wave field — classes `0x16` and `0x17`

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
float. The surface mesh is static.

Stage 2 is the only stage that spawns a field at all: two of them (planes
−25.5 and −25.0), two wave sources, and two floating-prop rows. Stage 3 has
sixteen water enemies and **no field**, so its water is purely geometry plus
the enemy's own `g_water_level`.

## What the player does

Draws the geometry, with the same region rule as the game. It does **not**
implement the wave field or floating props, which is `[open]` work rather than
missing water: nothing the field does would change what the surface looks like.
