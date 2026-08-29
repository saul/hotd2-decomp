"""
glTF 2.0 writer for HOTD2 levels.

Emits .gltf + .bin + PNG textures. The raw PowerVR2 render-state words are
preserved verbatim in each material's ``extras.pvr2`` so a target engine can
implement exact behaviour rather than relying on the approximate PBR mapping.

Coordinate handling
-------------------
glTF is right-handed, Y-up, -Z forward, which matches the NaomiLib convention
closely enough that positions pass through unchanged.

UV V is written as stored. The Blender addon flips it (v = 1 - v) because
Blender's UV origin is bottom-left; glTF's is top-left, and Blender's glTF
importer applies that same flip on load, so writing the raw value round-trips
correctly.
"""

from __future__ import annotations

import base64
import json
import struct
from pathlib import Path

from . import png, texbank

__all__ = ["export_level"]

# glTF constants
FLOAT = 5126
UNSIGNED_INT = 5125
ARRAY_BUFFER = 34962
ELEMENT_ARRAY_BUFFER = 34963
TRIANGLES = 4

NEAREST, LINEAR = 9728, 9729
REPEAT, CLAMP_TO_EDGE, MIRRORED_REPEAT = 10497, 33071, 33648


class _Buf:
    def __init__(self) -> None:
        self.data = bytearray()
        self.views: list[dict] = []
        self.accessors: list[dict] = []

    def _align(self, n: int = 4) -> None:
        while len(self.data) % n:
            self.data.append(0)

    def add(self, raw: bytes, target: int | None = None) -> int:
        self._align()
        off = len(self.data)
        self.data += raw
        v = {"buffer": 0, "byteOffset": off, "byteLength": len(raw)}
        if target is not None:
            v["target"] = target
        self.views.append(v)
        return len(self.views) - 1

    def vec3(self, vals: list[tuple[float, float, float]]) -> int:
        raw = b"".join(struct.pack("<3f", *v) for v in vals)
        view = self.add(raw, ARRAY_BUFFER)
        xs = [v[0] for v in vals] or [0.0]
        ys = [v[1] for v in vals] or [0.0]
        zs = [v[2] for v in vals] or [0.0]
        self.accessors.append({
            "bufferView": view, "componentType": FLOAT, "count": len(vals),
            "type": "VEC3",
            "min": [min(xs), min(ys), min(zs)],
            "max": [max(xs), max(ys), max(zs)],
        })
        return len(self.accessors) - 1

    def vec2(self, vals: list[tuple[float, float]]) -> int:
        raw = b"".join(struct.pack("<2f", *v) for v in vals)
        view = self.add(raw, ARRAY_BUFFER)
        self.accessors.append({
            "bufferView": view, "componentType": FLOAT,
            "count": len(vals), "type": "VEC2",
        })
        return len(self.accessors) - 1

    def vec4(self, vals: list[tuple[float, float, float, float]]) -> int:
        raw = b"".join(struct.pack("<4f", *v) for v in vals)
        view = self.add(raw, ARRAY_BUFFER)
        self.accessors.append({
            "bufferView": view, "componentType": FLOAT,
            "count": len(vals), "type": "VEC4",
        })
        return len(self.accessors) - 1

    def indices(self, idx: list[int]) -> int:
        raw = struct.pack("<%dI" % len(idx), *idx)
        view = self.add(raw, ELEMENT_ARRAY_BUFFER)
        self.accessors.append({
            "bufferView": view, "componentType": UNSIGNED_INT,
            "count": len(idx), "type": "SCALAR",
            "min": [min(idx) if idx else 0], "max": [max(idx) if idx else 0],
        })
        return len(self.accessors) - 1


def _wrap_mode(clamp_bit: bool, flip_bit: bool) -> int:
    if clamp_bit:
        return CLAMP_TO_EDGE
    if flip_bit:
        return MIRRORED_REPEAT
    return REPEAT


def export_level(name, parts, out_dir, collision=None, write_textures=True):
    """Write one or more parts to <out_dir>/<name>.gltf plus .bin and textures/.

    ``parts`` is a list of (part_name, models, bank). A stage is split across
    many pol/ files, so a whole stage is exported as a single glTF with one
    node per model, grouped under a parent node per part.

    Texture IDs are numbered per bank, so tex 0 of st2_01 is unrelated to tex 0
    of st2_02. Everything keyed by texture is therefore keyed by
    (part_name, texture_id), and PNGs are written per part.
    """
    out_dir = Path(out_dir)
    (out_dir / "textures").mkdir(parents=True, exist_ok=True)

    buf = _Buf()
    images: list[dict] = []
    samplers: list[dict] = []
    textures: list[dict] = []
    materials: list[dict] = []
    meshes: list[dict] = []
    nodes: list[dict] = []
    scene_nodes: list[int] = []

    tex_written: dict[tuple, int] = {}     # (part, texture_id) -> glTF texture
    sampler_cache: dict[tuple, int] = {}
    mat_cache: dict[tuple, int] = {}

    def get_texture(part: str, bank, tex_id: int, strip_alpha: bool) -> int | None:
        """Decode a texture, optionally forcing it fully opaque.

        ARGB1555/ARGB4444 textures are also used on meshes whose TSP sets
        IgnoreTexAlpha, where the hardware discards the alpha channel. Emitting
        the stored alpha for those would punch spurious holes, so they get a
        separate fully-opaque image variant.
        """
        key = (part, tex_id, strip_alpha)
        if key in tex_written:
            return tex_written[key]
        if bank is None:
            return None
        got = bank.decode(tex_id)
        if got is None:
            return None
        w, h, rgba = got
        if strip_alpha:
            rgba = bytearray(rgba)
            rgba[3::4] = b"\xff" * (len(rgba) // 4)
        sub = f"textures/{part}"
        (out_dir / sub).mkdir(parents=True, exist_ok=True)
        suffix = "_opaque" if strip_alpha else ""
        fn = f"{sub}/tex_{tex_id:03d}{suffix}.png"
        if write_textures:
            png.write_rgba(out_dir / fn, w, h, rgba)
        images.append({"uri": fn})
        textures.append({"source": len(images) - 1})
        tex_written[key] = len(textures) - 1
        return tex_written[key]

    def get_sampler(mesh) -> int:
        clamp = mesh.clamp_uv
        flip = mesh.flip_uv
        # bit 1 of clamp/flip is U, bit 0 is V
        wrap_s = _wrap_mode(bool(clamp & 2), bool(flip & 2))
        wrap_t = _wrap_mode(bool(clamp & 1), bool(flip & 1))
        filt = NEAREST if mesh.filter_mode == 0 else LINEAR
        key = (wrap_s, wrap_t, filt)
        if key not in sampler_cache:
            samplers.append({
                "magFilter": filt, "minFilter": filt,
                "wrapS": wrap_s, "wrapT": wrap_t,
            })
            sampler_cache[key] = len(samplers) - 1
        return sampler_cache[key]

    def get_material(part: str, bank, mesh) -> int:
        key = (part, mesh.texture_id, mesh.tsp, mesh.texture_control,
               mesh.parameter_control, mesh.isp_tsp, mesh.shading)
        if key in mat_cache:
            return mat_cache[key]

        strip_alpha = mesh.ignore_texture_alpha
        tex_idx = (get_texture(part, bank, mesh.texture_id, strip_alpha)
                   if mesh.textured else None)

        a, r, g, b = mesh.base_colour
        pbr: dict = {
            "baseColorFactor": [
                min(max(r, 0.0), 1.0), min(max(g, 0.0), 1.0),
                min(max(b, 0.0), 1.0), min(max(a, 0.0), 1.0),
            ],
            "metallicFactor": 0.0,
            "roughnessFactor": 1.0,
        }
        if tex_idx is not None:
            textures[tex_idx]["sampler"] = get_sampler(mesh)
            pbr["baseColorTexture"] = {"index": tex_idx}
            # A texture supplies the colour; the base colour would double-modulate.
            pbr["baseColorFactor"] = [1.0, 1.0, 1.0, pbr["baseColorFactor"][3]]

        mat: dict = {
            "name": f"{part}_tex{mesh.texture_id}_{mesh.shading_mode_name}",
            "pbrMetallicRoughness": pbr,
            "doubleSided": mesh.double_sided,
        }

        # Alpha mode follows the PowerVR2 *list type*, which is what selects
        # the hardware's blending pass.
        #
        # It must not depend on the TSP UseAlpha bit: that governs whether the
        # vertex/base colour alpha participates, not whether blending happens.
        # Keying on it marked every translucent mesh with UseAlpha=0 as opaque
        # -- 8554 meshes in this game, including most of the glass and
        # foliage.
        if mesh.punch_through:
            mat["alphaMode"] = "MASK"
            mat["alphaCutoff"] = 0.5
        elif mesh.translucent:
            mat["alphaMode"] = "BLEND"
        else:
            mat["alphaMode"] = "OPAQUE"

        # Raw hardware state, so a target engine can be exact.
        mat["extras"] = {
            "pvr2": {
                "texture_id": mesh.texture_id,
                "parameter_control": f"0x{mesh.parameter_control:08X}",
                "isp_tsp_instruction": f"0x{mesh.isp_tsp:08X}",
                "tsp_instruction": f"0x{mesh.tsp:08X}",
                "texture_control": f"0x{mesh.texture_control:08X}",
                "list_type": mesh.list_type,
                "shading_mode": mesh.shading_mode_name,
                "src_blend": mesh.src_blend,
                "dst_blend": mesh.dst_blend,
                # src_alpha / one. glTF has no additive alphaMode, so this is
                # exported as BLEND and flagged for the target engine.
                "additive": mesh.additive,
                "texture_alpha_used": mesh.textured and not strip_alpha,
                "clamp_uv": mesh.clamp_uv,
                "flip_uv": mesh.flip_uv,
                "filter_mode": mesh.filter_mode,
                "pixel_format": mesh.pixel_format_name,
                "vq_compressed": mesh.vq_compressed,
                "twiddled": mesh.twiddled,
                "use_alpha": mesh.use_alpha,
                "ignore_texture_alpha": mesh.ignore_texture_alpha,
                "gouraud": mesh.gouraud,
            }
        }
        materials.append(mat)
        mat_cache[key] = len(materials) - 1
        return mat_cache[key]

    # ---- geometry ------------------------------------------------------
    for part_name, models, bank in parts:
        child_nodes: list[int] = []
        for mi, model in enumerate(models):
            prims = []
            for mesh in model.meshes:
                if not mesh.triangles or not mesh.vertices:
                    continue
                pos = [v.pos for v in mesh.vertices]
                nrm = [v.normal for v in mesh.vertices]
                uv = [v.uv for v in mesh.vertices]
                idx = [i for tri in mesh.triangles for i in tri]

                attrs = {"POSITION": buf.vec3(pos)}
                if any(any(c) for c in nrm):
                    attrs["NORMAL"] = buf.vec3(nrm)
                attrs["TEXCOORD_0"] = buf.vec2(uv)
                if mesh.vertices[0].colour is not None:
                    attrs["COLOR_0"] = buf.vec4(
                        [v.colour or (1, 1, 1, 1) for v in mesh.vertices])

                prims.append({
                    "attributes": attrs,
                    "indices": buf.indices(idx),
                    "material": get_material(part_name, bank, mesh),
                    "mode": TRIANGLES,
                })

            if prims:
                mesh_name = f"{part_name}_model_{mi:03d}"
                meshes.append({"name": mesh_name, "primitives": prims})
                nodes.append({"mesh": len(meshes) - 1, "name": mesh_name})
                child_nodes.append(len(nodes) - 1)

        if child_nodes:
            # One parent per part, so a stage segment can be shown or hidden
            # as a unit. Segment streaming order lives in evt/ and cam/.
            nodes.append({
                "name": part_name,
                "children": child_nodes,
                "extras": {"hod2_part": part_name},
            })
            scene_nodes.append(len(nodes) - 1)

    # ---- collision -----------------------------------------------------
    if collision:
        for ci, (cname, verts, tris) in enumerate(collision):
            if not tris:
                continue
            attrs = {"POSITION": buf.vec3(verts)}
            prim = {
                "attributes": attrs,
                "indices": buf.indices([i for t in tris for i in t]),
                "mode": TRIANGLES,
            }
            meshes.append({"name": cname, "primitives": [prim]})
            nodes.append({"mesh": len(meshes) - 1, "name": cname,
                          "extras": {"hod2_kind": "collision"}})
            scene_nodes.append(len(nodes) - 1)

    # ---- assemble ------------------------------------------------------
    bin_name = f"{name}.bin"
    (out_dir / bin_name).write_bytes(bytes(buf.data))

    doc = {
        "asset": {
            "version": "2.0",
            "generator": "hod2lib (hotd2-decomp)",
        },
        "scene": 0,
        "scenes": [{"nodes": scene_nodes, "name": name}],
        "nodes": nodes,
        "meshes": meshes,
        "materials": materials,
        "accessors": buf.accessors,
        "bufferViews": buf.views,
        "buffers": [{"uri": bin_name, "byteLength": len(buf.data)}],
    }
    if images:
        doc["images"] = images
        doc["textures"] = textures
    if samplers:
        doc["samplers"] = samplers

    (out_dir / f"{name}.gltf").write_text(json.dumps(doc, indent=1))

    return {
        "gltf": str(out_dir / f"{name}.gltf"),
        "nodes": len(nodes),
        "meshes": len(meshes),
        "materials": len(materials),
        "textures": len(textures),
        "buffer_bytes": len(buf.data),
    }
