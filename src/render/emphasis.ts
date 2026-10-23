import * as THREE from "three";
import { Text } from "troika-three-text";
import { FatLines } from "./fatline";

// Emphasis for any built element, without the style having to know about it:
// dimming fades every line, face and label toward the page color; highlighting
// thickens strokes and lifts the element a little off its plane.

const HIGHLIGHT_WIDTH = 0.55;
const HIGHLIGHT_LIFT = 0.18;

type Fade = { uFade: { value: number }; uFadeColor: { value: THREE.Color }; uFadeAlpha: { value: number } };

/** Give a basic material a fade-toward-color uniform (patched into its shader). */
function fadeable(mat: THREE.MeshBasicMaterial, page: THREE.Color): Fade {
  const existing = mat.userData.fade as Fade | undefined;
  if (existing) return existing;
  // Translucent surfaces (planes, tints) also thin out as they fade, so a
  // dimmed plane recedes instead of becoming a slab of page color.
  const fade: Fade = { uFade: { value: 0 }, uFadeColor: { value: page.clone() }, uFadeAlpha: { value: mat.transparent ? 0.75 : 0 } };
  mat.userData.fade = fade;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, fade);
    shader.fragmentShader = shader.fragmentShader
      .replace("void main() {", "uniform float uFade;\nuniform vec3 uFadeColor;\nuniform float uFadeAlpha;\nvoid main() {")
      .replace(
        "#include <dithering_fragment>",
        // Mixed in perceptual space (gl_FragColor is already sRGB here).
        "#include <dithering_fragment>\n  gl_FragColor.rgb = mix(gl_FragColor.rgb, pow(uFadeColor, vec3(1.0 / 2.2)), uFade);\n  gl_FragColor.a *= 1.0 - uFade * uFadeAlpha;",
      );
  };
  mat.customProgramCacheKey = () => "fadeable";
  mat.needsUpdate = true;
  return fade;
}

/** e: -1 (dim) … 0 … 1 (highlight). hide: 0 … 1 fades fully away (scene changes). */
export type EmphasisFn = (e: number, hide?: number) => void;

/**
 * Prepare an element for emphasis. Call once, after it is built and before
 * its first render. Returns a setter taking -1 (dim) … 0 … 1 (highlight).
 */
export function emphasizable(object: THREE.Object3D, pageColor: string, dimFade: number): EmphasisFn {
  const page = new THREE.Color(pageColor);
  const lines: FatLines[] = [];
  const fades: Fade[] = [];
  const texts: { t: Text; base: THREE.Color }[] = [];
  object.traverse((o) => {
    if (o instanceof FatLines) {
      lines.push(o);
      o.material.uniforms.uFadeColor.value.copy(page);
    } else if (o instanceof Text) {
      texts.push({ t: o, base: new THREE.Color(o.color as THREE.ColorRepresentation) });
    } else if (o instanceof THREE.Mesh && o.material instanceof THREE.MeshBasicMaterial) {
      fades.push(fadeable(o.material, page));
    }
  });
  const baseY = object.position.y;
  // View-dependent parts (silhouettes, arrow strokes) are rebuilt on camera
  // changes; pick them up lazily so they fade too.
  const syncLines = () => {
    object.traverse((o) => {
      if (o instanceof FatLines && !lines.includes(o)) {
        lines.push(o);
        o.material.uniforms.uFadeColor.value.copy(page);
      }
    });
    for (let i = lines.length - 1; i >= 0; i--) if (!lines[i].parent) lines.splice(i, 1);
  };

  return (e, hide = 0) => {
    syncLines();
    const fade = Math.max(e < 0 ? -e * dimFade : 0, hide);
    const width = 1 + (e > 0 ? e * HIGHLIGHT_WIDTH : 0);
    for (const l of lines) {
      l.material.uniforms.uFade.value = fade;
      l.material.uniforms.uWidthScale.value = width;
    }
    for (const f of fades) f.uFade.value = fade;
    for (const { t, base } of texts) {
      t.color = base.clone().convertLinearToSRGB().lerp(page.clone().convertLinearToSRGB(), fade).convertSRGBToLinear();
    }
    object.position.y = baseY + (e > 0 ? e * HIGHLIGHT_LIFT : 0);
    if (hide >= 0.999) object.visible = false;
  };
}
