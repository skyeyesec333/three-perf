#!/usr/bin/env node
// warmup.mjs: how long until the scene is ready, and what compiles too late.
//
//   node warmup.mjs [options] <url>
//
// Each run is a fresh browser profile with the cache off. With --cold every shader is rewritten with a constant no
// earlier run used (see references/measuring.md), so the GPU driver's own cache (Metal's on macOS) cannot help: that is a
// first visit. Without --cold it is a repeat visit with a warm driver cache, which is what most measurements see.
// Reports, per run: time to ready, programs linked before and after ready (after = compiled inside a visible frame,
// the freeze), and animation frames over 50 ms after ready.
//
// Options:
//   --cold         new shaders every run                    --runs N      runs (3)
//   --ready NAME   global that means "ready" (__threePerf)  --after S     seconds to watch after ready (5)
//   --engine E     chromium | webkit                        --size WxH    viewport (1600x900)
//   --timeout S    seconds to wait for ready (120)          --json FILE   write the results
//   --no-baseline  skip the bare-WebGL run that tells the browser's own stalls from the page's
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { parseArgs, checkGlobalName, checkUrl, parseSize, loadPlaywright, launch, waitReady, median, fmt, writeJson } from "./lib/common.mjs";

const { opts, rest } = parseArgs(process.argv.slice(2), {
  cold: { type: "bool" }, runs: { type: "int", min: 1, max: 20, def: 3 }, ready: { type: "str", def: "__threePerf" },
  after: { type: "int", min: 0, max: 60, def: 5 }, engine: { type: "str", def: "chromium" }, size: { type: "str", def: "1600x900" },
  timeout: { type: "int", min: 5, max: 900, def: 120 }, json: { type: "str" }, headed: { type: "bool" }, "no-baseline": { type: "bool" },
});
if (opts.help || rest.length !== 1) { console.log("usage: node warmup.mjs [--cold] [options] <url>   (see the header of this file)"); process.exit(opts.help ? 0 : 2); }
const url = checkUrl(rest[0]), size = parseSize(opts.size);
const probeSrc = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "lib", "probe.js"), "utf8");
checkGlobalName(opts.ready);
const pw = await loadPlaywright();

/* The browser's own stalls: headless Chromium shows a long frame about a second in on ANY WebGL page (a bare page
   that only clears the screen shows it too). One run of such a page, measured the same way, so the page under test
   is not blamed for them. */
const BARE = "data:text/html," + encodeURIComponent('<canvas id=c width=800 height=600></canvas><script>const g=c.getContext("webgl2")||c.getContext("webgl");let k=0;(function f(){g.clearColor((k++%60)/60,0,0,1);g.clear(g.COLOR_BUFFER_BIT);requestAnimationFrame(f)})();window.__bare=1</script>');
let baseline = [];
if (!opts["no-baseline"]) {
  const b = await launch(pw, { engine: opts.engine, size, profile: null, headed: opts.headed });
  try {
    await b.page.addInitScript(probeSrc.replace("__TP_SEED__", "0"));
    await b.page.goto(BARE, { waitUntil: "load", timeout: 30000 });
    await b.page.waitForTimeout((opts.after + 2) * 1000);
    baseline = (await b.page.evaluate(() => window.__tpProbe.long)) || [];
  } finally { await b.close(); }
  console.log(baseline.length ? `browser baseline: a bare WebGL page also has ${baseline.length} long frame(s): ${baseline.map((f) => `${f.ms} ms at ${f.at} ms`).join(", ")}. Matching frames below are marked "(browser)".`
    : "browser baseline: a bare WebGL page has no long frames here.");
}
const isBrowser = (f) => baseline.some((x) => Math.abs(x.at - f.at) < 250);

const runs = [];
for (let r = 1; r <= opts.runs; r++) {
  const seed = opts.cold ? crypto.randomInt(1, 2 ** 31 - 1) : 0;   // a whole number only ever reaches the page
  const b = await launch(pw, { engine: opts.engine, size, profile: null, headed: opts.headed });
  try {
    await b.page.addInitScript(probeSrc.replace("__TP_SEED__", String(seed)));
    const t0 = Date.now();
    await b.page.goto(url, { waitUntil: "commit", timeout: opts.timeout * 1000 });
    await waitReady(b.page, opts.ready, opts.timeout * 1000);
    const readyAt = await b.page.evaluate(() => (window.__tpProbe.readyAt = performance.now()));
    await b.page.waitForTimeout(opts.after * 1000);
    const p = await b.page.evaluate(() => window.__tpProbe);
    const late = p.links.filter((t) => t > readyAt), longAfter = p.long.filter((f) => f.at >= readyAt);
    const own = longAfter.filter((f) => !isBrowser(f));
    const row = { run: r, cold: !!seed, readyMs: Math.round(readyAt), wallMs: Date.now() - t0, programsBefore: p.links.length - late.length,
      programsAfter: late.length, longFramesAfter: own.length, worstFrameAfter: own.reduce((m, f) => Math.max(m, f.ms), 0),
      longFrames: longAfter.map((f) => ({ ...f, browser: isBrowser(f) })) };
    runs.push(row);
    const list = longAfter.map((f) => `${f.ms} ms at ${f.at}${isBrowser(f) ? " (browser)" : ""}`).join(", ");
    console.log(`run ${r}${seed ? " (cold)" : ""}: ready ${row.readyMs} ms, programs ${row.programsBefore} before / ${row.programsAfter} after ready, ` +
      `${row.longFramesAfter} long frame(s) after ready of the page's own${list ? ` [${list}]` : ""}`);
  } finally { await b.close(); }
}
const ready = runs.map((x) => x.readyMs);
console.log(`\nmedian ready ${fmt(median(ready))} ms over ${runs.length} ${opts.cold ? "cold" : "warm-driver"} runs`);
if (runs.some((x) => x.programsAfter > 0)) console.log("shaders compiled after ready: they freeze a visible frame. Pre-compile them in the warm-up (references/optimising.md, section 7).");
writeJson(opts.json, { url, engine: opts.engine, cold: !!opts.cold, baseline, runs });
