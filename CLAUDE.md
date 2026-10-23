# Sketchdeck

Agent-first presentations of architectural decisions: hand-drawn, 2.5D, layered scenes driven by steps.

## When asked to make or change a deck

1. Read `docs/TASTE.md`, then `docs/AUTHORING.md`. `decks/checkout-events/deck.ts` is the reference deck.
2. Write `decks/<name>/deck.ts`.
3. `node cli/sketchdeck.mjs check decks/<name>/deck.ts`. Fix every error; treat warnings as bugs unless there's a reason.
4. `node cli/sketchdeck.mjs render decks/<name>/deck.ts` and look at every PNG in `decks/<name>/out/` at full size. Use `--frames 3` for steps with flows or dives.
5. Revise until each step makes one clear point and nothing collides. Spend the effort here: the point of this tool is decks that look great.
6. To present: `node cli/sketchdeck.mjs dev decks/<name>/deck.ts`.

## Working on the tool itself

- `src/schema`: deck format (zod) and `defineDeck`. `src/core`: validation, resolve (grid → world), state and timeline (pure, no three.js).
- `src/render`: line shader, camera, emphasis, flow dots. `src/styles/sketch`: the sketch style (rough strokes, shapes, icons, themes).
- `src/app`: player, page, presenter view, explore mode, lint. `cli/sketchdeck.mjs`: dev / check / render.
- `npx tsc --noEmit` must pass. After visual changes, render both decks and look before calling it done.
- `REQUIREMENTS.md` and `DESIGN.md` record what was decided and why.
