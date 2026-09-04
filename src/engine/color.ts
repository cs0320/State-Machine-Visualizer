/** Standard CSS Color Module HSL -> sRGB conversion. h in degrees, s/l in percent. */
export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const sN = s / 100;
  const lN = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sN * Math.min(lN, 1 - lN);
  const f = (n: number) => lN - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [255 * f(0), 255 * f(8), 255 * f(4)];
}

/** WCAG relative luminance of an sRGB color (0-255 channels). */
export function relativeLuminance(r: number, g: number, b: number): number {
  const [rs, gs, bs] = [r, g, b].map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

/** WCAG contrast ratio between two relative luminances (1 to 21). */
export function contrastRatio(l1: number, l2: number): number {
  const [a, b] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (a + 0.05) / (b + 0.05);
}

const WHITE = "#ffffff";
const NEAR_BLACK = "#140c1f";
const WHITE_LUM = relativeLuminance(255, 255, 255);
const NEAR_BLACK_LUM = relativeLuminance(0x14, 0x0c, 0x1f);
const AA_TEXT_CONTRAST = 4.5;

/**
 * Picks whichever of near-white / near-black text gives better WCAG contrast against the given
 * HSL background, so accent-colored buttons/highlights stay readable across every hue a user
 * might pick, not just the ones the original palette was tuned for.
 */
export function bestTextColorForHsl(h: number, s: number, l: number): string {
  const [r, g, b] = hslToRgb(h, s, l);
  const bgLum = relativeLuminance(r, g, b);
  const contrastWithWhite = contrastRatio(bgLum, WHITE_LUM);
  const contrastWithBlack = contrastRatio(bgLum, NEAR_BLACK_LUM);
  return contrastWithWhite >= contrastWithBlack ? WHITE : NEAR_BLACK;
}

/** The better of the two contrast ratios (white text vs. near-black text) achievable against this HSL background. */
function bestContrastAt(h: number, s: number, l: number): number {
  const [r, g, b] = hslToRgb(h, s, l);
  const bgLum = relativeLuminance(r, g, b);
  return Math.max(contrastRatio(bgLum, WHITE_LUM), contrastRatio(bgLum, NEAR_BLACK_LUM));
}

export interface AccessibleAccent {
  saturation: number;
  lightness: number;
  textColor: string;
}

/**
 * A handful of hues (given this app's saturation/lightness formulas, a couple of narrow bands
 * around 220 and 280 degrees) can't reach 4.5:1 contrast with *either* white or near-black text
 * at the "base" lightness — both options land in a mid-4s valley. Rather than uniformly
 * desaturating the whole hue wheel to fix a handful of hues, this nudges lightness (and
 * saturation, as a fallback) just enough for this specific hue to clear AA, leaving hues that
 * were already fine untouched.
 */
export function pickAccessibleAccent(hue: number, baseSaturation: number, baseLightness: number): AccessibleAccent {
  const candidates: Array<[number, number]> = [[baseSaturation, baseLightness]];
  for (let dl = 2; dl <= 30; dl += 2) {
    candidates.push([baseSaturation, baseLightness - dl]);
    candidates.push([baseSaturation, baseLightness + dl]);
  }
  for (let ds = 5; ds <= baseSaturation - 30; ds += 5) {
    candidates.push([baseSaturation - ds, baseLightness]);
    for (let dl = 2; dl <= 20; dl += 4) {
      candidates.push([baseSaturation - ds, baseLightness - dl]);
      candidates.push([baseSaturation - ds, baseLightness + dl]);
    }
  }

  for (const [s, l] of candidates) {
    if (s < 25 || l < 12 || l > 94) continue;
    if (bestContrastAt(hue, s, l) >= AA_TEXT_CONTRAST) {
      return { saturation: s, lightness: l, textColor: bestTextColorForHsl(hue, s, l) };
    }
  }
  // Unreachable in practice (the search space always finds a safe, desaturated fallback first),
  // but a guaranteed-safe neutral combo in case it ever isn't.
  return { saturation: 55, lightness: 60, textColor: bestTextColorForHsl(hue, 55, 60) };
}
