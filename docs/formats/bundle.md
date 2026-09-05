# The player bundle: what travels, and how the two sides stay honest

`web/src/hod2lib/` writes a directory the browser player fetches — from a CLI
(`npm run export`) or from a worker inside the page itself. Every format is
parsed exactly once, before play; the client re-implements none of them at run
time. This file is about the *contract* between the two halves: what is in the
bundle, what deliberately is not, and the three checks that fire when they
drift.

The exporter was a port of `tools/hod2lib/`, which wrote this same directory
until the two agreed byte for byte on all twelve stage bundles; see
`docs/TS_PORT.md`. Anything below that says "the exporter" means the
TypeScript one.

```
extract/player/
  manifest.json          the index: version, schema digest, stages, sources
  stage2/
    stage2.glb           geometry, materials, textures
    stage2.cam.json      Hermite curves keyed by global path slot
    stage2.script.json   the resolved event script, and every table block
  stage2_original/       game mode 1, same shape
```

## Three versions, and only one of them moves on its own

**1. `format` — `BUNDLE_FORMAT` in `web/src/hod2lib/bundle.ts`, `SUPPORTED_FORMAT` in
`web/src/bundle/manifest.ts`.** The coarse check: the client refuses a bundle
whose `format` is not its own. Bump it when the *layout* changes — a file added
to a stage directory, a block renamed.

It is bumped by hand, and that is its weakness rather than a detail. It sat at
**1 across 23 commits** to `bundle.py`, including the ones that added `coli`,
`civilians`, `humanoids` and `set_pieces` and the one that renumbered
`game_mode`. The check existed the whole time and could never fire. Treat it as
documentation with teeth, not as the thing that will catch you.

**2. A `format` on every stage, not only on the manifest.** The manifest is
rewritten by any export; the stage files are not. The exporter carries
forward the entries a partial export did not rebuild, so `--stage 2` after a
`--all` leaves a *fresh* manifest indexing five *stale* stage directories. Each
stage entry, each `<stage>.script.json` and each `<stage>.cam.json` therefore
carries the version it was written in, `loadStage` checks all three, and the
exporter prints which stages a partial run left behind.

**3. The schema digest, which nobody has to remember.** `manifest.json` carries
a SHA-256 over the *declarations* in `web/src/bundle/` — per file, plus one
digest over those — and the client compares it against the same digest
generated into `web/src/bundle/schema_hash.ts`. `tools/gen_schema_hash.py` is
the one implementation of it, and the exporter *imports* what it generates
rather than recomputing it — so a bundle agrees with the client that built it
by construction.

**Over a named set of files, not the whole directory.** It was
`web/src/bundle/*.ts`, which put `stage.ts`'s loader in the hash along with its
interfaces — so rewording a refusal string invalidated every bundle on disk and
demanded a full re-export, for an edit that cannot change one byte of a bundle.
The digest is only worth having if it is cheap to keep. `schema.SOURCES` names
the seven declaration files; the loading half lives in `web/src/bundle/load.ts`
and is not hashed.

The named list has the opposite hazard — a new declaration file nobody adds to
it is a block of the bundle that **nothing checks**, silently — so
`verify_exporters.py` reads the directory and fails both ways: a listed file
that grows runtime code, and a `.ts` that declares part of the bundle and is
not listed.

* **It hashes declarations, not files.** Comments and whitespace are stripped
  first. A digest that moved when someone fixed a typo in a doc comment would
  demand a full re-export for a change that cannot alter one byte of a bundle,
  and a check that expensive gets deleted.
* **It refuses rather than warns.** A bundle whose shape does not match the
  declarations reading it does not crash: `getJson<T>` is a bare cast, so a
  renamed field arrives as `undefined` and the stage renders *almost* right —
  no enemies in one region, a camera that never turns — which is
  indistinguishable from a gameplay bug. A console warning nobody has open is
  not a check. The remedy is one re-export, and the error names which
  declaration files moved, because "the bundle does not match" is true and
  useless.
* **`schema_hash.ts` is generated and committed.** `tools/gen_schema_hash.py`
  writes it, and `tools/verify_exporters.py` re-derives it and **fails when the
  committed copy is stale** — which is what makes it impossible to forget: the
  digest catches a stale bundle, and that check catches a stale digest.
* The generated file is excluded from its own digest, because a file that
  contained its own hash could not have one.

## The rule: `.rdata` travels, `.text` does not

A number the exporter **reads out of the EXE** goes in the bundle. Reading it
is what `hod2lib` is for, and there is no other way for the client to get it:

* per-character damage and effect rows (`PTR_DAT_004C8350`, `PTR_DAT_004C7160`)
* the four turn-rate curves (`PTR_DAT_00576C04`)
* the approach radii (`DAT_004C4CD0`), the bone→zone map, the reaction groups
* every baked motion, every skeleton, every attack and throw table row

A number the compiler **put inside a routine** does not. It belongs in
`web/src/game/`, as a named constant carrying the citation the Python had:

```ts
/** Frames of invulnerability after a hit — `0x5A`. */
const PLAYER_INVULN_FRAMES = 90;
```

The failure this closes is specific. `90` used to be exported as
`characters.player.invuln_frames`, so the constant lived in `hod2lib/combat.py`
beside the Ghidra citation that proves it, while `PlayerTakeDamage`
(`FUN_00415300`) in `game/combat/player.ts` read it as `d?.invuln_frames ?? 90`
— a bare literal, uncited, in the file whose whole job is to be the
transcription. `tools/verify_port.py` scans `game/` and could see neither half.
And the `??` fallback is a *second copy that nothing compares against the
first*: `T.tracking?.face_offset ?? 12` sat next to a table that said `1.5`,
and neither number was wrong enough for anyone to notice.

**The exception is a join key.** An immediate whose value is only meaningful
against something else the exporter wrote — an asset slot the bundle's geometry
must contain, a motion id the exporter had to bake — stays in the bundle. The
class-0x30 thrower's `held`/`bare`/`projectile` slots are switch arms in
`.text`, and they travel anyway, because the client uses them to pick a model
out of the glTF.

**A motion id alone does not make the exception, and this is where that was
nearly got wrong.** `ThrowerStateThrow`'s character-0x18 arm picks its throw
clip by hand and stance, and D3 of `docs/REVIEW-2026-09-03.md` proposed
exporting the table it indexes — the 32 bytes at `0x0044FD1C` — as an `.rdata`
row set. It is not one. `.rdata` starts at `0x004C4000`; that table is inside
the function's own body, has one xref, and is a compiler-emitted dense switch
whose nine jump targets are all addresses in that function and whose clip ids
are `MOV` immediates in its arms. Two things settle it:

* **the test is whether the exporter had to write the thing being joined to,
  not whether the value looks like an id.** All eight of those clips are
  already baked for character type 0x18 — `tools/hod2lib/class31.py`'s
  `CLASS31_LITERAL_MOTIONS` lists them, under the heading that says class
  0x31's states name them as literals rather than through a table. The ids
  join to geometry that is in the bundle for reasons that have nothing to do
  with this switch, so nothing about them needs the exporter's cooperation.
* **what was actually missing was the mapping, and a mapping between two
  `.text` immediates is `.text`.**

So it went to `web/src/game/class31/thrower.ts` as `THROW_BY_STANCE_ZSLMAN`
and `ZSLMAN_RELEASE_FRAME`, beside `class31/stand.ts`'s
`WAIT_BY_STANCE_ZSLMAN`, which is the same shape read out of the neighbouring
state and was already on the right side of the line. No schema change, no
`BUNDLE_FORMAT` bump, no re-export. See `docs/formats/combat.md` §"The throw".

### What moved

| was | now | proved by |
| --- | --- | --- |
| `player.life_cost`, `.score`, `.invuln_frames`, `.rank_delta` | `game/combat/player.ts` | `PlayerTakeDamage` (`FUN_00415300`) |
| `reaction_blend.{frames,sever,hard_set_from_bone}` | `game/combat/resolve_hit.ts` | `ActorPlayHitReaction` (`FUN_004544C0`), `ActorSetMotion` (`FUN_00411930`) |
| `deaths.{right,left,arc}` | `game/combat/resolve_hit.ts` | `ChooseDeathMotionDirectional` (`FUN_00456220`) |
| `tracking.{curve,error_clamp,rate_untracked,lookat_radius,distance_scale,attack_slots,slots,max_candidates,face_offset}` | `game/camera/constants.ts` | `RegisterForCameraTracking` (`FUN_00408EC0`), `SelectCameraLookAtTarget` (`FUN_00403050`), `TurnLookAtToward` (`FUN_00403C00`), `TurnActorTowardCamera` (`FUN_00409ED0`) |
| `approach.steps.{base,mid_add,outer_add}` | `game/class30/ring.ts` | `FUN_00408D60`, `TestApproachRing` (`FUN_00456650`) |
| `approach.ring_set_for_char0`, `difficulty.default` | nothing read them; the port already had both | `EnemyZombieInit` (`FUN_00452DA0`) |

`deaths.front` and `deaths.back`, `tracking.curves` and `approach.rings` stayed
— they are the `.rdata` half of the same routines.

### What is still on the wrong side, and why

These are `.text` immediates that the bundle still carries. Each is blocked by
where its only reader lives, not by doubt about what it is:

* **`combat.{ricochet, impact_sprite, impact_sprite_default, blood_scale,
  no_effect, voice_set_a_types, head_impact}`** — the switch arms of
  `FUN_00407950`, `FUN_004073B0` and `ActorShotFeedback` (`FUN_00454050`).
  Their only reader is `web/src/render/shooting.ts`. `render/` is not `game/`,
  and a constant a renderer reads is not a transcription of anything, so where
  these should live is a question the layering has to answer first.
* **`difficulty.{hp_min,hp_max}`** — `ActorInitHitPoints`'s clamp to `[1, 300]`.
  Only reader is `web/src/render/characters.ts`. Same question.
* **`player.start_lives`** — the only one read *before* `game/` runs, by
  `web/src/app/stage_load.ts`, to seed the life counter. Moving it means the
  composition root importing a `game/` constant, which is allowed by the
  layering and was simply out of scope for the change that moved the rest.
* **The throw kits** — `speed`, `speed_standing`, `aim_ahead`, `aim_side`,
  `aim_drop`, `arc_gravity`, `hit_kind`, `stick_frames`, `blink_frames` on each
  character type's `throw` and `zombie_throw` block. All immediates, all read
  by `game/class30/throw.ts` and `game/class31/thrower.ts`, so all movable —
  but they are per-character-type blocks interleaved with `.rdata` rows from
  `PTR_DAT_00592A00`, and splitting the block is a bigger change than the ones
  above rather than a different kind of change.
* **The per-placement `ring_set`** — `EnemyZombieInit` (`FUN_00452DA0`) gives
  character type 0 ring set 2 and everything else set 0, and the exporter
  applies that rule while resolving each spawn. It could be applied in
  `game/descriptor.ts` from the character type instead.

`[open]`: nothing here says which side a *derived* value belongs on — a number
computed at export from an `.rdata` table and a `.text` immediate together. The
cases above are all one or the other.
