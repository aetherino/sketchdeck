import { defineDeck } from "sketchdeck";

export default defineDeck({
  title: "Moving session state to Redis",
  theme: "paper",
  layers: [
    { id: "edge", label: "Edge", tint: "violet" },
    { id: "app", label: "Application", tint: "blue" },
    { id: "data", label: "Data", tint: "sand" },
  ],
  elements: [
    // Edge
    { id: "user", kind: "person", layer: "edge", at: [-5.5, 0.5], label: "Shopper" },
    { id: "cdn", kind: "cloud", layer: "edge", at: [-1, 0.5], label: "CDN", icon: "cloudflare", color: "violet" },
    { id: "mobile", kind: "icon", layer: "edge", at: [3.5, 0.5], icon: "phone", label: "iOS app" },

    // Application
    { id: "web", kind: "box", layer: "app", at: [-3, 0], label: "Web", icon: "react", color: "violet" },
    {
      id: "api", kind: "box", layer: "app", at: [2.5, 0], size: [3.4, 2], label: "API", icon: "node", color: "yellow",
      children: {
        elements: [
          { id: "router", kind: "box", at: [-4, 0], size: [2.6, 1.8], label: "Router", icon: "split" },
          { id: "auth", kind: "box", at: [0, 1.6], size: [2.6, 1.8], label: "Auth", icon: "lock", color: "violet" },
          { id: "orders", kind: "box", at: [0, -1.6], size: [2.6, 1.8], label: "Orders", icon: "cart", color: "green" },
          { id: "sessions", kind: "box", at: [4.4, 1.6], size: [3.2, 1.8], label: "Sessions", icon: "key", color: "red" },
          { id: "i-router-auth", kind: "arrow", from: "router", to: "auth" },
          { id: "i-router-orders", kind: "arrow", from: "router", to: "orders" },
          { id: "i-auth-sessions", kind: "arrow", from: "auth", to: "sessions" },
        ],
      },
    },
    { id: "vpc", kind: "group", layer: "app", contains: ["web", "api"], label: "vpc-prod" },

    // Data
    { id: "redis", kind: "database", layer: "data", at: [-3, 0.5], size: 1.6, height: 1.2, label: "Redis", icon: "redis", color: "red" },
    { id: "pg", kind: "database", layer: "data", at: [2.5, 0.5], size: 2.1, label: "Postgres", icon: "postgres", color: "blue" },
    { id: "events", kind: "queue", layer: "data", at: [-0.2, -2.2], size: [3.2, 0.9], label: "events", color: "green" },
    { id: "note", kind: "text", layer: "data", at: [5.6, -1.6], label: "p95 420ms", color: "red", size: 0.42 },

    // Flows
    { id: "a-user-cdn", kind: "arrow", from: "user", to: "cdn" },
    { id: "a-cdn-web", kind: "arrow", from: "cdn", to: "web" },
    { id: "a-mobile-api", kind: "arrow", from: "mobile", to: "api" },
    { id: "a-web-api", kind: "arrow", from: "web", to: "api", label: "REST" },
    { id: "a-api-pg", kind: "arrow", from: "api", to: "pg" },
    { id: "a-api-redis", kind: "arrow", from: "api", to: "redis", label: "sessions", dashed: true },
    { id: "a-api-events", kind: "arrow", from: "api", to: "events", dashed: true },
  ],
  steps: [
    {
      caption: "Today, every request reads its session from Postgres",
      notes: "Set the scene: three layers, one request path.",
    },
    {
      notes: "Walk the request path end to end.",
      do: [
        { focus: ["user", "cdn", "web", "api", "pg", "a-user-cdn", "a-cdn-web", "a-web-api", "a-api-pg"] },
        { flow: ["a-user-cdn", "a-cdn-web", "a-web-api", "a-api-pg"] },
      ],
    },
    {
      caption: "Session reads are a third of Postgres load",
      notes: "Zoom in on the hot spot. The p95 is the number people remember.",
      do: [
        { camera: { fit: ["api", "pg", "note"], zoom: 1.05 } },
        { together: [{ highlight: "pg" }, { reveal: "note" }] },
      ],
    },
    {
      caption: "Move sessions to Redis",
      notes: "The decision: sessions go to Redis; Postgres keeps durable data.",
      do: [
        { together: [{ camera: {} }, { clear: true }] },
        { reveal: ["redis", "a-api-redis"] },
        { flow: ["a-web-api", "a-api-redis"] },
      ],
    },
    {
      caption: "Inside the API, only the session module changes",
      notes: "Dive in: one module swaps its store. Nothing else moves.",
      do: [
        { dive: "api" },
        { highlight: "sessions" },
        { flow: ["i-router-auth", "i-auth-sessions"], dots: 2 },
      ],
    },
    {
      caption: "…and session events go async",
      notes: "Audit trail moves to a queue, off the request path.",
      do: [
        { surface: true },
        { reveal: ["events", "a-api-events"] },
        { flow: ["a-api-events"], dots: 2 },
      ],
    },
    {
      caption: "Postgres keeps the durable data; Redis takes the churn",
      notes: "Close on the new shape of the system.",
      do: [{ remove: "note" }, { focus: ["api", "redis", "pg", "events", "a-api-redis", "a-api-pg", "a-api-events"] }],
    },
  ],
});
