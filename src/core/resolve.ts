import type { Color, Deck, Element, Layer } from "../schema/deck";
import { ROOT, scopesOf } from "./validate";

// Turns a validated deck into world-space geometry. Pure: no three.js, so the
// CLI lint can reuse it. World axes: x right, y up, z toward the viewer.
// A deck position (x, y) on a layer at height h is world (x, h, -y).

export type V3 = [number, number, number];

/** Horizontal footprint around an element's center, used for arrow anchors. */
export type Footprint = { type: "rect"; hw: number; hd: number } | { type: "circle"; r: number };

export interface ResolvedLayer {
  id: string;
  label?: string;
  tint: Color;
  y: number;
  /** World [x0, z0, x1, z1]. */
  bounds: [number, number, number, number];
}

type Shape = Exclude<Element, { kind: "arrow" } | { kind: "group" }>;

export interface ResolvedShape {
  el: Shape;
  layer: string;
  /** Bottom center, on the layer. */
  pos: V3;
  footprint: Footprint;
  height: number;
}

export interface ResolvedGroup {
  el: Extract<Element, { kind: "group" }>;
  layer: string;
  y: number;
  bounds: [number, number, number, number];
}

export interface ResolvedArrow {
  el: Extract<Element, { kind: "arrow" }>;
  from: V3;
  to: V3;
}

/** Local scope coordinates → world: world = offset + local × scale. */
export interface Transform {
  scale: number;
  offset: V3;
}

/** One scene: the deck itself, or the inside of a box, in its own coordinates. */
export interface ResolvedScope {
  id: string;
  parent?: string;
  transform: Transform;
  layers: ResolvedLayer[];
  shapes: ResolvedShape[];
  groups: ResolvedGroup[];
  arrows: ResolvedArrow[];
}

export interface ResolvedScene {
  title: string;
  theme: Deck["theme"];
  /** Root first, then every child scene. */
  scopes: ResolvedScope[];
}

export function toWorld(t: Transform, p: V3): V3 {
  return [t.offset[0] + p[0] * t.scale, t.offset[1] + p[1] * t.scale, t.offset[2] + p[2] * t.scale];
}

/** How much of a parent box's top face its child scene may cover. */
const CHILD_FILL = 0.82;

/** Gap between an arrow's end and the shape it touches. */
const ARROW_GAP = 0.2;
const LAYER_MARGIN = 1.4;
const snap = (v: number) => Math.round(v * 2) / 2;

function shapeExtent(el: Shape): { footprint: Footprint; height: number } {
  switch (el.kind) {
    case "box":
      return { footprint: { type: "rect", hw: el.size[0] / 2, hd: el.size[1] / 2 }, height: el.height };
    case "database":
      return { footprint: { type: "circle", r: el.size / 2 }, height: el.height };
    case "queue": {
      const [len, dia] = el.size;
      const fp: Footprint = el.along === "x"
        ? { type: "rect", hw: len / 2, hd: dia / 2 }
        : { type: "rect", hw: dia / 2, hd: len / 2 };
      return { footprint: fp, height: dia };
    }
    case "person":
      return { footprint: { type: "circle", r: el.size * 0.25 }, height: el.size };
    case "cloud":
      return { footprint: { type: "circle", r: el.size * 0.42 }, height: el.size * 0.62 };
    case "icon":
      return { footprint: { type: "circle", r: el.size * 0.45 }, height: el.size };
    case "text":
      return { footprint: { type: "circle", r: 0.3 }, height: 0 };
  }
}

/** Distance from center to the footprint's edge along a horizontal direction. */
function edge(fp: Footprint, dx: number, dz: number): number {
  if (fp.type === "circle") return fp.r;
  const tx = Math.abs(dx) > 1e-6 ? fp.hw / Math.abs(dx) : Infinity;
  const tz = Math.abs(dz) > 1e-6 ? fp.hd / Math.abs(dz) : Infinity;
  return Math.min(tx, tz);
}

function footprintBounds(s: ResolvedShape): [number, number, number, number] {
  const [x, , z] = s.pos;
  const hw = s.footprint.type === "rect" ? s.footprint.hw : s.footprint.r;
  const hd = s.footprint.type === "rect" ? s.footprint.hd : s.footprint.r;
  return [x - hw, z - hd, x + hw, z + hd];
}

function union(a: [number, number, number, number], b: [number, number, number, number]): [number, number, number, number] {
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
}

function anchorArrow(a: ResolvedShape, b: ResolvedShape): { from: V3; to: V3 } {
  let dx = b.pos[0] - a.pos[0];
  let dz = b.pos[2] - a.pos[2];
  const dist = Math.hypot(dx, dz);
  if (dist > 1e-6) {
    dx /= dist;
    dz /= dist;
  }

  if (Math.abs(a.pos[1] - b.pos[1]) < 1e-6) {
    // Same layer: leave each footprint's edge at half the lower one's height.
    const y = a.pos[1] + Math.max(0.15, Math.min(a.height, b.height) * 0.5);
    const ea = edge(a.footprint, dx, dz) + ARROW_GAP;
    const eb = edge(b.footprint, -dx, -dz) + ARROW_GAP;
    return {
      from: [a.pos[0] + dx * ea, y, a.pos[2] + dz * ea],
      to: [b.pos[0] - dx * eb, y, b.pos[2] - dz * eb],
    };
  }

  // Across layers: leave the underside of the upper shape and land on top of
  // the lower one, each nudged toward the other so diagonals read clearly.
  const downward = a.pos[1] > b.pos[1];
  const nudge = (s: ResolvedShape, sign: number) => {
    const n = Math.min(dist * 0.25, edge(s.footprint, sign * dx, sign * dz) * 0.6);
    return [s.pos[0] + sign * dx * n, s.pos[2] + sign * dz * n];
  };
  let [ax, az] = nudge(a, 1);
  let [bx, bz] = nudge(b, -1);
  // Landing on top of a shape near its center would hit its label: move the
  // landing point toward the back of the top face instead.
  const clearOfLabel = (s: ResolvedShape, x: number, z: number): [number, number] => {
    const hd = s.footprint.type === "rect" ? s.footprint.hd : s.footprint.r;
    return Math.hypot(x - s.pos[0], z - s.pos[2]) < hd * 0.6 ? [x, s.pos[2] - hd * 0.55] : [x, z];
  };
  if (downward) [bx, bz] = clearOfLabel(b, bx, bz);
  else [ax, az] = clearOfLabel(a, ax, az);
  const ay = downward ? a.pos[1] - 0.12 : a.pos[1] + a.height + ARROW_GAP;
  const by = downward ? b.pos[1] + b.height + ARROW_GAP : b.pos[1] - 0.12;
  return { from: [ax, ay, az], to: [bx, by, bz] };
}

type Local = Omit<ResolvedScope, "id" | "parent" | "transform">;

/** Resolve one scene in its own coordinates. */
function resolveLocal(deckLayers: Layer[], elements: Element[]): Local {
  // Layers are listed top to bottom; the bottom one sits at y = 0.
  const heights = new Map<string, number>();
  let y = 0;
  for (let i = deckLayers.length - 1; i >= 0; i--) {
    heights.set(deckLayers[i].id, y);
    y += deckLayers[i].gap;
  }
  const onlyLayer = deckLayers.length === 1 ? deckLayers[0].id : undefined;

  const shapes: ResolvedShape[] = [];
  const byId = new Map<string, ResolvedShape>();
  for (const el of elements) {
    if (el.kind === "arrow" || el.kind === "group") continue;
    const layer = (el.layer ?? onlyLayer)!;
    const { footprint, height } = shapeExtent(el);
    const s: ResolvedShape = { el, layer, pos: [snap(el.at[0]), heights.get(layer)!, -snap(el.at[1])], footprint, height };
    shapes.push(s);
    byId.set(el.id, s);
  }

  const groups: ResolvedGroup[] = [];
  for (const el of elements) {
    if (el.kind !== "group") continue;
    const layer = (el.layer ?? onlyLayer)!;
    let b = footprintBounds(byId.get(el.contains[0])!);
    for (const id of el.contains.slice(1)) b = union(b, footprintBounds(byId.get(id)!));
    const p = el.padding;
    groups.push({ el, layer, y: heights.get(layer)!, bounds: [b[0] - p, b[1] - p, b[2] + p, b[3] + p] });
  }

  const arrows: ResolvedArrow[] = [];
  for (const el of elements) {
    if (el.kind !== "arrow") continue;
    arrows.push({ el, ...anchorArrow(byId.get(el.from)!, byId.get(el.to)!) });
  }

  // By default every plane shares one footprint that fits all content, so the
  // stack reads as aligned sheets.
  let fit: [number, number, number, number] = [-4, -3, 4, 3];
  const all = [...shapes.map(footprintBounds), ...groups.map((g) => g.bounds)];
  if (all.length) fit = all.reduce(union);
  const m = LAYER_MARGIN;
  const shared: [number, number, number, number] = [fit[0] - m, fit[1] - m, fit[2] + m, fit[3] + m];

  const layers: ResolvedLayer[] = deckLayers.map((l) => ({
    id: l.id,
    label: l.label,
    tint: l.tint,
    y: heights.get(l.id)!,
    bounds: l.bounds ? [l.bounds[0], -l.bounds[3], l.bounds[2], -l.bounds[1]] : shared,
  }));

  return { layers, shapes, groups, arrows };
}

export function resolve(deck: Deck): ResolvedScene {
  const scopes: ResolvedScope[] = [];
  const byId = new Map<string, ResolvedScope>();
  for (const sc of scopesOf(deck)) {
    const local = resolveLocal(sc.layers, sc.elements);
    let transform: Transform = { scale: 1, offset: [0, 0, 0] };
    if (sc.parent) {
      // Stand the child scene on its parent box's top face, scaled to fit.
      const parent = byId.get(sc.parent)!;
      const box = parent.shapes.find((s) => s.el.id === sc.id)!;
      const fp = box.footprint as Extract<Footprint, { type: "rect" }>;
      let b = local.layers[0].bounds;
      for (const l of local.layers) b = union(b, l.bounds);
      const s = Math.min((fp.hw * 2 * CHILD_FILL) / (b[2] - b[0]), (fp.hd * 2 * CHILD_FILL) / (b[3] - b[1]));
      const top = toWorld(parent.transform, [box.pos[0], box.pos[1] + box.height + 0.01, box.pos[2]]);
      const scale = parent.transform.scale * s;
      const cx = (b[0] + b[2]) / 2;
      const cz = (b[1] + b[3]) / 2;
      transform = { scale, offset: [top[0] - cx * scale, top[1], top[2] - cz * scale] };
    }
    const scope: ResolvedScope = { id: sc.id, parent: sc.parent, transform, ...local };
    scopes.push(scope);
    byId.set(sc.id, scope);
  }
  return { title: deck.title, theme: deck.theme, scopes };
}

export { ROOT };
