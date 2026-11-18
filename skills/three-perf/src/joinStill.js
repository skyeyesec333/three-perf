/* Fewer draw calls for things that never move, with the same picture to the triangle.
   Copy into your app. Needs three (r150+) and three/examples/jsm/utils/BufferGeometryUtils.js.

   joinStill(root, opts)        a model you know is rigid (a prop of 200 bolted parts): its parts that share a
                                material (and the same layers, render order and shadow flags) become one mesh each.
                                The originals are removed. Returns { joined, made, undo }.
   batchStill(root, gl, moved)  a whole place built piece by piece, where nothing says what is still: pass the set of
                                meshes you saw move (Still.jsx watches for you). The originals are hidden, not removed,
                                so they still answer the pointer and your framework still owns them.
                                Returns { seen, joined, made, undo }.

   Both leave alone: see-through, skinned, instanced, batched or morphing meshes, multi-material meshes, invisible
   things, and meshes without positions and normals. Each joined mesh copies its parts' layers, render order and
   castShadow / receiveShadow (parts that differ in any of these are never joined together).

   joinStill only: a part's children are moved (attach(), so they keep their place in the world) to the part's
   parent before the part is removed, so a light, an empty or a see-through child under a joined part stays.
   Geometry of removed parts is disposed once nothing left in the scene uses it ({ keepRemoved: true } to skip).

   batchStill only, also left exactly as they were: meshes that have children (hiding a mesh hides its children, and
   moving them would fight your framework), custom ShaderMaterials (they may read the mesh's own coordinates, which
   joining changes), materials whose compiled vertex shader has wind or time inputs (plants that sway in their own
   space), anything with a pointer handler on it or above it, anything marked userData.live (things that move only
   now and then: mark them!), anything in the `moved` set, and groups of one.

   undo() puts things back and frees what was made: joined meshes removed and their geometry disposed; for
   batchStill the originals shown again; for joinStill the removed parts put back under their old parents (their
   geometry is kept until undo when keepRemoved is set; otherwise undo cannot restore them and says so).
   Call it when the scene unmounts (Still.jsx does). */
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

const flagsKey = (o) => [o.layers.mask, o.renderOrder, +o.castShadow, +o.receiveShadow].join("|");
const copyFlags = (to, from) => { to.layers.mask = from.layers.mask; to.renderOrder = from.renderOrder; to.castShadow = from.castShadow; to.receiveShadow = from.receiveShadow; };

export function joinStill(root, { keepRemoved = false } = {}) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert(), m = new THREE.Matrix4(), groups = new Map(), gone = [];
  root.traverse((o) => {
    if (!o.isMesh || o.isSkinnedMesh || o.isInstancedMesh || o.isBatchedMesh || Array.isArray(o.material) || o.material.transparent || o.geometry.morphAttributes?.position || !o.visible) return;
    const src = o.geometry, names = ATTRS.filter((n) => src.attributes[n]);
    if (!src.attributes.position || !src.attributes.normal) return;
    const key = o.material.uuid + "|" + names.join(",") + "|" + (src.attributes.color?.itemSize || 0) + "|" + flagsKey(o);
    m.multiplyMatrices(inv, o.matrixWorld);
    (groups.get(key) || groups.set(key, { mat: o.material, first: o, list: [] }).get(key)).list.push(placed(src, names, m));
    gone.push(o);
  });
  const removed = [];
  for (const o of gone) {
    const parent = o.parent;
    for (const c of [...o.children]) parent.attach(c);   /* children stay where they are in the world */
    removed.push({ o, parent });
    parent.remove(o);
  }
  const made = [];
  for (const { mat, first, list } of groups.values()) {
    const geo = list.length > 1 ? mergeGeometries(list) : list[0];
    if (list.length > 1) for (const g of list) g.dispose();   /* the per-part copies are merged: free them */
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = "joined"; copyFlags(mesh, first); root.add(mesh); made.push(mesh);
  }
  /* Free removed parts' geometry unless something still in the scene uses it (a GLTF can share one geometry). */
  if (!keepRemoved) {
    let top = root; while (top.parent) top = top.parent;
    const inUse = new Set(); top.traverse((o) => o.geometry && inUse.add(o.geometry));
    for (const g of new Set(removed.map((r) => r.o.geometry))) if (!inUse.has(g)) g.dispose();
  }
  return {
    joined: gone.length, made: made.length,
    undo() {
      for (const mesh of made) { mesh.removeFromParent(); mesh.geometry.dispose(); }
      made.length = 0;
      if (!keepRemoved) { console.warn("joinStill undo: the joined meshes are gone, but the removed parts were disposed; reload them, or join with { keepRemoved: true } to be able to undo"); return; }
      for (const { o, parent } of removed) parent.add(o);
    },
  };
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
    if (o.children.length) return;   /* hiding it would hide its children too */
    if (mat.transparent || !(mat.isMeshStandardMaterial || mat.isMeshLambertMaterial || mat.isMeshBasicMaterial || mat.isMeshPhongMaterial) || isWindy(mat)) return;
    for (let p = o; p && p !== root.parent; p = p.parent) if (!p.visible || p.userData.live || p.userData.joined || isListening(p)) return;
    const names = ATTRS.filter((n) => src.attributes[n]);
    const key = [mat.uuid, names.join(","), src.attributes.color?.itemSize || 0, o.layers.mask, o.renderOrder, +o.castShadow, +o.receiveShadow].join("|");
    (groups.get(key) || groups.set(key, { mat, names, list: [] }).get(key)).list.push(o);
  });
  let joined = 0;
  const made = [], hidden = [];
  for (const { mat, names, list } of groups.values()) {
    if (list.length < 2) continue;
    const parts = list.map((o) => placed(o.geometry, names, m.multiplyMatrices(inv, o.matrixWorld)));
    const merged = mergeGeometries(parts);
    for (const g of parts) g.dispose();
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, mat);
    mesh.name = "joined"; mesh.userData.joined = true; copyFlags(mesh, list[0]);
    mesh.raycast = () => {};                                   /* the hidden originals keep answering the pointer */
    root.add(mesh); made.push(mesh);
    for (const o of list) { o.visible = false; o.userData.joinedAway = true; hidden.push(o); joined++; }
  }
  return {
    seen, joined, made: made.length,
    undo() {   /* show the originals again and free the merged geometry (R3F does not own it) */
      for (const mesh of made) { mesh.removeFromParent(); mesh.geometry.dispose(); }
      for (const o of hidden) { o.visible = true; delete o.userData.joinedAway; }
      made.length = 0; hidden.length = 0;
    },
  };
}
