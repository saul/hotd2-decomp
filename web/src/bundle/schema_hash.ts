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
  "characters.ts": "7b596a51fdb89e7e480ff6577aaecfa184a417118fd13a6b1e4d8d710cc21a73",
  "index.ts": "86eb809341866760d17efce17a66c542a8ef25587caec86e4ee080d6673fbf6e",
  "manifest.ts": "72f46a0dc03712229b06371a0e2a8f622092df8c3a6297ec0ecb388c7fbc6b96",
  "scene.ts": "de5f7cf43a191f6e15928ef341434e660155714933a1152973204607cf4adc9b",
  "script.ts": "45732e288477e860182fae40ddb3970407600f958c4d9e1323d2e39e7062be88",
  "sound.ts": "619754539df917eb5781c8139a92dcdacee537822db328373929ef5d0a527ae2",
  "stage.ts": "0b1da37ea11a6acebff8d569c1900c66e17570080f631e544e1bc187a5b74d21",
};

/** One digest over {@link SCHEMA_FILES}, in filename order. */
export const SCHEMA_HASH = "64b9b4cd90e31960baacf4fc93092f6ec561a1cedc797e6b2cb3c092b99c4dd3";
