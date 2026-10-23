import * as THREE from "three";
import { Text } from "troika-three-text";
import { toWorld, type ResolvedScene, type ResolvedShape, type Transform } from "../core/resolve";
import { currentScope, settled, type SceneIndex } from "../core/state";
import type { Deck } from "../schema/deck";
import { STAGE_H, STAGE_W } from "../render/camera";
import type { BuiltElement } from "../styles/sketch";
import { CAPTION_BAND, type Player } from "./player";

// Layout checks that need the real scene: text metrics, camera framing,
// what is visible at each step. Every issue names its elements and step.

export interface LintIssue {
  rule: string;
  message: string;
  ids: string[];
  /** 1-based step, when the issue belongs to one. */
  step?: number;
}

const MAX_IN_VIEW = 60;
type Rect = { x0: number; y0: number; x1: number; y1: number };

function project(p: THREE.Vector3, camera: THREE.Camera): THREE.Vector2 {
  const v = p.clone().project(camera);
  return new THREE.Vector2(((v.x + 1) / 2) * STAGE_W, ((1 - v.y) / 2) * STAGE_H);
}

function rectOf(points: THREE.Vector2[]): Rect {
  return {
    x0: Math.min(...points.map((p) => p.x)),
    y0: Math.min(...points.map((p) => p.y)),
    x1: Math.max(...points.map((p) => p.x)),
    y1: Math.max(...points.map((p) => p.y)),
  };
}

function shrink(r: Rect, k: number): Rect {
  const dx = ((r.x1 - r.x0) * k) / 2;
  const dy = ((r.y1 - r.y0) * k) / 2;
  return { x0: r.x0 + dx, y0: r.y0 + dy, x1: r.x1 - dx, y1: r.y1 - dy };
}

const overlaps = (a: Rect, b: Rect) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

function footprintRect(s: ResolvedShape): [number, number, number, number] {
  const hw = s.footprint.type === "rect" ? s.footprint.hw : s.footprint.r;
  const hd = s.footprint.type === "rect" ? s.footprint.hd : s.footprint.r;
  return [s.pos[0] - hw, s.pos[2] - hd, s.pos[0] + hw, s.pos[2] + hd];
}

function shapeScreenRect(s: ResolvedShape, t: Transform, camera: THREE.Camera): Rect {
  const [x0, z0, x1, z1] = footprintRect(s);
  const pts: THREE.Vector2[] = [];
  for (const y of [s.pos[1], s.pos[1] + s.height]) {
    for (const [x, z] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) {
      pts.push(project(new THREE.Vector3(...toWorld(t, [x, y, z])), camera));
    }
  }
  return rectOf(pts);
}

/** Does segment a→b (in the ground plane) cross the rectangle? */
function segmentHitsRect(ax: number, az: number, bx: number, bz: number, r: [number, number, number, number]): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = bx - ax;
  const dz = bz - az;
  for (const [p, q] of [[-dx, ax - r[0]], [dx, r[2] - ax], [-dz, az - r[1]], [dz, r[3] - az]]) {
    if (Math.abs(p) < 1e-9) {
      if (q < 0) return false;
    } else {
      const t = q / p;
      if (p < 0) t0 = Math.max(t0, t);
      else t1 = Math.min(t1, t);
      if (t0 > t1) return false;
    }
  }
  return true;
}

function textWidth(t: Text): number {
  const b = t.textRenderInfo?.blockBounds;
  return b ? b[2] - b[0] : 0;
}

export function lint(opts: {
  deck: Deck; index: SceneIndex; resolved: ResolvedScene; built: BuiltElement[]; player: Player;
  scene: THREE.Scene; camera: THREE.OrthographicCamera;
}): LintIssue[] {
  const { deck, index, resolved, built, player, scene, camera } = opts;
  const issues: LintIssue[] = [];
  const shapes = new Map(resolved.scopes.flatMap((sc) => sc.shapes.map((s) => [s.el.id, s] as const)));
  const transformOf = new Map(resolved.scopes.map((sc) => [sc.id, sc.transform]));

  // ── Static geometry, scene by scene ────────────────────────────────────────
  for (const sc of resolved.scopes) {
    const list = sc.shapes.filter((s) => s.el.kind !== "text");
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        if (a.layer !== b.layer) continue;
        const ra = footprintRect(a);
        const rb = footprintRect(b);
        const pad = 0.05;
        if (ra[0] + pad < rb[2] && rb[0] + pad < ra[2] && ra[1] + pad < rb[3] && rb[1] + pad < ra[3]) {
          issues.push({ rule: "overlap", ids: [a.el.id, b.el.id], message: `'${a.el.id}' and '${b.el.id}' overlap on layer '${a.layer}' — move one of them` });
        }
      }
    }

    for (const a of sc.arrows) {
      if (Math.abs(a.from[1] - a.to[1]) > 1e-6) continue; // cross-layer arrows run between planes
      for (const s of sc.shapes) {
        if (s.el.id === a.el.from || s.el.id === a.el.to || s.el.kind === "text") continue;
        if (Math.abs(s.pos[1] - shapes.get(a.el.from)!.pos[1]) > 1e-6) continue;
        if (segmentHitsRect(a.from[0], a.from[2], a.to[0], a.to[2], footprintRect(s))) {
          issues.push({ rule: "arrow-through", ids: [a.el.id, s.el.id], message: `arrow '${a.el.id}' passes through '${s.el.id}' — move '${s.el.id}' or route around it` });
        }
      }
    }
  }

  // Labels that are wider than the shape they sit on.
  for (const b of built) {
    const s = shapes.get(b.id);
    if (!s) continue;
    const limit = s.el.kind === "box" ? s.el.size[0] * 0.92
      : s.el.kind === "database" ? s.el.size * 1.15
      : s.el.kind === "cloud" ? s.el.size * 0.78
      : Infinity;
    if (!Number.isFinite(limit)) continue;
    let width = 0;
    b.sketch.object.traverse((o) => {
      if (o instanceof Text) width = Math.max(width, textWidth(o));
    });
    const icon = "icon" in s.el && s.el.icon && s.el.kind !== "database" ? 0.75 : 0;
    if (width + icon > limit) {
      issues.push({ rule: "label-overflow", ids: [b.id], message: `label of '${b.id}' is wider than the ${s.el.kind} (${(width + icon).toFixed(1)} vs ${limit.toFixed(1)} units) — shorten it or widen the ${s.el.kind}` });
    }
  }

  // ── Per step ───────────────────────────────────────────────────────────────
  const texts = built.map((b) => {
    const ts: Text[] = [];
    b.sketch.object.traverse((o) => o instanceof Text && ts.push(o));
    return { id: b.id, ts };
  });

  let prev = settled(deck, index, -1);
  for (let i = 0; i < player.count; i++) {
    const step = i + 1;
    player.show(i);
    scene.updateMatrixWorld(true);
    const state = settled(deck, index, i);
    const stepDef = deck.steps[i];

    // A step that changes nothing.
    if (i > 0 && stepDef) {
      const same = JSON.stringify(state) === JSON.stringify(prev);
      const flows = stepDef.do.some((a) => a.type === "flow" || a.type === "together");
      if (same && !flows) issues.push({ rule: "empty-step", step, ids: [], message: `step ${step} changes nothing on screen — merge it or give it an action` });
    }
    prev = state;

    // Only the scene being shown is on screen.
    const here = currentScope(state);
    const transform = transformOf.get(here)!;
    const visible = [...shapes.values()].filter((s) => state.visible[s.el.id] && index.scopeOf[s.el.id] === here);
    if (visible.length > MAX_IN_VIEW) {
      issues.push({ rule: "crowded", step, ids: [], message: `step ${step} shows ${visible.length} shapes (aim for ≤ ${MAX_IN_VIEW}) — split detail into a nested scene` });
    }

    // Cropped by the frame. Only a problem for things the camera means to show.
    const fit = state.camera.fit ? new Set(state.camera.fit) : undefined;
    for (const s of visible) {
      if (fit && !fit.has(s.el.id)) continue;
      const r = shapeScreenRect(s, transform, camera);
      if (r.x0 < 0 || r.y0 < 0 || r.x1 > STAGE_W || r.y1 > STAGE_H) {
        issues.push({ rule: "off-stage", step, ids: [s.el.id], message: `'${s.el.id}' is cut off by the frame in step ${step}` });
      }
    }

    // Labels colliding with each other, or with the caption band.
    const rects: { id: string; r: Rect }[] = [];
    for (const { id, ts } of texts) {
      if (!state.visible[id] || index.scopeOf[id] !== here) continue;
      for (const t of ts) {
        const bb = t.geometry.boundingBox;
        if (!t.visible || !bb) continue;
        const corners = [
          new THREE.Vector3(bb.min.x, bb.min.y, 0), new THREE.Vector3(bb.max.x, bb.min.y, 0),
          new THREE.Vector3(bb.min.x, bb.max.y, 0), new THREE.Vector3(bb.max.x, bb.max.y, 0),
        ].map((c) => project(c.applyMatrix4(t.matrixWorld), camera));
        rects.push({ id, r: shrink(rectOf(corners), 0.12) });
      }
    }
    for (let a = 0; a < rects.length; a++) {
      for (let b = a + 1; b < rects.length; b++) {
        if (rects[a].id === rects[b].id || !overlaps(rects[a].r, rects[b].r)) continue;
        issues.push({ rule: "label-collision", step, ids: [rects[a].id, rects[b].id], message: `labels of '${rects[a].id}' and '${rects[b].id}' overlap in step ${step}` });
      }
    }
    if (state.caption) {
      // Context outside a camera fit fades under the caption band; only what
      // the camera means to show must stay clear of it.
      const band = STAGE_H * (1 - CAPTION_BAND);
      for (const { id, r } of rects) {
        if (fit && !fit.has(id)) continue;
        if (r.y1 > band) issues.push({ rule: "caption-collision", step, ids: [id], message: `label of '${id}' runs into the caption in step ${step}` });
      }
    }
  }

  // One message per rule and set of ids is enough.
  const seen = new Set<string>();
  return issues.filter((x) => {
    const key = `${x.rule}|${[...x.ids].sort().join(",")}|${x.rule === "empty-step" || x.rule === "crowded" ? x.step : ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
