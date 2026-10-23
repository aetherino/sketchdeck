# Sketchdeck — Tech Design (v1)

*Proposal, 2026-10-22. Implements [REQUIREMENTS.md](REQUIREMENTS.md).*

## 1. Stack

| Concern | Choice | Why |
|---|---|---|
| Language | TypeScript (strict) | One language for the scene format, renderer and CLI. Types double as agent documentation. |
| Dev server / build | Vite | Instant HMR for "edit scene → see it". Zero config. |
| 3D | three.js, used directly (no React) | The renderer is a timeline-driven imperative system. React adds a reconciliation layer we would fight. |
| Text | troika-three-text | Crisp SDF text at any zoom, with real font metrics (needed for the label-overflow lint). |
| Font | Excalifont (OFL 1.1), Latin subset bundled as .ttf | The canonical Excalidraw handwriting look. License confirmed at M1 (`assets/fonts/Excalifont-OFL.txt`). |
| Validation | zod | Runtime validation with precise, fixable error messages. |
| Headless render | Playwright (Chromium) | Renders the real app, so agent PNGs match exactly what's presented. |
| Animation | Small in-house seekable timeline | Must be pure and seekable (`t → frame`) for headless mid-unfold frames. A library would buy little. |
| Window sync | BroadcastChannel | Presenter view ↔ main window, with no server. |

No backend, no database, no UI framework. The dev server serves one deck folder.

## 2. Scene format

**A TypeScript file per deck** (`decks/<name>/deck.ts`) that default-exports plain data via `defineDeck()`.

- **Why TS, not YAML/JSON:** the agent gets type errors from `tsc` before running anything. It can also use constants and small helpers (`const api = { x: 4, y: 2 }`) to keep positions consistent, which matters because positions are exact.
- **Plain data underneath:** `defineDeck()` returns a serializable object, so zod validates the result. The renderer never executes deck code beyond loading it.

```ts
import { defineDeck } from "sketchdeck";

export default defineDeck({
  title: "Moving session state to Redis",
  theme: "paper",
  layers: [
    { id: "app",   label: "Application", tint: "blue" },
    { id: "data",  label: "Data",        tint: "sand" },
  ],
  elements: [
    { id: "user",  kind: "person",   layer: "app",  at: [0, 3],  label: "User" },
    { id: "api",   kind: "box",      layer: "app",  at: [4, 3],  size: [3, 2], label: "API" },
    { id: "pg",    kind: "database", layer: "data", at: [4, 3],  label: "Postgres", icon: "postgres" },
    { id: "redis", kind: "database", layer: "data", at: [9, 3],  label: "Redis",    icon: "redis" },
    { id: "a1",    kind: "arrow", from: "user", to: "api", label: "login" },
    { id: "a2",    kind: "arrow", from: "api",  to: "pg" },
    { id: "a3",    kind: "arrow", from: "api",  to: "redis", label: "session" },
  ],
  initial: { hidden: ["redis", "a3"] },
  steps: [
    {
      notes: "Today every request hits Postgres for the session.",
      do: [
        { camera: { target: "api", zoom: 1.2 } },
        { flow: ["a1", "a2"] },
      ],
    },
    {
      notes: "We add Redis as the session store.",
      do: [
        { dim: ["pg", "a2"] },
        { reveal: ["redis", "a3"] },
        { highlight: ["redis"], delay: 0.3 },
      ],
    },
  ],
});
```

Notes on the format:
- **Coordinates:** `at: [x, y]` in grid units on the element's layer. Layer stacking height comes from layer order. `size` defaults per kind.
- **Nested scenes:** any element may have `children: { layers, elements }` with its own coordinate space. The step actions `{ dive: "api" }` and `{ surface: true }` move between levels.
- **Choreography:** actions within a step run in sequence by default. `{ together: [...] }` groups actions to run in parallel, and `delay` offsets one action. Durations and easing have tasteful defaults and are rarely overridden.
- **Colors:** only named palette colors (`blue`, `sand`, `red`, …). Each theme maps them to real values.

## 3. Architecture

```
deck.ts ──► validate (zod) ──► resolve ──► state reducer ──► timeline ──► renderer ──► three.js
                               (grid →      (step i →          (t →          (style module
                               world,       settled state)     interpolated   draws primitives)
                               arrows,                          frame)
                               nesting)
```

### 3.1 Resolve
Turns the deck into world-space **primitives**: shape outlines and faces (3D polylines and polygons), arrow paths routed between anchor points (straight, or a gentle curve for cross-layer arrows), label anchors, and layer planes. It is pure and has no three.js dependency, so the CLI lint reuses it in Node.

### 3.2 State is a function of step index
- `settled(i)` = initial state with steps `0..i` applied. It is a pure reducer over visibility, emphasis (normal / highlighted / dimmed), camera keyframe, and current nesting level.
- The previous step is just `settled(i-1)`. Headless rendering of any step is just "draw `settled(i)`".
- This is what makes ← instant, HMR able to keep your place, and agent renders deterministic.

### 3.3 Timeline — "unfold, then settle"
- Each step compiles to a timeline from `settled(i-1)` to `settled(i)`. Every animated property (draw progress, opacity, emphasis, camera, flow-dot positions) is a tween with an end.
- `frame(t)` is pure. At `t ≥ duration` it equals `settled(i)`, and the render loop **stops requesting frames**. Stillness is guaranteed by construction.
- Flow dots travel their path once (optionally with a small staggered train of dots), ease out and vanish.

### 3.4 Renderer and the style module
The core renderer owns the camera, layers, render loop and channels (opacity, draw progress, emphasis). It asks a **style module** to turn each primitive into three.js objects:

```ts
interface Style {
  shape(p: ShapePrimitive, ctx): StyledObject;    // outlines + faces + fills
  arrow(p: ArrowPrimitive, ctx): StyledObject;
  label(p: LabelPrimitive, ctx): StyledObject;
  plane(p: LayerPrimitive, ctx): StyledObject;
  flowDot(ctx): StyledObject;
}
interface StyledObject { object: THREE.Object3D; setDraw(t: number): void; setOpacity(o: number): void; setEmphasis(e: number): void; }
```

v1 ships `styles/sketch`. Adding a "clean" or "blueprint" style later means implementing this interface, with no changes to core.

## 4. How the sketch look works in 3D

This is the hardest and most important part. The approach: **generate rough strokes in world space, then draw them as screen-space-width lines.**

- **Why not run rough.js in 2D on top of a projection?** It recomputes the wobble in screen space every frame, so lines would "boil" whenever the camera moves. That breaks the fixed-wobble requirement.
- **Why not a post-process "sketch" shader?** It looks like a filter, not like Excalidraw.

The pipeline:

1. **Rough strokes.** Port the core of rough.js's algorithm (endpoint jitter, bowing, double-stroke with offset), but apply it to 3D polylines. It is seeded per element id, so the wobble is identical every render and every frame.
2. **Fat lines.** A custom line shader draws instanced quads with constant pixel width. It also handles:
   - a per-vertex **arc length**, which powers the pen-style draw-in (`discard` beyond `progress`)
   - dashing for group boundaries
   - uniform width with round caps, matching Excalidraw (taper was tried in principle and dropped)
3. **Faces.** Each shape gets opaque faces, so objects properly occlude what's behind them. Lines sit on top via polygon offset plus a small view-space depth bias. During draw-in, faces fade in *after* the outline is mostly drawn (stroke first, fill second, as in Excalidraw).
4. **Hatch fills.** Seeded diagonal hatch lines are generated in world space on the top face, then clipped to the face polygon. Side faces get a flat, slightly darker tone instead of hatching, which gives the 2.5D read without noise.
5. **Labels.** troika text in Excalifont, **camera-facing** (billboarded) so they are always legible, with a subtle paper-colored halo. Boxes put the label on the top face. Cylinders put it on the camera-facing side of the body, below a "lid" ring near the top. Layer names are written flat on the plane along its front edge.
6. **Icons.** A small hand-traced SVG set, converted to polylines. They go through the same rough-stroke and fat-line pipeline, so they match the look.
7. **Camera.** An `OrthographicCamera`, which gives a clean isometric feel with no perspective distortion. Authored keyframes stay within a flattering range (elevation about 25–60°). Explore mode attaches OrbitControls with wider limits. `Esc` tweens back to the step's keyframe.
8. **Stage.** A fixed 1920×1080 logical canvas, scaled and letterboxed to the window, at device pixel ratio.

Performance budget: 60 elements × ~12 strokes plus hatching is a few thousand instanced quads. That is trivial for a laptop GPU.

## 5. CLI (the agent harness)

One binary, `sketchdeck`:

| Command | Does |
|---|---|
| `sketchdeck dev <deck>` | Starts Vite on the deck with HMR. The browser keeps the current step on edit. |
| `sketchdeck check <deck>` | Type-checks, validates (zod) and runs the layout lint. Prints actionable errors and warnings by element id. Exit code ≠ 0 on errors. |
| `sketchdeck render <deck> [--step N] [--frames K]` | Uses Playwright to open the app in `?render=` mode and writes `out/step-NN.png` (settled), optionally with K mid-unfold frames per step. It also writes `out/report.json` with lint results that need real text metrics. |

**Lint rules** (run on resolved world geometry projected through each step's camera):
- elements overlapping
- label wider than its shape
- arrow passing through a non-endpoint element
- content outside the 16:9 stage
- step with no visible change
- more than 60 elements in view
- arrows with ambiguous direction (zero-length, or start and end too close)

Mid-unfold frames are cheap because `frame(t)` is pure: the render mode just seeks.

## 6. Presenting

- The player listens for the navigation keys in REQUIREMENTS §6.2.
- `P` opens `?presenter` in a new window. Both windows send `{ step, t }` over BroadcastChannel, and whichever navigates drives the other.
- The presenter view shows two small canvases (the current step, and the next step settled), plus notes and a timer.
- Fullscreen uses the Fullscreen API.

## 7. Repository layout

```
sketchdeck/
  src/
    schema/       zod schema + defineDeck + exported types
    core/         resolve, state reducer, timeline (pure, no three.js)
    render/       renderer, camera, fat-line shader, stage
    styles/sketch/  rough strokes, hatch, faces, labels, icons, themes
    app/          player, presenter view, navigation, explore mode
  cli/            dev / check / render
  assets/         font, icon SVGs
  decks/example/  exemplary deck (the quality bar)
  docs/TASTE.md   taste guide the agent reads before authoring
```

## 8. Milestones

Taste risk is front-loaded: if the look is wrong, nothing else matters.

1. **Look spike.** One layer plane, one box, one database and one arrow, all in the sketch style, compared side by side with real Excalidraw. Iterate until it's convincing. Covers the rough strokes, fat-line shader, faces, hatching and the font.
2. **Scene model.** Schema, resolve, all element kinds, layers, labels, icons, both themes, the 16:9 stage.
3. **Motion.** State reducer, timeline, all step actions, camera keyframes, unfold-then-settle.
4. **Agent harness.** `check` and `render`, with lint rules.
5. **Nesting.** Dive and surface.
6. **Presenting.** Navigation, explore mode, presenter view, HMR with step retention.
7. **Taste pass.** Write TASTE.md, build the example deck about a real decision, and do a polish pass on timing, easing and palette.

## 9. Decisions from the M1 look spike

- **Excalifont:** OFL 1.1 confirmed. Only the Latin subset is bundled for now.
- **Side faces:** flat two-tone shading (lit from the left), not hatched. Hatching stays on top faces only.
- **Layers:** translucent tinted planes. Lower layers show through, slightly washed out, which reads as depth. A vertical gap of about 4.5 units with a ~27° camera elevation keeps layers from overlapping confusingly. The taste guide should tell agents to put lower-layer content toward the front of the plane.
- **Cross-layer arrows:** straight 3D diagonals. They leave the underside of the upper shape and land toward the back of the lower shape's top face, so they never hit its label.

## 10. Decisions from M2 (scene model)

- **Coordinates:** `at: [x, y]` on a layer. x runs left → right along the front edge, y runs front → back. World = (x, layerHeight, −y). Positions snap to half units. Layers are listed top to bottom, the bottom one at height 0, each `gap` (default 4.5) above the next.
- **Layer planes** share one footprint that fits all content plus a margin, unless a layer sets `bounds`. Aligned sheets read better than ragged ones.
- **Default camera:** azimuth 30°, elevation 27°, auto-framed to fit every plane and shape inside the 16:9 stage with a 10% margin.
- **Standees:** person, cloud and icon tiles are flat cut-outs that stay upright and turn to face the camera (yaw only). Their captions sit just below them on screen.
- **Captions:** boxes carry icon and label as a billboard pair on the top face. Databases carry the icon as a flat sticker on the lid (hatching is cut away around it) and the label on the body. Queues put the caption just below the tube, clear of the slot rings. Arrow labels sit beside the line, on its upper side on screen.
- **Group labels** sit just outside the boundary's front edge, so contents never cover them.
- **Icons:** 67 Lucide glyphs (ISC) and 28 Simple Icons brands (CC0), converted to polylines by `scripts/build-icons.mjs`. Glyphs are inked lines. Brands are a tinted silhouette with an inked outline. AWS marks are not in Simple Icons, so there is no AWS icon.
- **Themes** gained a `surface` color for top faces and cut-outs, separate from the page color. On Chalk it is a lighter slate, so top faces don't read as holes.
- **Validation** runs in two passes: schema first (zod), then cross-references (duplicate ids, missing layers, dangling arrows, group membership). A deck with schema errors shows only those until they're fixed.

## 11. Decisions from M3–M7

**Motion (M3)**
- Steps are `{ caption?, notes?, do: [actions] }`. Actions run in sequence; `together` runs them in parallel. Durations live in one table (`TIMING` in `src/core/timeline.ts`), which is the motion budget.
- Anything first revealed by a step starts hidden. Step 1 opens by sketching in everything initially visible, staggered in drawing order (layers, groups, shapes, arrows).
- Camera keys are absolute: omitted fields take the deck's defaults, and no `fit` frames the whole scene. This makes each step's framing predictable on its own.
- `focus` keeps its targets and the layers they stand on, and dims everything else that is visible. It's the workhorse for "look here".
- Dimming fades lines, faces and text toward the page color, mixed in perceptual (sRGB) space so it reads equally on paper and chalk. Translucent surfaces also thin out. Highlight thickens strokes 1.55× and lifts the element 0.18 units.
- Flow dots run once along a connected arrow path: an accent core in a page-colored halo, with trailing dots shrinking like a small comet. Then they vanish.
- Captions sit in a reserved band at the bottom (13% of the stage). The camera frames content above it, and a soft page-colored gradient fades out any context beneath.
- Default camera moved from 30°/27° to **18°/24°** after side-by-side renders: flatter azimuths turn layer stacks into readable sheets and use the 16:9 frame better. Decks can override it with `view`.

**Agent harness (M4)**
- `check` = deck-only type check + validation in Node (via Vite SSR) + layout lint in headless Chrome. `render` = PNG per step (+ mid-unfold frames) + `report.json`. Both take about 2 s on the example decks and fail fast with the build error if the page can't load.
- Lint runs in the page, where real text metrics exist. Rules: overlap, arrow-through, label-overflow, label-collision, caption-collision (framed elements only), off-stage (fit elements only), empty-step, crowded.

**Nested scenes (M5)**
- A box's `children` is a scene with its own layers and coordinates, built as a miniature standing on the box's top face (fitted to 82% of it). Diving is a real continuous zoom: the outside fades, the camera pushes in, and the inside sketches itself in, staggered, as the camera arrives. Surfacing reverses it. The camera returns to exactly where it was.
- Ids share one namespace across all scenes; arrows and groups stay within one scene. Validation follows the dive/surface stack through the steps.
- Line depth bias is in local units, so miniature scenes don't show hidden edges.

**Presenting (M6)**
- The page is split into a reusable `DeckView` (one renderer, scene, camera and player per canvas). The presenter window uses two: the live stage and a next-step preview. Views share the line-width uniforms, so each sets them right before rendering.
- Windows sync over `BroadcastChannel` with `{ step, mode: play | show }`; each applies what the other sends without echoing it back.
- Explore mode uses three's OrbitControls with damping off (nothing drifts after you let go). `Esc` glides back to the step's resting pose the short way round.

**Taste (M7)**
- `docs/TASTE.md` is the taste guide, `docs/AUTHORING.md` the format reference, `CLAUDE.md` the workflow. `decks/checkout-events` is the reference deck: 10 steps, three layers, one dive, flows, a zoom, and a named trade-off.
