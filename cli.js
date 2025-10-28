#!/usr/bin/env node
// cli.js — Jalankan JOKO Web Miner (joko.html) secara headless di terminal IDX
// Usage contoh:
//   node cli.js --algo=power2B --host=asia.rplant.xyz --port=7022 --wallet=mbc1q... --threads=8 --pass=x --ssl=false
//
// Log Mode A: hanya menampilkan "Hashrate: <angka> KH/s"

import { spawn } from "child_process";
import waitOn from "wait-on";
import puppeteer from "puppeteer";

// -------- arg parser sederhana: dukung --key=value atau --key value
function parseArgs() {
  const out = {};
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    const t = a[i];
    if (!t.startsWith("--")) continue;
    if (t.includes("=")) {
      const [k, ...rest] = t.slice(2).split("=");
      out[k] = rest.join("="); // jaga-spasi
    } else {
      const k = t.slice(2);
      const v = a[i + 1] && !a[i + 1].startsWith("--") ? a[++i] : true;
      out[k] = v;
    }
  }
  return out;
}

const args = parseArgs();

// -------- default config (bisa dioverride via argumen)
const CFG = {
  algo: (args.algo || "power2B"),
  host: args.host || "asia.rplant.xyz",
  port: Number(args.port || 7022),
  wallet: args.wallet || "YOUR_WALLET",
  threads: Number(args.threads || 8),
  pass: args.pass || "x",
  ssl: (String(args.ssl || "false").toLowerCase() === "true"),
  vitePort: Number(args.vitePort || 5173),
  htmlFile: args.html || "index.html",           // kita pakai joko.html (sesuai pilihanmu)
  showAllConsole: false                          // Log Mode A -> false (hanya hashrate)
};

function log(s) { process.stdout.write(s + "\n"); }

// -------- 1) Start Vite untuk menyajikan file html/js
log("[CLI] Starting Vite dev server…");
const vite = spawn(process.platform.startsWith("win") ? "npm.cmd" : "npm", ["run", "dev"], {
  stdio: "inherit",
  env: process.env
});

// tunggu server up
const base = `http://localhost:${CFG.vitePort}`;
await waitOn({ resources: [base], timeout: 90_000 }).catch(() => {
  log("[CLI] ERROR: Vite tidak bisa start (timeout). Pastikan script \"dev\" ada dan port bebas.");
  process.exit(1);
});

// susun URL ke joko.html + query autorun
const url = new URL(`${base}/${CFG.htmlFile}`);
url.searchParams.set("autorun", "true");
url.searchParams.set("algo", CFG.algo);
url.searchParams.set("host", CFG.host);
url.searchParams.set("port", String(CFG.port));
url.searchParams.set("wallet", CFG.wallet);
url.searchParams.set("threads", String(CFG.threads));
url.searchParams.set("pass", CFG.pass);
url.searchParams.set("ssl", CFG.ssl ? "true" : "false");

log(`[CLI] Dev server up: ${base}`);
log(`[CLI] Opening ${url.toString()}`);

// -------- 2) Luncurkan Chromium headless & buka joko.html
const browser = await puppeteer.launch({
  headless: "new",
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu"
  ],
  // Kalau perlu pakai Chrome sistem, set env: PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
  executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined
});
const page = await browser.newPage();

// tangkap log dari halaman; tampilkan hanya baris hashrate (Mode A)
page.on("console", (msg) => {
  const text = msg.text();
  // Tangkap "Hashrate: <angka> KH/s" dari joko.html
  const m = /Hashrate:\s*([\d.]+)\s*KH\/s/i.exec(text);
  if (m) {
    log(`Hashrate: ${m[1]} KH/s`);
    return;
  }
  if (CFG.showAllConsole) log(`[WEB] ${text}`);
});

// Beri config dari CLI ke halaman jika ingin dipakai (opsional)
await page.exposeFunction("getCliConfig", () => CFG);

// buka halaman
await page.goto(url.toString(), { waitUntil: "networkidle2" });
log(`[CLI] Miner page opened (algo=${CFG.algo}, threads=${CFG.threads}). Mining should start automatically…`);

// -------- graceful shutdown
async function shutdown() {
  log("\n[CLI] Shutting down…");
  try { await browser.close(); } catch {}
  try { vite.kill("SIGINT"); } catch {}
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// biarkan proses hidup
