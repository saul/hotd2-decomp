# `mot/` motion data

**Status:** container understood, block contents unknown. Phase 6.

51 files, named by character or entity rather than by stage.

| Group | Files |
|---|---|
| Bosses | `boss1` – `boss6` |
| Player | `player`, `player1` – `player6`, `playerend` |
| Zombies / enemies | `zom`, `szom`, `hzom`, `skag`, `ebi`, `cibi`, `kame`, `frog`, `bat`, `mol`, `nya`, `ono`, `gold`, `debu`, `ksei`, `katana`, `kage`, `assb`, `ans` |
| Props (`komono` = "small item") | `komono`, `komono_bridge`, `komono_colo`, `komono_door`, `komono_man`, `komono_niwa`, `komono_souko`, `komono_st2`, `komono_st6` |
| Other | `people` (768944, the largest), `cha`, `g`, `lsr`, `nick`, `trn`, `hod1`, `tt` (88 bytes, the smallest) |

`hod1` is presumably data for the House of the Dead 1 flashback content.

## Container

`u32` offset table at the start, monotonically increasing, no `0x800` padding —
same shape as `cam/`.

`mot/zom.bin`, 354908 bytes:

```
0x150, 0x16D8, 0x2A44, 0x34D4, 0x4624, 0x4F04, 0x57E4, 0x6934,
0x71A8, 0x8730, 0x9A9C, 0xB024, 0xBD3C, 0xCF64, 0xDC7C, 0xE994,
0xF6AC, 0x100D0, 0x109B0, 0x11290, 0x123E0, 0x12EDC, 0x1396C, ...
```

The first entry `0x150` = 336 implies 84 `u32` entries, i.e. 84 animation blocks.
Block sizes vary from ~1 KB to ~5 KB.

## Loader

`0x412CBC` builds the path from `mot\%s` (`0x579920`) and a filename pointer
table at `0x4D1B00`.

The surrounding code reads a `u16` count from a table at `0x4E2BDC` and a pointer
from `0x4E2B14`, then loops writing 8-byte records into an array at `0x9A37E0`,
indexed by an `s16` read from the pointed-to data. That looks like a
registration pass binding animation slots to entity IDs before the file is read.

## The skeleton problem

**NL1 models have no skeleton** — no bones, no skin weights, no node hierarchy.
See [`nl1.md`](nl1.md).

So whatever `mot/` contains, it is not skeletal animation in the usual sense. The
realistic possibilities:

1. **Per-mesh rigid transforms.** Each NL1 mesh block is treated as a rigid part
   and gets its own translation/rotation track. This is the usual approach for
   Saturn/Dreamcast-era character animation and fits a format with no weights.
   Character models would then be built from many small meshes — one per limb
   segment.
2. **Vertex morphs.** Whole vertex arrays keyframed and interpolated. Expensive
   in memory, but possible for short animations.
3. **A hierarchy stored outside the model.** Bone parenting could live in `mot/`
   itself, with the model supplying only the parts.

Option 1 is most likely. Confirm by checking whether a character `pol/` file's
mesh count matches the per-block track count in the corresponding `mot/` file —
that correlation would settle it quickly and cheaply.

## Approach

1. Test the mesh-count / track-count correlation described above.
2. RE the animation playback routine for the keyframe struct and interpolation
   scheme.
3. Determine the time base — almost certainly frames at 60 Hz, matching the
   arcade hardware.

## Export

- If per-mesh rigid transforms: glTF node animations, one channel set per mesh
  node.
- If vertex morphs: glTF morph targets.

Either maps cleanly to glTF, so the exporter is straightforward once the layout
is known.

## Open questions

1. Rigid transforms or morphs?
2. Is rotation stored as Euler angles, a quaternion, or a matrix? Dreamcast-era
   Sega code commonly used 16-bit BAMS Euler angles, which would be compact and
   is worth testing for first.
3. What is the time base?
4. How does an `evt/` event select an animation block — by index into this table?
5. Why is `people.bin` so much larger than everything else? Crowd or civilian
   animation sets, presumably.
