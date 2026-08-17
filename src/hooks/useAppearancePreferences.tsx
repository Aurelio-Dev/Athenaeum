import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

// Contraste: 100 e o PISO, nao o meio. O nivel 90 existia e derrubava o texto
// secundario para 2.95:1-3.74:1 nas superficies claras — abaixo do minimo AA de
// 4.5:1. Um controle de contraste que reduz contraste abaixo do legivel e a
// feature invertida, entao ele saiu. Os niveis agora so sobem a partir do
// default, e cada um tem um bloco html[data-ui-contrast="N"] em styles/index.css.
export type UiContrast = 100 | 110 | 120;
export type UiFontScale = 90 | 95 | 100 | 105 | 110 | 115 | 120;

export const uiContrastOptions: readonly UiContrast[] = [100, 110, 120];
export const uiFontScaleOptions: readonly UiFontScale[] = [90, 95, 100, 105, 110, 115, 120];

const contrastStorageKey = "athenaeum-ui-contrast";
const fontScaleStorageKey = "athenaeum-ui-font-scale";

// Tambem e a migracao de valores persistidos: um "90" gravado por uma versao
// anterior nao esta mais em uiContrastOptions, entao cai no fallback 100. O
// efeito que aplica o nivel reescreve a chave no mount, entao o valor invalido
// nao sobrevive a primeira abertura.
function readStoredNumber<T extends number>(key: string, options: readonly T[], fallback: T): T {
  const storedValue = Number(window.localStorage.getItem(key));
  return options.includes(storedValue as T) ? (storedValue as T) : fallback;
}

type AppearancePreferencesContextValue = {
  uiContrast: UiContrast;
  setUiContrast: (contrast: UiContrast) => void;
  uiFontScale: UiFontScale;
  setUiFontScale: (fontScale: UiFontScale) => void;
};

const AppearancePreferencesContext = createContext<AppearancePreferencesContextValue | null>(null);

export function AppearancePreferencesProvider({ children }: { children: ReactNode }) {
  const [uiContrast, setUiContrast] = useState<UiContrast>(() => readStoredNumber(contrastStorageKey, uiContrastOptions, 100));
  const [uiFontScale, setUiFontScale] = useState<UiFontScale>(() => readStoredNumber(fontScaleStorageKey, uiFontScaleOptions, 100));

  useEffect(() => {
    window.document.documentElement.dataset.uiContrast = String(uiContrast);
    window.localStorage.setItem(contrastStorageKey, String(uiContrast));
  }, [uiContrast]);

  useEffect(() => {
    window.document.documentElement.style.fontSize = `${uiFontScale}%`;
    window.localStorage.setItem(fontScaleStorageKey, String(uiFontScale));
  }, [uiFontScale]);

  const value = useMemo<AppearancePreferencesContextValue>(
    () => ({ uiContrast, setUiContrast, uiFontScale, setUiFontScale }),
    [uiContrast, uiFontScale],
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
