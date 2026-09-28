#!/usr/bin/env python3
"""Check the continue screen -- its draws, its timer and its gate -- against
the EXE.

When the last life goes, `RunPhaseContinueCountdown` (`FUN_00460530`) draws
"CONTINUE?" and a countdown digit over a scene that keeps running, each
player's task draws its own share (`PlayerContinueCountdown`, `FUN_00414280`:
the small CONTINUE? of a two-player game, and the credit line), and every
wait opcode of the script holds while nobody is in play. The port has it in
`web/src/game/run_phase.ts`, `continue_readout.ts`, `credit_prompt.ts`,
`hud_sprites.ts` and `script/waits/`. Everything it draws is a sprite id at a
position the EXE pushes as an immediate or keeps in a small `.rdata` table,
so a wrong reading is a picture in the wrong place -- or, as it was, no
picture at all -- and nothing else would notice.

What this asserts, and what only this can see:

  * **The port's positions, scales, sprite ids and timer constants are the
    EXE's immediates**, read as instruction bytes at the address each one is
    pushed or compared from: the run's CONTINUE? and digit, the small ones,
    the small GAME OVER, `0x9FFF`, `0x2D`, `0x8000`, the digit base `0x4F`
    and the continue buttons `4` / `0x40000`.
  * **The four `.rdata` tables** the credit line and the small prompts read --
    `g_credit_prompt_pos`, `g_credit_prompt_messages`,
    `g_credit_count_layout`, `g_continue_prompt_x`, `g_player_game_over_x` and
    `g_app_state_press_start` -- equal the port's literals row for row.
  * **Only one credit-line drawer can run.** Every store into
    `g_credits_to_start` / `g_credits_to_continue` in `.text` is the pair in
    `CreditsBootReset` and it stores 1, so `CreditPromptDraw`'s "costs more
    than one" entries are unreachable -- which is why the port has only the
    first.
  * **Every sprite the port draws resolves** through the EXE's sprite tables
    to `scr_common.bin` at the size the port's comments give, and is in the
    exporter's list.
  * **Every wait opcode reads the gameplay gate.** The eight handlers
    `0x40..0x47` of the evt dispatch table each name `g_evt_gameplay_live`
    (`0x007DCCA4`) -- the reading behind the script standing still on the
    continue screen. `wait_camera_path_frame` is among them; an earlier
    annotation said it was not.
"""
from __future__ import annotations

import argparse
import re
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from hod2lib.exetab import ExeTables  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
GAME = ROOT / "web/src/game"

EVT_DISPATCH = 0x005931D8
GAMEPLAY_LIVE = 0x007DCCA4
CREDITS_TO_START = 0x009C8E78
CREDITS_TO_CONTINUE = 0x009C8E7C


class Failures:
    def __init__(self) -> None:
        self.n = 0

    def check(self, ok: bool, msg: str) -> None:
        if ok:
            return
        self.n += 1
        print(f"  FAIL {msg}")


def f32(v: float) -> bytes:
    return struct.pack("<f", v)


def port_const(src: str, name: str) -> float | None:
    m = re.search(rf"\b(?:export )?const {name}(?:: number)? = "
                  rf"(?:Math\.fround\()?(-?0x[0-9a-fA-F]+|-?[\d.]+)\)?;", src)
    if not m:
        return None
    v = m.group(1)
    return float(v) if "." in v else int(v, 0)


def port_array(src: str, name: str) -> list[float] | None:
    m = re.search(rf"const {name}: readonly number\[\] = \[([^\]]*)\]", src)
    if not m:
        return None
    return [float(x) if "." in x else int(x, 0)
            for x in (t.strip() for t in m.group(1).split(",")) if x]


def port_rows(src: str, name: str) -> list[dict[str, str]] | None:
    m = re.search(rf"const {name}: readonly [^=]+= \[(.*?)\n\];", src, re.S)
    if not m:
        return None
    return [dict(re.findall(r"(\w+): ([^,}]+)", row))
            for row in re.findall(r"\{([^}]*)\}", m.group(1))]


def port_enum(src: str, enum: str) -> dict[str, int]:
    m = re.search(rf"export enum {enum} \{{(.*?)\n\}}", src, re.S)
    if not m:
        return {}
    return {k: int(v, 0) for k, v in
            re.findall(r"^\s*(\w+) = (0x[0-9a-fA-F]+|\d+),", m.group(1), re.M)}


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

    def mem(va: int, n: int) -> bytes:
        return raw[at(va):at(va) + n]

    def u32(va: int) -> int:
        return struct.unpack_from("<I", raw, at(va))[0]

    def fl(va: int) -> float:
        return struct.unpack_from("<f", raw, at(va))[0]

    src = {f: (GAME / f).read_text() for f in (
        "run_phase.ts", "continue_readout.ts", "credit_prompt.ts",
        "hud_sprites.ts", "player_shell.ts")}
    sprites = port_enum(src["hud_sprites.ts"], "ContinueSprite")
    hud = port_enum(src["hud_sprites.ts"], "HudSprite")

    # -- the immediates ------------------------------------------------------
    # (instruction address, expected bytes, what the port calls it)
    def push_f(v: float) -> bytes:
        return b"\x68" + f32(v)

    def push_i(v: int) -> bytes:
        return b"\x68" + struct.pack("<I", v)

    rp = src["run_phase.ts"]
    cr = src["continue_readout.ts"]
    ps = src["player_shell.ts"]
    imms = [
        # RunPhaseContinueCountdown
        (0x00460617, push_i(sprites.get("Continue", -1)), "ContinueSprite.Continue"),
        (0x00460612, push_f(port_const(rp, "RUN_CONTINUE_X") or -1), "RUN_CONTINUE_X"),
        (0x0046060D, push_f(port_const(rp, "RUN_CONTINUE_Y") or -1), "RUN_CONTINUE_Y"),
        (0x0046064D, push_f(port_const(rp, "RUN_CONTINUE_DIGIT_X") or -1), "RUN_CONTINUE_DIGIT_X"),
        (0x00460645, push_f(port_const(rp, "RUN_CONTINUE_DIGIT_Y") or -1), "RUN_CONTINUE_DIGIT_Y"),
        (0x0046064A, bytes([0x83, 0xC0, sprites.get("BigDigit0", 0)]), "ContinueSprite.BigDigit0"),
        (0x00460587, b"\xBA" + struct.pack("<I", port_const(rp, "CONTINUE_TIMER_START") or 0), "run_phase CONTINUE_TIMER_START"),
        (0x0046068A, bytes([0x83, 0xE8, port_const(rp, "CONTINUE_TIMER_STEP") or 0]), "run_phase CONTINUE_TIMER_STEP"),
        (0x004605C8, bytes([0x83, 0xE0, 0x04]), "the player-0 continue button, g_pad_state & 4"),
        (0x004605D9, b"\x81\xE1" + struct.pack("<I", 0x40000), "the player-1 continue button, & 0x40000"),
        (0x004605E5, b"\x81\xFA" + struct.pack("<I", 0x8000), "the knock's ceiling, CMP EDX, 0x8000"),
        # PlayerStateArmContinue / PlayerContinueCountdown
        (0x00414304, b"\xC7\x46\x68" + struct.pack("<I", port_const(ps, "CONTINUE_TIMER_START") or 0), "player_shell CONTINUE_TIMER_START"),
        (0x00414344 + 3, bytes([0x83, 0xC1, (-(port_const(ps, "CONTINUE_TIMER_STEP") or 0)) & 0xFF]), "player_shell CONTINUE_TIMER_STEP (ADD ECX, -0x2D)"),
        (0x00414334, b"\x3D" + struct.pack("<I", 0x8000), "the per-player knock's ceiling"),
        # HudDrawContinuePrompt / HudDrawContinueDigit
        (0x004168A6, push_i(sprites.get("Continue", -1)), "HudDrawContinuePrompt's sprite"),
        (0x004168A0, push_f(port_const(cr, "CONTINUE_PROMPT_Y") or -1), "CONTINUE_PROMPT_Y"),
        (0x00416896, push_f(port_const(cr, "CONTINUE_PROMPT_SX") or -1), "CONTINUE_PROMPT_SX"),
        (0x00416891, push_f(port_const(cr, "CONTINUE_PROMPT_SY") or -1), "CONTINUE_PROMPT_SY"),
        (0x00416884, bytes([0x6A, port_const(cr, "CONTINUE_PROMPT_LAYER") or 0]), "CONTINUE_PROMPT_LAYER"),
        (0x004168E6, push_f(port_const(cr, "CONTINUE_DIGIT_Y") or -1), "CONTINUE_DIGIT_Y"),
        (0x004168F0, bytes([0x83, 0xC1, sprites.get("BigDigit0", 0)]), "HudDrawContinueDigit's digit base"),
        # HudDrawPlayerGameOver
        (0x00416924, push_i(sprites.get("GameOver", -1)), "ContinueSprite.GameOver"),
        (0x0041691E, push_f(port_const(cr, "PLAYER_GAME_OVER_Y") or -1), "PLAYER_GAME_OVER_Y"),
        (0x00416914, push_f(port_const(cr, "PLAYER_GAME_OVER_SX") or -1), "PLAYER_GAME_OVER_SX"),
        (0x00416908, push_f(port_const(cr, "PLAYER_GAME_OVER_SY") or -1), "PLAYER_GAME_OVER_SY"),
        # HudDrawScoreCheat
        (0x00413FB0, b"\x83\x3D" + struct.pack("<I", 0x009C87FC) + bytes([port_const(cr, "SCORE_CHEAT_ON") or 0]), "SCORE_CHEAT_ON"),
        (0x00413FC6, push_f(port_const(cr, "SCORE_CHEAT_Y") or -1), "SCORE_CHEAT_Y"),
        # CreditBlinkTick's attract prompt
        (0x00406842, b"\xC7\x05" + struct.pack("<II", 0x005A4CE8, sprites.get("PressStartAttract", -1)), "ContinueSprite.PressStartAttract"),
    ]
    for va, want, what in imms:
        got = mem(va, len(want))
        fail.check(got == want, f"{what}: the EXE at {va:#x} is {got.hex()}, "
                   f"the port's reading encodes {want.hex()}")
    fail.check(port_const(rp, "CONTINUE_TIMER_START") == 0x9FFF
               and port_const(ps, "CONTINUE_TIMER_START") == 0x9FFF,
               "the two continue timers do not both start at 0x9FFF")
    # The small digit's x step and the score digits' step are floats in .rdata.
    fail.check(fl(0x004ECB6C) == port_const(cr, "CONTINUE_DIGIT_DX"),
               f"CONTINUE_DIGIT_DX is not the EXE's {fl(0x004ECB6C)}")
    fail.check(fl(0x004D1D20) == port_const(cr, "SCORE_DIGIT_STEP"),
               f"SCORE_DIGIT_STEP is not the EXE's {fl(0x004D1D20)}")
    fail.check(u32(0x00413FFD) == struct.unpack("<I", f32(0.99))[0],
               "the score record's depth is not 0x3F7D70A4")
    print(f"  immediates: {len(imms)} instructions hold what the port reads")

    # -- the tables ----------------------------------------------------------
    pos = [(fl(0x00577620 + 8 * p), fl(0x00577624 + 8 * p)) for p in (0, 1)]
    port_pos = [(float(r["x"]), float(r["y"]))
                for r in port_rows(src["credit_prompt.ts"],
                                   "CREDIT_PROMPT_POS") or []]
    fail.check(port_pos == pos, f"g_credit_prompt_pos is {pos}, the port's "
               f"{port_pos}")

    def rows(va: int) -> list[tuple[float, float, float, int]]:
        return [(fl(va + 16 * i), fl(va + 16 * i + 4), fl(va + 16 * i + 8),
                 u32(va + 16 * i + 12)) for i in range(4)]

    def port_table(name: str) -> list[tuple[float, float, float, int]]:
        out = []
        for r in port_rows(src["hud_sprites.ts"], name) or []:
            ident = r["id"].strip()
            if ident.startswith("ContinueSprite."):
                idv = sprites.get(ident.split(".")[1], -1)
            else:
                idv = int(ident, 0)
            out.append((float(r["dx"]), float(r["dy"]),
                        struct.unpack("<f", f32(float(r["scale"])))[0], idv))
        return out

    for va, name in ((0x004C4B10, "CREDIT_PROMPT_MESSAGES"),
                     (0x004C4A40, "CREDIT_COUNT_LAYOUT")):
        exe = rows(va)
        port = port_table(name)
        fail.check(exe == port, f"{name} is {port}, the EXE's at {va:#x} "
                   f"{exe}")
    for va, name in ((0x00579F68, "CONTINUE_PROMPT_X"),
                     (0x00579F70, "PLAYER_GAME_OVER_X")):
        exe = [fl(va), fl(va + 4)]
        fail.check(port_array(cr, name) == exe,
                   f"{name} is {port_array(cr, name)}, the EXE's {exe}")
    press = [struct.unpack_from("<h", raw, at(0x004C4B90 + 4 * a))[0]
             for a in range(17)]
    fail.check(port_array(src["credit_prompt.ts"], "APP_STATE_PRESS_START")
               == press, f"APP_STATE_PRESS_START is not the EXE's {press}")
    fail.check(press[6] == 0 and press[7] == 0,
               "the attract PRESS START is marked for app state 6 or 7")
    print(f"  tables: the credit line's positions, messages and count layout, "
          f"the small prompts' x, and the PRESS START screens "
          f"{[a for a, v in enumerate(press) if v]}")

    # -- only one credit-line drawer --------------------------------------
    text = next(s for s in tables._sections if s[0] == ".text")
    _, tva, tvs, tra, trs = text
    body = raw[tra:tra + trs]
    stores: list[int] = []
    for addr in (CREDITS_TO_START, CREDITS_TO_CONTINUE):
        needle = struct.pack("<I", addr)
        k = body.find(needle)
        while k >= 0:
            op1, op2 = body[k - 1], body[k - 2]
            direct = op1 == 0xA3 or (op2 in (0x89, 0xC7, 0x83, 0x81, 0xFF,
                                             0x01, 0x29, 0x09, 0x21, 0x31)
                                     and (op1 & 0xC7) == 0x05)
            if direct:
                stores.append(0x00400000 + tva + k - (1 if op1 == 0xA3 else 2))
            k = body.find(needle, k + 1)
    fail.check(sorted(stores) == [0x004066D7, 0x004066DC],
               f"stores into the credit costs at {[hex(s) for s in stores]}, "
               "not only CreditsBootReset's two")
    fail.check(mem(0x004066D0, 5) == b"\xB8\x01\x00\x00\x00",
               "CreditsBootReset does not load 1 before storing the costs")
    drawers = [u32(0x00577640 + 4 * i) for i in range(3)]
    fail.check(drawers[0] == 0x00406860,
               f"g_credit_prompt_drawers[0] is {drawers[0]:#x}, not "
               "CreditPromptDrawSingle")
    print(f"  drawers: {', '.join(hex(d) for d in drawers)}; the costs are "
          "stored only by CreditsBootReset, as 1 -- entry 0 is the only one")

    # -- the sprites resolve -----------------------------------------------
    sizes = {"Continue": (512, 64), "Credits": (128, 32), "FreePlay": (128, 32),
             "GameOver": (512, 64), "InsertCoins": (256, 32),
             "InsertMoreCoins": (256, 32), "PressStart": (128, 16),
             "PressStartAttract": (512, 32)}
    ids = {**{k: v for k, v in sprites.items() if k != "BigDigit0"},
           **{f"BigDigit{d}": sprites.get("BigDigit0", 0) + d
              for d in range(10)}}
    for name, sid in ids.items():
        hit = tables.screen_sprite(sid)
        if hit is None:
            fail.check(False, f"ContinueSprite {name} {sid:#x} resolves to "
                       "no texture")
            continue
        bank, e, _pal = hit
        want = sizes.get(name, (64, 128))
        fail.check(bank == "scr_common" and (e.width, e.height) == want,
                   f"{name} {sid:#x} is {bank} {e.width}x{e.height}, the "
                   f"port says scr_common {want[0]}x{want[1]}")
    fail.check(hud.get("Digit0") == 0x59, "the credit count's digits moved")
    export = (ROOT / "web/src/hod2lib/bundle.ts").read_text()
    fail.check("CONTINUE_SCREEN_SPRITES" in export,
               "the exporter does not put the continue screen's sprites in "
               "the bundle")
    print(f"  sprites: {len(ids)} ids resolve in scr_common at the sizes "
          "given, and the exporter lists them")

    # -- every wait opcode reads the gate --------------------------------
    handlers = [u32(EVT_DISPATCH + 4 * op) for op in range(0x40, 0x49)]
    live = struct.pack("<I", GAMEPLAY_LIVE)
    for i, op in enumerate(range(0x40, 0x48)):
        lo, hi = handlers[i], handlers[i + 1]
        fail.check(lo < hi and live in mem(lo, hi - lo),
                   f"wait opcode {op:#x}'s handler {lo:#x} never names "
                   "g_evt_gameplay_live")
    print(f"  gate: all eight wait handlers 0x40..0x47 read "
          f"g_evt_gameplay_live ({GAMEPLAY_LIVE:#x})")

    if fail.n:
        print(f"\n{fail.n} failure(s)")
        return 1
    print("\nOK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
