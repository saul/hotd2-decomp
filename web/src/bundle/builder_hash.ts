/**
 * The digest of the exporter that wrote a bundle. **Generated file.**
 *
 * Written by `tools/gen_builder_hash.py` and committed; it covers the code in
 * `web/src/hod2lib/`, which is the only thing that decides what a bundle
 * contains. `tools/verify_exporters.py` fails when this file is stale.
 *
 * The exporter stamps it into `manifest.json` and onto every stage entry, and
 * `bundle/load.ts` compares -- but **warns rather than refuses**. A schema
 * mismatch means a bundle cannot be read; an exporter change usually means it
 * can be read and is merely out of date. See {@link stageBuilderStale}.
 *
 * The gap this closes: `nl1.dropCollapsedUvTriangles` was deleting 3-5% of
 * every stage, and turning it off moved no declaration and no `BUNDLE_FORMAT`
 * -- so a stage already built into the browser's OPFS cache kept winning over
 * the rebuilt one, with holes in it, however many times the tree was exported.
 */

/** The per-file digests, so a stale bundle can name what moved. */
export const BUILDER_FILES: Readonly<Record<string, string>> = {
  "actorscript.ts": "7ef39ca11fda6332b8630f4c78c241c7dae9e9c412af524ab7ed6df879a4d0fa",
  "approach.ts": "f2458fca4f4f943e775d2f73237eef7bf925b37dc38ba653bc89f80d3e800443",
  "arcscript.ts": "082f1622fe3fa7a327f5477354198ebd3c1f8d5a879a6044eebf4c22968cbd58",
  "bams.ts": "f03b1290866a63ab2ae764d49bd15c57bd53c6b1a03794f7a0357e8dd842eb8f",
  "bundle.ts": "d2032d9c05e41c75d973870def14b874815c8147577224f5fd096624abba9ba0",
  "bytes.ts": "59b2f363e98da56e88ada59458239032e40cad3a27342659e213d849c0967168",
  "cam.ts": "fe50200cb57c6578681a121766e7a5f4ed2425d91996169f83a82e8375dd63c3",
  "campaths.ts": "fbe28df3265d37b60a006e937a926eca8546609aa29cc5d80e7f1fc9afd639be",
  "characters.ts": "5e8b50f85b7c3e90b86f1fd3e4649fc58d50fdfdb27a3d186c5b0e862cf99cd4",
  "charbuild.ts": "66092406316023adedd80ae81732b891601105731e1de469348c08ceb1051528",
  "charmotion.ts": "c235d2d0d8f364b61609b776e2103eaf8f9607ace2a0d683c1491b1d669dffdf",
  "class31.ts": "92eddede0017e448c05697810f1b3cd1112340d1ddae676bb682b940e0e22aea",
  "coli.ts": "02fc9b735e70604a7c4af33ee0598d27ed21f84e1cb1ad7a98ad8433d6eac82a",
  "combat.ts": "72e9e9e7d29bd9e676720e44825c3d8cbf4f2f4895f146b4e9dd7b8e7756dd23",
  "container.ts": "11b185957d66a5123097e51aadb5ae66760d11f8c9f69a1c128c58c4045e3e40",
  "degraded.ts": "f53ceffd81c8182f0c5edde7e6f0c1bc7f62da1851ca23e351eda62a87fb9f2e",
  "evt.ts": "4004cb37faed0192ad4c09044c9a5af6162b8ed874a28b0a47e2397fe0349228",
  "exetab.ts": "1f2069a9884f525ad766ada283cff81ac97cd3f1b8b8e348f33ff214913d4373",
  "gltf.ts": "a627387e4c52fecb292eb8736d7fbee2818fd503ac20f23337d760091c0fb109",
  "io.ts": "e9e18d6a03619988a2506b77a28063c2885743d52c3f2e620a149b36a8e20170",
  "lz.ts": "dddff2029ebd1cafc686d25b57da5e5ad8e22fdb2febf4af4988651d627aa80e",
  "mot.ts": "114f3ffa4e967dcdb69ea6919ec21b83d6ff9d1f6754d2a7f9e0fd1d3d1a3952",
  "nl1.ts": "317558dbf8e53791395e7dd24c85b18487576ee110545cc284b6ab65cdff82bd",
  "placement.ts": "f88d7311a9b0106908eebf484c56d76c2e837c8bac224cd6e2db86868a84ac7f",
  "png.ts": "326d5417b68475ad54b90e2a91a1f68ca3859d6ba044582928a13459b4afa50b",
  "props.ts": "7186ef2c37d5b64e8893cee5b51e1894f09972ce14c7f487f10e125e2e49bc30",
  "pyjson.ts": "693a387ed9d4ef67ee50cb7da5502d9dc8132871893eff3a0a0009047c5feb5a",
  "rigs.ts": "f0605d854b4f2d8f43d6e67b51a3e54a2e112081a31b5376e065ba67b45d2f70",
  "rigs_data.ts": "52f1116f7bb86b0dd16a0d21916356904c94ea5539da05a11e2c89fffd4e9b51",
  "script.ts": "35ec1e1cad06c838d446ad26dfa516b39356fa267c3e3a87d128e7bff6959c57",
  "sha256.ts": "7c01f5b843a50a7fc05e749c7a737c252482557ebc523eef7da0f46c7baa427c",
  "spawnres.ts": "0ded93281e038d3598068974450816b2e88760852b976553791cca1dc36b2bf4",
  "stage.ts": "fe84d25726fde4dfb482cc0f6b69f9df7cbd518924c2376fde5361ac6f7c9710",
  "texbank.ts": "40786961f0e540180ebf8b56622bcd155e5b6a4e39bac81b8e787c4c1078cdc5",
};

/** One digest over {@link BUILDER_FILES}, in filename order. */
export const BUILDER_HASH = "d523a300b0bccfb313f2368956983f9db61aecd84aa0f8e797c35d188bd80eeb";
