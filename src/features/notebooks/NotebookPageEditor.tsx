import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { invoke } from "@tauri-apps/api/core";
import katex from "katex";
import {
  deleteNotebookFileAttachment,
  loadNotebookAssets,
  openNotebookFileAttachment,
  revealNotebookFileAttachment,
  saveNotebookAsset,
  saveNotebookFileAttachment,
  type NotebookAssetData,
  type NotebookAssetMetadata,
} from "../../lib/database";
import { findEnclosingTag, insertPlainTextWithLineBreaks, prepareCodeElements, wrapSelectionInCode } from "../reader/richTextShared";
import {
  clearFileAttachmentControls,
  fileAttachmentActionsHtml,
  findFileAttachmentActionFromTarget,
  normalizeFileAttachmentCards,
} from "./notebookEditorAttachmentDom";
import {
  findClosestDiagram,
  getDiagramKind,
  getDiagramSource,
  normalizeDiagrams,
  setDiagramKind,
} from "./notebookEditorDiagramDom";
import {
  AttachmentIcon,
  CalloutIcon,
  ChevronDownIcon,
  CitationIcon,
  EquationIcon,
  FigureIcon,
  LinkIcon,
  MoreIcon,
  PdfToolbarIcon,
  TableIcon,
  blockActions,
  execCommandByAction,
  toolbarButtonGroups,
  type BlockAction,
  type EditorAction,
} from "./notebookEditorToolbar";
import {
  calloutIcons,
  calloutLabels,
  diagramDefaultSources,
  diagramKindFromFigureSubtype,
  diagramKindLabels,
  figureSubtypeLabels,
  formatAttachmentMeta,
  isCalloutType,
  notebookRichContentSelector,
  supportedNotebookImageAccept,
  supportedNotebookImageMimeTypes,
  type CalloutType,
  type DiagramKind,
  type FigureSubtype,
  type FileAttachmentAction,
} from "./notebookEditorUtils";

// Editor block-aware das paginas de caderno. Diferente do editor de Notas do
// leitor (inline-only, Enter = <br>), aqui os blocos nativos do browser sao
// bem-vindos: H1-H3, listas e citacao SAO blocos, entao o Enter padrao
// (novo <div>/<li>) e o comportamento correto. Os helpers de baixo nivel
// (bloco de codigo, busca de ancestral) vem de richTextShared.
type LinkedPdfReference = {
  id: string;
  title: string;
  authors: string[];
  year: number;
};

type TableCellInfo = {
  table: HTMLTableElement;
  row: HTMLTableRowElement;
  cell: HTMLTableCellElement;
  rowIndex: number;
  columnIndex: number;
  rowCount: number;
  columnCount: number;
};

type ActiveTableCellControls = {
  top: number;
  left: number;
  canRemoveRow: boolean;
  canRemoveColumn: boolean;
};

type ActiveCalloutControls = {
  top: number;
  left: number;
  type: CalloutType;
};

type ActiveEquationControls = {
  top: number;
  left: number;
};

type ActiveDiagramControls = {
  top: number;
  left: number;
  kind: DiagramKind;
};

export type NotebookSpacingMode = "compact" | "normal" | "comfortable" | "wide";

export const notebookSpacingOptions: Array<{ value: NotebookSpacingMode; label: string }> = [
  { value: "compact", label: "Compacto" },
  { value: "normal", label: "Normal" },
  { value: "comfortable", label: "Confortável" },
  { value: "wide", label: "Amplo" },
];

const notebookSpacingConfig: Record<NotebookSpacingMode, { lineHeight: number; paragraphGap: string }> = {
  compact: { lineHeight: 1.55, paragraphGap: "1rem" },
  normal: { lineHeight: 1.7, paragraphGap: "1.4rem" },
  comfortable: { lineHeight: 1.85, paragraphGap: "1.8rem" },
  wide: { lineHeight: 2, paragraphGap: "2.2rem" },
};

function getSupportedImageFilesFromClipboard(dataTransfer: DataTransfer): File[] {
  const files = Array.from(dataTransfer.files).filter((file) => supportedNotebookImageMimeTypes.has(file.type));

  if (files.length > 0) {
    return files;
  }

  return Array.from(dataTransfer.items)
    .filter((item) => item.kind === "file" && supportedNotebookImageMimeTypes.has(item.type))
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null);
}

function readFileAsDataBase64(file: File, itemLabel = "imagem do clipboard"): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error(`Resultado inválido ao ler ${itemLabel}.`));
        return;
      }

      const [, base64 = ""] = reader.result.split(",");
      if (!base64) {
        reject(new Error(`${itemLabel} sem conteúdo base64.`));
        return;
      }

      resolve(base64);
    };

    reader.onerror = () => reject(new Error(`Não foi possível ler ${itemLabel}.`));
    reader.readAsDataURL(file);
  });
}

function serializeNotebookEditorHtml(editor: HTMLElement) {
  const clone = editor.cloneNode(true) as HTMLElement;

  clone.querySelectorAll("img[data-notebook-asset-id]").forEach((image) => {
    image.removeAttribute("src");
  });
  normalizeDiagrams(clone);
  normalizeEquations(clone);
  normalizeFileAttachmentCards(clone);
  clearEquationPreviews(clone);
  clearFileAttachmentControls(clone);

  return clone.innerHTML;
}

function notebookEditorHasContent(editor: HTMLElement) {
  return (editor.textContent ?? "").trim().length > 0 || editor.querySelector(notebookRichContentSelector) !== null;
}

function initialNotebookContentIsEmpty(content: string) {
  const template = document.createElement("template");
  template.innerHTML = content;

  return (
    (template.content.textContent ?? "").trim().length === 0 &&
    template.content.querySelector(notebookRichContentSelector) === null
  );
}

function hydrateNotebookAssetImages(editor: HTMLElement, assets: NotebookAssetData[]) {
  const assetsById = new Map(assets.map((asset) => [asset.id, asset]));

  editor.querySelectorAll<HTMLImageElement>("img[data-notebook-asset-id]").forEach((image) => {
    const assetId = image.dataset.notebookAssetId;
    const asset = assetId ? assetsById.get(assetId) : undefined;

    if (!asset) {
      return;
    }

    image.src = `data:${asset.mimeType};base64,${asset.dataBase64}`;
  });
}

function findClosestEquation(node: Node | null, editor: HTMLElement): HTMLElement | null {
  const element = node instanceof Element ? node : node?.parentElement;
  const equation = element?.closest('[data-athenaeum-block="equation"]');

  return equation instanceof HTMLElement && editor.contains(equation) ? equation : null;
}

function getEquationSource(equation: HTMLElement): HTMLElement | null {
  const source = equation.querySelector<HTMLElement>('[data-equation-source="true"]');
  return source;
}

function createEquationPreviewElement() {
  const preview = document.createElement("div");
  preview.dataset.equationPreview = "true";
  preview.contentEditable = "false";
  return preview;
}

function createEquationSourceElement(sourceText: string) {
  const source = document.createElement("figcaption");
  source.dataset.equationSource = "true";
  source.spellcheck = false;
  source.setAttribute("spellcheck", "false");
  source.textContent = sourceText;
  return source;
}

function sourceContainsMarkup(source: HTMLElement) {
  return Array.from(source.childNodes).some((child) => child.nodeType !== Node.TEXT_NODE);
}

function renderEquationPreview(equation: HTMLElement) {
  const source = getEquationSource(equation);
  const preview = equation.querySelector<HTMLElement>('[data-equation-preview="true"]');

  if (!source || !preview) {
    return;
  }

  const sourceText = (source.textContent ?? "").trim();
  preview.contentEditable = "false";

  if (!sourceText) {
    preview.replaceChildren();
    return;
  }

  try {
    katex.render(sourceText, preview, {
      displayMode: true,
      throwOnError: false,
      trust: false,
    });
  } catch (error) {
    console.warn("Nao foi possivel renderizar equacao com KaTeX.", error);
    preview.textContent = sourceText;
  }
}

function clearEquationPreviews(editor: HTMLElement) {
  editor.querySelectorAll<HTMLElement>('[data-equation-preview="true"]').forEach((preview) => {
    preview.replaceChildren();
    preview.contentEditable = "false";
  });
}

function normalizeEquations(editor: HTMLElement) {
  editor.querySelectorAll<HTMLElement>('[data-athenaeum-block="equation"]').forEach((equation) => {
    if (equation.tagName.toLowerCase() !== "figure") {
      const sourceText = equation.textContent ?? "";
      const nextEquation = document.createElement("figure");
      nextEquation.dataset.athenaeumBlock = "equation";
      nextEquation.append(createEquationPreviewElement(), createEquationSourceElement(sourceText));
      equation.replaceWith(nextEquation);
      renderEquationPreview(nextEquation);
      return;
    }

    let preview = equation.querySelector<HTMLElement>(':scope > [data-equation-preview="true"]');
    if (!preview) {
      preview = createEquationPreviewElement();
      equation.prepend(preview);
    }
    preview.contentEditable = "false";

    let source = equation.querySelector<HTMLElement>(':scope > [data-equation-source="true"]');
    if (!source) {
      source = createEquationSourceElement(equation.textContent ?? "");
      equation.appendChild(source);
    }
    source.spellcheck = false;
    source.setAttribute("spellcheck", "false");

    if (sourceContainsMarkup(source)) {
      source.textContent = source.textContent ?? "";
    }

    renderEquationPreview(equation);
  });
}

function findClosestCallout(node: Node | null, editor: HTMLElement): HTMLElement | null {
  const element = node instanceof Element ? node : node?.parentElement;
  const callout = element?.closest('[data-athenaeum-block="callout"]');

  return callout instanceof HTMLElement && editor.contains(callout) ? callout : null;
}

function getCalloutType(callout: HTMLElement): CalloutType {
  return isCalloutType(callout.dataset.calloutType) ? callout.dataset.calloutType : "info";
}

function setCalloutType(callout: HTMLElement, type: CalloutType) {
  callout.dataset.calloutType = type;

  const icon = callout.querySelector<HTMLElement>('[data-callout-icon="true"]');
  if (icon) {
    icon.textContent = calloutIcons[type];
  }
}

function normalizeCallouts(editor: HTMLElement) {
  editor.querySelectorAll<HTMLElement>('[data-athenaeum-block="callout"]').forEach((callout) => {
    const type = getCalloutType(callout);
    callout.dataset.calloutType = type;

    let icon = callout.querySelector<HTMLElement>(':scope > [data-callout-icon="true"]');
    if (!icon) {
      icon = document.createElement("div");
      icon.dataset.calloutIcon = "true";
      callout.prepend(icon);
    }
    icon.textContent = calloutIcons[type];

    let content = callout.querySelector<HTMLElement>(':scope > [data-callout-content="true"]');
    if (!content) {
      const nextContent = document.createElement("div");
      nextContent.dataset.calloutContent = "true";

      Array.from(callout.childNodes).forEach((child) => {
        if (child !== icon) {
          nextContent.appendChild(child);
        }
      });

      callout.appendChild(nextContent);
      content = nextContent;
    }

    if (content.childNodes.length === 0) {
      content.appendChild(document.createElement("br"));
    }
  });
}

function findClosestTableCell(node: Node | null, editor: HTMLElement): HTMLTableCellElement | null {
  const element = node instanceof Element ? node : node?.parentElement;
  const cell = element?.closest("td, th");

  if (!(cell instanceof HTMLTableCellElement) || !editor.contains(cell)) {
    return null;
  }

  return cell.closest('table[data-athenaeum-block="table"]') instanceof HTMLTableElement ? cell : null;
}

function getTableCellInfo(cell: HTMLTableCellElement): TableCellInfo | null {
  const table = cell.closest('table[data-athenaeum-block="table"]');
  const row = cell.parentElement;

  if (!(table instanceof HTMLTableElement) || !(row instanceof HTMLTableRowElement)) {
    return null;
  }

  const rows = Array.from(table.rows);
  const cells = Array.from(row.cells);
  const rowIndex = rows.indexOf(row);
  const columnIndex = cells.indexOf(cell);
  const columnCount = Math.max(...rows.map((currentRow) => currentRow.cells.length), 0);

  if (rowIndex < 0 || columnIndex < 0 || rows.length === 0 || columnCount === 0) {
    return null;
  }

  return {
    table,
    row,
    cell,
    rowIndex,
    columnIndex,
    rowCount: rows.length,
    columnCount,
  };
}

function createEmptyTableCell() {
  const cell = document.createElement("td");
  cell.appendChild(document.createElement("br"));
  return cell;
}

function createEmptyTableRow(columnCount: number) {
  const row = document.createElement("tr");

  for (let index = 0; index < columnCount; index += 1) {
    row.appendChild(createEmptyTableCell());
  }

  return row;
}

function ensureTableCellPlaceholder(cell: HTMLTableCellElement) {
  if (cell.childNodes.length === 0) {
    cell.appendChild(document.createElement("br"));
  }
}

function isTableCellVisuallyEmpty(cell: HTMLTableCellElement) {
  return (
    (cell.textContent ?? "").trim().length === 0 &&
    cell.querySelector("img, table, figure, [data-athenaeum-block], [data-notebook-asset-id]") === null
  );
}

function placeCursorInTableCell(cell: HTMLTableCellElement) {
  ensureTableCellPlaceholder(cell);

  const selection = window.getSelection();
  if (!selection) {
    return null;
  }

  const range = document.createRange();
  range.selectNodeContents(cell);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
  return range;
}

function placeCursorAtEnd(container: HTMLElement) {
  if (container.childNodes.length === 0) {
    container.appendChild(document.createElement("br"));
  }

  const selection = window.getSelection();
  if (!selection) {
    return null;
  }

  const range = document.createRange();
  range.selectNodeContents(container);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
  return range;
}

function isBlockAction(action: EditorAction): action is BlockAction {
  return (blockActions as readonly string[]).includes(action);
}

type NotebookPageEditorProps = {
  // O componente carrega initialContent UMA vez (mount). O pai troca de pagina
  // remontando via key={page.id} — sem sincronizacao externa de conteudo.
  notebookId: number;
  pageId: number;
  initialContent: string;
  contentInsetClassName?: string;
  isFocusMode?: boolean;
  spacingMode?: NotebookSpacingMode;
  zoomPercent?: number;
  linkedDocuments?: LinkedPdfReference[];
  onOpenPdfPicker?: () => void;
  onSpacingModeChange?: (mode: NotebookSpacingMode) => void;
  onContentChange: (html: string) => void;
  onBlur: () => void;
};

export function NotebookPageEditor({
  notebookId,
  pageId,
  initialContent,
  contentInsetClassName = "pl-16",
  isFocusMode = false,
  spacingMode = "normal",
  zoomPercent = 100,
  linkedDocuments = [],
  onOpenPdfPicker,
  onSpacingModeChange,
  onContentChange,
  onBlur,
}: NotebookPageEditorProps) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const editorShellRef = useRef<HTMLDivElement | null>(null);
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const linkInputRef = useRef<HTMLInputElement | null>(null);
  const localImageInputRef = useRef<HTMLInputElement | null>(null);
  const localAttachmentInputRef = useRef<HTMLInputElement | null>(null);
  const savedRangeRef = useRef<Range | null>(null);
  const zoomScale = zoomPercent / 100;
  const spacingConfig = notebookSpacingConfig[spacingMode];
  const editorFontSize = 14 * zoomScale;
  const editorLineHeight = editorFontSize * spacingConfig.lineHeight;
  const editorStyle = {
    fontSize: `${editorFontSize}px`,
    lineHeight: `${editorLineHeight}px`,
    "--notebook-editor-paragraph-gap": spacingConfig.paragraphGap,
  } as CSSProperties;
  const [activeActions, setActiveActions] = useState<Set<EditorAction>>(new Set());
  const [isLinkPopoverOpen, setIsLinkPopoverOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [isCtrlPressed, setIsCtrlPressed] = useState(false);
  const [isTextMenuOpen, setIsTextMenuOpen] = useState(false);
  const [isInsertMenuOpen, setIsInsertMenuOpen] = useState(false);
  const [isCiteMenuOpen, setIsCiteMenuOpen] = useState(false);
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);
  const [showAttachmentNotice, setShowAttachmentNotice] = useState(false);
  const [assetPasteError, setAssetPasteError] = useState<string | null>(null);
  const [activeTableCell, setActiveTableCell] = useState<ActiveTableCellControls | null>(null);
  const [activeCallout, setActiveCallout] = useState<ActiveCalloutControls | null>(null);
  const [activeDiagram, setActiveDiagram] = useState<ActiveDiagramControls | null>(null);
  const [activeEquation, setActiveEquation] = useState<ActiveEquationControls | null>(null);
  const [isEmpty, setIsEmpty] = useState(initialNotebookContentIsEmpty(initialContent));

  const syncActiveActions = useCallback(() => {
    const editor = editorRef.current;
    const selection = window.getSelection();
    const isSelectionInEditor = Boolean(
      editor && selection && selection.rangeCount > 0 && selection.anchorNode && editor.contains(selection.anchorNode),
    );

    if (!isSelectionInEditor || !editor || !selection) {
      setActiveActions(new Set());
      setActiveTableCell(null);
      setActiveCallout(null);
      setActiveDiagram(null);
      setActiveEquation(null);
      return;
    }

    const nextActive = new Set<EditorAction>();

    (Object.keys(execCommandByAction) as EditorAction[]).forEach((action) => {
      const command = execCommandByAction[action];
      if (command && document.queryCommandState(command)) {
        nextActive.add(action);
      }
    });

    // Blocos (h1/h2/h3/blockquote) nao tem queryCommandState confiavel;
    // queryCommandValue("formatBlock") informa a tag do bloco atual.
    const currentBlock = document.queryCommandValue("formatBlock").toLowerCase();
    blockActions.forEach((action) => {
      if (currentBlock === action) {
        nextActive.add(action);
      }
    });

    if (findEnclosingTag(selection.anchorNode, "code", editor)) {
      nextActive.add("code");
    }

    const tableCell = findClosestTableCell(selection.anchorNode, editor);
    const tableCellInfo = tableCell ? getTableCellInfo(tableCell) : null;
    const editorShell = editorShellRef.current;

    if (tableCellInfo && editorShell) {
      const shellRect = editorShell.getBoundingClientRect();
      const tableRect = tableCellInfo.table.getBoundingClientRect();
      const maxLeft = Math.max(8, shellRect.width - 360);

      setActiveTableCell({
        top: Math.max(8, tableRect.top - shellRect.top - 38),
        left: Math.min(Math.max(8, tableRect.left - shellRect.left), maxLeft),
        canRemoveRow: tableCellInfo.rowCount > 1,
        canRemoveColumn: tableCellInfo.columnCount > 1,
      });
    } else {
      setActiveTableCell(null);
    }

    const callout = findClosestCallout(selection.anchorNode, editor);

    if (callout && editorShell) {
      const shellRect = editorShell.getBoundingClientRect();
      const calloutRect = callout.getBoundingClientRect();
      const maxLeft = Math.max(8, shellRect.width - 430);

      setActiveCallout({
        top: Math.max(8, calloutRect.top - shellRect.top - 38),
        left: Math.min(Math.max(8, calloutRect.left - shellRect.left), maxLeft),
        type: getCalloutType(callout),
      });
    } else {
      setActiveCallout(null);
    }

    const diagram = findClosestDiagram(selection.anchorNode, editor);

    if (diagram && editorShell) {
      const shellRect = editorShell.getBoundingClientRect();
      const diagramRect = diagram.getBoundingClientRect();
      const maxLeft = Math.max(8, shellRect.width - 430);

      setActiveDiagram({
        top: Math.max(8, diagramRect.top - shellRect.top - 38),
        left: Math.min(Math.max(8, diagramRect.left - shellRect.left), maxLeft),
        kind: getDiagramKind(diagram),
      });
    } else {
      setActiveDiagram(null);
    }

    const equation = findClosestEquation(selection.anchorNode, editor);

    if (equation && editorShell) {
      const shellRect = editorShell.getBoundingClientRect();
      const equationRect = equation.getBoundingClientRect();
      const maxLeft = Math.max(8, shellRect.width - 210);

      setActiveEquation({
        top: Math.max(8, equationRect.top - shellRect.top - 38),
        left: Math.min(Math.max(8, equationRect.left - shellRect.left), maxLeft),
      });
    } else {
      setActiveEquation(null);
    }

    setActiveActions(nextActive);
  }, []);

  // Conteudo inicial carregado uma unica vez — ver comentario nas props.
  useEffect(() => {
    const editor = editorRef.current;
    if (editor) {
      editor.innerHTML = initialContent;
      normalizeCallouts(editor);
      normalizeDiagrams(editor);
      normalizeEquations(editor);
      normalizeFileAttachmentCards(editor);
      prepareCodeElements(editor);
      setIsEmpty(!notebookEditorHasContent(editor));
    }

    let cancelled = false;

    async function hydrateAssets() {
      const currentEditor = editorRef.current;
      if (!currentEditor) {
        return;
      }

      try {
        const assets = await loadNotebookAssets(pageId);
        if (cancelled) {
          return;
        }

        hydrateNotebookAssetImages(currentEditor, assets);
      } catch (error) {
        console.warn("Nao foi possivel hidratar assets do caderno.", error);
      }
    }

    void hydrateAssets();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    document.addEventListener("selectionchange", syncActiveActions);
    return () => document.removeEventListener("selectionchange", syncActiveActions);
  }, [syncActiveActions]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Control") {
        setIsCtrlPressed(true);
      }
    }

    function handleKeyUp(event: KeyboardEvent) {
      if (event.key === "Control") {
        setIsCtrlPressed(false);
      }
    }

    function handleWindowBlur() {
      setIsCtrlPressed(false);
    }

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleWindowBlur);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleWindowBlur);
    };
  }, []);

  useEffect(() => {
    if (!isTextMenuOpen && !isInsertMenuOpen && !isLinkPopoverOpen && !isCiteMenuOpen && !isMoreMenuOpen && !showAttachmentNotice && !assetPasteError) {
      return;
    }

    function handlePointerDown(event: globalThis.MouseEvent) {
      if (event.target instanceof Node && toolbarRef.current?.contains(event.target)) {
        return;
      }

      setIsTextMenuOpen(false);
      setIsInsertMenuOpen(false);
      setIsLinkPopoverOpen(false);
      setIsCiteMenuOpen(false);
      setIsMoreMenuOpen(false);
      setShowAttachmentNotice(false);
      setAssetPasteError(null);
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [isTextMenuOpen, isInsertMenuOpen, isLinkPopoverOpen, isCiteMenuOpen, isMoreMenuOpen, showAttachmentNotice, assetPasteError]);

  function isSelectionInsideEditor(selection: Selection | null) {
    const editor = editorRef.current;
    return Boolean(
      editor &&
        selection &&
        selection.rangeCount > 0 &&
        selection.anchorNode &&
        selection.focusNode &&
        editor.contains(selection.anchorNode) &&
        editor.contains(selection.focusNode),
    );
  }

  function saveCurrentRange() {
    const selection = window.getSelection();
    savedRangeRef.current = isSelectionInsideEditor(selection) ? selection?.getRangeAt(0).cloneRange() ?? null : null;
  }

  function saveCurrentRangeOrEditorEnd() {
    const editor = editorRef.current;
    const selection = window.getSelection();

    if (!editor) {
      return;
    }

    savedRangeRef.current = isSelectionInsideEditor(selection) && selection?.rangeCount
      ? selection.getRangeAt(0).cloneRange()
      : createRangeAtEditorEnd(editor);
  }

  function restoreSavedRange() {
    const editor = editorRef.current;
    const range = savedRangeRef.current;
    const selection = window.getSelection();

    if (!editor || !range || !selection) {
      editor?.focus();
      return null;
    }

    editor.focus();
    selection.removeAllRanges();
    selection.addRange(range);
    return selection;
  }

  function restoreSavedRangeOrEditorEnd() {
    const editor = editorRef.current;

    if (!savedRangeRef.current && editor) {
      savedRangeRef.current = createRangeAtEditorEnd(editor);
    }

    return restoreSavedRange();
  }

  function escapeHtml(value: string) {
    return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function normalizeUrl(value: string) {
    const trimmedUrl = value.trim();
    if (trimmedUrl.length === 0) {
      return "";
    }

    if (/^(https?:|mailto:|file:|#)/i.test(trimmedUrl)) {
      return trimmedUrl;
    }

    return `https://${trimmedUrl}`;
  }

  function insertHtml(html: string, options: { placeCursorInTrailingBlock?: boolean } = {}) {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }

    editor.focus();
    const markerId = options.placeCursorInTrailingBlock ? crypto.randomUUID() : "";
    const markerHtml = markerId ? `<span data-athenaeum-caret-marker="${markerId}"></span>` : "";
    document.execCommand("insertHTML", false, `${html}${markerHtml}`);

    const marker = markerId
      ? editor.querySelector<HTMLElement>(`span[data-athenaeum-caret-marker="${markerId}"]`)
      : null;
    const trailingBlock =
      marker?.previousElementSibling instanceof HTMLElement &&
      marker.previousElementSibling.tagName.toLowerCase() === "div"
        ? marker.previousElementSibling
        : null;
    marker?.remove();

    emitChange();
    if (trailingBlock?.isConnected) {
      savedRangeRef.current = placeCursorAtEnd(trailingBlock)?.cloneRange() ?? null;
    }
    syncActiveActions();
  }

  function insertBlockHtml(html: string) {
    restoreSavedRangeOrEditorEnd();
    insertHtml(html, { placeCursorInTrailingBlock: true });
    setIsTextMenuOpen(false);
    setIsInsertMenuOpen(false);
    setIsLinkPopoverOpen(false);
    setIsCiteMenuOpen(false);
    setIsMoreMenuOpen(false);
    setShowAttachmentNotice(false);
  }

  function insertTableBlock() {
    insertBlockHtml(`
      <table data-athenaeum-block="table">
        <tbody>
          <tr><td><br></td><td><br></td></tr>
          <tr><td><br></td><td><br></td></tr>
        </tbody>
      </table>
      <div><br></div>
    `);
  }

  function insertCalloutBlock() {
    insertBlockHtml(`
      <aside data-athenaeum-block="callout" data-callout-type="info">
        <div data-callout-icon="true">${calloutIcons.info}</div>
        <div data-callout-content="true">
          <strong>Destaque</strong>
          <div>Escreva uma observação importante...</div>
        </div>
      </aside>
      <div><br></div>
    `);
  }

  function insertDiagramBlock(kind: DiagramKind) {
    insertBlockHtml(`
      <figure data-athenaeum-block="diagram" data-diagram-kind="${escapeHtml(kind)}">
        <div data-diagram-preview="true" contenteditable="false">
          <strong>${escapeHtml(diagramKindLabels[kind])}</strong>
          <span>${escapeHtml(diagramDefaultSources[kind])}</span>
        </div>
        <figcaption data-diagram-source="true" spellcheck="false">${escapeHtml(diagramDefaultSources[kind])}</figcaption>
      </figure>
      <div><br></div>
    `);
  }

  function insertEquationBlock() {
    insertBlockHtml(`
      <figure data-athenaeum-block="equation">
        <div data-equation-preview="true" contenteditable="false">E = mc²</div>
        <figcaption data-equation-source="true" spellcheck="false">E = mc^2</figcaption>
      </figure>
      <div><br></div>
    `);
  }

  async function insertImageFileAsNotebookAsset(file: File) {
    if (!supportedNotebookImageMimeTypes.has(file.type)) {
      throw new Error("Formato de imagem nao suportado.");
    }

    if (!savedRangeRef.current) {
      saveCurrentRangeOrEditorEnd();
    }

    const assetId = crypto.randomUUID();
    const dataBase64 = await readFileAsDataBase64(file);
    const savedAsset: NotebookAssetMetadata = await saveNotebookAsset({
      notebookId,
      pageId,
      assetId,
      mimeType: file.type,
      dataBase64,
      originalName: file.name || null,
      checksum: null,
    });

    restoreSavedRangeOrEditorEnd();
    insertHtml(`
      <figure data-athenaeum-block="figure" data-figure-subtype="image">
        <img data-notebook-asset-id="${escapeHtml(savedAsset.id)}" src="data:${escapeHtml(savedAsset.mimeType)};base64,${dataBase64}" alt="" />
        <figcaption>Imagem sem título. Adicione uma legenda...</figcaption>
      </figure>
      <div><br></div>
    `, { placeCursorInTrailingBlock: true });
    saveCurrentRangeOrEditorEnd();
  }

  async function insertClipboardImages(files: File[]) {
    saveCurrentRangeOrEditorEnd();
    setAssetPasteError(null);

    let hadFailure = false;

    for (const file of files) {
      try {
        await insertImageFileAsNotebookAsset(file);
      } catch (error) {
        hadFailure = true;
        console.warn("Nao foi possivel colar imagem no caderno.", error);
      }
    }

    if (hadFailure) {
      setAssetPasteError("Não foi possível colar a imagem. Tente uma imagem PNG, JPEG, WebP ou GIF menor.");
    }
  }

  function openLocalImagePicker() {
    saveCurrentRangeOrEditorEnd();
    setIsTextMenuOpen(false);
    setIsInsertMenuOpen(false);
    setIsLinkPopoverOpen(false);
    setIsCiteMenuOpen(false);
    setIsMoreMenuOpen(false);
    setShowAttachmentNotice(false);
    setAssetPasteError(null);

    const input = localImageInputRef.current;
    if (!input) {
      return;
    }

    input.value = "";
    input.click();
  }

  async function handleLocalImageSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0] ?? null;
    input.value = "";

    if (!file) {
      return;
    }

    if (!supportedNotebookImageMimeTypes.has(file.type)) {
      setAssetPasteError("Formato não suportado. Use PNG, JPEG, WebP ou GIF.");
      return;
    }

    setAssetPasteError(null);

    try {
      await insertImageFileAsNotebookAsset(file);
    } catch (error) {
      console.warn("Nao foi possivel inserir imagem local no caderno.", error);
      setAssetPasteError("Não foi possível inserir a imagem. Tente um arquivo menor.");
    }
  }

  async function insertFileAsNotebookAttachment(file: File) {
    if (!savedRangeRef.current) {
      saveCurrentRangeOrEditorEnd();
    }

    const attachmentId = crypto.randomUUID();
    const dataBase64 = await readFileAsDataBase64(file, "arquivo selecionado");
    const savedAttachment = await saveNotebookFileAttachment({
      notebookId,
      pageId,
      attachmentId,
      originalName: file.name || "arquivo",
      mimeType: file.type || null,
      dataBase64,
    });

    restoreSavedRangeOrEditorEnd();
    insertHtml(`
      <figure data-athenaeum-block="file-attachment" data-notebook-attachment-id="${escapeHtml(savedAttachment.id)}">
        <div data-file-attachment-card="true" contenteditable="false">
          <strong data-file-attachment-name="true">${escapeHtml(savedAttachment.originalName)}</strong>
          <span data-file-attachment-meta="true">${escapeHtml(formatAttachmentMeta(savedAttachment))}</span>
          ${fileAttachmentActionsHtml()}
        </div>
        <figcaption>Arquivo anexado</figcaption>
      </figure>
      <div><br></div>
    `, { placeCursorInTrailingBlock: true });
    saveCurrentRangeOrEditorEnd();
  }

  function openLocalAttachmentPicker() {
    saveCurrentRangeOrEditorEnd();
    setIsTextMenuOpen(false);
    setIsInsertMenuOpen(false);
    setIsLinkPopoverOpen(false);
    setIsCiteMenuOpen(false);
    setIsMoreMenuOpen(false);
    setShowAttachmentNotice(false);
    setAssetPasteError(null);

    const input = localAttachmentInputRef.current;
    if (!input) {
      return;
    }

    input.value = "";
    input.click();
  }

  async function handleLocalAttachmentSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0] ?? null;
    input.value = "";

    if (!file) {
      return;
    }

    setAssetPasteError(null);

    try {
      await insertFileAsNotebookAttachment(file);
    } catch (error) {
      console.warn("Nao foi possivel anexar arquivo ao caderno.", error);
      setAssetPasteError("Não foi possível anexar o arquivo. Tente um arquivo menor.");
    }
  }

  function createRangeAtEditorEnd(editor: HTMLElement) {
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    return range;
  }

  function getCurrentTableCellInfo() {
    const editor = editorRef.current;
    const selection = window.getSelection();

    if (!editor || !selection || selection.rangeCount === 0 || !selection.anchorNode) {
      return null;
    }

    const cell = findClosestTableCell(selection.anchorNode, editor);
    return cell ? getTableCellInfo(cell) : null;
  }

  function placeCursorAndSaveTableRange(cell: HTMLTableCellElement) {
    const range = placeCursorInTableCell(cell);
    savedRangeRef.current = range?.cloneRange() ?? null;
  }

  function commitTableMutation(targetCell: HTMLTableCellElement) {
    placeCursorAndSaveTableRange(targetCell);
    emitChange();
    syncActiveActions();
  }

  function handleTableTabKey(event: React.KeyboardEvent<HTMLDivElement>) {
    const info = getCurrentTableCellInfo();

    if (!info) {
      return false;
    }

    event.preventDefault();

    if (event.shiftKey) {
      const previousRow = info.rowIndex > 0 ? info.table.rows.item(info.rowIndex - 1) : null;
      const previousCell = info.columnIndex > 0
        ? info.row.cells.item(info.columnIndex - 1)
        : info.rowIndex > 0
          ? previousRow?.cells.item(Math.max(0, previousRow.cells.length - 1))
          : info.cell;

      if (previousCell instanceof HTMLTableCellElement) {
        placeCursorAndSaveTableRange(previousCell);
        syncActiveActions();
      }

      return true;
    }

    const nextCellInRow = info.row.cells.item(info.columnIndex + 1);
    if (nextCellInRow instanceof HTMLTableCellElement) {
      placeCursorAndSaveTableRange(nextCellInRow);
      syncActiveActions();
      return true;
    }

    const nextRow = info.table.rows.item(info.rowIndex + 1);
    const firstCellInNextRow = nextRow?.cells.item(0);
    if (firstCellInNextRow instanceof HTMLTableCellElement) {
      placeCursorAndSaveTableRange(firstCellInNextRow);
      syncActiveActions();
      return true;
    }

    const tbody = info.table.tBodies.item(0) ?? info.table.createTBody();
    const newRow = createEmptyTableRow(info.columnCount);
    tbody.appendChild(newRow);
    const firstCell = newRow.cells.item(0);

    if (firstCell instanceof HTMLTableCellElement) {
      commitTableMutation(firstCell);
    }

    return true;
  }

  function handleTableDeletionKey(event: React.KeyboardEvent<HTMLDivElement>) {
    const editor = editorRef.current;
    const selection = window.getSelection();

    if (!editor || !selection || selection.rangeCount === 0 || !selection.anchorNode || !selection.focusNode) {
      return false;
    }

    const anchorCell = findClosestTableCell(selection.anchorNode, editor);
    const focusCell = findClosestTableCell(selection.focusNode, editor);

    if (!anchorCell && !focusCell) {
      return false;
    }

    const targetCell = anchorCell ?? focusCell;
    if (!targetCell) {
      return false;
    }

    if (!anchorCell || !focusCell || anchorCell !== focusCell || (selection.isCollapsed && isTableCellVisuallyEmpty(targetCell))) {
      event.preventDefault();
      ensureTableCellPlaceholder(targetCell);
      placeCursorAndSaveTableRange(targetCell);
      syncActiveActions();
      return true;
    }

    return false;
  }

  function handleTableEnterKey(event: React.KeyboardEvent<HTMLDivElement>) {
    const info = getCurrentTableCellInfo();

    if (!info || event.ctrlKey || event.metaKey || event.altKey) {
      return false;
    }

    event.preventDefault();
    document.execCommand("insertLineBreak", false);
    emitChange();
    syncActiveActions();
    return true;
  }

  function addTableRowBelow() {
    const info = getCurrentTableCellInfo();
    if (!info) {
      return;
    }

    const newRow = createEmptyTableRow(info.columnCount);
    info.row.after(newRow);
    const targetCell = newRow.cells.item(Math.min(info.columnIndex, newRow.cells.length - 1));

    if (targetCell instanceof HTMLTableCellElement) {
      commitTableMutation(targetCell);
    }
  }

  function removeCurrentTableRow() {
    const info = getCurrentTableCellInfo();
    if (!info || info.rowCount <= 1) {
      return;
    }

    const targetRowIndex = info.rowIndex < info.rowCount - 1 ? info.rowIndex + 1 : info.rowIndex - 1;
    const targetRowBeforeRemoval = info.table.rows.item(targetRowIndex);
    info.row.remove();
    const targetRow = targetRowBeforeRemoval?.isConnected
      ? targetRowBeforeRemoval
      : info.table.rows.item(Math.min(targetRowIndex, info.table.rows.length - 1));
    const targetCell = targetRow?.cells.item(Math.min(info.columnIndex, Math.max(0, targetRow.cells.length - 1)));

    if (targetCell instanceof HTMLTableCellElement) {
      commitTableMutation(targetCell);
    } else {
      emitChange();
      syncActiveActions();
    }
  }

  function addTableColumnRight() {
    const info = getCurrentTableCellInfo();
    if (!info) {
      return;
    }

    Array.from(info.table.rows).forEach((row) => {
      const newCell = createEmptyTableCell();
      const referenceCell = row.cells.item(info.columnIndex);

      if (referenceCell) {
        referenceCell.after(newCell);
      } else {
        row.appendChild(newCell);
      }
    });

    const targetCell = info.row.cells.item(info.columnIndex + 1);
    if (targetCell instanceof HTMLTableCellElement) {
      commitTableMutation(targetCell);
    }
  }

  function removeCurrentTableColumn() {
    const info = getCurrentTableCellInfo();
    if (!info || info.columnCount <= 1) {
      return;
    }

    Array.from(info.table.rows).forEach((row) => {
      row.cells.item(info.columnIndex)?.remove();
    });

    const targetCell = info.row.cells.item(Math.min(info.columnIndex, Math.max(0, info.row.cells.length - 1)));
    if (targetCell instanceof HTMLTableCellElement) {
      commitTableMutation(targetCell);
    } else {
      emitChange();
      syncActiveActions();
    }
  }

  function getCurrentCallout() {
    const editor = editorRef.current;
    const selection = window.getSelection();

    if (!editor || !selection || selection.rangeCount === 0 || !selection.anchorNode) {
      return null;
    }

    return findClosestCallout(selection.anchorNode, editor);
  }

  function changeCurrentCalloutType(type: CalloutType) {
    const callout = getCurrentCallout();
    if (!callout) {
      return;
    }

    setCalloutType(callout, type);
    emitChange();
    syncActiveActions();
  }

  function removeCurrentCallout() {
    const callout = getCurrentCallout();
    if (!callout) {
      return;
    }

    const fallback = document.createElement("div");
    fallback.appendChild(document.createElement("br"));
    callout.after(fallback);
    callout.remove();
    savedRangeRef.current = placeCursorAtEnd(fallback)?.cloneRange() ?? null;
    emitChange();
    syncActiveActions();
  }

  function handleCalloutDeletionKey(event: React.KeyboardEvent<HTMLDivElement>) {
    const editor = editorRef.current;
    const selection = window.getSelection();

    if (!editor || !selection || selection.rangeCount === 0 || !selection.anchorNode || !selection.focusNode) {
      return false;
    }

    const anchorCallout = findClosestCallout(selection.anchorNode, editor);
    const focusCallout = findClosestCallout(selection.focusNode, editor);

    if (!anchorCallout && !focusCallout) {
      return false;
    }

    const targetCallout = anchorCallout ?? focusCallout;
    if (!targetCallout) {
      return false;
    }

    if (!anchorCallout || !focusCallout || anchorCallout !== focusCallout) {
      event.preventDefault();
      savedRangeRef.current = placeCursorAtEnd(targetCallout)?.cloneRange() ?? null;
      syncActiveActions();
      return true;
    }

    const content = targetCallout.querySelector<HTMLElement>('[data-callout-content="true"]');
    const isEmptyCallout = (content?.textContent ?? targetCallout.textContent ?? "").trim().length === 0;

    if (selection.isCollapsed && isEmptyCallout) {
      event.preventDefault();
      if (content && content.childNodes.length === 0) {
        content.appendChild(document.createElement("br"));
      }
      savedRangeRef.current = placeCursorAtEnd(content ?? targetCallout)?.cloneRange() ?? null;
      syncActiveActions();
      return true;
    }

    return false;
  }

  function handleCalloutEnterKey(event: React.KeyboardEvent<HTMLDivElement>) {
    const callout = getCurrentCallout();

    if (!callout || event.ctrlKey || event.metaKey || event.altKey) {
      return false;
    }

    event.preventDefault();
    document.execCommand("insertLineBreak", false);
    emitChange();
    syncActiveActions();
    return true;
  }

  function getCurrentEquation() {
    const editor = editorRef.current;
    const selection = window.getSelection();

    if (!editor || !selection || selection.rangeCount === 0 || !selection.anchorNode) {
      return null;
    }

    return findClosestEquation(selection.anchorNode, editor);
  }

  function getOrCreateEditableBlockAfter(element: HTMLElement) {
    const nextElement = element.nextElementSibling;

    if (nextElement instanceof HTMLElement && nextElement.tagName.toLowerCase() === "div") {
      if (nextElement.childNodes.length === 0) {
        nextElement.appendChild(document.createElement("br"));
      }
      return { block: nextElement, created: false };
    }

    const fallback = document.createElement("div");
    fallback.appendChild(document.createElement("br"));
    element.after(fallback);
    return { block: fallback, created: true };
  }

  function getCurrentDiagram() {
    const editor = editorRef.current;
    const selection = window.getSelection();

    if (!editor || !selection || selection.rangeCount === 0 || !selection.anchorNode) {
      return null;
    }

    return findClosestDiagram(selection.anchorNode, editor);
  }

  function changeCurrentDiagramKind(kind: DiagramKind) {
    const diagram = getCurrentDiagram();
    if (!diagram) {
      return;
    }

    setDiagramKind(diagram, kind);
    emitChange();
    syncActiveActions();
  }

  function removeCurrentDiagram() {
    const diagram = getCurrentDiagram();
    if (!diagram) {
      return;
    }

    const { block } = getOrCreateEditableBlockAfter(diagram);
    diagram.remove();
    savedRangeRef.current = placeCursorAtEnd(block)?.cloneRange() ?? null;
    emitChange();
    syncActiveActions();
  }

  function handleDiagramDeletionKey(event: React.KeyboardEvent<HTMLDivElement>) {
    const editor = editorRef.current;
    const selection = window.getSelection();

    if (!editor || !selection || selection.rangeCount === 0 || !selection.anchorNode || !selection.focusNode) {
      return false;
    }

    const anchorDiagram = findClosestDiagram(selection.anchorNode, editor);
    const focusDiagram = findClosestDiagram(selection.focusNode, editor);

    if (!anchorDiagram && !focusDiagram) {
      return false;
    }

    const targetDiagram = anchorDiagram ?? focusDiagram;
    if (!targetDiagram) {
      return false;
    }

    const source = getDiagramSource(targetDiagram);

    if (!anchorDiagram || !focusDiagram || anchorDiagram !== focusDiagram) {
      event.preventDefault();
      savedRangeRef.current = placeCursorAtEnd(source ?? targetDiagram)?.cloneRange() ?? null;
      syncActiveActions();
      return true;
    }

    const isEmptyDiagram = (source?.textContent ?? targetDiagram.textContent ?? "").trim().length === 0;

    if (selection.isCollapsed && isEmptyDiagram) {
      event.preventDefault();
      savedRangeRef.current = placeCursorAtEnd(source ?? targetDiagram)?.cloneRange() ?? null;
      syncActiveActions();
      return true;
    }

    return false;
  }

  function handleDiagramEnterKey(event: React.KeyboardEvent<HTMLDivElement>) {
    const diagram = getCurrentDiagram();

    if (!diagram || event.ctrlKey || event.metaKey || event.altKey) {
      return false;
    }

    event.preventDefault();
    const { block, created } = getOrCreateEditableBlockAfter(diagram);
    savedRangeRef.current = placeCursorAtEnd(block)?.cloneRange() ?? null;

    if (created) {
      emitChange();
    }

    syncActiveActions();
    return true;
  }

  function removeCurrentEquation() {
    const equation = getCurrentEquation();
    if (!equation) {
      return;
    }

    const { block } = getOrCreateEditableBlockAfter(equation);
    equation.remove();
    savedRangeRef.current = placeCursorAtEnd(block)?.cloneRange() ?? null;
    emitChange();
    syncActiveActions();
  }

  function handleEquationDeletionKey(event: React.KeyboardEvent<HTMLDivElement>) {
    const editor = editorRef.current;
    const selection = window.getSelection();

    if (!editor || !selection || selection.rangeCount === 0 || !selection.anchorNode || !selection.focusNode) {
      return false;
    }

    const anchorEquation = findClosestEquation(selection.anchorNode, editor);
    const focusEquation = findClosestEquation(selection.focusNode, editor);

    if (!anchorEquation && !focusEquation) {
      return false;
    }

    const targetEquation = anchorEquation ?? focusEquation;
    if (!targetEquation) {
      return false;
    }

    const source = getEquationSource(targetEquation);

    if (!anchorEquation || !focusEquation || anchorEquation !== focusEquation) {
      event.preventDefault();
      savedRangeRef.current = placeCursorAtEnd(source ?? targetEquation)?.cloneRange() ?? null;
      syncActiveActions();
      return true;
    }

    const isEmptyEquation = (source?.textContent ?? targetEquation.textContent ?? "").trim().length === 0;

    if (selection.isCollapsed && isEmptyEquation) {
      event.preventDefault();
      savedRangeRef.current = placeCursorAtEnd(source ?? targetEquation)?.cloneRange() ?? null;
      syncActiveActions();
      return true;
    }

    return false;
  }

  function handleEquationEnterKey(event: React.KeyboardEvent<HTMLDivElement>) {
    const equation = getCurrentEquation();

    if (!equation || event.ctrlKey || event.metaKey || event.altKey) {
      return false;
    }

    event.preventDefault();
    const { block, created } = getOrCreateEditableBlockAfter(equation);
    savedRangeRef.current = placeCursorAtEnd(block)?.cloneRange() ?? null;

    if (created) {
      emitChange();
    }

    syncActiveActions();
    return true;
  }

  function insertLink(url: string, selection: Selection | null) {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }

    const range = selection && isSelectionInsideEditor(selection) && selection.rangeCount > 0
      ? selection.getRangeAt(0)
      : createRangeAtEditorEnd(editor);
    const link = document.createElement("a");
    link.href = url;

    if (range.collapsed) {
      link.textContent = url;
    } else {
      link.appendChild(range.extractContents());
    }

    range.deleteContents();
    range.insertNode(link);

    const trailingSpace = document.createTextNode("\u00A0");
    link.after(trailingSpace);

    const nextRange = document.createRange();
    nextRange.setStartAfter(trailingSpace);
    nextRange.collapse(true);
    const nextSelection = window.getSelection();
    nextSelection?.removeAllRanges();
    nextSelection?.addRange(nextRange);

    emitChange();
    syncActiveActions();
  }

  function findAnchorFromTarget(target: EventTarget | null) {
    const editor = editorRef.current;
    const element = target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
    const link = element?.closest("a");
    return editor && link instanceof HTMLAnchorElement && editor.contains(link) ? link : null;
  }

  function fileAttachmentActionErrorMessage(action: FileAttachmentAction, error: unknown) {
    const message = String(error).toLowerCase();

    if (message.includes("nao encontrado") || message.includes("não encontrado")) {
      return "Arquivo não encontrado no disco.";
    }

    if (action === "open") {
      return "Não foi possível abrir o arquivo.";
    }

    if (action === "reveal") {
      return "Não foi possível mostrar o arquivo no sistema.";
    }

    return "Não foi possível remover o anexo.";
  }

  async function runFileAttachmentAction(action: FileAttachmentAction, attachmentBlock: HTMLElement, attachmentId: string) {
    try {
      if (action === "open") {
        await openNotebookFileAttachment(attachmentId);
        setAssetPasteError(null);
        return;
      }

      if (action === "reveal") {
        await revealNotebookFileAttachment(attachmentId);
        setAssetPasteError(null);
        return;
      }

      await deleteNotebookFileAttachment(attachmentId);
      const { block } = getOrCreateEditableBlockAfter(attachmentBlock);
      attachmentBlock.remove();
      savedRangeRef.current = placeCursorAtEnd(block)?.cloneRange() ?? null;
      setAssetPasteError(null);
      emitChange();
      syncActiveActions();
    } catch (error) {
      console.warn("Nao foi possivel executar acao do anexo do caderno.", error);
      setAssetPasteError(fileAttachmentActionErrorMessage(action, error));
    }
  }

  function handleEditorClick(event: React.MouseEvent<HTMLDivElement>) {
    const attachmentAction = findFileAttachmentActionFromTarget(editorRef.current, event.target);
    if (attachmentAction) {
      event.preventDefault();
      event.stopPropagation();
      void runFileAttachmentAction(
        attachmentAction.action,
        attachmentAction.attachmentBlock,
        attachmentAction.attachmentId,
      );
      return;
    }

    if (!event.ctrlKey) {
      return;
    }

    const link = findAnchorFromTarget(event.target);
    if (!link?.href) {
      return;
    }

    event.preventDefault();
    void invoke("open_external_url", { url: link.href }).catch((error) => {
      console.error("Nao foi possivel abrir o link externo.", error);
    });
  }

  function openLinkPopover() {
    saveCurrentRange();
    setLinkUrl("");
    setIsTextMenuOpen(false);
    setIsInsertMenuOpen(false);
    setIsCiteMenuOpen(false);
    setIsMoreMenuOpen(false);
    setShowAttachmentNotice(false);
    setIsLinkPopoverOpen(true);
    window.requestAnimationFrame(() => linkInputRef.current?.focus());
  }

  function commitLink() {
    const url = normalizeUrl(linkUrl);
    if (!url) {
      setIsLinkPopoverOpen(false);
      return;
    }

    const selection = restoreSavedRange();
    insertLink(url, selection);

    setLinkUrl("");
    setIsLinkPopoverOpen(false);
  }

  function openCiteMenu() {
    saveCurrentRange();
    setIsTextMenuOpen(false);
    setIsInsertMenuOpen(false);
    setIsLinkPopoverOpen(false);
    setIsMoreMenuOpen(false);
    setShowAttachmentNotice(false);

    if (linkedDocuments.length === 0) {
      onOpenPdfPicker?.();
      return;
    }

    setIsCiteMenuOpen((current) => !current);
  }

  function citationText(document: LinkedPdfReference) {
    const author = document.authors[0] ? `${document.authors[0]}${document.authors.length > 1 ? " et al." : ""}` : document.title;
    return `(${author}, ${document.year})`;
  }

  function insertCitation(document: LinkedPdfReference) {
    restoreSavedRange();
    insertHtml(`<span data-citation-document-id="${escapeHtml(document.id)}">${escapeHtml(citationText(document))}</span>`);
    setIsInsertMenuOpen(false);
    setIsCiteMenuOpen(false);
  }

  function applyMoreCommand(command: "clear-formatting" | "unlink" | "separator") {
    restoreSavedRange();

    if (command === "clear-formatting") {
      document.execCommand("removeFormat", false);
    } else if (command === "unlink") {
      document.execCommand("unlink", false);
    } else {
      document.execCommand("insertHorizontalRule", false);
    }

    emitChange();
    syncActiveActions();
    setIsTextMenuOpen(false);
    setIsInsertMenuOpen(false);
    setIsMoreMenuOpen(false);
  }

  function emitChange() {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }

    normalizeCallouts(editor);
    normalizeDiagrams(editor);
    normalizeEquations(editor);
    normalizeFileAttachmentCards(editor);
    setIsEmpty(!notebookEditorHasContent(editor));
    onContentChange(serializeNotebookEditorHtml(editor));
  }

  function applyAction(action: EditorAction) {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }

    editor.focus();
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return;
    }

    if (action === "code") {
      // Bloco de codigo exige um trecho selecionado para envolver.
      if (selection.isCollapsed) {
        return;
      }
      wrapSelectionInCode(selection, editor);
    } else if (isBlockAction(action)) {
      // Toggle: reaplicar o mesmo bloco volta para paragrafo comum (<div>,
      // o separador padrao do Chromium/WebView2 em contentEditable).
      const currentBlock = document.queryCommandValue("formatBlock").toLowerCase();
      document.execCommand("formatBlock", false, currentBlock === action ? "<div>" : `<${action}>`);
    } else {
      const command = execCommandByAction[action];
      if (command) {
        document.execCommand(command, false);
      }
    }

    emitChange();
    syncActiveActions();
    setIsTextMenuOpen(false);
  }

  // Cola imagens suportadas como assets; se nao houver imagem real, mantem o
  // caminho antigo de texto puro (sanitizacao pratica sem markup arbitrario).
  function handlePaste(event: React.ClipboardEvent<HTMLDivElement>) {
    event.preventDefault();
    const imageFiles = getSupportedImageFilesFromClipboard(event.clipboardData);

    if (imageFiles.length > 0) {
      void insertClipboardImages(imageFiles);
      return;
    }

    setAssetPasteError(null);
    const text = event.clipboardData.getData("text/plain");

    const editor = editorRef.current;
    const selection = window.getSelection();
    if (editor && selection && selection.rangeCount > 0 && selection.anchorNode && selection.focusNode) {
      const anchorCode = findEnclosingTag(selection.anchorNode, "code", editor);
      const focusCode = findEnclosingTag(selection.focusNode, "code", editor);

      if (anchorCode && anchorCode === focusCode) {
        insertPlainTextWithLineBreaks(selection.getRangeAt(0), text);
        emitChange();
        syncActiveActions();
        return;
      }
    }

    document.execCommand("insertText", false, text);
    emitChange();
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Tab" && handleTableTabKey(event)) {
      return;
    }

    if ((event.key === "Backspace" || event.key === "Delete") && handleTableDeletionKey(event)) {
      return;
    }

    if ((event.key === "Backspace" || event.key === "Delete") && handleCalloutDeletionKey(event)) {
      return;
    }

    if ((event.key === "Backspace" || event.key === "Delete") && handleDiagramDeletionKey(event)) {
      return;
    }

    if ((event.key === "Backspace" || event.key === "Delete") && handleEquationDeletionKey(event)) {
      return;
    }

    if (event.key === "Enter" && handleTableEnterKey(event)) {
      return;
    }

    if (event.key === "Enter" && handleCalloutEnterKey(event)) {
      return;
    }

    if (event.key === "Enter" && handleDiagramEnterKey(event)) {
      return;
    }

    if (event.key === "Enter" && handleEquationEnterKey(event)) {
      return;
    }

    if (event.key !== "Enter" || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }

    const editor = editorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection || selection.rangeCount === 0 || !selection.anchorNode || !editor.contains(selection.anchorNode)) {
      return;
    }

    const anchorCode = findEnclosingTag(selection.anchorNode, "code", editor);
    const focusCode = findEnclosingTag(selection.focusNode, "code", editor);
    if (!anchorCode || anchorCode !== focusCode) {
      return;
    }

    event.preventDefault();
    document.execCommand("insertLineBreak", false);
    emitChange();
    syncActiveActions();
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <input
        ref={localImageInputRef}
        type="file"
        accept={supportedNotebookImageAccept}
        className="hidden"
        tabIndex={-1}
        onChange={(event) => void handleLocalImageSelected(event)}
      />
      <input
        ref={localAttachmentInputRef}
        type="file"
        className="hidden"
        tabIndex={-1}
        onChange={(event) => void handleLocalAttachmentSelected(event)}
      />
      <div className="shrink-0 border-b border-border-subtle py-2">
        <div
          ref={toolbarRef}
          className={`relative flex h-9 items-center overflow-visible border border-border-subtle bg-[var(--card)] shadow-sm ${
            isFocusMode ? "mx-auto w-fit max-w-full justify-center gap-1 rounded-full px-2" : `gap-1 rounded-md pr-2 ${contentInsetClassName}`
          }`}
        >
          {isFocusMode ? (
            <>
              <button
                type="button"
                aria-haspopup="menu"
                aria-expanded={isTextMenuOpen}
                className="inline-flex h-7 items-center rounded-md px-3 text-xs font-semibold text-text-secondary transition hover:bg-surface-muted hover:text-text-primary"
                onMouseDown={(event) => {
                  event.preventDefault();
                  saveCurrentRange();
                }}
                onClick={() => {
                  setIsInsertMenuOpen(false);
                  setIsLinkPopoverOpen(false);
                  setIsCiteMenuOpen(false);
                  setIsMoreMenuOpen(false);
                  setShowAttachmentNotice(false);
                  setIsTextMenuOpen((current) => !current);
                }}
              >
                Texto
              </button>
              <button
                type="button"
                aria-haspopup="menu"
                aria-expanded={isInsertMenuOpen}
                className="inline-flex h-7 items-center rounded-md px-3 text-xs font-semibold text-text-secondary transition hover:bg-surface-muted hover:text-text-primary"
                onMouseDown={(event) => {
                  event.preventDefault();
                  saveCurrentRange();
                }}
                onClick={() => {
                  setIsTextMenuOpen(false);
                  setIsLinkPopoverOpen(false);
                  setIsCiteMenuOpen(false);
                  setIsMoreMenuOpen(false);
                  setShowAttachmentNotice(false);
                  setIsInsertMenuOpen((current) => !current);
                }}
              >
                Inserir
                <ChevronDownIcon />
              </button>
              <button
                type="button"
                title="Mais opções"
                aria-label="Mais opções"
                aria-haspopup="menu"
                aria-expanded={isMoreMenuOpen}
                className="inline-flex h-7 w-8 items-center justify-center rounded-md text-text-secondary transition hover:bg-surface-muted hover:text-text-primary"
                onMouseDown={(event) => {
                  event.preventDefault();
                  saveCurrentRange();
                }}
                onClick={() => {
                  setIsTextMenuOpen(false);
                  setIsInsertMenuOpen(false);
                  setIsLinkPopoverOpen(false);
                  setIsCiteMenuOpen(false);
                  setShowAttachmentNotice(false);
                  setIsMoreMenuOpen((current) => !current);
                }}
              >
                <MoreIcon />
              </button>
            </>
          ) : (
            <>
          {toolbarButtonGroups.map((group, groupIndex) => (
            <div key={groupIndex} className="flex items-center gap-1">
              {groupIndex > 0 ? <span className="mx-1 h-5 w-px bg-border-subtle" aria-hidden="true" /> : null}
              {group.map((button) => (
                <button
                  key={button.action}
                  type="button"
                  title={button.title}
                  aria-label={button.title}
                  aria-pressed={activeActions.has(button.action)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => applyAction(button.action)}
                  className={`inline-flex h-7 w-7 items-center justify-center rounded-md transition ${
                    activeActions.has(button.action)
                      ? "bg-primary-soft text-primary"
                      : "text-text-secondary hover:bg-surface-muted hover:text-text-primary"
                  }`}
                >
                  {button.icon}
                </button>
              ))}
            </div>
          ))}

          <span className="mx-1 h-5 w-px bg-border-subtle" aria-hidden="true" />
          <button
            type="button"
            title="Inserir citação"
            aria-label="Inserir citação"
            className="inline-flex h-7 items-center gap-1 rounded-md border border-border-subtle px-2 text-[11px] font-semibold text-text-secondary transition hover:bg-surface-muted hover:text-text-primary"
            onMouseDown={(event) => event.preventDefault()}
            onClick={openCiteMenu}
          >
            <CitationIcon />
            Cite
          </button>

          <span className="mx-1 h-5 w-px bg-border-subtle" aria-hidden="true" />
          <button
            type="button"
            title="Inserir"
            aria-label="Inserir"
            aria-haspopup="menu"
            aria-expanded={isInsertMenuOpen}
            className="inline-flex h-7 items-center gap-1 rounded-md border border-border-subtle px-2 text-[11px] font-semibold text-text-secondary transition hover:bg-surface-muted hover:text-text-primary"
            onMouseDown={(event) => {
              event.preventDefault();
              saveCurrentRange();
            }}
            onClick={() => {
              setIsTextMenuOpen(false);
              setIsLinkPopoverOpen(false);
              setIsCiteMenuOpen(false);
              setIsMoreMenuOpen(false);
              setShowAttachmentNotice(false);
              setIsInsertMenuOpen((current) => !current);
            }}
          >
            Inserir
            <ChevronDownIcon />
          </button>

          <span className="mx-1 h-5 w-px bg-border-subtle" aria-hidden="true" />
          <button
            type="button"
            title="Mais opções"
            aria-label="Mais opções"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-text-secondary transition hover:bg-surface-muted hover:text-text-primary"
            onMouseDown={(event) => {
              event.preventDefault();
              saveCurrentRange();
            }}
            onClick={() => {
              setIsLinkPopoverOpen(false);
              setIsCiteMenuOpen(false);
              setShowAttachmentNotice(false);
              setIsMoreMenuOpen((current) => !current);
            }}
          >
            <MoreIcon />
          </button>
            </>
          )}

          {isFocusMode && isTextMenuOpen ? (
            <div className="absolute left-1/2 top-[calc(100%+6px)] z-40 w-64 -translate-x-1/2 rounded-lg border border-border-subtle bg-surface-panel p-2 shadow-lg">
              <div className="grid grid-cols-3 gap-1">
                {toolbarButtonGroups.flat().map((button) => (
                  <button
                    key={button.action}
                    type="button"
                    title={button.title}
                    aria-label={button.title}
                    aria-pressed={activeActions.has(button.action)}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => applyAction(button.action)}
                    className={`inline-flex h-8 items-center justify-center rounded-md px-2 text-xs font-semibold transition ${
                      activeActions.has(button.action)
                        ? "bg-primary-soft text-primary"
                        : "text-text-secondary hover:bg-surface-muted hover:text-text-primary"
                    }`}
                  >
                    {button.icon}
                  </button>
                ))}
              </div>
              <div className="my-2 h-px bg-border-subtle" />
              <p className="px-2 pb-1 text-[11px] font-bold uppercase tracking-[0.12em] text-text-subtle">Espaçamento</p>
              <div className="grid grid-cols-2 gap-1">
                {notebookSpacingOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    role="menuitemradio"
                    aria-checked={spacingMode === option.value}
                    className={`rounded-md px-2.5 py-1.5 text-left text-xs font-semibold transition ${
                      spacingMode === option.value
                        ? "bg-primary-soft text-primary"
                        : "text-text-secondary hover:bg-surface-muted hover:text-text-primary"
                    }`}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      onSpacingModeChange?.(option.value);
                      setIsTextMenuOpen(false);
                    }}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {isInsertMenuOpen ? (
            <div className={`absolute top-[calc(100%+6px)] z-40 max-h-[26rem] w-72 overflow-y-auto rounded-lg border border-border-subtle bg-surface-panel p-2 shadow-lg ${
              isFocusMode ? "left-1/2 -translate-x-1/2" : "right-8"
            }`}>
              <p className="px-2 pb-1 text-[11px] font-bold uppercase tracking-[0.12em] text-text-subtle">Inserir</p>
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs font-semibold text-text-secondary transition hover:bg-surface-muted hover:text-text-primary"
                onMouseDown={(event) => event.preventDefault()}
                onClick={openLinkPopover}
              >
                <LinkIcon />
                Link
              </button>
              {isFocusMode ? (
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs font-semibold text-text-secondary transition hover:bg-surface-muted hover:text-text-primary"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={openCiteMenu}
                >
                  <CitationIcon />
                  Citação
                </button>
              ) : null}
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs font-semibold text-text-secondary transition hover:bg-surface-muted hover:text-text-primary"
                onMouseDown={(event) => event.preventDefault()}
                onClick={insertTableBlock}
              >
                <TableIcon />
                Tabela
              </button>
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs font-semibold text-text-secondary transition hover:bg-surface-muted hover:text-text-primary"
                onMouseDown={(event) => event.preventDefault()}
                onClick={insertCalloutBlock}
              >
                <CalloutIcon />
                Callout
              </button>
              <div className="my-1 h-px bg-border-subtle" />
              <p className="px-2 pb-1 pt-1 text-[11px] font-bold uppercase tracking-[0.12em] text-text-subtle">Figura</p>
              {(Object.keys(figureSubtypeLabels) as FigureSubtype[]).map((subtype) => (
                <button
                  key={subtype}
                  type="button"
                  className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs font-semibold text-text-secondary transition hover:bg-surface-muted hover:text-text-primary"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    if (subtype === "image") {
                      openLocalImagePicker();
                      return;
                    }

                    const diagramKind = diagramKindFromFigureSubtype(subtype);
                    if (diagramKind) {
                      insertDiagramBlock(diagramKind);
                    }
                  }}
                >
                  <FigureIcon />
                  {figureSubtypeLabels[subtype]}
                </button>
              ))}
              <div className="my-1 h-px bg-border-subtle" />
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs font-semibold text-text-secondary transition hover:bg-surface-muted hover:text-text-primary"
                onMouseDown={(event) => event.preventDefault()}
                onClick={insertEquationBlock}
              >
                <EquationIcon />
                Equação
              </button>
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs font-semibold text-text-secondary transition hover:bg-surface-muted hover:text-text-primary"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  setIsInsertMenuOpen(false);
                  onOpenPdfPicker?.();
                }}
              >
                <PdfToolbarIcon />
                PDF
              </button>
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs font-semibold text-text-secondary transition hover:bg-surface-muted hover:text-text-primary"
                onMouseDown={(event) => event.preventDefault()}
                onClick={openLocalAttachmentPicker}
              >
                <AttachmentIcon />
                Arquivo
              </button>
            </div>
          ) : null}

          {isLinkPopoverOpen ? (
            <div className={`absolute top-[calc(100%+6px)] z-40 flex w-72 items-center gap-2 rounded-lg border border-border-subtle bg-surface-panel p-2 shadow-lg ${
              isFocusMode ? "left-1/2 -translate-x-1/2" : "right-24"
            }`}>
              <input
                ref={linkInputRef}
                value={linkUrl}
                onChange={(event) => setLinkUrl(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    commitLink();
                  }

                  if (event.key === "Escape") {
                    event.preventDefault();
                    setIsLinkPopoverOpen(false);
                  }
                }}
                placeholder="https://..."
                className="min-w-0 flex-1 rounded-md border border-border-subtle bg-[var(--card)] px-2 py-1.5 text-xs text-text-primary outline-none focus:border-primary"
              />
              <button type="button" className="rounded-md bg-primary px-2.5 py-1.5 text-xs font-bold text-text-inverse" onClick={commitLink}>
                Aplicar
              </button>
            </div>
          ) : null}

          {isCiteMenuOpen ? (
            <div className={`absolute top-[calc(100%+6px)] z-40 max-h-56 w-72 overflow-y-auto rounded-lg border border-border-subtle bg-surface-panel p-1 shadow-lg ${
              isFocusMode ? "left-1/2 -translate-x-1/2" : "right-24"
            }`}>
              {linkedDocuments.map((document) => (
                <button
                  key={document.id}
                  type="button"
                  className="block w-full rounded-md px-3 py-2 text-left text-xs transition hover:bg-surface-muted"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => insertCitation(document)}
                >
                  <span className="block truncate font-semibold text-text-primary">{document.title}</span>
                  <span className="block truncate text-text-secondary">{citationText(document)}</span>
                </button>
              ))}
            </div>
          ) : null}

          {showAttachmentNotice ? (
            <div className={`absolute top-[calc(100%+6px)] z-40 w-56 rounded-lg border border-border-subtle bg-surface-panel p-3 text-xs font-medium text-text-secondary shadow-lg ${
              isFocusMode ? "left-1/2 -translate-x-1/2" : "right-16"
            }`}>
              Anexos gerais ficam para uma etapa futura.
            </div>
          ) : null}

          {assetPasteError ? (
            <div className={`absolute top-[calc(100%+6px)] z-40 w-72 rounded-lg border border-red-300 bg-surface-panel p-3 text-xs font-medium text-red-700 shadow-lg dark:border-red-900/60 dark:text-red-300 ${
              isFocusMode ? "left-1/2 -translate-x-1/2" : "right-16"
            }`}>
              {assetPasteError}
            </div>
          ) : null}

          {isMoreMenuOpen ? (
            <div className={`absolute top-[calc(100%+6px)] z-40 rounded-lg border border-border-subtle bg-surface-panel p-1 shadow-lg ${
              isFocusMode ? "left-1/2 -translate-x-1/2" : "right-0"
            } ${isFocusMode ? "w-44" : "w-64"}`}>
              <button type="button" className="block w-full rounded-md px-3 py-2 text-left text-xs font-semibold text-text-secondary hover:bg-surface-muted hover:text-text-primary" onClick={() => applyMoreCommand("clear-formatting")}>
                Limpar formatação
              </button>
              <button type="button" className="block w-full rounded-md px-3 py-2 text-left text-xs font-semibold text-text-secondary hover:bg-surface-muted hover:text-text-primary" onClick={() => applyMoreCommand("unlink")}>
                Remover link
              </button>
              <button type="button" className="block w-full rounded-md px-3 py-2 text-left text-xs font-semibold text-text-secondary hover:bg-surface-muted hover:text-text-primary" onClick={() => applyMoreCommand("separator")}>
                Inserir separador
              </button>
              {!isFocusMode ? (
                <>
                  <div className="my-1 h-px bg-border-subtle" />
                  <p className="px-3 pb-1 pt-1 text-[11px] font-bold uppercase tracking-[0.12em] text-text-subtle">Espaçamento</p>
                  <div className="grid grid-cols-2 gap-1">
                    {notebookSpacingOptions.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        role="menuitemradio"
                        aria-checked={spacingMode === option.value}
                        className={`rounded-md px-2.5 py-1.5 text-left text-xs font-semibold transition ${
                          spacingMode === option.value
                            ? "bg-primary-soft text-primary"
                            : "text-text-secondary hover:bg-surface-muted hover:text-text-primary"
                        }`}
                        onClick={() => {
                          onSpacingModeChange?.(option.value);
                          setIsMoreMenuOpen(false);
                        }}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <div ref={editorShellRef} className="relative min-h-0 flex-1">
        {activeTableCell ? (
          <div
            className="absolute z-30 inline-flex items-center gap-1 rounded-lg border border-border-subtle bg-surface-panel p-1 text-[11px] font-semibold text-text-secondary shadow-lg"
            style={{ top: activeTableCell.top, left: activeTableCell.left }}
          >
            <span className="px-2 text-text-subtle">Tabela</span>
            <button
              type="button"
              className="rounded-md px-2 py-1 transition hover:bg-surface-muted hover:text-text-primary"
              onMouseDown={(event) => event.preventDefault()}
              onClick={addTableRowBelow}
            >
              + linha
            </button>
            <button
              type="button"
              disabled={!activeTableCell.canRemoveRow}
              className="rounded-md px-2 py-1 transition hover:bg-surface-muted hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-45"
              onMouseDown={(event) => event.preventDefault()}
              onClick={removeCurrentTableRow}
            >
              - linha
            </button>
            <span className="h-4 w-px bg-border-subtle" aria-hidden="true" />
            <button
              type="button"
              className="rounded-md px-2 py-1 transition hover:bg-surface-muted hover:text-text-primary"
              onMouseDown={(event) => event.preventDefault()}
              onClick={addTableColumnRight}
            >
              + coluna
            </button>
            <button
              type="button"
              disabled={!activeTableCell.canRemoveColumn}
              className="rounded-md px-2 py-1 transition hover:bg-surface-muted hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-45"
              onMouseDown={(event) => event.preventDefault()}
              onClick={removeCurrentTableColumn}
            >
              - coluna
            </button>
          </div>
        ) : null}
        {activeCallout ? (
          <div
            className="absolute z-30 inline-flex items-center gap-1 rounded-lg border border-border-subtle bg-surface-panel p-1 text-[11px] font-semibold text-text-secondary shadow-lg"
            style={{ top: activeCallout.top, left: activeCallout.left }}
          >
            <span className="px-2 text-text-subtle">Callout</span>
            {(Object.keys(calloutLabels) as CalloutType[]).map((type) => (
              <button
                key={type}
                type="button"
                aria-pressed={activeCallout.type === type}
                className={`rounded-md px-2 py-1 transition ${
                  activeCallout.type === type
                    ? "bg-primary-soft text-primary"
                    : "hover:bg-surface-muted hover:text-text-primary"
                }`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => changeCurrentCalloutType(type)}
              >
                {calloutLabels[type]}
              </button>
            ))}
            <span className="h-4 w-px bg-border-subtle" aria-hidden="true" />
            <button
              type="button"
              className="rounded-md px-2 py-1 text-status-red transition hover:bg-status-red hover:text-status-red-text"
              onMouseDown={(event) => event.preventDefault()}
              onClick={removeCurrentCallout}
            >
              Remover
            </button>
          </div>
        ) : null}
        {activeDiagram ? (
          <div
            className="absolute z-30 inline-flex items-center gap-1 rounded-lg border border-border-subtle bg-surface-panel p-1 text-[11px] font-semibold text-text-secondary shadow-lg"
            style={{ top: activeDiagram.top, left: activeDiagram.left }}
          >
            <span className="px-2 text-text-subtle">Diagrama</span>
            {(Object.keys(diagramKindLabels) as DiagramKind[]).map((kind) => (
              <button
                key={kind}
                type="button"
                aria-pressed={activeDiagram.kind === kind}
                className={`rounded-md px-2 py-1 transition ${
                  activeDiagram.kind === kind
                    ? "bg-primary-soft text-primary"
                    : "hover:bg-surface-muted hover:text-text-primary"
                }`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => changeCurrentDiagramKind(kind)}
              >
                Tipo: {diagramKindLabels[kind]}
              </button>
            ))}
            <span className="h-4 w-px bg-border-subtle" aria-hidden="true" />
            <button
              type="button"
              className="rounded-md px-2 py-1 text-status-red transition hover:bg-status-red hover:text-status-red-text"
              onMouseDown={(event) => event.preventDefault()}
              onClick={removeCurrentDiagram}
            >
              Remover
            </button>
          </div>
        ) : null}
        {activeEquation ? (
          <div
            className="absolute z-30 inline-flex items-center gap-1 rounded-lg border border-border-subtle bg-surface-panel p-1 text-[11px] font-semibold text-text-secondary shadow-lg"
            style={{ top: activeEquation.top, left: activeEquation.left }}
          >
            <span className="px-2 text-text-subtle">Equação</span>
            <button
              type="button"
              className="rounded-md px-2 py-1 text-status-red transition hover:bg-status-red hover:text-status-red-text"
              onMouseDown={(event) => event.preventDefault()}
              onClick={removeCurrentEquation}
            >
              Remover
            </button>
          </div>
        ) : null}
        {isEmpty ? (
          <div className="pointer-events-none absolute inset-x-0 top-0">
            <span
              style={editorStyle}
              className={`block py-4 pr-5 text-sm leading-7 text-[var(--muted-foreground)] ${contentInsetClassName}`}
            >
            Escreva suas anotações...
            </span>
          </div>
        ) : null}
        <div
          ref={editorRef}
          role="textbox"
          aria-multiline="true"
          aria-label="Conteúdo da página"
          contentEditable
          suppressContentEditableWarning
          onInput={emitChange}
          onBlur={onBlur}
          onClick={handleEditorClick}
          onPaste={handlePaste}
          onKeyDown={handleKeyDown}
          onScroll={syncActiveActions}
          style={editorStyle}
          className={`notebook-editor notebook-editor--spaced ${isFocusMode ? "notebook-editor--focus" : ""} ${isCtrlPressed ? "notebook-editor--link-nav" : ""} h-full w-full overflow-y-auto break-words border-0 bg-transparent py-4 pr-5 text-sm leading-7 text-[var(--foreground)] outline-none ${contentInsetClassName}`}
        />
      </div>
    </div>
  );
}
