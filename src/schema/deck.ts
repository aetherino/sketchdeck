import { z } from "zod";
import { ICON_NAMES } from "./icons";

// The scene format. Agents write decks against these types; zod checks them
// at load time with messages that name the element and the fix.
//
// Coordinates: every element sits on a layer at `at: [x, y]` in grid units.
//   x runs left → right along the layer's front edge,
//   y runs front → back, away from the viewer.
// One grid unit is one world unit. Positions snap to half units.

export const PALETTE = ["blue", "green", "yellow", "red", "violet", "sand", "gray"] as const;
export const Color = z.enum(PALETTE);
export type Color = z.infer<typeof Color>;

export const IconName = z.enum(ICON_NAMES);
export type IconName = z.infer<typeof IconName>;

const Id = z
  .string()
  .regex(/^[a-zA-Z][\w-]*$/, "ids start with a letter and use letters, digits, '-' or '_'");
const Vec2 = z.tuple([z.number(), z.number()]);

export const Layer = z.strictObject({
  id: Id,
  label: z.string().optional(),
  tint: Color.default("gray"),
  /** Vertical distance to the layer below, in world units. */
  gap: z.number().positive().default(4.5),
  /** Plane extent as [x0, y0, x1, y1]. Defaults to fit every layer's content. */
  bounds: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
});
export type Layer = z.infer<typeof Layer>;

const placed = {
  id: Id,
  /** Defaults to the only layer when the deck has one. */
  layer: Id.optional(),
  at: Vec2,
  label: z.string().optional(),
  color: Color.optional(),
};

export const Box = z.strictObject({
  ...placed,
  kind: z.literal("box"),
  /** Footprint [width, depth]. */
  size: Vec2.default([3, 2]),
  height: z.number().positive().default(0.6),
  icon: IconName.optional(),
  /**
   * What is inside: a scene of its own, entered with `{ dive: id }`. It has
   * its own layers and coordinates; ids share the deck's namespace.
   */
  get children() {
    return ChildScene.optional();
  },
});

export const ChildScene = z.strictObject({
  /** Defaults to one layer named after the parent. */
  layers: z.array(Layer).min(1).optional(),
  get elements() {
    return z.array(Element);
  },
});
export type ChildScene = z.infer<typeof ChildScene>;

export const Database = z.strictObject({
  ...placed,
  kind: z.literal("database"),
  /** Diameter. */
  size: z.number().positive().default(1.8),
  height: z.number().positive().default(1.4),
  icon: IconName.optional(),
});

export const Queue = z.strictObject({
  ...placed,
  kind: z.literal("queue"),
  /** [length, diameter]. */
  size: Vec2.default([3, 0.9]),
  /** Which plane axis the tube runs along. */
  along: z.enum(["x", "y"]).default("x"),
  icon: IconName.optional(),
});

export const Person = z.strictObject({
  ...placed,
  kind: z.literal("person"),
  /** Standing height. */
  size: z.number().positive().default(1.5),
});

export const Cloud = z.strictObject({
  ...placed,
  kind: z.literal("cloud"),
  /** Width; height follows. */
  size: z.number().positive().default(2.6),
  icon: IconName.optional(),
});

export const Icon = z.strictObject({
  ...placed,
  kind: z.literal("icon"),
  icon: IconName,
  size: z.number().positive().default(1.2),
});

export const Text = z.strictObject({
  ...placed,
  kind: z.literal("text"),
  label: z.string(),
  /** Font size in world units. */
  size: z.number().positive().default(0.5),
  /** Lie flat on the layer instead of facing the camera. */
  flat: z.boolean().default(false),
});

export const Group = z.strictObject({
  id: Id,
  kind: z.literal("group"),
  layer: Id.optional(),
  label: z.string().optional(),
  color: Color.optional(),
  /** Element ids to draw the boundary around (all on this group's layer). */
  contains: z.array(Id).min(1),
  padding: z.number().nonnegative().default(0.6),
});

export const Arrow = z.strictObject({
  id: Id,
  kind: z.literal("arrow"),
  from: Id,
  to: Id,
  label: z.string().optional(),
  dashed: z.boolean().default(false),
  /** Arrowheads at both ends. */
  both: z.boolean().default(false),
});

export const Element: z.ZodDiscriminatedUnion<
  [typeof Box, typeof Database, typeof Queue, typeof Person, typeof Cloud, typeof Icon, typeof Text, typeof Group, typeof Arrow]
> = z.discriminatedUnion("kind", [Box, Database, Queue, Person, Cloud, Icon, Text, Group, Arrow]);
export type Element = z.infer<typeof Element>;
export type ElementInput = z.input<typeof Element>;
export type Kind = Element["kind"];

// ── Steps ────────────────────────────────────────────────────────────────────
// A deck is one scene driven by steps. Each step's actions run in order when
// you arrive at it ("unfold"), then everything comes to rest ("settle").

const Ids = z.union([Id, z.array(Id).min(1)]).transform((v) => (Array.isArray(v) ? v : [v]));
const timing = {
  /** Seconds to wait before this action starts. */
  delay: z.number().nonnegative().optional(),
  /** Seconds this action takes. Defaults are tuned; override sparingly. */
  duration: z.number().positive().optional(),
};

export const CameraKey = z.strictObject({
  /** Element, group or layer ids to frame. Omit to frame everything. */
  fit: z.array(Id).min(1).optional(),
  /** Degrees around the vertical axis (default 18). Kept in a flattering range. */
  azimuth: z.number().min(-15).max(75).optional(),
  /** Degrees above the horizon (default 24). */
  elevation: z.number().min(12).max(65).optional(),
  /** Multiplies the fitted zoom: 1.2 is 20% closer. */
  zoom: z.number().min(0.4).max(4).optional(),
});
export type CameraKey = z.infer<typeof CameraKey>;

const actionShapes = {
  /** Draw elements in, pen-style, one after another. */
  reveal: z.strictObject({ type: z.literal("reveal"), reveal: Ids, stagger: z.number().nonnegative().optional(), ...timing }),
  /** Erase elements: the pen runs backwards. */
  remove: z.strictObject({ type: z.literal("remove"), remove: Ids, ...timing }),
  /** Emphasize: stronger strokes, lifted slightly. */
  highlight: z.strictObject({ type: z.literal("highlight"), highlight: Ids, ...timing }),
  /** Recede: fade toward the page. */
  dim: z.strictObject({ type: z.literal("dim"), dim: Ids, ...timing }),
  /** Keep these as they are and dim everything else that is visible. */
  focus: z.strictObject({ type: z.literal("focus"), focus: Ids, ...timing }),
  /** Return every element to normal emphasis. */
  clear: z.strictObject({ type: z.literal("clear"), clear: z.literal(true), ...timing }),
  /** Move the camera. */
  camera: z.strictObject({ type: z.literal("camera"), camera: CameraKey, ...timing }),
  /** Send dots along a connected path of arrows, then let them vanish. */
  flow: z.strictObject({ type: z.literal("flow"), flow: z.array(Id).min(1), dots: z.number().int().min(1).max(6).optional(), ...timing }),
  /** Pause before the next action. */
  wait: z.strictObject({ type: z.literal("wait"), wait: z.number().positive() }),
  /** Zoom into a box's children: the rest fades away, the inside sketches itself in. */
  dive: z.strictObject({ type: z.literal("dive"), dive: Id, ...timing }),
  /** Come back out to the scene around the current one. */
  surface: z.strictObject({ type: z.literal("surface"), surface: z.literal(true), ...timing }),
};
type ActionKey = keyof typeof actionShapes;
const ACTION_KEYS = Object.keys(actionShapes) as ActionKey[];

export type Action =
  | { [K in ActionKey]: z.infer<(typeof actionShapes)[K]> }[ActionKey]
  | { type: "together"; together: Action[]; delay?: number };
/** What deck files write: the action's key is its type. */
export type ActionInput =
  | { [K in ActionKey]: Omit<z.input<(typeof actionShapes)[K]>, "type"> }[ActionKey]
  | { together: ActionInput[]; delay?: number };

// Actions are written as `{ reveal: [...] }`; tag them with their key so zod
// can pick the right schema and name the right one in errors.
const tagAction = (v: unknown) => {
  if (v && typeof v === "object" && !Array.isArray(v) && !("type" in v)) {
    const key = [...ACTION_KEYS, "together"].find((k) => k in v);
    if (key) return { type: key, ...v };
  }
  return v;
};

export const ActionSchema: z.ZodType<Action, ActionInput> = z.lazy(() =>
  z.preprocess(
    tagAction,
    z.discriminatedUnion("type", [
      ...Object.values(actionShapes),
      z.strictObject({ type: z.literal("together"), together: z.array(ActionSchema).min(1), delay: z.number().nonnegative().optional() }),
    ] as unknown as [z.ZodObject, ...z.ZodObject[]], {
      error: () => `each action needs one of: ${[...ACTION_KEYS, "together"].join(", ")}`,
    }),
  ),
) as unknown as z.ZodType<Action, ActionInput>;

export const Step = z.strictObject({
  /** Speaker notes, shown in the presenter view. */
  notes: z.string().optional(),
  /** A line of on-screen text for this step. Off unless set. */
  caption: z.string().optional(),
  do: z.array(ActionSchema).default([]),
});
export type Step = z.infer<typeof Step>;

export const Deck = z.strictObject({
  title: z.string(),
  theme: z.enum(["paper", "chalk"]).default("paper"),
  /** Listed top to bottom, the way a layered diagram reads. */
  layers: z.array(Layer).min(1),
  elements: z.array(Element),
  /** The deck's default camera angle; camera moves fall back to it. */
  view: z.strictObject({
    azimuth: z.number().min(-15).max(75).optional(),
    elevation: z.number().min(12).max(65).optional(),
  }).optional(),
  /**
   * Hidden or dimmed before the first step. Anything a step reveals starts
   * hidden automatically.
   */
  initial: z.strictObject({ hidden: z.array(Id).default([]), dimmed: z.array(Id).default([]) }).default({ hidden: [], dimmed: [] }),
  steps: z.array(Step).default([]),
});
export type Deck = z.infer<typeof Deck>;
export type DeckInput = z.input<typeof Deck>;

/** Identity at runtime; gives deck files types and autocomplete. */
export function defineDeck(deck: DeckInput): DeckInput {
  return deck;
}
