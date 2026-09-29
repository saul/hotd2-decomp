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
  "arcscript.ts": "7caad5bd4d03804b253c16c8beabccf0f3f1787485e6bbe553d8f32e0395719f",
  "bams.ts": "f03b1290866a63ab2ae764d49bd15c57bd53c6b1a03794f7a0357e8dd842eb8f",
  "bundle.ts": "6f3cf907a0f9497d79726b00298d9df9f3d89d29b01e801476d625797fc9fd3f",
  "bytes.ts": "59b2f363e98da56e88ada59458239032e40cad3a27342659e213d849c0967168",
  "cam.ts": "fe50200cb57c6578681a121766e7a5f4ed2425d91996169f83a82e8375dd63c3",
  "campaths.ts": "fbe28df3265d37b60a006e937a926eca8546609aa29cc5d80e7f1fc9afd639be",
  "characters.ts": "32c3328eea892c5af67ce535cdbb41946a4d4310447f86f824d4bcd5bf0f30ba",
  "charbuild.ts": "416611a1468ce0b1511c55205a153e3fbdcd47d0a514a1af2733c92572e260d9",
  "charmotion.ts": "ff8ee2ae3fe5c9f0c41c6c389b8c864660e99cf79e741d46f7041852a476b825",
  "class14.ts": "e143aab15d3067812e27d18bdd8b35b4b6fc45d6091948c7b8920bf4350a512a",
  "class31.ts": "75b98d9764cd40de62b8f0eef507f48b834b920c8982e6772ad0d12cc2701adf",
  "coli.ts": "02fc9b735e70604a7c4af33ee0598d27ed21f84e1cb1ad7a98ad8433d6eac82a",
  "combat.ts": "8e15b0f7bc0471bd2694cf05d6ad845e46b03dae3abbc162d9355754a2288ab1",
  "container.ts": "11b185957d66a5123097e51aadb5ae66760d11f8c9f69a1c128c58c4045e3e40",
  "degraded.ts": "f53ceffd81c8182f0c5edde7e6f0c1bc7f62da1851ca23e351eda62a87fb9f2e",
  "evt.ts": "3115a01280203f2d46314f679856c06f57193e4084eb6e71410faf6611c6ea58",
  "exetab.ts": "b2b9bb72af6eb0acfd6dbf7a0e0e370eaaa87023564353df9cf562bfc5e9efb9",
  "game/boss_banner_records.ts": "1be8c2fe41dd39e9c2b638bbe4cb4e274fad9426261014bb358159d09300aaa5",
  "game/class12/state.ts": "6de91256d9e69c4b07d8969720517733a13c90a1f25f5bf4a8c929bd55df1c2d",
  "game/class13/state.ts": "98688a6884168e5ddfd2a02570b3b9e2d247124d228e4bc797b4b6a6fb436c78",
  "game/class19/slots.ts": "38d0cfd41dc2700247a3de6f65a43301d1331df05ea2a79035f9facf38177d41",
  "game/class22/records.ts": "57874272e772536b9bdf7584b9e2ba3b6a337253cb4a645b3fe4aac188208d58",
  "game/class23/records.ts": "2d83661511c6b3b412986cd0a2d1d9a49784fdbcf862f65edb7feead201fe109",
  "game/class25/state.ts": "79e67a054d39c02a5e946f0e2f96e9c36d6f07d12c062fb5a0373dd1b532f68c",
  "game/class30/bonecels.ts": "3392ad3933ddf0e5951773cc492c850af53eeb62e5af592fe28bec2bdd7508b0",
  "game/class41/water_slots.ts": "654c7b121971e16e7ecbca8fb3f2c265948c1fe82abd2ef009510b02ddec5235",
  "game/class45/tables.ts": "9c4cc0760b37ba37b4f88255ceb6c07d3540753b766400416f2624ec0bb2585c",
  "game/class53/records.ts": "b6800eb8234f8a37c11908ce38316f82b17387ae41e753aeb67089fae09192d0",
  "game/class61/state.ts": "10295909bed89c5b3fd208e8b7165eadd95c73fd5d14c14ad1519fa6f9527f6b",
  "game/hud_sprites.ts": "e555bf8acdd717eacc8c68069174e2469c2910eada2fbd5dad9b3af255b3df7a",
  "game/options_data.ts": "08bc44cec809f1d90aeec628b084dddec78f1b1637ce92b0cb937f25bfb7c546",
  "game/player_body_data.ts": "fede162206a80f7cea0b70fb3d415f71ab96e7df4f67d40f14c3c162bcd9d3f0",
  "gltf.ts": "f3899b78cf94bb69f78921c573671b1c6defd3ec2eda28d7777b23c91937f94a",
  "io.ts": "4471bf8bfab1643c6395ae496bdb7d26678835b053b867544c69d0b4c1403df8",
  "lz.ts": "dddff2029ebd1cafc686d25b57da5e5ad8e22fdb2febf4af4988651d627aa80e",
  "mot.ts": "114f3ffa4e967dcdb69ea6919ec21b83d6ff9d1f6754d2a7f9e0fd1d3d1a3952",
  "nl1.ts": "c87a503b1b5b616ade85541b8a222652f93c83c0655da4b3cea6b211e3c321a6",
  "placement.ts": "d6039914c923c8c05537977136c72aaaeaacc87a96cd93f72ecfed9b569ec5b6",
  "png.ts": "326d5417b68475ad54b90e2a91a1f68ca3859d6ba044582928a13459b4afa50b",
  "props.ts": "d35390a2133ba2a01699b20cb3ca086b260eb540724137b3f22118b257adbed6",
  "rigs.ts": "fb13c2083f25a66399a1350bbb03e066c6bd3d69f390915df22416409475421e",
  "rigs_data.ts": "3a6b07c4a3a8ea89cbc8a0fba5cbd004e6033e0a4a615ce77816007692528989",
  "script.ts": "b173b0307a4b54d773ce52e5aedfb36414666c24c4d0ad3e8690c5fc4f60e3df",
  "sha256.ts": "7c01f5b843a50a7fc05e749c7a737c252482557ebc523eef7da0f46c7baa427c",
  "spawnres.ts": "fbe03f2ba99110a48502e6cfbcfec003cea329bdbb4bb8ad54ae7862ee404f3b",
  "stage.ts": "90b27680bd21c22cbe30616c55e5560a668818872f449f9e85892ae2ec43cb18",
  "texbank.ts": "804ee06b5324e31ba191ac1c3e382bedd2861e9657a0f07da6b09b7a61267f0a",
};

/** One digest over {@link BUILDER_FILES}, in filename order. */
export const BUILDER_HASH = "51ef5c8fd499614d4eadfaf05e43b34ebde68a333d699ec77424acdc3ddc10e4";
