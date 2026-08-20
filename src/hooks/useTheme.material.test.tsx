// @vitest-environment jsdom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider, useTheme } from "./useTheme";

type TestMaterial = "flat" | "glass";

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
  getMaterialVariant: vi.fn(),
  setMaterialVariant: vi.fn(),
  getWallpaperFile: vi.fn(),
  getWallpaperOpacity: vi.fn(),
  clearWallpaperFile: vi.fn(),
}));

vi.mock("../lib/database", () => ({
  getMaterialVariant: databaseMocks.getMaterialVariant,
  setMaterialVariant: databaseMocks.setMaterialVariant,
  isMaterialVariant: (value: unknown) => value === "flat" || value === "glass",
  isMaterialVariantChangedPayload: (payload: unknown) => {
    if (typeof payload !== "object" || payload === null) {
      return false;
    }
    const candidate = payload as Record<string, unknown>;
    return (
      (candidate.material === "flat" || candidate.material === "glass") &&
      typeof candidate.origin === "string"
    );
  },
  MATERIAL_VARIANT_CHANGED_EVENT: "app:material-variant-changed",
  WALLPAPER_SETTINGS_CHANGED_EVENT: "app:wallpaper-settings-changed",
  getWallpaperFile: databaseMocks.getWallpaperFile,
  getWallpaperOpacity: databaseMocks.getWallpaperOpacity,
  clearWallpaperFile: databaseMocks.clearWallpaperFile,
  normalizeWallpaperOpacity: (value: number) => Math.min(100, Math.max(0, Math.round(value))),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: eventMocks.listen,
}));

const materialEvent = "app:material-variant-changed";
const materialStorageKey = "athenaeum-material";

// O jsdom desta configuracao nao expoe window.localStorage, e o ThemeProvider le
// tanto o modo quanto o cache de material dele ja na montagem. Stub minimo em
// memoria, local a este arquivo: nao ha setup global de teste no projeto e o
// eixo de material nao justifica criar um.
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

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let latestSetMaterial: ((material: TestMaterial) => void) | null = null;

function MaterialConsumer() {
  const { material, setMaterial } = useTheme();
  latestSetMaterial = setMaterial;
  return <output data-testid="material">{material}</output>;
}

async function renderProvider(children: ReactNode = <span>conteudo</span>) {
  await act(async () => {
    root?.render(<ThemeProvider databaseSource="preloaded">{children}</ThemeProvider>);
    await Promise.resolve();
    await Promise.resolve();
  });
}

// Deixa a leitura do SQLite pendurada para inspecionar o estado de bootstrap
// (antes da reconciliacao) e so entao resolver.
function deferMaterialRead() {
  let settle: ((material: TestMaterial) => void) | null = null;
  let fail: ((error: Error) => void) | null = null;

  databaseMocks.getMaterialVariant.mockReturnValue(
    new Promise<TestMaterial>((resolve, reject) => {
      settle = resolve;
      fail = reject;
    }),
  );

  return {
    async resolve(material: TestMaterial) {
      await act(async () => {
        settle?.(material);
        await Promise.resolve();
        await Promise.resolve();
      });
    },
    async reject(message: string) {
      await act(async () => {
        fail?.(new Error(message));
        await Promise.resolve();
        await Promise.resolve();
      });
    },
  };
}

function dispatchMaterial(payload: unknown) {
  const handler = eventMocks.handlers.get(materialEvent);
  if (!handler) {
    throw new Error("Listener de material nao registrado.");
  }
  act(() => handler({ payload }));
}

beforeEach(() => {
  eventMocks.handlers.clear();
  eventMocks.listen.mockClear();
  databaseMocks.getMaterialVariant.mockReset();
  databaseMocks.getMaterialVariant.mockResolvedValue("flat");
  databaseMocks.setMaterialVariant.mockReset();
  databaseMocks.setMaterialVariant.mockResolvedValue(undefined);
  databaseMocks.getWallpaperFile.mockReset().mockResolvedValue(null);
  databaseMocks.getWallpaperOpacity.mockReset().mockResolvedValue(50);
  databaseMocks.clearWallpaperFile.mockReset().mockResolvedValue(undefined);
  memoryStorage.clear();
  latestSetMaterial = null;
  document.documentElement.classList.remove("dark");
  delete document.documentElement.dataset.material;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
});

describe("eixo de material no ThemeProvider", () => {
  it("aplica o material persistido na montagem, sem depender de evento", async () => {
    databaseMocks.getMaterialVariant.mockResolvedValue("glass");

    await renderProvider();

    expect(databaseMocks.getMaterialVariant).toHaveBeenCalledWith("preloaded");
    expect(document.documentElement.dataset.material).toBe("glass");
  });

  it("aplica o material recebido de outra janela", async () => {
    await renderProvider();
    expect(document.documentElement.dataset.material).toBe("flat");

    dispatchMaterial({ material: "glass", origin: "main" });

    expect(document.documentElement.dataset.material).toBe("glass");
  });

  it("ignora payload fora do eixo material", async () => {
    databaseMocks.getMaterialVariant.mockResolvedValue("glass");
    await renderProvider();

    dispatchMaterial({ material: "frosted", origin: "main" });

    expect(document.documentElement.dataset.material).toBe("glass");
  });

  it("nao toca no eixo claro/escuro", async () => {
    databaseMocks.getMaterialVariant.mockResolvedValue("glass");
    memoryStorage.set("athenaeum-theme", "dark");

    await renderProvider();

    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.dataset.material).toBe("glass");
  });
});

describe("espelho do material em localStorage", () => {
  it("bootstrapa em flat quando nao ha valor em cache e reconcilia com o SQLite", async () => {
    const materialRead = deferMaterialRead();

    await renderProvider();
    // Ainda sem resposta do SQLite: sem cache, o bootstrap so pode ser flat.
    expect(document.documentElement.dataset.material).toBe("flat");

    await materialRead.resolve("glass");

    expect(document.documentElement.dataset.material).toBe("glass");
    expect(memoryStorage.get(materialStorageKey)).toBe("glass");
  });

  it("aplica o material em cache antes de o SQLite responder", async () => {
    memoryStorage.set(materialStorageKey, "glass");
    const materialRead = deferMaterialRead();

    await renderProvider();

    // Este e o ponto da Parte 2: nenhuma janela pintada em flat esperando IPC.
    expect(document.documentElement.dataset.material).toBe("glass");
    expect(databaseMocks.getMaterialVariant).toHaveBeenCalledWith("preloaded");

    await materialRead.resolve("glass");
    expect(document.documentElement.dataset.material).toBe("glass");
  });

  it("deixa o SQLite vencer e corrige o cache quando os dois divergem", async () => {
    memoryStorage.set(materialStorageKey, "glass");
    const materialRead = deferMaterialRead();

    await renderProvider();
    expect(document.documentElement.dataset.material).toBe("glass");

    await materialRead.resolve("flat");

    expect(document.documentElement.dataset.material).toBe("flat");
    expect(memoryStorage.get(materialStorageKey)).toBe("flat");
  });

  it("preserva o cache quando a leitura do SQLite falha", async () => {
    memoryStorage.set(materialStorageKey, "glass");
    const materialRead = deferMaterialRead();

    await renderProvider();
    await materialRead.reject("banco indisponivel");

    // Sem resposta da fonte de verdade nao ha o que reconciliar: descartar o
    // cache aqui traria de volta o flash que ele existe para evitar.
    expect(document.documentElement.dataset.material).toBe("glass");
    expect(memoryStorage.get(materialStorageKey)).toBe("glass");
  });

  it("ignora cache invalido escrito por outra versao", async () => {
    memoryStorage.set(materialStorageKey, "frosted");
    deferMaterialRead();

    await renderProvider();

    expect(document.documentElement.dataset.material).toBe("flat");
  });

  it("grava nos dois lugares quando o material muda pelo setMaterial", async () => {
    await renderProvider(<MaterialConsumer />);

    act(() => latestSetMaterial?.("glass"));

    expect(databaseMocks.setMaterialVariant).toHaveBeenCalledWith("glass", "preloaded");
    expect(memoryStorage.get(materialStorageKey)).toBe("glass");
    expect(document.documentElement.dataset.material).toBe("glass");
  });

  it("espelha tambem o material que chega de outra janela", async () => {
    await renderProvider();

    dispatchMaterial({ material: "glass", origin: "main" });

    expect(memoryStorage.get(materialStorageKey)).toBe("glass");
    // Evento nao reescreve o SQLite: quem emitiu ja persistiu.
    expect(databaseMocks.setMaterialVariant).not.toHaveBeenCalled();
  });

  it("mantem o evento que chegou durante o bootstrap, e espelha o vencedor", async () => {
    memoryStorage.set(materialStorageKey, "flat");
    const materialRead = deferMaterialRead();

    await renderProvider();
    dispatchMaterial({ material: "glass", origin: "main" });
    expect(document.documentElement.dataset.material).toBe("glass");

    // Resposta tardia do SQLite com o valor antigo: o ref-guard segura.
    await materialRead.resolve("flat");

    expect(document.documentElement.dataset.material).toBe("glass");
    expect(memoryStorage.get(materialStorageKey)).toBe("glass");
  });
});
