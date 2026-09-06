# The exporter in TypeScript

`tools/hod2lib/` was 13,187 lines of Python that turned a HOTD2 install into
the bundle `web/` loads. It ran on a developer's machine, wrote 411 MB into
`extract/player/`, and the browser fetched the result over HTTP. That worked,
and it meant the player could not be handed to anyone who did not also have
Python, the repo and a terminal.

`web/src/hod2lib/` is that library in TypeScript, behind one seam, so that the
*same code* runs two ways:

* **a thin CLI** — `npm run export -- --game-dir "..." --all` — writing the
  same `extract/player/` tree;
* **in the browser** — the user points the page at their own install, picks a
  stage and a mode, and the export runs client-side into a cache that survives
  a reload, with a download button for the result. Every other stage is built
  the moment it is asked for.

Nothing about the bundle's *shape* changed. `BUNDLE_FORMAT` did not move.

**The Python writer is gone.** It was kept exactly as long as it took to prove
the port, and the proof came in: all twelve stage bundles identical, twice. So
`hod2lib/bundle.py`, `hod2lib/schema.py` and `tools/export_player.py` were
removed. What is left of `tools/hod2lib/` is the reading half — twenty
`verify_*` checks read the game through it, `export_level.py` writes glTF with
it, and it is still where each format is specified in code.

The rest of this file is the record of that proof, and the account of what the
two halves owe each other now that only one of them writes a bundle.

## The contract: what "identical" meant, and what it measured

The lodestar was that a bundle built by the TypeScript is the bundle built by
the Python. That is worth being precise about, because the four output kinds
divided two and two:

| Output | Guarantee |
| --- | --- |
| `<stage>.glb` BIN chunk — every vertex, index and PNG | **byte for byte** |
| `<stage>.glb` JSON chunk | **structurally**, PNGs compared by pixel |
| `<stage>.script.json`, `<stage>.cam.json` | **structurally** |
| `manifest.json` | **structurally**, less `built` |

Structural rather than textual, because Python and JavaScript disagree about
how to *print* a number and about nothing else. Python has an `int` and a
`float` and writes `8000.0`; JavaScript has one number type and writes `8000`.
Both parse to the same IEEE double, which is what a reader of a bundle gets.
Carrying a float/int distinction through 13,000 lines to win a textual diff
would mean wrapping several hundred leaf values in a marker class, and
`JSON.parse` cannot tell the difference.

Three deliberate divergences, all of them stated where they happen:

1. **Integral floats**, above. It is why the JSON files are 5–10% smaller.
2. **The deflate stream inside a PNG.** Node's `zlib.deflateSync(buf, {level:
   6})` is the same zlib Python calls and produces the same bytes, so a CLI
   export's PNGs are identical; a browser's `CompressionStream("deflate")` is
   also zlib but its level is the engine's business. The decoded pixels are
   identical either way, and that is what the comparison asserts.
3. **The last bit of a transcendental.** IEEE 754 does not require `sin`,
   `cos`, `asin` or `atan2` to be correctly rounded, and V8's fdlibm and
   CPython's libm disagree in the last place on a handful of inputs. Across
   all twelve stage bundles that is **34 quaternion components out of roughly
   four million numbers**, each one 1 ULP. Nothing that is plain arithmetic is
   allowed to move at all, and the comparison prints every value the allowance
   covered rather than hiding it.

Everything else agreed exactly, on all twelve stage bundles, twice: once
before the class-0x52 actor rig landed and once after.
`tools/compare_bundles.py` is what said so, and it is still in the tree --
there is simply no second implementation to point it at any more. Its use now
is a browser export against a CLI one, or one revision's output against the
next's.

## Where the code lives, and what it may touch

    web/src/hod2lib/          one .ts per tools/hod2lib/*.py, same name

One file per Python module, named the same, so the two can be read side by side
and a reviewer can diff them without a map. `tools/verify_exporters.py` checks
the two package listings against each other, with the five exceptions declared
in `LIBRARY_ONLY` and a reason on each.

The package sits in the **engine** layer (`tools/verify_layers.py` has
`"hod2lib": "engine"`), which is exactly the constraint it needs: no three.js,
no DOM, no `Date`, no `performance`, no `Math.random()`. A parser that reads
the clock cannot be replayed, and one that touches the document cannot run in
the worker it was written for.

That leaves it with no way to open a file, which is the point.

### The seam

Three interfaces in `web/src/hod2lib/io.ts` — `AssetSource`, `BundleSink` and
`Deflate` — and every module takes what it needs rather than reaching for it.
Paths are `evt/st1evtbl.bin`: forward slashes, relative to the directory
holding `Hod2.exe`, and **resolved case-insensitively**, because the tables
compiled into the exe spell `COMMON\BLOOD01_16.WAV` and the files on disk are
lowercase under real directories.

Two implementations of each, both **outside** the package:

* `web/tools/lib/node_io.ts` — `node:fs`, `node:zlib`. Used by the CLI.
* `web/src/app/install/browser_io.ts` — the File System Access API for the
  install, OPFS for the cache, `CompressionStream` for PNG. Used by the page.

### Three things Python gives for free and TypeScript does not

**`struct`.** `web/src/hod2lib/bytes.ts` is a little-endian reader over a
cached `DataView`, plus a growable writer for the glTF buffer. Little-endian
throughout: the game is x86 and an endianness flag would only ever be a way to
get it wrong.

**`json.dumps`.** Python's default separators are `", "` and `": "`, *with*
the spaces, and `bundle.py` relies on the default while `gltf.py` asks for
`(",", ":")`. `web/src/hod2lib/pyjson.ts` takes the separator pair, escapes
non-ASCII the way `ensure_ascii` does, and refuses `NaN` and `Infinity`, which
is `allow_nan=False` and which the camera decoder depends on.

**Tuple keys.** Two maps in `stage.ts` are keyed on a `(name, index)` pair.
`pairKey` is the one spelling of that, and every reader goes through it: `gltf`
looked the same key up with a space in it once, and the result was every model
node in the bundle losing its region list — a bundle that loads, draws, and
shows the whole stage at once.

### The two generated TypeScript files

Neither is a port, and both are checked by `verify_exporters.py`, which fails
when the committed copy is stale.

**`schema_hash.ts`.** The digest that ties a bundle to the declarations reading
it. `tools/gen_schema_hash.py` writes it — that logic was `hod2lib/schema.py`
and moved out when the Python writer went, because computing a digest over
files in this repository is a repository job, not a parser. The exporter is
*compiled against* those declarations, so it imports `SCHEMA_FILES` and
`SCHEMA_HASH` rather than recomputing them: a bundle agrees with the client
that built it by construction, in the browser as much as in the CLI.

**`rigs_data.ts`.** `rigs.py` is 690 lines of hand-read draw routines: a
translation is a `PUSH imm32` somebody disassembled, and the `note` beside it
is why it is that number. Re-typing all of it would be re-doing that work with
no second reading to catch a slip — and the failure mode is a wheel four units
to the left, which nothing measures. So `tools/gen_rig_data.py` emits it from
the objects themselves. The evidence travels: `note`, `animated` and
`condition` are fields, not comments.

## The browser half

**Choosing the install.** `showDirectoryPicker()` where it exists (Chromium),
`<input type="file" webkitdirectory>` everywhere else. The handle goes into
IndexedDB so a reload re-uses it — a handle survives structured clone, but its
permission does not, so the page asks for it back inside a click. The
`webkitdirectory` path cannot be persisted at all and re-prompts; that is the
browser's rule, not a shortcut.

**Running it.** In a worker. The export is CPU-bound and doing it on the main
thread would freeze the page for the whole of it, including the progress feed
that is supposed to say what is happening. `FileSystemDirectoryHandle` and
`File` are both structured-cloneable and the package is pure, so the worker is
a message loop with no knowledge of any format in it. This is the whole reason
the seam exists.

**Keeping it.** The Origin Private File System, laid out exactly like
`extract/player/` — `manifest.json` at the root, one directory per stage. Same
tree, same names, so the same reader works over both and there is no second
layout to keep true. A full export asks for `navigator.storage.persist()`
first, because 429 MB in the best-effort bucket is 429 MB a browser may drop.

**Reading it back.** `web/src/bundle/load.ts` gained a `BundleSource`: one
`fetch`, or one `File` out of OPFS. `loadStage` hands the GLB over as a `blob:`
URL, which `app/stage_load.ts` gives back the moment three.js has parsed it —
a 58 MB blob nothing revokes is 58 MB the tab keeps until it closes.

**Both at once.** The two sources are live together, and which one a *stage*
comes from is a per-stage question — a page can be served four stages and hold
two of its own. `app/bundles.ts` answers it: the cache wins, because an export
made in the tab is the more recent statement about that stage and the only one
that can be rebuilt, and a source is only offered a stage whose `format` and
schema digest this client reads. Nothing in `bundle/` holds a "current"
source any more; every call names the one it means.

**Building on demand.** A stage neither bundle holds is decoded when it is
picked, into the cache, with the progress in the loading overlay — that is
`Player.buildStage`, and it is why the stage picker offers all six as soon as
the page knows an install. One stage is about a minute; all twelve are 431 MB
and most of an hour, which is not a thing to ask for before anything has been
seen.

**Picturing it.** The stage picker's tiles show a frame the player rendered
the last time that stage was open, captured in `endFrame` (a WebGL back buffer
does not survive the turn it was drawn in) and kept in OPFS *beside* the cache
rather than in it. No screenshot is committed to this repository, so the only
honest picture of stage 4 is one this browser made from the copy of the game
its owner already has.

**Downloading.** A store-only ZIP writer, sixty lines, no dependency. No
compression on purpose: a GLB is 99% of a bundle and is already packed. It
streams into a `showSaveFilePicker` handle where there is one, so the whole
export never has to exist as a `Blob`.

**The same code on two runtimes is two implementations.** The CLI built all
twelve bundles and the browser could not build one: `container.classify`
decides whether a blob is compressed by *trying*, and the LZ decoder
preallocated its output from the file's own size header. 865 of the game's
files have a first dword that merely looks like a size, up to 4.03 GB of it in
`tex/st5_01b.bin`. Node hands over a 4 GB buffer and the decode then fails, so
the trial worked; a browser refuses, and a `RangeError` is not the `LZError`
the trial was catching. The grammar cannot produce more than 78.8 bytes out per
byte in, so that header is now refusable by arithmetic rather than by attempt —
and the fix changed no byte of any bundle, which is the thing
`compare_bundles.py` is still here to say. `L22`.

## How it was proved, and what still checks it

While both writers existed there was a `verify_all` row, `verify_parity`, that
exported a stage with each and compared the bytes. It ran on every commit that
had a game directory to hand, and it caught two real faults: a composite map
key spelled two ways, which cost every model node in the bundle its region
list, and a character-type rule a concurrent workstream added to `spawnres.py`
in the middle of the port, which the TypeScript reproduced from the version it
had read. Neither was visible in the code; both were one line of output.

The last measurement, over all twelve stage bundles, is the one in the contract
above: every GLB's BIN chunk byte for byte, every JSON field equal, 34
quaternion components 1 ULP apart. It was taken twice — before and after the
class-0x52 actor rig landed on both sides — and then the Python writer was
removed and `verify_parity.py` with it, because a check that can no longer run
is worse than no check.

**What still runs, on every commit and with no game directory:**

* **`tools/verify_exporters.py`** — the two packages hold the same modules,
  with five declared exceptions and a reason on each; the version they claim is
  the same; and both generated TypeScript files are current.
* **`npm run test:export`** — the three things comparing two bundles could
  never check anyway: `json.dumps`'s separators against the real interpreter,
  the case-insensitive path resolve, and an archive `unzip` can open.

**And `tools/compare_bundles.py` is still there.** A GLB is compared as a GLB —
JSON chunk parsed, BIN chunk memcmp'd, embedded PNGs decoded to pixels — so a
differing deflate stream over identical pixels reports as identical and a
single wrong vertex does not hide inside a 25 MB file. There is no second
implementation to point it at, but there are two questions left that it answers
and nothing else does:

```sh
# did that refactor change a single byte?
cd web && npm run export -- --game-dir "..." --all --out /tmp/before
#   ...make the change...
cd web && npm run export -- --game-dir "..." --all --out /tmp/after
python3 tools/compare_bundles.py /tmp/before /tmp/after

# does the in-page export match the CLI? (unzip the download over /tmp/browser)
python3 tools/compare_bundles.py /tmp/after /tmp/browser
```

### What it costs and what it bought

The CLI is about nine times faster than the Python was: 3.2 s against 28.7 s
for stage 1, and 429 MB in a few minutes rather than most of an hour. The
bundle is unchanged.

## What this does not do

* **The Python parsers do not go away.** Twenty-eight tools under `tools/`
  still import `hod2lib`, including twenty `verify_*` checks that read the game
  directly and `export_level.py`, which writes the glTF a human opens in
  Blender and has no TypeScript CLI. So the same formats are still implemented
  twice — the drift this repo spends most of its checks preventing — and what
  is left holding that together is `verify_exporters.py` and the rule that a
  format change lands in both halves in the same commit. It is a weaker
  guarantee than a byte comparison, and that is the price of having one writer
  instead of two.
* **`gltf.py` and `png.py` stayed** even though `gltf.ts` and `png.ts` exist,
  because `export_level.py`, `export_asset.py`, `export_character.py` and
  `verify_spawn_facing.py` read them and none of those has been ported. The
  clean way to remove them is to port `export_level.py`; the glTF *library* is
  already there.
* **No new bundle format, no new fields, and no fixes folded in.** The port
  changed nothing about what a bundle contains, on purpose: a fix that arrived
  with a rewrite could not have been told from a transcription error.
* **BGM is still streamed from the install.** 161 MB of uncompressed PCM does
  not belong in a bundle and does not belong in OPFS. The dev server reads it
  out of the game directory named in `manifest.json`; a bundle exported in the
  browser records the folder's name, and the sound path for that case is
  [open].
* **Safari is untested.** It has no `showDirectoryPicker`, so it takes the
  `webkitdirectory` path and re-prompts every visit, and its OPFS is
  worker-only for some operations. Neither is worked around, because neither
  has been measured.
