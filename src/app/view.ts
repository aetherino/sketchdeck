import * as THREE from "three";
import { resolve, type ResolvedScene } from "../core/resolve";
import { indexDeck, type SceneIndex } from "../core/state";
import { DeckError, validate } from "../core/validate";
import type { Deck } from "../schema/deck";
import { applyPose, STAGE_H, STAGE_W, type Pose } from "../render/camera";
import { lineGlobals } from "../render/fatline";
import { buildScene, themes, type BuiltElement, type Theme } from "../styles/sketch";
import { AsideCard } from "./aside";
import { Caption } from "./caption";
import { lint, type LintIssue } from "./lint";
import { Player } from "./player";

// One rendering of a deck on one canvas: the main stage, or the presenter's
// next-step preview. Renders only when asked, or while its player animates.

export interface Box2 {
  left: number;
  top: number;
  width: number;
  height: number;
}

export class DeckView {
  readonly renderer: THREE.WebGLRenderer;
  readonly camera = new THREE.OrthographicCamera();
  scene = new THREE.Scene();
  player?: Player;
  theme: Theme = themes.paper;
  deck?: Deck;
  private caption?: Caption;
  private aside: AsideCard;
  private built: BuiltElement[] = [];
  private resolved?: ResolvedScene;
  private index?: SceneIndex;
  private frameQueued = false;
  /** Extra per-frame work (explore mode's camera return). Returns whether it continues. */
  onFrame?: (now: number) => boolean;
  /** The step changed (local navigation or a build). */
  onStep?: (step: number) => void;

  constructor(readonly canvas: HTMLCanvasElement, opts: { caption: boolean }) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setClearColor(themes.paper.background);
    if (opts.caption) this.caption = new Caption(canvas);
    this.aside = new AsideCard(canvas);
  }

  /** Build a deck. Returns the problems if it is invalid (and keeps the old scene). */
  build(input: unknown, themeOverride?: string | null): string[] {
    let deck: Deck;
    try {
      deck = validate(input);
    } catch (e) {
      if (e instanceof DeckError) return e.issues;
      throw e;
    }
    const resolved = resolve(deck);
    const theme = themes[themeOverride as keyof typeof themes] ?? themes[resolved.theme];
    this.theme = theme;
    this.deck = deck;
    this.resolved = resolved;
    this.renderer.setClearColor(theme.background);
    this.caption?.setTheme(theme);
    this.aside.setTheme(theme);

    this.dispose();
    this.scene = new THREE.Scene();
    const { built, roots } = buildScene(resolved, theme);
    this.built = built;
    for (const root of roots) this.scene.add(root);
    // Text meshes lay out asynchronously; redraw whenever one finishes.
    this.scene.traverse((o) => o.addEventListener("synccomplete" as never, () => this.invalidate()));

    this.index = indexDeck(deck);
    const silentCaption = { set() {}, setTheme() {}, layout() {} } as unknown as Caption;
    this.player = new Player({
      scene: this.scene, camera: this.camera, deck, index: this.index, resolved, built, theme,
      caption: this.caption ?? silentCaption, aside: this.aside, invalidate: () => this.invalidate(),
    });
    this.player.onStep = (i) => this.onStep?.(i);
    return [];
  }

  /** Fit the 16:9 stage inside a box on the page, letterboxed. */
  layout(box: Box2): void {
    const scale = Math.min(box.width / STAGE_W, box.height / STAGE_H);
    const w = Math.max(1, Math.round(STAGE_W * scale));
    const h = Math.max(1, Math.round(STAGE_H * scale));
    this.canvas.style.left = `${Math.round(box.left + (box.width - w) / 2)}px`;
    this.canvas.style.top = `${Math.round(box.top + (box.height - h) / 2)}px`;
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(w, h);
    this.caption?.layout();
    this.aside.layout();
    this.invalidate();
  }

  invalidate(): void {
    if (this.frameQueued) return;
    this.frameQueued = true;
    requestAnimationFrame((now) => {
      this.frameQueued = false;
      const playing = this.player?.tick(now) ?? false;
      const extra = this.onFrame?.(now) ?? false;
      this.renderNow();
      if (playing || extra) this.invalidate();
    });
  }

  /** Draw immediately. Line widths are set for this canvas, since views share them. */
  renderNow(): void {
    const buf = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    lineGlobals.uResolution.value.copy(buf);
    lineGlobals.uPixelScale.value = buf.x / STAGE_W;
    this.renderer.render(this.scene, this.camera);
  }

  /** Point the camera somewhere outside the deck's script (explore mode). */
  setPose(pose: Pose): void {
    applyPose(this.camera, pose);
    this.player?.cameraMoved();
  }

  lint(): LintIssue[] {
    const p = this.player;
    if (!p || !this.deck || !this.resolved || !this.index) return [];
    const at = p.step;
    const issues = lint({
      deck: this.deck, index: this.index, resolved: this.resolved, built: this.built, player: p,
      scene: this.scene, camera: this.camera,
    });
    p.show(at);
    return issues;
  }

  private dispose(): void {
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
      for (const mat of mats) mat.dispose();
    });
  }
}
