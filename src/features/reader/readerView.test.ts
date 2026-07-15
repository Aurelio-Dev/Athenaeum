import { describe, expect, it } from "vitest";
import {
  calculateReaderFitZoom,
  getReaderPageGroup,
  getReaderProgressPage,
  groupReaderPages,
  parseReaderViewPreferences,
} from "./readerView";

describe("groupReaderPages", () => {
  it("mantem uma pagina por linha no layout simples", () => {
    expect(groupReaderPages(4, "single", false)).toEqual([[1], [2], [3], [4]]);
  });

  it("agrupa paginas em pares", () => {
    expect(groupReaderPages(5, "spread", false)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("considera a ultima pagina visivel no progresso de um spread", () => {
    const lastSpread = getReaderPageGroup(groupReaderPages(34, "spread", false), 33);
    expect(getReaderProgressPage(lastSpread, 33)).toBe(34);
  });

  it("isola a capa antes dos pares", () => {
    const groups = groupReaderPages(6, "spread", true);
    expect(groups).toEqual([[1], [2, 3], [4, 5], [6]]);
    expect(getReaderPageGroup(groups, 3)).toEqual([2, 3]);
  });
});

describe("parseReaderViewPreferences", () => {
  it("recupera valores validos e normaliza campos desconhecidos", () => {
    expect(
      parseReaderViewPreferences(
        JSON.stringify({ pageLayout: "spread", continuousScroll: false, showCover: true }),
      ),
    ).toEqual({ pageLayout: "spread", continuousScroll: false, showCover: true });

    expect(parseReaderViewPreferences("{invalido")).toEqual({
      pageLayout: "single",
      continuousScroll: true,
      showCover: false,
    });
  });
});

describe("calculateReaderFitZoom", () => {
  const page = { width: 800, height: 1000 };

  it("calcula ajustes por largura, altura e pagina", () => {
    const common = {
      pages: [page],
      availableWidth: 600,
      availableHeight: 700,
      pageGap: 24,
      minZoom: 50,
      maxZoom: 200,
      safetyRatio: 1,
    } as const;

    expect(calculateReaderFitZoom({ ...common, mode: "width" })).toBe(75);
    expect(calculateReaderFitZoom({ ...common, mode: "height" })).toBe(70);
    expect(calculateReaderFitZoom({ ...common, mode: "page" })).toBe(70);
  });

  it("usa somente os limites do conteudo no ajuste visivel", () => {
    expect(
      calculateReaderFitZoom({
        pages: [
          {
            ...page,
            bounds: { left: 0.2, top: 0.1, right: 0.8, bottom: 0.9, confidence: "high" },
          },
        ],
        availableWidth: 600,
        availableHeight: 800,
        mode: "visible",
        pageGap: 24,
        minZoom: 50,
        maxZoom: 200,
        safetyRatio: 1,
      }),
    ).toBe(100);
  });

  it("considera o espaco fixo entre duas paginas e respeita os limites", () => {
    expect(
      calculateReaderFitZoom({
        pages: [page, page],
        availableWidth: 824,
        availableHeight: 1000,
        mode: "width",
        pageGap: 24,
        minZoom: 50,
        maxZoom: 200,
        safetyRatio: 1,
      }),
    ).toBe(50);
  });

  it("permite ajuste integral abaixo de 25% em paineis baixos", () => {
    expect(
      calculateReaderFitZoom({
        pages: [{ width: 850, height: 1120 }],
        availableWidth: 400,
        availableHeight: 196,
        mode: "page",
        pageGap: 24,
        minZoom: 10,
        maxZoom: 200,
        safetyRatio: 1,
      }),
    ).toBe(17);
  });

  it("usa o menor zoom quando as ilhas ocupam toda a area disponivel", () => {
    expect(
      calculateReaderFitZoom({
        pages: [page],
        availableWidth: 400,
        availableHeight: 0,
        mode: "page",
        pageGap: 24,
        minZoom: 10,
        maxZoom: 200,
      }),
    ).toBe(10);
  });
});
