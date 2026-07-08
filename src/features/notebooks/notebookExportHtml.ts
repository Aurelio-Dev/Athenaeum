import type { NotebookPage } from "../../types/library";

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

function renderExportStyles() {
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
  `;
}

function renderExportHtmlDocument(title: string, bodyHtml: string) {
  const escapedTitle = escapeHtml(title);

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; object-src 'none'; base-uri 'none'; form-action 'none'; connect-src 'none'">
  <title>${escapedTitle}</title>
  <style>${renderExportStyles()}</style>
</head>
<body>
${bodyHtml}
</body>
</html>`;
}

export function buildNotebookExportHtml(input: BuildNotebookExportHtmlInput): NotebookExportBuildResult {
  if (input.pages.length === 0) {
    throw new Error("Nao ha paginas para exportar.");
  }

  const createdAt = formatIsoDate(input.createdAt ?? new Date());
  const nonce = normalizeNonce(input.nonce ?? createNonce());
  const targetDocument = document.implementation.createHTMLDocument("Athenaeum export");
  const slots: NotebookExportManifestSlot[] = [];
  const warnings: NotebookExportWarning[] = [];
  const sanitizedPages = input.pages.map((page) => {
    const pageContext: SanitizationContext = {
      targetDocument,
      nonce,
      pageId: page.id,
      slots,
      warnings,
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
  const html = renderExportHtmlDocument(input.notebookTitle, bodyHtml);
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
