# A loading count that tells the truth

A percentage that reaches 100 when the files are downloaded and then sits there while shaders compile (or freezes the page at "82%") is the most common complaint about WebGL loaders. Count both halves.

## Two halves

- **Download**, measured: bytes in over bytes expected (three's `DefaultLoadingManager.onProgress` gives items, not bytes; a fetch wrapper or the known sizes of your files give bytes).
- **Warm-up**, staged: textures uploaded, scene shaders compiled, programs ready on the GPU, first draws, the composer's passes compiled. Give each stage a share and advance within it.

A split that worked for a heavy scene: about 60% download, 37% warm-up (textures to 67, scene shaders 82, GPU ready 86, first draws 93, composer 97), the last 3% for the first real frame. Tune the shares to what your own `warmup.mjs` timeline shows.

## Rules

- **Never faster than a floor.** Ease the shown number toward the real one and cap its speed (e.g. the whole count takes at least ~1.5 s), so a cached visit does not flash 0 to 100.
- **Never backwards.** Show `max(shown, real)`.
- **Stay responsive.** Do the warm-up in slices across frames (`initTexture` a few at a time, a frame between compile stages, `KHR_parallel_shader_compile` polling via `program.isReady()`), so the count keeps moving and the page never stops answering.
- **Nothing visible compiles after 100.** `warmup.mjs` reports programs linked after ready; that number should be 0 (or only things that load later by design and warm themselves while hidden).
- Reduced motion: no animated count; a plain "Loading" and then the scene.
