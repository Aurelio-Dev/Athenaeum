// Funcoes puras para converter uma selecao do navegador (em pixels de viewport)
// em retangulos normalizados por pagina (fracoes 0..1), e vice-versa.
//
// Por que normalizar: os rects salvos precisam sobreviver a zoom, DPR e tamanho
// de janela. Guardando fracoes do tamanho da pagina renderizada, ao reabrir
// basta multiplicar pelo tamanho atual da pagina — o highlight cai no lugar
// certo em qualquer zoom.

import type { NormalizedRect } from "../../types/annotation";

// Pagina (1-based) e o elemento DOM que a representa, para hit-testing.
export type PageElement = {
  page: number;
  element: HTMLElement;
};

// Resultado de uma selecao agrupado por pagina. Uma selecao que cruza paginas
// vira uma entrada por pagina (cada uma com seus rects), atendendo a regra
// "uma anotacao por pagina".
export type PageRects = {
  page: number;
  rects: NormalizedRect[];
};

// Posicao na viewport usada para ancorar a toolbar flutuante.
export type SelectionAnchor = {
  top: number;
  left: number;
  width: number;
};

export type CapturedSelection = {
  text: string;
  pages: PageRects[];
  anchor: SelectionAnchor;
};

function normalizeRect(clientRect: DOMRect, pageBox: DOMRect): NormalizedRect {
  return {
    x: (clientRect.left - pageBox.left) / pageBox.width,
    y: (clientRect.top - pageBox.top) / pageBox.height,
    w: clientRect.width / pageBox.width,
    h: clientRect.height / pageBox.height,
  };
}

// Decide a qual pagina um rect pertence pelo seu centro, e devolve a pagina +
// sua caixa. Retorna null se o centro nao cair em nenhuma pagina.
function findPageForRect(clientRect: DOMRect, pageElements: PageElement[]): { page: number; box: DOMRect } | null {
  const centerX = clientRect.left + clientRect.width / 2;
  const centerY = clientRect.top + clientRect.height / 2;

  for (const { page, element } of pageElements) {
    const box = element.getBoundingClientRect();
    if (centerX >= box.left && centerX <= box.right && centerY >= box.top && centerY <= box.bottom) {
      return { page, box };
    }
  }

  return null;
}

// Agrupa os client rects de um Range pelas paginas que eles tocam, ja
// normalizados em relacao a caixa de cada pagina.
export function groupSelectionRectsByPage(range: Range, pageElements: PageElement[]): PageRects[] {
  const byPage = new Map<number, NormalizedRect[]>();

  for (const clientRect of Array.from(range.getClientRects())) {
    if (clientRect.width <= 0 || clientRect.height <= 0) {
      continue;
    }

    const match = findPageForRect(clientRect, pageElements);
    if (!match || match.box.width === 0 || match.box.height === 0) {
      continue;
    }

    const rects = byPage.get(match.page) ?? [];
    rects.push(normalizeRect(clientRect, match.box));
    byPage.set(match.page, rects);
  }

  return [...byPage.entries()]
    .map(([page, rects]) => ({ page, rects }))
    .sort((first, second) => first.page - second.page);
}

// Le a selecao atual do navegador e a converte em CapturedSelection, ou null se
// nao houver selecao de texto util.
export function captureSelection(pageElements: PageElement[]): CapturedSelection | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    return null;
  }

  const range = selection.getRangeAt(0);
  const text = range.toString().trim();
  if (text.length === 0) {
    return null;
  }

  const pages = groupSelectionRectsByPage(range, pageElements);
  if (pages.length === 0) {
    return null;
  }

  const boundingRect = range.getBoundingClientRect();
  return {
    text,
    pages,
    anchor: {
      top: boundingRect.top,
      left: boundingRect.left,
      width: boundingRect.width,
    },
  };
}
