# Authoring decks

A deck is one TypeScript file, `decks/<name>/deck.ts`, that default-exports `defineDeck({...})`. It is plain data: types give you autocomplete and errors, and the CLI validates everything else.

Read [TASTE.md](TASTE.md) first. This page is the reference.

## The loop

```bash
node cli/sketchdeck.mjs check  decks/my-deck/deck.ts     # types, validation, layout warnings (~2 s)
node cli/sketchdeck.mjs render decks/my-deck/deck.ts     # one PNG per step → decks/my-deck/out/
node cli/sketchdeck.mjs dev    decks/my-deck/deck.ts     # present it; edits reload in place
```

Write, `check`, `render`, **look at the images**, revise. `render --frames 3` adds three mid-unfold frames per step; `--step N` renders one step; `--theme chalk` previews the dark theme.

## Skeleton

```ts
import { defineDeck } from "sketchdeck";

export default defineDeck({
  title: "What we decided",
  theme: "paper",                       // or "chalk" (dark)
  view: { azimuth: 18, elevation: 24 }, // optional default camera
  layers: [                             // top to bottom
    { id: "services", label: "Services", tint: "blue", gap: 4 },
    { id: "data", label: "Data", tint: "sand" },
  ],
  elements: [
    { id: "api", kind: "box", layer: "services", at: [0, 0], label: "API", icon: "node", color: "yellow" },
    { id: "db", kind: "database", layer: "data", at: [0, 0.5], label: "Orders", icon: "postgres", color: "blue" },
    { id: "a1", kind: "arrow", from: "api", to: "db" },
  ],
  steps: [
    { caption: "Today, the API owns its data", notes: "Context." },
    { do: [{ flow: ["a1"] }] },
  ],
});
```

## Space

- Every shape sits on a layer at `at: [x, y]`, in grid units. **x runs left to right along the front edge; y runs front to back.** Positions snap to half units.
- Layers stack upward from the last one listed. `gap` (default 4.5) is the distance to the layer below.
- Layer planes share one footprint that fits all content, unless a layer sets `bounds: [x0, y0, x1, y1]`.
- Ids are unique across the whole deck: layers, elements, and elements inside boxes.

## Elements

| kind | fields (defaults) | notes |
|---|---|---|
| `box` | `size: [w, d]` ([3, 2]), `height` (0.6), `icon`, `children` | The default component. Label and icon sit on top. |
| `database` | `size` diameter (1.8), `height` (1.4), `icon` | Icon becomes a sticker on the lid; label on the body. |
| `queue` | `size: [length, diameter]` ([3, 0.9]), `along: "x" \| "y"`, `icon` | A tube with slots. Label below. |
| `person` | `size` height (1.5) | A cut-out that faces the viewer. Label below. |
| `cloud` | `size` width (2.6), `icon` | External systems, the internet. Label inside. |
| `icon` | `icon` (required), `size` (1.2) | A standalone icon tile. Label below. |
| `text` | `label` (required), `size` (0.5), `flat` (false) | Annotations and numbers. `flat` writes it on the plane. |
| `group` | `contains: [ids]`, `padding` (0.6), `label` | A dashed boundary around shapes on one layer. |
| `arrow` | `from`, `to`, `label`, `dashed`, `both` | Attaches to shape edges automatically, within one scene. |

Every shape takes `id`, `layer` (optional if there's only one), `at`, `label`, `color`.

**Colors:** `blue`, `green`, `yellow`, `red`, `violet`, `sand`, `gray` (the default).

**Inside a box:** `children: { layers?, elements }` is a scene of its own, with its own coordinates. It defaults to one layer named after the box. Enter it with `{ dive: "box-id" }`, leave it with `{ surface: true }`.

## Steps

`steps: [{ caption?, notes?, do: [actions] }]`. Arriving at a step runs its actions in order, then everything stops moving. Going back jumps to the previous step's finished state.

Anything a step reveals starts hidden. `initial: { hidden: [...], dimmed: [...] }` sets up the rest.

| action | effect |
|---|---|
| `{ reveal: ids, stagger? }` | Draw in, pen-style, one after another. |
| `{ remove: ids }` | Erase (the pen runs backwards). |
| `{ focus: ids }` | Keep these, dim everything else that's visible. |
| `{ highlight: ids }` | Stronger strokes, lifted slightly. |
| `{ dim: ids }` | Fade toward the page. |
| `{ clear: true }` | Everything back to normal emphasis. |
| `{ camera: { fit?, azimuth?, elevation?, zoom? } }` | Move the camera. Absolute: omitted fields take the deck's defaults; no `fit` frames everything. |
| `{ flow: [arrow ids], dots? }` | Dots travel a connected path of arrows once, then vanish. |
| `{ dive: id }` / `{ surface: true }` | Zoom into a box's children / back out. |
| `{ wait: seconds }` | Pause. |
| `{ together: [actions] }` | Run actions at the same time. |

Every action except `wait` and `together` takes `delay` and `duration` in seconds. Leave them alone unless you need them.

## Icons

**Glyphs:** activity, archive, bell, bot, box, braces, brain, building, calendar, cart, chart, clock, cloud, code, container, cpu, credit-card, dashboard, database, eye, file, filter, fingerprint, folder, gauge, git-branch, globe, hard-drive, hash, image, inbox, key, laptop, layers, list, lock, mail, map, merge, message, monitor, network, package, phone, refresh, repeat, router, search, send, server, settings, shield, shield-check, sparkles, split, table, terminal, timer, truck, user, users, video, wallet, webhook, wifi, workflow, zap

**Brands:** anthropic, auth0, cloudflare, docker, elasticsearch, github, go, google-cloud, grafana, graphql, kafka, kubernetes, mongodb, mysql, nginx, node, okta, postgres, prometheus, python, rabbitmq, react, redis, rust, stripe, terraform, typescript, vercel

There are no AWS icons; use a glyph (`server`, `database`, `cloud`) with an "AWS …" label.

## Layout warnings

`check` and `render` report:

| rule | means |
|---|---|
| overlap | Two shapes on a layer overlap. |
| arrow-through | An arrow crosses a shape it doesn't connect. |
| label-overflow | A label is wider than its box, database or cloud. |
| label-collision | Two labels overlap on screen in some step. |
| caption-collision | A framed label runs into the caption band. |
| off-stage | Something the camera means to show is cut off. |
| empty-step | A step changes nothing. |
| crowded | Too many shapes in view. |

## Presenting

`dev` serves the deck locally.

| key | |
|---|---|
| → / Space / PageDown | Next step. Pressing again during the animation finishes it. |
| ← / PageUp | Previous step, already settled. |
| Home / End | First / last step. |
| R | Replay this step. |
| E / Esc | Explore freely / glide back to the step's camera. |
| F | Fullscreen. |
| P | Open the presenter view (notes, next step, timer) in a second window. |

`?step=N` in the URL opens a step; `?theme=chalk` overrides the theme.
