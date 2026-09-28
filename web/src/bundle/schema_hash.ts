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
  "characters.ts": "ec6b5a4beddafd9309e45c9a1e2b523501dfe884ec4fc4d2aa658c633ed17167",
  "manifest.ts": "13cbb3d9ee94af298b646865caf01025f773cf71da5941c37b392bf9322bebf8",
  "scene.ts": "e5ebb2e4a99dce795dbf666c9137131c5547214a44559ce8a51644226ab4314c",
  "script.ts": "05e0793ed5c5771b326f7a1e094f250a25a96bf2805849da33bbf846ab132100",
  "sound.ts": "69f5c5cdf7a96b4ef01e41cbee9805c81e709f15a396ed2456b017389b3cefd8",
  "stage.ts": "2fbd35dfd80b92fabedfd964ef6a10a6d67c80295d1fb0ce28fda8b97279c498",
};

/** One digest over {@link SCHEMA_FILES}, in filename order. */
export const SCHEMA_HASH = "2ec94fc9ffbb1bd2fa7e16fbf94501a3256d9c540383f350b30765122e2db739";
