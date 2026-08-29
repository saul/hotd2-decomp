import { defineConfig } from "vite";
import { createReadStream, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";

/**
 * The bundle is game-derived data and must never be committed or copied into
 * a build artifact, so it is not in `public/`. It is served straight out of
 * `extract/player/` under `/bundle/` instead.
 *
 * For a production build, put the bundle in `dist/bundle/` yourself -- the app
 * fetches `bundle/manifest.json` relative to the page either way.
 */
const BUNDLE_DIR = resolve(__dirname, "..", "extract", "player");

const MIME: Record<string, string> = {
  ".json": "application/json",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".bin": "application/octet-stream",
  ".png": "image/png",
  ".wav": "audio/wav",
};

function serveBundle() {
  return {
    name: "hod2-bundle",
    configureServer(server: import("vite").ViteDevServer) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? "").split("?")[0];
        if (!url.startsWith("/bundle/")) return next();
        // normalize() collapses any ../ before it can escape the directory.
        const rel = normalize(decodeURIComponent(url.slice("/bundle/".length)));
        if (rel.startsWith("..")) {
          res.statusCode = 403;
          return res.end("forbidden");
        }
        const file = join(BUNDLE_DIR, rel);
        let size: number;
        try {
          const st = statSync(file);
          if (!st.isFile()) throw new Error("not a file");
          size = st.size;
        } catch {
          res.statusCode = 404;
          return res.end(
            "no bundle at " + file +
            "\n\nBuild one first:\n" +
            '  python3 tools/export_player.py --game-dir "..." --all\n',
          );
        }
        res.setHeader("Content-Type", MIME[extname(file)] ?? "application/octet-stream");
        res.setHeader("Content-Length", String(size));
        res.setHeader("Cache-Control", "no-cache");
        createReadStream(file).pipe(res);
      });
    },
  };
}

export default defineConfig({
  plugins: [serveBundle()],
  server: { port: 5173, open: false },
  build: { target: "es2022", chunkSizeWarningLimit: 2000 },
});
