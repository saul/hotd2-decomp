"""The rings an enemy advances through, and the camera that watches it.

One subject, not two: `TestApproachRing` and `ZombieStateApproach` measure the
actor's distance **to the camera** and read the same three radii, and
`RegisterForCameraTracking` sorts the same actors by the same distance so
`SelectCameraLookAtTarget` can pick one and `TurnLookAtToward` ease onto it.
docs/formats/combat.md sections 9 and 10.

Only :data:`APPROACH_RING_DEFAULTS` and :data:`TURN_RATE_CURVES` are `.rdata`
and travel in the bundle. The rest of this module is `.text` immediates, and
they live in `web/src/game/camera/` now -- see `docs/formats/bundle.md`.
"""

from __future__ import annotations

import struct


#: `DAT_004C4CD0`: four ``{inner, mid, outer}`` f32 ring sets, copied into
#: `g_enemy_approach_rings` by the scene reset (`FUN_0045EEC0`). No stage script
#: uses evt `0x0E`, the opcode that would override them, so these constants are
#: what every encounter in the game actually runs on.
APPROACH_RING_DEFAULTS = 0x004C4CD0

APPROACH_RING_SETS = 4

#: `EnemyZombieInit`: character type 0 uses ring set 2, everything else set 0.
RING_SET_FOR_CHAR0 = 2

#: `PTR_DAT_00576C04`: four 64-byte turn-rate curves, indexed by the angle
#: between where the camera looks and where it wants to look, clamped to
#: :data:`TURN_ERROR_CLAMP` and shifted right 7. The scene reset picks curve
#: **1**. A larger value is a *slower* turn: `TurnLookAtToward` steps
#: ``1 / (1 + rate)`` of the remaining angle.
TURN_RATE_CURVES = 0x00576C04

TURN_RATE_CURVE_COUNT = 4

TURN_RATE_CURVE_LEN = 64


def approach_tables(tables) -> dict:
    """The advance rings and the step counts, with their defaults.

    `TestApproachRing` and `ZombieStateApproach` both measure the actor's
    distance **to the camera** and read the same three radii, so one table
    serves the walk-in and the attack run.
    """
    o = tables._v2r(APPROACH_RING_DEFAULTS)
    sets = []
    for i in range(APPROACH_RING_SETS):
        inner, mid, outer = struct.unpack_from("<3f", tables.data, o + i * 12)
        sets.append({"inner": inner, "mid": mid, "outer": outer})
    # Only the radii travel. :data:`APPROACH_STEP_DEFAULTS` and
    # :data:`RING_SET_FOR_CHAR0` are immediates in `.text`, so they belong in
    # `web/src/game/class30/ring.ts` -- see `docs/formats/bundle.md`.
    # `RING_SET_FOR_CHAR0` is still read in this package, to resolve each
    # placement's `ring_set`; it is the scalar copy that stopped being
    # exported beside a value the client had no way to check it against.
    return {"rings": sets}


def camera_tracking(tables) -> dict:
    """What the gameplay camera aims at, and how fast it turns.

    Three routines, all in docs/formats/combat.md §10: enemies register
    themselves nearest-first, `SelectCameraLookAtTarget` picks a point from the
    slot table, and `TurnLookAtToward` eases the camera onto it.
    """
    b = tables._v2r(TURN_RATE_CURVES)
    curves = []
    for i in range(TURN_RATE_CURVE_COUNT):
        ptr = struct.unpack_from("<I", tables.data, b + i * 4)[0]
        o = tables._v2r(ptr)
        curves.append(list(struct.unpack_from(f"<{TURN_RATE_CURVE_LEN}b",
                                              tables.data, o))
                      if o is not None else [])
    # The curves are the only `.rdata` here. Every other constant in this
    # module is an immediate compiled into one of those three routines, and
    # they live in `web/src/game/camera/constants.ts` now. They stay declared
    # here because they are what the citations above are about, and because
    # `verify_combat.py` re-derives the curve shape from them.
    return {"curves": curves}
