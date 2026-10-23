import { defineDeck } from "sketchdeck";

// ADR-014: Decouple checkout with an event bus.
// The quality bar for decks: one idea per step, motion only where the eye
// should go, and the decision stated plainly before the detail.

export default defineDeck({
  title: "Decoupling checkout with events",
  theme: "paper",
  layers: [
    { id: "clients", label: "Clients", tint: "violet", gap: 3.8 },
    { id: "services", label: "Services", tint: "blue", gap: 3.8 },
    { id: "infra", label: "Data & messaging", tint: "sand" },
  ],
  elements: [
    // Clients
    { id: "customer", kind: "person", layer: "clients", at: [-3.5, 0], label: "Customer" },
    { id: "web", kind: "box", layer: "clients", at: [0.5, 0], size: [2.8, 1.8], label: "Web", icon: "react", color: "violet" },

    // Services
    {
      id: "checkout", kind: "box", layer: "services", at: [0.5, 0], size: [3.4, 2.2], label: "Checkout", icon: "cart", color: "yellow",
      children: {
        layers: [{ id: "checkout-inside", label: "Inside checkout", tint: "yellow" }],
        elements: [
          { id: "handler", kind: "box", at: [-5, 0], size: [3.9, 1.8], label: "Place order", icon: "zap", color: "yellow" },
          { id: "orders-table", kind: "database", at: [0, 1.6], size: 1.9, label: "orders", color: "blue" },
          { id: "outbox", kind: "database", at: [0, -1.8], size: 1.9, label: "outbox", color: "green" },
          { id: "tx", kind: "group", contains: ["orders-table", "outbox"], label: "one transaction", color: "blue" },
          { id: "relay", kind: "box", at: [5, -1.8], size: [2.6, 1.8], label: "Relay", icon: "send", color: "green" },
          { id: "i-handler-orders", kind: "arrow", from: "handler", to: "orders-table" },
          { id: "i-handler-outbox", kind: "arrow", from: "handler", to: "outbox" },
          { id: "i-outbox-relay", kind: "arrow", from: "outbox", to: "relay", label: "poll" },
        ],
      },
    },
    { id: "payments", kind: "box", layer: "services", at: [-4.6, 1.6], size: [3.3, 1.8], label: "Payments", icon: "stripe", color: "violet" },
    { id: "inventory", kind: "box", layer: "services", at: [-4.6, -1.9], size: [3.3, 1.8], label: "Inventory", icon: "package", color: "green" },
    { id: "email", kind: "box", layer: "services", at: [5.6, 1.6], size: [3.0, 1.8], label: "Email", icon: "mail", color: "red" },
    { id: "analytics", kind: "box", layer: "services", at: [5.6, -1.9], size: [3.3, 1.8], label: "Analytics", icon: "chart", color: "gray" },
    { id: "slow", kind: "text", layer: "services", at: [8.6, 2.6], label: "p99 2.4 s", color: "red", size: 0.46 },

    // Data & messaging
    { id: "orders-db", kind: "database", layer: "infra", at: [-3, 0.3], label: "Orders", icon: "postgres", color: "blue" },
    { id: "bus", kind: "queue", layer: "infra", at: [3.2, 0.3], size: [4, 1], label: "order.placed", icon: "kafka", color: "green" },

    // Today: checkout calls everyone, in a row.
    { id: "a-customer-web", kind: "arrow", from: "customer", to: "web" },
    { id: "a-web-checkout", kind: "arrow", from: "web", to: "checkout" },
    { id: "a-checkout-payments", kind: "arrow", from: "checkout", to: "payments" },
    { id: "a-checkout-inventory", kind: "arrow", from: "checkout", to: "inventory" },
    { id: "a-checkout-email", kind: "arrow", from: "checkout", to: "email" },
    { id: "a-checkout-analytics", kind: "arrow", from: "checkout", to: "analytics" },
    { id: "a-checkout-db", kind: "arrow", from: "checkout", to: "orders-db" },

    // Tomorrow: one event, many listeners.
    { id: "a-checkout-bus", kind: "arrow", from: "checkout", to: "bus", label: "publish" },
    { id: "a-bus-email", kind: "arrow", from: "bus", to: "email", dashed: true },
    { id: "a-bus-analytics", kind: "arrow", from: "bus", to: "analytics", dashed: true },
    { id: "a-bus-inventory", kind: "arrow", from: "bus", to: "inventory", dashed: true },
  ],
  initial: { hidden: ["bus", "a-checkout-bus", "a-bus-email", "a-bus-analytics", "a-bus-inventory", "slow"] },
  steps: [
    {
      caption: "Checkout calls four services before it can say yes",
      notes: "Orient: three layers. Today, placing an order is one long synchronous chain.",
    },
    {
      notes: "Trace one order. Every hop is on the customer's clock.",
      do: [
        { flow: ["a-customer-web", "a-web-checkout", "a-checkout-email"], dots: 3 },
      ],
    },
    {
      caption: "If email is slow, checkout is slow",
      notes: "The incident from March: the email provider degraded, conversion dropped 9%.",
      do: [
        { focus: ["checkout", "email", "analytics", "a-checkout-email", "a-checkout-analytics", "slow"] },
        { together: [{ highlight: ["email"] }, { reveal: "slow" }] },
      ],
    },
    {
      caption: "Decision: publish one event, let services listen",
      notes: "State the decision before the detail. Email and analytics never needed to block the order.",
      do: [
        { clear: true },
        { remove: ["a-checkout-email", "a-checkout-analytics", "a-checkout-inventory", "slow"] },
        { reveal: ["bus", "a-checkout-bus"] },
      ],
    },
    {
      notes: "Consumers subscribe at their own pace. A slow consumer is now only slow for itself.",
      do: [
        { reveal: ["a-bus-email", "a-bus-analytics", "a-bus-inventory"], stagger: 0.3 },
        { flow: ["a-checkout-bus", "a-bus-email"], dots: 3 },
      ],
    },
    {
      caption: "Payments stays synchronous: we need the answer",
      notes: "Not everything becomes async. We can't confirm an order without a payment result.",
      do: [
        { camera: { fit: ["checkout", "payments", "inventory", "orders-db", "web"] } },
        { highlight: ["payments", "a-checkout-payments"] },
      ],
    },
    {
      caption: "Inside checkout: the outbox makes publishing safe",
      notes: "The obvious bug: write the order, then crash before publishing. The outbox closes that gap.",
      do: [
        { together: [{ clear: true }, { camera: {} }] },
        { dive: "checkout" },
      ],
    },
    {
      notes: "Order row and event row commit together. The relay ships events after the fact, at least once.",
      do: [
        { flow: ["i-handler-outbox", "i-outbox-relay"], dots: 2 },
        { highlight: "tx" },
      ],
    },
    {
      caption: "Checkout now waits only for what it needs",
      notes: "Back out. Summarize: payments in the request path, everything else on the bus.",
      do: [
        { surface: true },
        { flow: ["a-web-checkout", "a-checkout-payments"], dots: 2 },
      ],
    },
    {
      caption: "Trade-off: eventual consistency for email and analytics",
      notes: "Name the cost. Confirmation emails may lag by seconds. We accept that.",
      do: [
        { focus: ["bus", "email", "analytics", "a-bus-email", "a-bus-analytics"] },
      ],
    },
  ],
});
