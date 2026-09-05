#!/usr/bin/env python3
"""Compare two exported bundles, and name the first place they disagree.

There are two exporters now -- `tools/hod2lib/`, which is the reference, and
`web/src/hod2lib/`, which is the same thing in TypeScript so that it can run in
a browser. Two implementations of one format specification is exactly the drift
this repository spends most of its checks preventing, so this is the check that
makes it survivable.

**What "identical" means, precisely.** Three of the four output kinds are
compared for *structural* equality and one for bytes:

    <stage>.glb BIN chunk      byte for byte
    <stage>.glb JSON chunk     structurally, and every embedded PNG by pixel
    <stage>.script.json        structurally
    <stage>.cam.json           structurally
    manifest.json              structurally, less `built`

Structural rather than textual, because Python and JavaScript disagree about
how to *print* a number and about nothing else. Python has an `int` and a
`float` and writes `8000.0`; JavaScript has one number type and writes `8000`.
Both parse to the same IEEE double, which is what a reader of a bundle gets,
so a comparison that reads the text back is comparing what matters and a `diff`
is not. Dictionary key order is not compared for the same reason: a JavaScript
object puts its integer-like keys in numeric order whatever order they were
inserted in, and `JSON.parse` on the other side undoes it again.

The PNGs are compared decoded because the deflate stream inside one is the
compressor's business: node's zlib is the same zlib Python calls and emits the
same bytes, but a browser's `CompressionStream` need not, and identical pixels
is the property that matters either way.

    python3 tools/compare_bundles.py A B
    python3 tools/compare_bundles.py A B --stage stage1
"""
from __future__ import annotations

import argparse
import json
import struct
import sys
import zlib
from pathlib import Path

#: Manifest keys that are *about the run* rather than about the bundle.
#: `built` is a timestamp and `notes.geometry` records the flags this run used.
MANIFEST_SKIP = ("built",)

#: How many differences to print before giving up. A structural break produces
#: thousands of identical-looking lines and the first ten are the useful ones.
MAX_REPORT = 12

#: Floats this far apart, in units in the last place, are counted as equal --
#: and counted, so the allowance is visible rather than silent.
#:
#: **This exists for one reason and it is not rounding.** IEEE 754 does not
#: require `sin`, `cos`, `asin` or `atan2` to be correctly rounded, and V8's
#: fdlibm port and CPython's system libm disagree in the last place on a
#: handful of inputs. Everything that is plain arithmetic -- every position,
#: index, table read and buffer byte -- is compared at zero tolerance, because
#: none of it goes through a transcendental. On stage 1 the allowance covers
#: five numbers out of about four million.
#:
#: The default is 0. A caller has to ask, and `--ulps` prints what it covered.
DEFAULT_ULPS = 0

_ulps_allowed = 0
_ulps_used: list[str] = []


def ulps_between(a: float, b: float) -> float:
    """How many representable doubles separate *a* and *b*.

    Both are finite and, in a bundle, the same sign -- a sign flip is a bug and
    not a rounding difference, so the mixed-sign case is reported as infinite
    rather than folded through zero.
    """
    if a == b:
        return 0.0
    if (a < 0) != (b < 0):
        return float("inf")
    return abs(struct.unpack("<q", struct.pack("<d", a))[0]
               - struct.unpack("<q", struct.pack("<d", b))[0])


class Diff(Exception):
    """Not raised -- differences are collected, because a list of them is the
    useful output and the first one is rarely the cause."""


def load_json(path: Path):
    return json.loads(path.read_text())


def png_pixels(blob: bytes) -> tuple[int, int, bytes]:
    """A PNG's width, height and raw RGBA rows, from a minimal decoder.

    Only the shape `hod2lib.png` writes is handled -- 8-bit RGBA, filter 0 on
    every row, one IDAT -- because that is the only shape either exporter can
    produce. Anything else raises, which is itself a difference worth seeing.
    """
    if blob[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("not a PNG")
    pos = 8
    width = height = 0
    idat = bytearray()
    while pos + 8 <= len(blob):
        (n,) = struct.unpack_from(">I", blob, pos)
        tag = blob[pos + 4:pos + 8]
        body = blob[pos + 8:pos + 8 + n]
        if tag == b"IHDR":
            width, height, depth, colour = struct.unpack_from(">IIBB", body, 0)
            if depth != 8 or colour != 6:
                raise ValueError(f"unexpected PNG format {depth}/{colour}")
        elif tag == b"IDAT":
            idat += body
        elif tag == b"IEND":
            break
        pos += 12 + n
    raw = zlib.decompress(bytes(idat))
    stride = width * 4
    out = bytearray()
    for y in range(height):
        o = y * (stride + 1)
        if raw[o] != 0:
            raise ValueError(f"row {y} uses filter {raw[o]}")
        out += raw[o + 1:o + 1 + stride]
    return width, height, bytes(out)


def read_glb(path: Path) -> tuple[dict, bytes]:
    """A GLB's JSON chunk parsed and its BIN chunk raw."""
    data = path.read_bytes()
    magic, version, _total = struct.unpack_from("<III", data, 0)
    if magic != 0x46546C67:
        raise ValueError(f"{path}: not a GLB")
    if version != 2:
        raise ValueError(f"{path}: GLB version {version}")
    pos = 12
    doc: dict = {}
    blob = b""
    while pos + 8 <= len(data):
        n, kind = struct.unpack_from("<II", data, pos)
        body = data[pos + 8:pos + 8 + n]
        if kind == 0x4E4F534A:
            doc = json.loads(body.decode("utf-8"))
        elif kind == 0x004E4942:
            blob = body
        pos += 8 + n
    return doc, blob


def compare(a, b, where: str, out: list[str], skip: tuple[str, ...] = ()) -> None:
    """Structural comparison, appending one line per difference to *out*."""
    if len(out) >= MAX_REPORT:
        return
    if isinstance(a, dict) and isinstance(b, dict):
        ka, kb = set(a) - set(skip), set(b) - set(skip)
        for k in sorted(ka - kb):
            out.append(f"{where}.{k}: only in A")
        for k in sorted(kb - ka):
            out.append(f"{where}.{k}: only in B")
        for k in sorted(ka & kb):
            compare(a[k], b[k], f"{where}.{k}", out)
        return
    if isinstance(a, list) and isinstance(b, list):
        if len(a) != len(b):
            out.append(f"{where}: length {len(a)} vs {len(b)}")
            return
        for i, (x, y) in enumerate(zip(a, b)):
            compare(x, y, f"{where}[{i}]", out)
        return
    if isinstance(a, bool) or isinstance(b, bool):
        # `True == 1` in Python, and a bundle that turned a flag into a count
        # would slip through a bare `!=`.
        if a is not b:
            out.append(f"{where}: {a!r} vs {b!r}")
        return
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        # The whole point: `8000.0` and `8000` are the same double. NaN cannot
        # reach a bundle -- both writers refuse it -- so no NaN arm is needed.
        if float(a) == float(b):
            return
        n = ulps_between(float(a), float(b))
        if n <= _ulps_allowed:
            _ulps_used.append(f"{where}: {n:g} ulp")
            return
        out.append(f"{where}: {a!r} vs {b!r}" +
                   (f" ({n:g} ulp)" if n != float("inf") else ""))
        return
    if a != b:
        sa, sb = repr(a), repr(b)
        if len(sa) > 90:
            sa, sb = sa[:90] + "...", sb[:90] + "..."
        out.append(f"{where}: {sa} vs {sb}")


def compare_glb(pa: Path, pb: Path, out: list[str]) -> None:
    da, ba = read_glb(pa)
    db, bb = read_glb(pb)

    # The BIN chunk is every vertex, index and PNG in the file, and it is the
    # half that has to be byte-identical. Compare it first: a JSON difference
    # downstream of a buffer difference is noise.
    if len(ba) != len(bb):
        out.append(f"glb BIN: {len(ba)} bytes vs {len(bb)}")
    elif ba != bb:
        # Name the offset, and what claims that offset, so a wrong accessor is
        # findable rather than merely reported.
        off = next(i for i in range(len(ba)) if ba[i] != bb[i])
        owner = "?"
        for i, v in enumerate(da.get("bufferViews", [])):
            lo = v.get("byteOffset", 0)
            if lo <= off < lo + v.get("byteLength", 0):
                owner = f"bufferView {i} (+{off - lo})"
                break
        out.append(f"glb BIN: first difference at byte {off}, in {owner}")

    # An image is a bufferView into that chunk, so if the chunk matched the
    # pixels did too -- but when it did not, saying *which texture* is the
    # difference between one line and a hex dump.
    images = list(zip(da.get("images", []), db.get("images", [])))
    for i, (ia, ib) in enumerate(images):
        if "bufferView" not in ia or "bufferView" not in ib:
            continue
        va = da["bufferViews"][ia["bufferView"]]
        vb = db["bufferViews"][ib["bufferView"]]
        sa = ba[va["byteOffset"]:va["byteOffset"] + va["byteLength"]]
        sb = bb[vb["byteOffset"]:vb["byteOffset"] + vb["byteLength"]]
        if sa == sb:
            continue
        try:
            wa, ha, pxa = png_pixels(sa)
            wb, hb, pxb = png_pixels(sb)
        except Exception as exc:
            out.append(f"glb image {i} ({ia.get('name')}): undecodable ({exc})")
            continue
        if (wa, ha) != (wb, hb):
            out.append(f"glb image {i} ({ia.get('name')}): "
                       f"{wa}x{ha} vs {wb}x{hb}")
        elif pxa != pxb:
            n = sum(1 for x, y in zip(pxa, pxb) if x != y)
            out.append(f"glb image {i} ({ia.get('name')}): "
                       f"{n} of {len(pxa)} bytes differ after decode")
        # Same pixels, different deflate stream: that is the documented and
        # allowed divergence, and it is not reported.

    compare(da, db, "glb", out)


def compare_stage(a: Path, b: Path, name: str) -> list[str]:
    out: list[str] = []
    for suffix in (".cam.json", ".script.json"):
        fa, fb = a / f"{name}{suffix}", b / f"{name}{suffix}"
        if not fa.is_file() or not fb.is_file():
            out.append(f"{name}{suffix}: missing on "
                       f"{'A' if not fa.is_file() else 'B'}")
            continue
        compare(load_json(fa), load_json(fb), name + suffix, out)
    ga, gb = a / f"{name}.glb", b / f"{name}.glb"
    if ga.is_file() and gb.is_file():
        compare_glb(ga, gb, out)
    elif ga.is_file() or gb.is_file():
        out.append(f"{name}.glb: missing on {'A' if not ga.is_file() else 'B'}")
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("a", type=Path, help="the reference bundle")
    ap.add_argument("b", type=Path, help="the bundle under test")
    ap.add_argument("--stage", action="append",
                    help="stage directory name; repeatable, default all")
    ap.add_argument("--ulps", type=int, default=DEFAULT_ULPS,
                    help="allow floats this many units in the last place "
                         "apart, for the libm difference described above; "
                         "0 (the default) compares exactly")
    args = ap.parse_args()

    global _ulps_allowed
    _ulps_allowed = args.ulps

    ma, mb = args.a / "manifest.json", args.b / "manifest.json"
    if not ma.is_file() or not mb.is_file():
        print(f"no manifest in {ma.parent if not ma.is_file() else mb.parent}",
              file=sys.stderr)
        return 2
    manifest_a, manifest_b = load_json(ma), load_json(mb)

    names = args.stage
    if not names:
        have_a = {s["name"] for s in manifest_a.get("stages", [])}
        have_b = {s["name"] for s in manifest_b.get("stages", [])}
        for n in sorted(have_a ^ have_b):
            print(f"stage {n} is in only one bundle", file=sys.stderr)
        names = sorted(have_a & have_b)

    bad = 0
    for name in names:
        rows = compare_stage(args.a / name, args.b / name, name)
        if rows:
            bad += 1
            print(f"{name}: {len(rows)} difference(s)")
            for r in rows:
                print(f"  {r}")
        else:
            print(f"{name}: identical")

    rows: list[str] = []
    # The stage entries are compared above, in full and per file; comparing
    # them again through the manifest would report every one of them twice.
    compare({k: v for k, v in manifest_a.items() if k != "stages"},
            {k: v for k, v in manifest_b.items() if k != "stages"},
            "manifest", rows, skip=MANIFEST_SKIP)
    by_a = {s["name"]: s for s in manifest_a.get("stages", [])}
    by_b = {s["name"]: s for s in manifest_b.get("stages", [])}
    for n in names:
        if n in by_a and n in by_b:
            compare(by_a[n], by_b[n], f"manifest.{n}", rows)
    if rows:
        bad += 1
        print(f"manifest: {len(rows)} difference(s)")
        for r in rows:
            print(f"  {r}")
    else:
        print("manifest: identical")

    if _ulps_used:
        print(f"\nwithin the {_ulps_allowed}-ulp allowance: "
              f"{len(_ulps_used)} value(s)")
        for r in _ulps_used[:MAX_REPORT]:
            print(f"  {r}")
        if len(_ulps_used) > MAX_REPORT:
            print(f"  ... and {len(_ulps_used) - MAX_REPORT} more")

    if bad:
        print(f"\n{bad} file group(s) differ", file=sys.stderr)
        return 1
    print(f"\n{len(names)} stage(s) identical")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
