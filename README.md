# three-perf

Makes a three.js 3D website run faster and load without freezing, while keeping it looking exactly the same.

It came out of tuning a heavy 3D portfolio scene, where every speed-up had to leave the picture unchanged.

## Good for

- Finding out why a 3D page drops frames or stutters
- Fixing a freeze right after loading, worst in Safari
- Proving a speed-up changed nothing on screen
- Making a loading counter that matches real progress

## Install

In Claude Code, run:

```
/plugin marketplace add skyeyesec333/three-perf
/plugin install three-perf@three-perf
```

Or copy the skill into your own skills folder:

```sh
git clone https://github.com/skyeyesec333/three-perf
cp -r three-perf/skills/three-perf ~/.claude/skills/
```

You can also copy it into one project's `.claude/skills/` folder instead.

## Try asking Claude

In a three.js project:

- "The garden view drops frames, find out why"
- "Safari freezes for a moment after the loader, fix it"
- "Prove the batching changed nothing on screen"
- "Make the loading count honest"

Or call it directly: `/three-perf` (`/three-perf:three-perf` as a plugin).

## You'll need

- [Claude Code](https://claude.com/claude-code)
- Node.js 18+ and Playwright (`playwright-core`), with Google Chrome (or Playwright's Chromium) installed
- Playwright's WebKit for `--engine webkit`
- three.js r150+ for the `src/` modules, and `@react-three/fiber` for the `.jsx` ones

Any http(s) page can be measured, not only localhost. The scripts load it as a visitor would.

## How it works

```
hook → measure (GPU-synced, fixed views) → change one thing behind ?off= → measure → compare pictures → report
```

It keeps to one rule: no visible quality is traded for speed without your yes. It never turns the resolution down automatically.

1. **Measures frame cost properly** (`frametime.mjs`). Each frame of each camera view waits for the graphics card to finish, in an uncapped browser, over several loads. It reports the median and the 90th percentile per view.
2. **Measures the warm-up** (`warmup.mjs`): time to ready, shaders (GPU programs) built *after* ready, and long frames. Late shaders cause a visible freeze, worst in Safari. `--cold` makes every shader new, like a first visit. `--engine webkit` runs Playwright's WebKit, which is close to Safari (confirm in real Safari).
3. **Proves nothing changed on screen** (`compare.mjs`): the same views before and after, side by side, with 1:1 crops and a pixel difference.
4. **Gives you the fixes as drop-in modules** (`src/`):
   - `joinStill` / `batchStill` / `<Still>`: fewer draw calls for things that never move;
   - a depth-aware upsample for effects drawn at half size;
   - `compileComposer`: post-processing built during the warm-up, not in the first frame;
   - the page hook the scripts use.

The scripts also run on their own, against your dev server. The paths are relative to the cloned repo:

```sh
npm i -D playwright-core
node skills/three-perf/scripts/frametime.mjs --runs 3 http://localhost:5173/
node skills/three-perf/scripts/warmup.mjs --cold --runs 3 http://localhost:5173/
node skills/three-perf/scripts/compare.mjs "http://localhost:5173/?off=batch" "http://localhost:5173/"
```

For exact GPU numbers, add the page hook (`src/perfHook.js`, or `src/PerfHook.jsx` for React Three Fiber) to development builds. Without it, `frametime.mjs` falls back to frame pacing and says so.

## Licence

MIT. See [LICENSE](LICENSE).
