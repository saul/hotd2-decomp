#!/usr/bin/env python3
"""
Phase 0 baseline generator.

Produces two CSVs describing a HOTD2 (PC) installation:

  manifest.csv   SHA-256 + size for every file. The fixed input set that all
                 later tooling is validated against.

  inventory.csv  Structural classification of every pol/ and tex/ file:
                 container class, dword0, offset-table entries, model count,
                 and - for raw pol/tex pairs - the referenced-texture size sum
                 versus the actual tex/ file size.

Neither file contains asset content, only metadata and hashes.

Usage:
    python3 tools/baseline.py --game-dir "/path/to/THE HOUSE OF THE DEAD 2"
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import struct
import sys
from dataclasses import dataclass
from pathlib import Path

# --------------------------------------------------------------------------
# Container constants. See docs/formats/container.md
# --------------------------------------------------------------------------

TABLE_BYTES = 0x800          # raw container offset-table size
TABLE_ENTRIES = TABLE_BYTES // 4

# NL1 object header. See docs/formats/nl1.md
NL1_HEADER_BYTES = 0x18
NL1_MESH_HEADER_BYTES = 0x50

# texture_control pixel format -> bits per pixel. See docs/formats/texbank.md
PIXFMT_BPP = {
    0: 16,   # ARGB1555
    1: 16,   # RGB565
    2: 16,   # ARGB4444
    3: 16,   # YUV422
    4: 16,   # bump (S/R pair)
    5: 4,    # PAL4
    6: 8,    # PAL8
    7: 16,   # reserved
}

VQ_CODEBOOK_BYTES = 2048     # 256 entries x 4 pixels x 2 bytes

ASSET_DIRS = ("pol", "tex", "mot", "cam", "coli", "evt", "sound")


# --------------------------------------------------------------------------
# Manifest
# --------------------------------------------------------------------------

def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def write_manifest(game_dir: Path, out: Path) -> int:
    rows = []
    for path in sorted(game_dir.rglob("*")):
        if not path.is_file():
            continue
        rows.append({
            "path": path.relative_to(game_dir).as_posix(),
            "size": path.stat().st_size,
            "sha256": sha256(path),
        })

    with out.open("w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=["path", "size", "sha256"])
        w.writeheader()
        w.writerows(rows)
    return len(rows)


def verify_manifest(game_dir: Path, manifest: Path) -> int:
    """Check an installation against a recorded manifest. Returns an exit code.

    **Nothing checked the manifest against an install until this existed, and
    it cost the project a fortnight.** ``manifest.csv`` was generated on
    2026-08-29 and pinned four ``cam/`` files and ``evt/st1evtbl.bin`` that had
    rotted on local media -- scattered bytes smashed to ``0xFF``. Two days of
    work went into a restoration engine, a ``Curve.damage`` model and a
    documented "NaN padding convention" to explain the damage, and
    ``docs/re/anomalies.md`` grew a section describing it as how the game
    ships. The load-bearing sentence was "both retail copies checked are
    byte-identical" -- two copies of the same *installed* tree, never compared
    against the disc. All of it was deleted when they finally were.

    So this reports three kinds of difference and does not editorialise about
    which is which: a hash that moved may be rot, may be a patch you applied on
    purpose, may be a different release. It is for the reader to say. The one
    thing it will not do is let an install drift from its record in silence.
    """
    if not manifest.is_file():
        print(f"error: no manifest at {manifest}", file=sys.stderr)
        return 2
    recorded = {r["path"]: r for r in csv.DictReader(manifest.open())}
    on_disk = {p.relative_to(game_dir).as_posix()
               for p in game_dir.rglob("*") if p.is_file()}

    changed: list[tuple[str, int, int]] = []
    for rel, row in sorted(recorded.items()):
        f = game_dir / rel
        if not f.is_file():
            continue
        if sha256(f) != row["sha256"]:
            changed.append((rel, int(row["size"]), f.stat().st_size))
    missing = sorted(set(recorded) - on_disk)
    extra = sorted(on_disk - set(recorded))

    for rel, was, now in changed:
        delta = "same size" if was == now else f"{was} -> {now} bytes"
        print(f"  CHANGED  {rel}  ({delta})")
    for rel in missing:
        print(f"  MISSING  {rel}")
    for rel in extra:
        print(f"  EXTRA    {rel}")

    n = len(changed) + len(missing) + len(extra)
    print(f"\n{len(recorded)} recorded, {len(changed)} changed, "
          f"{len(missing)} missing, {len(extra)} not in the manifest")
    if n == 0:
        print("install matches the manifest")
        return 0
    print("\nIf these differences are intended -- a restore from the disc, a "
          "patch you applied --\nregenerate the manifest and say why in "
          "docs/re/provenance.md. If they are not,\nyou have found bit-rot, "
          "and every reading taken from those files is suspect.")
    return 1


# --------------------------------------------------------------------------
# Container classification
# --------------------------------------------------------------------------

def classify(data: bytes) -> str:
    """Heuristic container classification. See docs/formats/container.md.

    This is derived from the data, not from the loader; confirming it against
    the binary is a Phase 1 task.
    """
    if len(data) < 8:
        return "empty"
    if data[:2] == b"BM":
        return "bmp"
    dword0 = struct.unpack_from("<I", data, 0)[0]
    if dword0 == TABLE_BYTES:
        return "raw_table"
    if dword0 > len(data):
        return "compressed"
    return "raw_blob"


def table_entries(data: bytes) -> list[int]:
    """Non-zero offset-table entries of a raw_table container."""
    if len(data) < TABLE_BYTES:
        return []
    words = struct.unpack_from("<%dI" % TABLE_ENTRIES, data, 0)
    return [w for w in words if w]


def model_offsets(data: bytes) -> list[int]:
    """Distinct table offsets that hold a plausible NL1 object header."""
    out = []
    for off in sorted(set(table_entries(data))):
        if not (0 < off < len(data) - NL1_HEADER_BYTES):
            continue
        obj_format, global_flag = struct.unpack_from("<2I", data, off)
        # objFormat 0 or 1; globalFlag bit 0 set and nothing above bit 4.
        if obj_format in (0, 1) and (global_flag & 1) and not (global_flag & ~0x1F):
            out.append(off)
    return out


# --------------------------------------------------------------------------
# NL1 mesh walk (enough for Phase 0 -- full parser lands in Phase 3)
# --------------------------------------------------------------------------

@dataclass(frozen=True)
class TexRef:
    tex_id: int
    width: int
    height: int
    pixfmt: int
    vq: int
    mipmap: int
    twiddled: bool

    @property
    def bank_bytes(self) -> int:
        if self.vq:
            return VQ_CODEBOOK_BYTES + (self.width * self.height) // 4
        return (self.width * self.height * PIXFMT_BPP[self.pixfmt]) // 8


def walk_meshes(data: bytes, obj_off: int, limit: int = 4096):
    """Yield TexRef per mesh. Stops on the zero terminator or on anything
    inconsistent, so malformed input degrades to a short list rather than
    an exception."""
    pos = obj_off + NL1_HEADER_BYTES
    for _ in range(limit):
        if pos + NL1_MESH_HEADER_BYTES > len(data):
            return
        if struct.unpack_from("<I", data, pos)[0] == 0:
            return  # end of mesh chain

        tsp, tct = struct.unpack_from("<2I", data, pos + 0x08)
        tex_id = struct.unpack_from("<i", data, pos + 0x20)[0]
        size = struct.unpack_from("<I", data, pos + 0x4C)[0]

        if size == 0 or pos + NL1_MESH_HEADER_BYTES + size > len(data):
            return  # implausible; bail rather than run off the end

        if tex_id >= 0:
            yield TexRef(
                tex_id=tex_id,
                width=8 << ((tsp >> 3) & 7),
                height=8 << (tsp & 7),
                pixfmt=(tct >> 27) & 7,
                vq=(tct >> 30) & 1,
                mipmap=(tct >> 31) & 1,
                twiddled=not ((tct >> 26) & 1),
            )

        pos += NL1_MESH_HEADER_BYTES + size


def texture_refs(data: bytes) -> dict[int, TexRef]:
    """Map tex_id -> TexRef across every model in a raw pol/ container."""
    refs: dict[int, TexRef] = {}
    for off in model_offsets(data):
        for ref in walk_meshes(data, off):
            refs.setdefault(ref.tex_id, ref)
    return refs


# --------------------------------------------------------------------------
# Inventory
# --------------------------------------------------------------------------

FIELDS = [
    "path", "dir", "name", "size", "dword0", "container_class",
    "is_pol_dup",            # pol_-prefixed twin of another file
    "dup_identical",         # ... and byte-identical to it
    "table_entry_count", "model_count",
    "tex_ref_count", "tex_max_id",
    "tex_referenced_bytes", "tex_file_bytes", "tex_delta_bytes",
    "note",
]


def build_inventory(game_dir: Path) -> list[dict]:
    rows: list[dict] = []

    for dirname in ("pol", "tex"):
        d = game_dir / dirname
        if not d.is_dir():
            print(f"  warning: {dirname}/ not found", file=sys.stderr)
            continue

        for path in sorted(d.glob("*.bin")):
            data = path.read_bytes()
            cls = classify(data)
            dword0 = struct.unpack_from("<I", data, 0)[0] if len(data) >= 4 else None

            row = {f: "" for f in FIELDS}
            row.update({
                "path": path.relative_to(game_dir).as_posix(),
                "dir": dirname,
                "name": path.name,
                "size": len(data),
                "dword0": dword0 if dword0 is None else f"0x{dword0:08X}",
                "container_class": cls,
                "is_pol_dup": "",
                "dup_identical": "",
            })

            # pol_-prefixed duplicate detection
            if dirname == "pol" and path.name.startswith("pol_"):
                twin = d / path.name[len("pol_"):]
                if twin.exists():
                    row["is_pol_dup"] = "1"
                    row["dup_identical"] = "1" if twin.read_bytes() == data else "0"
                    if row["dup_identical"] == "0":
                        row["note"] = "ANOMALY: same name, differing content"

            if cls == "raw_table":
                entries = table_entries(data)
                models = model_offsets(data)
                row["table_entry_count"] = len(entries)
                row["model_count"] = len(models)

                # For a raw pol/ file with a raw tex/ twin, compare the
                # referenced-texture size sum against the actual bank size.
                if dirname == "pol" and not row["is_pol_dup"]:
                    tex_path = game_dir / "tex" / path.name
                    refs = texture_refs(data)
                    if refs:
                        row["tex_ref_count"] = len(refs)
                        row["tex_max_id"] = max(refs)
                        referenced = sum(r.bank_bytes for r in refs.values())
                        row["tex_referenced_bytes"] = referenced
                        if tex_path.exists():
                            actual = tex_path.stat().st_size
                            row["tex_file_bytes"] = actual
                            row["tex_delta_bytes"] = actual - referenced

            rows.append(row)

    return rows


def write_inventory(rows: list[dict], out: Path) -> None:
    with out.open("w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=FIELDS)
        w.writeheader()
        w.writerows(rows)


# --------------------------------------------------------------------------

def summarise(rows: list[dict]) -> None:
    from collections import Counter

    print("\nContainer classification")
    for dirname in ("pol", "tex"):
        c = Counter(r["container_class"] for r in rows if r["dir"] == dirname)
        total = sum(c.values())
        parts = ", ".join(f"{k}={v}" for k, v in sorted(c.items()))
        print(f"  {dirname}/  {total:4d} files   {parts}")

    dups = [r for r in rows if r["is_pol_dup"] == "1"]
    identical = [r for r in dups if r["dup_identical"] == "1"]
    print(f"\npol_ duplicates: {len(dups)} "
          f"({len(identical)} identical, {len(dups) - len(identical)} differing)")
    for r in dups:
        if r["dup_identical"] == "0":
            print(f"  ANOMALY  {r['name']:<28} {r['size']:>8} bytes")

    paired = [r for r in rows
              if r["tex_delta_bytes"] not in ("", None)]
    if paired:
        exact = [r for r in paired if int(r["tex_delta_bytes"]) == 0]
        deltas = [int(r["tex_delta_bytes"]) for r in paired]
        print(f"\nRaw pol/tex pairs analysed: {len(paired)}")
        print(f"  texture sizes sum EXACTLY: {len(exact)}")
        print(f"  delta range: {min(deltas)} .. {max(deltas)}")
        neg = [r for r in paired if int(r["tex_delta_bytes"]) < 0]
        print(f"  negative deltas (would falsify the layout): {len(neg)}")
        if exact:
            print("  exact matches: " + ", ".join(r["name"] for r in exact))


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--game-dir", required=True, type=Path,
                    help="root of a HOTD2 (PC) installation")
    ap.add_argument("--out-dir", type=Path, default=Path(__file__).resolve().parent.parent,
                    help="where to write the CSVs (default: repo root)")
    ap.add_argument("--skip-manifest", action="store_true",
                    help="skip SHA-256 hashing (much faster)")
    ap.add_argument("--verify", action="store_true",
                    help="check the install against manifest.csv and exit, "
                         "writing nothing")
    args = ap.parse_args()

    game_dir: Path = args.game_dir.expanduser().resolve()
    if not game_dir.is_dir():
        print(f"error: not a directory: {game_dir}", file=sys.stderr)
        return 1

    missing = [d for d in ASSET_DIRS if not (game_dir / d).is_dir()]
    if missing:
        print(f"warning: missing expected directories: {', '.join(missing)}",
              file=sys.stderr)

    if args.verify:
        return verify_manifest(game_dir, args.out_dir / "manifest.csv")

    args.out_dir.mkdir(parents=True, exist_ok=True)

    if not args.skip_manifest:
        n = write_manifest(game_dir, args.out_dir / "manifest.csv")
        print(f"manifest.csv    {n} files hashed")

    rows = build_inventory(game_dir)
    write_inventory(rows, args.out_dir / "inventory.csv")
    print(f"inventory.csv   {len(rows)} entries")

    summarise(rows)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
