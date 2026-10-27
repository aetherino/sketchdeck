import type { Action, Aside, CameraKey, Deck } from "../schema/deck";
import { ROOT, scopesOf } from "./validate";

// What the scene looks like once a step has settled. A pure function of the
// step index: state(i) = initial state with steps 0..i applied.

/** -1 dimmed, 0 normal, 1 highlighted. */
export type Emphasis = -1 | 0 | 1;

export interface CameraState {
  /** The scene this camera looks at; "fit everything" means everything in it. */
  scope: string;
  fit?: string[];
  azimuth: number;
  elevation: number;
  zoom: number;
}

export interface State {
  visible: Record<string, boolean>;
  emphasis: Record<string, Emphasis>;
  camera: CameraState;
  caption?: string;
  /** The step's aside card, if it has one. Like the caption, it lasts one step. */
  aside?: Aside;
  /** The layer this step zooms onto, if any. Lasts one step. */
  plane?: string;
  /** Scenes dived into, outermost first: [ROOT, …]. */
  scope: string[];
  /** The camera to return to when surfacing from each level. */
  cameras: CameraState[];
}

export const DEFAULT_CAMERA: Omit<CameraState, "scope"> = { azimuth: 18, elevation: 24, zoom: 1 };

/** Camera keys are absolute: anything left out takes the deck's default. */
export function cameraFromKey(key: CameraKey, scope: string, base = DEFAULT_CAMERA): CameraState {
  return {
    scope,
    fit: key.fit,
    azimuth: key.azimuth ?? base.azimuth,
    elevation: key.elevation ?? base.elevation,
    zoom: key.zoom ?? base.zoom,
  };
}

export interface SceneIndex {
  /** Every layer and element id, scene by scene, in drawing order (layers, groups, shapes, arrows). */
  order: string[];
  /** Element id → its layer id (arrows have none). */
  layerOf: Record<string, string | undefined>;
  /** Layer or element id → the scene it belongs to. */
  scopeOf: Record<string, string>;
  /** Scene id → its parent scene. */
  parentOf: Record<string, string | undefined>;
  /** The deck's default camera angle. */
  view: Omit<CameraState, "scope">;
}

export function indexDeck(deck: Deck): SceneIndex {
  const order: string[] = [];
  const layerOf: Record<string, string | undefined> = {};
  const scopeOf: Record<string, string> = {};
  const parentOf: Record<string, string | undefined> = {};
  for (const sc of scopesOf(deck)) {
    parentOf[sc.id] = sc.parent;
    const onlyLayer = sc.layers.length === 1 ? sc.layers[0].id : undefined;
    const groups: string[] = [];
    const shapes: string[] = [];
    const arrows: string[] = [];
    for (const e of sc.elements) {
      scopeOf[e.id] = sc.id;
      if (e.kind === "arrow") arrows.push(e.id);
      else {
        layerOf[e.id] = e.layer ?? onlyLayer;
        (e.kind === "group" ? groups : shapes).push(e.id);
      }
    }
    for (const l of sc.layers) scopeOf[l.id] = sc.id;
    order.push(...sc.layers.map((l) => l.id), ...groups, ...shapes, ...arrows);
  }
  const view = { ...DEFAULT_CAMERA, ...deck.view };
  return { order, layerOf, scopeOf, parentOf, view };
}

export const currentScope = (s: State) => s.scope[s.scope.length - 1];

function forEachAction(actions: Action[], fn: (a: Action) => void): void {
  for (const a of actions) {
    if (a.type === "together") forEachAction(a.together, fn);
    else fn(a);
  }
}

export function initialState(deck: Deck, index: SceneIndex): State {
  // Anything whose first visibility change is a reveal starts hidden.
  const firstChange = new Map<string, "reveal" | "remove">();
  for (const step of deck.steps) {
    forEachAction(step.do, (a) => {
      if (a.type === "reveal") for (const id of a.reveal) if (!firstChange.has(id)) firstChange.set(id, "reveal");
      if (a.type === "remove") for (const id of a.remove) if (!firstChange.has(id)) firstChange.set(id, "remove");
    });
  }
  const hidden = new Set(deck.initial.hidden);
  const dimmed = new Set(deck.initial.dimmed);
  const visible: Record<string, boolean> = {};
  const emphasis: Record<string, Emphasis> = {};
  for (const id of index.order) {
    visible[id] = !hidden.has(id) && firstChange.get(id) !== "reveal";
    emphasis[id] = dimmed.has(id) ? -1 : 0;
  }
  return { visible, emphasis, camera: { scope: ROOT, ...index.view }, scope: [ROOT], cameras: [] };
}

export function cloneState(s: State): State {
  return {
    visible: { ...s.visible },
    emphasis: { ...s.emphasis },
    camera: { ...s.camera },
    caption: s.caption,
    aside: s.aside,
    plane: s.plane,
    scope: [...s.scope],
    cameras: s.cameras.map((c) => ({ ...c })),
  };
}

/** The emphasis every id should have after `focus` on `targets`. */
export function focusEmphasis(state: State, targets: string[], index: SceneIndex): Record<string, Emphasis> {
  const keep = new Set(targets);
  // The planes the focused elements sit on stay as context.
  for (const id of targets) {
    const layer = index.layerOf[id];
    if (layer) keep.add(layer);
  }
  // Only the scene being shown takes part; other scenes keep their emphasis.
  const here = currentScope(state);
  const out: Record<string, Emphasis> = {};
  for (const id of index.order) {
    if (index.scopeOf[id] !== here) continue;
    out[id] = keep.has(id) ? (targets.includes(id) ? 0 : state.emphasis[id]) : state.visible[id] ? -1 : state.emphasis[id];
  }
  return out;
}

/** Apply one action to a state, in place. */
export function applyAction(state: State, a: Action, index: SceneIndex): void {
  switch (a.type) {
    case "reveal":
      for (const id of a.reveal) state.visible[id] = true;
      break;
    case "remove":
      for (const id of a.remove) state.visible[id] = false;
      break;
    case "highlight":
      for (const id of a.highlight) state.emphasis[id] = 1;
      break;
    case "dim":
      for (const id of a.dim) state.emphasis[id] = -1;
      break;
    case "focus":
      Object.assign(state.emphasis, focusEmphasis(state, a.focus, index));
      break;
    case "clear":
      for (const id of index.order) state.emphasis[id] = 0;
      break;
    case "camera":
      state.camera = cameraFromKey(a.camera, currentScope(state), index.view);
      break;
    case "dive":
      state.cameras.push(state.camera);
      state.scope.push(a.dive);
      state.camera = { scope: a.dive, ...index.view };
      break;
    case "surface":
      if (state.scope.length > 1) {
        state.scope.pop();
        state.camera = state.cameras.pop()!;
      }
      break;
    case "together":
      for (const c of a.together) applyAction(state, c, index);
      break;
    case "flow":
    case "wait":
      break;
  }
}

/** The settled state after step `i` (i = -1 is the state before any step). */
export function settled(deck: Deck, index: SceneIndex, i: number): State {
  const s = initialState(deck, index);
  for (let k = 0; k <= Math.min(i, deck.steps.length - 1); k++) {
    for (const a of deck.steps[k].do) applyAction(s, a, index);
    s.caption = deck.steps[k].caption;
    s.aside = deck.steps[k].aside;
    s.plane = deck.steps[k].plane;
  }
  return s;
}
