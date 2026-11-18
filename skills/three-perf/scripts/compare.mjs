#!/usr/bin/env node
// compare.mjs: before/after pictures of the same views, side by side, with 1:1 crops and a pixel difference.
//
//   node compare.mjs [options] <url-before> <url-after>
//
// Typically the same page with and without an optimisation: https://host/?off=batch and https://host/.
// For each view (via the page hook's setView, or just the page as it loads) it writes:
//   <out>/<view>-before.png, -after.png, -pair.png (side by side), -crop.png (the centre 400x400 at 1:1, both)
// and prints how many pixels differ by more than --tol (0-255 per channel). An optimisation should change nothing
// you can see; a difference is a reason to look, not a pass or fail by itself (animated noise, rain, time).
//
// Options: --views a,b  --size WxH (1600x900)  --dpr N (1)  --engine E  --ready NAME (__threePerf)  --timeout S (90)
//          --settle S (2: seconds after ready before the shot)  --tol N (8)
//          --out DIR (perf-out/compare, relative to where you run it)  --force (replace pictures already there)
//
// It refuses to overwrite pictures from an earlier comparison unless --force is given. Any http(s) address works.
import fs from "node:fs";
import path from "node:path";
import { parseArgs, checkGlobalName, checkUrl, parseSize, loadPlaywright, launch, die } from "./lib/common.mjs";

const { opts, rest } = parseArgs(process.argv.slice(2), {
  views: { type: "list" }, size: { type: "str", def: "1600x900" }, dpr: { type: "num", min: 0.5, max: 4, def: 1 },
  engine: { type: "str", def: "chromium" }, ready: { type: "str", def: "__threePerf" }, timeout: { type: "int", min: 5, max: 900, def: 90 },
  settle: { type: "int", min: 0, max: 60, def: 2 }, tol: { type: "int", min: 0, max: 255, def: 8 }, out: { type: "str", def: "perf-out/compare" },
  headed: { type: "bool" }, force: { type: "bool" },
});
if (opts.help || rest.length !== 2) { console.log("usage: node compare.mjs [options] <url-before> <url-after>"); process.exit(opts.help ? 0 : 2); }
const urls = rest.map(checkUrl), size = parseSize(opts.size), out = path.resolve(opts.out);
checkGlobalName(opts.ready);
if (fs.existsSync(out) && !opts.force && fs.readdirSync(out).some((f) => /-(before|after|pair|crop)\.png$/.test(f)))
  die(`${out} already holds a comparison: pick another --out, or pass --force to replace it`);
fs.mkdirSync(out, { recursive: true });
const pw = await loadPlaywright();
const safe = (s) => String(s).replace(/[^\w.-]+/g, "_").slice(0, 60) || "view";
/* File names per view: two views whose names clean up to the same string get -2, -3... instead of overwriting. */
const fileNames = new Map(), usedNames = new Set();
const fileFor = (view) => {
  if (fileNames.has(view)) return fileNames.get(view);
  let base = safe(view), name = base, k = 2;
  while (usedNames.has(name)) name = `${base}-${k++}`;
  usedNames.add(name); fileNames.set(view, name); return name;
};

async function shots(u) {
  const b = await launch(pw, { engine: opts.engine, size, dpr: opts.dpr, headed: opts.headed });
  try {
    await b.page.goto(u, { waitUntil: "load", timeout: opts.timeout * 1000 });
    const hooked = await b.page.waitForFunction((n) => !!window[n], opts.ready, { timeout: opts.timeout * 1000, polling: 100 }).then(() => true, () => false);
    if (!hooked) die(`${u}: window.${opts.ready} never appeared`, 3);
    const names = await b.page.evaluate(() => (window.__threePerf?.views || ["default"]).map(String));
    const want = opts.views ? opts.views.map((v) => (/^\d+$/.test(v) ? +v : names.indexOf(v))) : names.map((_, i) => i);
    if (want.some((i) => i < 0 || i >= names.length)) die(`unknown view; the page has: ${names.join(", ")}`);
    const res = {};
    for (const i of want) {
      await b.page.evaluate(async (k) => { const h = window.__threePerf; if (h?.setView) await h.setView(k); if (h?.render) h.render(); }, i);
      await b.page.waitForTimeout(opts.settle * 1000);
      res[names[i]] = await b.page.screenshot({ type: "png" });
    }
    return res;
  } finally { await b.close(); }
}

const before = await shots(urls[0]), after = await shots(urls[1]);
// Compose and diff in a blank page: no image library needed.
const b = await launch(pw, { engine: "chromium", size: { width: 800, height: 600 } });
try {
  for (const view of Object.keys(before)) {
    if (!after[view]) continue;
    const s = fileFor(view);
    fs.writeFileSync(path.join(out, `${s}-before.png`), before[view]);
    fs.writeFileSync(path.join(out, `${s}-after.png`), after[view]);
    const r = await b.page.evaluate(async ({ a, z, tol }) => {
      const load = (b64) => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = "data:image/png;base64," + b64; });
      const [A, Z] = await Promise.all([load(a), load(z)]);
      const W = A.width, H = A.height, c = document.createElement("canvas"), g = c.getContext("2d");
      c.width = W; c.height = H; g.drawImage(A, 0, 0); const da = g.getImageData(0, 0, W, H).data;
      g.clearRect(0, 0, W, H); g.drawImage(Z, 0, 0); const dz = g.getImageData(0, 0, W, H).data;
      let diff = 0, worst = 0;
      for (let i = 0; i < da.length; i += 4) {
        const d = Math.max(Math.abs(da[i] - dz[i]), Math.abs(da[i + 1] - dz[i + 1]), Math.abs(da[i + 2] - dz[i + 2]));
        if (d > tol) diff++; if (d > worst) worst = d;
      }
      const pair = document.createElement("canvas"); pair.width = W * 2 + 8; pair.height = H;
      const p = pair.getContext("2d"); p.fillStyle = "#f0f"; p.fillRect(0, 0, pair.width, H); p.drawImage(A, 0, 0); p.drawImage(Z, W + 8, 0);
      const S = Math.min(400, W, H), x = (W - S) >> 1, y = (H - S) >> 1;
      const crop = document.createElement("canvas"); crop.width = S * 2 + 8; crop.height = S;
      const q = crop.getContext("2d"); q.fillStyle = "#f0f"; q.fillRect(0, 0, crop.width, S);
      q.drawImage(A, x, y, S, S, 0, 0, S, S); q.drawImage(Z, x, y, S, S, S + 8, 0, S, S);
      return { diff, worst, total: W * H, pair: pair.toDataURL("image/png").split(",")[1], crop: crop.toDataURL("image/png").split(",")[1] };
    }, { a: before[view].toString("base64"), z: after[view].toString("base64"), tol: opts.tol });
    fs.writeFileSync(path.join(out, `${s}-pair.png`), Buffer.from(r.pair, "base64"));
    fs.writeFileSync(path.join(out, `${s}-crop.png`), Buffer.from(r.crop, "base64"));
    console.log(`${view}: ${r.diff} of ${r.total} pixels differ by more than ${opts.tol} (${(100 * r.diff / r.total).toFixed(3)}%), worst ${r.worst}  -> ${path.join(out, s)}-pair.png`);
  }
} finally { await b.close(); }
