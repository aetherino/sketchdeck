import type { Box2 } from "./view";

// The speaker's window: the current step large, the next step small, notes,
// where you are, and how long you have been talking. Calm, dark chrome so it
// doesn't glare at the speaker; the deck keeps its own theme.

const css = `
  body.presenter { background: #141619; color: #e9e7e2; font: 15px/1.5 ui-sans-serif, system-ui, -apple-system, sans-serif; }
  .pv-header { position: fixed; inset: 0 0 auto 0; height: 52px; display: flex; align-items: center; gap: 24px;
    padding: 0 24px; border-bottom: 1px solid #24272c; }
  .pv-title { flex: 1; color: #9aa0a6; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pv-count { font-variant-numeric: tabular-nums; font-weight: 600; letter-spacing: 0.02em; }
  .pv-timer { font-variant-numeric: tabular-nums; color: #9aa0a6; cursor: pointer; min-width: 56px; text-align: right; }
  .pv-timer:hover { color: #e9e7e2; }
  .pv-side { position: fixed; top: 52px; right: 0; bottom: 0; width: 34%; padding: 20px 24px; box-sizing: border-box;
    display: flex; flex-direction: column; gap: 10px; border-left: 1px solid #24272c; }
  .pv-label { font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: #6f757c; }
  .pv-next { position: relative; aspect-ratio: 16 / 9; border-radius: 8px; overflow: hidden; background: #1c1f23; }
  .pv-end { position: absolute; inset: 0; display: grid; place-items: center; color: #6f757c; }
  .pv-notes { flex: 1; overflow: auto; font-size: 21px; line-height: 1.55; color: #e9e7e2; white-space: pre-wrap; }
  .pv-notes.empty { color: #4d5258; font-style: italic; }
  .pv-hint { font-size: 12px; color: #4d5258; }
  body.presenter #stage { border-radius: 8px; }
`;

export class PresenterUI {
  private title = document.createElement("div");
  private count = document.createElement("div");
  private timer = document.createElement("div");
  private next = document.createElement("div");
  private end = document.createElement("div");
  private notes = document.createElement("div");
  private started = performance.now();

  constructor(readonly previewCanvas: HTMLCanvasElement) {
    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
    document.body.classList.add("presenter");

    const header = document.createElement("div");
    header.className = "pv-header";
    this.title.className = "pv-title";
    this.count.className = "pv-count";
    this.timer.className = "pv-timer";
    this.timer.title = "Click to restart the timer";
    this.timer.addEventListener("click", () => (this.started = performance.now()));
    header.append(this.title, this.count, this.timer);

    const side = document.createElement("div");
    side.className = "pv-side";
    const nextLabel = document.createElement("div");
    nextLabel.className = "pv-label";
    nextLabel.textContent = "Next";
    this.next.className = "pv-next";
    this.end.className = "pv-end";
    this.end.textContent = "End of deck";
    previewCanvas.style.position = "absolute";
    this.next.append(previewCanvas, this.end);
    const notesLabel = document.createElement("div");
    notesLabel.className = "pv-label";
    notesLabel.textContent = "Notes";
    this.notes.className = "pv-notes";
    const hint = document.createElement("div");
    hint.className = "pv-hint";
    hint.textContent = "→ next · ← back · R replay · E explore · F fullscreen";
    side.append(nextLabel, this.next, notesLabel, this.notes, hint);

    document.body.append(header, side);
    setInterval(() => this.tick(), 500);
    this.tick();
  }

  /** Where the current-step stage goes. */
  stageBox(): Box2 {
    const pad = 24;
    const top = 52 + pad;
    const width = window.innerWidth * 0.66 - pad * 2;
    return { left: pad, top, width, height: window.innerHeight - top - pad };
  }

  /** Where the next-step preview goes, relative to its frame. */
  previewBox(): Box2 {
    const r = this.next.getBoundingClientRect();
    return { left: 0, top: 0, width: r.width, height: r.height };
  }

  update(title: string, step: number, count: number, notes: string | undefined): void {
    this.title.textContent = title;
    this.count.textContent = `${step + 1} / ${count}`;
    this.notes.textContent = notes ?? "No notes for this step.";
    this.notes.classList.toggle("empty", !notes);
    const last = step >= count - 1;
    this.end.style.display = last ? "grid" : "none";
    this.previewCanvas.style.visibility = last ? "hidden" : "visible";
  }

  private tick(): void {
    const s = Math.floor((performance.now() - this.started) / 1000);
    this.timer.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }
}
