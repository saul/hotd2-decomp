#!/usr/bin/env python3
"""Check class 0x41 type 1 -- the canal water task -- against the EXE.

`PlaceWaterSurface` (`FUN_00462F70`) builds a task that draws one water tile a
script has loaded and ripples its UVs; `WaterSurfaceUpdate` (`FUN_0046E3A0`)
is that task. The port has it in `web/src/game/class41/water.ts`. Every one of
its fifteen spawns sits at the world origin, and what it draws is an EXE table
entry picked by a descriptor byte, so a wrong reading of it looks like nothing
at all -- which is exactly how the canal went undrawn for as long as it did.

What this asserts, and what only this can see:

  * **The chain.** `g_class41_constructors[1]` is `PlaceWaterSurface`; it
    pushes `WaterSurfaceUpdate` and 0x44 to `ActorAlloc`, and reads its slot
    with `MOVSX ECX, word [EAX*2 + 0x593DA4]`. Bytes, not a decompile.
  * **The table is ten water tiles.** Every slot of `g_water_surface_slots`,
    and every slot the task pairs or swaps them with, resolves through the
    slot tables to a model whose vertices all lie in one horizontal plane at
    the canal's height. A table read at the wrong address or stride fails
    here: nothing else in the image is ten flat planes in a row.
  * **The spawns.** Fifteen type-1 descriptors (5 stage 2, 7 stage 3, 3
    training), each at the origin with no angle, each index inside the table.
  * **The port's constants are the EXE's immediates**, read at the
    instruction that holds each one: the six tile slots, the canal's kill
    step, the two camera paths and the pause frame, block 0x23 step 2, the
    kill-flag base, the eight script flags, the phase multipliers (a
    `LEA`/`SHL` chain, so the product is computed here), and the three
    floats.
"""
from __future__ import annotations

import argparse
import math
import os
import re
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from hod2lib import container, evt, nl1  # noqa: E402
from hod2lib.exetab import ExeTables  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
PORT = ROOT / "web/src/game/class41"

CLASS41 = 0x41
CTORS = 0x00593580
PLACE = 0x00462F70
UPDATE = 0x0046E3A0
TABLE = 0x00593DA4
TABLE_LEN = 10
#: The table beside it, which four routines address directly: the end.
NEXT_TABLE = 0x00593DB8
SCRIPT_FLAGS = 0x009C7200

#: What the shipped scripts hold. A change here is a change in the reading.
EXPECT_SPAWNS = {"st2evtbl.bin": 5, "st3evtbl.bin": 7, "trnevtbl.bin": 3}

#: `(address of the immediate, width, port file, port constant)`. Each address
#: is inside the instruction the disassembly of `WaterSurfaceUpdate` or
#: `PlaceWaterSurface` shows; the width is the immediate's.
IMMEDIATES = [
    (0x0046E46D, 4, "water_slots.ts", "WATER_CANAL_SLOT"),
    (0x0046E476, 1, "water.ts", "WATER_CANAL_KILL_STEP"),
    (0x0046E4B8, 4, "water_slots.ts", "WATER_ARENA_SLOT"),
    (0x0046E666, 4, "water_slots.ts", "WATER_ARENA_SLOT"),
    (0x0046E4CE, 4, "water_slots.ts", "WATER_DEATH_SLOT"),
    (0x0046E6CB, 4, "water_slots.ts", "WATER_DEATH_SLOT"),
    (0x0046E66E, 4, "water_slots.ts", "WATER_ARENA_PAIR_SLOT"),
    (0x0046E67E, 4, "water_slots.ts", "WATER_ARENA_ALT_SLOT"),
    (0x0046E687, 4, "water_slots.ts", "WATER_ARENA_ALT_PAIR_SLOT"),
    (0x0046E699, 4, "water_slots.ts", "WATER_DEATH_ALT_SLOT"),
    (0x0046E4DC, 1, "water.ts", "WATER_DEATH_CAM_PATH"),
    (0x0046E4F3, 1, "water.ts", "WATER_PAUSE_CAM_PATH"),
    (0x0046E512, 4, "water.ts", "WATER_PAUSE_CAM_FRAME"),
    (0x0046E455, 1, "water.ts", "WATER_SURFACE_KILL_BLOCK"),
    (0x0046E45B, 1, "water.ts", "WATER_SURFACE_KILL_BLOCK_STEP"),
    (0x00462FCB, 1, "water.ts", "WATER_SURFACE_KILL_FLAG_BASE"),
]

#: `(address of the flag's absolute operand, enum member)`: each reads
#: `g_script_flags + n`, so the member is the operand less the array's base.
FLAGS = [
    (0x0046E48C, "KillAllStage3"),      # MOV AL, [0x009C7204]
    (0x0046E4C0, "ArenaRipple"),        # MOV DL, [0x009C7208]
    (0x0046E694, "SwapTiles"),          # MOV AL, [0x009C7209]
    (0x0046E4E5, "RippleOff"),          # MOV DL, [0x009C726A]
    (0x0046E523, "TrainingRippleOn"),   # MOV CL, [0x009C72F1]
    (0x0046E531, "TrainingRippleOff"),  # MOV CL, [0x009C72F2]
]
#: And the stage-2 sweep, which `lifetime.ts` already names.
SWEEP_FLAG_AT = 0x0046E3B6              # MOV CL, [0x009C7277]


class Failures:
    def __init__(self) -> None:
        self.n = 0

    def check(self, ok: bool, msg: str) -> None:
        if ok:
            return
        self.n += 1
        print(f"  FAIL {msg}")


def port_const(src: str, name: str) -> int | float | None:
    m = re.search(rf"export const {name} = (-?0x[0-9a-fA-F]+|-?[\d.]+);", src)
    if not m:
        return None
    v = m.group(1)
    return float(v) if "." in v else int(v, 0)


def port_enum(src: str, member: str) -> int | None:
    m = re.search(rf"\b{member} = (0x[0-9a-fA-F]+|\d+),", src)
    return int(m.group(1), 0) if m else None


def type1_spawns(game_dir: Path, tables: ExeTables):
    """Every class-0x41 descriptor whose constructor byte is 1."""
    com = evt.load(str(game_dir / "evt" / "comevtbl.bin"))
    out = []
    seen: set[str] = set()
    for scene in range(12):
        name = tables.scene_evt_file(scene)
        if not name or name in seen:
            continue
        seen.add(name)
        path = game_dir / "evt" / name
        if not os.path.exists(path):
            continue
        f = evt.load(str(path), tables.scene_block_count(scene), com=com)
        for sp in evt.spawns(f):
            if sp.cls != CLASS41 or f.raw[sp.offset + 0x25] != 1:
                continue
            out.append({
                "file": name, "offset": sp.offset, "pos": sp.pos,
                "orient": sp.orient, "lifetime": sp.hp,
                "index": struct.unpack_from("<b", f.raw, sp.offset + 0x24)[0],
            })
    return out


def flat_tile(game_dir: Path, pol: str, entry: int):
    """`(min y, max y, vertices)` of one pol model, or None."""
    raw = (game_dir / "pol" / pol).read_bytes()
    models = nl1.parse_container(container.load(raw))
    if entry >= len(models) or models[entry] is None:
        return None
    ys = [v.pos[1] for me in models[entry].meshes for v in me.vertices]
    return (min(ys), max(ys), len(ys)) if ys else None


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

    def imm(va: int, width: int) -> int:
        fmt = {1: "<B", 4: "<I"}[width]
        return struct.unpack_from(fmt, raw, at(va))[0]

    # -- the chain ---------------------------------------------------------
    ctor = struct.unpack_from("<I", raw, at(CTORS + 4))[0]
    fail.check(ctor == PLACE,
               f"g_class41_constructors[1] is {ctor:#x}, not PlaceWaterSurface")
    push = raw[at(PLACE + 1):at(PLACE + 1) + 7]
    fail.check(push == bytes([0x6A, 0x44, 0x68]) + struct.pack("<I", UPDATE),
               f"PlaceWaterSurface does not push (WaterSurfaceUpdate, 0x44): "
               f"{push.hex()}")
    movsx = raw[at(0x00462FA5):at(0x00462FA5) + 8]
    fail.check(movsx == bytes([0x0F, 0xBF, 0x0C, 0x45]) + struct.pack("<I", TABLE),
               f"the slot read at 0x00462FA5 is {movsx.hex()}")
    fail.check(NEXT_TABLE - TABLE == TABLE_LEN * 2,
               "the table does not end where g_prop_kind_params begins")
    print(f"  chain: g_class41_constructors[1] -> PlaceWaterSurface -> "
          f"ActorAlloc(WaterSurfaceUpdate, 0x44), slot from {TABLE:#x}")

    # -- the table is ten water tiles ----------------------------------------
    slots = [struct.unpack_from("<h", raw, at(TABLE) + 2 * i)[0]
             for i in range(TABLE_LEN)]
    extra = [imm(a, 4) for a in (0x0046E66E, 0x0046E67E, 0x0046E687,
                                 0x0046E699)]
    by_slot = tables.asset_slots()
    for s in slots + extra:
        rec = by_slot.get(s)
        if rec is None:
            fail.check(False, f"slot {s:#x} names no pol file")
            continue
        got = flat_tile(args.game_dir, rec[0], rec[1])
        if got is None:
            fail.check(False, f"slot {s:#x} ({rec[0]}[{rec[1]}]) has no model")
            continue
        lo, hi, n = got
        fail.check(hi - lo < 1.0 and -26.0 < lo and hi < -14.0,
                   f"slot {s:#x} ({rec[0]}[{rec[1]}]) spans y {lo:.1f}..{hi:.1f}"
                   ", not one plane at the canal")
    print(f"  table: {', '.join(f'{s:#x}' for s in slots)}; pairs and swaps "
          f"{', '.join(f'{s:#x}' for s in extra)}; all flat at the canal")

    # -- the spawns --------------------------------------------------------
    spawns = type1_spawns(args.game_dir, tables)
    counts: dict[str, int] = {}
    for sp in spawns:
        counts[sp["file"]] = counts.get(sp["file"], 0) + 1
        fail.check(0 <= sp["index"] < TABLE_LEN,
                   f"{sp['file']}:{sp['offset']:#x} index {sp['index']} is "
                   "outside the table")
        fail.check(tuple(sp["pos"]) == (0.0, 0.0, 0.0)
                   and tuple(sp["orient"]) == (0, 0, 0),
                   f"{sp['file']}:{sp['offset']:#x} is placed at {sp['pos']} "
                   f"{sp['orient']}; the task reads neither")
    fail.check(counts == EXPECT_SPAWNS,
               f"type-1 spawns by file are {counts}, expected {EXPECT_SPAWNS}")
    print(f"  spawns: {sum(counts.values())} ({counts})")

    # -- the port's constants are the EXE's -------------------------------
    srcs = {f: (PORT / f).read_text() for f in ("water.ts", "water_slots.ts")}
    for va, width, f, name in IMMEDIATES:
        want = imm(va, width)
        got = port_const(srcs[f], name)
        fail.check(got == want,
                   f"the port's {name} is {got}, the EXE's at {va:#x} is "
                   f"{want:#x}")
    for va, member in FLAGS:
        want = imm(va, 4) - SCRIPT_FLAGS
        got = port_enum(srcs["water.ts"], member)
        fail.check(got == want, f"WaterSurfaceFlag.{member} is {got}, the EXE "
                   f"reads g_script_flags[{want:#x}]")
    sweep = imm(SWEEP_FLAG_AT, 4) - SCRIPT_FLAGS
    life = (PORT / "lifetime.ts").read_text()
    fail.check(port_const(life, "SCRIPT_FLAG_CLEAR_PROPS") == sweep,
               f"the stage-2 sweep flag is {sweep:#x} in the EXE")
    # tick * 0x180: `LEA EDI, [EAX + EAX*2]; SHL EDI, 7` at 0x0046E5A3.
    per_tick = raw[at(0x0046E5A3):at(0x0046E5A3) + 6]
    fail.check(per_tick == bytes([0x8D, 0x3C, 0x40, 0xC1, 0xE7, 0x07]),
               f"the tick multiply at 0x0046E5A3 is {per_tick.hex()}")
    fail.check(port_const(srcs["water.ts"], "WATER_PHASE_PER_TICK") == 3 << 7,
               "WATER_PHASE_PER_TICK is not 3 << 7")
    # x * 600: `LEA EAX, [EAX + EAX*2]; LEA EAX, [EAX + EAX*4]` twice, then
    # `LEA ECX, [EDI + EAX*8]` at 0x0046E5AE.
    per_unit = raw[at(0x0046E5AE):at(0x0046E5AE) + 12]
    fail.check(per_unit == bytes([0x8D, 0x04, 0x40, 0x8D, 0x04, 0x80,
                                  0x8D, 0x04, 0x80, 0x8D, 0x0C, 0xC7]),
               f"the vertex multiply at 0x0046E5AE is {per_unit.hex()}")
    fail.check(port_const(srcs["water.ts"], "WATER_PHASE_PER_UNIT")
               == 3 * 5 * 5 * 8, "WATER_PHASE_PER_UNIT is not 3 * 5 * 5 * 8")
    step = struct.unpack_from("<d", raw, at(0x00569108))[0]
    zlim = struct.unpack_from("<f", raw, at(0x00569110))[0]
    bams = struct.unpack_from("<d", raw, at(0x004C4370))[0]
    fail.check(port_const(srcs["water.ts"], "WATER_UV_STEP") == step,
               f"WATER_UV_STEP is not the EXE's {step!r}")
    fail.check(port_const(srcs["water.ts"], "WATER_Z_LIMIT") == zlim,
               f"WATER_Z_LIMIT is not the EXE's {zlim!r}")
    fail.check(bams == 2 * math.pi / 65536,
               f"g_bams_to_rad is {bams!r}, not 2pi/65536")
    print(f"  the port's constants match the EXE: {len(IMMEDIATES)} "
          f"immediates, {len(FLAGS) + 1} flags, the two phase multipliers, "
          f"uv step {step}, z limit {zlim}")

    if fail.n:
        print(f"\n{fail.n} failure(s)")
        return 1
    print("\nOK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
