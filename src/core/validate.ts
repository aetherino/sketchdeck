import type { z } from "zod";
import { Deck, type Action, type Element, type Layer } from "../schema/deck";

/** Every problem with a deck, each naming the element and how to fix it. */
export class DeckError extends Error {
  constructor(readonly issues: string[]) {
    super(`Deck has ${issues.length} problem${issues.length === 1 ? "" : "s"}:\n` + issues.map((i) => `  • ${i}`).join("\n"));
  }
}

function where(input: unknown, path: PropertyKey[]): string {
  const [head, index, ...rest] = path;
  // Steps and actions are numbered from 1, the way a presenter counts them.
  if (head === "steps" && typeof index === "number") {
    const [doKey, action, ...more] = rest;
    const tail = more.filter((k) => k !== "type");
    if (doKey === "do" && typeof action === "number") {
      return `step ${index + 1} → action ${action + 1}${tail.length ? ` → ${tail.join(".")}` : ""}`;
    }
    return `step ${index + 1}${rest.length ? ` → ${rest.join(".")}` : ""}`;
  }
  // Name elements and layers by id rather than array index where possible,
  // following nested child scenes down to the element that is wrong.
  let node: unknown = input;
  const parts: string[] = [];
  for (let i = 0; i < path.length; i++) {
    const key = path[i];
    const next = (node as Record<PropertyKey, unknown> | undefined)?.[key];
    if ((key === "elements" || key === "layers") && typeof path[i + 1] === "number") {
      const item = (next as { id?: string }[] | undefined)?.[path[i + 1] as number];
      parts.length = 0; // the innermost named thing is what matters
      parts.push(item?.id ? `${key === "layers" ? "layer" : "element"} '${item.id}'` : `${String(key)}[${String(path[i + 1])}]`);
      node = item;
      i++;
    } else {
      if (key !== "children") parts.push(String(key));
      node = next;
    }
  }
  return parts.length ? parts[0] + (parts.length > 1 ? ` → ${parts.slice(1).join(".")}` : "") : "deck";
}

function zodIssues(input: unknown, error: z.ZodError): string[] {
  return error.issues.map((i) => `${where(input, i.path)}: ${i.message}`);
}

/** A scene and everything in it: the deck itself, or the inside of a box. */
export interface Scope {
  /** "root", or the id of the box this is the inside of. */
  id: string;
  parent?: string;
  layers: Layer[];
  elements: Element[];
}

export const ROOT = "root";

/** The deck's scopes, root first, with child scenes given their default layer. */
export function scopesOf(deck: Deck): Scope[] {
  const out: Scope[] = [];
  const visit = (scope: Scope) => {
    out.push(scope);
    for (const e of scope.elements) {
      if (e.kind === "box" && e.children) {
        const layers = e.children.layers ?? [{ id: `${e.id}--inside`, label: e.label, tint: e.color ?? "gray", gap: 4.5 }];
        visit({ id: e.id, parent: scope.id, layers, elements: e.children.elements });
      }
    }
  };
  visit({ id: ROOT, layers: deck.layers, elements: deck.elements });
  return out;
}

/** Parse and check a deck. Throws DeckError listing every problem found. */
export function validate(input: unknown): Deck {
  const parsed = Deck.safeParse(input);
  if (!parsed.success) throw new DeckError(zodIssues(input, parsed.error));
  const deck = parsed.data;
  const issues: string[] = [];
  const scopes = scopesOf(deck);

  // One namespace for every layer and element, at every depth, since steps
  // can target any of them.
  const kinds = new Map<string, string>();
  const elements = new Map<string, Element>();
  const scopeOf = new Map<string, string>();
  const claim = (id: string, what: string, scope: string) => {
    if (kinds.has(id)) issues.push(`${what} '${id}': id already used by a ${kinds.get(id)} — ids must be unique across the deck`);
    kinds.set(id, what);
    scopeOf.set(id, scope);
  };
  for (const sc of scopes) {
    for (const l of sc.layers) claim(l.id, "layer", sc.id);
    for (const e of sc.elements) {
      claim(e.id, "element", sc.id);
      elements.set(e.id, e);
    }
  }

  for (const sc of scopes) {
    const layerIds = new Set(sc.layers.map((l) => l.id));
    const onlyLayer = sc.layers.length === 1 ? sc.layers[0].id : undefined;
    const layerOf = (e: { layer?: string }) => e.layer ?? onlyLayer;
    const inside = sc.id === ROOT ? "" : ` (inside '${sc.id}')`;

    for (const e of sc.elements) {
      if (e.kind === "arrow") {
        for (const end of ["from", "to"] as const) {
          const target = elements.get(e[end]);
          if (!target) issues.push(`element '${e.id}': ${end} '${e[end]}' does not exist`);
          else if (target.kind === "arrow" || target.kind === "group")
            issues.push(`element '${e.id}': ${end} '${e[end]}' is a ${target.kind}; arrows connect shapes`);
          else if (scopeOf.get(e[end]) !== sc.id)
            issues.push(`element '${e.id}': ${end} '${e[end]}' is in a different scene — arrows stay within one scene${inside}`);
        }
        if (e.from === e.to) issues.push(`element '${e.id}': from and to are the same element`);
        continue;
      }
      if (e.layer && !layerIds.has(e.layer)) {
        issues.push(`element '${e.id}': layer '${e.layer}' does not exist${inside} (layers: ${[...layerIds].join(", ")})`);
      } else if (!layerOf(e)) {
        issues.push(`element '${e.id}': needs a layer — this scene has ${sc.layers.length} layers${inside}`);
      }
      if (e.kind === "group") {
        for (const id of e.contains) {
          const member = elements.get(id);
          if (!member) issues.push(`element '${e.id}': contains '${id}', which does not exist`);
          else if (member.kind === "arrow" || member.kind === "group")
            issues.push(`element '${e.id}': contains '${id}', a ${member.kind}; groups contain shapes`);
          else if (scopeOf.get(id) !== sc.id || layerOf(member) !== layerOf(e))
            issues.push(`element '${e.id}': contains '${id}', which is not on the same layer`);
        }
      }
    }
  }

  const checkIds = (at: string, ids: string[]) => {
    for (const id of ids) if (!kinds.has(id)) issues.push(`${at}: '${id}' is not an element or layer id`);
  };
  checkIds("initial.hidden", deck.initial.hidden);
  checkIds("initial.dimmed", deck.initial.dimmed);

  // Follow the dive/surface stack through the steps, so camera fits and
  // dives can be checked against the scene that is actually showing.
  const stack: string[] = [ROOT];
  const checkAction = (at: string, a: Action) => {
    const here = stack[stack.length - 1];
    switch (a.type) {
      case "reveal": return checkIds(`${at} reveal`, a.reveal);
      case "remove": return checkIds(`${at} remove`, a.remove);
      case "highlight": return checkIds(`${at} highlight`, a.highlight);
      case "dim": return checkIds(`${at} dim`, a.dim);
      case "focus": return checkIds(`${at} focus`, a.focus);
      case "camera": {
        checkIds(`${at} camera.fit`, a.camera.fit ?? []);
        for (const id of a.camera.fit ?? []) {
          if (kinds.has(id) && scopeOf.get(id) !== here)
            issues.push(`${at} camera.fit: '${id}' is not in the scene being shown${here === ROOT ? "" : ` (inside '${here}')`}`);
        }
        return;
      }
      case "together": return a.together.forEach((c, i) => checkAction(`${at} together[${i}]`, c));
      case "dive": {
        const el = elements.get(a.dive);
        if (!el) issues.push(`${at} dive: '${a.dive}' does not exist`);
        else if (el.kind !== "box" || !el.children) issues.push(`${at} dive: '${a.dive}' has no children to dive into`);
        else if (scopeOf.get(a.dive) !== here) issues.push(`${at} dive: '${a.dive}' is not in the scene being shown`);
        else stack.push(a.dive);
        return;
      }
      case "surface":
        if (stack.length === 1) issues.push(`${at} surface: already at the top — nothing to surface from`);
        else stack.pop();
        return;
      case "flow": {
        let prevTo: string | undefined;
        for (const id of a.flow) {
          const el = elements.get(id);
          if (!el || el.kind !== "arrow") {
            issues.push(`${at} flow: '${id}' is not an arrow — flows travel along arrows`);
            return;
          }
          if (prevTo && el.from !== prevTo) {
            issues.push(`${at} flow: '${id}' starts at '${el.from}', but the previous arrow ends at '${prevTo}' — the path must be connected`);
          }
          prevTo = el.to;
        }
        return;
      }
      case "clear":
      case "wait":
        return;
    }
  };
  deck.steps.forEach((step, i) => {
    step.do.forEach((a, j) => checkAction(`step ${i + 1} → action ${j + 1}`, a));
    const pins = step.aside?.pin ?? [];
    if (pins.length && step.aside?.layout === "center") {
      issues.push(`step ${i + 1} → aside: pin only works with layout "side" — a centered card covers the scene`);
    }
    checkIds(`step ${i + 1} → aside.pin`, pins);
    const here = stack[stack.length - 1];
    for (const id of pins) {
      if (kinds.has(id) && scopeOf.get(id) !== here)
        issues.push(`step ${i + 1} → aside.pin: '${id}' is not in the scene being shown`);
    }
  });

  if (issues.length) throw new DeckError(issues);
  return deck;
}
