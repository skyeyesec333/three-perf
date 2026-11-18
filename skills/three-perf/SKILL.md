---
name: three-perf
description: Measure and speed up a three.js or React Three Fiber scene without lowering picture quality. Use when a WebGL/three.js/R3F page drops frames, stutters, freezes on first view (especially in Safari), loads slowly, or shows a loading count that stalls; when asked to profile, benchmark or optimise draw calls, shaders, post-processing or the warm-up; or to prove an optimisation changed nothing visible.
---

# three-perf: faster frames, same picture

```
1. hook      install the page hook (dev only): named camera views + a full-frame render()
2. measure   frametime.mjs (GPU-synced ms per view)   warmup.mjs (ready time, late shaders; --cold for a first visit)
3. change    ONE thing, behind a ?off=name switch
4. measure   the same views, the same conditions
5. compare   compare.mjs before vs after: side by side, 1:1 crops, pixel diff; look at them
6. report    numbers with conditions; what changed on screen (should be nothing)
```

**The rule that outranks the rest:** never trade visible quality for speed without the owner's explicit yes. No automatic resolution scaling, no lower pixel ratio, no fewer particles, no blurrier shadows, unless they agreed to that specific trade after seeing it. Make the frame cheaper instead.

Scripts are in this skill's own folder. Set once per shell: `S="${CLAUDE_PLUGIN_ROOT:-<this skill's base directory>}/skills/three-perf/scripts"` when installed as a plugin, or `S=<this skill's base directory>/scripts` for a plain skill. Page modules are in its `src/` folder: copy the ones you need into the app.

They need Node 18+ and Playwright (`npm i -D playwright-core` in the project, or `PLAYWRIGHT=<path to its index.mjs>`; the path actually loaded is printed). Chromium runs uncapped; `--engine webkit` uses Playwright's WebKit (`npx playwright install webkit`).

## 1. The page hook

Without it, only coarse frame pacing can be measured. Copy `src/perfHook.js` (plain three) or `src/PerfHook.jsx` + `perfHook.js` (R3F) into the app and install it **in development only, once the scene is ready** (loaded and compiled):

- `views`: 3-6 named camera positions that cover the scene's heavy cases (the default view, the busiest angle, close on the most expensive object, a phone-shaped one).
- `render()`: one complete frame the way the app draws it (the composer, not just `renderer.render`).
- `off(name)`: `?off=a,b` switches, one per optimisation.

## 2. Measure

```sh
node "$S/frametime.mjs" --runs 3 http://localhost:5173/                 # ms per view, median and p90
node "$S/warmup.mjs" --runs 3 http://localhost:5173/                    # ready time, programs compiled late
node "$S/warmup.mjs" --cold --runs 3 http://localhost:5173/             # a first visit: no driver cache helps
node "$S/warmup.mjs" --engine webkit http://localhost:5173/             # Safari's first-frame freezes
```

Read [references/measuring.md](references/measuring.md) before trusting a number: why readPixels sync, why fixed views, why `--cold` exists (the GPU driver's own shader cache survives a fresh browser profile), noise levels.

## 3. Optimise

The playbook, in payoff order, is [references/optimising.md](references/optimising.md):

1. Draw calls: `joinStill` for rigid models, `<Still>` / `batchStill` for places built mesh by mesh (`src/joinStill.js`, `src/Still.jsx`). Mark rarely-moving things `userData.live`.
2. Screen effects at half size with a depth-aware upsample (`src/depthAwareUpsample.js`).
3. Passes that add nothing in a given view or device, off there only.
4. Expensive texture reads behind a cheap test (slope, distance), derivatives before the branch.
5. All lights mounted up front: a late light recompiles every lit shader.
6. Lazy-load what is not in the first view; prefetch on intent.
7. A real warm-up: compile, upload textures in slices, draw once, `compileComposer()` (`src/compileComposer.js`) so post-processing never compiles in a visible frame. A loading count that covers it: [references/loader.md](references/loader.md).

Change one thing at a time, behind its own `?off=` switch.

## 4. Prove it changed nothing

```sh
node "$S/compare.mjs" --out perf-out/batch "http://localhost:5173/?off=batch" "http://localhost:5173/"
```

Open the `-pair.png` and `-crop.png` files and look. A pixel count is a hint (animated noise differs between any two shots), not a verdict. Show the owner the pair when anything differs.

## 5. Report

Numbers with conditions (machine, browser, size, DPR, views, runs, cold or warm), before and after, and what changed on screen. Say what was not measured: a real phone, real Safari, a slow GPU.

## Hygiene

Headless runs: one profile per port, never shared by two runs at once; HTTP cache off; throwaway profiles are deleted at the end of each run (a killed run can leave `three-perf-*` in the system temp folder: ask before removing anything you did not create). Close other GPU-heavy apps while timing.

## Files

- `scripts/frametime.mjs`, `scripts/warmup.mjs`, `scripts/compare.mjs`; `scripts/lib/common.mjs` (arguments, Playwright, launch), `scripts/lib/probe.js` (injected: program links, long frames, cold shaders).
- `src/perfHook.js`, `src/PerfHook.jsx`, `src/joinStill.js`, `src/Still.jsx`, `src/compileComposer.js`, `src/depthAwareUpsample.js`.
- `references/measuring.md`, `references/optimising.md`, `references/loader.md`.
