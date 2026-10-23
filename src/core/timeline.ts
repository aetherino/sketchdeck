import type { Action, Deck } from "../schema/deck";
import {
  cameraFromKey, cloneState, currentScope, focusEmphasis, type CameraState, type SceneIndex, type State,
} from "./state";

// A step compiled into tracks on a timeline. `frame(t)` is pure, and at
// t ≥ duration it equals the settled state — so a finished step is still.

/** Tuned defaults, in seconds. The motion budget lives here. */
export const TIMING = {
  draw: 1.0,
  drawStagger: 0.22,
  /** Stagger for the opening draw of everything initially visible. */
  openingStagger: 0.1,
  remove: 0.6,
  emphasis: 0.55,
  camera: 1.5,
  dive: 2.6,
  surface: 2.0,
  flowSpeed: 5, // world units per second
  flowMin: 1.0,
  flowMax: 4.0,
  caption: 0.5,
};

export type Ease = "out" | "inOut" | "linear";

export type Track =
  | { kind: "vis"; id: string; from: number; to: number; start: number; dur: number }
  | { kind: "emph"; id: string; from: number; to: number; start: number; dur: number }
  | { kind: "camera"; from: CameraState; to: CameraState; start: number; dur: number }
  | { kind: "flow"; path: string[]; dots: number; start: number; dur: number }
  | { kind: "caption"; text?: string; start: number; dur: number }
  | { kind: "scope"; from: string; to: string; start: number; dur: number };

export interface Timeline {
  duration: number;
  tracks: Track[];
  /** State the step starts from (fully applied before any track runs). */
  from: State;
  to: State;
}

export interface Frame {
  vis: Record<string, number>;
  emph: Record<string, number>;
  /** Camera transition in progress, or the resting camera. */
  camera: { from: CameraState; to: CameraState; k: number };
  flows: { path: string[]; dots: number; k: number }[];
  caption: { text?: string; opacity: number };
  /** The scene being shown, or a dive/surface between two scenes in progress. */
  scope: { from: string; to: string; k: number };
}

export interface FlowLength {
  (path: string[]): number;
}

const ease = {
  out: (k: number) => 1 - (1 - k) ** 2.2,
  inOut: (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2),
  linear: (k: number) => k,
};

/**
 * Compile step `i`. Step 0 also draws in everything that is visible before
 * the first step, so a deck opens by sketching itself.
 */
export function compileStep(deck: Deck, index: SceneIndex, before: State, i: number, flowLength: FlowLength): Timeline {
  const step = deck.steps[i];
  const state = cloneState(before);
  const tracks: Track[] = [];
  let cursor = 0;

  const from = cloneState(before);
  if (i === 0) {
    // The opening: everything initially visible starts undrawn.
    let t = 0;
    for (const id of index.order) {
      if (!before.visible[id] || index.scopeOf[id] !== currentScope(before)) continue;
      from.visible[id] = false;
      tracks.push({ kind: "vis", id, from: 0, to: 1, start: t, dur: TIMING.draw });
      t += TIMING.openingStagger;
    }
    if (t > 0) cursor = t - TIMING.openingStagger + TIMING.draw * 0.8;
  }

  if (step && step.caption !== before.caption) {
    tracks.push({ kind: "caption", text: step.caption, start: 0, dur: TIMING.caption });
  }

  const emphTo = (id: string, to: number, start: number, dur: number) => {
    const fromE = state.emphasis[id];
    if (fromE !== to) tracks.push({ kind: "emph", id, from: fromE, to, start, dur });
  };

  /** Schedule one action at `start`; returns when it ends. */
  const schedule = (a: Action, start: number): number => {
    const t0 = start + ("delay" in a && a.delay ? a.delay : 0);
    switch (a.type) {
      case "reveal": {
        const dur = a.duration ?? TIMING.draw;
        const stagger = a.stagger ?? TIMING.drawStagger;
        let end = t0;
        a.reveal.forEach((id, k) => {
          if (state.visible[id]) return;
          tracks.push({ kind: "vis", id, from: 0, to: 1, start: t0 + k * stagger, dur });
          state.visible[id] = true;
          end = Math.max(end, t0 + k * stagger + dur);
        });
        return end;
      }
      case "remove": {
        const dur = a.duration ?? TIMING.remove;
        let end = t0;
        for (const id of a.remove) {
          if (!state.visible[id]) continue;
          tracks.push({ kind: "vis", id, from: 1, to: 0, start: t0, dur });
          state.visible[id] = false;
          end = t0 + dur;
        }
        return end;
      }
      case "highlight":
      case "dim":
      case "focus":
      case "clear": {
        const dur = a.duration ?? TIMING.emphasis;
        let next: Record<string, number>;
        if (a.type === "highlight") next = Object.fromEntries(a.highlight.map((id) => [id, 1]));
        else if (a.type === "dim") next = Object.fromEntries(a.dim.map((id) => [id, -1]));
        else if (a.type === "focus") next = focusEmphasis(state, a.focus, index);
        else next = Object.fromEntries(index.order.map((id) => [id, 0]));
        for (const [id, e] of Object.entries(next)) {
          emphTo(id, e, t0, dur);
          state.emphasis[id] = e as -1 | 0 | 1;
        }
        return t0 + dur;
      }
      case "camera": {
        const dur = a.duration ?? TIMING.camera;
        const to = cameraFromKey(a.camera, currentScope(state), index.view);
        tracks.push({ kind: "camera", from: { ...state.camera }, to, start: t0, dur });
        state.camera = to;
        return t0 + dur;
      }
      case "dive": {
        const dur = a.duration ?? TIMING.dive;
        const to: CameraState = { scope: a.dive, ...index.view };
        tracks.push({ kind: "camera", from: { ...state.camera }, to, start: t0, dur });
        tracks.push({ kind: "scope", from: currentScope(state), to: a.dive, start: t0, dur });
        state.cameras.push(state.camera);
        state.scope.push(a.dive);
        state.camera = to;
        return t0 + dur;
      }
      case "surface": {
        if (state.scope.length < 2) return t0;
        const dur = a.duration ?? TIMING.surface;
        const leaving = state.scope.pop()!;
        const to = state.cameras.pop()!;
        tracks.push({ kind: "camera", from: { ...state.camera }, to, start: t0, dur });
        tracks.push({ kind: "scope", from: leaving, to: currentScope(state), start: t0, dur });
        state.camera = to;
        return t0 + dur;
      }
      case "flow": {
        const natural = flowLength(a.flow) / TIMING.flowSpeed;
        const dur = a.duration ?? Math.min(TIMING.flowMax, Math.max(TIMING.flowMin, natural));
        tracks.push({ kind: "flow", path: a.flow, dots: a.dots ?? 3, start: t0, dur });
        return t0 + dur;
      }
      case "wait":
        return t0 + a.wait;
      case "together": {
        let end = t0;
        for (const c of a.together) end = Math.max(end, schedule(c, t0));
        return end;
      }
    }
  };

  for (const a of step?.do ?? []) cursor = schedule(a, cursor);
  state.caption = step?.caption;

  const duration = tracks.reduce((m, tr) => Math.max(m, tr.start + tr.dur), 0);
  return { duration, tracks, from, to: state };
}

/** The scene at time `t` into a step. Pure. */
export function frameAt(tl: Timeline, t: number): Frame {
  const f: Frame = {
    vis: Object.fromEntries(Object.entries(tl.from.visible).map(([id, v]) => [id, v ? 1 : 0])),
    emph: { ...tl.from.emphasis },
    camera: { from: tl.from.camera, to: tl.from.camera, k: 1 },
    flows: [],
    caption: { text: tl.from.caption, opacity: tl.from.caption ? 1 : 0 },
    scope: { from: currentScope(tl.from), to: currentScope(tl.from), k: 1 },
  };
  for (const tr of tl.tracks) {
    if (t < tr.start) continue;
    const k = Math.min(1, (t - tr.start) / tr.dur);
    switch (tr.kind) {
      case "vis":
        f.vis[tr.id] = tr.from + (tr.to - tr.from) * ease.out(k);
        break;
      case "emph":
        f.emph[tr.id] = tr.from + (tr.to - tr.from) * ease.inOut(k);
        break;
      case "camera":
        f.camera = { from: tr.from, to: tr.to, k: ease.inOut(k) };
        break;
      case "flow":
        if (k < 1) f.flows.push({ path: tr.path, dots: tr.dots, k: ease.inOut(k) });
        break;
      case "scope":
        // Linear here; the player shapes each scene's fade and draw-in.
        f.scope = k < 1 ? { from: tr.from, to: tr.to, k } : { from: tr.to, to: tr.to, k: 1 };
        break;
      case "caption":
        // Cross-fade: the old caption fades out in the first half, the new in the second.
        f.caption = k < 0.5
          ? { text: tl.from.caption, opacity: tl.from.caption ? 1 - k * 2 : 0 }
          : { text: tr.text, opacity: tr.text ? (k - 0.5) * 2 : 0 };
        break;
    }
  }
  return f;
}

/** The settled frame of a timeline: identical to frameAt(tl, duration). */
export function settledFrame(tl: Timeline): Frame {
  return frameAt(tl, tl.duration + 1);
}
