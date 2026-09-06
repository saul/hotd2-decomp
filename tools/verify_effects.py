#!/usr/bin/env python3
"""Check the effect system's three tables against each other and the discs.

An "effect" is a small rigged object animated by an ordinary motion, and three
contiguous tables in the EXE describe all 29 of them: `g_effect_trees`
(0x004D5390), `g_effect_bone_counts` (0x004D5404) and `g_effect_interp_mode`
(0x004D5440). `EffectDrawNode` (`FUN_0040DE50`) walks the tree;
`EffectFrameTranslations` (`FUN_0040E040`) and `EffectFrameRotations`
(`FUN_0040E070`) both derive the motion's stride from the **node count**,
as ``(n * 0x12 - 0xF) & ~3`` -- truncating, not rounding up.

Three things are asserted, and each of them can fail:

* **every tree's node count equals its `g_effect_bone_counts` entry.** The two
  are independent -- one is a pointer walk, the other a flat `s16` -- so
  agreeing on all 29 is a real test of the node struct
  ``{u32 slot; s16 bone; u16 children; u32 child[]}``. It is also not a
  formality: the first draft of the walk capped a node's children at 0x40 and
  returned 65 of effect 8's 145 nodes, and this is the check that said so.
* **every bone index is used exactly once**, 0 for the root and 1..n-1 below
  it, which is what makes ``frame.t[bone - 1]`` a total function.
* **every asset slot a node names resolves to a file**, and every motion the
  effect system plays divides exactly by the stride its effect's node count
  implies. A wrong stride almost never divides.

The motions come from the two consumers, not from a scan: `g_prop_kind_params`
pairs an effect with a motion for each class-0x41 type-4 kind, and
`PropBuildScriptFlagEffect` (`FUN_00472B30`) pairs effects 2 and 3 with the
literal motion 471.
"""
from __future__ import annotations

import argparse
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from hod2lib import mot as motlib, props as propslib  # noqa: E402
from hod2lib import stage as stagelib                 # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--game-dir", type=Path,
                    default=Path.home() / "THE HOUSE OF THE DEAD 2")
    args = ap.parse_args()
    t = stagelib.get_tables(args.game_dir)

    n_eff = propslib.EFFECT_COUNT
    rc = t._v2r(propslib.EFFECT_BONE_COUNTS)
    ri = t._v2r(propslib.EFFECT_INTERP_MODE)
    if rc is None or ri is None:
        print("the effect tables are not in this binary")
        return 1
    declared = struct.unpack_from(f"<{n_eff}h", t.data, rc)
    interp = struct.unpack_from(f"<{n_eff}B", t.data, ri)
    slots = t.asset_slots()

    problems: list[str] = []
    trees = 0
    nodes_total = 0
    drawing = 0
    for e in range(n_eff):
        tree = propslib.effect_tree(t, e)
        if not tree:
            problems.append(f"effect {e}: g_effect_trees has no tree")
            continue
        trees += 1
        nodes_total += len(tree)
        if len(tree) != declared[e]:
            problems.append(
                f"effect {e}: the tree walks {len(tree)} nodes against "
                f"g_effect_bone_counts {declared[e]}")
        bones = sorted(n.bone for n in tree)
        if bones != list(range(len(tree))):
            problems.append(
                f"effect {e}: bone indices {bones[:6]}... are not 0..{len(tree) - 1}")
        if tree[0].bone != 0 or tree[0].slot != 0:
            problems.append(
                f"effect {e}: the root draws slot {tree[0].slot:#06x} at bone "
                f"{tree[0].bone}; EffectDrawNode skips bone < 1")
        for n in tree:
            if not n.slot:
                continue
            drawing += 1
            if n.slot not in slots:
                problems.append(
                    f"effect {e}: node slot {n.slot:#06x} is in no pol file")
        if interp[e] > 2:
            problems.append(
                f"effect {e}: g_effect_interp_mode is {interp[e]}; "
                f"EffectPoseNode has three arms")

    # (effect, motion) as the two consumers pair them.
    pairs: set[tuple[int, int]] = set()
    for row in t.prop_kind_params():
        if row["effect"] >= 0 and row["effect_variant"] > 0:
            pairs.add((row["effect"], row["effect_variant"]))
    for eff in (propslib.SCRIPT_FLAG_EFFECT_A[0], propslib.SCRIPT_FLAG_EFFECT_B[0]):
        pairs.add((eff, propslib.SCRIPT_FLAG_EFFECT_MOTION))

    banks = t.motion_banks()
    checked = 0
    for eff, motion in sorted(pairs):
        if not 0 <= eff < n_eff:
            problems.append(f"effect {eff} (motion {motion}) is out of range")
            continue
        bank_id = t.motion_bank_of(motion)
        if bank_id not in banks:
            problems.append(f"motion {motion} names bank {bank_id}, "
                            f"which is not a motion bank")
            continue
        name, ids = banks[bank_id]
        if not (args.game_dir / "mot" / name).is_file():
            continue
        bank = motlib.load_bank(args.game_dir, name, ids)
        if bank is None or motion not in bank.offsets:
            problems.append(f"motion {motion} is not in {name}")
            continue
        stride = motlib.effect_frame_stride(declared[eff])
        base = bank.offsets[motion]
        later = [o for o in bank.offsets.values() if o > base]
        span = (min(later) if later else bank.size) - base - 4
        frames = bank.frame_count(motion)
        checked += 1
        if stride <= 0 or frames <= 0 or span % stride or span // stride != frames:
            problems.append(
                f"effect {eff} motion {motion} in {name}: {frames} frames "
                f"declared, {span} bytes of block, stride {stride} from "
                f"{declared[eff]} nodes -> {span / stride if stride else 0:.2f} "
                f"frames")

    print(f"{trees} of {n_eff} effect trees walk, {nodes_total} nodes, "
          f"{drawing} of them drawing a slot")
    print(f"node counts against g_effect_bone_counts: "
          f"{trees - len([p for p in problems if 'walks' in p])}/{trees}")
    print(f"(effect, motion) pairs whose block divides exactly by the effect "
          f"stride: {checked - len([p for p in problems if 'frames' in p])}"
          f"/{checked}")
    print()
    if problems:
        for p in problems[:20]:
            print("  " + p)
        if len(problems) > 20:
            print(f"  ... and {len(problems) - 20} more")
        print(f"\n{len(problems)} problems")
        return 1
    print("clean")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
