/**
 * `render/`, headless.
 *
 * The render layer had no test of its own — `pose.test.ts` covers the poser's
 * arithmetic and nothing covered the layer's *resources*, which is where its
 * bugs actually are: a texture nobody frees looks exactly like a texture
 * somebody frees, right up until the tab is using a gigabyte.
 *
 * three.js core runs under node perfectly well. What it does not have is a
 * DOM, so the one thing that needs one — `labelTexture`'s canvas — is stubbed
 * here, minimally and only for the calls it actually makes. Everything else,
 * including the `CanvasTexture` objects and their real `dispose()`, is the
 * shipping code.
 *
 * Run with `npm run test:render`.
 */

/** Just enough `<canvas>` for `labelTexture`. */
function stubCanvas(): void {
  const ctx2d = {
    font: "", fillStyle: "", textBaseline: "",
    measureText: (t: string) => ({ width: t.length * 14 }),
    fillRect: () => undefined,
    fillText: () => undefined,
  };
  const doc = {
    createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d }),
  };
  (globalThis as unknown as { document: unknown }).document = doc;
}
stubCanvas();

/**
 * Just enough `window` for a layer that installs listeners in its constructor.
 *
 * `FreeRoam` does, because the element it reads is the app's viewport and it
 * outlives every stage. Being a `System` is about `World` owning its **tick**
 * and its **resync**, which is what this file checks; the listeners are still
 * the constructor's and still `dispose()`'s.
 */
function stubWindow(): void {
  const noop = () => undefined;
  (globalThis as unknown as { window: unknown }).window =
    { addEventListener: noop, removeEventListener: noop };
}
stubWindow();

/** The `HTMLElement` `FreeRoam` takes: three listeners and a pointer capture. */
function stubViewport(): unknown {
  return {
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    setPointerCapture: () => undefined,
  };
}

export {};

const { LabelCache } = await import("../src/render/overlays");
const { SceneFog } = await import("../src/render/fog");
const { Backdrop } = await import("../src/render/backdrop");
const { Rain } = await import("../src/render/rain");
const { Scope } = await import("../src/core/scope");
const { ownResources, subtreeResources } = await import("../src/render/scope3d");
const { FreeRoam, isTyping } = await import("../src/render/freeroam");
const { CanvasTexture, Group, Mesh, MeshBasicMaterial, PerspectiveCamera,
        PlaneGeometry, Scene } = await import("three");

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  if (ok) {
    console.log(`  ok    ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`);
  }
}

console.log("\nlabel textures: owned, and bounded");

{
  // **The leak this exists to stop.** `render/debug.ts` keyed its label cache
  // on text that contains `d=${d.toFixed(0)}` — the actor's whole-unit
  // distance from the eye. So every metre every boxed actor moved minted a
  // `CanvasTexture`, in a module-level `Map` that nothing ever disposed, for
  // the life of the page. `render/props.ts` had the same unowned cache.
  // `SpawnLayer` had already fixed the ownership half and neither followed.
  const cache = new LabelCache(8);
  for (let d = 0; d < 500; d++) cache.get(`k${d}`, `zombie d=${d}`, "#fff");
  check("a moving label cannot grow the cache past its cap",
        cache.size === 8, `${cache.size} textures for 500 distinct labels`);

  // Eviction has to dispose, or the cap moves the leak rather than fixing it.
  // three's `Texture.dispose()` dispatches a `dispose` event -- that is what
  // releases the GPU handle -- rather than clearing the object, so the event
  // is the thing to watch.
  const c2 = new LabelCache(2);
  const first = c2.get("a", "a", "#fff");
  let freed = 0;
  first.addEventListener("dispose", () => { freed++; });
  c2.get("b", "b", "#fff");
  c2.get("c", "c", "#fff");           // evicts "a"
  check("...and what it evicts is disposed, not just dropped",
        freed === 1, `${freed} dispose events`);

  // Insertion order is close enough to least-recently-used *if* a hit
  // re-inserts. Without that, the label being drawn every frame is the one
  // evicted, and the cache thrashes at exactly the size it is meant to help.
  const c3 = new LabelCache(2);
  c3.get("x", "x", "#fff");
  c3.get("y", "y", "#fff");
  let xFreed = 0;
  c3.get("x", "x", "#fff").addEventListener("dispose", () => { xFreed++; });
  c3.get("z", "z", "#fff");           // so this evicts y, not x
  check("a label still in use is not the one evicted",
        xFreed === 0 && c3.size === 2, `x freed ${xFreed}, ${c3.size} live`);

  // And the stage scope's half: everything goes back at once.
  const c4 = new LabelCache();
  let keptFreed = 0;
  c4.get("q", "q", "#fff").addEventListener("dispose", () => { keptFreed++; });
  c4.get("r", "r", "#fff");
  c4.dispose();
  check("dispose frees every texture and empties the cache",
        c4.size === 0 && keptFreed === 1,
        `${c4.size} left, ${keptFreed} freed`);
}

console.log("\nthe fog hook survives a late clone");

{
  // `SceneFog.prepare` is the only thing that puts the radial-fog uniform on
  // a material, and it runs once, over the stage tree, in `stage_load.ts`.
  // Both `Backdrop` and `Rain` then *clone* materials out of that tree --
  // after `prepare` has been and gone -- and `Material.copy` does not copy
  // `onBeforeCompile`. So the dome and the rain compiled without the uniform
  // and fogged planar while everything around them fogged radial: the sky
  // banded differently as the camera turned.
  //
  // The assertion is on the own property rather than on the function, because
  // three puts a no-op `onBeforeCompile` on the prototype. Inheriting it is
  // exactly the failure.
  const hooked = (o: object) =>
    Object.prototype.hasOwnProperty.call(o, "onBeforeCompile");

  const slotted = (slot: number) => {
    const mesh = new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial());
    mesh.userData = { hod2_slot: slot };
    const root = new Group();
    root.add(mesh);
    return root;
  };

  const fog = new SceneFog(new Scene());

  {
    const root = slotted(7);
    fog.prepare(root);
    check("prepare hooks what is in the stage tree",
          hooked(((root.children[0] as InstanceType<typeof Mesh>)
            .material as object)));

    const backdrop = new Backdrop();
    backdrop.build(root, new Scope("stage"), {
      presets: [{ preset: 0, slot_a: 7, slot_b: 0, dy: 0,
                  spin_bams: 0, angle0_bams: 0 }],
      used: [0], note: "",
    });
    const mats: object[] = [];
    backdrop.group.traverse((o) => {
      const m = (o as InstanceType<typeof Mesh>).material;
      if (m) mats.push(m as object);
    });
    check("the dome's clones keep it", mats.length > 0 && mats.every(hooked),
          `${mats.filter(hooked).length} of ${mats.length} hooked`);
  }

  {
    const root = slotted(0x53);
    fog.prepare(root);
    const rain = new Rain();
    // `build` reads nothing off the context but the scope.
    const ctx = { scope: new Scope("stage") } as unknown as
      Parameters<typeof rain.build>[0];
    rain.build(ctx, root, {
      slot: 0x53, file: null, entry: null, count: 3,
      fall_per_frame: 2, respawn_below: -7,
      spawn: { x: [20, -10], y: [50, -25], z: [25, -35] },
      scale: [1.5, 3.5, 1], roll_bams: 0x100, alpha: 0.5,
      draw_layer: 0xe, enabled_by_script: 1,
    });
    const mats: object[] = [];
    rain.group.traverse((o) => {
      const m = (o as InstanceType<typeof Mesh>).material;
      if (m) mats.push(m as object);
    });
    check("and so do the rain drops'", mats.length > 0 && mats.every(hooked),
          `${mats.filter(hooked).length} of ${mats.length} hooked`);
  }
}

console.log("\nwhat a subtree is holding");

{
  // `StageScene.dispose` had its own loop over meshes, freeing geometries and
  // materials and never looking at a **texture**. On a stage of 2,200
  // materials the textures are nearly all of the memory, so a stage switch
  // handed back the cheap half and kept the expensive one. It goes through the
  // same walk `ownResources` does now, and this is that walk.
  const tex = new CanvasTexture(
    (globalThis as unknown as { document: { createElement: () => never } })
      .document.createElement());
  const mat = new MeshBasicMaterial();
  mat.map = tex;
  const mesh = new Mesh(new PlaneGeometry(1, 1), mat);
  // Two meshes sharing one material and one geometry: disposing either twice
  // is what empties half the next stage.
  const twin = new Mesh(mesh.geometry, mat);
  const root = new Group();
  root.add(mesh, twin);

  const held = subtreeResources(root);
  check("the walk sees the textures a material carries",
        held.textures.has(tex), `${held.textures.size} textures`);
  check("...and counts a shared geometry and material once each",
        held.geometries.size === 1 && held.materials.size === 1,
        `${held.geometries.size} geometries, ${held.materials.size} materials`);

  const scope = new Scope("stage");
  ownResources(scope, root);
  let freed = 0;
  tex.addEventListener("dispose", () => { freed++; });
  scope.dispose();
  check("and a scope that owns the subtree frees the texture exactly once",
        freed === 1, `${freed} dispose events`);
}

console.log("\nwhose keystroke is it");

{
  // The page's shortcuts are suppressed while a control has focus. `BUTTON`
  // was missing, and buttons are the one focusable thing the browser
  // **activates on Space** -- so Space with the play button focused ran the
  // shortcut and clicked the button, and playback toggled twice, which reads
  // as the key doing nothing.
  const el = (tagName: string, contentEditable = false) =>
    ({ tagName, isContentEditable: contentEditable }) as unknown as EventTarget;

  for (const tag of ["INPUT", "TEXTAREA", "SELECT", "BUTTON"]) {
    check(`${tag} keeps its own keys`, isTyping(el(tag)));
  }
  check("a contenteditable does too", isTyping(el("DIV", true)));
  check("and an ordinary element does not", !isTyping(el("DIV")));
  check("nor does a keystroke with no target", !isTyping(null));
}

console.log("\nfree roam: a system, so a rebuild reaches it");

{
  // The bug the `layers-are-systems` rule is about. `FreeRoam` was ticked by
  // hand out of `Player.frame`, so `world.resync` -- the one call a seek and a
  // snapshot load both make -- never reached it, and the camera was left
  // wherever the previous state's last frame had put it.
  const roam = new FreeRoam(stubViewport() as HTMLElement);
  const camera = new PerspectiveCamera(41.1, 4 / 3, 0.8, 8000);
  // The one field of `RenderContext` this layer reads. Nothing else in a
  // context is a camera, so a partial one is honest here rather than a stub.
  type Ctx = Parameters<typeof roam.resync>[0];
  const ctx = { camera } as unknown as Ctx;

  check("it is a system with an id", roam.id === "render.freeroam", roam.id);

  // Off, its own pose is derived from the camera on every resync -- which is
  // what makes entering free roam after a seek start from the shot the seek
  // produced, rather than from wherever it was left last time.
  camera.position.set(100, 20, -300);
  camera.updateMatrixWorld(true);
  roam.resync(ctx);
  check("resync with free roam off adopts the scripted camera",
        camera.position.x === 100 && camera.position.z === -300,
        `${camera.position.toArray().join(",")}`);

  // On, it is the last word: the resync puts the camera back where the viewer
  // flew it, whatever replaced the game state underneath.
  roam.enabled = true;
  camera.position.set(-7, -7, -7);
  roam.resync(ctx);
  check("...and with it on, resync re-places the camera from its own pose",
        camera.position.x === 100 && camera.position.y === 20
        && camera.position.z === -300,
        `${camera.position.toArray().join(",")}`);

  // And the tick is `World`'s, on the tick's own wall clock. Nothing is
  // pressed, so a tick must move nothing -- the assertion that the update
  // reads `t.wall` and not a captured delta.
  roam.update(ctx, { dt: 0, frames: 0, wall: 1, frozen: true });
  check("a tick with no key down moves nothing",
        camera.position.x === 100 && camera.position.z === -300,
        `${camera.position.toArray().join(",")}`);

  roam.dispose();
}

/**
 * The spawn split step 21 made: renderer asks, port decides, `app/` composes.
 *
 * `CharacterLayer.syncSpawns` used to call `ActorSpawn` and
 * `DescriptorFromPlacement` itself, which put `SpawnFromDescriptor`
 * (`FUN_00408A20`) — the engine's object lifetime, the class `Init` and the
 * hit-point roll — inside a renderer. It is three calls now and this drives
 * all three, because the seam is easy to get subtly wrong: an `at` that is
 * ready but never adopted draws nothing, and one adopted twice lives its whole
 * life over and over.
 */
console.log("\ncharacter spawns: readySpawns -> the port -> adopt");
{
  const { CharacterLayer } = await import("../src/render/characters");
  const { SpawnScriptedCharacters, RetireUnlistedActor } =
    await import("../src/game/director");
  const { G, ResetGameGlobals } = await import("../src/game/globals");
  const { SetGameTables } = await import("../src/game/tables");
  const { Object3D } = await import("three");

  // The exporter's own node shape: one `rig` per spawn descriptor, one
  // `rig_part` per bone, named `<rig>_<part>`.
  const TYPE = {
    type: 1, name: "test", file: "t.bin", bone_count: 2, actor_radius: 10,
    bones: [{ bone: 0, part: "bone00_1", slot: 1, offset: [0, 0, 0],
              parent: null, damage_rank: [], hit_radius: 2, steps: [] }],
    head_bone: 2, reactions: {}, attacks: {}, motions: { "10": {} },
  };
  const PLACE = {
    at: 0x100, class: 0x30, char_type: 1, motion: 10, hp: 7, yaw: 0x2000,
    body_condition: 0, initial_state: 0, attack_state: 0, ring_set: 0,
  };
  const CHARS = {
    types: { "1": TYPE }, placements: [PLACE],
    approach: { rings: [{ inner: 25, mid: 38, outer: 51 }],
                steps: { base: 2, mid_add: 3, outer_add: 4 },
                ring_set_for_char0: 1 },
    difficulty: { hp_delta: [0, 0, 5, 0, 0], hp_min: 1, hp_max: 300,
                  initial_rank: [0, 0, 2, 0, 0], default: 2 },
  };

  const root = new Object3D();
  const rig = new Object3D();
  rig.name = "chr_test_spawn000";
  rig.userData = { hod2_kind: "rig", hod2_rig: "chr_test", hod2_spawn_at: 0x100 };
  rig.position.set(11, 22, 33);
  const bone = new Object3D();
  bone.name = "chr_test_spawn000_bone00_1";
  rig.add(bone);
  root.add(rig);

  ResetGameGlobals();
  SetGameTables(CHARS as never);
  G.g_difficulty = 2;

  const chars = new CharacterLayer();
  const stage = new Scope("stage");
  chars.build(root, stage, CHARS as never);

  // Nothing is a game object until the script's spawn opcode has run: the
  // hierarchy is adopted at build, and that is all.
  check("building the scene makes no game object", G.g_object_list.length === 0,
        `${G.g_object_list.length}`);
  check("...and no spawn is ready until the script lists it",
        chars.readySpawns([]).length === 0);

  const listed = [{ at: 0x100 }];
  const ready = chars.readySpawns(listed);
  check("a listed spawn is ready, with the position only the glTF has",
        ready.length === 1 && ready[0].pos.x === 11 && ready[0].pos.z === 33,
        JSON.stringify(ready));
  check("...and the motion the placement authored", ready[0].motion === 10);

  const made = SpawnScriptedCharacters(ready);
  check("the port makes exactly one object", made.length === 1
        && G.g_object_list.length === 1, `${G.g_object_list.length}`);
  const a = made[0];
  check("it carries the descriptor's class and the type's name",
        a.cls === 0x30 && a.name === "test", `${a.cls} ${a.name}`);
  check("`ActorInitHitPoints` added the difficulty delta", a.hp === 12,
        `hp ${a.hp}`);
  check("and the placement's yaw and the scene's position",
        a.yaw === 0x2000 && a.pos.x === 11 && a.pos.z === 33,
        `${a.yaw} ${JSON.stringify(a.pos)}`);

  chars.syncSpawns(listed, made);
  check("the layer adopted it, so nothing is ready twice",
        chars.readySpawns(listed).length === 0);
  check("...and a second pass makes no second object",
        SpawnScriptedCharacters(chars.readySpawns(listed)).length === 0
        && G.g_object_list.length === 1, `${G.g_object_list.length}`);

  // ...and out again. The layer hands the actor back; `app/` retires it
  // through the port, which is the direction the whole split runs in.
  const gone = chars.syncSpawns([], []);
  check("dropping it from the script hands the actor back",
        gone.length === 1 && gone[0] === a, `${gone.length}`);
  for (const o of gone) RetireUnlistedActor(o);
  check("...and retiring it takes it out of the world",
        a.despawned && !a.visible);
  check("and the hierarchy is placeable again",
        chars.readySpawns(listed).length === 1);

  stage.dispose();
}

/**
 * B3: an actor drawn before it simulates.
 *
 * `hod2_kind: "rig"` is the exporter's tag for **every** transcribed hierarchy
 * in a stage, and four layers own different sets of them — `RigLayer` the
 * `op_` path riders, `CharacterLayer` the `chr_` skeletons and their `gore_`
 * templates, `PropLayer` the `prop_` doors, `BreakableLayer` the slot
 * templates. `RigLayer` used to adopt all of them and write `root.visible` on
 * every one once a frame; a rig with no route is ungated, so the first
 * instance of each character type was shown at its authored spawn point, in
 * the bind pose, with no game object behind it.
 *
 * The rule this pins down: **a layer may only place the nodes its own bundle
 * block names.** `rigs.rigs[].name` is that index source.
 */
console.log("\nrig layer: only the rigs its own block names");
{
  const { RigLayer } = await import("../src/render/rigs");
  const { CharacterLayer } = await import("../src/render/characters");
  const { Scope } = await import("../src/core/scope");
  const { Object3D } = await import("three");

  const TYPE = {
    type: 1, name: "test", file: "t.bin", bone_count: 2, actor_radius: 10,
    bones: [{ bone: 0, part: "bone00_1", slot: 1, offset: [0, 0, 0],
              parent: null, damage_rank: [], hit_radius: 2, steps: [] }],
    head_bone: 2, reactions: {}, attacks: {}, motions: { "10": {} },
  };
  const CHARS = {
    types: { "1": TYPE },
    placements: [
      { at: 0x100, class: 0x30, char_type: 1, motion: 10, hp: 7, yaw: 0,
        body_condition: 0, initial_state: 0, attack_state: 0, ring_set: 0 },
      // ...and one the bundle cannot pose: no motion, so `build` rejects it.
      { at: 0x200, class: 0x30, char_type: 1, motion: null, hp: 7, yaw: 0,
        body_condition: 0, initial_state: 0, attack_state: 0, ring_set: 0 },
    ],
  };

  const root = new Object3D();
  const chrRig = (at: number, name: string): InstanceType<typeof Object3D> => {
    const rig = new Object3D();
    rig.name = name;
    rig.userData = { hod2_kind: "rig", hod2_rig: "chr_test",
                     hod2_spawn_at: at };
    const bone = new Object3D();
    bone.name = `${name}_bone00_1`;
    rig.add(bone);
    root.add(rig);
    return rig;
  };
  const posed = chrRig(0x100, "chr_test_spawn000");
  const unposed = chrRig(0x200, "chr_test_spawn001");

  // The damaged-part templates ride in a rig of their own, and they are not
  // this layer's either.
  const gore = new Object3D();
  gore.name = "gore_test_fixed000";
  gore.userData = { hod2_kind: "rig", hod2_rig: "gore_test" };
  root.add(gore);

  // ...and one rig that really is `RigLayer`'s, because the block names it.
  const owned = new Object3D();
  owned.name = "obj_dead00_fixed000";
  owned.userData = { hod2_kind: "rig", hod2_rig: "obj_dead00" };
  root.add(owned);

  const chars = new CharacterLayer();
  const stage = new Scope("stage");
  chars.build(root, stage, CHARS as never);
  check("a character with no motion is rejected and left hidden",
        !unposed.visible);
  check("...and one the layer adopted is hidden until its opcode runs",
        !posed.visible);

  const rigs = new RigLayer();
  rigs.build(root, { rigs: [{ name: "obj_dead00", routes: [] }] } as never,
             { objectPaths: new Map() } as never);
  check("the layer adopts only the rigs its block names", rigs.count === 1,
        `${rigs.count} of 4 tagged nodes`);
  check("...so the panel lists rigs, not characters",
        !rigs.list.some((r) => r.name.startsWith("chr_")),
        rigs.list.map((r) => r.name).join(","));

  rigs.update({ walker: null } as never);
  check("a frame of the rig layer does not draw an unspawned character",
        !posed.visible && !unposed.visible,
        `${posed.visible} ${unposed.visible}`);
  check("...nor the hidden damaged-part templates", !gore.visible);
  check("and its own rig is placed", owned.visible);

  stage.dispose();
}

/**
 * B10: "the zombie loses its midriff on one shot".
 *
 * `SkeletonDrawNodeSlot` (`FUN_00411050`) hands `record[bone].slot` to
 * `AssetDrawSlot` (`FUN_00418560`), which draws **one whole model**;
 * `WalkMeshChainAndDraw` walks every mesh in its chain. The exporter writes
 * that chain as one glTF node with one primitive per mesh, so a swap that
 * takes only the first primitive draws a fraction of the damaged part. All 57
 * of `char_adv02`'s damaged variants are multi-primitive and eight of its
 * fifteen bones are single-primitive nodes, which is exactly the pairing that
 * used to go wrong.
 */
console.log("\ngore swap: the whole damaged model, both shapes of bone");
{
  const { swapGore, restoreGore } =
    await import("../src/render/characters/gore");
  const { BufferGeometry, Mesh, MeshBasicMaterial, Object3D } =
    await import("three");

  type Node = InstanceType<typeof Object3D>;
  type MeshNode = InstanceType<typeof Mesh>;

  /** The geometries a subtree would actually put on screen. */
  const drawn = (node: Node): Set<unknown> => {
    const out = new Set<unknown>();
    node.traverseVisible((o) => {
      if ((o as MeshNode).isMesh) out.add((o as MeshNode).geometry);
    });
    return out;
  };
  const mesh = (): MeshNode =>
    new Mesh(new BufferGeometry(), new MeshBasicMaterial());

  // One damaged part, three meshes in its chain.
  const tmpl = new Object3D();
  tmpl.name = "gore_test_fixed000_gore_0041";
  const prims = [mesh(), mesh(), mesh()];
  for (const p of prims) tmpl.add(p);
  const parts = new Map<number, Node>([[0x41, tmpl]]);
  const want = new Set<unknown>(prims.map((p) => p.geometry));

  // -- a single-primitive bone: glTF loads it as a `Mesh` and its child bone
  //    hangs off it, so the node itself cannot be hidden.
  {
    const bone = mesh();
    const own = bone.geometry;
    const child = mesh();                       // the child *bone*, not a part
    bone.add(child);
    const inst = { bones: new Map<number, Node>([[3, bone], [4, child]]),
                   gore: new Map() };
    check("a single-primitive bone swaps",
          swapGore(parts, inst as never, 3, 0x41));
    const shown = drawn(bone);
    check("...and draws all three meshes of the damaged part",
          [...want].every((g) => shown.has(g)),
          `${shown.size} drawn, ${want.size} wanted`);
    check("...without leaving its own model in the picture",
          !shown.has(own));
    check("...and without disturbing the child bone",
          child.visible && child.parent === bone && shown.has(child.geometry));

    // The escalating hit: swapped again, the additions are replaced and the
    // pristine model is still the one a seek puts back.
    swapGore(parts, inst as never, 3, 0x41);
    check("a second swap does not stack a second copy",
          drawn(bone).size === want.size + 1, `${drawn(bone).size}`);
    for (const [b, g] of inst.gore) restoreGore(inst as never, b, g);
    const back = drawn(bone);
    check("restoring puts the bone's own model back and takes the part off",
          back.has(own) && back.size === 2
          && ![...want].some((g) => back.has(g)), `${back.size}`);
  }

  // -- a multi-primitive bone: a `Group` whose children are its own primitives
  //    *and* its child bones. Only the first kind may be hidden.
  {
    const bone = new Object3D();
    const ownPrims = [mesh(), mesh()];
    for (const p of ownPrims) bone.add(p);
    const child = mesh();
    bone.add(child);
    const inst = { bones: new Map<number, Node>([[1, bone], [2, child]]),
                   gore: new Map() };
    check("a multi-primitive bone swaps",
          swapGore(parts, inst as never, 1, 0x41));
    const shown = drawn(bone);
    check("...drawing the whole damaged part",
          [...want].every((g) => shown.has(g)), `${shown.size}`);
    check("...with its own primitives hidden",
          !ownPrims.some((p) => shown.has(p.geometry)));
    check("...and the limb below it still drawn",
          shown.has(child.geometry));
    for (const [b, g] of inst.gore) restoreGore(inst as never, b, g);
    check("restoring takes the clone off again",
          ![...want].some((g) => drawn(bone).has(g)));
  }
}

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
