import {
  DEFAULT_ACCENT_DARK,
  DEFAULT_ACCENT_LIGHT,
  DEFAULT_APPEARANCE_CONTRAST,
  DEFAULT_GLASS_BLUR,
  calculateGlassActionRetention,
  calculateGlassBlurRadii,
  calculateGlassSurfaceAlpha,
  deriveAccentPalette,
  deriveAccentTone,
  hexToHsl,
  normalizeAppearanceContrast,
  normalizeAppearancePreferences,
  normalizeGlassBlur,
  type AppearancePreferences,
  type HexColor,
} from "./appearancePreferences";

export type AppearancePresentationTheme = "light" | "dark";

const WALLPAPER_VISIBILITY_PROPERTY = "--appearance-wallpaper-visibility";
const TITLE_CONTRAST_PROPERTIES = [
  "--appearance-title-text",
  "--appearance-title-page-text",
] as const;

// O titulo de pagina da Biblioteca sempre teve um marrom proprio, mais quente
// que o foreground geral, e por isso nunca acompanhou o contraste dos textos.
// Preservamos essa base: no eixo dos titulos ele parte dela, nao de --foreground.
const TITLE_PAGE_BASES: Record<AppearancePresentationTheme, HexColor> = {
  light: "#2C1810",
  dark: "#F0E8DF",
};

const ACCENT_PROPERTIES = [
  "--primary",
  "--primary-foreground",
  "--accent",
  "--accent-foreground",
  "--ring",
  "--color-primary",
  "--color-primary-hover",
  "--color-primary-soft",
  "--color-primary-text",
  "--color-accent-tint-bg",
  "--color-primary-foreground",
  "--shadow-button-accent",
] as const;

const TEXT_CONTRAST_PROPERTIES = [
  "--foreground",
  "--card-foreground",
  "--muted-foreground",
  "--color-sidebar-text",
  "--color-sidebar-muted",
] as const;

const INTERFACE_CONTRAST_PROPERTIES = [
  "--card",
  "--popover",
  "--border",
  "--input",
  "--muted",
  "--color-sidebar-raised",
  "--appearance-glass-border",
  "--appearance-glass-border-top",
  "--appearance-glass-border-top-elevated",
] as const;

const GLASS_BLUR_PROPERTIES = [
  "--appearance-glass-strength",
  "--appearance-glass-action-blur",
  "--appearance-glass-optical-blur",
  "--appearance-glass-action-retention",
] as const;

type Rgb = { red: number; green: number; blue: number };

type ThemePresentationBase = {
  surface: HexColor;
  sidebar: HexColor;
  foreground: HexColor;
  mutedForeground: HexColor;
  sidebarText: HexColor;
  sidebarMuted: HexColor;
  card: HexColor;
  border: HexColor;
  input: HexColor;
  sidebarRaised: HexColor;
};

const THEME_BASES: Record<AppearancePresentationTheme, ThemePresentationBase> = {
  light: {
    surface: "#F5EDE4",
    sidebar: "#EDE5DA",
    foreground: "#1A1410",
    mutedForeground: "#7A6558",
    sidebarText: "#2C1810",
    sidebarMuted: "#7A6558",
    card: "#FAF5EF",
    border: "#D9CBBF",
    input: "#EDE5DA",
    sidebarRaised: "#D8CCBD",
  },
  dark: {
    surface: "#1A1410",
    sidebar: "#140F0B",
    foreground: "#F0E8DF",
    mutedForeground: "#9E8878",
    sidebarText: "#F0E8DF",
    sidebarMuted: "#9E8878",
    card: "#231C16",
    border: "#3D2E22",
    input: "#2E2018",
    sidebarRaised: "#231C16",
  },
};

function removeProperties(root: HTMLElement, properties: readonly string[]): void {
  for (const property of properties) {
    root.style.removeProperty(property);
  }
}

function parseHex(value: HexColor): Rgb {
  return {
    red: Number.parseInt(value.slice(1, 3), 16),
    green: Number.parseInt(value.slice(3, 5), 16),
    blue: Number.parseInt(value.slice(5, 7), 16),
  };
}

function toHexChannel(value: number): string {
  return Math.round(Math.min(255, Math.max(0, value))).toString(16).padStart(2, "0").toUpperCase();
}

function mixHex(first: HexColor, second: HexColor, amount: number): HexColor {
  const start = parseHex(first);
  const end = parseHex(second);
  const ratio = Math.min(1, Math.max(0, amount));
  return `#${toHexChannel(start.red + (end.red - start.red) * ratio)}${toHexChannel(
    start.green + (end.green - start.green) * ratio,
  )}${toHexChannel(start.blue + (end.blue - start.blue) * ratio)}`;
}

function hexToRgba(value: HexColor, alpha: number): string {
  const color = parseHex(value);
  return `rgba(${color.red}, ${color.green}, ${color.blue}, ${alpha})`;
}

function normalizePercentage(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? Math.min(100, Math.max(0, Math.round(parsed))) : 0;
}

function formatAlpha(value: number): string {
  return Math.min(1, Math.max(0, value)).toFixed(3);
}

export function deriveAppearanceTextContrastTone(
  color: HexColor,
  contrast: number,
  theme: AppearancePresentationTheme,
): HexColor {
  const { lightness } = hexToHsl(color);
  const delta = contrast >= DEFAULT_APPEARANCE_CONTRAST
    ? ((contrast - DEFAULT_APPEARANCE_CONTRAST) / 50) * 18
    : -((DEFAULT_APPEARANCE_CONTRAST - contrast) / 10) * 4;
  const direction = theme === "light" ? -1 : 1;
  return deriveAccentTone(color, lightness + delta * direction);
}

function applyAccentPresentation(
  root: HTMLElement,
  preferences: AppearancePreferences,
  theme: AppearancePresentationTheme,
): void {
  const accent = theme === "light" ? preferences.accentLight : preferences.accentDark;
  const defaultAccent = theme === "light" ? DEFAULT_ACCENT_LIGHT : DEFAULT_ACCENT_DARK;
  if (
    accent === defaultAccent
    && preferences.interfaceContrast === DEFAULT_APPEARANCE_CONTRAST
  ) {
    delete root.dataset.accentAdjusted;
    removeProperties(root, ACCENT_PROPERTIES);
    return;
  }

  const base = THEME_BASES[theme];
  const interfaceSurfaces = deriveInterfaceSurfaceColors(preferences.interfaceContrast, theme);
  const palette = deriveAccentPalette(accent, base.surface, [
    base.sidebar,
    interfaceSurfaces.card,
    interfaceSurfaces.input,
    interfaceSurfaces.sidebarRaised,
  ]);

  if (accent === defaultAccent) {
    delete root.dataset.accentAdjusted;
    removeProperties(root, ACCENT_PROPERTIES);
    root.style.setProperty("--color-primary-text", palette.text);
    return;
  }

  root.dataset.accentAdjusted = "true";
  root.style.setProperty("--primary", palette.primary);
  root.style.setProperty("--primary-foreground", palette.primaryForeground);
  root.style.setProperty("--accent", palette.primary);
  root.style.setProperty("--accent-foreground", palette.primaryForeground);
  root.style.setProperty("--ring", palette.focusRing);
  root.style.setProperty("--color-primary", palette.primary);
  root.style.setProperty("--color-primary-hover", palette.primaryHover);
  root.style.setProperty("--color-primary-soft", palette.soft);
  root.style.setProperty("--color-primary-text", palette.text);
  root.style.setProperty("--color-accent-tint-bg", palette.soft);
  root.style.setProperty("--color-primary-foreground", palette.primaryForeground);
  root.style.setProperty("--shadow-button-accent", `0 1px 2px ${hexToRgba(palette.primary, 0.35)}`);
}

function applyTextContrastPresentation(
  root: HTMLElement,
  contrastValue: number,
  theme: AppearancePresentationTheme,
): void {
  const contrast = normalizeAppearanceContrast(contrastValue);
  if (contrast === DEFAULT_APPEARANCE_CONTRAST) {
    delete root.dataset.textContrastAdjusted;
    removeProperties(root, TEXT_CONTRAST_PROPERTIES);
    return;
  }

  const base = THEME_BASES[theme];
  root.dataset.textContrastAdjusted = "true";
  root.style.setProperty("--foreground", deriveAppearanceTextContrastTone(base.foreground, contrast, theme));
  root.style.setProperty("--card-foreground", deriveAppearanceTextContrastTone(base.foreground, contrast, theme));
  root.style.setProperty("--muted-foreground", deriveAppearanceTextContrastTone(base.mutedForeground, contrast, theme));
  root.style.setProperty("--color-sidebar-text", deriveAppearanceTextContrastTone(base.sidebarText, contrast, theme));
  root.style.setProperty("--color-sidebar-muted", deriveAppearanceTextContrastTone(base.sidebarMuted, contrast, theme));
}

function interfaceMixAmount(contrast: number): { targetAmount: number; high: boolean } {
  if (contrast >= DEFAULT_APPEARANCE_CONTRAST) {
    return {
      targetAmount: (contrast - DEFAULT_APPEARANCE_CONTRAST) / 50,
      high: true,
    };
  }

  return {
    targetAmount: (DEFAULT_APPEARANCE_CONTRAST - contrast) / 10,
    high: false,
  };
}

type InterfaceSurfaceColors = {
  card: HexColor;
  input: HexColor;
  sidebarRaised: HexColor;
};

function deriveInterfaceSurfaceColors(
  contrastValue: number,
  theme: AppearancePresentationTheme,
): InterfaceSurfaceColors {
  const contrast = normalizeAppearanceContrast(contrastValue);
  const base = THEME_BASES[theme];
  if (contrast === DEFAULT_APPEARANCE_CONTRAST) {
    return {
      card: base.card,
      input: base.input,
      sidebarRaised: base.sidebarRaised,
    };
  }

  const { targetAmount, high } = interfaceMixAmount(contrast);
  const contrastTarget = high ? base.foreground : base.surface;
  const surfaceAmount = targetAmount * (high ? 0.12 : 0.32);
  const cardAmount = targetAmount * (high ? 0.08 : 0.28);
  return {
    card: mixHex(base.card, contrastTarget, cardAmount),
    input: mixHex(base.input, contrastTarget, surfaceAmount),
    sidebarRaised: mixHex(base.sidebarRaised, contrastTarget, surfaceAmount),
  };
}

function applyInterfaceContrastPresentation(
  root: HTMLElement,
  contrastValue: number,
  theme: AppearancePresentationTheme,
): void {
  const contrast = normalizeAppearanceContrast(contrastValue);
  if (contrast === DEFAULT_APPEARANCE_CONTRAST) {
    delete root.dataset.interfaceContrastAdjusted;
    removeProperties(root, INTERFACE_CONTRAST_PROPERTIES);
    return;
  }

  const base = THEME_BASES[theme];
  const { targetAmount, high } = interfaceMixAmount(contrast);
  const contrastTarget = high ? base.foreground : base.surface;
  const borderAmount = targetAmount * 0.38;
  const surfaces = deriveInterfaceSurfaceColors(contrast, theme);

  root.dataset.interfaceContrastAdjusted = "true";
  root.style.setProperty("--border", mixHex(base.border, contrastTarget, borderAmount));
  root.style.setProperty("--input", surfaces.input);
  root.style.setProperty("--muted", surfaces.input);
  root.style.setProperty("--card", surfaces.card);
  root.style.setProperty("--popover", surfaces.card);
  root.style.setProperty("--color-sidebar-raised", surfaces.sidebarRaised);

  const edgeScale = high ? targetAmount : -targetAmount;
  if (theme === "light") {
    root.style.setProperty("--appearance-glass-border", `rgb(44 26 16 / ${formatAlpha(0.2 + edgeScale * 0.12)})`);
    root.style.setProperty("--appearance-glass-border-top", `rgb(255 255 255 / ${formatAlpha(0.65 + edgeScale * 0.2)})`);
    root.style.setProperty("--appearance-glass-border-top-elevated", `rgb(255 255 255 / ${formatAlpha(0.85 + edgeScale * 0.1)})`);
  } else {
    root.style.setProperty("--appearance-glass-border", `rgb(255 255 255 / ${formatAlpha(0.1 + edgeScale * 0.07)})`);
    root.style.setProperty("--appearance-glass-border-top", `rgb(255 255 255 / ${formatAlpha(0.1 + edgeScale * 0.07)})`);
    root.style.setProperty("--appearance-glass-border-top-elevated", `rgb(255 255 255 / ${formatAlpha(0.16 + edgeScale * 0.1)})`);
  }
}

function readWallpaperVisibility(root: HTMLElement): number {
  return normalizePercentage(root.style.getPropertyValue(WALLPAPER_VISIBILITY_PROPERTY));
}

function updateWallpaperScrim(root: HTMLElement, blur: number): void {
  if (root.dataset.wallpaper !== "active") {
    root.style.removeProperty("--glass-wallpaper-scrim-alpha");
    return;
  }

  root.style.setProperty(
    "--glass-wallpaper-scrim-alpha",
    calculateGlassSurfaceAlpha(readWallpaperVisibility(root), blur).toFixed(3),
  );
}

// Contraste dos titulos: mesmo eixo do contraste dos textos, aplicado so a
// titulos de pagina e de secao. No padrao nenhuma propriedade e publicada e as
// classes .app-title* caem no fallback historico.
//
// Os titulos neutros derivam do tom JA ajustado pelo eixo dos textos, porque
// e sobre ele que este eixo age; o titulo de pagina deriva da propria base.
export function applyTitleContrastPresentation(
  root: HTMLElement,
  titleContrastValue: unknown,
  textContrastValue: unknown,
  theme: AppearancePresentationTheme,
): void {
  const titleContrast = normalizeAppearanceContrast(titleContrastValue);
  if (titleContrast === DEFAULT_APPEARANCE_CONTRAST) {
    delete root.dataset.titleContrastAdjusted;
    removeProperties(root, TITLE_CONTRAST_PROPERTIES);
    return;
  }

  const textContrast = normalizeAppearanceContrast(textContrastValue);
  const neutro = deriveAppearanceTextContrastTone(
    THEME_BASES[theme].foreground,
    textContrast,
    theme,
  );

  root.dataset.titleContrastAdjusted = "true";
  root.style.setProperty(
    "--appearance-title-text",
    deriveAppearanceTextContrastTone(neutro, titleContrast, theme),
  );
  root.style.setProperty(
    "--appearance-title-page-text",
    deriveAppearanceTextContrastTone(TITLE_PAGE_BASES[theme], titleContrast, theme),
  );
}

export function applyGlassBlurPresentation(value: unknown): void {
  const root = window.document.documentElement;
  const blur = normalizeGlassBlur(value);

  if (blur === DEFAULT_GLASS_BLUR) {
    delete root.dataset.glassBlur;
    removeProperties(root, GLASS_BLUR_PROPERTIES);
  } else {
    const radii = calculateGlassBlurRadii(blur);
    root.dataset.glassBlur = blur === 0 ? "off" : "adjusted";
    root.style.setProperty("--appearance-glass-strength", String(blur));
    root.style.setProperty("--appearance-glass-action-blur", `${radii.action}px`);
    root.style.setProperty("--appearance-glass-optical-blur", `${radii.optical}px`);
    root.style.setProperty(
      "--appearance-glass-action-retention",
      `${(calculateGlassActionRetention(blur) * 100).toFixed(3)}%`,
    );
  }

  updateWallpaperScrim(root, blur);
}

export function applyWallpaperVisibilityPresentation(active: boolean, visibility: unknown): void {
  const root = window.document.documentElement;
  if (!active) {
    root.style.removeProperty(WALLPAPER_VISIBILITY_PROPERTY);
    root.style.removeProperty("--glass-wallpaper-scrim-alpha");
    return;
  }

  const normalizedVisibility = normalizePercentage(visibility);
  root.style.setProperty(WALLPAPER_VISIBILITY_PROPERTY, String(normalizedVisibility));
  const currentBlur = Number(root.style.getPropertyValue("--appearance-glass-strength"));
  updateWallpaperScrim(
    root,
    root.dataset.glassBlur !== undefined && Number.isFinite(currentBlur)
      ? currentBlur
      : DEFAULT_GLASS_BLUR,
  );
}

export function applyAppearancePreferencesPresentation(
  value: unknown,
  theme: AppearancePresentationTheme,
): void {
  const preferences = normalizeAppearancePreferences(value);
  const root = window.document.documentElement;
  applyAccentPresentation(root, preferences, theme);
  applyInterfaceContrastPresentation(root, preferences.interfaceContrast, theme);
  applyTextContrastPresentation(root, preferences.textContrast, theme);
  applyTitleContrastPresentation(root, preferences.titleContrast, preferences.textContrast, theme);
  applyGlassBlurPresentation(preferences.glassBlur);
}

export function clearAppearancePreferencesPresentation(): void {
  const root = window.document.documentElement;
  delete root.dataset.accentAdjusted;
  delete root.dataset.interfaceContrastAdjusted;
  delete root.dataset.textContrastAdjusted;
  delete root.dataset.glassBlur;
  delete root.dataset.titleContrastAdjusted;
  removeProperties(root, TITLE_CONTRAST_PROPERTIES);
  removeProperties(root, ACCENT_PROPERTIES);
  removeProperties(root, TEXT_CONTRAST_PROPERTIES);
  removeProperties(root, INTERFACE_CONTRAST_PROPERTIES);
  removeProperties(root, GLASS_BLUR_PROPERTIES);
  updateWallpaperScrim(root, DEFAULT_GLASS_BLUR);
}
