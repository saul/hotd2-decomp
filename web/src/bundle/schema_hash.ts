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
  "cameras.ts": "971f35c941984006cb7e20f9182661a668e3825d461f204b9a5e9cd5fa1f8f0c",
  "characters.ts": "2231ebc27611f6a0116f32f64ddbc0ec0732075ada57e24c9d6021e6025adb97",
  "index.ts": "86eb809341866760d17efce17a66c542a8ef25587caec86e4ee080d6673fbf6e",
  "manifest.ts": "72f46a0dc03712229b06371a0e2a8f622092df8c3a6297ec0ecb388c7fbc6b96",
  "scene.ts": "de5f7cf43a191f6e15928ef341434e660155714933a1152973204607cf4adc9b",
  "script.ts": "b0b5aaa5b2e8ea8b5c2943fcd1081cec7fae3a2de6c51b3ba1f58c4d39481458",
  "sound.ts": "619754539df917eb5781c8139a92dcdacee537822db328373929ef5d0a527ae2",
  "stage.ts": "0b1da37ea11a6acebff8d569c1900c66e17570080f631e544e1bc187a5b74d21",
};

/** One digest over {@link SCHEMA_FILES}, in filename order. */
export const SCHEMA_HASH = "4e21f440b151b65d0d9273e37a0c87ffe50bcce45f5c913bb1067fe3c9080cbf";
