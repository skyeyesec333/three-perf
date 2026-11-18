#!/usr/bin/env node
// frametime.mjs: GPU-synced frame time of a three.js page over fixed camera views.
//
//   node frametime.mjs [options] <url>
//
// With the page hook (src/perfHook.js or src/PerfHook.jsx exposes window.__threePerf), each view is set, warmed,
// then rendered N times, each frame followed by a 1-pixel readPixels from the screen that waits for the GPU to finish:
// the number is what the frame really costs, not what the display allowed. Without the hook it times animation
// frames instead in an uncapped browser (pacing, not cost; it says so).
//
// Waiting: with a custom --ready NAME it waits for that global (up to --timeout), then uses the hook if the page has
// one. With the default ready name the hook IS the ready signal; if it has not appeared --grace seconds after the
// page's load event, it falls back to frame pacing rather than waiting out the whole timeout.
//
// p90 is the frame that 90% of frames beat. With the default 60 frames per view it rests on the six slowest; at 20
// it would be the second-worst frame, i.e. noise. Use 60+ (and --runs 3) before comparing p90s.
//
// Options:
//   --frames N     timed frames per view (default 60)      --warm N      untimed frames first (default 10)
//   --runs N       fresh browser loads, results pooled (1)  --views a,b   view indexes or names (default all)
//   --size WxH     viewport (1600x900)                      --dpr N       device pixel ratio (1)
//   --engine E     chromium | webkit (Playwright's WebKit, not Safari itself)
//   --ready NAME   global that means "ready" (__threePerf)  --grace S     wait for the hook after load (10)
//   --timeout S    seconds to wait for a custom --ready (90) --seconds S  fallback sampling time (5)
//   --profile DIR  reuse a profile (one per port)           --json FILE   write the results
//   --headed       show the browser
//
// Any http(s) address works, not just localhost: you are loading that page in a browser like any visitor.
import { parseArgs, checkGlobalName, checkUrl, parseSize, loadPlaywright, launch, waitReady, median, pct, fmt, writeJson, die } from "./lib/common.mjs";

const { opts, rest } = parseArgs(process.argv.slice(2), {
  frames: { type: "int", min: 1, max: 1000, def: 60 }, warm: { type: "int", min: 0, max: 500, def: 10 },
  runs: { type: "int", min: 1, max: 20, def: 1 }, views: { type: "list" }, size: { type: "str", def: "1600x900" },
  dpr: { type: "num", min: 0.5, max: 4, def: 1 }, engine: { type: "str", def: "chromium" }, ready: { type: "str", def: "__threePerf" },
  timeout: { type: "int", min: 5, max: 900, def: 90 }, grace: { type: "int", min: 1, max: 300, def: 10 }, seconds: { type: "int", min: 1, max: 120, def: 5 },
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
    // 1. Ready: a custom name is waited for in full; the default name is the hook itself, given --grace seconds.
    const custom = opts.ready !== "__threePerf";
    if (custom) await waitReady(b.page, opts.ready, opts.timeout * 1000);
    else await b.page.waitForFunction(() => !!window.__threePerf, null, { timeout: opts.grace * 1000, polling: 100 }).catch(() => {});
    // 2. The hook, checked on its own: present means GPU-synced timing whatever the ready name was.
    const hooked = await b.page.evaluate(() => !!(window.__threePerf && window.__threePerf.gl && typeof window.__threePerf.render === "function"));
    if (!hooked && !custom) console.error(`no window.__threePerf hook ${opts.grace} s after load: timing frame pacing instead (raise --grace if the page needs longer)`);
    if (hooked) {
      mode = "gpu-synced";
      const res = await b.page.evaluate(async ({ frames, warm, views }) => {
        const h = window.__threePerf;
        const names = (h.views || ["default"]).map(String);
        const want = views ? views.map((v) => (/^\d+$/.test(v) ? +v : names.indexOf(v))) : names.map((_, i) => i);
        if (want.some((i) => i < 0 || i >= names.length)) return { error: `unknown view; the page has: ${names.join(", ")}` };
        const gl = h.gl, gl2 = typeof WebGL2RenderingContext !== "undefined" && gl instanceof WebGL2RenderingContext;
        /* GPU sync: read back one pixel of whatever render() drew last. readPixels cannot return until the work
           behind that pixel is done, so the time includes the frame's GPU cost. (Reading the screen instead does not
           work: work drawn into an offscreen target is not waited for.) A multisampled target cannot be read
           directly, so it is first resolved into a private 1x1 target. Every binding is put back as it was, so
           three's own state tracking stays correct. */
        let tiny = null;
        const bound = () => ({
          read: gl.getParameter(gl2 ? gl.READ_FRAMEBUFFER_BINDING : gl.FRAMEBUFFER_BINDING),
          draw: gl2 ? gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING) : null,
          rb: gl.getParameter(gl.RENDERBUFFER_BINDING),
        });
        const restore = (b) => {
          if (gl2) { gl.bindFramebuffer(gl.READ_FRAMEBUFFER, b.read); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, b.draw); }
          else gl.bindFramebuffer(gl.FRAMEBUFFER, b.read);
          gl.bindRenderbuffer(gl.RENDERBUFFER, b.rb);
        };
        const bufFor = (type) => (type === gl.FLOAT ? new Float32Array(4) : type === gl.UNSIGNED_BYTE ? new Uint8Array(4)
          : type === gl.HALF_FLOAT || type === 0x8D61 ? new Uint16Array(4) : new Uint32Array(4));
        const direct = () => {   /* the format the current read target accepts, so float targets read too */
          const fmt = gl.getParameter(gl.IMPLEMENTATION_COLOR_READ_FORMAT), type = gl.getParameter(gl.IMPLEMENTATION_COLOR_READ_TYPE);
          gl.readPixels(0, 0, 1, 1, fmt, type, bufFor(type));
        };
        const resolve = () => {
          const b = bound();
          if (!tiny) {
            tiny = gl.createFramebuffer(); const rb = gl.createRenderbuffer();
            gl.bindRenderbuffer(gl.RENDERBUFFER, rb); gl.renderbufferStorage(gl.RENDERBUFFER, gl.RGBA8, 1, 1);
            gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, tiny); gl.framebufferRenderbuffer(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, rb);
            restore(b);
          }
          gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, tiny);
          gl.blitFramebuffer(0, 0, 1, 1, 0, 0, 1, 1, gl.COLOR_BUFFER_BIT, gl.NEAREST);
          gl.bindFramebuffer(gl.READ_FRAMEBUFFER, tiny);
          gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
          restore(b);
        };
        /* Which read works is decided per view on its first warm-up frame, then used for every timed frame. */
        const pick = () => {
          while (gl.getError() !== gl.NO_ERROR) { /* clear errors from before */ }
          h.render(); direct();
          if (gl.getError() === gl.NO_ERROR) return direct;
          if (gl2) { h.render(); resolve(); if (gl.getError() === gl.NO_ERROR) return resolve; }
          return null;
        };
        const out = {};
        for (const i of want) {
          if (h.setView) await h.setView(i);
          const sync = pick();
          if (!sync) return { error: `view ${names[i]}: render() leaves a target bound that cannot be read back for a GPU sync. End render() by drawing to the screen (as a composer's last pass does), or render a readable target` };
          for (let k = 0; k < warm; k++) { h.render(); sync(); }
          const t = [];
          for (let k = 0; k < frames; k++) { const t0 = performance.now(); h.render(); sync(); t.push(performance.now() - t0); }
          out[names[i]] = t;
        }
        return { out };
      }, { frames: opts.frames, warm: opts.warm, views: opts.views || null });
      if (res.error) die(res.error, 1);
      for (const [k, v] of Object.entries(res.out)) pooled.set(k, [...(pooled.get(k) || []), ...v]);
    } else {
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
