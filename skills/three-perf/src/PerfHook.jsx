/* <PerfHook> for React Three Fiber: the same hook as perfHook.js, from inside the Canvas.

     {import.meta.env.DEV && ready && (
       <PerfHook composer={composerRef} views={[
         { name: "front", position: [0, 2, 8], target: [0, 1, 0] },
         { name: "low", position: [3, 0.4, 5], target: [0, 1.2, 0], fov: 40 },
       ]} />
     )}

   Mount it only when the scene is ready to be measured; the scripts wait for window.__threePerf. While a view is
   set, R3F's own loop is stopped (frameloop "never") so the timed frame is the one you set; done() restores it.
   Without a composer it times gl.render(scene, camera). */
import { useThree } from "@react-three/fiber";
import { useEffect } from "react";
import { installPerfHook } from "./perfHook.js";

export default function PerfHook({ composer, views }) {
  const { gl, scene, camera, setFrameloop, frameloop } = useThree();
  useEffect(() => {
    const was = frameloop;
    installPerfHook({
      renderer: gl,
      render: () => { const c = composer?.current; c ? c.render(0) : gl.render(scene, camera); },
      views: (views || [{ name: "default" }]).map((v) => ({
        name: v.name,
        set: () => {
          if (v.position) camera.position.set(...v.position);
          if (v.fov && camera.isPerspectiveCamera) camera.fov = v.fov;
          if (v.target) camera.lookAt(...v.target);
          camera.updateProjectionMatrix(); camera.updateMatrixWorld();
        },
      })),
      pause: () => setFrameloop("never"),
      resume: () => setFrameloop(was),
    });
    return () => { delete window.__threePerf; setFrameloop(was); };
  }, [gl, scene, camera, composer, views]);   // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}
