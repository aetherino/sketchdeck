import * as THREE from "three";
import type { ResolvedArrow, ResolvedGroup, ResolvedLayer, ResolvedShape } from "../../core/resolve";
import { FatLines } from "../../render/fatline";
import {
  faceCamera, faceFader, faceMaterial, HATCH, LABEL_SIZE, makeText, phased, setTextOpacity, shade,
  screenSide, STROKE, towardCamera, withVisibility, yawToCamera, type Sketched,
} from "./common";
import { Frame } from "./frame";
import { caption, iconArt } from "./icons";
import {
  circleOutline, closedCurve, ellipse, hachure, line, pen, roundedRect, roundedRectOutline,
  type Polyline, type V2,
} from "./rough";
import { mix, type PaletteColor, type Theme } from "./theme";

const DEFAULT_COLOR: PaletteColor = "gray";
const vec = (p: [number, number, number]) => new THREE.Vector3(...p);
const ground = (x: number, y: number, z: number) =>
  new Frame(new THREE.Vector3(x, y, z), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1));

type ShapeOf<K extends ResolvedShape["el"]["kind"]> = ResolvedShape & { el: Extract<ResolvedShape["el"], { kind: K }> };

/** Billboard-local frame for standees: pen (0, 0) at top center, y downward. */
function standeeFrame(height: number): Frame {
  return new Frame(new THREE.Vector3(0, height, 0), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, -1, 0));
}

/** Pen-space polygon → local-space shape for a standee face. */
function standeeShape(points: V2[], height: number): THREE.Shape {
  return new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x / Frame.px(1), height - y / Frame.px(1))));
}

/** Keep a caption just below a point on screen, whatever the camera does. */
function placeBelow(o: THREE.Object3D, at: THREE.Vector3, camera: THREE.Camera, distance: number): void {
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
  o.position.copy(at).addScaledVector(up, -distance);
  faceCamera(o, camera);
}

// ── Box ──────────────────────────────────────────────────────────────────────

export function box(s: ShapeOf<"box">, theme: Theme): Sketched {
  const { el } = s;
  const color = el.color ?? DEFAULT_COLOR;
  const [w, d] = el.size;
  const h = el.height;
  const at = vec(s.pos);
  const group = new THREE.Group();
  const x0 = at.x - w / 2;
  const z0 = at.z - d / 2;
  const r = Math.min(0.22, w / 6, d / 6);

  // Faces: a rounded-rect prism. Shape y is -world z (see rotateX below).
  const shape = new THREE.Shape(roundedRectOutline(x0, -(z0 + d), w, d, r).map(([x, y]) => new THREE.Vector2(x, y)));
  const geo = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false, curveSegments: 6 });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, at.y, 0);
  const faces = new THREE.Mesh(shade(geo, theme, color), faceMaterial());
  group.add(faces);

  // Outline: top, the four corner edges, then the bottom.
  const p = pen(el.id);
  const W = Frame.px(w);
  const D = Frame.px(d);
  const R = Frame.px(r);
  const topF = ground(x0, at.y + h, z0);
  const botF = ground(x0, at.y, z0);
  const strokes: THREE.Vector3[][] = [...topF.map(roundedRect(0, 0, W, D, R, p))];
  const k = Math.SQRT1_2 * R;
  for (const [cx, cy, ox, oy] of [[R, R, -1, -1], [W - R, R, 1, -1], [W - R, D - R, 1, 1], [R, D - R, -1, 1]]) {
    const bottom = botF.point([cx + ox * k, cy + oy * k]);
    const top = topF.point([cx + ox * k, cy + oy * k]);
    strokes.push(...Frame.along(bottom, top, new THREE.Vector3(ox, 0, oy)).map(line([0, 0], [Frame.px(h), 0], p)));
  }
  strokes.push(...botF.map(roundedRect(0, 0, W, D, R, p)));
  const outline = new FatLines(strokes, { color: theme.ink, width: STROKE });
  group.add(outline);

  const inset = 3;
  const hatch = new FatLines(
    ground(x0, at.y + h + 0.002, z0).map(hachure(roundedRectOutline(inset, inset, W - 2 * inset, D - 2 * inset, R), p)),
    { color: theme.fill[color], width: HATCH },
  );
  group.add(hatch);

  const cap = caption(el.label, el.icon, theme, color, el.id, LABEL_SIZE);
  cap.group.position.set(at.x, at.y + h + 0.02, at.z);
  group.add(cap.group);

  return {
    object: group,
    setDraw: withVisibility(group, phased([
      [(v) => (outline.progress = v), 0, 0.7],
      [faceFader(faces), 0.35, 0.75],
      [(v) => (hatch.progress = v), 0.55, 1],
      [cap.setDraw, 0.7, 1],
    ])),
    onCamera: (cam) => faceCamera(cap.group, cam),
  };
}

// ── Tubes: databases (upright) and queues (lying down) ──────────────────────

export function tube(s: ShapeOf<"database"> | ShapeOf<"queue">, theme: Theme): Sketched {
  const { el } = s;
  const color = el.color ?? DEFAULT_COLOR;
  const at = vec(s.pos);
  const upright = el.kind === "database";
  const radius = upright ? el.size / 2 : el.size[1] / 2;
  const length = upright ? el.height : el.size[0];
  const axis = upright
    ? new THREE.Vector3(0, 1, 0)
    : el.along === "x" ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, -1);
  const center = at.clone().add(new THREE.Vector3(0, upright ? length / 2 : radius, 0));
  // Two unit vectors spanning the plane of each ring.
  const ringU = upright ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const ringV = new THREE.Vector3().crossVectors(axis, ringU).normalize();
  const along = (t: number) => center.clone().addScaledVector(axis, (t - 0.5) * length);

  const group = new THREE.Group();
  const geo = new THREE.CylinderGeometry(radius, radius, length, 64, 1);
  geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis));
  geo.translate(center.x, center.y, center.z);
  const faces = new THREE.Mesh(shade(geo, theme, color), faceMaterial());
  group.add(faces);

  // Rings. A database gets a lid line near the top; a queue gets slots.
  const p = pen(el.id);
  const D = Frame.px(radius * 2);
  const rings = upright ? [1, 0.8, 0] : [0, 0.2, 0.4, 0.6, 0.8, 1];
  const outline = new FatLines(
    rings.flatMap((t) => new Frame(along(t), ringU, ringV).map(ellipse(0, 0, D, D, p))),
    { color: theme.ink, width: STROKE },
  );
  group.add(outline);

  // A database's icon is a sticker on its lid; the hatching makes room for it.
  let hatch: FatLines | undefined;
  let sticker: ReturnType<typeof iconArt> | undefined;
  if (upright) {
    const top = along(1).add(new THREE.Vector3(0, 0.002, 0));
    const stickerSize = Math.min(radius * 0.95, 0.8);
    const rings: V2[][] = [circleOutline(0, 0, D / 2 - 3)];
    if (el.icon) {
      rings.push(circleOutline(0, 0, Frame.px(stickerSize * 0.62)));
      sticker = iconArt(el.icon, stickerSize, theme, color, el.id);
      sticker.group.rotation.x = -Math.PI / 2;
      sticker.group.position.copy(top).add(new THREE.Vector3(0, 0.004, 0));
      group.add(sticker.group);
    }
    hatch = new FatLines(new Frame(top, ringU, ringV).map(hachure(rings, p)), {
      color: theme.fill[color],
      width: HATCH,
    });
    group.add(hatch);
  }

  // Silhouette edges depend on the view, so they are rebuilt on camera change —
  // from the same seed, so their wobble never changes.
  let sides: FatLines | undefined;
  let sidesProgress = 1;
  const buildSides = (cam: THREE.Camera) => {
    if (sides) {
      group.remove(sides);
      sides.dispose();
    }
    const perp = screenSide(axis, cam);
    const sp = pen(`${el.id}:sides`);
    const strokes: THREE.Vector3[][] = [];
    for (const sign of [-1, 1]) {
      const a = along(0).addScaledVector(perp, sign * radius);
      const b = along(1).addScaledVector(perp, sign * radius);
      strokes.push(...Frame.along(a, b, perp.clone().multiplyScalar(sign)).map(line([0, 0], [Frame.px(length), 0], sp)));
    }
    sides = new FatLines(strokes, { color: theme.ink, width: STROKE });
    sides.progress = sidesProgress;
    group.add(sides);
  };

  // A database's caption sits on its body, facing the camera. A queue's sits
  // just below it, clear of the slot rings.
  const cap = caption(el.label, upright ? undefined : el.icon, theme, color, el.id, LABEL_SIZE);
  group.add(cap.group);
  const placeCaption = (cam: THREE.Camera) => {
    const toward = towardCamera(cam);
    if (upright) {
      const n = toward.sub(axis.clone().multiplyScalar(toward.dot(axis))).normalize();
      cap.group.position.copy(along(0.4)).addScaledVector(n, radius);
      faceCamera(cap.group, cam);
    } else {
      const front = center.clone().addScaledVector(toward, radius).setY(at.y);
      placeBelow(cap.group, front, cam, 0.32);
    }
  };

  return {
    object: group,
    setDraw: withVisibility(group, phased([
      [(v) => (outline.progress = v), 0, 0.7],
      [(v) => { sidesProgress = v; if (sides) sides.progress = v; }, 0.25, 0.6],
      [faceFader(faces), 0.35, 0.75],
      [(v) => hatch && (hatch.progress = v), 0.55, 1],
      [(v) => sticker?.setDraw(v), 0.6, 1],
      [cap.setDraw, 0.7, 1],
    ])),
    onCamera: (cam) => {
      buildSides(cam);
      placeCaption(cam);
    },
  };
}

// ── Standees: flat cut-outs that stand on the layer and turn to the viewer ──

function standee(
  s: ResolvedShape, theme: Theme, height: number,
  build: (f: Frame, standee: THREE.Group) => { setDraw(v: number): void },
): Sketched {
  const at = vec(s.pos);
  const group = new THREE.Group();
  const body = new THREE.Group();
  body.position.copy(at);
  group.add(body);
  const art = build(standeeFrame(height), body);

  const label = "label" in s.el && s.el.kind !== "cloud" ? s.el.label : undefined;
  const cap = label ? caption(label, undefined, theme, DEFAULT_COLOR, s.el.id, LABEL_SIZE * 0.85) : undefined;
  if (cap) group.add(cap.group);

  return {
    object: group,
    setDraw: withVisibility(group, phased([
      [art.setDraw, 0, 0.85],
      [(v) => cap?.setDraw(v), 0.7, 1],
    ])),
    onCamera: (cam) => {
      yawToCamera(body, cam);
      if (cap) placeBelow(cap.group, at, cam, 0.36);
    },
  };
}

export function person(s: ShapeOf<"person">, theme: Theme): Sketched {
  const color = s.el.color ?? DEFAULT_COLOR;
  const H = s.el.size;
  return standee(s, theme, H, (f, body) => {
    const Hp = Frame.px(H);
    const p = pen(s.el.id);
    // Head: a circle. Body: rounded shoulders down to a flat base.
    const headR = 0.15 * Hp;
    const headC: V2 = [0, 0.16 * Hp];
    const outline: V2[] = [];
    const sw = 0.3 * Hp;
    const shoulder = 0.62 * Hp;
    for (let i = 0; i <= 16; i++) {
      const a = Math.PI + (i / 16) * Math.PI;
      outline.push([sw * Math.cos(a), shoulder + 0.26 * Hp * Math.sin(a)]);
    }
    outline.push([sw, Hp], [0, Hp], [-sw, Hp]);

    const bodyMesh = new THREE.Mesh(
      new THREE.ShapeGeometry(standeeShape(outline, H)),
      faceMaterial({ color: mix(theme.paper, theme.fill[color], theme.sides[0]), doubleSided: true }),
    );
    const headMesh = new THREE.Mesh(
      new THREE.ShapeGeometry(standeeShape(circleOutline(headC[0], headC[1], headR), H)),
      faceMaterial({ color: theme.surface, doubleSided: true }),
    );
    body.add(bodyMesh, headMesh);

    const lines = new FatLines(
      f.map([...ellipse(headC[0], headC[1], headR * 2, headR * 2, p), ...closedCurve(outline, p)]),
      { color: theme.ink, width: STROKE },
    );
    body.add(lines);
    return {
      setDraw: phased([
        [(v) => (lines.progress = v), 0, 0.75],
        [faceFader(bodyMesh), 0.4, 1],
        [faceFader(headMesh), 0.4, 1],
      ]),
    };
  });
}

/** Cloud outline: the union of a few circles over a flat base, traced by rays. */
function cloudOutline(width: number): V2[] {
  const circles: [number, number, number][] = [
    [-0.28, 0.25, 0.2], [-0.02, 0.37, 0.26], [0.27, 0.27, 0.21], [-0.37, 0.14, 0.12], [0.38, 0.14, 0.12],
  ];
  const o: V2 = [0, 0.24];
  const pts: V2[] = [];
  const N = 64;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const d: V2 = [Math.cos(a), Math.sin(a)];
    let t = 0;
    for (const [cx, cy, r] of circles) {
      const ox = cx - o[0];
      const oy = cy - o[1];
      const b = d[0] * ox + d[1] * oy;
      const disc = b * b - (ox * ox + oy * oy) + r * r;
      if (disc >= 0) t = Math.max(t, b + Math.sqrt(disc));
    }
    // Flat bottom at y = 0.04.
    if (d[1] < 0) t = Math.min(t, (0.04 - o[1]) / d[1]);
    pts.push([(o[0] + d[0] * t) * width, (o[1] + d[1] * t) * width]);
  }
  return pts;
}

export function cloud(s: ShapeOf<"cloud">, theme: Theme): Sketched {
  const color = s.el.color ?? DEFAULT_COLOR;
  const W = s.el.size;
  const H = W * 0.62;
  return standee(s, theme, H, (f, body) => {
    const Wp = Frame.px(W);
    const Hp = Frame.px(H);
    const p = pen(s.el.id);
    // Cloud space has y up from the base; pen space has y down from the top.
    const outline = cloudOutline(1).map(([x, y]): V2 => [x * Wp, Hp - y * Wp]);
    const face = new THREE.Mesh(new THREE.ShapeGeometry(standeeShape(outline, H)), faceMaterial({ color: theme.surface, doubleSided: true }));
    body.add(face);
    const lines = new FatLines(f.map(closedCurve(outline, p)), { color: theme.ink, width: STROKE });
    const hatch = new FatLines(f.map(hachure(outline, p, 9)), { color: theme.fill[color], width: HATCH, depthBias: 0.06 });
    body.add(lines, hatch);

    const cap = caption(s.el.label, s.el.icon, theme, color, s.el.id, LABEL_SIZE * 0.9);
    cap.group.position.set(0, H * 0.45, 0.02);
    body.add(cap.group);
    return {
      setDraw: phased([
        [(v) => (lines.progress = v), 0, 0.6],
        [faceFader(face), 0.3, 0.7],
        [(v) => (hatch.progress = v), 0.5, 0.9],
        [cap.setDraw, 0.7, 1],
      ]),
    };
  });
}

export function iconTile(s: ShapeOf<"icon">, theme: Theme): Sketched {
  const color = s.el.color ?? DEFAULT_COLOR;
  const S = s.el.size;
  return standee(s, theme, S, (f, body) => {
    const Sp = Frame.px(S);
    const p = pen(s.el.id);
    const R = Sp * 0.18;
    const tile = new THREE.Mesh(
      new THREE.ShapeGeometry(standeeShape(roundedRectOutline(-Sp / 2, 0, Sp, Sp, R), S)),
      faceMaterial({ color: theme.surface, doubleSided: true }),
    );
    body.add(tile);
    const lines = new FatLines(f.map(roundedRect(-Sp / 2, 0, Sp, Sp, R, p)), { color: theme.ink, width: STROKE });
    body.add(lines);
    const art = iconArt(s.el.icon, S * 0.6, theme, color, s.el.id);
    art.group.position.set(0, S / 2, 0.01);
    body.add(art.group);
    return {
      setDraw: phased([
        [(v) => (lines.progress = v), 0, 0.5],
        [faceFader(tile), 0.2, 0.5],
        [art.setDraw, 0.4, 1],
      ]),
    };
  });
}

// ── Text ─────────────────────────────────────────────────────────────────────

export function text(s: ShapeOf<"text">, theme: Theme): Sketched {
  const { el } = s;
  const at = vec(s.pos);
  const t = makeText(el.label, theme, el.size);
  if (el.color) t.color = theme.deep[el.color];
  if (el.flat) {
    t.outlineWidth = 0;
    t.rotation.x = -Math.PI / 2;
    t.position.set(at.x, at.y + 0.01, at.z);
    t.material = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false });
    t.renderOrder = 1;
  } else {
    t.position.set(at.x, at.y + el.size * 0.7, at.z);
  }
  t.sync();
  return {
    object: t,
    setDraw: (v) => setTextOpacity(t, v),
    onCamera: (cam) => {
      if (!el.flat) faceCamera(t, cam);
    },
  };
}

// ── Group boundary ───────────────────────────────────────────────────────────

/** Text written flat on a plane, reading along +x from its front-left corner. */
function flatLabel(textValue: string, theme: Theme, color: string, size: number, x: number, y: number, z: number) {
  const t = makeText(textValue, theme, size);
  t.color = color;
  t.outlineWidth = 0;
  t.anchorX = "left";
  t.anchorY = "bottom";
  t.rotation.x = -Math.PI / 2;
  t.position.set(x, y, z);
  t.material = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false });
  // After the plane's translucent fill, so the tint doesn't wash it out.
  t.renderOrder = 1;
  t.sync();
  return t;
}

export function boundary(g: ResolvedGroup, theme: Theme): Sketched {
  const [x0, z0, x1, z1] = g.bounds;
  const w = x1 - x0;
  const d = z1 - z0;
  const group = new THREE.Group();
  const ink = g.el.color ? theme.deep[g.el.color] : theme.inkSoft;
  const r = 0.35;

  let fillMat: THREE.MeshBasicMaterial | undefined;
  if (g.el.color) {
    const shape = new THREE.Shape(roundedRectOutline(x0, -z1, w, d, r).map(([x, y]) => new THREE.Vector2(x, y)));
    const geo = new THREE.ShapeGeometry(shape, 8);
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, g.y + 0.005, 0);
    fillMat = new THREE.MeshBasicMaterial({ color: theme.fill[g.el.color], transparent: true, opacity: 0.3, depthWrite: false });
    group.add(new THREE.Mesh(geo, fillMat));
  }

  const p = pen(g.el.id);
  const outline = new FatLines(
    ground(x0, g.y + 0.01, z0).map(roundedRect(0, 0, Frame.px(w), Frame.px(d), Frame.px(r), p, true)),
    { color: ink, width: 1.8, dash: [0.24, 0.16], depthBias: 0.04 },
  );
  group.add(outline);

  // Just outside the front edge, like a tab, so contents never cover it.
  const label = g.el.label ? flatLabel(g.el.label, theme, ink, 0.4, x0 + 0.35, g.y + 0.012, z1 + 0.65) : undefined;
  if (label) group.add(label);

  return {
    object: group,
    setDraw: withVisibility(group, phased([
      [(v) => (outline.progress = v), 0, 0.8],
      [(v) => fillMat && (fillMat.opacity = 0.3 * v), 0.3, 0.9],
      [(v) => label && setTextOpacity(label, v), 0.6, 1],
    ])),
  };
}

// ── Layer plane ──────────────────────────────────────────────────────────────

export function layerPlane(l: ResolvedLayer, theme: Theme): Sketched {
  const [x0, z0, x1, z1] = l.bounds;
  const w = x1 - x0;
  const d = z1 - z0;
  const group = new THREE.Group();
  const r = 0.45;
  const shape = new THREE.Shape(roundedRectOutline(x0, -z1, w, d, r).map(([x, y]) => new THREE.Vector2(x, y)));
  const geo = new THREE.ShapeGeometry(shape, 8);
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, l.y, 0);
  const { mix: tint, opacity } = theme.plane;
  const fillMat = new THREE.MeshBasicMaterial({
    color: mix(theme.paper, theme.fill[l.tint], tint),
    transparent: true,
    opacity,
    depthWrite: false,
  });
  group.add(new THREE.Mesh(geo, fillMat));

  const p = pen(l.id, { roughness: 1.2 });
  const outline = new FatLines(ground(x0, l.y, z0).map(roundedRect(0, 0, Frame.px(w), Frame.px(d), Frame.px(r), p)), {
    color: mix(theme.deep[l.tint], theme.paper, 0.3),
    width: 1.6,
    depthBias: 0.04,
  });
  group.add(outline);

  // Written on the plane itself, along its front edge.
  const label = l.label ? flatLabel(l.label, theme, theme.deep[l.tint], 0.5, x0 + 0.4, l.y + 0.01, z1 - 0.3) : undefined;
  if (label) group.add(label);

  return {
    object: group,
    setDraw: withVisibility(group, phased([
      [(v) => (outline.progress = v), 0, 0.8],
      [(v) => (fillMat.opacity = opacity * v), 0.3, 0.9],
      [(v) => label && setTextOpacity(label, v), 0.6, 1],
    ])),
  };
}

// ── Arrow ────────────────────────────────────────────────────────────────────

export function arrow(a: ResolvedArrow, theme: Theme): Sketched {
  const { el } = a;
  const from = vec(a.from);
  const to = vec(a.to);
  const group = new THREE.Group();
  let shaft: FatLines | undefined;
  let heads: FatLines | undefined;
  let shaftProgress = 1;
  let headProgress = 1;

  const cap = el.label ? caption(el.label, undefined, theme, DEFAULT_COLOR, el.id, LABEL_SIZE * 0.78) : undefined;
  if (cap) {
    cap.group.position.copy(from).lerp(to, 0.5);
    group.add(cap.group);
  }

  const build = (cam: THREE.Camera) => {
    for (const o of [shaft, heads]) {
      if (o) {
        group.remove(o);
        o.dispose();
      }
    }
    // Drawn in the screen plane so it reads like a 2D Excalidraw arrow.
    const dir = to.clone().sub(from).normalize();
    const f = Frame.along(from, to, screenSide(dir, cam));
    const len = Frame.px(from.distanceTo(to));
    const head = Math.min(26, len * 0.3);
    const barb = head * 0.42;
    const p = pen(el.id);
    const shaftLines = line([0, 0], [len, 0], p, el.dashed);
    const headLines: Polyline[] = [
      ...line([len, 0], [len - head, barb], p),
      ...line([len, 0], [len - head, -barb], p),
    ];
    if (el.both) headLines.push(...line([0, 0], [head, barb], p), ...line([0, 0], [head, -barb], p));
    shaft = new FatLines(f.map(shaftLines), { color: theme.ink, width: STROKE, dash: el.dashed ? [0.22, 0.16] : undefined });
    heads = new FatLines(f.map(headLines), { color: theme.ink, width: STROKE });
    shaft.progress = shaftProgress;
    heads.progress = headProgress;
    group.add(shaft, heads);
    if (cap) {
      // Beside the line rather than on it, on whichever side is up on screen.
      const side = screenSide(dir, cam);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
      if (side.dot(up) < 0) side.negate();
      cap.group.position.copy(from).lerp(to, 0.5).addScaledVector(side, LABEL_SIZE * 0.6);
      faceCamera(cap.group, cam);
    }
  };

  return {
    object: group,
    setDraw: withVisibility(group, phased([
      [(v) => { shaftProgress = v; if (shaft) shaft.progress = v; }, 0, 0.7],
      [(v) => { headProgress = v; if (heads) heads.progress = v; }, 0.65, 0.9],
      [(v) => cap?.setDraw(v), 0.7, 1],
    ])),
    onCamera: build,
  };
}
