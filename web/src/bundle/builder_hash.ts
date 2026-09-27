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
  "bundle.ts": "99a65191d7bbefb3124612fd814f00a8be2c20bf2ffc9d400f4d8ea661fa388f",
  "bytes.ts": "59b2f363e98da56e88ada59458239032e40cad3a27342659e213d849c0967168",
  "cam.ts": "fe50200cb57c6578681a121766e7a5f4ed2425d91996169f83a82e8375dd63c3",
  "campaths.ts": "fbe28df3265d37b60a006e937a926eca8546609aa29cc5d80e7f1fc9afd639be",
  "characters.ts": "0bc08c1d5456213328f17e54bfbd6b4d3f942b63b90a0e13f1126be2b477ded8",
  "charbuild.ts": "4bee40165d6a93e13cc579235e41be150c59f0685f4fa5c002cd4bab347533cc",
  "charmotion.ts": "a8c7a7f036fca47377be4e1deb567607dbb5cd62f2b09142baa5619fdbcbe035",
  "class31.ts": "5bbe8a9b8b78a71e574659a40fc2c6917763607edb4d4e05f0478e8268726c80",
  "coli.ts": "02fc9b735e70604a7c4af33ee0598d27ed21f84e1cb1ad7a98ad8433d6eac82a",
  "combat.ts": "72843fec3f18e97316c70a3c14217d3c027756d91cef23e4b6ea16feeea27c47",
  "container.ts": "11b185957d66a5123097e51aadb5ae66760d11f8c9f69a1c128c58c4045e3e40",
  "degraded.ts": "f53ceffd81c8182f0c5edde7e6f0c1bc7f62da1851ca23e351eda62a87fb9f2e",
  "evt.ts": "4004cb37faed0192ad4c09044c9a5af6162b8ed874a28b0a47e2397fe0349228",
  "exetab.ts": "1cbd428fb7c160b9f895be55635ebe541dc8af1fbac624952ad52c9750679138",
  "game/boss_banner_records.ts": "1be8c2fe41dd39e9c2b638bbe4cb4e274fad9426261014bb358159d09300aaa5",
  "game/class13/state.ts": "e3d20421a1274502fcdfb9996a699c4d124b51cec1047c4f30a96e8cc4eb008a",
  "game/class22/records.ts": "57874272e772536b9bdf7584b9e2ba3b6a337253cb4a645b3fe4aac188208d58",
  "game/class23/records.ts": "2d83661511c6b3b412986cd0a2d1d9a49784fdbcf862f65edb7feead201fe109",
  "game/class25/state.ts": "aef47ee1636919fb933d733fb3c9b67d7eafc1e013c3ebc7dd884c409f4e0795",
  "game/class30/bonecels.ts": "8d9f2553b5c7dbb065d6a3a48ead984a757ce5f3fbf6c830938a49a3ebcf6a40",
  "game/hud_sprites.ts": "e2870af957c7b4e7d2a07735ba7812da6137a5ca38f83ccdf34b93ca3a0bfd9d",
  "game/player_body_data.ts": "fede162206a80f7cea0b70fb3d415f71ab96e7df4f67d40f14c3c162bcd9d3f0",
  "gltf.ts": "a627387e4c52fecb292eb8736d7fbee2818fd503ac20f23337d760091c0fb109",
  "io.ts": "e9e18d6a03619988a2506b77a28063c2885743d52c3f2e620a149b36a8e20170",
  "lz.ts": "dddff2029ebd1cafc686d25b57da5e5ad8e22fdb2febf4af4988651d627aa80e",
  "mot.ts": "114f3ffa4e967dcdb69ea6919ec21b83d6ff9d1f6754d2a7f9e0fd1d3d1a3952",
  "nl1.ts": "317558dbf8e53791395e7dd24c85b18487576ee110545cc284b6ab65cdff82bd",
  "placement.ts": "be5507c421e26b5b26071000e2dcc60a28a8a156365e6e885b73cb7747b25d1b",
  "png.ts": "326d5417b68475ad54b90e2a91a1f68ca3859d6ba044582928a13459b4afa50b",
  "props.ts": "7186ef2c37d5b64e8893cee5b51e1894f09972ce14c7f487f10e125e2e49bc30",
  "pyjson.ts": "693a387ed9d4ef67ee50cb7da5502d9dc8132871893eff3a0a0009047c5feb5a",
  "rigs.ts": "bff39ab9d598b2566b653be5b3b69a018906faef517a7c3ec58f485a7bb3f0be",
  "rigs_data.ts": "d3d6680105b6a08ef46d60358752a05550db035a83aca5c2d067623ae58dd7bc",
  "script.ts": "f06caa37c419015f5673f993aac6ca105e4ca0f62dbd0a28af142df99c781cd2",
  "sha256.ts": "7c01f5b843a50a7fc05e749c7a737c252482557ebc523eef7da0f46c7baa427c",
  "spawnres.ts": "38d3935db110c14b594662ce7200e0090ac28c301a37b2324b6547c492d41e94",
  "stage.ts": "90b27680bd21c22cbe30616c55e5560a668818872f449f9e85892ae2ec43cb18",
  "texbank.ts": "804ee06b5324e31ba191ac1c3e382bedd2861e9657a0f07da6b09b7a61267f0a",
};

/** One digest over {@link BUILDER_FILES}, in filename order. */
export const BUILDER_HASH = "8dfb9e49d09a016baff1adde85303059762649bbc9774ba1e7fab0a246df83f3";
