import * as THREE from "three";

export const STAGE_W = 1920;
export const STAGE_H = 1080;
const ASPECT = STAGE_W / STAGE_H;
const DISTANCE = 200;

/** Where the camera is: the point it looks at, how much it sees, from where. */
export interface Pose {
  target: THREE.Vector3;
  /** Half the visible height, in world units. */
  halfH: number;
  /** Degrees around the vertical axis; 0 looks straight down −z. */
  azimuth: number;
  /** Degrees above the horizon. */
  elevation: number;
}

function direction(azimuth: number, elevation: number): THREE.Vector3 {
  const az = THREE.MathUtils.degToRad(azimuth);
  const el = THREE.MathUtils.degToRad(elevation);
  return new THREE.Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));
}

export function applyPose(camera: THREE.OrthographicCamera, pose: Pose): void {
  camera.position.copy(pose.target).addScaledVector(direction(pose.azimuth, pose.elevation), DISTANCE);
  camera.up.set(0, 1, 0);
  camera.lookAt(pose.target);
  camera.left = -pose.halfH * ASPECT;
  camera.right = pose.halfH * ASPECT;
  camera.top = pose.halfH;
  camera.bottom = -pose.halfH;
  camera.near = 1;
  camera.far = DISTANCE * 2;
  camera.zoom = 1;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
}

/**
 * The pose that looks along (azimuth, elevation) and fits every point inside
 * the 16:9 stage with a margin; `zoom` > 1 moves closer. `reserve` keeps that
 * fraction of the stage height clear at the bottom (for captions).
 */
export function solvePose(
  points: THREE.Vector3[], azimuth: number, elevation: number, zoom = 1, margin = 0.1, reserve = 0,
): Pose {
  const center = new THREE.Box3().setFromPoints(points).getCenter(new THREE.Vector3());
  const probe = new THREE.OrthographicCamera();
  applyPose(probe, { target: center, halfH: 1, azimuth, elevation });

  // Measure the content in camera space, then recenter and size.
  const inv = probe.matrixWorldInverse;
  const min = new THREE.Vector2(Infinity, Infinity);
  const max = new THREE.Vector2(-Infinity, -Infinity);
  for (const p of points) {
    const q = p.clone().applyMatrix4(inv);
    min.min(new THREE.Vector2(q.x, q.y));
    max.max(new THREE.Vector2(q.x, q.y));
  }
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(probe.quaternion);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(probe.quaternion);
  // Fit the content into the stage minus the reserved band, then shift the
  // view down so the content sits above the band.
  const usable = 1 - reserve;
  const halfH = (Math.max((max.y - min.y) / 2 / usable, (max.x - min.x) / 2 / ASPECT, 0.5) * (1 + margin)) / zoom;
  const target = center
    .clone()
    .addScaledVector(right, (min.x + max.x) / 2)
    .addScaledVector(up, (min.y + max.y) / 2 - reserve * halfH);
  return { target, halfH, azimuth, elevation };
}

/** Read the pose an orthographic camera is in (after free movement). */
export function poseOf(camera: THREE.OrthographicCamera, target: THREE.Vector3): Pose {
  const d = camera.position.clone().sub(target).normalize();
  return {
    target: target.clone(),
    halfH: (camera.top - camera.bottom) / 2 / camera.zoom,
    azimuth: THREE.MathUtils.radToDeg(Math.atan2(d.x, d.z)),
    elevation: THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(d.y, -1, 1))),
  };
}

/** Interpolate poses: linear position and angles, geometric zoom. */
export function lerpPose(a: Pose, b: Pose, k: number): Pose {
  return {
    target: a.target.clone().lerp(b.target, k),
    halfH: a.halfH * (b.halfH / a.halfH) ** k,
    // The short way round, after free orbiting.
    azimuth: a.azimuth + ((((b.azimuth - a.azimuth) % 360) + 540) % 360 - 180) * k,
    elevation: a.elevation + (b.elevation - a.elevation) * k,
  };
}
