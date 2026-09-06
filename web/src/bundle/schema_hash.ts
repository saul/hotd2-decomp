/**
 * The schema digest this client was compiled against. **Generated file.**
 *
 * Written by `tools/gen_schema_hash.py` and committed; re-run it after
 * changing any declaration in this directory. `tools/verify_exporters.py`
 * fails when this file is stale, so it cannot quietly drift from its sources.
 *
 * The exporter imports {@link SCHEMA_HASH} and stamps it into
 * `manifest.json`, and `bundle/load.ts` refuses a bundle whose digest is not
 * this one -- so the exporter and the client agree by construction rather than
 * by anyone remembering.
 *
 * The digest covers the *declarations* in `web/src/bundle/*.ts` -- comments
 * and whitespace are stripped before hashing -- so editing a doc comment costs
 * nothing and changing a field invalidates every bundle built before it. See
 * `docs/formats/bundle.md`.
 */

/** The per-file digests, so a mismatch can name the block that moved. */
export const SCHEMA_FILES: Readonly<Record<string, string>> = {
  "cameras.ts": "e711fd29f97441deae96406d95600d68fc9b5e9ccb1c170b46f23120cd8d67ce",
  "characters.ts": "01ea1cce3d2b940266cb94cd570a8c71d3548b9dc706c744e63d5c56e166c119",
  "manifest.ts": "1db24d27ee911990bc86d7cc976dd471d58e051f545ebd41647cc6b9a110b9dd",
  "scene.ts": "00f4096a33e658d20fbbd20406483961d5af4f159370a6f74b3f4b49d39274cc",
  "script.ts": "b0b5aaa5b2e8ea8b5c2943fcd1081cec7fae3a2de6c51b3ba1f58c4d39481458",
  "sound.ts": "619754539df917eb5781c8139a92dcdacee537822db328373929ef5d0a527ae2",
  "stage.ts": "50ef64059779fb6e1cd7ae0ef2d1a88abbf5df362c931624eec8308c08000a4d",
};

/** One digest over {@link SCHEMA_FILES}, in filename order. */
export const SCHEMA_HASH = "05580ac22d2db0c02df15b317a9de56b26fd56c8263024785b3334ba58b4b2f2";
