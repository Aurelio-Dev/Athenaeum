// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Annotation } from "../../../types/annotation";
import type { AnnotationsFilterScope, LibraryDocument } from "../../../types/library";
import { AnnotationsTab } from "./AnnotationsTab";

const databaseMocks = vi.hoisted(() => ({
  setDocumentAnnotationsFilterScope: vi.fn(async () => undefined),
}));

vi.mock("../../../lib/database", () => ({
  setDocumentAnnotationsFilterScope: databaseMocks.setDocumentAnnotationsFilterScope,
}));

vi.mock("../../../hooks/useContextMenu", () => ({
  useContextMenu: () => ({
    isOpen: false,
    x: 0,
    y: 0,
    open: vi.fn(),
    close: vi.fn(),
  }),
}));

vi.mock("../../../components/ui/ContextMenu", () => ({
  ContextMenu: () => null,
}));

vi.mock("../../../components/ui/ContextMenuItem", () => ({
  ContextMenuItem: () => null,
}));

type AnnotationsDocument = Pick<LibraryDocument, "id" | "annotationsFilterScope">;
type RenderTabOptions = {
  onUpdateNote?: (annotationId: string, note: string) => Promise<void>;
};

const baseDocument: AnnotationsDocument = {
  id: "document-1",
  annotationsFilterScope: "current_page",
};

function createAnnotation(id: string, page: number, rectY: number): Annotation {
  return {
    id,
    documentId: baseDocument.id,
    page,
    markStyle: "highlight",
    color: "amber",
    selectedText: `Trecho ${id}`,
    note: "",
    rects: [{ x: 0.1, y: rectY, w: 0.3, h: 0.04 }],
    createdAt: `2026-08-${String(page).padStart(2, "0")}T00:00:00.000Z`,
    updatedAt: "2026-08-15T00:00:00.000Z",
  };
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;
const onJumpToPage = vi.fn<(page: number, annotationId?: string) => void>();
let quoteIsTruncated = false;
let notifyQuoteResize: (() => void) | null = null;

const originalClientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");
const originalScrollHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollHeight");

class ResizeObserverMock {
  constructor(callback: () => void) {
    notifyQuoteResize = callback;
  }

  disconnect() {}

  observe() {}

  unobserve() {}
}

async function renderTab(
  annotations: Annotation[],
  annotationsFilterScope: AnnotationsFilterScope = "current_page",
  currentPage = 2,
  { onUpdateNote }: RenderTabOptions = {},
) {
  const document: AnnotationsDocument = { ...baseDocument, annotationsFilterScope };
  await act(async () => {
    root?.render(
      <AnnotationsTab
        document={document}
        annotations={annotations}
        currentPage={currentPage}
        databaseSource="preloaded"
        onJumpToPage={onJumpToPage}
        onDelete={vi.fn()}
        onUpdateNote={onUpdateNote}
      />,
    );
    await Promise.resolve();
  });
}

function getElement(selector: string) {
  const element = container?.querySelector<HTMLElement>(selector);
  if (!element) {
    throw new Error(`Elemento nao encontrado: ${selector}`);
  }
  return element;
}

function click(element: HTMLElement) {
  act(() => element.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}

function changeTextareaValue(textarea: HTMLTextAreaElement, value: string) {
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  valueSetter?.call(textarea, value);
  act(() => textarea.dispatchEvent(new Event("input", { bubbles: true })));
}

async function blur(element: HTMLElement) {
  await act(async () => {
    element.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    await Promise.resolve();
  });
}

function toggleScope() {
  return getElement('[aria-label="Filtro de anotações: mostrando apenas a página atual"]');
}

beforeEach(() => {
  databaseMocks.setDocumentAnnotationsFilterScope.mockClear();
  onJumpToPage.mockClear();
  quoteIsTruncated = false;
  notifyQuoteResize = null;
  vi.stubGlobal("ResizeObserver", ResizeObserverMock);
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get() {
      return this.hasAttribute("data-annotation-quote-measure") ? 72 : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
    configurable: true,
    get() {
      if (!this.hasAttribute("data-annotation-quote-measure")) {
        return 0;
      }
      return quoteIsTruncated ? 96 : 72;
    },
  });
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
  vi.unstubAllGlobals();
  if (originalClientHeight) {
    Object.defineProperty(HTMLElement.prototype, "clientHeight", originalClientHeight);
  } else {
    Reflect.deleteProperty(HTMLElement.prototype, "clientHeight");
  }
  if (originalScrollHeight) {
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", originalScrollHeight);
  } else {
    Reflect.deleteProperty(HTMLElement.prototype, "scrollHeight");
  }
});

describe("AnnotationsTab", () => {
  it("preserva o filtro da página atual", async () => {
    await renderTab([
      createAnnotation("pagina-1", 1, 0.2),
      createAnnotation("pagina-2", 2, 0.4),
    ]);

    expect(container?.textContent).toContain("Esta página");
    expect(container?.textContent).toContain("Trecho pagina-2");
    expect(container?.textContent).not.toContain("Trecho pagina-1");
  });

  it("alterna para todas as anotações, persiste o escopo e ordena por página e posição", async () => {
    await renderTab([
      createAnnotation("pagina-2", 2, 0.4),
      createAnnotation("pagina-1-abaixo", 1, 0.8),
      createAnnotation("pagina-1-acima", 1, 0.2),
    ]);

    click(toggleScope());

    expect(databaseMocks.setDocumentAnnotationsFilterScope).toHaveBeenCalledWith(
      "document-1",
      "all",
      "preloaded",
    );
    expect(container?.textContent).toContain("Todas as páginas");
    expect(Array.from(container?.querySelectorAll("blockquote[data-annotation-quote]") ?? []).map((element) => element.textContent)).toEqual([
      "“Trecho pagina-1-acima”",
      "“Trecho pagina-1-abaixo”",
      "“Trecho pagina-2”",
    ]);

    click(getElement('button[title="Ir para a página 1"]'));
    expect(onJumpToPage).toHaveBeenCalledWith(1, "pagina-1-acima");
  });

  it("mostra a anatomia do card e navega somente pelo badge de página", async () => {
    const annotation = {
      ...createAnnotation("sublinhada", 2, 0.2),
      color: "blue" as const,
      markStyle: "underline" as const,
    };
    await renderTab([annotation]);

    expect(getElement("[data-annotation-color-stripe]").style.backgroundColor).toBe("rgb(29, 78, 216)");
    expect(getElement('[role="img"][aria-label="Sublinhado"]')).toBeTruthy();
    expect(getElement("[data-annotation-quote]").className).toContain("font-serif");
    expect(getElement("[data-annotation-quote]").className).toContain("text-[var(--muted-foreground)]");
    expect(getElement('[aria-label="Opções da anotação"]').className).toContain("opacity-0");
    expect(getElement('[aria-label="Opções da anotação"]').className).toContain("group-focus-within:opacity-100");

    click(getElement("[data-annotation-quote]"));
    expect(onJumpToPage).not.toHaveBeenCalled();

    click(getElement('button[aria-label="Ir para a página 2"]'));
    expect(onJumpToPage).toHaveBeenCalledWith(2, "sublinhada");
  });

  it("exibe o controle de expansão somente para trecho truncado e o recalcula ao redimensionar", async () => {
    await renderTab([createAnnotation("trecho-responsivo", 2, 0.2)]);

    expect(container?.querySelector('button[type="button"]')?.textContent).not.toBe("Mostrar mais");
    expect(container?.textContent).not.toContain("Mostrar mais");

    quoteIsTruncated = true;
    await act(async () => {
      notifyQuoteResize?.();
      await Promise.resolve();
    });

    const expandButton = getElement('button:not([aria-label])[type="button"]');
    expect(expandButton.textContent).toBe("Mostrar mais");

    click(expandButton);
    expect(expandButton.textContent).toBe("Mostrar menos");
    expect(onJumpToPage).not.toHaveBeenCalled();
  });

  it("persiste a edição inline da nota ao perder o foco", async () => {
    const onUpdateNote = vi.fn<(annotationId: string, note: string) => Promise<void>>(async () => undefined);
    const annotation = { ...createAnnotation("com-nota", 2, 0.2), note: "Nota inicial" };
    await renderTab([annotation], "current_page", 2, { onUpdateNote });

    const textarea = getElement("textarea") as HTMLTextAreaElement;
    changeTextareaValue(textarea, "Nota atualizada");
    await blur(textarea);

    expect(onUpdateNote).toHaveBeenCalledWith("com-nota", "Nota atualizada");
  });

  it("atualiza o estado vazio conforme o escopo", async () => {
    await renderTab([], "current_page", 3);

    expect(container?.textContent).toContain("Esta página");
    expect(container?.textContent).toContain("Nenhuma anotação nesta página.");

    click(toggleScope());

    expect(container?.textContent).toContain("Todas as páginas");
    expect(container?.textContent).toContain("Nenhuma anotação no documento.");
  });
});
