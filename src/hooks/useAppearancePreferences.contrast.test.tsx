// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AppearancePreferencesProvider,
  uiContrastOptions,
  useAppearancePreferences,
} from "./useAppearancePreferences";

// O jsdom desta configuracao nao expoe window.localStorage e o provider le as
// duas preferencias na montagem. Stub minimo em memoria, local a este arquivo.
const memoryStorage = new Map<string, string>();
Object.defineProperty(window, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => memoryStorage.get(key) ?? null,
    setItem: (key: string, value: string) => void memoryStorage.set(key, value),
    removeItem: (key: string) => void memoryStorage.delete(key),
    clear: () => memoryStorage.clear(),
  } satisfies Pick<Storage, "getItem" | "setItem" | "removeItem" | "clear">,
});

const contrastKey = "athenaeum-ui-contrast";

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let contrasteAtual: number | null = null;

function Sonda() {
  contrasteAtual = useAppearancePreferences().uiContrast;
  return null;
}

async function montar() {
  await act(async () => {
    root?.render(
      <AppearancePreferencesProvider>
        <Sonda />
      </AppearancePreferencesProvider>,
    );
    await Promise.resolve();
  });
}

beforeEach(() => {
  memoryStorage.clear();
  contrasteAtual = null;
  delete document.documentElement.dataset.uiContrast;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
});

describe("niveis de contraste da interface", () => {
  it("o nivel 90 nao e mais oferecido", () => {
    expect(uiContrastOptions).toEqual([100, 110, 120]);
    expect(uiContrastOptions).not.toContain(90);
  });

  it("100 e o piso: nenhuma opcao fica abaixo do default", () => {
    expect(Math.min(...uiContrastOptions)).toBe(100);
  });

  it("migra um 90 ja persistido para 100 e reescreve a chave", async () => {
    memoryStorage.set(contrastKey, "90");

    await montar();

    expect(contrasteAtual).toBe(100);
    expect(document.documentElement.dataset.uiContrast).toBe("100");
    // O valor invalido nao pode sobreviver a primeira abertura.
    expect(memoryStorage.get(contrastKey)).toBe("100");
  });

  it("preserva um nivel valido ja persistido", async () => {
    memoryStorage.set(contrastKey, "110");

    await montar();

    expect(contrasteAtual).toBe(110);
    expect(document.documentElement.dataset.uiContrast).toBe("110");
  });

  it("aceita o nivel novo 120", async () => {
    memoryStorage.set(contrastKey, "120");

    await montar();

    expect(contrasteAtual).toBe(120);
    expect(document.documentElement.dataset.uiContrast).toBe("120");
  });

  it("cai no default quando nao ha nada persistido", async () => {
    await montar();

    expect(contrasteAtual).toBe(100);
    expect(memoryStorage.get(contrastKey)).toBe("100");
  });
});
