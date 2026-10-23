import * as THREE from "three";
import { FatLines } from "./fatline";

// Dots that travel along a path of arrows, then vanish. A dot is a fat line
// of zero length: its round caps make a perfect circle at any zoom.

const DOT_PX = 15;
/** Each trailing dot is this much smaller than the one ahead. */
const TRAIL_SHRINK = 0.78;
/** Gap between dots, as a fraction of the path. */
const SPACING = 0.07;

export class FlowDots {
  readonly group = new THREE.Group();
  private dots: { group: THREE.Group; core: FatLines; halo: FatLines; size: number }[] = [];
  private lengths: number[] = [];
  private total = 0;

  constructor(private points: THREE.Vector3[], count: number, color: string, page: string) {
    for (let i = 1; i < points.length; i++) {
      const len = points[i].distanceTo(points[i - 1]);
      this.lengths.push(len);
      this.total += len;
    }
    const origin = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      // A page-colored halo keeps the dot legible where it crosses lines.
      const size = DOT_PX * TRAIL_SHRINK ** i;
      const halo = new FatLines([[origin, origin.clone()]], { color: page, width: size + 7, overlay: true });
      const core = new FatLines([[origin, origin.clone()]], { color, width: size, overlay: true });
      halo.renderOrder = 13;
      core.renderOrder = 14;
      const group = new THREE.Group();
      group.add(halo, core);
      this.dots.push({ group, core, halo, size });
      this.group.add(group);
    }
  }

  private at(u: number): THREE.Vector3 {
    let d = u * this.total;
    for (let i = 0; i < this.lengths.length; i++) {
      if (d <= this.lengths[i] || i === this.lengths.length - 1) {
        return this.points[i].clone().lerp(this.points[i + 1], Math.min(1, d / (this.lengths[i] || 1)));
      }
      d -= this.lengths[i];
    }
    return this.points[this.points.length - 1].clone();
  }

  /** k: 0..1 progress of the whole flow. Dots trail one another. */
  update(k: number): void {
    const n = this.dots.length;
    const span = 1 + SPACING * (n - 1);
    this.dots.forEach((dot, i) => {
      const u = k * span - i * SPACING;
      dot.group.visible = u > 0 && u < 1;
      if (!dot.group.visible) return;
      dot.group.position.copy(this.at(u));
      // Grow in at the start, shrink away at the end.
      const s = Math.min(1, Math.min(u, 1 - u) / 0.06);
      dot.core.material.uniforms.uWidthScale.value = s;
      dot.halo.material.uniforms.uWidthScale.value = s;
    });
  }

  dispose(): void {
    for (const d of this.dots) {
      d.core.dispose();
      d.halo.dispose();
    }
  }
}
