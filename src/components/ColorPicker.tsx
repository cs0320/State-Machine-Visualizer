import { pickAccessibleAccent } from "../engine/color";
import { HueWheel } from "./HueWheel";

const STORAGE_KEY = "smv-accent-hue";
const DEFAULT_HUE = 264;
const LIGHT_S = 90;
const LIGHT_L = 58;
const DARK_S = 85;
const DARK_L = 74;

/**
 * Sets the CSS custom properties `--accent` (and its dark-mode variant) derive from — see
 * index.css for the actual `hsl(...)` formulas. Saturation/lightness aren't just the fixed
 * LIGHT_S/LIGHT_L/DARK_S/DARK_L constants passed straight through: `pickAccessibleAccent` nudges
 * them per-hue when needed to guarantee WCAG AA text contrast (a handful of hues around 220/280
 * degrees fail contrast at the base values with either white or near-black text — see color.ts).
 */
function applyAccentHue(hue: number) {
  const light = pickAccessibleAccent(hue, LIGHT_S, LIGHT_L);
  const dark = pickAccessibleAccent(hue, DARK_S, DARK_L);
  const root = document.documentElement.style;
  root.setProperty("--accent-hue", String(hue));
  root.setProperty("--accent-saturation-light", `${light.saturation}%`);
  root.setProperty("--accent-lightness-light", `${light.lightness}%`);
  root.setProperty("--accent-contrast-light", light.textColor);
  root.setProperty("--accent-saturation-dark", `${dark.saturation}%`);
  root.setProperty("--accent-lightness-dark", `${dark.lightness}%`);
  root.setProperty("--accent-contrast-dark", dark.textColor);
}

/** The accent-color hue wheel shown in the header. See BackgroundColorPicker.tsx for the equivalent for the neutral panel/background palette. */
export function ColorPicker() {
  return (
    <HueWheel
      storageKey={STORAGE_KEY}
      defaultHue={DEFAULT_HUE}
      triggerLabel="Change accent color"
      popoverLabel="Accent color"
      swatchStyle={{ background: "var(--accent)" }}
      onHueChange={applyAccentHue}
    />
  );
}
