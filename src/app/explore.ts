import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { lerpPose, poseOf, type Pose } from "../render/camera";
import type { DeckView } from "./view";

// Free orbit, pan and zoom, always on: grab the scene and it's yours.
// R or Esc glides back to where the step's camera rests; the arrow keys snap back and move on.

const RETURN_SECONDS = 0.9;

export class Explore {
  active = false;
  private controls: OrbitControls;
  private badge = document.createElement("div");

  constructor(private view: DeckView) {
    const c = new OrbitControls(view.camera, view.canvas);
    c.enabled = true;
    c.enableDamping = false; // nothing drifts after you let go
    c.screenSpacePanning = true;
    c.rotateSpeed = 0.6;
    c.zoomSpeed = 0.9;
    c.minZoom = 0.3;
    c.maxZoom = 8;
    c.minPolarAngle = 0.12;
    c.maxPolarAngle = Math.PI / 2 - 0.08;
    c.addEventListener("change", () => {
      view.player?.cameraMoved();
      view.invalidate();
    });
    // The first drag, pinch or scroll takes the camera off the script.
    c.addEventListener("start", () => this.enter());
    this.controls = c;

    this.badge.textContent = "exploring · R to return";
    Object.assign(this.badge.style, {
      position: "absolute",
      fontFamily: "Excalifont, cursive",
      pointerEvents: "none",
      opacity: "0",
      transition: "opacity 300ms",
    });
    document.body.appendChild(this.badge);
  }

  layout(): void {
    const r = this.view.canvas.getBoundingClientRect();
    Object.assign(this.badge.style, {
      left: `${r.left + r.width * 0.025}px`,
      top: `${r.top + r.height * 0.03}px`,
      fontSize: `${r.height * 0.024}px`,
      color: this.view.theme.inkSoft,
    });
  }

  enter(): void {
    const player = this.view.player;
    if (!player || this.active) return;
    if (player.animating) player.show(player.step);
    this.view.onFrame = undefined; // a drag during the glide back keeps the camera where it is
    this.active = true;
    player.exploring = true;
    // Orbit around the point on the view axis nearest the step's focus, so nothing jumps.
    const cam = this.view.camera;
    const ahead = cam.getWorldDirection(new THREE.Vector3());
    const rest = player.restingPose().target;
    this.controls.target.copy(cam.position).addScaledVector(ahead, rest.clone().sub(cam.position).dot(ahead));
    this.controls.update();
    this.layout();
    this.badge.style.opacity = "1";
  }

  /** Leave explore mode: glide back, or snap when about to navigate. */
  exit(animated = true): void {
    const player = this.view.player;
    if (!player || !this.active) return;
    this.active = false;
    this.badge.style.opacity = "0";
    const to = player.restingPose();
    if (!animated) {
      player.exploring = false;
      this.view.setPose(to);
      this.view.invalidate();
      return;
    }
    const from: Pose = poseOf(this.view.camera, this.controls.target);
    let start = -1;
    this.view.onFrame = (now) => {
      if (start < 0) start = now;
      const k = Math.min(1, (now - start) / 1000 / RETURN_SECONDS);
      const e = k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2;
      this.view.setPose(lerpPose(from, to, e));
      if (k >= 1) {
        player.exploring = false;
        this.view.onFrame = undefined;
        return false;
      }
      return true;
    };
    this.view.invalidate();
  }
}
