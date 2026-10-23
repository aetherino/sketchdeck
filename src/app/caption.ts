import { fontUrl } from "../styles/sketch";
import type { Theme } from "../styles/sketch";

// The step caption: one handwritten line near the bottom of the stage.

const face = new FontFace("Excalifont", `url(${fontUrl})`);
void face.load().then((f) => document.fonts.add(f));

export class Caption {
  private el = document.createElement("div");

  constructor(private canvas: HTMLCanvasElement) {
    Object.assign(this.el.style, {
      position: "absolute",
      textAlign: "center",
      fontFamily: "Excalifont, cursive",
      pointerEvents: "none",
      opacity: "0",
      whiteSpace: "nowrap",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      boxSizing: "border-box",
    });
    document.body.appendChild(this.el);
  }

  setTheme(theme: Theme): void {
    this.el.style.color = theme.ink;
    this.el.style.textShadow = `0 0 6px ${theme.paper}, 0 0 2px ${theme.paper}`;
    // A soft band of page color: whatever sits beneath the caption fades out
    // rather than colliding with it.
    this.el.style.background = `linear-gradient(to top, ${theme.paper} 0%, ${theme.paper} 55%, ${theme.paper}00 100%)`;
  }

  /** Keep the caption pinned to the stage as the window resizes. */
  layout(): void {
    const r = this.canvas.getBoundingClientRect();
    Object.assign(this.el.style, {
      left: `${r.left}px`,
      width: `${r.width}px`,
      top: `${r.top + r.height * 0.84}px`,
      height: `${r.height * 0.16}px`,
      paddingTop: `${r.height * 0.02}px`,
      fontSize: `${r.height * 0.042}px`,
    });
  }

  set(text: string | undefined, opacity: number): void {
    if (text !== undefined && this.el.textContent !== text) this.el.textContent = text;
    this.el.style.opacity = String(text ? opacity : 0);
  }
}
