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
import math
import struct
from pathlib import Path

from . import cam as camlib, nl1, png, texbank

__all__ = ["export_level"]

# glTF constants
FLOAT = 5126
UNSIGNED_INT = 5125
ARRAY_BUFFER = 34962
ELEMENT_ARRAY_BUFFER = 34963
TRIANGLES = 4
LINE_STRIP = 3

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

    def scalar_f32(self, vals: list[float]) -> int:
        raw = struct.pack("<%df" % len(vals), *vals)
        view = self.add(raw)
        self.accessors.append({
            "bufferView": view, "componentType": FLOAT,
            "count": len(vals), "type": "SCALAR",
            "min": [min(vals)], "max": [max(vals)],
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


# ---------------------------------------------------------------------------
# camera and object paths
# ---------------------------------------------------------------------------

#: The game's projection, recovered from `SetupSceneProjection` (0x004184C0):
#:
#:     SetMatrixMode(3);                                  /* PROJECTION */
#:     MatrixLoadIdentity();
#:     MatrixTranslate(0, 0, 0);                          /* screen offset */
#:     BuildPerspectiveProjection(0x1D3B, 4.0/3.0, 0.8, 8000.0);
#:     SetMatrixMode(1);                                  /* commits it */
#:
#: `BuildPerspectiveProjection` takes the FULL vertical FOV in BAMS, halves it
#: through __ftol (so it truncates), and builds a left-handed D3D matrix with
#: m11 = cot(half). There are exactly two call sites and both pass 0x1D3B, so
#: the FOV is a compile-time constant for the whole game -- there is no zoom
#: and no per-camera FOV.
#:
#:     0x1D3B = 7483 BAMS   half = (int)3741.5 = 3741
#:     yfov = 2 * 3741 * tau/65536 = 0.7173277659 rad = 41.100 deg
#:     xfov (at 4:3)                                   = 53.115 deg
#:
#: Confirmed independently: the same function computes
#: `240.0 / tan(0.35866388296751145)` = 640.21, the projection distance in
#: pixels for a 480-tall viewport, and 0.35866388296751145 is *bit for bit*
#: 3741 * tau/65536. Two constants, one FOV.
CAM_FOV_BAMS = 0x1D3B
CAM_YFOV = 2.0 * int(CAM_FOV_BAMS * 0.5) * (math.tau / 65536.0)
CAM_ASPECT = 4.0 / 3.0
CAM_ZNEAR = 0.8
CAM_ZFAR = 8000.0

#: Kept as the old name so nothing silently reverts to the 60-degree guess.
DEFAULT_YFOV = CAM_YFOV

#: cam/ roll is stored as an integer and is read through __ftol, like every
#: other angle in the game, so it is treated as BAMS (65536 = 360 deg). Only
#: cp_st3 uses it at all, peaking at ~876 = 4.8 deg, which is a plausible
#: camera tilt; degrees would give 876 deg, which is not.
BAMS_TO_RAD = math.tau / 65536.0


def _norm(v):
    n = math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2])
    return (v[0] / n, v[1] / n, v[2] / n) if n > 1e-9 else (0.0, 0.0, -1.0)


def _cross(a, b):
    return (a[1] * b[2] - a[2] * b[1],
            a[2] * b[0] - a[0] * b[2],
            a[0] * b[1] - a[1] * b[0])


def _look_at_quat(eye, target, roll_bams=0.0):
    """Rotation putting a glTF camera at *eye* looking at *target*.

    glTF cameras look down -Z with +Y up, so the camera's local Z axis is the
    backward direction. Roll is applied about the view axis.
    """
    fwd = _norm((target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]))
    zax = (-fwd[0], -fwd[1], -fwd[2])
    up = (0.0, 1.0, 0.0)
    if abs(fwd[1]) > 0.9999:                      # looking straight up/down
        up = (0.0, 0.0, 1.0)
    xax = _norm(_cross(up, zax))
    yax = _cross(zax, xax)

    if roll_bams:
        a = roll_bams * BAMS_TO_RAD
        c, s_ = math.cos(a), math.sin(a)
        xr = (xax[0] * c + yax[0] * s_, xax[1] * c + yax[1] * s_, xax[2] * c + yax[2] * s_)
        yr = (yax[0] * c - xax[0] * s_, yax[1] * c - xax[1] * s_, yax[2] * c - xax[2] * s_)
        xax, yax = xr, yr

    # rotation matrix (columns are the basis vectors) -> quaternion
    m00, m01, m02 = xax[0], yax[0], zax[0]
    m10, m11, m12 = xax[1], yax[1], zax[1]
    m20, m21, m22 = xax[2], yax[2], zax[2]
    tr = m00 + m11 + m22
    if tr > 0:
        s_ = math.sqrt(tr + 1.0) * 2
        w = 0.25 * s_
        x = (m21 - m12) / s_
        y = (m02 - m20) / s_
        z = (m10 - m01) / s_
    elif m00 > m11 and m00 > m22:
        s_ = math.sqrt(1.0 + m00 - m11 - m22) * 2
        w = (m21 - m12) / s_
        x = 0.25 * s_
        y = (m01 + m10) / s_
        z = (m02 + m20) / s_
    elif m11 > m22:
        s_ = math.sqrt(1.0 + m11 - m00 - m22) * 2
        w = (m02 - m20) / s_
        x = (m01 + m10) / s_
        y = 0.25 * s_
        z = (m12 + m21) / s_
    else:
        s_ = math.sqrt(1.0 + m22 - m00 - m11) * 2
        w = (m10 - m01) / s_
        x = (m02 + m20) / s_
        y = (m12 + m21) / s_
        z = 0.25 * s_
    n = math.sqrt(x * x + y * y + z * z + w * w) or 1.0
    return (x / n, y / n, z / n, w / n)


def _sample_path(path, channels, step):
    """Sample a cam/ path on a fixed frame grid, always including the end."""
    curves = [path.channels.get(c) for c in channels]
    if any(c is None for c in curves):
        return []
    keys = curves[0].real_keys
    if len(keys) < 2:
        t0 = keys[0].time if keys else 0.0
        return [(t0, [c.evaluate(t0) for c in curves])]
    t0, t1 = keys[0].time, keys[-1].time
    times = []
    t = t0
    while t < t1:
        times.append(t)
        t += step
    times.append(t1)
    return [(t, [c.evaluate(t) for c in curves]) for t in times]


def _wrap_mode(clamp_bit: bool, flip_bit: bool) -> int:
    """PVR2 clamp/flip -> D3D7 texture address, as FUN_004A7780 does it.

    The game indexes a 4-entry table with ``(clamp << 1) | flip``:

        0 neither  -> D3DTADDRESS_WRAP
        1 flip     -> D3DTADDRESS_MIRROR
        2 clamp    -> D3DTADDRESS_CLAMP
        3 both     -> D3DTADDRESS_MIRROR      <- mirror wins, not clamp

    That last row is not what "clamp overrides everything" would predict, and
    it is reachable: 157 mesh-axes set clamp+flip on U and 90 on V.
    """
    if clamp_bit and flip_bit:
        return MIRRORED_REPEAT
    if clamp_bit:
        return CLAMP_TO_EDGE
    if flip_bit:
        return MIRRORED_REPEAT
    return REPEAT


def _checker(size=128, cells=8):
    """UV diagnostic texture: a checkerboard with per-axis colour bias.

    Red increases along u, blue along v, so a stretched or rotated face is
    obvious at a glance -- squares become rectangles and the colour gradient
    runs the wrong way.
    """
    px = bytearray(size * size * 4)
    step = size // cells
    for y in range(size):
        for x in range(size):
            dark = ((x // step) + (y // step)) & 1
            base = 60 if dark else 200
            o = (y * size + x) * 4
            px[o] = min(255, base + (x * 55) // size)
            px[o + 1] = base
            px[o + 2] = min(255, base + (y * 55) // size)
            px[o + 3] = 255
    # solid border lines each cell, to make shear visible too
    for y in range(size):
        for x in range(size):
            if x % step == 0 or y % step == 0:
                o = (y * size + x) * 4
                px[o] = px[o + 1] = px[o + 2] = 255
    return px


#: BAMS: 65536 units to a full turn, the engine's angle unit everywhere.
BAMS_TO_RAD = math.tau / 65536.0


def _bams_euler_to_quat(rx: float, ry: float, rz: float
                        ) -> tuple[float, float, float, float]:
    """The engine's object rotation triple as a glTF quaternion (x, y, z, w).

    The order is not a guess. Every object that follows an `op_` path is drawn
    by the same chain -- `FUN_0048E600` is the clearest example::

        MatrixTranslate(pos);
        MatrixRotateZ(rot_z);   /* 0x004A9BD0, rotates rows 0 and 1 */
        MatrixRotateY(rot_y);
        MatrixRotateX(rot_x);

    The matrix stack is column-major and `MatrixMultiply` computes
    ``top = top * M``, i.e. exactly OpenGL's ``glMultMatrix`` -- so the
    composite is ``T * Rz * Ry * Rx`` acting on column vectors, and **Rx is
    applied to the vertex first**. In quaternion terms that is ``qZ * qY * qX``.

    ``PlacePlayerEntityFromViewPose`` builds the view pose with the same chain,
    which is a second, independent sighting of the convention.
    """
    hx, hy, hz = (rx * BAMS_TO_RAD) / 2, (ry * BAMS_TO_RAD) / 2, (rz * BAMS_TO_RAD) / 2
    cx, sx = math.cos(hx), math.sin(hx)
    cy, sy = math.cos(hy), math.sin(hy)
    cz, sz = math.cos(hz), math.sin(hz)
    # qZ * qY * qX
    return (
        sx * cy * cz - cx * sy * sz,
        cx * sy * cz + sx * cy * sz,
        cx * cy * sz - sx * sy * cz,
        cx * cy * cz + sx * sy * sz,
    )


def _emit_paths(cam_files, buf, nodes, meshes, materials, cameras, animations,
                fps=60.0, step=2.0):
    """Add camera/object paths to a glTF document under three parent nodes.

    Produces, per cp_ path:
      * a two-polyline mesh -- the eye rail and the look-at rail -- so the
        path is visible in the viewport without playing anything;
      * an animated perspective camera.

    and per op_ path a rail polyline **and an animated node**. op_ paths carry
    a BAMS Euler triple rather than a look-at; the triple's meaning and
    application order are now recovered from the draw chain every path-following
    object shares -- see :func:`_bams_euler_to_quat` -- so both translation and
    rotation are emitted. Attach a model to the animated node to see an object
    run its route.

    Returns the node indices to add to the scene.
    """
    def line_material(rgba, mname):
        for i, m in enumerate(materials):
            if m.get("name") == mname:
                return i
        materials.append({
            "name": mname,
            "pbrMetallicRoughness": {
                "baseColorFactor": list(rgba),
                "metallicFactor": 0.0, "roughnessFactor": 1.0,
            },
            "emissiveFactor": list(rgba[:3]),
            "doubleSided": True,
        })
        return len(materials) - 1

    def polyline(points, material):
        return {
            "attributes": {"POSITION": buf.vec3(points)},
            "indices": buf.indices(list(range(len(points)))),
            "material": material,
            "mode": LINE_STRIP,
        }

    m_eye = line_material((0.15, 0.85, 1.0, 1.0), "hod2_cam_rail")
    m_aim = line_material((1.0, 0.55, 0.1, 1.0), "hod2_cam_aim")
    m_obj = line_material((0.3, 1.0, 0.35, 1.0), "hod2_object_rail")

    rail_nodes, cam_nodes, obj_nodes = [], [], []

    for cf in cam_files:
        stem = cf.name[:-4] if cf.name.endswith(".bin") else cf.name

        if cf.is_object_path:
            for path in cf.paths:
                samples = _sample_path(path, camlib.OP_CHANNELS, step)
                if len(samples) < 2:
                    continue
                times = [t / fps for t, _ in samples]
                pts = [(v[0], v[1], v[2]) for _, v in samples]
                quats = [_bams_euler_to_quat(v[3], v[4], v[5]) for _, v in samples]
                slot = getattr(path, "slot", None)
                extras = {"hod2_kind": "object_path", "hod2_file": stem,
                          "hod2_path": path.index,
                          "hod2_duration_frames": path.duration}
                if slot is not None:
                    extras["hod2_path_slot"] = slot

                nm = f"{stem}_{path.index:02d}"
                meshes.append({"name": nm + "_rail",
                               "primitives": [polyline(pts, m_obj)]})
                nodes.append({
                    "mesh": len(meshes) - 1, "name": nm + "_rail",
                    "extras": dict(extras),
                })
                obj_nodes.append(len(nodes) - 1)

                # the moving node: parent a model under this to watch it run
                nodes.append({
                    "name": nm + "_obj",
                    "translation": list(pts[0]), "rotation": list(quats[0]),
                    "extras": dict(extras, hod2_kind="object"),
                })
                obj_node = len(nodes) - 1
                obj_nodes.append(obj_node)

                t_in = buf.scalar_f32(times)
                animations.append({
                    "name": nm,
                    "samplers": [
                        {"input": t_in, "output": buf.vec3(pts),
                         "interpolation": "LINEAR"},
                        {"input": t_in, "output": buf.vec4(quats),
                         "interpolation": "LINEAR"},
                    ],
                    "channels": [
                        {"sampler": 0,
                         "target": {"node": obj_node, "path": "translation"}},
                        {"sampler": 1,
                         "target": {"node": obj_node, "path": "rotation"}},
                    ],
                })
            continue

        for path in cf.paths:
            samples = _sample_path(path, camlib.CP_CHANNELS, step)
            if len(samples) < 2:
                continue
            eyes = [(v[0], v[1], v[2]) for _, v in samples]
            aims = [(v[3], v[4], v[5]) for _, v in samples]
            times = [t / fps for t, _ in samples]
            quats = [_look_at_quat(e, a, v[6])
                     for (e, a, (_, v)) in zip(eyes, aims, samples)]

            nm = f"{stem}_{path.index:02d}"

            # visible rail: eye polyline + aim polyline in one mesh
            meshes.append({
                "name": nm + "_rail",
                "primitives": [polyline(eyes, m_eye), polyline(aims, m_aim)],
            })
            nodes.append({
                "mesh": len(meshes) - 1, "name": nm + "_rail",
                "extras": {"hod2_kind": "camera_rail", "hod2_file": stem,
                           "hod2_path": path.index,
                           "hod2_duration_frames": path.duration},
            })
            rail_nodes.append(len(nodes) - 1)

            # animated camera
            cameras.append({
                "type": "perspective", "name": nm + "_cam",
                "perspective": {"yfov": CAM_YFOV, "aspectRatio": CAM_ASPECT,
                                "znear": CAM_ZNEAR, "zfar": CAM_ZFAR},
            })
            nodes.append({
                "camera": len(cameras) - 1, "name": nm + "_cam",
                "translation": list(eyes[0]), "rotation": list(quats[0]),
                "extras": {"hod2_kind": "camera", "hod2_file": stem,
                           "hod2_path": path.index,
                           "hod2_duration_frames": path.duration,
                           "hod2_fov_bams": CAM_FOV_BAMS,
                           "hod2_yfov_deg": math.degrees(CAM_YFOV)},
            })
            cam_node = len(nodes) - 1
            cam_nodes.append(cam_node)

            t_in = buf.scalar_f32(times)
            animations.append({
                "name": nm,
                "samplers": [
                    {"input": t_in, "output": buf.vec3(eyes),
                     "interpolation": "LINEAR"},
                    {"input": t_in, "output": buf.vec4(quats),
                     "interpolation": "LINEAR"},
                ],
                "channels": [
                    {"sampler": 0, "target": {"node": cam_node, "path": "translation"}},
                    {"sampler": 1, "target": {"node": cam_node, "path": "rotation"}},
                ],
            })

    out = []
    for children, label in ((rail_nodes, "camera_rails"),
                            (cam_nodes, "cameras"),
                            (obj_nodes, "object_paths")):
        if children:
            nodes.append({"name": label, "children": children,
                          "extras": {"hod2_kind": label}})
            out.append(len(nodes) - 1)
    return out


GLB_MAGIC = 0x46546C67          # 'glTF'
GLB_CHUNK_JSON = 0x4E4F534A     # 'JSON'
GLB_CHUNK_BIN = 0x004E4942      # 'BIN\0'


def _pack_glb(doc: dict, blob: bytes) -> bytes:
    """Wrap a glTF document and its buffer in the binary container.

    12-byte header, then a JSON chunk padded with spaces and a BIN chunk
    padded with zeros -- both to a 4-byte boundary, as the spec requires.
    """
    js = json.dumps(doc, separators=(",", ":")).encode("utf-8")
    js += b" " * (-len(js) % 4)
    bin_pad = blob + b"\0" * (-len(blob) % 4)

    out = bytearray()
    total = 12 + 8 + len(js) + (8 + len(bin_pad) if bin_pad else 0)
    out += struct.pack("<III", GLB_MAGIC, 2, total)
    out += struct.pack("<II", len(js), GLB_CHUNK_JSON) + js
    if bin_pad:
        out += struct.pack("<II", len(bin_pad), GLB_CHUNK_BIN) + bin_pad
    return bytes(out)


def export_level(name, parts, out_dir, collision=None, write_textures=True,
                 uv_check=False, keep_collapsed_uv=False, cam_files=None,
                 cam_step=2.0, unlit=False, model_regions=None,
                 fold_mirror_uv=False, glb=False):
    """Write one or more parts to <out_dir>/<name>.gltf plus .bin and textures/.

    With *glb* set, everything -- geometry buffer and every PNG -- is packed
    into a single self-contained ``<name>.glb`` instead. A whole stage is
    around 1300 separate texture files, and a browser fetching them one at a
    time is the slowest part of loading a bundle; one file removes the fetch
    storm entirely.

    ``parts`` is a list of (part_name, models, bank). A stage is split across
    many pol/ files, so a whole stage is exported as a single glTF with one
    node per model, grouped under a parent node per part.

    Texture IDs are numbered per bank, so tex 0 of st2_01 is unrelated to tex 0
    of st2_02. Everything keyed by texture is therefore keyed by
    (part_name, texture_id), and PNGs are written per part.
    """
    out_dir = Path(out_dir)
    if glb:
        out_dir.mkdir(parents=True, exist_ok=True)
    else:
        (out_dir / "textures").mkdir(parents=True, exist_ok=True)

    buf = _Buf()
    images: list[dict] = []
    samplers: list[dict] = []
    textures: list[dict] = []
    materials: list[dict] = []
    meshes: list[dict] = []
    nodes: list[dict] = []
    scene_nodes: list[int] = []

    img_written: dict[tuple, int] = {}     # (part, texture_id, opaque) -> glTF image
    tex_written: dict[tuple, int] = {}     # image + sampler -> glTF texture
    sampler_cache: dict[tuple, int] = {}
    mat_cache: dict[tuple, int] = {}

    def get_image(part: str, bank, tex_id: int, strip_alpha: bool) -> int | None:
        """Decode a texture to a PNG and return its glTF *image* index.

        ARGB1555/ARGB4444 textures are also used on meshes whose TSP sets
        IgnoreTexAlpha, where the hardware discards the alpha channel. Emitting
        the stored alpha for those would punch spurious holes, so they get a
        separate fully-opaque image variant.

        Note this returns an **image**, not a texture. In glTF a texture is a
        (image, sampler) pair, and the same image is routinely used by meshes
        with different TSP addressing bits -- so images and textures must be
        cached separately. See `get_texture`.
        """
        key = (part, tex_id, strip_alpha)
        if key in img_written:
            return img_written[key]
        if bank is None:
            return None
        got = bank.decode(tex_id)
        if got is None:
            return None
        w, h, rgba = got
        if uv_check:
            w = h = 128
            rgba = _checker()
        if strip_alpha:
            rgba = bytearray(rgba)
            rgba[3::4] = b"\xff" * (len(rgba) // 4)
        sub = f"textures/{part}"
        suffix = "_uvcheck" if uv_check else ("_opaque" if strip_alpha else "")
        fn = f"{sub}/tex_{tex_id:03d}{suffix}.png"
        if glb:
            # In a GLB the image is a buffer view, not a file. The name is
            # kept so a material can still be traced back to its bank slot.
            view = buf.add(png.encode_rgba(w, h, rgba))
            images.append({"bufferView": view, "mimeType": "image/png",
                           "name": f"{part}/tex_{tex_id:03d}{suffix}"})
        else:
            (out_dir / sub).mkdir(parents=True, exist_ok=True)
            if write_textures:
                png.write_rgba(out_dir / fn, w, h, rgba)
            images.append({"uri": fn})
        img_written[key] = len(images) - 1
        return img_written[key]

    def get_texture(part: str, bank, mesh, strip_alpha: bool) -> int | None:
        """glTF texture = (image, sampler) for this mesh's TSP addressing bits.

        Deduplicating on the image alone and then stamping the sampler onto the
        shared texture is wrong, and was a real bug: every material sharing an
        image ended up with the addressing modes of whichever mesh happened to
        be written last. One clamped mesh anywhere in a segment retroactively
        clamped every other mesh using that image, smearing a single row or
        column of texels across whole walls. The carved marble plinths in
        stage 2 rendered as flat streaks because of it.
        """
        img = get_image(part, bank, mesh.texture_id, strip_alpha)
        if img is None:
            return None
        smp = get_sampler(mesh)
        key = (img, smp)
        if key not in tex_written:
            textures.append({"source": img, "sampler": smp})
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
        tex_idx = (get_texture(part, bank, mesh, strip_alpha)
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
            pbr["baseColorTexture"] = {"index": tex_idx}
            # glTF multiplies baseColorTexture by baseColorFactor, which is
            # exactly what D3DTOP_MODULATE does. The per-mesh base colour is
            # this game's baked static lighting -- 32% of stage meshes carry a
            # value below 0.95, down to 0.0 -- so forcing it to white flattens
            # all of that away.
            #
            # This applies to EVERY shading mode. The port's translation sets
            # COLOROP = MODULATE unconditionally and only varies the alpha op,
            # so PowerVR2 "decal" does not replace the colour here.
            if uv_check:
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
                "texture_shading": ["decal", "modulate",
                                    "decal_alpha", "modulate_alpha"][mesh.texture_shading],
            }
        }
        if unlit:
            # HOTD2 does no runtime lighting on level geometry: illumination is
            # baked into the textures and the per-mesh base colour, and the
            # levels ship with no light sources at all. KHR_materials_unlit is
            # therefore the faithful model, not a shortcut -- and it is what
            # stops a Rendered view from coming out black.
            mat.setdefault("extensions", {})["KHR_materials_unlit"] = {}

        materials.append(mat)
        mat_cache[key] = len(materials) - 1
        return mat_cache[key]

    # ---- geometry ------------------------------------------------------
    dropped_tris = 0
    folded_uvs = 0
    for part_name, models, bank in parts:
        for model in models:
            for mesh in model.meshes:
                # Off by default: the fold is the game's fallback for devices
                # without D3DTADDRESS_MIRROR, and applying it to a target that
                # mirrors correctly destroys texturing. See
                # nl1.apply_mirror_uv_fold.
                if fold_mirror_uv:
                    folded_uvs += nl1.apply_mirror_uv_fold(mesh)
        if not keep_collapsed_uv:
            for model in models:
                for mesh in model.meshes:
                    dropped_tris += nl1.drop_collapsed_uv_triangles(mesh)
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
                node = {"mesh": len(meshes) - 1, "name": mesh_name}
                # Which streaming regions draw this model. Consecutive regions
                # overlap, so a whole-stage export shows geometry the game
                # never displays together; this is how to tell them apart.
                if model_regions:
                    info = model_regions.get((part_name, mi))
                    if info is not None:
                        node["extras"] = {
                            "hod2_regions": info["regions"],
                            # 0 default, 1 lit by the scene light array when the
                            # opcode-0x14 toggle is on, 2 drawn in an earlier layer
                            "hod2_draw_mode": info["draw_mode"],
                            # The asset slot this model occupies. A model with
                            # an empty region list is not scenery any region
                            # draws -- it is pulled in by the script with
                            # opcode 0x50, and this is what that operand names.
                            "hod2_slot": info.get("slot"),
                            "hod2_entry": info.get("entry"),
                        }
                nodes.append(node)
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

    # ---- camera and object paths ---------------------------------------
    cameras: list[dict] = []
    animations: list[dict] = []
    n_paths = 0
    if cam_files:
        scene_nodes.extend(_emit_paths(cam_files, buf, nodes, meshes, materials,
                                       cameras, animations, step=cam_step))
        n_paths = sum(len(c.paths) for c in cam_files)

    # ---- assemble ------------------------------------------------------
    bin_name = f"{name}.bin"
    if not glb:
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
        # A GLB's single buffer is the BIN chunk and carries no URI.
        "buffers": ([{"byteLength": len(buf.data)}] if glb
                    else [{"uri": bin_name, "byteLength": len(buf.data)}]),
    }
    if images:
        doc["images"] = images
        doc["textures"] = textures
    if samplers:
        doc["samplers"] = samplers
    if cameras:
        doc["cameras"] = cameras
    if animations:
        doc["animations"] = animations
    if unlit:
        doc["extensionsUsed"] = ["KHR_materials_unlit"]

    if glb:
        out_path = out_dir / f"{name}.glb"
        out_path.write_bytes(_pack_glb(doc, bytes(buf.data)))
    else:
        out_path = out_dir / f"{name}.gltf"
        out_path.write_text(json.dumps(doc, indent=1))

    return {
        "gltf": str(out_path),
        "glb": glb,
        "dropped_collapsed_uv": dropped_tris,
        "folded_mirror_uv": folded_uvs,
        "nodes": len(nodes),
        "meshes": len(meshes),
        "materials": len(materials),
        "textures": len(textures),
        "buffer_bytes": len(buf.data),
        "cameras": len(cameras),
        "animations": len(animations),
        "paths": n_paths,
    }
