import { describe, expect, it } from "vitest";

import {
  getNightLightOverlayOpacity,
  NIGHT_LIGHT_MAX_OVERLAY_OPACITY,
} from "./nightLight";

describe("getNightLightOverlayOpacity", () => {
  it("mapeia linearmente a forca para o teto calibrado", () => {
    expect(getNightLightOverlayOpacity(0)).toBe(0);
    expect(getNightLightOverlayOpacity(50)).toBeCloseTo(0.26);
    expect(getNightLightOverlayOpacity(100)).toBe(NIGHT_LIGHT_MAX_OVERLAY_OPACITY);
  });

  it("usa a normalizacao central das preferencias de aparencia", () => {
    expect(getNightLightOverlayOpacity(-50)).toBe(0);
    expect(getNightLightOverlayOpacity(500)).toBe(NIGHT_LIGHT_MAX_OVERLAY_OPACITY);
    expect(getNightLightOverlayOpacity("75")).toBeCloseTo(0.39);
    expect(getNightLightOverlayOpacity(Number.NaN)).toBeCloseTo(0.26);
  });
});
