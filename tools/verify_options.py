#!/usr/bin/env python3
"""Check the options screen and the profile against the EXE.

The options screen (app state 0x0C, `OptionsRunPhase` at 0x004869E0) and the
profile it edits are read in `docs/re/options-screen.md` and ported in
`web/src/game/options/`, `profile.ts` and `options_data.ts`. Most of what the
port does there is a number the EXE pushes or copies -- a sprite id, a
position, a factory byte -- and a few of the reading's claims are negatives
that decide what the port may leave out. Those are what this holds.

What this asserts, and what only this can see:

  * **The profile reading is right, on the user's own save.** The install's
    four disguised files (`g_profile_file_names`) are read, deciphered with
    the key `ProfileCipher` builds on its stack -- taken out of the
    instruction stream, not typed in -- and the block's byte sum is checked
    against the dword at `0x009CA068` and its version against 7. A wrong key,
    stride or order reads garbage, and the sum says so.
  * **Blood Color is dead in this build**: the row's gate `0x007DD030` has
    one store and it stores 0, and nothing reads `0x009C9F22` but the
    screen's own copy -- every operand whose bytes cover it.
  * **The port's factory tables are the `.data` `OptionsFactoryReset`
    copies** -- the four option bytes, the sight speed, all forty binding
    masks and the eight calibration dwords -- and `g_start_lives_by_option`.
  * **The sprite ids and background bases the port pushes are the
    immediates**, at the instruction that pushes each, and every sprite the
    screen draws resolves to a bank at the size the reading gives.
  * **The glyph table is 96 entries from 0x0056AF10**: the SE test's table
    ends exactly there, so `[char*2 + 0x0056AED0]` below a space would read
    sound ids.
  * With a bundle (`HOTD2_BUNDLE` or `extract/player`), its `options` block is
    the EXE's, row for row.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from hod2lib.exetab import ExeTables  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
GAME = ROOT / "web/src/game"

PROFILE = 0x009C9120
PROFILE_LEN = 0xF4C
PROFILE_SUMMED = 0xF48
PROFILE_FILES = 0x005985C4
PROFILE_PART = 0x3DB
CIPHER = 0x004A06F0
CIPHER_KEY_END = 0x004A0B29
BLOOD_ROW_SHOWN = 0x007DD030
BLOOD_COLOR = 0x009C9F22


class Failures:
    def __init__(self) -> None:
        self.n = 0
        self.asserted = 0

    def check(self, ok: bool, msg: str) -> None:
        self.asserted += 1
        if ok:
            return
        self.n += 1
        print(f"  FAIL {msg}")


def cipher_key(tables: ExeTables) -> bytes | None:
    """The 176 bytes `ProfileCipher` stores on its stack, by emulating its
    register loads and `MOV byte ptr [ESP + n]` stores with the pushes that
    move ESP between them."""
    try:
        import capstone
    except ImportError:
        return None
    md = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_32)
    r = tables._v2r(CIPHER)
    code = tables.data[r:r + (CIPHER_KEY_END - CIPHER)]
    regs: dict[str, int] = {}
    esp = 0
    key: dict[int, int] = {}
    for i in md.disasm(code, CIPHER):
        m, ops = i.mnemonic, i.op_str
        if m == "sub" and ops == "esp, 0xb0":
            esp = 0
        elif m == "push":
            esp -= 4
        elif m == "mov" and ops.startswith("byte ptr [esp + "):
            off = int(ops.split("+ ")[1].split("]")[0], 16)
            src = ops.split(", ")[1]
            key[esp + off] = regs[src] if src in regs else int(src, 16)
        elif m == "mov" and ops.split(", ")[0] in ("al", "bl", "cl", "dl"):
            reg, v = ops.split(", ")
            regs[reg] = int(v, 16)
        elif m == "xor" and ops == "ecx, ecx":
            regs["cl"] = 0
    if sorted(key) != list(range(0xB0)):
        return None
    return bytes(key[i] for i in range(0xB0))


def port_obj(src: str, name: str) -> dict[str, float]:
    m = re.search(rf"export const {name} = \{{(.*?)\n\}}", src, re.S)
    if not m:
        return {}
    return {k: float(v) if "." in v else int(v, 0) for k, v in
            re.findall(r"^\s*(\w+): (0x[0-9a-fA-F]+|[\d.]+),", m.group(1), re.M)}


def port_const(src: str, name: str) -> float | None:
    m = re.search(rf"export const {name} = (0x[0-9a-fA-F]+|[\d.]+);", src)
    if not m:
        return None
    v = m.group(1)
    return float(v) if "." in v else int(v, 0)


def port_numbers(src: str, name: str) -> list[int]:
    m = re.search(rf"export const {name}[^=]*= \[(.*?)\];", src, re.S)
    if not m:
        return []
    return [int(x, 0) for x in re.findall(r"0x[0-9a-fA-F]+|\b\d+\b", m.group(1))]


def port_enum(src: str, enum: str) -> dict[str, int]:
    m = re.search(rf"export enum {enum} \{{(.*?)\n\}}", src, re.S)
    if not m:
        return {}
    return {k: int(v, 0) for k, v in
            re.findall(r"^\s*(\w+) = (0x[0-9a-fA-F]+|\d+),", m.group(1), re.M)}


def text_refs(tables: ExeTables, lo: int, hi: int) -> list[tuple[int, str, str, int]]:
    """Every .text instruction with a memory operand whose bytes overlap
    [lo, hi): (address, mnemonic, operands, displacement)."""
    import capstone
    from capstone import x86
    md = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_32)
    md.detail = True
    md.skipdata = True
    text = [s for s in tables._sections if s[0] == ".text"][0]
    _, va, _vs, ra, rs = text
    out = []
    for i in md.disasm(tables.data[ra:ra + rs], 0x400000 + va):
        if i.id == 0:
            continue
        for op in i.operands:
            if op.type != x86.X86_OP_MEM:
                continue
            d = op.mem.disp & 0xFFFFFFFF
            if d < hi and d + op.size > lo:
                out.append((i.address, i.mnemonic, i.op_str, d))
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--game-dir", required=True, type=Path)
    args = ap.parse_args()

    tables = ExeTables(str(args.game_dir / "Hod2.exe"))
    raw = tables.data
    fail = Failures()

    def at(va: int) -> int:
        r = tables._v2r(va)
        assert r is not None, hex(va)
        return r

    def mem(va: int, n: int) -> bytes:
        return raw[at(va):at(va) + n]

    def u32(va: int) -> int:
        return struct.unpack_from("<I", raw, at(va))[0]

    # -- the profile, on the install's own save ----------------------------
    key = cipher_key(tables)
    fail.check(key is not None and len(key) == 0xB0,
               "ProfileCipher's key: 176 stack bytes out of 0x004A06F0")
    names = [tables._cstr(u32(PROFILE_FILES + i * 4)) for i in range(4)]
    fail.check(names == ["pol/bg_adv19.bin", "tex/scr_tod_itm_itamidome2.bin",
                         "pol/komono_0.bin", "pol/tv2.bin"],
               f"g_profile_file_names: {names}")
    parts = [args.game_dir / n for n in names if n]
    if key and len(parts) == 4 and all(p.exists() for p in parts):
        blob = b"".join(p.read_bytes() for p in parts)
        fail.check(all(p.stat().st_size == PROFILE_PART for p in parts),
                   "each profile file is 0x3DB bytes")
        buf = bytearray(blob[:PROFILE_LEN])
        for i in range(len(buf)):
            buf[i] ^= (key[i % 0xB0] * (i & 0xFF) - 0x24) & 0xFF
        csum = (-sum(buf[:PROFILE_SUMMED])) & 0xFFFFFFFF
        stored = struct.unpack_from("<I", buf, PROFILE_SUMMED)[0]
        fail.check(csum == stored,
                   f"the deciphered profile's byte sum {csum:#x} is the one "
                   f"it stores, {stored:#x}")
        fail.check(buf[0x009CA05F - PROFILE] == 7,
                   f"the profile's version byte is 7, not "
                   f"{buf[0x009CA05F - PROFILE]}")
        opt = buf[0x009C9F20 - PROFILE:0x009C9F26 - PROFILE]
        print(f"  the install's profile: difficulty {opt[0]}, life {opt[1]}, "
              f"credits {struct.unpack('<b', bytes([opt[5]]))[0]}, "
              f"unlocks {buf[0x009C9F5E - PROFILE] & 7}")
    else:
        print("  (no profile files in the install: the save half unchecked)")

    # -- Blood Color is dead ------------------------------------------------
    stores = [r for r in text_refs(tables, BLOOD_ROW_SHOWN, BLOOD_ROW_SHOWN + 1)
              if r[1] == "mov" and r[2].startswith("byte ptr [0x7dd030],")]
    fail.check([(a, o) for a, _m, o, _d in stores]
               == [(0x00486B14, "byte ptr [0x7dd030], bl")],
               f"g_options_blood_row_shown's stores: "
               f"{[(hex(a), o) for a, _m, o, _d in stores]}")
    fail.check(mem(0x00486A9E, 2) == b"\x33\xdb",
               "EBX is zeroed (XOR EBX, EBX at 0x00486A9E) before that store")
    touches = text_refs(tables, BLOOD_COLOR, BLOOD_COLOR + 1)
    reads = [a for a, m, o, _d in touches
             if not o.startswith("byte ptr [0x9c9f22],")]
    fail.check(reads == [0x00486AC1],
               f"0x009C9F22's readers are the arm's copy alone: "
               f"{[hex(a) for a in reads]}")
    writes = sorted(a for a, m, o, _d in touches
                    if o.startswith("byte ptr [0x9c9f22],"))
    fail.check(writes == [0x004010A0, 0x0040A99B, 0x00487301, 0x00487313],
               f"0x009C9F22's writers: {[hex(a) for a in writes]}")

    # -- the port's factory tables are the .data OptionsFactoryReset copies --
    data_src = (GAME / "options_data.ts").read_text()
    fac = port_obj(data_src, "OPTIONS_FACTORY")
    fail.check([fac.get(k) for k in ("difficulty", "lives", "credits",
                                     "sightGraphic")] == list(mem(0x004C42A0, 4)),
               f"OPTIONS_FACTORY {fac} is 0x004C42A0's four bytes "
               f"{list(mem(0x004C42A0, 4))}")
    fail.check(port_const(data_src, "SIGHT_SPEED_FACTORY")
               == struct.unpack_from("<f", raw, at(0x004C42A4))[0],
               "SIGHT_SPEED_FACTORY is 0x004C42A4")
    fail.check(port_const(data_src, "OPTION_9F28_FACTORY") == raw[at(0x004C4368)],
               "OPTION_9F28_FACTORY is 0x004C4368")
    fail.check(port_numbers(data_src, "INPUT_BINDINGS_DEFAULT")
               == list(struct.unpack_from("<40I", raw, at(0x004C42A8))),
               "INPUT_BINDINGS_DEFAULT is g_input_bindings_default's 40 dwords")
    fail.check(port_numbers(data_src, "GUN_CALIBRATION_FACTORY")
               == list(struct.unpack_from("<8I", raw, at(0x004C4348))),
               "GUN_CALIBRATION_FACTORY is 0x004C4348's eight dwords")
    fail.check(port_numbers(data_src, "START_LIVES_BY_OPTION")
               == list(struct.unpack_from("<5h", raw, at(0x004D0EDC))),
               "START_LIVES_BY_OPTION is g_start_lives_by_option")
    # `OptionsFactoryReset`'s loads: the table addresses as its operands.
    for va, want in ((0x00401130, b"\xa0\xa0\x42\x4c\x00"),
                     (0x00401135, b"\x8a\x15\xa2\x42\x4c\x00"),
                     (0x0040113B, b"\x8a\x0d\xa1\x42\x4c\x00"),
                     (0x0040114C, b"\x8a\x1d\xa3\x42\x4c\x00"),
                     (0x00401176, b"\x8b\x0d\xa4\x42\x4c\x00")):
        fail.check(mem(va, len(want)) == want,
                   f"OptionsFactoryReset's load at {va:#x}")

    # -- the immediates the port pushes --------------------------------------
    sprites = port_enum(data_src, "OptionsSprite")
    pushes = {"Options": 0x00486E21, "Exit": 0x004871FB, "Tilde": 0x00487E64,
              "Tag1P": 0x0048767D, "Tag2P": 0x0048774C,
              "OptionsSlash": 0x00488494, "SightSpeed": 0x004884BB,
              "ASlow": 0x004887B7, "BFast": 0x004887DE,
              "PressStartToEnter": 0x00488808}
    for name, va in pushes.items():
        v = sprites.get(name)
        fail.check(v is not None and mem(va, 5) == b"\x68" + struct.pack("<I", v),
                   f"OptionsSprite.{name} ({v}) is the PUSH at {va:#x}")
    bases = port_numbers(data_src, "OPTIONS_BACKGROUND_BASES")
    for base, va in zip(bases, (0x0048818F, 0x00488121, 0x004880B3)):
        fail.check(mem(va, 5) == b"\xbe" + struct.pack("<I", base),
                   f"background base {base:#x} is the MOV ESI at {va:#x}")
    fail.check(len(bases) == 3, f"three background bases: {bases}")
    # The EXIT and title positions and flags, and the grid.
    for va, want, what in (
            (0x004871F6, b"\x68" + struct.pack("<f", 320.0), "EXIT's x 320"),
            (0x00486E1C, b"\x68" + struct.pack("<f", 344.0), "the title's x 344"),
            (0x00486E17, b"\x68" + struct.pack("<f", 16.0), "the title's y 16"),
            (0x00486E04, b"\x6a\x06", "the title's flags 6"),
            (0x004871C4, b"\x68\x0a\x20\x00\x00", "EXIT's flags 0x200A"),
            (0x00487DB9, b"\x68\x00\x20\x00\x00", "a glyph's flags 0x2000")):
        fail.check(mem(va, len(want)) == want, f"{what} at {va:#x}")
    for va, v, what in ((0x0055DCF0, 16.0, "the column, 16"),
                        (0x004ECB84, 24.0, "the line, 24"),
                        (0x005644FC, 7.0, "lower case's drop, 7"),
                        (0x004C49C0, 3.0, "C and G's kern, 3"),
                        (0x004C4CA0, 4.0, "EXIT's lift, 4")):
        fail.check(struct.unpack_from("<f", raw, at(va))[0] == v,
                   f"{what} at {va:#x}")
    # The lit bit: SubmitScreenSpriteQuad's `TEST DH, 0x20`.
    fail.check(mem(0x004ACE27, 3) == b"\xf6\xc6\x20",
               "SubmitScreenSpriteQuad tests flags bit 0x2000 at 0x004ACE27")
    # The sub-screens' gates the port has: input mode 6.
    fail.check(mem(0x00485FBD, 5) == b"\xb9\x06\x00\x00\x00"
               and mem(0x00486C4A, 5) == b"\x83\x7c\x24\x0c\x06",
               "Gun Calibration's gate compares the input mode with 6")
    # HudDrawCrosshair's sprite is the sight graphic, not the binding set.
    fail.check(mem(0x004169F3, 7) == b"\x8d\x14\x8d\x60\x9f\x9c\x00"
               and mem(0x00416AC8, 3) == b"\x0f\xbe\x12"
               and mem(0x00416AD8, 8) == b"\x0f\xbf\x14\x4d\x58\x9f\x57\x00",
               "HudDrawCrosshair reads +0x00 of the options record and "
               "indexes g_crosshair_sprites with it")

    # -- the tables the bundle carries ---------------------------------------
    opts = tables.options_tables()
    fail.check(0x00569798 + 0x2EF * 8 == 0x0056AF10,
               "the SE test's 751 records end at 0x0056AF10")
    fail.check([r["label"] for r in opts["rows"]] == [
        "Difficulty", "Life", "Continue", "Blood Color", "Sight Graphic",
        "Sight Speed", "Sound Test Special Effects", "Sound Test Music",
        "Gun Calibration", "Default", "EXIT"],
        f"the rows: {[r['label'] for r in opts['rows']]}")
    fail.check([(r["col"], r["row"]) for r in opts["rows"]]
               == [(2, n) for n in range(3, 13)] + [(15, 18)],
               "the rows' columns and lines")
    fail.check(u32(0x00569680 + 4) == 0x005971F0
               and tables._cstr(0x005971F0) == "OPTIONS"
               and struct.pack("<I", 0x00569680) not in raw,
               "the 'OPTIONS' record at 0x00569680 is named by nothing")
    glyphs = opts["glyphs"]
    fail.check(glyphs[0x30 - 0x20] == 0x76C and glyphs[0x41 - 0x20] == 0x776
               and glyphs[0x54 - 0x20] == 0x7A3 and glyphs[0x61 - 0x20] == 0x789
               and glyphs[0] == 0 and glyphs[0x2E - 0x20] == 0,
               "the glyph table: 0x76C for '0', 0x776 'A', 0x7A3 'T', "
               "0x789 'a', none for ' ' or '.'")
    # 16x32 each, but for `W` (0x7A6), 32x32: drawn over its right-hand
    # neighbour's first half, since every character advances 16.
    for gid in sorted({g for g in glyphs if g}):
        hit = tables.screen_sprite(gid)
        want = (32, 32) if gid == 0x7A6 else (16, 32)
        fail.check(hit is not None and hit[0] == "scr_opt_moji05"
                   and (hit[1].width, hit[1].height) == want,
                   f"glyph {gid:#x} is scr_opt_moji05, {want}")
    for sid, bank, size in ((0xB31, "scr_dc_option", (256, 64)),
                            (0x803, "scr_dc_option", (128, 64)),
                            (0x7F2, "scr_opt_moji01", (16, 32)),
                            (0x7A, "scr_back2", (128, 128)),
                            (0xA7D, "scr_back4", (128, 128)),
                            (0x8E, "scr_back3", (128, 128)),
                            (0xAA8, "scr_common", (32, 32))):
        hit = tables.screen_sprite(sid)
        fail.check(hit is not None and hit[0] == bank
                   and (hit[1].width, hit[1].height) == size,
                   f"sprite {sid:#x} is {bank} {size}")
    fail.check(opts["crosshair_sprites"] == [0xAA8, 0xAAA, 0xAAB, 0xAAC,
                                             0xAA9, 0xAAD, 0xAAE, 0xAAF],
               f"g_crosshair_sprites: {opts['crosshair_sprites']}")
    fail.check(opts["se_test"][0] == 0x80000000
               and opts["music_test"][0] == 0x80000000,
               "both sound tests open on the music's stop")

    bundle = os.environ.get("HOTD2_BUNDLE") or str(ROOT / "extract" / "player")
    scripts = sorted(Path(bundle).glob("*/*.script.json")) if Path(bundle).is_dir() else []
    if scripts:
        block = json.loads(scripts[0].read_text()).get("options")
        fail.check(block is not None, f"{scripts[0].name} has an options block")
        if block is not None:
            fail.check(block == json.loads(json.dumps(opts)),
                       f"{scripts[0].name}'s options block is the EXE's")
    else:
        print("  (no bundle: the exported block unchecked)")

    if fail.n:
        print(f"verify_options: {fail.n} of {fail.asserted} failed")
        return 1
    print(f"verify_options: {fail.asserted} checks against the EXE hold")
    return 0


if __name__ == "__main__":
    sys.exit(main())
