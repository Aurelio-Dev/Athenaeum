import type { PDFDocumentProxy } from "pdfjs-dist";

// Busca de texto no PDF para a sidebar do leitor. A extracao de texto por
// pagina (getTextContent) e preguicosa e cacheada por documento: a primeira
// busca paga o custo de extrair, as seguintes reusam o cache. Sem highlight
// nos canvases renderizados — o resultado apenas pula para a pagina.

export type DocumentSearchResult = {
  page: number;
  // Trecho ao redor do match, separado para o componente destacar o termo.
  before: string;
  match: string;
  after: string;
};

export type DocumentSearchCancellation = {
  cancelled: boolean;
};

type SearchablePage = {
  text: string;
  normalized: string;
  // indice no texto normalizado -> indice no texto original (a normalizacao
  // remove acentos, que podem mudar o comprimento da string).
  indexMap: number[];
};

const snippetRadius = 44;
const maxResultsPerPage = 3;
const maxTotalResults = 60;

function normalizeForSearch(value: string) {
  return value
    .toLocaleLowerCase("pt-BR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function buildSearchablePage(text: string): SearchablePage {
  const normalizedParts: string[] = [];
  const indexMap: number[] = [];

  for (let index = 0; index < text.length; index += 1) {
    const normalizedChar = normalizeForSearch(text[index]);
    for (let offset = 0; offset < normalizedChar.length; offset += 1) {
      indexMap.push(index);
    }
    normalizedParts.push(normalizedChar);
  }

  return { text, normalized: normalizedParts.join(""), indexMap };
}

function buildResult(page: number, searchable: SearchablePage, normalizedMatchIndex: number, normalizedMatchLength: number): DocumentSearchResult {
  const { text, indexMap } = searchable;
  const matchStart = indexMap[normalizedMatchIndex] ?? 0;
  const lastNormalizedIndex = Math.min(normalizedMatchIndex + normalizedMatchLength - 1, indexMap.length - 1);
  const matchEnd = (indexMap[lastNormalizedIndex] ?? matchStart) + 1;

  const beforeStart = Math.max(0, matchStart - snippetRadius);
  const afterEnd = Math.min(text.length, matchEnd + snippetRadius);

  return {
    page,
    before: `${beforeStart > 0 ? "…" : ""}${text.slice(beforeStart, matchStart)}`,
    match: text.slice(matchStart, matchEnd),
    after: `${text.slice(matchEnd, afterEnd)}${afterEnd < text.length ? "…" : ""}`,
  };
}

export function createDocumentTextSearcher(pdfDocument: PDFDocumentProxy) {
  const pageCache = new Map<number, Promise<SearchablePage>>();

  function getSearchablePage(pageNumber: number): Promise<SearchablePage> {
    let cached = pageCache.get(pageNumber);

    if (!cached) {
      cached = pdfDocument
        .getPage(pageNumber)
        .then(async (page) => {
          const content = await page.getTextContent();
          const text = content.items
            .map((item) => ("str" in item ? item.str : ""))
            .join(" ")
            .replace(/\s+/g, " ")
            .trim();
          return buildSearchablePage(text);
        })
        .catch(() => buildSearchablePage(""));
      pageCache.set(pageNumber, cached);
    }

    return cached;
  }

  // Percorre as paginas em ordem, parando no limite de resultados ou quando a
  // flag de cancelamento (buscas digitadas por cima) for ligada.
  async function search(term: string, cancellation?: DocumentSearchCancellation): Promise<DocumentSearchResult[]> {
    const normalizedTerm = normalizeForSearch(term.trim());

    if (normalizedTerm.length < 2) {
      return [];
    }

    const results: DocumentSearchResult[] = [];

    for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
      if (cancellation?.cancelled) {
        break;
      }

      const searchable = await getSearchablePage(pageNumber);
      let fromIndex = 0;
      let pageResultCount = 0;

      while (pageResultCount < maxResultsPerPage && results.length < maxTotalResults) {
        const matchIndex = searchable.normalized.indexOf(normalizedTerm, fromIndex);

        if (matchIndex === -1) {
          break;
        }

        results.push(buildResult(pageNumber, searchable, matchIndex, normalizedTerm.length));
        pageResultCount += 1;
        fromIndex = matchIndex + normalizedTerm.length;
      }

      if (results.length >= maxTotalResults) {
        break;
      }
    }

    return results;
  }

  return { search };
}

export type DocumentTextSearcher = ReturnType<typeof createDocumentTextSearcher>;
