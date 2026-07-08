import { describe, expect, it } from "vitest";

import {
  getNotebookExportDefaultFileName,
  notebookExportFileNameFallback,
  notebookExportFileNameSlugLimit,
} from "./notebookExportFileName";

const testDate = new Date(2026, 6, 7);
const dated = (slug: string) => `${slug}-2026-07-07.html`;

describe("getNotebookExportDefaultFileName", () => {
  it("slugifies a common title", () => {
    expect(getNotebookExportDefaultFileName("Meu Caderno de Estudos", testDate)).toBe(dated("meu-caderno-de-estudos"));
  });

  it("removes accents before slugifying", () => {
    expect(getNotebookExportDefaultFileName("Anotações de Álgebra e Funções", testDate)).toBe(
      dated("anotacoes-de-algebra-e-funcoes"),
    );
  });

  it("removes Windows-invalid characters through slug normalization", () => {
    expect(getNotebookExportDefaultFileName('Aula <01>: "PDF"/Notas\\Teste|Final?*', testDate)).toBe(
      dated("aula-01-pdf-notas-teste-final"),
    );
  });

  it("collapses repeated spaces and separators", () => {
    expect(getNotebookExportDefaultFileName("  Caderno --- de   Pesquisa /// Final  ", testDate)).toBe(
      dated("caderno-de-pesquisa-final"),
    );
  });

  it("uses the fallback for an empty title", () => {
    expect(getNotebookExportDefaultFileName("", testDate)).toBe(dated(notebookExportFileNameFallback));
  });

  it("uses the fallback when the title has only invalid characters", () => {
    expect(getNotebookExportDefaultFileName(' <>:"/\\|?* ', testDate)).toBe(dated(notebookExportFileNameFallback));
  });

  it("limits the slug length", () => {
    const longTitle = "a".repeat(notebookExportFileNameSlugLimit + 20);
    const fileName = getNotebookExportDefaultFileName(longTitle, testDate);
    const slug = fileName.replace(/-2026-07-07\.html$/, "");

    expect(slug).toHaveLength(notebookExportFileNameSlugLimit);
    expect(fileName).toBe(`${"a".repeat(notebookExportFileNameSlugLimit)}-2026-07-07.html`);
  });

  it("keeps the .html extension exactly once", () => {
    const fileName = getNotebookExportDefaultFileName("Relatório final.html.html", testDate);

    expect(fileName).toBe(dated("relatorio-final"));
    expect(fileName.match(/\.html/g)).toHaveLength(1);
  });

  it("uses the injected date in YYYY-MM-DD format", () => {
    expect(getNotebookExportDefaultFileName("Caderno", testDate)).toBe("caderno-2026-07-07.html");
  });
});
