"""Whole-corpus checks on the shot/damage tables.

Each check is chosen so that a wrong *reading* fails it, not just a wrong
byte. The readings under test are the ones docs/formats/combat.md states:

1. **The effect table's small values are control codes, not asset slots.**
   `ResolveHit` branches on ``effect[i + 1]`` being 0, 1 or 2. If that were
   really a slot number the table would contain slots near zero. Across every
   character type the values are either 0, 1, 2 or at least ``0xB91`` -- a gap
   of nearly three thousand, with nothing in it.

2. **Slots resolve.** Every value above the gap resolves through the asset
   slot table to a ``(file, part)`` -- ``0xB91`` is ``frog.bin`` part 3,
   ``0x1B70`` is ``harold.bin`` part 97. That is the test that the values are
   asset slots at all, and it is what a wrong stride or a wrong base would
   fail. The damaged-part **sphere** table is a separate lookup that is
   allowed to miss: `ActorSwapDamagedPart` writes the slot unconditionally and
   `ResolveDamagedPartSphere` only supplies a hit volume if it finds one.

3. **A sever has something to sever.** Every ``code == 1`` step sits on a bone
   with children, so `SeverBoneChildren` always has a subtree to remove.

4. **The export matches the EXE.** `characters.hit_steps` is re-derived here
   from raw bytes, independently of the library's own helpers.

5. **Hit points stay in range.** `ActorInitHitPoints` clamps to ``[1, 300]``
   on every difficulty, for every spawn in every stage.

6. **The stumble set is a stumble set.** Every reaction motion resolves to a
   `g_motion_play_length` entry, every reaction row has all eight groups
   filled, and **every reaction is shorter than every death** -- 29 to 43
   frames against 74 to 161. A misread table would not land on that side of
   the line by accident. The bone-to-group map is also checked to partition
   bones 1..15 into the seven named regions and nothing else.

7. **The approach and tracking tables are shaped like what they claim to be.**
   Every ring set is ordered ``inner < mid <= outer``; the step counts grow
   outward; every turn-rate curve has 64 positive entries; and the curve the
   scene reset selects is **non-increasing** — the camera can only turn faster
   as the target gets further off-axis, never slower. A misread stride or base
   would break the ordering. Curve **0** is skipped: it lives in `.data` at
   `0x0059C9A8`, not `.rdata`, and is a runtime working copy that is zero in
   the file on disk.

8. **Every attack resolves.** `attack_tables` exports only the entries the
   pick table names, and each is kept only if its **hit frame lands inside its
   own strike clip** — the frame and the clip length come from different
   tables, so a wrong stride cannot satisfy both. This re-checks the survivors
   and asserts that every character with a pick table yields at least one
   usable attack, which is what would fail if the filter were throwing
   everything away.

9. **Every thrown attack resolves.** For each type that throws, the release
   frame lands inside its own throw clip, the cancel mask is one of the three
   the melee table also uses — 2 right arm, 4 left arm, 8 uncancellable — and
   every held, bare and projectile slot resolves through the asset slot table.
   Body conditions 0, 1 and 3 name the throwing arm; condition 2 uses a
   different clip and the uncancellable mask, so the arm-matching rule is
   reported rather than asserted.

10. **Every class with a motion rule actually produces posed actors.**
    `resolve_for_stage` skips any spawn whose class has no entry in
    `MOTION_RULES`, so a class can be fully decoded — attack tables, throw
    tables, everything — and still export nothing at all. That is exactly what
    happened to class 0x31: its tables were right and no bundle carried a
    single thrower, because the class had no motion rule and every one of its
    spawns was dropped before `_build` ran.

11. **A motion belongs to one skeleton, and the tables respect that.** Every
    motion block declares its own frame count and occupies a known span, so
    `span / frames` gives its stride and hence the bone count it was authored
    for. This checks that each character's back-away clip
    (`motion_row[condition][4]`) implies **that character's own** bone count —
    the invariant the exporter's old `bone_count == 16` guards were a proxy
    for. It is what separates a real table row from one belonging to another
    creature: the shared, condition-indexed throw table has rows naming
    `kame.bin` clips, which imply 24 bones and are refused.

12. **Every sound id names a file.** The voice, impact and ricochet tables are
   read as `g_se_name_list` ids; a table read at the wrong address would give
   ids that resolve to nothing, so this fails loudly if the address is wrong.

15. **`ActorPlayHitVoice` kinds 1 and 2 share one voice pair**, their impact
   tables are five body ids and two head ids with nothing in common, and kind
   3's entry is a *pair per set* where the others are one id per set. The first
   of those is why the port's correction from `bone == 2` to
   `g_hit_result == 2` is nearly inaudible, and a claim that small deserves a
   check rather than a sentence in a doc comment (`L26`).

16. **Every arc script fits its own clips.** `ActorArcStep` (`FUN_0044D860`)
    waits on `obj+0x19C` reaching each stage's threshold, and that cursor
    wraps at ``g_motion_play_length + 1``: a threshold or a start frame past
    the play length of the motion the stage plays is an actor parked in its
    leap for ever. All 41 scripts class 0x31 and class 0x30 can install --
    the named ones, every attack entry's, the two entrance scripts -- keep
    every start and threshold inside it, which is what says the port's
    one-shot channel ending first is never the thing that ends an arc.
    Seven stage changes switch clips: five scripts end on a different clip
    from the two stages before it -- set 3's attack 3 in all five stances --
    and `ThrowerStatePathFollow`'s style-2 script (`0x00565E88`) flies on 300
    between two stages of 301, so the bound is taken per stage, not per
    script, and `InstallArcMotionScript`'s old note that every script is one
    clip was wrong. The count was 38 until the path follow's three scripts
    were exported -- they were not, and the rooftop route in stage 2 flew with
    no clip at all. It was nine until zslman's leap-aside scripts were read
    at the stride `ThrowerStateLeapAside` names them at: at `0x30` rows 1 and
    3 were two of those pounce scripts, which is where the other two
    switches came from. So the check also reads the four `MOV ESI, imm32`
    the state picks them with (`0x0044BAB1`..`0x0044BAD0`) and holds the
    exported four to exactly those addresses.

17. **A bone record's hit sphere comes from the row whose slot is the
    node's, and the rows the later writers read are the rows they say.**
    `SkeletonWalkNode`'s gate (`CMP EDX,[EDI]; JNZ` at ``0x00410830``) is
    read out of ``.text``, and the bones it refuses are held to ``GATED``. `ThrowerStateRearm` and
    `ThrowerStateRestoreBothHands` load rows 4 and 7 -- type 0x16's by name,
    the actor's own by index -- and those rows' **slots are the armed hands
    `EnemyThrowerInit` writes as immediates** at ``0x00449877`` and
    ``0x00449881``: a table and an instruction stream agreeing, which only a
    right row stride and a right ``bone - 1`` can produce. Every type whose
    effect table names a slot has a damaged-part tail that ends in ``-1``
    inside the image; where a type's own tail and type 7's (or 0xB's) both
    have a slot, the two rows are the same row, which is why running both
    searches cannot be told from a fallback; the exporter's rows are a raw
    first-match read; and every class-0x30/0x18 spawn of types 2, 3 and 0xE
    names a collision blob at its tail's ``+0x10``.

Known exception, reported rather than hidden: character type 21 (`samson`, a
boss) has a `PTR_DAT_004D032C` entry that is not the ``{slot, centre, radius}``
layout the others use -- its first word is a float. Its damaged-part spheres
are `[open]`. Its effect *slots* still resolve, so only check 2's sphere half
is affected.

    python3 tools/verify_combat.py --game-dir ~/"THE HOUSE OF THE DEAD 2"
"""
from __future__ import annotations

import argparse
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from hod2lib.arcscript import (CLASS30_ARC_SCRIPTS, CLASS31_ARC_SCRIPTS,
                               CLASS31_ASIDE_ZSLMAN_IMM,
                               CLASS31_ASIDE_ZSLMAN_STRIDE, arc_script)
from hod2lib.characters import MOTION_ROW_BACKOFF
from hod2lib import characters as ch          # noqa: E402
from hod2lib import stage as stagelib         # noqa: E402

#: Below this every effect-table value is a control code; above it, a slot.
#: Measured, not assumed -- check 1 is what establishes there is a gap at all.
CONTROL_MAX = 2
#: Boss with a non-standard part table; see the module docstring.
NONSTANDARD_PART_TABLE = {21}

#: The one attack entry in the whole table whose hit frame its own strike clip
#: never reaches, shared by three character types: the row at `0x00566E70`,
#: ``{997, 1051, 26.0f, 40, 9, 1}`` against ``g_motion_play_length[997] ==
#: 20``. `combat.attack_hit_lands` is why that is the engine's own miss rather
#: than a misread row, and check 8 asserts this exact set instead of the bound
#: it used to impose -- so a genuinely misread row still fails, while the
#: crawlers keep the swing they are meant to whiff.
ATTACK_MISS_TYPES = (0x07, 0x0B, 0x0C)
ATTACK_MISS_COND = 4
ATTACK_MISS_INDEX = 2
ATTACK_MISS_CLIP = 997
ATTACK_MISS_HIT_FRAME = 40
ATTACK_MISS_PLAY = 20


def _flat(tables, base: int, ct: int, count: int) -> list[int]:
    """A raw, independent read of a per-character u16 table."""
    b = tables._v2r(base)
    p = tables._v2r(struct.unpack_from("<I", tables.data, b + ct * 4)[0])
    return list(struct.unpack_from(f"<{count}H", tables.data, p))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--game-dir", required=True)
    args = ap.parse_args()
    tables = stagelib.get_tables(args.game_dir)
    if tables is None:
        print("error: Hod2.exe not found", file=sys.stderr)
        return 2

    fails: list[str] = []
    types = [ct for ct in range(160) if tables.character_skeleton(ct)]
    print(f"{len(types)} character types with a skeleton")

    # 1 + 2 + 3 + 4 ------------------------------------------------------
    slots = tables.asset_slots()
    codes: set[int] = set()
    min_slot = 1 << 30
    n_slots = n_sever = n_sever_leaf = n_sphered = 0
    unresolved: list[str] = []
    mismatch = 0
    for ct in types:
        skel = tables.character_skeleton(ct)
        kids: dict[int, list[int]] = {}
        for n in skel:
            if n["parent"] is not None:
                kids.setdefault(skel[n["parent"]]["bone"], []).append(n["bone"])
        gore = set(ch.gore_parts(tables, ct))
        nb = tables.character_bone_count(ct) or 0
        eff = _flat(tables, ch.HIT_EFFECT, ct, (nb + 2) * ch.HIT_STEPS)
        dmg = _flat(tables, ch.HIT_DAMAGE, ct, (nb + 2) * ch.HIT_STEPS)
        for n in skel:
            bone = n["bone"]
            steps = ch.hit_steps(tables, ct, bone)
            for i, (slot, code, damage) in enumerate(steps):
                j = bone * ch.HIT_STEPS + i
                if (slot, code, damage) != (eff[j], eff[j + 1], dmg[j]):
                    mismatch += 1
                if code <= CONTROL_MAX:
                    codes.add(code)
                if code == 1:
                    n_sever += 1
                    if not kids.get(bone):
                        n_sever_leaf += 1
                if slot > CONTROL_MAX:
                    n_slots += 1
                    min_slot = min(min_slot, slot)
                    if slot not in slots:
                        unresolved.append(f"type {ct} bone {bone} slot {slot:#x}")
                    if slot in gore:
                        n_sphered += 1

    print(f"  {n_slots} slot references, {n_sever} sever steps")
    print(f"  control codes seen: {sorted(codes)}; lowest slot {min_slot:#x}")
    if codes - {0, 1, 2}:
        fails.append(f"effect table carries small values other than 0/1/2: "
                     f"{sorted(codes - {0, 1, 2})}")
    if min_slot <= 0x100:
        fails.append(f"no gap between control codes and slots "
                     f"(lowest slot {min_slot:#x})")
    print(f"  {n_sphered} of them also carry a damaged-part hit sphere")
    if unresolved:
        fails.append(f"{len(unresolved)} effect slots are not asset slots: "
                     f"{unresolved[:4]}")
    if mismatch:
        fails.append(f"{mismatch} exported steps differ from a raw EXE read")
    # Two hands sever with nothing below them, which is a stump and fine.
    print(f"  sever steps on a childless bone: {n_sever_leaf}")
    if n_sever_leaf > 2:
        fails.append(f"{n_sever_leaf} sever steps have no subtree to remove")

    # 5 ------------------------------------------------------------------
    diff = ch.difficulty_tables(tables)
    checked = 0
    for n in sorted(stagelib.STAGE_TO_SCENE):
        try:
            st = stagelib.Stage(args.game_dir, stage=n)
            places = ch.resolve_for_stage(st)[1]
        except Exception as exc:                        # noqa: BLE001
            print(f"  stage {n}: skipped ({exc})")
            continue
        for p in places:
            for rank in range(5):
                hp = min(diff["hp_max"],
                         max(diff["hp_min"], p.hp + diff["hp_delta"][rank]))
                checked += 1
                if not (diff["hp_min"] <= hp <= diff["hp_max"]):
                    fails.append(f"hp {hp} out of range for spawn {p.at:#x}")
    print(f"  {checked} spawn/difficulty hit-point pairs in "
          f"[{diff['hp_min']}, {diff['hp_max']}]")

    # 6 ------------------------------------------------------------------
    groups = ch.reaction_groups(tables)
    want = [0, 2, 1, 3, 3, 3, 4, 4, 4, 5, 6, 6, 6, 7, 7, 7]
    if groups != want:
        fails.append(f"bone-to-reaction-group map is {groups}, not {want}")
    o = tables._v2r(0x004E07D0)
    play = lambda m: struct.unpack_from("<h", tables.data, o + m * 2)[0]
    dset = ch.death_motions(tables)
    # `right` and `left` are literals in the routine rather than table rows,
    # so they are read off the module: the bundle no longer carries them.
    deaths = (list(dset["front"]) + list(dset["back"])
              + [ch.DEATH_RIGHT, ch.DEATH_LEFT])
    shortest_death = min(play(m) for m in deaths)
    react_motions: set[int] = set()
    n_types = 0
    for ct in types:
        rows = ch.hit_reactions(tables, ct)
        if not rows:
            continue
        n_types += 1
        for variant, row in rows.items():
            if len(row) != ch.REACT_GROUPS or not all(row):
                fails.append(f"type {ct} condition {variant} row is {row}")
                continue
            react_motions.update(row)
    longest_react = max(play(m) for m in react_motions) if react_motions else 0
    print(f"  {n_types} types have a stumble set, {len(react_motions)} distinct "
          f"motions, longest {longest_react} frames vs the shortest death at "
          f"{shortest_death}")
    if longest_react >= shortest_death:
        fails.append(f"a reaction ({longest_react}) is not shorter than the "
                     f"shortest death ({shortest_death})")
    for m in sorted(react_motions):
        if not (1 <= play(m) <= 120):
            fails.append(f"reaction motion {m} has play length {play(m)}")

    # 7 ------------------------------------------------------------------
    ap = ch.approach_tables(tables)
    for i, r in enumerate(ap["rings"]):
        if not (0 < r["inner"] < r["mid"] <= r["outer"]):
            fails.append(f"ring set {i} is not ordered: {r}")
    # The step allowances and the index of the selected curve were checked
    # here and are not any more: they are `.text` immediates, they live in
    # `web/src/game/class30/ring.ts` and `web/src/game/camera/constants.ts`
    # now (docs/formats/bundle.md), and asserting that a tuple typed three
    # lines above is positive was never a check that could fail. **Every**
    # curve is checked instead of the one the exe selects, which is strictly
    # stronger and needs no constant at all.
    tr = ch.camera_tracking(tables)
    for i, c in enumerate(tr["curves"]):
        if len(c) != ch.TURN_RATE_CURVE_LEN:
            fails.append(f"turn-rate curve {i} is {len(c)} entries")
            continue
        if i == 0:
            continue                           # curve 0 is a runtime buffer
        if any(v <= 0 for v in c):
            fails.append(f"turn-rate curve {i} has a non-positive rate: "
                         f"min {min(c)}")
        if any(c[k + 1] > c[k] for k in range(len(c) - 1)):
            fails.append(f"turn-rate curve {i} is not non-increasing")
    print(f"  {len(ap['rings'])} ring sets; "
          f"{len(tr['curves']) - 1} turn-rate curves, all non-increasing, "
          f"{tr['curves'][1][0]} -> {tr['curves'][1][-1]}")

    # 8 ------------------------------------------------------------------
    n_atk = n_pick = 0
    no_attack = []
    unreachable = []
    for ct in types:
        atk = ch.attack_tables(tables, ct)
        picks = ch.attack_picks(tables, ct)
        for cond, row in atk.items():
            for i, e in row.items():
                n_atk += 1
                # **Not** a bound any more -- see `combat.attack_hit_lands`.
                # An entry whose hit frame is at or past its own strike clip
                # can never fire, and three shipped entries are like that on
                # purpose. The bound is replaced by naming that set, below.
                if not ch.attack_hit_lands(e["hit_frame"], play(e["strike"])):
                    unreachable.append((ct, cond, i, e["strike"],
                                        e["hit_frame"], play(e["strike"])))
                if not (0 < play(e["lunge"]) <= 400):
                    fails.append(f"type {ct} cond {cond} attack {i} lunge "
                                 f"{e['lunge']} has length {play(e['lunge'])}")
                if e["cancel_mask"] & ~0x0F:
                    fails.append(f"type {ct} cond {cond} attack {i} cancel "
                                 f"mask {e['cancel_mask']:#x} is out of range")
        n_pick += sum(len(v) for v in picks.values())
        if picks and not atk:
            no_attack.append(ct)
    print(f"  {n_atk} usable attacks, {n_pick} pick entries, "
          f"{len(no_attack)} types with picks but no attack")
    if no_attack:
        fails.append(f"types with a pick table but no usable attack: "
                     f"{no_attack[:6]}")
    # The exact set, because "some entries cannot land" is not a reading and
    # the whole hazard here is a misread row looking like one of these. Every
    # unreachable entry the pick tables name is the crawlers' condition-4
    # swing, three character types sharing one row at `0x00566E70`.
    want_unreachable = sorted((ct, ATTACK_MISS_COND, ATTACK_MISS_INDEX,
                               ATTACK_MISS_CLIP, ATTACK_MISS_HIT_FRAME,
                               ATTACK_MISS_PLAY)
                              for ct in ATTACK_MISS_TYPES if ct in types)
    if sorted(unreachable) != want_unreachable:
        fails.append(f"the entries whose hit frame their own clip never "
                     f"reaches are {sorted(unreachable)}, not "
                     f"{want_unreachable}")
    else:
        print(f"  {len(unreachable)} of them can never fire their hit, and "
              f"they are the crawlers' condition-4 swing -- clip "
              f"{ATTACK_MISS_CLIP} at frame {ATTACK_MISS_HIT_FRAME} of "
              f"{ATTACK_MISS_PLAY}, for types "
              f"{', '.join(hex(c) for c in ATTACK_MISS_TYPES)}")

    # 9 ------------------------------------------------------------------
    n_throw = n_armed = 0
    for ct in types:
        thr = ch.throw_tables(tables, ct)
        if not thr:
            continue
        for cond, hands in thr["hands"].items():
            for h in hands:
                n_throw += 1
                if not (0 <= h["release_frame"] < play(h["motion"])):
                    fails.append(f"type {ct} cond {cond} bone {h['bone']} "
                                 f"releases on frame {h['release_frame']} of a "
                                 f"{play(h['motion'])}-frame clip")
                if h["cancel_mask"] not in (2, 4, 8):
                    fails.append(f"type {ct} bone {h['bone']} cancel mask is "
                                 f"{h['cancel_mask']:#x}")
                elif h["cancel_mask"] == (2 if h["bone"] == 5 else 4):
                    n_armed += 1
                for key in ("held", "bare", "projectile"):
                    v = h[key]
                    if v is not None and v not in slots:
                        fails.append(f"type {ct} bone {h['bone']} {key} slot "
                                     f"{v:#x} is not an asset slot")
    print(f"  {n_throw} thrown-weapon hands, {n_armed} cancelled by the arm "
          f"that throws them")

    # 10 -----------------------------------------------------------------
    import collections
    posed = collections.Counter()
    seen_cls = collections.Counter()
    mesh_hands = 0
    mesh_unresolved: list[str] = []
    for n in sorted(stagelib.STAGE_TO_SCENE):
        try:
            st = stagelib.Stage(args.game_dir, stage=n)
            places = ch.resolve_for_stage(st)[1]
        except Exception:                                   # noqa: BLE001
            continue
        for p in places:
            seen_cls[p.cls] += 1
            if p.motion is not None:
                posed[p.cls] += 1
            if (p.cls in (0x30, 0x18)
                    and p.char_type in ch.ZOMBIE_BONE_MESH_TYPES):
                mesh_hands += 1
                if not p.bone_mesh_coli:
                    mesh_unresolved.append(f"stage {n} {p.at:#x}")
    for cls in sorted(ch.MOTION_RULES):
        if seen_cls[cls] and not posed[cls]:
            fails.append(f"class {cls:#04x} has a motion rule and "
                         f"{seen_cls[cls]} spawns but none is posed")
    print(f"  classes with a motion rule: "
          + ", ".join(f"{c:#04x}={posed[c]}/{seen_cls[c]}"
                      for c in sorted(ch.MOTION_RULES)))

    # 11 -----------------------------------------------------------------
    from hod2lib import mot as motlib
    bank_cache: dict[str, object] = {}

    def implied(mid: int):
        """The bone count *mid*'s own block size implies, or None."""
        bid = tables.motion_bank_of(mid)
        banks = tables.motion_banks()
        if bid not in banks:
            return None
        fname, ids = banks[bid]
        if fname not in bank_cache:
            bank_cache[fname] = motlib.load_bank(args.game_dir, fname, ids)
        bank = bank_cache[fname]
        return bank.implied_bone_count(mid) if bank else None

    n_row = n_foreign = 0
    for ct in types:
        want = tables.character_bone_count(ct) or 0
        rows = ch.motion_row(tables, ct)
        if not rows or not want:
            continue
        for cond, row in rows.items():
            m = row[ch.MOTION_ROW_BACKOFF] if len(row) > ch.MOTION_ROW_BACKOFF \
                else 0
            if not (0 < m < 4096):
                fails.append(f"type {ct} cond {cond} names back-away motion "
                             f"{m}, which is not a motion id")
                continue
            got = implied(m)
            if got is not None and got != want:
                n_foreign += 1
            elif not (1 <= play(m) <= 400):
                fails.append(f"type {ct} cond {cond} back-away motion {m} "
                             f"has play length {play(m)}")
            else:
                n_row += 1
    print(f"  {n_row} back-away clips match their own character's skeleton, "
          f"{n_foreign} name another's and are refused")

    # 12 -----------------------------------------------------------------
    se = tables.se_names()
    combat = ch.combat_tables(tables)
    ids = [s["id"] for s in combat["impact"] + combat["head_impact"]]
    for k in ("hurt", "kill", "head"):
        ids += [s["id"] for s in combat["voice"][k]]
    ids += [s["id"] for s in combat["ricochet"].values()]
    ids += [combat["no_effect"]["sound"]["id"],
            combat["no_effect"]["sound_type2"]["id"]]
    nameless = [f"{i:#x}" for i in ids if i not in se]
    print(f"  {len(ids)} combat sound ids, {len(ids) - len(nameless)} named")
    if nameless:
        fails.append(f"sound ids with no filename: {nameless}")

    # 13 -----------------------------------------------------------------
    # Every motion-row entry the ported states read must be baked *if it
    # belongs to this character's skeleton*. The closing is the clip's own root
    # motion, so a row entry naming a number with nothing behind it leaves the
    # zombie standing still -- which is what shipped once, because the exporter
    # baked rows 0, 1 and the back-away and not the run at 2/3.
    #
    # An entry authored for another skeleton is data, not a gap: `znchain`'s
    # run is `zom.bin` 968, which `_bake` rightly refuses for it. Those are
    # reported, with what it costs them, rather than failed.
    ROW = {0: "walk", 1: "walk alt", 2: "run", 3: "run alt",
           MOTION_ROW_BACKOFF: "back away"}
    gaps: list[str] = []
    foreign: list[str] = []
    immobile: list[str] = []
    checked = 0
    for n in sorted(stagelib.STAGE_TO_SCENE):
        try:
            st = stagelib.Stage(args.game_dir, stage=n)
            chars, places, _ = ch.resolve_for_stage(st)
        except Exception:                                   # noqa: BLE001
            continue
        for ct in sorted({p.char_type for p in places
                          if p.cls == 0x30 and p.motion is not None}):
            c = chars.get(ct)
            if c is None:
                continue
            checked += 1
            row = c.motion_row.get(0) or []
            for i, label in ROW.items():
                if i >= len(row) or not 0 < row[i] < 4096:
                    continue
                if row[i] in c.motions:
                    continue
                if implied(row[i]) == c.bone_count:
                    gaps.append(f"char {ct} ({c.name}) {label} {row[i]}")
                else:
                    foreign.append(f"{c.name}:{label}")
            movers = [row[i] for i in (2, 3, 0, 1)
                      if i < len(row) and row[i] in c.motions
                      and abs(_net_z(c.motions[row[i]])) >= 1.0]
            if not movers:
                immobile.append(f"char {ct} ({c.name})")
    print(f"  motion rows: {checked} class-0x30 types, {len(gaps)} unbaked "
          f"entries of their own skeleton, {len(set(foreign))} authored for "
          f"another, {len(set(immobile))} with nothing that closes")
    for m in sorted(set(immobile)):
        print(f"    never reaches the player: {m}")
    if gaps:
        fails.append(f"motion-row entries the states read but the exporter "
                     f"did not bake: {sorted(set(gaps))[:6]}")

    # 14 -----------------------------------------------------------------
    # Class 0x31's four behaviour sets, and the one structural claim about them
    # that could be wrong: every state id the pick tables name must be one
    # `ThrowerTryEnterState` accepts, and every clip the tables reach must
    # exist. A pick naming a state the gate refuses outright is an actor that
    # can only ever stand still, which is what the port shipped before the
    # tables were read.
    c31 = ch.class31_tables(tables)
    accepted = {7, 8, 9, 0x0C, 0x0D, 0x0E, 0x0F, 0x10, 0x1D, 0x1E, 0x1F, 0x20}
    bad_states, bad_clips, no_attack31 = [], [], []
    n_sets = n_picks = 0
    for row in c31.get("sets", []):
        n_sets += 1
        # Band 0 is unreachable -- `ThrowerPickNextState` starts the band at 2
        # and only ever lowers it to 1 -- so it is reported, not failed.
        for band in ("1", "2"):
            for v in row["state_picks"].get(band, []):
                n_picks += 1
                if v not in accepted:
                    bad_states.append(f"set {row['set']} band {band}: {v}")
        if not row["attacks"]:
            no_attack31.append(row["set"])
        for stance, entries in row["attacks"].items():
            for idx, e in entries.items():
                for st in e["script"]:
                    if not 0 < st["motion"] < 4096:
                        bad_clips.append(f"set {row['set']} {stance}/{idx}")
                if not (-1 <= e["hit_frame"] <= 400):
                    bad_states.append(f"set {row['set']} {stance}/{idx} hit "
                                      f"frame {e['hit_frame']}")
        # Every index the pick table names must have an entry in *some* stance.
        for v in set(row["attack_picks"]):
            if not any(str(v) in st for st in row["attacks"].values()):
                no_attack31.append(f"set {row['set']} pick {v}")
    print(f"  class 0x31: {n_sets} behaviour sets, {n_picks} action picks, "
          f"{len(c31.get('scripts', {}))} named arc scripts, "
          f"{len(ch.class31_motion_ids(c31))} distinct clips")
    if bad_states:
        fails.append(f"class-0x31 picks name states the gate refuses: "
                     f"{sorted(set(bad_states))[:6]}")
    if bad_clips:
        fails.append(f"class-0x31 arc scripts with no motion: {bad_clips[:6]}")
    if no_attack31:
        print(f"    attack indices with no entry: {sorted(set(map(str, no_attack31)))}")

    # 15 -----------------------------------------------------------------
    # `ActorPlayHitVoice` kinds 1 and 2 carry the SAME voice pair.
    #
    # This is load-bearing rather than trivia. `ZombieOnShot` (`FUN_00453EB0`)
    # and `ThrowerOnShot` (`FUN_004499A0`) choose between those two kinds on
    # `g_hit_result == 2` and on nothing else -- no test of the bone, and none
    # of whether the actor died of this shot. `combat.md` said `bone == 2` for
    # a long time and the browser player's shot path was written from it; the
    # reason that correction is nearly inaudible is exactly this equality, so
    # it wants a check and not a sentence. Both pairs come out of
    # `g_hit_voice_table` (0x00577674), five dwords apart.
    kill_ids = [s["id"] for s in combat["voice"]["kill"]]
    head_ids = [s["id"] for s in combat["voice"]["head"]]
    if kill_ids != head_ids:
        fails.append(f"kinds 1 and 2 read different voice pairs: "
                     f"{[hex(i) for i in kill_ids]} vs "
                     f"{[hex(i) for i in head_ids]}")
    # ...and the *impact* tables are what differ: five body, two head, and no
    # id in common between them. That is the whole of what a player hears
    # change between the two kinds.
    body = {s["id"] for s in combat["impact"]}
    headi = {s["id"] for s in combat["head_impact"]}
    if len(body) != 5 or len(headi) != 2 or (body & headi):
        fails.append(f"the two impact tables are not 5 body and 2 head, "
                     f"disjoint: {len(body)}/{len(headi)}, "
                     f"shared {[hex(i) for i in body & headi]}")
    # Kind 3's entry is a PAIR PER SET where every other kind is one id per
    # set, which is the shape the routine's `rand() & 1` inside the set needs.
    atk = combat["voice"].get("attack")
    if not atk or len(atk) != 2 or any(len(pair) != 2 for pair in atk):
        fails.append(f"kind 3 is not two pairs: {atk!r}")
    print(f"  kinds 1 and 2 share one voice pair "
          f"({[hex(i) for i in kill_ids]}); their impacts are "
          f"{len(body)} body and {len(headi)} head, disjoint; kind 3 is "
          f"{len(atk or [])} pairs of {len((atk or [[]])[0])}")

    # 16 -----------------------------------------------------------------
    # Every arc script's starts and thresholds inside its own clips' play
    # lengths. `ActorArcStep` compares them to a cursor that wraps at
    # `g_motion_play_length + 1`, so one past it never comes.
    arcs: list[tuple[str, list[dict]]] = [
        (f"named {k}", v) for k, v in c31.get("scripts", {}).items() if v]
    for row in c31.get("sets", []):
        for stance, entries in row["attacks"].items():
            for idx, e in entries.items():
                arcs.append((f"set {row['set']} {stance}/{idx}", e["script"]))
    for k, a in CLASS30_ARC_SCRIPTS.items():
        sc = arc_script(tables, a)
        if sc is None:
            fails.append(f"class-0x30 arc script {k} does not resolve")
        else:
            arcs.append((f"class 0x30 {k}", sc))
    past, switches = [], 0
    for name, sc in arcs:
        if len(sc) != 3:
            past.append(f"{name}: {len(sc)} stages")
            continue
        switches += sum(1 for a, b in zip(sc, sc[1:])
                        if a["motion"] != b["motion"])
        for i, st in enumerate(sc):
            play = tables.motion_play_length(st["motion"])
            if play is None or not (0 <= st["start"] <= play
                                    and st["until"] <= play):
                past.append(f"{name} stage {i}: motion {st['motion']} "
                            f"start {st['start']} until {st['until']} "
                            f"play {play}")
    print(f"  arc scripts: {len(arcs)}, every start and threshold inside its "
          f"own clip's play length; {switches} stage changes switch clips")
    if switches != 7:
        fails.append(f"expected seven arc-script stage changes to switch "
                     f"clips, counted {switches}")
    # zslman's four leap-aside scripts are the ones `ThrowerStateLeapAside`'s
    # own `MOV ESI, imm32` name -- read out of `.text`, not out of the
    # exporter's table -- and the exported four are the twelve dwords there.
    named = []
    for row, imm in enumerate(CLASS31_ASIDE_ZSLMAN_IMM):
        o = tables._v2r(imm - 1)
        op, addr = struct.unpack_from("<BI", tables.data, o)
        named.append(addr)
        want = CLASS31_ARC_SCRIPTS["aside_zslman"] \
            + row * CLASS31_ASIDE_ZSLMAN_STRIDE
        if op != 0xBE or addr != want:
            fails.append(f"ThrowerStateLeapAside row {row}: {op:#x} "
                         f"{addr:#010x}, the exporter reads {want:#010x}")
        got = c31.get("scripts", {}).get(f"aside_zslman_{row}")
        if got != arc_script(tables, addr):
            fails.append(f"aside_zslman_{row} is not the script at "
                         f"{addr:#010x}")
    print(f"  zslman's leap-aside scripts are the four the state names: "
          f"{', '.join(f'{a:#010x}' for a in named)}")
    if len(arcs) != 41:
        fails.append(f"expected the 41 arc scripts classes 0x30 and 0x31 can "
                     f"install, read {len(arcs)}")
    if past:
        fails.append(f"arc-script stages past their clip's play length: "
                     f"{past[:6]}")

    # 17 -----------------------------------------------------------------
    _check_bone_spheres(tables, types, fails)
    print(f"  {mesh_hands} class-0x30/0x18 spawns of types 2, 3 and 0xE, "
          f"{mesh_hands - len(mesh_unresolved)} naming a collision blob")
    if not mesh_hands or mesh_unresolved:
        fails.append(f"mesh-hand spawns with no blob at tail+0x10: "
                     f"{mesh_unresolved[:6]} (of {mesh_hands})")

    if fails:
        print("\nFAIL")
        for f in fails:
            print("  " + f)
        return 1
    print("\nclean")
    return 0


#: Every (type, bone) row `SkeletonWalkNode` refuses although it carries a
#: radius, over every character type with a skeleton -- by type, the bones.
#: Held here, whole, so that `ActorBuildSkinnedModel`'s note in
#: `web/src/game/spawn.ts` can point at a list a check derives from the exe
#: rather than quote one. Most are types whose table pointer is a stub that
#: ends in -1 after a row or two, read on past it; `zsass`'s two hands (0x16)
#: are the real rows that name the armed model where the node names the bare.
GATED = {
    0x03: [5, 8], 0x15: [6, 9, 13, 16], 0x16: [5, 8], 0x1A: [3, 11],
    0x1B: [9, 10, 11, 12, 13, 14], 0x1C: list(range(5, 15)), 0x1F: [3],
    0x21: [2], 0x39: [2, 5], 0x3A: [2, 5], 0x3B: [5], 0x3C: [5], 0x3E: [9],
    0x3F: list(range(7, 16)), 0x40: list(range(5, 16)), 0x41: [6, 9],
    0x42: [3, 4], 0x43: [3, 13], 0x46: [3], 0x4E: [3],
    0x53: list(range(4, 19)), 0x54: list(range(3, 20)),
    0x55: list(range(2, 16)),
}
GATED_ROWS = {(ct, b) for ct, bones in GATED.items() for b in bones}


def _code(tables, va: int, n: int) -> bytes:
    o = tables._v2r(va)
    return bytes(tables.data[o:o + n])


def _raw_rows(tables, ct: int):
    """`g_character_part_tables[ct]` read raw, as ``(slot, r, cx, cy, cz)``
    per row from row 0, and the index of the first ``-1`` past the bones or
    None when the image ends first."""
    b = tables._v2r(ch.HIT_SPHERES)
    p = tables._v2r(struct.unpack_from("<I", tables.data, b + ct * 4)[0])
    n = tables.character_bone_count(ct)
    rows, i, end = [], 0, None
    while p + (i + 1) * 0x14 <= len(tables.data):
        slot, cx, cy, cz, r = struct.unpack_from("<i4f", tables.data,
                                                 p + i * 0x14)
        rows.append((slot, r, cx, cy, cz))
        if i >= n - 1 and slot == -1:
            end = i
            break
        i += 1
    return rows, end


def _check_bone_spheres(tables, types: list[int], fails: list[str]) -> None:
    # The gate, and the build's multiply, as the instruction stream has them:
    # MOV EDX,[EAX-0x14]; CMP EDX,[EDI]; JNZ +0x3F; FLD [ECX+0x1300];
    # FMUL [EAX-4]; FSTP [ESI+0x78].
    want = bytes.fromhex("8b50ec3b17753f" "d98100130000" "d848fc" "d95e78")
    if _code(tables, 0x00410830, len(want)) != want:
        fails.append("SkeletonWalkNode's slot gate is not at 0x00410830")
    gated = set()
    for ct in types:
        rows, _ = _raw_rows(tables, ct)
        for node in tables.character_skeleton(ct):
            b = node["bone"]
            if 1 <= b <= len(rows):
                slot, r = rows[b - 1][0], rows[b - 1][1]
                if r > 0 and (slot & 0xFFFFFFFF) != node["slot"]:
                    gated.add((ct, b))
    print(f"  {len(gated)} rows with a radius the build refuses, in "
          f"{len({ct for ct, _ in gated})} of {len(types)} character types")
    if gated != GATED_ROWS:
        fails.append(f"the gated rows are not the documented ones: extra "
                     f"{sorted(gated - GATED_ROWS)}, missing "
                     f"{sorted(GATED_ROWS - gated)}")

    # The two restore states: which table, which rows, and whose slots.
    tbl16 = ch.HIT_SPHERES + 0x16 * 4
    reads = {
        # ThrowerStateRearm: MOV ECX,[tbl16]; MOV EDX,[ECX+0x60] and
        # MOV EAX,[tbl16] ... MOV ECX,[EAX+0x9c].
        0x0044F822: b"\x8b\x0d" + struct.pack("<I", tbl16) + b"\x8b\x51\x60",
        0x0044F880: b"\xa1" + struct.pack("<I", tbl16)
                    + b"\x8b\x88\x9c\x00\x00\x00",
        # ThrowerStateRestoreBothHands: MOV ECX,[EAX*4 + table]; +0x60 / +0x9c.
        0x0044F9E6: b"\x8b\x0c\x85" + struct.pack("<I", ch.HIT_SPHERES)
                    + b"\x8b\x51\x60",
        0x0044FA4E: b"\x8b\x0c\x85" + struct.pack("<I", ch.HIT_SPHERES)
                    + b"\x8b\x91\x9c\x00\x00\x00",
    }
    for va, w in reads.items():
        if _code(tables, va, len(w)) != w:
            fails.append(f"the restore read at {va:#010x} is not "
                         f"{w.hex()}")
    if (4 * 0x14 + 0x10, 7 * 0x14 + 0x10) != (0x60, 0x9C):
        fails.append("rows 4 and 7's radii are not at +0x60 and +0x9C")
    # EnemyThrowerInit's armed hands, as immediates: MOV [ESI+0x4DC], imm32
    # and MOV [ESI+0x68C], imm32.
    arm5 = _code(tables, 0x00449877, 10)
    arm8 = _code(tables, 0x00449881, 10)
    rows16, _ = _raw_rows(tables, 0x16)
    if (arm5[:6] != bytes.fromhex("c786dc040000")
            or arm8[:6] != bytes.fromhex("c7868c060000")):
        fails.append("EnemyThrowerInit's two hand writes are not at "
                     "0x00449877 / 0x00449881")
    else:
        imm5 = struct.unpack_from("<I", arm5, 6)[0]
        imm8 = struct.unpack_from("<I", arm8, 6)[0]
        print(f"  zsass: EnemyThrowerInit arms {imm5:#x}/{imm8:#x}; rows 4 "
              f"and 7 name {rows16[4][0]:#x}/{rows16[7][0]:#x}, radii "
              f"{rows16[4][1]:g}/{rows16[7][1]:g}")
        if (rows16[4][0], rows16[7][0]) != (imm5, imm8):
            fails.append("type 0x16's rows 4 and 7 are not the hands "
                         "EnemyThrowerInit arms")

    # The damaged-part tails: terminated, agreeing, and exported as a raw
    # first match reads them.
    fallback = {ct: (0xB if ct == 0xD else 7) for ct in types}
    unterminated, disagree, misread, both = [], [], [], 0
    for ct in types:
        named = {st[0] for node in tables.character_skeleton(ct)
                 for st in ch.hit_steps(tables, ct, node["bone"])
                 if st[0] > 1}
        if not named:
            continue
        n = tables.character_bone_count(ct)
        rows, end = _raw_rows(tables, ct)
        if end is None:
            unterminated.append(f"{ct:#x}")
            continue
        own = {}
        for row in rows[n - 1:end]:
            own.setdefault(row[0], row)
        frows, fend = _raw_rows(tables, fallback[ct])
        fb = {}
        for row in frows[tables.character_bone_count(fallback[ct]) - 1:fend]:
            fb.setdefault(row[0], row)
        for s in named:
            if s in own and s in fb:
                both += 1
                if own[s][1:] != fb[s][1:]:
                    disagree.append(f"{ct:#x} slot {s:#x}")
        exported = ch.part_sphere_rows(tables, ct, named)
        first = {}
        for e in exported:
            first.setdefault(e["slot"], e)
        for s in named:
            got = first.get(s)
            raw = own.get(s)
            if (got is None) != (raw is None) or (
                    got is not None and (got["radius"], *got["centre"])
                    != raw[1:]):
                misread.append(f"{ct:#x} slot {s:#x}")
    print(f"  damaged-part tails end in -1 for every type that searches "
          f"one; {both} slots found by both searches, all agreeing")
    if unterminated:
        fails.append(f"damaged-part tails with no -1: {unterminated}")
    if disagree:
        fails.append(f"own and fallback rows disagree: {disagree[:6]}")
    if misread:
        fails.append(f"part_sphere_rows is not a raw first match: "
                     f"{misread[:6]}")


def _net_z(m: dict) -> float:
    """Root translation on z over the whole clip."""
    r, n = m["root"], m["frames"]
    return 0.0 if n < 2 else r[(n - 1) * 3 + 2] - r[2]


if __name__ == "__main__":
    raise SystemExit(main())
