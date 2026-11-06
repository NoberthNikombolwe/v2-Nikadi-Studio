// Production web server for Heroku (Procfile: `web: node server.js`).
// Serves the Vite build in studio/dist with no extra dependencies:
//   - HTTPS redirect (Heroku's router sets x-forwarded-proto)
//   - gzip for text files, long caching for hashed /assets, no-cache for index.html
//   - single-page-app fallback: unknown paths get index.html (the app routes with #/…)
//   - basic security headers
// Data never passes through here: the browser talks to Supabase and the Edge Functions directly.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "studio", "dist");
const PORT = Number(process.env.PORT) || 3000;
const FORCE_HTTPS = process.env.FORCE_HTTPS !== "false";

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp",
  ".ico": "image/x-icon", ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8", ".xml": "application/xml; charset=utf-8", ".webmanifest": "application/manifest+json",
  ".map": "application/json; charset=utf-8",
};
const COMPRESSIBLE = /^(text\/|application\/(json|xml|manifest)|image\/svg)/;

const SECURITY = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "SAMEORIGIN",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  // camera is needed by the door scanner (Scanner tab and the public #/scan page)
  "Permissions-Policy": "camera=(self), microphone=(), geolocation=()",
};

if (!fs.existsSync(path.join(ROOT, "index.html"))) {
  console.error(`No build found at ${ROOT}. Run "npm run build" (Heroku runs heroku-postbuild).`);
  process.exit(1);
}

// Resolve a URL path to a file inside ROOT (never outside it); null if missing
const resolveFile = (urlPath) => {
  let p;
  try { p = decodeURIComponent(urlPath.split("?")[0]); } catch { return null; }
  const file = path.normalize(path.join(ROOT, p));
  if (!file.startsWith(ROOT)) return null;
  try {
    const st = fs.statSync(file);
    if (st.isFile()) return file;
    if (st.isDirectory() && fs.existsSync(path.join(file, "index.html"))) return path.join(file, "index.html");
  } catch { /* not found */ }
  return null;
};

const send = (req, res, file, status = 200) => {
  const ext = path.extname(file).toLowerCase();
  const type = TYPES[ext] || "application/octet-stream";
  const headers = { ...SECURITY, "Content-Type": type, Vary: "Accept-Encoding" };
  const rel = path.relative(ROOT, file).replace(/\\/g, "/");
  headers["Cache-Control"] = rel.startsWith("assets/") ? "public, max-age=31536000, immutable"
    : ext === ".html" ? "no-cache" : "public, max-age=3600";
  const gzip = COMPRESSIBLE.test(type) && /\bgzip\b/.test(req.headers["accept-encoding"] || "");
  if (gzip) headers["Content-Encoding"] = "gzip";
  res.writeHead(status, headers);
  if (req.method === "HEAD") return res.end();
  const stream = fs.createReadStream(file);
  stream.on("error", () => res.destroy());
  (gzip ? stream.pipe(zlib.createGzip()) : stream).pipe(res);
};

const server = http.createServer((req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405, { Allow: "GET, HEAD" }); return res.end(); }
  if (FORCE_HTTPS && req.headers["x-forwarded-proto"] === "http") {
    res.writeHead(301, { Location: `https://${req.headers.host}${req.url}` });
    return res.end();
  }
  if (req.url === "/healthz") { res.writeHead(200, { "Content-Type": "text/plain" }); return res.end("ok"); }
  const file = resolveFile(req.url || "/");
  if (file) return send(req, res, file);
  // A missing hashed asset is a real 404; everything else is the app
  if ((req.url || "").startsWith("/assets/")) { res.writeHead(404, SECURITY); return res.end("Not found"); }
  send(req, res, path.join(ROOT, "index.html"));
});

server.listen(PORT, () => console.log(`Nikadi Studio serving ${ROOT} on port ${PORT}`));
