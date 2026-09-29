# Class 0x42 — the worm

Stage 2's worms: the ones that ride the cog in block 21 and drop off it one
after another, and the larger batch that drops in block 26. Ported in
`web/src/game/class42/`, drawn by `web/src/render/worm.ts`, held to the EXE
by `web/tools/checks/worm.ts`.

**What it is** `[proved]`: the kill plays `0x3619A9` or `0x3719A9`,
`STAGE2_SE\WORM_TUBU1_44.wav` and `WORM_TUBU2_44.wav`, which nothing else in
the image plays, and every draw is `buyo.bin` (entries 0..53, asset slots
`0x85A..0x88F`). An earlier reading had it as "falling shootable breakables"
and took `obj+0x1E4` for an asset slot; it is the orbit angle, and the class
is an enemy that leaps at the player.

## The routines

| routine | address | what |
|---|---|---|
| `PlaceWormBatch` | `0x0042F9B0` | the class handler: a placer, `ActorKill` on every path |
| `WormPickLeapTarget` | `0x0042FC00` | the leaper's launch: start point, target player, yaw bias |
| `WormUpdate` | `0x0042FCA0` | a batch member, every frame |
| `WormAssetDrawSlot` | `0x00430B90` | `AssetDrawSlot(slot)`, the thunk every draw goes through |
| `WormAssetDrawSlotWithAlpha` | `0x00430BA0` | the shadow's draw: the scene-light-array twin in block `0x1A` |
| `WormDeathUpdate` | `0x00430C80` | a member after the kill (Ghidra had no function here) |
| `WormLoneDropUpdate` | `0x00431000` | sub-type 1's one worm |
| `NoOpStubWithLargestScale` | `0x00431200` | `NoOpStub(max(sx, sy, sz))` — dead |
| `MotionFrameRecord` | `0x00412FB0` | `g_motion_slots[m].base + 4 + frame * 0x14` |

The three globals are the class's own — every access to `0x007DCA48`,
`0x007DCA49` and `0x007DCA4C` is in `PlaceWormBatch` or `WormUpdate`, by byte
pattern: `g_worm_leaper` (s8, whose turn it is to leap), `g_worm_live_count`
(s8) and `g_worm_members` (fifteen pointers).

## The placer — `[proved]`

`obj+0x130C` is `desc+0x25`. Sub-type 0 makes six members, eight with
`g_players_in_play > 1` (`SETG; DEC; AND EBX, -2; ADD EBX, 8`); sub-type 2 ten
or fifteen (`AND AL, 0xFB; ADD EAX, 0xF`). `g_worm_leaper = rand() % n` is
drawn **before** the sub-type is tested, and for sub-type 1 `n` is still the
object pointer — so the draw is taken on every path and the byte stored is the
draw's low eight bits.

Each member is `ActorAlloc(WormUpdate, 0x230)` + `ActorClearGameFields`,
then: `+0x34 = 1`, `+0x11C = 1`, `+0x193` its index, `+0x194` the count, x/z
the placer's plus a tenth of `g_worm_offsets_6_8` (`0x0055D698`) or
`g_worm_offsets_10_15` (`0x0055D6C0`), y the placer's, pitch `0x4000`, yaw the
placer's plus `g_worm_yaw_offsets[i]`, scale 1, radius 2.2, state 0,
`+0x1E8 = rand() % 60` (overwritten before anything reads it),
`+0x224 = g_ground_plane_y`, `+0x1E4 = g_worm_orbit_phase[i] + 0x7800`,
`RegisterEnemySlot`, and **both counters incremented inside the loop**
(`0x0042FBBF`, `0x0042FBC6`). Sub-type 1 is one `WormLoneDropUpdate` object:
position and yaw, radius 3.0, `+0x192 = 1`, and no counter.

The three shipped spawns are all stage 2's and are sub-types 1 and 0 (block 21
step 4 op 29, one instruction) and 2 (block 26 step 2 op 12).

## A member — `WormUpdate`, `[proved]`

In order, every frame: write itself into `g_worm_members[idx]`; take a kill if
`obj+0x34` bit 8 is up and the state is not 7; the state (jump table at
`0x00430B68`, seven arms, each ending at `0x00430022`); the draw; the tail.

**The kill.** Blood at `obj+0x70` (`SpawnBloodSprayAtPoint` is handed
`obj+0x40` and reads `0x30` past it), `DEC` both counters, its member slot 0,
a WORM_TUBU on `rand() & 1`, 80 points and a hit to the shooter (bit 2 player
0, otherwise player 1; both bits, `rand() % 2`). In states 0 and 1 — **not yet
landed** — `+0x34 |= 0x1000000` and the two halves' heights from frame 0 of
motions `0xBF`/`0xC0`; otherwise `SpawnHordeDeathSplash` at the worm, and in
state 5 `+0x34 |= 0x10000000`, which no routine of the class reads back
(`[open]` whether anything else does). Then state 7, the counters
`+0x1EC/+0x228/+0x22A` zeroed, `g_worm_live_count--`, off the camera's list,
its enemy slot freed, `g_worm_leaper` redrawn at random over the live members,
and `WormDeathUpdate` written into `obj[0]` (`0x0042FEE6`). The kill also
writes `+0x54 = -0.15`, `+0x1F4 = 0`, `+0x1F8 = 0.3`, `+0x1FC = 0`, which
neither this routine nor the death routine reads.

**The states.**

| # | what | out |
|---|---|---|
| 0 | on the cog: in block `0x15` circles `(-924, -1336)` at radius `idx + 5`, `+0x1E4 -= 0x80` a frame | `++timer > g_worm_drop_delay[idx]` |
| 1 | falls, `vy -= 0.01633` | `ground + 3.57 > y`: `y = ground + 0.8`, pitch 0, `PDMG_MORR1/2` |
| 2 | the splat, `0x85C + timer` | `++timer > 0x18`: row 8 |
| 3 | crawls: `(step[i+1] - step[i]) * 0.01 * 0.6 * k` along the yaw, scale `(s * 0.0001 - 1) * k + 1`; `k` 0.8 in block `0x15` (and the table twice), 0.3 elsewhere | row `0x3B` |
| 4 | wobbles (`+0x1F0 += 0x800`) and turns a tenth of the way to face the camera block `g_camera_index` names; the leaper, with `g_scene_state_major_entered == 2` and a player in play, swells over ten frames to `g_worm_leap_scale` row 0 | ten frames: `WormPickLeapTarget`, yaw square to the camera, range |
| 5 | the leap: from row `0x20`, `g_worm_leap_path` `{rise, reach}` hundredths — reach times the range times `0.01618` along the yaw, rise times `|eye.y + 4 - start.y| * 0.0687 * 0.6` — pitch easing a quarter onto the path's slope, scale from `g_worm_leap_scale` | frame `0x3C`: `PlayerTakeDamage(+0x121, 1, 9)` if that player is in state 5, a bounce off the last frame's move (`* -5`, `* 10`, `* -5`), the leaper handed to the next live member |
| 6 | flies off under 0.02722, tumbling `0x600` a frame | under the ground: both counters back, slot 0, `g_worm_live_count--`, `ActorDespawn` |

The leap's four `0.5278, 1.351, 1.3501` in the decompilation of state 4 are
not literals: the listing loads row 0 of `g_worm_leap_scale`
(`MOVSX EDX, word ptr [0x0055D530]`) — `L73`.

**The draw**, under `LightsUseSecondarySet`: `M = Ry(yaw) Rx(pitch)
S(0.6 * scale)`, bracketed in state 2 by `T(0, 0, -obj+0x1E0)`, a word nothing
writes; the body `0x85A` (or the splat) at `T(x, y + 1, z) M`, and the shadow
`0x85B` at `T(x, ground + 2, z) S(1, 0.1, 1) M` at alpha 0.5. In state 7 it is
skipped on odd frames, which a member reaches only on the frame of its kill.
In block `0x1A` the shadow goes through `AssetDrawSlotWithAlphaSceneLights`;
`buyo.bin` 1 is an untextured mesh of base colour black, so no light set draws
it differently, and the port draws it with the plain faded draw.

**The tail**: `+0x34` bit `0x10000` clear only on the leaper — the camera
follows the worm about to leap — `+0x1B0` and `+0x100` the position,
`obj+0x70` the view-space `(x, y + 1.25, z)`, `RegisterForShotTest`,
`RegisterForCameraTracking`, and if `g_worm_members[g_worm_leaper]` is empty,
the leaper moved on from this member.

## After the kill — `WormDeathUpdate`, `[proved]`

Killed after landing: the corpse falls to the ground (or sinks 0.025 a frame
on it) and draws the death strip `0x87A + n` (`buyo.bin` 32..53) at
`T(x, y + 1, z) Ry Rx S(0.6)`, `n` stepping to `0x15`. Split: two halves, each
the frame `+0x228[i]` of motion `0xBF` / `0xC0` — a two-node effect-layout
motion, sixty frames, bank 33 `mol.bin` — drawn at `T(pos) Ry(yaw)` then the
frame's translation, `Rz Ry Rx` by its angles, `S(0.6)`, as slot `0x875 + i`
and then `0x877`. The frame is read, drawn and **then** stepped, to `0x3B`. A
half whose y falls under the ground plus 1.5 lands: its height is pinned
there, `SpawnHordeDeathSplash` fires at its x/z turned by the yaw, and it sinks
0.025 a frame, drawn at `T(pos) Ry T(0, -y, 0) T(t.x, height, t.z)`. Once half
0's track has run out, `+0x21C` (from `-1.3279`, less `0.0103` a frame) pulls
the whole object down. Either way it despawns when `+0x1EC` passes `0x3C` —
sixty-two frames — moving no counter and registering for nothing.

## The lone drop — `WormLoneDropUpdate`, `[proved]`

Falls under 0.02722 from where it was placed and despawns below y 30, drawn as
`0x85C` at `T(pos) Ry(yaw)`. Shot, it splits into the same halves on the same
frame and never lands them; it despawns on the frame half 0 reaches `0x3B`.
Registers for the shot test (radius 3.0, its own origin) and for nothing else:
no counter, no score, no camera.

## In the port

* The routine `obj[0]` holds is `WormTail.routine`, and `WormClassUpdate`
  dispatches on it.
* A member's address is `0x30000000 | idx << 20 | placer & 0xFFFFF`; the lone
  drop takes index 15.
* The counters go through `ReleaseEnemy*Count`'s latches, so the port's extra
  ways out (`leave`, the dead sweep) cannot take a member out twice.
* What each routine drew is on the tail (`drawnBody`, `drawnStrip`,
  `drawnHalves`), because the death routine draws a frame and then steps it
  and half 0's pull moves the object between the two halves' draws.
