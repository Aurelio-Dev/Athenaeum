import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

import { NotebookFigureImagePreview } from "./NotebookFigureImagePreview";
import { applyFigureScale, parseFigureScale } from "./notebookDiagramScale";
import { setSanitizedFigureDimensionAttributes } from "./notebookFigureDimensions";

type NotebookAssetImageData = {
  id: string;
  mimeType: string;
  dataBase64: string;
};

type FigurePreviewRoot = {
  host: HTMLDivElement;
  root: Root;
};

const notebookAssetImageSelector = "img[data-notebook-asset-id]";
const imageFigureSelector = '[data-athenaeum-block="figure"][data-figure-subtype="image"]';
const figurePreviewSelector = '[data-figure-preview="true"]';
const figurePreviewRoots = new WeakMap<HTMLElement, FigurePreviewRoot>();

function getDirectAssetImage(figure: HTMLElement): HTMLImageElement | null {
  const image = figure.querySelector<HTMLImageElement>(`:scope > ${notebookAssetImageSelector}`);
  return image;
}

function createFigurePreviewElement() {
  const preview = document.createElement("div");
  preview.dataset.figurePreview = "true";
  preview.contentEditable = "false";
  return preview;
}

function unmountFigurePreview(preview: HTMLElement) {
  const mountedPreview = figurePreviewRoots.get(preview);
  if (!mountedPreview) {
    return;
  }

  mountedPreview.root.unmount();
  figurePreviewRoots.delete(preview);
}

function ensureFigurePreviewElement(figure: HTMLElement, image: HTMLImageElement) {
  const previews = Array.from(figure.querySelectorAll<HTMLElement>(`:scope > ${figurePreviewSelector}`));
  const [primaryPreview, ...duplicatePreviews] = previews;
  const preview = primaryPreview ?? createFigurePreviewElement();

  duplicatePreviews.forEach((duplicatePreview) => {
    unmountFigurePreview(duplicatePreview);
    duplicatePreview.remove();
  });

  preview.contentEditable = "false";
  if (preview.parentElement !== figure || preview.nextElementSibling !== image) {
    figure.insertBefore(preview, image);
  }

  return preview;
}

function renderFigurePreview(figure: HTMLElement, preview: HTMLElement, image: HTMLImageElement) {
  const src = image.getAttribute("src");
  if (!src) {
    unmountFigurePreview(preview);
    preview.replaceChildren();
    return;
  }

  if (!document.body.contains(preview)) {
    return;
  }

  const mountedPreview = figurePreviewRoots.get(preview);
  const host = mountedPreview?.host.parentElement === preview ? mountedPreview.host : document.createElement("div");
  let root = mountedPreview?.host.parentElement === preview ? mountedPreview.root : null;

  if (!root) {
    unmountFigurePreview(preview);
    root = createRoot(host);
    figurePreviewRoots.set(preview, { host, root });
  }

  preview.replaceChildren(host);
  root.render(createElement(NotebookFigureImagePreview, { src, alt: image.getAttribute("alt") ?? "" }));
}

function normalizeFigureScale(figure: HTMLElement) {
  applyFigureScale(figure, parseFigureScale(figure.dataset.figureScale));
}

// Mantem apenas o par largura/altura valido (ou remove os dois). Nao adiciona
// dimensoes a figuras que nao as tem, entao nunca reescreve blocos antigos: so
// higieniza valores invalidos que porventura tenham entrado no DOM.
function normalizeFigureDimensions(figure: HTMLElement) {
  setSanitizedFigureDimensionAttributes(figure, figure.dataset.figureWidth, figure.dataset.figureHeight);
}

export function normalizeFigures(editor: HTMLElement) {
  editor.querySelectorAll<HTMLElement>(imageFigureSelector).forEach((figure) => {
    normalizeFigureScale(figure);
    normalizeFigureDimensions(figure);

    const image = getDirectAssetImage(figure);
    if (!image) {
      figure.querySelectorAll<HTMLElement>(`:scope > ${figurePreviewSelector}`).forEach((preview) => {
        unmountFigurePreview(preview);
        preview.remove();
      });
      return;
    }

    const preview = ensureFigurePreviewElement(figure, image);
    renderFigurePreview(figure, preview, image);
  });
}

export function clearFigurePreviews(editor: HTMLElement) {
  editor.querySelectorAll<HTMLElement>(figurePreviewSelector).forEach((preview) => {
    unmountFigurePreview(preview);
    preview.remove();
  });
}

export function removeNotebookAssetImageSources(editor: HTMLElement) {
  clearFigurePreviews(editor);
  editor.querySelectorAll(notebookAssetImageSelector).forEach((image) => {
    image.removeAttribute("src");
  });
}

export function hydrateNotebookAssetImages(editor: HTMLElement, assets: NotebookAssetImageData[]) {
  const assetsById = new Map(assets.map((asset) => [asset.id, asset]));

  editor.querySelectorAll<HTMLImageElement>(notebookAssetImageSelector).forEach((image) => {
    const assetId = image.dataset.notebookAssetId;
    const asset = assetId ? assetsById.get(assetId) : undefined;

    if (!asset) {
      return;
    }

    image.src = `data:${asset.mimeType};base64,${asset.dataBase64}`;
  });

  normalizeFigures(editor);
}
