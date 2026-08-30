"""`mot/` — skeletal animation.

Read out of the loader, not out of the files. The chain is:

* `FUN_00412C10` (motion job kind 8, sub-step 0) builds the path with the
  format string ``"mot\\%s"`` and the bank name from ``DAT_004D1B00[bank]``,
  then `CreateFileA` / `GetFileSize` and allocates ``size + 0x20``.
* `FUN_00412D40` (sub-step 1) `ReadFile`s the whole thing in one go. **There is
  no decompression** — unlike `pol/`, a `mot/` file is raw on disk.
* `FUN_00412D90` (sub-step 2) is the entire parse::

      p = buf;
      for each motion id m in bank:              // DAT_004E2B14[bank]
          g_motion_slot[m].base  = *p++ + buf;   // DAT_009A37E0 + m*8
          g_motion_slot[m].state = 2;            // DAT_009A37E4 + m*8

  So the file begins with one **int32 offset per motion in the bank**, in the
  bank's own id order, each relative to the file start.

* `FUN_00412F50(char_type, motion_id, frame)` is the sampler::

      return ((bone_count[char_type] * 6 + 15) & ~3) * frame
             + 4 + g_motion_slot[motion_id].base;

  — frames start 4 bytes into a motion block, and the stride is derived from
  the **character type**, not from the file. The same motion data read against
  a different skeleton would be read with a different stride, so a motion is
  only meaningful with the character it was authored for.

* `FUN_00410590` reads the frame as ``{f32 x, y, z}`` then a `short*` at +0x0C,
  and `FUN_004107E0` reads bone *i*'s triple at ``+0x0C + i*6``, applying
  ``RotZ(rz); RotY(ry); RotX(rx)`` — the same order as every other transform in
  this engine.

Putting those together, a frame record is::

    +0x00  f32 root translation x
    +0x04  f32 root translation y
    +0x08  f32 root translation z
    +0x0C  s16 bone[0].rx, .ry, .rz      <- applied at the object root
    +0x12  s16 bone[1].rx, .ry, .rz      <- bone index from the skeleton node
    ...                                     table, `ExeTables.character_skeleton`
    padded to a multiple of 4

Bone 0 is the object root; the skeleton nodes carry 1-based bone indices.

The four bytes a motion block starts with — the ones `FUN_00412F50` skips with
its ``+ 4`` — are the **frame count**. The loader never reads them, but they
match ``(next_block - this_block - 4) / stride`` exactly for every block in
every bank, so the file states its own length and the engine simply does not
need to.

`[open]`: ``u16[0x004E07D0][motion_id]`` is the play length the scripts compare
against (the class-0x25 VM uses ``-1`` to mean "last frame of the motion"), and
it runs at roughly **twice** the frame count — 25 frames against 48, 41 against
79, 51 against 99. That is consistent with the animation clock advancing once
per 60 Hz frame over motion data authored at 30 Hz, with the odd clock values
interpolated, but the exact relation is not 2n-2 for every motion and has not
been pinned down.

**The rest pose is not in here.** Each skeleton node carries its own bone offset
in the EXE (`+0x04..+0x0C`, floats), so a character assembles in bind pose with
no motion data at all; `mot/` supplies only the per-bone rotations and the root
translation.
"""
from __future__ import annotations

import struct
from dataclasses import dataclass

__all__ = ["MOT_DIR_FORMAT", "frame_stride", "Frame", "MotionBank", "load_bank"]

#: The format string at 0x00579920, used by `FUN_00412C10`.
MOT_DIR_FORMAT = "mot\\%s"


def frame_stride(bone_count: int) -> int:
    """Bytes per frame, exactly as `FUN_00412F50` computes it."""
    return (bone_count * 6 + 15) & ~3


@dataclass
class Frame:
    root: tuple[float, float, float]
    #: (rx, ry, rz) BAMS per bone, index 0 being the object root.
    bones: list[tuple[int, int, int]]


@dataclass
class MotionBank:
    name: str
    size: int
    #: motion id -> byte offset of its block, from the file's own header
    offsets: dict[int, int]
    raw: bytes

    def frame_count(self, motion_id: int) -> int:
        """The frame count a motion block declares in its first four bytes."""
        base = self.offsets.get(motion_id)
        if base is None or base + 4 > len(self.raw):
            return 0
        return struct.unpack_from("<I", self.raw, base)[0]

    def frames(self, motion_id: int, bone_count: int,
               count: int | None = None) -> list[Frame]:
        """Decode a motion's frames for a given character's bone count.

        *count* defaults to as many whole frames as fit before the next
        motion block (or the end of the file).
        """
        base = self.offsets.get(motion_id)
        if base is None:
            return []
        stride = frame_stride(bone_count)
        start = base + 4
        later = [o for o in self.offsets.values() if o > base]
        end = min(later) if later else len(self.raw)
        avail = max(0, (end - start) // stride)
        declared = self.frame_count(motion_id)
        if 0 < declared <= avail:
            avail = declared
        n = avail if count is None else min(count, avail)
        out: list[Frame] = []
        for f in range(n):
            o = start + f * stride
            rx, ry, rz = struct.unpack_from("<3f", self.raw, o)
            bones = [struct.unpack_from("<3h", self.raw, o + 12 + b * 6)
                     for b in range(bone_count)]
            out.append(Frame((rx, ry, rz), bones))
        return out


def load_bank(game_dir, name: str, motion_ids) -> MotionBank | None:
    """Load one `mot/` bank and apply the header exactly as sub-step 2 does."""
    from pathlib import Path
    path = Path(game_dir) / "mot" / name
    if not path.is_file():
        return None
    raw = path.read_bytes()
    ids = list(motion_ids)
    if len(raw) < len(ids) * 4:
        return None
    offs = struct.unpack_from(f"<{len(ids)}i", raw, 0)
    return MotionBank(name, len(raw), dict(zip(ids, offs)), raw)
