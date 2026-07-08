import type { NotebookPage } from "../../types/library";
import type { NotebookEquationStaticRenderResult } from "./notebookExportKatex";
import { renderNotebookDiagramStaticSvg } from "./notebookDiagramStaticSvg";

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
  "data-equation-source",
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
    element.getAttribute("data-file-attachment-actions") === "true"
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
  figure.setAttribute("data-athenaeum-block", "diagram");
  figure.setAttribute("data-diagram-kind", renderedDiagram.kind);
  if (renderedDiagram.scalePercent === 100) {
    figure.removeAttribute("data-diagram-scale");
  } else {
    figure.setAttribute("data-diagram-scale", String(renderedDiagram.scalePercent));
  }
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
  figure.appendChild(staticContent);

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

  return `
    :root {
      color-scheme: light;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #ffffff;
      color: #1f1a17;
    }
    body {
      margin: 0;
      background: #ffffff;
    }
    .athenaeum-export {
      box-sizing: border-box;
      max-width: 860px;
      margin: 0 auto;
      padding: 48px 32px 64px;
    }
    .athenaeum-export__title {
      margin: 0 0 8px;
      font-size: 2rem;
      line-height: 1.2;
    }
    .athenaeum-export__meta {
      margin: 0 0 32px;
      color: #6b625c;
      font-size: 0.9rem;
    }
    .athenaeum-export__page {
      margin: 0 0 48px;
      padding-top: 8px;
      border-top: 1px solid #e4dbd3;
    }
    .athenaeum-export__page-title {
      margin: 0 0 24px;
      font-size: 1.35rem;
      line-height: 1.3;
    }
    figure {
      margin: 1.25rem 0;
    }
    figcaption {
      margin-top: 0.5rem;
      color: #6b625c;
      font-size: 0.9rem;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 1rem 0;
    }
    td, th {
      border: 1px solid #d8cdc2;
      padding: 0.5rem;
      vertical-align: top;
    }
    [data-athenaeum-block="callout"] {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 0.75rem;
      border: 1px solid #d8cdc2;
      border-radius: 0.5rem;
      padding: 0.9rem;
      background: #fbf7f2;
    }
    ${katexStyles ? `${katexStyles}\n` : ""}
    .athenaeum-export__equation {
      margin: 1rem 0;
      overflow-x: auto;
    }
    .athenaeum-export__equation-static {
      max-width: 100%;
      overflow-x: auto;
    }
    .athenaeum-export__equation-rendered .katex-display {
      margin: 0.35rem 0;
    }
    .athenaeum-export__equation-fallback {
      display: grid;
      gap: 0.45rem;
      color: #6b625c;
      font-size: 0.92rem;
    }
    .athenaeum-export__equation-fallback strong {
      color: #1f1a17;
    }
    .athenaeum-export__equation-source {
      display: block;
      margin-top: 0.15rem;
      white-space: pre-wrap;
      color: #4f4740;
      font-family: "IBM Plex Mono", Consolas, monospace;
      font-size: 0.82rem;
    }
    .athenaeum-export__diagram {
      width: min(100%, 52rem);
      max-width: 100%;
      margin: 0.35rem auto;
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
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 12.25px;
      letter-spacing: 0;
    }
    .notebook-graph-cycle-vertex-label {
      font-family: Georgia, "Times New Roman", serif;
      font-size: 11.75px;
    }
    .athenaeum-export__diagram-fallback {
      display: grid;
      gap: 0.45rem;
      color: #6b625c;
      font-size: 0.92rem;
    }
    .athenaeum-export__diagram-fallback strong {
      color: #1f1a17;
    }
    .athenaeum-export__diagram-source {
      margin: 0.25rem 0 0;
      white-space: pre-wrap;
      color: #4f4740;
      font-family: "IBM Plex Mono", Consolas, monospace;
      font-size: 0.82rem;
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

  const createdAt = formatIsoDate(input.createdAt ?? new Date());
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
    <p class="athenaeum-export__meta">Exportado em ${escapeHtml(createdAt)}</p>
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
  const katexStyles = await loadKatexStylesIfNeeded(styleRequirements.hasRenderedEquation);
  const html = renderExportHtmlDocument(input.notebookTitle, bodyHtml, { katexStyles });
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
