/**
 * The schema digest this client was compiled against. **Generated file.**
 *
 * Written by `tools/hod2lib/schema.py` on every export and committed; re-run
 * `tools/export_player.py`, or `python3 -c` over that module, after changing
 * any declaration in this directory. `tools/verify_exporters.py` fails when
 * this file is stale, so it cannot quietly drift from its sources.
 *
 * The digest covers the *declarations* in `web/src/bundle/*.ts` -- comments
 * and whitespace are stripped before hashing -- so editing a doc comment
 * costs nothing and changing a field invalidates every bundle built before it.
 * See `docs/formats/bundle.md`.
 */

/** The per-file digests, so a mismatch can name the block that moved. */
export const SCHEMA_FILES: Readonly<Record<string, string>> = {
  "cameras.ts": "e711fd29f97441deae96406d95600d68fc9b5e9ccb1c170b46f23120cd8d67ce",
  "characters.ts": "c4dd2c2204dbbb59b1258ca39f9173f7c5f099bfac43d0da25504ce11c5b41d8",
  "manifest.ts": "87e73abb197eb80fe56f686bd5b9e539e574e9191f9fa7e948cde727e6ba535c",
  "scene.ts": "de5f7cf43a191f6e15928ef341434e660155714933a1152973204607cf4adc9b",
  "script.ts": "b0b5aaa5b2e8ea8b5c2943fcd1081cec7fae3a2de6c51b3ba1f58c4d39481458",
  "sound.ts": "619754539df917eb5781c8139a92dcdacee537822db328373929ef5d0a527ae2",
  "stage.ts": "50ef64059779fb6e1cd7ae0ef2d1a88abbf5df362c931624eec8308c08000a4d",
};

/** One digest over {@link SCHEMA_FILES}, in filename order. */
export const SCHEMA_HASH = "cabe44e837405f1bb7718e9303821c414afae2de3b7cedfdc595c8c4fd681ec4";
