/* Injected into the page before any of its scripts (Playwright addInitScript). Watches WebGL from the inside:
   - every program linked, with the time it was linked (programs linked after the page says it is ready are shaders
     compiled in a visible frame: the first-frame freeze, worst in Safari);
   - the moment the page says it is ready, recorded here in the page as it happens (a setter on the ready global,
     with the probe's own animation-frame loop as a fallback), so the first frame after ready is never missed;
   - every animation frame longer than 50 ms;
   - with a cold seed, rewrites every shader so no GPU cache anywhere has seen it before (see references/measuring.md).
   It records only; it never sends anything anywhere. Results are read back from window.__tpProbe; programs that
   failed to link are counted by window.__tpProbe.failed() once the run is over (checking LINK_STATUS during the run
   would force every compile to finish at once and change the timings being measured). */
(function (seed, readyName) {
  if (window.__tpProbe) return;
  const P = (window.__tpProbe = { links: [], long: [], frames: 0, seed: seed || 0, readyAt: null, ready: readyName });
  const now = () => performance.now();
  const markReady = (t) => { if (P.readyAt === null) P.readyAt = Math.round(t); };

  // The ready global: catch the assignment itself. If the page defines it some other way (defineProperty of its own,
  // a top-level `var`), the animation-frame loop below notices it within a frame instead.
  try {
    let held;
    Object.defineProperty(window, readyName, {
      configurable: true, enumerable: true,
      get() { return held; },
      set(v) { held = v; if (v) markReady(now()); },
    });
  } catch { /* already defined by the page: the frame loop covers it */ }

  // Cold shaders: rename main and call it from a new main that also reads a uniform whose NAME carries the seed.
  // A comment or an unused #define would be stripped before the driver's own cache key is made; a uniform that is
  // read cannot be, so the translated (e.g. Metal) source differs from every earlier run's. The added branch never
  // fires (the uniform stays 0). Each stage gets its own uniform name: a uniform shared by both stages must have the
  // same precision in both, and a fragment shader declared `precision mediump float` would then fail to link.
  // Fragment shaders gain a discard path, which can turn off early depth testing: measure compile time in a cold
  // run, frame time in a warm one.
  const MAIN = /\bvoid\s+main\s*\(\s*(void)?\s*\)/;
  function coldSource(gl, shader, src) {
    if (!seed || !MAIN.test(src)) return src;
    const vertex = gl.getShaderParameter(shader, gl.SHADER_TYPE) === gl.VERTEX_SHADER;
    const u = (vertex ? "tpColdV" : "tpColdF") + seed;
    const tail = vertex
      ? `\nuniform float ${u};\nvoid main(){ tp_main(); if (${u} > 1e30) gl_Position = vec4(0.0); }\n`
      : `\nuniform float ${u};\nvoid main(){ if (${u} > 1e30) discard; tp_main(); }\n`;
    return src.replace(MAIN, "void tp_main()") + tail;
  }

  const progs = [];   // kept off the serialised record: read back through failed()
  for (const Ctx of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
    if (!Ctx) continue;
    const proto = Ctx.prototype, src = proto.shaderSource, link = proto.linkProgram;
    proto.shaderSource = function (shader, s) { return src.call(this, shader, coldSource(this, shader, String(s))); };
    proto.linkProgram = function (prog) { P.links.push(Math.round(now())); progs.push([this, prog]); return link.call(this, prog); };
  }
  Object.defineProperty(P, "failed", {
    enumerable: false,
    value() {
      const bad = [];
      for (const [gl, p] of progs) {
        try { if (!gl.isContextLost() && !gl.getProgramParameter(p, gl.LINK_STATUS)) bad.push(String(gl.getProgramInfoLog(p) || "").slice(0, 300)); }
        catch { /* deleted program */ }
      }
      return { count: bad.length, first: bad[0] || "" };
    },
  });

  let last = 0;
  const tick = (t) => {
    if (P.readyAt === null && window[readyName]) markReady(t);
    if (last && t - last > 50) P.long.push({ at: Math.round(last), ms: Math.round(t - last) });
    last = t; P.frames++;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})(__TP_SEED__, __TP_READY__);
