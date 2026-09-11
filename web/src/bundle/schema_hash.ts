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
  "characters.ts": "e6eab0d7144f75cfc031bccd4e14fe30ee7e3541452c0af44bd6a26cfadececf",
  "manifest.ts": "d40063e2c913e7a7883676846970bd2f838628f4d3cee628f23178f1e48b8cd4",
  "scene.ts": "01504b3bd3849b12fce290f6c2dc7d9d2fa1a77d8aa2b65d86eceaddb6bc95ce",
  "script.ts": "e722a9cea5fcbadeb60f47f3a3db46da0c4edc91267ba80919cd17d301f3b750",
  "sound.ts": "69f5c5cdf7a96b4ef01e41cbee9805c81e709f15a396ed2456b017389b3cefd8",
  "stage.ts": "ec199282be3288267a282c15c284260702414d7dd011818e7b379da728063a68",
};

/** One digest over {@link SCHEMA_FILES}, in filename order. */
export const SCHEMA_HASH = "bb6c3243be43a4b839126ec6d1cfac565b4788abcf0f1ac93263e74fc6875838";
