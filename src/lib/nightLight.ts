import {
  MAX_NIGHT_LIGHT_STRENGTH,
  normalizeNightLightStrength,
} from "./appearancePreferences";

export const NIGHT_LIGHT_MAX_OVERLAY_OPACITY = 0.52;

export function getNightLightOverlayOpacity(strength: unknown) {
  const normalizedStrength = normalizeNightLightStrength(strength);
  return (normalizedStrength / MAX_NIGHT_LIGHT_STRENGTH) * NIGHT_LIGHT_MAX_OVERLAY_OPACITY;
}
