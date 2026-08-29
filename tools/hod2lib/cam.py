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
different consumers. ``CamEvalPath7`` reads seven channels and produces an eye
point, a look-at point and an integer roll; ``CamEvalObjectPath6`` reads six and
converts the last three with ``__ftol``, i.e. they are BAMS angles, not floats.

Every part of that description is taken from the code rather than inferred, and
the chain is worth writing down because it is what makes the repair below
defensible (see docs/re/anomalies.md):

* the loader (``0x00403f89``) reads the path count from the EXE table at
  ``0x004C476C`` and computes the curve base as
  ``LEA ECX, [EAX + EDX*4 + 4]`` -- the loaded file pointer plus ``4 + n*4``.
  Parsing *n* by scanning to the ``0xFFFFFFFF`` terminator gives the same
  number for all 23 shipped files, so the two agree.
* ``CamBindPathSlots`` (``0x00404000``) walks the offset table and the EXE slot
  list in lockstep, so path *k* of a file is global slot ``slot_list[k]``:
  ``*(int *)(&DAT_0059c9f8 + slot * 8) = *piVar4 + DAT_0059c9ec``. It performs
  no fixup, relocation or decode of the payload -- the bytes the evaluator sees
  are the bytes ``ReadFile`` put there.
* ``CamEvalPath7`` (``0x004041E0``) resolves a channel as
  ``curve_base + descriptor[ch] * 4``.
* ``CamEvalHermiteCurve`` (``0x004040F0``) indexes
  ``*(float *)(param_1 + i * 8 + 2)`` on a ``ushort *``, i.e. byte
  ``i * 16 + 4``, and reads ``pfVar1[-3]``, ``pfVar1[-2]``, ``pfVar1[1]`` and
  ``pfVar1[3]`` -- fixing the key stride at 16 bytes and the field order at
  ``{time, value, tangent_out, tangent_in}``.

Evaluation is then a textbook cubic Hermite segment::

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

The last two are independent -- ``CamEvalPath7`` takes the descriptor pointer
from the first and the curve base from the second -- and they agree for all 418
slots, which is one more check that the binding above is read correctly.

Reference: docs/formats/cam.md, docs/re/anomalies.md
"""

from __future__ import annotations

import struct
from bisect import bisect_left
from collections import Counter
from dataclasses import dataclass, field

TERMINATOR = 0xFFFFFFFF
KEY_SIZE = 16

#: A padding key's time field. ``key_count`` is always a power of two because
#: the binary search does a fixed ``log2(count)`` steps, so short curves are
#: padded out and the padding is marked with a NaN time.
PAD_TIME = b"\x00\x00\xff\xff"

#: Anything beyond this is not a coordinate in a level that spans ~6700 units;
#: the smashed words decode to around 1e38. See :func:`_is_sane`.
FLOAT_LIMIT = 1e30

#: Channel order for the two path families.
CP_CHANNELS = ("eye_x", "eye_y", "eye_z", "target_x", "target_y", "target_z", "roll")
OP_CHANNELS = ("pos_x", "pos_y", "pos_z", "rot_x", "rot_y", "rot_z")

#: Channels the consumer reads through __ftol, i.e. integers (BAMS angles).
CP_INT_CHANNELS = frozenset({"roll"})
OP_INT_CHANNELS = frozenset({"rot_x", "rot_y", "rot_z"})

FIELDS = ("time", "value", "tangent_out", "tangent_in")


def _f(word: bytes) -> float:
    return struct.unpack("<f", word)[0]


def _is_sane(v: float) -> bool:
    """True if *v* is a value a keyframe could legitimately hold."""
    return v == v and -FLOAT_LIMIT < v < FLOAT_LIMIT


def _sane_word(word: bytes) -> bool:
    return _is_sane(_f(word))


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
class Damage:
    """One keyframe field the file states wrongly, and what it was restored to.

    ``how`` names the evidence, never a preference:

    ``sibling``   the time column was taken from another channel of the same
                  path -- all seven channels of a path share one time base.
    ``duplicate`` keys sharing a time are duplicates and must be byte-identical;
                  this one differed from its twins in a single 0xFF byte.
    ``constant``  the column is otherwise one repeated word and this one differs
                  from it in a single 0xFF byte.
    ``partner``   ``tangent_out`` restored from this key's own ``tangent_in``
                  (or vice versa), which carried the same low three bytes.
    ``twin``      another key in the same curve holds the same low three bytes
                  with a sane top byte, and no other top byte occurs.
    ``order``     the only top byte that keeps the time column strictly
                  increasing between its healthy neighbours.
    ``nearest``   no exact evidence: the top byte whose value lands closest to
                  the neighbouring keys. A reconstruction, not a recovery.
    """

    key: int
    field: str
    was: bytes                  #: the four bytes on disk
    now: float                  #: the restored value
    how: str

    @property
    def exact(self) -> bool:
        return self.how != "nearest"


@dataclass
class Curve:
    offset: int          # byte offset in the file
    index: int           # dword index relative to the curve base
    search_steps: int
    keys: list[Key] = field(default_factory=list)
    words: list[list[bytes]] = field(default_factory=list, repr=False)
    _clean: list[Key] | None = field(default=None, repr=False, compare=False)
    _damage: list[Damage] = field(default_factory=list, repr=False, compare=False)
    _unrecoverable: list[str] = field(default_factory=list, repr=False,
                                      compare=False)
    _time_base: list[float] | None = field(default=None, repr=False,
                                           compare=False)

    @property
    def size(self) -> int:
        return 4 + len(self.keys) * KEY_SIZE

    # -- damage ------------------------------------------------------------

    @property
    def real_keys(self) -> list[Key]:
        """Keys with padding trimmed and smashed fields restored.

        Three separate things are being handled, and conflating them is how a
        reader ends up believing the format is unreliable when it is not.

        **Padding** is part of the format: a trailing run whose time field is
        ``0xFFFF0000``. The evaluator's binary search can select one, so the
        run is a genuine hold at the last real value; trimming it and letting
        the client clamp is equivalent and avoids a NaN.

        **Smashed bytes** are a defect in four shipped files. Individual bytes
        read ``0xFF`` where the authored value had something else. When the
        byte is the top one the float becomes NaN or about 1e38 and the damage
        is obvious; when it is a mantissa byte the result is an ordinary-looking
        number, which is why a NaN filter alone is not enough. ``cp_st1``
        path 1's ``target_y`` shows both at once: seventeen keys hold
        ``da 2c 40 41`` (12.011), four read ``da 2c 40 ff`` (NaN) and three read
        ``da 2c ff 41`` -- a plausible 31.897 that is not in the data.

        **Restoration** is possible because the file over-determines itself.
        All seven channels of a path share one time base, keys that share a
        time are duplicates, and a smashed byte leaves the other three intact.
        Every :class:`Damage` records which of those supplied the answer; only
        ``nearest`` is a reconstruction, and :attr:`unrecoverable` names what
        could not be reached at all.

        Both retail copies checked are byte-identical, so this is how the game
        ships. The game reads the same bytes -- ``CamBindPathSlots`` does no
        fixup -- so the shipped executable evaluates them too.
        """
        if self._clean is None:
            self._restore()
        return self._clean                                    # type: ignore

    @property
    def damage(self) -> list[Damage]:
        if self._clean is None:
            self._restore()
        return self._damage

    @property
    def repairs(self) -> int:
        """How many keyframe fields :attr:`real_keys` had to restore."""
        return len(self.damage)

    @property
    def unrecoverable(self) -> list[str]:
        """Fields left with no evidence at all, and so zero-filled.

        This is the difference between a restoration and a fabrication.
        ``cp_st1`` path 0's ``eye_x`` is the one real case: all eight keys hold
        ``ff 64 bc ff``, the top byte is gone from every one of them, no other
        curve in any `cam/` file carries those low three bytes, and the channel
        is constant so no neighbour constrains it. The camera's x for that
        shot is one of ±23.5, ±94.2, ±376.8, ±1507.2 and the file no longer
        says which.

        A consumer must not present such a channel as data; the exporters carry
        it through to ``Path.damaged`` so the player can badge the path rather
        than quietly flying a camera down a made-up line.
        """
        if self._clean is None:
            self._restore()
        return self._unrecoverable

    def offer_time_bases(self, bases: list[list[float]]) -> None:
        """Supply sibling channels' time columns before restoration.

        Called by :meth:`Path.restore`. Channels of a path usually share one
        time base but not always -- 538 of the 1786 same-length channel pairs
        in the undamaged files differ -- so the donor is chosen by how well it
        agrees with the healthy times this curve already holds, and only a
        donor that agrees overwhelmingly is used.
        """
        if self._clean is None:
            self._time_base = [b for b in bases if len(b) == self.kept]

    # -- restoration -------------------------------------------------------

    @property
    def kept(self) -> int:
        """Key count with the trailing padding run removed."""
        n = len(self.words)
        while n and self.words[n - 1][0] == PAD_TIME:
            n -= 1
        return n

    def _suspect(self, kept: int) -> dict[tuple[int, int], tuple[bytes | None, str]]:
        """Locate smashed fields in ``words[:kept]``.

        Returns ``{(key, field): (replacement_word, how)}``. The replacement is
        present when the evidence names the exact bytes; ``None`` means the
        field is known bad but not yet known good.
        """
        out: dict[tuple[int, int], tuple[bytes | None, str]] = {}

        # Only the top byte can turn a sane float into a non-finite one, so a
        # non-finite word is a top-byte smash and nothing else.
        for k in range(kept):
            for fi in range(4):
                if not _sane_word(self.words[k][fi]):
                    out[(k, fi)] = (None, "exponent")

        def against(members: list[int], fi: int, how: str) -> None:
            """Flag members of an equal-valued group that differ by one 0xFF."""
            col = [self.words[k][fi] for k in members if _sane_word(self.words[k][fi])]
            if len(col) < 2:
                return
            modal, n = Counter(col).most_common(1)[0]
            if n < 2:
                return
            for k in members:
                w = self.words[k][fi]
                if w == modal or not _sane_word(w):
                    continue
                d = [i for i in range(4) if w[i] != modal[i]]
                if len(d) == 1 and w[d[0]] == 0xFF and modal[d[0]] != 0xFF:
                    out[(k, fi)] = (modal, how)

        # Keys sharing a time are duplicates of one key and must be identical.
        groups: dict[bytes, list[int]] = {}
        for k in range(kept):
            groups.setdefault(self.words[k][0], []).append(k)
        for members in groups.values():
            if len(members) > 1:
                for fi in range(4):
                    against(members, fi, "duplicate")
        # A column that is otherwise a single repeated word says the same thing
        # more weakly, and catches smashes outside a duplicate run.
        for fi in range(4):
            against(list(range(kept)), fi, "constant")
        return out

    def _restore(self) -> None:
        words = self.words
        n = len(words)

        # Trailing padding: the format's own convention.
        kept = n
        while kept and words[kept - 1][0] == PAD_TIME:
            kept -= 1
        if not kept:
            self._clean = []
            return

        val = [[_f(w) for w in words[k]] for k in range(kept)]
        bad = self._suspect(kept)
        damage: list[Damage] = []

        def fix(k: int, fi: int, v: float, how: str) -> None:
            damage.append(Damage(k, FIELDS[fi], words[k][fi], v, how))
            val[k][fi] = v
            bad.pop((k, fi), None)

        # 1. Exact bytes already in hand, from a duplicate key or a constant
        #    column.
        for (k, fi), (repl, how) in list(bad.items()):
            if repl is not None:
                fix(k, fi, _f(repl), how)

        # 2. The time column, from a sibling channel of the same path. Where a
        #    sibling agrees with this curve's surviving times it states the
        #    missing ones outright -- and it also convicts a surviving time
        #    that disagrees, which is the only way to catch a smash that landed
        #    on a mantissa byte and left an ordinary-looking number behind
        #    (cp_st1 path 2's target_z reads 510 where its six siblings all say
        #    190; the bytes are 00 00 ff 43 against 00 00 3e 43).
        if self._time_base and any(f == 0 for (_, f) in bad):
            live = [k for k in range(kept) if (k, 0) not in bad]

            def score(b):
                return sum(abs(b[k] - val[k][0]) < 1e-3 for k in live)

            base = max(self._time_base, key=score)
            hit = score(base)
            # Overwhelming agreement only: at least two surviving times match
            # and matches outnumber mismatches at least three to one.
            if hit >= 2 and hit >= 3 * (len(live) - hit):
                for k in range(kept):
                    if (k, 0) in bad or abs(base[k] - val[k][0]) >= 1e-3:
                        fix(k, 0, base[k], "sibling")

        # 3. tangent_out and tangent_in of the same key are equal throughout
        #    these files; when they share their low three bytes the healthy one
        #    names the other's top byte.
        for k in range(kept):
            for fi, pf in ((2, 3), (3, 2)):
                if (k, fi) in bad and (k, pf) not in bad \
                        and words[k][fi][:3] == words[k][pf][:3]:
                    fix(k, fi, val[k][pf], "partner")

        # 4. Another key in this curve holding the same low three bytes.
        healthy: dict[bytes, set[int]] = {}
        for k in range(kept):
            for fi in range(4):
                if (k, fi) not in bad:
                    healthy.setdefault(words[k][fi][:3], set()).add(words[k][fi][3])
        for (k, fi) in list(bad):
            top = healthy.get(words[k][fi][:3])
            if top and len(top) == 1:
                fix(k, fi, _f(words[k][fi][:3] + bytes(top)), "twin")

        # 5. Remaining times: the only top byte that keeps the column strictly
        #    increasing between its healthy neighbours.
        self._restore_times(kept, val, bad, fix)

        # 6. Remaining values and tangents: the top byte landing closest to the
        #    neighbouring keys. Flagged `nearest` -- a reconstruction.
        for fi in (1, 2, 3):
            self._restore_column(kept, fi, val, bad, fix)

        # 7. Nothing left to reason from.
        for fi in range(4):
            gone = [k for k in range(kept) if (k, fi) in bad]
            if gone:
                self._unrecoverable.append(FIELDS[fi])
                for k in gone:
                    val[k][fi] = 0.0

        self._damage = damage
        self._clean = [Key(*val[k]) for k in range(kept)]

    @staticmethod
    def _candidates(word: bytes) -> dict[int, float]:
        """Every top byte that makes *word* a value a keyframe could hold."""
        out = {}
        for top in range(256):
            v = _f(word[:3] + bytes([top]))
            if _is_sane(v):
                out[top] = v
        return out

    def _restore_times(self, kept, val, bad, fix) -> None:
        k = 0
        while k < kept:
            if (k, 0) not in bad:
                k += 1
                continue
            j = k
            while j < kept and (j, 0) in bad:
                j += 1
            lo = val[k - 1][0] if k else float("-inf")
            hi = val[j][0] if j < kept else float("inf")
            runs = [sorted((v, t) for t, v in self._candidates(self.words[i][0]).items()
                           if lo < v < hi) for i in range(k, j)]
            # A strictly increasing pick through the run, nearest the straight
            # line between the healthy neighbours. Usually only one candidate
            # survives the bracket at all.
            best: dict[float, tuple[float, list[float]]] = {}
            for i, cs in enumerate(runs):
                tgt = (lo + (hi - lo) * (i + 1) / (j - k + 1)
                       if lo > float("-inf") and hi < float("inf") else None)
                cur: dict[float, tuple[float, list[float]]] = {}
                for v, _t in cs:
                    pen = abs(v - tgt) if tgt is not None else 0.0
                    if i == 0:
                        cur[v] = (pen, [v])
                    else:
                        ok = [(c + pen, p + [v]) for pv, (c, p) in best.items() if pv < v]
                        if ok:
                            cur[v] = min(ok)
                best = cur
                if not best:
                    break
            if best:
                for i, v in enumerate(min(best.values())[1]):
                    fix(k + i, 0, v, "order")
            k = j

    def _restore_column(self, kept, fi, val, bad, fix) -> None:
        for k in range(kept):
            if (k, fi) not in bad:
                continue
            cands = self._candidates(self.words[k][fi])
            if not cands:
                continue
            lo = next((i for i in range(k - 1, -1, -1) if (i, fi) not in bad), None)
            hi = next((i for i in range(k + 1, kept) if (i, fi) not in bad), None)
            if lo is None and hi is None:
                continue
            if lo is None:
                tgt = val[hi][fi]
            elif hi is None:
                tgt = val[lo][fi]
            else:
                span = val[hi][0] - val[lo][0]
                a = (val[k][0] - val[lo][0]) / span if span else 0.0
                tgt = val[lo][fi] + (val[hi][fi] - val[lo][fi]) * a
            top = min(cands, key=lambda t: abs(cands[t] - tgt))
            fix(k, fi, cands[top], "nearest")

    # -- evaluation --------------------------------------------------------

    @property
    def duration(self) -> float:
        ks = self.real_keys
        return ks[-1].time - ks[0].time if ks else 0.0

    def evaluate(self, t: float) -> float:
        """Cubic Hermite, matching CamEvalHermiteCurve.

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

    def restore(self) -> None:
        """Cross-reference the channels, then let each curve restore itself.

        The only thing one channel can tell another is the time base, but that
        is the strongest evidence in the file: seven channels state the same
        column, so one healthy channel settles a damaged one exactly rather
        than by interpolation.
        """
        by_len: dict[int, list[Curve]] = {}
        for c in self.channels.values():
            by_len.setdefault(c.kept, []).append(c)
        for n, group in by_len.items():
            clean = [c for c in group
                     if all(_sane_word(w[0]) for w in c.words[:c.kept])
                     and not any(f == 0 for (_, f) in c._suspect(c.kept))]
            if not clean:
                continue
            bases = [[_f(w[0]) for w in c.words[:n]] for c in clean]
            for c in group:
                c.offer_time_bases([b for d, b in zip(clean, bases) if d is not c])

    @property
    def duration(self) -> float:
        return max((c.duration for c in self.channels.values()), default=0.0)

    @property
    def repairs(self) -> int:
        return sum(c.repairs for c in self.channels.values())

    @property
    def damage(self) -> dict[str, list[Damage]]:
        return {n: c.damage for n, c in self.channels.items() if c.damage}

    @property
    def damaged(self) -> dict[str, list[str]]:
        """Channels holding invented values, as ``{channel: [field, ...]}``.

        Empty for every path in the game except ``cp_st1`` path 0, whose
        ``eye_x`` is gone beyond recovery. A non-empty result means the curve
        cannot be trusted as data. Restored channels are *not* listed here --
        see :attr:`damage` for those.
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
        # consumer CamEvalPath7 never reads; op_ descriptors are exactly six.
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
        for p in self.paths:
            p.restore()
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
        CamEvalHermiteCurve needs to terminate on the right key).

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
        so a table-driven walk desynchronises on them. That the walk lands
        exactly on the end of every one of the 23 shipped files, with no slack,
        is the check that it stays in step.
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
            words = [[self.raw[off + 4 + i * KEY_SIZE + f * 4:
                               off + 4 + i * KEY_SIZE + f * 4 + 4]
                      for f in range(4)] for i in range(count)]
            keys = [Key(*(_f(w) for w in row)) for row in words]
            idx = (off - self.base) // 4
            self.curves[idx] = Curve(off, idx, steps, keys, words)
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
