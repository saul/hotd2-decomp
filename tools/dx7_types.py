#!/usr/bin/env python3
"""
Extract the DirectX 7 types this project needs into a clean, self-contained
C header that Ghidra's CParser can actually swallow.

    python3 tools/dx7_types.py --sdk-include /path/to/dx7sdk/include \
        -o extract/dx7_hotd2.h

The SDK headers cannot be committed (Microsoft licensing) and cannot be fed to
Ghidra directly either -- they pull in windows.h, COM macros and packing
pragmas that the CParser chokes on. This script pulls out just the enums and
plain structs, resolves the typedef aliases by hand, and emits something that
parses standalone. The *script* is the reproducible artefact.

Get the SDK from `dx7sdk-7001.exe` (a WinZip self-extractor):

    7z x -y dx7sdk-7001.exe "include/*.h"

Why these types matter here: the game is a Direct3D 7 port of a PowerVR2 title,
so every PVR2 render-state word it loads is translated into a D3D7 render
state. Naming those states is what makes the translation readable, which is the
whole premise of Phase 5.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

#: Enums worth having. All of these appear in the render path.
ENUMS = [
    "D3DRENDERSTATETYPE",
    "D3DTRANSFORMSTATETYPE",
    "D3DTEXTURESTAGESTATETYPE",
    "D3DTEXTUREOP",
    "D3DTEXTUREADDRESS",
    "D3DTEXTUREMAGFILTER",
    "D3DTEXTUREMINFILTER",
    "D3DTEXTUREMIPFILTER",
    "D3DCMPFUNC",
    "D3DBLEND",
    "D3DCULL",
    "D3DSHADEMODE",
    "D3DFILLMODE",
    "D3DZBUFFERTYPE",
    "D3DFOGMODE",
    "D3DLIGHTTYPE",
    "D3DMATERIALCOLORSOURCE",
    "D3DSTENCILOP",
    "D3DPRIMITIVETYPE",
    "D3DVERTEXBLENDFLAGS",
]

#: Plain data structs -- no COM interfaces, no unions with bitfields.
STRUCTS = [
    "D3DVECTOR",
    "D3DCOLORVALUE",
    "D3DMATRIX",
    "D3DVIEWPORT7",
    "D3DMATERIAL7",
    "D3DLIGHT7",
    "D3DVERTEX",
    "D3DLVERTEX",
    "D3DTLVERTEX",
    "D3DCLIPSTATUS",
    "D3DRECT",
]

PRELUDE = """/* DirectX 7 types for HOTD2, extracted by tools/dx7_types.py.
 * Not the SDK headers -- a minimal subset that Ghidra's CParser accepts.
 */
typedef unsigned long   DWORD;
typedef unsigned short  WORD;
typedef unsigned char   BYTE;
typedef long            LONG;
typedef int             BOOL;
typedef float           D3DVALUE;
typedef DWORD           D3DCOLOR;
"""


def strip_comments(text: str) -> str:
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
    return re.sub(r"//[^\n]*", "", text)


def grab_enum(src: str, name: str) -> str | None:
    m = re.search(r"typedef\s+enum\s+_%s\s*\{(.*?)\}\s*%s\s*;" % (name, name),
                  src, re.S)
    if not m:
        return None
    body = strip_comments(m.group(1))
    members = []
    for line in body.split(","):
        line = " ".join(line.split())
        if not line:
            continue
        mm = re.match(r"([A-Za-z_]\w*)\s*=\s*(0x[0-9a-fA-F]+|\d+)", line)
        if mm:
            members.append("    %s = %s" % (mm.group(1), mm.group(2)))
    if not members:
        return None
    # FORCE_DWORD members make the enum 4 bytes; keep them so sizes match.
    return "typedef enum %s {\n%s\n} %s;\n" % (name, ",\n".join(members), name)


#: Several SDK structs wrap each scalar in an anonymous union so the field can
#: be reached as either `x` or `dvX`. Ghidra does not need both names and the
#: CParser will not accept an anonymous union, so the first alternative is kept
#: and the rest dropped -- the layout is identical either way.
def _flatten_unions(body: str) -> str:
    out, depth, taken = [], 0, False
    for line in body.splitlines():
        stripped = line.strip()
        if stripped.startswith("union"):
            depth, taken = depth + 1, False
            continue
        if depth and stripped.startswith("}"):
            depth -= 1
            continue
        if depth:
            if not taken and stripped:
                out.append(line)
                taken = True
            continue
        out.append(line)
    return "\n".join(out)


def grab_struct(src: str, name: str) -> str | None:
    # The declaration ends "} NAME, *LPNAME;" -- allow the alias list, and stop
    # at the closing brace that is followed by the struct's own name.
    m = re.search(r"typedef\s+struct\s+_%s\s*\{(.*?)\n\}\s*%s\b" % (name, name),
                  src, re.S)
    if not m:
        return None
    body = strip_comments(m.group(1))
    # Drop C++ / version-guarded blocks entirely; keep only the C fields.
    body = re.sub(r"#if.*?#endif", "", body, flags=re.S)
    body = _flatten_unions(body)
    fields = []
    for line in body.splitlines():
        line = " ".join(line.split()).rstrip(";").strip()
        if not line or line.startswith("#") or line.startswith("//"):
            continue
        if any(c in line for c in "(){}") or line.endswith(":"):
            continue
        parts = line.split()
        if len(parts) < 2:
            continue
        fields.append("    %s;" % line)
    if not fields:
        return None
    return "typedef struct %s {\n%s\n} %s;\n" % (name, "\n".join(fields), name)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sdk-include", required=True, type=Path,
                    help="the SDK's include/ directory")
    ap.add_argument("-o", "--out", required=True, type=Path)
    args = ap.parse_args()

    src = ""
    for fn in ("d3dtypes.h", "d3dcaps.h"):
        p = args.sdk_include / fn
        if p.exists():
            src += p.read_text(errors="replace")
    if not src:
        raise SystemExit(f"no d3dtypes.h under {args.sdk_include}")

    out = [PRELUDE]
    got_e, got_s, missed = 0, 0, []
    for name in ENUMS:
        block = grab_enum(src, name)
        if block:
            out.append(block)
            got_e += 1
        else:
            missed.append(name)
    for name in STRUCTS:
        block = grab_struct(src, name)
        if block:
            out.append(block)
            got_s += 1
        else:
            missed.append(name)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text("\n".join(out))
    print(f"{args.out}: {got_e} enums, {got_s} structs")
    if missed:
        print(f"  not found: {', '.join(missed)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
