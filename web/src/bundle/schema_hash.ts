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
  "characters.ts": "79c9ecef0046532164d14ca37e5ea443a51fa6401070c4d5a90edae9072b5ea6",
  "manifest.ts": "f2a1c65e2cf13fa9cbef280045900e3307d32a413739d34dedd25e3f2bb28cb7",
  "scene.ts": "01504b3bd3849b12fce290f6c2dc7d9d2fa1a77d8aa2b65d86eceaddb6bc95ce",
  "script.ts": "e722a9cea5fcbadeb60f47f3a3db46da0c4edc91267ba80919cd17d301f3b750",
  "sound.ts": "619754539df917eb5781c8139a92dcdacee537822db328373929ef5d0a527ae2",
  "stage.ts": "ec199282be3288267a282c15c284260702414d7dd011818e7b379da728063a68",
};

/** One digest over {@link SCHEMA_FILES}, in filename order. */
export const SCHEMA_HASH = "cc648c359a48e3cd3764aecea8a1f0455d1127c46c5f891c4f3e9af4c5fd83c9";
