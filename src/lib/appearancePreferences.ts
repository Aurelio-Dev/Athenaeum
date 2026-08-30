export type HexColor = `#${string}`;

export type AppearanceAccentTheme = "light" | "dark";

export type NightLightPreferences = {
  version: 1;
  enabled: boolean;
  strength: number;
  scheduleEnabled: boolean;
  startTime: string;
  endTime: string;
};

export type AppearancePreferences = {
  accentLight: HexColor;
  accentDark: HexColor;
  interfaceContrast: number;
  textContrast: number;
  titleContrast: number;
  glassBlur: number;
  nightLight: NightLightPreferences;
};

export type AccentPalette = {
  primary: HexColor;
  primaryForeground: "#000000" | "#FFFFFF";
  primaryHover: HexColor;
  primaryPressed: HexColor;
  text: HexColor;
  soft: HexColor;
  focusRing: HexColor;
};

export type HslColor = {
  hue: number;
  saturation: number;
  lightness: number;
};

type RgbColor = {
  red: number;
  green: number;
  blue: number;
};

export const DEFAULT_ACCENT_LIGHT: HexColor = "#9C5A2E";
export const DEFAULT_ACCENT_DARK: HexColor = "#9C5A2E";

export const MIN_APPEARANCE_CONTRAST = 90;
export const MAX_APPEARANCE_CONTRAST = 150;
export const DEFAULT_APPEARANCE_CONTRAST = 100;

export const MIN_GLASS_BLUR = 0;
export const MAX_GLASS_BLUR = 100;
export const DEFAULT_GLASS_BLUR = 100;

export const MIN_NIGHT_LIGHT_STRENGTH = 0;
export const MAX_NIGHT_LIGHT_STRENGTH = 100;
export const DEFAULT_NIGHT_LIGHT_STRENGTH = 50;
export const DEFAULT_NIGHT_LIGHT_START_TIME = "20:00";
export const DEFAULT_NIGHT_LIGHT_END_TIME = "07:00";

export const DEFAULT_NIGHT_LIGHT_PREFERENCES: Readonly<NightLightPreferences> = Object.freeze({
  version: 1,
  enabled: false,
  strength: DEFAULT_NIGHT_LIGHT_STRENGTH,
  scheduleEnabled: false,
  startTime: DEFAULT_NIGHT_LIGHT_START_TIME,
  endTime: DEFAULT_NIGHT_LIGHT_END_TIME,
});

export const DEFAULT_APPEARANCE_PREFERENCES: Readonly<AppearancePreferences> = Object.freeze({
  accentLight: DEFAULT_ACCENT_LIGHT,
  accentDark: DEFAULT_ACCENT_DARK,
  interfaceContrast: DEFAULT_APPEARANCE_CONTRAST,
  textContrast: DEFAULT_APPEARANCE_CONTRAST,
  titleContrast: DEFAULT_APPEARANCE_CONTRAST,
  glassBlur: DEFAULT_GLASS_BLUR,
  nightLight: DEFAULT_NIGHT_LIGHT_PREFERENCES,
});

const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;
const SCHEDULE_TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const MIN_TEXT_CONTRAST_RATIO = 4.5;

function parseFiniteNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeInteger(
  value: unknown,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  const parsed = parseFiniteNumber(value);
  if (parsed === null) {
    return fallback;
  }

  return Math.min(maximum, Math.max(minimum, Math.round(parsed)));
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value: number, decimalPlaces = 4): number {
  const factor = 10 ** decimalPlaces;
  return Math.round(value * factor) / factor;
}

function parseHexColor(value: string): RgbColor {
  if (!HEX_COLOR_PATTERN.test(value)) {
    throw new Error(`Cor hexadecimal invalida: ${value}`);
  }

  return {
    red: Number.parseInt(value.slice(1, 3), 16),
    green: Number.parseInt(value.slice(3, 5), 16),
    blue: Number.parseInt(value.slice(5, 7), 16),
  };
}

function channelToHex(value: number): string {
  return Math.round(clamp(value, 0, 255)).toString(16).padStart(2, "0").toUpperCase();
}

function rgbToHex({ red, green, blue }: RgbColor): HexColor {
  return `#${channelToHex(red)}${channelToHex(green)}${channelToHex(blue)}`;
}

function hueToRgb(p: number, q: number, input: number): number {
  let hue = input;
  if (hue < 0) hue += 1;
  if (hue > 1) hue -= 1;
  if (hue < 1 / 6) return p + (q - p) * 6 * hue;
  if (hue < 1 / 2) return q;
  if (hue < 2 / 3) return p + (q - p) * (2 / 3 - hue) * 6;
  return p;
}

function hslToHex({ hue, saturation, lightness }: HslColor): HexColor {
  const normalizedHue = ((hue % 360) + 360) % 360 / 360;
  const normalizedSaturation = clamp(saturation, 0, 100) / 100;
  const normalizedLightness = clamp(lightness, 0, 100) / 100;

  if (normalizedSaturation === 0) {
    const channel = normalizedLightness * 255;
    return rgbToHex({ red: channel, green: channel, blue: channel });
  }

  const q = normalizedLightness < 0.5
    ? normalizedLightness * (1 + normalizedSaturation)
    : normalizedLightness + normalizedSaturation - normalizedLightness * normalizedSaturation;
  const p = 2 * normalizedLightness - q;

  return rgbToHex({
    red: hueToRgb(p, q, normalizedHue + 1 / 3) * 255,
    green: hueToRgb(p, q, normalizedHue) * 255,
    blue: hueToRgb(p, q, normalizedHue - 1 / 3) * 255,
  });
}

function linearizeSrgbChannel(channel: number): number {
  const normalized = channel / 255;
  return normalized <= 0.04045
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
}

function rgbToLabLightness(color: RgbColor): number {
  const red = linearizeSrgbChannel(color.red);
  const green = linearizeSrgbChannel(color.green);
  const blue = linearizeSrgbChannel(color.blue);
  const y = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 1;
  const reference = 216 / 24389;
  const transformed = y > reference ? Math.cbrt(y) : (24389 / 27 * y + 16) / 116;
  return 116 * transformed - 16;
}

export function isHexColor(value: unknown): value is HexColor {
  return typeof value === "string" && HEX_COLOR_PATTERN.test(value);
}

export function normalizeHexColor(
  value: unknown,
  fallback: HexColor = DEFAULT_ACCENT_LIGHT,
): HexColor {
  const normalizedFallback = isHexColor(fallback)
    ? fallback.toUpperCase() as HexColor
    : DEFAULT_ACCENT_LIGHT;

  if (typeof value !== "string") {
    return normalizedFallback;
  }

  const trimmed = value.trim();
  return isHexColor(trimmed) ? trimmed.toUpperCase() as HexColor : normalizedFallback;
}

export function normalizeAppearanceContrast(value: unknown): number {
  return normalizeInteger(
    value,
    MIN_APPEARANCE_CONTRAST,
    MAX_APPEARANCE_CONTRAST,
    DEFAULT_APPEARANCE_CONTRAST,
  );
}

export function normalizeGlassBlur(value: unknown): number {
  return normalizeInteger(value, MIN_GLASS_BLUR, MAX_GLASS_BLUR, DEFAULT_GLASS_BLUR);
}

export function normalizeNightLightStrength(value: unknown): number {
  return normalizeInteger(
    value,
    MIN_NIGHT_LIGHT_STRENGTH,
    MAX_NIGHT_LIGHT_STRENGTH,
    DEFAULT_NIGHT_LIGHT_STRENGTH,
  );
}

export function hexToHsl(value: string): HslColor {
  const { red, green, blue } = parseHexColor(value);
  const normalizedRed = red / 255;
  const normalizedGreen = green / 255;
  const normalizedBlue = blue / 255;
  const maximum = Math.max(normalizedRed, normalizedGreen, normalizedBlue);
  const minimum = Math.min(normalizedRed, normalizedGreen, normalizedBlue);
  const difference = maximum - minimum;
  const lightness = (maximum + minimum) / 2;

  if (difference === 0) {
    return { hue: 0, saturation: 0, lightness: lightness * 100 };
  }

  const saturation = lightness > 0.5
    ? difference / (2 - maximum - minimum)
    : difference / (maximum + minimum);
  let hue: number;

  if (maximum === normalizedRed) {
    hue = (normalizedGreen - normalizedBlue) / difference + (normalizedGreen < normalizedBlue ? 6 : 0);
  } else if (maximum === normalizedGreen) {
    hue = (normalizedBlue - normalizedRed) / difference + 2;
  } else {
    hue = (normalizedRed - normalizedGreen) / difference + 4;
  }

  return {
    hue: hue * 60,
    saturation: saturation * 100,
    lightness: lightness * 100,
  };
}

export function deriveAccentTone(value: unknown, lightness: number): HexColor {
  const source = normalizeHexColor(value);
  const hsl = hexToHsl(source);
  return hslToHex({ ...hsl, lightness: clamp(lightness, 0, 100) });
}

export function calculateRelativeLuminance(value: string): number {
  const { red, green, blue } = parseHexColor(value);
  return 0.2126 * linearizeSrgbChannel(red)
    + 0.7152 * linearizeSrgbChannel(green)
    + 0.0722 * linearizeSrgbChannel(blue);
}

function calculateLuminanceContrast(first: number, second: number): number {
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

export function calculateContrastRatio(first: string, second: string): number {
  const firstLuminance = calculateRelativeLuminance(first);
  const secondLuminance = calculateRelativeLuminance(second);
  return calculateLuminanceContrast(firstLuminance, secondLuminance);
}

export function calculateCielabLightness(value: string): number {
  return rgbToLabLightness(parseHexColor(value));
}

export function calculateLightnessDifference(first: string, second: string): number {
  return Math.abs(calculateCielabLightness(first) - calculateCielabLightness(second));
}

export function chooseReadableForeground(background: string): "#000000" | "#FFFFFF" {
  const blackContrast = calculateContrastRatio(background, "#000000");
  const whiteContrast = calculateContrastRatio(background, "#FFFFFF");
  return blackContrast >= whiteContrast ? "#000000" : "#FFFFFF";
}

export function deriveAccessibleAccentText(
  accent: unknown,
  surface: string | readonly string[],
  minimumContrast = MIN_TEXT_CONTRAST_RATIO,
): HexColor {
  const source = normalizeHexColor(accent);
  const surfaces = typeof surface === "string" ? [surface] : [...surface];
  if (surfaces.length === 0) {
    return source;
  }

  const requiredContrast = clamp(minimumContrast, 1, 21);
  const surfaceLuminances = surfaces.map(calculateRelativeLuminance);
  const worstContrastFor = (color: HexColor): number => {
    const colorLuminance = calculateRelativeLuminance(color);
    let worstContrast = Number.POSITIVE_INFINITY;
    for (const surfaceLuminance of surfaceLuminances) {
      worstContrast = Math.min(
        worstContrast,
        calculateLuminanceContrast(colorLuminance, surfaceLuminance),
      );
    }
    return worstContrast;
  };

  if (worstContrastFor(source) >= requiredContrast) {
    return source;
  }

  const sourceHsl = hexToHsl(source);
  let best: { color: HexColor; distance: number; worstContrast: number } | null = null;
  let fallback: { color: HexColor; worstContrast: number } | null = null;

  // A busca altera somente L no espaco HSL. O contraste e conferido no RGB
  // final, depois do arredondamento para hexadecimal, para nao aprovar um tom
  // que falhe por uma diferenca de quantizacao. Quando ha varias superficies,
  // a menor razao entre elas governa a escolha.
  for (let step = 0; step <= 1000; step += 1) {
    const lightness = step / 10;
    const color = hslToHex({ ...sourceHsl, lightness });
    const worstContrast = worstContrastFor(color);
    if (fallback === null || worstContrast > fallback.worstContrast) {
      fallback = { color, worstContrast };
    }
    if (worstContrast + Number.EPSILON < requiredContrast) {
      continue;
    }

    const distance = Math.abs(lightness - sourceHsl.lightness);
    if (
      best === null
      || distance < best.distance
      || (distance === best.distance && worstContrast > best.worstContrast)
    ) {
      best = { color, distance, worstContrast };
    }
  }

  return best?.color ?? fallback?.color ?? source;
}

function deriveInteractiveTone(
  accent: HexColor,
  foreground: "#000000" | "#FFFFFF",
  lightnessDelta: number,
): HexColor {
  const sourceHsl = hexToHsl(accent);
  const preferredDirection = foreground === "#FFFFFF" ? 1 : -1;
  const preferred = hslToHex({
    ...sourceHsl,
    lightness: sourceHsl.lightness + preferredDirection * lightnessDelta,
  });
  if (calculateContrastRatio(preferred, foreground) >= MIN_TEXT_CONTRAST_RATIO) {
    return preferred;
  }

  const opposite = hslToHex({
    ...sourceHsl,
    lightness: sourceHsl.lightness - preferredDirection * lightnessDelta,
  });
  return calculateContrastRatio(opposite, foreground) >= MIN_TEXT_CONTRAST_RATIO
    ? opposite
    : accent;
}

export function deriveAccentPalette(
  accent: unknown,
  surface: string,
  additionalTextSurfaces: readonly string[] = [],
): AccentPalette {
  const primary = normalizeHexColor(accent);
  const primaryForeground = chooseReadableForeground(primary);
  const sourceHsl = hexToHsl(primary);
  const surfaceHsl = hexToHsl(surface);
  const softLightness = surfaceHsl.lightness >= 50 ? 92 : 18;
  const soft = hslToHex({ ...sourceHsl, lightness: softLightness });

  return {
    primary,
    primaryForeground,
    primaryHover: deriveInteractiveTone(primary, primaryForeground, 5),
    primaryPressed: deriveInteractiveTone(primary, primaryForeground, 9),
    text: deriveAccessibleAccentText(primary, [surface, soft, ...additionalTextSurfaces]),
    soft,
    focusRing: primary,
  };
}

export function calculateGlassBlurRadii(value: unknown): {
  strength: number;
  action: number;
  optical: number;
} {
  const strength = normalizeGlassBlur(value);
  const ratio = strength / 100;
  return {
    strength,
    action: round(12 * ratio),
    optical: round(16 * ratio),
  };
}

export function calculateGlassSurfaceAlpha(
  wallpaperVisibility: unknown,
  blur: unknown,
): number {
  const visibilityRatio = normalizeInteger(wallpaperVisibility, 0, 100, 0) / 100;
  const blurRatio = normalizeGlassBlur(blur) / 100;
  return round(1 - visibilityRatio * (0.4 + 0.2 * (1 - blurRatio)));
}

export function calculateGlassActionRetention(blur: unknown): number {
  const blurRatio = normalizeGlassBlur(blur) / 100;
  return round(2 / 3 + blurRatio / 3);
}

export function calculateGlassActionAlpha(currentAlpha: number, blur: unknown): number {
  const alpha = Number.isFinite(currentAlpha) ? clamp(currentAlpha, 0, 1) : 1;
  return round(alpha * calculateGlassActionRetention(blur));
}

function cloneDefaultNightLightPreferences(): NightLightPreferences {
  return { ...DEFAULT_NIGHT_LIGHT_PREFERENCES };
}

export function isScheduleTime(value: unknown): value is string {
  return typeof value === "string" && SCHEDULE_TIME_PATTERN.test(value);
}

export function normalizeNightLightPreferences(value: unknown): NightLightPreferences {
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value) as unknown;
    } catch {
      return cloneDefaultNightLightPreferences();
    }
  }

  if (typeof parsed !== "object" || parsed === null) {
    return cloneDefaultNightLightPreferences();
  }

  const candidate = parsed as Record<string, unknown>;
  if (candidate.version !== 1) {
    return cloneDefaultNightLightPreferences();
  }

  return {
    version: 1,
    enabled: candidate.enabled === true,
    strength: normalizeNightLightStrength(candidate.strength),
    scheduleEnabled: candidate.scheduleEnabled === true,
    startTime: isScheduleTime(candidate.startTime)
      ? candidate.startTime
      : DEFAULT_NIGHT_LIGHT_START_TIME,
    endTime: isScheduleTime(candidate.endTime)
      ? candidate.endTime
      : DEFAULT_NIGHT_LIGHT_END_TIME,
  };
}

export function isNightLightPreferences(value: unknown): value is NightLightPreferences {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    candidate.version === 1
    && typeof candidate.enabled === "boolean"
    && typeof candidate.strength === "number"
    && Number.isInteger(candidate.strength)
    && candidate.strength >= MIN_NIGHT_LIGHT_STRENGTH
    && candidate.strength <= MAX_NIGHT_LIGHT_STRENGTH
    && typeof candidate.scheduleEnabled === "boolean"
    && isScheduleTime(candidate.startTime)
    && isScheduleTime(candidate.endTime)
  );
}

export function serializeNightLightPreferences(value: unknown): string {
  return JSON.stringify(normalizeNightLightPreferences(value));
}

export function normalizeAppearancePreferences(value: unknown): AppearancePreferences {
  const candidate = typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : {};

  return {
    accentLight: normalizeHexColor(candidate.accentLight, DEFAULT_ACCENT_LIGHT),
    accentDark: normalizeHexColor(candidate.accentDark, DEFAULT_ACCENT_DARK),
    interfaceContrast: normalizeAppearanceContrast(candidate.interfaceContrast),
    textContrast: normalizeAppearanceContrast(candidate.textContrast),
    titleContrast: normalizeAppearanceContrast(candidate.titleContrast),
    glassBlur: normalizeGlassBlur(candidate.glassBlur),
    nightLight: normalizeNightLightPreferences(candidate.nightLight),
  };
}

function scheduleTimeToMinutes(value: string): number {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

export function isTimeInsideSchedule(
  currentMinutes: number,
  startTime: string,
  endTime: string,
): boolean {
  if (
    !Number.isInteger(currentMinutes)
    || currentMinutes < 0
    || currentMinutes >= 1440
    || !isScheduleTime(startTime)
    || !isScheduleTime(endTime)
  ) {
    return false;
  }

  const start = scheduleTimeToMinutes(startTime);
  const end = scheduleTimeToMinutes(endTime);

  if (start === end) {
    return true;
  }

  return start < end
    ? currentMinutes >= start && currentMinutes < end
    : currentMinutes >= start || currentMinutes < end;
}

export function isNightLightActive(value: unknown, now = new Date()): boolean {
  const preferences = normalizeNightLightPreferences(value);
  if (!preferences.enabled) {
    return false;
  }

  if (!preferences.scheduleEnabled) {
    return true;
  }

  return isTimeInsideSchedule(
    now.getHours() * 60 + now.getMinutes(),
    preferences.startTime,
    preferences.endTime,
  );
}

function createLocalBoundary(base: Date, dayOffset: number, time: string): Date {
  const [hours, minutes] = time.split(":").map(Number);
  return new Date(
    base.getFullYear(),
    base.getMonth(),
    base.getDate() + dayOffset,
    hours,
    minutes,
    0,
    0,
  );
}

export function getNextNightLightBoundary(value: unknown, now = new Date()): Date | null {
  const preferences = normalizeNightLightPreferences(value);
  if (
    !preferences.enabled
    || !preferences.scheduleEnabled
    || preferences.startTime === preferences.endTime
  ) {
    return null;
  }

  const candidates: Date[] = [];
  for (let dayOffset = 0; dayOffset <= 2; dayOffset += 1) {
    candidates.push(createLocalBoundary(now, dayOffset, preferences.startTime));
    candidates.push(createLocalBoundary(now, dayOffset, preferences.endTime));
  }

  return candidates
    .filter((candidate) => candidate.getTime() > now.getTime())
    .sort((first, second) => first.getTime() - second.getTime())[0] ?? null;
}
