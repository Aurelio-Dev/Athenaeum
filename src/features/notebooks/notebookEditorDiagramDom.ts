import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

import { NotebookDiagramPreview } from "./NotebookDiagramPreview";
import { parseDiagramSource } from "./notebookDiagramParser";
import {
  diagramDefaultSources,
  diagramEmptyPreviews,
  diagramKindFromFigureSubtype,
  diagramKindLabels,
  isDiagramKind,
  type DiagramKind,
  type FigureSubtype,
} from "./notebookEditorUtils";

type DiagramPreviewRoot = {
  host: HTMLDivElement;
  root: Root;
};

const visualPreviewRoots = new WeakMap<HTMLElement, DiagramPreviewRoot>();

export function getDiagramKind(diagram: HTMLElement): DiagramKind {
  return isDiagramKind(diagram.dataset.diagramKind) ? diagram.dataset.diagramKind : "diagram";
}

export function findClosestDiagram(node: Node | null, editor: HTMLElement): HTMLElement | null {
  const element = node instanceof Element ? node : node?.parentElement;
  const diagram = element?.closest('[data-athenaeum-block="diagram"]');

  return diagram instanceof HTMLElement && editor.contains(diagram) ? diagram : null;
}

export function getDiagramSource(diagram: HTMLElement): HTMLElement | null {
  return diagram.querySelector<HTMLElement>(':scope > [data-diagram-source="true"]');
}

export function findClosestDiagramSource(node: Node | null, diagram: HTMLElement): HTMLElement | null {
  const element = node instanceof Element ? node : node?.parentElement;
  const source = element?.closest('[data-diagram-source="true"]');

  return source instanceof HTMLElement && diagram.contains(source) ? source : null;
}

function createDiagramPreviewElement() {
  const preview = document.createElement("div");
  preview.dataset.diagramPreview = "true";
  preview.contentEditable = "false";
  return preview;
}

function createDiagramSourceElement(sourceText: string) {
  const source = document.createElement("figcaption");
  source.dataset.diagramSource = "true";
  source.spellcheck = false;
  source.setAttribute("spellcheck", "false");
  source.textContent = sourceText;
  return source;
}

function sourceContainsMarkup(source: HTMLElement) {
  return Array.from(source.childNodes).some((child) => child.nodeType !== Node.TEXT_NODE);
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

function normalizeSourceText(sourceText: string) {
  return sourceText
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n");
}

function readDiagramSourceElementText(source: HTMLElement) {
  if (!sourceContainsMarkup(source)) {
    return source.textContent ?? "";
  }

  return Array.from(source.childNodes).map(readDiagramSourceNodeText).join("");
}

function readDiagramSourceText(sources: HTMLElement[]) {
  return normalizeSourceText(
    sources
      .map(readDiagramSourceElementText)
      .map((sourceText) => sourceText.trim())
      .filter(Boolean)
      .join("\n"),
  ).trim();
}

function getDirectDiagramSources(diagram: HTMLElement) {
  return Array.from(diagram.querySelectorAll<HTMLElement>(':scope > [data-diagram-source="true"]'));
}

function normalizeDiagramSourceElements(diagram: HTMLElement) {
  const sources = getDirectDiagramSources(diagram);
  const [primarySource, ...duplicateSources] = sources;
  const source = primarySource ?? createDiagramSourceElement(diagram.textContent ?? "");
  const sourceHasMarkup = sources.some(sourceContainsMarkup);
  const shouldRewriteSource = sources.length === 0 || duplicateSources.length > 0 || sourceHasMarkup;
  const sourceText = sources.length > 0 ? readDiagramSourceText(sources) : source.textContent ?? "";

  if (!primarySource) {
    diagram.appendChild(source);
  }

  source.spellcheck = false;
  source.setAttribute("spellcheck", "false");
  if (shouldRewriteSource && source.textContent !== sourceText) {
    source.textContent = sourceText;
  }
  duplicateSources.forEach((duplicateSource) => duplicateSource.remove());

  return source;
}

function unmountVisualPreview(preview: HTMLElement) {
  const mountedPreview = visualPreviewRoots.get(preview);
  if (!mountedPreview) {
    return;
  }

  mountedPreview.root.unmount();
  visualPreviewRoots.delete(preview);
}

function renderTextDiagramPreview(preview: HTMLElement, labelText: string, bodyText: string) {
  unmountVisualPreview(preview);

  const label = document.createElement("strong");
  label.textContent = labelText;

  const body = document.createElement("span");
  body.textContent = bodyText;

  preview.replaceChildren(label, body);
}

function renderVisualDiagramPreview(preview: HTMLElement, sourceText: string) {
  const parsedDiagram = parseDiagramSource(sourceText);
  if (parsedDiagram.edges.length === 0 || !document.body.contains(preview)) {
    return false;
  }

  const label = document.createElement("strong");
  label.textContent = diagramKindLabels.diagram;

  const mountedPreview = visualPreviewRoots.get(preview);
  const host = mountedPreview?.host.parentElement === preview ? mountedPreview.host : document.createElement("div");
  let root = mountedPreview?.host.parentElement === preview ? mountedPreview.root : null;

  if (!root) {
    unmountVisualPreview(preview);
    root = createRoot(host);
    visualPreviewRoots.set(preview, { host, root });
  }

  preview.replaceChildren(label, host);
  root.render(createElement(NotebookDiagramPreview, { diagram: parsedDiagram }));
  return true;
}

export function renderDiagramPreview(diagram: HTMLElement) {
  const kind = getDiagramKind(diagram);
  const sources = getDirectDiagramSources(diagram);
  const preview = diagram.querySelector<HTMLElement>('[data-diagram-preview="true"]');

  if (sources.length === 0 || !preview) {
    return;
  }

  const sourceText = readDiagramSourceText(sources);
  preview.contentEditable = "false";

  if (kind === "diagram" && renderVisualDiagramPreview(preview, sourceText)) {
    return;
  }

  renderTextDiagramPreview(preview, diagramKindLabels[kind], sourceText || diagramEmptyPreviews[kind]);
}

export function setDiagramKind(diagram: HTMLElement, kind: DiagramKind) {
  diagram.dataset.diagramKind = kind;
  renderDiagramPreview(diagram);
}

function normalizeLegacyDiagramFigures(editor: HTMLElement) {
  const legacySelector = [
    '[data-athenaeum-block="figure"][data-figure-subtype="diagram"]',
    '[data-athenaeum-block="figure"][data-figure-subtype="graph-diagram"]',
    '[data-athenaeum-block="figure"][data-figure-subtype="flowchart"]',
  ].join(",");

  editor.querySelectorAll<HTMLElement>(legacySelector).forEach((figure) => {
    const subtype = figure.dataset.figureSubtype as FigureSubtype | undefined;
    const kind = subtype ? diagramKindFromFigureSubtype(subtype) : null;
    if (!kind) {
      return;
    }

    const sourceText = (figure.querySelector("figcaption")?.textContent ?? "").trim() || diagramDefaultSources[kind];
    figure.dataset.athenaeumBlock = "diagram";
    figure.dataset.diagramKind = kind;
    delete figure.dataset.figureSubtype;
    figure.replaceChildren(createDiagramPreviewElement(), createDiagramSourceElement(sourceText));
    renderDiagramPreview(figure);
  });
}

export function normalizeDiagrams(editor: HTMLElement) {
  normalizeLegacyDiagramFigures(editor);

  editor.querySelectorAll<HTMLElement>('[data-athenaeum-block="diagram"]').forEach((diagram) => {
    if (diagram.tagName.toLowerCase() !== "figure") {
      const sourceText = (diagram.textContent ?? "").trim();
      const nextDiagram = document.createElement("figure");
      nextDiagram.dataset.athenaeumBlock = "diagram";
      nextDiagram.dataset.diagramKind = "diagram";
      nextDiagram.append(createDiagramPreviewElement(), createDiagramSourceElement(sourceText || diagramDefaultSources.diagram));
      diagram.replaceWith(nextDiagram);
      renderDiagramPreview(nextDiagram);
      return;
    }

    const kind = getDiagramKind(diagram);
    diagram.dataset.diagramKind = kind;

    let preview = diagram.querySelector<HTMLElement>(':scope > [data-diagram-preview="true"]');
    if (!preview) {
      preview = createDiagramPreviewElement();
      diagram.prepend(preview);
    }
    preview.contentEditable = "false";

    normalizeDiagramSourceElements(diagram);

    renderDiagramPreview(diagram);
  });
}
