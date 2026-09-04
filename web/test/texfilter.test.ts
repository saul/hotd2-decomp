/**
 * The texture filter override.
 *
 * Three things can go wrong here and none of them is visible in a screenshot
 * without a careful eye:
 *
 * * **`asset` has to put back what the glTF sampler said.** The exporter emits
 *   the game's own per-mesh filter — `gltf.py`'s `get_sampler`, off the TSP
 *   `filter_mode` bit — so `asset` is the faithful mode and the only one that
 *   is not a constant. Once another mode has overwritten `minFilter` the
 *   sampler's value is gone unless it was recorded first.
 * * **`generateMipmaps` has to follow the filter.** A mipmap `minFilter` with
 *   no mip chain draws black; a linear one with mipmaps still on pays for an
 *   upload nothing samples.
 * * **`needsUpdate` has to be set**, or three.js never re-uploads and the
 *   trilinear and anisotropic modes look exactly like bilinear. It is a
 *   write-only setter — it bumps `version` and has no getter — so the
 *   assertions below read `version`, which is also the re-upload count.
 *
 *     node --experimental-strip-types tools/run_test.mjs test/texfilter.test.ts
 */
import {
  LinearFilter, LinearMipmapLinearFilter, Mesh, MeshBasicMaterial,
  NearestFilter, Texture,
} from "three";
import { TextureFilter } from "../src/render/texfilter";

let failed = 0;
function check(what: string, ok: boolean, got = ""): void {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${what}${ok ? "" : ` -- ${got}`}`);
  if (!ok) failed += 1;
}

/** A mesh whose texture carries the filter a glTF sampler would have set. */
function meshWith(min: number, mag: number): { mesh: Mesh; tex: Texture } {
  const tex = new Texture();
  tex.minFilter = min as Texture["minFilter"];
  tex.magFilter = mag as Texture["magFilter"];
  const mesh = new Mesh(undefined, new MeshBasicMaterial({ map: tex }));
  return { mesh, tex };
}

/** `prepare` takes anything with `traverse`, which is all the layer needs. */
function rootOf(...meshes: Mesh[]): { traverse: (f: (o: unknown) => void) => void } {
  return { traverse: (f) => { for (const m of meshes) f(m); } };
}

console.log("\ntexture filtering: an override, not a setting:");
{
  // The two the game actually ships: a nearest-filtered mesh and a bilinear
  // one, side by side, which is the case `asset` exists to preserve.
  const crisp = meshWith(NearestFilter, NearestFilter);
  const smooth = meshWith(LinearFilter, LinearFilter);
  const layer = new TextureFilter();
  layer.prepare(rootOf(crisp.mesh, smooth.mesh));

  check("the default is the asset's own filter", layer.filterMode === "asset",
        layer.filterMode);
  check("...so a nearest mesh stays nearest",
        crisp.tex.minFilter === NearestFilter, String(crisp.tex.minFilter));
  check("...and a linear one stays linear",
        smooth.tex.minFilter === LinearFilter, String(smooth.tex.minFilter));

  layer.setMode("nearest");
  check("forcing nearest reaches the mesh the game wanted smooth",
        smooth.tex.minFilter === NearestFilter
        && smooth.tex.magFilter === NearestFilter,
        `${smooth.tex.minFilter}/${smooth.tex.magFilter}`);

  // The point of the whole exercise: `asset` is recoverable *after* an
  // override, which only works because `prepare` recorded it.
  layer.setMode("asset");
  check("...and going back to `as the game` restores both, separately",
        crisp.tex.minFilter === NearestFilter
        && smooth.tex.minFilter === LinearFilter,
        `${crisp.tex.minFilter}/${smooth.tex.minFilter}`);

  layer.setMode("trilinear");
  check("trilinear takes a mip chain",
        smooth.tex.minFilter === LinearMipmapLinearFilter
        && smooth.tex.generateMipmaps,
        `${smooth.tex.minFilter} mips=${smooth.tex.generateMipmaps}`);
  check("...and magnification stays linear, which is what makes it trilinear "
        + "rather than nearest-mip",
        smooth.tex.magFilter === LinearFilter, String(smooth.tex.magFilter));

  layer.setMode("bilinear");
  check("bilinear drops the mip chain again", !smooth.tex.generateMipmaps,
        `mips=${smooth.tex.generateMipmaps}`);

  // Anisotropy is clamped by the hardware, so with no renderer attached the
  // ceiling is 1 and the mode is trilinear with a truthful label.
  check("the anisotropy ceiling is 1 until a renderer reports its own",
        layer.anisotropyLimit === 1, String(layer.anisotropyLimit));
  layer.setMode("aniso");
  check("...and anisotropic asks for exactly that ceiling",
        smooth.tex.anisotropy === 1, String(smooth.tex.anisotropy));
}

console.log("\nre-uploads only when something actually changed:");
{
  // `needsUpdate` is **write-only** on a three.js `Texture` -- the setter just
  // bumps `version` and there is no getter, so reading it back gives
  // `undefined`. `version` is the observable, and the count of re-uploads.
  const { mesh, tex } = meshWith(LinearFilter, LinearFilter);
  const layer = new TextureFilter();
  layer.prepare(rootOf(mesh));

  const v0 = tex.version;
  layer.setMode("bilinear");
  check("a mode that lands on the filter already set does not re-upload",
        tex.version === v0, `version ${v0} -> ${tex.version}`);

  layer.setMode("nearest");
  check("...and one that changes it does", tex.version > v0,
        `version ${v0} -> ${tex.version}`);

  // Setting the same mode twice must not walk the textures at all.
  const v1 = tex.version;
  layer.setMode("nearest");
  check("...and setting the same mode twice is a no-op", tex.version === v1,
        `version ${v1} -> ${tex.version}`);
}

console.log("\na stage change forgets the last stage's textures:");
{
  const first = meshWith(NearestFilter, NearestFilter);
  const layer = new TextureFilter();
  layer.prepare(rootOf(first.mesh));
  layer.setMode("bilinear");

  const second = meshWith(NearestFilter, NearestFilter);
  layer.prepare(rootOf(second.mesh));
  check("the new stage's textures take the mode that is set",
        second.tex.minFilter === LinearFilter, String(second.tex.minFilter));
  // The old texture is not touched again -- `prepare` cleared it -- which is
  // what stops a stage's textures being held alive by this layer.
  first.tex.minFilter = NearestFilter as Texture["minFilter"];
  layer.setMode("trilinear");
  check("...and the old stage's are left alone",
        first.tex.minFilter === NearestFilter, String(first.tex.minFilter));
}

console.log(failed ? `\n${failed} failed` : "\nall passed");
if (failed) process.exitCode = 1;
