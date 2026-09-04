import { HueWheel } from "./HueWheel";

const STORAGE_KEY = "smv-bg-hue";
const DEFAULT_HUE = 264;

/**
 * Sets `--bg-hue`, which index.css's `--bg`/`--panel`/`--panel-inset`/`--border`/`--node-*`
 * formulas all derive from. Unlike the accent picker, this doesn't need a per-hue contrast
 * adjustment — those formulas use low enough saturation, at extreme enough lightness, that text
 * contrast against them stays safely within WCAG AA across the entire hue range (verified by
 * sweeping all 360 degrees against the app's fixed --text/--muted colors before shipping this).
 */
function applyBackgroundHue(hue: number) {
  document.documentElement.style.setProperty("--bg-hue", String(hue));
}

/** The background/panel-tint hue wheel shown in the header, next to the accent picker. */
export function BackgroundColorPicker() {
  return (
    <HueWheel
      storageKey={STORAGE_KEY}
      defaultHue={DEFAULT_HUE}
      triggerLabel="Change background color"
      popoverLabel="Background color"
      swatchStyle={{ background: "var(--panel-inset)" }}
      onHueChange={applyBackgroundHue}
    />
  );
}
