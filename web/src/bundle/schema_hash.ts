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
  "characters.ts": "02199058fe23baa96bc76cc4c11cf53fbb805720fc29b558c80ca9261d5b868f",
  "manifest.ts": "3a997346dabe6a0bb4ebfbf1c46e4a7ee7c1271cc2cecd2503130890e6270bcf",
  "scene.ts": "18f6aa8d22d87c043cb38e440adb932f1a9495fe170873e44776c64c9b0d6100",
  "script.ts": "05e0793ed5c5771b326f7a1e094f250a25a96bf2805849da33bbf846ab132100",
  "sound.ts": "69f5c5cdf7a96b4ef01e41cbee9805c81e709f15a396ed2456b017389b3cefd8",
  "stage.ts": "2fbd35dfd80b92fabedfd964ef6a10a6d67c80295d1fb0ce28fda8b97279c498",
};

/** One digest over {@link SCHEMA_FILES}, in filename order. */
export const SCHEMA_HASH = "1b256b1a9d86a243300a699830c412f1a53241b4233217520544b1039151b722";
