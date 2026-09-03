# HOTD2 decompilation and browser player

Two halves that must not drift apart:

* **`ghidra/`, `tools/`, `docs/re/`, `docs/formats/`** — reverse-engineering
  The House of the Dead 2 (PC, 2001) and the exporters built on what it finds.
  Workflow: **`/decomp`**.
* **`web/`** — a browser player that renders a stage and runs the gameplay as a
  transcription of the exe. Workflow: **`/gameplay-port`** for anything under
  `web/src/game/`.

Read `docs/PLAN.md` for what is worth doing, `docs/PLAYER_ARCHITECTURE.md`
before changing the player's shape.

## The rules that are checked

Run these before you commit. They are fast and they are the reason the
boundaries still exist.

```sh
python3 tools/verify_layers.py            # player layer boundaries
python3 tools/verify_port.py              # the port matches the annotations
python3 tools/verify_annotations.py --game-dir ~/"THE HOUSE OF THE DEAD 2"
cd web && npx tsc --noEmit && npm run test:port && npm run test:seek \
    && npm run test:scope && npm run test:state && npm run test:ui \
    && npm run test:projection && npm run test:camera && npm run test:pose \
    && npm run test:render && npm run verify:ui
python3 tools/baseline.py --game-dir ~/"THE HOUSE OF THE DEAD 2" --verify
```

`test:seek`, `test:state` and `test:camera` need an exported bundle. Without
one they print `SKIP` and **exit 3**, which stops the chain above — that is
deliberate. Exit 0 means a test ran and asserted things; 1 means it found them
wrong; 3 means it asserted nothing. Build a bundle with
`tools/export_player.py`, or point `HOTD2_BUNDLE` at one.

### Layers, and the direction dependencies point

```
engine    core/ bundle/ script/ game/   no three.js, no DOM, no Math.random
render    render/                       three.js. reads engine state, owns nothing
ui        hud/ -> ui/                   reads one projection, emits commands
app       app/                          the composition root. sees everything
```

Down only. `engine` imports nothing above itself; `render` and `ui` never
import each other.

Lifetimes above the engine line belong to a **scope** — the disposal tree in
`core/scope.ts`. A scope holds only what is *not* in the snapshot, which is the
same thing as saying it holds exactly what `resync` must be able to rebuild.
**`game/` never gets one**: the port transcribes a fixed object pool, and a
snapshot slice has to survive `clonePlain`. `tools/verify_layers.py` enforces this with two severities:
**error** rules must be zero, **ratchet** rules record a count that may fall
but never rise.

**Never add a violation to get work done.** If the task in front of you cannot
be finished without one:

1. Say so, name the rule and what it would take to satisfy it.
2. Point at the step in `docs/PLAYER_ARCHITECTURE.md`'s order of work that
   clears it — every ratchet has one.
3. **Ask the user whether to do that refactor first, or to change the plan.**

Raising a ratchet baseline is a decision that belongs in the architecture doc,
never a line edit in the checker. There is no suppression comment on purpose.

## Evidence convention

Mark every claim about the binary: `[proved]` — you read the code that says so;
`[likely]` — inference, with the evidence stated; `[open]` — undetermined.
**`[open]` is a useful answer and a guess is not.** Never name a thing from
where it sits or what it resembles.

In the port, `[diverges]` tags a place the port knowingly departs from the exe,
with the reason on the spot. The count of them is the honest measure of how
finished it is.

## Committing

**Other workstreams run in this repo at the same time**, often in the same
files, with their work uncommitted while they work.

`git add -A` and `git add .` are banned. Before committing:

```sh
git status --porcelain     # what is dirty that is NOT yours?
git add <explicit paths>
git diff --cached --stat   # confirm before committing
```

If a peer has edited a file you also changed, stage only your own hunks — see
the `/decomp` skill for the patch-filtering recipe. Leave their uncommitted
work exactly as you found it, and never rewrite history.

`ghidra/annotations/*.tsv` is appended to by both workstreams: add rows with
`python3 tools/annotate.py`, which upserts rather than duplicating, and never
re-sort the file.

## Things that have cost this project real time

* The decompiler silently drops FPU arguments to the matrix calls. Re-read
  every constant with `disassemble_bytes` and quote the raw hex.
* `CamEvalObjectPath6` returns `{float x,y,z; int rx,ry,rz}`. Ghidra types all
  six as float. It is wrong.
* Object fields are polymorphic — `obj+0x11C` is hit points for combat classes
  and a sub-type selector for others. Check the class.
* A negative result from one agent is not a fact.
* **Verify against the disc, not against another copy of your install.** Four
  `cam/` files were rotted in the local extract, and a whole restoration
  engine plus a documented "NaN padding convention" were built to explain the
  damage before anyone compared against `hotd2.iso`.
