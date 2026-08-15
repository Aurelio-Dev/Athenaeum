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

async function renderTab(
  annotations: Annotation[],
  annotationsFilterScope: AnnotationsFilterScope = "current_page",
  currentPage = 2,
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

function toggleScope() {
  return getElement('[aria-label="Filtro de anotações: mostrando apenas a página atual"]');
}

beforeEach(() => {
  databaseMocks.setDocumentAnnotationsFilterScope.mockClear();
  onJumpToPage.mockClear();
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
    expect(Array.from(container?.querySelectorAll("blockquote") ?? []).map((element) => element.textContent)).toEqual([
      "“Trecho pagina-1-acima”",
      "“Trecho pagina-1-abaixo”",
      "“Trecho pagina-2”",
    ]);
    expect(container?.textContent).toContain("Página 1");
    expect(container?.textContent).toContain("Página 2");

    click(getElement('button[title="Ir para a página 1"]'));
    expect(onJumpToPage).toHaveBeenCalledWith(1, "pagina-1-acima");
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
