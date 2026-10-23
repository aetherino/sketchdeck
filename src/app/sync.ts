// Keeps the presenter view and the stage on the same step. Each window
// applies what the other sends without sending it back.

export type StepMessage = { type: "goto"; step: number; mode: "play" | "show" };

const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("sketchdeck") : undefined;

export function broadcast(msg: StepMessage): void {
  channel?.postMessage(msg);
}

export function onBroadcast(fn: (msg: StepMessage) => void): void {
  channel?.addEventListener("message", (e) => fn(e.data as StepMessage));
}
