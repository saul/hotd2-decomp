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
type RenderContextT = import("../src/render/context").RenderContext;

const { LabelCache } = await import("../src/render/overlays");
const { SceneFog } = await import("../src/render/fog");
const { Backdrop } = await import("../src/render/backdrop");
const { Rain } = await import("../src/render/rain");
const { type26RippleHeight, type26RippleUvOffset } =
  await import("../src/render/type26_ripple");
const { Scope } = await import("../src/core/scope");
const { ownResources, subtreeResources } = await import("../src/render/scope3d");
const { FreeRoam, isTyping, ownsKey }
  = await import("../src/render/freeroam");
const { RigLayer } = await import("../src/render/rigs");
const { CamPaths } = await import("../src/game/camera/curve");
const { CanvasTexture, Color, Group, Mesh,
        MeshBasicMaterial, PerspectiveCamera, PlaneGeometry, Scene,
        ShaderChunk, ShaderLib } = await import("three");
const { SceneLighting, lightDirection, DIFFUSE_SCALE, LIGHT_AMBIENT_SCALE,
        PackRenderAmbient } = await import("../src/render/lighting");
const { SlotModelLayer } = await import("../src/render/slotmodels");
const { EffectLayer } = await import("../src/render/effects");
const { BloodColourLayer } = await import("../src/render/bloodcolour");
const { FLASH_SMOKE_SCALE, FLASH_SMOKE_SCALE_KIND4 }
  = await import("../src/game/effects/shot_effects");
const { G, ResetGameGlobals } = await import("../src/game/globals");
const { ActorFlag, makeActor } = await import("../src/game/actor");
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
  // Light block 0's fog words, which are `G`'s; `fogSet` is the walker's.
  const walkerWith = (rgb: [number, number, number], near = 21, far = 507) => {
    const c = G.g_scene_light_block0.channels;
    c[0] = near; c[1] = far; c[2] = rgb[0]; c[3] = rgb[1]; c[4] = rgb[2];
    return ({ walker: { fogSet: true } }) as unknown as
      Parameters<InstanceType<typeof SceneFog>["update"]>[0];
  };

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

  // The clear is `SetClearColor(0x00598C58)`, black in play, and the fog
  // never touches it: an uncovered pixel is black under any fog. The port
  // used to paint it the fog colour -- stage 4's grey, stage 6's pale blue.
  const scene = new Scene();
  scene.background = new Color(0x123456);
  const fogged = new SceneFog(scene);
  fogged.update(walkerWith([197, 196, 255]));
  const bg = scene.background as InstanceType<typeof Color>;
  check("an uncovered pixel is the clear colour, black, not the fog colour",
        scene.fog !== null && bg.r === 0 && bg.g === 0 && bg.b === 0,
        `fog ${scene.fog ? "on" : "off"}, background #${bg.getHexString()}`);
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
    const c = G.g_scene_light_block0.channels;
    c[0] = near; c[1] = far; c[2] = 10; c[3] = 10; c[4] = 20;
    fog.update(({ walker: { fogSet: true } }) as unknown as
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
  const unset = drive(65000, 65001);
  check("the pre-script default is past the far plane and draws no fog",
        unset !== null && unset.near > 8000 && unset.far > unset.near,
        JSON.stringify(unset));
  // ...and is still a fog on the scene, as is the "off" view: whether the
  // scene has one is in every program's key, so taking it off recompiled
  // every fogged program in view the frame the script's first fog op ran.
  const bare = new Scene();
  const off = new SceneFog(bare);
  const atLoad = bare.fog;
  off.setMode("off");
  check("the fog never leaves the scene: on from construction, kept by \"off\"",
        atLoad !== null && bare.fog === atLoad
        && (bare.fog as { near: number }).near > 8000,
        `${atLoad ? "on" : "null"} at construction`);
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
  //   D3DRENDERSTATE_AMBIENT = pack(t * 255)      <- TINTED, truncated bytes
  //   light.diffuse          = t * 1.4            <- scaled by ambient too
  //   light.ambient          = colour * 0.3       <- and this one is not
  //
  // and the device sums the two ambients. All of it is in framebuffer bytes,
  // so the uniforms carry the engine's numbers unconverted -- the port used
  // to put them through sRGB->linear for three.js's Lambert, which then
  // divided them by pi.
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;
  type U = { value: { r: number; g: number; b: number } };
  const terms = (l: unknown) => (l as { block0: { ambient: U; color: U } }).block0;

  // `PackRenderAmbient` is the exe's own packing, `__ftol` truncating: at
  // the engine's default light (1.0, 0.2, 0.1) and ambient 0.5 the three
  // products are 127.5, 25.5 and 12.75, which the hardware saw as 127, 25, 12.
  check("the ambient word truncates each byte under alpha 0xFF",
        PackRenderAmbient(0.5, 0.1, 0.05) === 0xff7f190c,
        PackRenderAmbient(0.5, 0.1, 0.05).toString(16));
  // ...and does not clamp: OR 0xFFFFFF00 keeps a red past 255 to its low
  // byte, and a green past 255 carries into red's.
  check("...and a product past 1.0 carries into the next byte as the exe's would",
        PackRenderAmbient(1.2, 0, 0) === 0xff320000
        && PackRenderAmbient(0, 1.2, 0) === 0xff013200,
        `${PackRenderAmbient(1.2, 0, 0).toString(16)} `
        + `${PackRenderAmbient(0, 1.2, 0).toString(16)}`);

  const lights = new SceneLighting(new Scene());
  // `FUN_00460250` seeds the scene light colour to exactly this.
  const rgb: [number, number, number] = [1.0, 0.2, 0.1];
  const a = 0.5;
  lights.set({ rgb, ambient: a, pitch: 0, yaw: 0 });
  const t = terms(lights);

  check("light.diffuse is colour * ambient * 1.4, as the engine's number",
        near(t.color.value.r, 1.0 * a * DIFFUSE_SCALE)
        && near(t.color.value.g, 0.2 * a * DIFFUSE_SCALE)
        && near(t.color.value.b, 0.1 * a * DIFFUSE_SCALE),
        JSON.stringify(t.color.value));
  check("...and the ambient is the packed bytes plus colour * 0.3",
        near(t.ambient.value.r, 127 / 255 + 1.0 * LIGHT_AMBIENT_SCALE)
        && near(t.ambient.value.g, 25 / 255 + 0.2 * LIGHT_AMBIENT_SCALE)
        && near(t.ambient.value.b, 12 / 255 + 0.1 * LIGHT_AMBIENT_SCALE),
        JSON.stringify(t.ambient.value));

  // Turning the master brightness down must dim the directional light with
  // it.
  const wasR = t.color.value.r;
  lights.set({ rgb, ambient: a / 2, pitch: 0, yaw: 0 });
  check("the ambient channel is a master brightness and dims the light too",
        near(t.color.value.r, wasR / 2),
        `${wasR.toFixed(4)} -> ${t.color.value.r.toFixed(4)}`);

  // The twin's program, against three's own Lambert source: every chunk the
  // patch needs is found, three's light loop is gone, and the pixel is the
  // device's `texel * colour + spec` on bytes.
  const base = new MeshBasicMaterial();
  base.userData = { pvr2: { tex_ambient: 0.75, specular: [0.5, 0.25, 0.125],
                            specular_power: 32 } };
  const mesh = new Mesh(new PlaneGeometry(1, 1), base);
  const root = new Group();
  root.add(mesh);
  lights.build(root);
  const twin = mesh.material as InstanceType<typeof MeshBasicMaterial>;
  check("a scene-lit mesh draws a twin, not its unlit material",
        twin !== base && twin.customProgramCacheKey() === "d3dlit",
        twin.type);
  const shader = {
    vertexShader: ShaderLib.lambert.vertexShader,
    fragmentShader: ShaderLib.lambert.fragmentShader,
    uniforms: {} as Record<string, { value: unknown }>,
  };
  const warned: string[] = [];
  const warn = console.warn;
  console.warn = (m: string) => { warned.push(m); };
  twin.onBeforeCompile(shader as never, undefined as never);
  console.warn = warn;
  check("every chunk the device's equation replaces is where it expects",
        warned.length === 0, warned.join("; "));
  check("...the light is summed per vertex, clamped, with the highlight",
        shader.vertexShader.includes("vD3dColour = clamp( d3dC, 0.0, 1.0 );")
        && shader.vertexShader.includes("pow( d3dNH, d3dPower )")
        && shader.vertexShader.includes("d3dTexAmbient * diffuse * d3dLightAmbient"));
  // The declared departure: the normal is renormalised. Taken literally, D3D
  // leaves it at the inverse transpose's length, and `FishDraw`'s Scale(0.3)
  // stretched the fish's normals 3.3 times and drew them white; the shipped
  // game draws them coloured.
  check("...on a unit normal, whatever scale the model is drawn under",
        shader.vertexShader.includes(
          "vec3 d3dN = normalize( normalMatrix * objectNormal );"));
  check("...three.js's light loop, and its divide by pi, are gone",
        !shader.fragmentShader.includes("#include <lights_fragment_begin>")
        && !shader.fragmentShader.includes("reflectedLight.directDiffuse +"));
  check("...and the pixel is texel * colour + specular, on bytes",
        shader.fragmentShader.includes(
          "clamp( d3dTexel * vD3dColour + vD3dSpecular, 0.0, 1.0 )")
        && shader.fragmentShader.includes(
          "hod2SrgbEncode( sampledDiffuseColor.rgb )"));
  const u = shader.uniforms;
  check("the program reads block 0's terms and the mesh's own material",
        u.d3dLightAmbient === t.ambient && u.d3dLightColor === t.color
        && u.d3dTexAmbient?.value === 0.75 && u.d3dPower?.value === 32
        && (u.d3dSpecular?.value as { y: number }).y === 0.25,
        Object.keys(u).join(","));

  // `BuildSceneLightDirection` (`0x0040E0B0`): rotate (0,0,1) by Y then X,
  // giving (cos p · sin y, −sin p, cos p · cos y), the direction the light
  // comes *from*.
  const d = lightDirection(0, 0x4000);
  check("the direction is the rotated unit Z, and +90 deg yaw faces +X",
        near(d.x, 1) && near(d.y, 0) && Math.abs(d.z) < 1e-4,
        `${d.x.toFixed(3)},${d.y.toFixed(3)},${d.z.toFixed(3)}`);
  const dp = lightDirection(0x4000, 0);
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
  const { RunPendingInits, SpawnScriptedCharacters, RetireUnlistedActor } =
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
    reactions: {}, attacks: {}, motions: { "10": {} },
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
  RunPendingInits();
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
      name: "obj_48f050", routine: "FUN_0048F050", note: "",
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
  const boatA = rigRoot("obj_48f050", 342);
  const boatB = rigRoot("obj_48f050", 343);
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
  // (This was stage 3's boat, `Class26Subtype2Update`, until the port gave
  // that routine an actor -- see the next block. The route logic it pinned
  // down is every other rig's, and `FUN_0048F050` has the same `default:`.)
  // A routine like this reaches its draw through
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

  // `FUN_0048F050`'s `default:` skips the pose and still draws. The old rule
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

console.log("\nrigs: a rig a spawn installs is not drawn before that spawn");

{
  // Stage 4's opening shot (new bug 12): `obj_48f050` is `FUN_0048F050`,
  // installed by `Class26InstallSubtypeUpdate` (`FUN_0048E290`) for class
  // 0x26 subtype 3, and the one spawn that installs it is block 12's, script
  // address 27660, at the origin. Drawn from stage load it stood at (0, 0, 0)
  // -- inside the desk of block 0's opening shot.
  const RIGS = {
    rigs: [{
      name: "obj_48f050", routine: "FUN_0048F050", note: "",
      spawn_ats: [27660],
      routes: [
        { slot: 371, bias: [0, 0, 0] as [number, number, number],
          cam_paths: [176], file: null, index: null, duration: null,
          length: 160, hold_frame: null, stop_frame: null, note: "" },
      ],
    }],
    blocked: [], note: "",
  };
  const root = new Group();
  const lift = new Group();
  lift.userData = { hod2_kind: "rig", hod2_rig: "obj_48f050",
                    hod2_path_slot: 371 };
  root.add(lift);
  const rigs = new RigLayer();
  const key = (v: number) => [[0, v, 0, 0], [200, v, 0, 0]];
  const paths = new CamPaths({
    fps: 60, paths: {},
    object_paths: { "371": { channels: { pos_x: key(5), pos_y: key(6),
                                         pos_z: key(7) },
                             file: "op_st4", index: 0, start: 0,
                             duration: 200 } },
  } as never);
  rigs.build(root, RIGS as never, paths);
  const ctx = (spawns: number[], slot = 163) => ({
    walker: { cam: { slot, frame: 31 }, spawns: spawns.map((at) => ({ at })) },
  }) as unknown as Parameters<typeof rigs.update>[0];

  rigs.update(ctx([]));
  check("before its spawn has run the rig is not drawn", !lift.visible);
  rigs.update(ctx([5116]));
  check("...nor for somebody else's spawn", !lift.visible);
  rigs.update(ctx([5116, 27660]));
  check("once the walker has run it, it is", lift.visible);
  rigs.update(ctx([5116, 27660], 176));
  check("...and it rides its route like any rig",
        lift.visible && lift.position.x === 5,
        `${lift.position.x}`);
  rigs.update(ctx([5116]));
  check("a seek back past the spawn hides it again", !lift.visible);
  rigs.update(ctx([5116, 27660], 163));
  check("...and forgets the pose, so it comes back at its spawn pose",
        lift.visible && lift.position.x === 0, `${lift.position.x}`);
}

console.log("\nrigs: the boat the port's actor poses");
{
  // `Class26Subtype2Update` (`FUN_0048EAD0`) is `game/class26/`, and the rig
  // layer no longer runs its own copy of that routine's camera-path switch:
  // the root is one per spawn, tagged `hod2_spawn_at`, drawn while the actor
  // is in the pool and placed from it. This used to be a table of routes in
  // `rigs_data.ts` evaluated here a second time.
  const { G, ResetGameGlobals } = await import("../src/game/globals");
  const { ActorSpawn } = await import("../src/game/director");
  const { SpawnClass } = await import("../src/game/spawn_class");
  ResetGameGlobals();
  const RIGS = {
    rigs: [{ name: "obj_48ead0", routine: "FUN_0048EAD0", note: "",
             routes: [], spawn_class: 0x26 }],
    blocked: [], note: "",
  };
  const boat = new Group();
  boat.userData = { hod2_kind: "rig", hod2_rig: "obj_48ead0",
                    hod2_spawn_at: 3244, hod2_spawn_class: 0x26 };
  const root = new Group();
  root.add(boat);
  const rigs = new RigLayer();
  rigs.build(root, RIGS as never,
             new CamPaths({ fps: 60, paths: {}, object_paths: {} } as never));
  const at = { walker: { cam: { slot: 124, frame: 855 } } } as unknown as
    Parameters<typeof rigs.update>[0];
  rigs.update(at);
  check("with no class-0x26 actor in the pool the boat is not drawn",
        !boat.visible);
  const a = ActorSpawn(3244, SpawnClass.Vehicle, -1, "boat", { hp: 2 });
  a.pos.x = -1115; a.pos.y = -17; a.pos.z = -2668;
  a.yaw = 0x4000;
  rigs.update(at);
  check("with one, the root is drawn at the actor's position",
        boat.visible && boat.position.x === -1115 && boat.position.y === -17
        && boat.position.z === -2668,
        `${boat.visible} ${boat.position.x},${boat.position.y},${boat.position.z}`);
  const fwd = new Vector3(0, 0, 1).applyQuaternion(boat.quaternion);
  check("...turned by the actor's yaw (a quarter turn takes +z to +x)",
        Math.abs(fwd.x - 1) < 1e-6 && Math.abs(fwd.z) < 1e-6,
        `${fwd.x},${fwd.z}`);
  a.despawned = true;
  rigs.update(at);
  check("...and gone when the actor is", !boat.visible);
  ResetGameGlobals();
  void G;
}

console.log("\nrigs: class 0x28's cars are drawn from its actors, not from the "
            + "camera frame");
{
  // `PathRidingPropDraw` (`FUN_00432840`) is stage 1's two burning cars, and
  // the object is class 0x28's, `game/class28/`. This layer used to pose the
  // rig itself: both route roots grouped as one ungated object, the first
  // drawn at `path(min(len, camera frame))` of **whatever camera was
  // playing** -- sliding along the path extrapolated back from frame 671
  // before the throw, thrown again by every later camera move past 671, and
  // drawn from stage load whether or not anything had spawned. Now the
  // spawn roots are posed from the live actor at their address, one root per
  // actor, and the route roots are never drawn.
  const { ActorSpawn } = await import("../src/game/director");
  const { Rng } = await import("../src/core/rng");
  const { Quaternion } = await import("three");
  ResetGameGlobals();
  const route = (slot: number, length: number) => ({
    slot, bias: [0, 0, 0] as [number, number, number], cam_paths: [],
    file: "op_st1", index: slot - 253, duration: 54, length,
    hold_frame: null, stop_frame: null, note: "",
  });
  const RIGS = {
    rigs: [{ name: "obj_432840", routine: "FUN_00432840", note: "",
             spawn_class: 0x28, spawn_ats: null,
             routes: [route(325, 725), route(326, 765)] }],
    blocked: [], note: "",
  };
  const part = (slot: number, pos: [number, number, number],
                scale: [number, number, number]) => {
    const g = new Group();
    g.position.set(...pos);
    g.scale.set(...scale);
    g.userData = { hod2_kind: "rig_part", hod2_rig: "obj_432840",
                   hod2_slots: [`0x${slot.toString(16).padStart(4, "0")}`] };
    return g;
  };
  // Every cel of both loops, one part each, as the rig writer exports them:
  // the body, then `0x135F..0x136D`, then `0xB67..0xB6E`.
  const FIRE = Array.from({ length: 15 }, (_, i) => 0x135f + i);
  const SMOKE = Array.from({ length: 8 }, (_, i) => 0xb67 + i);
  const rigRoot = (name: string, data: Record<string, unknown>) => {
    const g = new Group();
    g.name = name;
    g.userData = { hod2_kind: "rig", hod2_rig: "obj_432840",
                   hod2_routine: "FUN_00432840", ...data };
    g.add(part(0x33, [0, 0, 0], [1, 1, 1]),
          ...FIRE.map((s) => part(s, [0, 5, 0], [1.5, 2, 1])),
          ...SMOKE.map((s) => part(s, [0, 0, 12], [7, 7, 7])));
    return g;
  };
  /** The one part of `slots` a root shows, as its slot; -1 for none or two. */
  const celOf = (r: InstanceType<typeof Obj3D>, slots: number[]) => {
    const on = r.children.filter((c) => c.visible && slots.includes(
      Number.parseInt((c.userData.hod2_slots as string[])[0], 16)));
    return on.length === 1
      ? Number.parseInt((on[0].userData.hod2_slots as string[])[0], 16) : -1;
  };
  const root = new Group();
  const r325 = rigRoot("obj_432840_325", { hod2_path_slot: 325 });
  const r326 = rigRoot("obj_432840_326", { hod2_path_slot: 326 });
  const s0 = rigRoot("obj_432840_spawn000",
                     { hod2_spawn_at: 24472, hod2_spawn_class: 0x28 });
  const s1 = rigRoot("obj_432840_spawn001",
                     { hod2_spawn_at: 24512, hod2_spawn_class: 0x28 });
  // The same descriptor spawned in a second block: a second record, one
  // object.
  const s2 = rigRoot("obj_432840_spawn002",
                     { hod2_spawn_at: 24472, hod2_spawn_class: 0x28 });
  root.add(r325, r326, s0, s1, s2);
  // A real curve, so a root the layer placed on a path is distinguishable
  // from one it left alone: x is the frame.
  const ramp = [[0, 0, 1, 1], [2000, 2000, 1, 1]];
  const flat = (v: number) => [[0, v, 0, 0], [2000, v, 0, 0]];
  const curve = { channels: { pos_x: ramp, pos_y: flat(-8), pos_z: flat(-497) },
                  file: "op_st1", index: 72, start: 0, duration: 2000 };
  const rigs = new RigLayer();
  rigs.build(root, RIGS as never, new CamPaths({
    fps: 60, paths: {}, object_paths: { "325": curve, "326": curve },
  } as never));
  // The post-fight cutscene's camera, frame 700 -- inside route 0's throw.
  const ctx = { walker: { cam: { slot: 50, frame: 700 }, spawns: [] } } as
    unknown as Parameters<typeof rigs.update>[0];
  rigs.update(ctx);
  const shown = () => [r325, r326, s0, s1, s2].filter((r) => r.visible)
    .map((r) => `${r.name}@${r.position.x}`);
  check("with no class-0x28 actor nothing is drawn -- not the route roots "
        + "at another camera's frame 700",
        shown().length === 0, shown().join(" "));

  const a = ActorSpawn(24472, SpawnClass.PathRidingProp, -1, "car",
                       { hp: 0 }, new Rng(28));
  a.visible = true;
  a.pos.x = -1021.62; a.pos.y = -8.04; a.pos.z = -497.51;
  a.yaw = 0x1ca6;
  a.roll = 0x4000;                         // on its side: not the identity
  G.g_camera_block_eye.x = a.pos.x + 30;
  G.g_camera_block_eye.y = 0;
  G.g_camera_block_eye.z = a.pos.z + 40;
  rigs.update(ctx);
  check("with one, exactly its first spawn root is drawn, at the actor",
        shown().length === 1 && s0.visible
        && s0.position.x === a.pos.x && s0.position.z === a.pos.z,
        shown().join(" "));
  root.updateMatrixWorld(true);
  // `ResetGameGlobals` left `g_frame_counter` at 0: each loop's first cel.
  const fire = s0.children[1];
  const smoke = s0.children[1 + FIRE.length];
  const wp = (o: InstanceType<typeof Obj3D>) =>
    o.getWorldPosition(new Vector3());
  const yaw = Math.trunc(Math.atan2(30, 40) * 32768 / Math.PI)
    * Math.PI / 32768;
  const f = wp(fire);
  const sm = wp(smoke);
  const near = (u: number, v: number) => Math.abs(u - v) < 1e-3;
  check("before the throw the fire stands 5.0 above the object, whatever "
        + "the object's roll",
        fire.visible && near(f.x, a.pos.x) && near(f.y, a.pos.y + 5)
        && near(f.z, a.pos.z), `${f.x},${f.y},${f.z}`);
  check("...and the smoke 8.0 above and 12 toward the camera block's eye",
        smoke.visible && near(sm.x, a.pos.x + 12 * Math.sin(yaw))
        && near(sm.y, a.pos.y + 8) && near(sm.z, a.pos.z + 12 * Math.cos(yaw)),
        `${sm.x},${sm.y},${sm.z}`);
  const up = new Vector3(0, 1, 0).applyQuaternion(
    fire.getWorldQuaternion(new Quaternion()));
  check("...both carrying the yaw alone: the fire stands upright",
        near(up.y, 1), `${up.x},${up.y},${up.z}`);
  // The eye is `[g_camera_index * 0x1A4 + 0x009A60C0]`: under scene state
  // (1, 3) the index is 2, and the smoke turns to block 2's eye.
  G.g_camera_index = 2;
  G.g_camera_block2_eye.x = a.pos.x - 40;
  G.g_camera_block2_eye.z = a.pos.z + 30;
  rigs.update(ctx);
  root.updateMatrixWorld(true);
  const yaw2 = Math.trunc(Math.atan2(-40, 30) * 32768 / Math.PI)
    * Math.PI / 32768;
  const sm2 = wp(smoke);
  check("...toward the eye of the block g_camera_index names (block 2)",
        near(sm2.x, a.pos.x + 12 * Math.sin(yaw2))
        && near(sm2.z, a.pos.z + 12 * Math.cos(yaw2)),
        `${sm2.x},${sm2.z}`);
  G.g_camera_index = 0;
  // The cel is the exe's: `MOV EAX,[0x009A32A0]; XOR EDX,EDX; MOV ECX,0xF;
  // DIV ECX; ADD EDX,0x135F` at `0x0043292C`, and `MOV EDX,[0x009A32A0];
  // AND EDX,7; ADD EDX,0xB67` at `0x004329A7` -- `g_frame_counter`, not the
  // scene tick class 0x41 type 53 reads for the same two loops.
  const cels: string[] = [];
  let posed = true;
  for (const n of [0, 22, 100, 101]) {
    G.g_frame_counter = n;
    G.g_scene_tick_counter = n + 3;         // must not be the one read
    rigs.update(ctx);
    root.updateMatrixWorld(true);
    const f = celOf(s0, FIRE);
    const k = celOf(s0, SMOKE);
    cels.push(`${n}:${f.toString(16)}/${k.toString(16)}`);
    if (f !== 0x135f + n % 15 || k !== 0xb67 + (n & 7)) posed = false;
    // ...and whichever cel it is stands where the first one stood.
    const on = s0.children.find((c) => c.visible
      && (c.userData.hod2_slots as string[])[0] === `0x${f.toString(16)}`);
    const at = on ? wp(on) : null;
    if (!at || !near(at.x, a.pos.x) || !near(at.y, a.pos.y + 5)) posed = false;
  }
  check("each loop draws one cel, `0x135F + g_frame_counter % 15` and "
        + "`0xB67 + (g_frame_counter & 7)`, posed as the first",
        posed, cels.join(" "));
  check("...so the drawn cels at two counters differ",
        cels[1].split(":")[1] !== cels[0].split(":")[1], cels.join(" "));
  G.g_frame_counter = 0;
  G.g_scene_tick_counter = 0;
  rigs.update(ctx);
  const tail = (a as unknown as { pathProp?: { launched: number } }).pathProp;
  check("the actor carries class 0x28's tail", tail !== undefined);
  if (tail) tail.launched = 1;
  rigs.update(ctx);
  check("once obj+0x1320 is up the sprites are not drawn and the body is",
        s0.visible && celOf(s0, FIRE) === -1 && celOf(s0, SMOKE) === -1
        && s0.children.slice(1).every((c) => !c.visible)
        && s0.children[0].visible);
  a.despawned = true;
  rigs.update(ctx);
  check("...and once the actor is killed nothing is", shown().length === 0,
        shown().join(" "));
  ResetGameGlobals();
}

console.log("\nrigs: class 0x28's sprite cels draw in their own meshes' state -- "
            + "translucent, depth-writing, nearest first");
{
  // `PathRidingPropDraw` (`FUN_00432840`) sets no render state of its own
  // around the two sprites: from `0x0043288C` to its `RET` at `0x004329C8` it
  // calls MatrixStackPush/Pop, MatrixTranslate, MatrixRotateY, MatrixScale,
  // VecToAngles, NoOpStub and `AssetDrawSlot` (`0x00432941`, `0x004329B7`) --
  // the plain draw, no alpha -- and nothing else. So each cel composites by
  // its own mesh's words through `TranslatePvr2StateToD3D`: ISP `0x83000000`
  // (LESSEQUAL, depth write on) and TSP `0x94002453` for the 0x135F loop,
  // `0x9400241B` for the 0xB67 loop -- SRCALPHA / INVSRCALPHA, pass bits
  // clear so the translucent pass, alpha-tested at ALPHAREF 1. Then
  // `RenderCommandCompare` (`FUN_004A8A20`) draws the nearer command first,
  // and the 0xB67 cel stands 12.0 toward the eye: it draws before the 0x135F
  // cel and writes depth wherever its texel alpha is at least 1, so the
  // column is cut away round every flame. That pale fringe is the exe's
  // picture, not a port fault; these checks hold the state that makes it.
  //
  // The loops are named by slot, not by what they show: the cel commit
  // called 0x135F "fire" and 0xB67 "smoke", and the textures read the other
  // way round (a 32x64 near-black column, a 64x64 flame) -- `[likely]`, from
  // the pictures and nothing else.
  const { prepareDrawCommands, RenderCommandOrder, ALPHA_REF }
    = await import("../src/render/draw_order");
  const { ActorSpawn } = await import("../src/game/director");
  const { Rng } = await import("../src/core/rng");
  const { CustomBlending, LessEqualDepth, OneMinusSrcAlphaFactor,
          SrcAlphaFactor } = await import("three");
  ResetGameGlobals();
  const RIGS = {
    rigs: [{ name: "obj_432840", routine: "FUN_00432840", note: "",
             spawn_class: 0x28, spawn_ats: null, routes: [] }],
    blocked: [], note: "",
  };
  // The parts as the bundle carries them (`stage1.glb`, `obj_432840_*`): one
  // single-primitive node per cel, so the node is the mesh and the command,
  // its material carrying the mesh header's words and its geometry the
  // header's sphere.
  const assoc = new Map<InstanceType<typeof Obj3D>, { nodes?: number }>();
  let node = 0;
  const cel = (slot: number, tsp: string, sphere: number[],
               pos: [number, number, number], scale: [number, number, number]) => {
    const g = new PlaneGeometry(1, 1);
    g.userData = { hod2_chain_index: 0, hod2_model: 0, hod2_sphere: sphere };
    const mat = new MeshBasicMaterial({ transparent: true, depthWrite: false });
    mat.userData = { pvr2: { isp_tsp_instruction: "0x83000000",
                             tsp_instruction: tsp } };
    const m = new Mesh(g, mat);
    m.position.set(...pos);
    m.scale.set(...scale);
    m.userData = { hod2_kind: "rig_part", hod2_rig: "obj_432840",
                   hod2_slots: [`0x${slot.toString(16).padStart(4, "0")}`] };
    assoc.set(m, { nodes: node++ });
    return m;
  };
  const LOOP_135F = Array.from({ length: 15 }, (_, i) =>
    cel(0x135f + i, "0x94002453", [0, 38.037654, 0, 40.183147],
        [0, 5, 0], [1.5, 2, 1]));
  const LOOP_B67 = Array.from({ length: 8 }, (_, i) =>
    cel(0xb67 + i, "0x9400241B", [0, 1.6, 0, 2.262742],
        [0, 0, 12], [7, 7, 7]));
  const body = new Group();
  body.userData = { hod2_kind: "rig_part", hod2_rig: "obj_432840",
                    hod2_slots: ["0x0033"] };
  const s0 = new Group();
  s0.name = "obj_432840_spawn000";
  s0.userData = { hod2_kind: "rig", hod2_rig: "obj_432840",
                  hod2_routine: "FUN_00432840", hod2_spawn_at: 24472,
                  hod2_spawn_class: 0x28 };
  s0.add(body, ...LOOP_135F, ...LOOP_B67);
  const root = new Group();
  root.add(s0);
  // What `StageScene.load` does to the whole stage glTF, rigs included,
  // before anything else sees it.
  prepareDrawCommands(root, assoc as never);
  const rigs = new RigLayer();
  rigs.build(root, RIGS as never, new CamPaths({
    fps: 60, paths: {}, object_paths: {},
  } as never));
  const a = ActorSpawn(24472, SpawnClass.PathRidingProp, -1, "car",
                       { hp: 0 }, new Rng(28));
  a.visible = true;
  a.pos.x = -1021.62; a.pos.y = -8.04; a.pos.z = -497.51;
  G.g_camera_block_eye.x = a.pos.x + 30;
  G.g_camera_block_eye.y = a.pos.y + 10;
  G.g_camera_block_eye.z = a.pos.z + 40;
  const ctx = { walker: { cam: { slot: 47, frame: 191 }, spawns: [] } } as
    unknown as Parameters<typeof rigs.update>[0];
  rigs.update(ctx);
  root.updateMatrixWorld(true);
  const on135f = LOOP_135F.filter((m) => m.visible);
  const onB67 = LOOP_B67.filter((m) => m.visible);
  check("one cel of each loop is drawn", s0.visible
        && on135f.length === 1 && onB67.length === 1,
        `${on135f.length} + ${onB67.length}`);
  type M = InstanceType<typeof MeshBasicMaterial>;
  const state = (m: InstanceType<typeof Mesh>) => {
    const t = m.material as M;
    return `${t.transparent}/${t.blending}/${t.blendSrc}/${t.blendDst}`
      + `/${t.alphaTest.toFixed(5)}/${t.depthTest}/${t.depthWrite}/${t.depthFunc}`;
  };
  const exe = `true/${CustomBlending}/${SrcAlphaFactor}/${OneMinusSrcAlphaFactor}`
    + `/${(ALPHA_REF / 255).toFixed(5)}/true/true/${LessEqualDepth}`;
  const drawn = [...on135f, ...onB67];
  check("both drawn cels are translucent-pass, SRCALPHA/INVSRCALPHA, "
        + "alpha-tested at ALPHAREF 1 and depth-writing under LESSEQUAL -- "
        + "their words' state, not the loader's",
        drawn.length === 2 && drawn.every((m) => state(m) === exe),
        drawn.map(state).join(" | "));
  check("...and every cel of both loops carries it, drawn or not",
        [...LOOP_135F, ...LOOP_B67].every((m) => state(m) === exe));

  // The translucent order, from the eye the sprites turn to.
  const cam = new PerspectiveCamera(41.1, 4 / 3, 0.8, 8000);
  const e = G.g_camera_block_eye;
  cam.position.set(e.x, e.y, e.z);
  cam.lookAt(a.pos.x, a.pos.y, a.pos.z);
  cam.updateMatrixWorld(true);
  const order = new RenderCommandOrder(cam);
  // The exe's order first; the PowerVR order the page draws by default is
  // checked after it.
  order.powerVr = false;
  order.beginFrame();
  let id = 0;
  const item = (o: InstanceType<typeof Obj3D>) => ({
    id: id++, object: o, groupOrder: 0, renderOrder: 0, z: 0,
    geometry: null, material: null, program: null, group: null,
  }) as unknown as Parameters<typeof order.compare>[0];
  if (on135f.length === 1 && onB67.length === 1) {
    const [c135f, cB67] = [on135f[0], onB67[0]];
    const first = [item(c135f), item(cB67)].sort(order.compare)[0].object;
    check("the 0xB67 cel, 12 toward the eye, is drawn before the 0x135F "
          + "cel: RenderCommandCompare puts the nearer command first",
          first === cB67,
          `keys ${order.key(cB67).depth.toFixed(2)} / `
          + `${order.key(c135f).depth.toFixed(2)}`);
    order.powerVr = true;
    const pvrFirst = [item(c135f), item(cB67)].sort(order.compare)[0].object;
    check("...and in the PowerVR order the 0x135F column is drawn first, so "
          + "the 0xB67 cel blends over it instead of cutting it away",
          pvrFirst === c135f);
  }
  a.despawned = true;
  rigs.update(ctx);
  ResetGameGlobals();
}

console.log("\nrigs: the stage-2 car is drawn from the port's task, not from load");
{
  // The car stood in Goldman's office through stage 2
  // block 0 step 1. `obj_452320` is `St2CarDraw` (`FUN_00452320`); its object
  // is the task `St2CarSpawn` (`FUN_00452120`) allocates, and the one caller
  // is `RescueTargetInit` (`FUN_00451720`) -- class 0x21's spawn, a step
  // later. The rig's three roots are exported at the origin, which is where
  // Goldman's desk is, and this layer drew the first of them from load.
  const { G, ResetGameGlobals } = await import("../src/game/globals");
  const { St2CarSpawn, St2CarsTick } = await import("../src/game/class21/car");
  const { NULL_HOST } = await import("../src/game/host");
  ResetGameGlobals();
  const route = (slot: number, cam: number) => ({
    slot, bias: [0, 0, 0] as [number, number, number], cam_paths: [cam],
    file: null, index: null, duration: null, length: 200, hold_frame: null,
    stop_frame: null, note: "",
  });
  const RIGS = {
    rigs: [{ name: "obj_452320", routine: "FUN_00452320", note: "",
             spawn_ats: null,
             routes: [route(328, 56), route(334, 57), route(333, 58)] }],
    blocked: [], note: "",
  };
  const root = new Group();
  const roots = [328, 333, 334].map((slot) => {
    const g = new Group();
    g.userData = { hod2_kind: "rig", hod2_rig: "obj_452320",
                   hod2_routine: "FUN_00452320", hod2_path_slot: slot };
    root.add(g);
    return g;
  });
  const rigs = new RigLayer();
  const key = (v: number) => [[0, v, 0, 0], [400, v, 0, 0]];
  rigs.build(root, RIGS as never, new CamPaths({
    fps: 60, paths: {},
    object_paths: { "328": { channels: { pos_x: key(-1669), pos_y: key(-8),
                                         pos_z: key(-158) },
                             file: "op_st2", index: 0, start: 0,
                             duration: 400 } },
  } as never));
  const at = (slot: number, frame: number) => ({
    walker: { cam: { slot, frame }, spawns: [] },
  }) as unknown as Parameters<typeof rigs.update>[0];
  const shown = () => roots.filter((r) => r.visible).length;

  rigs.update(at(55, 35));
  check("on the Goldman shot, with no car task, no root is drawn",
        shown() === 0, `${shown()} shown`);
  rigs.update(at(56, 30));
  check("...nor on the car's own shot: the route does not make the car",
        shown() === 0, `${shown()} shown`);

  const car = St2CarSpawn(0);
  rigs.update(at(56, 30));
  check("a task that has not yet run is not drawn either", shown() === 0);
  G.g_active_cam_path = 0x38;
  G.g_cam_path_frame = 30;
  St2CarsTick({ ...NULL_HOST,
                objectPath: () => ({ x: -1457, y: -6, z: -339,
                                     pitch: 0, yaw: 0x4000, roll: 0 }) });
  rigs.update(at(56, 30));
  check("once it has drawn, exactly one root is",
        shown() === 1 && car.drawn, `${shown()} shown`);
  const r = roots.find((g) => g.visible)!;
  check("...at the pose the task wrote",
        r.position.x === -1457 && r.position.y === -6 && r.position.z === -339,
        `${r.position.x},${r.position.y},${r.position.z}`);
  const fwd = new Vector3(0, 0, 1).applyQuaternion(r.quaternion);
  check("...turned by its yaw (a quarter turn takes +z to +x)",
        Math.abs(fwd.x - 1) < 1e-6 && Math.abs(fwd.z) < 1e-6,
        `${fwd.x},${fwd.z}`);
  G.g_st2_cars = [];
  rigs.update(at(57, 100));
  check("...and none once the task has killed itself", shown() === 0);
  ResetGameGlobals();
}

console.log("\nrigs: the car draws the parts St2CarDraw names, posed as it posed them");
{
  // The car's rig showed its first asset row for good
  // -- the exporter shipped nothing else -- with the spun parts still and the
  // parked part never turning. `St2CarDraw` (`FUN_00452320`) picks a row of
  // `g_st2car_asset_variants` per frame, turns one push by `obj+0x1334` and
  // two by `obj+0x1330`, and hangs those two off a roll-limited frame.
  const { G, ResetGameGlobals } = await import("../src/game/globals");
  const { ST2CAR_ASSET_VARIANTS, St2CarSpawn, St2CarsTick }
    = await import("../src/game/class21/car");
  const { RIGS: RIG_TABLE } = await import("../src/hod2lib/rigs_data");
  const { NULL_HOST } = await import("../src/game/host");
  const { Euler, Quaternion } = await import("three");
  const { BAMS_TO_RAD } = await import("../src/core/bams");
  ResetGameGlobals();
  const RIGS = {
    rigs: [{ name: "obj_452320", routine: "FUN_00452320", note: "",
             spawn_ats: null, routes: [] }],
    blocked: [], note: "",
  };
  const root = new Group();
  const rigRoot = new Group();
  rigRoot.userData = { hod2_kind: "rig", hod2_rig: "obj_452320",
                       hod2_routine: "FUN_00452320", hod2_path_slot: 334 };
  root.add(rigRoot);

  // The rig this block poses is the one both exporters write the bundle
  // from, not a hand-typed copy of it: `applyTaskDraw` is right only for a
  // rig that carries every slot the draw can name, nests the second column
  // in its own row's body and hangs the other three off the rig root. These
  // hold the table to `St2CarDraw`'s own words first.
  const carParts = RIG_TABLE.find((r) => r.name === "obj_452320")?.parts ?? [];
  const partFor = (slot: number) =>
    carParts.filter((p) => p.slots.length === 1 && p.slots[0] === slot);
  check("the exporter ships both rows of g_st2car_asset_variants, a part a slot",
        carParts.length === 8
        && ST2CAR_ASSET_VARIANTS.flat().every((s) => partFor(s).length === 1),
        carParts.map((p) => `${p.name}:${p.slots}`).join(" "));
  check("...column 1 inside its own row's body, columns 0, 2 and 3 on the root",
        ST2CAR_ASSET_VARIANTS.every((row) => {
          const [body, door, a, b] = row.map((s) => partFor(s)[0]);
          return door?.parent === body?.name
            && !body?.parent && !a?.parent && !b?.parent
            && (body?.translation ?? [0, 0, 0]).every((v) => v === 0);
        }),
        carParts.map((p) => `${p.name}<${p.parent ?? "root"}`).join(" "));
  // `MatrixTranslate(x, y, z)` of three `PUSH imm32`s, z first: the nested
  // push at `0x00452377`, the two spun ones at `0x00452497` and `0x004524E8`.
  const f32 = (bits: number) =>
    new Float32Array(new Uint32Array([bits]).buffer)[0];
  const PUSHED = [
    [f32(0x4110eecc), f32(0x40cbc84b), f32(0x410f17c2)],
    [0, f32(0x404ab852), f32(0x415a61e5)],
    [0, f32(0x404ab852), f32(0xc117ae14)],
  ];
  check("...each at the float32s its PUSH imm32s carry",
        ST2CAR_ASSET_VARIANTS.every((row) => PUSHED.every((want, i) => {
          const t = partFor(row[i + 1])[0]?.translation;
          return !!t && t.every((v, k) => Math.fround(v) === want[k]);
        })),
        ST2CAR_ASSET_VARIANTS.flatMap((row) => row.slice(1).map((s) =>
          `${s.toString(16)}:${partFor(s)[0]?.translation}`)).join(" "));

  // Then built as the writer builds it: each part under its `parent`, or the
  // root, at its translation, tagged with the slot it draws.
  const nodes = new Map<number, InstanceType<typeof Group>>();
  const byName = new Map<string, InstanceType<typeof Group>>();
  for (const p of carParts) {
    const g = new Group();
    const t = p.translation ?? [0, 0, 0];
    g.position.set(t[0], t[1], t[2]);
    g.userData = { hod2_kind: "rig_part", hod2_rig: "obj_452320",
                   hod2_slots: p.slots.map((s) => `0x${s.toString(16)
                     .toUpperCase().padStart(4, "0")}`) };
    (p.parent ? byName.get(p.parent) ?? rigRoot : rigRoot).add(g);
    byName.set(p.name, g);
    nodes.set(p.slots[0], g);
  }
  const TW = partFor(0x34)[0]?.translation ?? [0, 0, 0];
  const rigs = new RigLayer();
  rigs.build(root, RIGS as never,
             new CamPaths({ fps: 60, paths: {}, object_paths: {} } as never));
  const at = { walker: { cam: { slot: 57, frame: 0 }, spawns: [] } } as
    unknown as Parameters<typeof rigs.update>[0];
  // A pose with a roll outside the limiter's dead zone, so the second frame
  // is not the body's.
  let pose = { x: -885, y: -7, z: -597, pitch: 0x300, yaw: 0x7428, roll: 0x2000 };
  const host = {
    ...NULL_HOST,
    objectPath: (slot: number, frame: number) =>
      slot === 0x153 ? { x: 0, y: 0, z: 0, pitch: 0, roll: 0,
                         yaw: 16384 + (frame - 100) * 370 }
        : { ...pose },
  };
  const visible = (s: number) => {
    let o: InstanceType<typeof Obj3D> | null = nodes.get(s)!;
    while (o) { if (!o.visible) return false; o = o.parent; }
    return true;
  };
  G.g_active_cam_path = 0x39;
  G.g_cam_path_frame = 360;
  const car = St2CarSpawn(0);
  St2CarsTick(host);
  St2CarsTick(host);
  rigs.update(at);
  check("riding 0x39, row 0 is drawn and row 1 is not",
        [0x2d, 0x2f, 0x34, 0x31].every(visible)
        && ![0x2e, 0x30, 0x35, 0x32].some(visible),
        [...nodes.keys()].map((s) => `${s.toString(16)}:${visible(s)}`).join(" "));

  // The spun part, in world space, against the exe's own product:
  // T(pos) · RotY(y) · RotX(x) · RotZ(lim) · T(offset) · RotX(spin).
  const d = car.draw.limited;
  const qd = new Quaternion().setFromEuler(new Euler(
    d.pitch * BAMS_TO_RAD, d.yaw * BAMS_TO_RAD, d.roll * BAMS_TO_RAD, "YXZ"));
  const qs = new Quaternion().setFromEuler(new Euler(
    car.spin * BAMS_TO_RAD, 0, 0, "YXZ"));
  root.updateMatrixWorld(true);
  const wheel = nodes.get(0x34)!;
  const wq = wheel.getWorldQuaternion(new Quaternion());
  const wp = wheel.getWorldPosition(new Vector3());
  const want = new Vector3(...TW).applyQuaternion(qd)
    .add(new Vector3(pose.x, pose.y, pose.z));
  check("the limited frame is not the body's for this roll",
        d.roll !== 0 && d.roll !== pose.roll, JSON.stringify(d));
  check("a spun part sits on the roll-limited frame",
        wp.distanceTo(want) < 1e-3, `${wp.toArray()} vs ${want.toArray()}`);
  check("...turned by it and then by RotX(obj+0x1330)",
        Math.abs(Math.abs(wq.dot(qd.clone().multiply(qs))) - 1) < 1e-6,
        `${wq.toArray()}`);
  const spinWas = wheel.quaternion.clone();
  St2CarsTick(host);
  rigs.update(at);
  check("...a frame later it has turned by another 0x1000",
        Math.abs(wheel.quaternion.angleTo(spinWas)) > 0.1,
        String(wheel.quaternion.angleTo(spinWas)));

  // Crash: 0x39 runs out, the row changes and the parked part turns.
  pose = { ...pose, roll: 0 };
  G.g_cam_path_frame = 370;
  St2CarsTick(host);
  St2CarsTick(host);
  St2CarsTick(host);
  rigs.update(at);
  check("parked after 0x39, row 1 is drawn and row 0 is not",
        [0x2e, 0x30, 0x35, 0x32].every(visible)
        && ![0x2d, 0x2f, 0x34, 0x31].some(visible));
  const door = nodes.get(0x30)!;
  const yaw = new Euler().setFromQuaternion(door.quaternion, "YXZ").y;
  check("...and the second column is turned RotY by obj+0x1334",
        car.partYaw !== 0
        && Math.abs(yaw - car.partYaw * BAMS_TO_RAD) < 1e-6
        && door.position.x === partFor(0x30)[0]?.translation?.[0],
        `${yaw} vs ${car.partYaw * BAMS_TO_RAD}`);
  ResetGameGlobals();
}

console.log("\nthe weapon-5 round and the tracer face the camera");
{
  // The rig `obj_416b00` put `PlayerShotEffectsThink`'s one literal slot,
  // 0x109D, in front of Goldman's desk in every Original Mode stage-2 opening:
  // the exporter placed a root at `op_` 0x194's own pose. The exe draws that
  // slot only from a live kind-5 `g_shot_tracer_ring` record, at the record
  // plus the path, after `MatrixClearRotation`.
  const { RIGS } = await import("../src/hod2lib/rigs_data");
  const { originalWeaponEffectSlots } = await import("../src/hod2lib/bundle");
  const { OriginalWeaponKind, TRACER_WEAPON5_SLOT }
    = await import("../src/game/effects/shot_effects");
  const { Euler, Quaternion } = await import("three");
  const { BAMS_TO_RAD } = await import("../src/core/bams");
  check("obj_416b00 is not a rig the exporter places",
        !!RIGS.find((r) => r.name === "obj_416b00")?.placementBlocked);
  check("...and its slot rides the effect templates, in Original Mode only",
        originalWeaponEffectSlots(true).includes(0x109d)
        && originalWeaponEffectSlots(false).length === 0);
  // ...with the grenade's blast (sprite effect 0x53, 0x125..0x13D) and
  // BULLET BLOW's ring (0xA6F + frames 0..0x17), which the trunk can equip.
  check("...and the grenade's blast and BULLET BLOW's ring ride with it",
        [0x125, 0x13d, 0xa6f, 0xa86].every(
          (s) => originalWeaponEffectSlots(true).includes(s))
        && !originalWeaponEffectSlots(true).includes(0xa87));

  const root = new Obj3D();
  for (const slot of [TRACER_WEAPON5_SLOT, 0xb78]) {
    const p = new Obj3D();
    p.name = `slots_effect_fixed000_slot_${slot.toString(16).padStart(4, "0")}`;
    p.userData = { hod2_kind: "rig_part", hod2_rig: "slots_effect" };
    root.add(p);
  }
  ResetGameGlobals();
  const layer = new EffectLayer();
  layer.adopt(root);
  const camera = new PerspectiveCamera(41.1, 4 / 3, 0.8, 8000);
  camera.position.set(10, 5, 30);
  camera.rotation.set(0.2, 0.9, 0.1, "YXZ");
  camera.updateMatrixWorld(true);
  const key = (v: number) => [[0, v, 0, 0], [30, v, 0, 0]];
  const paths = new CamPaths({
    fps: 60, paths: {},
    object_paths: { "404": { file: "op_org", index: 0, start: 0, duration: 24,
      channels: { pos_x: key(0.5), pos_y: key(0.25), pos_z: key(-1),
                  rot_x: key(0x800), rot_y: key(0x1000), rot_z: key(0) } } },
  } as never);
  const ctx = { camera, paths } as unknown as Parameters<typeof layer.update>[0];
  layer.update(ctx);
  check("no record, no round", layer.group.children.length === 0);

  const t = G.g_shot_tracer_ring[0]!;
  t.live = true; t.player = 0; t.kind = OriginalWeaponKind.BassLure;
  t.pos = { x: 1, y: 2, z: 3 }; t.frame = 30;
  layer.update(ctx);
  const n = layer.group.children[0];
  check("a live kind-5 record draws slot 0x109D in the world",
        layer.group.children.length === 1 && !!n,
        `${layer.group.children.length}`);
  check("...at the record plus op_ 0x194 at frame % 24",
        !!n && Math.abs(n.position.x - 1.5) < 1e-6
        && Math.abs(n.position.y - 2.25) < 1e-6
        && Math.abs(n.position.z - 2) < 1e-6,
        n ? n.position.toArray().join(",") : "none");
  const cq = camera.getWorldQuaternion(new Quaternion());
  const pr = new Quaternion().setFromEuler(
    new Euler(0x800 * BAMS_TO_RAD, 0x1000 * BAMS_TO_RAD, 0, "ZYX"));
  check("...turned in the camera's axes: MatrixClearRotation, then the path",
        !!n && Math.abs(Math.abs(n.quaternion.dot(cq.clone().multiply(pr))) - 1)
          < 1e-6, n ? n.quaternion.toArray().join(",") : "none");

  t.kind = 0; t.spin = 0x2000;
  layer.update(ctx);
  const s = layer.group.children[0];
  const zr = new Quaternion().setFromEuler(new Euler(0, 0, 0x2000 * BAMS_TO_RAD));
  check("an ordinary tracer faces the camera and rolls in its plane",
        !!s && Math.abs(Math.abs(s.quaternion.dot(cq.clone().multiply(zr))) - 1)
          < 1e-6, s ? s.quaternion.toArray().join(",") : "none");
  ResetGameGlobals();
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
 * templates, `PropLayer` (gone) the `prop_` statics, `BreakableLayer` the slot
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
    reactions: {}, attacks: {}, motions: { "10": {} },
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

  // **The mouse is `game/`'s to pick.** `MouseBranchTriggerUpdate` files
  // itself through `ActorRegisterOriginInViewSpace` (`FUN_0043F950`) and
  // `MouseWanderUpdate` never does, so the class sets `registersForShotTest`
  // and this sphere test passes it over, drawn or not.
  const down = new Ray(new Vector3(0, 0, 0), new Vector3(0, 0, -1));
  check("a drawn mouse is not in this layer's sphere test",
        layer.pickSphere(down) === null);
  G.g_object_list.length = 0;

  // `ShotTestSphere` (`FUN_00404630`)'s else-arm, on a class that still comes
  // through here: one sphere, radius `obj+0x124`. A ray down -z hits it; one
  // offset by more than the radius does not.
  const p13 = makeActor(0x1234, SpawnClass.ScriptedProp, -1, "prop");
  if (p13.cls !== SpawnClass.ScriptedProp) throw new Error("not class 0x13");
  p13.prop13.slot = MOUSE_FIRST_SLOT;
  p13.hitRadius = MOUSE_HIT_RADIUS;
  p13.pos = { x: 0, y: 0, z: -20 };
  G.g_object_list.push(p13);
  layer.update(ctx);
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
  p13.hitRadius = 0;
  check("an actor with no radius is not in the sphere test",
        layer.pickSphere(down) === null);
  p13.hitRadius = MOUSE_HIT_RADIUS;

  // The actor leaving takes its node with it.
  p13.dead = true;
  layer.update(ctx);
  check("a dead actor loses its node", layer.describe().startsWith("0 drawn"),
        layer.describe());
  G.g_object_list.length = 0;

  // **The fish is drawn by `FishDraw` (`FUN_00439860`)'s matrices, which turn
  // it by the sub-block's angles and never by `obj+0x68`.** The layer drew it
  // by `obj+0x68` alone at one scale, so every fish swam side-on at its
  // descriptor's yaw -- 0 for all 56 -- and never pitched. At a quarter turn
  // (L48): bobbing (the default arm) is `T(x, y - 0.4, z) RotY(sub+0x50)
  // RotX(sub+0x58) Scale(0.3)`, so the model's +Z, 0.3 long, comes out along
  // `(cos 22.5, -sin 22.5, 0) * 0.3` for a pitch of 0x1000; drawn solid and
  // below `g_water_level` it also casts the flattened silhouette at
  // `water + 0.07`, `RotY` then `Scale(0.4, 0.01, 0.4)`, lit 0.1 grey.
  {
    const fishRoot = new Obj3D();
    const fishPart = new Obj3D();
    fishPart.name = "slots_actor_fixed000_slot_1156";
    fishPart.userData = { hod2_kind: "rig_part", hod2_rig: "slots_actor" };
    fishRoot.add(fishPart);
    const fishLayer = new SlotModelLayer();
    fishLayer.adopt(fishRoot);
    const f = makeActor(0x4321, SpawnClass.WaterEnemy, -1, "fish");
    if (f.cls !== SpawnClass.WaterEnemy) throw new Error("not class 0x51");
    f.fish.frame = 0x1156;
    f.fish.state = 1;              // FishState.Bob: the default arm
    f.fish.yaw = 0x4000;
    f.fish.pitch = 0x1000;
    f.fish.flags = 0x4 | 0x1;      // Surfaced (drawn solid), Submerged
    f.yaw = 0;                     // what the layer used to turn it by
    f.pos = { x: 10, y: -20, z: -30 };
    G.g_water_level = -10;
    G.g_object_list.push(f);
    fishLayer.update(ctx);
    const node = fishLayer.nodeFor(0x4321);
    const kids = node?.children ?? [];
    const at = (c: InstanceType<typeof Obj3D> | undefined, x: number,
                y: number, z: number) => {
      if (!c) return null;
      const o = new Vector3(0, 0, 0).applyMatrix4(c.matrix);
      const e = new Vector3(x, y, z).applyMatrix4(c.matrix).sub(o);
      return { o, e };
    };
    const near = (v: InstanceType<typeof Vector3>, x: number, y: number,
                  z: number) => Math.abs(v.x - x) < 1e-5
      && Math.abs(v.y - y) < 1e-5 && Math.abs(v.z - z) < 1e-5;
    const c22 = Math.cos(Math.PI / 8), s22 = Math.sin(Math.PI / 8);
    const model = at(kids[1], 0, 0, 1);
    check("a bobbing fish is turned by sub+0x50 and sub+0x58, at 0.3, 0.4 "
          + "below its origin",
          kids.length === 2 && !!model && near(model.o, 10, -20.4, -30)
          && near(model.e, 0.3 * c22, -0.3 * s22, 0),
          model ? `${kids.length} parts, origin ${model.o.toArray()}, +Z to `
            + `${model.e.toArray()}` : `${kids.length} parts`);
    const shadow = at(kids[0], 0, 0, 1);
    const flat = at(kids[0], 0, 1, 0);
    check("...under a silhouette on the water: turned, flattened, lit 0.1",
          !!shadow && !!flat && near(shadow.o, 10, -9.93, -30)
          && near(shadow.e, 0.4, 0, 0) && near(flat.e, 0, 0.01, 0)
          && String(kids[0].userData.hod2_light_colour)
            === String([Math.fround(0.1), Math.fround(0.1), Math.fround(0.1)]),
          shadow && flat ? `origin ${shadow.o.toArray()}, +Z to `
            + `${shadow.e.toArray()}, +Y to ${flat.e.toArray()}` : "none");
    // The lunge pitches by its progress: `(sub+0x74 << 14) / sub+0x7E -
    // 0x3D00`, 8 frames of 32 -> -0x2D00, and draws at its origin.
    f.fish.state = 2;
    f.fish.yaw = 0;
    f.fish.lungeStep = 8;
    f.fish.lungeFrames = 32;
    f.pos = { x: 0, y: 5, z: 0 };  // above the water: no silhouette
    fishLayer.update(ctx);
    const lunge = at(fishLayer.nodeFor(0x4321)?.children[0], 0, 0, 1);
    const phi = -0x2d00 / 0x10000 * 2 * Math.PI;
    check("...and a lunging one is pitched by the lunge's progress",
          (fishLayer.nodeFor(0x4321)?.children.length ?? 0) === 1 && !!lunge
          && near(lunge.o, 0, 5, 0)
          && near(lunge.e, 0, -0.3 * Math.sin(phi), 0.3 * Math.cos(phi)),
          lunge ? `origin ${lunge.o.toArray()}, +Z to ${lunge.e.toArray()}`
            : "none");
    G.g_object_list.length = 0;
    G.g_water_level = 0;

    // **The owl is a chain, not a slot.** `OwlDrawBodyChain` (`FUN_00447C20`)
    // draws sixteen models under one root, so the layer builds a group with a
    // child per entry rather than one node. Drawn as a single slot it is a
    // body that does not flap, which is what it looked like.
    const owlRoot = new Obj3D();
    const owlSlots = [0xbbf, 0xbc0, 0xbf1, 0xbf2, 0xbf4, 0xbf5, 0xbf6,
                      0xbbd, 0xbbe];
    for (let i = 0; i < 30; i++) owlSlots.push(0xbc1 + i);   // the beat
    for (let i = 0; i < 16; i++) owlSlots.push(0xbf8 + i);   // the head
    for (let i = 0; i < 15; i++) owlSlots.push(0xc08 + i, 0xc18 + i);
    for (const sl of owlSlots) {
      const part = new Obj3D();
      part.name = `slots_actor_fixed000_slot_${sl.toString(16).padStart(4, "0")}`;
      part.userData = { hod2_kind: "rig_part", hod2_rig: "slots_actor" };
      owlRoot.add(part);
    }
    const owlLayer = new SlotModelLayer();
    owlLayer.adopt(owlRoot);
    G.g_frame_counter = 0;
    const o = makeActor(0x4323, SpawnClass.FlyingEnemy, -1, "owl");
    if (o.cls !== SpawnClass.FlyingEnemy) throw new Error("not class 0x43");
    o.pos = { x: 0, y: 0, z: -20 };
    G.g_object_list.push(o);
    owlLayer.update(ctx);
    const og = owlLayer.nodeFor(0x4323);
    check("an owl is drawn as a chain of models, not one",
          !!og && og.children.length === 12,
          og ? `${og.children.length} children` : "no group");
    // The thirty-frame beat is `0xBC1 + obj+0x240`, so the second child's
    // model changes with it and the body's does not.
    const beatAt = (n: number) => {
      o.owl.beat = n;
      owlLayer.update(ctx);
      const g = owlLayer.nodeFor(0x4323);
      return g?.children[1]?.name ?? "";
    };
    check("...whose second model is the wing beat and follows `obj+0x240`",
          beatAt(0) !== beatAt(3) && beatAt(0).endsWith("_slot_0bc1"),
          `${beatAt(0)} vs ${beatAt(3)}`);
    // The inner chain is skipped for a corpse -- `if (obj+0x34 & 0x1000000)
    // goto tail` -- and the body model swaps.
    o.flags |= 0x1000000;      // `OwlFlag.Corpse`, not `ActorFlag.Dead`
    owlLayer.update(ctx);
    const dg = owlLayer.nodeFor(0x4323);
    check("...and a dead one loses its inner chain and swaps its body",
          !!dg && dg.children.length === 9
          && dg.children[0].name.endsWith("_slot_0bc0"),
          dg ? `${dg.children.length} ${dg.children[0].name}` : "no group");
    G.g_object_list.length = 0;

    const m = makeActor(0x4322, SpawnClass.Mouse, -1, "mouse");
    if (m.cls !== SpawnClass.Mouse) throw new Error("not class 0x52");
    m.mouse.frame = MOUSE_FIRST_SLOT;
    m.pos = { x: 0, y: 0, z: -20 };
    G.g_object_list.push(m);
    layer.update(ctx);
    const mn = layer.nodeFor(0x4322);
    check("...and a mouse at the one its own routine does not set",
          !!mn && mn.scale.x === 1, mn ? `${mn.scale.x}` : "no node");
    G.g_object_list.length = 0;
  }
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
                            flags2: 1, motion: 717, phase: 0, entry: 0,
                            cmds: [] } };
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
  // On by default -- the game draws it -- so the switch is turned off here.
  layer.setMuzzle(false);
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


console.log("\nthe damage overlay: a plain AssetDrawSlot, drawn by the texture's alpha:");
{
  // `DamageOverlayUpdateAndDraw` (`FUN_00417300`) calls `AssetDrawSlot`, not
  // `AssetDrawSlotWithAlpha`: no draw alpha, no fade. The eleven templates as
  // the exporter writes them -- one mesh each, with the TSP words
  // `common.bin` 116..126 carry -- and the pass `prepareDrawCommands` gives
  // them at load. What reaches the screen must then be the template's own
  // material on every one of the 59 frames: the translucent pass, blending by
  // the texel's alpha at material alpha 1.
  const { applyPvr2DrawState, pvr2Words, ALPHA_REF }
    = await import("../src/render/draw_order");
  const { PlayerTask } = await import("../src/game/player_state");
  const { DAMAGE_OVERLAY_FRAMES, DAMAGE_OVERLAY_SCALES, DAMAGE_OVERLAY_SLOTS,
          DAMAGE_OVERLAY_Z, DamageOverlayKind }
    = await import("../src/game/effects/damage_overlay");
  const { CustomBlending, OneMinusSrcAlphaFactor, SrcAlphaFactor }
    = await import("three");
  type Basic = InstanceType<typeof MeshBasicMaterial>;
  const root = new Obj3D();
  const mats = new Map<number, Basic>();
  for (let slot = 0x931; slot <= 0x93b; slot++) {
    const mat = new MeshBasicMaterial();
    // 0x938 and 0x939 are the U-flipped models: bit 18 more, nothing else.
    const flipped = slot === 0x938 || slot === 0x939;
    mat.userData = { pvr2: { isp_tsp_instruction: "0x83000000",
                             tsp_instruction: flipped ? "0x9404041B"
                                                      : "0x9400041B" } };
    applyPvr2DrawState(mat, pvr2Words(mat)!);
    const part = new Mesh(new PlaneGeometry(1, 1), mat);
    part.name = `slots_effect_fixed000_slot_${slot.toString(16).padStart(4, "0")}`;
    part.userData = { hod2_kind: "rig_part", hod2_rig: "slots_effect" };
    root.add(part);
    mats.set(slot, mat);
  }
  ResetGameGlobals();
  const layer = new EffectLayer();
  layer.adopt(root);
  const camera = new PerspectiveCamera(41.1, 4 / 3, 0.8, 8000);
  camera.updateMatrixWorld(true);
  const ctx = { camera } as unknown as Parameters<typeof layer.update>[0];

  // The record as the port's spawn and first update leave it -- the state
  // half is `test/port/`'s, driven through `GameUpdate`.
  G.g_player_task[0] = PlayerTask.InPlay;
  const o = G.g_damage_overlays[0]!;
  Object.assign(o, { active: 1, frames: DAMAGE_OVERLAY_FRAMES - 1, x: 0,
                     kind: DamageOverlayKind.Slash, count: 1 });
  layer.update(ctx);
  const slot = DAMAGE_OVERLAY_SLOTS[DamageOverlayKind.Slash]![0];
  check("a live record draws one node, in the camera's own space",
        layer.viewGroup.children.length === 1
        && layer.group.children.length === 0 && slot === 0x933,
        `${layer.viewGroup.children.length}/${layer.group.children.length}`);
  const node = layer.viewGroup.children[0] as InstanceType<typeof Mesh>;
  check("...at (0, 0, -1.02), unturned, scale 0.02, in draw layer 0xA",
        node.position.x === 0 && node.position.y === 0
        && node.position.z === DAMAGE_OVERLAY_Z
        && Math.abs(DAMAGE_OVERLAY_Z + 1.02) < 1e-6
        && node.quaternion.w === 1
        && node.scale.x === DAMAGE_OVERLAY_SCALES[DamageOverlayKind.Slash]
        && Math.abs(node.scale.x - 0.02) < 1e-6 && node.renderOrder === 899,
        `${node.position.toArray()} ${node.scale.x} ${node.renderOrder}`);
  const mat = node.material as Basic;
  check("...with the template's own material: the draw gives it no alpha",
        mat === mats.get(0x933));
  check("...the translucent pass TSP 0x9400041B names: SRCALPHA / "
        + "INVSRCALPHA, the alpha test at 1",
        mat.transparent && mat.blending === CustomBlending
        && mat.blendSrc === SrcAlphaFactor
        && mat.blendDst === OneMinusSrcAlphaFactor
        && mat.alphaTest === ALPHA_REF / 255 && mat.depthWrite,
        `${mat.transparent} ${mat.blending} ${mat.blendSrc} ${mat.blendDst}`);
  check("...at material alpha 1, so the texel's alpha is the whole of it",
        mat.opacity === 1, `${mat.opacity}`);

  // Every frame of its life draws the same thing.
  const looks = new Set<string>();
  for (let f = DAMAGE_OVERLAY_FRAMES - 1; f >= 1; f--) {
    o.frames = f;
    layer.update(ctx);
    const n = layer.viewGroup.children[0] as InstanceType<typeof Mesh>;
    const m = n.material as Basic;
    looks.add([m === mats.get(0x933), m.opacity, m.transparent, m.blending,
               n.visible, n.scale.x, ...n.position.toArray()].join(" "));
  }
  const varied = [...looks];
  check("no fade, flash or scale ramp over the 59 frames it is drawn",
        looks.size === 1,
        `${varied.length} different draws, first ${varied[0]}, last `
        + `${varied[varied.length - 1]}`);
  o.active = 0;
  o.frames = 0;
  layer.update(ctx);
  check("...and on the sixtieth it is gone",
        layer.viewGroup.children.length === 0);

  // The mirrored slash is the same pass; two players move it and, for the
  // gash, swap the model.
  Object.assign(o, { active: 1, frames: 30, x: 0,
                     kind: DamageOverlayKind.SlashMirrored, count: 1 });
  layer.update(ctx);
  const flip = (layer.viewGroup.children[0] as InstanceType<typeof Mesh>)
    .material as Basic;
  check("the U-flipped slash (0x939) blends the same way",
        flip === mats.get(0x939) && flip.transparent
        && flip.blendSrc === SrcAlphaFactor && flip.opacity === 1);
  Object.assign(o, { kind: DamageOverlayKind.Gash, count: 2, x: -0.22 });
  layer.update(ctx);
  const gash = layer.viewGroup.children[0] as InstanceType<typeof Mesh>;
  check("with two players the gash is 0x936, 0.22 to the left",
        gash.material === mats.get(0x936)
        && Math.abs(gash.position.x + 0.22) < 1e-6);

  // Only the two tasks that call the routine draw it.
  G.g_player_task[0] = PlayerTask.None;
  layer.update(ctx);
  check("a player not in play or on the countdown draws no overlay",
        layer.viewGroup.children.length === 0);
  G.g_player_task[0] = PlayerTask.ContinueCountdown;
  layer.update(ctx);
  check("...and one on the countdown does",
        layer.viewGroup.children.length === 1);
  ResetGameGlobals();
}

console.log("\nthe water ring is drawn from its record alone:");
{
  const root = new Obj3D();
  const part = new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial());
  part.name = "slots_effect_fixed000_slot_0e23";
  part.userData = { hod2_kind: "rig_part", hod2_rig: "slots_effect" };
  root.add(part);
  ResetGameGlobals();
  const layer = new EffectLayer();
  layer.adopt(root);
  const camera = new PerspectiveCamera(41.1, 4 / 3, 0.8, 8000);
  camera.updateMatrixWorld(true);
  const ctx = { camera } as unknown as Parameters<typeof layer.update>[0];

  // `WaterRingUpdate` (`FUN_00456880`): `T(pos) Scale(s, 0.2, s)` and the
  // record's alpha, in the world's own layer.
  G.g_water_rings.push({
    id: 2, pos: { x: 1, y: 0, z: 2 }, size: 1.5, growth: 0.02, alpha: 0.25,
    frames: 45, slot: 0xe23,
  });
  layer.update(ctx);
  const water = layer.group.children[0] as InstanceType<typeof Mesh>
    | undefined;
  const e = water?.matrix.elements ?? [];
  const ws = [Math.hypot(e[0]!, e[1]!, e[2]!), Math.hypot(e[4]!, e[5]!, e[6]!),
              Math.hypot(e[8]!, e[9]!, e[10]!)];
  check("a water ring is its size across and 0.2 high, at its point",
        water !== undefined && Math.abs(ws[0]! - 1.5) < 1e-6
        && Math.abs(ws[1]! - Math.fround(0.2)) < 1e-6
        && Math.abs(ws[2]! - 1.5) < 1e-6 && e[12] === 1 && e[14] === 2,
        JSON.stringify(ws));
  const mat = water?.material as InstanceType<typeof MeshBasicMaterial>;
  check("...at the record's alpha",
        mat?.transparent === true && Math.abs(mat.opacity - 0.25) < 1e-6,
        `${mat?.opacity}`);
  check("...drawn in the world's order, not over it",
        water?.renderOrder === 0, `${water?.renderOrder}`);
  G.g_water_rings.length = 0;
  layer.update(ctx);
  check("and a ring that has gone takes its node with it",
        layer.group.children.length === 0,
        `${layer.group.children.length}`);
  ResetGameGlobals();
}

console.log("\na ground shadow is drawn from the frame's record, in its layer:");
{
  const { ActorDrawShadow } = await import("../src/game/model_draw");
  const root = new Obj3D();
  const part = new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial());
  part.name = "slots_effect_fixed000_slot_10d0";
  part.userData = { hod2_kind: "rig_part", hod2_rig: "slots_effect" };
  root.add(part);
  ResetGameGlobals();
  const layer = new EffectLayer();
  layer.adopt(root);
  const camera = new PerspectiveCamera(41.1, 4 / 3, 0.8, 8000);
  camera.updateMatrixWorld(true);
  const ctx = { camera } as unknown as Parameters<typeof layer.update>[0];
  // `ActorDrawShadow` (`FUN_0040A590`) on an ordinary character at its own
  // height: `T(x, y + 0.1, z) Scale(11, 1, 10)`, slot 0x10D0, layer 0xD.
  ActorDrawShadow({ flags: 0, motionFlags: 1, charType: 1,
                    pos: { x: 4, y: 2, z: -6 } });
  layer.update(ctx);
  const disc = layer.group.children[0];
  const e = disc?.matrix.elements ?? [];
  check("the disc is placed at the matrix the draw recorded, in world space",
        disc !== undefined && e[12] === 4 && e[13] === Math.fround(2 + 0.1)
        && e[14] === -6 && e[0] === 11 && e[5] === 1 && e[10] === 10,
        JSON.stringify(e));
  // `SetDrawLayerNibble(0xD)` against the world's 8: drawn after the floor
  // it lies on.
  check("...in draw layer 0xD, five past the world's",
        disc?.renderOrder === 0xd - 8, `${disc?.renderOrder}`);
  G.g_world_slot_draws = [];
  layer.update(ctx);
  check("...and a frame that drew none has none",
        layer.group.children.length === 0, `${layer.group.children.length}`);
  ResetGameGlobals();
}


console.log("\nthe blood colour switch moves the map, not the shader:");
{
  // A 2x1 image and just enough WebGL to read it back. The file's own stub is
  // for text labels and has no pixel calls, so this one is local and put back.
  // The second texel is transparent, as 904 opaque-pass gore texels are: the
  // readback has to keep the colour under it, which a 2D canvas -- stored
  // premultiplied -- hands back as black. That canvas is what this used, and
  // the stub asks only for `webgl`, so going back to it fails here.
  const doc = globalThis.document;
  const px = new Uint8Array([10, 200, 30, 255, 40, 50, 60, 0]);
  const asked: string[] = [];
  const gl = {
    TEXTURE_2D: 1, FRAMEBUFFER: 2, COLOR_ATTACHMENT0: 3,
    FRAMEBUFFER_COMPLETE: 4, RGBA: 5, UNSIGNED_BYTE: 6, NONE: 0,
    createTexture: () => ({}), createFramebuffer: () => ({}),
    bindTexture: () => undefined, bindFramebuffer: () => undefined,
    pixelStorei: () => undefined, texParameteri: () => undefined,
    texImage2D: () => undefined, framebufferTexture2D: () => undefined,
    checkFramebufferStatus: () => 4,
    readPixels: (_x: number, _y: number, _w: number, _h: number,
                 _f: number, _t: number, out: Uint8Array) => out.set(px),
    deleteTexture: () => undefined, deleteFramebuffer: () => undefined,
    getExtension: () => ({ loseContext: () => undefined }),
  };
  (globalThis as unknown as { document: unknown }).document = {
    createElement: () => ({
      width: 0, height: 0,
      getContext: (kind: string) => {
        asked.push(kind);
        return kind === "webgl" ? gl : null;
      },
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
  const held = ((mat.map as { image?: { data?: Uint8Array } } | null)
    ?.image?.data) ?? new Uint8Array();
  check("...and the transpose really exchanges R and G",
        held[0] === 200 && held[1] === 10 && held[2] === 30,
        `${held[0]},${held[1]},${held[2]}`);
  check("...keeping the alpha, and the colour under a transparent texel",
        held.join() === "200,10,30,255,50,40,60,0" && asked.includes("webgl"),
        `${held.join()} via ${asked.join()}`);

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

/**
 * "Civilians' hair doesn't render".
 *
 * A civilian's head model is a shell open at the back: `hito_gal`'s bone 2 is
 * 149 vertices spanning `z 0.18..1.38`, with four vertex normals in the whole
 * model pointing backwards where every zombie head in the game has fifteen to
 * forty. What closes it is an **attachment**: `CivilianInit` (`FUN_0048A3E0`)
 * parks the spawn tail's `+0x08` pointer at `model+0x1170` and calls
 * `ActorBindPartList` (`FUN_00412440`), and `ActorDrawAttachedParts`
 * (`FUN_004124F0`) then draws an `etc_komono_*` model on bone 2 after every
 * skeleton node. The port had neither, and drew a face on a neck.
 *
 * Two halves, and this drives both:
 *
 * * an id **below** `attachment_replaces_below` binds — the bone draws the
 *   record's `hito_kao_*` model instead of its own;
 * * an id **at or above** it draws — the record's model is added to the bone.
 *
 * **Every assertion is about what the scene graph holds**, not about what a
 * layer says of itself. The failure this is written against is a layer that
 * reports the right count with nothing under the bone.
 */
console.log("\ncivilian attachments: the face swaps, the hair is added");
{
  const { CharacterLayer } = await import("../src/render/characters");
  const { RunPendingInits, SpawnScriptedCharacters } =
    await import("../src/game/director");
  const { G, ResetGameGlobals } = await import("../src/game/globals");
  const { SetGameTables } = await import("../src/game/tables");
  const { BoxGeometry, Mesh, MeshBasicMaterial, Object3D } =
    await import("three");

  /** The skeleton the exporter writes: bone 1 the torso, bone 2 the head. */
  const TYPE = {
    type: 0x26, name: "hito_gal", file: "hito_gal.bin", bone_count: 2,
    actor_radius: 10,
    bones: [
      { bone: 1, part: "bone01_0eb9", slot: 0x0eb9, offset: [0, 0, 0],
        parent: null, damage_rank: [], hit_radius: 2, steps: [] },
      { bone: 2, part: "bone02_0eaf", slot: 0x0eaf, offset: [0, 0, 0],
        parent: 0, damage_rank: [], hit_radius: 2, steps: [] },
    ],
    reactions: {}, attacks: {},
    // One authored frame, three bones' worth of BAMS: enough that `Poser`
    // runs for real rather than being stepped round.
    motions: {
      "660": { bank: "people", frames: 1, fps: 30, root: [0, 0, 0],
               rot: [0, 0, 0, 0, 0, 0, 0, 0, 0], play: 0 },
    },
  };
  // Two records: a face below the split and an accessory at it. The real
  // table is 81 rows and `g_actor_attachment_records`' own ids; these are the
  // two shapes.
  const RECORDS = [] as { bone: number; slot: number }[];
  for (let i = 0; i < 0x40; i++) RECORDS.push({ bone: -1, slot: 0 });
  RECORDS[0x04] = { bone: 2, slot: 0x0c7d };     // hito_kao_gal.bin[20]
  RECORDS[0x33] = { bone: 2, slot: 0x11dd };     // etc_komono_gal.bin[6]
  const PLACE = {
    at: 0x8620, class: 0x10, char_type: 0x26, motion: 660, hp: 0, yaw: 0,
    body_condition: 0, initial_state: 0, attack_state: 0, ring_set: 0,
    attachments: [0x04, 0x33],
  };
  const CHARS = {
    types: { "38": TYPE }, placements: [PLACE],
    attachments: RECORDS, attachment_replaces_below: 0x24,
    approach: { rings: [{ inner: 25, mid: 38, outer: 51 }],
                steps: { base: 2, mid_add: 3, outer_add: 4 },
                ring_set_for_char0: 1 },
    difficulty: { hp_delta: [0, 0, 0, 0, 0], hp_min: 1, hp_max: 300,
                  initial_rank: [0, 0, 2, 0, 0], default: 2 },
  };

  /** One template node per asset slot, exactly as `goreEntry` writes them. */
  const template = (slot: number): InstanceType<typeof Object3D> => {
    const n = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
    n.name = `gore_hito_gal_fixed000_gore_${slot.toString(16).padStart(4, "0")}`;
    n.userData = { hod2_kind: "rig_part", hod2_rig: "gore_hito_gal",
                   hod2_part: `gore_${slot.toString(16).padStart(4, "0")}` };
    return n;
  };

  const root = new Object3D();
  const rig = new Object3D();
  rig.name = "chr_hito_gal_spawn000";
  rig.userData = { hod2_kind: "rig", hod2_rig: "chr_hito_gal",
                   hod2_spawn_at: 0x8620 };
  const torso = new Object3D();
  torso.name = "chr_hito_gal_spawn000_bone01_0eb9";
  const head = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
  head.name = "chr_hito_gal_spawn000_bone02_0eaf";
  torso.add(head);
  rig.add(torso);
  root.add(rig);

  const gore = new Object3D();
  gore.name = "gore_hito_gal_fixed000";
  gore.userData = { hod2_kind: "rig", hod2_rig: "gore_hito_gal" };
  const face = template(0x0c7d);
  gore.add(face);
  gore.add(template(0x11dd));
  // The same face one mouth cel open, `hito_kao_gal.bin[21]`, for the talking
  // head below.
  const mouth = template(0x0c7e);
  gore.add(mouth);
  // A damaged torso, for the swaps below that no `setBoneSlot` announces.
  gore.add(template(0x0d00));
  root.add(gore);

  ResetGameGlobals();
  SetGameTables(CHARS as never);
  G.g_difficulty = 2;

  const chars = new CharacterLayer();
  const stage = new Scope("stage");
  chars.build(root, stage, CHARS as never);

  const headGeom = head.geometry;
  const made = SpawnScriptedCharacters(chars.readySpawns([{ at: 0x8620 }]));
  RunPendingInits();
  check("the civilian is made", made.length === 1, `${made.length}`);
  const a = made[0];
  // The bind is the port's, and it runs in `CivilianInit` -- so the actor
  // knows which head it wears before anything has drawn it.
  check("`ActorBindPartList` bound the face below the split",
        a.boneSlot["2"] === 0x0c7d, JSON.stringify(a.boneSlot));
  check("...and left the accessory for the draw",
        Object.keys(a.boneSlot).length === 1, JSON.stringify(a.boneSlot));

  a.visible = true;
  chars.syncSpawns([{ at: 0x8620 }], made);
  // **The scene, not the layer's opinion of it.** `adopt` replays
  // `a.boneSlot`, so the head bone is already wearing the swapped model
  // before a single frame has run.
  check("adopting the hierarchy swapped the head's own geometry",
        head.geometry !== headGeom, "head geometry unchanged");

  const before = head.children.length;
  chars.update({} as never);
  const added = head.children.filter((c) => (c as { isMesh?: boolean }).isMesh);
  check("a frame hangs exactly one model on the head bone",
        head.children.length === before + 1 && added.length >= 1,
        `${before} -> ${head.children.length}`);
  check("...and it is the accessory's model, not the face's",
        added.some((c) => c.name.includes("11dd"))
        && !added.some((c) => c.name.includes("0c7d")),
        added.map((c) => c.name).join(","));

  // Idempotent: the second frame must not stack a second copy.
  chars.update({} as never);
  check("a second frame adds nothing", head.children.length === before + 1,
        `${head.children.length}`);

  // **A talking head.** `CivilianDrawBonePart` (`FUN_0048D1F0`) draws bone 2
  // at its record plus a mouth cel and leaves the record alone; the port
  // writes what it drew to `nodeDrawSlot`, and the layer shows that model
  // until the hook draws the record again.
  const faceGeom = head.geometry;
  a.nodeDrawSlot[2] = 0x0c7e;
  chars.update({} as never);
  check("a head drawn as a mouth cel shows the cel's model",
        head.geometry === (mouth as InstanceType<typeof Mesh>).geometry
        && head.geometry !== faceGeom && a.boneSlot["2"] === 0x0c7d,
        "head geometry is not the cel's");
  check("...with the accessory still on it",
        head.children.some((c) => c.name.includes("11dd")),
        head.children.map((c) => c.name).join(","));
  a.nodeDrawSlot[2] = 0x0c7d;
  chars.update({} as never);
  check("...and the face its record names once the hook draws the record",
        head.geometry === faceGeom
        && head.geometry === (face as InstanceType<typeof Mesh>).geometry,
        "head geometry is not the face's");

  // And a snapshot carries it: the ids are on the actor, the nodes are not.
  chars.resync({} as never);
  chars.update({} as never);
  check("resync leaves the accessory in place",
        head.children.filter((c) => (c as { isMesh?: boolean }).isMesh)
          .length === added.length,
        `${head.children.length}`);

  // **A swap no `setBoneSlot` announced.** A netplay replica runs no port, so
  // a hit's swap reaches it only as `a.boneSlot` changing under the layer --
  // and a respawn as a new object at the same spawn, or, when the codec
  // cannot tell, as the same object starting its lists again.
  const torn = () => torso.children.filter((c) => c.name.includes("0d00")).length;
  a.boneSlot["1"] = 0x0d00;
  chars.update({} as never);
  check("a swap written only on the actor is drawn on the next frame", torn() === 1,
        `${torn()} damaged torsos`);
  chars.update({} as never);
  check("...once", torn() === 1, `${torn()}`);
  a.removed.push(2);
  chars.update({} as never);
  check("a severed head written only on the actor is hidden", !head.visible);
  delete a.boneSlot["1"];
  a.removed.length = 0;
  chars.update({} as never);
  check("the same object starting a new life gets its nodes back",
        head.visible && torn() === 0 && head.geometry !== headGeom,
        `head ${head.visible}, ${torn()} damaged torsos`);
  a.boneSlot["1"] = 0x0d00;
  a.removed.push(2);
  chars.update({} as never);
  const reborn = { ...a, boneSlot: { "2": 0x0c7d }, removed: [] as number[] };
  chars.bindToPool([reborn]);
  chars.update({} as never);
  check("a new object at the same spawn is a new life: the old one's damage comes off",
        head.visible && torn() === 0 && head.geometry !== headGeom,
        `head ${head.visible}, ${torn()} damaged torsos`);

  stage.dispose();
}

/**
 * **A talking head that is several meshes keeps its head.**
 *
 * Bug: "sometimes when characters are speaking their whole head disappears".
 * glTF loads a bone node with more than one primitive as a `Group` of meshes
 * -- every player character's head is one, nine meshes for `char_adv05` --
 * and `swapGore` shows a cel on such a bone by hiding the bone's own meshes
 * and hanging a clone of the cel beside them. When the hook drew the head's
 * own record again, the layer called `restoreGore`, which took the clone off
 * and **never showed the hidden meshes again**: after the first line, and
 * after every blink, the head was gone. The same swap hid an accessory hung
 * on the bone, which `ActorDrawAttachedParts` (`FUN_004124F0`) draws with no
 * gate at all.
 */
console.log("\na multi-mesh head through a mouth cel and back: nothing goes missing");
{
  const { CharacterLayer } = await import("../src/render/characters");
  const { RunPendingInits, SpawnScriptedCharacters } =
    await import("../src/game/director");
  const { G, ResetGameGlobals } = await import("../src/game/globals");
  const { SetGameTables } = await import("../src/game/tables");
  const { BoxGeometry, Mesh, MeshBasicMaterial, Object3D } =
    await import("three");

  const TYPE = {
    type: 0x3d, name: "player_gold", file: "player_gold.bin", bone_count: 2,
    actor_radius: 10,
    bones: [
      { bone: 1, part: "bone01_0d20", slot: 0x0d20, offset: [0, 0, 0],
        parent: null, damage_rank: [], hit_radius: 2, steps: [] },
      { bone: 2, part: "bone02_0d27", slot: 0x0d27, offset: [0, 0, 0],
        parent: 0, damage_rank: [], hit_radius: 2, steps: [] },
    ],
    reactions: {}, attacks: {},
    motions: {
      "660": { bank: "people", frames: 1, fps: 30, root: [0, 0, 0],
               rot: [0, 0, 0, 0, 0, 0, 0, 0, 0], play: 0 },
    },
  };
  const RECORDS = [] as { bone: number; slot: number }[];
  for (let i = 0; i < 0x40; i++) RECORDS.push({ bone: -1, slot: 0 });
  RECORDS[0x33] = { bone: 2, slot: 0x11dd };
  const PLACE = {
    at: 0x8b74, class: 0x10, char_type: 0x3d, motion: 660, hp: 0, yaw: 0,
    body_condition: 0, initial_state: 0, attack_state: 0, ring_set: 0,
    attachments: [0x33],
  };
  const CHARS = {
    types: { "61": TYPE }, placements: [PLACE],
    attachments: RECORDS, attachment_replaces_below: 0x24,
    approach: { rings: [{ inner: 25, mid: 38, outer: 51 }],
                steps: { base: 2, mid_add: 3, outer_add: 4 },
                ring_set_for_char0: 1 },
    difficulty: { hp_delta: [0, 0, 0, 0, 0], hp_min: 1, hp_max: 300,
                  initial_rank: [0, 0, 2, 0, 0], default: 2 },
  };
  const template = (slot: number): InstanceType<typeof Object3D> => {
    const n = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
    const s = slot.toString(16).padStart(4, "0");
    n.name = `gore_player_gold_fixed000_gore_${s}`;
    n.userData = { hod2_kind: "rig_part", hod2_rig: "gore_player_gold",
                   hod2_part: `gore_${s}` };
    return n;
  };

  const root = new Object3D();
  const rig = new Object3D();
  rig.name = "chr_player_gold_spawn000";
  rig.userData = { hod2_kind: "rig", hod2_rig: "chr_player_gold",
                   hod2_spawn_at: 0x8b74 };
  const torso = new Object3D();
  torso.name = "chr_player_gold_spawn000_bone01_0d20";
  // The head as glTF loads a node with two primitives: a group of meshes.
  const head = new Object3D();
  head.name = "chr_player_gold_spawn000_bone02_0d27";
  const face = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
  const hair = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
  head.add(face, hair);
  torso.add(head);
  rig.add(torso);
  root.add(rig);
  const gore = new Object3D();
  gore.name = "gore_player_gold_fixed000";
  gore.userData = { hod2_kind: "rig", hod2_rig: "gore_player_gold" };
  gore.add(template(0x11dd));
  gore.add(template(0x0d28));      // player_gold.bin[6], his first mouth cel
  root.add(gore);

  ResetGameGlobals();
  SetGameTables(CHARS as never);
  G.g_difficulty = 2;
  const chars = new CharacterLayer();
  const stage = new Scope("stage");
  chars.build(root, stage, CHARS as never);
  const made = SpawnScriptedCharacters(chars.readySpawns([{ at: 0x8b74 }]));
  RunPendingInits();
  const a = made[0];
  a.visible = true;
  chars.syncSpawns([{ at: 0x8b74 }], made);
  chars.update({} as never);

  const own = () => face.visible && hair.visible;
  const hat = () => head.children.find((c) => c.name.includes("11dd"));
  const cel = () => head.children.filter((c) => c.name.includes("0d28")
                                           && c.visible).length;
  check("the multi-mesh head shows its own meshes and its accessory",
        own() && !!hat()?.visible, `own ${own()}, hat ${hat()?.visible}`);

  a.nodeDrawSlot[2] = 0x0d28;
  chars.update({} as never);
  check("a mouth cel hides the head's own meshes and shows the cel",
        !face.visible && !hair.visible && cel() === 1, `cel ${cel()}`);
  check("...and leaves the accessory on",
        !!hat()?.visible, `hat ${hat()?.visible}`);

  a.nodeDrawSlot[2] = 0x0d27;
  chars.update({} as never);
  check("drawn as its record again, the head's own meshes come back",
        own() && cel() === 0, `own ${own()}, cel ${cel()}`);
  check("...with the accessory still on", !!hat()?.visible,
        `hat ${hat()?.visible}`);

  // Through it twice, as a blink does every hundred and fifty frames.
  a.nodeDrawSlot[2] = 0x0d28;
  chars.update({} as never);
  a.nodeDrawSlot[2] = 0x0d27;
  chars.update({} as never);
  check("and a second time round", own() && cel() === 0 && !!hat()?.visible,
        `own ${own()}, cel ${cel()}, hat ${hat()?.visible}`);
  stage.dispose();
}

/**
 * **Where a civilian holds her item, and that she lets go of it.**
 *
 * Bug: "rescued civilians don't have the item they present to you in
 * precisely the right part of their hand. And they still carry it after you
 * should receive its effect".
 *
 * `CivilianDrawHeldItems` (`FUN_0048CD10`) sets the top to the bone's record
 * and then post-multiplies `RotX(rec+0xC) RotZ(rec+0x14) RotY(rec+0x10)
 * T(set.xyz) Scale(set.w)`, so the translate is along the *turned* axes. The
 * layer used to put the node at `t` and turn it about its own origin. The
 * expected frames here are worked by hand from the record, not read back
 * from the layer: record `0x0056B190` (the extra life) is `X 0x4000, Z
 * 0xC000` and `t = (0, 1, 1)`, which puts the item's origin at `(1, -1, 0)`
 * in the hand's frame with its X along the hand's -Z, its Y along +X and its
 * Z along -Y. Record `0x0056B390` (kind 4) adds a scale of 0.8 and its own
 * second slot in the same matrix, and a set that differs by character type.
 */
console.log("\ncivilian held items: on the hand as the draw puts them, and gone once given");
{
  const { CharacterLayer } = await import("../src/render/characters");
  const { RunPendingInits, SpawnScriptedCharacters } =
    await import("../src/game/director");
  const { G, ResetGameGlobals } = await import("../src/game/globals");
  const { SetGameTables } = await import("../src/game/tables");
  const { CivilianOp, CivilianUpdate } = await import("../src/game/class10");
  const { NULL_HOST } = await import("../src/game/host");
  const { Rng } = await import("../src/core/rng");
  const { Events } = await import("../src/core/events");
  const { BoxGeometry, Matrix4, Mesh, MeshBasicMaterial, Object3D, Vector3 } =
    await import("three");

  const TYPE = {
    type: 0x26, name: "hito_gal", file: "hito_gal.bin", bone_count: 2,
    actor_radius: 10,
    bones: [
      { bone: 1, part: "bone01_0eb9", slot: 0x0eb9, offset: [0, 0, 0],
        parent: null, damage_rank: [], hit_radius: 2, steps: [] },
      { bone: 5, part: "bone05_0eb0", slot: 0x0eb0, offset: [0, 0, 0],
        parent: 0, damage_rank: [], hit_radius: 2, steps: [] },
    ],
    reactions: {}, attacks: {},
    motions: {
      "660": { bank: "people", frames: 1, fps: 30, root: [0, 0, 0],
               rot: [0, 0, 0, 0, 0, 0, 0, 0, 0], play: 0 },
    },
  };
  const AT = 0x8620;
  const CHARS = {
    types: { "38": TYPE },
    placements: [{
      at: AT, class: 0x10, char_type: 0x26, motion: 660, hp: 0, yaw: 0,
      body_condition: 0, initial_state: 0, attack_state: 0, ring_set: 0,
    }],
    attachments: [], attachment_replaces_below: 0x24,
    approach: { rings: [{ inner: 25, mid: 38, outer: 51 }],
                steps: { base: 2, mid_add: 3, outer_add: 4 },
                ring_set_for_char0: 1 },
    difficulty: { hp_delta: [0, 0, 0, 0, 0], hp_min: 1, hp_max: 300,
                  initial_rank: [0, 0, 2, 0, 0], default: 2 },
  };
  const sets = (rows: number[][]) =>
    rows as [number, number, number, number][];
  const LIFE = {
    bone: 5, slot: 0x10c3, kind: -1, extra: null,
    rot: [0x4000, 0, 0xc000] as [number, number, number],
    sets: sets(Array.from({ length: 6 }, () => [0, 1, 1, 1])),
    callback: 0x0048dcc0, banner: null,
  };
  // Record `0x0056B390` as the exporter reads it: set 5 differs.
  const KIND4 = {
    bone: 5, slot: 0x10a8, kind: 4, extra: 0x10a7,
    rot: [0xb83a, 0x7a8a, 0xb51f] as [number, number, number],
    sets: sets([[0.5, -0.6, 1.1, 0.8], [0.5, -0.6, 1.1, 0.8],
                [0.5, -0.6, 1.1, 0.8], [0.5, -0.6, 1.1, 0.8],
                [0.5, -0.6, 1.1, 0.8], [0, -0.6, 1.1, 0.8]]),
    callback: 0x0048dd60, banner: 0x5c1,
  };
  const cmd = (op: number, ...args: number[]) => ({ op, args });
  const CIV = {
    entries: [0],
    scripts: [[
      cmd(CivilianOp.Wait, 0),
      { op: CivilianOp.AddHeldItem, args: [0x0056b190, 0x800000], item: 0 },
      { op: CivilianOp.AddHeldItem, args: [0x0056b390, 0x800000], item: 1 },
      cmd(CivilianOp.SetTimer, 3),
      // `0x940100` less the loop wait, which holds only while a clip plays.
      cmd(CivilianOp.Wait, 0x940000),
      cmd(CivilianOp.Wait, 0),
      cmd(CivilianOp.End),
    ]],
    items: [LIFE, KIND4],
    // A removal cue on no path the test plays: `CamPathCueReached(-1, 0)`
    // is met by the reset's `g_active_cam_path` of -1, and she would leave.
    spawns: { [String(AT)]: { charType: 0x26, script: 0, removePath: 999,
                              removeFrame: 0, removeDelay: 0, children: [] } },
  };

  const template = (slot: number): InstanceType<typeof Object3D> => {
    const n = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
    n.name = `gore_hito_gal_fixed000_gore_${slot.toString(16).padStart(4, "0")}`;
    n.userData = { hod2_kind: "rig_part", hod2_rig: "gore_hito_gal",
                   hod2_part: `gore_${slot.toString(16).padStart(4, "0")}` };
    return n;
  };
  const root = new Object3D();
  const rig = new Object3D();
  rig.name = "chr_hito_gal_spawn000";
  rig.userData = { hod2_kind: "rig", hod2_rig: "chr_hito_gal",
                   hod2_spawn_at: AT };
  const torso = new Object3D();
  torso.name = "chr_hito_gal_spawn000_bone01_0eb9";
  const hand = new Object3D();
  hand.name = "chr_hito_gal_spawn000_bone05_0eb0";
  // A hand that is not at the origin nor square to the world, so a frame
  // taken in the wrong space cannot pass by accident.
  hand.position.set(3, 7, -2);
  hand.rotation.set(0.3, -0.7, 0.2);
  torso.add(hand);
  rig.add(torso);
  root.add(rig);
  const gore = new Object3D();
  gore.name = "gore_hito_gal_fixed000";
  gore.userData = { hod2_kind: "rig", hod2_rig: "gore_hito_gal" };
  for (const slot of [0x10c3, 0x10a8, 0x10a7]) gore.add(template(slot));
  root.add(gore);

  ResetGameGlobals();
  SetGameTables(CHARS as never, undefined, undefined, undefined, undefined,
                CIV as never);
  G.g_difficulty = 2;
  const chars = new CharacterLayer();
  chars.civilians = CIV as never;
  const stage = new Scope("stage");
  chars.build(root, stage, CHARS as never);
  const made = SpawnScriptedCharacters(chars.readySpawns([{ at: AT }]));
  RunPendingInits();
  const a = made[0];
  a.visible = true;
  chars.syncSpawns([{ at: AT }], made);
  const rng = new Rng(1);
  const events = new Events();
  const frame = () => CivilianUpdate(a, { dt: 1 / 60, rng, host: NULL_HOST,
                                          events });
  frame();
  chars.update({} as never);

  /** `slot`'s model under the hand, in the hand's own frame. */
  const inHand = (slot: number) => {
    let found: InstanceType<typeof Object3D> | null = null;
    hand.traverse((o) => {
      if (!found && (o as { isMesh?: boolean }).isMesh
          && o.name.endsWith(slot.toString(16).padStart(4, "0"))) found = o;
    });
    if (!found) return null;
    const f = found as InstanceType<typeof Object3D>;
    f.updateWorldMatrix(true, false);
    return new Matrix4().copy(hand.matrixWorld).invert()
      .multiply(f.matrixWorld);
  };
  const near = (m: InstanceType<typeof Matrix4>, want: number[]) =>
    m.elements.every((v, i) => Math.abs(v - want[i]) < 1e-4);
  const fmt = (m: InstanceType<typeof Matrix4> | null) =>
    m ? m.elements.map((v) => v.toFixed(3)).join(",") : "none";

  // Column-major, as `Matrix4.elements` is: X axis, Y axis, Z axis, origin.
  const life = inHand(0x10c3);
  check("the extra life sits where the draw puts it: origin (1, -1, 0) in "
        + "the hand, X along -Z, Y along +X, Z along -Y",
        !!life && near(life, [0, 0, -1, 0, 1, 0, 0, 0, 0, -1, 0, 0,
                              1, -1, 0, 1]),
        fmt(life));

  // Record `0x0056B390` in attach set 1: `Rx(0xB83A) Rz(0xB51F)
  // Ry(0x7A8A) T(0.5, -0.6, 1.1) S(0.8)`, by the textbook matrices.
  const rad = (b: number) => b * (2 * Math.PI / 65536);
  const rx = (t: number) => new Matrix4().makeRotationX(t);
  const expect = new Matrix4()
    .multiply(rx(rad(0xb83a)))
    .multiply(new Matrix4().makeRotationZ(rad(0xb51f)))
    .multiply(new Matrix4().makeRotationY(rad(0x7a8a)))
    .multiply(new Matrix4().makeTranslation(0.5, -0.6, 1.1))
    .multiply(new Matrix4().makeScale(0.8, 0.8, 0.8));
  const k4 = inHand(0x10a8);
  check("a scaled item: turned, then moved along the turned axes by its "
        + "character's attach set, then scaled",
        !!k4 && near(k4, expect.elements), `${fmt(k4)} want ${fmt(expect)}`);
  const origin = new Vector3().setFromMatrixPosition(expect);
  check("...which is not where the offset alone would put it",
        origin.distanceTo(new Vector3(0.5, -0.6, 1.1)) > 0.5,
        `${origin.x}, ${origin.y}, ${origin.z}`);
  const k4b = inHand(0x10a7);
  check("...and kind 4's second slot is drawn in the same matrix",
        !!k4b && near(k4b, expect.elements), fmt(k4b));

  // Given: the wait word's `0x800000` is the first entry's routine's to take.
  // `CivilianHeldItemGrantLife` clears it from the word (`NOT EAX; AND EAX,
  // EDX` at `0x0048DCD6`) before the second entry's routine looks, so one
  // word gives one item -- every shipped stream appends exactly one.
  const lives = G.g_player_lives.join();
  for (let i = 0; i < 10 && (a.civ?.items.length ?? 0) > 1; i++) {
    frame();
    chars.update({} as never);
  }
  check("on the frame she gives it the hand still shows it -- the engine "
        + "draws before it calls the record's routine",
        a.civ?.items.length === 1 && !!inHand(0x10c3),
        `items ${JSON.stringify(a.civ?.items)}`);
  frame();
  chars.update({} as never);
  check("...and on the next the life is gone from the hand, paid",
        !inHand(0x10c3) && G.g_player_lives.join() !== lives,
        `lives ${lives} -> ${G.g_player_lives.join()}`);
  check("...while the second item, whose routine found the bit already "
        + "taken, is still held where it was",
        a.civ?.items.length === 1 && a.civ.items[0].record === 1
        && !!inHand(0x10a8) && near(inHand(0x10a8)!, expect.elements),
        `items ${JSON.stringify(a.civ?.items)}`);

  stage.dispose();
  G.g_object_list.length = 0;
}

/**
 * **The model's size, `model+0x116C`, on every skinned actor.**
 *
 * `SkeletonApplyRootMotion` (`FUN_00410C50`) draws `T(obj+0x40)`, the actor's
 * rotation, then `MatrixScale(model+0x116C)` (`0x00410FEA`..`0x00410FF7`) and
 * only then the pose translate and the bones -- so a civilian, whose
 * character type the build sizes at 0.9, is 0.9 of her model everywhere: the
 * pose offset, every bone, every hit centre. The radius is the one part of a
 * sphere the matrix does not reach, and the build scaled it instead
 * (`SkeletonWalkNode`, `FUN_004107E0`, `0x00410837`).
 *
 * The port drew every skinned actor at 1.0 but the bat. Each assertion here is
 * about what the scene graph and the two shot queries answer, and each fails
 * on a root drawn at 1.0: the bone lands at `(102, 21, -53)` rather than
 * `(101.8, 18.9, -52.7)`, and the sphere is 1.5 wide and in the wrong place.
 */
console.log("\nthe model's size: a civilian at 0.9, her bones and her spheres");
{
  const { CharacterLayer } = await import("../src/render/characters");
  const { RunPendingInits, SpawnScriptedCharacters } =
    await import("../src/game/director");
  const { G, ResetGameGlobals } = await import("../src/game/globals");
  const { SetGameTables } = await import("../src/game/tables");
  const { MotionFlag } = await import("../src/game/actor");
  const { Object3D, Vector3 } = await import("three");

  // `hito_gal`'s shape: bone 1 the torso at the root, bone 2 the head ten up
  // it, each with a sphere a unit along its own y, whose row names the node's
  // own slot -- which is what `SkeletonWalkNode` tests before it takes one.
  const TYPE = {
    type: 0x26, name: "hito_gal", file: "hito_gal.bin", bone_count: 3,
    actor_radius: 10,
    bones: [
      { bone: 1, part: "bone01_0eb9", slot: 0x0eb9, offset: [0, 0, 0],
        parent: null, damage_rank: [], hit_radius: 2, hit_centre: [0, 1, 0],
        hit_slot: 0x0eb9, steps: [] },
      { bone: 2, part: "bone02_0eaf", slot: 0x0eaf, offset: [0, 10, 0],
        parent: 0, damage_rank: [], hit_radius: 1.5, hit_centre: [0, 1, 0],
        hit_slot: 0x0eaf, steps: [] },
    ],
    reactions: {}, attacks: {},
    // One frame whose root sits off the origin in all three axes, and no
    // rotation anywhere: the pose offset is then the whole of what moves the
    // bones off the actor's position.
    motions: {
      "660": { bank: "people", frames: 1, fps: 30, root: [2, 11, -3],
               rot: [0, 0, 0, 0, 0, 0, 0, 0, 0], play: 0 },
    },
  };
  const AT = 0x8640;
  const PLACE = {
    at: AT, class: 0x10, char_type: 0x26, motion: 660, hp: 0, yaw: 0,
    body_condition: 0, initial_state: 0, attack_state: 0, ring_set: 0,
  };
  const CHARS = {
    types: { "38": TYPE }, placements: [PLACE],
    approach: { rings: [{ inner: 25, mid: 38, outer: 51 }],
                steps: { base: 2, mid_add: 3, outer_add: 4 },
                ring_set_for_char0: 1 },
    difficulty: { hp_delta: [0, 0, 0, 0, 0], hp_min: 1, hp_max: 300,
                  initial_rank: [0, 0, 2, 0, 0], default: 2 },
  };

  const root = new Object3D();
  const rig = new Object3D();
  rig.name = "chr_hito_gal_spawn000";
  rig.userData = { hod2_kind: "rig", hod2_rig: "chr_hito_gal",
                   hod2_spawn_at: AT };
  const torso = new Object3D();
  torso.name = "chr_hito_gal_spawn000_bone01_0eb9";
  const head = new Object3D();
  head.name = "chr_hito_gal_spawn000_bone02_0eaf";
  // Where the exporter puts a bone: at its offset in its parent's frame.
  head.position.set(0, 10, 0);
  torso.add(head);
  rig.add(torso);
  root.add(rig);

  ResetGameGlobals();
  SetGameTables(CHARS as never);
  G.g_difficulty = 2;
  const chars = new CharacterLayer();
  const stage = new Scope("stage");
  chars.build(root, stage, CHARS as never);
  const made = SpawnScriptedCharacters(chars.readySpawns([{ at: AT }]));
  RunPendingInits();
  const a = made[0];
  check("the civilian is made, at her type's 0.9",
        made.length === 1 && a.scale === Math.fround(0.9), `${a?.scale}`);
  const s = a.scale;
  a.visible = true;
  a.pos.x = 100; a.pos.y = 0; a.pos.z = -50;
  a.yaw = 0;
  a.motion = 660;
  // The gate clear, so the pose takes the clip's whole root -- the arm the
  // `people.bin` clips 596, 598 and 600 are posed with.
  a.motionFlags &= ~MotionFlag.RootMotion;
  chars.syncSpawns([{ at: AT }], made);
  chars.update({} as never);

  check("her root is drawn at her size", rig.scale.x === s
        && rig.scale.y === s && rig.scale.z === s, rig.scale.toArray().join());
  const near = (v: { x: number; y: number; z: number },
                x: number, y: number, z: number) =>
    Math.hypot(v.x - x, v.y - y, v.z - z) < 1e-4;
  const at = (x: number, y: number, z: number) =>
    [100 + s * x, s * y, -50 + s * z] as const;
  const w = { x: 0, y: 0, z: 0 };
  check("the head is where the scaled pose puts it: the offset and the bone "
        + "both 0.9 of the clip's",
        chars.boneWorld(AT, 2, w) && near(w, ...at(2, 21, -3)),
        `${w.x.toFixed(3)} ${w.y.toFixed(3)} ${w.z.toFixed(3)}`);
  const c = new Vector3();
  const r = chars.boneSphere(AT, 2, c);
  check("the head's sphere: its centre through the scaled bone",
        near(c, ...at(2, 22, -3)), c.toArray().map((v) => v.toFixed(3)).join());
  check("...and its radius the build's, 0.9 of the table's 1.5",
        r === Math.fround(s * 1.5), `${r}`);

  // The shot, through the same sphere: along -z past the centre, 1.30 and
  // 1.40 to one side -- inside 1.35 and outside it, both inside the table's
  // own 1.5.
  const shot = (dx: number) => chars.pickShot({
    origin: { x: c.x + dx, y: c.y, z: 0 }, dir: { x: 0, y: 0, z: -1 } });
  const hit = shot(1.3);
  check("a shot 1.30 off the centre hits the head",
        hit?.kind === "actor" && hit.at === AT && hit.bone === 2,
        JSON.stringify(hit));
  check("...and one 1.40 off misses it, inside the table's radius and "
        + "outside hers", shot(1.4) === null, JSON.stringify(shot(1.4)));

  // Op 0x27, the one later writer of the size: the whole drawing follows it,
  // and the radii stay the build's.
  a.scale = 50;
  chars.update({} as never);
  check("a size written after the build is the size she is drawn at",
        rig.scale.x === 50, `${rig.scale.x}`);
  check("...and leaves her radii where the build put them",
        chars.boneSphere(AT, 2, c) === Math.fround(s * 1.5),
        `${chars.boneSphere(AT, 2, c)}`);
  a.scale = s;
  chars.update({} as never);

  // **The centre is the record's too.** `ResolveDamagedPartSphere`
  // (`FUN_004099A0`) writes a swapped part's own row into `+0x78` and
  // `+0x7C..+0x84` -- unscaled radius, centre in the bone's space -- and both
  // the pick and the blood read them there. The pick used to take the centre
  // from the bundle's row whatever the actor's record said.
  a.boneCentre["2"] = [0, 4, 0];
  a.boneRadius["2"] = 1;
  const c2 = new Vector3();
  const r2 = chars.boneSphere(AT, 2, c2);
  check("a centre written over the build's is where the sphere is",
        near(c2, ...at(2, 25, -3)) && r2 === 1,
        `${c2.toArray().map((v) => v.toFixed(3)).join()} r ${r2}`);
  const shotAt = (y: number) => chars.pickShot({
    origin: { x: c2.x, y, z: 0 }, dir: { x: 0, y: 0, z: -1 } });
  const met = shotAt(c2.y);
  check("...and the shot meets it there",
        met?.kind === "actor" && met.bone === 2, JSON.stringify(met));
  check("...and not at the row's centre any more",
        shotAt(c.y) === null, JSON.stringify(shotAt(c.y)));


  stage.dispose();
  G.g_object_list.length = 0;
}

/**
 * The vertex-blended parts: what three.js actually does with the skin the
 * exporter writes, and the veto that stops the rigid twin being drawn too.
 *
 * `DeformCharacterPartGroup` (`FUN_00419980`) puts a vertex at
 * `group_bone_matrix * source_vertex` and nothing else — the draw bone's
 * matrix that `DrawCharacterPartSlot` (`FUN_00419B40`) sets is cancelled by
 * the inverse the deform pre-multiplies. The exporter says that in glTF as one
 * joint per vertex, weight 1, and **no inverse bind matrices**, which glTF
 * defines as identity.
 *
 * That is a claim about three.js, not about the exe, and it is the risky half:
 * a skinned mesh also carries a bind matrix and a bind-matrix inverse, and
 * getting either wrong gives a result that is plausible and wrong. So the
 * first block checks the premise directly, with the real `SkinnedMesh` —
 * including from a mesh node that is **not** at the origin, because the
 * exporter hangs these under a rig root the player moves every frame.
 */
console.log("\nvertex-blended parts: one joint, weight 1, identity binds");
{
  const { Bone, BufferAttribute, BufferGeometry, Matrix4, MeshBasicMaterial,
          Object3D, Skeleton, SkinnedMesh, Vector3 } = await import("three");

  const root = new Object3D();
  root.position.set(100, 7, -40);
  root.rotation.set(0, 1.1, 0);

  // Two joints: the chest and the pelvis, as the waist's groups name them.
  // `Bone`, because that is what `GLTFLoader` makes of a node a skin names --
  // which is exactly why the exporter names *proxies* and not the bone nodes
  // themselves.
  const chest = new Bone();
  chest.position.set(0, 5, 0);
  const pelvis = new Bone();
  pelvis.position.set(0, 1, 0);
  root.add(chest);
  root.add(pelvis);

  const g = new BufferGeometry();
  // Two vertices, one per joint, at the same place in their own bone's space.
  g.setAttribute("position", new BufferAttribute(
    new Float32Array([0, 0, 0, 0, 0, 0]), 3));
  g.setAttribute("skinIndex", new BufferAttribute(
    new Uint16Array([0, 0, 0, 0, 1, 0, 0, 0]), 4));
  g.setAttribute("skinWeight", new BufferAttribute(
    new Float32Array([1, 0, 0, 0, 1, 0, 0, 0]), 4));
  const mesh = new SkinnedMesh(g, new MeshBasicMaterial());
  // Where the exporter puts it: a child of the rig root, no transform of its
  // own, bound with the identity exactly as `GLTFLoader` binds a glTF skin.
  root.add(mesh);
  mesh.bind(new Skeleton([chest, pelvis], [new Matrix4(), new Matrix4()]),
            new Matrix4());
  root.updateMatrixWorld(true);

  const v0 = mesh.applyBoneTransform(0, new Vector3(0, 0, 0));
  const v1 = mesh.applyBoneTransform(1, new Vector3(0, 0, 0));
  mesh.localToWorld(v0);
  mesh.localToWorld(v1);
  const chestW = chest.getWorldPosition(new Vector3());
  const pelvisW = pelvis.getWorldPosition(new Vector3());
  check("a vertex lands on its own joint, in world space",
        v0.distanceTo(chestW) < 1e-4 && v1.distanceTo(pelvisW) < 1e-4,
        `${v0.toArray()} vs ${chestW.toArray()}`);
  check("...and the two joints are not the same place, so that meant something",
        chestW.distanceTo(pelvisW) > 1,
        `${chestW.distanceTo(pelvisW)}`);

  // The half that would silently double-apply: the mesh hangs under a moved,
  // rotated root, and attached bind mode is what cancels it.
  root.position.set(-3, 12, 900);
  root.updateMatrixWorld(true);
  const v2 = mesh.applyBoneTransform(0, new Vector3(0, 0, 0));
  mesh.localToWorld(v2);
  check("moving the rig moves the vertex exactly as far as the joint",
        v2.distanceTo(chest.getWorldPosition(new Vector3())) < 1e-4,
        `${v2.toArray()}`);

  // And a bone rotating carries its own vertices and not the other joint's.
  chest.rotation.set(0, 0, 0.9);
  chest.position.set(2, 5, 3);
  root.updateMatrixWorld(true);
  const v3 = mesh.applyBoneTransform(0, new Vector3(1, 0, 0));
  mesh.localToWorld(v3);
  const want = new Vector3(1, 0, 0).applyMatrix4(chest.matrixWorld);
  check("a source vertex is read in its bone's local space",
        v3.distanceTo(want) < 1e-4, `${v3.toArray()} vs ${want.toArray()}`);

  check("a SkinnedMesh is still a Mesh, so nothing that classifies nodes moves",
        (mesh as unknown as { isMesh?: boolean }).isMesh === true);
}

/**
 * The veto: `SkeletonNodeDrawSuppressed` (`FUN_004122E0`).
 *
 * Ten character types draw their pelvis model twice — once rigidly at bone 9
 * and once as the vertex-blended skirt, whose asset slot *is* that model — and
 * the engine's answer is to skip bone 9's own draw. The port decides it in
 * `game/parts.ts` and the renderer only applies it.
 *
 * **What the scene has to hold is the awkward part.** Bone 9 carries both its
 * own geometry and the two legs, so hiding the node hides the legs. The
 * assertions are therefore about `layers` and `visible` separately, and about
 * a child bone still being drawn.
 */
console.log("\nthe pelvis veto: bone 9's own draw, and not its legs");
{
  const { CharacterLayer } = await import("../src/render/characters");
  const { RunPendingInits, SpawnScriptedCharacters } =
    await import("../src/game/director");
  const { G, ResetGameGlobals } = await import("../src/game/globals");
  const { SetGameTables } = await import("../src/game/tables");
  const { PELVIS_VETO_SLOTS } = await import("../src/game/parts");
  const { BoxGeometry, Mesh, MeshBasicMaterial, Object3D } =
    await import("three");

  /** `hito_gal`: bone 9 draws 0x0EB6, and so does its part 1. */
  const VETOED = 0x0eb6;
  /** `hito_man`: two parts, but part 1's slot is not bone 9's. */
  const PLAIN = 0x0f31;
  check("the ten literals are the exe's, and the fixture uses one of them",
        PELVIS_VETO_SLOTS.includes(VETOED)
        && !PELVIS_VETO_SLOTS.includes(PLAIN),
        PELVIS_VETO_SLOTS.map((s) => s.toString(16)).join(","));

  const typeFor = (ct: number, pelvis: number) => ({
    type: ct, name: `t${ct}`, file: "t.bin", bone_count: 2, actor_radius: 10,
    bones: [
      { bone: 9, part: `bone09_${pelvis.toString(16)}`, slot: pelvis,
        offset: [0, 0, 0], parent: null, damage_rank: [], hit_radius: 2,
        steps: [] },
      { bone: 10, part: "bone10_1111", slot: 0x1111, offset: [0, 0, 0],
        parent: 0, damage_rank: [], hit_radius: 2, steps: [] },
    ],
    reactions: {}, attacks: {},
    motions: { "660": { bank: "b", frames: 1, fps: 30, root: [0, 0, 0],
                        rot: [0, 0, 0, 0, 0, 0, 0, 0, 0], play: 0 } },
  });
  const place = (at: number, ct: number) => ({
    at, class: 0x10, char_type: ct, motion: 660, hp: 0, yaw: 0,
    body_condition: 0, initial_state: 0, attack_state: 0, ring_set: 0,
  });
  const CHARS = {
    types: { "38": typeFor(0x26, VETOED), "46": typeFor(0x2e, PLAIN) },
    placements: [place(0x10, 0x26), place(0x20, 0x2e)],
    approach: { rings: [{ inner: 25, mid: 38, outer: 51 }],
                steps: { base: 2, mid_add: 3, outer_add: 4 },
                ring_set_for_char0: 1 },
    difficulty: { hp_delta: [0, 0, 0, 0, 0], hp_min: 1, hp_max: 300,
                  initial_rank: [0, 0, 2, 0, 0], default: 2 },
  };

  const root = new Object3D();
  const legs = new Map<number, InstanceType<typeof Object3D>>();
  const pelvises = new Map<number, InstanceType<typeof Object3D>>();
  for (const [at, ct, slot] of [[0x10, 0x26, VETOED],
                                [0x20, 0x2e, PLAIN]] as const) {
    const rig = new Object3D();
    rig.name = `chr_t${ct}_spawn000`;
    rig.userData = { hod2_kind: "rig", hod2_rig: `chr_t${ct}`,
                     hod2_spawn_at: at };
    // Bone 9 is a Mesh with the leg as its child -- the exporter's own shape,
    // and the one that makes `visible = false` the wrong tool.
    const pelvis = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
    pelvis.name = `chr_t${ct}_spawn000_bone09_${slot.toString(16)}`;
    const leg = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
    leg.name = `chr_t${ct}_spawn000_bone10_1111`;
    pelvis.add(leg);
    rig.add(pelvis);
    root.add(rig);
    pelvises.set(ct, pelvis);
    legs.set(ct, leg);
  }

  ResetGameGlobals();
  SetGameTables(CHARS as never);
  G.g_difficulty = 2;
  const chars = new CharacterLayer();
  const stage = new Scope("stage");
  chars.build(root, stage, CHARS as never);
  const made = SpawnScriptedCharacters(
    chars.readySpawns([{ at: 0x10 }, { at: 0x20 }]));
  RunPendingInits();
  check("both civilians are made", made.length === 2, `${made.length}`);
  for (const a of made) a.visible = true;
  chars.syncSpawns([{ at: 0x10 }, { at: 0x20 }], made);

  const vetoed = made.find((a) => a.charType === 0x26)!;
  const plain = made.find((a) => a.charType === 0x2e)!;
  check("the port has not decided anything yet", vetoed.suppressedBones === 0);

  // `GameUpdate` is what runs the predicate; drive the same call it makes.
  const { ActorUpdateSuppressedBones } = await import("../src/game/parts");
  ActorUpdateSuppressedBones(vetoed);
  ActorUpdateSuppressedBones(plain);
  check("the port vetoes bone 9 on the type whose skirt draws that slot",
        vetoed.suppressedBones === (1 << 9), `${vetoed.suppressedBones}`);
  check("...and vetoes nothing on the type whose part 1 is elsewhere",
        plain.suppressedBones === 0, `${plain.suppressedBones}`);

  chars.update({} as never);
  const vp = pelvises.get(0x26)!;
  const vl = legs.get(0x26)!;
  const pp = pelvises.get(0x2e)!;
  check("the vetoed pelvis is not drawn", !vp.layers.isEnabled(0));
  check("...but it is still visible, or the legs would go with it",
        vp.visible === true);
  check("...and the leg hanging off it is still drawn",
        vl.layers.isEnabled(0) && vl.visible);
  check("the pelvis that is not vetoed is drawn",
        pp.layers.isEnabled(0) && pp.visible);

  // And it comes back: the input is `bone_records[9].slot`, which a swap
  // changes, so the veto has to be able to lift.
  vetoed.boneSlot["9"] = PLAIN;
  ActorUpdateSuppressedBones(vetoed);
  chars.update({} as never);
  check("swapping bone 9's model to an unvetoed slot puts the draw back",
        vetoed.suppressedBones === 0 && vp.layers.isEnabled(0),
        `${vetoed.suppressedBones}`);

  stage.dispose();
}

/**
 * The result card's figures: a clone of the type's hidden template, **with
 * its skins bound to the clone's own bones**.
 *
 * A figure has no row of its own; `cloneTemplate` copies the type's template
 * row for each one `ResultCardInstall` (`FUN_00434EF0`) allocates. The waist
 * is a vertex-blended part -- `SkeletonDrawWalk` (`FUN_004110D0`) draws it
 * through `DrawCharacterPart`, and the exporter writes it as a glTF skin --
 * and `Object3D.clone` copies a `SkinnedMesh`'s skeleton by reference. So
 * every figure's waist was deformed by the hidden template's bones, not its
 * own, and the card's civilians stood with a hole from chest to belt.
 */
console.log("\nthe result card's figures: the waist rides the figure's bones");
{
  const { CharacterLayer } = await import("../src/render/characters");
  const { G, ResetGameGlobals } = await import("../src/game/globals");
  const { SetGameTables } = await import("../src/game/tables");
  const { makeActor } = await import("../src/game/actor");
  const { SpawnClass } = await import("../src/game/spawn_class");
  const { ResultFigureAt, ResultFigureTemplateAt, ResultCardRoutine } =
    await import("../src/game/class61/state");
  const { Bone, BufferAttribute, BufferGeometry, Matrix4, MeshBasicMaterial,
          Object3D, Skeleton, SkinnedMesh, Vector3 } = await import("three");

  const CT = 0x26;
  const TEMPLATE_AT = ResultFigureTemplateAt(CT);
  const FIGURE_AT = ResultFigureAt(0, CT);
  const CHARS = {
    types: { [String(CT)]: {
      type: CT, name: "t38", file: "t.bin", bone_count: 2, actor_radius: 10,
      bones: [
        { bone: 0, part: "bone00_1110", slot: 0x1110, offset: [0, 0, 0],
          parent: null, damage_rank: [], hit_radius: 2, steps: [] },
        { bone: 1, part: "bone01_1111", slot: 0x1111, offset: [0, 5, 0],
          parent: 0, damage_rank: [], hit_radius: 2, steps: [] },
      ],
      reactions: {}, attacks: {},
      motions: { "380": { bank: "b", frames: 1, fps: 30, root: [0, 0, 0],
                          rot: [0, 0, 0, 0, 0, 0, 0, 0, 0], play: 0 } },
    } },
    placements: [{
      at: TEMPLATE_AT, class: 0x61, char_type: CT, motion: 380, hp: 0, yaw: 0,
      body_condition: 0, initial_state: 0, attack_state: 0, ring_set: 0,
      synthetic: true,
    }],
    approach: { rings: [{ inner: 25, mid: 38, outer: 51 }],
                steps: { base: 2, mid_add: 3, outer_add: 4 },
                ring_set_for_char0: 1 },
    difficulty: { hp_delta: [0, 0, 0, 0, 0], hp_min: 1, hp_max: 300,
                  initial_rank: [0, 0, 2, 0, 0], default: 2 },
  };

  // The template, as the exporter lays a character out: two bone nodes, a
  // joint proxy under each, and the waist -- a skin over both joints, a
  // child of the rig root with no transform of its own.
  const root = new Object3D();
  const rig = new Object3D();
  rig.name = `chr_t38_spawn${TEMPLATE_AT.toString(16)}`;
  rig.userData = { hod2_kind: "rig", hod2_rig: "chr_t38",
                   hod2_spawn_at: TEMPLATE_AT };
  const b0 = new Object3D();
  b0.name = `${rig.name}_bone00_1110`;
  const b1 = new Object3D();
  b1.name = `${rig.name}_bone01_1111`;
  b1.position.set(0, 5, 0);
  b0.add(b1);
  const j0 = new Bone();
  const j1 = new Bone();
  b0.add(j0);
  b1.add(j1);
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(
    new Float32Array([0, 0, 0, 0, 0, 0]), 3));
  g.setAttribute("skinIndex", new BufferAttribute(
    new Uint16Array([0, 0, 0, 0, 1, 0, 0, 0]), 4));
  g.setAttribute("skinWeight", new BufferAttribute(
    new Float32Array([1, 0, 0, 0, 1, 0, 0, 0]), 4));
  const waist = new SkinnedMesh(g, new MeshBasicMaterial());
  waist.name = `${rig.name}_part0_0eb6`;
  rig.add(b0);
  rig.add(waist);
  waist.bind(new Skeleton([j0, j1], [new Matrix4(), new Matrix4()]),
             new Matrix4());
  root.add(rig);

  ResetGameGlobals();
  SetGameTables(CHARS as never);
  const chars = new CharacterLayer();
  const stage = new Scope("stage");
  chars.build(root, stage, CHARS as never);

  // The figure, as `ResultCardAllocFigure` leaves it in the pool.
  const a = makeActor(FIGURE_AT, SpawnClass.ResultCard, CT, "result figure 0");
  if (a.cls === SpawnClass.ResultCard) {
    a.card.routine = ResultCardRoutine.FigureUpdate;
  }
  a.motion = 380;
  G.g_object_list.push(a);
  chars.syncSpawns([], []);

  const clone = root.children.find((o) => o !== rig
                                   && o.name.startsWith(rig.name));
  const skins: InstanceType<typeof SkinnedMesh>[] = [];
  clone?.traverse((o) => {
    if ((o as { isSkinnedMesh?: boolean }).isSkinnedMesh) {
      skins.push(o as InstanceType<typeof SkinnedMesh>);
    }
  });
  const under = (o: InstanceType<typeof Object3D>,
                 top: InstanceType<typeof Object3D>) => {
    for (let p: InstanceType<typeof Object3D> | null = o; p; p = p.parent) {
      if (p === top) return true;
    }
    return false;
  };
  check("the figure gets a clone of its type's template, waist and all",
        clone !== undefined && skins.length === 1,
        `${clone?.name} skins ${skins.length}`);
  check("...whose waist is bound to the clone's own joints, not the template's",
        skins.length === 1 && clone !== undefined
        && skins[0].skeleton.bones.every((b) => under(b, clone)),
        skins[0]?.skeleton.bones.map((b) => under(b, rig) ? "template" : "?")
          .join(","));

  // The symptom: the figure stands somewhere the template does not, and its
  // waist has to be there with it.
  if (clone && skins.length === 1) {
    clone.position.set(-235, 4, 80);
    clone.rotation.set(0, 1.3, 0);
    root.updateMatrixWorld(true);
    const v = skins[0].applyBoneTransform(1, new Vector3(0, 0, 0));
    skins[0].localToWorld(v);
    const joint = skins[0].skeleton.bones[1].getWorldPosition(new Vector3());
    const bone1 = clone.getObjectByName(b1.name);
    const want = bone1?.getWorldPosition(new Vector3()) ?? new Vector3(NaN);
    check("...so a waist vertex stands on the figure's bone, where it stands",
          v.distanceTo(joint) < 1e-4 && v.distanceTo(want) < 1e-4
          && want.distanceTo(new Vector3(0, 5, 0)) > 100,
          `${v.toArray()} vs ${want.toArray()}`);
  }
  stage.dispose();
}

/**
 * The draw gates: the skeleton's, and each vertex-blended part's.
 *
 * `SkeletonEmitNode` (`FUN_004114C0`) draws no node while `model+0x64` bit 0
 * is down, and `SkeletonDrawWalk` (`FUN_004110D0`) draws part *i* only while
 * its byte in `model+0x40` is set. The two are separate, and a hidden
 * captor closes the first and **only part 0** of the second -- so the scene
 * has to be able to show a skirt with no body. The port used to fold all of
 * it into one alpha that hid the root.
 */
console.log("\nthe draw gates: the skeleton, and each part by index");
{
  const { CharacterLayer } = await import("../src/render/characters");
  const { RunPendingInits, SpawnScriptedCharacters } =
    await import("../src/game/director");
  const { G, ResetGameGlobals } = await import("../src/game/globals");
  const { SetGameTables } = await import("../src/game/tables");
  const { MotionFlag } = await import("../src/game/actor");
  const { SpawnClass } = await import("../src/game/spawn_class");
  const { alphaGatesWholeActor } =
    await import("../src/render/characters/draw_gates");
  const { BoxGeometry, Mesh, MeshBasicMaterial, Object3D } =
    await import("three");

  const part = (slot: number) => ({
    slot, draw_bone: 9, bones: [9, null, null, null], deformed: [0], rows: 1,
    supported: true,
  });
  const TYPE = {
    type: 0x2e, name: "t46", file: "t.bin", bone_count: 2, actor_radius: 10,
    bones: [
      { bone: 9, part: "bone09_0f31", slot: 0x0f31, offset: [0, 0, 0],
        parent: null, damage_rank: [], hit_radius: 2, steps: [] },
      { bone: 10, part: "bone10_1111", slot: 0x1111, offset: [0, 0, 0],
        parent: 0, damage_rank: [], hit_radius: 2, steps: [] },
    ],
    parts: [part(0x0f22), part(0x0f23)],
    reactions: {}, attacks: {},
    motions: { "660": { bank: "b", frames: 1, fps: 30, root: [0, 0, 0],
                        rot: [0, 0, 0, 0, 0, 0, 0, 0, 0], play: 0 } },
  };
  const CHARS = {
    types: { "46": TYPE },
    placements: [{ at: 0x30, class: 0x10, char_type: 0x2e, motion: 660,
                   hp: 0, yaw: 0, body_condition: 0, initial_state: 0,
                   attack_state: 0, ring_set: 0 }],
    approach: { rings: [{ inner: 25, mid: 38, outer: 51 }],
                steps: { base: 2, mid_add: 3, outer_add: 4 },
                ring_set_for_char0: 1 },
    difficulty: { hp_delta: [0, 0, 0, 0, 0], hp_min: 1, hp_max: 300,
                  initial_rank: [0, 0, 2, 0, 0], default: 2 },
  };

  const root = new Object3D();
  const rig = new Object3D();
  rig.name = "chr_t46_spawn000";
  rig.userData = { hod2_kind: "rig", hod2_rig: "chr_t46", hod2_spawn_at: 0x30 };
  const mesh = (name: string) => {
    const m = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
    m.name = name;
    return m;
  };
  const pelvis = mesh("chr_t46_spawn000_bone09_0f31");
  const leg = mesh("chr_t46_spawn000_bone10_1111");
  pelvis.add(leg);
  // The exporter's vertex-blended parts: top-level, no parent, by index.
  const waist = mesh("chr_t46_spawn000_part0_0f22");
  const skirt = mesh("chr_t46_spawn000_part1_0f23");
  rig.add(pelvis, waist, skirt);
  root.add(rig);

  ResetGameGlobals();
  SetGameTables(CHARS as never);
  G.g_difficulty = 2;
  const chars = new CharacterLayer();
  const stage = new Scope("stage");
  chars.build(root, stage, CHARS as never);
  const [a] = SpawnScriptedCharacters(chars.readySpawns([{ at: 0x30 }]));
  RunPendingInits();
  a.visible = true;
  chars.syncSpawns([{ at: 0x30 }], [a]);
  chars.update({} as never);
  const drawn = (o: InstanceType<typeof Object3D>) =>
    o.visible && o.layers.isEnabled(0);
  check("built: skeleton and both parts drawn, one byte per part",
        a.partVisible.join() === "1,1" && drawn(pelvis) && drawn(leg)
        && drawn(waist) && drawn(skirt), a.partVisible.join());

  // A captor's hold: the skeleton's bit and part 0's byte, and nothing else.
  a.motionFlags &= ~MotionFlag.Drawn;
  a.partVisible[0] = 0;
  chars.update({} as never);
  check("the skeleton's gate takes every bone's geometry off",
        !pelvis.layers.isEnabled(0) && !leg.layers.isEnabled(0));
  check("...by layer, so the nodes stay visible and the pose stays live",
        pelvis.visible && leg.visible && rig.visible);
  check("part 0's byte takes the waist off, and the skirt is still drawn",
        !waist.visible && drawn(skirt));

  a.motionFlags |= MotionFlag.Drawn;
  a.partVisible[0] = 1;
  chars.update({} as never);
  check("...and opening both puts everything back",
        drawn(pelvis) && drawn(leg) && drawn(waist) && drawn(skirt));

  // `Actor.alpha` is not a whole-actor gate for the two classes whose
  // `obj+0x138C` the engine draws with, part by part.
  const fake = (cls: number) => ({ a: { cls } }) as never;
  check("alpha gates the whole actor only for the classes that write it as "
        + "'drawn'", alphaGatesWholeActor(fake(SpawnClass.Judgment))
        && !alphaGatesWholeActor(fake(SpawnClass.Zombie))
        && !alphaGatesWholeActor(fake(SpawnClass.Thrower)));

  stage.dispose();
}

/**
 * The hook's draw, node by node: `ZombieSubmitSlotByLighting` (`FUN_00453AE0`)
 * and `ThrowerDrawPartWithAlpha` (`FUN_0044A240`) draw a node through
 * `AssetDrawSlotWithAlpha` (`FUN_004185A0`), and the port's hooks write which
 * into `Actor.nodeDrawAlpha`; `DrawCharacterPartSlot` (`FUN_00419B40`) draws
 * four types' parts at `obj+0x138C`. `draw_gates.ts` used to draw every
 * alpha above 0 solid and hide a bone at 0.
 */
console.log("\nthe draw gates: each node's faded draw, and the parts at 0x138C");
{
  const three = await import("three");
  const { Group, Mesh, MeshBasicMaterial, BoxGeometry, MeshLambertMaterial } =
    three;
  const { applyDrawGates } =
    await import("../src/render/characters/draw_gates");
  const { setMeshDrawAlpha, setUnfadedMaterial, unfadedMaterial,
          meshDrawAlpha } = await import("../src/render/draw_order");
  const { MotionFlag } = await import("../src/game/actor");
  const { SpawnClass } = await import("../src/game/spawn_class");

  // A template material in the opaque pass, with a base alpha under 1.
  const tmpl = (): InstanceType<typeof MeshBasicMaterial> => {
    const m = new MeshBasicMaterial({ opacity: 0.8 });
    m.transparent = false;
    return m;
  };
  const mk = (name: string) => {
    const m = new Mesh(new BoxGeometry(1, 1, 1), tmpl());
    m.name = name;
    return m;
  };
  const pivot = new Group();
  const pelvis = mk("chr_z_spawn000_bone01_1c6c");
  const leg = mk("chr_z_spawn000_bone10_1111");
  const cel = mk("cel");
  pelvis.add(leg, cel);        // the cel is the pelvis's draw, not the leg's
  const waist = mk("chr_z_spawn000_part0_1c63");
  pivot.add(pelvis, waist);
  const plain = new Map<object, unknown>([
    [pelvis, pelvis.material], [leg, leg.material], [cel, cel.material],
    [waist, waist.material]]);
  const a = {
    cls: SpawnClass.Zombie, charType: 0x12, alpha: 0.25,
    motionFlags: MotionFlag.Drawn, partVisible: [1], suppressedBones: 0,
    nodeDrawAlpha: [] as (number | null)[],
  };
  const inst = {
    a, pivot, root: pivot, bones: new Map([[1, pelvis], [10, leg]]),
    gore: new Map(),
  } as never;
  type Basic = InstanceType<typeof MeshBasicMaterial>;
  const mat = (m: InstanceType<typeof Mesh>) => m.material as Basic;

  a.nodeDrawAlpha[1] = 0.25;
  a.nodeDrawAlpha[10] = null;
  applyDrawGates(inst);
  check("a node drawn at 0.25 is the forced blend at its base alpha times it",
        mat(pelvis) !== plain.get(pelvis) && mat(pelvis).transparent
        && mat(pelvis).blendSrc === three.SrcAlphaFactor
        && mat(pelvis).blendDst === three.OneMinusSrcAlphaFactor
        && Math.abs(mat(pelvis).opacity - 0.2) < 1e-6,
        `${mat(pelvis).opacity}`);
  check("...and so is everything else the hook draws for it -- the cel",
        Math.abs(mat(cel).opacity - 0.2) < 1e-6 && mat(cel).transparent);
  check("...while a child bone drawn plainly keeps the template's material",
        leg.material === plain.get(leg));
  check("`znele`'s part is drawn at `obj+0x138C` whatever the node alpha",
        waist.material !== plain.get(waist)
        && Math.abs(mat(waist).opacity - 0.2) < 1e-6);

  a.nodeDrawAlpha[1] = 0;
  a.alpha = 0;
  applyDrawGates(inst);
  check("at 0 the node is still drawn: on its layer, opacity 0, writing depth",
        pelvis.layers.isEnabled(0) && mat(pelvis).opacity === 0
        && mat(pelvis).depthWrite && mat(pelvis).alphaTest === 0);
  check("...and so is the part", waist.visible && mat(waist).opacity === 0);

  a.nodeDrawAlpha[1] = 1;
  a.alpha = 1;
  applyDrawGates(inst);
  check("at 1 it is still the forced blend, not the plain draw: an "
        + "opaque-pass mesh's texture alpha shows",
        mat(pelvis) !== plain.get(pelvis) && mat(pelvis).transparent
        && Math.abs(mat(pelvis).opacity - 0.8) < 1e-6
        && mat(waist).transparent);

  // A zombie that is not one of the four types draws its parts plainly.
  a.charType = 1;
  applyDrawGates(inst);
  check("another character type's part is drawn plainly",
        waist.material === plain.get(waist));
  a.charType = 0x12;

  // The gun light swaps a lit actor's materials for its twins, after the
  // characters: the fade goes back on top of the twin it chose.
  a.nodeDrawAlpha[1] = 0.5;
  applyDrawGates(inst);
  const twin = new MeshLambertMaterial({ opacity: 0.8 });
  twin.userData = { gunLit: true };
  setUnfadedMaterial(pelvis, twin);
  const drawnWith = pelvis.material as unknown as { type: string };
  check("a light layer's swap goes under the fade: the twin, at 0.5",
        unfadedMaterial(pelvis) === (twin as unknown)
        && drawnWith !== (twin as unknown)
        && drawnWith.type === "MeshLambertMaterial"
        && Math.abs(mat(pelvis).opacity - 0.4) < 1e-6
        && meshDrawAlpha(pelvis) === 0.5);
  // A layer that writes the material directly -- a gore swap, a cel -- is
  // read back as the new unfaded one by the next fade.
  const gore = tmpl();
  pelvis.material = gore;
  applyDrawGates(inst);
  check("...and a direct write is taken as the new unfaded material",
        unfadedMaterial(pelvis) === gore && pelvis.material !== gore
        && Math.abs(mat(pelvis).opacity - 0.4) < 1e-6);

  // The fade ends: every mesh goes back to what it draws unfaded.
  a.nodeDrawAlpha[1] = null;
  applyDrawGates(inst);
  check("a plain draw after the fade puts back what the mesh draws unfaded",
        pelvis.material === gore && cel.material === plain.get(cel)
        && meshDrawAlpha(pelvis) === null);
  // ...and a clone some layer saved and puts back later is seen through.
  setMeshDrawAlpha(leg, 0.3);
  const saved = leg.material;
  setMeshDrawAlpha(leg, null);
  leg.material = saved as never;
  setMeshDrawAlpha(leg, null);
  check("a stale fade clone put back after the fade is replaced by its source",
        leg.material === plain.get(leg));
}

/**
 * The player's own character, in the scene, in the cut scene that spawns it.
 *
 * Stage 3's block 2 step 5 puts two class-0x25 humanoids at one point --
 * character type 0x39 (`gameover_player.bin`) and 0x3A (`char_adv05.bin`) --
 * and each one's program opens with an `op 10` guarding an `ActorKill`, so
 * that the one the active player is *not* takes itself out. The port ran
 * neither test and killed both, and `?stage=3&block=2&step=5&op=22` had no
 * foreground at all.
 *
 * This is the assertion on the **scene graph** rather than on the port's
 * opinion of itself: the rig node is there, the bone under it is a `Mesh`, it
 * is `visible`, and it is at the position the spawn descriptor names.
 */
console.log("\nthe player's character survives its own op 10:");
{
  const { CharacterLayer } = await import("../src/render/characters");
  const { RunPendingInits, SpawnScriptedCharacters } =
    await import("../src/game/director");
  const { ScriptedHumanoidUpdate, HumanoidOp, HumanoidCond } =
    await import("../src/game/class25");
  const { SetGameTables } = await import("../src/game/tables");
  const { SpawnClass } = await import("../src/game/spawn_class");
  const { Rng } = await import("../src/core/rng");
  const { Events } = await import("../src/core/events");
  const { NULL_HOST } = await import("../src/game/host");
  const { BoxGeometry, Mesh, MeshBasicMaterial, Object3D } =
    await import("three");

  /** Stage 3's descriptor, `st3evtbl.bin` 0x3378. */
  const AT = 13176;
  const POS = { x: -522.7, y: -14.9, z: -3883.2 };
  const TYPE = {
    type: 0x39, name: "gameover_player", file: "gameover_player.bin",
    bone_count: 1, actor_radius: 10,
    bones: [{ bone: 1, part: "bone01_158c", slot: 0x158c, offset: [0, 0, 0],
              parent: null, damage_rank: [], hit_radius: 2, steps: [] }],
    reactions: {}, attacks: {},
    motions: { "890": { bank: "people", frames: 1, fps: 30, root: [0, 0, 0],
                        rot: [0, 0, 0, 0, 0, 0], play: 0 } },
  };
  const PLACE = {
    at: AT, class: 0x25, char_type: 0x39, motion: 890, hp: 0, yaw: 21845,
    body_condition: 0, initial_state: 0, attack_state: 0, ring_set: 0,
  };
  const CHARS = {
    types: { "57": TYPE }, placements: [PLACE],
    approach: { rings: [{ inner: 25, mid: 38, outer: 51 }],
                steps: { base: 2, mid_add: 3, outer_add: 4 },
                ring_set_for_char0: 1 },
    difficulty: { hp_delta: [0, 0, 0, 0, 0], hp_min: 1, hp_max: 300,
                  initial_rank: [0, 0, 2, 0, 0], default: 2 },
  };
  /** The program at 0x33B4, with the indices the exporter resolves. */
  const HUMANOIDS = {
    [String(AT)]: {
      charType: 0x39, removePath: 129, removeFrame: 0, drawVariant: 0,
      flags2: 2, motion: 890, phase: -1, entry: 0,
      cmds: [
        { op: HumanoidOp.WaitThenPlay, mode: -1, a: 0, b: 0 },
        { op: HumanoidOp.SetHandModel, mode: 1, a: 0, b: 0 },
        { op: HumanoidOp.IfActivePlayer, mode: 1, a: 0, b: 0, skip: 4 },
        { op: HumanoidOp.Kill, mode: 0, a: 0, b: 0 },
        { op: HumanoidOp.IfActivePlayer, mode: 0, a: 0, b: 0, skip: 11 },
        { op: HumanoidOp.WaitUntil, mode: HumanoidCond.CameraAt,
          a: 128, b: 270 },
        { op: HumanoidOp.SetMotionBlended, mode: 20, a: 845, b: 0 },
        { op: HumanoidOp.WaitUntil, mode: HumanoidCond.MotionFrame,
          a: -1, b: 0 },
        { op: HumanoidOp.SetMotionBlended, mode: 20, a: 890, b: -1 },
        { op: HumanoidOp.WaitUntil, mode: HumanoidCond.CameraAt, a: 129, b: 0 },
        { op: HumanoidOp.End, mode: 0, a: 0, b: 0 },
        { op: HumanoidOp.SetPos, mode: 0, a: 0, b: 0, f0: -520.9, f1: -3873.8 },
      ],
    },
  };

  const root = new Object3D();
  const rig = new Object3D();
  rig.name = "chr_gameover_player_spawn000";
  rig.userData = { hod2_kind: "rig", hod2_rig: "chr_gameover_player",
                   hod2_spawn_at: AT };
  rig.position.set(POS.x, POS.y, POS.z);
  const torso = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
  torso.name = "chr_gameover_player_spawn000_bone01_158c";
  rig.add(torso);
  root.add(rig);

  ResetGameGlobals();
  SetGameTables(CHARS as never, undefined, undefined, HUMANOIDS as never);
  G.g_difficulty = 2;
  // `SelectAttackablePlayer` (`FUN_00414F40`) writes 0 for one player on
  // slot 0, which is the port's configuration and the case the character has
  // to survive.
  G.g_active_player = 0;
  G.g_active_cam_path = 128;
  G.g_cam_path_frame = 209;

  const chars = new CharacterLayer();
  const stage = new Scope("stage");
  chars.build(root, stage, CHARS as never);
  check("the exporter's hierarchy starts hidden", rig.visible === false);

  const listed = [{ at: AT }];
  const made = SpawnScriptedCharacters(chars.readySpawns(listed));
  RunPendingInits();
  check("the script's spawn makes the character", made.length === 1,
        `${made.length}`);
  const a = made[0];
  if (a.cls !== SpawnClass.ScriptedHumanoid) throw new Error("not class 0x25");
  chars.syncSpawns(listed, made);

  const rng = new Rng(1);
  const events = new Events();
  for (let i = 0; i < 4; i++) {
    ScriptedHumanoidUpdate(a, { dt: 1 / 60, rng,
                                host: NULL_HOST, events });
  }
  chars.update({} as never);

  check("the player's character is in the scene graph",
        rig.parent === root && root.children.includes(rig));
  check("...it is drawn", rig.visible === true,
        `dead ${a.dead} visible ${a.visible} pc ${a.hum.pc}`);
  check("...its bone is a mesh", (torso as { isMesh?: boolean }).isMesh === true
        && torso.visible && torso.layers.isEnabled(0));
  check("...and it is where the spawn descriptor puts it",
        Math.abs(rig.position.x - POS.x) < 1e-3
        && Math.abs(rig.position.y - POS.y) < 1e-3
        && Math.abs(rig.position.z - POS.z) < 1e-3,
        `${rig.position.x}, ${rig.position.y}, ${rig.position.z}`);
  check("...held on the wait its own arm names, not run off the end",
        a.hum.pc === 5, `pc ${a.hum.pc}`);

  stage.dispose();
  G.g_object_list.length = 0;
}

/**
 * A skinned actor with **no bone sphere** is shot as one sphere, whole.
 *
 * `ShotTestSphere` (`FUN_00404630`) hands over to `ShotTestSkeleton` only when
 * `obj+0x34` bit `0x80` is set *and* the skeleton has nodes; otherwise the
 * whole actor is one candidate at `obj+0x124`. `g_character_bone_spheres`
 * (`0x004D032C`) settles which side of that fork a character type lands on
 * from the data alone: it holds **radius 0** for every bone of character type
 * `0x1E`, the bat, so the bone arm could resolve nothing there even if the bit
 * were set.
 *
 * The port drew the bat through the character path and tested only bone
 * spheres, so a bat had no hit test at all and could not be shot. Reported
 * from play, and it is a bug this file could have caught: `pickShot` had no
 * test of its own.
 *
 * The bat has since moved to the engine's own registration
 * (`ClassHandler.registersForShotTest`, `game/class46/`), so this pick passes
 * it by; it is still the vehicle here because its type is the one with no
 * sphere, and the flag is lifted for the length of the test to exercise the
 * arm every class that does not register still takes.
 */
console.log("\nthe shot: a character with no bone sphere is one sphere");
{
  const { CharacterLayer } = await import("../src/render/characters");
  const { G, ResetGameGlobals } = await import("../src/game/globals");
  const { SetGameTables } = await import("../src/game/tables");
  const { ActorSpawn } = await import("../src/game/spawn");
  const { SpawnClass } = await import("../src/game/spawn_class");
  const { Scope } = await import("../src/core/scope");
  const { Object3D } = await import("three");
  // The real `PlaceBats`, so the radius under test is the one the class
  // actually writes and not one this file made up.
  await import("../src/game/classes");
  const { g_class_handlers } = await import("../src/game/registry");
  const h = g_class_handlers[SpawnClass.Bat]!;
  const registers = h.registersForShotTest;
  check("the bat registers for the shot test the engine's way",
        registers === true);
  delete h.registersForShotTest;

  // Character type 0x1E as the exporter emits it: one bone, one slot, and no
  // `hit_radius` at all, because the EXE's row for it is zero.
  const BAT_TYPE = {
    type: 0x1e, name: "zabat", file: "zabat.bin", bone_count: 2,
    actor_radius: 10,
    bones: [{ bone: 1, part: "bone01_1b01", slot: 0x1b01, offset: [0, 0, 0],
              parent: null, steps: [[0, 0, 10]] }],
    reactions: {}, attacks: {},
    // One authored frame, so the poser has something real to read: the shot
    // is what is under test, not the pose.
    motions: { "1031": { bank: "z", frames: 1, fps: 30,
                         root: [0, 0, 0], rot: [0, 0, 0] } },
  };
  const PLACE = {
    at: 0x0f04, class: 0x46, char_type: 0x1e, motion: 1031, hp: 1, yaw: 0,
    class46: { subtype: 0, group: 0, member: 0 },
  };
  const CHARS = { types: { "30": BAT_TYPE }, placements: [PLACE] };

  const root = new Object3D();
  const rig = new Object3D();
  rig.name = "chr_zabat_spawn000";
  rig.userData = { hod2_kind: "rig", hod2_rig: "chr_zabat",
                   hod2_spawn_at: 0x0f04 };
  const bone = new Object3D();
  bone.name = "chr_zabat_spawn000_bone01_1b01";
  rig.add(bone);
  root.add(rig);

  ResetGameGlobals();
  SetGameTables(CHARS as never);
  const chars = new CharacterLayer();
  const stage = new Scope("stage");
  chars.build(root, stage, CHARS as never);

  const a = ActorSpawn(0x0f04, SpawnClass.Bat, 0x1e, "zabat", {
    class46: PLACE.class46, visible: true,
  });
  a.pos.x = 0; a.pos.y = 0; a.pos.z = -30;
  // `obj+0x70/0x74/0x78`, which the class publishes as `(x, y + 1, z)`.
  a.shotCentre.x = 0; a.shotCentre.y = 1; a.shotCentre.z = -30;
  chars.syncSpawns([{ at: 0x0f04 }], [a]);
  chars.update({} as never);
  check("`PlaceBats` gave it `obj+0x124` = 4.0", a.hitRadius === 4,
        `${a.hitRadius}`);

  const ray = (x: number, y: number) => ({
    origin: { x: 0, y: 0, z: 0 },
    dir: { x: x / Math.hypot(x, y, 30), y: y / Math.hypot(x, y, 30),
           z: -30 / Math.hypot(x, y, 30) },
  });
  const dead = a.dead;
  check("the bat's type really does carry no bone sphere",
        !BAT_TYPE.bones.some((b) => (b as { hit_radius?: number }).hit_radius));
  check("...and the actor is drawn, so it is a candidate at all",
        !dead && a.visible, `dead ${dead} visible ${a.visible}`);
  const hit = chars.pickShot(ray(0, 1));
  check("a shot down the middle finds it",
        hit?.kind === "actor" && hit.at === 0x0f04, JSON.stringify(hit));
  // 4.0 is `obj+0x124`, and the centre is a unit above the actor -- so three
  // units under the actor's own y is inside the sphere and six is not.
  check("...inside `obj+0x124` = 4.0, measured from the published centre",
        chars.pickShot(ray(0, -3))?.kind === "actor",
        JSON.stringify(chars.pickShot(ray(0, -3))));
  check("...and a shot outside it misses",
        chars.pickShot(ray(0, -12)) === null,
        JSON.stringify(chars.pickShot(ray(0, -12))));
  check("...and so does one wide of it",
        chars.pickShot(ray(9, 1)) === null,
        JSON.stringify(chars.pickShot(ray(9, 1))));
  check("a sphere hit is reported whole, which `MarkActorShot` records as 1",
        (chars.pickShot(ray(0, 1)) as { whole?: boolean } | null)?.whole
          === true);
  // `RegisterForShotTest` (`FUN_00405160`) never appends an actor with
  // `obj+0x34` bit `0x8000`: a boss mid-entrance, a zombie waiting on an
  // order, a spawn whose record carries the bit.
  a.flags |= ActorFlag.NoShotTest;
  check("an actor with bit 0x8000 is not in the shot test at all",
        chars.pickShot(ray(0, 1)) === null,
        JSON.stringify(chars.pickShot(ray(0, 1))));
  a.flags &= ~ActorFlag.NoShotTest;

  // The distance along the shot comes back with the pick: it is what
  // `MergeShotPicks` weighs this answer against the registered classes' by.
  // The centre is (0, 1, -30) and the ray runs straight at it.
  const along = chars.pickShot(ray(0, 1))?.t ?? NaN;
  check("the pick says how far along the shot it is",
        Math.abs(along - Math.hypot(1, 30)) < 1e-6, `${along}`);
  // A class that registers the engine's way is `game/combat/shot_test.ts`'s:
  // this pick passes it by, registered or not, so the one answer it gets is
  // the one its own registration earns.
  h.registersForShotTest = true;
  check("a class that registers the engine's way is not picked here",
        chars.pickShot(ray(0, 1)) === null,
        JSON.stringify(chars.pickShot(ray(0, 1))));
  delete h.registersForShotTest;
  check("...and is again once it stops", chars.pickShot(ray(0, 1))?.kind
        === "actor");
  h.registersForShotTest = registers;

  stage.dispose();
  G.g_object_list.length = 0;
}

/**
 * **A set-piece is never a candidate.** Class 0x24 calls `RegisterForShotTest`
 * (`FUN_00405160`) nowhere, so the engine's shot test has nothing to find;
 * the render pick used to offer it like any other actor, and a body lying
 * on the floor -- stage 1's man under the library desk -- died again when
 * shot. Same pick, same kind of bone sphere a zombie is hit through, and the
 * class is the only thing that differs.
 */
console.log("\nthe shot: a class-0x24 set-piece is not in the shot test");
{
  const { CharacterLayer } = await import("../src/render/characters");
  const { G, ResetGameGlobals } = await import("../src/game/globals");
  const { SetGameTables } = await import("../src/game/tables");
  const { ActorSpawn } = await import("../src/game/spawn");
  const { SpawnClass } = await import("../src/game/spawn_class");
  const { Scope } = await import("../src/core/scope");
  const { Object3D } = await import("three");
  await import("../src/game/classes");

  // A person's type as the exporter emits one: a bone with a hit sphere, its
  // row's slot the node's (`ActorBuildSkinnedModel` arms it only then).
  const BODY_TYPE = {
    type: 0x33, name: "hito_marioaa", file: "hito_marioaa.bin", bone_count: 2,
    actor_radius: 10,
    bones: [{ bone: 1, part: "bone01_0100", slot: 0x100, offset: [0, 0, 0],
              parent: null, steps: [[0, 0, 10]], hit_slot: 0x100,
              hit_radius: 3, hit_centre: [0, 0, 0] }],
    reactions: {}, attacks: {},
    motions: { "395": { bank: "h", frames: 1, fps: 30,
                        root: [0, 0, 0], rot: [0, 0, 0] } },
  };
  const AT = 0x1548;
  const PLACE = { at: AT, class: 0x24, char_type: 0x33, motion: 395, hp: 0,
                  yaw: 0 };
  const CHARS = { types: { "51": BODY_TYPE }, placements: [PLACE] };

  const root = new Object3D();
  const rig = new Object3D();
  rig.name = "chr_hito_marioaa_spawn000";
  rig.userData = { hod2_kind: "rig", hod2_rig: "chr_hito_marioaa",
                   hod2_spawn_at: AT };
  const bone = new Object3D();
  bone.name = "chr_hito_marioaa_spawn000_bone01_0100";
  rig.add(bone);
  root.add(rig);

  ResetGameGlobals();
  SetGameTables(CHARS as never, undefined, { [String(AT)]: {
    selector: 0, removePath: 99, removeFrame: 0, motion: 395, hold: 0,
    cuePath: -1, cueFrame: 0, cue2Path: -1, cue2Frame: 0, phase: 0,
  } } as never);
  const chars = new CharacterLayer();
  const stage = new Scope("stage");
  chars.build(root, stage, CHARS as never);
  const a = ActorSpawn(AT, SpawnClass.SetPieceProp, 0x33, "hito_marioaa",
                       { visible: true });
  a.pos.x = 0; a.pos.y = 0; a.pos.z = -30;
  chars.syncSpawns([{ at: AT }], [a]);
  chars.update({} as never);
  const towards = { origin: { x: 0, y: 0, z: 0 },
                    dir: { x: 0, y: 0, z: -1 } };
  check("the body is drawn and alive, and its bone sphere is armed, so only "
        + "its class could keep it out",
        a.visible && !a.dead && (a.boneRadius["1"] ?? 0) > 0,
        `visible ${a.visible} dead ${a.dead} radius ${a.boneRadius["1"]}`);
  check("a shot straight through its bone sphere does not find it",
        chars.pickShot(towards) === null, JSON.stringify(chars.pickShot(towards)));

  stage.dispose();
  G.g_object_list.length = 0;
}

/**
 * **Nor is a scripted humanoid.** Class 0x25 calls `RegisterForShotTest`
 * (`FUN_00405160`) nowhere either -- not through `ActorRegisterCameraPoint`
 * (`FUN_00409B70`), not through anything its routines reach -- so the engine's
 * shot test never sees one. 133 of its 137 spawns carry bit `0x8000` in their
 * record, which the pick already honours; this is one of the four that do
 * not, stage 2's jetty zombie `0xAA40` (character type 15, `znebi2`), which
 * the render pick found through the corner of a building and `ResolveHit`
 * killed for ninety points.
 */
console.log("\nthe shot: a class-0x25 humanoid is not in the shot test");
{
  const { CharacterLayer } = await import("../src/render/characters");
  const { G, ResetGameGlobals } = await import("../src/game/globals");
  const { SetGameTables } = await import("../src/game/tables");
  const { ActorSpawn } = await import("../src/game/spawn");
  const { SpawnClass } = await import("../src/game/spawn_class");
  const { Scope } = await import("../src/core/scope");
  const { Object3D } = await import("three");
  await import("../src/game/classes");

  const ZOMBIE_TYPE = {
    type: 15, name: "znebi2", file: "znebi2.bin", bone_count: 2,
    actor_radius: 10,
    bones: [{ bone: 1, part: "bone01_1c07", slot: 0x1c07, offset: [0, 0, 0],
              parent: null, steps: [[0, 0, 10]], hit_slot: 0x1c07,
              hit_radius: 2.3, hit_centre: [0, 0, 0] }],
    reactions: {}, attacks: {},
    motions: { "1024": { bank: "h", frames: 1, fps: 30,
                         root: [0, 0, 0], rot: [0, 0, 0] } },
  };
  const AT = 43584;
  const PLACE = { at: AT, class: 0x25, char_type: 15, motion: 1024, hp: 0,
                  yaw: 0 };
  const CHARS = { types: { "15": ZOMBIE_TYPE }, placements: [PLACE] };

  const root = new Object3D();
  const rig = new Object3D();
  rig.name = "chr_znebi2_spawn000";
  rig.userData = { hod2_kind: "rig", hod2_rig: "chr_znebi2",
                   hod2_spawn_at: AT };
  const bone = new Object3D();
  bone.name = "chr_znebi2_spawn000_bone01_1c07";
  rig.add(bone);
  root.add(rig);

  ResetGameGlobals();
  // Its program as the bundle carries it, cut to the hold it is in while the
  // gun is live: held until camera path 79 reaches frame 100.
  SetGameTables(CHARS as never, undefined, undefined, { [String(AT)]: {
    charType: 15, removePath: 100, removeFrame: 65, flags2: 1, motion: 1024,
    phase: 0, entry: 0, cmds: [{ op: 1, mode: -1, a: 0, b: 0 },
                     { op: 0, mode: 1, a: 79, b: 100 }],
  } } as never);
  const chars = new CharacterLayer();
  const stage = new Scope("stage");
  chars.build(root, stage, CHARS as never);
  const a = ActorSpawn(AT, SpawnClass.ScriptedHumanoid, 15, "znebi2",
                       { visible: true });
  a.pos.x = 0; a.pos.y = 0; a.pos.z = -30;
  chars.syncSpawns([{ at: AT }], [a]);
  chars.update({} as never);
  const towards = { origin: { x: 0, y: 0, z: 0 },
                    dir: { x: 0, y: 0, z: -1 } };
  check("the zombie is drawn and alive, its record leaves bit 0x8000 clear "
        + "and its bone sphere is armed, so only its class could keep it out",
        a.visible && !a.dead && (a.flags & 0x8000) === 0
        && (a.boneRadius["1"] ?? 0) > 0,
        `visible ${a.visible} dead ${a.dead} flags 0x${a.flags.toString(16)} `
        + `radius ${a.boneRadius["1"]}`);
  check("a shot straight through its bone sphere does not find it",
        chars.pickShot(towards) === null, JSON.stringify(chars.pickShot(towards)));

  stage.dispose();
  G.g_object_list.length = 0;
}

/**
 * The bat's wings: a **synthetic** placement, adopted rather than spawned.
 *
 * `SpawnBatWings` (`FUN_0042E060`) makes the wing actor inside its body's
 * `Init`, exactly where the engine makes it, and the bundle carries a row for
 * it only so that there is a hierarchy to bind. Two rules meet here and both
 * have failed before in other shapes:
 *
 * * `SpawnScriptedCharacters` must **not** build from a synthetic row, or
 *   there are two actors at one address and the second ran no `Init`;
 * * the layer must adopt an actor the port made by a route that does not go
 *   through `readySpawns`, or the wing is a hierarchy that never learns what
 *   it draws and a bat has no wings.
 */
console.log("\nclass 0x31's root: all three angles, in obj+0x1FC's order 1");
{
  // `EnemyThrowerInit` writes `obj+0x1FC = 1` (`c686fc01000001` at
  // `0x004496A2`), and `SkeletonApplyRootMotion`'s draw tail takes arm 1 of
  // the jump table at `0x00411038`: `T; RotX; RotZ; RotY`. Built here with
  // the port's own transcriptions of those four calls, and compared element
  // by element against the node -- three unequal angles, so a wrong order, a
  // wrong axis or a dropped angle each move some element.
  const { placeThrowerRoot } = await import("../src/render/characters/thrower");
  const {
    MatIdentity, MatrixRotateX, MatrixRotateY, MatrixRotateZ, MatrixTranslate,
  } = await import("../src/game/matrix");
  const { Object3D } = await import("three");
  type Inst = Parameters<typeof placeThrowerRoot>[0];

  const a = makeActor(59548, SpawnClass.Thrower, 0x19, "zstin");
  a.pos = { x: -830.3, y: 163.9, z: -1289.8 };
  a.pitch = 0x1234; a.yaw = 0xc000; a.roll = 0xb000;
  const inst = { a, root: new Object3D() } as unknown as Inst;
  const placed = placeThrowerRoot(inst);
  inst.root.updateMatrix();
  const want = MatIdentity();
  MatrixTranslate(want, a.pos.x, a.pos.y, a.pos.z);
  MatrixRotateX(want, a.pitch);
  MatrixRotateZ(want, a.roll);
  MatrixRotateY(want, a.yaw);
  const got = inst.root.matrix.elements;
  const worst = Math.max(...want.map((v, i) => Math.abs(v - got[i])));
  check("a thrower's root is T * Rx(pitch) * Rz(roll) * Ry(yaw)",
        placed && worst < 1e-4, `placed ${placed}, worst element ${worst}`);

  // The wall-climber on its wall: its own up (+Y) points out of the wall,
  // toward +X, and its forward (-Z) points down it.
  a.pitch = 0; a.yaw = 0xc000; a.roll = 0xc000;
  placeThrowerRoot(inst);
  inst.root.updateMatrix();
  const e = inst.root.matrix.elements;
  check("stage 2's zstin lies on its wall: up is +X, forward is down",
        Math.abs(e[4] - 1) < 1e-6 && Math.abs(e[9] - 1) < 1e-6,
        `up (${e[4]}, ${e[5]}, ${e[6]}) back (${e[8]}, ${e[9]}, ${e[10]})`);

  const z = makeActor(0x30, SpawnClass.Zombie, 1, "zombie");
  check("...and any other class is left to the ordinary arm",
        !placeThrowerRoot({ a: z, root: new Object3D() } as unknown as Inst));
}

console.log("\nclass 0x25's root: all three angles, in model+0x68's order 1");
{
  // `ScriptedHumanoidInit` writes `model+0x68 = 1` straight after the build
  // (`c6476801` at `0x004841A9`, `EDI = obj+0x194`), so the body draws through
  // the same arm 1 as class 0x31: `T; RotX; RotZ; RotY`. Its object-path ride
  // writes all three angles, and a renderer that drew yaw alone stood the
  // boat's riders upright on a pitching deck.
  const { placeHumanoidRoot } =
    await import("../src/render/characters/humanoid");
  const {
    MatIdentity, MatrixRotateX, MatrixRotateY, MatrixRotateZ, MatrixTranslate,
  } = await import("../src/game/matrix");
  const { Object3D } = await import("three");
  type Inst = Parameters<typeof placeHumanoidRoot>[0];

  const a = makeActor(4128, SpawnClass.ScriptedHumanoid, 0x21, "rider");
  a.pos = { x: 12.5, y: -20, z: -300 };
  a.pitch = 0x3d8e; a.yaw = 0x4000; a.roll = 0x0800;
  const inst = { a, root: new Object3D() } as unknown as Inst;
  const placed = placeHumanoidRoot(inst);
  inst.root.updateMatrix();
  const want = MatIdentity();
  MatrixTranslate(want, a.pos.x, a.pos.y, a.pos.z);
  MatrixRotateX(want, a.pitch);
  MatrixRotateZ(want, a.roll);
  MatrixRotateY(want, a.yaw);
  const got = inst.root.matrix.elements;
  const worst = Math.max(...want.map((v, i) => Math.abs(v - got[i])));
  check("a scripted humanoid's root is T * Rx(pitch) * Rz(roll) * Ry(yaw)",
        placed && worst < 1e-4, `placed ${placed}, worst element ${worst}`);

  const z = makeActor(0x30, SpawnClass.Zombie, 1, "zombie");
  check("...and any other class is left to the ordinary arm",
        !placeHumanoidRoot({ a: z, root: new Object3D() } as unknown as Inst));
}

console.log("\nclass 0x13's prop: the record's three angles, drawn RotX first");
{
  // `ScriptedPropUpdate13` (`FUN_0043FE90`) draws `MatrixTranslate(obj+0x40);
  // MatrixRotateX(obj+0x64); MatrixRotateZ(obj+0x6C); MatrixRotateY(obj+0x68);
  // MatrixScale(s, s, s)` (`0x0043FEE3`..`0x0043FF1E`), and all three angles
  // come off the record through `SpawnFromDescriptorSmall` (`FUN_00408BC0`).
  // Built here from the placement through `SpawnSlotActors`, drawn by the
  // layer, and compared element by element with the port's transcriptions of
  // those five calls -- three unequal angles and a scale that is not 1, so a
  // dropped angle at the spawn, a wrong order or a wrong axis in the draw each
  // move some element (`L48`).
  const { RunPendingInits, SpawnSlotActors } =
    await import("../src/game/director");
  const { SetGameTables } = await import("../src/game/tables");
  const { Rng } = await import("../src/core/rng");
  const {
    MatIdentity, MatrixRotateX, MatrixRotateY, MatrixRotateZ, MatrixScale,
    MatrixTranslate,
  } = await import("../src/game/matrix");
  await import("../src/game/classes");

  const SLOT = 0x1383;
  const root = new Obj3D();
  const part = new Obj3D();
  part.name = `slots_actor_fixed000_slot_${SLOT.toString(16)}`;
  part.userData = { hod2_kind: "rig_part", hod2_rig: "slots_actor" };
  root.add(part);
  ResetGameGlobals();
  const layer = new SlotModelLayer();
  layer.adopt(root);
  // Stage 2's `etc_1.bin[63]` at its own 15x and its own pitch, 0x2800, with
  // a yaw and a roll added that no shipped class-0x13 record has.
  const AT = 84232;
  SetGameTables({
    types: {}, placements: [{
      at: AT, class: 0x13, char_type: -1, motion: null, hp: 0,
      pitch: 0x2800, yaw: 0x1c00, roll: 0x0a00, init_flags: 0x8000,
      class13: { slot: SLOT, cam_path: 114, cam_frame: 0, scale: 15,
                 behaviour: 0, selector: 65 },
    }],
  } as never);
  const pos = { x: -1600, y: 1400, z: -2750 };
  SpawnSlotActors([{ at: AT, class: SpawnClass.ScriptedProp,
                     pos: [pos.x, pos.y, pos.z] }]);
  RunPendingInits(new Rng(1));
  const ctx = { paths: null } as unknown as Parameters<typeof layer.update>[0];
  layer.update(ctx);
  const node = layer.nodeFor(AT);
  node?.updateMatrix();
  const want = MatIdentity();
  MatrixTranslate(want, pos.x, pos.y, pos.z);
  MatrixRotateX(want, 0x2800);
  MatrixRotateZ(want, 0x0a00);
  MatrixRotateY(want, 0x1c00);
  MatrixScale(want, 15, 15, 15);
  const got = node?.matrix.elements ?? [];
  const worst = node
    ? Math.max(...want.map((v, i) => Math.abs(v - got[i]) / Math.max(1, Math.abs(v))))
    : Infinity;
  check("a class-0x13 prop spawned from its record is drawn "
        + "T * Rx(pitch) * Rz(roll) * Ry(yaw) * S",
        worst < 1e-4, node ? `worst relative element ${worst}` : "no node");

  // The shipped record alone, `(0x2800, 0, 0)`: the quads' face, +z in the
  // model, tips 0x2800 about x and turns down toward the ground at
  // `(0, -sin, cos)` -- the disc faces the viewer below it rather than the
  // horizon. Upright, the column would be `(0, 0, 1)`.
  const a = G.g_object_list.find((o) => o.at === AT);
  if (a) { a.yaw = 0; a.roll = 0; }
  layer.update(ctx);
  node?.updateMatrix();
  const e = node?.matrix.elements ?? [];
  const th = 0x2800 * Math.PI * 2 / 65536;
  const face = [8, 9, 10].map((i) => (e[i] ?? 0) / 15);
  check("stage 2's etc_1.bin[63] faces down at 0x2800, not the horizon",
        Math.abs(face[0]) < 1e-6 && Math.abs(face[1] + Math.sin(th)) < 1e-5
        && Math.abs(face[2] - Math.cos(th)) < 1e-5,
        face.map((v) => v.toFixed(4)).join(", "));
  G.g_object_list.length = 0;
  SetGameTables({ types: {}, placements: [] } as never);
}

console.log("\nclass 0x13's prop: the alpha and the layer the behaviour leaves");
{
  // `ScriptedPropUpdate13` (`FUN_0043FE90`) draws `AssetDrawSlotWithAlpha`
  // whenever `sub+0x18` is not 1.0 (`0x0043FF2F`..`0x0043FF62`), in the
  // layer the behaviour set -- carrier selector 3's 9 (`FUN_00440AD0`, every
  // arm of states 1..6). Stage 4's monitor, `0x966`, at its dimmed 0.7.
  const { RunPendingInits, SpawnSlotActors } =
    await import("../src/game/director");
  const { SetGameTables } = await import("../src/game/tables");
  const { Rng } = await import("../src/core/rng");
  const { BoxGeometry } = await import("three");
  const { meshDrawAlpha } = await import("../src/render/draw_order");
  await import("../src/game/classes");

  const SLOT = 0x966;
  const root = new Obj3D();
  const part = new Obj3D();
  part.name = `slots_actor_fixed000_slot_${SLOT.toString(16).padStart(4, "0")}`;
  part.userData = { hod2_kind: "rig_part", hod2_rig: "slots_actor" };
  part.add(new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial()));
  root.add(part);
  ResetGameGlobals();
  const layer = new SlotModelLayer();
  layer.adopt(root);
  const AT = 35916;
  SetGameTables({
    types: {}, placements: [{
      at: AT, class: 0x13, char_type: -1, motion: null, hp: 0,
      yaw: 0, init_flags: 0x8000,
      class13: { slot: SLOT, cam_path: 180, cam_frame: 0, scale: 1,
                 behaviour: 8, selector: 3 },
    }],
  } as never);
  SpawnSlotActors([{ at: AT, class: SpawnClass.ScriptedProp,
                     pos: [318.281982421875, 0, -353.91998291015625] }]);
  RunPendingInits(new Rng(1));
  const ctx = { paths: null } as unknown as Parameters<typeof layer.update>[0];
  const a = G.g_object_list.find((o) => o.at === AT) as
    { prop13: { alpha: number; drawLayer: number } } | undefined;
  const meshOf = () => {
    let m: InstanceType<typeof Mesh> | null = null;
    layer.nodeFor(AT)?.traverse((o) => {
      if ((o as InstanceType<typeof Mesh>).isMesh) m = o as InstanceType<typeof Mesh>;
    });
    return m as InstanceType<typeof Mesh> | null;
  };
  layer.update(ctx);
  const before = layer.nodeFor(AT)?.renderOrder;
  const m0 = meshOf();
  check("a class-0x13 prop at alpha 1.0 in layer 8 draws plainly, in the "
        + "template's order", !!a && !!m0 && meshDrawAlpha(m0) === null
        && before === 0, `${before} ${m0 && meshDrawAlpha(m0)}`);
  if (a) { a.prop13.alpha = Math.fround(0.7); a.prop13.drawLayer = 9; }
  layer.update(ctx);
  const m1 = meshOf();
  check("...at 0.7 in layer 9 it is faded to 0.7 and ordered one layer on",
        !!m1 && Math.abs((meshDrawAlpha(m1) ?? 0) - 0.7) < 1e-6
        && layer.nodeFor(AT)?.renderOrder === 1,
        `${m1 && meshDrawAlpha(m1)} ${layer.nodeFor(AT)?.renderOrder}`);
  if (a) a.prop13.alpha = 1;
  layer.update(ctx);
  const m2 = meshOf();
  check("...and back at 1.0 the fade is gone",
        !!m2 && meshDrawAlpha(m2) === null);
  G.g_object_list.length = 0;
  SetGameTables({ types: {}, placements: [] } as never);
}

console.log("\nclass 0x12's strip: the cursor's slot, truncated, under class 0x13's matrix");
{
  // `ScriptedPropUpdate12` (`FUN_0043FA60`) draws `MatrixTranslate(obj+0x40);
  // MatrixRotateX(+0x64); MatrixRotateZ(+0x6C); MatrixRotateY(+0x68)`, the
  // scale when it is not 1.0, and `AssetDrawSlot(__ftol(sub+0x14))`
  // (`0x0043FB05`..`0x0043FB5D`). Stage 1's door is modelled in world space
  // and placed at the origin unturned, so its own record cannot fail a wrong
  // order; a record with three unequal angles and a scale of 2 can (`L48`).
  const { RunPendingInits, SpawnSlotActors } =
    await import("../src/game/director");
  const { SetGameTables } = await import("../src/game/tables");
  const { Rng } = await import("../src/core/rng");
  const {
    MatIdentity, MatrixRotateX, MatrixRotateY, MatrixRotateZ, MatrixScale,
    MatrixTranslate,
  } = await import("../src/game/matrix");
  await import("../src/game/classes");
  const { ScriptedPropUpdate12 } = await import("../src/game/class12");
  const { NULL_HOST } = await import("../src/game/host");

  const root = new Obj3D();
  for (const slot of [0x11fd, 0x11fe, 0x11ff]) {
    const part = new Obj3D();
    part.name = `slots_actor_fixed000_slot_${slot.toString(16)}`;
    part.userData = { hod2_kind: "rig_part", hod2_rig: "slots_actor" };
    root.add(part);
  }
  ResetGameGlobals();
  const layer = new SlotModelLayer();
  layer.adopt(root);
  const AT = 0x3d88;
  SetGameTables({
    types: {}, placements: [{
      at: AT, class: 0x12, char_type: -1, motion: null, hp: 0,
      pitch: 0x2800, yaw: 0x1c00, roll: 0x0a00, init_flags: 0x10,
      class12: { slot: 0x11fd, delay: 1, coli: null, behaviour: 0,
                 cam_path: 47, cam_frame: 130, first: 0x11fe, last: 0x1233,
                 flag: 34, step: 0.5, scale: 2 },
    }],
  } as never);
  const pos = { x: -660, y: -15.5, z: -547 };
  const rng = new Rng(1);
  SpawnSlotActors([{ at: AT, class: SpawnClass.FlagStripProp,
                     pos: [pos.x, pos.y, pos.z] }]);
  RunPendingInits();
  const ctx = { paths: null } as unknown as Parameters<typeof layer.update>[0];
  const slotOf = () => {
    const n = layer.nodeFor(AT);
    return n ? Number.parseInt(n.name.split("_slot_")[1] ?? "", 16) : null;
  };
  layer.update(ctx);
  check("the door is drawn on its waiting slot, 0x11FD", slotOf() === 0x11fd,
        String(slotOf()));
  const node = layer.nodeFor(AT);
  node?.updateMatrix();
  const want = MatIdentity();
  MatrixTranslate(want, pos.x, pos.y, pos.z);
  MatrixRotateX(want, 0x2800);
  MatrixRotateZ(want, 0x0a00);
  MatrixRotateY(want, 0x1c00);
  MatrixScale(want, 2, 2, 2);
  const got = node?.matrix.elements ?? [];
  const worst = node
    ? Math.max(...want.map((v, i) => Math.abs(v - got[i]) / Math.max(1, Math.abs(v))))
    : Infinity;
  check("a class-0x12 object is drawn T * Rx(pitch) * Rz(roll) * Ry(yaw) * S",
        worst < 1e-4, node ? `worst relative element ${worst}` : "no node");
  const a = G.g_object_list.find((o) => o.at === AT);
  const fr = { dt: 1 / 60, rng, host: NULL_HOST };
  G.g_script_flags[34] = 1;
  if (a) ScriptedPropUpdate12(a, fr);           // the delay runs out: 0x11FE
  layer.update(ctx);
  const first = slotOf();
  if (a) ScriptedPropUpdate12(a, fr);           // 0x11FE.5
  layer.update(ctx);
  const half = slotOf();
  if (a) ScriptedPropUpdate12(a, fr);           // 0x11FF
  layer.update(ctx);
  check("once the flag is up the node follows the cursor, truncated: "
        + "0x11FE, 0x11FE again at half a slot, then 0x11FF",
        first === 0x11fe && half === 0x11fe && slotOf() === 0x11ff,
        `${first} ${half} ${slotOf()}`);
  G.g_object_list.length = 0;
  layer.update(ctx);
  check("...and nothing is left drawn once the object is gone",
        layer.nodeFor(AT) === null, String(layer.nodeFor(AT)));
  SetGameTables({ types: {}, placements: [] } as never);
  ResetGameGlobals();
}

console.log("\nthe bat's wings: a synthetic row, adopted not spawned");
{
  const { CharacterLayer } = await import("../src/render/characters");
  const { RunPendingInits, SpawnScriptedCharacters } =
    await import("../src/game/director");
  const { G, ResetGameGlobals } = await import("../src/game/globals");
  const { SetGameTables } = await import("../src/game/tables");
  const { Scope } = await import("../src/core/scope");
  const { Object3D } = await import("three");
  await import("../src/game/classes");

  const M = { bank: "z", frames: 1, fps: 30, root: [0, 0, 0], rot: [0, 0, 0] };
  const BODY = {
    type: 0x1e, name: "zabat", file: "zabat.bin", bone_count: 2,
    actor_radius: 10, reactions: {}, attacks: {},
    bones: [{ bone: 1, part: "bone01_1b01", slot: 0x1b01, offset: [0, 0, 0],
              parent: null }],
    motions: { "1031": M },
  };
  const WING = {
    type: 0x1f, name: "zabat_wing", file: "zabat_wing.bin", bone_count: 7,
    actor_radius: 10, reactions: {}, attacks: {},
    bones: [{ bone: 1, part: "bone01_1b03", slot: 0x1b03, offset: [0, 0, 0],
              parent: null }],
    motions: { "1030": M },
  };
  const CHARS = {
    types: { "30": BODY, "31": WING },
    placements: [
      { at: 0x0f04, class: 0x46, char_type: 0x1e, motion: 1031, hp: 1, yaw: 0,
        class46: { subtype: 0, group: 0, member: 0 } },
      { at: 0x40000f04, class: 0x46, char_type: 0x1f, motion: 1030, hp: 0,
        yaw: 0, parent_at: 0x0f04, synthetic: true },
    ],
  };

  const root = new Object3D();
  for (const [name, at] of [["chr_zabat_spawn000", 0x0f04],
                            ["chr_zabat_wing_spawn000", 0x40000f04]] as
                           [string, number][]) {
    const rig = new Object3D();
    rig.name = name;
    rig.userData = { hod2_kind: "rig", hod2_rig: name.replace(/_spawn\d+$/, ""),
                     hod2_spawn_at: at };
    const bone = new Object3D();
    bone.name = `${name}_bone01_${at === 0x0f04 ? "1b01" : "1b03"}`;
    rig.add(bone);
    root.add(rig);
  }

  ResetGameGlobals();
  SetGameTables(CHARS as never);
  const chars = new CharacterLayer();
  const stage = new Scope("stage");
  chars.build(root, stage, CHARS as never);

  // The script lists the body and nothing else; the wing rides its parent.
  const listed = [{ at: 0x0f04 }];
  const ready = chars.readySpawns(listed);
  check("the wing's row is wanted because its parent is",
        ready.some((r) => r.at === 0x40000f04),
        ready.map((r) => r.at.toString(16)).join(","));

  const made = SpawnScriptedCharacters(ready);
  RunPendingInits();
  check("...but nothing is spawned from it: the placer made the wing",
        made.length === 1 && made[0].at === 0x0f04,
        made.map((m) => m.at.toString(16)).join(","));
  const wing = G.g_object_list.find((o) => o.at === 0x40000f04);
  check("...and `SpawnBatWings` did, exactly once",
        !!wing && G.g_object_list.filter((o) => o.at === 0x40000f04).length === 1,
        `${G.g_object_list.length} objects`);

  chars.syncSpawns(listed, made);
  check("the layer adopted the wing the placer made",
        chars.readySpawns(listed).every((r) => r.at !== 0x40000f04),
        chars.readySpawns(listed).map((r) => r.at.toString(16)).join(","));

  stage.dispose();
  G.g_object_list.length = 0;
}

/**
 * The scatter's and the swarm's members, and their wings: **runtime children**
 * of a placer, drawn from synthetic rows at the address the port's placer
 * gives each one (`BatChildAt`, `BatWingAt`), parented to the placer's own
 * row. `PlaceBats` makes every object and the layer adopts them -- which is
 * the whole of the change that makes sub-types 1 and 2 visible.
 *
 * And the wing's seat, against the renderer rather than against itself:
 * `BatWingUpdate` builds the body's node matrix in `game/` the way the draw
 * builds it, and the check is that the point it seats the wing at is where the
 * pose this layer made puts `(0, 1, 2)` -- rotation order, signs, the root
 * record's half-turn and the 0.6 model scale all at once.
 */
console.log("\nthe bat's runtime children: rows at the placer's addresses");
{
  const { CharacterLayer } = await import("../src/render/characters");
  const { RunPendingInits, SpawnScriptedCharacters } =
    await import("../src/game/director");
  const { G, ResetGameGlobals } = await import("../src/game/globals");
  const { SetGameTables } = await import("../src/game/tables");
  const { Scope } = await import("../src/core/scope");
  const { Object3D, Vector3, Matrix4 } = await import("three");
  const { BatChildAt, BatUpdate, BatWingAt } =
    await import("../src/game/class46");
  const { BatState, BatSubtype } = await import("../src/game/class46/state");
  await import("../src/game/classes");

  // One frame of `bat.bin` 1031's real shape: the root record is a half-turn
  // about y, tipped by 3679 about x, and the root sits 0.4 low.
  const BODY_CLIP = { bank: "z", frames: 1, fps: 30, root: [0, -0.4, 0],
                      rot: [3679, 32767, 0, 0, 0, 0] };
  const WING_CLIP = { bank: "z", frames: 1, fps: 30, root: [0, 0, 0],
                      rot: [0, 0, 0, 0, 0, 0] };
  const BODY = {
    type: 0x1e, name: "zabat", file: "zabat.bin", bone_count: 2,
    actor_radius: 10, reactions: {}, attacks: {},
    bones: [{ bone: 1, part: "bone01_1b01", slot: 0x1b01, offset: [0, 0, 0],
              parent: null }],
    motions: { "1031": BODY_CLIP },
  };
  const WING = {
    type: 0x1f, name: "zabat_wing", file: "zabat_wing.bin", bone_count: 2,
    actor_radius: 10, reactions: {}, attacks: {},
    bones: [{ bone: 1, part: "bone01_1b03", slot: 0x1b03,
              offset: [0, 1.674, -0.7731], parent: null }],
    motions: { "1030": WING_CLIP },
  };
  const PLACER = 0x3190;
  const rows: Record<string, unknown>[] = [
    { at: PLACER, class: 0x46, char_type: 0x1e, motion: 1031, hp: 1, yaw: 0,
      class46: { subtype: 1, group: 0, member: 0 } },
  ];
  for (let i = 0; i < 25; i += 1) {
    const body = BatChildAt(PLACER, BatSubtype.Scatter, i);
    rows.push({ at: body, class: 0x46, char_type: 0x1e, motion: 1031, hp: 0,
                yaw: 0, parent_at: PLACER, synthetic: true });
    rows.push({ at: BatWingAt(body), class: 0x46, char_type: 0x1f,
                motion: 1030, hp: 0, yaw: 0, parent_at: PLACER,
                synthetic: true });
  }
  const CHARS = { types: { "30": BODY, "31": WING }, placements: rows };

  const root = new Object3D();
  let n = 0;
  for (const r of rows) {
    const wing = r.char_type === 0x1f;
    const name = `chr_${wing ? "zabat_wing" : "zabat"}_spawn`
      + String(n++).padStart(3, "0");
    const rig = new Object3D();
    rig.name = name;
    rig.userData = { hod2_kind: "rig", hod2_rig: name.replace(/_spawn\d+$/, ""),
                     hod2_spawn_at: r.at };
    const bone = new Object3D();
    bone.name = `${name}_bone01_${wing ? "1b03" : "1b01"}`;
    if (wing) bone.position.set(0, 1.674, -0.7731);
    rig.add(bone);
    root.add(rig);
  }

  ResetGameGlobals();
  SetGameTables(CHARS as never);
  G.g_players_in_play = 1;
  const chars = new CharacterLayer();
  const stage = new Scope("stage");
  chars.build(root, stage, CHARS as never);

  const listed = [{ at: PLACER }];
  const ready = chars.readySpawns(listed);
  check("every member's row and every wing's is wanted with the placer's",
        ready.length === 51, `${ready.length}`);
  const made = SpawnScriptedCharacters(ready);
  RunPendingInits();
  check("...but only the placer is spawned from its row",
        made.length === 1 && made[0].at === PLACER,
        made.map((m) => m.at.toString(16)).join(","));
  chars.syncSpawns(listed, made);
  const adopted = new Set(chars.actors.map((a) => a.at));
  const want = rows.slice(1).map((r) => r.at as number);
  check("...and the layer adopted all twenty-five bats and their wings",
        want.every((at) => adopted.has(at)),
        `${want.filter((at) => adopted.has(at)).length} of ${want.length}`);
  check("...and none of them twice",
        chars.actors.length === new Set(chars.actors.map((a) => a.at)).size,
        `${chars.actors.length}`);

  // Put member 0 somewhere a sign or an axis would show (L48), tumbling as a
  // corpse does, and seat its wing.
  const bat = (a: unknown) => (a as { bat: { state: number } }).bat;
  const body = G.g_object_list.find((o) => o.at === want[0])!;
  const wing = G.g_object_list.find((o) => o.at === want[1])!;
  body.pos.x = 12; body.pos.y = -8; body.pos.z = -3600;
  body.yaw = 0x4000; body.pitch = 0x3000; body.roll = 0;
  BatUpdate(wing, { host: {} } as never);
  chars.update({} as never);
  const m = new Matrix4();
  const e: number[] = new Array(16).fill(0);
  check("the body is posed", chars.boneMatrix(body.at, 1, e),
        BatState[bat(body).state] ?? "");
  m.fromArray(e);
  const seat = new Vector3(0, 1, 2).applyMatrix4(m);
  check("the wing sits where the drawn body puts (0, 1, 2)",
        seat.distanceTo(new Vector3(wing.pos.x, wing.pos.y, wing.pos.z))
          < 1e-3,
        `${seat.toArray().map((v) => v.toFixed(3))} vs `
        + `${[wing.pos.x, wing.pos.y, wing.pos.z].map((v) => v.toFixed(3))}`);
  const scaleOf = (el: number[]) =>
    Math.hypot(el[0], el[1], el[2]);
  check("...and the body is drawn at its model's 0.6",
        Math.abs(scaleOf(e) - 0.6) < 1e-4, scaleOf(e).toFixed(4));
  chars.boneMatrix(wing.at, 1, e);
  check("...and the wing at its 0.7",
        Math.abs(scaleOf(e) - 0.7) < 1e-4, scaleOf(e).toFixed(4));

  stage.dispose();
  G.g_object_list.length = 0;
}

/**
 * `BatSplashUpdate` (`FUN_0042F930`)'s draw: `common.bin` 307..336, one a
 * frame, under a bare translation at the water plane.
 */
console.log("\nthe bat's splash: thirty models, one a frame, on the water");
{
  const { G, ResetGameGlobals } = await import("../src/game/globals");
  const { BatSplashesTick, SpawnBatSplash } =
    await import("../src/game/class46/splash");
  const root = new Obj3D();
  for (let slot = 0x1339; slot <= 0x1356; slot += 1) {
    const part = new Obj3D();
    part.name =
      `slots_effect_fixed000_slot_${slot.toString(16).padStart(4, "0")}`;
    part.userData = { hod2_kind: "rig_part", hod2_rig: "slots_effect" };
    root.add(part);
  }
  ResetGameGlobals();
  const layer = new EffectLayer();
  layer.adopt(root);
  const camera = new PerspectiveCamera(41.1, 4 / 3, 0.8, 8000);
  camera.updateMatrixWorld(true);
  const ctx = { camera } as unknown as Parameters<typeof layer.update>[0];

  SpawnBatSplash(-400, -31.5, -3620);
  BatSplashesTick();
  layer.update(ctx);
  const node = layer.group.children[0];
  check("a splash is one node in the world, on its first model",
        layer.group.children.length === 1
        && !!node?.name.endsWith("slot_1339"),
        `${layer.group.children.length} ${node?.name}`);
  check("...at the corpse's x and z and the plane's y, unturned, full size",
        node?.position.x === -400 && node.position.y === -25
        && node.position.z === -3620 && node.quaternion.w === 1
        && node.scale.x === 1, `${node?.position.toArray()}`);
  for (let i = 0; i < 29; i += 1) BatSplashesTick();
  layer.update(ctx);
  check("...and on its thirtieth, the last",
        !!layer.group.children[0]?.name.endsWith("slot_1356"),
        layer.group.children[0]?.name ?? "none");
  BatSplashesTick();
  layer.update(ctx);
  check("...and then nothing", layer.group.children.length === 0
        && G.g_bat_splashes.length === 0, `${layer.group.children.length}`);
}

// -- class 0x40's sheet ------------------------------------------------------
//
// `HordeDeformedPropUpdate` (`FUN_0043F010`)'s reshape, on a flat grid: the
// vertex under a member rises the full 1.2, one five units off in x and z is
// flat, and the normals lean with the bump.
{
  const { deformHordeSheet } = await import("../src/render/horde");
  const { G, ResetGameGlobals } = await import("../src/game/globals");
  const { ActorSpawn } = await import("../src/game/spawn");
  const { SpawnClass } = await import("../src/game/spawn_class");
  const { HordeKind } = await import("../src/game/class40/state");
  const three = await import("three");
  ResetGameGlobals();
  const sheet = ActorSpawn(0x18000000, SpawnClass.HordeSpawner, -1, "sheet");
  const member = ActorSpawn(0x10000000, SpawnClass.HordeSpawner, 0x1d, "m");
  const st = (sheet as unknown as { horde: { kind: number; drawn: boolean;
    propX: number; propY: number; propZ: number } }).horde;
  st.kind = HordeKind.Sheet;
  st.drawn = true;
  st.propX = -530; st.propY = 33.5; st.propZ = -1318;
  member.pos.x = -530 + 2; member.pos.y = 34; member.pos.z = -1318 - 1;
  G.g_horde_members = [member.at, 0, 0];
  // A 21x21 grid over [-10, 10], flat at y = 0.3 so "laid flat" shows.
  const geo = new three.PlaneGeometry(20, 20, 20, 20);
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, 0.3, 0);
  const root = new three.Object3D();
  root.add(new three.Mesh(geo, new three.MeshBasicMaterial()));
  deformHordeSheet(root, sheet);
  const pos = geo.attributes.position;
  const nrm = geo.attributes.normal;
  const at = (x: number, z: number) => {
    for (let i = 0; i < pos.count; i += 1) {
      if (Math.abs(pos.getX(i) - x) < 1e-6 && Math.abs(pos.getZ(i) - z) < 1e-6) {
        return i;
      }
    }
    return -1;
  };
  const top = at(2, -1);
  check("the sheet rises 1.2 right over a member",
        top >= 0 && Math.abs(pos.getY(top) - 1.2) < 1e-6, `${pos.getY(top)}`);
  const far = at(-8, 8);
  check("...and is laid flat where no member is near",
        far >= 0 && pos.getY(far) === 0, `${pos.getY(far)}`);
  const side = at(4, -1);
  check("...slopes between, by the half-sine of the distance",
        side >= 0 && pos.getY(side) > 0 && pos.getY(side) < 1.2,
        `${pos.getY(side)}`);
  check("...and the normals lean off the bump's flank",
        side >= 0 && nrm.getX(side) > 0.1 && nrm.getY(side) > 0,
        `${nrm.getX(side)},${nrm.getY(side)}`);
  const before = pos.getY(top);
  G.g_horde_members = [0, 0, 0];
  deformHordeSheet(root, sheet);
  check("...with no member about, it keeps the shape it had",
        pos.getY(top) === before, `${pos.getY(top)}`);
  G.g_horde_members = [member.at, 0, 0];
  st.drawn = false;
  member.pos.x += 5;
  deformHordeSheet(root, sheet);
  check("...and a frozen sheet is not reshaped", pos.getY(top) === before);
  G.g_object_list.length = 0;
}

console.log("\nthe gun light takes a scene-lit mesh with the torch's program, not the scene light's:");
{
  // `GunLights` built its twin from the material the mesh wore, which under
  // "+ scene light" is the device-lit twin: chained under the gun light's
  // patch, that twin's patch had already stripped `lights_fragment_begin`
  // (the spot loop and its shadows) and rewritten the output, so the torch
  // drew nothing and cast nothing.
  const { GunLights } = await import("../src/render/gunlights");
  const base = new MeshBasicMaterial();
  base.userData = { pvr2: { tex_ambient: 0.75, specular: [0, 0, 0], specular_power: 0 } };
  const mesh = new Mesh(new PlaneGeometry(1, 1), base);
  const root = new Group();
  root.add(mesh);
  const scene = new Scene();
  const lights = new SceneLighting(scene);
  lights.build(root);
  lights.beforeRender();
  check("the mesh wears its scene-lit twin first",
        (mesh.material as { customProgramCacheKey(): string })
          .customProgramCacheKey() === "d3dlit");
  const gun = new GunLights(scene, lights);
  (gun as unknown as { light(m: unknown): void }).light(mesh);
  const lit = mesh.material as InstanceType<typeof MeshBasicMaterial>;
  const shader = {
    vertexShader: ShaderLib.lambert.vertexShader,
    fragmentShader: ShaderLib.lambert.fragmentShader,
    uniforms: {} as Record<string, { value: unknown }>,
  };
  lit.onBeforeCompile(shader as never, undefined as never);
  check("the gun-lit twin keeps three.js's spot loop, where the torch and its "
        + "shadow are evaluated",
        shader.fragmentShader.includes("NUM_SPOT_LIGHTS")
        && shader.fragmentShader.includes("gunAmbient * PI"),
        lit.userData?.gunLit ? "gunLit" : "not gunLit");
  check("...and is not the scene light's device equation underneath",
        !shader.fragmentShader.includes("vD3dColour")
        && !shader.vertexShader.includes("d3dLightDir"));
  check("...and skips a dark light in both loops, since every light is always "
        + "in the scene",
        shader.fragmentShader.includes("greaterThan( spotLight.color")
        && shader.fragmentShader.includes("greaterThan( pointLight.color"));

  // A light that comes and goes changes every program's key: three.js counts
  // the visible lights and the shadowed ones into each. So turning the torch
  // on and off must change neither, only its intensity and its shadow pass.
  const { GUN_LIGHT_FIRST: first } = await import("../src/game/scene_lights");
  type L = { isLight?: boolean; visible: boolean; castShadow: boolean };
  const config = () => {
    const out: string[] = [];
    gun.group.traverse((o) => {
      const l = o as unknown as L;
      if (l.isLight) out.push(`${o.name}:${l.visible}:${l.castShadow}`);
    });
    return out.join(" ");
  };
  const torch = gun.group.getObjectByName("gun_light_1") as unknown as {
    intensity: number; shadow: { autoUpdate: boolean };
  };
  const view = { camera: new PerspectiveCamera() } as unknown as RenderContextT;
  // The entry as `BuildEntitySpotlightArray` writes it: white, `att0` 0.5.
  const { G: g } = await import("../src/game/globals");
  const entry = g.g_entity_lights[first];
  const kept = { diffuse: entry.diffuse, att0: entry.att0 };
  entry.diffuse = [1, 1, 1];
  entry.att0 = 0.5;
  let on = false;
  gun.source = { live: (i) => on && i === first, litActor: () => false };
  gun.update(view);
  const dark = config();
  on = true;
  gun.update(view);
  const litUp = config();
  const lightOn = torch.intensity > 0 && torch.shadow.autoUpdate;
  on = false;
  gun.update(view);
  check("the torch comes on and goes off with no light's visibility or shadow "
        + "changed",
        dark === litUp && config() === dark && dark.split(" ").length === 28
        && !dark.includes(":false:"),
        dark);
  check("...only its intensity and its shadow pass",
        lightOn && torch.intensity === 0 && !torch.shadow.autoUpdate,
        `on: ${lightOn}, off: ${torch.intensity} ${torch.shadow.autoUpdate}`);
  entry.diffuse = kept.diffuse;
  entry.att0 = kept.att0;
}

console.log("\nthe gun lights are built off the camera this frame draws:");
{
  // `GunLightBuildSystem` runs after the camera draw, so the torch is placed
  // off the camera the frame is drawn with. It used to run inside the port's
  // frame, against `ctx.view` -- the camera as the *last* draw left it -- and
  // subtracted a block eye seated a frame later: on a moving camera the torch
  // swung between two aims at the display's refresh rate.
  const { GameSystem, GunLightBuildSystem } = await import("../src/app/systems");
  const { G: g, ResetGameGlobals: reset } = await import("../src/game/globals");
  const { PlayerTasksRun } = await import("../src/game/player_shell");
  const { NULL_HOST } = await import("../src/game/host");
  const { Rng } = await import("../src/core/rng");
  const { SetPlayerAimFromPointer, GUN_LIGHT_FIRST }
    = await import("../src/game/scene_lights");
  const game = new GameSystem();
  const build = new GunLightBuildSystem(game);
  const cam = new PerspectiveCamera();
  // A player in play, the way the page gets one: the reset's start press and
  // the first player turn. The light is lit only for a player at state 5.
  reset();
  PlayerTasksRun({ host: NULL_HOST, rng: new Rng(1) });
  g.g_scene_lighting = 1;
  g.g_entity_spotlights_on = 1;
  SetPlayerAimFromPointer(0, 0, 0);
  // The block eye deliberately somewhere else: the aim must not read it.
  g.g_camera_block_eye = { x: -500, y: -500, z: -500 };
  const ctx = { camera: cam } as unknown as RenderContextT;
  const light = g.g_entity_lights[GUN_LIGHT_FIRST];
  cam.position.set(10, 20, 30);
  build.update(ctx);
  const at1 = `${light.pos.x.toFixed(6)},${light.pos.y.toFixed(6)},${light.pos.z.toFixed(6)}`;
  check("the torch is one unit ahead of the camera just placed",
        at1 === "10.000000,20.000000,29.000000", at1);
  // Move the camera and build again with nothing in between -- no tick, no
  // `CameraTakeSystem`: exactly an idle rAF after a draw that moved it.
  cam.position.set(15, 20, 30);
  build.update(ctx);
  const at2 = `${light.pos.x.toFixed(6)},${light.pos.y.toFixed(6)},${light.pos.z.toFixed(6)}`;
  check("...and follows the camera on the next frame with no tick between",
        at2 === "15.000000,20.000000,29.000000", at2);
  check("...aimed straight down the camera's -Z, whatever the block eye says",
        Math.abs(light.dir.z + 1) < 1e-9 && Math.abs(light.dir.x) < 1e-9
        && Math.abs(light.dir.y) < 1e-9,
        `${light.dir.x} ${light.dir.y} ${light.dir.z}`);
  cam.rotation.set(0, Math.PI / 2, 0);
  build.update(ctx);
  check("...and turns with it: yawed a quarter turn left it points down -X",
        Math.abs(light.dir.x + 1) < 1e-6 && Math.abs(light.dir.z) < 1e-6,
        `${light.dir.x} ${light.dir.y} ${light.dir.z}`);
  g.g_scene_lighting = 0;
  g.g_entity_spotlights_on = 0;
}

// A queued screen sprite ignores the scene's depth; a plain one does not.
// `DrawSpriteQuadCommand` (`FUN_004A7AB0`) sends `g_ZFuncTable[flags >> 8 & 7]`
// (0 meaning 4) as ZFUNC, and the table makes 4 LESSEQUAL and 7 ALWAYS.
{
  const { ScreenSpritesDeep } = await import("../src/render/screen_sprites_deep");
  const { G: g } = await import("../src/game/globals");
  const { AlwaysDepth, LessEqualDepth, PerspectiveCamera, Texture }
    = await import("three");
  const deep = new ScreenSpritesDeep();
  deep.images = () => ({ w: 16, h: 16, url: "data:image/png;base64," });
  // `TextureLoader` needs a DOM; the depth test needs none of the image.
  (deep as unknown as { texture: () => unknown }).texture = () => new Texture();
  const cam = new PerspectiveCamera(41.1, 4 / 3, 0.8, 8000);
  g.g_screen_sprite_draws = [
    { id: 0xb6, x: 176, y: 35, depth: 1.002, sx: 1, sy: 0.8, alpha: 1,
      flags: 0x729 },
    { id: 0x59, x: 0, y: 0, depth: 120, sx: 1, sy: 1, alpha: 1, flags: 0 },
  ];
  deep.update({ camera: cam } as unknown as RenderContextT);
  const quads = deep.group.children as unknown as
    { material: { depthFunc: number } }[];
  check("a queued sprite (flags 0x700) is drawn with ZFUNC ALWAYS",
        quads[0]?.material.depthFunc === AlwaysDepth,
        `${quads[0]?.material.depthFunc}`);
  check("...and a plain one with LESSEQUAL, against the scene",
        quads[1]?.material.depthFunc === LessEqualDepth,
        `${quads[1]?.material.depthFunc}`);
  g.g_screen_sprite_draws = [];
}

// The two passes and the translucent order: `render/draw_order.ts`.
// `TranslatePvr2StateToD3D` (`FUN_004A7780`) decides a mesh's composite state
// from its ISP and TSP words; `RenderCommandCompare` (`FUN_004A8A20`) orders
// the commands `WalkMeshChainAndDraw` (`FUN_004A7EF0`) deferred.
console.log("\nthe engine's two passes, and the translucent order");
{
  const three = await import("three");
  const {
    applyPvr2DrawState, applyForcedAlphaBlend, copyDrawState,
    prepareDrawCommands, RenderCommandOrder, ALPHA_REF, DRAW_LAYER_7_ORDER,
  } = await import("../src/render/draw_order");
  const { setSlotAlpha } = await import("../src/render/boss3_effects");

  const hex = (v: number) =>
    `0x${(v >>> 0).toString(16).toUpperCase().padStart(8, "0")}`;
  /** A material as `GLTFLoader` delivers an exported one. */
  const exported = (isp: number, tsp: number, blend = true) => {
    const m = new MeshBasicMaterial({
      transparent: blend, depthWrite: !blend });
    m.userData = { pvr2: { isp_tsp_instruction: hex(isp),
                           tsp_instruction: hex(tsp) } };
    return m;
  };

  // The stage-2 car's body shell: `char_adv04` mesh 0.
  const body = exported(0x83000000, 0x94000463);
  applyPvr2DrawState(body, { isp: 0x83000000, tsp: 0x94000463 });
  check("a translucent mesh is in the second pass: transparent",
        body.transparent === true);
  check("...and writes depth: ISP bit 26 is clear in every mesh in the game",
        body.depthWrite === true, `${body.depthWrite}`);
  check("...compared LESSEQUAL: g_ZFuncTable[4] is D3DCMP_LESSEQUAL",
        body.depthFunc === three.LessEqualDepth, `${body.depthFunc}`);
  check("...blended with its own factors, SRCALPHA / INVSRCALPHA",
        body.blending === three.CustomBlending
        && body.blendSrc === three.SrcAlphaFactor
        && body.blendDst === three.OneMinusSrcAlphaFactor,
        `${body.blending} ${body.blendSrc} ${body.blendDst}`);
  check("...and alpha-tested at ALPHAREF 1 of 255",
        ALPHA_REF === 1 && Math.abs(body.alphaTest - 1 / 255) < 1e-9,
        `${body.alphaTest}`);

  // src 4, dst 1: an effect. `GLTFLoader` had drawn these as ordinary blends.
  const glow = exported(0x83000000, 0x84000463);
  applyPvr2DrawState(glow, { isp: 0x83000000, tsp: 0x84000463 });
  check("an additive mesh (src_alpha / one) adds: the stage-6 blades glow",
        glow.blendSrc === three.SrcAlphaFactor
        && glow.blendDst === three.OneFactor, `${glow.blendDst}`);
  // src 3, dst 0: `boss6`'s 54 meshes. g_SrcBlendTable[3] is INVDESTCOLOR.
  const inv = exported(0x83000000, 0x60000463);
  applyPvr2DrawState(inv, { isp: 0x83000000, tsp: 0x60000463 });
  check("src 3 is INVDESTCOLOR, not INVSRCCOLOR: the tables differ there",
        inv.blendSrc === three.OneMinusDstColorFactor
        && inv.blendDst === three.ZeroFactor,
        `${inv.blendSrc} ${inv.blendDst}`);

  const wall = exported(0x83000000, 0x2008045B, false);
  applyPvr2DrawState(wall, { isp: 0x83000000, tsp: 0x2008045B });
  check("an opaque mesh is in the first pass, unblended and untested",
        wall.transparent === false && wall.alphaTest === 0
        && wall.depthWrite === true, `${wall.transparent} ${wall.alphaTest}`);
  // `pol_zndina`'s ten: list type 2, blend one/one, but the TSP pass bits say
  // opaque -- and the pass bits are what `WalkMeshChainAndDraw` reads.
  const listed = exported(0x83000000, 0x24080000, true);
  applyPvr2DrawState(listed, { isp: 0x83000000, tsp: 0x24080000 });
  check("the pass is the TSP's (tsp & 0x180000) == 0x80000, not the list type",
        listed.transparent === false, `${listed.transparent}`);
  const nowrite = exported(0x87000000, 0x94000463);
  applyPvr2DrawState(nowrite, { isp: 0x87000000, tsp: 0x94000463 });
  check("ISP bit 26 set would turn the depth write off (no shipped mesh does)",
        nowrite.depthWrite === false);
  const always = exported(0xE3000000, 0x94000463);
  applyPvr2DrawState(always, { isp: 0xE3000000, tsp: 0x94000463 });
  check("compare mode 7 is D3DCMP_ALWAYS", always.depthFunc === three.AlwaysDepth,
        `${always.depthFunc}`);

  // A Lambert twin is built by constructor, not by clone.
  const twin = new three.MeshLambertMaterial();
  copyDrawState(glow, twin);
  check("a lighting twin carries the factors and depth function",
        twin.blendDst === three.OneFactor && twin.depthFunc === glow.depthFunc
        && twin.alphaTest === glow.alphaTest);

  // `DrawModelWithForcedAlphaBlend` (`FUN_004A8440`): TSP forced to
  // SRCALPHA/INVSRCALPHA, the mesh's own base alpha times the command's.
  const faded = glow.clone();
  applyForcedAlphaBlend(faded, 0.5, 0.8);
  check("a fading draw blends SRCALPHA/INVSRCALPHA, additive or not",
        faded.transparent && faded.blendDst === three.OneMinusSrcAlphaFactor);
  check("...at its base alpha times the draw's, not the draw's alone",
        Math.abs(faded.opacity - 0.4) < 1e-9, `${faded.opacity}`);
  check("...and still writes depth: the ISP word is not rewritten",
        faded.depthWrite === true);
  const slotNode = new Mesh(new PlaneGeometry(1, 1), exported(
    0x83000000, 0x94000463));
  (slotNode.material as InstanceType<typeof MeshBasicMaterial>).opacity = 0.6;
  setSlotAlpha(slotNode, 0.5);
  check("setSlotAlpha fades from the mesh's base alpha",
        Math.abs((slotNode.material as InstanceType<typeof MeshBasicMaterial>)
          .opacity - 0.3) < 1e-9);
  setSlotAlpha(slotNode, 0.25);
  check("...every frame, not from the last frame's",
        Math.abs((slotNode.material as InstanceType<typeof MeshBasicMaterial>)
          .opacity - 0.15) < 1e-9);

  // `AssetDrawSlotWithAlpha` (`FUN_004185A0`) does not test its argument: at
  // 1.0 it is still `DrawModelWithForcedAlphaBlend`, which blends an
  // opaque-pass mesh -- and so its texture's alpha, now that the exporter
  // keeps it. The layers used to keep the plain draw at 1.
  const wallMat = exported(0x83000000, 0x2008045B, false);
  applyPvr2DrawState(wallMat, { isp: 0x83000000, tsp: 0x2008045B });
  const wallNode = new Mesh(new PlaneGeometry(1, 1), wallMat);
  setSlotAlpha(wallNode, 1);
  const forcedWall = wallNode.material as InstanceType<typeof MeshBasicMaterial>;
  check("a draw with alpha at 1 still blends an opaque-pass mesh",
        forcedWall !== wallMat && forcedWall.transparent
        && forcedWall.blendSrc === three.SrcAlphaFactor
        && forcedWall.blendDst === three.OneMinusSrcAlphaFactor
        && forcedWall.opacity === 1,
        `${forcedWall === wallMat} ${forcedWall.transparent}`);
  check("...and leaves the template's material alone",
        wallMat.transparent === false);
  check("...untested: the opaque pass's alpha test stays off (bits 19-20 kept)",
        forcedWall.alphaTest === 0, `${forcedWall.alphaTest}`);
  setSlotAlpha(wallNode, null);
  check("a plain draw (`AssetDrawSlot`) after it goes back to the template's",
        wallNode.material === wallMat && wallMat.transparent === false);
  const untouched = new Mesh(new PlaneGeometry(1, 1), wallMat);
  setSlotAlpha(untouched, null);
  check("...and a plain draw never clones", untouched.material === wallMat);

  // The blood transpose swaps red and green and nothing else: an opaque-pass
  // gore texel at alpha 0 keeps the colour the pass shows.
  const { transposeRedGreen } = await import("../src/render/bloodcolour");
  const texel = new Uint8Array([10, 200, 30, 0, 1, 2, 3, 255]);
  transposeRedGreen(texel);
  check("the blood transpose keeps the alpha, and the colour under alpha 0",
        texel.join() === "200,10,30,0,2,1,3,255", texel.join());

  // ---- the order ---------------------------------------------------------
  // Commands as the loader delivers them: a node Group of primitive Meshes,
  // each primitive's glTF extras on its geometry.
  const assoc = new Map<object, { nodes?: number }>();
  let nodeIndex = 0;
  const prim = (chain: number, pass: "opaque" | "translucent",
                sphere: number[], model = 0) => {
    const g = new PlaneGeometry(0.1, 0.1);
    g.userData = { hod2_pass: pass, hod2_chain_index: chain,
                   hod2_model: model, hod2_sphere: sphere };
    const m = new Mesh(g, pass === "opaque"
      ? exported(0x83000000, 0x2008045B, false)
      : exported(0x83000000, 0x94000463));
    assoc.set(m, {});
    return m;
  };
  const command = (z: number, prims: InstanceType<typeof Mesh>[]) => {
    const n = new Group();
    n.position.set(0, 0, z);
    for (const p of prims) n.add(p);
    assoc.set(n, { nodes: nodeIndex++ });
    return n;
  };
  const root = new Group();
  // Near: origin at -10, one translucent mesh on it.
  const near = command(-10, [prim(0, "translucent", [0, 0, 0, 1])]);
  // Far: origin at -50.
  const far = command(-50, [prim(0, "translucent", [0, 0, 0, 1])]);
  // Deep: origin at -5 -- nearer than `near` -- but a translucent mesh 95
  // units behind it, which is the command's farthest point.
  const deep = command(-5, [prim(0, "translucent", [0, 0, -95, 1])]);
  // Walk: two translucent meshes whose chain order is the reverse of their
  // depth order.
  const walkFar = prim(0, "translucent", [0, 0, -30, 1]);
  const walkNear = prim(1, "translucent", [0, 0, 5, 1]);
  const walk = command(-20, [walkFar, walkNear]);
  // Culled: an opaque mesh wholly outside the frustum at z -400 lowers the
  // depth; a visible opaque one at the same z does not.
  const culled = command(-30, [prim(0, "translucent", [0, 0, 0, 1]),
                               prim(1, "opaque", [5000, 0, -370, 1])]);
  const seen = command(-30, [prim(0, "translucent", [0, 0, 0, 1]),
                             prim(1, "opaque", [0, 0, -370, 1])]);
  root.add(near, far, deep, walk, culled, seen);
  prepareDrawCommands(root, assoc);
  check("a primitive of a multi-primitive node is marked, the node is not",
        near.children[0]!.userData.hod2Primitive === true
        && near.userData.hod2Primitive === undefined);
  root.updateMatrixWorld(true);

  const cam = new PerspectiveCamera(41.1, 4 / 3, 0.8, 8000);
  cam.updateMatrixWorld(true);
  const order = new RenderCommandOrder(cam);
  // `RenderCommandCompare` itself; the PowerVR order is checked below.
  order.powerVr = false;
  order.beginFrame();
  let id = 0;
  const item = (o: InstanceType<typeof Obj3D>, renderOrder = 0,
                groupOrder = 0) => ({
    id: id++, object: o, groupOrder, renderOrder, z: 0,
    geometry: null, material: null, program: null, group: null,
  }) as unknown as Parameters<typeof order.compare>[0];
  const sorted = (items: ReturnType<typeof item>[]) =>
    items.slice().sort(order.compare).map((i) => i.object);

  const a = item(near.children[0]!), b = item(far.children[0]!);
  check("commands go nearest first: the comparator sorts eye z descending",
        sorted([b, a])[0] === near.children[0]);
  check("a command's depth is its farthest skipped mesh, not its origin",
        Math.abs(order.key(deep.children[0]!).depth - -100) < 1e-6
        && sorted([item(deep.children[0]!), a])[0] === near.children[0],
        `${order.key(deep.children[0]!).depth}`);
  check("a command's own meshes go in chain order, whatever their depths",
        sorted([item(walkNear), item(walkFar)])[0] === walkFar);
  check("an opaque mesh outside the frustum lowers the depth (pass 0 skips it)",
        Math.abs(order.key(culled.children[0]!).depth - -400) < 1e-6,
        `${order.key(culled.children[0]!).depth}`);
  check("...and one inside it does not",
        Math.abs(order.key(seen.children[0]!).depth - -30) < 1e-6,
        `${order.key(seen.children[0]!).depth}`);
  check("the layer comes before the depth", sorted([
    item(near.children[0]!, 0), item(far.children[0]!, DRAW_LAYER_7_ORDER),
  ])[0] === far.children[0]);
  const label = new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial());
  label.position.set(0, 0, -1);
  check("the player's own meshes follow the commands of their layer",
        sorted([item(label), item(far.children[0]!)])[0] === far.children[0]);

  // A rig part that draws two slots is two commands on one node.
  const twoA = prim(0, "translucent", [0, 0, -100, 1], 0);
  const twoB = prim(1, "translucent", [0, 0, 0, 1], 1);
  const two = command(-10, [twoA, twoB]);
  root.add(two);
  prepareDrawCommands(two, assoc);
  root.updateMatrixWorld(true);
  order.beginFrame();
  check("hod2_model splits one node into two commands, each keyed apart",
        order.key(twoA).cmd !== order.key(twoB).cmd
        && Math.abs(order.key(twoA).depth - -110) < 1e-6
        && Math.abs(order.key(twoB).depth - -10) < 1e-6
        && sorted([item(twoA), item(twoB)])[0] === twoB);

  // The PowerVR order: the same keys, farthest first; inside a command,
  // still the chain.
  order.powerVr = true;
  check("PowerVR order: commands go farthest first",
        sorted([a, b])[0] === far.children[0]);
  check("PowerVR order: keyed by the farthest skipped mesh too",
        sorted([a, item(deep.children[0]!)])[0] === deep.children[0]);
  check("PowerVR order: a command's own meshes still go in chain order",
        sorted([item(walkNear), item(walkFar)])[0] === walkFar);
  check("PowerVR order: the layer still comes before the depth", sorted([
    item(far.children[0]!, 0), item(near.children[0]!, DRAW_LAYER_7_ORDER),
  ])[0] === near.children[0]);
  check("PowerVR order is the default", new RenderCommandOrder(cam).powerVr);
  order.powerVr = false;

  // Region draw mode 2: `RegionDrawResidentSet` between SetDrawLayerNibble(7)
  // and (8). On the primitives, so the backdrop's -1000 still goes first.
  const layered = command(-10, [prim(0, "translucent", [0, 0, 0, 1])]);
  layered.userData.hod2_draw_mode = 2;
  prepareDrawCommands(layered, assoc);
  check("a draw-mode-2 region model is layer 7, on its primitives",
        layered.children[0]!.renderOrder === DRAW_LAYER_7_ORDER
        && layered.renderOrder === 0);
}

console.log("\nthe stage-1 banners' wave, on the templates");

{
  // `PropUpdateType45` bends four models in place; the port keeps the clock
  // each was bent at, and `render/banner_wave.ts` rewrites the template's
  // vertices from their authored positions at it. An opaque-pass mesh shows
  // the bend its draws were submitted against, a translucent one this frame's.
  const { bannerWaveZ, BannerWave } = await import("../src/render/banner_wave");
  const { BufferGeometry, Float32BufferAttribute } = await import("three");
  const BAMS = Math.PI * 2 / 65536;

  check("the wave leaves a vertex with ftol(y) == 0 alone",
        bannerWaveZ(0, 0.9, 0) === null && bannerWaveZ(2, -0.9, 0x4000) === null);
  const bams = (((5 - -10) << 9) + 0x100) & 0xffff;
  check("...and bends the rest: y * -0.1 * sin(((5k - ftol y) << 9) + clock)",
        bannerWaveZ(1, -10, 0x100) === Math.fround(
          Math.sin(bams * BAMS) * (-10 * Math.fround(-0.1))));

  // One template, two meshes offset 2 up inside it: its y is the model's
  // y - 2, which is what the wave must read.
  const part = (tsp: string) => {
    const geo = new BufferGeometry();
    geo.setAttribute("position", new Float32BufferAttribute(
      [1, -12, 7, 4, -1.5, 9], 3));
    const mat = new MeshBasicMaterial();
    mat.userData.pvr2 = { isp_tsp_instruction: "0", tsp_instruction: tsp };
    const m = new Mesh(geo, mat);
    m.position.set(0, 2, 0);
    return m;
  };
  const opaque = part("80000");
  const translucent = part("100000");
  const t = new Group();
  t.add(opaque, translucent);
  const templates = { get: (slot: number) => (slot === 0x1731 ? t : undefined) };
  const z = (m: InstanceType<typeof Mesh>, i: number) =>
    (m.geometry.attributes.position as { getZ(i: number): number }).getZ(i);
  const wave = new BannerWave();

  ResetGameGlobals();
  wave.apply(templates);
  check("an unbent model is as authored",
        z(opaque, 0) === 7 && z(translucent, 0) === 7 && z(opaque, 1) === 9);

  G.g_prop45_wave_clock = [0x100, 0x300, 0x500, 0x700];
  G.g_prop45_wave_clock_drawn = [-1, -1, -1, -1];
  wave.apply(templates);
  const at = (clock: number) => bannerWaveZ(0, -10, clock)!;
  check("the first frame: the translucent mesh bent, the opaque one as its "
        + "draws went out",
        Math.abs(z(translucent, 0) - at(0x100)) < 1e-6 && z(opaque, 0) === 7,
        `${z(translucent, 0)} ${at(0x100)} ${z(opaque, 0)}`);
  check("...a vertex at model y -0.5 stays where it was authored",
        z(translucent, 1) === 9);

  G.g_prop45_wave_clock_drawn = [0x100, 0x300, 0x500, 0x700];
  G.g_prop45_wave_clock = [0x900, 0xb00, 0xd00, 0xf00];
  wave.apply(templates);
  check("the next: the opaque mesh one frame behind, from the authored z",
        Math.abs(z(opaque, 0) - at(0x100)) < 1e-6
        && Math.abs(z(translucent, 0) - at(0x900)) < 1e-6,
        `${z(opaque, 0)} ${z(translucent, 0)}`);

  ResetGameGlobals();
  wave.apply(templates);
  check("a reset stage's models are the authored ones again",
        z(opaque, 0) === 7 && z(translucent, 0) === 7);
}

// -- a skinned part's joints under a hidden node ----------------------------
//
// `updateVisibleMatrixWorld` does not descend into a hidden branch, and every
// reader in `render/` asks for the matrix it reads. three.js's skinning does
// not: `Skeleton.update` reads each bone's `matrixWorld` as it stands. A
// character's vertex-blended part is skinned to `jointNN` nodes that hang under
// the bones, and `swapGore`'s multi-primitive arm hides every non-bone child of
// a bone -- the joints included. From the frame a zombie's torso took a gore
// swap, its waist was drawn against the joint where it was when the swap hid
// it, while the rest of the body moved on: the vertices bound to that joint
// stretched back to it.
console.log("\na skinned part's joints stay current under a hidden node:");
{
  const { Bone, BufferGeometry, Float32BufferAttribute, Group, MeshBasicMaterial,
          Skeleton, SkinnedMesh, Uint16BufferAttribute, Vector3: V3 } =
    await import("three");
  const { updateVisibleMatrixWorld } = await import("../src/render/visible_world");
  const scene = new Group();
  const bone = new Group();                 // the drawn bone, visible
  const shell = new Group();                // a primitive swapGore hid...
  shell.visible = false;
  const joint = new Bone();                 // ...and the skin joint under it
  shell.add(joint);
  bone.add(shell);
  scene.add(bone);
  const geo = new BufferGeometry();
  geo.setAttribute("position", new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
  geo.setAttribute("skinIndex", new Uint16BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 4));
  geo.setAttribute("skinWeight", new Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4));
  const part = new SkinnedMesh(geo, new MeshBasicMaterial());
  part.bind(new Skeleton([joint]));
  scene.add(part);
  scene.matrixWorldAutoUpdate = false;
  updateVisibleMatrixWorld(scene);
  bone.position.set(10, 0, 0);
  updateVisibleMatrixWorld(scene);
  const at = new V3().setFromMatrixPosition(joint.matrixWorld);
  check("a joint under a hidden node follows its bone when a visible part is "
        + "skinned to it", at.x === 10, at.toArray().join());
  const v = new V3();
  part.getVertexPosition(1, v);
  check("...so the part's vertex is drawn where the bone is, not where it was",
        v.x === 11, v.toArray().join());
  // A hidden part asks nothing of its joints: the walk does not reach it.
  part.visible = false;
  bone.position.set(20, 0, 0);
  updateVisibleMatrixWorld(scene);
  check("...and a hidden part costs its joints nothing",
        new V3().setFromMatrixPosition(joint.matrixWorld).x === 10);
}

// The boss-name banner's flight, drawn. Reported as "the camera no longer
// yaws when showing the boss banner" at stage 1 block 14's `wait_frames 300`.
// `BossIntroBannerUpdate` (`FUN_00437AC0`) writes camera block 0's eye and
// look-at off its path and no angle, and the view is built from angles -- but
// stage 1's banner runs under scene state (1, 3), whose installer
// `CameraInstallViewAngles` (`FUN_004039D0`) makes `g_camera_index` 2, and
// `EvtRunQueuedActionsSyncViewBlock` aims block 2 at block 0's look-at every
// frame. So the camera drawn turns with the flight while block 0's heading
// stays put. Driven through the engine's own frame order -- the camera
// actor's task, then the banner's -- and read off the three.js camera the
// rig places.
{
  console.log("\nthe boss-name banner's flight, drawn:");
  const { CameraRig } = await import("../src/render/camera");
  const { CameraActorTick } = await import("../src/game/camera/actor");
  const { CheckpointResetCamera } = await import("../src/game/camera/actions");
  const { CamBlockSetAnglesFromLookAt, CameraPoseBlock }
    = await import("../src/game/camera/path");
  const { BossBannersTick, BossIntroBannerSpawn }
    = await import("../src/game/boss_banner");
  const { NULL_HOST } = await import("../src/game/host");
  const { PerspectiveCamera } = await import("three");
  type HostT = import("../src/game/host").GameHost;
  type CamPathT = import("../src/game/camera/curve").CamPath;
  type V = { x: number; y: number; z: number };
  ResetGameGlobals();
  // Judgment's record (`0x00570EC8`) flies path 48. This one circles the
  // origin at radius 20, a quarter turn over the slide, looking at it.
  const R = 20;
  const orbit = {
    pose: (t: number, _roll: boolean,
           out: { eye: V; target: V; roll: number }) => {
      const a = (t * Math.PI / 2) / 0x50;
      out.eye.x = R * Math.sin(a); out.eye.y = 0; out.eye.z = R * Math.cos(a);
      out.target.x = 0; out.target.y = 0; out.target.z = 0;
      out.roll = 0;
      return out;
    },
  };
  const host: HostT = {
    ...NULL_HOST,
    camPath: (slot) => (slot === 48 ? orbit as unknown as CamPathT : null),
  };
  CheckpointResetCamera();               // every block opens in (1, 3)
  G.g_camera_block_eye = { x: 0, y: 0, z: R };
  G.g_camera_block_target = { x: 0, y: 0, z: 0 };
  CamBlockSetAnglesFromLookAt(CameraPoseBlock.Camera, G.g_camera_block_target,
                              0);
  CameraActorTick();
  const yaw0 = G.g_camera_block_yaw_bams;
  G.g_script_flags[2] = 1;
  const banner = BossIntroBannerSpawn(0x00570ec8);
  for (let f = 0; f < 60; f++) {
    CameraActorTick();
    BossBannersTick(host);
  }
  CameraActorTick();                     // the next frame's view: last pose
  const cam = new PerspectiveCamera();
  new CameraRig().draw({ walker: {}, camera: cam } as unknown as RenderContextT);
  const e = G.g_camera_block_eye;
  const fwd = cam.getWorldDirection(new Vector3());
  const want = new Vector3(-e.x, -e.y, -e.z).normalize();
  const deg = (fwd.angleTo(want) * 180) / Math.PI;
  check("the banner is flying, a long way round from where it started",
        banner.frame > 50 && Math.abs(e.x) > 15, `${banner.frame} ${e.x}`);
  check("under (1, 3) the drawn camera turns with the flight onto its "
        + "look-at, and sits at its eye",
        deg < 0.05 && cam.position.distanceTo(new Vector3(e.x, e.y, e.z)) < 1e-3,
        `${deg.toFixed(3)} deg off; drawn at ${cam.position.toArray()
          .map((v) => v.toFixed(2)).join()}`);
  check("...while camera block 0 keeps the heading it had",
        Math.abs(G.g_camera_block_yaw_bams - yaw0) <= 1,
        `${yaw0} -> ${G.g_camera_block_yaw_bams}`);
}

// A shader program, once compiled, stays: a material disposed after an
// effect must not take the program with it, or the next effect compiles it
// again mid-play (`render/program_pins.ts`).
console.log("\nShader programs are kept:\n");
{
  const { ProgramPins } = await import("../src/render/program_pins");
  const programs: { usedTimes: number }[] = [{ usedTimes: 1 }, { usedTimes: 2 }];
  const renderer = { info: { programs } } as never;
  const pins = new ProgramPins();
  pins.pin(renderer);
  pins.pin(renderer);
  check("each program gets one more user, once however often it is asked",
        programs[0].usedTimes === 2 && programs[1].usedTimes === 3,
        JSON.stringify(programs));
  programs.push({ usedTimes: 1 });
  pins.pin(renderer);
  check("...and a program compiled later gets its one too",
        programs[2].usedTimes === 2 && programs[0].usedTimes === 2, JSON.stringify(programs));
  // What three.js does when the last material using a program is disposed.
  const release = (p: { usedTimes: number }) => --p.usedTimes === 0;
  check("...so the material that compiled it can go without the program going",
        !release(programs[2]), JSON.stringify(programs[2]));
}

console.log("\nthe stage's loaded models: loaded is not drawn (L54)");

{
  // Stage 5 block 0 streams in `st5.bin[8]` and `[9]` with opcode 0x50, and
  // block 1 `st5.bin[1]`: three models no region lists, slots 0x1899, 0x189A
  // and 0x1892. `StageScene` used to draw every such slot where the model's
  // own coordinates put it -- the world's origin -- because the script had
  // loaded it, and the doors those slots are stood across stage 5's opening
  // tunnel. The exe draws each one only through the routine that names it,
  // in that routine's layer; the stage draws none of them.
  const { StageScene } = await import("../src/render/stagescene");
  const model = (slot: number, regions: number[] = []) => {
    const m = new Group();
    m.userData = { hod2_regions: regions, hod2_slot: slot, hod2_draw_mode: 0 };
    m.add(new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial()));
    return m;
  };
  const tree = new Group();
  const gate = model(0x1899), shutter = model(0x189a), far = model(0x1892);
  // A tile the canal water task draws, and a region's own model.
  const tile = model(0x13a0);
  const wall = model(0x0100, [2]);
  tree.add(gate, shutter, far, tile, wall);
  const scene = StageScene.fromScene(tree, { regions: [0, 1, 2] } as never);
  for (const s of [0x1899, 0x189a, 0x1892, 0x13a0]) scene.loadSlot(s);
  scene.enterRegion(2);
  check("loaded and in no region, none of them is drawn by the stage",
        !gate.visible && !shutter.visible && !far.visible,
        `${gate.visible} ${shutter.visible} ${far.visible}`);
  check("...while the region's own model is", wall.visible);
  scene.setWaterSlots(new Set([0x13a0]), new Set([0x13a0]));
  check("...and a water tile the task drew this frame is, while resident",
        tile.visible);
  scene.unloadSlot(0x13a0);
  check("...and not once it is unloaded", !tile.visible);
  scene.setVisibility("all");
  check("free roam's all-regions view still shows every model",
        gate.visible && shutter.visible && far.visible && wall.visible);

  // `AssetDrawSlot` draws nothing that is not resident, and the stage is
  // what knows which of the streamed slots are: stage 4's `0x954` is
  // unloaded at block 23 op 75 while the class-0x13 prop that draws it lives
  // until op 105.
  scene.setVisibility("region");
  check("a streamed slot is resident while loaded",
        scene.slotResident(0x1899));
  scene.unloadSlot(0x1899);
  check("...and not once it is unloaded", !scene.slotResident(0x1899));
  check("a region's model, and a slot the stage holds no model for, are "
        + "taken as resident",
        scene.slotResident(0x0100) && scene.slotResident(0x7777));
}

console.log("\nRegionDrawResidentSet: the canal it draws, and the chapter card's gate");

{
  // `RegionDrawResidentSet` (`0x00401260`): for entry slot 0x1828
  // (`st3_08[2]`) while the region is 2 or 3 it draws 0x13B2 and 0x13B0 --
  // `st1_1[14]` and `[12]`, the canal under the boat in stage 3's two cut
  // scenes, which no region lists and no water task draws there. And it
  // draws nothing while `g_screen_furniture_flags & 0x20` is up. The port
  // had neither: stage 3's canal shot showed the boat over an empty frame.
  const { StageScene, RegionDrawGate, RegionEntryAlsoDraws }
    = await import("../src/render/stagescene");
  const model = (slot: number, regions: number[] = []) => {
    const m = new Group();
    m.userData = { hod2_regions: regions, hod2_slot: slot, hod2_draw_mode: 0 };
    m.add(new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial()));
    return m;
  };
  const tree = new Group();
  const quay = model(0x1828, [2, 3, 5]);
  const tile14 = model(0x13b2), tile12 = model(0x13b0);
  const other = model(0x0200, [4]);
  tree.add(quay, tile14, tile12, other);
  const scene = StageScene.fromScene(tree, { regions: [0, 1, 2, 3, 4, 5] } as never);
  scene.loadSlot(0x13b2);
  scene.loadSlot(0x13b0);
  scene.enterRegion(2);
  check("region 2's 0x1828 entry draws both canal tiles beside itself",
        quay.visible && tile14.visible && tile12.visible,
        `${quay.visible} ${tile14.visible} ${tile12.visible}`);
  scene.enterRegion(4);
  check("...a region without the entry draws neither",
        !tile14.visible && !tile12.visible && other.visible);
  scene.enterRegion(5);
  check("...nor does the entry in a region other than 2 or 3",
        quay.visible && !tile14.visible && !tile12.visible);
  scene.enterRegion(3);
  scene.unloadSlot(0x13b0);
  check("region 3 draws them too, and AssetDrawSlot skips the one unloaded "
        + "(block 0 step 2 op 42 frees 0x13B0)",
        tile14.visible && !tile12.visible);
  check("the arm names exactly those two slots, in the exe's order",
        RegionEntryAlsoDraws(0x1828, 2).join() === "5042,5040"
        && RegionEntryAlsoDraws(0x1828, 4).length === 0
        && RegionEntryAlsoDraws(0x1829, 2).length === 0);

  // The gate, driven from `G` as the frame drives it.
  ResetGameGlobals();
  const gate = new RegionDrawGate();
  gate.scene = scene;
  G.g_screen_furniture_flags |= 0x20;
  gate.update();
  scene.setWaterSlots(new Set([0x13b2]), new Set([0x13b2]));
  check("with the chapter card's bit up no region model is drawn, and "
        + "nothing beside one",
        !quay.visible && !other.visible && !tile12.visible);
  check("...but a tile the water task draws is that task's, and still shows",
        tile14.visible);
  G.g_screen_furniture_flags &= ~0x20;
  gate.update();
  check("...and the region comes back the frame the bit goes down",
        quay.visible);
}

console.log("\na layer's clone of a lit mesh is lit: the canal tiles under the water task");

{
  // `render/water_surfaces.ts` clones a tile's material for the bilinear
  // filter `WaterSurfaceUpdate` turns on. It cloned whatever the mesh wore,
  // and by its first frame the lighting swap had already put the tile in its
  // device-lit twin: `Material.clone` keeps neither the twin's
  // `onBeforeCompile` nor its program key, so the copy was a stock
  // `MeshLambertMaterial` under a scene with no three.js lights -- black --
  // and the swap left it, being no unlit material. Every stage-3 canal shot
  // with a water task drew the canal black.
  const { StageScene } = await import("../src/render/stagescene");
  const { WaterSurfaceLayer } = await import("../src/render/water_surfaces");
  const { unlitMaterial } = await import("../src/render/lighting");
  const { DataTexture, LinearFilter } = await import("three");
  ResetGameGlobals();
  const base = new MeshBasicMaterial({ map: new DataTexture(new Uint8Array(4), 1, 1) });
  base.userData = { pvr2: { tex_ambient: 0.75, specular: [0, 0, 0], specular_power: 0 } };
  const tileMesh = new Mesh(new PlaneGeometry(10, 10), base);
  const tile = new Group();
  tile.userData = { hod2_regions: [], hod2_slot: 0x13b2, hod2_draw_mode: 0 };
  tile.add(tileMesh);
  const tree = new Group();
  tree.add(tile);
  const stage = StageScene.fromScene(tree, { regions: [0, 1, 2, 3, 4] } as never);
  stage.loadSlot(0x13b2);
  stage.enterRegion(4);
  const lights = new SceneLighting(new Scene());
  lights.build(stage.root);
  const water = new WaterSurfaceLayer();
  water.scene = stage;
  G.g_water_surfaces = [{ id: 1, index: 7, lifetime: 10, seenStep: 0,
                          stepChanges: 0, killFlag: 0x12, slot: 0x13b2,
                          drawn: [0x13b2] }];
  G.g_water_surface_uv = [{ slot: 0x13b2, sin: 0.5, cos: 0.25, frames: 3,
                            zLimited: false }];
  // The frame before the task's first: the swap has the tile in its lit twin.
  lights.beforeRender();
  const key = (m: unknown) => (m as { customProgramCacheKey(): string })
    .customProgramCacheKey();
  check("the tile wears its device-lit twin before the walk's first frame",
        key(tileMesh.material) === "d3dlit");
  // Two frames of the task: its bilinear clone, then the swap.
  for (let i = 0; i < 2; i++) {
    water.update();
    lights.beforeRender();
  }
  const worn = tileMesh.material as InstanceType<typeof MeshBasicMaterial>;
  check("after the water layer's clone the tile is still drawn by the device's "
        + "light equation, not a stock Lambert",
        key(worn) === "d3dlit", `${worn.type} ${key(worn)}`);
  check("...and its texture is the bilinear copy the walk asked for",
        worn.map !== base.map && worn.map?.minFilter === LinearFilter);
  check("...whose unlit base is the clone, not the stage's own material",
        unlitMaterial(worn) !== base && unlitMaterial(worn).type === "MeshBasicMaterial");
}

console.log("\nthe chapter card's model: half a turn about, in the eye's space:");

{
  // `MatrixLoadIdentity; MatrixTranslate(0, 0, -30); MatrixRotateY(0x8000);
  // MatrixScale(2, 2, 2); AssetDrawSlot(0x1730)` -- the turn between the
  // translate and the scale is the node's own rotation, and a half turn about
  // y sends the model's +z to -z and its +x to -x.
  const { drawViewSlots } = await import("../src/render/view_slots");
  const { DrawSlotInView } = await import("../src/game/view_slot");
  const view = new Group();
  const node = new Obj3D();
  ResetGameGlobals();
  G.g_view_slot_draws = [];
  DrawSlotInView(0x1730, 0, 0, -30, 2, 0x8000);
  const seen = new Set<string>();
  drawViewSlots({ node: () => { view.add(node); return node; }, view,
                  world: new Group() }, seen);
  node.updateMatrixWorld(true);
  const p = new Vector3(1, 0, 1).applyMatrix4(node.matrixWorld);
  check("the model's (1, 0, 1) lands at (-2, 0, -32): turned, scaled, then "
        + "moved 30 ahead",
        Math.abs(p.x + 2) < 1e-6 && Math.abs(p.y) < 1e-6
        && Math.abs(p.z + 32) < 1e-6 && seen.size === 1,
        `${p.x.toFixed(3)} ${p.y.toFixed(3)} ${p.z.toFixed(3)}`);
}

console.log("\nrigs: a part drawn behind a camera-path test");
{
  // `FUN_0048F560`, stage 6's lift car: `AssetDrawSlot(0xAFE/0xAFF)` only
  // when `g_active_cam_path == 0xDA` (`0x0048F691`), `0xAFC/0xAFD` only on
  // 0xDB or 0xEC (`0x0048F6CC`, `0x0048F6D1`), and the body always. The
  // condition used to be prose on the rig part, and the renderer drew both
  // pairs of doors shut on every path -- across the doorway the class-0x44
  // leaves slide open in.
  ResetGameGlobals();
  const RIGS = {
    rigs: [{ name: "obj_48f560", routine: "FUN_0048F560", note: "",
             routes: [] }],
    blocked: [], note: "",
  };
  const part = (slot: number, paths: number[] | null) => {
    const g = new Group();
    g.userData = { hod2_kind: "rig_part", hod2_rig: "obj_48f560",
                   hod2_slots: [`0x${slot.toString(16).padStart(4, "0")}`],
                   ...(paths ? { hod2_drawn_on_cam_paths: paths } : {}) };
    return g;
  };
  const body = part(0x1913, null);
  const back = part(0xafe, [0xda]);
  const front = part(0xafc, [0xdb, 0xec]);
  const car = new Group();
  car.userData = { hod2_kind: "rig", hod2_rig: "obj_48f560",
                   hod2_routine: "FUN_0048F560" };
  car.add(body, back, front);
  const root = new Group();
  root.add(car);
  const rigs = new RigLayer();
  rigs.build(root, RIGS as never,
             new CamPaths({ fps: 60, paths: {}, object_paths: {} } as never));
  const on = (slot: number) => rigs.update(
    { walker: { cam: { slot, frame: 30 } } } as unknown as
      Parameters<typeof rigs.update>[0]);
  on(0xda);
  check("on 0xDA only the far pair is drawn", car.visible && body.visible
        && back.visible && !front.visible);
  on(0xdb);
  check("on 0xDB only the near pair", back.visible === false && front.visible);
  on(0xdc);
  check("on 0xDC neither -- the class-0x44 leaves are the doors -- and the "
        + "body still", !back.visible && !front.visible && body.visible);
  on(0xec);
  check("on 0xEC the near pair again", !back.visible && front.visible);
}

// Class 0x42's draws, composed by three.js, against the same calls made on
// the engine's own stack (`game/matrix.ts`, which post-multiplies as
// `MatrixTranslate`/`MatrixRotate*` do) -- at turns where no axis lines up
// (L84, L48).
console.log("\nthe worm's draws, against the engine's matrix stack:");
{
  const { WormDrawParts } = await import("../src/render/worm");
  const { WormBodyDraw, WormState } = await import("../src/game/class42/state");
  const { SpawnClass } = await import("../src/game/spawn_class");
  const M = await import("../src/game/matrix");
  const { Vector3 } = await import("three");
  const at = (m: import("three").Matrix4, x: number, y: number, z: number) =>
    new Vector3(x, y, z).applyMatrix4(m);
  const engine = (build: (m: number[]) => void, x: number, y: number,
                  z: number) => {
    const m = M.MatIdentity();
    build(m);
    const o = { x: 0, y: 0, z: 0 };
    M.MatrixTransformPoint(m, { x, y, z }, o);
    return o;
  };
  const near = (a: { x: number; y: number; z: number },
                b: { x: number; y: number; z: number }) =>
    Math.abs(a.x - b.x) < 1e-3 && Math.abs(a.y - b.y) < 1e-3
    && Math.abs(a.z - b.z) < 1e-3;

  const a = makeActor(0x3000f001, SpawnClass.Worm, -1, "worm");
  if (a.cls !== SpawnClass.Worm) throw new Error("not a worm");
  a.pos = { x: -480, y: 4.6, z: -1330 };
  a.yaw = 0x2345;
  a.pitch = 0x1234;
  a.worm.drawnBody = WormBodyDraw.Member;
  a.worm.state = WormState.Wait;
  a.worm.scale = { x: 1.3, y: 0.8, z: 1.1 };
  a.worm.ground = 3.8;
  const parts = WormDrawParts(a, []);
  const p = { x: 0.5, y: 1.0, z: -2.0 };
  const body = engine((m) => {
    M.MatrixTranslate(m, a.pos.x, a.pos.y + 1, a.pos.z);
    M.MatrixRotateY(m, a.yaw); M.MatrixRotateX(m, a.pitch);
    M.MatrixScale(m, 1.3 * 0.6, 0.8 * 0.6, 1.1 * 0.6);
  }, p.x, p.y, p.z);
  const shadow = engine((m) => {
    M.MatrixTranslate(m, a.pos.x, 3.8 + 2, a.pos.z);
    M.MatrixScale(m, 1, 0.1, 1);
    M.MatrixRotateY(m, a.yaw); M.MatrixRotateX(m, a.pitch);
    M.MatrixScale(m, 1.3 * 0.6, 0.8 * 0.6, 1.1 * 0.6);
  }, p.x, p.y, p.z);
  check("a member's body is T(x, y+1, z) Ry Rx S(0.6 scale), slot 0x85A",
        parts.length === 2 && parts[0]!.slot === 0x85a
        && near(at(parts[0]!.m, p.x, p.y, p.z), body),
        `${JSON.stringify(at(parts[0]!.m, p.x, p.y, p.z))} vs ${JSON.stringify(body)}`);
  check("...and its shadow the same flattened on the ground, 0x85B at 0.5",
        parts[1]!.slot === 0x85b && parts[1]!.alpha === 0.5
        && near(at(parts[1]!.m, p.x, p.y, p.z), shadow),
        `${JSON.stringify(at(parts[1]!.m, p.x, p.y, p.z))} vs ${JSON.stringify(shadow)}`);

  a.worm.drawnBody = WormBodyDraw.None;
  a.worm.drawnHalves = [
    { half: 0, landed: 0, halfY: 0, x: -480, y: 20, z: -1330, yaw: 0x2345,
      t: [1.5, -3, 0.75], r: [0x1000, 0x2200, 0x0f00] },
    { half: 1, landed: 1, halfY: 5.2, x: -480, y: 20, z: -1330, yaw: 0x2345,
      t: [-1.5, -30, 0.25], r: [0x0800, 0, 0x3000] },
  ];
  const halves = WormDrawParts(a, []);
  const half = (h: typeof a.worm.drawnHalves[number]) => engine((m) => {
    M.MatrixTranslate(m, h.x, h.y, h.z);
    M.MatrixRotateY(m, h.yaw);
    if (h.landed) {
      M.MatrixTranslate(m, 0, -h.y, 0);
      M.MatrixTranslate(m, h.t[0], h.halfY, h.t[2]);
    } else {
      M.MatrixTranslate(m, h.t[0], h.t[1], h.t[2]);
    }
    M.MatrixRotateZ(m, h.r[2]); M.MatrixRotateY(m, h.r[1]);
    M.MatrixRotateX(m, h.r[0]);
    M.MatrixScale(m, 0.6, 0.6, 0.6);
  }, p.x, p.y, p.z);
  const h0 = half(a.worm.drawnHalves[0]!), h1 = half(a.worm.drawnHalves[1]!);
  check("a half in the air rides its track under the yaw, Rz Ry Rx, and "
        + "draws with its cut",
        halves.length === 4 && halves[0]!.slot === 0x875
        && halves[1]!.slot === 0x877
        && near(at(halves[0]!.m, p.x, p.y, p.z), h0)
        && near(at(halves[1]!.m, p.x, p.y, p.z), h0),
        `${JSON.stringify(at(halves[0]!.m, p.x, p.y, p.z))} vs ${JSON.stringify(h0)}`);
  check("...and a landed one is put at its own height, whatever the object's",
        halves[2]!.slot === 0x876
        && near(at(halves[2]!.m, p.x, p.y, p.z), h1)
        && Math.abs(at(halves[2]!.m, 0, 0, 0).y - 5.2) < 1e-4,
        `${JSON.stringify(at(halves[2]!.m, p.x, p.y, p.z))} vs ${JSON.stringify(h1)}`);
}

console.log("\nclass 0x26 subtypes 6/7: the recorded draws, where they were recorded:");
{
  // Two of the seven slots, as `slots_actor` names them.
  const root = new Obj3D();
  for (const slot of [0x1915, 0x9a8]) {
    const part = new Obj3D();
    part.name = `slots_actor_fixed000_slot_${slot.toString(16).padStart(4, "0")}`;
    part.userData = { hod2_kind: "rig_part", hod2_rig: "slots_actor" };
    part.add(new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial()));
    root.add(part);
  }
  ResetGameGlobals();
  const layer = new SlotModelLayer();
  layer.adopt(root);
  const a = makeActor(0x46a8, SpawnClass.Vehicle, -1, "six");
  if (a.cls !== SpawnClass.Vehicle) throw new Error("not class 0x26");
  a.pos = { x: 5, y: 6, z: 7 };      // the chain ignores it: the draws say
  const m1 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 667.45, 2554.72, -9679.61, 1];
  const m2 = [0.1, 0, 0, 0, 0, 0.427, 0, 0, 0, 0, 43.415, 0,
              811.73, 2563.05, -9680.42, 1];
  a.vehicle.draws = [{ slot: 0x1915, m: m1 },
                     { slot: 0x9a8, m: m2, light: [0.05, 0.01, 0] }];
  G.g_object_list.push(a);
  const ctx = { paths: null } as unknown as Parameters<typeof layer.update>[0];
  layer.update(ctx);
  const g = layer.nodeFor(0x46a8);
  const kids = g?.children ?? [];
  g?.updateWorldMatrix(true, true);
  const at = (o: InstanceType<typeof Obj3D>) =>
    new Vector3().setFromMatrixPosition(o.matrixWorld);
  check("each recorded draw is a node at its recorded world matrix",
        kids.length === 2 && at(kids[0]!).distanceTo(new Vector3(667.45, 2554.72, -9679.61)) < 1e-3
        && at(kids[1]!).distanceTo(new Vector3(811.73, 2563.05, -9680.42)) < 1e-3,
        kids.map((k) => at(k).toArray().map((v) => v.toFixed(2)).join(",")).join(" | "));
  check("...the scaled one keeps its scale",
        kids.length === 2 && Math.abs(kids[1]!.matrix.elements[10] - 43.415) < 1e-4);
  check("...and only the lit one carries its light colour",
        kids.length === 2 && !kids[0]!.userData.hod2_light_colour
        && (kids[1]!.userData.hod2_light_colour as number[] | undefined)?.join() === "0.05,0.01,0");

  // The light colour reaches the material: a twin on block 0's ambient and
  // direction with the draw's colour in place of the block's.
  const lights = new SceneLighting(new Scene());
  lights.set({ rgb: [1, 1, 1], ambient: 0.5, pitch: 0, yaw: 0 });
  lights.build(new Obj3D());
  lights.addRoot(layer.group);
  lights.beforeRender();
  const matOf = (o: InstanceType<typeof Obj3D>) => {
    let m: unknown = null;
    o.traverse((c) => {
      if ((c as { isMesh?: boolean }).isMesh) {
        m = (c as unknown as { material: unknown }).material;
      }
    });
    return m as { userData: Record<string, unknown>; type: string } | null;
  };
  const plain = matOf(kids[0]!);
  const lit = matOf(kids[1]!);
  check("the plain draw gets the scene's device-lit twin",
        plain?.type === "MeshLambertMaterial" && !plain.userData.lightColour,
        `${plain?.type} ${JSON.stringify(plain?.userData)}`);
  check("...and the lit one a twin keyed on its own colour",
        lit?.type === "MeshLambertMaterial"
        && lit.userData.lightColour === "0.05,0.01,0|null|block",
        `${lit?.type} ${JSON.stringify(lit?.userData)}`);
  // Its terms are `SetLightingDefaultSingle`'s with the colour swapped: the
  // block's ambient 0.5, so diffuse `C * 0.5 * 1.4` and ambient the packed
  // `C * 0.5` -- 6.375 truncated to 6 in red -- plus `C * 0.3`, all in the
  // engine's own numbers. A set is filled the moment it is made.
  const set = (lights as unknown as {
    coloured: Map<string, { color: { value: { r: number; g: number } };
                            ambient: { value: { r: number; g: number } } }> })
    .coloured.get("0.05,0.01,0|null|block");
  check("...on block 0's ambient with the draw's colour in place of the block's",
        !!set && Math.abs(set.color.value.r - 0.05 * 0.5 * DIFFUSE_SCALE) < 1e-6
        && Math.abs(set.color.value.g - 0.01 * 0.5 * DIFFUSE_SCALE) < 1e-6
        && Math.abs(set.ambient.value.r
                    - (6 / 255 + 0.05 * LIGHT_AMBIENT_SCALE)) < 1e-6,
        JSON.stringify(set && [set.color.value, set.ambient.value]));
  // `AssetDrawSlot` (`FUN_00418560`) draws nothing that is not resident: a
  // recorded draw of a slot the script has unloaded is dropped, the rest
  // stay.
  layer.residency = { slotResident: (s: number) => s !== 0x1915 };
  layer.update(ctx);
  const left = layer.nodeFor(0x46a8)?.children ?? [];
  left[0]?.updateWorldMatrix(true, true);
  check("a recorded draw of an unloaded slot draws nothing; the others do",
        left.length === 1
        && at(left[0]!).distanceTo(new Vector3(811.73, 2563.05, -9680.42)) < 1e-3,
        left.map((k) => at(k).toArray().map((v) => v.toFixed(2)).join(",")).join(" | "));
  layer.residency = null;
  a.vehicle.draws = [];
  layer.update(ctx);
  check("a frame that draws nothing leaves no node",
        layer.nodeFor(0x46a8) === null);
  G.g_object_list.length = 0;
}

console.log("\nScriptedHumanoidBoneDrawHook's extra models:");
{
  const { HumanoidHookDraws, syncHumanoidHookDraws }
    = await import("../src/render/characters/humanoid_hook");
  const near3 = (m: number[], x: number, y: number, z: number) =>
    Math.abs(m[12] - x) < 1e-3 && Math.abs(m[13] - y) < 1e-3
    && Math.abs(m[14] - z) < 1e-3;
  const a = makeActor(0x9064, SpawnClass.ScriptedHumanoid, 0x39, "hum");
  if (a.cls !== SpawnClass.ScriptedHumanoid) throw new Error("not class 0x25");
  a.motion = 0x34c;
  a.pos = { x: 100, y: 5, z: -30 };
  a.yaw = 0x4000;
  // Cursor 0x31, the world arm's last frame: the model's origin is
  // T(pos) RotY(0x4000) applied to (-2.01, 14.033 + 0.0272, -4.169 - 0.2).
  // Under the engine's RotY a quarter turn sends +X to -Z and +Z to +X, so
  // that is pos + (-4.369, 14.0602, 2.01) -- worked by hand, not read back.
  let d = HumanoidHookDraws(a, 0x31);
  check("motion 0x34C before 0x32: one 0x10E3, in the world, off pos and yaw",
        d.length === 1 && d[0]!.slot === 0x10e3 && d[0]!.world
        && d[0]!.bone === 8 && near3(d[0]!.m, 95.631, 19.0602, -27.99),
        JSON.stringify(d.map((x) => [x.slot, x.world, x.m.slice(12, 15)])));
  d = HumanoidHookDraws(a, 0);
  check("...and at cursor 0 it is (0x32) steps further out",
        d.length === 1 && near3(d[0]!.m, 100 - 4.169 - 10, 5 + 14.033 + 50 * Math.fround(0.027222222), -30 + 2.01),
        JSON.stringify(d[0]?.m.slice(12, 15)));
  d = HumanoidHookDraws(a, 0x32);
  check("from 0x32 it is on bone 8 at (0, -0.8, 0.1), a tenth the size",
        d.length === 1 && !d[0]!.world && d[0]!.bone === 8
        && near3(d[0]!.m, 0, -0.8, 0.1) && Math.abs(d[0]!.m[0] - 0.1) < 1e-6);
  a.charType = 0x38;
  check("type 0x38 is outside the second switch: nothing",
        HumanoidHookDraws(a, 0x32).length === 0);
  a.charType = 0x3a;
  a.motion = 0x32a;
  check("motion 0x32A draws 0x7ED on bone 5 from cursor 0x30, not before",
        HumanoidHookDraws(a, 0x2f).length === 0
        && HumanoidHookDraws(a, 0x30)[0]?.slot === 0x7ed
        && HumanoidHookDraws(a, 0x30)[0]?.bone === 5
        && near3(HumanoidHookDraws(a, 0x30)[0]!.m, 0.9, -1.4, 0.6));
  a.charType = 0x3e;
  a.motion = 0x14b;
  check("type 0x3E on 0x14B draws 0x7ED on bone 8 for cursors 0..0x6B",
        HumanoidHookDraws(a, 0x6b)[0]?.bone === 8
        && HumanoidHookDraws(a, 0x6c).length === 0
        && near3(HumanoidHookDraws(a, 0)[0]!.m, -0.3, -1.4, 0.6));

  // Hung under its bone, the world arm lands at its world point whatever the
  // bone's own transform is.
  a.charType = 0x39;
  a.motion = 0x34c;
  a.hum.playCursor = 0x31;
  const root = new Obj3D();
  const bone = new Obj3D();
  bone.position.set(3, -7, 11);
  bone.rotation.set(0.3, 1.1, -0.4);
  bone.scale.set(1.2, 1.2, 1.2);
  root.add(bone);
  const inst = { a, bones: new Map([[8, bone]]) } as unknown as
    Parameters<typeof syncHumanoidHookDraws>[0];
  syncHumanoidHookDraws(inst, () => new Obj3D());
  root.updateWorldMatrix(true, true);
  const node = (inst as { hookDraws?: Map<string, InstanceType<typeof Obj3D>> })
    .hookDraws?.get("8:4323");
  const p = node ? new Vector3().setFromMatrixPosition(node.matrixWorld) : null;
  check("the world arm's node sits at its world point under a turned, scaled bone",
        !!p && p.distanceTo(new Vector3(95.631, 19.0602, -27.99)) < 1e-3,
        p ? p.toArray().map((v) => v.toFixed(3)).join(",") : "no node");
  a.hum.playCursor = 0x32;
  syncHumanoidHookDraws(inst, () => new Obj3D());
  check("...and the same node takes the bone arm's matrix a frame later",
        !!node && Math.abs(node.matrix.elements[13] - -0.8) < 1e-6
        && node.parent === bone);
  a.motion = 0x2f4;
  syncHumanoidHookDraws(inst, () => new Obj3D());
  check("...and is hidden once the motion no longer draws it",
        !!node && !node.visible);
}

console.log("\nOneHitTargetBoneDrawHook's carried models:");
{
  const { OneHitTargetHookDraws } =
    await import("../src/render/characters/class20_hook");
  const { syncHumanoidHookDraws }
    = await import("../src/render/characters/humanoid_hook");
  // Class 0x20's hook (`FUN_00449530`): bones 4, 7, 11 and 14 draw their
  // node's first child's slot at that child's offset (`node+0x18`, the
  // `Translate(child+4, +8, +0xC)` at `0x00449581`). A skeleton in the
  // engine's order with `parent` an index: 4's first child is 5, and so on.
  const bones = [
    [1, 11, null], [2, 12, 0], [3, 13, 0], [4, 14, 2], [5, 15, 3],
    [6, 16, 0], [7, 17, 5], [8, 18, 6], [9, 19, null], [10, 20, 8],
    [11, 21, 9], [12, 22, 10], [13, 23, 8], [14, 24, 12], [15, 25, 13],
  ].map(([bone, slot, parent], i) => ({
    bone, slot, parent, part: "p", offset: [i + 0.5, -2 * i, 0.25] as
      [number, number, number],
  }));
  const type = { bones } as unknown as Parameters<typeof OneHitTargetHookDraws>[0];
  const d = OneHitTargetHookDraws(type);
  const at = (m: number[]) => m.slice(12, 15).join(",");
  check("four second models, on bones 4, 7, 11 and 14",
        d.map((x) => x.bone).join() === "4,7,11,14" && d.every((x) => !x.world),
        JSON.stringify(d.map((x) => x.bone)));
  check("...each the first child's own slot -- 5's, 8's, 12's and 15's",
        d.map((x) => x.slot).join() === "15,18,22,25",
        JSON.stringify(d.map((x) => x.slot)));
  // Bone 5 is index 4: its offset is (4.5, -8, 0.25), and nothing turns it.
  check("...at that child's offset, with no turn of its own",
        at(d[0]!.m) === "4.5,-8,0.25" && at(d[3]!.m) === "14.5,-28,0.25"
        && d[0]!.m[0] === 1 && d[0]!.m[5] === 1 && d[0]!.m[10] === 1,
        d.map((x) => at(x.m)).join(" | "));

  // Hung under the carrying bone's node, so the picture is the bone's matrix
  // times the child's translate, whatever the bone is doing.
  const a = makeActor(0x52ec, SpawnClass.OneHitTarget, 7, "target");
  const root = new Obj3D();
  const four = new Obj3D();
  four.position.set(3, -7, 11);
  four.rotation.set(0.3, 1.1, -0.4);
  root.add(four);
  const nodes = new Map([4, 7, 11, 14].map((b) => [b, b === 4 ? four
    : new Obj3D()]));
  const inst = { a, type, bones: nodes } as unknown as
    Parameters<typeof syncHumanoidHookDraws>[0];
  syncHumanoidHookDraws(inst, () => new Obj3D());
  root.updateWorldMatrix(true, true);
  const hung = (inst as { hookDraws?: Map<string, InstanceType<typeof Obj3D>> })
    .hookDraws?.get("4:15");
  const want = new Vector3(4.5, -8, 0.25).applyMatrix4(four.matrixWorld);
  const got = hung ? new Vector3().setFromMatrixPosition(hung.matrixWorld)
    : null;
  check("the carried model hangs under bone 4, at bone 4's matrix times the "
        + "child's offset", !!hung && hung.parent === four && !!got
        && got.distanceTo(want) < 1e-6,
        got ? got.toArray().join(",") : "no node");
}

console.log("\nclass 0x32: the node hook's draws, and the light each was made under:");
{
  const { syncBoss5NodeDraws, BOSS5_DRAW_HOLDER }
    = await import("../src/render/characters/boss5");
  type LightSetTag = { ambient: number | null; dir: number[] | null;
                       rgb: number[] | null };
  // A draw's own colour between `LightsUseSecondarySet` and
  // `LightsRestoreScene` keeps block 1's ambient and direction; a tag of null
  // is the block's own colour, not the parent's.
  const BOSS_AT = 0x3d84;
  const root = new Obj3D();
  root.userData = { hod2_spawn_at: BOSS_AT };
  const bone = new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial());
  bone.userData = { hod2_light_colour: [1, 0, 0] };
  const child = new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial());
  child.userData = { hod2_light_colour: null };
  bone.add(child);
  root.add(bone);
  const lights = new SceneLighting(new Scene());
  lights.set({ rgb: [1, 1, 1], ambient: 0.5, pitch: 0, yaw: 0 });
  // Block 1 is `G`'s: its ambient 0.4.
  ResetGameGlobals();
  G.g_scene_light_block1.channels[10] = 0.4;
  lights.source = { secondary: (at: number) => at === BOSS_AT };
  lights.build(root);
  lights.beforeRender();
  const ud = (m: unknown) => (m as { userData: Record<string, unknown> }).userData;
  check("a coloured draw of a block-1 actor gets a twin keyed on block 1",
        ud(bone.material).lightColour === "block1|1,0,0|null|block",
        JSON.stringify(ud(bone.material)));
  check("...and a child tagged null the block's own twin, not its parent's colour",
        ud(child.material).secondaryLit === true
        && ud(child.material).lightColour === undefined,
        JSON.stringify(ud(child.material)));
  const set = (lights as unknown as {
    coloured: Map<string, { color: { value: { r: number } } }> })
    .coloured.get("block1|1,0,0|null|block");
  check("...whose diffuse is block 1's ambient 0.4, not block 0's 0.5",
        !!set && Math.abs(set.color.value.r - 0.4 * DIFFUSE_SCALE) < 1e-6,
        JSON.stringify(set?.color.value));

  // The hook's models on the nodes: a single-primitive bone whose arm draws
  // two cels in place of its model, and a multi-primitive one that draws its
  // model and a cel.
  ResetGameGlobals();
  const a = makeActor(BOSS_AT, SpawnClass.Boss5, 0x4b, "boss5");
  if (a.cls !== SpawnClass.Boss5) throw new Error("not class 0x32");
  const b11 = new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial());
  const b15 = new Group();
  const own15 = new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial());
  b15.add(own15);
  b11.add(b15);                       // a child bone under a mesh bone
  const inst = {
    at: BOSS_AT, a, root: new Obj3D(), pivot: new Group(),
    type: { bones: [{ bone: 11, slot: 0x4ef }, { bone: 15, slot: 0x44a }] },
    bones: new Map<number, InstanceType<typeof Obj3D>>([[11, b11], [15, b15]]),
    gore: new Map(),
  } as unknown as Parameters<typeof syncBoss5NodeDraws>[0];
  const cloned: number[] = [];
  const clone = (slot: number) => {
    cloned.push(slot);
    const o = new Obj3D();
    o.userData.slot = slot;
    return o;
  };
  a.boss5.nodeDraws = {
    "11": [{ slot: 0x4f4, light: null }, { slot: 0x51c, light: [1, 0, 0] }],
    "15": [{ slot: 0x44a, light: null }, { slot: 0x450, light: null }],
  };
  a.boss5.drawDir = [0, -1, 0];
  syncBoss5NodeDraws(inst, clone);
  const holders = (n: InstanceType<typeof Obj3D>) =>
    n.children.filter((c) => c.name === BOSS5_DRAW_HOLDER);
  check("a node whose arm replaces its model hides its own mesh and hangs "
        + "both cels, the second under its light",
        !b11.layers.isEnabled(0) && holders(b11).length === 2
        && holders(b11).map((h) => h.userData.slot).join() === "1268,1308"
        && (holders(b11)[1].userData.hod2_light_set as LightSetTag).rgb?.join()
          === "1,0,0"
        && b15.parent === b11,
        `${b11.layers.isEnabled(0)} ${cloned.join()}`);
  check("...a node that draws its own slot shows it, with one cel beside it",
        own15.layers.isEnabled(0) && holders(b15).length === 1
        && holders(b15)[0].userData.slot === 0x450
        && (own15.userData.hod2_light_set as LightSetTag).rgb === null);
  check("...every model under the direction the draw's LightsUseSecondarySet "
        + "installed, and block 1's own ambient",
        [holders(b11)[0], holders(b11)[1], own15].every((o) => {
          const l = o.userData.hod2_light_set as LightSetTag;
          return l.dir?.join() === "0,-1,0" && l.ambient === null;
        }));
  a.boss5.nodeDraws = {};
  syncBoss5NodeDraws(inst, clone);
  check("...and a frame the walk drew nothing shows nothing",
        !b11.layers.isEnabled(0) && !own15.layers.isEnabled(0)
        && holders(b11).length === 0 && holders(b15).length === 0);
}

console.log("\nclass 0x41 constructor 61's figures: block 1, lit from the screen's right:");
{
  const { syncType61FigureLight } = await import("../src/render/characters/type61_figure");
  const { Type61FigureUpdate } = await import("../src/game/class41/type61");
  const { PropContainerRoutine } = await import("../src/game/class41/placer_state");
  const mat = await import("../src/game/matrix");
  const { Matrix4 } = await import("three");
  // `Type61FigureUpdate` hands `SetRenderLightDirection` the world vector of
  // `BuildSceneLightDirection(0, 0x4000)`, (1, 0, 0), which the device takes
  // as view space. Driven through the game with a camera turned and pitched,
  // the set the renderer builds must come out (1, 0, 0) in view space.
  ResetGameGlobals();
  const FIG_AT = 0x18302058;
  const a = makeActor(FIG_AT, SpawnClass.PropContainerPlacer, 0x0a, "figure");
  if (a.cls !== SpawnClass.PropContainerPlacer) throw new Error("not 0x41");
  a.placer.routine = PropContainerRoutine.Type61Figure;
  const v2w = mat.MatIdentity();
  mat.MatrixTranslate(v2w, 100, 2600, -9500);
  mat.MatrixRotateY(v2w, 0x3000);
  mat.MatrixRotateX(v2w, 0x0800);
  const w2v = mat.MatCopy(mat.MatIdentity(), v2w);
  mat.MatrixInvert(w2v);
  G.g_camera_view_to_world = v2w;
  G.g_camera_world_to_view = w2v;
  Type61FigureUpdate(a);
  const root = new Obj3D();
  root.userData = { hod2_spawn_at: FIG_AT };
  const mesh = new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial());
  root.add(mesh);
  type Inst = Parameters<typeof syncType61FigureLight>[0];
  const inst = { at: FIG_AT, a, root } as unknown as Inst;
  check("the figure's root is tagged with the direction its draw set",
        syncType61FigureLight(inst)
        && (root.userData.hod2_light_set as { dir: number[] }).dir.join()
          === a.placer.drawDir.join()
        && (root.userData.hod2_light_set as { rgb: unknown }).rgb === null);
  const lights = new SceneLighting(new Scene());
  lights.source = { secondary: (at: number) => at === FIG_AT };
  lights.build(root);
  lights.beforeRender();
  const ud = (m: unknown) => (m as { userData: Record<string, unknown> }).userData;
  check("...and drawn with a block-1 twin under a direction of its own",
        ud(mesh.material).lightColour === "block1|block|null|dir",
        JSON.stringify(ud(mesh.material)));
  // The three.js camera as `render/camera.ts` places it: the view-to-world
  // matrix's sixteen floats as they are.
  const cam = new PerspectiveCamera();
  new Matrix4().fromArray(v2w).decompose(cam.position, cam.quaternion, cam.scale);
  cam.updateMatrixWorld(true);
  // `update` rewrites every set's view-space direction from the camera, as
  // the frame does before the render.
  (lights as unknown as { update(c: unknown): void }).update({ camera: cam });
  const set = (lights as unknown as {
    coloured: Map<string, { dirView: { value: InstanceType<typeof Vector3> } }> })
    .coloured.get("block1|block|null|dir");
  const v = set?.dirView.value;
  check("...which is view-space (1, 0, 0) with the camera turned",
        !!v && Math.abs(v.x - 1) < 1e-5 && Math.abs(v.y) < 1e-5
        && Math.abs(v.z) < 1e-5,
        v ? v.toArray().join(",") : "no set");
}

console.log("\nthe warehouse water: the walk's heights and UVs, per vertex");
{
  // `Type26RippleUpdate` (`FUN_00469C80`): the height from the image's own
  // constants -- the centre (-472.5158, -1230.6945) as f32, 400, the f64 0.1
  // and 0x401338C8E0000000 -- at a vertex off both axes and a phase that is
  // not zero.
  const x = -503.7, z = -1188.2, phase = 0x1234;
  const dx = x + Math.fround(472.5158), dz = z + Math.fround(1230.6945);
  const b = Math.trunc((dx * dx + dz * dz) * 400 + phase);
  check("a vertex's height is the rings about (-472.5, -1230.7) at the phase",
        type26RippleHeight(x, z, phase) === Math.fround(
          Math.sin(b * Math.PI * 2 / 65536) * 0.1 - 4.805453777313232));
  // The UVs: the closed form against the walk's own adds, frame by frame, at
  // ticks that cross the 16-bit wrap -- `u += sin((tick * 0x180 + ftol(x) *
  // 600) & 0xFFFF) * 0.0004`, `v` the cosine of `z`'s.
  let u = 0, v = 0, ss = 0, cc = 0;
  for (let tick = 7; tick < 7 + 120; tick++) {
    const t = ((tick * 0x180) & 0xffff) * Math.PI * 2 / 65536;
    ss += Math.sin(t);
    cc += Math.cos(t);
    u += Math.sin(((tick * 0x180 + Math.trunc(x) * 600) & 0xffff)
                  * Math.PI * 2 / 65536) * 0.0004;
    v += Math.cos(((tick * 0x180 + Math.trunc(z) * 600) & 0xffff)
                  * Math.PI * 2 / 65536) * 0.0004;
  }
  const [du, dv] = type26RippleUvOffset(
    { sin: ss, cos: cc, frames: 120, phase: 0 }, x, z, [0, 0]);
  check("...and its UVs, the two sums against the walk's adds",
        Math.abs(du - u) < 1e-9 && Math.abs(dv - v) < 1e-9,
        `${du} ${u} ${dv} ${v}`);
}

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
