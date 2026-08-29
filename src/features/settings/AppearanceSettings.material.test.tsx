// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppearanceSettings } from "./AppearanceSettings";

type TestMaterial = "flat" | "glass";
type TestChrome = "docked" | "floating";

const hookMocks = vi.hoisted(() => ({
  setTheme: vi.fn(),
  setMaterial: vi.fn(),
  setChrome: vi.fn(),
  setShowDividerLines: vi.fn(),
  setUiContrast: vi.fn(),
  setUiFontScale: vi.fn(),
  material: { current: "flat" as TestMaterial },
  storedChrome: { current: null as TestChrome | null },
}));

vi.mock("../../hooks/useTheme", () => ({
  useTheme: () => ({
    theme: "light",
    setTheme: hookMocks.setTheme,
    toggleTheme: vi.fn(),
    material: hookMocks.material.current,
    setMaterial: hookMocks.setMaterial,
    storedChrome: hookMocks.storedChrome.current,
    setChrome: hookMocks.setChrome,
  }),
}));

vi.mock("../../hooks/useDividerLines", () => ({
  useDividerLines: () => ({
    showDividerLines: true,
    setShowDividerLines: hookMocks.setShowDividerLines,
  }),
}));

// O controle de wallpaper mora na mesma tela, mas tem teste proprio
// (AppearanceSettings.wallpaper.test.tsx). Aqui ele e stubado para este arquivo
// continuar sendo um teste do eixo de MATERIAL: sem stub, montar a tela abriria
// o banco e o IPC so para exercitar o controle ao lado.
vi.mock("../../hooks/useWallpaperSettings", () => ({
  useWallpaperSettings: () => ({
    fileName: null,
    previewUrl: null,
    opacity: 50,
    isLoading: false,
    isImporting: false,
    error: null,
    chooseWallpaper: vi.fn(),
    removeWallpaper: vi.fn(),
    changeOpacity: vi.fn(),
  }),
}));

vi.mock("../../hooks/useAppearancePreferences", () => ({
  uiContrastOptions: [90, 100, 110],
  uiFontScaleOptions: [90, 95, 100, 105, 110, 115, 120],
  useAppearancePreferences: () => ({
    uiContrast: 100,
    setUiContrast: hookMocks.setUiContrast,
    uiFontScale: 100,
    setUiFontScale: hookMocks.setUiFontScale,
  }),
}));

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function render() {
  act(() => root?.render(<AppearanceSettings />));
}

function materialButton(label: string) {
  const group = container?.querySelector<HTMLDivElement>('div[aria-label="Material da interface"]');
  if (!group) {
    throw new Error("Grupo de material nao encontrado.");
  }

  const element = Array.from(group.querySelectorAll("button")).find(
    (candidate) => candidate.textContent === label,
  );
  if (!element) {
    throw new Error(`Opcao de material nao encontrada: ${label}`);
  }
  return element;
}

function layoutButton(label: string) {
  const group = container?.querySelector<HTMLDivElement>('div[aria-label="Layout da interface"]');
  if (!group) {
    throw new Error("Grupo de layout nao encontrado.");
  }

  const element = Array.from(group.querySelectorAll("button")).find(
    (candidate) => candidate.textContent === label,
  );
  if (!element) {
    throw new Error(`Opcao de layout nao encontrada: ${label}`);
  }
  return element;
}

beforeEach(() => {
  hookMocks.setTheme.mockReset();
  hookMocks.setMaterial.mockReset();
  hookMocks.setChrome.mockReset();
  hookMocks.setShowDividerLines.mockReset();
  hookMocks.setUiContrast.mockReset();
  hookMocks.setUiFontScale.mockReset();
  hookMocks.material.current = "flat";
  hookMocks.storedChrome.current = null;
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

describe("controle de material em Aparencia", () => {
  it("mostra as duas opcoes e marca a atual", () => {
    render();

    expect(materialButton("Padrão").getAttribute("aria-pressed")).toBe("true");
    expect(materialButton("Vidro").getAttribute("aria-pressed")).toBe("false");
  });

  it("aplica a opcao escolhida no clique", () => {
    render();

    act(() => materialButton("Vidro").dispatchEvent(new MouseEvent("click", { bubbles: true })));

    expect(hookMocks.setMaterial).toHaveBeenCalledTimes(1);
    expect(hookMocks.setMaterial).toHaveBeenCalledWith("glass");
  });

  it("NAO aplica material em hover, foco ou navegacao por setas", () => {
    render();
    const glassOption = materialButton("Vidro");

    act(() => {
      glassOption.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      glassOption.dispatchEvent(new MouseEvent("mouseenter"));
      glassOption.dispatchEvent(new PointerEvent("pointerenter"));
      glassOption.focus();
      glassOption.dispatchEvent(new FocusEvent("focus"));
      glassOption.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
      glassOption.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    });

    // Preview vazaria para o espelho em localStorage (ver useTheme.tsx) e
    // deixaria o usuario com um material que ele nao escolheu.
    expect(hookMocks.setMaterial).not.toHaveBeenCalled();
  });

  it("nao usa um select nativo, que troca de valor com seta no estado fechado", () => {
    render();
    const group = container?.querySelector<HTMLDivElement>('div[aria-label="Material da interface"]');

    expect(group?.querySelector("select")).toBeNull();
  });

  it("volta para o material padrao ao restaurar padroes", () => {
    hookMocks.material.current = "glass";
    render();

    const restoreButton = Array.from(container?.querySelectorAll("button") ?? []).find(
      (candidate) => candidate.textContent === "Restaurar padrões",
    );
    act(() => restoreButton?.dispatchEvent(new MouseEvent("click", { bubbles: true })));

    expect(hookMocks.setMaterial).toHaveBeenCalledWith("flat");
    expect(hookMocks.setChrome).toHaveBeenCalledWith(null);
  });
});

describe("controle de layout em Aparencia", () => {
  it("persiste automatico, docado e ilhas pelos tres botoes", () => {
    hookMocks.material.current = "glass";
    render();

    act(() => layoutButton("Automático").dispatchEvent(new MouseEvent("click", { bubbles: true })));
    act(() => layoutButton("Docado").dispatchEvent(new MouseEvent("click", { bubbles: true })));
    act(() => layoutButton("Ilhas").dispatchEvent(new MouseEvent("click", { bubbles: true })));

    expect(hookMocks.setChrome.mock.calls).toEqual([[null], ["docked"], ["floating"]]);
  });

  it("marca a preferencia crua, inclusive automatico quando ela e nula", () => {
    render();
    expect(layoutButton("Automático").getAttribute("aria-pressed")).toBe("true");
    expect(layoutButton("Docado").getAttribute("aria-pressed")).toBe("false");
    expect(layoutButton("Ilhas").getAttribute("aria-pressed")).toBe("false");

    hookMocks.storedChrome.current = "docked";
    render();
    expect(layoutButton("Automático").getAttribute("aria-pressed")).toBe("false");
    expect(layoutButton("Docado").getAttribute("aria-pressed")).toBe("true");

    hookMocks.storedChrome.current = "floating";
    render();
    expect(layoutButton("Docado").getAttribute("aria-pressed")).toBe("false");
    expect(layoutButton("Ilhas").getAttribute("aria-pressed")).toBe("true");
  });

  it("desabilita as tres opcoes quando o material e flat", () => {
    render();

    expect(["Automático", "Docado", "Ilhas"].map((label) => layoutButton(label).disabled)).toEqual([
      true,
      true,
      true,
    ]);
  });
});
