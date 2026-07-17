// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import type { NotebookPage } from "../../types/library";
import { beginNotebookPrintSession, buildNotebookPrintDocumentTitle } from "./notebookPrintSession";

function makePage(id: number, position: number, title: string | null): NotebookPage {
  return {
    id,
    notebookId: 1,
    title,
    content: "",
    position,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("buildNotebookPrintDocumentTitle", () => {
  it("usa o título da página quando a seleção tem uma página", () => {
    expect(buildNotebookPrintDocumentTitle("Pesquisa", [makePage(1, 1, "Hipóteses")])).toBe(
      "Caderno - Pesquisa - Hipóteses",
    );
  });

  it("usa a contagem quando a seleção tem várias páginas", () => {
    expect(
      buildNotebookPrintDocumentTitle("Pesquisa", [makePage(1, 1, null), makePage(2, 2, "Resultados")]),
    ).toBe("Caderno - Pesquisa - 2 páginas");
  });
});

describe("beginNotebookPrintSession", () => {
  it("restaura document.title no afterprint", () => {
    document.title = "Athenaeum";
    const print = vi.fn();
    const onAfterPrint = vi.fn();

    beginNotebookPrintSession({ title: "Caderno - Pesquisa - 2 páginas", print, onAfterPrint });
    expect(document.title).toBe("Caderno - Pesquisa - 2 páginas");
    expect(print).toHaveBeenCalledOnce();

    window.dispatchEvent(new Event("afterprint"));
    expect(document.title).toBe("Athenaeum");
    expect(onAfterPrint).toHaveBeenCalledOnce();
  });

  it("restaura o título se window.print lançar erro", () => {
    document.title = "Athenaeum";
    const onAfterPrint = vi.fn();

    expect(() =>
      beginNotebookPrintSession({
        title: "Temporário",
        print: () => {
          throw new Error("falha");
        },
        onAfterPrint,
      }),
    ).toThrow("falha");
    expect(document.title).toBe("Athenaeum");
    expect(onAfterPrint).not.toHaveBeenCalled();
  });
});
