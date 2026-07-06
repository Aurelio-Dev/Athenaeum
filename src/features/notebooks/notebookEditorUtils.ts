export type FigureSubtype = "image" | "diagram" | "graph-diagram" | "flowchart";
export type DiagramKind = "diagram" | "graph" | "flowchart";
export type CalloutType = "info" | "tip" | "warning" | "danger";
export type FileAttachmentAction = "open" | "reveal" | "delete";

export type AttachmentMetaInput = {
  mimeType: string | null;
  originalName: string;
  fileSize: number;
};

export const figureSubtypeLabels: Record<FigureSubtype, string> = {
  image: "Imagem",
  diagram: "Diagrama",
  "graph-diagram": "Diagrama de grafo",
  flowchart: "Fluxograma",
};

export const diagramKindLabels: Record<DiagramKind, string> = {
  diagram: "Diagrama",
  graph: "Grafo",
  flowchart: "Fluxograma",
};

export const diagramDefaultSources: Record<DiagramKind, string> = {
  diagram: "Elemento A -> Elemento B",
  graph: "A -- B\nB -- C",
  flowchart: "Início -> Processo -> Fim",
};

export const diagramEmptyPreviews: Record<DiagramKind, string> = {
  diagram: "Descreva a estrutura do diagrama.",
  graph: "Descreva vértices e conexões.",
  flowchart: "Descreva as etapas do fluxo.",
};

export const calloutLabels: Record<CalloutType, string> = {
  info: "Info",
  tip: "Dica",
  warning: "Atenção",
  danger: "Perigo",
};

export const calloutIcons: Record<CalloutType, string> = {
  info: "i",
  tip: "+",
  warning: "!",
  danger: "x",
};

export const supportedNotebookImageMimeTypes: ReadonlySet<string> = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);
export const supportedNotebookImageAccept = Array.from(supportedNotebookImageMimeTypes).join(",");

export const notebookRichContentSelector = [
  "img[data-notebook-asset-id]",
  'table[data-athenaeum-block="table"]',
  '[data-athenaeum-block="callout"]',
  '[data-athenaeum-block="diagram"]',
  '[data-athenaeum-block="equation"]',
  '[data-athenaeum-block="figure"]',
  '[data-athenaeum-block="file-attachment"]',
].join(",");

export function isFileAttachmentAction(value: string | undefined): value is FileAttachmentAction {
  return value === "open" || value === "reveal" || value === "delete";
}

export function isDiagramKind(value: string | undefined): value is DiagramKind {
  return value === "diagram" || value === "graph" || value === "flowchart";
}

export function diagramKindFromFigureSubtype(subtype: FigureSubtype): DiagramKind | null {
  if (subtype === "diagram" || subtype === "flowchart") {
    return subtype;
  }

  if (subtype === "graph-diagram") {
    return "graph";
  }

  return null;
}

export function isCalloutType(value: string | undefined): value is CalloutType {
  return value === "info" || value === "tip" || value === "warning" || value === "danger";
}

export function formatAttachmentFileSize(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }

  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function getFileExtension(fileName: string) {
  const extension = fileName.split(".").pop();
  return extension && extension !== fileName ? extension.toUpperCase() : "";
}

export function formatAttachmentType(mimeType: string | null, fileName: string) {
  if (mimeType) {
    const subtype = mimeType.split("/")[1]?.split(";")[0];
    if (subtype) {
      return subtype.toUpperCase();
    }
  }

  return getFileExtension(fileName) || "Arquivo";
}

export function formatAttachmentMeta(attachment: AttachmentMetaInput) {
  return `${formatAttachmentType(attachment.mimeType, attachment.originalName)} · ${formatAttachmentFileSize(attachment.fileSize)}`;
}
