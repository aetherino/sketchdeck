import * as THREE from "three";
import { toWorld, type ResolvedScene, type ResolvedScope } from "../core/resolve";
import { settled, type CameraState, type SceneIndex } from "../core/state";
import { compileStep, frameAt, type Frame, type Timeline } from "../core/timeline";
import type { Deck } from "../schema/deck";
import { applyPose, lerpPose, solvePose, type Pose } from "../render/camera";
import { emphasizable, type EmphasisFn } from "../render/emphasis";
import { FlowDots } from "../render/flow";
import type { BuiltElement, Theme } from "../styles/sketch";
import type { Caption } from "./caption";

// Plays a deck: unfolds a step's timeline, then rests. Going back jumps
// straight to the previous step's settled state.

/** Fraction of the stage height kept clear at the bottom when a deck has captions. */
export const CAPTION_BAND = 0.13;

interface Entry {
  built: BuiltElement;
  emphasize: EmphasisFn;
}

export interface PlayerOptions {
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  deck: Deck;
  index: SceneIndex;
  resolved: ResolvedScene;
  built: BuiltElement[];
  theme: Theme;
  caption: Caption;
  /** Ask for a frame to be drawn. */
  invalidate: () => void;
}

export class Player {
  private entries = new Map<string, Entry>();
  private timelines = new Map<number, Timeline>();
  private poses = new Map<string, Pose>();
  private flows = new Map<string, FlowDots>();
  private lastView = "";
  private lastEmphasis = new Map<string, [number, number]>();
  /** While exploring, the viewer holds the camera; steps leave it alone. */
  exploring = false;
  private startedAt = -1;
  private timeline?: Timeline;
  step = 0;
  /** Called whenever the current step changes. */
  onStep?: (step: number) => void;

  constructor(private o: PlayerOptions) {
    for (const b of o.built) this.entries.set(b.id, { built: b, emphasize: emphasizable(b.sketch.object, o.theme.paper, o.theme.dim) });
  }

  /** Number of steps (a deck without steps has one implicit step). */
  get count(): number {
    return Math.max(1, this.o.deck.steps.length);
  }

  get animating(): boolean {
    return this.startedAt >= 0;
  }

  get notes(): string | undefined {
    return this.o.deck.steps[this.step]?.notes;
  }

  private timelineFor(i: number): Timeline {
    let tl = this.timelines.get(i);
    if (!tl) {
      const before = settled(this.o.deck, this.o.index, i - 1);
      tl = compileStep(this.o.deck, this.o.index, before, i, (path) => this.flowPoints(path).reduce(
        (sum, p, k, all) => (k ? sum + p.distanceTo(all[k - 1]) : 0), 0,
      ));
      this.timelines.set(i, tl);
    }
    return tl;
  }

  // ── Navigation ─────────────────────────────────────────────────────────────

  /** Unfold step i from the previous step's settled state. */
  play(i: number): void {
    this.setStep(i);
    this.timeline = this.timelineFor(this.step);
    this.startedAt = 0; // set on the next tick
    this.apply(frameAt(this.timeline, 0));
    this.o.invalidate();
  }

  /** Jump to step i's settled state. */
  show(i: number): void {
    this.setStep(i);
    this.timeline = this.timelineFor(this.step);
    this.startedAt = -1;
    this.apply(frameAt(this.timeline, this.timeline.duration + 1));
    this.o.invalidate();
  }

  /** Show step i at t seconds into its unfold (for rendering frames). */
  seek(i: number, t: number): void {
    this.setStep(i);
    this.timeline = this.timelineFor(this.step);
    this.startedAt = -1;
    this.apply(frameAt(this.timeline, t));
  }

  next(): void {
    if (this.animating) this.show(this.step); // first press finishes the unfold
    else if (this.step < this.count - 1) this.play(this.step + 1);
  }

  prev(): void {
    if (this.step > 0) this.show(this.step - 1);
    else this.show(0);
  }

  duration(i: number): number {
    return this.timelineFor(i).duration;
  }

  private setStep(i: number): void {
    const s = Math.max(0, Math.min(this.count - 1, i));
    if (s !== this.step) {
      this.step = s;
    }
    this.onStep?.(this.step);
  }

  /** Advance the running unfold. Returns whether it is still running. */
  tick(now: number): boolean {
    if (!this.timeline || this.startedAt < 0) return false;
    if (this.startedAt === 0) this.startedAt = now;
    const t = (now - this.startedAt) / 1000;
    this.apply(frameAt(this.timeline, t));
    if (t >= this.timeline.duration) {
      this.startedAt = -1;
      return false;
    }
    return true;
  }

  // ── Applying a frame ───────────────────────────────────────────────────────

  private apply(f: Frame): void {
    this.applyCamera(f.camera);
    const { from, to, k } = f.scope;
    const diving = from !== to && this.o.index.parentOf[to] === from;
    const smooth = (x: number) => x * x * (3 - 2 * x);
    const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
    let entering = 0;
    for (const [id, e] of this.entries) {
      const sc = e.built.scope;
      let draw = f.vis[id] ?? 1;
      let hide = 0;
      if (sc === from && sc === to) {
        // The scene being shown.
      } else if (sc === to) {
        if (diving) {
          // The inside sketches itself in, element by element, as the camera arrives.
          draw *= smooth(clamp01((k - 0.2 - entering++ * 0.035) / 0.5));
        } else {
          hide = 1 - smooth(clamp01((k - 0.35) / 0.65)); // surfacing: the outside fades back
        }
      } else if (sc === from) {
        hide = smooth(clamp01(k / (diving ? 0.55 : 0.5))); // the scene being left fades away
      } else {
        draw = 0;
      }
      e.built.sketch.setDraw(draw);
      e.emphasize(f.emph[id] ?? 0, hide);
      this.lastEmphasis.set(id, [f.emph[id] ?? 0, hide]);
    }
    this.applyFlows(f.flows);
    this.o.caption.set(f.caption.text, f.caption.opacity);
  }

  private applyCamera(c: Frame["camera"]): void {
    if (!this.exploring) {
      const pose = c.k >= 1 ? this.poseFor(c.to) : lerpPose(this.poseFor(c.from), this.poseFor(c.to), c.k);
      applyPose(this.o.camera, pose);
    }
    this.refreshView();
  }

  /** Billboards, silhouettes and arrows only care about direction: refresh them when it changes. */
  private refreshView(): boolean {
    const d = this.o.camera.getWorldDirection(new THREE.Vector3());
    const view = `${d.x.toFixed(4)}/${d.y.toFixed(4)}/${d.z.toFixed(4)}`;
    if (view === this.lastView) return false;
    this.lastView = view;
    for (const e of this.entries.values()) e.built.sketch.onCamera?.(this.o.camera);
    return true;
  }

  /** The camera was moved from outside (explore mode). */
  cameraMoved(): void {
    if (!this.refreshView()) return;
    // Rebuilt strokes start at full strength; give them back their emphasis.
    for (const [id, e] of this.entries) {
      const [emph, hide] = this.lastEmphasis.get(id) ?? [0, 0];
      e.emphasize(emph, hide);
    }
  }

  /** Where the current step's camera rests. */
  restingPose(): Pose {
    return this.poseFor(this.timelineFor(this.step).to.camera);
  }

  private poseFor(c: CameraState): Pose {
    const key = JSON.stringify(c);
    let pose = this.poses.get(key);
    if (!pose) {
      const reserve = this.o.deck.steps.some((st) => st.caption) ? CAPTION_BAND : 0;
      pose = solvePose(this.pointsFor(c.scope, c.fit), c.azimuth, c.elevation, c.zoom, c.fit ? 0.18 : 0.1, reserve);
      this.poses.set(key, pose);
    }
    return pose;
  }

  private scope(id: string): ResolvedScope {
    return this.o.resolved.scopes.find((s) => s.id === id)!;
  }

  /** World-space points that bound the given ids (or all of a scene). */
  pointsFor(scopeId: string, ids?: string[]): THREE.Vector3[] {
    const r = this.scope(scopeId);
    const want = ids ? new Set(ids) : undefined;
    const pts: THREE.Vector3[] = [];
    const w = (x: number, y: number, z: number) => new THREE.Vector3(...toWorld(r.transform, [x, y, z]));
    const rect = (b: [number, number, number, number], y: number) => {
      for (const [x, z] of [[b[0], b[1]], [b[2], b[1]], [b[0], b[3]], [b[2], b[3]]]) pts.push(w(x, y, z));
    };
    for (const l of r.layers) if (!want || want.has(l.id)) rect(l.bounds, l.y);
    for (const g of r.groups) if (want?.has(g.el.id)) rect(g.bounds, g.y);
    for (const s of r.shapes) {
      if (want && !want.has(s.el.id)) continue;
      const hw = s.footprint.type === "rect" ? s.footprint.hw : s.footprint.r;
      const hd = s.footprint.type === "rect" ? s.footprint.hd : s.footprint.r;
      rect([s.pos[0] - hw, s.pos[2] - hd, s.pos[0] + hw, s.pos[2] + hd], s.pos[1]);
      pts.push(w(s.pos[0], s.pos[1] + s.height + 0.5, s.pos[2]));
    }
    for (const a of r.arrows) {
      if (want?.has(a.el.id)) pts.push(w(...a.from), w(...a.to));
    }
    return pts.length ? pts : [new THREE.Vector3()];
  }

  private flowPoints(path: string[]): THREE.Vector3[] {
    const pts: THREE.Vector3[] = [];
    for (const id of path) {
      for (const sc of this.o.resolved.scopes) {
        const a = sc.arrows.find((x) => x.el.id === id);
        if (a) pts.push(new THREE.Vector3(...toWorld(sc.transform, a.from)), new THREE.Vector3(...toWorld(sc.transform, a.to)));
      }
    }
    return pts;
  }

  private applyFlows(flows: Frame["flows"]): void {
    const live = new Set<string>();
    for (const f of flows) {
      const key = f.path.join(">");
      live.add(key);
      let dots = this.flows.get(key);
      if (!dots) {
        dots = new FlowDots(this.flowPoints(f.path), f.dots, this.o.theme.accent, this.o.theme.paper);
        this.flows.set(key, dots);
        this.o.scene.add(dots.group);
      }
      dots.update(f.k);
    }
    for (const [key, dots] of this.flows) {
      if (live.has(key)) continue;
      this.o.scene.remove(dots.group);
      dots.dispose();
      this.flows.delete(key);
    }
  }
}
