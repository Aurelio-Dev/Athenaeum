// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import {
  applyAppearancePreferencesPresentation,
  applyGlassBlurPresentation,
  applyWallpaperVisibilityPresentation,
  clearAppearancePreferencesPresentation,
  deriveAppearanceTextContrastTone,
} from "./appearancePresentation";
import {
  DEFAULT_APPEARANCE_PREFERENCES,
  calculateContrastRatio,
} from "./appearancePreferences";

function preferences(overrides: Partial<typeof DEFAULT_APPEARANCE_PREFERENCES>) {
  return {
    ...DEFAULT_APPEARANCE_PREFERENCES,
    nightLight: { ...DEFAULT_APPEARANCE_PREFERENCES.nightLight },
    ...overrides,
  };
}

afterEach(() => {
  clearAppearancePreferencesPresentation();
  applyWallpaperVisibilityPresentation(false, 0);
  delete document.documentElement.dataset.wallpaper;
});

const THEME_FOREGROUND = { light: "#1A1410", dark: "#F0E8DF" } as const;

describe("apresentacao das preferencias globais", () => {
  it("preserva o caminho CSS historico quando todos os valores estao no padrao", () => {
    applyAppearancePreferencesPresentation(DEFAULT_APPEARANCE_PREFERENCES, "light");

    const root = document.documentElement;
    expect(root.dataset.accentAdjusted).toBeUndefined();
    expect(root.dataset.interfaceContrastAdjusted).toBeUndefined();
    expect(root.dataset.textContrastAdjusted).toBeUndefined();
    expect(root.dataset.glassBlur).toBeUndefined();
    expect(root.style.getPropertyValue("--primary")).toBe("");
    expect(root.style.getPropertyValue("--border")).toBe("");
    expect(root.style.getPropertyValue("--foreground")).toBe("");
  });

  it("aplica o destaque do tema ativo e escolhe foreground AA", () => {
    applyAppearancePreferencesPresentation(preferences({ accentLight: "#FFFF00" }), "light");

    const root = document.documentElement;
    const primary = root.style.getPropertyValue("--primary");
    const foreground = root.style.getPropertyValue("--primary-foreground");
    const primaryText = root.style.getPropertyValue("--color-primary-text");
    expect(root.dataset.accentAdjusted).toBe("true");
    expect(primary).toBe("#FFFF00");
    expect(foreground).toBe("#000000");
    expect(calculateContrastRatio(primary, foreground)).toBeGreaterThanOrEqual(4.5);
    expect(primaryText).not.toBe(primary);
    expect(calculateContrastRatio(primaryText, "#F5EDE4")).toBeGreaterThanOrEqual(4.5);
  });

  it("mantem o texto de destaque AA nas superficies efetivas dos dois temas", () => {
    for (const [theme, accentKey, accent, surface, sidebar] of [
      ["light", "accentLight", "#FFFF00", "#F5EDE4", "#EDE5DA"],
      ["dark", "accentDark", "#000066", "#1A1410", "#140F0B"],
    ] as const) {
      for (const interfaceContrast of [90, 150]) {
        applyAppearancePreferencesPresentation(
          preferences({ [accentKey]: accent, interfaceContrast }),
          theme,
        );

        const root = document.documentElement;
        const primaryText = root.style.getPropertyValue("--color-primary-text");
        const targets = [
          surface,
          sidebar,
          root.style.getPropertyValue("--card"),
          root.style.getPropertyValue("--input"),
          root.style.getPropertyValue("--color-sidebar-raised"),
          root.style.getPropertyValue("--color-primary-soft"),
        ];
        for (const target of targets) {
          expect(
            calculateContrastRatio(primaryText, target),
            `${theme}:${interfaceContrast}:${primaryText} sobre ${target}`,
          ).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });

  it("recalcula somente o texto do destaque padrao quando o contraste muda as superficies", () => {
    applyAppearancePreferencesPresentation(preferences({ interfaceContrast: 150 }), "light");

    const root = document.documentElement;
    const primaryText = root.style.getPropertyValue("--color-primary-text");
    expect(root.dataset.accentAdjusted).toBeUndefined();
    expect(root.style.getPropertyValue("--primary")).toBe("");
    expect(primaryText).not.toBe("");
    for (const target of [
      "#F5EDE4",
      "#EDE5DA",
      root.style.getPropertyValue("--card"),
      root.style.getPropertyValue("--input"),
      root.style.getPropertyValue("--color-sidebar-raised"),
    ]) {
      expect(calculateContrastRatio(primaryText, target), target).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("mantem contraste de interface e contraste textual em eixos independentes", () => {
    applyAppearancePreferencesPresentation(preferences({ interfaceContrast: 140 }), "light");
    expect(document.documentElement.style.getPropertyValue("--border")).not.toBe("");
    expect(document.documentElement.style.getPropertyValue("--foreground")).toBe("");

    applyAppearancePreferencesPresentation(preferences({ textContrast: 140 }), "light");
    expect(document.documentElement.style.getPropertyValue("--border")).toBe("");
    expect(document.documentElement.style.getPropertyValue("--foreground")).not.toBe("");
  });

  it("faz o contraste textual crescer continuamente de 90 ate 150 nos dois temas", () => {
    for (const [theme, color, surface] of [
      ["light", "#7A6558", "#F5EDE4"],
      ["dark", "#9E8878", "#1A1410"],
    ] as const) {
      const ratios = [90, 100, 125, 150].map((contrast) => calculateContrastRatio(
        deriveAppearanceTextContrastTone(color, contrast, theme),
        surface,
      ));
      expect(ratios[1]).toBeGreaterThan(ratios[0]);
      expect(ratios[2]).toBeGreaterThan(ratios[1]);
      expect(ratios[3]).toBeGreaterThan(ratios[2]);
    }
  });

  it("publica as cores dos titulos e nao deixa override no padrao", () => {
    const root = document.documentElement;

    applyAppearancePreferencesPresentation(preferences({ titleContrast: 115 }), "light");
    const forte = root.style.getPropertyValue("--appearance-title-text");
    const paginaForte = root.style.getPropertyValue("--appearance-title-page-text");
    expect(root.dataset.titleContrastAdjusted).toBe("true");
    expect(forte).toMatch(/^#[0-9A-F]{6}$/);
    // O titulo de pagina parte da propria base, mais quente que o foreground.
    expect(paginaForte).not.toBe(forte);

    applyAppearancePreferencesPresentation(preferences({ titleContrast: 100 }), "light");
    expect(root.style.getPropertyValue("--appearance-title-text")).toBe("");
    expect(root.style.getPropertyValue("--appearance-title-page-text")).toBe("");
    expect(root.dataset.titleContrastAdjusted).toBeUndefined();
  });

  it("aumenta o contraste dos titulos nos dois temas e soma ao eixo dos textos", () => {
    const root = document.documentElement;

    for (const [theme, surface] of [["light", "#F5EDE4"], ["dark", "#1A1410"]] as const) {
      // 120 e o teto util no claro: a base #1A1410 ja tem L=8,2% e a derivacao
      // satura em preto por volta de 123%, exatamente como o eixo dos textos
      // ja fazia antes desta mudanca.
      const razoes = [100, 110, 120].map((titleContrast) => {
        applyAppearancePreferencesPresentation(preferences({ titleContrast }), theme);
        const cor = root.style.getPropertyValue("--appearance-title-text")
          || THEME_FOREGROUND[theme];
        return calculateContrastRatio(cor, surface);
      });

      expect(razoes[1], theme).toBeGreaterThan(razoes[0]);
      expect(razoes[2], theme).toBeGreaterThan(razoes[1]);
    }

    // O eixo dos titulos age SOBRE o tom ja ajustado pelo eixo dos textos:
    // com o mesmo contraste de titulo, um contraste textual maior chega mais
    // longe do que sozinho.
    applyAppearancePreferencesPresentation(
      preferences({ titleContrast: 120, textContrast: 100 }),
      "light",
    );
    const soTitulo = root.style.getPropertyValue("--appearance-title-text");
    applyAppearancePreferencesPresentation(
      preferences({ titleContrast: 120, textContrast: 150 }),
      "light",
    );
    const composto = root.style.getPropertyValue("--appearance-title-text");
    expect(calculateContrastRatio(composto, "#F5EDE4"))
      .toBeGreaterThan(calculateContrastRatio(soTitulo, "#F5EDE4"));
  });

  it("mantem o titulo neutro seguindo o eixo dos textos quando o dos titulos e neutro", () => {
    const root = document.documentElement;
    applyAppearancePreferencesPresentation(
      preferences({ titleContrast: 100, textContrast: 150 }),
      "light",
    );

    // Sem override proprio, `.app-title` cai no fallback var(--foreground),
    // que o eixo dos textos ja ajustou.
    expect(root.style.getPropertyValue("--appearance-title-text")).toBe("");
    expect(root.style.getPropertyValue("--foreground")).not.toBe("");
  });

  it("recalcula a transparencia do wallpaper junto com o blur", () => {
    const root = document.documentElement;
    root.dataset.wallpaper = "active";
    applyWallpaperVisibilityPresentation(true, 100);
    expect(root.style.getPropertyValue("--glass-wallpaper-scrim-alpha")).toBe("0.600");

    applyGlassBlurPresentation(0);
    expect(root.dataset.glassBlur).toBe("off");
    expect(root.style.getPropertyValue("--appearance-glass-optical-blur")).toBe("0px");
    expect(root.style.getPropertyValue("--glass-wallpaper-scrim-alpha")).toBe("0.400");

    applyGlassBlurPresentation(100);
    expect(root.dataset.glassBlur).toBeUndefined();
    expect(root.style.getPropertyValue("--appearance-glass-optical-blur")).toBe("");
    expect(root.style.getPropertyValue("--glass-wallpaper-scrim-alpha")).toBe("0.600");
  });
});
