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
  "bundle.ts": "fac5aea23f20f2bd4d77efa347578a16276eefc4fa6b62a7cc9c2e11eb9e586b",
  "bytes.ts": "59b2f363e98da56e88ada59458239032e40cad3a27342659e213d849c0967168",
  "cam.ts": "fe50200cb57c6578681a121766e7a5f4ed2425d91996169f83a82e8375dd63c3",
  "campaths.ts": "fbe28df3265d37b60a006e937a926eca8546609aa29cc5d80e7f1fc9afd639be",
  "characters.ts": "7882b631cdc49bfff4fc5430bb268c706a8e29b81101d11eb5f9806ea40dad6a",
  "charbuild.ts": "a1bb42ee03f420cbea4fda39c55662ad12983c9c8965bcbaced12377ab8698e0",
  "charmotion.ts": "e5b199f0e879d53c2c0e7bfe9ccd55f07524200526c5752c1d70c70eb513ab26",
  "class31.ts": "92eddede0017e448c05697810f1b3cd1112340d1ddae676bb682b940e0e22aea",
  "coli.ts": "02fc9b735e70604a7c4af33ee0598d27ed21f84e1cb1ad7a98ad8433d6eac82a",
  "combat.ts": "f87078545c6f35c1b6761466ea34c36122dedfefce3d753023871cea8baaa8a7",
  "container.ts": "11b185957d66a5123097e51aadb5ae66760d11f8c9f69a1c128c58c4045e3e40",
  "degraded.ts": "f53ceffd81c8182f0c5edde7e6f0c1bc7f62da1851ca23e351eda62a87fb9f2e",
  "evt.ts": "a91352d4357e641ceddbc7e344e84f76dd6bbb2da8d7910c77ce636af4c577df",
  "exetab.ts": "097ae5cf619b7ed5c548976fc293b0e4728c86cf0e24fdb801b6b374ce8732cb",
  "gltf.ts": "4a6172ae8f1637640c4c8eacd04957d031b1b290f5b94f95b1b9b24cf7f2e64c",
  "io.ts": "e9e18d6a03619988a2506b77a28063c2885743d52c3f2e620a149b36a8e20170",
  "lz.ts": "dddff2029ebd1cafc686d25b57da5e5ad8e22fdb2febf4af4988651d627aa80e",
  "mot.ts": "114f3ffa4e967dcdb69ea6919ec21b83d6ff9d1f6754d2a7f9e0fd1d3d1a3952",
  "nl1.ts": "3e06f887a903bfbe0132304fffe4569d6abce06e577cac74e4df1102643e3126",
  "placement.ts": "6b508e31e5478c09d3b81e93b8aa99b81456e00100ba115bd9675b2600aec39c",
  "png.ts": "326d5417b68475ad54b90e2a91a1f68ca3859d6ba044582928a13459b4afa50b",
  "props.ts": "7186ef2c37d5b64e8893cee5b51e1894f09972ce14c7f487f10e125e2e49bc30",
  "pyjson.ts": "693a387ed9d4ef67ee50cb7da5502d9dc8132871893eff3a0a0009047c5feb5a",
  "rigs.ts": "82e6c32edaf45789a4d524e6693669edf8c2bd6d581e06aa2c346a12950908b9",
  "rigs_data.ts": "52f1116f7bb86b0dd16a0d21916356904c94ea5539da05a11e2c89fffd4e9b51",
  "script.ts": "577de572a5ca7ddd3ca14e8886e714c85e986a895f889b0bb06f5d772569c3b5",
  "sha256.ts": "7c01f5b843a50a7fc05e749c7a737c252482557ebc523eef7da0f46c7baa427c",
  "spawnres.ts": "6e5dff0b9008aacbe4b958dc7585cce893fe23ee2753b4605b4c1c644eb75daf",
  "stage.ts": "3bd8232f78002c8537ae4decd6b1e07d659e67da452346002db81b93198ab30c",
  "texbank.ts": "40786961f0e540180ebf8b56622bcd155e5b6a4e39bac81b8e787c4c1078cdc5",
};

/** One digest over {@link BUILDER_FILES}, in filename order. */
export const BUILDER_HASH = "957ff03812b1e4b5ca3e1e721e43e94fcf963d889b95349f07ee65ad13a0af52";
