# Browser stage player

A web client that renders a HOTD2 stage and lets you step, play and free-roam
through it, driven by the game's own event script — its branching route graph,
its region streaming, its camera paths and its enemy placements.

Plan and rationale: [`../docs/PLAYER_PLAN.md`](../docs/PLAYER_PLAN.md).

---

## Run it

The client does **not** parse `pol/`, `tex/`, `cam/`, `evt/` or `Hod2.exe`.
Python pre-processes; the browser consumes. So there are two steps.

```sh
# 1. build the bundle (once, or whenever hod2lib changes)
python3 tools/export_player.py --game-dir "/path/to/THE HOUSE OF THE DEAD 2" --all

# 2. run the client
cd web
npm install
npm run dev          # http://localhost:5173
```

Add `--original` to step 1 to build the Original Mode (game mode 1) variants
too, which the **Original** checkbox then switches between.

`extract/player/` is served at `/bundle/` by a dev-server middleware
(`vite.config.ts`). It is deliberately *not* in `public/`: it is game-derived
data and must never end up in a build artifact. For a production build, run
`npm run build` and copy the bundle to `dist/bundle/` yourself — the app
fetches `bundle/manifest.json` relative to the page either way.

### Why the bundle step exists

Doing the extraction in the browser would mean ~2500 lines of TypeScript
re-implementing `lz`, `container`, `nl1`, `texbank`, `exetab`, `cam`, `evt` and
the PowerVR2 decoder — a second implementation of every format, free to drift
from the first. Pre-processing costs one command and buys exactly one
implementation of each format, with `dump_stage_script.py` still a valid text
oracle for the JSON the browser eats, because both come out of
`hod2lib.script`.

---

## What is in a bundle

```
extract/player/
  manifest.json                 stages present, tool version, source SHA-256s
  stage2/
    stage2.glb                  geometry, materials and every texture, one file
    stage2.cam.json             Hermite curves keyed by global path slot
    stage2.script.json          the resolved event script and route graph
  stage2_original/              game mode 1, same shape
```

`manifest.json` records the SHA-256 of every source file consumed, so a bundle
built from a different game build is detectable rather than mysteriously
wrong — the same principle as `manifest.csv`. It also carries `format`, and the
client refuses a bundle whose format it does not know rather than rendering
something subtly incorrect.

**Camera paths ship as raw curves, not baked samples.** The client must
evaluate at an arbitrary frame, and must be able to highlight the `start..end`
sub-range that one `queue_event` command covers. A baked `LINEAR` glTF
animation can express neither. Stage 2's `cp_st2.bin` is 127 KB binary and
lands at 379 KB as JSON, which gzips hard.

---

## The three modes

| Mode | Key | What it is |
|---|---|---|
| **Step** | `1` | block → step → instruction. Every op is seekable; a camera move gets a frame slider |
| **Play** | `2` | 60 Hz with a speed control, pausing at every branch point |
| **Free roam** | `3` | orbit and fly, detached from the rail |

Space plays/pauses, `→` and `←` step one instruction.

Free roam drags to look, `WASD` to move, `Q`/`E` for world up and down, shift
to sprint, alt to crawl, and the scroll wheel sets the base speed.

### Free roam draws the whole level

Region visibility is switched off in free roam, deliberately. A region holds
only the handful of models the game draws from one point on the rail, so
outside that point most of the level simply would not be there. The **All
regions** checkbox does the same thing in the other two modes — and makes the
interpenetration legible as a deliberate streaming mechanism rather than an
export bug.

---

## What is faithful, and what is not

This matters more than the feature list. The client is explicit about it, and
so is the event feed.

### Faithful

- **The projection.** 41.100° vertical (`0x1D3B` BAMS), 4:3, near 0.8, far
  8000, from `SetupSceneProjection`. It is a compile-time constant for the
  whole game — there is no zoom and no per-camera FOV — so the only choice
  offered is whether to pillarbox to 4:3 or fill the window.
- **Hermite evaluation.** A transcription of `FUN_004040F0`, including its end
  behaviour: the game's binary search cannot leave the key array, so a time
  outside a curve extrapolates along the end segment rather than clamping.
- **Roll is gated.** `CamEvalPath7` evaluates a `cp_` path's 7th channel only
  while `DAT_009A21B0` is set, which evt opcode `0x35` writes. The curve exists
  in every path; the client honours the gate rather than always applying it.
- **Region streaming.** `region_enter` (`0x29`) switches the resident set;
  `asset_load_slot` / `asset_unload_slot` (`0x50` / `0x51`) stream the props
  that no region lists.
- **Camera commands.** `queue_event` sel `0x40` plays path `slot` from
  `start` to `end`, one frame per tick. `start == end` holds a static pose;
  `start == -1` resumes from the current frame instead of seeking.
- **The route graph**, including every branch point, and `wait_frames` /
  `wait_camera_path_frame`, which are exact frame counts.
- **Spawn descriptors** — position, BAMS yaw, class and hit points are all
  confirmed values, drawn as placed.

### Not faithful, and labelled as such

- **It is a script *walker*, not the event VM.** The real interpreter's
  blocking opcodes gate on live state — enemy counters, camera settling, a
  256-byte flag array written by gameplay — and that gameplay is still being
  decompiled. Re-implementing it here would mean guessing, and a guess dressed
  as an interpreter is worse than an honest walker. So `wait_enemies_present`
  and friends are *simulated* on a per-enemy timer (the **Combat** control:
  instant / 0.5 s / 1 s / 2 s / pass through), and every wait the walker could
  not honour appears in the feed with the condition it *would* have blocked on
  and what happened instead.
- **Enemies are markers, not models.** The class → model mapping is genuinely
  unsolved: the class table at `0x009A2280` holds *handler code addresses*, not
  model ids, so there is nothing to look a model up by yet. Class and hit
  points are printed on the marker; the cone points along the confirmed BAMS
  yaw. The other two orientation words reach the object's other rotation
  fields but their value distributions do not look like angles, so they are
  carried raw and not applied.
- **Branch choice.** Real branching is a player decision made under time
  pressure. The player pauses, offers the valid non-`-1` route targets, and
  runs a 5-second countdown before a **seeded** RNG picks — so an unattended
  playthrough is reproducible.
- **Materials are unlit.** The game bakes its illumination into textures and
  the per-mesh base colour, and level geometry ships with no light sources at
  all, so unlit is the faithful default rather than a shortcut. The scene light
  values the script *does* set — light direction, light RGB, ambient, fog near
  and far — are decoded and shown in the inspector, but not yet applied.
- **Step 0 is inference.** `EvtAdvanceBlockOrRoute` sets the step index to 1 on
  every block change, which is read from the binary; that step 0 is therefore
  the checkpoint entry is a reading, not a finding. The tree labels it as such.
- **Sound is shown, not played.** BGM track ids from `bgm_entry_play` (`0x5F`)
  and SE ids appear in the feed and the HUD.

### Opcodes without a meaning show their operands

An instruction whose semantics are still only "the global it writes" is
rendered with its **raw operand dwords**, never a guessed label. A plausible
wrong name is worse than a hex dword — it would propagate into the reader's
model of the game and be much harder to dislodge later.

---

## Deep links

All player state is URL-addressable. This is a user-facing feature and the hook
a visual-regression harness needs, which is why it was built in from the start:
a test that cannot name a state cannot assert about one.

```
?stage=2&block=3&step=1&op=14      seek to an instruction (replaying to it)
?stage=2&slot=59&frame=170         pose straight off a camera path
?stage=2&all=1&mode=free           whole level, free roam
?stage=2&original=1                Original Mode geometry
?stage=2&seed=7                    seed the branch RNG
?stage=2&block=3&freeze=1          halt the tick loop, render one frame
```

Seeking **replays** from the entry block rather than jumping. It has to: the
region, the streamed slots and the camera at op 14 of block 3 are a function of
every instruction that ran before it, and none of those effects is invertible.
That is also why "previous instruction" replays rather than undoing.

---

## Layout

```
web/
  index.html          page skeleton
  vite.config.ts      dev server + the /bundle/ middleware
  src/
    main.ts           the player: modes, render loop, wiring
    bundle.ts         bundle types and loading
    campath.ts        Hermite evaluation, camera pose, rail polylines
    stagescene.ts     glTF loading, region index, visibility rule
    walker.ts         the script walker and the route graph
    overlays.ts       camera rails, object rails, spawn markers
    freeroam.ts       fly camera
    urlstate.ts       URL <-> player state
    ui.ts             script tree, event feed, HUD, inspector, route minimap
    style.css
```

`npm run check` typechecks without building.

---

## Not built yet

**W6, the Chrome visual-regression harness**, is deferred — `docs/PLAYER_PLAN.md`
says W1–W5 ship without it. When it lands, the policy in
[`../tests/README.md`](../tests/README.md) governs what may be committed: a
screenshot of a stage *is* derived game art, so baselines are compact numeric
signatures — mean luminance over a 16×16 tile grid, plus draw-call count,
visible region id, camera pose and spawn-marker count — and the PNGs stay local
and gitignored. `?freeze=1` and the URL state above are the hooks it needs, and
they are already there.
