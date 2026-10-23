import * as THREE from "three";
import type { ResolvedScene, ResolvedScope } from "../../core/resolve";
import type { Sketched } from "./common";
import { arrow, boundary, box, cloud, iconTile, layerPlane, person, text, tube } from "./shapes";
import type { Theme } from "./theme";

export type { Sketched } from "./common";
export { fontUrl } from "./common";
export { themes, type Theme } from "./theme";

export interface BuiltElement {
  id: string;
  /** The scene this element belongs to ("root" or a box's id). */
  scope: string;
  sketch: Sketched;
}

function buildScope(sc: ResolvedScope, theme: Theme): BuiltElement[] {
  const out: BuiltElement[] = [];
  const add = (id: string, sketch: Sketched) => out.push({ id, scope: sc.id, sketch });
  for (const l of sc.layers) add(l.id, layerPlane(l, theme));
  for (const g of sc.groups) add(g.el.id, boundary(g, theme));
  for (const s of sc.shapes) {
    const el = s.el;
    switch (el.kind) {
      case "box": add(el.id, box({ ...s, el }, theme)); break;
      case "database":
      case "queue": add(el.id, tube({ ...s, el } as Parameters<typeof tube>[0], theme)); break;
      case "person": add(el.id, person({ ...s, el }, theme)); break;
      case "cloud": add(el.id, cloud({ ...s, el }, theme)); break;
      case "icon": add(el.id, iconTile({ ...s, el }, theme)); break;
      case "text": add(el.id, text({ ...s, el }, theme)); break;
    }
  }
  for (const a of sc.arrows) add(a.el.id, arrow(a, theme));
  return out;
}

/**
 * Build the sketch-style drawing of every scene. Each scene lives in its own
 * group, placed and scaled by its transform (child scenes are miniatures
 * standing on their parent box).
 */
export function buildScene(scene: ResolvedScene, theme: Theme): { built: BuiltElement[]; roots: THREE.Object3D[] } {
  const built: BuiltElement[] = [];
  const roots: THREE.Object3D[] = [];
  for (const sc of scene.scopes) {
    const group = new THREE.Group();
    group.name = `scope:${sc.id}`;
    group.position.set(...sc.transform.offset);
    group.scale.setScalar(sc.transform.scale);
    for (const b of buildScope(sc, theme)) {
      group.add(b.sketch.object);
      built.push(b);
    }
    roots.push(group);
  }
  return { built, roots };
}
