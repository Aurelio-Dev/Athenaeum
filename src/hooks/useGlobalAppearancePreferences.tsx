import { listen } from "@tauri-apps/api/event";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { NightLightLayer } from "../components/NightLightLayer";
import {
  APPEARANCE_PREFERENCES_CHANGED_EVENT,
  getAppearancePreferencesWithPresence,
  isAppearancePreferencesChangedPayload,
  setAppearanceAccent,
  setAppearanceGlassBlur,
  setAppearanceInterfaceContrast,
  setAppearanceTextContrast,
  setAppearanceTitleContrast,
  setNightLightPreferences,
  setNightLightSettings,
  setNightLightStrength,
  type AppearancePreferenceChange,
  type DatabaseHandleSource,
} from "../lib/database";
import {
  DEFAULT_ACCENT_DARK,
  DEFAULT_ACCENT_LIGHT,
  DEFAULT_APPEARANCE_PREFERENCES,
  getNextNightLightBoundary,
  isNightLightActive,
  normalizeAppearanceContrast,
  normalizeAppearancePreferences,
  normalizeGlassBlur,
  normalizeHexColor,
  normalizeNightLightPreferences,
  type AppearanceAccentTheme,
  type AppearancePreferences,
  type HexColor,
  type NightLightPreferences,
} from "../lib/appearancePreferences";
import {
  applyAppearancePreferencesPresentation,
  clearAppearancePreferencesPresentation,
} from "../lib/appearancePresentation";
import type { Theme } from "./useTheme";

const appearanceCacheStorageKey = "athenaeum-appearance-preferences-v1";
const legacyContrastStorageKey = "athenaeum-ui-contrast";
const appearanceCacheVersion = 1;
const sliderPersistenceDelayMs = 250;

type PersistedAppearanceCache = {
  version: typeof appearanceCacheVersion;
  preferences: AppearancePreferences;
};

type PreferenceKey =
  | "accent-light"
  | "accent-dark"
  | "interface-contrast"
  | "text-contrast"
  | "title-contrast"
  | "glass-blur"
  | "night-light";

type PendingWrite = {
  timeoutId: number;
  run: () => void;
};

export type GlobalAppearancePreferencesContextValue = {
  preferences: AppearancePreferences;
  setAccent: (theme: AppearanceAccentTheme, color: HexColor | string) => void;
  setInterfaceContrast: (contrast: number) => void;
  setTextContrast: (contrast: number) => void;
  setTitleContrast: (scale: number) => void;
  setGlassBlur: (blur: number) => void;
  setNightLight: (preferences: NightLightPreferences) => void;
  flushPendingAppearancePreferences: () => void;
  resetAppearancePreferences: () => void;
  nightLightActive: boolean;
};

type GlobalAppearancePreferencesProviderProps = {
  children: ReactNode;
  databaseSource?: DatabaseHandleSource;
  theme: Theme;
};

const GlobalAppearancePreferencesContext = createContext<GlobalAppearancePreferencesContextValue | null>(null);

function cloneDefaultPreferences(): AppearancePreferences {
  return {
    ...DEFAULT_APPEARANCE_PREFERENCES,
    nightLight: { ...DEFAULT_APPEARANCE_PREFERENCES.nightLight },
  };
}

function readCachedPreferences(): AppearancePreferences {
  try {
    const stored = window.localStorage.getItem(appearanceCacheStorageKey);
    if (!stored) {
      return cloneDefaultPreferences();
    }

    const parsed = JSON.parse(stored) as unknown;
    if (typeof parsed !== "object" || parsed === null) {
      return cloneDefaultPreferences();
    }

    const candidate = parsed as Partial<PersistedAppearanceCache>;
    if (candidate.version !== appearanceCacheVersion) {
      return cloneDefaultPreferences();
    }

    return normalizeAppearancePreferences(candidate.preferences);
  } catch {
    return cloneDefaultPreferences();
  }
}

function writeCachedPreferences(preferences: AppearancePreferences) {
  const cache: PersistedAppearanceCache = {
    version: appearanceCacheVersion,
    preferences,
  };

  try {
    window.localStorage.setItem(appearanceCacheStorageKey, JSON.stringify(cache));
  } catch (error) {
    console.warn("Nao foi possivel atualizar o cache das preferencias de aparencia.", error);
  }
}

function readLegacyContrast(): number | null {
  try {
    const stored = window.localStorage.getItem(legacyContrastStorageKey);
    if (stored === null) {
      return null;
    }

    const parsed = Number(stored);
    return parsed === 90 || parsed === 100 || parsed === 110 ? parsed : null;
  } catch {
    return null;
  }
}

function applyPreferenceChange(
  current: AppearancePreferences,
  change: AppearancePreferenceChange,
): AppearancePreferences {
  switch (change.kind) {
    case "accent":
      return change.theme === "light"
        ? { ...current, accentLight: change.value }
        : { ...current, accentDark: change.value };
    case "interface-contrast":
      return { ...current, interfaceContrast: change.value };
    case "text-contrast":
      return { ...current, textContrast: change.value };
    case "title-contrast":
      return { ...current, titleContrast: change.value };
    case "glass-blur":
      return { ...current, glassBlur: change.value };
    case "night-light-strength":
      return {
        ...current,
        nightLight: { ...current.nightLight, strength: change.value },
      };
    case "night-light-settings":
      return {
        ...current,
        nightLight: { ...current.nightLight, ...change.value },
      };
    case "night-light":
      return { ...current, nightLight: change.value };
  }
}

function preferenceKeyForChange(change: AppearancePreferenceChange): PreferenceKey {
  if (change.kind === "accent") {
    return change.theme === "light" ? "accent-light" : "accent-dark";
  }

  if (
    change.kind === "night-light"
    || change.kind === "night-light-strength"
    || change.kind === "night-light-settings"
  ) {
    return "night-light";
  }

  return change.kind;
}

function hasSameNightLightStructure(
  current: NightLightPreferences,
  next: NightLightPreferences,
): boolean {
  return (
    current.enabled === next.enabled
    && current.scheduleEnabled === next.scheduleEnabled
    && current.startTime === next.startTime
    && current.endTime === next.endTime
  );
}

function hasSameNightLightPreferences(
  current: NightLightPreferences,
  next: NightLightPreferences,
): boolean {
  return hasSameNightLightStructure(current, next) && current.strength === next.strength;
}

function mergeLoadedPreferences(
  current: AppearancePreferences,
  loaded: AppearancePreferences,
  fresherKeys: ReadonlySet<PreferenceKey>,
): AppearancePreferences {
  return {
    accentLight: fresherKeys.has("accent-light") ? current.accentLight : loaded.accentLight,
    accentDark: fresherKeys.has("accent-dark") ? current.accentDark : loaded.accentDark,
    interfaceContrast: fresherKeys.has("interface-contrast")
      ? current.interfaceContrast
      : loaded.interfaceContrast,
    textContrast: fresherKeys.has("text-contrast") ? current.textContrast : loaded.textContrast,
    titleContrast: fresherKeys.has("title-contrast") ? current.titleContrast : loaded.titleContrast,
    glassBlur: fresherKeys.has("glass-blur") ? current.glassBlur : loaded.glassBlur,
    nightLight: fresherKeys.has("night-light") ? current.nightLight : loaded.nightLight,
  };
}

function useNightLightSchedule(preferences: NightLightPreferences): boolean {
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let timeoutId: number | null = null;

    const refresh = () => {
      setRevision((current) => current + 1);
    };

    const scheduleBoundary = () => {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
        timeoutId = null;
      }

      const now = new Date();
      const boundary = getNextNightLightBoundary(preferences, now);
      if (!boundary) {
        return;
      }

      // Alguns relogios disparam timers poucos milissegundos antes do limite.
      // O pequeno acrescimo garante que a avaliacao ja esteja no novo minuto.
      const delay = Math.max(0, boundary.getTime() - now.getTime()) + 25;
      timeoutId = window.setTimeout(() => {
        refresh();
        scheduleBoundary();
      }, delay);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refresh();
        scheduleBoundary();
      }
    };

    const handleFocus = () => {
      refresh();
      scheduleBoundary();
    };

    scheduleBoundary();
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [preferences]);

  return useMemo(
    () => isNightLightActive(preferences, new Date()),
    [preferences, revision],
  );
}

export function GlobalAppearancePreferencesProvider({
  children,
  databaseSource = "loaded",
  theme,
}: GlobalAppearancePreferencesProviderProps) {
  const [preferences, setPreferences] = useState<AppearancePreferences>(readCachedPreferences);
  const fresherKeysRef = useRef(new Set<PreferenceKey>());
  const pendingWritesRef = useRef(new Map<PreferenceKey, PendingWrite>());
  const nightLightActive = useNightLightSchedule(preferences.nightLight);

  const cancelPendingWrite = useCallback((key: PreferenceKey) => {
    const pending = pendingWritesRef.current.get(key);
    if (!pending) {
      return;
    }

    window.clearTimeout(pending.timeoutId);
    pendingWritesRef.current.delete(key);
  }, []);

  const runSafely = useCallback((description: string, operation: () => Promise<void>) => {
    void operation().catch((error: unknown) => {
      console.error(`Nao foi possivel salvar ${description}.`, error);
    });
  }, []);

  const scheduleWrite = useCallback((
    key: PreferenceKey,
    description: string,
    operation: () => Promise<void>,
  ) => {
    cancelPendingWrite(key);

    const run = () => {
      pendingWritesRef.current.delete(key);
      runSafely(description, operation);
    };
    const timeoutId = window.setTimeout(run, sliderPersistenceDelayMs);
    pendingWritesRef.current.set(key, { timeoutId, run });
  }, [cancelPendingWrite, runSafely]);

  const flushPendingAppearancePreferences = useCallback(() => {
    const pendingWrites = [...pendingWritesRef.current.values()];
    for (const pending of pendingWrites) {
      window.clearTimeout(pending.timeoutId);
      pending.run();
    }
    pendingWritesRef.current.clear();
  }, []);

  const applyLocalChange = useCallback((change: AppearancePreferenceChange) => {
    fresherKeysRef.current.add(preferenceKeyForChange(change));
    setPreferences((current) => applyPreferenceChange(current, change));
  }, []);

  useEffect(() => {
    writeCachedPreferences(preferences);
  }, [preferences]);

  useEffect(() => {
    applyAppearancePreferencesPresentation(preferences, theme);
  }, [preferences, theme]);

  useEffect(() => () => {
    clearAppearancePreferencesPresentation();
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;

    const handleRemoteChange = (event: { payload: unknown }) => {
      if (!isAppearancePreferencesChangedPayload(event.payload)) {
        return;
      }

      const change = event.payload;
      const key = preferenceKeyForChange(change);
      // Forca e estrutura da luz noturna persistem separadamente. Enquanto o
      // slider local esta pendente, apenas outro valor de forca e descartado;
      // toggle/agenda remotos sao mesclados e nao podem ser desfeitos pelo
      // callback do debounce. Um snapshot completo representa restauracao e
      // portanto cancela a escolha pendente de forma intencional.
      if (pendingWritesRef.current.has(key)) {
        if (change.kind === "night-light-settings") {
          // Continua para aplicar somente os campos estruturais.
        } else if (change.kind === "night-light") {
          cancelPendingWrite(key);
        } else {
          return;
        }
      }
      fresherKeysRef.current.add(key);
      setPreferences((current) => applyPreferenceChange(current, change));
    };

    void (async () => {
      // A inscricao vem antes dos SELECTs. Assim uma mudanca confirmada entre
      // a leitura e a reconciliacao marca a chave como mais nova e nao se
      // perde num pequeno intervalo de bootstrap.
      try {
        const removeListener = await listen<unknown>(
          APPEARANCE_PREFERENCES_CHANGED_EVENT,
          handleRemoteChange,
        );
        if (disposed) {
          removeListener();
          return;
        }
        unlisten = removeListener;
      } catch (error) {
        console.warn("Nao foi possivel sincronizar as preferencias de aparencia entre as janelas.", error);
      }

      if (disposed) {
        return;
      }

      try {
        const result = await getAppearancePreferencesWithPresence(databaseSource);
        if (disposed) {
          return;
        }

        let loaded = result.preferences;
        const legacyContrast = databaseSource === "loaded" ? readLegacyContrast() : null;
        const migrations: Promise<void>[] = [];

        if (legacyContrast !== null && !result.storedContrast.interface) {
          loaded = { ...loaded, interfaceContrast: legacyContrast };
          migrations.push(setAppearanceInterfaceContrast(legacyContrast, databaseSource));
        }
        if (legacyContrast !== null && !result.storedContrast.text) {
          loaded = { ...loaded, textContrast: legacyContrast };
          migrations.push(setAppearanceTextContrast(legacyContrast, databaseSource));
        }

        setPreferences((current) => mergeLoadedPreferences(
          current,
          loaded,
          fresherKeysRef.current,
        ));

        if (databaseSource === "loaded" && (migrations.length > 0 || (
          result.storedContrast.interface && result.storedContrast.text
        ))) {
          try {
            await Promise.all(migrations);
            window.localStorage.removeItem(legacyContrastStorageKey);
          } catch (error) {
            console.warn("Nao foi possivel concluir a migracao do contraste antigo.", error);
          }
        }
      } catch (error) {
        console.warn("Nao foi possivel carregar as preferencias globais de aparencia.", error);
      }
    })();

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [cancelPendingWrite, databaseSource]);

  // Um slider pode desmontar a janela antes do fim do debounce. Nesse caso a
  // ultima escolha ainda precisa chegar ao SQLite e as outras janelas.
  useEffect(() => () => {
    flushPendingAppearancePreferences();
  }, [flushPendingAppearancePreferences]);

  const setAccent = useCallback((accentTheme: AppearanceAccentTheme, color: HexColor | string) => {
    const fallback = accentTheme === "light" ? DEFAULT_ACCENT_LIGHT : DEFAULT_ACCENT_DARK;
    const value = normalizeHexColor(color, fallback);
    const key: PreferenceKey = accentTheme === "light" ? "accent-light" : "accent-dark";
    applyLocalChange({ kind: "accent", theme: accentTheme, value });
    scheduleWrite(key, "a cor de destaque", () => setAppearanceAccent(accentTheme, value, databaseSource));
  }, [applyLocalChange, databaseSource, scheduleWrite]);

  const setInterfaceContrast = useCallback((contrast: number) => {
    const value = normalizeAppearanceContrast(contrast);
    applyLocalChange({ kind: "interface-contrast", value });
    scheduleWrite(
      "interface-contrast",
      "o contraste da interface",
      () => setAppearanceInterfaceContrast(value, databaseSource),
    );
  }, [applyLocalChange, databaseSource, scheduleWrite]);

  const setTextContrast = useCallback((contrast: number) => {
    const value = normalizeAppearanceContrast(contrast);
    applyLocalChange({ kind: "text-contrast", value });
    scheduleWrite(
      "text-contrast",
      "o contraste dos textos",
      () => setAppearanceTextContrast(value, databaseSource),
    );
  }, [applyLocalChange, databaseSource, scheduleWrite]);

  const setTitleContrast = useCallback((contrast: number) => {
    const value = normalizeAppearanceContrast(contrast);
    applyLocalChange({ kind: "title-contrast", value });
    scheduleWrite(
      "title-contrast",
      "o contraste dos titulos",
      () => setAppearanceTitleContrast(value, databaseSource),
    );
  }, [applyLocalChange, databaseSource, scheduleWrite]);

  const setGlassBlur = useCallback((blur: number) => {
    const value = normalizeGlassBlur(blur);
    applyLocalChange({ kind: "glass-blur", value });
    scheduleWrite("glass-blur", "o desfoque do material Vidro", () => (
      setAppearanceGlassBlur(value, databaseSource)
    ));
  }, [applyLocalChange, databaseSource, scheduleWrite]);

  const setNightLight = useCallback((nextNightLight: NightLightPreferences) => {
    const value = normalizeNightLightPreferences(nextNightLight);
    if (hasSameNightLightPreferences(preferences.nightLight, value)) {
      return;
    }

    const changesOnlyStrength = hasSameNightLightStructure(preferences.nightLight, value);
    applyLocalChange({ kind: "night-light", value });
    if (changesOnlyStrength) {
      scheduleWrite(
        "night-light",
        "a forca da luz noturna",
        () => setNightLightStrength(value.strength, databaseSource),
      );
      return;
    }

    const hadPendingStrength = pendingWritesRef.current.has("night-light");
    cancelPendingWrite("night-light");
    runSafely("a preferencia de luz noturna", async () => {
      // Se a mudanca estrutural encerrou um arraste ainda pendente, persiste os
      // dois eixos; fora desse caso a estrutura nao regrava a forca salva por
      // outra janela.
      if (hadPendingStrength) {
        await Promise.all([
          setNightLightStrength(value.strength, databaseSource),
          setNightLightSettings(value, databaseSource),
        ]);
        return;
      }

      await setNightLightSettings(value, databaseSource);
    });
  }, [
    applyLocalChange,
    cancelPendingWrite,
    databaseSource,
    preferences.nightLight,
    runSafely,
    scheduleWrite,
  ]);

  const resetAppearancePreferences = useCallback(() => {
    for (const key of pendingWritesRef.current.keys()) {
      cancelPendingWrite(key);
    }

    const defaults = cloneDefaultPreferences();
    for (const key of [
      "accent-light",
      "accent-dark",
      "interface-contrast",
      "text-contrast",
      "title-contrast",
      "glass-blur",
      "night-light",
    ] satisfies PreferenceKey[]) {
      fresherKeysRef.current.add(key);
    }
    setPreferences(defaults);

    runSafely("os padroes de aparencia", async () => {
      await Promise.all([
        setAppearanceAccent("light", defaults.accentLight, databaseSource),
        setAppearanceAccent("dark", defaults.accentDark, databaseSource),
        setAppearanceInterfaceContrast(defaults.interfaceContrast, databaseSource),
        setAppearanceTextContrast(defaults.textContrast, databaseSource),
        setAppearanceTitleContrast(defaults.titleContrast, databaseSource),
        setAppearanceGlassBlur(defaults.glassBlur, databaseSource),
        setNightLightPreferences(defaults.nightLight, databaseSource),
      ]);
    });
  }, [cancelPendingWrite, databaseSource, runSafely]);

  const value = useMemo<GlobalAppearancePreferencesContextValue>(() => ({
    preferences,
    setAccent,
    setInterfaceContrast,
    setTextContrast,
    setTitleContrast,
    setGlassBlur,
    setNightLight,
    flushPendingAppearancePreferences,
    resetAppearancePreferences,
    nightLightActive,
  }), [
    nightLightActive,
    preferences,
    flushPendingAppearancePreferences,
    resetAppearancePreferences,
    setAccent,
    setGlassBlur,
    setInterfaceContrast,
    setNightLight,
    setTextContrast,
    setTitleContrast,
  ]);

  return (
    <GlobalAppearancePreferencesContext.Provider value={value}>
      {children}
      <NightLightLayer active={nightLightActive} strength={preferences.nightLight.strength} />
    </GlobalAppearancePreferencesContext.Provider>
  );
}

export function useGlobalAppearancePreferences() {
  const context = useContext(GlobalAppearancePreferencesContext);

  if (!context) {
    throw new Error("useGlobalAppearancePreferences deve ser usado dentro de ThemeProvider.");
  }

  return context;
}

export const GLOBAL_APPEARANCE_CACHE_STORAGE_KEY = appearanceCacheStorageKey;
