// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Annotation } from "../../types/annotation";
import type { ReaderAnnotationsDockProps } from "./ReaderAnnotationsDock";
import { ReaderAnnotationsDock } from "./ReaderAnnotationsDock";

const databaseMocks = vi.hoisted(() => ({
  setDocumentAnnotationsFilterScope: vi.fn(async () => undefined),
}));

vi.mock("../../lib/database", () => ({
  setDocumentAnnotationsFilterScope: databaseMocks.setDocumentAnnotationsFilterScope,
}));

const baseDate = "2026-08-14T12:00:00.000Z";

function annotation(id: string, page: number, y: number): Annotation {
  return {
    id,
    documentId: "document-1",
    page,
    markStyle: "highlight",
    color: "blue",
    selectedText: id,
    note: "",
    rects: [{ x: 0.1, y, w: 0.3, h: 0.04 }],
    createdAt: baseDate,
    updatedAt: baseDate,
  };
}

const pageOneAnnotation = annotation("pagina-1", 1, 0.2);
const pageTwoAnnotation = annotation("pagina-2", 2, 0.4);
const pageThreeAnnotation = annotation("pagina-3", 3, 0.1);

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let onJumpToAnnotation: ReturnType<typeof vi.fn<(selectedAnnotation: Annotation) => void>>;

function renderDock(overrides: Partial<ReaderAnnotationsDockProps> = {}) {
  const props: ReaderAnnotationsDockProps = {
    documentId: "document-1",
    documentTitle: "Documento de teste",
    annotations: [pageOneAnnotation, pageTwoAnnotation, pageThreeAnnotation],
    currentPage: 1,
    visiblePages: [1],
    isPdfLoading: false,
    pendingSelection: null,
    saveStates: new Map(),
    composerFocusSignal: 0,
    onJumpToAnnotation,
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    onRetry: vi.fn(),
    onCreateNote: vi.fn(),
    isPopoutOpen: false,
    onOpenPopout: vi.fn(async () => undefined),
    ...overrides,
  };

  act(() => root?.render(<ReaderAnnotationsDock {...props} />));
  return props;
}

function filterTrigger() {
  const element = container?.querySelector<HTMLButtonElement>('button[aria-label="Filtrar anotações"]');
  if (!element) {
    throw new Error("Controle de filtro nao encontrado.");
  }
  return element;
}

function filterMenu() {
  return container?.querySelector<HTMLUListElement>('ul[role="listbox"][aria-label="Filtrar anotações"]') ?? null;
}

function filterOption(scope: "all" | "current_page") {
  const element = container?.querySelector<HTMLButtonElement>(`li[data-filter-scope="${scope}"] button`);
  if (!element) {
    throw new Error(`Opcao de filtro ${scope} nao encontrada.`);
  }
  return element;
}

function annotationCards() {
  return Array.from(container?.querySelectorAll<HTMLElement>('article[role="button"]') ?? []);
}

function cardTexts() {
  return annotationCards().map((card) => card.querySelector("blockquote")?.textContent ?? "");
}

function pressKey(element: HTMLElement, key: string) {
  act(() => {
    element.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
}

function click(element: HTMLElement) {
  act(() => element.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}

beforeEach(() => {
  databaseMocks.setDocumentAnnotationsFilterScope.mockReset();
  databaseMocks.setDocumentAnnotationsFilterScope.mockResolvedValue(undefined);
  onJumpToAnnotation = vi.fn();
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
});

describe("ReaderAnnotationsDock", () => {
  it("mantem o menu fechado por padrao e usa todas as paginas sem preferencia anterior", () => {
    renderDock({ annotationsFilterScope: undefined });

    expect(filterTrigger().getAttribute("aria-expanded")).toBe("false");
    expect(filterMenu()).toBeNull();
    expect(filterTrigger().textContent).toContain("Todas as páginas");
    expect(annotationCards()).toHaveLength(3);
    expect(container?.textContent).toContain("3 marcações no documento");
    expect(databaseMocks.setDocumentAnnotationsFilterScope).not.toHaveBeenCalled();
  });

  it("abre o menu com as duas opcoes de filtro", () => {
    renderDock({ annotationsFilterScope: "all" });

    click(filterTrigger());

    expect(filterTrigger().getAttribute("aria-expanded")).toBe("true");
    expect(filterMenu()).not.toBeNull();
    expect(filterMenu()?.textContent).toContain("Esta página");
    expect(filterMenu()?.textContent).toContain("Todas as páginas");
  });

  it("atualiza o escopo de forma otimista, persiste e fecha o menu ao escolher outra opcao", () => {
    databaseMocks.setDocumentAnnotationsFilterScope.mockImplementation(() => new Promise(() => undefined));
    renderDock({ annotationsFilterScope: "all", visiblePages: [1, 2] });

    click(filterTrigger());
    click(filterOption("current_page"));

    expect(filterMenu()).toBeNull();
    expect(filterTrigger().textContent).toContain("Esta página");
    expect(annotationCards()).toHaveLength(2);
    expect(databaseMocks.setDocumentAnnotationsFilterScope).toHaveBeenCalledWith(
      "document-1",
      "current_page",
      "loaded",
    );
  });

  it("fecha o menu ao clicar fora sem persistir alteracoes", () => {
    renderDock({ annotationsFilterScope: "all" });

    click(filterTrigger());
    act(() => document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));

    expect(filterMenu()).toBeNull();
    expect(databaseMocks.setDocumentAnnotationsFilterScope).not.toHaveBeenCalled();
  });

  it("fecha o menu com Escape e devolve o foco ao trigger", () => {
    renderDock({ annotationsFilterScope: "all" });
    const trigger = filterTrigger();
    trigger.focus();
    click(trigger);

    pressKey(trigger, "Escape");

    expect(filterMenu()).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("seleciona a opcao destacada com seta e Enter", () => {
    renderDock({ annotationsFilterScope: "all" });
    const trigger = filterTrigger();

    click(trigger);
    pressKey(trigger, "ArrowUp");
    pressKey(trigger, "Enter");

    expect(filterMenu()).toBeNull();
    expect(filterTrigger().textContent).toContain("Esta página");
    expect(databaseMocks.setDocumentAnnotationsFilterScope).toHaveBeenCalledWith(
      "document-1",
      "current_page",
      "loaded",
    );
  });

  it("preserva as duas paginas visiveis no escopo de pagina atual", () => {
    renderDock({ annotationsFilterScope: "current_page", currentPage: 1, visiblePages: [1, 2] });

    expect(cardTexts()).toEqual(["“pagina-1”", "“pagina-2”"]);
    expect(container?.textContent).toContain("2 marcações nestas páginas");
  });

  it("lista todas as paginas ordenadas por pagina e posicao", () => {
    const pageOneLate = annotation("pagina-1-final", 1, 0.8);
    const pageOneEarly = annotation("pagina-1-inicio", 1, 0.1);
    const pageTwo = annotation("pagina-2-meio", 2, 0.5);
    const pageFour = annotation("pagina-4", 4, 0.05);

    renderDock({
      annotationsFilterScope: "all",
      annotations: [pageFour, pageOneLate, pageTwo, pageOneEarly],
    });

    expect(cardTexts()).toEqual([
      "“pagina-1-inicio”",
      "“pagina-1-final”",
      "“pagina-2-meio”",
      "“pagina-4”",
    ]);
  });

  it("desabilita a navegacao dos cards enquanto o PDF carrega", () => {
    renderDock({ annotationsFilterScope: "all", annotations: [pageThreeAnnotation], isPdfLoading: true });
    const [card] = annotationCards();

    expect(card.getAttribute("aria-disabled")).toBe("true");
    expect(card.tabIndex).toBe(-1);
    expect(card.className).toContain("cursor-not-allowed");
    click(card);
    act(() => card.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(onJumpToAnnotation).not.toHaveBeenCalled();
  });

  it("encaminha ao scrollToAnnotation o card de outra pagina", () => {
    renderDock({
      annotationsFilterScope: "all",
      annotations: [pageThreeAnnotation],
      currentPage: 1,
      visiblePages: [1],
    });

    click(annotationCards()[0]);

    expect(onJumpToAnnotation).toHaveBeenCalledTimes(1);
    expect(onJumpToAnnotation).toHaveBeenCalledWith(pageThreeAnnotation);
  });
});
