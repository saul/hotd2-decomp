/**
 * The schema digest this client was compiled against. **Generated file.**
 *
 * Written by `web/tools/gen/schema_hash.ts` (`npm run gen:hashes`) and
 * committed; re-run it after changing any declaration in this directory.
 * `web/tools/repo/exporters.ts` fails when this file is stale, so it cannot
 * quietly drift from its sources.
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
  "characters.ts": "10ba47635574800ce935483a5f13265b83ba18644a861799f8356e43566929ba",
  "manifest.ts": "37c3e33623221efd0aee11e8cb4df1437155c73c1055bec6a7a6818cf8d962bb",
  "scene.ts": "543f32631b1db06d1e1b9085054746a9228cda034b17cdc51e48907d01dbd1fd",
  "script.ts": "24322ec31dd1b8cbd71e8f6dc257df656e433149663182b70722aaf69330357f",
  "sound.ts": "69f5c5cdf7a96b4ef01e41cbee9805c81e709f15a396ed2456b017389b3cefd8",
  "stage.ts": "c20cda65715820d1738a9ddd33a237ee53b747778229389c59a3273ad2c9b072",
};

/** One digest over {@link SCHEMA_FILES}, in filename order. */
export const SCHEMA_HASH = "aaf2e0bd596ed45f996074afc9de16164d725dc9ba163caadf1eee451bc28890";
