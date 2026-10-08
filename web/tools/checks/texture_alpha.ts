/**
 * A texture's alpha is the bank's, as the exe's D3D path keeps it.
 *
 *     node tools/run_ts.mjs tools/checks/texture_alpha.ts --game-dir ~/"THE HOUSE OF THE DEAD 2"
 *
 * TSP bit 19, `IgnoreTexAlpha`, means "drop the texture's alpha" on PowerVR2,
 * and nothing in the PC port reads it that way: 101 translucent-pass meshes
 * set it and blend by their texture's alpha, among them the additive blades
 * of `zslman` and `zndina`. The exporter therefore writes every texture with
 * the bank's alpha. What this asserts:
 *
 *   * **The upload keeps the alpha.** `DecodeTextureToSurface` picks the
 *     surface's format from the bank entry through
 *     `g_pvr_pixfmt_texture_format` = {5, 2, 6, 8, 8, 8, 7, 0};
 *     `EnumTextureFormatsCallback` files the 16-bit 7C00/03E0/001F format in
 *     slot 5 only under `DDPF_ALPHAPIXELS` (slot 3 otherwise), and
 *     0F00/00F0/000F in slot 6. So ARGB1555 is uploaded as `A1R5G5B5` and
 *     ARGB4444 as the 4:4:4 format the device offers.
 *   * **The alpha reaches the alpha op.** `InitD3DDeviceAndTextureStages` sets
 *     stage 0's `ALPHAOP` `MODULATE`, `ALPHAARG1` `TEXTURE`, `ALPHAARG2`
 *     `DIFFUSE`, and `TranslatePvr2StateToD3D`'s mode switch only chooses
 *     `SELECTARG1` (mode 1) or `MODULATE`: texture alpha either way.
 *   * **Nothing else reads bit 19.** Over the D3D module (`0x004A4DA0` to
 *     `0x004ACD20`), swept by `lib_x86.ts`, the only instructions whose
 *     immediate is `0x80000`, `0x180000`, `0xFFF7FFFF` or `0xFFE7FFFF`, or
 *     that shift or bit-test by 19, are the two pass selectors --
 *     `TranslatePvr2StateToD3D`'s `ALPHATESTENABLE` and
 *     `WalkMeshChainAndDraw`'s pass -- and `DrawModelWithForcedAlphaBlend`'s
 *     mask `0x03FFFF7F` keeps the bit.
 *   * **The corpus.** Every textured mesh in `pol/` is drawn in the pass its
 *     list type names (so a glTF `alphaMode` from the pass is the list type a
 *     viewer expects); the only meshes that disagree are the untextured ones
 *     `gltf.ts` names. And the count of translucent-pass `IgnoreTexAlpha`
 *     meshes whose texture has alpha below 255 -- the meshes an alpha-stripped
 *     texture would change on screen -- is the number the code and the docs
 *     give.
 *   * **The damage overlay is drawn by its texture's alpha.**
 *     `DamageOverlayUpdateAndDraw` calls the plain `AssetDrawSlot` at
 *     `0x004173B5` and never `AssetDrawSlotWithAlpha`; every model
 *     `g_damage_overlay_slots` names is one translucent-pass `SRCALPHA /
 *     INVSRCALPHA` mesh at base alpha 1.0 whose ARGB4444 texture is alpha 0
 *     round the mark with 255 its commonest other value; and the port's
 *     `DAMAGE_OVERLAY_SLOTS`, imported, is the exe's table. That is the whole
 *     of why a hit's marks are opaque rather than translucent.
 *   * **The bundle**, when one written by this tree's `gltf.ts` is present:
 *     no image named `_opaque`; the images of `IgnoreTexAlpha` materials on
 *     ARGB textures carry the bank's alpha byte for byte (every
 *     translucent-pass one, and the first opaque-pass ones by name), as do
 *     the damage overlay's; and every stage primitive draws with a material
 *     whose base colour and culling are its own mesh's. Without such a bundle
 *     that part is reported as not run (a stale one warns, L24); the rest
 *     still asserts.
 *
 * `pol/pol_<name>.bin` files that are byte-identical copies of `<name>.bin`
 * are counted once.
 *
 * Exit 0 when it asserted things and they held, 1 when one did not, 3 with no
 * `--game-dir`.
 */
import { inflateSync } from "node:zlib";

import { Checker, gameDirOrSkip, hex, openGame } from "../lib/exe_check";
import type { NodeAssetSource } from "../lib/node_io";
import {
  at, bundleDir, bundleIsCurrent, bytesAt, checkSequences, contains, polFiles,
  range, readGlb, stageGlbs, toHex, type Sequence,
} from "./lib_d3d";
import { sweep } from "./lib_x86";
import { equal } from "../../src/hod2lib/bytes";
import * as C from "../../src/hod2lib/container";
import type { ExeTables } from "../../src/hod2lib/exetab";
import { LZError } from "../../src/hod2lib/lz";
import * as nl1 from "../../src/hod2lib/nl1";
import * as texbank from "../../src/hod2lib/texbank";
import { DAMAGE_OVERLAY_SLOTS } from "../../src/game/effects/damage_overlay";

const G_PVR_PIXFMT_TEXTURE_FORMAT = 0x00571250;
/** `DecodeTextureToSurface`'s body, where the table above must be named. */
const DECODE_TEXTURE: readonly [number, number] = [0x004ac270, 0x004ac980];
/**
 * The D3D module the bit-19 scan covers: `InitD3DDeviceAndTextureStages` to
 * `SubmitScreenSpriteQuad`.
 */
const D3D_MODULE: readonly [number, number] = [0x004a4da0, 0x004acd20];
/** Instruction sequences, each read off the listing. */
const SEQUENCES: readonly Sequence[] = [
  [0x004a5cd0, "f6c301b9080000008bf07412bf70ec7d00",
   "EnumTextureFormatsCallback: TEST BL, 1 (DDPF_ALPHAPIXELS); JZ; "
   + "MOV EDI, 0x007DEC70 -- slot 5 only with alpha"],
  [0x004a5cee, "bf30ec7d00",
   "EnumTextureFormatsCallback: MOV EDI, 0x007DEC30 -- slot 3 without"],
  [0x004a5d00, "81fa000f0000751b81fef0000000751383ff0f750e"
   + "b9080000008bf0bf90ec7d00",
   "EnumTextureFormatsCallback: 0F00/00F0/000F -> MOV EDI, 0x007DEC90, slot 6"],
  [0x004a4f48, "6a046a016a00",
   "InitD3DDeviceAndTextureStages: stage 0 COLOROP (1) = MODULATE (4)"],
  [0x004a4f84, "6a046a046a00",
   "InitD3DDeviceAndTextureStages: stage 0 ALPHAOP (4) = MODULATE (4)"],
  [0x004a4f98, "6a026a056a00",
   "InitD3DDeviceAndTextureStages: stage 0 ALPHAARG1 (5) = TEXTURE (2)"],
  [0x004a4fac, "6a006a066a00",
   "InitD3DDeviceAndTextureStages: stage 0 ALPHAARG2 (6) = DIFFUSE (0)"],
  [0x004a7928, "6a02",
   "TranslatePvr2StateToD3D: mode 1's ALPHAOP value, SELECTARG1 (2)"],
  [0x004a7947, "6a048b106a046a00",
   "TranslatePvr2StateToD3D: other modes' ALPHAOP value MODULATE (4), "
   + "then the shared PUSH 4 (ALPHAOP); PUSH 0 (stage 0)"],
  [0x004a863b, "257fffff03",
   "DrawModelWithForcedAlphaBlend: AND EAX, 0x03FFFF7F (keeps bits 19-20)"],
  [0x004a8645, "0d80000094",
   "DrawModelWithForcedAlphaBlend: OR EAX, 0x94000080 (bit 7: MODULATE)"],
];
/** `TranslatePvr2StateToD3D`'s shading-mode jump table: mode 1 alone differs. */
const MODE_TABLE = 0x004a79c8;
const MODE_TARGETS = [0x004a792e, 0x004a790f, 0x004a792e, 0x004a792e];
/** The only readers of the pass pair in the D3D module. */
const PASS_READERS = new Map<number, string>([
  [0x004a784b, "TranslatePvr2StateToD3D TEST EBX, 0x180000 (changed?)"],
  [0x004a785b, "TranslatePvr2StateToD3D AND EDX, 0x180000"],
  [0x004a7865, "TranslatePvr2StateToD3D CMP EDX, 0x80000"],
  [0x004a7f6c, "WalkMeshChainAndDraw AND EAX, 0x180000"],
  [0x004a7f71, "WalkMeshChainAndDraw CMP EAX, 0x80000"],
]);
const BIT19_IMMEDIATES = new Set([0x80000, 0x180000, 0xfff7ffff, 0xffe7ffff]);
const BIT19_SHIFTS = new Set(["shr", "sar", "shl", "rol", "ror", "bt", "btr", "bts"]);
/** What `gltf.ts` says of the list type against the pass. */
const UNTEXTURED_LIST2_OPAQUE: Readonly<Record<string, number>> = { zndina: 4, zslman: 1 };
/** Translucent-pass `IgnoreTexAlpha` meshes on a texture with alpha below 255. */
const STRIPPED_AND_USED = 101;
/** How many opaque-pass `IgnoreTexAlpha` ARGB images to compare, per stage. */
const OPAQUE_SAMPLE = 12;
/** `g_damage_overlay_slots` -- `s32[11][2]`, `[kind][players - 1]`. */
const G_DAMAGE_OVERLAY_SLOTS = 0x00579f80;
const DAMAGE_OVERLAY_KINDS = 11;
/** `DamageOverlayUpdateAndDraw`'s body, and its one draw: `CALL AssetDrawSlot`. */
const DAMAGE_OVERLAY_DRAW: readonly [number, number] = [0x00417300, 0x0041743f];
const DAMAGE_OVERLAY_CALL = 0x004173b5;
const ASSET_DRAW_SLOT = 0x00418560;
const ASSET_DRAW_SLOT_WITH_ALPHA = 0x004185a0;

/** Pixel formats with an alpha channel: ARGB1555 and ARGB4444. */
const ARGB_FORMATS = new Set([0, 2]);
const ARGB4444 = 2;

type Bank = texbank.Bank | null;

/**
 * The `tex/` bank paired with a `pol/` file, or null: the exe's descriptor
 * table over the bank's bytes, and nothing when the table does not list it.
 */
async function bankFor(source: NodeAssetSource, exe: ExeTables, stem: string): Promise<Bank> {
  const tex = `tex/${stem}.bin`;
  if (!stem || !await source.exists(tex)) return null;
  const raw = await source.read(tex);
  const tc = C.load(raw);
  const data = tc.kind === C.COMPRESSED ? tc.data : raw;
  const entries = exe.entries(stem);
  return entries.length ? texbank.bankFromExe(data, entries) : null;
}

/** Every fourth byte from the fourth: the alpha plane of RGBA8888. */
function alphaPlane(rgba: Uint8Array): Uint8Array {
  const out = new Uint8Array(rgba.length >> 2);
  for (let i = 0; i < out.length; i++) out[i] = rgba[i * 4 + 3];
  return out;
}

/** The least alpha byte of an RGBA8888 image. */
function minAlpha(rgba: Uint8Array): number {
  let m = 255;
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] < m) m = rgba[i];
  return m;
}

/** Parse a `pol/` file, or null when it is not a model container. */
async function parsePol(source: NodeAssetSource, name: string): Promise<nl1.Model[] | null> {
  try {
    return nl1.parseContainer(C.load(await source.read(`pol/${name}`)));
  } catch (exc) {
    // not-a-loss: not every file in pol/ is a model container; the mesh count
    // the corpus asserts is what says the walk saw the whole of it.
    if (exc instanceof nl1.NL1Error || exc instanceof LZError
        || exc instanceof RangeError) return null;
    throw exc;
  }
}

/** `pol/*.bin`, a `pol_<name>` copy of `<name>` counted once. */
async function uniquePol(source: NodeAssetSource): Promise<string[]> {
  const names = await polFiles(source);
  const have = new Set(names);
  const out: string[] = [];
  for (const n of names) {
    const twin = n.startsWith("pol_") ? n.slice(4) : null;
    if (twin && have.has(twin)
        && equal(await source.read(`pol/${n}`), await source.read(`pol/${twin}`))) continue;
    out.push(n);
  }
  return out;
}

function scanBit19(chk: Checker, exe: ExeTables): void {
  const [lo, hi] = D3D_MODULE;
  const insns = sweep(range(exe, lo, hi), lo);
  const hits = new Map<number, string>();
  for (const ins of insns) {
    const shift19 = BIT19_SHIFTS.has(ins.mnemonic) && ins.imms.includes(19);
    if (shift19 || ins.imms.some((v) => BIT19_IMMEDIATES.has(v))) {
      hits.set(ins.address, `${ins.mnemonic || "insn"} [${ins.imms.map((v) => hex(v)).join(", ")}]`);
    }
  }
  chk.ok(insns.length > 5000,
         `${insns.length} instructions decoded in ${hex(lo, 8)}..${hex(hi, 8)} (more than 5000)`);
  const extra = [...hits].filter(([a]) => !PASS_READERS.has(a));
  const missing = [...PASS_READERS.keys()].filter((a) => !hits.has(a));
  chk.ok(!extra.length && !missing.length,
         `bit 19 is read in the D3D module only by the ${PASS_READERS.size} pass-selector`
         + ` instructions (${hits.size} hits)`
         + (extra.length ? `; outside them: ${extra.map(([a, t]) => `${hex(a, 8)} ${t}`).join(", ")}` : "")
         + (missing.length ? `; missing: ${missing.map((a) => hex(a, 8)).join(", ")}` : ""));
}

/** The key a mesh and a glTF primitive share: the part and the header sphere. */
function sphereKey(part: string, sphere: readonly number[]): string {
  return [part, ...sphere.map(String)].join("\u0000");
}

/**
 * A material as the bundle carries it: base colour RGBA and culling, and the
 * rest of the `SetMaterial` -- the ambient scale, the specular colour and its
 * power (`extras.pvr2.tex_ambient`, `specular`, `specular_power`).
 */
function materialKey(rgba: readonly number[], doubleSided: boolean,
                     amb: unknown, spec: unknown, power: unknown): string {
  return `${rgba.map(String).join(",")}|${doubleSided}`
    + `|${String(amb)}|${String(spec)}|${String(power)}`;
}

/**
 * The corpus premises; returns the materials the meshes of each
 * `(pol stem, header sphere)` own, for the bundle to be held to.
 */
async function corpus(chk: Checker, source: NodeAssetSource,
                      exe: ExeTables): Promise<Map<string, Set<string>>> {
  let texturedDisagree = 0, used = 0, argbItaTrn = 0, meshes = 0;
  const untextured = new Map<string, number>();
  const own = new Map<string, Set<string>>();
  for (const file of await uniquePol(source)) {
    const models = await parsePol(source, file);
    if (!models) continue;
    const stem = file.slice(0, -4);
    let bank: Bank | undefined;
    const cache = new Map<number, number | null>();
    for (const m of models) {
      for (const me of m.meshes) {
        meshes++;
        const [a, r, g, b] = me.baseColour;
        const key = sphereKey(stem, [...me.centroid, me.radius]);
        let set = own.get(key);
        if (!set) own.set(key, set = new Set());
        set.add(materialKey([r, g, b, a].map((v) => Math.min(Math.max(v, 0.0), 1.0)),
                            me.doubleSided, me.texAmbient, me.specularColour,
                            me.specularPower));
        if ((me.listType === 0) !== me.opaquePass) {
          if (me.textured) texturedDisagree++;
          else untextured.set(stem, (untextured.get(stem) ?? 0) + 1);
        }
        if (me.textured && !me.opaquePass && me.ignoreTextureAlpha
            && ARGB_FORMATS.has(me.pixelFormat)) {
          argbItaTrn++;
          if (bank === undefined) bank = await bankFor(source, exe, stem);
          if (!cache.has(me.textureId)) {
            const got = bank ? texbank.bankDecode(bank, me.textureId) : null;
            cache.set(me.textureId, got ? minAlpha(got.pixels) : null);
          }
          const amin = cache.get(me.textureId);
          if (amin !== null && amin !== undefined && amin < 255) used++;
        }
      }
    }
  }
  const untexturedStr = JSON.stringify(Object.fromEntries([...untextured].sort()));
  const expectStr = JSON.stringify(Object.fromEntries(Object.entries(UNTEXTURED_LIST2_OPAQUE).sort()));
  chk.ok(meshes > 40000, `${meshes} meshes parsed from pol/, pol_ copies counted once (more than 40000)`);
  chk.eq(texturedDisagree, 0, "textured meshes drawn in a pass their list type does not name");
  chk.ok(untexturedStr === expectStr,
         `the untextured meshes whose list type is not their pass are ${untexturedStr},`
         + ` and gltf.ts names ${expectStr}`);
  chk.eq(used, STRIPPED_AND_USED,
         `translucent-pass IgnoreTexAlpha meshes that blend by a texture alpha below 255`
         + ` (of ${argbItaTrn} on ARGB textures), the number the code and the docs give`);
  return own;
}

/**
 * What a hit puts on the screen is opaque where the mark is.
 *
 * `DamageOverlayUpdateAndDraw` draws its model with the plain `AssetDrawSlot`,
 * which hands it no alpha, so the opacity on screen is the model's own: its
 * pass, its alpha op, its base alpha and its texture's alpha. Each of those is
 * asserted here for every model the overlay's slot table names, and the port's
 * copy of that table is held to the exe's. Returns the bundle image names
 * whose alpha must be the bank's.
 */
async function damageOverlay(chk: Checker, source: NodeAssetSource,
                             exe: ExeTables): Promise<Set<string>> {
  const call = bytesAt(exe, DAMAGE_OVERLAY_CALL, 5);
  const rel = (b: Uint8Array, i: number): number =>
    new DataView(b.buffer, b.byteOffset, b.byteLength).getInt32(i, true);
  const target = (DAMAGE_OVERLAY_CALL + 5 + rel(call, 1)) >>> 0;
  chk.ok(call[0] === 0xe8 && target === ASSET_DRAW_SLOT,
         `${hex(DAMAGE_OVERLAY_CALL, 8)} is CALL AssetDrawSlot (${toHex(call)})`);
  const [lo, hi] = DAMAGE_OVERLAY_DRAW;
  const body = range(exe, lo, hi);
  const faded: number[] = [];
  for (let i = 0; i < body.length - 4; i++) {
    if (body[i] === 0xe8 && ((lo + i + 5 + rel(body, i + 1)) >>> 0) === ASSET_DRAW_SLOT_WITH_ALPHA) {
      faded.push(lo + i);
    }
  }
  chk.ok(!faded.length, "DamageOverlayUpdateAndDraw never calls AssetDrawSlotWithAlpha"
         + (faded.length ? `: it does at ${faded.map((a) => hex(a, 8)).join(", ")}` : ""));

  const tb = bytesAt(exe, G_DAMAGE_OVERLAY_SLOTS, DAMAGE_OVERLAY_KINDS * 8);
  const table = Array.from({ length: DAMAGE_OVERLAY_KINDS * 2 }, (_, i) => rel(tb, i * 4));
  const port = DAMAGE_OVERLAY_SLOTS.flat();
  chk.ok(port.length === table.length && port.every((v, i) => v === table[i]),
         `the port's DAMAGE_OVERLAY_SLOTS is g_damage_overlay_slots`
         + ` [${table.map((v) => hex(v)).join(", ")}]`
         + (port.join() === table.join() ? "" : `; port [${port.map((v) => hex(v)).join(", ")}]`));

  const where = exe.assetSlots();
  const models = new Map<string, nl1.Model[]>();
  const banks = new Map<string, Bank>();
  const images = new Set<string>();
  const slots = [...new Set(table)].sort((a, b) => a - b);
  let seen = 0;
  for (const slot of slots) {
    const [file, k] = where.get(slot) ?? ["", -1];
    const name = file.endsWith(".bin") ? file.slice(0, -4) : file;
    if (!models.has(name)) {
      models.set(name, name ? nl1.parseContainer(C.load(await source.read(`pol/${file}`))) : []);
      banks.set(name, name ? await bankFor(source, exe, name) : null);
    }
    const list = models.get(name)!;
    const m = k >= 0 && k < list.length ? list[k] : null;
    if (!m || m.meshes.length !== 1) {
      chk.fail(`slot ${hex(slot)} is not one mesh (${name}[${k}])`);
      continue;
    }
    const me = m.meshes[0];
    seen++;
    const what = `slot ${hex(slot)} (${name}[${k}])`;
    chk.ok(!me.opaquePass && (me.tsp >>> 29) === 4 && ((me.tsp >>> 26) & 7) === 5,
           `${what}: TSP ${hex(me.tsp, 8)} is the translucent pass with SRCALPHA / INVSRCALPHA`);
    // Mode 1 would be SELECTARG1 -- still the texel's alpha, but the reading
    // below is of MODULATE, so say so if it ever is not.
    chk.ok(((me.tsp >>> 6) & 3) !== 1 && me.baseColour[0] === 1.0,
           `${what}: shading mode ${(me.tsp >>> 6) & 3}, base alpha ${me.baseColour[0]}`
           + " -- texel alpha x 1.0");
    const bank = banks.get(name) ?? null;
    const got = bank ? texbank.bankDecode(bank, me.textureId) : null;
    if (!got || me.pixelFormat !== ARGB4444) {
      chk.fail(`${what}: texture ${me.textureId} is not an ARGB4444 texture of the bank`);
      continue;
    }
    const hist = new Map<number, number>();
    for (const a of alphaPlane(got.pixels)) hist.set(a, (hist.get(a) ?? 0) + 1);
    let common = -1, commonN = 0;
    for (const [a, n] of hist) if (a && n > commonN) [common, commonN] = [a, n];
    chk.ok((hist.get(0) ?? 0) > 0 && common === 255,
           `${what}: texture ${me.textureId}'s alpha is 0 round the mark (${hist.get(0) ?? 0}`
           + ` texels) and 255 its commonest other value (${common}: ${commonN})`);
    images.add(`${name}/tex_${String(me.textureId).padStart(3, "0")}`);
  }
  chk.eq(seen, slots.length, "overlay models read, one per slot g_damage_overlay_slots names");
  return images;
}

/** `[w, h, alpha bytes]` of the exporter's PNG: RGBA8, filter 0 rows. */
function pngAlpha(png: Uint8Array): [number, number, Uint8Array] {
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let p = 8, w = 0, h = 0;
  const idat: Uint8Array[] = [];
  while (p < png.length) {
    const len = dv.getUint32(p);
    const tag = String.fromCharCode(...png.subarray(p + 4, p + 8));
    const body = png.subarray(p + 8, p + 8 + len);
    if (tag === "IHDR") {
      w = dv.getUint32(p + 8);
      h = dv.getUint32(p + 12);
    } else if (tag === "IDAT") {
      idat.push(body);
    }
    p += 12 + len;
  }
  const raw = new Uint8Array(inflateSync(Buffer.concat(idat)));
  const stride = w * 4 + 1;
  const alpha = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) alpha[y * w + x] = raw[y * stride + 1 + x * 4 + 3];
  }
  return [w, h, alpha];
}

async function bundle(chk: Checker, source: NodeAssetSource, exe: ExeTables,
                      own: Map<string, Set<string>>, must: Set<string>): Promise<void> {
  const bd = bundleDir();
  if (bd === null) {
    chk.note("bundle: none found -- the images were NOT checked (export one, or set HOTD2_BUNDLE)");
    return;
  }
  if (!bundleIsCurrent(bd)) {
    chk.note(`bundle: ${bd} was written by a different gltf.ts than this tree's`
             + " -- the images were NOT checked; re-export it");
    return;
  }
  const banks = new Map<string, Bank>();
  let images = 0, opaqueNamed = 0, compared = 0, mismatched = 0, prims = 0, wrongMat = 0;
  const namedSeen = new Set<string>();
  for (const path of stageGlbs(bd)) {
    const { doc, bin } = readGlb(path);
    const file = path.slice(path.lastIndexOf("/") + 1);
    // Every model primitive draws with its own mesh's material: the base
    // colour, ambient scale and specular WalkMeshChainAndDraw hands
    // SetMaterial, and the culling. A
    // primitive is found by its part and the mesh header's sphere, which it
    // carries as `hod2_sphere` -- node names number a filtered model list in
    // the rigs, and a chain index skips empty meshes -- and it must hold one
    // of the materials the meshes with that sphere own.
    const mats = doc.materials ?? [];
    for (const node of doc.nodes ?? []) {
      const name = node.name ?? "";
      const cut = name.lastIndexOf("_model_");
      if (cut < 0 || node.mesh === undefined) continue;
      const part = name.slice(0, cut);
      for (const pr of doc.meshes![node.mesh].primitives) {
        const sphere = pr.extras?.hod2_sphere;
        const want = Array.isArray(sphere) && sphere.length
          ? own.get(sphereKey(part, sphere as number[])) : undefined;
        if (!want || pr.material === undefined) continue;
        const mat = mats[pr.material];
        const pv = mat.extras?.pvr2 ?? {};
        const got = materialKey(mat.pbrMetallicRoughness!.baseColorFactor!, mat.doubleSided ?? false,
                                pv.tex_ambient, pv.specular, pv.specular_power);
        prims++;
        if (!want.has(got)) {
          wrongMat++;
          if (wrongMat <= 3) {
            chk.note(`${file} ${name}: material ${got}, the mesh's own ${[...want].sort().join(" ; ")}`);
          }
        }
      }
    }
    const imgs = doc.images ?? [];
    images += imgs.length;
    opaqueNamed += imgs.filter((im) => (im.name || im.uri || "").includes("_opaque")).length;
    // Images drawn by an IgnoreTexAlpha material on an ARGB texture.
    const want = new Map<number, boolean>();        // image -> translucent pass?
    for (const mat of mats) {
      const pv = mat.extras?.pvr2 ?? {};
      const tex = mat.pbrMetallicRoughness?.baseColorTexture;
      if (!tex || !pv.ignore_texture_alpha
          || (pv.pixel_format !== "ARGB1555" && pv.pixel_format !== "ARGB4444")) continue;
      const img = doc.textures![tex.index].source;
      want.set(img, (want.get(img) ?? false) || mat.alphaMode === "BLEND");
    }
    const opaque = [...want].filter(([, t]) => !t).map(([i]) => i)
      .sort((a, b) => cmp(imgs[a].name ?? "", imgs[b].name ?? ""))
      .slice(0, OPAQUE_SAMPLE);
    // ...and the images a caller names outright: the damage overlay's.
    const named = imgs.flatMap((im, i) => (im.name !== undefined && must.has(im.name) ? [i] : []));
    for (const i of named) namedSeen.add(imgs[i].name!);
    const pick = new Set([...[...want].filter(([, t]) => t).map(([i]) => i), ...opaque, ...named]);
    for (const i of [...pick].sort((a, b) => a - b)) {
      const name = imgs[i].name ?? "";
      const slash = name.lastIndexOf("/");
      const part = slash < 0 ? "" : name.slice(0, slash);
      const texName = name.slice(slash + 1);
      if (!texName.startsWith("tex_")) continue;
      if (!banks.has(part)) banks.set(part, await bankFor(source, exe, part));
      const bank = banks.get(part) ?? null;
      // `tex_NNN`, or an alpha-stripped `tex_NNN_opaque`, which is then
      // compared too and differs.
      const got = bank ? texbank.bankDecode(bank, parseInt(texName.slice(4).split("_")[0], 10)) : null;
      if (!got) continue;
      const view = doc.bufferViews![imgs[i].bufferView!];
      const off = view.byteOffset ?? 0;
      const [w, h, alpha] = pngAlpha(bin.subarray(off, off + view.byteLength));
      compared++;
      if (w !== got.width || h !== got.height || !equal(alpha, alphaPlane(got.pixels))) {
        mismatched++;
        if (mismatched <= 5) chk.note(`${file} ${name}: alpha differs from the bank's`);
      }
    }
  }
  const missingNamed = [...must].filter((n) => !namedSeen.has(n)).sort();
  chk.ok(images > 0, `${images} images in ${bd}`);
  chk.eq(opaqueNamed, 0, "alpha-stripped `_opaque` images in the bundle");
  chk.ok(compared > 0, `${compared} IgnoreTexAlpha ARGB and damage-overlay images compared against the bank`);
  chk.ok(!missingNamed.length && namedSeen.size === must.size,
         "every damage overlay image is in a stage bundle"
         + (missingNamed.length ? `; missing ${missingNamed.join(", ")}` : ""));
  chk.eq(mismatched, 0, `images whose alpha differs from the bank's, of ${compared}`);
  chk.ok(prims > 10000, `${prims} stage primitives matched a mesh (more than 10000)`);
  chk.eq(wrongMat, 0, `stage primitives drawing with another mesh's material or culling, of ${prims}`);
}

/** Code-point order, as a sort of `str` keys has it. */
function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

async function main(): Promise<void> {
  const dir = gameDirOrSkip("texture_alpha");
  const { source, exe } = await openGame(dir);
  const chk = new Checker("texture_alpha");

  const tb = bytesAt(exe, G_PVR_PIXFMT_TEXTURE_FORMAT, 32);
  const tdv = new DataView(tb.buffer, tb.byteOffset, 32);
  const table = Array.from({ length: 8 }, (_, i) => tdv.getUint32(i * 4, true));
  chk.ok(table.join() === [5, 2, 6, 8, 8, 8, 7, 0].join(),
         `g_pvr_pixfmt_texture_format is [${table.join(", ")}]: ARGB1555 -> slot ${table[0]}`
         + ` (A1R5G5B5, DDPF_ALPHAPIXELS), RGB565 -> ${table[1]}, ARGB4444 -> ${table[2]}`);
  const ref = new Uint8Array(4);
  new DataView(ref.buffer).setUint32(0, G_PVR_PIXFMT_TEXTURE_FORMAT, true);
  chk.ok(contains(range(exe, DECODE_TEXTURE[0], DECODE_TEXTURE[1]), ref),
         "DecodeTextureToSurface names g_pvr_pixfmt_texture_format");
  checkSequences(chk, exe, SEQUENCES);
  const mb = exe.data.subarray(at(exe, MODE_TABLE), at(exe, MODE_TABLE) + 16);
  const mdv = new DataView(mb.buffer, mb.byteOffset, 16);
  const modes = Array.from({ length: 4 }, (_, i) => mdv.getUint32(i * 4, true));
  chk.ok(modes.join() === MODE_TARGETS.join(),
         `the shading-mode table at ${hex(MODE_TABLE, 8)} is`
         + ` [${modes.map((t) => hex(t, 8)).join(", ")}]: mode 1 alone differs`);

  scanBit19(chk, exe);
  const own = await corpus(chk, source, exe);
  const overlay = await damageOverlay(chk, source, exe);
  await bundle(chk, source, exe, own, overlay);

  chk.finish();
}

await main();
