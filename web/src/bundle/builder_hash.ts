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
  "bundle.ts": "e5ba591363ee18359cee24bcad48d8bcd751e042ffac287e79e3acbedee5df17",
  "bytes.ts": "59b2f363e98da56e88ada59458239032e40cad3a27342659e213d849c0967168",
  "cam.ts": "fe50200cb57c6578681a121766e7a5f4ed2425d91996169f83a82e8375dd63c3",
  "campaths.ts": "fbe28df3265d37b60a006e937a926eca8546609aa29cc5d80e7f1fc9afd639be",
  "characters.ts": "cac021d0099522b6d5d5fd0116f1dccf286c53a13e4f240f31ec23850f00ffbc",
  "charbuild.ts": "6c3b70d9e317b1831c287c5b119f60f56aaa78552c47257c51acc833377ea485",
  "charmotion.ts": "ff8ee2ae3fe5c9f0c41c6c389b8c864660e99cf79e741d46f7041852a476b825",
  "class14.ts": "e143aab15d3067812e27d18bdd8b35b4b6fc45d6091948c7b8920bf4350a512a",
  "class31.ts": "75b98d9764cd40de62b8f0eef507f48b834b920c8982e6772ad0d12cc2701adf",
  "class41_rows.ts": "0a96725bc8d11f6f7b0cb5d5d4a477a7aa2c333991133562df3a863f1eda58b5",
  "class42.ts": "4f1400a663e6dd158b008b7a567fb56d9918901a6c0908e3118fae4c4d0002d6",
  "coli.ts": "02fc9b735e70604a7c4af33ee0598d27ed21f84e1cb1ad7a98ad8433d6eac82a",
  "combat.ts": "8e15b0f7bc0471bd2694cf05d6ad845e46b03dae3abbc162d9355754a2288ab1",
  "container.ts": "11b185957d66a5123097e51aadb5ae66760d11f8c9f69a1c128c58c4045e3e40",
  "degraded.ts": "f53ceffd81c8182f0c5edde7e6f0c1bc7f62da1851ca23e351eda62a87fb9f2e",
  "evt.ts": "3115a01280203f2d46314f679856c06f57193e4084eb6e71410faf6611c6ea58",
  "exetab.ts": "b2b9bb72af6eb0acfd6dbf7a0e0e370eaaa87023564353df9cf562bfc5e9efb9",
  "game/boss_banner_records.ts": "1be8c2fe41dd39e9c2b638bbe4cb4e274fad9426261014bb358159d09300aaa5",
  "game/class12/state.ts": "6de91256d9e69c4b07d8969720517733a13c90a1f25f5bf4a8c929bd55df1c2d",
  "game/class13/state.ts": "661726e666e3415a1280e2aafee4d58ccf2cb1598ea6b5d1db21499a12aa076e",
  "game/class19/slots.ts": "38d0cfd41dc2700247a3de6f65a43301d1331df05ea2a79035f9facf38177d41",
  "game/class22/records.ts": "57874272e772536b9bdf7584b9e2ba3b6a337253cb4a645b3fe4aac188208d58",
  "game/class23/records.ts": "2d83661511c6b3b412986cd0a2d1d9a49784fdbcf862f65edb7feead201fe109",
  "game/class25/state.ts": "1008037aa3648e6065d3e369c672219d7526526413013f53a372afb37ecfaea9",
  "game/class26/state.ts": "e5bb09e2d1fbd50716e805bde68b9740d02b154f252cdb84265993a674553004",
  "game/class30/bonecels.ts": "3392ad3933ddf0e5951773cc492c850af53eeb62e5af592fe28bec2bdd7508b0",
  "game/class30/halved.ts": "6ded7bbc1e9fc4e3378988e25635d58323d8c3172ddcea6d1e6869e4c57a075c",
  "game/class41/type16_slots.ts": "c92f7bc4fc3bcb99dc940d3c9bdc8c26cf17beaa1e2675b1f6249ef6a37d3436",
  "game/class41/type17_slots.ts": "4acaab967d62ef0978c4535da4f92b5ae91b4423a0e45928c9efdf515d33262d",
  "game/class41/type29_slots.ts": "dd6377abc4da716079aa82015c65274545d6b56c7e3fee437624c96dc9c2670f",
  "game/class41/type37_slots.ts": "59b94a9739dbe883b1a69c6d3391b64fc6111361c9e237c1abc30d66cb251340",
  "game/class41/type47_slots.ts": "9d9a50f252f86cf02a74475bfc3f0f7040219cf25cb4b27ed9e9aa4a6b549648",
  "game/class41/water_slots.ts": "654c7b121971e16e7ecbca8fb3f2c265948c1fe82abd2ef009510b02ddec5235",
  "game/class44/slide_slots.ts": "737ace82df0382eadf0d8c51517928724a6261efc7abd8337c97e25e9f509996",
  "game/class45/tables.ts": "9c4cc0760b37ba37b4f88255ceb6c07d3540753b766400416f2624ec0bb2585c",
  "game/class53/records.ts": "b6800eb8234f8a37c11908ce38316f82b17387ae41e753aeb67089fae09192d0",
  "game/class61/state.ts": "10295909bed89c5b3fd208e8b7165eadd95c73fd5d14c14ad1519fa6f9527f6b",
  "game/hud_sprites.ts": "e555bf8acdd717eacc8c68069174e2469c2910eada2fbd5dad9b3af255b3df7a",
  "game/options_data.ts": "08bc44cec809f1d90aeec628b084dddec78f1b1637ce92b0cb937f25bfb7c546",
  "game/player_body_data.ts": "fede162206a80f7cea0b70fb3d415f71ab96e7df4f67d40f14c3c162bcd9d3f0",
  "gltf.ts": "95885b93afbfc15759d45e2ae7ae74a456db5f554e4141656450f9687336d3be",
  "io.ts": "4471bf8bfab1643c6395ae496bdb7d26678835b053b867544c69d0b4c1403df8",
  "lz.ts": "dddff2029ebd1cafc686d25b57da5e5ad8e22fdb2febf4af4988651d627aa80e",
  "mot.ts": "114f3ffa4e967dcdb69ea6919ec21b83d6ff9d1f6754d2a7f9e0fd1d3d1a3952",
  "nl1.ts": "c87a503b1b5b616ade85541b8a222652f93c83c0655da4b3cea6b211e3c321a6",
  "placement.ts": "da4d4501dc0d0a1d7e67db8e56aed9f600bf983a5ebb4e9dc28242e77cc1d939",
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
export const BUILDER_HASH = "bfa11031a0686fa259e5d9854e0949770e5ede80e9e0ac22b218744476c944c9";
