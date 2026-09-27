/**
 * The digest of the exporter that wrote a bundle. **Generated file.**
 *
 * Written by `tools/gen_builder_hash.py` and committed; it covers the code in
 * `web/src/hod2lib/`, which is the only thing that decides what a bundle
 * contains, and every module it imports a value from, followed transitively.
 * `tools/verify_exporters.py` fails when this file is stale.
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
  "actorscript.ts": "bdb28fb46c32fa5ae163a66121c912eb4e1a46152b0bf71129ae41ec2a39df93",
  "approach.ts": "f2458fca4f4f943e775d2f73237eef7bf925b37dc38ba653bc89f80d3e800443",
  "arcscript.ts": "8a62bedf274c97b1d6d7dfe8e64934a767bbeb694a7de3fee1b4c73ad35fb2e1",
  "bams.ts": "f03b1290866a63ab2ae764d49bd15c57bd53c6b1a03794f7a0357e8dd842eb8f",
  "bundle.ts": "995ca226b68802bdee2321826bf908f29ae405613820c58286c45c8e6572f996",
  "bytes.ts": "59b2f363e98da56e88ada59458239032e40cad3a27342659e213d849c0967168",
  "cam.ts": "fe50200cb57c6578681a121766e7a5f4ed2425d91996169f83a82e8375dd63c3",
  "campaths.ts": "fbe28df3265d37b60a006e937a926eca8546609aa29cc5d80e7f1fc9afd639be",
  "characters.ts": "a884e5924b00b11d8f361aa58be8ee2adbad322fed60a54865bc2ecbf9b34c4f",
  "charbuild.ts": "361a125d13404ac2bca62de1ca916a68579cfe0bf5fc397a118096ab9691e639",
  "charmotion.ts": "3d426e4c66628163540997108756a7b2f59a24ba0abc6526bd8c7c279f90c671",
  "class31.ts": "5bbe8a9b8b78a71e574659a40fc2c6917763607edb4d4e05f0478e8268726c80",
  "coli.ts": "02fc9b735e70604a7c4af33ee0598d27ed21f84e1cb1ad7a98ad8433d6eac82a",
  "combat.ts": "72843fec3f18e97316c70a3c14217d3c027756d91cef23e4b6ea16feeea27c47",
  "container.ts": "11b185957d66a5123097e51aadb5ae66760d11f8c9f69a1c128c58c4045e3e40",
  "degraded.ts": "f53ceffd81c8182f0c5edde7e6f0c1bc7f62da1851ca23e351eda62a87fb9f2e",
  "evt.ts": "4004cb37faed0192ad4c09044c9a5af6162b8ed874a28b0a47e2397fe0349228",
  "exetab.ts": "666031949e7c8c7d0334f687a9503fa57bdff1438308248c634fed4f6f0558a4",
  "game/boss_banner_records.ts": "1be8c2fe41dd39e9c2b638bbe4cb4e274fad9426261014bb358159d09300aaa5",
  "game/class13/state.ts": "e3d20421a1274502fcdfb9996a699c4d124b51cec1047c4f30a96e8cc4eb008a",
  "game/class25/state.ts": "aef47ee1636919fb933d733fb3c9b67d7eafc1e013c3ebc7dd884c409f4e0795",
  "game/class30/bonecels.ts": "8d9f2553b5c7dbb065d6a3a48ead984a757ce5f3fbf6c830938a49a3ebcf6a40",
  "game/hud_sprites.ts": "e2870af957c7b4e7d2a07735ba7812da6137a5ca38f83ccdf34b93ca3a0bfd9d",
  "game/player_body_data.ts": "fede162206a80f7cea0b70fb3d415f71ab96e7df4f67d40f14c3c162bcd9d3f0",
  "gltf.ts": "a627387e4c52fecb292eb8736d7fbee2818fd503ac20f23337d760091c0fb109",
  "io.ts": "e9e18d6a03619988a2506b77a28063c2885743d52c3f2e620a149b36a8e20170",
  "lz.ts": "dddff2029ebd1cafc686d25b57da5e5ad8e22fdb2febf4af4988651d627aa80e",
  "mot.ts": "114f3ffa4e967dcdb69ea6919ec21b83d6ff9d1f6754d2a7f9e0fd1d3d1a3952",
  "nl1.ts": "317558dbf8e53791395e7dd24c85b18487576ee110545cc284b6ab65cdff82bd",
  "placement.ts": "89519f98832f0da1c1402f1ab0f1323551a958a9442295d079a18d6ee761c591",
  "png.ts": "326d5417b68475ad54b90e2a91a1f68ca3859d6ba044582928a13459b4afa50b",
  "props.ts": "7186ef2c37d5b64e8893cee5b51e1894f09972ce14c7f487f10e125e2e49bc30",
  "pyjson.ts": "693a387ed9d4ef67ee50cb7da5502d9dc8132871893eff3a0a0009047c5feb5a",
  "rigs.ts": "bff39ab9d598b2566b653be5b3b69a018906faef517a7c3ec58f485a7bb3f0be",
  "rigs_data.ts": "d3d6680105b6a08ef46d60358752a05550db035a83aca5c2d067623ae58dd7bc",
  "script.ts": "f06caa37c419015f5673f993aac6ca105e4ca0f62dbd0a28af142df99c781cd2",
  "sha256.ts": "7c01f5b843a50a7fc05e749c7a737c252482557ebc523eef7da0f46c7baa427c",
  "spawnres.ts": "b7e0a4d06daa4b0df84e6794253ece41bbd1e322e46e5dead53c38feecb010c5",
  "stage.ts": "73bc6983e83b0be5627d645ac10530aec40ab0afbc8ac65a8a9f9fe6bb74ed8d",
  "texbank.ts": "804ee06b5324e31ba191ac1c3e382bedd2861e9657a0f07da6b09b7a61267f0a",
};

/** One digest over {@link BUILDER_FILES}, in filename order. */
export const BUILDER_HASH = "1390181efbeb12b3dfcaef4b18863aebe9623364201caa8aa0a16694bc3ef4e2";
