// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AnnotationMarkStyle, HighlightColor } from "../../types/annotation";
import { SelectionToolbar } from "./SelectionToolbar";

const anchor = { top: 120, left: 240, width: 80 };

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let onApplyMark: ReturnType<typeof vi.fn<(style: AnnotationMarkStyle, color: HighlightColor) => void>>;
let onAnotar: ReturnType<typeof vi.fn<() => void>>;
let onCopy: ReturnType<typeof vi.fn<() => void>>;

function toolbar(key = "selection-1") {
  return (
    <SelectionToolbar
      key={key}
      anchor={anchor}
      onApplyMark={onApplyMark}
      onAnotar={onAnotar}
      onCopy={onCopy}
    />
  );
}

function button(label: string) {
  const element = container?.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  if (!element) {
    throw new Error(`Botao nao encontrado: ${label}`);
  }
  return element;
}

function queryButton(label: string) {
  return container?.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`) ?? null;
}

function click(element: HTMLElement) {
  act(() => element.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}

function createMemoryStorage(): Storage {
  const values = new Map<string, string>();

  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => Array.from(values.keys())[index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, String(value)),
  };
}

beforeEach(() => {
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: createMemoryStorage(),
  });
  window.localStorage.clear();
  onApplyMark = vi.fn();
  onAnotar = vi.fn();
  onCopy = vi.fn();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

  act(() => root?.render(toolbar()));
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container = null;
  document.body.replaceChildren();
});

describe("SelectionToolbar", () => {
  it("abre uma nova selecao no Estado A sem ferramenta ativa", () => {
    expect(button("Marca-texto").getAttribute("aria-pressed")).toBe("false");
    expect(button("Sublinhar").getAttribute("aria-pressed")).toBe("false");

    click(button("Marca-texto"));
    expect(button("Marca-texto").getAttribute("aria-pressed")).toBe("true");

    act(() => root?.render(toolbar("selection-2")));

    expect(button("Marca-texto").getAttribute("aria-pressed")).toBe("false");
    expect(button("Sublinhar").getAttribute("aria-pressed")).toBe("false");
  });

  it("aplica uma vez no primeiro toque usando a cor default", () => {
    click(button("Marca-texto"));

    expect(onApplyMark).toHaveBeenCalledTimes(1);
    expect(onApplyMark).toHaveBeenCalledWith("highlight", "amber");
    expect(button("Marca-texto").getAttribute("aria-pressed")).toBe("true");
  });

  it("abre a paleta no segundo toque sem reaplicar a ferramenta ativa", () => {
    click(button("Marca-texto"));
    click(button("Marca-texto"));

    expect(onApplyMark).toHaveBeenCalledTimes(1);
    expect(button("Amber para Marca-texto").getAttribute("aria-pressed")).toBe("true");
    expect(queryButton("Sublinhar")).toBeNull();
  });

  it("aplica uma cor diferente e volta ao Estado A", () => {
    click(button("Marca-texto"));
    click(button("Marca-texto"));
    click(button("Blue para Marca-texto"));

    expect(onApplyMark).toHaveBeenCalledTimes(2);
    expect(onApplyMark).toHaveBeenLastCalledWith("highlight", "blue");
    expect(button("Marca-texto").getAttribute("aria-pressed")).toBe("true");
    expect(queryButton("Blue para Marca-texto")).toBeNull();
    expect(window.localStorage.getItem("athenaeum:last-highlight-color")).toBe("blue");
  });

  it("fecha a paleta ao tocar na mesma cor sem reaplicar", () => {
    click(button("Marca-texto"));
    click(button("Marca-texto"));
    click(button("Amber para Marca-texto"));

    expect(onApplyMark).toHaveBeenCalledTimes(1);
    expect(button("Marca-texto").getAttribute("aria-pressed")).toBe("true");
    expect(queryButton("Amber para Marca-texto")).toBeNull();
  });

  it("mantem memorias independentes entre novas selecoes", () => {
    click(button("Marca-texto"));
    click(button("Marca-texto"));
    click(button("Blue para Marca-texto"));

    click(button("Sublinhar"));
    expect(onApplyMark).toHaveBeenLastCalledWith("underline", "amber");
    click(button("Sublinhar"));
    click(button("Rose para Sublinhar"));

    act(() => root?.render(toolbar("selection-2")));
    expect(button("Marca-texto").getAttribute("aria-pressed")).toBe("false");
    expect(button("Sublinhar").getAttribute("aria-pressed")).toBe("false");

    click(button("Marca-texto"));
    expect(onApplyMark).toHaveBeenLastCalledWith("highlight", "blue");
    click(button("Sublinhar"));
    expect(onApplyMark).toHaveBeenLastCalledWith("underline", "rose");
    expect(window.localStorage.getItem("athenaeum:last-highlight-color")).toBe("blue");

    // Restaura a memoria efemera para manter o teste independente em retries.
    click(button("Sublinhar"));
    click(button("Amber para Sublinhar"));
  });

  it("chama onAnotar sem aplicar marcacao", () => {
    click(button("Anotar"));

    expect(onAnotar).toHaveBeenCalledTimes(1);
    expect(onApplyMark).not.toHaveBeenCalled();
  });

  it("mantem Copiar disponivel nos Estados A e B", () => {
    click(button("Copiar"));
    click(button("Marca-texto"));
    click(button("Marca-texto"));
    click(button("Copiar"));

    expect(onCopy).toHaveBeenCalledTimes(2);
    expect(button("Amber para Marca-texto")).toBeTruthy();
  });
});

// O material glass e aplicado 100% por CSS, sob [data-material="glass"] em
// styles/index.css. Estes testes travam os dois lados desse contrato: as classes
// marcadoras que o CSS usa como gancho, e a pintura do material flat, que tem de
// continuar byte-identica ao que era antes do eixo de material existir.
describe("SelectionToolbar — ganchos do material", () => {
  function toolbarElement() {
    const element = container?.querySelector<HTMLDivElement>('div[role="toolbar"]');
    if (!element) {
      throw new Error("Toolbar nao encontrada.");
    }
    return element;
  }

  it("expoe as classes marcadoras que o CSS do glass usa", () => {
    expect(toolbarElement().classList.contains("reader-selection-toolbar")).toBe(true);
    expect(button("Copiar").classList.contains("reader-selection-tool")).toBe(true);
    expect(container?.querySelector(".reader-selection-divider")).toBeTruthy();

    click(button("Marca-texto"));
    click(button("Marca-texto"));

    const selectedSwatch = button("Amber para Marca-texto");
    expect(selectedSwatch.classList.contains("reader-selection-swatch")).toBe(true);
    expect(selectedSwatch.classList.contains("reader-selection-swatch--selected")).toBe(true);
    expect(
      button("Blue para Marca-texto").classList.contains("reader-selection-swatch--selected"),
    ).toBe(false);
  });

  it("preserva a pintura escura do material flat", () => {
    // A ilha e escura nos dois modos em flat; mudar qualquer uma destas
    // utilitarias e regressao visual, nao refatoracao.
    const toolbarClasses = toolbarElement().className;
    expect(toolbarClasses).toContain("bg-[var(--surface-elevated)]");
    expect(toolbarClasses).toContain("shadow-2xl");
    expect(toolbarClasses).toContain("ring-1");
    expect(toolbarClasses).toContain("ring-white/10");

    expect(container?.querySelector(".reader-selection-divider")?.className).toContain("bg-white/10");
    expect(button("Marca-texto").className).toContain("text-[#9E8878]");

    click(button("Marca-texto"));
    expect(button("Marca-texto").className).toContain("bg-white/10");
    expect(button("Marca-texto").className).toContain("text-white");

    click(button("Marca-texto"));
    const selectedSwatch = button("Amber para Marca-texto");
    expect(selectedSwatch.className).toContain("ring-2");
    expect(selectedSwatch.className).toContain("ring-white");
    expect(selectedSwatch.className).toContain("ring-offset-[var(--surface-elevated)]");
  });
});
