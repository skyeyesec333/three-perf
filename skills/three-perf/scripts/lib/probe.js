/* Injected into the page before any of its scripts (Playwright addInitScript). Watches WebGL from the inside:
   - every program linked, with the time it was linked (programs linked after the page says it is ready are shaders
     compiled in a visible frame: the first-frame freeze, worst in Safari);
   - every animation frame longer than 50 ms;
   - with a cold seed, rewrites every shader so no GPU cache anywhere has seen it before (see references/measuring.md).
   It records only; it never sends anything anywhere. Results are read back from window.__tpProbe. */
(function (seed) {
  if (window.__tpProbe) return;
  const P = (window.__tpProbe = { links: [], long: [], frames: 0, seed: seed || 0, readyAt: null });
  const now = () => performance.now();

  // Cold shaders: rename main and call it from a new main that also reads a uniform whose NAME carries the seed.
  // A comment or an unused #define would be stripped before the driver's own cache key is made; a uniform that is
  // read cannot be, so the translated (e.g. Metal) source differs from every earlier run's. The added branch never
  // fires (the uniform stays 0). Fragment shaders gain a discard path, which can turn off early depth testing:
  // measure compile time in a cold run, frame time in a warm one.
  const MAIN = /\bvoid\s+main\s*\(\s*(void)?\s*\)/;
  function coldSource(gl, shader, src) {
    if (!seed || !MAIN.test(src)) return src;
    const type = gl.getShaderParameter(shader, gl.SHADER_TYPE);
    const u = "tpCold" + seed;
    const tail = type === gl.VERTEX_SHADER
      ? `\nuniform float ${u};\nvoid main(){ tp_main(); if (${u} > 1e30) gl_Position = vec4(0.0); }\n`
      : `\nuniform float ${u};\nvoid main(){ if (${u} > 1e30) discard; tp_main(); }\n`;
    return src.replace(MAIN, "void tp_main()") + tail;
  }

  for (const Ctx of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
    if (!Ctx) continue;
    const proto = Ctx.prototype, src = proto.shaderSource, link = proto.linkProgram;
    proto.shaderSource = function (shader, s) { return src.call(this, shader, coldSource(this, shader, String(s))); };
    proto.linkProgram = function (prog) { P.links.push(Math.round(now())); return link.call(this, prog); };
  }

  let last = 0;
  const tick = (t) => {
    if (last && t - last > 50) P.long.push({ at: Math.round(last), ms: Math.round(t - last) });
    last = t; P.frames++;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})(__TP_SEED__);
