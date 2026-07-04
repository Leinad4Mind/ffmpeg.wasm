// Minimal static file server that sends the cross-origin isolation headers
// (COOP/COEP/CORP) required for SharedArrayBuffer — which the multithreaded
// ffmpeg-core needs. `http-server` has no header support (its --headers flag is
// a silent no-op), so the previous `serve` script never actually sent these and
// the MT tests could not run. Dependency-free (Node built-ins only).
//
// Usage: node scripts/serve.js [port] [rootDir]
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.argv[2] || 3000);
const ROOT = path.resolve(process.argv[3] || process.cwd());

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".cjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".css": "text/css; charset=utf-8",
  ".mp4": "video/mp4",
  ".avi": "video/x-msvideo",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".gif": "image/gif",
  ".ttf": "font/ttf",
};

const COI_HEADERS = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Resource-Policy": "cross-origin",
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "no-cache, no-store, must-revalidate",
};

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split("?")[0]);
  const filePath = path.join(ROOT, urlPath);
  // Prevent path traversal outside ROOT.
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403, COI_HEADERS);
    return res.end("Forbidden");
  }
  fs.stat(filePath, (err, stat) => {
    const target = !err && stat.isDirectory() ? path.join(filePath, "index.html") : filePath;
    fs.readFile(target, (readErr, data) => {
      if (readErr) {
        res.writeHead(404, COI_HEADERS);
        return res.end("Not found: " + urlPath);
      }
      res.writeHead(200, {
        ...COI_HEADERS,
        "Content-Type": MIME[path.extname(target).toLowerCase()] || "application/octet-stream",
        "Content-Length": data.length,
      });
      res.end(data);
    });
  });
});

server.listen(PORT, () => {
  console.log(`serve: http://localhost:${PORT} (root=${ROOT}, cross-origin isolated)`);
});
