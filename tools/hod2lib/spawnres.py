"""Resolve a spawn descriptor to what it actually is, and to geometry.

A spawn descriptor names a **class**; the class handler turns that into a
**character type** or an asset slot; the character type names a **skeleton**
in the EXE, whose nodes name asset slots; and a slot resolves through the
asset slot table to a **pol file**. Those filenames are the closest thing this
binary has to a name table -- `cat.bin`, `zabat.bin`, `hito_oyaji.bin` -- and
they are how a spawn gets identified without guessing.

What this module can and cannot do, stated plainly:

* **Identity: yes.** 85 character types resolve to a named asset file.
* **Single-model props: yes.** A class whose handler draws one asset slot can
  be placed and drawn exactly.
* **Skinned characters: not yet.** Every part model in `cat.bin` and
  `hito_manbest.bin` is authored about its own origin -- the per-part centroids
  are all within a unit of zero -- so the rest pose is **not** in the models.
  It lives in the motion data, and `mot/` is not decoded. Until it is, a
  character can be placed and named but not assembled.
"""
from __future__ import annotations

from dataclasses import dataclass

import struct

from . import degraded

__all__ = ["CHAR_TYPE_RULES", "ResolvedSpawn", "resolve_spawn",
           "resolve_stage_spawns"]


#: How each class finds its character type (`obj+0x1F4`), from the handler
#: decompilations in `docs/formats/spawns.md`. ``("tail", n, kind)`` reads the
#: parameter tail at ``obj+0x1390 + n`` (or ``obj+0x130C + n`` for opcode
#: 0x0C -- same file offset either way); ``("desc24",)`` is the opcode-0x09
#: path, where `FUN_004088A0` copies ``(s8)desc+0x24`` straight to obj+0x1F4;
#: ``("literal", v)`` is a constant the handler stores.
CHAR_TYPE_RULES: dict[int, tuple] = {
    0x10: ("tail", 0x00, "i8"),    # civilian; the type char picks the model
    0x11: ("tail", 0x00, "u16"),   # plain script-spawned enemy
    0x14: ("tail", 0x00, "u8"),    # multi-part enemy
    # **The character type is the tail's first byte, not 0x7C.** This row read
    # `("literal", 0x7C)` with the comment "FUN_004917E0 stores 0x7C", and it
    # does -- into `char+0x20`, which is `obj+0x1B4`, the **clip**:
    #
    #     0049182e  MOVZX DX, byte ptr [EDI]          ; EDI = obj+0x130C, the tail
    #     00491832  MOV word ptr [EAX + 0x60], DX     ; char+0x60 == obj+0x1F4
    #     0049183e  MOV dword ptr [ECX + 0x20], 0x7C  ; char+0x20 == obj+0x1B4
    #
    # Two instructions apart, and the wrong one was taken. Type 0x7C has no
    # skeleton at all, so every class-0x19 spawn resolved to "no skeleton",
    # never became a placement and never reached a bundle; the four shipped
    # tails all carry 0x4A, which is `boss4.bin` with fifteen nodes -- one per
    # per-bone model pointer in the same tail. See `game/class19/`.
    0x19: ("tail", 0x00, "u8"),    # the stage-4 boss
    0x20: ("tail", 0x00, "i8"),    # one-hit target; OneHitTargetInit's tail+0
    # The rescue target. It spawns through opcode 0x09, which copies
    # `(s8)desc+0x24` straight to `obj+0x1F4`, and `RescueTargetInit` reads
    # that field rather than writing one -- so the descriptor names the type.
    # The one shipped spawn carries 7, the same `char_adv00.bin` class 0x20
    # uses. Without this rule the actor is never built and stage 2's first
    # branch cannot be answered.
    0x21: ("desc24",),
    0x22: ("literal", 0x45),       # FUN_0049B0D0 stores 0x45
    0x24: ("tail", 0x04, "i8"),    # set-piece prop: tail+4 -> obj+0x1F4
    0x25: ("tail", 0x00, "i8"),    # scripted humanoid
    0x2D: ("literal", 0x4C),       # FUN_00426A70 stores 0x4C
    0x30: ("tail", 0x00, "i8"),    # the zombie
    0x31: ("tail", 0x00, "i8"),    # humanoid enemy, subtypes 0x16-0x19
    0x32: ("tail", 0x00, "i8"),    # enemy, per-instance asset
    # `PlaceBats` (`FUN_0042D9C0`) writes `obj+0x1F4 = 0x1E` as a literal on
    # every member of every flight -- `zabat.bin`, one node, asset slot
    # `0x1B01`. The descriptor's own `+0x24` is the flight GROUP here and not
    # a character type, so `desc24` would resolve stage 4's four flights to
    # types 0, 2 and 3 and stage 3's to 1. The wing actor's `0x1F` has no rule
    # because it has no descriptor: see the note in `game/class46/`.
    0x46: ("literal", 0x1E),       # the bat
    0x53: ("literal", 0x1A),       # FUN_00431250 stores 0x1A -- cat.bin
}


@dataclass
class ResolvedSpawn:
    spawn: object                 #: the `evt.Spawn` record
    char_type: int | None = None
    asset_file: str | None = None
    node_count: int = 0
    note: str = ""

    @property
    def identified(self) -> bool:
        return self.asset_file is not None


def _desc24_i8(spawn) -> int | None:
    """The signed byte at ``desc+0x24``, for the opcode-0x09 spawns."""
    from . import evt as evtlib
    if spawn.evt is None:
        return None
    off = spawn.offset + evtlib.SPAWN_HEADER
    if off < 0 or off >= len(spawn.evt.raw):
        return None
    return struct.unpack_from("<b", spawn.evt.raw, off)[0]


def resolve_spawn(tables, spawn) -> ResolvedSpawn:
    """Identify one spawn descriptor."""
    rule = CHAR_TYPE_RULES.get(spawn.cls)
    ct: int | None = None
    if rule is None:
        # Deliberately no fallback. Opcode 0x09 does copy desc+0x24 into
        # obj+0x1F4, but plenty of classes then use that field for something
        # else entirely -- class 0x41 uses it as the prop's lifetime in event
        # blocks. Reading it as a character type anyway "identified" 962 of
        # 1225 spawns, most of them as char_adv02 simply because a lifetime of
        # 0 is character type 0. A class earns a rule by having its handler
        # read; it does not get one by default.
        return ResolvedSpawn(spawn, note="no character-type rule for this class")
    if rule[0] == "literal":
        ct = rule[1]
    elif rule[0] == "tail":
        ct = spawn.param(rule[1], rule[2])
    elif rule[0] == "desc24":
        # Opcode 0x09's path: `FUN_004088A0` copies `(s8)desc+0x24` straight to
        # `obj+0x1F4` and there is no parameter block, so `Spawn.param` -- which
        # refuses every opcode but 0x0B/0x0C/0x0D -- cannot read it. This is
        # that byte, read where it lies. The docstring on `CHAR_TYPE_RULES` has
        # named this form since it was written; the arm was missing.
        ct = _desc24_i8(spawn)

    if ct is None or ct < 0:
        return ResolvedSpawn(spawn, note="no character-type rule for this class")
    skel = tables.character_skeleton(ct)
    if not skel:
        return ResolvedSpawn(spawn, char_type=ct,
                             note=f"type {ct:#04x} has no skeleton")
    return ResolvedSpawn(spawn, char_type=ct,
                         asset_file=tables.character_asset_file(ct),
                         node_count=len(skel))


def resolve_stage_spawns(stage, prog=None) -> list[ResolvedSpawn]:
    """Identify every spawn descriptor the stage's event script reaches."""
    from . import evt as evtlib, script as scriptlib
    if prog is None:
        try:
            prog = scriptlib.load(stage)
        except Exception as exc:
            degraded.note("the stage's event script",
                          "no resolved spawns", exc)
            return []
    out = []
    for rec in evtlib.spawns(prog.evt):
        out.append(resolve_spawn(stage.tables, rec))
    return out
