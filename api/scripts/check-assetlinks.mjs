import fs from "node:fs";
const toml = fs.readFileSync("d:/videoshare-web/wrangler.toml", "utf8");
const m = toml.match(/ANDROID_SHA256\s*=\s*(?:"""([\s\S]*?)"""|"([^"]*)")/);
if (!m) {
  console.log("FAIL: ANDROID_SHA256 not found in wrangler.toml");
  process.exit(1);
}
const raw = m[1] ?? m[2];
const fps = raw
  .split(/[^0-9A-Fa-f:]+/)
  .map((s) => s.trim().toUpperCase())
  .filter(Boolean);
console.log("count = " + fps.length);
let allOk = true;
for (const f of fps) {
  const parts = f.split(":");
  const ok = parts.length === 32 && parts.every((p) => /^[0-9A-F]{2}$/.test(p));
  if (!ok) allOk = false;
  console.log((ok ? "VALID  " : "INVALID") + " " + f + " (bytes=" + parts.length + ")");
}
console.log("\nassetlinks.json sha256_cert_fingerprints array:");
console.log(JSON.stringify(fps, null, 1));
console.log(allOk ? "\nRESULT: ALL KEYS VALID" : "\nRESULT: SOME KEYS INVALID");
