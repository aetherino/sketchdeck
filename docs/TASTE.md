# Taste guide

Read this before writing a deck. The renderer makes things look hand-drawn. Whether a deck is *good* depends on the choices below.

The bar: a deck someone would be proud to present to a room of senior engineers. Clear before clever, calm before busy.

## 1. Story

**Every step makes one point.** If a step needs two sentences of notes to explain what changed on screen, split it.

The arc that works for a decision:

1. **Context.** What exists today. Opening step, no motion beyond the draw-in.
2. **Problem.** Make the pain visible: `focus` on it, `flow` through it, put the number on screen.
3. **Decision.** State it plainly in a caption, *before* any detail. "Decision: publish one event, let services listen."
4. **How.** The new shape. Reveal it, flow through it, dive into the one part that needs explaining.
5. **What stays.** What you deliberately did *not* change, and why.
6. **Trade-off.** Name the cost. A decision without a cost reads as a sales pitch.

**Asides are for context the diagram can't show.** Requirements before the decision (`center`), options weighed beside the scene they'd change (`side`, with `pin`). Never put the decision in an aside: it belongs in a caption, on the diagram. Two or three per deck at most; more and the deck turns into slides.

Six to twelve steps. Fewer means you're skipping the problem; more means you're explaining implementation.

## 2. Layout

- **Two or three layers.** Layers mean abstraction levels (clients / services / data). Four is the hard maximum. Use `gap: 3.5`–`4.5`; tighter stacks render larger.
- **Put lower-layer content toward the front** (smaller `y`). Upper planes are translucent, but anything at the back of a lower layer sits underneath them.
- **Work on a grid.** Line shapes up in rows and columns. Leave at least 1.5 units between shapes. Uneven spacing reads as carelessness.
- **Flows read left to right.** The primary path runs along `x` through the middle of the scene. Fan-outs are symmetric: two up and two down, not three on one side.
- **Keep it compact.** The camera fits the whole stack, so every unit of empty plane makes everything smaller. A scene spans about 12–16 units wide.
- **One size per role.** All services the same size; widen a box only to fit its label (`check` tells you when).
- **Under 40 shapes in view**, ideally under 20. If you need more, the detail belongs inside a box (`children` + `dive`).

## 3. Color

- **Gray is the default for a reason.** Use color to mean something: one color per role, or per thing that matters in the story.
- **Three or four colors per scene, at most.** Tint layers softly and differently from the shapes on them.
- **Red means a problem.** Use it for the slow thing, the failure, the number that hurts, and nowhere else.
- **The accent is reserved for flow dots.** Nothing else moves, so the dots own attention.

## 4. Words

- **Labels are one or two words.** Use Title Case nouns for components ("Checkout") and lowercase for data and topics ("orders", "order.placed").
- **Icons help recognition, not decoration.** Use a brand icon when the brand matters (Postgres, Kafka). Use a glyph when the role matters (lock for auth, mail for email). Don't put an icon on everything.
- **Label an arrow only when the verb matters** ("publish", "poll", "sessions"). Unlabeled arrows read as "calls".
- **A caption is a claim, not a title.** "If email is slow, checkout is slow", not "Email latency". Keep it under about 60 characters. Not every step needs one; silence after a strong caption is fine.
- **Notes are what you'd say out loud:** the incident, the number, the reason. Captions are for the room; notes are for the speaker.

## 5. Motion

Movement is how the deck points. Spend it deliberately.

- **One idea in motion per step.** A camera move, *or* a reveal, *or* a flow, plus at most a supporting emphasis change.
- **Flows:** once per step, 2–3 dots, along the path you're talking about. Never decorate with them.
- **Reveal at most four things per step.** Order them the way you'll talk about them.
- **`focus` means "look here".** It dims everything else. It's the most useful action; prefer it to `highlight`.
- **`highlight` is for one thing.** If you highlight three things, none is highlighted.
- **`dim` means still true, but not the point. `remove` means no longer true.** Don't leave outdated arrows dimmed when the point is that they're gone.
- **`clear` before changing the subject**, so leftover emphasis doesn't mislead.
- **Don't override durations** unless something genuinely needs to be slower. The defaults are tuned to settle quickly.

## 6. Camera

- **The default view fits everything.** Most steps should use it.
- **Zoom only to make a point** (`camera: { fit: [...] }`), and include enough neighbors that the viewer knows where they are. Return to the full view (`camera: {}`) before a big change.
- **Change azimuth rarely and gently** (roughly 10–30°). Higher azimuths turn the planes diagonal and make stacks harder to read. A deck can set its own default with `view`.
- **Dive when the inside matters to the decision**, not to show off depth. Keep insides small (three to six shapes) and `surface` before continuing outside.

## 7. Before you call it done

1. `sketchdeck check` is clean. Treat warnings as bugs unless you can say why they're fine.
2. `sketchdeck render` and **look at every PNG at full size**:
   - Can you tell what each step is about in two seconds?
   - Does anything collide, crowd, or sit awkwardly close to an edge?
   - Is the eye drawn to the right place?
3. Render a few mid-unfold frames (`--frames 3`) for steps with flows or dives. Motion should lead the eye, not wander.
4. Read the captions alone, in order. They should tell the story by themselves.

`decks/checkout-events/deck.ts` is the reference deck. When unsure, do what it does.
