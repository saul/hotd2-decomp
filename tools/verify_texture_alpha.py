#!/usr/bin/env python3
"""Check that a texture's alpha is the bank's, as the EXE's D3D path keeps it.

The exporter used to write an alpha-stripped copy of every texture a mesh with
TSP bit 19, `IgnoreTexAlpha`, drew -- the PowerVR2 meaning of the bit -- and
nothing in the PC port reads the bit that way. 101 translucent-pass meshes set
it and blend by their texture's alpha, among them the additive blades of
`zslman` and `zndina`, which the player drew as solid bars. What this asserts:

  * **The upload keeps the alpha.** `DecodeTextureToSurface` picks the
    surface's format from the bank entry through `g_pvr_pixfmt_texture_format`
    = {5, 2, 6, 8, 8, 8, 7, 0}; `EnumTextureFormatsCallback` files the 16-bit
    7C00/03E0/001F format in slot 5 only under `DDPF_ALPHAPIXELS` (slot 3
    otherwise), and 0F00/00F0/000F in slot 6. So ARGB1555 is uploaded as
    `A1R5G5B5` and ARGB4444 as the 4:4:4 format the device offers.
  * **The alpha reaches the alpha op.** `InitD3DDeviceAndTextureStages` sets
    stage 0's `ALPHAOP` `MODULATE`, `ALPHAARG1` `TEXTURE`, `ALPHAARG2`
    `DIFFUSE`, and `TranslatePvr2StateToD3D`'s mode switch only chooses
    `SELECTARG1` (mode 1) or `MODULATE`: texture alpha either way.
  * **Nothing else reads bit 19.** Over the D3D module (`0x004A4DA0` to
    `0x004ACD20`) the only instructions whose immediate is `0x80000`,
    `0x180000`, `0xFFF7FFFF` or `0xFFE7FFFF`, or that shift or bit-test by 19,
    are the two pass selectors -- `TranslatePvr2StateToD3D`'s
    `ALPHATESTENABLE` and `WalkMeshChainAndDraw`'s pass -- and
    `DrawModelWithForcedAlphaBlend`'s mask `0x03FFFF7F` keeps the bit.
  * **The corpus.** Every textured mesh in `pol/` is drawn in the pass its
    list type names (so a glTF `alphaMode` from the pass is the list type a
    viewer expects); the only meshes that disagree are the untextured ones
    `gltf.ts` names. And the count of translucent-pass `IgnoreTexAlpha`
    meshes whose texture has alpha below 255 -- the meshes the stripping
    changed on screen -- is the number the code and the docs give.
  * **The damage overlay is drawn by its texture's alpha.**
    `DamageOverlayUpdateAndDraw` calls the plain `AssetDrawSlot` at
    `0x004173B5` and never `AssetDrawSlotWithAlpha`; every model
    `g_damage_overlay_slots` names is one translucent-pass `SRCALPHA /
    INVSRCALPHA` mesh at base alpha 1.0 whose ARGB4444 texture is alpha 0
    round the mark with 255 its commonest other value; and the port's copy of
    the slot table is the exe's. That is the whole of why a hit's marks are
    opaque rather than translucent.
  * **The bundle**, when one written by this tree's `gltf.ts` is present: no
    image named `_opaque`, and the images of `IgnoreTexAlpha` materials on
    ARGB textures carry the bank's alpha byte for byte (every translucent-pass
    one, and the first opaque-pass ones by name), as do the damage overlay's.

`pol/pol_<name>.bin` files that are byte-identical copies of `<name>.bin` are
counted once.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import struct
import sys
import zlib
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from hod2lib import container, nl1, stage  # noqa: E402
from hod2lib.exetab import ExeTables  # noqa: E402
from hod2lib.lz import LZError  # noqa: E402
from verify_draw_order import (  # noqa: E402
    Failures, builder_digest, bundle_dir, tree_digest,
)

G_PVR_PIXFMT_TEXTURE_FORMAT = 0x00571250
#: DecodeTextureToSurface's body, where the table above must be named.
DECODE_TEXTURE = (0x004AC270, 0x004AC980)
#: The D3D module the bit-19 scan covers: InitD3DDeviceAndTextureStages to
#: SubmitScreenSpriteQuad.
D3D_MODULE = (0x004A4DA0, 0x004ACD20)
#: `(address, bytes, what)`, each read off the listing.
SEQUENCES = [
    (0x004A5CD0, "f6c301b9080000008bf07412bf70ec7d00",
     "EnumTextureFormatsCallback: TEST BL, 1 (DDPF_ALPHAPIXELS); JZ; "
     "MOV EDI, 0x007DEC70 -- slot 5 only with alpha"),
    (0x004A5CEE, "bf30ec7d00",
     "EnumTextureFormatsCallback: MOV EDI, 0x007DEC30 -- slot 3 without"),
    (0x004A5D00, "81fa000f0000751b81fef0000000751383ff0f750e"
                 "b9080000008bf0bf90ec7d00",
     "EnumTextureFormatsCallback: 0F00/00F0/000F -> MOV EDI, 0x007DEC90, "
     "slot 6"),
    (0x004A4F48, "6a046a016a00",
     "InitD3DDeviceAndTextureStages: stage 0 COLOROP (1) = MODULATE (4)"),
    (0x004A4F84, "6a046a046a00",
     "InitD3DDeviceAndTextureStages: stage 0 ALPHAOP (4) = MODULATE (4)"),
    (0x004A4F98, "6a026a056a00",
     "InitD3DDeviceAndTextureStages: stage 0 ALPHAARG1 (5) = TEXTURE (2)"),
    (0x004A4FAC, "6a006a066a00",
     "InitD3DDeviceAndTextureStages: stage 0 ALPHAARG2 (6) = DIFFUSE (0)"),
    (0x004A7928, "6a02",
     "TranslatePvr2StateToD3D: mode 1's ALPHAOP value, SELECTARG1 (2)"),
    (0x004A7947, "6a048b106a046a00",
     "TranslatePvr2StateToD3D: other modes' ALPHAOP value MODULATE (4), "
     "then the shared PUSH 4 (ALPHAOP); PUSH 0 (stage 0)"),
    (0x004A863B, "257fffff03",
     "DrawModelWithForcedAlphaBlend: AND EAX, 0x03FFFF7F (keeps bits 19-20)"),
    (0x004A8645, "0d80000094",
     "DrawModelWithForcedAlphaBlend: OR EAX, 0x94000080 (bit 7: MODULATE)"),
]
#: `TranslatePvr2StateToD3D`'s shading-mode jump table: mode 1 alone differs.
MODE_TABLE = (0x004A79C8, [0x004A792E, 0x004A790F, 0x004A792E, 0x004A792E])
#: The only readers of the pass pair in the D3D module.
PASS_READERS = {
    0x004A784B: "TranslatePvr2StateToD3D TEST EBX, 0x180000 (changed?)",
    0x004A785B: "TranslatePvr2StateToD3D AND EDX, 0x180000",
    0x004A7865: "TranslatePvr2StateToD3D CMP EDX, 0x80000",
    0x004A7F6C: "WalkMeshChainAndDraw AND EAX, 0x180000",
    0x004A7F71: "WalkMeshChainAndDraw CMP EAX, 0x80000",
}
BIT19_IMMEDIATES = {0x80000, 0x180000, 0xFFF7FFFF, 0xFFE7FFFF}
#: What gltf.ts and gltf.py say of the list type against the pass.
UNTEXTURED_LIST2_OPAQUE = {"zndina": 4, "zslman": 1}
#: Translucent-pass `IgnoreTexAlpha` meshes on a texture with alpha below 255.
STRIPPED_AND_USED = 101
#: How many opaque-pass `IgnoreTexAlpha` ARGB images to compare, per stage.
OPAQUE_SAMPLE = 12
#: `g_damage_overlay_slots` -- `s32[11][2]`, `[kind][players - 1]`.
G_DAMAGE_OVERLAY_SLOTS = 0x00579F80
DAMAGE_OVERLAY_KINDS = 11
#: `DamageOverlayUpdateAndDraw`'s body, and its one draw: `CALL AssetDrawSlot`.
DAMAGE_OVERLAY_DRAW = (0x00417300, 0x0041743F)
DAMAGE_OVERLAY_CALL = 0x004173B5
ASSET_DRAW_SLOT = 0x00418560
ASSET_DRAW_SLOT_WITH_ALPHA = 0x004185A0
#: The port's copy of the slot table.
PORT_DAMAGE_OVERLAY = (Path(__file__).resolve().parent.parent / "web" / "src"
                       / "game" / "effects" / "damage_overlay.ts")


def unique_pol(game: Path) -> list[Path]:
    """`pol/*.bin`, a `pol_<name>` copy of `<name>` counted once."""
    out = []
    for p in sorted((game / "pol").glob("*.bin")):
        twin = p.with_name(p.name[4:]) if p.name.startswith("pol_") else None
        if twin and twin.exists() and hashlib.sha1(p.read_bytes()).digest() \
                == hashlib.sha1(twin.read_bytes()).digest():
            continue
        out.append(p)
    return out


def scan_bit19(raw: bytes, tables: ExeTables, fail: Failures) -> None:
    try:
        import capstone
    except ImportError:
        print("  bit-19 scan: capstone is not installed -- NOT run")
        return
    lo, hi = D3D_MODULE
    code = raw[tables._v2r(lo):tables._v2r(hi)]
    md = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_32)
    md.detail = True
    md.skipdata = True
    hits: dict[int, str] = {}
    n = 0
    for ins in md.disasm(code, lo):
        n += 1
        if not ins.op_str:
            continue
        imms = [op.imm & 0xFFFFFFFF for op in ins.operands
                if op.type == capstone.x86.X86_OP_IMM]
        shift19 = ins.mnemonic in ("shr", "sar", "shl", "rol", "ror", "bt",
                                   "btr", "bts") and 19 in imms
        if shift19 or BIT19_IMMEDIATES & set(imms):
            hits[ins.address] = f"{ins.mnemonic} {ins.op_str}"
    fail.check(n > 5000, f"only {n} instructions decoded in the D3D module")
    fail.check(set(hits) == set(PASS_READERS),
               "bit 19 read outside the pass selectors: "
               + ", ".join(f"{a:#010x} {t}" for a, t in sorted(hits.items())
                           if a not in PASS_READERS)
               + "; missing: " + ", ".join(f"{a:#010x}" for a in PASS_READERS
                                           if a not in hits))
    print(f"  bit-19 scan: {n} instructions in {lo:#010x}..{hi:#010x}, "
          f"{len(hits)} touch bit 19, all of them the pass selectors")


def corpus(game: Path, fail: Failures) -> dict:
    """The corpus premises; returns the materials the meshes of each
    `(pol stem, header sphere)` own, for the bundle to be held to."""
    textured_disagree = 0
    untextured = Counter()
    used = 0
    argb_ita_trn = 0
    meshes = 0
    own: dict[tuple, set] = {}
    for p in unique_pol(game):
        try:
            models = nl1.parse_container(container.load(p.read_bytes()))
        except (nl1.NL1Error, LZError, ValueError, IndexError, struct.error):
            continue
        bank = None
        cache: dict[int, int | None] = {}
        for mi, m in enumerate(models):
            if m is None:
                continue
            for ci, me in enumerate(m.meshes):
                meshes += 1
                a, r, g, b = me.base_colour
                own.setdefault((p.stem, *me.centroid, me.radius), set()).add((
                    tuple(min(max(v, 0.0), 1.0) for v in (r, g, b, a)),
                    me.double_sided))
                if (me.list_type == 0) != me.opaque_pass:
                    if me.textured:
                        textured_disagree += 1
                    else:
                        untextured[p.stem] += 1
                if (me.textured and not me.opaque_pass
                        and me.ignore_texture_alpha
                        and me.pixel_format in (0, 2)):
                    argb_ita_trn += 1
                    if bank is None:
                        bank = stage._bank_for(game, p.stem) or False
                    if me.texture_id not in cache:
                        got = bank.decode(me.texture_id) if bank else None
                        cache[me.texture_id] = (min(got[2][3::4])
                                                if got else None)
                    a = cache[me.texture_id]
                    if a is not None and a < 255:
                        used += 1
    fail.check(meshes > 40000, f"only {meshes} meshes parsed from pol/")
    fail.check(textured_disagree == 0,
               f"{textured_disagree} textured meshes are drawn in a pass "
               "their list type does not name")
    fail.check(dict(untextured) == UNTEXTURED_LIST2_OPAQUE,
               f"the untextured meshes whose list type is not their pass are "
               f"{dict(untextured)}, and gltf.ts / gltf.py name "
               f"{UNTEXTURED_LIST2_OPAQUE}")
    fail.check(used == STRIPPED_AND_USED,
               f"{used} translucent-pass IgnoreTexAlpha meshes blend by a "
               f"texture alpha below 255; the code and docs say "
               f"{STRIPPED_AND_USED}")
    print(f"  corpus: {meshes} meshes; every textured one in its list type's "
          f"pass, the untextured exceptions {dict(untextured)}; "
          f"{argb_ita_trn} translucent-pass IgnoreTexAlpha meshes on ARGB "
          f"textures, {used} of them on one with alpha below 255")
    return own


def damage_overlay(game: Path, raw: bytes, tables: ExeTables,
                   fail: Failures) -> set[str]:
    """What a hit puts on the screen is opaque where the mark is.

    `DamageOverlayUpdateAndDraw` draws its model with the plain
    `AssetDrawSlot`, which hands it no alpha, so the opacity on screen is the
    model's own: its pass, its alpha op, its base alpha and its texture's
    alpha. Each of those is asserted here for every model the overlay's slot
    table names, and the port's copy of that table is held to the exe's.
    Returns the bundle image names whose alpha must be the bank's.
    """
    def at(va: int) -> int:
        r = tables._v2r(va)
        assert r is not None, hex(va)
        return r

    call = raw[at(DAMAGE_OVERLAY_CALL):at(DAMAGE_OVERLAY_CALL) + 5]
    target = (DAMAGE_OVERLAY_CALL + 5
              + struct.unpack_from("<i", call, 1)[0]) & 0xFFFFFFFF
    fail.check(call[0] == 0xE8 and target == ASSET_DRAW_SLOT,
               f"{DAMAGE_OVERLAY_CALL:#010x} is not CALL AssetDrawSlot "
               f"({call.hex()})")
    lo, hi = DAMAGE_OVERLAY_DRAW
    body = raw[at(lo):at(hi)]
    faded = [lo + i for i in range(len(body) - 4) if body[i] == 0xE8
             and (lo + i + 5 + struct.unpack_from("<i", body, i + 1)[0])
             & 0xFFFFFFFF == ASSET_DRAW_SLOT_WITH_ALPHA]
    fail.check(not faded, "DamageOverlayUpdateAndDraw calls "
               f"AssetDrawSlotWithAlpha at {[hex(a) for a in faded]}")

    table = struct.unpack_from(f"<{DAMAGE_OVERLAY_KINDS * 2}i", raw,
                               at(G_DAMAGE_OVERLAY_SLOTS))
    src = PORT_DAMAGE_OVERLAY.read_text()
    m = re.search(r"export const DAMAGE_OVERLAY_SLOTS\b[^=]*=\s*\[(.*?)\];",
                  src, re.S)
    port = [int(x, 16) for x in re.findall(r"0x([0-9a-fA-F]+)",
                                           m.group(1))] if m else []
    fail.check(port == list(table),
               f"the port's DAMAGE_OVERLAY_SLOTS {port} is not "
               f"g_damage_overlay_slots {list(table)}")

    where = tables.asset_slots()
    models: dict[str, list] = {}
    banks: dict[str, object] = {}
    images: set[str] = set()
    seen = 0
    for slot in sorted(set(table)):
        file, k = where.get(slot, ("", -1))
        name = file.removesuffix(".bin")
        if name not in models:
            models[name] = nl1.parse_container(container.load(
                (game / "pol" / file).read_bytes())) if name else []
            banks[name] = stage._bank_for(game, name) if name else None
        m = models[name][k] if 0 <= k < len(models[name]) else None
        if m is None or len(m.meshes) != 1:
            fail.check(False, f"slot {slot:#x} is not one mesh ({name}[{k}])")
            continue
        me = m.meshes[0]
        seen += 1
        what = f"slot {slot:#x} ({name}[{k}])"
        fail.check(not me.opaque_pass and (me.tsp >> 29) == 4
                   and ((me.tsp >> 26) & 7) == 5,
                   f"{what}: TSP {me.tsp:#010x} is not the translucent pass "
                   "with SRCALPHA / INVSRCALPHA")
        # Mode 1 would be SELECTARG1 -- still the texel's alpha, but the
        # reading below is of MODULATE, so say so if it ever is not.
        fail.check(((me.tsp >> 6) & 3) != 1 and me.base_colour[0] == 1.0,
                   f"{what}: shading mode {(me.tsp >> 6) & 3}, base alpha "
                   f"{me.base_colour[0]} -- not texel alpha x 1.0")
        bank = banks[name]
        got = bank.decode(me.texture_id) if bank else None
        if got is None or me.pixel_format != 2:
            fail.check(False, f"{what}: texture {me.texture_id} is not an "
                       "ARGB4444 texture of the bank")
            continue
        hist = Counter(got[2][3::4])
        nonzero = {a: n for a, n in hist.items() if a}
        fail.check(hist[0] > 0 and nonzero
                   and max(nonzero, key=nonzero.get) == 255,
                   f"{what}: texture {me.texture_id}'s alpha is not a clear "
                   f"surround round a mostly opaque mark ({sorted(hist.items())})")
        images.add(f"{name}/tex_{me.texture_id:03d}")
    fail.check(seen == len(set(table)), f"only {seen} overlay models read")
    print(f"  damage overlay: CALL AssetDrawSlot at {DAMAGE_OVERLAY_CALL:#x}, "
          f"no faded draw; {seen} models, each one translucent-pass mesh at "
          f"base alpha 1 on an ARGB4444 texture that is alpha 0 round the mark "
          f"and 255 across most of it; the port's slot table is the exe's")
    return images


def glb(path: Path) -> tuple[dict, bytes]:
    b = path.read_bytes()
    ln = struct.unpack_from("<I", b, 12)[0]
    doc = json.loads(b[20:20 + ln])
    at = 20 + ln
    bln = struct.unpack_from("<I", b, at)[0]
    return doc, b[at + 8:at + 8 + bln]


def png_alpha(png: bytes) -> tuple[int, int, bytes]:
    """`(w, h, alpha bytes)` of the exporter's PNG: RGBA8, filter 0 rows."""
    at, w, h, idat = 8, 0, 0, b""
    while at < len(png):
        ln = struct.unpack_from(">I", png, at)[0]
        tag = png[at + 4:at + 8]
        body = png[at + 8:at + 8 + ln]
        if tag == b"IHDR":
            w, h = struct.unpack_from(">II", body)
        elif tag == b"IDAT":
            idat += body
        at += 12 + ln
    raw = zlib.decompress(idat)
    stride = w * 4 + 1
    rows = b"".join(raw[y * stride + 1:(y + 1) * stride] for y in range(h))
    return w, h, rows[3::4]


def bundle(game: Path, fail: Failures, own: dict, must: set[str]) -> None:
    bd = bundle_dir()
    if bd is None:
        print("  bundle: none found -- the images were NOT checked (export "
              "one, or set HOTD2_BUNDLE)")
        return
    if builder_digest(bd) != tree_digest():
        print(f"  bundle: {bd} was written by a different gltf.ts than this "
              "tree's -- the images were NOT checked; re-export it")
        return
    banks: dict[str, object] = {}
    images = opaque_named = compared = mismatched = 0
    prims = wrong_mat = 0
    named_seen: set[str] = set()
    for path in sorted(bd.glob("stage*/stage*.glb")):
        doc, binary = glb(path)
        # Every model primitive draws with its own mesh's material: the base
        # colour WalkMeshChainAndDraw hands SetMaterial, and the culling. A
        # primitive is found by its part and the mesh header's sphere, which
        # it carries as `hod2_sphere` -- node names number a filtered model
        # list in the rigs, and a chain index skips empty meshes -- and it
        # must hold one of the materials the meshes with that sphere own.
        mats = doc.get("materials", [])
        for node in doc.get("nodes", []):
            part, sep, _ = (node.get("name") or "").rpartition("_model_")
            if not sep or "mesh" not in node:
                continue
            for pr in doc["meshes"][node["mesh"]]["primitives"]:
                sphere = (pr.get("extras") or {}).get("hod2_sphere")
                want = own.get((part, *sphere)) if sphere else None
                if want is None or "material" not in pr:
                    continue
                mat = mats[pr["material"]]
                got = (tuple(mat["pbrMetallicRoughness"]["baseColorFactor"]),
                       mat.get("doubleSided", False))
                prims += 1
                if got not in want:
                    wrong_mat += 1
                    if wrong_mat <= 3:
                        print(f"    {path.name} {node['name']}: material "
                              f"{got}, the mesh's own {sorted(want)}")
        imgs = doc.get("images", [])
        images += len(imgs)
        opaque_named += sum(1 for im in imgs
                            if "_opaque" in (im.get("name") or im.get("uri", "")))
        # Images drawn by an IgnoreTexAlpha material on an ARGB texture.
        want: dict[int, bool] = {}          # image -> translucent pass?
        for mat in doc.get("materials", []):
            pv = (mat.get("extras") or {}).get("pvr2") or {}
            tex = (mat.get("pbrMetallicRoughness") or {}).get("baseColorTexture")
            if (not tex or not pv.get("ignore_texture_alpha")
                    or pv.get("pixel_format") not in ("ARGB1555", "ARGB4444")):
                continue
            img = doc["textures"][tex["index"]]["source"]
            want[img] = want.get(img, False) or mat.get("alphaMode") == "BLEND"
        opaque = sorted((i for i, t in want.items() if not t),
                        key=lambda i: imgs[i].get("name", ""))[:OPAQUE_SAMPLE]
        # ...and the images a caller names outright: the damage overlay's.
        named = {i for i, im in enumerate(imgs) if im.get("name") in must}
        named_seen |= {imgs[i]["name"] for i in named}
        for i in sorted({i for i, t in want.items() if t} | set(opaque)
                        | named):
            name = imgs[i].get("name", "")
            part, _, tex_name = name.rpartition("/")
            if not tex_name.startswith("tex_"):
                continue
            if part not in banks:
                banks[part] = stage._bank_for(game, part)
            bank = banks[part]
            # `tex_NNN`, or an old bundle's `tex_NNN_opaque`, which is then
            # compared too and differs.
            got = bank.decode(int(tex_name[4:].split("_")[0])) if bank else None
            if got is None:
                continue
            view = doc["bufferViews"][imgs[i]["bufferView"]]
            off = view.get("byteOffset", 0)
            w, h, alpha = png_alpha(binary[off:off + view["byteLength"]])
            compared += 1
            if (w, h) != got[:2] or alpha != bytes(got[2][3::4]):
                mismatched += 1
                if mismatched <= 5:
                    print(f"    {path.name} {name}: alpha differs from the "
                          "bank's")
    fail.check(images > 0, f"no images in {bd}")
    fail.check(opaque_named == 0,
               f"{opaque_named} images in {bd} are alpha-stripped `_opaque` "
               "copies")
    fail.check(compared > 0, "no IgnoreTexAlpha ARGB image was compared")
    fail.check(named_seen == must,
               f"the damage overlay's images {sorted(must - named_seen)} are "
               "in no stage bundle")
    fail.check(mismatched == 0,
               f"{mismatched} of {compared} images differ from the bank's alpha")
    fail.check(prims > 10000, f"only {prims} stage primitives matched a mesh")
    fail.check(wrong_mat == 0,
               f"{wrong_mat} of {prims} stage primitives draw with a material "
               "whose base colour or culling is another mesh's")
    print(f"  bundle: {images} images in {bd}, {opaque_named} `_opaque`; "
          f"{compared} IgnoreTexAlpha ARGB and damage-overlay images against "
          "the bank, "
          f"{mismatched} with a different alpha; {prims} stage primitives "
          f"against their mesh's base colour and culling, {wrong_mat} wrong")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--game-dir", required=True, type=Path)
    args = ap.parse_args()

    tables = ExeTables(str(args.game_dir / "Hod2.exe"))
    raw = (args.game_dir / "Hod2.exe").read_bytes()
    fail = Failures()

    def at(va: int) -> int:
        r = tables._v2r(va)
        assert r is not None, hex(va)
        return r

    table = list(struct.unpack_from("<8I", raw, at(G_PVR_PIXFMT_TEXTURE_FORMAT)))
    fail.check(table == [5, 2, 6, 8, 8, 8, 7, 0],
               f"g_pvr_pixfmt_texture_format is {table}")
    lo, hi = DECODE_TEXTURE
    ref = struct.pack("<I", G_PVR_PIXFMT_TEXTURE_FORMAT)
    fail.check(ref in raw[at(lo):at(hi)],
               "DecodeTextureToSurface does not name g_pvr_pixfmt_texture_format")
    for va, hexbytes, what in SEQUENCES:
        want = bytes.fromhex(hexbytes)
        got = raw[at(va):at(va) + len(want)]
        fail.check(got == want, f"{va:#010x} {what}: {got.hex()}")
    va, targets = MODE_TABLE
    got = list(struct.unpack_from("<4I", raw, at(va)))
    fail.check(got == targets, f"the shading-mode table at {va:#010x} is "
               + ", ".join(f"{t:#010x}" for t in got))
    print(f"  upload: ARGB1555 -> slot {table[0]} (A1R5G5B5, DDPF_ALPHAPIXELS), "
          f"RGB565 -> {table[1]}, ARGB4444 -> {table[2]}; texels copied "
          f"verbatim; stage 0 alpha = TEXTURE (x DIFFUSE); "
          f"{len(SEQUENCES)} sequences")

    scan_bit19(raw, tables, fail)
    own = corpus(args.game_dir, fail)
    overlay = damage_overlay(args.game_dir, raw, tables, fail)
    bundle(args.game_dir, fail, own, overlay)

    if fail.n:
        print(f"verify_texture_alpha: {fail.n} of {fail.asserted} checks FAILED")
        return 1
    print(f"verify_texture_alpha: all {fail.asserted} checks passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
