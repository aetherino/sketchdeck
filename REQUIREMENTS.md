# Sketchdeck — Functional Requirements (v1)

*Working title. Drafted 2026-10-22.*

## 1. What this is

A reusable harness for presenting architectural decisions as hand-drawn, 2.5D scenes.

An agent (e.g. Claude Code) writes a scene file. The app renders it in an Excalidraw-like sketch style on stacked layer planes and plays it back as a guided presentation. The camera tells the story, and motion is spent deliberately to direct attention.

The point is to let an agent spend many tokens getting a visual **great**, not just correct. Taste is the product. When in doubt, cut a feature and polish what's left.

### Principles

1. **Tasteful by default.** Default spacing, colors, type and timing should look good before anyone tweaks them.
2. **Motion is a measured resource.** Things move only to walk the viewer's attention, then everything settles to stillness.
3. **The agent can see its own work.** Every step can be rendered to an image so the agent can critique and revise it.
4. **No over-engineering.** Local only, single user, files on disk.

## 2. Users and workflow

- **Author:** an external coding agent, directed by a human. It writes and edits the scene file directly.
- **Presenter:** a human, presenting live from their own machine.
- **Loop:** human describes the decision → agent writes the scene → agent renders each step to PNG, reviews, revises → human previews in the browser → human presents.

There is no built-in AI and no in-app editing UI.

## 3. Scene model

### 3.1 Deck
- One deck is one folder on disk: a scene file plus any assets. It is the only storage.
- A deck has a title, a theme (light or dark), and an ordered list of steps.

### 3.2 Space and layers
- The world is a set of **horizontal layer planes stacked vertically**. Depth means abstraction level (e.g. infra → platform → app).
- Each layer has an id, a label, and an optional tint, and is drawn as a sketched plane.
- The agent places elements with **exact positions in grid units**: `(x, y)` on a named layer. The renderer snaps to the grid.
- Elements may span layers only through connectors (arrows), not geometry.

### 3.3 Elements
| Element | Notes |
|---|---|
| Box | Default component. Optional rounded corners. |
| Database | Cylinder. |
| Queue | Segmented tube/pipe. |
| Person | Stick-figure style actor. |
| Cloud | External system or internet. |
| Text | Free label or annotation. |
| Arrow | Connects two elements, on the same or different layers. Optional label. Straight or gently curved. |
| Group / boundary | Dashed sketched outline around elements, with a label (e.g. a VPC or a service boundary). |
| Icon | A small, curated set of brand/tech icons redrawn in the sketch style (e.g. Postgres, Redis, Kafka, AWS, GCP, Kubernetes). Usable alone or as a badge on a box. |

- Every element has a stable id, a label, and optional color from the theme palette (no arbitrary hex by default).
- 3D extrusion: shapes have shallow depth so they read as objects sitting on their layer plane.

### 3.4 Nested scenes (zoom-in)
- Any element may contain a **child scene** with its own layers, elements and coordinate space (C4-style levels).
- A step can **dive into** an element: the camera pushes into it, the parent fades, the child scene unfolds. A later step can **surface** back out.
- Nesting depth is not limited, but two levels is the expected norm.

### 3.5 Size limit
- Aim for **at most 40–60 elements in view** at once. Bigger diagrams should be split into nested scenes.
- The validator warns above this limit (see §7).

## 4. Presentation model

### 4.1 Steps
A deck is **one continuous scene** driven by an ordered list of steps (no separate slides). Each step is a short choreography of actions:

| Action | Effect |
|---|---|
| `reveal` | Element(s) appear, with lines drawing themselves in pen-style. |
| `remove` | Element(s) erase or fade out. |
| `highlight` | Element(s) become emphasized (stronger stroke, accent color). |
| `dim` | Element(s) recede (lower contrast). |
| `camera` | Move to a keyframe: target, zoom, and angle within the 2.5D range. |
| `flow` | Small dots travel along a path of arrows to show a request flow or sequence. |
| `dive` / `surface` | Enter or leave a nested scene (§3.4). |
| `caption` | Optional on-screen line of text for the step (off by default). |

- Actions inside a step can run in sequence or in parallel, with optional delays. The renderer supplies good default timing and easing.
- Each step may carry **speaker notes**.

### 4.2 Motion budget ("unfold, then settle")
- When you advance to a step, its choreography **unfolds**: camera moves, draw-ins and flows play in order to walk the viewer's eye.
- Then **everything slows to a full stop**. Flow dots finish their trip and stop, and nothing loops forever. A settled step is a still image.
- Pressing → starts the next step's unfold. Pressing ← jumps straight to the previous step's **settled** state, without replaying it.
- Strokes have **fixed** hand-drawn wobble. Nothing "boils" or jitters at rest.

### 4.3 Camera
- The default is **2.5D**: an isometric-ish view whose angle and zoom are authored per keyframe, within a constrained, flattering range.
- Camera moves between keyframes are smooth and eased, never jarring.
- A step can **zoom onto one plane** for that step only: the camera rises over the layer and the other layers fade away, then pulls back when a step without it follows.

## 5. Visual style

- **Pluggable style module.** v1 ships one style, "sketch" (Excalidraw-like). The renderer must keep style separate from scene structure so other styles can be added later.
- **The sketch style:** rough, hand-drawn strokes with a deterministic seed per element (identical every render), hatched fills, and slightly imperfect corners.
- **Typography:** a handwriting font for labels and titles. It must stay legible at projector distance.
- **Themes:** *Paper* (light, the default) and *Chalk* (dark, for dim rooms). Each has a small curated palette, and elements pick from named palette colors.
- **Frame:** a fixed **16:9 stage**, letterboxed to the window, so a deck looks identical on any screen.

## 6. Presenting

### 6.1 Running it
- Runs **locally** in a web browser, from a local dev server pointed at a deck folder. There is no hosting, no auth, and no sharing in v1.
- Editing the scene file hot-reloads the browser, keeping the current step.

### 6.2 Navigation
| Input | Action |
|---|---|
| → / Space / PageDown (clickers) | Next step (play its unfold). |
| ← / PageUp | Previous step (settled state). |
| Home / End | First / last step. |
| Drag / scroll | **Explore:** free orbit, pan and zoom around the current scene, always available. |
| `R` / `Esc` | Glide back to the current step's camera (replays the step when already there). |
| → / ← while exploring | Snap back into the sequence and move on. |
| `F` | Fullscreen. |
| `P` | Open the presenter view. |

The keys sit faintly in the stage's corner and brighten when the mouse moves.

### 6.3 Presenter view
- A second browser window, synced to the main one, showing:
  - the current step
  - the next step's settled state
  - speaker notes
  - step counter and elapsed time
- Navigating from either window drives both.

## 7. Agent harness

This is what makes the tool "agent-first". All of it runs from a CLI the agent calls.

1. **Schema:** the scene format is documented, typed and strictly validated. Errors name the element id and the problem, and suggest a fix.
2. **Render:** a headless command renders **every step's settled state to PNG**, plus optional mid-unfold frames, so the agent can look at what it made.
3. **Lint:** an automated layout check flags overlapping elements, labels overflowing their shapes, arrows crossing through elements, off-stage content, steps with no visible change, and views over the element limit.
4. **Taste guide:** a concise document the agent reads before authoring. It covers composition, spacing, use of layers, palette restraint, how to pace steps, when to use flow vs. highlight, and when to split into a nested scene.
5. **Example decks:** one or two exemplary decks that demonstrate every feature and serve as the quality bar.

## 8. Non-goals (v1)

- Decision semantics (options, trade-offs, ADR structure). The decision lives in the narration.
- Live editing during a presentation.
- A built-in AI/chat, or in-app drag-and-drop editing.
- Multi-user collaboration, accounts, hosting, or shareable links.
- Exports (PDF, video, PNG for humans). PNG rendering exists only for the agent loop.
- Automatic layout.
- Import from Mermaid, C4/Structurizr, Excalidraw, or repos.
- Desktop app.

## 9. Acceptance — v1 is done when

- An agent can, using only the taste guide, schema and CLI, author a ~10-step deck about a real architectural decision (with layers, one dive into a nested scene, flows and camera moves) that a human would be proud to present.
- The deck runs smoothly on a laptop at 60fps, in both themes, and in fullscreen with the presenter view on a second screen.
- Every step settles to complete stillness.
- Rendering all steps to PNG takes under a minute for that deck.
