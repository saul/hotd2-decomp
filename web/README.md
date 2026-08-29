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

Space plays/pauses, `→` and `←` step one instruction, `1`/`2`/`3` switch mode,
`Enter` skips a cutscene.

**Skip** lights up inside a `set_skippable_region` once the shutter's firing
gate is down — exactly the condition under which the game polls Start for a
skip. Pressing it releases `wait_queued_events_done`, `wait_camera_path_frame`
and `wait_frames` until the region closes, and `resume_bgm_if_skipped` then
restarts the interrupted track. All of that is the game's own code; the retail
build simply never raises the flag, because the Start poll writes a global that
nothing reads. The button supplies that one assignment.

The script panel is deliberately narrow — the viewport is the point of the
tool and the tree is a navigator, not the content. Drag the splitter to widen
it, double-click the splitter to reset, or focus it and use the arrow keys.
The width is remembered per browser.

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
- **Block, step and route flow**, transcribed from `EvtAdvanceBlockOrRoute`.
  Three things there are easy to get wrong and were all wrong here first:
  a block's steps run **in sequence** (`end_block` advances to the next step,
  and only an exhausted step table reaches the route table); route kind 2 is
  **not** "the scene ends" but a fall-through to `block + 1`; and a branch
  takes `next[branch_choice]`, where `branch_choice` resets to 0 on every
  block change. Getting the first of those wrong skips most of a stage,
  including the `region_enter` and `cam_play` instructions in the later steps.
- **Deferred camera plays.** `cam_play` with `flags & 2` does not play — it
  stashes the frame range, and a later `queue_event 0x21, 6|7` enters the
  scene state whose camera hook steps it. All 208 in the game follow that
  idiom. Selector `0x21` is a camera *state selector*, not "hand control back
  from a path", which is what an earlier reading of it claimed.
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
- **Object rigs.** The things that ride `op_` paths are assembled in code, not
  data — `hod2lib.rigs` transcribes the draw routines. The client evaluates
  the object path itself, so it honours the routines' frame clamp
  (`min(frame, CAM_PATH_LENGTH[slot])`), their position bias (added *before*
  the pose rotations, so a child node cannot express it), and their camera
  gate: a rig is present only while the camera is on a shot that selects it,
  because the routines dispatch on `g_active_cam_path`.
- **The backdrop dome.** Follows the camera in all three axes, offset by the
  preset's `dy`, spun about Y, and scaled `(1.2, 1.2, -1.2)` — the negative Z
  turns it inside out, as the game does.
- **Fog and scene light are ramped, not switched.** Both tween opcodes fill
  `{enabled, from, to, rate}`, and `0x23` pre-divides a frame count into a
  per-frame step. Stage 2 alone runs 247 of them.

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
- **Runtime-driven rig parts are not animated.** `rigs.py` records the rule —
  "RotY by obj+0x1334", "model cycles `DAT_009A32A0 % 12 + 0x8CE`" — rather
  than baking a frame of it, because the globals driving them are gameplay
  state. The parts are drawn in their rest pose and the rule is shown in the
  inspector. One rig, `obj_484ff0_props`, is transcribed but not placed at
  all: what selects its variant is not the spawn descriptor, so there is
  nothing to place it against.
- **Enemies are markers, not models.** The class → model mapping is genuinely
  unsolved: the class table at `0x009A2280` holds *handler code addresses*, not
  model ids, so there is nothing to look a model up by yet. Class and hit
  points are printed on the marker; the cone points along the confirmed BAMS
  yaw. The other two orientation words reach the object's other rotation
  fields but their value distributions do not look like angles, so they are
  carried raw and not applied.
- **Branch choice.** `branch_choice` (`DAT_009C88A4`) is genuinely runtime
  state: every writer in the binary is gameplay code — shooting a door, taking
  a route — and it resets to 0 on every block change. With no gameplay a
  branch would always take `next[0]`, so the player asks instead. A bar along
  the bottom of the rendered view offers the valid route targets, and in Play
  mode a 5-second countdown runs before a **seeded** RNG picks, so an
  unattended playthrough is reproducible — and hovering the bar freezes that
  countdown, because deciding is not a race.

  Routes marked ◉ have an **arcade preview shot**: the `store_six` (`0x60`)
  operands are three `(frame, slot)` camera poses indexed by exactly that
  `branch_choice`, and hovering one poses the camera there. A preview belongs
  to the block that stored it — all four in stage 2 sit inside branch blocks —
  and is discarded on any block change, so a branch never shows a shot left
  over from an earlier one. Unused choices store slot 0 and get no preview.

  The bar is not a modal: a branch is a fact about where playback has got to,
  not a question that blocks everything else, so the script, the scrubber and
  free roam stay usable.
- **Materials are unlit.** The game bakes its illumination into textures and
  the per-mesh base colour, and level geometry ships with no light sources at
  all, so unlit is the faithful default rather than a shortcut. The scene light
  values the script *does* set — light direction, light RGB, ambient, fog near
  and far — are decoded and shown in the inspector, but not yet applied.
- **The `path.y - 15` eye rule is recorded, not applied.** Every camera hook
  that plays a path contains `eye.y = use_fixed_y ? fixed_eye_y : path.y - 15`
  — unambiguously, in three separate functions. Applying it to the `cp_`
  curve's eye Y is nevertheless wrong: measured over all 201 camera paths in
  stages 1–6, it puts **173 of them looking upward at their own aim point**,
  and on stage 2's opening path the eye lands below the floor. The raw value
  also matches the established-good oracle — the exported glTF cameras use it
  unmodified and produce the Venice plaza shot the format work was validated
  against. So something compensates for that line which has not been traced
  yet, and until it is, the measurement wins over the disassembly. The
  reasoning and a switch to re-enable it live in `src/campath.ts`.
  (`0x36`, which selects the fixed-height branch, occurs **zero** times in any
  shipped script, so that half is unreachable from the data regardless.)
- **Step 0 is inference.** `EvtAdvanceBlockOrRoute` sets the step index to 1
  on every block change and `FUN_0045EBC0` picks the scene's first step by game
  mode — 1 for Arcade, 5 for Original Mode on scene 0, 0 only on the continue
  and checkpoint paths. Those are read from the binary. That step 0 is
  *therefore* the checkpoint entry is a reading, not a finding; the tree labels
  it as such.
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
