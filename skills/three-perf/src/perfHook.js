/* The page hook the measuring scripts talk to. Install it in development builds only.

   Plain three.js:
     import { installPerfHook } from "./perfHook.js";
     installPerfHook({ renderer, render: () => composer.render(), views: [
       { name: "front", set: () => { camera.position.set(0, 2, 8); camera.lookAt(0, 1, 0); } },
       { name: "garden", set: () => { ... } },
     ]});
   Call it once the scene is ready to be measured (everything loaded and compiled): the scripts wait for it.

   render() must draw one complete frame the way the app does (the composer, not just renderer.render) and must not
   depend on the clock: pause your animation loop while measuring, or the frame you time is not the frame you set. */
export function installPerfHook({ renderer, render, views = [{ name: "default", set: () => {} }], pause, resume } = {}) {
  if (typeof window === "undefined") return;
  if (!renderer || typeof render !== "function") throw new Error("installPerfHook needs { renderer, render }");
  let paused = false;
  window.__threePerf = {
    gl: renderer.getContext(),
    views: views.map((v, i) => String(v.name ?? i)),
    async setView(i) {
      const v = views[i]; if (!v) throw new Error(`no view ${i}`);
      if (!paused && pause) { pause(); paused = true; }
      await v.set();
    },
    render() { render(); },
    done() { if (paused && resume) { resume(); paused = false; } },
  };
}

/* ?off=a,b switches: every optimisation gets one, so before and after are one URL apart (compare.mjs). */
export const off = (name) => typeof location !== "undefined" && (new URLSearchParams(location.search).get("off") || "").split(",").includes(name);
