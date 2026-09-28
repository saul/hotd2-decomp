#!/usr/bin/env python3
"""Can anything the shipped game runs cut a class-0x30 actor in two?

`ZombieSplitInTwo` (`FUN_0045D9F0`) allocates a second `EnemyZombieUpdate`
actor and gives it one of the skeleton's two roots, and the port does **not**
transcribe it, on the reading that nothing reaches it. It has three callers,
and that reading is three separate claims about the EXE and the data. This
check holds each of them, with a positive control beside every negative one so
that a search which finds nothing cannot pass by being broken (`L32`):

1. **`ActorReactToHit`'s arm needs `g_hit_result == 4`, and nothing writes 4.**
   Every instruction that names `g_hit_result` (`0x009A58F8`) is found by its
   address bytes, classified by the three bytes in front of them, and every
   ``MOV [reg*4 + 0x009A58F8], imm32`` must store one of 0/1/2/3/5. The second
   player's slot, ``0x009A58FC``, must not appear at all, and the one ``LEA``
   of the array -- `ZombieOnShot`'s at ``0x00453F0D`` -- is the only way to
   hold a pointer to it.
2. **The other two callers need `obj+0x136C` bit ``0x1000000``, and only state
   0x35 raises it.** An aligned sweep of class 0x30's code
   (``0x00452DA0``..``0x0045ECC0``) with `capstone` finds every ``OR`` with a
   32-bit immediate carrying the bit, and there must be exactly one:
   `ZombieStateCollapseToCondition4` at ``0x0045E6A2``.
3. **Nothing enters state 0x35.** No ``MOV word [reg + 0x1310], 0x35`` in the
   image (0x34 and 0x32 each have exactly one, as controls); no class-0x30
   spawn descriptor in any stage, in either mode, names 0x32..0x35 as its
   initial or attack state (the attack state is also where the entry tails
   and the stand-and-throw exit come from); no civilian op-0x1A order names
   one; and no class-0x30 descriptor's ``+0x20`` word has bit 15, which is
   what would sign-extend into the high half of ``obj+0x136C``.

And the half that **is** reached, as the control on the data side: body
condition 4 is carried by character type 0xC and nothing else, which is what
sends `znkager` through `ZombieInitHalved` (`FUN_0045DA10`) and into
`ZombieStateLeapStrike` (`FUN_0045E330`).

It also re-reads `g_class30_states` (``0x00592AE8``) at 0x31..0x36, so the
state numbers above are the table's and not the port's (`L38`).

    python3 tools/verify_split_unreachable.py --game-dir ~/"THE HOUSE OF THE DEAD 2"

Exit 0 when every claim holds, 1 when one does not, 3 when there was nothing
to read (no ``--game-dir``, no EXE, or no `capstone`).
"""
from __future__ import annotations

import argparse
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from hod2lib import evt as evtlib, script as scriptlib, stage as stagelib  # noqa: E402

G_HIT_RESULT = 0x009A58F8
G_CLASS30_STATES = 0x00592AE8
#: `g_class30_states[0x31..0x36]`, read out of the table.
STATE_TABLE = {
    0x31: 0x0041EBB0,   # NoOpStub, the filler
    0x32: 0x0045E010,   # ZombieStateSplitLaunch
    0x33: 0x0045DED0,   # ZombieStateSplitHalfCollapse
    0x34: 0x0045E330,   # ZombieStateLeapStrike
    0x35: 0x0045E660,   # ZombieStateCollapseToCondition4
    0x36: 0x00456920,
}
#: The half-body family's states, none of which the data may name.
SPLIT_STATES = {0x32, 0x33, 0x34, 0x35}
CLASS30_CODE = (0x00452DA0, 0x0045ECC0)
SPLIT_ARMED = 0x1000000
SPLIT_ARMED_WRITER = 0x0045E6A2
#: `MOV word ptr [reg + 0x1310], imm16` -- the operand bytes after the ModRM.
STATE_STORE = b"\x10\x13\x00\x00"
#: The three bytes in front of `0x009A58F8`, by what the instruction does.
HIT_RESULT_FORMS = {
    b"\xc7\x04": "store",   # MOV dword ptr [reg*4 + disp32], imm32
    b"\x83\x3c": "compare",
    b"\x8b\x04": "load",
    b"\x8d\x1c": "lea",
}
HIT_RESULTS_WRITTEN = {0, 1, 2, 3, 5}


def image(tables) -> tuple[bytes, callable]:
    return bytes(tables.data), tables._v2r


def check_hit_result(data: bytes, v2r, fails: list[str]) -> None:
    addr = struct.pack("<I", G_HIT_RESULT)
    stores: dict[int, int] = {}
    kinds: dict[str, int] = {}
    leas = []
    at = data.find(addr)
    seen = 0
    while at >= 0:
        seen += 1
        form = HIT_RESULT_FORMS.get(data[at - 3:at - 1])
        if form is None:
            fails.append(f"g_hit_result named by an unrecognised instruction "
                         f"at file offset 0x{at:X}: "
                         f"{data[at - 3:at + 4].hex()}")
        else:
            kinds[form] = kinds.get(form, 0) + 1
            if form == "store":
                stores[at] = struct.unpack_from("<I", data, at + 4)[0]
            if form == "lea":
                leas.append(at)
        at = data.find(addr, at + 1)
    written = set(stores.values())
    print(f"  g_hit_result is named {seen} times: "
          + ", ".join(f"{k} x{n}" for k, n in sorted(kinds.items()))
          + f"; the stores write {sorted(written)}")
    if not stores:
        fails.append("no store to g_hit_result found at all -- the search is "
                     "broken, not the reading")
    if 4 in written:
        fails.append("something stores 4 to g_hit_result")
    if not written <= HIT_RESULTS_WRITTEN:
        fails.append(f"g_hit_result stores outside 0/1/2/3/5: {sorted(written)}")
    if not {0, 1, 2, 3, 5} <= written:
        fails.append(f"ResolveHit's own results are not all found: "
                     f"{sorted(written)}")
    lea_at = v2r(0x00453F0D + 3)
    if leas != [lea_at]:
        fails.append(f"expected one LEA of g_hit_result, ZombieOnShot's at "
                     f"0x00453F0D; found {len(leas)}")
    second = data.count(struct.pack("<I", G_HIT_RESULT + 4))
    if second:
        fails.append(f"player 1's slot, 0x{G_HIT_RESULT + 4:08X}, is named "
                     f"{second} times")


def check_state_table(data: bytes, v2r, fails: list[str]) -> None:
    base = v2r(G_CLASS30_STATES)
    got = {i: struct.unpack_from("<I", data, base + 4 * i)[0]
           for i in STATE_TABLE}
    wrong = {i: hex(v) for i, v in got.items() if v != STATE_TABLE[i]}
    print(f"  g_class30_states[0x31..0x36] = "
          + " ".join(f"{got[i]:08X}" for i in sorted(got)))
    if wrong:
        fails.append(f"g_class30_states differs from the reading: {wrong}")


def check_state_literals(data: bytes, v2r, fails: list[str]) -> None:
    def sites(state: int) -> list[int]:
        pat = STATE_STORE + struct.pack("<H", state)
        out, at = [], data.find(pat)
        while at >= 0:
            out.append(at)
            at = data.find(pat, at + 1)
        return out
    n32, n34, n35 = sites(0x32), sites(0x34), sites(0x35)
    print(f"  literal state stores: 0x32 x{len(n32)}, 0x34 x{len(n34)}, "
          f"0x35 x{len(n35)}")
    # The controls: `ZombieSplitUpdateSelf` writes 0x32 at 0x0045DA76 and
    # `ZombieStateHoldAtRange` 0x34 at 0x0045587C -- the displacement starts
    # three bytes into each instruction (66 c7 86 | 10 13 00 00 | imm16).
    if n32 != [v2r(0x0045DA76 + 3)] or n34 != [v2r(0x0045587C + 3)]:
        fails.append("the literal-state search does not find its controls "
                     "(0x32 at 0x0045DA76, 0x34 at 0x0045587C)")
    if n35:
        fails.append(f"state 0x35 is stored as a literal {len(n35)} times")


def check_split_armed_writers(data: bytes, v2r, fails: list[str]) -> bool:
    try:
        import capstone
    except ImportError:
        print("  SKIP  capstone is not installed; the sweep for obj+0x136C "
              "bit 0x1000000 cannot run")
        return False
    lo, hi = CLASS30_CODE
    code = data[v2r(lo):v2r(hi)]
    md = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_32)
    md.detail = True
    hits, off, n = [], 0, 0
    while off < len(code):
        moved = False
        for ins in md.disasm(code[off:], lo + off):
            moved = True
            n += 1
            # A 32-bit immediate field only: `83 /1 ib` sign-extends, and
            # `OR EAX, -2` is the `rand()` normalising idiom, not a flag.
            if ins.mnemonic == "or" and ins.bytes[0] in (0x0D, 0x81):
                for op in ins.operands:
                    if (op.type == capstone.x86.X86_OP_IMM
                            and (op.imm & 0xFFFFFFFF) & SPLIT_ARMED):
                        hits.append(ins.address)
            off = ins.address + ins.size - lo
        if not moved:
            off += 1
    print(f"  class 0x30's code, {n} instructions: an OR of 0x1000000 at "
          + ", ".join(f"0x{a:08X}" for a in hits))
    if hits != [SPLIT_ARMED_WRITER]:
        fails.append(f"expected obj+0x136C bit 0x1000000 raised only at "
                     f"0x{SPLIT_ARMED_WRITER:08X}; found "
                     f"{[hex(a) for a in hits]}")
    return True


def with_civilian_children(prog) -> list:
    """Every spawn descriptor, **and** the ones only a civilian points at.

    `CivilianInit` (`FUN_0048A3E0`) spawns its captors from an array of
    descriptor pointers at tail ``+0x10``, count at ``+0x0C``, which no evt
    instruction points at -- so `evt.spawns` never returns them, and three of
    the twenty `znkager` are among them. The same walk as
    `characters.resolve_for_stage`'s.
    """
    recs = {r.offset: r for r in evtlib.spawns(prog.evt)}
    for rec in list(recs.values()):
        if rec.cls != 0x10:
            continue
        n = rec.param(0x0C, "i32") or 0
        for k in range(max(0, min(n, 32))):
            w = rec.param(0x10 + k * 4, "u32")
            off = prog.evt.to_offset(w) if w else None
            if off is None or off in recs or off > len(prog.evt.raw) - 0x24:
                continue
            recs[off] = evtlib.read_spawn(prog.evt, off, 0x0B)
    return list(recs.values())


def check_data(game: Path, tables, fails: list[str]) -> None:
    named: list[str] = []
    desc_bit15: list[str] = []
    cond4: dict[int, int] = {}
    records = 0
    for original in (False, True):
        for n in sorted(stagelib.STAGE_TO_SCENE):
            prog = scriptlib.Program(stagelib.Stage(game, stage=n,
                                                    original=original))
            for rec in with_civilian_children(prog):
                if rec.cls != 0x30:
                    continue
                records += 1
                where = f"stage {n}{' original' if original else ''} " \
                        f"0x{rec.offset:X}"
                char = rec.param(0, "i8") or 0
                cond = rec.param(1, "i8") or 0
                init = rec.param(2, "i8") or 0
                attack = rec.param(3, "i8") or 0
                if {init, attack} & SPLIT_STATES:
                    named.append(f"{where}: states {init}/{attack}")
                if rec.desc_flags & 0x8000:
                    desc_bit15.append(where)
                if cond == 4:
                    cond4[char] = cond4.get(char, 0) + 1
    orders: dict[int, int] = {}

    def walk(o) -> None:
        if isinstance(o, dict):
            if o.get("op") == 0x1A and o.get("args"):
                orders[o["args"][0]] = orders.get(o["args"][0], 0) + 1
            for v in o.values():
                walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)
    walk(tables.civilian_scripts())

    print(f"  {records} class-0x30 descriptors across both modes; body "
          f"condition 4 on " + ", ".join(f"type 0x{c:X} x{k}"
                                         for c, k in sorted(cond4.items())))
    print(f"  civilian op-0x1A orders: {sorted(orders.items())}")
    if records == 0 or not orders:
        fails.append("no class-0x30 descriptor or no civilian order read -- "
                     "the census is empty, not clean")
    if named:
        fails.append(f"{len(named)} descriptors name a half-body state: "
                     f"{named[:4]}")
    if set(orders) & SPLIT_STATES:
        fails.append(f"a civilian orders a half-body state: {sorted(orders)}")
    if desc_bit15:
        fails.append(f"{len(desc_bit15)} class-0x30 descriptors set bit 15 of "
                     f"+0x20: {desc_bit15[:4]}")
    # The control: the reached half is reached, by znkager and by nothing else.
    if set(cond4) != {0xC}:
        fails.append(f"body condition 4 on character types "
                     f"{sorted(hex(c) for c in cond4)}, expected 0xC alone")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--game-dir", type=Path)
    args = ap.parse_args()
    if args.game_dir is None:
        print("SKIP  no --game-dir: nothing to read")
        return 3
    game = args.game_dir.expanduser().resolve()
    tables = stagelib.get_tables(game)
    if tables is None:
        print(f"SKIP  no Hod2.exe under {game}")
        return 3
    data, v2r = image(tables)
    fails: list[str] = []
    print("ZombieSplitInTwo's three ways in:")
    check_state_table(data, v2r, fails)
    check_hit_result(data, v2r, fails)
    check_state_literals(data, v2r, fails)
    swept = check_split_armed_writers(data, v2r, fails)
    check_data(game, tables, fails)
    for f in fails:
        print(f"FAIL  {f}")
    if fails:
        return 1
    if not swept:
        return 3
    print("ok    nothing the shipped game runs reaches ZombieSplitInTwo, and "
          "condition 4 is znkager's alone")
    return 0


if __name__ == "__main__":
    sys.exit(main())
