import * as THREE from "three";
import type { Color } from "../../schema/deck";

export type PaletteColor = Color;

export interface Theme {
  name: "paper" | "chalk";
  background: string;
  letterbox: string;
  /** The page color: label halos and anything that should read as blank. */
  paper: string;
  /** Top faces and cut-out faces. On dark themes, a little lighter than the page. */
  surface: string;
  ink: string;
  inkSoft: string;
  /** Moving attention: flow dots. Used sparingly, so it can be loud. */
  accent: string;
  /** Hatch/fill color per palette entry. */
  fill: Record<PaletteColor, string>;
  /** Stronger partner per palette entry, for accents and layer outlines. */
  deep: Record<PaletteColor, string>;
  /** How far side faces move from paper toward the fill: [lit, shaded]. */
  sides: [number, number];
  /** Layer plane tint strength and opacity. */
  plane: { mix: number; opacity: number };
  /** How far dimmed things fade toward the page. Light ink on dark needs more. */
  dim: number;
}

// Fills follow Excalidraw's light background palette; deep tones its strokes.
export const paper: Theme = {
  name: "paper",
  background: "#fbfaf7",
  letterbox: "#ebe9e3",
  paper: "#fbfaf7",
  surface: "#fbfaf7",
  ink: "#1e1e1e",
  inkSoft: "#6b6b6b",
  accent: "#e8590c",
  fill: {
    blue: "#a5d8ff",
    green: "#b2f2bb",
    yellow: "#ffec99",
    red: "#ffc9c9",
    violet: "#d0bfff",
    sand: "#eaddc7",
    gray: "#dee2e6",
  },
  deep: {
    blue: "#1971c2",
    green: "#2f9e44",
    yellow: "#e8890c",
    red: "#e03131",
    violet: "#6741d9",
    sand: "#8a6d3b",
    gray: "#495057",
  },
  sides: [0.55, 1.0],
  plane: { mix: 0.6, opacity: 0.55 },
  dim: 0.82,
};

// Chalk on slate: muted mid-tone fills so hatching reads on a dark ground,
// and pastel accents for anything that should glow.
export const chalk: Theme = {
  name: "chalk",
  background: "#1f2328",
  letterbox: "#14171a",
  paper: "#1f2328",
  surface: "#2b3139",
  ink: "#ecebe6",
  inkSoft: "#9aa0a6",
  accent: "#ffd43b",
  fill: {
    blue: "#4a7fab",
    green: "#558f62",
    yellow: "#ad9441",
    red: "#ad5d58",
    violet: "#7d6bb3",
    sand: "#917e60",
    gray: "#646b73",
  },
  deep: {
    blue: "#a5d8ff",
    green: "#b2f2bb",
    yellow: "#ffec99",
    red: "#ffc9c9",
    violet: "#d0bfff",
    sand: "#eaddc7",
    gray: "#ced4da",
  },
  sides: [0.62, 0.4],
  plane: { mix: 0.2, opacity: 0.7 },
  dim: 0.78,
};

export const themes = { paper, chalk };

export function mix(a: string, b: string, t: number): THREE.Color {
  return new THREE.Color(a).lerp(new THREE.Color(b), t);
}
