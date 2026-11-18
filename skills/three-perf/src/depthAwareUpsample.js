/* Draw an expensive screen effect (light shafts, fog marching, volumetrics, SSR) at half size, then lay it over the
   full picture without bleeding across edges.

   The half-size pass writes its result in .rgb and the linear view depth of that pixel in .a. The upsample reads the
   four nearest half-size pixels and weights each by bilinear position AND by how close its depth is to the
   full-size pixel's own depth, so a bright shaft behind a pillar does not smear onto the pillar's edge.
   Measured on a real scene: a 30-step-per-pixel underwater light march cost 0.6 ms a frame at 1600x813 this way,
   with no visible difference from the full-size pass in side-by-side and 1:1 crops. Always compare (compare.mjs)
   and keep a ?off= switch.

   Two forms of the same shader, both self-contained (no #include needed; perspective cameras):
   - UPSAMPLE_FRAG: a full fragment shader for a three.js ShaderMaterial on a full-screen quad (ShaderPass etc.).
     Uniforms: tInput (the full picture), tHalf, tDepth (a depth texture), uHalfTexel (1 / half size), uNear, uFar,
     uK (strength). Needs a vUv varying from the vertex shader.
   - UPSAMPLE_EFFECT: a mainImage() for the postprocessing library's Effect, which supplies the picture and the depth:
       new Effect("DepthAwareUpsample", UPSAMPLE_EFFECT, {
         attributes: EffectAttribute.DEPTH,
         uniforms: new Map([["tHalf", new Uniform(half.texture)], ["uHalfTexel", new Uniform(new Vector2())],
                            ["uNear", new Uniform(camera.near)], ["uFar", new Uniform(camera.far)], ["uK", new Uniform(1)]]),
       })
     (Keep uNear / uFar in step with the camera. The Effect's own `depth` is the raw depth-buffer value.)
   Half-size target: new WebGLRenderTarget(w >> 1, h >> 1, { type: HalfFloatType, depthBuffer: false,
   minFilter: NearestFilter, magFilter: NearestFilter }). In the march pass write gl_FragColor = vec4(light, -viewZ). */
const COMMON = /* glsl */ `
uniform sampler2D tHalf;
uniform vec2 uHalfTexel;
uniform float uNear, uFar, uK;
/* view-space distance from a [0,1] perspective depth-buffer value (three's perspectiveDepthToViewZ, negated) */
float tpViewDist(float d) { return (uNear * uFar) / (uFar - (uFar - uNear) * d); }
vec3 tpUpsample(vec2 uv, float d) {
  float z = tpViewDist(d);
  vec2 p = uv / uHalfTexel - 0.5, f = fract(p), b = (floor(p) + 0.5) * uHalfTexel;
  vec3 sum = vec3(0.0); float ws = 0.0;
  for (int j = 0; j < 2; j++) for (int i = 0; i < 2; i++) {
    vec4 h = texture2D(tHalf, b + vec2(float(i), float(j)) * uHalfTexel);
    float wb = (i == 0 ? 1.0 - f.x : f.x) * (j == 0 ? 1.0 - f.y : f.y);
    /* depth weight: tolerant in the distance, strict up close */
    float w = wb * exp(-abs(h.a - z) / (0.04 * z + 0.05)) + 1e-4 * wb;
    sum += h.rgb * w; ws += w;
  }
  return sum / max(ws, 1e-5) * uK;
}`;

export const UPSAMPLE_FRAG = /* glsl */ `
uniform sampler2D tInput, tDepth;
varying vec2 vUv;
${COMMON}
void main() {
  vec4 base = texture2D(tInput, vUv);
  gl_FragColor = vec4(base.rgb + tpUpsample(vUv, texture2D(tDepth, vUv).r), base.a);
}`;

export const UPSAMPLE_EFFECT = /* glsl */ `
${COMMON}
void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  outputColor = vec4(inputColor.rgb + tpUpsample(uv, depth), inputColor.a);
}`;
