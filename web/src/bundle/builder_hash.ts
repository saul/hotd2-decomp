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
  "bundle.ts": "c1dd632002888ab8b368d9600530729f57599f41e5d36daf05fbce2f85c5b11d",
  "bytes.ts": "59b2f363e98da56e88ada59458239032e40cad3a27342659e213d849c0967168",
  "cam.ts": "fe50200cb57c6578681a121766e7a5f4ed2425d91996169f83a82e8375dd63c3",
  "campaths.ts": "fbe28df3265d37b60a006e937a926eca8546609aa29cc5d80e7f1fc9afd639be",
  "characters.ts": "7882b631cdc49bfff4fc5430bb268c706a8e29b81101d11eb5f9806ea40dad6a",
  "charbuild.ts": "d2e7412d0b90f6444980da1a2f38d64e13202e54b9f2c7be7e8b09c260c4cd76",
  "charmotion.ts": "e5b199f0e879d53c2c0e7bfe9ccd55f07524200526c5752c1d70c70eb513ab26",
  "class31.ts": "92eddede0017e448c05697810f1b3cd1112340d1ddae676bb682b940e0e22aea",
  "coli.ts": "02fc9b735e70604a7c4af33ee0598d27ed21f84e1cb1ad7a98ad8433d6eac82a",
  "combat.ts": "f87078545c6f35c1b6761466ea34c36122dedfefce3d753023871cea8baaa8a7",
  "container.ts": "11b185957d66a5123097e51aadb5ae66760d11f8c9f69a1c128c58c4045e3e40",
  "degraded.ts": "f53ceffd81c8182f0c5edde7e6f0c1bc7f62da1851ca23e351eda62a87fb9f2e",
  "evt.ts": "a91352d4357e641ceddbc7e344e84f76dd6bbb2da8d7910c77ce636af4c577df",
  "exetab.ts": "45e0e06d67faaf26411848708a18a4747766b101c92b60b60026d88df302b92d",
  "gltf.ts": "a627387e4c52fecb292eb8736d7fbee2818fd503ac20f23337d760091c0fb109",
  "io.ts": "e9e18d6a03619988a2506b77a28063c2885743d52c3f2e620a149b36a8e20170",
  "lz.ts": "dddff2029ebd1cafc686d25b57da5e5ad8e22fdb2febf4af4988651d627aa80e",
  "mot.ts": "114f3ffa4e967dcdb69ea6919ec21b83d6ff9d1f6754d2a7f9e0fd1d3d1a3952",
  "nl1.ts": "317558dbf8e53791395e7dd24c85b18487576ee110545cc284b6ab65cdff82bd",
  "placement.ts": "6b508e31e5478c09d3b81e93b8aa99b81456e00100ba115bd9675b2600aec39c",
  "png.ts": "326d5417b68475ad54b90e2a91a1f68ca3859d6ba044582928a13459b4afa50b",
  "props.ts": "7186ef2c37d5b64e8893cee5b51e1894f09972ce14c7f487f10e125e2e49bc30",
  "pyjson.ts": "693a387ed9d4ef67ee50cb7da5502d9dc8132871893eff3a0a0009047c5feb5a",
  "rigs.ts": "7700568a93b03bf83d0a8e3f2be16acc96d6b8cf7369ff5659abd7b3819fe47a",
  "rigs_data.ts": "52f1116f7bb86b0dd16a0d21916356904c94ea5539da05a11e2c89fffd4e9b51",
  "script.ts": "dc795abca7a79db26f0bb55a210a4d4a41e5afe2d970df13c3e79755695218fa",
  "sha256.ts": "7c01f5b843a50a7fc05e749c7a737c252482557ebc523eef7da0f46c7baa427c",
  "spawnres.ts": "6e5dff0b9008aacbe4b958dc7585cce893fe23ee2753b4605b4c1c644eb75daf",
  "stage.ts": "4f2667ff2391e25e0f22c7e6473394dfc683b87ec1c7969ae0115302ea8498e6",
  "texbank.ts": "40786961f0e540180ebf8b56622bcd155e5b6a4e39bac81b8e787c4c1078cdc5",
};

/** One digest over {@link BUILDER_FILES}, in filename order. */
export const BUILDER_HASH = "0eaf045be2979397b3bfc0c7a9b62e16bc90935d4de375f49bc82b9a2ecebd1b";
