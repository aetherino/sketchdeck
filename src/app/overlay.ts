// A quiet panel listing deck problems, shown over the stage until fixed.

let panel: HTMLElement | undefined;

export function showErrors(issues: string[]): void {
  if (!issues.length) {
    panel?.remove();
    panel = undefined;
    return;
  }
  if (!panel) {
    panel = document.createElement("div");
    Object.assign(panel.style, {
      position: "fixed",
      left: "24px",
      bottom: "24px",
      maxWidth: "min(720px, calc(100vw - 48px))",
      padding: "16px 20px",
      background: "#fff8f6",
      color: "#3b1f1b",
      border: "1px solid #f1c4bc",
      borderRadius: "10px",
      boxShadow: "0 6px 24px rgba(0,0,0,0.08)",
      font: "13px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace",
      zIndex: "10",
    });
    document.body.appendChild(panel);
  }
  panel.replaceChildren();
  const title = document.createElement("div");
  title.textContent = `Deck has ${issues.length} problem${issues.length === 1 ? "" : "s"}`;
  Object.assign(title.style, { fontWeight: "600", marginBottom: "6px" });
  panel.appendChild(title);
  for (const issue of issues) {
    const row = document.createElement("div");
    row.textContent = `• ${issue}`;
    panel.appendChild(row);
  }
}
