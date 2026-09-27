/**
 * The manifest and its stage entries.
 *
 * Part of the bundle the exporter writes; see docs/formats/ for each block.
 */

/**
 * The `format` this client reads, and the exporter's `BUNDLE_FORMAT` must
 * match it exactly. Both sat at 1 through every shape change either side ever
 * made — `coli`, `civilians`, `humanoids`, `set_pieces`, the renumbered
 * `game_mode` — so this check has never once been able to fire, and a bundle
 * built before collision existed loaded and silently lost it.
 *
 * The two constants move together, in the same commit as the shape change.
 *
 * **This is the coarse half of the contract and it is not the half that will
 * fire**, for the reason above: bumping it is something a person has to
 * remember. {@link Manifest.schema} is the half nobody has to remember. Move
 * this one when the *layout* changes — a file added to a stage directory, a
 * block renamed — and let the digest catch the field-level drift.
 *
 * 3: the manifest carries a schema digest and every stage carries its own
 * `format`. See `docs/formats/bundle.md`.
 *
 * 14: the stage-3 boss -- two 13s had been cut on two branches, the
 * stage-4 boss's and this one, so the merged layout is its own number.
 * Class 0x45 has a character-type and a motion rule,
 * so stages 3 and 6 carry its placements -- each with a `class45` block, the
 * sub-type -- and `boss3.bin`, `boss3l.bin` and the civilians' clips; the
 * effect slots gain its card pieces, sparks, splashes and flashes, and
 * `screen_sprites` its two card sprites. A bundle before it has no class-0x45
 * placement at all, and a client reading one would stage the fight with no
 * boss in it and hold both gates for ever.
 *
 * 13: the stage-4 boss. `script.json` carries a `boss4` block -- class 0x19's
 * seven `.rdata` tables (`ExeTables.boss4Tables`): the phase floors, the head
 * damage, the two held props, the 22 camera cues, the 18 phase arenas, the
 * head models by bar and the approach picks -- and `carrier_door_yaw`, the
 * swing class 0x13's carrier routine 2 steps its doors through. Class-0x19
 * placements carry `class19`: the entrance, the per-bone `coli4.bin` meshes
 * `ShotTestBoneMesh` tests instead of spheres, and the camera pair that
 * despawns the boss. The boss's clips gain 0x67 and 0x68, the throws. A
 * format-12 bundle has none of it, and a client reading one would run a
 * fight with no arena, no cues and no floors.
 *
 * 12: the game-over screen's sprites and route map. `script.json`'s
 * `hud_sprites` is `screen_sprites` -- the HUD's images and now the logo's
 * (`scr_gameover.bin`) and the route map's 300 tiles (`scr_bunki.bin`) -- and a
 * `game_over` block carries the screen's `.rdata` (`ExeTables.gameOverTables`):
 * the bodies' types, clips and stands, the route's tiles, waypoints and
 * default route. The effect slots gain the route's disc and footprints, and
 * the body rows the route figures' clips. A renamed block, so the number
 * moves with the digest.
 *
 * 11: the game-over fly-over. Every stage's `cam.json` carries
 * `cp_gmovr.bin`'s path, global slot `0x1F`, and its `characters` carry two
 * synthetic `player_body` rows -- character types `0x39` and `0x3A` on motion
 * `0x338` -- for `GameOverCameraFlyTick` (`FUN_00460E60`) to fly over and
 * `PlayerHookDrawBodyUntilMotionEnd` (`FUN_004151D0`) to draw. A format-10
 * bundle has neither, and a client reading one would film an empty world.
 *
 * 10: every attack entry's `player_motion` is `overlay_kind` -- the damage
 * overlay a strike shows (`DamageOverlaySpawn`, `FUN_00417440`), which is
 * the field's only use in the exe; nothing ever read it as a motion. A
 * renamed field, so the digest alone would refuse a format-9 bundle; the
 * number moves with it so the refusal names the cause.
 *
 * 8: the class-0x31 tables carry `drop`, `drop_alt` and `drop_zskamere` --
 * `ThrowerStateLeapToPoint`'s three arc motion scripts -- and the clips they
 * name are baked. A format-7 bundle has neither, and a client that reads one
 * puts every class-0x31 actor placed in state 20 through a leap with no
 * script: it stands in the window it should have come through and then walks
 * out of it. Nine of the eleven such spawns are in stages 2 and 4.
 *
 * 7: **`game_mode` is renumbered.** Arcade is 0, not 2 -- 2 is Training. The
 * value is `g_GameMode`'s, and nothing in the *layout* moved, so this is the
 * one bump that exists because a **value** changed meaning: a format-6 bundle
 * says `game_mode: 2` for Arcade, which a format-7 client would read as
 * Training and would then pay no score for a prop hit and pick the wrong BGM
 * mix. The digest cannot see it -- no declaration moved -- and the builder
 * hash only warns, so refusing is the only thing that catches it.
 * `bgm.default_table` went in the same change: it stated the table choice a
 * second time, and wrongly.
 *
 * 6: the placements carry `class11`, `class43` and `class51` — the frog's
 * command list, the owl's two descriptor bytes and the fish's speeds, bob and
 * timings. Three enemy classes that had no module, and the fish's group header
 * is in there too: a record whose `subtype` is 6 is not a fish at all, it is
 * the water level.
 *
 * 5: `<stage>.script.json` carries `entries` and `exits` -- where a stage can
 * be entered, and where each of its endings sends the next one. Two stages have
 * more than one entry and no bundle before this could say so.
 *
 * 4: `<stage>.cam.json` carries `warnings`, the `cam/` decoder's own — the
 * counterpart of {@link ScriptJson.warnings}, which had travelled since the
 * beginning while the camera's were produced and read by nothing on the export
 * path. And the schema digest is taken over a **named** set of declaration
 * files rather than everything in this directory, so the loader's refusal
 * strings are no longer part of what invalidates a bundle.
 */
export const SUPPORTED_FORMAT = 14;

/**
 * The exporter's digest of the declarations in this directory.
 *
 * Compared against `schema_hash.ts`, which is generated from the same sources
 * and compiled into the client. See {@link SCHEMA_HASH} and
 * `tools/gen_schema_hash.py`.
 */
export interface SchemaDigest {
  /** One digest over {@link SchemaDigest.files}, in filename order. */
  hash: string;
  /** Per file, so a mismatch can name the block that moved. */
  files: Record<string, string>;
}

/**
 * The digest of the exporter that wrote this bundle.
 *
 * The other half of the contract from {@link SchemaDigest}, and it answers a
 * different question. The schema digest says whether this client can *read*
 * the bundle, and a mismatch is a refusal. This says whether the bundle is
 * what today's exporter would write, and a mismatch is a **warning**: the
 * bundle is readable and merely out of date.
 *
 * Absent on anything built before this existed, which is itself out of date.
 *
 * See `tools/gen_builder_hash.py` for why it is here at all -- an exporter fix
 * that changes no declaration used to leave a stale copy in the browser's
 * cache winning over the rebuilt one for ever.
 */
export interface BuilderDigest {
  /** One digest over {@link BuilderDigest.files}, in filename order. */
  hash: string;
  /** Per file, so a stale bundle can name what moved. */
  files: Record<string, string>;
}

export interface Manifest {
  format: number;
  /**
   * Absent in a bundle built before format 3, which the `format` check above
   * refuses first — so a `schema` this client reads is always present.
   */
  schema?: SchemaDigest;
  /** See {@link BuilderDigest}. Absent on a bundle built before it existed. */
  builder?: BuilderDigest;
  tool: string;
  tool_version: string;
  built: string;
  game_dir: string;
  fps: number;
  projection: {
    yfov_deg: number;
    yfov_bams: number;
    aspect: number;
    znear: number;
    zfar: number;
  };
  stages: StageEntry[];
  notes?: Record<string, unknown>;
}

export interface StageEntry {
  name: string;
  /**
   * The format **this stage** was written in, which is not necessarily the
   * manifest's: the exporter carries forward the entries a partial
   * export did not rebuild, so a fresh manifest can index a stage directory
   * an older tool wrote. Absent on an entry carried from before format 3.
   */
  format?: number;
  /**
   * The exporter **this stage** was written by — {@link BuilderDigest.hash}.
   *
   * On the entry rather than only on the manifest for the same reason
   * {@link StageEntry.format} is: a partial export carries forward the entries
   * it did not rebuild, and the browser's cache is nothing *but* partial
   * exports. One stage at a time is how that cache is filled, so one stage at
   * a time is how it goes out of date.
   */
  builder?: string;
  stage: number | null;
  scene: number;
  /** `g_GameMode` as the exe numbers it — see `game/game_mode.ts`. */
  game_mode: number;
  geometry: string;
  cam: string;
  script: string;
  counts: Record<string, number>;
  sources: Record<string, string>;
}
