// Shared helpers for the three-perf scripts: argument parsing with validation, Playwright loading, browser launch.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

export const die = (msg, code = 2) => { console.error(`three-perf: ${msg}`); process.exit(code); };

/* Throwaway profiles this process created: removed on any exit, including die() part-way through a run. */
const made = new Set();
process.on("exit", () => { for (const d of made) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } });
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => process.exit(130));

export function checkGlobalName(name, flag = "--ready") {
  if (!/^[A-Za-z_$][\w$]*$/.test(name || "")) die(`${flag} must be a plain global name, got "${name}"`);
  return name;
}

/* Parse --key value / --flag arguments against a spec: { name: { type: "int"|"num"|"str"|"bool"|"list", min, max, def } }.
   Unknown flags, missing values and out-of-range numbers stop the script: a typo never silently falls back. */
export function parseArgs(argv, spec) {
  const out = {}, rest = [];
  for (const [k, s] of Object.entries(spec)) if ("def" in s) out[k] = s.def;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") { out.help = true; continue; }
    if (!a.startsWith("--")) { rest.push(a); continue; }
    const key = a.slice(2), s = spec[key];
    if (!s) die(`unknown option ${a}`);
    if (s.type === "bool") { out[key] = true; continue; }
    const v = argv[++i];
    if (v === undefined || v.startsWith("--")) die(`${a} needs a value`);
    if (s.type === "int" || s.type === "num") {
      const n = Number(v);
      if (!Number.isFinite(n) || (s.type === "int" && !Number.isInteger(n))) die(`${a} must be a ${s.type === "int" ? "whole " : ""}number, got "${v}"`);
      if ((s.min !== undefined && n < s.min) || (s.max !== undefined && n > s.max)) die(`${a} must be between ${s.min} and ${s.max}`);
      out[key] = n;
    } else if (s.type === "list") out[key] = v.split(",").map((x) => x.trim()).filter(Boolean);
    else out[key] = v;
  }
  return { opts: out, rest };
}

/* Only http(s) pages; anything else (file:, javascript:, data:) is refused. */
export function checkUrl(u) {
  let url;
  try { url = new URL(u); } catch { die(`not a URL: ${u}`); }
  if (!/^https?:$/.test(url.protocol)) die(`only http(s) URLs: ${u}`);
  return url.href;
}

export function parseSize(s) {
  const m = /^(\d{2,5})x(\d{2,5})$/.exec(s || "");
  if (!m) die(`--size must look like 1600x900, got "${s}"`);
  return { width: +m[1], height: +m[2] };
}

/* Playwright: PLAYWRIGHT=<file> first, then a copy installed beside this skill, then the project it is run from.
   The file actually loaded is printed, so an unexpected copy is visible. */
export async function loadPlaywright() {
  const tries = [];
  if (process.env.PLAYWRIGHT) tries.push(path.resolve(process.env.PLAYWRIGHT));
  for (const req of [createRequire(import.meta.url), createRequire(path.join(process.cwd(), "noop.js"))])
    for (const m of ["playwright-core", "playwright"]) { try { tries.push(req.resolve(m)); } catch { /* not here */ } }
  for (const f of tries) {
    try { const pw = await import(pathToFileURL(f).href); console.error(`playwright: ${f}`); return pw; } catch { /* next */ }
  }
  die("Playwright not found: npm i -D playwright-core in your project (or set PLAYWRIGHT=<path to its index.mjs>)");
}

const CHROME = [
  process.env.CHROME,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser",
].filter(Boolean);

/* One browser per run. Chromium runs uncapped (no vsync, no frame-rate limit) so timings are the GPU's, not the
   display's. Every run gets its own throwaway profile with the HTTP cache off, unless --profile names one to reuse
   (one per port, so two runs never share it). Returns { browser|context, page, close }. */
export async function launch(pw, { engine = "chromium", size, dpr = 1, profile, headed = false, uncapped = true }) {
  if (!["chromium", "webkit"].includes(engine)) die(`--engine must be chromium or webkit`);
  const viewport = size || { width: 1600, height: 900 };
  const dir = profile ? path.resolve(profile) : fs.mkdtempSync(path.join(os.tmpdir(), "three-perf-"));
  const temp = !profile;
  if (temp) made.add(dir);
  let ctx;
  if (engine === "webkit") {
    ctx = await pw.webkit.launchPersistentContext(dir, { headless: !headed, viewport, deviceScaleFactor: dpr });
  } else {
    const exe = CHROME.find((p) => fs.existsSync(p));
    const args = ["--use-angle=default", "--enable-gpu-rasterization", "--ignore-gpu-blocklist", "--disable-background-timer-throttling", "--disable-renderer-backgrounding"];
    if (uncapped) args.push("--disable-gpu-vsync", "--disable-frame-rate-limit");
    ctx = await pw.chromium.launchPersistentContext(dir, {
      headless: !headed, viewport, deviceScaleFactor: dpr, args,
      ...(exe ? { executablePath: exe } : {}),
    });
  }
  const page = ctx.pages()[0] || await ctx.newPage();
  // Caches off: a repeat run must not be faster only because the files came from disk.
  try { const cdp = engine === "chromium" ? await ctx.newCDPSession(page) : null; if (cdp) await cdp.send("Network.setCacheDisabled", { cacheDisabled: true }); } catch { /* best effort */ }
  const close = async () => {
    await ctx.close().catch(() => {});
    if (temp) { fs.rmSync(dir, { recursive: true, force: true }); made.delete(dir); }   // only the profile this run created
  };
  return { ctx, page, close };
}

/* Wait until the page says it is ready: window[name] truthy (default "__threePerf"), or fail after the timeout. */
export async function waitReady(page, name, timeoutMs) {
  checkGlobalName(name);
  await page.waitForFunction((n) => !!window[n], name, { timeout: timeoutMs, polling: 50 })
    .catch(() => die(`the page never set window.${name} within ${timeoutMs / 1000} s (see the skill's page hook)`, 3));
}

export const median = (a) => { const s = [...a].sort((x, y) => x - y); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : NaN; };
export const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN; };
export const fmt = (n) => (Number.isFinite(n) ? n.toFixed(2) : "-");

export function writeJson(file, data) {
  if (!file) return;
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
  console.error(`wrote ${file}`);
}
