// The page: the stage (or, with ?presenter, the speaker's view), keyboard
// navigation, explore mode, window sync, and hooks for the CLI.

import { preloadFont } from "troika-three-text";
import deckInput from "@deck";
import { fontUrl } from "../styles/sketch";
import { Explore } from "./explore";
import { showErrors } from "./overlay";
import { PresenterUI } from "./presenter";
import { broadcast, onBroadcast, type StepMessage } from "./sync";
import { DeckView } from "./view";

const params = new URLSearchParams(location.search);
const isPresenter = params.has("presenter");

const view = new DeckView(document.getElementById("stage") as HTMLCanvasElement, { caption: true });
const explore = new Explore(view);

let presenter: PresenterUI | undefined;
let preview: DeckView | undefined;
if (isPresenter) {
  const canvas = document.createElement("canvas");
  presenter = new PresenterUI(canvas);
  preview = new DeckView(canvas, { caption: false });
}

function layout(): void {
  view.layout(presenter ? presenter.stageBox() : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight });
  explore.layout();
  if (presenter && preview) preview.layout(presenter.previewBox());
}

/** Keep the URL, the presenter panel and the preview on the current step. */
function stepChanged(step: number): void {
  const p = view.player;
  if (!p) return;
  if (!isPresenter) {
    const url = new URL(location.href);
    url.searchParams.set("step", String(step + 1));
    history.replaceState(null, "", url);
  }
  if (presenter && view.deck) {
    presenter.update(view.deck.title, step, p.count, p.notes);
    if (preview?.player && step + 1 < p.count) {
      preview.player.show(step + 1);
      preview.invalidate();
    }
  }
}
view.onStep = stepChanged;

function build(input: unknown): boolean {
  const issues = view.build(input, params.get("theme"));
  showErrors(issues);
  if (issues.length) {
    console.error(`Deck has problems:\n${issues.join("\n")}`);
    return false;
  }
  document.title = isPresenter ? `Presenter · ${view.deck!.title}` : view.deck!.title;
  if (!isPresenter) document.body.style.background = view.theme.letterbox;
  preview?.build(input, params.get("theme"));
  return true;
}

// ── Navigation, mirrored to the other window ─────────────────────────────────

function apply(msg: StepMessage): void {
  const p = view.player;
  if (!p) return;
  if (explore.active) explore.exit(false);
  if (msg.mode === "play") p.play(msg.step);
  else p.show(msg.step);
}

function navigate(kind: "next" | "prev" | "first" | "last" | "replay"): void {
  const p = view.player;
  if (!p) return;
  if (explore.active) explore.exit(false);
  const before = p.step;
  switch (kind) {
    case "next": {
      const wasAnimating = p.animating;
      p.next();
      broadcast({ type: "goto", step: p.step, mode: !wasAnimating && p.step !== before ? "play" : "show" });
      return;
    }
    case "prev":
      p.prev();
      break;
    case "first":
      p.show(0);
      break;
    case "last":
      p.show(p.count - 1);
      break;
    case "replay":
      p.play(p.step);
      broadcast({ type: "goto", step: p.step, mode: "play" });
      return;
  }
  broadcast({ type: "goto", step: p.step, mode: "show" });
}

onBroadcast(apply);

function openPresenter(): void {
  const url = new URL(location.href);
  url.searchParams.set("presenter", "");
  url.searchParams.set("step", String((view.player?.step ?? 0) + 1));
  window.open(url, "sketchdeck-presenter", "width=1400,height=860");
}

window.addEventListener("keydown", (ev) => {
  if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
  switch (ev.key) {
    case "ArrowRight":
    case "PageDown":
    case " ":
      navigate("next");
      break;
    case "ArrowLeft":
    case "PageUp":
      navigate("prev");
      break;
    case "Home":
      navigate("first");
      break;
    case "End":
      navigate("last");
      break;
    case "r":
    case "R":
      navigate("replay");
      break;
    case "e":
    case "E":
      if (explore.active) explore.exit();
      else explore.enter();
      break;
    case "Escape":
      if (!explore.active) return;
      explore.exit();
      break;
    case "f":
    case "F":
      if (document.fullscreenElement) void document.exitFullscreen();
      else void document.documentElement.requestFullscreen();
      break;
    case "p":
    case "P":
      if (!isPresenter) openPresenter();
      break;
    default:
      return;
  }
  ev.preventDefault();
});

// The cursor gets out of the way while presenting.
let idle: ReturnType<typeof setTimeout> | undefined;
window.addEventListener("mousemove", () => {
  document.body.style.cursor = "";
  clearTimeout(idle);
  if (!isPresenter) idle = setTimeout(() => !explore.active && (document.body.style.cursor = "none"), 2500);
});

new ResizeObserver(layout).observe(document.documentElement);

// ── Hooks for the CLI renderer: jump to any step or moment and draw it now ──
const api = {
  ready: false,
  get count() {
    return view.player?.count ?? 0;
  },
  duration: (i: number) => view.player?.duration(i) ?? 0,
  lint: () => view.lint(),
  goto(i: number, t?: number) {
    const p = view.player;
    if (!p) return;
    if (t === undefined) p.show(i);
    else p.seek(i, t);
    view.renderNow();
  },
};
Object.assign(window, { __sketchdeck: api });

preloadFont({ font: fontUrl }, () => {
  layout();
  if (build(deckInput)) {
    const start = Number(params.get("step") ?? 0) - 1;
    if (start >= 0 || isPresenter) view.player!.show(Math.max(0, start));
    else view.player!.play(0);
    layout();
  }
  api.ready = true;
  (window as unknown as { __ready: boolean }).__ready = true;
});

if (import.meta.hot) {
  import.meta.hot.accept("@deck", (mod) => {
    if (!mod) return;
    const at = view.player?.step ?? 0;
    // Keep your place: rebuild and land on the same step, settled.
    if (build(mod.default)) view.player!.show(at);
  });
}

if (import.meta.env.DEV) {
  Object.assign(window, { __debug: { view, get player() { return view.player; }, get renderer() { return view.renderer; } } });
}
