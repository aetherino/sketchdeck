import * as THREE from "three";
import { Text } from "troika-three-text";
import fontUrl from "../../../assets/fonts/Excalifont-Regular.ttf?url";
import { mix, type PaletteColor, type Theme } from "./theme";

export { fontUrl };

/** Stroke widths in stage pixels (1920×1080). */
export const STROKE = 2.4;
export const HATCH = 1.5;
/** Label font size in world units. */
export const LABEL_SIZE = 0.48;

export interface Sketched {
  object: THREE.Object3D;
  /** 0 = not drawn yet, 1 = fully drawn. */
  setDraw(t: number): void;
  /** Re-orient or rebuild anything that depends on the view. */
  onCamera?(camera: THREE.Camera): void;
}

export const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Run sub-animations over slices of a single 0..1 draw progress. */
export function phased(parts: [(v: number) => void, number, number][]): (t: number) => void {
  return (t) => {
    for (const [set, t0, t1] of parts) set(clamp01((t - t0) / (t1 - t0)));
  };
}

/** Hide the whole element until its drawing starts. */
export function withVisibility(object: THREE.Object3D, set: (t: number) => void): (t: number) => void {
  return (t) => {
    object.visible = t > 0;
    set(t);
  };
}

/** Vertex colors: paper on top, two flat tones on the sides, lit from the left. */
export function shade(geo: THREE.BufferGeometry, theme: Theme, color: PaletteColor): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.computeVertexNormals();
  const n = g.getAttribute("normal");
  const top = new THREE.Color(theme.surface);
  const lit = mix(theme.paper, theme.fill[color], theme.sides[0]);
  const shaded = mix(theme.paper, theme.fill[color], theme.sides[1]);
  const colors = new Float32Array(n.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < n.count; i += 3) {
    // Shade per triangle using its average normal, so faces stay flat.
    const nx = n.getX(i) + n.getX(i + 1) + n.getX(i + 2);
    const ny = n.getY(i) + n.getY(i + 1) + n.getY(i + 2);
    const nz = n.getZ(i) + n.getZ(i + 1) + n.getZ(i + 2);
    if (ny > 1.5) c.copy(top);
    else if (ny < -1.5) c.copy(shaded);
    else c.copy(nz >= nx ? lit : shaded);
    for (let k = 0; k < 3; k++) colors.set([c.r, c.g, c.b], (i + k) * 3);
  }
  g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return g;
}

export function faceMaterial(opts: { color?: THREE.ColorRepresentation; doubleSided?: boolean; overlay?: boolean } = {}) {
  return new THREE.MeshBasicMaterial({
    vertexColors: opts.color === undefined,
    color: opts.color ?? 0xffffff,
    side: opts.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
    depthTest: !opts.overlay,
    depthWrite: !opts.overlay,
  });
}

/** Fade faces in after the pen: opaque when done, so depth sorting stays exact. */
export function faceFader(mesh: THREE.Mesh): (v: number) => void {
  const m = mesh.material as THREE.MeshBasicMaterial;
  return (v) => {
    mesh.visible = v > 0;
    const transparent = v < 1;
    if (m.transparent !== transparent) {
      m.transparent = transparent;
      m.needsUpdate = true;
    }
    m.opacity = v;
  };
}

export function makeText(text: string, theme: Theme, size = LABEL_SIZE): Text {
  const t = new Text();
  t.text = text;
  t.font = fontUrl;
  t.fontSize = size;
  t.color = theme.ink;
  t.anchorX = "center";
  t.anchorY = "middle";
  t.textAlign = "center";
  t.outlineWidth = size * 0.12;
  t.outlineColor = theme.paper;
  t.outlineBlur = size * 0.08;
  // Labels float above the drawing: never hidden by the faces they sit on.
  t.material = new THREE.MeshBasicMaterial({ transparent: true, depthTest: false, depthWrite: false });
  t.renderOrder = 12;
  t.sync();
  return t;
}

export function setTextOpacity(t: Text, v: number): void {
  t.fillOpacity = v;
  t.outlineOpacity = v;
  t.visible = v > 0;
}

export function viewDir(camera: THREE.Camera): THREE.Vector3 {
  return camera.getWorldDirection(new THREE.Vector3());
}

/** Full billboard: square to the camera. */
export function faceCamera(o: THREE.Object3D, camera: THREE.Camera): void {
  o.quaternion.copy(camera.quaternion);
}

/** Standee billboard: stays upright, turns to face the camera. */
export function yawToCamera(o: THREE.Object3D, camera: THREE.Camera): void {
  const v = viewDir(camera);
  o.rotation.set(0, Math.atan2(-v.x, -v.z), 0);
}

/** Horizontal unit vector from an object toward the camera. */
export function towardCamera(camera: THREE.Camera): THREE.Vector3 {
  const v = viewDir(camera);
  return new THREE.Vector3(-v.x, 0, -v.z).normalize();
}

/** Direction in world space perpendicular to both `dir` and the view. */
export function screenSide(dir: THREE.Vector3, camera: THREE.Camera): THREE.Vector3 {
  const side = new THREE.Vector3().crossVectors(dir, viewDir(camera));
  if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
  return side.normalize();
}
