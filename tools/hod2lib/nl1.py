"""
NaomiLib NL1 model parser.

See docs/formats/nl1.md for the format specification.

Written from the spec rather than ported from the Blender addon, and it
deliberately fixes four defects present there:

  1. mesh end is ``hdr + 0x50 + mesh_data_size`` uniformly (the addon uses
     ``size + 0x64`` for mesh 0, four bytes short)
  2. the texture_control address mask is 0x1FFFFFF (the addon uses decimal 23)
  3. bump vertices are 56 bytes, not 32
  4. bit 0 of vertex x, vertex v and tex_ambient are flags, not float data,
     and produce denormals if read naively
"""

from __future__ import annotations

import struct
from dataclasses import dataclass, field

__all__ = ["Model", "Mesh", "Strip", "Vertex", "parse", "NL1Error"]


class NL1Error(Exception):
    pass


OBJ_HEADER = 0x18
MESH_HEADER = 0x50

# shading modes (mesh header +0x24)
SHADE_VERTEX_COLOUR = -3
SHADE_BUMP = -2
SHADE_CONSTANT = -1

PIXFMT = ["ARGB1555", "RGB565", "ARGB4444", "YUV422", "BUMP", "PAL4", "PAL8", "RESERVED"]


def _f32(b: bytes, off: int) -> float:
    """Read an f32, clamping denormals to zero.

    Bit 0 of some fields is used as a flag, which turns +0.0 into 0x00000001 --
    a denormal. Left alone these propagate as absurd 1e-45 values.
    """
    v = struct.unpack_from("<f", b, off)[0]
    if v != 0.0 and abs(v) < 1e-30:
        return 0.0
    return v


def _vec3(b: bytes, off: int) -> tuple[float, float, float]:
    return (_f32(b, off), _f32(b, off + 4), _f32(b, off + 8))


def _s8f(n: int) -> float:
    """Packed signed byte to float, per the NaomiLib convention."""
    return (n - 0x100) / 128.0 if n > 0x7F else n / 127.0


@dataclass
class Vertex:
    pos: tuple[float, float, float]
    normal: tuple[float, float, float] = (0.0, 0.0, 0.0)
    uv: tuple[float, float] = (0.0, 0.0)
    colour: tuple[float, float, float, float] | None = None


@dataclass
class Strip:
    flags: int
    culling: int
    is_triangle_list: bool
    vertex_slots: list[int] = field(default_factory=list)

    @property
    def env_mapped(self) -> bool:
        return bool(self.flags & 0x100)


@dataclass
class Mesh:
    offset: int
    parameter_control: int
    isp_tsp: int
    tsp: int
    texture_control: int
    centroid: tuple[float, float, float]
    radius: float
    texture_id: int
    shading: int
    base_colour: tuple[float, float, float, float]      # A R G B
    offset_colour: tuple[float, float, float, float]
    vertices: list[Vertex] = field(default_factory=list)
    strips: list[Strip] = field(default_factory=list)
    triangles: list[tuple[int, int, int]] = field(default_factory=list)

    # ---- decoded render state -------------------------------------------
    @property
    def texture_width(self) -> int:
        return 8 << ((self.tsp >> 3) & 7)

    @property
    def texture_height(self) -> int:
        return 8 << (self.tsp & 7)

    @property
    def pixel_format(self) -> int:
        return (self.texture_control >> 27) & 7

    @property
    def pixel_format_name(self) -> str:
        return PIXFMT[self.pixel_format]

    @property
    def vq_compressed(self) -> bool:
        return bool((self.texture_control >> 30) & 1)

    @property
    def mipmapped(self) -> bool:
        return bool((self.texture_control >> 31) & 1)

    @property
    def twiddled(self) -> bool:
        return not ((self.texture_control >> 26) & 1)

    @property
    def textured(self) -> bool:
        return self.texture_id >= 0 and bool(self.parameter_control & 0x08)

    @property
    def list_type(self) -> int:
        """0 opaque, 1 opaque mod-vol, 2 translucent, 3 trans mod-vol, 4 punch-through."""
        return (self.parameter_control >> 24) & 7

    @property
    def punch_through(self) -> bool:
        return self.list_type == 4

    @property
    def translucent(self) -> bool:
        return self.list_type in (2, 3)

    @property
    def gouraud(self) -> bool:
        return bool(self.parameter_control & 0x02)

    @property
    def use_alpha(self) -> bool:
        return bool((self.tsp >> 20) & 1)

    @property
    def ignore_texture_alpha(self) -> bool:
        return bool((self.tsp >> 19) & 1)

    @property
    def src_blend(self) -> int:
        return (self.tsp >> 29) & 7

    @property
    def dst_blend(self) -> int:
        return (self.tsp >> 26) & 7

    @property
    def texture_shading(self) -> int:
        """TSP bits 6-7: 0 decal, 1 modulate, 2 decal-alpha, 3 modulate-alpha.

        Under modulate the hardware multiplies the texture by the polygon's
        base colour, which is how this game bakes its static lighting.
        """
        return (self.tsp >> 6) & 3

    @property
    def modulates_base_colour(self) -> bool:
        return self.texture_shading in (1, 3)

    @property
    def additive(self) -> bool:
        """src_alpha / one -- additive blending, used for glows and effects."""
        return self.translucent and self.src_blend == 4 and self.dst_blend == 1

    @property
    def clamp_uv(self) -> int:
        return (self.tsp >> 15) & 3

    @property
    def flip_uv(self) -> int:
        return (self.tsp >> 17) & 3

    @property
    def filter_mode(self) -> int:
        return (self.tsp >> 13) & 3

    @property
    def shading_mode_name(self) -> str:
        return {
            SHADE_VERTEX_COLOUR: "vertex_colour",
            SHADE_BUMP: "bump",
            SHADE_CONSTANT: "constant",
        }.get(self.shading, "lambert")

    @property
    def double_sided(self) -> bool:
        """Culling comes from the strips, not the mesh header."""
        return any(s.culling in (0, 1) for s in self.strips)

    @property
    def palette_index(self) -> int | None:
        """PAL4/PAL8 meshes overload offset-colour-alpha with a palette index."""
        if self.pixel_format in (5, 6):
            return struct.unpack("<I", struct.pack("<f", self.offset_colour[0]))[0]
        return None


@dataclass
class Model:
    obj_format: int
    global_flag: int
    centroid: tuple[float, float, float]
    radius: float
    meshes: list[Mesh] = field(default_factory=list)

    @property
    def vertex_count(self) -> int:
        return sum(len(m.vertices) for m in self.meshes)

    @property
    def triangle_count(self) -> int:
        return sum(len(m.triangles) for m in self.meshes)

    @property
    def texture_ids(self) -> set[int]:
        return {m.texture_id for m in self.meshes if m.texture_id >= 0}


def is_model(b: bytes, off: int = 0) -> bool:
    if off + OBJ_HEADER > len(b):
        return False
    obj, flag = struct.unpack_from("<2I", b, off)
    return obj in (0, 1) and bool(flag & 1) and not (flag & ~0x1F)


def _read_vertex(b: bytes, pos: int, shading: int) -> tuple[Vertex, int]:
    """Return (vertex, bytes consumed)."""
    if shading == SHADE_VERTEX_COLOUR:
        # 32 bytes: pos, packed s8 normal, two ARGB colours, uv
        v = Vertex(
            pos=_vec3(b, pos),
            normal=(_s8f(b[pos + 0x0E]), _s8f(b[pos + 0x0D]), _s8f(b[pos + 0x0C])),
            uv=(_f32(b, pos + 0x18), _f32(b, pos + 0x1C)),
        )
        bb, gg, rr, aa = b[pos + 0x10 : pos + 0x14]
        v.colour = (rr / 255.0, gg / 255.0, bb / 255.0, aa / 255.0)
        return v, 32

    if shading == SHADE_BUMP:
        # 56 bytes: pos, normal, tangent, binormal, uv
        return Vertex(
            pos=_vec3(b, pos),
            normal=_vec3(b, pos + 0x0C),
            uv=(_f32(b, pos + 0x30), _f32(b, pos + 0x34)),
        ), 56

    # 32 bytes: pos, normal, uv
    return Vertex(
        pos=_vec3(b, pos),
        normal=_vec3(b, pos + 0x0C),
        uv=(_f32(b, pos + 0x18), _f32(b, pos + 0x1C)),
    ), 32


def _emit_triangles(strip: Strip, tris: list[tuple[int, int, int]]) -> None:
    """Convert a strip to triangles wound counter-clockwise (glTF front face).

    Winding was settled empirically against the stored per-vertex normals: for
    each candidate rule, compare the geometric normal (b-a) x (c-a) against the
    summed vertex normals and take the rule that agrees.

    Both primitive types share the same base winding -- the first two indices
    are swapped -- and reversal keys on culling mode 3 ("rclock", i.e. reversed
    clockwise), not mode 2. Measured over the whole corpus:

        triangle lists  base (b,a,c)  100.0% agreement (cull 1 and 2)
        strips          swap on even   99.6% agreement with reverse-on-cull-3
                                       (77.8% with no reversal at all)
    """
    s = strip.vertex_slots
    reverse = strip.culling == 3

    if strip.is_triangle_list:
        for i in range(0, len(s) - 2, 3):
            a, b_, c = s[i], s[i + 1], s[i + 2]
            tris.append((a, b_, c) if reverse else (b_, a, c))
        return

    for j in range(len(s) - 2):
        a, b_, c = s[j], s[j + 1], s[j + 2]
        swap = ((j % 2) == 0) != reverse
        tris.append((b_, a, c) if swap else (a, b_, c))


def _uv_area(a: Vertex, b_: Vertex, c: Vertex) -> float:
    return 0.5 * abs((b_.uv[0] - a.uv[0]) * (c.uv[1] - a.uv[1])
                     - (c.uv[0] - a.uv[0]) * (b_.uv[1] - a.uv[1]))


def drop_collapsed_uv_triangles(mesh: "Mesh", eps: float = 1e-7) -> int:
    """Remove triangles whose UV area is ~zero. Returns how many were dropped.

    Such a triangle has all three vertices on one line in UV space, so a single
    row or column of texels is smeared across its whole 2D extent. On screen
    that is a hard directional streak, and it is what makes affected faces look
    stretched -- or solid black when the sampled texels happen to be dark.

    They are strip-boundary artifacts: measured across st2_07 they are 4.9% of
    first triangles and 4.8% of last triangles in a strip, but only 1.1% of
    middle ones. Only 8.6% involve a back-reference, so this is not a
    vertex-reuse fault.

    Why the game does not show them is still unresolved -- the hardware may
    reject zero-area-in-UV polygons, or they may be hidden by other geometry
    along the camera rail. Either way they carry no displayable texture
    information, so dropping them can only improve the result.
    """
    keep = [t for t in mesh.triangles
            if _uv_area(mesh.vertices[t[0]], mesh.vertices[t[1]],
                        mesh.vertices[t[2]]) >= eps]
    dropped = len(mesh.triangles) - len(keep)
    mesh.triangles = keep
    return dropped


def parse(b: bytes, off: int = 0, strict: bool = False) -> Model:
    """Parse one NL1 model starting at off."""
    if not is_model(b, off):
        raise NL1Error(f"no NL1 header at {off:#x}")

    obj, flag = struct.unpack_from("<2I", b, off)
    model = Model(obj, flag, _vec3(b, off + 8), _f32(b, off + 0x14))

    pos = off + OBJ_HEADER
    while True:
        if pos + 4 > len(b):
            break
        if struct.unpack_from("<I", b, pos)[0] == 0:
            break  # end of mesh chain
        if pos + MESH_HEADER > len(b):
            if strict:
                raise NL1Error(f"truncated mesh header at {pos:#x}")
            break

        hdr = pos
        pcw, isp, tsp, tct = struct.unpack_from("<4I", b, hdr)
        tex_id, shading = struct.unpack_from("<2i", b, hdr + 0x20)
        size = struct.unpack_from("<I", b, hdr + 0x4C)[0]

        if size == 0 or hdr + MESH_HEADER + size > len(b):
            if strict:
                raise NL1Error(f"implausible mesh size {size} at {hdr:#x}")
            break

        mesh = Mesh(
            offset=hdr,
            parameter_control=pcw,
            isp_tsp=isp,
            tsp=tsp,
            texture_control=tct,
            centroid=_vec3(b, hdr + 0x10),
            radius=_f32(b, hdr + 0x1C),
            texture_id=tex_id,
            shading=shading,
            base_colour=tuple(_f32(b, hdr + 0x2C + 4 * i) for i in range(4)),
            offset_colour=tuple(_f32(b, hdr + 0x3C + 4 * i) for i in range(4)),
        )

        pos = hdr + MESH_HEADER
        mesh_end = pos + size
        offset_to_index: dict[int, int] = {}

        while pos < mesh_end:
            if pos + 8 > mesh_end:
                break
            gflag, count = struct.unpack_from("<2I", b, pos)
            pos += 8

            is_tris = bool(gflag & 0x08)
            n = count * 3 if is_tris else count
            if n == 0 or n > 0x10000:
                break

            strip = Strip(flags=gflag, culling=gflag & 3, is_triangle_list=is_tris)

            ok = True
            for _ in range(n):
                if pos + 4 > mesh_end:
                    ok = False
                    break
                w0 = struct.unpack_from("<I", b, pos)[0]

                if (w0 >> 20) == 0x5FF:
                    # back-reference: reuse an earlier vertex in this mesh
                    if pos + 8 > mesh_end:
                        ok = False
                        break
                    rel = struct.unpack_from("<i", b, pos + 4)[0]
                    target = pos + 8 + rel
                    idx = offset_to_index.get(target)
                    if idx is None:
                        ok = False
                        break
                    strip.vertex_slots.append(idx)
                    pos += 8
                else:
                    if pos + 32 > mesh_end:
                        ok = False
                        break
                    v, consumed = _read_vertex(b, pos, shading)
                    offset_to_index[pos] = len(mesh.vertices)
                    strip.vertex_slots.append(len(mesh.vertices))
                    mesh.vertices.append(v)
                    pos += consumed

            if strip.vertex_slots:
                mesh.strips.append(strip)
                _emit_triangles(strip, mesh.triangles)
            if not ok:
                break

        pos = mesh_end
        model.meshes.append(mesh)

    return model


def parse_container(c) -> list[Model]:
    """Parse every model in a hod2lib.container.Container."""
    out = []
    for start, end in c.models:
        try:
            out.append(parse(c.data[:end], start))
        except NL1Error:
            pass
    return out
