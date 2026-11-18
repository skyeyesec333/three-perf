/* <Still> for React Three Fiber: watches every mesh inside it from mount, notes whatever moved, and once `ready`
   has been true for `watch` seconds joins the rest by material (batchStill in joinStill.js). Wrap whole places
   (a garden, a street) built mesh by mesh. `disabled` (e.g. from ?off=batch) leaves it as built, to compare.

     <Still ready={sceneHasArrived} watch={2} disabled={off("batch")} onDone={(r) => console.log(r)}>
       <Garden />
     </Still>

   Things that move only now and then (a bird that hops every minute) must carry userData.live, or they may be
   frozen into a batch while they happened to be still. */
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { batchStill } from "./joinStill.js";

export default function Still({ children, ready = true, watch = 2, disabled = false, onDone }) {
  const g = useRef(), gl = useThree((s) => s.gl);
  const st = useRef({ at: new Map(), moved: new Set(), after: 0, done: disabled, undo: null });
  /* On unmount: free the merged geometry and show the originals again (R3F disposes what it made, not what we made). */
  useEffect(() => () => { st.current.undo?.(); st.current.undo = null; }, []);
  useFrame((_, dt) => {
    const s = st.current, root = g.current; if (s.done || !root) return;
    root.updateMatrixWorld();
    root.traverse((o) => {
      if (!o.isMesh || s.moved.has(o)) return;
      const e = o.matrixWorld.elements, was = s.at.get(o);
      if (!was) { s.at.set(o, Float32Array.from(e)); return; }
      for (let i = 0; i < 16; i++) if (Math.abs(was[i] - e[i]) > 1e-6) { s.moved.add(o); return; }
    });
    if (!ready) return;
    s.after += dt; if (s.after < watch) return;
    s.done = true;
    const { undo, ...r } = batchStill(root, gl, s.moved);
    s.undo = undo;
    s.at.clear();
    onDone?.({ ...r, moved: s.moved.size });
  });
  return <group ref={g}>{children}</group>;
}
