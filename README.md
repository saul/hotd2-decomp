# hotd2-decomp

Reverse-engineering **The House of the Dead 2** (Windows PC port, 2001) — its
asset formats, its render pipeline and the gameplay code that drives them — and
a browser player that plays its stages from what has been recovered.

Two halves, and each is the other's check:

* **The decomp.** `ghidra/` holds every recovered symbol as TSV and a headless
  driver that replays them onto a fresh database; `docs/formats/` specifies
  every on-disk format and `docs/re/` the subsystems read out of the exe.
  Workflow: the **`/decomp`** skill.
* **The player.** `web/` renders a stage and runs its gameplay as a
  *transcription* of the exe — one TypeScript function per exe function, under
  the name Ghidra gives it, with the address in the doc comment.
  `web/src/hod2lib/` reads every game format and writes the bundle the player
  loads, from the command line or inside the page. Workflow: the
  **`/gameplay-port`** skill.

A misread table is an argument; a misread table that walks a zombie through a
wall is a bug report. The player is what stops the decomp from being a story
about the binary.

## Where it stands

**Every format the game ships is parsed**: compression, containers, NaomiLib
models, PowerVR2 textures, camera paths, event scripts, collision, motion and
sound.

**All six stages play in the browser**, in Arcade and Original Mode, from the
game's own event script — its branching route graph, region streaming, camera
paths and enemy placements. The enemy state machines, damage and gore,
scoring, the shot test, the camera director, the HUD, continues and the result
card are transcribed from the routines that implement them. Two players can
play over WebRTC.

**It is not finished, and how it is unfinished is counted**: coverage of the
gameplay address ranges, the spawn classes with a module, every declared
`[diverges]` and every `[open]` are printed by `npm run status` (in `web/`),
measured from the tree. No document quotes those numbers.

This is **not** a byte-matching decompilation of `Hod2.exe`. It is a
documented reimplementation: every format specified, the PowerVR2 → Direct3D 7
material translation recovered exactly, and the gameplay transcribed.

## Getting started

You supply your own copy of the game — see [Legal](#legal). Everything runs on
**Node 20+** from `web/`; the Ghidra database needs **Ghidra 12.1.3**.

```sh
cd web
npm install
npm run export -- --game-dir "/path/to/THE HOUSE OF THE DEAD 2" --all
npm run dev                                   # http://localhost:5173
```

`--all` builds all six stages in both game modes (`--stage N` for one,
`--arcade` or `--original` for one mode). The export prints what it could not
read at the end, including when that is nothing.

**Or let the page build it.** Open the player with no bundle and it offers to
build one from your install: choose the folder that holds `Hod2.exe` and it
builds every stage in a worker, into a cache that survives a reload and
downloads as a zip. It is the same library either way. A bundle built only in
the browser has no sound unless a server supplies it, because sounds are
fetched from the server that names the install.

`npm run dev -- --host` serves the LAN, so a phone can play; HTTPS, offline
play and publishing a site are in [`docs/PLAYER.md`](docs/PLAYER.md#hosting).

## Playing

The page is the game. A stage opens under a **Start** button — the press a
browser wants before it plays sound, goes fullscreen or hands over a phone's
motion sensors. **`≡`** (top left) holds the game while it is open and has the
stage, its entry block, Original Mode, restart, the game's own options screen,
two players, the bundle screen and the debug sidebar.

| Key | Does |
|---|---|
| click | shoot |
| right-click, `R` | reload (a pull off the screen) -- also the pad's B, which cuts a stage's chapter card short once it has shown for a third of a second |
| `Enter` | START: take a continue, skip a cutscene where the game allows it, start a new game |
| `Space` | play / pause |
| `←` | rewind half a second (on the options screen, the arrows are the pad) |
| `M`, `F` | mute, fullscreen |
| `` ` `` | the debug sidebar |
| `1`, `2` | play, free roam |
| `?` | every key, including the overlays below |

Overlays, each toggled without opening the sidebar: `B` actor boxes, `C`
collision, `G` all regions, `V` rails, `L` look-at, `N` spawns, `P` prop
boxes, `U` unported classes, `X` wedged actors, `O` the perf meter, `K` frame
rate, `I` netplay. In free roam, click to capture the pointer, `WASD` to move,
`Q`/`E` down and up, `Shift` faster, `Alt` slower, the wheel for speed.

**The debug sidebar** has play/free roam, pause, skip and kill, then three
tabs: **Inspect** (player, wait, camera, scene — the 4:3 frame, resolution,
light, fog, filtering — actors, props, collision, route, two players,
shooting, sound), **Script** (click an instruction to seek to it; an opcode
whose meaning is unread shows its raw operands, never a guessed name) and
**Feed**.

**The corner button** is player 1's START and says what START would do:
**Skip** inside a skippable region, **Continue** with the countdown's digit,
**Join** for a second player.

**On a phone**, hold it sideways; the frame is boxed to the game's 4:3. A tap
is a shot. To reload, flick the phone sharply, tap with a second finger while
the first is down, or tap the bar beside the frame — all three are a pull off
the screen, which is how the arcade gun reloads. The flick needs HTTPS (iOS
asks permission at Start). A phone cannot build a bundle; serve it one.

### Deep links

All player state is in the URL, so a bug report is a link. Seeking **replays**
from the entry block rather than jumping, because the region, the streamed
slots and the camera at an instruction are a function of everything that ran
before it.

| Parameter | Means |
|---|---|
| `stage=N` | the stage, 1–6 |
| `original=1` | Original Mode |
| `mode=play` / `mode=free` | play, or free roam |
| `entry=N` | the entry block, for stages with more than one |
| `block=B&step=S&op=O` | seek to an instruction |
| `slot=N&frame=F` | pose straight off a camera path |
| `all=1` | draw every region |
| `seed=N` | the RNG seed (default 1) |
| `freeze=1` | halt the tick loop and render one frame |
| `drive=1` | hand the clock to a harness (`web/tools/lib/player.mjs`) |
| `perf=1`, `gpu=1`, `fps=1` | the perf meter, a sampled GPU wait, the frame-rate badge |
| `aa=0`, `shadows=0`, `blur=0`, `rain=0`, `thin=1` | A/B switches for the costliest effects |
| `sw=0` | remove the service worker and its cache |
| `net=host`, `#join=CODE`, `matchmaker=`, `relay`, `netsim=` | netplay ([`docs/PLAYER.md`](docs/PLAYER.md#netplay)) |

For example `?stage=2&mode=play&block=3&step=1&op=14`, or
`?stage=2&slot=59&frame=170` to pose on a camera path.

## Checking it

```sh
cd web
npm run verify -- --game-dir "/path/to/THE HOUSE OF THE DEAD 2"
npm run verify -- --quick         # the inner loop
npm run verify -- --list          # what each check sees
npm run status                    # every count: coverage, divergences, ratchets
```

`web/tools/verify_all.ts` is the one list of checks. It reports pass, fail and
**skip** separately: a check that asserted nothing exits 3 and is never
counted as green. Checks that need an exported bundle or the installed game
skip without them and say so. The checks that read the game live in
`web/tools/checks/` and read it through the same library the exporter runs.

## The decomp

```sh
./ghidra/run.sh rebuild            # a fresh, fully annotated database
./ghidra/run.sh export-annotations # the live database back into the TSVs
cd web && npm run annotate -- ... # add or rename a symbol by hand
```

`rebuild` imports `Hod2.exe` and replays every committed annotation onto a new
project. `GHIDRA_HOME` defaults to `~/ghidra_12.1.3_PUBLIC`; the database
itself is never committed, only the TSVs that rebuild it.

Every claim about the binary is marked **`[proved]`** (the code was read),
**`[likely]`** (inference, with the evidence stated) or **`[open]`**
(undetermined). `[open]` is a useful answer and a guess is not, and nothing is
named for where it sits or what it resembles. Where the player knowingly
departs from the exe it says so with a greppable `[diverges]` and a reason.

## Where everything is written down

| Read this | For |
|---|---|
| `npm run status` | **every number** — coverage, divergences, ratchets — measured from the tree when you ask |
| [`docs/LESSONS.md`](docs/LESSONS.md) | **the traps this project has already paid for**, cited by id. Read before your first edit |
| [`docs/PLAYER.md`](docs/PLAYER.md) | the player's shape: layers, porting rules, save state, the bundle, netplay, hosting, checks |
| [`docs/formats/`](docs/formats/) | byte-exact specifications, one per format, and the bundle |
| [`docs/re/`](docs/re/) | subsystems and bosses read out of the exe; [`addresses.md`](docs/re/addresses.md) is the map; [`method.md`](docs/re/method.md) is how |
| `ghidra/annotations/*.tsv` | **the names** — the source of truth for both halves, sorted by address |
| [`CLAUDE.md`](CLAUDE.md) | the checked rules, and how to commit alongside concurrent workstreams |

## Layout

```
docs/           LESSONS, PLAYER
docs/formats/   byte-exact format specs
docs/re/        what was read out of the exe, by subsystem
ghidra/         headless driver + GhidraScripts; annotations/ holds every
                recovered symbol as TSV
web/            the player: src/ (see docs/PLAYER.md), test/, and tools/ --
                the export and deploy, the check runner (verify_all.ts),
                repo/ (the source checks), checks/ (checks against the game
                and the bundle), gen/ (the bundle digests), the harnesses,
                annotate.ts, baseline.ts, status.ts
matchmaker/     netplay's room server: Node, and a Cloudflare Worker
r2site/         the Worker that serves a published site
extract/        gitignored scratch; extract/player/ is the bundle
manifest.csv    SHA-256 of every file in a known-good install (baseline.ts)
```

## What the game is

The PC release is a direct port of the NAOMI / Dreamcast build. It ships native
PowerVR2 data — NaomiLib models, twiddled and VQ textures, and event tables
still full of absolute Dreamcast SH-4 RAM pointers — and translates it to
Direct3D 7 at runtime. That translation layer is the Rosetta stone: because
the port had to convert every PowerVR2 ISP/TSP word into a D3D7 render state,
the binary contains the complete mapping, and material behaviour is recovered
exactly rather than inferred.

| Component | Detail |
|---|---|
| `Hod2.exe` | PE32 i386, MSVC 6.0, linked 2001-05-09, imagebase `0x400000` |
| `.text` | `0xC2520` (~795 KB) |
| Renderer | Direct3D 7 via `DirectDrawCreateEx` + QI, on the DX7 SDK `d3du`/D3DX utility library |
| Input | DirectInput 7, plus `SEGAJOY.VXD` for arcade gun hardware |
| Audio | DirectSound; music, sound effects and voice ship as `.wav` |

The camera is a compile-time **41.1° vertical FOV**, 4:3, near 0.8, far 8000,
from `SetupSceneProjection`. There is no zoom and no per-camera field of view.

## Legal

No game assets are included or redistributed here, and none ever may be:
`.gitignore` blocks every asset type, and a screenshot of a stage is derived
game art. You must supply your own copy of the game. `manifest.csv` records
SHA-256 hashes so tooling can be validated against a known-good input set; it
contains no asset content.
