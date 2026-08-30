// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_APPEARANCE_PREFERENCES,
  type AppearancePreferences,
  type NightLightPreferences,
} from "../lib/appearancePreferences";
import {
  GLOBAL_APPEARANCE_CACHE_STORAGE_KEY,
  GlobalAppearancePreferencesProvider,
  useGlobalAppearancePreferences,
  type GlobalAppearancePreferencesContextValue,
} from "./useGlobalAppearancePreferences";

const eventMocks = vi.hoisted(() => {
  const handlers = new Map<string, (event: { payload: unknown }) => void>();
  return {
    handlers,
    listen: vi.fn(async (eventName: string, handler: (event: { payload: unknown }) => void) => {
      handlers.set(eventName, handler);
      return () => handlers.delete(eventName);
    }),
  };
});

const databaseMocks = vi.hoisted(() => ({
  getPreferences: vi.fn(),
  setAccent: vi.fn(),
  setInterfaceContrast: vi.fn(),
  setTextContrast: vi.fn(),
  setTitleContrast: vi.fn(),
  setGlassBlur: vi.fn(),
  setNightLight: vi.fn(),
  setNightLightSettings: vi.fn(),
  setNightLightStrength: vi.fn(),
}));

const presentationMocks = vi.hoisted(() => ({
  apply: vi.fn(),
  clear: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: eventMocks.listen,
}));

vi.mock("../lib/database", () => ({
  APPEARANCE_PREFERENCES_CHANGED_EVENT: "app:appearance-preferences-changed",
  getAppearancePreferencesWithPresence: databaseMocks.getPreferences,
  setAppearanceAccent: databaseMocks.setAccent,
  setAppearanceInterfaceContrast: databaseMocks.setInterfaceContrast,
  setAppearanceTextContrast: databaseMocks.setTextContrast,
  setAppearanceTitleContrast: databaseMocks.setTitleContrast,
  setAppearanceGlassBlur: databaseMocks.setGlassBlur,
  setNightLightPreferences: databaseMocks.setNightLight,
  setNightLightSettings: databaseMocks.setNightLightSettings,
  setNightLightStrength: databaseMocks.setNightLightStrength,
  isAppearancePreferencesChangedPayload: (payload: unknown) => {
    if (typeof payload !== "object" || payload === null) {
      return false;
    }

    const candidate = payload as Record<string, unknown>;
    if (typeof candidate.origin !== "string") {
      return false;
    }

    if (candidate.kind === "accent") {
      return (
        (candidate.theme === "light" || candidate.theme === "dark")
        && typeof candidate.value === "string"
        && /^#[0-9A-F]{6}$/.test(candidate.value)
      );
    }

    if (candidate.kind === "night-light") {
      return typeof candidate.value === "object" && candidate.value !== null;
    }

    if (candidate.kind === "night-light-strength") {
      return typeof candidate.value === "number" && Number.isInteger(candidate.value);
    }

    if (candidate.kind === "night-light-settings") {
      return typeof candidate.value === "object" && candidate.value !== null;
    }

    return (
      (candidate.kind === "interface-contrast"
        || candidate.kind === "text-contrast"
        || candidate.kind === "glass-blur")
      && typeof candidate.value === "number"
      && Number.isInteger(candidate.value)
    );
  },
}));

vi.mock("../lib/appearancePresentation", () => ({
  applyAppearancePreferencesPresentation: presentationMocks.apply,
  clearAppearancePreferencesPresentation: presentationMocks.clear,
}));

vi.mock("../components/NightLightLayer", () => ({
  NightLightLayer: ({ active, strength }: { active: boolean; strength: number }) => (
    <output data-testid="night-light" data-active={String(active)} data-strength={String(strength)} />
  ),
}));

const appearanceEvent = "app:appearance-preferences-changed";
const legacyContrastStorageKey = "athenaeum-ui-contrast";
const nightLightStructuralChanges = [
  ["ativacao", { enabled: true }],
  ["uso da agenda", { scheduleEnabled: true }],
  ["inicio da agenda", { startTime: "21:00" }],
  ["fim da agenda", { endTime: "06:30" }],
] satisfies ReadonlyArray<readonly [string, Partial<NightLightPreferences>]>;
const memoryStorage = new Map<string, string>();
const localStorageStub: Pick<Storage, "getItem" | "setItem" | "removeItem" | "clear"> = {
  getItem: (key: string) => memoryStorage.get(key) ?? null,
  setItem: (key: string, value: string) => void memoryStorage.set(key, value),
  removeItem: (key: string) => void memoryStorage.delete(key),
  clear: () => memoryStorage.clear(),
};

Object.defineProperty(window, "localStorage", {
  value: localStorageStub,
  configurable: true,
});

let container: HTMLDivElement;
let root: Root;
let latestContext: GlobalAppearancePreferencesContextValue | null = null;

function clonePreferences(overrides: Partial<AppearancePreferences> = {}): AppearancePreferences {
  return {
    ...DEFAULT_APPEARANCE_PREFERENCES,
    ...overrides,
    nightLight: overrides.nightLight
      ? { ...overrides.nightLight }
      : { ...DEFAULT_APPEARANCE_PREFERENCES.nightLight },
  };
}

function Consumer() {
  latestContext = useGlobalAppearancePreferences();
  return (
    <>
      <output data-testid="interface-contrast">{latestContext.preferences.interfaceContrast}</output>
      <output data-testid="text-contrast">{latestContext.preferences.textContrast}</output>
      <output data-testid="glass-blur">{latestContext.preferences.glassBlur}</output>
      <output data-testid="night-enabled">{String(latestContext.preferences.nightLight.enabled)}</output>
      <output data-testid="night-start">{latestContext.preferences.nightLight.startTime}</output>
    </>
  );
}

async function renderProvider(databaseSource: "loaded" | "preloaded" = "loaded") {
  await act(async () => {
    root.render(
      <GlobalAppearancePreferencesProvider databaseSource={databaseSource} theme="light">
        <Consumer />
      </GlobalAppearancePreferencesProvider>,
    );
    await Promise.resolve();
    await Promise.resolve();
  });
}

function dispatchAppearance(payload: unknown) {
  const handler = eventMocks.handlers.get(appearanceEvent);
  if (!handler) {
    throw new Error("Listener de aparencia nao registrado.");
  }

  act(() => handler({ payload }));
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  eventMocks.handlers.clear();
  eventMocks.listen.mockClear();
  databaseMocks.getPreferences.mockReset().mockResolvedValue({
    preferences: clonePreferences(),
    storedContrast: { interface: true, text: true },
  });
  databaseMocks.setAccent.mockReset().mockResolvedValue(undefined);
  databaseMocks.setInterfaceContrast.mockReset().mockResolvedValue(undefined);
  databaseMocks.setTextContrast.mockReset().mockResolvedValue(undefined);
  databaseMocks.setTitleContrast.mockReset().mockResolvedValue(undefined);
  databaseMocks.setGlassBlur.mockReset().mockResolvedValue(undefined);
  databaseMocks.setNightLight.mockReset().mockResolvedValue(undefined);
  databaseMocks.setNightLightSettings.mockReset().mockResolvedValue(undefined);
  databaseMocks.setNightLightStrength.mockReset().mockResolvedValue(undefined);
  presentationMocks.apply.mockReset();
  presentationMocks.clear.mockReset();
  memoryStorage.clear();
  latestContext = null;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe("GlobalAppearancePreferencesProvider", () => {
  it("registra a sincronizacao antes de iniciar a leitura do SQLite", async () => {
    await renderProvider("preloaded");

    expect(eventMocks.listen.mock.invocationCallOrder[0]).toBeLessThan(
      databaseMocks.getPreferences.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
  });

  it("usa o cache no primeiro commit e deixa o SQLite reconciliar a fonte de verdade", async () => {
    memoryStorage.set(GLOBAL_APPEARANCE_CACHE_STORAGE_KEY, JSON.stringify({
      version: 1,
      preferences: clonePreferences({ interfaceContrast: 140, glassBlur: 35 }),
    }));

    let resolveRead: ((value: unknown) => void) | null = null;
    databaseMocks.getPreferences.mockReturnValue(new Promise((resolve) => {
      resolveRead = resolve;
    }));

    await renderProvider("preloaded");

    expect(container.querySelector('[data-testid="interface-contrast"]')?.textContent).toBe("140");
    expect(presentationMocks.apply).toHaveBeenLastCalledWith(
      expect.objectContaining({ interfaceContrast: 140, glassBlur: 35 }),
      "light",
    );

    await act(async () => {
      resolveRead?.({
        preferences: clonePreferences({ interfaceContrast: 115, glassBlur: 80 }),
        storedContrast: { interface: true, text: true },
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.querySelector('[data-testid="interface-contrast"]')?.textContent).toBe("115");
    expect(container.querySelector('[data-testid="glass-blur"]')?.textContent).toBe("80");
  });

  it("aplica sliders imediatamente e persiste somente o ultimo valor apos o debounce", async () => {
    vi.useFakeTimers();
    await renderProvider("preloaded");

    act(() => {
      latestContext?.setInterfaceContrast(120);
      latestContext?.setInterfaceContrast(137);
    });

    expect(container.querySelector('[data-testid="interface-contrast"]')?.textContent).toBe("137");
    expect(databaseMocks.setInterfaceContrast).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(249));
    expect(databaseMocks.setInterfaceContrast).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(1));
    expect(databaseMocks.setInterfaceContrast).toHaveBeenCalledTimes(1);
    expect(databaseMocks.setInterfaceContrast).toHaveBeenCalledWith(137, "preloaded");
  });

  it("mantem uma alteracao local feita enquanto a leitura inicial ainda esta em voo", async () => {
    vi.useFakeTimers();
    let resolveRead: ((value: unknown) => void) | null = null;
    databaseMocks.getPreferences.mockReturnValue(new Promise((resolve) => {
      resolveRead = resolve;
    }));
    await renderProvider("preloaded");

    act(() => latestContext?.setTextContrast(145));
    await act(async () => {
      resolveRead?.({
        preferences: clonePreferences({ textContrast: 90 }),
        storedContrast: { interface: true, text: true },
      });
      await Promise.resolve();
    });

    expect(container.querySelector('[data-testid="text-contrast"]')?.textContent).toBe("145");
  });

  it("sincroniza eventos validos, ignora payloads invalidos e nao regrava o SQLite", async () => {
    await renderProvider("preloaded");

    dispatchAppearance({ kind: "glass-blur", value: 42, origin: "reader-window" });
    expect(container.querySelector('[data-testid="glass-blur"]')?.textContent).toBe("42");

    dispatchAppearance({ kind: "glass-blur", value: "quarenta", origin: "reader-window" });
    expect(container.querySelector('[data-testid="glass-blur"]')?.textContent).toBe("42");
    expect(databaseMocks.setGlassBlur).not.toHaveBeenCalled();
  });

  it("mescla toggle remoto durante debounce da forca sem desfazer nenhum eixo", async () => {
    vi.useFakeTimers();
    await renderProvider("preloaded");

    act(() => latestContext?.setNightLight({
      ...latestContext.preferences.nightLight,
      strength: 73,
    }));
    dispatchAppearance({
      kind: "night-light-settings",
      value: {
        enabled: true,
        scheduleEnabled: true,
        startTime: "21:00",
        endTime: "06:00",
      },
      origin: "reader-window",
    });

    expect(container.querySelector('[data-testid="night-enabled"]')?.textContent).toBe("true");
    expect(container.querySelector('[data-testid="night-start"]')?.textContent).toBe("21:00");
    expect(container.querySelector('[data-testid="night-light"]')?.getAttribute("data-strength")).toBe("73");

    act(() => vi.advanceTimersByTime(250));
    expect(databaseMocks.setNightLightStrength).toHaveBeenCalledWith(73, "preloaded");
    expect(databaseMocks.setNightLightSettings).not.toHaveBeenCalled();
    expect(databaseMocks.setNightLight).not.toHaveBeenCalled();
  });

  it("migra o contraste local antigo para os dois eixos apenas na janela principal", async () => {
    memoryStorage.set(legacyContrastStorageKey, "110");
    databaseMocks.getPreferences.mockResolvedValue({
      preferences: clonePreferences(),
      storedContrast: { interface: false, text: false },
    });

    await renderProvider("loaded");

    expect(databaseMocks.setInterfaceContrast).toHaveBeenCalledWith(110, "loaded");
    expect(databaseMocks.setTextContrast).toHaveBeenCalledWith(110, "loaded");
    expect(container.querySelector('[data-testid="interface-contrast"]')?.textContent).toBe("110");
    expect(container.querySelector('[data-testid="text-contrast"]')?.textContent).toBe("110");
    expect(memoryStorage.has(legacyContrastStorageKey)).toBe(false);
  });

  it("nao tenta migrar o localStorage isolado de uma janela auxiliar", async () => {
    memoryStorage.set(legacyContrastStorageKey, "110");
    databaseMocks.getPreferences.mockResolvedValue({
      preferences: clonePreferences(),
      storedContrast: { interface: false, text: false },
    });

    await renderProvider("preloaded");

    expect(databaseMocks.setInterfaceContrast).not.toHaveBeenCalled();
    expect(databaseMocks.setTextContrast).not.toHaveBeenCalled();
    expect(memoryStorage.get(legacyContrastStorageKey)).toBe("110");
  });

  it("reevalia a luz noturna exatamente na proxima fronteira da agenda", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 29, 19, 59, 0, 0));
    const nightLight: NightLightPreferences = {
      version: 1,
      enabled: true,
      strength: 60,
      scheduleEnabled: true,
      startTime: "20:00",
      endTime: "07:00",
    };
    databaseMocks.getPreferences.mockResolvedValue({
      preferences: clonePreferences({ nightLight }),
      storedContrast: { interface: true, text: true },
    });

    await renderProvider("preloaded");
    expect(container.querySelector('[data-testid="night-light"]')?.getAttribute("data-active")).toBe("false");

    act(() => vi.advanceTimersByTime(60_025));
    expect(container.querySelector('[data-testid="night-light"]')?.getAttribute("data-active")).toBe("true");
  });

  it("agrupa alteracoes de forca da luz noturna no debounce e persiste apenas a ultima", async () => {
    vi.useFakeTimers();
    await renderProvider("preloaded");

    act(() => latestContext?.setNightLight({
      ...latestContext.preferences.nightLight,
      strength: 65,
    }));
    act(() => latestContext?.setNightLight({
      ...latestContext.preferences.nightLight,
      strength: 78,
    }));

    expect(databaseMocks.setNightLightStrength).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="night-light"]')?.getAttribute("data-strength")).toBe("78");

    act(() => vi.advanceTimersByTime(249));
    expect(databaseMocks.setNightLightStrength).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(1));
    expect(databaseMocks.setNightLightStrength).toHaveBeenCalledTimes(1);
    expect(databaseMocks.setNightLightStrength).toHaveBeenCalledWith(78, "preloaded");
  });

  it.each(nightLightStructuralChanges)(
    "cancela a forca pendente e salva imediatamente ao mudar %s",
    async (_description, structuralChange) => {
      vi.useFakeTimers();
      await renderProvider("preloaded");

      act(() => latestContext?.setNightLight({
        ...latestContext.preferences.nightLight,
        strength: 70,
      }));
      expect(databaseMocks.setNightLightStrength).not.toHaveBeenCalled();

      act(() => latestContext?.setNightLight({
        ...latestContext.preferences.nightLight,
        ...structuralChange,
      }));

      expect(databaseMocks.setNightLightStrength).toHaveBeenCalledTimes(1);
      expect(databaseMocks.setNightLightStrength).toHaveBeenCalledWith(70, "preloaded");
      expect(databaseMocks.setNightLightSettings).toHaveBeenCalledTimes(1);
      expect(databaseMocks.setNightLightSettings).toHaveBeenCalledWith(expect.objectContaining({
        strength: 70,
        ...structuralChange,
      }), "preloaded");

      act(() => vi.advanceTimersByTime(250));
      expect(databaseMocks.setNightLightStrength).toHaveBeenCalledTimes(1);
      expect(databaseMocks.setNightLightSettings).toHaveBeenCalledTimes(1);
    },
  );

  it("descarrega a ultima forca pendente ao desmontar", async () => {
    vi.useFakeTimers();
    await renderProvider("preloaded");

    act(() => latestContext?.setNightLight({
      ...latestContext.preferences.nightLight,
      strength: 84,
    }));
    act(() => root.unmount());

    expect(databaseMocks.setNightLightStrength).toHaveBeenCalledTimes(1);
    expect(databaseMocks.setNightLightStrength).toHaveBeenCalledWith(84, "preloaded");
    root = createRoot(container);
  });

  it("restaura todos os padroes e persiste o snapshot completo", async () => {
    databaseMocks.getPreferences.mockResolvedValue({
      preferences: clonePreferences({ interfaceContrast: 140, textContrast: 130, glassBlur: 20 }),
      storedContrast: { interface: true, text: true },
    });
    await renderProvider("loaded");

    act(() => latestContext?.resetAppearancePreferences());
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.querySelector('[data-testid="interface-contrast"]')?.textContent).toBe("100");
    expect(container.querySelector('[data-testid="text-contrast"]')?.textContent).toBe("100");
    expect(container.querySelector('[data-testid="glass-blur"]')?.textContent).toBe("100");
    expect(databaseMocks.setAccent).toHaveBeenCalledWith("light", "#9C5A2E", "loaded");
    expect(databaseMocks.setAccent).toHaveBeenCalledWith("dark", "#9C5A2E", "loaded");
    expect(databaseMocks.setTitleContrast).toHaveBeenCalledWith(100, "loaded");
    expect(databaseMocks.setNightLight).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: false, strength: 50 }),
      "loaded",
    );
  });

  it("desmonta limpando a apresentacao e descarrega a ultima escrita pendente", async () => {
    vi.useFakeTimers();
    await renderProvider("preloaded");
    act(() => latestContext?.setGlassBlur(55));

    act(() => root.unmount());

    expect(presentationMocks.clear).toHaveBeenCalledTimes(1);
    expect(databaseMocks.setGlassBlur).toHaveBeenCalledWith(55, "preloaded");
    root = createRoot(container);
  });
});
