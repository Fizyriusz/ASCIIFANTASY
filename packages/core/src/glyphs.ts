/**
 * Rampy znaków. W tym rendererze światło jest jedyną teksturą, więc dobór
 * glifu z rampy zastępuje shading, normalne i mapy tekstur naraz.
 *
 * Kolejność: od najjaśniejszego do najciemniejszego.
 */
export const RAMP_DENSE = '@#%&8B0OZXwzo*+=-:.'.split('').map((c) => c.charCodeAt(0));
export const RAMP_SOFT = '#=+~:-.'.split('').map((c) => c.charCodeAt(0));

/** Wybiera znak z rampy dla luminancji 0..1. */
export function rampGlyph(ramp: readonly number[], lum: number): number {
  if (ramp.length === 0) return 32;
  const t = lum <= 0 ? 0 : lum >= 1 ? 1 : lum;
  const i = Math.min(ramp.length - 1, Math.floor((1 - t) * ramp.length));
  return ramp[i] ?? 32;
}
