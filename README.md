# three-perf

A Claude Code skill that makes a **three.js / React Three Fiber** scene faster **without making it look worse**:

```
hook → measure (GPU-synced, fixed views) → change one thing behind ?off= → measure → compare pictures → report
```

It came out of tuning a heavy hand-built WebGL portfolio scene (a lit interior, a garden of ~600 meshes, post-processing, an underwater world), where every optimisation had to leave the picture exactly as it was.

## What the skill does

1. **Measures frame cost properly** (`frametime.mjs`): each frame of each named camera view is followed by a GPU sync, in an uncapped browser, over several loads. Median and p90 per view.
2. **Measures the warm-up** (`warmup.mjs`): time to ready, shader programs compiled *after* ready (a visible freeze, worst in Safari), long frames. `--cold` rewrites every shader so the GPU driver's own cache cannot help: a true first visit. `--engine webkit` for Safari's behaviour.
3. **Proves nothing changed on screen** (`compare.mjs`): the same views before and after, side by side, 1:1 crops and a pixel difference.
4. **Gives you the fixes as drop-in modules** (`src/`): `joinStill` / `batchStill` / `<Still>` (fewer draw calls for things that never move), a depth-aware upsample for half-size screen effects, `compileComposer` (post-processing compiled during the warm-up, not in the first frame), and the page hook the scripts use.
5. **Keeps to one rule:** no visible quality is traded for speed without your yes. No automatic resolution scaling.

## Install

**As a Claude Code plugin** (from inside Claude Code):

```
/plugin marketplace add skyeyesec333/three-perf
/plugin install three-perf@three-perf
```

**Or as a plain skill:**

```sh
git clone https://github.com/skyeyesec333/three-perf
cp -r three-perf/skills/three-perf ~/.claude/skills/
```

## Use

Ask in a three.js project:

- "The garden view drops frames, find out why"
- "Safari freezes for a moment after the loader, fix it"
- "Prove the batching changed nothing on screen"
- "Make the loading count honest"

or call it: `/three-perf` (`/three-perf:three-perf` as a plugin).

The scripts also run on their own, against your dev server:

```sh
npm i -D playwright-core
node skills/three-perf/scripts/frametime.mjs --runs 3 http://localhost:5173/
node skills/three-perf/scripts/warmup.mjs --cold --runs 3 http://localhost:5173/
node skills/three-perf/scripts/compare.mjs "http://localhost:5173/?off=batch" "http://localhost:5173/"
```

For exact GPU numbers install the page hook (`src/perfHook.js`, or `src/PerfHook.jsx` for R3F) in development builds; without it `frametime.mjs` falls back to frame pacing and says so.

## Requirements

- [Claude Code](https://claude.com/claude-code)
- Node.js 18+ and Playwright (`playwright-core`), with Google Chrome installed (or Playwright's Chromium); Playwright's WebKit for `--engine webkit`
- three.js r150+ for the `src/` modules; `@react-three/fiber` for the `.jsx` ones

## Licence

MIT. See [LICENSE](LICENSE).
