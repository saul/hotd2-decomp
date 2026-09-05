# Tests

Regression suite. Requires a local copy of the game; point tooling at it with
`--game-dir`, and set `HOD2_GAME_DIR` for the test runner once tests exist.

No game assets are committed. Tests assert against **hashes and derived
metrics** recorded in `manifest.csv` and `inventory.csv`, never against embedded
asset content.

## Planned coverage

| Phase | Test |
|---|---|
| 0 | `baseline.py` reproduces `inventory.csv` byte-for-byte from a known install |
| 2 | all 793 compressed files decompress to exactly `dword0` bytes ✅ passing |
| 2 | every decompressed `pol/` file parses as a valid container + NL1 |
| 3 | `hod2lib.nl1` matches the Blender addon on vertex/triangle counts, centroids and radii |
| 3 | mesh chains terminate cleanly on all 192 raw `pol/` files |
| 4 | texture-bank offsets reconstruct with zero residual on all banks |
| 4 | decoded textures round-trip against the `PVRT` files the Blender addon accepts |

## Current invariants worth locking in

Established in Phase 0 and already true of the shipped game:

Superseded by the trial-based classifier once the codec was solved. Current
truth, from `tools/verify_lz.py`:

- `pol/`: 458 `compressed`, 192 `raw`, 6 `blob`
- `tex/`: 335 `compressed`, 87 `blob`, 47 `bmp`, 23 `empty`
- 18,027 models parse out of the `pol/` containers
- compression ratio 2.17x (60,571,242 -> 131,562,208 bytes)

The Phase 0 figures below used a `dword0 == 0x800` / `dword0 > filesize`
heuristic that is now known to be unsafe, and are kept only for comparison:
- 326 `pol_`-prefixed files; 320 byte-identical to their twin, 6 differing
- 85 raw `pol`/`tex` pairs analysed; **7 sum exactly**; **zero negative deltas**

The zero-negative-deltas invariant is the important one: a single negative delta
would falsify the texture-bank layout hypothesis in
[`../docs/formats/texbank.md`](../docs/formats/texbank.md).
