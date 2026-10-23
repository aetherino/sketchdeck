// A port of the core of rough.js (https://github.com/rough-stuff/rough, MIT),
// reduced to the parts the sketch style needs. Everything here works in a flat
// 2D "pen space" measured in pixels-at-zoom-1, so rough.js's tuned constants
// carry over unchanged. Mapping onto 3D faces happens in ./frame.ts.

export type V2 = [number, number];
export type Polyline = V2[];
export type Rng = () => number;

export interface RoughOptions {
  roughness: number;
  bowing: number;
  maxRandomnessOffset: number;
  curveFitting: number;
  curveStepCount: number;
  hachureGap: number;
  hachureAngle: number;
}

export const defaultRough: RoughOptions = {
  roughness: 1,
  bowing: 1,
  maxRandomnessOffset: 2,
  curveFitting: 0.95,
  curveStepCount: 9,
  hachureGap: 8,
  hachureAngle: -41,
};

export interface Pen {
  o: RoughOptions;
  rnd: Rng;
}

// mulberry32: tiny, fast, good enough for jitter.
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// FNV-1a, so a seed can come from an element id.
export function hashSeed(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function pen(seed: string | number, o: Partial<RoughOptions> = {}): Pen {
  const n = typeof seed === "string" ? hashSeed(seed) : seed;
  return { o: { ...defaultRough, ...o }, rnd: seededRng(n) };
}

function offset(min: number, max: number, p: Pen, gain = 1): number {
  return p.o.roughness * gain * (p.rnd() * (max - min) + min);
}

function offsetOpt(x: number, p: Pen, gain = 1): number {
  return offset(-x, x, p, gain);
}

type Cubic = [V2, V2, V2, V2];

function sampleCubic([p0, p1, p2, p3]: Cubic, out: Polyline, skipFirst = false): void {
  const chord = Math.hypot(p3[0] - p0[0], p3[1] - p0[1]);
  const n = Math.max(6, Math.ceil(chord / 6));
  for (let i = skipFirst ? 1 : 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
    out.push([
      a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0],
      a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1],
    ]);
  }
}

// rough.js `_line`: one bowed, jittered stroke from a to b as a cubic.
function lineCubic(a: V2, b: V2, p: Pen, overlay: boolean): Cubic {
  const [x1, y1] = a;
  const [x2, y2] = b;
  const lengthSq = (x1 - x2) ** 2 + (y1 - y2) ** 2;
  const length = Math.sqrt(lengthSq);
  let gain = 1;
  if (length < 200) gain = 1;
  else if (length > 500) gain = 0.4;
  else gain = -0.0016668 * length + 1.233334;

  let off = p.o.maxRandomnessOffset;
  if (off * off * 100 > lengthSq) off = length / 10;
  const halfOff = off / 2;
  const diverge = 0.2 + p.rnd() * 0.2;
  let midX = (p.o.bowing * p.o.maxRandomnessOffset * (y2 - y1)) / 200;
  let midY = (p.o.bowing * p.o.maxRandomnessOffset * (x1 - x2)) / 200;
  midX = offsetOpt(midX, p, gain);
  midY = offsetOpt(midY, p, gain);
  const r = () => offsetOpt(overlay ? halfOff : off, p, gain);

  return [
    [x1 + r(), y1 + r()],
    [midX + x1 + (x2 - x1) * diverge + r(), midY + y1 + (y2 - y1) * diverge + r()],
    [midX + x1 + 2 * (x2 - x1) * diverge + r(), midY + y1 + 2 * (y2 - y1) * diverge + r()],
    [x2 + r(), y2 + r()],
  ];
}

/** A hand-drawn line: two overlapping, slightly different strokes. */
export function line(a: V2, b: V2, p: Pen, single = false): Polyline[] {
  const s1: Polyline = [];
  sampleCubic(lineCubic(a, b, p, false), s1);
  if (single) return [s1];
  const s2: Polyline = [];
  sampleCubic(lineCubic(a, b, p, true), s2);
  return [s1, s2];
}

/** Catmull-Rom through points, as rough.js `_curve` (tightness 0). */
function curveThrough(points: V2[], out: Polyline): void {
  if (points.length < 4) return;
  for (let i = 1; i + 2 < points.length; i++) {
    const b0 = points[i];
    const b3 = points[i + 1];
    const b1: V2 = [b0[0] + (points[i + 1][0] - points[i - 1][0]) / 6, b0[1] + (points[i + 1][1] - points[i - 1][1]) / 6];
    const b2: V2 = [b3[0] + (points[i][0] - points[i + 2][0]) / 6, b3[1] + (points[i][1] - points[i + 2][1]) / 6];
    sampleCubic([b0, b1, b2, b3], out, i > 1);
  }
}

function ellipsePoints(
  inc: number, cx: number, cy: number, rx: number, ry: number,
  jitter: number, overlap: number, p: Pen,
): V2[] {
  const pts: V2[] = [];
  const j = () => offsetOpt(jitter, p);
  const rad = offset(0.5, 1, p) * Math.PI * 2 - Math.PI / 2;
  pts.push([j() + cx + 0.9 * rx * Math.cos(rad - inc), j() + cy + 0.9 * ry * Math.sin(rad - inc)]);
  const end = Math.PI * 2 + rad - 0.01;
  for (let a = rad; a < end; a += inc) {
    pts.push([j() + cx + rx * Math.cos(a), j() + cy + ry * Math.sin(a)]);
  }
  pts.push([j() + cx + rx * Math.cos(rad + Math.PI * 2 + overlap * 0.5), j() + cy + ry * Math.sin(rad + Math.PI * 2 + overlap * 0.5)]);
  pts.push([j() + cx + 0.98 * rx * Math.cos(rad + overlap), j() + cy + 0.98 * ry * Math.sin(rad + overlap)]);
  pts.push([j() + cx + 0.9 * rx * Math.cos(rad + overlap * 0.5), j() + cy + 0.9 * ry * Math.sin(rad + overlap * 0.5)]);
  return pts;
}

/** A hand-drawn ellipse: one loose loop with overshoot, plus a second pass. */
export function ellipse(cx: number, cy: number, w: number, h: number, p: Pen): Polyline[] {
  let rx = w / 2;
  let ry = h / 2;
  const psq = Math.sqrt(Math.PI * 2 * Math.sqrt((rx * rx + ry * ry) / 2));
  const steps = Math.ceil(Math.max(p.o.curveStepCount, (p.o.curveStepCount / Math.sqrt(200)) * psq));
  const inc = (Math.PI * 2) / steps;
  const fit = 1 - p.o.curveFitting;
  rx += offsetOpt(rx * fit, p);
  ry += offsetOpt(ry * fit, p);
  const overlap = inc * offset(0.1, offset(0.4, 1, p), p);
  const s1: Polyline = [];
  const s2: Polyline = [];
  curveThrough(ellipsePoints(inc, cx, cy, rx, ry, 1, overlap, p), s1);
  curveThrough(ellipsePoints(inc, cx, cy, rx, ry, 1.5, 0, p), s2);
  return [s1, s2];
}

/**
 * A closed hand-drawn loop through `points`: two passes, each starting at a
 * random point and not quite meeting itself, like a pen going round.
 */
export function closedCurve(points: V2[], p: Pen): Polyline[] {
  const out: Polyline[] = [];
  const n = points.length;
  for (const jitter of [1, 1.5]) {
    const start = Math.floor(p.rnd() * n);
    const seq: V2[] = [];
    for (let i = -1; i <= n + 1; i++) {
      const q = points[(((start + i) % n) + n) % n];
      seq.push([q[0] + offsetOpt(jitter, p), q[1] + offsetOpt(jitter, p)]);
    }
    const s: Polyline = [];
    curveThrough(seq, s);
    out.push(s);
  }
  return out;
}

/**
 * A gentle hand wobble along an existing polyline (for icons, whose shapes
 * must stay recognizable): smooth low-frequency drift, two passes.
 */
export function wobble(points: V2[], p: Pen, amp = 0.7, passes = 2): Polyline[] {
  const out: Polyline[] = [];
  for (let k = 0; k < passes; k++) {
    const f1 = 0.02 + p.rnd() * 0.03;
    const f2 = 0.05 + p.rnd() * 0.05;
    const ph = [p.rnd(), p.rnd(), p.rnd(), p.rnd()].map((v) => v * Math.PI * 2);
    const a = amp * p.o.roughness;
    let s = 0;
    const line: Polyline = [];
    for (let i = 0; i < points.length; i++) {
      if (i > 0) s += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
      line.push([
        points[i][0] + a * (Math.sin(s * f1 + ph[0]) + 0.5 * Math.sin(s * f2 + ph[1])),
        points[i][1] + a * (Math.sin(s * f1 + ph[2]) + 0.5 * Math.sin(s * f2 + ph[3])),
      ]);
    }
    out.push(line);
  }
  return out;
}

/** A rounded corner as a jittered quadratic, in two passes like `line`. */
function corner(a: V2, c: V2, b: V2, p: Pen, single = false): Polyline[] {
  const out: Polyline[] = [];
  for (const overlay of single ? [false] : [false, true]) {
    const k = overlay ? 0.5 : 1;
    const r = () => offsetOpt(p.o.maxRandomnessOffset * 0.5 * k, p);
    const a2: V2 = [a[0] + r(), a[1] + r()];
    const c2: V2 = [c[0] + r(), c[1] + r()];
    const b2: V2 = [b[0] + r(), b[1] + r()];
    // Quadratic expressed as a cubic.
    const cubic: Cubic = [
      a2,
      [a2[0] + (2 / 3) * (c2[0] - a2[0]), a2[1] + (2 / 3) * (c2[1] - a2[1])],
      [b2[0] + (2 / 3) * (c2[0] - b2[0]), b2[1] + (2 / 3) * (c2[1] - b2[1])],
      b2,
    ];
    const s: Polyline = [];
    sampleCubic(cubic, s);
    out.push(s);
  }
  return out;
}

/** Excalidraw's rounded rectangle: four rough sides joined by rough corners. */
export function roundedRect(x: number, y: number, w: number, h: number, r: number, p: Pen, single = false): Polyline[] {
  const out: Polyline[] = [];
  out.push(...line([x + r, y], [x + w - r, y], p, single));
  out.push(...corner([x + w - r, y], [x + w, y], [x + w, y + r], p, single));
  out.push(...line([x + w, y + r], [x + w, y + h - r], p, single));
  out.push(...corner([x + w, y + h - r], [x + w, y + h], [x + w - r, y + h], p, single));
  out.push(...line([x + w - r, y + h], [x + r, y + h], p, single));
  out.push(...corner([x + r, y + h], [x, y + h], [x, y + h - r], p, single));
  out.push(...line([x, y + h - r], [x, y + r], p, single));
  out.push(...corner([x, y + r], [x, y], [x + r, y], p, single));
  return out;
}

/** The smooth outline of a rounded rectangle, for fills and clipping. */
export function roundedRectOutline(x: number, y: number, w: number, h: number, r: number, seg = 6): V2[] {
  const pts: V2[] = [];
  const arc = (cx: number, cy: number, a0: number) => {
    for (let i = 0; i <= seg; i++) {
      const a = a0 + (i / seg) * (Math.PI / 2);
      pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
  };
  arc(x + w - r, y + r, -Math.PI / 2);
  arc(x + w - r, y + h - r, 0);
  arc(x + r, y + h - r, Math.PI / 2);
  arc(x + r, y + r, Math.PI);
  return pts;
}

export function circleOutline(cx: number, cy: number, r: number, seg = 48): V2[] {
  const pts: V2[] = [];
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return pts;
}

/**
 * Hachure fill: parallel scan lines clipped to the polygon (even-odd across
 * all rings, so extra rings cut holes), each drawn as a rough line.
 * `angle` is in degrees, `gap` in pen pixels.
 */
export function hachure(polygon: V2[] | V2[][], p: Pen, gap = p.o.hachureGap, angle = p.o.hachureAngle): Polyline[] {
  const rings = (Array.isArray(polygon[0]?.[0]) ? polygon : [polygon]) as V2[][];
  const rad = (angle * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  // Rotate the rings so hatch lines become horizontal scan lines.
  const rot = rings.map((ring) => ring.map(([x, y]): V2 => [x * cos + y * sin, -x * sin + y * cos]));
  let minY = Infinity;
  let maxY = -Infinity;
  for (const ring of rot) {
    for (const [, y] of ring) {
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  const out: Polyline[] = [];
  for (let y = minY + gap / 2; y < maxY; y += gap) {
    const xs: number[] = [];
    for (const ring of rot) {
      for (let i = 0; i < ring.length; i++) {
        const [ax, ay] = ring[i];
        const [bx, by] = ring[(i + 1) % ring.length];
        if ((ay <= y && by > y) || (by <= y && ay > y)) {
          xs.push(ax + ((y - ay) / (by - ay)) * (bx - ax));
        }
      }
    }
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      // Rotate the segment back into place.
      const a: V2 = [xs[i] * cos - y * sin, xs[i] * sin + y * cos];
      const b: V2 = [xs[i + 1] * cos - y * sin, xs[i + 1] * sin + y * cos];
      out.push(...line(a, b, p));
    }
  }
  return out;
}
