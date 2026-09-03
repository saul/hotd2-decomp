"""The little bytecode blobs an actor state steps through.

Three shapes, all of them lists of motion entries compiled into Hod2.exe
rather than authored in `evt/`: the target scripts `ZombieScriptForState`
(`FUN_0045CA10`) hands to the class-0x30 states that work on ``obj+0x1394``,
the class-0x10 civilian command streams, and the item slots those streams
draw. A list ends on the first entry whose motion is below 1.
"""

from __future__ import annotations

import struct


#: The class-0x30 states that work on ``obj+0x1394`` -- the object the actor
#: was built for, which for the 47 class-0x10 captors is the civilian.
#:
#: Each takes a script through `ZombieScriptForState` (`FUN_0045CA10`): the
#: descriptor tail's `+0x08` when the actor is in the tail's attack state,
#: `+0x04` otherwise. The blob opens with a header whose shape belongs to the
#: state that *entered* it and continues as a list of motion entries, which
#: `ZombieStateTargetMotionScript` (state 35) steps whoever put the cursor
#: there. A list ends on the first entry whose motion is below 1.
#:
#: ``(header bytes, shorts per entry)``.
TARGET_SCRIPT_SHAPE: dict[int, tuple[int, int]] = {
    34: (10, 4),   # {f32 arrive_dist; u16 loops; u16 motion; u16 frame}
    35: (0, 4),    # straight into the entries
    36: (0, 5),    # ...with a g_script_flags index per entry
    37: (0x38, 4),  # the carried-prop record; [open] beyond its motion fields
    38: (20, 4),   # {f32 x, y, z; s16 motion, frame; s16 loops, mode}
    40: (16, 4),   # {f32 x, y, z; s16 motion, frame}
    41: (16, 4),   # the same, arrived at rather than walked past
    43: (4, 0),    # {s16 loops; s16 cue_frame} -- no list
}


def target_script(prog, off: int, state: int) -> dict | None:
    """One captor script blob, decoded for the state that enters it.

    The check that the shapes are right is that **every** blob terminates: all
    86 the six stages reach end on an entry whose motion is below 1, within 64
    entries. A wrong header length walks into the middle of a float and the
    list runs away immediately.
    """
    shape = TARGET_SCRIPT_SHAPE.get(state)
    if shape is None or off is None:
        return None
    head_len, per = shape
    raw = prog.evt.raw
    if off + head_len > len(raw):
        return None
    head: dict = {}
    if state == 34:
        head = {"arrive": struct.unpack_from("<f", raw, off)[0],
                "loops": struct.unpack_from("<H", raw, off + 4)[0],
                "motion": struct.unpack_from("<H", raw, off + 6)[0],
                "frame": struct.unpack_from("<H", raw, off + 8)[0]}
    elif state in (38, 40, 41):
        pt = list(struct.unpack_from("<3f", raw, off))
        head = {"point": pt,
                "motion": struct.unpack_from("<h", raw, off + 12)[0],
                "frame": struct.unpack_from("<h", raw, off + 14)[0]}
        if state == 38:
            head["loops"] = struct.unpack_from("<h", raw, off + 16)[0]
            head["mode"] = struct.unpack_from("<h", raw, off + 18)[0]
    elif state == 43:
        head = {"loops": struct.unpack_from("<h", raw, off)[0],
                "cue": struct.unpack_from("<h", raw, off + 2)[0]}
    entries: list[dict] = []
    p = off + head_len
    while per and len(entries) < 64 and p + per * 2 <= len(raw):
        v = struct.unpack_from("<%dh" % per, raw, p)
        if v[0] < 1:
            break
        e = {"motion": v[0], "frame": v[1], "loops": v[2], "mode": v[3]}
        if per > 4:
            e["flag"] = v[4]
        entries.append(e)
        p += per * 2
    return {"state": state, "head": head, "entries": entries}


def target_script_motions(script: dict | None) -> list[int]:
    """Every clip a decoded captor script names, for the bake list."""
    if not script:
        return []
    out = [script["head"].get("motion", 0)]
    out += [e["motion"] for e in script["entries"]]
    return [m for m in out if 0 < m < 4096]


def civilian_motion_ids(block: dict, entry: int) -> list[int]:
    """Every clip class 0x10's script *entry* can reach.

    Ops 0x00 and 0x01 name the clip; ops 0x0E, 0x0F, 0x1E and 0x1F name another
    stream, so the answer is the transitive closure from the entry rather than
    one stream's worth. `bake` refuses a clip authored for another skeleton,
    so the whole set is offered rather than filtered here.
    """
    scripts = block.get("scripts") or []
    entries = block.get("entries") or []
    if not (0 <= entry < len(entries)):
        return []
    out: list[int] = []
    seen: set[int] = set()
    pending = [entries[entry]]
    while pending:
        i = pending.pop()
        if i in seen or not (0 <= i < len(scripts)):
            continue
        seen.add(i)
        for c in scripts[i]:
            if c["op"] in (0, 1):
                m = c["args"][0]
                if 0 < m < 4096:
                    out.append(m)
            pending += [j for j in (c.get("scripts") or []) if j >= 0]
    return sorted(set(out))


def civilian_item_slots(block: dict, entry: int) -> set[int]:
    """Every asset slot class 0x10's script *entry* can put in a hand.

    Ops 0x13 and 0x14 name a record directly, op 0x15 a weighted table of
    them, and a record draws its own slot plus, for some kinds, a fixed second
    one. All of it goes in the hidden template the client clones from.
    """
    scripts = block.get("scripts") or []
    entries = block.get("entries") or []
    items = block.get("items") or []
    if not (0 <= entry < len(entries)):
        return set()
    picked: set[int] = set()
    seen: set[int] = set()
    pending = [entries[entry]]
    while pending:
        i = pending.pop()
        if i in seen or not (0 <= i < len(scripts)):
            continue
        seen.add(i)
        for c in scripts[i]:
            if c.get("item") is not None and c["item"] >= 0:
                picked.add(c["item"])
            for _w, k in c.get("itemTable") or ():
                if k >= 0:
                    picked.add(k)
            pending += [j for j in (c.get("scripts") or []) if j >= 0]
    out: set[int] = set()
    for k in picked:
        if 0 <= k < len(items):
            out.add(items[k]["slot"])
            if items[k].get("extra"):
                out.add(items[k]["extra"])
    return out
