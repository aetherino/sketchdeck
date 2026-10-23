import * as THREE from "three";

/**
 * Uniforms shared by every line material. The stage updates them on resize.
 * `uPixelScale` converts stage pixels (the 1920×1080 logical stage) to device
 * pixels, so a 2px stroke is 2px of the stage at any window size.
 */
export const lineGlobals = {
  uResolution: { value: new THREE.Vector2(1920, 1080) },
  uPixelScale: { value: 1 },
};

const vertex = /* glsl */ `
  attribute vec3 iStart;
  attribute vec3 iEnd;
  attribute vec2 iDist;
  attribute vec2 iArc;

  uniform vec2 uResolution;
  uniform float uPixelScale;
  uniform float uWidth;
  uniform float uWidthScale;
  uniform float uDepthBias;

  varying vec2 vPos;
  varying float vLen;
  varying vec2 vDist;
  varying vec2 vArc;
  varying float vHalf;

  vec4 clip(vec3 p) {
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    // Pull lines slightly toward the camera so jitter never sinks into faces.
    // The bias is in local units, so miniature (scaled) scenes get a smaller one.
    mv.z += uDepthBias * length(modelViewMatrix[0].xyz);
    return projectionMatrix * mv;
  }

  void main() {
    vec4 c0 = clip(iStart);
    vec4 c1 = clip(iEnd);
    vec2 s0 = (c0.xy / c0.w * 0.5 + 0.5) * uResolution;
    vec2 s1 = (c1.xy / c1.w * 0.5 + 0.5) * uResolution;
    vec2 d = s1 - s0;
    float len = length(d);
    vec2 dir = len > 1e-4 ? d / len : vec2(1.0, 0.0);
    vec2 nrm = vec2(-dir.y, dir.x);

    float hw = uWidth * uWidthScale * uPixelScale * 0.5;
    float pad = hw + 1.0;
    float along = position.y < 0.5 ? -pad : len + pad;
    vec2 p = s0 + dir * along + nrm * position.x * pad;

    vPos = vec2(along, position.x * pad);
    vLen = len;
    vDist = iDist;
    vArc = iArc;
    vHalf = hw;

    vec4 c = mix(c0, c1, position.y);
    c.xy = (p / uResolution * 2.0 - 1.0) * c.w;
    gl_Position = c;
  }
`;

const fragment = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uFadeColor;
  uniform float uFade;
  uniform float uProgress;
  uniform float uOpacity;
  uniform vec2 uDash;

  varying vec2 vPos;
  varying float vLen;
  varying vec2 vDist;
  varying vec2 vArc;
  varying float vHalf;

  // Fade in perceptual (sRGB) space, so dimming looks equally strong on light
  // and dark pages.
  vec3 toSRGB(vec3 c) { return pow(c, vec3(1.0 / 2.2)); }
  vec3 toLinear(vec3 c) { return pow(c, vec3(2.2)); }

  void main() {
    float t = clamp(vPos.x, 0.0, vLen);
    float k = vLen > 0.0 ? t / vLen : 0.0;
    if (mix(vDist.x, vDist.y, k) > uProgress) discard;
    // Dashes are measured in world units along each polyline.
    if (uDash.x > 0.0 && mod(mix(vArc.x, vArc.y, k), uDash.x + uDash.y) > uDash.x) discard;
    // Distance to the segment gives round caps and joins for free.
    float dist = length(vec2(vPos.x - t, vPos.y));
    float alpha = 1.0 - smoothstep(vHalf - 0.5, vHalf + 0.5, dist);
    if (alpha <= 0.0) discard;
    vec3 color = toLinear(mix(toSRGB(uColor), toSRGB(uFadeColor), uFade));
    gl_FragColor = vec4(color, alpha * uOpacity);
    // Colors are stored linear; convert to the output color space like built-in materials do.
    #include <colorspace_fragment>
  }
`;

export interface FatLinesOptions {
  color: THREE.ColorRepresentation;
  /** Stroke width in stage pixels. */
  width: number;
  depthBias?: number;
  /** [dash, gap] in world units. */
  dash?: [number, number];
  /** Draw on top of everything (labels, badges). */
  overlay?: boolean;
}

/**
 * Constant-pixel-width polylines drawn as instanced quads, one per segment.
 * Each segment knows where it falls in the drawing order (0..1 across all
 * polylines), so `progress` reveals strokes in sequence like a pen.
 */
export class FatLines extends THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial> {
  constructor(polylines: THREE.Vector3[][], opts: FatLinesOptions) {
    const lengths = polylines.map((l) => {
      let s = 0;
      for (let i = 1; i < l.length; i++) s += l[i].distanceTo(l[i - 1]);
      return s;
    });
    const total = lengths.reduce((a, b) => a + b, 0) || 1;
    const segCount = polylines.reduce((n, l) => n + Math.max(0, l.length - 1), 0);

    const start = new Float32Array(segCount * 3);
    const end = new Float32Array(segCount * 3);
    const dist = new Float32Array(segCount * 2);
    const arc = new Float32Array(segCount * 2);
    let i = 0;
    let acc = 0;
    for (const l of polylines) {
      let along = 0;
      for (let j = 1; j < l.length; j++) {
        const a = l[j - 1];
        const b = l[j];
        const len = a.distanceTo(b);
        const d0 = acc / total;
        acc += len;
        start.set([a.x, a.y, a.z], i * 3);
        end.set([b.x, b.y, b.z], i * 3);
        dist.set([d0, acc / total], i * 2);
        arc.set([along, along + len], i * 2);
        along += len;
        i++;
      }
    }

    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute([-1, 0, 0, 1, 0, 0, -1, 1, 0, 1, 1, 0], 3));
    geo.setIndex([0, 1, 2, 2, 1, 3]);
    geo.setAttribute("iStart", new THREE.InstancedBufferAttribute(start, 3));
    geo.setAttribute("iEnd", new THREE.InstancedBufferAttribute(end, 3));
    geo.setAttribute("iDist", new THREE.InstancedBufferAttribute(dist, 2));
    geo.setAttribute("iArc", new THREE.InstancedBufferAttribute(arc, 2));
    geo.instanceCount = segCount;

    const mat = new THREE.ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      uniforms: {
        ...lineGlobals,
        uColor: { value: new THREE.Color(opts.color) },
        uWidth: { value: opts.width },
        uWidthScale: { value: 1 },
        uFade: { value: 0 },
        uFadeColor: { value: new THREE.Color(0xffffff) },
        uDepthBias: { value: opts.depthBias ?? 0.12 },
        uProgress: { value: 1 },
        uOpacity: { value: 1 },
        uDash: { value: new THREE.Vector2(...(opts.dash ?? [0, 0])) },
      },
      depthTest: !opts.overlay,
      depthWrite: !opts.overlay,
      // Overlays join the transparent queue so they draw after translucent planes.
      transparent: !!opts.overlay,
      alphaToCoverage: true,
      // Quads are built in screen space; their winding depends on direction.
      side: THREE.DoubleSide,
    });

    super(geo, mat);
    this.frustumCulled = false;
    if (opts.overlay) this.renderOrder = 11;
  }

  get progress(): number {
    return this.material.uniforms.uProgress.value;
  }
  set progress(v: number) {
    // Slightly past 1 so the final segment's far cap is never clipped.
    this.material.uniforms.uProgress.value = v >= 1 ? 1.01 : v;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
