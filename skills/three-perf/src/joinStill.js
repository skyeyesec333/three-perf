/* Fewer draw calls for things that never move, with the same picture to the triangle.
   Copy into your app. Needs three (r150+) and three/examples/jsm/utils/BufferGeometryUtils.js.

   joinStill(root)              a model you know is rigid (a prop of 200 bolted parts): its parts that share a
                                material become one mesh each. The originals are removed.
   batchStill(root, gl, moved)  a whole place built piece by piece, where nothing says what is still: pass the set of
                                meshes you saw move (Still.jsx watches for you). The originals are hidden, not removed,
                                so they still answer the pointer and your framework still owns them.

   Left exactly as they were: see-through, skinned, instanced, batched or morphing meshes, multi-material meshes,
   custom ShaderMaterials (they may read the mesh's own coordinates, which joining changes), materials whose compiled
   vertex shader has wind or time inputs (plants that sway in their own space), anything with a pointer handler on it
   or above it, anything marked userData.live (things that move only now and then: mark them!), invisible things,
   and groups of one. Each joined mesh keeps the first part's layers, render order and shadow flags. */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

const ATTRS = ["position", "normal", "uv", "uv1", "uv2", "tangent", "color"];
/* Vertex-shader uniforms that mean "this moves in its own space". Extend for your own shaders. */
export const WINDY = /uniform\s+float\s+[^;]*\b(uTime|time|uWind|uSway|uRustle)\b/;

const plain = (attr, size) => {   /* quantised models store these as small integers: make them plain floats first */
  const out = new Float32Array(attr.count * size);
  for (let i = 0; i < attr.count; i++) for (let k = 0; k < size; k++) out[i * size + k] = attr.getComponent(i, k);
  return new THREE.BufferAttribute(out, size);
};
function placed(src, names, m) {
  const g = new THREE.BufferGeometry();
  for (const n of names) g.setAttribute(n, plain(src.attributes[n], src.attributes[n].itemSize));
  g.setIndex(src.index ? Array.from(src.index.array) : Array.from({ length: src.attributes.position.count }, (_, i) => i));
  g.applyMatrix4(m);
  if (m.determinant() < 0) { const ix = g.index.array; for (let i = 0; i < ix.length; i += 3) { const t = ix[i]; ix[i] = ix[i + 1]; ix[i + 1] = t; } }   /* mirrored: keep faces outward */
  return g;
}

export function joinStill(root) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert(), m = new THREE.Matrix4(), groups = new Map(), gone = [];
  root.traverse((o) => {
    if (!o.isMesh || o.isSkinnedMesh || o.isInstancedMesh || o.isBatchedMesh || Array.isArray(o.material) || o.material.transparent || o.geometry.morphAttributes?.position || !o.visible) return;
    const src = o.geometry, names = ATTRS.filter((n) => src.attributes[n]);
    if (!src.attributes.position || !src.attributes.normal) return;
    const key = o.material.uuid + "|" + names.join(",") + "|" + (src.attributes.color?.itemSize || 0);
    m.multiplyMatrices(inv, o.matrixWorld);
    (groups.get(key) || groups.set(key, { mat: o.material, list: [] }).get(key)).list.push(placed(src, names, m));
    gone.push(o);
  });
  for (const o of gone) o.parent.remove(o);
  for (const { mat, list } of groups.values()) {
    const mesh = new THREE.Mesh(list.length > 1 ? mergeGeometries(list) : list[0], mat);
    mesh.name = "joined"; root.add(mesh);
  }
  return root;
}

/* isListening(o): does this object take pointer events? The default knows React Three Fiber's handlers. */
const r3fListens = (o) => !!(o.__r3f && (o.__r3f.eventCount > 0 || Object.keys(o.__r3f.handlers || {}).length));

export function batchStill(root, gl, moved = new Set(), { windy = WINDY, isListening = r3fListens } = {}) {
  root.updateMatrixWorld(true);
  const ctx = gl.getContext(), inv = new THREE.Matrix4().copy(root.matrixWorld).invert(), m = new THREE.Matrix4(), groups = new Map(), sway = new Map();
  const isWindy = (mat) => {
    if (sway.has(mat)) return sway.get(mat);
    const prog = gl.properties.get(mat).currentProgram; let v = true;   /* never compiled yet: not known to be safe */
    if (prog && prog.vertexShader) v = windy.test(ctx.getShaderSource(prog.vertexShader) || "");
    sway.set(mat, v); return v;
  };
  let seen = 0;
  root.traverse((o) => {
    if (!o.isMesh) return; seen++;
    const mat = o.material, src = o.geometry;
    if (o.isSkinnedMesh || o.isInstancedMesh || o.isBatchedMesh || Array.isArray(mat) || moved.has(o) || src.morphAttributes?.position || !src.attributes.position || !src.attributes.normal) return;
    if (mat.transparent || !(mat.isMeshStandardMaterial || mat.isMeshLambertMaterial || mat.isMeshBasicMaterial || mat.isMeshPhongMaterial) || isWindy(mat)) return;
    for (let p = o; p && p !== root.parent; p = p.parent) if (!p.visible || p.userData.live || p.userData.joined || isListening(p)) return;
    const names = ATTRS.filter((n) => src.attributes[n]);
    const key = [mat.uuid, names.join(","), src.attributes.color?.itemSize || 0, o.layers.mask, o.renderOrder, +o.castShadow, +o.receiveShadow].join("|");
    (groups.get(key) || groups.set(key, { mat, names, list: [] }).get(key)).list.push(o);
  });
  let joined = 0, made = 0;
  for (const { mat, names, list } of groups.values()) {
    if (list.length < 2) continue;
    const merged = mergeGeometries(list.map((o) => placed(o.geometry, names, m.multiplyMatrices(inv, o.matrixWorld))));
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, mat), first = list[0];
    mesh.name = "joined"; mesh.userData.joined = true; mesh.layers.mask = first.layers.mask; mesh.renderOrder = first.renderOrder;
    mesh.castShadow = first.castShadow; mesh.receiveShadow = first.receiveShadow;
    mesh.raycast = () => {};                                   /* the hidden originals keep answering the pointer */
    root.add(mesh); made++;
    for (const o of list) { o.visible = false; o.userData.joinedAway = true; joined++; }
  }
  return { seen, joined, made };
}
