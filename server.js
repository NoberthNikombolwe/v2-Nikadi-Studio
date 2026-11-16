// Production web server for Heroku (Procfile: `web: node server.js`).
// Serves the Vite build in studio/dist with no extra dependencies:
//   - HTTPS redirect (Heroku's router sets x-forwarded-proto)
//   - gzip for text files, long caching for hashed /assets, no-cache for index.html
//   - single-page-app fallback: unknown paths get index.html (the app routes with #/…)
//   - basic security headers
// Data never passes through here: the browser talks to Supabase and the Edge Functions directly.
import http from "node:http";
import https from "node:https";
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

// Fetch JSON from a URL using the built-in https module (no npm deps)
const fetchJson = (url, options = {}) => new Promise((resolve, reject) => {
  const req = https.request(url, { ...options, headers: { "Content-Type": "application/json", Accept: "application/json", ...(options.headers || {}) } }, (res) => {
    let data = "";
    res.on("data", (c) => data += c);
    res.on("end", () => {
      try { resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, json: JSON.parse(data) }); }
      catch { resolve({ ok: false, json: null }); }
    });
  });
  req.on("error", reject);
  if (options.body) req.write(options.body);
  req.end();
});

// /g/<eventPublicId>/<guestPublicId> — serve dynamic OG preview HTML so WhatsApp/SMS
// link previews show the guest's own invitation card instead of the generic site image.
// Regular browsers are immediately JS-redirected to the actual SPA page (/#/g/...).
const GUEST_PATH = /^\/g\/([A-Z0-9]{6,12})\/([A-Z0-9]{6,12})\/?$/i;
const serveGuestPreview = async (req, res, eid, gid) => {
  const SB_URL = process.env.VITE_SUPABASE_URL;
  const SB_KEY = process.env.VITE_SUPABASE_ANON_KEY;
  let d = null;
  if (SB_URL && SB_KEY) {
    try {
      const r = await fetchJson(`${SB_URL}/rest/v1/rpc/public_event_page_data`, {
        method: "POST",
        headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
        body: JSON.stringify({ p_event_public_id: eid.toUpperCase(), p_guest_public_id: gid.toUpperCase() }),
      });
      if (r.ok && r.json) { d = r.json; }
      else { console.error(`[guest-preview] RPC failed ${r.ok ? "null response" : "status non-2xx"} for ${eid}/${gid}`); }
    } catch (err) {
      console.error(`[guest-preview] RPC error for ${eid}/${gid}:`, err.message);
    }
  }

  const ps        = d?.page_settings || {};
  const eventName = ps.web_event_name || d?.event_name || "";
  const guestName = d?.guest_name || "";
  const eventType = d?.event_type || "";
  const venueName = d?.venue_name || "";
  const startDt   = d?.start_datetime || null;
  const tagline   = ps.tagline || "";

  // Fallback chain: guest's card → event page hero → event cover → generic OG image
  const proto   = req.headers["x-forwarded-proto"] || "https";
  const host    = req.headers.host || "www.nikadi.co.tz";
  const baseUrl = `${proto}://${host}`;
  const image   = d?.card_url || ps.hero_image_url || d?.cover_image_url || `${baseUrl}/og-image.jpg`;
  const spaUrl  = `/#/g/${eid.toUpperCase()}/${gid.toUpperCase()}`;
  const canonical = `${baseUrl}/g/${eid.toUpperCase()}/${gid.toUpperCase()}`;

  const title = [eventName, guestName && `${guestName}'s Invitation`].filter(Boolean).join(" — ") || "Event Invitation";

  // Description: tagline > type · venue · date
  const datePart = startDt ? new Date(startDt).toLocaleDateString("en-TZ", { day: "numeric", month: "long", year: "numeric" }) : "";
  const descParts = [tagline, eventType, venueName, datePart].filter(Boolean);
  const desc = descParts.length ? descParts.join(" · ") : `Personalised event invitation — Nikadi Studio`;

  // JSON-LD Event structured data (helps WhatsApp and Google understand the page)
  const eventSchema = eventName ? JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Event",
    "name": eventName,
    "description": desc,
    ...(startDt     ? { "startDate": startDt }                : {}),
    ...(d?.end_datetime ? { "endDate": d.end_datetime }       : {}),
    ...(venueName   ? { "location": {
                          "@type": "Place", "name": venueName,
                          ...(d?.venue_address ? { "address": d.venue_address } : {}),
                        } } : {}),
    "image": image,
    "organizer": { "@type": "Organization", "name": "Nikadi Studio", "url": `${baseUrl}/` },
    "eventStatus": "https://schema.org/EventScheduled",
    "eventAttendanceMode": "https://schema.org/OfflineEventAttendanceMode",
  }) : null;

  // Personal invitation pages should not appear in search results.
  // The noindex here matches the PublicGuestPage component's own meta update.
  const html = `<!doctype html><html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escHtml(title)}</title>
<meta name="description" content="${escHtml(desc)}">
<meta name="robots" content="noindex, nofollow">
<link rel="canonical" href="${escHtml(canonical)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Nikadi Studio">
<meta property="og:title" content="${escHtml(title)}">
<meta property="og:description" content="${escHtml(desc)}">
<meta property="og:url" content="${escHtml(canonical)}">
<meta property="og:image" content="${escHtml(image)}">
<meta property="og:image:width" content="800">
<meta property="og:image:height" content="600">
<meta property="og:image:alt" content="${escHtml(title)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escHtml(title)}">
<meta name="twitter:description" content="${escHtml(desc)}">
<meta name="twitter:image" content="${escHtml(image)}">
<meta name="twitter:image:alt" content="${escHtml(title)}">
${eventSchema ? `<script type="application/ld+json">${eventSchema}<\/script>` : ""}
<script>window.location.replace(${JSON.stringify(spaUrl)});<\/script>
<noscript><meta http-equiv="refresh" content="0;url=${escHtml(spaUrl)}"></noscript>
</head><body></body></html>`;
  res.writeHead(200, { ...SECURITY, "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
  res.end(html);
};
const escHtml = (s) => String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");

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
  const guestPreviewMatch = GUEST_PATH.exec((req.url || "").split("?")[0]);
  if (guestPreviewMatch) { serveGuestPreview(req, res, guestPreviewMatch[1], guestPreviewMatch[2]).catch(() => send(req, res, path.join(ROOT, "index.html"))); return; }
  const file = resolveFile(req.url || "/");
  if (file) return send(req, res, file);
  // A missing hashed asset is a real 404; everything else is the app
  if ((req.url || "").startsWith("/assets/")) { res.writeHead(404, SECURITY); return res.end("Not found"); }
  send(req, res, path.join(ROOT, "index.html"));
});

server.listen(PORT, () => console.log(`Nikadi Studio serving ${ROOT} on port ${PORT}`));
