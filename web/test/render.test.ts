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
  // `document` is also where the Pointer Lock API lives, and `FreeRoam`
  // listens on it -- see `stubWindow` below for why a constructor's listeners
  // are stubbed rather than avoided. `exitPointerLock` counts its calls,
  // because "leaving free roam releases the pointer" is a thing this file can
  // check without a browser.
  const doc = {
    createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d }),
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    pointerLockElement: null as unknown,
    exits: 0,
    exitPointerLock() { this.exits++; },
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
    requestPointerLock: () => undefined,
  };
}

export {};

const { LabelCache } = await import("../src/render/overlays");
const { SceneFog } = await import("../src/render/fog");
const { Backdrop } = await import("../src/render/backdrop");
const { Rain } = await import("../src/render/rain");
const { Scope } = await import("../src/core/scope");
const { ownResources, subtreeResources } = await import("../src/render/scope3d");
const { FreeRoam, isTyping, ownsKey }
  = await import("../src/render/freeroam");
const { RigLayer } = await import("../src/render/rigs");
const { CamPaths } = await import("../src/game/camera/curve");
const { AmbientLight, CanvasTexture, DirectionalLight, Group, Mesh,
        MeshBasicMaterial, PerspectiveCamera, PlaneGeometry, Scene,
        ShaderChunk } = await import("three");
const { SceneLighting, lightDirection, DIFFUSE_SCALE, LIGHT_AMBIENT_SCALE }
  = await import("../src/render/lighting");
const { SlotModelLayer } = await import("../src/render/slotmodels");
const { EffectLayer } = await import("../src/render/effects");
const { BloodColourLayer } = await import("../src/render/bloodcolour");
const { FLASH_SMOKE_SCALE, FLASH_SMOKE_SCALE_KIND4 }
  = await import("../src/game/effects/shot_effects");
const { G, ResetGameGlobals } = await import("../src/game/globals");
const { makeActor } = await import("../src/game/actor");
const { SpawnClass } = await import("../src/game/spawn_class");
const { MOUSE_FIRST_SLOT, MOUSE_HIT_RADIUS }
  = await import("../src/game/class52");
const { T } = await import("../src/game/tables");
const { Object3D: Obj3D, Ray, Vector3 } = await import("three");

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

console.log("\nthe fog colour is the game's colour");

{
  // The bug this catches shipped for months and is invisible unless you sample
  // a pixel: `Color.setRGB` defaults to the **linear-sRGB working space**, so
  // handing it the game's D3DCOLOR bytes claimed they were already linear and
  // the renderer encoded them a second time on the way out. Stage 3's
  // RGB(10,10,20) fog reached the screen as RGB(56,56,79) -- four times too
  // bright, with the blue washed out of it, because the sRGB curve turns a 2:1
  // ratio into 1.4:1.
  //
  // `describe` is the hook: `getHexString()` defaults to `SRGBColorSpace`, so
  // it converts back out of the working space and reports what a screenshot
  // would show. Round-tripping through it is exactly the assertion.
  const walkerWith = (rgb: [number, number, number], near = 21, far = 507) =>
    ({ walker: { fog: { near, far, rgb }, fogSet: true } }) as unknown as
      Parameters<InstanceType<typeof SceneFog>["update"]>[0];

  const fog = new SceneFog(new Scene());

  // Every distinct fog colour the six shipped stage scripts set, dark end
  // first -- the dark end is where the error is worst and where this game
  // spends its time.
  for (const rgb of [[10, 10, 20], [0, 0, 37], [12, 10, 8], [0, 25, 52],
                     [40, 36, 11], [28, 36, 52], [101, 102, 105],
                     [0, 140, 255], [197, 196, 255]] as [number, number,
                                                         number][]) {
    const want = rgb.map((c) => c.toString(16).padStart(2, "0")).join("");
    fog.update(walkerWith(rgb));
    check(`RGB(${rgb.join(",")}) survives the round trip`,
          fog.describe.endsWith(`#${want}`), fog.describe);
  }

  // The near/far doubling `SetFogRange` (`FUN_004ABDF0`) does, which is the
  // other half of the same push and the one that was already right.
  fog.update(walkerWith([10, 10, 20], 21, 507));
  check("...and the range is still the doubled one the exe sets",
        fog.describe.includes("42..1014"), fog.describe);

  // Planar is what per-pixel table fog does, so it is the default; radial is
  // the declared divergence and must be chosen, never inherited.
  check("the default mode is the game's planar falloff",
        new SceneFog(new Scene()).fogMode === "planar",
        new SceneFog(new Scene()).fogMode);
}

console.log("\nthe fog range is `SetFogRange`'s pair, in either order");

{
  // `SetFogRange` (`FUN_004ABDF0`) doubles both values and, when
  // `near*2 >= far*2`, **swaps them** -- `FCOMP` / `JZ` at 0x004ABE04, the
  // swapped arm at 0x004ABE34 writing `FOGSTART = far*2, FOGEND = near*2`.
  // There is no on/off test anywhere in it.
  //
  // The port had one: `far > near`. Two things that costs, both of them
  // things the six shipped scripts actually do:
  //
  //   * 40 sites set `fog_near = fog_far = 1` with a black fog colour and
  //     then tween out of it, or tween *into* it. That is the fade every
  //     stage opens and closes with, and a zero-width `D3DFOG_LINEAR` ramp is
  //     a step -- everything past it is 100% fog. Fog off showed the scene.
  //   * stage 5 blocks 7 and 9 set `near 1472, far 614`. The engine fogs
  //     1228..2944; the port fogged nothing.
  //
  // Asserted on `scene.fog` -- what the renderer will actually hand the
  // shader -- rather than on `describe`, which is a sentence about it.
  const scene = new Scene();
  const fog = new SceneFog(scene);
  const drive = (near: number, far: number) => {
    fog.update(({ walker: { fog: { near, far, rgb: [10, 10, 20] },
                            fogSet: true } }) as unknown as
      Parameters<InstanceType<typeof SceneFog>["update"]>[0]);
    return scene.fog as { near: number; far: number } | null;
  };

  const ordered = drive(21, 507);
  check("an ordered pair is doubled and kept in order",
        ordered?.near === 42 && ordered?.far === 1014,
        JSON.stringify(ordered));

  // Stage 5 block 9 step 1, `light0_set fog_near 1472 / fog_far 614`.
  const swapped = drive(1472, 614);
  check("a reversed pair is swapped, not switched off",
        swapped !== null && swapped.near === 1228 && swapped.far === 2944,
        JSON.stringify(swapped));

  // Stage 3 block 0 step 1, and 39 other sites: the fade.
  const flat = drive(1, 1);
  check("near == far leaves fog on, as a step at near*2",
        flat !== null && flat.near === 2 && flat.far > 2 && flat.far < 2.001,
        JSON.stringify(flat));
  // `(d - near) / (far - near)` with `far == near` is `0/0` at `d == near`,
  // and GLSL's `clamp` is not required to do anything sensible with a NaN.
  // The hair of width is what avoids it; the result is still a step.
  check("...and the width is a hair rather than zero, so the shader cannot NaN",
        flat !== null && flat.far - flat.near > 0);

  // A negative near is real -- six sites, down to -1306 -- and must not be
  // mistaken for "off" either.
  const behind = drive(-600, 1800);
  check("a near behind the eye is a range like any other",
        behind?.near === -1200 && behind?.far === 3600,
        JSON.stringify(behind));

  // The port's own guard, and the only one: the pre-script default stands in
  // for the range `FUN_00460250` seeds, and must not paint the background.
  check("the pre-script default is past the far plane and draws no fog",
        drive(65000, 65001) === null);
}

console.log("\nthe fog blend happens in the space D3D blends in");

{
  // D3D7 fixed-function fog is `f*C_pixel + (1-f)*C_fog` on framebuffer bytes;
  // there is no sRGB write path in DX7. three.js mixes in linear and encodes
  // afterwards, which is a different sum -- about 10/255 too bright over a
  // dark surface at half fog. `patchShaderChunk` rewrites the chunk to encode,
  // mix and decode.
  //
  // Asserting on the GLSL text is unlovely, but the alternative is a GL
  // context, and the failure mode being guarded against is three.js changing
  // the chunk under us -- which is a *text* change, and which the code already
  // warns about rather than throwing on. A silent fallback needs a test that
  // sees it.
  const frag = ShaderChunk.fog_fragment;
  check("the fog factor is D3DFOG_LINEAR's straight ramp, not smoothstep",
        frag.includes("( vFogDepth - fogNear ) / ( fogFar - fogNear )")
        && !frag.includes("smoothstep"), frag.trim().split("\n").pop());
  check("...and the mix runs on encoded values, both sides",
        frag.includes("hod2SrgbDecode( mix(")
        && frag.includes("hod2SrgbEncode( gl_FragColor.rgb )")
        && frag.includes("hod2SrgbEncode( fogColor )"), frag);
  check("...with the transfer pair declared where the chunk can see it",
        ShaderChunk.fog_pars_fragment.includes("vec3 hod2SrgbEncode(")
        && ShaderChunk.fog_pars_fragment.includes("vec3 hod2SrgbDecode("));

  // The arithmetic the shader now does, in JS, against the arithmetic the
  // hardware did. If these two ever disagree the constants are wrong.
  const enc = (c: number) => c <= 0.0031308 ? c * 12.92
                                            : 1.055 * c ** 0.41666 - 0.055;
  const dec = (c: number) => c <= 0.04045 ? c / 12.92
                                          : ((c + 0.055) / 1.055) ** 2.4;
  const surf = 70 / 255, fogc = 10 / 255, f = 0.5;
  // What D3D put in the framebuffer: the lerp, on bytes.
  const d3d = Math.round(255 * ((1 - f) * surf + f * fogc));
  // What the patched shader produces, re-encoded by the renderer's output.
  const ours = Math.round(255 * enc(dec(
    (1 - f) * enc(dec(surf)) + f * enc(dec(fogc)))));
  check("half fog over a dark surface lands where the hardware put it",
        Math.abs(d3d - ours) <= 1, `D3D ${d3d}, port ${ours}`);
}

console.log("\nthe scene light is the light SetLightingDefaultSingle builds");

{
  // `SetLightingDefaultSingle` (`0x004AA120`), from the disassembly because
  // the decompiler drops every FPU argument in it:
  //
  //   t = colour * ambient
  //   D3DRENDERSTATE_AMBIENT = pack(t * 255)      <- TINTED by the colour
  //   light.diffuse          = t * 1.4            <- scaled by ambient too
  //   light.ambient          = colour * 0.3       <- and this one is not
  //
  // The port had `diffuse = colour * 1.4` (no ambient) and
  // `ambient = <scalar> + colour * 0.3` (untinted). Both are checked here
  // against the engine's own default light colour, which is where the
  // difference is loudest.
  const srgbToLinear = (c: number) =>
    c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-4;

  const lights = new SceneLighting(new Scene());
  const dir = lights.group.children.find(
    (o) => (o as { isDirectionalLight?: boolean }).isDirectionalLight,
  ) as InstanceType<typeof DirectionalLight>;
  const amb = lights.group.children.find(
    (o) => (o as { isAmbientLight?: boolean }).isAmbientLight,
  ) as InstanceType<typeof AmbientLight>;
  check("the layer has one directional light and one ambient",
        !!dir && !!amb);

  // `FUN_00460250` seeds the scene light colour to exactly this.
  const rgb: [number, number, number] = [1.0, 0.2, 0.1];
  const a = 0.5;
  lights.set({ rgb, ambient: a, pitchDeg: 0, yawDeg: 0 });

  const wantDir = rgb.map((c) => srgbToLinear(c * a * DIFFUSE_SCALE));
  check("diffuse is colour * ambient * 1.4, through the sRGB transfer",
        near(dir.color.r, wantDir[0]) && near(dir.color.g, wantDir[1])
        && near(dir.color.b, wantDir[2]),
        `${dir.color.r},${dir.color.g},${dir.color.b} want ${wantDir}`);

  const wantAmb = rgb.map((c) => srgbToLinear(c * (a + LIGHT_AMBIENT_SCALE)));
  check("...and ambient is colour * (ambient + 0.3), tinted on both terms",
        near(amb.color.r, wantAmb[0]) && near(amb.color.g, wantAmb[1])
        && near(amb.color.b, wantAmb[2]),
        `${amb.color.r},${amb.color.g},${amb.color.b} want ${wantAmb}`);

  // The signature of the bug, stated as a property rather than a number: the
  // engine's light is deep orange, so its ambient must stay deep orange. The
  // old `ambient + colour*0.3` gave (0.8, 0.56, 0.53) -- near-grey.
  check("...so a strongly tinted light keeps a strongly tinted ambient",
        amb.color.g < amb.color.r * 0.2 && amb.color.b < amb.color.r * 0.1,
        `r=${amb.color.r.toFixed(3)} g=${amb.color.g.toFixed(3)} `
        + `b=${amb.color.b.toFixed(3)}`);

  // Turning the master brightness down must dim the directional light with
  // it -- the property the port was missing entirely.
  const wasR = dir.color.r;
  lights.set({ rgb, ambient: a / 2, pitchDeg: 0, yawDeg: 0 });
  check("the ambient channel is a master brightness and dims the light too",
        dir.color.r < wasR * 0.5,
        `${wasR.toFixed(4)} -> ${dir.color.r.toFixed(4)}`);

  // `BuildSceneLightDirection` (`0x0040E0B0`): rotate (0,0,1) by Y then X,
  // giving (cos p · sin y, −sin p, cos p · cos y), the direction the light
  // comes *from*.
  const d = lightDirection(0, 90);
  check("the direction is the rotated unit Z, and +90 deg yaw faces +X",
        near(d.x, 1) && near(d.y, 0) && Math.abs(d.z) < 1e-4,
        `${d.x.toFixed(3)},${d.y.toFixed(3)},${d.z.toFixed(3)}`);
  const dp = lightDirection(90, 0);
  check("...and a +90 deg pitch points straight down",
        near(dp.y, -1), `${dp.y.toFixed(3)}`);
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
  // A focused control keeps the keys it acts on **and no others**, and both
  // halves of that have been wrong. `BUTTON` was missing, and buttons are the
  // one focusable thing the browser *activates on Space* -- so Space with the
  // play button focused ran the shortcut and clicked the button, and playback
  // toggled twice, which reads as the key doing nothing. Adding `BUTTON` to
  // `isTyping` fixed that and broke something larger: free roam is entered by
  // clicking the Free roam button, which then holds focus, so every WASD
  // keystroke afterwards had a `BUTTON` as its target and was dropped. The
  // camera did not move, and the report read "as if some other element is
  // capturing the keys".
  //
  // So the question is asked about the key as well as the element.
  // `web/tools/freeroam.mjs` is the same property on the real page, with a
  // real click deciding what has focus.
  const el = (tagName: string, contentEditable = false, type = "") =>
    ({ tagName, isContentEditable: contentEditable, type }) as unknown as EventTarget;

  for (const tag of ["INPUT", "TEXTAREA", "SELECT"]) {
    check(`${tag} keeps its own keys`, isTyping(el(tag))
          && ownsKey(el(tag), "KeyW"));
  }
  check("a contenteditable does too",
        isTyping(el("DIV", true)) && ownsKey(el("DIV", true), "KeyW"));
  check("and an ordinary element does not", !isTyping(el("DIV")));
  check("nor does a keystroke with no target", !isTyping(null));

  // The control cases: not typing, and claiming only what they act on.
  check("a BUTTON keeps Space and Enter",
        ownsKey(el("BUTTON"), "Space") && ownsKey(el("BUTTON"), "Enter"));
  check("...and does not keep W", !isTyping(el("BUTTON"))
        && !ownsKey(el("BUTTON"), "KeyW"));
  check("a checkbox keeps Space and not W",
        ownsKey(el("INPUT", false, "checkbox"), "Space")
        && !ownsKey(el("INPUT", false, "checkbox"), "KeyW"));
  check("a range keeps the arrows, which the transport binds too",
        ownsKey(el("INPUT", false, "range"), "ArrowLeft")
        && !ownsKey(el("INPUT", false, "range"), "KeyW"));
  check("a search box is typing, whatever its type says",
        isTyping(el("INPUT", false, "search"))
        && ownsKey(el("INPUT", false, "search"), "KeyW"));
}

console.log("\nfree roam: a system, so a rebuild reaches it");

{
  // The bug the `layers-are-systems` rule is about. `FreeRoam` was ticked by
  // hand out of `Player.frame`, so `world.resync` -- the one call a seek and a
  // snapshot load both make -- never reached it, and the camera was left
  // wherever the previous state's last frame had put it.
  const viewport = stubViewport() as HTMLElement;
  const roam = new FreeRoam(viewport);
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

  // Leaving free roam has to let the pointer go, or the viewer is left with a
  // captured cursor over a mode that does not use it. `enabled` is an accessor
  // for exactly this reason; the browser half is `web/tools/freeroam.mjs`.
  const doc = document as unknown as
    { exits: number; pointerLockElement: unknown };
  doc.pointerLockElement = viewport;
  const before = doc.exits;
  roam.enabled = false;
  check("leaving free roam exits the pointer lock", doc.exits === before + 1,
        `${doc.exits - before} calls to exitPointerLock`);
  // ...and a departure with no lock held asks the document for nothing. The
  // browser would no-op, but a layer that cannot tell whether it holds the
  // pointer is one that will take somebody else's.
  doc.pointerLockElement = null;
  roam.enabled = true;
  roam.enabled = false;
  check("...and leaving without one asks for nothing",
        doc.exits === before + 1, `${doc.exits - before} calls`);

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

console.log("\nthe backdrop's second model");

{
  // `DrawBackdropDome` (`0x004132D0`) draws **twice**: the preset's `slot_a`
  // spun and scaled `(1.2, 1.2, -1.2)`, then -- outside that push, at
  // `0x0041345E` -- `slot_b` with the translate and nothing else. `slot_b`
  // was ignored here, which is not the same as it being absent: it is an
  // ordinary node of the stage glTF with an asset slot the script loads and
  // no region, so `StageScene` drew it in place, at its authored position,
  // for the whole stage and whatever the mode said. Stages 1-4 all use a
  // preset that has one.
  const node = (slot: number) => {
    const mesh = new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial());
    mesh.userData = { hod2_slot: slot };
    return mesh;
  };
  const root = new Group();
  const home = new Group();
  const a = node(6049);
  const b = node(6912);
  home.add(a, b);
  root.add(home);

  const backdrop = new Backdrop();
  const stage = new Scope("stage");
  // Stage 3's preset 6, verbatim -- and at index 6, because the layer looks a
  // preset up by its position in the table, which is how the exporter writes
  // it (`presets[i].preset === i` in all six bundles).
  const filler = (i: number) => ({ preset: i, slot_a: 0, slot_b: 0, dy: 0,
                                   spin_bams: 0, angle0_bams: 0 });
  backdrop.build(root, stage, {
    presets: [...Array.from({ length: 6 }, (_, i) => filler(i)),
              { preset: 6, slot_a: 6049, slot_b: 6912, dy: 0,
                spin_bams: 2, angle0_bams: 0 }],
    used: [6], note: "",
  });
  check("both of the preset's slots leave the stage tree",
        a.parent !== home && b.parent !== home,
        `a -> ${a.parent?.name}, b -> ${b.parent?.name}`);

  const ctx = (mode: number, eye: [number, number, number]) => ({
    walker: { backdropPreset: 6, backdropMode: mode },
    camera: { position: { x: eye[0], y: eye[1], z: eye[2] } },
  }) as unknown as Parameters<typeof backdrop.update>[0];
  const TICK = { dt: 1 / 60, frames: 1, wall: 1 / 60, frozen: false };

  // `mode == 0` returns at `0x0041331A`, before the first push: neither draw
  // happens.
  backdrop.update(ctx(0, [0, 0, 0]), TICK);
  check("mode 0 draws neither model",
        !backdrop.group.visible && !b.visible, `${b.visible}`);

  backdrop.update(ctx(1, [100, -15, -3000]), TICK);
  const dome = backdrop.group.children.find((c) => c.name === "backdrop_dome");
  const flat = backdrop.group.children.find((c) => c.name === "backdrop_flat");
  check("mode 1 draws both", backdrop.group.visible && a.visible && b.visible);
  check("...both centred on the camera",
        !!flat && flat.position.x === 100 && flat.position.y === -15
        && flat.position.z === -3000, JSON.stringify(flat?.position));
  // The second draw is a bare `MatrixTranslate`. No spin, and no inside-out
  // scale -- the negative Z belongs to the dome's push, which was popped.
  check("...and the second takes no rotation and no scale",
        !!flat && flat.rotation.y === 0 && flat.scale.z === 1,
        `${flat?.rotation.y} ${flat?.scale.z}`);
  check("...while the dome takes both",
        !!dome && dome.rotation.y !== 0 && dome.scale.z === -1.2,
        `${dome?.rotation.y} ${dome?.scale.z}`);

  stage.dispose();
  check("and the scope puts both back where they came from",
        a.parent === home && b.parent === home);
}

console.log("\nrigs: whose nodes these are, and what happens off the table");

{
  const RIGS = {
    rigs: [{
      name: "obj_48ead0", routine: "FUN_0048EAD0", note: "",
      routes: [
        { slot: 342, bias: [0, 2, 0] as [number, number, number],
          cam_paths: [124], file: null, index: null, duration: null,
          length: 1575, hold_frame: null, stop_frame: null, note: "" },
        { slot: 343, bias: [0, 2, 0] as [number, number, number],
          cam_paths: [125], file: null, index: null, duration: null,
          length: 1530, hold_frame: null, stop_frame: null, note: "" },
      ],
    }],
    blocked: [], note: "",
  };
  const rigRoot = (rig: string, slot: number | undefined) => {
    const o = new Group();
    o.name = `${rig}_${slot ?? "x"}`;
    o.userData = slot === undefined
      ? { hod2_kind: "rig", hod2_rig: rig }
      : { hod2_kind: "rig", hod2_rig: rig, hod2_path_slot: slot };
    return o;
  };
  const root = new Group();
  const boatA = rigRoot("obj_48ead0", 342);
  const boatB = rigRoot("obj_48ead0", 343);
  // Two spawns of one character skin -- the shape that made this matter. The
  // exporter puts every character through the rig writer, so `chr_` roots
  // carry `hod2_kind: "rig"` too, and stage 3 has 135 of them against nine
  // that belong to a transcribed routine.
  const chrA = rigRoot("chr_char_adv05", undefined);
  const chrB = rigRoot("chr_char_adv05", undefined);
  const gore = rigRoot("gore_char_adv05", undefined);
  chrA.visible = false;
  chrB.visible = false;
  gore.visible = false;
  root.add(boatA, boatB, chrA, chrB, gore);

  const rigs = new RigLayer();
  // A real position curve, because the whole question below is *whether* the
  // layer wrote a pose: with an empty `channels` the evaluator answers
  // `(0, 0, 0)`, which is also what a root that was never touched reads, and
  // the two would be indistinguishable.
  const key = (v: number) => [[0, v, 0, 0], [2000, v, 0, 0]];
  const curve = { channels: { pos_x: key(-900), pos_y: key(-19),
                              pos_z: key(-2190) },
                  file: "op_st3", index: 0, start: 0, duration: 2000 };
  const paths = new CamPaths({
    fps: 60, paths: {}, object_paths: { "342": curve, "343": curve },
  } as never);
  rigs.build(root, RIGS as never, paths);

  check("only the rigs the bundle names are claimed", rigs.count === 2,
        `${rigs.count} instances`);

  // Where a rig is *before its first shot*, which is the thing the header's
  // `[diverges]` claims and the code did not do.
  //
  // `Class26Subtype2Update` (`FUN_0048EAD0`) reaches its draw through
  // `default:` on any camera path its switch does not name, and that arm
  // writes no pose at all -- the object is wherever the spawn descriptor put
  // it, which for every rig the six stages carry is a zero position with a
  // zero orientation, i.e. the transform the exporter baked. The port used to
  // place the fallback instance from its own path at frame 0 instead: stage
  // 3's boat stood in the canal at about (-884, -17, -2136) through camera
  // paths 121, 122 and 123, a second boat parked beside the moving one.
  const bakedA = boatA.position.clone();
  const bakedB = boatB.position.clone();

  const at = (slot: number | null) => ({
    walker: slot === null ? { cam: null } : { cam: { slot, frame: 10 } },
  }) as unknown as Parameters<typeof rigs.update>[0];

  // Nothing else may write these. Before this, an empty gate made every
  // `chr_` root "the route the camera selected", so one arbitrary spawn of
  // each skin was forced visible -- with no game object, so no pose, so a
  // heap of parts on the origin -- and every other one was forced hidden
  // over the layer that owns it.
  // 121 names none of this rig's routes, and nothing has selected one yet.
  rigs.update(at(121));
  check("before any shot selects it, a rig is drawn at its spawn pose",
        boatA.visible && boatA.position.equals(bakedA),
        `${boatA.position.x}, ${boatA.position.y}, ${boatA.position.z}`);
  check("...and the un-drawn instance is not placed either",
        boatB.position.equals(bakedB));

  rigs.update(at(124));
  check("...and the character hierarchies are left alone",
        !chrA.visible && !chrB.visible && !gore.visible);
  check("the shot that does name a route places it on the path",
        boatA.position.x === -900 && boatA.position.y === -19 + 2
          && boatA.position.z === -2190,
        `${boatA.position.x}, ${boatA.position.y}, ${boatA.position.z}`);

  check("the shot's own route is the one drawn",
        boatA.visible && !boatB.visible);

  // `FUN_0048EAD0`'s `default:` skips the pose and still draws. The old rule
  // held the instance only once `frozen`, so the boat vanished on every shot
  // outside the table -- which is most of stage 3's opening.
  const wasX = boatA.position.x;
  rigs.update(at(121));
  check("a camera path the routine does not name still draws it",
        boatA.visible && !boatB.visible);
  check("...at the pose it last held", boatA.position.x === wasX,
        `${boatA.position.x} was ${wasX}`);

  rigs.update(at(125));
  check("and the next shot hands over to its own route",
        !boatA.visible && boatB.visible);

  // A seek clears `showing`; the fallback has to be deterministic or a rig
  // comes back on a different root than the one play would have shown.
  rigs.resync(at(null));
  check("with no shot at all it falls back to the first root",
        boatA.visible && !boatB.visible);
  // ...at the spawn pose, not at whatever pose the run being rewound out of
  // had written. `posed` is state about *how the object got here*, which is
  // exactly what a seek must not carry across.
  check("...and a seek puts the spawn pose back with it",
        boatA.position.equals(bakedA),
        `${boatA.position.x}, ${boatA.position.y}, ${boatA.position.z}`);
}

console.log("\nthe object-path seam carries six values");

{
  // `CamEvalObjectPath6` (`FUN_004042D0`) fills `{float x,y,z; int rx,ry,rz}`,
  // and `ScriptedHumanoidUpdate`'s tail copies the angles onto `obj+0x64/68/
  // 6C` at `0x00484B6E`-`0x00484B74` whenever the follow mode is not 2. This
  // seam handed back the position alone, so `p.yaw` was always `undefined`: a
  // rider took its path's place and kept its spawn facing, and the engine's
  // attachment offset was rotated through a yaw of zero.
  const { CharacterLayer } = await import("../src/render/characters");
  const chars = new CharacterLayer();
  const key = (v: number) => [[0, v, 0, 0], [100, v, 0, 0]];
  chars.paths = new CamPaths({
    fps: 60,
    paths: {},
    object_paths: {
      "340": {
        file: "op_st3", index: 0, start: 0, duration: 100,
        channels: {
          pos_x: key(5), pos_y: key(6), pos_z: key(7),
          rot_x: key(0x100), rot_y: key(0x4000), rot_z: key(0x200),
        },
      },
    },
  } as never);
  const p = chars.objectPath(340, 50);
  check("a point on an `op_` path answers with its position",
        !!p && p.x === 5 && p.y === 6 && p.z === 7, JSON.stringify(p));
  check("...and with the BAMS triple channels 3-5 hold",
        !!p && p.pitch === 0x100 && p.yaw === 0x4000 && p.roll === 0x200,
        JSON.stringify(p));
  check("a slot the bundle has no curve for is still null",
        chars.objectPath(999, 0) === null);
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

console.log("\nan asset-slot actor is drawn, and can be shot:");
{
  // The template rig the exporter emits, built by hand: one hidden part per
  // asset slot, named the way `slots_actor` names them.
  const root = new Obj3D();
  for (let slot = MOUSE_FIRST_SLOT; slot < MOUSE_FIRST_SLOT + 10; slot++) {
    const part = new Obj3D();
    part.name = `slots_actor_fixed000_slot_${slot.toString(16)}`;
    part.userData = { hod2_kind: "rig_part", hod2_rig: "slots_actor" };
    root.add(part);
  }

  ResetGameGlobals();
  const layer = new SlotModelLayer();
  layer.adopt(root);
  check("the layer adopts one template per slot",
        layer.describe().includes("10 templates"), layer.describe());
  check("...and takes them out of the draw",
        !root.children.some((c) => c.visible), "a template is still visible");

  const a = makeActor(0x1234, SpawnClass.Mouse, -1, "mouse");
  if (a.cls !== SpawnClass.Mouse) throw new Error("not class 0x52");
  a.mouse.frame = MOUSE_FIRST_SLOT;
  a.hitRadius = MOUSE_HIT_RADIUS;
  a.pos = { x: 0, y: 0, z: -20 };
  G.g_object_list.push(a);
  // The one field of `RenderContext` this layer reads, and only for class
  // 0x25's object-path arm -- a mouse never reaches it.
  const ctx = { paths: null } as unknown as Parameters<typeof layer.update>[0];
  layer.update(ctx);
  check("a live mouse gets a node", layer.describe().startsWith("1 drawn"),
        layer.describe());

  // `ShotTestSphere` (`FUN_00404630`): one sphere, radius `obj+0x124`. A ray
  // down -z hits it; one offset by more than the radius does not.
  const down = new Ray(new Vector3(0, 0, 0), new Vector3(0, 0, -1));
  const hit = layer.pickSphere(down);
  check("a ray through it is a hit", hit?.at === 0x1234,
        JSON.stringify(hit && { at: hit.at, t: hit.t }));

  const wide = new Ray(new Vector3(MOUSE_HIT_RADIUS + 0.5, 0, 0),
                       new Vector3(0, 0, -1));
  check("...and one further off than the radius is not",
        layer.pickSphere(wide) === null);

  // Behind the muzzle is not a hit, which is the `t <= 0` the engine has too.
  const behind = new Ray(new Vector3(0, 0, -40), new Vector3(0, 0, -1));
  check("...nor is one already past it", layer.pickSphere(behind) === null);

  // A radius of zero is a class that never set one: not shootable, rather
  // than shootable at a point.
  a.hitRadius = 0;
  check("an actor with no radius is not in the sphere test",
        layer.pickSphere(down) === null);
  a.hitRadius = MOUSE_HIT_RADIUS;

  // The strip advances every frame, so the node is re-cloned; the actor
  // leaving takes its node with it.
  a.dead = true;
  layer.update(ctx);
  check("a dead actor loses its node", layer.describe().startsWith("0 drawn"),
        layer.describe());
  G.g_object_list.length = 0;
}

console.log("\nclass 0x25's object-path draw is under the actor, not at it:");
{
  // `ScriptedHumanoidDraw` (`FUN_00484FF0`) case 3: the actor draws asset slot
  // 0x1A37 at `CamEvalObjectPath6(obj+0x135C, g_cam_path_frame)` -- the same
  // path and the same frame it is riding itself. Stage 3's opening is two
  // class-0x25 passengers on `op_st3` 340 and this, and with the arm missing
  // the pair sailed the canal sitting on the water.
  //
  // The point of the assertion is the **placement**, not the count: the actor
  // has `g_class25_path_offsets` record 4 added to its own position, so a
  // model drawn at `a.pos` would be up in the passenger's seat and a model
  // drawn at the path pose is under both of them. Those are eight units
  // apart, which is the whole bug in miniature.
  const { HUMANOID_VARIANT3_SLOT } = await import("../src/game/class25/state");
  const { CamPaths } = await import("../src/game/camera/curve");
  const { ScriptedHumanoidInit } = await import("../src/game/class25");

  const root = new Obj3D();
  const part = new Obj3D();
  part.name = `slots_actor_fixed000_slot_${HUMANOID_VARIANT3_SLOT.toString(16)}`;
  part.userData = { hod2_kind: "rig_part", hod2_rig: "slots_actor" };
  root.add(part);

  ResetGameGlobals();
  const layer = new SlotModelLayer();
  layer.adopt(root);

  const key = (v: number) => [[0, v, 0, 0], [200, v, 0, 0]];
  const paths = new CamPaths({
    fps: 60, paths: {},
    object_paths: {
      "340": {
        file: "op_st3", index: 0, start: 0, duration: 200,
        channels: { pos_x: key(-160), pos_y: key(-16), pos_z: key(-2172),
                    rot_x: key(0), rot_y: key(0x4000), rot_z: key(0) },
      },
    },
  } as never);
  const ctx = { paths } as unknown as Parameters<typeof layer.update>[0];

  // Stage 3's own variant-3 spawn, by script address.
  const a = makeActor(4128, SpawnClass.ScriptedHumanoid, -1, "rider");
  if (a.cls !== SpawnClass.ScriptedHumanoid) throw new Error("not class 0x25");
  a.hum.pathSlot = 340;
  // Where the *actor* is: the path pose plus offset record 4's
  // `(4.62, -8.0, 1.42)`, which is the seat. Nothing may draw the boat here.
  a.pos = { x: -155.4, y: -24, z: -2170.6 };
  G.g_object_list.push(a);
  G.g_cam_path_frame = 100;

  // Variant 0 -- 129 of the 137 spawns -- draws nothing at all. The renderer
  // reads it off the actor, where `ScriptedHumanoidInit` cached the
  // descriptor word; the program is here because that is where the Init gets
  // it from.
  T.humanoids = { "4128": { charType: 59, removePath: 124, removeFrame: 0,
                            flags2: 1, motion: 717, phase: 0, cmds: [] } };
  ScriptedHumanoidInit(a);
  a.hum.pathSlot = 340;
  layer.update(ctx);
  check("a class-0x25 actor with no draw variant draws nothing",
        layer.describe().startsWith("0 drawn"), layer.describe());

  // ...and a bundle written before the field existed reads as variant 0
  // rather than as a missing model.
  T.humanoids["4128"].drawVariant = 3;
  ScriptedHumanoidInit(a);
  a.hum.pathSlot = 340;
  layer.update(ctx);
  check("variant 3 draws the object-path model",
        layer.describe().startsWith("1 drawn"), layer.describe());
  check("...at the path pose and not at the actor",
        layer.describe().includes("at -160.0, -16.0, -2172.0"),
        layer.describe());

  // The frame is `g_cam_path_frame`, raw: the same clock the passengers ride,
  // which is what keeps the two together without either knowing about the
  // other.
  G.g_cam_path_frame = 150;
  layer.update(ctx);
  check("...and it follows the camera path frame",
        layer.describe().includes("at -160.0, -16.0, -2172.0"),
        layer.describe());

  // A slot the bundle has no curve for is a model with nowhere to go. Hidden
  // beats parked at the origin, which is a thing somebody has to explain.
  a.hum.pathSlot = 999;
  layer.update(ctx);
  check("a path the bundle does not carry hides the model rather than "
        + "dropping it at the origin",
        !layer.describe().includes(" at "), layer.describe());

  T.humanoids = null;
  G.g_object_list.length = 0;
}


console.log("\nthe shot effects are models, one per frame:");
{
  // The `slots_effect` rig the exporter emits, built by hand: the blood strip
  // and the two muzzle runs for player 0.
  const root = new Obj3D();
  const slots: number[] = [];
  for (let n = 0x3a; n <= 0x52; n++) slots.push(n);
  for (let n = 0x175; n <= 0x17d; n++) slots.push(n);
  for (let n = 0xb76; n <= 0xb7e; n++) slots.push(n);
  for (const slot of slots) {
    const part = new Obj3D();
    part.name =
      `slots_effect_fixed000_slot_${slot.toString(16).padStart(4, "0")}`;
    part.userData = { hod2_kind: "rig_part", hod2_rig: "slots_effect" };
    root.add(part);
  }

  ResetGameGlobals();
  const layer = new EffectLayer();
  layer.adopt(root);
  check("the layer adopts one template per slot",
        layer.describe.includes(`${slots.length} templates`),
        layer.describe);
  check("...and takes them out of the draw",
        !root.children.some((c) => c.visible), "a template is still visible");

  const camera = new PerspectiveCamera(41.1, 4 / 3, 0.8, 8000);
  camera.updateMatrixWorld(true);
  const ctx = { camera } as unknown as Parameters<typeof layer.update>[0];

  // The blood asks the character layer where the bone is, and that is the one
  // thing this layer cannot answer itself.
  let radius: number | null = 6;
  layer.bones = {
    boneSphere: (_at: number, _bone: number, out: InstanceType<typeof Vector3>)
      : number | null => {
      out.set(0, 10, -50);
      return radius;
    },
  };

  G.g_blood_sprays.push({ id: 1, at: 0x1234, bone: 4, cel: 0, severity: 1 });
  layer.update(ctx);
  check("a spray gets a node at the first of the twenty-five models",
        layer.describe.startsWith("1 drawn"), layer.describe);
  const node = layer.viewGroup.children[0]!;
  check("...in the camera's own space, on the near face of the bone sphere",
        Math.abs(node.position.z - (-50 + 6)) < 1e-4, `${node.position.z}`);

  // The slot moves every frame, so the node is re-cloned every frame.
  const first = layer.viewGroup.children[0];
  G.g_blood_sprays[0]!.cel = 1;
  layer.update(ctx);
  check("...and a new model when the cel moves on",
        layer.viewGroup.children[0] !== first);

  // A bone that is not posed draws nothing rather than drawing at the origin.
  radius = null;
  layer.update(ctx);
  check("an unposed bone bleeds nowhere",
        layer.describe.startsWith("0 drawn"), layer.describe);
  radius = 6;

  // The muzzle flash rides the camera: its group carries the camera's matrix,
  // so the record's own numbers stay camera-space and it stays on the gun.
  G.g_blood_sprays.length = 0;
  const f = G.g_shot_flash_ring[0]!;
  f.live = true;
  f.player = 0;
  f.frame = 0;
  f.pos = { x: 0.1, y: -0.2, z: -1 };
  layer.update(ctx);
  check("a live muzzle record draws nothing while the toggle is off",
        layer.viewGroup.children.length === 0
        && /flash 0/.test(layer.describe), layer.describe);
  layer.setMuzzle(true);
  layer.update(ctx);
  check("the flash's second draw compounds onto the first, not over it",
        Math.abs(FLASH_SMOKE_SCALE - 0.05) < 1e-9
        && Math.abs(FLASH_SMOKE_SCALE_KIND4 - 0.075) < 1e-9,
        `${FLASH_SMOKE_SCALE}`);
  check("a live muzzle record draws its two slots in the camera's group",
        layer.viewGroup.children.length === 2
        && layer.group.children.length === 0,
        `${layer.viewGroup.children.length}/${layer.group.children.length}`);
  camera.position.set(100, 0, 0);
  camera.updateMatrixWorld(true);
  layer.update(ctx);
  check("...and follows the camera without the record moving",
        f.pos.x === 0.1
        && Math.abs(layer.viewGroup.matrix.elements[12] - 100) < 1e-6,
        `${layer.viewGroup.matrix.elements[12]}`);

  // The tracer is the one that is left behind in the world.
  const t = G.g_shot_tracer_ring[0]!;
  t.live = true;
  t.player = 0;
  t.pos = { x: 1, y: 2, z: 3 };
  layer.update(ctx);
  check("the tracer is in the world group, not the camera's",
        layer.group.children.length === 1,
        `${layer.group.children.length}`);
  check("...at the point the port put it",
        layer.group.children[0]!.position.x === 1);

  f.live = false;
  t.live = false;
  layer.update(ctx);
  check("a record that has expired takes its node with it",
        layer.describe.startsWith("0 drawn"), layer.describe);
  ResetGameGlobals();
}


console.log("\nthe blood colour switch moves the map, not the shader:");
{
  // A 2x1 image and just enough canvas to transpose it. The file's own stub is
  // for text labels and has no pixel calls, so this one is local and put back.
  const doc = globalThis.document;
  const px = new Uint8ClampedArray([10, 200, 30, 255, 40, 50, 60, 255]);
  const held = new Uint8ClampedArray(px);
  (globalThis as unknown as { document: unknown }).document = {
    createElement: () => ({
      width: 0, height: 0,
      getContext: () => ({
        drawImage: () => undefined,
        getImageData: () => ({ data: held }),
        putImageData: () => undefined,
      }),
    }),
  };

  const map = new CanvasTexture({ width: 2, height: 1 } as never);
  const mat = new MeshBasicMaterial({ map });
  mat.userData = { hod2_blood: true };
  const plain = new MeshBasicMaterial({ map: new CanvasTexture({ width: 2, height: 1 } as never) });
  const root = new Obj3D();
  const a = new Mesh(new PlaneGeometry(1, 1), mat);
  const b = new Mesh(new PlaneGeometry(1, 1), plain);
  root.add(a);
  root.add(b);

  const layer = new BloodColourLayer();
  layer.prepare(root);
  check("only the marked material is collected",
        /1\/1 swapped/.test(layer.describe), layer.describe);
  check("red is the default, and it is the transposed map",
        mat.map !== map && layer.colour === "red", layer.describe);
  check("...and the transpose really exchanges R and G",
        held[0] === 200 && held[1] === 10 && held[2] === 30,
        `${held[0]},${held[1]},${held[2]}`);

  // **The regression this exists for.** The first cut did the swap in the
  // fragment shader through `onBeforeCompile`; the material's mode changed and
  // its pixels did not, because the program was never rebuilt. Asserting the
  // mode would have passed. Asserting what the material *holds* does not.
  const red = mat.map;
  layer.setColour("green");
  check("green puts the bundle's own map back",
        mat.map === map && /0\/1 swapped/.test(layer.describe), layer.describe);
  layer.setColour("red");
  check("...and red puts the transpose back, the same object as before",
        mat.map === red && /1\/1 swapped/.test(layer.describe), layer.describe);
  check("the unmarked material is never touched", plain.map !== null);

  layer.dispose();
  check("disposing drops the transposes", /no blood materials/
        .test(layer.describe), layer.describe);
  (globalThis as unknown as { document: unknown }).document = doc;
}

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
