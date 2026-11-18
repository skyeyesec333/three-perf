/* Draw an expensive screen effect (light shafts, fog marching, volumetrics, SSR) at half size, then lay it over the
   full picture without bleeding across edges.

   The half-size pass writes its result in .rgb and the linear view depth of that pixel in .a. The upsample reads the
   four nearest half-size pixels and weights each by bilinear position AND by how close its depth is to the
   full-size pixel's own depth, so a bright shaft behind a pillar does not smear onto the pillar's edge.
   Measured on a real scene: a 30-step-per-pixel underwater light march cost 0.6 ms a frame at 1600x813 this way,
   with no visible difference from the full-size pass in side-by-side and 1:1 crops. Always compare (compare.mjs) and keep a ?off= switch.

   Use the GLSL in your own ShaderMaterial / postprocessing Effect:
     - uniforms: tInput (the full picture), tHalf (half-size result, NEAREST filtered), tDepth (depth texture),
       uHalfTexel (1 / half size), uNear, uFar, uK (strength)
     - needs `#include <packing>` before it for perspectiveDepthToViewZ
   Half-size target: new WebGLRenderTarget(w >> 1, h >> 1, { type: HalfFloatType, depthBuffer: false,
   minFilter: NearestFilter, magFilter: NearestFilter }). In the march pass write gl_FragColor = vec4(light, -viewZ). */
export const UPSAMPLE_FRAG = /* glsl */ `
uniform sampler2D tInput, tHalf, tDepth;
uniform vec2 uHalfTexel;
uniform float uNear, uFar, uK;
varying vec2 vUv;
void main() {
  vec4 base = texture2D(tInput, vUv);
  float z = -perspectiveDepthToViewZ(texture2D(tDepth, vUv).r, uNear, uFar);
  vec2 p = vUv / uHalfTexel - 0.5, f = fract(p), b = (floor(p) + 0.5) * uHalfTexel;
  vec3 sum = vec3(0.0); float ws = 0.0;
  for (int j = 0; j < 2; j++) for (int i = 0; i < 2; i++) {
    vec4 h = texture2D(tHalf, b + vec2(float(i), float(j)) * uHalfTexel);
    float wb = (i == 0 ? 1.0 - f.x : f.x) * (j == 0 ? 1.0 - f.y : f.y);
    /* depth weight: tolerant in the distance, strict up close */
    float w = wb * exp(-abs(h.a - z) / (0.04 * z + 0.05)) + 1e-4 * wb;
    sum += h.rgb * w; ws += w;
  }
  gl_FragColor = vec4(base.rgb + sum / max(ws, 1e-5) * uK, base.a);
}`;
