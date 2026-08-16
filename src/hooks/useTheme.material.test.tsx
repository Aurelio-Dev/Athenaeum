// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "./useTheme";

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
}));

vi.mock("../lib/database", () => ({
  getMaterialVariant: databaseMocks.getMaterialVariant,
  setMaterialVariant: databaseMocks.setMaterialVariant,
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
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: eventMocks.listen,
}));

const materialEvent = "app:material-variant-changed";

// O jsdom desta configuracao nao expoe window.localStorage, e o ThemeProvider
// le a preferencia de tema (o eixo claro/escuro) dele ja na montagem. Stub
// minimo em memoria, local a este arquivo: nao ha setup global de teste no
// projeto e o eixo de material nao justifica criar um.
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

async function renderProvider(databaseSource?: "loaded" | "preloaded") {
  await act(async () => {
    root?.render(
      <ThemeProvider databaseSource={databaseSource}>
        <span>conteudo</span>
      </ThemeProvider>,
    );
    await Promise.resolve();
    await Promise.resolve();
  });
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
  memoryStorage.clear();
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

    await renderProvider("preloaded");

    expect(databaseMocks.getMaterialVariant).toHaveBeenCalledWith("preloaded");
    expect(document.documentElement.dataset.material).toBe("glass");
  });

  it("cai em flat quando a leitura do banco falha", async () => {
    databaseMocks.getMaterialVariant.mockRejectedValue(new Error("banco indisponivel"));

    await renderProvider("preloaded");

    expect(document.documentElement.dataset.material).toBe("flat");
  });

  it("aplica o material recebido de outra janela", async () => {
    await renderProvider("preloaded");
    expect(document.documentElement.dataset.material).toBe("flat");

    dispatchMaterial({ material: "glass", origin: "main" });

    expect(document.documentElement.dataset.material).toBe("glass");
  });

  it("ignora payload fora do eixo material", async () => {
    databaseMocks.getMaterialVariant.mockResolvedValue("glass");
    await renderProvider("preloaded");

    dispatchMaterial({ material: "frosted", origin: "main" });

    expect(document.documentElement.dataset.material).toBe("glass");
  });

  it("nao deixa a leitura de montagem sobrescrever um evento que chegou antes dela", async () => {
    let resolveStoredMaterial: ((material: "flat" | "glass") => void) | null = null;
    databaseMocks.getMaterialVariant.mockReturnValue(
      new Promise<"flat" | "glass">((resolve) => {
        resolveStoredMaterial = resolve;
      }),
    );

    await renderProvider("preloaded");
    dispatchMaterial({ material: "glass", origin: "main" });
    expect(document.documentElement.dataset.material).toBe("glass");

    await act(async () => {
      resolveStoredMaterial?.("flat");
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(document.documentElement.dataset.material).toBe("glass");
  });

  it("nao toca no eixo claro/escuro", async () => {
    databaseMocks.getMaterialVariant.mockResolvedValue("glass");
    memoryStorage.set("athenaeum-theme", "dark");

    await renderProvider("preloaded");

    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.dataset.material).toBe("glass");
  });
});
