import * as THREE from "three";
import type { Polyline, V2 } from "./rough";

/** Pen pixels per world unit. rough.js constants are tuned for pixels. */
export const PEN_PX = 80;

/**
 * A plane in world space that pen-space drawings are laid onto.
 * Pen (x, y) maps to origin + u * x + v * y, with x and y in pen pixels.
 */
export class Frame {
  constructor(
    readonly origin: THREE.Vector3,
    readonly u: THREE.Vector3,
    readonly v: THREE.Vector3,
  ) {}

  /** A horizontal frame at height y: pen x → world +X, pen y → world +Z. */
  static ground(y: number): Frame {
    return new Frame(new THREE.Vector3(0, y, 0), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1));
  }

  /** A frame whose pen x axis runs from a to b; `side` picks the plane. */
  static along(a: THREE.Vector3, b: THREE.Vector3, side: THREE.Vector3): Frame {
    const u = b.clone().sub(a).normalize();
    const v = side.clone().sub(u.clone().multiplyScalar(side.dot(u))).normalize();
    return new Frame(a.clone(), u, v);
  }

  /** World units → pen pixels, for laying out in this frame. */
  static px(world: number): number {
    return world * PEN_PX;
  }

  point([x, y]: V2): THREE.Vector3 {
    return this.origin
      .clone()
      .addScaledVector(this.u, x / PEN_PX)
      .addScaledVector(this.v, y / PEN_PX);
  }

  map(lines: Polyline[]): THREE.Vector3[][] {
    return lines.map((l) => l.map((p) => this.point(p)));
  }
}
