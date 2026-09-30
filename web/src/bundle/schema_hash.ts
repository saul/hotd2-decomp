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
  "characters.ts": "a32a9b7ba1ec40efd2a361e55807c231054ff39de48145afcf605e5d678536f7",
  "manifest.ts": "37c3e33623221efd0aee11e8cb4df1437155c73c1055bec6a7a6818cf8d962bb",
  "scene.ts": "a0c5889d5f495d29626da5c9a32323919ebf732ace7fd70f6f9d341697027d08",
  "script.ts": "24322ec31dd1b8cbd71e8f6dc257df656e433149663182b70722aaf69330357f",
  "sound.ts": "69f5c5cdf7a96b4ef01e41cbee9805c81e709f15a396ed2456b017389b3cefd8",
  "stage.ts": "93089f1750ebc26556b80365111fe57e583fc8a0363a728549f832a130ee211b",
};

/** One digest over {@link SCHEMA_FILES}, in filename order. */
export const SCHEMA_HASH = "f6ed047834f8b0c4188e1730a1981dc652a57107a29a594b5dae2f5e7c2e5ebe";
