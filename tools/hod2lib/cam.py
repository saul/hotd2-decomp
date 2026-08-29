"""`cam/` camera and object paths — cubic Hermite spline curves.

A `cam/` file is a pool of independent scalar animation curves plus a small
descriptor per path that names the curves for each channel.

File layout::

    +0x00   u32 path_offset[n]     byte offset of each path descriptor
            u32 0xFFFFFFFF         terminator -- gives *n* without the EXE
    +base   ...                    curve pool and path descriptors, interleaved
                                   (base = 4 + n*4)

Curve indices inside a path descriptor are **dword indices relative to
base**, i.e. ``curve_addr = base + index * 4``.

Curve::

    +0x00   u16 key_count          always a power of two
    +0x02   u16 search_steps       log2(key_count), the binary-search depth
    +0x04   key[key_count]         16 bytes each:
                +0x00  f32 time
                +0x04  f32 value
                +0x08  f32 tangent_out   (used leaving this key)
                +0x0C  f32 tangent_in    (used arriving at this key)

Path descriptor: one u32 curve index per channel.

    cp_*  7 channels  eye.x eye.y eye.z  target.x target.y target.z  roll
    op_*  6 channels  pos.x pos.y pos.z  rot.x rot.y rot.z

That split is what distinguishes the two families: identical container, two
different consumers. ``FUN_004041E0`` reads seven channels and produces an eye
point, a look-at point and an integer roll; ``FUN_004042D0`` reads six and
converts the last three with ``__ftol``, i.e. they are BAMS angles, not floats.

Evaluation (``FUN_004040F0``) is a textbook cubic Hermite segment::

    h  = t1 - t0
    s  = (t - t0) / h
    v  = (2s^3 - 3s^2 + 1) * v0
       + (s^3 - 2s^2 + s)  * h * m0      m0 = key[i-1].tangent_out
       + (-2s^3 + 3s^2)    * v1
       + (s^3 - s^2)       * h * m1      m1 = key[i].tangent_in

so tangents are expressed in value-per-unit-time and the curves map directly
onto glTF ``CUBICSPLINE`` samplers.

Binding: which path slot a file's entry *k* occupies is not in the file. Three
parallel tables in the EXE hold it (see :mod:`hod2lib.exetab`):

    0x004C476C  u16  path count per cam file
    0x004C470C  ptr  -> s16[count], the global slot id of each path
    0x004C479C  s8   slot -> owning cam file index

Reference: docs/formats/cam.md
"""

from __future__ import annotations

import struct
from bisect import bisect_left
from dataclasses import dataclass, field

TERMINATOR = 0xFFFFFFFF
KEY_SIZE = 16

#: Anything beyond this is not a coordinate in a level that spans ~6700 units;
#: the damaged words in ``cp_st1.bin`` decode to around 1e38. See
#: :func:`_is_sane` and docs/re/anomalies.md.
FLOAT_LIMIT = 1e30


def _is_sane(v: float) -> bool:
    """True if *v* is a value a keyframe could legitimately hold."""
    return v == v and -FLOAT_LIMIT < v < FLOAT_LIMIT

#: Channel order for the two path families.
CP_CHANNELS = ("eye_x", "eye_y", "eye_z", "target_x", "target_y", "target_z", "roll")
OP_CHANNELS = ("pos_x", "pos_y", "pos_z", "rot_x", "rot_y", "rot_z")

#: Channels the consumer reads through __ftol, i.e. integers (BAMS angles).
CP_INT_CHANNELS = frozenset({"roll"})
OP_INT_CHANNELS = frozenset({"rot_x", "rot_y", "rot_z"})


class CamError(Exception):
    pass


@dataclass
class Key:
    time: float
    value: float
    tangent_out: float
    tangent_in: float


def _with(k: "Key", field_name: str, value: float) -> "Key":
    d = {"time": k.time, "value": k.value,
         "tangent_out": k.tangent_out, "tangent_in": k.tangent_in}
    d[field_name] = value
    return Key(**d)


@dataclass
class Curve:
    offset: int          # byte offset in the file
    index: int           # dword index relative to the curve base
    search_steps: int
    keys: list[Key] = field(default_factory=list)
    _clean: list[Key] | None = field(default=None, repr=False, compare=False)
    _repairs: int = field(default=0, repr=False, compare=False)
    _unrecoverable: list[str] = field(default_factory=list, repr=False,
                                      compare=False)

    @property
    def size(self) -> int:
        return 4 + len(self.keys) * KEY_SIZE

    @property
    def real_keys(self) -> list[Key]:
        """Keys with padding trimmed and damaged fields repaired.

        Two separate things are being handled here, and they must not be
        confused with each other.

        **Padding** is part of the format. ``key_count`` is always a power of
        two because the binary search in ``FUN_004040F0`` does a fixed
        ``log2(count)`` steps, so curves with fewer real keys are padded out
        and a padding slot is marked by storing ``0xFFFF0000`` -- a NaN -- in
        its time field. Padding is always a **trailing** run, and the
        evaluator would return NaN if one were selected, so it is trimmed.

        **Damage** is a defect in three shipped files. Measured over the whole
        corpus (``verify_phase6.py`` prints it):

            cp_demo.bin    20 damaged words
            cp_st1.bin     91 damaged words, plus 12 trailing padding slots
            cp_title.bin    8 damaged words
            ------------------------------------------------
            total         119 damaged interior words

        They decode to NaN or to ~1e38. In ``cp_st1.bin`` they are scattered
        through the first four paths -- and those paths *are* played by
        ``st1evtbl``. (An earlier revision of this docstring said cp_st1 had
        103; that was its 91 damaged words plus the 12 padding slots counted
        together, which is exactly the conflation this docstring warns
        against.)
        Both retail copies checked are byte-identical, so this is how the game
        ships, not local corruption. A damaged interior time is repaired by
        interpolating between its finite neighbours (times are a monotone
        frame sequence, so that is determined); a damaged value or tangent is
        held from the nearest finite key, which the flat neighbouring keys in
        those curves show to be the intended shape. :attr:`repairs` counts
        them and ``verify_phase6.py`` reports them, so the repair is never
        silent.

        See docs/re/anomalies.md.
        """
        if self._clean is None:
            self._clean, self._repairs = self._clean_keys()
        return self._clean

    @property
    def repairs(self) -> int:
        """How many damaged keyframe fields :attr:`real_keys` had to repair."""
        if self._clean is None:
            self._clean, self._repairs = self._clean_keys()
        return self._repairs

    @property
    def unrecoverable(self) -> list[str]:
        """Fields that were zero-filled because the curve held no finite value.

        This is the difference between a repair and a fabrication, and it
        matters. Holding a damaged key from a finite neighbour reconstructs
        something the surrounding keys evidence. A channel where *every* value
        is damaged evidences nothing, and the 0.0 that goes in its place is an
        invention -- ``cp_st1`` path 0's ``eye_x`` is exactly that case, all
        eight values gone.

        A consumer must not present such a curve as data. The exporters carry
        it through to ``Path.damaged`` so the browser player can badge the
        path rather than quietly flying a camera down a made-up line.
        """
        if self._clean is None:
            self._clean, self._repairs = self._clean_keys()
        return self._unrecoverable

    def _clean_keys(self) -> tuple[list[Key], int]:
        ks = list(self.keys)
        # Trailing padding: the format's own convention.
        end = len(ks)
        while end and not _is_sane(ks[end - 1].time):
            end -= 1
        ks = ks[:end]
        if not ks:
            return [], 0

        repairs = 0
        # Interior damaged times: interpolate across the gap.
        for i, k in enumerate(ks):
            if _is_sane(k.time):
                continue
            lo = next((j for j in range(i - 1, -1, -1)
                       if _is_sane(ks[j].time)), None)
            hi = next((j for j in range(i + 1, len(ks))
                       if _is_sane(ks[j].time)), None)
            if lo is None or hi is None:
                continue                       # left for the drop pass below
            span = ks[hi].time - ks[lo].time
            ks[i] = Key(ks[lo].time + span * (i - lo) / (hi - lo),
                        k.value, k.tangent_out, k.tangent_in)
            repairs += 1
        before = len(ks)
        ks = [k for k in ks if _is_sane(k.time)]
        repairs += before - len(ks)

        # Damaged values and tangents: hold the nearest finite key.
        for field in ("value", "tangent_out", "tangent_in"):
            good = [i for i, k in enumerate(ks) if _is_sane(getattr(k, field))]
            if len(good) == len(ks):
                continue
            if not good:
                # Nothing to reconstruct from. Zero-fill so the curve is at
                # least evaluable, and record that the result is invented --
                # see the note on `unrecoverable`.
                for i, k in enumerate(ks):
                    ks[i] = _with(k, field, 0.0)
                repairs += len(ks)
                self._unrecoverable.append(field)
                continue
            for i, k in enumerate(ks):
                if _is_sane(getattr(k, field)):
                    continue
                j = min(good, key=lambda g: abs(g - i))
                ks[i] = _with(k, field, getattr(ks[j], field))
                repairs += 1
        return ks, repairs

    @property
    def duration(self) -> float:
        ks = self.real_keys
        return ks[-1].time - ks[0].time if ks else 0.0

    def evaluate(self, t: float) -> float:
        """Cubic Hermite, matching FUN_004040F0.

        The game clamps by construction rather than by test: its binary search
        cannot leave the key array, so times outside the curve extrapolate
        along the end segments. This reproduces that.
        """
        keys = self.real_keys
        if not keys:
            return 0.0
        if len(keys) == 1:
            return keys[0].value
        i = bisect_left([k.time for k in keys], t)
        i = min(max(i, 1), len(keys) - 1)
        k0, k1 = keys[i - 1], keys[i]
        h = k1.time - k0.time
        if h == 0.0:
            return k1.value
        s = (t - k0.time) / h
        s2, s3 = s * s, s * s * s
        return (
            (2 * s3 - 3 * s2 + 1) * k0.value
            + (s3 - 2 * s2 + s) * h * k0.tangent_out
            + (-2 * s3 + 3 * s2) * k1.value
            + (s3 - s2) * h * k1.tangent_in
        )


@dataclass
class Path:
    index: int                       # position in the file's offset table
    offset: int                      # byte offset of the descriptor
    channels: dict[str, Curve] = field(default_factory=dict)
    trailing: int = 0                # dword after the channel list, see notes

    @property
    def duration(self) -> float:
        return max((c.duration for c in self.channels.values()), default=0.0)

    @property
    def damaged(self) -> dict[str, list[str]]:
        """Channels holding invented values, as ``{channel: [field, ...]}``.

        Empty for every path in the game except the first four of ``cp_st1``
        and a handful in ``cp_demo`` and ``cp_title``. A non-empty result means
        the curve cannot be trusted as data.
        """
        return {n: c.unrecoverable
                for n, c in self.channels.items() if c.unrecoverable}

    def sample(self, t: float) -> dict[str, float]:
        return {n: c.evaluate(t) for n, c in self.channels.items()}


class CamFile:
    """A parsed `cam/` file."""

    def __init__(self, data: bytes, name: str = ""):
        self.raw = data
        self.name = name
        self.is_object_path = name.startswith("op_")
        self.channel_names = OP_CHANNELS if self.is_object_path else CP_CHANNELS
        # cp_ descriptors carry an eighth curve index the seven-channel
        # consumer FUN_004041E0 never reads; op_ descriptors are exactly six.
        self.descriptor_words = 6 if self.is_object_path else 8
        self.path_offsets: list[int] = []
        self.base = 0
        self.curves: dict[int, Curve] = {}     # by dword index
        self.paths: list[Path] = []
        self.unnamed_descriptors: list[int] = []
        self.descriptor_spans: list[tuple[int, int]] = []
        self.repairs: list[tuple[int, int, int]] = []
        self.pool_end = 0
        self.warnings: list[str] = []

    # -- parsing -----------------------------------------------------------

    def parse(self) -> "CamFile":
        self._read_table()
        self._read_curve_pool()
        self._read_paths()
        return self

    def _read_table(self) -> None:
        n = 0
        while True:
            if (n + 1) * 4 > len(self.raw):
                raise CamError("%s: offset table has no terminator" % self.name)
            v = struct.unpack_from("<I", self.raw, n * 4)[0]
            if v == TERMINATOR:
                break
            self.path_offsets.append(v)
            n += 1
        self.base = (n + 1) * 4

    def _is_curve_header(self, off: int) -> bool:
        """A curve header is unambiguous: key_count is a power of two and
        search_steps is exactly its log2 (that is what the binary search in
        FUN_004040F0 needs to terminate on the right key).

        No descriptor dword can imitate one -- a channel index whose low half
        is a power of two and whose high half is its log2 would address a
        curve hundreds of kilobytes past the end of any shipped file.
        """
        if off + 4 > len(self.raw):
            return False
        count, steps = struct.unpack_from("<2H", self.raw, off)
        if count == 0 or count & (count - 1):
            return False
        if count.bit_length() - 1 != steps:
            return False
        return off + 4 + count * KEY_SIZE <= len(self.raw)

    def _read_curve_pool(self) -> None:
        """Walk the pool linearly from *base*.

        Curves and path descriptors are interleaved: each path's curves are
        followed by that path's descriptor. The walk chains
        ``4 + key_count * 16`` through curves and steps over anything that is
        not a curve header as a descriptor.

        The offset table is deliberately *not* used to locate descriptors --
        ``op_st1`` and ``op_st6`` contain descriptors the table never names,
        so a table-driven walk desynchronises on them.
        """
        off = self.base
        end = len(self.raw)
        named = set(self.path_offsets)
        while off + 4 <= end:
            if not self._is_curve_header(off):
                if off not in named:
                    self.unnamed_descriptors.append(off)
                # Descriptor length is not fixed across op_ files, so take it
                # structurally: run to the next curve header.
                step = self._descriptor_size()
                probe = off + 4
                while probe < end and not self._is_curve_header(probe):
                    probe += 4
                    if probe - off > 16 * 4:
                        break
                step = max(step, probe - off)
                self.descriptor_spans.append((off, step))
                off += step
                continue
            count, steps = struct.unpack_from("<2H", self.raw, off)
            keys = [
                Key(*struct.unpack_from("<4f", self.raw, off + 4 + i * KEY_SIZE))
                for i in range(count)
            ]
            idx = (off - self.base) // 4
            self.curves[idx] = Curve(off, idx, steps, keys)
            off += 4 + count * KEY_SIZE
        self.pool_end = off

    def _descriptor_size(self) -> int:
        return self.descriptor_words * 4

    def _repair_offsets(self) -> list[int]:
        """Fix corrupt entries in the path offset table.

        ``op_st1.bin`` ships with six table entries that are not even dword
        aligned and point into the middle of keyframe data. The descriptors
        they should name do exist -- the structural pool walk finds exactly
        six descriptors the table never mentions -- and both lists are
        ascending, so the pairing is unambiguous.

        Every other shipped file needs no repair; this is a data defect in one
        file, not a gap in the format. See docs/re/anomalies.md.
        """
        found = sorted(o for o, _ in self.descriptor_spans)
        claimed = set(self.path_offsets) & set(found)
        spare = [o for o in found if o not in claimed]
        out: list[int] = []
        k = 0
        for i, off in enumerate(self.path_offsets):
            if off in claimed:
                out.append(off)
                continue
            if k < len(spare):
                self.repairs.append((i, off, spare[k]))
                out.append(spare[k])
                k += 1
            else:
                self.warnings.append(
                    "path %d: table offset %#x is not a descriptor and no "
                    "unclaimed descriptor remains" % (i, off)
                )
                out.append(off)
        return out

    def _read_paths(self) -> None:
        n = len(self.channel_names)
        w = self.descriptor_words
        for i, off in enumerate(self._repair_offsets()):
            if off + w * 4 > len(self.raw):
                self.warnings.append("path %d: descriptor past end" % i)
                continue
            idx = struct.unpack_from("<%dI" % w, self.raw, off)
            path = Path(index=i, offset=off, trailing=idx[n] if w > n else 0)
            for name, ci in zip(self.channel_names, idx):
                curve = self.curves.get(ci)
                if curve is None:
                    self.warnings.append(
                        "path %d: channel %s index %#x is not a curve start"
                        % (i, name, ci)
                    )
                    continue
                path.channels[name] = curve
            self.paths.append(path)


def load(path: str) -> CamFile:
    import os

    with open(path, "rb") as fh:
        return CamFile(fh.read(), os.path.basename(path)).parse()
