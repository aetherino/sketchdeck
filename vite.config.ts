import path from "node:path";
import { defineConfig } from "vite";

// The deck to present: SKETCHDECK_DECK=path/to/deck.ts, or the example.
const deck = path.resolve(process.env.SKETCHDECK_DECK ?? "decks/example/deck.ts");

export default defineConfig({
  resolve: {
    alias: {
      "@deck": deck,
      sketchdeck: path.resolve("src/schema/index.ts"),
    },
  },
  server: { fs: { allow: [".", path.dirname(deck)] } },
});
