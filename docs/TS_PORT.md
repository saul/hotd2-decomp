# The exporters in TypeScript

`tools/hod2lib/` is 13,187 lines of Python that turns a HOTD2 install into the
bundle `web/` loads. It runs on a developer's machine, writes 411 MB into
`extract/player/`, and the browser fetches the result over HTTP. That works,
and it means the player cannot be handed to anyone who does not also have
Python, the repo, and a terminal.

`web/src/hod2lib/` is the same library in TypeScript, behind one seam, so that
the *same code* runs two ways:

* **a thin CLI** — `npm run export -- --game-dir "..." --all` — writing the
  same `extract/player/` tree the Python writes;
* **in the browser** — the user points the page at their own install, picks
  stages and modes, and the export runs client-side into a cache that survives
  a reload, with a download button for the result.

Nothing about the bundle's *shape* changed. `BUNDLE_FORMAT` did not move.

## The contract: what "identical" means

The lodestar is that a bundle built by the TypeScript is the bundle built by
the Python. That is worth being precise about, because the four output kinds
divide two and two:

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

Everything else agrees exactly. `tools/compare_bundles.py` is what says so.

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

### The one module that is not a port

`schema.py` hashes `web/src/bundle/*.ts` off disk. The browser cannot do that
and does not need to: the TypeScript exporter is *compiled against* those
declarations, so it imports `SCHEMA_FILES` and `SCHEMA_HASH` from the generated
`schema_hash.ts` and stamps them into the manifest. A bundle built in the
browser therefore agrees with the client that built it by construction.

### The one table that is generated

`rigs.py` is 690 lines of hand-read draw routines: a translation is a `PUSH
imm32` somebody disassembled, and the `note` beside it is why it is that
number. Re-typing all of it would be re-doing that work with no second reading
to catch a slip — and the failure mode is a wheel four units to the left, which
nothing measures. So `tools/gen_rig_data.py` emits `web/src/hod2lib/
rigs_data.ts` from the objects themselves, and `verify_exporters.py` fails when
the committed copy is stale. The evidence travels: `note`, `animated` and
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

**Downloading.** A store-only ZIP writer, sixty lines, no dependency. No
compression on purpose: a GLB is 99% of a bundle and is already packed. It
streams into a `showSaveFilePicker` handle where there is one, so the whole
export never has to exist as a `Blob`.

## Proving it

**`tools/verify_parity.py`** exports one stage with both implementations into a
temporary directory and compares them. It is a `verify_all` row and it needs a
game directory:

```sh
python3 tools/verify_all.py --game-dir ~/"THE HOUSE OF THE DEAD 2"
```

**`tools/compare_bundles.py`** is what it calls, and takes any two export
trees. A GLB is compared as a GLB — JSON chunk parsed, BIN chunk memcmp'd,
embedded PNGs decoded to pixels — so a differing deflate stream over identical
pixels reports as identical and a single wrong vertex does not hide inside a
25 MB file. `--ulps` sets the allowance and prints what it covered.

```sh
python3 tools/export_player.py --game-dir "..." --all --out /tmp/py
cd web && npm run export -- --game-dir "..." --all --out /tmp/ts
python3 tools/compare_bundles.py /tmp/py /tmp/ts --ulps 1
```

**`tools/verify_exporters.py`** checks the cheap half on every commit, with no
game directory: the two packages hold the same modules, stamp the same
`BUNDLE_FORMAT` and `tool_version`, and `rigs_data.ts` is current.

### What it says today

All twelve stage bundles — six stages, both game modes — are identical. The
CLI is about nine times faster than the reference: 3.2 s against 28.7 s for
stage 1, and 429 MB in a few minutes rather than most of an hour.

## What this does not do

* **The Python does not go away.** Thirty-one tools under `tools/` import
  `hod2lib`, including nineteen `verify_*` checks that read the game directly.
  Porting those is not in scope and the Python package stays the reference
  implementation — the thing the TypeScript has to agree with. That is a real
  cost: two implementations of one format specification, which is the drift
  this repo spends most of its checks preventing. The rule is that a format
  change lands in the Python first and the TypeScript in the same commit, and
  `verify_parity` is what makes that survivable.
* **No new bundle format, no new fields, and no fixes folded in.** If the port
  finds a bug in the Python it is fixed **in the Python**, so both sides move
  together and the parity check stays meaningful. A fix that exists only in the
  TypeScript is a divergence wearing a better word.
* **BGM is still streamed from the install.** 161 MB of uncompressed PCM does
  not belong in a bundle and does not belong in OPFS. The dev server reads it
  out of the game directory named in `manifest.json`; a bundle exported in the
  browser records the folder's name, and the sound path for that case is
  [open].
* **Safari is untested.** It has no `showDirectoryPicker`, so it takes the
  `webkitdirectory` path and re-prompts every visit, and its OPFS is
  worker-only for some operations. Neither is worked around, because neither
  has been measured.
