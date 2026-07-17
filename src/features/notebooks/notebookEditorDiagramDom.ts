import { createElement, useEffect, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";

import { NotebookDiagramPreview } from "./NotebookDiagramPreview";
import { NotebookFlowchartPreview } from "./NotebookFlowchartPreview";
import { NotebookGraphPreview } from "./NotebookGraphPreview";
import { parseDiagramSource, parseGraphSource, type ParsedDiagram, type ParsedGraph } from "./notebookDiagramParser";
import {
  applyDiagramScale,
  clampDiagramScale,
  legacyDiagramWidthCssVariable,
  parseDiagramScale,
  parseLegacyDiagramWidthPercent,
} from "./notebookDiagramScale";

export { clearDiagramScaleRuntimeStyles } from "./notebookDiagramScale";
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

type DiagramReadySignalProps = {
  children?: ReactElement;
  onReady?: () => void;
};

const visualPreviewRoots = new WeakMap<HTMLElement, DiagramPreviewRoot>();
const diagramEmptyPreviewMessage = "Digite relações no formato: Entrada -> Processamento";
const diagramInvalidPreviewMessage = "Nenhuma relação válida encontrada. Use o formato: A -> B";
const diagramSyntaxExample = "Entrada -> Processamento\nProcessamento -> Saída";

function DiagramReadySignal({ children, onReady }: DiagramReadySignalProps) {
  useEffect(() => {
    onReady?.();
  }, [onReady]);

  return children ?? null;
}

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

// A decisao pura de teclado do Enter no diagrama vive num modulo isolado sem
// DOM/React (testavel em Node); reexportada aqui para o editor.
export {
  resolveDiagramSourceEnterAction,
  type DiagramSourceEnterAction,
  type DiagramSourceEnterInput,
} from "./notebookDiagramSourceKeyboard";

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

function renderDiagramGuidancePreview(preview: HTMLElement, labelText: string, messageText: string) {
  unmountVisualPreview(preview);

  const label = document.createElement("strong");
  label.textContent = labelText;

  const message = document.createElement("span");
  message.className = "notebook-diagram-guidance-message";
  message.textContent = messageText;

  const example = document.createElement("code");
  example.className = "notebook-diagram-guidance-example";
  example.textContent = diagramSyntaxExample;

  preview.replaceChildren(label, message, example);
}

function renderReactDiagramPreview(
  preview: HTMLElement,
  labelText: string,
  visualElement: ReactElement,
  onReady?: () => void,
) {
  if (!document.body.contains(preview)) {
    return false;
  }

  const label = document.createElement("strong");
  label.textContent = labelText;

  const mountedPreview = visualPreviewRoots.get(preview);
  const host = mountedPreview?.host.parentElement === preview ? mountedPreview.host : document.createElement("div");
  let root = mountedPreview?.host.parentElement === preview ? mountedPreview.root : null;

  if (!root) {
    unmountVisualPreview(preview);
    root = createRoot(host);
    visualPreviewRoots.set(preview, { host, root });
  }

  preview.replaceChildren(label, host);
  root.render(createElement(DiagramReadySignal, { onReady }, visualElement));
  return true;
}

function renderVisualDiagramPreview(preview: HTMLElement, parsedDiagram: ParsedDiagram, onReady?: () => void) {
  return renderReactDiagramPreview(
    preview,
    diagramKindLabels.diagram,
    createElement(NotebookDiagramPreview, { diagram: parsedDiagram }),
    onReady,
  );
}

function renderVisualFlowchartPreview(preview: HTMLElement, parsedDiagram: ParsedDiagram, onReady?: () => void) {
  return renderReactDiagramPreview(
    preview,
    diagramKindLabels.flowchart,
    createElement(NotebookFlowchartPreview, { flowchart: parsedDiagram }),
    onReady,
  );
}

function renderVisualGraphPreview(preview: HTMLElement, parsedGraph: ParsedGraph, onReady?: () => void) {
  return renderReactDiagramPreview(
    preview,
    diagramKindLabels.graph,
    createElement(NotebookGraphPreview, { graph: parsedGraph }),
    onReady,
  );
}

export function renderDiagramPreview(diagram: HTMLElement, onReady?: () => void) {
  const kind = getDiagramKind(diagram);
  const sources = getDirectDiagramSources(diagram);
  const preview = diagram.querySelector<HTMLElement>('[data-diagram-preview="true"]');

  if (sources.length === 0 || !preview) {
    onReady?.();
    return;
  }

  const sourceText = readDiagramSourceText(sources);
  preview.contentEditable = "false";

  if (kind === "diagram") {
    const parsedDiagram = parseDiagramSource(sourceText);

    if (parsedDiagram.edges.length > 0) {
      if (renderVisualDiagramPreview(preview, parsedDiagram, onReady)) {
        return;
      }

      renderTextDiagramPreview(preview, diagramKindLabels.diagram, sourceText);
      onReady?.();
      return;
    }

    renderDiagramGuidancePreview(
      preview,
      diagramKindLabels.diagram,
      sourceText.length === 0 ? diagramEmptyPreviewMessage : diagramInvalidPreviewMessage,
    );
    onReady?.();
    return;
  }

  if (kind === "graph") {
    const parsedGraph = parseGraphSource(sourceText);

    if (parsedGraph.edges.length > 0) {
      if (renderVisualGraphPreview(preview, parsedGraph, onReady)) {
        return;
      }

      renderTextDiagramPreview(preview, diagramKindLabels.graph, sourceText);
      onReady?.();
      return;
    }

    renderTextDiagramPreview(preview, diagramKindLabels.graph, sourceText || diagramEmptyPreviews.graph);
    onReady?.();
    return;
  }

  if (kind === "flowchart") {
    const parsedDiagram = parseDiagramSource(sourceText);

    if (parsedDiagram.edges.length > 0) {
      if (renderVisualFlowchartPreview(preview, parsedDiagram, onReady)) {
        return;
      }

      renderTextDiagramPreview(preview, diagramKindLabels.flowchart, sourceText);
      onReady?.();
      return;
    }

    renderTextDiagramPreview(preview, diagramKindLabels.flowchart, sourceText || diagramEmptyPreviews.flowchart);
    onReady?.();
    return;
  }

  renderTextDiagramPreview(preview, diagramKindLabels[kind], sourceText || diagramEmptyPreviews[kind]);
  onReady?.();
}

export function setDiagramKind(diagram: HTMLElement, kind: DiagramKind) {
  diagram.dataset.diagramKind = kind;
  renderDiagramPreview(diagram);
}

export function clearDiagramPreviews(editor: HTMLElement) {
  editor.querySelectorAll<HTMLElement>('[data-diagram-preview="true"]').forEach((preview) => {
    unmountVisualPreview(preview);
    preview.replaceChildren();
  });
}

// Escala manual: valida data-diagram-scale (inválidos e 100 são removidos) e
// migra o atributo legado data-diagram-width (Macrofase 8, nunca lançado com
// compatibilidade externa) para uma escala inicial aproximada — largura NN%
// vira escala NN% com clamp para o intervalo 50..160, uma única vez; depois
// disso só data-diagram-scale existe.
function normalizeDiagramScale(diagram: HTMLElement) {
  const scale = parseDiagramScale(diagram.dataset.diagramScale);
  const legacyWidth = parseLegacyDiagramWidthPercent(diagram.dataset.diagramWidth);
  const resolvedScale = scale ?? (legacyWidth !== null ? clampDiagramScale(legacyWidth) : null);

  delete diagram.dataset.diagramWidth;
  diagram.style.removeProperty(legacyDiagramWidthCssVariable);
  if (!diagram.getAttribute("style")) {
    diagram.removeAttribute("style");
  }

  applyDiagramScale(diagram, resolvedScale);
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

export function normalizeDiagrams(editor: HTMLElement, onPreviewReady?: (diagram: HTMLElement) => void) {
  normalizeLegacyDiagramFigures(editor);

  editor.querySelectorAll<HTMLElement>('[data-athenaeum-block="diagram"]').forEach((diagram) => {
    if (diagram.tagName.toLowerCase() !== "figure") {
      const sourceText = (diagram.textContent ?? "").trim();
      const nextDiagram = document.createElement("figure");
      nextDiagram.dataset.athenaeumBlock = "diagram";
      nextDiagram.dataset.diagramKind = "diagram";
      nextDiagram.append(createDiagramPreviewElement(), createDiagramSourceElement(sourceText || diagramDefaultSources.diagram));
      diagram.replaceWith(nextDiagram);
      renderDiagramPreview(nextDiagram, () => onPreviewReady?.(nextDiagram));
      return;
    }

    const kind = getDiagramKind(diagram);
    diagram.dataset.diagramKind = kind;

    normalizeDiagramScale(diagram);

    let preview = diagram.querySelector<HTMLElement>(':scope > [data-diagram-preview="true"]');
    if (!preview) {
      preview = createDiagramPreviewElement();
      diagram.prepend(preview);
    }
    preview.contentEditable = "false";

    normalizeDiagramSourceElements(diagram);

    renderDiagramPreview(diagram, () => onPreviewReady?.(diagram));
  });
}
