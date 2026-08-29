import { defineConfig } from "vite";
import {
  createReadStream,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
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

/**
 * BGM is streamed from the user's own install rather than copied into the
 * bundle: the six stage tracks plus their boss tracks are 161 MB of
 * uncompressed PCM, which would more than double the bundle for data the
 * player only ever reads. The game directory is recorded in `manifest.json`,
 * so the middleware can find it without being told twice.
 *
 * A local `extract/player/bgm/` wins if it exists, so a self-contained bundle
 * is still possible for a deployment that has no game directory to read.
 */
function soundRoot(kind: "bgm" | "SE" | "voice"): string | null {
  const local = join(BUNDLE_DIR, kind.toLowerCase());
  try {
    if (statSync(local).isDirectory()) return local;
  } catch { /* fall through to the game directory */ }
  try {
    const m = JSON.parse(readFileSync(join(BUNDLE_DIR, "manifest.json"), "utf8"));
    if (typeof m.game_dir === "string") {
      const dir = join(m.game_dir, "sound", kind);
      if (statSync(dir).isDirectory()) return dir;
    }
  } catch { /* no bundle, or no readable install */ }
  return null;
}

/**
 * The tables spell `.WAV` and carry backslashed subdirectories
 * (`COMMON\\BLOOD01_16.WAV`); the files on disk are `.wav` under real
 * directories. Resolve each path segment case-insensitively.
 */
function findCaseInsensitive(dir: string, name: string): string | null {
  let cur = dir;
  const parts = name.replace(/\\/g, "/").split("/").filter(Boolean);
  for (let i = 0; i < parts.length; i++) {
    const want = parts[i].toLowerCase();
    let hit: string | null = null;
    try {
      for (const f of readdirSync(cur)) {
        if (f.toLowerCase() === want) { hit = f; break; }
      }
    } catch { return null; }
    if (!hit) return null;
    cur = join(cur, hit);
  }
  return cur;
}

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

        const sound = url.startsWith("/bgm/") ? (["bgm", "bgm"] as const)
          : url.startsWith("/se/") ? (["se", "SE"] as const)
          : url.startsWith("/voice/") ? (["voice", "voice"] as const)
          : null;
        if (sound) {
          const root = soundRoot(sound[1]);
          const name = decodeURIComponent(url.slice(sound[0].length + 2));
          // normalize() collapses any ../ before it can escape the root.
          const file = root && !normalize(name).startsWith("..")
            ? findCaseInsensitive(root, name)
            : null;
          if (!file) {
            res.statusCode = 404;
            return res.end(root ? `no such ${sound[0]}: ${name}` :
              `no ${sound[0]} source: neither extract/player/${sound[0]}/ nor ` +
              "the game directory named in manifest.json is readable");
          }
          const size = statSync(file).size;
          // Range support, so the browser can seek and so a 14 MB track does
          // not have to buffer end to end before it starts.
          const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
          res.setHeader("Content-Type", "audio/wav");
          res.setHeader("Accept-Ranges", "bytes");
          if (range) {
            const start = range[1] ? Number(range[1]) : 0;
            const end = range[2] ? Number(range[2]) : size - 1;
            if (start >= size || end >= size || start > end) {
              res.statusCode = 416;
              res.setHeader("Content-Range", `bytes */${size}`);
              return res.end();
            }
            res.statusCode = 206;
            res.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
            res.setHeader("Content-Length", String(end - start + 1));
            return createReadStream(file, { start, end }).pipe(res);
          }
          res.setHeader("Content-Length", String(size));
          return createReadStream(file).pipe(res);
        }

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
