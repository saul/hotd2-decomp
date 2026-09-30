/**
 * The digest of the exporter that wrote a bundle. **Generated file.**
 *
 * Written by `web/tools/gen/builder_hash.ts` (`npm run gen:hashes`) and
 * committed; it covers the code in
 * `web/src/hod2lib/`, which is the only thing that decides what a bundle
 * contains, and every module it imports a value from, followed transitively.
 * `web/tools/repo/exporters.ts` fails when this file is stale.
 *
 * The exporter stamps it into `manifest.json` and onto every stage entry, and
 * `bundle/load.ts` compares -- but **warns rather than refuses**. A schema
 * mismatch means a bundle cannot be read; an exporter change usually means it
 * can be read and is merely out of date. See {@link stageBuilderStale}.
 *
 * The gap this closes: an exporter fix that changes what a stage holds --
 * keeping the 3-5% of triangles a UV-area filter drops, say -- moves no
 * declaration and no `BUNDLE_FORMAT`, so without this a stage already built
 * into the browser's OPFS cache goes on winning over the rebuilt one, holes
 * and all, however many times the tree is exported.
 */

/** The per-file digests, so a stale bundle can name what moved. */
export const BUILDER_FILES: Readonly<Record<string, string>> = {
  "actorscript.ts": "bdb28fb46c32fa5ae163a66121c912eb4e1a46152b0bf71129ae41ec2a39df93",
  "approach.ts": "f2458fca4f4f943e775d2f73237eef7bf925b37dc38ba653bc89f80d3e800443",
  "arcscript.ts": "7c64fa78e89264425a0032c0918c846f8972905d848251d517112cd307722b35",
  "bams.ts": "f03b1290866a63ab2ae764d49bd15c57bd53c6b1a03794f7a0357e8dd842eb8f",
  "bundle.ts": "ad5ad52aaf00bbb006217dfbcb650bf5c0945c0db5349d60c4ef9fcfff2363bf",
  "bytes.ts": "59b2f363e98da56e88ada59458239032e40cad3a27342659e213d849c0967168",
  "cam.ts": "fe50200cb57c6578681a121766e7a5f4ed2425d91996169f83a82e8375dd63c3",
  "campaths.ts": "fbe28df3265d37b60a006e937a926eca8546609aa29cc5d80e7f1fc9afd639be",
  "characters.ts": "435671cba17cef24c26423a37faa64fe2720ef331f1c3d1cea924c80f30d4bf3",
  "charbuild.ts": "6c3b70d9e317b1831c287c5b119f60f56aaa78552c47257c51acc833377ea485",
  "charmotion.ts": "b1b99751bb64e4c9a3cce72ac1a38edf6ec29a996e96cb207a37769377a800c2",
  "class14.ts": "e143aab15d3067812e27d18bdd8b35b4b6fc45d6091948c7b8920bf4350a512a",
  "class31.ts": "75b98d9764cd40de62b8f0eef507f48b834b920c8982e6772ad0d12cc2701adf",
  "class42.ts": "4f1400a663e6dd158b008b7a567fb56d9918901a6c0908e3118fae4c4d0002d6",
  "coli.ts": "02fc9b735e70604a7c4af33ee0598d27ed21f84e1cb1ad7a98ad8433d6eac82a",
  "combat.ts": "8e15b0f7bc0471bd2694cf05d6ad845e46b03dae3abbc162d9355754a2288ab1",
  "container.ts": "11b185957d66a5123097e51aadb5ae66760d11f8c9f69a1c128c58c4045e3e40",
  "core/bams.ts": "630119976dd737d42be9fb2cd468971098a5f118b6141c6302ab730fd5c6a2df",
  "degraded.ts": "f53ceffd81c8182f0c5edde7e6f0c1bc7f62da1851ca23e351eda62a87fb9f2e",
  "evt.ts": "3115a01280203f2d46314f679856c06f57193e4084eb6e71410faf6611c6ea58",
  "exetab.ts": "3b73e724fc384d6a6af8275b914bb3775fdc88d2d5325b7a9f7fdd3686e956ed",
  "game/boss_banner_records.ts": "1be8c2fe41dd39e9c2b638bbe4cb4e274fad9426261014bb358159d09300aaa5",
  "game/class12/state.ts": "6de91256d9e69c4b07d8969720517733a13c90a1f25f5bf4a8c929bd55df1c2d",
  "game/class13/state.ts": "661726e666e3415a1280e2aafee4d58ccf2cb1598ea6b5d1db21499a12aa076e",
  "game/class19/slots.ts": "38d0cfd41dc2700247a3de6f65a43301d1331df05ea2a79035f9facf38177d41",
  "game/class22/records.ts": "57874272e772536b9bdf7584b9e2ba3b6a337253cb4a645b3fe4aac188208d58",
  "game/class23/records.ts": "2d83661511c6b3b412986cd0a2d1d9a49784fdbcf862f65edb7feead201fe109",
  "game/class25/state.ts": "1008037aa3648e6065d3e369c672219d7526526413013f53a372afb37ecfaea9",
  "game/class26/state.ts": "e5bb09e2d1fbd50716e805bde68b9740d02b154f252cdb84265993a674553004",
  "game/class2D/state.ts": "63588ab8c0a3b62e80cdb609a35dd4644370ea080f30cd6d418e6dda95449b0f",
  "game/class30/bonecels.ts": "3392ad3933ddf0e5951773cc492c850af53eeb62e5af592fe28bec2bdd7508b0",
  "game/class30/halved.ts": "6ded7bbc1e9fc4e3378988e25635d58323d8c3172ddcea6d1e6869e4c57a075c",
  "game/class41/type47_slots.ts": "9d9a50f252f86cf02a74475bfc3f0f7040219cf25cb4b27ed9e9aa4a6b549648",
  "game/class41/water_slots.ts": "654c7b121971e16e7ecbca8fb3f2c265948c1fe82abd2ef009510b02ddec5235",
  "game/class44/slide_slots.ts": "737ace82df0382eadf0d8c51517928724a6261efc7abd8337c97e25e9f509996",
  "game/class45/tables.ts": "9c4cc0760b37ba37b4f88255ceb6c07d3540753b766400416f2624ec0bb2585c",
  "game/class53/records.ts": "b6800eb8234f8a37c11908ce38316f82b17387ae41e753aeb67089fae09192d0",
  "game/class61/state.ts": "10295909bed89c5b3fd208e8b7165eadd95c73fd5d14c14ad1519fa6f9527f6b",
  "game/hud_sprites.ts": "e555bf8acdd717eacc8c68069174e2469c2910eada2fbd5dad9b3af255b3df7a",
  "game/options_data.ts": "08bc44cec809f1d90aeec628b084dddec78f1b1637ce92b0cb937f25bfb7c546",
  "game/player_body_data.ts": "fede162206a80f7cea0b70fb3d415f71ab96e7df4f67d40f14c3c162bcd9d3f0",
  "game/vec.ts": "e7dc006bd2a77ff946a01c504072c8a3680b23671d7b06c01a85db73759ec595",
  "gltf.ts": "4ca1bf1b90f93acb0ca990b968eba8fccf4d6c79d03320833962f8732956579f",
  "io.ts": "4471bf8bfab1643c6395ae496bdb7d26678835b053b867544c69d0b4c1403df8",
  "lz.ts": "dddff2029ebd1cafc686d25b57da5e5ad8e22fdb2febf4af4988651d627aa80e",
  "mot.ts": "114f3ffa4e967dcdb69ea6919ec21b83d6ff9d1f6754d2a7f9e0fd1d3d1a3952",
  "nl1.ts": "53d01a8b87a5a65508687f5a5c7ea1c041c98f0b20a224f13c387a5ca4cdc25f",
  "placement.ts": "ab1dfa60b288095d85f194c41a0ddeb779b57627ac93b751651a0752f96c2373",
  "png.ts": "326d5417b68475ad54b90e2a91a1f68ca3859d6ba044582928a13459b4afa50b",
  "props.ts": "d35390a2133ba2a01699b20cb3ca086b260eb540724137b3f22118b257adbed6",
  "rigs.ts": "c5e93e79cc7a7f9c678c5b8cff81c0310ac3496f50d25b5af3ea63733c3617b0",
  "rigs_data.ts": "46aa3c9a92bdcf69b1044e0f88e8d212dc6e91e067fe2ebb906a315a70651d95",
  "script.ts": "b173b0307a4b54d773ce52e5aedfb36414666c24c4d0ad3e8690c5fc4f60e3df",
  "sha256.ts": "7c01f5b843a50a7fc05e749c7a737c252482557ebc523eef7da0f46c7baa427c",
  "spawnres.ts": "fbe03f2ba99110a48502e6cfbcfec003cea329bdbb4bb8ad54ae7862ee404f3b",
  "stage.ts": "90b27680bd21c22cbe30616c55e5560a668818872f449f9e85892ae2ec43cb18",
  "texbank.ts": "804ee06b5324e31ba191ac1c3e382bedd2861e9657a0f07da6b09b7a61267f0a",
};

/** One digest over {@link BUILDER_FILES}, in filename order. */
export const BUILDER_HASH = "55f51cfa51246f1b2b832c45b85db4786ac97927f48985efec1e959bbad734ae";
