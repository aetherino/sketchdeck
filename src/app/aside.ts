import { asideSchedule } from "../core/timeline";
import type { Aside } from "../schema/deck";
import { STAGE_H, STAGE_W } from "../render/camera";
import { line, pen, roundedRect, roundedRectOutline, type Polyline, type V2 } from "../styles/sketch/rough";
import { themes, type Theme } from "../styles/sketch";

// The aside card: a hand-drawn note that steps out of the diagram. Drawn as
// SVG in stage pixels over the canvas, in the same pen as the scene: the
// outline sketches itself, then each line is written in left to right.

const NS = "http://www.w3.org/2000/svg";

/** Fraction of the stage width a side card covers; the scene is framed in the rest. */
export const ASIDE_RIGHT = 0.42;

interface Layout {
  width: number;
  pad: number;
  title: number;
  point: number;
  indent: number;
  /** Space between the title and the first point. */
  gap: number;
  /** Space between points. */
  between: number;
  stroke: number;
  /** Left edge, or undefined to center the card. */
  left?: number;
}

const LAYOUTS: Record<Aside["layout"], Layout> = {
  side: { width: 700, pad: 44, title: 46, point: 32, indent: 36, gap: 32, between: 16, stroke: 2.6, left: STAGE_W - 80 - 700 },
  center: { width: 1100, pad: 70, title: 70, point: 44, indent: 50, gap: 48, between: 24, stroke: 3 },
};
const LINE_HEIGHT = 1.28;

type Part =
  | { kind: "stroke"; el: SVGPathElement; span: [number, number] }
  | { kind: "write"; clip: SVGRectElement; width: number; span: [number, number] }
  | { kind: "fill"; el: SVGElement; opacity: number; span: [number, number] };

let uid = 0;
const measure = document.createElement("canvas").getContext("2d")!;

function textWidth(text: string, size: number): number {
  measure.font = `${size}px Excalifont, cursive`;
  return measure.measureText(text).width;
}

/** Greedy word wrap to a width, in stage pixels. */
function wrap(text: string, size: number, max: number): string[] {
  const lines: string[] = [];
  let cur = "";
  for (const word of text.split(/\s+/)) {
    const next = cur ? `${cur} ${word}` : word;
    if (cur && textWidth(next, size) > max) {
      lines.push(cur);
      cur = word;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}

const pathOf = (pl: Polyline) => `M${pl.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join("L")}`;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const easeOut = (k: number) => 1 - (1 - k) ** 2;

/** How many lines each point wraps to on its card (for lint). */
export function asideLines(card: Aside): number[] {
  const L = LAYOUTS[card.layout];
  return card.points.map((p) => wrap(p, L.point, L.width - L.pad * 2 - L.indent).length);
}

export class AsideCard {
  private svg = document.createElementNS(NS, "svg");
  private card?: Aside;
  private parts: Part[] = [];
  private theme: Theme = themes.paper;

  constructor(private canvas: HTMLCanvasElement) {
    this.svg.setAttribute("viewBox", `0 0 ${STAGE_W} ${STAGE_H}`);
    Object.assign(this.svg.style, { position: "absolute", pointerEvents: "none", display: "none", overflow: "visible" });
    document.body.appendChild(this.svg);
  }

  setTheme(theme: Theme): void {
    this.theme = theme;
    this.card = undefined;
    this.parts = [];
    this.svg.replaceChildren();
  }

  /** Keep the card pinned to the stage as the window resizes. */
  layout(): void {
    const r = this.canvas.getBoundingClientRect();
    Object.assign(this.svg.style, {
      left: `${r.left + window.scrollX}px`,
      top: `${r.top + window.scrollY}px`,
      width: `${r.width}px`,
      height: `${r.height}px`,
    });
  }

  /** Show `card` written `t` seconds in (Infinity: finished), `erase` 0 … 1 on its way out. */
  set(card: Aside | undefined, t: number, erase: number): void {
    if (card !== this.card) this.build(card);
    this.svg.style.display = card ? "" : "none";
    if (!card) return;
    for (const p of this.parts) {
      const k = Math.min(clamp01((t - p.span[0]) / p.span[1]), 1 - erase);
      if (p.kind === "stroke") {
        p.el.style.strokeDashoffset = String(1 - easeOut(k));
        p.el.style.visibility = k > 0.001 ? "" : "hidden";
      } else if (p.kind === "write") {
        p.clip.setAttribute("width", String(p.width * k));
      } else {
        p.el.setAttribute("opacity", String(p.opacity * k));
      }
    }
  }

  private build(card: Aside | undefined): void {
    this.card = card;
    this.parts = [];
    this.svg.replaceChildren();
    if (!card) return;

    const L = LAYOUTS[card.layout];
    const th = this.theme;
    const mark = card.color ? th.deep[card.color] : th.inkSoft;
    const schedule = asideSchedule(card);
    const textMax = L.width - L.pad * 2 - L.indent;
    const points = card.points.map((p) => wrap(p, L.point, textMax));

    // Size the card around its text.
    const titleH = card.title ? L.title * LINE_HEIGHT : 0;
    const pointLine = L.point * LINE_HEIGHT;
    const body = points.reduce((h, ls) => h + ls.length * pointLine, 0) + Math.max(0, points.length - 1) * L.between;
    const height = L.pad * 2 + titleH + (card.title && points.length ? L.gap : 0) + body;
    const x = L.left ?? (STAGE_W - L.width) / 2;
    const y = Math.max(40, STAGE_H * 0.45 - height / 2);
    // A big card needs a looser hand to look drawn rather than ruled.
    const p = pen(`aside:${card.title ?? ""}:${card.points.join("|")}`, { roughness: 1.6, bowing: 1.4 });

    // Paper: a sheet with a tinted sheet peeking out behind it.
    const fill = (pts: V2[], color: string, opacity: number, span: [number, number]) => {
      const el = document.createElementNS(NS, "path");
      el.setAttribute("d", `${pathOf(pts)}Z`);
      el.setAttribute("fill", color);
      this.svg.appendChild(el);
      this.parts.push({ kind: "fill", el, opacity, span });
    };
    const r = 18;
    fill(roundedRectOutline(x + 12, y + 14, L.width, height, r), th.fill[card.color ?? "gray"], th.name === "paper" ? 0.55 : 0.35, [0.2, 0.5]);
    fill(roundedRectOutline(x, y, L.width, height, r), th.surface, 0.97, [0, 0.35]);

    const strokes = (lines: Polyline[], color: string, width: number, span: [number, number], pairs: boolean) => {
      // Draw piece after piece, like one pen going round; double strokes share a turn.
      const groups: Polyline[][] = [];
      lines.forEach((pl, i) => (pairs && i % 2 ? groups[groups.length - 1].push(pl) : groups.push([pl])));
      const len = (pl: Polyline) => pl.reduce((s, q, i) => (i ? s + Math.hypot(q[0] - pl[i - 1][0], q[1] - pl[i - 1][1]) : 0), 0);
      const lens = groups.map((g) => len(g[0]));
      const total = lens.reduce((a, b) => a + b, 0) || 1;
      let at = span[0];
      groups.forEach((g, gi) => {
        const d = (span[1] * lens[gi]) / total;
        for (const pl of g) {
          const el = document.createElementNS(NS, "path");
          el.setAttribute("d", pathOf(pl));
          el.setAttribute("pathLength", "1");
          Object.assign(el.style, { fill: "none", stroke: color, strokeWidth: String(width), strokeLinecap: "round", strokeLinejoin: "round", strokeDasharray: "1 1" });
          this.svg.appendChild(el);
          this.parts.push({ kind: "stroke", el, span: [at, Math.max(d, 0.01)] });
        }
        at += d;
      });
    };
    strokes(roundedRect(x, y, L.width, height, r, p), th.ink, L.stroke, schedule.outline, true);

    const write = (text: string, tx: number, top: number, size: number, color: string, span: [number, number]) => {
      const id = `aside-clip-${++uid}`;
      const width = textWidth(text, size) + 10;
      const clipPath = document.createElementNS(NS, "clipPath");
      clipPath.id = id;
      const clip = document.createElementNS(NS, "rect");
      clip.setAttribute("x", String(tx - 6));
      clip.setAttribute("y", String(top - size * 0.3));
      clip.setAttribute("height", String(size * 1.8));
      clip.setAttribute("width", "0");
      clipPath.appendChild(clip);
      const el = document.createElementNS(NS, "text");
      el.textContent = text;
      el.setAttribute("x", String(tx));
      el.setAttribute("y", String(top + size * 0.98));
      el.setAttribute("clip-path", `url(#${id})`);
      Object.assign(el.style, { font: `${size}px Excalifont, cursive`, fill: color });
      this.svg.append(clipPath, el);
      this.parts.push({ kind: "write", clip, width, span });
      return width;
    };

    let cy = y + L.pad;
    if (card.title) {
      const w = write(card.title, x + L.pad, cy, L.title, th.ink, schedule.title);
      const uy = cy + L.title * 1.2;
      const [s, d] = schedule.title;
      strokes(line([x + L.pad - 4, uy], [x + L.pad + w - 6, uy + 2], p, true), mark, L.stroke + 0.6, [s + d * 0.6, d * 0.6], false);
      cy += titleH + (points.length ? L.gap : 0);
    }
    points.forEach((ls, i) => {
      const [s, d] = schedule.points[i];
      // A short dash for the bullet, then the line(s), shared out by width.
      const by = cy + L.point * 0.62;
      strokes(line([x + L.pad, by], [x + L.pad + L.indent * 0.45, by - 1], p, true), mark, L.stroke + 0.4, [s, 0.15], false);
      const widths = ls.map((l) => textWidth(l, L.point));
      const total = widths.reduce((a, b) => a + b, 0) || 1;
      let at = s + 0.1;
      ls.forEach((l, j) => {
        const dj = ((d - 0.1) * widths[j]) / total;
        write(l, x + L.pad + L.indent, cy + j * pointLine, L.point, th.ink, [at, dj]);
        at += dj;
      });
      cy += ls.length * pointLine + L.between;
    });
  }
}
