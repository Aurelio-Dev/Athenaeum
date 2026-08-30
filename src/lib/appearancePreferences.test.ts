import { describe, expect, it } from "vitest";
import {
  calculateCielabLightness,
  calculateContrastRatio,
  calculateGlassActionAlpha,
  calculateGlassActionRetention,
  calculateGlassBlurRadii,
  calculateGlassSurfaceAlpha,
  calculateLightnessDifference,
  chooseReadableForeground,
  DEFAULT_ACCENT_DARK,
  DEFAULT_ACCENT_LIGHT,
  DEFAULT_APPEARANCE_CONTRAST,
  DEFAULT_GLASS_BLUR,
  DEFAULT_NIGHT_LIGHT_PREFERENCES,
  deriveAccessibleAccentText,
  deriveAccentPalette,
  deriveAccentTone,
  getNextNightLightBoundary,
  hexToHsl,
  isHexColor,
  isNightLightActive,
  isNightLightPreferences,
  isScheduleTime,
  isTimeInsideSchedule,
  normalizeAppearanceContrast,
  normalizeAppearancePreferences,
  normalizeGlassBlur,
  normalizeHexColor,
  normalizeNightLightPreferences,
  serializeNightLightPreferences,
} from "./appearancePreferences";

function hueDistance(first: number, second: number): number {
  const direct = Math.abs(first - second);
  return Math.min(direct, 360 - direct);
}

describe("contratos das preferencias de aparencia", () => {
  it("normaliza somente hexadecimal completo e produz forma canonica", () => {
    expect(isHexColor("#9c5a2e")).toBe(true);
    expect(isHexColor("#fff")).toBe(false);
    expect(isHexColor("#9C5A2EFF")).toBe(false);
    expect(normalizeHexColor("  #9c5a2e ")).toBe("#9C5A2E");
    expect(normalizeHexColor("#fff", DEFAULT_ACCENT_DARK)).toBe(DEFAULT_ACCENT_DARK);
    expect(normalizeHexColor(null, DEFAULT_ACCENT_LIGHT)).toBe(DEFAULT_ACCENT_LIGHT);
  });

  it("normaliza os dois contrastes em 90-150 e blur em 0-100", () => {
    expect(normalizeAppearanceContrast(89)).toBe(90);
    expect(normalizeAppearanceContrast("110")).toBe(110);
    expect(normalizeAppearanceContrast(149.6)).toBe(150);
    expect(normalizeAppearanceContrast(151)).toBe(150);
    expect(normalizeAppearanceContrast("110abc")).toBe(DEFAULT_APPEARANCE_CONTRAST);
    expect(normalizeAppearanceContrast(null)).toBe(DEFAULT_APPEARANCE_CONTRAST);

    expect(normalizeGlassBlur(-1)).toBe(0);
    expect(normalizeGlassBlur(49.6)).toBe(50);
    expect(normalizeGlassBlur(101)).toBe(100);
    expect(normalizeGlassBlur("invalido")).toBe(DEFAULT_GLASS_BLUR);
  });

  it("normaliza um snapshot parcial sem compartilhar o objeto mutavel da luz noturna", () => {
    const first = normalizeAppearancePreferences({
      accentLight: "#339cff",
      interfaceContrast: 120,
      nightLight: { version: 1, enabled: true, strength: 75 },
    });
    const second = normalizeAppearancePreferences(null);

    expect(first).toEqual({
      accentLight: "#339CFF",
      accentDark: DEFAULT_ACCENT_DARK,
      interfaceContrast: 120,
      textContrast: 100,
      titleContrast: 100,
      glassBlur: 100,
      nightLight: {
        version: 1,
        enabled: true,
        strength: 75,
        scheduleEnabled: false,
        startTime: "20:00",
        endTime: "07:00",
      },
    });
    expect(first.nightLight).not.toBe(second.nightLight);
  });
});

describe("derivacao acessivel da cor de destaque", () => {
  it("calcula contraste WCAG e diferenca CIELAB com referencias conhecidas", () => {
    expect(calculateContrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 6);
    expect(calculateCielabLightness("#000000")).toBeCloseTo(0, 6);
    expect(calculateCielabLightness("#FFFFFF")).toBeCloseTo(100, 6);
    expect(calculateLightnessDifference("#000000", "#FFFFFF")).toBeCloseTo(100, 6);
    expect(calculateLightnessDifference("#777777", "#777777")).toBe(0);
  });

  it("escolhe preto ou branco com pelo menos 4.5:1 em uma varredura cromatica", () => {
    const colors = [
      "#FF0000", "#FF7F00", "#FFFF00", "#00FF00", "#00FFFF", "#0000FF",
      "#8B00FF", "#9C5A2E", "#339CFF", "#56A4ED", "#808080", "#121212",
    ];

    for (const color of colors) {
      const foreground = chooseReadableForeground(color);
      expect(calculateContrastRatio(color, foreground), color).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("deriva tons variando L e preservando H/S dentro da quantizacao RGB", () => {
    const source = hexToHsl("#9C5A2E");
    const derived = hexToHsl(deriveAccentTone("#9C5A2E", 70));

    expect(hueDistance(source.hue, derived.hue)).toBeLessThan(1);
    expect(Math.abs(source.saturation - derived.saturation)).toBeLessThan(1);
    expect(derived.lightness).toBeCloseTo(70, 0);
  });

  it("encontra texto cromatico AA no claro e no escuro sem misturar com neutros", () => {
    for (const surface of ["#FFFFFF", "#181818"]) {
      const source = hexToHsl("#339CFF");
      const text = deriveAccessibleAccentText("#339CFF", surface);
      const derived = hexToHsl(text);

      expect(calculateContrastRatio(text, surface), surface).toBeGreaterThanOrEqual(4.5);
      expect(hueDistance(source.hue, derived.hue), surface).toBeLessThan(1.5);
      expect(Math.abs(source.saturation - derived.saturation), surface).toBeLessThan(1.5);
    }
  });

  it("mantem AA contra todas as superficies reais em uma varredura cromatica extrema", () => {
    const themes = [
      {
        name: "light",
        surface: "#F5EDE4",
        additionalSurfaces: ["#FAF5EF", "#EDE5DA", "#D8CCBD"],
      },
      {
        name: "dark",
        surface: "#1A1410",
        additionalSurfaces: ["#231C16", "#2E2018", "#140F0B"],
      },
    ] as const;
    const accents = [
      "#000000", "#010101", "#FFFFFF", "#FEFEFE",
      "#FF0000", "#FFFF00", "#00FF00", "#00FFFF", "#0000FF", "#FF00FF",
      "#339CFF", "#9C5A2E", "#000066", "#FDFD00",
    ];

    for (const theme of themes) {
      for (const accent of accents) {
        const palette = deriveAccentPalette(accent, theme.surface, theme.additionalSurfaces);
        const targets = [theme.surface, palette.soft, ...theme.additionalSurfaces];
        for (const target of targets) {
          expect(
            calculateContrastRatio(palette.text, target),
            `${theme.name}:${accent}:${palette.text} sobre ${target}`,
          ).toBeGreaterThanOrEqual(4.5);
        }

        const sourceHsl = hexToHsl(accent);
        const textHsl = hexToHsl(palette.text);
        if (sourceHsl.saturation >= 10 && textHsl.lightness > 0 && textHsl.lightness < 100) {
          expect(hueDistance(sourceHsl.hue, textHsl.hue), `${theme.name}:${accent}:H`).toBeLessThan(2);
          expect(Math.abs(sourceHsl.saturation - textHsl.saturation), `${theme.name}:${accent}:S`).toBeLessThan(2.5);
        }
      }
    }
  });

  it("preserva as assinaturas de superficie unica e adiciona a verificacao multipla", () => {
    const single = deriveAccessibleAccentText("#339CFF", "#F5EDE4");
    const singleAsList = deriveAccessibleAccentText("#339CFF", ["#F5EDE4"]);
    expect(singleAsList).toBe(single);

    const palette = deriveAccentPalette("#FFFF00", "#F5EDE4", ["#D8CCBD"]);
    expect(calculateContrastRatio(palette.text, "#F5EDE4")).toBeGreaterThanOrEqual(4.5);
    expect(calculateContrastRatio(palette.text, palette.soft)).toBeGreaterThanOrEqual(4.5);
    expect(calculateContrastRatio(palette.text, "#D8CCBD")).toBeGreaterThanOrEqual(4.5);
  });

  it("gera papeis interativos cujo foreground continua AA", () => {
    for (const [accent, surface] of [
      ["#9C5A2E", "#FFFFFF"],
      ["#56A4ED", "#181818"],
      ["#FFFF00", "#FFFFFF"],
      ["#000066", "#181818"],
    ]) {
      const palette = deriveAccentPalette(accent, surface);
      expect(calculateContrastRatio(palette.primary, palette.primaryForeground)).toBeGreaterThanOrEqual(4.5);
      expect(calculateContrastRatio(palette.primaryHover, palette.primaryForeground)).toBeGreaterThanOrEqual(4.5);
      expect(calculateContrastRatio(palette.primaryPressed, palette.primaryForeground)).toBeGreaterThanOrEqual(4.5);
      expect(calculateContrastRatio(palette.text, surface)).toBeGreaterThanOrEqual(4.5);
      expect(palette.focusRing).toBe(palette.primary);
    }
  });
});

describe("modelo optico do LiquidGlass", () => {
  it("mapeia os extremos e o meio do slider para 12px/16px", () => {
    expect(calculateGlassBlurRadii(0)).toEqual({ strength: 0, action: 0, optical: 0 });
    expect(calculateGlassBlurRadii(50)).toEqual({ strength: 50, action: 6, optical: 8 });
    expect(calculateGlassBlurRadii(100)).toEqual({ strength: 100, action: 12, optical: 16 });
  });

  it("combina visibilidade e blur sem alterar o caminho historico em 100%", () => {
    expect(calculateGlassSurfaceAlpha(0, 0)).toBe(1);
    expect(calculateGlassSurfaceAlpha(50, 100)).toBe(0.8);
    expect(calculateGlassSurfaceAlpha(50, 50)).toBe(0.75);
    expect(calculateGlassSurfaceAlpha(50, 0)).toBe(0.7);
    expect(calculateGlassSurfaceAlpha(100, 100)).toBe(0.6);
    expect(calculateGlassSurfaceAlpha(100, 0)).toBe(0.4);
  });

  it("retém de dois tercos ate a alpha integral nas superficies de acao", () => {
    expect(calculateGlassActionRetention(0)).toBeCloseTo(2 / 3, 4);
    expect(calculateGlassActionRetention(50)).toBeCloseTo(5 / 6, 4);
    expect(calculateGlassActionRetention(100)).toBe(1);
    expect(calculateGlassActionAlpha(0.9, 0)).toBe(0.6);
    expect(calculateGlassActionAlpha(0.9, 100)).toBe(0.9);
  });
});

describe("luz noturna e agenda local", () => {
  const overnight = {
    version: 1 as const,
    enabled: true,
    strength: 65,
    scheduleEnabled: true,
    startTime: "20:00",
    endTime: "07:00",
  };

  it("valida horários e normaliza JSON versionado campo a campo", () => {
    expect(isScheduleTime("00:00")).toBe(true);
    expect(isScheduleTime("23:59")).toBe(true);
    expect(isScheduleTime("24:00")).toBe(false);
    expect(isScheduleTime("7:00")).toBe(false);

    expect(normalizeNightLightPreferences(JSON.stringify({
      version: 1,
      enabled: true,
      strength: 999,
      scheduleEnabled: true,
      startTime: "25:00",
      endTime: "06:30",
    }))).toEqual({
      version: 1,
      enabled: true,
      strength: 100,
      scheduleEnabled: true,
      startTime: "20:00",
      endTime: "06:30",
    });

    expect(normalizeNightLightPreferences("{invalido")).toEqual(DEFAULT_NIGHT_LIGHT_PREFERENCES);
    expect(normalizeNightLightPreferences({ version: 2, enabled: true })).toEqual(DEFAULT_NIGHT_LIGHT_PREFERENCES);
  });

  it("serializa somente o contrato normalizado e valida o payload estrito", () => {
    const serialized = serializeNightLightPreferences({
      version: 1,
      enabled: true,
      strength: 49.6,
      scheduleEnabled: false,
      startTime: "20:00",
      endTime: "07:00",
      extra: "ignorado",
    });

    expect(JSON.parse(serialized)).toEqual({ ...overnight, strength: 50, scheduleEnabled: false });
    expect(isNightLightPreferences(JSON.parse(serialized))).toBe(true);
    expect(isNightLightPreferences({ ...overnight, strength: 50.5 })).toBe(false);
    expect(isNightLightPreferences({ ...overnight, endTime: "7:00" })).toBe(false);
  });

  it("trata inicio como inclusivo, fim como exclusivo e cruza meia-noite", () => {
    expect(isTimeInsideSchedule(19 * 60 + 59, "20:00", "07:00")).toBe(false);
    expect(isTimeInsideSchedule(20 * 60, "20:00", "07:00")).toBe(true);
    expect(isTimeInsideSchedule(0, "20:00", "07:00")).toBe(true);
    expect(isTimeInsideSchedule(6 * 60 + 59, "20:00", "07:00")).toBe(true);
    expect(isTimeInsideSchedule(7 * 60, "20:00", "07:00")).toBe(false);
    expect(isTimeInsideSchedule(12 * 60, "08:00", "17:00")).toBe(true);
    expect(isTimeInsideSchedule(17 * 60, "08:00", "17:00")).toBe(false);
    expect(isTimeInsideSchedule(123, "12:00", "12:00")).toBe(true);
    expect(isTimeInsideSchedule(-1, "20:00", "07:00")).toBe(false);
    expect(isTimeInsideSchedule(1440, "20:00", "07:00")).toBe(false);
  });

  it("usa o toggle como autorizacao mestre e a agenda apenas quando habilitada", () => {
    expect(isNightLightActive({ ...overnight, enabled: false }, new Date(2026, 7, 29, 21, 0))).toBe(false);
    expect(isNightLightActive({ ...overnight, scheduleEnabled: false }, new Date(2026, 7, 29, 12, 0))).toBe(true);
    expect(isNightLightActive(overnight, new Date(2026, 7, 29, 21, 0))).toBe(true);
    expect(isNightLightActive(overnight, new Date(2026, 7, 29, 12, 0))).toBe(false);
  });

  it("calcula a proxima fronteira local estritamente posterior ao instante atual", () => {
    const beforeStart = getNextNightLightBoundary(overnight, new Date(2026, 7, 29, 19, 30));
    expect(beforeStart).toEqual(new Date(2026, 7, 29, 20, 0));

    const atStart = getNextNightLightBoundary(overnight, new Date(2026, 7, 29, 20, 0));
    expect(atStart).toEqual(new Date(2026, 7, 30, 7, 0));

    const afterMidnight = getNextNightLightBoundary(overnight, new Date(2026, 7, 30, 1, 0));
    expect(afterMidnight).toEqual(new Date(2026, 7, 30, 7, 0));

    expect(getNextNightLightBoundary({ ...overnight, enabled: false }, new Date())).toBeNull();
    expect(getNextNightLightBoundary({ ...overnight, scheduleEnabled: false }, new Date())).toBeNull();
    expect(getNextNightLightBoundary({ ...overnight, endTime: "20:00" }, new Date())).toBeNull();
  });
});
