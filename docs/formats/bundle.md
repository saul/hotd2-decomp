# The player bundle: what travels, and how the two sides stay honest

`web/src/hod2lib/` writes a directory the browser player fetches — from a CLI
(`npm run export`) or from a worker inside the page itself. Every format is
parsed exactly once, before play; the client re-implements none of them at run
time. This file is about the *contract* between the two halves: what is in the
bundle, what deliberately is not, and the three checks that fire when they
drift.

Anything below that says "the exporter" means `web/src/hod2lib/`. How to run
it, from the command line or inside the page, is in
[`docs/PLAYER.md`, *The bundle*](../PLAYER.md#the-bundle).

```
extract/player/
  manifest.json          the index: format, digests, stages, sources
  stage2/
    stage2.glb           geometry, materials, textures
    stage2.cam.json      Hermite curves keyed by global path slot -- the
                         stage's `cp_`/`op_` files and, since format 11,
                         `cp_gmovr` (slot 0x1F, the game-over fly-over)
    stage2.script.json   the resolved event script, and every table block
  stage2_original/       game mode 1, same shape
```

## How the files are written

Every JSON file is `JSON.stringify`'s output, through `bundleJson` in
`web/src/hod2lib/io.ts`: `<stage>.script.json`, `<stage>.cam.json` and the
`.glb`'s JSON chunk compact, `manifest.json` indented by one space because it
is the file a person opens. The text is UTF-8, and a non-ASCII character is
written as itself. A `NaN` or an `Infinity`, which `JSON.stringify` writes as
`null`, and a `Map` or a `Set`, which it writes as `{}`, fail the export
instead, naming the key: a curve of nulls would load and fail far from where
it was made. An `undefined` member is left out, which is how an optional block
that was not built stays out of a file. `-0` is written `0`. Nothing reads a
bundle file as text; every reader is a JSON parser.

The `.glb` is glTF 2.0 binary: the JSON chunk, padded with spaces, and one BIN
chunk holding every buffer view, each texture a PNG among them. Every material
is `KHR_materials_unlit`. It holds the stage's geometry, one parent node per
part, and the rigs -- object rigs, characters, props and the hidden slot rigs
-- with one root per route, placement or fixed pose; no cameras, rails or
animations.

`manifest.json`:

| Field | |
|---|---|
| `format` | `BUNDLE_FORMAT` |
| `schema` | `{hash, files}` -- the declaration digest, below |
| `builder` | `{hash, files}` -- the exporter digest, below |
| `tool` | `"hod2lib"` |
| `built` | when, as UTC ISO 8601 |
| `game_dir` | the install it was built from, as the host names it |
| `fps` | `60` |
| `projection` | `yfov_deg`, `yfov_bams`, `aspect`, `znear`, `zfar` -- `SetupSceneProjection`'s constants (`cam.md`, *Field of view*) |
| `stages` | one entry per stage directory: `name`, `format`, `builder`, `stage`, `scene`, `game_mode`, the `geometry`, `cam` and `script` file names, `counts`, `degraded`, and `sources`, the SHA-256 of every file consumed |
| `notes` | free text about how it was built; informational |

Since format 11 every stage's `characters.placements` also carries two
**synthetic** rows with `player_body` set, at `0x20000000 + p`: the players'
bodies, character types `0x39` and `0x3A` -- the game-over fly-over's bodies
and the route map's figures -- with every clip that screen draws them on
(`0x32C`, `0x338`, `0x339`, `0x358`, `0x35B` as each type has them), and every
clip the `+0x80` player hooks put them on in play: `0x322`, `0x34A`, `0x319`,
`0x334` (stage 1's car) and `g_player_stand_motions`' `0x349`, `0x356`
(stage 2 block 6), on both types. Nothing spawns from them;
`render/game_over_scene.ts` claims their hierarchies from the character layer
and draws them on the game-over screen and in play.

Since format 12 `script.json` carries a `game_over` block -- the game-over
screen's `.rdata`, read by `ExeTables.gameOverTables`: the
bodies' types, start and fall clips, fall frames and stands; the route map's
tile bases, waypoint table and default route; and the bodies' tables in play,
`entity_offsets` (`0x00579E98`), `seat_x` (`g_st1_vehicle_seat_x`),
`stand_points` and `stand_motions` (`g_player_stand_points`,
`g_player_stand_motions`) -- and `screen_sprites` (the old
`hud_sprites`) holds the logo's and the route tiles' images beside the HUD's.
The `.text` immediates that are join keys (the logo sprite ids, the figures'
clips, the disc and footprint slots) live in `web/src/game/player_body_data.ts`,
which the exporter imports.

`script.json` also carries a
`result_card` block -- the result card's `.rdata`, read by
`ExeTables.resultCardTables`: `bytes`, the span
`0x0055DD80..0x0055E074` as hex (the figure records, the six list pointers,
the per-type attachment lists, the four glyph strings and the life bonus, as
one span because the card reads a scene's records with no bound), `lists`
decoded, and `accuracy_bonus`, `g_accuracy_bonus_table` and the words after
it to `0x005679FC`. A stage that places the card (1..4) also carries the
seventeen `scr_result` tiles in `screen_sprites`, the `result.bin` glyphs as
effect slots, and one hidden **template row** per character type the card
can stand, at `0x06000000 | type` (`ResultFigureTemplateAt`), with the
figures' clips (`0x17C`, `0x17D`, `0x17F`, `0x180`, `0x18B..0x18D`, and
whatever a list's overflow records name) and `common.bin[199]` on the type's
template. The renderer clones a template for each figure the card allocates;
`web/tools/checks/result_card.ts` holds the block to the EXE.

A stage that spawns class 0x42 -- the worm, stage 2 -- carries
`characters.class42`: the class's `.rdata`, each table cut at the extent its
reader's index reaches (`web/src/hod2lib/class42.ts`) -- the member offsets
for six-to-eight and ten-to-fifteen batches, the drop delays, yaw offsets and
orbit phases, the crawl's steps and scales, the leap's path rows `0x20..0x3B`
and scales -- and `halves`, motions `0xBF` and `0xC0` as the two-node
effect-layout frames `MotionFrameRecord` (`FUN_00412FB0`) reads, sixty each,
`t` and `r` flat. Each class-0x42 placement carries `class42: {subtype}`,
`desc+0x25`, and the hidden `slots_actor` rig carries `buyo.bin` 0..53
(`0x85A..0x88F`). `web/tools/checks/worm.ts` holds the port's scalars to the
EXE; see [`docs/re/worm.md`](../re/worm.md).

A class-0x29 placement -- the floor decals, stages 1 and 2 -- carries
`class29: {kill_path, kill_frame}`, the two `s16`s at `desc+0x24`, and its
`hp` is the list `SceneryBatchUpdate29` (`FUN_00432C80`) draws. The three
lists themselves are `.data` literals in `web/src/game/class29/`, checked
word for word by `web/tools/checks/prop_tables.ts`; the two slots they draw,
`0x93C` and `0x93D`, ride the hidden `slots_effect` rig.

Every stage carries `subtitle_glyphs`, `g_subtitle_glyphs` (`0x0055E054`)
as s16[128]: the screen sprite `DrawTextCentred` (`FUN_00436850`) draws for
each character. `screen_sprites` carries the glyphs of the characters the
shipped dialogue lines use, and `0x62D` for `~` -- `scr_jimaku_e.bin`, PAL4
on palette 0. See `evt.md`, *`2D` -- the dialogue*.

Class 0x41 constructor 3 -- stage 1 block 0's placer -- is a breakables
placement with `container: "uv_scroll"` and nothing else: the task reads
nothing of the placer. The three shells it rewrites are the `st1_vehicle`
rig's own primitives, found by `hod2_slots` and `hod2_model`.

Every stage carries `characters.class32` -- class 0x32's `.rdata`, read by
`web/src/hod2lib/class32.ts` where the stage-5 boss's routines index it:
`phases` (`g_class32_phases`, six `[state, floor]` rows), `hop_offsets` and
`circle_offsets` (four eye offsets each), and the seventeen-row rank tables
`hop_frames`, `rank_rows`, `projectile_frames` and `barrage_rows`. Each
class-0x32 placement carries `class32`, every descriptor-tail field a routine
reads through `obj+0x1390` (`CharacterPlacement.class32` names which). The
boss is character type `0x4B`, whose fifteen nodes are **two pol files'**
models -- eleven `boss5.bin`, four `boss5b.bin` -- which the exporter
resolves per node through the slot table (`ExeTables.characterAssetFiles`,
`charbuild.rigEntry`) rather than taking one file for the type; its gore rig
carries every model the node hook `Class32DrawBonePart` can draw
(`game/class32/bone_parts.ts`, `boss5*.bin` `0x44A..0x72A`), the
`slots_actor` rig every model its projectiles and tasks draw
(`ACTOR_SLOTS[0x32]`: `boss5.bin` 206 and `eff_boss5.bin`'s runs), and
`slots_effect` its sprite kind 0x50 (`EFFECT_SLOTS_BY_CLASS[0x32]`). See
[`docs/re/boss-magician.md`](../re/boss-magician.md).

`screen_sprites` also carries the continue screen's sprites -- CONTINUE?, the
64x128 countdown digits, the credit line's words and the small GAME OVER --
from `CONTINUE_SCREEN_SPRITES` in `web/src/game/hud_sprites.ts` (see
`texbank.md`). A new key in an existing map, not a new field: no format bump,
and a bundle built before it reads fine and draws no continue screen until it
is re-exported, which the builder hash says.

`script.json` carries a `class2d` block -- class 0x2D's `.rdata`, the stage-6
boss's tables, read by `ExeTables.class2dTables` (`Class2DTablesJson`): the
hit damage and stagger hits by `g_players_in_play`, the five waypoints, the
attack and child-kind picks, the charge steps, the eight round-3 path
segments, the child offsets, the satellites' launch gap and flight frames,
kind 0's path starts, the children's approach frames and the two
bone-to-satellite maps, each at its address and extent. Every class-0x2D
placement carries `class2d`, the descriptor tail `obj+0x1390` --
`{subtype, clip, counter, kill_path, kill_frame, fight_hp, round2_hp,
round3_hp}` (`class2dTail`). Optional fields: the schema digest moved and no
format bump. See [`docs/re/boss-emperor.md`](../re/boss-emperor.md). A class-0x2D placement is posed
on its tail's clip with the whole of `boss6.bin`'s bank (`0x95..0xB0`), and
the fight's (sub-type 1) carries five **synthetic** rows at
`Class2DChildAt(boss, code)` -- `0x01000000 | code << 20 | boss & 0xFFFFF`
-- for the children `Class2DState4` allocates and kind 0's wing: types 0x4D,
0x4F, 0x50 and 0x51 on `0x40C`, `0x33`, `0x3B` and `0x79` (codes 8..11) and
0x4E on `0xF` (code 12), each parented to the fight's row. The effect rig
carries every slot the class draws by hand (`CLASS2D_EFFECT_SLOTS`), and
every primitive whose UVs `ModelUVsFromViewNormals` rewrites carries
`hod2_env_uv` in its extras (`nl1.md`).

`script.json` carries an `options` block -- the options screen's `.rdata`, read
by `ExeTables.optionsTables` (`OptionsJson`): the eleven rows
through `g_options_rows`' pointers, the difficulty, digit and blood labels,
"Free Play" and "No.", the 96-entry glyph table from `0x0056AF10`, the
crosshair sprites, the two sound tests' lists and Sight Speed's four sprites
-- and `screen_sprites` holds every sprite the screen can draw: the
immediates in `OPTIONS_SCREEN_SPRITES` (`web/src/game/options_data.ts`) and
the ids those tables name. An optional field, so the schema digest moved and
no format bump: a bundle built before it is refused by the digest and rebuilt,
which is one click. `web/tools/checks/options.ts` holds the block to the image.

## Three versions, and only one of them moves on its own

**1. `format` — `BUNDLE_FORMAT` in `web/src/hod2lib/bundle.ts`, `SUPPORTED_FORMAT` in
`web/src/bundle/manifest.ts`.** The coarse check: the client refuses a bundle
whose `format` is not its own. Bump it when the *layout* changes — a file added
to a stage directory, a block renamed.

It is bumped by hand, and that is its weakness rather than a detail. It sat at
**1 across 23 commits** to the bundle writer, including the ones that added
`coli`, `civilians`, `humanoids` and `set_pieces` and the one that renumbered
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
generated into `web/src/bundle/schema_hash.ts`. `web/tools/gen/schema_hash.ts` is
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
`web/tools/repo/exporters.ts` reads the directory and fails both ways: a listed file
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
* **`schema_hash.ts` is generated and committed.** `web/tools/gen/schema_hash.ts`
  writes it, and `web/tools/repo/exporters.ts` re-derives it and **fails when the
  committed copy is stale** — which is what makes it impossible to forget: the
  digest catches a stale bundle, and that check catches a stale digest.
* The generated file is excluded from its own digest, because a file that
  contained its own hash could not have one.

**4. The builder digest, which says a bundle is merely *old*.** The three
checks above are all about whether a bundle can be **read**. None of them is
about whether it is what today's exporter would **write** — and those are
different questions with different remedies.

`manifest.json` carries a second SHA-256, over the code in
`web/src/hod2lib/`, and every stage entry carries the same hash on its own.
`web/tools/gen/builder_hash.ts` generates it into `web/src/bundle/builder_hash.ts`
in the same shape as the schema one, `web/tools/repo/exporters.ts` fails when the
committed copy is stale, and the exporter imports rather than recomputes it.

* **It warns; it does not refuse.** A schema mismatch means the bundle cannot
  be read correctly. An exporter change usually means it reads perfectly and is
  a little out of date, and refusing would make every unrelated fix in
  `hod2lib/` cost a full re-export before anything could be opened at all. The
  page marks the stage stale, the Bundle button says *Bundle needs rebuilding*,
  and the bundle screen names the files that moved.
* **It hashes bodies, not just declarations.** The opposite decision from the
  schema digest and for the opposite reason: a function body is exactly what
  decides a byte of output. Comments and whitespace are still stripped.
* **It globs `hod2lib/*.ts` rather than naming them.** Also the opposite
  decision. There, a named list keeps the loader's text out of a digest a
  bundle is compared against; here, every file is implementation and one this
  missed would be a stale bundle nobody is warned about — and a new module is
  exactly when that would happen.
* **Per stage as well as per manifest**, for the same reason `format` is: the
  browser's cache is nothing but partial exports. It is filled one stage at a
  time and it goes out of date one stage at a time.

The gap it closes: an exporter fix that changes what a stage holds -- keeping
the 3–5% of triangles a UV-area filter drops (`nl1.md`, *Collapsed-UV
triangles*), say -- moves no declaration and no `BUNDLE_FORMAT`. Without this
digest a stage already in a browser's OPFS cache goes on winning over the
rebuilt one, holes and all, however many times the tree is exported, with
nothing on the page saying why.

## The rule: `.rdata` travels, `.text` does not

A number the exporter **reads out of the EXE** goes in the bundle. Reading it
is what `hod2lib` is for, and there is no other way for the client to get it:

* per-character damage and effect rows (`PTR_DAT_004C8350`, `PTR_DAT_004C7160`)
* the four turn-rate curves (`PTR_DAT_00576C04`)
* the approach radii (`DAT_004C4CD0`), the bone→zone map, the reaction groups
* every baked motion, every skeleton, every attack and throw table row

A number the compiler **put inside a routine** does not. It belongs in
`web/src/game/`, as a named constant carrying its Ghidra citation:

```ts
/** Frames of invulnerability after a hit — `0x5A`. */
const PLAYER_INVULN_FRAMES = 90;
```

The failure this closes is specific. `90` used to be exported as
`characters.player.invuln_frames`, so the constant lived in the exporter
beside the Ghidra citation that proves it, while `PlayerTakeDamage`
(`FUN_00415300`) in `game/combat/player.ts` read it as `d?.invuln_frames ?? 90`
— a bare literal, uncited, in the file whose whole job is to be the
transcription. `web/tools/repo/port.ts` scans `game/` and could see neither half.
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
clip by hand and stance, and a review proposed exporting the table it
indexes — the 32 bytes at `0x0044FD1C` — as an `.rdata`
row set. It is not one. `.rdata` starts at `0x004C4000`; that table is inside
the function's own body, has one xref, and is a compiler-emitted dense switch
whose nine jump targets are all addresses in that function and whose clip ids
are `MOV` immediates in its arms. Two things settle it:

* **the test is whether the exporter had to write the thing being joined to,
  not whether the value looks like an id.** All eight of those clips are
  already baked for character type 0x18 — `web/src/hod2lib/class31.ts`'s
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
