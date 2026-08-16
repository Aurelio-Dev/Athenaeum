// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AiTab } from "./AiTab";

let container: HTMLDivElement | null = null;
let root: Root | null = null;
const onJumpToPage = vi.fn();

type PreviewState = "not_configured" | "ready" | "generating" | "error";

async function renderTab({
  documentId = "document-1",
  currentPage = 3,
  hasSelection = false,
  initialPreviewState = "ready",
}: {
  documentId?: string;
  currentPage?: number;
  hasSelection?: boolean;
  initialPreviewState?: PreviewState;
} = {}) {
  await act(async () => {
    root?.render(
      <AiTab
        documentId={documentId}
        currentPage={currentPage}
        hasSelection={hasSelection}
        onJumpToPage={onJumpToPage}
        initialPreviewState={initialPreviewState}
      />,
    );
    await Promise.resolve();
  });
}

function getElement<T extends Element = HTMLElement>(selector: string): T {
  const element = container?.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Elemento não encontrado: ${selector}`);
  }
  return element;
}

function buttonByText(text: string) {
  const button = Array.from(container?.querySelectorAll<HTMLButtonElement>("button") ?? [])
    .find((candidate) => candidate.textContent?.trim() === text);
  if (!button) {
    throw new Error(`Botão não encontrado: ${text}`);
  }
  return button;
}

function click(element: HTMLElement) {
  act(() => element.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}

function changeTextareaValue(value: string) {
  const textarea = getElement<HTMLTextAreaElement>('textarea[aria-label="Pergunta para a IA"]');
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  act(() => {
    valueSetter?.call(textarea, value);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
  return textarea;
}

function pressEnter(textarea: HTMLTextAreaElement, shiftKey = false) {
  const event = new KeyboardEvent("keydown", {
    key: "Enter",
    shiftKey,
    bubbles: true,
    cancelable: true,
  });
  act(() => textarea.dispatchEvent(event));
  return event;
}

beforeEach(() => {
  vi.useFakeTimers();
  onJumpToPage.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container = null;
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe("AiTab", () => {
  it("navega pelo chip de página da citação simulada", async () => {
    await renderTab({ currentPage: 7 });
    const textarea = changeTextareaValue("Resumir o argumento");

    pressEnter(textarea);
    act(() => vi.advanceTimersByTime(1_200));
    click(buttonByText("p. 7"));

    expect(onJumpToPage).toHaveBeenCalledWith(7);
  });

  it("envia com Enter e mantém Shift+Enter como quebra de linha", async () => {
    await renderTab();
    const textarea = changeTextareaValue("Primeira pergunta");

    const enterEvent = pressEnter(textarea);
    expect(enterEvent.defaultPrevented).toBe(true);
    expect(container?.textContent).toContain("Primeira pergunta");
    expect(textarea.value).toBe("");

    click(buttonByText("Parar"));
    const multilineTextarea = changeTextareaValue("Linha 1");
    const shiftEnterEvent = pressEnter(multilineTextarea, true);
    expect(shiftEnterEvent.defaultPrevented).toBe(false);

    changeTextareaValue("Linha 1\nLinha 2");
    expect(multilineTextarea.value).toBe("Linha 1\nLinha 2");
    expect(Array.from(container?.querySelectorAll("article") ?? [])
      .some((article) => article.textContent?.includes("Linha 2"))).toBe(false);
  });

  it("preenche o composer pela sugestão sem enviar", async () => {
    await renderTab();

    click(buttonByText("Resumir esta página"));

    expect(getElement<HTMLTextAreaElement>("textarea").value).toBe("Resumir esta página");
    expect(container?.textContent).not.toContain("Gerando resposta simulada");
    expect(container?.textContent).not.toContain("Você");
  });

  it("desabilita o escopo Seleção quando não há seleção ativa", async () => {
    await renderTab({ hasSelection: false });

    const selectionOption = buttonByText("Seleção");
    expect(selectionOption.disabled).toBe(true);
    expect(selectionOption.title).toBe("Selecione um trecho no PDF para usar este escopo.");
    expect(selectionOption.getAttribute("aria-checked")).toBe("false");
  });

  it("reseta thread, composer e escopo ao trocar documentId", async () => {
    await renderTab({ documentId: "document-1", hasSelection: true });
    click(buttonByText("Seleção"));
    const textarea = changeTextareaValue("Pergunta do primeiro documento");
    pressEnter(textarea);

    expect(container?.textContent).toContain("Pergunta do primeiro documento");
    expect(buttonByText("Seleção").getAttribute("aria-checked")).toBe("true");

    await renderTab({ documentId: "document-2", currentPage: 9, hasSelection: true });

    expect(getElement<HTMLTextAreaElement>("textarea").value).toBe("");
    expect(container?.textContent).not.toContain("Pergunta do primeiro documento");
    expect(container?.textContent).toContain("Resumir esta página");
    expect(buttonByText("Página 9").getAttribute("aria-checked")).toBe("true");
  });

  it("mantém o aviso de prévia visível nos quatro estados", async () => {
    const previewStates: PreviewState[] = ["not_configured", "ready", "generating", "error"];

    for (const previewState of previewStates) {
      await renderTab({ initialPreviewState: previewState });
      expect(container?.textContent).toContain("Prévia da interface.");
      expect(container?.textContent).toContain("nenhuma inferência é executada nesta tela");
    }

    await renderTab({ initialPreviewState: "not_configured" });
    const settingsButton = buttonByText("Configurar em Ajustes");
    expect(settingsButton.disabled).toBe(true);
    expect(settingsButton.parentElement?.title).toContain("Use sua IA");
    expect(container?.querySelector("textarea")).toBeNull();
  });

  it("permite parar e tentar novamente os estados transitórios", async () => {
    await renderTab({ initialPreviewState: "generating" });
    click(buttonByText("Parar"));
    expect(container?.textContent).not.toContain("Gerando resposta simulada");

    await renderTab({ initialPreviewState: "error" });
    click(buttonByText("Tentar novamente"));
    expect(container?.textContent).toContain("Gerando resposta simulada");
    expect(getElement<HTMLTextAreaElement>("textarea").disabled).toBe(true);
  });
});
