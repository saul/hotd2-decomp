# HOTD2 — plan to a complete decomp

The original eight-phase plan is finished and has moved to
[`re/PLAN-phases-0-8.md`](re/PLAN-phases-0-8.md); `PROGRESS.md` still tracks it.
This file replaces it, because the questions changed: the formats are solved,
and what is left is **behaviour** — the code that decides what appears, where,
and when.

## Where this actually stands

Measured, not estimated:

| | |
|---|---|
| Asset formats | **8 of 8 solved** — `lz`, container, `nl1`, `texbank`, `cam`, `evt`, `coli`, `mot`. No directory in the game is unread. |
| Ghidra database | 2,523 functions; **202 named + 145 globals** committed in `ghidra/annotations`, replayable with `./ghidra/run.sh rebuild` |
| Spawn classes | 35 used; **12 have a character-type rule**; 658 of 1,225 spawns unidentified |
| Character types | **85 resolved** to a named asset file |
| Motions | 1,058 across 49 banks, all structurally verified |
| Object rigs | **12 of 31** `CamEvalObjectPath6` callers transcribed |
| Player | **W1–W5 shipped** — camera, script walking, play mode, audio, fog, minimap |
| Verifiers | 10, all passing |

## What "complete" means — three different bars

Worth separating, because they need different work and the project keeps
conflating them.

**1. Format-complete** — every byte of every shipped asset file is accounted
for. *Nearly there.* The gaps are the `evt/` behaviour tails and a handful of
enumerations (`coli` surface ids, one BGM global).

**2. Player-complete** — enough understood to reproduce a playthrough
visually. *The nearest useful milestone, and the one to aim at.* Needs spawn
identification and character assembly, both now unblocked.

**3. Behaviour-complete** — every code path that decides what happens is read.
*Far, and possibly not worth finishing.* The zombie alone has 54 states; class
`0x41` has 79 constructors. Much of it is per-instance combat detail a player
does not need. **Recommend explicitly descoping this** rather than leaving it
as an open-ended obligation.

The rest of this plan is ordered by what unblocks the player.

---

## P1 — Identify the remaining spawns

**658 of 1,225 spawns have no identity.** This is the single biggest gap and
the one the player feels most, because an unidentified spawn is an empty node.

The work splits by *how* a class names its geometry, and the split matters —
treating it as one job is why it looks bigger than it is:

| Group | Classes | Spawns | Work |
|---|---|---|---|
| **Placers** — the class is a stub that builds a child and `ActorKill`s itself | `0x41` (316), `0x44` (123) | **439** | Read the child entry functions, not the class. `0x41` dispatches 79 constructors at `g_class41_constructors`; `0x44` dispatches 18 at `g_class44_subtypes`. The geometry is in the child's `+0x28C`. |
| **Unread handlers** | `0x20` (36), `0x45` (25), `0x46` (27) | **88** | Never reached by the class survey. `0x20` calls the HP scaler, so it is a combat actor. |
| **Known but unruled** | `0x51`, `0x33`, `0x13`, `0x43`, `0x52`, `0x26`, `0x40`, `0x12`, `0x29`, `0x2A`, `0x2B`, `0x42`, `0x15`–`0x17`, `0x21`, `0x27`, `0x28` | **131** | Handlers already read; each needs its character type or asset slot expressed as a rule in `spawnres.CHAR_TYPE_RULES`. Cheapest work here by far. |

**Do them in reverse order of cost**: the 131 first (rules for handlers already
understood), then the 88, then the 439.

**Definition of done:** every used class either has a rule or a recorded reason
it cannot have one. Not "every spawn identified" — some genuinely resolve at
runtime.

## P2 — Wire characters into the player

Unblocked by the `mot/` decomp. `tools/export_character.py` already assembles
and poses a character through the rig writer; the integration is described in
[`PLAYER_PLAN.md`](PLAYER_PLAN.md#characters-and-spawns-in-the-player).

1. **Static poses first.** Swap `_spawn_nodes`' marker for the real hierarchy at
   frame 0 of an idle motion. One file, and it puts zombies, civilians and the
   cat in the level.
2. **Pick the idle motion per class.** Needs a small amount of P4 work — the
   motion id a class starts with, not its whole state machine.
3. **Animation only if wanted**, and never by baking every motion:
   `people.bin` alone is 200 motions over 7,105 frames. Ship the bank as a
   sidecar and sample it client-side; the format is nine lines.

**Watch for:** the bind pose is not a rest pose. Zero rotations collapse a
character. Anything that renders unposed is wrong, not merely ugly.

## P3 — Finish the rigs

**19 of 31** `CamEvalObjectPath6` callers are still untranscribed, and
[`re/rig-survey.md`](re/rig-survey.md) already names the next four:
`SUB_004331D0` (9 slots), `0x00452320`'s siblings, `0x00432840`, and the
`0x00440130` family.

The survey also records the trap that cost a session: **the 9-vs-22 split by
"does it call `AssetDrawSlot`" finds rigs but does not define them.** The
stage-2 car's poser never draws. Follow the poser to its `obj[0]`.

## P4 — Behaviour, scoped deliberately

Do **only** what the player needs, and write down that the rest is descoped:

* **In scope:** which motion a class starts in; how a class despawns; which
  camera path gates it. These decide what is on screen.
* **Out of scope, explicitly:** the zombie's 54 combat states, the 79 class-`0x41`
  constructors beyond their asset, per-instance AI, damage tuning.

The ten shared behaviour functions at `g_prop_behaviours` (`0x005926A8`) are the
best-value target — three of them play sounds, and they serve classes `0x12`,
`0x13` and `0x15` together.

## P5 — Close the small format gaps

Cheap, and they are what stands between "solved" and "format-complete":

* **`evt/` behaviour tails** — ~21% of bytes. Per-class, and P1 does most of it
  as a side effect.
* **`coli` surface ids** — a material palette; only 5 and 55 (wet) are known.
* **BGM selection** — `0x009C8E98` picks plain vs `_AR` tracks; meaning open.
  It is also read by `EvtInterpreterLoop`, so it is not audio-only.
* **Camera path selection** — how a `cam/` path is chosen has never been
  traced (`pipeline.md`). The player currently follows the script's own
  choices, so this is not blocking, but it is a real hole.
* **`g_motion_play_length`** — about twice the frame count; exact relation open.
  Only matters if playback is driven from the scripts rather than the header.

## P6 — Make the decomp reproducible end to end

The annotation pipeline exists; these finish the job:

* **Golden-file regression suite in `tests/`** — long-outstanding. Every
  verifier is a consistency check; none pins *output* against a known-good
  copy. The next silent exporter regression will not be caught.
* **Re-export annotations after every interactive session.** The habit, not
  the tooling, is the risk: `./ghidra/run.sh export-annotations` then
  `git diff`. MCP renames leave no trail.
* **`src/` reference implementations** — `lz.c` and friends, deferred since
  Phase 7. Worth it only as documentation; the Python is the real reference.

---

## Ordering

```
P1 (rules for read handlers)  ──► P2 (characters in the player)
        │                              │
        ├──► P1 (unread handlers)      └──► P4 (idle motions)
        │
        └──► P1 (placers) ──► P3 (rigs)

P5, P6 in parallel — neither blocks the player
```

**If only one thing gets done:** P1's cheap third — rules for the handlers
already read. It is a day's work, it needs no new decompilation, and it moves
131 spawns from empty nodes to identified characters.

## What would make this "done"

A defensible claim of completeness needs, in order:

1. Every used spawn class has a rule or a recorded reason it cannot.
2. Every `CamEvalObjectPath6` caller is transcribed or explicitly dismissed.
3. The player renders a recognisable playthrough of all six stages.
4. `tests/` pins exporter output so regressions surface.
5. The remaining `[open]` markers are each either closed or reclassified as
   *deliberately out of scope* — currently 28 across the docs, and some of them
   are questions nobody needs answered.

Point 5 matters most for honesty. "Complete" should mean *every question is
either answered or consciously abandoned*, not *no questions remain*.
