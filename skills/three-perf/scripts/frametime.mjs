#!/usr/bin/env node
// frametime.mjs: GPU-synced frame time of a three.js page over fixed camera views.
//
//   node frametime.mjs [options] <url>
//
// With the page hook (src/perfHook.js or src/PerfHook.jsx exposes window.__threePerf), each view is set, warmed,
// then rendered N times, each frame followed by a 1-pixel readPixels that waits for the GPU to finish: the number is
// what the frame really costs, not what the display allowed. Without the hook it falls back to timing animation
// frames for a few seconds in an uncapped browser (less exact; it says so).
//
// Options:
//   --frames N     timed frames per view (default 20)      --warm N      untimed frames first (default 10)
//   --runs N       fresh browser loads, results pooled (1)  --views a,b   view indexes or names (default all)
//   --size WxH     viewport (1600x900)                      --dpr N       device pixel ratio (1)
//   --engine E     chromium | webkit                        --ready NAME  global that means "ready" (__threePerf)
//   --timeout S    seconds to wait for ready (90)           --seconds S   fallback sampling time (5)
//   --profile DIR  reuse a profile (one per port)           --json FILE   write the results
//   --headed       show the browser
import { parseArgs, checkGlobalName, checkUrl, parseSize, loadPlaywright, launch, waitReady, median, pct, fmt, writeJson, die } from "./lib/common.mjs";

const { opts, rest } = parseArgs(process.argv.slice(2), {
  frames: { type: "int", min: 1, max: 1000, def: 20 }, warm: { type: "int", min: 0, max: 500, def: 10 },
  runs: { type: "int", min: 1, max: 20, def: 1 }, views: { type: "list" }, size: { type: "str", def: "1600x900" },
  dpr: { type: "num", min: 0.5, max: 4, def: 1 }, engine: { type: "str", def: "chromium" }, ready: { type: "str", def: "__threePerf" },
  timeout: { type: "int", min: 5, max: 900, def: 90 }, seconds: { type: "int", min: 1, max: 120, def: 5 },
  profile: { type: "str" }, json: { type: "str" }, headed: { type: "bool" },
});
if (opts.help || rest.length !== 1) { console.log("usage: node frametime.mjs [options] <url>   (see the header of this file)"); process.exit(opts.help ? 0 : 2); }
const url = checkUrl(rest[0]), size = parseSize(opts.size);
checkGlobalName(opts.ready);
const pw = await loadPlaywright();

const pooled = new Map();   // view name -> frame times
let mode = null;
for (let run = 1; run <= opts.runs; run++) {
  const b = await launch(pw, { engine: opts.engine, size, dpr: opts.dpr, profile: opts.profile, headed: opts.headed });
  try {
    await b.page.goto(url, { waitUntil: "load", timeout: opts.timeout * 1000 });
    const hooked = await b.page.waitForFunction((n) => !!window[n], opts.ready, { timeout: opts.timeout * 1000, polling: 100 }).then(() => true, () => false);
    if (hooked && opts.ready === "__threePerf") {
      mode = "gpu-synced";
      const res = await b.page.evaluate(async ({ frames, warm, views }) => {
        const h = window.__threePerf;
        const names = (h.views || ["default"]).map(String);
        const want = views ? views.map((v) => (/^\d+$/.test(v) ? +v : names.indexOf(v))) : names.map((_, i) => i);
        if (want.some((i) => i < 0 || i >= names.length)) return { error: `unknown view; the page has: ${names.join(", ")}` };
        const gl = h.gl, px = new Uint8Array(4);
        const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        const out = {};
        for (const i of want) {
          if (h.setView) await h.setView(i);
          for (let k = 0; k < warm; k++) { h.render(); sync(); }
          const t = [];
          for (let k = 0; k < frames; k++) { const t0 = performance.now(); h.render(); sync(); t.push(performance.now() - t0); }
          out[names[i]] = t;
        }
        return { out };
      }, { frames: opts.frames, warm: opts.warm, views: opts.views || null });
      if (res.error) die(res.error);
      for (const [k, v] of Object.entries(res.out)) pooled.set(k, [...(pooled.get(k) || []), ...v]);
    } else {
      if (opts.ready !== "__threePerf") await waitReady(b.page, opts.ready, opts.timeout * 1000);
      mode = "animation-frames";
      const t = await b.page.evaluate((secs) => new Promise((done) => {
        const out = []; let last = 0; const end = performance.now() + secs * 1000;
        const f = (now) => { if (last) out.push(now - last); last = now; now < end ? requestAnimationFrame(f) : done(out); };
        requestAnimationFrame(f);
      }), opts.seconds);
      pooled.set("as loaded", [...(pooled.get("as loaded") || []), ...t]);
    }
  } finally { await b.close(); }
}

console.log(`\n${url}  (${mode}${mode === "animation-frames" ? ": no window.__threePerf hook, so this is frame pacing, not GPU cost" : ""}; ${opts.engine}, ${opts.size} @${opts.dpr}x, ${opts.runs} run${opts.runs > 1 ? "s" : ""})`);
console.log(`  ${"view".padEnd(20)} ${"median ms".padStart(10)} ${"p90 ms".padStart(8)} ${"min ms".padStart(8)}  frames`);
const result = {};
for (const [k, t] of pooled) {
  result[k] = { median: median(t), p90: pct(t, 0.9), min: Math.min(...t), n: t.length };
  console.log(`  ${k.slice(0, 20).padEnd(20)} ${fmt(result[k].median).padStart(10)} ${fmt(result[k].p90).padStart(8)} ${fmt(result[k].min).padStart(8)}  ${t.length}`);
}
writeJson(opts.json, { url, mode, engine: opts.engine, size: opts.size, dpr: opts.dpr, runs: opts.runs, views: result });
