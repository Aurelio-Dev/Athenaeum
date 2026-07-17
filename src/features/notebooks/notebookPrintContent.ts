import { sanitizeHtmlFragment, type HtmlElementDisposition } from "../../lib/htmlSanitizer";
import { isCalloutType, isDiagramKind } from "./notebookEditorUtils";

const allowedElements = new Set([
  "a",
  "aside",
  "b",
  "blockquote",
  "br",
  "code",
  "del",
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
  "img",
  "li",
  "mark",
  "ol",
  "p",
  "pre",
  "s",
  "section",
  "small",
  "span",
  "strike",
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

const runtimeOnlyAttributes = [
  "data-diagram-preview",
  "data-equation-preview",
  "data-figure-preview",
  "data-file-attachment-card",
  "data-file-attachment-actions",
] as const;

const allowedTextAlignments = new Set(["left", "center", "right", "justify"]);
const allowedBlockKinds = new Set(["table", "callout", "diagram", "equation", "figure"]);
const numericDataAttributePattern = /^\d{1,4}(?:\.\d{1,2})?$/;
const assetIdPattern = /^[a-zA-Z0-9-]{1,128}$/;

function isRuntimeOnlyElement(element: Element) {
  return runtimeOnlyAttributes.some((attribute) => element.getAttribute(attribute) === "true") ||
    element.hasAttribute("data-file-attachment-action") ||
    element.classList.contains("notebook-diagram-resize-handle") ||
    element.classList.contains("notebook-image-resize-handle");
}

function hasSafeAssetId(element: Element) {
  const assetId = element.getAttribute("data-notebook-asset-id")?.trim() ?? "";
  return assetIdPattern.test(assetId);
}

function getElementDisposition(element: Element): HtmlElementDisposition | null {
  if (isRuntimeOnlyElement(element)) {
    return "discard";
  }

  if (
    element.tagName.toLowerCase() === "figure" &&
    element.getAttribute("data-athenaeum-block") === "file-attachment"
  ) {
    return "discard";
  }

  if (element.tagName.toLowerCase() === "img" && !hasSafeAssetId(element)) {
    return "discard";
  }

  return null;
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

function sanitizeStyle(element: Element, value: string) {
  const safeDeclarations: string[] = [];

  for (const declaration of value.split(";")) {
    const separatorIndex = declaration.indexOf(":");
    if (separatorIndex < 0) {
      continue;
    }

    const property = declaration.slice(0, separatorIndex).trim().toLowerCase();
    const propertyValue = declaration.slice(separatorIndex + 1).trim().toLowerCase();
    if (property === "text-align" && allowedTextAlignments.has(propertyValue)) {
      safeDeclarations.push(`text-align: ${propertyValue}`);
    } else if (element.tagName.toLowerCase() === "code" && property === "display" && propertyValue === "block") {
      safeDeclarations.push("display: block");
    }
  }

  return safeDeclarations.length > 0 ? safeDeclarations.join("; ") : null;
}

function sanitizeDataAttribute(name: string, value: string) {
  if (name === "data-athenaeum-block") {
    return allowedBlockKinds.has(value) ? value : null;
  }

  if (name === "data-callout-type") {
    return isCalloutType(value) ? value : null;
  }

  if (name === "data-diagram-kind") {
    return isDiagramKind(value) ? value : null;
  }

  if (name === "data-figure-subtype") {
    return value === "image" || value === "diagram" || value === "graph-diagram" || value === "flowchart"
      ? value
      : null;
  }

  if (name === "data-notebook-asset-id") {
    return assetIdPattern.test(value) ? value : null;
  }

  if (
    name === "data-callout-content" ||
    name === "data-callout-icon" ||
    name === "data-diagram-source" ||
    name === "data-equation-source"
  ) {
    return value === "true" ? value : null;
  }

  if (
    name === "data-diagram-scale" ||
    name === "data-equation-scale" ||
    name === "data-figure-scale" ||
    name === "data-figure-width" ||
    name === "data-figure-height"
  ) {
    return numericDataAttributePattern.test(value) ? value : null;
  }

  return null;
}

function sanitizeAttribute(element: Element, attribute: Attr) {
  const name = attribute.name.toLowerCase();
  const value = attribute.value.trim();

  if (name === "style") {
    return sanitizeStyle(element, value);
  }

  if (name.startsWith("data-")) {
    return sanitizeDataAttribute(name, value);
  }

  if (name === "href" && element.tagName.toLowerCase() === "a") {
    return isSafeHref(value) ? value : null;
  }

  if (name === "align") {
    const alignment = value.toLowerCase();
    return allowedTextAlignments.has(alignment) ? alignment : null;
  }

  if (name === "title" || name === "alt" || name === "aria-label" || name === "role") {
    return value;
  }

  if ((name === "colspan" || name === "rowspan") && /^\d{1,2}$/.test(value)) {
    return value;
  }

  if (name === "scope" && (value === "col" || value === "row")) {
    return value;
  }

  return null;
}

export function sanitizeNotebookPrintContent(rawHtml: string) {
  return sanitizeHtmlFragment(rawHtml, {
    allowedElements,
    // A impressão segue a mesma decisão conservadora das Notas: tags não
    // reconhecidas perdem a casca, não o texto que o usuário escreveu.
    defaultElementDisposition: "unwrap",
    getElementDisposition,
    sanitizeAttribute,
  });
}
