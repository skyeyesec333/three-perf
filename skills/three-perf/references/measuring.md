# Measuring a three.js scene honestly

Most "it got faster" claims about WebGL are noise. These are the habits that make a number mean something.

## Frame time: GPU-synced, fixed views, uncapped

`scripts/frametime.mjs <url>` with the page hook installed.

- **Synced to the GPU.** `renderer.render()` returns long before the GPU has drawn anything. Each timed frame is followed by a 1x1 `readPixels`, which waits for the GPU to finish. The number includes the GPU's work, which is usually the part that matters.
- **Fixed views.** Frame time depends on what is on screen. The hook's `views` are named camera positions; the same views every time, before and after.
- **Not paced by the display.** A capped browser reports 16.7 ms whatever the GPU did. The script launches Chromium with `--disable-gpu-vsync --disable-frame-rate-limit`.
- **Warm first, then time.** `--warm 10` draws untimed frames first: the first frames after a view change upload textures and compile anything not yet compiled.
- **Median and p90, several loads.** `--runs 3` pools three fresh loads. Differences under ~5% are within noise on most machines; repeat before believing them.
- **Headless is not the visitor's machine.** Use it for before/after on the same machine, not as an absolute. Check a real phone and Safari separately.

Without the hook, `frametime.mjs` falls back to timing animation frames for a few seconds and says so: that is pacing, not cost, and only shows big problems.

## Load and warm-up: `scripts/warmup.mjs`

Reports time to ready, how many shader programs were linked before and after ready, and frames over 50 ms after ready.

- **Programs linked after ready** were compiled inside a frame the visitor sees: a freeze. On WebKit a post-processing stack built in its first frame is typically a few hundred ms. Fix: `src/compileComposer.js` during the warm-up.
- **Run it on WebKit too** (`--engine webkit`, Playwright's WebKit): Safari compiles differently and is where freezes show.

## A first visit: `--cold`

A repeat run is not a first visit even with a fresh browser profile, because the **GPU driver keeps its own shader cache** outside the browser (Metal's on macOS). A measurement that looks like a cold start may be reading shaders compiled by an earlier run, which makes a new technique look slow and an old one look fast.

`warmup.mjs --cold` rewrites every shader at `shaderSource` with a uniform whose name carries a random seed, read in a branch that never fires. A comment or an unused `#define` would not work: they disappear before the driver hashes the shader. A different uniform name survives translation, so the driver has never seen the program. Use cold runs for load time only: the added `discard` path can turn off early depth testing, so frame times in a cold run are pessimistic.

Compare like with like: cold against cold, warm against warm, with the run count stated.

## Before and after pictures: `scripts/compare.mjs`

An optimisation that changes the picture is a quality trade, and that is the owner's decision, not yours. Give every optimisation a `?off=name` switch (`off()` in `src/perfHook.js`) and run:

```sh
node compare.mjs "http://localhost:5173/?off=batch" "http://localhost:5173/"
```

It writes each view before, after, side by side, and the centre 400x400 at 1:1 for both, and counts differing pixels. Look at the pairs and crops yourself. Animated things (rain, particles, time-based shaders) differ between any two shots; freeze time for the comparison if you can.

## Hygiene

- One browser profile per port, never shared between two runs at once (`--profile`, else a throwaway one each run).
- HTTP cache off (the scripts do it) so a second load is not faster for the wrong reason.
- Clean up: throwaway profiles are deleted when each run ends. Screenshots and JSON go where you point `--out` / `--json`. Headless runs that are killed can leave profiles in the system temp folder (`three-perf-*`).
- Close other GPU-heavy apps while timing.
