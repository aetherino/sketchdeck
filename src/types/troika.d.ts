declare module "troika-three-text" {
  import { Mesh, Material, ColorRepresentation } from "three";
  export class Text extends Mesh {
    text: string;
    font: string;
    fontSize: number;
    color: ColorRepresentation;
    anchorX: number | string;
    anchorY: number | string;
    textAlign: "left" | "right" | "center" | "justify";
    outlineWidth: number | string;
    outlineColor: ColorRepresentation;
    outlineBlur: number | string;
    outlineOpacity: number;
    fillOpacity: number;
    material: Material;
    textRenderInfo?: { blockBounds: [number, number, number, number] };
    sync(callback?: () => void): void;
    dispose(): void;
  }
  export function preloadFont(opts: { font: string; characters?: string }, callback: () => void): void;
}
