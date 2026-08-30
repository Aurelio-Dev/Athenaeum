import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type UiFontScale = 90 | 95 | 100 | 105 | 110 | 115 | 120;

export const uiFontScaleOptions: readonly UiFontScale[] = [90, 95, 100, 105, 110, 115, 120];

const fontScaleStorageKey = "athenaeum-ui-font-scale";

function readStoredNumber<T extends number>(key: string, options: readonly T[], fallback: T): T {
  const storedValue = Number(window.localStorage.getItem(key));
  return options.includes(storedValue as T) ? (storedValue as T) : fallback;
}

type AppearancePreferencesContextValue = {
  uiFontScale: UiFontScale;
  setUiFontScale: (fontScale: UiFontScale) => void;
};

const AppearancePreferencesContext = createContext<AppearancePreferencesContextValue | null>(null);

export function AppearancePreferencesProvider({ children }: { children: ReactNode }) {
  const [uiFontScale, setUiFontScale] = useState<UiFontScale>(() => readStoredNumber(fontScaleStorageKey, uiFontScaleOptions, 100));

  useEffect(() => {
    window.document.documentElement.style.fontSize = `${uiFontScale}%`;
    window.localStorage.setItem(fontScaleStorageKey, String(uiFontScale));
  }, [uiFontScale]);

  const value = useMemo<AppearancePreferencesContextValue>(
    () => ({ uiFontScale, setUiFontScale }),
    [uiFontScale],
  );

  return <AppearancePreferencesContext.Provider value={value}>{children}</AppearancePreferencesContext.Provider>;
}

export function useAppearancePreferences() {
  const context = useContext(AppearancePreferencesContext);

  if (!context) {
    throw new Error("useAppearancePreferences deve ser usado dentro de AppearancePreferencesProvider.");
  }

  return context;
}
