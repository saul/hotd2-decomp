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
  "characters.ts": "03f1c5f00cb515bc7f2f4b4c14d3c44340410d5337747bae7bb09833dd6ffdc7",
  "manifest.ts": "37c3e33623221efd0aee11e8cb4df1437155c73c1055bec6a7a6818cf8d962bb",
  "scene.ts": "24df1508015b4b5ba7fdf827d23f388bdd71ead033cfa238ed142d98c54b1580",
  "script.ts": "24322ec31dd1b8cbd71e8f6dc257df656e433149663182b70722aaf69330357f",
  "sound.ts": "69f5c5cdf7a96b4ef01e41cbee9805c81e709f15a396ed2456b017389b3cefd8",
  "stage.ts": "9fa1bfb52b310d4ac3c491b5a12bc2409a2d1a19a4de15b9dbe05825e99823a0",
};

/** One digest over {@link SCHEMA_FILES}, in filename order. */
export const SCHEMA_HASH = "63013721f6bf692ed1bae0788f4d38f68d8d5fb828d71f13f106a8eb0e3e410a";
