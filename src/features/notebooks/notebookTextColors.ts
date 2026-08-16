import {
  TAG_COLOR_TOKEN_NAMES,
  TAG_COLOR_TOKENS,
  isTagColorToken,
  type TagColorToken,
} from "../../lib/tagColors";
import { prepareCodeElements } from "../reader/richTextShared";

export type NotebookTextColorKind = "highlight" | "color";

export type NotebookTextColors = {
  highlight: TagColorToken | null;
  color: TagColorToken | null;
};

export const notebookHighlightAttribute = "data-athenaeum-highlight";
export const notebookFontColorAttribute = "data-athenaeum-color";

const markerAttribute = "data-athenaeum-text-color-marker";
// `hiliteColor` ignora `transparent` no Chromium/WebView2. Uma cor CSS
// valida garante que ambos os comandos criem o carrier transitorio; ela e
// convertida em remocao antes de qualquer HTML chegar ao autosave.
const removalCssColor = "#010203";
const normalizedRemovalCssColor = removalCssColor.toUpperCase();
const colorAttributeByKind: Record<NotebookTextColorKind, string> = {
  highlight: notebookHighlightAttribute,
  color: notebookFontColorAttribute,
};

const emptyTextColors: NotebookTextColors = { highlight: null, color: null };
type TextColorNormalizationContext = NotebookTextColors & {
  highlightLocked: boolean;
  colorLocked: boolean;
};
const emptyNormalizationContext: TextColorNormalizationContext = {
  ...emptyTextColors,
  highlightLocked: false,
  colorLocked: false,
};

function normalizeCssColor(value: string) {
  const normalized = value.trim().toLowerCase();
  if (normalized === "transparent") {
    return "transparent";
  }

  const shortHex = normalized.match(/^#([0-9a-f]{3})$/i);
  if (shortHex) {
    return `#${[...shortHex[1]].map((digit) => `${digit}${digit}`).join("")}`.toUpperCase();
  }

  const longHex = normalized.match(/^#([0-9a-f]{6})$/i);
  if (longHex) {
    return `#${longHex[1]}`.toUpperCase();
  }

  const rgb = normalized.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*([\d.]+))?\s*\)$/i);
  if (!rgb) {
    return null;
  }

  if (rgb[4] !== undefined && Number(rgb[4]) === 0) {
    return "transparent";
  }

  const channels = rgb.slice(1, 4).map(Number);
  if (channels.some((channel) => channel < 0 || channel > 255)) {
    return null;
  }

  return `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

const highlightTokenByCssColor = new Map(
  TAG_COLOR_TOKEN_NAMES.map((token) => [normalizeCssColor(TAG_COLOR_TOKENS[token].pastel), token] as const),
);
const fontTokenByCssColor = new Map(
  TAG_COLOR_TOKEN_NAMES.map((token) => [normalizeCssColor(TAG_COLOR_TOKENS[token].bg), token] as const),
);

function resolveCssColorToken(kind: NotebookTextColorKind, value: string) {
  const normalized = normalizeCssColor(value);
  if (!normalized) {
    return undefined;
  }

  if (normalized === "transparent") {
    return null;
  }

  if (normalized === normalizedRemovalCssColor) {
    return null;
  }

  return (kind === "highlight" ? highlightTokenByCssColor : fontTokenByCssColor).get(normalized);
}

function removeInlineColorStyles(element: HTMLElement) {
  element.style.removeProperty("color");
  element.style.removeProperty("background");
  element.style.removeProperty("background-color");
  if (element.style.length === 0) {
    element.removeAttribute("style");
  }
}

function wrapTextNode(textNode: Text, colors: NotebookTextColors) {
  if ((!colors.highlight && !colors.color) || textNode.data.length === 0) {
    return;
  }

  const span = textNode.ownerDocument.createElement("span");
  if (colors.highlight) {
    span.setAttribute(notebookHighlightAttribute, colors.highlight);
  }
  if (colors.color) {
    span.setAttribute(notebookFontColorAttribute, colors.color);
  }
  textNode.replaceWith(span);
  span.append(textNode);
}

function isPureTextColorSpan(element: Element) {
  if (element.tagName.toLowerCase() !== "span") {
    return false;
  }

  const attributeNames = Array.from(element.attributes, (attribute) => attribute.name);
  return attributeNames.length > 0 && attributeNames.every(
    (name) => name === notebookHighlightAttribute || name === notebookFontColorAttribute,
  );
}

function haveSameTextColors(first: Element, second: Element) {
  return first.getAttribute(notebookHighlightAttribute) === second.getAttribute(notebookHighlightAttribute) &&
    first.getAttribute(notebookFontColorAttribute) === second.getAttribute(notebookFontColorAttribute);
}

function mergeAdjacentTextColorSpans(parent: Element) {
  let current = parent.firstElementChild;
  while (current) {
    const next = current.nextElementSibling;
    if (
      next &&
      current.nextSibling === next &&
      isPureTextColorSpan(current) &&
      isPureTextColorSpan(next) &&
      haveSameTextColors(current, next)
    ) {
      current.append(...Array.from(next.childNodes));
      next.remove();
      continue;
    }
    current = next;
  }
}

function normalizeTextColorElement(element: HTMLElement, inheritedContext: TextColorNormalizationContext) {
  const tagName = element.tagName.toLowerCase();
  const nextContext = { ...inheritedContext };
  const hadHighlightAttribute = element.hasAttribute(notebookHighlightAttribute);
  const hadFontColorAttribute = element.hasAttribute(notebookFontColorAttribute);
  const hadInlineBackground = element.style.backgroundColor.length > 0 || element.style.background.length > 0;
  const hadInlineColor = element.style.color.length > 0;
  const hadFontColor = tagName === "font" && element.hasAttribute("color");
  const wasColorCarrier = hadHighlightAttribute || hadFontColorAttribute || hadInlineBackground || hadInlineColor || hadFontColor;

  const highlightValue = element.getAttribute(notebookHighlightAttribute)?.trim() ?? "";
  const fontColorValue = element.getAttribute(notebookFontColorAttribute)?.trim() ?? "";
  element.removeAttribute(notebookHighlightAttribute);
  element.removeAttribute(notebookFontColorAttribute);

  if (tagName === "span" && !nextContext.highlightLocked && isTagColorToken(highlightValue)) {
    nextContext.highlight = highlightValue;
  }
  if (tagName === "span" && !nextContext.colorLocked && isTagColorToken(fontColorValue)) {
    nextContext.color = fontColorValue;
  }

  if (element.style.backgroundColor) {
    const resolvedHighlight = resolveCssColorToken("highlight", element.style.backgroundColor);
    if (resolvedHighlight !== undefined) {
      nextContext.highlight = resolvedHighlight;
      nextContext.highlightLocked = true;
    }
  }
  if (element.style.color) {
    const resolvedFontColor = resolveCssColorToken("color", element.style.color);
    if (resolvedFontColor !== undefined) {
      nextContext.color = resolvedFontColor;
      nextContext.colorLocked = true;
    }
  }
  if (hadFontColor) {
    const resolvedFontColor = resolveCssColorToken("color", element.getAttribute("color") ?? "");
    if (resolvedFontColor !== undefined) {
      nextContext.color = resolvedFontColor;
      nextContext.colorLocked = true;
    }
    element.removeAttribute("color");
  }

  removeInlineColorStyles(element);

  Array.from(element.childNodes).forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) {
      wrapTextNode(child as Text, nextContext);
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      normalizeTextColorElement(child as HTMLElement, nextContext);
    }
  });

  mergeAdjacentTextColorSpans(element);

  if (wasColorCarrier && (tagName === "font" || tagName === "span") && element.attributes.length === 0) {
    element.replaceWith(...Array.from(element.childNodes));
  }
}

/**
 * Converte markup transitorio do execCommand para os dois enums persistidos e
 * remove qualquer cor inline desconhecida antes de o HTML chegar ao autosave.
 */
export function normalizeNotebookTextColors(root: HTMLElement) {
  Array.from(root.childNodes).forEach((child) => {
    if (child.nodeType === Node.ELEMENT_NODE) {
      normalizeTextColorElement(child as HTMLElement, emptyNormalizationContext);
    }
  });
  mergeAdjacentTextColorSpans(root);
}

function nodeIsInsideRoot(node: Node, root: HTMLElement) {
  return node === root || root.contains(node.nodeType === Node.ELEMENT_NODE ? node : node.parentNode);
}

function insertSelectionMarkers(range: Range, ownerDocument: Document) {
  const startMarker = ownerDocument.createElement("span");
  const endMarker = ownerDocument.createElement("span");
  startMarker.setAttribute(markerAttribute, "start");
  endMarker.setAttribute(markerAttribute, "end");

  const endRange = range.cloneRange();
  endRange.collapse(false);
  endRange.insertNode(endMarker);

  const startRange = range.cloneRange();
  startRange.collapse(true);
  startRange.insertNode(startMarker);

  return { startMarker, endMarker };
}

function createRangeBetweenMarkers(startMarker: HTMLElement, endMarker: HTMLElement) {
  const range = startMarker.ownerDocument.createRange();
  range.setStartAfter(startMarker);
  range.setEndBefore(endMarker);
  return range;
}

function restoreSelectionFromMarkers(selection: Selection, startMarker: HTMLElement, endMarker: HTMLElement) {
  const range = createRangeBetweenMarkers(startMarker, endMarker);
  endMarker.remove();
  startMarker.remove();
  selection.removeAllRanges();
  selection.addRange(range);
  return range.cloneRange();
}

function selectBetweenMarkers(selection: Selection, startMarker: HTMLElement, endMarker: HTMLElement) {
  const range = createRangeBetweenMarkers(startMarker, endMarker);
  selection.removeAllRanges();
  selection.addRange(range);
}

export function applyNotebookTextColor(
  root: HTMLElement,
  selection: Selection,
  kind: NotebookTextColorKind,
  token: TagColorToken | null,
) {
  if (selection.rangeCount === 0 || selection.isCollapsed) {
    return null;
  }

  const currentRange = selection.getRangeAt(0).cloneRange();
  if (!nodeIsInsideRoot(currentRange.startContainer, root) || !nodeIsInsideRoot(currentRange.endContainer, root)) {
    return null;
  }

  const command = kind === "highlight" ? "hiliteColor" : "foreColor";
  const commandValue = token
    ? kind === "highlight"
      ? TAG_COLOR_TOKENS[token].pastel
      : TAG_COLOR_TOKENS[token].bg
    : removalCssColor;

  // O WebView2 pode devolver um Range diferente depois de hiliteColor/foreColor
  // quando a pagina tem limites de bloco como code/blockquote. Os marcadores
  // precisam nascer antes do comando: a cor usa a selecao original e a
  // restauracao nao passa a confiar no Range reposicionado pelo engine.
  root.focus();
  const { startMarker, endMarker } = insertSelectionMarkers(currentRange, root.ownerDocument);
  selectBetweenMarkers(selection, startMarker, endMarker);
  root.ownerDocument.execCommand(command, false, commandValue);

  normalizeNotebookTextColors(root);
  // A normalizacao remove cor inline de TODO elemento visitado, inclusive do
  // <code>, cujo fundo e cor sao estilo de runtime recriado a partir da propria
  // tag (mesma sequencia da carga inicial do editor). Sem reaplicar aqui, o
  // bloco de codigo fica sem estilo ate o reload ou a troca de pagina. Nao vale
  // reaplicar no clone de serializacao: o HTML persistido nao deve carregar
  // valores de design token. prepareCodeElements so reescreve atributos, entao
  // repetir a chamada nao duplica estilo nem cria nos.
  prepareCodeElements(root);
  return restoreSelectionFromMarkers(selection, startMarker, endMarker);
}

function textColorsAtNode(node: Node | null, root: HTMLElement): NotebookTextColors {
  const colors = { ...emptyTextColors };
  let current = node instanceof Element ? node : node?.parentElement ?? null;

  while (current && current !== root) {
    if (!colors.highlight) {
      const highlight = current.getAttribute(notebookHighlightAttribute) ?? "";
      if (isTagColorToken(highlight)) {
        colors.highlight = highlight;
      }
    }
    if (!colors.color) {
      const color = current.getAttribute(notebookFontColorAttribute) ?? "";
      if (isTagColorToken(color)) {
        colors.color = color;
      }
    }
    current = current.parentElement;
  }

  return colors;
}

export function getNotebookTextColorsAtSelection(selection: Selection, root: HTMLElement): NotebookTextColors {
  const anchorColors = textColorsAtNode(selection.anchorNode, root);
  const focusColors = textColorsAtNode(selection.focusNode, root);
  return {
    highlight: anchorColors.highlight === focusColors.highlight ? anchorColors.highlight : null,
    color: anchorColors.color === focusColors.color ? anchorColors.color : null,
  };
}

/** Gera CSS a partir da paleta canonica; nenhum consumidor mantem mapa de hex proprio. */
export function renderNotebookTextColorStyles(scopeSelector: string) {
  return TAG_COLOR_TOKEN_NAMES.map((token) => {
    const colors = TAG_COLOR_TOKENS[token];
    return `${scopeSelector} [${notebookHighlightAttribute}="${token}"] {
  background-color: ${colors.pastel};
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
${scopeSelector} [${notebookFontColorAttribute}="${token}"] {
  color: ${colors.bg};
}`;
  }).join("\n");
}

export function isNotebookTextColorAttribute(name: string) {
  return name === notebookHighlightAttribute || name === notebookFontColorAttribute;
}
