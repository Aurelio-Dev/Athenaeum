// @vitest-environment jsdom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Annotation } from "../../../types/annotation";
import type { AnnotationsFilterScope, LibraryDocument } from "../../../types/library";
import { AnnotationsTab } from "./AnnotationsTab";

const databaseMocks = vi.hoisted(() => ({
  getLatestLinkedNotebook: vi.fn(async () => null),
  listNotebookOptions: vi.fn(async () => [{ id: 7, title: "Caderno de pesquisa" }]),
  setDocumentAnnotationsFilterScope: vi.fn(async () => undefined),
}));

const sendToNotebookMocks = vi.hoisted(() => ({
  sendReaderPageToNotebook: vi.fn(async () => undefined),
}));

vi.mock("../../../lib/database", () => ({
  getLatestLinkedNotebook: databaseMocks.getLatestLinkedNotebook,
  listNotebookOptions: databaseMocks.listNotebookOptions,
  setDocumentAnnotationsFilterScope: databaseMocks.setDocumentAnnotationsFilterScope,
}));

vi.mock("../sendPageToNotebook", () => ({
  sendReaderPageToNotebook: sendToNotebookMocks.sendReaderPageToNotebook,
}));

vi.mock("../../../components/ui/ContextMenu", () => ({
  ContextMenu: ({ isOpen, children }: { isOpen: boolean; children: ReactNode }) => (
    isOpen ? <div role="menu">{children}</div> : null
  ),
}));

vi.mock("../../../components/ui/ContextMenuItem", () => ({
  ContextMenuItem: ({ label, title, disabled, onSelect }: { label: string; title?: string; disabled?: boolean; onSelect: () => void }) => (
    <button type="button" title={title} disabled={disabled} onClick={onSelect}>{label}</button>
  ),
}));

vi.mock("./DocumentInfoSections", () => ({
  useReaderDetailsInvalidation: () => undefined,
}));

type AnnotationsDocument = Pick<LibraryDocument, "id" | "title" | "annotationsFilterScope">;
type RenderTabOptions = {
  onUpdateNote?: (annotationId: string, note: string) => Promise<void>;
  documentId?: string;
};

const baseDocument: AnnotationsDocument = {
  id: "document-1",
  title: "Documento de teste",
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
const onOpenNotebook = vi.fn<(notebookId: number, notebookTitle: string) => void>();
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
  { onUpdateNote, documentId = baseDocument.id }: RenderTabOptions = {},
) {
  const document: AnnotationsDocument = { ...baseDocument, id: documentId, annotationsFilterScope };
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
        onOpenNotebook={onOpenNotebook}
      />,
    );
    await Promise.resolve();
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

async function clickAndFlush(element: HTMLElement) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
  });
}

function changeInputValue(input: HTMLInputElement, value: string) {
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  valueSetter?.call(input, value);
  act(() => input.dispatchEvent(new Event("input", { bubbles: true })));
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

function scopeOption(label: string) {
  const option = Array.from(container?.querySelectorAll<HTMLElement>('[role="radio"]') ?? [])
    .find((element) => element.textContent === label);
  if (!option) {
    throw new Error(`Opção de escopo não encontrada: ${label}`);
  }
  return option;
}

function visibleQuoteTexts() {
  return Array.from(container?.querySelectorAll("blockquote[data-annotation-quote]") ?? [])
    .map((element) => element.textContent);
}

function buttonByText(text: string) {
  const button = Array.from(container?.querySelectorAll<HTMLButtonElement>("button") ?? [])
    .find((element) => element.textContent === text);
  if (!button) {
    throw new Error(`Botão não encontrado: ${text}`);
  }
  return button;
}

function getEmptyState(title: string) {
  const heading = Array.from(container?.querySelectorAll<HTMLHeadingElement>("h2") ?? [])
    .find((element) => element.textContent === title);
  if (!heading || !heading.parentElement) {
    throw new Error(`Estado vazio não encontrado: ${title}`);
  }

  const description = heading.nextElementSibling;
  if (!(description instanceof HTMLParagraphElement)) {
    throw new Error(`Descrição do estado vazio não encontrada: ${title}`);
  }

  return { root: heading.parentElement, description: description.textContent ?? "" };
}

beforeEach(() => {
  databaseMocks.getLatestLinkedNotebook.mockReset();
  databaseMocks.getLatestLinkedNotebook.mockResolvedValue(null);
  databaseMocks.listNotebookOptions.mockReset();
  databaseMocks.listNotebookOptions.mockResolvedValue([{ id: 7, title: "Caderno de pesquisa" }]);
  databaseMocks.setDocumentAnnotationsFilterScope.mockClear();
  sendToNotebookMocks.sendReaderPageToNotebook.mockClear();
  onJumpToPage.mockClear();
  onOpenNotebook.mockClear();
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

    expect(scopeOption("Esta página").getAttribute("aria-checked")).toBe("true");
    expect(container?.textContent).toContain("Trecho pagina-2");
    expect(container?.textContent).not.toContain("Trecho pagina-1");
    expect(container?.querySelector('[id^="annotations-page-"]')).toBeNull();
  });

  it("alterna para todas as anotações, persiste o escopo e ordena por página e posição", async () => {
    await renderTab([
      createAnnotation("pagina-2", 2, 0.4),
      createAnnotation("pagina-1-abaixo", 1, 0.8),
      createAnnotation("pagina-1-acima", 1, 0.2),
    ]);

    click(scopeOption("Todas"));

    expect(databaseMocks.setDocumentAnnotationsFilterScope).toHaveBeenCalledWith(
      "document-1",
      "all",
      "preloaded",
    );
    expect(scopeOption("Todas").getAttribute("aria-checked")).toBe("true");
    expect(Array.from(container?.querySelectorAll("blockquote[data-annotation-quote]") ?? []).map((element) => element.textContent)).toEqual([
      "“Trecho pagina-1-acima”",
      "“Trecho pagina-1-abaixo”",
      "“Trecho pagina-2”",
    ]);
    expect(Array.from(container?.querySelectorAll('[id^="annotations-page-"]') ?? []).map((element) => element.textContent?.trim())).toEqual([
      "Página 1",
      "Página 2",
    ]);
    expect(getElement("#annotations-page-1").className).toContain("sticky");

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

    const expandButton = buttonByText("Mostrar mais");
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

  it("filtra trecho e nota ignorando caixa e acentos, e permite limpar a busca", async () => {
    const accentedAnnotation = {
      ...createAnnotation("com-acento", 2, 0.2),
      selectedText: "Introdução à ética",
    };
    const plainAnnotation = {
      ...createAnnotation("sem-acento", 2, 0.4),
      selectedText: "Trecho neutro",
      note: "Acao planejada",
    };
    await renderTab([accentedAnnotation, plainAnnotation]);

    const searchInput = getElement('[aria-label="Buscar anotações"]') as HTMLInputElement;
    changeInputValue(searchInput, "INTRODUCAO");
    expect(visibleQuoteTexts()).toEqual(["“Introdução à ética”"]);

    click(getElement('[aria-label="Limpar busca de anotações"]'));
    expect(searchInput.value).toBe("");
    expect(visibleQuoteTexts()).toEqual(["“Introdução à ética”", "“Trecho neutro”"]);

    changeInputValue(searchInput, "ação");
    expect(visibleQuoteTexts()).toEqual(["“Trecho neutro”"]);
  });

  it("não renderiza a faixa de cores em documento monocromático", async () => {
    await renderTab([
      createAnnotation("ambar-1", 2, 0.2),
      createAnnotation("ambar-2", 2, 0.4),
    ]);

    expect(container?.querySelector('[aria-label="Filtrar por cor de realce"]')).toBeNull();
  });

  it("combina as cores selecionadas e trata nenhuma seleção como todas", async () => {
    const amberAnnotation = createAnnotation("ambar", 2, 0.2);
    const blueAnnotation = { ...createAnnotation("azul", 2, 0.4), color: "blue" as const };
    const roseAnnotation = { ...createAnnotation("rosa", 2, 0.6), color: "rose" as const };
    await renderTab([amberAnnotation, blueAnnotation, roseAnnotation]);

    const amberFilter = getElement('[aria-label="Filtrar pela cor âmbar"]');
    const blueFilter = getElement('[aria-label="Filtrar pela cor azul"]');
    expect(container?.querySelectorAll('[aria-label^="Filtrar pela cor "]').length).toBe(6);

    click(amberFilter);
    expect(amberFilter.getAttribute("aria-pressed")).toBe("true");
    expect(visibleQuoteTexts()).toEqual(["“Trecho ambar”"]);

    click(blueFilter);
    expect(visibleQuoteTexts()).toEqual(["“Trecho ambar”", "“Trecho azul”"]);

    click(amberFilter);
    expect(visibleQuoteTexts()).toEqual(["“Trecho azul”"]);

    click(blueFilter);
    expect(visibleQuoteTexts()).toEqual(["“Trecho ambar”", "“Trecho azul”", "“Trecho rosa”"]);
  });

  it("combina busca, escopo de página e cor no mesmo resultado", async () => {
    const pageOneBlue = {
      ...createAnnotation("azul-pagina-1", 1, 0.2),
      color: "blue" as const,
      selectedText: "Café compartilhado",
    };
    const pageTwoBlue = {
      ...createAnnotation("azul-pagina-2", 2, 0.2),
      color: "blue" as const,
      selectedText: "Cafe local",
    };
    const pageTwoAmber = {
      ...createAnnotation("ambar-pagina-2", 2, 0.4),
      selectedText: "Café amarelo",
    };
    const pageTwoOther = {
      ...createAnnotation("outro-pagina-2", 2, 0.6),
      color: "blue" as const,
      selectedText: "Outro assunto",
    };
    await renderTab([pageOneBlue, pageTwoBlue, pageTwoAmber, pageTwoOther]);

    changeInputValue(getElement('[aria-label="Buscar anotações"]') as HTMLInputElement, "cafe");
    click(getElement('[aria-label="Filtrar pela cor azul"]'));
    expect(visibleQuoteTexts()).toEqual(["“Cafe local”"]);

    click(scopeOption("Todas"));
    expect(visibleQuoteTexts()).toEqual(["“Café compartilhado”", "“Cafe local”"]);
  });

  it("reseta busca e cores ao trocar document.id", async () => {
    await renderTab([
      createAnnotation("antiga-ambar", 2, 0.2),
      { ...createAnnotation("antiga-azul", 2, 0.4), color: "blue" as const },
    ]);

    const searchInput = getElement('[aria-label="Buscar anotações"]') as HTMLInputElement;
    changeInputValue(searchInput, "antiga-ambar");
    click(getElement('[aria-label="Filtrar pela cor âmbar"]'));
    expect(visibleQuoteTexts()).toEqual(["“Trecho antiga-ambar”"]);

    await renderTab([
      { ...createAnnotation("nova-azul", 2, 0.2), color: "blue" as const },
      { ...createAnnotation("nova-rosa", 2, 0.4), color: "rose" as const },
    ], "current_page", 2, { documentId: "document-2" });

    expect((getElement('[aria-label="Buscar anotações"]') as HTMLInputElement).value).toBe("");
    expect(visibleQuoteTexts()).toEqual(["“Trecho nova-azul”", "“Trecho nova-rosa”"]);
    expect(Array.from(container?.querySelectorAll('[aria-label^="Filtrar pela cor "]') ?? [])
      .every((element) => element.getAttribute("aria-pressed") === "false")).toBe(true);
  });

  it("nomeia o destino e religa o envio da página ao helper existente", async () => {
    await renderTab([createAnnotation("para-enviar", 2, 0.2)]);

    click(getElement('[aria-label="Mais opções"]'));
    await clickAndFlush(buttonByText('Enviar página 2 para "Caderno de pesquisa"'));

    expect(sendToNotebookMocks.sendReaderPageToNotebook).toHaveBeenCalledWith({
      notebookId: 7,
      documentId: "document-1",
      documentTitle: "Documento de teste",
      page: 2,
      databaseSource: "preloaded",
    });
  });

  it("mantém o envio visível e desabilitado quando não existe Caderno", async () => {
    databaseMocks.listNotebookOptions.mockResolvedValueOnce([]);
    await renderTab([createAnnotation("sem-destino", 2, 0.2)]);

    click(getElement('[aria-label="Mais opções"]'));
    const sendButton = buttonByText("Enviar página 2 para o Caderno");

    expect(sendButton.disabled).toBe(true);
    expect(sendButton.title).toBe("Nenhum Caderno disponível. Crie um Caderno na biblioteca para enviar anotações.");
  });

  it("mostra o estado do documento sem anotações e não oferece CTA", async () => {
    await renderTab([], "all", 3);

    const emptyState = getEmptyState("Nenhuma anotação ainda");
    expect(emptyState.description).toBe("Selecione um trecho de texto no PDF para criar uma anotação.");
    expect(emptyState.root.querySelector("button")).toBeNull();
    expect(container?.textContent).not.toContain("Limpar filtros");
  });

  it("nomeia somente a busca no estado filtrado", async () => {
    await renderTab([createAnnotation("existente", 2, 0.2)], "all");

    changeInputValue(getElement('[aria-label="Buscar anotações"]') as HTMLInputElement, "inexistente");

    const emptyState = getEmptyState("Nenhuma anotação encontrada");
    expect(emptyState.description).toBe('Nenhuma anotação corresponde a "inexistente".');
    expect(emptyState.description).not.toContain("cor azul");
    expect(emptyState.description).not.toContain("esta página");
  });

  it("nomeia somente a cor no estado filtrado", async () => {
    await renderTab([
      createAnnotation("ambar", 2, 0.2),
      { ...createAnnotation("azul", 2, 0.4), color: "blue" as const },
    ], "all");

    click(getElement('[aria-label="Filtrar pela cor rosa"]'));

    const emptyState = getEmptyState("Nenhuma anotação encontrada");
    expect(emptyState.description).toBe("Nenhuma anotação corresponde a cor rosa.");
    expect(emptyState.description).not.toContain('"');
    expect(emptyState.description).not.toContain("esta página");
  });

  it("nomeia somente o escopo da página no estado filtrado", async () => {
    await renderTab([createAnnotation("outra-pagina", 1, 0.2)], "current_page", 2);

    const emptyState = getEmptyState("Nenhuma anotação encontrada");
    expect(emptyState.description).toBe("Nenhuma anotação corresponde a esta página.");
    expect(emptyState.description).not.toContain('"');
    expect(emptyState.description).not.toContain("cor azul");
  });

  it("nomeia busca, múltiplas cores e escopo juntos no estado filtrado", async () => {
    await renderTab([
      { ...createAnnotation("azul-pagina-1", 1, 0.2), color: "blue" as const, selectedText: "Café azul" },
      { ...createAnnotation("ambar-pagina-1", 1, 0.4), selectedText: "Café âmbar" },
      { ...createAnnotation("rosa-pagina-2", 2, 0.6), color: "rose" as const, selectedText: "Outro assunto" },
    ], "current_page", 2);

    changeInputValue(getElement('[aria-label="Buscar anotações"]') as HTMLInputElement, "cafe");
    click(getElement('[aria-label="Filtrar pela cor âmbar"]'));
    click(getElement('[aria-label="Filtrar pela cor azul"]'));

    const emptyState = getEmptyState("Nenhuma anotação encontrada");
    expect(emptyState.description).toBe('Nenhuma anotação corresponde a "cafe" · cores âmbar e azul · esta página.');
    expect(emptyState.description).not.toContain("rosa");
    expect(emptyState.description).not.toContain("violeta");
  });

  it("limpa todos os filtros, restaura a lista e persiste o escopo completo", async () => {
    await renderTab([
      { ...createAnnotation("azul-pagina-1", 1, 0.2), color: "blue" as const, selectedText: "Café azul" },
      { ...createAnnotation("ambar-pagina-1", 1, 0.4), selectedText: "Café âmbar" },
      { ...createAnnotation("rosa-pagina-2", 2, 0.6), color: "rose" as const, selectedText: "Outro assunto" },
    ], "current_page", 2);

    changeInputValue(getElement('[aria-label="Buscar anotações"]') as HTMLInputElement, "cafe");
    click(getElement('[aria-label="Filtrar pela cor azul"]'));
    expect(getEmptyState("Nenhuma anotação encontrada").description)
      .toBe('Nenhuma anotação corresponde a "cafe" · cor azul · esta página.');

    click(buttonByText("Limpar filtros"));

    expect((getElement('[aria-label="Buscar anotações"]') as HTMLInputElement).value).toBe("");
    expect(scopeOption("Todas").getAttribute("aria-checked")).toBe("true");
    expect(visibleQuoteTexts()).toEqual(["“Café azul”", "“Café âmbar”", "“Outro assunto”"]);
    expect(databaseMocks.setDocumentAnnotationsFilterScope).toHaveBeenCalledWith(
      "document-1",
      "all",
      "preloaded",
    );
  });
});
