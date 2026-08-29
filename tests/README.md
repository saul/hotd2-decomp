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
| 2 | all 788 compressed files decompress to exactly `dword0` bytes |
| 2 | `hod2lib.lz` and `src/lz.c` agree on every input |
| 2 | every decompressed `pol/` file parses as a valid container + NL1 |
| 3 | `hod2lib.nl1` matches the Blender addon on vertex/triangle counts, centroids and radii |
| 3 | mesh chains terminate cleanly on all 192 raw `pol/` files |
| 4 | texture-bank offsets reconstruct with zero residual on all banks |
| 4 | decoded textures round-trip against the `PVRT` files the Blender addon accepts |

## Current invariants worth locking in

Established in Phase 0 and already true of the shipped game:

- `pol/`: 192 `raw_table`, 1 `raw_blob`, 463 `compressed`
- `tex/`: 29 `raw_table`, 68 `raw_blob`, 325 `compressed`, 47 `bmp`, 23 `empty`
- 326 `pol_`-prefixed files; 320 byte-identical to their twin, 6 differing
- 85 raw `pol`/`tex` pairs analysed; **7 sum exactly**; **zero negative deltas**

The zero-negative-deltas invariant is the important one: a single negative delta
would falsify the texture-bank layout hypothesis in
[`../docs/formats/texbank.md`](../docs/formats/texbank.md).
