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
  "characters.ts": "e6710dfbafd3a2e7765dad1725ec4d4c2e794666c391044e44ae28befebd027d",
  "manifest.ts": "404181f1edd6dedf4dabc719212622fb2a53ba696279a8756260839ee20f9e04",
  "scene.ts": "d09d332eddc0089eede2f3dac95146b9cc924fe8e1adf0a108ca1d5d527bdf52",
  "script.ts": "e722a9cea5fcbadeb60f47f3a3db46da0c4edc91267ba80919cd17d301f3b750",
  "sound.ts": "69f5c5cdf7a96b4ef01e41cbee9805c81e709f15a396ed2456b017389b3cefd8",
  "stage.ts": "ec199282be3288267a282c15c284260702414d7dd011818e7b379da728063a68",
};

/** One digest over {@link SCHEMA_FILES}, in filename order. */
export const SCHEMA_HASH = "39aea63cddb26f561820c583f1c8a34a62797bdcfd3eadba98c967260f1d6466";
