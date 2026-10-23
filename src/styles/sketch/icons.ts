import * as THREE from "three";
import type { IconName } from "../../schema/deck";
import { FatLines } from "../../render/fatline";
import { clamp01, makeText, setTextOpacity, STROKE } from "./common";
import { Frame } from "./frame";
import data from "./icons.json";
import { pen, wobble, type V2 } from "./rough";
import { mix, type PaletteColor, type Theme } from "./theme";

type IconData = { type: "glyph" | "brand"; lines: { c: number; p: number[] }[] };
const icons = data as Record<string, IconData>;

/** Icons are authored on a 24-unit grid. */
const GRID = 24;

function contours(icon: IconData): { closed: boolean; points: V2[] }[] {
  return icon.lines.map((l) => {
    const points: V2[] = [];
    for (let i = 0; i < l.p.length; i += 2) points.push([l.p[i], l.p[i + 1]]);
    return { closed: l.c === 1, points };
  });
}

function inside([x, y]: V2, poly: V2[]): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/** Filled brand silhouette: nest contours by containment (even-odd). */
function brandShapes(cs: V2[][], toLocal: (p: V2) => THREE.Vector2): THREE.Shape[] {
  const depth = cs.map((c, i) => cs.filter((o, j) => j !== i && inside(c[0], o)).length);
  const shapes: THREE.Shape[] = [];
  cs.forEach((c, i) => {
    if (depth[i] % 2 !== 0) return;
    const shape = new THREE.Shape(c.map(toLocal));
    cs.forEach((h, j) => {
      if (depth[j] === depth[i] + 1 && inside(h[0], c)) shape.holes.push(new THREE.Path(h.map(toLocal)));
    });
    shapes.push(shape);
  });
  return shapes;
}

export interface IconArt {
  group: THREE.Group;
  setDraw(v: number): void;
}

/**
 * An icon drawn in the group's local XY plane, centered on the origin,
 * `size` world units across. Glyphs are inked lines; brands are a tinted
 * silhouette with an inked outline.
 */
export function iconArt(
  name: IconName, size: number, theme: Theme, color: PaletteColor, seed: string, overlay = false,
): IconArt {
  const icon = icons[name];
  const group = new THREE.Group();
  const scale = size / GRID;
  const f = new Frame(new THREE.Vector3(-size / 2, size / 2, 0), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, -1, 0));
  const penScale = Frame.px(scale);
  const p = pen(`${seed}:icon`, { roughness: 1 });

  const strokes = contours(icon).flatMap(({ closed, points }) => {
    const pts = points.map(([x, y]): V2 => [x * penScale, y * penScale]);
    if (closed) pts.push(pts[0]);
    return f.map(wobble(pts, p, icon.type === "brand" ? 0.5 : 0.7, icon.type === "brand" ? 1 : 2));
  });
  const lines = new FatLines(strokes, {
    color: theme.ink,
    width: icon.type === "brand" ? STROKE * 0.75 : STROKE * 0.85,
    overlay,
    depthBias: 0.02,
  });
  group.add(lines);

  let fill: THREE.Mesh | undefined;
  if (icon.type === "brand") {
    const toLocal = ([x, y]: V2) => new THREE.Vector2(x * scale - size / 2, size / 2 - y * scale);
    const geo = new THREE.ShapeGeometry(brandShapes(contours(icon).filter((c) => c.closed).map((c) => c.points), toLocal));
    fill = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({
        color: mix(theme.fill[color], theme.deep[color], 0.45),
        side: THREE.DoubleSide,
        transparent: true,
        depthTest: !overlay,
        depthWrite: false,
      }),
    );
    fill.renderOrder = overlay ? 10 : 0;
    group.add(fill);
  }

  return {
    group,
    setDraw: (v) => {
      lines.progress = clamp01(v / 0.8);
      if (fill) {
        (fill.material as THREE.MeshBasicMaterial).opacity = clamp01((v - 0.5) / 0.5);
        fill.visible = v > 0.5;
      }
    },
  };
}

/**
 * A billboard caption: optional icon to the left of an optional label,
 * centered as a pair. Re-centers once the label's text has laid out.
 */
export function caption(
  label: string | undefined, icon: IconName | undefined, theme: Theme, color: PaletteColor, seed: string,
  size: number,
): { group: THREE.Group; setDraw(v: number): void } {
  const group = new THREE.Group();
  const text = label ? makeText(label, theme, size) : undefined;
  const art = icon ? iconArt(icon, size * 1.25, theme, color, seed, true) : undefined;
  const gap = size * 0.3;
  if (text) group.add(text);
  if (art) group.add(art.group);

  const layout = () => {
    const bounds = text?.textRenderInfo?.blockBounds;
    const tw = text ? (bounds ? bounds[2] - bounds[0] : 0) : 0;
    const iw = art ? size * 1.25 : 0;
    const total = tw + iw + (text && art ? gap : 0);
    const left = -total / 2;
    if (art) art.group.position.x = left + iw / 2;
    if (text) text.position.x = left + iw + (art ? gap : 0) + tw / 2;
  };
  layout();
  text?.addEventListener("synccomplete" as never, layout);

  return {
    group,
    setDraw: (v) => {
      art?.setDraw(v);
      if (text) setTextOpacity(text, clamp01((v - 0.3) / 0.7));
    },
  };
}
