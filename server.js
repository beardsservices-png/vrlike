// server.js — static file server for Handspace and the Minecraft tools, plus a small
// key/value store so the build planner's saved builds and progress follow you between
// devices. On Railway, point DATA_DIR at the mounted volume (e.g. /data); without it,
// data goes in a local ./.data folder.
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const PORT = process.env.PORT || 8080;

let DATA_DIR = process.env.DATA_DIR || "/data";
try {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.accessSync(DATA_DIR, fs.constants.W_OK);
} catch (e) {
  DATA_DIR = path.join(ROOT, ".data");
  fs.mkdirSync(DATA_DIR, { recursive: true });
  console.warn(`DATA_DIR not writable; using ${DATA_DIR}`);
}
console.log(`Storage directory: ${DATA_DIR}`);
const KV_FILE = path.join(DATA_DIR, "mc-kv.json");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".ico": "image/x-icon",
  ".task": "application/octet-stream",
  ".wasm": "application/wasm",
};

// ---- key/value store (one JSON file, written atomically) ----
let kv = {};
try { kv = JSON.parse(fs.readFileSync(KV_FILE, "utf8")); } catch (e) { kv = {}; }
function saveKv() {
  const tmp = KV_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(kv));
  fs.renameSync(tmp, KV_FILE);
}
const isSafeKey = (k) => /^[A-Za-z0-9_.:x-]{1,120}$/.test(k);

function sendJSON(res, status, obj) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(obj));
}

function readBody(req, limit = 20 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let data = "";
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) { reject(new Error("Payload too large")); req.destroy(); return; }
      data += chunk;
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

async function handleApi(req, res, urlPath) {
  if (urlPath === "/api/health") return sendJSON(res, 200, { ok: true });
  if (urlPath === "/api/kv" && req.method === "GET") return sendJSON(res, 200, { app: "mc-tools", data: kv });
  const m = urlPath.match(/^\/api\/kv\/([^/]+)$/);
  if (m) {
    const key = decodeURIComponent(m[1]);
    if (!isSafeKey(key)) return sendJSON(res, 400, { error: "Bad key" });
    if (req.method === "PUT") {
      try {
        kv[key] = JSON.parse(await readBody(req));
        saveKv();
        return sendJSON(res, 200, { ok: true });
      } catch (e) {
        return sendJSON(res, e.message === "Payload too large" ? 413 : 400, { error: e.message });
      }
    }
    if (req.method === "DELETE") { delete kv[key]; saveKv(); return sendJSON(res, 200, { ok: true }); }
  }
  return sendJSON(res, 404, { error: "Not found" });
}

function serveStatic(req, res, urlPath) {
  if (urlPath === "/mc" || urlPath === "/mc/") { res.writeHead(302, { Location: "/tools/mc-builder/" }); return res.end(); }
  let file = path.normalize(path.join(ROOT, decodeURIComponent(urlPath)));
  if (!file.startsWith(ROOT) || /[\\/]\.(data|git)([\\/]|$)/.test(file)) { res.writeHead(403); return res.end("Forbidden"); }
  fs.stat(file, (err, st) => {
    if (!err && st.isDirectory()) file = path.join(file, "index.html");
    fs.readFile(file, (err2, buf) => {
      if (err2) { res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); return res.end("Not found"); }
      res.writeHead(200, { "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream" });
      res.end(buf);
    });
  });
}

http.createServer((req, res) => {
  const urlPath = (req.url || "/").split("?")[0];
  if (urlPath.startsWith("/api/")) {
    handleApi(req, res, urlPath).catch((e) => sendJSON(res, 500, { error: e.message }));
  } else serveStatic(req, res, urlPath);
}).listen(PORT, () => console.log(`Listening on ${PORT}`));
