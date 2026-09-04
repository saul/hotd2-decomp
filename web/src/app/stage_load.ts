/**
 * Loading a stage, in the order it has to happen in.
 *
 * This is the one part of the player where **sequence is the content**. Half
 * the comments below are about what must precede what, and every one of them
 * was written after getting it wrong:
 *
 * * the scene reset before the character layer builds, or every actor it just
 *   spawned is dropped;
 * * the game tables *after* the reset, or the approach rings are zeroed
 *   seconds after being filled and nothing ever reaches striking range;
 * * the backdrop before the lighting, so the material swap sees the clones
 *   rather than the shared originals;
 * * the walker cleared before anything is torn down, so no layer places the
 *   previous stage's spawns in the new stage's scene.
 *
 * It reaches broadly into `Player`, which is what a composition step is. What
 * it gains from being a file is that the order is visible as one thing rather
 * than as two hundred lines in the middle of a class.
 */
import { loadStage } from "../bundle";
import type { StageEntry } from "../bundle";
import { StageScene } from "../render/stagescene";
import { CamPaths } from "../game/camera/curve";
import { RailLayer } from "../render/overlays";
import { attachTo, ownResources } from "../render/scope3d";
import { Walker } from "../script/walker";
import { G } from "../game/globals";
import { GameMode } from "../game/game_mode";
import { seekTo as seekWalkerTo } from "../script/seek";
import { minimapGraph, treeProjection } from "./projection/script";
import { screenMessage } from "./projection/message";
import { makeWalkerHost } from "./walker_host";
import type { Player } from "./main";
import type { StatusProjection } from "../ui/projection";

/** The manifest row for a stage, falling back to Arcade when Original has none. */
function entryFor(p: Player, stage: number,
                  original: boolean): StageEntry | undefined {
  return p.manifest.stages.find(
    (s) => (s.stage ?? s.scene) === stage
      && (s.game_mode === GameMode.Original) === original,
  );
}

export async function loadStageInto(p: Player): Promise<void> {
  // **Which load owns the scope.** Two of the four callers are
  // `void p.loadStage()` in `ui/commands.ts` -- fire and forget -- so picking
  // a stage twice in the time one bundle takes to fetch used to run both
  // loads. The second tore down the scope the first was still building into,
  // and then both wrote to `p.scene3d` and `p.walker` in whatever order their
  // fetches finished in. The teardown below is deliberately still
  // unconditional: the newest call wins, and every older one bails at its
  // next `await` and frees whatever it had got as far as making.
  const seq = ++p.stageLoadSeq;
  const superseded = () => seq !== p.stageLoadSeq;

  const entry = entryFor(p, p.state.stage, p.state.original) ??
    entryFor(p, p.state.stage, false);
  if (!entry) return p.fail(`stage ${p.state.stage} is not in this bundle`);

  p.setLoading(`loading ${entry.name}…`);
  p.playing = false;

  // Cleared before anything is torn down: `world.detach` and the layers'
  // builders both run before the new one exists, and a layer that read the
  // *previous* stage's script there would place the old stage's spawns in
  // the new stage's scene.
  p.walker = null;
  // Everything the previous stage built goes back before anything of the new
  // one is made, so a leak shows as a scope that outlived this call rather
  // than as a slow climb nobody attributes to a stage switch.
  //
  // The mark goes **here**, at the teardown, and not at the end of the load.
  // What the scope panel asks is "did this survive a teardown", so the frame
  // it compares against is the frame the teardown happened on. Stamping it
  // after the awaits instead meant every scope opened *during* the load --
  // `stage:` and `session` on the two lines below, and every layer's own --
  // had an `openedAt` older than the mark and was flagged as stale. That was
  // already wrong on every stage switch; it was invisible on the first load
  // only because `lifeFrame` could not advance while the frame loop had not
  // started yet, which step 25 changed.
  p.stageLoadedAt = p.lifeFrame;
  p.stageScope?.dispose();
  p.stageScope = p.appScope.child(`stage:${p.state.stage}`);
  p.ctx.scope = p.stageScope;
  p.newSession();
  if (p.scene3d) {
    p.scene.remove(p.scene3d.root);
    p.scene3d.dispose();
  }
  // The rails go back with the scope now -- `attachTo` takes the group out of
  // the scene and `ownResources` frees the polylines and cone meshes the
  // layer built. Both are below, at the point the new one is made.
  p.cam.rails = null;

  const bundle = await loadStage(entry);
  if (superseded()) return;
  p.paths = new CamPaths(bundle.cam);
  const scene3d = await StageScene.load(bundle.geometryUrl, bundle.script);
  if (superseded()) return scene3d.dispose();
  p.scene3d = scene3d;
  // Honour the per-mesh fog bit and compile the radial-fog variant.
  p.sceneFog.prepare(p.scene3d.root);
  // ...and the same moment for the texture filter: the materials only
  // exist once the glTF is parsed, and the per-mesh sampler it carries is
  // what the `asset` mode puts back.
  p.texFilter.prepare(p.scene3d.root);
  // Adopt the dome models before lighting, so its material swap sees the
  // clones the backdrop made rather than the shared originals.
  p.backdrop.build(p.scene3d.root, p.ctx.scope,
                      bundle.script.backdrop);
  p.rigs.build(p.scene3d.root, bundle.script.rigs, p.paths);
  // The scene reset comes first: it empties the object pool and copies the
  // approach rings into the globals, and `chars.attach` spawns into that
  // pool. Doing it the other way round drops every actor it just made.
  p.world.detach(p.ctx);
  p.ctx.stage = p.state.stage;
  p.ctx.frame = 0;
  p.rng.reseed(p.state.seed ?? 1);
  // `attach` runs the scene reset, which zeroes the data segment -- so the
  // tables go in **after** it. The other way round the reset wiped
  // `g_enemy_approach_rings` seconds after `SetGameTables` filled it, every
  // actor read every ring as zero, and so nothing ever reached striking
  // range: they walked into the camera and spun on a facing angle that has
  // no direction at zero distance.
  p.world.attach(p.ctx);
  p.applyGameTables(bundle.script);
  G.g_player_lives = [
    bundle.script.characters?.player?.start_lives ?? 2,
    bundle.script.characters?.player?.start_lives ?? 2,
  ];
  // Nothing wrote this before, so every run was Arcade whichever bundle was
  // loaded. That stopped being harmless the moment class 0x41 grew a branch
  // on it: `PlaceGenericProp`'s types 70-72 and 77 despawn on their first
  // frame unless the mode is Original, and the whole item hunt is behind it.
  G.g_GameMode = bundle.script.game_mode;
  // Characters are already in the stage glTF, one hierarchy per spawn;
  // this adopts them and takes over the pose.
  // The object paths class 0x25 rides live in the camera bundle; the
  // character layer is the seam the port already reaches the renderer
  // through, so they are handed to it rather than duplicated in `game/`.
  p.chars.paths = p.paths;
  p.coliDebug.build(p.scene3d.root, p.ctx.scope,
                       bundle.script.coli);
  p.stuckDebug.build(p.scene3d.root, p.ctx.scope);
  p.chars.civilians = bundle.script.civilians ?? null;
  p.chars.build(p.scene3d.root, p.ctx.scope,
                   bundle.script.characters);
  p.spawns.setPosed(p.chars.posed);
  // Doors, shutters and the vans they hang off; driven by the script's
  // own flags, so nothing here needs a clock of its own.
  p.props.build(p.scene3d.root, p.ctx.scope, bundle.script.props);
  // Class 0x41's props are built at run time, so only the templates are
  // adopted here; the nodes follow `G.g_breakable_props`.
  p.breakables.adopt(p.scene3d.root);
  p.chars.breakables = p.breakables;
  p.shooting.reset();
  p.shooting.setTables(bundle.script.characters?.combat);
  p.dialogue = bundle.script.sound ?? null;
  p.bullets.source = p.chars;
  p.scene.add(p.bullets.group);
  // Same template source as the weapons: the head that flies is a bone model
  // off the character the shot killed.
  p.heads.source = p.chars;
  p.scene.add(p.heads.group);
  p.shooting.playSound = (id) => { p.bgm.play(id); };
  const rainCfg = bundle.script.rain;
  p.rain.build(p.ctx, p.scene3d.root, rainCfg);
  p.rainSim.configure(
    rainCfg?.enabled_by_script
      ? { fallPerFrame: rainCfg.fall_per_frame,
          respawnBelow: rainCfg.respawn_below, spawn: rainCfg.spawn }
      : null,
    p.rng);
  p.lighting.build(p.scene3d.root);
  p.scene.add(p.scene3d.root);

  // Made per stage, from that stage's curves, and never freed until now: one
  // `Line` per camera path and per object path, each with a geometry and a
  // material of its own, plus the marker cones. Six stage switches was six
  // full sets still on the GPU.
  p.cam.rails = new RailLayer(p.paths);
  attachTo(p.ctx.scope, p.scene, p.cam.rails.group);
  ownResources(p.ctx.scope, p.cam.rails.group);
  // Everything the new stage's layers have to be told about the toggles,
  // in one call. This used to be six checkbox reads that had to be kept in
  // step with the sixteen listeners by hand, and three of them were missing.
  p.applyAllToggles();

  // No seed: the walker draws no random numbers. `?seed=` reseeds the world's
  // generator, `p.rng`, a few lines above -- which is the only random source
  // in the player.
  p.walker = new Walker(bundle.script, makeWalkerHost(p, bundle.script));
  p.script.walker = p.walker;

  // The dialogue table for the stage. The walker carries the group; the words
  // are bundle data and belong here.
  p.hudLayer.messages =
    (g) => screenMessage(bundle.script.sound?.messages?.[String(g)]?.[0] ?? null);
  p.bgm.setTable(bundle.script.bgm, entry.game_mode);
  p.bgm.setSoundTables(bundle.script.sound);
  p.treeProj = treeProjection(bundle.script);
  p.minimapGraphData = minimapGraph(bundle.script);
  p.clearFeed();

  // Decoder warnings are surfaced, not swallowed: a step that failed to
  // disassemble is a hole in the timeline and the user should know.
  //
  // **Both decoders, on one channel.** The script's have travelled in the
  // stage JSON from the beginning; the camera's existed and were read only by
  // `verify_phase6.py`, which runs over the game directory rather than over an
  // export — so a stage whose `cam/` file had a bad descriptor exported with
  // those paths quietly missing, and the camera not moving where it should
  // looked like a gameplay bug. `?? []` because a bundle written before format
  // 4 carries none.
  const decoded: string[] = [
    ...bundle.script.warnings,
    ...(bundle.cam.warnings ?? []).map((w) => `cam: ${w}`),
  ];
  for (const note of decoded) {
    p.onFeed({
      seq: -1, block: -1, step: -1, opIndex: -1,
      op: { i: -1, at: 0, op: -1, name: "decoder warning", cat: "flow" },
      note,
    });
  }

  applyIncomingState(p);
  // No `bgm_entry_play` in any stage script starts the stage's own track --
  // they only switch to boss and transition music -- so the opening track
  // is started here and labelled as not script-driven.
  const st = bundle.script.bgm?.stage_track;
  if (st) p.bgm.play(st.id, "stage");
  p.setLoading(null);
  const status: StatusProjection = {
    text:
      `${entry.name} · ${entry.counts.models} models · ` +
      `${entry.counts.triangles.toLocaleString()} tris · ` +
      `${entry.counts.regions} regions · ${entry.counts.blocks} blocks · ` +
      `${entry.counts.branch_points} branch points`,
    note: "",
    noteTitle: "",
  };
  // A re-export changes the data under a page that looks identical, and a
  // stale bundle is indistinguishable from a bug. Say when this one was
  // built so the two can be told apart.
  if (p.manifest?.built) {
    const built = new Date(p.manifest.built);
    const age = (Date.now() - built.getTime()) / 1000;
    status.noteTitle = `Bundle built ${p.manifest.built} by `
      + `${p.manifest.tool} ${p.manifest.tool_version}`;
    status.note = ` · bundle ${
      age < 3600 ? `${Math.max(0, Math.round(age / 60))} min old`
        : built.toLocaleString()}`;
  }
  p.status = status;
}

/** Honour the deep link: either an op address, or a raw camera pose. */
function applyIncomingState(p: Player): void {
  const w = p.walker;
  if (!w) return;
  if (p.state.slot !== undefined) {
    p.poseFromSlot(p.state.slot, p.state.frame ?? 0);
  } else if (p.state.block !== undefined) {
    const arrived = seekWalkerTo(w, p.state.block, p.state.step ?? 1,
                           p.state.op ?? 0);
    if (!arrived) {
      // The address is not on any route the script can take from the entry
      // block -- a stale link, or a branch this run did not take. Say so
      // rather than silently presenting whatever the replay ran into.
      console.warn(`no route to ${p.state.block}/${p.state.step ?? 1}` +
                   `/${p.state.op ?? 0}; showing ${w.block}/${w.step}` +
                   `/${w.opIndex}`);
    }
    // Land in the same shot, not at the start of it.
    if (p.state.frame !== undefined && w.cam) {
      w.cam.frame = p.state.frame;
    }
    p.syncCameraToWalker(true);
    p.syncBgmToWalker();
  } else {
    w.reset();
    // Instruction 0 of block 0 has entered no region and issued no camera
    // command, so opening there is a truthful black screen. Prime to where
    // the stage actually starts instead.
    w.primeToFirstWait();
    p.syncCameraToWalker(true);
  }
  if (p.state.all) {
    p.toggles = { ...p.toggles, allRegions: true };
    p.scene3d?.setVisibility("all");
  }
  p.markAddress();
}
