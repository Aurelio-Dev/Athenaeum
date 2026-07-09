import type { NotebookPage } from "../../types/library";
import type { NotebookEquationStaticRenderResult } from "./notebookExportKatex";
import { renderNotebookDiagramStaticSvg } from "./notebookDiagramStaticSvg";
import {
  applyExportScaleAttributeAndStyle,
  applyExportScaleFromPercent,
  isResizableScaleAttribute,
  setSanitizedResizableScaleAttribute,
} from "./notebookDiagramScale";
import { loadNotebookExportLoraFontFaceCss } from "./notebookExportFonts";
import { isPlaceholderFigureCaption } from "./notebookEditorUtils";
import { applyFigureDimensions, resolveFigureExportSizing } from "./notebookFigureDimensions";

export type NotebookExportScope = "current-page" | "full-notebook";

export type NotebookExportSlotKind = "notebook-asset" | "notebook-attachment";

export type NotebookExportManifestSlot = {
  slotId: string;
  kind: NotebookExportSlotKind;
  resourceId: string;
  pageId: number;
  occurrence: number;
  altText?: string;
  caption?: string;
  displayName?: string;
};

export type NotebookExportManifest = {
  version: 1;
  nonce: string;
  notebookId: number;
  notebookTitle: string;
  scope: NotebookExportScope;
  pageIds: number[];
  createdAt: string;
  slots: NotebookExportManifestSlot[];
};

export type NotebookExportWarning = {
  code: "unsafe-url" | "missing-resource-id" | "unsupported-resource" | "manifest-mismatch";
  pageId: number;
  message: string;
};

export type NotebookExportBuildResult = {
  html: string;
  manifest: NotebookExportManifest;
  warnings: NotebookExportWarning[];
};

export type BuildNotebookExportHtmlInput = {
  notebookId: number;
  notebookTitle: string;
  scope: NotebookExportScope;
  pages: NotebookPage[];
  createdAt?: Date;
  nonce?: string;
};

export type NotebookExportStyleOptions = {
  katexStyles?: string;
  fontFaceStyles?: string;
};

type NotebookEquationStaticRenderer = (source: string) => NotebookEquationStaticRenderResult;

export type NotebookExportParsedSentinel = {
  nonce: string;
  slotId: string;
  index: number;
};

export type NotebookExportSlotValidation = {
  errors: string[];
  consumedSlotIds: string[];
};

const slotSentinelPattern = /<!--ATHENAEUM_SLOT:([^:>]+):([^>]+)-->/g;
const validNoncePattern = /^[a-zA-Z0-9-]{8,80}$/;
const validSlotIdPattern = /^slot-\d+$/;

const allowedElements = new Set([
  "a",
  "aside",
  "b",
  "blockquote",
  "br",
  "code",
  "div",
  "em",
  "figcaption",
  "figure",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "i",
  "li",
  "mark",
  "ol",
  "p",
  "pre",
  "s",
  "section",
  "small",
  "span",
  "strong",
  "sub",
  "sup",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "u",
  "ul",
]);

const blockedElements = new Set([
  "audio",
  "button",
  "canvas",
  "embed",
  "form",
  "iframe",
  "input",
  "link",
  "meta",
  "object",
  "option",
  "script",
  "select",
  "source",
  "style",
  "textarea",
  "video",
]);

const allowedDataAttributes = new Set([
  "data-athenaeum-block",
  "data-callout-content",
  "data-callout-icon",
  "data-callout-type",
  "data-diagram-kind",
  "data-diagram-scale",
  "data-diagram-source",
  "data-equation-scale",
  "data-equation-source",
  "data-figure-scale",
  "data-figure-subtype",
]);

const allowedTextAlignments = new Set(["left", "center", "right", "justify"]);

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function createNonce() {
  return globalThis.crypto?.randomUUID?.() ?? `nonce-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function formatIsoDate(date: Date) {
  return date.toISOString();
}

const exportMonthNamesPtBr = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

// Data de exibicao do cabecalho, em pt-BR e horario local do usuario (ex.:
// "8 de julho de 2026 as 14h30"). Construida a mao em vez de toLocaleString
// para ter saida deterministica, independente do ICU disponivel. O ISO
// continua sendo a fonte de verdade no manifest; isto e' so apresentacao.
export function formatNotebookExportDisplayDate(date: Date) {
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const day = date.getDate();
  const month = exportMonthNamesPtBr[date.getMonth()];
  const year = date.getFullYear();
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");

  return `${day} de ${month} de ${year} às ${hours}h${minutes}`;
}

function pageDisplayTitle(page: NotebookPage) {
  return page.title ?? `Página sem título ${page.position}`;
}

function normalizeNonce(nonce: string) {
  if (!validNoncePattern.test(nonce)) {
    throw new Error("Nonce invalido para exportacao do caderno.");
  }

  return nonce;
}

export function createNotebookExportSlotSentinel(nonce: string, slotId: string) {
  if (!validNoncePattern.test(nonce)) {
    throw new Error("Nonce invalido para sentinela de exportacao.");
  }

  if (!validSlotIdPattern.test(slotId)) {
    throw new Error("Slot invalido para sentinela de exportacao.");
  }

  return `<!--ATHENAEUM_SLOT:${nonce}:${slotId}-->`;
}

export function parseNotebookExportSlotSentinels(html: string): NotebookExportParsedSentinel[] {
  return Array.from(html.matchAll(slotSentinelPattern), (match) => ({
    nonce: match[1],
    slotId: match[2],
    index: match.index ?? 0,
  }));
}

export function validateNotebookExportManifestSlots(html: string, manifest: NotebookExportManifest): NotebookExportSlotValidation {
  const sentinels = parseNotebookExportSlotSentinels(html);
  const manifestSlotIds = new Set(manifest.slots.map((slot) => slot.slotId));
  const consumedSlotIds = new Set<string>();
  const errors: string[] = [];

  for (const sentinel of sentinels) {
    if (sentinel.nonce !== manifest.nonce) {
      errors.push(`Sentinela ${sentinel.slotId} usa nonce inesperado.`);
    }

    if (consumedSlotIds.has(sentinel.slotId)) {
      errors.push(`Sentinela duplicada para ${sentinel.slotId}.`);
      continue;
    }

    consumedSlotIds.add(sentinel.slotId);

    if (!manifestSlotIds.has(sentinel.slotId)) {
      errors.push(`Sentinela ${sentinel.slotId} nao existe no manifest.`);
    }
  }

  for (const slot of manifest.slots) {
    if (!consumedSlotIds.has(slot.slotId)) {
      errors.push(`Slot ${slot.slotId} do manifest nao foi consumido no HTML.`);
    }
  }

  return {
    errors,
    consumedSlotIds: Array.from(consumedSlotIds),
  };
}

function isRuntimeOnlyElement(element: Element) {
  return (
    element.getAttribute("data-diagram-preview") === "true" ||
    element.getAttribute("data-equation-preview") === "true" ||
    element.getAttribute("data-figure-preview") === "true" ||
    element.getAttribute("data-file-attachment-actions") === "true" ||
    element.classList.contains("notebook-diagram-frame") ||
    element.classList.contains("notebook-diagram-frame-box") ||
    element.classList.contains("notebook-diagram-frame-content") ||
    element.classList.contains("notebook-diagram-resize-handle")
  );
}

function isSafeHref(value: string) {
  const trimmedValue = value.trim();

  if (trimmedValue.startsWith("#")) {
    return true;
  }

  try {
    const url = new URL(trimmedValue, "https://athenaeum.local");
    return url.protocol === "http:" || url.protocol === "https:" || url.protocol === "mailto:";
  } catch {
    return false;
  }
}

function getSanitizedStyle(value: string) {
  const declarations = value
    .split(";")
    .map((declaration) => declaration.trim())
    .filter((declaration) => declaration.length > 0);
  const safeDeclarations: string[] = [];

  for (const declaration of declarations) {
    const [property, rawValue] = declaration.split(":").map((part) => part.trim().toLowerCase());

    if (property === "text-align" && rawValue && allowedTextAlignments.has(rawValue)) {
      safeDeclarations.push(`text-align: ${rawValue}`);
    }
  }

  return safeDeclarations.join("; ");
}

function copySafeAttributes(source: Element, target: HTMLElement, pageId: number, warnings: NotebookExportWarning[]) {
  for (const attribute of Array.from(source.attributes)) {
    const name = attribute.name.toLowerCase();
    const value = attribute.value;

    if (name === "contenteditable" || name === "spellcheck" || name === "id" || name.startsWith("on")) {
      continue;
    }

    if (name === "style") {
      const safeStyle = getSanitizedStyle(value);
      if (safeStyle) {
        target.setAttribute("style", safeStyle);
      }
      continue;
    }

    if (name === "align" && allowedTextAlignments.has(value.toLowerCase())) {
      target.setAttribute("align", value.toLowerCase());
      continue;
    }

    if (isResizableScaleAttribute(name)) {
      setSanitizedResizableScaleAttribute(target, name, value);
      continue;
    }

    if (allowedDataAttributes.has(name)) {
      target.setAttribute(name, value);
      continue;
    }

    if (name === "href" && source.tagName.toLowerCase() === "a") {
      if (isSafeHref(value)) {
        target.setAttribute("href", value);
      } else {
        warnings.push({
          code: "unsafe-url",
          pageId,
          message: "Link inseguro removido da exportacao.",
        });
      }
      continue;
    }

    if (name === "title" || name === "alt" || name === "aria-label" || name === "role") {
      target.setAttribute(name, value);
      continue;
    }

    if ((name === "colspan" || name === "rowspan") && /^\d{1,2}$/.test(value)) {
      target.setAttribute(name, value);
      continue;
    }

    if (name === "scope" && (value === "col" || value === "row")) {
      target.setAttribute(name, value);
    }
  }
}

function appendSanitizedChildren(source: Element, target: Node, context: SanitizationContext) {
  Array.from(source.childNodes).forEach((child) => {
    sanitizeNode(child, context).forEach((safeChild) => target.appendChild(safeChild));
  });
}

function isPersistedCodeBlock(element: Element) {
  if (element.tagName.toLowerCase() !== "code" || !(element instanceof HTMLElement)) {
    return false;
  }

  const rawStyle = element.getAttribute("style") ?? "";
  return element.style.display === "block" || /(^|;)\s*display\s*:\s*block\s*(;|$)/i.test(rawStyle);
}

function readCodeTextNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent ?? "";
  }

  if (node instanceof HTMLBRElement) {
    return "\n";
  }

  if (!(node instanceof HTMLElement)) {
    return "";
  }

  const childText = Array.from(node.childNodes).map(readCodeTextNode).join("");
  const tagName = node.tagName.toLowerCase();

  if ((tagName === "div" || tagName === "p") && childText.length > 0 && !childText.endsWith("\n")) {
    return `${childText}\n`;
  }

  return childText;
}

function readCodeElementText(code: Element) {
  return Array.from(code.childNodes).map(readCodeTextNode).join("");
}

function sanitizeCodeBlock(code: HTMLElement, context: SanitizationContext): Node[] {
  const pre = context.targetDocument.createElement("pre");
  const targetCode = context.targetDocument.createElement("code");

  targetCode.textContent = readCodeElementText(code);
  pre.appendChild(targetCode);

  return [pre];
}

type SanitizationContext = {
  targetDocument: Document;
  nonce: string;
  pageId: number;
  slots: NotebookExportManifestSlot[];
  warnings: NotebookExportWarning[];
  diagramOccurrence: number;
  equationRenderer?: NotebookEquationStaticRenderer;
  styleRequirements: {
    hasRenderedEquation: boolean;
  };
};

function createSlotComment(context: SanitizationContext, slot: Omit<NotebookExportManifestSlot, "slotId" | "occurrence">) {
  const slotId = `slot-${context.slots.length + 1}`;
  context.slots.push({
    ...slot,
    slotId,
    occurrence: context.slots.length + 1,
  });

  return context.targetDocument.createComment(`ATHENAEUM_SLOT:${context.nonce}:${slotId}`);
}

function getClosestFigureCaption(element: Element) {
  const figure = element.closest("figure");
  return figure?.querySelector("figcaption")?.textContent?.trim() || undefined;
}

function readDiagramSourceNodeText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent ?? "";
  }

  if (node instanceof HTMLBRElement) {
    return "\n";
  }

  if (!(node instanceof HTMLElement)) {
    return "";
  }

  const childText = Array.from(node.childNodes).map(readDiagramSourceNodeText).join("");
  const tagName = node.tagName.toLowerCase();

  if ((tagName === "div" || tagName === "p") && childText.length > 0 && !childText.endsWith("\n")) {
    return `${childText}\n`;
  }

  return childText;
}

function normalizeDiagramSourceText(sourceText: string) {
  return sourceText
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function readDiagramSourceElementText(source: Element) {
  return Array.from(source.childNodes).map(readDiagramSourceNodeText).join("");
}

function getExportDiagramSourceText(diagram: Element) {
  const sources = Array.from(diagram.querySelectorAll(':scope > [data-diagram-source="true"]'));

  if (sources.length > 0) {
    return normalizeDiagramSourceText(sources.map(readDiagramSourceElementText).join("\n"));
  }

  const clone = diagram.cloneNode(true);
  if (clone instanceof Element) {
    clone.querySelectorAll('[data-diagram-preview="true"]').forEach((preview) => preview.remove());
    return normalizeDiagramSourceText(clone.textContent ?? "");
  }

  return "";
}

function normalizeEquationSourceText(sourceText: string) {
  return sourceText.replace(/\u00a0/g, " ").trim();
}

function getExportEquationSourceText(equation: Element) {
  const source = equation.querySelector(':scope > [data-equation-source="true"]');

  if (source) {
    return normalizeEquationSourceText(source.textContent ?? "");
  }

  const clone = equation.cloneNode(true);
  if (clone instanceof Element) {
    clone.querySelectorAll('[data-equation-preview="true"]').forEach((preview) => preview.remove());
    return normalizeEquationSourceText(clone.textContent ?? "");
  }

  return "";
}

function escapeEquationFallbackSource(value: string) {
  return escapeHtml(value)
    .replace(/\b(javascript|file|blob):/gi, "$1&#58;")
    .replace(/\bon(error|click)=/gi, (match) => `${match.slice(0, -1)}&#61;`);
}

function renderUnavailableEquationFallback(source: string) {
  const sourceHtml = source.length > 0 ? `<code class="athenaeum-export__equation-source">${escapeEquationFallbackSource(source)}</code>` : "";

  return `<div class="athenaeum-export__equation-fallback" role="note">
  <strong>Equacao nao renderizada</strong>
  <span>A equacao nao pode ser renderizada neste export.</span>
  ${sourceHtml}
</div>`;
}

function sanitizeDiagramFigure(diagram: HTMLElement, context: SanitizationContext): Node[] {
  const figure = context.targetDocument.createElement("figure");
  copySafeAttributes(diagram, figure, context.pageId, context.warnings);

  context.diagramOccurrence += 1;

  const renderedDiagram = renderNotebookDiagramStaticSvg({
    kind: diagram.getAttribute("data-diagram-kind"),
    source: getExportDiagramSourceText(diagram),
    scale: diagram.getAttribute("data-diagram-scale"),
    idPrefix: `athenaeum-export-diagram-${context.pageId}-${context.diagramOccurrence}`,
  });
  const staticContent = context.targetDocument.createElement("div");
  staticContent.className = "athenaeum-export__diagram-static";
  staticContent.innerHTML = renderedDiagram.html;

  figure.classList.add("athenaeum-export__diagram");
  // Grafos com detalhes ganham uma classe extra que ativa o layout desenho +
  // conjuntos (V e E) e as regras de impressão específicas, sem alterar os
  // demais tipos de diagrama.
  if (renderedDiagram.hasGraphDetails) {
    figure.classList.add("athenaeum-export__graph");
  }
  figure.setAttribute("data-athenaeum-block", "diagram");
  figure.setAttribute("data-diagram-kind", renderedDiagram.kind);
  applyExportScaleFromPercent(figure, "data-diagram-scale", renderedDiagram.scalePercent);
  figure.appendChild(staticContent);

  return [figure];
}

function sanitizeEquationFigure(equation: HTMLElement, context: SanitizationContext): Node[] {
  const figure = context.targetDocument.createElement("figure");
  copySafeAttributes(equation, figure, context.pageId, context.warnings);

  const source = getExportEquationSourceText(equation);
  const renderedEquation = context.equationRenderer?.(source) ?? {
    status: "fallback",
    html: renderUnavailableEquationFallback(source),
    source,
  };
  const staticContent = context.targetDocument.createElement("div");
  staticContent.className = "athenaeum-export__equation-static";
  staticContent.innerHTML = renderedEquation.html;

  if (renderedEquation.status === "rendered") {
    context.styleRequirements.hasRenderedEquation = true;
  }

  figure.classList.add("athenaeum-export__equation");
  figure.setAttribute("data-athenaeum-block", "equation");
  applyExportScaleAttributeAndStyle(figure, "data-equation-scale", equation.getAttribute("data-equation-scale"));
  figure.appendChild(staticContent);

  return [figure];
}

// Aplica o tamanho da imagem no export sem transform: dimensoes independentes
// viram largura em px + aspect-ratio (a altura e derivada, degrada
// proporcionalmente sob max-width:100% em telas estreitas); escala legada
// continua como largura percentual; sem nada persistido, tamanho natural.
function applyExportImageSizing(figure: HTMLElement, imageFigure: Element) {
  const sizing = resolveFigureExportSizing(
    imageFigure.getAttribute("data-figure-width"),
    imageFigure.getAttribute("data-figure-height"),
    imageFigure.getAttribute("data-figure-scale"),
  );

  if (sizing.kind === "dimensions") {
    applyFigureDimensions(figure, { width: sizing.width, height: sizing.height });
    // Dimensoes vencem a escala: remove um data-figure-scale redundante que
    // copySafeAttributes possa ter trazido.
    figure.removeAttribute("data-figure-scale");
    figure.classList.add("athenaeum-export__figure--sized");
    const sizingStyle = `--fig-w: ${sizing.width}px; --fig-aspect: ${sizing.width} / ${sizing.height}`;
    const currentStyle = figure.getAttribute("style");
    figure.setAttribute("style", currentStyle ? `${currentStyle}; ${sizingStyle}` : sizingStyle);
    return;
  }

  if (sizing.kind === "scale") {
    applyExportScaleFromPercent(figure, "data-figure-scale", sizing.percent);
  }
}

function sanitizeImageFigure(imageFigure: HTMLElement, context: SanitizationContext): Node[] {
  const figure = context.targetDocument.createElement("figure");
  copySafeAttributes(imageFigure, figure, context.pageId, context.warnings);

  figure.classList.add("athenaeum-export__figure");
  figure.setAttribute("data-athenaeum-block", "figure");
  figure.setAttribute("data-figure-subtype", "image");
  applyExportImageSizing(figure, imageFigure);

  // Uma legenda vazia ou igual ao placeholder legado nao vira conteudo
  // exportado (o <figcaption> e omitido); uma legenda real e preservada.
  Array.from(imageFigure.childNodes).forEach((child) => {
    if (
      child instanceof HTMLElement &&
      child.tagName.toLowerCase() === "figcaption" &&
      isPlaceholderFigureCaption(child.textContent)
    ) {
      return;
    }

    sanitizeNode(child, context).forEach((safeChild) => figure.appendChild(safeChild));
  });

  return [figure];
}

function sanitizeAssetImage(image: HTMLImageElement, context: SanitizationContext): Node[] {
  const resourceId = image.getAttribute("data-notebook-asset-id")?.trim();

  if (!resourceId) {
    context.warnings.push({
      code: "missing-resource-id",
      pageId: context.pageId,
      message: "Imagem sem identificador interno foi removida da exportacao.",
    });
    return [];
  }

  return [
    createSlotComment(context, {
      kind: "notebook-asset",
      resourceId,
      pageId: context.pageId,
      altText: image.getAttribute("alt") ?? "",
      caption: getClosestFigureCaption(image),
    }),
  ];
}

function sanitizeAttachmentFigure(attachment: HTMLElement, context: SanitizationContext): Node[] {
  const resourceId = attachment.getAttribute("data-notebook-attachment-id")?.trim();

  if (!resourceId) {
    context.warnings.push({
      code: "missing-resource-id",
      pageId: context.pageId,
      message: "Anexo sem identificador interno foi removido da exportacao.",
    });
    return [];
  }

  const figure = context.targetDocument.createElement("figure");
  copySafeAttributes(attachment, figure, context.pageId, context.warnings);
  figure.removeAttribute("data-notebook-attachment-id");
  figure.appendChild(
    createSlotComment(context, {
      kind: "notebook-attachment",
      resourceId,
      pageId: context.pageId,
      caption: attachment.querySelector("figcaption")?.textContent?.trim() || undefined,
      displayName: attachment.querySelector('[data-file-attachment-name="true"]')?.textContent?.trim() || undefined,
    }),
  );

  attachment.querySelectorAll(":scope > figcaption").forEach((caption) => {
    sanitizeNode(caption, context).forEach((safeCaption) => figure.appendChild(safeCaption));
  });

  return [figure];
}

function sanitizeNode(node: Node, context: SanitizationContext): Node[] {
  if (node.nodeType === Node.TEXT_NODE) {
    return [context.targetDocument.createTextNode(node.textContent ?? "")];
  }

  if (!(node instanceof Element) || node.nodeType !== Node.ELEMENT_NODE) {
    return [];
  }

  const tagName = node.tagName.toLowerCase();

  if (blockedElements.has(tagName) || isRuntimeOnlyElement(node)) {
    return [];
  }

  if (isPersistedCodeBlock(node)) {
    return sanitizeCodeBlock(node as HTMLElement, context);
  }

  if (node instanceof HTMLImageElement) {
    if (node.hasAttribute("data-notebook-asset-id")) {
      return sanitizeAssetImage(node, context);
    }

    context.warnings.push({
      code: "unsupported-resource",
      pageId: context.pageId,
      message: "Imagem externa ou sem asset interno foi removida da exportacao.",
    });
    return [];
  }

  if (tagName === "figure" && node.getAttribute("data-athenaeum-block") === "file-attachment") {
    return sanitizeAttachmentFigure(node as HTMLElement, context);
  }

  if (tagName === "figure" && node.getAttribute("data-athenaeum-block") === "diagram") {
    return sanitizeDiagramFigure(node as HTMLElement, context);
  }

  if (tagName === "figure" && node.getAttribute("data-athenaeum-block") === "equation") {
    return sanitizeEquationFigure(node as HTMLElement, context);
  }

  if (
    tagName === "figure" &&
    node.getAttribute("data-athenaeum-block") === "figure" &&
    node.getAttribute("data-figure-subtype") === "image"
  ) {
    return sanitizeImageFigure(node as HTMLElement, context);
  }

  if (!allowedElements.has(tagName)) {
    const fragment = context.targetDocument.createDocumentFragment();
    appendSanitizedChildren(node, fragment, context);
    return [fragment];
  }

  const target = context.targetDocument.createElement(tagName);
  copySafeAttributes(node, target, context.pageId, context.warnings);
  appendSanitizedChildren(node, target, context);

  return [target];
}

function sanitizePageContent(page: NotebookPage, context: SanitizationContext) {
  const sourceDocument = document.implementation.createHTMLDocument("Athenaeum page");
  const targetContainer = context.targetDocument.createElement("div");
  sourceDocument.body.innerHTML = page.content;

  Array.from(sourceDocument.body.childNodes).forEach((child) => {
    sanitizeNode(child, context).forEach((safeChild) => targetContainer.appendChild(safeChild));
  });

  return targetContainer.innerHTML;
}

export function renderExportStyles(options: NotebookExportStyleOptions = {}) {
  const katexStyles = options.katexStyles?.trim();
  const fontFaceStyles = options.fontFaceStyles?.trim();

  return `
    ${fontFaceStyles ? `${fontFaceStyles}\n` : ""}
    :root {
      color-scheme: light;
      /* Tokens editoriais fixos, espelhando o tema claro do Caderno
         (src/styles/index.css). O export e' um documento estatico e
         autocontido: sem tema escuro e sem variaveis do app em runtime. */
      --ax-serif: "Lora", Georgia, "Times New Roman", serif;
      --ax-sans: "Segoe UI", -apple-system, BlinkMacSystemFont, Roboto, "Helvetica Neue", Arial, sans-serif;
      --ax-mono: "IBM Plex Mono", "Cascadia Code", Consolas, "Courier New", monospace;
      /* Folha branca (item 2): fundo externo neutro muito claro, folha #fff,
         texto principal escuro de alto contraste, secundario cinza/marrom
         neutro e o acento cobre/terracota do Athenaeum preservado. O bloco de
         codigo permanece com fundo escuro (itens 8 e 9). */
      --ax-paper: #ffffff;
      --ax-desk: #f4f1ed;
      --ax-ink: #1f2933;
      --ax-ink-muted: #765f52;
      --ax-accent: #a85f2a;
      --ax-border: #d8d2ca;
      --ax-border-soft: #e7e2db;
      --ax-surface-muted: #f5f3f0;
      --ax-code-bg: #f7f5f2;
      --ax-code-inline-bg: #f3f1ec;
      --ax-code-block-bg: #1e2130;
      --ax-code-block-ink: #f0e6dc;
      font-family: var(--ax-sans);
      color: var(--ax-ink);
      background: var(--ax-desk);
      -webkit-text-size-adjust: 100%;
      text-rendering: optimizeLegibility;
      -webkit-font-smoothing: antialiased;
    }
    body {
      margin: 0;
      background: var(--ax-desk);
      color: var(--ax-ink);
      font-family: var(--ax-sans);
      font-size: 17px;
      line-height: 1.7;
    }
    .athenaeum-export {
      box-sizing: border-box;
      max-width: 46rem;
      margin: 2.5rem auto;
      padding: 3.5rem 3.25rem 4.5rem;
      background: var(--ax-paper);
      border: 1px solid var(--ax-border-soft);
      border-radius: 14px;
      box-shadow: 0 1px 2px rgba(26, 20, 16, 0.05), 0 18px 40px -24px rgba(26, 20, 16, 0.3);
    }
    .athenaeum-export > header {
      margin-bottom: 2.5rem;
      padding-bottom: 1.5rem;
      border-bottom: 1px solid var(--ax-border);
    }
    .athenaeum-export__title {
      margin: 0 0 0.5rem;
      font-family: var(--ax-serif);
      font-weight: 700;
      font-size: 2.4rem;
      line-height: 1.15;
      letter-spacing: -0.01em;
      color: var(--ax-ink);
    }
    .athenaeum-export__meta {
      margin: 0;
      color: var(--ax-ink-muted);
      font-size: 0.78rem;
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }
    .athenaeum-export__page {
      margin: 0;
    }
    .athenaeum-export__page + .athenaeum-export__page {
      margin-top: 3rem;
      padding-top: 2.75rem;
      border-top: 1px solid var(--ax-border-soft);
    }
    .athenaeum-export__page-title {
      margin: 0 0 1.35rem;
      font-family: var(--ax-serif);
      font-weight: 500;
      font-size: 1.75rem;
      line-height: 1.25;
      letter-spacing: -0.005em;
      color: var(--ax-ink);
    }
    .athenaeum-export__page-title + * {
      margin-top: 0;
    }
    .athenaeum-export__page :is(h1, h2, h3, h4, h5, h6):not(.athenaeum-export__page-title) {
      font-family: var(--ax-sans);
      font-weight: 700;
      line-height: 1.3;
      color: var(--ax-ink);
      margin: 2em 0 0.55em;
    }
    .athenaeum-export__page h1:not(.athenaeum-export__page-title) {
      font-size: 1.5rem;
    }
    .athenaeum-export__page h2:not(.athenaeum-export__page-title) {
      font-size: 1.3rem;
    }
    .athenaeum-export__page h3:not(.athenaeum-export__page-title) {
      font-size: 1.13rem;
    }
    .athenaeum-export__page h4:not(.athenaeum-export__page-title) {
      font-size: 1rem;
    }
    .athenaeum-export__page :is(h5, h6):not(.athenaeum-export__page-title) {
      font-size: 0.9rem;
      letter-spacing: 0.03em;
      text-transform: uppercase;
      color: var(--ax-ink-muted);
    }
    .athenaeum-export p {
      margin: 0 0 1.15em;
    }
    .athenaeum-export :is(ul, ol) {
      margin: 0 0 1.15em;
      padding-left: 1.6em;
    }
    .athenaeum-export ul {
      list-style: disc;
    }
    .athenaeum-export ol {
      list-style: decimal;
    }
    .athenaeum-export li {
      margin: 0.3em 0;
    }
    .athenaeum-export li::marker {
      color: var(--ax-accent);
    }
    .athenaeum-export blockquote {
      margin: 1.5em 0;
      padding: 0.25em 0 0.25em 1.25em;
      border-left: 3px solid var(--ax-accent);
      color: var(--ax-ink-muted);
      font-style: italic;
    }
    .athenaeum-export blockquote > :last-child {
      margin-bottom: 0;
    }
    .athenaeum-export__page a:not(.athenaeum-export__attachment) {
      color: var(--ax-accent);
      font-weight: 600;
      text-decoration: underline;
      text-underline-offset: 0.16em;
      text-decoration-thickness: 0.07em;
      overflow-wrap: anywhere;
    }
    .athenaeum-export mark {
      background: #fef3c7;
      color: #92400e;
      padding: 0.02em 0.18em;
      border-radius: 3px;
    }
    .athenaeum-export hr {
      margin: 2.25em 0;
      border: 0;
      border-top: 1px solid var(--ax-border-soft);
    }
    .athenaeum-export :not(pre) > code {
      font-family: var(--ax-mono);
      font-size: 0.86em;
      background: var(--ax-code-inline-bg);
      border: 1px solid var(--ax-border-soft);
      border-radius: 5px;
      padding: 0.12em 0.35em;
    }
    .athenaeum-export pre {
      display: block;
      box-sizing: border-box;
      width: 100%;
      margin: 1.5em 0;
      padding: 0.875rem 1rem;
      background: var(--ax-code-block-bg);
      border: 1px solid #34384b;
      border-radius: 8px;
      color: var(--ax-code-block-ink);
      font-family: var(--ax-mono);
      font-size: 0.9rem;
      line-height: 1.6;
      overflow-x: auto;
      white-space: pre;
    }
    .athenaeum-export pre code {
      color: inherit;
      font: inherit;
      background: transparent;
      border: 0;
      padding: 0;
      white-space: inherit;
    }
    .athenaeum-export figure {
      margin: 1.85em 0;
    }
    .athenaeum-export figcaption {
      margin-top: 0.65em;
      color: var(--ax-ink-muted);
      font-size: 0.85rem;
      line-height: 1.5;
      text-align: center;
    }
    .athenaeum-export img {
      display: block;
      max-width: 100%;
      height: auto;
      margin: 0 auto;
    }
    .athenaeum-export__asset {
      border-radius: 6px;
    }
    .athenaeum-export__figure {
      max-width: 100%;
    }
    .athenaeum-export__figure img {
      width: 100%;
      max-width: 100%;
      height: auto;
    }
    /* Imagem com dimensoes independentes: largura em px (limitada pela folha) e
       altura derivada por aspect-ratio. Sob max-width:100% a largura encolhe em
       telas estreitas e a altura acompanha, sem estourar a folha nem apagar a
       altura persistida (height:auto so deriva o valor do aspect-ratio). A
       legenda herda a largura visual da figura. */
    .athenaeum-export__figure--sized {
      width: var(--fig-w);
      max-width: 100%;
      margin-inline: auto;
    }
    .athenaeum-export__figure--sized img {
      width: 100%;
      height: auto;
      aspect-ratio: var(--fig-aspect);
    }
    .athenaeum-export__missing {
      display: inline-block;
      padding: 0.15em 0.55em;
      border: 1px dashed var(--ax-border);
      border-radius: 6px;
      color: var(--ax-ink-muted);
      font-size: 0.85em;
      font-style: italic;
    }
    .athenaeum-export figure[data-athenaeum-block="file-attachment"] {
      margin: 1.75em 0;
    }
    .athenaeum-export__attachment {
      display: inline-flex;
      align-items: baseline;
      gap: 0.5em;
      max-width: 100%;
      padding: 0.7em 1em;
      border: 1px solid var(--ax-border);
      border-left: 3px solid var(--ax-accent);
      border-radius: 8px;
      background: var(--ax-surface-muted);
      color: var(--ax-accent);
      font-weight: 700;
      text-decoration: none;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    .athenaeum-export__attachment::before {
      content: "Anexo";
      flex: none;
      color: var(--ax-ink-muted);
      font-family: var(--ax-sans);
      font-size: 0.62em;
      font-weight: 800;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .athenaeum-export__attachment:hover {
      text-decoration: underline;
      text-underline-offset: 0.16em;
    }
    .athenaeum-export table {
      width: 100%;
      border-collapse: collapse;
      margin: 1.6em 0;
      font-size: 0.95em;
    }
    .athenaeum-export :is(td, th) {
      border: 1px solid var(--ax-border);
      padding: 0.55em 0.7em;
      vertical-align: top;
      text-align: left;
      overflow-wrap: anywhere;
    }
    .athenaeum-export th {
      background: var(--ax-surface-muted);
      font-weight: 700;
    }
    .athenaeum-export [data-athenaeum-block="callout"] {
      --ax-callout-accent: #2563eb;
      --ax-callout-bg: #eef3fd;
      --ax-callout-border: #c9d8f6;
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      gap: 0.75em;
      margin: 1.6em 0;
      padding: 0.9em 1.05em;
      border: 1px solid var(--ax-callout-border);
      border-left: 4px solid var(--ax-callout-accent);
      border-radius: 8px;
      background: var(--ax-callout-bg);
    }
    .athenaeum-export [data-athenaeum-block="callout"][data-callout-type="tip"] {
      --ax-callout-accent: #0f766e;
      --ax-callout-bg: #e7f1ef;
      --ax-callout-border: #c0dad6;
    }
    .athenaeum-export [data-athenaeum-block="callout"][data-callout-type="warning"] {
      --ax-callout-accent: #a16207;
      --ax-callout-bg: #f6eedf;
      --ax-callout-border: #e4d2ae;
    }
    .athenaeum-export [data-athenaeum-block="callout"][data-callout-type="danger"] {
      --ax-callout-accent: #b91c1c;
      --ax-callout-bg: #f7e9e7;
      --ax-callout-border: #eac4bf;
    }
    .athenaeum-export [data-callout-icon="true"] {
      display: inline-flex;
      width: 1.7em;
      height: 1.7em;
      align-items: center;
      justify-content: center;
      border-radius: 999px;
      background: var(--ax-callout-accent);
      color: #ffffff;
      font-family: var(--ax-mono);
      font-size: 0.82em;
      font-weight: 800;
      line-height: 1;
    }
    .athenaeum-export [data-callout-content="true"] {
      min-width: 0;
    }
    .athenaeum-export [data-callout-content="true"] > strong:first-child {
      display: block;
      margin-bottom: 0.2em;
      color: var(--ax-ink);
    }
    .athenaeum-export [data-callout-content="true"] > div {
      color: var(--ax-ink-muted);
    }
    ${katexStyles ? `${katexStyles}\n` : ""}
    .athenaeum-export__equation {
      margin: 1.6em auto;
      padding: 0.85em 1em;
      border: 1px solid var(--ax-border-soft);
      border-radius: 8px;
      background: var(--ax-code-bg);
      overflow-x: auto;
    }
    .athenaeum-export__equation-static {
      max-width: 100%;
      overflow-x: auto;
    }
    .athenaeum-export__equation-rendered .katex-display {
      margin: 0.35rem 0;
      color: var(--ax-ink);
    }
    .athenaeum-export__equation-fallback {
      display: grid;
      gap: 0.45rem;
      color: var(--ax-ink-muted);
      font-size: 0.92rem;
    }
    .athenaeum-export__equation-fallback strong {
      color: var(--ax-ink);
    }
    .athenaeum-export__equation-source {
      display: block;
      margin-top: 0.15rem;
      white-space: pre-wrap;
      color: var(--ax-ink-muted);
      font-family: var(--ax-mono);
      font-size: 0.82rem;
    }
    .athenaeum-export__diagram {
      width: min(100%, 52rem);
      max-width: 100%;
      margin: 1.5em auto;
      padding: 0.05rem 0;
      border: 0;
      background: transparent;
    }
    .athenaeum-export__diagram-static {
      max-width: 100%;
      overflow-x: auto;
    }
    .athenaeum-export__diagram-visual {
      display: flex;
      justify-content: center;
      width: max-content;
      max-width: 100%;
      margin-inline: auto;
    }
    .athenaeum-export__diagram svg {
      display: block;
      max-width: 100%;
      height: auto;
      margin-inline: auto;
    }
    .notebook-diagram-visual-edge,
    .notebook-flowchart-visual-edge {
      fill: none;
      stroke: #1f1a17;
      stroke-linecap: round;
      stroke-linejoin: round;
      stroke-width: 2px;
      opacity: 0.9;
      vector-effect: non-scaling-stroke;
    }
    .notebook-diagram-visual-arrowhead,
    .notebook-flowchart-visual-arrowhead {
      fill: #1f1a17;
      opacity: 0.92;
    }
    .notebook-diagram-visual-node,
    .notebook-flowchart-visual-node {
      fill: #ffffff;
      stroke: #6b625c;
      stroke-width: 1.5px;
      vector-effect: non-scaling-stroke;
    }
    .notebook-flowchart-visual-node--terminal {
      fill: #ffffff;
    }
    .notebook-graph-cycle-vertex {
      fill: #ffffff;
      stroke: #1f1a17;
      stroke-width: 1.5px;
      vector-effect: non-scaling-stroke;
    }
    .notebook-diagram-visual-label,
    .notebook-flowchart-visual-label {
      fill: #1f1a17;
      font-family: var(--ax-sans);
      font-size: 12.25px;
      letter-spacing: 0;
    }
    .notebook-graph-cycle-vertex-label {
      font-family: var(--ax-serif);
      font-size: 11.75px;
    }
    .athenaeum-export__diagram-fallback {
      display: grid;
      gap: 0.45rem;
      color: var(--ax-ink-muted);
      font-size: 0.92rem;
    }
    .athenaeum-export__diagram-fallback strong {
      color: var(--ax-ink);
    }
    .athenaeum-export__diagram-source {
      margin: 0.25rem 0 0;
      white-space: pre-wrap;
      color: var(--ax-ink-muted);
      font-family: var(--ax-mono);
      font-size: 0.82rem;
    }
    /* Grafo com detalhes: desenho e conjuntos (identificacao, V e E) lado a lado
       em telas largas; com flex-wrap eles empilham naturalmente quando nao ha
       espaco (tela estreita, bloco reduzido ou impressao), sem depender de
       JavaScript nem da largura do editor. O tamanho persistido controla a
       figura inteira; o SVG ocupa sua area com max-width:100% e sem overflow. */
    .athenaeum-export__graph-layout {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: center;
      gap: 0.75rem 1.75rem;
    }
    .athenaeum-export__graph-visual {
      display: flex;
      justify-content: center;
      flex: 0 1 auto;
      min-width: 0;
      max-width: 100%;
    }
    .athenaeum-export__graph-visual svg {
      display: block;
      max-width: 100%;
      height: auto;
      margin-inline: auto;
    }
    .athenaeum-export__graph-details {
      flex: 1 1 14rem;
      min-width: 0;
      max-width: min(100%, 26rem);
      color: var(--ax-ink);
      font-family: var(--ax-serif);
      font-size: 0.98rem;
      line-height: 1.6;
    }
    .athenaeum-export__graph-details p {
      margin: 0 0 0.35em;
      overflow-wrap: anywhere;
    }
    .athenaeum-export__graph-details p:last-child {
      margin-bottom: 0;
    }
    /* Letras C, V e E: variaveis matematicas em italico com destaque discreto. */
    .athenaeum-export__graph-variable {
      font-style: italic;
      color: var(--ax-accent);
    }
    .athenaeum-export__graph-variable sub {
      font-style: normal;
    }
    .athenaeum-export__graph-set {
      font-family: var(--ax-mono);
      font-size: 0.92rem;
    }
    .athenaeum-export__graph-set-glyph {
      color: var(--ax-ink-muted);
    }
    .athenaeum-export__graph-item {
      overflow-wrap: anywhere;
    }
    @media print {
      body {
        background: #ffffff;
      }
      .athenaeum-export {
        max-width: none;
        margin: 0;
        padding: 0;
        border: 0;
        border-radius: 0;
        box-shadow: none;
      }
      .athenaeum-export figure,
      .athenaeum-export pre,
      .athenaeum-export table,
      .athenaeum-export blockquote,
      .athenaeum-export [data-athenaeum-block="diagram"],
      .athenaeum-export [data-athenaeum-block="equation"],
      .athenaeum-export__diagram,
      .athenaeum-export__equation,
      .athenaeum-export__figure {
        break-inside: avoid;
        page-break-inside: avoid;
      }
      /* Grafo grande pode ser maior que uma pagina: permite a quebra da figura
         (evita pagina vazia/overflow), mas mantem o desenho inteiro e a
         identificacao junto do conteudo que a segue. A especificidade extra
         sobrepoe o break-inside: avoid herdado de ".athenaeum-export figure". */
      .athenaeum-export figure.athenaeum-export__graph {
        break-inside: auto;
        page-break-inside: auto;
      }
      .athenaeum-export__graph-visual {
        break-inside: avoid;
        page-break-inside: avoid;
      }
      .athenaeum-export__graph-identification {
        break-after: avoid;
        page-break-after: avoid;
      }
      .athenaeum-export pre {
        white-space: pre-wrap;
        overflow-wrap: anywhere;
      }
    }
    @media (max-width: 640px) {
      body {
        font-size: 16px;
      }
      .athenaeum-export {
        margin: 0;
        padding: 1.85rem 1.25rem 2.75rem;
        border: 0;
        border-radius: 0;
        box-shadow: none;
      }
      .athenaeum-export__title {
        font-size: 1.95rem;
      }
      .athenaeum-export__page-title {
        font-size: 1.5rem;
      }
    }
  `;
}

function renderExportHtmlDocument(title: string, bodyHtml: string, styleOptions: NotebookExportStyleOptions = {}) {
  const escapedTitle = escapeHtml(title);

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; object-src 'none'; base-uri 'none'; form-action 'none'; connect-src 'none'">
  <title>${escapedTitle}</title>
  <style>${renderExportStyles(styleOptions)}</style>
</head>
<body>
${bodyHtml}
</body>
</html>`;
}

function pageMayContainEquation(page: NotebookPage) {
  return /data-athenaeum-block\s*=\s*["']equation["']/i.test(page.content) || /data-equation-source\s*=\s*["']true["']/i.test(page.content);
}

async function loadEquationRendererIfNeeded(pages: NotebookPage[]): Promise<NotebookEquationStaticRenderer | undefined> {
  if (!pages.some(pageMayContainEquation)) {
    return undefined;
  }

  const { renderNotebookEquationStaticHtml } = await import("./notebookExportKatex");
  return renderNotebookEquationStaticHtml;
}

async function loadKatexStylesIfNeeded(hasRenderedEquation: boolean) {
  if (!hasRenderedEquation) {
    return "";
  }

  const { resolveNotebookExportKatexStyles } = await import("./notebookExportKatex");
  return resolveNotebookExportKatexStyles(true);
}

export async function buildNotebookExportHtml(input: BuildNotebookExportHtmlInput): Promise<NotebookExportBuildResult> {
  if (input.pages.length === 0) {
    throw new Error("Nao ha paginas para exportar.");
  }

  const createdAtDate = input.createdAt ?? new Date();
  const createdAt = formatIsoDate(createdAtDate);
  const nonce = normalizeNonce(input.nonce ?? createNonce());
  const targetDocument = document.implementation.createHTMLDocument("Athenaeum export");
  const slots: NotebookExportManifestSlot[] = [];
  const warnings: NotebookExportWarning[] = [];
  const styleRequirements = { hasRenderedEquation: false };
  const equationRenderer = await loadEquationRendererIfNeeded(input.pages);
  const sanitizedPages = input.pages.map((page) => {
    const pageContext: SanitizationContext = {
      targetDocument,
      nonce,
      pageId: page.id,
      slots,
      warnings,
      diagramOccurrence: 0,
      equationRenderer,
      styleRequirements,
    };

    return {
      page,
      html: sanitizePageContent(page, pageContext),
    };
  });
  const pageIds = input.pages.map((page) => page.id);
  const manifest: NotebookExportManifest = {
    version: 1,
    nonce,
    notebookId: input.notebookId,
    notebookTitle: input.notebookTitle,
    scope: input.scope,
    pageIds,
    createdAt,
    slots,
  };
  const bodyHtml = `<main class="athenaeum-export">
  <header>
    <h1 class="athenaeum-export__title">${escapeHtml(input.notebookTitle)}</h1>
    <p class="athenaeum-export__meta">Exportado em ${escapeHtml(formatNotebookExportDisplayDate(createdAtDate))}</p>
  </header>
  ${sanitizedPages
    .map(
      ({ page, html }) => `<section class="athenaeum-export__page" data-athenaeum-page-id="${page.id}">
    <h2 class="athenaeum-export__page-title">${escapeHtml(pageDisplayTitle(page))}</h2>
    ${html}
  </section>`,
    )
    .join("\n")}
</main>`;
  const [katexStyles, fontFaceStyles] = await Promise.all([
    loadKatexStylesIfNeeded(styleRequirements.hasRenderedEquation),
    loadNotebookExportLoraFontFaceCss(),
  ]);
  const html = renderExportHtmlDocument(input.notebookTitle, bodyHtml, { katexStyles, fontFaceStyles });
  const validation = validateNotebookExportManifestSlots(html, manifest);

  validation.errors.forEach((message) => {
    warnings.push({
      code: "manifest-mismatch",
      pageId: input.pages[0].id,
      message,
    });
  });

  return {
    html,
    manifest,
    warnings,
  };
}
