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
  "actorscript.ts": "96c980600b829786a2f02ea8c85853d4e99e5291c465a3b5276dc8889b2835e5",
  "approach.ts": "f2458fca4f4f943e775d2f73237eef7bf925b37dc38ba653bc89f80d3e800443",
  "arcscript.ts": "8a62bedf274c97b1d6d7dfe8e64934a767bbeb694a7de3fee1b4c73ad35fb2e1",
  "bams.ts": "f03b1290866a63ab2ae764d49bd15c57bd53c6b1a03794f7a0357e8dd842eb8f",
  "bundle.ts": "84f45c65c935ea2a12e82e9de837087e022733d8ce5739651ab22222648e2e94",
  "bytes.ts": "59b2f363e98da56e88ada59458239032e40cad3a27342659e213d849c0967168",
  "cam.ts": "fe50200cb57c6578681a121766e7a5f4ed2425d91996169f83a82e8375dd63c3",
  "campaths.ts": "fbe28df3265d37b60a006e937a926eca8546609aa29cc5d80e7f1fc9afd639be",
  "characters.ts": "faf247eb897af7b986ca8d6252e5029b0ceef2e40b6b4575475013ce50da67a6",
  "charbuild.ts": "361a125d13404ac2bca62de1ca916a68579cfe0bf5fc397a118096ab9691e639",
  "charmotion.ts": "3d426e4c66628163540997108756a7b2f59a24ba0abc6526bd8c7c279f90c671",
  "class31.ts": "92eddede0017e448c05697810f1b3cd1112340d1ddae676bb682b940e0e22aea",
  "coli.ts": "02fc9b735e70604a7c4af33ee0598d27ed21f84e1cb1ad7a98ad8433d6eac82a",
  "combat.ts": "e3f00e9fd1170275bde5fd92dffdcbe3fd1ca74bcbbf555650647e6a06417c85",
  "container.ts": "11b185957d66a5123097e51aadb5ae66760d11f8c9f69a1c128c58c4045e3e40",
  "degraded.ts": "f53ceffd81c8182f0c5edde7e6f0c1bc7f62da1851ca23e351eda62a87fb9f2e",
  "evt.ts": "4004cb37faed0192ad4c09044c9a5af6162b8ed874a28b0a47e2397fe0349228",
  "exetab.ts": "1f2069a9884f525ad766ada283cff81ac97cd3f1b8b8e348f33ff214913d4373",
  "game/class13/state.ts": "e3d20421a1274502fcdfb9996a699c4d124b51cec1047c4f30a96e8cc4eb008a",
  "game/class25/state.ts": "aef47ee1636919fb933d733fb3c9b67d7eafc1e013c3ebc7dd884c409f4e0795",
  "game/class30/bonecels.ts": "8d9f2553b5c7dbb065d6a3a48ead984a757ce5f3fbf6c830938a49a3ebcf6a40",
  "gltf.ts": "a627387e4c52fecb292eb8736d7fbee2818fd503ac20f23337d760091c0fb109",
  "io.ts": "e9e18d6a03619988a2506b77a28063c2885743d52c3f2e620a149b36a8e20170",
  "lz.ts": "dddff2029ebd1cafc686d25b57da5e5ad8e22fdb2febf4af4988651d627aa80e",
  "mot.ts": "114f3ffa4e967dcdb69ea6919ec21b83d6ff9d1f6754d2a7f9e0fd1d3d1a3952",
  "nl1.ts": "317558dbf8e53791395e7dd24c85b18487576ee110545cc284b6ab65cdff82bd",
  "placement.ts": "19e2b98ad7db6a6a27b8efb0fcf62d67f1c1917308268e0de5eaccf0117341ff",
  "png.ts": "326d5417b68475ad54b90e2a91a1f68ca3859d6ba044582928a13459b4afa50b",
  "props.ts": "7186ef2c37d5b64e8893cee5b51e1894f09972ce14c7f487f10e125e2e49bc30",
  "pyjson.ts": "693a387ed9d4ef67ee50cb7da5502d9dc8132871893eff3a0a0009047c5feb5a",
  "rigs.ts": "2f56d14d5ce38d6133739ac9a93bb5b31fd4ab0d30f058a713b6cc3cdb303cbe",
  "rigs_data.ts": "6d01ccae95d063a67cd7b0ce034df332fdf74fa60dfb51bf2c5d10ca6ec04204",
  "script.ts": "6bbe4cb6d4658e17e34104fddb39c9fe99308c0d8c3438d51c03b94c534d56a2",
  "sha256.ts": "7c01f5b843a50a7fc05e749c7a737c252482557ebc523eef7da0f46c7baa427c",
  "spawnres.ts": "b7e0a4d06daa4b0df84e6794253ece41bbd1e322e46e5dead53c38feecb010c5",
  "stage.ts": "d77e2d9e1f922a719952aec4bc6730cd70db0d4b81756402e5e30450c28f94a8",
  "texbank.ts": "40786961f0e540180ebf8b56622bcd155e5b6a4e39bac81b8e787c4c1078cdc5",
};

/** One digest over {@link BUILDER_FILES}, in filename order. */
export const BUILDER_HASH = "e447822b5de3c8206ae30ca715f3cf65da70a950bec9fe3e623eac58d0961ef5";
