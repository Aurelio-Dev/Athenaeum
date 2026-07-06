import {
  diagramDefaultSources,
  diagramEmptyPreviews,
  diagramKindFromFigureSubtype,
  diagramKindLabels,
  isDiagramKind,
  type DiagramKind,
  type FigureSubtype,
} from "./notebookEditorUtils";

export function getDiagramKind(diagram: HTMLElement): DiagramKind {
  return isDiagramKind(diagram.dataset.diagramKind) ? diagram.dataset.diagramKind : "diagram";
}

export function findClosestDiagram(node: Node | null, editor: HTMLElement): HTMLElement | null {
  const element = node instanceof Element ? node : node?.parentElement;
  const diagram = element?.closest('[data-athenaeum-block="diagram"]');

  return diagram instanceof HTMLElement && editor.contains(diagram) ? diagram : null;
}

export function getDiagramSource(diagram: HTMLElement): HTMLElement | null {
  return diagram.querySelector<HTMLElement>('[data-diagram-source="true"]');
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

export function renderDiagramPreview(diagram: HTMLElement) {
  const kind = getDiagramKind(diagram);
  const source = getDiagramSource(diagram);
  const preview = diagram.querySelector<HTMLElement>('[data-diagram-preview="true"]');

  if (!source || !preview) {
    return;
  }

  const sourceText = (source.textContent ?? "").trim();
  preview.contentEditable = "false";

  const label = document.createElement("strong");
  label.textContent = diagramKindLabels[kind];

  const body = document.createElement("span");
  body.textContent = sourceText || diagramEmptyPreviews[kind];

  preview.replaceChildren(label, body);
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

    let source = diagram.querySelector<HTMLElement>(':scope > [data-diagram-source="true"]');
    if (!source) {
      source = createDiagramSourceElement(diagram.textContent ?? "");
      diagram.appendChild(source);
    }
    source.spellcheck = false;
    source.setAttribute("spellcheck", "false");

    if (sourceContainsMarkup(source)) {
      source.textContent = source.textContent ?? "";
    }

    renderDiagramPreview(diagram);
  });
}
