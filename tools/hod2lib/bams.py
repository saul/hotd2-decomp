"""Binary angles, and the rotation matrices they build.

The engine keeps every orientation as a **BAMS** -- a 16-bit angle where
0x10000 is a full turn -- and `FUN_00410590` feeds a spawn's three of them to
``RotX; RotY; RotZ`` in that order. Anything that has to hand a composed
orientation to glTF, which wants one rotation and not three, comes through
here.

Split out of `characters` because `props` needs the same three functions and
was reaching into the character assembler for them.
"""

from __future__ import annotations

import math


_BAMS = math.tau / 65536.0


def rot_matrix(bams) -> list[list[float]]:
    """``Rz(rz) @ Ry(ry) @ Rx(rx)`` -- the engine's order, as a 3x3."""
    ax, ay, az = (v * _BAMS for v in bams)
    ca, sa = math.cos(ax), math.sin(ax)
    cb, sb = math.cos(ay), math.sin(ay)
    cc, sc = math.cos(az), math.sin(az)
    return [
        [cc * cb, cc * sb * sa - sc * ca, cc * sb * ca + sc * sa],
        [sc * cb, sc * sb * sa + cc * ca, sc * sb * ca - cc * sa],
        [-sb,     cb * sa,                cb * ca],
    ]


def bams_from_matrix(M) -> tuple[int, int, int]:
    """Inverse of :func:`_rot`: a 3x3 back to a BAMS ``(rx, ry, rz)`` triple."""
    sb = max(-1.0, min(1.0, -M[2][0]))
    ay = math.asin(sb)
    if abs(M[2][0]) < 0.999999:
        ax = math.atan2(M[2][1], M[2][2])
        az = math.atan2(M[1][0], M[0][0])
    else:                                   # gimbal lock: fold into rx
        ax = math.atan2(-M[1][2], M[1][1])
        az = 0.0
    return tuple(int(round(v / _BAMS)) & 0xFFFF for v in (ax, ay, az))


def compose_bams(outer, inner) -> tuple[int, int, int]:
    """The BAMS triple equivalent to applying *outer* then *inner*."""
    A, B = rot_matrix(outer), rot_matrix(inner)
    return bams_from_matrix([[sum(A[i][k] * B[k][j] for k in range(3))
                      for j in range(3)] for i in range(3)])
