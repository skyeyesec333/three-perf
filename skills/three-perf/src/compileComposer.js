/* Compile a post-processing composer's shaders during the warm-up, not inside the first visible frame.

   Why: renderer.compile(scene, camera) builds the scene's materials, but the composer's own passes (bloom, AO,
   tone mapping, your effects) are only built the first time composer.render() runs, and on WebKit/Safari a dozen of
   them can take 0.2-0.5 s in that one frame (more on a first visit). This walks the composer once with every real
   draw swapped for a compile, then waits, a frame at a time, until the GPU reports each program ready
   (KHR_parallel_shader_compile, via three's program.isReady()). Your loader can show it as progress.

     await compileComposer(renderer, composer, scene, { onProgress: (f) => setWarm(0.9 + 0.1 * f) });

   `scene` is the main scene: its own draw is skipped here because renderer.compile already built it.
   It never throws: a pass that cannot be walked this way compiles at its first real frame, as it would have. */
export async function compileComposer(renderer, composer, scene, { onProgress, alive = () => true } = {}) {
  if (!composer) return;
  const draw = renderer.render, was = renderer.getRenderTarget(), mats = new Set();
  renderer.render = (s, c) => {
    if (s === scene) return;
    try { const got = renderer.compile(s, c); if (got && got.forEach) got.forEach((m) => mats.add(m)); else s.traverse((o) => o.material && mats.add(o.material)); }
    catch { /* compiled at first use instead */ }
  };
  try { composer.render(0); } catch { /* the same */ } finally { renderer.render = draw; renderer.setRenderTarget(was); }
  const left = [...mats];
  while (left.length && alive()) {
    for (let k = left.length - 1; k >= 0; k--) {
      const p = renderer.properties.get(left[k]).currentProgram;
      if (!p || !p.isReady || p.isReady()) left.splice(k, 1);
    }
    onProgress?.(1 - left.length / Math.max(1, mats.size));
    if (left.length) await new Promise((r) => setTimeout(r, 16));
  }
  await new Promise((r) => requestAnimationFrame(() => r()));
}
