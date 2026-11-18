# Making a scene cheaper without making it worse

**The rule:** never trade visible picture quality for frame rate without the owner's explicit yes. That includes automatic resolution scaling (dropping the pixel ratio when frames run slow): on a showcase site the drop is visible and defeats the point of the site. Make the frame cheaper instead. Measure first, change one thing, measure again, compare pictures.

In rough order of payoff on a typical hand-built scene:

## 1. Draw calls: join what never moves

A place built mesh by mesh (walls, steps, lanterns, bolts on a prop) is often hundreds of draw calls for few triangles. Each is CPU work for the browser and driver.

- **A rigid model** (a prop made of 200 parts that only ever moves whole): `joinStill(root)` in `src/joinStill.js` merges the parts that share a material into one mesh each. Same triangles, same picture.
- **A whole place** where nothing says what is still: wrap it in `<Still>` (`src/Still.jsx`, React Three Fiber) or call `batchStill(root, gl, moved)` yourself after watching for movement. It leaves alone anything that moved, is see-through, instanced, skinned, morphing, has a custom shader or wind/time inputs in its vertex shader, listens for the pointer, or is marked `userData.live`.
- **Mark `userData.live`** on things that move rarely (a bird that hops every minute): they may be still during the watch.
- Count with `renderer.info.render.calls` before and after. A real garden went from 601 meshes to 211, about 11.5 to 8.9 ms a frame, with four views identical side by side.
- Not every cost is draw calls: thinning a dense tree's leaves did nothing measurable on the same scene. Measure before you cut.

## 2. Expensive screen effects at half size

Ray-marched light, fog, SSR and similar effects at full resolution are paid per pixel. Draw them at half size and upsample with depth awareness (`src/depthAwareUpsample.js`) so nothing bleeds across edges. Compare at 1:1: if edges halo, raise the depth weight's strictness rather than going back to full size.

## 3. Passes that add nothing here

Contact AO, bloom or DOF that contribute nothing in a given scene or view (underwater, a dark room, a phone) still cost their full price. Turn them off **where** they add nothing, not globally, and check that the picture is unchanged there.

## 4. Branch costly reads on a cheap test

A shader that reads nine texture samples for a rock texture only needed on steep slopes can test the slope first and skip the reads elsewhere. Compute what the test needs (derivatives, slopes) **before** the branch: derivatives inside non-uniform control flow are undefined. Same for "far away": skip detail the fog has already hidden.

## 5. Lights: mount them all up front

three.js builds every lit material's shader for the number and kinds of lights in the scene. A light that mounts later (a lamp in a part of the scene that loads second) makes **every lit shader recompile**, a freeze long after the warm-up. Mount every light at the start (dimmed to zero if it should not show yet) and keep the count fixed.

## 6. Load: what the first view needs, first

- Lazy-load heavy figures and scenes that are not in the first view (`React.lazy` + `Suspense`, or a dynamic `import()` on demand). Start the fetch on hover/intent so it is warm by the click.
- Give anything off-screen a one-pixel stand-in texture until the real one arrives (but keep its lights and material kinds mounted, see 5).
- Compress where the host does not: some CDNs do not compress `application/octet-stream` (custom binary formats); gzip them at build and inflate with `DecompressionStream`.

## 7. The warm-up

Compile before the visitor sees anything: `renderer.compile(scene, camera)` (or `compileAsync`), upload textures (`renderer.initTexture`) in time slices, draw each part once off-screen, then `compileComposer()` for the post-processing. Show it as progress: see [loader.md](loader.md).

## Always

- One `?off=name` switch per optimisation, so before and after are one URL apart.
- `compare.mjs` before claiming "no visible change", and look at the crops yourself.
- Report numbers with the conditions: machine, browser, size, DPR, views, runs.
